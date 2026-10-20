/**
 * Adverts probe (docs/adverts.md slice 1: A1 slots, A2 campaigns and rent, the wear formula A3 draws; server
 * sim/adverts.ts). A 2×1 city of level-3 districts filled for a day; district A2 is handed to a player who runs adverts.
 *
 *   npx tsx packages/server/src/loadtest/adverts.ts [--seed 1] [--days 4] [--quiet]
 *
 * 1. slots: frames stand on the map (by size), none on homes, and side-wall frames facing a neighbour's wall are refused;
 * 2. campaigns: locked until Advertising; artwork charged under 'ads'; claims only from the table, names from the
 *    player's own land; at most AD.maxCampaigns;
 * 3. rent: renting the nearest free frames charges the first day, a frame on another owner's parcel pays that owner, a
 *    taken frame is refused, and each midnight charges again ('ads' in both ledgers);
 * 4. wear: posters age once a day at their area's rate; a neglected area's rate tags a poster within a few days, a
 *    well-served one keeps it clean; every poster wears its own way (the seeds);
 * 5. endings: a poster whose building is pulled down comes down at midnight, and so do an unpaid renter's;
 * 6. the goal "Run your first campaign" measures unlock, campaign and frames; the first poster is a milestone;
 * 7. spectate refuses the intents; a save with rentals loads with them, and a save without adverts loads with none;
 * 8. cost: Adverts.tick over the run (a day check) and the daily pass;
 * 9. big screens (docs/adverts.md section 9): a big screens corner placed on a street corner has six screen slots, open,
 *    rented only by picking (never by "the nearest free"), at the screen rent, never wearing; its ring of turns puts the
 *    renting campaigns in their turns, house adverts in the rest and the news in the last unrented one.
 * Prints pass/fail counts; exits 1 on any failure.
 */
import {
  TICKS_PER_DAY, AD, AD_CLAIMS, AD_SIZE, packTile, terrainOf, AD_STRIDE, AD_SIZES, Zone, tileKey, adHostAt, adSlotOpen, adWear, adAge, adSeed, adAreaRate, packLook, ECONOMY_TUNING,
  KIND_ID, HOUSE_ADS, isRoad, isScreenSlot, screenTurns, placedFromDoor, workOf,
  type AdEnv, type ServerMsg,
} from '@msimcity/shared';
import { World } from '../world';
import { seedCity } from './cities';
import { createGame } from '../game';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import { Onboarding } from '../goals';
import { Ranks } from '../ranks';
import type { Conn } from '../transport';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const seed = get('seed', 1), DAYS = get('days', 4);
const quiet = argv.includes('--quiet');
const DAY = TICKS_PER_DAY;
const log = (s: string) => { if (!quiet) console.log(s); };
let checks = 0, fails = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) fails++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
Math.random = mulberry32(seed * 7919);
const w = new World(seed);
const layout = seedCity(w, { districts: 2, built: 3 });
const g = createGame(w, { onConnection() {} }, { devTools: false, sandbox: false });
g.fires.enabled = false;
for (let i = 0; i < 1.1 * DAY; i++) g.step();
// district A2 (the east one of the top row) goes to a player
const mine = w.parcels.get(layout.districts[1].parcelId)!;
const p = w.getOrCreatePlayer('admaker', 'Ad Maker', 20000);
mine.owner = p.id;
p.tech = ['zon1'];
const sys = w.players.get('sys')!;
const env: AdEnv = { tile: (x, y) => w.peekTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y) };
const ads = g.adverts;
const ledger = (id: string) => w.ledgerDTO(w.players.get(id)!).today.ads ?? 0;

console.log('1. slots on the map');
const bySize: Record<string, number> = {};
let homes = 0, closed = 0;
const open: { x: number; y: number; i: number; owner: string }[] = [];
let closedSlot: [number, number, number] | null = null;
for (const b of w.buildings.values()) {
  const h = adHostAt(env, b.x, b.y);
  if (!h) continue;
  if (b.zone === Zone.Residential && b.level > 0) homes++; // a home being built has its site's hoarding: that is fine
  for (let i = 0; i * AD_STRIDE < h.slots.length; i++) {
    const s = AD_SIZES[h.slots[i * AD_STRIDE + 1]];
    if (adSlotOpen(env, h, i, b.x, b.y)) { bySize[s] = (bySize[s] ?? 0) + 1; open.push({ x: b.x, y: b.y, i, owner: w.parcelAt(b.x, b.y)?.owner ?? '' }); } else { closed++; closedSlot ??= [b.x, b.y, i]; }
  }
}
log(`  open frames by size ${JSON.stringify(bySize)}, ${closed} facing a neighbour's wall`);
ok(open.length >= 4, `frames stand on the map (${open.length} open)`);
ok(homes === 0, 'no frames on homes');

console.log('2. campaigns');
const placeClaim = AD_CLAIMS.findIndex((c) => c.needs === 'place');
const locked = ads.create(p, { theme: AD_CLAIMS[placeClaim].theme, claim: placeClaim, look: 0, target: { kind: 'parcel', id: mine.id } }, false);
ok(typeof locked === 'string' && /Advertising/.test(locked), `locked before Advertising (${typeof locked === 'string' ? locked : 'made'})`);
p.tech.push('adv1');
const notMine = ads.create(p, { theme: AD_CLAIMS[placeClaim].theme, claim: placeClaim, look: 0, target: { kind: 'parcel', id: layout.districts[0].parcelId } }, false);
ok(typeof notMine === 'string', 'a claim naming someone else\'s parcel is refused');
const wrongTheme = ads.create(p, { theme: (AD_CLAIMS[placeClaim].theme + 1) % 6, claim: placeClaim, look: 0 }, false);
ok(typeof wrongTheme === 'string', 'a claim from another theme is refused');
const money0 = p.money;
const c1 = ads.create(p, { theme: AD_CLAIMS[placeClaim].theme, claim: placeClaim, look: packLook(1, 2, 3), target: { kind: 'parcel', id: mine.id } }, false);
ok(typeof c1 !== 'string' && c1.text.includes(mine.name), `campaign made: "${typeof c1 === 'string' ? c1 : c1.text}"`);
ok(Math.abs(money0 - p.money - AD.campaignCost) < 1e-6 && ledger(p.id) === -AD.campaignCost, `artwork charged ${AD.campaignCost} under 'ads'`);
const cid = typeof c1 === 'string' ? -1 : c1.id;
for (let k = 1; k < AD.maxCampaigns; k++) ads.create(p, { theme: 1, claim: AD_CLAIMS.findIndex((c) => c.needs === null), look: k }, false);
ok(typeof ads.create(p, { theme: 1, claim: AD_CLAIMS.findIndex((c) => c.needs === null), look: 0 }, false) === 'string', `at most ${AD.maxCampaigns} campaigns`);
for (const c of ads.campaignList()) if (c.owner === p.id && c.id !== cid) ads.end(p, undefined, c.id, true);

// the ranks record begins before the first poster, so the first poster is a milestone of its own
const ranks = new Ranks(w);
ranks.check(p);
console.log('3. rent');
const m1 = p.money, sys1 = sys.money;
// a frame on the Commons' land (another owner) and one on the player's own
const theirs = open.find((s) => s.owner === 'sys'), own = open.find((s) => s.owner === p.id);
const r1 = ads.rent(p, cid, theirs ? [[theirs.x, theirs.y, theirs.i]] : [], undefined);
const rentOf = (s: { x: number; y: number; i: number }) => AD_SIZES[adHostAt(env, s.x, s.y)!.slots[s.i * AD_STRIDE + 1]];
ok(typeof r1 !== 'string' && r1.n === 1, `rented a frame on the Commons' land (${typeof r1 === 'string' ? r1 : r1.n})`);
const rent1 = theirs ? AD_SIZE[rentOf(theirs)].rent : 0;
ok(Math.abs(m1 - p.money - rent1) < 1e-6 && Math.abs(sys.money - sys1 - rent1) < 1e-6, `the first day's rent ($${rent1}) went from the renter to the parcel owner`);
const taken = theirs ? ads.rent(p, cid, [[theirs.x, theirs.y, theirs.i]], undefined) : '';
ok(typeof taken === 'string' && /taken/.test(taken), 'a taken frame is refused');
if (closedSlot) ok(typeof ads.rent(p, cid, [closedSlot], undefined) === 'string', 'a frame facing a neighbour\'s wall is refused');
const m2 = p.money;
if (own) ads.rent(p, cid, [[own.x, own.y, own.i]], undefined);
ok(!own || Math.abs(m2 - p.money) < 1e-6, 'a frame on your own frontage costs nothing (the rent comes back)');
const near = ads.rent(p, cid, undefined, { x: mine.x + 10, y: mine.y + 10, n: 3 });
ok(typeof near !== 'string' && near.n >= 1, `rented the nearest free frames (${typeof near === 'string' ? near : near.n})`);
const ledgerSys = ledger('sys');
ok(ledgerSys > 0, `the Commons' ledger shows rent in under 'ads' ($${ledgerSys})`);

console.log('6. the tutorial goal and the milestone');
const onb = new Onboarding(w, g.sim.traffic);
const st = { done: ['plot', 'road', 'camp', 'homes', 'yard', 'res12', 'shops', 'res50', 'masonry', 'cover', 'leisure'] } as never;
p.onboarding = st;
const gm = onb.check(p).msg;
const goals = gm.t === 'goals' ? gm.goals : null;
ok(!!goals && (goals.active === 'adverts' || gm.completed?.id === 'adverts'), `the goal after "Somewhere to go" is "Run your first campaign" (${goals?.active}${gm.completed ? `, completed ${gm.completed.id}` : ''})`);
ok(!!gm.completed && gm.completed.id === 'adverts', `it completes with Advertising, a campaign and ${ads.list().length} frames rented`);
g.step(); // a rank check is measured once a tick
const rk = ranks.check(p).msg;
ok(rk.t === 'rank' && (rk.rank.feed.some((m) => /first poster/i.test(m.text)) || !!rk.fresh?.some((m) => /first poster/i.test(m.text))), 'the milestone feed has "Your first poster goes up"');

console.log('4. wear over the days, and 8. cost');
const rentals0 = ads.list().length;
const ages0 = new Map(ads.list().map((r) => [`${r.x},${r.y}#${r.i}`, r.age]));
const paid0 = ads.stats.rentPaid, gone0 = ads.stats.gone;
let expected = 0;
const rentNow = () => ads.list().reduce((a, r) => a + AD_SIZE[AD_SIZES[r.s]].rent, 0);
let t0 = performance.now(), ticks = 0;
const tickMs = { sum: 0 };
const orig = ads.tick.bind(ads);
ads.tick = () => { const a = performance.now(); orig(); tickMs.sum += performance.now() - a; };
for (let d = 0; d < DAYS; d++) {
  for (let i = 0; i < DAY; i++) { if (w.tick % DAY === DAY - 1) expected += rentNow(); g.step(); ticks++; }
  const ws = ads.list().map((r) => adWear(adAge(r.age, r.rate, r.at, w.tick), adSeed(r.x, r.y, r.i, r.c)));
  log(`  day ${w.day}: ${ws.length} posters, wear ${ws.map((x) => x.toFixed(2)).join(' ')}, rates ${ads.list().map((r) => r.rate.toFixed(3)).join(' ')}`);
}
const wall = performance.now() - t0;
ok(ads.stats.unpaid === 0 && ads.list().length === rentals0 - (ads.stats.gone - gone0), `every poster still up after ${DAYS} days but those whose building was rebuilt (${ads.list().length} up, ${ads.stats.gone - gone0} came down with their wall)`);
ok(ads.list().every((r) => r.age > (ages0.get(`${r.x},${r.y}#${r.i}`) ?? 0)), 'every poster aged');
const paid = ads.stats.rentPaid - paid0;
ok(paid > 0 && Math.abs(paid - expected) <= 10, `rent charged each midnight: $${paid} over ${DAYS} days, $${expected} due on the posters up at each midnight`);
const bad = adAreaRate(0.35, 0, 0, 'poster'), good = adAreaRate(0.02, 3, 2, 'poster');
const after = (rate: number, days: number, s: number) => adWear(rate * days, s);
ok(after(bad, 3, 0.5) > 0.6 && after(good, 3, 0.5) < 0.08, `a neglected area tags a poster within 3 days (wear ${after(bad, 3, 0.5).toFixed(2)}), a well-served one keeps it clean (${after(good, 3, 0.5).toFixed(2)}); weeks: ${after(good, 21, 0.5).toFixed(2)}`);
const seeds = new Set(ads.list().map((r) => adSeed(r.x, r.y, r.i, r.c).toFixed(4)));
ok(seeds.size === ads.list().length, 'every poster has its own seed (wear rate, tags, tears, tilt)');
console.log(`  cost: Adverts.tick ${tickMs.sum.toFixed(2)} ms over ${ticks} ticks (${((tickMs.sum / ticks) * 1000).toFixed(2)} µs a tick), the whole sim ${wall.toFixed(0)} ms`);
ok(tickMs.sum / ticks < 0.05, 'Adverts.tick costs nothing worth measuring (under 0.05 ms a tick, the daily pass included)');

console.log('9. big screens');
{
  // a big screens corner on a corner of the player's district: its front and its right side on roads, the lots cleared
  const k = KIND_ID['big-screens'];
  const road = (x: number, y: number) => { const t = w.peekTile(x, y); return t !== undefined && isRoad(t); };
  let placed: ReturnType<typeof placedFromDoor> | null = null;
  for (let y = mine.y; y < mine.y + mine.h && !placed; y++) for (let x = mine.x; x < mine.x + mine.w && !placed; x++) for (let r = 0; r < 4 && !placed; r++) {
    const q = placedFromDoor(k, x, y, r);
    if (!road(q.frontX, q.frontY)) continue;
    // the curve turns to the right side (model +x): that side's neighbours want a road too
    const right = [[0, 1], [1, 0], [0, -1], [-1, 0]][(r + 1) & 3];
    let fine = true, corner = false;
    for (let ty = q.ay; ty < q.ay + q.h; ty++) for (let tx = q.ax; tx < q.ax + q.w; tx++) {
      if (road(tx, ty) || w.auxAt(tx, ty) || w.parcelAt(tx, ty)?.id !== mine.id) fine = false;
      if (road(tx + right[0], ty + right[1]) && !(tx + right[0] >= q.ax && tx + right[0] < q.ax + q.w && ty + right[1] >= q.ay && ty + right[1] < q.ay + q.h)) corner = true;
    }
    if (fine && corner) placed = q;
  }
  ok(!!placed, `a corner for the big screens in district A2 (${placed ? `door ${placed.doorX}, ${placed.doorY}, turn ${placed.r}` : 'none'})`);
  if (placed) {
    for (let ty = placed.ay; ty < placed.ay + placed.h; ty++) for (let tx = placed.ax; tx < placed.ax + placed.w; tx++) w.setTile(tx, ty, packTile(terrainOf(w.getTile(tx, ty)), false, 0, 0));
    w.placeStructure(placed, { work: workOf(k, 1), priority: 1, built: true });
    const dx = placed.doorX, dy = placed.doorY, h = adHostAt(env, dx, dy);
    const screens = h ? Array.from({ length: h.slots.length / AD_STRIDE }, (_, i) => i).filter((i) => isScreenSlot(h.slots, i)) : [];
    ok(screens.length === AD.screenTurns && screens.every((i) => adSlotOpen(env, h!, i, dx, dy)), `${screens.length} big screens, all open to the street`);
    // "the nearest free frames" never takes a screen; picking one does, at the screen's rent, and it never wears
    const near2 = ads.rent(p, cid, undefined, { x: dx, y: dy, n: 12 });
    ok(!ads.list().some((r) => r.x === dx && r.y === dy), `renting the nearest frames to the corner leaves its screens alone (${typeof near2 === 'string' ? near2 : `${near2.n} other frames`})`);
    // (the corner is on the player's own land, so the rent comes back to them: the first day's charge is what is checked)
    const r3 = ads.rent(p, cid, [[dx, dy, screens[2]]], undefined);
    const got = ads.list().find((r) => r.x === dx && r.y === dy && r.i === screens[2]);
    ok(typeof r3 !== 'string' && !!got && r3.cost === AD_SIZE.screen.rent, `a screen's turn rents at $${AD_SIZE.screen.rent} a day, ${AD_SIZE.screen.rent / AD_SIZE.billboard.rent} times a billboard (${typeof r3 === 'string' ? r3 : `charged $${r3.cost}`})`);
    for (let i = 0; i < DAY; i++) g.step();
    const after1 = ads.list().find((r) => r.x === dx && r.y === dy && r.i === screens[2]);
    ok(!!after1 && after1.rate === 0 && adWear(adAge(after1.age, after1.rate, after1.at, w.tick), 0.5) === 0, 'a screen never wears (rate 0 after a midnight)');
    // the ring: the renting campaigns in their turns, house adverts and the news in the rest
    const rented = screens.map((i) => ads.list().find((r) => r.x === dx && r.y === dy && r.i === i)?.c ?? null);
    const ring = screenTurns(rented, 0.37);
    ok(ring[2].kind === 'campaign' && ring.filter((t) => t.kind === 'news').length === 1 && ring[5].kind === 'news' && ring.filter((t) => t.kind === 'house').length === 4,
      `the ring: ${ring.map((t) => (t.kind === 'campaign' ? `campaign ${t.campaign}` : t.kind === 'house' ? HOUSE_ADS[t.art] : 'NEWS')).join(', ')}`);
    const full = screenTurns([1, 2, 3, 4, 5, 6], 0.1), none = screenTurns([null, null, null, null, null, null], 0.9);
    ok(full.every((t) => t.kind === 'campaign') && none.filter((t) => t.kind === 'news').length === 1 && new Set(none.filter((t) => t.kind === 'house').map((t) => (t as { art: number }).art)).size === 5,
      'every turn rented shows no house advert and no news; none rented shows five different house adverts and the news');
    ok(JSON.stringify(screenTurns(rented, 0.37)) === JSON.stringify(ring) && JSON.stringify(screenTurns(rented, 0.81)) !== JSON.stringify(ring), 'the ring is the same for every viewer of a building, and differs between buildings (their seeds)');
  }
}

console.log('5. endings');
const victim = ads.list().find((r) => w.buildings.get(tileKey(r.x, r.y))?.zone === Zone.Commercial && w.parcelAt(r.x, r.y)?.owner === 'sys');
if (victim) {
  w.setTile(victim.x, victim.y, packTile(terrainOf(w.getTile(victim.x, victim.y)), false, 0, 0)); // bulldozed: bare ground
  const n0 = ads.list().length;
  for (let i = 0; i < DAY; i++) g.step();
  ok(ads.list().length === n0 - 1, `the poster on a building pulled down came down at midnight (${n0} -> ${ads.list().length})`);
} else ok(false, 'a rented frame on a Commons shop to pull down');
p.money = -ECONOMY_TUNING.overdraftLimit - 1e6; // past the overdraft, whatever the day's taxes bring in
for (let i = 0; i < DAY; i++) g.step();
ok(ads.list().length === 0, `an unpaid renter's posters came down at midnight (${ads.list().length} left)`);
p.money = 20000;

console.log('7. spectate, and saves');
let refused = '';
let fake: ((c: Conn) => void) | null = null;
createGame(new World(3), { onConnection(cb) { fake = cb; } }, { devTools: false, sandbox: false, spectate: true });
if (fake) {
  const handlers: ((d: string) => void)[] = [];
  const conn = { open: true, send: (s: string) => { const m = JSON.parse(s) as ServerMsg; if (m.t === 'toast') refused = m.msg; }, close() {}, onMessage: (f: (d: string) => void) => handlers.push(f), onClose() {} } as unknown as Conn;
  (fake as (c: Conn) => void)(conn);
  handlers.forEach((h) => h(JSON.stringify({ t: 'hello', name: 'visitor' })));
  handlers.forEach((h) => h(JSON.stringify({ t: 'adCampaign', theme: 1, claim: 5, look: 0 })));
}
ok(/Read-only/.test(refused), `spectate refuses the advert intents ("${refused.slice(0, 40)}")`);
const c2 = ads.create(p, { theme: 1, claim: AD_CLAIMS.findIndex((c) => c.needs === null), look: 5 }, false);
const c2id = typeof c2 === 'string' ? -1 : c2.id;
ads.rent(p, c2id, undefined, { x: mine.x + 10, y: mine.y + 10, n: 2 });
const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
const w2 = worldFromSnapshot(snap)!;
const g2 = createGame(w2, { onConnection() {} }, { devTools: false, sandbox: false });
ok(g2.adverts.list().length === ads.list().length && g2.adverts.campaignList().length === ads.campaignList().length, `a save with rentals loads with them (${g2.adverts.list().length} posters, ${g2.adverts.campaignList().length} campaigns)`);
delete snap.adverts;
const g3 = createGame(worldFromSnapshot(snap)!, { onConnection() {} }, { devTools: false, sandbox: false });
ok(g3.adverts.list().length === 0 && g3.adverts.campaignList().length === 0, 'a save without adverts loads with none');

console.log(`\nadverts probe: ${checks - fails}/${checks} passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
