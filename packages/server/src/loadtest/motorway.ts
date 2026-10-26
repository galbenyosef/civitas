/**
 * Motorway probe (UTD card e771510f, "motorways should be way faster"; docs/roads.md "Classes", docs/traffic-tuning.md
 * "Motorway speed"). A motorway tile is driven at `speed` times a street's (shared/src/roadclass.ts), which at 2.5 puts a
 * car 1.25 to 1.4 tiles into a tick: more than one tile edge. The probe measures what that asks of the traffic model and
 * fails if a motorway car ever skips a tile, jumps further than its speed allows, brakes harder than the model plans
 * for or overlaps another car:
 *
 *   npx tsx packages/server/src/loadtest/motorway.ts                       the table and the checks
 *   npx tsx packages/server/src/loadtest/motorway.ts --speed 1.25 --cost 0.8   the old class values (the "before" column)
 *
 * 1. Door to door: one car at a time from the end of a street spur, along a 160-tile trunk of class C (a motorway with a
 *    diamond interchange at each end, or a street or avenue crossed by the spurs), to the end of the other spur. Ticks
 *    and the ratio to the street, the same sixteen drivers on every class.
 * 2. A busy motorway: Poisson demand along it both ways, to and from the streets through both interchanges, over many
 *    ticks. Per tick every car's move is checked: edges crossed (at most 2), distance (at most its top speed), hard
 *    stops (a fall in speed of more than a car can plan for), and car-car body overlaps.
 * 3. A queue at a standing car: cars drive into it; none may overlap and none may stop dead from speed (the braking
 *    starts in time).
 */
import {
  TICKS_PER_HOUR, TICK_MS, DRIVE_SPEED, Terrain, packTile, planInterchange, RoadCls, roadDragPath, ROAD_CLASS_DEFS, JUNCTION_CLASS_DEFS,
} from '@msimcity/shared';
import { World, emptyStats, type Mover } from '../world';
import { Traffic, pathPoint, strandOffset, dirBetween } from '../sim/traffic';
import { glide, glideFrom, STRETCH, type Glider } from '../../../client/src/render/glide';
import { findRoute } from '../pathfinding';
import { layClass, mulberry32, obb } from './classbench';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
// the class values under test (--speed, --cost): both motorway entries of the table, ROAD_CLASS_DEFS 4 and the interchange deck's 7
const speedArg = arg('speed', ''), costArg = arg('cost', '');
for (const d of [ROAD_CLASS_DEFS[RoadCls.Motorway], JUNCTION_CLASS_DEFS.find((c) => c.id === RoadCls.Deck)!] as { speed: number; routeCost: number }[]) {
  if (speedArg) d.speed = Number(speedArg);
  if (costArg) d.routeCost = Number(costArg);
}
const MW_SPEED = ROAD_CLASS_DEFS[RoadCls.Motorway].speed;

let passed = 0, failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (cond) passed++; else failed++; };

function plot(n: number): World {
  const w = new World(1);
  const p = w.getOrCreatePlayer('bench', 'Bench', 1e9);
  p.tech = ['tr1'];
  const parcel = { id: w.nextId++, owner: p.id, name: 'bench', x: -n, y: -n, w: 2 * n + 1, h: 2 * n + 1, taxRate: 0, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = -n; y <= n; y++) for (let x = -n; x <= n; x++) { w.setParcelId(x, y, parcel.id); w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); }
  return w;
}
const lay = (w: World, a: [number, number], b: [number, number], cls: number) => layClass(w, roadDragPath(a, b), cls);
const envOf = (w: World) => ({ tile: (x: number, y: number) => w.getTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), land: () => null });

/** The trunk row 10 eastbound (9 back) from -TRUNK to TRUNK, crossed by street spurs at x = -SPUR and SPUR. */
const TRUNK = 90, SPUR = 80, TOP = -4;
function trunk(cls: number): World {
  const w = plot(TRUNK + 6);
  lay(w, [-TRUNK, 10], [TRUNK, 10], cls);
  for (const x of [-SPUR, SPUR]) {
    if (cls === RoadCls.Motorway) {
      lay(w, [x, TOP], [x, 8], RoadCls.Street); lay(w, [x, 11], [x, 26], RoadCls.Street);
      const plan = planInterchange(x, 9, envOf(w));
      if (!plan.ok) throw new Error(`interchange at ${x}: ${plan.reason}`);
      w.placeJunction(plan.tiles!);
    } else lay(w, [x, TOP], [x, 26], RoadCls.Street);
  }
  return w;
}

// ---- 1. door to door ---------------------------------------------------------------------------------------------
const DRIVERS = 16;
interface Trip { ticks: number; tiles: number; maxStep: number; maxEdges: number }
function trip(w: World, t: Traffic, id: number, from: [number, number], to: [number, number]): Trip | null {
  const f = findRoute(w, from[0], from[1], to[0], to[1], (x, y) => t.cost(x, y), 0.4, 40000);
  if (!f) return null;
  const m = { id, x: f.path[0] + 0.5, y: f.path[1] + 0.5, path: [...f.path], pi: 0, ...w.moverDefaults(id) } as Mover;
  let maxStep = 0, maxEdges = 0;
  w.tick = 0; t.beginTick();
  if (t.enter(m) !== 'ok') throw new Error('cannot enter');
  t.endTick();
  for (let tick = 1; tick < 3000; tick++) {
    w.tick = tick; t.beginTick();
    const x0 = m.x, y0 = m.y, p0 = m.pi;
    const r = t.step(m);
    t.endTick();
    maxStep = Math.max(maxStep, Math.hypot(m.x - x0, m.y - y0)); maxEdges = Math.max(maxEdges, m.pi - p0);
    if (r === 'arrived') return { ticks: tick, tiles: f.path.length / 2 - 1, maxStep, maxEdges };
    if (r === 'stuck') return null;
  }
  return null;
}
function journeys(cls: number) {
  const w = trunk(cls), t = new Traffic(w);
  const out: Trip[] = [];
  for (let i = 0; i < DRIVERS; i++) { const r = trip(w, t, 100 + i, [-SPUR, TOP], [SPUR, TOP]); if (r) out.push(r); }
  return out;
}
const mean = (a: number[]) => a.reduce((n, v) => n + v, 0) / (a.length || 1);

console.log(`motorway speed ${MW_SPEED} (street 1), route cost ${ROAD_CLASS_DEFS[RoadCls.Motorway].routeCost}; DRIVE_SPEED ${DRIVE_SPEED} tiles a tick`);
const classes: [string, number][] = [['street', RoadCls.Street], ['avenue', RoadCls.Avenue], ['motorway', RoadCls.Motorway]];
const res = classes.map(([name, cls]) => ({ name, trips: journeys(cls) }));
const street = mean(res[0].trips.map((r) => r.ticks));
console.log('\n| trunk | trips | tiles | door to door (ticks) | game minutes | against a street | fastest step (tiles a tick) | most edges in a tick |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of res) {
  const ticks = mean(r.trips.map((x) => x.ticks));
  console.log(`| ${r.name} | ${r.trips.length} | ${mean(r.trips.map((x) => x.tiles)).toFixed(0)} | ${ticks.toFixed(1)} | ${(ticks * 60 / TICKS_PER_HOUR).toFixed(0)} | ${(street / ticks).toFixed(2)}x | ${Math.max(...r.trips.map((x) => x.maxStep)).toFixed(2)} | ${Math.max(...r.trips.map((x) => x.maxEdges))} |`);
}
const mwTrips = res[2].trips;
ok(mwTrips.length === DRIVERS && res[0].trips.length === DRIVERS && res[1].trips.length === DRIVERS, 'every driver found a way on every trunk');
ok(Math.max(...mwTrips.map((x) => x.maxEdges)) <= 2, `a motorway car crosses at most two tile edges in a tick (${Math.max(...mwTrips.map((x) => x.maxEdges))})`);
const TOP_SPEED = DRIVE_SPEED * 1.12 * Math.max(1, MW_SPEED);
ok(Math.max(...mwTrips.map((x) => x.maxStep)) <= TOP_SPEED + 0.1, `and moves no further than its speed allows (${Math.max(...mwTrips.map((x) => x.maxStep)).toFixed(2)} of ${TOP_SPEED.toFixed(2)} tiles)`);
if (MW_SPEED >= 2.4) ok(street / mean(mwTrips.map((x) => x.ticks)) >= 1.75, `a 160-tile motorway trip with its ramps is about twice as fast as the street's (${(street / mean(mwTrips.map((x) => x.ticks))).toFixed(2)}x)`);

// ---- 2. a busy motorway ------------------------------------------------------------------------------------------
interface Flow { from: [number, number]; to: [number, number]; rate: number }
interface Busy { done: number; giveUps: number; overlaps: number; noRoute: number; maxEdges: number; maxStep: number; fastTicks: number; falls: number; dead: number; worstFall: number; mwTicks: number; mwPace: number; crawl: number }
const WARM = 200;
function busy(w: World, flows: Flow[], ticks: number, seed: number): Busy {
  const t = new Traffic(w), rnd = mulberry32(seed * 104729 + flows.length);
  const routes = new Map<string, number[]>();
  const route = (a: [number, number], b: [number, number]) => {
    const k = `${a}-${b}`;
    let r = routes.get(k);
    if (!r) { const f = findRoute(w, a[0], a[1], b[0], b[1], (x, y) => t.cost(x, y), 0.4, 40000); r = f ? f.path : []; routes.set(k, r); }
    return r;
  };
  const pending: Mover[][] = flows.map(() => []), active: Mover[] = [];
  const last = new Map<number, { x: number; y: number; pi: number; v: number }>();
  const r: Busy = { done: 0, giveUps: 0, overlaps: 0, noRoute: 0, maxEdges: 0, maxStep: 0, fastTicks: 0, falls: 0, dead: 0, worstFall: 0, mwTicks: 0, mwPace: 0, crawl: 0 };
  let id = 1;
  const h: [number, number] = [0, 0], g: [number, number] = [0, 0];
  for (let tick = 0; tick < WARM + ticks; tick++) {
    w.tick = tick; t.beginTick();
    flows.forEach((f, i) => {
      let L = Math.exp(-f.rate / TICKS_PER_HOUR), k = 0, p = rnd();
      while (p > L) { k++; p *= rnd(); }
      for (let n = 0; n < k; n++) {
        const path = route(f.from, f.to);
        if (path.length < 4) { r.noRoute++; continue; }
        const mid = id++;
        pending[i].push({ id: mid, x: path[0] + 0.5, y: path[1] + 0.5, path: [...path], pi: 0, ...w.moverDefaults(mid) } as Mover);
      }
      if (pending[i].length && t.enter(pending[i][0]) === 'ok') active.push(pending[i].shift()!);
    });
    active.sort((a, b) => a.id - b.id);
    for (let j = 0; j < active.length; j++) {
      const m = active[j], was = last.get(m.id);
      const res = t.step(m);
      if (was && tick >= WARM && res === 'moving') {
        const d = Math.hypot(m.x - was.x, m.y - was.y);
        r.maxStep = Math.max(r.maxStep, d); r.maxEdges = Math.max(r.maxEdges, m.pi - was.pi);
        if (d > 0.85) r.fastTicks++;
        if (Math.abs(m.y - 9.5) < 1.1 && Math.abs(m.x) < SPUR - 2) { r.mwTicks++; r.mwPace += d; if (d < 0.2) r.crawl++; }
        // a fall in speed: the comfortable braking is 0.2 a tick; a street's dead stop from its full pace is 0.5
        const fall = was.v - (m.v ?? 0);
        if (was.v > 0.7) { r.worstFall = Math.max(r.worstFall, fall); if (fall > 0.5) r.falls++; if (fall > 1) r.dead++; }
      }
      last.set(m.id, { x: m.x, y: m.y, pi: m.pi, v: m.v ?? 0 });
      if (res === 'arrived') { if (tick >= WARM) r.done++; active.splice(j--, 1); last.delete(m.id); }
      else if (res === 'stuck') { t.leave(m); if (tick >= WARM) r.giveUps++; active.splice(j--, 1); last.delete(m.id); }
    }
    t.endTick();
    if (tick < WARM) continue;
    const cars = active.filter((m) => m.lane >= 0);
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i], B = cars[j];
      if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 0.7) continue;
      if ((A.lane % 4 < 2) !== (B.lane % 4 < 2) && Math.abs(Math.abs(A.x) - SPUR) < 1.5 && Math.abs(A.y - 9.5) < 1.5 && Math.abs(B.y - 9.5) < 1.5) continue; // a street over the deck
      if (!t.headingOf(A, h) || !t.headingOf(B, g)) continue;
      if (obb(A.x, A.y, h[0], h[1], A.len, B.x, B.y, g[0], g[1], B.len)) r.overlaps++;
    }
  }
  r.mwPace = r.mwPace / (r.mwTicks || 1);
  return r;
}
/** the demand through both interchanges at load k (1: 30 an hour each way along, 8 to 10 on and off each slip) */
function flowsAt(k: number): Flow[] {
  const E_IN: [number, number] = [-TRUNK, 10], E_OUT: [number, number] = [TRUNK, 10], W_IN: [number, number] = [TRUNK, 9], W_OUT: [number, number] = [-TRUNK, 9];
  const NA: [number, number] = [-SPUR, TOP], NB: [number, number] = [SPUR, TOP];
  return [
    { from: E_IN, to: E_OUT, rate: 30 * k }, { from: W_IN, to: W_OUT, rate: 30 * k }, { from: NA, to: NB, rate: 10 * k }, { from: NB, to: NA, rate: 10 * k },
    { from: E_IN, to: NB, rate: 8 * k }, { from: W_IN, to: NA, rate: 8 * k }, { from: NA, to: E_OUT, rate: 8 * k }, { from: NB, to: W_OUT, rate: 8 * k },
  ];
}
const show = (label: string, r: Busy) => console.log(`\n${label}: ${r.mwTicks} car-ticks between the interchanges at a mean ${r.mwPace.toFixed(2)} tiles a tick (${((100 * r.crawl) / (r.mwTicks || 1)).toFixed(1)}% crawling); ${r.done} trips, ${r.giveUps} give-ups, ${r.overlaps} overlaps; longest step ${r.maxStep.toFixed(2)}, most edges ${r.maxEdges}, ${r.fastTicks} car-ticks over 0.85 tiles; falls in speed over 0.5: ${r.falls}, over 1.0: ${r.dead}, worst ${r.worstFall.toFixed(2)}`);
for (const [label, k] of [['busy motorway (load 1)', Number(arg('load', '1'))], ['overloaded interchanges (load 2)', 2 * Number(arg('load', '1'))]] as [string, number][]) {
  const r = busy(trunk(RoadCls.Motorway), flowsAt(k), Number(arg('ticks', '3000')), 3);
  show(label, r);
  ok(r.noRoute === 0 && r.done > 100, `${label}: every move routes and the motorway carries traffic (${r.done} trips)`);
  ok(r.overlaps === 0, `${label}: no car-car body overlaps (${r.overlaps})`);
  ok(r.maxEdges <= 2, `${label}: no car crosses more than two tile edges in a tick (${r.maxEdges})`);
  ok(r.maxStep <= TOP_SPEED + 0.1, `${label}: no car moves further than its top speed (${r.maxStep.toFixed(2)} against ${TOP_SPEED.toFixed(2)} tiles a tick)`);
  if (k === 1) {
    ok(r.giveUps <= Math.max(2, 0.02 * r.done), `few give-ups (${r.giveUps})`);
    ok(r.dead <= 0.001 * Math.max(1, r.fastTicks), `dead stops from speed (a fall of more than a tile a tick) are under 0.1% of the fast car-ticks (${r.dead} of ${r.fastTicks})`);
    if (MW_SPEED >= 2) ok(r.fastTicks > 100 && r.mwPace > 0.8, `cars do move at motorway pace (mean ${r.mwPace.toFixed(2)} tiles a tick)`);
  }
}

// ---- 3. a queue at a standing car ---------------------------------------------------------------------------------
{
  const w = plot(40);
  lay(w, [-30, 0], [30, 0], RoadCls.Motorway);
  const t = new Traffic(w);
  const f = findRoute(w, -30, 0, 30, 0, (x, y) => t.cost(x, y), 0.4, 40000);
  ok(!!f, 'a way along the motorway');
  if (f) {
    let id = 1, overlaps = 0, worstDrop = 0, hardStops = 0, stopped = 0;
    const cars: Mover[] = [];
    const h: [number, number] = [0, 0], g: [number, number] = [0, 0];
    const prev = new Map<number, number>();
    for (let tick = 0; tick < 700; tick++) {
      w.tick = tick; t.beginTick();
      // the first car is a blocker that stands 8 tiles short of the end; one car in 9 ticks follows it
      if (tick % 9 === 0 && cars.length < 12) {
        const mid = id++;
        const m = { id: mid, x: f.path[0] + 0.5, y: f.path[1] + 0.5, path: [...f.path], pi: 0, ...w.moverDefaults(mid) } as Mover;
        if (t.enter(m) === 'ok') cars.push(m);
      }
      for (const m of cars) {
        if (m.lane < 0) continue;
        if (m.id === 1 && m.pi >= f.path.length / 2 - 9) { m.v = 0; continue; } // the blocker stays where it is
        const r = t.step(m);
        if (r === 'arrived') t.leave(m);
        if (r === 'moving' && m.id !== 1 && (prev.get(m.id) ?? 0) > 0.7) { const drop = (prev.get(m.id) ?? 0) - (m.v ?? 0); worstDrop = Math.max(worstDrop, drop); if (drop > 0.5) { hardStops++; } }
        prev.set(m.id, m.v ?? 0);
      }
      t.endTick();
      const on = cars.filter((m) => m.lane >= 0);
      stopped = on.filter((m) => (m.v ?? 0) < 0.01).length;
      for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
        const A = on[i], B = on[j];
        if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 0.7) continue;
        if (!t.headingOf(A, h) || !t.headingOf(B, g)) continue;
        if (obb(A.x, A.y, h[0], h[1], A.len, B.x, B.y, g[0], g[1], B.len)) overlaps++;
      }
    }
    console.log(`\nqueue at a standing car: ${stopped} cars standing, ${overlaps} overlaps, worst fall in speed ${worstDrop.toFixed(2)}, ${hardStops} hard stops`);
    ok(stopped >= 3, `a queue formed behind the standing car (${stopped} standing)`);
    ok(overlaps === 0, `a queue of motorway traffic never overlaps (${overlaps})`);
    ok(hardStops === 0, `every car joining the queue brakes in time (${hardStops} falls of more than half a tile a tick; worst ${worstDrop.toFixed(2)})`);
  }
}


// ---- 4. ramps: the drawn path stays on the lane --------------------------------------------------------------------
// The client draws a car between the server's positions (client render/glide.ts: a cubic between the tick's positions, 60
// frames a second). At 1.4 tiles a tick that could cut the corner of a slip road. (Worst case measured: 0.145 tiles, at the lane change
// before an exit; the entry 0.062.) One car at a time through an exit, an
// entry and the whole trip: the lane's own centre line (the geometry the server places a car by, strands included) against
// the drawn positions.
{
  const w = trunk(RoadCls.Motorway), t = new Traffic(w);
  const trips: [string, [number, number], [number, number]][] = [['exit', [-TRUNK, 10], [SPUR, TOP]], ['entry', [-SPUR, TOP], [TRUNK, 10]], ['exit west', [TRUNK, 9], [-SPUR, TOP]]];
  for (const [name, from, to] of trips) {
    let worst = 0, n = 0, over = 0;
    for (let drv = 0; drv < 8; drv++) {
      const f = findRoute(w, from[0], from[1], to[0], to[1], (x, y) => t.cost(x, y), 0.4, 40000);
      if (!f) { ok(false, `ramps: a way for ${name}`); break; }
      const id = 500 + drv, m = { id, x: f.path[0] + 0.5, y: f.path[1] + 0.5, path: [...f.path], pi: 0, ...w.moverDefaults(id) } as Mover;
      w.tick = 0; t.beginTick(); if (t.enter(m) !== 'ok') throw new Error('cannot enter'); t.endTick();
      const nodes = f.path.length / 2, S3: [number, number, number][] = [];
      S3[m.pi] = [m.s0 ?? 0, m.s1 ?? 0, m.s2 ?? 0];
      const pts: [number, number][] = [[m.x, m.y]];
      for (let tick = 1; tick < 3000; tick++) {
        w.tick = tick; t.beginTick();
        const old: [number, number, number] = [m.s0 ?? 0, m.s1 ?? 0, m.s2 ?? 0], pi0 = m.pi;
        const r = t.step(m);
        t.endTick();
        if (r === 'arrived') break;
        const now: [number, number, number] = [m.s0 ?? 0, m.s1 ?? 0, m.s2 ?? 0];
        if (m.pi === pi0 + 2) S3[pi0 + 1] = [old[1], old[2], now[1]];
        S3[m.pi] = now;
        pts.push([m.x, m.y]);
      }
      // the lane's centre line: lane pi runs from node pi-1 to node pi, the strands as the car held them
      const line: [number, number][] = [], q: [number, number] = [0, 0];
      for (let pi = 1; pi < nodes; pi++) {
        const [ax, ay, bx, by] = [f.path[pi * 2 - 2], f.path[pi * 2 - 1], f.path[pi * 2], f.path[pi * 2 + 1]], d = dirBetween(ax, ay, bx, by);
        const inD = pi >= 2 ? dirBetween(f.path[pi * 2 - 4], f.path[pi * 2 - 3], ax, ay) : d, nd = pi + 1 < nodes ? dirBetween(bx, by, f.path[pi * 2 + 2], f.path[pi * 2 + 3]) : d, [s0, s1, s2] = S3[pi] ?? [0, 0, 0];
        for (let p = 0; p < 1; p += 0.02) {
          if (p < 0.5) pathPoint(ax, ay, inD, d, 0.5 + p, strandOffset(s0), q, strandOffset(s1)); else pathPoint(bx, by, d, nd, p - 0.5, strandOffset(s1), q, strandOffset(s2));
          line.push([q[0], q[1]]);
        }
      }
      // draw it: a position every tick, 60 frames a second
      const g: Glider = { x: pts[0][0], y: pts[0][1], px: pts[0][0], py: pts[0][1], tx: pts[0][0], ty: pts[0][1], gx: pts[0][0], gy: pts[0][1], m0x: 0, m0y: 0, m1x: 0, m1y: 0, vx: 0, vy: 0, g0: 0 };
      const ms = TICK_MS * STRETCH, dtf = 1000 / 60;
      for (let k = 1; k < pts.length; k++) {
        g.px = g.tx; g.py = g.ty; g.tx = pts[k][0]; g.ty = pts[k][1]; glideFrom(g, ms, (k - 1) * TICK_MS);
        for (let at = k * TICK_MS; at < (k + 1) * TICK_MS; at += dtf) {
          glide(g, (at - k * TICK_MS) / ms, ms);
          let best = Infinity;
          for (let i = 0; i + 1 < line.length; i++) {
            const [x0, y0] = line[i], dx = line[i + 1][0] - x0, dy = line[i + 1][1] - y0, l2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((g.x - x0) * dx + (g.y - y0) * dy) / l2));
            const dist = Math.hypot(g.x - (x0 + u * dx), g.y - (y0 + u * dy));
            if (dist < best) best = dist;
          }
          n++; worst = Math.max(worst, best); if (best > 0.1) over++;
        }
      }
    }
    console.log(`\nramps, ${name}: ${n} drawn frames, furthest from the lane's centre line ${worst.toFixed(3)} tiles, ${over} frames over 0.1`);
    ok(worst < 0.15, `ramps: the drawn ${name} stays within 0.15 tiles of the lane (${worst.toFixed(3)})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
