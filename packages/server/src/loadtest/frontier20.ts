/**
 * The first twenty minutes of a frontier game (docs/ranks.md section 3, "The first twenty minutes"): bot F on the real
 * simulation, the goals it completes and the advisor hints it hears, minute by minute. With $18,000 to spare the bot
 * builds the library at minute 3, which used to hold the handyman's two crews so "Open the shops" waited until minute
 * 17 and five goals then arrived together; and the deficit hint came up while the bank held thousands.
 *
 *   npx tsx packages/server/src/loadtest/frontier20.ts              the guard: seeds 1-3, 30 minutes, the acceptance numbers, the deficit hint
 *   SEEDS=1-12 npx tsx packages/server/src/loadtest/frontier20.ts   the explorer: goals, hints and gaps for each seed
 *   TABLE=1 ...                                                    the minute-by-minute table of each seed
 *   MINS=180 ...                                                   play longer (the rank times)
 */
import { mulberry32, KIND_NAMES, CitizenState, Zone, tileKey, familyOf, campStage } from '@msimcity/shared';
import { World } from '../world';
import { seedFrontier } from '../seed';
import { createGame } from '../game';
import { playF, type BotFResult } from './botf';
import type { Conn } from '../transport';

/** Acceptance (card b8c21649): goal gaps of at most this many minutes through the first 20, no deficit hint while cash is over the floor */
export const MAX_GAP = 6;
export const WINDOW = 20;
export const DEFICIT_CASH = 5000;

export interface Minute { min: number; money: number; goals: number; sites: number; crews: string; queue: string }
export interface Run extends BotFResult { minutes: Minute[]; cashAt: (min: number) => number }

export async function run(seed: number, mins: number): Promise<Run> {
  Math.random = mulberry32(seed);
  const world = new World(424242);
  seedFrontier(world);
  let accept: ((c: Conn) => void) | null = null;
  const game = createGame(world, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox: false }, 10);
  const minutes: Minute[] = [];
  let doneNow = 0;
  const r = await playF(game, accept!, mins, undefined, {
    sample: (min) => {
      const me = [...world.players.values()][0];
      const crews = new Map<string, number>();
      const states: Record<number, number> = {};
      let total = 0;
      for (const c of world.citizens.values()) {
        if (!c.job || world.buildings.get(tileKey(c.wx, c.wy))?.zone !== Zone.Yard) continue;
        total++; states[c.state] = (states[c.state] ?? 0) + 1;
        if ((c.state !== CitizenState.AtSite && c.state !== CitizenState.ToSite) || !c.site) continue;
        const s = world.sites.get(c.site);
        if (!s) continue;
        const k = `${KIND_NAMES[s.kind] ?? s.kind}`;
        crews.set(k, (crews.get(k) ?? 0) + 1);
      }
      const fam = new Map<string, number>();
      for (const s of world.sites.values()) { const f = Object.keys(Zone).find((z) => (Zone as any)[z] === familyOf(s.kind)) ?? String(familyOf(s.kind)); fam.set(f, (fam.get(f) ?? 0) + 1); }
      minutes.push({
        min, money: Math.round(me?.money ?? 0), goals: me?.onboarding?.done.length ?? doneNow, sites: world.sites.size,
        crews: `[${total} crew: ${Object.entries(states).map(([k, n]) => `${Object.keys(CitizenState).find((x) => (CitizenState as any)[x] === +k)}${n}`).join(' ')}] ${[...crews].map(([k, n]) => `${k}×${n}`).join(' ')}`,
        queue: [...fam].map(([k, n]) => `${k}:${n}`).join(' '),
      });
    },
  });
  const run = r as Run;
  run.minutes = minutes;
  // the treasury at a game minute: the last sample at or before it
  run.cashAt = (min) => [...minutes].reverse().find((m) => m.min <= min)?.money ?? Infinity;
  return run;
}

/** The numbers the card asks for, from one run. */
export function accept(r: Run) {
  // gaps between consecutive goal completions through the first WINDOW minutes (the chain stalls on the advert goal after
  // that, which the bot never does, so there is no gap to read past the last one)
  const times = r.goals.map((g) => g.min).filter((t) => t <= WINDOW);
  let worst = 0, worstAt = 0;
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > worst) { worst = times[i] - times[i - 1]; worstAt = times[i - 1]; }
  const bad = r.hints.filter((h) => h.id === 'deficit' && r.cashAt(h.min) > DEFICIT_CASH);
  return { worstGap: Math.round(worst * 10) / 10, worstGapFrom: worstAt, deficitWithCash: bad };
}

const fmt = (n: number) => n.toLocaleString('en-GB');

let failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };

/** The deficit hint on its own: a player with a ledger set by hand, the hour's advice asked for. */
function deficitChecks() {
  const world = new World(424242);
  seedFrontier(world);
  let accept: ((c: Conn) => void) | null = null;
  const game = createGame(world, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox: false }, 10);
  let onMsg: ((d: string) => void) | null = null;
  accept!({ open: true, send() {}, close() {}, onMessage: (fn) => { onMsg = fn; }, onClose() {} });
  onMsg!(JSON.stringify({ t: 'hello', name: 'Ada' }));
  const p = [...world.players.values()][0], ob = game.net.onboarding!;
  const s = (ob as any).state(p) as import('../goals').GoalState;
  /** a day on which running costs ($400) outran taxes ($100), the second in a row, with `money` in the bank, `day` days after the record began */
  const ask = (money: number, day: number, yesterday: Record<string, number> = { wages: -300, upkeep: -100, tax: 100 }) => {
    world.day = s.since! + day;
    p.ledger = { day: world.day, today: {}, yesterday };
    p.money = money; s.negStreak = 1; s.negDay = world.day - 1; s.hintAt = {};
    return ob.advise(p).find((m) => m.t === 'hint' && m.id === 'deficit') as { msg?: string } | undefined;
  };
  ok(!ask(300, 1), 'no deficit hint in the first two game days, even with $300 in the bank');
  ok(!ask(18000, 5), 'none with $18,000 in the bank against $400 a day of wages and upkeep');
  ok(!ask(1250, 5), 'none while the bank covers about three days of them ($1,250 against $400 a day)');
  const low = ask(900, 5);
  ok(!!low, 'one when it covers less: $900 against $400 a day');
  ok(/lasts about 3 days/.test(low?.msg ?? ''), `and it says how long the bank lasts at that pace ("${(low?.msg ?? '').slice(0, 150)}...")`);
  ok(/within a day/.test(ask(200, 5)?.msg ?? ''), 'under a day: "empty within a day"');
  ok(!ask(900, 5, { tax: 100 }) , 'no running costs to cover, no hint');
  s.negStreak = 0; s.hintAt = {}; world.day = s.since! + 6; p.ledger = { day: world.day, today: {}, yesterday: { wages: -300, upkeep: -100, tax: 500 } }; p.money = 500; s.negDay = world.day - 1;
  ok(!ob.advise(p).some((m) => m.t === 'hint' && m.id === 'deficit'), 'none when yesterday paid its way, however little is in the bank');
  ok(campStage(['plot'], false) && !campStage(['plot'], true) && !campStage(['plot', 'res50'], false), 'the camp stage runs until "A growing town" and not at all for a skipped tutorial');
}

if (process.argv[1]?.endsWith('frontier20.ts')) {
  if (process.env.SEEDS) {
    // the explorer: SEEDS=1-12 [TABLE=1] [MINS=180]
    const seeds = process.env.SEEDS.split('-').map(Number);
    const [a, b] = [seeds[0], seeds[1] ?? seeds[0]];
    const mins = Number(process.env.MINS ?? 30);
    for (let seed = a; seed <= b; seed++) {
      const r = await run(seed, mins);
      const acc = accept(r);
      console.log(`seed ${seed}: ranks ${JSON.stringify(r.ups)} low $${fmt(r.low)} @${r.lowAt}`);
      console.log('  goals: ' + r.goals.map((g) => `${g.id}@${g.min}`).join(' '));
      console.log('  hints: ' + (r.hints.map((h) => `${h.id}@${h.min} ($${fmt(r.cashAt(h.min))})`).join(' ') || 'none'));
      console.log(`  worst goal gap in the first ${WINDOW} min: ${acc.worstGap.toFixed(1)} from minute ${acc.worstGapFrom}; deficit hints with cash over $${fmt(DEFICIT_CASH)}: ${acc.deficitWithCash.length}`);
      if (process.env.TABLE) {
        console.log('  min  goals  money   sites  crews | queue');
        for (const m of r.minutes.filter((m) => m.min <= 30)) console.log(`  ${String(m.min).padStart(3)}  ${String(m.goals).padStart(5)}  ${String(m.money).padStart(6)}  ${String(m.sites).padStart(5)}  ${m.crews} | ${m.queue}`);
      }
    }
  } else {
    // the guard: bot F's first 30 minutes on three seeds, then the hint on its own
    const t0 = performance.now();
    for (const seed of [1, 2, 3]) {
      const r = await run(seed, 30);
      const acc = accept(r);
      const shops = r.goals.find((g) => g.id === 'shops')?.min ?? Infinity;
      ok(acc.worstGap <= MAX_GAP, `seed ${seed}: goals fall at most ${MAX_GAP} minutes apart through minute ${WINDOW} (worst ${acc.worstGap} from minute ${acc.worstGapFrom}; ${r.goals.filter((g) => g.min <= WINDOW).length} goals)`);
      ok(shops <= 10, `seed ${seed}: "Open the shops" is done by minute 10 (${shops}), not behind the library`);
      ok(acc.deficitWithCash.length === 0, `seed ${seed}: no deficit hint while the bank is over $${fmt(DEFICIT_CASH)} (${r.hints.filter((h) => h.id === 'deficit').length} heard)`);
    }
    deficitChecks();
    console.log(`\n${failed ? 'FAILED' : 'passed'} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
    process.exit(failed ? 1 : 0);
  }
}
