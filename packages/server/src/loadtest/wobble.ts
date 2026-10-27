/**
 * Crossing wobble probe (docs/traffic-tuning.md "Crossings: the wobble"): how often a walker goes back and forth on a
 * crossing before getting over it.
 *
 *   npx tsx packages/server/src/loadtest/wobble.ts [--demo london | --load FILE] [--save FILE] [--hours 24]
 *       [--set k=v,...] [--seed N] [--trace N] [--json FILE]
 *
 * Fills London as the probes do (probe-city.ts probeGame; `--save FILE` writes the filled world), or loads a save
 * (`--load`, any snapshot: a UAT copy, say; `--seed N` reseeds Math.random for it, the noise between runs), applies `--set` to TRAFFIC_TUNING for the measured span only, then plays
 * `--hours` game hours and follows every walker over every crossing it walks: one *episode* per walker per crossing,
 * from its first step off the kerb to its target passing the crossing's last point. In each episode it counts the
 * walker's retreats (Simulation.retreatToKerb), its *reversals* (the sign of its progress along the crossing changing
 * between two ticks it moved), its ticks on the crossing and the ticks lost (ticks on it less the walk at full pace).
 * A *wobble* is an episode with 2+ reversals. Prints the histogram of reversals per episode, the share with a wobble,
 * the ten worst crossings (where, what kind, what was there at the first retreat), with `--trace N` the tick-by-tick log
 * of the first N wobbling episodes (the walker, and the nearest car: distance, wait, whether its body holds the
 * walker's next step), and the traffic figures an A/B compares: trips completed and their mean time, the
 * vehicle-weighted speed and queued share, and the Traffic counters over the span.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DEMO_TOWN, TICKS_PER_HOUR, TRAFFIC_TUNING, WALK_SPEED, LifeStage, CitizenState as S, isDemoId, type DemoId } from '@msimcity/shared';
import type { Mover, Citizen } from '../world';
import { worldFromSnapshot, snapshotOf } from '../snapshot';
import { createGame, type Game } from '../game';
import { seededRandom } from '../demo/seed';
import { probeGame } from './probe-city';
import { LIFE } from '../sim/life';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const TPH = TICKS_PER_HOUR;

interface Ep {
  k: number; pts: number[]; run0: number; run1: number; cum: number[]; len: number;
  started: boolean; s: number; dir: number; reversals: number; retreats: number; ticks: number; back: number; speed: number;
  log: string[] | null; ctx: string; t0: number;
}
interface Xing { k: number; kind: string; eps: number; wobbles: number; retreats: number; reversals: number; lost: number; ctx: Map<string, number> }

async function main() {
  const t0 = performance.now();
  let game: Game, label: string;
  const load = arg('load', '');
  if (load) {
    Math.random = seededRandom(DEMO_TOWN.seed + Number(arg('seed', '0')));
    game = createGame(worldFromSnapshot(JSON.parse(readFileSync(load, 'utf8')))!, { onConnection() {} }, { devTools: false, sandbox: true });
    label = load;
  } else {
    const d = arg('demo', 'london');
    const demo: DemoId = isDemoId(d) ? d : 'london';
    const p = await probeGame(demo, 0);
    game = p.game; label = `${p.label} filled ${(p.fill.ticks / TPH).toFixed(0)} h`;
  }
  const save = arg('save', '');
  if (save) { writeFileSync(save, JSON.stringify(snapshotOf(game.world))); console.log(`saved ${save}`); }
  const set: Record<string, number> = {};
  for (const kv of arg('set', '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!(k in TRAFFIC_TUNING)) throw new Error(`--set ${k}: unknown tunable`);
    set[k] = Number(v); (TRAFFIC_TUNING as unknown as Record<string, number>)[k] = Number(v);
  }
  const w = game.world, sim = game.sim as unknown as { traffic: any; retreatToKerb(c: Citizen, k: number, xd: number): boolean };
  const tr = sim.traffic;
  console.log(`${label}: ${w.citizens.size} citizens, tick ${w.tick}, set ${JSON.stringify(set)}, ${((performance.now() - t0) / 1000).toFixed(0)} s`);

  // ---- the walkers seen this tick (noteWalker is called once per walking mover per tick, after its step) ----
  const seen: Mover[] = [];
  const note = tr.noteWalker.bind(tr);
  tr.noteWalker = (m: Mover) => { seen.push(m); note(m); };
  const eps = new Map<Mover, Ep>();
  // retreats, counted to the walker's episode
  const retreat = sim.retreatToKerb.bind(sim);
  let traceLeft = Number(arg('trace', '0'));
  sim.retreatToKerb = (c: Citizen, k: number, xd: number) => {
    const r = retreat(c, k, xd);
    const e = eps.get(c);
    if (r && e && e.k === k) { e.retreats++; if (e.retreats === 1) e.ctx = context(c, k); if (e.log) e.log.push(`    retreat (wait ${c.wait})`); }
    return r;
  };
  const kindOf = (k: number) => {
    const bx = Math.floor(k / 65536) - 0x8000, by = (k % 65536) - 0x8000;
    const j = tr.junctionKind(bx, by) as string;
    return j === 'none' ? (tr.degreeOf(bx, by) >= 3 ? 'junction' : 'street') : j;
  };
  const nearL: Mover[][] = [];
  /** the nearest car body to c: its distance, wait, and whether it covers the point c would step to */
  const nearest = (c: Mover): { m: Mover | null; d: number } => {
    let best: Mover | null = null, bd = Infinity;
    for (let j = 0, nl = tr.carGrid.near(Math.floor(c.x), Math.floor(c.y), nearL); j < nl; j++) for (const o of nearL[j]) {
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < bd) { bd = d; best = o; }
    }
    return { m: best, d: bd };
  };
  const context = (c: Mover, k: number) => {
    const bx = Math.floor(k / 65536) - 0x8000, by = (k % 65536) - 0x8000;
    const n = nearest(c);
    const kind = kindOf(k);
    const lamp = kind === 'pelican' ? ` lamp ${tr.pelicanLamp(bx, by)}` : '';
    if (!n.m) return `no car${lamp}`;
    return `${n.m.wait > 1 ? 'car waiting' : 'car moving'}${lamp}`;
  };

  // ---- the A/B figures ----
  const travel = (st: number) => st === S.ToWork || st === S.ToHome || st === S.ToSite || st === S.ToVenue;
  const prevState = new Map<number, number>();
  for (const c of w.citizens.values()) prevState.set(c.id, c.state);
  const trips: number[] = [];
  let vehSum = 0, qSum = 0, spSum = 0;
  const c0 = { ...tr.counters } as Record<string, number>;

  const hist = [0, 0, 0, 0];
  const retHist = [0, 0, 0, 0];
  let nEps = 0, wobbles = 0, lostAll = 0, lostWob = 0, ticksAll = 0, backAll = 0;
  const xings = new Map<number, Xing>();
  const traces: string[] = [];
  const close = (m: Mover, e: Ep) => {
    eps.delete(m);
    if (!e.started) return;
    nEps++;
    hist[Math.min(3, e.reversals)]++;
    retHist[Math.min(3, e.retreats)]++;
    const ideal = (e.len - 0) / e.speed;
    const lost = Math.max(0, e.ticks - ideal);
    lostAll += lost; ticksAll += e.ticks; backAll += e.back;
    let x = xings.get(e.k);
    if (!x) xings.set(e.k, (x = { k: e.k, kind: kindOf(e.k), eps: 0, wobbles: 0, retreats: 0, reversals: 0, lost: 0, ctx: new Map() }));
    x.eps++; x.retreats += e.retreats; x.reversals += e.reversals; x.lost += lost;
    if (e.reversals >= 2) {
      wobbles++; lostWob += lost; x.wobbles++;
      if (e.ctx) x.ctx.set(e.ctx, (x.ctx.get(e.ctx) ?? 0) + 1);
      if (e.log && traceLeft > 0) {
        traceLeft--;
        const bx = Math.floor(e.k / 65536) - 0x8000, by = (e.k % 65536) - 0x8000;
        traces.push(`walker #${m.id} at crossing ${bx},${by} (${kindOf(e.k)}), from tick ${e.t0}: ${e.reversals} reversals, ${e.retreats} retreats, ${e.ticks} ticks, run ${e.len.toFixed(2)} tiles\n${e.log.join('\n')}`);
      }
    }
  };
  /** where c is along its crossing run, in tiles from the kerb */
  const progress = (c: Mover, e: Ep) => {
    const i = Math.max(e.run0, Math.min(e.run1, c.pp));
    const ax = e.pts[(i - 1) * 2], ay = e.pts[(i - 1) * 2 + 1], bx = e.pts[i * 2], by = e.pts[i * 2 + 1];
    const sx = bx - ax, sy = by - ay, sl = Math.hypot(sx, sy) || 1;
    return e.cum[i - 1 - (e.run0 - 1)] + ((c.x - ax) * sx + (c.y - ay) * sy) / sl;
  };
  const watch = (m: Mover) => {
    let e = eps.get(m);
    const pts = m.pts, cross = m.cross;
    if (e && (pts !== e.pts || !cross || cross[m.pp] !== e.k)) { close(m, e); e = undefined; }
    if (!pts || !cross || m.pp * 2 >= pts.length) return;
    const k = cross[m.pp];
    if (!k) return;
    if (!e) {
      // the run of points flagged k that the target is in: from run0 (first flagged) to run1 (last)
      let run0 = m.pp; while (run0 > 1 && cross[run0 - 1] === k) run0--;
      let run1 = m.pp; while ((run1 + 1) * 2 < pts.length && cross[run1 + 1] === k) run1++;
      const cum = [0];
      for (let i = run0; i <= run1; i++) cum.push(cum[cum.length - 1] + Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]));
      const speed = 'stage' in m && (m as Citizen).stage === LifeStage.Retired ? WALK_SPEED * LIFE.retireeWalk : WALK_SPEED;
      e = { k, pts, run0, run1, cum, len: cum[cum.length - 1], started: false, s: 0, dir: 0, reversals: 0, retreats: 0, ticks: 0, back: 0, speed, log: traceLeft > 0 ? [] : null, ctx: '', t0: w.tick };
      eps.set(m, e);
    }
    const s = progress(m, e);
    if (!e.started) { if (s <= 1e-6) { e.s = s; return; } e.started = true; e.t0 = w.tick; }
    e.ticks++;
    const ds = s - e.s;
    if (Math.abs(ds) > 1e-6) {
      const dir = ds > 0 ? 1 : -1;
      if (e.dir && dir !== e.dir) e.reversals++;
      e.dir = dir;
      if (ds < 0) e.back += -ds;
    }
    e.s = s;
    if (e.log && e.log.length < 120) {
      const n = nearest(m), o = n.m;
      const bx = Math.floor(e.k / 65536) - 0x8000, by = (e.k % 65536) - 0x8000;
      const lamp = tr.pelicanAt?.(bx, by) ? ` lamp ${tr.pelicanLamp(bx, by)}` : '';
      e.log.push(`  t${w.tick} s ${s.toFixed(3)}/${e.len.toFixed(2)} pp ${m.pp} wait ${m.wait}${lamp}` +
        (o ? ` | car #${o.id} d ${n.d.toFixed(2)} wait ${o.wait} stuck ${o.stuck} prog ${o.prog.toFixed(2)} lane ${o.lane} bodyOnNext ${tr.carBodyAt(m.x, m.y) ? 'here' : ''}` : ' | no car'));
    }
  };

  const hours = Number(arg('hours', '24')), n = Math.round(hours * TPH);
  const tw = performance.now();
  for (let i = 0; i < n; i++) {
    seen.length = 0;
    game.step();
    const now = new Set(seen);
    for (const m of seen) watch(m);
    for (const [m, e] of eps) if (!now.has(m)) close(m, e); // stopped walking (got in a car, arrived, went in)
    const v = tr.lastVehicles; vehSum += v; qSum += tr.lastQueued; spSum += tr.lastSpeedPct * v;
    for (const c of w.citizens.values()) {
      const ps = prevState.get(c.id);
      if (ps !== c.state) {
        if (ps !== undefined && travel(ps) && !travel(c.state)) trips.push(w.tick - c.tripStart);
        prevState.set(c.id, c.state);
      }
    }
    if ((i + 1) % (TPH * 4) === 0) console.error(`  ${(i + 1) / TPH} h, ${((performance.now() - tw) / 1000).toFixed(0)} s`);
  }
  for (const [m, e] of eps) close(m, e);

  const counters: Record<string, number> = {};
  for (const [k, v] of Object.entries(tr.counters as Record<string, number>)) counters[k] = v - (c0[k] ?? 0);
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(2) : '0.00');
  const out = {
    label, set, hours, episodes: nEps, hist, retreatHist: retHist, wobbles, wobblePct: +pct(wobbles, nEps),
    meanTicksOnCrossing: ticksAll / Math.max(1, nEps), meanTicksLost: lostAll / Math.max(1, nEps), meanTicksLostWobble: lostWob / Math.max(1, wobbles), backTiles: backAll,
    trips: trips.length, tripMean: trips.reduce((a, b) => a + b, 0) / Math.max(1, trips.length),
    speedPct: (100 * spSum) / Math.max(1, vehSum), queuedPct: (100 * qSum) / Math.max(1, vehSum), counters,
    wallSec: (performance.now() - t0) / 1000,
  };
  console.log(`\nepisodes (walker x crossing) ${nEps}; reversals 0/1/2/3+: ${hist.join(' / ')}; retreats 0/1/2/3+: ${retHist.join(' / ')}`);
  console.log(`wobble (2+ reversals): ${wobbles} = ${out.wobblePct}% of episodes; ticks on a crossing ${out.meanTicksOnCrossing.toFixed(2)} mean, lost ${out.meanTicksLost.toFixed(2)} mean (${out.meanTicksLostWobble.toFixed(1)} in a wobble); ${backAll.toFixed(1)} tiles walked backwards`);
  console.log(`trips ${out.trips}, mean ${out.tripMean.toFixed(1)} ticks; speed ${out.speedPct.toFixed(1)}%, queued ${out.queuedPct.toFixed(2)}%`);
  console.log(`counters: ${Object.entries(counters).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const worst = [...xings.values()].sort((a, b) => b.wobbles - a.wobbles || b.reversals - a.reversals).slice(0, 10);
  console.log('\nworst crossings: tile, kind, episodes, wobbles, retreats, reversals, ticks lost, what was there at the first retreat');
  for (const x of worst) {
    if (!x.wobbles) break;
    const bx = Math.floor(x.k / 65536) - 0x8000, by = (x.k % 65536) - 0x8000;
    console.log(`  ${bx},${by} ${x.kind}: ${x.eps} eps, ${x.wobbles} wobbles, ${x.retreats} retreats, ${x.reversals} rev, ${x.lost.toFixed(0)} lost; ${[...x.ctx].map(([c, v]) => `${c} x${v}`).join(', ') || '-'}`);
  }
  const byKind = new Map<string, { eps: number; wob: number }>();
  for (const x of xings.values()) { const b = byKind.get(x.kind) ?? { eps: 0, wob: 0 }; b.eps += x.eps; b.wob += x.wobbles; byKind.set(x.kind, b); }
  console.log(`by kind: ${[...byKind].map(([k, b]) => `${k} ${b.wob}/${b.eps}`).join(', ')}`);
  if (traces.length) console.log('\n' + traces.join('\n\n'));
  const json = arg('json', '');
  if (json) writeFileSync(json, JSON.stringify({ ...out, worst: worst.map((x) => ({ ...x, ctx: Object.fromEntries(x.ctx) })), traces }, null, 1));
  console.log(`\nwall ${out.wallSec.toFixed(0)} s`);
  process.exit(0);
}
void main();
