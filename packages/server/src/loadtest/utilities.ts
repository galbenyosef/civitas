/**
 * Utilities probe (docs/utilities.md, phase 1: the framework and electric).
 *
 *   npx tsx packages/server/src/loadtest/utilities.ts [--seed 1]
 *   npx tsx packages/server/src/loadtest/utilities.ts --bench [--districts 2] [--ticks 1500]
 *
 * 1. reach follows the roads: a node's reach walks road tiles only, step by step to its radius, never across a block or
 *    along another player's street, and the field is the same whatever order the nodes come in;
 * 2. the solver: s ≥ 1 is supplied, 0.85 to 1 browns every node out, below 0.85 cuts nodes until the rest are supplied,
 *    workplaces first at night and homes by day, rotating by the hour, never a hospital's or police station's patch and
 *    a protected node last; an overloaded node trips on its own; a faulted one is off; the same input gives the same output;
 * 3. a town: with no power nothing grows past level 1 and the owner hears why; a substation and a staffed gas power
 *    station within reach supply it, level-2 sites open only on supplied lots, bills come in and fuel goes out; on a
 *    frontier a substation in town takes grid import from the gate;
 * 4. a fault: the node goes dark, the power depot's van drives out, works and clears it, and the node is supplied again;
 *    without a depot a contractor clears it after UTIL.contractorHours; links are laid, refused and taken down;
 * 5. day one: bot F's first game day on a frontier plays the same to the dollar with the power gate and without;
 * 6. determinism: the same seed gives the same node states, faults and bills on a second run;
 * 7. old saves: a snapshot without `utilities` loads and saves without it; one with links, faults and settings round-trips.
 * `--bench`: ms per game step on a test city of `--districts`² with a substation on every other street and a gas plant
 * per district, utilities on and off (Utilities.off and no gate), over `--ticks` ticks after a day's fill.
 * Prints pass/fail counts; exits 1 on any failure.
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, KIND_ID, Zone, DEFAULT_TAX, UTIL, UtilState, UTIL_STATE_WORDS, UTIL_RADIUS_OF, UTIL_IMPORT_OF,
  UtilityField, utilityReach, solveNetwork, utilKey, packTile, terrainOf, subFor, tileKey, planStructure, workOf, mulberry32, isMultiTile, FleetKind,
  type UtilEnv, type UtilNode, type SolveNode,
} from '@msimcity/shared';
import { World, emptyStats, type Building } from '../world';
import { seedCity } from './cities';
import { seedFrontier } from '../seed';
import { createGame, type Game } from '../game';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import type { Conn } from '../transport';
import { playF } from './botf';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const seed = get('seed', 1);
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
const SUB = KIND_ID.substation, GAS = KIND_ID['gas-plant'], DEPOT = KIND_ID['power-depot'];
let checks = 0, fails = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) fails++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };

/** A test city of one district owned by `owner` (not the Commons, so the gate applies), level-1 lots, filled for `days`. */
function city(opts: { rnd?: number; owner?: string; days?: number; built?: number; districts?: number; sandbox?: boolean } = {}) {
  const rnd = opts.rnd ?? seed;
  Math.random = mulberry32(rnd * 7919);
  const w = new World(rnd);
  const layout = seedCity(w, { districts: opts.districts ?? 1, built: opts.built ?? 1, seedOwner: opts.owner ?? 'ada' });
  const g = createGame(w, { onConnection() {} }, { devTools: false, sandbox: opts.sandbox ?? false });
  g.fires.enabled = false;
  for (let i = 0; i < (opts.days ?? 0) * DAY; i++) g.step();
  return { w, g, x0: layout.districts[0].x, y0: layout.districts[0].y, layout };
}
/** Put kind on the lot at (x, y) (cleared first), built and complete; a multi-tile kind with its door there, facing a road. */
function put(w: World, kind: number, x: number, y: number, rot?: number, staff = 0): Building | null {
  const p = planStructure(kind, x, y, { tile: (a, b) => w.peekTile(a, b), aux: (a, b) => w.auxAt(a, b), sub: (a, b) => w.subAt(a, b), land: () => null }, rot);
  if (isMultiTile(kind)) {
    if (!p.ok) throw new Error(`cannot place ${kind} at (${x}, ${y}): ${p.reason}`);
    w.placeStructure(p.placed, { work: workOf(kind, 1), priority: 0, built: true });
  } else w.setTile(x, y, packTile(terrainOf(w.getTile(x, y)), false, Zone.Hub, 1), subFor(kind));
  const b = w.buildings.get(tileKey(x, y)) ?? null;
  if (b && staff) b.occupants = staff;
  return b;
}
/** Clear the 4×4 block whose top-left lot is (x, y) (districts have roads every 5 tiles). */
const clearBlock = (w: World, x: number, y: number) => { for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) w.setTile(x + i, y + j, packTile(terrainOf(w.getTile(x + i, y + j)), false, 0, 0)); };
const steps = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.step(); };
const stateOf = (g: Game, b: Building) => g.utilities.nodeState.get(utilKey(b.x, b.y))?.state ?? -1;
/** Every notice the utilities give their owners from now on (net.ts takes them off the list each step). */
function heard(g: Game) {
  const out: { msg: string; hint?: string }[] = [], list = g.utilities.notices;
  list.push = (...a) => { out.push(...a); return Array.prototype.push.apply(list, a); };
  return out;
}

// ---------------------------------------------------------------- 1. reach follows the roads
console.log('1. reach follows the roads');
{
  // a comb of roads: a spine along y = 0 (x 0..30), teeth down x = 0, 10, 20 (y 0..12); ada owns x < 25, ben the rest
  const road = new Set<number>();
  for (let x = 0; x <= 30; x++) road.add(utilKey(x, 0));
  for (const x of [0, 10, 20, 28]) for (let y = 0; y <= 12; y++) road.add(utilKey(x, y));
  const env: UtilEnv = {
    tile: (x, y) => (road.has(utilKey(x, y)) ? packTile(0, true, 0, 0) : packTile(0, false, 0, 0)),
    sub: () => 0, aux: () => 0, owner: (x) => (x < 25 ? 'ada' : 'ben'),
  };
  const node: UtilNode = { key: utilKey(10, 13), x: 10, y: 13, kind: SUB, owner: 'ada' }; // its door below the tooth at x = 10
  const r = utilityReach(node, env);
  const at = new Map<number, number>();
  for (let i = 0; i < r.dist.length; i++) at.set(utilKey(r.tiles[i * 2], r.tiles[i * 2 + 1]), r.dist[i]);
  const R = UTIL_RADIUS_OF[SUB];
  ok([...at.keys()].every((k) => road.has(k)), `every tile reached is a road (${at.size} tiles)`);
  ok(at.get(utilKey(10, 12)) === 0 && at.get(utilKey(10, 0)) === 12 && at.get(utilKey(10 - (R - 12), 0)) === R, `steps count along the road: 0 at the door, 12 at the spine, ${R} at the edge`);
  ok(!at.has(utilKey(0, 6)), `a road 10 tiles away as the crow flies but ${12 + 10 + 6} steps along the streets is out of reach`);
  ok(!at.has(utilKey(28, 0)) && !at.has(utilKey(26, 0)), 'ben\'s street is never walked by ada\'s node');
  const big = utilityReach(node, env, 40), bigAt = new Set<number>();
  for (let i = 0; i < big.dist.length; i++) bigAt.add(utilKey(big.tiles[i * 2], big.tiles[i * 2 + 1]));
  ok(bigAt.has(utilKey(24, 0)) && !bigAt.has(utilKey(25, 0)) && !bigAt.has(utilKey(28, 5)), 'with a long reach it stops at the edge of ada\'s land');
  // the field: two nodes half way down the teeth, either order, the same answer; the nearer serves, a tie to the lower key
  const n1: UtilNode = { key: utilKey(11, 6), x: 11, y: 6, kind: SUB, owner: 'ada' }, n2: UtilNode = { key: utilKey(21, 6), x: 21, y: 6, kind: SUB, owner: 'ada' };
  const f1 = new UtilityField(), f2 = new UtilityField();
  f1.rebuild([n1, n2], env); f2.rebuild([n2, n1], env);
  const key = (f: UtilityField, x: number, y: number) => { const i = f.nodeIndexAt('ada', x, y); return i < 0 ? -1 : f.nodes[i].key; };
  let same = true;
  for (let x = 0; x <= 30; x++) for (let y = 0; y <= 13; y++) if (key(f1, x, y) !== key(f2, x, y) || f1.distAt('ada', x, y) !== f2.distAt('ada', x, y)) same = false;
  ok(same, 'the field is the same whatever order the nodes come in');
  ok(key(f1, 14, 0) === n1.key && key(f1, 16, 0) === n2.key && key(f1, 15, 0) === Math.min(n1.key, n2.key), 'the nearer node serves a road tile, a tie goes to the lower key');
  ok(f1.adjacent.length === 2, `their reaches touch along the spine: one pair joined by the streets (${f1.adjacent.length / 2})`);
  ok(f1.serving('ada', 9, 3) === f1.indexOf(n1.key) && f1.serving('ada', 5, 6) === -1, 'a building beside the tooth is served by its node; one with no road in reach is not');
}

// ---------------------------------------------------------------- 2. the solver
console.log('2. the solver');
{
  const n = (key: number, demand: number, o: Partial<SolveNode> = {}): SolveNode => ({ key, demand, cap: 1000, never: false, protect: false, workShare: 0, fault: false, ...o });
  const words = (r: { state: Uint8Array }) => [...r.state].map((s) => UTIL_STATE_WORDS[s]).join(', ');
  const four = [n(1, 100, { never: true }), n(2, 100, { protect: true }), n(3, 100, { workShare: 0.9 }), n(4, 100, { workShare: 0.1 })];
  const ample = solveNetwork(four, 500, 0, 12, 100);
  ok([...ample.state].every((s) => s === UtilState.Ok) && ample.generated === 400 && ample.imported === 0, `s = 1.25: all supplied, all from the plants (${words(ample)})`);
  const brown = solveNetwork(four, 360, 0, 12, 100);
  ok([...brown.state].every((s) => s === UtilState.Brown) && Math.abs(brown.ratio - 0.9) < 1e-9, `s = 0.90: every node browns out (${words(brown)})`);
  const edge = solveNetwork(four, 340, 0, 12, 100);
  ok([...edge.state].every((s) => s === UtilState.Brown), `s = 0.85 exactly: still a brownout, no cuts (${words(edge)})`);
  const day = solveNetwork(four, 300, 0, 12, 100), night = solveNetwork(four, 300, 0, 23, 100);
  ok(day.state[3] === UtilState.Cut && day.state[2] === UtilState.Ok && day.state[0] === UtilState.Ok && day.state[1] === UtilState.Ok, `s = 0.75 by day: the homes' node is cut, the rest supplied (${words(day)})`);
  ok(night.state[2] === UtilState.Cut && night.state[3] === UtilState.Ok, `s = 0.75 at night: the workplaces' node is cut instead (${words(night)})`);
  const dire = solveNetwork(four, 150, 0, 12, 100);
  ok(dire.state[0] !== UtilState.Cut && dire.state[1] !== UtilState.Cut && dire.state[2] === UtilState.Cut && dire.state[3] === UtilState.Cut, `s = 0.38: the hospital's patch and the protected node are never cut (${words(dire)})`);
  ok(dire.state[0] === UtilState.Brown && dire.served <= 150, `and short even so, they brown out on what there is (${Math.round(dire.served)} served of 150)`);
  const imp = solveNetwork(four, 200, 300, 12, 100);
  ok([...imp.state].every((s) => s === UtilState.Ok) && imp.generated === 200 && imp.imported === 200, `grid import tops up the shortfall after the plants (${imp.generated} generated, ${imp.imported} imported)`);
  // rotation: eight like nodes, a quarter short: who is cut moves round with the hour
  const eight = Array.from({ length: 8 }, (_, i) => n(10 + i, 100, { workShare: 0 }));
  const cut = new Set<number>();
  for (let h = 0; h < 24; h++) { const r = solveNetwork(eight, 600, 0, 12, 500 + h); r.state.forEach((s, i) => { if (s === UtilState.Cut) cut.add(i); }); }
  ok(cut.size >= 6, `rolling: over 24 hours ${cut.size} of the 8 nodes take a turn in the cut`);
  const over = solveNetwork([n(1, 400, { cap: 300 }), n(2, 400, { cap: 300, never: true }), n(3, 330, { cap: 300 })], 5000, 0, 12, 1);
  ok(over.state[0] === UtilState.Cut && over.state[1] === UtilState.Brown && over.state[2] === UtilState.Brown, `overloaded nodes: 75% trips, a hospital's browns out, 91% browns out, with plenty of supply (${words(over)})`);
  const flt = solveNetwork([n(1, 100, { fault: true }), n(2, 100)], 500, 0, 12, 1);
  ok(flt.state[0] === UtilState.Fault && flt.state[1] === UtilState.Ok && flt.demand === 100, `a faulted node is off and draws nothing (${words(flt)})`);
  const none = solveNetwork([n(1, 100)], 0, 0, 12, 1);
  ok(none.state[0] === UtilState.Unpowered, 'no plants and no import: no supply');
  const again = solveNetwork(eight, 600, 0, 12, 777), again2 = solveNetwork(eight, 600, 0, 12, 777);
  ok(again.state.join() === again2.state.join() && again.load.join() === again2.load.join(), 'the same input gives the same output');
}

// ---------------------------------------------------------------- 3. a town
console.log('3. a town');
let townA: ReturnType<typeof city>;
{
  townA = city({ days: 1.2 });
  const { w, g, x0, y0 } = townA;
  const lv2 = () => [...w.buildings.values()].filter((b) => b.level >= 2).length;
  const sites2 = () => [...w.sites.values()].filter((s) => s.target >= 2);
  ok(lv2() === 0 && sites2().length === 0, `no power, no two storeys: ${lv2()} buildings above level 1, ${sites2().length} sites for one`);
  ok(g.utilities.heldBack('ada') > 0 && g.utilities.stats.held > 0, `the growths held back are counted for the owner's hint (${g.utilities.stats.held} so far)`);
  // a substation by the middle street and a staffed gas plant on the next block, its gate on a street the substation reaches
  clearBlock(w, x0 + 11, y0 + 6);
  const gas = put(w, GAS, x0 + 12, y0 + 9, 0, 24)!;
  const sub = put(w, SUB, x0 + 9, y0 + 9)!;
  steps(g, 2 * TPH);
  const net = g.utilities.nets.find((n) => n.nodes.length);
  ok(stateOf(g, sub) === UtilState.Ok && !!net && net.plants.length === 1 && net.generated > 0, `the substation is supplied by the plant (${UTIL_STATE_WORDS[stateOf(g, sub)]}, ${Math.round(net?.generated ?? 0)} generated of ${Math.round(net?.demand ?? 0)} wanted)`);
  const before = w.ledgerDTO(w.players.get('ada')!).today;
  steps(g, DAY);
  const after = w.ledgerDTO(w.players.get('ada')!).yesterday;
  ok((after.bills ?? 0) > 0 && (after.fuel ?? 0) < 0, `bills come in and fuel goes out (yesterday: bills $${after.bills}, fuel $${after.fuel}; the day before ${JSON.stringify(before.bills ?? 0)})`);
  const up = sites2(), lv = [...w.buildings.values()].filter((b) => b.level >= 2);
  const offGrid = [...up, ...lv].filter((s) => { const b = w.buildings.get(tileKey(s.x, s.y)); return !b || !g.utilities.supplied(b); });
  ok(up.length + lv.length > 0 && offGrid.length === 0, `two storeys now grow, only on supplied lots (${lv.length} built, ${up.length} rising, ${offGrid.length} off the grid)`);
  const info = g.utilities.info(lv[0] ?? w.buildings.get(tileKey(up[0]?.x ?? 0, up[0]?.y ?? 0))!);
  ok(!!info?.power?.node && info.power.node[0] === sub.x && info.power.state === UtilState.Ok, `a building's panel names its substation (${JSON.stringify(info?.power)})`);
  const pinfo = g.utilities.info(gas);
  ok(pinfo?.network?.role === 'plant' && (pinfo.network.output ?? 0) > 0 && pinfo.network.nodes === 1, `the plant's panel: its output and its network (${JSON.stringify(pinfo?.network)})`);
}
{
  // a frontier: the gate's road runs into the charter, so a substation at the road end takes the grid
  Math.random = mulberry32(seed);
  const w = new World(424242);
  seedFrontier(w);
  w.getOrCreatePlayer('fen', 'Fen', 18000);
  const ch = w.charter!;
  const parcel = { id: w.nextId++, owner: 'fen', name: 'Charter', x: ch.x, y: ch.y, w: ch.w, h: ch.h, taxRate: DEFAULT_TAX, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = ch.y; y < ch.y + ch.h; y++) for (let x = ch.x; x < ch.x + ch.w; x++) w.setParcelId(x, y, parcel.id);
  const g = createGame(w, { onConnection() {} }, { devTools: false, sandbox: false });
  const [hx] = w.home!;
  const sub = put(w, SUB, hx - 2, 1)!;
  steps(g, 2 * TPH);
  const net = g.utilities.nets.find((n) => n.nodes.length);
  ok(!!net && net.importable && net.importOn && net.importCap === UTIL_IMPORT_OF[SUB] && stateOf(g, sub) === UtilState.Ok, `on a frontier a substation in town takes grid import from the gate (${JSON.stringify(net && { importable: net.importable, cap: net.importCap })}, ${UTIL_STATE_WORDS[stateOf(g, sub)]})`);
}

// ---------------------------------------------------------------- 4. faults, vans and links
console.log('4. faults, vans and links');
{
  const { w, g, x0, y0 } = townA;
  const u = g.utilities;
  const sub = w.buildings.get(tileKey(x0 + 9, y0 + 9))!;
  // a power depot by the substation's street, staffed by the town over a day
  for (const x of [x0 + 1, x0 + 2]) w.setTile(x, y0 + 9, packTile(terrainOf(w.getTile(x, y0 + 9)), false, 0, 0));
  const depot = put(w, DEPOT, x0 + 1, y0 + 9, 0)!;
  steps(g, DAY);
  ok(depot.id === DEPOT && depot.occupants > 0, `the power depot has staff (${depot.occupants})`);
  // a lineworker of the depot on shift: who gets hired (motivation's scored job search) decides whose rota it is, and a
  // depot with one lineworker on rest days sends no van, so wait for a shift (at most three days) before the fault; and
  // for one that is starting, not one in its last minutes (a fault then outlasts the shift and the contractor comes)
  const onShift = () => g.sim.mobile.onShift(FleetKind.UtilityVan).some((c) => c.wx === depot.x && c.wy === depot.y);
  let wait = 0;
  for (; wait < DAY && onShift(); wait++) g.step();
  for (; wait < 3 * DAY && !onShift(); wait++) g.step();
  ok(onShift(), `a lineworker of the depot is on shift (after ${(wait / TPH).toFixed(1)} game hours)`);
  const said = heard(g);
  const f = u.openFault('node', utilKey(sub.x, sub.y), 'ada', sub.x, sub.y);
  // playtest 37299b96: the notice says what happened and who fixes it, the panels too
  const open1 = said.at(-1);
  ok(!!open1 && open1.hint === 'fault' && open1.msg.startsWith(`Substation fault at (${sub.x}, ${sub.y}): its streets are dark.`) && /Your power depot sends a repair van \(about 2–3 hours\); if none can come, a contractor fixes it in about 10 hours/.test(open1.msg), `the fault's notice, an advisor line: "${open1?.msg}"`);
  const panel1 = u.info(sub)?.network;
  ok(!!panel1 && panel1.faults[0] === `Substation fault at (${sub.x}, ${sub.y})` && /contractor fixes it in about 10 hours/.test(panel1.repair?.[0] ?? ''), `the substation's panel: "${panel1?.faults[0]}" / "${panel1?.repair?.[0]}"`);
  const home1 = [...w.buildings.values()].find((b) => b.level > 0 && b.id !== SUB && b.id !== DEPOT && b.id !== GAS && u.field.serving('ada', b.x, b.y) === u.field.indexOf(utilKey(sub.x, sub.y)));
  ok(!!home1 && /repair van|contractor/.test(u.info(home1)?.power?.repair ?? ''), `a home on its streets says so too: "${home1 && u.info(home1)?.power?.repair}"`);
  ok(stateOf(g, sub) === UtilState.Fault && !u.supplied([...w.buildings.values()].find((b) => b.level > 0 && u.field.serving('ada', b.x, b.y) === u.field.indexOf(utilKey(sub.x, sub.y)))!), 'a fault: the substation and its streets have no power at once');
  const sent0 = u.stats.vansSent, van0 = u.stats.byVan;
  let tick = 0;
  for (; tick < 14 * TPH && u.openFaults.some((q) => q.id === f.id); tick++) g.step();
  ok(u.stats.vansSent > sent0 && u.stats.byVan > van0, `the depot's van went out and fixed it in ${(tick / TPH).toFixed(1)} game hours (${u.stats.vansSent - sent0} sent)`);
  const fixed1 = said.find((n) => n.msg.startsWith('Power restored'))?.msg ?? '';
  ok(new RegExp(`^Power restored at \\(${sub.x}, ${sub.y}\\) after ${Math.max(1, Math.round(tick / TPH))} hours?: your repair van fixed it$`).test(fixed1), `the repair's notice says who and how long: "${fixed1}"`);
  steps(g, TPH + 5);
  ok(stateOf(g, sub) === UtilState.Ok, `the substation is supplied again after the next solve (${UTIL_STATE_WORDS[stateOf(g, sub)]})`);
  // without a depot: the contractor
  const t2 = city({ rnd: seed + 1, days: 0.2 });
  const s2 = put(t2.w, SUB, t2.x0 + 9, t2.y0 + 9)!;
  steps(t2.g, TPH);
  const said2 = heard(t2.g);
  const f2 = t2.g.utilities.openFault('node', utilKey(s2.x, s2.y), 'ada', s2.x, s2.y);
  ok(/A contractor fixes it in about 10 hours\. A power depot of your own sends a repair van in 2–3 hours\.$/.test(said2.at(-1)?.msg ?? ''), `with Power stations and no depot the notice says to build one: "${said2.at(-1)?.msg}"`);
  steps(t2.g, 3 * TPH);
  ok(/contractor fixes it in about 7 hours/.test(t2.g.utilities.info(s2)?.network?.repair?.[0] ?? ''), `the panel counts the contractor's hours down: "${t2.g.utilities.info(s2)?.network?.repair?.[0]}"`);
  let t = 3 * TPH;
  for (; t < 12 * TPH && t2.g.utilities.openFaults.some((q) => q.id === f2.id); t++) t2.g.step();
  ok(t2.g.utilities.stats.byContractor === 1 && Math.abs(t / TPH - UTIL.contractorHours) < 0.2, `with no depot a contractor clears it after ${(t / TPH).toFixed(1)} game hours`);
  ok(/^Power restored at \(-?\d+, -?\d+\) after 10 hours: a contractor fixed it\. A power depot of your own sends a repair van in 2–3 hours\.$/.test(said2.find((n) => n.msg.startsWith('Power restored'))?.msg ?? ''), `and the repair's notice: "${said2.find((n) => n.msg.startsWith('Power restored'))?.msg}"`);
  // without the technology (a drill, or a fault left over from a save): the notice names what the depot needs
  const ada2 = t2.w.players.get('ada')!, tech2 = ada2.tech;
  ada2.tech = tech2.filter((id) => id !== 'ut2');
  t2.g.utilities.openFault('node', utilKey(s2.x, s2.y), 'ada', s2.x, s2.y);
  ok(/would send a repair van in 2–3 hours: it needs Power stations \(T\)\.$/.test(said2.at(-1)?.msg ?? ''), `with no Power stations the notice says the depot needs it: "${said2.at(-1)?.msg}"`);
  ada2.tech = tech2;
  // links: a buried cable from the gas plant to a second substation across the district
  const p = w.players.get('ada')!;
  p.money = 100000;
  const far = put(w, SUB, x0 + 19, y0 + 1)!;
  const gas = [...w.buildings.values()].find((b) => b.id === GAS)!;
  const bad = u.lay(p, 'buried', [[x0 + 30, y0 + 30], [x0 + 19, y0 + 1]]);
  ok(typeof bad === 'string', `a line from nowhere is refused ("${bad}")`);
  const money0 = p.money;
  const l = u.lay(p, 'buried', [[gas.x, gas.y], [far.x, far.y]]);
  ok(typeof l !== 'string' && l.a[0] === gas.x && l.b[0] === far.x && money0 - p.money === l.tiles.length / 2 * UTIL.buriedCost, `a buried cable from the plant to the far substation: ${typeof l === 'string' ? l : `${l.tiles.length / 2} tiles, $${money0 - p.money}`}`);
  steps(g, TPH + 5);
  const n = u.nets.find((q) => q.nodes.some((i) => u.field.nodes[i].key === utilKey(far.x, far.y)));
  ok(!!n && n.plants.length === 1 && stateOf(g, far) === UtilState.Ok, `the far substation is in the plant's network now (${n?.nodes.length} nodes, ${UTIL_STATE_WORDS[stateOf(g, far)]})`);
  const back = p.money;
  const rm = typeof l === 'string' ? l : u.remove(p, l.tiles[2], l.tiles[3]);
  ok(typeof rm !== 'string' && Math.round(p.money - back) === Math.round((l as { tiles: number[] }).tiles.length / 2 * UTIL.buriedCost * UTIL.refund) && !u.links.length, `taken down, half the cost back ($${Math.round(p.money - back)})`);
}

// ---------------------------------------------------------------- 5. day one
console.log('5. day one');
{
  const run = async (gate: boolean) => {
    Math.random = mulberry32(seed);
    const w = new World(424242);
    seedFrontier(w);
    let accept: ((c: Conn) => void) | null = null;
    const g = createGame(w, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox: false }, 10);
    if (!gate) g.sim.powerGate = null;
    const r = await playF(g, accept!, 8, undefined, { power: gate });
    return { r, money: Math.round(w.players.get([...w.players.keys()].find((k) => k !== 'sys')!)!.money), pop: w.citizens.size, sites: w.sites.size };
  };
  const a = await run(true), b = await run(false);
  ok(JSON.stringify(a) === JSON.stringify(b), `bot F's first game day on a frontier is the same with the power gate and without (${a.pop} citizens, $${a.money}, ${a.sites} sites; hourly $ ${a.r.hourly.slice(-3).join(', ')})`);
}

// ---------------------------------------------------------------- 6. determinism
console.log('6. determinism');
{
  const run = () => {
    const t = city({ rnd: seed + 7, days: 0.3 });
    clearBlock(t.w, t.x0 + 11, t.y0 + 6);
    put(t.w, GAS, t.x0 + 12, t.y0 + 9, 0, 24); put(t.w, SUB, t.x0 + 9, t.y0 + 9); put(t.w, SUB, t.x0 + 4, t.y0 + 14);
    t.w.day = 10; // past UTIL.faultsFromDay: the hourly roll is live
    const states: string[] = [];
    for (let h = 0; h < 30; h++) { steps(t.g, TPH); states.push(t.g.utilities.stateMsg().n.join(',')); }
    const s = t.g.utilities.stats;
    return { states: states.join('|'), faults: s.faults, bills: s.bills.toFixed(6), fuel: s.fuel.toFixed(6) };
  };
  const a = run(), b = run();
  ok(a.states === b.states && a.faults === b.faults && a.bills === b.bills && a.fuel === b.fuel, `the same seed gives the same node states, faults (${a.faults}) and bills ($${Number(a.bills).toFixed(2)}) twice`);
}

// ---------------------------------------------------------------- 7. old saves
console.log('7. old saves');
{
  const { w, g, x0, y0 } = townA;
  const u = g.utilities, p = w.players.get('ada')!;
  const gas = [...w.buildings.values()].find((b) => b.id === GAS)!;
  const far = w.buildings.get(tileKey(x0 + 19, y0 + 1))!;
  const l = u.lay(p, 'overhead', [[gas.x, gas.y], [far.x, far.y]]);
  u.openFault('node', utilKey(far.x, far.y), 'ada', far.x, far.y);
  u.setNode(p, far.x, far.y, { protect: true });
  const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
  ok(snap.version === 8 && snap.utilities?.links?.length === 1 && snap.utilities.faults.length >= 1 && snap.utilities.protect?.length === 1, `the snapshot (still v8) carries the link, the fault and the protected node (${JSON.stringify({ links: snap.utilities?.links?.length, faults: snap.utilities?.faults?.length })})`);
  const old = { ...snap }; delete old.utilities;
  const w0 = worldFromSnapshot(old)!;
  const g0 = createGame(w0, { onConnection() {} }, { devTools: false, sandbox: false });
  ok(!!w0 && !g0.utilities.links.length && !g0.utilities.openFaults.length && !('utilities' in snapshotOf(w0)), 'a save from before utilities loads with none and saves again without the field');
  const w1 = worldFromSnapshot(snap)!;
  const g1 = createGame(w1, { onConnection() {} }, { devTools: false, sandbox: false });
  const u1 = g1.utilities;
  ok(u1.links.length === 1 && u1.links[0].mode === 'overhead' && u1.openFaults.length === u.openFaults.length && u1.protect.has(utilKey(far.x, far.y)), `one with them loads them (${u1.links.length} link, ${u1.openFaults.length} fault, protected)`);
  const l2 = u1.lay(w1.players.get('ada')!, 'buried', [[gas.x, gas.y], [far.x, far.y]]);
  ok(typeof l !== 'string' && typeof l2 !== 'string' && l2.id === l.id + 1, `link ids go on after the load (${typeof l2 === 'string' ? l2 : l2.id})`);
  steps(g1, TPH + 5);
  ok(u1.nodeState.size > 0, `and the loaded town solves (${u1.nodeState.size} nodes)`);
}

// ---------------------------------------------------------------- bench
if (argv.includes('--bench')) {
  const n = get('districts', 2), ticks = get('ticks', 1500);
  console.log(`bench: ${n}×${n} districts, ${ticks} ticks, utilities on and off`);
  for (const on of [false, true, false, true]) {
    const t = city({ districts: n, rnd: seed, built: 3, owner: 'sys', sandbox: true });
    // a substation on the lot beside every other street of each district, and a gas plant per district
    for (const d of t.layout.districts) {
      for (let k = 0; k < 4; k++) put(t.w, SUB, d.x + 1 + 5 * k, d.y + 6 + 5 * (k % 2));
      clearBlock(t.w, d.x + 11, d.y + 11);
      put(t.w, GAS, d.x + 12, d.y + 14, 0, 24);
    }
    if (!on) { t.g.utilities.off = true; t.g.sim.powerGate = null; }
    steps(t.g, DAY); // fill
    const t0 = performance.now();
    steps(t.g, ticks);
    const ms = (performance.now() - t0) / ticks;
    const u = t.g.utilities;
    console.log(`  utilities ${on ? 'on ' : 'off'}: ${ms.toFixed(3)} ms a step, ${t.w.citizens.size} citizens${on ? `, ${u.field.nodes.length} nodes, ${u.field.reached} road tiles reached, ${(u.stats.solveMs / Math.max(1, u.stats.solves)).toFixed(2)} ms a solve` : ''}`);
  }
}

console.log(`${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);
