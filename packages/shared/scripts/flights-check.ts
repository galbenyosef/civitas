/**
 * Prints one airport's day (arrivals, departures, runway use) and checks it by sampling every half tick:
 * at most one plane on the runway strip, none on short final while one is on it, one plane per gate,
 * and no two ground planes' footprints (wingspan x fuselage rectangles) overlapping. Then builds airports from tiles
 * and checks that the server's and the client's derivation give identical descriptors and timetables.
 *   npx tsx packages/shared/scripts/flights-check.ts [fph] [days]
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, RUNWAY_WIDTH, footprintsOverlap, flightsAt, timetable, runwayEnds, gateCount, type Airport, type FlightState,
  Zone, FRONT, placedFromDoor, terminalSpan, planRunway, TERMINAL_ROW, packTile, u16ToB64, i32ToB64, u8ToB64,
} from '../src';
import { World } from '../../server/src/world';
import { Airports } from '../../server/src/sim/airports';
import { ClientWorld } from '../../client/src/world';
import { clientAirports } from '../../client/src/airports';

const fph = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 3);
const hhmm = (t: number) => { const m = Math.round(((t % TICKS_PER_DAY) / TICKS_PER_HOUR) * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

let failures = 0;
const fail = (msg: string) => { if (failures++ < 20) console.log('FAIL ' + msg); };

const airports: Airport[] = [
  { id: 1, x: 40, y: 40, dir: 0, gates: 3, runwayLen: 12, flightsPerHour: fph },
  { id: 2, x: -17, y: 90, dir: 3, gates: 2, runwayLen: 12, flightsPerHour: fph },
  { id: 3, x: 5, y: 5, dir: 2, gates: 5, runwayLen: 16, flightsPerHour: fph },
  { id: 4, x: 5, y: 5, dir: 1, gates: 1, runwayLen: 10, flightsPerHour: fph * 2 },
];

// ---- airports from tiles: the server's and the client's code paths derive the identical descriptor --------------
// Both call shared deriveAirports(); this builds a terminal and runway in a server World, mirrors its chunks into a
// ClientWorld as the wire would, and compares what server/src/sim/airports.ts and client/src/airports.ts produce.
{
  console.log('\n=== airports derived from tiles: server path vs client path');
  const w = new World(12345);
  const cases: { door: [number, number]; r: number; len: number; shift: number }[] = [
    { door: [10, 10], r: 0, len: 12, shift: -2 }, { door: [60, 10], r: 1, len: 14, shift: -5 },
    { door: [10, 70], r: 2, len: 10, shift: -1 }, { door: [70, 70], r: 3, len: 17, shift: -3 },
  ];
  for (const k of cases) {
    // dry land all round (the seed may put water here)
    for (let y = k.door[1] - 22; y <= k.door[1] + 22; y++) for (let x = k.door[0] - 22; x <= k.door[0] + 22; x++) w.setTile(x, y, packTile(0, false, 0, 0));
    const p = placedFromDoor(Zone.Airport, k.door[0], k.door[1], k.r);
    w.placeStructure(p, { work: 300, priority: 0, built: true });
    const { back, t0 } = terminalSpan(p);
    const bs = k.r & 1 ? FRONT[k.r][0] : FRONT[k.r][1];
    const centre = back - TERMINAL_ROW * bs;
    const line = Array.from({ length: k.len }, (_, i): [number, number] => (k.r & 1 ? [centre, t0 + k.shift + i] : [t0 + k.shift + i, centre]));
    const plan = planRunway(line, { tile: (x, y) => w.getTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y), land: () => null });
    if (!plan.ok) { fail(`runway r${k.r}: ${plan.reason}`); continue; }
    for (let i = 0; i < plan.tiles!.length; i += 3) w.setAux(plan.tiles![i], plan.tiles![i + 1], plan.tiles![i + 2]);
  }
  const server = new Airports(w);
  server.rebuild();
  const cw = new ClientWorld();
  for (const c of w.chunks.values()) cw.putChunk({ cx: c.cx, cy: c.cy, tiles: u16ToB64(c.tiles), parcels: i32ToB64(c.parcel), aux: c.aux.some((v) => v) ? u8ToB64(c.aux) : undefined, sub: c.sub.some((v) => v) ? u8ToB64(c.sub) : undefined });
  const fromServer = server.airports;
  const fromClient = clientAirports(cw).filter((l) => l.airport && l.complete).map((l) => l.airport!);
  console.log(`  server: ${fromServer.length} operational, client: ${fromClient.length} operational`);
  for (const ap of fromServer) console.log(`  ${JSON.stringify(ap)}`);
  if (fromServer.length !== cases.length) fail(`expected ${cases.length} operational airports on the server, got ${fromServer.length}`);
  if (JSON.stringify(fromServer) !== JSON.stringify(fromClient)) fail('server and client airport descriptors differ');
  for (let i = 0; i < Math.min(fromServer.length, fromClient.length); i++) {
    const a = timetable(fromServer[i], 3), b = timetable(fromClient[i], 3);
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`airport ${fromServer[i].id}: timetables differ`);
    // the schedule's rules hold for the real (off-centre) layouts too
    for (let t = 3 * TICKS_PER_DAY; t < 4 * TICKS_PER_DAY; t += 1) {
      const st = flightsAt(fromServer[i], t);
      const gates = new Map<number, number>();
      for (const s of st) if (s.phase === 'dwell') gates.set(s.gate, (gates.get(s.gate) ?? 0) + 1);
      for (const [g, n] of gates) if (n > 1) fail(`airport ${fromServer[i].id} t=${t}: gate ${g} holds ${n}`);
    }
    console.log(`  airport ${fromServer[i].id}: ${a.length} flights on day 3, identical on both paths`);
  }
  // and the full checks below run on these real, off-centre layouts too
  airports.push(...fromServer);
}


for (const ap of airports) {
  console.log(`\n=== airport ${ap.id} at ${ap.x},${ap.y} dir ${ap.dir} gates ${gateCount(ap)}/${ap.gates} runway ${ap.runwayLen} fph ${ap.flightsPerHour}`);
  for (let day = 0; day < days; day++) {
    const tt = timetable(ap, day);
    const w = runwayEnds(ap, day);
    const d0 = day * TICKS_PER_DAY;
    console.log(`day ${day}: ${tt.length} flights, wind ${w.wind > 0 ? 'with' : 'against'} the runway heading`);
    if (day === 0) {
      console.log('  id    type        gate  approach touchdown at-gate  pushback lift-off  end     turnaround  runway use');
      for (const f of tt) {
        console.log(`  ${String(f.id).padEnd(5)} ${f.type.padEnd(11)} ${f.gate}     ${hhmm(f.tApproach)}    ${hhmm(f.tTouchdown)}     ${hhmm(f.tGate)}   ${hhmm(f.tPush)}    ${hhmm(f.tLiftoff)}    ${hhmm(f.tEnd)}   ${String(Math.round(f.tPush - f.tGate)).padStart(3)} ticks  land ${f.landing.map((x) => Math.round(x - d0)).join('-')}, take-off ${f.takeoff.map((x) => Math.round(x - d0)).join('-')}`);
      }
    }
    // runway intervals reserved must be disjoint
    const iv = tt.flatMap((f) => [f.landing, f.takeoff]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < iv.length; i++) if (iv[i][0] < iv[i - 1][1]) fail(`ap${ap.id} day${day} reserved runway intervals overlap at ${iv[i][0]}`);
    for (const f of tt) {
      if (f.tEnd >= d0 + TICKS_PER_DAY) fail(`flight ${f.id} runs past midnight`);
      if (f.tApproach < d0 || (f.tApproach - d0) / TICKS_PER_HOUR < 4.9) fail(`flight ${f.id} before 05:00 (${hhmm(f.tApproach)})`);
    }

    // sample the whole day
    const phasesSeen = new Map<string, number>();
    let maxRunway = 0, maxActive = 0, groundSamples = 0;
    const out: FlightState[] = [];
    for (let t = d0; t < d0 + TICKS_PER_DAY; t += 0.5) {
      flightsAt(ap, t, out);
      maxActive = Math.max(maxActive, out.length);
      let onRunway = 0, onFinal = 0;
      const perGate = new Map<number, number>();
      const ground: FlightState[] = [];
      for (const s of out) {
        phasesSeen.set(s.phase, (phasesSeen.get(s.phase) ?? 0) + 1);
        if (s.y < 0.3) ground.push(s);
        if (s.phase === 'dwell') perGate.set(s.gate, (perGate.get(s.gate) ?? 0) + 1);
        if (s.phase === 'approach' || s.phase === 'flare') {
          // within 8 tiles of touchdown
          if (s.y >= 0.01 && s.y < 1.3) onFinal++;
        }
        // on the runway strip: the plane's gear is on the runway surface (below the first lane line)
        if (s.y < 0.01) {
          const f = (s.x - (ap.x + 0.5)), g = (s.z - (ap.y + 0.5));
          const [ax, az] = ap.dir === 0 ? [1, 0] : ap.dir === 1 ? [-1, 0] : ap.dir === 2 ? [0, 1] : [0, -1];
          const u = f * ax + g * az, v = -f * az + g * ax;
          if (Math.abs(u) <= ap.runwayLen / 2 && Math.abs(v) < RUNWAY_WIDTH / 2) onRunway++;
        }
      }
      maxRunway = Math.max(maxRunway, onRunway);
      if (onRunway > 1) fail(`ap${ap.id} t=${t}: ${onRunway} planes on the runway`);
      if (onRunway >= 1 && onFinal >= 1) fail(`ap${ap.id} t=${t}: plane on short final while the runway is occupied`);
      for (const [g, n] of perGate) if (n > 1) fail(`ap${ap.id} t=${t}: gate ${g} holds ${n}`);
      for (let i = 0; i < ground.length; i++) for (let j = i + 1; j < ground.length; j++) {
        const a = ground[i], b = ground[j];
        groundSamples++;
        if (footprintsOverlap(a.x, a.z, a.heading, a.type, b.x, b.z, b.heading, b.type)) fail(`ap${ap.id} t=${t}: ${a.id} (${a.phase}) and ${b.id} (${b.phase}) footprints overlap`);
      }
    }
    console.log(`  sampled ${TICKS_PER_DAY * 2} instants: max ${maxActive} planes at once, max ${maxRunway} on runway, ${groundSamples} ground pairs checked; phases seen: ${[...phasesSeen.keys()].join(' ')}`);
  }
}
console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
