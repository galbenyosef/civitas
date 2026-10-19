/**
 * Fires probe (docs/incidents.md, server/src/sim/fires.ts): the card's acceptance on real roads and real engines.
 *
 *   npx tsx packages/server/src/loadtest/fires.ts [--seed 1] [--n 24] [--quiet]
 *
 * A 1×1 Commons (seedCity, built 3) with its fire station swapped for a fire post (one engine), filled for a day as a
 * test city fills. Then, one fire at a time so the post's engine is home for each:
 * 1. covered: homes within 14 tiles (square) of the staffed post each lose under half their level, the engine arrives,
 *    the badge shows "on fire" while it burns and clears after, the owner's ledger carries the damage under 'fire';
 * 2. uncovered: homes beyond the reach of any staffed fire building burn out (level 0, their people gone);
 * 3. the warning fire: a player's district (seedCity seedOwner) gets no fire until they house FIRE.warnHoused, then one
 *    within warnMinHours + warnSpanHours, which loses nothing even with the station mothballed (the bucket chain), and
 *    no ordinary fire in the grace day after it;
 * 4. the background rate in a 2×2 Commons over two days, the same fires on a second run (hash-seeded), and a save with a
 *    fire burning loads with it still burning.
 * Prints pass/fail counts; exits 1 on any failure.
 */
import { TICKS_PER_DAY, TICKS_PER_HOUR, FIRE, FirePhase, FireOutcome, Issue, Zone, subFor, tileKey, KIND_ID } from '@msimcity/shared';
import { World, type Building } from '../world';
import { seedCity } from './cities';
import { createGame, type Game } from '../game';
import { snapshotOf, worldFromSnapshot } from '../snapshot';

const argv = process.argv.slice(2);
const get = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const seed = get('seed', 1), N = get('n', 24);
const quiet = argv.includes('--quiet');
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
const log = (s: string) => { if (!quiet) console.log(s); };

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

/** A 1×1 city, its fire station a fire post, filled for about a day with fires off; the game is a sandbox so the Commons' badges show. */
function city(owner = 'sys', rnd = seed, districts = 1): { w: World; g: Game; post: Building } {
  Math.random = mulberry32(rnd * 7919);
  const w = new World(rnd);
  const layout = seedCity(w, { districts, built: 3, seedOwner: owner });
  const d = layout.districts[0];
  const px = d.x + 16, py = d.y + 1;
  w.setTile(px, py, w.getTile(px, py), subFor(KIND_ID['fire-post']));
  const g = createGame(w, { onConnection() {} }, { devTools: false, sandbox: true });
  g.fires.enabled = false;
  for (let i = 0; i < 1.1 * DAY; i++) g.step();
  g.fires.enabled = true;
  return { w, g, post: w.buildings.get(tileKey(px, py))! };
}
const cheb = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
/** Run until the fire at (x, y) is out (or `max` ticks); returns what was seen on the way. */
function burn(g: Game, b: Building, max = 8 * TPH) {
  const w = g.world, x = b.x, y = b.y, level = b.level;
  const fireAt = () => g.fires.dtos().find((f) => f.x === x && f.y === y);
  let badge = false, engineSeen = false, arrived = -1, tick0 = w.tick, garage = 0, queued = 0;
  for (let i = 0; i < max; i++) {
    g.step();
    const f = fireAt();
    if (!f) break;
    if (f.ph !== FirePhase.Out && g.issues.codeAt(x, y) === Issue.Fire) badge = true;
    if (f.eng) engineSeen = true;
    if (arrived < 0 && f.ph === FirePhase.Fighting) arrived = w.tick - tick0;
    const fi = (g.fires as unknown as { fires: Map<string, { engine: number | null }> }).fires.get(tileKey(x, y));
    const v = fi?.engine != null ? w.vehicles.get(fi.engine) : undefined;
    if (v && v.phase === 'out') { if (v.lane < 0) garage++; else if (v.wait > 1) queued++; }
    if (f.ph === FirePhase.Out) break;
  }
  const f = fireAt();
  for (let i = 0; i < 2; i++) g.step(); // let the badge's look run
  const after = w.buildings.get(tileKey(x, y));
  return { level, after: after?.level ?? 0, out: f?.out, d: f?.d ?? 0, badge, badgeAfter: g.issues.codeAt(x, y) === Issue.Fire, engineSeen, arrived, garage, queued, people: after?.occupants ?? 0 };
}
const pick = <T>(xs: T[], n: number) => { const out: T[] = []; const step = Math.max(1, xs.length / n); for (let i = 0; i < xs.length && out.length < n; i += step) out.push(xs[Math.floor(i)]); return out; };

// ---- 1 and 2: covered and uncovered -----------------------------------------------------------------------------
{
  console.log(`1. covered: homes within ${FIRE.reach} tiles of a staffed fire post`);
  const { w, g, post } = city();
  ok(post?.id === KIND_ID['fire-post'] && post.occupants > 0 && g.sim.staffedServices.includes(post), `the fire post at (${post?.x}, ${post?.y}) is staffed (${post?.occupants} crew)`);
  g.fires.enabled = false; // no background fires while measuring single ones
  const homes = (pred: (b: Building) => boolean) => w.builtOf(Zone.Residential).filter((b) => b.level >= 1 && !w.sites.has(tileKey(b.x, b.y)) && pred(b))
    .sort((a, b) => cheb(a, post) - cheb(b, post) || a.x - b.x || a.y - b.y);
  const near = pick(homes((b) => cheb(b, post) <= FIRE.reach), N);
  const ledger0 = w.players.get('sys')!.ledger?.today.fire ?? 0, day0 = w.day;
  const lostShares: number[] = [], arrivals: number[] = [];
  let underHalf = 0, engines = 0, badges = 0, cleared = 0;
  for (const b of near) {
    if (!g.fires.ignite(b)) continue;
    const r = burn(g, b);
    const share = (r.level - r.after) / r.level;
    lostShares.push(share);
    if (share < 0.5) underHalf++;
    if (r.arrived >= 0) arrivals.push(r.arrived);
    if (r.engineSeen) engines++;
    if (r.badge) badges++;
    if (!r.badgeAfter) cleared++;
    log(`     (${b.x},${b.y}) ${cheb(b, post)} tiles: level ${r.level} -> ${r.after}, burnt ${(r.d * 100).toFixed(0)}% when the engine came after ${(r.arrived / TPH * 60).toFixed(0)} min (${(r.garage / TPH * 60).toFixed(0)} waiting to pull out, ${(r.queued / TPH * 60).toFixed(0)} queued), outcome ${r.out}`);
  }
  const n = lostShares.length; // a stale pick (gone with an earlier fire) is skipped
  const mean = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / Math.max(1, xs.length);
  ok(n >= Math.min(N, 10), `${n} covered fires lit`);
  ok(underHalf === n, `every covered home lost under half its level: ${underHalf}/${n} (mean share lost ${(mean(lostShares) * 100).toFixed(1)}%, worst ${(Math.max(...lostShares) * 100).toFixed(0)}%)`);
  ok(engines === n && arrivals.length === n, `an engine drove to every one: ${engines}/${n} dispatched, ${arrivals.length} arrived, mean ${(mean(arrivals) / TPH * 60).toFixed(0)} game minutes, worst ${(Math.max(...arrivals) / TPH * 60).toFixed(0)}`);
  ok(badges === n && cleared === n, `the on-fire badge showed while burning (${badges}/${n}) and cleared once out (${cleared}/${n})`);
  const L = w.players.get('sys')!.ledger!;
  const fireCost = (w.day === day0 ? (L.today.fire ?? 0) - ledger0 : (L.today.fire ?? 0) + (L.yesterday.fire ?? 0) - ledger0);
  ok(fireCost < 0 && g.fires.stats.cost > 0, `the owner's ledger carries the damage under 'fire': ${fireCost.toFixed(0)} (stats ${g.fires.stats.cost})`);

  console.log(`2. uncovered: homes beyond the reach of every staffed fire building`);
  const far = pick(homes((b) => !g.sim.staffedServices.some((s) => s.zone === Zone.Fire && cheb(b, s) <= Math.max(FIRE.reach, 9))), Math.min(12, N));
  let burnt = 0, gone = 0, lit = 0;
  for (const b of far) {
    const before = b.occupants;
    if (!g.fires.ignite(b)) continue; // gone with an earlier one (a merged building broke back into lots)
    lit++;
    const r = burn(g, b, 6 * TPH);
    if (r.out === FireOutcome.Burnt && r.after === 0) burnt++;
    if (before === 0 || r.people === 0) gone++;
    log(`     (${b.x},${b.y}) ${cheb(b, post)} tiles from the post: level ${r.level} -> ${r.after}, outcome ${r.out}, engine ${r.engineSeen}`);
  }
  ok(lit >= 6 && burnt === lit, `every uncovered home burnt out: ${burnt}/${lit}`);
  ok(gone === lit, `nobody lives in a burnt-out lot: ${gone}/${lit}`);

  // a save with a fire burning loads with it burning
  const b = homes((h) => cheb(h, post) >= 6 && cheb(h, post) <= FIRE.reach).find((h) => g.fires.ignite(h))!;
  for (let i = 0; i < 3; i++) g.step();
  const snap = JSON.parse(JSON.stringify(snapshotOf(w)));
  const w2 = worldFromSnapshot(snap)!;
  const g2 = createGame(w2, { onConnection() {} }, { devTools: false, sandbox: true });
  ok(g2.fires.burningAt(b.x, b.y), `a saved fire is still burning after a load`);
  let sent = false;
  for (let i = 0; i < 150; i++) { g2.step(); if (g2.fires.dtos().some((f) => f.x === b.x && f.y === b.y && f.eng)) sent = true; }
  ok(sent || !g2.sim.staffedServices.some((s) => s.zone === Zone.Fire && cheb(b, s) <= FIRE.reach), 'and an engine is sent to it again');
}

// ---- 3: the warning fire ------------------------------------------------------------------------------------------
for (const mothball of [true, false]) {
  console.log(`3${mothball ? 'a' : 'b'}. a player's warning fire${mothball ? ', their fire post mothballed (the bucket chain)' : ', their fire post staffed'}`);
  const { w, g, post } = city('p1', seed + (mothball ? 11 : 12));
  const p = w.players.get('p1')!;
  if (mothball) w.setMothballed(post, true);
  // the fill counts housed for the owner; start the clock again as if they had just reached it
  const housedAt = w.tick;
  ok((p.progress.housed ?? 0) >= FIRE.warnHoused, `p1 houses ${p.progress.housed} (warning at ${FIRE.warnHoused})`);
  let first = -1, firstOut: number | undefined, lost = 0, later = 0;
  const limit = (FIRE.warnMinHours + FIRE.warnSpanHours + 2) * TPH;
  const levels = new Map<string, number>();
  for (let i = 0; i < limit + FIRE.graceDays * DAY - 2 * TPH; i++) {
    g.step();
    const fs = g.fires.dtos();
    if (first < 0 && fs.length) {
      first = w.tick - housedAt;
      const f = fs[0], b = w.buildings.get(tileKey(f.x, f.y));
      levels.set(tileKey(f.x, f.y), b?.level ?? 0);
    }
    if (first >= 0 && fs.length > 1) later = Math.max(later, fs.length - 1);
    const f0 = fs[0];
    if (f0 && f0.ph === FirePhase.Out && firstOut === undefined) {
      firstOut = f0.out;
      const b = w.buildings.get(tileKey(f0.x, f0.y));
      lost = (levels.get(tileKey(f0.x, f0.y)) ?? 0) - (b?.level ?? 0);
    }
  }
  ok(first >= 0 && first <= (FIRE.warnMinHours + FIRE.warnSpanHours + 1) * TPH, `the warning fire lit ${(first / TPH).toFixed(1)} h after the threshold (within ${FIRE.warnMinHours}-${FIRE.warnMinHours + FIRE.warnSpanHours} h, checked hourly)`);
  ok(firstOut !== undefined && firstOut !== FireOutcome.Burnt && lost === 0, `it was put out with nothing lost (outcome ${firstOut}, levels lost ${lost})`);
  ok(later === 0, `no other fire in p1's parcels during the grace day after it (${later})`);
  ok(g.fires.stats.warning === 1, `exactly one warning fire (${g.fires.stats.warning})`);
}

// ---- 4: the background rate, and the same fires on a second run ---------------------------------------------------
console.log('4. background fires in a 2×2 Commons over two days, twice from the same seed');
const runs: string[] = [];
for (let k = 0; k < 2; k++) {
  const { w, g } = city('sys', seed + 20, 2);
  const seen = new Set<string>();
  for (let i = 0; i < 2 * DAY; i++) { g.step(); for (const f of g.fires.dtos()) seen.add(`${f.x},${f.y}@${f.t0}`); }
  const s = g.fires.stats;
  runs.push([...seen].sort().join(' '));
  if (k === 0) {
    const homes = w.builtOf(Zone.Residential).length + w.builtOf(Zone.Commercial).length + w.builtOf(Zone.Industrial).length + w.builtOf(Zone.Office).length;
    log(`     ${homes} homes and works: ${s.lit} fires in 2 days (${s.saved} saved, ${s.partial} partial, ${s.burnt} burnt out), ${s.engines} engines sent, ${s.arrived} arrived; mean ${(g.fires.ms / g.fires.ticks).toFixed(3)} ms a tick`);
    ok(s.lit >= 1 && s.lit <= 30, `the Commons had a few fires, not a flood: ${s.lit} in two days`);
  }
}
ok(runs[0] === runs[1] && runs[0].length > 0, 'the same fires, at the same ticks, on a second run from the same seed');

console.log(`\nfires probe: ${checks - fails}/${checks} passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
