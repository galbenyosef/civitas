/**
 * `npm run demo:check` (docs/demo.md): keeps the demo maps complete and buildable.
 *
 *   npx tsx packages/server/src/demo/check.ts [--run days] [--fill] [--demo id] [--no-tube]
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
 *    service, bascule lifts, level-crossing closures, gateway arrivals and containers, for the underground: trips
 *    by metro, changes between it and the other modes, peak train load and Metro.tick's cost, and for the boats
 *    (docs/boats.md): voyages by type, tall boats through each bascule's lifts, the harbours' totals (catch, port
 *    calls, containers, ferry passengers), river bus trips and the ferry's and harbours' tick cost. `--no-tube` runs
 *    London without its Underground section, for the tick cost without the metro.
 */
import {
  KIND_NAMES, TICKS_PER_DAY, CHUNK_SIZE, DEMOS, demoSections, showcaseProblems, seededFeatureProblems, isDemoId, KIND_ID, timetable, heliTimetable,
  isBridgeAux, bridgeStyle, BridgeStyle, basculeSeed, basculeLiftAt, isCrossing, isTunnel, isPlatform, underMask, boatTimetable, boatLifts, HARBOUR_OF,
  SCHOOL_SPECS, Study, LifeStage, STUDY_NAMES, EduLevel, AD_SIZES, AD_STRIDE, adHostAt, adSlotOpen, adWear, adAge, adSeed, type DemoId, type SeededDemo, type AdSize,
} from '@msimcity/shared';
import { chunkPads } from '@msimcity/shared/src/helipads';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { Airports } from '../sim/airports';
import { Rail } from '../sim/rail';
import type { Metro } from '../sim/metro';
import type { Ferry } from '../sim/ferry';
import { Harbours } from '../sim/harbours';
import type { TransitPlan } from '../sim/transit';
import { seedDemoTown, seedDemoNetwork, seedDemoStudents, worldHash, seededRandom, fillDemo } from './seed';
import { seedDemoAdverts } from './adverts';
import { Adverts } from '../sim/adverts';
import { GARDEN_KIND } from '../sim/blocks';
import { ageOf } from '../sim/life';

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
  const p2 = seedDemoNetwork(w, sim, rail, id); // registers a Metro and a Ferry beside the Rail when the scenario has their lines
  const metro = sim.transit.services.get('metro') as Metro | undefined;
  const ferry = sim.transit.services.get('ferry') as Ferry | undefined;
  // the harbours, as game.ts runs them: the port's gateway (its sea route, ships berthing), the port as an export point
  const harbours = new Harbours(w, sim);
  // the high street's site and posters (demo/adverts.ts), as index.ts puts them up after the fill
  const adverts = new Adverts(w);
  const p3 = seedDemoAdverts(w, adverts, id);
  return { w, sim, airports, rail, metro, ferry, harbours, adverts, problems: [...p1, ...p2, ...p3] };
}

/** What the feature registry's `seeded` tests read of a seeded world (shared/src/demo/showcase.ts SeededDemo). */
function seededOf(w: World, airports: Airports, sim: Simulation, harbours: Harbours, adverts?: Adverts): SeededDemo {
  const kinds = new Map<number, number>();
  for (const b of w.buildings.values()) kinds.set(b.id, (kinds.get(b.id) ?? 0) + 1);
  const chunks = [...w.chunks.values()].filter((c) => c.modified);
  const env = { tile: (x: number, y: number) => w.peekTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y) };
  airports.rebuild();
  harbours.scan();
  return {
    kinds,
    scan: (f) => { for (const c of chunks) for (let i = 0; i < c.tiles.length; i++) f(c.cx * CHUNK + (i % CHUNK), c.cy * CHUNK + Math.floor(i / CHUNK), c.tiles[i], c.aux[i], c.under[i]); },
    aux: (x, y) => w.auxAt(x, y),
    pads: chunks.flatMap((c) => chunkPads(c.cx, c.cy, env)),
    airports: airports.airports,
    busTurns: [...w.transitLines.values()].filter((l) => l.mode === 'bus').map((l) => ({ number: l.number, turns: sim.buses.plan(l).turns })),
    lines: [...w.transitLines.values()].map((l) => ({ mode: l.mode, number: l.number, stops: l.stops.map((s): [number, number] => [s.x, s.y]) })),
    parcels: [...w.parcels.values()].map((p) => ({ id: p.id, name: p.name, group: p.group })),
    // as staffed: nobody works anywhere before the fill, and an unstaffed harbour sails nothing
    harbours: harbours.list.map((h) => ({ ...h, active: true })),
    seaGates: w.seaGates,
    schools: [...w.buildings.values()].filter((b) => SCHOOL_SPECS[b.id]).map((b) => ({ kind: b.id, x: b.x, y: b.y })),
    children: [...w.citizens.values()].map((c) => ({ x: c.hx, y: c.hy, age: ageOf(c, w.tick) })).filter((c) => c.age < 18),
    values: [...w.citizens.values()].map((c) => ({ vals: c.vals, parent: c.par ? w.citizens.get(c.par)?.vals : undefined })),
    focusAt: (x, y) => sim.focusAt(x, y),
    ads: adverts ? adsOf(w, adverts) : undefined,
    utilLinks: w.utilitiesLoaded?.links ?? [],
  };
}
/** Open ad frames by size over every door and site, and the wear of every rented poster (docs/adverts.md). */
function adsOf(w: World, adverts: Adverts): NonNullable<SeededDemo['ads']> {
  const env = { tile: (x: number, y: number) => w.peekTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y) };
  const slots: Partial<Record<AdSize, number>> = {};
  const doors = [...w.buildings.values()].map((b) => [b.x, b.y]).concat([...w.sites.values()].map((s) => [s.x, s.y]));
  for (const [x, y] of doors) {
    const h = adHostAt(env, x, y);
    if (h) for (let i = 0; i * AD_STRIDE < h.slots.length; i++) if (adSlotOpen(env, h, i, x, y)) { const s = AD_SIZES[h.slots[i * AD_STRIDE + 1]]; slots[s] = (slots[s] ?? 0) + 1; }
  }
  const screen = AD_SIZES.indexOf('screen');
  return { slots, wears: adverts.list().map((r) => adWear(adAge(r.age, r.rate, r.at, w.tick), adSeed(r.x, r.y, r.i, r.c))), screensRented: adverts.list().filter((r) => r.s === screen).length };
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
  a.sim.tick(); // routes the rail and metro lines
  for (const l of a.sim.transit.lineInfos((id) => id)) {
    const rl = a.rail.dtos().find((r) => r.id === l.id) ?? a.metro?.dtos().find((r) => r.id === l.id) ?? a.ferry?.dtos().find((r) => r.id === l.id);
    const status = rl ? rl.status : l.status;
    if (rl && rl.status !== 'running') fail(`${l.mode} line ${l.number}: ${rl.status}`);
    else console.log(`  ${l.mode} line ${l.number}${rl && 'names' in rl ? ` (${rl.name})` : ''}: ${l.stops.length} stops, ${status || 'routed'}`);
  }
  if (a.metro) { // what the seeding bored: tunnel and platform tiles, crossovers (a four-sided tunnel byte)
    let tunnel = 0, platform = 0, cross = 0;
    for (const c of a.w.chunks.values()) for (const u of c.under) { if (isPlatform(u)) platform++; else if (isTunnel(u)) { tunnel++; if (underMask(u) === 15) cross++; } }
    console.log(`  underground: ${tunnel} tunnel tiles, ${platform} platform tiles, ${cross} crossover(s)`);
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
  const seededA = seededOf(a.w, a.airports, a.sim, a.harbours, a.adverts);
  if (seededA.ads?.wears.length) console.log(`  ad frames open by size: ${JSON.stringify(seededA.ads.slots)}; ${seededA.ads.wears.length} posters up, wear ${seededA.ads.wears.map((x) => x.toFixed(2)).join(' ')}`);
  for (const h of seededA.harbours) {
    const why = h.refused?.length ? `: ${h.refused.join('; ')}` : '';
    console.log(`  ${HARBOUR_OF[h.kind]!.role} ${h.name} at (${h.x}, ${h.y}): ${h.lanes.map((l) => `${l.purpose}/${l.cls}${l.gate ? ` to ${l.gate}` : ''} ${l.route.sides.length}`).join(', ') || 'no lanes'}${why}`);
  }
  if (seededA.seaGates.length) console.log(`  sea gates: ${seededA.seaGates.map((g) => `${g.name} (${g.x}, ${g.y})${g.low ? ' low' : ''}`).join(', ')}`);
  if (seededA.schools.length) console.log(`  schools: ${seededA.schools.length} standing (${[...new Set(seededA.schools.map((q) => KIND_NAMES[q.kind]))].join(', ')}), ${seededA.children.length} children and young people living in homes before the fill`);
  const featureMisses = seededFeatureProblems(d.id, seededA);
  for (const m of featureMisses) fail(m);
  if (!a.problems.length && ha === hb) console.log(`  ok: ${a.w.buildings.size} buildings, ${a.w.transitLines.size} lines, hash ${ha}`);
}

const days = Number(arg('run') ?? 0);
if (days > 0) {
  const id = (isDemoId(arg('demo')) ? arg('demo') : 'showcase') as DemoId;
  if (argv.includes('--no-tube')) { const d = DEMOS.find((q) => q.id === id)!; d.sections = d.sections.filter((s) => s !== 'london-tube'); }
  console.log(`running ${id} for ${days} game day(s)${argv.includes('--no-tube') ? ' without the Underground' : ''}`);
  const real = Math.random;
  Math.random = seededRandom(7);
  const { w, sim, airports, rail, metro, ferry, harbours, adverts } = build(id);
  if (argv.includes('--fill')) {
    const f0 = performance.now();
    const r = await fillDemo(w, () => { sim.tick(); airports.tick(); harbours.tick(); }, () => {});
    console.log(`  filled: ${r.pop} citizens after ${(r.ticks / TICKS_PER_DAY).toFixed(2)} days in ${((performance.now() - f0) / 1000).toFixed(1)} s`);
    const students = seedDemoStudents(w, sim, id);
    if (students) console.log(`  ${students} university students enrolled for the first week (seedDemoStudents)`);
  }
  const t0 = performance.now(), day0 = w.day;
  // tick times of the last game day (the town is fullest then)
  const last: number[] = [];
  const n = Math.round(days * TICKS_PER_DAY);
  const crossingTicks = new Map<string, number>();
  const crossings: [number, number][] = [];
  for (const c of w.chunks.values()) for (let i = 0; i < c.tiles.length; i++) if (isCrossing(c.tiles[i], c.aux[i])) crossings.push([c.cx * CHUNK + (i % CHUNK), c.cy * CHUNK + Math.floor(i / CHUNK)]);
  // the underground and the river buses: trips by metro or ferry and changes between them and the other modes
  // (Transit.legsFor, as loadtest/metro.ts counts them), riders per train at its fullest, and each service's tick cost
  const tube = { trips: 0, changes: {} as Record<string, number>, peakLoad: 0, tickMs: 0 };
  const boats = { trips: 0, changes: {} as Record<string, number>, tickMs: 0, harbourMs: 0 };
  if (metro || ferry) {
    const tr = sim.transit as unknown as { legsFor(p: TransitPlan, ...a: number[]): unknown };
    const legsFor = tr.legsFor.bind(sim.transit);
    tr.legsFor = (p: TransitPlan, ...a: number[]) => {
      const r = legsFor(p, ...a);
      if (r) for (const [mode, c] of [['metro', tube], ['ferry', boats]] as const) {
        if (!p.rides.some((x) => x.line.mode === mode)) continue;
        c.trips++;
        for (let k = 1; k < p.rides.length; k++) {
          const m = [p.rides[k - 1].line.mode, p.rides[k].line.mode];
          if (m.includes(mode)) { const key = m.sort().join('-'); c.changes[key] = (c.changes[key] ?? 0) + 1; }
        }
      }
      return r;
    };
  }
  if (metro) { const mTick = metro.tick.bind(metro); metro.tick = () => { const t = performance.now(); mTick(); tube.tickMs += performance.now() - t; }; }
  if (ferry) { const fTick = ferry.tick.bind(ferry); ferry.tick = () => { const t = performance.now(); fTick(); boats.tickMs += performance.now() - t; }; }
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    sim.tick(); airports.tick();
    const h0 = performance.now();
    harbours.tick();
    boats.harbourMs += performance.now() - h0;
    for (const [x, y] of crossings) if (rail.barrierDown(x, y)) crossingTicks.set(`${x},${y}`, (crossingTicks.get(`${x},${y}`) ?? 0) + 1);
    if (i >= n - TICKS_PER_DAY) last.push(performance.now() - a);
    if (metro) for (let k = 0; k < metro.loads.length;) { const t = metro.loads[k + 1]; for (let q = 0; q < t; q++) tube.peakLoad = Math.max(tube.peakLoad, metro.loads[k + 2 + q]); k += 2 + t; }
  }
  Math.random = real;
  console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)} s, day ${w.day}, ${w.citizens.size} citizens, hash ${worldHash(w)}`);
  last.sort((a, b) => a - b);
  const avg = last.reduce((a, b) => a + b, 0) / (last.length || 1);
  console.log(`  tick over the last game day: avg ${avg.toFixed(1)} ms, p95 ${(last[Math.floor(last.length * 0.95)] ?? 0).toFixed(1)} ms, max ${(last[last.length - 1] ?? 0).toFixed(1)} ms`);
  console.log(`  population ${sim.population}, jobs ${sim.jobs}, employed ${sim.employed}`);
  // jobs by education (sim/skills.ts, docs/education.md section 7): places filled, skilled places filled, brain drain
  {
    const pc = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`;
    const f = sim.skills.fill(), st = sim.skills.stats;
    const adults = [...w.citizens.values()].filter((c) => c.stage === LifeStage.Adult), idle = adults.filter((c) => !c.job).length;
    console.log(`  jobs by education: ${Object.entries(f).map(([g, v]) => `${g} ${v.filled}/${v.places} ${pc(v.filled, v.places)} (skilled ${pc(v.skilledFilled, v.skilled)})`).join(', ')}`);
    console.log(`  unemployed adults ${idle}/${adults.length} ${pc(idle, adults.length)}, newcomers drawn for open skilled places ${st.matched}/${st.newcomers}, brain drain ${st.brainDrain}`);
  }
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
    const hb = harbours.describe(bld);
    if (hb) bits.push(`harbour: ${JSON.stringify({ ...hb, lanes: hb.lanes.length }).slice(0, 220)}`);
    console.log(`  ${(p.id ?? p.kind).padEnd(22)} ${KIND_NAMES[bld.id]}: ${bits.join(' · ')}`);
  }
  for (const l of sim.transit.lineInfos((i) => i)) console.log(`  line ${l.mode} ${l.number}: ${l.status || 'running'}, in service ${l.inService}, riders today ${l.ridersToday}, yesterday ${l.ridersYesterday}`);
  // the schools (docs/education.md, docs/demo.md "Schools in the demos"): who is enrolled where, how the day ran, the graduates
  if (sim.schools.list().length) {
    const stu = new Map<number, number>();
    let kids = 0, grads = 0, postgrads = 0;
    for (const c of w.citizens.values()) {
      if (c.study) stu.set(c.study, (stu.get(c.study) ?? 0) + 1);
      if (ageOf(c, w.tick) < 18) kids++;
      if (c.edu === EduLevel.Degree) grads++; else if (c.edu >= EduLevel.Postgrad) postgrads++;
    }
    const enrolled = [...stu.values()].reduce((a, b) => a + b, 0);
    console.log(`  schools: ${sim.schools.list().length} standing, ${kids} children and young people under 18, ${enrolled} enrolled (${[...stu].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${(STUDY_NAMES as Record<number, string>)[k]} ${n}`).join(', ') || 'none'})`);
    console.log(`  education levels: ${grads} citizens with a degree, ${postgrads} with a postgraduate degree; university students (degree and master's) ${(stu.get(Study.Degree) ?? 0) + (stu.get(Study.Postgrad) ?? 0)}; counters ${JSON.stringify({ pupils: w.players.get('sys')?.progress?.pupils, graduates: w.players.get('sys')?.progress?.graduates })}`);
    for (const sc of sim.schools.list()) {
      console.log(`  ${KIND_NAMES[sc.b.id].padEnd(26)} (${sc.b.x}, ${sc.b.y}): pupils ${sc.pupils}/${sim.schools.admittingOf(sc)} admitted of ${sc.spec.places + sc.spec.evening}, staff ${sc.staff}, teachers ${sc.teachers}/${sc.needed}, quality ${sc.quality.toFixed(2)}, waiting ${sc.waiting}, last results ${sc.passed} passed ${sc.failed} failed ${sc.dropped} dropped out`);
    }
    console.log(`  school events: ${JSON.stringify(sim.schools.events)}; life ${JSON.stringify({ graduations: sim.lifeEvents.graduations, dropOuts: sim.lifeEvents.dropOuts })}`);
    // higher and adult education, families moving in (E5, docs/education.md section 18)
    console.log(`  families moving in: ${JSON.stringify(sim.families.stats)}; learning: ${JSON.stringify(sim.learning.stats)}`);
  }
  console.log(`  freight: ${JSON.stringify(rail.freightStats)}`);
  console.log(`  transit: ${JSON.stringify(sim.transit.stats)}`);
  // the registry's features in use over the days run (docs/demo.md "Keeping it complete")
  const seeded = seededOf(w, airports, sim, harbours, adverts), runDays = Array.from({ length: w.day - day0 + 1 }, (_, d) => day0 + d);
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
  if (metro) {
    for (const l of metro.dtos()) console.log(`  metro ${l.name}: ${l.status}, ${l.running} of ${l.trains} trains running, headway ${l.headwayMin ?? '-'} min`);
    console.log(`  metro: ${tube.trips} trips planned by metro, changes ${JSON.stringify(tube.changes)}, peak train load ${tube.peakLoad}, Metro.tick ${(tube.tickMs / n).toFixed(3)} ms a tick`);
  }
  // the boats (docs/boats.md): the schedule over the days run (the harbours as they were, staffed or not), what the
  // harbours made of it, and the river buses
  if (harbours.list.length) {
    const hs = harbours.list;
    console.log(`  harbours: ${hs.length} (${hs.filter((h) => h.active).length} staffed), ${hs.reduce((k, h) => k + h.lanes.length, 0)} lanes, ${hs.filter((h) => h.refused?.length).length} with a refusal`);
    console.log(`  voyages by type, days ${day0}-${w.day}: ${JSON.stringify(count(runDays.flatMap((d) => boatTimetable(hs, d).voyages.map((v) => v.type))))}`);
    console.log(`  voyages by kind: ${JSON.stringify(count(runDays.flatMap((d) => boatTimetable(hs, d).voyages.map((v) => v.kind))))}`);
    for (const d of runDays) for (const [seed, ps] of boatLifts(hs, d)) {
      console.log(`  bascule lift seed ${seed}, day ${d}: ${ps.length} passage(s), ${ps.filter((p) => p.voyage.kind !== 'lift').map((p) => `${p.voyage.type} (${p.voyage.kind})`).join(', ') || 'only the lift barge'}`);
    }
    console.log(`  harbour totals: ${JSON.stringify({ ...harbours.totals, deriveMs: Math.round(harbours.totals.deriveMs) })}`);
    console.log(`  harbours today: ${JSON.stringify(harbours.today())}, Harbours.tick ${(boats.harbourMs / n).toFixed(3)} ms a tick`);
  }
  if (ferry) {
    for (const l of ferry.dtos()) console.log(`  river bus ${l.name}: ${l.status}, ${l.running} of ${l.trains} boats running, headway ${l.headwayMin ?? '-'} min`);
    console.log(`  ferry: ${boats.trips} trips planned by river bus, changes ${JSON.stringify(boats.changes)}, Ferry.tick ${(boats.tickMs / n).toFixed(3)} ms a tick`);
  }
}

console.log(failed ? `\n${failed} problem(s)` : '\ndemo check passed');
process.exit(failed ? 1 : 0);
