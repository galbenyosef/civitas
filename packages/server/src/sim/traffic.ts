import {
  DRIVE_SPEED, MIN_GAP, LANE_OFFSET, SIDEWALK_OFFSET, VEHICLE_LEN, VEHICLE_WIDTH, TRAFFIC_TUNING as TT,
  VehicleClass, BIKE_CLASS, isRoad, hasFeature, signalTiming, signalPhaseOf, signalArms, signalledArms, type SignalPhase,
  isJunctionAux, isRingAux, isFlyoverAux, islandOf, ringPos, isArmPos, RING_POS, isCrossing, isBridgeAux, isDeck, bridgeStyle, BridgeStyle, basculeBarrierAt,
  CHUNK_SIZE, chunkOf, localIndex,
} from '@msimcity/shared';
import { DIRS, noteTrail, tkey, type Mover, type World } from '../world';
import { env } from '../env';

/**
 * Two-wheelers (fleet.ts BIKE_CLASS: delivery bicycles and mopeds, docs/mobile-jobs.md) ride at the kerb edge of the
 * lane, BIKE_SIDE further out than a car, and filter: in a lane, cars follow cars and bikes follow bikes, and the body
 * guard does not hold a bike and a car in the same lane against each other. Everything else (stop lines, signals, the
 * junction box, crossings, pedestrians) applies to them as to cars.
 */
const isBike = (m: Mover) => m.cls === BIKE_CLASS;
/**
 * A two-wheeler's offset towards the kerb from a car's line, and the width of a bike and its rider: it rides in the
 * strip between a car's side (LANE_OFFSET + half a car, 0.28 from the centre line) and people on the pavement
 * (SIDEWALK_OFFSET less a walker's radius, 0.35), touching neither.
 */
const BIKE_SIDE = 0.125, BIKE_WIDTH = 0.05;
/** body width of a mover, and the guard's margin round a pedestrian (none for a bike, which passes in its own strip) */
const widthOf = (m: Mover) => (isBike(m) ? BIKE_WIDTH : VEHICLE_WIDTH);
const marginOf = (m: Mover) => (isBike(m) ? 0 : GUARD_MARGIN);
/** The nearest mover of the given kind (bike or not) before index i of a lane queue: the one m follows. */
function leaderIn(q: Mover[], i: number, bike: boolean): Mover | null {
  for (let j = i - 1; j >= 0; j--) if (isBike(q[j]) === bike) return q[j];
  return null;
}

/** Index into DIRS for the step from a to b (adjacent tiles). */
export function dirBetween(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  return dx > 0 ? 0 : dx < 0 ? 1 : dy > 0 ? 2 : 3;
}
/** DIRS is E, W, S, N. Right-hand turns for right-hand traffic (x east, y south). */
const RIGHT = [2, 3, 1, 0], LEFT = [3, 2, 0, 1], OPP = [1, 0, 3, 2];
const isEW = (d: number) => d < 2;
/** what a level crossing adds to a road tile's cost for the router: the expected wait for the barriers */
const CROSSING_DELAY = 1.5;
/** what a bascule bridge's deck tile adds to a road tile's cost while it is lifting (shared/src/bridges.ts) */
const BASCULE_UP_COST = 25;

interface Cong { v: number; at: number }
/**
 * The router's cost of one chunk's tiles, as dense arrays (docs/search-perf.md): Traffic.cost is called for every tile
 * every A* search looks at. `cong` is congestionAt as it was first read in epoch `at` (a new epoch each tick and after
 * endTick, the only place congestion changes; its decay changes only with the tick); `flags` the parts that change only with the tiles
 * (0: not worked out, else 1 | 2 for a junction of three or more | 4 a level crossing | 8 a bascule deck), cleared by
 * invalidate as the degree and crossing caches are; `kerb` 1 where a car is parked at the kerb, kept by World.kerb.
 */
interface CostChunk { cong: Float64Array; at: Float64Array; flags: Uint8Array; kerb: Uint8Array }
const CELLS = CHUNK_SIZE * CHUNK_SIZE;
/**
 * One chunk's lanes and road geometry caches, as dense arrays: `lanes` the queue of each lane (tile index × 4 + direction;
 * the same arrays as Traffic.cells, which keeps them for going through every lane), and the degree, roundabout or flyover
 * byte and crossing caches (degreeOf, junctionAux, isCrossingAt; -1 not worked out, as after invalidate).
 */
interface RoadChunk { lanes: (Mover[] | undefined)[]; deg: Int8Array; jaux: Int16Array; xing: Int8Array }
interface Junction { signal: boolean; ver: number; deg: number; pid: number; offset: number; period: number; act?: Actuation }
/** Actuated signal state: the axis on green, when that green began and when it is due to end. */
interface Actuation { green: 'ns' | 'ew'; start: number; end: number; decided: boolean; at: number }
/** Running totals for the A/B harness and diagnostics (read-only outside Traffic; see Traffic.counters). */
export interface TrafficCounters {
  /** cars pushed into a lane leaving a junction tile (3+ road neighbours) */
  junctionEntries: number;
  /** citizens sent home by the stuck rule (the old give-up), vehicles removed by it */
  stuckHome: number; stuckDespawn: number;
  /** trips abandoned after the long wait: car left at the kerb and the driver walked on / vehicle removed clear of any box */
  abandonKerb: number; abandonDespawn: number;
  /** cars that never got out of the garage (not on the road, so never visible) */
  garageGiveUp: number;
  /** re-routes: the usual congestion re-route, and the forced one at the stuck limit */
  reroutes: number; stuckReroutes: number;
  /** a car went in while pedestrians were on its crossing (CAR_YIELD_MAX ran out); a pedestrian stepped out with a car in the box */
  carNosed: number; pedForced: number;
  /** body guard: car moves cut short by a pedestrian in the way; pedestrian steps held by a car body; pedestrians who walked on after guardWaitMax */
  guardCar: number; guardPed: number; guardPedGaveUp: number;
  /** of the give-ups above, those that removed a car from inside a junction box */
  stuckInBox: number;
  /** pedestrian steps back toward the kerb from a crossing held by a car body (pedRetreatAfter) */
  pedRetreat: number;
}
/** Pedestrian body radius and the clearance the body guard keeps on top of it. */
const PED_R = 0.07, GUARD_MARGIN = 0.03;
interface Obb { x: number; y: number; hx: number; hy: number; len: number }
/** Separating-axis test for two car bodies (length × VEHICLE_WIDTH rectangles), each grown by `pad`. */
function obbOverlap(a: Obb, b: Obb, pad: number): boolean {
  const W2 = VEHICLE_WIDTH / 2 + pad;
  return !obbApart(a, b, pad, W2, a.hx, a.hy) && !obbApart(a, b, pad, W2, -a.hy, a.hx) && !obbApart(a, b, pad, W2, b.hx, b.hy) && !obbApart(a, b, pad, W2, -b.hy, b.hx);
}
/** Does axis (nx, ny) separate the two bodies (obbOverlap)? */
function obbApart(a: Obb, b: Obb, pad: number, W2: number, nx: number, ny: number): boolean {
  const ra = (a.len / 2 + pad) * Math.abs(a.hx * nx + a.hy * ny) + W2 * Math.abs(-a.hy * nx + a.hx * ny);
  const rb = (b.len / 2 + pad) * Math.abs(b.hx * nx + b.hy * ny) + W2 * Math.abs(-b.hy * nx + b.hx * ny);
  return Math.abs((b.x - a.x) * nx + (b.y - a.y) * ny) > ra + rb;
}
/**
 * Movers by the tile they are on, refilled every tick (the body guard's car grid and the walkers): per chunk a list per
 * tile and the fill each list belongs to, so emptying is a new fill number and a lookup is a chunk and two array reads.
 */
class TileLists {
  private chunks = new Map<number, TileChunk>();
  private fill = 1;
  private lastCx = NaN; private lastCy = NaN; private last: TileChunk | undefined;
  clear() { this.fill++; }
  add(x: number, y: number, m: Mover) {
    let c = this.chunk(x, y);
    if (!c) { c = { fill: new Uint32Array(CELLS), lists: new Array(CELLS) }; this.chunks.set(tkey(chunkOf(x), chunkOf(y)), c); this.last = c; }
    const i = localIndex(x, y);
    if (c.fill[i] !== this.fill) { c.fill[i] = this.fill; if (c.lists[i]) c.lists[i].length = 0; else c.lists[i] = []; }
    c.lists[i].push(m);
  }
  /** the movers on tile (x, y) since the last clear, if any */
  get(x: number, y: number): Mover[] | undefined {
    const c = this.chunk(x, y);
    if (!c) return undefined;
    const i = localIndex(x, y);
    return c.fill[i] === this.fill ? c.lists[i] : undefined;
  }
  private chunk(x: number, y: number): TileChunk | undefined {
    const cx = chunkOf(x), cy = chunkOf(y);
    if (cx !== this.lastCx || cy !== this.lastCy) { this.last = this.chunks.get(tkey(cx, cy)); this.lastCx = cx; this.lastCy = cy; }
    return this.last;
  }
}
interface TileChunk { fill: Uint32Array; lists: Mover[][] }
/**
 * A walker's route. `cross[i]` is the tile key when the segment ending at
 * point i is on that tile's carriageway (0 otherwise); `xdir[i]` is, for the
 * first point of each crossing, the walker's heading (a DIRS index) as they
 * step off the kerb, plus 4 when the crossing cuts across the junction box
 * (left turns, diagonal kerb-to-kerb steps) rather than straight over one road.
 */
export interface Polyline { pts: number[]; cross: number[]; node: number[]; xdir: number[] }

/** Which carriageways a crossing is on, as a mask: 1 = a north-south road, 2 = an east-west road. */
export const CROSS_NS_ROAD = 1, CROSS_EW_ROAD = 2;
/** The carriageways (CROSS_* mask) a car moving inD -> outD through a box drives over. */
export function movementMask(inD: number, outD: number): number {
  return (isEW(inD) || isEW(outD) ? CROSS_EW_ROAD : 0) | (!isEW(inD) || !isEW(outD) ? CROSS_NS_ROAD : 0);
}
/** The crossing mask for a crossing step with heading code `xd` (see Polyline.xdir). */
export function crossMask(xd: number): number {
  if (xd < 0 || xd >= 4) return CROSS_NS_ROAD | CROSS_EW_ROAD;
  return isEW(xd) ? CROSS_NS_ROAD : CROSS_EW_ROAD; // walking east-west takes you over the north-south road
}

const EMA_ALPHA = 0.08;
const DECAY_TAU = 75;
const STOP_MARGIN = 0.03;
/**
 * The longest vehicle that, waiting at the stop line of a junction straight after a level crossing (its nose
 * STOP_MARGIN short of the junction), stands clear of a passing train: its tail must stay outside the train's half
 * width (0.105) of the crossing's middle, with a little to spare. Cars are; vans, trucks and buses are not.
 */
const XING_SHORT = 0.5 - STOP_MARGIN - 0.105 - 0.02;
/** Lane progress past the stop's road-tile centre where a bus halts at a stop (sim/transit.ts HALT_PROG). */
const HALT_AT = 0.04;
/**
 * Where a bus halts when the stop's road tile is where it turns round (a stop at a dead end): not in the middle of the
 * three-point turn, across the road, but once it has turned, straight in the other lane (KTURN's last straight), so it
 * serves the stop as it finishes the turn.
 */
const HALT_TURNED = 0.46;

/**
 * Turning round inside one tile (a bus at the end of its line, sim/busroute.ts): a three-point turn in the lane's
 * frame, u along the way in from the tile's entry edge, w to the left of it. Forward and left from the right-hand lane
 * across to the far kerb, back a little while still turning, then forward and left again into the other lane and out
 * by the edge it came in at. Sampled once by arc length; `rev0`..`rev1` is the stretch driven backwards.
 */
const KTURN = (() => {
  const o = LANE_OFFSET, u: number[] = [], w: number[] = [], rev: boolean[] = [];
  const u0 = 0.25, R1 = 0.3, R2 = 0.25, f1 = (100 * Math.PI) / 180, f2 = (140 * Math.PI) / 180, N = 24;
  const add = (a: number, b: number, back: boolean) => { u.push(a); w.push(b); rev.push(back); };
  for (let i = 0; i <= N; i++) add((u0 * i) / N, -o, false);
  for (let i = 1; i <= N; i++) { const f = (f1 * i) / N; add(u0 + R1 * Math.sin(f), -o + R1 * (1 - Math.cos(f)), false); }
  const u1 = u[u.length - 1], w1 = w[w.length - 1];
  for (let i = 1; i <= N; i++) { const f = f1 + ((f2 - f1) * i) / N; add(u1 + R2 * (Math.sin(f1) - Math.sin(f)), w1 + R2 * (Math.cos(f) - Math.cos(f1)), true); }
  const u2 = u[u.length - 1], w2 = w[w.length - 1], R3 = (o - w2) / (1 + Math.cos(f2));
  for (let i = 1; i <= N; i++) { const f = f2 + ((Math.PI - f2) * i) / N; add(u2 + R3 * (Math.sin(f) - Math.sin(f2)), w2 + R3 * (Math.cos(f2) - Math.cos(f)), false); }
  const u3 = u[u.length - 1];
  for (let i = 1; i <= N; i++) add(u3 * (1 - i / N), o, false);
  const s = [0];
  for (let i = 1; i < u.length; i++) s.push(s[i - 1] + Math.hypot(u[i] - u[i - 1], w[i] - w[i - 1]));
  const len = s[s.length - 1];
  for (let i = 0; i < s.length; i++) s[i] /= len;
  const rev0 = s[rev.indexOf(true) - 1], rev1 = s[rev.lastIndexOf(true)];
  return { u, w, s, len, rev0, rev1 };
})();
/** Speed factor through a three-point turn (on top of the junction turn factor): the time it takes to turn round. */
const UTURN_SLOW = 0.5;
/** A turn round at s (0..1): the lane's three-point turn, or a plain U for another offset (o: right of the way in). */
function uturnPoint(s: number, o: number, out: [number, number]): [number, number] {
  if (o !== LANE_OFFSET) {
    const L = 1 + Math.PI * o, d = s * L; // in to the middle, half round it, back out
    if (d < 0.5) { out[0] = d; out[1] = -o; } else if (d > L - 0.5) { out[0] = L - d; out[1] = o; } else { const a = ((d - 0.5) / (Math.PI * o)) * Math.PI; out[0] = 0.5 + o * Math.sin(a); out[1] = -o * Math.cos(a); }
    return out;
  }
  const S = KTURN.s;
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = S[hi] > S[lo] ? Math.min(1, Math.max(0, (s - S[lo]) / (S[hi] - S[lo]))) : 0;
  out[0] = KTURN.u[lo] + (KTURN.u[hi] - KTURN.u[lo]) * t;
  out[1] = KTURN.w[lo] + (KTURN.w[hi] - KTURN.w[lo]) * t;
  return out;
}

/**
 * Point `s` (0..1) along the path a mover takes through tile (tx,ty) when it
 * arrives heading `inD` and leaves heading `outD`, keeping `o` to the right of
 * the centreline. Straight across, or a quarter arc: tight around the near
 * corner for a right turn, wide around the far corner for a left turn; back
 * out the way it came, a three-point turn (uturnPoint).
 */
export function pathPoint(tx: number, ty: number, inD: number, outD: number, s: number, o: number, out: [number, number]): [number, number] {
  const cx = tx + 0.5, cy = ty + 0.5;
  const ix = DIRS[inD][0], iy = DIRS[inD][1];
  const rx = -iy, ry = ix; // right of the incoming direction
  if (outD === OPP[inD]) {
    uturnPoint(s, o, out);
    const u = out[0], w = out[1]; // w is to the left: -right
    out[0] = cx - 0.5 * ix + u * ix - w * rx;
    out[1] = cy - 0.5 * iy + u * iy - w * ry;
    return out;
  }
  if (outD === inD) {
    out[0] = cx - 0.5 * ix + o * rx + ix * s;
    out[1] = cy - 0.5 * iy + o * ry + iy * s;
    return out;
  }
  const th = s * Math.PI / 2, c = Math.cos(th), sn = Math.sin(th);
  if (outD === RIGHT[inD]) {
    const r = 0.5 - o, kx = cx - 0.5 * ix + 0.5 * rx, ky = cy - 0.5 * iy + 0.5 * ry;
    out[0] = kx + r * (-c * rx + sn * ix); out[1] = ky + r * (-c * ry + sn * iy);
  } else {
    const r = 0.5 + o, kx = cx - 0.5 * ix - 0.5 * rx, ky = cy - 0.5 * iy - 0.5 * ry;
    out[0] = kx + r * (c * rx + sn * ix); out[1] = ky + r * (c * ry + sn * iy);
  }
  return out;
}

/**
 * Which movements through one tile cannot share the box. Same approach, same
 * exit is plain following (handled by the gap rule); same approach but a
 * different exit still conflicts, because the turning car slows in front of
 * the other. Everything else is decided by whether the two paths come within
 * a car's width of each other anywhere inside the tile.
 */
const CONFLICT: boolean[] = new Array(256).fill(false);
(() => {
  const a: [number, number] = [0, 0], b: [number, number] = [0, 0];
  const samples = (inD: number, outD: number) => {
    const out: [number, number][] = [];
    for (let s = 0.04; s < 1; s += 0.08) { pathPoint(0, 0, inD, outD, s, LANE_OFFSET, a); out.push([a[0], a[1]]); }
    return out;
  };
  for (let i1 = 0; i1 < 4; i1++) for (let o1 = 0; o1 < 4; o1++) for (let i2 = 0; i2 < 4; i2++) for (let o2 = 0; o2 < 4; o2++) {
    const idx = ((i1 * 4 + o1) * 4 + i2) * 4 + o2;
    // a vehicle turning round sweeps the whole box: it shares it with nobody but one following it round
    if (o1 === OPP[i1] || o2 === OPP[i2]) { CONFLICT[idx] = !(i1 === i2 && o1 === o2); continue; }
    if (i1 === i2) { CONFLICT[idx] = o1 !== o2; continue; }
    const p1 = samples(i1, o1), p2 = samples(i2, o2);
    let hit = false;
    for (const q of p1) { for (const r of p2) { b[0] = q[0] - r[0]; b[1] = q[1] - r[1]; if (b[0] * b[0] + b[1] * b[1] < (VEHICLE_WIDTH + 0.1) ** 2) { hit = true; break; } } if (hit) break; }
    CONFLICT[idx] = hit;
  }
})();
const conflicts = (i1: number, o1: number, i2: number, o2: number) => CONFLICT[((i1 * 4 + o1) * 4 + i2) * 4 + o2];
/**
 * For each movement pair, the furthest point (path parameter s, 0..1 through the tile) of the second movement
 * that still comes within a car's width of the first one's path; -1 when they never do. A car in the box whose
 * rear is past that point no longer stands in the way (TRAFFIC_TUNING.conflictRemaining).
 */
const CONFLICT_LAST = new Float32Array(256).fill(-1);
/** Clearance between centrelines (beyond a car's width) that still counts as in the way, for the rest of a path. */
const CONFLICT_LAST_MARGIN = Number(env('CONFLICT_LAST_MARGIN') ?? 0.04);
/** Path length per unit of s for a movement (straight 1, right-turn arc shorter, left-turn arc longer). */
const ARC = (inD: number, outD: number) => (outD === inD ? 1 : outD === OPP[inD] ? KTURN.len : outD === RIGHT[inD] ? (Math.PI / 2) * (0.5 - LANE_OFFSET) : (Math.PI / 2) * (0.5 + LANE_OFFSET));
(() => {
  const a: [number, number] = [0, 0], b: [number, number] = [0, 0];
  const thr = (VEHICLE_WIDTH + CONFLICT_LAST_MARGIN) ** 2;
  for (let i1 = 0; i1 < 4; i1++) for (let o1 = 0; o1 < 4; o1++) for (let i2 = 0; i2 < 4; i2++) for (let o2 = 0; o2 < 4; o2++) {
    const idx = ((i1 * 4 + o1) * 4 + i2) * 4 + o2;
    if (o1 === OPP[i1] || o2 === OPP[i2]) { CONFLICT_LAST[idx] = 1; continue; } // turning round: in the way until out of the box
    let last = -1;
    for (let s2 = 0; s2 <= 1.0001; s2 += 0.02) {
      pathPoint(0, 0, i2, o2, s2, LANE_OFFSET, b);
      for (let s1 = 0; s1 <= 1.0001; s1 += 0.02) {
        pathPoint(0, 0, i1, o1, s1, LANE_OFFSET, a);
        if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < thr) { last = s2; break; }
      }
    }
    CONFLICT_LAST[idx] = last;
  }
})();
/** The movement conflict table (approach/exit pairs that cannot share a box), for diagnostics. */
export const conflictsFor = conflicts;

/**
 * Road traffic. Every road tile has one lane per direction; a lane is a FIFO
 * of movers heading from the tile's centre to the next tile's centre, with
 * positions worked out from real lane geometry (right-hand lanes, turn arcs).
 * Drivers follow the car ahead bumper to bumper plus a personal gap, stop at
 * the edge of the next tile until they may enter it (room beyond the box, no
 * conflicting movement already in it, no pedestrian on the crossing, a green
 * light where there are signals), and never overtake. Per-tile occupancy
 * feeds a congestion average used for routing, the heat overlay and tooltips.
 */
export class Traffic {
  private cells = new Map<number, Mover[]>();
  private cong = new Map<number, Cong>();
  private junctions = new Map<number, Junction>();
  /** lanes and road geometry caches by chunk (RoadChunk), and the last one looked up */
  private roads = new Map<number, RoadChunk>();
  private lastRx = NaN; private lastRy = NaN; private lastRoad: RoadChunk | undefined;
  /** barrier state per crossing for the tick under way */
  private bars = new Map<number, boolean>();
  private barsTick = -1;
  /**
   * Level-crossing barriers (set by game.ts from sim/rail.ts): are the barriers of the crossing (x, y) down now? Null
   * (no rail) leaves every crossing open.
   */
  barrier: ((x: number, y: number) => boolean) | null = null;
  /** pedestrians on the carriageway, by tile: last tick's picture (read) and this tick's (written) */
  private crossPrev = new Map<number, number>(); // tile key -> CROSS_* mask
  private crossCur = new Map<number, number>();
  private phase: SignalPhase = { green: 'ns', amber: false };
  /** scratch for the tick under way */
  present = new Map<number, number>();
  stopped = new Map<number, number>();
  vehicles = 0; queued = 0; private speedSum = 0;
  lastVehicles = 0; lastQueued = 0; lastSpeedPct = 1;
  /** tiles whose congestion changed since the last traffic broadcast */
  dirty = new Set<number>();
  private tmp: [number, number] = [0, 0];
  private cnt: TrafficCounters = { junctionEntries: 0, stuckHome: 0, stuckDespawn: 0, abandonKerb: 0, abandonDespawn: 0, garageGiveUp: 0, reroutes: 0, stuckReroutes: 0, carNosed: 0, pedForced: 0, guardCar: 0, guardPed: 0, guardPedGaveUp: 0, stuckInBox: 0, pedRetreat: 0 };
  /** walkers by the tile they were on when they last moved: last tick's and this tick's (positions are read live) */
  private walkPrev = new TileLists();
  private walkCur = new TileLists();
  /** Running totals since the world was loaded (read-only view). */
  get counters(): Readonly<TrafficCounters> { return this.cnt; }
  /** Bump one counter (the simulation reports give-ups and re-routes here). */
  count(k: keyof TrafficCounters, n = 1) { this.cnt[k] += n; }

  constructor(private w: World) {
    w.onTileChanged = (x, y) => this.invalidate(x, y);
    w.kerb.onSet = (k, n) => { const c = this.costChunkOfKey(k); if (c) c.kerb[this.costCell] = n > 0 ? 1 : 0; };
  }

  static laneKey(x: number, y: number, dir: number) { return tkey(x, y) * 4 + dir; }
  /** The RoadChunk of tile (x, y), made if there is none yet. */
  private roadChunk(x: number, y: number): RoadChunk {
    let rc = this.roadChunkIf(x, y);
    if (!rc) {
      rc = { lanes: new Array(CELLS * 4), deg: new Int8Array(CELLS).fill(-1), jaux: new Int16Array(CELLS).fill(-1), xing: new Int8Array(CELLS).fill(-1) };
      this.roads.set((chunkOf(x) + 0x800) * 0x1000 + chunkOf(y) + 0x800, rc);
      this.lastRoad = rc;
    }
    return rc;
  }
  private roadChunkIf(x: number, y: number): RoadChunk | undefined {
    const cx = chunkOf(x), cy = chunkOf(y);
    if (cx !== this.lastRx || cy !== this.lastRy) { this.lastRoad = this.roads.get((cx + 0x800) * 0x1000 + cy + 0x800); this.lastRx = cx; this.lastRy = cy; }
    return this.lastRoad;
  }

  beginTick() {
    this.present.clear(); this.stopped.clear();
    this.vehicles = 0; this.queued = 0; this.speedSum = 0;
    const t = this.crossPrev; this.crossPrev = this.crossCur; this.crossCur = t; this.crossCur.clear();
    const wt = this.walkPrev; this.walkPrev = this.walkCur; this.walkCur = wt; this.walkCur.clear();
    if (TT.bodyGuard || TT.carGuard) {
      // cars by the tile they are on at the start of the tick, for the body guard (a car moves at most half a tile a tick)
      const g = this.carGrid;
      g.clear();
      for (const q of this.cells.values()) for (const m of q) g.add(Math.floor(m.x), Math.floor(m.y), m);
    }
  }
  private carGrid = new TileLists();
  endTick() {
    const tick = this.w.tick;
    for (const [k, n] of this.present) {
      const st = this.stopped.get(k) ?? 0;
      const target = Math.min(1, (n * 0.25 + st * 0.75) / (2 * TT.laneCap));
      const c = this.cong.get(k);
      const prev = c ? c.v * Math.exp(-(tick - c.at) / DECAY_TAU) : 0;
      const v = prev + (target - prev) * EMA_ALPHA;
      if (c) { c.v = v; c.at = tick; } else this.cong.set(k, { v, at: tick });
      this.dirty.add(k);
    }
    this.congEpoch++; // the router's cached congestion is stale now
    this.lastVehicles = this.vehicles; this.lastQueued = this.queued;
    this.lastSpeedPct = this.vehicles ? this.speedSum / this.vehicles : 1;
  }

  // ---- congestion -------------------------------------------------------------

  congestionAt(x: number, y: number): number {
    const c = this.cong.get(tkey(x, y));
    if (!c) return 0;
    const v = c.v * Math.exp(-(this.w.tick - c.at) / DECAY_TAU);
    if (v < 0.004) { this.cong.delete(tkey(x, y)); this.dirty.add(tkey(x, y)); return 0; }
    return v;
  }
  cost(x: number, y: number): number {
    const cx = chunkOf(x), cy = chunkOf(y);
    let cc = this.lastCost;
    if (cx !== this.lastCx || cy !== this.lastCy) { cc = this.costChunk(cx, cy); this.lastCx = cx; this.lastCy = cy; this.lastCost = cc; }
    const i = localIndex(x, y);
    if (this.w.tick !== this.epochTick) { this.epochTick = this.w.tick; this.congEpoch++; }
    let g: number;
    if (cc.at[i] === this.congEpoch) g = cc.cong[i];
    else { g = cc.cong[i] = this.congestionAt(x, y); cc.at[i] = this.congEpoch; }
    let f = cc.flags[i];
    if (!f) f = cc.flags[i] = 1 | (this.degreeOf(x, y) >= 3 ? 2 : 0) | (this.isCrossingAt(x, y) ? (this.xingOf(x, y) === 1 ? 4 : 8) : 0);
    let c = 1 + TT.congestionWeight * g;
    if (f & 2) c += 0.6;
    if (cc.kerb[i]) c += 0.5;
    // a level crossing: the expected wait for its barriers. A bascule lifts only a few times a day: nothing, but while it
    // is up, a detour (drivers held at it past the stuck limit re-route round it)
    if (f & 12) c += f & 4 ? CROSSING_DELAY : this.barrierDownAt(x, y) ? BASCULE_UP_COST : 0;
    return c;
  }
  private costChunks = new Map<number, CostChunk>();
  private lastCx = NaN; private lastCy = NaN; private lastCost!: CostChunk;
  /** bumped each new tick and by endTick: a cost chunk's congestion read in an earlier epoch is stale */
  private congEpoch = 0; private epochTick = NaN;
  private costChunk(cx: number, cy: number): CostChunk {
    const nk = tkey(cx, cy);
    let cc = this.costChunks.get(nk);
    if (!cc) {
      cc = { cong: new Float64Array(CELLS), at: new Float64Array(CELLS).fill(-1), flags: new Uint8Array(CELLS), kerb: new Uint8Array(CELLS) };
      for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lx = 0; lx < CHUNK_SIZE; lx++) if ((this.w.kerb.get(tkey(cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly)) ?? 0) > 0) cc.kerb[ly * CHUNK_SIZE + lx] = 1;
      this.costChunks.set(nk, cc);
    }
    return cc;
  }
  /** The cost chunk holding tile key k, if there is one yet, leaving the tile's index in it in `costCell`. */
  private costChunkOfKey(k: number): CostChunk | undefined {
    const x = Math.floor(k / 65536) - 0x8000, y = (k % 65536) - 0x8000;
    this.costCell = localIndex(x, y);
    return this.costChunks.get(tkey(chunkOf(x), chunkOf(y)));
  }
  private costCell = 0;
  /** The cost chunk's flags of (x, y), dropped with the degree and crossing caches. */
  private dropCostFlags(x: number, y: number) {
    const cc = this.costChunks.get(tkey(chunkOf(x), chunkOf(y)));
    if (cc) cc.flags[localIndex(x, y)] = 0;
  }
  pathCost(path: number[], from: number): number {
    let c = 0;
    for (let i = from; i * 2 + 1 < path.length; i++) c += this.cost(path[i * 2], path[i * 2 + 1]);
    return c;
  }
  sweep() {
    const tick = this.w.tick;
    for (const [k, c] of this.cong) if (c.v * Math.exp(-(tick - c.at) / DECAY_TAU) < 0.004) { this.cong.delete(k); this.dirty.add(k); }
  }

  // ---- road geometry caches ------------------------------------------------------

  degreeOf(x: number, y: number): number {
    const rc = this.roadChunk(x, y), i = localIndex(x, y);
    let d = rc.deg[i];
    if (d < 0) {
      d = 0;
      for (const [dx, dy] of DIRS) { const t = this.w.peekTile(x + dx, y + dy); if (t !== undefined && isRoad(t)) d++; }
      if (isFlyoverAux(this.junctionAux(x, y))) d = 2; // two roads straight through on two levels: no junction box
      rc.deg[i] = d;
    }
    return d;
  }
  /** The roundabout or flyover byte of a tile (shared/src/junctions.ts), 0 for none. */
  junctionAux(x: number, y: number): number {
    const rc = this.roadChunk(x, y), i = localIndex(x, y);
    let a = rc.jaux[i];
    if (a < 0) { a = this.w.auxAt(x, y); if (!isJunctionAux(a)) a = 0; rc.jaux[i] = a; }
    return a;
  }
  /**
   * Is (x, y) a level crossing (a road tile with straight track over it, shared/src/rail.ts)? A bascule bridge's deck
   * tile counts as one: barriers on its approaches close while it lifts.
   */
  isCrossingAt(x: number, y: number): boolean {
    const rc = this.roadChunk(x, y), i = localIndex(x, y);
    let v = rc.xing[i];
    if (v < 0) {
      const t = this.w.peekTile(x, y), a = this.w.auxAt(x, y);
      v = isCrossing(t, a) ? 1 : isDeck(t, a) && bridgeStyle(a) === BridgeStyle.Bascule ? 2 : 0;
      rc.xing[i] = v;
    }
    return v !== 0;
  }
  /** The crossing cache of (x, y) (isCrossingAt): 1 a level crossing, 2 a bascule deck, 0 neither, -1 not worked out yet. */
  private xingOf(x: number, y: number): number {
    const rc = this.roadChunkIf(x, y);
    return rc ? rc.xing[localIndex(x, y)] : -1;
  }
  /** Are the barriers of the crossing (x, y) down this tick? */
  barrierDownAt(x: number, y: number): boolean {
    const bascule = this.xingOf(x, y) === 2;
    if (!this.barrier && !bascule) return false;
    if (this.barsTick !== this.w.tick) { this.bars.clear(); this.barsTick = this.w.tick; }
    const k = tkey(x, y);
    let v = this.bars.get(k);
    if (v === undefined) { v = bascule ? basculeBarrierAt(x, y, this.auxFn, this.w.tick) : this.barrier!(x, y); this.bars.set(k, v); }
    return v;
  }
  private auxFn = (x: number, y: number) => this.w.auxAt(x, y);
  /** Barriers down at the crossing (x, y), or at a crossing straight after it heading d (side-by-side tracks are crossed in one go)? */
  private crossingClosed(x: number, y: number, d: number): boolean {
    for (let i = 0; i < 4 && this.isCrossingAt(x, y); i++, x += DIRS[d][0], y += DIRS[d][1]) if (this.barrierDownAt(x, y)) return true;
    return false;
  }
  /** Walking from (x0, y0) to (x1, y1) onto a level crossing whose barriers are down? Walkers wait at the edge (simulation.walkOn). */
  barrierAhead(x0: number, y0: number, x1: number, y1: number): boolean {
    const mx = Math.floor((x0 + x1) / 2), my = Math.floor((y0 + y1) / 2);
    // a walker caught on a bascule span when the barriers close walks on off it, as a car drives off
    if (this.isCrossingAt(Math.floor(x0), Math.floor(y0)) && this.xingOf(Math.floor(x0), Math.floor(y0)) === 2) return false;
    return this.isCrossingAt(mx, my) && this.barrierDownAt(mx, my) && !(x0 > mx + 0.02 && x0 < mx + 0.98 && y0 > my + 0.02 && y0 < my + 0.98);
  }
  /** No car is left at the kerb of a roundabout, a flyover, a level crossing or a bridge. */
  kerbless(x: number, y: number): boolean { return !!this.junctionAux(x, y) || this.isCrossingAt(x, y) || isBridgeAux(this.w.auxAt(x, y)); }
  /** Speed factor for a turn through tile (x, y): 0.6 at a plain junction; on a roundabout 1 round a corner, TRAFFIC_TUNING.ringSlow on or off at an arm. */
  private turnSlow(x: number, y: number) {
    const a = this.junctionAux(x, y);
    return !isRingAux(a) ? 0.6 : isArmPos(ringPos(a)) ? TT.ringSlow : 1;
  }
  /** Is (x, y) a flyover tile (positions in tile units)? On one the deck and the road beneath never meet. */
  private flyAt(x: number, y: number) { return isFlyoverAux(this.junctionAux(Math.floor(x), Math.floor(y))); }
  /** Two cars that cannot touch: one is on a flyover tile and they drive along different axes (deck and road beneath). */
  private apart(a: Mover, b: Mover) { return a.lane >= 0 && b.lane >= 0 && isEW(a.lane % 4) !== isEW(b.lane % 4) && (this.flyAt(a.x, a.y) || this.flyAt(b.x, b.y)); }
  isRoadAt(x: number, y: number) { const t = this.w.peekTile(x, y); return t !== undefined && isRoad(t); }
  private invalidate(x: number, y: number) {
    const rc = this.roadChunkIf(x, y);
    if (rc) { const i = localIndex(x, y); rc.deg[i] = -1; rc.jaux[i] = -1; rc.xing[i] = -1; }
    for (const [dx, dy] of DIRS) { const nc = this.roadChunkIf(x + dx, y + dy); if (nc) nc.deg[localIndex(x + dx, y + dy)] = -1; }
    this.dropCostFlags(x, y); for (const [dx, dy] of DIRS) this.dropCostFlags(x + dx, y + dy);
    // signal arms look at diagonal neighbours too (wide-road twins), so re-check the 3x3 around the change
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.junctions.delete(tkey(x + dx, y + dy));
  }
  private roadAt = (x: number, y: number) => this.isRoadAt(x, y);
  /**
   * Junction control, cached. Junctions of three or more arms (not counting
   * the twin lane of a wide road, see signalArms) get signals when the parcel
   * owner has the technology; the cache is dropped around any road change
   * and re-checked when anyone unlocks technology or the tile changes parcel
   * (land bought under an existing road).
   */
  private junction(x: number, y: number): Junction {
    const k = tkey(x, y);
    let j = this.junctions.get(k);
    const deg = this.degreeOf(x, y), pid = this.w.parcelIdAt(x, y);
    if (!j || j.ver !== this.w.techVersion || j.deg !== deg || j.pid !== pid) {
      const signal = deg >= 3 && !this.junctionAux(x, y) && signalledArms(signalArms(this.roadAt, x, y)) && this.w.ownerHas(x, y, 'signals', hasFeature);
      j = j ?? { signal, ver: 0, deg, pid, ...signalTiming(x, y) };
      j.signal = signal; j.ver = this.w.techVersion; j.deg = deg; j.pid = pid;
      this.junctions.set(k, j);
    }
    return j;
  }
  junctionKind(x: number, y: number): 'none' | 'yield' | 'signal' | 'roundabout' | 'flyover' {
    const a = this.junctionAux(x, y);
    if (a) return isRingAux(a) ? 'roundabout' : 'flyover';
    if (this.degreeOf(x, y) < 3) return 'none';
    return this.junction(x, y).signal ? 'signal' : 'yield';
  }
  /** The signal phase at (x,y) now (the same pure function of tick the client draws). Shared scratch: copy what you keep. */
  signalPhase(x: number, y: number): SignalPhase {
    const j = this.junction(x, y);
    if (TT.signalActuated && j.signal) return this.actuated(j, x, y);
    return signalPhaseOf(j, this.w.tick, this.phase);
  }
  /**
   * Actuated lights (TRAFFIC_TUNING.signalActuated, server-side only: the
   * client draws the fixed-time phase). At the point the amber would start,
   * a green is held one more tick while nobody waits on the red approaches and
   * someone is coming on the green ones, up to twice the junction's period.
   */
  private actuated(j: Junction, x: number, y: number): SignalPhase {
    const t = this.w.tick, amber = TT.signalAmber;
    let s = j.act;
    if (!s) { const b = signalPhaseOf(j, t, this.phase); s = j.act = { green: b.green, start: t, end: t + j.period, decided: false, at: t }; }
    if (t >= s.end) { s.green = s.green === 'ns' ? 'ew' : 'ns'; s.start = t; s.end = t + j.period; s.decided = false; }
    if (!s.decided && t >= s.end - amber && s.at !== t) {
      s.at = t;
      const red = s.green === 'ns' ? 'ew' : 'ns';
      if (t - s.start < 2 * j.period && !this.approaching(x, y, red) && this.approaching(x, y, s.green)) s.end = t + amber + 1;
      else s.decided = true;
    }
    this.phase.green = s.green;
    this.phase.amber = s.decided && t >= s.end - amber;
    return this.phase;
  }
  /** Any car in a lane arriving at (x,y) along this axis? */
  private approaching(x: number, y: number, axis: 'ns' | 'ew'): boolean {
    for (let d = 0; d < 4; d++) {
      if (isEW(d) !== (axis === 'ew')) continue;
      const q = this.laneQ(x - DIRS[d][0], y - DIRS[d][1], d);
      if (q && q.length) return true;
    }
    return false;
  }
  green(x: number, y: number): 'ns' | 'ew' { return this.signalPhase(x, y).green; }
  /** Signalled junction whose crossed carriageway has a red now: may a walker heading `xd` (Polyline.xdir) step out? */
  walkSignal(x: number, y: number, xd: number): boolean {
    const ph = this.signalPhase(x, y);
    // the road you walk beside has the green, so the road you cross has red; on a box crossing that is the road you entered by
    return !ph.amber && (ph.green === 'ew') === isEW(xd & 3);
  }

  // ---- occupancy -------------------------------------------------------------

  laneCount(x: number, y: number, dir: number) { return this.laneQ(x, y, dir)?.length ?? 0; }
  onTile(x: number, y: number): number {
    let n = 0;
    for (let d = 0; d < 4; d++) n += this.laneCount(x, y, d);
    return n;
  }
  private capacityInto(x: number, y: number) {
    return Math.max(1, TT.laneCap - ((this.w.kerb.get(tkey(x, y)) ?? 0) > 0 ? 1 : 0));
  }
  /**
   * Is there room for `m` in lane `key` on tile (x,y)? A fixed count of cars
   * (laneCap, one fewer with a car at the kerb), or with laneByLength the
   * bumper-to-bumper length of the queue: every car's length plus MIN_GAP,
   * the newcomer's included, within laneRoom tiles (less a car's worth at the kerb).
   * `extra` cars are already on their way in (the lane before, for boxClear).
   */
  private laneRoom(x: number, y: number, key: number, m: Mover, extra: Mover[] | null = null): boolean {
    const q = this.laneAt(key);
    if (!TT.laneByLength) {
      // two-wheelers (fleet.ts BIKE_CLASS) slip into the space a car leaves and take none of a car's: they do not count,
      // and the following gap alone keeps them clear of whatever is ahead (docs/mobile-jobs.md)
      if (m.cls === BIKE_CLASS) return true;
      let n = extra?.length ?? 0;
      if (q) for (const o of q) if (o.cls !== BIKE_CLASS) n++;
      return n < this.capacityInto(x, y);
    }
    const kerb = (this.w.kerb.get(tkey(x, y)) ?? 0) > 0;
    let used = m.len + MIN_GAP;
    if (q) for (const o of q) used += o.len + MIN_GAP;
    if (extra) for (const o of extra) used += o.len + MIN_GAP;
    const room = TT.laneRoom - (kerb ? VEHICLE_LEN[0] + MIN_GAP : 0);
    return used <= room + 1e-9 || (!q?.length && !extra?.length); // an empty lane always takes one car
  }
  /** Is `m` (in lane m.lane, short of tile B) inside any junction box: the one it is leaving, or B once committed? */
  inJunctionBox(m: Mover): boolean {
    if (m.lane < 0) return false;
    const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1];
    if (this.degreeOf(ax, ay) >= 3 && m.prog < this.clearAt(m)) return true;
    if (m.pi * 2 + 1 < m.path.length) {
      const bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
      if (this.degreeOf(bx, by) >= 3 && (m.committed || m.prog > this.stopLine(m))) return true;
    }
    return false;
  }
  /** Where a mover must stop in its lane to keep its nose out of the next tile. */
  private stopLine(m: Mover) {
    if (!TT.arcAware) return 0.5 - m.len / 2 - STOP_MARGIN;
    return 0.5 - (m.len / 2 + STOP_MARGIN) / ARC(m.inDir, m.lane % 4);
  }
  /** Lane progress at which a car's rear has left the tile its lane starts on (the box it is leaving). */
  private clearAt(m: Mover) {
    if (!TT.arcAware) return 0.5 + m.len / 2;
    return 0.5 + m.len / 2 / ARC(m.lane % 4, this.nextDirOf(m));
  }

  /**
   * Movers physically inside tile T's box right now, with their movement through it: the count, the movers in boxM and
   * their movements in boxIn and boxOut (scratch: read them before the next call).
   */
  private inBox(tx: number, ty: number): number {
    const M = this.boxM, I = this.boxIn, O = this.boxOut;
    let n = 0;
    for (let d = 0; d < 4; d++) {
      // arriving lanes: from the neighbour on the opposite side, heading d
      const q = this.laneQ(tx - DIRS[d][0], ty - DIRS[d][1], d);
      if (q) for (const m of q) if (TT.boxByCommit ? m.committed : m.prog > this.stopLine(m)) { M[n] = m; I[n] = d; O[n] = this.nextDirOf(m); n++; }
      const o = this.laneQ(tx, ty, d);
      if (o) for (const m of o) if (m.prog < this.clearAt(m)) { M[n] = m; I[n] = m.inDir; O[n] = d; n++; }
    }
    return n;
  }
  private boxM: Mover[] = []; private boxIn: number[] = []; private boxOut: number[] = [];
  /**
   * Any car in the box of a tile: what a pedestrian checks before stepping
   * onto the carriageway. With a CROSS_* mask, only cars whose movement uses
   * one of those carriageways count (at lights, traffic going straight along
   * the green road beside you does not cross your path).
   */
  boxBusy(tx: number, ty: number, mask = CROSS_NS_ROAD | CROSS_EW_ROAD): boolean {
    for (let i = 0, n = this.inBox(tx, ty); i < n; i++) if (movementMask(this.boxIn[i], this.boxOut[i]) & mask) return true;
    return false;
  }
  /** A pedestrian is on the carriageway of this tile this tick, over the roads in `mask` (CROSS_*). */
  noteCrossing(k: number, mask = CROSS_NS_ROAD | CROSS_EW_ROAD) { this.crossCur.set(k, (this.crossCur.get(k) ?? 0) | mask); }
  /** Mask of the carriageways pedestrians were on in this tile last tick (0: nobody). */
  crossingsAt(x: number, y: number) {
    const k = tkey(x, y);
    // with the lag removed, a walker who stepped out earlier this tick counts too
    return (this.crossPrev.get(k) ?? 0) | (TT.crossingLag ? 0 : this.crossCur.get(k) ?? 0);
  }

  /** May `m` drive on into its destination building's forecourt (tile bx,by), arriving heading `dir`? */
  private forecourtFree(m: Mover, bx: number, by: number, dir: number): boolean {
    if (!TT.forecourtConflict) return !this.boxBusyExcept(bx, by, m);
    return !this.boxConflict(m, bx, by, dir, dir);
  }
  private boxBusyExcept(tx: number, ty: number, m: Mover): boolean {
    for (let i = 0, n = this.inBox(tx, ty); i < n; i++) if (this.boxM[i] !== m) return true;
    return false;
  }

  private nextDirOf(m: Mover): number {
    const n = m.path.length / 2;
    if (m.pi + 1 >= n) return dirBetween(m.path[(m.pi - 1) * 2], m.path[(m.pi - 1) * 2 + 1], m.path[m.pi * 2], m.path[m.pi * 2 + 1]);
    return dirBetween(m.path[m.pi * 2], m.path[m.pi * 2 + 1], m.path[(m.pi + 1) * 2], m.path[(m.pi + 1) * 2 + 1]);
  }

  /** Can a path be driven at all (two or more nodes)? */
  canDrive(path: number[]) { return path.length >= 4; }
  /**
   * Put a mover on the first lane of its path. 'blocked' while the car that
   * left before it is still too close to the start, so departures from one
   * building (or one entry point) file out one by one instead of stacking.
   */
  enter(m: Mover): 'ok' | 'blocked' {
    this.leave(m);
    m.len = VEHICLE_LEN[m.cls] ?? VEHICLE_LEN[0];
    const d = dirBetween(m.path[0], m.path[1], m.path[2], m.path[3]);
    const key = Traffic.laneKey(m.path[0], m.path[1], d);
    const q = this.laneAt(key);
    const tail = q && q.length ? leaderIn(q, q.length, isBike(m)) : null;
    if (tail && tail.prog < (tail.len + m.len) / 2 + MIN_GAP * m.gapMul) return 'blocked';
    if (TT.spawnClear && this.boxBusyExcept(m.path[0], m.path[1], m)) return 'blocked';
    m.pi = 1; m.prog = 0; m.wait = 0; m.stuck = 0; m.committed = false;
    m.inDir = d;
    if (TT.meterCongestion < 1 && !this.isRoadAt(m.path[0], m.path[1]) && this.congestionAt(m.path[2], m.path[3]) >= TT.meterCongestion) return 'blocked';
    if (TT.spawnClear >= 2 && m.path.length >= 6 && !this.isRoadAt(m.path[0], m.path[1]) && !(m.priority && m.call)) {
      // out of a building: stay in the garage until the road tile would take you, so nobody waits in the forecourt (a fire
      // engine on a call does pull out and waits there, lights flashing, for the traffic to let it in: sim/fires.ts)
      const nd = dirBetween(m.path[2], m.path[3], m.path[4], m.path[5]);
      if (!this.canEnter(m, m.path[2], m.path[3], d, nd)) return 'blocked';
    }
    if (TT.bodyGuard && (this.pedInBody(m, 0) || ((TT.guardDrawn & 4) && this.pedNear(m.x, m.y, m.len / 2 + PED_R + GUARD_MARGIN)))) return 'blocked';
    noteTrail(m, m.path[0], m.path[1]);
    this.push(key, m);
    this.place(m);
    return 'ok';
  }
  leave(m: Mover) {
    if (m.lane < 0) return;
    const q = this.laneAt(m.lane);
    if (q) {
      const i = q.indexOf(m);
      if (i >= 0) q.splice(i, 1);
      if (q.length === 0) this.dropLane(m.lane);
    }
    m.lane = -1; m.committed = false;
  }
  /** The queue of lane (x, y, d), if anyone is in it (the same array as in `cells`). */
  private laneQ(x: number, y: number, d: number): Mover[] | undefined {
    const rc = this.roadChunkIf(x, y);
    return rc ? rc.lanes[localIndex(x, y) * 4 + d] : undefined;
  }
  /** The queue of the lane with key `key` (laneKey), if anyone is in it. */
  private laneAt(key: number): Mover[] | undefined {
    const d = key % 4, t = (key - d) / 4;
    return this.laneQ(Math.floor(t / 65536) - 0x8000, (t % 65536) - 0x8000, d);
  }
  private dropLane(key: number) {
    this.cells.delete(key);
    const d = key % 4, t = (key - d) / 4, x = Math.floor(t / 65536) - 0x8000, y = (t % 65536) - 0x8000;
    const rc = this.roadChunkIf(x, y);
    if (rc) rc.lanes[localIndex(x, y) * 4 + d] = undefined;
  }
  private push(key: number, m: Mover) {
    let q = this.laneAt(key);
    if (!q) { q = []; this.cells.set(key, q); const d = key % 4, t = (key - d) / 4, x = Math.floor(t / 65536) - 0x8000, y = (t % 65536) - 0x8000; this.roadChunk(x, y).lanes[localIndex(x, y) * 4 + d] = q; }
    q.push(m);
    m.lane = key;
  }

  /** World position of a mover from its lane, progress and the turns before and after. */
  private place(m: Mover) {
    const p = this.posAt(m, m.prog, this.tmp);
    m.x = p[0]; m.y = p[1];
  }
  private posAt(m: Mover, prog: number, p: [number, number]): [number, number] {
    const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1];
    const bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
    const d = dirBetween(ax, ay, bx, by);
    const off = isBike(m) ? LANE_OFFSET + BIKE_SIDE : LANE_OFFSET;
    if (prog < 0.5) pathPoint(ax, ay, m.inDir, d, 0.5 + prog, off, p);
    else pathPoint(bx, by, d, this.nextDirOf(m), prog - 0.5, off, p);
    return p;
  }
  /** A progress the body guard can test: on into the next lane (as step() would put it there), or short of the destination. */
  private sweepProg(m: Mover, p: number): number {
    if (p < 1) return p;
    if (m.pi + 1 >= m.path.length / 2) return 0.999;
    return 1 + Math.min(p - 1, 0.3);
  }
  /** Position along m's route at progress p of its lane, where p in [1, 1.5) is that far into the next lane. */
  private posAlong(m: Mover, p: number, out: [number, number]): [number, number] {
    if (p < 1 || m.pi + 1 >= m.path.length / 2) return this.posAt(m, Math.min(p, 0.999), out);
    const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1];
    const bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
    return pathPoint(bx, by, dirBetween(ax, ay, bx, by), this.nextDirOf(m), 0.5 + (p - 1), isBike(m) ? LANE_OFFSET + BIKE_SIDE : LANE_OFFSET, out);
  }
  /**
   * The body guard, last resort behind the entry rules: how far m may move this tick (at most `allowed`) without its
   * body touching a pedestrian or another car's body ahead of it. Bodies near enough to matter are gathered once,
   * then the sweep is checked at thirds and m stops at the last clear one. Bodies behind m are ignored (driving on
   * takes it away from them, and they keep their own distance), as are cars it already touches (moving on ends that).
   */
  private guardSweep(m: Mover, allowed: number): number {
    const h = this.tmp2;
    if (!this.headingOf(m, h)) return allowed;
    const nhx = h[0], nhy = h[1];
    const reach = m.len / 2 + allowed + 0.35;
    const tx = Math.floor(m.x), ty = Math.floor(m.y);
    const peds = this.gPeds, cars = this.gCars;
    peds.length = 0; cars.length = 0;
    if (TT.bodyGuard) {
      let mFly = -1; // flyAt(m.x, m.y), once it is needed
      for (let g = 0; g < 2; g++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = (g ? this.walkPrev : this.walkCur).get(tx + dx, ty + dy);
        if (!l) continue;
        for (const p of l) {
          if (!p.pts) continue; // stopped walking since it was noted
          const ex = p.x - m.x, ey = p.y - m.y;
          if (ex * ex + ey * ey > reach * reach) continue;
          if (this.flyAt(p.x, p.y)) continue; // walkers on a flyover are on the deck or under it, beside the carriageways
          if (mFly < 0) mFly = this.flyAt(m.x, m.y) ? 1 : 0;
          if (mFly) continue;
          // already touching (walking out of a car is always allowed): driving on is how that ends
          if (Math.abs(ex * nhx + ey * nhy) < m.len / 2 + PED_R && Math.abs(-ex * nhy + ey * nhx) < widthOf(m) / 2 + PED_R) continue;
          // behind the car's centre: ignored (pedBehind 0), or only a real touch counts (1: no margin, or a turning car's rear would freeze it next to people on the kerb)
          const ahead = ex * nhx + ey * nhy > 0;
          if (!ahead && !TT.pedBehind) continue;
          peds.push(p.x, p.y, ahead ? GUARD_MARGIN : 0);
        }
      }
    }
    if (TT.carGuard) {
      const now = this.gNow;
      now.x = m.x; now.y = m.y; now.hx = nhx; now.hy = nhy; now.len = m.len;
      const oh = this.tmp3, pool = this.gPool;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = this.carGrid.get(tx + dx, ty + dy);
        if (!q) continue;
        for (const o of q) {
          if (o === m || o.lane < 0 || this.apart(m, o) || this.filtering(m, o)) continue;
          const ex = o.x - m.x, ey = o.y - m.y, rr = reach + o.len / 2 + VEHICLE_WIDTH;
          if (ex * nhx + ey * nhy <= 0 || ex * ex + ey * ey > rr * rr) continue;
          if (!this.headingOf(o, oh)) continue;
          const ob = pool[cars.length] ??= { x: 0, y: 0, hx: 0, hy: 0, len: 0 };
          ob.x = o.x; ob.y = o.y; ob.hx = oh[0]; ob.hy = oh[1]; ob.len = o.len;
          if (obbOverlap(now, ob, 0)) continue;
          cars.push(ob);
        }
      }
    }
    if (!peds.length && !cars.length) return allowed;
    const a = this.gA, b = this.gB, c = this.gC;
    const halfL = m.len / 2 + PED_R + GUARD_MARGIN, halfW = widthOf(m) / 2 + PED_R + marginOf(m);
    for (let k = 1; k <= 3; k++) {
      const p = this.sweepProg(m, m.prog + (allowed * k) / 3);
      this.posAlong(m, Math.max(0, p - 0.01), a); this.posAlong(m, p + 0.01, b); this.posAlong(m, p, c);
      let hx = b[0] - a[0], hy = b[1] - a[1];
      const d = Math.hypot(hx, hy); if (d < 1e-6) continue;
      hx /= d; hy /= d;
      // test the body along its path and as the client will draw it, facing the way it moved this tick
      const cx = c[0] - m.x, cy = c[1] - m.y, cd = Math.hypot(cx, cy);
      const nh = (TT.guardDrawn & 1) && cd > 1e-2 ? 2 : 1;
      let hit = false;
      for (let o = 0; o < nh && !hit; o++) {
        const ux = o === 0 ? hx : cx / cd, uy = o === 0 ? hy : cy / cd;
        for (let i = 0; i < peds.length && !hit; i += 3) {
          const ex = peds[i] - c[0], ey = peds[i + 1] - c[1], pad = peds[i + 2] - GUARD_MARGIN;
          hit = Math.abs(ex * ux + ey * uy) < halfL + pad && Math.abs(-ex * uy + ey * ux) < halfW + pad;
        }
        if (!hit && cars.length) {
          const me = this.gMe;
          me.x = c[0]; me.y = c[1]; me.hx = ux; me.hy = uy; me.len = m.len;
          for (const ob of cars) if (obbOverlap(me, ob, GUARD_MARGIN)) { hit = true; break; }
        }
      }
      if (hit) return (allowed * (k - 1)) / 3;
    }
    return allowed;
  }
  private gPeds: number[] = [];
  /** guardSweep's scratch: m's body now and at a sweep point, the bodies gathered (gCars, from gPool), path points */
  private gNow: Obb = { x: 0, y: 0, hx: 0, hy: 0, len: 0 }; private gMe: Obb = { x: 0, y: 0, hx: 0, hy: 0, len: 0 }; private gPool: Obb[] = [];
  private gA: [number, number] = [0, 0]; private gB: [number, number] = [0, 0]; private gC: [number, number] = [0, 0]; private tmp3: [number, number] = [0, 0];
  /** Any pedestrian within r of (x,y)? (A car pulls out only when nobody is standing where it will appear, whichever way it is drawn.) */
  private pedNear(x: number, y: number, r: number): boolean {
    const tx = Math.floor(x), ty = Math.floor(y);
    for (let g = 0; g < 2; g++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = (g ? this.walkPrev : this.walkCur).get(tx + dx, ty + dy);
      if (l) for (const p of l) if (p.pts && (p.x - x) ** 2 + (p.y - y) ** 2 < r * r) return true;
    }
    return false;
  }
  private gCars: Obb[] = [];
  /**
   * A two-wheeler and a car in the same lane, or one in the lane the other drives into next, both going straight: the
   * bike rides past at the kerb edge. While either is turning, their paths cross and the body guard holds them as any two.
   */
  private filtering(m: Mover, o: Mover): boolean {
    if (isBike(m) === isBike(o)) return false;
    // through a turn: with bikeTurnGuard 1 both are held as any two vehicles; with 2 only the bike gives way (a car is never held by a bike)
    if (TT.bikeTurnGuard && (TT.bikeTurnGuard === 1 || isBike(m)) && (this.turning(m) || this.turning(o))) return false;
    if (o.lane === m.lane) return true;
    const n = m.path.length / 2;
    return m.pi + 1 < n && o.lane === Traffic.laneKey(m.path[m.pi * 2], m.path[m.pi * 2 + 1], this.nextDirOf(m));
  }
  /** Is m on the turning part of its lane: still coming round from the way it entered, or already into the turn ahead? */
  private turning(m: Mover): boolean {
    if (m.lane < 0 || m.pi < 1 || m.pi * 2 + 1 >= m.path.length) return false;
    const d = m.lane % 4;
    return (m.prog < 0.5 && m.inDir !== d) || (m.prog > 0.3 && this.nextDirOf(m) !== d);
  }
  /** Would mover m's body at `prog` (posAlong) touch a pedestrian (body guard)? */
  private pedInBody(m: Mover, prog: number): boolean {
    const a = this.posAlong(m, Math.max(0, prog - 0.01), [0, 0]), b = this.posAlong(m, prog + 0.01, [0, 0]);
    const c = this.posAlong(m, prog, [0, 0]);
    let hx = b[0] - a[0], hy = b[1] - a[1];
    const d = Math.hypot(hx, hy); if (d < 1e-6) return false;
    hx /= d; hy /= d;
    const halfL = m.len / 2 + PED_R + GUARD_MARGIN, halfW = widthOf(m) / 2 + PED_R + marginOf(m);
    const tx = Math.floor(c[0]), ty = Math.floor(c[1]);
    const now = this.headingOf(m, this.tmp2) ? [this.tmp2[0], this.tmp2[1]] : null;
    for (let g = 0; g < 2; g++) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = (g ? this.walkPrev : this.walkCur).get(tx + dx, ty + dy);
        if (!l) continue;
        for (const p of l) {
          if (!p.pts) continue; // stopped walking since it was noted
          if (now && (p.x - m.x) * now[0] + (p.y - m.y) * now[1] <= 0) continue; // behind me: driving on takes me away
          if (this.flyAt(p.x, p.y) || this.flyAt(c[0], c[1])) continue;
          const ex = p.x - c[0], ey = p.y - c[1];
          if (Math.abs(ex * hx + ey * hy) < halfL && Math.abs(-ex * hy + ey * hx) < halfW) return true;
        }
      }
    }
    return false;
  }
  /** Would m's body at `prog` overlap another car's body that it does not already overlap (separating axes)? */
  private carInBody(m: Mover, prog: number): boolean {
    const a = this.posAlong(m, Math.max(0, prog - 0.01), [0, 0]), b = this.posAlong(m, prog + 0.01, [0, 0]);
    const c = this.posAlong(m, prog, [0, 0]);
    let hx = b[0] - a[0], hy = b[1] - a[1];
    const d = Math.hypot(hx, hy); if (d < 1e-6) return false;
    hx /= d; hy /= d;
    const me = { x: c[0], y: c[1], hx, hy, len: m.len };
    const now = this.headingOf(m, this.tmp2) ? { x: m.x, y: m.y, hx: this.tmp2[0], hy: this.tmp2[1], len: m.len } : null;
    const tx = Math.floor(c[0]), ty = Math.floor(c[1]), h: [number, number] = [0, 0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let dd = 0; dd < 4; dd++) {
      const q = this.laneQ(tx + dx, ty + dy, dd);
      if (!q) continue;
      for (const o of q) {
        if (o === m || this.apart(m, o) || this.filtering(m, o)) continue;
        const ex = o.x - c[0], ey = o.y - c[1];
        if (ex * ex + ey * ey > ((m.len + o.len) / 2 + VEHICLE_WIDTH) ** 2 || !this.headingOf(o, h)) continue;
        // only what is ahead: a car behind me keeps its own distance (and a turning car's rear swings toward it)
        if (now && (o.x - m.x) * now.hx + (o.y - m.y) * now.hy <= 0) continue;
        const ob = { x: o.x, y: o.y, hx: h[0], hy: h[1], len: o.len };
        if (!obbOverlap(me, ob, GUARD_MARGIN)) continue;
        if (now && obbOverlap(now, ob, 0)) continue; // already touching: moving on is how it ends
        return true;
      }
    }
    return false;
  }
  /** Is the point (x,y) inside (or within a pedestrian's radius of) any car body on the road? */
  carBodyAt(x: number, y: number): boolean {
    const tx = Math.floor(x), ty = Math.floor(y), h = this.tmp2;
    let fly = -1; // flyAt(x, y), once it is needed
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const q = this.carGrid.get(tx + dx, ty + dy);
      if (!q) continue;
      for (const m of q) {
        if (m.lane < 0) continue;
        const ex = x - m.x, ey = y - m.y;
        if (ex * ex + ey * ey > 0.36) continue;
        if (this.flyAt(m.x, m.y)) continue;
        if (fly < 0) fly = this.flyAt(x, y) ? 1 : 0;
        if (fly || !this.headingOf(m, h)) continue;
        if (Math.abs(ex * h[0] + ey * h[1]) < m.len / 2 + PED_R && Math.abs(-ex * h[1] + ey * h[0]) < widthOf(m) / 2 + PED_R) return true;
        const mh = TT.guardDrawn & 2 ? this.motion.get(m) : undefined; // and as drawn, facing its last move
        if (mh && Math.abs(ex * mh[0] + ey * mh[1]) < m.len / 2 + PED_R && Math.abs(-ex * mh[1] + ey * mh[0]) < widthOf(m) / 2 + PED_R) return true;
      }
    }
    return false;
  }
  /**
   * The car holding m up, when it is another car (for the stuck rule): the car ahead in its lane, the tail of the
   * lane it is following into, the head of a full exit lane, the tail still in the box at a junction, or a car in the
   * next box whose movement conflicts with m's. Null when m is held by something else (a light, pedestrians) or free.
   */
  holderOf(m: Mover): Mover | null {
    if (m.lane < 0) return null;
    const q = this.laneAt(m.lane);
    if (!q) return null;
    const idx = q.indexOf(m);
    if (idx > 0) return q[idx - 1];
    const n = m.path.length / 2;
    if (m.pi >= n) return null;
    const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1], bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
    const dir = dirBetween(ax, ay, bx, by), last = m.pi + 1 >= n;
    const fly = isFlyoverAux(this.junctionAux(bx, by));
    const M = this.boxM, I = this.boxIn, O = this.boxOut;
    if (last) { for (let i = 0, k = this.inBox(bx, by); i < k; i++) if (M[i] !== m && !(fly && isEW(I[i]) !== isEW(dir)) && conflicts(dir, dir, I[i], O[i])) return M[i]; return null; }
    const outD = this.nextDirOf(m);
    const nq = this.laneQ(bx, by, outD);
    if (m.committed) return nq && nq.length ? nq[nq.length - 1] : null;
    if (nq && nq.length && !this.laneRoom(bx, by, Traffic.laneKey(bx, by, outD), m)) return nq[0];
    if (nq && nq.length && this.degreeOf(bx, by) >= 3) { const t = nq[nq.length - 1]; if (t.prog < this.clearAt(t) + MIN_GAP) return t; }
    for (let i = 0, k = this.inBox(bx, by); i < k; i++) if (M[i] !== m && !(fly && isEW(I[i]) !== isEW(dir)) && conflicts(dir, outD, I[i], O[i])) return M[i];
    if (nq && nq.length) return nq[nq.length - 1];
    return null;
  }
  /**
   * Is anything queued behind m: following it in its own lane, or in the lane that leads into the tile its lane starts
   * from (a bus standing at a stop holds those up)?
   */
  queuedBehind(m: Mover): boolean {
    if (m.lane < 0 || m.pi < 1) return false;
    const q = this.laneAt(m.lane);
    if (q && q.indexOf(m) < q.length - 1) return true;
    const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1], d = m.inDir;
    const b = this.laneQ(ax - DIRS[d][0], ay - DIRS[d][1], d);
    return !!b && b.length > 0;
  }
  /** Has a car been held at the stop line into tile (x,y) for at least `ticks` (pedYieldAfter)? */
  carWaitingInto(x: number, y: number, ticks: number): boolean {
    for (let d = 0; d < 4; d++) {
      const q = this.laneQ(x - DIRS[d][0], y - DIRS[d][1], d);
      if (!q || !q.length) continue;
      const h = q[0];
      if (!h.committed && h.wait >= ticks && h.pi * 2 + 1 < h.path.length && h.path[h.pi * 2] === x && h.path[h.pi * 2 + 1] === y) return true;
    }
    return false;
  }
  /** A walker moved this tick (the body guard reads its position live). */
  noteWalker(m: Mover) {
    this.walkCur.add(Math.floor(m.x), Math.floor(m.y), m);
  }
  private tmp2: [number, number] = [0, 0];

  /** The direction a car last moved in (how the client draws it), or false before it has moved. */
  motionOf(m: Mover, out: [number, number]): boolean {
    const h = this.motion.get(m);
    if (!h) return false;
    out[0] = h[0]; out[1] = h[1];
    return true;
  }
  /** Is the mover in the backing-up part of a three-point turn (the client draws it facing against its motion)? */
  reversing(m: Mover): boolean {
    const s = this.turnProgress(m);
    return s >= KTURN.rev0 && s <= KTURN.rev1;
  }
  /** Does a bus turn round on the tile of its halt (a stop at a dead end: it halts once it has turned)? */
  private turnsAtHalt(m: Mover): boolean {
    const h = m.halt ?? -1, p = m.path;
    return h >= 1 && (h + 1) * 2 + 1 < p.length && p[(h - 1) * 2] === p[(h + 1) * 2] && p[(h - 1) * 2 + 1] === p[(h + 1) * 2 + 1];
  }
  /** Has a bus come to its halt (sim/transit.ts): into the lane after the stop's road tile, and turned round if it turns there? */
  atHalt(m: Mover): boolean {
    const h = m.halt ?? -1;
    return h >= 0 && m.pi === h + 1 && m.lane >= 0 && (!this.turnsAtHalt(m) || m.prog >= HALT_TURNED - 0.02);
  }
  /** How far through a turn round the mover is (0..1 through the three-point turn), -1 when it is not turning round. */
  turnProgress(m: Mover): number {
    if (m.lane < 0 || m.pi < 1 || m.pi * 2 + 1 >= m.path.length) return -1;
    const d = m.lane % 4;
    const back = m.prog >= 0.5 ? this.nextDirOf(m) === OPP[d] : m.inDir === OPP[d];
    return back ? (m.prog >= 0.5 ? m.prog - 0.5 : m.prog + 0.5) : -1;
  }
  /** Unit heading of a car on the road from its lane geometry (body-overlap checks); false when it is not on a lane. */
  headingOf(m: Mover, out: [number, number]): boolean {
    if (m.lane < 0 || m.pi < 1 || m.pi * 2 + 1 >= m.path.length) return false;
    // cached per position: most cars are queued and do not move between the many checks of one tick
    const c = this.headings.get(m);
    if (c && c[0] === m.prog && c[1] === m.lane && c[2] === m.pi && c[5] === m.path.length) { out[0] = c[3]; out[1] = c[4]; return true; }
    const a = this.hA, b = this.hB;
    const p0 = Math.max(0, m.prog - 0.01), p1 = Math.min(0.999, m.prog + 0.01);
    this.posAt(m, p0, a); this.posAt(m, p1, b);
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    if (d < 1e-6) return false;
    out[0] = dx / d; out[1] = dy / d;
    if (c) { c[0] = m.prog; c[1] = m.lane; c[2] = m.pi; c[3] = out[0]; c[4] = out[1]; c[5] = m.path.length; }
    else this.headings.set(m, [m.prog, m.lane, m.pi, out[0], out[1], m.path.length]);
    return true;
  }
  private headings = new WeakMap<Mover, number[]>();
  private hA: [number, number] = [0, 0]; private hB: [number, number] = [0, 0];
  /** each car's direction of its last move, which is how the client orients it */
  private motion = new WeakMap<Mover, number[]>();

  /** May `m`, waiting at the edge of tile B, drive into it and on into lane (B→C)? */
  private canEnter(m: Mover, bx: number, by: number, inD: number, outD: number): boolean {
    const nextKey = Traffic.laneKey(bx, by, outD);
    const nq = this.laneAt(nextKey);
    if (!this.laneRoom(bx, by, nextKey, m)) return false;
    // level crossings: never onto one with the barriers down, and only with room to get right off it on the far side;
    // a car still on one when they come down drives off whatever is ahead (lights, give-way, people waiting)
    const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1], onXing = this.isCrossingAt(ax, ay);
    if (!onXing && this.isCrossingAt(bx, by) && (this.crossingClosed(bx, by, inD) || !this.offCrossing(m, bx, by, outD, nq ?? null))) return false;
    const trapped = onXing && this.crossingClosed(ax, ay, inD);
    const deg = this.degreeOf(bx, by);
    // nobody waits in a junction box for a level crossing's barriers: they hold at the junction's stop line instead
    if (deg >= 3 && this.crossingClosed(bx + DIRS[outD][0], by + DIRS[outD][1], outD)) return false;
    const ja = this.junctionAux(bx, by), ring = isRingAux(ja) && TT.ringMerge > 0;
    if (nq && nq.length && deg >= 3 && !ring) {
      // at a junction the car ahead in the exit lane must be out of the box before we go in behind it;
      // on plain road the following gap in step() is all that is needed, so cars can close up inside a tile
      const tail = leaderIn(nq, nq.length, isBike(m));
      if (tail && tail.prog < this.clearAt(tail) + MIN_GAP) return false;
    }
    if (TT.boxClear && (deg >= 3 || TT.boxClear >= 2) && !this.roomBeyond(m, bx, by, outD, nq ?? null)) return false;
    const signal = deg >= 3 && this.junction(bx, by).signal && !trapped;
    const walkers = trapped ? 0 : this.crossingsAt(bx, by);
    if (walkers && ((!signal && !isRingAux(ja)) || (walkers & movementMask(inD, outD)))) {
      // at lights only the crossings this movement drives over hold it (straight through on green passes people crossing the red road);
      // on a roundabout people cross the arms, which cars going round never drive over
      if (TT.carYieldMax <= 0 || m.wait < TT.carYieldMax) return false;
      this.cnt.carNosed++;
    }
    if (signal && !m.priority) {
      // green for my approach axis, and not its amber: cars already committed clear the box before the other axis goes
      const ph = this.signalPhase(bx, by);
      if ((ph.green === 'ew') !== isEW(inD) || ph.amber) return false;
    }
    if (TT.ringYield > 0 && isRingAux(ja) && !m.priority && !trapped && !this.ringGiven(m, bx, by, inD, outD, ja)) return false;
    return !this.boxConflict(m, bx, by, inD, outD, trapped);
  }
  /**
   * Give way on entry to a roundabout: may m come onto ring tile B (aux a) by heading inD, to leave it heading outD?
   * Always when it is already on the ring; from an arm or a driveway only while no car circulating towards B that
   * stays on the ring past it (into the lane m joins), and moving, is within TRAFFIC_TUNING.ringYield tiles of B's
   * box (the lane into B from the ring tile before it, and the lane before that). Cars leaving by B's arm cross nobody.
   */
  private ringGiven(m: Mover, bx: number, by: number, inD: number, outD: number, a: number): boolean {
    const ax = bx - DIRS[inD][0], ay = by - DIRS[inD][1];
    const [ix, iy] = islandOf(bx, by, a), p = ringPos(a);
    const prev = this.junctionAux(ax, ay);
    if (isRingAux(prev)) { const [jx, jy] = islandOf(ax, ay, prev); if (jx === ix && jy === iy) return true; }
    const gap = TT.ringYield, nx = bx + DIRS[outD][0], ny = by + DIRS[outD][1];
    const ux = ix + RING_POS[(p + 7) & 7][0], uy = iy + RING_POS[(p + 7) & 7][1];
    const vx = ix + RING_POS[(p + 6) & 7][0], vy = iy + RING_POS[(p + 6) & 7][1];
    /** does c's route pass node k of its path at (x, y)? */
    const at = (c: Mover, k: number, x: number, y: number) => k * 2 + 1 < c.path.length && c.path[k * 2] === x && c.path[k * 2 + 1] === y;
    const q1 = this.laneQ(ux, uy, dirBetween(ux, uy, bx, by));
    if (q1) for (const c of q1) if (c !== m && c.wait < 2 && at(c, c.pi + 1, nx, ny) && this.stopLine(c) - c.prog < gap) return false;
    const q0 = this.laneQ(vx, vy, dirBetween(vx, vy, ux, uy));
    if (q0) for (const c of q0) if (c !== m && c.wait < 2 && at(c, c.pi + 1, bx, by) && at(c, c.pi + 2, nx, ny) && 1 - c.prog + this.stopLine(c) < gap) return false;
    // never fill the ring: with every lane round it full nobody can move on (each waits for room in the next), so a
    // car comes on only while TRAFFIC_TUNING.ringSpare places stay free, counting cars already committed coming on
    const cap = TT.laneByLength ? Math.floor(TT.laneRoom / (VEHICLE_LEN[0] + MIN_GAP)) : TT.laneCap;
    let n = 1;
    for (let q = 0; q < 8; q++) {
      const rx = ix + RING_POS[q][0], ry = iy + RING_POS[q][1], sx = ix + RING_POS[(q + 1) & 7][0], sy = iy + RING_POS[(q + 1) & 7][1];
      n += this.laneQ(rx, ry, dirBetween(rx, ry, sx, sy))?.length ?? 0;
      if (q & 1) continue;
      // the way in at this side: from the arm (two out from the island) towards the middle tile
      const ox = rx + RING_POS[q][0], oy = ry + RING_POS[q][1];
      const lane = this.laneQ(ox, oy, dirBetween(ox, oy, rx, ry));
      if (lane) for (const c of lane) if (c !== m && c.committed) n++;
    }
    return n <= 8 * cap - TT.ringSpare;
  }
  /**
   * Keep the track clear: may m drive onto level crossing B (on into lane B→C) expecting to get right off it? The car
   * ahead must be off it, and there must be room beyond (roomBeyond). With a junction straight after the crossing a
   * vehicle waits at that junction's stop line with its tail in B: a car is short enough to stand clear of the train
   * there, a longer vehicle goes on only when it could drive straight through the junction now (room in its exit lane,
   * nothing in its way in the box, the light green and not amber).
   */
  private offCrossing(m: Mover, bx: number, by: number, outD: number, nq: Mover[] | null): boolean {
    if (nq && nq.length) { const tail = leaderIn(nq, nq.length, isBike(m)); if (tail && tail.prog < this.clearAt(tail) + MIN_GAP) return false; }
    const i = m.pi + 1, n = m.path.length / 2;
    if (i + 1 >= n) return true; // C is where it is going: the forecourt rule decides
    const cx = m.path[i * 2], cy = m.path[i * 2 + 1];
    if (cx !== bx + DIRS[outD][0] || cy !== by + DIRS[outD][1] || this.degreeOf(cx, cy) < 3) return this.roomBeyond(m, bx, by, outD, nq);
    if (m.len <= XING_SHORT) return true;
    if (nq && nq.length) return false;
    const d2 = dirBetween(cx, cy, m.path[(i + 1) * 2], m.path[(i + 1) * 2 + 1]);
    if (!this.laneRoom(cx, cy, Traffic.laneKey(cx, cy, d2), m)) return false;
    if (this.junction(cx, cy).signal) { const ph = this.signalPhase(cx, cy); if ((ph.green === 'ew') !== isEW(outD) || ph.amber) return false; }
    return !this.boxConflict(m, cx, cy, outD, d2);
  }
  /** Is a movement inD -> outD through tile B blocked by a car already in that box? */
  private boxConflict(m: Mover, bx: number, by: number, inD: number, outD: number, trapped = false): boolean {
    const ja = this.junctionAux(bx, by), fly = isFlyoverAux(ja), ring = isRingAux(ja) && TT.ringMerge > 0;
    for (let i = 0, n = this.inBox(bx, by); i < n; i++) {
      const om = this.boxM[i], oIn = this.boxIn[i], oOut = this.boxOut[i];
      if (om === m) continue;
      if (fly && isEW(oIn) !== isEW(inD)) continue; // on the deck or under it: the other road never meets this one
      if (ring && oOut === outD && om.lane === Traffic.laneKey(bx, by, outD)) continue; // ahead of me in the lane I merge into: I follow it
      if (!conflicts(inD, outD, oIn, oOut)) continue;
      if (TT.conflictRemaining && (oIn !== inD || TT.sameApproachRelax >= 2) && om.lane === Traffic.laneKey(bx, by, oOut)) {
        // already on its way out: only the rest of its path from its rear bumper on can be in my way
        const rear = 0.5 + om.prog - om.len / 2 / ARC(oIn, oOut);
        if (rear > CONFLICT_LAST[((inD * 4 + outD) * 4 + oIn) * 4 + oOut] + 0.04) continue;
      }
      // same approach, other exit: with the relaxation, go once the leader's tail is past the box centre on its way out
      if (TT.sameApproachRelax === 1 && oIn === inD && om.lane === Traffic.laneKey(bx, by, oOut) && om.prog >= om.len / 2 + MIN_GAP) continue;
      // a vehicle getting off a level crossing as the barriers come down goes past anyone standing clear of its path
      if ((TT.passStationary || trapped) && om.wait >= (trapped ? 1 : 2) && this.pathClearOf(m, bx, by, inD, outD, om)) continue;
      return true;
    }
    return false;
  }
  /** Does m's whole path through tile B (inD -> outD) keep its body clear of o's body where o stands now? */
  private pathClearOf(m: Mover, bx: number, by: number, inD: number, outD: number, o: Mover): boolean {
    const h: [number, number] = [0, 0];
    if (!this.headingOf(o, h)) return false;
    const ob = { x: o.x, y: o.y, hx: h[0], hy: h[1], len: o.len };
    const a: [number, number] = [0, 0], b: [number, number] = [0, 0], c: [number, number] = [0, 0];
    for (let s = 0; s <= 1.0001; s += 0.1) {
      pathPoint(bx, by, inD, outD, s, LANE_OFFSET, c);
      pathPoint(bx, by, inD, outD, Math.max(0, s - 0.02), LANE_OFFSET, a);
      pathPoint(bx, by, inD, outD, Math.min(1, s + 0.02), LANE_OFFSET, b);
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      if (obbOverlap({ x: c[0], y: c[1], hx: dx / d, hy: dy / d, len: m.len }, ob, GUARD_MARGIN)) return false;
    }
    return true;
  }
  /**
   * Don't block the box: a car may go into junction B only if it will also be
   * let into the tile after it, counting the cars already in the exit lane
   * (they take those slots first). Plain-road next tiles only; at a junction
   * next door the ordinary entry rules there decide.
   */
  private roomBeyond(m: Mover, bx: number, by: number, outD: number, nq: Mover[] | null): boolean {
    const i = m.pi + 1, n = m.path.length / 2;
    if (i + 1 >= n) return true; // next tile is the destination
    const cx = m.path[i * 2], cy = m.path[i * 2 + 1];
    if (cx !== bx + DIRS[outD][0] || cy !== by + DIRS[outD][1]) return true;
    if (this.degreeOf(cx, cy) >= 3) return true;
    const dx = m.path[(i + 1) * 2], dy = m.path[(i + 1) * 2 + 1];
    const d2 = dirBetween(cx, cy, dx, dy);
    // cars already on their way into that exit lane take its room first: those in it, and those committed into B
    // from another approach that will turn into it
    const ahead: Mover[] = nq ? [...nq] : [];
    for (let d = 0; d < 4; d++) {
      const q = this.laneQ(bx - DIRS[d][0], by - DIRS[d][1], d);
      if (q) for (const o of q) if (o !== m && o.committed && this.nextDirOf(o) === outD) ahead.push(o);
    }
    return this.laneRoom(cx, cy, Traffic.laneKey(cx, cy, d2), m, ahead);
  }

  /**
   * Advance a driver one tick. 'arrived' once the final node is reached (the
   * mover is then off the road), 'stuck' when it has waited past the limit.
   */
  step(m: Mover): 'moving' | 'arrived' | 'stuck' {
    const w = this.w;
    const n = m.path.length / 2;
    if (m.lane < 0 || m.pi >= n) return 'arrived';
    const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1];
    const bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
    const dir = dirBetween(ax, ay, bx, by);
    const last = m.pi + 1 >= n;
    const nextDir = this.nextDirOf(m);

    let base = DRIVE_SPEED * m.speedMul * (m.cls === VehicleClass.Truck || m.cls === VehicleClass.Bus ? 0.8 : 1);
    if ((w.kerb.get(tkey(ax, ay)) ?? 0) > 0) base *= 0.6;
    // turns slow a car for each half; on a roundabout the ring's wide corners not at all, the turns on and off less
    if (nextDir !== dir && m.prog > 0.3) base *= this.turnSlow(bx, by);
    if (m.inDir !== dir && m.prog < 0.3) base *= this.turnSlow(ax, ay);
    // turning round (a bus at the end of its line): a three-point turn takes a while
    if ((nextDir === OPP[dir] && m.prog > 0.4) || (m.inDir === OPP[dir] && m.prog < 0.5)) base *= UTURN_SLOW;

    // follow the car ahead: in this lane, or the tail of the next lane on my route
    const q = this.laneAt(m.lane)!;
    const idx = q.indexOf(m);
    const bike = isBike(m);
    let gap = Infinity;
    // cars follow cars and two-wheelers follow two-wheelers (they filter past each other at the kerb edge)
    const lead = idx > 0 ? leaderIn(q, idx, bike) : null;
    let tailNext: Mover | null = null;
    if (lead) gap = lead.prog - m.prog - (lead.len + m.len) / 2;
    else if (!last) {
      const nq = this.laneQ(bx, by, nextDir);
      tailNext = nq && nq.length ? leaderIn(nq, nq.length, bike) : null;
      if (tailNext) gap = 1 - m.prog + tailNext.prog - (tailNext.len + m.len) / 2;
    }
    let allowed = Math.min(base, gap - MIN_GAP * m.gapMul);
    // progress is a fraction of the lane, and a right-turn arc is shorter than a straight, so also
    // hold the real distance to the car ahead (the chord never overstates the arc, so this is safe)
    const ahead = lead ?? tailNext;
    if (ahead) {
      const dist = Math.hypot(ahead.x - m.x, ahead.y - m.y) - (ahead.len + m.len) / 2 - MIN_GAP * m.gapMul * 0.5;
      if (dist < allowed) allowed = dist;
    }
    if (allowed < 0) allowed = 0;
    // a bus pulling in at a stop (sim/transit.ts): never past the centre of the stop's road tile, path node m.halt
    const halt = m.halt ?? -1;
    if (halt >= 0) {
      const at = this.turnsAtHalt(m) ? HALT_TURNED : HALT_AT;
      const lim = halt === m.pi ? 1 - m.prog + at : halt === m.pi - 1 ? at - m.prog : Infinity;
      if (lim < allowed) allowed = Math.max(0, lim);
    }

    // the stop line: decide once, at the edge of the next tile, whether to go in
    const stop = this.stopLine(m);
    if (!m.committed && m.prog + allowed >= stop) {
      // into the next road tile: the full entry rules; into the destination building: one vehicle in its forecourt at a time
      const ok = last ? this.forecourtFree(m, bx, by, dir) : this.canEnter(m, bx, by, dir, nextDir);
      if (ok) m.committed = true;
      else allowed = Math.max(0, stop - m.prog);
    }

    if ((TT.bodyGuard || TT.carGuard) && allowed > 0) {
      const safe = this.guardSweep(m, allowed);
      if (safe < allowed) { this.cnt.guardCar++; allowed = safe; }
    }

    let moved = 0;
    let arrived = false;
    const ox = m.x, oy = m.y;
    if (m.prog + allowed >= 1) {
      if (last) {
        moved = 1 - m.prog;
        this.leave(m);
        m.x = bx + 0.5; m.y = by + 0.5; m.pi++;
        noteTrail(m, bx, by);
        arrived = true;
      } else {
        const over = m.prog + allowed - 1;
        moved = allowed;
        q.splice(idx, 1); if (q.length === 0) this.dropLane(m.lane);
        this.push(Traffic.laneKey(bx, by, nextDir), m);
        m.inDir = dir; m.pi++; m.prog = Math.min(over, 0.3); m.committed = false;
        // a bus never comes into a lane already past its stop line before a junction: its nose would be in the box,
        // in the way of whatever turns there (a bus turning round sweeps the whole box: sim/busroute.ts)
        if (m.cls === VehicleClass.Bus && m.pi * 2 + 1 < m.path.length && this.degreeOf(m.path[m.pi * 2], m.path[m.pi * 2 + 1]) >= 3) m.prog = Math.min(m.prog, Math.max(0, this.stopLine(m)));
        noteTrail(m, bx, by);
        if (this.degreeOf(bx, by) >= 3) this.cnt.junctionEntries++;
        if (TT.stuckClock) m.stuck = 0; // the stuck clock counts time since the car last reached a new tile
      }
    } else {
      m.prog += allowed; moved = allowed;
    }
    if (!arrived) {
      this.place(m);
      // remember the direction it last moved in: the client draws a car facing its motion, not its path tangent
      const mx = m.x - ox, my = m.y - oy, md = Math.hypot(mx, my);
      if (md > 1e-2) { const h = this.motion.get(m); if (h) { h[0] = mx / md; h[1] = my / md; } else this.motion.set(m, [mx / md, my / md]); }
    }

    const tk = tkey(ax, ay);
    this.present.set(tk, (this.present.get(tk) ?? 0) + 1);
    if (moved < base * 0.3) { this.stopped.set(tk, (this.stopped.get(tk) ?? 0) + 1); this.queued++; }
    this.vehicles++; this.speedSum += Math.min(1, moved / (DRIVE_SPEED * m.speedMul));
    if (moved < 0.02) { m.wait++; if (!m.dwell) m.stuck++; } else m.wait = 0; // a bus dwelling at a stop is not stuck
    if (arrived) return 'arrived';
    return TT.stuckLimit > 0 && m.stuck > TT.stuckLimit ? 'stuck' : 'moving';
  }

  // ---- pedestrians -------------------------------------------------------------

  /**
   * The route a walker actually takes along a tile path: the right-hand
   * sidewalk, tight round right-hand corners, across the box on left turns and
   * straight over side roads at junctions, and a door-to-kerb step at each end
   * that crosses the carriageway when the building is on the far side. Points
   * flagged with a tile key are on that tile's carriageway.
   */
  walkPolyline(path: number[]): Polyline {
    const pts: number[] = [], cross: number[] = [], node: number[] = [], xdir: number[] = [];
    const n = path.length / 2;
    const p = this.tmp;
    const push = (x: number, y: number, c = 0, nd = -1, xd = -1) => { pts.push(x, y); cross.push(c); node.push(nd); xdir.push(xd); };
    const cx = (i: number) => path[i * 2] + 0.5, cy = (i: number) => path[i * 2 + 1] + 0.5;
    const road = (i: number) => this.isRoadAt(path[i * 2], path[i * 2 + 1]);
    const dirAt = (i: number) => dirBetween(path[i * 2], path[i * 2 + 1], path[(i + 1) * 2], path[(i + 1) * 2 + 1]);
    const side = (i: number, d: number, k: number): [number, number] => [cx(i) + k * DIRS[d][0], cy(i) + k * DIRS[d][1]];
    const O = SIDEWALK_OFFSET;
    push(cx(0), cy(0), 0, 0);
    if (n === 1) return { pts, cross, node, xdir };
    if (!road(0) && !road(1)) { push(cx(1), cy(1), 0, 1); return { pts, cross, node, xdir }; }
    for (let i = 1; i < n; i++) {
      const tk = tkey(path[i * 2], path[i * 2 + 1]);
      if (!road(i)) {
        // stepping off the previous road tile into this building
        const inD = dirAt(i - 1); // direction from the road tile into the building
        const travel = i >= 2 ? dirAt(i - 2) : inD; // how we were walking along that road
        const r = RIGHT[travel];
        const [kx, ky] = side(i - 1, inD, O);
        if (inD !== r) push(kx, ky, tkey(path[(i - 1) * 2], path[(i - 1) * 2 + 1]), -1, inD === OPP[r] ? inD : inD + 4); // cross to the far kerb first
        push(cx(i), cy(i), 0, i);
        continue;
      }
      const outD = i + 1 < n ? dirAt(i) : -1;
      const inD = dirAt(i - 1);
      const prevBuilding = !road(i - 1);
      const r = outD >= 0 ? RIGHT[outD] : RIGHT[inD];
      if (prevBuilding) {
        // out of the door onto the near kerb, then across if the sidewalk we need is on the far side
        const [qx, qy] = side(i, OPP[inD], O);
        push(qx, qy, 0, i);
        if (outD >= 0 && OPP[inD] !== r) { const [sx, sy] = side(i, r, O); push(sx, sy, tk, -1, r === inD ? inD : inD + 4); }
        continue;
      }
      if (outD < 0) { const [sx, sy] = side(i, RIGHT[inD], O); push(sx, sy, 0, i); continue; } // leg ends on this road tile
      const nextBuilding = !road(i + 1);
      if (nextBuilding) {
        // walk on along our sidewalk to the point in front of the door; the step off happens next node
        const [sx, sy] = side(i, RIGHT[inD], O);
        push(sx, sy, 0, i);
        continue;
      }
      if (outD === inD) {
        const deg = this.degreeOf(path[i * 2], path[i * 2 + 1]);
        const armRight = this.isRoadAt(path[i * 2] + DIRS[r][0], path[i * 2 + 1] + DIRS[r][1]);
        pathPoint(path[i * 2], path[i * 2 + 1], inD, outD, 0, O, p); push(p[0], p[1], 0, i);
        pathPoint(path[i * 2], path[i * 2 + 1], inD, outD, 1, O, p); push(p[0], p[1], deg >= 3 && armRight ? tk : 0, -1, deg >= 3 && armRight ? inD : -1);
      } else if (outD === RIGHT[inD]) {
        for (const s of [0, 0.5, 1]) { pathPoint(path[i * 2], path[i * 2 + 1], inD, outD, s, O, p); push(p[0], p[1], 0, s === 0 ? i : -1); }
      } else {
        // a left turn crosses the box, except round a roundabout's corner: that is the ring's outer kerb
        const a = this.junctionAux(path[i * 2], path[i * 2 + 1]), x = isRingAux(a) && !isArmPos(ringPos(a)) ? 0 : tk;
        for (let k = 0; k <= 6; k++) { pathPoint(path[i * 2], path[i * 2 + 1], inD, outD, k / 6, O, p); push(p[0], p[1], k === 0 ? 0 : x, k === 0 ? i : -1, k === 0 || !x ? -1 : inD + 4); }
      }
    }
    return { pts, cross, node, xdir };
  }
}
