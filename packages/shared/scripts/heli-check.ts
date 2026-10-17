/**
 * Helicopter check (docs/helicopters.md). Builds a town with every building that carries a helipad in a server World,
 * mirrors its chunks into a ClientWorld as the wire would, and checks:
 *  - the pads derived from the server's tiles and from the client's chunks are identical, and so are their timetables;
 *  - each pad sits on the roof (or lawn) that client/src/render/chunkView.ts draws: the design's helipad op, put
 *    through the model's placement matrix, lands where shared/src/helipads.ts says;
 *  - over several days, no pad ever holds two helicopters (sampled every half tick, plus the reserved intervals),
 *    every flight starts and ends inside its day, and every service flies;
 *  - the same for a dense synthetic city of pads, where onward pad-to-pad flights compete for pads.
 *   npx tsx packages/shared/scripts/heli-check.ts [days]
 */
import { Vector3 } from 'three';
import {
  TICKS_PER_DAY, Zone, KIND_ID, packTile, placedFromDoor, u16ToB64, i32ToB64, u8ToB64,
  heliTimetable, helicoptersAt, HOVER, CATALOGUE_KIND_NAMES, type Pad, type PadKind,
} from '../src';
import { chunkPads } from '../src/helipads';
import { RECIPES } from '../src/buildings/recipes';
import { World } from '../../server/src/world';
import { ClientWorld } from '../../client/src/world';
import { clientEnv } from '../../client/src/airports';
import { ChunkView } from '../../client/src/render/chunkView';
import { buildModels } from '../../client/src/render/models';
import type { Placement } from '../../client/src/render/buildings';

const days = Number(process.argv[2] ?? 4);
let failures = 0, passes = 0;
const fail = (msg: string) => { if (failures++ < 25) console.log('FAIL ' + msg); };
const ok = (cond: boolean, msg: string) => { if (cond) passes++; else fail(msg); };

// ---- a town: every padded building beside a road ---------------------------------------------------------------
const w = new World(4242);
for (let y = -4; y < 70; y++) for (let x = -4; x < 100; x++) w.setTile(x, y, packTile(0, false, 0, 0));
// an east-west road every 12 rows; buildings stand on the row above it, doors on the road
for (let r = 0; r < 5; r++) for (let x = -4; x < 100; x++) w.setTile(x, 10 + r * 12, packTile(0, true, 0, 0));
const k = (id: string) => KIND_ID[id as keyof typeof KIND_ID];
const structures: [string, number, number][] = [
  ['general-hospital', 4, 9], ['teaching-hospital', 12, 9], ['community-hospital', 20, 9], ['police-hq', 28, 9], ['buckingham-palace', 40, 9],
  ['general-hospital', 50, 21], ['teaching-hospital', 60, 21],
];
for (const [id, x, y] of structures) {
  const p = placedFromDoor(k(id), x, y, 0);
  w.placeStructure(p, { work: 100, priority: 0, built: true });
}
// 1×1 hospitals and level-3 offices along another street (their design is the tile's hash: some have a pad, some not)
for (let x = 0; x < 90; x += 2) {
  w.setTile(x, 33, packTile(0, false, x % 4 ? Zone.Hospital : Zone.Office, x % 4 ? 1 : 3));
}
// merged office towers (2×2, levels 4-5) and corporate headquarters (3×3, levels 6-7)
for (const [id, level, x, y] of [['off-tower', 4, 2, 44], ['off-tower', 5, 8, 44], ['off-tower', 5, 14, 44], ['off-hq', 6, 22, 43], ['off-hq', 7, 30, 43], ['off-hq', 7, 40, 43]] as [string, number, number, number][]) {
  const p = placedFromDoor(k(id), x, y + (id === 'off-hq' ? 2 : 1), 0);
  w.placeStructure(p, { work: 100, priority: 0, built: true, target: level });
}
for (let x = -4; x < 100; x++) w.setTile(x, 46, packTile(0, true, 0, 0));

const serverEnv = { tile: (x: number, y: number) => w.peekTile(x, y), aux: (x: number, y: number) => w.auxAt(x, y), sub: (x: number, y: number) => w.subAt(x, y) };
const serverPads = [...w.chunks.values()].flatMap((c) => chunkPads(c.cx, c.cy, serverEnv)).sort((a, b) => a.id - b.id);
const cw = new ClientWorld();
for (const c of w.chunks.values()) cw.putChunk({ cx: c.cx, cy: c.cy, tiles: u16ToB64(c.tiles), parcels: i32ToB64(c.parcel), aux: c.aux.some((v) => v) ? u8ToB64(c.aux) : undefined, sub: c.sub.some((v) => v) ? u8ToB64(c.sub) : undefined });
const clientPads = [...cw.chunks.values()].flatMap((c) => chunkPads(c.cx, c.cy, clientEnv(cw))).sort((a, b) => a.id - b.id);

console.log('=== pads derived from tiles: server path vs client path');
const byKind = (ps: Pad[]) => ps.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] ?? 0) + 1 }), {} as Record<string, number>);
console.log(`  ${serverPads.length} pads: ${JSON.stringify(byKind(serverPads))}`);
for (const p of serverPads) console.log(`  ${String(p.id).padStart(6)} ${p.kind.padEnd(9)} ${CATALOGUE_KIND_NAMES[p.building].padEnd(24)} at (${p.x.toFixed(2)}, ${p.y.toFixed(3)}, ${p.z.toFixed(2)}) r ${p.r.toFixed(2)}`);
ok(JSON.stringify(serverPads) === JSON.stringify(clientPads), 'server and client pads differ');
for (const kind of ['medical', 'police', 'corporate', 'royal'] as PadKind[]) ok(serverPads.some((p) => p.kind === kind), `no ${kind} pad in the test town`);
ok(new Set(serverPads.map((p) => p.id)).size === serverPads.length, 'pad ids collide');
for (let d = 0; d < days; d++) ok(JSON.stringify(heliTimetable(serverPads, d).map((f) => [f.id, f.tStart, f.tEnd, f.stops.map((s) => [s.pad.id, s.tDown, s.tUp])]))
  === JSON.stringify(heliTimetable(clientPads, d).map((f) => [f.id, f.tStart, f.tEnd, f.stops.map((s) => [s.pad.id, s.tDown, s.tUp])])), `day ${d}: timetables differ`);

// ---- pads sit where chunkView draws the helipad ---------------------------------------------------------------
console.log('\n=== pads against the drawn models (render/chunkView.ts placements)');
buildModels();
const recipe = new Map(RECIPES.map((r) => [r.key, r]));
let matched = 0;
for (const c of cw.chunks.values()) {
  const key = `${c.cx},${c.cy}`;
  let items: Placement[] = [];
  const view = new ChunkView(c.cx, c.cy, undefined as never);
  view.rebuild(c, key, (x, y) => cw.getTile(x, y), { setChunk: (_k: string, list: Placement[]) => { items = list; } } as never, (x, y) => cw.auxAt(x, y));
  for (const it of items) {
    const r = recipe.get(it.key);
    if (!r) continue;
    const ops = r.ops as readonly (readonly unknown[])[];
    const i = ops.findIndex((a, j) => a[0] === 'cyl' && a[7] === 0x4a4f58 && ops[j + 1]?.[0] === 'cyl' && ops[j + 1][4] === a[4] && ops[j + 1][6] === a[6]);
    if (i < 0) continue;
    const a = ops[i] as number[] & unknown[];
    const v = new Vector3(a[4] as number, (a[5] as number) + 0.024, a[6] as number).applyMatrix4(it.matrix);
    const near = serverPads.find((p) => Math.hypot(p.x - v.x, p.z - v.z) < 1e-3);
    if (!near) { fail(`drawn helipad of ${it.key} at (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}) has no derived pad`); continue; }
    ok(Math.abs(near.y - v.y) < 1e-3, `pad ${near.id} height ${near.y} vs drawn ${v.y}`);
    matched++;
  }
}
ok(matched === serverPads.length, `${matched} drawn helipads matched, ${serverPads.length} derived`);
console.log(`  ${matched} drawn helipads, every one matched by a derived pad at the same point`);

// ---- the schedule's rules -------------------------------------------------------------------------------------
function checkSchedule(name: string, pads: Pad[]) {
  console.log(`\n=== ${name}: ${pads.length} pads`);
  const flown: Record<string, number> = {};
  let onward = 0, maxAir = 0;
  for (let d = 0; d < days; d++) {
    const tt = heliTimetable(pads, d), d0 = d * TICKS_PER_DAY;
    // reservations per pad are disjoint
    const per = new Map<number, [number, number][]>();
    for (const f of tt) {
      flown[f.kind] = (flown[f.kind] ?? 0) + 1;
      if (f.stops.length > 1) onward++;
      ok(f.tStart >= d0 && f.tEnd < d0 + TICKS_PER_DAY, `flight ${f.id} leaves its day (${f.tStart}-${f.tEnd})`);
      for (const s of f.stops) { const l = per.get(s.pad.id) ?? []; l.push([s.tDown, s.tUp]); per.set(s.pad.id, l); }
    }
    for (const [id, l] of per) {
      l.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < l.length; i++) ok(l[i][0] > l[i - 1][1], `pad ${id} day ${d}: visits overlap (${l[i - 1]} and ${l[i]})`);
    }
    // sampled: at most one helicopter on or just over each pad
    for (let t = d0; t < d0 + TICKS_PER_DAY; t += 0.5) {
      const st = helicoptersAt(pads, t);
      maxAir = Math.max(maxAir, st.length);
      for (const p of pads) {
        const at = st.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < p.r + 0.35 && s.y < p.y + HOVER + 0.4 && s.y > p.y - 0.05);
        if (at.length > 1) fail(`pad ${p.id} t=${t}: ${at.length} helicopters (${at.map((s) => `${s.id} ${s.phase}`).join(', ')})`);
        else passes++;
      }
      for (const s of st) if (!Number.isFinite(s.x + s.y + s.z + s.heading + s.pitch)) fail(`flight ${s.id} t=${t}: bad pose`);
    }
  }
  console.log(`  ${days} days: flights by service ${JSON.stringify(flown)}, ${onward} going on to a second pad, up to ${maxAir} in the air or on pads at once`);
  return flown;
}
const flown = checkSchedule('the test town', serverPads);
for (const kind of ['medical', 'police', 'corporate'] as PadKind[]) ok((flown[kind] ?? 0) > 0, `no ${kind} flights`);

// a dense synthetic city: 24 pads within a few tiles of each other, all hospitals or towers, so onward flights collide
const dense: Pad[] = Array.from({ length: 24 }, (_, i) => ({
  id: 1000 + i * 7, x: (i % 6) * 9 + 0.5, y: 1 + (i % 4), z: Math.floor(i / 6) * 11 + 0.5, r: 0.3, kind: (i % 3 ? 'medical' : 'corporate') as PadKind,
  heading: 0, building: k('general-hospital'), bx: 0, by: 0,
}));
const fd = checkSchedule('a dense synthetic city', dense);
ok((fd.medical ?? 0) > days * 10, 'dense city: too few medical flights');

console.log(failures ? `\n${failures} FAILURES (${passes} passed)` : `\nALL CHECKS PASSED (${passes})`);
process.exit(failures ? 1 : 0);
