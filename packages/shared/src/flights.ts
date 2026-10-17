import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { hash2 } from './noise';

/**
 * Airport flight schedule. Like traffic signals this is a pure function of
 * (airport, tick): nothing is stored and nothing goes over the wire, so the
 * server and every client agree on which planes exist and where they are.
 *
 * A game day is generated as a timetable (cached per airport and day): arrivals
 * on a hash-seeded schedule with jitter, each one becoming a departure after
 * its turnaround at a gate. The generator reserves the runway and each gate as time
 * intervals and checks the ground footprints of taxiing planes against each other, delaying a flight by whole slots until
 * nothing overlaps, so one plane uses the runway at a time and a gate holds one
 * plane. A flight that cannot finish inside its own day is cancelled, which also
 * means the runway end used (wind, flipped once per day) never changes mid-flight.
 *
 * Time compression matters: one game hour is only 100 ticks (20 s), so a single
 * approach (~80 ticks) and a turnaround are each about an hour long. A busy
 * single-runway airport tops out at roughly one flight per game hour.
 *
 * Local frame: u runs along the runway axis (in `dir`), v to the right of it
 * (the apron side), both in tiles from the airport tile's centre. Taxi flow is
 * one-way: land in the wind direction, roll to the far end, turn onto the
 * parallel taxiway and come back to the gate; depart by taxiing to the near end
 * and rolling in the wind direction.
 */

export type PlaneType = 'turboprop' | 'narrowbody' | 'bizjet';

export interface PlaneSpec {
  /** tiles (a car is 0.34) */
  length: number;
  wingspan: number;
  /** tiles per tick */
  vApproach: number;
  vTouchdown: number;
  vTaxi: number;
  vPush: number;
  vLiftoff: number;
  vClimb: number;
  /** taxi turn radius in tiles */
  taxiRadius: number;
  /** turnaround at the gate, game minutes */
  dwell: [number, number];
  /** share of traffic */
  weight: number;
}

export const PLANE_TYPES: Record<PlaneType, PlaneSpec> = {
  turboprop: { length: 2.0, wingspan: 2.1, vApproach: 0.52, vTouchdown: 0.4, vTaxi: 0.24, vPush: 0.12, vLiftoff: 0.46, vClimb: 0.6, taxiRadius: 0.8, dwell: [30, 50], weight: 0.28 },
  narrowbody: { length: 3.0, wingspan: 2.6, vApproach: 0.62, vTouchdown: 0.5, vTaxi: 0.26, vPush: 0.12, vLiftoff: 0.58, vClimb: 0.75, taxiRadius: 0.9, dwell: [45, 90], weight: 0.57 },
  bizjet: { length: 1.3, wingspan: 1.2, vApproach: 0.7, vTouchdown: 0.55, vTaxi: 0.28, vPush: 0.12, vLiftoff: 0.64, vClimb: 0.85, taxiRadius: 0.6, dwell: [20, 45], weight: 0.15 },
};
export const PLANE_TYPE_NAMES = Object.keys(PLANE_TYPES) as PlaneType[];

export interface Airport {
  id: number;
  /** tile the runway is centred on */
  x: number;
  y: number;
  /** runway heading, DIRS order: 0 E, 1 W, 2 S, 3 N */
  dir: 0 | 1 | 2 | 3;
  gates: number;
  /** tiles, ~12 */
  runwayLen: number;
  /** arrivals per game hour at the midday base rate (peaks run higher, night is zero) */
  flightsPerHour: number;
  /**
   * Where the middle of the gate row sits along the runway axis, in tiles from the runway centre (default 0).
   * A real airport's terminal need not be centred on its runway (shared/src/airport.ts); x and y may be
   * half-integers for an even-length runway.
   */
  apronU?: number;
}

// ---- layout (tiles) ---------------------------------------------------------------------------
export const RUNWAY_WIDTH = 1.6;
/** taxiway centreline offset from the runway centreline, towards the apron */
export const TAXI_OFFSET = 3.4;
/** gate stand (nose-in, plane's main gear) offset from the runway centreline */
export const STAND_OFFSET = 6.6;
export const GATE_PITCH = 3.3;
/** the terminal front, where noses stop */
export const TERMINAL_OFFSET = 8.6;
/** where the glide path starts, and how high it is there */
export const APPROACH_DIST = 50;
export const APPROACH_ALT = 8;
const TD_INSET = 1.2, EXIT_INSET = 0.8, START_INSET = 1.0, LIFTOFF_INSET = 1.5, ROTATE_DIST = 1.5;
/** timetable granularity: delays come in whole slots */
export const SLOT = 10;
/** nothing is scheduled to land after this hour (so every flight is gone before midnight) */
const LAST_ARRIVAL_HOUR = 21.5;
const DAY_MARGIN = 20;

const DIR_VEC: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface AirportFrame { cx: number; cz: number; ax: number; az: number; nx: number; nz: number }
export function airportFrame(ap: Airport): AirportFrame {
  const [ax, az] = DIR_VEC[ap.dir & 3];
  return { cx: ap.x + 0.5, cz: ap.y + 0.5, ax, az, nx: 0 - az, nz: ax };
}
const runwayLen = (ap: Airport) => Math.max(8, ap.runwayLen);
/** gates that fit beside the runway (the first and last stand stay clear of the runway ends) */
export function gateCount(ap: Airport): number {
  const room = runwayLen(ap) - 2 * 1.4;
  return Math.max(1, Math.min(Math.floor(ap.gates), Math.floor(room / GATE_PITCH) + 1));
}
/** stand i's position along the runway axis */
export const gateU = (ap: Airport, i: number) => (ap.apronU ?? 0) + (i - (gateCount(ap) - 1) / 2) * GATE_PITCH;
/** local (u, v) to world (x, z) */
export function toWorld(ap: Airport, u: number, v: number, out: [number, number] = [0, 0]): [number, number] {
  const f = airportFrame(ap);
  out[0] = f.cx + u * f.ax + v * f.nx;
  out[1] = f.cz + u * f.az + v * f.nz;
  return out;
}
/** +1 when the day's wind has planes land and take off along the runway heading, -1 against it */
export const windOf = (ap: Airport, day: number): 1 | -1 => (hash2(ap.id * 31 + 17, day * 7 + 3) < 0.5 ? 1 : -1);

// ---- small maths ------------------------------------------------------------------------------
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Altitude on the glide path d tiles before touchdown (or after lift-off): straight, flaring out over the last few tiles. */
const FLARE_D = 4;
const GLIDE_SLOPE = APPROACH_ALT / (APPROACH_DIST - FLARE_D / 2);
export function glideAltitude(d: number): number {
  if (d >= FLARE_D) return GLIDE_SLOPE * (d - FLARE_D) + (GLIDE_SLOPE * FLARE_D) / 2;
  if (d <= 0) return 0;
  return ((GLIDE_SLOPE * FLARE_D) / 2) * (d / FLARE_D) ** 2;
}

// ---- ground paths and speed profiles ---------------------------------------------------------
interface Seg { s0: number; len: number; x: number; z: number; dx: number; dz: number; sig: number; theta: number; r: number; cx: number; cz: number }
interface Corner { s0: number; s1: number }

/** A polyline with filleted corners, sampled by arclength. */
class Path {
  segs: Seg[] = [];
  corners: Corner[] = [];
  total = 0;
  constructor(raw: [number, number][], radius: number) {
    const p: [number, number][] = [];
    for (const q of raw) if (!p.length || Math.hypot(q[0] - p[p.length - 1][0], q[1] - p[p.length - 1][1]) > 0.05) p.push(q);
    const n = p.length;
    const dirs: [number, number][] = [], lens: number[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], l = Math.hypot(dx, dz);
      dirs.push([dx / l, dz / l]); lens.push(l);
    }
    let cx = p[0][0], cz = p[0][1], s = 0;
    const line = (tx: number, tz: number, d: [number, number]) => {
      const l = Math.hypot(tx - cx, tz - cz);
      if (l < 1e-6) return;
      this.segs.push({ s0: s, len: l, x: cx, z: cz, dx: d[0], dz: d[1], sig: 0, theta: 0, r: 0, cx: 0, cz: 0 });
      s += l; cx = tx; cz = tz;
    };
    for (let i = 1; i < n - 1; i++) {
      const d1 = dirs[i - 1], d2 = dirs[i];
      const cross = d1[0] * d2[1] - d1[1] * d2[0], dot = d1[0] * d2[0] + d1[1] * d2[1];
      const theta = Math.atan2(Math.abs(cross), dot);
      if (theta < 1e-3) continue;
      const t = Math.min(radius * Math.tan(theta / 2), 0.5 * lens[i - 1], 0.5 * lens[i]);
      const r = t / Math.tan(theta / 2);
      const ax = p[i][0] - d1[0] * t, az = p[i][1] - d1[1] * t;
      line(ax, az, d1);
      const sig = cross > 0 ? 1 : -1;
      const nx = -d1[1], nz = d1[0];
      const arcLen = r * theta;
      this.segs.push({ s0: s, len: arcLen, x: ax, z: az, dx: d1[0], dz: d1[1], sig, theta, r, cx: ax + sig * r * nx, cz: az + sig * r * nz });
      this.corners.push({ s0: s, s1: s + arcLen });
      s += arcLen;
      cx = p[i][0] + d2[0] * t; cz = p[i][1] + d2[1] * t;
    }
    line(p[n - 1][0], p[n - 1][1], dirs[n - 2]);
    this.total = s;
  }
  /** position and heading (atan2(dz, dx)) at arclength S, clamped to the path */
  at(S: number, out: { x: number; z: number; h: number }) {
    const segs = this.segs;
    S = clamp(S, 0, this.total);
    let g = segs[0];
    for (let i = 0; i < segs.length; i++) { g = segs[i]; if (S <= g.s0 + g.len) break; }
    const f = S - g.s0;
    if (g.sig === 0) { out.x = g.x + g.dx * f; out.z = g.z + g.dz * f; out.h = Math.atan2(g.dz, g.dx); return out; }
    const a = g.sig * g.theta * clamp(f / g.len, 0, 1), c = Math.cos(a), sn = Math.sin(a);
    const rx = g.x - g.cx, rz = g.z - g.cz;
    out.x = g.cx + rx * c - rz * sn; out.z = g.cz + rx * sn + rz * c;
    out.h = Math.atan2(g.dx * sn + g.dz * c, g.dx * c - g.dz * sn);
    return out;
  }
}

interface Piece { t0: number; dur: number; s0: number; len: number; v0: number; a: number }
/** Distance travelled over time as constant-acceleration pieces, built by appending ramps, cruises and holds. */
class Profile {
  pieces: Piece[] = [];
  total = 0; // duration
  dist = 0;
  private v = 0;
  ramp(v1: number, d: number) {
    if (d <= 1e-6) { this.v = v1; return this; }
    const v0 = this.v, dur = (2 * d) / (v0 + v1);
    this.pieces.push({ t0: this.total, dur, s0: this.dist, len: d, v0, a: (v1 - v0) / dur });
    this.total += dur; this.dist += d; this.v = v1;
    return this;
  }
  cruise(d: number) { return d > 1e-6 ? this.ramp(this.v, d) : this; }
  hold(dur: number) { this.pieces.push({ t0: this.total, dur, s0: this.dist, len: 0, v0: 0, a: 0 }); this.total += dur; return this; }
  S(t: number): number {
    if (t <= 0) return 0;
    if (t >= this.total) return this.dist;
    for (const p of this.pieces) if (t < p.t0 + p.dur) { const tau = t - p.t0; return p.s0 + p.v0 * tau + 0.5 * p.a * tau * tau; }
    return this.dist;
  }
  /** time at which arclength S is reached */
  tAt(S: number): number {
    for (const p of this.pieces) {
      if (S > p.s0 + p.len + 1e-9) continue;
      const d = Math.max(0, S - p.s0);
      if (Math.abs(p.a) < 1e-9) return p.t0 + (p.v0 > 0 ? d / p.v0 : 0);
      return p.t0 + (-p.v0 + Math.sqrt(Math.max(0, p.v0 * p.v0 + 2 * p.a * d))) / p.a;
    }
    return this.total;
  }
}

interface ArrivalPlan {
  path: Path; prof: Profile;
  /** airborne time from the start of the approach to touchdown, and the speed law d(tau) = vTd*tau + aD*tau^2/2 */
  tApproach: number; aD: number;
  /** touchdown to the end of the braking roll, and to the stand */
  tRoll: number; tGround: number;
  uTd: number;
}
interface DeparturePlan {
  /** pushback duration (stand to taxiway), pivot duration, then the taxi/roll profile up to lift-off */
  pushProf: Profile; tPush: number; tPivot: number;
  path: Path; prof: Profile;
  /** profile time at which the plane reaches the runway, starts rolling, and the arclength where rotation starts */
  tEnter: number; sRoll0: number; sRot: number; tTaxi: number;
  tClimb: number; aC: number;
  uLo: number; pivotFrom: number; pivotTo: number;
  /** half-width of the lateral turn-away and its geometry */
  lateral: number;
}
interface Plan { arr: ArrivalPlan; dep: DeparturePlan }

const planCache = new Map<string, Plan>();
const apKey = (ap: Airport) => `${ap.x},${ap.y},${ap.dir},${runwayLen(ap)},${gateCount(ap)},${ap.apronU ?? 0}`;

function buildPlan(ap: Airport, type: PlaneType, s: 1 | -1, gate: number): Plan {
  const key = `${apKey(ap)}|${type}|${s}|${gate}`;
  const hit = planCache.get(key);
  if (hit) return hit;
  const sp = PLANE_TYPES[type];
  const L = runwayLen(ap), ug = gateU(ap, gate);
  const P = (u: number, v: number): [number, number] => toWorld(ap, u, v);

  // arrival: touchdown -> far end -> across to the taxiway -> back along it -> into the stand
  const uTd = -s * (L / 2 - TD_INSET), uFar = s * (L / 2 - EXIT_INSET);
  const apath = new Path([P(uTd, 0), P(uFar, 0), P(uFar, TAXI_OFFSET), P(ug, TAXI_OFFSET), P(ug, STAND_OFFSET)], sp.taxiRadius);
  const aprof = new Profile();
  const sBrake = apath.corners.length ? apath.corners[0].s0 : apath.total * 0.5;
  const dStop = Math.min(1.0, apath.total * 0.2);
  const arrProf = new Profile();
  arrProf.ramp(sp.vTouchdown, 0); // set the entry speed
  arrProf.ramp(sp.vTaxi, sBrake);
  const tRoll = arrProf.total;
  arrProf.cruise(apath.total - sBrake - dStop);
  arrProf.ramp(0, dStop);
  const tApproach = (2 * APPROACH_DIST) / (sp.vApproach + sp.vTouchdown);
  const arr: ArrivalPlan = { path: apath, prof: arrProf, tApproach, aD: (sp.vApproach - sp.vTouchdown) / tApproach, tRoll, tGround: arrProf.total, uTd };

  // departure: pushback -> pivot -> taxiway to the near end -> onto the runway -> roll -> lift-off
  const uStart = -s * (L / 2 - START_INSET), uLo = s * (L / 2 - LIFTOFF_INSET);
  const dpath = new Path([P(ug, TAXI_OFFSET), P(uStart, TAXI_OFFSET), P(uStart, 0), P(uLo, 0)], sp.taxiRadius);
  const dprof = new Profile();
  const sRoll0 = dpath.corners.length ? dpath.corners[dpath.corners.length - 1].s1 : 0;
  dprof.ramp(sp.vTaxi, Math.min(0.8, sRoll0 || 0.8));
  dprof.cruise(Math.max(0, sRoll0 - dprof.dist));
  dprof.ramp(sp.vLiftoff, dpath.total - dprof.dist);
  const pushProf = new Profile();
  const pd = STAND_OFFSET - TAXI_OFFSET;
  pushProf.ramp(sp.vPush, 0.3).cruise(pd - 0.6).ramp(0, 0.3);
  const first = { x: 0, z: 0, h: 0 };
  dpath.at(0, first);
  const f = airportFrame(ap);
  const pivotFrom = Math.atan2(f.nz, f.nx);
  const tClimb = (2 * APPROACH_DIST) / (sp.vLiftoff + sp.vClimb);
  const dep: DeparturePlan = {
    pushProf, tPush: pushProf.total, tPivot: 10, path: dpath, prof: dprof,
    tEnter: dpath.corners.length ? dprof.tAt(dpath.corners[dpath.corners.length - 1].s0) : 0,
    sRoll0, sRot: dpath.total - ROTATE_DIST, tTaxi: dprof.total, tClimb, aC: (sp.vClimb - sp.vLiftoff) / tClimb, uLo,
    pivotFrom, pivotTo: first.h, lateral: 9 + 5 * hash2(ap.id + gate * 13, 77),
  };
  const plan = { arr, dep };
  if (planCache.size > 200) planCache.clear();
  planCache.set(key, plan);
  return plan;
}

// ---- timetable --------------------------------------------------------------------------------
export interface Flight {
  /** unique across days */
  id: number;
  day: number;
  type: PlaneType;
  gate: number;
  /** runway direction of the day relative to the heading: 1 or -1 */
  wind: 1 | -1;
  /** livery / variation seed in [0,1) */
  seed: number;
  /** absolute ticks */
  tApproach: number;
  tTouchdown: number;
  tGate: number;
  tPush: number;
  tPivotEnd: number;
  tLiftoff: number;
  tEnd: number;
  /** runway occupancy intervals [from, to) as reserved (landing, take-off) */
  landing: [number, number];
  takeoff: [number, number];
}

/** how busy each hour of the day is, as a multiple of flightsPerHour; nothing flies before 05:00 or after 21:30 */
export function trafficShape(hour: number): number {
  if (hour < 5 || hour >= LAST_ARRIVAL_HOUR) return 0;
  if (hour < 7) return 0.5;
  if (hour < 9) return 1.7;
  if (hour < 17) return 1;
  if (hour < 20) return 1.6;
  return 0.5;
}

type Interval = [number, number];
const free = (list: Interval[], a: number, b: number) => { for (const [x, y] of list) if (a < y && b > x) return false; return true; };

const ttCache = new Map<string, Flight[]>();

/** The day's flights in order of approach. Pure in (airport, day). */
export function timetable(ap: Airport, day: number): readonly Flight[] {
  const key = `${apKey(ap)}|${ap.id}|${ap.flightsPerHour}|${day}`;
  const hit = ttCache.get(key);
  if (hit) return hit;
  const flights = generate(ap, day);
  if (ttCache.size > 64) ttCache.clear();
  ttCache.set(key, flights);
  return flights;
}

// ---- ground clearance -------------------------------------------------------------------------
/** A plane's ground footprint is a wingspan-wide, fuselage-long rectangle; the model origin is the main gear, a bit behind the middle. */
const FOOT_FWD = 0.1;
export function footprintsOverlap(ax: number, az: number, ah: number, at: PlaneType, bx: number, bz: number, bh: number, bt: PlaneType, margin = 0): boolean {
  const A = PLANE_TYPES[at], B = PLANE_TYPES[bt];
  const afx = Math.cos(ah), afz = Math.sin(ah), bfx = Math.cos(bh), bfz = Math.sin(bh);
  const acx = ax + afx * A.length * FOOT_FWD, acz = az + afz * A.length * FOOT_FWD;
  const bcx = bx + bfx * B.length * FOOT_FWD, bcz = bz + bfz * B.length * FOOT_FWD;
  const hla = A.length / 2 + margin, hwa = A.wingspan / 2 + margin, hlb = B.length / 2 + margin, hwb = B.wingspan / 2 + margin;
  const dx = bcx - acx, dz = bcz - acz;
  // separating axis test over the four edge normals
  for (let i = 0; i < 4; i++) {
    const ux = i < 2 ? (i === 0 ? afx : -afz) : i === 2 ? bfx : -bfz;
    const uz = i < 2 ? (i === 0 ? afz : afx) : i === 2 ? bfz : bfx;
    const ra = hla * Math.abs(ux * afx + uz * afz) + hwa * Math.abs(-ux * afz + uz * afx);
    const rb = hlb * Math.abs(ux * bfx + uz * bfz) + hwb * Math.abs(-ux * bfz + uz * bfx);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

const GROUND_MARGIN = 0.2;
const AIRBORNE = 0.3;
interface Track { t0: number; type: PlaneType; x: Float32Array; z: Float32Array; h: Float32Array; ground: Uint8Array }
/** Where a flight is on the ground at every whole tick from touchdown to lift-off. */
function makeTrack(ap: Airport, f: Flight): Track {
  const t0 = Math.ceil(f.tTouchdown), n = Math.max(0, Math.floor(f.tLiftoff) - t0 + 1);
  const tr: Track = { t0, type: f.type, x: new Float32Array(n), z: new Float32Array(n), h: new Float32Array(n), ground: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    const s = flightState(ap, f, t0 + i);
    tr.x[i] = s.x; tr.z[i] = s.z; tr.h[i] = s.heading; tr.ground[i] = s.y < AIRBORNE ? 1 : 0;
  }
  return tr;
}
/** Would this flight, between ticks a and b, put any part of itself on top of a scheduled flight? */
function groundConflict(ap: Airport, f: Flight, tracks: Track[], a: number, b: number): boolean {
  const lo = Math.max(Math.ceil(a), Math.ceil(f.tTouchdown)), hi = Math.min(Math.floor(b), Math.floor(f.tLiftoff));
  for (const o of tracks) {
    const from = Math.max(lo, o.t0), to = Math.min(hi, o.t0 + o.x.length - 1);
    for (let t = from; t <= to; t++) {
      const i = t - o.t0;
      if (!o.ground[i]) continue;
      const s = flightState(ap, f, t);
      if (s.y >= AIRBORNE) continue;
      if (footprintsOverlap(s.x, s.z, s.heading, f.type, o.x[i], o.z[i], o.h[i], o.type, GROUND_MARGIN)) return true;
    }
  }
  return false;
}

function generate(ap: Airport, day: number): Flight[] {
  const d0 = day * TICKS_PER_DAY, dayEnd = d0 + TICKS_PER_DAY - DAY_MARGIN;
  const wind = windOf(ap, day);
  const H = (a: number, b: number) => hash2(ap.id * 100003 + day * 977 + a, b + 5);
  // nominal arrivals: stochastic rounding of the hourly rate, spread over the hour with jitter
  const noms: number[] = [];
  for (let h = 0; h < 24; h++) {
    const lam = ap.flightsPerHour * trafficShape(h + 0.5);
    if (lam <= 0) continue;
    const n = Math.floor(lam + H(h, 1));
    for (let i = 0; i < n; i++) noms.push(d0 + (h + (i + 0.5 + (H(h * 64 + i, 2) - 0.5) * 0.7) / n) * TICKS_PER_HOUR);
  }
  noms.sort((a, b) => a - b);

  const runway: Interval[] = [];
  const gates: Interval[][] = Array.from({ length: gateCount(ap) }, () => []);
  const tracks: Track[] = [];
  const out: Flight[] = [];
  const nGates = gates.length;

  noms.forEach((nom, idx) => {
    const r = H(idx, 3);
    let type: PlaneType = 'narrowbody', acc = 0;
    for (const t of PLANE_TYPE_NAMES) { acc += PLANE_TYPES[t].weight; if (r < acc) { type = t; break; } }
    const sp = PLANE_TYPES[type];
    const dwell = Math.round(((sp.dwell[0] + (sp.dwell[1] - sp.dwell[0]) * H(idx, 4)) * TICKS_PER_HOUR) / 60);
    const firstGate = Math.floor(H(idx, 5) * nGates);
    // the nominal time is when the plane appears on the glide path
    const base = Math.ceil(nom + (2 * APPROACH_DIST) / (sp.vApproach + sp.vTouchdown));

    for (let k = 0; k < 400; k++) {
      const tTd = base + k * SLOT;
      if (tTd > dayEnd) return; // cancelled
      for (let j = 0; j < nGates; j++) {
        const g = (firstGate + j) % nGates;
        const { arr, dep } = buildPlan(ap, type, wind, g);
        const landing: Interval = [tTd - 22, tTd + arr.tRoll + 9];
        if (!free(runway, landing[0], landing[1])) break; // runway busy: next slot
        const tGate = tTd + arr.tGround;
        if (!free(gates[g], tGate - 12, tGate + 1)) continue;
        const cand: Flight = {
          id: day * 1000 + idx, day, type, gate: g, wind, seed: H(idx, 6),
          tApproach: tTd - arr.tApproach, tTouchdown: tTd, tGate, tPush: 0, tPivotEnd: 0, tLiftoff: 0, tEnd: 0, landing, takeoff: [0, 0],
        };
        const setDeparture = (m: number) => {
          cand.tPush = tGate + dwell + m * SLOT;
          cand.tPivotEnd = cand.tPush + dep.tPush + dep.tPivot;
          cand.tLiftoff = cand.tPivotEnd + dep.tTaxi;
          cand.tEnd = cand.tLiftoff + dep.tClimb;
          cand.takeoff = [cand.tPivotEnd + dep.tEnter - 2, cand.tLiftoff + 8];
        };
        // physical clearance of the arrival and the shortest turnaround against everything already scheduled
        setDeparture(0);
        if (groundConflict(ap, cand, tracks, tTd, cand.tPush)) continue;
        // departure: delay the pushback in whole slots until runway, gate and the apron are all clear
        for (let m = 0; m < 60; m++) {
          setDeparture(m);
          if (cand.tEnd > dayEnd) break;
          const gateHold: Interval = [tGate - 12, cand.tPush + dep.tPush];
          if (!free(runway, cand.takeoff[0], cand.takeoff[1]) || !free(gates[g], gateHold[0], gateHold[1])) continue;
          if (landing[1] > cand.takeoff[0] && landing[0] < cand.takeoff[1]) continue;
          if (groundConflict(ap, cand, tracks, cand.tPush - 2, cand.tLiftoff)) continue;
          runway.push(landing, cand.takeoff); gates[g].push(gateHold);
          tracks.push(makeTrack(ap, cand));
          out.push(cand);
          return;
        }
      }
    }
  });
  out.sort((a, b) => a.tApproach - b.tApproach);
  return out;
}

// ---- flight state at a tick -------------------------------------------------------------------
export type FlightPhase = 'approach' | 'flare' | 'rollout' | 'taxiIn' | 'dwell' | 'pushback' | 'taxiOut' | 'takeoff' | 'rotate' | 'climb';
export interface FlightLights {
  /** red left / green right wingtips, white tail: always on while the plane exists */
  nav: boolean;
  /** red anti-collision beacon: engines running */
  beacon: boolean;
  /** white strobes: on the runway and airborne */
  strobe: boolean;
  landing: boolean;
  taxi: boolean;
}
export interface FlightState {
  flight: Flight;
  id: number;
  type: PlaneType;
  gate: number;
  seed: number;
  phase: FlightPhase;
  /** 0..1 through the phase */
  progress: number;
  /** world space, tiles; y is the altitude of the main-gear contact point (0 on the ground) */
  x: number;
  y: number;
  z: number;
  /** atan2(dz, dx) in the world xz plane: 0 faces +x, PI/2 faces +z */
  heading: number;
  /** nose up positive, radians */
  pitch: number;
  /** right wing down positive, radians */
  bank: number;
  gear: boolean;
  engines: boolean;
  /** 0..1, ramps in over the first and out over the last few ticks so planes do not pop at the edge of the glide path */
  fade: number;
  lights: FlightLights;
}

const POSE = { x: 0, z: 0, h: 0 };

/** Flights active at this (fractional) tick. */
export function flightsAt(ap: Airport, tick: number, out: FlightState[] = []): FlightState[] {
  out.length = 0;
  const day = Math.floor(tick / TICKS_PER_DAY);
  for (const f of timetable(ap, day)) {
    if (tick < f.tApproach || tick > f.tEnd) continue;
    out.push(flightState(ap, f, tick));
  }
  return out;
}

export function flightState(ap: Airport, f: Flight, tick: number): FlightState {
  const sp = PLANE_TYPES[f.type];
  const plan = buildPlan(ap, f.type, f.wind, f.gate);
  const { arr, dep } = plan;
  const s = f.wind;
  const st: FlightState = {
    flight: f, id: f.id, type: f.type, gate: f.gate, seed: f.seed, phase: 'dwell', progress: 0,
    x: 0, y: 0, z: 0, heading: 0, pitch: 0, bank: 0, gear: true, engines: true, fade: 1,
    lights: { nav: true, beacon: true, strobe: false, landing: false, taxi: false },
  };
  const fa = airportFrame(ap);
  const axisH = Math.atan2(s * fa.az, s * fa.ax);
  const lights = st.lights;
  const world = (u: number, v: number) => { st.x = fa.cx + u * fa.ax + v * fa.nx; st.z = fa.cz + u * fa.az + v * fa.nz; };

  if (tick < f.tTouchdown) {
    // ---- approach and flare
    const tau = f.tTouchdown - tick;
    const d = sp.vTouchdown * tau + 0.5 * arr.aD * tau * tau;
    world(arr.uTd - s * d, 0);
    st.y = glideAltitude(d);
    st.heading = axisH;
    const flare = clamp(1 - d / FLARE_D, 0, 1);
    st.pitch = -0.06 + 0.16 * flare * flare;
    st.phase = d < FLARE_D ? 'flare' : 'approach';
    st.progress = d < FLARE_D ? flare : 1 - tau / arr.tApproach;
    st.gear = d < 36;
    st.fade = clamp((tick - f.tApproach) / 6, 0, 1);
    lights.strobe = true; lights.landing = d < 45;
  } else if (tick < f.tGate) {
    // ---- roll-out and taxi in
    const t = tick - f.tTouchdown;
    arr.path.at(arr.prof.S(t), POSE);
    st.x = POSE.x; st.z = POSE.z; st.heading = POSE.h;
    const rolling = t < arr.tRoll;
    st.phase = rolling ? 'rollout' : 'taxiIn';
    st.progress = rolling ? t / arr.tRoll : (t - arr.tRoll) / (arr.tGround - arr.tRoll);
    st.pitch = 0.1 * clamp(1 - arr.prof.S(t) / 3, 0, 1);
    lights.strobe = rolling; lights.landing = rolling; lights.taxi = !rolling;
    lights.beacon = true;
  } else if (tick < f.tPush) {
    // ---- turnaround
    arr.path.at(arr.path.total, POSE);
    st.x = POSE.x; st.z = POSE.z; st.heading = POSE.h;
    st.phase = 'dwell';
    st.progress = (tick - f.tGate) / Math.max(1, f.tPush - f.tGate);
    st.engines = false; lights.beacon = false;
  } else if (tick < f.tPush + dep.tPush) {
    // ---- pushback: tail first, nose still toward the terminal
    const t = tick - f.tPush;
    const S = dep.pushProf.S(t);
    world(gateU(ap, f.gate), STAND_OFFSET - S);
    st.heading = Math.atan2(fa.nz, fa.nx);
    st.phase = 'pushback'; st.progress = t / dep.tPush;
  } else if (tick < f.tPivotEnd) {
    // ---- the tug turns the plane onto the taxiway heading
    const t = tick - f.tPush - dep.tPush;
    world(gateU(ap, f.gate), TAXI_OFFSET);
    st.heading = dep.pivotFrom + wrapPi(dep.pivotTo - dep.pivotFrom) * smooth01(t / dep.tPivot);
    st.phase = 'pushback'; st.progress = 1;
    lights.taxi = t > dep.tPivot * 0.5;
  } else if (tick < f.tLiftoff) {
    // ---- taxi out, take-off roll, rotation
    const t = tick - f.tPivotEnd;
    const S = dep.prof.S(t);
    dep.path.at(S, POSE);
    st.x = POSE.x; st.z = POSE.z; st.heading = POSE.h;
    if (S >= dep.sRot) {
      st.phase = 'rotate'; st.progress = (S - dep.sRot) / ROTATE_DIST;
      st.pitch = 0.16 * smooth01(st.progress);
      lights.strobe = true; lights.landing = true;
    } else if (S >= dep.sRoll0) {
      st.phase = 'takeoff'; st.progress = (S - dep.sRoll0) / Math.max(1e-6, dep.sRot - dep.sRoll0);
      lights.strobe = true; lights.landing = true;
    } else {
      st.phase = 'taxiOut'; st.progress = S / Math.max(1e-6, dep.sRoll0);
      lights.taxi = true;
      lights.strobe = t >= dep.tEnter; lights.landing = t >= dep.tEnter;
    }
  } else {
    // ---- climb-out with a gentle turn away from the apron
    const tau = tick - f.tLiftoff;
    const vLo = sp.vLiftoff;
    const dist = (t: number) => vLo * t + 0.5 * dep.aC * t * t;
    const d = dist(tau);
    const lat = (dd: number) => dep.lateral * smooth01((dd - 12) / 36);
    const dlat = (dd: number) => { const x = clamp((dd - 12) / 36, 0, 1); return (dep.lateral * 6 * x * (1 - x)) / 36; };
    world(dep.uLo + s * d, -lat(d));
    const hd = (dd: number) => {
      // heading in the local frame is (s, -dlat); convert to world
      const du = s, dv = -dlat(dd);
      return Math.atan2(du * fa.az + dv * fa.nz, du * fa.ax + dv * fa.nx);
    };
    st.heading = hd(d);
    const omega = wrapPi(hd(dist(tau + 0.5)) - st.heading) / 0.5;
    st.bank = clamp(omega * 16, -0.35, 0.35);
    st.y = glideAltitude(d);
    st.pitch = 0.09 + 0.07 * clamp(1 - d / 10, 0, 1);
    st.gear = st.y < 1.5;
    st.phase = 'climb'; st.progress = tau / dep.tClimb;
    st.fade = clamp((f.tEnd - tick) / 6, 0, 1);
    lights.strobe = true; lights.landing = st.y < 6;
  }
  return st;
}

/** Runway-in-use description for tools and the viewer: which end the day's wind favours. */
export function runwayEnds(ap: Airport, day: number): { landFrom: [number, number]; landTo: [number, number]; wind: 1 | -1 } {
  const s = windOf(ap, day), L = runwayLen(ap);
  return { landFrom: toWorld(ap, -s * (L / 2), 0), landTo: toWorld(ap, s * (L / 2), 0), wind: s };
}
