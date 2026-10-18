import { TICKS_PER_DAY, TICKS_PER_HOUR, CitizenState, FleetKind, SCHOOLBUS, POLICY, Study, EDU_HOMEWARD, nameFor, tileKey, kindManifest, signSource, signText, type PersonRef } from '@msimcity/shared';
import type { Citizen, World } from '../world';
import { resetTrail, tkey } from '../world';
import type { Mobile, Unit, Stop, FleetService } from './mobile';
import { ACUTE, HEALTH, ageOf } from './life';

/**
 * School buses (FleetKind 9; docs/education.md section 16, docs/mobile-jobs.md): the School buses policy of
 * shared/src/policies.ts. A hashed share of a secondary school's staff are its bus drivers (`MOBILE.schoolBusShare`,
 * shared mobileRole), working Monday to Friday from 06:30. While the school's owner has the policy on, each school
 * morning between SCHOOLBUS.from and .until a free driver takes the one bus out on a round: the secondary pupils who live
 * further than SCHOOLBUS.minDist from the school and are still at home (up to `seats`, at most `maxStops` kerb stops)
 * are collected, the farthest stop first and the school last. The owner pays POLICY.busPerDay for a bus that runs, and
 * nothing while it idles.
 *
 * A pupil who gets on is put in the working state with the bell as the end of their day, as if they had arrived early
 * (their citizen is not drawn on the road); when the bus reaches the school (or is taken off the road on the way) they
 * are set down at the school door. Not built: the afternoon round (pupils ride home on foot or by transit as before; the
 * hook is to call `board` for the pupils of a school at the bell and `deliver` at their homes), and the under-8s of a
 * primary school, which `Schools.setOff` still counts as missed when nobody can take them.
 *
 * Registered by the Mobile constructor (sim/mobile.ts), so the Simulation needs no change.
 */
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR, S = CitizenState;
const PICKUP = 1, DROP = 2;

export class SchoolBuses implements FleetService {
  readonly kinds = [FleetKind.SchoolBus];
  /** school tile key -> the game day its bus last ran (or was found to have nobody to carry) */
  private ran = new Map<number, number>();
  /** pupils to collect at each stop, by the stop's ref; and the pupils aboard each bus, by vehicle id */
  private waiting = new Map<number, number[]>();
  private aboardOf = new Map<number, Citizen[]>();
  private nextRef = 1;
  stats = { rounds: 0, boarded: 0, delivered: 0, late: 0, empty: 0, charged: 0 };

  constructor(private w: World, private mobile: Mobile) {}

  tick() {
    const w = this.w, tick = w.tick;
    if (tick % 10 !== 6) return;
    const day = Math.floor(tick / DAY), h = (tick % DAY) / TPH;
    if (day % 7 >= 5 || h < SCHOOLBUS.from || h > SCHOOLBUS.until) return;
    for (const c of this.mobile.onShift(FleetKind.SchoolBus)) {
      const key = tkey(c.wx, c.wy);
      if (this.ran.get(key) === day || !this.mobile.free(c) || this.mobile.unitOf(c.id)) continue;
      if (!w.ownerHasPolicy(c.wx, c.wy, 'buses')) continue;
      this.ran.set(key, day);
      this.dispatch(c);
    }
  }

  /** The morning round for the school where driver `d` works. */
  private dispatch(d: Citizen) {
    const w = this.w;
    const school = w.buildings.get(tileKey(d.wx, d.wy));
    if (!school) return;
    // the pupils: secondary, at home and well, living far enough away to be worth a seat, grouped by the kerb in front of their home
    const at = new Map<number, { x: number; y: number; bx: number; by: number; ids: number[] }>();
    for (const c of w.citizens.values()) {
      if (c.study !== Study.Secondary || c.job || c.state !== S.Home || c.sx !== school.x || c.sy !== school.y || c.mig) continue;
      if ((c.cond & ACUTE) || c.health < HEALTH.staysHomeBelow) continue;
      if (Math.abs(c.hx - school.x) + Math.abs(c.hy - school.y) <= SCHOOLBUS.minDist) continue;
      const k = this.mobile.kerbOf(c.hx, c.hy);
      if (!k) continue;
      const key = tkey(k[0], k[1]);
      let s = at.get(key);
      if (!s) at.set(key, s = { x: k[0], y: k[1], bx: c.hx, by: c.hy, ids: [] });
      s.ids.push(c.id);
    }
    // one neighbourhood a round: out to the farthest stop that the tour budget allows, then the nearest stops on from
    // there, while the seats, the stop limit and the road the whole round may cover (school and back) allow
    const dist = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);
    const left = [...at.values()];
    let seed = -1;
    for (let i = 0; i < left.length; i++) {
      const d = dist(school.x, school.y, left[i].x, left[i].y);
      if (2 * d <= SCHOOLBUS.maxTour && (seed < 0 || d > dist(school.x, school.y, left[seed].x, left[seed].y))) seed = i;
    }
    if (seed < 0) { this.stats.empty++; return; }
    const stops: Stop[] = [];
    let cx = school.x, cy = school.y, tour = 0, seats = SCHOOLBUS.seats;
    for (let next = seed; next >= 0 && seats > 0 && stops.length < SCHOOLBUS.maxStops;) {
      const s = left.splice(next, 1)[0], ref = this.nextRef++;
      const ids = s.ids.slice(0, seats);
      seats -= ids.length;
      tour += dist(cx, cy, s.x, s.y);
      cx = s.x; cy = s.y;
      this.waiting.set(ref, ids);
      stops.push({ x: s.x, y: s.y, kerb: true, dwell: SCHOOLBUS.dwell + SCHOOLBUS.perPupil * ids.length, bx: s.bx, by: s.by, what: PICKUP, ref });
      next = -1;
      let bd = Infinity;
      for (let i = 0; i < left.length; i++) { // the nearest stop whose pick-up still leaves the way back to the school within the budget
        const d = dist(cx, cy, left[i].x, left[i].y);
        if (d < bd && tour + d + dist(left[i].x, left[i].y, school.x, school.y) <= SCHOOLBUS.maxTour) { bd = d; next = i; }
      }
    }
    stops.push(this.mobile.stopAt(school.x, school.y, SCHOOLBUS.dwell, DROP, 0));
    const u = this.mobile.launch(this, d, FleetKind.SchoolBus, [school.x, school.y], [school.x, school.y], stops, `collecting pupils for ${this.schoolName(school.x, school.y)}`);
    if (!u) { for (const s of stops) this.waiting.delete(s.ref); return; }
    this.stats.rounds++;
    const owner = w.parcelAt(school.x, school.y)?.owner;
    if (owner) { w.credit(owner, -POLICY.busPerDay, 'upkeep'); this.stats.charged += POLICY.busPerDay; }
    this.aboardOf.set(u.v.id, []);
  }

  schoolName(x: number, y: number): string {
    const b = this.w.buildings.get(tileKey(x, y)), k = b ? kindManifest(b.id) : undefined;
    return k ? signText(signSource(k, x, y)) : 'school';
  }

  // ---- FleetService --------------------------------------------------------------------------------------------

  arrive(u: Unit, s: Stop) {
    if (s.what === PICKUP) {
      const riders = this.aboardOf.get(u.v.id) ?? [];
      for (const id of this.waiting.get(s.ref) ?? []) {
        const c = this.w.citizens.get(id);
        if (!c || c.state !== S.Home || c.study !== Study.Secondary || c.job) continue; // left home another way, or the place has gone
        this.board(c);
        riders.push(c);
      }
      this.waiting.delete(s.ref);
      this.aboardOf.set(u.v.id, riders);
      u.loaded = riders.length > 0;
      u.task = `${riders.length} pupil${riders.length === 1 ? '' : 's'} aboard`;
    } else if (s.what === DROP) {
      this.deliver(u);
      u.loaded = false;
    }
  }
  depart(u: Unit, s: Stop) {
    if (s.what === DROP) { u.task = `back at ${this.schoolName(u.base[0], u.base[1])}`; return; }
    const n = this.aboardOf.get(u.v.id)?.length ?? 0;
    u.task = u.stops.length > 1 ? `collecting pupils, ${n} aboard` : `taking ${n} pupil${n === 1 ? '' : 's'} to school`;
  }
  unreachable(_u: Unit, s: Stop) { this.waiting.delete(s.ref); }
  /** Off the road on the way (stuck, or the driver gone): the pupils are set down at their school. */
  withdrawn(u: Unit, _at: [number, number]) {
    for (const s of u.stops) this.waiting.delete(s.ref);
    this.deliver(u);
  }
  /** Back at the school (also after a school stop it could not reach): whoever is still aboard is set down. */
  returned(u: Unit) { this.deliver(u); this.aboardOf.delete(u.v.id); }
  label(u: Unit) { return `${this.schoolName(u.base[0], u.base[1])} bus`; }
  baseName(c: Citizen) { return this.schoolName(c.wx, c.wy); }
  aboard(u: Unit): PersonRef[] {
    return (this.aboardOf.get(u.v.id) ?? []).map((c) => ({ id: c.id, name: nameFor(c.id, c.sn), age: Math.floor(ageOf(c, this.w.tick)), relation: 'pupil', activity: 'on the way to school' }));
  }

  // ---- the pupil ------------------------------------------------------------------------------------------------

  /** Aboard: the day is under way as if they had arrived early, ending with the bell. */
  private board(c: Citizen) {
    c.state = S.Work;
    c.eduBits &= ~EDU_HOMEWARD;
    c.nextAt = Math.floor(this.w.tick / DAY) * DAY + c.shiftStart + c.shiftLen; // the bell (Schools.bellEnd)
    this.stats.boarded++;
  }
  /** Set down at the school door, ready for the bell. */
  private deliver(u: Unit) {
    const riders = this.aboardOf.get(u.v.id);
    if (!riders) return;
    for (const c of riders) {
      if (this.w.citizens.get(c.id) !== c || c.state !== S.Work || !c.study || c.job) { this.stats.late++; continue; } // their school day ended (or they are gone) before the bus got there
      c.x = c.sx + 0.5; c.y = c.sy + 0.5; c.pts = null; c.pp = 0;
      resetTrail(c, c.sx, c.sy);
      this.stats.delivered++;
    }
    riders.length = 0;
  }
}
