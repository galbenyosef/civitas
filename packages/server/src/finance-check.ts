/**
 * `npm run finance:check` (docs/early-game-audit.md "After Audit #5"): money that can run out, driven over a fake client
 * as a player would. The overdraft line and its refusal, interest at midnight in the ledger, the count of midnights
 * below zero, administration (refusals, the grant withdrawn), the recovery plan's three actions (raise tax, sell land
 * back, mothball and reopen a service), the save round trip, coming out at the first midnight in the black, and a
 * sandbox that never goes in. Midnights are stepped by hand (World.day, then Finance.tick), so no simulation runs.
 *
 *   npx tsx packages/server/src/finance-check.ts
 */
import {
  ECONOMY_TUNING, LAND_PRICE_PER_TILE, KIND_ID, Terrain, packTile, placedFromDoor, isRoad, tileKey,
  type ServerMsg, type ClientMsg, type PlayerDTO,
} from '@msimcity/shared';
import { World } from './world';
import { seedCommons } from './seed';
import { createGame, type Game } from './game';
import { snapshotOf, worldFromSnapshot } from './snapshot';
import type { Conn } from './transport';

let failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };
const T = ECONOMY_TUNING;

function setup(sandbox: boolean) {
  const world = new World(4242);
  seedCommons(world, 0);
  let accept: ((c: Conn) => void) | null = null;
  const game = createGame(world, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox });
  const client = (name: string) => {
    const got: ServerMsg[] = [];
    let onMsg: ((d: string) => void) | null = null;
    accept!({ open: true, send: (d) => got.push(JSON.parse(d)), close() {}, onMessage: (fn) => { onMsg = fn; }, onClose() {} });
    const send = (m: ClientMsg) => onMsg!(JSON.stringify(m));
    send({ t: 'hello', name });
    const toast = () => { const t = got.filter((m) => m.t === 'toast').at(-1) as Extract<ServerMsg, { t: 'toast' }> | undefined; return t?.msg ?? ''; };
    const hints = () => got.filter((m) => m.t === 'hint').map((m) => (m as Extract<ServerMsg, { t: 'hint' }>).id);
    return { got, send, toast, hints, id: name.toLowerCase(), clear: () => { got.length = 0; } };
  };
  return { world, game, client };
}
/** Midnight by hand: what Simulation.newDay does to the day counter, then the finance step and a flush. */
function midnight(world: World, game: Game) { world.day++; world.tick = world.day * 2400; game.finance.tick(); game.net.flush(); }
/** The player's DTO as everyone sees it in the players message. */
const dtoOf = (world: World, id: string): PlayerDTO => world.playerDTO(world.players.get(id)!, true, true);

{
  const { world, game, client } = setup(false);
  const a = client('Ada');
  const p = world.players.get(a.id)!;
  const X = 200, Y = 200;

  // ---- the overdraft line: spending may go to -overdraftLimit and no further
  p.money = 100;
  a.send({ t: 'buy', x: X, y: Y, w: 10, h: 10 }); // $1,000 with $100: on the overdraft
  ok(p.money === 100 - 100 * LAND_PRICE_PER_TILE, `a $1,000 purchase with $100 goes onto the overdraft ($${p.money})`);
  a.clear();
  a.send({ t: 'buy', x: X + 10, y: Y, w: 30, h: 30 }); // $9,000: past the limit
  ok(/\$5,000 overdraft limit/.test(a.toast()) && /^Need \$9,000/.test(a.toast()), `past the limit is refused, naming it ("${a.toast()}")`);
  ok(p.money === -900, 'and nothing is charged');
  ok(dtoOf(world, a.id).fin?.limit === T.overdraftLimit && dtoOf(world, a.id).fin?.days === 0, 'PlayerDTO.fin is there while overdrawn');

  // ---- interest at midnight, the count, the overdraft hint
  a.clear();
  midnight(world, game);
  const interest = world.ledgerDTO(p).today.interest ?? 0; // charged at the start of the new day, like upkeep
  ok(Math.abs(interest - -900 * T.overdraftInterestPerDay) < 1e-6 && Math.abs(p.money - -918) < 1e-6, `interest at midnight in the ledger: ${interest.toFixed(2)} (2% of -$900)`);
  ok(p.adminDays === 1 && !p.admin, 'one midnight below zero counted, not in administration yet');
  ok(a.hints().includes('overdraft'), 'the overdraft hint at the first midnight below zero');
  midnight(world, game);
  ok(p.adminDays === 2 && !p.admin, 'two midnights');
  a.clear();
  midnight(world, game);
  ok(p.adminDays === 3 && p.admin?.since === world.day, `three midnights: in administration since day ${p.admin?.since}`);
  ok(a.hints().includes('admin'), 'the admin hint on entry');
  ok(dtoOf(world, a.id).fin?.admin === world.day, 'PlayerDTO.fin.admin carries the day it began');
  ok(world.payrollShare(a.id) === 1 && world.payrollShare('sys') === T.civicPayroll, 'the regional grant is withdrawn: all of the civic payroll');

  // ---- refusals in administration; bulldozing and parcel settings still work
  const q1 = world.parcelAt(X, Y)!;
  a.clear(); a.send({ t: 'build', tool: 'road', tiles: [[X, Y + 1], [X + 1, Y + 1]] });
  ok(/^In administration: laying roads/.test(a.toast()) && !isRoad(world.getTile(X, Y + 1)), `a road is refused ("${a.toast().slice(0, 60)}…")`);
  for (const [m, what] of [
    [{ t: 'buy', x: X, y: Y + 10, w: 2, h: 2 }, 'buying land'], [{ t: 'build', tool: 'res', tiles: [[X + 3, Y + 3]] }, 'zoning'],
    [{ t: 'build', tool: 'police', tiles: [[X + 3, Y + 3]] }, 'building'], [{ t: 'unlock', id: 'zon1' }, 'research'],
    [{ t: 'line', op: 'save', line: {} }, 'opening or changing lines'],
  ] as [ClientMsg, string][]) { a.clear(); a.send(m); ok(a.toast().startsWith(`In administration: ${what}`), `${m.t}${'tool' in m ? ' ' + m.tool : ''} is refused: ${what}`); }
  a.clear(); a.send({ t: 'parcel', id: q1.id, taxRate: 0.12 });
  ok(q1.taxRate === 0.12, 'parcel settings still work');

  // build what the plan works on, past the refusals (placed directly): roads on the first parcel, a police station on a second
  for (let x = X; x < X + 10; x++) world.setTile(x, Y + 1, packTile(Terrain.Grass, true, 0, 0));
  world.recountRoads(q1.id);
  delete p.admin; a.send({ t: 'buy', x: X, y: Y + 10, w: 10, h: 10 }); p.admin = { since: world.day }; // a second parcel
  const q2 = world.parcelAt(X, Y + 10)!;
  ok(!!q2 && q2.id !== q1.id, 'a second parcel');
  const placed = placedFromDoor(KIND_ID['police'], X + 3, Y + 13, 0);
  world.placeStructure(placed, { work: 1, priority: 0, built: true });
  const station = world.buildings.get(tileKey(placed.doorX, placed.doorY))!;
  ok(station && station.level > 0, 'a police station stands on it');

  // ---- the plan as the panel shows it
  game.finance['plans'].clear();
  const plan = dtoOf(world, a.id).fin!.plan;
  ok(plan.taxParcels === 2 && plan.sellParcels === 1 && plan.sellTiles === 100 && plan.sellCash === 100 * LAND_PRICE_PER_TILE * T.landBuyback,
    `the plan: tax on ${plan.taxParcels} parcels, sell ${plan.sellParcels} parcel (${plan.sellTiles} tiles, $${plan.sellCash}), mothball ${plan.mothball} (about $${plan.mothballPerDay} a day)`);
  ok(plan.mothball === 1 && plan.mothballPerDay > 0, 'one service to mothball, with what it saves');

  // ---- raise tax
  a.clear(); a.send({ t: 'recover', action: 'tax' });
  ok(q1.taxRate === T.recoveryTaxRate && q2.taxRate === T.recoveryTaxRate, `raise tax: both parcels at ${T.recoveryTaxRate * 100}% ("${a.toast()}")`);
  a.clear(); a.send({ t: 'recover', action: 'tax' });
  ok(/already/.test(a.toast()), 'a second press says it is done already');

  // ---- sell land back: the empty parcel with roads goes, the one with the station stays
  const m0 = p.money, land0 = world.ledgerDTO(p).today.land ?? 0;
  a.clear(); a.send({ t: 'recover', action: 'sell' }); game.net.flush();
  ok(!world.parcels.has(q1.id) && world.parcels.has(q2.id), `sell: the empty parcel is sold, the one with the station kept ("${a.toast()}")`);
  ok(Math.abs(p.money - m0 - 100 * LAND_PRICE_PER_TILE * T.landBuyback) < 1e-6 && (world.ledgerDTO(p).today.land ?? 0) - land0 === 800, `$${p.money - m0} back through the ledger's land line`);
  ok(world.parcelIdAt(X + 2, Y + 2) === 0 && !isRoad(world.getTile(X + 2, Y + 1)), 'its tiles are unclaimed and its roads taken up');
  const parcelsMsg = a.got.find((m) => m.t === 'parcels') as Extract<ServerMsg, { t: 'parcels' }> | undefined;
  ok(parcelsMsg?.removed?.includes(q1.id), 'the parcels message lists it as removed');

  // ---- mothball: no staff, no hiring, no upkeep, saved; reopen
  a.clear(); a.send({ t: 'recover', action: 'mothball' });
  const key = tileKey(station.x, station.y);
  ok(world.mothballed.has(key), `mothball: the station is closed and its staff let go ("${a.toast().slice(0, 70)}…")`);
  ok(dtoOf(world, a.id).fin!.plan.mothballed === 1, 'the plan counts it as mothballed');
  const snap = worldFromSnapshot(JSON.parse(JSON.stringify(snapshotOf(world))))!;
  ok(snap.mothballed.has(key) && snap.players.get(a.id)?.admin?.since === p.admin!.since && snap.players.get(a.id)?.adminDays === 3, 'mothballed, admin and adminDays survive a save');
  a.clear(); a.send({ t: 'recover', action: 'unmothball', keys: [key] });
  ok(!world.mothballed.has(key), `reopen by its door ("${a.toast()}")`);
  a.clear(); a.send({ t: 'recover', action: 'mothball', keys: [`${X + 50},${Y + 50}`] });
  ok(/Nothing to mothball/.test(a.toast()), 'a key with no building of yours does nothing');
  a.send({ t: 'recover', action: 'mothball', keys: [key] });
  ok(world.mothballed.has(key), 'mothball one building by its door');

  // ---- out at the first midnight in the black
  p.money = -10;
  midnight(world, game);
  ok(!!p.admin && p.adminDays === 4, 'still below zero: still in administration');
  p.money = 50;
  a.clear(); midnight(world, game);
  ok(!p.admin && p.adminDays === undefined, 'the first midnight at zero or above ends administration');
  ok(/Out of administration/.test(a.toast()), `and says so ("${a.toast().slice(0, 60)}…")`);
  ok(world.payrollShare(a.id) === T.civicPayroll, 'the grant is back');
  ok(dtoOf(world, a.id).fin?.plan.mothballed === 1, 'fin stays while something is mothballed');
  a.clear(); a.send({ t: 'build', tool: 'road', tiles: [[X + 1, Y + 11]] });
  ok(isRoad(world.getTile(X + 1, Y + 11)), 'building works again');
}

{
  // ---- a sandbox never goes in, the Commons is never charged
  const { world, game, client } = setup(true);
  const a = client('Sam');
  const p = world.players.get(a.id)!;
  p.devUnlimited = false; p.money = -1000;
  const sys = world.players.get('sys')!; sys.money = -1000;
  for (let i = 0; i < 4; i++) midnight(world, game);
  ok(!p.admin && !p.adminDays, 'a sandbox player is never put into administration');
  ok(sys.money === -1000, 'the Commons pays no interest');
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
