/**
 * The search corpus (docs/search-perf.md): every route, walk, job and venue search of a stretch of game time, with its
 * inputs, its answer and the world state it read, so the searches can be run again outside the game and every answer
 * checked (search-replay.ts in TypeScript, tools/search-rs in Rust). Recorded by `searchprof.ts --mode record --out DIR`.
 *
 * FORMAT, version 1. A directory of little-endian files of packed records:
 *
 *  manifest.json   { format: 'civitas-search-corpus', version: 1, label, tick0, tick1, chunkSize, consts, counts, stats }
 *  chunks.bin      3080 bytes a chunk: i32 cx, i32 cy, u16 tile[1024], u8 aux[1024] (row-major, index y * 32 + x within the
 *                  chunk). The tile word and the aux byte are all the searches read. Chunks as they were when recording
 *                  began, and each chunk generated later as it was generated: to a search a chunk that does not exist yet
 *                  and a fresh one are alike (no road, aux 0).
 *  tiles.bin       16 bytes a tile write: u32 seq, i32 x, i32 y, u16 tile, u8 aux, u8 0. Applied before search `seq`.
 *  searches.bin    112 bytes a search, in seq order (seq = record index):
 *                    0 u32 seq        4 u32 tick       8 i32 sx        12 i32 sy
 *                   16 i32 gx        20 i32 gy        (route, walk: the target; job, venue: the goal found, else 0)
 *                   24 f64 turnCost  32 f64 cost      (route: the arguments' turn cost and the answer's cost)
 *                   40 u32 maxNodes  44 u32 expanded  (nodes the game's search expanded)
 *                   48 u32 pathOff   52 u32 pathLen   (into paths.bin, in i32s; 0, 0 for no path)
 *                   56 u32 a1        60 u32 a2        (job found: a1 = building id; job missed: full.bin offset and
 *                                                      count; venue found: a1 = which goal test said yes, from 1)
 *                   64 i32 x0, 68 y0, 72 x1, 76 y1     (job missed: the box the game remembers the miss over)
 *                   80 i32 ox1, 84 oy1, 88 ox2, 92 oy2 (route: tiles its own cost function priced at consts.avoid)
 *                   96 u8 kind (0 route = findRoute, 1 walk = pathBetween, 2 job = findJob's findPath, 3 venue =
 *                      goToVenue's findPath)   97 i8 startDir   98 u8 edu   99 u8 flags (bit 0 found, bits 1-2 how
 *                      many of ox/oy are used)   100-111 zero
 *  paths.bin       i32 x, y pairs
 *  full.bin        u32 building ids: the full workplaces a missed job search passed, in the order the game met them
 *  costBase.bin    16 bytes: u32 tick, u32 key, f64 cost    the route cost field (below), set at the start of a tick
 *  costOver.bin    16 bytes: u32 seq,  u32 key, f64 cost    the route cost field, changed during a tick
 *  jobBase.bin     16 bytes: u32 tick, u32 key, u8 edu, u8 cls, u16 0, u32 building id   the job field
 *  jobOver.bin     16 bytes: u32 seq,  u32 key, u8 edu, u8 cls, u16 0, u32 building id
 *
 * Keys are World tkey(x, y) = (x + 0x8000) * 65536 + (y + 0x8000).
 *
 * THE FIELDS. A route search prices each road tile with a closure (Traffic.cost: congestion, junctions, cars at the
 * kerb, level crossings) and a job search tests tiles with one (a workplace with a place for this citizen's education
 * level, else a full one, else neither). Both read live game state that changes as the day goes on, some of it within
 * a tick (a hire fills a place, a car parks). The corpus keeps what each closure answered as a field over the map:
 * per tile, the cost; per tile and education level, cls (0 neither, 1 full workplace, 2 a place) and the building. A
 * replayer keeps a base value per cell and, within a tick, an overlay:
 *   - at the start of tick T, apply T's base events;
 *   - a search with seq s in T reads, for a cell with overlay events in T, the last of them with seq <= s, else the
 *     base value (cells never set: cost NaN, job 0);
 *   - after T's searches, each overlay cell's last value becomes its base value.
 * The recorder writes a base event when a search sees a value that differs from what the replayer would read and no
 * search of this tick has read that cell yet, else an overlay event. So every search reads exactly what the game's
 * closure answered, and the overlay count is the number of reads a solve against the start of the tick would get wrong.
 * A route's own changes to its cost (maybeReroute prices the tile behind it at 1e4 so nobody U-turns) are per search:
 * ox/oy. A venue search's goal test draws Math.random, so it is kept as the index of the test that said yes.
 * findBest (builders' sites, parking, dispatch) is not in the corpus.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHUNK_SIZE, chunkOf, localIndex, isRoad, zoneOf, tileKey, SKILLS } from '@msimcity/shared';
import { tkey, hasJobs, type World, type Building, type Citizen } from '../world';
import type { Game } from '../game';

export const CORPUS_VERSION = 1;
export const CHUNK_BYTES = 8 + CHUNK_SIZE * CHUNK_SIZE * 3;
export const SEARCH_BYTES = 112;
export const Kind = { Route: 0, Walk: 1, Job: 2, Venue: 3 } as const;
export const KIND_NAMES = ['route', 'walk', 'job', 'venue'] as const;
/** maybeReroute's price for a tile a re-route must not use */
export const AVOID = 1e4;
const CELLS = CHUNK_SIZE * CHUNK_SIZE;

type Fn = (this: unknown, ...a: unknown[]) => unknown;
interface PfHook { orig: Record<string, Fn>; set: Record<string, (f: Fn) => void> }
const G = globalThis as unknown as { __pfExpanded?: number };

/** An append-only buffer of fixed-size little-endian records. */
class Records {
  buf: Uint8Array; dv: DataView; n = 0;
  constructor(public size: number, cap = 1024) { this.buf = new Uint8Array(size * cap); this.dv = new DataView(this.buf.buffer); }
  /** byte offset of a new zeroed record */
  add(): number {
    if ((this.n + 1) * this.size > this.buf.length) {
      const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; this.dv = new DataView(b.buffer);
    }
    return this.n++ * this.size;
  }
  bytes() { return this.buf.subarray(0, this.n * this.size); }
}

/**
 * Install the recording wrappers on a filled game; `finish()` writes the corpus. The wrappers call the game's own
 * closures exactly once per call, in the same order, and draw no random numbers, so the game plays as it would without.
 */
export function recordCorpus(game: Game, hook: PfHook, opts: { label: string; dir: string }) {
  if (!opts.dir) throw new Error('--mode record needs --out DIR');
  if (G.__pfExpanded === undefined) throw new Error('record mode needs SEARCH_HOOK_EXPANDED=1');
  const w = game.world;
  const sim = game.sim as unknown as { skills: { placeFor(b: Building, edu: number): number }; jobMisses: Map<number, { x0: number; y0: number; x1: number; y1: number; full: Building[] }> };
  const tick0 = w.tick + 1;

  // ---- tiles: a copy of every chunk, kept up to date by the tile writes ----
  const chunks = new Map<number, { cx: number; cy: number; tiles: Uint16Array; aux: Uint8Array }>();
  for (const c of w.chunks.values()) chunks.set(tkey(c.cx, c.cy), { cx: c.cx, cy: c.cy, tiles: c.tiles.slice(), aux: c.aux.slice() });
  const startChunks = chunks.size;
  const gen = w.generateChunk.bind(w);
  w.generateChunk = (cx: number, cy: number) => {
    const c = gen(cx, cy);
    chunks.set(tkey(cx, cy), { cx, cy, tiles: c.tiles.slice(), aux: c.aux.slice() });
    return c;
  };
  let seq = 0; // the next search's
  const tileEv = new Records(16);
  let untracked = 0;
  const noteTile = (x: number, y: number) => {
    const c = w.getChunk(chunkOf(x), chunkOf(y), false), m = chunks.get(tkey(chunkOf(x), chunkOf(y)));
    if (!c) return;
    if (!m) { untracked++; return; }
    const i = localIndex(x, y);
    if (m.tiles[i] === c.tiles[i] && m.aux[i] === c.aux[i]) return;
    m.tiles[i] = c.tiles[i]; m.aux[i] = c.aux[i];
    const o = tileEv.add(), dv = tileEv.dv;
    dv.setUint32(o, seq, true); dv.setInt32(o + 4, x, true); dv.setInt32(o + 8, y, true); dv.setUint16(o + 12, c.tiles[i], true); dv.setUint8(o + 14, c.aux[i]);
  };
  const onTile = w.onTileChanged;
  w.onTileChanged = (x, y) => { onTile?.(x, y); noteTile(x, y); };
  const setAux = w.setAux.bind(w);
  w.setAux = (x: number, y: number, v: number) => { setAux(x, y, v); noteTile(x, y); };

  // ---- the two fields, as a replayer will read them ----
  let curTick = -1;
  const costBase = new Map<number, number>(), costOver = new Map<number, number>(), costSeen = new Set<number>();
  const jobBase = new Map<number, number>(), jobOver = new Map<number, number>(), jobSeen = new Set<number>();
  const costBaseEv = new Records(16), costOverEv = new Records(16), jobBaseEv = new Records(16), jobOverEv = new Records(16);
  const roll = () => {
    if (w.tick === curTick) return;
    for (const [k, v] of costOver) costBase.set(k, v);
    for (const [k, v] of jobOver) jobBase.set(k, v);
    costOver.clear(); costSeen.clear(); jobOver.clear(); jobSeen.clear();
    curTick = w.tick;
  };
  let costReads = 0, jobReads = 0;
  const observeCost = (k: number, v: number, s: number) => {
    costReads++;
    const o = costOver.get(k);
    if ((o !== undefined ? o : costBase.get(k)) !== v) {
      const over = costSeen.has(k), r = over ? costOverEv : costBaseEv, at = r.add();
      r.dv.setUint32(at, over ? s : curTick, true); r.dv.setUint32(at + 4, k, true); r.dv.setFloat64(at + 8, v, true);
      (over ? costOver : costBase).set(k, v);
    }
    costSeen.add(k);
  };
  const observeJob = (tk: number, edu: number, cls: number, bid: number, s: number) => {
    jobReads++;
    const k = tk * 8 + edu, v = cls ? bid * 4 + cls : 0;
    const o = jobOver.get(k);
    if ((o !== undefined ? o : (jobBase.get(k) ?? 0)) !== v) {
      const over = jobSeen.has(k), r = over ? jobOverEv : jobBaseEv, at = r.add();
      r.dv.setUint32(at, over ? s : curTick, true); r.dv.setUint32(at + 4, tk, true); r.dv.setUint8(at + 8, edu); r.dv.setUint8(at + 9, cls); r.dv.setUint32(at + 12, bid, true);
      (over ? jobOver : jobBase).set(k, v);
    }
    jobSeen.add(k);
  };
  const bids = new Map<Building, number>();
  const bidOf = (b: Building) => { let id = bids.get(b); if (id === undefined) bids.set(b, (id = bids.size + 1)); return id; };

  // ---- the searches ----
  const recs = new Records(SEARCH_BYTES, 65536), paths: number[] = [], full: number[] = [];
  const begin = (kind: number, s: number, sx: number, sy: number, maxNodes: number) => {
    const o = recs.add(), dv = recs.dv;
    if (o / SEARCH_BYTES !== s) throw new Error('search records out of step with seq');
    dv.setUint32(o, s, true); dv.setUint32(o + 4, w.tick, true); dv.setInt32(o + 8, sx, true); dv.setInt32(o + 12, sy, true);
    dv.setUint32(o + 40, maxNodes, true); dv.setUint8(o + 96, kind);
    return o;
  };
  const answer = (o: number, path: number[] | null, exp: number) => {
    const dv = recs.dv;
    dv.setUint32(o + 44, exp, true);
    if (path) { dv.setUint32(o + 48, paths.length, true); dv.setUint32(o + 52, path.length, true); for (const v of path) paths.push(v); }
    dv.setUint8(o + 99, dv.getUint8(o + 99) | (path ? 1 : 0));
  };
  const O = hook.orig as Record<string, (...a: never[]) => unknown>;
  const findRoute = O.findRoute as unknown as (w: World, sx: number, sy: number, gx: number, gy: number, cost: (x: number, y: number) => number, turn: number, max: number, dir: number) => { path: number[]; cost: number } | null;
  const pathBetween = O.pathBetween as unknown as (w: World, ax: number, ay: number, bx: number, by: number) => number[] | null;
  const findPath = O.findPath as unknown as (w: World, sx: number, sy: number, goal: (x: number, y: number) => boolean, max?: number) => { path: number[]; gx: number; gy: number } | null;
  const counts = { route: 0, walk: 0, job: 0, venue: 0, jobCached: 0, otherFindPath: 0 };

  hook.set.findRoute(function (this: unknown, ...a: unknown[]) {
    const [w0, sx, sy, gx, gy, cost, turnCost = 0.4, maxNodes = 4000, startDir = -1] = a as [World, number, number, number, number, (x: number, y: number) => number, number?, number?, number?];
    roll();
    const s = seq++, o = begin(Kind.Route, s, sx, sy, maxNodes);
    counts.route++;
    const ov: number[] = [];
    const priced = (x: number, y: number) => {
      const v = cost(x, y);
      if (v === AVOID) {
        let seen = false;
        for (let i = 0; i < ov.length; i += 2) if (ov[i] === x && ov[i + 1] === y) seen = true;
        if (!seen) ov.push(x, y);
      } else observeCost(tkey(x, y), v, s);
      return v;
    };
    const e0 = G.__pfExpanded!;
    const r = findRoute(w0, sx, sy, gx, gy, priced, turnCost, maxNodes, startDir);
    const dv = recs.dv;
    if (ov.length > 4) throw new Error(`a route priced ${ov.length / 2} tiles at AVOID`);
    dv.setInt32(o + 16, gx, true); dv.setInt32(o + 20, gy, true); dv.setFloat64(o + 24, turnCost, true); dv.setInt8(o + 97, startDir);
    for (let i = 0; i < ov.length; i++) dv.setInt32(o + 80 + i * 4, ov[i], true);
    dv.setUint8(o + 99, (ov.length / 2) << 1);
    if (r) dv.setFloat64(o + 32, r.cost, true);
    answer(o, r ? r.path : null, G.__pfExpanded! - e0);
    return r;
  });
  let inWalk = false;
  hook.set.pathBetween(function (this: unknown, ...a: unknown[]) {
    const [w0, ax, ay, bx, by] = a as [World, number, number, number, number];
    roll();
    const s = seq++, o = begin(Kind.Walk, s, ax, ay, 2500);
    counts.walk++;
    recs.dv.setInt32(o + 16, bx, true); recs.dv.setInt32(o + 20, by, true);
    const e0 = G.__pfExpanded!;
    inWalk = true;
    let r: number[] | null;
    try { r = pathBetween(w0, ax, ay, bx, by); } finally { inWalk = false; }
    answer(o, r, G.__pfExpanded! - e0);
    return r;
  });
  // findPath's context: the findJob or goToVenue it runs in
  const ctx: ({ job: Citizen } | { venue: true })[] = [];
  let lastJob = -1;
  hook.set.findPath(function (this: unknown, ...a: unknown[]) {
    const [w0, sx, sy, isGoal, maxNodes = 2500] = a as [World, number, number, (x: number, y: number) => boolean, number?];
    const top = ctx[ctx.length - 1];
    if (inWalk || !top) { if (!inWalk) counts.otherFindPath++; return findPath(w0, sx, sy, isGoal, maxNodes); }
    roll();
    const s = seq++;
    const e0 = G.__pfExpanded!;
    if ('job' in top) {
      const o = begin(Kind.Job, s, sx, sy, maxNodes), edu = top.job.edu;
      counts.job++;
      recs.dv.setUint8(o + 98, edu);
      let goalBid = 0;
      const test = (x: number, y: number) => {
        const r = isGoal(x, y);
        const key = tileKey(x, y);
        let cls = 0, bid = 0;
        if (r) { cls = 2; bid = bidOf(w.buildings.get(key)!); goalBid = bid; }
        else {
          const t = w.peekTile(x, y);
          if (t !== undefined && !isRoad(t) && hasJobs(zoneOf(t))) {
            const b = w.buildings.get(key);
            if (b && hasJobs(b.zone) && !(w.mothballed.size && w.mothballed.has(key))) {
              if (sim.skills.placeFor(b, edu) !== 0) throw new Error(`job test said no at ${key} but there is a place`);
              cls = 1; bid = bidOf(b);
            }
          }
        }
        observeJob(tkey(x, y), edu, cls, bid, s);
        return r;
      };
      const r = findPath(w0, sx, sy, test, maxNodes);
      if (r) { recs.dv.setInt32(o + 16, r.gx, true); recs.dv.setInt32(o + 20, r.gy, true); recs.dv.setUint32(o + 56, goalBid, true); }
      answer(o, r ? r.path : null, G.__pfExpanded! - e0);
      lastJob = o;
      return r;
    }
    const o = begin(Kind.Venue, s, sx, sy, maxNodes);
    counts.venue++;
    let tests = 0, yes = 0;
    const test = (x: number, y: number) => { tests++; const r = isGoal(x, y); if (r) yes = tests; return r; };
    const r = findPath(w0, sx, sy, test, maxNodes);
    if (r) { recs.dv.setInt32(o + 16, r.gx, true); recs.dv.setInt32(o + 20, r.gy, true); recs.dv.setUint32(o + 56, yes, true); }
    answer(o, r ? r.path : null, G.__pfExpanded! - e0);
    return r;
  });
  const proto = Object.getPrototypeOf(game.sim) as Record<string, Fn>;
  const findJob = proto.findJob, goToVenue = proto.goToVenue;
  proto.findJob = function (this: unknown, ...a: unknown[]) {
    const c = a[0] as Citizen;
    ctx.push({ job: c }); lastJob = -1;
    let r: unknown;
    try { r = findJob.apply(this, a); } finally { ctx.pop(); }
    if (lastJob < 0) counts.jobCached++;
    else if (r === false) {
      // the miss the game remembers: its box and the full workplaces it passed
      const m = sim.jobMisses.get(tkey(c.hx, c.hy) * 8 + (SKILLS.on ? c.edu : 0));
      if (!m) throw new Error('a missed job search left no miss');
      const dv = recs.dv;
      dv.setUint32(lastJob + 56, full.length, true); dv.setUint32(lastJob + 60, m.full.length, true);
      for (const b of m.full) { const id = bids.get(b); if (id === undefined) throw new Error('a full workplace the recorder never saw'); full.push(id); }
      dv.setInt32(lastJob + 64, m.x0, true); dv.setInt32(lastJob + 68, m.y0, true); dv.setInt32(lastJob + 72, m.x1, true); dv.setInt32(lastJob + 76, m.y1, true);
    }
    lastJob = -1;
    return r;
  };
  proto.goToVenue = function (this: unknown, ...a: unknown[]) {
    ctx.push({ venue: true });
    try { return goToVenue.apply(this, a); } finally { ctx.pop(); }
  };

  return {
    finish() {
      // every tile write was seen: the copies are the world as it is now
      let stale = 0;
      for (const m of chunks.values()) {
        const c = w.getChunk(m.cx, m.cy, false)!;
        for (let i = 0; i < CELLS; i++) if (m.tiles[i] !== c.tiles[i] || m.aux[i] !== c.aux[i]) stale++;
      }
      const dir = opts.dir;
      mkdirSync(dir, { recursive: true });
      const cb = new Uint8Array(chunks.size * CHUNK_BYTES), cdv = new DataView(cb.buffer);
      let i = 0;
      for (const m of [...chunks.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
        const o = i++ * CHUNK_BYTES;
        cdv.setInt32(o, m.cx, true); cdv.setInt32(o + 4, m.cy, true);
        cb.set(new Uint8Array(m.tiles.buffer, m.tiles.byteOffset, CELLS * 2), o + 8);
        cb.set(m.aux, o + 8 + CELLS * 2);
      }
      writeFileSync(join(dir, 'chunks.bin'), cb);
      writeFileSync(join(dir, 'tiles.bin'), tileEv.bytes());
      writeFileSync(join(dir, 'searches.bin'), recs.bytes());
      writeFileSync(join(dir, 'paths.bin'), new Uint8Array(Int32Array.from(paths).buffer));
      writeFileSync(join(dir, 'full.bin'), new Uint8Array(Uint32Array.from(full).buffer));
      writeFileSync(join(dir, 'costBase.bin'), costBaseEv.bytes());
      writeFileSync(join(dir, 'costOver.bin'), costOverEv.bytes());
      writeFileSync(join(dir, 'jobBase.bin'), jobBaseEv.bytes());
      writeFileSync(join(dir, 'jobOver.bin'), jobOverEv.bytes());
      const stats = { ...counts, costReads, jobReads, startChunks, untrackedTileWrites: untracked, staleTiles: stale, buildings: bids.size };
      const manifest = {
        format: 'civitas-search-corpus', version: CORPUS_VERSION, label: opts.label, tick0, tick1: w.tick, chunkSize: CHUNK_SIZE,
        consts: { avoid: AVOID, layer: 2 ** 32, defaults: { routeTurnCost: 0.4, routeMaxNodes: 4000, walkMaxNodes: 2500, jobMaxNodes: 2500, venueMaxNodes: 900 } },
        counts: { chunks: chunks.size, searches: recs.n, pathInts: paths.length, full: full.length, tileEvents: tileEv.n, costBase: costBaseEv.n, costOver: costOverEv.n, jobBase: jobBaseEv.n, jobOver: jobOverEv.n },
        stats,
      };
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
      console.log(`corpus: ${dir}: ${JSON.stringify(manifest.counts)}`);
      console.log(`  ${JSON.stringify(stats)}`);
      if (stale || untracked) console.log(`  WARNING: ${stale} tiles differ from the copies, ${untracked} writes to chunks never copied`);
      return manifest;
    },
  };
}

// ---- reading ----------------------------------------------------------------------------------------

export interface Manifest {
  format: string; version: number; label: string; tick0: number; tick1: number; chunkSize: number;
  consts: { avoid: number; layer: number };
  counts: Record<'chunks' | 'searches' | 'pathInts' | 'full' | 'tileEvents' | 'costBase' | 'costOver' | 'jobBase' | 'jobOver', number>;
  stats: Record<string, number>;
}
export interface Corpus {
  manifest: Manifest;
  chunks: Uint8Array; tiles: Uint8Array; searches: Uint8Array; paths: Int32Array; full: Uint32Array;
  costBase: Uint8Array; costOver: Uint8Array; jobBase: Uint8Array; jobOver: Uint8Array;
}
export const CORPUS_FILES = ['chunks', 'tiles', 'searches', 'paths', 'full', 'costBase', 'costOver', 'jobBase', 'jobOver'] as const;

/** Read a corpus; with `shared`, every file is copied into a SharedArrayBuffer so worker threads can see it. */
export function readCorpus(dir: string, shared = false): Corpus {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.format !== 'civitas-search-corpus' || manifest.version !== CORPUS_VERSION) throw new Error(`${dir}: not a version ${CORPUS_VERSION} search corpus`);
  const load = (n: string) => {
    const b = readFileSync(join(dir, `${n}.bin`));
    const u = new Uint8Array(shared ? new SharedArrayBuffer(Math.max(8, b.length)) : new ArrayBuffer(Math.max(8, b.length)), 0, b.length);
    u.set(b);
    return u;
  };
  const files = Object.fromEntries(CORPUS_FILES.map((n) => [n, load(n)])) as Record<(typeof CORPUS_FILES)[number], Uint8Array>;
  return {
    manifest, ...files,
    paths: new Int32Array(files.paths.buffer, 0, files.paths.length / 4),
    full: new Uint32Array(files.full.buffer, 0, files.full.length / 4),
  };
}
