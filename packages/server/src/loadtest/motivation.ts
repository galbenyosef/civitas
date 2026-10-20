/**
 * Motivation probe (docs/motivation.md M1-M2): values, inheritance and the scored choices.
 *
 *   npx tsx packages/server/src/loadtest/motivation.ts [--districts 1] [--days 5] [--seed 1]
 *
 * Checks the pure helpers (packing, the archetype mix, the words), that values are seeded deterministically (the same
 * id gives the same values, the same seed the same city), that children inherit (their values track their parents'
 * far more than strangers'), then runs the same test city twice under the same seeded Math.random: once with
 * motivation off (MOTIVATION.on = false: every decision as on main) and once on, and compares who takes which job and
 * home. Money-minded workers should hold better-paid jobs and time-minded ones shorter commutes only when it is on;
 * self-initiated job changes and moves must stay under 1% a day (Rich's 2a). Last, old saves: a snapshot keeps the
 * values, and one saved before motivation loads with values derived from the id, the same on every load. Prints sim
 * ms per tick for both runs; the last line, "MOTIVATION {...}", is a JSON summary.
 */
import {
  TICKS_PER_DAY, LifeStage, Zone, Value, KIND_ID, packTile, terrainOf, workOf, capacityOf, VALUE_COUNT, VALUE_NAMES, MOTIVE, ARCHETYPES, mulberry32,
  packValues, valueInts, valuesOf, seededValues, archetypeBlend, describeValues, topValues, wageOf, wageMul, tileKey,
} from '@msimcity/shared';
import { World, type Citizen } from '../world';
import { Simulation } from '../sim/simulation';
import { MOTIVATION, inheritValues, archetypeOf, stayOnLift, stemShare } from '../sim/motivation';
import { seedCity } from './cities';
import { snapshotOf, worldFromSnapshot } from '../snapshot';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const districts = get('districts', 1), days = get('days', 5), seed = get('seed', 1);
const DAY = TICKS_PER_DAY;

let checks = 0, fails = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) fails++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };
const f2 = (x: number) => x.toFixed(2), f3 = (x: number) => x.toFixed(3);
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function corr(a: number[], b: number[]) {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db || 1);
}

// ---- the pure helpers ------------------------------------------------------------------------------
console.log('Helpers:');
{
  const ints = [15, 0, 7, 3, 12, 1];
  ok(valueInts(packValues(ints)).join() === ints.join(), `pack and unpack six 0-15 values (${packValues(ints)})`);
  const w = valuesOf(packValues(ints));
  ok(Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-9 && w[0] === 15 / 38, 'weights are each value over the sum');
  let same = true;
  for (let id = 1; id <= 2000; id++) if (seededValues(id) !== seededValues(id)) same = false;
  ok(same, 'seededValues is a pure function of the id');
  // the city's mix: mean weights over many ids against the archetype table times MOTIVE.mix
  const N = 50_000, got = new Array(VALUE_COUNT).fill(0), want = new Array(VALUE_COUNT).fill(0), arch = new Array(ARCHETYPES.length).fill(0);
  for (let id = 1; id <= N; id++) { const v = valuesOf(seededValues(id)); for (let i = 0; i < VALUE_COUNT; i++) got[i] += v[i] / N; arch[archetypeOf(seededValues(id))]++; }
  const mixSum = MOTIVE.mix.reduce((s, x) => s + x, 0);
  ARCHETYPES.forEach((a, k) => { for (let i = 0; i < VALUE_COUNT; i++) want[i] += (MOTIVE.mix[k] / mixSum) * a.w[i]; });
  console.log(`  mean weights ${VALUE_NAMES.map((n, i) => `${n} ${f3(got[i])} (table ${f3(want[i])})`).join(', ')}`);
  console.log(`  nearest archetype ${ARCHETYPES.map((a, k) => `${a.name} ${(100 * arch[k] / N).toFixed(1)}%`).join(', ')}`);
  ok(got.every((g, i) => Math.abs(g - want[i]) < 0.05), 'mean weights follow the archetype mix (each within 0.05)');
  ok(arch.every((n, k) => Math.abs(n / N - MOTIVE.mix[k] / mixSum) < 0.08), 'every archetype appears near its share of the mix');
  // the "100% money" person: a pure Grafter
  let pure = 0;
  for (let id = 1; id <= N; id++) { const b = archetypeBlend(id); if (b[Value.Money] === 0.7) pure++; }
  ok(pure > 0.03 * N, `some citizens are pure Grafters (${pure} of ${N})`);
  ok(describeValues([0.1, 0.6, 0, 0.1, 0, 0.25]).startsWith('Cares most about family; restless'), `words: ${describeValues([0.1, 0.6, 0, 0.1, 0, 0.25])}`);
  ok(describeValues([0.75, 0.05, 0.05, 0.05, 0.05, 0.05]) === 'Cares most about money; above all', `words: ${describeValues([0.75, 0.05, 0.05, 0.05, 0.05, 0.05])}`);
  // staying on and the track are mean-neutral over the city
  const lifts: number[] = [], stems: number[] = [];
  for (let id = 1; id <= 20_000; id++) { const c = { vals: seededValues(id) } as Citizen; lifts.push(stayOnLift(c)); stems.push(stemShare(c)); }
  ok(Math.abs(mean(lifts) - 1) < 0.08 && Math.abs(mean(stems) - 0.5) < 0.05, `staying-on lift averages ${f3(mean(lifts))} (1), STEM share ${f3(mean(stems))} (0.5)`);
}

console.log('\nInheritance:');
{
  // synthetic families: two parents seeded from their ids, a child from theirs
  const kid: number[][] = [[], [], [], [], [], []], par: number[][] = [[], [], [], [], [], []], stranger: number[][] = [[], [], [], [], [], []];
  for (let f = 0; f < 5000; f++) {
    const a = { vals: seededValues(100_000 + 2 * f) } as Citizen, b = { vals: seededValues(100_001 + 2 * f) } as Citizen;
    const k = valuesOf(inheritValues(500_000 + f, [a, b])), pa = valuesOf(a.vals), pb = valuesOf(b.vals), s = valuesOf(seededValues(900_000 + f));
    for (let i = 0; i < VALUE_COUNT; i++) { kid[i].push(k[i]); par[i].push((pa[i] + pb[i]) / 2); stranger[i].push(s[i]); }
  }
  const rk = VALUE_NAMES.map((_, i) => corr(kid[i], par[i])), rs = VALUE_NAMES.map((_, i) => corr(stranger[i], par[i]));
  console.log(`  child vs parents' mean, correlation by value: ${VALUE_NAMES.map((n, i) => `${n} ${f2(rk[i])}`).join(', ')}`);
  console.log(`  a stranger vs the same parents:              ${VALUE_NAMES.map((n, i) => `${n} ${f2(rs[i])}`).join(', ')}`);
  ok(rk.every((r) => r > 0.6) && rs.every((r) => Math.abs(r) < 0.1), 'children track their parents (r > 0.6 every value), strangers do not');
  const one = { vals: packValues([15, 1, 1, 0, 1, 0]) } as Citizen;
  const kids = Array.from({ length: 200 }, (_, i) => valuesOf(inheritValues(700_000 + i, [one]))[Value.Money]);
  ok(mean(kids) > 0.45, `a Grafter's children care about money (mean weight ${f2(mean(kids))}, city ~0.26)`);
  ok(inheritValues(42, [one]) === inheritValues(42, [one]), 'inheritance is deterministic');
}

// ---- the same city, off then on ----------------------------------------------------------------------
interface Run {
  sim: Simulation; w: World; simMs: number;
  /** per day from day 2: workers and households, for the rates */
  workers: number[]; households: number[];
  /** the households' homes at the start of day 2 */
  homesAt: Map<number, number>;
}
function run(on: boolean): Run {
  MOTIVATION.on = on;
  Math.random = mulberry32(seed * 7919);
  const w = new World(seed);
  seedCity(w, { districts, built: 3 });
  const sim = new Simulation(w);
  let simMs = 0;
  const workers: number[] = [], households: number[] = [], homesAt = new Map<number, number>();
  for (let i = 0; i < days * DAY; i++) {
    if (i % DAY === 0 && i >= DAY) {
      let wk = 0;
      const hh = new Set<number>();
      for (const c of w.citizens.values()) { if (c.job) wk++; if (c.stage !== LifeStage.Child) hh.add(c.hh); if (i === DAY) homesAt.set(c.id, tileKeyN(c.hx, c.hy)); }
      workers.push(wk); households.push(hh.size);
      if (i === DAY) { sim.motive.stats.jobSwitches = 0; sim.motive.stats.moves = 0; sim.motive.stats.movedPeople = 0; sim.motive.stats.jobLooks = 0; sim.motive.stats.homeLooks = 0; }
    }
    const t = performance.now(); sim.tick(); simMs += performance.now() - t;
  }
  return { sim, w, simMs, workers, households, homesAt };
}
const tileKeyN = (x: number, y: number) => (x + 0x8000) * 65536 + (y + 0x8000);

/** Who holds which job: for top-Money and top-Time workers, the wage and commute against all workers. */
function jobs(r: Run) {
  const wage = (c: Citizen) => { const b = r.w.buildings.get(tileKey(c.wx, c.wy)); return b ? wageOf(b.id, b.level) * wageMul(c, b.id) : 0; };
  const steps = (c: Citizen) => (c.commute ? c.commute.length / 2 - 1 : Math.abs(c.wx - c.hx) + Math.abs(c.wy - c.hy));
  const all = [...r.w.citizens.values()].filter((c) => c.job && c.stage === LifeStage.Adult);
  const top = (v: number) => all.filter((c) => topValues(valuesOf(c.vals))[0] === v);
  const money = top(Value.Money), time = top(Value.Time), status = top(Value.Status);
  return {
    workers: all.length,
    wageMoney: mean(money.map(wage)) / mean(all.map(wage)),
    stepsTime: mean(time.map(steps)) / mean(all.map(steps)),
    skilledStatus: status.filter((c) => c.skill).length / Math.max(1, status.length) - all.filter((c) => c.skill).length / Math.max(1, all.length),
    n: { money: money.length, time: time.length, status: status.length },
  };
}

console.log(`\nThe same test city (${districts}×${districts} districts built to 3, seed ${seed}, ${days} game days), motivation off then on:`);
const off = run(false);
const on = run(true);
MOTIVATION.on = true;
const jo = jobs(off), jn = jobs(on);
const msOff = off.simMs / (days * DAY), msOn = on.simMs / (days * DAY);
console.log(`  citizens ${off.w.citizens.size} / ${on.w.citizens.size}, workers ${jo.workers} / ${jn.workers}; sim ${f3(msOff)} / ${f3(msOn)} ms a tick (${(100 * (msOn / msOff - 1)).toFixed(1)}%)`);
console.log(`  top-Money workers' wage over all workers'   ${f3(jo.wageMoney)} off, ${f3(jn.wageMoney)} on (${jn.n.money} of them)`);
console.log(`  top-Time workers' commute over all workers' ${f3(jo.stepsTime)} off, ${f3(jn.stepsTime)} on (${jn.n.time})`);
console.log(`  top-Status workers in skilled places, over all workers: ${f3(jo.skilledStatus)} off, ${f3(jn.skilledStatus)} on (${jn.n.status})`);
const st = on.sim.motive.stats;
console.log(`  scored job searches ${st.scoredJobs}, ${st.notFirst} (${(100 * st.notFirst / Math.max(1, st.scoredJobs)).toFixed(0)}%) took a job other than the nearest; seeded ${st.seeded} (${st.byArea} drawn by area), homes scored ${st.scoredHomes}`);
ok(off.sim.motive.stats.scoredJobs === 0 && off.sim.motive.stats.jobSwitches === 0 && off.sim.motive.stats.moves === 0, 'off: no scored choices, no job changes or moves of their own accord (as on main)');
ok(jn.wageMoney - jo.wageMoney > 0.02, `on: money-minded workers hold better-paid jobs (+${f3(jn.wageMoney - jo.wageMoney)} of the mean wage)`);
ok(jo.stepsTime - jn.stepsTime > 0.03, `on: time-minded workers have shorter commutes (−${f3(jo.stepsTime - jn.stepsTime)} of the mean)`);
ok(st.notFirst > 0.15 * st.scoredJobs, 'on: a good share of hires are not the nearest vacancy');
ok(st.byArea > 0, 'on: incomers are drawn by the area they move into');
// rates over days 2..days
const d = days - 1, meanWorkers = mean(on.workers), meanHh = mean(on.households);
const switchRate = st.jobSwitches / d / meanWorkers, moveRate = st.moves / d / meanHh;
console.log(`  of their own accord, days 2-${days}: ${st.jobLooks} job looks, ${st.jobSwitches} changes (${(100 * switchRate).toFixed(2)}% of workers a day); ${st.homeLooks} home looks, ${st.moves} moves of ${st.movedPeople} people (${(100 * moveRate).toFixed(2)}% of households a day)`);
ok(st.jobSwitches > 0 && switchRate < 0.01, 'some workers change job of their own accord, under 1% a day');
// the test city's homes are full, so a look rarely finds a home with room: the home-choice test below shows where they would go
ok(st.homeLooks > 0 && moveRate < 0.01, `households look for a better home and move of their own accord under 1% a day (${st.moves} moved)`);
// homes: where a household would move, by what it cares about (every home counted as having room, need 0)
{
  const host = (on.sim as unknown as { motiveHost: Parameters<typeof on.sim.motive.bestHome>[1] }).motiveHost;
  const adults = [...on.w.citizens.values()].filter((c) => c.stage === LifeStage.Adult && c.job).slice(0, 300);
  const pure = (v: number) => { const w = new Array(VALUE_COUNT).fill(0.02); w[v] = 0.9; return w; };
  const pickD = (w: number[]) => mean(adults.map((c) => { const r = on.sim.motive.bestHome(c, host, 0, w); return r ? Math.abs(r.b.x - c.hx) + Math.abs(r.b.y - c.hy) : 0; }));
  const toWork = (w: number[]) => mean(adults.map((c) => { const r = on.sim.motive.bestHome(c, host, 0, w); return r ? Math.abs(r.b.x - c.wx) + Math.abs(r.b.y - c.wy) : 0; }));
  const level = (w: number[]) => mean(adults.map((c) => on.sim.motive.bestHome(c, host, 0, w)?.b.level ?? 0));
  // as on main: the move-out's near-and-random scorer
  const mainD = mean(adults.map((c) => { const b = on.w.bestBuiltNear(c.hx, c.hy, [Zone.Residential], 30, 6, (b, d) => (b.x !== c.hx || b.y !== c.hy ? 6 * Math.random() - d : null)); return b ? Math.abs(b.x - c.hx) + Math.abs(b.y - c.hy) : 0; }));
  const dRoots = pickD(pure(Value.Roots)), dAdv = pickD(pure(Value.Adventure)), wTime = toWork(pure(Value.Time)), wAdv = toWork(pure(Value.Adventure));
  const lStatus = level(pure(Value.Status)), lMoney = level(pure(Value.Money));
  console.log(`  a home to move to, ${adults.length} workers: tiles from home ${f2(dRoots)} for Roots, ${f2(dAdv)} for Adventure (main's near-and-random ${f2(mainD)}); tiles to work ${f2(wTime)} for Time, ${f2(wAdv)} for Adventure; level ${f2(lStatus)} for Status, ${f2(lMoney)} for Money`);
  ok(dAdv > dRoots + 5 && wTime < wAdv - 3, 'on: the homes chosen follow values (Adventure goes further than Roots, Time lives nearer work)');
  for (const [day, id, what] of on.sim.motive.log.slice(-5)) {
    const c = on.w.citizens.get(id);
    console.log(`    day ${day}: #${id} ${what}${c ? ` (${describeValues(on.sim.motive.weightsOf(c))})` : ''}`);
  }
}

console.log('\nIn the city:');
{
  const cs = [...on.w.citizens.values()];
  ok(cs.every((c) => c.vals > 0), `every citizen has values (${cs.length})`);
  // births in the run: children with both parents present track them
  const kid: number[] = [], par: number[] = [];
  for (const c of cs) {
    if (c.stage !== LifeStage.Child || !c.par) continue;
    const p = on.w.citizens.get(c.par);
    if (!p) continue;
    const q = p.partner ? on.w.citizens.get(p.partner) : undefined;
    const k = valuesOf(c.vals), a = valuesOf(p.vals), b = q ? valuesOf(q.vals) : a;
    for (let i = 0; i < VALUE_COUNT; i++) { kid.push(k[i]); par.push((a[i] + b[i]) / 2); }
  }
  ok(kid.length > 0 && corr(kid, par) > 0.5, `children in town take after their parents (r = ${f2(corr(kid, par))} over ${kid.length / VALUE_COUNT} children)`);
  // deterministic: a second run of the same seed seeds the same values
  const again = run(true);
  let diff = 0, n = 0;
  for (const c of again.w.citizens.values()) { const o = on.w.citizens.get(c.id); if (o) { n++; if (o.vals !== c.vals) diff++; } }
  ok(n > 0 && diff === 0, `the same seed gives every citizen the same values (${n} compared)`);
  // the panel and Focus groups
  const adult = cs.find((c) => c.stage === LifeStage.Adult)!;
  const info = on.sim.describeCitizen(adult.id);
  ok(!!info?.life?.values?.startsWith('Cares most about'), `the citizen panel says "${info?.life?.values}"`);
  const f = on.sim.focusAt(adult.hx, adult.hy);
  ok(!!f && f.people > 0 && f.pct.reduce((s, x) => s + x, 0) === 100, `Focus groups at ${f?.parcel}: ${f ? VALUE_NAMES.map((nm, i) => `${nm} ${f.pct[i]}%`).join(', ') : 'none'} (${f?.people} asked)`);
}

console.log('\nA new essential workplace in a town with nobody out of work:');
{
  /**
   * a shop lot with nobody working there rebuilt as `kind` and finished at once, as net.ts builds a civic kind: nobody is
   * let go, so no job-seeker comes for it (a shop with staff would free them, and they would take the new place)
   */
  const place = (r: Run, kind: string, pick: number) => {
    const w = r.w, shops = [...w.buildings.values()].filter((b) => b.zone === Zone.Commercial && b.level > 0 && b.occupants === 0 && !w.auxAt(b.x, b.y) && w.hasRoadAccess(b.x, b.y));
    const shop = shops[(pick * 37) % shops.length];
    const k = KIND_ID[kind as keyof typeof KIND_ID];
    w.setTile(shop.x, shop.y, packTile(terrainOf(w.getTile(shop.x, shop.y)), false, 0, 0));
    w.completeSite(w.createSite(shop.x, shop.y, k, 1, workOf(k, 1), 1)!);
    return w.buildings.get(tileKey(shop.x, shop.y))!;
  };
  const out = (r: Run) => [...r.w.citizens.values()].filter((c) => c.stage === LifeStage.Adult && !c.job && !c.study && !c.mig).length;
  const staffAfter = (r: Run, kind: string, pick: number) => {
    const b = place(r, kind, pick);
    for (let i = 0; i < DAY; i++) r.sim.tick();
    return { b, staff: b.occupants, cap: capacityOf(b.id, b.level) };
  };
  const rec0 = on.sim.motive.stats.recruited;
  MOTIVATION.on = false;
  const offPost = staffAfter(off, 'fire-post', 1), offBox = staffAfter(off, 'police-box', 2);
  MOTIVATION.on = true;
  console.log(`  out of work before: ${out(on)} (on), ${out(off)} (off)`);
  const post = staffAfter(on, 'fire-post', 1), box = staffAfter(on, 'police-box', 2);
  console.log(`  after a game day: fire post ${post.staff}/${post.cap} on (${offPost.staff}/${offPost.cap} off), police box ${box.staff}/${box.cap} on (${offBox.staff}/${offBox.cap} off); ${on.sim.motive.stats.recruited - rec0} recruited from other jobs`);
  ok(post.staff >= post.cap / 2 && box.staff >= box.cap / 2, 'on: a new fire post and police box are at least half staffed within a game day');
}

console.log('\nOld saves:');
{
  const snap = JSON.parse(JSON.stringify(snapshotOf(on.w)));
  const back = worldFromSnapshot(snap)!;
  ok([...back.citizens.values()].every((c) => c.vals === on.w.citizens.get(c.id)?.vals), 'a save keeps every citizen\'s values');
  const old = JSON.parse(JSON.stringify(snap));
  for (const c of old.citizens) delete c.vals;
  const a = worldFromSnapshot(old)!, b = worldFromSnapshot(JSON.parse(JSON.stringify(old)))!;
  const ac = [...a.citizens.values()];
  ok(snap.version === 8 && ac.length > 0 && ac.every((c) => c.vals === seededValues(c.id) && b.citizens.get(c.id)?.vals === c.vals),
    `a save from before motivation loads with values from the id, the same on every load (${ac.length} citizens, format v${snap.version})`);
  const sim = new Simulation(a);
  let threw = '';
  try { for (let i = 0; i < 600; i++) sim.tick(); } catch (e) { threw = String(e); }
  ok(!threw, `the loaded old save runs 600 ticks${threw ? `: ${threw}` : ''}`);
}

console.log(`\n${checks - fails} of ${checks} checks passed`);
console.log(`MOTIVATION ${JSON.stringify({ seed, days, citizens: on.w.citizens.size, msOff: +f3(msOff), msOn: +f3(msOn), wageMoney: [+f3(jo.wageMoney), +f3(jn.wageMoney)], stepsTime: [+f3(jo.stepsTime), +f3(jn.stepsTime)], switchPct: +(100 * switchRate).toFixed(3), movePct: +(100 * moveRate).toFixed(3), notFirst: st.notFirst, scored: st.scoredJobs })}`);
process.exit(fails ? 1 : 0);
