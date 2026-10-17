/**
 * Leisure probe: a fresh test city with a park, a cinema and a library placed on Commons land, fast-forwarded,
 * printing arrivals per venue type by hour of day, the mean leisure need and the happiness reasons.
 *
 *   npx tsx packages/server/src/loadtest/leisure.ts [--districts 1] [--days 2] [--warmup 1] [--built 3] [--seed 1] [--ages 6-90]
 *
 * The first `--warmup` days fill the city (it starts empty) and are not counted; the next `--days` are.
 * `--ages lo-hi` re-ages everyone after the warm-up (a fresh city is all 18-45 year olds), so children and
 * retirees show up; children found working are let go.
 */
import { TICKS_PER_DAY, Zone, isRoad, packTile, terrainOf, LifeStage, leisureAt, KIND_NAMES, KIND_ID, familyOf, subFor } from '@msimcity/shared';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity } from './cities';
import { happinessParts, leisureNeed, seededAge, stageFor, LIFE } from '../sim/life';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const districts = get('districts', 1), days = get('days', 2), warmup = get('warmup', 1), built = get('built', 3);
const DAY = TICKS_PER_DAY;
const kindId = (id: string) => KIND_ID[id as keyof typeof KIND_ID];

const w = new World(get('seed', 1));
const layout = seedCity(w, { districts, built });
const sim = new Simulation(w);

// place the three on Commons land: tiles next to a road, replacing whatever stands there, spread across the district
const d0 = layout.districts[0];
const wanted: [string, number, number][] = [['park', 6, 2], ['cinema', 11, 8], ['library', 4, 17]];
const placed: { id: string; x: number; y: number }[] = [];
for (const [id, lx, ly] of wanted) {
  const x = d0.x + lx, y = d0.y + ly, t = w.getTile(x, y);
  if (isRoad(t) || !w.hasRoadAccess(x, y)) throw new Error(`(${x}, ${y}) is not a lot next to a road`);
  const was = KIND_NAMES[w.kindIdAt(x, y)];
  w.setTile(x, y, packTile(terrainOf(t), false, familyOf(kindId(id)), 1), subFor(kindId(id)));
  placed.push({ id, x, y });
  console.log(`placed ${id} at (${x}, ${y}) on ${w.parcelAt(x, y)?.name}, replacing ${was || 'nothing'}`);
}

const agesArg = (() => { const i = argv.indexOf('--ages'); return i >= 0 ? argv[i + 1].split('-').map(Number) : null; })();
const t0 = performance.now();
for (let i = 0; i < warmup * DAY; i++) sim.tick();
if (agesArg) for (const c of w.citizens.values()) {
  const age = seededAge(c.id, agesArg[0], agesArg[1]);
  c.born = w.tick / DAY - age * LIFE.daysPerYear;
  c.stage = stageFor(c.id, age);
  if (c.stage !== LifeStage.Adult && c.job) w.quitJob(c);
}
const baseStage = JSON.parse(JSON.stringify(sim.leisureByStage)) as Record<string, number[]>;
const base = JSON.parse(JSON.stringify(sim.leisureStats)) as Record<string, number[]>;
const needByDay: string[] = [];
for (let d = 0; d < days; d++) {
  for (let i = 0; i < DAY; i++) sim.tick();
  const cs = [...w.citizens.values()];
  needByDay.push(`day ${warmup + d + 1}: population ${cs.length}, mean leisure need ${(100 * cs.reduce((s, c) => s + leisureNeed(c), 0) / cs.length).toFixed(1)}%`);
}
const secs = ((performance.now() - t0) / 1000).toFixed(1);

console.log(`\nLeisure probe: ${districts}×${districts} districts built to ${built}, ${warmup} warm-up day(s) + ${days} counted day(s) in ${secs} s\n`);
const types = Object.keys(sim.leisureStats).sort();
const pad = (v: string | number, n: number) => String(v).padStart(n);
console.log('Arrivals by hour of day over the counted days (bar = cafés, bars and restaurants):');
console.log(`${pad('hour', 5)} ${types.map((t) => pad(t, 8)).join(' ')}`);
const counted: Record<string, number[]> = {};
for (const t of types) counted[t] = sim.leisureStats[t].map((n, h) => n - (base[t]?.[h] ?? 0));
for (let h = 0; h < 24; h++) console.log(`${pad(h, 5)} ${types.map((t) => pad(counted[t][h], 8)).join(' ')}`);
console.log(`${pad('total', 5)} ${types.map((t) => pad(counted[t].reduce((a, b) => a + b, 0), 8)).join(' ')}`);
const peak = (t: string) => { const a = counted[t] ?? []; let best = 0; for (let h = 1; h < 24; h++) if (a[h] > a[best]) best = h; return best; };
for (const t of types) {
  const a = counted[t], ev = a.slice(17, 23).reduce((x, y) => x + y, 0), all = a.reduce((x, y) => x + y, 0);
  console.log(`  ${t}: peak hour ${peak(t)}:00, ${all ? Math.round((100 * ev) / all) : 0}% of arrivals between 17:00 and 23:00`);
}

console.log('Arrivals by life stage over the counted days (share of each stage\'s outings):');
const stageTotals = [0, 0, 0];
const byStageCounted: Record<string, number[]> = {};
for (const t of types) { byStageCounted[t] = (sim.leisureByStage[t] ?? [0, 0, 0]).map((n, i) => n - (baseStage[t]?.[i] ?? 0)); byStageCounted[t].forEach((n, i) => (stageTotals[i] += n)); }
for (const [name, i] of [['adults', LifeStage.Adult], ['children', LifeStage.Child], ['retirees', LifeStage.Retired]] as const) {
  if (!stageTotals[i]) continue;
  console.log(`  ${pad(name, 9)} ${types.map((t) => `${t} ${pad(Math.round((100 * byStageCounted[t][i]) / stageTotals[i]), 3)}%`).join('  ')}  (${stageTotals[i]} arrivals)`);
}

console.log('\nPlaced venues now:');
for (const p of placed) {
  const b = w.buildings.get(`${p.x},${p.y}`)!;
  const info = sim.describe(b);
  const sp = leisureAt(b.zone, b.level, b.x, b.y);
  console.log(`  ${p.id} at (${p.x}, ${p.y}): ${sp?.title}, level ${b.level}${w.sites.has(`${p.x},${p.y}`) ? ' (upgrade site open)' : ''}, staff ${b.occupants}/${info.capacity}, visits today ${info.venue?.visitsToday} yesterday ${info.venue?.visitsYesterday}, here now ${info.venue?.visitors}/${info.venue?.capacity}, next event ${info.venue?.nextEvent ? `${info.venue.nextEvent.weekday} ${info.venue.nextEvent.hour.toFixed(2)}` : 'none'}`);
}

console.log('\n' + needByDay.join('\n'));
const cs = [...w.citizens.values()];
const byStage = (s: number) => cs.filter((c) => c.stage === s);
for (const [name, s] of [['adults', LifeStage.Adult], ['children', LifeStage.Child], ['retirees', LifeStage.Retired]] as const) {
  const g = byStage(s);
  if (g.length) console.log(`  ${name}: ${g.length}, mean leisure need ${(100 * g.reduce((a, c) => a + leisureNeed(c), 0) / g.length).toFixed(1)}%`);
}
const reasons = new Map<string, { n: number; sum: number }>();
const homes = new Map<string, { score: number; parks: number }>();
for (const c of cs) {
  const hk = `${c.hx},${c.hy}`;
  let lc = homes.get(hk);
  if (!lc) { const info = sim.describe(w.buildings.get(hk)!); lc = { score: info.leisure?.score ?? 0, parks: 0 }; homes.set(hk, lc); }
  // the park share of a home's coverage: parks in reach summed, as the life step sees it
  const parks = (sim as unknown as { leisureCoverage(x: number, y: number): { parks: number } }).leisureCoverage(c.hx, c.hy).parks;
  const coverage = (sim as unknown as { coverage(x: number, y: number): number }).coverage(c.hx, c.hy);
  for (const p of happinessParts(c, { coverage, tick: w.tick, parks })) {
    const label = p.label.replace(/ \(.*\)$/, ''); // 'long commute (39 min)' -> 'long commute'
    const r = reasons.get(label) ?? { n: 0, sum: 0 };
    r.n++; r.sum += p.delta; reasons.set(label, r);
  }
}
console.log(`\nHappiness reasons (count of citizens, mean delta):`);
for (const [label, r] of [...reasons.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${pad(r.n, 5)}  ${r.sum / r.n >= 0 ? '+' : ''}${(r.sum / r.n).toFixed(1)}  ${label}`);
const tiers = [0, 0, 0];
for (const h of homes.values()) tiers[h.score >= 7 ? 2 : h.score >= 3 ? 1 : 0]++;
console.log(`\nHomes by leisure coverage: ${tiers[0]} little to do, ${tiers[1]} some places, ${tiers[2]} plenty (of ${homes.size} occupied homes)`);
console.log(`Mean happiness ${(cs.reduce((a, c) => a + c.happy, 0) / cs.length).toFixed(1)}`);
void Zone;
