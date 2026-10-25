import { Box3, Frustum, Matrix4, type Camera } from 'three';
import { CHUNK_SIZE, chunkKey } from '@msimcity/shared';
import { DIRTY_SHAPE, DIRTY_BUILD, type ClientChunk, type ClientWorld } from '../world';

/**
 * Chunk rebuilds, scheduled (docs/perf.md, "Chunk rebuilds: the cause and the fix"). A chunk marked dirty (world.ts
 * DirtyStats: what changed, as DIRTY_* bits) waits in a queue; each frame the scheduler carries on one chunk's
 * rebuild, or starts the most urgent one (on screen first, then nearest the camera's focus), and runs its passes one
 * after another until the frame's time box is spent: about 6 ms, 3 when the frame before was already long. A pass is
 * never split, and at least one runs a frame. Only the passes that read what changed run: a building rising in a lot
 * redraws the ground and the buildings, not the junctions, bridges, signals and rails. A chunk marked again while it
 * waits is rebuilt once; one marked again while its rebuild is under way goes back in the queue and is rebuilt after.
 * The chunk under the camera (its centre within 0.9 of a chunk of the focus) finishes within two frames whatever its passes cost; others
 * on screen go a time box at a time; one off screen waits while anything on screen is pending, keeps its mark, and is
 * rebuilt first when it comes into view (the queue holds at most the loaded chunks, once each).
 *
 * `legacy` is the old loop, for paired measurements: up to four whole rebuilds a frame, every pass, in queue order.
 */
export const REBUILD_PASSES = ['view', 'roads', 'lights', 'parks', 'airfield', 'helis', 'boats', 'trains', 'junctions', 'bridges', 'landmarks', 'underground', 'power'] as const;
export type RebuildPass = (typeof REBUILD_PASSES)[number];

/** one renderer's part of a chunk rebuild, and the DIRTY_* bits it reads */
export interface Pass { name: RebuildPass; reads: number; run: (key: string, c: ClientChunk) => void }

export interface RebuildRecord { at: number; key: string; ms: number; /** from the first mark to the rebuild done (ms): how long the drawing was stale */ lag: number; passes: number[]; items: number; dist: number; mask: number; frames: number; visible: boolean; under: boolean }

const RING = 1024;

export class RebuildStats {
  readonly ring: RebuildRecord[] = [];
  count = 0;
  /** ms spent in rebuilds since the page opened */
  totalMs = 0;
  push(r: RebuildRecord) {
    this.ring.push(r); this.count++; this.totalMs += r.ms;
    if (this.ring.length > RING) this.ring.shift();
  }
  /** rebuilds in the last `seconds`: how many a second, their cost, the cost split by pass, and how many were the road shape's */
  summary(seconds = 30) {
    const from = performance.now() - seconds * 1000, rs = this.ring.filter((r) => r.at >= from);
    const sum = REBUILD_PASSES.map((_, i) => rs.reduce((s, r) => s + r.passes[i], 0));
    const tot = rs.reduce((s, r) => s + r.ms, 0) || 1;
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      rebuilds: rs.length, perSecond: r1(rs.length / seconds), totalMs: r1(tot), meanMs: r1(tot / (rs.length || 1)),
      p50: r1(ms[ms.length >> 1] ?? 0), max: r1(ms[ms.length - 1] ?? 0),
      shape: rs.filter((r) => r.mask & DIRTY_SHAPE).length, buildOnly: rs.filter((r) => !(r.mask & DIRTY_SHAPE) && r.mask & DIRTY_BUILD).length,
      lag: lagOf(rs), lagVisible: lagOf(rs.filter((r) => r.visible)), lagUnder: lagOf(rs.filter((r) => r.under)),
      framesMax: rs.reduce((m, r) => Math.max(m, r.frames), 0), underFramesMax: rs.filter((r) => r.under).reduce((m, r) => Math.max(m, r.frames), 0),
      passes: Object.fromEntries(REBUILD_PASSES.map((p, i) => [p, { ms: r1(sum[i] / (rs.length || 1)), share: Math.round((100 * sum[i]) / tot) }])),
      chunks: new Set(rs.map((r) => r.key)).size,
    };
  }
}

/** the staleness of a set of rebuilds: median, p95 and worst ms from the first mark to the rebuild done */
function lagOf(rs: RebuildRecord[]) {
  const l = rs.map((r) => r.lag).sort((a, b) => a - b), q = (p: number) => Math.round(l[Math.min(l.length - 1, Math.floor(p * l.length))] ?? 0);
  return { p50: q(0.5), p95: q(0.95), max: Math.round(l[l.length - 1] ?? 0) };
}

interface Job { markedAt: number; key: string; c: ClientChunk; mask: number; i: number; at: number; frames: number; ms: number; passes: number[]; dist: number; visible: boolean; under: boolean }
/** a chunk whose centre is within this of the camera's focus is "under the camera": finished within two frames */
const UNDER = CHUNK_SIZE * 0.9;

export class ChunkWork {
  readonly stats = new RebuildStats();
  /** the old loop (see above), for paired measurements: msc.chunkWork.setLegacy(true) */
  legacy = false;
  /** the time box of a frame (ms), and the box when the frame before took longer than LONG_MS */
  budgetMs = 6;
  longBudgetMs = 3;
  private job: Job | null = null;
  private frustum = new Frustum();
  private m = new Matrix4();
  private box = new Box3();
  private order: number[];

  constructor(private world: ClientWorld, private passes: Pass[], private hasView: (key: string) => boolean, private items: (key: string) => number) {
    this.order = passes.map((p) => REBUILD_PASSES.indexOf(p.name));
  }

  /** Is a rebuild pending or under way? (screenshots and checks wait for it) */
  busy(): boolean { return !!this.job || this.world.dirtyStats.queue.size > 0; }
  /** chunks waiting, and the one under way */
  get pending(): number { return this.world.dirtyStats.queue.size + (this.job ? 1 : 0); }
  /** the chunk being rebuilt, if any */
  get current(): string | null { return this.job?.key ?? null; }

  /** A chunk left the view: a rebuild under way for it stops. */
  dropChunk(key: string) { if (this.job?.key === key) this.job = null; }

  /** Once a frame: carry the rebuild on within the time box (`lastMs`: the frame before's interval). */
  frame(camera: Camera, focus: { x: number; z: number }, lastMs: number) {
    const q = this.world.dirtyStats.queue;
    if (this.legacy) { this.legacyFrame(focus); return; }
    const t0 = performance.now();
    const budget = lastMs > LONG_MS ? this.longBudgetMs : this.budgetMs;
    if (this.job && (this.world.chunks.get(this.job.key) !== this.job.c || !this.hasView(this.job.key))) this.job = null; // dropped, or replaced by a fresh copy (queued itself)
    if (!this.job && q.size) this.job = this.pick(camera, focus);
    const j = this.job;
    if (!j) return;
    j.frames++;
    const finish = j.frames >= 2 && j.under; // under the camera: done within two frames
    while (j.i < this.passes.length) {
      const p = this.passes[j.i], k = j.i++;
      if (!(p.reads & j.mask)) continue;
      const s = performance.now();
      p.run(j.key, j.c);
      const d = performance.now() - s;
      j.passes[this.order[k]] += d; j.ms += d;
      if (!finish && j.i < this.passes.length && performance.now() - t0 >= budget) return;
    }
    this.stats.push({ at: j.at, lag: performance.now() - j.markedAt, key: j.key, ms: j.ms, passes: j.passes, items: this.items(j.key), dist: j.dist, mask: j.mask, frames: j.frames, visible: j.visible, under: j.under });
    this.job = null;
  }

  /** the most urgent chunk waiting (on screen first, then nearest the focus), taken off the queue with its mark */
  private pick(camera: Camera, focus: { x: number; z: number }): Job | null {
    const q = this.world.dirtyStats.queue;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let best: ClientChunk | null = null, bestScore = Infinity, bestDist = 0, bestVis = false;
    for (const c of q) {
      const key = chunkKey(c.cx, c.cy);
      if (!this.hasView(key) || this.world.chunks.get(key) !== c) { q.delete(c); continue; } // not drawn (yet), or stale
      const x0 = c.cx * CHUNK_SIZE, z0 = c.cy * CHUNK_SIZE;
      this.box.min.set(x0, 0, z0); this.box.max.set(x0 + CHUNK_SIZE, 8, z0 + CHUNK_SIZE);
      const vis = this.frustum.intersectsBox(this.box);
      const dist = Math.hypot(x0 + CHUNK_SIZE / 2 - focus.x, z0 + CHUNK_SIZE / 2 - focus.z);
      const score = (vis ? 0 : 1e7) + dist;
      if (score < bestScore) { bestScore = score; best = c; bestDist = dist; bestVis = vis; }
    }
    if (!best) return null;
    q.delete(best);
    const mask = best.mask;
    best.mask = 0; best.dirty = false;
    return { markedAt: best.markedAt ?? performance.now(), key: chunkKey(best.cx, best.cy), c: best, mask, i: 0, at: performance.now(), frames: 0, ms: 0, passes: REBUILD_PASSES.map(() => 0), dist: bestDist, visible: bestVis, under: bestVis && bestDist < UNDER };
  }

  private legacyFrame(focus: { x: number; z: number }) {
    const q = this.world.dirtyStats.queue;
    let budget = 4;
    for (const c of [...q]) {
      if (budget-- <= 0) break;
      q.delete(c);
      const key = chunkKey(c.cx, c.cy);
      if (!this.hasView(key) || this.world.chunks.get(key) !== c) continue;
      const mask = c.mask, markedAt = c.markedAt ?? performance.now();
      c.mask = 0; c.dirty = false;
      const at = performance.now(), passes = REBUILD_PASSES.map(() => 0);
      let ms = 0;
      for (let k = 0; k < this.passes.length; k++) {
        const s = performance.now();
        this.passes[k].run(key, c);
        const d = performance.now() - s;
        passes[this.order[k]] += d; ms += d;
      }
      this.stats.push({ at, lag: performance.now() - markedAt, key, ms, passes, items: this.items(key), dist: Math.hypot((c.cx + 0.5) * CHUNK_SIZE - focus.x, (c.cy + 0.5) * CHUNK_SIZE - focus.z), mask, frames: 1, visible: true, under: false });
    }
  }
}

/** a frame longer than this leaves the next one the smaller time box */
const LONG_MS = 25;
