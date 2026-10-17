import { isRoad, junctionStepOk, routeLayer, STEP_RULE_AUX, isBridgeAux, bridgeNS, terrainOf, zoneOf, Terrain } from '@msimcity/shared';
import { DIRS, tkey, type World } from '../world';

/**
 * Bus routing (docs/transit.md "The lap"). A* over (road tile, heading) rather than tiles alone, so a lap may come
 * back over the same road the other way, and a bus may **turn round** where a real one could:
 *
 *  - by driving on: round a block, or round a roundabout (forward moves only; the ring's own step rules apply);
 *  - at a **dead end** (a road tile with one neighbour: the turning head of a cul-de-sac or a one-tile stub);
 *  - in the mouth of a plain **junction** (three or more roads, no ring, flyover, bridge or level crossing);
 *  - **via the depot**: in at the door and out again, when the line's depot is beside the road.
 *
 * Each turn costs a fixed number of route-cost units on top of the tiles (TURN_COST), so a loop round a block of up
 * to that many tiles beats a three-point turn, a dead end beats a junction mouth and the depot is the last resort.
 * In a path a turn is the node where the bus reverses: ... P, T, P ... (T the turning tile), or ... T, D, T ... for
 * the depot door D. The traffic model drives the reversal as a three-point turn (sim/traffic.ts pathPoint).
 */

const OPP = [1, 0, 3, 2];
/** a flyover's road beneath is its own node (pathfinding.ts LAYER) */
const LAYER = 2 ** 32;
/** heading code for "not known yet": a start on a road with no way in, or out of a building door */
const ANY = 4;

export type TurnKind = 'dead end' | 'junction' | 'depot';
/** What a turn round costs a route, in tiles of driving (a bus covers a tile in about 2.5 ticks). */
export const TURN_COST: Record<TurnKind, number> = { 'dead end': 14, junction: 22, depot: 60 };
/** Ticks a three-point turn adds to the running time (traffic.ts drives it at UTURN_SLOW), for the first timing estimate. */
export const TURN_TICKS = 6;

/** The road network as a bus router sees it. */
export interface BusNet {
  w: World;
  /** price of entering a road tile (at least 1) */
  cost(x: number, y: number): number;
  /** road neighbours of a tile (a flyover counts as 2: Traffic.degreeOf) */
  degree(x: number, y: number): number;
  /** a level crossing or a bascule deck: nobody turns on one */
  crossing(x: number, y: number): boolean;
  /** the door of the depot a bus may turn in, if any */
  depot: [number, number] | null;
}

/** Can a bus turn round on road tile (x, y), and how? Null on a plain stretch, a corner or anything special. */
export function turnAt(net: BusNet, x: number, y: number): TurnKind | null {
  const t = net.w.peekTile(x, y);
  if (t === undefined || !isRoad(t) || net.w.auxAt(x, y) || net.crossing(x, y)) return null;
  const d = net.degree(x, y);
  return d <= 1 ? 'dead end' : d >= 3 ? 'junction' : null;
}

/** One drive from a start to a goal: the path (start and goal included), its cost, the heading it arrives in, the turns. */
export interface BusLeg { path: number[]; cost: number; dir: number; turns: { node: number; kind: TurnKind }[] }
export interface LegSearch {
  /** best leg arriving in each heading (index: DIRS heading into the goal tile) */
  legs: (BusLeg | null)[];
  /** the search ran out of nodes before it was done */
  exhausted: boolean;
}

/**
 * Best drives from (sx, sy) to (gx, gy). `sdir`: the heading the bus entered (sx, sy) in, -1 when it has none (a
 * building door, or a start with no past). The goal may be a building (the depot door): it is entered from a road
 * beside it. `want`: only a leg arriving in that heading. Without it the search goes on past the first arrival, by
 * up to `slack`, for arrivals in the other headings (the lap planner chooses among them).
 */
export function busLegs(
  net: BusNet, sx: number, sy: number, sdir: number, gx: number, gy: number,
  opts: { want?: number; avoid?: (x: number, y: number) => boolean; maxNodes?: number; slack?: number } = {},
): LegSearch {
  const w = net.w, maxNodes = opts.maxNodes ?? 20000, slack = opts.slack ?? 60, want = opts.want ?? -1;
  const legs: (BusLeg | null)[] = [null, null, null, null];
  const roadAt = (x: number, y: number) => { const t = w.peekTile(x, y); return t !== undefined && isRoad(t); };
  const goalRoad = roadAt(gx, gy);
  // how many arrival headings there can be: one per road beside the goal (a building goal: the first will do)
  let goalHeads = 0;
  if (goalRoad) { for (let d = 0; d < 4; d++) if (roadAt(gx - DIRS[d][0], gy - DIRS[d][1])) goalHeads++; } else goalHeads = 1;
  if (want >= 0) goalHeads = 1;
  // states: (tile key + layer * LAYER) * 8 + heading; per state its cost, parent, coordinates and how it was reached
  const g = new Map<number, number>(), parent = new Map<number, number>(), via = new Map<number, number>();
  const xs = new Map<number, number>(), ys = new Map<number, number>();
  const closed = new Set<number>();
  const heapK: number[] = [], heapF: number[] = [];
  const push = (k: number, f: number) => {
    heapK.push(k); heapF.push(f);
    let i = heapK.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= heapF[i]) break; [heapK[p], heapK[i]] = [heapK[i], heapK[p]]; [heapF[p], heapF[i]] = [heapF[i], heapF[p]]; i = p; }
  };
  const pop = (): [number, number] => {
    const k = heapK[0], f = heapF[0]; const lk = heapK.pop()!, lf = heapF.pop()!;
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
    return [k, f];
  };
  const h = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);
  const keyOf = (x: number, y: number, dx: number, head: number) => (tkey(x, y) + routeLayer(w.auxAt(x, y), dx) * LAYER) * 8 + head;
  /** reach state k at (x, y) with cost ng from state `from`; `how`: 0 forward, 1 a turn on the tile before, 2 via the depot */
  const reach = (k: number, x: number, y: number, ng: number, from: number, how: number) => {
    const old = g.get(k);
    if (old !== undefined && old <= ng) return;
    g.set(k, ng); parent.set(k, from); via.set(k, how); xs.set(k, x); ys.set(k, y);
    push(k, ng + h(x, y));
  };
  const start = (tkey(sx, sy) + LAYER * 2) * 8 + ANY; // a key no real state has
  xs.set(start, sx); ys.set(start, sy); g.set(start, 0);
  const sideways = (x: number, y: number, dx: number) => { const a = w.auxAt(x, y); return isBridgeAux(a) && bridgeNS(a) === (dx !== 0); };
  if (roadAt(sx, sy)) {
    const k = keyOf(sx, sy, sdir >= 0 ? DIRS[sdir][0] : 0, sdir >= 0 ? sdir : ANY);
    reach(k, sx, sy, 0, -1, 0);
  } else {
    for (let d = 0; d < 4; d++) {
      const nx = sx + DIRS[d][0], ny = sy + DIRS[d][1];
      if (!(nx === gx && ny === gy) && (!roadAt(nx, ny) || sideways(nx, ny, DIRS[d][0]))) continue;
      if (opts.avoid?.(nx, ny)) continue;
      reach(keyOf(nx, ny, DIRS[d][0], d), nx, ny, net.cost(nx, ny), start, 0);
    }
  }
  const auxFn = (x: number, y: number) => w.auxAt(x, y);
  let expanded = 0, found = 0, firstF = Infinity;
  const build = (k: number, cost: number, dir: number): BusLeg => {
    const rev: number[] = [], how: number[] = [];
    for (let c = k; c !== -1 && c !== start; c = parent.get(c)!) { rev.push(c); how.push(via.get(c)!); }
    const path: number[] = [];
    if (!roadAt(sx, sy) || rev.length === 0 || xs.get(rev[rev.length - 1]) !== sx || ys.get(rev[rev.length - 1]) !== sy) path.push(sx, sy);
    const turns: BusLeg['turns'] = [];
    for (let i = rev.length - 1; i >= 0; i--) {
      const s = rev[i], x = xs.get(s)!, y = ys.get(s)!;
      if (how[i] === 1) turns.push({ node: path.length / 2 - 1, kind: turnAt(net, path[path.length - 2], path[path.length - 1]) ?? 'junction' });
      if (how[i] === 2) { turns.push({ node: path.length / 2, kind: 'depot' }); path.push(net.depot![0], net.depot![1]); }
      path.push(x, y);
    }
    return { path, cost, dir, turns };
  };
  while (heapK.length && expanded < maxNodes) {
    const [k, f] = pop();
    if (closed.has(k)) continue;
    if (f > firstF + slack) break;
    closed.add(k); expanded++;
    const x = xs.get(k)!, y = ys.get(k)!, head = k % 8, gk = g.get(k)!;
    if (x === gx && y === gy && k !== start && (want < 0 || head === want) && !legs[head]) {
      legs[head] = build(k, gk, head);
      if (++found >= goalHeads) return { legs, exhausted: false };
      if (firstF === Infinity) firstF = f;
      // and on through it: the way to arrive in another heading may pass the stop first
    }
    if (!goalRoad && x === gx && y === gy) continue;
    const here = w.auxAt(x, y);
    // forward: any way but straight back
    for (let d = 0; d < 4; d++) {
      if (head !== ANY && d === OPP[head]) continue;
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (here >= STEP_RULE_AUX && !junctionStepOk(auxFn, x, y, nx, ny, head !== ANY ? DIRS[head][0] : 0, head !== ANY ? DIRS[head][1] : 0)) continue;
      const isGoal = nx === gx && ny === gy;
      if (!isGoal && (!roadAt(nx, ny) || sideways(nx, ny, DIRS[d][0]))) continue;
      if (!isGoal && opts.avoid?.(nx, ny)) continue;
      const ng = gk + (roadAt(nx, ny) ? net.cost(nx, ny) : 1) + (head !== ANY && d !== head ? 0.4 : 0);
      reach(keyOf(nx, ny, DIRS[d][0], d), nx, ny, ng, k, 0);
    }
    if (head === ANY) continue;
    // turn round here, back onto the tile we came from
    const kind = turnAt(net, x, y);
    const px = x - DIRS[head][0], py = y - DIRS[head][1], back = OPP[head];
    if (kind && roadAt(px, py) && !opts.avoid?.(px, py)) reach(keyOf(px, py, DIRS[back][0], back), px, py, gk + net.cost(px, py) + TURN_COST[kind], k, 1);
    // or in at the depot door beside this tile and out again
    const dp = net.depot;
    if (dp && Math.abs(dp[0] - x) + Math.abs(dp[1] - y) === 1 && !(dp[0] === gx && dp[1] === gy)) {
      const into = dp[0] > x ? 0 : dp[0] < x ? 1 : dp[1] > y ? 2 : 3;
      if (into !== back && here < STEP_RULE_AUX) reach(keyOf(x, y, DIRS[OPP[into]][0], OPP[into]), x, y, gk + 2 * net.cost(x, y) + TURN_COST.depot, k, 2);
    }
  }
  return { legs, exhausted: expanded >= maxNodes };
}

/** Is node i of a lap (wrapping round) a turn: the bus goes back to the tile it came from? */
export function isReversal(path: number[], i: number): boolean {
  const n = path.length / 2;
  if (n < 3) return false;
  const a = ((i - 1) % n + n) % n, b = (i + 1) % n;
  return path[a * 2] === path[b * 2] && path[a * 2 + 1] === path[b * 2 + 1];
}

// ---- a whole lap ----------------------------------------------------------------------------------------

/** Why segment `seg` (call seg to call seg + 1) could not be driven. */
export interface LapFail {
  seg: number;
  reason: 'same tile' | 'no road' | 'no turn' | 'too far';
  /** 'no road': land tiles a road over which would join the two streets, flat [x, y, …], from one side to the other */
  gap?: number[];
}
export interface LapPlan {
  /** the lap (complete when ok, else the segments before the failing one), flat [x, y, …] */
  path: number[];
  /** node index in path of each call reached */
  callNodes: number[];
  /** where the lap turns round, by node */
  turns: { node: number; kind: TurnKind }[];
  cost: number;
  fail?: LapFail;
}

/**
 * Route a lap through `tiles` (the road tile of each call, in calling order, back to the first): the cheapest way
 * round, over the heading the bus arrives in at each call (one search per call and heading, then a pass over them),
 * and the same heading at the first call at the end of the lap as at its start, so lap after lap joins up.
 */
export function planLap(net: BusNet, tiles: [number, number][]): LapPlan {
  const K = tiles.length;
  const memo = new Map<string, LegSearch>();
  const search = (k: number, head: number, want = -1) => {
    const key = `${k}:${head}:${want}`;
    let r = memo.get(key);
    if (!r) {
      const a = tiles[k], b = tiles[(k + 1) % K];
      r = busLegs(net, a[0], a[1], head, b[0], b[1], want >= 0 ? { want } : {});
      memo.set(key, r);
    }
    return r;
  };
  for (let k = 0; k < K; k++) {
    const a = tiles[k], b = tiles[(k + 1) % K];
    if (a[0] === b[0] && a[1] === b[1]) return { path: [], callNodes: [], turns: [], cost: 0, fail: { seg: k, reason: 'same tile' } };
  }
  const t0 = tiles[0];
  const heads0: number[] = [];
  for (let d = 0; d < 4; d++) { const t = net.w.peekTile(t0[0] - DIRS[d][0], t0[1] - DIRS[d][1]); if (t !== undefined && isRoad(t)) heads0.push(d); }
  interface Cand { cost: number; prev: number; leg: BusLeg | null }
  let best: { cost: number; dp: Map<number, Cand>[]; h0: number } | null = null;
  let stuck: { seg: number; dp: Map<number, Cand>[]; exhausted: boolean } | null = null;
  for (const h0 of heads0) {
    const dp: Map<number, Cand>[] = [new Map([[h0, { cost: 0, prev: -1, leg: null }]])];
    let ok = true, exhausted = false;
    for (let k = 0; k < K; k++) {
      const next = new Map<number, Cand>();
      for (const head of [...dp[k].keys()].sort()) {
        const c = dp[k].get(head)!;
        const r = search(k, head, k === K - 1 ? h0 : -1);
        exhausted ||= r.exhausted;
        r.legs.forEach((leg, h2) => {
          if (!leg) return;
          const tot = c.cost + leg.cost, cur = next.get(h2);
          if (!cur || tot < cur.cost - 1e-9) next.set(h2, { cost: tot, prev: head, leg });
        });
      }
      if (!next.size) { ok = false; if (!stuck || k > stuck.seg) stuck = { seg: k, dp, exhausted }; break; }
      dp.push(next);
    }
    if (!ok) continue;
    const end = dp[K].get(h0)!;
    if (!best || end.cost < best.cost - 1e-9) best = { cost: end.cost, dp, h0 };
  }
  // join the legs: walk back from the end through each step's best heading
  const join = (dp: Map<number, Cand>[], upTo: number, endHead: number) => {
    const legs: BusLeg[] = [];
    let head = endHead;
    for (let k = upTo; k > 0; k--) { const c = dp[k].get(head)!; legs.unshift(c.leg!); head = c.prev; }
    const path: number[] = [], callNodes: number[] = [], turns: LapPlan['turns'] = [];
    for (const leg of legs) {
      callNodes.push(path.length / 2);
      const base = path.length / 2;
      for (const t of leg.turns) turns.push({ node: base + t.node, kind: t.kind });
      for (let i = 0; i < leg.path.length - 2; i += 2) path.push(leg.path[i], leg.path[i + 1]); // the last node is the next call's first
    }
    return { path, callNodes, turns };
  };
  if (best) return { ...join(best.dp, K, best.h0), cost: best.cost };
  // failed: the lap as far as it got, and why the next segment could not be driven
  if (!stuck) return { path: [], callNodes: [], turns: [], cost: 0, fail: { seg: 0, reason: 'no road' } };
  const at = stuck.dp[stuck.seg];
  let endHead = -1, endCost = Infinity;
  for (const [hd, c] of at) if (c.cost < endCost) { endCost = c.cost; endHead = hd; }
  const part = stuck.seg > 0 ? join(stuck.dp, stuck.seg, endHead) : { path: [], callNodes: [], turns: [] };
  if (stuck.seg > 0) { const t = tiles[stuck.seg]; part.path.push(t[0], t[1]); part.callNodes.push(part.path.length / 2 - 1); }
  const a = tiles[stuck.seg], b = tiles[(stuck.seg + 1) % K];
  const joined = roadsJoin(net.w, a, b);
  const fail: LapFail = joined === false ? { seg: stuck.seg, reason: 'no road', gap: joinGap(net.w, a, b) ?? undefined }
    : { seg: stuck.seg, reason: stuck.exhausted || joined === null ? 'too far' : 'no turn' };
  return { ...part, cost: 0, fail };
}

// ---- diagnostics ------------------------------------------------------------------------------------------

/** Road tiles joined to (x, y) over road (step rules aside), up to `limit`; `full` false when the limit cut it short. */
function roadsFrom(w: World, x: number, y: number, limit: number): { set: Set<number>; full: boolean } {
  const set = new Set<number>(), q: number[] = [x, y];
  const road = (a: number, b: number) => { const t = w.peekTile(a, b); return t !== undefined && isRoad(t); };
  if (!road(x, y)) return { set, full: true };
  set.add(tkey(x, y));
  for (let i = 0; i < q.length; i += 2) {
    if (set.size >= limit) return { set, full: false };
    for (const [dx, dy] of DIRS) {
      const nx = q[i] + dx, ny = q[i + 1] + dy, k = tkey(nx, ny);
      if (set.has(k) || !road(nx, ny)) continue;
      set.add(k); q.push(nx, ny);
    }
  }
  return { set, full: true };
}
/** Are road tiles a and b joined by road? Null when the network is too big to tell quickly. */
export function roadsJoin(w: World, a: [number, number], b: [number, number]): boolean | null {
  const r = roadsFrom(w, a[0], a[1], 60000);
  if (r.set.has(tkey(b[0], b[1]))) return true;
  return r.full ? false : null;
}
/**
 * The shortest strip of land (flat [x, y, …], from a's side) a road over which would join the roads at a to the roads at b, within
 * `radius` tiles of the smaller network: open land first, then over lots if that is the only way. Null when none is near.
 */
export function joinGap(w: World, a: [number, number], b: [number, number], radius = 40): number[] | null {
  let A = roadsFrom(w, a[0], a[1], 20000), B = roadsFrom(w, b[0], b[1], 20000);
  if (!A.full && !B.full) return null;
  const swap = !A.full || (B.full && B.set.size < A.set.size);
  if (swap) [A, B] = [B, A]; // search out from the smaller network, A
  const other = (k: number) => (B.full ? B.set.has(k) : !A.set.has(k));
  for (const openOnly of [true, false]) {
    const dist = new Map<number, number>(), from = new Map<number, number>(), q: number[] = [];
    for (const k of A.set) { const x = Math.floor(k / 65536) - 0x8000, y = (k % 65536) - 0x8000; q.push(x, y); dist.set(k, 0); }
    for (let i = 0; i < q.length && i < 400000; i += 2) {
      const x = q[i], y = q[i + 1], k = tkey(x, y), d = dist.get(k)!;
      if (d >= radius) continue;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, nk = tkey(nx, ny);
        if (dist.has(nk)) continue;
        const t = w.peekTile(nx, ny);
        if (t === undefined) continue;
        if (isRoad(t)) {
          if (!other(nk) || d === 0) continue; // two roads side by side would already be joined
          const strip: number[] = [];
          for (let c: number | undefined = k; c !== undefined && !A.set.has(c); c = from.get(c)) strip.unshift(Math.floor(c / 65536) - 0x8000, (c % 65536) - 0x8000);
          if (swap) for (let i = 0, j = strip.length - 2; i < j; i += 2, j -= 2) { [strip[i], strip[j]] = [strip[j], strip[i]]; [strip[i + 1], strip[j + 1]] = [strip[j + 1], strip[i + 1]]; }
          return strip; // from a's side to b's
        }
        if (terrainOf(t) === Terrain.Water || w.auxAt(nx, ny) || (openOnly && zoneOf(t) !== 0)) continue;
        dist.set(nk, d + 1); if (!A.set.has(k)) from.set(nk, k); q.push(nx, ny);
      }
    }
  }
  return null;
}
