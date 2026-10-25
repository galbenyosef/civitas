// Chunk rebuilds (docs/perf.md, "Chunk rebuilds: the cause and the fix"), offline: what marks a chunk dirty and with
// which bits (client world.ts), how the scheduler spends a frame (render/chunkWork.ts: one chunk at a time, the most
// urgent first, a time box, only the passes that read what changed, a chunk on screen done within two frames, a chunk
// marked again mid-rebuild rebuilt again after), and that the per-chunk junction signs draw exactly what the old
// all-London rebuild drew, reusing each record's signs until what they read changes.
// Run: npx tsx packages/client/scripts/chunk-check.ts
import { CHUNK_SIZE, Terrain, Zone, packTile, withConstruction, withProgress, u16ToB64, i32ToB64, u8ToB64, chunkKey, StreetRule, Turn } from '@msimcity/shared';
import { PerspectiveCamera, type BufferGeometry, type Mesh } from 'three';
import { ClientWorld, DIRTY_SHAPE, DIRTY_BUILD, DIRTY_UNDER, type ClientChunk } from '../src/world';
import { ChunkWork, type Pass, REBUILD_PASSES } from '../src/render/chunkWork';
import { JunctionSigns } from '../src/render/junctionSigns';

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const N = CHUNK_SIZE * CHUNK_SIZE;
const ROAD = packTile(Terrain.Grass, true, 0, 0), GRASS = packTile(Terrain.Grass, false, 0, 0), LOT = packTile(Terrain.Grass, false, Zone.Residential, 0);
/** a 3×3 town of chunks: a street every eighth row and column, lots between */
function town(): ClientWorld {
  const w = new ClientWorld();
  for (let cy = -1; cy <= 1; cy++) for (let cx = -1; cx <= 1; cx++) {
    const tiles = new Uint16Array(N);
    for (let i = 0; i < N; i++) { const lx = i % CHUNK_SIZE, ly = Math.floor(i / CHUNK_SIZE); tiles[i] = lx % 8 === 0 || ly % 8 === 0 ? ROAD : lx % 8 === 4 ? LOT : GRASS; }
    w.putChunk({ cx, cy, tiles: u16ToB64(tiles), parcels: i32ToB64(new Int32Array(N)), aux: u8ToB64(new Uint8Array(N)) });
  }
  return w;
}
const settle = (w: ClientWorld) => { for (const c of w.chunks.values()) { c.dirty = false; c.mask = 0; } w.dirtyStats.queue.clear(); };
const chunkAt = (w: ClientWorld, cx: number, cy: number) => w.chunks.get(chunkKey(cx, cy))!;

// ---- what marks a chunk, and with which bits --------------------------------------------------------------------
{
  const w = town();
  ok(w.dirtyStats.queue.size === 9 && [...w.chunks.values()].every((c) => c.mask === 7), 'every chunk arrives queued with every bit');
  settle(w);
  w.applyTiles([4, 4, LOT, 0]);
  ok(w.dirtyStats.queue.size === 0, 'a tile entry that changes nothing marks nothing');
  w.applyTiles([4, 4, withProgress(withConstruction(LOT, true), 2), 0]);
  ok(w.dirtyStats.queue.size === 1 && chunkAt(w, 0, 0).mask === DIRTY_BUILD, 'a site rising in a lot marks its chunk for the buildings only');
  settle(w);
  w.applyTiles([31, 4, withConstruction(LOT, true), 0]);
  ok(w.dirtyStats.queue.size === 1 && !chunkAt(w, 1, 0).dirty, 'a building on a chunk edge does not mark the chunk next door');
  settle(w);
  w.applyTiles([31, 10, ROAD, 0]);
  ok(chunkAt(w, 0, 0).mask === (DIRTY_SHAPE | DIRTY_BUILD) && chunkAt(w, 1, 0).mask === (DIRTY_SHAPE | DIRTY_BUILD) && w.dirtyStats.queue.size === 2, 'a road on a chunk edge marks both chunks for the road shape');
  settle(w);
  w.applySub([4, 4, 3]); ok(chunkAt(w, 0, 0).mask === DIRTY_BUILD, 'a sub byte is the buildings');
  settle(w);
  w.applyUnder([4, 4, 1]); ok(chunkAt(w, 0, 0).mask === DIRTY_UNDER, 'an under byte is the underground only');
  settle(w);
  w.applyAux([12, 12, 0]); ok(w.dirtyStats.queue.size === 0, 'an aux byte that changes nothing marks nothing');
  w.applyAux([0, 12, 9]); ok(chunkAt(w, 0, 0).mask === (DIRTY_SHAPE | DIRTY_BUILD) && chunkAt(w, -1, 0).dirty, 'an aux byte is the road shape, and on an edge the chunk next door too');
  settle(w);
  w.legacyDirty = true;
  w.applyTiles([4, 4, chunkAt(w, 0, 0).tiles[4 * CHUNK_SIZE + 4], 0, 31, 4, chunkAt(w, 0, 0).tiles[4 * CHUNK_SIZE + 31], 0]);
  ok(chunkAt(w, 0, 0).dirty && chunkAt(w, 1, 0).dirty, 'the legacy switch marks as before (unchanged entries, edge neighbours)');
}

// ---- the scheduler -------------------------------------------------------------------------------------------------
{
  const w = town();
  const runs: string[] = [];
  const spin = (ms: number) => { const t = performance.now(); while (performance.now() - t < ms) { /* a pass's cost */ } };
  let cost = 4;
  const passes: Pass[] = REBUILD_PASSES.map((name) => ({ name, reads: name === 'junctions' || name === 'bridges' || name === 'lights' || name === 'trains' ? DIRTY_SHAPE : name === 'underground' ? DIRTY_SHAPE | DIRTY_UNDER : DIRTY_SHAPE | DIRTY_BUILD, run: (k: string) => { runs.push(`${k}:${name}`); spin(cost); } }));
  const work = new ChunkWork(w, passes, () => true, () => 0);
  const cam = new PerspectiveCamera(50, 16 / 9, 1, 2000);
  cam.position.set(16, 60, 70); cam.lookAt(16, 0, 16); cam.updateMatrixWorld();
  const focus = { x: 16, z: 16 };
  // the first frames: the chunk at the focus first, one chunk at a time, about 6 ms a frame
  const order: string[] = [];
  let frames = 0, worst = 0, maxChunksInFrame = 0;
  while (work.busy() && frames < 400) {
    const n0 = work.stats.count, t = performance.now(), was = work.current;
    work.frame(cam, focus, 16);
    if (was !== '0,0' && work.current !== '0,0' && !(was === null && work.stats.ring[work.stats.ring.length - 1]?.key === '0,0')) worst = Math.max(worst, performance.now() - t);
    frames++;
    maxChunksInFrame = Math.max(maxChunksInFrame, work.stats.count - n0);
    if (work.stats.count > n0) order.push(work.stats.ring[work.stats.ring.length - 1].key);
  }
  ok(order[0] === '0,0' && order.length === 9, `the chunk at the focus is rebuilt first, then the rest (${order.join(' ')})`);
  ok(maxChunksInFrame <= 1, 'at most one chunk finishes a frame');
  const vis = work.stats.ring.filter((r) => r.visible), under = work.stats.ring.filter((r) => r.under);
  ok(under.length === 1 && under[0].key === '0,0' && under[0].frames <= 2, `the chunk under the camera is done within two frames, whatever its passes cost (${under.map((r) => r.frames).join(',')})`);
  ok(work.stats.ring.filter((r) => !r.under).every((r) => r.frames >= 2) && worst < 6 + cost + 3, `the others are sliced to the time box (worst frame ${worst.toFixed(1)} ms with ${cost} ms passes)`);
  const firstVis = order.findIndex((k) => !vis.some((r) => r.key === k));
  ok(firstVis < 0 || order.slice(firstVis).every((k) => !vis.some((r) => r.key === k)), 'the chunks on screen go before the ones off screen');
  // a building rising: only the passes that read buildings
  runs.length = 0; cost = 0.1;
  w.applyTiles([4, 4, withProgress(withConstruction(LOT, true), 1), 0]);
  for (let i = 0; i < 5 && work.busy(); i++) work.frame(cam, focus, 16);
  ok(!runs.some((r) => /junctions|bridges|lights|trains|underground/.test(r)) && runs.some((r) => r.endsWith(':view')), `a building change skips the road-shape passes (${runs.length} passes ran)`);
  // marked again while its rebuild is under way: rebuilt once more after, not twice at once
  cost = 4; runs.length = 0;
  w.applyTiles([12, 12, ROAD, 0]); // a road: every pass
  const c = chunkAt(w, 0, 0) as ClientChunk;
  work.frame(cam, focus, 16); // the rebuild starts
  w.applyTiles([12, 12, LOT, 0]); // and the tile changes again under it
  ok(c.dirty && w.dirtyStats.queue.has(c), 'a chunk marked during its rebuild goes back in the queue');
  for (let i = 0; i < 20 && work.busy(); i++) work.frame(cam, focus, 16);
  ok(runs.filter((r) => r === '0,0:view').length === 2, 'and is rebuilt once more after');
  // a long frame gets the smaller box
  w.applyTiles([12, 12, ROAD, 0]); runs.length = 0;
  work.frame(cam, { x: 1000, z: 1000 }, 40);
  ok(runs.length <= 2, `after a long frame, about 3 ms of passes (${runs.length} of ${cost} ms ran)`);
}

// ---- junction signs: per chunk, the same drawing, kept until what they read changes ---------------------------------
{
  const w = town();
  // a 20 zone along the street at y = 8 from x = -20 to 20, an HGV ban on part of it, and a turn ban at the crossroads at (8, 8)
  const rules: [number, number, { st?: number; ban?: number }][] = [];
  for (let x = -20; x <= 20; x++) if (x % 8) rules.push([x, 8, { st: StreetRule.Zone20 | (x > 4 ? StreetRule.Hgv : 0) }]);
  rules.push([8, 8, { ban: 1 << (0 * 3 + Turn.Left) }]);
  rules.push([-8, -8, { ban: 1 << (2 * 3 + Turn.Right) }]);
  w.applyRoadRules(rules);
  const signs = new JunctionSigns(w);
  const meshes = () => signs.group.children as Mesh[];
  const sum = () => { let v = 0, s = 0; for (const m of meshes()) { const p = (m.geometry as BufferGeometry).attributes.position; v += p.count; for (let i = 0; i < p.array.length; i++) s += (p.array as Float32Array)[i]; } return { v, s }; };
  signs.rebuildAllUncached();
  const old = sum();
  signs.rebuild();
  const now = sum();
  ok(old.v > 0 && old.v === now.v && Math.abs(old.s - now.s) < 1e-3 * Math.max(1, Math.abs(old.s)), `per chunk, the signs are the old ones exactly (${now.v} vertices in ${meshes().length} meshes, one before)`);
  const built = signs.counts.built;
  signs.chunkChanged(0, 0);
  ok(signs.counts.built === built && signs.counts.reused > 0, 'a chunk rescanned with nothing changed reuses every sign');
  w.applyTiles([9, 9, ROAD, 0]); // a road beside the crossroads: the ban's arms change
  signs.chunkChanged(0, 0);
  const fresh = signs.counts.built - built;
  ok(fresh >= 1 && fresh <= 8, `a road beside a junction rebuilds only the records within three tiles of it (${fresh} of ${rules.length})`);
  w.applyRoadRules([...rules, [16, 8, { st: StreetRule.Zone20 }]]);
  signs.rebuild();
  ok(signs.counts.built - built - fresh >= rules.length, 'a rule changing rebuilds them all');
}

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
