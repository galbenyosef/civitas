/**
 * Tick phase timings (docs/perf.md). Pure: `performance.now()` and typed arrays only, so the local-mode worker
 * (docs/local-mode.md) carries it too. `Simulation.tick()` and `Game.loop()` lap the clock between the subsystems;
 * the stats keep a rolling minute per phase (300 ticks at 5 Hz), the ten worst ticks with their breakdown, and a ring of
 * long-tick traces (a tick over `traceMs`, default twice TICK_MS) with the work counters of that tick. Nothing here
 * touches the simulation's state or its random draws: the game plays the same with the timers on or off.
 *
 * Cost: one `performance.now()` per lap (about 14 a tick) and a few array writes; measured in docs/perf.md.
 * `PERF_PHASES=0` turns the laps off (the whole-tick time is still kept, as before).
 */
import { TICK_MS, TICKS_PER_DAY } from '@msimcity/shared';
import { env } from '../env';

/** the phases of one tick, in the order they run */
export const PHASES = [
  'plan',      // newDay, schools, learning, the periodic stats, growth, spawn, entries
  'gateways',  // arrivals through gateways and the first settlers
  'traffic0',  // the traffic sweep and beginTick (the car grid)
  'citizens',  // moveCitizens: every citizen's step, the route and job searches inside it
  'vehicles',  // moveVehicles: buses, trucks, taxis and service vehicles
  'transit',   // transit lines (buses, rail, metro, ferries)
  'mobile',    // mobile services (vans, hearses, repair crews)
  'dispatch',  // the dispatcher (freight, builders, deliveries)
  'traffic1',  // traffic endTick (speeds, queues, the congestion field)
  'systems',   // airports, harbours, finance, issues, fires, adverts
  'flush',     // the network flush: agent buckets and the JSON to every client
  'history',   // the hourly history sample
] as const;
export type Phase = (typeof PHASES)[number];
export const N_PHASES = PHASES.length;
const IDX: Record<string, number> = Object.fromEntries(PHASES.map((p, i) => [p, i]));

/** work done in a tick: cheap counters the subsystems bump, read with the timings */
export const COUNTERS = ['routes', 'nodes', 'msgs', 'bytes', 'agents', 'moving', 'driving'] as const;
export type Counter = (typeof COUNTERS)[number];
export const N_COUNTERS = COUNTERS.length;
/** the index of each counter in `PhaseStats.cur` */
export const CI: Record<Counter, number> = { routes: 0, nodes: 1, msgs: 2, bytes: 3, agents: 4, moving: 5, driving: 6 };

export interface PhaseSummary { avg: number; p95: number; max: number; share: number }
export interface TickRecord {
  /** ms of the whole loop, and per phase */
  total: number; phases: number[];
  /** the game tick and its hour of the day */
  tick: number; hour: number;
  /** the wall clock (Date.now()) when the tick ended */
  at: number;
  counters: number[];
}
export interface PhaseStatsSummary {
  window: number;
  tick: { avg: number; p95: number; max: number; long: number; count: number };
  phases: Record<Phase, PhaseSummary>;
  /** per second over the window: routes searched, nodes expanded, messages, bytes, agents streamed */
  rates: Record<Counter, number>;
  worst: TickRecord[];
  traces: TickRecord[];
  longTotal: number;
  ticksTotal: number;
}

const WINDOW = 300;
const WORST = 10;
const TRACES = 50;
const now = () => performance.now();
const r2 = (v: number) => Math.round(v * 100) / 100;

export class PhaseStats {
  /** laps on (PERF_PHASES, default on); off keeps only the whole-tick time */
  enabled = env('PERF_PHASES') !== '0';
  /** a tick over this many ms is traced and logged (PERF_TRACE_MS, default 2 × TICK_MS) */
  traceMs = Number(env('PERF_TRACE_MS') ?? TICK_MS * 2) || TICK_MS * 2;
  /** called with the one-line description of a long tick (index.ts logs it) */
  onLong: ((line: string, rec: TickRecord) => void) | null = null;
  /** counters for the tick under way: the subsystems add to these (pathfinding, net) */
  readonly cur = new Float64Array(N_COUNTERS);
  private phase = new Float64Array(N_PHASES);
  private t0 = 0;
  // the rolling window: per tick the total, the phase times and the counters
  private totals = new Float64Array(WINDOW);
  private ring = new Float64Array(WINDOW * N_PHASES);
  private cring = new Float64Array(WINDOW * N_COUNTERS);
  private ticks = new Int32Array(WINDOW);
  private at = new Float64Array(WINDOW);
  private i = 0; private n = 0;
  private worst: TickRecord[] = [];
  private traces: TickRecord[] = [];
  longTotal = 0;
  ticksTotal = 0;
  /** `lap()` attributes the time since the last lap (or `begin()`) to the phase */
  begin() { if (this.enabled) this.t0 = now(); }
  lap(p: Phase) {
    if (!this.enabled) return;
    const t = now();
    this.phase[IDX[p]] += t - this.t0;
    this.t0 = t;
  }
  /** add to a work counter for the tick under way (hot paths index `cur` with CI directly) */
  count(c: Counter, v = 1) { this.cur[CI[c]] += v; }

  /** close the tick: `total` is the loop's ms, `tick` the game tick it ended on */
  endTick(total: number, tick: number) {
    const i = this.i;
    this.totals[i] = total; this.ticks[i] = tick; this.at[i] = Date.now();
    this.ring.set(this.phase, i * N_PHASES);
    this.cring.set(this.cur, i * N_COUNTERS);
    this.i = (i + 1) % WINDOW;
    if (this.n < WINDOW) this.n++;
    this.ticksTotal++;
    const long = total > this.traceMs;
    if (long) this.longTotal++;
    if (long || this.worst.length < WORST || total > this.worst[this.worst.length - 1].total) {
      const rec = this.record(i);
      if (this.worst.length < WORST || total > this.worst[this.worst.length - 1].total) {
        this.worst.push(rec);
        this.worst.sort((a, b) => b.total - a.total);
        if (this.worst.length > WORST) this.worst.length = WORST;
      }
      if (long) {
        this.traces.push(rec);
        if (this.traces.length > TRACES) this.traces.shift();
        this.onLong?.(describe(rec), rec);
      }
    }
    this.phase.fill(0);
    this.cur.fill(0);
  }
  private record(i: number): TickRecord {
    return {
      total: r2(this.totals[i]), phases: Array.from(this.ring.subarray(i * N_PHASES, (i + 1) * N_PHASES), r2),
      tick: this.ticks[i], hour: r2(((this.ticks[i] % TICKS_PER_DAY) / TICKS_PER_DAY) * 24), at: this.at[i],
      counters: Array.from(this.cring.subarray(i * N_COUNTERS, (i + 1) * N_COUNTERS)),
    };
  }
  /** the last `count` ticks' times, oldest first, with their game ticks */
  recent(count = WINDOW): { ms: number[]; ticks: number[]; at: number[] } {
    const n = Math.min(count, this.n), ms: number[] = [], ticks: number[] = [], at: number[] = [];
    for (let k = n; k > 0; k--) { const j = (this.i - k + WINDOW) % WINDOW; ms.push(r2(this.totals[j])); ticks.push(this.ticks[j]); at.push(this.at[j]); }
    return { ms, ticks, at };
  }
  /** everything over the window: per phase avg, p95, max and share of the tick; rates per second; the worst ticks; the traces */
  summary(): PhaseStatsSummary {
    const n = this.n;
    const stat = (vals: number[]) => {
      if (!vals.length) return { avg: 0, p95: 0, max: 0 };
      const a = vals.slice().sort((x, y) => x - y);
      let s = 0; for (const v of a) s += v;
      return { avg: r2(s / a.length), p95: r2(a[Math.min(a.length - 1, Math.floor(0.95 * a.length))]), max: r2(a[a.length - 1]) };
    };
    const totals: number[] = [];
    let long = 0, tickSum = 0;
    for (let k = 0; k < n; k++) { const v = this.totals[k]; totals.push(v); tickSum += v; if (v > this.traceMs) long++; }
    const phases = {} as Record<Phase, PhaseSummary>;
    for (let p = 0; p < N_PHASES; p++) {
      const vals: number[] = []; let s = 0;
      for (let k = 0; k < n; k++) { const v = this.ring[k * N_PHASES + p]; vals.push(v); s += v; }
      phases[PHASES[p]] = { ...stat(vals), share: tickSum ? r2((100 * s) / tickSum) : 0 };
    }
    const rates = {} as Record<Counter, number>;
    const seconds = n ? Math.max(0.2, (Math.max(...Array.from(this.at.subarray(0, n))) - Math.min(...Array.from(this.at.subarray(0, n)))) / 1000 + TICK_MS / 1000) : 1;
    for (let c = 0; c < N_COUNTERS; c++) {
      let s = 0; for (let k = 0; k < n; k++) s += this.cring[k * N_COUNTERS + c];
      rates[COUNTERS[c]] = r2(COUNTERS[c] === 'moving' || COUNTERS[c] === 'driving' ? (n ? s / n : 0) : s / seconds);
    }
    return { window: n, tick: { ...stat(totals), long, count: n }, phases, rates, worst: this.worst.slice(), traces: this.traces.slice(), longTotal: this.longTotal, ticksTotal: this.ticksTotal };
  }
}

/** one line for the log: the tick, its hour, the total and the three largest phases, and the work */
export function describe(rec: TickRecord): string {
  const top = rec.phases.map((ms, i) => [PHASES[i], ms] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, ms]) => `${p} ${ms.toFixed(1)}`).join(', ');
  const h = Math.floor(rec.hour), m = Math.floor((rec.hour - h) * 60);
  const c = rec.counters;
  return `long tick ${rec.total.toFixed(1)} ms at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (tick ${rec.tick}): ${top}; ${c[0]} routes, ${c[1]} nodes, ${c[2]} msgs, ${(c[3] / 1024).toFixed(0)} KB, ${c[4]} agents`;
}
