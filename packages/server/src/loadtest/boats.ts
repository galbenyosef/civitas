/**
 * Boats load test (docs/boats.md section 9): a test city of 2×2 districts, fully built, beside a big lake (open water:
 * its offing is the sea gate, Rich's default for procedural worlds) with every harbour kind on the shore: 2 jetties,
 * a ferry pier, 2 marinas, 2 fishing harbours and a cargo port. Fills the city, then runs whole days through the
 * real game loop (createGame: simulation, airports, rail, metro, harbours, the network flush) and prints the tick
 * cost, the harbours' own share of it, lane derivations, voyages, the catch, ship calls, containers both ways, sea
 * arrivals through the port's gateway, and the fees.
 *
 *   npx tsx packages/server/src/loadtest/boats.ts [--days 2] [--districts 2] [--off]
 *
 * A motorway connection at the west end gives both runs a road way out (`--no-motorway` leaves it off). `--off` runs the same city with the harbours module disconnected (no lanes, no events, no port exports, and the
 * port opens as a gateway with no sea-route check, as before B4): the baseline for the tick cost. Every variant fills
 * with the harbours on and switches at the start of the measured days, with Math.random re-seeded there. `--no-lorries` keeps
 * the harbours but sends no fish, container or export lorries, to tell their road traffic from the module's own cost.
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, DEFAULT_TAX, Terrain, packTile, planStructure, placedFromDoor, workOf, isWetTile, HARBOUR_KIND, KIND_NAMES,
  boatTimetable, capacityOf, tileKey, VehicleKind, MOTORWAY_KIND, type HarbourRole,
} from '@msimcity/shared';
import { World, emptyStats } from '../world';
import { createGame } from '../game';
import { seedCity } from './cities';
import { seededRandom } from '../demo/seed';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const days = Number(arg('days', '2')), districts = Number(arg('districts', '2')), off = argv.includes('--off');
const SEED = 7;
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
const log = (s: string) => process.stdout.write(s + '\n');

Math.random = seededRandom(SEED);
const w = new World(SEED);
const layout = seedCity(w, { districts, built: 3 });
const east = layout.x0 + layout.span - 1; // the city's east street, every row a road
const X = east + 1, LAKE = X + 7, LAKE_W = 80;
// the shore strip, owned like the city; the lake beyond it (open water: well over OPEN_SEA_TILES)
const shore = { id: w.nextId++, owner: 'sys', name: 'The Waterfront', x: X, y: layout.y0, w: LAKE - X, h: layout.span, taxRate: DEFAULT_TAX, stats: emptyStats() };
w.parcels.set(shore.id, shore);
const water = (x: number, y: number) => w.setTile(x, y, packTile(Terrain.Water, false, 0, 0));
for (let y = layout.y0 - 40; y < layout.y0 + layout.span + 40; y++) for (let x = X; x < LAKE + LAKE_W; x++) {
  if (x < LAKE && y >= layout.y0 && y < layout.y0 + layout.span) { w.setParcelId(x, y, shore.id); w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue; }
  water(x, y);
}
// each harbour faces the street (west), its back to the water; an inlet a tile wider each side runs from its wet rows to the lake
const PLAN: HarbourRole[] = ['jetty', 'pier', 'marina', 'fishing', 'port', 'fishing', 'marina', 'jetty'];
const placed: string[] = [];
let yy = layout.y0 + 1;
const env = { tile: (x: number, y: number) => w.getTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y), land: () => null };
for (const role of PLAN) {
  const kind = HARBOUR_KIND[role], p0 = placedFromDoor(kind, X, 0, 3), doorY = yy - p0.ay + 1;
  const p = placedFromDoor(kind, X, doorY, 3);
  if (p.ay + p.h + 1 > layout.y0 + layout.span) { placed.push(`${role}: no room`); break; }
  let wetX = Infinity;
  for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) if (isWetTile(p, x, y)) wetX = Math.min(wetX, x);
  for (let y = p.ay - 1; y <= p.ay + p.h; y++) for (let x = wetX; x < LAKE; x++) water(x, y);
  const v = planStructure(kind, X, doorY, env, 3);
  if (v.ok) { w.placeStructure(v.placed, { work: workOf(kind, 1), priority: 1, built: true }); placed.push(`${KIND_NAMES[kind]} (${X}, ${doorY})`); }
  else placed.push(`${KIND_NAMES[kind]} (${X}, ${doorY}) refused: ${v.reason}`);
  yy = p.ay + p.h + 2;
}
// a motorway connection at the west end of the city (as loadtest/harness.ts --gateways), so exports and newcomers have
// a road way out in both runs and the port only takes what is nearer to it
if (!argv.includes('--no-motorway')) {
  const ry = layout.y0 + 5, rx = layout.x0;
  const mp = { id: w.nextId++, owner: 'sys', name: 'Motorway junction', x: rx - 4, y: ry - 2, w: 4, h: 5, taxRate: DEFAULT_TAX, stats: emptyStats() };
  w.parcels.set(mp.id, mp);
  for (let y = mp.y; y < mp.y + mp.h; y++) for (let x = mp.x; x < mp.x + mp.w; x++) { w.setParcelId(x, y, mp.id); w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); }
  const v = planStructure(MOTORWAY_KIND, rx - 1, ry, env, 1);
  if (v.ok) w.placeStructure(v.placed, { work: workOf(MOTORWAY_KIND, 1), priority: 1, built: true });
  placed.push(v.ok ? `motorway connection (${rx - 1}, ${ry})` : `motorway refused: ${v.reason}`);
}
log(`${districts}×${districts} districts; ${placed.join(', ')}`);

const game = createGame(w, { onConnection() {} }, { devTools: true, sandbox: false });
const { sim, harbours } = game;

// ---- fill: newcomers move straight in until the population levels off ------------------------------------------------
const tf = performance.now();
w.filling = true;
let prev = 0, flat = 0;
for (let t = 0; t < 2 * DAY; t++) {
  game.step();
  if (w.tick % TPH) continue;
  const pop = w.citizens.size;
  flat = pop - prev < pop * 0.002 ? flat + 1 : 0;
  prev = pop;
  if (flat >= 6 && t > DAY / 2) break;
}
w.filling = false;
// the nearest jobs fill first, and a fully built city has more jobs than people: move the nearest workers to any
// harbour still short of staff, as if they had changed jobs
const hire = (sim as unknown as { hire(c: unknown, b: unknown, path: number[] | null): void }).hire.bind(sim);
for (const b of w.builtOf(15)) {
  if (b.id < 24 || b.id > 28) continue;
  const want = capacityOf(b.id, b.level) - b.occupants;
  const near = [...w.citizens.values()].filter((c) => c.job && w.buildings.get(tileKey(c.wx, c.wy))?.zone !== 15).sort((a, c) => Math.abs(a.hx - b.x) + Math.abs(a.hy - b.y) - Math.abs(c.hx - b.x) - Math.abs(c.hy - b.y));
  for (const c of near.slice(0, Math.max(0, want))) { w.quitJob(c); hire(c, b, null); }
}
// start the measured days at midnight, so each is a whole schedule day
while (w.tick % DAY) game.step();
log(`filled: ${w.citizens.size} people in ${((performance.now() - tf) / 1000).toFixed(0)} s; harbour staff ${[...w.builtOf(15)].filter((b) => b.id >= 24 && b.id <= 28).map((b) => `${KIND_NAMES[b.id]} ${b.occupants}`).join(', ')}`);

// ---- measure ------------------------------------------------------------------------------------------------------------
// A fair A/B: both runs fill the same city with the harbours on, then the variant is switched here and Math.random is
// re-seeded, so the measured days start from one city and one random stream
if (off) { harbours.tick = () => {}; sim.ports = null; sim.gateways.seaRoute = () => true; }
if (argv.includes('--no-lorries')) { sim.ports = null; sim.harbourFreight = () => {}; } // the harbours without their road traffic
Math.random = seededRandom(SEED * 7919 + 1);
const t0Tot = { ...harbours.totals }, gw0 = { ...sim.gateways.totals };
let seaIn = 0;
const noteIn = sim.gateways.noteIn.bind(sim.gateways);
sim.gateways.noteIn = (g) => { if (g.spec.type === 'sea') seaIn++; noteIn(g); };
const ticks: number[] = [], hTicks: number[] = [];
const ht = harbours.tick.bind(harbours);
if (!off) harbours.tick = () => { const a = performance.now(); ht(); hTicks.push(performance.now() - a); };
// where the slow harbour ticks go: scans (lane derivations) and a day's timetable and events
const parts = { scan: [0, 0], events: [0, 0] };
const hx = harbours as unknown as Record<'scan' | 'events', (...a: unknown[]) => unknown>;
for (const k of ['scan', 'events'] as const) {
  const f = hx[k].bind(harbours);
  hx[k] = (...a: unknown[]) => { const t = performance.now(), r = f(...a), dt = performance.now() - t; parts[k][0] += dt; parts[k][1] = Math.max(parts[k][1], dt); return r; };
}
// freight lorries set off in the measured days, and their road tiles (harbour lorries are part of the cost)
const seenV = new Set<number>();
let lorries = 0, lorryTiles = 0;
for (let t = 0; t < days * DAY; t++) {
  const a = performance.now();
  game.step();
  ticks.push(performance.now() - a);
  for (const v of w.vehicles.values()) {
    if (v.vkind !== VehicleKind.Freight || seenV.has(v.id)) continue;
    seenV.add(v.id); lorries++; lorryTiles += (v.leg?.path.length ?? 0) / 2;
  }
}
const sorted = [...ticks].sort((a, b) => a - b), avg = ticks.reduce((s, v) => s + v, 0) / ticks.length;
const hAvg = hTicks.length ? hTicks.reduce((s, v) => s + v, 0) / hTicks.length : 0, hMax = hTicks.length ? Math.max(...hTicks) : 0;
log(`\n${off ? 'HARBOURS OFF' : argv.includes('--no-lorries') ? 'harbours on, no lorries' : 'harbours on'}: ${days} days, ${ticks.length} ticks: ${avg.toFixed(2)} ms a tick (p50 ${sorted[Math.floor(ticks.length / 2)].toFixed(2)}, p95 ${sorted[Math.floor(ticks.length * 0.95)].toFixed(2)}, max ${sorted[ticks.length - 1].toFixed(1)}); population ${w.citizens.size}; ${lorries} freight lorries set off, ${(lorryTiles / Math.max(1, lorries)).toFixed(0)} road tiles each on average`);
if (off) process.exit(0);
log(`harbours.tick: ${(hAvg * 1000).toFixed(1)} µs a tick on average (${(100 * hAvg / avg).toFixed(2)}% of the tick), max ${hMax.toFixed(1)} ms; scans ${parts.scan[0].toFixed(0)} ms in all (max ${parts.scan[1].toFixed(1)}), events and timetables ${parts.events[0].toFixed(0)} ms (max ${parts.events[1].toFixed(1)})`);
const T = harbours.totals;
log(`lane derivations: ${T.derivations} harbour-derivations in ${T.deriveMs.toFixed(0)} ms (${(T.deriveMs / Math.max(1, T.derivations)).toFixed(1)} ms each); the list: ${harbours.list.length} harbours, ${harbours.list.reduce((s, h) => s + h.lanes.length, 0)} lanes, gates ${harbours.gates.map((g) => `${g.name} (${g.x}, ${g.y})`).join(', ') || 'none'}; message ${(JSON.stringify(harbours.msg()).length / 1024).toFixed(1)} KB`);
for (const h of harbours.list) log(`  ${h.name} (${KIND_NAMES[h.kind]}, ${h.active ? 'staffed' : 'NOT STAFFED'}): ${h.lanes.map((l) => `${l.purpose}/${l.cls}/${l.sig}${l.gate ? `→${l.gate}` : ''} ${l.route.sides.length}`).join(', ') || 'no lanes'}${h.refused ? `; refused: ${h.refused.join('; ')}` : ''}`);
const d0 = Math.floor(harbours.now / DAY) - days;
for (let d = d0; d < d0 + days; d++) {
  const vs = boatTimetable(harbours.list, d).voyages, by: Record<string, number> = {};
  for (const v of vs) by[v.kind === 'call' ? v.type : v.kind] = (by[v.kind === 'call' ? v.type : v.kind] ?? 0) + 1;
  log(`  day ${d}: ${vs.length} voyages: ${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ')}`);
}
const D = (k: keyof typeof T) => T[k] - t0Tot[k];
log(`catch: ${D('landed')} boxes landed, ${D('sold')} sent to market by lorry`);
log(`ship calls: ${D('calls')}; containers landed ${D('imports')} (${D('importLorries')} lorries to shops so far), taken on ${D('exports')}; ro-ro passengers ${D('passengers')}`);
log(`fees: port dues $${D('dues')}, marina berth fees $${D('berthFees')}`);
log(`gateways: ${sim.gateways.totals.in - gw0.in} in, ${sim.gateways.totals.out - gw0.out} out over all gates; ${seaIn} of the arrivals through the cargo port; gates open: ${[...sim.gateways.list].map((g) => g.spec.type).join(', ') || 'none'}`);
const today = harbours.today();
log(`now: ${today.stock} boxes of fish on the quays, ${today.importQueue} containers waiting for lorries, ${today.exportStack} in the export stack`);
