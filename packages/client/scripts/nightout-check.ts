// The night-out first-person view's rules, offline, on a fake clock (playtest f425e885: "make it a lot blurrier please - depending
// on how long they were out for"; README First person row, docs/fpv-night-out.md). Pure rules only: render/nightout.ts (activity
// string -> phase, the server's exact hours at the venue -> the swim's strength, the curve, the cap, the walk home).
// Run: npx tsx packages/client/scripts/nightout-check.ts
import { NightOut, phaseOf, swimShape, drunkOf, wordOf, walkHoursFor, BAR_ACTIVITY, HEAVY_HOURS, WALK_MIN, WALK_MAX } from '../src/render/nightout';

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---- the activity line (the fallback, and the going and coming phases) ------------------------------------------------------
{
  const act: Record<string, string> = {
    'out at a bar': 'at', 'walking out for the evening': 'going', 'driving out for the evening': 'going', 'passenger in Ann Lee\'s car, going out': 'going',
    'walking home': 'home', 'driving home': 'home', 'stuck in traffic, driving home': 'home', 'bus 12 to the Market stop, going home': 'home',
    'at the cinema': 'sober', 'at the theatre': 'sober', 'watching a performance': 'sober', 'at a premiere': 'sober', 'at the quiz night': 'sober',
    'at a café': 'sober', 'at home': 'sober', 'at home, retired': 'sober', 'on shift': 'sober', 'walking to work': 'sober', 'moving to town: walking with a suitcase from the station to their new home': 'sober',
  };
  for (const [a, p] of Object.entries(act)) ok(phaseOf(a) === p, `"${a}" is ${p}`);
  ok(BAR_ACTIVITY === 'out at a bar', 'the bar string is the one the server and the rooms use');
}

// ---- the curve: it keeps building with the hours, and is capped at three -------------------------------------------------------
{
  const v = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 8].map(drunkOf);
  let rising = true;
  for (let i = 1; i < 7; i++) if (!(v[i] > v[i - 1])) rising = false;
  ok(rising, 'strength rises through every half hour up to three');
  ok(v[0] === 0 && near(v[2], 0.22, 0.02) && near(v[4], 0.55, 0.02) && near(v[6], 1, 1e-9), `about 0.22 after an hour, 0.55 after two, full after three (${v[2].toFixed(2)}, ${v[4].toFixed(2)}, ${v[6].toFixed(2)})`);
  ok(v[7] === 1 && v[8] === 1 && HEAVY_HOURS === 3, 'and it stops there: four hours and eight are no more');
  ok(wordOf(drunkOf(1)) === 'a little tipsy' && wordOf(drunkOf(1.4)) === 'a little tipsy', 'the HUD says a little tipsy under an hour and a half');
  ok(wordOf(drunkOf(1.6)) === 'tipsy' && wordOf(drunkOf(2.4)) === 'tipsy', 'tipsy between an hour and a half and two and a half');
  ok(wordOf(drunkOf(2.6)) === 'very drunk' && wordOf(drunkOf(3)) === 'very drunk', 'very drunk above two and a half');
}

// ---- an evening on the server's exact hours -----------------------------------------------------------------------------------
{
  const feed = (n: NightOut, clock: number, hoursOut: number, at = clock) => n.update(BAR_ACTIVITY, clock, undefined, { hours: hoursOut, drinks: true, at });
  // an average drinker: a hashed id whose weight (peak) is near 1
  let id = 1;
  while (Math.abs(swimShape(id).peak - 1) > 0.03) id++;
  const n = new NightOut(id);
  n.update('walking out for the evening', 19);
  ok(n.update('walking out for the evening', 19.2, undefined, { hours: 0, drinks: true }) === 0, 'on the way out they are sober');
  const at = (h: number) => feed(new NightOut(id), 20 + h, h);
  const s = [0.5, 1, 2, 3, 4].map(at);
  ok(s.every((x, i) => i === 0 || x >= s[i - 1]), `0.5, 1, 2, 3 and 4 hours out: ${s.map((x) => x.toFixed(2)).join(', ')} rising to the cap`);
  ok(s[1] < s[2] && s[2] < s[3] && s[4] === 1 && s[3] > 0.9, 'a clear step between each hour, and the cap of 1 by the fourth');
  // the clock carries the hours on between the server's readings
  const m = new NightOut(id);
  m.update(BAR_ACTIVITY, 21, undefined, { hours: 1, drinks: true, at: 21 });
  const later = m.update(BAR_ACTIVITY, 22, undefined, { hours: 1, drinks: true, at: 21 });
  ok(near(later, drunkOf(2 * swimShape(id).peak), 1e-9), 'the reading from an hour ago, an hour on, is two hours out');
  // a fresh reading corrects it exactly (no guess in it)
  ok(near(feed(new NightOut(id), 23, 2.5), drunkOf(2.5 * swimShape(id).peak), 1e-9), 'the server\'s hours are used as they are, not the first-seen guess');
  // someone seen for the first time well into the evening is not clear
  ok(feed(new NightOut(31), 22, 2) > 0.3, 'a citizen first inspected two hours in is already tipsy');
  // the weight: lightweights get there later, heavy drinkers sooner, per the id
  let light = 1, heavy = 1;
  for (let k = 1; k < 400; k++) { const p = swimShape(k).peak; if (p < swimShape(light).peak) light = k; if (p > swimShape(heavy).peak) heavy = k; }
  const sl = feed(new NightOut(light), 22, 2), sh = feed(new NightOut(heavy), 22, 2);
  ok(sl < s[2] && sh > s[2] && swimShape(light).peak < 0.75 && swimShape(heavy).peak > 1.25, `a lightweight is less drunk at two hours (${sl.toFixed(2)}) than a heavy drinker (${sh.toFixed(2)})`);
  // a coffee, a film or a quiet drink in the afternoon is not a night
  const c = new NightOut(5);
  ok(c.update('at a café', 11, undefined, { hours: 1.5, drinks: false }) === 0, 'a café visit stays clear');
  ok(c.update(BAR_ACTIVITY, 17, undefined, { hours: 1, drinks: false }) === 0, 'and so does one the server says is no drink, whatever the line says');
  // past midnight the line says "at a café"; the server says they are still drinking
  const late = new NightOut(id);
  ok(late.update('at a café', 25, undefined, { hours: 4.5, drinks: true, at: 25 }) > 0.9, 'after midnight, when the line says café, the server\'s word keeps them swimming');
}

// ---- the fallback: no `night` from an older server --------------------------------------------------------------------------------
{
  const n = new NightOut(4242), s = n.shape;
  let h = 19; const trace: number[] = [];
  n.update('walking out for the evening', h);
  ok(n.strength === 0, 'on the way out they are sober');
  h += 0.25;
  ok(n.update(BAR_ACTIVITY, h) === 0, 'sat down at the bar: nothing yet');
  let mono = true, last = 0;
  for (let i = 0; i < 30; i++) { h += 0.1; const v = n.update(BAR_ACTIVITY, h); trace.push(v); if (v < last - 1e-9) mono = false; last = v; }
  ok(mono && trace[3] > 0 && trace[29] > trace[15], 'without the server\'s hours it still builds as the evening goes on');
  ok(near(trace[29], drunkOf(3.0 * s.peak), 1e-9), 'on the same curve (three hours in)');
  const j = new NightOut(31);
  ok(j.update(BAR_ACTIVITY, 22) > 0, 'a citizen first seen at the bar is already a little tipsy');
  const c = new NightOut(99);
  c.update('walking to the cinema', 19); let top = 0;
  for (let i = 0; i < 30; i++) top = Math.max(top, c.update('at the cinema', 19.3 + i * 0.1));
  for (let i = 0; i < 8; i++) top = Math.max(top, c.update('walking home', 22.5 + i * 0.05));
  ok(top === 0, 'an evening at the cinema, and the walk home from it, stay clear');
}

// ---- the walk home ---------------------------------------------------------------------------------------------------------------------
{
  /** the hours a walk home takes to clear a citizen who was out `out` hours (no trip info: by the clock alone) */
  const clearTime = (id: number, out: number) => {
    const n = new NightOut(id);
    n.update(BAR_ACTIVITY, 20, undefined, { hours: out, drinks: true, at: 20 });
    const set = n.strength;
    let t = 0, prev = set;
    for (; t < 3; t += 0.01) { const v = n.update('walking home', 20 + t); if (v > prev + 1e-9) return -1; prev = v; if (v === 0) break; }
    return { set, t };
  };
  let id = 1;
  while (Math.abs(swimShape(id).peak - 1) > 0.03) id++;
  const light = clearTime(id, 0.6), mid = clearTime(id, 2), heavy = clearTime(id, 3.5);
  if (typeof light === 'number' || typeof mid === 'number' || typeof heavy === 'number') ok(false, 'it only ever eases off on the walk home');
  else {
    ok(near(light.t, walkHoursFor(light.set), 0.02) && near(heavy.t, walkHoursFor(heavy.set), 0.02), `the walk home takes as long as walkHoursFor says (${light.t.toFixed(2)} h light, ${mid.t.toFixed(2)} h two hours in, ${heavy.t.toFixed(2)} h heavy)`);
    ok(light.t < mid.t && mid.t < heavy.t, 'it grows with how drunk they left');
    ok(heavy.t >= WALK_MAX - 0.02 && light.t < WALK_MIN + (WALK_MAX - WALK_MIN) * 0.35, `from about ${WALK_MIN} hours up to ${WALK_MAX}`);
  }
  // by the server's trip: never clear before the door for three hours out, and gone at the door
  const n = new NightOut(id);
  n.update(BAR_ACTIVITY, 20, undefined, { hours: 3.5, drinks: true, at: 20 });
  const a = n.update('walking home', 23, 0.6), b = n.update('walking home', 23.1, 0.95), c = n.update('walking home', 23.15, 1);
  ok(a > 0 && b > 0 && a > b && c === 0, `a long evening's view is not clear before the door (${a.toFixed(2)} at 60%, ${b.toFixed(2)} at 95%) and is at the door`);
  // a bus leg's end is not the door
  const bus = new NightOut(id);
  bus.update(BAR_ACTIVITY, 20, undefined, { hours: 3, drinks: true, at: 20 });
  const x = bus.update('bus 12 to the Market stop, going home', 23, 1);
  ok(x > 0, 'the end of a bus leg is not the door');
  // never back up on a new leg
  const m = new NightOut(7);
  m.update(BAR_ACTIVITY, 21, undefined, { hours: 2.5, drinks: true, at: 21 });
  const full = m.strength;
  const a1 = m.update('driving home', 23.51, 0.1), a2 = m.update('driving home', 23.52, 0.6), a3 = m.update('driving home', 23.53, 0.05);
  ok(a1 < full && a2 < a1 && a3 <= a2, 'the ease-off follows the trip when the server says, and never comes back up on a new leg');
  m.update('at home', 24);
  ok(m.strength === 0, 'at home they are sober');
}

// ---- the shapes (the organic rule: every citizen their own) -----------------------------------------------------------------------
{
  let pOk = true;
  const periods = new Set<number>(), blurs = new Set<number>(), peaks = new Set<number>();
  for (let id = 1; id <= 200; id++) {
    const q = swimShape(id);
    if (q.period < 3 || q.period > 5 || q.amp < 7 || q.amp > 11 || q.peak < 0.7 || q.peak > 1.3 || q.blur < 8 || q.blur > 10 || q.ghost < 14 || q.ghost > 22 || q.mix < 0.35 || q.mix > 0.5) pOk = false;
    periods.add(Math.round(q.period * 200)); blurs.add(Math.round(q.blur * 100)); peaks.add(Math.round(q.peak * 100));
  }
  ok(pOk, 'periods 3 to 5 s, sway 7 to 11 px, blur 8 to 10 px, double image 14 to 22 px, weight 0.7 to 1.3, for every citizen');
  ok(periods.size > 40 && blurs.size > 40 && peaks.size > 40, `and they differ citizen to citizen (${periods.size} periods, ${blurs.size} blurs, ${peaks.size} weights in 200)`);
}

console.log(fails ? `${fails} FAILED` : 'nightout-check: all ok');
process.exit(fails ? 1 : 0);
