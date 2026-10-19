/**
 * Replay a search corpus (search-corpus.ts, docs/search-perf.md) with the game's own TypeScript searches, check every
 * answer against the one the game got, and time them: on this thread, and spread over worker threads that share the
 * tiles and the fields through SharedArrayBuffers (the no-Rust parallel baseline).
 *
 *   npx tsx packages/server/src/loadtest/search-replay.ts DIR [--workers 1,2,4,8] [--repeat 3] [--json FILE]
 *
 * Ticks run in order. Each tick the main thread applies the tick's base events, lays out its overlay and runs the
 * tick's searches as one batch (split where a tile write falls inside the tick, so every search sees the tiles it saw
 * in the game); then folds the overlay into the base. With workers, a batch is handed out search by search through an
 * atomic counter and the main thread waits on an atomic for the workers to finish it. Timed: the searches (the batches,
 * hand-out included) and, apart, the bookkeeping between them.
 *
 * Run under the count hook with SEARCH_HOOK_EXPANDED=1 (`--check-expanded` re-launches itself so) to check the nodes each
 * search expands as well; timings come from a run without it.
 */
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { CHUNK_SIZE, chunkKey } from '@msimcity/shared';
import { World, type Chunk } from '../world';
import { findRoute, findPath, pathBetween } from '../pathfinding';
import { readCorpus, Kind, KIND_NAMES, CHUNK_BYTES, SEARCH_BYTES, type Corpus } from './search-corpus';

const CELLS = CHUNK_SIZE * CHUNK_SIZE;
const G = globalThis as unknown as { __pfExpanded?: number; __pfHook?: { orig: Record<string, unknown>; set: Record<string, (f: unknown) => void> } };

/** Field buffers the main thread writes between batches and every thread reads. */
interface FieldBufs { costBase: Float64Array; costIdx: Int32Array; costCnt: Int32Array; costOvSeq: Uint32Array; costOvVal: Float64Array;
  jobBase: Int32Array; jobIdx: Int32Array; jobCnt: Int32Array; jobOvSeq: Uint32Array; jobOvVal: Int32Array }

/** Everything a thread needs to replay searches: the world over the corpus tiles, the chunk grid and the fields. */
class Replayer {
  w = new World(0);
  gx0 = 0; gy0 = 0; gw = 0; gh = 0; grid: Int32Array;
  dv: DataView;
  /** what the last mismatch was, for the log */
  note = '';
  constructor(public c: Corpus, public f: FieldBufs) {
    const n = c.manifest.counts.chunks, cdv = new DataView(c.chunks.buffer);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { const cx = cdv.getInt32(i * CHUNK_BYTES, true), cy = cdv.getInt32(i * CHUNK_BYTES + 4, true); x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); }
    this.gx0 = x0; this.gy0 = y0; this.gw = x1 - x0 + 1; this.gh = y1 - y0 + 1;
    this.grid = new Int32Array(this.gw * this.gh).fill(-1);
    for (let i = 0; i < n; i++) {
      const o = i * CHUNK_BYTES, cx = cdv.getInt32(o, true), cy = cdv.getInt32(o + 4, true);
      this.grid[(cy - y0) * this.gw + (cx - x0)] = i;
      const ch: Chunk = {
        cx, cy, tiles: new Uint16Array(c.chunks.buffer, o + 8, CELLS), aux: new Uint8Array(c.chunks.buffer, o + 8 + CELLS * 2, CELLS),
        parcel: new Int32Array(CELLS), sub: new Uint8Array(CELLS), under: new Uint8Array(CELLS), modified: false,
      };
      this.w.chunks.set(chunkKey(cx, cy), ch);
    }
    this.dv = new DataView(c.searches.buffer);
  }
  /** cell index of tile (x, y) in the cost field (times 8 plus the level for the job field), -1 off the map */
  cell(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), gx = cx - this.gx0, gy = cy - this.gy0;
    if (gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh) return -1;
    const s = this.grid[gy * this.gw + gx];
    return s < 0 ? -1 : s * CELLS + (y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE);
  }
  costAt(x: number, y: number, seq: number): number {
    const c = this.cell(x, y), f = this.f;
    if (c < 0) return NaN;
    const st = f.costIdx[c];
    let v = f.costBase[c];
    if (st) for (let j = st - 1, e = j + f.costCnt[c]; j < e && f.costOvSeq[j] <= seq; j++) v = f.costOvVal[j];
    return v;
  }
  jobAt(x: number, y: number, edu: number, seq: number): number {
    const t = this.cell(x, y), f = this.f;
    if (t < 0) return 0;
    const c = t * 8 + edu, st = f.jobIdx[c];
    let v = f.jobBase[c];
    if (st) for (let j = st - 1, e = j + f.jobCnt[c]; j < e && f.jobOvSeq[j] <= seq; j++) v = f.jobOvVal[j];
    return v;
  }
  /** Replay search i: 0 when it gives the game's answer, else a mismatch code (bit 0 answer, 1 path, 2 cost, 3 expanded, 4 job extras). */
  run(i: number): number {
    const dv = this.dv, o = i * SEARCH_BYTES, c = this.c;
    const seq = dv.getUint32(o, true), sx = dv.getInt32(o + 8, true), sy = dv.getInt32(o + 12, true), gx = dv.getInt32(o + 16, true), gy = dv.getInt32(o + 20, true);
    const maxNodes = dv.getUint32(o + 40, true), kind = dv.getUint8(o + 96), flags = dv.getUint8(o + 99), found = (flags & 1) === 1;
    const e0 = G.__pfExpanded ?? 0;
    let path: number[] | null = null, bad = 0;
    if (kind === Kind.Route) {
      const nov = (flags >> 1) & 3, ox1 = dv.getInt32(o + 80, true), oy1 = dv.getInt32(o + 84, true), ox2 = dv.getInt32(o + 88, true), oy2 = dv.getInt32(o + 92, true);
      const avoid = c.manifest.consts.avoid;
      const cost = nov === 0 ? (x: number, y: number) => this.costAt(x, y, seq)
        : (x: number, y: number) => ((x === ox1 && y === oy1) || (nov > 1 && x === ox2 && y === oy2) ? avoid : this.costAt(x, y, seq));
      const r = findRoute(this.w, sx, sy, gx, gy, cost, dv.getFloat64(o + 24, true), maxNodes, dv.getInt8(o + 97));
      path = r ? r.path : null;
      if (r && r.cost !== dv.getFloat64(o + 32, true)) { bad |= 4; this.note = `search ${i} (tick ${dv.getUint32(o + 4, true)}): cost ${r.cost} against ${dv.getFloat64(o + 32, true)}`; }
    } else if (kind === Kind.Walk) {
      path = pathBetween(this.w, sx, sy, gx, gy);
    } else if (kind === Kind.Job) {
      const edu = dv.getUint8(o + 98);
      let x0 = sx, y0 = sy, x1 = sx, y1 = sy;
      const full: number[] = [];
      const r = findPath(this.w, sx, sy, (x, y) => {
        if (x < x0) x0 = x; else if (x > x1) x1 = x;
        if (y < y0) y0 = y; else if (y > y1) y1 = y;
        const v = this.jobAt(x, y, edu, seq), cls = v & 3;
        if (cls === 2) return true;
        if (cls === 1 && !full.includes(v >> 2)) full.push(v >> 2);
        return false;
      }, maxNodes);
      path = r ? r.path : null;
      if (r) {
        if (r.gx !== gx || r.gy !== gy || this.jobAt(r.gx, r.gy, edu, seq) >> 2 !== dv.getUint32(o + 56, true)) bad |= 16;
      } else {
        const off = dv.getUint32(o + 56, true), n = dv.getUint32(o + 60, true);
        if (x0 - 2 !== dv.getInt32(o + 64, true) || y0 - 2 !== dv.getInt32(o + 68, true) || x1 + 2 !== dv.getInt32(o + 72, true) || y1 + 2 !== dv.getInt32(o + 76, true)) bad |= 16;
        if (full.length !== n) bad |= 16;
        else for (let k = 0; k < n; k++) if (full[k] !== c.full[off + k]) bad |= 16;
      }
    } else {
      const yes = dv.getUint32(o + 56, true);
      let tests = 0;
      const r = findPath(this.w, sx, sy, () => ++tests === yes, maxNodes);
      path = r ? r.path : null;
      if (r && (r.gx !== gx || r.gy !== gy)) bad |= 16;
    }
    if (!!path !== found) return bad | 1;
    if (path) {
      const off = dv.getUint32(o + 48, true), n = dv.getUint32(o + 52, true);
      if (path.length !== n) bad |= 2;
      else for (let k = 0; k < n; k++) if (path[k] !== c.paths[off + k]) { bad |= 2; break; }
    }
    if (G.__pfExpanded !== undefined && G.__pfExpanded - e0 !== dv.getUint32(o + 44, true)) bad |= 8;
    return bad;
  }
}

function sab<T extends Float64Array | Int32Array | Uint32Array>(Ctor: { new (b: SharedArrayBuffer): T; BYTES_PER_ELEMENT: number }, n: number): T {
  return new Ctor(new SharedArrayBuffer(Math.max(1, n) * Ctor.BYTES_PER_ELEMENT));
}

interface WorkerInit { corpus: Corpus; fields: FieldBufs; ctl: Int32Array; results: Int8Array; busy: Float64Array; id: number }

if (!isMainThread) {
  // ---- a worker: replay whatever searches of the current batch it can grab, until told to stop ----
  const d = workerData as WorkerInit;
  const r = new Replayer(d.corpus, d.fields);
  const ctl = d.ctl;
  let seen = 0;
  for (;;) {
    Atomics.wait(ctl, 0, seen);
    seen = Atomics.load(ctl, 0);
    if (ctl[5]) break;
    const end = ctl[2], t = performance.now();
    for (let i = Atomics.add(ctl, 3, 1); i < end; i = Atomics.add(ctl, 3, 1)) {
      d.results[i] = r.run(i) || 0;
      if (d.results[i] && r.note) { const n = r.note; r.note = ''; const again = r.run(i); console.error(`worker ${d.id}: mismatch ${d.results[i]}: ${n}; run again at once: ${again ? r.note : 'matches'}; batch ${ctl[1]}-${end}, gen ${seen}/${Atomics.load(ctl, 0)}`); r.note = ''; }
    }
    d.busy[d.id] += performance.now() - t;
    Atomics.add(ctl, 4, 1);
    Atomics.notify(ctl, 4);
  }
} else if (process.argv.includes('--check-expanded') && G.__pfExpanded === undefined) {
  // re-launch under the count hook so every search counts the nodes it expands
  const here = dirname(fileURLToPath(import.meta.url));
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, hook = pathToFileURL(join(here, 'count-hook.mjs')).href;
  const child = spawn(process.execPath, ['--no-warnings', '--max-old-space-size=8192', '--loader', tsx, '--loader', hook, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, SEARCH_HOOK_EXPANDED: '1' } });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  await main(process.argv.slice(2));
}

async function main(argv: string[]) {
  if (G.__pfHook) for (const [n, f] of Object.entries(G.__pfHook.orig)) G.__pfHook.set[n](f); // the hook's counters off
  const dir = argv.find((a) => !a.startsWith('--') && !/^[\d,]+$/.test(a));
  if (!dir) throw new Error('usage: search-replay.ts DIR [--workers 1,2,4,8] [--repeat 3] [--json FILE]');
  const arg = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const workerCounts = arg('workers', '1,2,4,8').split(',').map(Number).filter((x) => x > 0);
  const repeat = Number(arg('repeat', '3'));
  const corpus = readCorpus(dir, true);
  const m = corpus.manifest, N = m.counts.searches;
  const pristine = corpus.chunks.slice(); // tile writes are replayed into corpus.chunks: put them back before each run
  console.log(`${dir}: ${m.label}, ticks ${m.tick0}-${m.tick1}, ${N} searches, ${m.counts.chunks} chunks; node ${process.version} ${process.arch}${G.__pfExpanded !== undefined ? ', checking nodes expanded' : ''}`);

  // ---- per tick: the ranges of searches and events ----
  const sdv = new DataView(corpus.searches.buffer), rd = (b: Uint8Array) => new DataView(b.buffer);
  const cbd = rd(corpus.costBase), cod = rd(corpus.costOver), jbd = rd(corpus.jobBase), jod = rd(corpus.jobOver), ted = rd(corpus.tiles);
  const nCells = m.counts.chunks * CELLS;
  const fields: FieldBufs = {
    costBase: sab(Float64Array, nCells), costIdx: sab(Int32Array, nCells), costCnt: sab(Int32Array, nCells),
    costOvSeq: sab(Uint32Array, m.counts.costOver), costOvVal: sab(Float64Array, m.counts.costOver),
    jobBase: sab(Int32Array, nCells * 8), jobIdx: sab(Int32Array, nCells * 8), jobCnt: sab(Int32Array, nCells * 8),
    jobOvSeq: sab(Uint32Array, m.counts.jobOver), jobOvVal: sab(Int32Array, m.counts.jobOver),
  };
  const main = new Replayer(corpus, fields);
  const tickOf = (i: number) => sdv.getUint32(i * SEARCH_BYTES + 4, true), seqOf = (i: number) => sdv.getUint32(i * SEARCH_BYTES, true);
  for (let i = 0; i < N; i++) if (seqOf(i) !== i) throw new Error('searches.bin is not in seq order');

  /** One pass over the corpus. `batch(s0, s1)` replays searches [s0, s1) and fills results. */
  const pass = (batch: (s0: number, s1: number) => void) => {
    corpus.chunks.set(pristine);
    fields.costBase.fill(NaN); fields.jobBase.fill(0); fields.costIdx.fill(0); fields.jobIdx.fill(0);
    let cb = 0, co = 0, jb = 0, jo = 0, te = 0, searchMs = 0, bookMs = 0, batches = 0;
    const cbN = m.counts.costBase, coN = m.counts.costOver, jbN = m.counts.jobBase, joN = m.counts.jobOver, teN = m.counts.tileEvents;
    const touchedCost: number[] = [], touchedJob: number[] = [];
    for (let s = 0; s < N;) {
      let t = performance.now();
      const T = tickOf(s);
      let e = s;
      while (e < N && tickOf(e) === T) e++;
      // base events of T
      for (; cb < cbN && cbd.getUint32(cb * 16, true) === T; cb++) { const k = cbd.getUint32(cb * 16 + 4, true); fields.costBase[main.cell(Math.floor(k / 65536) - 0x8000, (k % 65536) - 0x8000)] = cbd.getFloat64(cb * 16 + 8, true); }
      for (; jb < jbN && jbd.getUint32(jb * 16, true) === T; jb++) { const k = jbd.getUint32(jb * 16 + 4, true), cls = jbd.getUint8(jb * 16 + 9); fields.jobBase[main.cell(Math.floor(k / 65536) - 0x8000, (k % 65536) - 0x8000) * 8 + jbd.getUint8(jb * 16 + 8)] = cls ? jbd.getUint32(jb * 16 + 12, true) * 4 + cls : 0; }
      // overlay of T: each cell's events together, in seq order
      const lastSeq = e - 1;
      const co0 = co; while (co < coN && cod.getUint32(co * 16, true) <= lastSeq) co++;
      const jo0 = jo; while (jo < joN && jod.getUint32(jo * 16, true) <= lastSeq) jo++;
      const costCells = Array.from({ length: co - co0 }, (_, j) => co0 + j).map((j) => { const k = cod.getUint32(j * 16 + 4, true); return { j, c: main.cell(Math.floor(k / 65536) - 0x8000, (k % 65536) - 0x8000) }; }).sort((a, b) => a.c - b.c || a.j - b.j);
      costCells.forEach(({ j, c }, n) => { const p = co0 + n; fields.costOvSeq[p] = cod.getUint32(j * 16, true); fields.costOvVal[p] = cod.getFloat64(j * 16 + 8, true); if (!fields.costIdx[c]) { fields.costIdx[c] = p + 1; fields.costCnt[c] = 0; touchedCost.push(c); } fields.costCnt[c]++; });
      const jobCells = Array.from({ length: jo - jo0 }, (_, j) => jo0 + j).map((j) => { const k = jod.getUint32(j * 16 + 4, true); return { j, c: main.cell(Math.floor(k / 65536) - 0x8000, (k % 65536) - 0x8000) * 8 + jod.getUint8(j * 16 + 8) }; }).sort((a, b) => a.c - b.c || a.j - b.j);
      jobCells.forEach(({ j, c }, n) => { const p = jo0 + n, cls = jod.getUint8(j * 16 + 9); fields.jobOvSeq[p] = jod.getUint32(j * 16, true); fields.jobOvVal[p] = cls ? jod.getUint32(j * 16 + 12, true) * 4 + cls : 0; if (!fields.jobIdx[c]) { fields.jobIdx[c] = p + 1; fields.jobCnt[c] = 0; touchedJob.push(c); } fields.jobCnt[c]++; });
      bookMs += performance.now() - t;
      // the searches, in batches split at tile writes
      for (let b = s; b < e;) {
        t = performance.now();
        for (; te < teN && ted.getUint32(te * 16, true) <= b; te++) {
          const x = ted.getInt32(te * 16 + 4, true), y = ted.getInt32(te * 16 + 8, true), ch = main.w.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), false)!;
          const li = (y - Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE) * CHUNK_SIZE + (x - Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE);
          ch.tiles[li] = ted.getUint16(te * 16 + 12, true); ch.aux[li] = ted.getUint8(te * 16 + 14);
        }
        let be = e;
        if (te < teN) { const ts = ted.getUint32(te * 16, true); if (ts < be) be = ts; }
        bookMs += performance.now() - t;
        t = performance.now();
        batch(b, be);
        searchMs += performance.now() - t;
        batches++;
        b = be;
      }
      // fold the overlay into the base
      t = performance.now();
      for (const c of touchedCost) { fields.costBase[c] = fields.costOvVal[fields.costIdx[c] - 1 + fields.costCnt[c] - 1]; fields.costIdx[c] = 0; }
      for (const c of touchedJob) { fields.jobBase[c] = fields.jobOvVal[fields.jobIdx[c] - 1 + fields.jobCnt[c] - 1]; fields.jobIdx[c] = 0; }
      touchedCost.length = 0; touchedJob.length = 0;
      bookMs += performance.now() - t;
      s = e;
    }
    return { searchMs, bookMs, batches };
  };

  const results = new Int8Array(new SharedArrayBuffer(N));
  const report = (label: string) => {
    const bad = [0, 0, 0, 0], byKind = [0, 0, 0, 0], codes = new Map<number, number>();
    for (let i = 0; i < N; i++) { const k = sdv.getUint8(i * SEARCH_BYTES + 96); byKind[k]++; if (results[i]) { bad[k]++; codes.set(results[i], (codes.get(results[i]) ?? 0) + 1); } }
    const s = KIND_NAMES.map((n, k) => `${n} ${byKind[k] - bad[k]}/${byKind[k]}`).join(', ');
    console.log(`  ${label} matches: ${s}${codes.size ? `; mismatch codes ${JSON.stringify(Object.fromEntries(codes))}` : ''}`);
    return { byKind, bad };
  };
  const out: Record<string, unknown> = { dir, label: m.label, node: process.version, arch: process.arch, searches: N, checkExpanded: G.__pfExpanded !== undefined, runs: {} };
  const runs = out.runs as Record<string, unknown>;
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

  // ---- this thread ----
  {
    const times: { searchMs: number; bookMs: number }[] = [];
    for (let r = 0; r < repeat; r++) {
      results.fill(0);
      const p = pass((s0, s1) => { for (let i = s0; i < s1; i++) results[i] = main.run(i); });
      times.push(p);
      console.log(`main thread, run ${r + 1}: searches ${p.searchMs.toFixed(0)} ms, bookkeeping ${p.bookMs.toFixed(0)} ms, ${p.batches} batches`);
    }
    const match = report('main thread');
    runs['1T'] = { searchMs: med(times.map((t) => t.searchMs)), bookMs: med(times.map((t) => t.bookMs)), all: times, match };
    const kinds: Record<string, unknown> = {};
    // per kind, timed alone (one more pass per kind, the other kinds skipped)
    if (!argv.includes('--no-kinds')) for (let k = 0; k < 4; k++) {
      let ms = 0;
      pass((s0, s1) => { const t = performance.now(); for (let i = s0; i < s1; i++) if (sdv.getUint8(i * SEARCH_BYTES + 96) === k) main.run(i); ms += performance.now() - t; });
      kinds[KIND_NAMES[k]] = ms;
    }
    if (Object.keys(kinds).length) { console.log(`  by kind (ms): ${JSON.stringify(kinds, (_k, v) => (typeof v === 'number' ? Math.round(v) : v))}`); (runs['1T'] as Record<string, unknown>).byKind = kinds; }
    // the critical path: each batch's slowest search, summed (what any number of workers still has to wait for)
    let crit = 0, sum = 0;
    pass((s0, s1) => {
      let worst = 0;
      for (let i = s0; i < s1; i++) { const t = performance.now(); main.run(i); const ms = performance.now() - t; sum += ms; if (ms > worst) worst = ms; }
      crit += worst;
    });
    console.log(`  critical path ${crit.toFixed(0)} ms of ${sum.toFixed(0)} ms (each batch's slowest search)`);
    (runs['1T'] as Record<string, unknown>).critical = { ms: crit, sumMs: sum };
  }

  // ---- worker threads ----
  for (const nw of workerCounts) {
    const ctl = new Int32Array(new SharedArrayBuffer(4 * 8)), busy = new Float64Array(new SharedArrayBuffer(8 * nw));
    const workers = Array.from({ length: nw }, (_, id) => new Worker(new URL(import.meta.url), { workerData: { corpus, fields, ctl, results, busy, id } satisfies WorkerInit }));
    await new Promise((r) => setTimeout(r, 500)); // let them load
    const batch = (s0: number, s1: number) => {
      ctl[1] = s0; ctl[2] = s1; ctl[3] = s0; ctl[4] = 0;
      Atomics.add(ctl, 0, 1);
      Atomics.notify(ctl, 0);
      for (let d = Atomics.load(ctl, 4); d < nw; d = Atomics.load(ctl, 4)) Atomics.wait(ctl, 4, d);
    };
    batch(0, 0); // every worker awake and through its first (empty) batch
    const times: { searchMs: number; bookMs: number }[] = [];
    for (let r = 0; r < repeat; r++) {
      results.fill(0); busy.fill(0);
      const p = pass(batch);
      times.push(p);
      console.log(`${nw} worker(s), run ${r + 1}: searches ${p.searchMs.toFixed(0)} ms (workers busy ${[...busy].map((b) => b.toFixed(0)).join('/')} ms), bookkeeping ${p.bookMs.toFixed(0)} ms`);
    }
    const match = report(`${nw} worker(s)`);
    runs[`W${nw}`] = { searchMs: med(times.map((t) => t.searchMs)), bookMs: med(times.map((t) => t.bookMs)), all: times, match };
    ctl[5] = 1; Atomics.add(ctl, 0, 1); Atomics.notify(ctl, 0);
    await Promise.all(workers.map((w) => new Promise((r) => w.once('exit', r))));
  }
  const json = arg('json', '');
  if (json) { writeFileSync(json, JSON.stringify(out, null, 1)); console.log(`summary: ${json}`); }
}
