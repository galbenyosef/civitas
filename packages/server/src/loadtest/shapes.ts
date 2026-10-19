/**
 * Hidden classes of the movers (docs/search-perf.md, the traffic step): how many V8 maps the citizens and vehicles have
 * after a fill, after the world is saved and loaded again (snapshot.ts), and after a day on from that. Past four, every
 * read of a mover's fields in the traffic step is megamorphic (about nine times slower); dictionary mode is slower still.
 *
 *   node --allow-natives-syntax --loader tsx packages/server/src/loadtest/shapes.ts [--demo london | --districts 3]
 */
import { isDemoId, TICKS_PER_DAY, type DemoId } from '@msimcity/shared';
import { probeGame } from './probe-city';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { createGame } from '../game';
import type { World } from '../world';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
let natives: { fast: (a: object) => boolean; same: (a: object, b: object) => boolean };
try {
  natives = { fast: new Function('a', 'return %HasFastProperties(a)') as never, same: new Function('a', 'b', 'return %HaveSameMap(a, b)') as never };
} catch { console.error('shapes.ts: run node with --allow-natives-syntax --loader tsx (tsx\'s own cli drops the flag)'); process.exit(1); }
const count = (w: World, label: string) => {
  const reps: object[] = [];
  let slow = 0, driving = 0;
  for (const o of [...w.citizens.values(), ...w.vehicles.values()]) {
    if (!natives.fast(o)) slow++;
    else if (!reps.some((r) => natives.same(r, o))) reps.push(o);
    if (o.lane >= 0) driving++;
  }
  console.log(`${label}: ${w.citizens.size} citizens and ${w.vehicles.size} vehicles (${driving} driving): ${reps.length} hidden classes, ${slow} in dictionary mode`);
};
const districts = Number(arg('districts', '0'));
const demo: DemoId | null = districts ? null : isDemoId(arg('demo', 'london')) ? (arg('demo', 'london') as DemoId) : 'london';
const { game } = await probeGame(demo, districts);
count(game.world, 'filled');
const w2 = worldFromSnapshot(JSON.parse(JSON.stringify(snapshotOf(game.world))))!;
count(w2, 'saved and loaded');
const g2 = createGame(w2, { onConnection() {} }, { devTools: false, sandbox: true });
for (let i = 0; i < TICKS_PER_DAY; i++) g2.step();
count(w2, 'a day after loading');
process.exit(0);
