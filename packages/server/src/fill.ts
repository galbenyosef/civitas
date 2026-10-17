import { TICKS_PER_DAY, TICKS_PER_HOUR } from '@msimcity/shared';
import type { World } from './world';

/** Let other work run between slices of a fast-fill: setImmediate in Node (so /healthz keeps answering), a zero timeout elsewhere. */
export const yieldNow = () => new Promise<void>((r) => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)));

/**
 * Grow a freshly seeded city before it accepts clients (test cities, testcities.ts; demos, demo/seed.ts fillDemo). Runs the
 * simulation in a tight loop (a slice of one game hour, then a yield) until the population stops growing (under 0.5% an hour
 * for three hours, after at least six) or `maxDays` game days have passed, as the load-test harness does.
 * Pure: no Node APIs, so a local-mode worker (docs/local-mode.md) can fill a sandbox city too.
 */
export async function fillCity(w: World, step: () => void, onProgress: (p: { tick: number; of: number; pop: number }) => void, maxDays = 1.5) {
  const of = Math.round(maxDays * TICKS_PER_DAY);
  let prev = 0, flat = 0, hours = 0, ticks = 0;
  const t0 = performance.now();
  w.filling = true; // newcomers move straight in while the town fills, not at a gateway's hourly rate (sim/gateways.ts)
  while (ticks < of) {
    for (let i = 0; i < TICKS_PER_HOUR && ticks < of; i++, ticks++) step();
    hours++;
    const pop = w.citizens.size;
    flat = pop - prev <= Math.max(3, pop * 0.005) ? flat + 1 : 0;
    prev = pop;
    onProgress({ tick: ticks, of, pop });
    if (hours >= 6 && flat >= 3) break;
    await yieldNow();
  }
  w.filling = false;
  return { ticks, pop: w.citizens.size, seconds: (performance.now() - t0) / 1000, settled: flat >= 3 };
}
