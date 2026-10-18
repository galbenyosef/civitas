/**
 * Metro service check and load test (docs/underground.md section 8): a seedCity test city with two crossing metro
 * lines and a bus network, run for a game day after the fill.
 *
 *   npx tsx packages/server/src/loadtest/metro.ts [--districts 3] [--hours 24] [--from 0] [--off] [--seed 1] [--no-fill]
 *
 * Everything a player does goes through the real protocol (Net.handle with a fake client): the stations are placed
 * with the metro tools (a hall at each end of the east-west line, kiosks elsewhere), the lines are previewed and saved
 * from the Lines panel's messages, and an entrance and a tunnel are bulldozed at the end. Line A runs east-west along
 * the middle row of districts, line B north-south down the middle column, crossing A's tunnel at a crossover; the
 * middle district has the bus network of loadtest/ab.ts with a bus stop within the change walk of four stations.
 *
 * Asserted: the preview is what the save bores and routes, and the second save of a line costs nothing; B crosses A at
 * one crossover; trains call at every station as often as the timetable says (on time, as it is pure); riders board and
 * alight on both lines; some trips change between the metro and a bus; riders on a platform carry CITIZEN_UNDER on the
 * wire and nobody else does; nobody waits past their give-up time and nobody is on board a train that is not running;
 * a bulldozed entrance's platform turns back into tunnel and grounds its line; a used tunnel cannot be filled and an
 * unused one can. `--off` builds the same city and stations but saves no metro line, for the tick cost without it.
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, terrainOf, packTile, chunkOf, chunkKey, isTunnel, isPlatform, underMask,
  callsBetween, citizenUnder, METRO, type TransitLine, type LinePreview, type ClientMsg,
} from '@msimcity/shared';
import { World } from '../world';
import { createGame } from '../game';
import { fillCity } from '../fill';
import { seededRandom } from '../demo/seed';
import { seedCity } from './cities';
import { layBusNetwork } from './ab';
import type { TransitPlan } from '../sim/transit';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const D = Math.max(2, Number(arg('districts', '3')) | 0);
const HOURS = Number(arg('hours', '24'));
const OFF = argv.includes('--off');
const SEED = Number(arg('seed', '1'));
/** the hour of day the measured stretch starts at; --no-fill skips the fill (the checks of riders then mostly fail) */
const FROM = Number(arg('from', '0'));
const FILL = !argv.includes('--no-fill');

let fails = 0, checks = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${what}`); } };
const t0 = performance.now();

Math.random = seededRandom(SEED * 7919);
const w = new World(SEED);
const layout = seedCity(w, { districts: D, built: 3 });
const mid = Math.floor(D / 2);
const dist = (i: number, j: number) => layout.districts[j * D + i];
const md = dist(mid, mid);
const bus = layBusNetwork(w, md.x, md.y);
for (const id of w.parcels.keys()) w.recountRoads(id);

// ---- the game, and a fake client for the protocol --------------------------------------------------------------
class Sock { open = true; under = 0; flagged = 0; send(s: string) { if (s.startsWith('{"t":"citizens"')) { const c = (JSON.parse(s) as { c: number[] }).c; for (let i = 3; i < c.length; i += 4) { this.flagged++; if (citizenUnder(c[i])) this.under++; } } } close() {} onMessage() {} onClose() {} }
const game = createGame(w, { onConnection() {} }, { devTools: true, sandbox: false });
const { sim, net, metro } = game;
const sys = w.players.get('sys')!;
sys.money = 1_000_000;
const sock = new Sock();
const client = { conn: sock, player: sys, subs: new Set<string>(), lastHint: 0, builderHint: 0, builtSeen: 0, builtMoved: 0 };
for (let cy = chunkOf(layout.y0); cy <= chunkOf(layout.y0 + layout.span); cy++) for (let cx = chunkOf(layout.x0); cx <= chunkOf(layout.x0 + layout.span); cx++) client.subs.add(chunkKey(cx, cy));
(net as unknown as { clients: Set<unknown> }).clients.add(client);
const toasts: string[] = [];
(net as unknown as { toast(c: unknown, msg: string): void }).toast = (_c, msg) => { toasts.push(msg); };
const send = (m: ClientMsg) => (net as unknown as { handle(c: unknown, m: ClientMsg): void }).handle(client, m);

// ---- stations: cleared lots beside the streets, placed with the metro tools ----------------------------------------
const clear = (x: number, y: number) => w.setTile(x, y, packTile(terrainOf(w.getTile(x, y)), false, 0, 0));
const finish = (x: number, y: number) => { const s = w.sites.get(`${x},${y}`); if (s) w.completeSite(s); };
/** a kiosk (or a hall, 2×1, its front to the south) with its door at district-local (lx, ly) */
const station = (i: number, j: number, lx: number, ly: number, hall = false): [number, number] => {
  const d = dist(i, j), x = d.x + lx, y = d.y + ly;
  for (let dx = 0; dx <= (hall ? 1 : 0); dx++) clear(x + dx, y);
  const before = toasts.length;
  send({ t: 'build', tool: hall ? 'metrostation' : 'metroentrance', tiles: [[x, y]], dev: true, ...(hall ? { rot: 0 } : {}) });
  finish(x, y);
  const p = metro.stopProblem(x, y);
  ok(!p, `station at (${x}, ${y}) placed with its platform: ${p ?? ''} ${toasts.slice(before).join('; ')}`);
  return [x, y];
};
// line A, east-west along row 9 of the middle row of districts: a kiosk at x 3 and 13 of each (halls at the two ends);
// its platforms run along x (the kiosks face the street to the south)
const A: [number, number][] = [];
for (let i = 0; i < D; i++) for (const lx of [3, 13]) A.push(station(i, mid, lx, 9, (i === 0 && lx === 3) || (i === D - 1 && lx === 13)));
// line B, north-south down column 9 of the middle column: kiosks at y 3 and 16 facing the street to the east (platforms along y)
const B: [number, number][] = [];
for (let j = 0; j < D; j++) for (const ly of [3, 16]) B.push(station(mid, j, 9, ly));
// a free lot within the change walk of A's second station, for the refusal's suggested tile
clear(dist(0, mid).x + 13, dist(0, mid).y + 6);
w.tick = 4 * TICKS_PER_HOUR;

// the bus network (two lines in the middle district) and the metro lines, from the Lines panel's messages
bus.lines.forEach((stops, i) => send({ t: 'line', op: 'save', line: { number: 10 + i, colour: i ? 0x2f8fd6 : 0xd94f4f, stops, loop: i === 0, vehicles: 3 } }));
ok([...w.transitLines.values()].filter((l) => l.mode === 'bus').length === 2, `two bus lines saved: ${toasts.slice(-2).join('; ')}`);

const previewOf = (spec: Partial<TransitLine>) => sim.transit.previewLine('sys', spec, 1);
const saveMetro = (spec: Partial<TransitLine>): { line: TransitLine | undefined; pv: LinePreview; spent: number } => {
  const pv = previewOf(spec), m0 = sys.money;
  send({ t: 'line', op: 'save', line: spec });
  const line = [...w.transitLines.values()].find((l) => l.mode === 'metro' && l.number === spec.number);
  return { line, pv, spent: m0 - sys.money };
};
const specA: Partial<TransitLine> = { number: 1, name: 'Central', colour: 0xdc241f, stops: A.map(([x, y]) => ({ x, y })), loop: false, vehicles: 8 };
const specB: Partial<TransitLine> = { number: 2, name: 'Northern', colour: 0x303030, stops: B.map(([x, y]) => ({ x, y })), loop: false, vehicles: 6 };
if (!OFF) {
  for (const [spec, name] of [[specA, 'A'], [specB, 'B']] as const) {
    const { line, pv, spent } = saveMetro(spec);
    ok(pv.ok && !pv.problem, `line ${name} preview: ${pv.problem?.message ?? ''} ${pv.problem?.fix ?? ''}`);
    ok(!!line, `line ${name} saved: ${toasts[toasts.length - 1]}`);
    ok(spent === pv.cost, `line ${name}: the save cost $${spent}, the preview said $${pv.cost}`);
    const route = line && sim.transit.routeOf(line.id);
    ok(!!route && JSON.stringify(route.path) === JSON.stringify(pv.path), `line ${name}: the saved route is the previewed one`);
    console.log(`line ${name}: ${spec.stops!.length} stations, ${(pv.bore?.length ?? 0) / 2} tiles bored, ${(pv.crossovers?.length ?? 0) / 2} crossover(s), $${pv.cost}; lap ${pv.length} tiles, ${pv.lapTicks} ticks`);
    if (name === 'B') ok((pv.crossovers?.length ?? 0) === 2, `line B crosses line A at one crossover (${pv.crossovers?.join(',')})`);
    // saving again bores nothing and costs nothing
    const again = saveMetro({ ...spec, id: line?.id });
    ok(again.spent === 0 && again.pv.cost === 0 && (again.pv.bore?.length ?? 0) === 0, `line ${name}: saving again costs $${again.spent} (preview $${again.pv.cost})`);
  }
  // refusals with a fix: a line calling at A's station, a single station
  const shared = previewOf({ number: 3, stops: [{ x: A[1][0], y: A[1][1] }, { x: B[0][0], y: B[0][1] }], loop: false, vehicles: 1 });
  ok(!shared.ok && /already calls/.test(shared.problem?.message ?? '') && !!shared.problem?.suggest, `a station another line calls at is refused with a tile to suggest: ${shared.problem?.message} / ${shared.problem?.fix}`);
  const one = previewOf({ number: 3, stops: [{ x: A[0][0], y: A[0][1] }], loop: false, vehicles: 1 });
  ok(!one.ok, 'a one-station line is refused');
  const tunnelTiles = countTunnels();
  console.log(`under layer: ${tunnelTiles.tunnel} tunnel tiles (${tunnelTiles.platform} platform, ${tunnelTiles.cross} crossover)`);
}
function countTunnels() {
  let tunnel = 0, platform = 0, cross = 0;
  for (const ch of w.chunks.values()) for (const b of ch.under) { if (isTunnel(b)) tunnel++; if (isPlatform(b)) platform++; if (isTunnel(b) && underMask(b) === 15) cross++; }
  return { tunnel, platform, cross };
}

// ---- fill, then a measured day -------------------------------------------------------------------------------------
const fill = FILL ? await fillCity(w, () => game.step(), () => {}) : { pop: w.citizens.size, ticks: 0, seconds: 0 };
console.log(`${D}×${D} districts filled: ${fill.pop} citizens in ${(fill.ticks / TICKS_PER_DAY).toFixed(2)} days (${fill.seconds.toFixed(0)} s)${OFF ? ', metro off' : ''}`);
for (const l of w.transitLines.values()) if (l.mode === 'metro') console.log(`  ${l.name}: ${metro.problem(l) ?? 'running'}`);

// long commutes: seedCity's are a few tiles (everyone works round the corner), which no train wins. Half the workers
// living in the district at one end of each line swap workplaces with workers of the same kind at the other end.
const inDistrict = (d: { x: number; y: number }, x: number, y: number) => x >= d.x && x < d.x + 22 && y >= d.y && y < d.y + 22;
let swapped = 0;
for (const [a, b] of [[dist(0, mid), dist(D - 1, mid)], [dist(mid, 0), dist(mid, D - 1)]]) {
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
console.log(`${swapped} workers now commute from one end of a line to the other`);

// time Metro.tick and Transit.bestTransit inside the ticks
const timed = { metro: 0, best: 0, bestCalls: 0, mixed: 0, metroTrips: 0 };
const mTick = metro.tick.bind(metro);
metro.tick = () => { const t = performance.now(); mTick(); timed.metro += performance.now() - t; };
const tr = sim.transit as unknown as { bestTransit(...a: number[]): TransitPlan | null; legsFor(p: TransitPlan, ...a: number[]): unknown };
const best = tr.bestTransit.bind(sim.transit), legsFor = tr.legsFor.bind(sim.transit);
tr.bestTransit = (...a: number[]) => { const t = performance.now(); const r = best(...a); timed.best += performance.now() - t; timed.bestCalls++; return r; };
tr.legsFor = (p: TransitPlan, ...a: number[]) => {
  const r = legsFor(p, ...a);
  if (r) { const modes = new Set(p.rides.map((x) => x.line.mode)); if (modes.has('metro')) timed.metroTrips++; if (modes.has('metro') && modes.has('bus')) timed.mixed++; }
  return r;
};

// run to the next FROM:00, then measure
const startAt = (Math.floor(metro.railTick / TICKS_PER_DAY) + 1) * TICKS_PER_DAY + FROM * TICKS_PER_HOUR;
while (metro.railTick < startAt) game.step();
const s0 = { ...sim.transit.stats };
timed.metro = 0; timed.best = 0; timed.bestCalls = 0; timed.mixed = 0; timed.metroTrips = 0;
// every arrival at a station in the window, by line and station (Timetabled.serve), against the timetable's calls
const served = new Map<string, number>();
const mx = metro as unknown as { serve(rl: { line: { id: number } }, train: number, stop: number, dir: number, arrival?: boolean): void };
const serve = mx.serve.bind(metro);
// riders on and off per line in the window
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
mx.serve = (rl, train, stop, dir, arrival = true) => { if (arrival) served.set(`${rl.line.id}:${stop}`, (served.get(`${rl.line.id}:${stop}`) ?? 0) + 1); serve(rl, train, stop, dir, arrival); };
const times: number[] = [];
const ticks = Math.round(HOURS * TICKS_PER_HOUR);
let underSeen = 0, underWrong = 0, peakPlatform = 0, peakTrain = 0, staleWait = 0, lostAboard = 0;
sock.under = 0; sock.flagged = 0;
const tStart = metro.railTick;
for (let i = 0; i < ticks; i++) {
  const t = performance.now();
  game.step();
  times.push(performance.now() - t);
  if (w.tick % 10 === 0) {
    let onPlatform = 0;
    for (const a of sim.agents()) {
      if (!a.under) continue;
      underSeen++; onPlatform++;
      const c = w.citizens.get(a.id), r = c && sim.transit.riderOf(c);
      if (!r || r.line?.mode !== 'metro') underWrong++; // waiting, or still stepping aboard from the platform
    }
    peakPlatform = Math.max(peakPlatform, onPlatform);
    for (let k = 0; k < metro.loads.length;) { const n = metro.loads[k + 1]; for (let q = 0; q < n; q++) peakTrain = Math.max(peakTrain, metro.loads[k + 2 + q]); k += 2 + n; }
  }
  if (w.tick % 100 === 50) {
    const tri = sim.transit as unknown as { waiting: Map<number, { since: number; maxWait: number }[]>; onboard: Map<number, unknown[]>; serviceOfVehicle(l: unknown[]): { positionOf(v: number): unknown } | undefined };
    for (const list of tri.waiting.values()) for (const r of list) if (w.tick - r.since > r.maxWait + 10) staleWait++;
    for (const [vid, list] of tri.onboard) if (list.length && !tri.serviceOfVehicle(list)?.positionOf(vid)) lostAboard++;
  }
}
const tEnd = metro.railTick;

// ---- report and checks -----------------------------------------------------------------------------------------------
const sorted = [...times].sort((a, b) => a - b), avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`${HOURS} h measured: tick avg ${avg.toFixed(2)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms; Metro.tick ${(timed.metro / ticks).toFixed(3)} ms/tick; bestTransit ${(timed.best / ticks).toFixed(3)} ms/tick (${timed.bestCalls} calls, ${(1000 * timed.best / Math.max(1, timed.bestCalls)).toFixed(1)} µs each)`);
const st = sim.transit.stats;
console.log(`transit: ${st.planned - s0.planned} trips planned, ${st.boarded - s0.boarded} boarded, ${st.alighted - s0.alighted} alighted, ${st.transfers - s0.transfers} changes, ${st.gaveUp - s0.gaveUp} gave up; ${timed.metroTrips} trips by metro, ${timed.mixed} changing between metro and bus`);
if (!OFF) {
  const infos = sim.transit.lineInfos((id) => id);
  for (const l of infos) console.log(`  ${l.mode} ${l.name ?? l.number}: ${l.ridersToday + l.ridersYesterday} riders over the day, status ${l.status}`);
  console.log(`  peak platform crowd ${peakPlatform}, peak train load ${peakTrain} (of ${METRO.carRiders} a car), CITIZEN_UNDER on ${sock.under} of ${sock.flagged} agent quads sent`);
  for (const l of w.transitLines.values()) {
    if (l.mode !== 'metro') continue;
    const info = infos.find((x) => x.id === l.id)!;
    const oo = onOff.get(l.id) ?? { on: 0, off: 0 };
    console.log(`  ${l.name}: ${oo.on} on, ${oo.off} off in the window`);
    ok(oo.on > 0, `${l.name}: riders board (${oo.on})`);
    ok(oo.off > 0, `${l.name}: riders alight (${oo.off})`);
    // on time: every station's calls over the day are the timetable's calls
    const svc = (metro as unknown as { byId: Map<number, { svc: Parameters<typeof callsBetween>[0] | null; def: { stations: [number, number][] } }> }).byId.get(l.id)!;
    ok(!!svc.svc, `${l.name}: running`);
    if (!svc.svc) continue;
    const want = new Map<number, number>();
    for (const c of callsBetween(svc.svc, tStart, tEnd)) want.set(c.stop, (want.get(c.stop) ?? 0) + 1);
    let off = 0, total = 0;
    svc.def.stations.forEach((_, i) => {
      const got = served.get(`${l.id}:${i}`) ?? 0;
      total += got;
      if (got !== (want.get(i) ?? 0)) off++;
    });
    ok(off === 0 && total > 0, `${l.name}: every station has the timetable's calls (${off} off; ${total} calls)`);
  }
  ok(timed.metroTrips > 0, `trips are planned by metro (${timed.metroTrips})`);
  ok(timed.mixed > 0, `some trips change between the metro and a bus (${timed.mixed})`);
  ok(underSeen > 0 && sock.under > 0, `riders on the platform carry CITIZEN_UNDER (${underSeen} sampled, ${sock.under} on the wire)`);
  ok(underWrong === 0, `only metro riders on a platform are flagged underground (${underWrong} others)`);
}
ok(staleWait === 0, `nobody waits past their give-up time (${staleWait})`);
ok(lostAboard === 0, `nobody is on board a train or bus that is not running (${lostAboard})`);

// ---- bulldozing: an entrance's platform reverts and grounds its line; a used tunnel stays, an unused one fills ----------
if (!OFF) {
  const lb = [...w.transitLines.values()].find((l) => l.number === 2 && l.mode === 'metro')!;
  const [kx, ky] = B[1];
  const plat = metro.describeStation(kx, ky)!.platform!;
  const aRoute = sim.transit.routeOf([...w.transitLines.values()].find((l) => l.number === 1 && l.mode === 'metro')!.id)!;
  const ax = aRoute.path[2 * 8], ay = aRoute.path[2 * 8 + 1]; // a tile of A's tunnel
  const before = w.underAt(ax, ay);
  send({ t: 'build', tool: 'bulldoze', tiles: [[ax, ay]], under: true });
  ok(w.underAt(ax, ay) === before, `a tunnel line A runs through cannot be filled: ${toasts[toasts.length - 1]}`);
  send({ t: 'build', tool: 'bulldoze', tiles: [[kx, ky]] });
  for (let i = 0; i < 12; i++) game.step();
  const b = w.underAt(plat[0], plat[1]);
  ok(isTunnel(b) && !isPlatform(b), `the bulldozed entrance's platform is plain tunnel again (byte ${b.toString(16)})`);
  ok(!!metro.problem(lb), `line B stops at its gone station: ${metro.problem(lb)}`);
  for (let i = 0; i < 101; i++) game.step();
  // B no longer runs, so its tunnel is free: fill a tile of the old platform
  send({ t: 'build', tool: 'bulldoze', tiles: [[plat[0], plat[1]]], under: true });
  ok(w.underAt(plat[0], plat[1]) === 0, `an unused tunnel tile fills: ${toasts[toasts.length - 1]}`);
  ok(!metro.problem([...w.transitLines.values()].find((l) => l.number === 1 && l.mode === 'metro')!) || /between trains|outside/.test(metro.problem([...w.transitLines.values()].find((l) => l.number === 1 && l.mode === 'metro')!) ?? ''), 'line A still runs');
  ok(!!metro.problem(lb) || !sim.transit.routeOf(lb.id), 'line B stays down');
}

console.log(`${fails ? `FAILED ${fails} of ${checks} checks` : `all ${checks} checks passed`} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(fails ? 1 : 0);
