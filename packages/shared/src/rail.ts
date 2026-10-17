import { Zone } from './buildings/codes';
import { KIND_ID } from './buildings/compiled';
import { isRoad, zoneOf, levelOf, underConstruction, isBuildable, isGrowableId, kindIdOf } from './tile';
import { FRONT, structureAt, type Placed } from './structures';
import { hash2 } from './noise';
import { TICKS_PER_DAY, TICKS_PER_HOUR, gameMin } from './constants';

/**
 * Railways (docs/rail.md). Three things a player builds, and one thing they define:
 *
 *  - **track**, painted by dragging (straight runs, L-shaped drags, several drags). A track tile is kind None (not a
 *    road, not a building) and carries a **rail aux byte** 0xe0 | mask, where the mask's bits are the sides the
 *    track leaves the tile by: N (-y) 1, E (+x) 2, S (+y) 4, W (-x) 8. The piece drawn (straight, curve, end,
 *    junction, crossing) follows from the mask, and connections exist only where a drag ran, so two tracks laid
 *    side by side stay apart. Track never crosses water; it crosses a straight road at right angles on a **level
 *    crossing**: a road tile carrying a straight rail aux byte (below), with barriers that close ahead of each train.
 *  - **stations**, multi-tile Hub-family kinds (buildings/rail.ts): a 4×2 halt and a 6×3 station. The door faces
 *    a road; the back row is the platform, and the track runs along the row just behind it, the station's whole
 *    width. A station is "on the line" when that row is connected track.
 *  - **lines**: an owner picks stations in order, a number, a colour, trains and carriages, there-and-back or loop.
 *    The server finds the route through the track (`routeLine`, a breadth-first search over (tile, heading)), and
 *    refuses a line whose consecutive stations are not connected or whose track another line already uses (v1 has
 *    no signals, so no shared track).
 *
 * Trains are a **pure function of (line, route, tick)** (`railService`, `trainsAt`): every client and the server
 * compute the same positions, so nothing per train goes over the wire, only the line definitions with their
 * routes (the 'railLines' message). Trains are spaced by a headway along the line, accelerate out of and brake into
 * every station, dwell there, reverse at the ends (there-and-back) or run round (loop), and run 05:00-01:00.
 */

// ---- aux encoding ---------------------------------------------------------------------------------
export const RAIL_AUX = 0xe0;
export const isRailAux = (a: number) => (a & 0xf0) === RAIL_AUX;
export const railMask = (a: number) => a & 15;
export const railAux = (mask: number) => RAIL_AUX | (mask & 15);
/**
 * A **level crossing** is a road tile (the tile word keeps its road bit) carrying a rail aux byte whose mask is a
 * straight, 5 (track north-south, road east-west) or 10 (track east-west, road north-south). No other tile has a
 * road and a rail byte, so worlds from before crossings mean what they meant. The road through it stays straight:
 * its two road neighbours are across the track, the tiles along the track are track.
 */
export const isCrossing = (tile: number | undefined, aux: number) => tile !== undefined && isRoad(tile) && isRailAux(aux);
/** sides in mask-bit order: 0 N (-y), 1 E (+x), 2 S (+y), 3 W (-x) */
export const RAIL_SIDES: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const oppSide = (s: number) => (s + 2) & 3;
const sideTo = (dx: number, dy: number) => (dy < 0 ? 0 : dx > 0 ? 1 : dy > 0 ? 2 : 3);
const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/** price per new track tile */
export const RAIL_COST = 15;
/** longest drag the server takes in one go */
export const RAIL_DRAG_MAX = 160;

// ---- kinds ----------------------------------------------------------------------------------------
export const RAIL_HALT: number = (KIND_ID as Record<string, number>)['rail-halt'] ?? 18;
export const RAIL_STATION: number = (KIND_ID as Record<string, number>)['rail-station'] ?? 19;
export const RAIL_YARD: number = (KIND_ID as Record<string, number>)['freight-yard'] ?? 20;
/** anything trains stop at: halts and stations (passengers) and freight yards */
export const isRailStationKind = (id: number) => id === RAIL_HALT || id === RAIL_STATION || id === RAIL_YARD;
export const isFreightYardKind = (id: number) => id === RAIL_YARD;
/** industry within this many tiles (Manhattan) of a freight yard can send its freight by rail */
export const YARD_CATCHMENT = 12;
/** paid by the shipper to the freight line's owner per container carried */
export const RAIL_FREIGHT_FEE = 4;

/** What rail code may read: tiles (undefined where not loaded), aux bytes and sub bytes. */
export interface RailEnv {
  tile(x: number, y: number): number | undefined;
  aux(x: number, y: number): number;
  sub(x: number, y: number): number;
}
export interface RailPaintEnv extends RailEnv {
  /** may this player lay track on (x, y)? a refusal reason, or null when fine */
  land(x: number, y: number): string | null;
}

/** Extra for a level crossing over the track's own cost: barriers, lights and the panels between the rails. */
export const CROSSING_COST = 150;

/** The track mask at a tile (0 = no track). */
export const trackAt = (env: Pick<RailEnv, 'aux'>, x: number, y: number) => { const a = env.aux(x, y); return isRailAux(a) ? railMask(a) : -1; };

// ---- painting track -------------------------------------------------------------------------------
export interface TrackPlan {
  ok: boolean;
  reason?: string;
  /** flat x, y, aux for every tile whose byte changes (new track and existing tiles that gain a connection) */
  tiles?: number[];
  /** new track tiles (what the paint costs), of which `crossings` are level crossings over a road */
  fresh?: number;
  crossings?: number;
  cost?: number;
  /** the dragged path, for previews */
  path: [number, number][];
}

/**
 * The path a drag from `a` to `b` lays: along the longer axis first, then the other (an L), so a drag can turn one
 * corner. Both ends are included.
 */
export function trackDragPath(a: [number, number], b: [number, number], firstAlongX?: boolean): [number, number][] {
  const out: [number, number][] = [];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const xFirst = firstAlongX ?? Math.abs(dx) >= Math.abs(dy);
  let x = a[0], y = a[1];
  out.push([x, y]);
  const run = (alongX: boolean) => {
    const n = Math.abs(alongX ? b[0] - x : b[1] - y), s = Math.sign(alongX ? b[0] - x : b[1] - y);
    for (let i = 0; i < n && out.length < RAIL_DRAG_MAX; i++) { if (alongX) x += s; else y += s; out.push([x, y]); }
  };
  run(xFirst); run(!xFirst);
  return out;
}

/**
 * Plan track along a path of 4-adjacent tiles: every consecutive pair is joined, tiles that already carry track
 * gain the connection, new tiles must be dry, clear land (an empty zoned lot is paved over) the player may use.
 * The client previews with this and the server lays with it.
 */
export function planTrack(path: readonly [number, number][], env: RailPaintEnv): TrackPlan {
  const pts: [number, number][] = [];
  const seen = new Set<string>();
  for (const p of path) {
    const k = `${p[0]},${p[1]}`;
    if (seen.has(k)) return { ok: false, reason: 'Track cannot run over itself in one drag', path: pts };
    seen.add(k); pts.push([p[0], p[1]]);
  }
  if (!pts.length) return { ok: false, reason: 'Drag along the ground to lay track', path: pts };
  if (pts.length > RAIL_DRAG_MAX) return { ok: false, reason: `Lay at most ${RAIL_DRAG_MAX} tiles of track at a time`, path: pts };
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]) !== 1) return { ok: false, reason: 'Track runs tile to tile along x or y', path: pts };
  }
  const masks = new Map<string, number>();
  const join = (i: number, j: number) => {
    const s = sideTo(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
    const k = `${pts[i][0]},${pts[i][1]}`;
    masks.set(k, (masks.get(k) ?? 0) | (1 << s));
  };
  for (let i = 0; i < pts.length; i++) { if (i > 0) join(i, i - 1); if (i + 1 < pts.length) join(i, i + 1); }
  const tiles: number[] = [];
  let fresh = 0, crossings = 0;
  for (const [x, y] of pts) {
    const t = env.tile(x, y);
    if (t === undefined) return { ok: false, reason: 'That land is not loaded yet', path: pts };
    const add = masks.get(`${x},${y}`) ?? 0;
    const have = env.aux(x, y);
    const why = env.land(x, y);
    if (isRailAux(have)) {
      if (why) return { ok: false, reason: why, path: pts };
      const m = railMask(have) | add;
      if (m !== railMask(have) && isRoad(t)) return { ok: false, reason: `A level crossing (at ${x}, ${y}) takes straight track only`, path: pts };
      if (m !== railMask(have)) tiles.push(x, y, railAux(m));
      continue;
    }
    if (!isBuildable(t)) return { ok: false, reason: `Track cannot cross water (at ${x}, ${y}); bridges come later`, path: pts };
    if (isRoad(t)) {
      const bad = crossingProblem(env, x, y, add);
      if (bad) return { ok: false, reason: bad, path: pts };
      if (why) return { ok: false, reason: why, path: pts };
      tiles.push(x, y, railAux(add));
      fresh++; crossings++;
      continue;
    }
    const z = zoneOf(t);
    if (have || (z !== Zone.None && (!isGrowableId(kindIdOf(z, env.sub(x, y))) || levelOf(t) > 0 || underConstruction(t)))) return { ok: false, reason: `Track needs clear land (something stands at ${x}, ${y})`, path: pts };
    if (why) return { ok: false, reason: why, path: pts };
    tiles.push(x, y, railAux(add));
    fresh++;
  }
  return { ok: true, tiles, fresh, crossings, cost: fresh * RAIL_COST + crossings * CROSSING_COST, path: pts };
}

const SIDE_NAMES = ['north', 'east', 'south', 'west'];
/**
 * Why track with the sides `mask` may not cross the road tile (x, y), or null: the track must run straight through
 * (not start, end or turn there), the road must be a plain straight road across it (no junction, corner, roundabout
 * or flyover; the tiles along the track must not be road, so two crossings never touch along a line), and the road
 * must not end there.
 */
export function crossingProblem(env: Pick<RailEnv, 'tile' | 'aux'>, x: number, y: number, mask: number): string | null {
  if (mask !== 5 && mask !== 10) return `Track crosses a road (at ${x}, ${y}) only straight over it, not starting, ending or turning there`;
  if (env.aux(x, y)) return `Track cannot cross a roundabout or flyover (at ${x}, ${y})`;
  for (let s = 0; s < 4; s++) {
    const t = env.tile(x + RAIL_SIDES[s][0], y + RAIL_SIDES[s][1]);
    const road = t !== undefined && isRoad(t);
    if (mask & (1 << s)) { if (road) return `A level crossing (at ${x}, ${y}) goes on a straight road, not at a junction or a corner (road to the ${SIDE_NAMES[s]})`; }
    else if (!road) return `A level crossing (at ${x}, ${y}) needs the road to carry on across the track (none to the ${SIDE_NAMES[s]})`;
  }
  return null;
}
/**
 * Why a road may not be laid on (x, y), as far as track goes, or null: on a track tile it makes a level crossing,
 * which needs straight track with no road along it; next to a level crossing it must not join the crossing from
 * along its track (that would make a junction on the rails).
 */
export function roadOverTrackProblem(env: Pick<RailEnv, 'tile' | 'aux'>, x: number, y: number): string | null {
  const a = env.aux(x, y);
  if (isRailAux(a)) {
    const m = railMask(a);
    if (m !== 5 && m !== 10) return 'A road crosses railway track only where the track runs straight, at right angles';
    for (let s = 0; s < 4; s++) {
      if (!(m & (1 << s))) continue;
      const t = env.tile(x + RAIL_SIDES[s][0], y + RAIL_SIDES[s][1]);
      if (t !== undefined && isRoad(t)) return 'A level crossing goes on a straight road: there is road along the track here';
    }
  }
  for (let s = 0; s < 4; s++) {
    const nx = x + RAIL_SIDES[s][0], ny = y + RAIL_SIDES[s][1], na = env.aux(nx, ny);
    if (isCrossing(env.tile(nx, ny), na) && (railMask(na) & (1 << oppSide(s)))) return 'A road may not join a level crossing along its track';
  }
  return null;
}

// ---- stations -------------------------------------------------------------------------------------
/** Where a station's trains stop: the track row behind the platform. */
export interface StationStop {
  /** the station's door: its identity on a line */
  doorX: number; doorY: number;
  /** true when the platform runs along x */
  alongX: boolean;
  /** the track row's perpendicular coordinate, and its span along the platform (inclusive) */
  row: number; a0: number; a1: number;
  /** platform length in tiles */
  len: number;
}
export function stationStop(p: Placed): StationStop {
  const o = p.r;
  const back = o === 0 ? p.ay : o === 2 ? p.ay + p.h - 1 : o === 1 ? p.ax : p.ax + p.w - 1;
  const bs = o & 1 ? FRONT[o][0] : FRONT[o][1]; // the way from the platform towards the road
  const alongX = (o & 1) === 0;
  const a0 = alongX ? p.ax : p.ay, a1 = alongX ? p.ax + p.w - 1 : p.ay + p.h - 1;
  return { doorX: p.doorX, doorY: p.doorY, alongX, row: back - bs, a0, a1, len: a1 - a0 + 1 };
}
export const stopTile = (s: StationStop, a: number): [number, number] => (s.alongX ? [a, s.row] : [s.row, a]);
/** side a train leaves a row tile by when moving towards +along (E or S) or -along (W or N) */
export const alongSide = (s: StationStop, dir: 1 | -1) => (s.alongX ? (dir > 0 ? 1 : 3) : (dir > 0 ? 2 : 0));

/** The rail station whose door is at (x, y) (or that covers (x, y)), or null. */
export function railStationAt(x: number, y: number, env: RailEnv): Placed | null {
  if (!env.aux(x, y)) return null;
  const s = structureAt(x, y, env.aux, env.tile, env.sub);
  return s && isRailStationKind(s.kind) ? s : null;
}
/** A station is finished: level 1 and no site. */
export function stationBuilt(p: Placed, env: RailEnv): boolean {
  const t = env.tile(p.doorX, p.doorY);
  return t !== undefined && isRailStationKind(kindIdOf(zoneOf(t), env.sub(p.doorX, p.doorY))) && levelOf(t) >= 1 && !underConstruction(t);
}
/** Is the row behind the platform connected track along its whole length? null when it is, else why not. */
export function stationTrackProblem(p: Placed, env: RailEnv): string | null {
  const s = stationStop(p);
  for (let a = s.a0; a <= s.a1; a++) {
    const [x, y] = stopTile(s, a);
    if (env.tile(x, y) === undefined) return 'track not loaded';
    const m = trackAt(env, x, y);
    if (m < 0) return `no track along the platform (at ${x}, ${y})`;
    if (a < s.a1 && !(m & (1 << alongSide(s, 1)))) return `the track along the platform is not joined up (at ${x}, ${y})`;
    if (a > s.a0 && !(m & (1 << alongSide(s, -1)))) return `the track along the platform is not joined up (at ${x}, ${y})`;
  }
  return null;
}

/**
 * What the route search reads: a network of tiles whose masks say which sides a train may leave by, and the stops a
 * line names. Surface rail reads track aux bytes and stations (`surfaceNet`); the metro reads the under layer and its
 * platforms (metro.ts `underNet`). Everything downstream of the route (geometry, timetable, poses, calls) is the same.
 */
export interface TrackNet {
  /** the sides a train may leave (x, y) by, -1 where there is nothing (or it is not loaded) */
  mask(x: number, y: number): number;
  /** where a line naming (x, y) stops (its platform row), or why it cannot call there and the tile to mark */
  stop(x: number, y: number): StationStop | { reason: string; at: [number, number] };
  /** what the network is called in refusals ("track" when absent) */
  noun?: string;
}
/** Surface rail's network: track aux bytes, and rail stations whose platform row is connected track. */
export function surfaceNet(env: RailEnv): TrackNet {
  return {
    mask: (x, y) => trackAt(env, x, y),
    stop: (x, y) => {
      const p = railStationAt(x, y, env);
      if (!p) return { reason: env.tile(x, y) === undefined ? 'a station is not loaded' : `no rail station at (${x}, ${y})`, at: [x, y] };
      const why = stationTrackProblem(p, env);
      if (why) return { reason: `the station at (${p.doorX}, ${p.doorY}) is not on the track: ${why}`, at: [p.doorX, p.doorY] };
      return stationStop(p);
    },
  };
}

// ---- lines and routes -----------------------------------------------------------------------------
/** A line as its owner defines it (persisted; routes are re-derived from the tiles). */
export interface RailLineDef {
  id: number;
  owner: string;
  /** shown on trains and in the lines panel */
  number: number;
  name: string;
  /** 0xRRGGBB */
  color: number;
  /** station doors in calling order */
  stations: [number, number][];
  /** trains asked for (a there-and-back line on one track runs one) */
  trains: number;
  /** carriages behind the locomotive, 2-4 */
  cars: number;
  /** a freight line: it calls at freight yards, carries containers and no passengers (absent: passengers) */
  freight?: boolean;
  /** an underground line (metro.ts): twin bores, so a there-and-back line runs many trains; tube stock and METRO timing */
  metro?: boolean;
  /** round and round (the track must close), or there and back */
  loop: boolean;
}
export const RAIL_LIMITS = { stationsMin: 2, stationsMax: 12, trainsMax: 8, carsMin: 2, carsMax: 4, numberMax: 99, linesPerOwner: 24 } as const;

/**
 * A line's route through the track: the tile sequence (start tile, the side it is entered by, then the side each
 * tile is left by, as digits 0-3 in RAIL_SIDES order), and where each station's platform row starts in it.
 * A loop's last tile leads back into the first. Small enough to send with the line, so clients that have not
 * loaded every chunk of a long line still run its trains.
 */
export interface RailRoute {
  x: number; y: number;
  /** side the first tile is entered by */
  entry: number;
  /** exit side of every tile, one digit each */
  sides: string;
  loop: boolean;
  /** per station in calling order: index of its first platform-row tile in the route, and the platform length */
  stops: { k: number; len: number }[];
}

/** Expand a route into tiles with their entry and exit sides. */
export function routeTiles(r: RailRoute): { x: number; y: number; i: number; o: number }[] {
  const out: { x: number; y: number; i: number; o: number }[] = [];
  let x = r.x, y = r.y, i = r.entry;
  for (let k = 0; k < r.sides.length; k++) {
    const o = r.sides.charCodeAt(k) - 48;
    out.push({ x, y, i, o });
    x += RAIL_SIDES[o][0]; y += RAIL_SIDES[o][1]; i = oppSide(o);
  }
  return out;
}

type LegResult = { steps: { x: number; y: number; i: number; o: number }[]; dir: 1 | -1 } | null;
const BFS_BUDGET = 40000;
const tkey = (x: number, y: number) => (x + 0x8000) * 65536 + (y + 0x8000);
/** a tile as one number, as routes' `tiles` sets hold them */
export const trackKey = tkey;

/**
 * Shortest way through the track from leaving tile (sx, sy) by side `exit` to entering station `to`'s row at either
 * end (or only at the end `wantDir` names), never touching a tile in `forbid`. States are (tile, exit side); a train
 * may leave a tile by any connected side but the one it came in by, except on a four-way crossing (straight only).
 */
function legSearch(net: TrackNet, sx: number, sy: number, exit: number, to: StationStop, forbid: Set<number>, wantDir: 1 | -1 | 0): LegResult {
  const goals = new Map<number, 1 | -1>(); // tile key * 4 + entry side -> heading along the target row
  const [ex0, ey0] = stopTile(to, to.a0), [ex1, ey1] = stopTile(to, to.a1);
  if (wantDir >= 0) goals.set(tkey(ex0, ey0) * 4 + alongSide(to, -1), 1);
  if (wantDir <= 0) goals.set(tkey(ex1, ey1) * 4 + alongSide(to, 1), -1);
  const px: number[] = [], py: number[] = [], pin: number[] = [], pexit: number[] = [], parent: number[] = [];
  const seen = new Set<number>();
  const startMask = net.mask(sx, sy);
  if (startMask < 0 || !(startMask & (1 << exit))) return null;
  // node 0 is the start tile (not part of the leg)
  px.push(sx); py.push(sy); pin.push(-1); pexit.push(exit); parent.push(-1);
  for (let head = 0; head < px.length && px.length < BFS_BUDGET; head++) {
    const o = pexit[head];
    const nx = px[head] + RAIL_SIDES[o][0], ny = py[head] + RAIL_SIDES[o][1], ni = oppSide(o);
    const nk = tkey(nx, ny);
    const g = goals.get(nk * 4 + ni);
    if (g !== undefined) {
      const steps: { x: number; y: number; i: number; o: number }[] = [];
      for (let n = head; n > 0; n = parent[n]) steps.push({ x: px[n], y: py[n], i: pin[n], o: pexit[n] });
      steps.reverse();
      return { steps, dir: g };
    }
    if (forbid.has(nk)) continue;
    const m = net.mask(nx, ny);
    if (m < 0 || !(m & (1 << ni))) continue;
    const four = bits(m) === 4;
    for (let e = 0; e < 4; e++) {
      if (e === ni || !(m & (1 << e)) || (four && e !== oppSide(ni))) continue;
      const sk = nk * 4 + e;
      if (seen.has(sk)) continue;
      seen.add(sk);
      px.push(nx); py.push(ny); pin.push(ni); pexit.push(e); parent.push(head);
    }
  }
  return null;
}

export type RouteResult = { ok: true; route: RailRoute; tiles: Set<number> } | { ok: false; reason: string; at?: [number, number] };

/**
 * The route of a line through the track, from tile words, aux and sub bytes only (server and client agree).
 * Stations must be rail stations whose platform rows are connected track; consecutive stations must be joined by
 * track a train can run along (no reversing between stations); a loop must lead back into the first station the
 * way it left; and the route may not use a tile twice.
 */
export function routeLine(def: Pick<RailLineDef, 'stations' | 'loop'>, env: RailEnv): RouteResult {
  return routeNet(def, surfaceNet(env));
}
/** `routeLine` over any network (surface track, or the metro's tunnels): the shared route search. */
export function routeNet(def: Pick<RailLineDef, 'stations' | 'loop'>, net: TrackNet): RouteResult {
  const n = def.stations.length;
  const noun = net.noun ?? 'track';
  if (n < RAIL_LIMITS.stationsMin) return { ok: false, reason: `A line needs at least ${RAIL_LIMITS.stationsMin} stations` };
  const stops: StationStop[] = [];
  const seenDoor = new Set<string>();
  for (const [dx, dy] of def.stations) {
    const st = net.stop(dx, dy);
    if ('reason' in st) return { ok: false, reason: st.reason, at: st.at };
    const k = `${st.doorX},${st.doorY}`;
    if (seenDoor.has(k)) return { ok: false, reason: `the station at (${st.doorX}, ${st.doorY}) is on the line twice`, at: [dx, dy] };
    seenDoor.add(k);
    stops.push(st);
  }
  const rows = stops.map((s) => { const set = new Set<number>(); for (let a = s.a0; a <= s.a1; a++) { const [x, y] = stopTile(s, a); set.add(tkey(x, y)); } return set; });
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (const k of rows[i]) if (rows[j].has(k)) return { ok: false, reason: 'two stations of the line share the same platform track', at: [def.stations[j][0], def.stations[j][1]] };

  let budget = 64; // leg searches per derivation, so a pathological network cannot stall the server
  let firstFail: { reason: string; at?: [number, number] } | null = null;
  type Tile = { x: number; y: number; i: number; o: number };
  const allRows = new Set<number>();
  for (const r of rows) for (const k of r) allRows.add(k);
  const rowTiles = (s: StationStop, dir: 1 | -1): Tile[] => {
    const out: Tile[] = [];
    for (let q = 0; q < s.len; q++) {
      const a = dir > 0 ? s.a0 + q : s.a1 - q;
      const [x, y] = stopTile(s, a);
      out.push({ x, y, i: alongSide(s, dir > 0 ? -1 : 1), o: alongSide(s, dir) });
    }
    return out;
  };
  // depth-first over the heading through each station: each leg is the shortest way to either end of the next
  // station's row, and the other end is tried when the rest of the line cannot follow from the first
  const solve = (i: number, acc: Tile[], stopsK: number[], used: Set<number>, firstDir: 1 | -1): { tiles: Tile[]; stopsK: number[] } | null => {
    const closing = i === n - 1;
    if (closing && !def.loop) return { tiles: acc, stopsK };
    const toIdx = closing ? 0 : i + 1;
    const last = acc[acc.length - 1];
    const forbid = new Set(used);
    for (const k of allRows) forbid.add(k); // never run through a platform row; entering the target's end is the goal
    const search = (want: 1 | -1 | 0) => (budget-- > 0 ? legSearch(net, last.x, last.y, last.o, stops[toIdx], forbid, want) : null);
    const legA = search(closing ? firstDir : 0);
    if (!legA) {
      const [ax, ay] = def.stations[i], [bx, by] = def.stations[toIdx];
      firstFail ??= closing
        ? { reason: `the ${noun} does not lead from the last station (${ax}, ${ay}) back round into the first (${bx}, ${by}) for a loop`, at: [bx, by] }
        : { reason: `the stations at (${ax}, ${ay}) and (${bx}, ${by}) are not connected by ${noun} a train can run along`, at: [bx, by] };
      return null;
    }
    if (closing) return { tiles: [...acc, ...legA.steps], stopsK };
    const attempt = (leg: NonNullable<LegResult>) => {
      const nu = new Set(used);
      for (const s of leg.steps) nu.add(tkey(s.x, s.y));
      for (const k of rows[toIdx]) nu.add(k);
      return solve(i + 1, [...acc, ...leg.steps, ...rowTiles(stops[toIdx], leg.dir)], [...stopsK, acc.length + leg.steps.length], nu, firstDir);
    };
    const got = attempt(legA);
    if (got) return got;
    const legB = search(legA.dir > 0 ? -1 : 1);
    return legB ? attempt(legB) : null;
  };
  let best: { tiles: Tile[]; stopsK: number[] } | null = null;
  for (const d of [1, -1] as const) {
    const got = solve(0, rowTiles(stops[0], d), [0], new Set(rows[0]), d);
    if (got && (!best || got.tiles.length < best.tiles.length)) best = got;
  }
  if (!best) return { ok: false, ...(firstFail ?? { reason: `no route through the ${noun}` }) };
  const tiles = new Set<number>();
  for (const t of best.tiles) {
    const k = tkey(t.x, t.y);
    if (tiles.has(k)) return { ok: false, reason: `the line would cross itself at (${t.x}, ${t.y})`, at: [t.x, t.y] };
    tiles.add(k);
  }
  const t0 = best.tiles[0];
  return {
    ok: true, tiles,
    route: { x: t0.x, y: t0.y, entry: t0.i, sides: best.tiles.map((t) => String(t.o)).join(''), loop: def.loop, stops: best.stopsK.map((k, i) => ({ k, len: stops[i].len })) },
  };
}

// ---- geometry -------------------------------------------------------------------------------------
/** Track centreline through a route: per tile its start arclength, and whether it is a quarter curve. */
export interface RailGeometry {
  route: RailRoute;
  tiles: { x: number; y: number; i: number; o: number }[];
  /** arclength at the entry of tile k (length tiles + 1) */
  s: Float64Array;
  /** total length */
  L: number;
  loop: boolean;
  /** arclength of each station's stopping point (the middle of its platform row) */
  stopS: number[];
}
const CURVE_LEN = Math.PI / 4; // quarter circle of radius 1/2
/** side midpoints of a tile, relative to its min corner */
const MID: readonly (readonly [number, number])[] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];

const geomCache = new Map<string, RailGeometry>();
export const routeKey = (r: RailRoute) => `${r.x},${r.y},${r.entry},${r.loop ? 1 : 0},${r.sides},${r.stops.map((s) => `${s.k}:${s.len}`).join(';')}`;
export function railGeometry(route: RailRoute): RailGeometry {
  const key = routeKey(route);
  const hit = geomCache.get(key);
  if (hit) return hit;
  const tiles = routeTiles(route);
  const s = new Float64Array(tiles.length + 1);
  for (let k = 0; k < tiles.length; k++) s[k + 1] = s[k] + (tiles[k].o === oppSide(tiles[k].i) ? 1 : CURVE_LEN);
  const stopS = route.stops.map((st) => s[st.k] + st.len / 2); // platform rows are straight
  const g: RailGeometry = { route, tiles, s, L: s[tiles.length], loop: route.loop, stopS };
  if (geomCache.size > 256) geomCache.clear();
  geomCache.set(key, g);
  return g;
}

/** Point and heading (atan2(dz, dx), world x/z in tiles) on the centreline at arclength S. Shuttles extend straight past their ends. */
export function railPoint(g: RailGeometry, S: number, out: { x: number; z: number; h: number } = { x: 0, z: 0, h: 0 }) {
  const n = g.tiles.length;
  if (g.loop) S = ((S % g.L) + g.L) % g.L;
  if (S < 0 || S > g.L) {
    // past an end of a there-and-back line: straight on along the end tile's direction
    const t = S < 0 ? g.tiles[0] : g.tiles[n - 1];
    const side = S < 0 ? t.i : t.o;
    const [mx, mz] = MID[side];
    const dx = S < 0 ? -RAIL_SIDES[side][0] : RAIL_SIDES[side][0], dz = S < 0 ? -RAIL_SIDES[side][1] : RAIL_SIDES[side][1];
    const f = S < 0 ? S : S - g.L;
    out.x = t.x + mx + dx * f; out.z = t.y + mz + dz * f; out.h = Math.atan2(dz, dx);
    return out;
  }
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.s[mid] <= S) lo = mid; else hi = mid - 1; }
  const t = g.tiles[lo], f = S - g.s[lo];
  const [ix, iz] = MID[t.i], [ox, oz] = MID[t.o];
  if (t.o === oppSide(t.i)) {
    out.x = t.x + ix + (ox - ix) * f; out.z = t.y + iz + (oz - iz) * f; out.h = Math.atan2(oz - iz, ox - ix);
    return out;
  }
  // quarter curve round the corner shared by the entry and exit sides
  const cx = ix === 0.5 ? ox : ix, cz = iz === 0.5 ? oz : iz;
  const a0 = Math.atan2(iz - cz, ix - cx), a1 = Math.atan2(oz - cz, ox - cx);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const a = a0 + da * Math.min(1, f / CURVE_LEN), sg = Math.sign(da);
  out.x = t.x + cx + 0.5 * Math.cos(a); out.z = t.y + cz + 0.5 * Math.sin(a);
  out.h = Math.atan2(Math.cos(a) * sg, -Math.sin(a) * sg);
  return out;
}

// ---- timetable ------------------------------------------------------------------------------------
/** tiles per tick at line speed (cars cruise at 0.5), and the acceleration and braking rate */
export const TRAIN_VMAX = 0.6;
export const TRAIN_ACCEL = 0.03;
/** centre-to-centre spacing of the vehicles of a train, and each vehicle's body length */
export const CAR_PITCH = 0.92;
export const CAR_LEN = 0.86;
/** clear track kept between the back of one train and the front of the next, at the closest */
export const TRAIN_GAP = 1.5;
/** service hours: first departures at 05:00, last departure from the first station by 01:00 (25:00) */
export const SERVICE_START_HOUR = 5;
export const SERVICE_END_HOUR = 25;
/** a train still out after this hour of the next morning is cut short, so two days' services never overlap */
const SERVICE_HARD_END_HOUR = 28.8;
/**
 * Underground running (RailLineDef.metro, metro.ts METRO): line speed and acceleration, dwells (ticks, by the
 * station; longer at the ends of a there-and-back line, where the train crosses to the other bore), and the most
 * trains a line runs. Twin bores let a there-and-back line run many trains.
 */
export const METRO_TIMING = { vmax: 0.55, accel: 0.045, dwell: [3, 5], terminusDwell: [10, 14], trainsMax: 12 } as const;

/**
 * Vehicle types: RAIL_VEHICLE_LEN gives each body's length, and every pair of neighbours is RAIL_VEHICLE_GAP apart. Passenger trains
 * are a locomotive, carriages and a driving trailer; freight trains a locomotive and 4 to 8 short wagons (a locomotive
 * at each end on a there-and-back line, which has nowhere to run round).
 */
export const RailVehicle = { Loco: 0, Carriage: 1, Trailer: 2, Flat: 3, Tank: 4, Hopper: 5, Van: 6, TubeCab: 7, TubeCar: 8 } as const;
export const RAIL_VEHICLE_NAMES = ['locomotive', 'carriage', 'driving trailer', 'container flat', 'tank wagon', 'hopper wagon', 'covered van', 'driving motor car', 'tube car'];
export const RAIL_VEHICLE_LEN = [CAR_LEN, CAR_LEN, CAR_LEN, 0.58, 0.58, 0.58, 0.58, CAR_LEN, CAR_LEN];
export const RAIL_VEHICLE_GAP = CAR_PITCH - CAR_LEN;
/** containers (or container-loads of bulk) a wagon carries */
export const WAGON_LOAD = [0, 0, 0, 2, 1, 1, 1, 0, 0];
export const FREIGHT_WAGONS = { min: 4, max: 8 } as const;
const isWagon = (k: number) => k >= RailVehicle.Flat && k <= RailVehicle.Van;
/** a driving cab at either end of a train: the locomotive, or a tube train's motor car (drawn facing outwards at the back) */
const isCab = (k: number) => k === RailVehicle.Loco || k === RailVehicle.TubeCab;
export const consistLength = (kinds: readonly number[]) => kinds.reduce((a, k) => a + RAIL_VEHICLE_LEN[k], 0) + RAIL_VEHICLE_GAP * (kinds.length - 1);
/**
 * Vehicles in a passenger line's trains: the locomotive plus its carriages, as many as the shortest platform takes.
 * A metro train fills the shortest platform with cars, whatever `cars` says.
 */
export function consistFor(def: Pick<RailLineDef, 'cars' | 'metro'>, route: RailRoute): number {
  const shortestRoom = () => Math.floor((Math.min(...route.stops.map((s) => s.len)) - CAR_LEN) / CAR_PITCH + 1e-9) + 1;
  if (def.metro) return Math.max(2, shortestRoom());
  const want = 1 + Math.max(RAIL_LIMITS.carsMin, Math.min(RAIL_LIMITS.carsMax, Math.round(def.cars)));
  const shortest = Math.min(...route.stops.map((s) => s.len));
  return Math.max(2, Math.min(want, Math.floor((shortest - CAR_LEN) / CAR_PITCH + 1e-9) + 1));
}
export const trainLength = (vehicles: number) => (vehicles - 1) * CAR_PITCH + CAR_LEN;
/**
 * The vehicles of train `train` of a line, front (the outbound end) first. A freight line's wagon count is the line's
 * own (4-8 by hash, as many as the shortest dock takes) and the same for all its trains, so they all have one length;
 * which wagons they are is seeded per train, in runs of a kind (organic rule).
 */
export function consistKinds(def: Pick<RailLineDef, 'id' | 'cars' | 'freight' | 'metro'>, route: RailRoute, train: number): number[] {
  if (def.metro) {
    const n = consistFor(def, route);
    return Array.from({ length: n }, (_, j) => (j === 0 || j === n - 1 ? RailVehicle.TubeCab : RailVehicle.TubeCar));
  }
  if (!def.freight) {
    const n = consistFor(def, route);
    return Array.from({ length: n }, (_, j) => (j === 0 ? RailVehicle.Loco : j === n - 1 ? RailVehicle.Trailer : RailVehicle.Carriage));
  }
  const shortest = Math.min(...route.stops.map((s) => s.len));
  const locos = route.loop ? 1 : 2;
  const room = Math.floor((shortest - locos * CAR_LEN - (locos - 1) * RAIL_VEHICLE_GAP + RAIL_VEHICLE_GAP) / (RAIL_VEHICLE_LEN[RailVehicle.Flat] + RAIL_VEHICLE_GAP) + 1e-9);
  const want = FREIGHT_WAGONS.min + Math.floor(hash2(def.id * 7 + 1, 53) * (FREIGHT_WAGONS.max - FREIGHT_WAGONS.min + 1));
  const n = Math.max(1, Math.min(want, room));
  const out: number[] = [RailVehicle.Loco];
  let prev: number = RailVehicle.Flat;
  for (let j = 0; j < n; j++) {
    const h = hash2(def.id * 131 + train * 17 + j, 59);
    if (j === 0 || h > 0.55) {
      const r = hash2(def.id * 31 + train * 7 + j * 3, 61);
      prev = r < 0.4 ? RailVehicle.Flat : r < 0.6 ? RailVehicle.Tank : r < 0.8 ? RailVehicle.Hopper : RailVehicle.Van;
    }
    out.push(prev);
  }
  if (!route.loop) out.push(RailVehicle.Loco);
  return out;
}
/** containers a freight train of this consist carries */
export const consistLoad = (kinds: readonly number[]) => kinds.reduce((a, k) => a + WAGON_LOAD[k], 0);

interface Piece { t0: number; dur: number; s0: number; d: number; dir: 1 | -1; stop: number; vp: number; tAcc: number; a: number }
/** Everything about a line's service that follows from its definition and route. Pure and cached. */
export interface RailService {
  lineId: number;
  geom: RailGeometry;
  /** the cycle: dwell and run pieces; a train's cycle starts with the dwell at the first station */
  pieces: Piece[];
  /** cycle time in ticks, trains running, headway between them */
  T: number; trains: number; headway: number;
  /** vehicles per train and the train's length (the same for every train of a line) */
  vehicles: number; length: number;
  freight: boolean;
  /** an underground line: there and back runs out in one bore and home in the other (`unfoldedS`) */
  metro: boolean;
  /** each train's vehicles, front first (Vehicle kinds) */
  consists: number[][];
  /** dwell at each station (by calling order), ticks */
  dwell: number[];
  /** why fewer trains run than asked, if they do */
  note?: string;
}

/** distance covered t ticks into a run of length d (trapezoid, or a triangle when too short to reach line speed) */
function runDist(p: Piece, t: number): number {
  const A = p.a, d = p.d, T = p.dur;
  if (t <= 0) return 0;
  if (t >= T) return d;
  if (t < p.tAcc) return 0.5 * A * t * t;
  if (t > T - p.tAcc) { const r = T - t; return d - 0.5 * A * r * r; }
  return 0.5 * A * p.tAcc * p.tAcc + p.vp * (t - p.tAcc);
}
function runPiece(t0: number, s0: number, s1: number, dir: 1 | -1, V = TRAIN_VMAX, A = TRAIN_ACCEL): Piece {
  const d = Math.abs(s1 - s0);
  const dAcc = (V * V) / (2 * A);
  if (d >= 2 * dAcc) { const tAcc = V / A; return { t0, dur: 2 * tAcc + (d - 2 * dAcc) / V, s0, d, dir, stop: -1, vp: V, tAcc, a: A }; }
  const vp = Math.sqrt(A * d), tAcc = vp / A;
  return { t0, dur: 2 * tAcc, s0, d, dir, stop: -1, vp, tAcc, a: A };
}
/**
 * Dwell at a station, ticks: 8 to 13 (5-8 game minutes) by the station, longer at the ends of a there-and-back line.
 * Freight trains stand 36 to 60 ticks at a yard while they are loaded and unloaded.
 */
export function stationDwell(door: [number, number], terminus: boolean, freight = false, metro = false): number {
  const h = hash2(door[0] * 31 + 7, door[1] * 17 + 3);
  if (freight) return Math.round(36 + 24 * h);
  if (metro) { const [a, b] = terminus ? METRO_TIMING.terminusDwell : METRO_TIMING.dwell; return Math.round(a + (b - a) * h); }
  return Math.round((terminus ? 22 : 8) + (terminus ? 10 : 5) * h);
}

/** distance from the follower at arclength b forward to the leader at a, on a loop of length L */
const ahead = (a: number, b: number, L: number) => ((a - b) % L + L) % L;

const serviceCache = new Map<string, RailService>();
export function railService(def: RailLineDef, route: RailRoute): RailService {
  const metro = !!def.metro && !def.freight;
  const key = `${def.id}|${def.trains}|${def.cars}|${def.freight ? 1 : 0}${metro ? 'm' : ''}|${def.stations.map((s) => s.join(',')).join(';')}|${routeKey(route)}`;
  const hit = serviceCache.get(key);
  if (hit) return hit;
  const geom = railGeometry(route);
  const n = geom.stopS.length;
  const dwell = def.stations.map((d, i) => stationDwell(d, !route.loop && (i === 0 || i === n - 1), !!def.freight, metro));
  const V = metro ? METRO_TIMING.vmax : TRAIN_VMAX, A = metro ? METRO_TIMING.accel : TRAIN_ACCEL;
  const maxTrains = metro ? METRO_TIMING.trainsMax : RAIL_LIMITS.trainsMax;
  const pieces: Piece[] = [];
  let t = 0;
  const visit = (i: number, dir: 1 | -1) => { pieces.push({ t0: t, dur: dwell[i], s0: geom.stopS[i], d: 0, dir, stop: i, vp: 0, tAcc: 0, a: A }); t += dwell[i]; };
  const run = (a: number, b: number, dir: 1 | -1) => { const p = runPiece(t, a, b, dir, V, A); pieces.push(p); t += p.dur; };
  if (route.loop) {
    for (let i = 0; i < n; i++) { visit(i, 1); run(geom.stopS[i], i + 1 < n ? geom.stopS[i + 1] : geom.stopS[0] + geom.L, 1); }
  } else {
    for (let i = 0; i < n - 1; i++) { visit(i, 1); run(geom.stopS[i], geom.stopS[i + 1], 1); }
    for (let i = n - 1; i > 0; i--) { visit(i, -1); run(geom.stopS[i], geom.stopS[i - 1], -1); }
  }
  const T = t;
  const consists = Array.from({ length: maxTrains }, (_, i) => consistKinds({ ...def, metro }, route, i));
  const vehicles = consists[0].length;
  const length = consistLength(consists[0]);
  const svc: RailService = { lineId: def.id, geom, pieces, T, trains: 1, headway: T, vehicles, length, dwell, freight: !!def.freight, metro, consists };
  const want = Math.max(1, Math.min(maxTrains, Math.round(def.trains)));
  if (!route.loop && !metro) {
    if (want > 1) svc.note = 'a there-and-back line on one track runs one train; make it a loop for more';
  } else {
    // as many trains as keep a train length plus TRAIN_GAP apart at every moment of the cycle; twin bores unfold a
    // there-and-back cycle onto a loop of twice the length (out in one bore, home in the other), where a train
    // standing at a terminus is in both bores: the leader counts where it came in, the follower where it leaves
    const need = length + TRAIN_GAP, ring = route.loop ? geom.L : 2 * geom.L;
    const lead = (tau: number) => (route.loop ? serviceS(svc, tau) : unfoldedS(svc, tau, true));
    const follow = (tau: number) => (route.loop ? serviceS(svc, tau) : unfoldedS(svc, tau));
    let k = want;
    for (; k > 1; k--) {
      const H = T / k;
      let min = Infinity;
      for (let tau = 0; tau < T; tau += 0.5) min = Math.min(min, ahead(lead(tau), follow(tau - H), ring));
      if (min >= need) break;
    }
    svc.trains = k; svc.headway = T / k;
    if (k < want) svc.note = `the ${route.loop ? 'loop' : 'line'} has room for ${k} train${k === 1 ? '' : 's'}`;
  }
  if (serviceCache.size > 128) serviceCache.clear();
  serviceCache.set(key, svc);
  return svc;
}

function pieceAt(svc: RailService, tau: number): Piece {
  const ps = svc.pieces;
  let lo = 0, hi = ps.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid].t0 <= tau) lo = mid; else hi = mid - 1; }
  return ps[lo];
}
/** Arclength of a train's middle `tau` ticks into its cycle (any tau; the cycle repeats). */
export function serviceS(svc: RailService, tau: number): number {
  const T = svc.T;
  tau = ((tau % T) + T) % T;
  const p = pieceAt(svc, tau);
  if (p.stop >= 0) return p.s0;
  const s = p.s0 + p.dir * runDist(p, tau - p.t0);
  return svc.geom.loop ? ((s % svc.geom.L) + svc.geom.L) % svc.geom.L : s;
}
/**
 * Where a train of a twin-bore there-and-back line is `tau` ticks into its cycle, on the loop of length 2L its two
 * bores make: s on the way out, 2L - s on the way home. A train standing at a terminus crosses from the bore it came
 * in by to the one it leaves by (a scissors crossover), so it is in both: this is the bore it leaves by, or with
 * `arrival` the one it came in by. On a loop it is serviceS.
 */
export function unfoldedS(svc: RailService, tau: number, arrival = false): number {
  const s = serviceS(svc, tau);
  if (svc.geom.loop) return s;
  const T = svc.T, p = pieceAt(svc, ((tau % T) + T) % T), n = svc.geom.stopS.length;
  const crossing = arrival && (p.stop === 0 || p.stop === n - 1);
  return (p.dir > 0) !== crossing ? s : 2 * svc.geom.L - s;
}

export interface TrainState {
  line: number;
  /** train number on the line (0-based) and the service day it belongs to */
  train: number;
  day: number;
  /** a stable id for the renderer */
  id: number;
  /** arclength of the train's middle, direction of travel along the route (+1 / -1), speed in tiles per tick */
  s: number; dir: 1 | -1; v: number;
  phase: 'dwell' | 'run';
  /** station (calling order index) while dwelling, else the next station */
  stop: number;
  /** 0..1 through the phase */
  progress: number;
  /** doors open (dwelling, after the first and before the last couple of ticks) */
  doors: boolean;
}

/** first tick of service day `day`, and how long train i of it runs */
const dayStart = (day: number) => day * TICKS_PER_DAY + SERVICE_START_HOUR * TICKS_PER_HOUR;
/** cycles train i runs on a day: every cycle that starts by 01:00 and ends before the next morning's service */
export function trainCycles(svc: RailService, i: number): number {
  const first = i * svc.headway;
  const lastStart = (SERVICE_END_HOUR - SERVICE_START_HOUR) * TICKS_PER_HOUR;
  const hardEnd = (SERVICE_HARD_END_HOUR - SERVICE_START_HOUR) * TICKS_PER_HOUR;
  if (first > lastStart) return 0;
  let m = Math.floor((lastStart - first) / svc.T) + 1;
  while (m > 0 && first + m * svc.T > hardEnd) m--;
  return m;
}

/** Trains of a line in service at a (fractional) tick. */
export function trainsAt(svc: RailService, tick: number, out: TrainState[] = []): TrainState[] {
  out.length = 0;
  const today = Math.floor(tick / TICKS_PER_DAY);
  for (const day of [today - 1, today]) {
    const d0 = dayStart(day);
    for (let i = 0; i < svc.trains; i++) {
      const tau = tick - d0 - i * svc.headway;
      if (tau < 0 || tau >= trainCycles(svc, i) * svc.T) continue;
      out.push(trainState(svc, day, i, tau));
    }
  }
  return out;
}
function trainState(svc: RailService, day: number, i: number, tau: number): TrainState {
  const c = ((tau % svc.T) + svc.T) % svc.T;
  const p = pieceAt(svc, c);
  const local = c - p.t0;
  const st: TrainState = {
    line: svc.lineId, train: i, day, id: svc.lineId * 64 + i, s: serviceS(svc, c), dir: p.dir, v: 0,
    phase: p.stop >= 0 ? 'dwell' : 'run', stop: p.stop, progress: p.dur > 0 ? local / p.dur : 1, doors: false,
  };
  if (p.stop >= 0) st.doors = local > 1.5 && local < p.dur - 2;
  else {
    const A = p.a;
    st.v = local < p.tAcc ? A * local : local > p.dur - p.tAcc ? A * (p.dur - local) : p.vp;
    const next = svc.pieces[svc.pieces.indexOf(p) + 1] ?? svc.pieces[0];
    st.stop = next.stop;
  }
  return st;
}

/** One vehicle of a train, placed on the track: world position of its middle, heading, and what it is. */
export interface VehiclePose {
  x: number; z: number; h: number;
  /** Vehicle kind: 0 locomotive, 1 carriage, 2 driving trailer, 3-6 wagons, 7 tube motor car, 8 tube car */
  kind: number;
  /** index in the train, 0 = the front (outbound) end */
  j: number;
  /** a locomotive at the rear of a there-and-back freight train (or a tube train's rear motor car) faces the other way */
  flip: boolean;
}
/** half the distance between a vehicle's two bogies */
const BOGIE = 0.3, WAGON_BOGIE = 0.19;
const P1 = { x: 0, z: 0, h: 0 }, P2 = { x: 0, z: 0, h: 0 };
/**
 * The vehicles of a train. The locomotive is at the end that leads on the outbound run (towards later stations);
 * a there-and-back train comes home driven from its trailer. Each body is the chord between its bogies, so the
 * carriages follow curves.
 */
export function trainPoses(svc: RailService, t: TrainState, out: VehiclePose[] = []): VehiclePose[] {
  out.length = 0;
  const kinds = svc.consists[t.train] ?? svc.consists[0];
  let front = t.s + svc.length / 2;
  for (let j = 0; j < kinds.length; j++) {
    const k = kinds[j], len = RAIL_VEHICLE_LEN[k], b = isWagon(k) ? WAGON_BOGIE : BOGIE;
    const s = front - len / 2;
    front -= len + RAIL_VEHICLE_GAP;
    railPoint(svc.geom, s + b, P1);
    railPoint(svc.geom, s - b, P2);
    out.push({ x: (P1.x + P2.x) / 2, z: (P1.z + P2.z) / 2, h: Math.atan2(P1.z - P2.z, P1.x - P2.x), kind: k, j, flip: isCab(k) && j > 0 });
  }
  return out;
}

// ---- stops, for passengers and tooltips -----------------------------------------------------------
/** One train calling at one station. */
export interface RailCall { line: number; train: number; stop: number; arrive: number; depart: number; dir: 1 | -1 }
/** Every call whose arrival falls in (from, to], in time order. */
export function callsBetween(svc: RailService, from: number, to: number, out: RailCall[] = []): RailCall[] {
  out.length = 0;
  if (to <= from) return out;
  for (let day = Math.floor(from / TICKS_PER_DAY) - 1; day <= Math.floor(to / TICKS_PER_DAY); day++) {
    const d0 = dayStart(day);
    for (let i = 0; i < svc.trains; i++) {
      const t0 = d0 + i * svc.headway, cycles = trainCycles(svc, i);
      const c0 = Math.max(0, Math.floor((from - t0) / svc.T)), c1 = Math.min(cycles - 1, Math.floor((to - t0) / svc.T));
      for (let c = c0; c <= c1; c++) {
        for (const p of svc.pieces) {
          if (p.stop < 0) continue;
          const arrive = t0 + c * svc.T + p.t0;
          // the first dwell of a train's day is its departure from the depot, not an arrival
          if (arrive > from && arrive <= to) out.push({ line: svc.lineId, train: i, stop: p.stop, arrive, depart: arrive + p.dur, dir: p.dir });
        }
      }
    }
  }
  return out.sort((a, b) => a.arrive - b.arrive || a.train - b.train);
}

/**
 * The next ride from station `a` to station `b` (calling-order indices) leaving at or after `tick`: which train,
 * when it leaves a and when it reaches b. Loops ride forwards; a there-and-back line rides whichever way leads from
 * a to b. null when no train does it within the next day.
 */
export function nextRide(svc: RailService, a: number, b: number, tick: number): { train: number; depart: number; arrive: number } | null {
  const n = svc.geom.stopS.length;
  if (a === b || a < 0 || b < 0 || a >= n || b >= n) return null;
  const dir: 1 | -1 = svc.geom.loop || b > a ? 1 : -1;
  const ps = svc.pieces;
  const ia = ps.findIndex((p) => p.stop === a && (p.dir === dir || a === 0 || a === n - 1));
  if (ia < 0) return null;
  // the first call at b after leaving a, going round the cycle
  let arrOff = -1;
  for (let step = 1; step <= ps.length; step++) {
    const j = (ia + step) % ps.length;
    if (ps[j].stop === b) { arrOff = ps[j].t0 + (j <= ia ? svc.T : 0); break; }
  }
  if (arrOff < 0) return null;
  const calls = callsBetween(svc, tick - ps[ia].dur - 1, tick + TICKS_PER_DAY);
  for (const c of calls) {
    if (c.stop !== a || c.dir !== ps[ia].dir || c.depart < tick) continue;
    const cycleStart = c.arrive - ps[ia].t0;
    const arrive = cycleStart + arrOff;
    // the train must still be in service when it gets there (its last cycle ends back at the first station)
    const day = Math.floor((cycleStart - SERVICE_START_HOUR * TICKS_PER_HOUR) / TICKS_PER_DAY);
    const end = dayStart(day) + c.train * svc.headway + trainCycles(svc, c.train) * svc.T;
    if (arrive > end + 1e-6) continue;
    return { train: c.train, depart: c.depart, arrive };
  }
  return null;
}

/** Ticks a line's trains are out of the first station: for tooltips ("every 14 min"). */
export const headwayMinutes = (svc: RailService) => Math.round((svc.headway / TICKS_PER_HOUR) * 60);

// ---- level crossings -------------------------------------------------------------------------------
/**
 * Barriers come down CROSSING_WARN ticks before a train reaches a level crossing and go up once its last vehicle
 * has left the crossing tile: long enough for a walker who has just stepped out (a fifth of a tile a tick, a
 * retiree less) or a car already over the stop line to get across first. A pure function of the timetable, like
 * the trains, so the server holds traffic and every client lowers the arms at the same moment with nothing sent.
 */
export const CROSSING_WARN = gameMin(7);
/** ticks the arms take to come down (or go up), for drawing; the barrier counts as closed from the start */
export const BARRIER_MOVE = gameMin(3);
/** sampling step of the cover windows, ticks, and the distance a train may cover in it (line speed) */
const COVER_STEP = 0.25, COVER_PAD = TRAIN_VMAX * COVER_STEP;
const windowCache = new WeakMap<RailService, Map<number, number[]>>();
/**
 * When a train of the service covers the tile (x, y), as [start, end] pairs of ticks into the cycle: its body is
 * within half a tile of the tile's middle (anywhere over the road there). Empty when the route does not pass (x, y).
 */
export function crossingWindows(svc: RailService, x: number, y: number): number[] {
  let byTile = windowCache.get(svc);
  if (!byTile) windowCache.set(svc, byTile = new Map());
  const key = tkey(x, y);
  const hit = byTile.get(key);
  if (hit) return hit;
  const out: number[] = [];
  const g = svc.geom, k = g.tiles.findIndex((t) => t.x === x && t.y === y);
  if (k >= 0) {
    const sc = g.s[k] + (g.s[k + 1] - g.s[k]) / 2, reach = svc.length / 2 + 0.5 + COVER_PAD;
    let open = -1;
    for (let tau = 0; tau <= svc.T + COVER_STEP; tau += COVER_STEP) {
      let d = Math.abs(serviceS(svc, tau) - sc);
      if (g.loop) d = Math.min(d, g.L - d);
      const on = d < reach && tau <= svc.T;
      if (on && open < 0) open = tau;
      if (!on && open >= 0) { out.push(open - COVER_STEP, tau); open = -1; }
    }
  }
  byTile.set(key, out);
  return out;
}
/**
 * The barriers of the crossing (x, y) for one line at `tick`: down (a train covers it now or will within
 * CROSSING_WARN) and ticks since they last moved (came down, or went up), Infinity when no train has passed
 * today. Written into `out`.
 */
export function crossingState(svc: RailService, x: number, y: number, tick: number, out = { down: false, since: Infinity }): { down: boolean; since: number } {
  out.down = false; out.since = Infinity;
  const w = crossingWindows(svc, x, y);
  if (!w.length) return out;
  const T = svc.T, today = Math.floor(tick / TICKS_PER_DAY);
  let downSince = -Infinity, upSince = Infinity;
  for (const day of [today - 1, today]) {
    const d0 = dayStart(day);
    for (let i = 0; i < svc.trains; i++) {
      const tau = tick - d0 - i * svc.headway, end = trainCycles(svc, i) * T;
      if (tau + CROSSING_WARN < 0 || tau - end > TICKS_PER_DAY / 4) continue;
      const c0 = Math.floor(tau / T);
      for (let c = Math.max(0, c0 - 1); c <= c0 + 1 && c * T < end; c++) {
        for (let j = 0; j < w.length; j += 2) {
          const a = c * T + w[j] - CROSSING_WARN, b = c * T + w[j + 1];
          if (tau >= a && tau < b) { out.down = true; downSince = Math.max(downSince, tau - a); }
          else if (tau >= b) upSince = Math.min(upSince, tau - b);
        }
      }
    }
  }
  out.since = out.down ? downSince : upSince;
  return out;
}
/** Are the barriers of the crossing (x, y) down for this line at `tick`? */
export const barrierDown = (svc: RailService, x: number, y: number, tick: number) => crossingState(svc, x, y, tick, SCRATCH_XS).down;
const SCRATCH_XS = { down: false, since: Infinity };
