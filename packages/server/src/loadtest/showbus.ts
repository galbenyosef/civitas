/**
 * The Showcase's bus lane, measured (R5, docs/traffic-tuning.md "Traffic control"): bus line 4 runs round the one-way pair
 * in the Road classes section, along North Parade's bus lane. This builds the Showcase as demo:check does, fills it as a
 * visitor finds it (fillDemo), then runs `--hours` game hours and times line 4's buses: the lap (from moving on from a
 * call to moving on from it again, every call) and the North Parade leg (moving on from its first call to moving on from its second, along the bus lane). Each seed is
 * run with the bus lane and again with it taken off North Parade before the fill; the two runs differ only in that.
 *
 *   npx tsx packages/server/src/loadtest/showbus.ts --seeds 1,2 --hours 24
 */
import { TICKS_PER_HOUR, StreetRule } from '@msimcity/shared';
import { World, untkey } from '../world';
import { Simulation } from '../sim/simulation';
import { Airports } from '../sim/airports';
import { Rail } from '../sim/rail';
import { Harbours } from '../sim/harbours';
import { seedDemoTown, seedDemoNetwork, seededRandom, fillDemo } from '../demo/seed';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = arg('seeds', '1,2').split(',').map(Number), HOURS = Number(arg('hours', '24'));

interface Bus { v: { id: number; lane: number }; line: number; call: number; phase: string }
async function run(seed: number, lane: boolean) {
  Math.random = seededRandom(seed * 7919 + 7);
  const w = new World(7);
  seedDemoTown(w, 'showcase');
  if (!lane) w.setStreetRules([...w.streetBits].filter(([, b]) => b & StreetRule.BusLane).map(([k]) => untkey(k)), StreetRule.BusLane, false);
  const sim = new Simulation(w), airports = new Airports(w), rail = new Rail(w, sim.transit);
  sim.transit.register(rail); sim.freight = rail;
  rail.trucks = { spawn: (from, to, owner) => sim.spawnFreightTruck(from, to, owner) };
  sim.traffic.barrier = (x, y) => rail.barrierDown(x, y);
  seedDemoNetwork(w, sim, rail, 'showcase');
  const harbours = new Harbours(w, sim);
  await fillDemo(w, () => { sim.tick(); airports.tick(); harbours.tick(); }, () => {});
  const line = [...w.transitLines.values()].find((l) => l.mode === 'bus' && l.number === 4);
  if (!line) throw new Error('no bus line 4 in the Showcase');
  const buses = (sim.buses as unknown as { buses: Map<number, Bus> }).buses;
  // per bus, the tick it last moved on from each call: a lap is the time from moving on from a call to doing so again
  const prev = new Map<number, number>(), left = new Map<string, number>(), laps: number[] = [], legs: number[] = [];
  const end = w.tick + HOURS * TICKS_PER_HOUR;
  while (w.tick < end) {
    sim.tick(); airports.tick(); harbours.tick();
    for (const b of buses.values()) {
      if (b.line !== line.id || b.phase !== 'service') continue;
      const was = prev.get(b.v.id);
      prev.set(b.v.id, b.call);
      if (was === undefined || was === b.call) continue;
      const k = `${b.v.id}:${was}`, l = left.get(k);
      if (l !== undefined) laps.push(w.tick - l);
      left.set(k, w.tick);
      // the North Parade leg: moving on from the first call to moving on from the second, along the bus lane
      if (was === 1) { const l0 = left.get(`${b.v.id}:0`); if (l0 !== undefined && w.tick - l0 < 1000) legs.push(w.tick - l0); }
    }
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  return { laps: laps.length, lap: mean(laps), legs: legs.length, leg: mean(legs), busLaneTiles: [...w.streetBits.values()].filter((b) => b & StreetRule.BusLane).length };
}

console.log(`Showcase bus line 4, ${HOURS} game hours after the fill, seeds ${SEEDS.join(',')}`);
console.log('| seed | bus lane | tiles | laps | lap (ticks) | North Parade legs | leg (ticks) |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const seed of SEEDS) for (const lane of [false, true]) {
  const r = await run(seed, lane);
  console.log(`| ${seed} | ${lane ? 'on' : 'off'} | ${r.busLaneTiles} | ${r.laps} | ${r.lap.toFixed(1)} | ${r.legs} | ${r.leg.toFixed(1)} |`);
}
