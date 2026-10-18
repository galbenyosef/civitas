/**
 * Ferry service check and load test (docs/boats.md section 6.2, subtask B5): a seedCity test city whose middle row of
 * districts is a lake that all but splits the town in two (one causeway at the west edge), with ferry piers on its shores, two river bus
 * lines across it, and feeder buses in the districts north and south of it; run for a game day after the fill.
 *
 *   npx tsx packages/server/src/loadtest/ferry.ts [--districts 3] [--hours 24] [--from 0] [--off] [--seed 1] [--no-fill] [--save world.json]
 *
 * Everything a player does goes through the real protocol (Net.handle with a fake client): the piers are placed with
 * the ferry pier tool, and the lines are previewed and saved from the Lines panel's messages. The piers stand on the
 * bank between the lake and the first street on each side. Line 1 is a loop round the lake (west and east piers on
 * each shore), line 2 there and back straight across the middle. Bus lines in the middle districts north and south of
 * the lake each end at a stop on the bank beside line 2's pier, within the change walk. Half the workers of each shore
 * then take a job across the water: the way round by land is long.
 *
 * Asserted: the preview is what the save routes, with a sailing line; a second line at a pier and a one-pier line are
 * refused; the route keeps to river-class water, its stop rows straight; boats call at every pier as often as the
 * timetable says (on time, as it is pure); riders board and alight on both lines and wait on the pontoon; some trips
 * change between a river bus and a bus; nobody waits past their give-up time and nobody is aboard a boat that is not
 * running; a bulldozed pier grounds its line. `--off` builds the same city and piers but saves no ferry line. `--save
 * path` writes the world once line 1 is saved (line 2's piers left free, for the Lines panel) and stops: a test city
 * for a server (`CITY_DISTRICTS=3 WORLD_FILE=path`).
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, Terrain, terrainOf, packTile, chunkOf, chunkKey, callsBetween, railGeometry, railPoint,
  pierAt, ferryStop, clearanceAt, FERRY, type TransitLine, type LinePreview, type ClientMsg, type RailService,
} from '@msimcity/shared';
import { World } from '../world';
import { createGame } from '../game';
import { fillCity } from '../fill';
import { seededRandom } from '../demo/seed';
import { seedCity, DISTRICT } from './cities';
import { saveWorld } from '../store';
import { layBusNetwork } from './ab';
import type { TransitPlan } from '../sim/transit';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const D = Math.max(3, Number(arg('districts', '3')) | 0);
const HOURS = Number(arg('hours', '24'));
const OFF = argv.includes('--off');
const SEED = Number(arg('seed', '1'));
const FROM = Number(arg('from', '0'));
const FILL = !argv.includes('--no-fill');
const SAVE = arg('save', '');

let fails = 0, checks = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${what}`); } };
const t0 = performance.now();

Math.random = seededRandom(SEED * 7919);
const w = new World(SEED);
const layout = seedCity(w, { districts: D, built: 3 });
const mid = Math.floor(D / 2);
const dist = (i: number, j: number) => layout.districts[j * D + i];
const north = dist(mid, mid - 1), south = dist(mid, mid + 1);

// ---- the lake: the middle row of districts and the gaps either side, from the north row's last street to the south
// row's first; the gap row next to each street stays dry, a bank for the piers ----------------------------------------
const Y0 = north.y + DISTRICT, Y1 = south.y - 1; // the banks; water between
for (let y = Y0; y <= Y1; y++) for (let x = layout.x0; x < layout.x0 + layout.span; x++) {
  w.setAux(x, y, 0);
  // the west edge street carries on across, a causeway: the one way round by land (a commute needs a walk to work)
  const causeway = x === layout.x0;
  w.setTile(x, y, packTile(causeway || y === Y0 || y === Y1 ? Terrain.Grass : Terrain.Water, causeway, 0, 0), 0);
}
// the north row's last two streets run side by side (district y 20 and 21): a stretch of the inner one becomes a lot, so
// the bus stop on the bank beside line 2's north pier faces a plain stretch of road
for (let lx = 11; lx <= 14; lx++) w.setTile(north.x + lx, north.y + 20, packTile(Terrain.Grass, false, 0, 0));
const busN = layBusNetwork(w, north.x, north.y), busS = layBusNetwork(w, south.x, south.y);
for (const id of w.parcels.keys()) w.recountRoads(id);

// ---- the game, and a fake client for the protocol --------------------------------------------------------------
class Sock { open = true; send() {} close() {} onMessage() {} onClose() {} }
const game = createGame(w, { onConnection() {} }, { devTools: true, sandbox: false });
const { sim, net, ferry } = game;
const sys = w.players.get('sys')!;
sys.money = 1_000_000;
const client = { conn: new Sock(), player: sys, subs: new Set<string>(), lastHint: 0, builderHint: 0, builtSeen: 0, builtMoved: 0 };
for (let cy = chunkOf(layout.y0); cy <= chunkOf(layout.y0 + layout.span); cy++) for (let cx = chunkOf(layout.x0); cx <= chunkOf(layout.x0 + layout.span); cx++) client.subs.add(chunkKey(cx, cy));
(net as unknown as { clients: Set<unknown> }).clients.add(client);
const toasts: string[] = [];
(net as unknown as { toast(c: unknown, msg: string): void }).toast = (_c, msg) => { toasts.push(msg); };
const send = (m: ClientMsg) => (net as unknown as { handle(c: unknown, m: ClientMsg): void }).handle(client, m);

// ---- piers on the bank, placed with the tool; bus stops on the bank beside line 2's -----------
const finish = (x: number, y: number) => { const s = w.sites.get(`${x},${y}`); if (s) w.completeSite(s); };
/** a pier with its door on the north bank (n) or the south bank, at x */
const pier = (x: number, n: boolean): [number, number] => {
  const y = n ? Y0 : Y1, before = toasts.length;
  send({ t: 'build', tool: 'ferrypier', tiles: [[x, y]], dev: true });
  finish(x, y);
  const p = ferry.stopProblem(x, y);
  ok(!!pierAt(x, y, ferry.env) && !p, `pier at (${x}, ${y}) placed, boats can call: ${p ?? ''} ${toasts.slice(before).join('; ')}`);
  return [x, y];
};
const busStop = (x: number, n: boolean): { x: number; y: number } => {
  const y = n ? Y0 : Y1;
  send({ t: 'build', tool: 'busstop', tiles: [[x, y]], dev: true });
  ok(w.kindIdAt(x, y) === 17, `bus stop at (${x}, ${y}): ${toasts[toasts.length - 1] ?? ''}`);
  return { x, y };
};
// line 1, a loop round the lake: the west and east piers of the north shore, then of the south; line 2 straight across
// the middle. Doors at district x 8 (north) and 12 (south), clear of the streets coming down to the bank.
const W = dist(0, mid - 1).x, E = dist(D - 1, mid - 1).x, M = north.x;
const PN = pier(W + 8, true), PE = pier(E + 8, true), PS = pier(E + 12, false), PW = pier(W + 12, false);
const QN = pier(M + 8, true), QS = pier(M + 12, false);
const stopN = busStop(M + 12, true), stopS = busStop(M + 9, false);
w.tick = 4 * TICKS_PER_HOUR;

// feeder buses: each middle district's cross line of ab.ts, on to the bank beside line 2's pier
const feeders = [[...busN.lines[1], stopN], [...busS.lines[1].slice().reverse(), stopS]];
feeders.forEach((stops, i) => send({ t: 'line', op: 'save', line: { number: 20 + i, colour: i ? 0x2f8fd6 : 0xd94f4f, stops, loop: false, vehicles: 3 } }));
ok([...w.transitLines.values()].filter((l) => l.mode === 'bus').length === 2, `two feeder bus lines saved: ${toasts.slice(-2).join('; ')}`);

const previewOf = (spec: Partial<TransitLine>) => sim.transit.previewLine('sys', spec, 1);
const ferryLine = (n: number) => [...w.transitLines.values()].find((l) => l.mode === 'ferry' && l.number === n);
const stopsOf = (ps: [number, number][]) => ps.map(([x, y]) => ({ x, y }));
const spec1: Partial<TransitLine> = { number: 1, name: 'Lake Loop', colour: 0x1fb5a8, stops: stopsOf([PN, PE, PS, PW]), loop: true, vehicles: 8 };
const spec2: Partial<TransitLine> = { number: 2, name: 'Cross Lake', colour: 0xe6a23c, stops: stopsOf([QN, QS]), loop: false, vehicles: 4 };
const pvs = new Map<number, LinePreview>();
if (!OFF) {
  for (const spec of [spec1, spec2]) {
    const pv = previewOf(spec);
    pvs.set(spec.number!, pv);
    ok(pv.ok && !pv.problem, `line ${spec.number} preview: ${pv.problem?.message ?? ''}`);
    ok((pv.sail?.length ?? 0) >= 8, `line ${spec.number} preview has a sailing line (${(pv.sail?.length ?? 0) / 2} points)`);
    send({ t: 'line', op: 'save', line: spec });
    const line = ferryLine(spec.number!);
    ok(!!line, `line ${spec.number} saved: ${toasts[toasts.length - 1]}`);
    const route = line && sim.transit.routeOf(line.id);
    ok(!!route && JSON.stringify(route.path) === JSON.stringify(pv.path), `line ${spec.number}: the saved route is the previewed one`);
    console.log(`line ${spec.number} (${spec.name}): ${spec.stops!.length} piers, ${spec.loop ? 'loop' : 'there and back'}; lap ${pv.length} tiles, ${pv.lapTicks} ticks (${((pv.lapTicks * 60) / TICKS_PER_HOUR).toFixed(0)} game min)`);
    if (SAVE) { saveWorld(w, SAVE); console.log(`saved to ${SAVE}; the piers of line 2 are at (${QN}) and (${QS})`); process.exit(0); }
  }
  // refusals: a pier another line calls at, a single pier, a bus stop on a ferry line
  const shared = previewOf({ number: 3, stops: stopsOf([PN, QS]), loop: false, vehicles: 1 });
  ok(!shared.ok && /already serves/.test(shared.problem?.message ?? ''), `a pier another line calls at is refused: ${shared.problem?.message}`);
  send({ t: 'line', op: 'save', line: { number: 3, stops: stopsOf([PN, QS]), loop: false, vehicles: 1 } });
  ok(!ferryLine(3) && /already serves/.test(toasts[toasts.length - 1] ?? ''), `saving it is refused too: ${toasts[toasts.length - 1]}`);
  ok(!previewOf({ number: 3, stops: stopsOf([QN]), loop: false, vehicles: 1 }).ok, 'a one-pier line is refused');
  const mixed = previewOf({ number: 3, stops: [{ x: QN[0], y: QN[1] }, stopN], loop: false, vehicles: 1 });
  ok(!mixed.ok, `a bus stop on a ferry line is refused: ${mixed.problem?.message}`);
  // the routes: river-class water off the stop rows, the stop rows straight, the boats' berths nose to tail
  for (const n of [1, 2]) {
    const rl = (ferry as unknown as { byId: Map<number, { route: { stops: { k: number; len: number }[] } | null; svc: RailService | null }> }).byId.get(ferryLine(n)!.id);
    ok(!!rl?.route && !!rl.svc, `line ${n} has a route and a service`);
    if (!rl?.route || !rl.svc) continue;
    const g = railGeometry(rl.svc.geom.route), rows = new Set<number>();
    for (const s of rl.route.stops) for (let k = s.k; k < s.k + s.len; k++) rows.add(k);
    let narrow = 0;
    g.tiles.forEach((t, k) => { if (!rows.has(k) && clearanceAt({ tile: (x, y) => w.peekTile(x, y), aux: (x, y) => w.auxAt(x, y) }, t.x, t.y) < 2) narrow++; });
    ok(narrow === 0, `line ${n}: every tile off the stop rows has river-class clearance (${narrow} do not)`);
    // the hull of a boat at either berth position lies on the straight of its stop row
    const p = { x: 0, z: 0, h: 0 };
    let bent = 0;
    for (const piece of rl.svc.pieces) {
      if (piece.stop < 0) continue;
      const hs: number[] = [];
      for (const d of [-0.47, 0, 0.47]) { railPoint(g, piece.s0 + d, p); hs.push(p.h); }
      if (Math.abs(Math.sin(hs[0] - hs[2])) > 1e-6 || Math.abs(Math.sin(hs[0] - hs[1])) > 1e-6) bent++;
    }
    ok(bent === 0, `line ${n}: boats lie straight along the berth at every call (${bent} bent)`);
    const offs = rl.svc.pieces.filter((q) => q.stop >= 0).map((q) => q.s0 - g.stopS[q.stop]);
    ok(offs.every((o) => Math.abs(Math.abs(o) - 0.5) < 1e-9), `line ${n}: boats lie half a tile off the berth's middle (${offs.map((o) => o.toFixed(2)).join(' ')})`);
    console.log(`  line ${n}: ${rl.svc.trains} boat(s) running of ${ferryLine(n)!.vehicles}, every ${(rl.svc.headway * 60 / TICKS_PER_HOUR).toFixed(0)} min${rl.svc.note ? ` (${rl.svc.note})` : ''}`);
  }
}

// ---- fill, then a measured day -------------------------------------------------------------------------------------
const fill = FILL ? await fillCity(w, () => game.step(), () => {}) : { pop: w.citizens.size, ticks: 0, seconds: 0 };
console.log(`${D}×${D} districts (a lake in the middle) filled: ${fill.pop} citizens in ${(fill.ticks / TICKS_PER_DAY).toFixed(2)} days (${fill.seconds.toFixed(0)} s)${OFF ? ', ferries off' : ''}`);
for (const l of w.transitLines.values()) console.log(`  ${l.mode} ${l.name ?? l.number}: ${sim.transit.routeProblem(l.id) || 'routed'}`);

// commutes across the lake: half the workers living and working in each north district swap jobs with the one opposite
const inDistrict = (d: { x: number; y: number }, x: number, y: number) => x >= d.x && x < d.x + DISTRICT && y >= d.y && y < d.y + DISTRICT;
let swapped = 0;
for (const [a, b] of Array.from({ length: D }, (_, i) => [dist(i, mid - 1), dist(i, mid + 1)])) {
  const byKind = (d: { x: number; y: number }) => {
    const m = new Map<number, typeof w.citizens extends Map<number, infer C> ? C[] : never>();
    for (const c of w.citizens.values()) if (c.job && inDistrict(d, c.hx, c.hy) && inDistrict(d, c.wx, c.wy)) { let l = m.get(c.kind); if (!l) m.set(c.kind, l = []); l.push(c); }
    return m;
  };
  const ka = byKind(a), kb = byKind(b);
  for (const [kind, la] of ka) {
    const lb = kb.get(kind) ?? [];
    for (let i = 0; i < Math.min(la.length, lb.length); i += 2) {
      const p = la[i], q = lb[i];
      [p.wx, q.wx] = [q.wx, p.wx]; [p.wy, q.wy] = [q.wy, p.wy];
      p.commute = null; q.commute = null;
      swapped += 2;
    }
  }
}
console.log(`${swapped} workers now commute across the lake`);

const timed = { ferry: 0, ferryTrips: 0, mixed: 0 };
const fTick = ferry.tick.bind(ferry);
ferry.tick = () => { const t = performance.now(); fTick(); timed.ferry += performance.now() - t; };
const tr = sim.transit as unknown as { legsFor(p: TransitPlan, ...a: number[]): unknown };
const legsFor = tr.legsFor.bind(sim.transit);
tr.legsFor = (p: TransitPlan, ...a: number[]) => {
  const r = legsFor(p, ...a);
  if (r) { const modes = new Set(p.rides.map((x) => x.line.mode)); if (modes.has('ferry')) timed.ferryTrips++; if (modes.has('ferry') && modes.has('bus')) timed.mixed++; }
  return r;
};

const startAt = (Math.floor(ferry.railTick / TICKS_PER_DAY) + 1) * TICKS_PER_DAY + FROM * TICKS_PER_HOUR;
while (ferry.railTick < startAt) game.step();
const s0 = { ...sim.transit.stats };
timed.ferry = 0; timed.ferryTrips = 0; timed.mixed = 0;
const served = new Map<string, number>();
const fx = ferry as unknown as { serve(rl: { line: { id: number } }, train: number, stop: number, dir: number, arrival?: boolean): void };
const serve = fx.serve.bind(ferry);
fx.serve = (rl, train, stop, dir, arrival = true) => { if (arrival) served.set(`${rl.line.id}:${stop}`, (served.get(`${rl.line.id}:${stop}`) ?? 0) + 1); serve(rl, train, stop, dir, arrival); };
const onOff = new Map<number, { on: number; off: number }>();
const tsc = sim.transit as unknown as { serveCall(vid: number, line: number, call: number, room: number, board?: boolean): { off: number; on: number } };
const serveCall = tsc.serveCall.bind(sim.transit);
tsc.serveCall = (vid, line, call, room, board = true) => {
  const r = serveCall(vid, line, call, room, board);
  let e = onOff.get(line);
  if (!e) onOff.set(line, e = { on: 0, off: 0 });
  e.on += r.on; e.off += r.off;
  return r;
};
const pierFeet = [PN, PE, PS, PW, QN, QS].map(([x, y]) => pierAt(x, y, ferry.env)!);
const onPontoon = (x: number, y: number) => pierFeet.some((p) => x >= p.ax && x < p.ax + p.w && y >= p.ay && y < p.ay + p.h);
const times: number[] = [];
const ticks = Math.round(HOURS * TICKS_PER_HOUR);
let staleWait = 0, lostAboard = 0, waitSeen = 0, waitOff = 0, peakBoat = 0;
const tStart = ferry.railTick;
for (let i = 0; i < ticks; i++) {
  const t = performance.now();
  game.step();
  times.push(performance.now() - t);
  if (w.tick % 10 === 0) {
    const tri = sim.transit as unknown as { waiting: Map<number, { c: { x: number; y: number }; line: number; boardAt: number }[]>; onboard: Map<number, unknown[]> };
    for (const list of tri.waiting.values()) for (const r of list) {
      if (w.transitLines.get(r.line)?.mode !== 'ferry') continue;
      waitSeen++;
      if (!onPontoon(Math.floor(r.c.x), Math.floor(r.c.y))) waitOff++;
    }
    for (const [vid, list] of tri.onboard) if (vid >= 1 << 30) peakBoat = Math.max(peakBoat, list.length);
  }
  if (w.tick % 100 === 50) {
    const tri = sim.transit as unknown as { waiting: Map<number, { since: number; maxWait: number }[]>; onboard: Map<number, unknown[]>; serviceOfVehicle(l: unknown[]): { positionOf(v: number): unknown } | undefined };
    for (const list of tri.waiting.values()) for (const r of list) if (w.tick - r.since > r.maxWait + 10) staleWait++;
    for (const [vid, list] of tri.onboard) if (list.length && !tri.serviceOfVehicle(list)?.positionOf(vid)) lostAboard++;
  }
}
const tEnd = ferry.railTick;

// ---- report and checks -----------------------------------------------------------------------------------------------
const sorted = [...times].sort((a, b) => a - b), avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`${HOURS} h measured: tick avg ${avg.toFixed(2)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms; Ferry.tick ${(timed.ferry / ticks).toFixed(3)} ms/tick`);
const st = sim.transit.stats;
console.log(`transit: ${st.planned - s0.planned} trips planned, ${st.boarded - s0.boarded} boarded, ${st.alighted - s0.alighted} alighted, ${st.transfers - s0.transfers} changes, ${st.gaveUp - s0.gaveUp} gave up; ${timed.ferryTrips} trips by river bus, ${timed.mixed} changing between a river bus and a bus`);
if (!OFF) {
  const infos = sim.transit.lineInfos((id) => id);
  for (const l of infos) console.log(`  ${l.mode} ${l.name ?? l.number}: ${l.ridersToday + l.ridersYesterday} riders over the day, status ${l.status}`);
  console.log(`  ferry riders seen waiting ${waitSeen} times (${waitOff} off a pontoon), peak boat load ${peakBoat} of ${FERRY.riders}`);
  for (const n of [1, 2]) {
    const l = ferryLine(n)!;
    const oo = onOff.get(l.id) ?? { on: 0, off: 0 };
    console.log(`  ${l.name}: ${oo.on} on, ${oo.off} off in the window`);
    ok(oo.on > 0, `${l.name}: riders board (${oo.on})`);
    ok(oo.off > 0, `${l.name}: riders alight (${oo.off})`);
    const rl = (ferry as unknown as { byId: Map<number, { svc: Parameters<typeof callsBetween>[0] | null; def: { stations: [number, number][] } }> }).byId.get(l.id)!;
    ok(!!rl.svc, `${l.name}: running`);
    if (!rl.svc) continue;
    const want = new Map<number, number>();
    for (const c of callsBetween(rl.svc, tStart, tEnd)) want.set(c.stop, (want.get(c.stop) ?? 0) + 1);
    let off = 0, total = 0;
    rl.def.stations.forEach((_, i) => { const got = served.get(`${l.id}:${i}`) ?? 0; total += got; if (got !== (want.get(i) ?? 0)) off++; });
    ok(off === 0 && total > 0, `${l.name}: every pier has the timetable's calls (${off} off; ${total} calls)`);
  }
  ok(timed.ferryTrips > 0, `trips are planned by river bus (${timed.ferryTrips})`);
  ok(timed.mixed > 0, `some trips change between a river bus and a bus (${timed.mixed})`);
  ok(waitSeen > 0 && waitOff === 0, `ferry riders wait on the pontoon (${waitSeen} seen, ${waitOff} elsewhere)`);
  // the tooltip of line 2's north pier, with the feeder bus a short walk away
  const info = ferry.describeStation(QN[0], QN[1]);
  ok(!!info && info.track === 'open' && info.lines.length === 1 && info.changes.some((c) => c.mode === 'bus') && !!info.lines[0].next, `line 2's north pier's tooltip: ${info?.track}, ${info?.lines.length} line(s), next boat ${info?.lines[0]?.next?.toward}, change for ${info?.changes.map((c) => c.mode).join(',')}`);
}
ok(staleWait === 0, `nobody waits past their give-up time (${staleWait})`);
ok(lostAboard === 0, `nobody is on board a boat or bus that is not running (${lostAboard})`);

// ---- bulldozing a pier grounds its line ------------------------------------------------------------------------------
if (!OFF) {
  const l2 = ferryLine(2)!;
  send({ t: 'build', tool: 'bulldoze', tiles: [[QS[0], QS[1]]] });
  for (let i = 0; i < 112; i++) game.step();
  ok(!pierAt(QS[0], QS[1], ferry.env) && !!ferry.problem(l2), `line 2 stops when its pier is bulldozed: ${ferry.problem(l2)}`);
  const s = ferryStop(QS[0], QS[1], ferry.env);
  ok('reason' in s, `no stop where the pier was: ${'reason' in s ? s.reason : ''}`);
  const l1 = ferryLine(1)!;
  ok(!ferry.problem(l1) || /between trains|outside/.test(ferry.problem(l1) ?? ''), `line 1 still runs: ${ferry.problem(l1) ?? 'running'}`);
}

console.log(`${fails ? `FAILED ${fails} of ${checks} checks` : `all ${checks} checks passed`} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(fails ? 1 : 0);
