import { ROAD_COST, PUBLIC_ROAD_COST, BULLDOZE_COST } from './constants';
import { Terrain, isRoad, terrainOf, zoneOf, levelOf, underConstruction, isCivicId, KIND_NAMES } from './tile';
import { planBridge, joinsBridgeSide, type BridgePlan } from './bridges';
import { isRailAux, roadOverTrackProblem, CROSSING_COST } from './rail';
import { isAirfieldAux } from './airport';
import { isJunctionAux, isRingAux, isIslandAux } from './junctions';

/**
 * The road tool (docs/roads.md "The road tool"): the shape a drag lays, and what each tile of it will be, with its
 * cost and, for anything refused, the reason. The client draws its ghost from planRoad on the loaded chunks; the
 * server lays from the same plan and is the authority (as checkPurchase and planTrack are shared).
 */

/** Longest road drag, in tiles (the server reads no more of a message). */
export const ROAD_DRAG_MAX = 256;
/** How long after a drag Ctrl/Cmd+Z can take it back (real milliseconds), if its tiles are still bare road. */
export const ROAD_UNDO_MS = 30_000;

/**
 * Road classes. Class 0 is the street every road is today; R3 (classes) adds the country lane, one-way street,
 * avenue, motorway and pedestrian street, each with its own aux byte (0x01-0x3f, docs/aux-layer.md), cost and drawing.
 * The tool and the intent already carry a class, and dragging a class over a road of another class upgrades it in
 * place (keeping its junctions), so R3 only fills in this table and roadClassAt.
 */
export interface RoadClass { id: number; name: string; /** per tile on the player's own land; unclaimed land adds the public premium */ cost: number }
export const ROAD_CLASSES: readonly RoadClass[] = [{ id: 0, name: 'street', cost: ROAD_COST }];
export const isRoadClass = (cls: number) => Number.isInteger(cls) && cls >= 0 && cls < ROAD_CLASSES.length;
/** The class of the road on a tile. Every road is a street (0) until R3 gives classes their aux bytes. */
export const roadClassAt = (_tile: number, _aux: number) => 0;
/** What upgrading a tile from one class to another costs (the difference, never negative). */
export const roadUpgradeCost = (from: number, to: number) => Math.max(0, (ROAD_CLASSES[to]?.cost ?? 0) - (ROAD_CLASSES[from]?.cost ?? 0));

// ---- shapes ---------------------------------------------------------------------------------------------

/** 'line': straight, or one corner like track; 'loop': the four sides of the rectangle between the two corners. */
export type RoadShape = 'line' | 'loop';

/**
 * The tiles a drag from `a` to `b` lays, in order. A line runs along its first axis then the other, so it turns at
 * most one corner; `firstAlongX` picks the first axis (the way the drag first left `a`), else the longer one goes
 * first. A loop goes round the rectangle from `a` and back to the tile before it. At most ROAD_DRAG_MAX tiles.
 */
export function roadDragPath(a: readonly [number, number], b: readonly [number, number], shape: RoadShape = 'line', firstAlongX?: boolean): [number, number][] {
  const out: [number, number][] = [[a[0], a[1]]];
  let x = a[0], y = a[1];
  const to = (tx: number, ty: number) => {
    while ((x !== tx || y !== ty) && out.length < ROAD_DRAG_MAX) {
      if (x !== tx) x += Math.sign(tx - x); else y += Math.sign(ty - y);
      out.push([x, y]);
    }
  };
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (shape === 'loop' && dx !== 0 && dy !== 0) {
    to(b[0], a[1]); to(b[0], b[1]); to(a[0], b[1]); to(a[0], a[1] + Math.sign(dy));
    return out;
  }
  const xFirst = firstAlongX ?? Math.abs(dx) >= Math.abs(dy);
  if (xFirst) { to(b[0], a[1]); to(b[0], b[1]); } else { to(a[0], b[1]); to(b[0], b[1]); }
  return out;
}

/**
 * Snap a drag's end onto a road one tile beyond it: when the last tile is not road, the tile after it (along the last
 * step) is bare dry land and the one after that is road, the path gains that one tile and joins the road. A drag that
 * stops one short of a street meets it.
 */
export function snapRoadEnd(path: [number, number][], isRoadAt: (x: number, y: number) => boolean, isDryAt: (x: number, y: number) => boolean): [number, number][] {
  if (path.length < 2 || path.length >= ROAD_DRAG_MAX) return path;
  const [ex, ey] = path[path.length - 1], [px, py] = path[path.length - 2];
  const dx = ex - px, dy = ey - py;
  if (isRoadAt(ex, ey) || isRoadAt(ex + dx, ey + dy) || !isDryAt(ex + dx, ey + dy) || !isRoadAt(ex + 2 * dx, ey + 2 * dy)) return path;
  return [...path, [ex + dx, ey + dy]];
}

// ---- the plan -------------------------------------------------------------------------------------------

export interface RoadEnv {
  tile(x: number, y: number): number | undefined;
  aux(x: number, y: number): number;
  /** the kind id on a tile (sub layer aware), for naming a building in the way */
  kindId(x: number, y: number): number;
  /** null when the player may lay road here (their own land, or unclaimed land with Public works), else why not */
  land(x: number, y: number): string | null;
  /** someone's parcel (a road on unclaimed land costs the public premium) */
  claimed(x: number, y: number): boolean;
  /** the multi-tile structure covering (x, y), by kind name; a structure is never paved over (bulldoze it first) */
  structure(x: number, y: number): string | undefined;
  /** the technology the player still needs to bridge water, or null */
  bridgeLock: string | null;
  /** the class of the road on a tile; roadClassAt (every road a street) when left out */
  roadClass?(x: number, y: number): number;
}
export interface RoadPlanOpts {
  /** the road class to lay (ROAD_CLASSES); 0 by default */
  cls?: number;
  /** the player said yes to demolishing the buildings in the way; otherwise the road goes round them */
  demolish?: boolean;
  /** what the player can spend (money and the overdraft); tiles past it are refused. Unlimited when left out */
  budget?: number;
}
/**
 * - new: road laid on bare land, a zoned lot or a growth site (as before: what was there goes)
 * - have: road already, kept as it is (its junctions too)
 * - upgrade: road of another class, upgraded in place (R3)
 * - bridge: a deck tile of a crossing (see RoadPlan.bridges)
 * - demolish: a building stands here; laid only when the player agrees (RoadPlanOpts.demolish), else left standing
 * - refused: not laid; `reason` says why
 */
export type RoadTileState = 'new' | 'have' | 'upgrade' | 'bridge' | 'demolish' | 'refused';
export interface RoadTile {
  x: number; y: number; state: RoadTileState;
  /** what this tile costs (a bridge's deck tiles are costed on the bridge) */
  cost: number;
  reason?: string;
  /** on unclaimed land: the public premium */
  unclaimed?: boolean;
  /** demolish: the kind id of the building in the way, and whether it is still being built */
  kind?: number; site?: boolean;
}
export interface RoadPlan {
  tiles: RoadTile[];
  /** each run of water in the drag: the bridge it makes (planBridge), or why not */
  bridges: { run: [number, number][]; plan: BridgePlan; dx: number; dy: number }[];
  /** what the drag costs as it would be laid (demolition included only when agreed) */
  cost: number;
  /** tiles of new road (land and deck) */
  fresh: number;
  /** of the new land tiles, those on unclaimed land */
  unclaimed: number;
  /** buildings in the way: how many, what laying over them costs (road and demolition), and their kind ids */
  demolish: { n: number; cost: number; kinds: number[] };
  /** tiles refused, and the first reason given */
  refused: number;
  reason?: string;
  /** tiles refused only for want of money */
  short: number;
  /** tiles already road of the class asked for */
  have: number;
  upgrade: number;
}
export const MSG_ROAD_MONEY = 'Not enough money';
export const MSG_ROAD_SIDE = 'No road may join a bridge from the side: bridges meet roads only at their ends';

/**
 * A building in the road's way: anything standing (level above 0: homes, works, civic buildings, parks, parking, bus
 * stops) or a civic building still being built (the player paid for it). An empty zoned lot and a growth site are
 * paved over as before.
 */
export function roadBlockedBy(t: number, kindId: number): boolean {
  if (isRoad(t) || zoneOf(t) === 0) return false;
  return levelOf(t) > 0 || (underConstruction(t) && isCivicId(kindId));
}

/** Everything a road drag along `path` (4-adjacent steps, in order) would do: see RoadTile and RoadPlan. */
export function planRoad(path: readonly (readonly [number, number])[], env: RoadEnv, opts: RoadPlanOpts = {}): RoadPlan {
  const cls = opts.cls ?? 0;
  const plan: RoadPlan = { tiles: [], bridges: [], cost: 0, fresh: 0, unclaimed: 0, demolish: { n: 0, cost: 0, kinds: [] }, refused: 0, short: 0, have: 0, upgrade: 0 };
  const seen = new Set<string>();
  const wet: number[] = []; // indices into plan.tiles of water tiles, in drag order
  for (const [x, y] of path.slice(0, ROAD_DRAG_MAX)) {
    const k = `${x},${y}`;
    if (seen.has(k)) continue; // a loop's last side meets its first: each tile once
    seen.add(k);
    const t = env.tile(x, y);
    const tp: RoadTile = { x, y, state: 'refused', cost: 0 };
    plan.tiles.push(tp);
    if (t === undefined) { tp.reason = 'Not loaded yet'; continue; }
    if (terrainOf(t) === Terrain.Water) { tp.state = 'bridge'; wet.push(plan.tiles.length - 1); continue; }
    const a = env.aux(x, y);
    if (isRoad(t)) {
      if (isAirfieldAux(a)) { tp.reason = 'That is part of a runway; bulldoze it first'; continue; }
      const from = env.roadClass ? env.roadClass(x, y) : roadClassAt(t, a);
      if (from === cls) { tp.state = 'have'; continue; }
      tp.state = 'upgrade'; tp.cost = roadUpgradeCost(from, cls); // junction tiles keep their junction: only the class changes
      continue;
    }
    if (a && !isRailAux(a)) {
      if (isAirfieldAux(a)) tp.reason = 'That is part of a runway; bulldoze it first';
      else if (isJunctionAux(a)) tp.reason = `That is part of a ${isRingAux(a) || isIslandAux(a) ? 'roundabout' : 'flyover'}; bulldoze it first`;
      else { const s = env.structure(x, y); if (s) tp.reason = `That is part of a ${s}; bulldoze it first`; }
      if (tp.reason) continue;
    }
    const why = env.land(x, y);
    if (why) { tp.reason = why; continue; }
    if (joinsBridgeSide(x, y, env.aux)) { tp.reason = MSG_ROAD_SIDE; continue; }
    const xing = roadOverTrackProblem(env, x, y);
    if (xing) { tp.reason = xing; continue; }
    tp.unclaimed = !env.claimed(x, y);
    tp.cost = (tp.unclaimed ? PUBLIC_ROAD_COST - ROAD_COST : 0) + (ROAD_CLASSES[cls]?.cost ?? ROAD_COST) + (isRailAux(a) ? CROSSING_COST : 0);
    const kind = env.kindId(x, y);
    if (roadBlockedBy(t, kind)) {
      tp.state = 'demolish'; tp.kind = kind; tp.site = underConstruction(t);
      tp.cost += levelOf(t) > 0 ? BULLDOZE_COST : 0;
    } else tp.state = 'new';
  }

  // water: each run of wet tiles in drag order is one crossing, laid after the land so its banks are road by then
  const planned = new Set<string>();
  for (const tp of plan.tiles) if (tp.state === 'new' || (tp.state === 'demolish' && opts.demolish)) planned.add(`${tp.x},${tp.y}`);
  const bankEnv = {
    tile: (x: number, y: number) => { const t = env.tile(x, y); return t !== undefined && planned.has(`${x},${y}`) ? t | 4 : t; },
    aux: env.aux, land: env.land,
  };
  for (let i = 0; i < wet.length;) {
    let j = i + 1;
    while (j < wet.length && wet[j] === wet[j - 1] + 1) j++;
    const run = wet.slice(i, j).map((n) => plan.tiles[n]);
    i = j;
    const [x0, y0] = [run[0].x, run[0].y];
    let dx = 0, dy = 0;
    if (run.length > 1) { dx = run[1].x - x0; dy = run[1].y - y0; }
    else {
      // one tile of water: the way the drag went through it, else whichever axis has road on both banks
      const at = plan.tiles.indexOf(run[0]), nb = plan.tiles[at + 1] ?? plan.tiles[at - 1];
      if (nb) { dx = Math.abs(nb.x - x0); dy = Math.abs(nb.y - y0); }
      if (dx + dy !== 1) {
        const road = (x: number, y: number) => { const t = bankEnv.tile(x, y); return t !== undefined && isRoad(t); };
        const ew = road(x0 - 1, y0) && road(x0 + 1, y0);
        dx = ew ? 1 : 0; dy = ew ? 0 : 1;
      }
    }
    let bp: BridgePlan;
    if (env.bridgeLock) bp = { ok: false, reason: `${env.bridgeLock} is needed to bridge water` };
    else if (run.some((r, n) => n > 0 && (r.x - run[n - 1].x !== dx || r.y - run[n - 1].y !== dy))) bp = { ok: false, reason: 'A bridge runs straight across the water: no bends or junctions on it' };
    else bp = planBridge(x0, y0, dx, dy, run.length, bankEnv);
    plan.bridges.push({ run: run.map((r) => [r.x, r.y]), plan: bp, dx, dy });
    for (const r of run) if (!bp.ok) { r.state = 'refused'; r.reason = bp.reason; }
  }

  // money, in drag order: once the budget runs out, the rest of the drag is refused (a bridge counts at its first tile)
  let left = opts.budget ?? Infinity, broke = false;
  const bridgeAt = new Map<RoadTile, RoadPlan['bridges'][number]>();
  for (const b of plan.bridges) if (b.plan.ok) { const first = plan.tiles.find((t) => t.x === b.run[0][0] && t.y === b.run[0][1]); if (first) bridgeAt.set(first, b); }
  for (const tp of plan.tiles) {
    const b = bridgeAt.get(tp);
    const cost = b ? b.plan.cost ?? 0 : tp.state === 'demolish' && !opts.demolish ? 0 : tp.cost;
    if (!cost) continue;
    if (broke || cost > left) {
      broke = true;
      if (b) { for (const [bx, by] of b.run) { const r = plan.tiles.find((t) => t.x === bx && t.y === by)!; r.state = 'refused'; r.reason = MSG_ROAD_MONEY; plan.short++; } b.plan = { ok: false, reason: MSG_ROAD_MONEY }; }
      else { tp.state = 'refused'; tp.reason = MSG_ROAD_MONEY; plan.short++; }
      continue;
    }
    left -= cost;
  }

  for (const tp of plan.tiles) {
    if (tp.state === 'new') { plan.cost += tp.cost; plan.fresh++; if (tp.unclaimed) plan.unclaimed++; }
    else if (tp.state === 'have') plan.have++;
    else if (tp.state === 'upgrade') { plan.cost += tp.cost; plan.upgrade++; }
    else if (tp.state === 'demolish') {
      plan.demolish.n++; plan.demolish.cost += tp.cost; plan.demolish.kinds.push(tp.kind!);
      if (opts.demolish) { plan.cost += tp.cost; plan.fresh++; if (tp.unclaimed) plan.unclaimed++; }
    } else if (tp.state === 'refused') { plan.refused++; plan.reason ??= tp.reason; }
  }
  for (const b of plan.bridges) if (b.plan.ok) { plan.cost += b.plan.cost ?? 0; plan.fresh += (b.plan.tiles?.length ?? 0) / 3; }
  return plan;
}

/** "a hospital", "2 homes and a police station": the buildings a drag would demolish, for the question and the toast. */
export function describeDemolition(kinds: readonly number[]): string {
  const by = new Map<string, number>();
  for (const k of kinds) { const n = (KIND_NAMES[k] ?? 'building').toLowerCase(); by.set(n, (by.get(n) ?? 0) + 1); }
  const parts = [...by].map(([name, n]) => (n === 1 ? `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}` : `${n} ${name.endsWith('s') ? name : `${name}s`}`));
  return parts.length <= 1 ? parts[0] ?? '' : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---- the spacing guide ----------------------------------------------------------------------------------

/**
 * The block a straight stretch of new road makes with the nearest road parallel to it (the spacing guide): from the
 * stretch's tiles, look out sideways up to `reach` tiles on each side for road that runs alongside for at least two
 * tiles of the stretch. Returns the nearest: the side (+1 or -1 across), the gap in tiles between the two roads (the
 * block's depth) and the road's offset; null when nothing is near.
 */
export function parallelGap(line: readonly (readonly [number, number])[], isRoadAt: (x: number, y: number) => boolean, reach = 12): { side: 1 | -1; depth: number; offset: number } | null {
  if (line.length < 2) return null;
  const alongX = line[0][1] === line[line.length - 1][1];
  const ax = alongX ? 0 : 1, ay = alongX ? 1 : 0; // across
  let best: { side: 1 | -1; depth: number; offset: number } | null = null;
  for (const side of [1, -1] as const) {
    for (let d = 2; d <= reach; d++) {
      if (best && d >= best.offset) break;
      let n = 0;
      for (const [x, y] of line) if (isRoadAt(x + ax * side * d, y + ay * side * d)) n++;
      if (n >= Math.min(2, line.length)) { best = { side, depth: d - 1, offset: d }; break; }
      // a road nearer than d that is not alongside (a crossing street) does not count; keep looking outwards
    }
  }
  return best;
}
