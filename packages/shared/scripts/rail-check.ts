/**
 * Railways (shared/src/rail.ts, docs/rail.md): builds track, stations and lines in a server World, mirrors the chunks
 * into a ClientWorld as the wire would, and checks that
 *  - both paths derive identical routes, geometry and timetables;
 *  - a route is a chain of connected track tiles (and a loop closes);
 *  - at every sampled instant no two trains of a line are closer than a train length plus TRAIN_GAP, every vehicle's
 *    bogies sit on the line's own track tiles, and trains only run in service hours;
 *  - every train dwells at every station on its line, standing still at the platform's middle;
 *  - the planner's next ride gets there (callsBetween, nextRide);
 *  - the derivation refuses what it should: unconnected stations, a station off the track, a loop that does not close.
 *   npx tsx packages/shared/scripts/rail-check.ts [days]
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, packTile, u16ToB64, i32ToB64, u8ToB64, placedFromAnchor,
  RAIL_HALT, RAIL_STATION, RAIL_SIDES, oppSide, isRailAux, railMask, planTrack, trackDragPath, routeLine, routeTiles, railGeometry, railService,
  trainsAt, trainPoses, callsBetween, nextRide, railPoint, TRAIN_GAP, SERVICE_START_HOUR, stationStop, RAIL_YARD, RailVehicle, consistLength, FREIGHT_WAGONS,
  type RailEnv, type RailLineDef, type RailRoute, type TrainState, type VehiclePose,
} from '../src';
import { World } from '../../server/src/world';
import { ClientWorld } from '../../client/src/world';

const days = Number(process.argv[2] ?? 2);
let failures = 0, checks = 0;
const fail = (msg: string) => { if (failures++ < 30) console.log('FAIL ' + msg); };
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) fail(msg); };
const hhmm = (t: number) => { const m = Math.round(((t % TICKS_PER_DAY) / TICKS_PER_HOUR) * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// ---- a world with track and stations -----------------------------------------------------------------------
const w = new World(4242);
for (let y = 0; y <= 130; y++) for (let x = -5; x <= 110; x++) w.setTile(x, y, packTile(0, false, 0, 0)); // dry land
const env: RailEnv = { tile: (x, y) => w.peekTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y) };
const paint = { ...env, tile: (x: number, y: number) => w.getTile(x, y), land: () => null };
function lay(a: [number, number], b: [number, number], xFirst?: boolean) {
  const plan = planTrack(trackDragPath(a, b, xFirst), paint);
  if (!plan.ok) { fail(`track ${a} -> ${b}: ${plan.reason}`); return; }
  for (let i = 0; i < plan.tiles!.length; i += 3) w.setAux(plan.tiles![i], plan.tiles![i + 1], plan.tiles![i + 2]);
}
/** a finished station anchored at (ax, ay) facing r, with a road tile in front of its door */
function station(kind: number, ax: number, ay: number, r: number): [number, number] {
  const p = placedFromAnchor(kind, ax, ay, r);
  w.setTile(p.frontX, p.frontY, packTile(0, true, 0, 0));
  w.placeStructure(p, { work: 300, priority: 0, built: true });
  return [p.doorX, p.doorY];
}

// line 1: there and back, a long straight, a curve down the side, and back along the bottom
lay([0, 20], [40, 20]); lay([40, 20], [40, 40]); lay([40, 40], [16, 40]);
const h1 = station(RAIL_HALT, 4, 21, 0);           // platform row y = 20, x 4-7
const s2 = station(RAIL_STATION, 28, 21, 0);       // y = 20, x 28-33
const h4 = station(RAIL_HALT, 41, 26, 1);          // x = 40, y 26-29 (faces +x)
const s3 = station(RAIL_STATION, 20, 37, 2);       // y = 40, x 20-25 (faces -y)
// line 2: a loop round a rectangle, four stations, one on each side
lay([60, 50], [90, 70]); lay([90, 70], [60, 50]);
const l1 = station(RAIL_STATION, 66, 47, 2);       // top: y = 50
const l2 = station(RAIL_HALT, 91, 56, 1);          // right: x = 90
const l3 = station(RAIL_STATION, 72, 71, 0);       // bottom: y = 70
const l4 = station(RAIL_HALT, 58, 58, 3);          // left: x = 60
// line 3: a short S-bend shuttle between two halts, with a branch off it that leads nowhere
lay([0, 80], [10, 80]); lay([10, 80], [14, 84], false); lay([14, 84], [24, 84]); lay([5, 80], [5, 90], false);
const c1 = station(RAIL_HALT, 1, 81, 0);
const c2 = station(RAIL_HALT, 18, 85, 0);
// freight: a loop with three yards, the line calling at two of them and running through the third without stopping
lay([0, 100], [30, 120]); lay([30, 120], [0, 100]);
const y1 = station(RAIL_YARD, 4, 97, 2);           // top: y = 100, x 4-9
const yPass = station(RAIL_YARD, 18, 97, 2);       // top: y = 100, x 18-23 (not on the line)
const y3 = station(RAIL_YARD, 12, 121, 0);         // bottom: y = 120, x 12-17
// and a freight shuttle between two yards on a straight
lay([50, 110], [80, 110]);
const y4 = station(RAIL_YARD, 52, 111, 0);
const y5 = station(RAIL_YARD, 70, 111, 0);
// a halt beside track that joins nothing else, for the refusals
lay([100, 10], [108, 10]);
const lone = station(RAIL_HALT, 102, 11, 0);

const defs: RailLineDef[] = [
  { id: 101, owner: 'a', number: 1, name: 'Line 1', color: 0xd63c3c, stations: [h1, s2, h4, s3], trains: 1, cars: 4, loop: false },
  { id: 102, owner: 'a', number: 2, name: 'Line 2', color: 0x2f7fd6, stations: [l1, l2, l3, l4], trains: 4, cars: 4, loop: true },
  { id: 103, owner: 'a', number: 3, name: 'Line 3', color: 0x2f9e57, stations: [c1, c2], trains: 3, cars: 2, loop: false },
  { id: 104, owner: 'a', number: 4, name: 'Line 4', color: 0xe0a020, stations: [l4, l3, l2, l1], trains: 8, cars: 3, loop: true }, // the loop run backwards
  { id: 105, owner: 'a', number: 5, name: 'Line 5', color: 0x6b6f7a, stations: [y1, y3], trains: 3, cars: 3, loop: true, freight: true },
  { id: 106, owner: 'a', number: 6, name: 'Line 6', color: 0x8a4fc8, stations: [y4, y5], trains: 2, cars: 3, loop: false, freight: true },
];
const refusals: { what: string; def: Pick<RailLineDef, 'stations' | 'loop'>; want: RegExp }[] = [
  { what: 'unconnected stations', def: { stations: [h1, lone], loop: false }, want: /not connected/ },
  { what: 'a loop on track that does not close', def: { stations: [h1, s2, s3], loop: true }, want: /back round/ },
  { what: 'a station twice', def: { stations: [h1, s2, h1], loop: false }, want: /twice/ },
  { what: 'one station', def: { stations: [h1], loop: false }, want: /at least 2/ },
  { what: 'not a station', def: { stations: [h1, [50, 50]], loop: false }, want: /no rail station/ },
];

// ---- the client's copy, as the wire delivers it ----------------------------------------------------------
const cw = new ClientWorld();
for (const c of w.chunks.values()) cw.putChunk({ cx: c.cx, cy: c.cy, tiles: u16ToB64(c.tiles), parcels: i32ToB64(c.parcel), aux: c.aux.some((v) => v) ? u8ToB64(c.aux) : undefined, sub: c.sub.some((v) => v) ? u8ToB64(c.sub) : undefined });
const cenv: RailEnv = { tile: (x, y) => cw.getTile(x, y), aux: (x, y) => cw.auxAt(x, y), sub: (x, y) => cw.subAt(x, y) };

console.log('=== routes: server path vs client path');
const routes = new Map<number, RailRoute>();
for (const def of defs) {
  const a = routeLine(def, env), b = routeLine(def, cenv);
  if (!a.ok) { fail(`line ${def.number}: server refused: ${a.reason}`); continue; }
  if (!b.ok) { fail(`line ${def.number}: client refused: ${b.reason}`); continue; }
  ok(JSON.stringify(a.route) === JSON.stringify(b.route), `line ${def.number}: server and client routes differ`);
  routes.set(def.id, a.route);
  // the route is connected track: consecutive tiles adjacent, both masks carry the joint, a loop closes
  const tl = routeTiles(a.route);
  for (let k = 0; k < tl.length; k++) {
    const t = tl[k], m = railMask(w.auxAt(t.x, t.y));
    ok(isRailAux(w.auxAt(t.x, t.y)) && !!(m & (1 << t.i)) && !!(m & (1 << t.o)) && t.i !== t.o, `line ${def.number}: tile ${k} (${t.x}, ${t.y}) is not track joined ${t.i}->${t.o}`);
    const n = k + 1 < tl.length ? tl[k + 1] : a.route.loop ? tl[0] : null;
    if (n) ok(n.x === t.x + RAIL_SIDES[t.o][0] && n.y === t.y + RAIL_SIDES[t.o][1] && n.i === oppSide(t.o), `line ${def.number}: tile ${k} does not lead into tile ${k + 1}`);
  }
  const g = railGeometry(a.route);
  ok(a.route.stops.length === def.stations.length, `line ${def.number}: ${a.route.stops.length} stops for ${def.stations.length} stations`);
  // each stopping point is the middle of the station's own platform row
  a.route.stops.forEach((st, i) => {
    const P = railPoint(g, g.stopS[i]);
    const ss = stationStop(w.structureAt(def.stations[i][0], def.stations[i][1])!);
    const along = ss.alongX ? P.x : P.z, perp = ss.alongX ? P.z : P.x;
    ok(Math.abs(along - (ss.a0 + ss.len / 2)) < 1e-6 && Math.abs(perp - (ss.row + 0.5)) < 1e-6, `line ${def.number}: stop ${i} at (${P.x.toFixed(2)}, ${P.z.toFixed(2)}) is not the platform's middle`);
    ok(st.len === ss.len, `line ${def.number}: stop ${i} platform length ${st.len} vs ${ss.len}`);
  });
  const sa = railService(def, a.route), sb = railService(def, b.route);
  ok(JSON.stringify({ ...sa, geom: undefined }) === JSON.stringify({ ...sb, geom: undefined }), `line ${def.number}: timetables differ`);
  console.log(`  line ${def.number} ${def.loop ? 'loop' : 'there and back'}: ${tl.length} tiles, ${g.L.toFixed(1)} long, cycle ${sa.T.toFixed(0)} ticks (${(sa.T / TICKS_PER_HOUR).toFixed(2)} h), ${sa.trains}/${def.trains} trains of ${sa.vehicles}, headway ${sa.headway.toFixed(1)}${sa.note ? ` (${sa.note})` : ''}; identical on both paths`);
}
console.log('=== refusals');
for (const r of refusals) {
  const v = routeLine(r.def, env);
  ok(!v.ok && r.want.test(v.reason), `${r.what}: expected a refusal matching ${r.want}, got ${v.ok ? 'a route' : v.reason}`);
  console.log(`  ${r.what}: ${v.ok ? 'ROUTED' : v.reason}`);
}
{ // a station whose platform track is broken
  const t = stationStop(w.structureAt(h1[0], h1[1])!);
  const [x, y] = [t.a0 + 1, t.row];
  const keep = w.auxAt(x, y);
  w.setAux(x, y, 0);
  const v = routeLine(defs[0], env);
  ok(!v.ok && /not on the track/.test(v.reason), `broken platform track: got ${v.ok ? 'a route' : v.reason}`);
  console.log(`  platform track lifted: ${v.ok ? 'ROUTED' : v.reason}`);
  w.setAux(x, y, keep);
}

// ---- trains over whole days ---------------------------------------------------------------------------------
console.log(`=== trains over ${days} days, sampled every half tick`);
const trackTiles = new Map<number, Set<string>>();
for (const def of defs) { const r = routes.get(def.id); if (r) trackTiles.set(def.id, new Set(routeTiles(r).map((t) => `${t.x},${t.y}`))); }
const out: TrainState[] = [], poses: VehiclePose[] = [];
for (const def of defs) {
  const route = routes.get(def.id);
  if (!route) continue;
  const svc = railService(def, route), g = svc.geom, own = trackTiles.get(def.id)!;
  const need = svc.length + TRAIN_GAP;
  let minGap = Infinity, maxTrains = 0, samples = 0, offTrack = 0;
  const dwelt = new Map<string, number>(); // train:stop -> ticks seen dwelling there
  for (let t = TICKS_PER_DAY; t < (1 + days) * TICKS_PER_DAY; t += 0.5) {
    trainsAt(svc, t, out);
    maxTrains = Math.max(maxTrains, out.length);
    const hour = (t % TICKS_PER_DAY) / TICKS_PER_HOUR;
    if (out.length && hour >= 4.8 && hour < SERVICE_START_HOUR) fail(`line ${def.number}: a train out at ${hhmm(t)}`);
    for (const s of out) {
      samples++;
      if (s.phase === 'dwell') {
        dwelt.set(`${s.train}:${s.stop}`, (dwelt.get(`${s.train}:${s.stop}`) ?? 0) + 1);
        ok(s.v === 0 && Math.abs(s.s - g.stopS[s.stop]) < 1e-9, `line ${def.number} t=${t}: dwelling train ${s.train} not stopped at its platform`);
      }
      for (const v of trainPoses(svc, s, poses)) {
        for (const d of [-0.3, 0, 0.3]) {
          const bx = v.x + Math.cos(v.h) * d, bz = v.z + Math.sin(v.h) * d;
          const key = `${Math.floor(bx)},${Math.floor(bz)}`;
          if (!own.has(key)) { offTrack++; if (offTrack < 4) fail(`line ${def.number} t=${t}: train ${s.train} vehicle ${v.j} at (${bx.toFixed(2)}, ${bz.toFixed(2)}) is off its track`); }
        }
      }
    }
    // spacing: on a loop the distance forward from each train to the next; a there-and-back line runs one train
    if (out.length > 1) {
      if (!route.loop) fail(`line ${def.number}: ${out.length} trains on one track there and back`);
      const ss = out.map((s) => s.s).sort((a, b) => a - b);
      for (let i = 0; i < ss.length; i++) {
        const gap = i + 1 < ss.length ? ss[i + 1] - ss[i] : ss[0] + g.L - ss[i];
        minGap = Math.min(minGap, gap);
        if (gap < need - 1e-6) fail(`line ${def.number} t=${t}: trains ${gap.toFixed(2)} apart (need ${need.toFixed(2)})`);
      }
    }
  }
  for (let i = 0; i < svc.trains; i++) for (let k = 0; k < def.stations.length; k++) ok((dwelt.get(`${i}:${k}`) ?? 0) > 0, `line ${def.number}: train ${i} never dwelt at station ${k}`);
  console.log(`  line ${def.number}: ${samples} train samples, up to ${maxTrains} at once, closest ${minGap === Infinity ? '-' : minGap.toFixed(2)} (need ${need.toFixed(2)}), ${offTrack} off-track bogie samples, dwells at all ${def.stations.length} stations by all ${svc.trains} trains`);

  // calls and rides
  const day = 1, d0 = day * TICKS_PER_DAY;
  const calls = callsBetween(svc, d0, d0 + TICKS_PER_DAY);
  const first = calls[0], last = calls[calls.length - 1];
  console.log(`    day ${day}: ${calls.length} calls, first ${first ? hhmm(first.arrive) : '-'}, last ${last ? hhmm(last.arrive) : '-'}`);
  ok(calls.length > 0, `line ${def.number}: no calls on day ${day}`);
  for (const c of calls) {
    trainsAt(svc, (c.arrive + c.depart) / 2, out);
    const s = out.find((q) => q.train === c.train);
    ok(!!s && s.phase === 'dwell' && s.stop === c.stop, `line ${def.number}: call of train ${c.train} at stop ${c.stop} (${hhmm(c.arrive)}) is not a dwell there`);
  }
  for (const [a, b, at] of [[0, 1, 8], [1, 0, 12.3], [def.stations.length - 1, 0, 17.7], [0, def.stations.length - 1, 23.5]] as const) {
    const tick = d0 + at * TICKS_PER_HOUR;
    const ride = nextRide(svc, a, b, tick);
    if (!ride) { ok(at > 23, `line ${def.number}: no ride ${a} -> ${b} after ${hhmm(tick)}`); continue; }
    ok(ride.depart >= tick && ride.arrive > ride.depart, `line ${def.number}: ride ${a} -> ${b} at ${hhmm(tick)} departs ${hhmm(ride.depart)} arrives ${hhmm(ride.arrive)}`);
    trainsAt(svc, ride.arrive + 0.25, out);
    const s = out.find((q) => q.train === ride.train);
    ok(!!s && s.phase === 'dwell' && s.stop === b, `line ${def.number}: the ride ${a} -> ${b} does not arrive at ${b} (train ${ride.train} is ${s ? `${s.phase} ${s.stop}` : 'gone'})`);
    trainsAt(svc, ride.depart - 0.25, out);
    const s0 = out.find((q) => q.train === ride.train);
    ok(!!s0 && s0.phase === 'dwell' && s0.stop === a, `line ${def.number}: the ride ${a} -> ${b} does not leave from ${a}`);
  }
}
console.log('=== freight');
for (const def of defs.filter((d) => d.freight)) {
  const route = routes.get(def.id);
  if (!route) continue;
  const svc = railService(def, route);
  const shortest = Math.min(...route.stops.map((s) => s.len));
  const kindsSeen = new Set<number>();
  for (let i = 0; i < svc.trains; i++) {
    const c = svc.consists[i];
    const wagons = c.filter((k) => k >= RailVehicle.Flat);
    wagons.forEach((k) => kindsSeen.add(k));
    ok(c[0] === RailVehicle.Loco && (route.loop ? c.slice(1).every((k) => k >= RailVehicle.Flat) : c[c.length - 1] === RailVehicle.Loco), `line ${def.number} train ${i}: consist ${c.join(',')} is not a locomotive${route.loop ? '' : ' at each end'} and wagons`);
    ok(wagons.length >= Math.min(FREIGHT_WAGONS.min, 4) && wagons.length <= FREIGHT_WAGONS.max, `line ${def.number} train ${i}: ${wagons.length} wagons`);
    ok(consistLength(c) <= shortest + 1e-9, `line ${def.number} train ${i}: ${consistLength(c).toFixed(2)} tiles long, longer than the shortest yard (${shortest})`);
    ok(consistLength(c) === svc.length, `line ${def.number} train ${i}: not the line's train length`);
  }
  ok(svc.dwell.every((d) => d >= 36), `line ${def.number}: freight dwells ${svc.dwell.join(', ')} (want 36+)`);
  console.log(`  line ${def.number}: ${svc.trains} trains of ${svc.vehicles} vehicles (${svc.length.toFixed(2)} tiles), dwell ${svc.dwell.join('/')} ticks, wagon kinds seen: ${[...kindsSeen].join(', ')}; consists ${svc.consists.slice(0, svc.trains).map((c) => c.join('')).join(' ')}`);
}
{ // line 5 runs through the yard it does not call at, without stopping there
  const def = defs.find((d) => d.number === 5)!, route = routes.get(def.id);
  if (route) {
    const svc = railService(def, route), g = svc.geom, p = w.structureAt(yPass[0], yPass[1])!, ss = stationStop(p);
    const tiles = routeTiles(route);
    const k0 = tiles.findIndex((t) => (ss.alongX ? t.y === ss.row && t.x === ss.a0 : t.x === ss.row && t.y === ss.a0));
    ok(k0 >= 0, 'line 5 does not run past the yard it skips');
    const sPass = g.s[Math.max(0, k0)] + ss.len / 2;
    ok(!svc.pieces.some((q) => q.stop >= 0 && Math.abs(q.s0 - sPass) < 0.5), 'line 5 stops at the yard it should run through');
    console.log(`  line 5 runs through the yard at (${yPass[0]}, ${yPass[1]}) without stopping (route tile ${k0})`);
  }
}
{ // a line mixing a station and a yard is refused by the server (sim/rail.ts), but the route alone is fine; the kinds are checked there
  const v = routeLine({ stations: [y4, y5], loop: true }, env);
  ok(!v.ok && /back round/.test(v.reason), `a freight loop on a straight: ${v.ok ? 'ROUTED' : v.reason}`);
}
console.log(failures ? `\n${failures} FAILURES (${checks} checks)` : `\nALL CHECKS PASSED (${checks} checks)`);
process.exit(failures ? 1 : 0);
