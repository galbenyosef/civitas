import { CHUNK_SIZE } from './constants';
import { Zone, LEVEL_SLOTS } from './buildings/codes';
import { TOP_LEVEL_TABLE, DESIGN_COUNT_TABLE, KIND_ID } from './buildings/compiled';
import { PALETTE } from './buildings/palette';
import { RECIPES } from './buildings/recipes';
import { isRoad, zoneOf, levelOf, underConstruction, kindIdOf } from './tile';
import { isPartAux, isAnchorAux, auxOrientation, isMultiTile, placedFromAnchor } from './structures';
import { hash2 } from './noise';
import { designPick } from './leisure';
import type { Pad, PadKind } from './helicopters';

/**
 * Helipads from the buildings on the map (docs/helicopters.md). A pad is part of a design: the tierkit `helipad()`
 * helper (shared/src/buildings/tierkit.ts) draws a dark disc, a yellow ring and an H, and this module finds that
 * pattern in the compiled recipes. A tile's design, turn and scale come from the same hashes and road test the
 * client's chunk view (client/src/render/chunkView.ts) places it with, so a pad found here sits exactly on the roof
 * that is drawn, and every client with the same tiles finds the same pads (the schedule, shared/src/helicopters.ts,
 * then flies the same helicopters).
 *
 * Not exported from the shared index: it reads the recipe table, which the server has no use for. The client
 * imports it by path, like the other recipe readers (render/models.ts, render/signs.ts).
 */

/** a design's pad in model space (tile units, before the placement's turn and scale): x, surface y, z, radius */
type LocalPad = [number, number, number, number];

const DISC = 0x4a4f58, RING = PALETTE.yellow;
/** The helipad helper's first two ops: the dark disc, then the yellow ring at 0.82 of its radius on the same spot. */
function padsOfOps(ops: readonly (readonly unknown[])[]): LocalPad[] {
  const out: LocalPad[] = [];
  for (let i = 0; i + 1 < ops.length; i++) {
    const a = ops[i], b = ops[i + 1];
    if (a[0] !== 'cyl' || b[0] !== 'cyl' || a[7] !== DISC || b[7] !== RING) continue;
    const r = a[1] as number;
    if (Math.abs((b[1] as number) - r * 0.82) > 1e-4 || a[4] !== b[4] || a[5] !== b[5] || a[6] !== b[6]) continue;
    out.push([a[4] as number, (a[5] as number) + 0.024, a[6] as number, r]);
  }
  return out;
}

/** pads per live design: slot (kind * LEVEL_SLOTS + level) -> design index -> its first pad, or null */
let table: (LocalPad | null)[][] | null = null;
function padTable(): (LocalPad | null)[][] {
  if (table) return table;
  table = [];
  for (const r of RECIPES) {
    if (r.draft || r.level <= 0) continue;
    (table[r.kind * LEVEL_SLOTS + r.level] ??= [])[r.index] = padsOfOps(r.ops)[0] ?? null;
  }
  return table;
}

/** The pad of the design a tile of this kind and level shows (render/models.ts `variant`), or null. */
export function designPad(kind: number, level: number, pick: number): LocalPad | null {
  const top = TOP_LEVEL_TABLE[kind] ?? 0;
  let lv = Math.min(level, top);
  while (lv < top && !DESIGN_COUNT_TABLE[kind * LEVEL_SLOTS + lv]) lv++;
  const s = kind * LEVEL_SLOTS + lv;
  const n = DESIGN_COUNT_TABLE[s];
  if (!n) return null;
  return padTable()[s]?.[Math.min(n - 1, Math.floor(pick * n))] ?? null;
}

const PALACE = KIND_ID['buckingham-palace'];
/** Which service a building's pad is for. */
export function padKindOf(kind: number, code: number): PadKind {
  if (code === Zone.Hospital) return 'medical';
  if (code === Zone.Police) return 'police';
  if (kind === PALACE) return 'royal';
  return 'corporate';
}

/** What derivation reads: tiles (undefined where not loaded), aux bytes and sub bytes (airport.ts AirfieldEnv). */
export interface PadEnv {
  tile(x: number, y: number): number | undefined;
  aux(x: number, y: number): number;
  sub(x: number, y: number): number;
}

/** The pad on the finished building anchored at tile (x, y), if its design has one. */
export function padAt(x: number, y: number, env: PadEnv): Pad | null {
  const t = env.tile(x, y);
  if (t === undefined || isRoad(t)) return null;
  const code = zoneOf(t), level = levelOf(t);
  if (code === Zone.None || level <= 0 || underConstruction(t)) return null;
  const a = env.aux(x, y);
  if (a && isPartAux(a)) return null; // a structure's pad belongs to its anchor
  const kind = kindIdOf(code, env.sub(x, y));
  const local = designPad(kind, level, designPick(x, y));
  if (!local) return null;
  // placement exactly as client/src/render/chunkView.ts draws the model
  let cx: number, cz: number, yaw: number, s: number;
  if (a && isAnchorAux(a) && isMultiTile(kind)) {
    const p = placedFromAnchor(kind, x, y, auxOrientation(a));
    cx = p.ax + p.w / 2; cz = p.ay + p.h / 2; yaw = (p.r * Math.PI) / 2; s = 1;
  } else {
    const road = (dx: number, dy: number) => { const q = env.tile(x + dx, y + dy); return q !== undefined && isRoad(q); };
    if (road(0, 1)) yaw = 0;
    else if (road(1, 0)) yaw = Math.PI / 2;
    else if (road(-1, 0)) yaw = -Math.PI / 2;
    else if (road(0, -1)) yaw = Math.PI;
    else yaw = Math.floor(hash2(x, y) * 4) * (Math.PI / 2);
    s = 0.95 + 0.1 * hash2(y * 3 + 1, x * 5 + 7);
    cx = x + 0.5; cz = y + 0.5;
  }
  // three.js turns about +y: x' = x cos + z sin, z' = -x sin + z cos
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const [lx, ly, lz, r] = local;
  // a parked helicopter faces the building's front (+z in the model) turned by the yaw
  return {
    id: 1 + Math.floor(hash2(x * 31 + 7, y * 57 + 3) * 999_983),
    x: cx + (lx * c + lz * sn) * s, y: ly * s, z: cz + (-lx * sn + lz * c) * s, r: r * s,
    kind: padKindOf(kind, code), heading: Math.atan2(c, sn), building: kind, bx: x, by: y,
  };
}

/** Every pad on buildings anchored in chunk (cx, cy). */
export function chunkPads(cx: number, cy: number, env: PadEnv): Pad[] {
  const out: Pad[] = [];
  const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
  for (let y = y0; y < y0 + CHUNK_SIZE; y++) for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
    const p = padAt(x, y, env);
    if (p) out.push(p);
  }
  return out;
}
