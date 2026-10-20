/**
 * Media probe (docs/media.md N1+N2: the broadcasters and the news story log).
 *
 *   npx tsx packages/server/src/loadtest/media.ts [--seed 1] [--quiet]
 *   npx tsx packages/server/src/loadtest/media.ts --bench [--districts 2] [--ticks 1500]
 *
 * 1. coverage: two players' TV studios ten tiles apart each cover 24 tiles; a story between them goes to the nearer
 *    channel with the other as its rival, one beyond both is nobody's, and a media centre (tier 3, the whole map) wins
 *    wherever it is; the news overlay counts the channels over a tile; the building panel names the rival;
 * 2. a fire: a home in reach catches light and is a covered 'fire' story at once, sent as fresh news; when it is out the
 *    same story has its end and a new headline;
 * 3. a rank-up: a player whose town meets the Hamlet's needs reaches it through Ranks.check, and the news has a 'rank'
 *    story at the celebration spot naming the rank;
 * 4. the ring: 250 more stories leave NEWS.keep, the newest, with ids still rising;
 * 5. determinism: the same seed gives the same stories (ids, ticks, places, headlines, channels) on a second run;
 * 6. old saves: a snapshot without `news` loads with an empty log and saves without the field; one with stories loads
 *    them, keeps numbering after them, and a fire burning at the save still gets its end after loading.
 * `--bench`: ms per game step (sim, fires, adverts, news and the frame) on a test city of `--districts`², filled for a
 * day, over `--ticks` ticks: run it here and on main for the tick cost.
 * Prints pass/fail counts; exits 1 on any failure.
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, KIND_ID, NEWS, Zone, DEFAULT_TAX, coverStory, packTile, terrainOf, subFor, tileKey, isGrowableId,
  type Channel, type StoryDTO,
} from '@msimcity/shared';
import { World, emptyStats, type Building } from '../world';
import { seedCity } from './cities';
import { createGame, type Game } from '../game';
import { snapshotOf, worldFromSnapshot } from '../snapshot';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const seed = get('seed', 1);
const quiet = argv.includes('--quiet');
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
const log = (s: string) => { if (!quiet) console.log(s); };
const TV = KIND_ID['tv-studio'], MEDIA = KIND_ID['media-centre'];

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let checks = 0, fails = 0;
const ok = (cond: boolean, what: string) => { checks++; if (!cond) fails++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };

/** A test city filled for about a day with fires off. */
function city(opts: { rnd?: number; districts?: number; sandbox?: boolean; owner?: string } = {}): { w: World; g: Game; x0: number; y0: number } {
  const rnd = opts.rnd ?? seed;
  Math.random = mulberry32(rnd * 7919);
  const w = new World(rnd);
  const layout = seedCity(w, { districts: opts.districts ?? 1, built: 3, ...(opts.owner ? { seedOwner: opts.owner } : {}) });
  const g = createGame(w, { onConnection() {} }, { devTools: false, sandbox: opts.sandbox ?? true });
  g.fires.enabled = false;
  for (let i = 0; i < 1.1 * DAY; i++) g.step();
  g.fires.enabled = true;
  return { w, g, x0: layout.districts[0].x, y0: layout.districts[0].y };
}

/** A grown lot beside a road nearest (x, y), not one of `skip`. */
function lotNear(w: World, x: number, y: number, skip: Set<string> = new Set()): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const b of w.buildings.values()) {
    if (!isGrowableId(b.id) || b.level <= 0 || skip.has(tileKey(b.x, b.y)) || w.structureAt(b.x, b.y) || !w.hasRoadAccess(b.x, b.y) || w.sites.has(tileKey(b.x, b.y))) continue;
    const d = Math.max(Math.abs(b.x - x), Math.abs(b.y - y));
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
/** Make the lot at (x, y) a one-tile broadcaster of `kind`, on a one-tile parcel of `owner` (a player made if need be), staffed. */
function broadcaster(w: World, b: Building, kind: number, owner: string, name: string): Building {
  if (!w.players.has(owner)) w.getOrCreatePlayer(owner, name, 0);
  const parcel = { id: w.nextId++, owner, name: `${name}'s plot`, x: b.x, y: b.y, w: 1, h: 1, taxRate: DEFAULT_TAX, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  w.setParcelId(b.x, b.y, parcel.id);
  w.setTile(b.x, b.y, packTile(terrainOf(w.getTile(b.x, b.y)), false, Zone.Office, 1), subFor(kind));
  const nb = w.buildings.get(tileKey(b.x, b.y))!;
  nb.occupants = Math.max(nb.occupants, 4); // on air from the start (hiring takes the probe's time, not the point)
  return nb;
}

function stories(g: Game): StoryDTO[] { return [...g.news.all()]; }

// ---------------------------------------------------------------- 1. coverage
console.log('1. coverage');
let A: Building, B: Building, cityA: ReturnType<typeof city>;
{
  // pure: two tier-1 channels ten tiles apart, and a tier-3 one far off
  const a: Channel = { owner: 'a', x: 0, y: 0, kind: TV }, b: Channel = { owner: 'b', x: 10, y: 0, kind: TV }, c: Channel = { owner: 'c', x: 500, y: 500, kind: MEDIA };
  const between = coverStory(3, 0, [a, b]), nearB = coverStory(13, 2, [b, a]), far = coverStory(-30, 0, [a, b]);
  ok(between.ch === 'a' && between.rv?.join() === 'b', `a story 3 tiles from a and 7 from b: a's channel, b its rival (${JSON.stringify(between)})`);
  ok(nearB.ch === 'b' && nearB.rv?.join() === 'a', `nearer b: b's channel, whatever the list order (${JSON.stringify(nearB)})`);
  ok(!far.ch && !far.rv, `30 tiles beyond a: nobody covers it (${JSON.stringify(far)})`);
  const tier3 = coverStory(3, 0, [a, b, c]);
  ok(tier3.ch === 'c' && tier3.rv?.join() === 'a,b', `a media centre 500 tiles off still wins: the whole map, tier 3 (${JSON.stringify(tier3)})`);

  // in a city: two players' studios on lots ten tiles apart
  cityA = city();
  const { w, g, x0, y0 } = cityA;
  A = broadcaster(w, lotNear(w, x0 + 3, y0 + 9)!, TV, 'ada', 'Ada');
  B = broadcaster(w, lotNear(w, A.x + 10, A.y)!, TV, 'ben', 'Ben');
  for (let i = 0; i < TPH / 2; i++) g.step();
  const cs = g.news.centresNow();
  ok(cs.length === 2 && cs.some((c) => c.owner === 'ada') && cs.some((c) => c.owner === 'ben'), `the news finds both staffed studios (${cs.map((c) => `${c.owner}@${c.x},${c.y}`).join(' ')})`);
  const out = new Uint8Array(1);
  g.news.channelsOver(Math.round((A.x + B.x) / 2), A.y, 1, 1, out); const mid = out[0];
  g.news.channelsOver(A.x - 20, A.y, 1, 1, out); const westA = out[0];
  g.news.channelsOver(A.x - 40, A.y, 1, 1, out); const beyond = out[0];
  ok(mid === 2 && westA === 1 && beyond === 0, `the news overlay: 2 channels between them, 1 west of Ada's, 0 beyond both (${mid} ${westA} ${beyond})`);
  const info = g.news.describe(A);
  ok(!!info && info.radius === 24 && info.rivals.join() === 'Ben TV' && info.staffed, `Ada's studio panel: covers 24 tiles, Ben TV a rival, on air (${JSON.stringify(info)})`);
}

// ---------------------------------------------------------------- 2. a fire
console.log('2. a fire');
{
  const { w, g } = cityA;
  const home = lotNear(w, A.x + 2, A.y + 1, new Set([tileKey(A.x, A.y), tileKey(B.x, B.y)]))!;
  g.net.flush(); g.news.drain();
  const before = g.news.all().length;
  const lit = g.fires.ignite(home);
  const st = stories(g).slice(before).find((s) => s.k === 'fire');
  const fresh = g.news.drain();
  ok(lit && !!st, `a fire at (${home.x}, ${home.y}) is a story at once: "${st?.h}"`);
  ok(st?.ch === 'ada' && st?.rv?.join() === 'ben', `covered by Ada's channel (nearer), Ben's its rival (${st?.ch} / ${st?.rv})`);
  ok(st?.end === undefined && st?.x === home.x && st?.y === home.y && (st?.s ?? 0) > 0, `live with no end, at the home, salience ${st?.s}`);
  ok(fresh.some((s) => s.id === st?.id), 'sent as fresh news');
  const h0 = st?.h;
  for (let i = 0; i < 10 * TPH && st?.end === undefined; i++) g.step();
  ok(st?.end !== undefined && st.end > st.t, `put out or burnt: the story ends at tick ${st?.end} (${st ? Math.round((st.end! - st.t) / TPH * 10) / 10 : '?'} h)`);
  ok(!!st && st.h !== h0, `its headline moves on: "${st?.h}"`);
}

// ---------------------------------------------------------------- 3. a rank-up
console.log('3. a rank-up');
{
  const { w, g } = city({ sandbox: false, owner: 'p1' });
  const p = w.players.get('p1')!;
  const ranks = g.net.ranks!;
  const s = ranks.state(p); // derived from the town as it stands: what is true already is history
  const reached = s.rank;
  // take the record back to Camp, so the next look reaches Hamlet again as a growing town would
  s.rank = 0; s.at = [w.tick];
  s.seen = s.seen.filter((k) => !k.startsWith('rank:') && !k.startsWith('need:'));
  const before = g.news.all().length;
  const r = ranks.check(p);
  const rk = stories(g).slice(before).find((x) => x.k === 'rank');
  ok(reached >= 1 && r.msg.up?.rank === 1, `the town (rank ${reached} as it stands) reaches Hamlet again through Ranks.check`);
  const town = rk ? w.parcelAt(rk.x, rk.y)?.name ?? '' : '';
  ok(!!rk && rk.who === 'p1' && /Hamlet/.test(rk.h) && !!town && rk.h.includes(town), `a 'rank' story naming the rank and the town's parcel: "${rk?.h}"`);
  ok(!!rk && !!r.msg.up && rk.x === r.msg.up.at[0] && rk.y === r.msg.up.at[1] && rk.end !== undefined, `at the celebration spot (${rk?.x}, ${rk?.y}), live for ${NEWS.liveHours.rank} hours`);
  ok(rk?.ch === undefined, 'nobody covers it: there is no media centre in this town');
}

// ---------------------------------------------------------------- 4. the ring
console.log('4. the ring');
{
  const { g } = cityA;
  for (let i = 0; i < 250; i++) g.news.rank({ kind: 'milestone', player: 'ada', at: [A.x, A.y], text: `${i + 1} residents` });
  const all = g.news.all();
  ok(all.length === NEWS.keep, `${all.length} stories kept (NEWS.keep ${NEWS.keep})`);
  ok(all.every((s, i) => i === 0 || s.id > all[i - 1].id) && /250 residents/.test(all[all.length - 1].h), `the newest, oldest first, ids rising (last "${all[all.length - 1].h}")`);
  ok(g.news.stats.dropped >= 50, `${g.news.stats.dropped} dropped`);
  ok(g.news.recent().length === NEWS.helloSend, `a joining client gets the newest ${NEWS.helloSend}`);
}

// ---------------------------------------------------------------- 5. determinism
console.log('5. determinism');
{
  const run = () => {
    const c = city({ rnd: seed + 1 });
    const studio = broadcaster(c.w, lotNear(c.w, c.x0 + 11, c.y0 + 11)!, TV, 'ada', 'Ada');
    const home = lotNear(c.w, studio.x + 3, studio.y + 2, new Set([tileKey(studio.x, studio.y)]))!;
    for (let i = 0; i < TPH; i++) c.g.step();
    c.g.fires.ignite(home);
    for (let i = 0; i < 1.5 * DAY; i++) c.g.step(); // background fires too
    return c.g.news.all().map((s) => JSON.stringify([s.id, s.t, s.k, s.x, s.y, s.h, s.s, s.ch ?? '', s.end ?? '']));
  };
  const one = run(), two = run();
  ok(one.length > 0 && one.length === two.length, `${one.length} stories each run`);
  ok(one.every((s, i) => s === two[i]), 'the same stories: ids, ticks, places, headlines, salience, channels, ends');
  log(`    ${one.slice(0, 4).join('\n    ')}`);
}

// ---------------------------------------------------------------- 6. old saves
console.log('6. old saves');
{
  const { w, g } = cityA;
  const home = lotNear(w, A.x - 2, A.y + 1, new Set([tileKey(A.x, A.y), tileKey(B.x, B.y)]))!;
  g.fires.ignite(home);
  g.step();
  const burning = stories(g).filter((s) => s.k === 'fire' && s.end === undefined);
  const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
  ok(Array.isArray(snap.news?.stories) && snap.news.stories.length === g.news.all().length, `the snapshot carries the log (${snap.news?.stories?.length} stories, ${burning.length} live fire)`);
  // without the field: an older save
  const old = { ...snap }; delete old.news;
  const w0 = worldFromSnapshot(old)!;
  const g0 = createGame(w0, { onConnection() {} }, { devTools: false, sandbox: true });
  ok(g0.news.all().length === 0, 'a save from before the news loads with an empty log');
  ok(!('news' in snapshotOf(w0)), 'and saves again without a news field');
  // with it
  const w1 = worldFromSnapshot(snap)!;
  const g1 = createGame(w1, { onConnection() {} }, { devTools: false, sandbox: true });
  const loaded = g1.news.all();
  ok(loaded.length === g.news.all().length && loaded[loaded.length - 1].h === g.news.all()[g.news.all().length - 1].h, `the log loads (${loaded.length} stories)`);
  const last = loaded[loaded.length - 1].id;
  g1.news.rank({ kind: 'milestone', player: 'ada', at: [A.x, A.y], text: 'after the load' });
  ok(g1.news.all()[g1.news.all().length - 1].id === last + 1, `numbering goes on after it (${last + 1})`);
  const fire = g1.news.all().find((s) => burning.some((b) => b.id === s.id));
  for (let i = 0; i < 10 * TPH && fire && fire.end === undefined; i++) g1.step();
  ok(!!fire && fire.end !== undefined, `the fire burning at the save gets its end after loading: "${fire?.h}"`);
}

// ---------------------------------------------------------------- bench
if (argv.includes('--bench')) {
  const n = get('districts', 2), ticks = get('ticks', 1500);
  console.log(`bench: ${n}×${n} districts, ${ticks} ticks`);
  const { g } = city({ districts: n, rnd: seed });
  for (let i = 0; i < 200; i++) g.step(); // warm
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) g.step();
  const ms = (performance.now() - t0) / ticks;
  console.log(`  ${ms.toFixed(3)} ms a step, ${g.world.citizens.size} citizens, ${g.news.all().length} stories`);
}

console.log(`\n${checks - fails} of ${checks} passed`);
process.exit(fails ? 1 : 0);
