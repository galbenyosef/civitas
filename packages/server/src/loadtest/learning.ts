/**
 * Higher and adult education probe (docs/education.md section 18, E5): families moving in, students arriving through a
 * gateway for the university and its halls, FE courses and evening classes, apprenticeships, research ambition, and
 * the E6 hooks (the parents' moods, tuition fees and brain drain).
 *
 *   npx tsx packages/server/src/loadtest/learning.ts [--districts 2] [--days 14] [--seed 1] [--policies learning,apprentice,meals]
 *     [--fees 1] [--quiet] [--checks 0] [--save FILE]
 *
 * The city is the schools probe's (loadtest/schools.ts): seedCity built to 3, a nursery, a primary and a secondary
 * school per district (or every other), a sixth-form and an FE college, and on a parcel south of the city a university,
 * halls and a research institute; plus a motorway connection at the west end, so newcomers and students come in
 * through a gateway. Nobody is seeded: children and students come only with the newcomers. The owner of every parcel
 * (the Commons) has `--policies` on (`none` for the control: no adult courses, no apprentices). Day 0 is a Monday;
 * deterministic for a given --seed. `EDU=0` (or FAMILIES=0) in the environment is the control without E5.
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, CitizenState as S, LifeStage, Terrain, Study, STUDY_NAMES, EduLevel, EduResult, KIND_NAMES, Zone,
  capacityOf, familyOf, subFor, packTile, terrainOf, isRoad, planStructure, tileKey, workOf, SCHOOL_SPECS, DEFAULT_TAX, MOTORWAY_KIND,
  POLICY, STAGES, EDU,
} from '@msimcity/shared';
import { World, emptyStats, type Citizen } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity, type CityLayout } from './cities';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { ageOf } from '../sim/life';
import { saveWorld } from '../store';
import { FAMILIES } from '../sim/families';
import { ERRAND_CLASS } from '../sim/learning';
import { SCHOOLS } from '../sim/schools';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const districts = get('districts', 2), days = get('days', 14), seed = get('seed', 1), fees = get('fees', 0) === 1;
const policies = str('policies', 'learning,apprentice,meals').split(',').filter((p) => p && p !== 'none');
const quiet = argv.includes('--quiet'), runChecks = get('checks', 1) !== 0;
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(seed * 7919);

let checks = 0, fails = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${what}`); } else console.log(`  ok   ${what}`); };
const pad = (v: string | number, n: number) => String(v).padStart(n);
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0).toFixed(1);
const log = (s: string) => { if (!quiet) console.log(s); };

const w = new World(seed);
const layout = seedCity(w, { districts, built: 3 });
const sim = new Simulation(w);
const sys = w.players.get('sys')!;
sys.policies = [...policies, ...(fees ? ['fees'] : [])];

// ---- the schools (as loadtest/schools.ts) and a motorway connection -------------------------------------------------
const env = { tile: (x: number, y: number) => w.peekTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y), land: () => null };
const clear = (x0: number, y0: number, wd: number, ht: number) => {
  for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wd; x++) {
    const t = w.getTile(x, y);
    if (!isRoad(t)) w.setTile(x, y, packTile(terrainOf(t) === Terrain.Water ? Terrain.Grass : terrainOf(t), false, 0, 0));
  }
};
const placed: { kind: number; x: number; y: number }[] = [];
function placeOnBlock(kind: number, x0: number, y0: number): boolean {
  clear(x0, y0, 4, 4);
  const fits = (p: { ax: number; ay: number; w: number; h: number }) => p.ax >= x0 && p.ay >= y0 && p.ax + p.w <= x0 + 4 && p.ay + p.h <= y0 + 4;
  for (let i = 0; i < 16; i++) {
    const x = x0 + (i % 4), y = y0 + Math.floor(i / 4);
    if (kind === 101) {
      if (![[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => isRoad(w.getTile(x + dx, y + dy)))) continue;
      w.setTile(x, y, packTile(terrainOf(w.getTile(x, y)), false, familyOf(kind), 1), subFor(kind));
      placed.push({ kind, x, y });
      return true;
    }
    const v = planStructure(kind, x, y, env);
    if (!v.ok || !fits(v.placed)) continue;
    w.placeStructure(v.placed, { work: 0, priority: 0, built: true });
    placed.push({ kind, x: v.placed.doorX, y: v.placed.doorY });
    return true;
  }
  return false;
}
function placeSchools(L: CityLayout) {
  const want: number[] = [];
  for (let i = 0; i < L.districts.length; i++) want.push(102, 103, 101);
  want.push(104, 105);
  const slots = [[1, 1], [2, 2], [2, 1], [1, 2], [0, 0], [3, 3]];
  const used = L.districts.map(() => 0);
  for (let k = 0; k < want.length; k++) {
    const di = k % L.districts.length, d = L.districts[di];
    const [bx, by] = slots[used[di]++ % slots.length];
    if (!placeOnBlock(want[k], d.x + 5 * bx + 1, d.y + 5 * by + 1)) console.log(`  could not place ${KIND_NAMES[want[k]]} in district ${di}`);
  }
  const y0 = L.y0 + L.span, x0 = L.x0 + 2, wd = 16, ht = 8;
  const parcel = { id: w.nextId++, owner: 'sys', name: 'University Quarter', x: x0, y: y0, w: wd, h: ht, taxRate: DEFAULT_TAX, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wd; x++) w.setParcelId(x, y, parcel.id);
  clear(x0, y0, wd, ht);
  for (const [kind, dx] of [[106, 3], [108, 9], [107, 13]] as const) {
    const v = planStructure(kind, x0 + dx, y0, env);
    if (!v.ok) { console.log(`  could not place ${KIND_NAMES[kind]}: ${v.reason}`); continue; }
    w.placeStructure(v.placed, { work: 0, priority: 0, built: true });
    placed.push({ kind, x: v.placed.doorX, y: v.placed.doorY });
  }
  // the motorway connection at the west end (as loadtest/boats.ts)
  const ry = L.y0 + 5, rx = L.x0;
  const mp = { id: w.nextId++, owner: 'sys', name: 'Motorway junction', x: rx - 4, y: ry - 2, w: 4, h: 5, taxRate: DEFAULT_TAX, stats: emptyStats() };
  w.parcels.set(mp.id, mp);
  for (let y = mp.y; y < mp.y + mp.h; y++) for (let x = mp.x; x < mp.x + mp.w; x++) { w.setParcelId(x, y, mp.id); w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); }
  const v = planStructure(MOTORWAY_KIND, rx - 1, ry, env, 1);
  if (v.ok) { w.placeStructure(v.placed, { work: workOf(MOTORWAY_KIND, 1), priority: 1, built: true }); placed.push({ kind: MOTORWAY_KIND, x: v.placed.doorX, y: v.placed.doorY }); }
  else console.log(`  motorway refused: ${v.reason}`);
}
placeSchools(layout);
log(`Learning probe: ${districts}×${districts} districts, seed ${seed}, policies ${sys.policies.join(', ') || 'none'}${FAMILIES.on ? '' : ' (families off)'}${SCHOOLS.on ? '' : ' (EDU=0)'}`);
for (const p of placed) log(`  ${pad(KIND_NAMES[p.kind], 26)} door (${p.x}, ${p.y})`);

// ---- run -------------------------------------------------------------------------------------------------------------
const L = sim.learning, F = sim.families;
let simMs = 0, inClassPeak = 0, classSamples = 0;
const daily: string[] = [];
const laidOff: number[] = [];
let layoffDay = -1;
const t0 = performance.now();
const money0 = sys.money;
for (let i = 0; i < days * DAY; i++) {
  const ts = performance.now();
  sim.tick();
  simMs += performance.now() - ts;
  const day = Math.floor(w.tick / DAY), h = (w.tick % DAY) / TPH;
  // jobs outnumber people here, so nobody stays out of work: once the college has staff for twenty more (from day 4) the
  // probe lays off twenty workers below Level 3 two days ago (idleDays 2), just before the 03:00 batch, so the FE courses have takers
  const col = !laidOff.length && day >= 4 && w.tick % DAY === 3 * TPH - 1 ? sim.schools.list().find((s) => s.spec.stage === Study.FeCourse) : undefined;
  if (col && sim.schools.admittingOf(col) - col.pupils >= 20) {
    layoffDay = day;
    for (const c of w.citizens.values()) {
      if (laidOff.length >= 20) break;
      if (!c.job || c.study || c.mig || c.edu >= EduLevel.Further || c.stage !== LifeStage.Adult || c.state !== S.Home || c.appr !== undefined) continue;
      w.quitJob(c); c.idleDays = 2; laidOff.push(c.id);
    }
  }
  if (day % 7 < 5 && Math.abs(h - 19.5) < 1e-9) {
    let n = 0;
    for (const c of w.citizens.values()) if (c.errand === ERRAND_CLASS && c.state === S.AtVenue) n++;
    inClassPeak = Math.max(inClassPeak, n); classSamples++;
  }
  if (w.tick % DAY === DAY - 1) {
    const cs = [...w.citizens.values()];
    const kids = cs.filter((c) => c.stage === LifeStage.Child).length, enrolled = cs.filter((c) => c.study && c.study !== Study.Evening).length;
    daily.push(`  day ${pad(day, 2)}: ${pad(cs.length, 5)} citizens, ${pad(kids, 4)} children, ${pad(enrolled, 4)} enrolled, families ${pad(F.stats.families, 3)}, students in ${pad(L.stats.students, 3)} (halls ${L.stats.inHalls}), FE ${L.stats.feEnrolled}, evening ${L.stats.eveningEnrolled}, apprentices ${L.stats.apprentices} (done ${L.stats.apprenticeships})`);
  }
}
const wall = (performance.now() - t0) / 1000;
const saveTo = argv.includes('--save') ? argv[argv.indexOf('--save') + 1] : null;
if (saveTo) { saveWorld(w, saveTo); console.log(`saved the world at day ${(w.tick / DAY).toFixed(2)} to ${saveTo}`); process.exit(0); }

const cs = [...w.citizens.values()];
console.log(`\n${days} game days in ${wall.toFixed(1)} s: sim ${(simMs / (days * DAY)).toFixed(3)} ms/tick; ${cs.length} citizens`);
for (const d of daily) log(d);

// ---- families ----------------------------------------------------------------------------------------------------------
const fs = F.stats;
const kids = cs.filter((c) => c.stage === LifeStage.Child);
const byAge = [0, 0, 0, 0];
for (const k of kids) byAge[Math.min(3, Math.floor(ageOf(k, w.tick) / 5))]++;
console.log(`\nFamilies: ${fs.families} of ${fs.arrivals} arrivals (${pct(fs.families, fs.arrivals)}%; ${fs.noRoom} more had no room), ${fs.partners} partners and ${fs.children} children (${(fs.children / Math.max(1, fs.families)).toFixed(2)} a family);`
  + ` from the gate ${fs.rode} rode in the family car, ${fs.walked} walked along, ${fs.atDoor} went straight to the door`);
console.log(`  children now ${kids.length} (${pct(kids.length, cs.length)}%): 0-4 ${byAge[0]}, 5-9 ${byAge[1]}, 10-14 ${byAge[2]}, 15-17 ${byAge[3]}; born in town ${sim.lifeEvents.births}`);
const st = new Map<number, number>();
for (const c of cs) if (c.study) st.set(c.study, (st.get(c.study) ?? 0) + 1);
console.log(`  enrolled: ${[...st].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${STUDY_NAMES[k]} ${n}`).join(', ')}`);

// ---- the university, halls, students ------------------------------------------------------------------------------
const ls = L.stats;
const uniRec = sim.schools.list().find((s) => s.spec.stage === Study.Degree);
const hallRec = sim.schools.list().find((s) => s.spec.beds > 0);
const hallB = hallRec?.b;
const inHalls = hallB ? cs.filter((c) => c.hx === hallB.x && c.hy === hallB.y) : [];
console.log(`\nStudents from outside: ${ls.requested} asked for, ${ls.students} arrived (${ls.inHalls} to halls), ${ls.turnedAway} turned away; university ${uniRec?.pupils ?? 0}/${uniRec ? sim.schools.admittingOf(uniRec) : 0} admitted of ${uniRec?.spec.places ?? 0}`);
console.log(`  halls: ${hallB?.lodgers ?? 0} of ${hallRec?.spec.beds ?? 0} beds (${inHalls.length} living there), staff ${hallB?.occupants ?? 0}/${hallB ? capacityOf(hallB.id, hallB.level) : 0}; moved out ${ls.movedOut}, left town from halls ${ls.leftHalls}`);
console.log(`  gateway: in ${sim.gateways.totals.in}, out ${sim.gateways.totals.out}, fallback in ${sim.gateways.totals.fallbackIn}`);

// ---- adult learning and apprenticeships -------------------------------------------------------------------------------
const college = sim.schools.list().find((s) => s.spec.stage === Study.FeCourse);
console.log(`\nAdult learning (${laidOff.length} laid off on day ${layoffDay}): ${ls.feEnrolled} FE courses begun, ${ls.eveningEnrolled} evening classes; passed ${ls.adultPassed}, failed ${ls.adultFailed}; closed ${ls.coursesClosed}`);
console.log(`  evening: ${ls.classTrips} trips to class, ${ls.classesAttended} evenings attended, ${ls.classesMissed} missed (${Object.entries(ls.missed).map(([k, n]) => `${k} ${n}`).join(', ')}); at most ${inClassPeak} in class at 19:30 (${classSamples} evenings); the college ${college?.evening ?? 0}/${college ? sim.schools.admittingOf(college, Study.Evening) : 0} evening places, ${college?.pupils ?? 0} day pupils and learners`);
console.log(`  learners' fees $${ls.learnerFees.toFixed(0)} (POLICY.learnerPerDay ${POLICY.learnerPerDay})`);
const appr = cs.filter((c) => c.appr !== undefined);
console.log(`Apprenticeships: ${ls.apprentices} begun, ${ls.apprenticeships} finished at Level 3, ${ls.apprCancelled} cancelled, ${appr.length} training now; the owner paid $${ls.apprFees.toFixed(0)} of their wages; promoted to skilled places ${sim.skills.stats.promoted}`);
console.log(`Owner's treasury ${money0.toFixed(0)} → ${sys.money.toFixed(0)}`);

// ---- research and the parents' moods --------------------------------------------------------------------------------
const offices = [...w.buildings.values()].filter((b) => b.zone === Zone.Office && b.level > 0);
const lifted = offices.filter((b) => L.lift(b) > 0);
console.log(`\nResearch: ${L.researchDoors().length} staffed institute(s); ${lifted.length} of ${offices.length} offices may grow a level taller`);
const moods = new Map<string, number>();
for (const c of cs) {
  if (c.stage === LifeStage.Child) continue;
  const p = F.homeParts(c, sim.schools);
  if (!p) continue;
  if (p.school) moods.set(p.school > 0 ? 'good school nearby' : 'no school place', (moods.get(p.school > 0 ? 'good school nearby' : 'no school place') ?? 0) + 1);
  if (p.meals) moods.set('free school meals', (moods.get('free school meals') ?? 0) + 1);
}
console.log(`Parents' moods: ${[...moods].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
console.log(`Brain drain ${sim.skills.stats.brainDrain}; graduations ${sim.lifeEvents.graduations}`);
if (!runChecks) process.exit(0);

// ---- checks ---------------------------------------------------------------------------------------------------------
console.log('\nChecks:');
if (FAMILIES.on && SCHOOLS.on) {
  ok(fs.families > 0 && fs.families / Math.max(1, fs.arrivals) > 0.1 && fs.families / Math.max(1, fs.arrivals) < 0.25, `about a fifth of arrivals are families (${pct(fs.families, fs.arrivals)}%)`);
  ok(fs.rode + fs.walked > 0, `families travel in from the gate together (${fs.rode} rode, ${fs.walked} walked)`);
}
ok(cs.every((c) => c.stage !== LifeStage.Child || !c.job), 'no child holds a job');
ok(cs.filter((c) => c.par && c.stage === LifeStage.Child).every((c) => { const p = w.citizens.get(c.par); return !p || ageOf(p, w.tick) - ageOf(c, w.tick) >= 18; }), 'parents are at least 18 years older than their children');
// beds: every home's occupants, every hall's lodgers and staff, match the citizens
{
  const homes = new Map<string, number>(), staff = new Map<string, number>();
  for (const c of cs) { homes.set(tileKey(c.hx, c.hy), (homes.get(tileKey(c.hx, c.hy)) ?? 0) + 1); if (c.job) staff.set(tileKey(c.wx, c.wy), (staff.get(tileKey(c.wx, c.wy)) ?? 0) + 1); }
  const bad: string[] = [];
  for (const [k, b] of w.buildings) {
    if (b.zone === Zone.Residential && b.occupants !== (homes.get(k) ?? 0)) bad.push(`home ${k} ${b.occupants}/${homes.get(k) ?? 0}`);
    if (b.zone !== Zone.Residential && (b.lodgers ?? 0) !== (homes.get(k) ?? 0)) bad.push(`lodgers ${k} ${b.lodgers}/${homes.get(k) ?? 0}`);
    if (b.zone !== Zone.Residential && b.zone !== Zone.Parking && SCHOOL_SPECS[b.id] && b.occupants !== (staff.get(k) ?? 0)) bad.push(`staff ${k} ${b.occupants}/${staff.get(k) ?? 0}`);
  }
  ok(!bad.length, `every home's occupants, every hall's lodgers and every school's staff match the citizens${bad.length ? `: ${bad.slice(0, 4).join('; ')}` : ''}`);
}
if (SCHOOLS.on) {
  ok(ls.students > 0 && ls.inHalls > 0, `students arrive for the university, to halls first (${ls.students}, ${ls.inHalls} in halls)`);
  ok(!!hallB && (hallB.lodgers ?? 0) <= (hallRec?.spec.beds ?? 0), `the halls never hold more than their beds (${hallB?.lodgers}/${hallRec?.spec.beds})`);
  ok(inHalls.every((c) => c.study === Study.Degree || c.study === Study.Postgrad || c.state !== S.Home || w.tick % DAY < 3 * TPH), `everyone at home in the halls is a student (${inHalls.filter((c) => c.study !== Study.Degree && c.study !== Study.Postgrad).length} finished, moving out at 03:00)`);
  ok(!uniRec || uniRec.pupils <= uniRec.spec.places, `the university takes no more than its places (${uniRec?.pupils}/${uniRec?.spec.places}; its staff let it take ${uniRec ? sim.schools.admittingOf(uniRec) : 0} now, and those enrolled stay)`);
  ok(inHalls.every((c) => c.stage === LifeStage.Adult && c.par === 0 && c.partner === 0 || w.citizens.get(c.partner)?.hx === c.hx || !w.citizens.get(c.partner)) && inHalls.every((c) => !c.job), 'students in halls hold no job and nobody moved in with them');
}
const learning = policies.includes('learning'), apprentice = policies.includes('apprentice');
if (SCHOOLS.on && learning) {
  ok(ls.feEnrolled > 0 && ls.eveningEnrolled > 0, `adult learning: FE courses (${ls.feEnrolled}) and evening classes (${ls.eveningEnrolled})`);
  ok(ls.adultPassed > 0, `adults finish their courses a level up (${ls.adultPassed} passed, ${ls.adultFailed} failed)`);
  ok(ls.classesAttended > 0 && inClassPeak > 0, `evening classes are attended at the college (${ls.classesAttended} evenings, ${inClassPeak} at once)`);
  // (an evening learner who lost their job since 03:00 leaves the class at the next batch)
  ok(cs.every((c) => c.study !== Study.FeCourse || (c.edu < EduLevel.Further && !c.job)) && cs.every((c) => c.study !== Study.Evening || c.edu < EduLevel.Secondary), `learners are below their course's level (FE below Level 3 and out of work, evening below GCSEs; ${cs.filter((c) => c.study === Study.Evening && !c.job).length} evening learners lost their job today)`);
  const passedAdult = cs.flatMap((c) => c.eduLog.filter((e) => (e[0] === Study.FeCourse || e[0] === Study.Evening) && e[5] === EduResult.Passed));
  ok(passedAdult.length > 0, `adult course passes are in the education log (${passedAdult.length})`);
  ok(!college || college.evening <= sim.schools.admittingOf(college, Study.Evening), `the college keeps to its evening places (${college?.evening}/${college ? sim.schools.admittingOf(college, Study.Evening) : 0})`);
  ok(ls.learnerFees > 0, `the college's owner pays for the learners ($${ls.learnerFees.toFixed(0)})`);
} else if (SCHOOLS.on) ok(ls.feEnrolled === 0 && ls.eveningEnrolled === 0, 'adult learning off: no FE courses, no evening classes');
if (SCHOOLS.on && apprentice) {
  ok(ls.apprentices > 0, `apprentices begin at factories and yards (${ls.apprentices})`);
  const per = new Map<string, number>();
  for (const c of appr) per.set(tileKey(c.wx, c.wy), (per.get(tileKey(c.wx, c.wy)) ?? 0) + 1);
  ok([...per].every(([k, n]) => { const b = w.buildings.get(k); return !!b && n <= Math.ceil(capacityOf(b.id, b.level) * POLICY.apprenticeShare); }), `no workplace trains more than ${POLICY.apprenticeShare * 100}% of its places`);
  // checked at 03:00 each day: one who lost their job since is let go then; they began under EDU.apprMaxAge and age a year a week
  const oddAppr = appr.filter((c) => c.edu >= EduLevel.Further || ageOf(c, w.tick) >= EDU.apprMaxAge + days / 7 || (c.job && familyOf(c.kind) !== Zone.Industrial && familyOf(c.kind) !== Zone.Yard));
  ok(!oddAppr.length, `apprentices are young workers below Level 3 at industry and yards${oddAppr.length ? `: ${oddAppr.slice(0, 3).map((c) => `#${c.id} edu ${c.edu} age ${ageOf(c, w.tick).toFixed(1)} job ${c.job} kind ${c.kind}`).join(', ')}` : ''}`);
  ok(ls.apprFees > 0, `the owner pays a share of the apprentices' wages ($${ls.apprFees.toFixed(0)})`);
  if (days >= 14) ok(ls.apprenticeships > 0, `apprentices finish with Level 3 in the trades track after ${STAGES[Study.Apprentice].days} shifts (${ls.apprenticeships})`);
} else if (SCHOOLS.on) ok(ls.apprentices === 0, 'apprenticeships off: none begin');
if (SCHOOLS.on && L.researchDoors().length) {
  const r = L.researchDoors()[0];
  const near = offices.filter((b) => Math.abs(b.x - r[0]) + Math.abs(b.y - r[1]) <= 20);
  ok(lifted.length === near.length, `research ambition: the ${near.length} offices within 20 tiles of the institute grow a level taller, no others`);
}
if (SCHOOLS.on && policies.includes('meals')) ok((moods.get('free school meals') ?? 0) > 0, `parents of pupils on free school meals are happier (${moods.get('free school meals') ?? 0})`);
if (SCHOOLS.on && FAMILIES.on) ok((moods.get('good school nearby') ?? 0) > 0, `parents whose children all have school places: "good school nearby" (${moods.get('good school nearby') ?? 0})`);
// a citizen panel: an apprentice's progress, an evening learner's course
{
  const a = appr[0], info = a && sim.describeCitizen(a.id);
  if (a) ok(info?.life?.education?.apprentice !== undefined, `an apprentice's panel shows the apprenticeship (${info?.life?.education?.apprentice?.toFixed(2)})`);
  if (college) { const si = sim.describe(college.b).school; ok(!learning || (si?.eveningPlaces ?? 0) > 0, `the college's inspect block has its evening places (${si?.evening}/${si?.eveningAdmitting}/${si?.eveningPlaces})`); }
}
// saves: lodgers rebuilt, apprentices kept, the loaded world runs
{
  const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
  const back = worldFromSnapshot(snap)!;
  const bh = hallB && back.buildings.get(tileKey(hallB.x, hallB.y));
  ok(!hallB || (bh?.lodgers ?? 0) === (hallB.lodgers ?? 0), `a save rebuilds the halls' lodgers (${bh?.lodgers ?? 0}) and staff (${bh?.occupants ?? 0}/${hallB?.occupants ?? 0})`);
  ok([...back.citizens.values()].filter((c) => c.appr !== undefined).length === appr.length, `a save keeps the apprentices (${appr.length})`);
  const bsim = new Simulation(back);
  let threw = '';
  try { for (let i = 0; i < 4 * TPH; i++) bsim.tick(); } catch (e) { threw = String(e); }
  ok(!threw, `the loaded world runs${threw ? `: ${threw}` : ''}`);
}
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
