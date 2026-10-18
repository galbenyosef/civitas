import {
  EDU, EduLevel, LifeStage, Zone, SKILLS, eduDefaults, trackFor, skillNeed, skilledPlaces, capacityOf, overQualified, hash2,
  type EduFields,
} from '@msimcity/shared';
import { hasJobs, type Building, type Citizen, type World } from '../world';

/**
 * Jobs, wages and migration by education (docs/education.md section 7, phase E4). A workplace has skilled places,
 * `skilledPlaces(kind, level)` of them, that need `skillNeed(kind, level)`; the rest are unskilled places anyone may
 * take. `Building.qualified` counts the workers holding a skilled place and `Citizen.skill` is the level a worker's
 * place needs (0 an unskilled place). The simulation keeps the hooks thin: Simulation.findJob asks `placeFor`, `hire`
 * calls `hired`, World.quitJob gives the place back, newcomers draw their level through `newcomer`, and the daily
 * step counts brain drain through `day`.
 *
 * `EDU=0` in the environment turns all of it off (SKILLS.on): the simulation then plays as before E4, the A/B control.
 */
if (globalThis.process?.env?.EDU === '0') SKILLS.on = false; // not bare: local mode runs this in a browser worker

/** No place for this citizen here, an unskilled place, a skilled place. */
export const Place = { None: 0, Unskilled: 1, Skilled: 2 } as const;

export const FILL_GROUPS = ['shops', 'industry', 'offices', 'other'] as const;
export type FillGroup = (typeof FILL_GROUPS)[number];

/** Open skilled places are re-counted at most this often (ticks): the newcomer tilt reads them. */
const RECOUNT_EVERY = 25;

export class Skills {
  /** open skilled places in town by the level they need (index EduLevel), re-counted on use */
  open = [0, 0, 0, 0, 0, 0];
  private openAt = -Infinity;
  /** since the simulation started (probes, the demo check): newcomers drawn for open skilled places, graduates who left */
  stats = { matched: 0, newcomers: 0, brainDrain: 0, skilledHires: 0, unskilledHires: 0, overQualifiedHires: 0 };
  /** owners told about brain drain today: once a game day each */
  private told = new Map<string, number>();

  constructor(private w: World, private leave: (c: Citizen) => void, private notice: (owner: string, msg: string) => void) {}

  /** Which place a citizen with this level could take at a workplace now (Place). Off: any free place. */
  placeFor(b: Building, edu: number): number {
    const cap = capacityOf(b.id, b.level);
    if (b.occupants >= cap) return Place.None;
    if (!SKILLS.on) return Place.Unskilled;
    const sk = skilledPlaces(b.id, b.level), q = b.qualified ?? 0;
    if (sk > q && edu >= skillNeed(b.id, b.level)) return Place.Skilled;
    return b.occupants - q < cap - sk ? Place.Unskilled : Place.None;
  }

  /** A hire at b: take a skilled place when there is one for the citizen's level, else an unskilled one. */
  hired(c: Citizen, b: Building) {
    if (this.placeFor(b, c.edu) === Place.Skilled) {
      const need = skillNeed(b.id, b.level);
      c.skill = need;
      b.qualified = (b.qualified ?? 0) + 1;
      if (this.open[need] > 0) this.open[need]--;
      this.stats.skilledHires++;
    } else {
      c.skill = 0;
      if (SKILLS.on) { this.stats.unskilledHires++; if (c.edu >= EduLevel.Degree) this.stats.overQualifiedHires++; } // a graduate in an unskilled place
    }
  }

  /**
   * A newcomer's age and education. With chance EDU.match their level is one the town's open skilled places need,
   * weighted by count (so migration keeps offices filling until the town educates its own people); otherwise, or with
   * no skilled place open, the base mix (eduDefaults). Hash-seeded from the id, so it draws no random numbers. Someone
   * drawn for a degree place who is too young to hold one is a little older instead.
   */
  newcomer(id: number, age: number): { age: number; edu: EduFields } {
    const base = eduDefaults(id, age);
    if (!SKILLS.on) return { age, edu: base };
    this.stats.newcomers++;
    if (hash2(id, 235) >= EDU.match) return { age, edu: base };
    this.fresh();
    let total = 0;
    for (let l = 1; l < this.open.length; l++) total += this.open[l];
    if (total <= 0) return { age, edu: base };
    let u = hash2(id, 237) * total, level = 1;
    for (; level < this.open.length - 1; level++) { u -= this.open[level]; if (u < 0) break; }
    this.open[level]--; // spoken for until the next re-count
    this.stats.matched++;
    if (level >= EduLevel.Degree && age < EDU.degreeAge) age = EDU.degreeAge + (age - 18) * 2; // 18-21 become 22-29
    return { age, edu: { ...base, edu: level, track: trackFor(id, level) } };
  }

  /**
   * The daily step for one citizen (Simulation.newDay): a graduate out of work or over-qualified counts the days
   * (`drain`, read by `drainMul`), and one who graduated EDU.drainDays ago with no matching job leaves with chance
   * EDU.gradLeave. Students are left alone: a graduate going on to postgraduate study keeps `grad` until they finish.
   */
  day(c: Citizen) {
    if (!SKILLS.on || c.mig) return;
    if (c.stage !== LifeStage.Adult || c.edu < EduLevel.Degree || c.study) { if (c.drain) c.drain = 0; return; } // a student (going on to postgraduate) is not unmatched
    const unmatched = !c.job || overQualified(c);
    c.drain = unmatched ? (c.drain ?? 0) + 1 : 0;
    if (c.grad === undefined || this.w.day < c.grad + EDU.drainDays) return;
    c.grad = undefined;
    if (unmatched && Math.random() < EDU.gradLeave) this.drained(c);
  }

  /** Leaving-chance multiplier for a graduate unmatched for EDU.drainDays or more (Simulation.lifeFamily), else 1. */
  drainMul(c: Citizen): number {
    return SKILLS.on && c.edu >= EduLevel.Degree && (c.drain ?? 0) >= EDU.drainDays ? EDU.drainMul : 1;
  }

  /** A graduate leaves town for want of matching work: counted, the home's owner told once a game day, and gone. */
  drained(c: Citizen) {
    this.count(c);
    this.leave(c);
  }
  /** Count a graduate who is leaving (whoever sends them) as brain drain. */
  count(c: Citizen) {
    if (!SKILLS.on || c.edu < EduLevel.Degree) return;
    this.stats.brainDrain++;
    const owner = this.w.parcelAt(c.hx, c.hy)?.owner;
    if (!owner || this.told.get(owner) === this.w.day) return;
    this.told.set(owner, this.w.day);
    this.notice(owner, 'Graduates are leaving: they find no work to match their degrees. Offices, hospitals and schools hire them');
  }

  /** Phase E3 calls this when a pass raises a citizen's level: "graduated" in their happiness, and the brain-drain check. */
  graduated(c: Citizen) {
    if (c.edu >= EduLevel.Degree) c.grad = this.w.day;
  }

  /** Health target bonus (Simulation.lifeHealth): a degree or more, a small real-world link. */
  healthBonus(c: Citizen): number {
    return SKILLS.on && c.edu >= EduLevel.Degree ? EDU.healthBonus : 0;
  }

  /** Places and how many are filled, by workplace group, all places and the skilled ones (probes and the demo check). */
  fill(): Record<FillGroup, { places: number; filled: number; skilled: number; skilledFilled: number }> {
    const out = Object.fromEntries(FILL_GROUPS.map((g) => [g, { places: 0, filled: 0, skilled: 0, skilledFilled: 0 }])) as ReturnType<Skills['fill']>;
    for (const b of this.w.buildings.values()) {
      if (b.level === 0 || !hasJobs(b.zone)) continue;
      const cap = capacityOf(b.id, b.level);
      if (!cap) continue;
      const f = out[b.zone === Zone.Commercial ? 'shops' : b.zone === Zone.Industrial ? 'industry' : b.zone === Zone.Office ? 'offices' : 'other'];
      const sk = skilledPlaces(b.id, b.level);
      f.places += cap; f.filled += b.occupants; f.skilled += sk; f.skilledFilled += Math.min(sk, b.qualified ?? 0);
    }
    return out;
  }

  /** Re-count the open skilled places by level, at most every RECOUNT_EVERY ticks. */
  private fresh() {
    if (this.w.tick - this.openAt < RECOUNT_EVERY) return;
    this.openAt = this.w.tick;
    this.open.fill(0);
    for (const b of this.w.buildings.values()) {
      if (b.level === 0 || !hasJobs(b.zone)) continue;
      const sk = skilledPlaces(b.id, b.level);
      if (!sk) continue;
      const free = Math.min(sk - (b.qualified ?? 0), capacityOf(b.id, b.level) - b.occupants);
      if (free > 0) this.open[skillNeed(b.id, b.level)] += free;
    }
  }
}

/**
 * Loading a save (snapshot.ts): count a worker back into their workplace's skilled places. A worker saved before E4
 * has no `skill`: they get a skilled place when qualified and one is left, as if hired now.
 */
export function rehire(c: Citizen, b: Building) {
  if (!SKILLS.on) return;
  if (c.skill === undefined) {
    const need = skillNeed(b.id, b.level), sk = skilledPlaces(b.id, b.level);
    c.skill = sk > (b.qualified ?? 0) && c.edu >= need ? need : 0;
  }
  if (c.skill) b.qualified = (b.qualified ?? 0) + 1;
}
