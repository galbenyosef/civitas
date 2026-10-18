import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { hash2 } from './noise';
import { nameFor, surnameFor } from './names';
import { CITIES, type CrewMember } from './crews';
import { BridgeStyle, bridgeClearance, basculeOpen, basculeLifts, BASCULE_RAISE, BASCULE_HOLD } from './bridges';
import { HARBOUR_OF, placedBerths, type HarbourRole } from './harbours';
import type { Placed } from './structures';
import {
  waterGeometry, waterPoint, passSig, waterLane, cruiseLane, cruiseWaypoints, fishingGrounds, seaGateGoals, waterRouteKey, waterTiles,
  WIDTH_CLEARANCE, SEA_GATE_FADE, SEA_GATE_LOW_AIR, type WaterGeometry, type WaterLane, type WidthClass, type LanePurpose, type WaterGrid,
  type SeaGate, type LaneResult,
} from './waterways';

/**
 * Boats (docs/boats.md sections 4 and 6.1): the boat types, the boats based at each harbour, and every voyage of a day
 * as a pure function of the harbour list (with its lanes) and the day, like helicopters.ts heliTimetable. Nothing per
 * boat is stored or sent: the server walks the day's events (catches landed, ships alongside), and every client sails
 * the same boats from the `harbours` message, with no chunk loaded.
 *
 *  - A harbour's **lanes** start at its fairway tile; a boat leaves its berth on a scripted curve to the lane's start,
 *    and comes back along one. A bow-in berth is left astern first.
 *  - **Voyages** are booked in time order like helicopter flights. A visiting ship reserves its berth from 10 ticks
 *    before it starts berthing to 10 after it has cast off; a based boat holds its own berth whenever it is home. A
 *    clash pushes the voyage back in 10-tick slots.
 *  - **Bascule passages.** A tall boat (air draft at or over a closed bascule's clearance) passes a bascule only while
 *    its leaves stand fully open, one boat at a time, in the span's own clock lifts (bridges.ts basculeLifts, which
 *    road traffic already obeys). Its departure is pushed back to meet the first lift; a later lift it waits for,
 *    holding short of the bridge ("waiting for the lifting bridge"). A lift no tall boat is booked into gets a sailing
 *    barge passage on a lane through it, as the landmark's barge did.
 *  - A voyage of day d starts at 04:00 or later and is over by 04:00 on day d + 1, so boatsAt reads days d - 1 and d.
 *
 * Space is tiles (x, z on the water, as world x and z), time is ticks; headings are atan2(dz, dx).
 */

// ---- boat types ----------------------------------------------------------------------------------------
export type BoatType =
  | 'dinghy' | 'motorCruiser' | 'sailboat' | 'narrowboat' | 'trawler' | 'riverBus' | 'ropax' | 'barge' | 'sailingBarge' | 'coaster'
  | 'containerShip' | 'tug' | 'policeLaunch' | 'fireBoat';
export interface BoatSpec {
  /** length and beam, tiles (compressed like planes: a container ship is 4.4) */
  len: number; beam: number;
  /** width class: the lanes it sails need this clearance (waterways.ts WIDTH_CLEARANCE) */
  cls: WidthClass;
  /** height of its highest point over the water, tiles: it passes under a deck whose clearance is more */
  air: number;
  /** cruising speed, tiles a tick (a car is 0.5); a sailboat's under sail, MOTOR_SPEED under motor */
  speed: number;
  /** heave amplitude, tiles, for the renderer */
  heave: number;
  /** for tooltips */
  name: string;
}
export const BOAT_TYPES: Record<BoatType, BoatSpec> = {
  dinghy: { len: 0.22, beam: 0.09, cls: 'narrow', air: 0.2, speed: 0.1, heave: 0.012, name: 'dinghy' },
  motorCruiser: { len: 0.42, beam: 0.14, cls: 'narrow', air: 0.09, speed: 0.22, heave: 0.009, name: 'motor cruiser' },
  sailboat: { len: 0.5, beam: 0.15, cls: 'river', air: 0.38, speed: 0.14, heave: 0.009, name: 'sailing yacht' },
  narrowboat: { len: 0.62, beam: 0.07, cls: 'narrow', air: 0.07, speed: 0.06, heave: 0.004, name: 'narrowboat' },
  trawler: { len: 0.55, beam: 0.16, cls: 'river', air: 0.17, speed: 0.18, heave: 0.008, name: 'trawler' },
  riverBus: { len: 0.95, beam: 0.22, cls: 'river', air: 0.1, speed: 0.4, heave: 0.006, name: 'river bus' },
  ropax: { len: 1.6, beam: 0.35, cls: 'open', air: 0.3, speed: 0.3, heave: 0.005, name: 'ro-ro ferry' },
  barge: { len: 0.9, beam: 0.2, cls: 'river', air: 0.08, speed: 0.12, heave: 0.004, name: 'barge' },
  sailingBarge: { len: 0.5, beam: 0.13, cls: 'river', air: 0.55, speed: 0.1, heave: 0.007, name: 'sailing barge' },
  coaster: { len: 2, beam: 0.35, cls: 'river', air: 0.24, speed: 0.22, heave: 0.005, name: 'coaster' },
  containerShip: { len: 4.4, beam: 0.62, cls: 'open', air: 0.48, speed: 0.25, heave: 0.003, name: 'container ship' },
  tug: { len: 0.4, beam: 0.15, cls: 'river', air: 0.12, speed: 0.2, heave: 0.008, name: 'tug' },
  policeLaunch: { len: 0.45, beam: 0.13, cls: 'narrow', air: 0.09, speed: 0.3, heave: 0.008, name: 'police launch' },
  fireBoat: { len: 0.6, beam: 0.18, cls: 'river', air: 0.14, speed: 0.24, heave: 0.007, name: 'fire boat' },
};
export const BOAT_TYPE_NAMES = Object.keys(BOAT_TYPES) as BoatType[];
/** A sailboat under motor. */
export const MOTOR_SPEED = 0.12;
/** The pass signature (waterways.ts passSig) of a type: the lanes it sails are derived for this. */
export const boatSig = (type: BoatType) => passSig(BOAT_TYPES[type].air);
/** Does a boat of this type need a bascule lifted? */
export const needsLift = (type: BoatType) => BOAT_TYPES[type].air >= bridgeClearance(BridgeStyle.Bascule);

// ---- harbours ------------------------------------------------------------------------------------------
/** A harbour kind's role (harbours.ts HARBOUR_OF), or undefined for any other kind. */
const roleOf = (kind: number): HarbourRole | undefined => HARBOUR_OF[kind]?.role;
/** The types each harbour role bases or receives (a ferry pier's river buses are ferry lines: B5). */
export const HARBOUR_BOATS: Record<HarbourRole, readonly BoatType[]> = {
  jetty: ['dinghy', 'motorCruiser'],
  marina: ['motorCruiser', 'sailboat', 'narrowboat', 'dinghy', 'sailingBarge'],
  fishing: ['trawler'],
  pier: [],
  port: ['containerShip', 'ropax', 'coaster', 'barge', 'tug'],
};
/** The lane purposes a type sails, best first: a barge comes down the river from a low gate, else in from the sea. */
export const BOAT_PURPOSES: Partial<Record<BoatType, readonly LanePurpose[]>> = {
  dinghy: ['cruise'], motorCruiser: ['cruise'], sailboat: ['cruise'], narrowboat: ['cruise'], sailingBarge: ['cruise'],
  trawler: ['grounds'], containerShip: ['sea'], ropax: ['sea'], coaster: ['sea'], tug: ['sea'], barge: ['river', 'sea'],
};

/** A berth slot in world space, resolved from the kind's slots (footprint coordinates) and the harbour's placing. */
export interface Berth {
  /** where the middle of a boat lying in the slot is, and the way its bow points (atan2(dz, dx)) */
  x: number; z: number; h: number;
  /** the longest boat it takes, tiles */
  maxLen: number;
  /** alongside a quay or pontoon (left bow first when the lane lies ahead), or bow-in to a finger (left astern) */
  alongside: boolean;
  /** the cargo port's tug berth: only the tug lies there */
  tug?: boolean;
}
/**
 * The berths of a placed harbour as the schedule takes them (harbours.ts placedBerths: world tile space, so x and y
 * here are world x and z). A slot labelled 'tug' is the port's tug berth.
 */
export function harbourBerths(p: Placed): Berth[] {
  return placedBerths(p).map((b) => ({ x: b.x, z: b.y, h: b.angle, maxLen: b.len, alongside: b.mode === 'alongside', ...(b.label === 'tug' ? { tug: true } : {}) }));
}
/** A harbour lane as the `harbours` message carries it: WaterLane, and the sea gate its far end leaves by, if any. */
export interface BoatLane extends WaterLane { gate?: string }
/**
 * A harbour as the schedule sees it (the `harbours` message's HarbourDTO carries this). Every lane starts at the
 * harbour's fairway tile; `active` is false while it has no staff (its boats stay moored).
 */
export interface BoatHarbour {
  /** stable: from the anchor tile */
  id: number;
  kind: number;
  /** anchor tile, for names */
  x: number; y: number;
  name?: string;
  active: boolean;
  berths: Berth[];
  lanes: BoatLane[];
}

/** The lanes a harbour kind wants derived: one per distinct purpose, width class and signature of its types. */
export function harbourLaneSpecs(kind: number): { purpose: LanePurpose; cls: WidthClass; sig: number; types: BoatType[] }[] {
  const name = roleOf(kind);
  const out: { purpose: LanePurpose; cls: WidthClass; sig: number; types: BoatType[] }[] = [];
  for (const type of name ? HARBOUR_BOATS[name] : []) {
    for (const purpose of BOAT_PURPOSES[type] ?? []) {
      const cls = BOAT_TYPES[type].cls, sig = boatSig(type);
      const hit = out.find((s) => s.purpose === purpose && s.cls === cls && s.sig === sig);
      if (hit) hit.types.push(type); else out.push({ purpose, cls, sig, types: [type] });
    }
  }
  return out;
}
/** The lane a type sails from a harbour (by its purposes, best first), or -1. */
export function boatLane(h: Pick<BoatHarbour, 'lanes'>, type: BoatType): number {
  const cls = BOAT_TYPES[type].cls, sig = boatSig(type);
  for (const p of BOAT_PURPOSES[type] ?? []) {
    const i = h.lanes.findIndex((l) => l.purpose === p && l.cls === cls && l.sig === sig);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Derive a harbour's lanes (server only: B4 runs this when a harbour is built, its staffing changes, or the water or
 * a bridge near it changes). `sea` and `grounds` lanes run to the nearest gate that is not low (a procedural world
 * passes its body's offing as a gate); `river` lanes to a low gate; without a gate the grounds are the roomiest water
 * within GROUNDS_RANGE. A refusal says why, for the harbour's panel ("no sea route for container ships: ...").
 */
export function deriveHarbourLanes(grid: WaterGrid, o: { kind: number; fairway: [number, number]; entry?: number; seed: number; gates: readonly SeaGate[] }):
  { lanes: BoatLane[]; refused: { purpose: LanePurpose; cls: WidthClass; sig: number; reason: string }[] } {
  const lanes: BoatLane[] = [], refused: { purpose: LanePurpose; cls: WidthClass; sig: number; reason: string }[] = [];
  const specs = harbourLaneSpecs(o.kind);
  specs.forEach((sp, i) => {
    const who = sp.types.map((t) => PLURAL[t]).join(' and ');
    const opts = { cls: sp.cls, sig: sp.sig, entry: o.entry };
    const toGate = (low: boolean): (LaneResult & { gate?: string }) | null => {
      const gates = o.gates.filter((g) => !!g.low === low && (!g.low || sp.types.every((t) => BOAT_TYPES[t].air <= SEA_GATE_LOW_AIR)));
      if (!gates.length) return null;
      const goals = gates.flatMap((g) => seaGateGoals(grid, g, sp.cls));
      const r = waterLane(grid, o.fairway, goals, opts);
      if (!r.ok) return r;
      // the gate it ended at: the nearest to the route's last tile
      const tl = waterTiles(r.route), z = tl[tl.length - 1];
      let best = gates[0], bd = Infinity;
      for (const g of gates) { const d = Math.abs(g.x - z.x) + Math.abs(g.y - z.y); if (d < bd) { bd = d; best = g; } }
      return { ...r, gate: best.name };
    };
    let res: (LaneResult & { gate?: string }) | null = null;
    if (sp.purpose === 'sea' || sp.purpose === 'grounds') res = toGate(false);
    else if (sp.purpose === 'river') res = toGate(true);
    if ((!res || !res.ok) && sp.purpose === 'grounds') {
      const gr = fishingGrounds(grid, o.fairway, sp.cls, sp.sig);
      res = gr ? waterLane(grid, o.fairway, gr, opts) : { ok: false, why: 'unconnected', nodes: 0, reason: 'no fishing grounds within reach' };
    }
    if (sp.purpose === 'cruise') {
      const wps = cruiseWaypoints(grid, o.fairway, Math.floor(hash2(o.seed % 1000003, 211 + i) * 4194304), sp.cls, sp.sig);
      res = wps.length ? cruiseLane(grid, o.fairway, wps, opts) : { ok: false, why: 'unconnected', nodes: 0, reason: 'no water to cruise' };
    }
    if (!res) { if (sp.purpose === 'sea') refused.push({ purpose: sp.purpose, cls: sp.cls, sig: sp.sig, reason: `no sea route for ${who}: no sea gate` }); return; }
    if (!res.ok) { refused.push({ purpose: sp.purpose, cls: sp.cls, sig: sp.sig, reason: `no ${sp.purpose === 'cruise' ? 'cruise' : sp.purpose === 'grounds' ? 'way to the fishing grounds' : sp.purpose === 'river' ? 'river route' : 'sea route'} for ${who}: ${res.reason}` }); return; }
    const lane: BoatLane = { purpose: sp.purpose, sig: sp.sig, cls: sp.cls, route: res.route };
    if (res.gate) lane.gate = res.gate;
    lanes.push(lane);
  });
  return { lanes, refused };
}
const PLURAL: Record<BoatType, string> = {
  dinghy: 'dinghies', motorCruiser: 'motor cruisers', sailboat: 'sailing yachts', narrowboat: 'narrowboats', trawler: 'trawlers', riverBus: 'river buses',
  ropax: 'ro-ro ferries', barge: 'barges', sailingBarge: 'sailing barges', coaster: 'coasters', containerShip: 'container ships', tug: 'tugs',
  policeLaunch: 'police launches', fireBoat: 'fire boats',
};

// ---- the boats based at a harbour ------------------------------------------------------------------------
export interface BasedBoat {
  /** stable boat id (also the renderer's) */
  id: number;
  harbour: number;
  /** its home berth, an index into the harbour's berths */
  berth: number;
  type: BoatType;
  /** livery and variation seed in [0, 1) */
  seed: number;
}
const hkOf = (id: number) => ((id % 1000003) + 1000003) % 1000003;
/** A boat id from its harbour and a number: stable, under 2^31. */
const boatIdOf = (harbour: number, n: number) => (Math.imul(hkOf(harbour) + 1, 2654435761) ^ Math.imul(n + 1, 40503)) >>> 1;
/** Marina mix (weights), before the water and the berths have their say. */
const MARINA_MIX: [BoatType, number][] = [['motorCruiser', 0.36], ['sailboat', 0.3], ['narrowboat', 0.2], ['dinghy', 0.09], ['sailingBarge', 0.05]];
const fleetCache = new WeakMap<BoatHarbour, BasedBoat[]>();
/**
 * The boats based at a harbour, from its id, berths and lanes (so the same on server and clients): a jetty's dinghies
 * or a motor cruiser, a marina's 6-10 boats sized to its water (narrowboats only off open water, sailboats and sailing
 * barges only with a river-class cruise), a fishing harbour's trawlers, the cargo port's tug. A type only bases where
 * it has a lane and a berth long enough.
 */
export function harbourFleet(h: BoatHarbour): readonly BasedBoat[] {
  const hit = fleetCache.get(h);
  if (hit) return hit;
  const out: BasedBoat[] = [];
  const name = roleOf(h.kind), hk = hkOf(h.id);
  const H = (a: number, b: number) => hash2(hk * 7 + a, b + 401);
  const sails = (t: BoatType) => boatLane(h, t) >= 0;
  const add = (berth: number, type: BoatType) => out.push({ id: boatIdOf(h.id, berth), harbour: h.id, berth, type, seed: H(berth, 1) });
  const fits = (b: Berth, t: BoatType) => !b.tug && b.maxLen >= BOAT_TYPES[t].len;
  if (name === 'jetty') {
    const cruiser = sails('motorCruiser') && H(0, 2) < 0.4;
    let n = cruiser ? 1 : 1 + Math.floor(H(0, 3) * 2);
    h.berths.forEach((b, i) => { if (n > 0 && fits(b, cruiser ? 'motorCruiser' : 'dinghy') && sails(cruiser ? 'motorCruiser' : 'dinghy')) { add(i, cruiser ? 'motorCruiser' : 'dinghy'); n--; } });
  } else if (name === 'marina') {
    // narrowboats belong on canals and rivers: the narrow cruise must keep to water of room 2 or less at the middle
    const nl = boatLane(h, 'narrowboat');
    const room = nl >= 0 ? [...h.lanes[nl].route.room].map(Number).sort((a, b) => a - b) : [];
    const narrowWater = room.length > 0 && room[room.length >> 1] <= 2;
    const n = Math.min(h.berths.length, 6 + Math.floor(H(0, 4) * 5));
    let placed = 0;
    h.berths.forEach((b, i) => {
      if (placed >= n) return;
      const mix = MARINA_MIX.filter(([t]) => fits(b, t) && sails(t) && (t !== 'narrowboat' || narrowWater));
      const total = mix.reduce((s, [, w]) => s + w, 0);
      if (!total) return;
      let r = H(i, 5) * total;
      const pick = mix.find(([, w]) => (r -= w) < 0)?.[0] ?? mix[mix.length - 1][0];
      add(i, pick); placed++;
    });
  } else if (name === 'fishing') {
    if (sails('trawler')) h.berths.forEach((b, i) => { if (fits(b, 'trawler')) add(i, 'trawler'); });
  } else if (name === 'port') {
    const i = h.berths.findIndex((b) => b.tug && b.maxLen >= BOAT_TYPES.tug.len);
    if (i >= 0 && sails('tug')) add(i, 'tug');
  }
  fleetCache.set(h, out);
  return out;
}

// ---- motion: speed profiles and berthing curves -----------------------------------------------------------
/** Distance over time as constant-acceleration pieces (helicopters.ts has the same), invertible. */
class Profile {
  pieces: { t0: number; dur: number; s0: number; v0: number; a: number }[] = [];
  T = 0;
  D = 0;
  private v: number;
  constructor(v0: number) { this.v = v0; }
  ramp(v1: number, d: number) {
    if (d <= 1e-9) { this.v = v1; return this; }
    const v0 = this.v, dur = (2 * d) / Math.max(1e-6, v0 + v1);
    this.pieces.push({ t0: this.T, dur, s0: this.D, v0, a: (v1 - v0) / dur });
    this.T += dur; this.D += d; this.v = v1;
    return this;
  }
  /** distance and speed at time t */
  at(t: number, out: [number, number] = [0, 0]): [number, number] {
    const ps = this.pieces;
    if (!ps.length || t <= 0) { out[0] = 0; out[1] = ps[0]?.v0 ?? this.v; return out; }
    let lo = 0, hi = ps.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ps[m].t0 <= t) lo = m; else hi = m - 1; }
    const p = ps[lo], tau = Math.min(t - p.t0, p.dur);
    out[0] = Math.min(this.D, p.s0 + p.v0 * tau + 0.5 * p.a * tau * tau); out[1] = p.v0 + p.a * tau;
    return out;
  }
  /** the time it reaches distance s (0..D) */
  timeAt(s: number): number {
    if (s <= 0) return 0;
    if (s >= this.D) return this.T;
    for (const p of this.pieces) {
      const len = p.v0 * p.dur + 0.5 * p.a * p.dur * p.dur;
      if (s > p.s0 + len + 1e-12) continue;
      const d = s - p.s0;
      if (Math.abs(p.a) < 1e-12) return p.t0 + d / Math.max(1e-9, p.v0);
      const disc = Math.max(0, p.v0 * p.v0 + 2 * p.a * d);
      return p.t0 + Math.min(p.dur, (Math.sqrt(disc) - p.v0) / p.a);
    }
    return this.T;
  }
}
/** A run of distance d: from vA up (or down) to the cruise v over rA, cruising, then to vB over rB. */
function runProfile(d: number, vA: number, v: number, vB: number, rA: number, rB: number): Profile {
  const p = new Profile(vA);
  if (d <= 1e-9) return p;
  let a = vA === v ? 0 : Math.min(rA, d / 2), b = vB === v ? 0 : Math.min(rB, d / 2);
  if (a + b > d) { const k = d / (a + b); a *= k; b *= k; }
  p.ramp(v, a).ramp(v, d - a - b).ramp(vB, b);
  return p;
}

/** A sampled berthing curve: x, z, heading, arclength per sample. */
interface Curve { pts: Float64Array; n: number; len: number }
const mod2pi = (a: number) => a - 2 * Math.PI * Math.floor(a / (2 * Math.PI));
/**
 * The shortest path of turns of radius R and a straight (a Dubins path: left-straight-left, right-straight-right,
 * left-straight-right or right-straight-left) from (x0, z0) heading h0 to (x1, z1) heading h1, sampled every
 * 0.05 tiles: a boat's manoeuvre in and out of a berth, smooth in heading.
 */
function manoeuvre(x0: number, z0: number, h0: number, x1: number, z1: number, h1: number, R: number): Curve {
  const dx = x1 - x0, dz = z1 - z0, D = Math.hypot(dx, dz) / R, th = Math.atan2(dz, dx);
  const al = mod2pi(h0 - th), be = mod2pi(h1 - th);
  const sa = Math.sin(al), sb = Math.sin(be), ca = Math.cos(al), cb = Math.cos(be), cab = Math.cos(al - be);
  let best: { t: number; p: number; q: number; w: string } | null = null;
  const take = (t: number, p: number, q: number, w: string) => { if (!best || t + p + q < best.t + best.p + best.q - 1e-12) best = { t, p, q, w }; };
  let p2 = 2 + D * D - 2 * cab + 2 * D * (sa - sb);
  if (p2 >= 0) { const t1 = Math.atan2(cb - ca, D + sa - sb); take(mod2pi(-al + t1), Math.sqrt(p2), mod2pi(be - t1), 'LSL'); }
  p2 = 2 + D * D - 2 * cab + 2 * D * (sb - sa);
  if (p2 >= 0) { const t1 = Math.atan2(ca - cb, D - sa + sb); take(mod2pi(al - t1), Math.sqrt(p2), mod2pi(-be + t1), 'RSR'); }
  p2 = -2 + D * D + 2 * cab + 2 * D * (sa + sb);
  if (p2 >= 0) { const p = Math.sqrt(p2), t2 = Math.atan2(-ca - cb, D + sa + sb) - Math.atan2(-2, p); take(mod2pi(-al + t2), p, mod2pi(-mod2pi(be) + t2), 'LSR'); }
  p2 = D * D - 2 + 2 * cab - 2 * D * (sa + sb);
  if (p2 >= 0) { const p = Math.sqrt(p2), t2 = Math.atan2(ca + cb, D - sa - sb) - Math.atan2(2, p); take(mod2pi(al - t2), p, mod2pi(be - t2), 'RSL'); }
  const w = best as { t: number; p: number; q: number; w: string } | null;
  const parts: [string, number][] = w ? [[w.w[0], w.t * R], ['S', w.p * R], [w.w[2], w.q * R]] : [['S', Math.hypot(dx, dz)]];
  const len = parts.reduce((a, [, l]) => a + l, 0);
  const n = Math.max(2, Math.min(400, Math.ceil(len / 0.05) + 1)), step = len / (n - 1);
  const pts = new Float64Array(n * 4);
  let x = x0, z = z0, h = h0, part = 0, used = 0;
  pts.set([x, z, h, 0], 0);
  for (let i = 1; i < n; i++) {
    let left = step;
    while (left > 1e-12 && part < parts.length) {
      const [kind, l] = parts[part], d = Math.min(left, l - used);
      if (kind === 'S') { x += Math.cos(h) * d; z += Math.sin(h) * d; }
      else {
        const sg = kind === 'L' ? 1 : -1, cx = x - sg * R * Math.sin(h), cz = z + sg * R * Math.cos(h);
        h += (sg * d) / R;
        x = cx + sg * R * Math.sin(h); z = cz - sg * R * Math.cos(h);
      }
      used += d; left -= d;
      if (used >= l - 1e-12) { part++; used = 0; }
    }
    pts.set([x, z, h, step * i], i * 4);
  }
  // land exactly on the end pose
  pts.set([x1, z1, pts[(n - 1) * 4 + 2], len], (n - 1) * 4);
  return { pts, n, len };
}
/** A boat's turning radius in a berthing manoeuvre, tiles. */
const turnRadius = (spec: BoatSpec) => Math.min(1.5, Math.max(0.3, 0.3 + 0.35 * spec.len));
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function curveAt(c: Curve, d: number, out: { x: number; z: number; h: number }) {
  const p = c.pts;
  let lo = 0, hi = c.n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (p[m * 4 + 3] <= d) lo = m; else hi = m - 1; }
  const i = Math.min(lo, c.n - 2), s0 = p[i * 4 + 3], s1 = p[i * 4 + 7];
  const f = s1 > s0 ? Math.min(1, Math.max(0, (d - s0) / (s1 - s0))) : 0;
  out.x = p[i * 4] + (p[i * 4 + 4] - p[i * 4]) * f; out.z = p[i * 4 + 1] + (p[i * 4 + 5] - p[i * 4 + 1]) * f;
  out.h = p[i * 4 + 2] + wrapPi(p[i * 4 + 6] - p[i * 4 + 2]) * f;
  return out;
}

/** Keep to starboard of the lane by this much where the water has clearance c (render too: docs/boats.md 6.1). */
export const starboardOffset = (c: number) => Math.max(0, Math.min(0.3, 0.3 * (c - 0.5)));
/** The offset fades in over this far from a lane's ends, where the berthing curves join its middle line. */
const OFFSET_BLEND = 1.5;
const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/**
 * The starboard offset at arclength S of a sailing line: each piece's own (from its clearance), averaged over a tile
 * of line so it changes smoothly where the clearance does, and faded in from the ends (where the berthing curves meet
 * the middle line; a loop's at its seam).
 */
export function laneOffset(g: WaterGeometry, S: number): number {
  const L = g.L, ps = g.pieces;
  if (!ps.length || L <= 0) return 0;
  const Sm = g.loop ? ((S % L) + L) % L : Math.min(L, Math.max(0, S));
  /** integral of the pieces' offsets over [a, b] inside [0, L] */
  const integ = (a: number, b: number) => {
    let lo = 0, hi = ps.length - 1, sum = 0;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ps[m].s0 <= a) lo = m; else hi = m - 1; }
    for (let i = lo; i < ps.length && ps[i].s0 < b; i++) {
      const x0 = Math.max(a, ps[i].s0), x1 = Math.min(b, ps[i].s0 + ps[i].len);
      if (x1 > x0) sum += (x1 - x0) * starboardOffset(ps[i].c);
    }
    return sum;
  };
  const w = 0.5;
  let a = Sm - w, b = Sm + w, sum = 0, len = 2 * w;
  if (g.loop) {
    if (a < 0) sum += integ(a + L, L) + integ(0, b);
    else if (b > L) sum += integ(a, L) + integ(0, b - L);
    else sum += integ(a, b);
  } else { a = Math.max(0, a); b = Math.min(L, b); len = b - a; sum = integ(a, b); }
  return (len > 0 ? sum / len : 0) * smooth01(Math.min(Sm, L - Sm) / OFFSET_BLEND);
}
/** A lane's middle line or its starboard side: point and heading of travel at arclength S going `dir`. */
function lanePose(g: WaterGeometry, S: number, dir: number, out: { x: number; z: number; h: number; c: number }, offset = true) {
  waterPoint(g, S, out);
  if (dir < 0) out.h = wrapPi(out.h + Math.PI);
  if (!offset) return out;
  const off = laneOffset(g, S);
  out.x -= Math.sin(out.h) * off; out.z += Math.cos(out.h) * off;
  return out;
}
const laneGeom = (l: BoatLane) => waterGeometry(l.route, WIDTH_CLEARANCE[l.cls]);

// ---- voyages ------------------------------------------------------------------------------------------------
export type BoatPhase = 'moored' | 'unberthing' | 'underway' | 'fishing' | 'waiting' | 'berthing' | 'alongside';
export type VoyageKind = 'cruise' | 'fishing' | 'call' | 'escort' | 'lift';
interface SegBase { t0: number; dur: number; phase: BoatPhase }
/** on a berthing curve, ahead or astern; `berth` is the slot it leaves or makes for */
interface CurveSeg extends SegBase { k: 'curve'; c: Curve; prof: Profile; astern: boolean; berth: number }
/** along a lane from sA, going dir; fades at a gate end */
interface LaneSeg extends SegBase { k: 'lane'; lane: number; g: WaterGeometry; sA: number; dir: 1 | -1; prof: Profile; fadeIn: boolean; fadeOut: boolean; gate: boolean }
/** lying still: at a berth, short of a bridge, or out of sight beyond a gate (`hide`) */
interface HoldSeg extends SegBase { k: 'hold'; x: number; z: number; h: number; lane: number; s: number; dir: 1 | -1; berth: number; hide: boolean }
/** turning round on the spot of a lane (the starboard offset swings it through a half circle) */
interface PivotSeg extends SegBase { k: 'pivot'; lane: number; s: number; cx: number; cz: number; h0: number; dh: number; off: number }
/** trawling round a racetrack from (ex, ez) along (ux, uz), its turns to starboard */
interface TrawlSeg extends SegBase { k: 'trawl'; ex: number; ez: number; hu: number; a: number; r: number; v: number }
export type VoyageSeg = CurveSeg | LaneSeg | HoldSeg | PivotSeg | TrawlSeg;

/** One boat's passage under a bascule: when its hull is over the deck tile (ticks), and the span's lift seed. */
export interface LiftPass { seed: number; t0: number; t1: number }
export interface Voyage {
  /** unique across days: day * 100000 + index */
  id: number;
  day: number;
  kind: VoyageKind;
  /** the boat: a based boat's id, or a visitor's own */
  boat: number;
  type: BoatType;
  seed: number;
  /** the harbour it belongs to or calls at, and the berth there (-1: none, a lift barge) */
  harbour: number;
  berth: number;
  /** the lane it mostly sails (index into the harbour's lanes) */
  lane: number;
  /** cruising speed this voyage */
  v: number;
  segs: VoyageSeg[];
  tStart: number;
  tEnd: number;
  lifts: LiftPass[];
  /** the ship a tug escorts (its voyage id) */
  escorts?: number;
}

// ---- booking ------------------------------------------------------------------------------------------------
/** Departures and berthings are pushed back in slots of this many ticks; a berth is reserved this long either side. */
export const BOAT_SLOT = 10, BERTH_MARGIN = 10;
/** A day's voyages start at or after this hour and end by this one (04:00 the next day). */
export const BOAT_DAY_FROM = 4, BOAT_DAY_TO = 28;
/** Tries at pushing a voyage back before it is cancelled. */
const MAX_TRIES = 36;
/** A boat holds this far short of a bascule's hull window, and waits at most this long there (ticks). */
const WAIT_GAP = 1, MAX_LIFT_WAIT = 4 * TICKS_PER_HOUR;
/** Hull clearance either side of the deck tile, and ticks between two boats in one lift. */
const LIFT_PAD = 0.15, LIFT_GAP = 3;
/** Speed-up and slow-down distances on a lane, tiles. */
const RAMP = 1.2;
/** A lift barge appears this far (tiles of lane) short of the span and vanishes as far beyond it. */
export const LIFT_BARGE_RUN = 8;
/** A tug meets its ship this far out (lane tiles from the fairway). */
export const TUG_MEET = 8;

type Interval = [number, number];
interface Ctx {
  day: number;
  /** committed bascule passages, by lift seed */
  lifts: Map<number, Interval[]>;
  /** committed berth reservations, by harbour id * 64 + berth */
  berths: Map<number, Interval[]>;
}
const berthKey = (h: number, b: number) => hkOf(h) * 64 + b;
/** the open (fully lifted) windows of a span on a day, ticks, sorted, each shrunk a tick either end */
function liftWindows(seed: number, day: number): Interval[] {
  return basculeLifts(seed, day).map((s): Interval => [(s + BASCULE_RAISE) * TICKS_PER_HOUR + 1, (s + BASCULE_RAISE + BASCULE_HOLD) * TICKS_PER_HOUR - 1]).sort((a, b) => a[0] - b[0]);
}
/** are the leaves fully up (basculeOpen 1) over [a, b]? sampled every half tick: two lifts may overlap */
function openThrough(seed: number, a: number, b: number): boolean {
  for (let t = a; t < b; t += 0.5) if (basculeOpen(seed, t / TICKS_PER_HOUR) < 0.999) return false;
  return basculeOpen(seed, b / TICKS_PER_HOUR) >= 0.999;
}
const clash = (list: readonly Interval[] | undefined, a: number, b: number, gap: number) => !!list && list.some(([x, y]) => a < y + gap && b > x - gap);
/** The earliest start t >= tMin (within MAX_LIFT_WAIT) at which a passage of P ticks fits a lift, clear of other boats. */
function liftSlot(ctx: Ctx, seed: number, tMin: number, P: number, own: readonly LiftPass[]): number {
  const booked = [...(ctx.lifts.get(seed) ?? []), ...own.filter((l) => l.seed === seed).map((l): Interval => [l.t0, l.t1])];
  for (const [a, b] of liftWindows(seed, ctx.day)) {
    let t = Math.max(tMin, a);
    for (let guard = 0; guard < 64 && t + P <= b; guard++) {
      if (t - tMin > MAX_LIFT_WAIT) return NaN;
      const hit = booked.find(([x, y]) => t < y + LIFT_GAP && t + P > x - LIFT_GAP);
      if (hit) { t = hit[1] + LIFT_GAP; continue; }
      if (!openThrough(seed, t, t + P)) { t += 1; continue; }
      return t;
    }
  }
  return NaN;
}

/** Builds one voyage's segments in time order. */
class Plan {
  segs: VoyageSeg[] = [];
  /** passages under bascules, as planned (verified afterwards from the segments) */
  own: LiftPass[] = [];
  /** ticks waited at the first bascule the voyage meets, if it had to wait there */
  firstWait = 0;
  /** the lane it mostly sails */
  mainLane = -1;
  private met = false;
  private P = { x: 0, z: 0, h: 0, c: 0 };
  constructor(readonly ctx: Ctx, readonly spec: BoatSpec, readonly v: number, public t: number) {}
  get vMan() { return Math.max(0.03, 0.4 * this.v); }
  curve(c: Curve, vA: number, vB: number, astern: boolean, phase: BoatPhase, berth: number) {
    // slow in the berth's last tile or so, quicker over a long way out to the fairway
    const vm = astern ? 0.5 * this.vMan : this.vMan + (0.7 * this.v - this.vMan) * smooth01((c.len - 1.5) / 3);
    const r = Math.min(1, c.len * 0.4);
    const prof = runProfile(c.len, vA, vm, vB, r, r);
    const dur = Math.max(prof.T, 2);
    this.segs.push({ k: 'curve', t0: this.t, dur, phase, c, prof, astern, berth });
    this.t += dur;
  }
  hold(dur: number, x: number, z: number, h: number, phase: BoatPhase, o: { lane?: number; s?: number; dir?: 1 | -1; berth?: number; hide?: boolean } = {}) {
    if (dur <= 0.05) return;
    this.segs.push({ k: 'hold', t0: this.t, dur, phase, x, z, h, lane: o.lane ?? -1, s: o.s ?? 0, dir: o.dir ?? 1, berth: o.berth ?? -1, hide: !!o.hide });
    this.t += dur;
  }
  pivot(li: number, g: WaterGeometry, S: number, dir: 1 | -1) {
    const P = lanePose(g, S, dir, this.P, false), cx = P.x, cz = P.z, h0 = P.h;
    const off = laneOffset(g, S);
    const dur = Math.max(8, (Math.PI * off) / (0.4 * this.v));
    this.segs.push({ k: 'pivot', t0: this.t, dur, phase: 'underway', lane: li, s: S, cx, cz, h0, dh: -Math.PI, off });
    this.t += dur;
  }
  trawl(ex: number, ez: number, hu: number, a: number, r: number, laps: number) {
    const v = 0.06, lap = 4 * a + 2 * Math.PI * r;
    const dur = (laps * lap) / v;
    this.segs.push({ k: 'trawl', t0: this.t, dur, phase: 'fishing', ex, ez, hu, a, r, v });
    this.t += dur;
  }
  private run(li: number, g: WaterGeometry, a: number, b: number, vA: number, vB: number, rA: number, o: { fadeIn: boolean; fadeOut: boolean; gate: boolean }) {
    const d = Math.abs(b - a);
    if (d <= 1e-9) return;
    const prof = runProfile(d, vA, this.v, vB, rA, RAMP);
    this.segs.push({ k: 'lane', t0: this.t, dur: prof.T, phase: 'underway', lane: li, g, sA: a, dir: b >= a ? 1 : -1, prof, ...o });
    this.t += prof.T;
  }
  /**
   * Sail lane `li` from arclength sA to sB (a loop's may run past its length: laps). A bascule this boat must have
   * lifted is passed at speed when a lift is open then and free, else the boat holds WAIT_GAP short of it and goes on
   * to meet the earliest lift that fits. False when no lift does within MAX_LIFT_WAIT.
   */
  lane(li: number, ln: BoatLane, sA: number, sB: number, vIn: number, vOut: number, fade: { fadeIn?: boolean; fadeOut?: boolean } = {}): boolean {
    const g = laneGeom(ln), dir: 1 | -1 = sB >= sA ? 1 : -1, v = this.v, half = this.spec.len / 2;
    const gate = !!ln.gate;
    const lifts: { entry: number; exit: number; seed: number }[] = [];
    if (this.spec.air >= bridgeClearance(BridgeStyle.Bascule)) {
      const lo = Math.min(sA, sB), hi = Math.max(sA, sB);
      const k0 = g.loop ? Math.floor(lo / g.L) - 1 : 0, k1 = g.loop ? Math.ceil(hi / g.L) + 1 : 0;
      for (let k = k0; k <= k1; k++) for (const dk of g.decks) {
        if (dk.style !== BridgeStyle.Bascule) continue;
        const s0 = dk.s0 + k * g.L, s1 = dk.s1 + k * g.L;
        const entry = dir > 0 ? s0 - half - LIFT_PAD : s1 + half + LIFT_PAD, exit = dir > 0 ? s1 + half + LIFT_PAD : s0 - half - LIFT_PAD;
        if (dir * (exit - sA) > 0 && dir * (entry - sB) < 0) lifts.push({ entry, exit, seed: dk.seed });
      }
      lifts.sort((p, q) => dir * (p.entry - q.entry));
    }
    let cur = sA, vc = vIn, rA = RAMP;
    for (const L of lifts) {
      const enter = dir * (L.entry - cur) > 0 ? L.entry : cur;
      const first = !this.met;
      this.met = true;
      // at speed: the run as it will be sailed if nothing stops it
      const full = runProfile(Math.abs(sB - cur), vc, v, vOut, rA, RAMP);
      const tIn = this.t + full.timeAt(Math.abs(enter - cur)), tOut = this.t + full.timeAt(Math.abs(L.exit - cur));
      const mine = this.own.filter((o) => o.seed === L.seed).map((o): Interval => [o.t0, o.t1]);
      if (liftWindows(L.seed, this.ctx.day).some(([a, b]) => tIn >= a && tOut <= b) && !clash(this.ctx.lifts.get(L.seed), tIn, tOut, LIFT_GAP)
        && !clash(mine, tIn, tOut, LIFT_GAP) && openThrough(L.seed, tIn, tOut)) {
        this.own.push({ seed: L.seed, t0: tIn, t1: tOut });
        continue;
      }
      // hold WAIT_GAP short of it, then go from rest to meet the earliest lift that fits
      const sw = dir * (enter - dir * WAIT_GAP - cur) > 0 ? enter - dir * WAIT_GAP : cur;
      this.run(li, g, cur, sw, vc, 0, rA, { fadeIn: !!fade.fadeIn && cur === sA, fadeOut: false, gate });
      const dEnter = Math.abs(enter - sw), rW = dEnter > 0.05 ? dEnter : RAMP;
      const rest = runProfile(Math.abs(sB - sw), 0, v, vOut, rW, RAMP);
      const tE = rest.timeAt(dEnter), tX = rest.timeAt(Math.abs(L.exit - sw));
      const t = liftSlot(this.ctx, L.seed, this.t + tE, tX - tE, this.own);
      if (Number.isNaN(t)) return false;
      const wait = t - tE - this.t;
      if (first) this.firstWait = wait;
      const at = lanePose(g, sw, dir, this.P);
      this.hold(wait, at.x, at.z, at.h, 'waiting', { lane: li, s: sw, dir });
      this.t = t - tE;
      cur = sw; vc = 0; rA = rW;
      this.own.push({ seed: L.seed, t0: t, t1: t + tX - tE });
    }
    this.run(li, g, cur, sB, vc, vOut, rA, { fadeIn: !!fade.fadeIn && cur === sA, fadeOut: !!fade.fadeOut, gate });
    return true;
  }
}

/** When the hull is over each bascule deck it must have lifted, from the segments themselves (merged per passage). */
function liftPasses(segs: readonly VoyageSeg[], spec: BoatSpec): LiftPass[] {
  if (spec.air < bridgeClearance(BridgeStyle.Bascule)) return [];
  const half = spec.len / 2, out: LiftPass[] = [];
  const add = (seed: number, t0: number, t1: number) => {
    const last = out.filter((p) => p.seed === seed).pop();
    if (last && t0 <= last.t1 + 1e-6) last.t1 = Math.max(last.t1, t1); else out.push({ seed, t0, t1 });
  };
  for (const s of segs) {
    if (s.k === 'lane') {
      const g = s.g, a = s.sA, b = s.sA + s.dir * s.prof.D, lo = Math.min(a, b), hi = Math.max(a, b);
      const k0 = g.loop ? Math.floor(lo / g.L) - 1 : 0, k1 = g.loop ? Math.ceil(hi / g.L) + 1 : 0;
      const hits: [number, number, number][] = [];
      for (let k = k0; k <= k1; k++) for (const dk of g.decks) {
        if (dk.style !== BridgeStyle.Bascule) continue;
        const x0 = Math.max(lo, dk.s0 + k * g.L - half), x1 = Math.min(hi, dk.s1 + k * g.L + half);
        if (x1 <= x0) continue;
        const ta = s.prof.timeAt(s.dir > 0 ? x0 - a : a - x1), tb = s.prof.timeAt(s.dir > 0 ? x1 - a : a - x0);
        hits.push([dk.seed, s.t0 + ta, s.t0 + tb]);
      }
      hits.sort((p, q) => p[1] - q[1]).forEach(([seed, t0, t1]) => add(seed, t0, t1));
    } else if ((s.k === 'hold' || s.k === 'pivot') && s.lane >= 0) {
      // a boat lying or turning on a lane under a bascule would be found here; the planner never stops there
      const seg = segs.find((q): q is LaneSeg => q.k === 'lane' && q.lane === s.lane);
      if (!seg) continue;
      for (const dk of seg.g.decks) {
        if (dk.style !== BridgeStyle.Bascule) continue;
        const L = seg.g.loop ? seg.g.L : Infinity, S = seg.g.loop ? ((s.s % L) + L) % L : s.s;
        if (S + half > dk.s0 && S - half < dk.s1) add(dk.seed, s.t0, s.t0 + s.dur);
      }
    }
  }
  return out;
}
/** Every passage inside a fully open lift and clear of every other boat booked through that span? */
function passesFit(ctx: Ctx, passes: readonly LiftPass[]): boolean {
  return passes.every((p, i) =>
    openThrough(p.seed, p.t0, p.t1) && !clash(ctx.lifts.get(p.seed), p.t0, p.t1, LIFT_GAP)
    && !passes.some((q, j) => j !== i && q.seed === p.seed && p.t0 < q.t1 + LIFT_GAP && p.t1 > q.t0 - LIFT_GAP));
}

/** Leaving a berth for the start of a lane: astern out of a bow-in slot (or when the lane lies astern), then ahead. */
function unberth(p: Plan, b: Berth, bi: number, sx: number, sz: number, sh: number) {
  const ux = Math.cos(b.h), uz = Math.sin(b.h), dx = sx - b.x, dz = sz - b.z, dl = Math.hypot(dx, dz) || 1, R = turnRadius(p.spec);
  if (!b.alongside || (ux * dx + uz * dz) / dl < -0.2) {
    // straight back out of the slot, then ahead, turning for the lane
    const back = Math.min(1.2, p.spec.len * 0.8 + 0.3);
    const rx = b.x - ux * back, rz = b.z - uz * back;
    p.curve(manoeuvre(b.x, b.z, b.h + Math.PI, rx, rz, b.h + Math.PI, R), 0, 0, true, 'unberthing', bi);
    p.curve(manoeuvre(rx, rz, b.h, sx, sz, sh, R), 0, p.vMan, false, 'unberthing', bi);
  } else p.curve(manoeuvre(b.x, b.z, b.h, sx, sz, sh, R), 0, p.vMan, false, 'unberthing', bi);
}
/** Coming in from the end of a lane, bow first, into the berth. */
function berthIn(p: Plan, b: Berth, bi: number, ex: number, ez: number, eh: number) {
  p.curve(manoeuvre(ex, ez, eh, b.x, b.z, b.h, turnRadius(p.spec)), p.vMan, 0, false, 'berthing', bi);
}
/** reservation of a berth by a voyage: from its berthing curve's start to its last unberthing curve's end */
function berthUse(segs: readonly VoyageSeg[], bi: number): Interval | null {
  let a = Infinity, b = -Infinity;
  for (const s of segs) if ((s.k === 'curve' || (s.k === 'hold' && s.phase === 'alongside')) && s.berth === bi) { a = Math.min(a, s.t0); b = Math.max(b, s.t0 + s.dur); }
  return a < b ? [a - BERTH_MARGIN, b + BERTH_MARGIN] : null;
}

// ---- the timetable ----------------------------------------------------------------------------------------
/** Pleasure trips: hours out by type (lo, hi), and the window they leave in. */
const TRIP_HOURS: Partial<Record<BoatType, [number, number]>> = {
  motorCruiser: [1, 4], dinghy: [0.5, 1.5], narrowboat: [2, 6], sailboat: [2, 5], sailingBarge: [2, 5],
};
const TRIP_LEAVE: [number, number] = [8, 18.5];
/** Port calls a day by type (lo, hi), the hours they berth between, and hours alongside. */
const CALLS: { type: BoatType; perDay: [number, number]; hours: [number, number]; alongside: [number, number] }[] = [
  { type: 'containerShip', perDay: [1, 3], hours: [7, 15], alongside: [4, 10] },
  { type: 'coaster', perDay: [0, 2], hours: [5, 16], alongside: [2, 4] },
  { type: 'ropax', perDay: [1, 2], hours: [7, 19], alongside: [1, 1] },
  { type: 'barge', perDay: [1, 3], hours: [6, 15], alongside: [2, 4] },
];

interface Cand {
  t: number; hid: number; n: number;
  boat: BasedBoat | null;
  /** plan the voyage starting at t (null: it cannot sail at all) */
  plan: (t: number) => { p: Plan | null; berth: number } | null;
  kind: VoyageKind; type: BoatType; seed: number; harbour: BoatHarbour; lane: number;
}

export interface BoatTimetable {
  day: number;
  /** in start order */
  voyages: readonly Voyage[];
  /** each boat's voyages that day, in order */
  byBoat: ReadonlyMap<number, readonly Voyage[]>;
}

const keyCache = new WeakMap<readonly BoatHarbour[], string>();
/** A cache key for a harbour list: equal lists (by content) share timetables. Cached per list object. */
export function harboursKey(hs: readonly BoatHarbour[]): string {
  const hit = keyCache.get(hs);
  if (hit) return hit;
  let h = 0x811c9dc5;
  const mix = (s: string) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); };
  for (const x of [...hs].sort((a, b) => a.id - b.id)) {
    mix(`${x.id}|${x.kind}|${x.x},${x.y}|${x.active ? 1 : 0}|${x.name ?? ''}|`);
    for (const b of x.berths) mix(`${b.x.toFixed(3)},${b.z.toFixed(3)},${b.h.toFixed(4)},${b.maxLen},${b.alongside ? 1 : 0}${b.tug ? 't' : ''};`);
    for (const l of x.lanes) mix(`${l.purpose}:${l.sig}:${l.cls}:${l.gate ?? ''}:${waterRouteKey(l.route)}:${l.route.bridges.map((q) => `${q.k}.${q.style}.${q.x0}.${q.y0}`).join(',')};`);
  }
  const key = `${hs.length}:${(h >>> 0).toString(36)}`;
  keyCache.set(hs, key);
  return key;
}

const ttCache = new Map<string, BoatTimetable>();
/** Forget every cached timetable (checks: a cold derivation must equal the cached one). */
export function clearBoatTimetables() { ttCache.clear(); }
/** Every voyage of a day over these harbours, booked in time order. Pure in (harbours, day); cached. */
export function boatTimetable(hs: readonly BoatHarbour[], day: number): BoatTimetable {
  const key = `${harboursKey(hs)}|${day}`;
  const hit = ttCache.get(key);
  if (hit) return hit;
  const out = generate(hs, day);
  if (ttCache.size > 16) ttCache.clear();
  ttCache.set(key, out);
  return out;
}

function generate(hsIn: readonly BoatHarbour[], day: number): BoatTimetable {
  const hs = [...hsIn].sort((a, b) => a.id - b.id);
  const d0 = day * TICKS_PER_DAY, open = d0 + BOAT_DAY_FROM * TICKS_PER_HOUR, cutoff = d0 + BOAT_DAY_TO * TICKS_PER_HOUR;
  const ctx: Ctx = { day, lifts: new Map(), berths: new Map() };
  const weekday = ((day % 7) + 7) % 7;
  const cands: Cand[] = [];
  for (const h of hs) {
    if (!h.active) continue;
    const hk = hkOf(h.id);
    const H = (a: number, b: number) => hash2(hk * 31 + day * 977 + a, b + 13);
    for (const b of harbourFleet(h)) {
      const li = boatLane(h, b.type);
      if (li < 0) continue;
      const berth = h.berths[b.berth], spec = BOAT_TYPES[b.type];
      if (!berth) continue;
      const bh = (a: number, c: number) => H(b.berth * 53 + a, c);
      if (b.type === 'trawler') {
        if (weekday === 6) continue; // Sundays in port
        const leave = 4.1 + 1.9 * bh(0, 1), back = 12 + 5 * bh(0, 2);
        cands.push({
          t: d0 + leave * TICKS_PER_HOUR, hid: h.id, n: b.berth, boat: b, kind: 'fishing', type: b.type, seed: b.seed, harbour: h, lane: li,
          plan: (t) => planFishing(ctx, h, b, li, t, d0 + back * TICKS_PER_HOUR, bh(0, 3)),
        });
        continue;
      }
      const hours = TRIP_HOURS[b.type];
      if (!hours) continue;
      // pleasure: 0-2 trips, more at the weekend
      const r = bh(0, 4), weekend = weekday >= 5;
      const trips = weekend ? (r < 0.15 ? 0 : r < 0.7 ? 1 : 2) : (r < 0.45 ? 0 : r < 0.9 ? 1 : 2);
      for (let i = 0; i < trips; i++) {
        const span = TRIP_LEAVE[1] - TRIP_LEAVE[0];
        const leave = TRIP_LEAVE[0] + span * ((i + 0.1 + 0.8 * bh(i, 5)) / trips);
        const dur = (hours[0] + (hours[1] - hours[0]) * bh(i, 6)) * TICKS_PER_HOUR;
        const v = (b.type === 'sailboat' && bh(i, 7) < 0.3 ? MOTOR_SPEED : spec.speed) * (0.92 + 0.16 * bh(i, 8));
        cands.push({
          t: d0 + leave * TICKS_PER_HOUR, hid: h.id, n: b.berth * 4 + i, boat: b, kind: 'cruise', type: b.type, seed: b.seed, harbour: h, lane: li,
          plan: (t) => planCruise(ctx, h, b.berth, li, spec, v, t, dur),
        });
      }
    }
    if (roleOf(h.kind) === 'port') {
      CALLS.forEach((c, ci) => {
        // by the type's lanes, best first: a barge down the river when that fits the day, else in from the sea
        const cls = BOAT_TYPES[c.type].cls, sig = boatSig(c.type);
        const lanes = (BOAT_PURPOSES[c.type] ?? []).map((pu) => h.lanes.findIndex((l) => l.purpose === pu && l.cls === cls && l.sig === sig)).filter((i) => i >= 0);
        if (!lanes.length) return;
        const li = lanes[0];
        const spec = BOAT_TYPES[c.type];
        // the smallest berths that take it (a container ship's big berth is not taken by the small fry)
        const all = h.berths.map((b, i) => ({ b, i })).filter(({ b }) => !b.tug && b.maxLen >= spec.len);
        if (!all.length) return;
        const least = Math.min(...all.map(({ b }) => b.maxLen));
        const fit = all.filter(({ b }) => b.maxLen < least * 1.25).map(({ i }) => i);
        const n = c.perDay[0] + Math.floor(H(ci, 20) * (c.perDay[1] - c.perDay[0] + 1));
        for (let i = 0; i < n; i++) {
          const hour = c.hours[0] + (c.hours[1] - c.hours[0]) * ((i + 0.1 + 0.8 * H(ci * 8 + i, 21)) / n);
          const along = (c.alongside[0] + (c.alongside[1] - c.alongside[0]) * H(ci * 8 + i, 22)) * TICKS_PER_HOUR;
          const seed = H(ci * 8 + i, 23), v = spec.speed * (0.94 + 0.12 * H(ci * 8 + i, 24));
          // berthed at about t: the first lane that gets it there and away again within the day, the smallest free berth
          // that takes it; every berth taken then: a slot later (p null)
          const plan = (t: number) => {
            let taken = false;
            for (const lj of lanes) {
              const start = Math.max(open, t - laneGeom(h.lanes[lj]).L / v);
              for (const bi of fit) {
                const p = planCall(ctx, h, bi, lj, spec, v, start, along);
                if (!p || p.t > cutoff) break;
                const use = berthUse(p.segs, bi);
                if (use && !clash(ctx.berths.get(berthKey(h.id, bi)), use[0], use[1], 0)) return { p, berth: bi };
                taken = true;
              }
            }
            return taken ? { p: null, berth: -1 } : null;
          };
          cands.push({ t: d0 + hour * TICKS_PER_HOUR, hid: h.id, n: 1000 + ci * 8 + i, boat: null, kind: 'call', type: c.type, seed, harbour: h, lane: li, plan });
        }
      });
    }
  }
  cands.sort((a, b) => a.t - b.t || a.hid - b.hid || a.n - b.n);

  const voyages: Voyage[] = [];
  const boatFree = new Map<number, number>();
  const tugOf = new Map<Voyage, Voyage>();
  const commit = (c: Cand, p: Plan, berth: number, passes: LiftPass[], extra: Partial<Voyage> = {}) => {
    const v: Voyage = {
      id: 0, day, kind: c.kind, boat: c.boat ? c.boat.id : boatIdOf(c.harbour.id, 100000 + day * 8192 + c.n),
      type: c.type, seed: c.seed, harbour: c.harbour.id, berth, lane: p.mainLane >= 0 ? p.mainLane : c.lane, v: p.v, segs: p.segs,
      tStart: p.segs[0].t0, tEnd: p.t, lifts: passes, ...extra,
    };
    for (const l of passes) { const list = ctx.lifts.get(l.seed) ?? []; list.push([l.t0, l.t1]); ctx.lifts.set(l.seed, list); }
    if (berth >= 0 && !c.boat) {
      const use = berthUse(p.segs, berth)!;
      const k = berthKey(c.harbour.id, berth), list = ctx.berths.get(k) ?? []; list.push(use); ctx.berths.set(k, list);
    }
    if (c.boat) boatFree.set(c.boat.id, p.t);
    voyages.push(v);
    return v;
  };
  /** plan at t, then once more pushed back to meet the first lift without waiting at the bridge */
  const attempt = (c: Cand, t: number) => {
    let r = c.plan(t);
    if (r?.p && r.p.firstWait >= BOAT_SLOT) {
      const again = c.plan(t + Math.floor(r.p.firstWait / BOAT_SLOT) * BOAT_SLOT);
      if (again?.p) r = again;
    }
    return r;
  };
  for (const c of cands) {
    let t = c.t;
    if (c.boat) t = Math.max(t, (boatFree.get(c.boat.id) ?? -Infinity) + BOAT_SLOT);
    for (let m = 0; m < MAX_TRIES; m++) {
      const r = attempt(c, t + m * BOAT_SLOT);
      if (!r) break;
      if (!r.p) continue; // the berths were taken: a slot later
      const p = r.p;
      if (p.segs[0].t0 < open || p.t > cutoff) break;
      const passes = liftPasses(p.segs, p.spec);
      if (!passesFit(ctx, passes)) break;
      const v = commit(c, p, r.berth, passes);
      if (c.type === 'containerShip') escort(ctx, c.harbour, v, open, boatFree, (tc, tp) => { tugOf.set(commit(tc, tp, tc.boat!.berth, []), v); });
      break;
    }
  }
  // lifts nobody booked keep their sailing barge: a passage on a lane through the span
  liftBarges(ctx, hs, open, cutoff, (c, p, passes) => commit(c, p, -1, passes));

  voyages.sort((a, b) => a.tStart - b.tStart || a.boat - b.boat);
  voyages.forEach((v, i) => { v.id = day * 100000 + i; });
  for (const [tug, ship] of tugOf) tug.escorts = ship.id;
  const byBoat = new Map<number, Voyage[]>();
  for (const v of voyages) { const l = byBoat.get(v.boat) ?? []; l.push(v); byBoat.set(v.boat, l); }
  return { day, voyages, byBoat };
}

/** A pleasure trip of about `dur` ticks on the harbour's cruise loop: whole laps, or out and back. */
function planCruise(ctx: Ctx, h: BoatHarbour, bi: number, li: number, spec: BoatSpec, v: number, t: number, dur: number): { p: Plan; berth: number } | null {
  const ln = h.lanes[li], g = laneGeom(ln), berth = h.berths[bi];
  const P = { x: 0, z: 0, h: 0, c: 0 };
  const build = (turnAt: number | null, laps: number) => {
    const p = new Plan(ctx, spec, v, t);
    p.mainLane = li;
    const s0 = lanePose(g, 0, 1, P);
    unberth(p, berth, bi, s0.x, s0.z, s0.h);
    if (turnAt === null) {
      if (!p.lane(li, ln, 0, laps * g.L, p.vMan, p.vMan)) return null;
      const e = lanePose(g, g.loop ? g.L - 1e-6 : g.L, 1, P);
      berthIn(p, berth, bi, e.x, e.z, e.h);
    } else {
      if (!p.lane(li, ln, 0, turnAt, p.vMan, 0.4 * v)) return null;
      p.pivot(li, g, turnAt, 1);
      if (!p.lane(li, ln, turnAt, 0, 0.4 * v, p.vMan)) return null;
      const e = lanePose(g, 0, -1, P);
      berthIn(p, berth, bi, e.x, e.z, e.h);
    }
    return p;
  };
  const lapT = g.L / v;
  const laps = Math.round(dur / lapT);
  let p: Plan | null = null;
  if (g.loop && laps >= 1 && Math.abs(laps * lapT - dur) <= 0.5 * dur) p = build(null, laps);
  else p = build(Math.min((dur * v) / 2, g.loop ? g.L - 2 : g.L - 1), 0);
  if (!p && spec.air >= bridgeClearance(BridgeStyle.Bascule)) {
    // no lift fits: turn short of the first bascule instead
    const first = g.decks.filter((d) => d.style === BridgeStyle.Bascule).map((d) => d.s0).sort((a, b) => a - b)[0];
    const turn = Math.min((dur * v) / 2, (first ?? g.L) - spec.len / 2 - LIFT_PAD - WAIT_GAP - 1);
    if (turn >= 3) p = build(turn, 0);
  }
  return p ? { p, berth: bi } : null;
}

/** A trawler's day: out to the grounds, trawling (or out of sight beyond the gate), home to land the catch. */
function planFishing(ctx: Ctx, h: BoatHarbour, b: BasedBoat, li: number, t: number, back: number, r: number): { p: Plan; berth: number } | null {
  const ln = h.lanes[li], g = laneGeom(ln), spec = BOAT_TYPES[b.type], berth = h.berths[b.berth];
  const v = spec.speed * (0.94 + 0.12 * r);
  const p = new Plan(ctx, spec, v, t);
  p.mainLane = li;
  const P = { x: 0, z: 0, h: 0, c: 0 };
  const s0 = lanePose(g, 0, 1, P);
  unberth(p, berth, b.berth, s0.x, s0.z, s0.h);
  const gate = !!ln.gate;
  if (!p.lane(li, ln, 0, g.L, p.vMan, gate ? v : 0.06, { fadeOut: gate })) return null;
  const runBack = g.L / v + 40;
  const fish = Math.min(8 * TICKS_PER_HOUR, Math.max(4 * TICKS_PER_HOUR, back - runBack - p.t));
  const e = lanePose(g, g.L, 1, P, false);
  if (gate) p.hold(fish, e.x, e.z, e.h, 'fishing', { lane: li, s: g.L, hide: true });
  else {
    // a racetrack that keeps to the room the grounds have
    const room = ln.route.room.charCodeAt(ln.route.room.length - 1) - 48;
    const B = room - 1 - 0.35;
    if (B >= 0.4) {
      const rr = Math.min(0.6, Math.max(0.12, 0.22 * B)), a = Math.max(0, B - 2.42 * rr);
      const lap = (4 * a + 2 * Math.PI * rr) / 0.06;
      p.trawl(e.x, e.z, e.h, a, rr, Math.max(1, Math.round(fish / lap)));
    } else p.hold(fish, e.x, e.z, e.h, 'fishing', { lane: li, s: g.L });
    p.pivot(li, g, g.L, 1);
  }
  if (!p.lane(li, ln, g.L, 0, gate ? v : 0.4 * v, p.vMan, { fadeIn: gate })) return null;
  const end = lanePose(g, 0, -1, P);
  berthIn(p, berth, b.berth, end.x, end.z, end.h);
  // an hour at the quay landing the catch
  p.hold(TICKS_PER_HOUR, berth.x, berth.z, berth.h, 'alongside', { berth: b.berth });
  return { p, berth: b.berth };
}

/** A ship's call: in from the gate, alongside for `along` ticks, out again. */
function planCall(ctx: Ctx, h: BoatHarbour, bi: number, li: number, spec: BoatSpec, v: number, t: number, along: number): Plan | null {
  const ln = h.lanes[li], g = laneGeom(ln), berth = h.berths[bi];
  const p = new Plan(ctx, spec, v, t);
  p.mainLane = li;
  const P = { x: 0, z: 0, h: 0, c: 0 };
  if (!p.lane(li, ln, g.L, 0, v, p.vMan, { fadeIn: true })) return null;
  const e = lanePose(g, 0, -1, P);
  berthIn(p, berth, bi, e.x, e.z, e.h);
  p.hold(along, berth.x, berth.z, berth.h, 'alongside', { berth: bi });
  const s0 = lanePose(g, 0, 1, P);
  unberth(p, berth, bi, s0.x, s0.z, s0.h);
  if (!p.lane(li, ln, 0, g.L, p.vMan, v, { fadeOut: true })) return null;
  return p;
}

/** The port's tug meets a container ship TUG_MEET tiles out, turns, and leads it in to the fairway. */
function escort(ctx: Ctx, h: BoatHarbour, ship: Voyage, open: number, boatFree: Map<number, number>, commit: (c: Cand, p: Plan) => void) {
  const tug = harbourFleet(h).find((b) => b.type === 'tug');
  if (!tug) return;
  const li = boatLane(h, 'tug');
  const seg = ship.segs.find((s): s is LaneSeg => s.k === 'lane' && s.dir < 0);
  if (li < 0 || !seg) return;
  const ln = h.lanes[li], g = laneGeom(ln), spec = BOAT_TYPES.tug, berth = h.berths[tug.berth];
  const meet = Math.min(TUG_MEET, g.L * 0.5);
  const gap = (BOAT_TYPES.containerShip.len + spec.len) / 2 + 0.8;
  // the ship's lane is not the tug's: meet where the ship's middle is `meet + gap + RAMP` from the fairway on its own lane
  const shipAt = (S: number) => {
    for (const s of ship.segs) {
      if (s.k !== 'lane' || s.dir > 0) continue;
      const lo = s.sA - s.prof.D;
      if (S <= s.sA && S >= lo) return s.t0 + s.prof.timeAt(s.sA - S);
    }
    return NaN;
  };
  const tGo = shipAt(Math.min(seg.sA, meet + gap + RAMP));
  if (Number.isNaN(tGo)) return;
  // plan backwards from tGo: unberth, out to the meeting point, turn, wait
  const P = { x: 0, z: 0, h: 0, c: 0 };
  const build = (t0: number) => {
    const p = new Plan(ctx, spec, spec.speed, t0);
    const s0 = lanePose(g, 0, 1, P);
    unberth(p, berth, tug.berth, s0.x, s0.z, s0.h);
    p.lane(li, ln, 0, meet, p.vMan, 0.4 * spec.speed);
    p.pivot(li, g, meet, 1);
    return p;
  };
  const dry = build(0);
  const t0 = tGo - dry.t - 20;
  if (t0 < open || t0 < (boatFree.get(tug.id) ?? -Infinity) + BOAT_SLOT) return;
  const p = build(t0);
  const at = lanePose(g, meet, -1, P);
  p.hold(tGo - p.t, at.x, at.z, at.h, 'waiting', { lane: li, s: meet, dir: -1 });
  const lead = new Plan(ctx, spec, ship.v, p.t);
  lead.lane(li, ln, meet, 0, 0, lead.vMan);
  p.segs.push(...lead.segs); p.t = lead.t;
  const e = lanePose(g, 0, -1, P);
  berthIn(p, berth, tug.berth, e.x, e.z, e.h);
  const c: Cand = { t: t0, hid: h.id, n: 9999, boat: tug, plan: () => null, kind: 'escort', type: 'tug', seed: tug.seed, harbour: h, lane: li };
  commit(c, p);
}

/** A sailing barge through each lift of a bascule that some lane passes and no tall boat is booked into. */
function liftBarges(ctx: Ctx, hs: readonly BoatHarbour[], open: number, cutoff: number, commit: (c: Cand, p: Plan, passes: LiftPass[]) => Voyage) {
  const spec = BOAT_TYPES.sailingBarge, done = new Set<number>();
  for (const h of hs) {
    if (!h.active) continue;
    h.lanes.forEach((ln, li) => {
      if (!(ln.sig & 16)) return;
      const g = laneGeom(ln);
      for (const dk of g.decks) {
        if (dk.style !== BridgeStyle.Bascule || done.has(dk.seed)) continue;
        done.add(dk.seed);
        basculeLifts(dk.seed, ctx.day).map((s, k) => ({ s, k })).sort((a, b) => a.s - b.s).forEach(({ s, k }) => {
          const [wa, wb] = [(s + BASCULE_RAISE) * TICKS_PER_HOUR + 1, (s + BASCULE_RAISE + BASCULE_HOLD) * TICKS_PER_HOUR - 1];
          if (clash(ctx.lifts.get(dk.seed), wa, wb, 0)) return;
          const H = (b: number) => hash2((dk.seed % 1000003) + ctx.day * 977 + k * 31, b + 601);
          const dir = H(1) < 0.5 ? 1 : -1, mid = (dk.s0 + dk.s1) / 2, v = spec.speed;
          let a = mid - dir * LIFT_BARGE_RUN, b = mid + dir * LIFT_BARGE_RUN;
          if (!g.loop) { a = Math.min(g.L, Math.max(0, a)); b = Math.min(g.L, Math.max(0, b)); }
          // middle over the deck at the middle of the open window
          const p = new Plan(ctx, spec, v, (wa + wb) / 2 - Math.abs(mid - a) / v);
          if (!p.lane(li, ln, a, b, v, v, { fadeIn: true, fadeOut: true })) return;
          if (p.segs[0].t0 < open || p.t > cutoff) return;
          const passes = liftPasses(p.segs, spec);
          if (!passes.length || !passesFit(ctx, passes)) return;
          commit({ t: p.segs[0].t0, hid: h.id, n: 5000 + k, boat: null, plan: () => null, kind: 'lift', type: 'sailingBarge', seed: H(2), harbour: h, lane: li }, p, passes);
        });
      }
    });
  }
}

// ---- boats at a tick ----------------------------------------------------------------------------------------
export interface BoatLights {
  /** sidelights, masthead and stern light: under way */
  nav: boolean;
  /** an anchor light (some moored boats) */
  anchor: boolean;
  /** green over white, while trawling */
  trawling: boolean;
  /** deck floodlights: trawling, or working cargo alongside */
  deck: boolean;
  /** accommodation lit: ships */
  accommodation: boolean;
}
export interface BoatState {
  /** the boat (stable across its voyages) */
  id: number;
  /** null while moored at home */
  voyage: Voyage | null;
  type: BoatType;
  seed: number;
  /** the harbour it belongs to or calls at, and the berth there while at, leaving or making for it (else -1) */
  harbour: number;
  berth: number;
  phase: BoatPhase;
  /** where the middle of the hull is, and the way the bow points (atan2(dz, dx)) */
  x: number; z: number; h: number;
  /** through the water, tiles a tick */
  speed: number;
  /** going astern */
  astern: boolean;
  /** 0..1 at a sea gate */
  fade: number;
  /** on a lane: its index in the harbour's lanes, the hull middle's arclength and the way it goes (lane -1: off it) */
  lane: number; s: number; dir: 1 | -1;
  lights: BoatLights;
}

const SHIPS = new Set<BoatType>(['containerShip', 'coaster', 'ropax']);
function lightsFor(type: BoatType, seed: number, phase: BoatPhase): BoatLights {
  const moving = phase !== 'moored' && phase !== 'alongside';
  return {
    nav: moving,
    anchor: phase === 'moored' && hash2(Math.floor(seed * 65536), 941) < 0.3,
    trawling: phase === 'fishing',
    deck: phase === 'fishing' || (phase === 'alongside' && (SHIPS.has(type) || type === 'trawler')),
    accommodation: SHIPS.has(type) || (type === 'sailingBarge' && moving),
  };
}

/** Every boat on the water at this (fractional) tick: those under way, and the based boats lying at home. */
export function boatsAt(hs: readonly BoatHarbour[], tick: number, out: BoatState[] = []): BoatState[] {
  out.length = 0;
  if (!hs.length) return out;
  const day = Math.floor(tick / TICKS_PER_DAY);
  const away = new Set<number>();
  for (const d of [day - 1, day]) {
    for (const v of boatTimetable(hs, d).voyages) {
      if (v.tStart > tick) break;
      if (tick >= v.tEnd) continue;
      away.add(v.boat);
      const st = voyageState(v, tick);
      if (st) out.push(st);
    }
  }
  for (const h of hs) for (const b of harbourFleet(h)) if (!away.has(b.id)) out.push(mooredState(h, b));
  return out;
}
/** A based boat lying in its home berth. */
export function mooredState(h: BoatHarbour, b: BasedBoat): BoatState {
  const be = h.berths[b.berth];
  return {
    id: b.id, voyage: null, type: b.type, seed: b.seed, harbour: h.id, berth: b.berth, phase: 'moored', x: be.x, z: be.z, h: be.h,
    speed: 0, astern: false, fade: 1, lane: -1, s: 0, dir: 1, lights: lightsFor(b.type, b.seed, 'moored'),
  };
}
/** The voyage a boat is on at a tick (also beyond a gate, where boatsAt leaves it out), or null. */
export function boatVoyageAt(hs: readonly BoatHarbour[], boat: number, tick: number): Voyage | null {
  const day = Math.floor(tick / TICKS_PER_DAY);
  for (const d of [day - 1, day]) for (const v of boatTimetable(hs, d).byBoat.get(boat) ?? []) if (tick >= v.tStart && tick < v.tEnd) return v;
  return null;
}
/** Find a harbour's boat by id: its based boat entry (null for visitors). */
export function basedBoat(hs: readonly BoatHarbour[], boat: number): BasedBoat | null {
  for (const h of hs) for (const b of harbourFleet(h)) if (b.id === boat) return b;
  return null;
}

const SC = { x: 0, z: 0, h: 0, c: 0 }, PR: [number, number] = [0, 0];
/** Where a boat on a voyage is at a tick (null: out of sight beyond a gate). */
export function voyageState(v: Voyage, tick: number): BoatState | null {
  const segs = v.segs;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].t0 <= tick) lo = m; else hi = m - 1; }
  const s = segs[lo], t = Math.max(0, Math.min(s.dur, tick - s.t0));
  const st: BoatState = {
    id: v.boat, voyage: v, type: v.type, seed: v.seed, harbour: v.harbour, berth: -1, phase: s.phase, x: 0, z: 0, h: 0, speed: 0, astern: false,
    fade: 1, lane: -1, s: 0, dir: 1, lights: lightsFor(v.type, v.seed, s.phase),
  };
  switch (s.k) {
    case 'curve': {
      const [d, sp] = s.prof.at(t, PR);
      curveAt(s.c, d, SC);
      st.x = SC.x; st.z = SC.z; st.h = wrapPi(s.astern ? SC.h + Math.PI : SC.h); st.speed = sp; st.astern = s.astern; st.berth = s.berth;
      break;
    }
    case 'lane': {
      const [d, sp] = s.prof.at(t, PR);
      const S = s.sA + s.dir * d;
      lanePose(s.g, S, s.dir, SC);
      st.x = SC.x; st.z = SC.z; st.h = SC.h; st.speed = sp; st.lane = s.lane; st.s = S; st.dir = s.dir;
      if (s.fadeIn) st.fade = Math.min(st.fade, smooth01(d / SEA_GATE_FADE));
      if (s.fadeOut) st.fade = Math.min(st.fade, smooth01((s.prof.D - d) / SEA_GATE_FADE));
      break;
    }
    case 'hold':
      if (s.hide) return null;
      st.x = s.x; st.z = s.z; st.h = s.h; st.berth = s.berth; st.lane = s.lane; st.s = s.s; st.dir = s.dir;
      break;
    case 'pivot': {
      const u = smooth01(t / s.dur), hh = s.h0 + s.dh * u;
      st.x = s.cx - Math.sin(hh) * s.off; st.z = s.cz + Math.cos(hh) * s.off; st.h = wrapPi(hh);
      st.speed = Math.max(0.01, (s.off * Math.PI) / s.dur); st.lane = s.lane; st.s = s.s; st.dir = 1;
      break;
    }
    case 'trawl': {
      const lap = 4 * s.a + 2 * Math.PI * s.r;
      let d = (t * s.v) % lap;
      const ux = Math.cos(s.hu), uz = Math.sin(s.hu), rx = -uz, rz = ux;
      st.speed = s.v;
      if (d < s.a) { st.x = s.ex + ux * d; st.z = s.ez + uz * d; st.h = s.hu; break; }
      d -= s.a;
      const arc = Math.PI * s.r;
      if (d < arc) {
        const f = d / s.r, ox = s.ex + ux * s.a + rx * s.r, oz = s.ez + uz * s.a + rz * s.r;
        st.x = ox + s.r * (-rx * Math.cos(f) + ux * Math.sin(f)); st.z = oz + s.r * (-rz * Math.cos(f) + uz * Math.sin(f)); st.h = wrapPi(s.hu + f);
        break;
      }
      d -= arc;
      if (d < 2 * s.a) { st.x = s.ex + ux * (s.a - d) + rx * 2 * s.r; st.z = s.ez + uz * (s.a - d) + rz * 2 * s.r; st.h = wrapPi(s.hu + Math.PI); break; }
      d -= 2 * s.a;
      if (d < arc) {
        const f = d / s.r, ox = s.ex - ux * s.a + rx * s.r, oz = s.ez - uz * s.a + rz * s.r;
        st.x = ox + s.r * (rx * Math.cos(f) - ux * Math.sin(f)); st.z = oz + s.r * (rz * Math.cos(f) - uz * Math.sin(f)); st.h = wrapPi(s.hu + Math.PI + f);
        break;
      }
      d -= arc;
      st.x = s.ex + ux * (d - s.a); st.z = s.ez + uz * (d - s.a); st.h = s.hu;
      break;
    }
  }
  return st;
}

// ---- events, for the server's walk through the day -----------------------------------------------------------
export type BoatEventKind = 'castOff' | 'gateOut' | 'gateIn' | 'fishing' | 'fished' | 'berthed' | 'alongside' | 'lift';
export interface BoatEvent { t: number; what: BoatEventKind; voyage: Voyage }
/**
 * A voyage's events in time order: casting off, leaving by and coming in from a gate, starting and ending fishing,
 * berthed (a trawler lands its catch then: catchOf), alongside (a ship's imports land: callCargo), each lift passage.
 */
export function voyageEvents(v: Voyage): BoatEvent[] {
  const out: BoatEvent[] = [];
  const ev = (t: number, what: BoatEventKind) => out.push({ t, what, voyage: v });
  v.segs.forEach((s, i) => {
    const prev = v.segs[i - 1];
    if (s.k === 'curve' && s.phase === 'unberthing' && prev?.phase !== 'unberthing') ev(s.t0, 'castOff');
    if (s.k === 'curve' && s.phase === 'berthing') ev(s.t0 + s.dur, 'berthed');
    if (s.k === 'lane' && s.gate && s.fadeOut) ev(s.t0 + s.dur, 'gateOut');
    if (s.k === 'lane' && s.gate && s.fadeIn) ev(s.t0, 'gateIn');
    if (s.phase === 'fishing' && prev?.phase !== 'fishing') ev(s.t0, 'fishing');
    if (s.phase === 'fishing' && v.segs[i + 1]?.phase !== 'fishing') ev(s.t0 + s.dur, 'fished');
    if (s.k === 'hold' && s.phase === 'alongside' && v.kind === 'call') ev(s.t0, 'alongside');
  });
  for (const l of v.lifts) ev(l.t0, 'lift');
  return out.sort((a, b) => a.t - b.t);
}
/** Every event of the voyages of day `day` (some fall before 04:00 on day + 1), in time order. */
export function boatEvents(hs: readonly BoatHarbour[], day: number): BoatEvent[] {
  return boatTimetable(hs, day).voyages.flatMap(voyageEvents).sort((a, b) => a.t - b.t || a.voyage.id - b.voyage.id);
}
/** The bascule passages booked on a day, by span seed: a lift with none keeps the landmark's decorative barge. */
export function boatLifts(hs: readonly BoatHarbour[], day: number): Map<number, { t0: number; t1: number; voyage: Voyage }[]> {
  const out = new Map<number, { t0: number; t1: number; voyage: Voyage }[]>();
  for (const v of boatTimetable(hs, day).voyages) for (const l of v.lifts) { const list = out.get(l.seed) ?? []; list.push({ t0: l.t0, t1: l.t1, voyage: v }); out.set(l.seed, list); }
  return out;
}
/** Hours fished on a voyage (trawling, or out of sight beyond the gate). */
export const hoursFished = (v: Voyage) => v.segs.filter((s) => s.phase === 'fishing').reduce((a, s) => a + s.dur, 0) / TICKS_PER_HOUR;
/** Boxes of fish a trawler lands (20-60): more for longer at the grounds, and some days are better than others. */
export function catchOf(v: Voyage): number {
  const h = hoursFished(v), k = Math.floor(v.seed * 4194304);
  return Math.max(20, Math.min(60, Math.round(20 + 40 * ((Math.max(4, Math.min(8, h)) - 4) / 4) * (0.55 + 0.45 * hash2(k + v.day * 131, 951)))));
}
/** What a ship's call brings and can take: containers landed and room for exports, passengers off a ro-ro ferry. */
export function callCargo(v: Voyage): { imports: number; exportRoom: number; passengers: number; vehicles: number } {
  const k = Math.floor(v.seed * 4194304), r = (n: number) => hash2(k, 961 + n);
  const range = (lo: number, hi: number, n: number) => lo + Math.floor(r(n) * (hi - lo + 1));
  switch (v.type) {
    case 'containerShip': return { imports: range(30, 60, 0), exportRoom: range(40, 70, 1), passengers: 0, vehicles: 0 };
    case 'coaster': return { imports: range(6, 12, 0), exportRoom: range(8, 14, 1), passengers: 0, vehicles: 0 };
    case 'barge': return { imports: range(4, 8, 0), exportRoom: range(4, 8, 1), passengers: 0, vehicles: 0 };
    case 'ropax': return { imports: range(2, 6, 0), exportRoom: range(2, 6, 1), passengers: range(80, 300, 2), vehicles: range(20, 60, 3) };
    default: return { imports: 0, exportRoom: 0, passengers: 0, vehicles: 0 };
  }
}

// ---- names, owners, crews -----------------------------------------------------------------------------------
const ONE_NAMES = ['Kittiwake', 'Cormorant', 'Puffin', 'Guillemot', 'Petrel', 'Curlew', 'Osprey', 'Merlin', 'Tern', 'Gannet', 'Fulmar',
  'Shearwater', 'Dunlin', 'Avocet', 'Heron', 'Kingfisher', 'Swallow', 'Skylark', 'Wren', 'Dolphin', 'Porpoise', 'Otter', 'Halcyon',
  'Serenity', 'Endeavour', 'Resolute', 'Valiant', 'Intrepid', 'Odyssey', 'Wanderer', 'Voyager', 'Pilgrim', 'Nomad', 'Spindrift',
  'Zephyr', 'Mistral', 'Tempest', 'Calypso', 'Ariel', 'Juno', 'Minerva', 'Aurora', 'Galatea', 'Clementine', 'Matilda', 'Rosalind',
  'Bluebell', 'Primrose', 'Marigold', 'Bramble', 'Thistle', 'Heather', 'Tranquillity', 'Dunroamin', 'Second Wind', 'Free Spirit'];
const NAME_A = ['Morning', 'Evening', 'Silver', 'Golden', 'Northern', 'Southern', 'Western', 'Sea', 'Blue', 'Lucky', 'Bonny', 'Fair',
  'Summer', 'Ocean', 'Silent', 'Wild', 'Island', 'Harbour', 'Quiet', 'Merry'];
const NAME_B = ['Star', 'Breeze', 'Light', 'Spirit', 'Dawn', 'Tide', 'Mist', 'Wind', 'Wave', 'Rose', 'Belle', 'Lady', 'Maid', 'Dream',
  'Venture', 'Chance', 'Promise', 'Horizon', 'Grace', 'Gull'];
const TUG_NAMES = ['Hercules', 'Samson', 'Goliath', 'Atlas', 'Titan', 'Ajax', 'Bulldog', 'Mastiff', 'Thunderer', 'Warrior', 'Sturdy', 'Brunel'];
const ROMAN = ['', '', '', '', '', '', '', '', '', '', '', ' II', ' II', ' III'];
const kOf = (seed: number) => Math.floor(seed * 4194304);
const pick = <T>(list: readonly T[], k: number, salt: number) => list[Math.floor(hash2(k, salt) * list.length)];

/** Ship lines, ferry operators and other fictional companies, with the colours the renderer paints them in. */
export interface BoatOperator { name: string; hull: number; funnel: number; short: string }
export const BOAT_OPERATORS: Partial<Record<BoatType, readonly BoatOperator[]>> = {
  containerShip: [
    { name: 'Meridian Container Line', short: 'Meridian', hull: 0x1d2b4f, funnel: 0xe8c547 },
    { name: 'Crimson Star Lines', short: 'Crimson Star', hull: 0x9c2a2a, funnel: 0xf2f0ea },
    { name: 'Greenhaven Shipping', short: 'Greenhaven', hull: 0x2f5d3a, funnel: 0xf2f0ea },
    { name: 'Greystone Maritime', short: 'Greystone', hull: 0x5d6168, funnel: 0xd7263d },
  ],
  ropax: [
    { name: 'Saltmere Ferries', short: 'Saltmere', hull: 0x1b4f8c, funnel: 0x1b4f8c },
    { name: 'Island Link Ferries', short: 'Island Link', hull: 0xb3262e, funnel: 0xf2c14e },
    { name: 'Kestrel Bay Line', short: 'Kestrel', hull: 0x14675e, funnel: 0xf2f0ea },
  ],
  coaster: [
    { name: 'Ravensport Shipping', short: 'Ravensport', hull: 0x2b2f36, funnel: 0xc8642f },
    { name: 'Tolland Coasters', short: 'Tolland', hull: 0x3b4a5a, funnel: 0xe8c547 },
    { name: 'North Quay Shipping', short: 'North Quay', hull: 0x5b2c2c, funnel: 0x2b2f36 },
  ],
  barge: [
    { name: 'Riverway Aggregates', short: 'Riverway', hull: 0x1b1d22, funnel: 0xc8642f },
    { name: 'Lindholm Lighterage', short: 'Lindholm', hull: 0x6b3a22, funnel: 0x1b1d22 },
  ],
  tug: [
    { name: 'Harbour Towage', short: 'Harbour', hull: 0x1b1d22, funnel: 0xd7263d },
    { name: 'Bulldog Towage', short: 'Bulldog', hull: 0x1b1d22, funnel: 0xf08a24 },
  ],
};
/** The operator of a commercial boat (null for private and fishing boats). */
export function boatOperator(type: BoatType, seed: number): BoatOperator | null {
  const list = BOAT_OPERATORS[type];
  return list ? pick(list, kOf(seed), 971) : null;
}

/** A boat's name, from its seed: "Kittiwake", "Morning Star", "Sea Breeze II"; ships take their line's style. */
export function boatName(type: BoatType, seed: number): string {
  const k = kOf(seed);
  if (type === 'tug') return pick(TUG_NAMES, k, 981) + pick(ROMAN, k, 983);
  if (type === 'ropax') return hash2(k, 985) < 0.5 ? `Pride of ${pick(CITIES, k, 987)}` : `${pick(CITIES, k, 987)} ${pick(['Express', 'Spirit', 'Star', 'Voyager'], k, 989)}`;
  if (type === 'containerShip') return `${boatOperator(type, seed)!.short} ${pick([...ONE_NAMES.slice(18, 34), ...NAME_B], k, 991)}`;
  if (type === 'barge') return `${boatOperator(type, seed)!.short} ${1 + Math.floor(hash2(k, 993) * 40)}`;
  const base = hash2(k, 995) < 0.5 ? pick(ONE_NAMES, k, 997) : `${pick(NAME_A, k, 999)} ${pick(NAME_B, k, 1001)}`;
  return base + pick(ROMAN, k, 1003);
}
/** A fishing registration: the harbour's two letters (from its name) and a number, "FS 127". */
export function fishingReg(harbourName: string | undefined, harbourId: number, seed: number): string {
  const k = kOf(seed), up = (harbourName ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  let two = '';
  if (up.length >= 2) {
    const rest = up.slice(1).replace(/^[AEIOU]+/, '');
    two = up[0] + (rest.match(/[^AEIOU]/)?.[0] ?? up[1]);
  } else two = String.fromCharCode(65 + Math.floor(hash2(hkOf(harbourId), 1011) * 26), 65 + Math.floor(hash2(hkOf(harbourId), 1013) * 26));
  return `${two} ${1 + Math.floor(hash2(k, 1015) * 299)}`;
}
/** Who owns a boat: a private owner, a hire firm, a fishing family, or a (fictional) line. */
export function boatOwner(type: BoatType, seed: number, harbourName?: string): string {
  const op = boatOperator(type, seed);
  if (op) return op.name;
  const k = kOf(seed);
  if (type === 'trawler') return hash2(k, 1021) < 0.5 ? `${surnameFor(Math.floor(hash2(k, 1023) * 4194304))} & Sons` : `${harbourName ?? pick(CITIES, k, 1025)} Fishing Co.`;
  if (type === 'dinghy' && hash2(k, 1027) < 0.6) return `${harbourName ?? surnameFor(Math.floor(hash2(k, 1029) * 4194304))} Boat Hire`;
  if (type === 'sailingBarge') return `${pick(NAME_A, k, 1031)} Sailing Barge Trust`;
  return nameFor(Math.floor(hash2(k, 1033) * 4194304));
}
/**
 * Who is aboard, from the boat's seed and its voyage: a skipper and the hands its type needs (a ferry also has a pier
 * hand), owners and their guests on pleasure boats. A fishing crew's real citizens come from the server instead.
 */
export function boatCrew(type: BoatType, seed: number, voyage = 0): CrewMember[] {
  const k = kOf(seed), kv = (k + voyage * 7919) % 4194304;
  const who = (n: number, role: string, key = k) => ({ name: nameFor(Math.floor(hash2(key, 1101 + n) * 4194304)), role });
  const range = (lo: number, hi: number, n: number) => lo + Math.floor(hash2(kv, 1201 + n) * (hi - lo + 1));
  const out: CrewMember[] = [];
  const add = (n: number, role: string, from: number) => { for (let i = 0; i < n; i++) out.push(who(from + i, role)); };
  switch (type) {
    case 'dinghy': out.push(who(0, 'helm', kv)); add(range(0, 1, 0), 'crew', 10); break;
    case 'motorCruiser': case 'narrowboat': out.push(who(0, 'skipper')); for (let i = 0; i < range(0, 3, 1); i++) out.push(who(20 + i, 'guest', kv)); break;
    case 'sailboat': out.push(who(0, 'skipper')); for (let i = 0; i < range(1, 3, 2); i++) out.push(who(20 + i, 'crew', kv)); break;
    case 'sailingBarge': out.push(who(0, 'skipper'), who(1, 'mate')); for (let i = 0; i < range(0, 2, 3); i++) out.push(who(20 + i, 'crew', kv)); break;
    case 'trawler': out.push(who(0, 'skipper'), who(1, 'mate')); add(range(2, 4, 4), 'deckhand', 2); break;
    case 'riverBus': out.push(who(0, 'master'), who(1, 'mate')); add(range(1, 2, 5), 'deckhand', 2); out.push(who(9, 'pier hand')); break;
    case 'ropax': out.push(who(0, 'master'), who(1, 'chief officer'), who(2, 'chief engineer'), who(3, 'purser')); add(range(2, 4, 6), 'able seaman', 4); break;
    case 'coaster': out.push(who(0, 'master'), who(1, 'mate'), who(2, 'engineer')); add(range(1, 2, 7), 'able seaman', 3); break;
    case 'containerShip': out.push(who(0, 'master'), who(1, 'chief officer'), who(2, 'chief engineer'), who(3, 'second officer'), who(4, 'cook')); add(range(3, 5, 8), 'able seaman', 5); break;
    case 'barge': out.push(who(0, 'skipper'), who(1, 'mate')); break;
    case 'tug': out.push(who(0, 'master'), who(1, 'engineer'), who(2, 'deckhand')); break;
    case 'policeLaunch': add(range(2, 3, 9), 'police officer', 0); break;
    case 'fireBoat': out.push(who(0, 'pilot')); add(range(3, 4, 10), 'firefighter', 1); break;
  }
  return out;
}
