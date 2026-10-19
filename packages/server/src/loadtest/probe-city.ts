/**
 * The London demo or a seedCity test city for probes that fill it tick by tick. `probeCity` sets up the simulation with
 * airports, rail, freight and the demo's transit network (jobsearch.ts); `probeGame` builds the whole game as the demo
 * and test-city children do (index.ts: createGame, so metro, ferries, harbours, finance, issues and the network flush,
 * with no clients), and fills it with `game.step` (searchprof.ts). Both seed Math.random first, so two runs with the same
 * arguments play the same game.
 */
import { DEMO_TOWN, type DemoId } from '@msimcity/shared';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { Airports } from '../sim/airports';
import { Rail } from '../sim/rail';
import { seedDemoTown, seedDemoNetwork, seedDemoStudents, fillDemo, seededRandom } from '../demo/seed';
import { createGame, type Game } from '../game';
import type { ConnSource } from '../transport';
import { fillCity } from '../testcities';
import { seedCity } from './cities';

export interface ProbeCity {
  w: World; sim: Simulation; airports: Airports; rail: Rail; label: string;
  /** fill it as the demo or test-city child does, calling `step` for every tick */
  fill(step: () => void): Promise<{ pop: number; ticks: number }>;
}

export function probeCity(demo: DemoId | null, districts: number): ProbeCity {
  Math.random = seededRandom(DEMO_TOWN.seed);
  const w = new World(DEMO_TOWN.seed);
  if (demo) { const p = seedDemoTown(w, demo); if (p.length) console.log(`seed problems:\n  ${p.join('\n  ')}`); }
  else seedCity(w, { districts, built: 3 });
  const sim = new Simulation(w);
  const airports = new Airports(w);
  airports.onArrival = (a) => sim.gateways.planeLanded(a.terminal.doorX, a.terminal.doorY, a.passengers);
  const rail = new Rail(w, sim.transit);
  sim.transit.register(rail);
  sim.freight = rail;
  rail.trucks = { spawn: (from, to, owner) => sim.spawnFreightTruck(from, to, owner) };
  if (demo) { const p = seedDemoNetwork(w, sim, rail, demo); if (p.length) console.log(`network problems:\n  ${p.join('\n  ')}`); }
  return {
    w, sim, airports, rail, label: demo ?? `${districts}×${districts}`,
    fill: (step) => (demo ? fillDemo(w, step, () => {}) : fillCity(w, step, () => {})),
  };
}

/**
 * The demo or test city as its child process runs it (index.ts), filled the same way (and a demo's students enrolled).
 * `source` stands in for the sockets (by default nobody ever connects).
 */
export async function probeGame(demo: DemoId | null, districts: number, source: ConnSource = { onConnection() {} }): Promise<{ game: Game; label: string; fill: { pop: number; ticks: number } }> {
  Math.random = seededRandom(DEMO_TOWN.seed);
  const w = new World(DEMO_TOWN.seed);
  if (demo) { const p = seedDemoTown(w, demo); if (p.length) console.log(`seed problems:\n  ${p.join('\n  ')}`); }
  else seedCity(w, { districts, built: 3 });
  const game = createGame(w, source, { devTools: false, sandbox: true });
  if (demo) { const p = seedDemoNetwork(w, game.sim, game.rail, demo); if (p.length) console.log(`network problems:\n  ${p.join('\n  ')}`); }
  const fill = demo ? await fillDemo(w, game.step, () => {}) : await fillCity(w, game.step, () => {});
  if (demo) seedDemoStudents(w, game.sim, demo);
  return { game, label: demo ?? `${districts}×${districts}`, fill };
}
