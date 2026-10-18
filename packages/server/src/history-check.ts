/**
 * `npm run history:check` (docs/charts.md): the city history's cadence and caps, the save round trip, an old save without
 * history, the charts messages over a fake client, and what a sample costs.
 *
 *   npx tsx packages/server/src/history-check.ts
 */
import { Rings, HIST_TIERS, WORLD_KEYS, PLAYER_KEYS, TICKS_PER_HOUR, type ServerMsg } from '@msimcity/shared';
import { World } from './world';
import { seedCommons } from './seed';
import { createGame } from './game';
import { historyOf } from './history';
import { snapshotOf, worldFromSnapshot } from './snapshot';
import type { Conn } from './transport';

let failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };

// ---- 1. rings: cadence, averaging, caps, gaps ---------------------------------------------
{
  const r = new Rings(['a', 'b']);
  for (let h = 0; h < 48; h++) r.push(h, [h, 100]);
  const day = r.read(0, 1)!;
  ok(day.first === 0 && day.v.length === 2, 'two days of hours make two daily points (one finished, one in progress)');
  ok(Math.abs(day.v[0] - 11.5) < 1e-9, 'a finished day is the mean of its 24 hourly samples');
  ok(r.read(1, 0)!.v.length === 48 && r.read(0, 2)!.v.length === 1, 'hourly keeps every hour; the first week is one weekly point so far');
  r.push(47, [9, 9]); r.push(10, [9, 9]);
  ok(r.read(0, 0)!.v.length === 48, 'a repeated or earlier hour is ignored');
  const g = new Rings(['a']);
  g.push(0, [1]); g.push(5, [2]);
  const gv = g.read(0, 0)!.v;
  ok(gv.length === 6 && Number.isNaN(gv[3]) && gv[5] === 2, 'skipped hours are gaps');
  const long = new Rings(WORLD_KEYS);
  const vals = new Float64Array(WORLD_KEYS.length).fill(1);
  const hours = 24 * 7 * 300;
  for (let h = 0; h < hours; h++) { vals[0] = h; long.push(h, vals); }
  const lens = HIST_TIERS.map((_, i) => long.read(0, i)!.v.length);
  ok(HIST_TIERS.every((t, i) => lens[i] === t.size + 1), `caps hold after ${hours} hours: ${lens.join(' / ')} points (the sizes plus the unfinished period)`);
  const newest = long.read(0, 0)!;
  ok(newest.v.at(-1) === hours - 1 && newest.first + newest.v.length - 1 === hours - 1, 'the newest hourly point is the last hour');
  const dto = JSON.parse(JSON.stringify(long.toDTO()));
  const back = Rings.fromDTO(WORLD_KEYS, dto);
  const same = HIST_TIERS.every((_, i) => JSON.stringify(back.read(0, i)) === JSON.stringify(long.read(0, i)));
  ok(same && back.hour === long.hour, 'a DTO round trip (JSON) reads back identical in every tier');
  back.push(hours, vals); long.push(hours, vals);
  ok(JSON.stringify(back.read(0, 1)) === JSON.stringify(long.read(0, 1)), 'a restored ring carries on aggregating as the original');
  ok(Rings.fromDTO(['x'], dto).read(0, 0)!.v.slice(0, -1).every(Number.isNaN), 'a series the save lacks reads empty (bar the period in progress)');
  ok(Rings.fromDTO(WORLD_KEYS, { nonsense: 1 } as never).hour === -1, 'garbage loads as empty rings');
  console.log(`     wire size of the full world history: ${(JSON.stringify(dto).length / 1024).toFixed(0)} KB (every tier full)`);
}

// ---- 2. a game: sampling every hour, the wire, the save -----------------------------------
const world = new World(4242);
seedCommons(world, 0);
let accept: ((c: Conn) => void) | null = null;
const game = createGame(world, { onConnection: (fn) => { accept = fn; } }, { devTools: false, sandbox: true });
const got: ServerMsg[] = [];
let onMsg: ((d: string) => void) | null = null;
const conn: Conn = { open: true, send: (d) => got.push(JSON.parse(d)), close() {}, onMessage: (fn) => { onMsg = fn; }, onClose() {} };
accept!(conn);
onMsg!(JSON.stringify({ t: 'hello', name: 'Tester' }));
const me = [...world.players.values()].find((p) => p.name === 'Tester')!;
const hist = historyOf(world);
const t0 = performance.now();
for (let i = 0; i < TICKS_PER_HOUR * 24 * 3 + 5; i++) game.step();
const ms = performance.now() - t0;
const hours = Math.floor(world.tick / TICKS_PER_HOUR);
ok(hist.world.read(0, 0)!.v.length === hours + 1 - 0 || hist.world.read(0, 0)!.v.length === hours, `one sample per game hour: ${hist.world.read(0, 0)!.v.length} points over ${hours} hours`);
ok(!got.some((m) => m.t === 'histSample' || m.t === 'history'), 'nothing is sent until the panel is opened');
got.length = 0;
onMsg!(JSON.stringify({ t: 'hist', open: true }));
const full = got.find((m) => m.t === 'history') as Extract<ServerMsg, { t: 'history' }> | undefined;
ok(full && full.hour === hist.hour && full.world.keys.length === WORLD_KEYS.length && full.mine.keys.length === PLAYER_KEYS.length, "'hist' open answers with the whole history");
got.length = 0;
for (let i = 0; i < TICKS_PER_HOUR * 2; i++) game.step();
const samples = got.filter((m) => m.t === 'histSample') as Extract<ServerMsg, { t: 'histSample' }>[];
ok(samples.length === 2 && samples[0].w.length === WORLD_KEYS.length && samples[0].p.length === PLAYER_KEYS.length, 'an open panel gets one small sample per game hour');
// a client that applies the same samples ends with the same hourly tier
const client = Rings.fromDTO(WORLD_KEYS, full!.world);
for (const s of samples) client.push(s.hour, s.w);
ok(JSON.stringify(client.read(0, 1)!.v.map((v) => Math.round(v))) === JSON.stringify(hist.world.read(0, 1)!.v.map((v) => Math.round(v))), 'client rings fed by the samples agree with the server (daily tier)');
onMsg!(JSON.stringify({ t: 'hist', open: false }));
got.length = 0;
for (let i = 0; i < TICKS_PER_HOUR; i++) game.step();
ok(!got.some((m) => m.t === 'histSample'), 'a closed panel gets nothing');

// ---- 3. save round trip, and an old save without history ----------------------------------
world.credit(me.id, 500, 'tax'); world.credit(me.id, -120, 'upkeep');
for (let i = 0; i < TICKS_PER_HOUR; i++) game.step();
const snap = JSON.parse(JSON.stringify(snapshotOf(world)));
ok(snap.version === 8 && snap.history?.v === 1, 'the snapshot carries history and the format version did not change');
const w2 = worldFromSnapshot(snap)!;
const h2 = historyOf(w2);
const near = (a: { first: number; v: number[] } | null, b: { first: number; v: number[] } | null) => !!a && !!b && a.first === b.first && a.v.length === b.v.length && a.v.every((x, i) => (Number.isNaN(x) && Number.isNaN(b.v[i])) || Math.abs(x - b.v[i]) < 0.01);
ok(h2.hour === hist.hour && near(h2.world.read(0, 0), hist.world.read(0, 0)) && near(h2.world.read(3, 1), hist.world.read(3, 1)) && near(h2.world.read(4, 2), hist.world.read(4, 2)), 'history comes back from a save, in every tier (to the cent)');
ok(near(h2.playerRings(me.id)?.read(0, 0) ?? null, hist.playerRings(me.id)?.read(0, 0) ?? null), "and so does a player's treasury");
const income = hist.playerRings(me.id)!.read(1, 0)!.v.at(-1)!;
ok(income >= 500 - 1e-6, `income per day counts the ledger's credits (${income})`);
const old = JSON.parse(JSON.stringify(snap)); delete old.history;
const w3 = worldFromSnapshot(old)!;
ok(w3 && historyOf(w3).hour === -1 && historyOf(w3).world.read(0, 0) === null, 'a save without history loads with empty history');
const g3 = createGame(w3, { onConnection() {} }, { devTools: false, sandbox: true });
for (let i = 0; i < TICKS_PER_HOUR * 2; i++) g3.step();
ok(historyOf(w3).world.read(0, 0)!.v.length >= 2, 'and starts recording on the next hours');

// ---- 4. cost -------------------------------------------------------------------------------
{
  const h = historyOf(world);
  const n = 2000, hist2 = h.world, vals = new Float64Array(WORLD_KEYS.length).fill(3);
  const t = performance.now();
  for (let i = 0; i < n; i++) hist2.push(hist.world.hour + 1 + i, vals);
  const per = (performance.now() - t) / n;
  console.log(`     ring push: ${(per * 1000).toFixed(1)} us per hourly sample (${WORLD_KEYS.length} series, 3 tiers)`);
  ok(per < 0.5, 'a push is far under half a millisecond (once per game hour = 100 ticks)');
  console.log(`     ${hours} game hours of ticks (step, with sampling) took ${(ms / 1000).toFixed(1)} s`);
}
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
