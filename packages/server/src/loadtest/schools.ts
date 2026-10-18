/**
 * Schools probe (docs/education.md, E3): a test city with every school kind placed and families with children of every
 * age, run through a school week and over the Monday rollover.
 *
 *   npx tsx packages/server/src/loadtest/schools.ts [--districts 2] [--days 8] [--seed 1] [--families 0.3] [--quiet] [--checks 0] [--save FILE]
 *
 * Deterministic for a given --seed (Math.random is replaced before the world is built). Day 0 is a Monday. The city is
 * seedCity built to 3; each district gets a nursery and a primary school, every second one a secondary school, and the
 * city one sixth-form college and one FE college; a university campus, halls and a research institute stand on a
 * parcel south of the city. Before the first tick `--families` of the homes (with room for four) take a family: two
 * adults and 1-3 children aged 0-17 (the shape E5's family newcomers will have), plus a few second-year students at
 * the university. The rest of the beds fill as usual.
 *
 * Prints, per school: staff, qualified teachers against what it needs, the places it can admit, pupils, the waiting
 * list, quality, results; enrolment and attendance per stage; graduations, fails and drop-outs; escorts for the
 * under-8s; the school run (pupils on the move, by mode, at the morning peak); the progress counters; and sim ms per
 * tick. Then checks the rules (`--checks 0` skips them, for A/B timing). With EDU=0 nobody is admitted (the control). It
 * also runs on a branch without sim/schools.ts (the same city, no schools simulated), for the A/B against main.
 * `--save FILE` writes the world after `--days` (fractional: 1.3 is Tuesday 07:12) and exits, for a live look
 * (WORLD_FILE=FILE PORT=… npm run dev:server, then the client with ?ws=host:port).
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, CitizenState as S, LifeStage, Terrain, CITIZEN_STUDY, EduLevel, EduResult, Study, STUDY_NAMES, EDU,
  STAGES, EDU_HOMEWARD, KIND_NAMES, capacityOf, familyOf, subFor, packTile, terrainOf, isRoad, planStructure, tileKey,
  SCHOOL_SPECS, DEFAULT_TAX,
} from '@msimcity/shared';
import { World, emptyStats, type Building, type Citizen } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity, DISTRICT, type CityLayout } from './cities';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { ageOf, stageFor, LIFE } from '../sim/life';
import { saveWorld } from '../store';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const districts = get('districts', 2), days = get('days', 8), seed = get('seed', 1), familyShare = get('families', 0.3);
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
const rnd = mulberry32(seed * 104729); // the probe's own choices, apart from the simulation's stream

let checks = 0, fails = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${what}`); } else console.log(`  ok   ${what}`); };
const pad = (v: string | number, n: number) => String(v).padStart(n);
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0).toFixed(1);
const log = (s: string) => { if (!quiet) console.log(s); };

type SchoolsApi = NonNullable<Simulation['schools']>;
const w = new World(seed);
const layout = seedCity(w, { districts, built: 3 });
const sim = new Simulation(w);
const schools: SchoolsApi | undefined = (sim as { schools?: SchoolsApi }).schools;
const priv = sim as unknown as { makeCitizen(id: number, home: Building, age: number, health: number): Citizen; findJob(c: Citizen): boolean };

// ---- the schools ---------------------------------------------------------------------------------------------------
const env = { tile: (x: number, y: number) => w.peekTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y), land: () => null };
const clear = (x0: number, y0: number, wd: number, ht: number) => {
  for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wd; x++) {
    const t = w.getTile(x, y);
    if (!isRoad(t)) w.setTile(x, y, packTile(terrainOf(t) === Terrain.Water ? Terrain.Grass : terrainOf(t), false, 0, 0));
  }
};
const placed: { kind: number; x: number; y: number }[] = [];
/** A school on the 4×4 block at (x0, y0) (cleared first), its door on an edge tile facing the street. */
function placeOnBlock(kind: number, x0: number, y0: number): boolean {
  clear(x0, y0, 4, 4);
  const fits = (p: { ax: number; ay: number; w: number; h: number }) => p.ax >= x0 && p.ay >= y0 && p.ax + p.w <= x0 + 4 && p.ay + p.h <= y0 + 4;
  for (let i = 0; i < 16; i++) {
    const x = x0 + (i % 4), y = y0 + Math.floor(i / 4);
    if (SCHOOL_SPECS[kind] && kind === 101) { // one tile: zoned as a civic lot is, built at once
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
  // the campus: a parcel south of the city, along its last street
  const y0 = L.y0 + L.span, x0 = L.x0 + 2, wd = 16, ht = 8;
  const owner = w.players.get('sys')!;
  const parcel = { id: w.nextId++, owner: owner.id, name: 'University Quarter', x: x0, y: y0, w: wd, h: ht, taxRate: DEFAULT_TAX, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wd; x++) w.setParcelId(x, y, parcel.id);
  clear(x0, y0, wd, ht);
  for (const [kind, dx] of [[106, 3], [108, 9], [107, 13]] as const) {
    const v = planStructure(kind, x0 + dx, y0, env);
    if (!v.ok) { console.log(`  could not place ${KIND_NAMES[kind]}: ${v.reason}`); continue; }
    w.placeStructure(v.placed, { work: 0, priority: 0, built: true });
    placed.push({ kind, x: v.placed.doorX, y: v.placed.doorY });
  }
}
placeSchools(layout);

// ---- families: two adults and 1-3 children in a share of the homes with room -------------------------------------------
let famN = 0, kidN = 0;
const homes = [...w.buildings.values()].filter((b) => familyOf(b.id) === 1 && b.level > 0 && capacityOf(b.id, b.level) >= 4);
for (const home of homes) for (let f = 0; f < 4; f++) { // a family for every few beds, by chance
  if (rnd() >= familyShare) continue;
  const room = capacityOf(home.id, home.level) - home.occupants;
  if (room < 3) break;
  const kids = Math.min(room - 2, 1 + Math.floor(rnd() * 3));
  const add = (age: number) => {
    const c = priv.makeCitizen(w.nextId++, home, age, 75 + 20 * rnd());
    w.addCitizen(c);
    home.occupants++;
    return c;
  };
  const a = add(28 + rnd() * 16), b = add(28 + rnd() * 16);
  a.partner = b.id; b.partner = a.id; w.setHousehold(b, a.hh);
  for (let i = 0; i < kids; i++) {
    const k = add(rnd() * 18);
    k.stage = stageFor(k.id, ageOf(k, w.tick)); k.car = false; k.money = 0; k.par = a.id; k.sn = a.sn;
    w.setHousehold(k, a.hh);
    kidN++;
  }
  priv.findJob(a); priv.findJob(b);
  famN++;
}
log(`Schools probe: ${districts}×${districts} districts, seed ${seed}, ${placed.length} schools placed, ${famN} families with ${kidN} children seeded${schools ? '' : ' (no sim/schools.ts on this branch)'}`);
for (const p of placed) log(`  ${pad(KIND_NAMES[p.kind], 26)} door (${p.x}, ${p.y})`);

// ---- run -------------------------------------------------------------------------------------------------------------
const uni = placed.find((p) => p.kind === 106);
let seededStudents = 0;
const pupilsOf = () => [...w.citizens.values()].filter((c) => c.study > 0);
const morning = { peak: 0, peakAt: 0, walk: 0, lift: 0, ride: 0, drive: 0, other: 0, samples: 0, trips: new Set<number>() };
const flagLeaks = { toHome: 0, toWorkMissing: 0, sampled: 0 };
const present = new Map<string, number>();
let simMs = 0, schoolDayMs = 0, schoolDayTicks = 0;
const t0 = performance.now();
for (let i = 0; i < days * DAY; i++) {
  const ts = performance.now();
  sim.tick();
  const dt = performance.now() - ts;
  simMs += dt;
  const day = Math.floor(w.tick / DAY), h = (w.tick % DAY) / TPH, weekday = day % 7;
  if (weekday < 5 && h >= 7 && h < 16.5) { schoolDayMs += dt; schoolDayTicks++; }
  // a few second-year students at the university once it is staffed (day 0, 06:00): they graduate this Saturday
  if (schools && uni && w.tick === 6 * TPH) {
    const ub = w.buildings.get(tileKey(uni.x, uni.y))!;
    for (const c of w.citizens.values()) {
      if (seededStudents >= 20) break;
      const age = ageOf(c, w.tick);
      if (c.mig || c.study || age < 19 || age > 21 || c.state !== S.Home) continue;
      w.quitJob(c); // a student now
      if (c.edu < EduLevel.Further) { Object.assign(c, { edu: EduLevel.Further, track: 1 + (c.id % 2) }); }
      if (schools.enrolAt(c, ub, Study.Degree)) { c.due = 10; c.att = 9; seededStudents++; }
    }
  }
  if (weekday < 5 && h >= 7 && h < 9.5 && w.tick % 10 === 0) {
    let n = 0;
    for (const c of w.citizens.values()) {
      if (!c.study || c.job || c.state !== S.ToWork) continue;
      n++;
      morning.samples++;
      if (!morning.trips.has(c.id * 8 + weekday)) {
        morning.trips.add(c.id * 8 + weekday);
        if (c.leg?.lift || c.legs.some((l) => l.lift)) morning.lift++;
        else if (c.leg?.ride || c.legs.some((l) => l.ride)) morning.ride++;
        else if (c.leg?.drive) morning.drive++;
        else if (c.leg) morning.walk++;
        else morning.other++;
      }
    }
    if (n > morning.peak) { morning.peak = n; morning.peakAt = w.tick; }
  }
  if (w.tick % 50 === 0 && weekday < 5) {
    for (const a of sim.agents()) {
      const c = w.citizens.get(a.id);
      if (!c) continue;
      flagLeaks.sampled++;
      const flag = ((a.extra ?? 0) & CITIZEN_STUDY) !== 0;
      if (flag && c.state === S.ToHome && !(c.eduBits & EDU_HOMEWARD)) flagLeaks.toHome++;
      if (!flag && c.study && c.state === S.ToWork) flagLeaks.toWorkMissing++;
    }
  }
  if (weekday < 5 && Math.abs(h - 11) < 1e-9) {
    for (const c of w.citizens.values()) if (c.study && !c.job && c.state === S.Work) present.set(`${day}`, (present.get(`${day}`) ?? 0) + 1);
  }
}
const wall = (performance.now() - t0) / 1000;
const saveTo = argv.includes('--save') ? argv[argv.indexOf('--save') + 1] : null;
if (saveTo) {
  saveWorld(w, saveTo);
  const sp = [...placed].map((p) => `${KIND_NAMES[p.kind]} (${p.x}, ${p.y})`).join(', ');
  console.log(`saved the world at day ${Math.floor(w.tick / DAY)} ${((w.tick % DAY) / TPH).toFixed(2)} h to ${saveTo}: ${w.citizens.size} citizens, ${pupilsOf().length} pupils; ${sp}`);
  process.exit(0);
}
const cs = [...w.citizens.values()];
const kids = cs.filter((c) => ageOf(c, w.tick) < 18);
console.log(`\n${days} game days (${days * DAY} ticks) in ${wall.toFixed(1)} s: sim ${(simMs / (days * DAY)).toFixed(3)} ms/tick, school hours on school days ${(schoolDayMs / Math.max(1, schoolDayTicks)).toFixed(3)} ms/tick`);
console.log(`  ${cs.length} citizens, ${kids.length} under 18 (${pct(kids.length, cs.length)}%), ${sim.lifeEvents.births} born`);
if (!schools) process.exit(0);

// ---- report ----------------------------------------------------------------------------------------------------------
const ev = schools.events;
console.log('\nSchools (staff are the level capacity; teachers hold a degree; admitting = places × staffing):');
console.log(`  ${pad('kind', 26)} ${pad('door', 10)} ${pad('staff', 7)} ${pad('teachers', 9)} ${pad('admit', 9)} ${pad('pupils', 6)} ${pad('wait', 5)} ${pad('quality', 7)}  results`);
for (const s of schools.list()) {
  const cap = capacityOf(s.b.id, s.b.level);
  const pg = s.needPg ? ` pg ${s.postgrads}/${s.needPg}` : '';
  console.log(`  ${pad(KIND_NAMES[s.b.id], 26)} ${pad(`${s.b.x},${s.b.y}`, 10)} ${pad(`${s.staff}/${cap}`, 7)} ${pad(`${s.teachers}/${s.needed}`, 9)}${pg} ${pad(`${schools.admittingOf(s)}/${s.spec.places}`, 9)} ${pad(s.pupils, 6)} ${pad(s.waiting, 5)} ${pad(s.quality.toFixed(2), 7)}  passed ${s.passed}, failed ${s.failed}, dropped ${s.dropped}`);
}
const byStage = new Map<number, { n: number; att: number; due: number }>();
for (const c of cs) if (c.study) { const r = byStage.get(c.study) ?? { n: 0, att: 0, due: 0 }; r.n++; r.att += c.att; r.due += c.due; byStage.set(c.study, r); }
console.log('\nEnrolled now, by stage (attendance = days attended / school days held, this stage so far):');
for (const st of [1, 2, 3, 4, 6, 7]) { const r = byStage.get(st); if (r) console.log(`  ${pad(STUDY_NAMES[st], 17)} ${pad(r.n, 5)}  attendance ${pct(r.att, r.due)}% (${r.att}/${r.due})`); }
// school-age children (by age at the start of this school year) without a place
const yearStart = Math.floor((Math.floor(w.tick / DAY) + 2) / 7) * 7; // the school year of the next school day (after Saturday's results: next year's)
const unplaced = new Map<number, number>();
for (const c of kids) { const a = (yearStart - c.born) / LIFE.daysPerYear; if (a >= 3 && a < 18 && !c.study) { const st = a < 4 ? 1 : a < 11 ? 2 : a < 16 ? 3 : 4; unplaced.set(st, (unplaced.get(st) ?? 0) + 1); } }
if (argv.includes('--debug')) for (const c of kids.filter((k) => { const a = (yearStart - k.born) / LIFE.daysPerYear; return a >= 3 && a < 18 && !k.study; }).slice(0, 12)) {
  const a = (yearStart - c.born) / LIFE.daysPerYear;
  const near = schools.list().filter((s) => s.spec.places > 0).map((s) => `${s.spec.kind}:${Math.abs(s.b.x - c.hx) + Math.abs(s.b.y - c.hy)}`).join(' ');
  console.log(`    #${c.id} age ${a.toFixed(2)} home (${c.hx}, ${c.hy}) state ${c.state} mig ${c.mig ?? 0} job ${c.job} log ${JSON.stringify(c.eduLog)} schools ${near}`);
}
console.log(`  school-age children with no place: ${[...unplaced].map(([st, n]) => `${STUDY_NAMES[st]} ${n}`).join(', ') || 'none'} (at the last admissions: ${ev.waitingAtLast} waiting for a full school in reach, ${ev.noSchoolAtLast} with no school of their stage in reach)`);
console.log(`  in school at 11:00: ${[...present].map(([d, n]) => `day ${d}: ${n}`).join(', ')}`);
// results from the log: this run's finished stages
const res = new Map<string, number>();
for (const c of cs) for (const e of c.eduLog) res.set(`${STUDY_NAMES[e[0]]}: ${['passed', 'failed', 'dropped out', 'left'][e[5]]}`, (res.get(`${STUDY_NAMES[e[0]]}: ${['passed', 'failed', 'dropped out', 'left'][e[5]]}`) ?? 0) + 1);
console.log(`\nResults (events): graduations ${ev.graduations}, nursery years done ${ev.nurseryDone}, failed ${ev.failed}, dropped out ${ev.dropOuts}, left (school closed or no way there) ${ev.left}; days attended ${ev.attended}`);
console.log(`  by stage (education logs of those still in town): ${[...res].sort().map(([k, n]) => `${k} ${n}`).join('; ')}`);
console.log(`\nEscorts for the under-${EDU.escortAge}s: lift ${ev.escort.lift}, older sibling ${ev.escort.sibling}, walked in by a grown-up ${ev.escort.adult}, on a parent's way to work ${ev.escort.onTheWay}, missed (no one to take them) ${ev.escort.missed}; fetched after school ${ev.fetched}, walked home alone ${ev.walkedHomeAlone}`);
const mt = morning.walk + morning.lift + morning.ride + morning.drive + morning.other;
console.log(`School run, 07:00-09:30 on school days: peak ${morning.peak} pupils on the way at once (${pad(((morning.peakAt % DAY) / TPH).toFixed(2), 5)} h); ${mt} trips: walk ${pct(morning.walk, mt)}%, lift ${pct(morning.lift, mt)}%, bus or train ${pct(morning.ride, mt)}%, drive ${pct(morning.drive, mt)}%`);
const sys = w.players.get('sys')!;
console.log(`Progress counters (sys): pupils ${sys.progress.pupils}, graduates ${sys.progress.graduates}; lifeEvents graduations ${sim.lifeEvents.graduations}, dropOuts ${sim.lifeEvents.dropOuts}`);
console.log(`CITIZEN_STUDY over ${flagLeaks.sampled} agent samples: ${flagLeaks.toHome} on a trip home that is not from school, ${flagLeaks.toWorkMissing} pupils on the way to school without it`);

if (!runChecks) process.exit(0);
console.log('\nChecks:');
const pupils = pupilsOf();
ok(placed.length === layout.districts.length * 3 + 2 + 3, `every school kind placed (${placed.length})`);
ok(pupils.length > 0, `pupils enrolled (${pupils.length})`);
ok(pupils.every((c) => { const b = w.buildings.get(tileKey(c.sx, c.sy)); return !!b && !!SCHOOL_SPECS[b.id]; }), 'every pupil is enrolled at a standing school');
ok(pupils.filter((c) => !c.job).every((c) => c.wx === c.sx && c.wy === c.sy), 'a pupil commutes to their school door (wx, wy mirror sx, sy)');
const misaged = pupils.filter((c) => { const a = (yearStart - c.born) / LIFE.daysPerYear; return c.study >= Study.Degree ? a < 17 : a < STAGES[c.study].ages[0] || a >= STAGES[c.study].ages[1]; });
ok(misaged.length === 0, `every pupil is of age for their stage (by age at the start of the school year)${misaged.length ? `: ${misaged.slice(0, 5).map((c) => `#${c.id} ${STUDY_NAMES[c.study]} ${((yearStart - c.born) / LIFE.daysPerYear).toFixed(2)}`).join(', ')}` : ''}`);
ok(schools.list().every((s) => s.pupils <= Math.max(schools.admittingOf(s), s.pupils) && schools.admittingOf(s) === Math.floor(s.spec.places * s.staffing)), 'admitting = places × staffing everywhere');
ok(ev.graduations > 0 && ev.nurseryDone > 0, `results day: ${ev.graduations} graduations, ${ev.nurseryDone} nursery years`);
ok(cs.every((c) => c.edu <= EduLevel.Postgrad && (c.study === 0 || c.study <= Study.Evening)), 'levels and stages stay in range');
ok(ev.attended > 0 && [...byStage.values()].every((r) => r.att <= r.due + r.n), 'attendance counted (at most one day ahead of the days held)');
ok(flagLeaks.toHome === 0 && flagLeaks.toWorkMissing === 0, 'CITIZEN_STUDY only on school trips');
ok(sys.progress.pupils > 0 && sys.progress.graduates > 0, `the pupils (${sys.progress.pupils}) and graduates (${sys.progress.graduates}) counters move`);
ok(ev.escort.lift + ev.escort.sibling + ev.escort.adult + ev.escort.onTheWay > 0, 'under-8s are taken to school');
ok(cs.every((c) => !(c.study && c.job && c.study < Study.Degree)), 'no school pupil holds a job');
ok(cs.filter((c) => c.stage === LifeStage.Adult && c.study && !c.job).every((c) => c.idleDays === 0), 'students are not counted idle (and do not leave town for want of work)');
// a degree started in town: sixth-form leavers with Level 3 who went on (the Monday after results)
const freshers = cs.filter((c) => c.study === Study.Degree && c.eduLog.some((e) => e[0] === Study.SixthForm && e[5] === EduResult.Passed));
console.log(`  (${ev.wentOn} offers on results day; ${freshers.length} school leavers went on to the university; ${cs.filter((c) => c.study === Study.Postgrad).length} graduates stayed on for a master's)`);

// the teacher shortfall: the same school with its degree holders gone admits fewer
{
  const s = schools.list().find((x) => x.spec.stage === Study.Primary && schools.admittingOf(x) > 0);
  if (s) {
    const before = schools.admittingOf(s), staffBefore = s.teachers;
    const gone = cs.filter((c) => c.job && c.wx === s.b.x && c.wy === s.b.y && c.edu >= EduLevel.Degree).slice(0, Math.ceil(s.teachers / 2));
    for (const c of gone) w.quitJob(c);
    schools.census();
    const after = schools.admittingOf(s);
    ok(after < before && after === Math.floor(s.spec.places * Math.min(1, s.teachers / s.needed)), `teacher shortfall: ${KIND_NAMES[s.b.id]} at (${s.b.x}, ${s.b.y}) with ${staffBefore} → ${s.teachers} of ${s.needed} teachers admits ${before} → ${after} of ${s.spec.places}`);
    const info = sim.describe(s.b);
    ok(!!info.school && info.school.admitting === after && info.school.teachers === s.teachers && info.school.pupils === s.pupils, `the inspect block: ${JSON.stringify(info.school)}`);
  } else ok(false, 'found a staffed primary school for the shortfall test');
}
// the citizen panel of a pupil
{
  const c = pupils.find((p) => p.study === Study.Primary && p.due > 0);
  const info = c && sim.describeCitizen(c.id);
  ok(!!info && info.occupation === 'pupil' && info.life?.education?.studying?.stage === Study.Primary && (info.life.education.studying.attendance ?? 2) <= 1,
    `a pupil's panel: ${info?.occupation}, ${JSON.stringify(info?.life?.education?.studying)}`);
}
// saves: the fields round-trip and a loaded world keeps its pupils and rebuilds the counts
{
  const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
  const back = worldFromSnapshot(snap)!;
  const bp = [...back.citizens.values()].filter((c) => c.study);
  ok(bp.length === pupilsOf().length && bp.every((c) => { const o = w.citizens.get(c.id)!; return o.study === c.study && o.sx === c.sx && o.att === c.att && o.due === c.due && c.wx === c.sx; }), `a save keeps every pupil's place (${bp.length})`);
  const bsim = new Simulation(back);
  let threw = '';
  try { for (let i = 0; i < 2 * TPH; i++) bsim.tick(); } catch (e) { threw = String(e); }
  const counted = bsim.schools.list().reduce((n, s) => n + s.pupils, 0);
  ok(!threw && counted === [...back.citizens.values()].filter((c) => c.study).length, `the loaded world runs and the census recounts ${counted} pupils${threw ? `: ${threw}` : ''}`);
}
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
