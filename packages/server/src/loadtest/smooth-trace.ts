/**
 * Trace a few drivers' speed tick by tick in the ab.ts test city (the smoothness diagnostic, docs/traffic-tuning.md
 * "Smooth flow"): per tick the distance moved, where it stands when standing (Traffic.standing) and the tile.
 *
 *   npx tsx packages/server/src/loadtest/smooth-trace.ts --hour 8 --seed 1 --cars 4 --set follow=1
 */
import { TICKS_PER_DAY, TICKS_PER_HOUR, TRAFFIC_TUNING } from '@msimcity/shared';
import { World, type Mover } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity } from './cities';
import { parseSet } from './ab';

const argv = process.argv.slice(2);
const get = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const hour = Number(get('hour') ?? 8), seed = Number(get('seed') ?? 1), want = Number(get('cars') ?? 4), ticks = Number(get('ticks') ?? 300);
let a = seed * 2654435761;
Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (const [k, v] of Object.entries(parseSet(get('set')))) if (k in TRAFFIC_TUNING) (TRAFFIC_TUNING as Record<string, number>)[k] = v;
const w = new World(seed);
seedCity(w, { districts: 1, built: 3 });
for (const id of w.parcels.keys()) w.recountRoads(id);
const sim = new Simulation(w), tr = sim.traffic;
while (w.tick < TICKS_PER_DAY + hour * TICKS_PER_HOUR) sim.tick();
const traced = new Map<number, { m: Mover; x: number; y: number; line: string[] }>();
for (let i = 0; i < ticks; i++) {
  sim.tick();
  for (const c of w.citizens.values()) {
    if (!(c.leg?.drive && c.lane >= 0)) continue;
    let t = traced.get(c.id);
    if (!t && traced.size < want && c.prog === 0) { t = { m: c, x: c.x, y: c.y, line: [] }; traced.set(c.id, t); continue; }
    if (!t) continue;
    const v = Math.hypot(c.x - t.x, c.y - t.y); t.x = c.x; t.y = c.y;
    t.line.push(v < 0.01 ? tr.standing(c)[0].toUpperCase() : String(Math.round(v * 20)).padStart(1));
  }
}
for (const [id, t] of traced) console.log(`#${id}: ${t.line.join(' ')}`);
console.log('(digits: speed in twentieths of a tile a tick, 10 = full speed; letters: standing at J junction line, L plain-road line, D destination, Q behind a car, O other)');
