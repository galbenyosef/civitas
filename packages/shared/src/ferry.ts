import { kindIdOf, levelOf, underConstruction, zoneOf } from './tile';
import { hash2 } from './noise';
import { isBridgeAux, bridgeSpanAt } from './bridges';
import { HARBOUR_KIND } from './harbours';
import { structureAt, fairwayTiles, footprintOf, footprintPoint, type Placed } from './structures';
import {
  WaterGrid, waterLane, waterTiles, navigableTile, passSig, WIDTH_CLEARANCE, type WaterTile, type WidthClass,
} from './waterways';
import {
  FERRY_TIMING, stopTile, alongSide, trackKey, railGeometry, railPoint,
  type RailEnv, type RailLineDef, type RailRoute, type RouteResult, type StationStop,
} from './rail';

/**
 * Ferries (docs/boats.md section 6.2): river buses are the 'ferry' mode of the transit registry. A line calls at ferry
 * piers (kind 27); its boats run rail's pure timetable (`railService` with `RailLineDef.ferry`), so the server and
 * every client place every boat from the line and its route alone, as for trains.
 *
 *  - **The stop.** A pier's boats lie on the row of water just behind its pontoon (`pierStop`, like rail's
 *    `stationStop`): the 2-tile berth, plus a tile of open water beyond each end, where the boat comes in alongside
 *    and leaves straight. So a stop row is 4 tiles, its middle the berth's middle, and the sailing line keeps it
 *    straight (stop rows are fixed points in waterGeometry).
 *  - **The route.** `routeWater` joins the piers in calling order with waterways.ts lanes for river-class water
 *    (clearance 2), at the river bus's air draft (it clears every bridge). Each leg runs from the end of one stop row
 *    to either end of the next, never through a berth; the berth's end tiles may be narrow (they are beside the bank).
 *    The result is a RailRoute with `water` set and the lane's `room` digits and decks, so `railGeometry` hands it to
 *    `waterGeometry` and boats sail the rounded line.
 *  - **Water is shared.** Lines may cross and share water, and a route may cross itself; the one exclusive rule (one
 *    line a pier) is the server's (sim/ferry.ts).
 */
export const FERRY = {
  ...FERRY_TIMING,
  /** riders a river bus carries, and the ticks a ride adds for the gangway */
  riders: 120, access: 2,
  /** the river bus's air draft (under every bridge: docs/boats.md section 3) and its width class */
  airDraft: 0.1, cls: 'river' as WidthClass,
  stationsMin: 2, stationsMax: 12, linesPerOwner: 24,
  /** the A* node budget of one leg */
  legNodes: 20000,
} as const;
/** The river bus's pass signature (waterways.ts passSig): every style closed, no lifts needed. */
export const FERRY_SIG = passSig(FERRY.airDraft, false);

export const FERRY_PIER: number = HARBOUR_KIND.pier >= 0 ? HARBOUR_KIND.pier : 27;
export const isFerryPierKind = (id: number) => id === FERRY_PIER;

/** The ferry pier whose door is at (x, y), or that covers (x, y), or null. */
export function pierAt(x: number, y: number, env: RailEnv): Placed | null {
  if (!env.aux(x, y)) return null;
  const s = structureAt(x, y, env.aux, env.tile, env.sub);
  return s && s.kind === FERRY_PIER ? s : null;
}
/** A pier is finished: level 1 and no site. */
export function pierBuilt(p: Placed, env: RailEnv): boolean {
  const t = env.tile(p.doorX, p.doorY);
  return t !== undefined && kindIdOf(zoneOf(t), env.sub(p.doorX, p.doorY)) === FERRY_PIER && levelOf(t) >= 1 && !underConstruction(t);
}

/**
 * Where a ferry calling at pier `p` lies: the berth row behind the pontoon (fairwayTiles row 0) with a tile beyond
 * each end, as a StationStop (row, a0..a1, len 4), or why boats cannot call there. Every tile of the row must be open
 * water with no deck on it.
 */
export function pierStop(p: Placed, env: RailEnv): StationStop | { reason: string; at: [number, number] } {
  const berth = fairwayTiles(p, 0);
  const alongX = berth[0][1] === berth[berth.length - 1][1];
  const along = berth.map(([x, y]) => (alongX ? x : y));
  const s: StationStop = {
    doorX: p.doorX, doorY: p.doorY, alongX, row: alongX ? berth[0][1] : berth[0][0],
    a0: Math.min(...along) - 1, a1: Math.max(...along) + 1, len: berth.length + 2,
  };
  for (let a = s.a0; a <= s.a1; a++) {
    const [x, y] = stopTile(s, a), t = env.tile(x, y), aux = env.aux(x, y);
    if (t === undefined) return { reason: 'a pier is not loaded', at: [p.doorX, p.doorY] };
    const end = a === s.a0 || a === s.a1;
    if (!navigableTile(t, aux) || isBridgeAux(aux)) {
      return {
        reason: end
          ? `the pier at (${p.doorX}, ${p.doorY}) needs open water beyond each end of its berth for the boats to come alongside: (${x}, ${y}) is not`
          : `the berth behind the pier at (${p.doorX}, ${p.doorY}) is not open water (at ${x}, ${y})`,
        at: [x, y],
      };
    }
  }
  return s;
}
/** `pierStop` from a door tile. */
export function ferryStop(x: number, y: number, env: RailEnv): StationStop | { reason: string; at: [number, number] } {
  const p = pierAt(x, y, env);
  if (!p) return { reason: env.tile(x, y) === undefined ? 'a pier is not loaded' : `no ferry pier at (${x}, ${y})`, at: [x, y] };
  return pierStop(p, env);
}

/**
 * The lane search's view of the water while a ferry route is found: each stop row's end tiles count as wide enough
 * (they lie beside the bank), and its berth tiles as land, so a leg reaches a stop row only at an end, from outside.
 */
class BerthGrid extends WaterGrid {
  constructor(private base: WaterGrid, private berths: Set<number>, private ends: Set<number>, private minC: number) { super(base.env); }
  navigable(x: number, y: number) { return !this.berths.has(trackKey(x, y)) && this.base.navigable(x, y); }
  clearance(x: number, y: number) {
    const k = trackKey(x, y);
    if (this.berths.has(k)) return 0;
    const c = this.base.clearance(x, y);
    return c > 0 && this.ends.has(k) ? Math.max(c, this.minC) : c;
  }
  channel(x: number, y: number) { return this.base.channel(x, y); }
  room(x: number, y: number) { return this.base.room(x, y); }
}

/**
 * A ferry line's route through the water: every pier's stop row in calling order, joined by lanes a river bus can
 * sail (river-class water, under its bridges), and for a loop back round into the first. Both ways through the first
 * pier are tried and the cheaper kept. `grid` reads the water (the server keeps one; a fresh one is always right).
 */
export function routeWater(def: Pick<RailLineDef, 'stations' | 'loop'>, grid: WaterGrid, env: RailEnv, maxNodes: number = FERRY.legNodes): RouteResult {
  const n = def.stations.length;
  if (n < FERRY.stationsMin) return { ok: false, reason: `A ferry line needs at least ${FERRY.stationsMin} piers` };
  const stops: StationStop[] = [];
  const seen = new Set<string>();
  for (const [dx, dy] of def.stations) {
    const st = ferryStop(dx, dy, env);
    if ('reason' in st) return { ok: false, reason: st.reason, at: st.at };
    const k = `${st.doorX},${st.doorY}`;
    if (seen.has(k)) return { ok: false, reason: `the pier at (${st.doorX}, ${st.doorY}) is on the line twice`, at: [dx, dy] };
    seen.add(k);
    stops.push(st);
  }
  const berths = new Set<number>(), ends = new Set<number>();
  for (const s of stops) for (let a = s.a0; a <= s.a1; a++) { const [x, y] = stopTile(s, a); (a === s.a0 || a === s.a1 ? ends : berths).add(trackKey(x, y)); }
  for (const k of berths) ends.delete(k);
  const minC = WIDTH_CLEARANCE[FERRY.cls];
  const g = new BerthGrid(grid, berths, ends, minC);
  const rowTiles = (s: StationStop, dir: 1 | -1): WaterTile[] => {
    const out: WaterTile[] = [];
    for (let q = 0; q < s.len; q++) {
      const [x, y] = stopTile(s, dir > 0 ? s.a0 + q : s.a1 - q);
      out.push({ x, y, i: alongSide(s, dir > 0 ? -1 : 1), o: alongSide(s, dir) });
    }
    return out;
  };
  let best: { tiles: WaterTile[]; stopsK: number[]; cost: number } | null = null;
  let firstFail: { reason: string; at?: [number, number] } | null = null;
  for (const d0 of [1, -1] as const) {
    const tiles = rowTiles(stops[0], d0), stopsK = [0];
    let cost = 0, ok = true;
    for (let i = 0; i < (def.loop ? n : n - 1); i++) {
      const closing = i === n - 1, to = closing ? 0 : i + 1, last = tiles[tiles.length - 1];
      const goals: [number, number][] = closing ? [[tiles[0].x, tiles[0].y]] : [stopTile(stops[to], stops[to].a0), stopTile(stops[to], stops[to].a1)];
      const lane = waterLane(g, [last.x, last.y], goals, { cls: FERRY.cls, sig: FERRY_SIG, entry: last.i, maxNodes });
      if (!lane.ok) {
        const [ax, ay] = def.stations[i], [bx, by] = def.stations[to];
        firstFail ??= {
          reason: closing
            ? `no water a river bus can sail leads from the last pier (${ax}, ${ay}) back round to the first (${bx}, ${by}): ${lane.reason}`
            : `the piers at (${ax}, ${ay}) and (${bx}, ${by}) are not joined by water a river bus can sail: ${lane.reason}`,
          at: lane.at ?? [bx, by],
        };
        ok = false; break;
      }
      const lt = waterTiles(lane.route), z = lt[lt.length - 1];
      last.o = lt[0].o;
      tiles.push(...lt.slice(1, -1));
      if (closing) tiles[0].i = z.i;
      else {
        const [ex, ey] = stopTile(stops[to], stops[to].a0), row = rowTiles(stops[to], z.x === ex && z.y === ey ? 1 : -1);
        row[0].i = z.i;
        stopsK.push(tiles.length);
        tiles.push(...row);
      }
      cost += lane.cost;
    }
    if (ok && (!best || cost < best.cost)) best = { tiles, stopsK, cost };
  }
  if (!best) return { ok: false, ...(firstFail ?? { reason: 'no water route between the piers' }) };
  const set = new Set<number>(), bridges: NonNullable<RailRoute['bridges']> = [];
  let room = '';
  const aux = (x: number, y: number) => env.aux(x, y);
  best.tiles.forEach((t, k) => {
    set.add(trackKey(t.x, t.y));
    room += String(grid.room(t.x, t.y));
    if (isBridgeAux(env.aux(t.x, t.y))) { const s = bridgeSpanAt(t.x, t.y, aux)!; bridges.push({ k, style: s.style, x0: s.x0, y0: s.y0 }); }
  });
  const t0 = best.tiles[0];
  return {
    ok: true, tiles: set,
    route: {
      x: t0.x, y: t0.y, entry: t0.i, sides: best.tiles.map((t) => String(t.o)).join(''), loop: def.loop,
      stops: best.stopsK.map((k, i) => ({ k, len: stops[i].len })), water: true, room, bridges,
    },
  };
}

/** The line a ferry route's boats sail, sampled every `step` tiles: flat [x, z, …] (LinePreview.sail, the editor's ribbons). */
export function sailPoints(route: RailRoute, step = 0.25): number[] {
  const g = railGeometry(route), out: number[] = [], p = { x: 0, z: 0, h: 0 };
  const m = Math.max(1, Math.ceil(g.L / step));
  for (let i = 0; i <= m; i++) { railPoint(g, (g.L * i) / m, p); out.push(p.x, p.z); }
  return out;
}

/** Where rider `seed` waits on pier `p`'s pontoon (its wet row), in world tile space: their own spot along it. */
export function pontoonSpot(p: Placed, seed: number): [number, number] {
  const w = footprintOf(p.kind).w;
  return footprintPoint(p, 0.2 + hash2(seed, 71) * (w - 0.4), 0.3 + 0.4 * hash2(seed, 72));
}
