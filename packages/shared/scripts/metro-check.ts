/**
 * Underground railways, part one (shared/src/metro.ts, docs/underground.md §8): the pure logic on a fake world (a
 * MetroEnv over plain maps, no server World), checking that
 *  - the under byte round-trips: tunnels, platforms, masks, and nothing else reads as either;
 *  - platforms are planned under the door, refused where they overlap, touch end to end or cross a tunnel, curve,
 *    junction or crossover, and found again from the tiles alone (door, footprint or any platform tile), and a
 *    platform with no station above it reverts to tunnel;
 *  - lines are bored deterministically, the same under any surface (roads, buildings, track; only water costs
 *    more), with crossovers straight across another line, overruns past a there-and-back line's ends, and the
 *    route rail's search derives from the written layer is the bored one or shorter and uses no other line's sides;
 *  - the refusals hold: one station, a station twice, not a station, a platform another line calls at, a wall of
 *    another line's junctions, a wall of platforms;
 *  - twin-bore timetables: a there-and-back line runs many trains, and over whole days sampled every half tick trains
 *    stay a train length plus TRAIN_GAP apart on the unfolded loop (a train standing at a terminus in both bores),
 *    no two trains of a bore ever share a tile, every bogie is on the line's tiles, nobody runs before 05:00, every
 *    train dwells at every station, every call is a dwell and nextRide gets there; one-way loops too.
 *   npx tsx packages/shared/scripts/metro-check.ts [days]
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, packTile, Terrain, familyOf, subFor, withLevel, placedFromDoor, eachTile, hash2,
  RAIL_SIDES, oppSide, routeNet, routeTiles, railGeometry, railService, railPoint, trainsAt, trainPoses, callsBetween, nextRide, unfoldedS,
  TRAIN_GAP, SERVICE_START_HOUR, RailVehicle, trackKey,
  UNDER_TUNNEL, UNDER_PLATFORM, isTunnel, isPlatform, underMask, tunnelByte, platformByte, METRO, METRO_ENTRANCE, METRO_STATION,
  metroStationAt, metroStop, planPlatform, orphanPlatform, underNet, planBore, lineSides, overrunTiles, metroBore,
  type MetroEnv, type RailLineDef, type RailRoute, type TrainState, type VehiclePose, type StationStop,
} from '../src';

const days = Number(process.argv[2] ?? 2);
let failures = 0, checks = 0;
const fail = (msg: string) => { if (failures++ < 40) console.log('FAIL ' + msg); };
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) fail(msg); };
const hhmm = (t: number) => { const m = Math.round(((t % TICKS_PER_DAY) / TICKS_PER_HOUR) * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const key = (x: number, y: number) => `${x},${y}`;

// ---- a fake world: tiles, aux, sub and under bytes in maps -----------------------------------------------
const X0 = -60, X1 = 110, Y0 = -60, Y1 = 70;
const RIVER = (x: number) => x >= 40 && x <= 43;
class Fake implements MetroEnv {
  tiles = new Map<string, number>(); auxs = new Map<string, number>(); subs = new Map<string, number>(); unders = new Map<string, number>();
  /** surface clutter on every tile nothing was placed on: roads, grown buildings, track, structure parts */
  constructor(public clutter = false) {}
  private inside(x: number, y: number) { return x >= X0 && x <= X1 && y >= Y0 && y <= Y1; }
  private junk(x: number, y: number) { return this.clutter && !this.tiles.has(key(x, y)) && !RIVER(x) ? hash2(x * 7 + 3, y * 13 + 5) : -1; }
  tile(x: number, y: number) {
    if (!this.inside(x, y)) return undefined;
    const t = this.tiles.get(key(x, y));
    if (t !== undefined) return t;
    if (RIVER(x)) return packTile(Terrain.Water, false, 0, 0);
    const j = this.junk(x, y);
    if (j < 0 || j < 0.3) return packTile(Terrain.Grass, false, 0, 0);
    if (j < 0.6) return packTile(Terrain.Grass, true, 0, 0);
    return packTile(Terrain.Grass, false, 1 + Math.floor(j * 40) % 4, 1 + Math.floor(j * 97) % 3);
  }
  aux(x: number, y: number) { const a = this.auxs.get(key(x, y)); if (a !== undefined) return a; const j = this.junk(x, y); return j > 0.9 ? 0xe5 : 0; }
  sub(x: number, y: number) { return this.subs.get(key(x, y)) ?? 0; }
  under(x: number, y: number) { return this.inside(x, y) ? this.unders.get(key(x, y)) ?? 0 : 0; }
  setUnder(x: number, y: number, b: number) { if (b) this.unders.set(key(x, y), b); else this.unders.delete(key(x, y)); }
  write(flat: number[]) { for (let i = 0; i < flat.length; i += 3) this.setUnder(flat[i], flat[i + 1], flat[i + 2]); }
  /** a finished kiosk (1×1) or hall (2×1, facing r) with its door at (x, y) */
  station(kind: number, x: number, y: number, r = 0) {
    const code = familyOf(kind), sub = subFor(kind);
    if (kind === METRO_ENTRANCE) { this.tiles.set(key(x, y), packTile(Terrain.Grass, false, code, 1)); this.subs.set(key(x, y), sub); return; }
    const p = placedFromDoor(kind, x, y, r);
    eachTile(p, (tx, ty, a) => { this.auxs.set(key(tx, ty), a); this.subs.set(key(tx, ty), sub); this.tiles.set(key(tx, ty), packTile(Terrain.Grass, false, code, 0)); });
    this.tiles.set(key(p.doorX, p.doorY), withLevel(this.tiles.get(key(p.doorX, p.doorY))!, 1));
  }
  clearStation(x: number, y: number) { this.tiles.delete(key(x, y)); this.subs.delete(key(x, y)); this.auxs.delete(key(x, y)); }
  copy(clutter = this.clutter) {
    const c = new Fake(clutter);
    c.tiles = new Map(this.tiles); c.auxs = new Map(this.auxs); c.subs = new Map(this.subs); c.unders = new Map(this.unders);
    return c;
  }
}

// ---- 1. the byte -------------------------------------------------------------------------------------------
console.log('=== the under byte');
{
  for (let m = 0; m < 16; m++) {
    const b = tunnelByte(m);
    ok(isTunnel(b) && !isPlatform(b) && underMask(b) === m && b === (UNDER_TUNNEL | m), `tunnel byte for mask ${m}: ${b.toString(16)}`);
  }
  for (const alongX of [true, false]) {
    const b = platformByte(alongX);
    ok(isPlatform(b) && isTunnel(b) && underMask(b) === (alongX ? 10 : 5) && (b & 0xf0) === UNDER_PLATFORM, `platform byte along ${alongX ? 'x' : 'y'}: ${b.toString(16)}`);
  }
  let tunnels = 0, platforms = 0;
  for (let b = 0; b < 256; b++) {
    if (isPlatform(b)) { platforms++; ok(isTunnel(b), `byte ${b.toString(16)} is a platform but not a tunnel`); }
    if (isTunnel(b)) tunnels++;
    if (b === 0 || b >= 0x80 || (b & 0x40)) ok(!isTunnel(b) && !isPlatform(b), `byte ${b.toString(16)} (solid, reserved or the second depth) reads as tunnel`);
  }
  ok(tunnels === 32 && platforms === 16, `${tunnels} tunnel bytes and ${platforms} platform bytes (want 32, 16)`);
  console.log(`  ${tunnels} tunnel bytes (16 plain, 16 platform), solid and reserved bytes are neither`);
}

// ---- 2. platforms ----------------------------------------------------------------------------------------
console.log('=== platforms');
const w = new Fake();
type St = { kind: number; x: number; y: number; alongX: boolean; r?: number };
const ST: Record<string, St> = {
  // Central: west to east, across the river
  k1: { kind: METRO_ENTRANCE, x: 0, y: 0, alongX: true },
  h2: { kind: METRO_STATION, x: 25, y: 2, alongX: true },
  k3: { kind: METRO_ENTRANCE, x: 62, y: -3, alongX: true },
  // Northern: north to south, across the Central's tunnel
  k4: { kind: METRO_ENTRANCE, x: 18, y: -34, alongX: false },
  h5: { kind: METRO_STATION, x: 21, y: 36, alongX: false, r: 1 },
  // a loop east of the river
  k6: { kind: METRO_ENTRANCE, x: 70, y: 20, alongX: true },
  k7: { kind: METRO_ENTRANCE, x: 95, y: 32, alongX: false },
  h8: { kind: METRO_STATION, x: 78, y: 50, alongX: true },
  k9: { kind: METRO_ENTRANCE, x: 58, y: 38, alongX: false },
};
const stops = new Map<string, StationStop>();
for (const [name, s] of Object.entries(ST)) {
  w.station(s.kind, s.x, s.y, s.r ?? 0);
  const plan = planPlatform(s.kind, s.x, s.y, s.alongX, w);
  ok(plan.ok, `${name}: platform refused: ${plan.reason}`);
  const len = s.kind === METRO_STATION ? METRO.platform.hall : METRO.platform.kiosk;
  ok(plan.writes.length === 3 * len && plan.stop.len === len, `${name}: ${plan.writes.length / 3} platform tiles (want ${len})`);
  const mid = plan.stop.a0 + Math.floor(len / 2);
  ok(mid === (s.alongX ? s.x : s.y) && plan.stop.row === (s.alongX ? s.y : s.x), `${name}: the platform's middle is not under the door`);
  w.write(plan.writes);
  stops.set(name, plan.stop);
}
{
  // refusals, each on a copy of the world
  const q = w.copy();
  const s1 = stops.get('k1')!;
  q.station(METRO_ENTRANCE, 2, 1); // a kiosk beside k1 whose platform along x would overlap k1's (y = 0 vs 1: no; along y it crosses)
  const cases: { what: string; kind: number; x: number; y: number; alongX: boolean; prep?: (f: Fake) => void; want: RegExp }[] = [
    { what: 'overlapping another platform', kind: METRO_ENTRANCE, x: 1, y: 1, alongX: false, want: /Another platform/ },
    { what: 'end to end with another platform', kind: METRO_ENTRANCE, x: s1.a1 + 3, y: 0, alongX: true, want: /end to end/ },
    { what: 'across a straight tunnel', kind: METRO_ENTRANCE, x: -20, y: 20, alongX: true, prep: (f) => f.setUnder(-20, 20, tunnelByte(5)), want: /across it/ },
    { what: 'over a curve', kind: METRO_ENTRANCE, x: -20, y: 20, alongX: true, prep: (f) => f.setUnder(-21, 20, tunnelByte(6)), want: /curve/ },
    { what: 'over a junction', kind: METRO_STATION, x: -20, y: 20, alongX: false, prep: (f) => f.setUnder(-20, 18, tunnelByte(7)), want: /junction/ },
    { what: 'over a crossover', kind: METRO_ENTRANCE, x: -20, y: 20, alongX: true, prep: (f) => f.setUnder(-19, 20, tunnelByte(15)), want: /across it|crossover/ },
    { what: 'something reserved down there', kind: METRO_ENTRANCE, x: -20, y: 20, alongX: true, prep: (f) => f.setUnder(-20, 20, 0x80), want: /in the way/ },
    { what: 'off the loaded map', kind: METRO_ENTRANCE, x: X1, y: 0, alongX: true, want: /not loaded/ },
    { what: 'not a metro kind', kind: 18, x: -20, y: 20, alongX: true, want: /not a metro station/ },
  ];
  for (const c of cases) {
    const f = q.copy();
    c.prep?.(f);
    const v = planPlatform(c.kind, c.x, c.y, c.alongX, f);
    ok(!v.ok && c.want.test(v.reason ?? ''), `platform ${c.what}: expected a refusal matching ${c.want}, got ${v.ok ? 'ok' : v.reason}`);
    console.log(`  ${c.what}: ${v.ok ? 'PLACED' : v.reason}`);
  }
  const allowed: { what: string; prep: (f: Fake) => void; alongX: boolean }[] = [
    { what: 'along a straight tunnel', alongX: true, prep: (f) => { for (let x = -24; x <= -16; x++) f.setUnder(x, 20, tunnelByte(10)); } },
    { what: 'over a tunnel end along it', alongX: false, prep: (f) => f.setUnder(-20, 19, tunnelByte(4)) },
    { what: 'side by side with another platform', alongX: true, prep: (f) => { for (let x = -22; x <= -19; x++) f.setUnder(x, 21, platformByte(true)); } },
  ];
  for (const c of allowed) {
    const f = q.copy();
    c.prep(f);
    const v = planPlatform(METRO_ENTRANCE, -20, 20, c.alongX, f);
    ok(v.ok && v.writes.every((b, i) => i % 3 !== 2 || b === platformByte(c.alongX)), `platform ${c.what}: ${v.reason ?? 'bad bytes'}`);
    console.log(`  ${c.what}: ${v.ok ? 'placed' : v.reason}`);
  }
}

// ---- 3. stations from tiles alone -----------------------------------------------------------------------------
console.log('=== stations from the tiles');
for (const [name, s] of Object.entries(ST)) {
  const want = JSON.stringify(stops.get(name));
  const probes: [number, number][] = [[s.x, s.y]];
  const st = stops.get(name)!;
  for (let a = st.a0; a <= st.a1; a++) probes.push(st.alongX ? [a, st.row] : [st.row, a]);
  if (s.kind === METRO_STATION) { const p = placedFromDoor(s.kind, s.x, s.y, s.r ?? 0); eachTile(p, (x, y) => probes.push([x, y])); }
  let agree = 0;
  for (const [x, y] of probes) { const got = metroStationAt(x, y, w); ok(JSON.stringify(got) === want, `${name}: from (${x}, ${y}) found ${JSON.stringify(got)}, want ${want}`); if (JSON.stringify(got) === want) agree++; }
  // the client's copy (as the wire would deliver the bytes) agrees
  ok(JSON.stringify(metroStationAt(s.x, s.y, w.copy())) === want, `${name}: a copy of the bytes disagrees`);
  console.log(`  ${name}: ${agree}/${probes.length} probes (door, footprint, every platform tile) find the same stop`);
}
{
  ok(metroStationAt(-30, -30, w) === null && /no metro station/.test((metroStop(-30, -30, w) as { reason: string }).reason), 'empty ground reads as a station');
  ok(metroStationAt(X1 + 5, 0, w) === null && /not loaded/.test((metroStop(X1 + 5, 0, w) as { reason: string }).reason), 'unloaded ground reads as a station');
  // a station whose platform is gone, or broken
  const f = w.copy();
  const k1 = stops.get('k1')!;
  f.setUnder(k1.a0, k1.row, tunnelByte(10));
  const v = metroStop(k1.doorX, k1.doorY, f);
  ok('reason' in v && /broken/.test(v.reason), `a shortened platform: ${'reason' in v ? v.reason : 'found'}`);
  console.log(`  a shortened platform: ${'reason' in v ? v.reason : 'FOUND'}`);
  // orphan platforms revert to tunnel; standing ones do not
  ok(orphanPlatform(k1.a0, k1.row, w).length === 0, 'a platform with its station reverts');
  const g = w.copy();
  g.clearStation(k1.doorX, k1.doorY);
  const back = orphanPlatform(k1.a0 + 1, k1.row, g);
  ok(back.length === 3 * k1.len && back.every((b, i) => i % 3 !== 2 || b === tunnelByte(10)), `the orphan platform reverts to ${back.length / 3} tunnel tiles`);
  g.write(back);
  ok(metroStationAt(k1.a0, k1.row, g) === null && !isPlatform(g.under(k1.doorX, k1.doorY)) && isTunnel(g.under(k1.doorX, k1.doorY)), 'the reverted platform is plain tunnel');
  console.log(`  station bulldozed: its ${back.length / 3}-tile platform reverts to tunnel`);
}

// ---- 4. boring lines -------------------------------------------------------------------------------------------
console.log('=== boring');
const D = (n: string): [number, number] => [ST[n].x, ST[n].y];
const defs: RailLineDef[] = [
  { id: 201, owner: 'a', number: 1, name: 'Central', color: 0xdc241f, stations: [D('k1'), D('h2'), D('k3')], trains: 12, cars: 4, loop: false, metro: true },
  { id: 202, owner: 'a', number: 2, name: 'Northern', color: 0x333333, stations: [D('k4'), D('h5')], trains: 8, cars: 4, loop: false, metro: true },
  { id: 203, owner: 'b', number: 3, name: 'Circle', color: 0xffd329, stations: [D('k6'), D('k7'), D('h8'), D('k9')], trains: 12, cars: 4, loop: true, metro: true },
];
const routes = new Map<number, RailRoute>();
const sides = new Map<number, number>(); // every line bored so far: trackKey -> sides
const inUse = (m: Map<number, number>) => (x: number, y: number) => m.get(trackKey(x, y)) ?? 0;
const cluttered = (f: Fake) => f.copy(true);
for (const def of defs) {
  const others = new Map(sides);
  const a = planBore(def, w, inUse(others)), b = planBore(def, w.copy(), inUse(others)), c = planBore(def, cluttered(w), inUse(others));
  const ja = JSON.stringify({ ...a, tiles: a.ok ? [...a.tiles] : 0 });
  ok(ja === JSON.stringify({ ...b, tiles: b.ok ? [...b.tiles] : 0 }), `${def.name}: planBore is not deterministic`);
  ok(ja === JSON.stringify({ ...c, tiles: c.ok ? [...c.tiles] : 0 }), `${def.name}: the surface changed the bore`);
  if (!a.ok) { fail(`${def.name}: bore refused: ${a.problem.message}`); continue; }
  // the money: new tiles (wet ones dearer) and crossovers
  let wet = 0, dry = 0, underSurface = 0;
  for (let i = 0; i < a.bore.length; i += 2) {
    if (RIVER(a.bore[i])) wet++; else dry++;
    const ct = cluttered(w);
    if (ct.tile(a.bore[i], a.bore[i + 1])! !== packTile(Terrain.Grass, false, 0, 0) || ct.aux(a.bore[i], a.bore[i + 1])) underSurface++;
  }
  const cross = a.crossovers.length / 2;
  ok(a.cost === dry * METRO.tunnelCost + wet * METRO.wetTunnelCost + cross * (METRO.crossoverCost + METRO.tunnelCost), `${def.name}: cost ${a.cost} for ${dry} dry, ${wet} wet tiles and ${cross} crossovers`);
  w.write(a.writes);
  // the line rail's route search derives from the layer, other lines' sides taken
  const r = routeNet(def, underNet(w, inUse(others)));
  if (!r.ok) { fail(`${def.name}: routeNet refused the bored layer: ${r.reason}`); continue; }
  ok(r.route.sides.length <= a.route.sides.length, `${def.name}: derived route ${r.route.sides.length} tiles, longer than the bore's ${a.route.sides.length}`);
  ok(JSON.stringify(routeNet(def, underNet(w.copy(), inUse(others)))) === JSON.stringify(r), `${def.name}: a copy of the bytes derives another route`);
  const tl = routeTiles(r.route);
  for (let k = 0; k < tl.length; k++) {
    const t = tl[k], m = underMask(w.under(t.x, t.y));
    ok(isTunnel(w.under(t.x, t.y)) && !!(m & (1 << t.i)) && !!(m & (1 << t.o)) && t.i !== t.o, `${def.name}: tile ${k} (${t.x}, ${t.y}) is not tunnel joined ${t.i}->${t.o}`);
    const nx = k + 1 < tl.length ? tl[k + 1] : r.route.loop ? tl[0] : null;
    if (nx) ok(nx.x === t.x + RAIL_SIDES[t.o][0] && nx.y === t.y + RAIL_SIDES[t.o][1] && nx.i === oppSide(t.o), `${def.name}: tile ${k} does not lead into tile ${k + 1}`);
    ok(!((others.get(trackKey(t.x, t.y)) ?? 0) & ((1 << t.i) | (1 << t.o))), `${def.name}: runs on another line's tunnel at (${t.x}, ${t.y})`);
  }
  // stops at the platforms' middles
  const g = railGeometry(r.route);
  r.route.stops.forEach((_, i) => {
    const P = railPoint(g, g.stopS[i]), st = metroStationAt(def.stations[i][0], def.stations[i][1], w)!;
    const along = st.alongX ? P.x : P.z, perp = st.alongX ? P.z : P.x;
    ok(Math.abs(along - (st.a0 + st.len / 2)) < 1e-6 && Math.abs(perp - (st.row + 0.5)) < 1e-6, `${def.name}: stop ${i} is not the platform's middle`);
  });
  // crossovers are mask 15 now, and every other line still routes as it did
  for (let i = 0; i < a.crossovers.length; i += 2) ok(underMask(w.under(a.crossovers[i], a.crossovers[i + 1])) === 15, `${def.name}: crossover at (${a.crossovers[i]}, ${a.crossovers[i + 1]}) is not mask 15`);
  for (const [id, old] of routes) {
    const od = defs.find((d) => d.id === id)!, mine = lineSides(r.route, w);
    const re = routeNet(od, underNet(w, inUse(mine)));
    ok(re.ok && JSON.stringify(re.route) === JSON.stringify(old), `${def.name} broke ${od.name}'s route: ${re.ok ? 'moved' : re.reason}`);
  }
  const over = overrunTiles(r.route, w);
  if (!def.loop) ok(over.length === 3 * 2 * METRO.overrun, `${def.name}: ${over.length / 3} overrun tiles (want ${2 * METRO.overrun})`);
  else ok(over.length === 0, `${def.name}: a loop has overruns`);
  routes.set(def.id, r.route);
  lineSides(r.route, w, sides);
  console.log(`  ${def.name} (${def.loop ? 'loop' : 'there and back'}): ${a.bore.length / 2} new tiles (${wet} under water, ${underSurface} under roads, buildings or track), ${cross} crossover${cross === 1 ? '' : 's'}, ${over.length / 3} overrun, $${a.cost}; route ${r.route.sides.length} tiles${JSON.stringify(r.route) === JSON.stringify(a.route) ? ', exactly the bore' : ` (the bore ran ${a.route.sides.length})`}; deterministic, surface-blind`);
}
ok(defs.slice(1, 2).every((d) => { const p = routes.get(d.id); return !!p; }), 'the Northern did not bore');
{ // the Northern crosses the Central
  const n = routes.get(202), cen = routes.get(201);
  if (n && cen) {
    const cs = new Set(routeTiles(cen).map((t) => trackKey(t.x, t.y)));
    const shared = routeTiles(n).filter((t) => cs.has(trackKey(t.x, t.y)));
    ok(shared.length >= 1 && shared.every((t) => underMask(w.under(t.x, t.y)) === 15), `the Northern and the Central share ${shared.length} tiles, not all crossovers`);
    console.log(`  the Northern crosses the Central at ${shared.map((t) => `(${t.x}, ${t.y})`).join(', ')}, a crossover`);
  }
}
{ // re-planning a bored line costs nothing and changes nothing
  const def = defs[0], mine = lineSides(routes.get(def.id)!, w), others = new Map<number, number>();
  for (const [k, v] of sides) if (!mine.has(k)) others.set(k, v);
  const again = planBore(def, w, inUse(others));
  ok(again.ok && again.cost === 0 && again.bore.length === 0 && again.writes.length === 0, `re-planning the Central: ${again.ok ? `$${again.cost}, ${again.writes.length / 3} writes` : again.problem.message}`);
  console.log(`  re-planning the bored Central: ${again.ok ? `$${again.cost}, ${again.writes.length / 3} writes` : again.problem.message}`);
}

console.log('=== refusals');
{
  const refusals: { what: string; stations: [number, number][]; loop?: boolean; env?: Fake; use?: Map<number, number>; want: RegExp; pair?: boolean }[] = [
    { what: 'one station', stations: [D('k1')], want: /at least 2/ },
    { what: 'a station twice', stations: [D('k1'), D('h2'), D('k1')], want: /twice/ },
    { what: 'not a station', stations: [D('k1'), [-40, -40]], want: /no metro station/ },
    { what: 'a platform another line calls at', stations: [D('k1'), D('k9')], use: sides, want: /already calls/ },
  ];
  // a wall of another line's junctions across the whole box between two fresh stations, then one of platforms
  const box = new Fake();
  box.station(METRO_ENTRANCE, -40, -40); box.write(planPlatform(METRO_ENTRANCE, -40, -40, true, box).writes);
  box.station(METRO_ENTRANCE, -20, -40); box.write(planPlatform(METRO_ENTRANCE, -20, -40, true, box).writes);
  const junctions = box.copy(), wallUse = new Map<number, number>(), straight = box.copy();
  for (let y = Y0; y <= Y1; y++) {
    junctions.setUnder(-30, y, tunnelByte(7)); wallUse.set(trackKey(-30, y), 5);
    straight.setUnder(-30, y, tunnelByte(5));
  }
  const platforms = box.copy();
  for (let y = Y0; y <= Y1; y++) for (let x = -32; x <= -27; x++) platforms.setUnder(x, y, platformByte(true));
  refusals.push(
    { what: 'a wall of another line\'s junctions', stations: [[-40, -40], [-20, -40]], env: junctions, use: wallUse, want: /No tunnel can be bored/, pair: true },
    { what: 'a wall of platforms', stations: [[-40, -40], [-20, -40]], env: platforms, want: /No tunnel can be bored/, pair: true },
  );
  for (const r of refusals) {
    const v = planBore({ stations: r.stations, loop: !!r.loop }, r.env ?? w, inUse(r.use ?? new Map()));
    ok(!v.ok && r.want.test(v.problem.message) && (!r.pair || (v.problem.from === 0 && v.problem.to === 1 && v.problem.tiles.length > 0)), `${r.what}: expected a refusal matching ${r.want}, got ${v.ok ? 'a bore' : JSON.stringify(v.problem)}`);
    console.log(`  ${r.what}: ${v.ok ? 'BORED' : `${v.problem.message}${v.problem.fix ? ` (${v.problem.fix})` : ''}`}`);
  }
  // the same wall of straight tunnel another line runs along is crossed at right angles
  const v = planBore({ stations: [[-40, -40], [-20, -40]], loop: false }, straight, inUse(wallUse));
  ok(v.ok && v.crossovers.length === 2, `crossing another line's straight tunnel: ${v.ok ? `${v.crossovers.length / 2} crossovers` : v.problem.message}`);
  console.log(`  another line's straight tunnel in the way: ${v.ok ? `crossed at (${v.crossovers.join(', ')})` : v.problem.message}`);
  // a derived route never runs on another line's tunnel: the Central's stations with the Central taken
  const cen = defs[0], rr = routeNet(cen, underNet(w, inUse(lineSides(routes.get(cen.id)!, w))));
  ok(!rr.ok && /not connected by tunnel/.test(rr.reason), `routing over another line's tunnel: ${rr.ok ? 'ROUTED' : rr.reason}`);
  console.log(`  routing over another line's tunnel: ${rr.ok ? 'ROUTED' : rr.reason}`);
}

// ---- 5. trains -------------------------------------------------------------------------------------------------
console.log(`=== trains over ${days} days, sampled every half tick`);
const out: TrainState[] = [], poses: VehiclePose[] = [];
for (const def of defs) {
  const route = routes.get(def.id);
  if (!route) continue;
  const svc = railService(def, route), g = svc.geom;
  const again = railService({ ...def, stations: def.stations.map((s) => [s[0], s[1]] as [number, number]) }, JSON.parse(JSON.stringify(route)));
  ok(JSON.stringify({ ...svc, geom: undefined }) === JSON.stringify({ ...again, geom: undefined }), `${def.name}: the timetable is not deterministic`);
  ok(svc.metro && svc.consists.slice(0, svc.trains).every((c) => c.length === svc.vehicles && c[0] === RailVehicle.TubeCab && c[c.length - 1] === RailVehicle.TubeCab && c.slice(1, -1).every((k) => k === RailVehicle.TubeCar)), `${def.name}: consists ${svc.consists[0].join(',')}`);
  const shortest = Math.min(...route.stops.map((s) => s.len));
  ok(svc.vehicles === shortest && svc.length <= shortest, `${def.name}: ${svc.vehicles} cars for a shortest platform of ${shortest}`);
  ok(svc.dwell.every((d, i) => (!def.loop && (i === 0 || i === svc.dwell.length - 1) ? d >= METRO.terminusDwell[0] && d <= METRO.terminusDwell[1] : d >= METRO.dwell[0] && d <= METRO.dwell[1])), `${def.name}: dwells ${svc.dwell.join('/')}`);
  ok(svc.trains > 1, `${def.name}: ${svc.trains} train(s): twin bores should run several`);
  const ring = def.loop ? g.L : 2 * g.L, need = svc.length + TRAIN_GAP;
  const own = new Set(routeTiles(route).map((t) => key(t.x, t.y)));
  const ov = overrunTiles(route, w);
  for (let i = 0; i < ov.length; i += 3) own.add(key(ov[i], ov[i + 1]));
  let minGap = Infinity, maxTrains = 0, samples = 0, offTrack = 0, clashes = 0;
  const dwelt = new Map<string, number>();
  const n = def.stations.length;
  for (let t = TICKS_PER_DAY; t < (1 + days) * TICKS_PER_DAY; t += 0.5) {
    trainsAt(svc, t, out);
    maxTrains = Math.max(maxTrains, out.length);
    const hour = (t % TICKS_PER_DAY) / TICKS_PER_HOUR;
    if (out.length && hour >= 4.8 && hour < SERVICE_START_HOUR) fail(`${def.name}: a train out at ${hhmm(t)}`);
    const bores = [new Map<string, number>(), new Map<string, number>()]; // tile -> train, per bore (out, home)
    const points: number[][] = [];
    for (const s of out) {
      samples++;
      const terminus = !def.loop && s.phase === 'dwell' && (s.stop === 0 || s.stop === n - 1);
      if (s.phase === 'dwell') {
        dwelt.set(`${s.train}:${s.stop}`, (dwelt.get(`${s.train}:${s.stop}`) ?? 0) + 1);
        ok(s.v === 0 && Math.abs(s.s - g.stopS[s.stop]) < 1e-9, `${def.name} t=${t}: dwelling train ${s.train} not stopped at its platform`);
      }
      // where it is on the unfolded loop: a train standing at a terminus is in both bores
      const tau = t - s.day * TICKS_PER_DAY - SERVICE_START_HOUR * TICKS_PER_HOUR - s.train * svc.headway;
      const u = def.loop ? s.s : unfoldedS(svc, tau);
      points.push(terminus ? [u, unfoldedS(svc, tau, true)] : [u]);
      ok(def.loop || Math.abs(u - (s.dir > 0 ? s.s : 2 * g.L - s.s)) < 1e-6, `${def.name} t=${t}: unfolded position ${u} disagrees with the train's state`);
      const inBores = def.loop ? [0] : terminus ? [0, 1] : [s.dir > 0 ? 0 : 1];
      const side = metroBore(svc, s);
      ok(def.loop ? side === 1 : terminus ? Math.abs(side) <= 1 : side === s.dir, `${def.name} t=${t}: train ${s.train} in bore ${side}`);
      for (const v of trainPoses(svc, s, poses)) {
        for (const d of [-0.3, 0, 0.3]) {
          const bx = v.x + Math.cos(v.h) * d, bz = v.z + Math.sin(v.h) * d, k = key(Math.floor(bx), Math.floor(bz));
          if (!own.has(k)) { offTrack++; if (offTrack < 4) fail(`${def.name} t=${t}: train ${s.train} vehicle ${v.j} at (${bx.toFixed(2)}, ${bz.toFixed(2)}) is off its tunnel`); }
          for (const b of inBores) {
            const o = bores[b].get(k);
            if (o !== undefined && o !== s.train) { clashes++; if (clashes < 4) fail(`${def.name} t=${t}: trains ${o} and ${s.train} on one tile (${k}) of bore ${b}`); }
            bores[b].set(k, s.train);
          }
        }
      }
    }
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      for (const p of points[i]) for (const q of points[j]) {
        const d0 = Math.abs(p - q) % ring, d = Math.min(d0, ring - d0);
        minGap = Math.min(minGap, d);
        if (d < need - 1e-6) fail(`${def.name} t=${t}: trains ${out[i].train} and ${out[j].train} ${d.toFixed(2)} apart on the unfolded loop (need ${need.toFixed(2)})`);
      }
    }
  }
  for (let i = 0; i < svc.trains; i++) for (let k = 0; k < n; k++) ok((dwelt.get(`${i}:${k}`) ?? 0) > 0, `${def.name}: train ${i} never dwelt at station ${k}`);
  ok(maxTrains > 1, `${def.name}: never more than one train out`);
  console.log(`  ${def.name}: ${svc.trains}/${def.trains} trains of ${svc.vehicles} cars, cycle ${svc.T.toFixed(0)} ticks, headway ${svc.headway.toFixed(1)}${svc.note ? ` (${svc.note})` : ''}; ${samples} samples, up to ${maxTrains} at once, closest ${minGap.toFixed(2)} (need ${need.toFixed(2)}), ${offTrack} off-tunnel bogies, ${clashes} shared tiles in a bore`);

  const day = 1, d0 = day * TICKS_PER_DAY;
  const calls = callsBetween(svc, d0, d0 + TICKS_PER_DAY);
  ok(calls.length > 0, `${def.name}: no calls on day ${day}`);
  for (const c of calls) {
    trainsAt(svc, (c.arrive + c.depart) / 2, out);
    const s = out.find((q) => q.train === c.train);
    ok(!!s && s.phase === 'dwell' && s.stop === c.stop, `${def.name}: call of train ${c.train} at stop ${c.stop} (${hhmm(c.arrive)}) is not a dwell there`);
  }
  for (const [a, b, at] of [[0, 1, 8], [1, 0, 12.3], [n - 1, 0, 17.7], [0, n - 1, 23.5]] as const) {
    const tick = d0 + at * TICKS_PER_HOUR;
    const ride = nextRide(svc, a, b, tick);
    if (!ride) { ok(at > 23, `${def.name}: no ride ${a} -> ${b} after ${hhmm(tick)}`); continue; }
    ok(ride.depart >= tick && ride.arrive > ride.depart && ride.depart - tick <= svc.headway + Math.max(...svc.dwell) + 1, `${def.name}: ride ${a} -> ${b} at ${hhmm(tick)} departs ${hhmm(ride.depart)} arrives ${hhmm(ride.arrive)}`);
    trainsAt(svc, ride.arrive + 0.25, out);
    const s = out.find((q) => q.train === ride.train);
    ok(!!s && s.phase === 'dwell' && s.stop === b, `${def.name}: the ride ${a} -> ${b} does not arrive at ${b}`);
  }
  console.log(`    day ${day}: ${calls.length} calls, first ${hhmm(calls[0].arrive)}, last ${hhmm(calls[calls.length - 1].arrive)}; rides arrive`);
}
console.log(failures ? `\n${failures} FAILURES (${checks} checks)` : `\nALL CHECKS PASSED (${checks} checks)`);
process.exit(failures ? 1 : 0);
