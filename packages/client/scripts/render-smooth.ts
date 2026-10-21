// How smoothly cars are drawn between the server's positions (docs/traffic-tuning.md "Smooth flow"), offline: runs the
// ab.ts test city to the hour, sends each tick's driver positions as the server does (rounded to 0.01, only the ones that
// changed plus every tenth agent each tick), delivers them with network jitter, and draws them at 60 frames a second
// both ways: the old straight-line lerp and render/glide.ts. Reports the drawn speed's frame-to-frame change.
//   npx tsx packages/client/scripts/render-smooth.ts --hour 8 --seed 1 --ticks 300 --jitter 25 [--set follow=1,...]
import { TICKS_PER_DAY, TICKS_PER_HOUR, TRAFFIC_TUNING, TICK_MS } from '@msimcity/shared';
import { World, type Mover } from '../../server/src/world';
import { Simulation } from '../../server/src/sim/simulation';
import { seedCity } from '../../server/src/loadtest/cities';
import { parseSet } from '../../server/src/loadtest/ab';
import { glide, glideFrom, STRETCH as ST0, type Glider } from '../src/render/glide';
const STRETCH = Number(process.argv[process.argv.indexOf('--stretch') + 1] || 0) || ST0;

const argv = process.argv.slice(2);
const get = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const hour = Number(get('hour') ?? 8), seed = Number(get('seed') ?? 1), ticks = Number(get('ticks') ?? 300);
const jitter = Number(get('jitter') ?? 25), fps = Number(get('fps') ?? 60);
const rng = (s: number) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
Math.random = rng(seed * 2654435761);
for (const [k, v] of Object.entries(parseSet(get('set')))) if (k in TRAFFIC_TUNING) (TRAFFIC_TUNING as Record<string, number>)[k] = v;
const w = new World(seed);
seedCity(w, { districts: 1, built: 3 });
for (const id of w.parcels.keys()) w.recountRoads(id);
const sim = new Simulation(w);
while (w.tick < TICKS_PER_DAY + hour * TICKS_PER_HOUR) sim.tick();

// the messages: per tick the drivers that moved (and the keep-alive tenth), as net.ts sends them
const msgs: { at: number; pos: Map<number, [number, number]>; gone: number[]; all: Map<number, [number, number]> }[] = [];
const sent = new Map<number, [number, number]>();
const jr = rng(seed * 7 + 1);
let at = 0;
for (let i = 0; i < ticks; i++) {
  sim.tick();
  const pos = new Map<number, [number, number]>(), seen = new Set<number>(), all = new Map<number, [number, number]>();
  const note = (m: Mover) => {
    const x = Math.round(m.x * 100) / 100, y = Math.round(m.y * 100) / 100, p = sent.get(m.id);
    seen.add(m.id); all.set(m.id, [m.x, m.y]);
    if (p && p[0] === x && p[1] === y && m.id % 10 !== i % 10) return;
    sent.set(m.id, [x, y]); pos.set(m.id, [x, y]);
  };
  for (const c of w.citizens.values()) if (c.leg?.drive && c.lane >= 0) note(c);
  for (const v of w.vehicles.values()) if (v.phase !== 'dwell' && v.lane >= 0) note(v);
  const gone = [...sent.keys()].filter((id) => !seen.has(id));
  for (const id of gone) sent.delete(id);
  // arrival: the tick's time plus jitter (the sum of three uniforms, about normal), never before the one before
  at = Math.max(at + 1, i * TICK_MS + (jr() + jr() + jr() - 1.5) * jitter * 2);
  msgs.push({ at, pos, gone, all });
}

interface Old { x: number; y: number; px: number; py: number; tx: number; ty: number; t: number }
type G = Glider;
const olds = new Map<number, Old>(), news = new Map<number, G>();
let gapMs = TICK_MS, msgAt = 0;
const dt = 1000 / fps;
const stat = () => ({ frames: 0, dvSum: 0, jolts: 0, hitches: 0, stops: 0, moving: 0, lag: 0, lagN: 0 });
const S = { old: stat(), glide: stat() };
const prev = { old: new Map<number, [number, number, number]>(), glide: new Map<number, [number, number, number]>() };
const hist = { old: new Map<number, number[]>(), glide: new Map<number, number[]>() };
const traceId = Number(get('trace') ?? 0), trace: Record<string, string[]> = { old: [], glide: [] };
let truthAt = 0;
const measure = (k: 'old' | 'glide', id: number, x: number, y: number) => {
  const p = prev[k].get(id), s = S[k];
  // how far behind the server's own position (at its nominal time, between ticks on a straight line) it is drawn, in ticks of travel
  const i = Math.floor(truthAt / TICK_MS), f = truthAt / TICK_MS - i, a0 = msgs[i]?.all.get(id), a1 = msgs[i + 1]?.all.get(id), a2 = msgs[i - 1]?.all.get(id);
  if (a0 && a1 && a2) { const tx = a0[0] + (a1[0] - a0[0]) * f, ty = a0[1] + (a1[1] - a0[1]) * f, sp = Math.hypot(a1[0] - a2[0], a1[1] - a2[1]) / 2; if (sp > 0.2) { s.lag += Math.hypot(x - tx, y - ty) / sp; s.lagN++; } }
  if (id === traceId && p) trace[k].push((Math.hypot(x - p[0], y - p[1]) / (dt / 1000)).toFixed(1));
  if (!p) { prev[k].set(id, [x, y, -1]); return; }
  const v = Math.hypot(x - p[0], y - p[1]) / (dt / 1000); // tiles per second
  if (v > 20) { prev[k].set(id, [x, y, -1]); return; }
  if (p[2] >= 0) {
    const dv = Math.abs(v - p[2]);
    s.frames++; s.dvSum += dv; if (dv > 0.5) s.jolts++;
    if (v > 0.1) s.moving++;
    // a hitch: drawn still for a frame or more between frames moving at over 1 tile a second
    const h = hist[k].get(id) ?? []; h.push(v); if (h.length > 8) h.shift(); hist[k].set(id, h);
    if (h.length >= 3 && h[h.length - 2] < 0.05 && h[h.length - 1] > 1 && h.slice(0, -2).some((q) => q > 1)) s.hitches++;
    if (p[2] > 0.25 && v < 0.05) s.stops++;
  }
  prev[k].set(id, [x, y, v]);
};
let mi = 0, frameAt = 0;
for (let now = 0; now < msgs[msgs.length - 1].at; now += dt) {
  truthAt = now;
  while (mi < msgs.length && msgs[mi].at <= now) {
    const m = msgs[mi++], t = m.at;
    const gap = t - msgAt; if (msgAt && gap > 20 && gap < 2.5 * gapMs) gapMs += (gap - gapMs) * 0.2; msgAt = t;
    for (const id of m.gone) { olds.delete(id); news.delete(id); prev.old.delete(id); prev.glide.delete(id); }
    for (const [id, [x, y]] of m.pos) {
      const o = olds.get(id);
      if (!o) olds.set(id, { x, y, px: x, py: y, tx: x, ty: y, t: 1 }); else { o.px = o.x; o.py = o.y; o.tx = x; o.ty = y; o.t = 0; }
      const g = news.get(id);
      if (!g) news.set(id, { x, y, px: x, py: y, tx: x, ty: y, gx: x, gy: y, m0x: 0, m0y: 0, m1x: 0, m1y: 0, vx: 0, vy: 0, g0: t });
      else { g.px = g.tx; g.py = g.ty; g.tx = x; g.ty = y; glideFrom(g, gapMs * STRETCH, frameAt); }
    }
  }
  for (const [id, o] of olds) { o.t = Math.min(1, o.t + dt / TICK_MS); o.x = o.px + (o.tx - o.px) * o.t; o.y = o.py + (o.ty - o.py) * o.t; measure('old', id, o.x, o.y); }
  for (const [id, g] of news) { glide(g, (now - g.g0) / (gapMs * STRETCH), gapMs * STRETCH); measure('glide', id, g.x, g.y); }
  frameAt = now;
}
const f2 = (v: number) => v.toFixed(2), f1 = (v: number) => v.toFixed(1);
console.log(`render-smooth: ${hour}:00 seed ${seed}, ${ticks} ticks, jitter ±${jitter} ms, ${fps} fps, set ${get('set') ?? '-'}`);
console.log('| drawing | mean drawn |Δv| per frame (tiles/s) | jolts (|Δv| > 0.5 tiles/s in a frame) % of frames | hitches per 1,000 moving frames | drawn stops per 1,000 moving frames | drawn behind the server (ticks, cars over 0.2 tiles a tick) |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const k of ['old', 'glide'] as const) { const s = S[k]; console.log(`| ${k} | ${f2(s.dvSum / s.frames)} | ${f1((100 * s.jolts) / s.frames)} | ${f1((1000 * s.hitches) / s.moving)} | ${f1((1000 * s.stops) / s.moving)} | ${f2(s.lag / s.lagN)} |`); }
if (traceId) for (const k of ['old', 'glide'] as const) console.log(k, trace[k].slice(0, 240).join(' '));
