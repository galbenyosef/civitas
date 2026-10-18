import { KIND_ID } from './buildings/compiled';
import { isBuildable, isRoad, kindIdOf, levelOf, underConstruction, zoneOf } from './tile';
import { structureAt, FRONT } from './structures';
import {
  RAIL_SIDES, METRO_TIMING, oppSide, stopTile, alongSide, trackKey, routeTiles,
  type RailEnv, type RailLineDef, type RailRoute, type RailService, type StationStop, type TrackNet, type TrainState,
} from './rail';
import type { LineProblem } from './transit';

/**
 * Underground railways (docs/underground.md): the pure half, shared by the server, the client and the checks.
 *
 *  - **The under layer** is a fifth byte per tile that nothing on the surface reads. 0 is solid ground; 0x10 | mask
 *    is a tunnel, the mask holding the sides it leaves the tile by exactly as rail track does (N 1, E 2, S 4, W 8;
 *    4 sides is a crossover, straight on only); 0x30 | mask is a platform tile, a tunnel with a platform beside the
 *    track, always straight along the platform. Bit 6 is kept for a second depth level, 0x80 and up for later.
 *  - **Stations** are a 1×1 kiosk and a 2×1 hall on the surface with a straight platform of 4 or 6 tiles under the
 *    door, its middle tile (index ⌊N/2⌋) directly beneath it. `planPlatform` places it; `metroStationAt` finds it
 *    again from the tiles alone, from the door or from any platform tile.
 *  - **Lines** are bored by `planBore` (an A* over tile and heading that prefers existing tunnel, avoids other lines
 *    except straight across them at a crossover, and dislikes turns) and then routed through the layer by surface
 *    rail's own route search over `underNet`. Trains run rail's pure timetable with `metro` set (twin bores, tube
 *    stock, METRO timing).
 */

// ---- the under byte ---------------------------------------------------------------------------------
export const UNDER_TUNNEL = 0x10;
export const UNDER_PLATFORM = 0x30;
/** a tunnel at the first depth, platforms included */
export const isTunnel = (b: number) => (b & 0xd0) === UNDER_TUNNEL;
export const isPlatform = (b: number) => (b & 0xf0) === UNDER_PLATFORM;
/** the sides a tunnel leaves its tile by, as rail's railMask */
export const underMask = (b: number) => b & 15;
export const tunnelByte = (mask: number) => UNDER_TUNNEL | (mask & 15);
/** a platform tile: straight along x (E and W) or along y (N and S) */
export const platformByte = (alongX: boolean) => UNDER_PLATFORM | (alongX ? 10 : 5);
const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

// ---- tunables ---------------------------------------------------------------------------------------
/**
 * Everything the metro is tuned by. Timing (line speed, acceleration, dwells, trains) is rail's METRO_TIMING, which
 * the timetable reads; the boring search's step costs are fixed so the preview is what gets saved.
 */
export const METRO = {
  ...METRO_TIMING,
  /** riders a car carries, and the ticks a ride adds for the stairs and escalators */
  carRiders: 60, access: 3,
  /** platform tiles under a kiosk and under a hall */
  platform: { kiosk: 4, hall: 6 },
  /** money: a new tunnel tile, one under water, and a crossover bored across another line's tunnel */
  tunnelCost: 60, wetTunnelCost: 150, crossoverCost: 250,
  /** tunnel bored straight on past each terminus of a there-and-back line, where trains stand overnight */
  overrun: 2,
  stationsMin: 2, stationsMax: 16, linesPerOwner: 24,
  /** the boring search: node budget, box margin round the stations, and step costs */
  search: { budget: 40000, margin: 24, legs: 64, reuse: 1, fresh: 3, wet: 5, turn: 3, turnAgain: 6, crossover: 4 },
} as const;

// ---- kinds ------------------------------------------------------------------------------------------
export const METRO_ENTRANCE: number = (KIND_ID as Record<string, number>)['metro-entrance'] ?? 22;
export const METRO_STATION: number = (KIND_ID as Record<string, number>)['metro-station'] ?? 23;
export const isMetroStationKind = (id: number) => id === METRO_ENTRANCE || id === METRO_STATION;
/** platform tiles under a metro kind (0 for any other kind) */
export const metroPlatformLen = (kind: number) => (kind === METRO_ENTRANCE ? METRO.platform.kiosk : kind === METRO_STATION ? METRO.platform.hall : 0);

/**
 * The turn (FRONT index: 0 faces +y, 1 +x, 2 -y, 3 -x) a station is given when the player gave none: a kiosk faces the
 * first road beside it, south, east, west, north, as a 1×1 building is drawn; -1 with no road beside it. A hall takes
 * the turn planStructure gives its footprint.
 */
export function kioskTurn(x: number, y: number, tile: (x: number, y: number) => number | undefined): number {
  for (const r of [0, 1, 3, 2]) {
    const t = tile(x + FRONT[r][0], y + FRONT[r][1]);
    if (t !== undefined && isRoad(t)) return r;
  }
  return -1;
}
/** The platform runs along the street its entrance faces: along x for a turn facing south or north (`rot & 1` 0). */
export const platformAlongX = (rot: number) => (rot & 1) === 0;

/** What metro code reads: rail's tiles, aux and sub bytes, and the under layer (0 where solid or not loaded). */
export interface MetroEnv extends RailEnv {
  under(x: number, y: number): number;
}

// ---- stations ---------------------------------------------------------------------------------------
/** The metro kind whose door is (x, y) or whose footprint covers it, from the surface alone. */
function surfaceStation(x: number, y: number, env: RailEnv): { doorX: number; doorY: number; kind: number } | null {
  const t = env.tile(x, y);
  if (t === undefined) return null;
  if (env.aux(x, y)) {
    const p = structureAt(x, y, (ax, ay) => env.aux(ax, ay), (ax, ay) => env.tile(ax, ay), (ax, ay) => env.sub(ax, ay));
    return p && isMetroStationKind(p.kind) ? { doorX: p.doorX, doorY: p.doorY, kind: p.kind } : null;
  }
  const k = kindIdOf(zoneOf(t), env.sub(x, y));
  return isMetroStationKind(k) ? { doorX: x, doorY: y, kind: k } : null;
}

/** The run of platform tiles through (x, y) along its axis, or null when (x, y) is no platform. */
export function platformRun(x: number, y: number, env: Pick<MetroEnv, 'under'>): { alongX: boolean; row: number; a0: number; a1: number } | null {
  const b = env.under(x, y);
  if (!isPlatform(b)) return null;
  const alongX = underMask(b) === 10, at = alongX ? x : y;
  const same = (a: number) => { const c = alongX ? env.under(a, y) : env.under(x, a); return isPlatform(c) && underMask(c) === underMask(b); };
  let a0 = at, a1 = at;
  while (a0 > at - 2 * METRO.platform.hall && same(a0 - 1)) a0--;
  while (a1 < at + 2 * METRO.platform.hall && same(a1 + 1)) a1++;
  return { alongX, row: alongX ? y : x, a0, a1 };
}

/** Where a platform for `kindId` with its door at (doorX, doorY) lies: its middle tile under the door. */
export function platformSpan(kindId: number, doorX: number, doorY: number, alongX: boolean): StationStop {
  const len = metroPlatformLen(kindId), a0 = (alongX ? doorX : doorY) - Math.floor(len / 2);
  return { doorX, doorY, alongX, row: alongX ? doorY : doorX, a0, a1: a0 + len - 1, len };
}

/**
 * The stop a metro line naming (x, y) calls at, or why it cannot: (x, y) is the station's door, any tile of its
 * footprint, or any tile of its platform. The platform must be the kind's length with its middle under the door.
 * Derived from the tiles alone, so the server and every client agree.
 */
export function metroStop(x: number, y: number, env: MetroEnv): StationStop | { reason: string; at: [number, number] } {
  if (env.tile(x, y) === undefined) return { reason: 'a station is not loaded', at: [x, y] };
  let door = surfaceStation(x, y, env);
  if (!door) {
    const run = platformRun(x, y, env);
    if (run) {
      const mid = run.a0 + Math.floor((run.a1 - run.a0 + 1) / 2);
      door = run.alongX ? surfaceStation(mid, run.row, env) : surfaceStation(run.row, mid, env);
    }
    if (!door) return { reason: `no metro station at (${x}, ${y})`, at: [x, y] };
  }
  const { doorX, doorY, kind } = door;
  const run = platformRun(doorX, doorY, env);
  if (!run) return { reason: `the station at (${doorX}, ${doorY}) has no platform under it`, at: [doorX, doorY] };
  const want = platformSpan(kind, doorX, doorY, run.alongX);
  if (run.a0 !== want.a0 || run.a1 !== want.a1) return { reason: `the platform under the station at (${doorX}, ${doorY}) is broken`, at: [doorX, doorY] };
  return want;
}
/** The metro station at (x, y) (door, footprint or platform tile) as a stop, or null. */
export function metroStationAt(x: number, y: number, env: MetroEnv): StationStop | null {
  const s = metroStop(x, y, env);
  return 'reason' in s ? null : s;
}
/** A station is open once its entrance is finished: level 1 and no site (as rail's stationBuilt). */
export function metroStationBuilt(s: Pick<StationStop, 'doorX' | 'doorY'>, env: RailEnv): boolean {
  const t = env.tile(s.doorX, s.doorY);
  return t !== undefined && isMetroStationKind(kindIdOf(zoneOf(t), env.sub(s.doorX, s.doorY))) && levelOf(t) >= 1 && !underConstruction(t);
}

const PIECE = ['', 'tunnel end', 'curve', 'junction', 'crossover'];
export interface PlatformPlan {
  ok: boolean;
  reason?: string;
  /** the tile to mark when refused */
  at?: [number, number];
  /** where the platform lies (also when refused, for the preview) */
  stop: StationStop;
  /** flat x, y, byte: the under bytes to write */
  writes: number[];
}
/**
 * The platform a metro station puts under its door. Each tile must be loaded and either solid ground or a plain
 * tunnel along the platform's axis (so a station can go onto an existing tunnel, but not on a curve, a junction, a
 * crossover or another platform), and the tile beyond each end may not be a platform, so two platforms never touch
 * end to end. The surface (land, road, clear ground) is checked by the kind's own placement. Client preview and
 * server both run this.
 */
export function planPlatform(kindId: number, doorX: number, doorY: number, alongX: boolean, env: Pick<MetroEnv, 'tile' | 'under'>): PlatformPlan {
  const stop = platformSpan(kindId, doorX, doorY, alongX);
  const bad = (reason: string, at: [number, number]): PlatformPlan => ({ ok: false, reason, at, stop, writes: [] });
  if (!stop.len) return bad('That is not a metro station', [doorX, doorY]);
  const straight = alongX ? 10 : 5, writes: number[] = [];
  for (let a = stop.a0; a <= stop.a1; a++) {
    const [x, y] = stopTile(stop, a);
    if (env.tile(x, y) === undefined) return bad('That land is not loaded yet', [x, y]);
    const b = env.under(x, y);
    if (isPlatform(b)) return bad(`Another platform is in the way underground (at ${x}, ${y})`, [x, y]);
    if (b && !isTunnel(b)) return bad(`Something is in the way underground (at ${x}, ${y})`, [x, y]);
    if (b && (underMask(b) & ~straight)) {
      const m = underMask(b), across = m === 15 - straight;
      return bad(`The platform must run along the tunnel, not ${across ? 'across it' : `over a ${PIECE[bits(m)]}`} (at ${x}, ${y}); turn it with Z or C`, [x, y]);
    }
    writes.push(x, y, platformByte(alongX));
  }
  for (const a of [stop.a0 - 1, stop.a1 + 1]) {
    const [x, y] = stopTile(stop, a);
    if (isPlatform(env.under(x, y))) return bad(`Platforms may not touch end to end (another platform at ${x}, ${y})`, [x, y]);
  }
  return { ok: true, stop, writes };
}

/**
 * A platform whose station has gone (nothing of a metro kind of the right length above its middle) turns back into
 * plain tunnel: the writes for the run through (x, y), or none while its station stands.
 */
export function orphanPlatform(x: number, y: number, env: MetroEnv): number[] {
  const run = platformRun(x, y, env);
  if (!run) return [];
  const mid = run.a0 + Math.floor((run.a1 - run.a0 + 1) / 2);
  const [dx, dy] = run.alongX ? [mid, run.row] : [run.row, mid];
  const s = metroStop(dx, dy, env);
  if (!('reason' in s) && s.doorX === dx && s.doorY === dy) return [];
  const out: number[] = [];
  for (let a = run.a0; a <= run.a1; a++) {
    const [tx, ty] = run.alongX ? [a, run.row] : [run.row, a];
    out.push(tx, ty, tunnelByte(underMask(env.under(tx, ty))));
  }
  return out;
}

// ---- the network ------------------------------------------------------------------------------------
/**
 * The under layer as a network for rail's route search (`routeNet`). `taken` gives the sides other lines already run
 * on at a tile, which this line may not use: a crossover another line runs through one way is straight on the other
 * way only, and a tunnel another line runs along is not there at all.
 */
export function underNet(env: MetroEnv, taken?: (x: number, y: number) => number): TrackNet {
  return {
    noun: 'tunnel',
    mask: (x, y) => {
      const b = env.under(x, y);
      if (!isTunnel(b)) return -1;
      const m = underMask(b), t = taken ? taken(x, y) : 0;
      if (!t) return m;
      if (m === 15) return (t & 5 ? 0 : 5) | (t & 10 ? 0 : 10); // a crossover: whichever bore is free, straight on
      return m & ~t;
    },
    stop: (x, y) => metroStop(x, y, env),
  };
}

/**
 * The overrun bored straight on past each terminus of a there-and-back route that is in the layer: up to
 * METRO.overrun tiles beyond each end, while they are plain tunnel joined back towards the line. Flat [x, y, sides].
 */
export function overrunTiles(route: RailRoute, env: Pick<MetroEnv, 'under'>, n: number = METRO.overrun): number[] {
  if (route.loop || !route.sides.length) return [];
  const tiles = routeTiles(route), out: number[] = [];
  const first = tiles[0], last = tiles[tiles.length - 1];
  for (const [x0, y0, side] of [[first.x, first.y, first.i], [last.x, last.y, last.o]]) {
    let x = x0, y = y0;
    for (let k = 0; k < n; k++) {
      x += RAIL_SIDES[side][0]; y += RAIL_SIDES[side][1];
      const b = env.under(x, y);
      if (!isTunnel(b) || isPlatform(b) || !(underMask(b) & (1 << oppSide(side)))) break;
      out.push(x, y, underMask(b) & ((1 << side) | (1 << oppSide(side))));
    }
  }
  return out;
}
/**
 * The sides a metro line runs on at each tile (trackKey), its terminus overruns included when `env` is given: what
 * `underNet`'s `taken` and `planBore`'s `inUse` read for the other lines. Two lines conflict where their sides meet.
 */
export function lineSides(route: RailRoute, env?: Pick<MetroEnv, 'under'>, into: Map<number, number> = new Map()): Map<number, number> {
  for (const t of routeTiles(route)) { const k = trackKey(t.x, t.y); into.set(k, (into.get(k) ?? 0) | (1 << t.i) | (1 << t.o)); }
  if (env) {
    const o = overrunTiles(route, env);
    for (let i = 0; i < o.length; i += 3) { const k = trackKey(o[i], o[i + 1]); into.set(k, (into.get(k) ?? 0) | o[i + 2]); }
  }
  return into;
}

// ---- boring a line ----------------------------------------------------------------------------------
type Tile = { x: number; y: number; i: number; o: number };
export type BorePlan =
  | {
    ok: true;
    /** the line as it runs once bored (routeNet over the written layer finds this or a shorter one) */
    route: RailRoute;
    /** every tile of the route (trackKey) */
    tiles: Set<number>;
    /** flat x, y, byte: every under byte that changes, overruns included */
    writes: number[];
    /** flat x, y: the new tunnel tiles, and the new crossovers over another line's tunnel */
    bore: number[]; crossovers: number[];
    /** what boring costs the owner, and the search's own cost of the route (step costs) */
    cost: number; score: number;
  }
  | { ok: false; problem: LineProblem };

/** a min-heap of node indices by (f, insertion order), so the search is deterministic */
class Heap {
  private ids: number[] = [];
  constructor(private f: number[]) {}
  get size() { return this.ids.length; }
  private less(a: number, b: number) { return this.f[a] < this.f[b] || (this.f[a] === this.f[b] && a < b); }
  push(id: number) {
    const h = this.ids;
    h.push(id);
    for (let i = h.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!this.less(h[i], h[p])) break; [h[i], h[p]] = [h[p], h[i]]; i = p; }
  }
  pop(): number {
    const h = this.ids, top = h[0], last = h.pop()!;
    if (h.length) {
      h[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]]; i = m;
      }
    }
    return top;
  }
}

/**
 * Plan the tunnel a metro line needs: per leg an A* over (tile, exit side, turned here) from the exit end of one
 * platform to either end of the next (and back round into the first for a loop), with fixed step costs (METRO.search):
 * existing tunnel no line uses 1, a new tile 3 (5 under water), a turn +3 and a turn right after a turn +6 more, a
 * new crossover straight across another line's straight tunnel +4. Refused: another platform (but the target's end),
 * another line's curve, junction or crossover, a tile this line already uses, unloaded tiles and anything outside
 * the stations' box plus METRO.search.margin. Both directions out of the first station are tried, as routeLine does,
 * and the cheaper plan wins. A there-and-back line also bores up to METRO.overrun tiles past each terminus.
 *
 * `inUse(x, y)` is the sides other metro lines run on at a tile (`lineSides`), 0 where none does.
 */
export function planBore(def: Pick<RailLineDef, 'stations' | 'loop'>, env: MetroEnv, inUse: (x: number, y: number) => number): BorePlan {
  const n = def.stations.length;
  const refuse = (message: string, extra: Partial<LineProblem> = {}): BorePlan => ({ ok: false, problem: { message, tiles: [], fatal: true, ...extra } });
  if (n < METRO.stationsMin) return refuse(`A metro line needs at least ${METRO.stationsMin} stations`);
  if (n > METRO.stationsMax) return refuse(`A metro line calls at ${METRO.stationsMax} stations at most`);
  const stops: StationStop[] = [];
  const doors = new Set<number>();
  for (let i = 0; i < n; i++) {
    const [x, y] = def.stations[i];
    const s = metroStop(x, y, env);
    if ('reason' in s) return refuse(s.reason, { stop: i, tiles: [...s.at] });
    const k = trackKey(s.doorX, s.doorY);
    if (doors.has(k)) return refuse(`The station at (${s.doorX}, ${s.doorY}) is on the line twice`, { stop: i, tiles: [s.doorX, s.doorY] });
    doors.add(k);
    stops.push(s);
  }
  const rows = stops.map((s) => { const set = new Set<number>(); for (let a = s.a0; a <= s.a1; a++) { const [x, y] = stopTile(s, a); set.add(trackKey(x, y)); } return set; });
  for (let i = 0; i < n; i++) {
    const s = stops[i];
    for (let a = s.a0; a <= s.a1; a++) {
      const [x, y] = stopTile(s, a);
      if (inUse(x, y)) return refuse(`Another line already calls at the station at (${s.doorX}, ${s.doorY})`, { fix: 'Lines share no platform: build another entrance within a short walk and change there', stop: i, tiles: [s.doorX, s.doorY] });
    }
  }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const s of stops) for (const a of [s.a0, s.a1]) {
    const [x, y] = stopTile(s, a);
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
  }
  const C = METRO.search;
  bx0 -= C.margin; by0 -= C.margin; bx1 += C.margin; by1 += C.margin;

  /** cost of running through (x, y) in by side i and out by side e, or -1 where the line may not */
  const step = (x: number, y: number, i: number, e: number, used: Set<number>): number => {
    if (x < bx0 || x > bx1 || y < by0 || y > by1) return -1;
    const t = env.tile(x, y);
    if (t === undefined || used.has(trackKey(x, y))) return -1;
    const b = env.under(x, y), fresh = isBuildable(t) ? C.fresh : C.wet;
    if (!b) return fresh;
    if (!isTunnel(b) || isPlatform(b)) return -1;
    const m = underMask(b), ours = (1 << i) | (1 << e), straight = e === oppSide(i), other = inUse(x, y);
    if (other) {
      if (other & ours || !straight) return -1;
      if (m === 15) return C.reuse; // the free bore of a crossover
      return (m === 5 || m === 10) && (m | ours) === 15 ? fresh + C.crossover : -1;
    }
    return bits(m | ours) === 4 && !straight ? -1 : C.reuse;
  };

  type Leg = { steps: Tile[]; dir: 1 | -1; cost: number };
  let searches = C.legs;
  const blockers = new Set<number>(); // platforms the failing searches ran into, to mark
  const legSearch = (sx: number, sy: number, exit: number, to: StationStop, used: Set<number>, wantDir: 1 | -1 | 0): Leg | null => {
    if (searches-- <= 0) return null;
    const goals = new Map<number, 1 | -1>(); // trackKey * 4 + entry side -> heading along the target platform
    const [ex0, ey0] = stopTile(to, to.a0), [ex1, ey1] = stopTile(to, to.a1);
    if (wantDir >= 0) goals.set(trackKey(ex0, ey0) * 4 + alongSide(to, -1), 1);
    if (wantDir <= 0) goals.set(trackKey(ex1, ey1) * 4 + alongSide(to, 1), -1);
    const gx = [ex0, ex1], gy = [ey0, ey1], gOk = [wantDir >= 0, wantDir <= 0];
    const h = (x: number, y: number) => { let d = Infinity; for (let k = 0; k < 2; k++) if (gOk[k]) d = Math.min(d, Math.abs(x - gx[k]) + Math.abs(y - gy[k])); return d; };
    // nodes: the tile, the side it was entered by and is left by, whether it turns, cost so far (with this tile)
    const px: number[] = [sx], py: number[] = [sy], pin: number[] = [-1], pexit: number[] = [exit], pturn: boolean[] = [false], g: number[] = [0], parent: number[] = [-1];
    const f: number[] = [h(sx + RAIL_SIDES[exit][0], sy + RAIL_SIDES[exit][1])];
    const best = new Map<number, number>();
    const open = new Heap(f);
    open.push(0);
    while (open.size) {
      const head = open.pop();
      const o = pexit[head];
      const nx = px[head] + RAIL_SIDES[o][0], ny = py[head] + RAIL_SIDES[o][1], ni = oppSide(o);
      const nk = trackKey(nx, ny);
      const goal = goals.get(nk * 4 + ni);
      if (goal !== undefined) {
        const steps: Tile[] = [];
        for (let q = head; q > 0; q = parent[q]) steps.push({ x: px[q], y: py[q], i: pin[q], o: pexit[q] });
        steps.reverse();
        return { steps, dir: goal, cost: g[head] };
      }
      if (isPlatform(env.under(nx, ny)) && !used.has(nk)) blockers.add(nk);
      for (let e = 0; e < 4; e++) {
        if (e === ni) continue;
        const c = step(nx, ny, ni, e, used);
        if (c < 0) continue;
        const turn = e !== oppSide(ni);
        const ng = g[head] + c + (turn ? C.turn + (pturn[head] ? C.turnAgain : 0) : 0);
        const sk = nk * 8 + e * 2 + (turn ? 1 : 0);
        const was = best.get(sk);
        if (was !== undefined && was <= ng) continue;
        if (px.length >= C.budget) return null;
        best.set(sk, ng);
        const id = px.length;
        px.push(nx); py.push(ny); pin.push(ni); pexit.push(e); pturn.push(turn); g.push(ng); parent.push(head);
        f.push(ng + h(nx + RAIL_SIDES[e][0], ny + RAIL_SIDES[e][1]));
        open.push(id);
      }
    }
    return null;
  };

  const allRows = new Set<number>();
  for (const r of rows) for (const k of r) allRows.add(k);
  const rowTiles = (s: StationStop, dir: 1 | -1): Tile[] => {
    const out: Tile[] = [];
    for (let q = 0; q < s.len; q++) {
      const [x, y] = stopTile(s, dir > 0 ? s.a0 + q : s.a1 - q);
      out.push({ x, y, i: alongSide(s, dir > 0 ? -1 : 1), o: alongSide(s, dir) });
    }
    return out;
  };
  let firstFail: { from: number; to: number } | null = null;
  type Got = { tiles: Tile[]; stopsK: number[]; score: number };
  // as routeLine: depth-first over the end each leg enters the next platform by, the cheaper end first
  const solve = (i: number, acc: Tile[], stopsK: number[], used: Set<number>, firstDir: 1 | -1, score: number): Got | null => {
    const closing = i === n - 1;
    if (closing && !def.loop) return { tiles: acc, stopsK, score };
    const toIdx = closing ? 0 : i + 1;
    const last = acc[acc.length - 1];
    const forbid = new Set(used);
    for (const k of allRows) forbid.add(k);
    const legA = legSearch(last.x, last.y, last.o, stops[toIdx], forbid, closing ? firstDir : 0);
    if (!legA) { firstFail ??= { from: i, to: toIdx }; return null; }
    if (closing) return { tiles: [...acc, ...legA.steps], stopsK, score: score + legA.cost };
    const attempt = (leg: Leg) => {
      const nu = new Set(used);
      for (const s of leg.steps) nu.add(trackKey(s.x, s.y));
      for (const k of rows[toIdx]) nu.add(k);
      return solve(i + 1, [...acc, ...leg.steps, ...rowTiles(stops[toIdx], leg.dir)], [...stopsK, acc.length + leg.steps.length], nu, firstDir, score + leg.cost);
    };
    const got = attempt(legA);
    if (got) return got;
    const legB = legSearch(last.x, last.y, last.o, stops[toIdx], forbid, legA.dir > 0 ? -1 : 1);
    return legB ? attempt(legB) : null;
  };
  let best: Got | null = null;
  for (const d of [1, -1] as const) {
    const got = solve(0, rowTiles(stops[0], d), [0], new Set(rows[0]), d, 0);
    if (got && (!best || got.score < best.score || (got.score === best.score && got.tiles.length < best.tiles.length))) best = got;
  }
  if (!best) {
    const fl = firstFail ?? { from: 0, to: Math.min(1, n - 1) };
    const [ax, ay] = def.stations[fl.from], [bx, by] = def.stations[fl.to];
    const a = stops[fl.from], b = stops[fl.to];
    const lo = (v: number, w: number) => Math.min(v, w) - 3, hi = (v: number, w: number) => Math.max(v, w) + 3;
    const marks: number[] = [];
    for (const k of [...blockers].sort((p, q) => p - q)) {
      const x = Math.floor(k / 65536) - 0x8000, y = (k % 65536) - 0x8000;
      if (x >= lo(a.doorX, b.doorX) && x <= hi(a.doorX, b.doorX) && y >= lo(a.doorY, b.doorY) && y <= hi(a.doorY, b.doorY) && marks.length < 48) marks.push(x, y);
    }
    return refuse(
      fl.to === 0 && def.loop && n > 1 && fl.from === n - 1
        ? `No tunnel can be bored from the last station (${ax}, ${ay}) back round into the first (${bx}, ${by})`
        : `No tunnel can be bored from the station at (${ax}, ${ay}) to the one at (${bx}, ${by})`,
      {
        fix: marks.length ? 'Another platform is in the way: move one of the stations, or turn its platform with Z or C' : 'Other lines\' tunnels are in the way: move a station, or let the lines cross at right angles',
        from: fl.from, to: fl.to, leg: [ax, ay, bx, by], tiles: marks.length ? marks : [ax, ay, bx, by],
      },
    );
  }

  // the bytes: each route tile gains the sides it is run through by; overruns past a there-and-back line's ends
  const tiles = new Set<number>(), writes: number[] = [], bore: number[] = [], crossovers: number[] = [];
  let cost = 0;
  const price = (x: number, y: number) => (isBuildable(env.tile(x, y)!) ? METRO.tunnelCost : METRO.wetTunnelCost);
  for (const t of best.tiles) {
    tiles.add(trackKey(t.x, t.y));
    const b = env.under(t.x, t.y);
    if (isPlatform(b)) continue;
    const m = (isTunnel(b) ? underMask(b) : 0) | (1 << t.i) | (1 << t.o);
    if (!b) { bore.push(t.x, t.y); cost += price(t.x, t.y); }
    else if (inUse(t.x, t.y) && underMask(b) !== 15) { crossovers.push(t.x, t.y); cost += price(t.x, t.y) + METRO.crossoverCost; }
    if (tunnelByte(m) !== b) writes.push(t.x, t.y, tunnelByte(m));
  }
  if (!def.loop) {
    const first = best.tiles[0], last = best.tiles[best.tiles.length - 1];
    for (const [x0, y0, side] of [[first.x, first.y, first.i], [last.x, last.y, last.o]]) {
      const run: [number, number][] = [];
      let x = x0, y = y0;
      for (let k = 0; k < METRO.overrun; k++) {
        x += RAIL_SIDES[side][0]; y += RAIL_SIDES[side][1];
        if (env.tile(x, y) === undefined || env.under(x, y) || tiles.has(trackKey(x, y)) || inUse(x, y)) break;
        run.push([x, y]);
      }
      run.forEach(([x, y], k) => {
        writes.push(x, y, tunnelByte((1 << oppSide(side)) | (k + 1 < run.length ? 1 << side : 0)));
        bore.push(x, y); cost += price(x, y);
      });
    }
  }
  const t0 = best.tiles[0];
  const route: RailRoute = {
    x: t0.x, y: t0.y, entry: t0.i, sides: best.tiles.map((t) => String(t.o)).join(''), loop: def.loop,
    stops: best.stopsK.map((k, i) => ({ k, len: stops[i].len })),
  };
  return { ok: true, route, tiles, writes, bore, crossovers, cost, score: best.score };
}

// ---- trains -----------------------------------------------------------------------------------------
/**
 * Which bore a metro train is in, for drawing: +1 the bore on the left of the route's forward direction (where a
 * train keeps left on the way out), -1 the other. A there-and-back train crosses over at a terminus, sliding across
 * in the middle of its dwell (a scissors crossover); a loop runs one way, always in +1.
 */
export function metroBore(svc: RailService, t: Pick<TrainState, 'phase' | 'stop' | 'dir' | 'progress'>): number {
  if (svc.geom.loop) return 1;
  const n = svc.geom.stopS.length;
  if (t.phase === 'dwell' && (t.stop === 0 || t.stop === n - 1)) {
    const to = t.dir, f = Math.min(1, Math.max(0, (t.progress - 0.35) / 0.3));
    return -to + 2 * to * f * f * (3 - 2 * f);
  }
  return t.dir;
}
