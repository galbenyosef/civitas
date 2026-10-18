/**
 * `npm run demo:check` (docs/demo.md): keeps the demo maps complete and buildable.
 *
 *   npx tsx packages/server/src/demo/check.ts [--run days] [--fill] [--demo id]
 *
 * 1. Completeness (shared/src/demo/showcase.ts showcaseProblems): every placeable catalogue kind, in particular every
 *    kind bigger than 1×1 and every size-ladder rung, is placed in the showcase; every zoning tool has a grown block on
 *    the tour; every surface tool (runway, track) is painted and every line mode (bus, rail, freight) runs; every
 *    feature of the registry (SHOWCASE_FEATURES: bridge styles, level crossing, plane types, helicopter services,
 *    merged lots...) is in its demo's scenario with a tour stop.
 * 2. Every demo seeds through the real planners with no refusal, every line routes and runs, every building's door
 *    has a road beside it, seeding twice gives the same hash of tiles, aux, sub and lines (the town is deterministic),
 *    and every feature's `seeded` test passes on what was built (seededFeatureProblems).
 * 3. With --run, the showcase (or --demo) runs that many game days under a seeded Math.random (after the live demo's
 *    fast fill with --fill: fillDemo, so the town is as a visitor finds it, about 75 s for the showcase) and prints who uses
 *    what: staff per placement, venue visits, bus and train riders, flights by plane type, helicopter flights by
 *    service, bascule lifts, level-crossing closures, gateway arrivals and containers.
 */
import {
  KIND_NAMES, TICKS_PER_DAY, CHUNK_SIZE, DEMOS, demoSections, showcaseProblems, seededFeatureProblems, isDemoId, KIND_ID, timetable, heliTimetable,
  isBridgeAux, bridgeStyle, BridgeStyle, basculeSeed, basculeLiftAt, isCrossing, type DemoId, type SeededDemo,
} from '@msimcity/shared';
import { chunkPads } from '@msimcity/shared/src/helipads';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { Airports } from '../sim/airports';
import { Rail } from '../sim/rail';
import { seedDemoTown, seedDemoNetwork, worldHash, seededRandom, fillDemo } from './seed';
import { GARDEN_KIND } from '../sim/blocks';

const CHUNK = CHUNK_SIZE;
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
let failed = 0;
const fail = (msg: string) => { failed++; console.log(`  FAIL ${msg}`); };

function build(id: DemoId) {
  const w = new World(7);
  const p1 = seedDemoTown(w, id);
  const sim = new Simulation(w);
  const airports = new Airports(w);
  const rail = new Rail(w, sim.transit);
  sim.transit.register(rail);
  sim.freight = rail;
  rail.trucks = { spawn: (from, to, owner) => sim.spawnFreightTruck(from, to, owner) };
  sim.traffic.barrier = (x, y) => rail.barrierDown(x, y);
  const p2 = seedDemoNetwork(w, sim, rail, id);
  return { w, sim, airports, rail, problems: [...p1, ...p2] };
}

/** What the feature registry's `seeded` tests read of a seeded world (shared/src/demo/showcase.ts SeededDemo). */
function seededOf(w: World, airports: Airports, sim: Simulation): SeededDemo {
  const kinds = new Map<number, number>();
  for (const b of w.buildings.values()) kinds.set(b.id, (kinds.get(b.id) ?? 0) + 1);
  const chunks = [...w.chunks.values()].filter((c) => c.modified);
  const env = { tile: (x: number, y: number) => w.peekTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y) };
  airports.rebuild();
  return {
    kinds,
    scan: (f) => { for (const c of chunks) for (let i = 0; i < c.tiles.length; i++) f(c.cx * CHUNK + (i % CHUNK), c.cy * CHUNK + Math.floor(i / CHUNK), c.tiles[i], c.aux[i]); },
    aux: (x, y) => w.auxAt(x, y),
    pads: chunks.flatMap((c) => chunkPads(c.cx, c.cy, env)),
    airports: airports.airports,
    busTurns: [...w.transitLines.values()].filter((l) => l.mode === 'bus').map((l) => ({ number: l.number, turns: sim.buses.plan(l).turns })),
  };
}

console.log('completeness (showcase)');
const missing = showcaseProblems();
for (const m of missing) fail(m);
if (!missing.length) console.log('  ok: every placeable kind, ladder rung, surface and line mode is in the showcase');

for (const d of DEMOS) {
  console.log(`seeding ${d.id}`);
  const a = build(d.id), b = build(d.id);
  for (const p of a.problems) fail(p);
  const ha = worldHash(a.w), hb = worldHash(b.w);
  if (ha !== hb) fail(`seeding twice gave different towns (${ha} vs ${hb})`);
  a.sim.tick(); // routes the rail lines
  for (const l of a.sim.transit.lineInfos((id) => id)) {
    const rl = a.rail.dtos().find((r) => r.id === l.id);
    const status = rl ? rl.status : l.status;
    if (rl && rl.status !== 'running') fail(`rail line ${l.number}: ${rl.status}`);
    else console.log(`  ${l.mode} line ${l.number}: ${l.stops.length} stops, ${status || 'routed'}`);
  }
  // a door with no road beside it can never be reached (staff, residents, visitors): every placement's, and on a
  // painted map (London) every built building's. The 3×3 grid town's inner lots are seedCity's, built with no road
  // beside them (as in every test city); they are counted, not failed
  const stranded = new Map<string, number>();
  const placed = new Set(demoSections(d.id).flatMap((s) => (s.placements ?? []).map((p) => `${p.door[0]},${p.door[1]}`)));
  let inner = 0;
  for (const bld of a.w.buildings.values()) {
    if (bld.level === 0 || a.w.hasRoadAccess(bld.x, bld.y) || bld.id === GARDEN_KIND) continue; // a block's communal garden has no road by design (sim/blocks.ts)
    if (!d.town && !placed.has(`${bld.x},${bld.y}`)) { inner++; continue; }
    stranded.set(KIND_NAMES[bld.id], (stranded.get(KIND_NAMES[bld.id]) ?? 0) + 1);
  }
  if (stranded.size) fail(`doors with no road beside them: ${[...stranded].map(([k, n]) => `${n} ${k}`).join(', ')}`);
  if (inner) console.log(`  note: ${inner} grown lots of the grid town have no road beside them (seedCity's inner lots)`);
  const want = demoSections(d.id).reduce((n, s) => n + (s.lines?.length ?? 0), 0);
  if (a.w.transitLines.size !== want) fail(`${want} lines in the scenario, ${a.w.transitLines.size} saved`);
  const featureMisses = seededFeatureProblems(d.id, seededOf(a.w, a.airports, a.sim));
  for (const m of featureMisses) fail(m);
  if (!a.problems.length && ha === hb) console.log(`  ok: ${a.w.buildings.size} buildings, ${a.w.transitLines.size} lines, hash ${ha}`);
}

const days = Number(arg('run') ?? 0);
if (days > 0) {
  const id = (isDemoId(arg('demo')) ? arg('demo') : 'showcase') as DemoId;
  console.log(`running ${id} for ${days} game day(s)`);
  const real = Math.random;
  Math.random = seededRandom(7);
  const { w, sim, airports, rail } = build(id);
  if (argv.includes('--fill')) {
    const f0 = performance.now();
    const r = await fillDemo(w, () => { sim.tick(); airports.tick(); }, () => {});
    console.log(`  filled: ${r.pop} citizens after ${(r.ticks / TICKS_PER_DAY).toFixed(2)} days in ${((performance.now() - f0) / 1000).toFixed(1)} s`);
  }
  const t0 = performance.now(), day0 = w.day;
  // tick times of the last game day (the town is fullest then)
  const last: number[] = [];
  const n = Math.round(days * TICKS_PER_DAY);
  const crossingTicks = new Map<string, number>();
  const crossings: [number, number][] = [];
  for (const c of w.chunks.values()) for (let i = 0; i < c.tiles.length; i++) if (isCrossing(c.tiles[i], c.aux[i])) crossings.push([c.cx * CHUNK + (i % CHUNK), c.cy * CHUNK + Math.floor(i / CHUNK)]);
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    sim.tick(); airports.tick();
    for (const [x, y] of crossings) if (rail.barrierDown(x, y)) crossingTicks.set(`${x},${y}`, (crossingTicks.get(`${x},${y}`) ?? 0) + 1);
    if (i >= n - TICKS_PER_DAY) last.push(performance.now() - a);
  }
  Math.random = real;
  console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)} s, day ${w.day}, ${w.citizens.size} citizens, hash ${worldHash(w)}`);
  last.sort((a, b) => a - b);
  const avg = last.reduce((a, b) => a + b, 0) / (last.length || 1);
  console.log(`  tick over the last game day: avg ${avg.toFixed(1)} ms, p95 ${(last[Math.floor(last.length * 0.95)] ?? 0).toFixed(1)} ms, max ${(last[last.length - 1] ?? 0).toFixed(1)} ms`);
  console.log(`  population ${sim.population}, jobs ${sim.jobs}, employed ${sim.employed}`);
  const kid = (s: string) => (KIND_ID as Record<string, number>)[s];
  for (const s of demoSections(id)) for (const p of s.placements ?? []) {
    const [x, y] = p.door;
    const bld = w.buildings.get(`${x},${y}`);
    if (!bld) { console.log(`  ${p.id ?? p.kind}: no building at the door`); continue; }
    const info = sim.describe(bld, false);
    const bits = [`staff ${bld.occupants}/${info.capacity}`];
    if (info.venue) bits.push(`visits ${info.venue.visitsToday} today, ${info.venue.visitsYesterday} yesterday`);
    if (bld.id === kid('airport')) { const a = airports.describe(x, y); if (a) bits.push(`airport ${JSON.stringify(a).slice(0, 220)}`); }
    if (info.transit) bits.push(`stop: ${JSON.stringify(info.transit).slice(0, 160)}`);
    console.log(`  ${(p.id ?? p.kind).padEnd(22)} ${KIND_NAMES[bld.id]}: ${bits.join(' · ')}`);
  }
  for (const l of sim.transit.lineInfos((i) => i)) console.log(`  line ${l.mode} ${l.number}: ${l.status || 'running'}, in service ${l.inService}, riders today ${l.ridersToday}, yesterday ${l.ridersYesterday}`);
  console.log(`  freight: ${JSON.stringify(rail.freightStats)}`);
  console.log(`  transit: ${JSON.stringify(sim.transit.stats)}`);
  // the registry's features in use over the days run (docs/demo.md "Keeping it complete")
  const seeded = seededOf(w, airports, sim), runDays = Array.from({ length: w.day - day0 + 1 }, (_, d) => day0 + d);
  const count = <T extends string>(xs: T[]) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {} as Record<string, number>);
  for (const ap of seeded.airports) console.log(`  planes scheduled at airport ${ap.id} (runway ${ap.runwayLen}), days ${day0}-${w.day}, by type: ${JSON.stringify(count(runDays.flatMap((d) => timetable(ap, d).map((f) => f.type))))}`);
  console.log(`  helicopter flights by service (${seeded.pads.length} pads): ${JSON.stringify(count(runDays.flatMap((d) => heliTimetable(seeded.pads, d).map((f) => f.kind))))}`);
  seeded.scan((x, y, _t, a) => {
    if (!isBridgeAux(a) || bridgeStyle(a) !== BridgeStyle.Bascule || w.auxAt(x - (a & 1 ? 0 : 1), y - (a & 1 ? 1 : 0)) === a) return;
    const lifts = new Set<number>();
    for (let h = day0 * 24; h < (w.day + 1) * 24; h += 0.1) { const s = basculeLiftAt(basculeSeed(x, y), h); if (!Number.isNaN(s)) lifts.add(s); }
    console.log(`  bascule at (${x}, ${y}): ${lifts.size} lift(s) for a barge, at ${[...lifts].map((s) => `day ${Math.floor(s / 24)} ${String(Math.floor(s % 24)).padStart(2, '0')}:${String(Math.floor((s % 1) * 60)).padStart(2, '0')}`).join(', ') || 'none'}`);
  });
  seeded.scan((x, y, t, a) => { if (isCrossing(t, a)) console.log(`  level crossing at (${x}, ${y}): barriers down ${crossingTicks.get(`${x},${y}`) ?? 0} ticks of ${n}`); });
  console.log(`  gateways: ${JSON.stringify(sim.gateways.totals)}`);
}

console.log(failed ? `\n${failed} problem(s)` : '\ndemo check passed');
process.exit(failed ? 1 : 0);
