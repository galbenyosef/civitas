import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { hash2 } from './noise';
import { nameFor } from './names';
import { SEATS } from './airport';
import type { Flight, FlightPhase, PlaneType } from './flights';

/**
 * Who works on a train or a plane, and who flies (docs/rail.md, docs/airport.md). Crews and plane passengers are not
 * simulated people: they are generated from the vehicle's identity, so server and clients agree on every name without
 * anything going over the wire. Each vehicle gets its own crew size and names (organic rule); train crews change
 * over at a per-train hour in the afternoon, plane crews stay with their flight through the turnaround.
 */

export interface CrewMember { name: string; role: string }

/** a name seed kept small enough for hash2's integer maths */
const seedOf = (a: number, b: number) => Math.floor(hash2(a, b) * 4194304);
const person = (a: number, b: number) => nameFor(seedOf(a, b));
/** a flight's key for names: flight ids repeat between airports, their variation seeds do not */
const flightKey = (f: Flight) => seedOf(f.id, Math.floor(f.seed * 65536));

// ---- trains -----------------------------------------------------------------------------------------

/** The hour (13:00-15:30, per train) when the early crew hands over to the late one. */
export const crewChangeHour = (lineId: number, train: number) => 13 + 2.5 * hash2(lineId * 41 + train, 503);

/**
 * The crew of train `train` of a line at `tick`. Passenger trains: a driver and a guard or conductor (lines differ in
 * what they call them), longer trains sometimes a ticket inspector, now and then a trainee driver in the cab.
 * Freight: a driver, often a relief driver for the long haul, sometimes a shunter riding to the yards.
 */
export function trainCrew(lineId: number, train: number, freight: boolean, vehicles: number, tick: number): CrewMember[] {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const hour = (tick - day * TICKS_PER_DAY) / TICKS_PER_HOUR;
  // the early turn runs from the first service until the changeover, the late turn after it (and past midnight)
  const turn = hour < 5 ? day * 2 - 1 : hour < crewChangeHour(lineId, train) ? day * 2 : day * 2 + 1;
  const k = lineId * 977 + train * 131 + turn * 7;
  const roll = (n: number) => hash2(k, 601 + n);
  const out: CrewMember[] = [{ name: person(k, 611), role: 'driver' }];
  if (freight) {
    if (roll(1) < 0.45) out.push({ name: person(k, 613), role: 'relief driver' });
    if (roll(2) < 0.2) out.push({ name: person(k, 617), role: 'shunter' });
  } else {
    if (roll(3) < 0.1) out.push({ name: person(k, 619), role: 'trainee driver' });
    out.push({ name: person(k, 623), role: hash2(lineId, 607) < 0.5 ? 'guard' : 'conductor' });
    if (vehicles >= 4 ? roll(4) < 0.45 : roll(4) < 0.15) out.push({ name: person(k, 631), role: 'ticket inspector' });
  }
  return out;
}

// ---- planes -----------------------------------------------------------------------------------------

export interface Airline {
  name: string; code: string;
  /** fin, winglets and engine lips */
  tail: number;
  /** the cheat line along the fuselage */
  stripe: number;
  /** the fuselage, white unless the airline paints it */
  body?: number;
}
/**
 * Airlines and their liveries (render/planes.ts paints the tail, stripe and body with these), so a plane's tail tells
 * you who flies it. Fictional names and codes.
 */
export const AIRLINES: readonly Airline[] = [
  { name: 'Crimson Air', code: 'CX', tail: 0xd7263d, stripe: 0x8c1422 }, { name: 'Bluewater Airways', code: 'BW', tail: 0x1b6ca8, stripe: 0x0f3d63 },
  { name: 'Tealwing', code: 'TW', tail: 0x1f9d8b, stripe: 0xf2c14e }, { name: 'Sunset Express', code: 'SX', tail: 0xf08a24, stripe: 0xd7263d },
  { name: 'Violet Air', code: 'VA', tail: 0x6a4c93, stripe: 0xc9a3e6 }, { name: 'Evergreen Air', code: 'EG', tail: 0x2d6a4f, stripe: 0x95d5b2 },
  { name: 'Goldline', code: 'GL', tail: 0xf2c14e, stripe: 0x2b2f36 }, { name: 'Northstar Airlines', code: 'NS', tail: 0x2b2f36, stripe: 0xc0c6cc, body: 0xe4e8ec },
  { name: 'Flamingo Air', code: 'FM', tail: 0xe05a9d, stripe: 0xf7b2d0 }, { name: 'Skylark Regional', code: 'SK', tail: 0x3aa0e6, stripe: 0x1b6ca8 },
  { name: 'Harbour Air', code: 'HB', tail: 0x0b3954, stripe: 0xe8c547, body: 0xf3efe6 }, { name: 'Copperline', code: 'CL', tail: 0xb4652f, stripe: 0x5b3a29 },
];
/** livery (and airline) index of a flight's variation seed: render/planes.ts colours the tail with the same */
export const liveryIndex = (seed: number) => Math.floor(seed * 7919) % AIRLINES.length;
/** body tint index (render/planes.ts BODY_TINTS) */
export const bodyTintIndex = (seed: number, n: number) => Math.floor(seed * 977) % n;

/** fictional towns beyond the map that flights come from and go to (helicopters.ts names them too) */
export const CITIES = ['Port Aldry', 'Kestrel Bay', 'Marlow', 'Northgate', 'Valdera', 'Easthaven', 'Corran', 'Brightwater', 'Lindholm',
  'Saltmere', 'Ardent Falls', 'Ravensport', 'Tolland', 'Mirabel', 'Glenrock', 'Westvale', 'Sorrento Point', 'Halvard',
  'Calder City', 'Fairhollow', 'New Bastia', 'Ostmark', 'Larkspur', 'Thornbury'];

export interface FlightManifest {
  /** operator: an airline, or 'private charter' for business jets */
  airline: string;
  /** the inbound and outbound flight numbers ('CX 412' / 'CX 413'), or a business jet's registration for both */
  inbound: string; outbound: string;
  origin: string; destination: string;
  seats: number;
  /** passengers brought in and taken away (shared/src/airport.ts flightPassengers) */
  arriving: number; departing: number;
  crew: CrewMember[];
}

/** Everything about a flight that does not change while it flies. */
export function flightManifest(f: Flight, arriving: number, departing: number): FlightManifest {
  const biz = f.type === 'bizjet';
  const al = AIRLINES[liveryIndex(f.seed)];
  const fk = flightKey(f);
  const n = 100 + 2 * Math.floor(hash2(fk, 701) * 450);
  const reg = biz ? `C-${String.fromCharCode(...[0, 1, 2, 3].map((i) => 65 + Math.floor(hash2(fk, 711 + i) * 26)))}` : '';
  const o = Math.floor(hash2(fk, 703) * CITIES.length);
  // usually back to where it came from, sometimes on to somewhere else
  const d = hash2(fk, 705) < 0.6 ? o : (o + 1 + Math.floor(hash2(fk, 707) * (CITIES.length - 1))) % CITIES.length;
  return {
    airline: biz ? 'private charter' : al.name,
    inbound: biz ? reg : `${al.code} ${n}`, outbound: biz ? reg : `${al.code} ${n + 1}`,
    origin: CITIES[o], destination: CITIES[d], seats: SEATS[f.type],
    arriving, departing, crew: flightCrew(f),
  };
}

/** Cabin crew by type: what the seats need, give or take one per flight (organic rule). */
const CABIN: Record<PlaneType, [number, number]> = { turboprop: [2, 2], regional: [2, 3], narrowbody: [4, 5], widebody: [8, 10], jumbo: [11, 14], bizjet: [0, 1] };
/** seats across a row */
const ACROSS: Record<PlaneType, number> = { turboprop: 4, regional: 4, narrowbody: 6, widebody: 9, jumbo: 10, bizjet: 2 };
/** Captain and first officer, then the cabin led by a purser (or a lone flight attendant), sometimes a trainee. */
export function flightCrew(f: Flight): CrewMember[] {
  const k = flightKey(f);
  const out: CrewMember[] = [{ name: person(k, 721), role: 'captain' }, { name: person(k, 723), role: 'first officer' }];
  const [lo, hi] = CABIN[f.type];
  const cabin = lo + Math.floor(hash2(k, 725) * (hi - lo + 1));
  for (let i = 0; i < cabin; i++) out.push({ name: person(k, 731 + i), role: i === 0 && cabin > 1 ? 'purser' : 'flight attendant' });
  if (f.type !== 'bizjet' && hash2(k, 727) < 0.15) out.push({ name: person(k, 741), role: 'trainee cabin crew' });
  return out;
}

/** Which leg's passengers are on board, and how many, at this point of the flight: deplaning early in the turnaround, boarding late in it. */
export function flightAboard(m: Pick<FlightManifest, 'arriving' | 'departing'>, phase: FlightPhase, progress: number): { leg: 'in' | 'out'; count: number } {
  if (phase === 'approach' || phase === 'flare' || phase === 'rollout' || phase === 'taxiIn') return { leg: 'in', count: m.arriving };
  if (phase !== 'dwell') return { leg: 'out', count: m.departing };
  if (progress < 0.5) return { leg: 'in', count: Math.round(m.arriving * Math.max(0, 1 - progress / 0.3)) };
  return { leg: 'out', count: Math.round(m.departing * Math.min(1, (progress - 0.5) / 0.4)) };
}
/** Passenger `i` (0-based seat order) of a flight's inbound or outbound leg: a visitor, not a citizen. */
export function flightPassenger(f: Flight, leg: 'in' | 'out', i: number): { name: string; seat: string } {
  const k = flightKey(f) + (leg === 'in' ? 1 : 2);
  const across = ACROSS[f.type];
  // seats fill in a per-flight shuffled order, not row by row
  const slot = (i * 7919 + Math.floor(hash2(k, 751) * 997)) % SEATS[f.type];
  const row = 1 + Math.floor(slot / across), letter = String.fromCharCode(65 + (slot % across));
  return { name: person(k, 1000 + i), seat: `${row}${letter}` };
}
