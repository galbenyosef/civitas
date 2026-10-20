import { isRoad, chunkOf, localIndex, junctionStepOk, routeLayer, STEP_RULE_AUX, isBridgeAux, bridgeNS, CHUNK_SIZE } from '@msimcity/shared';
import { DIRS, tkey, type Chunk, type World } from './world';

/** `a`: the tile's aux byte (roundabouts and flyovers restrict the steps out of it, shared/src/junctions.ts) */
interface Node { x: number; y: number; parent: Node | null; depth: number; a: number }

/** A flyover's road beneath is its own search node: its key is the tile key plus this (tile keys stay below 2^32). */
const LAYER = 2 ** 32;
/** Tile word at (x, y) without generating (undefined where not loaded), leaving its aux byte in `peekedAux`: one chunk lookup for both. */
let peekedAux = 0;
function peek(w: World, x: number, y: number): number | undefined {
  const c = w.getChunk(chunkOf(x), chunkOf(y), false);
  if (!c) { peekedAux = 0; return undefined; }
  const i = localIndex(x, y);
  peekedAux = c.aux[i];
  return c.tiles[i];
}
/** May a search go on from node n to its neighbour (nx, ny): round a ring only forwards, over a flyover only straight, off a bridge deck only along it. */
function stepOk(w: World, n: Node, nx: number, ny: number): boolean {
  if (n.a < STEP_RULE_AUX) return true;
  return junctionStepOk((x, y) => w.auxAt(x, y), n.x, n.y, nx, ny, n.parent ? n.x - n.parent.x : 0, n.parent ? n.y - n.parent.y : 0);
}

/** Would the step (dx, ·) onto a tile with aux byte a come onto a bridge deck from the side? Decks are entered only at their ends. */
const sideways = (a: number, dx: number) => isBridgeAux(a) && bridgeNS(a) === (dx !== 0);

export interface PathResult { path: number[]; gx: number; gy: number }

/**
 * Breadth-first search over road tiles starting at (sx, sy), which may itself be
 * a road or a building next to one. `isGoal` is tested on the non-road
 * neighbours of every road reached (and on roads themselves), so the same
 * routine finds both "a path to this tile" and "the nearest workplace with a
 * vacancy". Bounded by maxNodes so a huge connected road network cannot stall
 * the tick. Returns a flat [x0,y0,x1,y1,...] path from start to goal.
 */
export function findPath(
  w: World, sx: number, sy: number,
  isGoal: (x: number, y: number) => boolean,
  maxNodes = 2500,
): PathResult | null {
  // trivially adjacent (e.g. home next door to work, no road needed)
  for (const [dx, dy] of DIRS) {
    if (isGoal(sx + dx, sy + dy)) return { path: [sx, sy, sx + dx, sy + dy], gx: sx + dx, gy: sy + dy };
  }
  const S = slotsOf(w), st = nextStamp();
  const queue: Node[] = [];
  let head = 0;
  const s0 = S.slot(w, chunkOf(sx), chunkOf(sy)), li0 = localIndex(sx, sy);
  const root: Node = { x: sx, y: sy, parent: null, depth: 0, a: s0 < 0 ? 0 : S.chunks[s0].aux[li0] };
  if (s0 >= 0) visited[s0 * NODES + li0] = st;
  if (s0 >= 0 && isRoad(S.chunks[s0].tiles[li0])) {
    queue.push(root);
  } else {
    for (const [dx, dy] of DIRS) {
      const nx = sx + dx, ny = sy + dy;
      const s = S.slot(w, chunkOf(nx), chunkOf(ny));
      if (s < 0) continue;
      const li = localIndex(nx, ny), t = S.chunks[s].tiles[li], a = S.chunks[s].aux[li];
      if (isRoad(t) && !sideways(a, dx)) {
        visited[s * NODES + routeLayer(a, dx) * CELLS + li] = st;
        queue.push({ x: nx, y: ny, parent: root, depth: 1, a });
      }
    }
  }
  let expanded = 0;
  while (head < queue.length && expanded < maxNodes) {
    const n = queue[head++];
    expanded++;
    for (const [dx, dy] of DIRS) {
      const nx = n.x + dx, ny = n.y + dy;
      const s = S.slot(w, chunkOf(nx), chunkOf(ny));
      if (s < 0) {
        // not loaded: no road, but perhaps the goal (the start, when it is not loaded either, counts as visited)
        if ((s0 < 0 && nx === sx && ny === sy) || !stepOk(w, n, nx, ny)) continue;
        if (isGoal(nx, ny)) return { path: unwind({ x: nx, y: ny, parent: n, depth: n.depth + 1, a: 0 }), gx: nx, gy: ny };
        continue;
      }
      const li = localIndex(nx, ny), t = S.chunks[s].tiles[li], a = S.chunks[s].aux[li];
      const key = s * NODES + routeLayer(a, dx) * CELLS + li;
      if (visited[key] === st || !stepOk(w, n, nx, ny) || sideways(a, dx)) continue;
      if (isGoal(nx, ny)) return { path: unwind({ x: nx, y: ny, parent: n, depth: n.depth + 1, a }), gx: nx, gy: ny };
      if (!isRoad(t)) continue;
      visited[key] = st;
      queue.push({ x: nx, y: ny, parent: n, depth: n.depth + 1, a });
    }
  }
  return null;
}

/**
 * Like findPath, but a few goals from one search (motivation M2: the job search scores its candidates, sim/motivation.ts).
 * The search is findPath's own, step for step, so the first goal is the one findPath returns; from there it goes on
 * until it holds `take` goals, its next node is deeper than the first goal plus `slack`, or it has expanded `extra`
 * nodes more, whichever comes first (and never past maxNodes). Goals are in the order found, nearest first, each once.
 * With no goal at all it has walked exactly what findPath walks.
 */
export function findPaths(
  w: World, sx: number, sy: number,
  isGoal: (x: number, y: number) => boolean,
  maxNodes = 2500, take = 4, slack = 10, extra = 300,
): PathResult[] {
  const out: PathResult[] = [];
  const has = (x: number, y: number) => { for (const r of out) if (r.gx === x && r.gy === y) return true; return false; };
  for (const [dx, dy] of DIRS) {
    const gx = sx + dx, gy = sy + dy;
    if (out.length < take && isGoal(gx, gy)) out.push({ path: [sx, sy, gx, gy], gx, gy });
  }
  if (out.length >= take) return out;
  const S = slotsOf(w), st = nextStamp();
  const queue: Node[] = [];
  let head = 0;
  const s0 = S.slot(w, chunkOf(sx), chunkOf(sy)), li0 = localIndex(sx, sy);
  const root: Node = { x: sx, y: sy, parent: null, depth: 0, a: s0 < 0 ? 0 : S.chunks[s0].aux[li0] };
  if (s0 >= 0) visited[s0 * NODES + li0] = st;
  if (s0 >= 0 && isRoad(S.chunks[s0].tiles[li0])) {
    queue.push(root);
  } else {
    for (const [dx, dy] of DIRS) {
      const nx = sx + dx, ny = sy + dy;
      const s = S.slot(w, chunkOf(nx), chunkOf(ny));
      if (s < 0) continue;
      const li = localIndex(nx, ny), t = S.chunks[s].tiles[li], a = S.chunks[s].aux[li];
      if (isRoad(t) && !sideways(a, dx)) {
        visited[s * NODES + routeLayer(a, dx) * CELLS + li] = st;
        queue.push({ x: nx, y: ny, parent: root, depth: 1, a });
      }
    }
  }
  let expanded = 0, firstDepth = out.length ? 1 : -1, firstAt = 0;
  const found = (nx: number, ny: number, n: Node, a: number) => {
    if (out.length >= take || has(nx, ny)) return;
    out.push({ path: unwind({ x: nx, y: ny, parent: n, depth: n.depth + 1, a }), gx: nx, gy: ny });
    if (firstDepth < 0) { firstDepth = n.depth + 1; firstAt = expanded; }
  };
  while (head < queue.length && expanded < maxNodes) {
    const n = queue[head++];
    if (firstDepth >= 0 && (out.length >= take || n.depth + 1 > firstDepth + slack || expanded - firstAt >= extra)) break;
    expanded++;
    for (const [dx, dy] of DIRS) {
      const nx = n.x + dx, ny = n.y + dy;
      const s = S.slot(w, chunkOf(nx), chunkOf(ny));
      if (s < 0) {
        if ((s0 < 0 && nx === sx && ny === sy) || !stepOk(w, n, nx, ny)) continue;
        if (isGoal(nx, ny)) found(nx, ny, n, 0);
        continue;
      }
      const li = localIndex(nx, ny), t = S.chunks[s].tiles[li], a = S.chunks[s].aux[li];
      const key = s * NODES + routeLayer(a, dx) * CELLS + li;
      if (visited[key] === st || !stepOk(w, n, nx, ny) || sideways(a, dx)) continue;
      if (isGoal(nx, ny)) { found(nx, ny, n, a); continue; }
      if (!isRoad(t)) continue;
      visited[key] = st;
      queue.push({ x: nx, y: ny, parent: n, depth: n.depth + 1, a });
    }
  }
  return out;
}

/**
 * Like findPath, but keeps searching and returns the goal with the best
 * (score - distance). `score` returns null for non-goals. Used by builders so a
 * high-priority site a bit further away beats a low-priority one next door.
 *
 * Stops early once nothing further out can win: `maxScore` is an upper bound on
 * any score and `maxTotal` an upper bound on any (score - distance), so when the
 * best so far reaches min(maxTotal, maxScore - depth) for the next BFS depth the
 * result cannot change (ties keep the first found, as before). With the defaults
 * the whole node budget is searched.
 */
export function findBest(
  w: World, sx: number, sy: number,
  score: (x: number, y: number) => number | null,
  maxNodes = 2500, maxScore = Infinity, maxTotal = Infinity,
): PathResult | null {
  const visited = new Set<number>(), goals = new Set<number>();
  const queue: Node[] = [];
  let head = 0;
  const startTile = peek(w, sx, sy);
  const root: Node = { x: sx, y: sy, parent: null, depth: 0, a: peekedAux };
  visited.add(tkey(sx, sy));
  let best: { total: number; node: Node } | null = null;
  const consider = (x: number, y: number, parent: Node) => {
    const sc = score(x, y);
    if (sc === null) return false;
    const node = { x, y, parent, depth: parent.depth + 1, a: 0 };
    const total = sc - node.depth;
    if (!best || total > best.total) best = { total, node };
    return true;
  };
  for (const [dx, dy] of DIRS) consider(sx + dx, sy + dy, root);
  if (startTile !== undefined && isRoad(startTile)) queue.push(root);
  else for (const [dx, dy] of DIRS) {
    const nx = sx + dx, ny = sy + dy;
    const t = peek(w, nx, ny);
    if (t !== undefined && isRoad(t) && !sideways(peekedAux, dx)) { visited.add(tkey(nx, ny) + routeLayer(peekedAux, dx) * LAYER); queue.push({ x: nx, y: ny, parent: root, depth: 1, a: peekedAux }); }
  }
  const early = maxScore !== Infinity || maxTotal !== Infinity;
  let expanded = 0;
  while (head < queue.length && expanded < maxNodes) {
    const n = queue[head++];
    // goals found from here on are at depth >= n.depth + 1 (BFS order), so they total at most this
    if (early && best && (best as { total: number }).total >= Math.min(maxTotal, maxScore - (n.depth + 1))) break;
    expanded++;
    for (const [dx, dy] of DIRS) {
      const nx = n.x + dx, ny = n.y + dy;
      const t = peek(w, nx, ny), a = peekedAux;
      const key = tkey(nx, ny) + routeLayer(a, dx) * LAYER;
      if (visited.has(key) || !stepOk(w, n, nx, ny) || sideways(a, dx)) continue;
      if (t === undefined || !isRoad(t)) { if (!goals.has(key)) { goals.add(key); consider(nx, ny, n); } continue; }
      visited.add(key);
      queue.push({ x: nx, y: ny, parent: n, depth: n.depth + 1, a });
    }
  }
  if (!best) return null;
  const b: { total: number; node: Node } = best;
  return { path: unwind(b.node), gx: b.node.x, gy: b.node.y };
}

function unwind(n: Node | null): number[] {
  const out: number[] = [];
  for (; n; n = n.parent) out.push(n.y, n.x);
  out.reverse();
  return out;
}

/** Path between two specific tiles (either may be a building beside a road). */
export function pathBetween(w: World, ax: number, ay: number, bx: number, by: number): number[] | null {
  if (ax === bx && ay === by) return [ax, ay];
  // a goal is only ever reached from a road beside it or from next door: without either, skip the whole search
  if (Math.abs(bx - ax) + Math.abs(by - ay) > 1 && !w.hasRoadAccess(bx, by)) return null;
  const r = findPath(w, ax, ay, (x, y) => x === bx && y === by);
  return r ? r.path : null;
}

/** True while every interior tile of a cached path is still a road. */
export function pathStillValid(w: World, path: number[]): boolean {
  for (let i = 2; i < path.length - 2; i += 2) {
    const t = w.peekTile(path[i], path[i + 1]);
    if (t === undefined || !isRoad(t)) return false;
  }
  return true;
}


/**
 * A* over road tiles for drivers. `cost(x, y)` is the price of entering a road
 * tile (1 when empty, more when congested); `turnCost` is added when the
 * direction changes. Start and goal may be buildings beside a road. Returns the
 * flat path and its total cost, or null. Round a roundabout only forwards and over
 * a flyover only straight on (shared/src/junctions.ts): a flyover's deck and the
 * road beneath are separate nodes. `startDir` (a DIRS index) is the way a driver
 * re-routing from the road tile ahead is already heading into it, -1 when unknown. With `maxCost` the search gives up
 * (null) once every route it could still find would cost at least that much.
 */
export function findRoute(
  w: World, sx: number, sy: number, gx: number, gy: number,
  cost: (x: number, y: number) => number, turnCost = 0.4, maxNodes = 4000, startDir = -1, maxCost = Infinity,
): { path: number[]; cost: number } | null {
  if (sx === gx && sy === gy) return { path: [sx, sy], cost: 0 };
  for (const [dx, dy] of DIRS) if (sx + dx === gx && sy + dy === gy) return { path: [sx, sy, gx, gy], cost: 1 };
  if (!w.hasRoadAccess(gx, gy)) return null; // the goal is reached only from a road beside it: without one, skip the search
  const goalRoad = (() => { const t = w.peekTile(gx, gy); return t !== undefined && isRoad(t); })();
  const S = slotsOf(w), st = nextStamp();
  // open set: binary heap on f
  let hn = 0;
  const push = (k: number, f: number) => {
    if (hn === heapK.length) growHeap();
    heapK[hn] = k; heapF[hn] = f;
    let i = hn++;
    while (i > 0) {
      const p = (i - 1) >> 1; if (heapF[p] <= heapF[i]) break;
      const tk = heapK[p]; heapK[p] = heapK[i]; heapK[i] = tk; const tf = heapF[p]; heapF[p] = heapF[i]; heapF[i] = tf; i = p;
    }
  };
  const pop = (): number => {
    const k = heapK[0]; const lk = heapK[--hn], lf = heapF[hn];
    if (hn) {
      heapK[0] = lk; heapF[0] = lf;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < hn && heapF[l] < heapF[m]) m = l;
        if (r < hn && heapF[r] < heapF[m]) m = r;
        if (m === i) break;
        const tk = heapK[m]; heapK[m] = heapK[i]; heapK[i] = tk; const tf = heapF[m]; heapF[m] = heapF[i]; heapF[i] = tf; i = m;
      }
    }
    return k;
  };
  const h = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);
  // the start's node, or START when its chunk is not loaded (it is then never expanded, only the end of the path)
  let start = START;
  const s0 = S.slot(w, chunkOf(sx), chunkOf(sy));
  if (s0 >= 0) {
    const li = localIndex(sx, sy), ch = S.chunks[s0], startTile = ch.tiles[li], startAux = ch.aux[li];
    start = s0 * NODES + (startDir >= 0 ? routeLayer(startAux, DIRS[startDir][0]) * CELLS : 0) + li;
    seen[start] = st; gScore[start] = 0; dirIn[start] = startDir; parent[start] = START;
    if (isRoad(startTile)) push(start, h(sx, sy));
  }
  if (s0 < 0 || !isRoad(S.chunks[s0].tiles[localIndex(sx, sy)])) for (let d = 0; d < 4; d++) {
    const nx = sx + DIRS[d][0], ny = sy + DIRS[d][1];
    const s = S.slot(w, chunkOf(nx), chunkOf(ny));
    if (s < 0) continue;
    const li = localIndex(nx, ny), t = S.chunks[s].tiles[li], a = S.chunks[s].aux[li];
    if (!isRoad(t) || sideways(a, DIRS[d][0])) continue;
    const k = s * NODES + routeLayer(a, DIRS[d][0]) * CELLS + li, c = cost(nx, ny);
    seen[k] = st; gScore[k] = c; parent[k] = start; dirIn[k] = d; push(k, c + h(nx, ny));
  }
  const auxFn = (x: number, y: number) => w.auxAt(x, y);
  let expanded = 0;
  while (hn && expanded < maxNodes) {
    // f never falls from one node taken to the next, and a route found from a node costs at least its f
    if (heapF[0] >= maxCost) break;
    const k = pop();
    if (closed[k] === st) continue;
    closed[k] = st; expanded++;
    const s = (k / NODES) | 0, li = k & (CELLS - 1), ch = S.chunks[s];
    const x = ch.cx * CHUNK_SIZE + (li % CHUNK_SIZE), y = ch.cy * CHUNK_SIZE + ((li / CHUNK_SIZE) | 0);
    const gk = gScore[k], din = dirIn[k];
    const here = ch.aux[li];
    // the neighbours' chunk: this one, or the last one looked up
    let ls = s, lcx = ch.cx, lcy = ch.cy;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (here >= STEP_RULE_AUX && !junctionStepOk(auxFn, x, y, nx, ny, din >= 0 ? DIRS[din][0] : 0, din >= 0 ? DIRS[din][1] : 0)) continue;
      const ncx = chunkOf(nx), ncy = chunkOf(ny);
      if (ncx !== lcx || ncy !== lcy) { ls = S.slot(w, ncx, ncy); lcx = ncx; lcy = ncy; }
      if (nx === gx && ny === gy) {
        const path: number[] = [gy, gx];
        let cur = k;
        for (; cur >= 0; cur = parent[cur]) { const c = S.chunks[(cur / NODES) | 0], i = cur & (CELLS - 1); path.push(c.cy * CHUNK_SIZE + ((i / CHUNK_SIZE) | 0), c.cx * CHUNK_SIZE + (i % CHUNK_SIZE)); }
        if (cur === START && start === START) path.push(sy, sx);
        path.reverse();
        return { path, cost: gk + (goalRoad ? cost(gx, gy) : 1) };
      }
      if (ls < 0) continue; // not loaded: no road
      const li2 = localIndex(nx, ny), nch = S.chunks[ls], t = nch.tiles[li2], a = nch.aux[li2];
      const nk = ls * NODES + routeLayer(a, DIRS[d][0]) * CELLS + li2;
      if (closed[nk] === st) continue;
      if (!isRoad(t) || sideways(a, DIRS[d][0])) continue;
      const ng = gk + cost(nx, ny) + (din >= 0 && din !== d && k !== start ? turnCost : 0); // startDir restricts, it does not charge
      if (seen[nk] === st && gScore[nk] <= ng) continue;
      seen[nk] = st; gScore[nk] = ng; parent[nk] = k; dirIn[nk] = d;
      push(nk, ng + h(nx, ny));
    }
  }
  return null;
}

// ---- the road searches' scratch (docs/search-perf.md) -------------------------------------------------------------------

/**
 * A* nodes are numbered by chunk slot: slot * NODES + layer * CELLS + the tile's index in the chunk, where layer 1 is
 * the road beneath a flyover. Per node, scratch arrays shared by every search hold the g-score, the parent, the
 * direction in and two stamps: `seen` (g, parent and direction are this search's) and `closed`; findPath's breadth-first
 * search has its own `visited`. A search takes a new stamp, so nothing is cleared between searches.
 */
const CELLS = CHUNK_SIZE * CHUNK_SIZE, NODES = 2 * CELLS;
/** the parent of the start node, and the start itself when its chunk is not loaded */
const START = -1;
let stamp = 0;
let seen = new Uint32Array(0), closed = new Uint32Array(0), visited = new Uint32Array(0), gScore = new Float64Array(0), parent = new Int32Array(0), dirIn = new Int8Array(0);
let heapK = new Int32Array(1024), heapF = new Float64Array(1024);
function nextStamp(): number {
  if (++stamp === 0xffffffff) { seen.fill(0); closed.fill(0); visited.fill(0); stamp = 1; }
  return stamp;
}
function growHeap() {
  const k = new Int32Array(heapK.length * 2), f = new Float64Array(heapF.length * 2);
  k.set(heapK); f.set(heapF); heapK = k; heapF = f;
}
function growNodes(slots: number) {
  let n = seen.length || NODES * 64;
  while (n < slots * NODES) n *= 2;
  if (n === seen.length) return;
  const grow = <T extends Uint32Array | Float64Array | Int32Array | Int8Array>(a: T, b: T) => { b.set(a); return b; };
  seen = grow(seen, new Uint32Array(n)); closed = grow(closed, new Uint32Array(n)); visited = grow(visited, new Uint32Array(n)); gScore = grow(gScore, new Float64Array(n));
  parent = grow(parent, new Int32Array(n)); dirIn = grow(dirIn, new Int8Array(n));
}
/** A world's chunk slots: chunks are only ever added (World.getChunk), so a slot never changes. */
class Slots {
  chunks: Chunk[] = [];
  private byKey = new Map<number, number>();
  /** The slot of chunk (cx, cy), -1 while it is not loaded. */
  slot(w: World, cx: number, cy: number): number {
    const k = tkey(cx, cy);
    let s = this.byKey.get(k);
    if (s !== undefined) return s;
    const c = w.getChunk(cx, cy, false);
    if (!c) return -1;
    s = this.chunks.length;
    this.chunks.push(c); this.byKey.set(k, s);
    growNodes(this.chunks.length);
    return s;
  }
}
const worldSlots = new WeakMap<World, Slots>();
function slotsOf(w: World): Slots {
  let s = worldSlots.get(w);
  if (!s) worldSlots.set(w, s = new Slots());
  return s;
}
