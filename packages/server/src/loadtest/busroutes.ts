/**
 * Bus routing check (docs/transit.md "The lap"): small road layouts where a bus has to turn round, lines over them,
 * and buses driven round for half a day under the real traffic model.
 *
 *   npx tsx packages/server/src/loadtest/busroutes.ts [--hours 10] [--only stub,comb] [--request] [--why]
 *
 * Each scenario is its own little network with its own depot, far from the others:
 *
 *  - street: one straight street, dead ends at both ends, nothing else (the bus turns at the ends);
 *  - stub: a ring of streets with a one-tile stub and a two-tile stub off it, stops at the stubs' ends;
 *  - comb: a street with dead-end streets off it like the teeth of a comb (the onboarding bot's layout), stops on the
 *    teeth, two of them next to each other on one tooth;
 *  - ring: a street with a roundabout at one end and a dead end at the other (the bus should go round the roundabout);
 *  - broken: two streets that do not meet, and a stop facing a junction (lines refused, with a fix and tiles to mark).
 *
 * Asserted: every line that should route does, every lap is continuous (each node beside the next) and turns round
 * only at a dead end, a junction, or the depot; the depot reaches every lap; buses run whole laps (at least two each)
 * and none is withdrawn as stuck; refused lines name the stops and say how to fix them. Nobody rides, so every bus
 * pulls in at every stop as if someone were waiting (`--request`: only as request stops, i.e. never). `--why` logs
 * each withdrawn bus and what was round it.
 */
import { TICKS_PER_HOUR, Terrain, BUS_STOP_KIND, BUS_DEPOT_KIND, packTile, familyOf, subFor, planStructure, planRoundabout, problemText, type StopRef } from '@msimcity/shared';
import { World, tkey } from '../world';
import { Simulation } from '../sim/simulation';
import { isReversal } from '../sim/busroute';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const HOURS = Number(arg('hours', '10'));
const ONLY = arg('only', '').split(',').filter(Boolean);

const w = new World(7);
const road = (x: number, y: number) => w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0));
const line = (x0: number, y0: number, x1: number, y1: number) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) road(x, y); };
const stop = (x: number, y: number): StopRef => { w.setTile(x, y, packTile(Terrain.Grass, false, familyOf(BUS_STOP_KIND), 1), subFor(BUS_STOP_KIND)); return { x, y }; };
/** a depot whose door is (x, y), its 3×2 body north of the door */
const depot = (x: number, y: number) => {
  const v = planStructure(BUS_DEPOT_KIND, x, y, { tile: (a, b) => w.peekTile(a, b), aux: (a, b) => w.auxAt(a, b), sub: (a, b) => w.subAt(a, b), land: () => null });
  if (!v.ok) throw new Error(`depot at ${x},${y}: ${v.reason}`);
  w.placeStructure(v.placed!, { work: 0, priority: 0, built: true });
};
// clear the ground
for (let y = -10; y < 40; y++) for (let x = -10; x < 260; x++) w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0));

interface Case { name: string; stops: StopRef[]; loop: boolean; expect: 'ok' | 'refused'; turns?: string }
const cases: Case[] = [];

// street: x 0..20 on y 5, dead ends at both ends; depot door (10, 4) above it
{
  line(0, 5, 20, 5); depot(10, 4);
  const a = stop(2, 6), b = stop(9, 6), c = stop(18, 6);
  cases.push({ name: 'street there and back', stops: [a, b, c], loop: false, expect: 'ok', turns: 'dead end' });
  cases.push({ name: 'street loop', stops: [a, c], loop: true, expect: 'ok', turns: 'dead end' });
}
// stub: a ring x 40..60, y 5..15; a one-tile stub at (45, 4) and a two-tile stub at (52, 3..4); depot inside the ring
{
  const X = 40;
  line(X, 5, X + 20, 5); line(X, 15, X + 20, 15); line(X, 5, X, 15); line(X + 20, 5, X + 20, 15);
  road(X + 5, 4); line(X + 12, 3, X + 12, 4);
  depot(X + 10, 14);
  const s1 = stop(X + 5, 3), s2 = stop(X + 13, 3), s3 = stop(X + 10, 16);
  cases.push({ name: 'one-tile stub loop', stops: [s1, s3], loop: true, expect: 'ok', turns: 'dead end' });
  cases.push({ name: 'two stubs there and back', stops: [s1, s2, s3], loop: false, expect: 'ok', turns: 'dead end' });
}
// comb: street y 12, x 80..110, closed into a loop by y 20; teeth north at x 84, 91, 98, 105 (y 6..11)
{
  const X = 80;
  line(X, 12, X + 30, 12); line(X, 20, X + 30, 20); line(X, 12, X, 20); line(X + 30, 12, X + 30, 20);
  for (const t of [4, 11, 18, 25]) line(X + t, 6, X + t, 11);
  depot(X + 15, 19);
  const t1 = stop(X + 4, 5), t2 = stop(X + 12, 8), t3 = stop(X + 19, 6), n1 = stop(X + 26, 7), n2 = stop(X + 26, 8);
  cases.push({ name: 'comb there and back', stops: [t1, t3], loop: false, expect: 'ok', turns: 'dead end' });
  cases.push({ name: 'comb loop of three teeth', stops: [t1, t2, t3], loop: true, expect: 'ok' });
  cases.push({ name: 'comb neighbours on one tooth', stops: [n1, n2], loop: false, expect: 'ok', turns: 'dead end' });
  cases.push({ name: 'comb neighbours loop', stops: [n1, n2], loop: true, expect: 'ok' });
}
// ring: street x 130..150 on y 10; a crossroads at 150 made a roundabout (arms 3 long); a dead end at 130
{
  const X = 130;
  line(X, 10, X + 153 - 130, 10); line(X + 20, 7, X + 20, 13);
  const env = { tile: (a: number, b: number) => w.getTile(a, b), aux: (a: number, b: number) => w.auxAt(a, b), land: () => null };
  const plan = planRoundabout(X + 20, 10, env);
  if (!plan.ok) throw new Error(`roundabout: ${plan.reason}`);
  w.placeJunction(plan.tiles!);
  depot(X + 10, 9);
  const a = stop(X + 4, 11), b = stop(X + 15, 11);
  cases.push({ name: 'roundabout there and back', stops: [a, b], loop: false, expect: 'ok', turns: 'dead end' });
}
// broken: two streets that never meet; a stop facing a junction
{
  const X = 180;
  line(X, 5, X + 10, 5); line(X + 14, 5, X + 24, 5); depot(X + 5, 4);
  const a = stop(X + 3, 6), b = stop(X + 20, 6);
  cases.push({ name: 'no road between', stops: [a, b], loop: false, expect: 'refused' });
}
{
  const X = 220;
  line(X, 5, X + 12, 5); line(X + 6, 6, X + 6, 9); depot(X + 2, 4);
  const j = stop(X + 6, 4), b = stop(X + 11, 6);
  cases.push({ name: 'stop facing a junction', stops: [j, b], loop: false, expect: 'refused' });
}

const sim = new Simulation(w);
sim.transit.sandbox = true; sim.buses.sandbox = true;
// no citizens here: every depot has drivers on shift
const svc = sim.buses as unknown as { drivers: Map<number, number>; countDrivers(): void; buses: Map<number, BusState>; stats: Record<string, number> };
interface BusState { line: number; call: number; phase: string; v: { id: number; x: number; y: number } }
svc.countDrivers = function () { for (const b of w.builtOf(15)) if (b.id === BUS_DEPOT_KIND) this.drivers.set(tkey(b.x, b.y), 99); };
// nobody rides here: unless --request, every bus pulls in at every stop as if someone were waiting (dwelling at a
// dead-end stop is the hard case: the bus stands in the middle of its turn)
if (!argv.includes('--request')) (sim.transit as unknown as { wantsCall(): boolean }).wantsCall = () => true;
w.tick = 6 * TICKS_PER_HOUR;

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`  FAIL ${what}`); } };
const lineOf = new Map<number, Case>(), estimate = new Map<number, number>();
let n = 0;
for (const c of cases) {
  if (ONLY.length && !ONLY.some((o) => c.name.includes(o))) continue;
  const pv = sim.transit.previewLine('sys', { stops: c.stops, loop: c.loop }, ++n);
  const r = sim.transit.saveLine('sys', { number: n, colour: 0xff8800, stops: c.stops, loop: c.loop, vehicles: 2 });
  if (c.expect === 'refused') {
    check(typeof r === 'string', `${c.name}: should be refused`);
    check(!!pv.problem?.fatal && !!pv.problem.fix && (pv.problem.tiles.length > 0 || !!pv.problem.suggest), `${c.name}: preview names a fix and tiles`);
    console.log(`${c.name}: refused: ${typeof r === 'string' ? r : '(saved!)'}\n  marked ${(pv.problem?.tiles.length ?? 0) / 2} tiles${pv.problem?.suggest ? `, suggests ${pv.problem.suggest}` : ''}, leg ${pv.problem?.leg ?? '-'}`);
    continue;
  }
  if (typeof r === 'string') { check(false, `${c.name}: refused: ${r}`); continue; }
  lineOf.set(r.id, c);
  const route = sim.transit.routeOf(r.id)!;
  const p = route.path, L = p.length / 2;
  let cont = true, badTurn = false;
  const kinds: string[] = [];
  for (let i = 0; i < L; i++) {
    const j = (i + 1) % L;
    if (Math.abs(p[i * 2] - p[j * 2]) + Math.abs(p[i * 2 + 1] - p[j * 2 + 1]) !== 1) cont = false;
  }
  for (let t = 0; t < pv.turns.length; t += 3) kinds.push(['dead end', 'junction', 'depot'][pv.turns[t + 2]]);
  for (let i = 0; i < L; i++) if (isReversal(p, i) && !kinds.length) badTurn = true;
  check(cont, `${c.name}: lap not continuous`);
  check(!badTurn, `${c.name}: turns round with no turn recorded`);
  check(sim.buses.lapValid(route), `${c.name}: lap not valid against the map`);
  check(!pv.problem, `${c.name}: preview problem ${pv.problem ? problemText(pv.problem) : ''}`);
  if (c.turns) check(kinds.includes(c.turns), `${c.name}: expected a turn at a ${c.turns}, got ${kinds.join(', ') || 'none'}`);
  estimate.set(r.id, pv.lapTicks);
  console.log(`${c.name}: ${L} tiles a lap, ~${Math.round((pv.lapTicks * 60) / TICKS_PER_HOUR)} min round, turns: ${kinds.join(', ') || 'none (drives round)'}`);
}

// drive them
if (argv.includes('--why')) {
  const s2 = sim.buses as unknown as { withdraw(b: unknown): void };
  const orig = s2.withdraw.bind(s2);
  s2.withdraw = (b: unknown) => {
    const x = b as BusState & { v: { pi: number; path: number[]; stuck: number; wait: number; lane: number; prog: number; committed: boolean } };
    const v = x.v, around = v.path.slice(Math.max(0, (v.pi - 3) * 2), (v.pi + 4) * 2);
    console.log(`withdraw t${w.tick} line ${lineOf.get(x.line)?.name} phase ${x.phase} at ${v.x.toFixed(2)},${v.y.toFixed(2)} pi ${v.pi} prog ${v.prog.toFixed(2)} stuck ${v.stuck} lane ${v.lane % 4} path ${around}`);
    for (const o of svc.buses.values()) {
      const u = o.v as unknown as typeof v;
      if (Math.abs(u.x - v.x) + Math.abs(u.y - v.y) > 8 || o === x) continue;
      console.log(`   bus ${u.id} ${lineOf.get(o.line)?.name} ${o.phase} at ${u.x.toFixed(2)},${u.y.toFixed(2)} lane dir ${u.lane % 4} prog ${u.prog.toFixed(2)} committed ${u.committed} stuck ${u.stuck} next ${u.path.slice(u.pi * 2, (u.pi + 3) * 2)}`);
    }
    orig(b);
  };
}
const laps = new Map<number, number>(), lastCall = new Map<number, number>(), seen = new Set<number>(), busLine = new Map<number, number>();
/** per bus, the tick it last came round to call 0; per line, the lap times seen */
const lapAt = new Map<number, number>(), lapTimes = new Map<number, number[]>();
let midTurnDwell = 0;
const t0 = performance.now();
const end = w.tick + HOURS * TICKS_PER_HOUR;
let revTicks = 0;
while (w.tick < end) {
  sim.tick();
  for (const b of svc.buses.values()) {
    seen.add(b.v.id); busLine.set(b.v.id, b.line);
    if (b.phase !== 'service') continue;
    const prev = lastCall.get(b.v.id);
    if (prev !== undefined && b.call === 0 && prev !== 0) {
      laps.set(b.v.id, (laps.get(b.v.id) ?? 0) + 1);
      const t0 = lapAt.get(b.v.id);
      if (t0 !== undefined) { const a = lapTimes.get(b.line) ?? []; a.push(w.tick - t0); lapTimes.set(b.line, a); }
      lapAt.set(b.v.id, w.tick);
    }
    // a bus serving a stop where it turns round stands in its lane once it has turned, never across the road mid-turn
    const tp = sim.traffic.turnProgress(b.v as never);
    if ((b as unknown as { atCall: boolean }).atCall && tp >= 0 && tp < 0.9) midTurnDwell++;
    lastCall.set(b.v.id, b.call);
    if (sim.traffic.reversing(b.v as never)) revTicks++;
  }
}
const ms = performance.now() - t0;
const byLine = new Map<number, number[]>();
for (const [id, k] of laps) { const l = busLine.get(id)!; const a = byLine.get(l) ?? []; a.push(k); byLine.set(l, a); }
for (const [id, c] of lineOf) {
  const k = byLine.get(id) ?? [];
  check(k.length >= 2 && Math.min(...k) >= 2, `${c.name}: buses ran laps ${JSON.stringify(k)} (want two buses, two laps each)`);
  const lt = lapTimes.get(id) ?? [], mean = lt.reduce((a, b) => a + b, 0) / Math.max(1, lt.length), est = estimate.get(id) ?? 0;
  console.log(`${c.name}: laps per bus ${JSON.stringify(k)}, lap ${mean.toFixed(0)} ticks measured against ${est} estimated (${(est / mean).toFixed(2)})`);
  if (lt.length) check(est > 0.8 * mean && est < 1.25 * mean, `${c.name}: round-trip estimate ${est} ticks against ${mean.toFixed(0)} measured`);
}
check(midTurnDwell === 0, `ticks a bus stood at a stop in the middle of turning round: ${midTurnDwell}`);
check(svc.stats.withdrawn === 0, `buses withdrawn (stuck or no way on): ${svc.stats.withdrawn}`);
if (HOURS >= 23) check(svc.stats.returned === svc.stats.spawned, `buses back in the depot after service: ${svc.stats.returned} of ${svc.stats.spawned}`);
console.log(`buses ${seen.size}, stats ${JSON.stringify(svc.stats)}, ticks backing up ${revTicks}, ${HOURS} h in ${ms.toFixed(0)} ms (${(ms / (HOURS * TICKS_PER_HOUR)).toFixed(2)} ms/tick)`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
