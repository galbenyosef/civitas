import { LifeStage, EDU, hash2, capacityOf, studyForAge, type EduFields } from '@msimcity/shared';
import type { Building, Citizen, World } from '../world';
import { ageOf, stageFor, LIFE } from './life';
import type { Skills } from './skills';
import type { Gateways } from './gateways';
import { SCHOOLS, type Schools } from './schools';
import { env } from '../env';

/**
 * Families moving in (docs/education.md sections 5 and 18, phase E5). About a fifth of newcomers (`EDU.familyShare`,
 * by a hash of the first one's id, so it draws no random numbers) come as a couple with one to three children aged
 * 0-15, when their new home has the beds: schools have pupils from the first hour, not seventeen hours after the
 * first baby. The simulation calls `join` once the first grown-up of an arrival is in town (Simulation.arriveVia from
 * a gateway, spawnCitizen in place); the partner and the children come with them: in their car from the gate, walking
 * beside them, or (with no way to come along: a taxi, no route) straight to the door. Not while a demo or test city
 * fast-fills (World.filling): the demos seed their families before the fill (demo/seed.ts seedDemoFamilies), and a
 * town filled with families would start with a fifth fewer workers than the jobs it was laid out for. Children take
 * beds and no jobs, so residential demand counts the grown-ups (Simulation.growth).
 *
 * Also the household parts of a parent's happiness the schools give (section 7): "good school nearby" when every
 * school-age child at home has a place, "no school place" when one has none, and the parents' "free school meals"
 * (E6's policy, `Schools.onMeals`).
 */
export const FAMILIES = {
  /** off switch for before/after runs (FAMILIES=0, or EDU=0 with the rest of education): newcomers come alone, as before E5 */
  on: env('FAMILIES') !== '0' && env('EDU') !== '0',
  share: EDU.familyShare as number,
};

/** What the families need from the simulation. */
export interface FamilyHost {
  /** a citizen at home in `home` (Simulation.makeCitizen), not yet in the world */
  make(id: number, home: Building, age: number, health: number, edu?: EduFields): Citizen;
  /** p sets off from where they are (the gate) with c, who is on the way home from it: a lift in c's car, or a walk beside them; false when they cannot */
  follow(p: Citizen, c: Citizen): boolean;
  /** p is home in town: a grown-up looks for work */
  settle(p: Citizen): void;
}

export class Families {
  /** since the simulation started (probes): families that moved in, the grown-ups and children with them, how they came */
  stats = { arrivals: 0, families: 0, partners: 0, children: 0, rode: 0, walked: 0, atDoor: 0, noRoom: 0 };

  constructor(private w: World, private skills: Skills, private gateways: Gateways, private host: FamilyHost) {}

  /**
   * Newcomer c (in the world, counted into `home`) may bring a family. `travelling`: c is on the way from a gateway
   * (MIG.In) and the others set off with them; otherwise everyone is already at the door.
   */
  join(c: Citizen, home: Building, travelling: boolean) {
    if (!FAMILIES.on || this.w.filling) return; // a fast fill (demos, test cities) seeds its own families (demo/seed.ts)
    this.stats.arrivals++;
    if (hash2(c.id, 251) >= FAMILIES.share || c.stage !== LifeStage.Adult) return;
    const w = this.w, now = w.tick;
    // the beds left: newcomers already queued for this home keep theirs
    const room = capacityOf(home.id, home.level) - home.occupants - this.gateways.pendingAt(home.x, home.y);
    if (room < 2) { this.stats.noRoom++; return; }
    let want = 1;
    for (let u = hash2(c.id, 253); want < EDU.familyKids.length && u >= EDU.familyKids[want - 1]; want++) u -= EDU.familyKids[want - 1];
    const kids = Math.min(room - 1, want);
    // the children's ages, 0-15; the grown-ups are at least familyParentGap older than the eldest (c ages to fit:
    // a later birthday never lowers what their education allows, eduDefaults' cap only rises with age)
    const ages: number[] = [];
    for (let i = 0; i < kids; i++) ages.push((EDU.familyKidMax + 0.99) * hash2(c.id * 4 + i, 257));
    const eldest = Math.max(...ages), need = Math.max(EDU.familyAdultMin, eldest + EDU.familyParentGap + 6 * hash2(c.id, 258));
    if (ageOf(c, now) < need) { c.born -= (need - ageOf(c, now)) * LIFE.daysPerYear; c.stage = stageFor(c.id, need); }
    const age = ageOf(c, now);
    // the partner: close in age, a newcomer like c (their level leans to the town's open skilled places, sim/skills.ts)
    const pid = w.nextId++;
    const n = this.skills.newcomer(pid, Math.max(eldest + EDU.familyParentGap, age + 8 * (hash2(pid, 255) - 0.5)));
    const p = this.host.make(pid, home, n.age, 70 + 28 * hash2(pid, 212), n.edu);
    p.hh = c.hh; p.partner = c.id; c.partner = p.id;
    this.add(p, home, c, travelling);
    this.stats.partners++;
    for (const a of ages) {
      const id = w.nextId++;
      const k = this.host.make(id, home, a, 85 + 12 * hash2(id, 212));
      k.stage = stageFor(id, a); k.car = false; k.money = 0; k.par = c.id; k.sn = c.sn; k.hh = c.hh;
      this.add(k, home, c, travelling);
    }
    this.stats.children += kids;
    this.stats.families++;
  }

  /** Into the world and the home, then along with c: or, with no way to come along, at the door. */
  private add(p: Citizen, home: Building, c: Citizen, travelling: boolean) {
    const w = this.w;
    if (travelling) { p.mig = c.mig; p.gx = c.gx; p.gy = c.gy; p.x = c.x; p.y = c.y; }
    w.addCitizen(p);
    home.occupants++;
    if (travelling && this.host.follow(p, c)) {
      if (p.leg?.lift) this.stats.rode++; else this.stats.walked++;
      p.state = c.state;
      return;
    }
    // at the door already: they came on ahead
    p.mig = 0; p.gx = undefined; p.gy = undefined; p.x = home.x + 0.5; p.y = home.y + 0.5;
    if (travelling) this.stats.atDoor++;
    if (p.stage === LifeStage.Adult) this.host.settle(p);
  }

  /**
   * The schools in a parent's happiness (Simulation.lifeStep and the citizen panel): `school` 1 when every school-age
   * child at home (4-17) has a place, -1 when one has none (0 with no such child), and `meals` when one of them is on
   * free school meals. Only for the grown-ups of a household with children.
   */
  homeParts(c: Citizen, schools: Schools): { school: number; meals: boolean } | undefined {
    if (!SCHOOLS.on || c.stage === LifeStage.Child) return undefined;
    const w = this.w, now = w.tick, ids = w.households.get(c.hh)?.ids;
    if (!ids || ids.length < 2) return undefined;
    let school = 0, meals = false;
    for (const id of ids) {
      const k = w.citizens.get(id);
      if (!k || k.stage !== LifeStage.Child || k.hx !== c.hx || k.hy !== c.hy) continue;
      if (k.study) { if (school === 0) school = 1; if (!meals && schools.onMeals(k)) meals = true; continue; }
      if (ageOf(k, now) >= 4 && studyForAge(ageOf(k, now)) !== 0) school = -1;
    }
    return school || meals ? { school, meals } : undefined;
  }
}
