import { isRoad, terrainOf, Terrain } from './tile';
import { hash2 } from './noise';
import { TICKS_PER_HOUR } from './constants';

/**
 * Road bridges over water (docs/structures.md "Bridges", docs/aux-layer.md). A **deck tile** is a water tile with the
 * road bit set; its aux byte says which way the deck runs and how it is built:
 *
 *   0xd8 | style << 1 | ns   (0xd8-0xdf)   ns: 1 when the deck runs north-south (along y), 0 east-west
 *                                          style: BridgeStyle, chosen when the bridge is laid
 *
 * No tile was water and road before bridges, and no aux byte was in 0xd8-0xdf, so old worlds read as they did. To the
 * router and the traffic model a deck tile is a plain straight road: the road tool lays a bridge only as a straight run
 * of water between two road tiles on land (its **landings**), never with a road joining it from the side, so every
 * deck tile has exactly its two neighbours along the deck as roads. Routers still only step along the deck from a deck
 * tile (junctionStepOk), so nothing beside a deck (a lot on a ragged bank) is ever reached from it, and a deck is no
 * lot's road access (World.hasRoadAccess). The world stays flat: the deck's rise, the ramps on the landings and the
 * piers are drawn by the client (render/bridges.ts), which lifts cars and walkers to the deck with its roadY hook.
 *
 * Boats (docs/boats.md) pass under a deck only across it, on its channel (bridgeChannel), and only when their air
 * draft is under the style's BRIDGE_CLEARANCE; a bascule span is the one that can open (its lifts: basculeLiftAt).
 */
export const BRIDGE_AUX = 0xd8;
export const BridgeStyle = { Arch: 0, Girder: 1, Suspension: 2, Bascule: 3 } as const;
export type BridgeStyleId = (typeof BridgeStyle)[keyof typeof BridgeStyle];
export const BRIDGE_STYLE_NAMES = ['stone arch bridge', 'steel girder bridge', 'suspension bridge', 'bascule bridge'] as const;
export const isBridgeAux = (a: number) => (a & 0xf8) === BRIDGE_AUX;
/** The deck runs north-south (along y). */
export const bridgeNS = (a: number) => (a & 1) === 1;
export const bridgeStyle = (a: number): BridgeStyleId => ((a >> 1) & 3) as BridgeStyleId;
export const bridgeAux = (ns: boolean, style: number) => BRIDGE_AUX | ((style & 3) << 1) | (ns ? 1 : 0);
/** Is this tile word and aux byte a bridge deck tile? */
export const isDeck = (tile: number | undefined, aux: number) => tile !== undefined && isRoad(tile) && isBridgeAux(aux);

/** The longest bridge the road tool lays, in deck tiles. */
export const BRIDGE_MAX_SPAN = 12;
/** Per deck tile, on top of nothing: a bridge is far dearer than road on land ($10 a tile). */
export const BRIDGE_TILE_COST = 120;
/** Deck height above the water, in tiles, by style (a car is about 0.12 tall). The bascule matches Tower Bridge's deck. */
export const BRIDGE_DECK_H: readonly number[] = [0.18, 0.22, 0.26, 0.25];
export const bridgeDeckH = (style: number) => BRIDGE_DECK_H[style & 3];
/**
 * Clear height under a deck over its channel, in tiles, by style (docs/boats.md section 3): a boat passes under when
 * its air draft is less than this. The arch's crown and the girders' plates sit below the deck; a bascule open stands
 * clear of everything (waterways.ts passSig).
 */
export const BRIDGE_CLEARANCE: readonly number[] = [0.12, 0.13, 0.21, 0.20];
export const bridgeClearance = (style: number) => BRIDGE_CLEARANCE[style & 3];

/**
 * The style a new bridge gets from its span and a hash of where it starts: short crossings are mostly stone arches,
 * middling ones arches or girders, long ones mostly suspension. A bascule is never picked: it is a scenario's choice
 * (Tower Bridge).
 */
export function chooseBridgeStyle(span: number, x: number, y: number): BridgeStyleId {
  const h = hash2(x * 41 + 7, y * 23 + 3);
  if (span <= 3) return h < 0.75 ? BridgeStyle.Arch : BridgeStyle.Girder;
  if (span <= 7) return h < 0.45 ? BridgeStyle.Arch : h < 0.9 ? BridgeStyle.Girder : BridgeStyle.Suspension;
  return h < 0.6 ? BridgeStyle.Suspension : h < 0.85 ? BridgeStyle.Girder : BridgeStyle.Arch;
}

/** A whole bridge: its first deck tile (lowest x or y), the step along it, its length and style. */
export interface BridgeSpan { x0: number; y0: number; dx: number; dy: number; len: number; ns: boolean; style: BridgeStyleId }
/**
 * The span a deck tile belongs to, walking along the deck both ways while the deck tiles agree (axis and style).
 * Unloaded tiles (aux 0) end the walk, so a client may see a shorter span until the next chunk arrives.
 */
export function bridgeSpanAt(x: number, y: number, aux: (x: number, y: number) => number): BridgeSpan | null {
  const a = aux(x, y);
  if (!isBridgeAux(a)) return null;
  const ns = bridgeNS(a), dx = ns ? 0 : 1, dy = ns ? 1 : 0;
  let lo = 0, hi = 0;
  while (lo < BRIDGE_MAX_SPAN * 2 && aux(x - dx * (lo + 1), y - dy * (lo + 1)) === a) lo++;
  while (hi < BRIDGE_MAX_SPAN * 2 && aux(x + dx * (hi + 1), y + dy * (hi + 1)) === a) hi++;
  return { x0: x - dx * lo, y0: y - dy * lo, dx, dy, len: lo + hi + 1, ns, style: bridgeStyle(a) };
}

/** May a router step from tile A (aux a) to its neighbour B? From a deck tile only along the deck. */
export const bridgeStepOk = (a: number, ax: number, ay: number, bx: number, by: number) => (bridgeNS(a) ? bx === ax : by === ay);
/** May a boat step between a deck tile (aux a) at A and its neighbour B, either way? Only across the deck. */
export const waterStepOk = (a: number, ax: number, ay: number, bx: number, by: number) => (bridgeNS(a) ? by === ay : bx === ax);
/**
 * The deck tiles boats pass under: the middle one of an odd span, the middle two of an even one. render/bridges.ts
 * keeps an arch's crown, or the clear span between piers, over them.
 */
export function bridgeChannel(s: BridgeSpan): [number, number][] {
  const m = (s.len - 1) >> 1, out: [number, number][] = [[s.x0 + s.dx * m, s.y0 + s.dy * m]];
  if (s.len % 2 === 0) out.push([s.x0 + s.dx * (m + 1), s.y0 + s.dy * (m + 1)]);
  return out;
}

export interface BridgeEnv {
  tile(x: number, y: number): number | undefined;
  aux(x: number, y: number): number;
  /** null when the player may lay road here, else the reason why not */
  land(x: number, y: number): string | null;
}
export interface BridgePlan {
  ok: boolean; reason?: string;
  /** deck tiles to write, flat [x, y, aux, ...]; tiles already deck of this bridge are left out */
  tiles?: number[];
  cost?: number;
  style?: BridgeStyleId;
}
const roadAt = (env: BridgeEnv, x: number, y: number) => { const t = env.tile(x, y); return t !== undefined && isRoad(t); };
const wetAt = (env: BridgeEnv, x: number, y: number) => { const t = env.tile(x, y); return t !== undefined && terrainOf(t) === Terrain.Water; };

/**
 * A bridge over the straight run of `len` water tiles from (x0, y0) stepping (dx, dy) (one of the four unit steps).
 * The tiles before and after the run along it are its landings: dry, loaded and road (the road tool lays them first).
 * Every tile of the run must be water with nothing on it (or already this bridge's deck), and no road may touch the
 * run from the side. `style` forces a style (scenarios); otherwise an existing deck keeps its own and a new one gets
 * chooseBridgeStyle.
 */
export function planBridge(x0: number, y0: number, dx: number, dy: number, len: number, env: BridgeEnv, style?: BridgeStyleId): BridgePlan {
  if (Math.abs(dx) + Math.abs(dy) !== 1) return { ok: false, reason: 'A bridge runs straight across the water' };
  if (len < 1) return { ok: false, reason: 'Nothing to bridge' };
  if (len > BRIDGE_MAX_SPAN) return { ok: false, reason: `Too wide to bridge: at most ${BRIDGE_MAX_SPAN} tiles of water` };
  // number the run from its low end, so the aux bytes and the style do not depend on the way it was dragged
  if (dx < 0 || dy < 0) { x0 += dx * (len - 1); y0 += dy * (len - 1); dx = -dx; dy = -dy; }
  const ns = dy !== 0;
  for (const [lx, ly] of [[x0 - dx, y0 - dy], [x0 + dx * len, y0 + dy * len]]) {
    const t = env.tile(lx, ly);
    if (t === undefined) return { ok: false, reason: 'Too close to the edge of the loaded map' };
    if (wetAt(env, lx, ly)) return { ok: false, reason: 'A bridge must reach dry land at both ends' };
    if (!isRoad(t)) return { ok: false, reason: 'A bridge must land on a road at both ends' };
    const la = env.aux(lx, ly);
    if (la >= 0xf0) return { ok: false, reason: 'A bridge cannot land on a roundabout or flyover' };
  }
  let existing = -1;
  const tiles: number[] = [];
  for (let i = 0; i < len; i++) {
    const x = x0 + dx * i, y = y0 + dy * i;
    if (!wetAt(env, x, y)) return { ok: false, reason: 'A bridge crosses one stretch of water: land in the middle' };
    const a = env.aux(x, y);
    if (isBridgeAux(a)) {
      if (bridgeNS(a) !== ns) return { ok: false, reason: 'Bridges cannot cross each other' };
      existing = a; continue;
    }
    if (a) return { ok: false, reason: 'Something is in the water there' };
    for (const s of [-1, 1]) if (roadAt(env, x + dy * s, y + dx * s)) return { ok: false, reason: 'No road may join a bridge from the side' };
    const why = env.land(x, y);
    if (why) return { ok: false, reason: why };
    tiles.push(x, y, 0);
  }
  const st = style ?? (existing >= 0 ? bridgeStyle(existing) : chooseBridgeStyle(len, x0, y0));
  const a = bridgeAux(ns, st);
  for (let i = 2; i < tiles.length; i += 3) tiles[i] = a;
  return { ok: true, tiles, cost: (tiles.length / 3) * BRIDGE_TILE_COST, style: st };
}

/**
 * Is a road on the land tile (x, y) refused because it would join a bridge from the side? A road may meet a deck only
 * at its ends, in line with it.
 */
export function joinsBridgeSide(x: number, y: number, aux: (x: number, y: number) => number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const a = aux(x + dx, y + dy);
    if (isBridgeAux(a) && bridgeNS(a) === (dx !== 0)) return true;
  }
  return false;
}

// ---- bascule lifts (Tower Bridge) -----------------------------------------------------------------------

/**
 * A bascule span lifts its leaves a few times a day for a passing barge, on a schedule that is a pure function of the
 * game clock and the span (its first deck tile), so the server's barriers and every client's leaves agree. One lift:
 * the leaves rise over BASCULE_RAISE hours, stand open BASCULE_HOLD, come down over BASCULE_RAISE. The barriers on
 * the approaches close BASCULE_CLOSE_BEFORE hours ahead (long enough for a walker on the span to get off it; nobody
 * new goes on, anyone caught drives or walks off) and open BASCULE_OPEN_AFTER the leaves are down. To the traffic
 * model a bascule deck tile is a level crossing whose barriers are these (sim/traffic.ts).
 */
export const BASCULE_RAISE = 0.1, BASCULE_HOLD = 0.3, BASCULE_LIFT = 2 * BASCULE_RAISE + BASCULE_HOLD;
export const BASCULE_CLOSE_BEFORE = 0.25, BASCULE_OPEN_AFTER = 0.05;
/** The schedule seed of the bascule span whose first deck tile is (x0, y0) (a placed Tower Bridge: its anchor). */
export const basculeSeed = (x0: number, y0: number) => x0 * 7919 + y0 * 104729;
/**
 * The start (game hours since day 0) of the lift whose window [start - before, start + BASCULE_LIFT + after) holds
 * `hours`, or NaN. Each span lifts 0-3 times a day, starting between 07:00 and 21:00, at its own hours.
 */
export function basculeLiftAt(seed: number, hours: number, before = 0, after = 0): number {
  const day = Math.floor(hours / 24);
  for (const d of [day, day - 1]) {
    for (const start of basculeLifts(seed, d)) if (hours >= start - before && hours < start + BASCULE_LIFT + after) return start;
  }
  return NaN;
}
/** The start hours (game hours since day 0) of a span's lifts on `day`, in schedule order (not sorted): 0-3 of them. */
export function basculeLifts(seed: number, day: number): number[] {
  const n = Math.floor(hash2(seed + day * 13, 7) * 3.6), out: number[] = [];
  for (let k = 0; k < n; k++) out.push(day * 24 + 7 + 14 * hash2(seed + day * 31 + k * 5, 19));
  return out;
}
/** How far the leaves are open (0 shut, 1 fully up) at `hours`. */
export function basculeOpen(seed: number, hours: number): number {
  const start = basculeLiftAt(seed, hours);
  if (Number.isNaN(start)) return 0;
  const u = hours - start, e = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
  return u < BASCULE_RAISE ? e(u / BASCULE_RAISE) : u < BASCULE_RAISE + BASCULE_HOLD ? 1 : 1 - e((u - BASCULE_RAISE - BASCULE_HOLD) / BASCULE_RAISE);
}
/** Are the barriers of a bascule span closed at `hours`? */
export const basculeClosed = (seed: number, hours: number) => !Number.isNaN(basculeLiftAt(seed, hours, BASCULE_CLOSE_BEFORE, BASCULE_OPEN_AFTER));
/** Is the deck tile (x, y) part of a bascule span whose barriers are closed at `tick`? */
export function basculeBarrierAt(x: number, y: number, aux: (x: number, y: number) => number, tick: number): boolean {
  const a = aux(x, y);
  if (!isBridgeAux(a) || bridgeStyle(a) !== BridgeStyle.Bascule) return false;
  const s = bridgeSpanAt(x, y, aux)!;
  return basculeClosed(basculeSeed(s.x0, s.y0), tick / TICKS_PER_HOUR);
}
