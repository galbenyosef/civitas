/**
 * Boats (docs/boats.md section 9): builds a server World with a 4-wide river under all four bridge styles, a basin with
 * a sea gate, a 1-wide canal to a pond, and a small lake, mirrors the chunks into a ClientWorld as the wire would, and
 * checks the waterways (B1):
 *  - clearance: the cached grid equals the uncached count everywhere, and reads 1, 2, 2, 1 across the river;
 *  - bridges: channels, step rules, pass signatures from air drafts;
 *  - lanes, for every signature: every tile navigable with its class's clearance, each step joined, a deck crossed
 *    only on its channel and only across it, no deck its signature cannot clear, the same lane from a fresh grid and
 *    from the client's tiles; the refusals name what is in the way;
 *  - the sailing line: continuous, on route tiles or water of the class's clearance, straight across every deck;
 *  - open water, fishing grounds, cruise tours, and lanes re-derived after a bridge is built and taken away.
 * B3 appends the schedule: harbours (berths and derived lanes), fleets, a week of timetables (the same from the
 * client's tiles and the wire's copy, cold or cached), and every half tick no berth shared, no tall boat under a closed
 * or low deck, no jumps; bascule passages only inside lifts, one boat at a time.
 * Later subtasks append their sections (harbours, ferries).
 *   npx tsx packages/shared/scripts/boats-check.ts [days]
 */
import {
  packTile, u16ToB64, i32ToB64, u8ToB64, Terrain, BridgeStyle, BRIDGE_CLEARANCE, BRIDGE_STYLE_NAMES, planBridge, bridgeSpanAt, bridgeChannel,
  bridgeStepOk, waterStepOk, isBridgeAux, bridgeNS, bridgeStyle,
  WaterGrid, clearanceAt, navigable, waterLane, waterTiles, waterGeometry, waterPoint, passSig, passUnder, openWater, fishingGrounds,
  cruiseWaypoints, cruiseLane, gateServes, seaGateGoals, WIDTH_CLEARANCE, PASS_LIFT, PASS_ALL, OPEN_SEA_TILES, CRUISE_SPACING, CRUISE_RANGE, GROUNDS_RANGE,
  type WaterEnv, type WaterRoute, type WidthClass, type SeaGate, type BridgeStyleId,
} from '../src';
import {
  BOAT_TYPES, boatTimetable, boatsAt, harbourFleet, deriveHarbourLanes, harbourLaneSpecs, boatLane, clearBoatTimetables, voyageEvents, boatEvents,
  boatLifts, catchOf, callCargo, boatName, boatOwner, boatCrew, fishingReg, starboardOffset, HARBOUR_KIND, harbourBerths, placedBerths, placedFromDoor, BOAT_DAY_FROM, BOAT_DAY_TO,
  basculeOpen, basculeLifts, bridgeClearance, TICKS_PER_DAY, TICKS_PER_HOUR, BASCULE_RAISE, BASCULE_HOLD,
  hash2, type BoatHarbour, type Berth, type BoatState, type BoatType, type Voyage,
} from '../src';
import { World } from '../../server/src/world';
import { ClientWorld } from '../../client/src/world';

let failures = 0, checks = 0;
const fail = (msg: string) => { if (failures++ < 30) console.log('FAIL ' + msg); };
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) fail(msg); };
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

// ---- the world ------------------------------------------------------------------------------------------------
const w = new World(4242);
const X0 = -12, X1 = 176, Y0 = -12, Y1 = 92;
for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0));
const water = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.setTile(x, y, packTile(Terrain.Water, false, 0, 0)); };
water(0, 20, 99, 23);      // the river, 4 wide, west to east
water(100, 0, 159, 49);    // the basin it opens into, 60 × 50
water(70, 24, 70, 39);     // a 1-wide canal south off the river
water(68, 40, 72, 44);     // to a pond
water(10, 60, 29, 74);     // a small lake, 20 × 15
const gate: SeaGate = { x: 159, y: 25, name: 'the estuary' };
const paintEnv = { tile: (x: number, y: number) => w.getTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), land: () => null };
/** a bridge of `len` deck tiles from (x, y0) stepping (dx, dy), with road landings at both ends */
function bridge(x: number, y0: number, len: number, style: BridgeStyleId, dx = 0, dy = 1) {
  w.setTile(x - dx, y0 - dy, packTile(Terrain.Grass, true, 0, 0)); w.setTile(x + dx * len, y0 + dy * len, packTile(Terrain.Grass, true, 0, 0));
  const plan = planBridge(x, y0, dx, dy, len, paintEnv, style);
  if (!plan.ok) { fail(`bridge at (${x}, ${y0}): ${plan.reason}`); return; }
  w.placeBridge(plan.tiles!);
}
const BRIDGES: [number, BridgeStyleId][] = [[10, BridgeStyle.Arch], [25, BridgeStyle.Girder], [40, BridgeStyle.Suspension], [55, BridgeStyle.Bascule]];
for (const [x, st] of BRIDGES) bridge(x, 20, 4, st);
bridge(70, 30, 1, BridgeStyle.Arch, 1, 0); // over the canal: one deck tile, running east-west

const env: WaterEnv = { tile: (x, y) => w.peekTile(x, y), aux: (x, y) => w.auxAt(x, y) };
const grid = new WaterGrid(env);
const cw = new ClientWorld();
const mirror = () => { for (const c of w.chunks.values()) cw.putChunk({ cx: c.cx, cy: c.cy, tiles: u16ToB64(c.tiles), parcels: i32ToB64(c.parcel), aux: c.aux.some((v) => v) ? u8ToB64(c.aux) : undefined, sub: c.sub.some((v) => v) ? u8ToB64(c.sub) : undefined }); };
mirror();
const cgrid = new WaterGrid({ tile: (x, y) => cw.getTile(x, y), aux: (x, y) => cw.auxAt(x, y) });

// ---- clearance ----------------------------------------------------------------------------------------------------
console.log('=== clearance');
{
  let n = 0, wet = 0;
  for (let y = Y0 + 4; y <= Y1 - 4; y++) for (let x = X0 + 4; x <= X1 - 4; x++) {
    const a = grid.clearance(x, y), b = clearanceAt(env, x, y);
    n++; if (a) wet++;
    if (a !== b) { ok(false, `clearance at (${x}, ${y}): cached ${a}, counted ${b}`); break; }
  }
  checks++;
  const across = [20, 21, 22, 23].map((y) => grid.clearance(5, y)).join(',');
  ok(across === '1,2,2,1', `across the river: ${across}`);
  ok(grid.clearance(130, 25) === 4 && grid.clearance(70, 33) === 1, `basin ${grid.clearance(130, 25)}, canal ${grid.clearance(70, 33)}`);
  ok([20, 21, 22, 23].map((y) => grid.clearance(25, y)).join(',') === '1,2,2,1', 'a deck reads as water');
  console.log(`  ${n} tiles, ${wet} navigable, cached equals counted; across the river ${across}, under a deck the same`);
}

// ---- bridges and signatures ---------------------------------------------------------------------------------------
console.log('=== bridges and pass signatures');
for (const [x, st] of BRIDGES) {
  const s = bridgeSpanAt(x, 20, env.aux)!;
  const ch = bridgeChannel(s).map(([cx, cy]) => `${cx},${cy}`).join(' ');
  ok(s.style === st && s.len === 4 && s.ns && ch === `${x},21 ${x},22`, `${BRIDGE_STYLE_NAMES[st]}: span ${JSON.stringify(s)}, channel ${ch}`);
  ok(grid.channel(x, 21) && grid.channel(x, 22) && !grid.channel(x, 20) && !grid.channel(x, 23), `${BRIDGE_STYLE_NAMES[st]}: channel tiles`);
  const a = env.aux(x, 21);
  ok(waterStepOk(a, x, 21, x + 1, 21) && !waterStepOk(a, x, 21, x, 22) && bridgeStepOk(a, x, 21, x, 22) && !bridgeStepOk(a, x, 21, x + 1, 21), `${BRIDGE_STYLE_NAMES[st]}: boats step across, cars along`);
}
{
  const s = bridgeSpanAt(70, 30, env.aux)!;
  ok(!!s && s.len === 1 && bridgeChannel(s).length === 1 && grid.channel(70, 30), 'a 1-tile span is its own channel');
  ok(bridgeChannel({ x0: 0, y0: 0, dx: 1, dy: 0, len: 5, ns: false, style: 0 }).map((p) => p.join(',')).join(' ') === '2,0', 'odd span: the middle tile');
}
const SIGS: { what: string; air: number; cls: WidthClass; want: number }[] = [
  { what: 'narrowboat', air: 0.07, cls: 'narrow', want: 15 },
  { what: 'trawler', air: 0.17, cls: 'river', want: 12 },
  { what: 'sailboat', air: 0.38, cls: 'river', want: PASS_LIFT },
  { what: 'container ship', air: 0.48, cls: 'open', want: PASS_LIFT },
];
for (const s of SIGS) ok(passSig(s.air) === s.want, `${s.what} (air draft ${s.air}): signature ${passSig(s.air)}, want ${s.want}`);
ok(passSig(0.12) === 14 && passSig(0.21) === PASS_LIFT && passSig(0.199) === 12 && passSig(0.38, false) === 0, 'air draft equal to a clearance does not pass');
ok(passUnder(12, BridgeStyle.Bascule) === true && passUnder(PASS_LIFT, BridgeStyle.Bascule) === 'lift' && passUnder(PASS_LIFT, BridgeStyle.Suspension) === false, 'passUnder');
ok(JSON.stringify(seaGateGoals(grid, gate, 'open')[0]) === '[157,25]' && JSON.stringify(seaGateGoals(grid, gate, 'narrow')[0]) === '[159,25]', 'gate goals by class');
ok(gateServes({ ...gate, low: true }, 0.11) && !gateServes({ ...gate, low: true }, 0.12) && gateServes(gate, 0.5), 'a low gate lets only low boats through');
console.log(`  four styles, channels, step rules; clearances ${BRIDGE_CLEARANCE.join(', ')}; signatures ${SIGS.map((s) => `${s.what} ${s.want}`).join(', ')}`);

// ---- lanes ------------------------------------------------------------------------------------------------------
console.log('=== lanes');
const tileKey = (x: number, y: number) => `${x},${y}`;
/** every structural rule a lane must keep, against the server's tiles */
function checkLane(name: string, route: WaterRoute, cls: WidthClass, sig: number) {
  const minC = WIDTH_CLEARANCE[cls], tl = waterTiles(route);
  ok(route.room.length === tl.length, `${name}: ${route.room.length} room digits for ${tl.length} tiles`);
  const decks = new Map(route.bridges.map((b) => [b.k, b]));
  tl.forEach((t, k) => {
    const a = env.aux(t.x, t.y);
    ok(navigable(env, t.x, t.y) && grid.clearance(t.x, t.y) >= minC, `${name}: tile ${k} (${t.x}, ${t.y}) clearance ${grid.clearance(t.x, t.y)} < ${minC}`);
    ok(t.o !== t.i, `${name}: tile ${k} turns back`);
    ok((route.room.charCodeAt(k) - 48) === grid.room(t.x, t.y), `${name}: tile ${k} room digit`);
    const n = k + 1 < tl.length ? tl[k + 1] : route.loop ? tl[0] : null;
    if (n) ok(n.x === t.x + SIDES[t.o][0] && n.y === t.y + SIDES[t.o][1] && n.i === ((t.o + 2) & 3), `${name}: tile ${k} does not lead into tile ${k + 1}`);
    if (isBridgeAux(a)) {
      const b = decks.get(k);
      ok(!!b && b.style === bridgeStyle(a), `${name}: deck tile ${k} not listed`);
      ok(grid.channel(t.x, t.y), `${name}: deck (${t.x}, ${t.y}) crossed off its channel`);
      ok(t.o === ((t.i + 2) & 3) && (bridgeNS(a) ? t.o === 1 || t.o === 3 : t.o === 0 || t.o === 2), `${name}: deck (${t.x}, ${t.y}) not crossed straight across`);
      ok(!!passUnder(sig, bridgeStyle(a)), `${name}: passes under the ${BRIDGE_STYLE_NAMES[bridgeStyle(a)]} at (${t.x}, ${t.y}) it cannot clear`);
    } else ok(!decks.has(k), `${name}: tile ${k} listed as a deck`);
  });
  // the sailing line
  const g = waterGeometry(route, minC);
  const own = new Set(tl.map((t) => tileKey(t.x, t.y)));
  const deckAt = new Map<string, typeof g.decks>();
  for (const d of g.decks) { const k = tileKey(tl[d.k].x, tl[d.k].y); deckAt.set(k, [...(deckAt.get(k) ?? []), d]); }
  const P = { x: 0, z: 0, h: 0, c: 0 };
  const step = 0.05;
  let px = NaN, pz = NaN, ph = NaN, sharp = 0, off = 0;
  for (let S = 0; S <= g.L + 1e-9; S += step) {
    waterPoint(g, S, P);
    const fx = Math.floor(P.x), fz = Math.floor(P.z), k = tileKey(fx, fz);
    const ds = deckAt.get(k);
    if (ds) {
      const d = ds.find((q) => S >= q.s0 - step && S <= q.s1 + step) ?? ds[0];
      ok(Math.abs(Math.sin(P.h - (bridgeNS(env.aux(fx, fz)) ? 0 : Math.PI / 2))) < 1e-6, `${name}: at S ${S.toFixed(2)} on the deck (${fx}, ${fz}) heading ${P.h.toFixed(3)}, not straight across`);
      ok(S >= d.s0 - step && S <= d.s1 + step, `${name}: on the deck (${fx}, ${fz}) at S ${S.toFixed(2)} outside ${d.s0.toFixed(2)}-${d.s1.toFixed(2)}`);
    } else if (!own.has(k) && !(navigable(env, fx, fz) && !isBridgeAux(env.aux(fx, fz)) && grid.clearance(fx, fz) >= minC)) {
      if (off++ < 3) fail(`${name}: the line at S ${S.toFixed(2)} (${P.x.toFixed(2)}, ${P.z.toFixed(2)}) is off clear water`);
    }
    if (!Number.isNaN(px)) {
      ok(Math.hypot(P.x - px, P.z - pz) <= step + 1e-6, `${name}: the line jumps at S ${S.toFixed(2)}`);
      let dh = Math.abs(P.h - ph); if (dh > Math.PI) dh = 2 * Math.PI - dh;
      if (dh > 0.6) { sharp++; if (!(route.loop && (S < 1 || S > g.L - 1))) fail(`${name}: a sharp turn at S ${S.toFixed(2)} (${P.x.toFixed(2)}, ${P.z.toFixed(2)}), not at the loop's seam`); }
    }
    px = P.x; pz = P.z; ph = P.h;
  }
  checks++; if (off) failures++;
  const end = waterPoint(g, g.L, { x: 0, z: 0, h: 0, c: 0 }), last = route.loop ? tl[0] : tl[tl.length - 1];
  ok(Math.hypot(end.x - last.x - 0.5, end.z - last.y - 0.5) < 1e-6, `${name}: the line does not end at the last tile's centre`);
  ok(g.L <= tl.length + 1e-6, `${name}: line ${g.L.toFixed(2)} longer than its ${tl.length} tiles`);
  for (let k = 1; k < tl.length; k++) ok(g.tileS[k] >= g.tileS[k - 1], `${name}: tileS not monotone at ${k}`);
  for (const d of g.decks) {
    const at = waterPoint(g, (d.s0 + d.s1) / 2, { x: 0, z: 0, h: 0, c: 0 }), t = tl[d.k];
    ok(Math.hypot(at.x - t.x - 0.5, at.z - t.y - 0.5) < 1e-6, `${name}: deck ${d.k}'s middle arclength is not its centre`);
  }
  return { tiles: tl.length, L: g.L, pieces: g.pieces.length, sharp, decks: g.decks.length };
}
type Case = { name: string; from: [number, number]; to: SeaGate; cls: WidthClass; air: number; want: RegExp | null; lifts?: number };
const CASES: Case[] = [
  { name: 'narrowboat up the river to the sea', from: [2, 21], to: gate, cls: 'narrow', air: 0.07, want: null },
  { name: 'trawler from between the girder and suspension', from: [30, 21], to: gate, cls: 'river', air: 0.17, want: null },
  { name: 'trawler from the west end', from: [2, 21], to: gate, cls: 'river', air: 0.17, want: /stone arch bridge at \(10, 2[12]\) is too low/ },
  { name: 'sailboat through the bascule lift', from: [47, 22], to: gate, cls: 'river', air: 0.38, want: null, lifts: 1 },
  { name: 'sailboat under the suspension bridge', from: [30, 21], to: gate, cls: 'river', air: 0.38, want: /suspension bridge at \(40, 2[12]\) is too low/ },
  { name: 'sailboat that may not lift the bascule', from: [47, 22], to: gate, cls: 'river', air: 0.38, want: /bascule bridge at \(55, 2[12]\) is too low/ },
  { name: 'container ship across the basin', from: [105, 5], to: gate, cls: 'open', air: 0.48, want: null },
  { name: 'container ship from the river', from: [90, 21], to: gate, cls: 'river', air: 0.48, want: null },
  { name: 'container ship (open class) from the river', from: [90, 21], to: gate, cls: 'open', air: 0.48, want: /too narrow at/ },
  { name: 'narrowboat from the pond, under the canal bridge', from: [70, 42], to: gate, cls: 'narrow', air: 0.07, want: null },
  { name: 'trawler from the pond', from: [70, 42], to: gate, cls: 'river', air: 0.17, want: /too narrow at \(70, (4[01]|3\d)\)/ },
  { name: 'dinghy from the lake', from: [15, 65], to: gate, cls: 'narrow', air: 0.2, want: /not connected by water/ },
];
const lanes = new Map<string, WaterRoute>();
for (const c of CASES) {
  const sig = passSig(c.air, !/may not lift/.test(c.name));
  const t0 = performance.now();
  const r = waterLane(grid, c.from, seaGateGoals(grid, c.to, c.cls), { cls: c.cls, sig });
  const ms = performance.now() - t0;
  if (!r.ok) {
    ok(!!c.want && c.want.test(r.reason), `${c.name}: refused (${r.reason})${c.want ? `, want ${c.want}` : ''}`);
    console.log(`  ${c.name}: refused, ${r.why}: ${r.reason} (${r.nodes} nodes, ${ms.toFixed(1)} ms)`);
    continue;
  }
  ok(!c.want, `${c.name}: found a lane, want a refusal matching ${c.want}`);
  const fg = new WaterGrid(env);
  const again = waterLane(fg, c.from, seaGateGoals(fg, c.to, c.cls), { cls: c.cls, sig });
  ok(again.ok && JSON.stringify(again.route) === JSON.stringify(r.route), `${c.name}: re-derived from a fresh grid it differs`);
  const client = waterLane(cgrid, c.from, seaGateGoals(cgrid, c.to, c.cls), { cls: c.cls, sig });
  ok(client.ok && JSON.stringify(client.route) === JSON.stringify(r.route), `${c.name}: derived from the client's tiles it differs`);
  const lifts = r.route.bridges.filter((b) => passUnder(sig, b.style) === 'lift').length;
  ok(lifts === (c.lifts ?? 0), `${c.name}: ${lifts} bascule lifts, want ${c.lifts ?? 0}`);
  const s = checkLane(c.name, r.route, c.cls, sig);
  lanes.set(c.name, r.route);
  console.log(`  ${c.name}: ${s.tiles} tiles, line ${s.L.toFixed(1)} in ${s.pieces} pieces, under ${s.decks} decks${lifts ? ` (${lifts} lift)` : ''}, ${s.sharp} sharp turns; cost ${r.cost.toFixed(1)}, ${r.nodes} nodes, ${ms.toFixed(1)} ms; same from a fresh grid and the client`);
}
{ // the line is the same from the wire's copy of the route
  const r = lanes.get('narrowboat up the river to the sea')!;
  const a = waterGeometry(r, 1), b = waterGeometry(JSON.parse(JSON.stringify(r)) as WaterRoute, 1);
  ok(JSON.stringify(a.pieces) === JSON.stringify(b.pieces) && a.L === b.L, 'the sailing line differs for a copy of the route');
}

// ---- open water, grounds, cruises ---------------------------------------------------------------------------------
console.log('=== open water, fishing grounds, cruises');
{
  const basin = openWater(grid, 130, 25), lake = openWater(grid, 15, 65), river = openWater(grid, 5, 21);
  ok(basin.open && basin.tiles === OPEN_SEA_TILES && !!basin.offing && grid.clearance(...basin.offing) >= 3, `basin: ${JSON.stringify(basin)}`);
  ok(!lake.open && lake.tiles === 300, `lake: ${JSON.stringify(lake)}`);
  ok(river.open, `the river reaches the basin: ${JSON.stringify(river)}`);
  console.log(`  basin open (offing ${basin.offing}), lake ${lake.tiles} tiles closed, river joins the basin: ${river.open ? 'open' : 'closed'}`);
  const gr = fishingGrounds(grid, [15, 65], 'river', passSig(0.17));
  ok(!!gr && grid.clearance(...gr) === 4 && Math.abs(gr[0] - 15) + Math.abs(gr[1] - 65) <= GROUNDS_RANGE, `lake grounds ${gr}`);
  const gl = gr ? waterLane(grid, [15, 65], gr, { cls: 'river', sig: passSig(0.17) }) : null;
  ok(!!gl && gl.ok, 'a lane to the lake grounds');
  if (gl?.ok) checkLane('lake grounds', gl.route, 'river', passSig(0.17));
  console.log(`  lake grounds at ${gr}, clearance ${gr ? grid.clearance(...gr) : '-'}`);
  for (const [name, from, seed, cls, air] of [['basin marina', [104, 30], 7, 'narrow', 0.09], ['lake jetty', [11, 61], 3, 'narrow', 0.2], ['river marina', [47, 22], 11, 'river', 0.38], ['canal pond', [70, 42], 5, 'narrow', 0.07]] as [string, [number, number], number, WidthClass, number][]) {
    const sig = passSig(air);
    const wps = cruiseWaypoints(grid, from, seed, cls, sig);
    ok(wps.length >= 1 && wps.length <= 3, `${name}: ${wps.length} waypoints`);
    wps.forEach((p, i) => {
      ok(Math.abs(p[0] - from[0]) + Math.abs(p[1] - from[1]) >= CRUISE_SPACING && wps.every((q, j) => j === i || Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) >= CRUISE_SPACING), `${name}: waypoint ${p} too close`);
      ok(Math.abs(p[0] - from[0]) + Math.abs(p[1] - from[1]) <= CRUISE_RANGE * 2, `${name}: waypoint ${p} too far`);
    });
    ok(JSON.stringify(wps) === JSON.stringify(cruiseWaypoints(new WaterGrid(env), from, seed, cls, sig)), `${name}: waypoints not deterministic`);
    const r = cruiseLane(grid, from, wps, { cls, sig });
    if (!r.ok) { ok(false, `${name}: cruise refused: ${r.reason}`); continue; }
    ok(r.route.loop && r.route.x === from[0] && r.route.y === from[1], `${name}: the cruise does not start and end at ${from}`);
    const tl = waterTiles(r.route);
    for (const p of wps) ok(tl.some((t) => t.x === p[0] && t.y === p[1]), `${name}: the cruise misses waypoint ${p}`);
    const s = checkLane(name, r.route, cls, sig);
    console.log(`  ${name}: ${wps.length} waypoints ${wps.map((p) => `(${p})`).join(' ')}, a loop of ${s.tiles} tiles, line ${s.L.toFixed(1)}, ${s.sharp} sharp turns`);
  }
}

// ---- lanes after a bridge is built and taken away ---------------------------------------------------------------
console.log('=== re-derived on change');
{
  const name = 'trawler from between the girder and suspension', c = CASES.find((q) => q.name === name)!;
  const before = lanes.get(name)!;
  bridge(85, 20, 4, BridgeStyle.Girder);
  for (let y = 19; y <= 24; y++) grid.invalidate(85, y);
  const cut = waterLane(grid, c.from, seaGateGoals(grid, c.to, c.cls), { cls: c.cls, sig: passSig(c.air) });
  ok(!cut.ok && /girder bridge at \(85, 2[12]\) is too low/.test(cut.reason), `a new girder at x 85: ${cut.ok ? 'still a lane' : cut.reason}`);
  const fg = new WaterGrid(env);
  const fresh = waterLane(fg, c.from, seaGateGoals(fg, c.to, c.cls), { cls: c.cls, sig: passSig(c.air) });
  ok(!fresh.ok && !cut.ok && fresh.reason === cut.reason, 'the invalidated grid agrees with a fresh one');
  console.log(`  girder built at x 85: ${cut.ok ? 'lane kept' : cut.reason}`);
  w.removeBridge(85, 21);
  for (let y = 19; y <= 24; y++) grid.invalidate(85, y);
  const back = waterLane(grid, c.from, seaGateGoals(grid, c.to, c.cls), { cls: c.cls, sig: passSig(c.air) });
  ok(back.ok && JSON.stringify(back.route) === JSON.stringify(before), 'the lane after the bridge is taken away differs from before');
  console.log(`  taken away: ${back.ok ? 'the same lane as before' : back.reason}`);
}
{ // a refusal to search further than the budget allows
  const r = waterLane(grid, [2, 21], seaGateGoals(grid, gate, 'narrow'), { cls: 'narrow', sig: PASS_ALL, maxNodes: 50 });
  ok(!r.ok && r.why === 'far', `a 50-node budget: ${r.ok ? 'found' : r.reason}`);
}
{ // cost: a whole set of lanes, cold
  const t0 = performance.now();
  const g2 = new WaterGrid(env);
  let n = 0;
  for (const c of CASES) { waterLane(g2, c.from, seaGateGoals(g2, c.to, c.cls), { cls: c.cls, sig: passSig(c.air) }); n++; }
  console.log(`=== cost: ${n} lane derivations on a cold grid in ${(performance.now() - t0).toFixed(1)} ms`);
}


// ==== B3: boat types and the schedule ==============================================================================
// Harbour kinds and their footprints are B2's; here each harbour is its berths (world space) and the lanes its kind
// wants, derived from the fairway with deriveHarbourLanes on the server's tiles and on the client's.
console.log('=== B3: harbours and their lanes');
const DAYS = Math.max(1, Number(process.argv[2]) || 7);
const upriver: SeaGate = { x: 0, y: 21, name: 'the upper river', low: true };
const GATES = [gate, upriver];
type HarbourDef = { id: number; kind: number; name: string; fairway: [number, number]; berths: Berth[] };
/** a row of berths from (x, z) stepping dx, all lying at heading h */
const row = (n: number, x: number, z: number, dx: number, h: number, maxLen: number | number[], alongside: boolean): Berth[] =>
  Array.from({ length: n }, (_, i) => ({ x: x + i * dx, z, h, maxLen: Array.isArray(maxLen) ? maxLen[i % maxLen.length] : maxLen, alongside }));
const HDEFS: HarbourDef[] = [
  // a marina on the river between the suspension bridge (x 40) and the bascule (x 55): its tall boats meet the lifts
  { id: 1001, kind: HARBOUR_KIND.marina, name: 'Swanmere', fairway: [47, 22], berths: row(10, 43.6, 20.3, 0.85, 0, [0.7, 0.55], true) },
  // a cargo port on the basin's south shore: big berth, small berth, tug berth
  { id: 1002, kind: HARBOUR_KIND.port, name: 'Eastport', fairway: [114, 45], berths: [
    { x: 112.5, z: 48.6, h: 0, maxLen: 5, alongside: true }, { x: 119.6, z: 48.6, h: 0, maxLen: 3, alongside: true },
    { x: 116.2, z: 48.7, h: 0, maxLen: 0.5, alongside: true, tug: true }] },
  // a fishing harbour on the basin's north shore (its grounds are beyond the gate) and one on the lake (grounds in it)
  { id: 1003, kind: HARBOUR_KIND.fishing, name: 'Fishbourne', fairway: [131, 3], berths: row(3, 129.8, 0.35, 0.9, 0, 0.7, true) },
  { id: 1004, kind: HARBOUR_KIND.fishing, name: 'Lakeby', fairway: [13, 62], berths: row(2, 12.4, 60.35, 1.2, 0, 0.7, true) },
  // a jetty on the lake: two bow-in slots
  { id: 1005, kind: HARBOUR_KIND.jetty, name: 'Lake Jetty', fairway: [25, 72], berths: row(2, 25.2, 74.55, 0.5, Math.PI / 2, 0.45, false) },
];
function harboursFrom(g: WaterGrid): { hs: BoatHarbour[]; refused: string[] } {
  const refused: string[] = [];
  const hs = HDEFS.map((d): BoatHarbour => {
    const r = deriveHarbourLanes(g, { kind: d.kind, fairway: d.fairway, seed: d.id, gates: GATES });
    refused.push(...r.refused.map((q) => `${d.name}: ${q.reason}`));
    return { id: d.id, kind: d.kind, x: d.fairway[0], y: d.fairway[1], name: d.name, active: true, berths: d.berths, lanes: r.lanes };
  });
  return { hs, refused };
}
const t0Lanes = performance.now();
const { hs: harbours, refused } = harboursFrom(new WaterGrid(env));
const laneMs = performance.now() - t0Lanes;
const clientHs = harboursFrom(cgrid).hs;
ok(JSON.stringify(clientHs) === JSON.stringify(harbours), 'the harbours derived from the client tiles differ from the server');
const wireHs = JSON.parse(JSON.stringify(harbours)) as BoatHarbour[];
for (const h of harbours) {
  const d = HDEFS.find((q) => q.id === h.id)!;
  const want = harbourLaneSpecs(h.kind);
  for (const l of h.lanes) checkLane(`${d.name} ${l.purpose} lane (${l.cls}, sig ${l.sig})`, l.route, l.cls, l.sig);
  console.log(`  ${d.name} (kind ${h.kind}): ${h.lanes.length}/${want.length} lanes ${h.lanes.map((l) => `${l.purpose}/${l.cls}/${l.sig}${l.gate ? ` to ${l.gate}` : ''} ${l.route.sides.length} tiles`).join(', ')}`);
}
for (const r of refused) console.log(`  refused: ${r}`);
ok(refused.length === 0, `lanes refused: ${refused.join('; ')}`);
ok(harbours.every((h) => h.lanes.length === harbourLaneSpecs(h.kind).length), 'every lane a kind wants is derived');
ok(harbours[1].lanes.some((l) => l.purpose === 'river' && l.gate === 'the upper river') && harbours[2].lanes.some((l) => l.purpose === 'grounds' && l.gate === 'the estuary')
  && harbours[3].lanes.some((l) => l.purpose === 'grounds' && !l.gate), 'barges from the upper river, Fishbourne fishes beyond the estuary, Lakeby on the lake');
ok(harbours[0].lanes.some((l) => l.sig === 16 && l.route.bridges.some((b) => b.style === BridgeStyle.Bascule)), "the marina's tall boats cruise through the bascule");
console.log(`  derived in ${laneMs.toFixed(1)} ms; the same from the client's tiles`);

console.log('=== B3: fleets');
{
  // B2's berths, placed and turned, as the schedule takes them; a fleet fits them
  for (const role of ['jetty', 'marina', 'fishing', 'pier', 'port'] as const) for (const r of [0, 1, 2, 3]) {
    const p = placedFromDoor(HARBOUR_KIND[role], 500, 500, r), pb = placedBerths(p), bs = harbourBerths(p);
    ok(bs.length === pb.length && bs.length > 0 && bs.every((b, i) => b.x === pb[i].x && b.z === pb[i].y && b.h === pb[i].angle && b.maxLen === pb[i].len && b.alongside === (pb[i].mode === 'alongside')), `${role} r${r}: harbourBerths`);
    if (r) continue;
    const h: BoatHarbour = { ...harbours.find((q) => HDEFS.find((d) => d.id === q.id)!.kind === HARBOUR_KIND[role]) ?? { id: 1, kind: HARBOUR_KIND[role], x: 0, y: 0, active: true, lanes: [], berths: [] }, berths: bs };
    const f = harbourFleet(h);
    ok(f.every((b) => bs[b.berth].maxLen >= BOAT_TYPES[b.type].len), `${role}: a boat too long for B2's berth`);
    console.log(`  ${role} on B2's ${bs.length} berths (${[...new Set(bs.map((b) => `${b.maxLen}${b.alongside ? ' alongside' : ' bow-in'}`))].join(', ')}): ${f.map((b) => BOAT_TYPES[b.type].name).join(', ') || 'none based'}`);
  }
}
{
  for (const h of harbours) {
    const f = harbourFleet(h), name = HDEFS.find((q) => q.id === h.id)!.name;
    ok(new Set(f.map((b) => b.berth)).size === f.length && f.every((b) => h.berths[b.berth].maxLen >= BOAT_TYPES[b.type].len && boatLane(h, b.type) >= 0), `${name}: a fleet boat without its own berth or lane`);
    ok(JSON.stringify(f) === JSON.stringify(harbourFleet(wireHs.find((q) => q.id === h.id)!)), `${name}: the fleet differs on the wire's copy`);
    console.log(`  ${name}: ${f.map((b) => `${BOAT_TYPES[b.type].name} "${boatName(b.type, b.seed)}"`).join(', ') || 'none'}`);
  }
  const marina = harbourFleet(harbours[0]);
  ok(marina.length >= 6 && marina.length <= 10, `marina: ${marina.length} boats`);
  ok(harbourFleet(harbours[2]).length === 3 && harbourFleet(harbours[2]).every((b) => b.type === 'trawler'), 'three trawlers at Fishbourne');
  ok(harbourFleet(harbours[1]).length === 1 && harbourFleet(harbours[1])[0].type === 'tug', 'the port bases its tug');
}

console.log('=== B3: the schedule');
/** what a voyage is, for comparing derivations: timings and the line it sails, not the cached geometry objects */
const digest = (v: Voyage) => JSON.stringify([v.id, v.kind, v.boat, v.type, v.seed.toFixed(6), v.harbour, v.berth, v.lane, v.tStart.toFixed(3), v.tEnd.toFixed(3),
  v.segs.map((s) => `${s.k}:${s.phase}:${s.t0.toFixed(3)}:${s.dur.toFixed(3)}${s.k === 'lane' ? `:${s.sA.toFixed(3)}:${s.dir}:${s.prof.D.toFixed(3)}` : ''}`).join('|'),
  v.lifts.map((l) => `${l.seed}:${l.t0.toFixed(3)}:${l.t1.toFixed(3)}`).join('|'), v.escorts ?? '']);
const stateDigest = (b: BoatState) => `${b.id}:${b.phase}:${b.x.toFixed(4)},${b.z.toFixed(4)},${b.h.toFixed(4)}:${b.speed.toFixed(4)}:${b.fade.toFixed(3)}:${b.berth}:${b.lane}`;
const DAY0 = 2; // a Wednesday: the sample runs on through the weekend
const byType = new Map<BoatType, number>(), byKind = new Map<string, number>();
let liftsBooked = 0, liftBarges = 0, liftsOffered = 0, catches = 0, calls = 0, escorts = 0, waits = 0, cancelledSunday = true;
const tGen = performance.now();
for (let d = DAY0; d < DAY0 + DAYS; d++) {
  const tt = boatTimetable(harbours, d);
  clearBoatTimetables();
  const cold = boatTimetable(harbours, d), wire = boatTimetable(wireHs, d);
  clearBoatTimetables();
  const client = boatTimetable(clientHs, d);
  const a = tt.voyages.map(digest).join('\n');
  ok(a === cold.voyages.map(digest).join('\n'), `day ${d}: a second derivation differs`);
  ok(a === wire.voyages.map(digest).join('\n'), `day ${d}: the wire's copy of the harbours gives another timetable`);
  ok(a === client.voyages.map(digest).join('\n'), `day ${d}: the client's harbours give another timetable`);
  const d0 = d * TICKS_PER_DAY;
  for (const v of tt.voyages) {
    byType.set(v.type, (byType.get(v.type) ?? 0) + 1); byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1);
    ok(v.tStart >= d0 + BOAT_DAY_FROM * TICKS_PER_HOUR - 1e-6 && v.tEnd <= d0 + BOAT_DAY_TO * TICKS_PER_HOUR + 1e-6, `voyage ${v.id} (${v.type}) runs ${v.tStart.toFixed(0)}-${v.tEnd.toFixed(0)}, outside 04:00-04:00`);
    for (let i = 1; i < v.segs.length; i++) ok(Math.abs(v.segs[i].t0 - v.segs[i - 1].t0 - v.segs[i - 1].dur) < 1e-6, `voyage ${v.id}: segments not end to end at ${i}`);
    ok(needsTall(v.type) || v.lifts.length === 0, `voyage ${v.id} (${v.type}) booked a lift it does not need`);
    for (const l of v.lifts) {
      liftsBooked++;
      let worst = 1;
      for (let t = l.t0; t <= l.t1; t += 0.25) worst = Math.min(worst, basculeOpen(l.seed, t / TICKS_PER_HOUR));
      ok(worst >= 0.999, `voyage ${v.id} (${v.type}): its passage ${l.t0.toFixed(1)}-${l.t1.toFixed(1)} is not inside a lift (leaves at ${worst.toFixed(3)})`);
      const lift = basculeLifts(l.seed, d).find((s) => l.t0 >= (s + BASCULE_RAISE) * TICKS_PER_HOUR && l.t1 <= (s + BASCULE_RAISE + BASCULE_HOLD) * TICKS_PER_HOUR);
      ok(lift !== undefined, `voyage ${v.id}: passage outside every scheduled lift's hold`);
    }
    if (v.kind === 'lift') liftBarges++;
    if (v.kind === 'fishing') { catches += catchOf(v); ok(catchOf(v) >= 20 && catchOf(v) <= 60, `catch ${catchOf(v)}`); ok(d % 7 !== 6, 'a trawler out on a Sunday'); }
    if (v.kind === 'call') { calls++; const c = callCargo(v); ok(c.imports > 0, `call ${v.id}: no cargo`); }
    if (v.kind === 'escort') { escorts++; ok(tt.voyages.some((s) => s.id === v.escorts && s.type === 'containerShip'), `tug voyage ${v.id} escorts nothing`); }
    if (v.segs.some((s) => s.phase === 'waiting')) waits++;
    const ev = voyageEvents(v);
    ok(ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t), `voyage ${v.id}: events out of order`);
    if (v.kind === 'fishing') ok(ev.some((e) => e.what === 'fishing') && ev.some((e) => e.what === 'berthed'), `voyage ${v.id}: a fishing trip without fishing or a landing`);
  }
  // two boats never share a lift's open window at once on one span
  for (const [seed, list] of boatLifts(harbours, d)) {
    list.sort((p, q) => p.t0 - q.t0);
    for (let i = 1; i < list.length; i++) ok(list[i].t0 >= list[i - 1].t1, `span ${seed}: two boats in the lift at once (${list[i - 1].voyage.id}, ${list[i].voyage.id})`);
    liftsOffered += basculeLifts(seed, d).length;
  }
  if (d % 7 === 6) cancelledSunday = tt.voyages.every((v) => v.kind !== 'fishing');
  ok(boatEvents(harbours, d).length === tt.voyages.reduce((n, v) => n + voyageEvents(v).length, 0), `day ${d}: boatEvents`);
}
function needsTall(t: BoatType) { return BOAT_TYPES[t].air >= bridgeClearance(BridgeStyle.Bascule); }
ok(cancelledSunday, 'trawlers stay in on Sundays');
console.log(`  ${DAYS} days from day ${DAY0}: ${[...byKind].map(([k, n]) => `${n} ${k}`).join(', ')} in ${(performance.now() - tGen).toFixed(0)} ms (each day four times)`);
console.log(`  by type: ${[...byType].map(([k, n]) => `${BOAT_TYPES[k].name} ${n}`).join(', ')}`);
console.log(`  bascule: ${liftsBooked} passages booked in ${liftsOffered} lifts (${liftBarges} by lift barges), ${waits} voyages waited at the bridge; ${escorts} tug escorts; ${calls} port calls; ${catches} boxes of fish`);
ok((byKind.get('cruise') ?? 0) > 0 && (byKind.get('fishing') ?? 0) > 0 && (byKind.get('call') ?? 0) > 0 && escorts > 0, 'cruises, fishing trips, calls and escorts all happen');
ok(liftsBooked > liftBarges, 'a tall boat of the marina is booked through a lift');

console.log('=== B3: sampled every half tick');
{
  const prev = new Map<number, BoatState>();
  let samples = 0, worstJump = 0, worstTurn = 0, underDeck = 0, maxBoats = 0, moving = 0;
  const berthShare: string[] = [], tallUnder: string[] = [], jumps: string[] = [];
  const out: BoatState[] = [];
  const geomCache = new Map<object, ReturnType<typeof waterGeometry>>();
  for (let tick = DAY0 * TICKS_PER_DAY; tick < (DAY0 + DAYS) * TICKS_PER_DAY; tick += 0.5) {
    boatsAt(harbours, tick, out);
    samples++; maxBoats = Math.max(maxBoats, out.length);
    const held = new Map<string, number>();
    for (const b of out) {
      if (b.phase !== 'moored') moving++;
      if (b.berth >= 0) {
        const k = `${b.harbour}:${b.berth}`;
        held.set(k, (held.get(k) ?? 0) + 1);
        if (held.get(k)! > 1 && berthShare.length < 5) berthShare.push(`${k} at tick ${tick}`);
      }
      // a tall boat over a deck: only a bascule, and only while its leaves are fully up
      if (b.lane >= 0 && b.voyage) {
        const ln = harbours.find((h) => h.id === b.harbour)!.lanes[b.lane];
        let g = geomCache.get(ln.route);
        if (!g) geomCache.set(ln.route, g = waterGeometry(ln.route, WIDTH_CLEARANCE[ln.cls]));
        const spec = BOAT_TYPES[b.type], L = g.L;
        for (const dk of g.decks) for (const k of g.loop ? [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8] : [0]) {
          const s0 = dk.s0 + k * L, s1 = dk.s1 + k * L;
          if (b.s + spec.len / 2 <= s0 || b.s - spec.len / 2 >= s1) continue;
          underDeck++;
          if (spec.air < bridgeClearance(dk.style)) continue;
          const open = dk.style === BridgeStyle.Bascule ? basculeOpen(dk.seed, tick / TICKS_PER_HOUR) : 0;
          if (open < 0.99 && tallUnder.length < 5) tallUnder.push(`${spec.name} ${b.id} under the ${BRIDGE_STYLE_NAMES[dk.style]} at tick ${tick} (open ${open.toFixed(2)})`);
        }
      }
      // steady motion: a step at most the speed (half again on the outside of a turn, where the starboard offset
      // swings wide), and no sudden swing of heading
      const p = prev.get(b.id);
      if (p) {
        const j = Math.hypot(b.x - p.x, b.z - p.z);
        worstJump = Math.max(worstJump, j);
        if (j > 0.5 * Math.max(p.speed, b.speed) * 1.6 + 0.02 && jumps.length < 5) jumps.push(`${BOAT_TYPES[b.type].name} ${b.id} ${p.phase}->${b.phase} jumps ${j.toFixed(2)} at tick ${tick}`);
        let dh = Math.abs(b.h - p.h); if (dh > Math.PI) dh = 2 * Math.PI - dh;
        worstTurn = Math.max(worstTurn, dh);
        if (dh > 0.5 && jumps.length < 5) jumps.push(`${BOAT_TYPES[b.type].name} ${b.id} ${p.phase}->${b.phase} swings ${dh.toFixed(2)} rad at tick ${tick}`);
      }
    }
    prev.clear();
    for (const b of out) prev.set(b.id, { ...b });
  }
  {
    const t0 = performance.now(), n = 4000;
    for (let i = 0; i < n; i++) boatsAt(harbours, DAY0 * TICKS_PER_DAY + 1000 + i * 0.37, out);
    console.log(`  boatsAt: ${((performance.now() - t0) * 1000 / n).toFixed(0)} µs a call`);
  }
  ok(berthShare.length === 0, `two boats in one berth: ${berthShare.join('; ')}`);
  ok(tallUnder.length === 0, `a tall boat under a closed or low bridge: ${tallUnder.join('; ')}`);
  ok(jumps.length === 0, `boats jump: ${jumps.join('; ')}`);
  console.log(`  ${samples} samples, up to ${maxBoats} boats; ${underDeck} boat-samples under a deck, none too tall for it; no berth shared; largest step ${worstJump.toFixed(3)} tiles, largest swing ${worstTurn.toFixed(3)} rad`);
  // cold equals stepped: a fresh derivation at scattered ticks gives the states the stepping saw
  let same = 0;
  for (let i = 0; i < 40; i++) {
    const tick = DAY0 * TICKS_PER_DAY + Math.floor(hash2(i, 77) * DAYS * TICKS_PER_DAY * 2) / 2;
    const stepped = boatsAt(harbours, tick).map(stateDigest).sort().join('|');
    clearBoatTimetables();
    const cold = boatsAt(JSON.parse(JSON.stringify(harbours)) as BoatHarbour[], tick).map(stateDigest).sort().join('|');
    ok(stepped === cold, `boatsAt at tick ${tick}: cold differs from stepped`);
    if (stepped === cold) same++;
  }
  console.log(`  boatsAt cold equals stepped at ${same}/40 ticks; ${moving} boat-samples away from their berths`);
  ok(Math.abs(starboardOffset(2) - 0.3) < 1e-9 && starboardOffset(1) === 0.15, 'starboard offset');
}

console.log('=== B3: names, owners, crews');
{
  const all = [...harbours.flatMap((h) => harbourFleet(h).map((b) => ({ type: b.type, seed: b.seed }))),
    ...boatTimetable(harbours, DAY0).voyages.filter((v) => v.kind !== 'cruise' && v.kind !== 'fishing').map((v) => ({ type: v.type, seed: v.seed }))];
  for (const b of all) {
    const crew = boatCrew(b.type, b.seed, 3);
    ok(boatName(b.type, b.seed) === boatName(b.type, b.seed) && boatName(b.type, b.seed).length > 2 && crew.length >= 1 && JSON.stringify(crew) === JSON.stringify(boatCrew(b.type, b.seed, 3)), `${b.type}: name or crew`);
  }
  ok(/^[A-Z]{2} \d+$/.test(fishingReg('Fishbourne', 1003, 0.42)) && fishingReg('Fishbourne', 1003, 0.42).startsWith('FS'), `registration ${fishingReg('Fishbourne', 1003, 0.42)}`);
  const seen = new Set<BoatType>();
  for (const b of all) {
    if (seen.has(b.type)) continue;
    seen.add(b.type);
    console.log(`  ${BOAT_TYPES[b.type].name} "${boatName(b.type, b.seed)}", ${boatOwner(b.type, b.seed, 'Fishbourne')}: ${boatCrew(b.type, b.seed).map((c) => `${c.name} (${c.role})`).join(', ')}`);
  }
}
console.log(failures ? `\n${failures} FAILURES (${checks} checks)` : `\nALL CHECKS PASSED (${checks} checks)`);
process.exit(failures ? 1 : 0);
