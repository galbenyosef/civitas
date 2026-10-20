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
 * 7. (run before 6) Fires v2: a gas explosion is one 'explosion' story named for its cause, its neighbours set
 *    alight are live 'spread' stories that end when they are out, and the blast's own source has no fire story of its own;
 * 8. (N3, N4 filler) the news helicopter: over the live story of its channel and nobody else's, the same flight from the
 *    same stories twice, home again after; a story live again (`lit`) is flown to again; the channel schedule is the
 *    same for the same channel and hour;
 * 6. old saves: a snapshot without `news` loads with an empty log and saves without the field; one with stories loads
 *    them, keeps numbering after them, and a fire burning at the save still gets its end after loading; a story's `lit`
 *    survives the save (and a save without it flies from the story's start).
 * `--bench`: ms per game step (sim, fires, adverts, news and the frame) on a test city of `--districts`², filled for a
 * day, over `--ticks` ticks: run it here and on main for the tick cost.
 * Prints pass/fail counts; exits 1 on any failure.
 */
import {
  TICKS_PER_DAY, TICKS_PER_HOUR, KIND_ID, NEWS, Zone, DEFAULT_TAX, coverStory, packTile, terrainOf, subFor, tileKey, isGrowableId,
  newsHelisAt, storyWindow, programmeAt, CIVITAS_CHANNELS, playerChannel,
  type Channel, type StoryDTO, type NewsPad,
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

// ---------------------------------------------------------------- 7. spread and explosions (Fires v2)
console.log('7. spread and explosions');
{
  const { w, g } = cityA;
  const skip = new Set([tileKey(A.x, A.y), tileKey(B.x, B.y)]);
  const home = lotNear(w, A.x + 4, A.y - 3, skip)!;
  const last = g.news.all()[g.news.all().length - 1]?.id ?? 0; // the ring is full by now: new stories by id, not by place
  // explode() takes the tile as (x, y) or, after a follow-up, as [x, y]: call whichever this build has
  const ex = g.fires.explode as unknown as (...a: unknown[]) => boolean;
  const opts = { cause: 'gas' };
  const went = ex.length >= 3 ? ex.call(g.fires, home.x, home.y, opts) : ex.call(g.fires, [home.x, home.y], opts);
  const fresh = stories(g).filter((s) => s.id > last);
  const boom = fresh.find((s) => s.k === 'explosion');
  const spread = fresh.filter((s) => s.k === 'fire');
  ok(went && !!boom && boom.x === home.x && boom.y === home.y, `a gas explosion at (${home.x}, ${home.y}) is one 'explosion' story: "${boom?.h}"`);
  ok(!!boom && /gas explosion/i.test(boom.h) && boom.ch === 'ada' && boom.s >= 70, `named for its cause, on Ada's channel, salience ${boom?.s}`);
  ok(spread.length > 0 && spread.every((s) => /spreads to/.test(s.h) && s.end === undefined), `${spread.length} neighbour${spread.length === 1 ? '' : 's'} alight, each a live 'spread' story ("${spread[0]?.h}")`);
  ok(!fresh.some((s) => s.k === 'fire' && s.x === home.x && s.y === home.y), 'no separate fire story for the blast\'s own source');
  for (let i = 0; i < 12 * TPH && spread.some((s) => s.end === undefined); i++) g.step();
  ok(spread.every((s) => s.end !== undefined), 'the spread fires end when they are out');
}

// ---------------------------------------------------------------- 8. the news helicopter and the schedule (N3, N4)
console.log('8. the news helicopter and the channel schedule');
{
  const { w, g } = cityA;
  // Ada's media centre with its roof pad (a pad where the tower stands; shared helipads.ts finds the real one on the client)
  const skip = new Set([tileKey(A.x, A.y), tileKey(B.x, B.y)]);
  const mc = broadcaster(w, lotNear(w, A.x - 6, A.y + 5, skip)!, MEDIA, 'ada', 'Ada');
  const pad: NewsPad = { id: 4242, x: mc.x + 0.5, y: 3.4, z: mc.y + 0.5, r: 0.45, kind: 'news', heading: 0, building: MEDIA, bx: mc.x, by: mc.y, owner: 'ada', channel: 'Ada TV', color: 0x3388cc };
  const benPad: NewsPad = { ...pad, id: 4343, x: pad.x + 1, owner: 'ben', channel: 'Ben TV' };
  for (let i = 0; i < TPH / 4 + 1; i++) g.step(); // the coverage lookup refreshes every quarter hour
  skip.add(tileKey(mc.x, mc.y));
  const home = lotNear(w, mc.x + 12, mc.y + 9, skip)!;
  const before = g.news.all()[g.news.all().length - 1]?.id ?? 0;
  g.fires.ignite(home);
  const st = stories(g).find((s) => s.id > before && s.k === 'fire');
  ok(!!st && st.ch === 'ada', `a fire at (${home.x}, ${home.y}) on Ada's channel (salience ${st?.s})`);
  const at = (t: number, list = stories(g)) => newsHelisAt([pad, benPad], list, t);
  const [go, stop] = storyWindow(st!, pad);
  // over the scene within two game hours of lifting off, and still there while the story is live
  let over = -1;
  for (let t = go; t < go + 2 * TPH && over < 0; t += 1) if (at(t)[0].news?.doing === 'live') over = t;
  const s0 = over >= 0 ? at(over + 20)[0] : null;
  ok(over >= 0 && !!s0 && s0.news?.story === st!.id && Math.hypot(s0.x - st!.x - 0.5, s0.z - st!.y - 0.5) < 6,
    `Ada's helicopter is over it ${over >= 0 ? ((over - st!.t) / TPH).toFixed(2) : '?'} h after it broke, ${s0 ? Math.hypot(s0.x - st!.x - 0.5, s0.z - st!.y - 0.5).toFixed(1) : '?'} tiles out, ${s0?.y.toFixed(1)} up`);
  ok(at(over + 20)[1].news?.doing === 'parked', 'Ben\'s helicopter stays on its roof (not his channel\'s story)');
  // the same flight from the same stories, sampled every 3 ticks over the sortie
  const copy = JSON.parse(JSON.stringify(stories(g))) as StoryDTO[];
  let same = true;
  for (let t = go - 10; t < go + 3 * TPH; t += 3) { const a = at(t)[0], b = at(t, [...copy].reverse())[0]; if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) > 1e-9 || a.phase !== b.phase) same = false; }
  ok(same, 'the same stories (in any order) give the same flight, tick by tick');
  let smooth = true, maxStep = 0;
  for (let t = go - 10, p = at(go - 10)[0]; t < go + 3 * TPH; t += 0.5) { const q = at(t)[0]; const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); maxStep = Math.max(maxStep, d); if (d > 0.6) smooth = false; p = q; }
  ok(smooth, `no jumps: at most ${maxStep.toFixed(2)} tiles a half tick`);
  for (let i = 0; i < 12 * TPH && st!.end === undefined; i++) g.step();
  const end = Math.max(stop, st!.end ?? stop), [, stop2] = storyWindow(st!, pad);
  // (the city's other fires are Ada's stories too: with this one alone it comes home)
  const t2 = Math.max(end, stop2) + 2 * TPH, home2 = at(t2, [st!])[0], other = at(t2)[0];
  ok(home2.news?.doing === 'parked' && Math.hypot(home2.x - pad.x, home2.z - pad.z) < 0.1 && other.news?.story !== st!.id, `it leaves when the story ends: back on its pad (${home2.phase}), or off to a newer story (${other.news?.doing} ${other.news?.story ?? ''})`);
  // live again: the helicopter goes out again from then
  const relit = { ...st!, lit: Math.max(end, stop2) + 3 * TPH };
  delete relit.end;
  const [go3] = storyWindow(relit, pad);
  ok(go3 > relit.lit! && at(go3 + TPH, [relit])[0].news?.doing !== 'parked', 'a story live again (lit) is flown to again from then');
  // the schedule
  const chs = [...CIVITAS_CHANNELS, playerChannel('ada', 'Ada', 0x3388cc)];
  let sched = true;
  for (const c of chs) for (let h = 0; h < 48; h++) if (JSON.stringify(programmeAt(c, h * TPH + 3, h % 3 === 0)) !== JSON.stringify(programmeAt(c, h * TPH + 3, h % 3 === 0)) || programmeAt(c, h * TPH + 3, false).title !== programmeAt(c, h * TPH + 40, false).title) sched = false;
  ok(sched, 'the channel schedule is the same for the same channel and hour');
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
  // a story's `lit` (live again after an end) survives the save; without it the helicopter flies from the start
  const snapLit = JSON.parse(JSON.stringify(snap));
  snapLit.news.stories[0].lit = snapLit.news.stories[0].t + 77;
  const gl = createGame(worldFromSnapshot(snapLit)!, { onConnection() {} }, { devTools: false, sandbox: true });
  const sl = gl.news.all()[0];
  ok(sl.lit === sl.t + 77 && storyWindow(sl)[0] >= sl.lit && storyWindow(loaded[0])[0] >= loaded[0].t && loaded[0].lit === undefined, 'a story\'s lit survives the save; a save without it flies from the story\'s start');
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
