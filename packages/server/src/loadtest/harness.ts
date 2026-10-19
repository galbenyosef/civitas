import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from 'node:inspector';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICK_MS, chunkKey, chunkOf, isRoad, packTile, Terrain, planStructure, workOf, MOTORWAY_KIND, DEFAULT_TAX } from '@msimcity/shared';
import { emptyStats } from '../world';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { Issues } from '../sim/issues';
import { Net } from '../net';
import { seedCity, DISTRICT, type CityLayout } from './cities';
import { layBusNetwork } from './ab';

/**
 * Load-test harness: build a test city, fast-forward until the population settles, then measure one full game day
 * tick by tick (simulation + network flush, exactly as the server's main loop runs them, without timers).
 *
 * Three fake clients receive the real `Net.flush()` output: one subscribed to every chunk of the city, one to the
 * chunks the central district overlaps, and one to the window the real client keeps when zoomed in on a district
 * (client/src/main.ts streamWindow(): the view's ground footprint plus a chunk of margin, 4×4 chunks at dist ≤ 24
 * looking at the origin; until 2026-10-16 it was never less than 5×5). So the agent-stream bytes a player would download
 * are measured, not estimated. Their sockets just count bytes, so ws framing and syscalls are not in flush time.
 */
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
const BUDGET_AVG_MS = 50, BUDGET_MAX_MS = 200;
const VIEW_CHUNKS_PER_SIDE = 4; // client/src/main.ts streamWindow() at dist ≤ 24 with the target at the origin
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

interface Args {
  districts: number; days: number; built: number; seed: number; gap: number; lots: boolean;
  profile: string | null; json: string | null; append: boolean; doc: string; note: string;
  /** --bus N: a bus depot and two lines (twelve stops) in every district, N buses per line (ab.ts layBusNetwork) */
  bus: number;
  /** --gateways: a motorway connection at the west and east road ends (sim/gateways.ts); newcomers and leavers use them after the fill */
  gateways: boolean;
}
function parseArgs(argv: string[]): Args {
  const get = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    districts: Math.max(1, Number(get('districts') ?? 1) | 0),
    days: Math.min(4, Math.max(0.25, Number(get('days') ?? 2))),
    built: Number(get('built') ?? 3) | 0,
    seed: Number(get('seed') ?? 1),
    gap: Math.max(0, Number(get('gap') ?? 2) | 0),
    lots: !argv.includes('--no-lots'),
    profile: get('profile') ?? null,
    json: get('json') ?? null,
    append: !argv.includes('--no-append'),
    doc: resolve(get('doc') ?? join(repoRoot, 'docs/load-tests.md')),
    note: get('note') ?? '',
    bus: Math.max(0, Number(get('bus') ?? 0) | 0),
    gateways: argv.includes('--gateways'),
  };
}

/** A socket that only counts what would have been sent, split into the agent stream and everything else. */
/** a fake client connection (transport.ts Conn) that counts what Net.flush() sends it */
class CountingSocket {
  open = true;
  agentBytes = 0; otherBytes = 0; agentMsgs = 0;
  send(s: string) {
    const n = Buffer.byteLength(s);
    if (s.startsWith('{"t":"citizens"')) { this.agentBytes += n; this.agentMsgs++; } else this.otherBytes += n;
  }
  reset() { this.agentBytes = 0; this.otherBytes = 0; this.agentMsgs = 0; }
  close() {}
  onMessage() {}
  onClose() {}
}
function chunksOver(x0: number, y0: number, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let cy = chunkOf(y0); cy <= chunkOf(y0 + h - 1); cy++) for (let cx = chunkOf(x0); cx <= chunkOf(x0 + w - 1); cx++) out.push([cx, cy]);
  return out;
}

type PfCounters = Record<'findPath' | 'findBest' | 'findRoute', number>;
const g = globalThis as unknown as { __pfCalls?: PfCounters; __pfMs?: PfCounters; gc?: () => void };
const pfSnap = (): PfCounters | null => (g.__pfCalls ? { ...g.__pfCalls } : null);
const pfMsSnap = (): PfCounters | null => (g.__pfMs ? { ...g.__pfMs } : null);

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const mb = (b: number) => b / 1048576;
const f1 = (v: number) => v.toFixed(1), f2 = (v: number) => v.toFixed(2);

export async function main(argv: string[]) {
  const a = parseArgs(argv);
  const log = (s: string) => process.stderr.write(s + '\n');

  // ---- build ----------------------------------------------------------------------------
  const tb = performance.now();
  const w = new World(a.seed);
  const layout: CityLayout = seedCity(w, { districts: a.districts, built: a.built, lots: a.lots, gap: a.gap });
  const busNets = a.bus ? layout.districts.map((d) => layBusNetwork(w, d.x, d.y)) : [];
  for (const id of w.parcels.keys()) w.recountRoads(id);
  if (a.gateways) log(`[loadtest] motorway connections: ${placeMotorways(w).join(', ') || 'none placed'}`);
  const sim = new Simulation(w);
  const issues = new Issues(w, sim); // issue bubbles (sim/issues.ts), as game.ts runs them: part of the sim time below
  busNets.forEach((net, di) => net.lines.forEach((stops, i) => {
    const r = sim.transit.saveLine('sys', { number: di * 2 + i + 1, colour: i ? 0x2f8fd6 : 0xd94f4f, stops, loop: i === 0, vehicles: a.bus });
    if (typeof r === 'string') throw new Error(`district ${di} line ${i + 1}: ${r}`);
  }));
  if (a.bus) log(`[loadtest] bus network: ${w.transitLines.size} lines, ${a.bus} buses each`);
  const net = new Net(w, sim, { onConnection() {} }, { devTools: true, sandbox: false });
  const clients = (net as unknown as { clients: Set<unknown> }).clients;
  const mkClient = (name: string, chunks: [number, number][]) => {
    const ws = new CountingSocket();
    const player = w.getOrCreatePlayer(`loadtest-${name}`, `loadtest ${name}`, 0);
    clients.add({ conn: ws, player, subs: new Set(chunks.map(([cx, cy]) => chunkKey(cx, cy))), lastHint: 0 });
    return ws;
  };
  const cityChunks = chunksOver(layout.x0, layout.y0, layout.span, layout.span);
  const mid = layout.districts[Math.floor(layout.n / 2) * layout.n + Math.floor(layout.n / 2)];
  const districtChunks = chunksOver(mid.x, mid.y, DISTRICT, DISTRICT);
  const cityWs = mkClient('city', cityChunks);
  const distWs = mkClient('district', districtChunks);
  const viewChunks = chunksOver(-(VIEW_CHUNKS_PER_SIDE / 2) * 32, -(VIEW_CHUNKS_PER_SIDE / 2) * 32, VIEW_CHUNKS_PER_SIDE * 32, VIEW_CHUNKS_PER_SIDE * 32);
  const viewWs = mkClient('view', viewChunks);
  log(`[loadtest] ${a.districts}×${a.districts} districts, span ${layout.span} tiles, ${w.buildings.size} buildings, ${cityChunks.length} chunks; built in ${f1(performance.now() - tb)} ms`);
  log(`[loadtest] pathfinding counters ${g.__pfCalls ? 'on' : 'off (run without --no-count to enable)'}`);

  // ---- fill: fast-forward until the population stops growing --------------------------------
  const tf = performance.now();
  const maxFill = Math.round(a.days * DAY);
  let prevPop = 0, flat = 0, hours = 0, fillTicks = 0;
  w.filling = true; // newcomers move straight in while the city fills (sim/gateways.ts), as in a test city
  for (; fillTicks < maxFill; fillTicks++) {
    sim.tick(); issues.tick();
    net.flush();
    if (w.tick % TPH !== 0) continue;
    hours++;
    const pop = w.citizens.size;
    flat = pop - prevPop <= Math.max(3, pop * 0.005) ? flat + 1 : 0;
    prevPop = pop;
    if (hours % 4 === 0) log(`[loadtest] fill hour ${hours}: ${pop} citizens, ${sim.traffic.lastVehicles} cars, ${f1((performance.now() - tf) / 1000)} s`);
    if (hours >= 6 && flat >= 3) { fillTicks++; break; }
  }
  const fillMs = performance.now() - tf;
  w.filling = false;
  const settled = flat >= 3;
  log(`[loadtest] fill: ${fillTicks} ticks (${f2(fillTicks / DAY)} days) in ${f1(fillMs / 1000)} s, ${w.citizens.size} citizens, ${settled ? 'settled' : 'still growing at the fill cap'}`);

  // ---- measure one full game day ------------------------------------------------------------
  g.gc?.();
  cityWs.reset(); distWs.reset(); viewWs.reset();
  const N = DAY;
  const simMs = new Float64Array(N), flushMs = new Float64Array(N), hourOf = new Uint8Array(N);
  const veh = new Uint32Array(N), queued = new Uint32Array(N), routes = new Uint32Array(N), bfs = new Uint32Array(N);
  const viewB = new Float64Array(N);
  const cityB = new Float64Array(N), distB = new Float64Array(N), cityAll = new Float64Array(N), distAll = new Float64Array(N);
  let agentSamples = 0, agentSum = 0, agentPeak = 0, heapPeak = 0, popMin = Infinity, popMax = 0;
  const pf0 = pfSnap(), pfMs0 = pfMsSnap();
  let session: Session | null = null;
  if (a.profile) {
    session = new Session();
    session.connect();
    await new Promise<void>((r) => session!.post('Profiler.enable', () => session!.post('Profiler.start', () => r())));
  }
  const tm = performance.now();
  issues.ms = 0; issues.ticks = 0;
  for (let i = 0; i < N; i++) {
    const before = g.__pfCalls ? g.__pfCalls.findRoute : 0, beforeB = g.__pfCalls ? g.__pfCalls.findPath + g.__pfCalls.findBest : 0;
    const va = viewWs.agentBytes, ca = cityWs.agentBytes, da = distWs.agentBytes, co = cityWs.otherBytes, dO = distWs.otherBytes;
    const t0 = performance.now();
    sim.tick(); issues.tick();
    const t1 = performance.now();
    net.flush();
    const t2 = performance.now();
    simMs[i] = t1 - t0; flushMs[i] = t2 - t1;
    hourOf[i] = Math.floor((w.tick % DAY) / TPH);
    veh[i] = sim.traffic.lastVehicles; queued[i] = sim.traffic.lastQueued;
    if (g.__pfCalls) { routes[i] = g.__pfCalls.findRoute - before; bfs[i] = g.__pfCalls.findPath + g.__pfCalls.findBest - beforeB; }
    viewB[i] = viewWs.agentBytes - va; cityB[i] = cityWs.agentBytes - ca; distB[i] = distWs.agentBytes - da;
    cityAll[i] = cityB[i] + cityWs.otherBytes - co; distAll[i] = distB[i] + distWs.otherBytes - dO;
    if (i % 10 === 0) {
      let n = 0;
      for (const _ of sim.agents()) n++;
      agentSamples++; agentSum += n; agentPeak = Math.max(agentPeak, n);
      const pop = w.citizens.size; popMin = Math.min(popMin, pop); popMax = Math.max(popMax, pop);
    }
    if (i % 100 === 0) heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  }
  const measureMs = performance.now() - tm;
  log(`[loadtest] issue bubbles: ${(issues.ms / Math.max(1, issues.ticks)).toFixed(3)} ms per tick on average (${issues.ticks} ticks)`);
  if (session) {
    const prof = await new Promise<unknown>((r, j) => session!.post('Profiler.stop', (err, res) => (err ? j(err) : r(res.profile))));
    mkdirSync(dirname(resolve(a.profile!)), { recursive: true });
    writeFileSync(resolve(a.profile!), JSON.stringify(prof));
    session.disconnect();
    log(`[loadtest] wrote CPU profile of the measured day to ${resolve(a.profile!)}`);
  }
  const pf1 = pfSnap(), pfMs1 = pfMsSnap();
  const mem = process.memoryUsage();
  heapPeak = Math.max(heapPeak, mem.heapUsed);

  // hover and subscribe costs at the end of the day (outside the tick loop)
  const blds = [...w.buildings.values()];
  const sample = blds.filter((_, i) => i % Math.max(1, Math.floor(blds.length / 50)) === 0).slice(0, 50);
  const th = performance.now();
  for (const b of sample) sim.describe(b);
  const hoverMs = (performance.now() - th) / Math.max(1, sample.length);
  const subWs = new CountingSocket();
  const subClient = { conn: subWs, player: w.getOrCreatePlayer('loadtest-sub', 'loadtest sub', 0), subs: new Set<string>(), lastHint: 0 };
  const ts = performance.now();
  (net as unknown as { subscribe(c: unknown, ch: [number, number][]): void }).subscribe(subClient, districtChunks);
  const subMs = performance.now() - ts;
  const subBytes = subWs.agentBytes + subWs.otherBytes;

  // ---- results ------------------------------------------------------------------------------
  const tot = Array.from(simMs, (v, i) => v + flushMs[i]);
  const sorted = [...tot].sort((x, y) => x - y);
  const peakVeh = Math.max(...veh);
  const peakAt = veh.indexOf(peakVeh);
  const queuedAtPeak = peakVeh ? queued[peakAt] / peakVeh : 0;
  let qs = 0, vs = 0;
  for (let i = 0; i < N; i++) { qs += queued[i]; vs += veh[i]; }
  const res = {
    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    districts: a.districts, seed: a.seed, built: a.built, gap: a.gap, lots: a.lots,
    span: layout.span, buildings: w.buildings.size, chunks: cityChunks.length, districtChunks: districtChunks.length,
    viewChunks: viewChunks.length, cityInView: cityChunks.every(([cx, cy]) => viewChunks.some(([vx, vy]) => vx === cx && vy === cy)),
    fillDays: fillTicks / DAY, settled, fillSec: fillMs / 1000, measureSec: measureMs / 1000,
    citizens: w.citizens.size, citizensMin: popMin, citizensMax: popMax, jobs: sim.jobs, employed: sim.employed,
    peakVehicles: peakVeh, peakHour: hourOf[peakAt], queuedAtPeak, queuedShare: vs ? qs / vs : 0,
    agentsAvg: agentSamples ? agentSum / agentSamples : 0, agentsPeak: agentPeak,
    tickAvg: avg(tot), tickP50: pct(sorted, 0.5), tickP95: pct(sorted, 0.95), tickP99: pct(sorted, 0.99), tickMax: sorted[sorted.length - 1],
    simAvg: avg(Array.from(simMs)), flushAvg: avg(Array.from(flushMs)), simMax: Math.max(...simMs), flushMax: Math.max(...flushMs),
    ticksOver200: tot.filter((v) => v > BUDGET_MAX_MS).length, ticksOverTick: tot.filter((v) => v > TICK_MS).length,
    heapMB: mb(mem.heapUsed), heapPeakMB: mb(heapPeak), rssMB: mb(mem.rss), maxRssMB: process.resourceUsage().maxRSS / 1024,
    viewAgentBytesTick: avg(Array.from(viewB)), viewAgentBytesPeak: Math.max(...viewB),
    cityAgentBytesTick: avg(Array.from(cityB)), districtAgentBytesTick: avg(Array.from(distB)),
    cityAllBytesTick: avg(Array.from(cityAll)), districtAllBytesTick: avg(Array.from(distAll)),
    cityAgentBytesPeak: Math.max(...cityB), districtAgentBytesPeak: Math.max(...distB),
    calls: pf0 && pf1 ? {
      findRoute: (pf1.findRoute - pf0.findRoute) / N, findPath: (pf1.findPath - pf0.findPath) / N, findBest: (pf1.findBest - pf0.findBest) / N,
      routeMaxTick: Math.max(...routes), bfsMaxTick: Math.max(...bfs),
    } : null,
    pfShare: pfMs0 && pfMs1 ? {
      findRoute: (pfMs1.findRoute - pfMs0.findRoute) / measureMs, findPath: (pfMs1.findPath - pfMs0.findPath) / measureMs, findBest: (pfMs1.findBest - pfMs0.findBest) / measureMs,
    } : null,
    hoverMs, subscribeMs: subMs, subscribeBytes: subBytes,
    overBudget: avg(tot) > BUDGET_AVG_MS || sorted[sorted.length - 1] > BUDGET_MAX_MS,
    hours: [] as { h: number; avg: number; p95: number; max: number; sim: number; flush: number; veh: number; q: number; routes: number; cityB: number; distB: number }[],
    note: a.note,
  };
  for (let h = 0; h < 24; h++) {
    const idx: number[] = [];
    for (let i = 0; i < N; i++) if (hourOf[i] === h) idx.push(i);
    if (!idx.length) continue;
    const t = idx.map((i) => tot[i]).sort((x, y) => x - y);
    const hv = Math.max(...idx.map((i) => veh[i]));
    res.hours.push({
      h, avg: avg(t), p95: pct(t, 0.95), max: t[t.length - 1],
      sim: avg(idx.map((i) => simMs[i])), flush: avg(idx.map((i) => flushMs[i])),
      veh: hv, q: avg(idx.map((i) => (veh[i] ? queued[i] / veh[i] : 0))), routes: avg(idx.map((i) => routes[i])),
      cityB: avg(idx.map((i) => cityB[i])), distB: avg(idx.map((i) => distB[i])),
    });
  }

  // ---- print ----------------------------------------------------------------------------
  const out: string[] = [];
  out.push('');
  out.push(`Civitas load test: ${a.districts}×${a.districts} districts (${layout.span}×${layout.span} tiles), seed ${a.seed}, built=${a.built}`);
  out.push(`fill ${f2(res.fillDays)} days (${settled ? 'settled' : 'not settled'}), citizens ${res.citizens} (day range ${popMin}–${popMax}), jobs ${res.jobs}, employed ${res.employed}`);
  out.push('');
  out.push('hour  avg ms  p95 ms  max ms  sim ms  flush ms  peak cars  queued  A*/tick  city B/tick  district B/tick');
  for (const r of res.hours) {
    out.push(`${String(r.h).padStart(4)}  ${f2(r.avg).padStart(6)}  ${f2(r.p95).padStart(6)}  ${f1(r.max).padStart(6)}  ${f2(r.sim).padStart(6)}  ${f2(r.flush).padStart(8)}  ${String(r.veh).padStart(9)}  ${(r.q * 100).toFixed(0).padStart(5)}%  ${f2(r.routes).padStart(7)}  ${r.cityB.toFixed(0).padStart(11)}  ${r.distB.toFixed(0).padStart(15)}`);
  }
  out.push('');
  out.push(`tick ms: avg ${f2(res.tickAvg)}  p50 ${f2(res.tickP50)}  p95 ${f2(res.tickP95)}  p99 ${f2(res.tickP99)}  max ${f1(res.tickMax)}  (sim avg ${f2(res.simAvg)}, flush avg ${f2(res.flushAvg)}); ticks > ${TICK_MS} ms: ${res.ticksOverTick}`);
  out.push(`vehicles peak ${res.peakVehicles} at hour ${res.peakHour} (${(res.queuedAtPeak * 100).toFixed(0)}% queued), queued share over the day ${(res.queuedShare * 100).toFixed(0)}%; agents in stream avg ${res.agentsAvg.toFixed(0)}, peak ${res.agentsPeak}`);
  out.push(`memory: heap ${f1(res.heapMB)} MB (peak ${f1(res.heapPeakMB)}), RSS ${f1(res.rssMB)} MB (max ${f1(res.maxRssMB)})`);
  out.push(`agent stream: zoomed-in client view (${viewChunks.length} chunks${res.cityInView ? ', holds the whole city' : ''}) ${res.viewAgentBytesTick.toFixed(0)} B/tick = ${f1(res.viewAgentBytesTick * 5 / 1024)} KB/s (peak tick ${res.viewAgentBytesPeak})`);
  out.push(`agent stream: city ${res.cityAgentBytesTick.toFixed(0)} B/tick = ${f1(res.cityAgentBytesTick * 5 / 1024)} KB/s (peak tick ${res.cityAgentBytesPeak}); district (${districtChunks.length} chunks) ${res.districtAgentBytesTick.toFixed(0)} B/tick = ${f1(res.districtAgentBytesTick * 5 / 1024)} KB/s (peak tick ${res.districtAgentBytesPeak}); all messages city ${f1(res.cityAllBytesTick * 5 / 1024)} KB/s, district ${f1(res.districtAllBytesTick * 5 / 1024)} KB/s`);
  if (res.calls) out.push(`pathfinding per tick: findRoute ${f2(res.calls.findRoute)} (max ${res.calls.routeMaxTick}), findPath ${f2(res.calls.findPath)}, findBest ${f2(res.calls.findBest)} (BFS max ${res.calls.bfsMaxTick}); share of wall time: A* ${(res.pfShare!.findRoute * 100).toFixed(1)}%, findPath ${(res.pfShare!.findPath * 100).toFixed(1)}%, findBest ${(res.pfShare!.findBest * 100).toFixed(1)}%`);
  out.push(`hover describe() ${f2(res.hoverMs)} ms; district subscribe ${f1(res.subscribeMs)} ms, ${(res.subscribeBytes / 1024).toFixed(0)} KB`);
  out.push(`budget (avg ≤ ${BUDGET_AVG_MS} ms, max ≤ ${BUDGET_MAX_MS} ms): ${res.overBudget ? 'OVER' : 'ok'}`);
  console.log(out.join('\n'));

  if (a.json) { mkdirSync(dirname(resolve(a.json)), { recursive: true }); writeFileSync(resolve(a.json), JSON.stringify(res, null, 2)); }
  if (a.append) appendRow(a.doc, res);
}

function appendRow(doc: string, r: Record<string, any>) {
  if (!existsSync(doc)) {
    mkdirSync(dirname(doc), { recursive: true });
    const cpu = cpus()[0]?.model ?? 'unknown CPU';
    writeFileSync(doc, [
      '# Load tests',
      '',
      'How big a city gets before the 5 Hz simulation tick runs out of time.',
      '',
      '## Method',
      '',
      '`packages/server/src/loadtest/run.ts` builds a test city with `seedCity` (an N×N grid of Commons-style',
      '22×22 districts on one connected road grid, all owned by the Commons player, every zone pre-built to level 3),',
      'fast-forwards the real `Simulation` and `Net.flush()` in a tight loop until the population stops growing',
      '(under 0.5% an hour for three hours, at most `--days` game days), then times one full game day',
      '(2400 ticks) tick by tick. Tick time is `sim.tick()` plus `net.flush()`, as in the server main loop.',
      'Three fake clients receive the real flush output: one subscribed to every chunk of the city, one to the',
      'chunks the central district overlaps, and one to the window the real client keeps zoomed in (4×4 chunks,',
      '128×128 tiles, around the origin). Their sockets count bytes, so ws framing and syscalls are not included.',
      'Agent bytes are the `citizens` frames only. Chunks are 32 tiles and districts are not chunk-aligned, so the',
      'central district overlaps 4 chunks (64×64 tiles).',
      'Pathfinding calls are counted by a loader hook (`count-hook.mjs`) that wraps the exported search functions.',
      'Runs use `nice -n 10` beside the live dev servers, so absolute numbers are a little pessimistic.',
      '',
      'Budget at 5 Hz: average tick ≤ 50 ms and worst tick ≤ 200 ms (one tick interval).',
      '',
      `Machine: ${cpu}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB, Node ${process.version}, ${process.platform}.`,
      '',
      '```sh',
      'nice -n 10 npx tsx packages/server/src/loadtest/run.ts --districts 2 --days 3',
      '```',
      '',
      '## Runs',
      '',
      '| date (UTC) | districts | citizens | jobs | peak cars | queued at peak | avg ms | p95 ms | max ms | sim / flush avg ms | heap MB | RSS MB | agent B/tick city | agent B/tick central district (chunks) | agent B/tick min client view | A*/tick | BFS/tick | hover ms | budget | note |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '',
    ].join('\n'));
  }
  const c = r.calls;
  const row = [
    r.date, `${r.districts}×${r.districts}`, r.citizens, r.jobs, r.peakVehicles, `${(r.queuedAtPeak * 100).toFixed(0)}%`,
    f2(r.tickAvg), f2(r.tickP95), f1(r.tickMax), `${f2(r.simAvg)} / ${f2(r.flushAvg)}`, f1(r.heapMB), f1(r.rssMB),
    r.cityAgentBytesTick.toFixed(0), `${r.districtAgentBytesTick.toFixed(0)} (${r.districtChunks})`, r.viewAgentBytesTick.toFixed(0),
    c ? f2(c.findRoute) : 'n/a', c ? f2(c.findPath + c.findBest) : 'n/a', f2(r.hoverMs), r.overBudget ? '**over**' : 'ok',
    `${r.settled ? '' : 'not settled; '}fill ${f2(r.fillDays)} d${r.note ? '; ' + r.note : ''}`,
  ];
  appendFileSync(doc, `| ${row.join(' | ')} |\n`);
}

/**
 * --gateways: a motorway connection just outside the westmost and eastmost road tiles (the old through-traffic entries),
 * on a parcel of the Commons, built. Returns where they went.
 */
function placeMotorways(w: World): string[] {
  const out: string[] = [];
  const roads: [number, number][] = [];
  for (const ch of w.chunks.values()) for (let i = 0; i < ch.tiles.length; i++) if (isRoad(ch.tiles[i])) roads.push([ch.cx * 32 + (i % 32), ch.cy * 32 + Math.floor(i / 32)]);
  const west = roads.reduce((b, r) => (r[0] < b[0] ? r : b)), east = roads.reduce((b, r) => (r[0] > b[0] ? r : b));
  for (const [[rx, ry], dx, rot] of [[west, -1, 1], [east, 1, 3]] as [[number, number], number, number][]) {
    const x0 = dx < 0 ? rx - 4 : rx + 1;
    const parcel = { id: w.nextId++, owner: 'sys', name: 'Motorway junction', x: x0, y: ry - 2, w: 4, h: 5, taxRate: DEFAULT_TAX, stats: emptyStats() };
    w.parcels.set(parcel.id, parcel);
    for (let y = parcel.y; y < parcel.y + parcel.h; y++) for (let x = parcel.x; x < parcel.x + parcel.w; x++) {
      w.setParcelId(x, y, parcel.id);
      w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0));
    }
    const env = { tile: (x: number, y: number) => w.getTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y), land: () => null };
    const v = planStructure(MOTORWAY_KIND, rx + dx, ry, env, rot);
    if (v.ok) { w.placeStructure(v.placed, { work: workOf(MOTORWAY_KIND, 1), priority: 1, built: true }); out.push(`(${rx + dx}, ${ry})`); }
    else out.push(`(${rx + dx}, ${ry}) refused: ${v.reason}`);
  }
  return out;
}
