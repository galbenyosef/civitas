/**
 * searchprof.ts in its child process (under count-hook.mjs): see there for the modes and options.
 *
 * Phases are self times. Every wrapped function's time goes to its bucket less the time of the wrapped functions it
 * called, so a findRoute inside moveVehicles counts as a route search and not as moveVehicles, and a Traffic.step inside
 * moveCitizens as the traffic step. Whatever no wrapper covers (sampleHistory, the bits of sim.tick between steps) is
 * `other`. A findPath is a walk inside pathBetween, a job search inside findJob and a venue search inside goToVenue;
 * a findJob that ran no findPath was answered by its miss cache.
 */
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { TICKS_PER_DAY, TICKS_PER_HOUR, isDemoId, type DemoId } from '@msimcity/shared';
import { Simulation } from '../sim/simulation';
import { Traffic } from '../sim/traffic';
import { probeGame } from './probe-city';
import { recordCorpus } from './search-corpus';

type Fn = (this: unknown, ...a: unknown[]) => unknown;
interface PfHook { orig: Record<string, Fn>; set: Record<string, (f: Fn) => void> }
const G = globalThis as unknown as { __pfHook?: PfHook; __pfExpanded?: number };
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;

/** Self-time buckets. The first group are searches; `group` puts each in a row of the phase table. */
const BUCKETS = {
  astar: 'route', walk: 'route', venue: 'route', best: 'route', pathcheck: 'route', findPathOther: 'route',
  jobReal: 'job', jobCached: 'job',
  traffic: 'traffic', moveVehicles: 'traffic',
  moveCitizens: 'rest', plan: 'rest', reroute: 'rest', hire: 'rest', lifeStep: 'rest', dispatch: 'rest', transit: 'rest',
  mobile: 'rest', schools: 'rest', learning: 'rest', stats: 'rest', growth: 'rest', newDay: 'rest', spawn: 'rest',
  gateways: 'rest', airports: 'rest', harbours: 'rest', finance: 'rest', issues: 'rest', flush: 'rest', other: 'rest',
} as const;
type Bucket = keyof typeof BUCKETS;
const NAMES = Object.keys(BUCKETS) as Bucket[];
const B = Object.fromEntries(NAMES.map((n, i) => [n, i])) as Record<Bucket, number>;
const NB = NAMES.length;
/** search kinds of the per-call records */
const KINDS = ['astar', 'walk', 'venue', 'jobReal', 'jobCached', 'best'] as const;

const pct = (s: ArrayLike<number>, p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
const sorted = (a: ArrayLike<number>) => Float64Array.from(a).sort();
const mean = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };

export async function main(argv: string[]) {
  const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const mode = arg('mode', 'phases');
  const days = Number(arg('days', '1'));
  const districts = Number(arg('districts', '0'));
  const demo: DemoId | null = districts ? null : (isDemoId(arg('demo', 'london')) ? (arg('demo', 'london') as DemoId) : 'london');
  const hook = G.__pfHook;
  if (!hook) throw new Error('searchprof: count-hook.mjs is not loaded (run searchprof.ts, not search-phases.ts)');
  for (const [n, f] of Object.entries(hook.orig)) hook.set[n](f); // the hook's counters off: the game's own functions

  const t0 = performance.now();
  const { game, label, fill } = await probeGame(demo, districts);
  const w = game.world;
  console.log(`${label} filled: ${fill.pop} citizens, ${(fill.ticks / DAY).toFixed(2)} days, ${((performance.now() - t0) / 1000).toFixed(0)} s wall, ${process.arch} node ${process.version}, mode ${mode}`);
  console.log(`world: ${w.chunks.size} chunks, ${w.buildings.size} building tiles, ${w.vehicles.size} vehicles, tick ${w.tick} (${clock(w.tick)})`);

  const n = Math.round(days * DAY);
  const tick0 = w.tick + 1;
  const tickMs = new Float64Array(n);
  const self = new Float64Array(n * NB);
  let cur = 0; // row of `self` for the tick under way

  // ---- instrumentation (after the fill) ----
  const kRec: number[] = [], msRec: number[] = [], expRec: number[] = [], tickRec: number[] = [], flagRec: number[] = [], callerRec: number[] = [];
  const callerNames: string[] = [];
  const callerId = (s: string) => { let i = callerNames.indexOf(s); if (i < 0) { i = callerNames.length; callerNames.push(s); } return i; };
  let wrapperCalls = 0;
  let corpus: ReturnType<typeof recordCorpus> | null = null;
  if (mode === 'phases') {
    const ctx: string[] = ['tick'], child: number[] = [0], inner: boolean[] = [false];
    const wrap = (orig: Fn, name: string, bucket: (parent: string, sawSearch: boolean) => number, rec?: (dt: number, r: unknown, exp: number, parent: string, sawSearch: boolean) => void, search = false): Fn =>
      function (this: unknown, ...a: unknown[]) {
        wrapperCalls++;
        const parent = ctx[ctx.length - 1];
        if (search) inner[inner.length - 1] = true;
        const e0 = G.__pfExpanded ?? 0;
        ctx.push(name); child.push(0); inner.push(false);
        const t = performance.now();
        let r: unknown;
        try { r = orig.apply(this, a); } finally {
          const dt = performance.now() - t;
          ctx.pop(); const ch = child.pop()!; const saw = inner.pop()!;
          self[cur * NB + bucket(parent, saw)] += dt - ch;
          child[child.length - 1] += dt;
          if (rec) rec(dt, r, (G.__pfExpanded ?? 0) - e0, parent, saw);
        }
        return r;
      };
    const record = (kind: number) => (dt: number, r: unknown, exp: number, parent: string, saw: boolean) => {
      kRec.push(kind); msRec.push(dt); expRec.push(exp); tickRec.push(w.tick); callerRec.push(callerId(parent));
      flagRec.push((r ? 1 : 0) | (saw ? 2 : 0));
    };
    const fixed = (b: Bucket) => () => B[b];
    // searches (the hook's bindings)
    hook.set.findRoute(wrap(hook.orig.findRoute, 'findRoute', fixed('astar'), record(0), true));
    hook.set.pathBetween(wrap(hook.orig.pathBetween, 'pathBetween', fixed('walk'), record(1), true));
    hook.set.findBest(wrap(hook.orig.findBest, 'findBest', fixed('best'), record(5), true));
    hook.set.pathStillValid(wrap(hook.orig.pathStillValid, 'pathStillValid', fixed('pathcheck')));
    hook.set.findPath(wrap(hook.orig.findPath, 'findPath',
      (p) => B[p === 'pathBetween' ? 'walk' : p === 'findJob' ? 'jobReal' : p === 'goToVenue' ? 'venue' : 'findPathOther'],
      (dt, r, exp, p) => { if (p === 'goToVenue') record(2)(dt, r, exp, 'goToVenue', true); }, true));
    // job searches: a real one ran findPath; its hire is its own bucket
    let hireMs = 0;
    const proto = Simulation.prototype as unknown as Record<string, Fn>;
    const simWrap = (m: string, b: Bucket, rec?: (dt: number, r: unknown, exp: number, parent: string, saw: boolean) => void) => {
      if (typeof proto[m] !== 'function') throw new Error(`Simulation.${m} is gone`);
      proto[m] = wrap(proto[m], m, fixed(b), rec);
    };
    proto.findJob = wrap(proto.findJob, 'findJob', (_p, saw) => B[saw ? 'jobReal' : 'jobCached'], (dt, r, exp, p, saw) => {
      record(saw ? 3 : 4)(dt - hireMs, r, exp, p, saw); hireMs = 0;
    });
    simWrap('hire', 'hire', (dt, _r, _e, p) => { if (p === 'findJob') hireMs += dt; });
    simWrap('goToVenue', 'moveCitizens'); // context for its findPath only: its own time is the citizens'
    simWrap('moveCitizens', 'moveCitizens');
    simWrap('moveVehicles', 'moveVehicles');
    simWrap('plan', 'plan');
    simWrap('maybeReroute', 'reroute');
    simWrap('lifeStep', 'lifeStep');
    simWrap('dispatch', 'dispatch');
    simWrap('recomputeStats', 'stats');
    simWrap('growth', 'growth');
    simWrap('leisureGrowth', 'growth');
    simWrap('newDay', 'newDay');
    simWrap('spawn', 'spawn');
    for (const m of ['seekSite', 'findLot', 'migrate', 'spawnVehicle', 'headBack', 'addStops', 'repath', 'startTrip']) simWrap(m, 'moveCitizens'); // callers, for the per-call records
    const tproto = Traffic.prototype as unknown as Record<string, Fn>;
    for (const m of ['step', 'enter', 'beginTick', 'endTick', 'sweep', 'leave']) tproto[m] = wrap(tproto[m], `Traffic.${m}`, fixed('traffic'));
    const inst = (o: object, m: string, b: Bucket) => { const r = o as Record<string, Fn>; r[m] = wrap(r[m].bind(o) as Fn, m, fixed(b)); };
    const sim = game.sim as unknown as Record<string, object>;
    inst(sim.transit, 'tick', 'transit');
    inst(sim.mobile, 'tick', 'mobile');
    inst(sim.schools, 'tick', 'schools');
    inst(sim.learning, 'tick', 'learning');
    inst(sim.gateways, 'tick', 'gateways');
    inst(game.airports, 'tick', 'airports');
    inst(game.harbours, 'tick', 'harbours');
    inst(game.finance, 'tick', 'finance');
    inst(game.issues, 'tick', 'issues');
    inst(game.net, 'flush', 'flush');
  } else if (mode === 'record') {
    corpus = recordCorpus(game, hook, { label, dir: arg('out', '') });
  } else if (mode !== 'bare') throw new Error(`unknown --mode ${mode}`);

  let session: Session | null = null;
  const prof = arg('cpu-prof', '');
  if (prof) {
    session = new Session();
    session.connect();
    await new Promise<void>((r) => session!.post('Profiler.enable', () => session!.post('Profiler.setSamplingInterval', { interval: 200 }, () => session!.post('Profiler.start', () => r()))));
  }
  const wall0 = performance.now();
  for (let i = 0; i < n; i++) {
    cur = i;
    const t = performance.now();
    game.step();
    tickMs[i] = performance.now() - t;
    if (mode === 'phases') {
      let s = 0;
      for (let b = 0; b < NB; b++) s += self[i * NB + b];
      self[i * NB + B.other] += tickMs[i] - s;
    }
  }
  const wallS = (performance.now() - wall0) / 1000;
  if (session) {
    const p = await new Promise<unknown>((r, j) => session!.post('Profiler.stop', (err, res) => (err ? j(err) : r(res.profile))));
    writeFileSync(prof, JSON.stringify(p));
    console.log(`cpu profile of the day: ${prof}`);
  }
  let employed = 0;
  for (const c of w.citizens.values()) if (c.job) employed++;
  const end = { tick: w.tick, citizens: w.citizens.size, vehicles: w.vehicles.size, employed };
  console.log(`after ${days} day(s): ${end.citizens} citizens, ${end.employed} employed, ${end.vehicles} vehicles; day wall ${wallS.toFixed(1)} s`);

  // ---- windows: 08:00-09:00, 17:00-18:00 and the whole day ----
  const hourOf = (i: number) => Math.floor(((tick0 + i) % DAY) / TPH);
  const windows: [string, (i: number) => boolean][] = [['08-09', (i) => hourOf(i) === 8], ['17-18', (i) => hourOf(i) === 17], ['day', () => true]];
  const out: Record<string, unknown> = { label, arch: process.arch, node: process.version, mode, fill, end, tick0, ticks: n, wallS };
  for (const [wn, inWin] of windows) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (inWin(i)) idx.push(i);
    const tm = sorted(idx.map((i) => tickMs[i]));
    const total = mean(tm) * idx.length;
    const win: Record<string, unknown> = { ticks: idx.length, tickMean: mean(tm), tickP50: pct(tm, 0.5), tickP95: pct(tm, 0.95), tickP99: pct(tm, 0.99), tickMax: tm[tm.length - 1] ?? 0 };
    console.log(`\n== ${wn}: ${idx.length} ticks, tick mean ${mean(tm).toFixed(2)} ms, p95 ${pct(tm, 0.95).toFixed(2)} ms, max ${(tm[tm.length - 1] ?? 0).toFixed(1)} ms`);
    if (mode === 'phases') {
      const phase = (pick: (b: number) => boolean) => {
        const per = sorted(idx.map((i) => { let s = 0; for (let b = 0; b < NB; b++) if (pick(b)) s += self[i * NB + b]; return s; }));
        return { mean: mean(per), p95: pct(per, 0.95), share: total ? (mean(per) * idx.length) / total : 0 };
      };
      const groups: Record<string, unknown> = {};
      console.log('phase            mean ms    p95 ms   share');
      for (const gname of ['route', 'job', 'traffic', 'rest']) {
        const r = phase((b) => BUCKETS[NAMES[b]] === gname);
        groups[gname] = r;
        console.log(`${gname.padEnd(15)} ${r.mean.toFixed(3).padStart(8)} ${r.p95.toFixed(3).padStart(9)} ${(100 * r.share).toFixed(1).padStart(6)}%`);
      }
      const buckets: Record<string, unknown> = {};
      console.log('  by bucket:');
      for (let b = 0; b < NB; b++) {
        const r = phase((x) => x === b);
        buckets[NAMES[b]] = r;
        if (r.mean > 0.005) console.log(`  ${NAMES[b].padEnd(14)} ${r.mean.toFixed(3).padStart(8)} ${r.p95.toFixed(3).padStart(9)} ${(100 * r.share).toFixed(1).padStart(6)}%`);
      }
      // per-call records
      const ticks = new Set(idx.map((i) => tick0 + i));
      const calls: Record<string, unknown> = {};
      console.log('  search calls     calls/tick   ms/call mean   p50      p90      p99      max   expanded mean  p50   p99    max  found  ran');
      for (let k = 0; k < KINDS.length; k++) {
        const sel: number[] = [];
        for (let j = 0; j < kRec.length; j++) if (kRec[j] === k && ticks.has(tickRec[j])) sel.push(j);
        const ms = sorted(sel.map((j) => msRec[j])), ex = sorted(sel.map((j) => expRec[j]));
        const found = sel.filter((j) => flagRec[j] & 1).length, ran = sel.filter((j) => flagRec[j] & 2).length;
        const byCaller: Record<string, { calls: number; ms: number }> = {};
        for (const j of sel) { const c = callerNames[callerRec[j]]; const e = byCaller[c] ??= { calls: 0, ms: 0 }; e.calls++; e.ms += msRec[j]; }
        const r = { calls: sel.length, perTick: sel.length / idx.length, msMean: mean(ms), msP50: pct(ms, 0.5), msP90: pct(ms, 0.9), msP99: pct(ms, 0.99), msMax: ms[ms.length - 1] ?? 0, msTotal: mean(ms) * ms.length,
          expMean: mean(ex), expP50: pct(ex, 0.5), expP99: pct(ex, 0.99), expMax: ex[ex.length - 1] ?? 0, found, ran, byCaller };
        calls[KINDS[k]] = r;
        console.log(`  ${KINDS[k].padEnd(12)} ${String(r.calls).padStart(8)} ${r.perTick.toFixed(1).padStart(8)} ${r.msMean.toFixed(4).padStart(12)} ${r.msP50.toFixed(4).padStart(8)} ${r.msP90.toFixed(4).padStart(8)} ${r.msP99.toFixed(3).padStart(8)} ${r.msMax.toFixed(2).padStart(8)} ${r.expMean.toFixed(0).padStart(10)} ${r.expP50.toFixed(0).padStart(6)} ${r.expP99.toFixed(0).padStart(5)} ${r.expMax.toFixed(0).padStart(6)} ${String(found).padStart(6)} ${String(ran).padStart(6)}`);
        const top = Object.entries(byCaller).sort((a, b) => b[1].ms - a[1].ms).slice(0, 6);
        if (top.length > 1) console.log(`      by caller: ${top.map(([c, e]) => `${c} ${e.calls} (${e.ms.toFixed(0)} ms)`).join(', ')}`);
      }
      Object.assign(win, { groups, buckets, calls });
    }
    out[wn] = win;
  }
  if (mode === 'phases') {
    // what the wrappers themselves cost: an empty function through the same wrapper, against calling it directly
    const est = wrapperCost();
    out.wrapper = { callsPerTick: wrapperCalls / n, nsPerCall: est, msPerTick: (wrapperCalls / n) * est / 1e6 };
    console.log(`\nwrappers: ${(wrapperCalls / n).toFixed(0)} calls a tick at ~${est.toFixed(0)} ns each: ~${((wrapperCalls / n) * est / 1e6).toFixed(2)} ms a tick of the measured time is instrumentation`);
  }
  if (corpus) out.corpus = corpus.finish();
  const json = arg('json', '');
  if (json) { writeFileSync(json, JSON.stringify(out, null, 1)); console.log(`summary: ${json}`); }
  process.exit(0);
}

function clock(tick: number) {
  const t = tick % DAY;
  return `${String(Math.floor(t / TPH)).padStart(2, '0')}:${String(Math.floor(((t % TPH) / TPH) * 60)).padStart(2, '0')}`;
}

/** ns a wrapper (as above, without the records) adds to one call. */
function wrapperCost(): number {
  const ctx: string[] = ['x'], child: number[] = [0], inner: boolean[] = [false];
  const acc = new Float64Array(4);
  let sink = 0;
  const f = function (this: unknown, a: unknown) { sink += a as number; return sink; } as Fn;
  const wrapped = function (this: unknown, ...a: unknown[]) {
    ctx.push('f'); child.push(0); inner.push(false);
    const t = performance.now();
    let r: unknown;
    try { r = f.apply(this, a); } finally { const dt = performance.now() - t; ctx.pop(); const ch = child.pop()!; inner.pop(); acc[0] += dt - ch; child[child.length - 1] += dt; }
    return r;
  };
  const N = 2_000_000;
  const time = (g: Fn) => { const t = performance.now(); for (let i = 0; i < N; i++) g(i); return performance.now() - t; };
  time(f); time(wrapped);
  const base = Math.min(time(f), time(f)), wr = Math.min(time(wrapped), time(wrapped));
  return ((wr - base) / N) * 1e6;
}
