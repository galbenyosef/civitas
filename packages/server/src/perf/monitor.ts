/**
 * The server's performance monitor (docs/perf.md). Node only: index.ts mounts it; the pure phase timings it reports
 * live in perf/phases.ts (worker-safe) and are kept by the game.
 *
 *  - `GET /api/perf`: the full picture as JSON: tick avg/p95/max over the last minute, every phase's avg/p95/max and
 *    share, the last 60 s of tick times, the ten worst ticks with their phase breakdown and game hour, the long-tick
 *    traces (ticks over PERF_TRACE_MS, with the work counters), event-loop lag, GC pauses, heap and RSS, clients.
 *  - `POST /api/perf/profile?ms=5000`: an inspector CPU profile of this process for that span, written to
 *    `data/perf/<label>-<time>.cpuprofile` and summarised (top self-time functions) in the response.
 *  - `GET /metrics`: Prometheus text exposition, written by hand (no dependency).
 *  On a main server with children (demos, test cities), `?demo=<id>` or `?city=<n>` on the two API routes proxies to
 *  that child, and `/metrics` appends every running child's metrics to its own.
 */
import { PerformanceObserver, monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TICK_MS, TICKS_PER_DAY } from '@msimcity/shared';
import { PHASES, COUNTERS, type PhaseStats, type PhaseStatsSummary } from './phases';
import { summarizeProfile, type ProfileSummary, type Profile } from '../loadtest/profile-summary';

export interface MonitorSources {
  perf: PhaseStats;
  world: () => { label: string; kind: 'live' | 'demo' | 'city'; citizens: number; vehicles: number; clients: number; day: number; tick: number; ready: boolean };
  /** where profiles are written (data/perf) */
  dataDir: string;
  /** a main server's running children: label, kind and port (testcities.ts); none on a child */
  children?: () => { id: string; kind: 'demo' | 'city'; port: number }[];
}

export interface PerfSnapshot extends PhaseStatsSummary {
  pid: number; uptime: number; world: ReturnType<MonitorSources['world']>; hour: number; budgetMs: number; traceMs: number;
  recent: { ms: number[]; ticks: number[]; at: number[] };
  loop: { mean: number; p95: number; max: number };
  gc: { count: number; ms: number; max: number; minute: { count: number; ms: number; max: number } };
  mem: { rss: number; heapUsed: number; heapTotal: number; external: number };
  save: { count: number; lastMs: number; maxMs: number };
  profiling: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const MAX_PROFILE_MS = 60_000;
/** the event-loop probe's interval, ms */
const LAG_RES = 20;

export class PerfMonitor {
  private lag: IntervalHistogram;
  private gcAll = { count: 0, ms: 0, max: 0 };
  /** GC pauses of the last minute: (time, ms) */
  private gcRecent: [number, number][] = [];
  private gcObs: PerformanceObserver | null = null;
  save = { count: 0, lastMs: 0, maxMs: 0 };
  private profiling = false;
  private started = Date.now();

  constructor(private src: MonitorSources) {
    this.lag = monitorEventLoopDelay({ resolution: LAG_RES });
    this.lag.enable();
    try {
      this.gcObs = new PerformanceObserver((list) => {
        const now = Date.now();
        for (const e of list.getEntries()) {
          this.gcAll.count++; this.gcAll.ms += e.duration; if (e.duration > this.gcAll.max) this.gcAll.max = e.duration;
          this.gcRecent.push([now, e.duration]);
        }
        while (this.gcRecent.length && this.gcRecent[0][0] < now - 60_000) this.gcRecent.shift();
      });
      this.gcObs.observe({ entryTypes: ['gc'] });
    } catch { this.gcObs = null; }
  }

  /** time a world save for the readout (index.ts wraps saveWorld) */
  timeSave<T>(f: () => T): T {
    const t0 = performance.now();
    try { return f(); } finally { const ms = performance.now() - t0; this.save.count++; this.save.lastMs = r2(ms); if (ms > this.save.maxMs) this.save.maxMs = r2(ms); }
  }

  snapshot(): PerfSnapshot {
    const perf = this.src.perf, world = this.src.world();
    const minute = { count: 0, ms: 0, max: 0 };
    const cut = Date.now() - 60_000;
    for (const [t, ms] of this.gcRecent) if (t >= cut) { minute.count++; minute.ms += ms; if (ms > minute.max) minute.max = ms; }
    const m = process.memoryUsage();
    // the histogram's samples include the probe's own interval (LAG_RES): what is left is how late the loop ran it
    const toMs = (ns: number) => r2(Math.max(0, ns / 1e6 - LAG_RES));
    const snap: PerfSnapshot = {
      ...perf.summary(),
      pid: process.pid, uptime: r2((Date.now() - this.started) / 1000), world, hour: r2(((world.tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 24), budgetMs: TICK_MS, traceMs: perf.traceMs,
      recent: perf.recent(),
      loop: { mean: toMs(this.lag.mean), p95: toMs(this.lag.percentile(95)), max: toMs(this.lag.max) },
      gc: { count: this.gcAll.count, ms: r2(this.gcAll.ms), max: r2(this.gcAll.max), minute: { count: minute.count, ms: r2(minute.ms), max: r2(minute.max) } },
      mem: { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external },
      save: { ...this.save },
      profiling: this.profiling,
    };
    this.lag.reset(); // the lag figures are per scrape / per look: the window is since the last one
    return snap;
  }

  /** An inspector CPU profile of this process for `ms`, written under dataDir/perf and summarised. One at a time. */
  async profile(ms: number, label: string): Promise<{ file: string; ms: number; summary: ProfileSummary }> {
    if (this.profiling) throw new Error('a profile is already running');
    ms = Math.max(200, Math.min(MAX_PROFILE_MS, Math.floor(ms) || 5000));
    this.profiling = true;
    const session = new Session();
    try {
      session.connect();
      const post = <T = unknown>(method: string, params?: object) => new Promise<T>((ok, fail) => session.post(method, params ?? {}, (err, res) => (err ? fail(err) : ok(res as T))));
      await post('Profiler.enable');
      await post('Profiler.setSamplingInterval', { interval: 200 });
      await post('Profiler.start');
      await new Promise((r) => setTimeout(r, ms));
      const { profile } = await post<{ profile: Profile }>('Profiler.stop');
      await post('Profiler.disable');
      const dir = join(this.src.dataDir, 'perf');
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = join(dir, `${label.replace(/[^\w-]+/g, '_')}-${stamp}.cpuprofile`);
      writeFileSync(file, JSON.stringify(profile));
      return { file, ms, summary: summarizeProfile(profile, 15) };
    } finally {
      session.disconnect();
      this.profiling = false;
    }
  }

  /** Prometheus text exposition for this process (one `world` label per series). */
  metrics(): string {
    const s = this.snapshot();
    const w = s.world;
    const L = `world="${w.kind === 'live' ? 'live' : `${w.kind}:${w.label}`}"`;
    const out: string[] = [];
    const g = (name: string, help: string, type: 'gauge' | 'counter', rows: [string, number][]) => {
      out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [labels, v] of rows) out.push(`${name}{${L}${labels ? ',' + labels : ''}} ${Number.isFinite(v) ? v : 0}`);
    };
    g('civitas_up', 'the world is running and taking clients (1) or still filling (0)', 'gauge', [['', w.ready ? 1 : 0]]);
    g('civitas_tick_ms', 'loop time over the last minute, ms: the simulation ticks, the systems and the network flush', 'gauge', [['stat="avg"', s.tick.avg], ['stat="p95"', s.tick.p95], ['stat="max"', s.tick.max]]);
    g('civitas_tick_budget_ms', 'the tick interval (TICK_MS)', 'gauge', [['', TICK_MS]]);
    g('civitas_ticks_total', 'loops run since start', 'counter', [['', s.ticksTotal]]);
    g('civitas_long_ticks_total', `loops over the trace threshold (${s.traceMs} ms) since start`, 'counter', [['', s.longTotal]]);
    g('civitas_phase_ms', 'time per loop in each phase over the last minute, ms', 'gauge', PHASES.flatMap((p) => [[`phase="${p}",stat="avg"`, s.phases[p].avg], [`phase="${p}",stat="p95"`, s.phases[p].p95], [`phase="${p}",stat="max"`, s.phases[p].max]] as [string, number][]));
    g('civitas_phase_share', 'share of the loop time in each phase over the last minute, percent', 'gauge', PHASES.map((p) => [`phase="${p}"`, s.phases[p].share] as [string, number]));
    g('civitas_citizens', 'citizens in the world', 'gauge', [['', w.citizens]]);
    g('civitas_vehicles', 'vehicles on the road at the last stats', 'gauge', [['', w.vehicles]]);
    g('civitas_clients', 'connected clients', 'gauge', [['', w.clients]]);
    g('civitas_agents_moving', 'moving citizens per tick, last minute (the agents a client could be streamed)', 'gauge', [['', s.rates.moving]]);
    g('civitas_stream_per_second', 'what went to clients per second over the last minute: agents, messages, bytes', 'gauge', [['what="agents"', s.rates.agents], ['what="messages"', s.rates.msgs], ['what="bytes"', s.rates.bytes]]);
    g('civitas_search_per_second', 'route searches and A* nodes expanded per second over the last minute', 'gauge', [['what="routes"', s.rates.routes], ['what="nodes"', s.rates.nodes]]);
    g('civitas_event_loop_lag_ms', 'event-loop delay since the last scrape, ms (perf_hooks monitorEventLoopDelay)', 'gauge', [['stat="mean"', s.loop.mean], ['stat="p95"', s.loop.p95], ['stat="max"', s.loop.max]]);
    g('civitas_gc_pauses_total', 'garbage-collection pauses since start', 'counter', [['', s.gc.count]]);
    g('civitas_gc_ms_total', 'time in garbage collection since start, ms', 'counter', [['', s.gc.ms]]);
    g('civitas_gc_pause_max_ms', 'the longest GC pause of the last minute, ms', 'gauge', [['', s.gc.minute.max]]);
    g('civitas_memory_bytes', 'process memory: rss, heap used, heap total, external', 'gauge', [['what="rss"', s.mem.rss], ['what="heap_used"', s.mem.heapUsed], ['what="heap_total"', s.mem.heapTotal], ['what="external"', s.mem.external]]);
    g('civitas_save_ms', 'the last world save and the longest, ms', 'gauge', [['stat="last"', s.save.lastMs], ['stat="max"', s.save.maxMs]]);
    g('civitas_saves_total', 'world saves since start', 'counter', [['', s.save.count]]);
    g('civitas_game_day', 'the game day', 'gauge', [['', w.day]]);
    g('civitas_game_hour', 'the hour of the game day', 'gauge', [['', s.hour]]);
    g('civitas_uptime_seconds', 'seconds since this process started', 'gauge', [['', s.uptime]]);
    return out.join('\n') + '\n';
  }

  /** Answers /api/perf, /api/perf/profile and /metrics (with the children's); false for any other URL. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    if (path !== '/api/perf' && path !== '/api/perf/profile' && path !== '/metrics') return false;
    const json = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': '*' }); res.end(); return true; }
    if (path === '/metrics') {
      void (async () => {
        let text = this.metrics();
        for (const c of this.src.children?.() ?? []) {
          try {
            const r = await fetch(`http://127.0.0.1:${c.port}/metrics`, { signal: AbortSignal.timeout(1500) });
            if (r.ok) text += await r.text();
          } catch { /* a child that is starting or gone: nothing from it this scrape */ }
        }
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' });
        res.end(text);
      })();
      return true;
    }
    // a child's figures through the parent: ?demo=<id> or ?city=<n>
    const child = this.childFor(url.searchParams.get('demo'), url.searchParams.get('city'));
    if (child === undefined) { json(404, { error: 'no such running demo or test city' }); return true; }
    if (child) {
      const q = path === '/api/perf/profile' ? `?ms=${encodeURIComponent(url.searchParams.get('ms') ?? '5000')}` : '';
      fetch(`http://127.0.0.1:${child.port}${path}${q}`, { method: req.method, signal: AbortSignal.timeout(MAX_PROFILE_MS + 5000) })
        .then(async (r) => { res.writeHead(r.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(await r.text()); })
        .catch((e: Error) => json(502, { error: `the child did not answer: ${e.message}` }));
      return true;
    }
    if (path === '/api/perf') { json(200, this.snapshot()); return true; }
    if (req.method !== 'POST') { json(405, { error: 'POST /api/perf/profile?ms=5000' }); return true; }
    const ms = Number(url.searchParams.get('ms') ?? 5000);
    const w = this.src.world();
    this.profile(ms, w.kind === 'live' ? 'live' : `${w.kind}-${w.label}`).then((r) => json(200, r), (e: Error) => json(this.profiling ? 409 : 500, { error: e.message }));
    return true;
  }

  /** null: this process; undefined: asked for a child that is not running */
  private childFor(demo: string | null, city: string | null) {
    if (!demo && !city) return null;
    const kids = this.src.children?.() ?? [];
    return kids.find((c) => (demo ? c.kind === 'demo' && c.id === demo : c.kind === 'city' && c.id === city));
  }
}

export { COUNTERS };
