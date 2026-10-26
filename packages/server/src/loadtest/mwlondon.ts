/**
 * Motorways in London (UTD card e771510f): what a faster motorway does to a whole city. London is filled once and saved
 * (`--fill FILE`, 2 to 3 minutes and 1.2 GB), so every build and every class value plays the same city from the same
 * save (`--load FILE`): it runs to 07:00 of the next game day, then measures 07:00 to 10:00 (300 ticks):
 *
 *   npx tsx packages/server/src/loadtest/mwlondon.ts --fill /tmp/london.json
 *   npx tsx packages/server/src/loadtest/mwlondon.ts --load /tmp/london.json [--speed 1.25 --cost 0.8]
 *
 * Reported: cars on the road per class of the tile under them (mean a tick, and the mean pace in tiles a tick), the
 * route searches and A* nodes, give-ups, the mean tick time, and for the motorway classes the checks the probe in
 * motorway.ts makes: tile edges crossed in a tick, steps over the top pace, falls in speed of more than half a tile a
 * tick, and car-car body overlaps (sampled every third tick).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { TICKS_PER_DAY, TICKS_PER_HOUR, DRIVE_SPEED, RoadCls, ROAD_CLASS_DEFS, JUNCTION_CLASS_DEFS, classDef, isClassAux, type DemoId } from '@msimcity/shared';
import { probeGame } from './probe-city';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { createGame } from '../game';
import { SEARCH } from '../pathfinding';
import { obb } from './classbench';
import type { Mover } from '../world';
import type { Traffic } from '../sim/traffic';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const speedArg = arg('speed', ''), costArg = arg('cost', '');
for (const d of [ROAD_CLASS_DEFS[RoadCls.Motorway], JUNCTION_CLASS_DEFS.find((c) => c.id === RoadCls.Deck)!] as { speed: number; routeCost: number }[]) {
  if (speedArg) d.speed = Number(speedArg);
  if (costArg) d.routeCost = Number(costArg);
}
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;

async function main() {
  const fillFile = arg('fill', ''), loadFile = arg('load', '');
  if (fillFile) {
    const { game, fill } = await probeGame('london' as DemoId, 0);
    writeFileSync(fillFile, JSON.stringify(snapshotOf(game.world)));
    console.log(`London filled: ${fill.pop} citizens, tick ${game.world.tick}, saved to ${fillFile}`);
    return;
  }
  if (!loadFile) throw new Error('--fill FILE or --load FILE');
  const { seededRandom } = await import('../demo/seed');
  const { DEMO_TOWN } = await import('@msimcity/shared');
  Math.random = seededRandom(DEMO_TOWN.seed);
  const world = worldFromSnapshot(JSON.parse(readFileSync(loadFile, 'utf8')));
  if (!world) throw new Error('bad save');
  const game = createGame(world, { onConnection() {} }, { devTools: false, sandbox: true });
  const w = game.world, traffic = (game.sim as unknown as { traffic: Traffic }).traffic;
  console.log(`London from ${loadFile}: ${w.citizens.size} citizens, tick ${w.tick} (day ${Math.floor(w.tick / DAY)}, ${((w.tick % DAY) / TPH).toFixed(1)} h); motorway speed ${classDef(RoadCls.Motorway).speed}, route cost ${classDef(RoadCls.Motorway).routeCost}`);
  const start = (Math.floor(w.tick / DAY) + 1) * DAY + 7 * TPH, end = start + 3 * TPH;
  while (w.tick < start) game.step();
  const s0 = { routes: SEARCH.routes, nodes: SEARCH.nodes }, g0 = { ...traffic.counters };
  const cars = new Array(8).fill(0), pace = new Array(8).fill(0);
  const last = new Map<Mover, { x: number; y: number; pi: number; v: number; lane: number }>();
  let maxEdges = 0, over = 0, hard = 0, fastTicks = 0, overlaps = 0, ticks = 0, ms = 0, maxStep = 0, worstDrop = 0;
  const h: [number, number] = [0, 0], g: [number, number] = [0, 0];
  const top = DRIVE_SPEED * 1.12 * classDef(RoadCls.Motorway).speed;
  while (w.tick < end) {
    const t0 = performance.now(); game.step(); ms += performance.now() - t0; ticks++;
    const movers: Mover[] = [];
    for (const c of w.citizens.values()) if (c.leg?.drive && c.lane >= 0) movers.push(c);
    for (const v of w.vehicles.values()) if (v.lane >= 0) movers.push(v);
    const seen = new Set<Mover>();
    for (const m of movers) {
      const cx = Math.floor(m.x), cy = Math.floor(m.y), a = traffic.classAux(cx, cy), cls = isClassAux(a) ? a & 7 : 0;
      const p = last.get(m);
      seen.add(m);
      let d = 0;
      if (p && p.lane >= 0) d = Math.hypot(m.x - p.x, m.y - p.y);
      cars[cls]++; pace[cls] += d;
      if (p && cls === RoadCls.Motorway || cls === RoadCls.Deck) {
        if (p && d < 8) {
          maxStep = Math.max(maxStep, d); maxEdges = Math.max(maxEdges, m.pi - p.pi);
          if (d > top + 0.05) over++;
          if (d > 0.85) fastTicks++;
          if (p.v > 0.7 && p.v - (m.v ?? 0) > 0.5) hard++;
          if (p.v > 0.7) worstDrop = Math.max(worstDrop, p.v - (m.v ?? 0));
        }
      }
      last.set(m, { x: m.x, y: m.y, pi: m.pi, v: m.v ?? 0, lane: m.lane });
    }
    for (const m of [...last.keys()]) if (!seen.has(m)) last.delete(m);
    if (ticks % 3 === 0) {
      // car-car body overlaps, among cars on or beside a motorway tile only (the street classes are the other probes')
      const near: Mover[] = movers.filter((m) => { const a = traffic.classAux(Math.floor(m.x), Math.floor(m.y)); return isClassAux(a) && ((a & 7) === RoadCls.Motorway || (a & 7) === RoadCls.Deck); });
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
        const A = near[i], B = near[j];
        if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 0.7) continue;
        if ((A.lane % 4 < 2) !== (B.lane % 4 < 2) && (classDef(traffic.classAux(Math.floor(A.x), Math.floor(A.y)) & 7).id === RoadCls.Deck || classDef(traffic.classAux(Math.floor(B.x), Math.floor(B.y)) & 7).id === RoadCls.Deck)) continue;
        if (!traffic.headingOf(A, h) || !traffic.headingOf(B, g)) continue;
        if (obb(A.x, A.y, h[0], h[1], A.len, B.x, B.y, g[0], g[1], B.len)) overlaps++;
      }
    }
  }
  const names = ['street', 'country lane', 'one-way', 'avenue', 'motorway', 'pedestrian', 'ring', 'deck'];
  console.log('\n| class | cars on the road (mean a tick) | share | mean pace (tiles a tick) |');
  console.log('| --- | --- | --- | --- |');
  const total = cars.reduce((n, v) => n + v, 0);
  cars.forEach((n, i) => { if (n) console.log(`| ${names[i]} | ${(n / ticks).toFixed(1)} | ${((100 * n) / total).toFixed(1)}% | ${(pace[i] / n).toFixed(2)} |`); });
  const gc = traffic.counters, d = (k: keyof typeof gc) => (gc[k] as number) - (g0[k] as number);
  const routes = SEARCH.routes - s0.routes, nodes = SEARCH.nodes - s0.nodes;
  console.log(`\nroute searches ${routes}, A* nodes ${nodes} (${(nodes / (routes || 1)).toFixed(0)} a search); tick ${(ms / ticks).toFixed(2)} ms mean; give-ups: stuck home ${d('stuckHome')}, despawned ${d('stuckDespawn')}`);
  console.log(`motorway: longest step ${maxStep.toFixed(2)} tiles (top ${top.toFixed(2)}), most edges in a tick ${maxEdges}, steps over the top pace ${over}, ${fastTicks} car-ticks over 0.85 tiles, worst fall in speed ${worstDrop.toFixed(2)}, ${hard} falls of more than half a tile, ${overlaps} car-car overlaps`);
}
main().then(() => process.exit(0));
