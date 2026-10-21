/**
 * Traffic control probes (R5, docs/roads.md "Traffic control"): the street rules, the visitor limit, the lorry curfew,
 * the Traffic panel and the heat overlay's explanation, checked on small plots under the real traffic model and over a
 * fake client.
 *
 *   npx tsx packages/server/src/loadtest/control.ts
 *
 * Each rule is honoured by A*, the bus router (which the HGV ban leaves alone) and a driver's re-route; a lorry still
 * reaches a destination on a banned street; buses in a bus lane pass a queue and cars keep out of it; a car does not
 * park on double yellows; a 20 zone's speed and cost; the curfew holds a lorry until morning; rules survive saving,
 * a street's rename and a partial demolition, and an old save loads with none. Exit code 1 on any failure.
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, Terrain, VehicleClass, VehicleKind, packTile, roadDragPath, RoadCls, isRoad, StreetRule, STREET_RULE_BY_ID,
  ZONE20_COST, ZONE20_FREIGHT, streetRuleTiles, busLaneProblem, humpAt, JAM_WHY_STRIDE, VISITOR_LIMIT_SHARE, TRAFFIC_TUNING,
  type ServerMsg, type ClientMsg, type TrafficPanelInfo,
} from '@msimcity/shared';
import { World, emptyStats, tkey, type Mover, type Leg, type Vehicle } from '../world';
import { Traffic } from '../sim/traffic';
import { findRoute } from '../pathfinding';
import { busLegs } from '../sim/busroute';
import { layClass } from './classbench';
import { Simulation } from '../sim/simulation';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { createGame } from '../game';
import type { Conn } from '../transport';

let passed = 0, failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (cond) passed++; else failed++; };
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** An empty plot the bench player owns (signals and street rules researched). */
function plot(n = 30): World {
  const w = new World(1);
  const p = w.getOrCreatePlayer('bench', 'Bench', 1e9);
  p.tech = ['tr1', 'tr2', 'tr5'];
  const parcel = { id: w.nextId++, owner: p.id, name: 'bench', x: -n, y: -n, w: 2 * n + 1, h: 2 * n + 1, taxRate: 0.1, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = -n; y <= n; y++) for (let x = -n; x <= n; x++) { w.setParcelId(x, y, parcel.id); w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); }
  return w;
}
const lay = (w: World, a: [number, number], b: [number, number], cls: number = RoadCls.Street) => layClass(w, roadDragPath(a, b), cls);
const envOf = (w: World) => ({ road: (x: number, y: number) => { const t = w.peekTile(x, y); return t !== undefined && isRoad(t); }, aux: (x: number, y: number) => w.auxAt(x, y) });
const onPath = (p: number[] | undefined, x: number, y: number) => !!p && p.some((v, i) => i % 2 === 0 && v === x && p[i + 1] === y);
const usesAny = (p: number[] | undefined, tiles: [number, number][]) => tiles.some(([x, y]) => onPath(p, x, y));
/** A mover for the bare traffic model. */
const mover = (w: World, id: number, path: number[], cls: number = VehicleClass.Sedan): Mover => {
  const m = { id, x: path[0] + 0.5, y: path[1] + 0.5, path: [...path], pi: 0, ...w.moverDefaults(id) } as Mover;
  m.cls = cls; m.speedMul = 1;
  return m;
};

// ---- 1. the store: per tile, set per street, saved, renamed, partly demolished --------------------------------------
{
  const w = plot(16);
  lay(w, [-12, 0], [12, 0]); lay(w, [0, -8], [0, 8]); lay(w, [-12, 6], [12, 6]);
  const env = envOf(w);
  const street = streetRuleTiles(env, 3, 0, false, 'zone20');
  ok(street.length === 25 && street[0][0] === -12 && street.at(-1)![0] === 12, `a click sets the whole street: ${street.length} tiles, -12 to 12`);
  const changed = w.setStreetRules(street, StreetRule.Zone20, true);
  ok(changed.length === 25 && w.streetAt(5, 0) === StreetRule.Zone20 && w.streetAt(0, 3) === 0 && (w.streetAny & StreetRule.Zone20) !== 0, 'every tile of it carries the bit, the crossing street none');
  w.setStreetRules([[0, 0], [1, 0]], StreetRule.Hgv, true);
  ok(w.streetAt(0, 0) === (StreetRule.Hgv | StreetRule.Zone20), 'two rules on one tile are two bits of one record');
  // the street's name changes: the rules are on the tiles, not the name
  const run = w.streets.streetsAt(3, 0).find((r) => !r.ns)!;
  w.streets.rename(run, 'Acacia Avenue');
  ok(w.streets.nameOf(run) === 'Acacia Avenue' && w.streetAt(3, 0) === StreetRule.Zone20, 'renamed: the rule stays');
  // a partial demolition: the tile dug up loses its bits, the rest keep theirs
  w.setTile(6, 0, packTile(Terrain.Grass, false, 0, 0));
  ok(w.streetAt(6, 0) === 0 && !w.roadRuleAt(6, 0) && w.streetAt(5, 0) === StreetRule.Zone20 && w.streetAt(7, 0) === StreetRule.Zone20, 'a tile bulldozed out of the middle loses its rule; either side keep it');
  // saving and loading
  w.setRoadRule(-12, 6, { ...(w.roadRuleAt(-12, 6) ?? {}), gw: 1 });
  const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
  const w2 = worldFromSnapshot(snap)!;
  ok(JSON.stringify(w2.roadRulesList()) === JSON.stringify(w.roadRulesList()) && w2.streetAt(0, 0) === (StreetRule.Hgv | StreetRule.Zone20) && w2.streetAny === w.streetAny && w2.gatewayLimits === 1, `saved and loaded: ${w2.roadRules.size} records, the bits and the gateway limit kept`);
  delete snap.roadRules;
  const w3 = worldFromSnapshot(snap)!;
  ok(w3.roadRules.size === 0 && w3.streetAny === 0 && w3.streetAt(0, 0) === 0, 'a save from before R5 (no road rules) loads with none');
  ok(snap.version === 8, 'the snapshot version is still 8');
  // upkeep: the parcel's roads pay for their rules each day (24 tiles of zone left after the one bulldozed)
  const p = [...w.parcels.values()][0];
  w.recountRoads(p.id);
  const up = w.roadUpkeepOf(p);
  w.setStreetRules(street, StreetRule.Zone20, false);
  const up0 = w.roadUpkeepOf(p);
  ok(Math.abs(up - up0 - 24 * STREET_RULE_BY_ID.get('zone20')!.upkeep) < 1e-6, `the day's road upkeep counts the rules ($${up.toFixed(2)} with the 20 zone, $${up0.toFixed(2)} without)`);
}

// ---- 2. HGV ban: A*, access to a destination on the street, vans, the bus router, the re-route -----------------------
{
  const w = plot(20);
  // a grid: the direct way from west to east is along y = 0; y = -8 and 8 are the long ways round
  for (const x of [-12, 0, 12]) lay(w, [x, -10], [x, 10]);
  for (const y of [-8, 0, 8]) lay(w, [-14, y], [14, y]);
  const t = new Traffic(w), cost = (x: number, y: number) => t.cost(x, y);
  const banned = streetRuleTiles(envOf(w), -5, 0, false, 'hgv').filter(([x]) => x > -12 && x < 12 && x !== 0);
  const before = findRoute(w, -14, 0, 14, 0, cost, 0.4, 40000, -1, Infinity, false, false, true)!;
  ok(usesAny(before.path, banned), 'without a ban a lorry goes straight along y = 0');
  w.setStreetRules(banned, StreetRule.Hgv, true);
  const after = findRoute(w, -14, 0, 14, 0, cost, 0.4, 40000, -1, Infinity, false, false, true);
  ok(!!after && !usesAny(after.path, banned), `with the ban the lorry goes round (${after ? after.path.length / 2 : 0} tiles against ${before.path.length / 2})`);
  const car = findRoute(w, -14, 0, 14, 0, cost, 0.4, 40000);
  ok(!!car && usesAny(car.path, banned), 'a car (or a van, a bus) still goes along it');
  // a lorry delivering to a building on the banned street reaches it, along the banned street only from the nearest end
  w.setTile(5, 1, packTile(Terrain.Grass, false, 3, 1)); // a shop on the south side at x = 5
  const deliver = findRoute(w, -14, 0, 5, 1, cost, 0.4, 40000, -1, Infinity, false, false, true);
  ok(!!deliver && deliver.path.at(-2) === 5 && deliver.path.at(-1) === 1, `a lorry still reaches a shop on the banned street (${deliver ? deliver.path.length / 2 : 0} tiles)`);
  const inBan = deliver ? deliver.path.filter((v, i) => i % 2 === 0 && w.streetAt(v, deliver.path[i + 1]) & StreetRule.Hgv).length : 99;
  ok(inBan > 0 && inBan <= 7, `it drives the banned street only for access (${inBan} banned tiles, entering from the end nearest the shop)`);
  // the bus router does not read bans (buses are exempt)
  const net = { w, cost, degree: (x: number, y: number) => t.degreeOf(x, y), crossing: () => false, depot: null };
  const bus = busLegs(net, -14, 0, 0, 14, 0).legs.find((l) => l);
  ok(!!bus && usesAny(bus.path, banned), 'the bus router still runs buses along it');
  // the re-route: a lorry whose way a new ban breaks finds another
  w.setStreetRules(banned, StreetRule.Hgv, false);
  const sim = new Simulation(w);
  const route = findRoute(w, -14, 0, 14, 0, cost, 0.4, 40000, -1, Infinity, false, false, true)!;
  const v = { ...mover(w, 900001, route.path, VehicleClass.Truck), vkind: VehicleKind.Freight, pi: 1 } as unknown as Vehicle;
  v.rerouted = -1000;
  w.setStreetRules(banned, StreetRule.Hgv, true);
  ok(sim.control.breaksBan(v, 1), 'with the ban up, the lorry\'s way breaks it');
  (sim as unknown as { maybeReroute(m: Mover, l: Leg, f: boolean, b: boolean): void }).maybeReroute(v, { path: v.path } as unknown as Leg, true, true);
  ok(!sim.control.breaksBan(v, 1) && !usesAny(v.path.slice(2), banned), `and its re-route goes round (${v.path.length / 2} tiles)`);
  const cv = { ...mover(w, 900002, route.path), pi: 1 } as Mover;
  ok(!sim.control.breaksBan(cv, 1), 'a car on the same way is not affected');
  // the tool's ghost: the lorries' detour
  const probe = sim.control.probeBan(streetRuleTiles(envOf(w), -5, 0, false, 'hgv'));
  ok(probe.before > 0 && probe.after > probe.before, `the ghost's sample lorry: route cost ${probe.before} without the ban, ${probe.after} with it`);
}

// ---- 3. bus lane: buses pass the queue, cars keep out of the kerb lane ------------------------------------------------
{
  const run = (busLane: boolean) => {
    const w = plot(24);
    lay(w, [-22, 0], [22, 0], RoadCls.OneWay); // a one-way street east, two lanes
    lay(w, [10, -10], [10, 10]);              // crossed by a street with lights at x = 10
    if (busLane) {
      const tiles = streetRuleTiles(envOf(w), -5, 0, false, 'bus').filter(([x]) => x < 9);
      w.setStreetRules(tiles, StreetRule.BusLane, true);
    }
    const t = new Traffic(w), cost = (x: number, y: number) => t.cost(x, y);
    const straight = findRoute(w, -22, 0, 22, 0, cost, 0.4, 40000)!.path, right = findRoute(w, -22, 0, 10, 10, cost, 0.4, 40000)!.path;
    const rnd = mulberry32(17);
    const active: Mover[] = [], carsWaiting: Mover[] = [], busesWaiting: Mover[] = [];
    let id = 1, busTicks = 0, buses = 0, intoLane = 0, carTicks = 0, cars = 0;
    const born = new Map<number, number>();
    for (let tick = 0; tick < 4000; tick++) {
      w.tick = tick;
      t.beginTick();
      if (rnd() < 70 / TICKS_PER_HOUR) carsWaiting.push(mover(w, id++, rnd() < 0.25 ? right : straight));
      if (tick % 150 === 75) busesWaiting.push(mover(w, 100000 + id++, straight, VehicleClass.Bus));
      // each waits off the map until its first lane has room; its time on the street counts from when it gets on
      for (const q of [busesWaiting, carsWaiting]) if (q.length && t.enter(q[0]) === 'ok') { born.set(q[0].id, tick); active.push(q.shift()!); }
      active.sort((a, b) => a.id - b.id);
      for (let j = 0; j < active.length; j++) {
        const m = active[j], r = t.step(m);
        if (r === 'arrived' || r === 'stuck') {
          if (r === 'stuck') t.leave(m);
          if (r === 'arrived' && tick > 400) { if (m.cls === VehicleClass.Bus) { buses++; busTicks += tick - born.get(m.id)!; } else { cars++; carTicks += tick - born.get(m.id)!; } }
          active.splice(j--, 1);
        }
      }
      t.endTick();
      // a car in the kerb lane of a bus lane tile, not turning right out of the tile ahead
      for (const m of active) {
        if (m.cls === VehicleClass.Bus || m.lane < 0 || m.pi < 1 || m.pi + 1 >= m.path.length / 2) continue;
        const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1], bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
        if (!((w.streetAt(ax, ay) | w.streetAt(bx, by)) & StreetRule.BusLane) || (m.s1 ?? 0) !== 0) continue;
        const turnsRight = m.path[(m.pi + 1) * 2 + 1] > by; // going east, a right turn is south (y grows)
        if (!turnsRight) intoLane++;
      }
    }
    const waiting = carsWaiting;
    return { bus: buses ? busTicks / buses : Infinity, buses, car: cars ? carTicks / cars : Infinity, cars, intoLane, queued: waiting.length };
  };
  const off = run(false), on = run(true);
  ok(on.bus < off.bus * 0.85, `buses pass the queue: ${off.bus.toFixed(0)} ticks along the street without a bus lane, ${on.bus.toFixed(0)} with (${off.buses} and ${on.buses} buses)`);
  ok(on.intoLane === 0, `no car in the kerb lane but to turn off at the last tile (${on.intoLane} car-ticks)`);
  console.log(`     cars: ${off.car.toFixed(0)} ticks without, ${on.car.toFixed(0)} with (${off.cars} and ${on.cars} cars; ${off.queued} and ${on.queued} still waiting to get on)`);
  const w = plot(8);
  lay(w, [-6, 0], [6, 0]);
  ok(!!busLaneProblem(envOf(w), streetRuleTiles(envOf(w), 0, 0, false, 'bus')), `a two-way street refuses one: "${busLaneProblem(envOf(w), streetRuleTiles(envOf(w), 0, 0, false, 'bus'))}"`);
  ok(w.setStreetRules([[0, 0]], StreetRule.BusLane, true).length === 0, 'and the store never puts one there');
}

// ---- 4. double yellows: no kerb parking, the next street instead -------------------------------------------------------
{
  const w = plot(12);
  lay(w, [-10, 0], [10, 0]); lay(w, [0, -8], [0, 8]);
  const sim = new Simulation(w), t = sim.traffic;
  const path = findRoute(w, 0, 6, 6, 0, (x, y) => t.cost(x, y), 0.4, 40000)!.path; // up the north-south street, then east along y = 0
  const park = (sim as unknown as { kerbPark(m: Mover, p: number[]): void }).kerbPark.bind(sim);
  const a = { ...mover(w, 1, path), parkedAt: null, parkKerb: false } as unknown as Vehicle;
  a.x = 6.5; a.y = 0.5;
  park(a, path);
  ok(a.parkedAt === '5,0' || a.parkedAt === '6,0', `without double yellows a car parks at the kerb of its own street (${a.parkedAt})`);
  w.setStreetRules(streetRuleTiles(envOf(w), 6, 0, false, 'yellow'), StreetRule.NoParking, true);
  ok(t.kerbless(6, 0) && t.kerbless(-3, 0) && !t.kerbless(0, 5), 'double yellows make the street kerbless, not the one crossing it');
  const b = { ...mover(w, 2, path), parkedAt: null, parkKerb: false } as unknown as Vehicle;
  b.x = 6.5; b.y = 0.5;
  park(b, path);
  const [px, py] = (b.parkedAt ?? '0,0').split(',').map(Number);
  ok(b.parkedAt !== null && !(w.streetAt(px, py) & StreetRule.NoParking), `with them it parks on the next street back (${b.parkedAt}) and walks`);
}

// ---- 5. 20 zone: speed, route cost, lorries ---------------------------------------------------------------------------
{
  const w = plot(20);
  lay(w, [-18, 0], [18, 0]); lay(w, [-18, 4], [18, 4]); lay(w, [-18, -4], [-18, 4]); lay(w, [18, -4], [18, 4]);
  const t = new Traffic(w);
  const ticks = () => {
    const m = mover(w, 7, findRoute(w, -16, 0, 16, 0, (x, y) => t.cost(x, y), 0.4, 40000)!.path);
    t.enter(m);
    let n = 0;
    for (let tick = 0; tick < 2000; tick++) { w.tick = 10000 + tick; t.beginTick(); n++; const r = t.step(m); t.endTick(); if (r !== 'moving') break; }
    return n;
  };
  const free = ticks();
  const zone = streetRuleTiles(envOf(w), 0, 0, false, 'zone20');
  w.setStreetRules(zone, StreetRule.Zone20, true);
  const slow = ticks();
  ok(slow > free * 1.45 && slow < free * 1.85, `a car takes ${slow} ticks through the 20 zone against ${free} (60% speed: about ${(free / 0.6).toFixed(0)})`);
  const t0 = new Traffic(w); // no congestion yet
  ok(Math.abs(t0.cost(0, 0) - ZONE20_COST) < 1e-6 && t0.cost(0, 4) === 1, `a zone tile costs a route ${t0.cost(0, 0).toFixed(2)}, a street tile 1`);
  const sim = new Simulation(w);
  ok(Math.abs(sim.control.freightCost(0, 0) - ZONE20_COST * ZONE20_FREIGHT) < 1e-6, `and a lorry's route ${sim.control.freightCost(0, 0).toFixed(2)}`);
  // humps: four to six tiles apart along the zone, none on a junction
  const z = (x: number, y: number) => (w.streetAt(x, y) & StreetRule.Zone20) !== 0, j = (x: number, y: number) => t.degreeOf(x, y) >= 3;
  const humps = zone.filter(([x, y]) => humpAt(x, y, false, z, j)).map(([x]) => x);
  const gaps = humps.slice(1).map((x, i) => x - humps[i]);
  ok(humps.length >= 5 && gaps.every((g) => g >= 4 && g <= 6), `humps along the zone at x = ${humps.join(', ')}`);
  // through traffic goes the other way: y = 4 is now cheaper than y = 0 for a trip that could use either
  const way = findRoute(w, -18, 0, 18, 0, (x, y) => t.cost(x, y), 0.4, 40000)!;
  ok(onPath(way.path, 0, 4), 'a car crossing town takes the parallel street round the 20 zone');
}

// ---- 6. the lorry curfew holds a lorry until morning; the visitor limit -------------------------------------------------
{
  const w = plot(16);
  lay(w, [-14, 0], [14, 0]);
  w.setTile(-10, 1, packTile(Terrain.Grass, false, 4, 1)); // a works
  w.setTile(10, 1, packTile(Terrain.Grass, false, 3, 1));  // a shop
  const sim = new Simulation(w), p = w.players.get('bench')!;
  w.tick = TICKS_PER_DAY + 23 * TICKS_PER_HOUR; // 23:00
  const id0 = sim.spawnFreightTruck([-10, 1], [10, 1], 'bench')!;
  ok(id0 !== null && w.vehicles.get(id0)!.hold === undefined, 'no curfew: a lorry sets off at 23:00');
  p.policies = ['curfew'];
  const id = sim.spawnFreightTruck([-10, 1], [10, 1], 'bench')!;
  const v = w.vehicles.get(id)!;
  ok(v.hold !== undefined && v.hold >= 2 * TICKS_PER_DAY + 6 * TICKS_PER_HOUR && v.hold < 2 * TICKS_PER_DAY + 7 * TICKS_PER_HOUR && v.lane < 0, `with the curfew it waits at the works until ${((v.hold! % TICKS_PER_DAY) / TICKS_PER_HOUR).toFixed(2)}`);
  let gone = false;
  while (w.tick < v.hold! + 30) { sim.tick(); if (v.lane >= 0 || v.pi > 0) gone = true; }
  ok(gone && sim.control.curfew.held >= 1 && sim.control.curfew.released >= 1, 'and sets off once it is over');
  const m0 = p.money; sim.control.chargeCurfew();
  ok(m0 - p.money === 10, 'the curfew costs $10 a day');
  // the visitor limit: half are turned away
  const rnd = mulberry32(3);
  let kept = 0;
  for (let i = 0; i < 4000; i++) if (!sim.control.dropVisitor([0, 0], true, rnd)) kept++;
  ok(Math.abs(kept / 4000 - VISITOR_LIMIT_SHARE) < 0.03, `the limit lets in ${(100 * kept / 4000).toFixed(1)}% of visitors`);
  ok(!sim.control.dropVisitor([0, 0], false, rnd), 'no limit on an entry without one');
}

// ---- 7. why a car is held (the overlay's explanation) ------------------------------------------------------------------
{
  const w = plot(12);
  lay(w, [-10, 0], [10, 0]); lay(w, [0, -10], [0, 10]);
  const t = new Traffic(w);
  const path = findRoute(w, -10, 0, 10, 0, (x, y) => t.cost(x, y), 0.4, 40000)!.path;
  const cars: Mover[] = [];
  const seen = new Map<number, number>();
  for (let tick = 0; tick < 600; tick++) {
    w.tick = tick; t.beginTick();
    if (tick % 6 === 0 && cars.length < 12) { const m = mover(w, 50 + tick, path); if (t.enter(m) === 'ok') cars.push(m); }
    for (const m of cars) if (m.lane >= 0) t.step(m);
    t.endTick();
    for (const m of cars) { const why = t.whyHeld(m); seen.set(why, (seen.get(why) ?? 0) + 1); }
  }
  ok((seen.get(1) ?? 0) > 0 && (seen.get(0) ?? 0) > 0, `at the lights: held at a red ${seen.get(1) ?? 0}, following the car ahead ${seen.get(0) ?? 0}, moving ${seen.get(-1) ?? 0} (car-ticks)`);
}

// ---- 8. the tools over a fake client: street rules, undo, the probe, the gateway limit, the panel, jamWhy ----------------
{
  const w = plot(40);
  let accept: ((c: Conn) => void) | null = null;
  const game = createGame(w, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox: true });
  const got: ServerMsg[] = [];
  let onMsg: ((d: string) => void) | null = null;
  accept!({ open: true, send: (d) => got.push(JSON.parse(d)), close() {}, onMessage: (fn) => { onMsg = fn; }, onClose() {} });
  const send = (m: ClientMsg) => onMsg!(JSON.stringify(m));
  const toast = () => (got.filter((m) => m.t === 'toast').at(-1) as { msg: string } | undefined)?.msg ?? '';
  send({ t: 'hello', name: 'Tess' });
  const me = w.players.get('tess')!;
  me.money = 100000; me.devUnlimited = false; me.tech = ['tr1', 'tr2', 'tr5'];
  const road = (a: [number, number], b: [number, number], cls = 0) => send({ t: 'build', tool: 'road', tiles: roadDragPath(a, b), cls, dev: true });
  road([-30, 0], [30, 0]); road([-30, 10], [30, 10], RoadCls.OneWay); road([0, -20], [0, 20]);
  const street = streetRuleTiles(envOf(w), 5, 0, false, 'hgv');
  let m0 = me.money;
  send({ t: 'streetRule', rule: 'hgv', tiles: street, on: true });
  ok(street.every(([x, y]) => w.streetAt(x, y) & StreetRule.Hgv) && m0 - me.money === street.length * STREET_RULE_BY_ID.get('hgv')!.cost, `an HGV ban on a street: ${street.length} tiles, $${m0 - me.money} ("${toast()}")`);
  m0 = me.money;
  send({ t: 'undoStreetRule' });
  ok(street.every(([x, y]) => !(w.streetAt(x, y) & StreetRule.Hgv)) && me.money - m0 === street.length * STREET_RULE_BY_ID.get('hgv')!.cost, `undo takes it off and refunds it ("${toast()}")`);
  send({ t: 'streetRule', rule: 'bus', tiles: street, on: true });
  ok(!w.streetAt(5, 0) && /one-way street or an avenue/.test(toast()), `a bus lane on a two-way street is refused: "${toast()}"`);
  const ow = streetRuleTiles(envOf(w), 5, 10, false, 'bus');
  send({ t: 'streetRule', rule: 'bus', tiles: ow, on: true });
  ok(w.streetAt(5, 10) & StreetRule.BusLane && !(w.streetAt(0, 10) & StreetRule.BusLane), `on the one-way street it goes on, stopping short of its junction ("${toast()}")`);
  send({ t: 'streetRule', rule: 'zone20', tiles: [[3, 0], [4, 0], [5, 0]], on: true });
  ok(w.streetAt(4, 0) === StreetRule.Zone20 && !w.streetAt(6, 0), `a drag puts a 20 zone on part of a street ("${toast()}")`);
  send({ t: 'streetRule', rule: 'zone20', tiles: [[3, 0], [4, 0], [5, 0]], on: false });
  ok(!w.streetAt(4, 0), 'and takes it off again');
  send({ t: 'ruleProbe', rule: 'hgv', tiles: street, seq: 7 });
  const pr = got.filter((m) => m.t === 'ruleProbe').at(-1) as { seq: number; before: number; after: number } | undefined;
  ok(!!pr && pr.seq === 7 && pr.before > 0, `the ghost's probe answers (${JSON.stringify(pr)})`);
  // a gateway: a motorway connection at the west end
  send({ t: 'trafficPanel' });
  const panel = (got.filter((m) => m.t === 'trafficPanel').at(-1) as { info: TrafficPanelInfo } | undefined)?.info;
  ok(!!panel && typeof panel.onRoad.residents === 'number' && Array.isArray(panel.junctions) && Array.isArray(panel.streets) && Array.isArray(panel.gateways), `the Traffic panel answers (${JSON.stringify(panel?.onRoad)})`);
  send({ t: 'jamWhy', cx: 0, cy: 0 });
  const jw = got.filter((m) => m.t === 'jamWhy').at(-1) as { cx: number; u: number[] } | undefined;
  ok(!!jw && jw.cx === 0 && jw.u.length % JAM_WHY_STRIDE === 0, `jamWhy answers for the chunk (${jw ? jw.u.length / JAM_WHY_STRIDE : 0} tiles held)`);
  game.step();
  ok(got.some((m) => m.t === 'roadRules' && m.r.some((e) => e[2].st)), 'clients are sent the street rules in the road rules');
  void TRAFFIC_TUNING; void tkey;
}

console.log(`\nR5 probes: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
