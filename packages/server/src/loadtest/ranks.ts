/**
 * Settlement ranks probe (docs/ranks.md, Audit #4): driven over fake clients as a player would, with the needs met by
 * hand (counters and finished buildings set directly, no simulation runs). Checks the Camp start on a frontier and its
 * land rule, each rank-up with its grant, ring and feed, one rank per measurement, no grant paid twice, the City's open
 * land, the save round trip, an older save deriving its rank without a grant, the Commons (ranks, no ring), a sandbox
 * (none), and the frontier street goal counting only the player's own road tiles.
 *
 *   npx tsx packages/server/src/loadtest/ranks.ts
 */
import {
  RANKS, TOP_RANK, KIND_ID, Zone, MAX_PARCEL_EDGE, charterRing, tileKey,
  type ServerMsg, type ClientMsg,
} from '@msimcity/shared';
import { World, type Player } from '../world';
import { seedCommons, seedFrontier } from '../seed';
import { createGame } from '../game';
import { snapshotOf, worldFromSnapshot } from '../snapshot';
import type { Conn } from '../transport';

let failed = 0, passed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (cond) passed++; else failed++; };
type RankMsg = Extract<ServerMsg, { t: 'rank' }>;

function setup(world: World, sandbox = false) {
  let accept: ((c: Conn) => void) | null = null;
  const game = createGame(world, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox });
  const client = (name: string) => {
    const got: ServerMsg[] = [];
    let onMsg: ((d: string) => void) | null = null;
    accept!({ open: true, send: (d) => got.push(JSON.parse(d)), close() {}, onMessage: (fn) => { onMsg = fn; }, onClose() {} });
    const send = (m: ClientMsg) => onMsg!(JSON.stringify(m));
    send({ t: 'hello', name });
    const toast = () => (got.filter((m) => m.t === 'toast').at(-1) as Extract<ServerMsg, { t: 'toast' }> | undefined)?.msg ?? '';
    const ranks = () => got.filter((m): m is RankMsg => m.t === 'rank');
    return { got, send, toast, ranks, last: () => ranks().at(-1), id: name.toLowerCase(), clear: () => { got.length = 0; } };
  };
  /** the goals and ranks are measured every quarter game hour: step the clock to the next one and flush */
  const measure = () => { world.tick = (Math.floor(world.tick / 25) + 1) * 25; game.net.flush(); };
  return { game, client, measure };
}
/** A finished building of a family on a tile (what the needs read), no simulation. */
const stand = (w: World, x: number, y: number, zone: number, id = zone, level = 1) => w.buildings.set(tileKey(x, y), { x, y, zone, id, level, occupants: 0 });
/** Meet a rank's needs on the player's land, near (x, y). */
function meet(w: World, p: Player, rank: number, x: number, y: number) {
  for (const q of RANKS[rank].needs) {
    if (q.id === 'residents') p.progress.housed = q.target;
    if (q.id === 'jobs') p.progress.jobs = q.target;
    if (q.id === 'shops') for (let i = 0; i < q.target; i++) stand(w, x + i, y, Zone.Commercial);
    if (q.id === 'leisure') stand(w, x, y + 1, 10, KIND_ID['park']);
    if (q.id === 'cover') { stand(w, x + 1, y + 1, Zone.Police, KIND_ID['police-box']); stand(w, x + 2, y + 1, Zone.Fire, KIND_ID['fire-post']); }
    if (q.id === 'level2') for (let i = 0; i < q.target; i++) stand(w, x + i, y + 2, Zone.Residential, Zone.Residential, 2);
    if (q.id === 'black') p.ranks!.black = q.target;
    if (q.id === 'school') p.progress.pupils = 5;
  }
}
const ownedBy = (w: World, r: { x: number; y: number; w: number; h: number }, id: string) => {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (w.parcelAt(x, y)?.owner !== id) return false;
  return true;
};

// ---- a frontier: Camp, the charter and its land rule
{
  const world = new World(424242);
  seedFrontier(world);
  const { game, client, measure } = setup(world);
  const a = client('Ada');
  const p = world.players.get(a.id)!, ch = world.charter!;
  const first = a.last();
  ok(first?.rank.rank === 0 && first.rank.have.length === RANKS[1].needs.length, `a new frontier player is a ${RANKS[0].name}, shown the ${RANKS[1].name}'s ${RANKS[1].needs.length} needs`);
  ok(first?.rank.ring?.w === 32 && first.rank.next?.w === RANKS[1].side, `the rank message carries the charter (${first?.rank.ring?.w}×${first?.rank.ring?.h}) and the next ring (${first?.rank.next?.w}×${first?.rank.next?.h})`);
  ok(ownedBy(world, ch, a.id) && world.parcelIdAt(ch.x - 1, ch.y) === 0, 'the 32×32 charter is Ada\'s and nothing beyond it');

  // the street goal counts the player's own road tiles, not the country road already in the charter
  const goals = a.got.filter((m) => m.t === 'goals').at(-1) as Extract<ServerMsg, { t: 'goals' }> | undefined;
  ok(goals?.goals.active === 'road' && goals.goals.parts[0] === 0 && (p.onboarding?.roadBase ?? 0) >= 10, `"Lay a street" starts at 0 of 12 (${p.onboarding?.roadBase} country-road tiles in the charter not counted)`);

  a.clear(); a.send({ t: 'buy', x: ch.x + ch.w, y: ch.y, w: 4, h: 4 });
  ok(/charter is 32×32/.test(a.toast()) && world.parcelIdAt(ch.x + ch.w, ch.y) === 0, `the holder cannot buy beyond the charter as a Camp ("${a.toast().slice(0, 80)}…")`);
  const b = client('Bea');
  const all = charterRing(ch, TOP_RANK);
  b.clear(); b.send({ t: 'buy', x: all.x + all.w - 3, y: ch.y, w: 4, h: 4 });
  ok(/held for Ada's charter/.test(b.toast()), `another player cannot buy inside the City ring ("${b.toast()}")`);
  b.clear(); b.send({ t: 'buy', x: all.x + all.w + 2, y: ch.y, w: 4, h: 4 });
  ok(world.parcelAt(all.x + all.w + 2, ch.y)?.owner === b.id, 'but may buy beyond it');
  ok(!b.last()?.rank.ring, 'and has ranks but no charter ring');

  // ---- Hamlet: the needs, the grant, the ring, the feed
  const cx = ch.x + 4, cy = ch.y + 4;
  p.progress.housed = RANKS[1].needs[0].target - 1;
  stand(world, cx, cy, Zone.Commercial); stand(world, cx + 1, cy, Zone.Commercial); stand(world, cx, cy + 1, 10, KIND_ID['park']);
  a.clear(); measure();
  const short = a.last();
  ok(short?.rank.rank === 0 && short.fresh?.some((m) => m.kind === 'need'), 'one need short: still a Camp, the needs met so far in the feed');
  ok(short?.fresh?.some((m) => m.kind === 'people') && short.fresh.some((m) => m.text === 'The first shop opens'), 'with the residents marks and the first shop');
  const m0 = p.money;
  p.progress.housed = RANKS[1].needs[0].target;
  a.clear(); measure();
  const up = a.last();
  ok(up?.up?.rank === 1 && p.ranks?.rank === 1, `the last need met: ${RANKS[1].name}`);
  ok(p.money - m0 === RANKS[1].grant && (world.ledgerDTO(p).today.other ?? 0) >= RANKS[1].grant, `the grant: +$${p.money - m0} through the ledger`);
  const r1 = charterRing(ch, 1);
  ok(ownedBy(world, r1, a.id) && up?.up?.land?.w === r1.w, `the charter grows to ${r1.w}×${r1.h}, all Ada's`);
  const mine = [...world.parcels.values()].filter((q) => q.owner === a.id);
  ok(mine.every((q) => q.w <= MAX_PARCEL_EDGE && q.h <= MAX_PARCEL_EDGE) && new Set(mine.map((q) => q.group ?? -q.id)).size === 1, `as ${mine.length} parcel(s) of at most ${MAX_PARCEL_EDGE} a side, one estate`);
  ok(up?.rank.feed[0]?.kind === 'rank' && /Hamlet!/.test(up.rank.feed[0].text), `the feed leads with it ("${up?.rank.feed[0]?.text}")`);
  a.clear(); measure();
  ok(a.got.some((m) => m.t === 'parcels'), 'the new land goes out in a parcels message');
  ok(p.money - m0 === RANKS[1].grant && !a.last()?.up, 'measured again: no second grant, no second celebration');
  ok(a.ranks().length === 0 || !a.last()?.fresh, 'and nothing new in the feed');

  // ---- one rank per measurement, all the way to City
  for (let r = 2; r <= TOP_RANK; r++) meet(world, p, r, ch.x + 2, ch.y + 10 + r * 3);
  const ups: number[] = [];
  for (let i = 0; i < 6; i++) { a.clear(); measure(); const u = a.last()?.up; if (u) ups.push(u.rank); }
  ok(ups.join(',') === '2,3,4' && p.ranks?.rank === TOP_RANK, `met at once, the ranks still come one a measurement: ${ups.join(' → ')}`);
  const top = charterRing(ch, TOP_RANK);
  ok(ownedBy(world, top, a.id), `as a ${RANKS[TOP_RANK].name} the charter is ${top.w}×${top.h}`);
  ok(top.x >= ch.x - 10 && world.parcelAt(ch.x - 14, 0)?.owner !== a.id, 'never reaching the gate (14 tiles west of the charter)');
  const total = RANKS.reduce((s, r) => s + r.grant, 0);
  ok(Math.round(p.money - m0) === total, `every grant paid once: $${Math.round(p.money - m0)} of $${total}`);
  a.clear(); a.send({ t: 'buy', x: top.x + top.w, y: top.y, w: 4, h: 4 });
  ok(world.parcelAt(top.x + top.w, top.y)?.owner === a.id, `a ${RANKS[TOP_RANK].name} buys land beyond the charter by the ordinary rules`);
  const atTop = game.net.ranks!.check(p).msg.rank;
  ok(!atTop.next && atTop.have.length === 0, 'and has no next rank to show');

  // ---- the save round trip: rank, feed and ring kept, nothing paid again
  const snap = JSON.parse(JSON.stringify(snapshotOf(world)));
  const w2 = worldFromSnapshot(snap)!;
  const s2 = setup(w2);
  const a2 = s2.client('Ada');
  const p2 = w2.players.get('ada')!;
  ok(p2.ranks?.rank === TOP_RANK && p2.ranks.feed.length === p.ranks!.feed.length && a2.last()?.rank.rank === TOP_RANK, 'a save keeps the rank and the feed');
  const money2 = p2.money; s2.measure();
  ok(p2.money === money2, 'and a reload pays nothing again');
}

// ---- an older save on a frontier: no ranks yet, a grown town; derived, no grant, the ring given
{
  const world = new World(99);
  seedFrontier(world);
  const { client } = setup(world);
  client('Old');
  const p = world.players.get('old')!, ch = world.charter!;
  meet(world, p, 1, ch.x + 2, ch.y + 2); meet(world, p, 2, ch.x + 2, ch.y + 8); // a village's town
  p.progress.housed = RANKS[2].needs[0].target + 5;
  delete p.ranks; // as a save from before ranks has it
  const m0 = p.money;
  const a2 = client('Old');
  ok(p.ranks?.rank === 2 && a2.last()?.rank.rank === 2, `a player with no rank record derives it from the town: ${RANKS[p.ranks?.rank ?? 0].name}`);
  ok(p.money === m0 && !a2.last()?.up, 'without a grant or a celebration');
  ok(ownedBy(world, charterRing(ch, 2), 'old'), 'and its charter is given the land that rank holds');
  ok(p.ranks?.feed[0]?.text.includes('the record begins') && !(a2.last()?.fresh?.length), 'the feed starts with the record, not a flood of old milestones');
  // a snapshot whose players carry no rank record (every save before this) loads and is measured
  const snap = JSON.parse(JSON.stringify(snapshotOf(world)));
  for (const q of snap.players) delete q.ranks;
  const w2 = worldFromSnapshot(snap)!;
  const s2 = setup(w2);
  const a3 = s2.client('Old');
  ok(!!w2.players.get('old')?.ranks && a3.last()?.rank !== undefined, `a save from before ranks loads and gets a rank (${RANKS[w2.players.get('old')!.ranks!.rank].name}, from what the save rebuilds)`);
}

// ---- the Commons: ranks and grants, no ring, no land rule
{
  const world = new World(4242);
  seedCommons(world, 0);
  const { client, measure } = setup(world);
  const a = client('Cy');
  const p = world.players.get(a.id)!;
  ok(a.last()?.rank.rank === 0 && !a.last()?.rank.ring, 'beside the Commons: a Camp, no charter ring');
  a.send({ t: 'buy', x: 14, y: -4, w: 10, h: 10 });
  const q = world.parcelAt(14, -4);
  ok(q?.owner === a.id, 'land is bought as before');
  meet(world, p, 1, 15, -3);
  const m0 = p.money;
  a.clear(); measure();
  ok(a.last()?.up?.rank === 1 && p.money - m0 === RANKS[1].grant && !a.last()?.up?.land, `a Hamlet beside the Commons: +$${p.money - m0}, no land`);
}

// ---- a sandbox has no ranks
{
  const world = new World(7);
  seedCommons(world, 0);
  const { client, measure } = setup(world, true);
  const a = client('Sand');
  measure();
  ok(a.ranks().length === 0, 'a sandbox (test city or demo) sends no ranks');
}

// ---- administration (sim/finance.ts): a rank reached while overdrawn still pays, into the overdraft
{
  const world = new World(31);
  seedFrontier(world);
  const { client, measure } = setup(world);
  const a = client('Dee');
  const p = world.players.get(a.id)!, ch = world.charter!;
  p.money = -1200; p.admin = { since: world.day }; p.adminDays = 3;
  meet(world, p, 1, ch.x + 3, ch.y + 3);
  measure();
  ok(p.ranks?.rank === 1 && p.money === -1200 + RANKS[1].grant, `in administration the Hamlet grant still lands: $${p.money}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
