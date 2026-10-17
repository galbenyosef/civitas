/**
 * Gridlock diagnostic for the traffic A/B work (docs/traffic-tuning.md). Runs the Commons with the given tunables
 * (as ab.ts, seed 1), then for every car on the road says why it is not moving: following the car ahead, or held at
 * the stop line by lane capacity, the junction exit rule, the box-clear rule, pedestrians, a red light or a
 * conflicting movement. Reaches into Traffic's private state, so it is a debugging tool, not an API.
 *
 *   npx tsx packages/server/src/loadtest/ab-why.ts --hour 8 --ticks 300 --set stuckLimit=0 --chains 5
 *
 * --chains N   follow N long-stuck cars along what holds each one up, to a deadlock cycle or the head of a queue
 * --stuckmap   during the run, record every give-up: target tile, and where its chain of holders ends
 * --pedwhy     with --stuckmap, print the pedestrian when a car was held by the body guard
 * --examples   print some held cars with the cars or rule holding them
 * --peds x,y   list pedestrians and cars on and around tile (x,y) at the end
 * --probe ids  for these car ids, test the body guard a little way ahead (pedestrian / car in the way)
 * --follow id  trace one car's progress for three more ticks
 * --zombies    count cars left in a lane that are no longer driving
 */
import { TICKS_PER_DAY, TICKS_PER_HOUR, TRAFFIC_TUNING as TT, MIN_GAP } from '@msimcity/shared';
import { World, DIRS, type Mover } from '../world';
import { Simulation } from '../sim/simulation';
import { Traffic, dirBetween, conflictsFor as conflicts } from '../sim/traffic';
import { seedCity } from './cities';
import { parseSet } from './ab';

const argv = process.argv.slice(2);
const get = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const set = parseSet(get('set'));
let seed = 1 * 2654435761;
Math.random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (const [k, v] of Object.entries(set)) (TT as Record<string, number>)[k] = v;
const w = new World(1);
seedCity(w, { districts: 1, built: 3 });
for (const id of w.parcels.keys()) w.recountRoads(id);
const sim = new Simulation(w);
const tr = sim.traffic as any;
const start = TICKS_PER_DAY + Math.round(Number(get('hour') ?? 8) * TICKS_PER_HOUR);
const stuckAt = new Map<string, number>(), stuckWhy = new Map<string, number>();
if (argv.includes('--stuckmap')) {
  while (w.tick < start) sim.tick();
  const s0 = sim as any, orig = s0.onStuck.bind(sim);
  s0.onStuck = (m: Mover, leg: unknown) => {
    const bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
    const kind = 'vkind' in m ? `vehicle ${(m as any).vkind}` : 'citizen';
    const k = `${kind} -> (${bx},${by}) deg ${tr.degreeOf(bx, by)}${m.pi + 1 >= m.path.length / 2 ? ' dest' : ''}`;
    stuckAt.set(k, (stuckAt.get(k) ?? 0) + 1);
    // follow the chain of what holds whom to its end: a cycle (true deadlock) or whatever holds the head of the queue
    const seen = new Set<Mover>();
    let cur: Mover | string = m, n = 0;
    while (typeof cur !== 'string' && !seen.has(cur) && n < 80) { seen.add(cur); cur = blocker(cur); n++; }
    const inBoxNow = tr.inJunctionBox(m) ? 'IN BOX ' : '';
    stuckWhy.set(inBoxNow ? 'stuck car inside a junction box' : 'stuck car clear of boxes', (stuckWhy.get(inBoxNow ? 'stuck car inside a junction box' : 'stuck car clear of boxes') ?? 0) + 1);
    const why = typeof cur === 'string' ? `${inBoxNow}queue of ${n < 5 ? n : n < 15 ? '5-14' : '15+'} ending at: ${cur}` : `deadlock cycle`;
    stuckWhy.set(why, (stuckWhy.get(why) ?? 0) + 1);
    if (cur === 'body guard: pedestrian in the way' && argv.includes('--pedwhy')) {
      const holder = [...seen].pop()!;
      const p = tr.sweepProg(holder, holder.prog + 0.1), c = tr.posAlong(holder, p, [0, 0]);
      for (const cz of w.citizens.values()) if (cz.pts && !cz.leg?.drive && Math.hypot(cz.x - c[0], cz.y - c[1]) < 0.35) {
        const onRoad = tr.isRoadAt(Math.floor(cz.x), Math.floor(cz.y));
        console.log(`  ped-guard: car #${holder.id} pi ${holder.pi} prog ${holder.prog.toFixed(2)} c${+holder.committed} in${holder.inDir} lane d${holder.lane % 4} path ${holder.path.slice((holder.pi - 1) * 2, holder.pi * 2 + 4).join(",")} at (${holder.x.toFixed(2)},${holder.y.toFixed(2)}) | ped #${cz.id} (${cz.x.toFixed(2)},${cz.y.toFixed(2)}) ${onRoad ? 'road' : 'off-road'} wait ${cz.wait} cross ${cz.cross?.[cz.pp] ? 'on crossing' : 'not crossing'} prevcross ${cz.cross?.[cz.pp - 1] ? 1 : 0} seg (${cz.pts[(cz.pp - 1) * 2]?.toFixed(2)},${cz.pts[(cz.pp - 1) * 2 + 1]?.toFixed(2)})->(${cz.pts[cz.pp * 2]?.toFixed(2)},${cz.pts[cz.pp * 2 + 1]?.toFixed(2)}) carBody here ${tr.carBodyAt(cz.x, cz.y)}`);
      }
    }
    return orig(m, leg);
  };
}
while (w.tick < start + Number(get('ticks') ?? 300)) sim.tick();
if (argv.includes('--stuckmap')) {
  console.log('give-ups by target tile:');
  for (const [k, v] of [...stuckAt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('give-ups by what held them:');
  for (const [k, v] of [...stuckWhy.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
}

const cars: Mover[] = [];
for (const c of w.citizens.values()) if (c.leg?.drive && c.lane >= 0) cars.push(c);
for (const v of w.vehicles.values()) if (v.lane >= 0) cars.push(v);
const why = new Map<string, number>();
const bump = (k: string) => why.set(k, (why.get(k) ?? 0) + 1);
const ex: string[] = [];
for (const m of cars) {
  if (m.wait < 5) { bump('moving'); continue; }
  const n = m.path.length / 2;
  const ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1], bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1];
  const dir = dirBetween(ax, ay, bx, by);
  const last = m.pi + 1 >= n;
  const q = tr.cells.get(m.lane) as Mover[];
  const idx = q.indexOf(m);
  if (idx > 0) { bump('following in lane'); continue; }
  const stop = tr.stopLine(m);
  if (m.committed) { bump('committed, following next lane tail'); continue; }
  if (m.prog < stop - 0.05) { bump(`short of stop line (next-lane tail)`); continue; }
  if (last) { bump('waiting to enter destination forecourt'); continue; }
  const nextDir = tr.nextDirOf(m);
  const deg = tr.degreeOf(bx, by);
  const nextKey = Traffic.laneKey(bx, by, nextDir);
  const nq = tr.cells.get(nextKey) as Mover[] | undefined;
  const tag = deg >= 3 ? 'junction' : 'road';
  if (!tr.laneRoom(bx, by, nextKey, m)) { bump(`${tag}: exit lane full`); if (ex.length < 20) ex.push(`${m.id} at (${ax},${ay})->(${bx},${by}) d${dir}->${nextDir} exit lane full (${nq?.length}) heads: ${nq?.map((o) => `${o.id} prog ${o.prog.toFixed(2)} wait ${o.wait}`).join('; ')}`); continue; }
  if (nq && nq.length && deg >= 3) { const t = nq[nq.length - 1]; if (t.prog < 0.5 + t.len / 2 + MIN_GAP) { bump(`${tag}: exit tail still in box`); continue; } }
  if (TT.boxClear && deg >= 3 && !tr.roomBeyond(m, bx, by, nextDir, nq ?? null)) { bump(`${tag}: no room beyond box`); continue; }
  const walkers = tr.crossingsAt(bx, by);
  const signal = deg >= 3 && tr.junction(bx, by).signal;
  if (walkers) { bump(`${tag}: pedestrians`); continue; }
  if (signal) { const ph = tr.signalPhase(bx, by); if ((ph.green === 'ew') !== (dir < 2) || ph.amber) { bump(`${tag}: red`); continue; } }
  let conf = '';
  for (const o of tr.inBox(bx, by)) { if (o.m === m) continue; conf = `${o.inD}->${o.outD} (${o.m.wait}w)`; break; }
  if (conf) { bump(`${tag}: conflict in box`); if (ex.length < 30) ex.push(`${m.id} (${bx},${by}) ${dir}->${nextDir} blocked by ${conf}`); continue; }
  bump(`${tag}: ? (passes now)`);
}
console.log(`tick ${w.tick}: ${cars.length} cars on the road`);
for (const [k, v] of [...why.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
if (argv.includes('--examples')) console.log(ex.join('\n'));

/** The car whose body m's next move would run into (body guard), if any. */
function guardHolder(m: Mover): Mover | null {
  const p = tr.sweepProg(m, m.prog + 0.17);
  const a = tr.posAlong(m, Math.max(0, p - 0.01), [0, 0]), b = tr.posAlong(m, p + 0.01, [0, 0]), c = tr.posAlong(m, p, [0, 0]);
  const hl = Math.hypot(b[0] - a[0], b[1] - a[1]); const hx = (b[0] - a[0]) / hl, hy = (b[1] - a[1]) / hl;
  const h: [number, number] = [0, 0];
  const pool: Mover[] = [];
  for (const c of w.citizens.values()) if (c.leg?.drive && c.lane >= 0) pool.push(c);
  for (const v of w.vehicles.values()) if (v.lane >= 0) pool.push(v);
  for (const o of pool) {
    if (o === m || Math.hypot(o.x - c[0], o.y - c[1]) > 0.6 || !tr.headingOf(o, h)) continue;
    const ex = o.x - c[0], ey = o.y - c[1];
    // crude: centre distance along / across my heading against half sizes
    const along = Math.abs(ex * hx + ey * hy), across = Math.abs(-ex * hy + ey * hx);
    if (along < (m.len + o.len) / 2 + 0.03 && across < 0.18 + 0.06) return o;
  }
  return null;
}
/** What holds m: a mover (leader, exit-lane tail, conflicting car) or a reason. */
function blocker(m: Mover): Mover | string {
  const n = m.path.length / 2;
  const bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1], ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1];
  const dir = dirBetween(ax, ay, bx, by);
  const q = tr.cells.get(m.lane) as Mover[];
  const idx = q.indexOf(m);
  if (idx > 0) return q[idx - 1];
  const last = m.pi + 1 >= n;
  const nextDir = tr.nextDirOf(m);
  const nq = last ? undefined : (tr.cells.get(Traffic.laneKey(bx, by, nextDir)) as Mover[] | undefined);
  if (m.committed && nq && nq.length) return nq[nq.length - 1];
  if (m.committed || m.prog < tr.stopLine(m) - 0.05) {
    const g = guardHolder(m);
    if (g) return g;
    if (tr.pedInBody(m, tr.sweepProg(m, m.prog + 0.1))) return 'body guard: pedestrian in the way';
    return m.committed ? 'committed, free?' : 'short, free?';
  }
  if (m.prog < tr.stopLine(m) - 0.05) return nq && nq.length ? nq[nq.length - 1] : 'short, free?';
  if (last) { for (const o of tr.inBox(bx, by)) if (o.m !== m) return o.m; return 'forecourt?'; }
  if (!tr.laneRoom(bx, by, Traffic.laneKey(bx, by, nextDir), m)) return nq![0];
  if (nq && nq.length && tr.degreeOf(bx, by) >= 3) { const t = nq[nq.length - 1]; if (t.prog < 0.5 + t.len / 2 + MIN_GAP) return t; }
  if (tr.canEnter(m, bx, by, dir, nextDir)) return tr.pedInBody(m, Math.min(0.999, m.prog + 0.1)) ? 'body guard: pedestrian in the way' : 'canEnter ok (?)';
  if (tr.crossingsAt(bx, by) && (TT.carYieldMax <= 0 || m.wait < TT.carYieldMax) && (tr.degreeOf(bx, by) < 3 || !tr.junction(bx, by).signal)) return 'pedestrians on the crossing';
  if (TT.boxClear && (tr.degreeOf(bx, by) >= 3 || TT.boxClear >= 2) && !tr.roomBeyond(m, bx, by, nextDir, nq ?? null)) return 'no room beyond the box';
  for (const o of tr.inBox(bx, by)) if (o.m !== m && conflicts(dir, nextDir, o.inD, o.outD)) return o.m;
  if (tr.degreeOf(bx, by) >= 3 && tr.junction(bx, by).signal) { const ph = tr.signalPhase(bx, by); if ((ph.green === 'ew') !== (dir < 2) || ph.amber) return 'red (box clear)'; }
  return 'free';
}
const desc = (m: Mover) => { if (!m.path) return '?'; const bx = m.path[m.pi * 2], by = m.path[m.pi * 2 + 1], ax = m.path[(m.pi - 1) * 2], ay = m.path[(m.pi - 1) * 2 + 1]; return `#${m.id} (${ax},${ay})->(${bx},${by})${m.pi + 1 >= m.path.length / 2 ? ' [dest]' : ` next (${m.path[(m.pi + 1) * 2]},${m.path[(m.pi + 1) * 2 + 1]})`} prog ${m.prog.toFixed(2)} c${+m.committed} w${m.wait} in${m.inDir}`; };
const chains = Number(get('chains') ?? 0);
let shown = 0;
for (const m0 of cars) {
  if (shown >= chains) break;
  if (m0.wait < 100) continue;
  shown++;
  const seen = new Set<Mover>();
  let m: Mover | string = m0;
  const out: string[] = [];
  while (typeof m !== 'string' && !seen.has(m) && out.length < 40) { seen.add(m); out.push(desc(m)); m = blocker(m); }
  out.push(typeof m === 'string' ? `=> ${m}` : `=> CYCLE back to #${m.id}`);
  console.log(out.join('\n   '));
}
const at = get('peds');
if (at) {
  const [px, py] = at.split(',').map(Number);
  for (const c of w.citizens.values()) {
    if (!c.pts || c.leg?.drive) continue;
    if (Math.floor(c.x) !== px || Math.floor(c.y) !== py) continue;
    console.log(`ped #${c.id} (${c.x.toFixed(2)},${c.y.toFixed(2)}) pp ${c.pp}/${c.pts.length / 2} wait ${c.wait} cross ${c.cross?.[c.pp]} prevcross ${c.cross?.[c.pp - 1]} next (${c.pts[c.pp * 2]?.toFixed(2)},${c.pts[c.pp * 2 + 1]?.toFixed(2)}) carBodyAtNext ${tr.carBodyAt(c.pts[c.pp * 2], c.pts[c.pp * 2 + 1])} here ${tr.carBodyAt(c.x, c.y)} state ${c.state} path ${c.path.join(',')}`);
  }
  for (const m of cars) if (Math.abs(m.x - px - 0.5) < 1.5 && Math.abs(m.y - py - 0.5) < 1.5) console.log(`car ${desc(m)} at (${m.x.toFixed(2)},${m.y.toFixed(2)})`);
}
const probe = get('probe');
if (probe) for (const id of probe.split(',').map(Number)) {
  const m = cars.find((c) => c.id === id);
  if (!m) { console.log(`#${id} not on the road`); continue; }
  const res: string[] = [];
  for (const dp of [0.02, 0.09, 0.18, 0.27, 0.36, 0.45]) { const p = tr.sweepProg(m, m.prog + dp); res.push(`+${dp}: ped ${tr.pedInBody(m, p)} car ${tr.carInBody(m, p)}`); }
  console.log(`probe ${desc(m)}: ${res.join(' | ')}`);
  const c = tr.posAlong(m, tr.sweepProg(m, m.prog + 0.05), [0, 0]);
  for (const cz of w.citizens.values()) if (cz.pts && !cz.leg?.drive && Math.hypot(cz.x - c[0], cz.y - c[1]) < 0.7) console.log(`   ped #${cz.id} (${cz.x.toFixed(2)},${cz.y.toFixed(2)}) wait ${cz.wait} pp ${cz.pp} next (${cz.pts[cz.pp * 2]?.toFixed(2)},${cz.pts[cz.pp * 2 + 1]?.toFixed(2)}) cross ${cz.cross?.[cz.pp]} state ${cz.state}`);
}
if (argv.includes('--zombies')) {
  let z = 0;
  for (const v of w.vehicles.values()) if (v.lane >= 0 && (v.phase === 'dwell' || !v.leg || !v.leg.drive)) { z++; if (z < 6) console.log(`zombie vehicle #${v.id} kind ${v.vkind} phase ${v.phase} leg ${v.leg ? (v.leg.drive ? 'drive' : 'walk') + ' ' + v.leg.arrive : 'none'} legs ${v.legs.length} until ${v.until - w.tick}`); }
  for (const c of w.citizens.values()) if (c.lane >= 0 && (!c.leg || !c.leg.drive)) { z++; if (z < 12) console.log(`zombie citizen #${c.id} state ${c.state} leg ${c.leg ? c.leg.arrive : 'none'}`); }
  console.log(`zombies in lanes: ${z}`);
}
const follow = get('follow');
if (follow) {
  const id = Number(follow);
  const m = (w.vehicles.get(id) ?? w.citizens.get(id)) as any;
  console.log('follow', id, 'phase', m.phase, 'state', m.state, 'leg', JSON.stringify(m.leg && { drive: m.leg.drive, arrive: m.leg.arrive, dest: m.leg.dest }), 'legs', m.legs?.length, 'lane', m.lane, 'pi', m.pi, 'n', m.path.length / 2, 'speedMul', m.speedMul);
  const origStep = tr.step.bind(tr);
  tr.step = (mm: Mover) => { const before = mm.prog; const r = origStep(mm); if (mm.id === id) console.log(`  step t${w.tick}: ${before.toFixed(3)} -> ${mm.prog.toFixed(3)} ${r} committed ${mm.committed}`); return r; };
  for (let i = 0; i < 3; i++) sim.tick();
}
