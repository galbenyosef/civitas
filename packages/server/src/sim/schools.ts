import {
  TICKS_PER_DAY, TICKS_PER_HOUR, WALK_SPEED, CitizenState, LifeStage, capacityOf, familyOf, hash2, mod, tileKey,
  EDU, POLICY, hasPolicy, STAGES, Study, EduLevel, EduTrack, EduResult, EDU_NURSERY, EDU_DROPPED, EDU_HOMEWARD, SCHOOL_SPECS, schoolTakes, studyForAge, logEdu,
  type SchoolSpec, type SchoolInfo,
} from '@msimcity/shared';
import { tkey, type Building, type Citizen, type World } from '../world';
import { ACUTE, HEALTH, LIFE, ageOf } from './life';
import { env } from '../env';
import { CARPOOL } from './carpool';
import { stayOnLift, stemShare } from './motivation';

/**
 * Schools (docs/education.md sections 3-5): admissions, the school day, attendance, results and drop-outs.
 *
 * Nothing here runs per pupil per tick. A pupil rides the commuting machinery: at admission they get the school's
 * timetable in the shift fields their missing job leaves free, and the school door mirrored into `wx`/`wy` (`job`
 * stays false, `kind` 0), so `depart`, `ToWork`, `Work` and `endShift` run unchanged. The simulation calls in at
 * four places: `setOff` when a pupil at home is due out (escorts for the under-8s), `pickUp` and `attended` at the
 * end of the school day, and `tick`, which runs the batches:
 *
 * - **midnight, daily**: a census (who is enrolled where, which staff hold degrees), staffing quality, `due++` for the
 *   school day just held, drop-outs; on **Saturday** the results for leavers; on **Monday** admissions (the new
 *   school year: one game week is one year of age, and everyone has moved up a year by their age).
 * - **03:30, daily**: admissions for anyone still without a place (newcomers, children who moved, places freed), in
 *   time for the morning (Simulation.scheduleNext keeps four hours between arrival home and the next departure).
 * - **hourly**: the census alone, for the `pupils` and `graduates` progress counters.
 *
 * Admissions are the UK distance rule: every (child, school with room within its catchment) pair, nearest first.
 * Places are `pupilCapacity × staffing`, where staffing is the share of the teachers the school needs (staff ×
 * `teachersShare`, holding a degree; postgraduates for the university's `postgradShare`) that it has. Nothing here is
 * persisted beyond the citizens' own fields: the census rebuilds every count, and transient state restarts empty.
 */
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR, S = CitizenState;
const WEEK = LIFE.daysPerYear;
/** the family code of the education kinds (the library family, docs/education.md section 3) */
const SCHOOL_CODE = familyOf(101);
/** Monday to Friday: the school week (day 0 is a Monday) */
const WEEKDAYS = [1, 1, 1, 1, 1, 0, 0];
const ADMIT_AT = Math.round(3.5 * TPH), CENSUS_AT = 41;
/** Citizen.errand while a grown-up walks a child to school or fetches them (Simulation.escortTrip) */
export const ERRAND_SCHOOL = 3;

export const SCHOOLS = {
  /** off switch for before/after runs (EDU=0 in the environment): nobody is admitted, and nothing else runs */
  on: env('EDU') !== '0',
};

/** What the schools need from the simulation (its private trip machinery). */
export interface SchoolHost {
  scheduleNext(c: Citizen): void;
  /** the commute out, as for a worker (sick days, the route, the shift end) */
  depart(c: Citizen): void;
  /**
   * Grown-up `a` takes child `c` to c's school door (the child rides along if a drives), then goes on: home or to work.
   * `onShift`: a is already on the way to work (depart has set the shift's end), so the drop-off is on the way.
   */
  escort(a: Citizen, c: Citizen, then: number, onShift?: boolean): boolean;
  /** a grown-up walks to the school door to fetch child `c`, then home */
  fetch(a: Citizen, c: Citizen): boolean;
}

interface School {
  b: Building; spec: SchoolSpec;
  /** census counts; `evening`: learners on evening classes (the FE college's eveningPlaces, E5), not in `pupils` */
  pupils: number; present: number; staff: number; teachers: number; postgrads: number; evening: number;
  /** teachers and postgraduates needed (staff capacity × share), staffing now (0-1) and quality over the year (0.5-1) */
  needed: number; needPg: number; staffing: number; quality: number;
  /** the bell, hours */
  start: number; end: number;
  /** the latest results day (game week), its results and drop-outs since, and the waiting list at the last admissions */
  year: number; passed: number; failed: number; dropped: number; waiting: number;
  /** the owner of the school's parcel and the education policies they have on (shared/src/policies.ts), refreshed by the census */
  owner: string | undefined; meals: boolean; fees: boolean;
}

export class Schools {
  private schools = new Map<number, School>();
  /** under-8s told to wait for a household driver this morning (each waits once), and those waiting at school to be fetched */
  private waitedLift = new Set<number>();
  private fetching = new Set<number>();
  /** stages some school in town takes, with the widest catchment (Infinity: city-wide), refreshed by the census */
  private reach = new Map<number, number>();
  private counted = false;
  /**
   * What the last census saw of the whole population (the charts and the parcel panels, docs/education.md section 14):
   * residents aged 18+ by highest level, residents aged 25-64 by level (the education index) and everyone enrolled by Study.
   */
  readonly attain = { adults: new Array<number>(6).fill(0), core: new Array<number>(6).fill(0), study: new Array<number>(9).fill(0), index: 0 };
  /** called when a pass raises a citizen's level (E4 wires Skills.graduated here: the "graduated" mood and brain drain) */
  onGraduated: ((c: Citizen) => void) | null = null;
  /** since the simulation started (probes read these) */
  events = {
    enrolled: 0, graduations: 0, nurseryDone: 0, failed: 0, dropOuts: 0, left: 0, attended: 0,
    escort: { lift: 0, sibling: 0, adult: 0, onTheWay: 0, missed: 0, alone: 0 }, fetched: 0, walkedHomeAlone: 0,
    admissions: 0, waitingAtLast: 0, noSchoolAtLast: 0, wentOn: 0,
  };

  constructor(private w: World, private host: SchoolHost, private lifeEvents: { graduations: number; dropOuts: number }) {}

  tick() {
    if (!SCHOOLS.on) return;
    const t = mod(this.w.tick, DAY);
    if (t === 0) this.midnight();
    else if (t === ADMIT_AT) { this.census(); this.admit(); }
    else if (t % TPH === CENSUS_AT) this.census();
  }

  // ---- the day: hooks from the simulation ---------------------------------------------------------------------

  /** A pupil at home is due out for school (Simulation.moveCitizens). Under-8s go with someone or not at all. */
  setOff(c: Citizen) {
    const w = this.w, now = w.tick;
    const s = this.schoolOf(c);
    if (!s || c.study === Study.Evening) { this.leave(c, EduResult.Left); return; } // the school has gone (a place elsewhere at the next admissions), or an evening learner lost their job
    c.eduBits &= ~EDU_HOMEWARD;
    if (now > this.bellStart(c) + 2 * TPH) { this.host.scheduleNext(c); return; } // too late for today (home late from an outing)
    const unwell = (c.cond & ACUTE) !== 0 || c.health < HEALTH.staysHomeBelow;
    if (unwell || ageOf(c, now) >= EDU.escortAge) { this.go(c); return; } // depart decides about sick days
    const e = this.events.escort;
    // 1. a household driver leaving for work shortly: wait for them, and the carpool drops the child off (Simulation.shareToWork)
    // 2. an older brother or sister at the same school, due about now: they walk in together
    // 3. a grown-up at home with time to spare walks them there and back; 4. one due at work soon does it on the way
    let driverAt = 0, sib: Citizen | null = null, free: Citizen | null = null, onWay: Citizen | null = null;
    for (const id of w.households.get(c.hh)?.ids ?? []) {
      const p = w.citizens.get(id);
      if (!p || p === c || p.state !== S.Home || p.mig || p.hx !== c.hx || p.hy !== c.hy || (p.cond & ACUTE) || p.health < HEALTH.staysHomeBelow) continue;
      if (p.study && !p.job && p.sx === c.sx && p.sy === c.sy && Math.abs(p.nextAt - now) <= EDU.siblingWindow * TPH && ageOf(p, now) >= EDU.escortAge) { sib = p; continue; }
      if (p.stage === LifeStage.Child) continue;
      if (p.job && p.nextAt > now) {
        if (p.car && p.nextAt - now <= EDU.liftWait * TPH && (!driverAt || p.nextAt < driverAt)) driverAt = p.nextAt;
        if (p.nextAt - now <= EDU.onTheWay * TPH) { onWay ??= p; continue; }
      }
      if (!p.study && (!p.job || p.nextAt - now >= EDU.freeFor * TPH)) free ??= p;
    }
    if (driverAt && !this.waitedLift.has(c.id)) { this.waitedLift.add(c.id); c.nextAt = driverAt + 1; return; }
    if (sib) {
      this.go(sib);
      if (sib.state !== S.Home) { e.sibling++; this.go(c); return; }
    }
    if (free && this.host.escort(free, c, S.ToHome)) { e.adult++; this.started(c); this.alsoTake(c); return; }
    if (onWay && this.host.escort(onWay, c, S.ToWork)) { e.onTheWay++; this.started(c); this.alsoTake(c); return; }
    e.missed++; // no one to take them: the day counts as held, not attended
    this.host.scheduleNext(c);
  }
  /**
   * A grown-up just left for work on foot or by transit (Simulation.depart): an under-8 at home due at school within
   * the breakfast-club window goes with them, dropped off on the way. Drivers do the same through the carpool.
   */
  leaving(a: Citizen) {
    if (!SCHOOLS.on || (a.study && !a.job) || a.stage === LifeStage.Child || a.state !== S.ToWork || a.leg?.drive || a.legs.some((l) => l.drive)) return;
    const k = this.youngDue(a, -1, -1, EDU.breakfastClub * TPH);
    if (k && this.host.escort(a, k, S.ToWork, true)) { this.events.escort.onTheWay++; this.started(k); this.alsoTake(k); }
  }
  /** How long before their own time an under-8 may be taken in a household car (Simulation.shareToWork): breakfast club. */
  liftWindow(c: Citizen) { return ageOf(c, this.w.tick) < EDU.escortAge ? Math.max(CARPOOL.window, EDU.breakfastClub * TPH) : CARPOOL.window; }
  /** An under-8 in a's household at home, due out within `within` ticks (at school sx, sy when given), well enough to go. */
  private youngDue(a: Citizen, sx: number, sy: number, within: number): Citizen | null {
    const w = this.w, now = w.tick;
    for (const id of w.households.get(a.hh)?.ids ?? []) {
      const k = w.citizens.get(id);
      if (!k || k === a || !k.study || k.job || k.state !== S.Home || k.hx !== a.hx || k.hy !== a.hy || k.nextAt - now > within || now > this.bellStart(k) + 2 * TPH) continue;
      if ((sx >= 0 && (k.sx !== sx || k.sy !== sy)) || (k.cond & ACUTE) || k.health < HEALTH.staysHomeBelow || ageOf(k, now) >= EDU.escortAge) continue;
      return k;
    }
    return null;
  }
  /** Brothers and sisters under 8 at the same school, due about now, go along with c. */
  private alsoTake(c: Citizen) {
    for (let k = this.youngDue(c, c.sx, c.sy, EDU.siblingWindow * TPH); k; k = this.youngDue(c, c.sx, c.sy, EDU.siblingWindow * TPH)) {
      this.go(k);
      if (k.state === S.Home) break; // off sick after all
      this.events.escort.sibling++;
    }
  }
  /** A pupil rode off in a household car on the school run (Simulation.shareToWork): the day ends with the bell. */
  liftIn(c: Citizen) {
    c.eduBits &= ~EDU_HOMEWARD;
    c.nextAt = this.bellEnd(c);
    if (ageOf(c, this.w.tick) < EDU.escortAge) this.events.escort.lift++;
  }
  /**
   * The bell (Simulation.endShift): an under-8 waits at school to be fetched by a grown-up at home who is free, who
   * sets off now; true while they wait. Older pupils, and the under-8s nobody can fetch, go home on their own.
   */
  pickUp(c: Citizen): boolean {
    if (this.fetching.delete(c.id)) return false; // fetched: off home together
    if (ageOf(c, this.w.tick) >= EDU.escortAge) return false;
    const w = this.w, now = w.tick;
    for (const id of w.households.get(c.hh)?.ids ?? []) {
      const p = w.citizens.get(id);
      if (!p || p === c || p.stage === LifeStage.Child || p.state !== S.Home || p.mig || p.study || (p.cond & ACUTE) || p.health < HEALTH.staysHomeBelow) continue;
      if (p.job && p.nextAt > now && p.nextAt - now < EDU.freeFor * TPH) continue;
      if (!this.host.fetch(p, c)) continue;
      // they walk over; the child comes out when they should be at the gate
      c.nextAt = now + Math.ceil((Math.abs(p.hx - c.sx) + Math.abs(p.hy - c.sy)) * 1.3 / WALK_SPEED);
      this.fetching.add(c.id);
      this.events.fetched++;
      return true;
    }
    this.events.walkedHomeAlone++;
    return false;
  }
  /** The end of a school day attended (Simulation.endShift, in place of the wage). */
  attended(c: Citizen) { c.att++; this.events.attended++; }
  /** On the way home from school: CITIZEN_STUDY marks this trip, not a later one from the park. */
  homeward(c: Citizen) { c.eduBits |= EDU_HOMEWARD; }

  /** Today's bell for this pupil, absolute ticks. */
  private bellStart(c: Citizen) { return Math.floor(this.w.tick / DAY) * DAY + c.shiftStart; }
  bellEnd(c: Citizen) { return this.bellStart(c) + c.shiftLen; }
  private go(c: Citizen) {
    this.host.depart(c);
    this.started(c);
  }
  /** Set off for school however late: the day still ends with the bell (depart counts from the planned departure). */
  private started(c: Citizen) {
    c.eduBits &= ~EDU_HOMEWARD;
    if (c.state !== S.Home && c.study && !c.job) c.nextAt = Math.max(this.bellEnd(c), this.w.tick + 1);
  }

  // ---- batches --------------------------------------------------------------------------------------------------

  /** The school (record) a pupil is enrolled at, if it still stands and still teaches their stage. */
  private schoolOf(c: Citizen): School | undefined {
    if (!this.counted) this.census(); // a world just loaded: the records are rebuilt before anyone is turned away
    const s = this.schools.get(tkey(c.sx, c.sy));
    return s && this.w.buildings.get(tileKey(c.sx, c.sy)) === s.b && s.b.id === s.spec.kind && schoolTakes(s.spec, c.study) ? s : undefined;
  }

  /**
   * Who is where: the schools standing, their pupils, staff and qualified teachers, then the progress counters
   * (`pupils`: places filled in an owner's parcels; `graduates`: their residents with a degree or more; peaks).
   */
  census() {
    const w = this.w;
    this.counted = true;
    const seen = new Set<number>();
    for (const b of w.buildings.values()) {
      const spec = SCHOOL_SPECS[b.id];
      if (!spec || b.level === 0) continue;
      const k = tkey(b.x, b.y);
      seen.add(k);
      let s = this.schools.get(k);
      if (!s || s.b !== b || s.spec !== spec) {
        s = {
          b, spec, pupils: 0, present: 0, staff: 0, teachers: 0, postgrads: 0, evening: 0, needed: 0, needPg: 0, staffing: 0, quality: -1,
          start: EDU.startFrom + EDU.startSpan * hash2(b.x * 7 + 3, b.y * 11 + 5), end: EDU.endFrom + EDU.endSpan * hash2(b.x * 5 + 1, b.y * 13 + 7),
          year: -1, passed: 0, failed: 0, dropped: 0, waiting: 0, owner: undefined, meals: false, fees: false,
        };
        this.schools.set(k, s);
      }
      s.pupils = 0; s.present = 0; s.staff = 0; s.teachers = 0; s.postgrads = 0; s.evening = 0;
    }
    for (const k of this.schools.keys()) if (!seen.has(k)) this.schools.delete(k);
    const grads = new Map<string, number>(), at = this.attain, now = w.tick;
    at.adults.fill(0); at.core.fill(0); at.study.fill(0);
    // per parcel: graduates living there, and the residents aged 25-64 with the sum of their levels (the index)
    const perParcel = new Map<number, number[]>(), parcelOfHome = new Map<number, number>();
    for (const c of w.citizens.values()) {
      if (c.study) {
        at.study[c.study]++;
        const s = this.schools.get(tkey(c.sx, c.sy));
        if (s && c.study === Study.Evening) s.evening++;
        else if (s) { s.pupils++; if (c.state === S.Work && !c.job) s.present++; }
      }
      if (c.job) {
        const s = this.schools.get(tkey(c.wx, c.wy));
        if (s) { s.staff++; if (c.edu >= EduLevel.Degree) s.teachers++; if (c.edu >= EduLevel.Postgrad) s.postgrads++; }
      }
      if (c.mig) continue;
      const age = ageOf(c, now), core = age >= 25 && age < 65;
      if (age >= 18) at.adults[c.edu]++;
      if (core) at.core[c.edu]++;
      if (core || c.edu >= EduLevel.Degree) {
        const hk = tkey(c.hx, c.hy);
        let pid = parcelOfHome.get(hk);
        if (pid === undefined) { pid = w.parcelIdAt(c.hx, c.hy); parcelOfHome.set(hk, pid); }
        let a = perParcel.get(pid);
        if (!a) perParcel.set(pid, (a = [0, 0, 0]));
        if (c.edu >= EduLevel.Degree) a[0]++;
        if (core) { a[1]++; a[2] += c.edu; }
      }
    }
    for (const [pid, a] of perParcel) {
      const o = w.parcels.get(pid)?.owner;
      if (o && a[0]) grads.set(o, (grads.get(o) ?? 0) + a[0]);
    }
    let n = 0, sum = 0;
    for (let l = 0; l < at.core.length; l++) { n += at.core[l]; sum += l * at.core[l]; }
    at.index = n ? (20 * sum) / n : 0;
    const pupils = new Map<string, number>(), schoolsOf = new Map<number, number[]>();
    this.reach.clear();
    for (const s of this.schools.values()) {
      const cap = capacityOf(s.b.id, s.b.level);
      s.needed = Math.ceil(cap * s.spec.teachersShare); s.needPg = Math.ceil(cap * s.spec.postgradShare);
      s.staffing = Math.min(s.needed ? s.teachers / s.needed : 1, s.needPg ? s.postgrads / s.needPg : 1);
      if (s.quality < 0) s.quality = this.qualityNow(s);
      const pid = w.parcelIdAt(s.b.x, s.b.y), o = w.parcels.get(pid)?.owner;
      s.owner = o;
      const pol = o ? w.players.get(o)?.policies : undefined;
      s.meals = hasPolicy(pol, 'meals'); s.fees = hasPolicy(pol, 'fees');
      if (o && s.pupils) pupils.set(o, (pupils.get(o) ?? 0) + s.pupils);
      let ps = schoolsOf.get(pid);
      if (!ps) schoolsOf.set(pid, (ps = [0, 0]));
      ps[0] += s.pupils; ps[1] += s.spec.places;
      if (s.spec.places <= 0) continue;
      const r = s.spec.catchment > 0 ? s.spec.catchment : Infinity;
      for (const st of [Study.Nursery, Study.Primary, Study.Secondary, Study.SixthForm, Study.Degree, Study.Postgrad]) {
        if (schoolTakes(s.spec, st)) this.reach.set(st, Math.max(this.reach.get(st) ?? 0, r));
      }
    }
    for (const [o, n] of pupils) w.bump(o, 'pupils', n, true);
    for (const [o, n] of grads) w.bump(o, 'graduates', n, true);
    this.parcelStats(perParcel, schoolsOf);
  }
  /** The education figures of each parcel's panel; a parcel is sent again only when one of them changes. */
  private parcelStats(perParcel: Map<number, number[]>, schoolsOf: Map<number, number[]>) {
    for (const p of this.w.parcels.values()) {
      const a = perParcel.get(p.id), sc = schoolsOf.get(p.id), st = p.stats;
      const grads = a?.[0] ?? 0, eduN = a?.[1] ?? 0, eduIndex = eduN ? Math.round((20 * a![2]) / eduN) : 0;
      const pupils = sc?.[0] ?? 0, places = sc?.[1] ?? 0;
      if ((st.grads ?? 0) === grads && (st.eduN ?? 0) === eduN && (st.eduIndex ?? 0) === eduIndex && (st.pupils ?? 0) === pupils && (st.places ?? 0) === places) continue;
      st.grads = grads; st.eduN = eduN; st.eduIndex = eduIndex; st.pupils = pupils; st.places = places;
      this.w.dirtyParcels.add(p.id);
    }
  }
  /** The population figures of the last census, counted first if none was taken yet (a world just loaded). */
  attainment() {
    if (!this.counted) this.census();
    return this.attain;
  }
  private qualityNow(s: School) { return 1 - EDU.qualityDrop * (1 - s.staffing); }
  /** Places the staffing lets the school fill (evening places for evening classes). */
  private admitting(s: School, study = 0) { return Math.floor((study === Study.Evening ? s.spec.evening : s.spec.places) * s.staffing); }
  private full(s: School, study: number) { return (study === Study.Evening ? s.evening : s.pupils) >= this.admitting(s, study); }

  /** Midnight: the day just held counts, staffing feeds quality, drop-outs; results on Saturday, the new year on Monday. */
  private midnight() {
    const w = this.w, day = Math.floor(w.tick / DAY), held = day - 1, week = Math.floor(day / WEEK);
    this.waitedLift.clear(); this.fetching.clear();
    this.census();
    const schoolDay = WEEKDAYS[mod(held, WEEK)] === 1;
    const results = mod(day, WEEK) === 5; // Saturday 00:00: Friday was the last day of the school year
    for (const s of this.schools.values()) {
      s.quality += (this.qualityNow(s) - s.quality) * EDU.qualityDays;
      if (results) { s.year = week; s.passed = 0; s.failed = 0; s.dropped = 0; } // the tooltip shows the latest results day
    }
    const nextYear = (week + 1) * WEEK;
    const meals = new Map<string, number>(), fees = new Map<string, number>();
    for (const c of w.citizens.values()) {
      if (!c.study) continue;
      const s = this.schoolOf(c);
      if (!s) { this.leave(c, EduResult.Left); continue; }
      if (schoolDay) c.due++;
      if (s.owner) { // the owner's policies, billed below: free school meals feed the pupils, tuition fees pay (or, off, a grant)
        if (s.meals && schoolDay && c.study <= Study.SixthForm) { c.health = Math.min(100, c.health + POLICY.mealsHealth); meals.set(s.owner, (meals.get(s.owner) ?? 0) + 1); }
        if (c.study === Study.Degree || c.study === Study.Postgrad) fees.set(s.owner, (fees.get(s.owner) ?? 0) + (s.fees ? POLICY.feePerStudent : -POLICY.grantPerStudent));
      }
      const spec = STAGES[c.study];
      if (c.study >= Study.SixthForm && c.due >= EDU.dropOutAfter && c.att / c.due < EDU.dropOutBelow && Math.random() < EDU.dropOutPerDay) {
        c.eduBits |= EDU_DROPPED; s.dropped++; this.events.dropOuts++; this.lifeEvents.dropOuts++;
        this.leave(c, EduResult.DroppedOut);
        continue;
      }
      if (!results) continue;
      // leavers: school stages by age at the start of next year, courses by school days held
      const leaving = c.study <= Study.SixthForm ? (nextYear - c.born) / WEEK >= spec.ages[1] : c.due >= spec.days;
      if (leaving) this.result(c, s);
    }
    for (const [o, n] of meals) w.credit(o, -n * POLICY.mealsPerPupil, 'upkeep');
    for (const [o, v] of fees) w.credit(o, v, 'fees');
    if (mod(day, WEEK) === 0) this.admit();
  }

  /** Results day for one leaver: enough attendance, then the pass roll; a pass raises the level, a fail is logged. */
  private result(c: Citizen, s: School) {
    const spec = STAGES[c.study];
    let r: number = EduResult.Left;
    if (c.due > 0) {
      const bonus = (c.study === Study.Primary && (c.eduBits & EDU_NURSERY) ? EDU.nurseryBonus : 0) + (s.meals ? EDU.mealsBonus : 0);
      r = c.att / c.due < EDU.minAttend ? (c.study === Study.Nursery ? EduResult.Left : EduResult.Failed) // a nursery year is no exam
        : Math.random() >= spec.pass * s.quality * (1 + bonus) ? EduResult.Failed : EduResult.Passed;
    }
    if (r === EduResult.Passed) {
      s.passed++;
      if (c.study === Study.Nursery) { c.eduBits |= EDU_NURSERY; this.events.nurseryDone++; }
      else {
        const earns = spec.years ? spec.earns : Math.min(spec.earns, c.edu + 1); // an adult course: one level up, to its cap (E5)
        if (earns > c.edu) { c.edu = earns; this.onGraduated?.(c); }
        // the track follows the course: A-levels at a sixth form (STEM or arts by inclination), vocational at an FE college
        if (c.study === Study.SixthForm) c.track = s.spec.stage === Study.FeCourse ? EduTrack.Trades : hash2(c.id, 233) < stemShare(c) ? EduTrack.Stem : EduTrack.Arts; // by values (sim/motivation.ts): 0.5 on average
        if (c.study === Study.Degree && c.track === EduTrack.Trades && hash2(c.id, 247) < 0.8) c.track = EduTrack.Stem; // engineering
        this.events.graduations++; this.lifeEvents.graduations++;
      }
    } else if (r === EduResult.Failed) {
      s.failed++; this.events.failed++;
      c.eduBits |= EDU_DROPPED; // docs/education.md section 5: a fail keeps the old level
    }
    const done = c.study;
    this.leave(c, r);
    // offers on results day: a share of sixth-form leavers with Level 3 go on to a university in town, and of graduates to a master's
    if (r !== EduResult.Passed) return;
    // staying on leans on Status and Adventure (sim/motivation.ts stayOnLift: 1 on average)
    if (done === Study.SixthForm && hash2(c.id, 245) < EDU.uniShare * stayOnLift(c)) this.goOn(c, Study.Degree);
    else if (done === Study.Degree && hash2(c.id, 246) < EDU.postgradTake * stayOnLift(c)) this.goOn(c, Study.Postgrad);
  }
  /** An adult course finished by days attended (sim/learning.ts): results now, at the college it was taken at. */
  finish(c: Citizen) {
    const s = this.schoolOf(c);
    if (s) this.result(c, s); else this.leave(c, EduResult.Left);
  }
  /** A place at the nearest school in town that takes `study` and has room (the university's catchment is the whole city). */
  private goOn(c: Citizen, study: number) {
    let best: School | undefined, bd = Infinity;
    for (const s of this.schools.values()) {
      if (!schoolTakes(s.spec, study) || s.spec.places <= 0 || s.pupils >= this.admitting(s) || this.deterred(c, s, study)) continue;
      const d = Math.abs(s.b.x - c.hx) + Math.abs(s.b.y - c.hy);
      if ((s.spec.catchment > 0 && d > s.spec.catchment) || d >= bd) continue;
      best = s; bd = d;
    }
    if (!best || c.job) return;
    this.enrol(c, best, study);
    this.events.wentOn++;
  }

  /** Out of the stage, into the log; the timetable goes back to a job's (none). */
  leave(c: Citizen, result: number) {
    const w = this.w;
    if (result === EduResult.Left) this.events.left++;
    logEdu(c, [c.study, c.sx, c.sy, w.buildings.get(tileKey(c.sx, c.sy))?.id ?? 0, Math.floor(w.tick / DAY / WEEK), result]);
    c.study = Study.None; c.sx = 0; c.sy = 0; c.att = 0; c.due = 0; c.eduBits &= ~EDU_HOMEWARD;
    if (!c.job) { c.wx = 0; c.wy = 0; c.commute = null; c.shiftStart = 0; c.shiftLen = 0; c.cycle = [1]; c.phase = 0; }
  }

  /**
   * Admissions: everyone of school age without a place, and this week's school leavers going on to a university,
   * against the schools with room within their catchment, nearest first. One ring search per child; the census ran.
   */
  admit() {
    // the school year the next school day belongs to: after Saturday's results the leavers belong to next year's stages
    const w = this.w, yearStart = Math.floor((Math.floor(w.tick / DAY) + 2) / WEEK) * WEEK;
    if (!this.reach.size) return;
    const pairs: { d: number; c: Citizen; s: School; study: number }[] = [];
    let noSchool = 0;
    const want = new Map<Citizen, School>(); // each child's nearest school of their stage, full or not (the waiting list)
    for (const c of w.citizens.values()) {
      if (c.study || c.mig || c.job) continue;
      const age = (yearStart - c.born) / WEEK;
      const study = studyForAge(age);
      if (study === Study.None) continue; // students go on at results (goOn), newcomers through enrolAt (E5)
      if (study >= Study.SixthForm && (c.eduBits & EDU_DROPPED)) {
        const last = c.eduLog[c.eduLog.length - 1];
        if (last && last[5] === EduResult.DroppedOut) continue; // dropped out: not back this side of 18
      }
      const r = this.reach.get(study);
      if (r === undefined) { noSchool++; continue; }
      let nearest: School | undefined, nd = Infinity;
      w.eachBuiltNear(c.hx, c.hy, [SCHOOL_CODE], r, (b, d) => {
        const s = this.schools.get(tkey(b.x, b.y));
        if (!s || s.b !== b || !schoolTakes(s.spec, study) || s.spec.places <= 0 || (s.spec.catchment > 0 && d > s.spec.catchment)) return;
        if (study === Study.SixthForm && s.spec.stage === Study.SixthForm && c.edu < EduLevel.Secondary) return; // A-levels need GCSEs; FE takes anyone
        pairs.push({ d, c, s, study });
        if (d < nd) { nd = d; nearest = s; }
      });
      if (nearest) want.set(c, nearest); else noSchool++;
    }
    pairs.sort((a, b) => a.d - b.d || a.c.id - b.c.id);
    for (const p of pairs) {
      if (p.c.study || p.s.pupils >= this.admitting(p.s)) continue;
      this.enrol(p.c, p.s, p.study);
    }
    for (const s of this.schools.values()) s.waiting = 0;
    let waiting = 0;
    for (const [c, s] of want) if (!c.study) { s.waiting++; waiting++; }
    this.events.admissions++; this.events.waitingAtLast = waiting; this.events.noSchoolAtLast = noSchool;
  }

  /**
   * Enrol c at school building b for `study` if it takes that stage and has a place its staffing allows (E5: students
   * arriving for a university, adult courses). False otherwise. A pupil already enrolled elsewhere moves.
   */
  enrolAt(c: Citizen, b: Building, study: number): boolean {
    let s = this.schools.get(tkey(b.x, b.y));
    if (!s || s.b !== b) { this.census(); s = this.schools.get(tkey(b.x, b.y)); }
    if (!s || !schoolTakes(s.spec, study) || this.full(s, study) || this.deterred(c, s, study)) return false;
    if (c.study) this.leave(c, EduResult.Left);
    this.enrol(c, s, study);
    return true;
  }
  /** Tuition fees on at a university turn a stable share of would-be students away (the same people each time, by id). */
  private deterred(c: Citizen, s: School, study: number) { return s.fees && study >= Study.Degree && hash2(c.id, 249) < POLICY.feeDeter; }
  /** A place at s: the school's timetable in the free shift fields, its door as the commute's destination. */
  private enrol(c: Citizen, s: School, study: number) {
    c.study = study; c.sx = s.b.x; c.sy = s.b.y; c.att = 0; c.due = 0; c.eduBits &= ~EDU_HOMEWARD;
    if (study === Study.Evening) s.evening++; else s.pupils++;
    this.events.enrolled++;
    if (c.job) return;
    c.wx = s.b.x; c.wy = s.b.y; c.commute = null;
    // a school's own bell; a student's own lecture hours
    const start = study >= Study.Degree ? EDU.lectureFrom + EDU.lectureSpan * hash2(c.id, 241) : s.start;
    const len = study >= Study.Degree ? EDU.lectureHours : s.end - s.start;
    const jitter = (2 * hash2(c.id, 243) - 1) * EDU.pupilJitter;
    c.shiftStart = mod(Math.round((start + jitter) * TPH), DAY); c.shiftLen = Math.round(len * TPH);
    c.cycle = WEEKDAYS; c.phase = 0;
    if (c.state === S.Home) this.host.scheduleNext(c);
  }

  // ---- policy hooks for the other phases (docs/education.md section 16) ----

  /**
   * Whether pupil c is on free school meals now (their school's owner has the policy on). E4 reads it for the parents'
   * "free school meals" mood: `POLICY.mealsMood` for a household with a pupil for whom this is true.
   */
  onMeals(c: Citizen): boolean { return !!c.study && !!this.schools.get(tkey(c.sx, c.sy))?.meals; }
  /**
   * The multiplier on a graduate's chance of leaving town from the tuition-fees policy of the owner of their home:
   * `POLICY.feeDrainMul` with fees on, else 1. E4 multiplies it into the brain-drain check in lifeFamily.
   */
  drainMul(c: Citizen): number { return this.w.ownerHasPolicy(c.hx, c.hy, 'fees') ? POLICY.feeDrainMul : 1; }

  // ---- inspection -----------------------------------------------------------------------------------------------

  describe(b: Building): SchoolInfo | undefined {
    const spec = SCHOOL_SPECS[b.id];
    if (!spec || b.level === 0) return undefined;
    let s = this.schools.get(tkey(b.x, b.y));
    if (!s || s.b !== b) { this.census(); s = this.schools.get(tkey(b.x, b.y)); }
    if (!s) return undefined;
    const info: SchoolInfo = {
      stage: spec.stage, pupils: s.pupils, present: s.present, places: spec.places, admitting: this.admitting(s),
      teachers: s.teachers, teachersNeeded: s.needed, catchment: spec.catchment,
      hours: spec.stage >= Study.Degree ? [EDU.lectureFrom, EDU.lectureFrom + EDU.lectureSpan + EDU.lectureHours] : [s.start, s.end],
      quality: Math.max(0, s.quality), passed: s.passed, failed: s.failed, droppedOut: s.dropped, waiting: s.waiting,
    };
    if (s.needPg) { info.postgrads = s.postgrads; info.postgradsNeeded = s.needPg; }
    if (spec.evening) { info.evening = s.evening; info.eveningPlaces = spec.evening; info.eveningAdmitting = this.admitting(s, Study.Evening); }
    return info;
  }
  /** Every school's record (probes). */
  list(): readonly Readonly<School>[] { return [...this.schools.values()]; }
  admittingOf(s: Readonly<School>, study = 0) { return this.admitting(s as School, study); }
}
