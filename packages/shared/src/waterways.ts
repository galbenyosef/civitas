import { terrainOf, Terrain } from './tile';
import { CHUNK_SIZE } from './constants';
import { hash2 } from './noise';
import { isBridgeAux, bridgeStyle, bridgeSpanAt, bridgeChannel, waterStepOk, bridgeClearance, basculeSeed, BridgeStyle, BRIDGE_STYLE_NAMES } from './bridges';

/**
 * Waterways (docs/boats.md section 2): where boats may go, how much room they have, and the lanes they sail.
 *
 *  - **Navigable** water is a water tile with nothing on it, or a bridge deck. Harbour footprints over water carry
 *    part bytes, so to every other boat they are land.
 *  - **Clearance** is the 4-neighbour (L1) distance to the nearest tile that is not navigable, capped at 4: across a
 *    4-wide river it reads 1, 2, 2, 1. A boat type's width class asks for a minimum (WIDTH_CLEARANCE).
 *  - A boat crosses a deck only across it, on its channel (bridges.ts bridgeChannel), and only under a style its
 *    **pass signature** clears (passSig): one bit per style it clears when closed, and PASS_LIFT for "may lift a
 *    bascule".
 *  - A **lane** is a 4-connected tile path found by A* (waterLane), sent as a WaterRoute: the rail route encoding
 *    (start, entry side, an exit side per tile) plus a clearance digit per tile and the decks it passes under. Lanes
 *    are derived on the server only; waterGeometry turns one into the line a boat sails, from the route alone, so the
 *    server and every client agree without loading a chunk.
 *
 * Nothing here imports rail.ts: routes are expanded here, so rail can hand water routes to waterGeometry.
 */

// ---- the water grid --------------------------------------------------------------------------------
/** What the water grid reads. The server's reads World.peekTile and falls back to the terrain sampler. */
export interface WaterEnv {
  tile(x: number, y: number): number | undefined;
  aux(x: number, y: number): number;
}
/** Is a tile with this word and aux byte open to boats? Water with no aux byte, or a bridge deck. */
export const navigableTile = (tile: number | undefined, aux: number) => tile !== undefined && terrainOf(tile) === Terrain.Water && (aux === 0 || isBridgeAux(aux));
export const navigable = (env: WaterEnv, x: number, y: number) => navigableTile(env.tile(x, y), env.aux(x, y));
/** Clearance stops counting here: 4 is open water. */
export const CLEARANCE_MAX = 4;
/** The clearance a width class needs. */
export const WIDTH_CLEARANCE = { narrow: 1, river: 2, open: 3 } as const;
export type WidthClass = keyof typeof WIDTH_CLEARANCE;

/** sides in RAIL_SIDES order: 0 N (-y), 1 E (+x), 2 S (+y), 3 W (-x) */
const SIDES: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const opp = (s: number) => (s + 2) & 3;
const key = (x: number, y: number) => (x + 0x8000) * 65536 + (y + 0x8000);

/** L1 distance from (x, y) to the nearest tile failing `ok`, capped at CLEARANCE_MAX (0 when (x, y) fails). */
function ringDistance(x: number, y: number, ok: (x: number, y: number) => boolean): number {
  if (!ok(x, y)) return 0;
  for (let d = 1; d < CLEARANCE_MAX; d++) {
    for (let k = 0; k < d; k++) {
      if (!ok(x + k, y - d + k) || !ok(x + d - k, y + k) || !ok(x - k, y + d - k) || !ok(x - d + k, y - k)) return d;
    }
  }
  return CLEARANCE_MAX;
}
/** Clearance at (x, y), uncached (reads at most 25 tiles): for one-off checks such as a harbour's fairway. */
export const clearanceAt = (env: WaterEnv, x: number, y: number) => ringDistance(x, y, (tx, ty) => navigable(env, tx, ty));

/**
 * The water grid with its clearance cached per chunk (a Uint8Array of CHUNK_SIZE², from a two-pass distance
 * transform over the chunk and a CLEARANCE_MAX margin, so it is exact). The owner calls `invalidate` for any terrain
 * or aux byte that changes (a bridge, a harbour, a scenario painting water); it drops every chunk within reach.
 */
export class WaterGrid {
  private chunks = new Map<number, Uint8Array>();
  private channels = new Map<number, boolean>();
  constructor(readonly env: WaterEnv) {}
  navigable(x: number, y: number) { return navigable(this.env, x, y); }
  clearance(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE);
    const k = key(cx, cy);
    let c = this.chunks.get(k);
    if (!c) {
      if (this.chunks.size >= 4096) this.chunks.clear();
      c = this.fill(cx, cy);
      this.chunks.set(k, c);
    }
    return c[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)];
  }
  /** Is (x, y) a deck tile on its bridge's channel? */
  channel(x: number, y: number): boolean {
    const k = key(x, y);
    let v = this.channels.get(k);
    if (v === undefined) {
      const aux = (tx: number, ty: number) => this.env.aux(tx, ty);
      const span = bridgeSpanAt(x, y, aux);
      v = !!span && bridgeChannel(span).some(([cx, cy]) => cx === x && cy === y);
      this.channels.set(k, v);
    }
    return v;
  }
  /** Drop what a change at (x, y) may have altered. */
  invalidate(x: number, y: number) {
    const m = CLEARANCE_MAX;
    for (let cy = Math.floor((y - m) / CHUNK_SIZE); cy <= Math.floor((y + m) / CHUNK_SIZE); cy++)
      for (let cx = Math.floor((x - m) / CHUNK_SIZE); cx <= Math.floor((x + m) / CHUNK_SIZE); cx++) this.chunks.delete(key(cx, cy));
    this.channels.clear();
  }
  clear() { this.chunks.clear(); this.channels.clear(); }
  private fill(cx: number, cy: number): Uint8Array {
    const m = CLEARANCE_MAX, W = CHUNK_SIZE + 2 * m, x0 = cx * CHUNK_SIZE - m, y0 = cy * CHUNK_SIZE - m;
    const d = new Uint8Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) d[j * W + i] = this.navigable(x0 + i, y0 + j) ? m : 0;
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      let v = d[j * W + i];
      if (i > 0 && d[j * W + i - 1] + 1 < v) v = d[j * W + i - 1] + 1;
      if (j > 0 && d[(j - 1) * W + i] + 1 < v) v = d[(j - 1) * W + i] + 1;
      d[j * W + i] = v;
    }
    for (let j = W - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      let v = d[j * W + i];
      if (i < W - 1 && d[j * W + i + 1] + 1 < v) v = d[j * W + i + 1] + 1;
      if (j < W - 1 && d[(j + 1) * W + i] + 1 < v) v = d[(j + 1) * W + i] + 1;
      d[j * W + i] = v;
    }
    const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lx = 0; lx < CHUNK_SIZE; lx++) out[ly * CHUNK_SIZE + lx] = d[(ly + m) * W + lx + m];
    return out;
  }
  /**
   * Room for shortcuts at (x, y): clearance counting decks as obstacles too (0 on a deck). A route carries it per
   * tile, so waterGeometry knows, from the route alone, which tiles off it are clear water.
   */
  room(x: number, y: number): number {
    return ringDistance(x, y, (tx, ty) => this.navigable(tx, ty) && !isBridgeAux(this.env.aux(tx, ty)));
  }
}

// ---- bridges and pass signatures --------------------------------------------------------------------
/** Pass-signature bit: the boat may have a bascule lifted for it (bits 0-3: the styles it clears when closed). */
export const PASS_LIFT = 16;
/** Every bridge, closed or lifted. */
export const PASS_ALL = 31;
/** A boat's pass signature from its air draft: a style is cleared when the air draft is under its clearance. */
export function passSig(airDraft: number, lifts = true): number {
  let sig = 0;
  for (let s = 0; s < 4; s++) if (airDraft < bridgeClearance(s)) sig |= 1 << s;
  if (lifts && !(sig & (1 << BridgeStyle.Bascule))) sig |= PASS_LIFT;
  return sig;
}
/** Can a boat of this signature pass under a deck of this style: true, 'lift' (only while a bascule is up), or false. */
export function passUnder(sig: number, style: number): boolean | 'lift' {
  if (sig & (1 << (style & 3))) return true;
  return style === BridgeStyle.Bascule && (sig & PASS_LIFT) !== 0 ? 'lift' : false;
}

// ---- sea gates and open water ----------------------------------------------------------------------
/** Where a body of water leaves the playable world: boats fade in and out here (scenario worlds declare them). */
export interface SeaGate { x: number; y: number; name: string; low?: boolean }
/** A `low` gate (an upper river) only lets through boats of this air draft or less. */
export const SEA_GATE_LOW_AIR = 0.11;
/** Boats fade in and out over this many tiles at a gate. */
export const SEA_GATE_FADE = 4;
export const gateServes = (g: SeaGate, airDraft: number) => !g.low || airDraft <= SEA_GATE_LOW_AIR;
/**
 * Where a lane of this class may end at a gate: the tiles within SEA_GATE_FADE of it (L1) with the class's clearance
 * and no deck, nearest first. A gate where the water meets the world's edge has little room on the tile itself.
 */
export function seaGateGoals(grid: WaterGrid, g: { x: number; y: number }, cls: WidthClass): [number, number][] {
  const out: [number, number, number][] = [];
  for (let dy = -SEA_GATE_FADE; dy <= SEA_GATE_FADE; dy++) for (let dx = -SEA_GATE_FADE; dx <= SEA_GATE_FADE; dx++) {
    const d = Math.abs(dx) + Math.abs(dy), x = g.x + dx, y = g.y + dy;
    if (d > SEA_GATE_FADE || grid.clearance(x, y) < WIDTH_CLEARANCE[cls] || isBridgeAux(grid.env.aux(x, y))) continue;
    out.push([x, y, d]);
  }
  return out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]).map(([x, y]) => [x, y]);
}
/** A body this big (navigable tiles) is open water reaching the sea, in a world with no declared gates. */
export const OPEN_SEA_TILES = 1500;
/** The offing (the open water's own gate) is at least this far out by water, when the fill gets that far. */
export const OFFING_MIN = 30;

/**
 * Is the water at (x, y) open water? A breadth-first fill over navigable tiles stops at OPEN_SEA_TILES, so it never
 * reads more than that. Open water gets an **offing**, its derived sea gate: a filled tile that is not a deck,
 * preferring one OFFING_MIN or more out by water, then the most room (up to the open class), then the farthest.
 */
export function openWater(grid: WaterGrid, x: number, y: number): { open: boolean; tiles: number; offing?: [number, number] } {
  if (!grid.navigable(x, y)) return { open: false, tiles: 0 };
  const xs = [x], ys = [y], depth = [0], seen = new Set([key(x, y)]);
  for (let h = 0; h < xs.length && xs.length < OPEN_SEA_TILES; h++) {
    for (const [dx, dy] of SIDES) {
      const nx = xs[h] + dx, ny = ys[h] + dy, k = key(nx, ny);
      if (seen.has(k) || !grid.navigable(nx, ny)) continue;
      seen.add(k); xs.push(nx); ys.push(ny); depth.push(depth[h] + 1);
      if (xs.length >= OPEN_SEA_TILES) break;
    }
  }
  if (xs.length < OPEN_SEA_TILES) return { open: false, tiles: xs.length };
  let best = -1, score = -1;
  for (let i = 0; i < xs.length; i++) {
    if (isBridgeAux(grid.env.aux(xs[i], ys[i]))) continue;
    const s = (depth[i] >= OFFING_MIN ? 1e6 : 0) + Math.min(grid.clearance(xs[i], ys[i]), WIDTH_CLEARANCE.open) * 1e4 + depth[i];
    if (s > score) { score = s; best = i; }
  }
  return { open: true, tiles: xs.length, offing: best >= 0 ? [xs[best], ys[best]] : undefined };
}

// ---- lanes ---------------------------------------------------------------------------------------------
/** What a lane is for (docs/boats.md section 2.2). */
export type LanePurpose = 'sea' | 'cruise' | 'grounds' | 'river' | 'through';
/**
 * A lane's tiles, encoded like rail.ts RailRoute: the start tile, the side it is entered by, the exit side of every
 * tile as digits 0-3. A loop's last tile leads back into the first. Per tile, `room` is a digit 0-4 (WaterGrid.room:
 * 0 exactly on a deck); `bridges` lists the decks passed under, by route index, with the span's style and first
 * deck tile (basculeSeed of it times a bascule's lifts). `stops` (a ferry's berth rows) is optional, as on a RailRoute.
 */
export interface WaterRoute {
  x: number; y: number;
  entry: number;
  sides: string;
  room: string;
  loop: boolean;
  bridges: { k: number; style: number; x0: number; y0: number }[];
  stops?: { k: number; len: number }[];
}
/** A harbour's lane as the `harbours` message carries it. */
export interface WaterLane { purpose: LanePurpose; sig: number; cls: WidthClass; route: WaterRoute }
export type WaterTile = { x: number; y: number; i: number; o: number };
/** Expand a route into tiles with their entry and exit sides. */
export function waterTiles(r: Pick<WaterRoute, 'x' | 'y' | 'entry' | 'sides'>): WaterTile[] {
  const out: WaterTile[] = [];
  let x = r.x, y = r.y, i = r.entry;
  for (let k = 0; k < r.sides.length; k++) {
    const o = r.sides.charCodeAt(k) - 48;
    out.push({ x, y, i, o });
    x += SIDES[o][0]; y += SIDES[o][1]; i = opp(o);
  }
  return out;
}

/** Nodes an A* search may expand before it gives up. */
export const LANE_MAX_NODES = 20000;
/** Step costs: per step, keeping off the banks (scaled by how far under 3 the clearance is), per turn, per lift. */
export const LANE_COST = { step: 1, bank: 0.6, turn: 0.3, lift: 4 } as const;

export interface LaneOpts {
  cls: WidthClass;
  sig: number;
  /** the side the start tile is entered by (a boat leaving a berth heads away from it); omitted: any way out */
  entry?: number;
  /** the goal may not be entered by this side (a loop's seam: the boat must not come back in the way it left) */
  notIn?: number;
  maxNodes?: number;
}
export type LaneFail = { ok: false; reason: string; at?: [number, number]; why: 'bridge' | 'narrow' | 'unconnected' | 'far'; nodes: number };
export type LaneResult = { ok: true; route: WaterRoute; cost: number; nodes: number } | LaneFail;

/** May a boat of this class and signature enter (nx, ny) by stepping (dx, dy)? Returns the extra cost, or -1. */
function enterCost(grid: WaterGrid, nx: number, ny: number, dx: number, dy: number, minC: number, sig: number): number {
  const c = grid.clearance(nx, ny);
  if (c < minC) return -1;
  const a = grid.env.aux(nx, ny);
  let extra = 0;
  if (isBridgeAux(a)) {
    if (!waterStepOk(a, nx, ny, nx - dx, ny - dy) || !grid.channel(nx, ny)) return -1;
    const p = passUnder(sig, bridgeStyle(a));
    if (!p) return -1;
    if (p === 'lift') extra = LANE_COST.lift;
  }
  return extra + LANE_COST.bank * (3 - Math.min(c, 3)) / 3;
}

/** A tiny binary heap of node indices ordered by (f, insertion order), so equal costs pop the same on every run. */
class Heap {
  private f: number[] = []; private q: number[] = []; private n: number[] = [];
  private seq = 0;
  get size() { return this.n.length; }
  push(node: number, f: number) {
    const a = this.f, b = this.q, c = this.n;
    let i = c.length;
    a.push(f); b.push(this.seq++); c.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] < a[i] || (a[p] === a[i] && b[p] < b[i])) break;
      [a[p], a[i]] = [a[i], a[p]]; [b[p], b[i]] = [b[i], b[p]]; [c[p], c[i]] = [c[i], c[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.f, b = this.q, c = this.n, top = c[0];
    const lf = a.pop()!, lq = b.pop()!, ln = c.pop()!;
    if (c.length) {
      a[0] = lf; b[0] = lq; c[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < c.length && (a[l] < a[m] || (a[l] === a[m] && b[l] < b[m]))) m = l;
        if (r < c.length && (a[r] < a[m] || (a[r] === a[m] && b[r] < b[m]))) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [b[m], b[i]] = [b[i], b[m]]; [c[m], c[i]] = [c[i], c[m]];
        i = m;
      }
    }
    return top;
  }
}

type Search = { tiles: WaterTile[]; cost: number; nodes: number } | { tiles: null; nodes: number; budget: boolean };
/** A* over (tile, entry side): no reversing, straight across a deck, goals any of `to`. */
function search(grid: WaterGrid, from: [number, number], to: [number, number][], minC: number, sig: number, entry: number, notIn: number, maxNodes: number): Search {
  const goals = new Set(to.map(([x, y]) => key(x, y)));
  const h = (x: number, y: number) => { let b = Infinity; for (const [gx, gy] of to) b = Math.min(b, Math.abs(gx - x) + Math.abs(gy - y)); return b; };
  const nx: number[] = [], ny: number[] = [], ni: number[] = [], ng: number[] = [], parent: number[] = [];
  const best = new Map<number, number>(); // state key -> best g
  const heap = new Heap();
  const [sx, sy] = from;
  nx.push(sx); ny.push(sy); ni.push(entry); ng.push(0); parent.push(-1);
  heap.push(0, h(sx, sy));
  best.set(key(sx, sy) * 5 + (entry + 1), 0);
  let nodes = 0;
  while (heap.size) {
    const n = heap.pop();
    const x = nx[n], y = ny[n], i = ni[n], g = ng[n];
    if (g > best.get(key(x, y) * 5 + (i + 1))!) continue; // stale
    if (goals.has(key(x, y)) && (n > 0 ? i !== notIn : notIn < 0)) {
      // each tile is left by the side opposite the next one's entry; the goal straight on; a free start straight out
      const tiles: WaterTile[] = [];
      for (let m = n; m >= 0; m = parent[m]) tiles.push({ x: nx[m], y: ny[m], i: ni[m], o: 0 });
      tiles.reverse();
      for (let k = 0; k + 1 < tiles.length; k++) tiles[k].o = opp(tiles[k + 1].i);
      const z = tiles[tiles.length - 1];
      if (tiles.length === 1 && z.i < 0) z.i = 2;
      z.o = opp(z.i);
      if (tiles[0].i < 0) tiles[0].i = opp(tiles[0].o);
      return { tiles, cost: g, nodes };
    }
    if (++nodes > maxNodes) return { tiles: null, nodes, budget: true };
    const deck = isBridgeAux(grid.env.aux(x, y));
    for (let o = 0; o < 4; o++) {
      if (i >= 0 && o === i) continue; // no reversing
      if (deck && i >= 0 && o !== opp(i)) continue; // straight across a deck
      const [dx, dy] = SIDES[o];
      const tx = x + dx, ty = y + dy;
      const extra = enterCost(grid, tx, ty, dx, dy, minC, sig);
      if (extra < 0) continue;
      const turn = i >= 0 && o !== opp(i) ? LANE_COST.turn : 0;
      const tg = g + LANE_COST.step + extra + turn;
      const sk = key(tx, ty) * 5 + (opp(o) + 1);
      const prev = best.get(sk);
      if (prev !== undefined && prev <= tg) continue;
      best.set(sk, tg);
      nx.push(tx); ny.push(ty); ni.push(opp(o)); ng.push(tg); parent.push(n);
      heap.push(nx.length - 1, tg + h(tx, ty));
    }
  }
  return { tiles: null, nodes, budget: false };
}

/** Build the route a search found: exits, room digits and the decks passed under. */
function toRoute(grid: WaterGrid, tiles: WaterTile[], loop: boolean): WaterRoute {
  const aux = (x: number, y: number) => grid.env.aux(x, y);
  const bridges: WaterRoute['bridges'] = [];
  let room = '';
  tiles.forEach((t, k) => {
    room += String(grid.room(t.x, t.y));
    const a = aux(t.x, t.y);
    if (isBridgeAux(a)) { const s = bridgeSpanAt(t.x, t.y, aux)!; bridges.push({ k, style: s.style, x0: s.x0, y0: s.y0 }); }
  });
  return { x: tiles[0].x, y: tiles[0].y, entry: tiles[0].i, sides: tiles.map((t) => String(t.o)).join(''), room, loop, bridges };
}

/** Why no lane: retry with every bridge passable, then on any width, to name what is in the way. */
function explain(grid: WaterGrid, from: [number, number], to: [number, number][], minC: number, sig: number, o: LaneOpts, first: Extract<Search, { tiles: null }>): LaneFail {
  const max = o.maxNodes ?? LANE_MAX_NODES;
  let nodes = first.nodes;
  if (first.budget) return { ok: false, why: 'far', nodes, reason: 'too far by water (the search gave up)' };
  if ((sig & PASS_ALL) !== PASS_ALL) {
    const r = search(grid, from, to, minC, PASS_ALL, o.entry ?? -1, o.notIn ?? -1, max);
    nodes += r.nodes;
    if (r.tiles) for (const t of r.tiles) {
      const a = grid.env.aux(t.x, t.y);
      if (isBridgeAux(a) && !passUnder(sig, bridgeStyle(a))) return { ok: false, why: 'bridge', nodes, at: [t.x, t.y], reason: `the ${BRIDGE_STYLE_NAMES[bridgeStyle(a)]} at (${t.x}, ${t.y}) is too low` };
    }
  }
  if (minC > 1) {
    const r = search(grid, from, to, 1, PASS_ALL, o.entry ?? -1, o.notIn ?? -1, max);
    nodes += r.nodes;
    if (r.tiles) for (const t of r.tiles) {
      if (grid.clearance(t.x, t.y) < minC) return { ok: false, why: 'narrow', nodes, at: [t.x, t.y], reason: `the water is too narrow at (${t.x}, ${t.y})` };
    }
  }
  return { ok: false, why: 'unconnected', nodes, reason: 'not connected by water' };
}

/**
 * The lane from `from` to the nearest of `to` (one tile or several) for boats of a width class and pass signature.
 * Steps cost LANE_COST (1 each, more near the banks, per turn, per bascule lift); tiles under the class's clearance
 * and decks it cannot pass are refused, and so is any deck tile off its channel or crossed along. The search stops
 * at LANE_MAX_NODES. A refusal says what is in the way ("the steel girder bridge at (12, 44) is too low").
 */
export function waterLane(grid: WaterGrid, from: [number, number], to: [number, number] | [number, number][], o: LaneOpts): LaneResult {
  const goals = (typeof to[0] === 'number' ? [to] : to) as [number, number][];
  const minC = WIDTH_CLEARANCE[o.cls];
  if (!grid.navigable(from[0], from[1])) return { ok: false, why: 'unconnected', nodes: 0, at: from, reason: `no open water at (${from[0]}, ${from[1]})` };
  if (grid.clearance(from[0], from[1]) < minC) return { ok: false, why: 'narrow', nodes: 0, at: from, reason: `the water is too narrow at (${from[0]}, ${from[1]})` };
  const r = search(grid, from, goals, minC, o.sig, o.entry ?? -1, o.notIn ?? -1, o.maxNodes ?? LANE_MAX_NODES);
  if (!r.tiles) return explain(grid, from, goals, minC, o.sig, o, r);
  return { ok: true, route: toRoute(grid, r.tiles, false), cost: r.cost, nodes: r.nodes };
}

/**
 * Tiles reachable from `from` within `maxDepth` steps by water a boat of this class and signature may sail, in
 * breadth-first order (decks only straight across), with their depth. Reads at most `maxTiles` tiles.
 */
export function waterReach(grid: WaterGrid, from: [number, number], maxDepth: number, cls: WidthClass, sig: number, maxTiles = 12000): { x: number; y: number; d: number }[] {
  const minC = WIDTH_CLEARANCE[cls];
  const out = [{ x: from[0], y: from[1], d: 0 }], seen = new Set([key(from[0], from[1])]);
  for (let h = 0; h < out.length && out.length < maxTiles; h++) {
    const t = out[h];
    if (t.d >= maxDepth) continue;
    const a = grid.env.aux(t.x, t.y);
    for (const [dx, dy] of SIDES) {
      const x = t.x + dx, y = t.y + dy, k = key(x, y);
      if (seen.has(k)) continue;
      if (isBridgeAux(a) && !waterStepOk(a, t.x, t.y, x, y)) continue;
      if (enterCost(grid, x, y, dx, dy, minC, sig) < 0) continue;
      seen.add(k); out.push({ x, y, d: t.d + 1 });
    }
  }
  return out;
}

/** Fishing grounds within this many tiles by water, when the harbour has no sea gate. */
export const GROUNDS_RANGE = 60;
/** The tile of most room within GROUNDS_RANGE by water (not a deck); ties go to the farther, then the first found. */
export function fishingGrounds(grid: WaterGrid, from: [number, number], cls: WidthClass, sig: number): [number, number] | null {
  let best: [number, number] | null = null, score = -1;
  for (const t of waterReach(grid, from, GROUNDS_RANGE, cls, sig)) {
    if (isBridgeAux(grid.env.aux(t.x, t.y))) continue;
    const s = grid.clearance(t.x, t.y) * 1000 + t.d;
    if (s > score) { score = s; best = [t.x, t.y]; }
  }
  return best && (best[0] !== from[0] || best[1] !== from[1]) ? best : null;
}

/** Cruise waypoints are chosen within this many tiles by water, this far apart (and from the start). */
export const CRUISE_RANGE = 40, CRUISE_SPACING = 6;
/**
 * 1-3 waypoints for a pleasure cruise, hashed from `seed`: tiles of clearance 2 or more (or the class's own, on
 * narrower water) within CRUISE_RANGE by water, CRUISE_SPACING or more apart, visited nearest first.
 */
export function cruiseWaypoints(grid: WaterGrid, from: [number, number], seed: number, cls: WidthClass, sig: number): [number, number][] {
  const reach = waterReach(grid, from, CRUISE_RANGE, cls, sig).filter((t) => !isBridgeAux(grid.env.aux(t.x, t.y)));
  const want = Math.max(2, WIDTH_CLEARANCE[cls]);
  let cand = reach.filter((t) => grid.clearance(t.x, t.y) >= want);
  if (!cand.length) cand = reach;
  const n = 1 + Math.floor(hash2(seed, 71) * 3);
  const ranked = cand.map((t) => ({ t, h: hash2(seed * 31 + t.x * 7, t.y * 13 + 5) })).sort((a, b) => a.h - b.h || a.t.x - b.t.x || a.t.y - b.t.y);
  const far = (a: [number, number], b: { x: number; y: number }) => Math.abs(a[0] - b.x) + Math.abs(a[1] - b.y) >= CRUISE_SPACING;
  const picked: [number, number][] = [];
  for (const { t } of ranked) {
    if (picked.length >= n) break;
    if (far(from, t) && picked.every((p) => far(p, t))) picked.push([t.x, t.y]);
  }
  // nearest first from the start, then from each waypoint
  const out: [number, number][] = [];
  let at = from;
  while (picked.length) {
    let bi = 0, bd = Infinity;
    picked.forEach((p, i) => { const d = Math.abs(p[0] - at[0]) + Math.abs(p[1] - at[1]); if (d < bd) { bd = d; bi = i; } });
    at = picked.splice(bi, 1)[0];
    out.push(at);
  }
  return out;
}

/**
 * A closed tour from `from` through `waypoints` and back, as a loop route (its first tile is `from`). Each leg starts
 * the way the last one arrived, so the boat never turns on the spot; a waypoint no leg reaches is left out.
 */
export function cruiseLane(grid: WaterGrid, from: [number, number], waypoints: [number, number][], o: LaneOpts): LaneResult {
  let tiles: WaterTile[] = [];
  let at = from, entry = o.entry ?? -1, nodes = 0, cost = 0;
  const max = o.maxNodes ?? LANE_MAX_NODES;
  for (const w of waypoints) {
    const r = search(grid, at, [w], WIDTH_CLEARANCE[o.cls], o.sig, entry, -1, max);
    nodes += r.nodes;
    if (!r.tiles || r.tiles.length < 2) continue;
    if (tiles.length) { tiles[tiles.length - 1].o = r.tiles[0].o; tiles.push(...r.tiles.slice(1)); } else tiles = r.tiles;
    cost += r.cost; at = w; entry = r.tiles[r.tiles.length - 1].i;
  }
  if (!tiles.length) return { ok: false, why: 'unconnected', nodes, reason: 'no water to cruise' };
  const back = search(grid, at, [from], WIDTH_CLEARANCE[o.cls], o.sig, entry, tiles[0].o, max);
  nodes += back.nodes;
  if (!back.tiles) return { ok: false, why: back.budget ? 'far' : 'unconnected', nodes, reason: 'the cruise cannot get back to its start' };
  tiles[tiles.length - 1].o = back.tiles[0].o;
  tiles.push(...back.tiles.slice(1, -1));
  tiles[0].i = back.tiles[back.tiles.length - 1].i;
  return { ok: true, route: toRoute(grid, tiles, true), cost: cost + back.cost, nodes };
}

// ---- the sailing line ----------------------------------------------------------------------------------
/** One piece of a sailing line: a straight (r 0) or a circular arc, starting at arclength s0. */
export interface WaterPiece {
  s0: number; len: number;
  /** start point, and for a straight its unit direction */
  x0: number; z0: number; dx: number; dz: number;
  /** for an arc: radius, centre, start angle and signed sweep */
  r: number; cx: number; cz: number; a0: number; da: number;
  /** clearance the piece keeps at the least (for the keep-to-starboard offset) */
  c: number;
}
export interface WaterGeometry {
  route: WaterRoute;
  minC: number;
  tiles: WaterTile[];
  pieces: WaterPiece[];
  L: number;
  loop: boolean;
  /** arclength nearest each route tile's centre (exact on decks and stop rows) */
  tileS: Float64Array;
  /** each deck passed under: arclength where the line enters and leaves the deck tile, its style and lift seed */
  decks: { k: number; s0: number; s1: number; style: number; x0: number; y0: number; seed: number }[];
  /** per stop: the middle of its row */
  stopS: number[];
}

/** All tiles a segment between two points touches (both tiles where it passes exactly through a corner). */
function supercover(ax: number, az: number, bx: number, bz: number, visit: (x: number, y: number) => boolean): boolean {
  let x = Math.floor(ax), y = Math.floor(az);
  const ex = Math.floor(bx), ey = Math.floor(bz), dx = bx - ax, dz = bz - az;
  const sx = Math.sign(dx), sz = Math.sign(dz);
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? ((sx > 0 ? x + 1 : x) - ax) / dx : Infinity, tz = dz ? ((sz > 0 ? y + 1 : y) - az) / dz : Infinity;
  if (!visit(x, y)) return false;
  for (let guard = 0; (x !== ex || y !== ey) && guard < 4096; guard++) {
    if (Math.abs(tx - tz) < 1e-9) {
      if (!visit(x + sx, y) || !visit(x, y + sz)) return false;
      x += sx; y += sz; tx += tdx; tz += tdz;
    } else if (tx < tz) { x += sx; tx += tdx; } else { y += sz; tz += tdz; }
    if (!visit(x, y)) return false;
  }
  return true;
}

const geomCache = new Map<string, WaterGeometry>();
const ROUND_MAX = 1.5, ROUND_PER_C = 0.45, LOOKAHEAD = 48;
/**
 * The line a boat sails along a route, from the route alone (server and clients agree):
 *  - string-pulled through the tile centres: two are joined directly when the route between them moves steadily
 *    along the straight, and every tile the straight touches is a route tile or provably has the class's clearance (from the route's room digits: room r at a route tile means room
 *    r - d at L1 distance d); decks, the tiles either side of them and stop rows are kept, so a deck is crossed
 *    straight across its channel;
 *  - each corner rounded with radius min(0.45 × room, 1.5), smaller where the straights are short or the arc would
 *    leave clear water;
 *  - parametrised by arclength, from the first tile's centre to the last's (a loop back round to the first's).
 */
export function waterGeometry(route: WaterRoute, minC: number): WaterGeometry {
  const ck = `${route.x},${route.y},${route.entry},${route.loop ? 1 : 0},${route.sides},${route.room},${minC},${route.bridges.map((b) => `${b.k}:${b.style}:${b.x0}:${b.y0}`).join(';')},${(route.stops ?? []).map((s) => `${s.k}:${s.len}`).join(';')}`;
  const hit = geomCache.get(ck);
  if (hit) return hit;
  const tiles = waterTiles(route), n = tiles.length;
  const roomOf = (k: number) => route.room.charCodeAt(k) - 48;
  // what is known about tiles from the route: -1 a deck on it, 100 + room a route tile, else the room bound
  const known = new Map<number, number>();
  tiles.forEach((t, k) => {
    const r = roomOf(k);
    for (let d = 1; d < r; d++) for (let q = 0; q < d; q++) for (const [x, y] of [[t.x + q, t.y - d + q], [t.x + d - q, t.y + q], [t.x - q, t.y + d - q], [t.x - d + q, t.y - q]]) {
      const kk = key(x, y), v = known.get(kk) ?? 0;
      if (v >= 0 && v < 100 && r - d > v) known.set(kk, r - d);
    }
  });
  tiles.forEach((t, k) => { const r = roomOf(k); known.set(key(t.x, t.y), r === 0 ? -1 : 100 + r); });
  const ok = (x: number, y: number) => (known.get(key(x, y)) ?? 0) >= minC;
  const valueAt = (x: number, y: number) => { const v = known.get(key(x, y)) ?? 0; return v < 0 ? minC : v >= 100 ? Math.max(minC, v - 100) : v; };

  // points: tile centres 0..n-1, and for a loop index n is tile 0 again
  const last = route.loop ? n : n - 1;
  const P = (k: number) => { const t = tiles[k % n]; return [t.x + 0.5, t.y + 0.5] as const; };
  const fixed = new Uint8Array(last + 1);
  fixed[0] = 1; fixed[last] = 1;
  for (const b of route.bridges) for (const k of [b.k - 1, b.k, b.k + 1]) if (k >= 0 && k <= last) fixed[k] = 1;
  if (route.loop) for (const b of route.bridges) { if (b.k === 0) fixed[last - 1] = 1; if (b.k === n - 1) fixed[last] = 1; }
  for (const s of route.stops ?? []) for (let k = s.k; k < s.k + s.len && k <= last; k++) fixed[k] = 1;
  const segOk = (a: number, b: number) => {
    const [ax, az] = P(a), [bx, bz] = P(b);
    const ta = tiles[a % n], tb = tiles[b % n];
    return supercover(ax, az, bx, bz, (x, y) => ok(x, y) || ((known.get(key(x, y)) ?? 0) < 0 && ((x === ta.x && y === ta.y) || (x === tb.x && y === tb.y))));
  };
  // a shortcut from a to b must not cut off a detour or make a hairpin: the steps between them never go both ways
  // along an axis (so the route runs steadily along the straight, as a staircase or a corner does), the straight
  // turns no more than square from the way the boat came in (the last straight, else the step into a), and the
  // route's next step after b does not turn back against it
  const onward = (a: number, b: number, inX: number, inZ: number) => {
    const [ax, az] = P(a), [bx, bz] = P(b), l = Math.hypot(bx - ax, bz - az);
    if (l < 1e-9) return false;
    const ux = (bx - ax) / l, uz = (bz - az) / l;
    let used = 0;
    for (let k = a; k < b; k++) used |= 1 << tiles[k % n].o;
    if ((used & 5) === 5 || (used & 10) === 10) return false;
    if (ux * inX + uz * inZ < -1e-9) return false;
    if (b + 1 <= last || route.loop) {
      const [px, pz] = P(b + 1 <= last ? b + 1 : 1);
      if ((px - ax) * ux + (pz - az) * uz < l - 1e-9) return false;
    }
    return true;
  };
  const verts = [0];
  for (let i = 0; i < last;) {
    let stop = i + 1;
    while (stop < last && !fixed[stop]) stop++;
    const [ix, iz] = P(i);
    let inX = 0, inZ = 0;
    if (verts.length > 1) { const [px, pz] = P(verts[verts.length - 2]), l = Math.hypot(ix - px, iz - pz); inX = (ix - px) / l; inZ = (iz - pz) / l; }
    else if (i > 0 || route.loop) { const [px, pz] = P(i > 0 ? i - 1 : n - 1); inX = ix - px; inZ = iz - pz; }
    let j = i + 1, misses = 0;
    for (let c = i + 2; c <= Math.min(stop, i + LOOKAHEAD) && misses < 6; c++) {
      if (onward(i, c, inX, inZ) && segOk(i, c)) { j = c; misses = 0; } else misses++;
    }
    verts.push(j);
    i = j;
  }
  // round the corners
  type Corner = { tin: [number, number]; tout: [number, number]; r: number; cx: number; cz: number; a0: number; da: number };
  const corners: (Corner | null)[] = verts.map(() => null);
  const len = (a: readonly number[], b: readonly number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let m = 1; m + 1 < verts.length; m++) {
    const A = P(verts[m - 1]), B = P(verts[m]), C = P(verts[m + 1]);
    const lab = len(A, B), lbc = len(B, C);
    const u: [number, number] = [(B[0] - A[0]) / lab, (B[1] - A[1]) / lab], v: [number, number] = [(C[0] - B[0]) / lbc, (C[1] - B[1]) / lbc];
    const cross = u[0] * v[1] - u[1] * v[0], dot = u[0] * v[0] + u[1] * v[1];
    const phi = Math.atan2(Math.abs(cross), dot);
    if (phi < 1e-6 || phi > 3) continue;
    const tanh = Math.tan(phi / 2);
    let r = Math.min(ROUND_PER_C * Math.max(1, roomOf(verts[m] % n)), ROUND_MAX);
    r = Math.min(r, (Math.min(lab, lbc) / 2) / tanh);
    const ccw = cross > 0;
    for (let tries = 0; tries < 5 && r > 1e-3; tries++, r /= 2) {
      const t = r * tanh;
      const tin: [number, number] = [B[0] - u[0] * t, B[1] - u[1] * t], tout: [number, number] = [B[0] + v[0] * t, B[1] + v[1] * t];
      const nx = ccw ? -u[1] : u[1], nz = ccw ? u[0] : -u[0];
      const cx = tin[0] + nx * r, cz = tin[1] + nz * r, a0 = Math.atan2(tin[1] - cz, tin[0] - cx), da = (ccw ? 1 : -1) * phi;
      let good = true;
      for (let q = 1; q < 8 && good; q++) { const a = a0 + (da * q) / 8; good = ok(Math.floor(cx + r * Math.cos(a)), Math.floor(cz + r * Math.sin(a))); }
      if (good) { corners[m] = { tin, tout, r, cx, cz, a0, da }; break; }
    }
  }
  // pieces
  const pieces: WaterPiece[] = [];
  const vertS: number[] = verts.map(() => 0);
  let s = 0;
  const line = (a: readonly [number, number] | [number, number], b: readonly [number, number] | [number, number], c: number) => {
    const l = len(a, b);
    if (l < 1e-9) return;
    pieces.push({ s0: s, len: l, x0: a[0], z0: a[1], dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l, r: 0, cx: 0, cz: 0, a0: 0, da: 0, c });
    s += l;
  };
  const segC = (a: number, b: number) => {
    let c = CLEARANCE_MAX;
    const [ax, az] = P(a), [bx, bz] = P(b);
    supercover(ax, az, bx, bz, (x, y) => { c = Math.min(c, valueAt(x, y)); return true; });
    return c;
  };
  let cur: readonly [number, number] = P(verts[0]);
  for (let m = 1; m < verts.length; m++) {
    const c = segC(verts[m - 1], verts[m]);
    const k = corners[m];
    if (!k) { line(cur, P(verts[m]), c); vertS[m] = s; cur = P(verts[m]); continue; }
    line(cur, k.tin, c);
    const arc = k.r * Math.abs(k.da), vt = tiles[verts[m] % n];
    pieces.push({ s0: s, len: arc, x0: k.tin[0], z0: k.tin[1], dx: 0, dz: 0, r: k.r, cx: k.cx, cz: k.cz, a0: k.a0, da: k.da, c: valueAt(vt.x, vt.y) });
    vertS[m] = s + arc / 2;
    s += arc;
    cur = k.tout;
  }
  const L = s;
  // arclength per route tile: projected onto the straight between its vertices, interpolated between their arclengths
  const tileS = new Float64Array(n);
  for (let m = 0; m + 1 < verts.length; m++) {
    const a = verts[m], b = verts[m + 1], A = P(a), B = P(b), l = len(A, B);
    for (let k = a; k <= b && k < n; k++) {
      const p = P(k), f = l > 0 ? Math.min(1, Math.max(0, ((p[0] - A[0]) * (B[0] - A[0]) + (p[1] - A[1]) * (B[1] - A[1])) / (l * l))) : 0;
      tileS[k] = vertS[m] + (vertS[m + 1] - vertS[m]) * f;
    }
  }
  for (let k = 1; k < n; k++) if (tileS[k] < tileS[k - 1]) tileS[k] = tileS[k - 1];
  const decks = route.bridges.map((b) => ({ k: b.k, s0: tileS[b.k] - 0.5, s1: tileS[b.k] + 0.5, style: b.style, x0: b.x0, y0: b.y0, seed: basculeSeed(b.x0, b.y0) }));
  const stopS = (route.stops ?? []).map((st) => tileS[st.k] + (st.len - 1) / 2);
  const g: WaterGeometry = { route, minC, tiles, pieces, L, loop: route.loop, tileS, decks, stopS };
  if (geomCache.size > 256) geomCache.clear();
  geomCache.set(ck, g);
  return g;
}

/**
 * Point, heading (atan2(dz, dx)) and clearance on the sailing line at arclength S. A loop wraps; past the ends of an
 * open line it runs straight on.
 */
export function waterPoint(g: WaterGeometry, S: number, out: { x: number; z: number; h: number; c: number } = { x: 0, z: 0, h: 0, c: 0 }) {
  const ps = g.pieces;
  if (!ps.length) {
    const t = g.tiles[0];
    out.x = t.x + 0.5; out.z = t.y + 0.5; out.h = Math.atan2(SIDES[t.o][1], SIDES[t.o][0]); out.c = g.minC;
    return out;
  }
  if (g.loop) S = ((S % g.L) + g.L) % g.L;
  if (S < 0 || S > g.L) {
    const p = S < 0 ? ps[0] : ps[ps.length - 1];
    const end = S < 0 ? 0 : p.len, f = S < 0 ? S : S - g.L;
    pieceAt(p, end, out);
    out.x += Math.cos(out.h) * f; out.z += Math.sin(out.h) * f;
    return out;
  }
  let lo = 0, hi = ps.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid].s0 <= S) lo = mid; else hi = mid - 1; }
  return pieceAt(ps[lo], S - ps[lo].s0, out);
}
function pieceAt(p: WaterPiece, f: number, out: { x: number; z: number; h: number; c: number }) {
  out.c = p.c;
  if (p.r === 0) { out.x = p.x0 + p.dx * f; out.z = p.z0 + p.dz * f; out.h = Math.atan2(p.dz, p.dx); return out; }
  const a = p.a0 + p.da * Math.min(1, Math.max(0, f / p.len)), sg = Math.sign(p.da);
  out.x = p.cx + p.r * Math.cos(a); out.z = p.cz + p.r * Math.sin(a);
  out.h = Math.atan2(Math.cos(a) * sg, -Math.sin(a) * sg);
  return out;
}
/** Key of a route, for caches and change detection. */
export const waterRouteKey = (r: WaterRoute) => `${r.x},${r.y},${r.entry},${r.loop ? 1 : 0},${r.sides},${r.room}`;
