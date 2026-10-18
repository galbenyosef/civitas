import { MAX_PARCEL_EDGE, ZONE_COST } from './constants';
import { CIVIC_COST, CONSTRUCTION_FEE, isGrowableId, workOf } from './tile';
import { footprintOf } from './structures';

/**
 * Parcel management on the world map (docs/world-map.md section 2): combining and splitting parcels, as pure rules the
 * server enforces and the client previews. Parcels stay rectangles; what cannot be one rectangle becomes an estate
 * (a group sharing name, colour and tax rate).
 */
export interface ParcelRect { id: number; owner: string; x: number; y: number; w: number; h: number; group?: number }

export type CombinePlan =
  | { ok: true; parcels: number[]; merges: [keep: number, gone: number][]; rect: Map<number, { x: number; y: number; w: number; h: number }>; estate: number[] }
  | { ok: false; reason: string };

/** Most parcels one estate may hold. */
export const ESTATE_MAX = 200;
/** Colours a player may give a parcel on the map (besides the owner's own). */
export const PARCEL_COLOURS = [0xe8505b, 0xf9a03f, 0xf6d55c, 0x3caea3, 0x20639b, 0x7b5ea7, 0xe56ab3, 0x8d6e63];

/** Two rectangles share an edge of at least one tile (a corner does not count). */
export function edgeAdjacent(a: ParcelRect, b: ParcelRect): boolean {
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return ((a.x + a.w === b.x || b.x + b.w === a.x) && overlapY > 0) || ((a.y + a.h === b.y || b.y + b.h === a.y) && overlapX > 0);
}
/** The rectangle two rectangles make together, when they make one. */
function unionRect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) return { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + b.h };
  if (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x)) return { x: Math.min(a.x, b.x), y: a.y, w: a.w + b.w, h: a.h };
  return null;
}

/**
 * Combine parcels (and the whole estates any of them belong to): all one owner's, which `mayEdit` allows, joined edge
 * to edge. Pairs that make a rectangle within MAX_PARCEL_EDGE merge (the lower id keeps its id); if more than one
 * parcel is left, they are one estate. `parcels` looks a parcel up by id; `all` is every parcel (for estate members).
 */
export function planCombine(ids: readonly number[], parcels: (id: number) => ParcelRect | undefined, all: Iterable<ParcelRect>, mayEdit: (owner: string) => boolean): CombinePlan {
  const picked = new Map<number, ParcelRect>();
  for (const id of ids) {
    const p = parcels(id);
    if (!p) return { ok: false, reason: 'That parcel no longer exists' };
    picked.set(p.id, p);
  }
  const groups = new Set([...picked.values()].map((p) => p.group).filter((g): g is number => g !== undefined));
  if (groups.size) for (const p of all) if (p.group !== undefined && groups.has(p.group)) picked.set(p.id, p);
  const list = [...picked.values()];
  if (list.length < 2) return { ok: false, reason: 'Pick two or more parcels to combine (shift-click to add)' };
  const owner = list[0].owner;
  if (list.some((p) => p.owner !== owner)) return { ok: false, reason: 'Only one owner\'s parcels can be combined' };
  if (!mayEdit(owner)) return { ok: false, reason: 'Not your land' };
  if (list.length > ESTATE_MAX) return { ok: false, reason: `An estate holds at most ${ESTATE_MAX} parcels` };
  // joined up: every parcel reaches every other through shared edges
  const seen = new Set([list[0].id]), todo = [list[0]];
  while (todo.length) { const a = todo.pop()!; for (const b of list) if (!seen.has(b.id) && edgeAdjacent(a, b)) { seen.add(b.id); todo.push(b); } }
  if (seen.size !== list.length) return { ok: false, reason: 'Those parcels do not touch: combined land must join up edge to edge' };
  if (groups.size === 1 && list.every((p) => p.group === [...groups][0])) {
    // already one estate: only rectangle merges are left to do
    if (!list.some((a) => list.some((b) => a.id < b.id && fits(unionRect(a, b))))) return { ok: false, reason: 'Those parcels are already one estate' };
  }
  // merge rectangles while any pair makes one
  const rect = new Map(list.map((p) => [p.id, { x: p.x, y: p.y, w: p.w, h: p.h }]));
  const merges: [number, number][] = [];
  for (let again = true; again;) {
    again = false;
    const live = [...rect.keys()].sort((a, b) => a - b);
    outer: for (const a of live) for (const b of live) {
      if (a >= b) continue;
      const u = unionRect(rect.get(a)!, rect.get(b)!);
      if (!fits(u)) continue;
      rect.set(a, u!); rect.delete(b); merges.push([a, b]);
      again = true;
      break outer;
    }
  }
  const left = [...rect.keys()].sort((a, b) => a - b);
  return { ok: true, parcels: list.map((p) => p.id), merges, rect, estate: left.length > 1 ? left : [] };
}
const fits = (u: { w: number; h: number } | null) => !!u && u.w <= MAX_PARCEL_EDGE && u.h <= MAX_PARCEL_EDGE;

export interface ParcelEnv {
  isWater(x: number, y: number): boolean;
  /** the door tile of the structure covering a tile (the tile itself when none); absent: not checked (the client's preview) */
  doorOf?(x: number, y: number): [number, number];
  /** a name for whatever stands at a door, for the refusal */
  nameAt?(x: number, y: number): string;
}
export type SplitPlan =
  | { ok: true; keep: { x: number; y: number; w: number; h: number }; part: { x: number; y: number; w: number; h: number }; side: 'east' | 'south' }
  | { ok: false; reason: string };

/**
 * Split a parcel by a straight cut along a tile boundary: `axis` 'x' cuts at x = at (a north-south line), 'y' at
 * y = at. The west or north part keeps the parcel; both must keep a dry tile, and no building may straddle the cut.
 */
export function planSplit(p: ParcelRect, axis: 'x' | 'y', at: number, env: ParcelEnv): SplitPlan {
  at = Math.round(at);
  const lo = axis === 'x' ? p.x : p.y, len = axis === 'x' ? p.w : p.h;
  if (!(at > lo && at < lo + len)) return { ok: false, reason: len < 2 ? 'That parcel is one tile across: there is nothing to split' : 'Drag the cut across the parcel' };
  const keep = axis === 'x' ? { x: p.x, y: p.y, w: at - p.x, h: p.h } : { x: p.x, y: p.y, w: p.w, h: at - p.y };
  const part = axis === 'x' ? { x: at, y: p.y, w: p.x + p.w - at, h: p.h } : { x: p.x, y: at, w: p.w, h: p.y + p.h - at };
  const dry = (r: typeof keep) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!env.isWater(x, y)) return true; return false; };
  if (!dry(keep) || !dry(part)) return { ok: false, reason: 'Each part must keep some dry land' };
  if (env.doorOf) {
    // a structure across the cut has tiles in both rows beside it, each on the other side from its door
    const span = axis === 'x' ? p.h : p.w;
    for (let i = 0; i < span; i++) for (const side of [at - 1, at]) {
      const [x, y] = axis === 'x' ? [side, p.y + i] : [p.x + i, side];
      const [dx, dy] = env.doorOf(x, y);
      const doorSide = axis === 'x' ? dx >= at : dy >= at;
      if (doorSide !== side >= at) return { ok: false, reason: `The cut runs through ${env.nameAt?.(dx, dy) ?? 'a building'} at (${dx}, ${dy})` };
    }
  }
  return { ok: true, keep, part, side: axis === 'x' ? 'east' : 'south' };
}

/**
 * What a building cost to make (docs/world-map.md "Book value"): a placed kind its price, a grown one its zoning and
 * the builders' work to its level at the construction fee.
 */
export function buildingValue(kindId: number, level: number): number {
  const k = kindId * 8 + (level & 7);
  let v = VALUES[k];
  if (v === undefined) VALUES[k] = v = valueOf(kindId, level & 7);
  return v;
}
const VALUES: number[] = [];
function valueOf(kindId: number, level: number): number {
  if (!isGrowableId(kindId)) return CIVIC_COST[kindId] ?? 0;
  const fp = footprintOf(kindId);
  let work = 0;
  for (let l = 1; l <= level; l++) work += workOf(kindId, l);
  return fp.w * fp.h * ZONE_COST + work * CONSTRUCTION_FEE;
}
