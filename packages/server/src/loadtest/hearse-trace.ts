/**
 * Hearse tracer for loadtest/death.ts (loaded by death-set.ts with TRACE=1; ALL=1 also lists collections): every hearse
 * run, tick by tick, where it stood still and why (in its garage: the box busy, the road tile full, a walker at the door;
 * on the road: queued behind a car, a stop line or entry rule, the body guard for walkers, a walker standing back on a
 * crossing (pedRetreatOnce) or car bodies), and what held the head of the queue outside the garage while it waited.
 * Prototype wrappers only: the game plays exactly as without it.
 */
import { TICKS_PER_HOUR } from '@msimcity/shared';
import { Death } from '../sim/death';
import { Traffic } from '../sim/traffic';
import type { Mover } from '../world';

const TPH = TICKS_PER_HOUR;
interface Run { d: number; v: number; svc: number; t0: number; end?: number; how?: string; ticks: number; moved: number; cause: Record<string, number>; where: Map<string, number>; heldPeds: Set<number> }
const runs: Run[] = [];
const byV = new Map<number, Run>();
// (arrive starts the service through startService: a run that reaches the chapel in time is reported by both)
const D = Death.prototype as any, T = Traffic.prototype as any;

const send = D.send;
D.send = function (d: any, stops: unknown, task: string) {
  const r = send.call(this, d, stops, task);
  const v = this.hearse.get(d.id);
  if (r && v !== undefined) { const run: Run = { d: d.id, v, svc: d.svc ?? -1, t0: this.w.tick, ticks: 0, moved: 0, cause: {}, where: new Map(), heldPeds: new Set() }; runs.push(run); byV.set(v, run); }
  return r;
};
const arrive = D.arrive;
D.arrive = function (u: any, s: any) {
  const run = byV.get(u.v.id);
  const was = this.dead.get(s.ref)?.st;
  arrive.call(this, u, s);
  if (run && run.end === undefined && run.svc >= 0) {
    const d = this.dead.get(s.ref);
    if (d && d.st === 4 && d.since === this.w.tick && was !== 4) { run.end = this.w.tick; run.how = 'arrived in time'; }
  }
};
const start = D.startService;
D.startService = function (d: any) {
  start.call(this, d);
  for (const run of runs) if (run.d === d.id && run.end === undefined && this.hearse.has(d.id) && !run.how) { run.how = 'service went ahead without it'; run.end = this.w.tick; }
};

const lastCut = new WeakMap<Mover, { t: number; peds: number; cars: number; held: number }>();
const heads: Record<string, Record<string, number>> = {};
let cut: { peds: number; cars: number; held: number } | null = null;
const sweep = T.guardSweep;
T.guardSweep = function (m: Mover, allowed: number) {
  const r = sweep.call(this, m, allowed);
  if (r < allowed) {
    let h = 0; const L2: Mover[][] = [];
    if (this.gNp) for (let g = 0; g < 2; g++) for (let j = 0, n = (g ? this.walkPrev : this.walkCur).near(Math.floor(m.x), Math.floor(m.y), L2); j < n; j++) for (const p of L2[j]) if (p.pts && (p.x - m.x) ** 2 + (p.y - m.y) ** 2 < 1 && this.heldBack(p)) h++;
    lastCut.set(m, { t: this.w.tick, peds: this.gNp / 3, cars: this.gNc, held: h });
  }
  if (byV.has(m.id) && r < allowed) {
    let held = 0;
    const L: Mover[][] = [];
    for (let g = 0; g < 2; g++) for (let j = 0, n = (g ? this.walkPrev : this.walkCur).near(Math.floor(m.x), Math.floor(m.y), L); j < n; j++) for (const p of L[j]) {
      if (!p.pts || (p.x - m.x) ** 2 + (p.y - m.y) ** 2 > 1) continue;
      if (this.heldBack(p)) { held++; byV.get(m.id)!.heldPeds.add(p.id); }
    }
    cut = { peds: this.gNp / 3, cars: this.gNc, held };
  }
  return r;
};
const enter = T.enter;
T.enter = function (m: Mover) {
  const r = enter.call(this, m);
  const run = byV.get(m.id);
  if (!run || run.end !== undefined || r === 'ok') return r;
  run.ticks++;
  const why: string[] = [];
  if (this.boxBusyExcept(m.path[0], m.path[1], m)) why.push('box busy');
  if (this.pedInBody(m, 0)) why.push('walker in its body');
  else if (this.pedNear(m.x, m.y, m.len / 2 + 0.07 + 0.03)) why.push('walker near the door');
  if (!why.length) why.push('road tile full / lane tail');
  let held = 0;
  const L: Mover[][] = [];
  for (let g = 0; g < 2; g++) for (let j = 0, n = (g ? this.walkPrev : this.walkCur).near(Math.floor(m.x), Math.floor(m.y), L); j < n; j++) for (const p of L[j]) if (p.pts && (p.x - m.x) ** 2 + (p.y - m.y) ** 2 < 1 && this.heldBack(p)) { held++; run.heldPeds.add(p.id); }
  const k = `garage: ${why.join('+')}${held ? ' (held walker near)' : ''}`;
  // the queue outside: from a car on the road tile in front of the door to the head of its chain
  {
    const L3: Mover[][] = []; let c0: Mover | null = null;
    for (let j = 0, n = this.carGrid.near(m.path[2], m.path[3], L3); j < n && !c0; j++) for (const o of L3[j]) if (Math.floor(o.x) === m.path[2] && Math.floor(o.y) === m.path[3] && o !== m) { c0 = o; break; }
    let head = c0, hops = 0;
    while (head && hops < 40) { const h = this.holderOf(head); if (!h || h === head) break; head = h; hops++; }
    let hw = 'nobody on the tile';
    if (head) {
      const lc = lastCut.get(head);
      hw = lc && lc.t === this.w.tick ? (lc.held ? 'head held by a HELD walker' : lc.peds && !lc.cars ? 'head held by a walker' : 'head held by a car body') : head.wait > 1 ? 'head standing: signal / give-way / box rule' : 'head moving';
      hw += ` at ${Math.floor(head.x)},${Math.floor(head.y)}`;
    }
    const hk = `${run.d}@${run.t0}`;
    (heads[hk] ??= {})[hw] = (heads[hk][hw] ?? 0) + 1;
  }
  run.cause[k] = (run.cause[k] ?? 0) + 1;
  const wk = `${Math.floor(m.x)},${Math.floor(m.y)}`;
  run.where.set(wk, (run.where.get(wk) ?? 0) + 1);
  return r;
};
const step = T.step;
T.step = function (m: Mover) {
  const run = byV.get(m.id);
  if (!run || run.end !== undefined) return step.call(this, m);
  const x = m.x, y = m.y;
  cut = null;
  const r = step.call(this, m);
  run.ticks++;
  if (Math.hypot(m.x - x, m.y - y) >= 0.02) { run.moved++; return r; }
  let why: string;
  const c = cut as { peds: number; cars: number; held: number } | null;
  if (c && c.held) why = 'guard, a held walker near';
  else if (c && c.peds && !c.cars) why = 'guard, walkers';
  else if (c && c.cars) why = 'guard, car bodies';
  else { const h = this.holderOf(m); why = h ? 'queued behind a car' : 'stop line / entry rule'; }
  run.cause[why] = (run.cause[why] ?? 0) + 1;
  const k = `${Math.floor(m.x)},${Math.floor(m.y)}`;
  run.where.set(k, (run.where.get(k) ?? 0) + 1);
  if (r === 'stuck') run.cause['STUCK'] = (run.cause['STUCK'] ?? 0) + 1;
  return r;
};

process.on('exit', () => {
  console.log('\n=== what heads the queue outside the garage, per run');
  for (const [k, v] of Object.entries(heads)) console.log(`${k}: ${Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a, n]) => `${a} x${n}`).join('; ')}`);
  console.log(`\n=== hearse runs (SET ${process.env.SET})`);
  for (const r of runs) {
    if (r.svc < 0 && !process.env.ALL) continue;
    const top = [...r.where].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} x${n}`).join(', ');
    console.log(`body ${r.d}: sent t${r.t0}${r.svc >= 0 ? `, service at +${((r.svc - r.t0) / TPH).toFixed(2)} h` : ' (collection)'}: ${r.how ?? 'no service outcome'}${r.end ? ` at +${((r.end - r.t0) / TPH).toFixed(2)} h` : ''}; driving ${r.ticks} ticks, moving ${r.moved}; standing: ${JSON.stringify(r.cause)}; where: ${top}; held walkers met ${r.heldPeds.size}`);
  }
});
