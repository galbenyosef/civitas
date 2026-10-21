/**
 * Avenue junction bench (R4, docs/traffic-tuning.md "Junctions"): two avenues crossing (or an avenue and a street, or the
 * 5×5 roundabout on the avenues' crossing) under the real traffic model, every move between the four arms at the same
 * demand, Poisson, for 2,600 ticks; prints the cars through and the give-ups, and with --why what held the cars that
 * waited longest.
 *
 *   npx tsx packages/server/src/loadtest/avenuebench.ts --kind aa --rate 4 [--set groupSignals=2] [--nosignals] [--why]
 *
 * kinds: aa (avenue × avenue, four phases with lights), as (avenue × street, two phases), big (the 5×5 roundabout on
 * avenue × avenue). `--rate` is cars an hour for each of the twelve moves.
 */
import { Terrain, packTile, RoadCls, roadDragPath, TICKS_PER_HOUR, TRAFFIC_TUNING as TT, planBigRoundabout } from '@msimcity/shared';
import { World, emptyStats, type Mover } from '../world';
import { Traffic } from '../sim/traffic';
import { findRoute } from '../pathfinding';
import { layClass, mulberry32 } from './classbench';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
for (const kv of arg('set', '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); if (!(k in TT)) throw new Error(`no tunable ${k}`); (TT as Record<string, number>)[k] = Number(v); }
const kind = arg('kind', 'aa'), rate = Number(arg('rate', '4')), ticks = Number(arg('ticks', '2600'));
const w = new World(1);
const p = w.getOrCreatePlayer('bench', 'Bench', 1e9);
p.tech = argv.includes('--nosignals') || kind === 'big' ? ['tr1'] : ['tr1', 'tr2'];
const parcel = { id: w.nextId++, owner: p.id, name: 'b', x: -30, y: -30, w: 61, h: 61, taxRate: 0, stats: emptyStats() };
w.parcels.set(parcel.id, parcel);
for (let y = -30; y <= 30; y++) for (let x = -30; x <= 30; x++) { w.setParcelId(x, y, parcel.id); w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); }
const A = 14;
layClass(w, roadDragPath([-A, 0], [A, 0]), RoadCls.Avenue); // east at y 0, west at -1
layClass(w, roadDragPath([0, -A], [0, A]), kind === 'as' ? RoadCls.Street : RoadCls.Avenue); // south at x 0 (north at 1)
if (kind === 'big') w.placeJunction(planBigRoundabout(0, 0, { tile: (x, y) => w.getTile(x, y), aux: (x, y) => w.auxAt(x, y), land: () => null }).tiles!);
const arms: Record<string, { in: [number, number]; out: [number, number] }> = kind === 'as'
  ? { W: { in: [-A, 0], out: [-A, -1] }, E: { in: [A, -1], out: [A, 0] }, N: { in: [0, -A], out: [0, -A] }, S: { in: [0, A], out: [0, A] } }
  : { W: { in: [-A, 0], out: [-A, -1] }, E: { in: [A, -1], out: [A, 0] }, N: { in: [0, -A], out: [1, -A] }, S: { in: [1, A], out: [0, A] } };
const t = new Traffic(w);
const flows: { from: [number, number]; to: [number, number]; name: string }[] = [];
for (const a of Object.keys(arms)) for (const b of Object.keys(arms)) if (a !== b) flows.push({ from: arms[a].in, to: arms[b].out, name: a + b });
const routes = flows.map((f) => findRoute(w, f.from[0], f.from[1], f.to[0], f.to[1], (x, y) => t.cost(x, y), 0.4, 40000)!.path);
const rnd = mulberry32(7);
const pending: Mover[][] = flows.map(() => []), active: (Mover & { f?: string })[] = [];
let id = 1, giveUps = 0, done = 0;
const why: Record<string, number> = {};
for (let tick = 0; tick < ticks; tick++) {
  w.tick = tick; t.beginTick();
  flows.forEach((f, i) => {
    let L = Math.exp(-rate / TICKS_PER_HOUR), k = 0, pp = rnd();
    while (pp > L) { k++; pp *= rnd(); }
    for (let n = 0; n < k; n++) { const m = { id: id++, x: 0, y: 0, path: [...routes[i]], pi: 0, ...w.moverDefaults(id) } as Mover & { f?: string }; m.f = f.name; pending[i].push(m); }
    if (pending[i].length && t.enter(pending[i][0]) === 'ok') active.push(pending[i].shift()!);
  });
  active.sort((a, b) => a.id - b.id);
  for (let j = 0; j < active.length; j++) {
    const m = active[j];
    if (argv.includes('--why') && m.wait === 50) {
      const h = t.holderOf(m) as (Mover & { f?: string }) | null, at = (c: Mover) => `${c.path[(c.pi - 1) * 2]},${c.path[(c.pi - 1) * 2 + 1]}->${c.path[c.pi * 2]},${c.path[c.pi * 2 + 1]} p${c.prog.toFixed(2)}${c.committed ? 'C' : ''}${c.med ? 'M' : ''}`;
      const k = `${m.f} ${at(m)} held by ${h ? `${h.f} ${at(h)} w${h.wait}` : 'nothing (a rule)'} ${t.standing(m)}`;
      why[k] = (why[k] ?? 0) + 1;
    }
    const r = t.step(m);
    if (r === 'arrived') { done++; active.splice(j--, 1); } else if (r === 'stuck') { giveUps++; t.leave(m); active.splice(j--, 1); }
  }
  t.endTick();
}
console.log(`${kind} at ${rate} an hour a move (${rate * 12} in all), ${ticks} ticks: ${done} through, ${giveUps} give-ups`);
for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${n} ${k}`);
