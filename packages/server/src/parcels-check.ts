/**
 * `npm run parcels:check` (docs/world-map.md): parcel management on the server, driven over a fake client as a player
 * would: combine (rectangle merges, estates, the refusals), split (the cut, water, a building across the cut), estate
 * settings, leaving an estate, the save round trip, and the world map's sector answers and their cost.
 *
 *   npx tsx packages/server/src/parcels-check.ts
 */
import { CHUNK_SIZE, SECTOR_CHUNKS, MAX_PARCEL_EDGE, Terrain, packTile, rleDecode, mapClassOf, MapClass, KIND_ID, placedFromDoor, type ServerMsg, type ClientMsg } from '@msimcity/shared';
import { World } from './world';
import { seedCommons } from './seed';
import { createGame } from './game';
import { snapshotOf, worldFromSnapshot } from './snapshot';
import { seedCity } from './loadtest/cities';
import type { Conn } from './transport';

let failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };

const world = new World(4242);
seedCommons(world, 0);
let accept: ((c: Conn) => void) | null = null;
const game = createGame(world, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox: false });
/** a player on a fake connection: everything it is sent, and a way to send */
function client(name: string) {
  const got: ServerMsg[] = [];
  let onMsg: ((d: string) => void) | null = null;
  accept!({ open: true, send: (d) => got.push(JSON.parse(d)), close() {}, onMessage: (fn) => { onMsg = fn; }, onClose() {} });
  const send = (m: ClientMsg) => onMsg!(JSON.stringify(m));
  send({ t: 'hello', name });
  const toast = () => { const t = got.filter((m) => m.t === 'toast').at(-1) as Extract<ServerMsg, { t: 'toast' }> | undefined; got.length = 0; return t; };
  return { got, send, toast, id: name.toLowerCase() };
}
const a = client('Ada'), b = client('Bob');
const parcelOf = (x: number, y: number) => world.parcelAt(x, y);
const mine = () => [...world.parcels.values()].filter((p) => p.owner === a.id);
const X = 200, Y = 200; // well clear of the Commons
// Ada: P1 10×10, P2 10×10 east of it (together a 20×10 rectangle), P3 5×5 under P1 (an L with them)
a.send({ t: 'buy', x: X, y: Y, w: 10, h: 10 });
a.send({ t: 'buy', x: X + 10, y: Y, w: 10, h: 10 });
a.send({ t: 'buy', x: X, y: Y + 10, w: 5, h: 5 });
a.toast();
ok(mine().length === 3, 'Ada owns three parcels');
const [p1, p2, p3] = mine().sort((q, r) => q.id - r.id);
// Bob's land beside Ada's
b.send({ t: 'buy', x: X + 20, y: Y, w: 5, h: 5 });
const bob = [...world.parcels.values()].find((p) => p.owner === b.id)!;
ok(!!bob, 'Bob owns a parcel next to hers');

// ---- combine: refusals
a.send({ t: 'parcelOp', op: 'combine', ids: [p1.id] });
ok(/two or more/.test(a.toast()?.msg ?? ''), 'one parcel alone is refused');
a.send({ t: 'parcelOp', op: 'combine', ids: [p2.id, bob.id] });
ok(/one owner/.test(a.toast()?.msg ?? ''), "another owner's parcel is refused");
b.send({ t: 'parcelOp', op: 'combine', ids: [p1.id, p2.id] });
ok(/Not your land/.test(b.toast()?.msg ?? '') && world.parcels.has(p2.id), "Bob cannot combine Ada's parcels");
a.send({ t: 'parcelOp', op: 'combine', ids: [p2.id, p3.id] });
ok(/do not touch/.test(a.toast()?.msg ?? ''), 'parcels that only meet at a corner (or not at all) are refused');

// ---- combine: a rectangle merges
a.send({ t: 'parcelOp', op: 'combine', ids: [p1.id, p2.id] });
ok(/one parcel/.test(a.toast()?.msg ?? ''), 'two halves of a rectangle combine into one parcel');
ok(!world.parcels.has(p2.id) && p1.w === 20 && p1.h === 10, `the lower id keeps it, now ${p1.w}×${p1.h}`);
ok(parcelOf(X + 15, Y + 5)?.id === p1.id, "the removed parcel's tiles take the kept id");
// ---- combine: an L becomes an estate
p1.taxRate = 0.2; p1.name = 'Ada Park';
a.send({ t: 'parcelOp', op: 'combine', ids: [p3.id, p1.id] });
ok(/estate of 2/.test(a.toast()?.msg ?? ''), 'an L-shaped pair becomes an estate');
ok(p1.group !== undefined && p1.group === p3.group && p3.name === 'Ada Park' && p3.taxRate === 0.2, 'members share the lead parcel\'s name and tax rate');
a.send({ t: 'parcelOp', op: 'combine', ids: [p1.id, p3.id] });
ok(/already one estate/.test(a.toast()?.msg ?? ''), 'combining an estate with itself is refused');
// estate settings apply to every member
a.send({ t: 'parcel', id: p3.id, name: 'Ada Estate', color: 0x3caea3, taxRate: 0.15 });
ok(p1.name === 'Ada Estate' && p1.color === 0x3caea3 && p1.taxRate === 0.15, 'renaming, colouring and taxing one member sets the whole estate');
a.send({ t: 'parcel', id: p1.id, color: -1 });
ok(p1.color === undefined && p3.color === undefined, 'colour -1 gives the estate back its owner\'s colour');
// ---- combine: past MAX_PARCEL_EDGE it is an estate, not a merge
a.send({ t: 'buy', x: X + 5, y: Y + 10, w: 15, h: 5 }); // fills the L's notch: now a 20×15 rectangle in two parcels... with p3
a.send({ t: 'buy', x: X - 40, y: Y, w: 40, h: 10 }); // west of p1: together 60 wide
a.toast();
const notch = parcelOf(X + 6, Y + 11)!, west = parcelOf(X - 1, Y + 1)!;
a.send({ t: 'parcelOp', op: 'combine', ids: [west.id, p1.id] });
a.toast();
ok(west.group !== undefined && west.group === p1.group && world.parcels.has(west.id) && p1.w === 20, `a 60-tile union (over ${MAX_PARCEL_EDGE}) joins the estate instead of merging`);
a.send({ t: 'parcelOp', op: 'combine', ids: [notch.id, p3.id] });
a.toast();
// the notch and the 5×5 make a 20×5 strip, and that strip and the 20×10 make a 20×15: both merge
ok(!world.parcels.has(notch.id) && !world.parcels.has(p3.id) && p1.w === 20 && p1.h === 15 && parcelOf(X + 6, Y + 11)?.id === p1.id,
  `rectangles keep merging while any pair makes one: now ${p1.w}×${p1.h}`);
ok(world.estateOf(p1.group).length === 2, 'the estate is that rectangle and the western strip');
// ---- split
a.send({ t: 'parcelOp', op: 'split', id: p1.id, axis: 'x', at: X });
ok(/across the parcel/.test(a.toast()?.msg ?? ''), 'a cut on the parcel edge is refused');
b.send({ t: 'parcelOp', op: 'split', id: p1.id, axis: 'x', at: X + 10 });
ok(/Not your parcel/.test(b.toast()?.msg ?? ''), "Bob cannot split Ada's parcel");
a.send({ t: 'parcelOp', op: 'split', id: p1.id, axis: 'x', at: X + 8 });
ok(/Split off/.test(a.toast()?.msg ?? ''), 'a cut across the middle splits it');
const east = parcelOf(X + 15, Y + 5)!;
ok(east.id !== p1.id && p1.w === 8 && east.x === X + 8 && east.w === 12 && east.h === 15 && east.group === undefined && /\(east\)$/.test(east.name),
  `the east part is a new parcel (${east.name}, ${east.w}×${east.h}) outside the estate; the west keeps the id (${p1.w}×${p1.h})`);
// water: a parcel whose south row is all water cannot lose its dry part
for (let x = X + 8; x < X + 20; x++) for (let y = Y + 5; y < Y + 15; y++) world.setTile(x, y, packTile(Terrain.Water, false, 0, 0));
a.send({ t: 'parcelOp', op: 'split', id: east.id, axis: 'y', at: Y + 5 });
ok(/dry land/.test(a.toast()?.msg ?? ''), 'a part that would be all water is refused');
// a building across the cut (placed directly: the planner's road rules are not what is tested)
const kind = KIND_ID['police-hq'];
const placed = placedFromDoor(kind, X + 3, Y + 3, 0);
ok(placed.ax >= X && placed.ax + placed.w <= X + 8 && placed.w >= 2, `a ${placed.w}×${placed.h} test building stands inside the west part`);
world.placeStructure(placed, { work: 1, priority: 0, built: true });
a.send({ t: 'parcelOp', op: 'split', id: p1.id, axis: 'x', at: placed.ax + 1 });
ok(/runs through/.test(a.toast()?.msg ?? ''), 'a cut through the building is refused');
// ---- leave the estate
a.send({ t: 'parcelOp', op: 'ungroup', id: west.id });
a.toast();
ok(west.group === undefined && p1.group === undefined, 'a member leaving an estate of two dissolves it');
a.send({ t: 'parcelOp', op: 'ungroup', id: p1.id });
ok(/not in an estate/.test(a.toast()?.msg ?? ''), 'a lone parcel cannot leave an estate');
// every tile's parcel id agrees with the rectangles
let bad = 0;
for (const p of world.parcels.values()) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (world.parcelIdAt(x, y) !== p.id) bad++;
ok(bad === 0, 'every parcel\'s tiles carry its id');

// ---- the wire and the save
for (let i = 0; i < 10; i++) game.step();
const parcelsMsg = a.got.filter((m) => m.t === 'parcels') as Extract<ServerMsg, { t: 'parcels' }>[];
ok(parcelsMsg.some((m) => m.parcels.some((p) => 'group' in p || p.stats.value !== undefined)), 'the parcels message carries estates and book values');
ok(p1.stats.value! >= p1.w * p1.h * 10, `book value counts the land at least ($${p1.stats.value})`);
const back = worldFromSnapshot(JSON.parse(JSON.stringify(snapshotOf(world))))!;
a.send({ t: 'parcelOp', op: 'combine', ids: [p1.id, east.id] });
a.toast();
const snap2 = worldFromSnapshot(JSON.parse(JSON.stringify(snapshotOf(world))))!;
ok(back.parcels.size >= world.parcels.size && JSON.stringify([...snap2.parcels.values()].map((p) => [p.id, p.x, p.y, p.w, p.h, p.group ?? 0, p.color ?? 0])) ===
  JSON.stringify([...world.parcels.values()].map((p) => [p.id, p.x, p.y, p.w, p.h, p.group ?? 0, p.color ?? 0])), 'parcels with estates and colours survive a save');

// ---- the world map: sector answers
{
  a.got.length = 0;
  const sx = Math.floor(Math.floor(X / CHUNK_SIZE) / SECTOR_CHUNKS), sy = Math.floor(Math.floor(Y / CHUNK_SIZE) / SECTOR_CHUNKS);
  a.send({ t: 'map', s: [sx, sy, 0, 50, 50, 0] });
  const secs = a.got.filter((m) => m.t === 'mapSector') as Extract<ServerMsg, { t: 'mapSector' }>[];
  const here = secs.find((m) => m.sx === sx && m.sy === sy), far = secs.find((m) => m.sx === 50);
  ok(here && here.c.length > 0 && far && far.c.length === 0, `a sector answers with its modified chunks (${here?.c.length}), an untouched one with none`);
  const bytes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const chunk = here!.c.find(([cx, cy]) => cx === Math.floor((X + 8) / CHUNK_SIZE) && cy === Math.floor((Y + 6) / CHUNK_SIZE));
  ok(chunk && rleDecode(chunk[2], bytes), 'the chunk decodes to 1024 map bytes');
  const lx = (X + 9) % CHUNK_SIZE, ly = (Y + 6) % CHUNK_SIZE;
  ok(mapClassOf(bytes[ly * CHUNK_SIZE + lx]) === MapClass.Water, 'the painted water reads as water on the map');
  a.got.length = 0;
  a.send({ t: 'map', s: [sx, sy, here!.v, 50, 50, far!.v] });
  ok(!a.got.some((m) => m.t === 'mapSector'), 'sectors the client already has are not sent again');
  world.setTile(X + 1, Y + 1, packTile(Terrain.Grass, true, 0, 0));
  game.step();
  a.got.length = 0;
  a.send({ t: 'map', s: [sx, sy, here!.v] });
  ok(a.got.some((m) => m.t === 'mapSector' && m.v !== here!.v), 'a tile change bumps its sector, which is sent again');
}

// ---- cost on a big city: encode every sector of an 8×8-district test city
{
  const big = new World(99);
  seedCity(big, { districts: 8, built: 3 });
  let conn: ((c: Conn) => void) | null = null;
  const g = createGame(big, { onConnection: (fn) => { conn = fn; } }, { devTools: false, sandbox: true });
  const got: string[] = [];
  let on: ((d: string) => void) | null = null;
  conn!({ open: true, send: (d) => got.push(d), close() {}, onMessage: (fn) => { on = fn; }, onClose() {} });
  on!(JSON.stringify({ t: 'hello', name: 'Bench' }));
  const chunks = [...big.chunks.values()].filter((c) => c.modified);
  const sx0 = Math.min(...chunks.map((c) => Math.floor(c.cx / SECTOR_CHUNKS))), sx1 = Math.max(...chunks.map((c) => Math.floor(c.cx / SECTOR_CHUNKS)));
  const sy0 = Math.min(...chunks.map((c) => Math.floor(c.cy / SECTOR_CHUNKS))), sy1 = Math.max(...chunks.map((c) => Math.floor(c.cy / SECTOR_CHUNKS)));
  const req: number[] = [];
  for (let sy = sy0 - 2; sy <= sy1 + 2; sy++) for (let sx = sx0 - 2; sx <= sx1 + 2; sx++) req.push(sx, sy, 0);
  got.length = 0;
  let t0 = performance.now();
  on!(JSON.stringify({ t: 'map', s: req }));
  const first = performance.now() - t0;
  const bytes = got.filter((d) => d.startsWith('{"t":"mapSector"')).reduce((n, d) => n + d.length, 0);
  got.length = 0;
  t0 = performance.now();
  on!(JSON.stringify({ t: 'map', s: req }));
  const again = performance.now() - t0;
  console.log(`     8×8-district city: ${chunks.length} modified chunks in ${req.length / 3} sectors; first answer ${first.toFixed(1)} ms, ${(bytes / 1024).toFixed(0)} KB (${(bytes / chunks.length).toFixed(0)} B a chunk); cached ${again.toFixed(2)} ms`);
  ok(bytes / chunks.length < 1400, 'a built-up chunk costs about 1 KB on the wire, once (untouched chunks cost nothing)');
  void g;
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
