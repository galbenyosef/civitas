/**
 * Gateways probe (sim/gateways.ts): seed the transport demo town (a motorway connection, a bus depot, rail stations
 * and an airport), fill it, then run on and print who came in and went out through which gate, the trip of one
 * newcomer and one leaver tile by tile, and the through-traffic and freight that used the motorway.
 *
 *   npx tsx packages/server/src/loadtest/gateways.ts [--days 2] [--demo transport]
 */
import { TICKS_PER_DAY, TICKS_PER_HOUR, DEMO_TOWN, KIND_NAMES, VehicleKind, isDemoId, tileKey, type DemoId } from '@msimcity/shared';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { Airports } from '../sim/airports';
import { Rail } from '../sim/rail';
import { MIG } from '../sim/gateways';
import { seedDemoTown, seedDemoNetwork, fillDemo, seededRandom } from '../demo/seed';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const days = Number(arg('days', '2'));
const demo: DemoId = isDemoId(arg('demo', 'transport')) ? (arg('demo', 'transport') as DemoId) : 'transport';

Math.random = seededRandom(DEMO_TOWN.seed);
const w = new World(DEMO_TOWN.seed);
const problems = seedDemoTown(w, demo);
const sim = new Simulation(w);
const airports = new Airports(w);
airports.onArrival = (a) => sim.gateways.planeLanded(a.terminal.doorX, a.terminal.doorY, a.passengers);
const rail = new Rail(w, sim.transit);
sim.transit.register(rail);
sim.freight = rail;
problems.push(...seedDemoNetwork(w, sim, rail, demo));
if (problems.length) console.log(`seed problems:\n  ${problems.join('\n  ')}`);
if (argv.includes('--no-gates')) sim.gateways.refresh = () => {}; // the old behaviour, for comparison
const step = () => { sim.tick(); airports.tick(); };
const t0 = performance.now();
const fill = await fillDemo(w, step, () => {});
console.log(`filled ${demo}: ${fill.pop} people after ${(fill.ticks / TICKS_PER_DAY).toFixed(2)} days (${((performance.now() - t0) / 1000).toFixed(0)} s)`);

const at = () => `day ${Math.floor(w.tick / TICKS_PER_DAY)} ${String(Math.floor((w.tick % TICKS_PER_DAY) / TICKS_PER_HOUR)).padStart(2, '0')}:${String(Math.floor(((w.tick % TICKS_PER_HOUR) / TICKS_PER_HOUR) * 60)).padStart(2, '0')}`;
const gateName = (x?: number, y?: number) => (x === undefined ? '?' : `${KIND_NAMES[w.buildings.get(tileKey(x, y!))?.id ?? 0]} (${x}, ${y})`);
let inbound: number | null = null, outbound: number | null = null;
const trace: string[] = [];
const lastPos = new Map<number, string>(), done = new Set<number>();
const totals0 = { ...sim.gateways.totals };
let motorwayVisitors = 0, imports = 0, exports = 0;
const seenV = new Set<number>(), onRoad = new Set<number>();
const motorwayDoors = new Set(sim.gateways.motorwayEntries().map(([x, y]) => `${x},${y}`));
const pop0 = w.citizens.size;
for (let t = 0; t < days * TICKS_PER_DAY; t++) {
  step();
  for (const c of w.citizens.values()) {
    if (inbound === null && c.mig === MIG.In) { inbound = c.id; trace.push(`${at()} newcomer ${c.id} appears at ${gateName(c.gx, c.gy)} for the home at (${c.hx}, ${c.hy}), ${c.leg?.drive ? (c.car ? 'driving their own car' : 'by taxi') : 'walking with a suitcase'}`); }
    if (outbound === null && c.mig === MIG.Out && c.leg) { outbound = c.id; trace.push(`${at()} leaver ${c.id} sets off from home (${c.hx}, ${c.hy}) for ${gateName(c.gx, c.gy)}, ${c.leg.drive ? 'driving' : 'walking with a suitcase'} (home has ${w.buildings.get(tileKey(c.hx, c.hy))?.occupants} occupants)`); }
  }
  for (const id of [inbound, outbound]) {
    if (id === null || done.has(id)) continue;
    const c = w.citizens.get(id);
    if (!c) { trace.push(`${at()} ${id === outbound ? 'leaver' : 'newcomer'} ${id} removed from the world`); done.add(id); continue; }
    if (w.tick % 25 === 0) {
      const p = `(${Math.floor(c.x)}, ${Math.floor(c.y)})`;
      if (lastPos.get(id) !== p) { trace.push(`${at()}   ${id === outbound ? 'leaver' : 'newcomer'} ${id} at ${p} mig=${c.mig ?? 0} state=${c.state}`); lastPos.set(id, p); }
    }
    if (id === inbound && !c.mig) { trace.push(`${at()} newcomer ${id} moved in at (${c.hx}, ${c.hy}); job: ${c.job ? KIND_NAMES[c.kind] : 'none yet'}`); done.add(id); }
  }
  for (const v of w.vehicles.values()) {
    if (v.vkind === VehicleKind.Visitor && v.lane >= 0) onRoad.add(v.id);
    if (seenV.has(v.id)) continue;
    seenV.add(v.id);
    const from = `${v.from[0]},${v.from[1]}`, to = `${v.to[0]},${v.to[1]}`;
    if (v.vkind === VehicleKind.Visitor) motorwayVisitors++;
    if (v.vkind === VehicleKind.Freight && motorwayDoors.has(from)) imports++;
    if (v.vkind === VehicleKind.Freight && motorwayDoors.has(to)) exports++;
  }
}
console.log(`\nran ${days} days: population ${pop0} -> ${w.citizens.size}`);
const tt = sim.gateways.totals;
console.log(`through gateways: ${tt.in - totals0.in} in, ${tt.out - totals0.out} out; spawned in place ${tt.fallbackIn - totals0.fallbackIn}, left without a gate ${tt.fallbackOut - totals0.fallbackOut}; unroutable ${sim.gateways.unroutable}`);
console.log('per gate (today / yesterday):');
for (const g of sim.gateways.list) console.log(`  ${gateName(g.x, g.y).padEnd(34)} ${g.spec.type.padEnd(8)} ${String(g.spec.perHour).padStart(3)}/h  in ${g.inToday}/${g.inYesterday}  out ${g.outToday}/${g.outYesterday}  waiting ${g.queue.length}`);
console.log(`motorway: ${motorwayVisitors} visitors set off (${onRoad.size} got onto the road (any entry), ${sim.traffic.counters.garageGiveUp} vehicles gave up waiting to pull out), ${imports} lorries brought goods in, ${exports} trucks took goods out`);
console.log(`\ntrace:\n${trace.slice(0, 120).join('\n')}`);
