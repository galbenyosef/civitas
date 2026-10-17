/**
 * Level-crossing probe (docs/rail.md "Level crossings"): traffic against trains on the real models.
 *
 *   npx tsx packages/server/src/loadtest/crossings.ts [--rate 120] [--hours 4] [--london 3]
 *
 * 1. The planners: track over a straight road makes a crossing; over a junction, a corner, a road end, starting or
 *    turning on the road, or along a road it is refused; a road over straight track makes one, over a curve not, and
 *    a road may not join a crossing along its track.
 * 2. A bench: one road east-west with a crossing in the middle, a shuttle line north-south over it, cars and buses
 *    from both ends (`--rate` per game hour per end) under sim/traffic.ts with the barriers from the timetable.
 *    Reported: barrier closures, the longest queue at the stop line, throughput, give-ups, and car-train overlaps
 *    (oriented rectangles, every tick and half tick of the trains); also that no car is ever inside the crossing box
 *    while a train covers it.
 * 3. London (`--london` game hours from 07:00, 0 to skip): the demo seeded as demo:check does, the barriers wired
 *    as game.ts does, the whole simulation run; every car, bus and walker on a level-crossing tile is checked
 *    against every train's vehicles each tick. Fails on any overlap.
 */
import {
  TICKS_PER_HOUR, TICKS_PER_DAY, VEHICLE_WIDTH, VEHICLE_LEN, DRIVE_SPEED, VehicleClass, Terrain, packTile, placedFromAnchor, planTrack, trackDragPath,
  routeLine, railService, trainsAt, trainPoses, crossingProblem, roadOverTrackProblem, barrierDown, isCrossing, crossingState, RAIL_HALT, RAIL_VEHICLE_LEN,
  type RailEnv, type RailLineDef, type RailService, type VehiclePose,
} from '@msimcity/shared';
import { World, emptyStats, tkey, type Mover } from '../world';
import { Traffic } from '../sim/traffic';
import { findRoute } from '../pathfinding';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const RATE = Number(arg('rate', '15')), HOURS = Number(arg('hours', '20')), LONDON = Number(arg('london', '3'));
let failures = 0;
const fail = (m: string) => { failures++; if (failures < 40) console.log('FAIL ' + m); };
const ok = (c: boolean, m: string) => { if (!c) fail(m); };

const TRAIN_W = 0.21;
function obb(ax: number, ay: number, ahx: number, ahy: number, al: number, aw: number, bx: number, by: number, bhx: number, bhy: number, bl: number, bw: number): boolean {
  const axes = [[ahx, ahy], [-ahy, ahx], [bhx, bhy], [-bhy, bhx]];
  for (const [nx, ny] of axes) {
    const ra = (al / 2) * Math.abs(ahx * nx + ahy * ny) + (aw / 2) * Math.abs(-ahy * nx + ahx * ny);
    const rb = (bl / 2) * Math.abs(bhx * nx + bhy * ny) + (bw / 2) * Math.abs(-bhy * nx + bhx * ny);
    if (Math.abs((bx - ax) * nx + (by - ay) * ny) >= ra + rb - 1e-6) return false;
  }
  return true;
}
/** train vehicles touching a body (len × wid, heading h) at (x, y) */
const hitsTrain = (poses: VehiclePose[], x: number, y: number, hx: number, hy: number, len: number, wid: number) =>
  poses.some((v) => (v.x - x) ** 2 + (v.z - y) ** 2 < 1.2 && obb(x, y, hx, hy, len, wid, v.x, v.z, Math.cos(v.h), Math.sin(v.h), RAIL_VEHICLE_LEN[v.kind], TRAIN_W));
const posesAt = (svcs: RailService[], tick: number) => svcs.flatMap((svc) => trainsAt(svc, tick).flatMap((st) => trainPoses(svc, st, [])));

// ---- 1. the planners -------------------------------------------------------------------------------------------
console.log('=== planners');
{
  const w = new World(5);
  for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0));
  const road = (x: number, y: number) => w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0));
  for (let x = -10; x <= 10; x++) road(x, 0);           // a straight road east-west
  for (let y = -10; y <= -1; y++) road(5, y);           // a side road north at x = 5 (a T at (5, 0))
  for (let x = -10; x <= -6; x++) road(x, 6);           // a corner at (-6, 6)
  for (let y = 7; y <= 10; y++) road(-6, y);
  const env: RailEnv & { land: () => null } = { tile: (x, y) => w.getTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y), land: () => null };
  const plan = (a: [number, number], b: [number, number]) => planTrack(trackDragPath(a, b), env);
  const p1 = plan([0, -5], [0, 5]);
  ok(p1.ok && p1.crossings === 1, `track straight over a straight road: ${p1.reason ?? `${p1.crossings} crossings`}`);
  ok(!plan([5, 3], [5, -0]).ok, 'track ending on the T junction is refused');
  ok(!plan([-6, 3], [-6, 9]).ok, 'track over a corner is refused');
  ok(!plan([0, 0], [0, 5]).ok, 'track starting on the road is refused');
  ok(plan([-3, -3], [-3, 3]).ok, 'a second crossing on the same road is fine');
  ok(!plan([-2, 0], [2, 0]).ok, 'track along the road is refused');
  ok(!!crossingProblem(env, 0, 0, 3), 'a curve over a road is refused');
  // lay one, then try the road tool
  for (let i = 0; i < p1.tiles!.length; i += 3) w.setAux(p1.tiles![i], p1.tiles![i + 1], p1.tiles![i + 2]);
  ok(isCrossing(w.getTile(0, 0), w.auxAt(0, 0)), 'the crossing tile is a road with a rail byte');
  ok(!!roadOverTrackProblem(env, 0, 1), 'a road may not join a crossing along its track');
  const p2 = plan([8, -5], [8, -1]); // a stub north of the road, then a road over a straight bit of it
  for (let i = 0; i < p2.tiles!.length; i += 3) w.setAux(p2.tiles![i], p2.tiles![i + 1], p2.tiles![i + 2]);
  ok(roadOverTrackProblem(env, 8, -3) === null, `a road over straight track: ${roadOverTrackProblem(env, 8, -3)}`);
  ok(!!roadOverTrackProblem(env, 8, -1), 'a road over a track end is refused');
}

// ---- 2. the bench --------------------------------------------------------------------------------------------
console.log('=== bench');
const ARM = 14, LINE = 30;
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
{
  const w = new World(9);
  const pl = w.getOrCreatePlayer('bench', 'Bench', 1e9);
  pl.tech = ['tr1', 'tr2']; // signals at the cross street
  const parcel = { id: w.nextId++, owner: pl.id, name: 'bench', x: -ARM - 4, y: -LINE - 4, w: 2 * ARM + 9, h: 2 * LINE + 9, taxRate: 0, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = -LINE - 4; y <= LINE + 4; y++) for (let x = -ARM - 4; x <= ARM + 4; x++) { w.setParcelId(x, y, parcel.id); w.setTile(x, y, packTile(Terrain.Grass, (y === 0 && Math.abs(x) <= ARM) || (x === 2 && Math.abs(y) <= ARM), 0, 0)); }
  const env = { tile: (x: number, y: number) => w.getTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y), land: () => null };
  const p = planTrack(trackDragPath([1, -LINE], [1, LINE]), env);
  if (!p.ok) throw new Error(p.reason);
  for (let i = 0; i < p.tiles!.length; i += 3) w.setAux(p.tiles![i], p.tiles![i + 1], p.tiles![i + 2]);
  const halt = (ay: number, r: number) => { const q = placedFromAnchor(RAIL_HALT, -1, ay, r); w.setTile(q.frontX, q.frontY, packTile(0, true, 0, 0)); w.placeStructure(q, { work: 300, priority: 0, built: true }); return [q.doorX, q.doorY] as [number, number]; };
  const a = halt(-LINE + 2, 3), b = halt(LINE - 6, 3); // west of the track, facing west
  const def: RailLineDef = { id: 1, owner: 'bench', number: 1, name: 'Line 1', color: 0xd63c3c, stations: [a, b], trains: 1, cars: 3, loop: false };
  const r = routeLine(def, env);
  if (!r.ok) throw new Error(r.reason);
  const svc = railService(def, r.route);
  const t = new Traffic(w);
  t.barrier = argv.includes('--open') ? null : (x, y) => barrierDown(svc, x, y, w.tick);
  if (argv.includes('--plain')) w.setAux(1, 0, 0); // no crossing at all: the baseline
  ok(t.isCrossingAt(1, 0), 'traffic sees the crossing');
  const rnd = mulberry32(7);
  // the main road east-west over the crossing, and a signalled cross street right beside it at x = 2: the worst case,
  // where a car coming off the crossing may meet a red
  const ENDS: [number, number][] = [[-ARM, 0], [ARM, 0], [2, -ARM], [2, ARM]];
  const route = (i: number, j: number) => findRoute(w, ENDS[i][0], ENDS[i][1], ENDS[j][0], ENDS[j][1], (x, y) => t.cost(x, y), 0.4, 20000)!.path;
  const paths = ENDS.map((_, i) => ENDS.map((__, j) => (i === j ? [] : route(i, j))));
  const pending: Mover[][] = [[], [], [], []];
  const active: Mover[] = [];
  let carCar = 0, id = 1, through = 0, giveUps = 0, overlaps = 0, inBoxClosed = 0, closures = 0, wasDown = false, maxQueue = 0, longestWait = 0;
  const lambda = RATE / TICKS_PER_HOUR;
  const t0 = 6 * TICKS_PER_HOUR, t1 = t0 + HOURS * TICKS_PER_HOUR;
  const h: [number, number] = [0, 0];
  for (let tick = t0; tick < t1; tick++) {
    w.tick = tick;
    t.beginTick();
    for (let i = 0; i < 4; i++) {
      let L = Math.exp(-lambda * (i < 2 ? 1 : 0.5)), k = 0, q = rnd();
      while (q > L) { k++; q *= rnd(); }
      for (let n = 0; n < k; n++) {
        const j = i < 2 && rnd() < 0.7 ? 1 - i : [0, 1, 2, 3].filter((e) => e !== i)[Math.floor(rnd() * 3)];
        const m = { id: id++, x: 0, y: 0, path: [...paths[i][j]], pi: 0, ...w.moverDefaults(id) } as Mover;
        if (rnd() < 0.2) m.cls = VehicleClass.Bus;
        pending[i].push(m);
      }
      if (pending[i].length && t.enter(pending[i][0]) === 'ok') active.push(pending[i].shift()!);
    }
    for (let j = 0; j < active.length; j++) {
      const res = t.step(active[j]);
      if (res === 'arrived') { through++; active.splice(j--, 1); }
      else if (res === 'stuck') { t.leave(active[j]); giveUps++; active.splice(j--, 1); }
    }
    t.endTick();
    const cars = active.filter((m) => m.lane >= 0);
    const g: [number, number] = [0, 0];
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i], B = cars[j];
      if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 0.5 || !t.headingOf(A, h) || !t.headingOf(B, g)) continue;
      if (obb(A.x, A.y, h[0], h[1], A.len, VEHICLE_WIDTH, B.x, B.y, g[0], g[1], B.len, VEHICLE_WIDTH)) carCar++;
    }
    const down = barrierDown(svc, 1, 0, tick);
    if (down && !wasDown) closures++;
    wasDown = down;
    // the queue at the stop lines: cars standing within 8 tiles of the crossing
    const q = active.filter((m) => m.lane >= 0 && m.wait > 2 && Math.abs(m.x - 1.5) < 8).length;
    maxQueue = Math.max(maxQueue, q);
    for (const m of active) longestWait = Math.max(longestWait, m.wait);
    // overlaps against the trains, at this tick and half way to the next (trains move 0.6 a tick)
    for (const tt of [tick, tick + 0.5]) {
      const poses = posesAt([svc], tt);
      if (!poses.length) continue;
      const covering = crossingState(svc, 1, 0, tt).down;
      for (const m of active) {
        if (m.lane < 0 || !t.headingOf(m, h)) continue;
        if (hitsTrain(poses, m.x, m.y, h[0], h[1], m.len, VEHICLE_WIDTH)) { overlaps++; if (overlaps < 5) fail(`car ${m.id} (len ${m.len}) at (${m.x.toFixed(2)}, ${m.y.toFixed(2)}) overlaps a train at tick ${tt} wait ${m.wait} prog ${m.prog.toFixed(2)} committed ${m.committed} pi ${m.pi} path ${m.path.slice(m.pi * 2 - 2, m.pi * 2 + 6)} holder ${(() => { const o = t.holderOf(m); return o ? `${o.id} at ${o.x.toFixed(2)},${o.y.toFixed(2)} lane ${o.lane % 4} prog ${o.prog.toFixed(2)} wait ${o.wait} committed ${o.committed} path ${o.path.slice(o.pi * 2 - 2, o.pi * 2 + 4)}` : "none"; })()} ${JSON.stringify(t.signalPhase(2, 0))}`); }
        if (covering && Math.floor(m.x) === 1 && Math.floor(m.y) === 0 && poses.some((v) => Math.abs(v.z - 0.5) < 0.6 + 0.45)) inBoxClosed++;
      }
    }
  }
  const hours = HOURS;
  console.log(`  ${RATE * 3} vehicles/h demand (20% buses), ${hours} h: ${closures} closures, throughput ${(through / hours).toFixed(0)}/h, longest queue ${maxQueue} vehicles, longest wait ${longestWait} ticks, give-ups ${giveUps}, backlog ${pending[0].length + pending[1].length}`);
  console.log(`  car-train overlaps: ${overlaps}; vehicles in the crossing box beside a train: ${inBoxClosed}; car-car overlaps ${(carCar / (HOURS * TICKS_PER_HOUR)).toFixed(3)} a tick`);
  ok(closures > 0, 'the barriers closed at least once');
  ok(overlaps === 0, `${overlaps} car-train overlaps`);
  ok(through > 0, 'cars got across');
}

// ---- 3. London -----------------------------------------------------------------------------------------------
if (LONDON > 0) {
  console.log(`=== London, ${LONDON} game hours from 07:00`);
  const { Simulation } = await import('../sim/simulation');
  const { Airports } = await import('../sim/airports');
  const { Rail } = await import('../sim/rail');
  const { seedDemoTown, seedDemoNetwork } = await import('../demo/seed');
  const w = new World(7);
  seedDemoTown(w, 'london');
  const sim = new Simulation(w);
  const airports = new Airports(w);
  const rail = new Rail(w, sim.transit);
  sim.transit.register(rail);
  sim.freight = rail;
  rail.trucks = { spawn: (from, to, owner) => sim.spawnFreightTruck(from, to, owner) };
  sim.traffic.barrier = (x, y) => rail.barrierDown(x, y);
  seedDemoNetwork(w, sim, rail, 'london');
  const xings: [number, number][] = [];
  for (const c of w.chunks.values()) for (let i = 0; i < c.aux.length; i++) if (isCrossing(c.tiles[i], c.aux[i])) xings.push([c.cx * 32 + (i % 32), c.cy * 32 + Math.floor(i / 32)]);
  console.log(`  ${xings.length} level crossings: ${xings.map(([x, y]) => `(${x}, ${y})`).join(' ')}`);
  ok(xings.length > 0, 'London has level crossings');
  const xset = new Set(xings.map(([x, y]) => tkey(x, y)));
  sim.tick();
  const svcs = () => rail.dtos().filter((d) => d.route && d.status === 'running').map((d) => railService(d, d.route!));
  // run to 07:00 on day 0
  while (w.tick % TICKS_PER_DAY < 7 * TICKS_PER_HOUR) { sim.tick(); airports.tick(); }
  const end = w.tick + LONDON * TICKS_PER_HOUR;
  let overlaps = 0, walkersOn = 0, carsOn = 0, closedTicks = 0, waitingCars = 0, waitingWalkers = 0;
  const h: [number, number] = [0, 0];
  const s = svcs();
  console.log(`  ${s.length} lines running`);
  while (w.tick < end) {
    sim.tick(); airports.tick();
    const rt = rail.railTick;
    for (const [x, y] of xings) if (rail.barrierDown(x, y)) closedTicks++;
    const poses = posesAt(s, rt);
    const movers: (Mover & { pts?: number[] | null })[] = [...w.citizens.values(), ...w.vehicles.values()] as never;
    for (const m of movers) {
      const tx = Math.floor(m.x), ty = Math.floor(m.y);
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) if (xset.has(tkey(tx + dx, ty + dy))) near = true;
      if (!near) continue;
      if (m.lane >= 0) {
        if (xset.has(tkey(tx, ty))) carsOn++;
        if (m.wait > 0) waitingCars++;
        if (!sim.traffic.headingOf(m, h)) continue;
        if (hitsTrain(poses, m.x, m.y, h[0], h[1], m.len, VEHICLE_WIDTH)) { overlaps++; if (overlaps < 6) fail(`London: vehicle ${m.id} at (${m.x.toFixed(2)}, ${m.y.toFixed(2)}) overlaps a train at ${rt}`); }
      } else if (m.pts) {
        if (xset.has(tkey(tx, ty))) walkersOn++;
        if (m.wait > 0) waitingWalkers++;
        if (hitsTrain(poses, m.x, m.y, 1, 0, 0.14, 0.14)) { overlaps++; if (overlaps < 6) fail(`London: walker ${m.id} at (${m.x.toFixed(2)}, ${m.y.toFixed(2)}) overlaps a train at ${rt}`); }
      }
    }
  }
  console.log(`  crossing-ticks closed ${closedTicks}; vehicle-ticks on crossings ${carsOn}, walker-ticks ${walkersOn}; held vehicle-ticks near a closed crossing ${waitingCars}, waiting walker-ticks near crossings ${waitingWalkers}`);
  console.log(`  train overlaps: ${overlaps}`);
  ok(overlaps === 0, `${overlaps} train overlaps in London`);
  ok(carsOn > 0, 'traffic uses the crossings');
}
void DRIVE_SPEED; void VEHICLE_LEN;
console.log(failures ? `${failures} failure(s)` : 'crossings probe passed');
process.exit(failures ? 1 : 0);
