/**
 * Bridge bench (docs/structures.md "Bridges"): a river seven tiles wide with one road bridge over it, under the real
 * traffic model (sim/traffic.ts) with synthetic demand, and the placement rules (shared/src/bridges.ts) checked first.
 *
 *   npx tsx packages/server/src/loadtest/bridges.ts --rates 30,60,90 --seeds 1,2,3
 *
 * The river runs north-south over x = -3..3. The main road runs east-west along y = 0 over the bridge: its west
 * landing (-4, 0) is a T-junction with a bank road along x = -4, its east landing (4, 0) a plain straight road with a
 * crossroads two tiles on at x = 6. Cars appear at the four ends (E, W, and the bank road's N and S ends; `--rates`
 * per game hour per end) and drive to a random other end, so most cross the bridge and some turn at the landing.
 * Reported per rate, means over the seeds: throughput, mean delay, give-ups, backlog, car-car overlaps per tick (as in
 * junctions.ts), and steps routed sideways onto or off the deck (must be 0).
 */
import {
  TICKS_PER_HOUR, VEHICLE_WIDTH, DRIVE_SPEED, Terrain, packTile, planBridge, joinsBridgeSide, isBridgeAux, bridgeNS, BRIDGE_MAX_SPAN,
  BridgeStyle, basculeSeed, basculeLiftAt, basculeOpen, BASCULE_LIFT,
} from '@msimcity/shared';
import { TOWER_BRIDGE } from '@msimcity/shared/src/buildings/landmarks-london-2';
import { World, emptyStats, type Mover } from '../world';
import { Traffic } from '../sim/traffic';
import { findRoute, findPath } from '../pathfinding';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const ARM = 12, WARM = 300, RIVER = 3;
const TICKS = Number(arg('ticks', argv.includes('--bascule') ? String(Math.round((BASCULE_LIFT + 2) * TICKS_PER_HOUR)) : '2000'));
const RATES = arg('rates', '30,60,90').split(',').map(Number);
const SEEDS = arg('seeds', '1,2,3').split(',').map(Number);
/** --land: the same roads with no river (the baseline: what the layout carries without a bridge) */
const LAND = argv.includes('--land');
/**
 * --bascule: the bridge is a bascule span (Tower Bridge), measured from an hour before its first lift to an hour after:
 * also counts car-ticks on the lifting leaves while they are open (must be 0) and on the span while it is open at all.
 */
const BASCULE = argv.includes('--bascule');

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failed = 0;
const check = (ok: boolean, what: string) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

function build(): World {
  const w = new World(1);
  const p = w.getOrCreatePlayer('bench', 'Bench', 1e9);
  p.tech = ['tr1'];
  const parcel = { id: w.nextId++, owner: p.id, name: 'bench', x: -ARM - 2, y: -ARM - 2, w: 2 * ARM + 5, h: 2 * ARM + 5, taxRate: 0, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = -ARM - 2; y <= ARM + 2; y++) for (let x = -ARM - 2; x <= ARM + 2; x++) {
    w.setParcelId(x, y, parcel.id);
    const wet = Math.abs(x) <= RIVER && !LAND;
    const road = (!wet || LAND) && ((y === 0 && Math.abs(x) <= ARM) || (x === -RIVER - 1 && Math.abs(y) <= ARM) || (x === RIVER + 3 && Math.abs(y) <= 4));
    w.setTile(x, y, packTile(wet ? Terrain.Water : Terrain.Grass, road, 0, 0));
  }
  return w;
}
const env = (w: World) => ({ tile: (x: number, y: number) => w.getTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), land: () => null });

// ---- placement rules
if (!LAND) {
  const w = build();
  const e = env(w);
  check(!planBridge(-RIVER, 1, 1, 0, 2 * RIVER + 1, e).ok, 'a bridge must land on a road at both ends (no road on y = 1)');
  check(!planBridge(-RIVER, 0, 1, 0, 2 * RIVER, e).ok, 'a bridge must reach dry land (one tile short)');
  check(!planBridge(-RIVER, 0, 1, 1, 2 * RIVER + 1, e).ok, 'a bridge runs straight');
  check(!planBridge(-RIVER, 0, 1, 0, BRIDGE_MAX_SPAN + 1, e).ok, `at most ${BRIDGE_MAX_SPAN} tiles`);
  const back = planBridge(RIVER, 0, -1, 0, 2 * RIVER + 1, e);
  const plan = planBridge(-RIVER, 0, 1, 0, 2 * RIVER + 1, e);
  check(plan.ok && plan.tiles!.length === 3 * (2 * RIVER + 1), `a ${2 * RIVER + 1}-tile bridge over the river: ${plan.reason ?? `$${plan.cost}, style ${plan.style}`}`);
  check(back.ok && back.tiles![0] === plan.tiles![0] && back.tiles![2] === plan.tiles![2], 'dragged either way, the same deck and style');
  w.placeBridge(plan.tiles!);
  check(!bridgeNS(w.auxAt(0, 0)) && isBridgeAux(w.auxAt(0, 0)), 'deck bytes say east-west');
  check(joinsBridgeSide(0, 1, (x, y) => w.auxAt(x, y)) && !joinsBridgeSide(RIVER + 1, 0, (x, y) => w.auxAt(x, y)), 'a road beside the deck is refused, one in line is not');
  check(!planBridge(0, -2, 0, 1, 1, e).ok, 'no bridge across a bridge');
  check(!w.hasRoadAccess(0, 1) || w.getTile(0, 1) === undefined, 'a deck is nobody\'s road access');
  // a lot on a ragged bank beside the deck is never reached from it
  w.setTile(1, 1, packTile(Terrain.Grass, false, 1, 1));
  const r = findPath(w, -ARM, 0, (x, y) => x === 1 && y === 1, 5000);
  check(!r, 'no path reaches a lot beside the deck from the deck');
  w.setTile(1, 1, packTile(Terrain.Water, false, 0, 0));
  const across = findRoute(w, -ARM, 0, ARM, 0, () => 1);
  check(!!across && across.path.length / 2 === 2 * ARM + 1, `cars route straight over (${across ? across.path.length / 2 : 0} tiles)`);
  w.removeBridge(0, 0);
  let gone = true;
  for (let x = -RIVER; x <= RIVER; x++) if (w.auxAt(x, 0) || (w.getTile(x, 0) & 4)) gone = false;
  check(gone, 'bulldozing one deck tile takes the whole bridge away');
  check(!findRoute(w, -ARM, 0, ARM, 0, () => 1, 0.4, 20000), 'and nothing crosses after');
}

// ---- traffic over the bridge
const ENDS: [number, number][] = [[ARM, 0], [-RIVER - 1, -ARM], [-ARM, 0], [-RIVER - 1, ARM]];
interface Res { through: number; delay: number; giveUps: number; backlog: number; overlaps: number; sideways: number; crossed: number; onLeaves: number; onSpan: number }
/** the bascule bench's clock: its first lift, and the tick the run starts at (WARM ticks before an hour ahead of it) */
const LIFT_SEED = basculeSeed(-RIVER, 0);
let liftStart = NaN;
for (let h = 0; h < 24 * 30 && Number.isNaN(liftStart); h += 0.01) liftStart = basculeLiftAt(LIFT_SEED, h);
const T0 = BASCULE ? Math.round((liftStart - 1) * TICKS_PER_HOUR) - WARM : 0;

function run(rate: number, seed: number): Res {
  const rnd = mulberry32(seed * 7919 + rate * 31);
  const w = build();
  if (!LAND) w.placeBridge(planBridge(-RIVER, 0, 1, 0, 2 * RIVER + 1, env(w), BASCULE ? BridgeStyle.Bascule : undefined).tiles!);
  // the leaves: the middle of the span, TOWER_BRIDGE.hinge either side of it in the model's 4 tiles, stretched to the span
  const mid = 0.5, leafHalf = (TOWER_BRIDGE.hinge * (2 * RIVER + 1)) / 4;
  let onLeaves = 0, onSpan = 0;
  const t = new Traffic(w);
  const routes = new Map<string, number[]>();
  let sideways = 0;
  const route = (a: number, b: number) => {
    const k = `${a}-${b}`;
    let r = routes.get(k);
    if (!r) {
      const f = findRoute(w, ENDS[a][0], ENDS[a][1], ENDS[b][0], ENDS[b][1], (x, y) => t.cost(x, y), 0.4, 20000);
      r = f ? f.path : [];
      for (let i = 2; i < r.length; i += 2) {
        const a0 = w.auxAt(r[i - 2], r[i - 1]), a1 = w.auxAt(r[i], r[i + 1]), along = (a: number, dy: number) => (bridgeNS(a) ? dy !== 0 : dy === 0);
        if ((isBridgeAux(a0) && !along(a0, r[i + 1] - r[i - 1])) || (isBridgeAux(a1) && !along(a1, r[i + 1] - r[i - 1]))) sideways++;
      }
      routes.set(k, r);
    }
    return r;
  };
  const pending: { m: Mover; born: number; free: number }[][] = [[], [], [], []];
  const active: { m: Mover; born: number; free: number }[] = [];
  let id = 1, through = 0, delaySum = 0, giveUps = 0, overlapPairs = 0, crossed = 0;
  const lambda = rate / TICKS_PER_HOUR;
  const h: [number, number] = [0, 0], g: [number, number] = [0, 0];
  for (let tick = 0; tick < WARM + TICKS; tick++) {
    w.tick = T0 + tick;
    const measuring = tick >= WARM;
    t.beginTick();
    for (let i = 0; i < 4; i++) {
      let L = Math.exp(-lambda), k = 0, p = rnd();
      while (p > L) { k++; p *= rnd(); }
      for (let n = 0; n < k; n++) {
        const to = (i + 1 + Math.floor(rnd() * 3)) & 3;
        const path = route(i, to);
        if (path.length < 4) continue;
        const mid = id++;
        const m = { id: mid, x: path[0] + 0.5, y: path[1] + 0.5, path: [...path], pi: 0, ...w.moverDefaults(mid) } as Mover;
        pending[i].push({ m, born: tick, free: (path.length / 2 - 1) / (DRIVE_SPEED * m.speedMul) });
        if ((i === 0) !== (to === 0)) crossed++;
      }
      const q = pending[i];
      if (q.length && t.enter(q[0].m) === 'ok') active.push(q.shift()!);
    }
    active.sort((a, b) => a.m.id - b.m.id);
    for (let j = 0; j < active.length; j++) {
      const a = active[j];
      const r = t.step(a.m);
      if (r === 'arrived') { if (measuring && a.born >= WARM) { through++; delaySum += tick - a.born - a.free; } active.splice(j--, 1); }
      else if (r === 'stuck') { t.leave(a.m); if (measuring) giveUps++; active.splice(j--, 1); }
    }
    t.endTick();
    if (!measuring) continue;
    const cars = active.filter((a) => a.m.lane >= 0).map((a) => a.m);
    const open = BASCULE ? basculeOpen(LIFT_SEED, w.tick / TICKS_PER_HOUR) : 0;
    if (open > 0) for (const m of cars) {
      if (Math.abs(m.y) > 1) continue;
      if (Math.abs(m.x - mid) < leafHalf + m.len / 2) onLeaves++;
      if (m.x > -RIVER && m.x < RIVER + 1) onSpan++;
    }
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i], B = cars[j];
      if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 0.5) continue;
      if (!t.headingOf(A, h) || !t.headingOf(B, g)) continue;
      if (obb(A.x, A.y, h[0], h[1], A.len, B.x, B.y, g[0], g[1], B.len)) overlapPairs++;
    }
  }
  const backlog = pending.reduce((n, q) => n + q.length, 0);
  return { through: through / (TICKS / TICKS_PER_HOUR), delay: through ? (delaySum / through) * 60 / TICKS_PER_HOUR : 0, giveUps, backlog, overlaps: overlapPairs / TICKS, sideways, crossed, onLeaves, onSpan };
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

console.log(`\nbridge bench${BASCULE ? `, bascule span lifting at ${(liftStart % 24).toFixed(2)} h on day ${Math.floor(liftStart / 24)}` : ''}: ${TICKS} ticks measured after ${WARM}, seeds ${SEEDS.join(',')}`);
console.log(`| demand / h | throughput / h | mean delay (game min) | give-ups | backlog | car-car overlaps / tick | sideways deck steps | trips over the bridge |${BASCULE ? ' car-ticks on the leaves while open | on the span while open |' : ''}`);
console.log(`| --- | --- | --- | --- | --- | --- | --- | --- |${BASCULE ? ' --- | --- |' : ''}`);
for (const rate of RATES) {
  const rs = SEEDS.map((s) => run(rate, s));
  const mean = (f: (r: Res) => number) => rs.reduce((n, r) => n + f(r), 0) / rs.length;
  console.log(`| ${rate * 4} | ${mean((r) => r.through).toFixed(0)} | ${mean((r) => r.delay).toFixed(1)} | ${mean((r) => r.giveUps).toFixed(1)} | ${mean((r) => r.backlog).toFixed(0)} | ${mean((r) => r.overlaps).toFixed(3)} | ${mean((r) => r.sideways)} | ${mean((r) => r.crossed).toFixed(0)} |${BASCULE ? ` ${mean((r) => r.onLeaves)} | ${mean((r) => r.onSpan)} |` : ''}`);
  if (rs.some((r) => r.sideways || r.onLeaves)) failed++;
}
if (failed) { console.log(`\n${failed} problem(s)`); process.exit(1); }
