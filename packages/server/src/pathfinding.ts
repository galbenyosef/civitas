import { isRoad, chunkOf, localIndex, junctionStepOk, routeLayer, STEP_RULE_AUX, isBridgeAux, bridgeNS } from '@msimcity/shared';
import { DIRS, tkey, type World } from './world';

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
  const visited = new Set<number>();
  const queue: Node[] = [];
  let head = 0;
  const startTile = peek(w, sx, sy);
  const root: Node = { x: sx, y: sy, parent: null, depth: 0, a: peekedAux };
  visited.add(tkey(sx, sy));
  if (startTile !== undefined && isRoad(startTile)) {
    queue.push(root);
  } else {
    for (const [dx, dy] of DIRS) {
      const nx = sx + dx, ny = sy + dy;
      const t = peek(w, nx, ny);
      if (t !== undefined && isRoad(t) && !sideways(peekedAux, dx)) {
        visited.add(tkey(nx, ny) + routeLayer(peekedAux, dx) * LAYER);
        queue.push({ x: nx, y: ny, parent: root, depth: 1, a: peekedAux });
      }
    }
  }
  let expanded = 0;
  while (head < queue.length && expanded < maxNodes) {
    const n = queue[head++];
    expanded++;
    for (const [dx, dy] of DIRS) {
      const nx = n.x + dx, ny = n.y + dy;
      const t = peek(w, nx, ny), a = peekedAux;
      const key = tkey(nx, ny) + routeLayer(a, dx) * LAYER;
      if (visited.has(key) || !stepOk(w, n, nx, ny) || sideways(a, dx)) continue;
      if (isGoal(nx, ny)) return { path: unwind({ x: nx, y: ny, parent: n, depth: n.depth + 1, a }), gx: nx, gy: ny };
      if (t === undefined || !isRoad(t)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny, parent: n, depth: n.depth + 1, a });
    }
  }
  return null;
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
 * re-routing from the road tile ahead is already heading into it, -1 when unknown.
 */
export function findRoute(
  w: World, sx: number, sy: number, gx: number, gy: number,
  cost: (x: number, y: number) => number, turnCost = 0.4, maxNodes = 4000, startDir = -1,
): { path: number[]; cost: number } | null {
  if (sx === gx && sy === gy) return { path: [sx, sy], cost: 0 };
  for (const [dx, dy] of DIRS) if (sx + dx === gx && sy + dy === gy) return { path: [sx, sy, gx, gy], cost: 1 };
  if (!w.hasRoadAccess(gx, gy)) return null; // the goal is reached only from a road beside it: without one, skip the search
  const goalRoad = (() => { const t = w.peekTile(gx, gy); return t !== undefined && isRoad(t); })();
  // open set: binary heap on f
  const heapK: number[] = [], heapF: number[] = [];
  const push = (k: number, f: number) => {
    heapK.push(k); heapF.push(f);
    let i = heapK.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= heapF[i]) break; [heapK[p], heapK[i]] = [heapK[i], heapK[p]]; [heapF[p], heapF[i]] = [heapF[i], heapF[p]]; i = p; }
  };
  const pop = (): number => {
    const k = heapK[0]; const lk = heapK.pop()!, lf = heapF.pop()!;
    if (heapK.length) {
      heapK[0] = lk; heapF[0] = lf;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < heapK.length && heapF[l] < heapF[m]) m = l;
        if (r < heapK.length && heapF[r] < heapF[m]) m = r;
        if (m === i) break;
        [heapK[m], heapK[i]] = [heapK[i], heapK[m]]; [heapF[m], heapF[i]] = [heapF[i], heapF[m]]; i = m;
      }
    }
    return k;
  };
  const g = new Map<number, number>(), parent = new Map<number, number>(), dirIn = new Map<number, number>(), closed = new Set<number>();
  const h = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);
  const startTile = peek(w, sx, sy), startAux = peekedAux;
  const start = tkey(sx, sy) + (startDir >= 0 ? routeLayer(startAux, DIRS[startDir][0]) * LAYER : 0);
  g.set(start, 0); dirIn.set(start, startDir);
  if (startTile !== undefined && isRoad(startTile)) push(start, h(sx, sy));
  else for (let d = 0; d < 4; d++) {
    const nx = sx + DIRS[d][0], ny = sy + DIRS[d][1];
    const t = peek(w, nx, ny);
    if (t === undefined || !isRoad(t) || sideways(peekedAux, DIRS[d][0])) continue;
    const k = tkey(nx, ny) + routeLayer(peekedAux, DIRS[d][0]) * LAYER, c = cost(nx, ny);
    g.set(k, c); parent.set(k, start); dirIn.set(k, d); push(k, c + h(nx, ny));
  }
  const auxFn = (x: number, y: number) => w.auxAt(x, y);
  let expanded = 0;
  while (heapK.length && expanded < maxNodes) {
    const k = pop();
    if (closed.has(k)) continue;
    closed.add(k); expanded++;
    const base = k % LAYER;
    const [x, y] = [Math.floor(base / 65536) - 0x8000, (base % 65536) - 0x8000];
    const gk = g.get(k)!, din = dirIn.get(k)!;
    const here = peek(w, x, y) === undefined ? 0 : peekedAux;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (here >= STEP_RULE_AUX && !junctionStepOk(auxFn, x, y, nx, ny, din >= 0 ? DIRS[din][0] : 0, din >= 0 ? DIRS[din][1] : 0)) continue;
      const t = peek(w, nx, ny);
      const nk = tkey(nx, ny) + routeLayer(peekedAux, DIRS[d][0]) * LAYER;
      if (nx === gx && ny === gy) {
        parent.set(nk, k);
        const path: number[] = [];
        for (let cur: number | undefined = nk; cur !== undefined; cur = parent.get(cur)) { const b = cur % LAYER; path.push((b % 65536) - 0x8000, Math.floor(b / 65536) - 0x8000); }
        path.reverse();
        return { path, cost: gk + (goalRoad ? cost(gx, gy) : 1) };
      }
      if (closed.has(nk)) continue;
      if (t === undefined || !isRoad(t) || sideways(peekedAux, DIRS[d][0])) continue;
      const ng = gk + cost(nx, ny) + (din >= 0 && din !== d && k !== start ? turnCost : 0); // startDir restricts, it does not charge
      const old = g.get(nk);
      if (old !== undefined && old <= ng) continue;
      g.set(nk, ng); parent.set(nk, k); dirIn.set(nk, d);
      push(nk, ng + h(nx, ny));
    }
  }
  return null;
}
