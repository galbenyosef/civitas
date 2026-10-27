/**
 * Night-out probe (playtest f425e885: the first-person view blurs more the longer a citizen has been out): a test city run
 * for two days, every citizen on an ordinary outing sampled each tick through describeCitizen's `night` field
 * (hours at the venue so far, whether the drink flows) and `venueSince` (the tick they sat down), for the client's
 * render/nightout.ts.
 *
 *   npx tsx packages/server/src/loadtest/nightout.ts [--days 2.6] [--seed 1] [--districts 1]
 *
 * Checks: venueSince is set on arrival and night.hours counts from it; hours are 0 on the way there; a visit begun between
 * 04:00 and 16:00 (the morning coffee, the pre-shift stop) and a pre-shift stop at any hour do not drink; an evening visit
 * does; the doctor, a school gate or a funeral send no `night`; nobody on the street or at home does; a saved and loaded
 * world holds nobody at a venue (they resume at home), with `venueSince` cleared.
 */
import { TICKS_PER_DAY, TICKS_PER_HOUR, CitizenState as S } from '@msimcity/shared';
import { World } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity } from './cities';
import { snapshotOf, worldFromSnapshot } from '../snapshot';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const days = get('days', 2.6), seed = get('seed', 1), districts = get('districts', 1);
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(seed * 7919);

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log(`  FAIL ${what}`); } else console.log(`  ok   ${what}`); };

const w = new World(seed);
seedCity(w, { districts, built: 3 });
const sim = new Simulation(w);

// per-citizen record of the visit being watched: the tick they were first seen at the venue, and the hours the server said then
const seen = new Map<number, { since: number; arrivedHour: number; drinks: boolean; first: number; last: number; then: number }>();
let badSince = 0, badHours = 0, badTravel = 0, errandNight = 0, awayNight = 0, samples = 0, travelling = 0;
let evenings = 0, mornings = 0, preStops = 0, preStopDrinks = 0, longest = 0, drinkers = 0;
const hourSamples: string[] = [];

const total = Math.round(days * DAY);
for (let i = 0; i < total; i++) {
  sim.tick();
  if (w.tick < DAY * 0.8) continue;
  for (const c of w.citizens.values()) {
    const venue = (c.state === S.AtVenue || c.state === S.ToVenue);
    const info = venue || (i % 37 === 0) ? sim.describeCitizen(c.id) : null;
    if (!info) continue;
    samples++;
    if (!venue) { if (info.night) awayNight++; continue; }
    if (c.errand) { if (info.night) errandNight++; continue; }
    const n = info.night;
    if (!n) { badSince++; continue; }
    if (c.state === S.ToVenue) { travelling++; if (n.hours !== 0) badTravel++; continue; }
    // at the venue
    if (c.venueSince === undefined || c.venueSince > w.tick) { badSince++; continue; }
    if (Math.abs(n.hours - (w.tick - c.venueSince) / TPH) > 0.006) badHours++;
    let r = seen.get(c.id);
    if (!r || r.since !== c.venueSince) {
      r = { since: c.venueSince, arrivedHour: (c.venueSince % DAY) / TPH, drinks: n.drinks, first: n.hours, last: n.hours, then: c.venueThen };
      seen.set(c.id, r);
      if (c.venueThen === S.ToWork) { preStops++; if (n.drinks) preStopDrinks++; }
      else if (r.arrivedHour >= 16 || r.arrivedHour < 4) { evenings++; if (n.drinks) drinkers++; }
      else if (r.arrivedHour >= 4 && r.arrivedHour < 16) { mornings++; if (n.drinks) badHours += 1000; }
    }
    r.last = n.hours;
    longest = Math.max(longest, n.hours);
    if (n.drinks && n.hours > 1.5 && hourSamples.length < 3 && !hourSamples.some((s) => s.startsWith(`#${c.id} `))) hourSamples.push(`#${c.id} sat down ${r.arrivedHour.toFixed(1)}h, ${n.hours.toFixed(2)} h in, venueThen ${c.venueThen}`);
  }
}
console.log(`night-out probe: ${districts}x${districts} city, ${days} days, ${w.citizens.size} citizens, ${samples} inspects, ${seen.size} visits watched`);
console.log(`  evening visits ${evenings} (${drinkers} drinking), daytime visits ${mornings}, pre-shift stops ${preStops} (${preStopDrinks} drinking), longest stay ${longest.toFixed(2)} h, on the way there ${travelling}`);
for (const s of hourSamples) console.log(`  e.g. ${s}`);
ok(seen.size > 20, `enough visits to judge (${seen.size})`);
ok(badSince === 0, 'every citizen at an ordinary venue has venueSince (no later than now) and a night field');
ok(badHours === 0, "night.hours is the ticks since venueSince in game hours, and a daytime visit does not drink");
ok(travelling === 0 || badTravel === 0, `hours are 0 on the way there (${travelling} seen)`);
ok(errandNight === 0, 'the doctor, the school gate, a class or a funeral send no night');
ok(awayNight === 0, 'someone at home, at work or on the street sends no night');
ok(preStopDrinks === 0, 'a coffee before a shift does not drink, at any hour');
ok(evenings === 0 || drinkers === evenings, `an evening visit drinks (${drinkers} of ${evenings})`);
ok(longest > 1 && longest <= 3.2, `a visit runs one to three hours (longest ${longest.toFixed(2)})`);
let seenAny = 0;
for (const r of seen.values()) if (r.last > r.first) seenAny++;
ok(seenAny > 5, `hours grow while someone stays (${seenAny} visits watched growing)`);

// a save and load: everyone resumes at home, and venueSince does not ride along
const back = worldFromSnapshot(JSON.parse(JSON.stringify(snapshotOf(w))));
if (!back) throw new Error('the snapshot did not load');
let stale = 0, away = 0;
for (const c of back.citizens.values()) { if (c.venueSince !== undefined) stale++; if (c.state === S.AtVenue) away++; }
ok(stale === 0 && away === 0, `a loaded world has nobody at a venue and no venueSince (${back.citizens.size} citizens)`);
console.log(fails ? `${fails} FAILED` : 'nightout: all ok');
process.exit(fails ? 1 : 0);
