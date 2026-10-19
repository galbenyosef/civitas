/**
 * Policies probe (docs/education.md section 16, E6): the `setPolicy` intent through the protocol, policies in saves, and
 * the effects over a school week in the 2×2 test city of loadtest/schools.ts (free school meals, school buses, tuition
 * fees). Deterministic for a given --seed.
 *
 *   npx tsx packages/server/src/loadtest/policies.ts [--districts 2] [--days 8] [--seed 1] [--quiet] [--save FILE --until 2.2]
 *
 * `--save FILE` skips the checks: it enacts meals, buses and fees for the Commons, runs to day `--until` (fractional: 2.2
 * is Wednesday 05:00, before the first bus round) and writes the world for a live look (WORLD_FILE=FILE PORT=… npm run dev:server).
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, CitizenState as S, Terrain, EduLevel, Study, POLICY, POLICIES, POLICY_BY_ID, TECH, hash2,
  KIND_NAMES, capacityOf, familyOf, subFor, packTile, terrainOf, isRoad, planStructure, tileKey, SCHOOL_SPECS, DEFAULT_TAX, FleetKind, SCHOOLBUS,
  type ServerMsg,
  ECONOMY_TUNING,
} from '@msimcity/shared';
import { World, emptyStats, type Building, type Citizen } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity, DISTRICT, type CityLayout } from './cities';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { ageOf, stageFor, LIFE } from '../sim/life';
import { createGame } from '../game';
import { saveWorld } from '../store';
import { setPolicy } from '../policies';
import type { Conn, ConnSource } from '../transport';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const districts = get('districts', 2), days = get('days', 8), seed = get('seed', 1), familyShare = get('families', 0.3);
const quiet = argv.includes('--quiet');
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
const rnd = mulberry32(seed * 104729); // the probe's own choices, apart from the simulation's stream

let checks = 0, fails = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${what}`); } else console.log(`  ok   ${what}`); };
const pad = (v: string | number, n: number) => String(v).padStart(n);
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0).toFixed(1);
const log = (s: string) => { if (!quiet) console.log(s); };

type SchoolsApi = NonNullable<Simulation['schools']>;
const w = new World(seed);
const layout = seedCity(w, { districts, built: 3 });
const sim = new Simulation(w);
const schools: SchoolsApi = sim.schools;
const priv = sim as unknown as { makeCitizen(id: number, home: Building, age: number, health: number): Citizen; findJob(c: Citizen): boolean };

// ---- the schools ---------------------------------------------------------------------------------------------------
const env = { tile: (x: number, y: number) => w.peekTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y), land: () => null };
const clear = (x0: number, y0: number, wd: number, ht: number) => {
  for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wd; x++) {
    const t = w.getTile(x, y);
    if (!isRoad(t)) w.setTile(x, y, packTile(terrainOf(t) === Terrain.Water ? Terrain.Grass : terrainOf(t), false, 0, 0));
  }
};
const placed: { kind: number; x: number; y: number }[] = [];
/** A school on the 4×4 block at (x0, y0) (cleared first), its door on an edge tile facing the street. */
function placeOnBlock(kind: number, x0: number, y0: number): boolean {
  clear(x0, y0, 4, 4);
  const fits = (p: { ax: number; ay: number; w: number; h: number }) => p.ax >= x0 && p.ay >= y0 && p.ax + p.w <= x0 + 4 && p.ay + p.h <= y0 + 4;
  for (let i = 0; i < 16; i++) {
    const x = x0 + (i % 4), y = y0 + Math.floor(i / 4);
    if (SCHOOL_SPECS[kind] && kind === 101) { // one tile: zoned as a civic lot is, built at once
      if (![[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => isRoad(w.getTile(x + dx, y + dy)))) continue;
      w.setTile(x, y, packTile(terrainOf(w.getTile(x, y)), false, familyOf(kind), 1), subFor(kind));
      placed.push({ kind, x, y });
      return true;
    }
    const v = planStructure(kind, x, y, env);
    if (!v.ok || !fits(v.placed)) continue;
    w.placeStructure(v.placed, { work: 0, priority: 0, built: true });
    placed.push({ kind, x: v.placed.doorX, y: v.placed.doorY });
    return true;
  }
  return false;
}
function placeSchools(L: CityLayout) {
  const want: number[] = [];
  for (let i = 0; i < L.districts.length; i++) want.push(102, 103, 101);
  want.push(104, 105);
  const slots = [[1, 1], [2, 2], [2, 1], [1, 2], [0, 0], [3, 3]];
  const used = L.districts.map(() => 0);
  for (let k = 0; k < want.length; k++) {
    const di = k % L.districts.length, d = L.districts[di];
    const [bx, by] = slots[used[di]++ % slots.length];
    if (!placeOnBlock(want[k], d.x + 5 * bx + 1, d.y + 5 * by + 1)) console.log(`  could not place ${KIND_NAMES[want[k]]} in district ${di}`);
  }
  // the campus: a parcel south of the city, along its last street
  const y0 = L.y0 + L.span, x0 = L.x0 + 2, wd = 16, ht = 8;
  const owner = w.players.get('sys')!;
  const parcel = { id: w.nextId++, owner: owner.id, name: 'University Quarter', x: x0, y: y0, w: wd, h: ht, taxRate: DEFAULT_TAX, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wd; x++) w.setParcelId(x, y, parcel.id);
  clear(x0, y0, wd, ht);
  for (const [kind, dx] of [[106, 3], [108, 9], [107, 13]] as const) {
    const v = planStructure(kind, x0 + dx, y0, env);
    if (!v.ok) { console.log(`  could not place ${KIND_NAMES[kind]}: ${v.reason}`); continue; }
    w.placeStructure(v.placed, { work: 0, priority: 0, built: true });
    placed.push({ kind, x: v.placed.doorX, y: v.placed.doorY });
  }
}
placeSchools(layout);

// ---- families: two adults and 1-3 children in a share of the homes with room -------------------------------------------
let famN = 0, kidN = 0;
const homes = [...w.buildings.values()].filter((b) => familyOf(b.id) === 1 && b.level > 0 && capacityOf(b.id, b.level) >= 4);
for (const home of homes) for (let f = 0; f < 4; f++) { // a family for every few beds, by chance
  if (rnd() >= familyShare) continue;
  const room = capacityOf(home.id, home.level) - home.occupants;
  if (room < 3) break;
  const kids = Math.min(room - 2, 1 + Math.floor(rnd() * 3));
  const add = (age: number) => {
    const c = priv.makeCitizen(w.nextId++, home, age, 75 + 20 * rnd());
    w.addCitizen(c);
    home.occupants++;
    return c;
  };
  const a = add(28 + rnd() * 16), b = add(28 + rnd() * 16);
  a.partner = b.id; b.partner = a.id; w.setHousehold(b, a.hh);
  for (let i = 0; i < kids; i++) {
    const k = add(rnd() * 18);
    k.stage = stageFor(k.id, ageOf(k, w.tick)); k.car = false; k.money = 0; k.par = a.id; k.sn = a.sn;
    w.setHousehold(k, a.hh);
    kidN++;
  }
  priv.findJob(a); priv.findJob(b);
  famN++;
}
log(`Policies probe: ${districts}×${districts} districts, seed ${seed}, ${placed.length} schools placed, ${famN} families with ${kidN} children seeded`);


// ---- A. the intent over the protocol (a fresh player, no technology, then enough, then enough money) ------------------------
{
  class FakeConn implements Conn {
    open = true; got: ServerMsg[] = []; private fn: ((d: string) => void) | null = null;
    send(d: string) { this.got.push(JSON.parse(d)); }
    close() { this.open = false; }
    onMessage(fn: (d: string) => void) { this.fn = fn; }
    onClose() { /* never */ }
    say(m: object) { this.fn!(JSON.stringify(m)); }
    toasts() { return this.got.filter((m) => m.t === 'toast') as Extract<ServerMsg, { t: 'toast' }>[]; }
    me(): { policies?: string[]; money: number } | undefined { const m = [...this.got].reverse().find((x) => x.t === 'players') as Extract<ServerMsg, { t: 'players' }> | undefined; return m?.players.find((p) => p.id === 'pol'); }
  }
  let accept: ((c: Conn) => void) | null = null;
  const source: ConnSource = { onConnection(fn) { accept = fn; } };
  const w0 = new World(5);
  seedCity(w0, { districts: 1, built: 2 });
  const game = createGame(w0, source, { devTools: false, sandbox: false });
  const conn = new FakeConn();
  accept!(conn);
  conn.say({ t: 'hello', name: 'Pol' });
  const p = w0.players.get('pol')!;
  const last = () => conn.toasts().at(-1)?.msg ?? '';
  const money0 = p.money;
  conn.say({ t: 'setPolicy', id: 'meals', on: true });
  ok(!p.policies?.length && /needs/i.test(last()), `no technology: refused (${last()})`);
  conn.say({ t: 'setPolicy', id: 'nonsense', on: true });
  ok(!p.policies?.length && /No such policy/.test(last()), `an unknown policy: refused (${last()})`);
  conn.say({ t: 'setPolicy', id: 'meals' }); // no `on`: off, which it already is
  ok(!p.policies?.length, 'a message without `on` turns nothing on');
  p.tech = ['civ1', 'edu1', 'edu2'];
  p.money = POLICY_BY_ID.get('meals')!.setup - 1 - ECONOMY_TUNING.overdraftLimit; // the overdraft line counts (sim/finance.ts)
  conn.say({ t: 'setPolicy', id: 'meals', on: true });
  ok(!p.policies?.length && p.money === POLICY_BY_ID.get('meals')!.setup - 1 - ECONOMY_TUNING.overdraftLimit && /Need \$120/.test(last()), `edu2 but short of the $120 fee with the overdraft: refused, nothing charged (${last()})`);
  conn.say({ t: 'setPolicy', id: 'learning', on: true });
  p.money = 1000;
  conn.say({ t: 'setPolicy', id: 'learning', on: true });
  ok(!p.policies?.length && p.money === 1000 && /needs Further education/.test(last()), `adult learning needs edu3 even with money (${last()})`);
  conn.say({ t: 'setPolicy', id: 'meals', on: true });
  ok(p.policies?.join() === 'meals' && p.money === 1000 - POLICY_BY_ID.get('meals')!.setup && last() === 'Free school meals enacted', `meals on: ${p.policies}, $${p.money}, "${last()}"`);
  game.step();
  ok(conn.me()?.policies?.join() === 'meals', 'the players message carries PlayerDTO.policies');
  const m1 = p.money;
  conn.say({ t: 'setPolicy', id: 'meals', on: true });
  ok(p.money === m1 && p.policies!.length === 1, 'switching it on again charges nothing and does not double up');
  p.tech.push('edu3');
  conn.say({ t: 'setPolicy', id: 'learning', on: true });
  conn.say({ t: 'setPolicy', id: 'meals', on: false });
  ok(p.policies?.join() === 'learning' && p.money === m1 - POLICY_BY_ID.get('learning')!.setup, `two switches: ${p.policies}, turning one off is free`);
  ok(p.money <= money0, 'the treasury paid for the fees');
  // a sandbox player has every technology: all five can be enacted
  const ws = new World(6); seedCity(ws, { districts: 1, built: 1 });
  let acc2: ((c: Conn) => void) | null = null;
  createGame(ws, { onConnection(fn) { acc2 = fn; } }, { devTools: false, sandbox: true });
  const c2 = new FakeConn(); acc2!(c2); c2.say({ t: 'hello', name: 'Pol' });
  for (const d of POLICIES) c2.say({ t: 'setPolicy', id: d.id, on: true });
  ok(ws.players.get('pol')!.policies?.length === POLICIES.length, `a sandbox player (every technology) enacts all ${POLICIES.length}`);
  // a read-only showcase refuses it
  const wv = new World(7); seedCity(wv, { districts: 1, built: 1 });
  let acc3: ((c: Conn) => void) | null = null;
  createGame(wv, { onConnection(fn) { acc3 = fn; } }, { devTools: false, sandbox: true, spectate: true });
  const c3 = new FakeConn(); acc3!(c3); c3.say({ t: 'hello', name: 'Pol' });
  c3.say({ t: 'setPolicy', id: 'meals', on: true });
  ok(!wv.players.get('pol')?.policies?.length, `a spectator cannot enact one (${c3.toasts().at(-1)?.msg})`);
  // every policy's feature is unlocked by exactly one education node
  ok(POLICIES.every((d) => TECH.filter((t) => t.unlocks.includes(d.feature)).length === 1 && TECH.find((t) => t.unlocks.includes(d.feature))!.track === 'education'), 'each policy is opened by one node of the education track');

  // ---- saves: policies round-trip, junk is dropped, an old save without them loads ----
  const snap = JSON.parse(JSON.stringify(snapshotOf(w0)));
  const back = worldFromSnapshot(snap)!;
  ok(back.players.get('pol')!.policies?.join() === 'learning', 'a save keeps Player.policies');
  const bad = JSON.parse(JSON.stringify(snap));
  bad.players.find((q: { id: string }) => q.id === 'pol').policies = ['learning', 'bogus', 7];
  ok(worldFromSnapshot(bad)!.players.get('pol')!.policies?.join() === 'learning', 'unknown policy ids in a save are dropped');
  const old = JSON.parse(JSON.stringify(snap));
  for (const q of old.players) delete q.policies;
  const oldW = worldFromSnapshot(old)!;
  ok(oldW.players.get('pol')!.policies === undefined && oldW.playerDTO(oldW.players.get('pol')!, false).policies!.length === 0, 'an old save without policies loads, and its DTO says none');
  const sim0 = new Simulation(oldW);
  for (let i = 0; i < 50; i++) sim0.tick();
  ok(true, 'the old world runs');
}

// ---- B. effects over a school week in the 2×2 city ------------------------------------------------------------------------
const sys = w.players.get('sys')!;
sys.money = 1e6;
for (const id of ['meals', 'buses', 'fees']) { const r = setPolicy(w, sys, id, true); if (!r.ok) console.log(`  could not enact ${id}: ${r.msg}`); }
ok(sys.policies?.join() === 'meals,buses,fees', 'the Commons enacted meals, buses and fees');
if (argv.includes('--save')) {
  const file = argv[argv.indexOf('--save') + 1], until = get('until', 2.2);
  for (let i = 0; i < until * DAY; i++) sim.tick();
  saveWorld(w, file);
  console.log(`saved the world at day ${until} to ${file}: ${w.citizens.size} citizens; schools ${placed.map((p) => `${KIND_NAMES[p.kind]} (${p.x}, ${p.y})`).join(', ')}`);
  process.exit(0);
}
const ledgerLog: string[] = [];
const credits: { tick: number; amt: number; cat: string }[] = [];
const credit0 = w.credit.bind(w);
w.credit = (id: string, amt: number, cat?: Parameters<typeof credit0>[2]) => { if (id === 'sys') credits.push({ tick: w.tick, amt, cat: cat ?? (amt >= 0 ? 'tax' : 'upkeep') }); return credit0(id, amt, cat); };
const uni = placed.find((p) => p.kind === 106);
let mealsExpected = -1, mealsPaid = -2, feesOn = 0, grants = 0;
let tried = 0, took = 0, shouldBeDeterred = 0, deterred = 0;
const busesSeen = { max: 0, aboardMax: 0, riders: new Set<number>() };
for (let i = 0; i < days * DAY; i++) {
  const day = Math.floor(w.tick / DAY), h = (w.tick % DAY) / TPH, weekday = day % 7;
  // the Wednesday midnight (day 2): count the pupils who will be fed, then see what was charged
  if (w.tick === 3 * DAY - 1) {
    schools.census();
    mealsExpected = [...w.citizens.values()].filter((c) => c.study && c.study <= Study.SixthForm && schools.onMeals(c)).length;
  }
  // tuition fees: at 06:00 on day 0 try 24 would-be students; the fees policy turns the same people away that hash says (30%)
  if (w.tick === 6 * TPH && uni) {
    const ub = w.buildings.get(tileKey(uni.x, uni.y))!;
    (schools.list().find((s) => s.b === ub) as { staffing: number }).staffing = 1; // staffed, so only the policy can turn anyone away
    for (const c of w.citizens.values()) {
      if (tried >= 24) break;
      const age = ageOf(c, w.tick);
      if (c.mig || c.study || age < 19 || age > 21 || c.state !== S.Home) continue;
      w.quitJob(c);
      if (c.edu < EduLevel.Further) Object.assign(c, { edu: EduLevel.Further, track: 1 });
      tried++;
      const hashed = hash2(c.id, 249) < POLICY.feeDeter;
      if (hashed) shouldBeDeterred++;
      const got = schools.enrolAt(c, ub, Study.Degree);
      if (got) { took++; c.due = 10; c.att = 9; } else deterred++;
      if (got === hashed) console.log(`  (citizen ${c.id}: hash says ${hashed ? 'deterred' : 'admitted'}, enrolAt ${got})`);
    }
  }
  if (day === 5 && w.tick % DAY === 0) { setPolicy(w, sys, 'fees', false); }
  sim.tick();
  if (w.tick % DAY === 1) { // right after a midnight: what the schools billed
    const mid = credits.filter((c) => c.tick === w.tick - 1 || c.tick === w.tick);
    const fee = mid.filter((c) => c.cat === 'fees').reduce((s, c) => s + c.amt, 0);
    if (fee > 0) feesOn += fee; else if (fee < 0) grants += fee;
    if (day === 3) mealsPaid = mid.filter((c) => c.cat === 'upkeep' && Math.abs(-c.amt - mealsExpected * POLICY.mealsPerPupil) < 1e-6).length;
  }
  if (weekday < 5 && h >= 6.5 && h < 9 && w.tick % 5 === 0) {
    const n = [...sim.mobile.units.values()].filter((u) => u.kind === FleetKind.SchoolBus).length;
    busesSeen.max = Math.max(busesSeen.max, n);
    for (const u of sim.mobile.units.values()) if (u.kind === FleetKind.SchoolBus) busesSeen.aboardMax = Math.max(busesSeen.aboardMax, sim.mobile.schoolBuses.aboard(u).length);
  }
}
const sb = sim.mobile.schoolBuses.stats;
const drivers = [...w.citizens.values()].filter((c) => c.job && sim.mobile.roleOf(c)?.kind === FleetKind.SchoolBus);
console.log(`\nBuses: ${drivers.length} drivers on the staff of secondary schools; ${sb.rounds} rounds, ${sb.empty} schools with nobody to collect, ${sb.boarded} boarded, ${sb.delivered} set down at school (${sb.late} after their school day had ended), $${sb.charged} charged; at most ${busesSeen.max} buses out at once, ${busesSeen.aboardMax} pupils aboard one`);
console.log(`Meals: ${mealsExpected} pupils fed on the Wednesday, ${mealsPaid ? 'billed exactly' : 'NOT billed'} $${(mealsExpected * POLICY.mealsPerPupil).toFixed(2)}. Fees: +$${feesOn.toFixed(0)} income while on, ${grants.toFixed(0)} in grants after switching off. University places: ${took} of ${tried} taken (hash says ${shouldBeDeterred} turned away, ${deterred} were)`);
console.log('\nChecks (effects):');
ok(drivers.length > 0, `secondary school staff include bus drivers (${drivers.length})`);
ok(sb.rounds > 0 && sb.boarded > 0, `the buses ran: ${sb.rounds} rounds carrying ${sb.boarded} pupils`);
ok(sb.delivered + sb.late === sb.boarded && sb.delivered >= 0.8 * sb.boarded, `every pupil who boarded was set down (${sb.delivered} in time for school, ${sb.late} late, of ${sb.boarded})`);
ok(sb.charged === sb.rounds * POLICY.busPerDay, `the owner paid $${POLICY.busPerDay} a bus that ran ($${sb.charged})`);
ok(busesSeen.max > 0 && busesSeen.aboardMax > 0, `buses were on the road with pupils aboard (${busesSeen.max} out, ${busesSeen.aboardMax} aboard)`);
ok([...sim.mobile.units.values()].every((u) => u.kind !== FleetKind.SchoolBus || u.v.cls === 3), 'a school bus is a bus-class vehicle');
ok(mealsExpected > 0 && mealsPaid === 1, `school meals billed for each pupil fed: ${mealsExpected} × $${POLICY.mealsPerPupil}`);
ok(feesOn > 0 && grants < 0, `tuition fees: income while on (+$${feesOn.toFixed(0)}), a grant when off (${grants.toFixed(0)})`);
ok(tried > 10 && deterred === shouldBeDeterred, `tuition fees turn away the hashed ${Math.round(POLICY.feeDeter * 100)}% of would-be students (${deterred} of ${tried}, hash ${shouldBeDeterred})`);
ok(schools.list().every((s) => s.meals && !s.fees), 'the census sees meals on and (after day 5) fees off at every school');
{
  const pupil = [...w.citizens.values()].find((c) => c.study && c.study <= Study.SixthForm);
  ok(!!pupil && schools.onMeals(pupil) && schools.drainMul(pupil) === 1, 'hooks for E4: onMeals(pupil) true, drainMul 1 with fees off');
  setPolicy(w, sys, 'fees', true);
  ok(!!pupil && schools.drainMul(pupil) === POLICY.feeDrainMul, `drainMul is ${POLICY.feeDrainMul} with fees on`);
}
// a bus that stays off the road with the policy off
{
  setPolicy(w, sys, 'buses', false);
  const before = sb.rounds;
  for (let i = 0; i < 2 * DAY; i++) sim.tick();
  ok(sb.rounds === before, 'with School buses off no round is sent');
  ok([...w.citizens.values()].every((c) => !(c.study && c.state === S.Work && !c.job && c.x === 0)), 'nobody is left stranded');
}
// the loaded world
{
  const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
  const back = worldFromSnapshot(snap)!;
  ok(back.players.get('sys')!.policies?.join() === sys.policies?.join(), `a save keeps the Commons' policies (${sys.policies})`);
  const bsim = new Simulation(back);
  let threw = '';
  try { for (let i = 0; i < 3 * TPH; i++) bsim.tick(); } catch (e) { threw = String(e); }
  ok(!threw, `the loaded world runs${threw ? `: ${threw}` : ''}`);
}
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
