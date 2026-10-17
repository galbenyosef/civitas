import { TICK_MS, ALL_TECH_IDS, ECONOMY_TUNING } from '@msimcity/shared';
import type { World } from './world';
import { Simulation } from './sim/simulation';
import { Airports } from './sim/airports';
import { Rail } from './sim/rail';
import { Net, type GameConfig } from './net';
import type { ConnSource } from './transport';
import { TickWindow } from './tickstats';

export type { GameConfig };

/**
 * One running game, whatever hosts it: index.ts on the server (WebSockets, a JSON file, setInterval) or a local-mode
 * worker (a MessagePort, IndexedDB, its own clock; docs/local-mode.md). Pure: no Node APIs. The host makes or loads the
 * World, picks the transport and the config, and calls `loop()` once every TICK_MS.
 */
export interface Game {
  world: World;
  sim: Simulation;
  /** planes: landing fees from the shared flight schedule, and terminal tooltips (sim/airports.ts) */
  airports: Airports;
  /** railways (sim/rail.ts): trains are the 'rail' mode of the transit registry, which plans riders and collects fares */
  rail: Rail;
  net: Net;
  /** tick time over the last minute (300 loops), for the stats message, /healthz and the client's perf readout */
  tickWin: TickWindow;
  /** simulation ticks per loop (SIM_STEPS on the server: fast-forward; local mode's speed later) */
  steps: number;
  /** one simulation tick and its frame to clients, without the loop's bookkeeping (fast-fills) */
  step(): void;
  /** the main loop body: `steps` ticks, one frame to clients, tick-time stats; returns the elapsed ms */
  loop(): number;
}

/** ECON=name=value,... overrides ECONOMY_TUNING (shared/src/tuning.ts) for an offline economy run. */
export function tuneEconomy(spec: string) {
  for (const kv of spec.split(',').filter(Boolean)) { const [k, v] = kv.split('='); if (k in ECONOMY_TUNING) (ECONOMY_TUNING as Record<string, number>)[k] = Number(v); }
}

/** Wire a loaded or freshly seeded World into a running game: the simulation, airports, rail and the protocol over `source`. */
export function createGame(world: World, source: ConnSource, cfg: GameConfig, steps = 1): Game {
  for (const id of world.parcels.keys()) world.recountRoads(id);
  // the Commons has every technology (seed.ts, loadtest/cities.ts); top it up when the tree has grown since the world was saved
  const commons = world.players.get('sys');
  if (commons) commons.tech = [...new Set([...commons.tech, ...ALL_TECH_IDS])];
  const sim = new Simulation(world);
  const airports = new Airports(world);
  // some of every plane's passengers are moving here: they top up the terminal gateway's arrivals (sim/gateways.ts)
  airports.onArrival = (a) => sim.gateways.planeLanded(a.terminal.doorX, a.terminal.doorY, a.passengers);
  const rail = new Rail(world, sim.transit);
  sim.transit.register(rail);
  sim.transit.sandbox = sim.buses.sandbox = rail.sandbox = cfg.sandbox; // lines are anyone's to edit in a sandbox
  // rail freight: deliveries from industry near a freight yard go by train when a freight line reaches a yard near the shop
  sim.freight = rail;
  rail.trucks = { spawn: (from, to, owner) => sim.spawnFreightTruck(from, to, owner) };
  sim.traffic.barrier = (x, y) => rail.barrierDown(x, y); // level crossings: traffic waits while a train passes
  const net = new Net(world, sim, source, cfg);
  net.airports = airports;
  net.rail = rail;
  const tickWin = new TickWindow(300);
  let slow = 0, loops = 0;
  const game: Game = {
    world, sim, airports, rail, net, tickWin, steps,
    step() { sim.tick(); airports.tick(); net.flush(); },
    loop() {
      const t0 = performance.now();
      for (let i = 0; i < game.steps; i++) { sim.tick(); airports.tick(); }
      net.flush();
      const dt = performance.now() - t0;
      tickWin.push(dt);
      if (++loops % 5 === 0) net.tickStats = tickWin.summary(); // once a second; sent with the next stats message
      if (dt > TICK_MS * 0.8 && ++slow % 25 === 1) console.warn(`slow tick: ${dt.toFixed(1)}ms with ${world.citizens.size} citizens`);
      return dt;
    },
  };
  return game;
}
