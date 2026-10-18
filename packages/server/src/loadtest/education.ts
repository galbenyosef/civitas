/**
 * Education probe (docs/education.md): fast-forward a fresh test city and print its people's schooling.
 *
 *   npx tsx packages/server/src/loadtest/education.ts --districts 1 --days 3 [--seed 1] [--built 3]
 *
 * Deterministic for a given --seed (Math.random is replaced before the world is built). Prints the level mix of
 * adults against EDU.baseMix, the education index of residents aged 25-64, tracks, children's levels by age, and
 * sim ms per tick. Then checks: levels never exceed what the age allows, babies have none, nobody studies yet (E1),
 * a save round-trips the education fields, a world saved before education loads with levels seeded from the id
 * (no format bump), the citizen panel and building rows carry them, and CITIZEN_STUDY reaches the agent flags.
 * Later phases add enrolment by stage, attendance, graduations, brain drain and the job fill rate by skill.
 */
import {
  TICKS_PER_DAY, CitizenState as S, LifeStage, CITIZEN_STUDY, EDU, EDU_LEVEL_SHORT, EDU_TRACK_NAMES, EduLevel, Study,
  eduDefaults, eduIndexOf, maxLevelAt, yearGroup, birthdayOf, logEdu, tileKey,
} from '@msimcity/shared';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity } from './cities';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { ageOf, LIFE } from '../sim/life';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const districts = get('districts', 1), days = get('days', 3), built = get('built', 3), seed = get('seed', 1);

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

// ---- the pure helpers ------------------------------------------------------------------------------
console.log('Helpers:');
{
  const N = 100_000, counts = new Array(6).fill(0);
  for (let id = 1; id <= N; id++) counts[eduDefaults(id, 40).edu]++;
  const worst = Math.max(...counts.map((c, l) => Math.abs(c / N - EDU.baseMix[l])));
  ok(worst < 0.005, `eduDefaults at 40 matches baseMix over ${N} ids (worst share off by ${(100 * worst).toFixed(2)} pts), index ${eduIndexOf(counts).toFixed(1)}`);
  let capped = 0;
  for (let id = 1; id <= N; id++) for (const age of [0, 5, 10.9, 11, 15.9, 16, 17.9, 18, 21.9, 22, 30]) if (eduDefaults(id, age).edu > maxLevelAt(age)) capped++;
  ok(capped === 0, 'eduDefaults never exceeds maxLevelAt(age)');
  let young = 0;
  for (let id = 1; id <= N; id++) young += eduDefaults(id, 21.5).edu >= EduLevel.Degree ? 1 : 0;
  ok(young === 0, 'nobody aged 18-21 holds a degree');
  let kid = 0;
  for (let id = 1; id <= 2000; id++) if (eduDefaults(id, 13).edu !== EduLevel.Primary) kid++;
  ok(kid === 0, 'a 13-year-old has left primary (edu 1)');
  // year group: aged exactly 4 at Monday 00:00 of week 10 is Reception all that week; a moment younger is not yet
  const wk = 10 * 7, born4 = wk - 4 * 7;
  ok(yearGroup(born4, wk + 3.2) === 0 && yearGroup(born4 + 0.01, wk + 3.2) === -1 && yearGroup(born4 - 7, wk) === 1, 'year group: Reception at 4 by the start of the school year, Year 1 the year after');
  ok(yearGroup(born4 - 0.5, wk + 6.9) === 0, 'year group holds all week even after a birthday mid-week');
  const bd = birthdayOf(-100 * 7 + 3.5);
  ok(bd.weekday === 3 && bd.hour === 12, `birthday of a fractional day: Thursday 12:00 (got ${bd.weekday} ${bd.hour})`);
  const f = eduDefaults(1, 30);
  for (let i = 0; i < 9; i++) logEdu(f, [Study.Primary, i, 0, 0, i, 0]);
  ok(f.eduLog.length === EDU.logMax && f.eduLog[0][1] === 9 - EDU.logMax, `logEdu keeps the newest ${EDU.logMax}`);
}

// ---- a running city --------------------------------------------------------------------------------
const w = new World(seed);
seedCity(w, { districts, built });
const sim = new Simulation(w);
const DAY = TICKS_PER_DAY;
const t0 = performance.now();
let simMs = 0;
for (let i = 0; i < days * DAY; i++) { const ts = performance.now(); sim.tick(); simMs += performance.now() - ts; }
const cs = [...w.citizens.values()];
console.log(`\nEducation probe: ${districts}×${districts} districts built to ${built}, seed ${seed}, ${days} game days (${days * DAY} ticks) in ${((performance.now() - t0) / 1000).toFixed(1)} s, sim ${(simMs / (days * DAY)).toFixed(3)} ms/tick`);
console.log(`  ${cs.length} citizens, ${sim.lifeEvents.births} born here\n`);

const adults = cs.filter((c) => c.stage !== LifeStage.Child);
const mix = new Array(6).fill(0), core = new Array(6).fill(0);
for (const c of adults) { mix[c.edu]++; const a = ageOf(c, w.tick); if (a >= 25 && a < 65) core[c.edu]++; }
console.log(`Level mix, adults (${adults.length}) against EDU.baseMix:`);
for (let l = 0; l < 6; l++) console.log(`  ${pad(EDU_LEVEL_SHORT[l], 9)} ${pad(mix[l], 5)} ${pad(pct(mix[l], adults.length), 5)}%  base ${pad((100 * EDU.baseMix[l]).toFixed(0), 3)}%  ${'#'.repeat(Math.round((50 * mix[l]) / Math.max(1, adults.length)))}`);
const n25 = core.reduce((a, b) => a + b, 0);
console.log(`  education index (25-64, ${n25} people): ${eduIndexOf(core).toFixed(1)} (base ${eduIndexOf(EDU.baseMix.map((s) => s * 1000)).toFixed(1)})`);

const tracks = [new Array(4).fill(0), new Array(4).fill(0)];
for (const c of adults) if (c.edu >= EduLevel.Further) tracks[c.edu === EduLevel.Further ? 0 : 1][c.track]++;
console.log('\nTracks:');
for (const [i, label] of ['further', 'degree+'].entries()) {
  const t = tracks[i], n = t.reduce((a, b) => a + b, 0);
  console.log(`  ${pad(label, 8)} ${[1, 2, 3].map((k) => `${EDU_TRACK_NAMES[k]} ${pct(t[k], n)}%`).join(', ')}${t[0] ? `, none ${t[0]}` : ''}`);
}

const bands = [[0, 4], [4, 11], [11, 16], [16, 18], [18, 22], [22, 200]] as const;
console.log('\nLevels by age:');
for (const [lo, hi] of bands) {
  const row = new Array(6).fill(0);
  let n = 0;
  for (const c of cs) { const a = ageOf(c, w.tick); if (a >= lo && a < hi) { row[c.edu]++; n++; } }
  console.log(`  ${pad(`${lo}-${hi === 200 ? '' : hi - 1}`, 6)} ${pad(n, 5)}  ${row.map((v, l) => (v ? `${EDU_LEVEL_SHORT[l]} ${v}` : '')).filter(Boolean).join(', ')}`);
}

console.log('\nChecks:');
ok(cs.length > 100, `the city filled (${cs.length} citizens)`);
ok(cs.every((c) => c.edu <= maxLevelAt(ageOf(c, w.tick))), 'no citizen holds more than their age allows');
ok(cs.every((c) => ageOf(c, w.tick) >= 11 || c.edu === EduLevel.None), 'children under 11 (all born here) have no level');
ok(cs.every((c) => c.study === Study.None && c.att === 0 && c.due === 0 && c.eduLog.length === 0), 'nobody studies yet (admissions are E3)');
ok(cs.every((c) => (c.edu >= EduLevel.Further) === (c.track > 0) || ageOf(c, w.tick) < 18), 'adults hold a track exactly when they have further or more');
const worstMix = Math.max(...mix.map((m, l) => Math.abs(m / adults.length - EDU.baseMix[l])));
ok(worstMix < 0.05, `adult mix within 5 pts of baseMix (worst ${(100 * worstMix).toFixed(1)})`);

// the panels: citizen life and building rows
const adult = adults.find((c) => c.edu >= EduLevel.Degree)!;
const info = sim.describeCitizen(adult.id);
const ed = info?.life?.education;
ok(!!ed && ed.level === adult.edu && ed.track === adult.track && Array.isArray(ed.history) && !ed.studying, `describeCitizen: life.education ${JSON.stringify(ed)}`);
const bd = info?.life?.birthday;
ok(!!bd && bd.weekday >= 0 && bd.weekday < 7 && bd.hour >= 0 && bd.hour < 24, `describeCitizen: life.birthday ${JSON.stringify(bd)}`);
const home = w.buildings.get(tileKey(adult.hx, adult.hy))!;
const rows = sim.describe(home, true).people?.residents ?? [];
ok(rows.length > 0 && rows.every((r) => typeof r.edu === 'number' && r.edu === w.citizens.get(r.id)?.edu), `PersonRow.edu on ${rows.length} residents`);
// a pupil's panel once E3 enrols them: stage, year group, attendance and progress from the fields (anyone, re-dated to 8)
{
  const kid = cs.find((c) => c.stage === LifeStage.Child) ?? cs[1];
  const save = { study: kid.study, sx: kid.sx, sy: kid.sy, att: kid.att, due: kid.due, born: kid.born };
  kid.born = w.tick / DAY - 8.5 * LIFE.daysPerYear; kid.study = Study.Primary; kid.sx = home.x; kid.sy = home.y; kid.att = 9; kid.due = 10;
  const st = sim.describeCitizen(kid.id)?.life?.education?.studying;
  ok(!!st && st.stage === Study.Primary && st.attendance === 0.9 && (st.yearGroup === 4 || st.yearGroup === 3) && st.progress > 0.4 && st.progress < 0.75, `a pupil's panel: ${JSON.stringify(st)}`);
  Object.assign(kid, save);
}

// the wire: CITIZEN_STUDY on a commuter flagged as a pupil, never on anyone else
{
  const flagOf = (id: number) => { for (const a of sim.agents()) if (a.id === id) return a.extra ?? 0; return -1; };
  let leaked = 0;
  for (const a of sim.agents()) if ((a.extra ?? 0) & CITIZEN_STUDY) leaked++;
  ok(leaked === 0, 'no agent carries CITIZEN_STUDY while nobody studies');
  let c = cs.find((o) => o.state === S.ToWork && flagOf(o.id) >= 0);
  for (let i = 0; !c && i < DAY; i++) { sim.tick(); c = [...w.citizens.values()].find((o) => o.state === S.ToWork && flagOf(o.id) >= 0); }
  if (c) {
    c.study = Study.Secondary;
    ok((flagOf(c.id) & CITIZEN_STUDY) !== 0, `CITIZEN_STUDY on a pupil on the way to school (#${c.id})`);
    c.study = Study.None;
  } else ok(false, 'found a commuter to flag');
}

// saves: a round trip keeps the fields; a world saved before education seeds them from the id, with no format bump
{
  const live = [...w.citizens.values()];
  live[0].eduLog = [[Study.Secondary, 3, 4, 0, 2, 0]]; live[0].eduBits = 1;
  const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
  const back = worldFromSnapshot(snap)!;
  const same = live.every((c) => { const o = back.citizens.get(c.id); return !!o && o.edu === c.edu && o.track === c.track && o.eduBits === c.eduBits && JSON.stringify(o.eduLog) === JSON.stringify(c.eduLog); });
  ok(same && back.citizens.size === live.length, `a save round-trips the education fields (${back.citizens.size} citizens, version ${snap.version})`);
  const old = JSON.parse(JSON.stringify(snap));
  for (const c of old.citizens) for (const k of ['edu', 'track', 'study', 'sx', 'sy', 'att', 'due', 'eduBits', 'eduLog']) delete c[k];
  const legacy = worldFromSnapshot(old)!;
  const lc = [...legacy.citizens.values()];
  ok(lc.length === live.length && lc.every((c) => { const d = eduDefaults(c.id, ageOf(c, legacy.tick)); return c.edu === d.edu && c.track === d.track && c.study === 0 && Array.isArray(c.eduLog); }),
    `a pre-education save loads with levels seeded from the id and age (${lc.length} citizens, version ${old.version} unchanged)`);
  const changed = lc.filter((c) => c.edu !== w.citizens.get(c.id)?.edu).length;
  console.log(`  (${changed} of ${lc.length} reseeded levels differ from the live ones: newcomers who aged past a cap since arriving)`);
  const lsim = new Simulation(legacy);
  let threw = '';
  try { for (let i = 0; i < 600; i++) lsim.tick(); } catch (e) { threw = String(e); }
  ok(!threw, `the loaded legacy world runs 600 ticks${threw ? `: ${threw}` : ''}`);
  // the same old save with everyone re-dated to ages 0-70: children are seeded by age
  const aged = JSON.parse(JSON.stringify(old));
  for (const c of aged.citizens) c.born = aged.tick / DAY - ((c.id * 0.6180339887) % 1) * 70 * LIFE.daysPerYear;
  const ac = [...worldFromSnapshot(aged)!.citizens.values()];
  console.log('  levels by age in an old save re-dated to 0-70:');
  for (const [lo, hi] of bands) {
    const row = new Array(6).fill(0);
    let n = 0;
    for (const c of ac) { const a = ageOf(c, aged.tick); if (a >= lo && a < hi) { row[c.edu]++; n++; } }
    console.log(`    ${pad(`${lo}-${hi === 200 ? '' : hi - 1}`, 6)} ${pad(n, 5)}  ${row.map((v, l) => (v ? `${EDU_LEVEL_SHORT[l]} ${v}` : '')).filter(Boolean).join(', ')}`);
  }
  ok(ac.every((c) => { const a = ageOf(c, aged.tick); return c.edu <= maxLevelAt(a) && (a < 11 || c.edu >= EduLevel.Primary || a >= 18); }),
    're-dated old save: under 11 none, 11-17 at least primary, nobody past their age');
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
