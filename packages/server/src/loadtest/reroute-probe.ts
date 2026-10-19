/**
 * searchprof.ts --mode reroutes (docs/search-perf.md, "Cheaper re-routes"): fill the London demo as the other modes do,
 * then switch on `--set k=v,...` (TRAFFIC_TUNING) and run one more game day, recording
 *  - every A* search by caller: calls, time, nodes expanded, failures and failures that used the whole node budget;
 *    with `--reach-check`, whether a failed search's goal could be reached at all (an unbounded breadth-first search);
 *  - every re-route search (Simulation.maybeReroute): none found, only through the tile behind, not better enough (and
 *    of those, the same way as now), or taken;
 *  - the traffic as the HUD shows it (queued share, speed, parked cars), trips completed and their mean door-to-door
 *    ticks, give-ups (Traffic.counters) and drivers held up past the stuck limit (sampled every 100 ticks).
 * The settings change only the day after the fill, so every run starts that day from the same city.
 */
import { writeFileSync } from 'node:fs';
import { TICKS_PER_DAY, TRAFFIC_TUNING, CitizenState as S } from '@msimcity/shared';
import { Simulation } from '../sim/simulation';
import { findPath } from '../pathfinding';
import type { Mover, World } from '../world';
import { probeGame } from './probe-city';

type Fn = (this: unknown, ...a: unknown[]) => unknown;
interface PfHook { orig: Record<string, Fn>; set: Record<string, (f: Fn) => void> }
const G = globalThis as unknown as { __pfHook?: PfHook; __pfExpanded?: number };
const DAY = TICKS_PER_DAY;
const CALLERS = ['maybeReroute', 'spawnVehicle', 'headBack', 'plan', 'migrate', 'addStops'] as const;

export async function main(argv: string[]) {
  const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const set: Record<string, number> = {};
  for (const kv of arg('set', '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!(k in TRAFFIC_TUNING)) throw new Error(`--set ${k}: unknown tunable`);
    set[k] = Number(v);
  }
  const reachCheck = argv.includes('--reach-check');
  const hook = G.__pfHook;
  if (!hook) throw new Error('reroute-probe: count-hook.mjs is not loaded (run searchprof.ts --mode reroutes)');
  for (const [n, f] of Object.entries(hook.orig)) hook.set[n](f);

  const t0 = performance.now();
  const { game, label, fill } = await probeGame('london', 0);
  const w = game.world, sim = game.sim;
  console.log(`${label} filled: ${fill.pop} citizens, ${(fill.ticks / DAY).toFixed(2)} days, ${((performance.now() - t0) / 1000).toFixed(0)} s wall; set ${JSON.stringify(set)}`);
  Object.assign(TRAFFIC_TUNING, set);

  // ---- A* by caller ----
  let caller = 'other';
  const proto = Simulation.prototype as unknown as Record<string, Fn>;
  for (const m of CALLERS) {
    const orig = proto[m];
    if (typeof orig !== 'function') throw new Error(`Simulation.${m} is gone`);
    proto[m] = function (this: unknown, ...a: unknown[]) { const p = caller; caller = m; try { return orig.apply(this, a); } finally { caller = p; } };
  }
  interface Row { calls: number; ms: number; expanded: number; failed: number; failedMs: number; budget: number; budgetMs: number; unreachable: number; unreachableMs: number }
  const rows: Record<string, Row> = {};
  const row = (c: string) => (rows[c] ??= { calls: 0, ms: 0, expanded: 0, failed: 0, failedMs: 0, budget: 0, budgetMs: 0, unreachable: 0, unreachableMs: 0 });
  let last: { path: number[]; cost: number } | null = null;
  const findRoute = hook.orig.findRoute;
  hook.set.findRoute(function (this: unknown, ...a: unknown[]) {
    const e0 = G.__pfExpanded ?? 0, t = performance.now();
    const r = findRoute.apply(this, a) as { path: number[]; cost: number } | null;
    const ms = performance.now() - t, exp = (G.__pfExpanded ?? 0) - e0;
    const e = row(caller);
    e.calls++; e.ms += ms; e.expanded += exp;
    if (!r) {
      e.failed++; e.failedMs += ms;
      if (exp >= (a[7] as number ?? 4000)) { e.budget++; e.budgetMs += ms; }
      if (reachCheck && !reachable(w, a[1] as number, a[2] as number, a[3] as number, a[4] as number)) { e.unreachable++; e.unreachableMs += ms; }
    }
    last = r;
    return r;
  } as Fn);

  // ---- re-route outcomes ----
  const rr = { searched: 0, none: 0, behind: 0, notBetter: 0, samePath: 0, taken: 0, forced: 0, late: 0 };
  const reroute = proto.maybeReroute;
  proto.maybeReroute = function (this: unknown, ...a: unknown[]) {
    const m = a[0] as Mover, at = m.rerouted, path = m.path, pi = m.pi;
    last = null;
    const n0 = sim.traffic.counters.reroutes + sim.traffic.counters.stuckReroutes, l0 = sim.rerouteLog.lateTried;
    const r = reroute.apply(this, a);
    if (m.rerouted === at) return r;
    rr.searched++;
    if (a[2]) rr.forced++;
    if (sim.rerouteLog.lateTried > l0) rr.late++;
    const alt = last as { path: number[]; cost: number } | null;
    if (sim.traffic.counters.reroutes + sim.traffic.counters.stuckReroutes > n0) rr.taken++;
    else if (!alt || alt.path.length < 2) rr.none++;
    else if (alt.cost >= 1e4) rr.behind++;
    else {
      rr.notBetter++;
      // the same way as now: the found path is the current one from the tile ahead on
      const rest = path.slice(pi * 2);
      if (rest.length === alt.path.length && rest.every((v, i) => v === alt.path[i])) rr.samePath++;
    }
    return r;
  };

  // ---- the day ----
  const tr = sim.traffic, c0 = { ...tr.counters };
  const travel = (st: number) => st === S.ToWork || st === S.ToHome || st === S.ToSite || st === S.ToVenue;
  const prev = new Map<number, number>();
  for (const c of w.citizens.values()) prev.set(c.id, c.state);
  let vSum = 0, qSum = 0, spSum = 0, parkedSum = 0, trips = 0, tripTicks = 0, stuckSum = 0, stuckSamples = 0, simMs = 0;
  const n = DAY;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    game.step();
    simMs += performance.now() - t;
    vSum += tr.lastVehicles; qSum += tr.lastQueued; spSum += tr.lastSpeedPct * tr.lastVehicles; parkedSum += sim.parkedCars;
    for (const c of w.citizens.values()) {
      const ps = prev.get(c.id);
      if (ps !== undefined && travel(ps) && !travel(c.state)) { trips++; tripTicks += w.tick - c.tripStart; }
      if (ps !== c.state) prev.set(c.id, c.state);
    }
    if (i % 100 === 0) {
      let s = 0;
      for (const c of w.citizens.values()) if (c.leg?.drive && c.lane >= 0 && c.stuck >= TRAFFIC_TUNING.stuckLimit) s++;
      for (const v of w.vehicles.values()) if (v.lane >= 0 && v.stuck >= TRAFFIC_TUNING.stuckLimit) s++;
      stuckSum += s; stuckSamples++;
    }
  }
  let employed = 0;
  for (const c of w.citizens.values()) if (c.job) employed++;
  const counters: Record<string, number> = {};
  for (const [k, v] of Object.entries(tr.counters)) counters[k] = v - (c0 as Record<string, number>)[k];
  const astarMs = Object.values(rows).reduce((s, e) => s + e.ms, 0);
  const out = {
    label, set, fill, ticks: n, simMsPerTick: simMs / n, astarMsPerTick: astarMs / n,
    traffic: { queuedPct: (100 * qSum) / vSum, speedPct: (100 * spSum) / vSum, vehiclesMean: vSum / n, parkedMean: parkedSum / n, trips, tripMeanTicks: tripTicks / trips, stuckMean: stuckSum / stuckSamples },
    giveUps: counters.stuckHome + counters.stuckDespawn + counters.abandonKerb + counters.abandonDespawn + counters.garageGiveUp,
    counters, reroutes: rr, byCaller: rows,
    end: { citizens: w.citizens.size, employed, vehicles: w.vehicles.size },
  };
  console.log(`day: sim ${out.simMsPerTick.toFixed(2)} ms/tick, A* ${out.astarMsPerTick.toFixed(2)} ms/tick`);
  console.log(`traffic: queued ${out.traffic.queuedPct.toFixed(1)}%, speed ${out.traffic.speedPct.toFixed(1)}%, vehicles ${out.traffic.vehiclesMean.toFixed(0)}, parked ${out.traffic.parkedMean.toFixed(0)}, trips ${trips} mean ${out.traffic.tripMeanTicks.toFixed(1)} ticks, stuck ${out.traffic.stuckMean.toFixed(1)}, give-ups ${out.giveUps}`);
  console.log(`re-routes: ${JSON.stringify(rr)}`);
  for (const [c, e] of Object.entries(rows).sort((a, b) => b[1].ms - a[1].ms)) {
    console.log(`  ${c.padEnd(13)} ${String(e.calls).padStart(6)} calls ${e.ms.toFixed(0).padStart(6)} ms, ${(e.expanded / e.calls).toFixed(0)} nodes/call; failed ${e.failed} (${e.failedMs.toFixed(0)} ms), whole budget ${e.budget} (${e.budgetMs.toFixed(0)} ms)${reachCheck ? `, unreachable ${e.unreachable} (${e.unreachableMs.toFixed(0)} ms)` : ''}`);
  }
  console.log(`end: ${JSON.stringify(out.end)}; counters ${JSON.stringify(counters)}`);
  const json = arg('json', '');
  if (json) { writeFileSync(json, JSON.stringify(out, null, 1)); console.log(`summary: ${json}`); }
  process.exit(0);
}

/** Could a driver get from (sx, sy) to (gx, gy) at all, with no node budget? (The probe's check, not the game's.) */
function reachable(w: World, sx: number, sy: number, gx: number, gy: number): boolean {
  return !!findPath(w, sx, sy, (x, y) => x === gx && y === gy, 1e7);
}
