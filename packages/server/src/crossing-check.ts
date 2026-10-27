/**
 * `npm run crossing:check` (docs/traffic-tuning.md "Crossings: the wobble"): one street, one car, one walker crossing
 * it from a door. The car stops with its body over the walker's line (held there, as a queue would hold it) and is let
 * go some ticks later; the walker comes out of the door before, as or after it stops. Under the rule as shipped
 * (TRAFFIC_TUNING.pedRetreatOnce) the walker never goes back and forth on the crossing more than once (at most two
 * reversals: back, then on), never steps into the car's body, and is over within a few ticks of the car going. Under
 * the old rule (pedRetreatOnce 0) the same scenes must still show the wobble, or the bench no longer builds it.
 *
 *   npx tsx packages/server/src/crossing-check.ts [--verbose]
 */
import { Terrain, TRAFFIC_TUNING, packTile } from '@msimcity/shared';
import { World, type Mover, type Citizen } from './world';
import { Simulation } from './sim/simulation';
import type { Traffic } from './sim/traffic';

const verbose = process.argv.includes('--verbose');
let failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };

interface Scene { dir: 1 | -1; hold: number; walkAt: number; at: number }
interface Out { reversals: number; retreats: number; over: number; overAfterGo: number; touched: number; inside: number }

/** one scene: the street y = 0 from x = -8 to 8, a door at (0, -1) north of it; the walker goes from the door to (3, 0) */
function play(sc: Scene): Out {
  const w = new World(7);
  for (let y = -4; y <= 4; y++) for (let x = -10; x <= 10; x++) w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0));
  for (let x = -8; x <= 8; x++) w.setTile(x, 0, packTile(Terrain.Grass, true, 0, 0));
  const sim = new Simulation(w);
  const priv = sim as unknown as { traffic: Traffic; walk(c: Citizen): boolean; startWalking(m: Mover): void };
  const t = priv.traffic;
  // the car: along the street, stepped until its body covers the walker's line at `at` tiles out from the near kerb
  const car = { id: 1, x: 0, y: 0, path: [] as number[], pi: 0, ...w.moverDefaults(1) } as Mover;
  for (let x = -8 * sc.dir; x !== 9 * sc.dir; x += sc.dir) car.path.push(x, 0);
  const walker = { id: 2, x: 0, y: 0, path: [0, -1, 0, 0, 1, 0, 2, 0, 3, 0], pi: 0, stage: 0, ...w.moverDefaults(2) } as unknown as Citizen;
  priv.startWalking(walker);
  const pts = walker.pts!, cross = walker.cross!;
  const j = cross.findIndex((k) => k !== 0); // the crossing: from point j - 1 (the near kerb) to point j (the far kerb)
  const kx = pts[(j - 1) * 2], ky = pts[(j - 1) * 2 + 1], fx = pts[j * 2], fy = pts[j * 2 + 1];
  const len = Math.hypot(fx - kx, fy - ky), ux = (fx - kx) / len, uy = (fy - ky) / len;
  const doorX = walker.x, doorY = walker.y;
  // park the walker inside until it is time to come out
  const out: Out = { reversals: 0, retreats: 0, over: -1, overAfterGo: -1, touched: 0, inside: 0 };
  let tick = 0, stopped = -1, went = -1, entered = false, s0 = 0, dir = 0;
  const r0 = t.counters.pedRetreat;
  for (; tick < 600; tick++) {
    w.tick++;
    t.beginTick();
    if (tick >= sc.walkAt && out.over < 0) {
      priv.walk(walker);
      // progress along the crossing, once off the near kerb, until past the far one
      const pp = walker.pp;
      if (pp === j || (pp > j && out.over < 0)) {
        const s = pp > j ? len : (walker.x - kx) * ux + (walker.y - ky) * uy;
        const ds = s - s0;
        if (Math.abs(ds) > 1e-6) { const d = ds > 0 ? 1 : -1; if (dir && d !== dir) out.reversals++; dir = d; }
        s0 = s;
        if (pp > j) { out.over = tick; if (went >= 0) out.overAfterGo = tick - went; }
      }
      if (t.carBodyAt(walker.x, walker.y) && !(walker.x === doorX && walker.y === doorY)) out.inside++;
    } else if (tick < sc.walkAt) { walker.x = doorX; walker.y = doorY; }
    if (!entered) entered = t.enter(car) === 'ok';
    else if (stopped < 0) {
      t.step(car);
      if (t.carBodyAt(kx + ux * sc.at * len, ky + uy * sc.at * len)) stopped = tick;
    } else if (tick - stopped >= sc.hold) {
      if (went < 0) went = tick;
      t.step(car);
    }
    t.endTick();
    if (verbose) console.log(`  t${tick} walker (${walker.x.toFixed(2)},${walker.y.toFixed(2)}) pp ${walker.pp} wait ${walker.wait} | car (${car.x.toFixed(2)},${car.y.toFixed(2)}) lane ${car.lane} wait ${car.wait}${stopped === tick ? ' stops' : ''}${went === tick ? ' goes' : ''}`);
    if (out.over >= 0 && went >= 0) break;
  }
  out.retreats = t.counters.pedRetreat - r0;
  return out;
}

const scenes: Scene[] = [];
for (const dir of [1, -1] as const) for (const at of [0.3, 0.5, 0.7]) for (const hold of [15, 40, 90]) for (const walkAt of [0, 10, 25]) scenes.push({ dir, at, hold, walkAt });

function run(mode: number) {
  TRAFFIC_TUNING.pedRetreatOnce = mode;
  const res = scenes.map((sc) => ({ sc, o: play(sc) }));
  const wob = res.filter((r) => r.o.reversals >= 3).length;
  const maxRev = Math.max(...res.map((r) => r.o.reversals)), maxRet = Math.max(...res.map((r) => r.o.retreats));
  const notOver = res.filter((r) => r.o.over < 0).length;
  const late = Math.max(...res.map((r) => r.o.overAfterGo));
  const inside = res.reduce((a, r) => a + r.o.inside, 0);
  console.log(`pedRetreatOnce ${mode}: ${res.length} scenes, ${res.filter((r) => r.o.retreats > 0).length} with a step back, ${wob} with 3+ reversals (most ${maxRev}), most steps back ${maxRet}, not over ${notOver}, over at most ${late} ticks after the car went, ticks inside a car body ${inside}`);
  if (verbose) for (const r of res) console.log(`  ${JSON.stringify(r.sc)} -> ${JSON.stringify(r.o)}`);
  return { res, wob, maxRev, notOver, late, inside };
}

const shipped = TRAFFIC_TUNING.pedRetreatOnce;
const old = run(0);
ok(old.wob > 0, `the old rule (pedRetreatOnce 0) wobbles in this bench: ${old.wob} scenes with 3+ reversals`);
const now = run(shipped);
ok(shipped !== 0, `the shipped rule is not the old one (pedRetreatOnce ${shipped})`);
ok(now.maxRev <= 2, `under the shipped rule a walker reverses at most twice on the crossing (most ${now.maxRev})`);
ok(now.notOver === 0, `every walker gets over (${now.notOver} did not)`);
ok(now.late <= 30, `and within 30 ticks of the car going (at most ${now.late})`);
ok(now.inside === 0, `no walker ever stands inside the car's body (${now.inside} ticks)`);
TRAFFIC_TUNING.pedRetreatOnce = shipped;
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
