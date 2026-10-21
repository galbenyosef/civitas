/**
 * Road class bench (docs/roads.md "Classes", R3): one corridor under the real traffic model (sim/traffic.ts), built as a
 * street, a one-way street, an avenue or a motorway (shared/src/roadclass.ts), with a two-way street crossing it in the
 * middle, fed with synthetic demand along it and across it. Shared by the roads probe (loadtest/roads.ts) and runnable:
 *
 *   npx tsx packages/server/src/loadtest/classbench.ts --rates 60,120,240 --ticks 2000
 *
 * The corridor runs x = -ARM..ARM along y = 0 (a divided class adds its twin row at y = -1, going west); the street
 * crosses it at x = 0. Cars appear at the corridor's west end heading east (`rate` an hour) and, with `cross`, at the
 * street's ends going over or turning (a quarter of `rate` each). Reported: throughput, mean delay, give-ups and true
 * car-car body overlaps per tick, as junctions.ts reports them.
 */
import { TICKS_PER_HOUR, VEHICLE_WIDTH, DRIVE_SPEED, Terrain, packTile, planRoad, roadDragPath, RoadCls, ROAD_CLASS_DEFS, isRoad, terrainOf, type RoadEnv } from '@msimcity/shared';
import { World, emptyStats, type Mover } from '../world';
import { Traffic } from '../sim/traffic';
import { findRoute } from '../pathfinding';

export function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lay a drag of class `cls` on `w` as the server does (planRoad, then each tile's byte), on land the caller owns. */
export function layClass(w: World, path: [number, number][], cls: number) {
  const env: RoadEnv = {
    tile: (x, y) => w.getTile(x, y), aux: (x, y) => w.auxAt(x, y), kindId: (x, y) => w.kindIdAt(x, y),
    land: () => null, claimed: () => true, structure: () => undefined, bridgeLock: null,
  };
  const plan = planRoad(path, env, { cls, demolish: true });
  for (const tp of plan.tiles) {
    if (tp.state === 'new' || tp.state === 'demolish') { w.setTile(tp.x, tp.y, packTile(terrainOf(w.getTile(tp.x, tp.y)), true, 0, 0)); if (tp.byte) w.setRoadClass(tp.x, tp.y, tp.byte); }
    else if (tp.state === 'upgrade') w.setRoadClass(tp.x, tp.y, tp.byte ?? 0);
  }
  return plan;
}

export const ARM = 12;
export interface BenchRes { through: number; delay: number; giveUps: number; backlog: number; overlaps: number; served: number; tick: number }

/** The world for a corridor of class `cls` crossed by a street at x = 0. */
export function corridor(cls: number, cross = true): World {
  const w = new World(1);
  const p = w.getOrCreatePlayer('bench', 'Bench', 1e9);
  p.tech = ['tr1'];
  const parcel = { id: w.nextId++, owner: p.id, name: 'bench', x: -ARM - 3, y: -ARM - 3, w: 2 * ARM + 7, h: 2 * ARM + 7, taxRate: 0, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = -ARM - 3; y <= ARM + 3; y++) for (let x = -ARM - 3; x <= ARM + 3; x++) { w.setParcelId(x, y, parcel.id); w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); }
  if (cross) layClass(w, roadDragPath([0, -ARM], [0, ARM]), RoadCls.Street);
  layClass(w, roadDragPath([-ARM, 0], [ARM, 0]), cls);
  return w;
}

/**
 * Run demand over a corridor world: `rate` cars an hour from the west end east (and, divided, from the east end west
 * on the twin row), and with `cross` a quarter of that from each end of the crossing street, over or turning.
 */
export function bench(w: World, rate: number, seed: number, ticks: number, opts: { cross?: boolean; warm?: number } = {}): BenchRes {
  const rnd = mulberry32(seed * 7919 + rate * 31);
  const t = new Traffic(w);
  const divided = ROAD_CLASS_DEFS[w.auxAt(0, 0) & 7]?.divided && w.auxAt(0, 0) < 0x40 && w.auxAt(0, 0) > 0;
  const twinY = isRoad(w.getTile(-ARM + 1, -1)) ? -1 : null;
  // ends: corridor west and east (east only when two-way or divided), street north and south
  const ends: { at: [number, number]; to: [number, number][]; rate: number }[] = [];
  const W: [number, number] = [-ARM, 0], E: [number, number] = [ARM, twinY ?? 0], N: [number, number] = [0, -ARM], S: [number, number] = [0, ARM];
  const oneWay = ROAD_CLASS_DEFS[(w.auxAt(-ARM + 2, 0) & 7)]?.oneWay && w.auxAt(-ARM + 2, 0) > 0 && w.auxAt(-ARM + 2, 0) < 0x40;
  const eastIn: [number, number] = twinY !== null ? [ARM, twinY] : [ARM, 0], eastOut: [number, number] = [ARM, 0], westOut: [number, number] = twinY !== null ? [-ARM, twinY] : [-ARM, 0];
  ends.push({ at: W, to: [eastOut], rate });
  if (!oneWay || divided) ends.push({ at: eastIn, to: [westOut], rate });
  if (opts.cross ?? true) {
    ends.push({ at: N, to: [S, eastOut, westOut], rate: rate / 4 });
    ends.push({ at: S, to: [N, eastOut, westOut], rate: rate / 4 });
  }
  void divided; void E;
  const routes = new Map<string, number[]>();
  const route = (a: [number, number], b: [number, number]) => {
    const k = `${a}-${b}`;
    let r = routes.get(k);
    if (!r) { const f = findRoute(w, a[0], a[1], b[0], b[1], (x, y) => t.cost(x, y), 0.4, 20000); r = f ? f.path : []; routes.set(k, r); }
    return r;
  };
  const pending: { m: Mover; born: number; free: number }[][] = ends.map(() => []);
  const active: { m: Mover; born: number; free: number }[] = [];
  const warm = opts.warm ?? 300;
  let id = 1, through = 0, delaySum = 0, giveUps = 0, overlapPairs = 0;
  const h: [number, number] = [0, 0], g: [number, number] = [0, 0];
  for (let tick = 0; tick < warm + ticks; tick++) {
    w.tick = tick;
    const measuring = tick >= warm;
    t.beginTick();
    ends.forEach((e, i) => {
      const lambda = e.rate / TICKS_PER_HOUR;
      let L = Math.exp(-lambda), k = 0, p = rnd();
      while (p > L) { k++; p *= rnd(); }
      for (let n = 0; n < k; n++) {
        const to = e.to[Math.floor(rnd() * e.to.length)];
        const path = route(e.at, to);
        if (path.length < 4) continue;
        const mid = id++;
        const m = { id: mid, x: path[0] + 0.5, y: path[1] + 0.5, path: [...path], pi: 0, ...w.moverDefaults(mid) } as Mover;
        pending[i].push({ m, born: tick, free: (path.length / 2 - 1) / (DRIVE_SPEED * m.speedMul) });
      }
      const q = pending[i];
      if (q.length && t.enter(q[0].m) === 'ok') active.push(q.shift()!);
    });
    active.sort((a, b) => a.m.id - b.m.id);
    for (let j = 0; j < active.length; j++) {
      const a = active[j];
      const r = t.step(a.m);
      if (r === 'arrived') { if (measuring && a.born >= warm) { through++; delaySum += tick - a.born - a.free; } active.splice(j--, 1); }
      else if (r === 'stuck') { t.leave(a.m); if (measuring) giveUps++; active.splice(j--, 1); }
    }
    t.endTick();
    if (!measuring) continue;
    const cars = active.filter((a) => a.m.lane >= 0).map((a) => a.m);
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i], B = cars[j];
      if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 0.5) continue;
      if (!t.headingOf(A, h) || !t.headingOf(B, g)) continue;
      if (obb(A.x, A.y, h[0], h[1], A.len, B.x, B.y, g[0], g[1], B.len)) { overlapPairs++; if (process.env.BENCH_DEBUG) console.log(`overlap t${tick} #${A.id} (${A.x.toFixed(2)},${A.y.toFixed(2)}) s${A.s0 ?? 0}${A.s1 ?? 0}${A.s2 ?? 0} p${A.prog.toFixed(2)} pi${A.pi} | #${B.id} (${B.x.toFixed(2)},${B.y.toFixed(2)}) s${B.s0 ?? 0}${B.s1 ?? 0}${B.s2 ?? 0} p${B.prog.toFixed(2)} pi${B.pi}`); }
    }
  }
  const hours = ticks / TICKS_PER_HOUR;
  return { through: through / hours, delay: through ? (delaySum / through) * 60 / TICKS_PER_HOUR : 0, giveUps, backlog: pending.reduce((n, q) => n + q.length, 0), overlaps: overlapPairs / ticks, served: through, tick: ticks };
}

export function obb(ax: number, ay: number, ahx: number, ahy: number, al: number, bx: number, by: number, bhx: number, bhy: number, bl: number): boolean {
  const W2 = VEHICLE_WIDTH / 2;
  const axes = [[ahx, ahy], [-ahy, ahx], [bhx, bhy], [-bhy, bhx]];
  for (const [nx, ny] of axes) {
    const ra = (al / 2) * Math.abs(ahx * nx + ahy * ny) + W2 * Math.abs(-ahy * nx + ahx * ny);
    const rb = (bl / 2) * Math.abs(bhx * nx + bhy * ny) + W2 * Math.abs(-bhy * nx + bhx * ny);
    if (Math.abs((bx - ax) * nx + (by - ay) * ny) >= ra + rb - 1e-6) return false;
  }
  return true;
}

if (process.argv[1]?.endsWith('classbench.ts')) {
  const argv = process.argv.slice(2);
  const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const TICKS = Number(arg('ticks', '2000')), RATES = arg('rates', '60,120,240').split(',').map(Number), SEEDS = arg('seeds', '1,2').split(',').map(Number);
  const CLASSES = arg('classes', 'street,oneway,avenue,motorway').split(',');
  const cross = arg('cross', '1') === '1';
  const ids: Record<string, number> = { street: RoadCls.Street, lane: RoadCls.Lane, oneway: RoadCls.OneWay, avenue: RoadCls.Avenue, motorway: RoadCls.Motorway };
  console.log(`class bench: ${TICKS} ticks, seeds ${SEEDS.join(',')}, crossing street ${cross}`);
  console.log('| corridor | demand / h along | throughput / h | mean delay (min) | give-ups | backlog | car-car overlaps / tick |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const rate of RATES) for (const c of CLASSES) {
    const rs = SEEDS.map((s) => bench(corridor(ids[c], cross), rate, s, TICKS, { cross }));
    const mean = (f: (r: BenchRes) => number) => rs.reduce((n, r) => n + f(r), 0) / rs.length;
    console.log(`| ${c} | ${rate} | ${mean((r) => r.through).toFixed(0)} | ${mean((r) => r.delay).toFixed(1)} | ${mean((r) => r.giveUps).toFixed(1)} | ${mean((r) => r.backlog).toFixed(0)} | ${mean((r) => r.overlaps).toFixed(3)} |`);
  }
}
