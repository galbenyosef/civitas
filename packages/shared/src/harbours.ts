import { MANIFEST } from './buildings/compiled';
import { HARBOUR_BERTHS, type BerthSlot } from './buildings/harbour';
import { FRONT, WET_OF, footprintOf, footprintPoint, footprintTile, type Placed } from './structures';
export type { BerthSlot } from './buildings/harbour';

/**
 * Harbour kinds (docs/boats.md section 5): what the schedule, the server and the renderer need to know about kind ids
 * 24-28 beyond the tables. The catalogue (buildings/harbour.ts) holds the kinds, their wet rows and their berths;
 * placement is in structures.ts (`WET_OF`, `fairwayTiles`, `quayTiles`, `isWetTile`).
 */
export type HarbourRole = 'jetty' | 'marina' | 'fishing' | 'pier' | 'port';
export interface HarbourKindSpec {
  kind: number;
  /** catalogue id ('marina') */
  id: string;
  role: HarbourRole;
  /** back rows over water */
  wet: number;
  /** width class the water behind needs: 1 narrow, 2 river, 3 open */
  fairwayClearance: number;
  berths: readonly BerthSlot[];
}
const ROLES: readonly string[] = ['jetty', 'marina', 'fishing', 'pier', 'port'];
/** by kind id; undefined for every other kind */
export const HARBOUR_OF: (HarbourKindSpec | undefined)[] = [];
for (const k of MANIFEST) {
  const role = k.attrs.harbour, wet = WET_OF[k.kindId];
  if (typeof role !== 'string' || !ROLES.includes(role) || !wet) continue;
  HARBOUR_OF[k.kindId] = { kind: k.kindId, id: k.id, role: role as HarbourRole, wet: wet.wet, fairwayClearance: wet.fairwayClearance, berths: HARBOUR_BERTHS[k.id] ?? [] };
}
export const isHarbourId = (kind: number) => HARBOUR_OF[kind] !== undefined;
/** Harbour kind ids by role. */
export const HARBOUR_KIND: Record<HarbourRole, number> = { jetty: -1, marina: -1, fishing: -1, pier: -1, port: -1 };
for (const h of HARBOUR_OF) if (h) HARBOUR_KIND[h.role] = h.kind;

/** A berth of a placed harbour in world tile space: its centre (continuous, tile units), the way the bow points and its slot. */
export interface PlacedBerth {
  index: number; x: number; y: number;
  /** FRONT index of the bow's direction in the world */
  dir: number;
  /** that direction as an angle, atan2(dy, dx) in tile space */
  angle: number;
  len: number; mode: BerthSlot['mode']; label: string;
  /** the fairway tile (the row just behind the back edge) at the berth's column: where its boat leaves the lane */
  fairway: [number, number];
}
/** The berths of a placed harbour, turned with it (empty for any other structure). */
export function placedBerths(p: Placed): PlacedBerth[] {
  const h = HARBOUR_OF[p.kind];
  if (!h) return [];
  const w = footprintOf(p.kind).w;
  return h.berths.map((b, index) => {
    const [x, y] = footprintPoint(p, b.x, b.y), dir = (b.dir + p.r) & 3;
    const fairway = footprintTile(p, Math.min(w - 1, Math.max(0, Math.floor(b.x))), -1);
    return { index, x, y, dir, angle: Math.atan2(FRONT[dir][1], FRONT[dir][0]), len: b.len, mode: b.mode, label: b.label, fairway };
  });
}
