/**
 * Road tool probe (docs/roads.md "The road tool", card af523039): the shared plan (shapes, snapping, costs, refusals,
 * buildings in the way, money, upgrade in place), then the server over fake clients: laying, asking before
 * demolishing (a0902fd7), undo (refund, refusals after the window, after a building appears beside it, after a
 * bulldozer), upgrade in place as a no-op that keeps a roundabout, and street names (named once, neighbours never
 * alike, the same on two servers, kept through a save and load, renamed by the owner only, addresses).
 *
 *   npx tsx packages/server/src/loadtest/roads.ts
 */
import {
  ROAD_COST, PUBLIC_ROAD_COST, BULLDOZE_COST, Zone, Terrain, packTile, isRoad, zoneOf, levelOf, withConstruction, KIND_ID, familyOf, subFor,
  roadDragPath, snapRoadEnd, planRoad, parallelGap, streetBase, streetName, ROAD_UNDO_MS, houseNumber, isJunctionAux,
  RoadCls, ROAD_CLASS_DEFS, junctionGroup, groupArms, signalledArms, classByte, auxClass, auxDir, auxJunction, oneWayDir, isClassAux, twinRow, carStepOk, edgeLanes, MSG_ROAD_FRONTAGE,
  type RoadEnv, type ServerMsg, type ClientMsg,
} from '@msimcity/shared';
import { findRoute } from '../pathfinding';
import { corridor, bench } from './classbench';
import { World } from '../world';
import { seedCommons } from '../seed';
import { createGame } from '../game';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import type { Conn } from '../transport';

let failed = 0, passed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (cond) passed++; else failed++; };
const key = (p: readonly (readonly [number, number])[]) => p.map(([x, y]) => `${x},${y}`).join(' ');

// ---- shapes ------------------------------------------------------------------------------------------------
{
  ok(key(roadDragPath([0, 0], [3, 0])) === '0,0 1,0 2,0 3,0', 'a straight drag: the tiles along it');
  ok(key(roadDragPath([0, 0], [2, 3])) === '0,0 0,1 0,2 0,3 1,3 2,3', 'an L: the longer axis first, one corner');
  ok(key(roadDragPath([0, 0], [2, 3], 'line', true)) === '0,0 1,0 2,0 2,1 2,2 2,3', 'an L the way the drag first went (along x)');
  const loop = roadDragPath([0, 0], [2, 2], 'loop');
  ok(loop.length === 8 && new Set(loop.map(String)).size === 8 && key(loop).startsWith('0,0 1,0 2,0 2,1 2,2 1,2 0,2 0,1'), `a loop: the eight tiles round a 3×3 (${key(loop)})`);
  ok(roadDragPath([0, 0], [0, 4], 'loop').length === 5, 'a loop one tile wide is a line');
  ok(roadDragPath([0, 0], [500, 0]).length === 256, 'a drag is at most 256 tiles');
  const roads = new Set(['5,0']);
  const snapped = snapRoadEnd([[0, 0], [1, 0], [2, 0], [3, 0]], (x, y) => roads.has(`${x},${y}`), () => true);
  ok(key(snapped) === '0,0 1,0 2,0 3,0 4,0', 'a drag stopping one tile short of a road gains the tile and meets it');
  ok(snapRoadEnd([[0, 0], [1, 0], [2, 0]], (x, y) => roads.has(`${x},${y}`), () => true).length === 3, 'two short: no snap');
  ok(snapRoadEnd([[0, 0], [1, 0], [2, 0], [3, 0]], (x, y) => roads.has(`${x},${y}`), () => false).length === 4, 'not across water');
  const grid = new Set<string>(); for (let x = 0; x < 10; x++) grid.add(`${x},5`);
  const g = parallelGap([[0, 0], [1, 0], [2, 0], [3, 0]], (x, y) => grid.has(`${x},${y}`));
  ok(g?.depth === 4 && g.side === 1, `the spacing guide: a street 5 rows away makes a block 4 deep (${JSON.stringify(g)})`);
  ok(parallelGap([[0, 0], [1, 0]], () => false) === null, 'nothing alongside: no guide');
}

// ---- the plan on a hand-made map ------------------------------------------------------------------------------
function env(map: Map<string, number>, opts: Partial<RoadEnv> & { mine?: (x: number, y: number) => boolean | null } = {}): RoadEnv {
  return {
    tile: (x, y) => map.get(`${x},${y}`) ?? packTile(Terrain.Grass, false, 0, 0),
    aux: () => 0,
    kindId: (x, y) => zoneOf(map.get(`${x},${y}`) ?? 0),
    land: (x, y) => { const m = opts.mine?.(x, y); return m === false ? 'Not your land' : null; },
    claimed: (x, y) => opts.mine?.(x, y) !== null,
    structure: () => undefined,
    bridgeLock: null,
    ...opts,
  };
}
{
  const map = new Map<string, number>();
  map.set('2,0', packTile(Terrain.Grass, false, Zone.Residential, 2)); // a house
  map.set('3,0', packTile(Terrain.Grass, false, Zone.Residential, 0)); // an empty lot
  map.set('4,0', withConstruction(packTile(Terrain.Grass, false, Zone.Residential, 0), true)); // a growth site
  map.set('5,0', withConstruction(packTile(Terrain.Grass, false, Zone.Hospital, 0), true)); // a hospital going up
  map.set('6,0', packTile(Terrain.Grass, true, 0, 0)); // road already
  const mine = (x: number) => (x >= 8 ? (x >= 9 ? false : null) : true); // 8 unclaimed, 9 someone else's
  const path = roadDragPath([0, 0], [9, 0]);
  const p = planRoad(path, env(map, { mine: (x) => mine(x) }));
  ok(p.tiles[2].state === 'demolish' && p.tiles[2].cost === ROAD_COST + BULLDOZE_COST, 'a house in the way: ask, road and the demolition fee');
  ok(p.tiles[3].state === 'new' && p.tiles[4].state === 'new', 'an empty lot and a growth site are paved over as before');
  ok(p.tiles[5].state === 'demolish' && p.tiles[5].site && p.tiles[5].cost === ROAD_COST, 'a civic building still being built counts as a building: ask (no fee)');
  ok(p.tiles[6].state === 'have', 'road already there is kept');
  ok(p.tiles[8].state === 'new' && p.tiles[8].unclaimed && p.tiles[8].cost === PUBLIC_ROAD_COST, 'unclaimed land: the public premium');
  ok(p.tiles[9].state === 'refused' && p.tiles[9].reason === 'Not your land', "someone else's land: refused, with the reason");
  ok(p.demolish.n === 2 && p.cost === 5 * ROAD_COST + PUBLIC_ROAD_COST - ROAD_COST + ROAD_COST, `without a yes the cost leaves the buildings out ($${p.cost}) and they are listed (${p.demolish.n})`);
  const yes = planRoad(path, env(map, { mine: (x) => mine(x) }), { demolish: true });
  ok(yes.cost === p.cost + p.demolish.cost && yes.fresh === p.fresh + 2, `with a yes: $${yes.cost}, ${yes.fresh} new tiles`);
  const broke = planRoad(path, env(map, { mine: (x) => mine(x) }), { budget: 25 });
  ok(broke.tiles[0].state === 'new' && broke.tiles[1].state === 'new' && broke.tiles[3].reason === 'Not enough money' && broke.short > 0, 'money runs out along the drag: the rest is refused for it');
  // water: needs the technology, and a bridge plan otherwise
  const wet = new Map<string, number>([['1,0', packTile(Terrain.Water, false, 0, 0)], ['2,0', packTile(Terrain.Water, false, 0, 0)]]);
  const w1 = planRoad(roadDragPath([0, 0], [3, 0]), env(wet, { bridgeLock: 'Civil engineering' }));
  ok(w1.tiles[1].state === 'refused' && /Civil engineering is needed to bridge water/.test(w1.tiles[1].reason ?? ''), 'water without the bridge technology: red, and why');
  const w2 = planRoad(roadDragPath([0, 0], [3, 0]), env(wet));
  ok(w2.bridges.length === 1 && w2.bridges[0].plan.ok && w2.fresh === 4, `with it: a bridge of 2 between the new banks ($${w2.cost})`);
  const w3 = planRoad(roadDragPath([0, 0], [2, 0]), env(wet));
  ok(!w3.bridges[0].plan.ok && w3.tiles[2].state === 'refused', 'released over the water: the bridge is refused (it must reach dry land)');
  // upgrade in place (R3): a road of another class is upgraded; a tile with a ring, bridge or crossing byte keeps it (a street)
  const up = planRoad(roadDragPath([0, 0], [2, 0]), env(new Map([['1,0', packTile(Terrain.Grass, true, 0, 0)]]), { roadClass: () => 1 }));
  ok(up.tiles[1].state === 'upgrade' && up.upgrade === 1 && up.tiles[0].state === 'new', 'a road of another class is upgraded in place');
  const ring = planRoad(roadDragPath([0, 0], [2, 0]), env(new Map([['1,0', packTile(Terrain.Grass, true, 0, 0)]]), { aux: (x) => (x === 1 ? 0xf0 : 0) }), { cls: RoadCls.Avenue });
  ok(ring.tiles.find((t) => t.x === 1 && t.y === 0)?.state === 'have', 'a roundabout ring tile keeps its byte under a class drag');
}

// ---- the server ------------------------------------------------------------------------------------------------
function setup(world: World, sandbox = false) {
  let accept: ((c: Conn) => void) | null = null;
  const game = createGame(world, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox });
  const client = (name: string) => {
    const got: ServerMsg[] = [];
    let onMsg: ((d: string) => void) | null = null;
    accept!({ open: true, send: (d) => got.push(JSON.parse(d)), close() {}, onMessage: (fn) => { onMsg = fn; }, onClose() {} });
    const send = (m: ClientMsg) => onMsg!(JSON.stringify(m));
    send({ t: 'hello', name });
    const toasts = () => got.filter((m): m is Extract<ServerMsg, { t: 'toast' }> => m.t === 'toast').map((m) => m.msg);
    const last = <T extends ServerMsg['t']>(t: T) => got.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
    return { got, send, toasts, toast: () => toasts().at(-1) ?? '', last, id: name.toLowerCase() };
  };
  return { game, client };
}

const world = new World(4242);
seedCommons(world, 0);
const { game, client } = setup(world);
const a = client('Ada');
const p = world.players.get(a.id)!;
p.money = 50_000;
p.tech = [...p.tech, 'publicRoads', 'bridges'];
// Ada's land east of the Commons (whose east edge road is x = 10)
a.send({ t: 'buy', x: 11, y: -11, w: 20, h: 22 });
const own = (x: number, y: number) => world.parcelAt(x, y)?.owner === a.id;
ok(own(11, 0) && own(30, 10), "Ada owns 20×22 east of the Commons");

{
  const m0 = p.money;
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([11, -5], [20, 0]) });
  const laid = roadDragPath([11, -5], [20, 0]).every(([x, y]) => isRoad(world.getTile(x, y)));
  ok(laid && m0 - p.money === 15 * ROAD_COST, `an L of 15 tiles laid in one go for $${m0 - p.money}`);
  // undo
  a.send({ t: 'undoRoad' });
  ok(!isRoad(world.getTile(15, -5)) && p.money === m0 && /Undone: 15 tiles of road, \$150 back/.test(a.toast()), `Ctrl+Z: the drag is taken back and refunded ("${a.toast()}")`);
  a.send({ t: 'undoRoad' });
  ok(/Nothing to undo/.test(a.toast()), 'a second undo: nothing to undo');
  // after the window
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([11, -5], [20, -5]) });
  const t0 = Date.now();
  game.net.now = () => t0 + ROAD_UNDO_MS + 1000;
  a.send({ t: 'undoRoad' });
  ok(/Too late to undo/.test(a.toast()) && isRoad(world.getTile(15, -5)), 'after 30 seconds: too late, the road stays');
  game.net.now = () => Date.now();
  // a building going up beside it
  world.setTile(14, -4, packTile(Terrain.Grass, false, Zone.Residential, 0));
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([11, -3], [20, -3]) });
  world.setTile(14, -4, withConstruction(packTile(Terrain.Grass, false, Zone.Residential, 0), true));
  a.send({ t: 'undoRoad' });
  ok(/a building is going up beside it/.test(a.toast()) && isRoad(world.getTile(15, -3)), `a site opened beside the new road: cannot undo ("${a.toast()}")`);
  world.setTile(14, -4, packTile(Terrain.Grass, false, 0, 0));
  // bulldozed since
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([22, -10], [22, -2]) });
  a.send({ t: 'build', tool: 'bulldoze', tiles: [[22, -6]] });
  a.send({ t: 'undoRoad' });
  ok(/part of it has changed/.test(a.toast()), 'part of it bulldozed: cannot undo');
  // a zoned lot paved over comes back zoned
  world.setTile(25, -10, packTile(Terrain.Grass, false, Zone.Commercial, 0));
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([24, -10], [26, -10]) });
  ok(isRoad(world.getTile(25, -10)), 'a road over an empty lot paves it (as before)');
  a.send({ t: 'undoRoad' });
  ok(zoneOf(world.getTile(25, -10)) === Zone.Commercial && !isRoad(world.getTile(25, -10)), 'undo gives the lot back, zoned');
}

// ---- buildings in the way (a0902fd7): the client asks; without a yes the road goes round
{
  const hx = 18, hy = 5;
  world.setTile(hx, hy, packTile(Terrain.Grass, false, familyOf(KIND_ID['hospital']), 1), subFor(KIND_ID['hospital']));
  const m0 = p.money;
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, hy], [24, hy]) });
  ok(levelOf(world.getTile(hx, hy)) === 1 && !isRoad(world.getTile(hx, hy)) && isRoad(world.getTile(17, hy)) && isRoad(world.getTile(19, hy)), 'a road dragged over a hospital without a yes goes round it: the hospital stands');
  ok(/Went round a hospital: 1 tile left out/.test(a.toasts().join('|')) && m0 - p.money === 12 * ROAD_COST, `and says so ("${a.toasts().find((t) => /Went round/.test(t))}"), charging only the road laid`);
  const m1 = p.money;
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, hy], [24, hy]), demolish: true });
  ok(isRoad(world.getTile(hx, hy)) && m1 - p.money === ROAD_COST + BULLDOZE_COST, `with a yes it comes down: road and fee, $${m1 - p.money}`);
}

// ---- upgrade in place: a drag over existing road (a roundabout, a crossing) keeps it all and costs nothing
{
  // a crossroads of Ada's own, then a roundabout on it
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, 8], [28, 8]) });
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([27, 2], [27, 10]) });
  a.send({ t: 'build', tool: 'roundabout', tiles: [[27, 8]], dev: true });
  const before: number[] = [];
  for (let x = 25; x <= 29; x++) for (let y = 6; y <= 10; y++) before.push(world.getTile(x, y), world.auxAt(x, y));
  const ring = isJunctionAux(world.auxAt(27, 8)) || isJunctionAux(world.auxAt(26, 7));
  const m0 = p.money;
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, 8], [28, 8]), cls: 0 });
  const after: number[] = [];
  for (let x = 25; x <= 29; x++) for (let y = 6; y <= 10; y++) after.push(world.getTile(x, y), world.auxAt(x, y));
  ok(ring && before.join() === after.join() && p.money === m0, `dragging a street over a street with a roundabout on it keeps every tile and byte, for nothing (roundabout ${ring}; ${a.toasts().filter((t) => /oundabout/.test(t)).join('|')})`);
  a.send({ t: 'build', tool: 'road', tiles: [[12, 9]], cls: 7 });
  ok(/no such class/.test(a.toast()), 'an unknown class is refused');
}

// ---- street names
{
  const roadAt = (x: number, y: number) => isRoad(world.getTile(x, y));
  a.send({ t: 'inspect', x: 15, y: 8 });
  const r1 = a.last('road')?.info;
  const name = r1?.streets?.[0]?.name ?? '';
  ok(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name) && r1?.streets?.[0]?.mine, `a road's hover names its street: "${name}" (Ada's: renamable)`);
  a.send({ t: 'inspect', x: 22, y: 8 });
  ok(a.last('road')?.info?.streets?.[0]?.name === name, 'the same street along its length');
  a.send({ t: 'inspect', x: 27, y: 4 });
  const cross = a.last('road')?.info?.streets?.[0]?.name ?? '';
  ok(cross && streetBase(cross) !== streetBase(name), `the street crossing it has another name ("${cross}")`);
  // the Commons: every street's name differs from those crossing it and alongside it
  let clashes = 0, streets = 0;
  const names = new Map<string, string>();
  for (let y = -11; y <= 10; y++) for (let x = -11; x <= 10; x++) {
    if (!roadAt(x, y)) continue;
    for (const r of world.streets.streetsAt(x, y)) { const k = `${r.ns}:${r.line}:${r.from}`; if (!names.has(k)) { names.set(k, world.streets.nameOf(r)); streets++; } }
  }
  const list = [...names].map(([k, n]) => { const [ns, line, from] = k.split(':'); return { ns: ns === 'true', line: +line, from: +from, n }; });
  for (const s of list) for (const o of list) if (s !== o && s.ns === o.ns && Math.abs(s.line - o.line) <= 8 && streetBase(s.n) === streetBase(o.n)) clashes++;
  ok(streets >= 8 && clashes === 0, `the Commons' ${streets} streets: no two alongside each other share a name (${[...names.values()].slice(0, 6).join(', ')}...)`);
  // the same on another server: a fresh world with the same seed names its streets the same
  const fresh = () => { const w = new World(4242); seedCommons(w, 0); return w; };
  const w1 = fresh(), w2 = fresh();
  let same = 0, total = 0;
  for (let y = -11; y <= 10; y++) for (let x = -11; x <= 10; x++) {
    if (!isRoad(w1.getTile(x, y))) continue;
    const r1 = w1.streets.streetsAt(x, y), r2 = w2.streets.streetsAt(x, y);
    for (let i = 0; i < r1.length; i++) { total++; if (r2[i] && w1.streets.nameOf(r1[i]) === w2.streets.nameOf(r2[i])) same++; }
  }
  ok(same === total, `two servers with the same seed: the same names (${same}/${total})`);
  // rename by the owner; a stranger may not
  a.send({ t: 'renameStreet', x: 15, y: 8, ns: false, name: '  Ada   Parade ' });
  a.send({ t: 'inspect', x: 24, y: 8 });
  ok(a.last('road')?.info?.streets?.[0]?.name === 'Ada Parade', 'renamed by its owner: tidied, along its whole length');
  const b = client('Bob');
  b.send({ t: 'renameStreet', x: 15, y: 8, ns: false, name: 'Bob Street' });
  ok(/Not your street/.test(b.toast()), `a stranger cannot rename it ("${b.toast()}")`);
  b.send({ t: 'renameStreet', x: 0, y: -11, ns: false, name: 'Bob Street' });
  ok(/Not your street: Commons/.test(b.toast()), "nor the Commons' streets");
  // extended, it keeps its name
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([13, -8], [18, -8]) });
  a.send({ t: 'inspect', x: 15, y: -8 });
  const short = a.last('road')?.info?.streets?.[0]?.name;
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([19, -8], [29, -8]) });
  a.send({ t: 'inspect', x: 28, y: -8 });
  ok(short && a.last('road')?.info?.streets?.[0]?.name === short, `extended, a street keeps its name ("${short}", now ${a.last('road')?.info?.streets?.[0]?.length} tiles)`);
  // a save and load keeps every name
  const w3 = worldFromSnapshot(JSON.parse(JSON.stringify(snapshotOf(world))))!;
  let kept = 0;
  for (const s of list) { const r = w3.streets.streetsAt(s.ns ? s.line : s.from, s.ns ? s.from : s.line).find((q) => q.ns === s.ns); if (r && w3.streets.nameOf(r) === world.streets.nameOf(world.streets.streetsAt(s.ns ? s.line : s.from, s.ns ? s.from : s.line).find((q) => q.ns === s.ns)!)) kept++; }
  const ada = w3.streets.streetsAt(15, 8).find((r) => !r.ns)!;
  ok(kept === list.length && w3.streets.nameOf(ada) === 'Ada Parade', `saved and loaded: every name kept (${kept}/${list.length}), the rename too`);
  // an empty name gives the generated one back
  a.send({ t: 'renameStreet', x: 15, y: 8, ns: false, name: '' });
  ok(/Back to its own name/.test(a.toast()), `an empty name: "${a.toast()}"`);
  // addresses: the door number and the street the front faces
  const hx = 15, hy = 9;
  world.setTile(hx, hy, packTile(Terrain.Grass, false, Zone.Residential, 1));
  a.send({ t: 'inspect', x: hx, y: hy });
  const bi = a.last('building')?.info;
  const st = world.streets.nameOf(world.streets.streetsAt(15, 8).find((r) => !r.ns)!);
  ok(bi?.address === `${houseNumber(hx, hy, 2)} ${st}`, `a home's address: "${bi?.address}" (the number on its door, the street it faces)`);
  ok(streetName(1, { ns: false, line: 0, from: 0, to: 5 }, { length: 6, joined: 1, homes: 8, shops: 0, works: 0, offices: 0 }).endsWith('Close')
    || /Court|Gardens/.test(streetName(1, { ns: false, line: 0, from: 0, to: 5 }, { length: 6, joined: 1, homes: 8, shops: 0, works: 0, offices: 0 })), 'a short dead end of homes is a close (or court, gardens)');
  ok(/Road|Way/.test(streetName(1, { ns: false, line: 0, from: 0, to: 30 }, { length: 31, joined: 2, homes: 0, shops: 0, works: 0, offices: 0 })), 'a long through route is a road (or way)');
}

// ---- the Commons on a mix of block sizes (seed.ts COMMONS): blocks of 3, 4, 6 and 8 along their streets, T-junctions
{
  const w = new World(4242); seedCommons(w, 0);
  const road = (x: number, y: number) => isRoad(w.getTile(x, y));
  const lengths = new Set<number>();
  for (let y = -10; y <= 9; y++) { let run = 0; for (let x = -10; x <= 10; x++) { if (road(x, y)) { if (run) lengths.add(run); run = 0; } else run++; } }
  let tees = 0, crosses = 0;
  for (let y = -10; y <= 9; y++) for (let x = -10; x <= 9; x++) {
    if (!road(x, y)) continue;
    const n = [road(x + 1, y), road(x - 1, y), road(x, y + 1), road(x, y - 1)].filter(Boolean).length;
    if (n === 3) tees++; else if (n === 4) crosses++;
  }
  ok([3, 4, 6, 8].every((n) => lengths.has(n)), `the Commons' blocks run ${[...lengths].sort((a, b) => a - b).join(', ')} tiles along their streets`);
  ok(tees > 2 * crosses, `inside it, ${tees} T-junctions to ${crosses} crossroads`);
}

// ---- lots one back (797ee40a): no road on any side, and the zoning says why they wait
{
  a.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, 1], [20, 1]) });
  a.send({ t: 'build', tool: 'res', tiles: roadDragPath([13, 2], [19, 2]) });
  a.send({ t: 'build', tool: 'res', tiles: roadDragPath([13, 3], [19, 3]) });
  ok(world.hasRoadAccess(15, 2) && !world.hasRoadAccess(15, 3), 'a lot beside the road has access, the one behind it none');
  ok(/stay empty until a road reaches them, or the building in front, once it is two storeys \(Masonry and power\)/.test(a.toasts().join('|')), `zoning a row behind says why it will wait ("${a.toasts().find((t) => /no road beside/.test(t))}")`);
}

// ---- road classes (R3, docs/roads.md "Classes", shared/src/roadclass.ts) ------------------------------------------
{
  // the byte
  ok(classByte(RoadCls.Street) === 0 && auxClass(0) === 0 && auxClass(0xf0) === 0 && auxClass(0xd9) === 0, 'a street has no byte; ring, bridge and other bytes read as streets');
  let all = true;
  for (const d of ROAD_CLASS_DEFS) for (let dir = 0; dir < 4; dir++) for (const j of [false, true]) {
    const b = classByte(d.id, dir, j);
    if (d.id && (!isClassAux(b) || b >= 0x40 || auxClass(b) !== d.id || (d.oneWay && auxDir(b) !== dir) || auxJunction(b) !== (j && d.divided))) all = false;
  }
  ok(all, 'every class, direction and junction flag round-trips through its byte, all inside 0x01-0x3f');
  ok(!carStepOk(classByte(RoadCls.OneWay, 0), 0, 1) && carStepOk(classByte(RoadCls.OneWay, 0), 0, 0) && carStepOk(classByte(RoadCls.OneWay, 0), 0, 2), 'a car never leaves a one-way tile against it; across it is free');
  ok(!carStepOk(classByte(RoadCls.Avenue, 0), classByte(RoadCls.Avenue, 1), 3) && carStepOk(classByte(RoadCls.Avenue, 0, true), classByte(RoadCls.Avenue, 1), 3), "no crossing an avenue's reservation but at a junction tile");
  ok(!carStepOk(0, classByte(RoadCls.Pedestrian), 0) && carStepOk(0, classByte(RoadCls.Pedestrian), 0, true), 'a pedestrian street: no cars, but emergencies and deliveries out of hours');
  ok(edgeLanes(classByte(RoadCls.OneWay, 0), classByte(RoadCls.OneWay, 0), 0) === 2 && edgeLanes(0, classByte(RoadCls.OneWay, 0), 0) === 1, 'two lanes between one-way tiles, one off a street');
  const tw = twinRow(roadDragPath([0, 0], [4, 0]));
  ok(tw.length === 5 && tw.every((t) => t.y === -1 && t.dir === 1), "an avenue dragged east: its twin row on the left (north), going west");
  // the plan: an avenue over a street widens it, a motorway refuses a building beside it
  const map = new Map<string, number>();
  for (let x = 0; x <= 6; x++) map.set(`${x},0`, packTile(Terrain.Grass, true, 0, 0));
  map.set('3,-3', packTile(Terrain.Grass, false, Zone.Residential, 2));
  const av = planRoad(roadDragPath([0, 0], [6, 0]), env(new Map([...map].filter(([k]) => k !== '3,-3'))), { cls: RoadCls.Avenue });
  ok(av.upgrade === 7 && av.fresh === 7 && av.cost === 7 * (ROAD_CLASS_DEFS[RoadCls.Avenue].cost - ROAD_COST) + 7 * ROAD_CLASS_DEFS[RoadCls.Avenue].cost,
    `an avenue dragged along a street: 7 tiles upgraded for the difference, 7 new for the twin ($${av.cost})`);
  const mw = planRoad(roadDragPath([0, -1], [6, -1]), env(map), { cls: RoadCls.Motorway });
  ok(mw.tiles.some((t) => t.reason === MSG_ROAD_FRONTAGE), `a motorway beside a house is refused ("${MSG_ROAD_FRONTAGE}")`);
  const owp = planRoad(roadDragPath([6, 0], [0, 0]), env(map, { aux: () => classByte(RoadCls.OneWay, 0), roadClass: () => RoadCls.OneWay }), { cls: RoadCls.OneWay });
  ok(owp.upgrade === 7 && owp.cost === 0 && owp.tiles.every((t) => t.byte !== undefined && oneWayDir(t.byte) === 1), 'a one-way street dragged the other way is reversed, for nothing');
}
{
  // on the server: locks, laying, upgrading in place, junction flags, save and load
  const w = new World(5151);
  seedCommons(w, 0);
  const { game: g, client: cl } = setup(w);
  const c = cl('Cleo');
  const me = w.players.get(c.id)!;
  me.money = 100_000;
  c.send({ t: 'buy', x: 11, y: -11, w: 20, h: 22 });
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, 0], [28, 0]), cls: RoadCls.Avenue });
  ok(/Avenues is needed/.test(c.toast()) && !isRoad(w.getTile(15, 0)), `an avenue without the technology: refused, naming it ("${c.toast()}")`);
  me.tech = [...me.tech, 'tr13', 'tr14', 'tr15', 'cul6', 'tr1', 'tr2', 'tr3', 'cul1', 'zon1'];
  // a street with a crossroads, then an avenue dragged along it
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, 0], [28, 0]) });
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([20, -6], [20, 6]) });
  const m0 = me.money;
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, 0], [28, 0]), cls: RoadCls.Avenue });
  const avD = ROAD_CLASS_DEFS[RoadCls.Avenue];
  const crossing = auxJunction(w.auxAt(20, 0)) && auxJunction(w.auxAt(20, -1)) && isRoad(w.getTile(20, 1)) && isRoad(w.getTile(20, -2));
  const row = [...Array(17).keys()].every((i) => auxClass(w.auxAt(12 + i, 0)) === RoadCls.Avenue && auxDir(w.auxAt(12 + i, 0)) === 0);
  const twin = [...Array(17).keys()].every((i) => auxClass(w.auxAt(12 + i, -1)) === RoadCls.Avenue && auxDir(w.auxAt(12 + i, -1)) === 1);
  ok(row && twin, 'an avenue dragged along a street: the street upgraded going east, its twin laid north going west');
  ok(crossing, 'the crossroads keeps its junction: both carriageways there are junction tiles, the crossing street carrying on either side');
  ok(m0 - me.money === 18 * (avD.cost - ROAD_COST) + 16 * avD.cost, `charged the difference on the 18 tiles of road upgraded and the full price for the 16 new ($${m0 - me.money})`);
  ok(auxJunction(w.auxAt(19, 0)) === false && auxJunction(w.auxAt(12, 0)) && auxJunction(w.auxAt(28, -1)), 'junction flags at the avenue\'s ends; none along it');
  ok(isRoad(w.getTile(20, -1)) && auxClass(w.auxAt(20, -1)) === RoadCls.Avenue, 'the crossing street crosses both carriageways');
  // one crossing, not two: the street over both carriageways is one junction, one controller, one timing
  const env2 = (x: number, y: number) => isRoad(w.getTile(x, y));
  const cls2 = (x: number, y: number) => { const a = w.auxAt(x, y); return isClassAux(a) ? a : 0; };
  const site0 = junctionGroup(env2, cls2, 20, 0), site1 = junctionGroup(env2, cls2, 20, -1); // R4: junction groups (shared/src/signals.ts)
  ok(!!site0 && !!site1 && site0.w * site0.h === 2 && signalledArms(groupArms(env2, site0)) && site0.x === site1.x && site0.y === site1.y, `a street crossing an avenue: one junction of two tiles, lit as a crossroads, one timing (from ${site0?.x},${site0?.y})`);
  const tj = (x: number, y: number) => (g.sim.traffic as unknown as { junction(x: number, y: number): { signal: boolean; offset: number; period: number } }).junction(x, y);
  ok(tj(20, 0).signal && tj(20, -1).signal && tj(20, 0).offset === tj(20, -1).offset && tj(20, 0).period === tj(20, -1).period, 'the traffic model lights both tiles on the same phase');
  // a street ending at the avenue from one side: both carriageways' tiles are the junction
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([24, -6], [24, -2]) });
  ok(auxJunction(w.auxAt(24, -1)) && auxJunction(w.auxAt(24, 0)), 'a T from one side makes both carriageways\' tiles the junction');
  // dragged back along itself the other way, an avenue is road already (no third carriageway)
  const back = planRoad(roadDragPath([28, 0], [12, 0]), { tile: (x, y) => w.getTile(x, y), aux: (x, y) => w.auxAt(x, y), kindId: () => 0, land: () => null, claimed: () => true, structure: () => undefined, bridgeLock: null }, { cls: RoadCls.Avenue });
  ok(back.fresh === 0 && back.cost === 0, `an avenue dragged back along itself the other way: nothing new (${back.fresh} new, $${back.cost})`);
  // routes: never across the reservation mid-block, never against the one-way
  const cost = (x: number, y: number) => g.sim.traffic.cost(x, y);
  const r1 = findRoute(w, 15, 0, 15, -1, cost, 0.4, 20000);
  ok(!!r1 && r1.path.length / 2 > 3, `a U-turn across the reservation goes round by a junction (${r1 ? r1.path.length / 2 : 0} tiles)`);
  const west = findRoute(w, 25, 0, 14, 0, cost, 0.4, 20000);
  let against = false;
  if (west) for (let i = 0; i + 3 < west.path.length; i += 2) if (west.path[i + 1] === 0 && west.path[i + 3] === 0 && west.path[i + 2] < west.path[i] && auxDir(w.auxAt(west.path[i], 0)) === 0) against = true;
  ok(!!west && !against, 'a route west along the eastbound carriageway does not drive against it');
  // a pedestrian street: no car route along it; an emergency's goes through
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, 6], [28, 6]) });
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([21, 6], [27, 6]), cls: RoadCls.Pedestrian });
  w.setTile(24, 7, packTile(Terrain.Grass, false, Zone.Commercial, 1));
  const car = findRoute(w, 15, 6, 24, 7, cost, 0.4, 20000), fire = findRoute(w, 15, 6, 24, 7, cost, 0.4, 20000, -1, Infinity, true);
  ok(!car && !!fire, 'a shop on a pedestrian street: no car reaches its door, a fire engine does');
  ok(w.hasRoadAccess(24, 7), 'but it has its road (it grows; walkers reach it)');
  // a motorway: no frontage
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([13, -8], [27, -8]), cls: RoadCls.Motorway });
  ok(auxClass(w.auxAt(20, -8)) === RoadCls.Motorway && auxClass(w.auxAt(20, -9)) === RoadCls.Motorway, 'a motorway laid: two carriageways');
  w.setTile(20, -10, packTile(Terrain.Grass, false, Zone.Residential, 0));
  ok(!w.hasRoadAccess(20, -10), 'a lot beside only a motorway has no road access (no frontage)');
  ok(!findRoute(w, 20, -10, 15, 0, cost, 0.4, 20000), 'nor can a car leave it onto the motorway');
  // upgrade in place keeps the junction and undo puts the class back
  const before = w.auxAt(20, 6);
  const m1 = me.money;
  c.send({ t: 'build', tool: 'road', tiles: roadDragPath([12, 6], [20, 6]), cls: RoadCls.OneWay });
  const one = auxClass(w.auxAt(16, 6)) === RoadCls.OneWay && oneWayDir(w.auxAt(16, 6)) === 0;
  ok(one && m1 - me.money === 9 * (ROAD_CLASS_DEFS[RoadCls.OneWay].cost - ROAD_COST) && isRoad(w.getTile(20, 6)), `a street made one-way in place: the difference charged ($${m1 - me.money}), the junction still a road`);
  c.send({ t: 'undoRoad' });
  ok(auxClass(w.auxAt(16, 6)) === 0 && w.auxAt(20, 6) === before && me.money === m1, `undo: back to a street, refunded ("${c.toast()}")`);
  // bulldozing one carriageway leaves the other a one-way street, not half an avenue
  c.send({ t: 'build', tool: 'bulldoze', tiles: [[15, -1]] });
  ok(!isRoad(w.getTile(15, -1)) && auxClass(w.auxAt(15, 0)) === RoadCls.OneWay && oneWayDir(w.auxAt(15, 0)) === 0, `one carriageway's tile bulldozed: its twin is a one-way street eastbound (class ${auxClass(w.auxAt(15, 0))})`);
  // save and load: every class byte and flag kept
  const bytes: number[] = [];
  for (let y = -11; y <= 10; y++) for (let x = 11; x <= 30; x++) bytes.push(w.auxAt(x, y));
  const w2 = worldFromSnapshot(JSON.parse(JSON.stringify(snapshotOf(w))))!;
  const after: number[] = [];
  for (let y = -11; y <= 10; y++) for (let x = 11; x <= 30; x++) after.push(w2.auxAt(x, y));
  ok(bytes.join() === after.join() && bytes.some((b) => isClassAux(b)), `saved and loaded: every class byte kept (${bytes.filter((b) => isClassAux(b)).length} tiles of classes)`);
  // the address and the tooltip name the class
  w.setTile(16, 7, packTile(Terrain.Grass, false, Zone.Residential, 1));
  c.send({ t: 'inspect', x: 18, y: -1 });
  const info = c.last('road')?.info;
  ok(info?.cls === RoadCls.Avenue && info.flow === 1, `the road tooltip says avenue, westbound (cls ${info?.cls}, flow ${info?.flow})`);
  ok(/Avenue$/.test(info?.streets?.[0]?.name ?? ''), `an avenue names itself an Avenue ("${info?.streets?.[0]?.name}")`);
  c.send({ t: 'inspect', x: 18, y: 0 });
  ok(c.last('road')?.info?.streets?.[0]?.name === info?.streets?.[0]?.name, 'both carriageways are one street');
  ok(info?.streets?.length === 1, `mid-block the tooltip names the avenue once (${info?.streets?.map((q) => q.name).join(' / ')})`);
}
{
  // traffic: an avenue carries more than a street, with no car-car overlaps (loadtest/classbench.ts)
  const st = bench(corridor(RoadCls.Street), 40, 1, 1200), av = bench(corridor(RoadCls.Avenue), 40, 1, 1200), ow = bench(corridor(RoadCls.OneWay), 40, 1, 1200), mw = bench(corridor(RoadCls.Motorway, false), 40, 1, 1200, { cross: false });
  ok(av.through > st.through, `an avenue corridor carries more than a street through the same crossing (${av.through.toFixed(0)}/h against ${st.through.toFixed(0)}/h)`);
  ok(st.overlaps === 0 && av.overlaps === 0 && ow.overlaps === 0 && mw.overlaps === 0, `no car-car body overlaps on any class (street ${st.overlaps}, avenue ${av.overlaps}, one-way ${ow.overlaps}, motorway ${mw.overlaps})`);
  const ped = corridor(RoadCls.Pedestrian);
  const t = new (await import('../sim/traffic')).Traffic(ped);
  ok(!findRoute(ped, -12, 0, 12, 0, (x, y) => t.cost(x, y), 0.4, 20000), 'no car route along a pedestrian street');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
