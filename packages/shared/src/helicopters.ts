import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { hash2 } from './noise';
import { nameFor } from './names';
import { CITIES } from './crews';

/**
 * Helicopters (docs/helicopters.md). Like the airport timetable (flights.ts) this is a pure function: of the city's
 * helipads and the tick. Nothing is stored and nothing goes over the wire; every client derives the pads from the
 * buildings in its loaded chunks (shared/src/helipads.ts) and so flies the same helicopters.
 *
 * Pads are the rooftop and ground helipads drawn into building designs: hospitals (air ambulances), police
 * headquarters (the police helicopter), the tallest office towers (executive and charter flights) and Buckingham
 * Palace (the royal flight). A day's flights come from each pad's own hashed timetable; some continue to a second pad
 * of the same service (a patient transfer, a hop between towers). Flights are booked in time order against every pad
 * they touch, delayed in whole slots until each pad is free, so a pad never holds two helicopters; a flight that
 * cannot finish inside its day is cancelled, so nothing is parked over midnight.
 *
 * A flight starts and ends off the map: it appears at cruise height far out (fading in), flies straight to its pad,
 * slows and descends, hovers, turns to the pad's heading and settles; the rotors run down. After the stop it spools
 * up, lifts straight up to a hover, turns onto its course, noses down and accelerates away climbing back to cruise.
 *
 * Space is tiles (x, z on the ground, y up), time is ticks (TICKS_PER_HOUR to the game hour).
 */

/** `news`: a media centre's roof pad (docs/media.md). Its routine timetable is empty; N3's `newsFlights` flies it to stories. */
export type PadKind = 'medical' | 'police' | 'corporate' | 'royal' | 'news';
export type HeliType = 'light' | 'medium';

/** A helipad in world space: the centre of its touchdown circle. */
export interface Pad {
  /** stable id from the building's anchor tile */
  id: number;
  x: number;
  /** height of the pad surface */
  y: number;
  z: number;
  /** radius of the pad's circle */
  r: number;
  kind: PadKind;
  /** heading a helicopter parks at (atan2(dz, dx)): facing the building's front */
  heading: number;
  /** the building's kind id and anchor tile, for names and tooltips */
  building: number;
  bx: number;
  by: number;
}

export interface HeliSpec {
  /** fuselage length and main rotor diameter at full scale, tiles */
  length: number;
  rotor: number;
  /** cruise speed, tiles per tick */
  vCruise: number;
}
/** A light twin (air ambulance, police) and a medium twin (executive, royal). */
export const HELI_TYPES: Record<HeliType, HeliSpec> = {
  light: { length: 0.52, rotor: 0.5, vCruise: 0.52 },
  medium: { length: 0.66, rotor: 0.62, vCruise: 0.58 },
};

// ---- timing and geometry ------------------------------------------------------------------------
/** height above the pad of the lift-off and landing hover */
export const HOVER = 0.55;
/** where flights appear and vanish, tiles from their pad, and the fade there */
export const EDGE_DIST = 72;
const FADE_DIST = 10;
/** cruise height: above every skyline the catalogue draws (the supertall's spire is about 8) */
export const CRUISE_Y = 9.5;
const T_SPOOL = 9, T_LIFT = 6, T_TURN = 5, T_SETTLE = 8, T_SPIN = 10;
/** the steepest part of the climb-out and the final approach, height per tile flown: a rooftop pad is left and reached steeply */
const STEEP = 1.6;
/** pad reservations start this long before touchdown (the final approach and hover) and end this long after lift-off */
const PAD_BEFORE = 24, PAD_AFTER = 14;
const SLOT = 10;
const DAY_MARGIN = 20;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** One point a leg starts or ends at: a pad, or a point off the map at cruise height. */
interface End { x: number; y: number; z: number; pad: Pad | null }

/** Distance travelled over time as constant-acceleration pieces (flights.ts has the same for planes; newsHelis.ts flies the news helicopter with it). */
export class Profile {
  pieces: { t0: number; dur: number; s0: number; v0: number; a: number }[] = [];
  total = 0;
  dist = 0;
  private v: number;
  constructor(v0: number) { this.v = v0; }
  ramp(v1: number, d: number) {
    if (d <= 1e-6) { this.v = v1; return this; }
    const v0 = this.v, dur = (2 * d) / Math.max(1e-6, v0 + v1);
    this.pieces.push({ t0: this.total, dur, s0: this.dist, v0, a: (v1 - v0) / dur });
    this.total += dur; this.dist += d; this.v = v1;
    return this;
  }
  /** distance, speed and acceleration at time t */
  at(t: number): [number, number, number] {
    if (t <= 0) return [0, this.pieces[0]?.v0 ?? 0, 0];
    for (const p of this.pieces) if (t < p.t0 + p.dur) { const tau = t - p.t0; return [p.s0 + p.v0 * tau + 0.5 * p.a * tau * tau, p.v0 + p.a * tau, p.a]; }
    return [this.dist, this.v, 0];
  }
}

/** A straight leg between two ends: hover and turn at a pad end, cruise in from or out to an off-map end. */
interface Leg {
  from: End; to: End;
  /** course over the ground, the heading flown */
  course: number;
  /** ground distance */
  dist: number;
  prof: Profile;
  cruise: number;
  /** phase durations: on the pad before lifting (spool), lift, turn; after arriving: turn, settle, run-down */
  tUp: number; tFly: number; tDown: number;
  total: number;
}

function makeLeg(from: End, to: End, spec: HeliSpec): Leg {
  const dx = to.x - from.x, dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const course = Math.atan2(dz, dx);
  const v = spec.vCruise;
  const top = Math.max(from.y, to.y);
  // a short hop between pads stays lower than a cross-town flight, but well clear of the roofs around them
  const cruise = Math.max(top + 2.5, Math.min(CRUISE_Y, top + 3 + dist * 0.3));
  const prof = new Profile(from.pad ? 0 : v);
  const dAcc = from.pad ? Math.min(dist * 0.35, 4) : 0, dDec = to.pad ? Math.min(dist * 0.4, 5) : 0;
  prof.ramp(v, dAcc).ramp(v, dist - dAcc - dDec).ramp(to.pad ? 0 : v, dDec);
  const tUp = from.pad ? T_SPOOL + T_LIFT + T_TURN : 0, tDown = to.pad ? T_TURN + T_SETTLE + T_SPIN : 0;
  return {
    from, to, course, dist, prof, cruise,
    tUp, tFly: prof.total, tDown, total: tUp + prof.total + tDown,
  };
}

// ---- timetable ----------------------------------------------------------------------------------
export interface HeliStop {
  pad: Pad;
  /** touchdown and lift-off (absolute ticks) */
  tDown: number;
  tUp: number;
}
export interface HeliFlight {
  /** unique across days: day * 10000 + index */
  id: number;
  day: number;
  type: HeliType;
  /** the service: the first stop's pad kind */
  kind: PadKind;
  /** livery and variation seed in [0,1) */
  seed: number;
  /** model scale, so the rotor fits the smallest pad it lands on */
  scale: number;
  /** the pads it lands on, in order (one or two) */
  stops: HeliStop[];
  /** off-map ends: where it comes from and goes to */
  from: [number, number];
  to: [number, number];
  tStart: number;
  tEnd: number;
  /** the legs, built once per flight */
  legs: Leg[];
  /** absolute start tick of each leg */
  legT: number[];
  /** the operator, when it is not picked from HELI_OPERATORS by the seed: a news helicopter flies its channel's livery (newsHelis.ts) */
  op?: HeliOperator;
}

/**
 * Flights a pad starts per day (a small pad, on a one-tile hospital or office, sees fewer than a big one), the hours
 * they arrive in and the stop on the pad (game minutes), by service, and the share that go on to a second pad.
 */
const SERVICE: Record<PadKind, { perDay: [number, number]; perDaySmall: [number, number]; hours: [number, number]; dwell: [number, number]; onward: number }> = {
  medical: { perDay: [2, 5], perDaySmall: [0, 2], hours: [0.5, 23], dwell: [15, 40], onward: 0.3 },
  police: { perDay: [2, 3], perDaySmall: [2, 3], hours: [6, 22], dwell: [60, 150], onward: 0 },
  corporate: { perDay: [1, 3], perDaySmall: [0, 1], hours: [7, 20], dwell: [10, 45], onward: 0.25 },
  royal: { perDay: [0, 1], perDaySmall: [0, 1], hours: [9, 17], dwell: [120, 260], onward: 0 },
  // none yet: the news helicopter waits on its pad until N3 sends it to stories (docs/media.md)
  news: { perDay: [0, 0], perDaySmall: [0, 0], hours: [7, 20], dwell: [10, 30], onward: 0 },
};
/** pads smaller than this are on one-tile buildings */
const SMALL_PAD = 0.25;
/** pads another pad's flight may continue to */
const ONWARD_MIN = 8, ONWARD_MAX = 90;

/** A cache key for a pad list: two clients with the same pads share timetables. */
export function padsKey(pads: readonly Pad[]): string {
  let h = pads.length;
  for (const p of pads) h = Math.imul(h ^ p.id, 2654435761) ^ Math.round(p.x * 64) ^ Math.round(p.z * 64) * 31 ^ Math.round(p.y * 64) * 977;
  return `${pads.length}:${h >>> 0}`;
}

type Interval = [number, number];
const free = (list: Interval[] | undefined, a: number, b: number) => { if (list) for (const [x, y] of list) if (a < y && b > x) return false; return true; };

const ttCache = new Map<string, HeliFlight[]>();
/** Every helicopter flight of a day over these pads (sorted by id), in start order. Pure in (pads, day). */
export function heliTimetable(pads: readonly Pad[], day: number): readonly HeliFlight[] {
  const key = `${padsKey(pads)}|${day}`;
  const hit = ttCache.get(key);
  if (hit) return hit;
  const out = generate(pads, day);
  if (ttCache.size > 32) ttCache.clear();
  ttCache.set(key, out);
  return out;
}

interface Cand { pad: Pad; t: number; n: number; type: HeliType; seed: number; dwell: number[]; onward: Pad | null; inA: number; outA: number }

function generate(padsIn: readonly Pad[], day: number): HeliFlight[] {
  const pads = [...padsIn].sort((a, b) => a.id - b.id);
  const d0 = day * TICKS_PER_DAY, dayEnd = d0 + TICKS_PER_DAY - DAY_MARGIN;
  const cands: Cand[] = [];
  for (const p of pads) {
    const H = (a: number, b: number) => hash2((p.id % 1000003) * 31 + day * 977 + a, b + 13);
    const sv = SERVICE[p.kind];
    const [lo, hi] = p.r < SMALL_PAD ? sv.perDaySmall : sv.perDay;
    const n = lo + Math.floor(H(0, 1) * (hi - lo + 1));
    for (let i = 0; i < n; i++) {
      // spread over the service's hours, one per share of them, with jitter
      const span = sv.hours[1] - sv.hours[0];
      const hour = sv.hours[0] + span * ((i + 0.15 + 0.7 * H(i, 2)) / n);
      const type: HeliType = p.kind === 'medical' || p.kind === 'police' ? 'light' : p.kind === 'royal' ? 'medium' : H(i, 3) < 0.6 ? 'medium' : 'light';
      let onward: Pad | null = null;
      if (H(i, 4) < sv.onward) {
        const near = pads.filter((q) => q !== p && q.kind === p.kind && Math.hypot(q.x - p.x, q.z - p.z) >= ONWARD_MIN && Math.hypot(q.x - p.x, q.z - p.z) <= ONWARD_MAX);
        if (near.length) onward = near[Math.floor(H(i, 5) * near.length)];
      }
      const dw = (k: number) => Math.round(((sv.dwell[0] + (sv.dwell[1] - sv.dwell[0]) * H(i, 6 + k)) * TICKS_PER_HOUR) / 60);
      cands.push({
        pad: p, t: d0 + hour * TICKS_PER_HOUR, n: i, type, seed: H(i, 9), dwell: [dw(0), Math.round(dw(1) * 0.6)], onward,
        inA: H(i, 10) * Math.PI * 2, outA: H(i, 11) * Math.PI * 2,
      });
    }
  }
  cands.sort((a, b) => a.t - b.t || a.pad.id - b.pad.id || a.n - b.n);

  const booked = new Map<number, Interval[]>();
  const out: HeliFlight[] = [];
  for (const c of cands) {
    const spec = HELI_TYPES[c.type];
    for (const withOnward of c.onward ? [true, false] : [false]) {
      const stops = withOnward ? [c.pad, c.onward!] : [c.pad];
      const minR = Math.min(...stops.map((p) => p.r));
      const scale = clamp((minR * 2 * 1.3) / spec.rotor, 0.62, 1);
      const first = stops[0], last = stops[stops.length - 1];
      const from: End = { x: first.x + Math.cos(c.inA) * EDGE_DIST, y: CRUISE_Y, z: first.z + Math.sin(c.inA) * EDGE_DIST, pad: null };
      const to: End = { x: last.x + Math.cos(c.outA) * EDGE_DIST, y: CRUISE_Y, z: last.z + Math.sin(c.outA) * EDGE_DIST, pad: null };
      const ends: End[] = [from, ...stops.map((p): End => ({ x: p.x, y: p.y, z: p.z, pad: p })), to];
      const legs: Leg[] = [];
      for (let k = 0; k + 1 < ends.length; k++) legs.push(makeLeg(ends[k], ends[k + 1], spec));
      let placed = false;
      for (let m = 0; m < 30 && !placed; m++) {
        // the nominal time is when it reaches its first pad
        const tStart = Math.round(c.t + m * SLOT - legs[0].total);
        const legT: number[] = [];
        const st: HeliStop[] = [];
        let t = tStart;
        for (let k = 0; k < legs.length; k++) {
          legT.push(t);
          t += legs[k].total;
          if (k < stops.length) {
            const down = t - T_SPIN;
            const up = down + T_SPIN + c.dwell[k] + T_SPOOL;
            st.push({ pad: stops[k], tDown: down, tUp: up });
            t += c.dwell[k];
          }
        }
        if (tStart < d0 || t > dayEnd) break;
        if (!st.every((s) => free(booked.get(s.pad.id), s.tDown - PAD_BEFORE, s.tUp + PAD_AFTER))) continue;
        for (const s of st) { const l = booked.get(s.pad.id) ?? []; l.push([s.tDown - PAD_BEFORE, s.tUp + PAD_AFTER]); booked.set(s.pad.id, l); }
        out.push({
          id: 0, day, type: c.type, kind: c.pad.kind, seed: c.seed, scale, stops: st, from: [from.x, from.z], to: [to.x, to.z],
          tStart, tEnd: t, legs, legT,
        });
        placed = true;
      }
      if (placed) break;
    }
  }
  out.sort((a, b) => a.tStart - b.tStart || a.stops[0].pad.id - b.stops[0].pad.id);
  out.forEach((f, i) => { f.id = day * 10000 + i; });
  return out;
}

// ---- who flies it ---------------------------------------------------------------------------------
export interface HeliOperator { name: string; body: number; stripe: number; callsign: string }
/** Operators and liveries by service (render/helicopters.ts paints the body and stripe with these). Fictional. */
export const HELI_OPERATORS: Record<PadKind, readonly HeliOperator[]> = {
  medical: [
    { name: 'County Air Ambulance', body: 0xf2d21b, stripe: 0x1c8c3c, callsign: 'Helimed' },
    { name: 'Lifeline Air Ambulance', body: 0xd8262e, stripe: 0xf4f4f0, callsign: 'Lifeline' },
    { name: 'Medevac Air', body: 0xf4f4f0, stripe: 0xd8262e, callsign: 'Medevac' },
  ],
  police: [
    { name: 'Police Air Support', body: 0x16213d, stripe: 0xf2c230, callsign: 'India' },
    { name: 'City Police Air Unit', body: 0xf0f0ec, stripe: 0x2d4a9c, callsign: 'Hotel' },
  ],
  corporate: [
    { name: 'Meridian Executive', body: 0x1b1d22, stripe: 0xc8a24a, callsign: 'Meridian' },
    { name: 'Skyline Charter', body: 0xf4f4f0, stripe: 0x1b6ca8, callsign: 'Skyline' },
    { name: 'Harbour Heli', body: 0x0b3954, stripe: 0xe8c547, callsign: 'Harbour' },
    { name: 'Copperline Executive', body: 0x8c9096, stripe: 0xb4652f, callsign: 'Copper' },
    { name: 'Northstar Charter', body: 0x2b2f36, stripe: 0xc0c6cc, callsign: 'Northstar' },
    { name: 'Verdant Aviation', body: 0x2d6a4f, stripe: 0xf3efe6, callsign: 'Verdant' },
  ],
  royal: [{ name: "The King's Flight", body: 0x6e1a2a, stripe: 0xc9a54a, callsign: 'Crown' }],
  // the channel's own livery comes with N3 (docs/media.md); these stand in for it
  news: [
    { name: 'City News Air', body: 0xf4f4f0, stripe: 0xc8463c, callsign: 'Newshawk' },
    { name: 'Metro Live Air', body: 0x1b1d22, stripe: 0x8e2f6e, callsign: 'Eye' },
  ],
};
/** The operator of a flight, and its callsign and registration, all from the flight's seed. */
export function heliOperator(f: Pick<HeliFlight, 'kind' | 'seed' | 'op'>): HeliOperator & { reg: string; flightNo: string } {
  const list = HELI_OPERATORS[f.kind];
  const k = Math.floor(f.seed * 4194304);
  if (f.op) return { ...f.op, reg: `G-${String.fromCharCode(...[0, 1, 2, 3].map((i) => 65 + Math.floor(hash2(k, 811 + i) * 26)))}`, flightNo: f.op.callsign };
  const op = list[Math.floor(hash2(k, 801) * list.length)];
  const reg = `G-${String.fromCharCode(...[0, 1, 2, 3].map((i) => 65 + Math.floor(hash2(k, 811 + i) * 26)))}`;
  const n = f.kind === 'medical' ? 10 + Math.floor(hash2(k, 821) * 90) : f.kind === 'police' ? 90 + Math.floor(hash2(k, 821) * 10) : 1 + Math.floor(hash2(k, 821) * 40);
  return { ...op, reg, flightNo: `${op.callsign} ${n}` };
}

/** Who is aboard, by service: always a pilot; a paramedic and a doctor, tactical flight officers, a co-pilot. */
export function heliCrew(f: Pick<HeliFlight, 'kind' | 'seed' | 'type'>): { name: string; role: string }[] {
  const k = Math.floor(f.seed * 4194304);
  const who = (n: number, role: string) => ({ name: nameFor(Math.floor(hash2(k, 851 + n) * 4194304)), role });
  const out = [who(0, 'pilot')];
  if (f.kind === 'medical') out.push(who(1, 'paramedic'), who(2, hash2(k, 861) < 0.6 ? 'doctor' : 'critical care paramedic'));
  else if (f.kind === 'police') { out.push(who(1, 'tactical flight officer')); if (hash2(k, 863) < 0.6) out.push(who(2, 'tactical flight officer')); }
  else if (f.kind === 'royal') out.push(who(1, 'co-pilot'), who(2, 'crewman'));
  else if (f.kind === 'news') out.push(who(1, 'camera operator'));
  else if (f.type === 'medium') out.push(who(1, 'co-pilot'));
  return out;
}
/** Passengers on board, by service: a patient on an air ambulance, executives or the royal party; none on a police patrol. */
export function heliPassengers(f: Pick<HeliFlight, 'kind' | 'seed' | 'type'>): number {
  const k = Math.floor(f.seed * 4194304);
  if (f.kind === 'medical') return 1;
  if (f.kind === 'police' || f.kind === 'news') return 0;
  return 1 + Math.floor(hash2(k, 871) * (f.type === 'medium' ? 6 : 3));
}
/** Where a flight comes from and goes to beyond the map: a town, usually the same one. */
export function heliTowns(f: Pick<HeliFlight, 'seed'>): { from: string; to: string } {
  const k = Math.floor(f.seed * 4194304);
  const o = Math.floor(hash2(k, 881) * CITIES.length);
  return { from: CITIES[o], to: hash2(k, 883) < 0.6 ? CITIES[o] : CITIES[(o + 1 + Math.floor(hash2(k, 885) * (CITIES.length - 1))) % CITIES.length] };
}

// ---- state at a tick ----------------------------------------------------------------------------
/** `onScene`: a news helicopter orbiting or hovering over its story (newsHelis.ts) */
export type HeliPhase = 'inbound' | 'approach' | 'landing' | 'onPad' | 'liftoff' | 'departing' | 'outbound' | 'onScene';
export interface HeliState {
  flight: HeliFlight;
  id: number;
  type: HeliType;
  kind: PadKind;
  seed: number;
  scale: number;
  phase: HeliPhase;
  /** the pad it is on, landing at or lifting from, or flying to next; null once it has left the last one */
  pad: Pad | null;
  /** index of the stop that pad is in the flight */
  stop: number;
  /** world space; y is the skids' contact height */
  x: number; y: number; z: number;
  /** atan2(dz, dx); 0 faces +x */
  heading: number;
  /** nose up positive, right side down positive, radians */
  pitch: number; bank: number;
  /** main rotor speed, 0 stopped to 1 flying */
  rotor: number;
  /** ground speed, tiles per tick */
  speed: number;
  /** 0..1 at the off-map ends */
  fade: number;
  lights: { nav: boolean; beacon: boolean; strobe: boolean; landing: boolean };
  /** a news helicopter's errand (newsHelis.ts): the story it covers, the spot its camera looks at, a line for the tooltip */
  news?: HeliNews;
}
/** What a news helicopter is doing (newsHelis.ts). */
export interface HeliNews {
  /** the channel (its owner's player id) and its name on air */
  channel: string; name: string;
  /** the story it is flying to or over (its id), absent on a traffic watch or on the way home */
  story?: number;
  /** what it is doing: 'parked' | 'out' (taking off, flying there) | 'live' (over the scene) | 'home' (flying back, landing) */
  doing: 'parked' | 'out' | 'live' | 'home';
  /** a traffic watch over the rush hour, not a story */
  traffic?: boolean;
  /** the point its camera looks at (tiles, x z) */
  look?: [number, number];
}

/** Every helicopter in the air or on a pad at this (fractional) tick. */
export function helicoptersAt(pads: readonly Pad[], tick: number, out: HeliState[] = []): HeliState[] {
  out.length = 0;
  if (!pads.length) return out;
  const day = Math.floor(tick / TICKS_PER_DAY);
  for (const f of heliTimetable(pads, day)) if (tick >= f.tStart && tick <= f.tEnd) out.push(heliState(f, tick));
  return out;
}

/** The pose of a flight at a tick between its start and end. */
export function heliState(f: HeliFlight, tick: number): HeliState {
  const st: HeliState = {
    flight: f, id: f.id, type: f.type, kind: f.kind, seed: f.seed, scale: f.scale, phase: 'inbound', pad: null, stop: 0,
    x: 0, y: 0, z: 0, heading: 0, pitch: 0, bank: 0, rotor: 1, speed: 0, fade: 1,
    lights: { nav: true, beacon: true, strobe: true, landing: false },
  };
  // which leg, or which stop
  let k = f.legs.length - 1;
  for (let i = 0; i < f.legs.length; i++) if (tick < f.legT[i] + f.legs[i].total) { k = i; break; }
  const stop = f.stops.find((s, i) => i < k && tick >= f.legT[i] + f.legs[i].total && tick < f.legT[i + 1]);
  // a little organic wobble in the hover and while idling on the pad, per flight
  const ws = f.seed * 97;
  const wob = (a: number, fr: number, o: number) => a * (Math.sin(tick * fr + ws + o) * 0.6 + Math.sin(tick * fr * 2.3 + ws * 1.7 + o) * 0.4);
  if (stop) {
    // parked between legs
    const i = f.stops.indexOf(stop);
    const p = stop.pad;
    st.phase = 'onPad'; st.pad = p; st.stop = i;
    st.x = p.x; st.y = p.y; st.z = p.z; st.heading = landingHeading(f, i);
    // a short stop keeps the rotors turning slowly; a long one shuts down
    const short = stop.tUp - stop.tDown < 0.4 * TICKS_PER_HOUR;
    st.rotor = short ? 0.35 : 0;
    st.lights.beacon = short; st.lights.strobe = false;
    return st;
  }
  const leg = f.legs[k];
  const t = tick - f.legT[k];
  const padFrom = leg.from.pad, padTo = leg.to.pad;
  const stopFrom = k - 1;
  const parkedFrom = padFrom ? landingHeading(f, stopFrom) : leg.course;
  const parkedTo = padTo ? landingHeading(f, k) : leg.course;
  if (t < leg.tUp) {
    // ---- on the pad: spool up, lift into the hover, turn onto the course
    const p = padFrom!;
    st.pad = p; st.stop = stopFrom;
    st.x = p.x; st.z = p.z; st.y = p.y;
    if (t < T_SPOOL) {
      // from idle after a short stop, from rest after a long one
      const prev = f.stops[stopFrom], idle = prev && prev.tUp - prev.tDown < 0.4 * TICKS_PER_HOUR ? 0.35 : 0;
      st.phase = 'onPad'; st.heading = parkedFrom;
      st.rotor = idle + (1 - idle) * smooth01(t / T_SPOOL);
      st.lights.strobe = false;
    } else {
      st.phase = 'liftoff';
      const u = (t - T_SPOOL) / T_LIFT;
      st.y = p.y + HOVER * smooth01(u);
      st.heading = parkedFrom + wrapPi(leg.course - parkedFrom) * smooth01((t - T_SPOOL - T_LIFT * 0.6) / T_TURN);
      const w = smooth01(u * 1.5);
      st.x += wob(0.012, 0.9, 0) * w; st.z += wob(0.012, 0.8, 2) * w; st.y += wob(0.008, 1.1, 4) * w;
      st.pitch = wob(0.02, 0.7, 6) * w; st.bank = wob(0.025, 0.6, 8) * w;
      st.lights.landing = true;
    }
    return st;
  }
  if (t < leg.tUp + leg.tFly || !padTo) {
    // ---- flying the leg
    const [s, v, a] = leg.prof.at(Math.min(t - leg.tUp, leg.tFly));
    const fx = leg.dist > 1e-6 ? (leg.to.x - leg.from.x) / leg.dist : 1, fz = leg.dist > 1e-6 ? (leg.to.z - leg.from.z) / leg.dist : 0;
    st.x = leg.from.x + fx * s; st.z = leg.from.z + fz * s;
    // climb away and descend in at STEEP near the pads, easing into the cruise height further out
    const sd = leg.dist - s;
    let y = leg.cruise;
    if (padFrom) y = Math.min(y, steep(padFrom.y + HOVER, leg.cruise, s));
    if (padTo) y = Math.min(y, steep(padTo.y + HOVER, leg.cruise, sd));
    st.y = y;
    st.heading = leg.course;
    st.speed = v;
    // nose down with speed and while accelerating, up in the flare
    st.pitch = clamp(-0.13 * (v / HELI_TYPES[f.type].vCruise) - 3.5 * a, -0.22, 0.2);
    // slow airborne wander, livelier near the pads
    const near = clamp(1 - Math.min(s, sd) / 6, 0, 1);
    st.bank = wob(0.02 + 0.02 * near, 0.25, 10); st.y += wob(0.02, 0.2, 12);
    st.pad = padTo ?? null; st.stop = padTo ? k : -1;
    const band = (top: number) => (2 * (leg.cruise - top)) / STEEP;
    st.phase = padTo ? (sd < band(padTo.y + HOVER) ? 'approach' : 'inbound') : padFrom && s < band(padFrom.y + HOVER) ? 'departing' : 'outbound';
    if (!padFrom && !padTo) st.phase = 'outbound';
    // fade at the off-map ends
    if (!padFrom) st.fade = Math.min(st.fade, clamp(s / FADE_DIST, 0, 1));
    if (!padTo) st.fade = Math.min(st.fade, clamp(sd / FADE_DIST, 0, 1));
    st.lights.landing = (padTo !== null && sd < 14) || (padFrom !== null && s < 8);
    return st;
  }
  // ---- arrived over the pad: turn to its heading in the hover, settle, run the rotors down
  const p = padTo!;
  const td = t - leg.tUp - leg.tFly;
  st.pad = p; st.stop = k;
  st.x = p.x; st.z = p.z;
  if (td < T_TURN + T_SETTLE) {
    st.phase = 'landing';
    st.heading = leg.course + wrapPi(parkedTo - leg.course) * smooth01(td / T_TURN);
    const u = clamp((td - T_TURN) / T_SETTLE, 0, 1);
    st.y = p.y + HOVER * (1 - u * u * (3 - 2 * u));
    const w = 1 - smooth01(u * 1.4 - 0.4);
    st.x += wob(0.012, 0.9, 1) * w; st.z += wob(0.012, 0.8, 3) * w; st.y += wob(0.008, 1.1, 5) * w;
    st.pitch = wob(0.02, 0.7, 7) * w + 0.03 * (1 - u); st.bank = wob(0.025, 0.6, 9) * w;
    st.lights.landing = true;
  } else {
    st.phase = 'onPad'; st.y = p.y; st.heading = parkedTo;
    const nextStop = f.stops[k];
    const short = nextStop && nextStop.tUp - nextStop.tDown < 0.4 * TICKS_PER_HOUR;
    const u = (td - T_TURN - T_SETTLE) / T_SPIN;
    st.rotor = 1 - (1 - (short ? 0.35 : 0)) * smooth01(u);
    st.lights.strobe = false;
  }
  return st;
}

/** Height d tiles (along the ground) from a pad's hover point at y0: rising at STEEP, easing out into the cruise. */
function steep(y0: number, cruise: number, d: number): number {
  const dy = cruise - y0;
  if (dy <= 0) return cruise;
  const u = Math.min(1, (d * STEEP) / (2 * dy));
  return y0 + dy * (1 - (1 - u) * (1 - u));
}

/** The heading a flight parks at on stop i: the pad's, turned a little either way per visit. */
function landingHeading(f: HeliFlight, i: number): number {
  const s = f.stops[Math.max(0, i)];
  return s.pad.heading + (hash2(f.id, 31 + i) - 0.5) * 0.7;
}
