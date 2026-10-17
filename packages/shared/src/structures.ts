import { FOOTPRINT_TABLE } from './buildings/compiled';
import { KIND_NAMES, isRoad, zoneOf, levelOf, underConstruction, isBuildable, isGrowableId, kindIdOf, kindManifest } from './tile';
import type { FootprintMark, MarkKind } from './buildings/schema';
export type { FootprintMark, MarkKind, MarkEdge } from './buildings/schema';
import { Zone } from './buildings/codes';

/**
 * The aux layer: one byte per tile beside the tile word and the parcel id (docs/aux-layer.md).
 *
 *   0x00              nothing
 *   0x01-0x3f         free for later layers (road classes, graded height)
 *   0x40 | r          anchor of a multi-tile structure; r (bits 0-1) is its orientation, bits 2-5 are 0
 *   0x80 | dy<<3 | dx part of a structure whose anchor is at (x - dx, y - dy); dx, dy 0-7
 *   0xc0-0xd7         airfield strip tiles (airport.ts)
 *   0xd8-0xff         free
 *
 * The anchor is the footprint's min-x, min-y corner, so part offsets are never negative. Every tile of a
 * structure carries the same tile word (family code, level, construction bits) and the same sub byte (kind id,
 * docs/sub-kinds.md); the server mirrors the door tile's word to the others, and only the door tile is a Building
 * in the simulation. A structure's `kind` (Placed.kind, footprintOf) is always a kind id.
 */
export const AUX_ANCHOR = 0x40;
export const AUX_PART = 0x80;
const CLASS_MASK = 0xc0;
export const isAnchorAux = (a: number) => (a & CLASS_MASK) === AUX_ANCHOR;
export const isPartAux = (a: number) => (a & CLASS_MASK) === AUX_PART;
export const isStructureAux = (a: number) => isAnchorAux(a) || isPartAux(a);
export const anchorAux = (r: number) => AUX_ANCHOR | (r & 3);
export const partAux = (dx: number, dy: number) => AUX_PART | ((dy & 7) << 3) | (dx & 7);
export const auxOrientation = (a: number) => a & 3;
/** Offset from a part tile back to its anchor. */
export const partDx = (a: number) => a & 7;
export const partDy = (a: number) => (a >> 3) & 7;

/**
 * Orientation: the direction the structure's front (model +z, the door side) faces.
 * 0 = +y, 1 = +x, 2 = -y, 3 = -x; the model is rotated by r quarter turns (yaw r·π/2).
 */
export const FRONT: readonly [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
/** Road sides tried in this order when placing, the same preference a 1×1 building uses to face a road. */
const ORIENT_PREFERENCE = [0, 1, 3, 2];

export interface Footprint { w: number; h: number; door: [number, number] }
/** Footprint of a kind id (1×1 with the door on the only tile unless the catalogue says otherwise). */
export function footprintOf(kind: number): Footprint {
  const i = kind * 4;
  return { w: FOOTPRINT_TABLE[i] || 1, h: FOOTPRINT_TABLE[i + 1] || 1, door: [FOOTPRINT_TABLE[i + 2] ?? 0, FOOTPRINT_TABLE[i + 3] ?? 0] };
}
export const isMultiTile = (kind: number) => { const i = kind * 4; return (FOOTPRINT_TABLE[i] ?? 1) * (FOOTPRINT_TABLE[i + 1] ?? 1) > 1; };

/** A structure as it stands on the map: anchor (min corner), rotated size, door tile and the road tile it faces. */
export interface Placed {
  /** kind id (not the family code) */
  kind: number; r: number;
  ax: number; ay: number;
  /** rotated size in tiles along x and y */
  w: number; h: number;
  doorX: number; doorY: number;
  frontX: number; frontY: number;
}

/** Where canonical footprint tile (lx, ly) lands, as an offset from the anchor, for orientation r. */
export function rotateLocal(fp: Footprint, r: number, lx: number, ly: number): [number, number] {
  switch (r & 3) {
    case 0: return [lx, ly];
    case 1: return [ly, fp.w - 1 - lx];
    case 2: return [fp.w - 1 - lx, fp.h - 1 - ly];
    default: return [fp.h - 1 - ly, lx];
  }
}
export function placedFromAnchor(kind: number, ax: number, ay: number, r: number): Placed {
  const fp = footprintOf(kind);
  const [ox, oy] = rotateLocal(fp, r, fp.door[0], fp.door[1]);
  const [fx, fy] = FRONT[r & 3];
  const odd = (r & 1) === 1;
  return { kind, r: r & 3, ax, ay, w: odd ? fp.h : fp.w, h: odd ? fp.w : fp.h, doorX: ax + ox, doorY: ay + oy, frontX: ax + ox + fx, frontY: ay + oy + fy };
}
/** The structure whose door is at (doorX, doorY), facing orientation r. */
export function placedFromDoor(kind: number, doorX: number, doorY: number, r: number): Placed {
  const fp = footprintOf(kind);
  const [ox, oy] = rotateLocal(fp, r, fp.door[0], fp.door[1]);
  return placedFromAnchor(kind, doorX - ox, doorY - oy, r);
}
/** Visit every tile of a placed structure with its aux byte. */
export function eachTile(p: Placed, visit: (x: number, y: number, aux: number) => void) {
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) visit(p.ax + dx, p.ay + dy, dx === 0 && dy === 0 ? anchorAux(p.r) : partAux(dx, dy));
}

/**
 * The structure covering (x, y), from the aux layer and the anchor's tile word and sub byte; null for an ordinary
 * tile (or a half-loaded one on the client: anchor not loaded yet, or not a multi-tile kind).
 */
export function structureAt(x: number, y: number, aux: (x: number, y: number) => number, tile: (x: number, y: number) => number | undefined,
  sub: (x: number, y: number) => number): Placed | null {
  const a = aux(x, y);
  if (!a) return null;
  let ax = x, ay = y, aa = a;
  if (isPartAux(a)) { ax = x - partDx(a); ay = y - partDy(a); aa = aux(ax, ay); }
  if (!isAnchorAux(aa)) return null;
  const t = tile(ax, ay);
  if (t === undefined || isRoad(t)) return null;
  const kind = kindIdOf(zoneOf(t), sub(ax, ay));
  if (!isMultiTile(kind)) return null;
  const p = placedFromAnchor(kind, ax, ay, auxOrientation(aa));
  if (x < p.ax || y < p.ay || x >= p.ax + p.w || y >= p.ay + p.h) return null;
  return p;
}

/** What placement may read; the client answers from loaded chunks, the server from the world. */
export interface PlaceEnv {
  tile(x: number, y: number): number | undefined;
  aux(x: number, y: number): number;
  /** sub byte (kind id, docs/sub-kinds.md); 0 where unknown */
  sub(x: number, y: number): number;
  /** may this player build on (x, y)? return a refusal reason, or null when fine */
  land(x: number, y: number): string | null;
}
export type PlaceVerdict = { ok: true; placed: Placed } | { ok: false; reason: string; placed?: Placed };

/** 'A police station', 'An airport terminal' */
const aName = (name: string) => `${/^[aeiou]/.test(name) ? 'An' : 'A'} ${name}`;

function checkPlaced(p: Placed, env: PlaceEnv): string | null {
  const name = KIND_NAMES[p.kind] ?? 'structure';
  let why: string | null = null;
  eachTile(p, (x, y) => {
    if (why) return;
    const t = env.tile(x, y);
    if (t === undefined) { why = 'That land is not loaded yet'; return; }
    if (!isBuildable(t)) { why = `${aName(name)} cannot stand on water`; return; }
    if (isRoad(t)) { why = `${aName(name)} needs ${p.w}×${p.h} tiles clear of roads`; return; }
    const k = zoneOf(t);
    // empty zoned lots may be built over; buildings, sites and other structures may not
    if (env.aux(x, y) || (k !== Zone.None && (!isGrowableId(kindIdOf(k, env.sub(x, y))) || levelOf(t) > 0 || underConstruction(t)))) { why = `${aName(name)} needs ${p.w}×${p.h} tiles clear of other buildings`; return; }
    why = env.land(x, y);
  });
  return why;
}

/**
 * Place a multi-tile kind (by kind id) with its door on (doorX, doorY): the footprint turns to face a road touching the door
 * (front +y first, then +x, -x, -y) and must fit on clear, buildable land the player may use.
 *
 * `rot` (0-3, FRONT order) forces that orientation instead: the door's outward neighbour must be a road ("The door must
 * face a road") and the tiles must be clear. Anything else (undefined, NaN, out of range) keeps the automatic facing.
 */
export function planStructure(kind: number, doorX: number, doorY: number, env: PlaceEnv, rot?: number): PlaceVerdict {
  const name = KIND_NAMES[kind] ?? 'structure';
  if (rot !== undefined && Number.isInteger(rot) && rot >= 0 && rot <= 3) {
    const placed = placedFromDoor(kind, doorX, doorY, rot);
    const rt = env.tile(placed.frontX, placed.frontY);
    if (rt === undefined || !isRoad(rt)) return { ok: false, reason: 'The door must face a road', placed };
    const why = checkPlaced(placed, env);
    return why ? { ok: false, reason: why, placed } : { ok: true, placed };
  }
  let first: PlaceVerdict | null = null;
  for (const r of ORIENT_PREFERENCE) {
    const [fx, fy] = FRONT[r];
    const rt = env.tile(doorX + fx, doorY + fy);
    if (rt === undefined || !isRoad(rt)) continue;
    const placed = placedFromDoor(kind, doorX, doorY, r);
    const why = checkPlaced(placed, env);
    if (!why) return { ok: true, placed };
    first ??= { ok: false, reason: why, placed };
  }
  return first ?? { ok: false, reason: `${aName(name)}'s door needs a road next to it`, placed: placedFromDoor(kind, doorX, doorY, 0) };
}

// ---------------------------------------------------------------- marks: significant parts of a footprint

/** Compass name of an orientation: the side of the map a structure's front faces (+y is south, as on the map). */
export const FRONT_NAMES = ['S', 'E', 'N', 'W'] as const;

/** A footprint mark turned into world tile space: a rectangle (tile units, may be thinner than a tile) and the side it faces. */
export interface PlacedMark {
  kind: MarkKind;
  label?: string;
  x: number; y: number; w: number; h: number;
  /** FRONT index of the side the mark looks out of: the door arrow points this way; a strip's outward side */
  facing: number;
  /** a strip on an edge (thin line or band), not a tile */
  edge: boolean;
}

/** Thickness of a boundary-line mark, in tiles. */
export const MARK_LINE = 0.16;

/** The marks a kind declares plus an implied door mark at its door tile (unless it declares one itself). */
export function marksOf(kind: number): FootprintMark[] {
  const fp = kindManifest(kind)?.footprint;
  const declared = fp?.marks ?? [];
  if (declared.some((m) => m.kind === 'door')) return declared;
  const door = footprintOf(kind).door;
  return [{ kind: 'door', at: [door[0], door[1]], label: 'door' }, ...declared];
}

const EDGE_FACING: Record<string, number> = { front: 0, right: 1, back: 2, left: 3 };

/** The marks of a placed structure in world tile space, turned with its orientation. */
export function placedMarks(p: Placed): PlacedMark[] {
  const fp = footprintOf(p.kind), { w, h } = fp;
  const out: PlacedMark[] = [];
  // canonical continuous (px, py) -> offset from the anchor, the continuous form of rotateLocal
  const rot = (px: number, py: number): [number, number] => {
    switch (p.r & 3) {
      case 0: return [px, py];
      case 1: return [py, w - px];
      case 2: return [w - px, h - py];
      default: return [h - py, px];
    }
  };
  for (const m of marksOf(p.kind)) {
    let x0: number, y0: number, x1: number, y1: number, facing = 0, edge = false;
    if (Array.isArray(m.at)) {
      [x0, y0] = [m.at[0], m.at[1]]; [x1, y1] = [x0 + 1, y0 + 1];
    } else {
      const e = m.at.edge, horizontal = e === 'front' || e === 'back';
      const from = m.at.from ?? 0, to = m.at.to ?? (horizontal ? w : h) - 1;
      const depth = m.at.depth ?? 0;
      edge = true; facing = EDGE_FACING[e];
      // a thin line straddles the boundary; a band reaches `depth` tiles inward
      const lo = depth > 0 ? 0 : -MARK_LINE / 2, hi = depth > 0 ? depth : MARK_LINE / 2;
      if (e === 'front') { x0 = from; x1 = to + 1; y0 = h - hi; y1 = h - lo; }
      else if (e === 'back') { x0 = from; x1 = to + 1; y0 = lo; y1 = hi; }
      else if (e === 'left') { y0 = from; y1 = to + 1; x0 = lo; x1 = hi; }
      else { y0 = from; y1 = to + 1; x0 = w - hi; x1 = w - lo; }
    }
    const [ax, ay] = rot(x0, y0), [bx, by] = rot(x1, y1);
    out.push({
      kind: m.kind, label: m.label,
      x: p.ax + Math.min(ax, bx), y: p.ay + Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay),
      facing: (facing + p.r) & 3, edge,
    });
  }
  return out;
}
