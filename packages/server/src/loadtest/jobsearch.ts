/**
 * Job-search probe (docs/load-tests.md, "Failed job searches"): fill the London demo or a seedCity test city tick by
 * tick, as the demo and test-city children do, and time every tick. Selected simulation steps are wrapped so each
 * slow tick (> 100 ms) can be pinned on what it did; after the fill it runs on and reports the employment rate and the
 * unemployed adults at each game hour.
 *
 *   nice -n 10 npx tsx packages/server/src/loadtest/jobsearch.ts [--demo london | --districts 8] [--days 1]
 */
import { TICKS_PER_DAY, TICKS_PER_HOUR, LifeStage, isDemoId, type DemoId } from '@msimcity/shared';
import { Simulation } from '../sim/simulation';
import { probeCity } from './probe-city';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const days = Number(arg('days', '1'));
const districts = Number(arg('districts', '0'));
const demo: DemoId | null = districts ? null : (isDemoId(arg('demo', 'london')) ? (arg('demo', 'london') as DemoId) : 'london');

const { w, sim, airports, label, fill: fillIt } = probeCity(demo, districts);

// ---- wrap simulation steps: calls, failures (a false/null result) and ms within the current tick ----------------
const WRAP = ['findJob', 'spawn', 'migrantHome', 'goToVenue', 'pickLeisure', 'lifeStep', 'growth', 'leisureGrowth',
  'recomputeStats', 'dispatch', 'seekSite', 'plan', 'commutePath', 'moveHome', 'newDay', 'moveVehicles', 'findEntries'];
type Acc = { calls: number; fails: number; ms: number };
let tickAcc = new Map<string, Acc>();
const total = new Map<string, Acc>();
let depth = 0;
const proto = Simulation.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
for (const name of WRAP) {
  const orig = proto[name];
  if (typeof orig !== 'function') { console.log(`(no method ${name})`); continue; }
  proto[name] = function (this: unknown, ...a: unknown[]) {
    const t = performance.now();
    depth++;
    let r: unknown;
    try { r = orig.apply(this, a); } finally {
      depth--;
      const ms = performance.now() - t;
      for (const m of [tickAcc, total]) {
        let e = m.get(name);
        if (!e) m.set(name, (e = { calls: 0, fails: 0, ms: 0 }));
        e.calls++; e.ms += ms; if (r === false || r === null) e.fails++;
      }
    }
    return r;
  };
}

const times: number[] = [];
const slow: { tick: number; ms: number; pop: number; top: string }[] = [];
const step = () => {
  tickAcc = new Map();
  const t = performance.now();
  sim.tick(); airports.tick();
  const ms = performance.now() - t;
  times.push(ms);
  if (ms > 100) {
    const top = [...tickAcc.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 4)
      .map(([n, e]) => `${n} ${e.ms.toFixed(0)}ms/${e.calls}${e.fails ? ` (${e.fails} failed)` : ''}`).join(', ');
    slow.push({ tick: w.tick, ms, pop: w.citizens.size, top });
  }
};
const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const avg = s.reduce((x, y) => x + y, 0) / (s.length || 1);
  return `avg ${avg.toFixed(2)} ms, p95 ${(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(1)} ms, p99 ${(s[Math.floor(s.length * 0.99)] ?? 0).toFixed(1)} ms, max ${(s[s.length - 1] ?? 0).toFixed(1)} ms, ${s.filter((v) => v > 200).length} ticks > 200 ms`;
};
const unemployed = () => {
  let adults = 0, idle = 0;
  for (const c of w.citizens.values()) if (c.stage === LifeStage.Adult && !c.mig) { adults++; if (!c.job) idle++; }
  return { adults, idle };
};
const printTotals = () => {
  for (const [n, e] of [...total.entries()].sort((a, b) => b[1].ms - a[1].ms))
    console.log(`  ${n.padEnd(16)} ${e.ms.toFixed(0).padStart(7)} ms  ${String(e.calls).padStart(8)} calls  ${String(e.fails).padStart(8)} failed  ${(e.ms / e.calls).toFixed(3)} ms/call`);
  total.clear();
};

const t0 = performance.now();
const fill = await fillIt(step);
console.log(`${label} filled: ${fill.pop} citizens, ${(fill.ticks / TICKS_PER_DAY).toFixed(2)} days, ${((performance.now() - t0) / 1000).toFixed(0)} s wall`);
console.log(`fill ticks: ${stats(times)}`);
console.log(`slowest fill ticks:`);
for (const s of [...slow].sort((a, b) => b.ms - a.ms).slice(0, 8)) console.log(`  tick ${s.tick} (${s.pop} people): ${s.ms.toFixed(0)} ms: ${s.top}`);
console.log('fill totals:');
printTotals();

times.length = 0; slow.length = 0;
const n = Math.round(days * TICKS_PER_DAY);
const hourly: string[] = [];
for (let i = 0; i < n; i++) {
  step();
  if (w.tick % (3 * TICKS_PER_HOUR) === 0) {
    const u = unemployed();
    hourly.push(`${String(Math.floor((w.tick % TICKS_PER_DAY) / TICKS_PER_HOUR)).padStart(2, '0')}h ${u.idle}/${u.adults}`);
  }
}
const u = unemployed();
console.log(`after ${days} more day(s): ${w.citizens.size} citizens, jobs ${sim.jobs}, employed ${sim.employed}, unemployed adults ${u.idle}/${u.adults} (${((100 * u.idle) / (u.adults || 1)).toFixed(1)}%)`);
console.log(`unemployed adults every 3 h: ${hourly.join(', ')}`);
console.log(`run ticks: ${stats(times)}`);
for (const s of [...slow].sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log(`  tick ${s.tick} (${s.pop} people): ${s.ms.toFixed(0)} ms: ${s.top}`);
console.log('run totals:');
printTotals();
process.exit(0);
