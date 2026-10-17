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
import { TICKS_PER_HOUR, TRAFFIC_TUNING, VEHICLE_WIDTH, DRIVE_SPEED, Terrain, packTile, planRoundabout, planFlyover, isFlyoverAux } from '@msimcity/shared';
import { World, emptyStats, type Mover } from '../world';
import { Traffic } from '../sim/traffic';
import { findRoute } from '../pathfinding';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const ARM = 10, WARM = 300;
const TICKS = Number(arg('ticks', '2000'));
const RATES = arg('rates', '30,60,90').split(',').map(Number);
const SEEDS = arg('seeds', '1,2,3').split(',').map(Number);
const KINDS = arg('kinds', 'yield,signal,roundabout,flyover').split(',') as Kind[];
const MIX = arg('mix', 'straight') as 'straight' | 'turns';
for (const kv of arg('set', '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k in TRAFFIC_TUNING)) throw new Error(`no tunable ${k}`);
  (TRAFFIC_TUNING as Record<string, number>)[k] = Number(v);
}
type Kind = 'yield' | 'signal' | 'roundabout' | 'flyover';

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
  if (kind === 'roundabout' || kind === 'flyover') {
    const plan = kind === 'roundabout' ? planRoundabout(0, 0, env) : planFlyover(0, 0, env);
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

console.log(`junction bench: mix ${MIX}, ${TICKS} ticks measured (${TICKS / TICKS_PER_HOUR} game hours) after ${WARM}, seeds ${SEEDS.join(',')}, ringYield ${TRAFFIC_TUNING.ringYield}`);
console.log('| junction | demand / h | throughput / h | mean delay (game min) | give-ups | backlog | car-car overlaps / tick |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const rate of RATES) for (const kind of KINDS) {
  const rs = SEEDS.map((s) => run(kind, rate, s));
  const mean = (f: (r: Res) => number) => rs.reduce((n, r) => n + f(r), 0) / rs.length;
  console.log(`| ${kind} | ${rate * 4} | ${mean((r) => r.through).toFixed(0)} | ${mean((r) => r.delay).toFixed(1)} | ${mean((r) => r.giveUps).toFixed(1)} | ${mean((r) => r.backlog).toFixed(0)} | ${mean((r) => r.overlaps).toFixed(3)} |`);
}
