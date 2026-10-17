import { gameMin, hash2 } from '@msimcity/shared';
import { tkey, type Citizen, type World } from '../world';
import { pathBetween } from '../pathfinding';
import { env } from '../env';

/**
 * Car sharing. A driver setting off may take passengers: household members leaving for work at about the same time
 * (same workplace, or dropped off on the way), a colleague living round the corner (picked up from home), children
 * coming along on an outing, and on the way back from work or a night out whoever came with them or lives near.
 * Passengers are not road users while aboard: no car of their own, not drawn, they move with the driver. They get
 * out at their stop (a drop-off on the way, at the door) or where the car parks, and walk the last bit from there.
 *
 * Every driven trip carries a token (Leg.pool on the driver's legs); a passenger's lift leg (Leg.lift) is valid while
 * the driver is still on legs with that token. Anything that ends the driver's trip early (re-plan, sent home, the
 * car abandoned in a jam, the driver gone) voids the lift and the passenger makes their own way from where they are.
 * Who shares is organic: a per-household propensity, a lower one per pair of colleagues or friends (hash-seeded).
 * Nothing here is persisted: everyone resumes at home on load.
 */
export const CARPOOL = {
  /** off switch for before/after runs (CARPOOL=0 in the environment) */
  on: env('CARPOOL') !== '0',
  /** seats besides the driver's */
  seats: 3,
  /** stops on the way (pick-ups and drop-offs) one trip may make */
  maxStops: 2,
  /** a household member or colleague due to leave within this after the driver goes with them */
  window: gameMin(30),
  /** someone at work or out without their car waits at most this long for a lift home with a household member or neighbour */
  waitBack: gameMin(60),
  /** at the end of a shift: colleagues due off within this much leave a little early to ride along */
  early: gameMin(10),
  /** how long a driver holds at a pick-up for someone not there yet before setting off without them */
  holdMax: gameMin(10),
  /** destinations this close (Manhattan tiles) to the driver's count as the same: out where the car parks, then walk */
  sameDest: 3,
  /** a drop-off on the way may lengthen the drive (Manhattan) by at most this share plus `detourAdd` tiles */
  detour: 0.35, detourAdd: 4,
  /** colleagues (and friends going home) living this close to the driver (Manhattan tiles) may share */
  neighbourR: 4,
  /** propensity to share: lo + span * hash, per household (the whole family's habit) and per pair of colleagues or friends */
  householdLo: 0.35, householdSpan: 0.6, coworkerLo: 0.05, coworkerSpan: 0.35, friendLo: 0.1, friendSpan: 0.45,
} as const;

/** How readily a household shares the car (0..1), seeded by the household id. */
export const householdShare = (hh: number) => CARPOOL.householdLo + CARPOOL.householdSpan * hash2(hh, 811);
/** How readily two colleagues carpool (0..1), seeded by the pair. */
export const coworkerShare = (a: number, b: number) => CARPOOL.coworkerLo + CARPOOL.coworkerSpan * hash2(Math.min(a, b) * 31 + 812, Math.max(a, b));
/** How readily two friends share a ride home (0..1), seeded by the pair. */
export const friendShare = (a: number, b: number) => CARPOOL.friendLo + CARPOOL.friendSpan * hash2(Math.min(a, b) * 31 + 813, Math.max(a, b));

const manhattan = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

interface Lift {
  driver: number; trip: number;
  /** tile key where they get in, and where they get out (-1: wherever the car parks) */
  on: number; off: number;
  dest: [number, number];
  aboard: boolean;
  /** out of the car (or never got in): 'off' at their stop, 'void' when the lift fell through */
  end: '' | 'off' | 'void';
}
interface Car { trip: number; ids: number[]; holdSince: number }

/** A rider the driver could take: where they would get in (absent: where the drive starts) and where they are going. */
export interface Candidate { p: Citizen; dest: [number, number]; on?: [number, number] }
/** Who rides, and the stops the drive makes on the way (pick-ups first, then drop-offs nearest first). */
export interface PoolPlan { via: [number, number][]; riders: { p: Citizen; on: [number, number] | null; off: [number, number] | null; dest: [number, number] }[] }

export class Carpool {
  private lifts = new Map<number, Lift>(); // by passenger id
  private cars = new Map<number, Car>();   // by driver id
  private nextTrip = 1;
  /** citizens who stayed on at work or a venue for a lift home (once per trip; cleared when they set off) */
  readonly waited = new Set<number>();
  /** since start: driven trips that carried someone, passengers carried, passengers dropped at a stop on the way, lifts that fell through */
  stats = { sharedTrips: 0, passengers: 0, droppedOnWay: 0, voided: 0 };

  constructor(private w: World) {}

  /** A token for a new driven trip (every one gets one; Leg.pool). */
  token() { return this.nextTrip++; }

  /**
   * Choose riders and stops for a drive from `from` to `dest`, at most `seats`. Same destination (within sameDest):
   * out where the car parks. Elsewhere: a drop-off at the door when the detour is small. A rider getting in elsewhere
   * (a colleague's home) is a pick-up stop. maxStops bounds both.
   */
  choose(from: [number, number], dest: [number, number], cands: Candidate[]): PoolPlan {
    const plan: PoolPlan = { via: [], riders: [] };
    const picks: [number, number][] = [], drops: [number, number][] = [];
    const direct = manhattan(from, dest);
    const length = (pk: [number, number][], dr: [number, number][]) => {
      let at = from, n = 0;
      for (const s of [...pk, ...dr]) { n += manhattan(at, s); at = s; }
      return n + manhattan(at, dest);
    };
    const near = (list: [number, number][], t: [number, number]) => list.some((s) => s[0] === t[0] && s[1] === t[1]);
    const byDist = (list: [number, number][]) => list.sort((a, b) => manhattan(from, a) - manhattan(from, b));
    for (const c of cands) {
      if (plan.riders.length >= CARPOOL.seats) break;
      const on = c.on && (c.on[0] !== from[0] || c.on[1] !== from[1]) ? c.on : null;
      const same = manhattan(c.dest, dest) <= CARPOOL.sameDest;
      const pk = on && !near(picks, on) ? byDist([...picks, on]) : picks;
      const dr = !same && !near(drops, c.dest) ? byDist([...drops, c.dest]) : drops;
      if (pk.length + dr.length > CARPOOL.maxStops) continue;
      if ((pk !== picks || dr !== drops) && length(pk, dr) > direct * (1 + CARPOOL.detour) + CARPOOL.detourAdd) continue;
      picks.splice(0, picks.length, ...pk); drops.splice(0, drops.length, ...dr);
      plan.riders.push({ p: c.p, on, off: same ? null : c.dest, dest: c.dest });
    }
    plan.via = [...picks, ...drops];
    return plan;
  }

  /** Book a seat in `driver`'s car on trip `trip`. */
  add(driver: Citizen, trip: number, p: Citizen, on: [number, number], off: [number, number] | null, dest: [number, number]) {
    let car = this.cars.get(driver.id);
    if (!car || car.trip !== trip) { car = { trip, ids: [], holdSince: -1 }; this.cars.set(driver.id, car); this.stats.sharedTrips++; }
    car.ids.push(p.id);
    // already at the car, and the car is setting off from here: straight in
    const now = !!p.leg?.lift && !!driver.leg?.drive && driver.path[0] === on[0] && driver.path[1] === on[1];
    this.lifts.set(p.id, { driver: driver.id, trip, on: tkey(on[0], on[1]), off: off ? tkey(off[0], off[1]) : -1, dest, aboard: now, end: '' });
    if (now) { p.x = driver.x; p.y = driver.y; }
    this.stats.passengers++;
  }
  /** Seats taken (aboard or booked) on the driver's current trip. */
  booked(driver: Citizen): number {
    const car = this.cars.get(driver.id);
    return car && this.tripOf(driver) === car.trip ? car.ids.length : 0;
  }
  /** The token of the trip the driver is on (the current leg's, else the next tagged one), 0 when none. */
  tripOf(d: Citizen): number {
    if (d.leg?.pool) return d.leg.pool;
    for (const l of d.legs) if (l.pool) return l.pool;
    return 0;
  }
  private valid(l: Lift): Citizen | null {
    const d = this.w.citizens.get(l.driver);
    return d && this.tripOf(d) === l.trip ? d : null;
  }

  /**
   * A passenger's tick while their lift leg is the current one. 'wait': not picked up yet; 'ride': aboard (moved to
   * the car); 'off': out at their stop, the legs after it already set; 'void': the lift fell through, make your own way.
   */
  ride(p: Citizen): 'wait' | 'ride' | 'off' | 'void' {
    const l = this.lifts.get(p.id);
    if (!l) return 'void';
    if (l.end) { this.lifts.delete(p.id); if (l.end === 'void') this.stats.voided++; return l.end; }
    const d = this.valid(l);
    if (!d) { this.lifts.delete(p.id); this.stats.voided++; return 'void'; }
    if (!l.aboard) return 'wait';
    p.x = d.x; p.y = d.y;
    return 'ride';
  }
  /** Is this passenger in the car now (not waiting to be picked up)? */
  aboard(p: Citizen) { return !!this.lifts.get(p.id)?.aboard; }
  /** The driver of the car this citizen rides in or waits for. */
  driverOf(p: Citizen): number { return this.lifts.get(p.id)?.driver ?? 0; }

  /**
   * The driver is at the start of a drive leg, still off the road: let in everyone booked to get in here who is ready
   * (their lift leg is under way). True while someone booked here is not there yet, for at most holdMax; after that
   * the car goes without them (their lift falls through).
   */
  hold(d: Citizen): boolean {
    const car = this.cars.get(d.id);
    if (!car || car.trip !== d.leg?.pool || d.path.length < 2) return false;
    const here = tkey(d.path[0], d.path[1]);
    let pending = 0;
    for (const id of car.ids) {
      const l = this.lifts.get(id);
      if (!l || l.trip !== car.trip || l.aboard || l.end || l.on !== here) continue;
      const p = this.w.citizens.get(id);
      if (!p) continue;
      if (p.leg?.lift) { l.aboard = true; p.x = d.x; p.y = d.y; continue; }
      pending++;
    }
    if (!pending) { car.holdSince = -1; return false; }
    if (car.holdSince < 0) car.holdSince = this.w.tick;
    if (this.w.tick - car.holdSince <= CARPOOL.holdMax) return true;
    for (const id of car.ids) {
      const l = this.lifts.get(id);
      if (l && l.trip === car.trip && !l.aboard && !l.end && l.on === here) l.end = 'void';
    }
    car.holdSince = -1;
    return false;
  }

  /**
   * Let passengers out where the car is: those whose stop this is, or (`all`, the car has parked) everyone aboard.
   * Each walks on from here to where they were going; their lift ends on their next tick.
   */
  unload(d: Citizen, all: boolean) {
    const car = this.cars.get(d.id);
    if (!car) return;
    const px = Math.floor(d.x), py = Math.floor(d.y), here = tkey(px, py);
    for (const id of car.ids) {
      const l = this.lifts.get(id);
      if (!l || l.trip !== car.trip || !l.aboard || l.end || !(all || l.off === here)) continue;
      const p = this.w.citizens.get(id);
      if (!p) continue;
      l.end = 'off'; l.aboard = false;
      p.x = d.x; p.y = d.y;
      p.legs = [];
      if (px !== l.dest[0] || py !== l.dest[1]) {
        const wp = pathBetween(this.w, px, py, l.dest[0], l.dest[1]);
        if (wp) p.legs.push({ path: wp, drive: false, arrive: 'none' });
        else { p.x = l.dest[0] + 0.5; p.y = l.dest[1] + 0.5; }
      }
      if (!all) this.stats.droppedOnWay++;
    }
    if (all) this.cars.delete(d.id);
  }

  /** Passengers aboard and booked on the driver's current trip, in boarding order: [id, aboard]. */
  occupants(d: Citizen): [number, boolean][] {
    const car = this.cars.get(d.id);
    if (!car || this.tripOf(d) !== car.trip) return [];
    const out: [number, boolean][] = [];
    for (const id of car.ids) {
      const l = this.lifts.get(id);
      if (l && l.trip === car.trip && !l.end && this.w.citizens.has(id)) out.push([id, l.aboard]);
    }
    return out;
  }

  /** Forget a citizen's part in any car share (re-planned, sent home, removed). Their passengers find out on their own tick. */
  forget(c: Citizen) {
    this.lifts.delete(c.id);
    this.cars.delete(c.id);
    this.waited.delete(c.id);
  }
}
