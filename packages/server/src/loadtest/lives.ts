/**
 * Citizen lives probe: fast-forward a fresh test city in a tight loop and print how its people live.
 *
 *   npx tsx packages/server/src/loadtest/lives.ts --districts 1 --weeks 4 [--ages 18-90] [--save FILE]
 *
 * Prints, per game week: population, children, retirees, births, deaths (old age / illness), couples formed, partners
 * moving in together, grown-up children moving out, people living alone leaving town, doctor visits,
 * sick days; and at the end: population pyramid by decade, life stages, household size histogram, share sick by
 * condition, mean happiness and its most common reasons, friends per citizen, couples.
 */
import { TICKS_PER_DAY, LifeStage } from '@msimcity/shared';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity } from './cities';
import { saveWorld } from '../store';
import { ageOf, Cond, happinessParts, LIFE, seededAge } from '../sim/life';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const districts = get('districts', 1), weeks = get('weeks', 4), built = get('built', 3);
/** --ages lo-hi: after the first game day, re-age everyone living there to lo..hi (exercises retirement and deaths) */
const agesArg = (() => { const i = argv.indexOf('--ages'); return i >= 0 ? argv[i + 1].split('-').map(Number) : null; })();

const w = new World(get('seed', 1));
seedCity(w, { districts, built });
const sim = new Simulation(w);
const DAY = TICKS_PER_DAY, WEEK = DAY * LIFE.daysPerYear;
const t0 = performance.now();
let last = { ...sim.lifeEvents };
const rows: string[] = [];
const pad = (v: string | number, n: number) => String(v).padStart(n);
rows.push(`${pad('week', 4)} ${pad('pop', 5)} ${pad('kids', 5)} ${pad('retd', 5)} ${pad('births', 6)} ${pad('deaths', 6)} ${pad('(old/ill)', 9)} ${pad('couples+', 8)} ${pad('in', 4)} ${pad('out', 4)} ${pad('left', 5)} ${pad('doctor', 6)} ${pad('sickdays', 8)} ${pad('friends+', 8)}`);
for (let wk = 1; wk <= weeks; wk++) {
  for (let i = 0; i < WEEK; i++) {
    sim.tick();
    if (agesArg && wk === 1 && i === DAY) for (const c of w.citizens.values()) c.born = w.tick / DAY - seededAge(c.id, agesArg[0], agesArg[1]) * LIFE.daysPerYear;
  }
  const e = sim.lifeEvents, d = (k: keyof typeof e) => e[k] - last[k];
  let kids = 0, retd = 0;
  for (const c of w.citizens.values()) { if (c.stage === LifeStage.Child) kids++; else if (c.stage === LifeStage.Retired) retd++; }
  rows.push(`${pad(wk, 4)} ${pad(w.citizens.size, 5)} ${pad(kids, 5)} ${pad(retd, 5)} ${pad(d('births'), 6)} ${pad(d('deaths'), 6)} ${pad(`${d('deathsOldAge')}/${d('deathsIllness')}`, 9)} ${pad(d('partners'), 8)} ${pad(d('movedIn'), 4)} ${pad(d('movedOut'), 4)} ${pad(d('leftTown'), 5)} ${pad(d('doctorVisits'), 6)} ${pad(d('sickDaysOff'), 8)} ${pad(d('friendships'), 8)}`);
  last = { ...e };
  process.stderr.write(`week ${wk} done (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
}

const cs = [...w.citizens.values()];
const n = cs.length;
console.log(`Lives probe: ${districts}×${districts} districts built to ${built}${agesArg ? `, residents re-aged to ${agesArg.join('-')} after day 1` : ''}, ${weeks} game weeks (${weeks * LIFE.daysPerYear} days, ${weeks * WEEK} ticks) in ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
console.log(rows.join('\n'));

console.log('\nPopulation pyramid by decade:');
const dec = new Map<number, number>();
for (const c of cs) { const k = Math.floor(ageOf(c, w.tick) / 10); dec.set(k, (dec.get(k) ?? 0) + 1); }
for (const k of [...dec.keys()].sort((a, b) => a - b)) console.log(`  ${pad(`${k * 10}-${k * 10 + 9}`, 6)} ${pad(dec.get(k)!, 5)} ${'#'.repeat(Math.round((60 * dec.get(k)!) / n))}`);

const hhSizes = new Map<number, number>();
for (const h of w.households.values()) hhSizes.set(h.ids.length, (hhSizes.get(h.ids.length) ?? 0) + 1);
console.log(`\nHousehold sizes (${w.households.size} households):`);
for (const k of [...hhSizes.keys()].sort((a, b) => a - b)) console.log(`  ${pad(k, 2)} people: ${pad(hhSizes.get(k)!, 5)}`);

const share = (f: (c: (typeof cs)[number]) => boolean) => `${((100 * cs.filter(f).length) / n).toFixed(1)}%`;
console.log(`\nHealth: mean ${(cs.reduce((s, c) => s + c.health, 0) / n).toFixed(1)}; flu ${share((c) => !!(c.cond & Cond.Flu))}, injury ${share((c) => !!(c.cond & Cond.Injury))}, chronic ${share((c) => !!(c.cond & Cond.Chronic))}, any acute ${share((c) => !!(c.cond & (Cond.Flu | Cond.Injury)))}, health < 50 ${share((c) => c.health < 50)}`);
const hist = [0, 0, 0, 0, 0];
for (const c of cs) hist[Math.min(4, Math.floor(c.health / 20))]++;
console.log(`  health histogram 0-19 / 20-39 / 40-59 / 60-79 / 80-100: ${hist.join(' / ')}`);
console.log(`Happiness: mean ${(cs.reduce((s, c) => s + c.happy, 0) / n).toFixed(1)}`);
const reasons = new Map<string, number>();
for (const c of cs) for (const p of happinessParts(c, { coverage: 3, tick: w.tick }).slice(0, 2)) { const k = (p.delta > 0 ? '+ ' : '- ') + p.label.replace(/\(.*\)/, '').trim(); reasons.set(k, (reasons.get(k) ?? 0) + 1); }
console.log('  top reasons:', [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', '));
const fr = new Map<number, number>();
for (const c of cs) fr.set(c.friends.length, (fr.get(c.friends.length) ?? 0) + 1);
console.log(`Friends per citizen: mean ${(cs.reduce((s, c) => s + c.friends.length, 0) / n).toFixed(2)}; ${[...fr.keys()].sort().map((k) => `${k}: ${fr.get(k)}`).join(', ')}`);
console.log(`Couples: ${share((c) => c.partner > 0)} of citizens have a partner; living together ${cs.filter((c) => c.partner && w.citizens.get(c.partner)?.hh === c.hh).length / 2} couples`);
console.log(`Employed adults: ${share((c) => c.job)} of all; adults ${cs.filter((c) => c.stage === LifeStage.Adult).length}, children ${cs.filter((c) => c.stage === LifeStage.Child).length}, retired ${cs.filter((c) => c.stage === LifeStage.Retired).length}`);
console.log('Totals:', JSON.stringify(sim.lifeEvents));
/** --save FILE writes the world snapshot, e.g. to serve it with WORLD_FILE=FILE PORT=8091 for a look in the client */
const saveAt = argv.indexOf('--save');
if (saveAt >= 0) { saveWorld(w, argv[saveAt + 1]); console.log(`saved world to ${argv[saveAt + 1]}`); }
