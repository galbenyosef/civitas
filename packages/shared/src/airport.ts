import { Zone } from './buildings/codes';
import { isRoad, zoneOf, levelOf, underConstruction, isBuildable, isGrowableId, kindIdOf } from './tile';
import { FRONT, structureAt, type Placed } from './structures';
import { hash2 } from './noise';
import { TICKS_PER_DAY } from './constants';
import { timetable, type Airport, type Flight, type PlaneType } from './flights';

/**
 * Airports from the map (docs/airport.md). An airport is two things a player builds:
 *
 *  - an **airport terminal**, a multi-tile structure (kind Zone.Airport, 8×7, door on the road side) whose back
 *    rows are the apron with its gate stands;
 *  - a **runway**, painted by dragging a straight line of at least RUNWAY_MIN tiles behind the terminal. The line is
 *    the runway's centre; the paint covers six rows: far shoulder, centre, near shoulder and three taxiway rows that
 *    run up to the terminal's back edge. Runway tiles are kind None (not a road, not a building) and carry an
 *    **airfield aux byte**: 0xc0 | row << 2 | o, where o is the terminal's orientation (the direction from the runway
 *    towards the terminal, FRONT order) and row is 0-5 across the strip from the far shoulder.
 *
 *     row 0  far shoulder      ─────────────────────────────  (runway edge lights)
 *     row 1  runway centre     ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═ ═  (the dragged line; threshold bars at both ends)
 *     row 2  near shoulder     ─────────────────────────────
 *     row 3  taxiway
 *     row 4  taxiway centre    ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  (planes taxi at TAXI_OFFSET = 3.4 from the centre row)
 *     row 5  taxiway
 *            ┌──── terminal back row (apron, stands at STAND_OFFSET = 6.6) ────┐
 *
 * The geometry is fixed by the flight schedule's layout constants (shared/src/flights.ts), so the runway centre row
 * is always TERMINAL_ROW tiles behind the terminal's back row. The runway tool snaps a dragged line within
 * RUNWAY_SNAP rows of that row onto it, on both the client (preview) and the server.
 *
 * `airportFor()` turns a terminal into an `Airport` descriptor from nothing but tile words and aux bytes, so the
 * server (landing fees, tooltips) and every client (planes) derive the identical descriptor and therefore run the
 * identical flight schedule without a wire message. An airport is operational when the terminal is complete and the
 * whole six-row strip behind it is intact along a runway of at least RUNWAY_MIN tiles that spans the terminal.
 */

export const AIRFIELD_AUX = 0xc0;
export const AIRFIELD_ROWS = 6;
/** row index of the runway centre line within the strip */
export const RUNWAY_CENTRE_ROW = 1;
export const isAirfieldAux = (a: number) => a >= AIRFIELD_AUX && a < AIRFIELD_AUX + AIRFIELD_ROWS * 4;
export const airfieldAux = (o: number, row: number) => AIRFIELD_AUX | ((row & 7) << 2) | (o & 3);
export const airfieldOrientation = (a: number) => a & 3;
export const airfieldRow = (a: number) => (a >> 2) & 7;

export const RUNWAY_MIN = 10;
export const RUNWAY_MAX = 32;
/** a dragged runway line this many rows off the terminal's runway row snaps onto it */
export const RUNWAY_SNAP = 3;
/** rows from the runway centre row to the terminal's back row */
export const TERMINAL_ROW = 5;
/** price per strip tile painted (six per tile of runway length) */
export const RUNWAY_COST = 20;
/** gate stands on the terminal apron (its recipe draws them at ±GATE_PITCH/2 from its centre line) */
export const TERMINAL_GATES = 2;
/** credited to the terminal's owner when a plane lands */
export const LANDING_FEE: Record<PlaneType, number> = { turboprop: 24, narrowbody: 40, bizjet: 16 };
export const SEATS: Record<PlaneType, number> = { turboprop: 68, narrowbody: 174, bizjet: 8 };

/** Arrivals per game hour at the midday base rate, from the runway length: longer runways take more traffic. */
export const flightsPerHourFor = (runwayLen: number) => (runwayLen >= 16 ? 1 : runwayLen >= 13 ? 0.8 : 0.6);
/** Stable airport id (seeds the schedule) from the terminal anchor. */
export const airportId = (ax: number, ay: number) => 1 + Math.floor(hash2(ax * 7 + 3, ay * 13 + 5) * 999_983);

/** What derivation may read: tiles (undefined where not loaded), aux bytes and sub bytes (kind ids, docs/sub-kinds.md). */
export interface AirfieldEnv {
  tile(x: number, y: number): number | undefined;
  aux(x: number, y: number): number;
  sub(x: number, y: number): number;
}

// ---- strip geometry ------------------------------------------------------------------------------
/** +1 or -1: which way the perpendicular world coordinate grows from the runway towards the terminal */
const bsign = (o: number) => (o & 1 ? FRONT[o][0] : FRONT[o][1]);
/** world tile at position `a` along the runway axis and `perp` across it (axis is x for even o, y for odd o) */
const at = (o: number, a: number, perp: number): [number, number] => (o & 1 ? [perp, a] : [a, perp]);
const alongOf = (o: number, x: number, y: number) => (o & 1 ? y : x);
const perpOf = (o: number, x: number, y: number) => (o & 1 ? x : y);
/** The terminal's back row (perp coordinate) and its span along the runway axis. */
export function terminalSpan(p: Placed): { back: number; t0: number; t1: number } {
  const o = p.r;
  const back = o === 0 ? p.ay : o === 2 ? p.ay + p.h - 1 : o === 1 ? p.ax : p.ax + p.w - 1;
  return o & 1 ? { back, t0: p.ay, t1: p.ay + p.h - 1 } : { back, t0: p.ax, t1: p.ax + p.w - 1 };
}
/** perp coordinate of strip row k for a runway centred on `centre` */
const rowPerp = (o: number, centre: number, k: number) => centre + (k - RUNWAY_CENTRE_ROW) * bsign(o);
/** Heading (flights.ts DIRS order) that puts the apron on the right of the runway, towards the terminal. */
const DIR_FOR: readonly (0 | 1 | 2 | 3)[] = [0, 3, 1, 2];
const HEADING_SIGN = [1, -1, 1, -1]; // E +x, W -x, S +y, N -y

function terminalAt(x: number, y: number, env: AirfieldEnv): Placed | null {
  if (!env.aux(x, y)) return null;
  const s = structureAt(x, y, env.aux, env.tile, env.sub);
  return s && s.kind === Zone.Airport ? s : null; // the airport kind itself, not just its family (a bus depot shares code 15)
}

// ---- derivation ----------------------------------------------------------------------------------
export interface RunwayRef { o: number; centre: number; s0: number; s1: number; len: number }
export interface AirportLink {
  terminal: Placed;
  /** the runway found behind the terminal, if any */
  runway: RunwayRef | null;
  /** present only when the airport is operational */
  airport: Airport | null;
  /** 'operational', or why it is not */
  status: string;
  /** false when a tile the answer depends on is not loaded (clients skip such airports) */
  complete: boolean;
  /** the terminal is finished (level 1, no site) */
  built: boolean;
}

/** The airport a terminal makes with the runway behind it, from tile words and aux bytes only. */
export function airportFor(p: Placed, env: AirfieldEnv): AirportLink {
  const o = p.r;
  const { back, t0, t1 } = terminalSpan(p);
  const centre = back - TERMINAL_ROW * bsign(o);
  const code = airfieldAux(o, RUNWAY_CENTRE_ROW);
  const tt = env.tile(p.doorX, p.doorY);
  const built = tt !== undefined && kindIdOf(zoneOf(tt), env.sub(p.doorX, p.doorY)) === Zone.Airport && levelOf(tt) >= 1 && !underConstruction(tt);
  const link: AirportLink = { terminal: p, runway: null, airport: null, status: '', complete: true, built };
  const isCentre = (a: number) => {
    const [x, y] = at(o, a, centre);
    if (env.tile(x, y) === undefined) { link.complete = false; return false; }
    return env.aux(x, y) === code;
  };
  for (let a = t0; a <= t1; a++) if (!isCentre(a)) { link.status = link.complete ? 'no runway behind the terminal' : 'runway not loaded'; return link; }
  let s0 = t0, s1 = t1;
  while (s1 - s0 + 1 < RUNWAY_MAX && isCentre(s0 - 1)) s0--;
  while (s1 - s0 + 1 < RUNWAY_MAX && isCentre(s1 + 1)) s1++;
  const len = s1 - s0 + 1;
  link.runway = { o, centre, s0, s1, len };
  if (len < RUNWAY_MIN) { link.status = `runway too short (${len} of ${RUNWAY_MIN} tiles)`; return link; }
  // the whole strip must be intact: shoulders and taxiway rows, no roads or buildings on it
  for (let a = s0; a <= s1; a++) for (let k = 0; k < AIRFIELD_ROWS; k++) {
    const [x, y] = at(o, a, rowPerp(o, centre, k));
    const t = env.tile(x, y);
    if (t === undefined) { link.complete = false; link.status = 'runway not loaded'; return link; }
    if (env.aux(x, y) !== airfieldAux(o, k) || isRoad(t) || zoneOf(t) !== Zone.None) {
      link.status = `${k === RUNWAY_CENTRE_ROW ? 'runway' : k > 2 ? 'taxiway' : 'runway shoulder'} broken at (${x}, ${y})`;
      return link;
    }
  }
  // one terminal per runway: another terminal along the same strip with a lower start owns it
  for (let a = s0; a <= s1; a++) {
    if (a >= t0 && a <= t1) continue;
    const [x, y] = at(o, a, back);
    const q = terminalAt(x, y, env);
    if (q && q.r === o && terminalSpan(q).back === back && terminalSpan(q).t0 < t0) {
      link.status = `runway already serves the terminal at (${q.doorX}, ${q.doorY})`;
      return link;
    }
  }
  if (!built) { link.status = 'terminal under construction'; return link; }
  const rc = (s0 + s1 + 1) / 2, tc = (t0 + t1 + 1) / 2;
  const mid = (s0 + s1) / 2;
  const [x, y] = o & 1 ? [centre, mid] : [mid, centre];
  const dir = DIR_FOR[o];
  link.airport = {
    id: airportId(p.ax, p.ay), x, y, dir, gates: TERMINAL_GATES, runwayLen: len,
    flightsPerHour: flightsPerHourFor(len), apronU: HEADING_SIGN[dir] * (tc - rc),
  };
  link.status = 'operational';
  return link;
}

/** Every terminal's link, in the order given. Server and client both call this, so they agree on every airport. */
export function deriveAirports(terminals: readonly Placed[], env: AirfieldEnv): AirportLink[] {
  return terminals.map((p) => airportFor(p, env));
}

/** The terminal a runway or taxiway tile belongs to: walk along the runway looking behind it for a terminal. */
export function airfieldTerminal(x: number, y: number, env: AirfieldEnv): Placed | null {
  const a0 = env.aux(x, y);
  if (!isAirfieldAux(a0)) return null;
  const o = airfieldOrientation(a0), k = airfieldRow(a0);
  const perp = perpOf(o, x, y), along = alongOf(o, x, y);
  const centre = perp - (k - RUNWAY_CENTRE_ROW) * bsign(o);
  const back = centre + TERMINAL_ROW * bsign(o);
  const code = airfieldAux(o, k);
  for (const step of [1, -1]) {
    for (let a = step > 0 ? along : along - 1, n = 0; n < RUNWAY_MAX; a += step, n++) {
      const [rx, ry] = at(o, a, perp);
      if (env.aux(rx, ry) !== code) break;
      const [bx, by] = at(o, a, back);
      const q = terminalAt(bx, by, env);
      if (q && q.r === o && terminalSpan(q).back === back) return q;
    }
  }
  return null;
}

// ---- painting a runway ---------------------------------------------------------------------------
export interface RunwayEnv extends AirfieldEnv {
  /** may this player pave (x, y)? a refusal reason, or null when fine */
  land(x: number, y: number): string | null;
}
export interface RunwayPlan {
  ok: boolean;
  reason?: string;
  o?: number; centre?: number; s0?: number; s1?: number;
  terminal?: Placed;
  /** flat x, y, aux for every strip tile, including those already painted */
  tiles?: number[];
  /** strip tiles that are new (they are what the paint costs) */
  fresh?: number;
  cost?: number;
  /** the strip's bounding rectangle, for previews */
  rect?: { x: number; y: number; w: number; h: number };
}

/**
 * Plan a runway from the tiles of a dragged line: straight, long enough, and running behind an airport terminal
 * (the line snaps onto the terminal's runway row from up to RUNWAY_SNAP rows away). The client previews with this
 * and the server places with it.
 */
export function planRunway(line: readonly [number, number][], env: RunwayEnv): RunwayPlan {
  const pts = [...new Map(line.map((p) => [`${p[0]},${p[1]}`, p])).values()];
  if (!pts.length) return { ok: false, reason: 'Drag a straight line for the runway' };
  const sameY = pts.every((p) => p[1] === pts[0][1]), sameX = pts.every((p) => p[0] === pts[0][0]);
  if (!sameX && !sameY) return { ok: false, reason: 'A runway must be a straight line along x or y' };
  const alongX = sameY && (!sameX || pts.length === 1);
  const along = pts.map((p) => (alongX ? p[0] : p[1])).sort((a, b) => a - b);
  for (let i = 1; i < along.length; i++) if (along[i] !== along[i - 1] + 1) return { ok: false, reason: 'A runway must be one unbroken straight line' };
  const s0 = along[0], s1 = along[along.length - 1], len = s1 - s0 + 1;
  const R = alongX ? pts[0][1] : pts[0][0];
  const rect = (o: number, centre: number) => {
    const a = rowPerp(o, centre, 0), b = rowPerp(o, centre, AIRFIELD_ROWS - 1), lo = Math.min(a, b);
    return o & 1 ? { x: lo, y: s0, w: AIRFIELD_ROWS, h: len } : { x: s0, y: lo, w: len, h: AIRFIELD_ROWS };
  };
  if (len < RUNWAY_MIN) return { ok: false, reason: `A runway needs at least ${RUNWAY_MIN} tiles (this is ${len})`, rect: rect(alongX ? 0 : 1, R) };
  if (len > RUNWAY_MAX) return { ok: false, reason: `A runway is at most ${RUNWAY_MAX} tiles long`, rect: rect(alongX ? 0 : 1, R) };
  // find the terminal whose runway row is nearest the dragged line
  let found: { o: number; centre: number; terminal: Placed } | null = null;
  for (const d of [0, 1, -1, 2, -2, 3, -3]) {
    for (const o of alongX ? [0, 2] : [1, 3]) {
      const centre = R + d, back = centre + TERMINAL_ROW * bsign(o);
      for (let a = s0 - 7; a <= s1 + 7 && !found; a++) {
        const [x, y] = at(o, a, back);
        const q = terminalAt(x, y, env);
        if (q && q.r === o && terminalSpan(q).back === back) found = { o, centre, terminal: q };
      }
      if (found) break;
    }
    if (found) break;
  }
  if (!found) return { ok: false, reason: `A runway runs ${TERMINAL_ROW} tiles behind an airport terminal, parallel to its back; none is within ${RUNWAY_SNAP} tiles of this line`, rect: rect(alongX ? 0 : 1, R) };
  const { o, centre, terminal } = found;
  const span = terminalSpan(terminal);
  const plan: RunwayPlan = { ok: false, o, centre, s0, s1, terminal, rect: rect(o, centre) };
  if (span.t0 < s0 || span.t1 > s1) return { ...plan, reason: `The runway must run the full width of the terminal (from ${span.t0} to ${span.t1})` };
  const tiles: number[] = [];
  let fresh = 0;
  for (let a = s0; a <= s1; a++) for (let k = 0; k < AIRFIELD_ROWS; k++) {
    const [x, y] = at(o, a, rowPerp(o, centre, k));
    const want = airfieldAux(o, k);
    const t = env.tile(x, y);
    if (t === undefined) return { ...plan, reason: 'That land is not loaded yet' };
    const have = env.aux(x, y);
    if (have === want) { tiles.push(x, y, want); continue; } // already painted: repainting repairs a gap
    if (!isBuildable(t)) return { ...plan, reason: 'A runway cannot be built on water' };
    if (isRoad(t)) return { ...plan, reason: `A runway cannot cross a road (at ${x}, ${y})` };
    const z = zoneOf(t);
    if (have || (z !== Zone.None && (!isGrowableId(kindIdOf(z, env.sub(x, y))) || levelOf(t) > 0 || underConstruction(t)))) return { ...plan, reason: `The runway needs clear land (something stands at ${x}, ${y})` };
    const why = env.land(x, y);
    if (why) return { ...plan, reason: why };
    tiles.push(x, y, want);
    fresh++;
  }
  return { ...plan, ok: true, tiles, fresh, cost: fresh * RUNWAY_COST };
}

// ---- schedule-derived figures ---------------------------------------------------------------------
/** Passengers on a flight, from its seed: arriving on the inbound leg, departing on the outbound. */
export function flightPassengers(f: Flight): { arriving: number; departing: number } {
  const seats = SEATS[f.type];
  return { arriving: Math.round(seats * (0.55 + 0.4 * f.seed)), departing: Math.round(seats * (0.5 + 0.45 * hash2(f.id, 91))) };
}

export interface AirportDay {
  flights: number; landed: number; departed: number;
  nextArrival?: { tick: number; type: PlaneType };
  nextDeparture?: { tick: number; type: PlaneType };
  /** gates with a plane on the stand (turnaround) right now */
  gatesInUse: number;
  gates: number;
}
/** Today's figures for an airport at a tick, from its timetable alone. */
export function airportDay(ap: Airport, tick: number): AirportDay {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const tt = timetable(ap, day);
  const out: AirportDay = { flights: tt.length, landed: 0, departed: 0, gatesInUse: 0, gates: ap.gates };
  const busy = new Set<number>();
  const next = timetable(ap, day + 1);
  for (const f of tt) {
    if (f.tTouchdown <= tick) out.landed++;
    if (f.tLiftoff <= tick) out.departed++;
    if (tick >= f.tGate && tick < f.tPush) busy.add(f.gate);
    if (f.tTouchdown > tick && (!out.nextArrival || f.tTouchdown < out.nextArrival.tick)) out.nextArrival = { tick: f.tTouchdown, type: f.type };
    if (f.tLiftoff > tick && (!out.nextDeparture || f.tLiftoff < out.nextDeparture.tick)) out.nextDeparture = { tick: f.tLiftoff, type: f.type };
  }
  if (!out.nextArrival && next.length) out.nextArrival = { tick: next[0].tTouchdown, type: next[0].type };
  if (!out.nextDeparture && next.length) { const f = next.reduce((a, b) => (b.tLiftoff < a.tLiftoff ? b : a)); out.nextDeparture = { tick: f.tLiftoff, type: f.type }; }
  out.gatesInUse = busy.size;
  return out;
}
