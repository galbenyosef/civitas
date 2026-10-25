/**
 * `npm run perf:check` (docs/perf.md "Pre-emption"): the 2×2 test city, built and filled as its child process does
 * (probe-city.ts probeGame, seeded), then a fixed stretch of `game.loop()`s with the phase timers on. Fails when the tick
 * time or the phase shares drift from the committed baseline (packages/server/perf-baseline.json) by more than the
 * thresholds below.
 *
 *   npx tsx packages/server/src/loadtest/perf-check.ts            # check against the baseline
 *   npx tsx packages/server/src/loadtest/perf-check.ts --update   # a change was intended: rewrite the baseline
 *   npx tsx packages/server/src/loadtest/perf-check.ts --cost     # what the phase timers cost: laps on and off in alternating blocks
 *   options: --ticks N (default 900: three game hours from the fill's 02:00, so the morning rush is in), --json FILE, --strict (the work counters must match too)
 *
 * Why it holds on a loaded machine: the tick times are compared relative to a calibration loop timed in the same run
 * (a fixed arithmetic workload, the minimum of five), so a slow or busy machine moves the tick and the calibration
 * together; and the phase shares (percent of the tick) barely move under CPU contention. The work counters (route
 * searches, A* nodes, messages, bytes, the final population and world hash) are exact for a seeded run: when they differ
 * the game itself changed, which is reported as a note (a failure with --strict), and the baseline should be rewritten
 * with --update once the change is accepted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKS_PER_DAY } from '@msimcity/shared';
import { probeGame } from './probe-city';
import { PHASES, CI, type Phase, type PhaseStats } from '../perf/phases';
import { worldHash } from '../demo/seed';

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, '../../perf-baseline.json');
const argv = process.argv.slice(2);
const get = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const TICKS = Number(get('ticks') ?? 900);
const UPDATE = argv.includes('--update'), COST = argv.includes('--cost'), STRICT = argv.includes('--strict');

/** the thresholds: relative to the baseline's calibrated tick, and absolute percentage points of share */
export const THRESHOLDS = {
  /** tick avg, as a ratio to the calibration loop, may be this much slower than the baseline (+35%) */
  avg: 0.35,
  /** tick p95 likewise (+50%: the tail is noisier) */
  p95: 0.5,
  /** a phase's share of the tick may move this many percentage points, for phases with at least `minShare` of the tick */
  share: 6,
  minShare: 4,
};

export interface Baseline {
  version: 1; city: string; ticks: number; date: string; node: string; arch: string;
  calibMs: number;
  tick: { avg: number; p95: number; max: number };
  /** tick avg and p95 divided by calibMs: the machine-independent figures */
  rel: { avg: number; p95: number };
  phases: Record<Phase, { avg: number; share: number }>;
  /** over the whole stretch, exact for a seeded run */
  work: { routes: number; nodes: number; msgs: number; bytes: number; pop: number; hash: string };
  load: number[];
}

/** a fixed CPU-bound workload, the same every run (about 40 ms on a quiet M2 under Rosetta); the minimum of five */
export function calibrate(): number {
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    let a = 0x9e3779b9 >>> 0, acc = 0;
    for (let i = 0; i < 6_000_000; i++) { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; acc += (a & 0xff) * 1e-6; }
    if (acc < 0) console.log(acc); // keeps the loop from being optimised away
    best = Math.min(best, performance.now() - t0);
  }
  return r2(best);
}

const hhmm = (tick: number) => { const h = ((tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** the cost of the laps: alternating blocks with the timers on and off (on-off, off-on, ...), the same game; mean and s.e. of the pair differences */
function cost(loop: () => number, perf: PhaseStats) {
  // the laps themselves, measured directly: a million of them, the minimum of five runs
  let lapNs = Infinity;
  for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (let i = 0; i < 1_000_000; i++) perf.lap(PHASES[i % PHASES.length]); lapNs = Math.min(lapNs, performance.now() - t0); } // ms for a million = ns each
  perf.cur.fill(0);
  const perTick = (lapNs * 14) / 1000; // µs: twelve laps, a begin and the endTick's bookkeeping
  console.log(`one lap ${lapNs.toFixed(0)} ns; fourteen a tick ${perTick.toFixed(1)} µs = ${((100 * perTick) / 1000 / 4).toFixed(3)}% of a 4 ms 2×2 tick, ${((100 * perTick) / 1000 / 36).toFixed(4)}% of a 36 ms London tick`);
  const BLOCK = 25, PAIRS = 40;
  const diffs: number[] = [], onMs: number[] = [], offMs: number[] = [];
  const run = () => { let s = 0; for (let i = 0; i < BLOCK; i++) s += loop(); return s / BLOCK; };
  for (let p = 0; p < PAIRS; p++) {
    const got: Record<string, number> = {};
    for (const on of p % 2 === 0 ? [true, false] : [false, true]) { perf.enabled = on; got[String(on)] = run(); }
    onMs.push(got.true); offMs.push(got.false); diffs.push(got.true - got.false);
  }
  const d = mean(diffs), se = Math.sqrt(diffs.reduce((s, x) => s + (x - d) ** 2, 0) / (diffs.length - 1) / diffs.length);
  console.log(`phase timers: on ${mean(onMs).toFixed(3)} ms/tick, off ${mean(offMs).toFixed(3)} ms/tick; difference ${d >= 0 ? '+' : ''}${d.toFixed(3)} ± ${se.toFixed(3)} ms (${((100 * d) / mean(offMs)).toFixed(2)}% of the tick), ${PAIRS} pairs of ${BLOCK} ticks, orders alternated`);
}

const load0 = loadavg();
console.log(`perf-check: 2×2 city, ${TICKS} ticks; node ${process.version} ${process.arch}; load ${load0.map((l) => l.toFixed(1)).join(' ')} on ${cpus().length} cores${load0[0] > cpus().length ? ' (busy machine: the relative figures are what count)' : ''}`);
const calibMs = calibrate();
const t0 = performance.now();
const { game } = await probeGame(null, 2);
const { world: w, perf } = game;
perf.enabled = true;
console.log(`filled: ${w.citizens.size} citizens at ${hhmm(w.tick)} in ${((performance.now() - t0) / 1000).toFixed(0)} s; calibration ${calibMs} ms`);
if (COST) { cost(game.loop, perf); process.exit(0); }

// the measured stretch, accumulated tick by tick from the record of each closed tick
const totals: number[] = [];
const phaseSum = new Float64Array(PHASES.length);
const work = { routes: 0, nodes: 0, msgs: 0, bytes: 0 };
for (let i = 0; i < TICKS; i++) {
  totals.push(game.loop());
  const rec = perf.last()!;
  for (let p = 0; p < PHASES.length; p++) phaseSum[p] += rec.phases[p];
  work.routes += rec.counters[CI.routes]; work.nodes += rec.counters[CI.nodes]; work.msgs += rec.counters[CI.msgs]; work.bytes += rec.counters[CI.bytes];
}
const sorted = totals.slice().sort((a, b) => a - b);
const avg = mean(totals), p95 = sorted[Math.floor(0.95 * sorted.length)], max = sorted[sorted.length - 1];
const tickSum = totals.reduce((s, x) => s + x, 0);
const result: Baseline = {
  version: 1, city: '2x2', ticks: TICKS, date: new Date().toISOString().slice(0, 10), node: process.version, arch: process.arch,
  calibMs, tick: { avg: r2(avg), p95: r2(p95), max: r2(max) }, rel: { avg: r2(avg / calibMs), p95: r2(p95 / calibMs) },
  phases: Object.fromEntries(PHASES.map((p, i) => [p, { avg: r2(phaseSum[i] / TICKS), share: r2((100 * phaseSum[i]) / tickSum) }])) as Baseline['phases'],
  work: { ...work, pop: w.citizens.size, hash: worldHash(w) },
  load: loadavg().map((l) => r2(l)),
};
console.log(`tick avg ${result.tick.avg} ms, p95 ${result.tick.p95}, max ${result.tick.max} (relative to calibration: ${result.rel.avg}, ${result.rel.p95}); ends ${hhmm(w.tick)}`);
console.log('phase shares: ' + PHASES.filter((p) => result.phases[p].share >= 1).map((p) => `${p} ${result.phases[p].share}%`).join(', '));
console.log(`work over the stretch: ${work.routes} routes, ${work.nodes} nodes, ${work.msgs} msgs, ${(work.bytes / 1024).toFixed(0)} KB; ${result.work.pop} citizens, hash ${result.work.hash}`);
const jsonOut = get('json');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2));
if (UPDATE) { writeFileSync(BASELINE, JSON.stringify(result, null, 2) + '\n'); console.log(`baseline written: ${BASELINE}`); process.exit(0); }
let base: Baseline | null = null;
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline; } catch { console.log(`FAIL no baseline at ${BASELINE}: run with --update`); process.exit(1); }
let failed = 0;
const check = (what: string, ok: boolean, detail: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${detail}`); if (!ok) failed++; };
check('tick avg (relative)', result.rel.avg <= base!.rel.avg * (1 + THRESHOLDS.avg), `${result.rel.avg} against ${base!.rel.avg} (limit +${THRESHOLDS.avg * 100}% = ${r2(base!.rel.avg * (1 + THRESHOLDS.avg))}); absolute ${result.tick.avg} ms now, ${base!.tick.avg} ms at the baseline (calibration ${calibMs} against ${base!.calibMs} ms)`);
check('tick p95 (relative)', result.rel.p95 <= base!.rel.p95 * (1 + THRESHOLDS.p95), `${result.rel.p95} against ${base!.rel.p95} (limit +${THRESHOLDS.p95 * 100}% = ${r2(base!.rel.p95 * (1 + THRESHOLDS.p95))})`);
for (const p of PHASES) {
  const b = base!.phases[p]?.share ?? 0, n = result.phases[p].share;
  if (Math.max(b, n) < THRESHOLDS.minShare) continue;
  check(`phase ${p} share`, Math.abs(n - b) <= THRESHOLDS.share, `${n}% against ${b}% (±${THRESHOLDS.share} points)`);
}
const same = base!.work.hash === result.work.hash && base!.work.pop === result.work.pop && base!.work.nodes === result.work.nodes;
const note = same ? 'the same game as the baseline (world hash, population and A* nodes match)' : `the game changed since the baseline (hash ${result.work.hash} against ${base!.work.hash}, ${result.work.pop} against ${base!.work.pop} citizens, ${result.work.nodes} against ${base!.work.nodes} nodes): the timing comparison is between different games; rewrite the baseline with --update once the change is accepted`;
if (STRICT) check('same game', same, note); else console.log(`${same ? 'ok  ' : 'note'} ${note}`);
if (base!.ticks !== TICKS) console.log(`note the baseline measured ${base!.ticks} ticks, this run ${TICKS}`);
console.log(failed ? `perf-check: ${failed} FAILED` : 'perf-check: all ok');
process.exit(failed ? 1 : 0);
