import {
  TICKS_PER_DAY, TICKS_PER_HOUR, CitizenState, LifeStage, Zone, EDU, POLICY, STAGES, Study, EduLevel, EduTrack, EduResult,
  SCHOOL_SPECS, capacityOf, familyOf, hash2, mod, tileKey, eduDefaults, trackFor, logEdu, type EduFields,
} from '@msimcity/shared';
import { tkey, type Building, type Citizen, type World } from '../world';
import { ACUTE, HEALTH, LIFE, ageOf } from './life';
import { SCHOOLS, type Schools } from './schools';
import type { Skills } from './skills';
import type { Gateways } from './gateways';

/**
 * Higher and adult education (docs/education.md sections 4-7 and 18, phase E5), beside the schools (sim/schools.ts),
 * which still hold every enrolment: this file decides who enrols and when, through `Schools.enrolAt` and `leave`.
 *
 * - **Students from outside town.** Each morning a university asks for students for its free places (at most
 *   `EDU.intakePerDay` of them a day; with tuition fees on it fills only `1 - POLICY.feeDeter` of its places): a bed
 *   in the nearest hall of residence with one free, else a home with room near the campus, and a newcomer queued at a
 *   gateway with a tag (`Gateways.request`). They arrive aged 18-20 with A-levels and enrol on a degree. With no
 *   gateway (or while a demo fills) they move straight in.
 * - **Halls of residence** (kind 108, `beds`) house only students: a hall is civic (its occupants are its two staff),
 *   so residents count in `Building.lodgers` (World.bedIn). A resident who is no longer studying moves to a home with
 *   room nearby, or leaves town; so does one whose hall has gone.
 * - **Adult learning** (the `learning` policy, at the owner of the FE college): an adult out of work for
 *   `EDU.feIdleDays` days below Level 3 takes a full-time FE course (`Study.FeCourse`, 4 days attended); a worker
 *   below GCSEs takes an evening class (`Study.Evening`, 6 evenings, the college's `eveningPlaces`): on school days a
 *   venue trip to the college with `errand` ERRAND_CLASS from about 18:00, the class until 20:30 (so only for workers
 *   whose working day ends by 17:15). Either one rises one
 *   level (Schools.result). The college's owner pays `POLICY.learnerPerDay` a learner a day; with the policy off the
 *   courses close.
 * - **Apprenticeships** (the `apprentice` policy, at the owner of the workplace): up to `POLICY.apprenticeShare` of the
 *   places at an industrial or yard workplace go to workers under 25 below Level 3, who train on the job: after 8
 *   shifts (`Citizen.appr`, counted at the wage) they hold Level 3 in the trades track. The owner pays
 *   `POLICY.apprenticeWageShare` of the apprentice's wage.
 * - **Research ambition.** A staffed research institute lets merged offices within `EDU.researchReach` tiles grow one
 *   level taller than their neighbourhood would (Simulation.ambition).
 *
 * The batches: 03:00 daily (courses finishing, fees, enrolments, halls), 06:00 (the student intake), 17:30 on school
 * days (tonight's evening classes, each learner leaving at their own minute), and the research list hourly. Nothing is
 * saved but the citizens' fields; a queued student who never arrives is forgotten after a day.
 */
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR, S = CitizenState;
const DAILY_AT = 3 * TPH, INTAKE_AT = 6 * TPH, EVENING_AT = Math.round(17.5 * TPH), RESEARCH_AT = 47;
/** an evening learner not home at their time looks again this often, until EVENING_LAST (time of day) */
const RETRY = Math.round(TPH / 6), EVENING_LAST = Math.round(19 * TPH);
const WEEKDAYS = [1, 1, 1, 1, 1, 0, 0];
/** Citizen.errand on the way to and at an evening class (1 is the doctor, 3 the school run) */
export const ERRAND_CLASS = 2;

/** What adult learning and the student intake need from the simulation. */
export interface LearningHost {
  /** a citizen at home in `home` (Simulation.makeCitizen), not yet in the world */
  make(id: number, home: Building, age: number, health: number, edu?: EduFields): Citizen;
  /** c sets off from home for the evening class at (x, y), and home after it; false with no way there */
  classTrip(c: Citizen, x: number, y: number): boolean;
  /** c (at home) moves to home b */
  rehome(c: Citizen, b: Building): void;
  /** c leaves town (through a gateway when there is one) */
  leave(c: Citizen): void;
}

interface Queued { ux: number; uy: number; hx: number; hy: number; at: number }

export class Learning {
  /** students queued at the gateways, by tag (Gateways.request) */
  private intake = new Map<number, Queued>();
  private nextTag = 1;
  /** staffed research institutes' doors, refreshed hourly */
  private research: [number, number][] = [];
  /** tonight's evening classes: departure tick -> learners */
  private tonight = new Map<number, number[]>();
  /** door tiles that held a hall of residence (so residents of one demolished are found) */
  private hallKeys = new Set<number>();
  /** since the simulation started (probes, the demo check) */
  stats = {
    requested: 0, students: 0, inHalls: 0, turnedAway: 0, movedOut: 0, leftHalls: 0,
    feEnrolled: 0, eveningEnrolled: 0, classTrips: 0, classesAttended: 0, classesMissed: 0, coursesClosed: 0,
    /** why an evening was missed: still out (at work, at a venue), unwell, due at work soon, no way there */
    missed: { out: 0, unwell: 0, shift: 0, noWay: 0 },
    adultPassed: 0, adultFailed: 0, learnerFees: 0,
    apprentices: 0, apprenticeships: 0, apprCancelled: 0, apprFees: 0,
  };

  constructor(private w: World, private schools: Schools, private skills: Skills, private gateways: Gateways,
    private host: LearningHost, private lifeEvents: { graduations: number }) {}

  tick() {
    if (!SCHOOLS.on) return;
    const now = this.w.tick, t = mod(now, DAY);
    if (t === DAILY_AT) this.daily();
    else if (t === INTAKE_AT) this.intakeDay();
    else if (t === EVENING_AT) this.planEvening();
    if (t % TPH === RESEARCH_AT) this.refreshResearch();
    if (this.tonight.size) {
      const ids = this.tonight.get(now);
      if (ids) { this.tonight.delete(now); for (const id of ids) this.setOffClass(id); }
    }
  }

  // ---- the student intake ------------------------------------------------------------------------------------------

  /** Each morning: every university asks for students from outside for its free places, a bed for each first. */
  private intakeDay() {
    const w = this.w, now = w.tick;
    for (const [tag, q] of this.intake) if (now - q.at > DAY) this.intake.delete(tag); // queued at a gate that closed, or turned back
    const unis = this.schools.list().filter((s) => s.spec.stage === Study.Degree && s.spec.places > 0);
    if (!unis.length) return;
    const forUni = new Map<number, number>(), forHome = new Map<number, number>();
    for (const q of this.intake.values()) {
      forUni.set(tkey(q.ux, q.uy), (forUni.get(tkey(q.ux, q.uy)) ?? 0) + 1);
      forHome.set(tkey(q.hx, q.hy), (forHome.get(tkey(q.hx, q.hy)) ?? 0) + 1);
    }
    const halls = this.schools.list().filter((s) => s.spec.beds > 0).map((s) => s.b);
    for (const s of unis) {
      const u = s.b;
      const target = Math.floor(this.schools.admittingOf(s) * (s.fees ? 1 - POLICY.feeDeter : 1));
      let n = Math.min(target - s.pupils - (forUni.get(tkey(u.x, u.y)) ?? 0), Math.ceil(s.spec.places * EDU.intakePerDay));
      for (; n > 0; n--) {
        const home = this.bedFor(u, halls, forHome);
        if (!home) break;
        const tag = this.nextTag++;
        this.intake.set(tag, { ux: u.x, uy: u.y, hx: home.x, hy: home.y, at: now });
        forHome.set(tkey(home.x, home.y), (forHome.get(tkey(home.x, home.y)) ?? 0) + 1);
        this.stats.requested++;
        // through a gateway over the day; with none (or while a demo fills) they move straight in
        if (!this.gateways.request(home, Math.round(DAY / 2), tag)) this.student(home, tag);
      }
    }
  }
  /** A bed for a student of university u: the nearest hall with one free, else a home with room near the campus. */
  private bedFor(u: Building, halls: Building[], forHome: Map<number, number>): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const h of halls) {
      const d = Math.abs(h.x - u.x) + Math.abs(h.y - u.y);
      if (d > EDU.hallsReach || d >= bd || (h.lodgers ?? 0) + (forHome.get(tkey(h.x, h.y)) ?? 0) >= this.bedsOf(h)) continue;
      best = h; bd = d;
    }
    if (best) return best;
    const w = this.w, now = w.tick;
    return w.bestBuiltNear(u.x, u.y, [Zone.Residential], EDU.studentHomeReach, 0, (b, d) => {
      const room = capacityOf(b.id, b.level) - b.occupants - this.gateways.pendingAt(b.x, b.y) - ((b.holdUntil ?? 0) > now ? 1 : 0);
      return room > 0 && familyOf(b.id) === Zone.Residential ? -d : null;
    });
  }
  private bedsOf(b: Building) { return SCHOOL_SPECS[b.id]?.beds ?? 0; }

  /**
   * A student queued with `tag` has come for their new home (Simulation.arriveVia, at a gateway; or in place): built,
   * enrolled on a degree, counted into the bed and in the world. Null when the bed or the place has gone meanwhile,
   * or tuition fees put them off: then nobody comes.
   */
  student(home: Building | undefined, tag: number): Citizen | null {
    const w = this.w, q = this.intake.get(tag);
    this.intake.delete(tag);
    const uni = q && w.buildings.get(tileKey(q.ux, q.uy));
    if (!q || !home || !uni) return null;
    const hall = home.zone !== Zone.Residential;
    if (hall ? (home.lodgers ?? 0) >= this.bedsOf(home) : home.occupants >= capacityOf(home.id, home.level)) return null;
    const id = w.nextId++, age = EDU.intakeAge + EDU.intakeSpan * hash2(id, 259);
    const c = this.host.make(id, home, age, 75 + 20 * hash2(id, 212), { ...eduDefaults(id, age), edu: EduLevel.Further, track: trackFor(id, EduLevel.Further) });
    if (!this.schools.enrolAt(c, uni, Study.Degree)) { this.stats.turnedAway++; return null; }
    w.addCitizen(c);
    w.bedIn(home, 1);
    this.stats.students++;
    if (hall) { this.stats.inHalls++; this.hallKeys.add(tkey(home.x, home.y)); }
    return c;
  }

  // ---- the daily batch -----------------------------------------------------------------------------------------------

  /**
   * 03:00: adult courses finished by days attended, and closed where the policy went off; the learners' fees; the
   * apprentices who left; then new FE learners, evening learners and apprentices; halls residents who have finished.
   */
  private daily() {
    const w = this.w, now = w.tick, sc = this.schools;
    const learningAt = new Map<number, boolean>(), apprenticeAt = new Map<number, boolean>();
    const has = (m: Map<number, boolean>, x: number, y: number, id: 'learning' | 'apprentice') => {
      const k = tkey(x, y);
      let v = m.get(k);
      if (v === undefined) m.set(k, (v = w.ownerHasPolicy(x, y, id)));
      return v;
    };
    // colleges with adult learning on: day places for FE courses, evening places for classes
    const colleges = sc.list().filter((s) => s.spec.stage === Study.FeCourse && has(learningAt, s.b.x, s.b.y, 'learning')).map((s) => s.b);
    for (const s of sc.list()) if (s.spec.beds > 0) this.hallKeys.add(tkey(s.b.x, s.b.y));
    const fees = new Map<string, number>();
    const trainees = new Map<number, number>(); // apprentices per workplace
    const fresh: Citizen[] = [];
    for (const c of w.citizens.values()) {
      if (c.mig) continue;
      // learners on adult courses: finished, closed, or billed
      if (c.study === Study.FeCourse || c.study === Study.Evening) {
        if (!has(learningAt, c.sx, c.sy, 'learning')) { sc.leave(c, EduResult.Left); this.stats.coursesClosed++; }
        else if (c.study === Study.Evening && !c.job) sc.leave(c, EduResult.Left); // lost their job: an FE course is the way back
        else if (c.att >= STAGES[c.study].days) this.finish(c);
        else {
          const o = w.parcelAt(c.sx, c.sy)?.owner;
          if (o) fees.set(o, (fees.get(o) ?? 0) + POLICY.learnerPerDay);
        }
      }
      // apprentices: still at a workplace that trains?
      if (c.appr !== undefined) {
        if (!c.job || !this.trains(c.kind) || !has(apprenticeAt, c.wx, c.wy, 'apprentice')) this.endApprenticeship(c, EduResult.Left);
        else trainees.set(tkey(c.wx, c.wy), (trainees.get(tkey(c.wx, c.wy)) ?? 0) + 1);
      }
      // halls residents who are no longer students (or whose hall has gone) move out
      if (this.hallKeys.size && this.hallKeys.has(tkey(c.hx, c.hy)) && c.state === S.Home) this.hallsCheck(c);
      if (c.stage === LifeStage.Adult && !c.study && w.citizens.has(c.id)) fresh.push(c);
    }
    for (const [o, v] of fees) { w.credit(o, -v, 'upkeep'); this.stats.learnerFees += v; }
    // new learners and apprentices
    for (const c of fresh) {
      if (!c.job) {
        if (colleges.length && c.edu < EduLevel.Further && c.idleDays >= EDU.feIdleDays && Math.random() < EDU.feTakeUp && this.enrolNear(c, colleges, Study.FeCourse)) this.stats.feEnrolled++;
        continue;
      }
      if (c.appr !== undefined) continue;
      if (colleges.length && c.edu < EduLevel.Secondary && this.dayShift(c) && Math.random() < EDU.eveningTakeUp && this.enrolNear(c, colleges, Study.Evening)) { this.stats.eveningEnrolled++; continue; }
      if (c.edu >= EduLevel.Further || !this.trains(c.kind) || ageOf(c, now) >= EDU.apprMaxAge || !has(apprenticeAt, c.wx, c.wy, 'apprentice')) continue;
      const k = tkey(c.wx, c.wy), wb = w.buildings.get(tileKey(c.wx, c.wy));
      if (!wb || (trainees.get(k) ?? 0) >= Math.ceil(capacityOf(wb.id, wb.level) * POLICY.apprenticeShare) || Math.random() >= EDU.apprTakeUp) continue;
      c.appr = 0;
      trainees.set(k, (trainees.get(k) ?? 0) + 1);
      this.stats.apprentices++;
    }
  }
  /** Whether c's working day ends in time for an evening class (it starts from 05:00 and ends half an hour before they would set off). */
  private dayShift(c: Citizen) {
    const from = c.shiftStart / TPH, to = from + c.shiftLen / TPH;
    return from >= 5 && to <= EDU.eveningGo - 0.5;
  }
  /** A place on an adult course at the nearest college within its catchment that has room. */
  private enrolNear(c: Citizen, colleges: Building[], study: number): boolean {
    const near = colleges.map((b) => [Math.abs(b.x - c.hx) + Math.abs(b.y - c.hy), b] as const)
      .filter(([d, b]) => d <= (SCHOOL_SPECS[b.id]?.catchment || Infinity)).sort((a, b) => a[0] - b[0]);
    for (const [, b] of near) if (this.schools.enrolAt(c, b, study)) return true;
    return false;
  }
  /** An adult course done by days attended: the pass roll at the college, one level up (Schools.result). */
  private finish(c: Citizen) {
    const edu = c.edu;
    this.schools.finish(c);
    if (c.edu > edu) {
      this.stats.adultPassed++;
      const b = c.job ? this.w.buildings.get(tileKey(c.wx, c.wy)) : undefined;
      if (b) this.skills.promote(c, b); // a worker who moved up may take a skilled place where they work
    } else this.stats.adultFailed++;
  }

  /** A hall resident at home: no longer studying, or their hall has gone: a home with room nearby, else they leave. */
  private hallsCheck(c: Citizen) {
    const w = this.w, home = w.buildings.get(tileKey(c.hx, c.hy));
    const hall = !!home && home.zone !== Zone.Residential && this.bedsOf(home) > 0;
    if (hall && (c.study === Study.Degree || c.study === Study.Postgrad)) return;
    if (!hall && home) return; // a home that is not a hall (rebuilt as one): nothing to do
    const now = w.tick;
    const b = w.bestBuiltNear(c.hx, c.hy, [Zone.Residential], LIFE.moveOutRadius, 0, (b, d) => {
      const room = capacityOf(b.id, b.level) - b.occupants - this.gateways.pendingAt(b.x, b.y) - ((b.holdUntil ?? 0) > now ? 1 : 0);
      return room > 0 && familyOf(b.id) === Zone.Residential ? -d : null;
    }, (b) => w.hasRoadAccess(b.x, b.y));
    if (b) { this.host.rehome(c, b); this.stats.movedOut++; return; }
    this.stats.leftHalls++;
    this.host.leave(c);
  }

  // ---- evening classes ---------------------------------------------------------------------------------------------

  /** 17:30 on a school day: each evening learner sets off for class at their own minute (eveningGo + eveningSpread). */
  private planEvening() {
    const w = this.w, day = Math.floor(w.tick / DAY);
    if (WEEKDAYS[mod(day, 7)] !== 1) return;
    for (const c of w.citizens.values()) {
      if (c.study !== Study.Evening) continue;
      const at = day * DAY + Math.round((EDU.eveningGo + EDU.eveningSpread * hash2(c.id, day * 7 + 261)) * TPH);
      const list = this.tonight.get(at);
      if (list) list.push(c.id); else this.tonight.set(at, [c.id]);
    }
  }
  private setOffClass(id: number) {
    const w = this.w, c = w.citizens.get(id), now = w.tick;
    if (!c || c.study !== Study.Evening || c.mig || !c.job) return;
    // not home yet (from work, out): look again in ten minutes, until the class is under way
    if (c.state !== S.Home) {
      if (mod(now, DAY) < EVENING_LAST) { const at = now + RETRY; const l = this.tonight.get(at); if (l) l.push(id); else this.tonight.set(at, [id]); return; }
      this.stats.classesMissed++; this.stats.missed.out++; return;
    }
    // well, and not due at work within three hours; otherwise tonight's class is missed (held, not attended)
    const m = this.stats.missed;
    const why = (c.cond & ACUTE) || c.health < HEALTH.staysHomeBelow ? 'unwell' : c.job && c.nextAt > now && c.nextAt - now < 3 * TPH ? 'shift'
      : this.host.classTrip(c, c.sx, c.sy) ? '' : 'noWay';
    if (why) { this.stats.classesMissed++; m[why]++; return; }
    this.stats.classTrips++;
  }
  /** When tonight's class ends for c (Simulation.arriveVenue): eveningEnd plus a few minutes of their own. */
  classEnd(c: Citizen): number {
    const now = this.w.tick, end = Math.floor(now / DAY) * DAY + Math.round((EDU.eveningEnd + 0.1 * hash2(c.id, 263)) * TPH);
    return Math.max(end, now + 1);
  }
  /** Leaving the class (Simulation.leaveVenue): an evening attended. */
  attended(c: Citizen) {
    if (c.study !== Study.Evening) return;
    c.att++; this.stats.classesAttended++;
  }

  // ---- apprenticeships -----------------------------------------------------------------------------------------------

  /** Workplaces that train apprentices: industry (factories, workshops) and builders' yards. */
  private trains(kind: number) { const f = familyOf(kind); return f === Zone.Industrial || f === Zone.Yard; }
  /** An apprentice's shift was paid (Simulation.payWage): one more day done; the owner pays their share of the wage. */
  shift(c: Citizen, wage: number) {
    if (c.appr === undefined) return;
    const w = this.w, o = w.parcelAt(c.wx, c.wy)?.owner;
    if (o) { const v = wage * POLICY.apprenticeWageShare; w.credit(o, -v, 'upkeep'); this.stats.apprFees += v; }
    if (++c.appr < STAGES[Study.Apprentice].days) return;
    if (c.edu < EduLevel.Further) { c.edu = EduLevel.Further; this.schools.onGraduated?.(c); }
    c.track = EduTrack.Trades;
    this.stats.apprenticeships++; this.lifeEvents.graduations++;
    this.endApprenticeship(c, EduResult.Passed);
    const b = w.buildings.get(tileKey(c.wx, c.wy));
    if (b) this.skills.promote(c, b);
  }
  private endApprenticeship(c: Citizen, result: number) {
    const w = this.w;
    if (result !== EduResult.Passed) this.stats.apprCancelled++;
    logEdu(c, [Study.Apprentice, c.wx, c.wy, c.job ? c.kind : 0, Math.floor(w.tick / DAY / LIFE.daysPerYear), result]);
    c.appr = undefined;
  }

  // ---- research ------------------------------------------------------------------------------------------------------

  private refreshResearch() {
    this.research = this.schools.list().filter((s) => s.spec.stage === Study.Postgrad && s.spec.places === 0 && s.b.occupants > 0).map((s) => [s.b.x, s.b.y]);
  }
  /** Levels a staffed research institute within EDU.researchReach adds to the ambition of an office at b (Simulation.ambition). */
  lift(b: Building): number {
    if (!SCHOOLS.on || b.zone !== Zone.Office || !this.research.length) return 0;
    for (const [x, y] of this.research) if (Math.abs(x - b.x) + Math.abs(y - b.y) <= EDU.researchReach) return 1;
    return 0;
  }
  /** Probes: the research institutes counted as staffed. */
  researchDoors(): readonly [number, number][] { return this.research; }
}
