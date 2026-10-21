/**
 * Junction A/B bench (docs/traffic-tuning.md "Roundabouts and flyovers"): one busy crossroads under the real traffic
 * model (sim/traffic.ts), fed with synthetic demand, built four ways: give-way, signals, a roundabout and a flyover
 * (shared/src/junctions.ts).
 *
 *   npx tsx packages/server/src/loadtest/junctions.ts --rates 30,60,90,120 --seeds 1,2,3 --mix straight
 *   npx tsx packages/server/src/loadtest/junctions.ts --rates 60 --kinds roundabout --mix turns --set ringYield=0
 *
 * Two roads cross at (0, 0), each running ARM tiles out either side to a dead end. Cars appear at the four ends
 * (`--rates`: cars per game hour per approach, Poisson; a car waits off the map until its first lane has room, which
 * counts as delay) and drive to another end: `--mix straight` sends everyone straight over (the only thing a flyover
 * can serve), `--mix turns` 60% straight, 20% right, 20% left. Each run warms up for WARM ticks, then measures
 * `--ticks` ticks. Reported per kind and rate, means over the seeds:
 *
 *  - throughput: cars that completed the trip, per game hour (all four approaches together);
 *  - delay: mean game minutes per completed trip beyond its free-flow time (including the wait to get on);
 *  - give-ups: cars removed by the stuck rule (TRAFFIC_TUNING.stuckLimit);
 *  - backlog: cars still waiting to get on at the end (demand the junction could not take);
 *  - overlaps: car-car body overlaps per tick (oriented rectangles, path heading; a deck and the road under it never
 *    touch), the test probe-obb.mjs makes on the live wire.
 */
import {
  TICKS_PER_HOUR, TRAFFIC_TUNING, VEHICLE_WIDTH, DRIVE_SPEED, Terrain, packTile, planRoundabout, planFlyover, isFlyoverAux,
  planMiniRoundabout, planBigRoundabout, planInterchange, RoadCls, roadDragPath, junctionGroup, groupPhaseOf, signalTiming, isRoad, isClassAux,
  isRingClassAux, isDeckClassAux, carStepOk, inGroup, withArmState, turnAllowed, pelicanPhase, isMiniAux, implicitPelican, ruleLines,
  type JunctionGroup, type ServerMsg, type ClientMsg,
} from '@msimcity/shared';
import { World, emptyStats, tkey, type Mover, type Leg } from '../world';
import { Traffic } from '../sim/traffic';
import { findRoute } from '../pathfinding';
import { busLegs } from '../sim/busroute';
import { layClass, obb as obb2 } from './classbench';
import { Simulation } from '../sim/simulation';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { createGame } from '../game';
import type { Conn } from '../transport';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const ARM = 10, WARM = 300;
const TICKS = Number(arg('ticks', '2000'));
const RATES = arg('rates', '30,60,90').split(',').map(Number);
const SEEDS = arg('seeds', '1,2,3').split(',').map(Number);
const KINDS = arg('kinds', 'yield,signal,roundabout,flyover,mini').split(',') as Kind[];
const MIX = arg('mix', 'straight') as 'straight' | 'turns';
for (const kv of arg('set', '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k in TRAFFIC_TUNING)) throw new Error(`no tunable ${k}`);
  (TRAFFIC_TUNING as Record<string, number>)[k] = Number(v);
}
type Kind = 'yield' | 'signal' | 'roundabout' | 'flyover' | 'mini';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The crossroads, built as `kind`; the player owns it all (signals need the owner's technology). */
function build(kind: Kind): World {
  const w = new World(1);
  const p = w.getOrCreatePlayer('bench', 'Bench', 1e9);
  p.tech = kind === 'signal' ? ['tr1', 'tr2'] : ['tr1'];
  const parcel = { id: w.nextId++, owner: p.id, name: 'bench', x: -ARM - 2, y: -ARM - 2, w: 2 * ARM + 5, h: 2 * ARM + 5, taxRate: 0, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = -ARM - 2; y <= ARM + 2; y++) for (let x = -ARM - 2; x <= ARM + 2; x++) {
    w.setParcelId(x, y, parcel.id);
    w.setTile(x, y, packTile(Terrain.Grass, x === 0 || y === 0 ? Math.abs(x) <= ARM && Math.abs(y) <= ARM : false, 0, 0));
  }
  const env = { tile: (x: number, y: number) => w.getTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), land: () => null };
  if (kind === 'roundabout' || kind === 'flyover' || kind === 'mini') {
    const plan = kind === 'roundabout' ? planRoundabout(0, 0, env) : kind === 'mini' ? planMiniRoundabout(0, 0, env) : planFlyover(0, 0, env);
    if (!plan.ok) throw new Error(`${kind}: ${plan.reason}`);
    w.placeJunction(plan.tiles!);
  }
  return w;
}

const ENDS: [number, number][] = [[ARM, 0], [0, -ARM], [-ARM, 0], [0, ARM]]; // E, N, W, S (anticlockwise)
/** destination end for a car from end i: straight over, or a right or left turn (traffic drives on the right) */
const dest = (i: number, rnd: () => number) => {
  if (MIX === 'straight') return (i + 2) & 3;
  const u = rnd();
  return u < 0.6 ? (i + 2) & 3 : u < 0.8 ? (i + 1) & 3 : (i + 3) & 3; // from E heading W: right is N (i + 1), left is S
};

interface Res { through: number; delay: number; giveUps: number; backlog: number; overlaps: number; served: number }

function run(kind: Kind, rate: number, seed: number): Res {
  const rnd = mulberry32(seed * 7919 + rate * 31 + KINDS.indexOf(kind));
  const w = build(kind);
  const t = new Traffic(w);
  const routes = new Map<string, number[]>();
  const route = (a: number, b: number) => {
    const k = `${a}-${b}`;
    let r = routes.get(k);
    if (!r) {
      const f = findRoute(w, ENDS[a][0], ENDS[a][1], ENDS[b][0], ENDS[b][1], (x, y) => t.cost(x, y), 0.4, 20000);
      r = f ? f.path : [];
      routes.set(k, r);
    }
    return r;
  };
  const pending: { m: Mover; born: number; free: number }[][] = [[], [], [], []];
  const active: { m: Mover; born: number; free: number }[] = [];
  let id = 1, through = 0, delaySum = 0, giveUps = 0, overlapPairs = 0;
  const lambda = rate / TICKS_PER_HOUR; // cars per tick per approach
  const total = WARM + TICKS;
  const h: [number, number] = [0, 0], g: [number, number] = [0, 0];
  for (let tick = 0; tick < total; tick++) {
    w.tick = tick;
    const measuring = tick >= WARM;
    t.beginTick();
    // arrivals: Poisson per approach
    for (let i = 0; i < 4; i++) {
      let L = Math.exp(-lambda), k = 0, p = rnd();
      while (p > L) { k++; p *= rnd(); }
      for (let n = 0; n < k; n++) {
        const path = route(i, dest(i, rnd));
        if (path.length < 4) continue; // no way there (a turn at a flyover): not demand this junction can serve
        const mid = id++;
        const m = { id: mid, x: path[0] + 0.5, y: path[1] + 0.5, path: [...path], pi: 0, ...w.moverDefaults(mid) } as Mover;
        pending[i].push({ m, born: tick, free: (path.length / 2 - 1) / (DRIVE_SPEED * m.speedMul) });
      }
      const q = pending[i];
      if (q.length && t.enter(q[0].m) === 'ok') active.push(q.shift()!);
    }
    active.sort((a, b) => a.m.id - b.m.id);
    for (let j = 0; j < active.length; j++) {
      const a = active[j];
      const r = t.step(a.m);
      if (r === 'arrived') {
        if (measuring && a.born >= WARM) { through++; delaySum += tick - a.born - a.free; }
        active.splice(j--, 1);
      } else if (r === 'stuck') {
        t.leave(a.m);
        if (measuring) giveUps++;
        active.splice(j--, 1);
      }
    }
    t.endTick();
    if (!measuring) continue;
    // true body overlaps: every pair of cars on the road, oriented by lane geometry
    const cars = active.filter((a) => a.m.lane >= 0).map((a) => a.m);
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i], B = cars[j];
      if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 0.5) continue;
      const fa = isFlyoverAux(w.auxAt(Math.floor(A.x), Math.floor(A.y))), fb = isFlyoverAux(w.auxAt(Math.floor(B.x), Math.floor(B.y)));
      if ((fa || fb) && (A.lane % 4 < 2) !== (B.lane % 4 < 2)) continue; // deck over road: different levels
      if (!t.headingOf(A, h) || !t.headingOf(B, g)) continue;
      if (obb(A.x, A.y, h[0], h[1], A.len, B.x, B.y, g[0], g[1], B.len)) overlapPairs++;
    }
  }
  const backlog = pending.reduce((n, q) => n + q.length, 0);
  const hours = TICKS / TICKS_PER_HOUR;
  return { through: through / hours, delay: through ? (delaySum / through) * 60 / TICKS_PER_HOUR : 0, giveUps, backlog, overlaps: overlapPairs / TICKS, served: through };
}

function obb(ax: number, ay: number, ahx: number, ahy: number, al: number, bx: number, by: number, bhx: number, bhy: number, bl: number): boolean {
  const W2 = VEHICLE_WIDTH / 2;
  const axes = [[ahx, ahy], [-ahy, ahx], [bhx, bhy], [-bhy, bhx]];
  for (const [nx, ny] of axes) {
    const ra = (al / 2) * Math.abs(ahx * nx + ahy * ny) + W2 * Math.abs(-ahy * nx + ahx * ny);
    const rb = (bl / 2) * Math.abs(bhx * nx + bhy * ny) + W2 * Math.abs(-bhy * nx + bhx * ny);
    if (Math.abs((bx - ax) * nx + (by - ay) * ny) >= ra + rb - 1e-6) return false;
  }
  return true;
}


// ======================================================================================================== R4 probes
// (docs/roads.md "Junctions"): groups and phases, protected lefts, the median box, mini-roundabouts, the 5×5 ring, the
// diamond interchange, turn bans, signal crossings, saving; then the server's tools over a fake client. Skipped with
// --bench (the bench alone, as before R4).
let passed = 0, failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (cond) passed++; else failed++; };
/** An empty plot the bench player owns, with signals unless `noSignals`. */
function plot(n = 30, noSignals = false): World {
  const w = new World(1);
  const p = w.getOrCreatePlayer('bench', 'Bench', 1e9);
  p.tech = noSignals ? ['tr1'] : ['tr1', 'tr2'];
  const parcel = { id: w.nextId++, owner: p.id, name: 'bench', x: -n, y: -n, w: 2 * n + 1, h: 2 * n + 1, taxRate: 0, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = -n; y <= n; y++) for (let x = -n; x <= n; x++) { w.setParcelId(x, y, parcel.id); w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); }
  return w;
}
const lay = (w: World, a: [number, number], b: [number, number], cls: number) => layClass(w, roadDragPath(a, b), cls);
const envOf = (w: World) => ({ tile: (x: number, y: number) => w.getTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), land: () => null });
const roadOf = (w: World) => (x: number, y: number) => { const t = w.peekTile(x, y); return t !== undefined && isRoad(t); };
const clsOf = (w: World) => (x: number, y: number) => { const a = w.auxAt(x, y); return isClassAux(a) ? a : 0; };
/** Is a route's every step one a car may make (roadclass.ts carStepOk)? */
const legal = (w: World, path: number[]) => { for (let i = 0; i + 3 < path.length; i += 2) { const d = path[i + 2] > path[i] ? 0 : path[i + 2] < path[i] ? 1 : path[i + 3] > path[i + 1] ? 2 : 3; if (!carStepOk(w.auxAt(path[i], path[i + 1]), w.auxAt(path[i + 2], path[i + 3]), d)) return false; } return true; };
interface Flow { from: [number, number]; to: [number, number]; rate: number }
interface DemandRes { through: number; giveUps: number; overlaps: number; noRoute: number; done: number }
/** Few give-ups: at most 2% of the trips done (a queue's odd car on the stuck rule, not a lock). */
const few = (r: DemandRes) => r.giveUps <= Math.max(2, 0.02 * r.done);
/**
 * Run Poisson demand (cars an hour per flow) over w for `ticks` after `warm`, the real traffic model; `hook` sees the cars
 * on the road every tick (measuring or not). Car-car body overlaps counted every measured tick (path heading; a deck and
 * the road under it never touch).
 */
function demand(w: World, t: Traffic, flows: Flow[], ticks: number, seed: number, hook?: (cars: Mover[], tick: number) => void, warm = 200): DemandRes {
  const rnd = mulberry32(seed * 104729 + flows.length);
  const routes = new Map<string, number[]>();
  const route = (a: [number, number], b: [number, number]) => {
    const k = `${a}-${b}`;
    let r = routes.get(k);
    if (!r) { const f = findRoute(w, a[0], a[1], b[0], b[1], (x, y) => t.cost(x, y), 0.4, 40000); r = f ? f.path : []; routes.set(k, r); }
    return r;
  };
  const pending: Mover[][] = flows.map(() => []);
  const active: Mover[] = [];
  let id = 1, through = 0, giveUps = 0, overlaps = 0, noRoute = 0;
  const h: [number, number] = [0, 0], g: [number, number] = [0, 0];
  for (let tick = 0; tick < warm + ticks; tick++) {
    w.tick = tick;
    t.beginTick();
    flows.forEach((f, i) => {
      let L = Math.exp(-f.rate / TICKS_PER_HOUR), k = 0, p = rnd();
      while (p > L) { k++; p *= rnd(); }
      for (let n = 0; n < k; n++) {
        const path = route(f.from, f.to);
        if (path.length < 4) { noRoute++; continue; }
        const mid = id++;
        pending[i].push({ id: mid, x: path[0] + 0.5, y: path[1] + 0.5, path: [...path], pi: 0, ...w.moverDefaults(mid) } as Mover);
      }
      if (pending[i].length && t.enter(pending[i][0]) === 'ok') active.push(pending[i].shift()!);
    });
    active.sort((a, b) => a.id - b.id);
    for (let j = 0; j < active.length; j++) {
      const r = t.step(active[j]);
      if (r === 'arrived') { if (tick >= warm) through++; active.splice(j--, 1); }
      else if (r === 'stuck') { t.leave(active[j]); if (tick >= warm) giveUps++; active.splice(j--, 1); }
    }
    t.endTick();
    const cars = active.filter((m) => m.lane >= 0);
    hook?.(cars, tick);
    if (tick < warm) continue;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i], B = cars[j];
      if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 0.5) continue;
      const fa = isFlyoverAux(w.auxAt(Math.floor(A.x), Math.floor(A.y))) || isDeckClassAux(w.auxAt(Math.floor(A.x), Math.floor(A.y)));
      const fb = isFlyoverAux(w.auxAt(Math.floor(B.x), Math.floor(B.y))) || isDeckClassAux(w.auxAt(Math.floor(B.x), Math.floor(B.y)));
      if ((fa || fb) && (A.lane % 4 < 2) !== (B.lane % 4 < 2)) continue;
      if (!t.headingOf(A, h) || !t.headingOf(B, g)) continue;
      if (obb2(A.x, A.y, h[0], h[1], A.len, B.x, B.y, g[0], g[1], B.len)) overlaps++;
    }
  }
  return { through: through / (ticks / TICKS_PER_HOUR), giveUps, overlaps, noRoute, done: through };
}
/** The four ends of a crossroads of avenues (E-W rows 0 east / -1 west, N-S columns 0 south / 1 north) and the moves between them. */
function avenueCross(w: World, A = 14) {
  lay(w, [-A, 0], [A, 0], RoadCls.Avenue);
  lay(w, [0, -A], [0, A], RoadCls.Avenue);
  // ends: where a car comes in and where it leaves, for each arm (the carriageways of a divided road)
  const arms = { W: { in: [-A, 0], out: [-A, -1] }, E: { in: [A, -1], out: [A, 0] }, N: { in: [0, -A], out: [1, -A] }, S: { in: [1, A], out: [0, A] } } as Record<string, { in: [number, number]; out: [number, number] }>;
  return arms;
}
const allMoves = (arms: Record<string, { in: [number, number]; out: [number, number] }>, rate: number): Flow[] => {
  const out: Flow[] = [];
  for (const a of Object.keys(arms)) for (const b of Object.keys(arms)) if (a !== b) out.push({ from: arms[a].in, to: arms[b].out, rate });
  return out;
};

if (!argv.includes('--bench')) {
  // ---- 1. junction groups: one controller, the client's phases ------------------------------------------------
  {
    const w = plot();
    avenueCross(w);
    lay(w, [-10, -12], [-10, 12], RoadCls.Street); // a street over the E-W avenue: a two-tile group
    const t = new Traffic(w), road = roadOf(w), ca = clsOf(w);
    const g4 = junctionGroup(road, ca, 0, 0)!, g2 = junctionGroup(road, ca, -10, 0)!;
    ok(g4 && g4.x === 0 && g4.y === -1 && g4.w === 2 && g4.h === 2 && g4.phases === 4, `avenue x avenue: one group of four tiles anchored at its min corner, four phases (${JSON.stringify(g4)})`);
    ok(g2 && g2.x === -10 && g2.y === -1 && g2.w === 1 && g2.h === 2 && g2.phases === 2, `avenue x street: one group of two tiles, two phases (${JSON.stringify(g2)})`);
    const sv = t.groupOf(1, -1), sv2 = t.groupOf(-10, 0);
    ok(!!sv && sv.x === g4.x && sv.y === g4.y && !!sv2 && sv2.y === g2.y, 'the server sees the same groups as the shared function the client draws from');
    let agree = 0, total = 0, lefts = 0, signalled = 0;
    for (const g of [g4, g2]) for (let ty = g.y; ty < g.y + g.h; ty++) for (let tx = g.x; tx < g.x + g.w; tx++) if (t.junctionKind(tx, ty) === 'signal') signalled++;
    for (let tick = 0; tick < 400; tick++) {
      w.tick = tick;
      for (const g of [g4, g2]) {
        const want = groupPhaseOf(signalTiming(g.x, g.y), g.phases, tick);
        for (let ty = g.y; ty < g.y + g.h; ty++) for (let tx = g.x; tx < g.x + g.w; tx++) {
          const ph = t.signalPhase(tx, ty);
          total++;
          if (ph.green === want.green && ph.amber === want.amber && !!ph.left === !!want.left) agree++;
          if (ph.left) lefts++;
        }
      }
    }
    ok(signalled === 6, `every tile of both groups is signalled (${signalled} of 6)`);
    ok(agree === total && lefts > 0, `400 ticks: every group tile's phase is its anchor's, as the client works it out (${agree}/${total}; protected left phases ${lefts})`);
  }
  // ---- 2. protected lefts: nobody comes in against the phase; no overlaps ------------------------------------
  {
    const w = plot(), arms = avenueCross(w), t = new Traffic(w);
    const g = t.groupOf(0, 0)!;
    let bad = 0, lefts = 0, throughs = 0;
    const seen = new Set<number>();
    const r = demand(w, t, allMoves(arms, 3), 2400, 1, (cars) => {
      for (const m of cars) {
        if (!m.committed || seen.has(m.id) || m.pi < 1) continue;
        const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1], bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
        if (inGroup(g, ax, ay) || !inGroup(g, bx, by)) continue;
        seen.add(m.id);
        const inD = bx > ax ? 0 : bx < ax ? 1 : by > ay ? 2 : 3;
        let out = inD;
        for (let k = m.pi; k + 1 < m.path.length / 2; k++) if (!inGroup(g, m.path[k * 2 + 2], m.path[k * 2 + 3])) { const x0 = m.path[k * 2], y0 = m.path[k * 2 + 1], x1 = m.path[k * 2 + 2], y1 = m.path[k * 2 + 3]; out = x1 > x0 ? 0 : x1 < x0 ? 1 : y1 > y0 ? 2 : 3; break; }
        const left = out === [3, 2, 0, 1][inD] || out === [1, 0, 3, 2][inD];
        const ph = t.signalPhase(bx, by);
        if ((ph.green === 'ew') !== (inD < 2) || ph.amber || !!ph.left !== left) bad++;
        if (left) lefts++; else throughs++;
      }
    });
    ok(bad === 0 && lefts > 20 && throughs > 20, `four-phase avenue crossing, every move at 3/h: ${lefts} left turns and ${throughs} others came in, none against its phase (${bad})`);
    ok(r.overlaps === 0 && r.through > 30 && few(r), `no car-car body overlaps (${r.overlaps}); ${r.through.toFixed(0)} cars an hour through, ${r.giveUps} give-ups`);
  }
  // ---- 3. the median box: one car a way, used, no overlaps -----------------------------------------------------
  {
    const w = plot();
    lay(w, [-14, 0], [14, 0], RoadCls.Avenue); lay(w, [0, -14], [0, 14], RoadCls.Street);
    const t = new Traffic(w);
    let most = 0, used = 0;
    const flows: Flow[] = [
      { from: [0, -14], to: [0, 14], rate: 6 }, { from: [0, 14], to: [0, -14], rate: 6 }, // over the avenue
      { from: [-14, 0], to: [0, -14], rate: 4 }, { from: [14, -1], to: [0, 14], rate: 4 }, // left turns across it
      { from: [-14, 0], to: [14, 0], rate: 15 }, { from: [14, -1], to: [-14, -1], rate: 15 }, // along it
    ];
    const r = demand(w, t, flows, 2400, 2, (cars) => {
      const by = new Map<number, number>();
      for (const m of cars) if (m.med) { used++; by.set(m.lane, (by.get(m.lane) ?? 0) + 1); }
      for (const n of by.values()) most = Math.max(most, n);
    });
    ok(used > 20 && most <= 1, `the median box holds one car a way (most ${most}; ${used} car-ticks waiting in it)`);
    ok(r.overlaps === 0 && few(r), `no car-car body overlaps with cars in the median (${r.overlaps}); ${r.through.toFixed(0)}/h, ${r.giveUps} give-ups`);
  }
  // ---- 4. mini-roundabout: one car in the box at a time ---------------------------------------------------------
  {
    const w = plot(20, true);
    lay(w, [-12, 0], [12, 0], RoadCls.Street); lay(w, [0, -12], [0, 12], RoadCls.Street);
    const plan = planMiniRoundabout(0, 0, envOf(w));
    ok(plan.ok && plan.tiles!.length === 4, `a mini-roundabout plans on a street crossroads (${plan.reason ?? 'ok'})`);
    w.placeJunction(plan.tiles!);
    const t = new Traffic(w);
    ok(t.junctionKind(0, 0) === 'mini' && isMiniAux(w.auxAt(0, 0)) && isRoad(w.getTile(0, 0)), 'it is a road tile with the mini byte, and no lights');
    let most = 0;
    const ends: [number, number][] = [[12, 0], [0, -12], [-12, 0], [0, 12]];
    const flows: Flow[] = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) flows.push({ from: ends[a], to: ends[b], rate: 4 });
    const one = TRAFFIC_TUNING.miniOne;
    TRAFFIC_TUNING.miniOne = 1;
    demand(w, t, flows, 1200, 3, () => { most = Math.max(most, (t as unknown as { inBox(x: number, y: number): number }).inBox(0, 0)); });
    TRAFFIC_TUNING.miniOne = one;
    ok(most <= 1, `with miniOne, one car in the mini-roundabout's box at a time (most ${most})`);
    const r = demand(w, new Traffic(w), flows, 2400, 3);
    ok(r.overlaps === 0 && r.through > 40 && few(r), `${r.through.toFixed(0)} cars an hour round it, ${r.giveUps} give-ups, ${r.overlaps} overlaps`);
    const av = plot(); lay(av, [-12, 0], [12, 0], RoadCls.Avenue); lay(av, [-4, -12], [-4, 12], RoadCls.Street);
    const no = planMiniRoundabout(-4, 0, envOf(av));
    ok(!no.ok, `refused on an avenue: "${no.reason}"`);
  }
  // ---- 5. the 5×5 two-lane roundabout -------------------------------------------------------------------------
  {
    const w = plot(), arms = avenueCross(w);
    const plan = planBigRoundabout(0, 0, envOf(w));
    ok(plan.ok && plan.tiles!.length === 25 * 4, `a 5×5 roundabout plans on the avenue crossing (${plan.reason ?? 'ok'})`);
    w.placeJunction(plan.tiles!);
    let ring = 0, island = 0;
    for (let y = -3; y <= 1; y++) for (let x = -2; x <= 2; x++) { if (isRingClassAux(w.auxAt(x, y)) && isRoad(w.getTile(x, y))) ring++; if (w.auxAt(x, y) === 0xfc && !isRoad(w.getTile(x, y))) island++; }
    ok(ring === 16 && island === 9, `sixteen ring tiles round a nine-tile island (${ring}, ${island})`);
    const t = new Traffic(w);
    let inner = 0, outer = 0, innerShort = 0, wrong = 0;
    const r = demand(w, t, allMoves(arms, 5), 2400, 4, (cars) => {
      for (const m of cars) {
        const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1], bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
        if (!isRingClassAux(w.auxAt(ax, ay)) || !isRingClassAux(w.auxAt(bx, by))) continue;
        let n = 0;
        for (let k = 0; k * 2 < m.path.length; k++) if (isRingClassAux(w.auxAt(m.path[k * 2], m.path[k * 2 + 1]))) n++;
        if (m.s1) { inner++; if (n <= 9) innerShort++; } else outer++;
        const d = bx > ax ? 0 : bx < ax ? 1 : by > ay ? 2 : 3;
        if (!carStepOk(w.auxAt(ax, ay), w.auxAt(bx, by), d)) wrong++;
      }
    });
    ok(inner > 20 && outer > 20 && innerShort === 0, `both lanes used round the ring (inner ${inner}, outer ${outer} car-ticks), the inner only by cars going past the second exit (${innerShort} others)`);
    ok(wrong === 0 && r.overlaps === 0 && r.noRoute === 0 && r.through > 50 && few(r), `every move routes (${r.noRoute} without), nobody goes round the wrong way (${wrong}), ${r.overlaps} overlaps, ${r.through.toFixed(0)}/h, ${r.giveUps} give-ups`);
  }
  // ---- 6. the diamond interchange: all eight moves --------------------------------------------------------------
  {
    const w = plot(30);
    lay(w, [-28, 10], [28, 10], RoadCls.Motorway); // eastbound row 10, westbound 9
    lay(w, [0, -6], [0, 8], RoadCls.Street); lay(w, [0, 11], [0, 26], RoadCls.Street);
    const plan = planInterchange(0, 9, envOf(w));
    ok(plan.ok, `a diamond interchange plans where the street meets the motorway (${plan.reason ?? 'ok'})`);
    w.placeJunction(plan.tiles!);
    ok(isDeckClassAux(w.auxAt(0, 9)) && isDeckClassAux(w.auxAt(0, 10)), 'the motorway under the street is the deck class');
    const t = new Traffic(w), cost = (x: number, y: number) => t.cost(x, y);
    const E_IN: [number, number] = [-28, 10], E_OUT: [number, number] = [28, 10], W_IN: [number, number] = [28, 9], W_OUT: [number, number] = [-28, 9], N: [number, number] = [0, -6], S: [number, number] = [0, 26];
    const moves: [string, [number, number], [number, number]][] = [['eastbound to the north', E_IN, N], ['eastbound to the south', E_IN, S], ['westbound to the north', W_IN, N], ['westbound to the south', W_IN, S],
      ['north on eastbound', N, E_OUT], ['north on westbound', N, W_OUT], ['south on eastbound', S, E_OUT], ['south on westbound', S, W_OUT]];
    const found = moves.filter(([, a, b]) => { const r = findRoute(w, a[0], a[1], b[0], b[1], cost, 0.4, 40000); return r && legal(w, r.path); });
    ok(found.length === 8, `all eight moves between the street and the motorway route, legally (${found.map(([n]) => n).join('; ')})`);
    const over = findRoute(w, N[0], N[1], S[0], S[1], cost, 0.4, 40000);
    ok(!!over && over.path.some((v, i) => i % 2 === 0 && v === 0 && over.path[i + 1] === 9), 'the street runs straight over the deck');
    const through = findRoute(w, E_IN[0], E_IN[1], E_OUT[0], E_OUT[1], cost, 0.4, 40000);
    ok(!!through && through.path.every((v, i) => i % 2 === 1 ? v === 10 : true), 'motorway traffic stays on the motorway, under the deck');
    const flows: Flow[] = moves.map(([, a, b]) => ({ from: a, to: b, rate: 4 })).concat([{ from: E_IN, to: E_OUT, rate: 40 }, { from: W_IN, to: W_OUT, rate: 40 }, { from: N, to: S, rate: 6 }, { from: S, to: N, rate: 6 }]);
    const r = demand(w, t, flows, 2400, 5);
    ok(r.overlaps === 0 && r.noRoute === 0 && few(r) && r.through > 80, `driven: ${r.through.toFixed(0)} cars an hour, ${r.giveUps} give-ups, ${r.overlaps} overlaps (a car on the deck and one under it never count)`);
  }
  // ---- 7. turn bans and no entry: A*, the bus router, the re-route rule ----------------------------------------------
  {
    const w = plot(20);
    for (const x of [-8, 0, 8]) lay(w, [x, -12], [x, 12], RoadCls.Street);
    for (const y of [-8, 0, 8]) lay(w, [-12, y], [12, y], RoadCls.Street);
    const t = new Traffic(w), cost = (x: number, y: number) => t.cost(x, y);
    // from the south of (0, 0) to the west of it: the left turn there is the short way
    const before = findRoute(w, 0, 6, -6, 0, cost, 0.4, 40000)!;
    const lefts = (p: number[]) => { for (let i = 2; i + 3 < p.length; i += 2) if (p[i] === 0 && p[i + 1] === 0 && p[i - 1] === 1 && p[i + 2] === -1) return true; return false; };
    ok(lefts(before.path), 'without a sign the way from the south to the west turns left at the crossroads');
    w.setRoadRule(0, 0, withArmState(undefined, 2, 'noLeft')); // the south arm (DIRS 2): no left turn
    const after = findRoute(w, 0, 6, -6, 0, cost, 0.4, 40000);
    ok(!!after && !lefts(after.path), `with "no left turn" on the south arm A* goes round (${after ? after.path.length / 2 : 0} tiles against ${before.path.length / 2})`);
    const fire = findRoute(w, 0, 6, -6, 0, cost, 0.4, 40000, -1, Infinity, true, true);
    ok(!!fire && lefts(fire.path), 'a fire engine on a call turns left anyway (emergencies ignore turn bans)');
    const net = { w, cost, degree: (x: number, y: number) => t.degreeOf(x, y), crossing: () => false, depot: null };
    const bus = busLegs(net, 0, 6, 3, -6, 0).legs.find((l) => l);
    ok(!!bus && !lefts(bus.path), 'the bus router goes round too');
    w.setRoadRule(0, 0, withArmState(w.roadRuleAt(0, 0), 1, 'noEntry')); // the west arm: no entry
    const ne = findRoute(w, 6, 0, -6, 0, cost, 0.4, 40000), neFire = findRoute(w, 6, 0, -6, 0, cost, 0.4, 40000, -1, Infinity, true, true);
    const intoWest = (p: number[] | undefined) => !!p && p.some((v, i) => i % 2 === 0 && i >= 2 && p[i - 2] === 0 && p[i - 1] === 0 && v === -1 && p[i + 1] === 0);
    ok(!!ne && !intoWest(ne.path) && !!neFire && !intoWest(neFire.path), 'no entry to the west arm: nobody goes into it from the crossroads, a fire engine neither');
    ok(ruleLines(w.roadRuleAt(0, 0)).length === 2, `the tooltip lines: ${ruleLines(w.roadRuleAt(0, 0)).join('; ')}`);
    // the re-route rule: a driver whose way a new ban breaks finds another
    w.setRoadRule(0, 0, null);
    const sim = new Simulation(w);
    const m = { id: 1, x: 0.5, y: 6.5, path: [...findRoute(w, 0, 6, -6, 0, cost, 0.4, 40000)!.path], pi: 1, ...w.moverDefaults(1) } as Mover;
    m.rerouted = -1000;
    w.setRoadRule(0, 0, withArmState(undefined, 2, 'noLeft'));
    ok(sim.breaksRules(m, 1), 'with the ban up, the driver\'s way breaks it');
    (sim as unknown as { maybeReroute(m: Mover, l: Leg, f: boolean, b: boolean): void }).maybeReroute(m, { path: m.path } as unknown as Leg, true, true); // as recheckClasses does
    ok(!sim.breaksRules(m, 1) && !lefts(m.path), `and the re-route finds another (${m.path.length / 2} tiles)`);
    // a ruled junction that goes away takes its record with it
    w.setTile(0, 1, packTile(Terrain.Grass, false, 0, 0)); w.setTile(0, -1, packTile(Terrain.Grass, false, 0, 0));
    ok(!w.roadRuleAt(0, 0), 'a junction dug up to a plain road loses its signs');
  }
  // ---- 8. a signal crossing stops cars on its amber and red ------------------------------------------------------------
  {
    const w = plot(16, true);
    lay(w, [-14, 0], [14, 0], RoadCls.Street);
    w.setRoadRule(0, 0, { pelican: 1 });
    const t = new Traffic(w);
    ok(t.junctionKind(0, 0) === 'pelican', 'a placed signal crossing is one to the traffic');
    let into = 0, intoRed = 0;
    const seen = new Set<number>();
    const r = demand(w, t, [{ from: [-14, 0], to: [14, 0], rate: 60 }, { from: [14, 0], to: [-14, 0], rate: 60 }], 2400, 6, (cars, tick) => {
      if (tick % 23 === 0) t.pressPelican(0, 0); // a walker presses every so often
      const lamp = pelicanPhase(t.walkAtOf(0, 0), tick);
      for (const m of cars) {
        if (!m.committed || m.pi * 2 + 1 >= m.path.length || m.path[m.pi * 2] !== 0 || m.path[m.pi * 2 + 1] !== 0) continue;
        const k = m.id * 1000 + m.pi;
        if (seen.has(k)) continue;
        seen.add(k); into++;
        if (lamp === 'red' || lamp === 'amber') intoRed++;
      }
    });
    ok(into > 100 && intoRed === 0, `${into} cars drove onto the crossing, none on its amber or red (${intoRed}); ${r.through.toFixed(0)}/h, ${r.overlaps} overlaps`);
    const ps = plot(16, true);
    lay(ps, [-10, 0], [10, 0], RoadCls.Street); lay(ps, [0, -8], [0, -1], RoadCls.Pedestrian); lay(ps, [0, 1], [0, 8], RoadCls.Pedestrian);
    ok(implicitPelican(roadOf(ps), clsOf(ps), 0, 0) === 'ew' && new Traffic(ps).junctionKind(0, 0) === 'pelican', 'a pedestrian street crossing a street has a signal crossing by default');
  }
  // ---- 9. saving and loading -------------------------------------------------------------------------------------------
  {
    const w = plot(12);
    for (const x of [-4, 4]) lay(w, [x, -8], [x, 8], RoadCls.Street);
    lay(w, [-8, 0], [8, 0], RoadCls.Street);
    w.setRoadRule(-4, 0, withArmState(undefined, 0, 'noRight'));
    w.setRoadRule(0, 0, { pelican: 1 });
    const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
    const w2 = worldFromSnapshot(snap)!;
    ok(JSON.stringify(w2.roadRulesList()) === JSON.stringify(w.roadRulesList()) && w2.ruleTiles.size === 1, `saved and loaded: the road rules kept (${JSON.stringify(w2.roadRulesList())})`);
    delete snap.roadRules;
    const w3 = worldFromSnapshot(snap)!;
    ok(w3.roadRules.size === 0 && turnAllowed(w3.roadRuleAt(-4, 0), 1, 3), 'a save from before road rules loads with none');
    ok(snap.version === 8, 'the snapshot version is still 8');
  }
  // ---- 10. the server's tools over a fake client ------------------------------------------------------------------------
  {
    const w = plot(40);
    let accept: ((c: Conn) => void) | null = null;
    createGame(w, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox: true });
    const got: ServerMsg[] = [];
    let onMsg: ((d: string) => void) | null = null;
    accept!({ open: true, send: (d) => got.push(JSON.parse(d)), close() {}, onMessage: (fn) => { onMsg = fn; }, onClose() {} });
    const send = (m: ClientMsg) => onMsg!(JSON.stringify(m));
    const toast = () => (got.filter((m) => m.t === 'toast').at(-1) as { msg: string } | undefined)?.msg ?? '';
    send({ t: 'hello', name: 'Tess' });
    const me = w.players.get('tess')!;
    me.money = 100000; me.devUnlimited = false;
    const road = (a: [number, number], b: [number, number], cls = 0) => send({ t: 'build', tool: 'road', tiles: roadDragPath(a, b), cls, dev: true });
    road([-30, 0], [30, 0], RoadCls.Avenue); road([-20, -20], [-20, 20]); road([10, -20], [10, 20], RoadCls.Avenue);
    road([-30, 20], [30, 20]); road([-5, 15], [-5, 25]);
    road([-38, 34], [38, 34], RoadCls.Motorway); road([0, 25], [0, 32]);
    let m0 = me.money;
    send({ t: 'build', tool: 'miniroundabout', tiles: [[-5, 20]], dev: true });
    ok(isMiniAux(w.auxAt(-5, 20)) && m0 - me.money === 150, `the mini-roundabout tool: painted for $${m0 - me.money} ("${toast()}")`);
    m0 = me.money;
    send({ t: 'build', tool: 'roundabout', tiles: [[10, 0]], dev: true });
    ok(isRingClassAux(w.auxAt(8, -3)) && m0 - me.money === 1500, `the roundabout tool on an avenue crossing builds the 5×5 ($${m0 - me.money}: "${toast()}")`);
    m0 = me.money;
    send({ t: 'build', tool: 'interchange', tiles: [[0, 33]], dev: true });
    ok(isDeckClassAux(w.auxAt(0, 33)) && m0 - me.money === 2500, `the interchange tool ($${m0 - me.money}: "${toast()}")`);
    send({ t: 'build', tool: 'turnrule', tiles: [[-20, 1]], dev: true }); // the south arm of the avenue x street group at (-20, -1)
    const g = w.groupAt(-20, 0)!;
    ok(w.roadRuleAt(g.x, g.y)?.ban === (1 << (2 * 3 + 0)), `turn rules: one click on the south arm, no left turn ("${toast()}")`);
    for (let i = 0; i < 4; i++) send({ t: 'build', tool: 'turnrule', tiles: [[-20, 1]], dev: true });
    ok(!w.roadRuleAt(g.x, g.y), 'four more clicks go round to no sign');
    send({ t: 'build', tool: 'pelican', tiles: [[20, 20]], dev: true });
    ok(!!w.roadRuleAt(20, 20)?.pelican, `a signal crossing on a straight street ("${toast()}")`);
    send({ t: 'build', tool: 'pelican', tiles: [[-6, 20]], dev: true });
    ok(!w.roadRuleAt(-6, 20)?.pelican, `refused beside a junction ("${toast()}")`);
    send({ t: 'build', tool: 'pelican', tiles: [[20, 20]], dev: true });
    ok(!w.roadRuleAt(20, 20), 'clicked again: taken away');
    send({ t: 'build', tool: 'bulldoze', tiles: [[10, 0]], dev: true });
    ok(!isRingClassAux(w.auxAt(8, -3)) && isRoad(w.getTile(8, -3)) && w.auxAt(9, -1) === 0, `bulldozed: the big roundabout's ring is streets again, its island bare`);
    send({ t: 'build', tool: 'bulldoze', tiles: [[0, 33]], dev: true });
    ok(!isDeckClassAux(w.auxAt(0, 33)) && isRoad(w.getTile(0, 33)), 'the interchange\'s deck bulldozed: the motorway is whole again');
    ok(got.some((m) => m.t === 'roadRules'), 'clients are sent the road rules');
  }
  console.log(`\nR4 probes: ${passed} passed, ${failed} failed\n`);
}

console.log(`junction bench: mix ${MIX}, ${TICKS} ticks measured (${TICKS / TICKS_PER_HOUR} game hours) after ${WARM}, seeds ${SEEDS.join(',')}, ringYield ${TRAFFIC_TUNING.ringYield}`);
console.log('| junction | demand / h | throughput / h | mean delay (game min) | give-ups | backlog | car-car overlaps / tick |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const rate of RATES) for (const kind of KINDS) {
  const rs = SEEDS.map((s) => run(kind, rate, s));
  const mean = (f: (r: Res) => number) => rs.reduce((n, r) => n + f(r), 0) / rs.length;
  console.log(`| ${kind} | ${rate * 4} | ${mean((r) => r.through).toFixed(0)} | ${mean((r) => r.delay).toFixed(1)} | ${mean((r) => r.giveUps).toFixed(1)} | ${mean((r) => r.backlog).toFixed(0)} | ${mean((r) => r.overlaps).toFixed(3)} |`);
}

if (typeof failed === 'number' && failed) process.exit(1);
