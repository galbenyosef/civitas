import { isRoad, zoneOf, levelOf, underConstruction, terrainOf, Terrain } from './tile';
import { Zone } from './buildings/codes';

/**
 * Junction types beyond the give-way box and traffic lights (docs/structures.md capability E6, docs/traffic-tuning.md
 * "Roundabouts and flyovers"). Both are written into the aux layer of road tiles (docs/aux-layer.md), so the tile
 * word and the road graph stay as they are; the router and the traffic model read the aux byte.
 *
 *  - **Roundabout**: a 3×3 area around a crossroads or T-junction. The junction tile becomes the **island** (not a
 *    road: aux ISLAND_AUX), the eight tiles round it are **ring** road (aux RING_AUX | p, p the tile's place round
 *    the island in RING_POS order). Traffic drives on the right, so the ring runs **anticlockwise** seen from above
 *    (north up): p to p + 1. Arms join at the four middle tiles; corners take no side road. No signals; a car coming
 *    in gives way to cars already circulating (Traffic.canEnter, TRAFFIC_TUNING.ringYield).
 *  - **Flyover**: a crossroads tile where one road passes over the other on a deck (aux FLYOVER_EW: the east-west
 *    road is on top, layer 1; FLYOVER_NS: the north-south road). Nobody turns there, nothing on one road conflicts
 *    with the other, and there are no lights. The two tiles either side along the deck are drawn as ramps
 *    (visual only: the sim stays flat); they must be plain straight road.
 */

// ---- aux encoding (0xf0-0xfa; docs/aux-layer.md) ------------------------------------------------------
export const RING_AUX = 0xf0;
export const ISLAND_AUX = 0xf8;
export const FLYOVER_EW = 0xf9;
export const FLYOVER_NS = 0xfa;
export const isRingAux = (a: number) => (a & 0xf8) === RING_AUX;
export const ringPos = (a: number) => a & 7;
export const isIslandAux = (a: number) => a === ISLAND_AUX;
export const isFlyoverAux = (a: number) => a === FLYOVER_EW || a === FLYOVER_NS;
/** The flyover's deck carries the east-west road (else the north-south one). */
export const deckEW = (a: number) => a === FLYOVER_EW;
/** Any junction byte: ring, island or flyover. */
export const isJunctionAux = (a: number) => a >= RING_AUX && a <= FLYOVER_NS;

/**
 * Ring tile offsets from the island, in driving order: east, north-east, north, north-west, west, south-west, south,
 * south-east (y grows south). That is anticlockwise seen from above, the way right-hand traffic goes round.
 */
export const RING_POS: readonly (readonly [number, number])[] = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
/** Ring places with an arm (the middle of each side): east, north, west, south. */
export const isArmPos = (p: number) => (p & 1) === 0;
/** The island tile of a ring tile (x, y) with aux byte a. */
export const islandOf = (x: number, y: number, a: number): [number, number] => [x - RING_POS[ringPos(a)][0], y - RING_POS[ringPos(a)][1]];

/**
 * May a vehicle step from road tile A to its neighbour B, having come into A by the step (pdx, pdy) ((0, 0) when
 * not known, e.g. the first tile of a search)? Round a ring only forwards; across a flyover only straight on.
 */
export function junctionStepOk(aux: (x: number, y: number) => number, ax: number, ay: number, bx: number, by: number, pdx: number, pdy: number): boolean {
  const a = aux(ax, ay);
  if (a < RING_AUX) return true;
  if (isFlyoverAux(a)) return (pdx === 0 && pdy === 0) || (bx - ax === pdx && by - ay === pdy);
  if (!isRingAux(a)) return true;
  const b = aux(bx, by);
  if (!isRingAux(b)) return true; // leaving the ring by an arm or into a building
  const [ix, iy] = islandOf(ax, ay, a), [jx, jy] = islandOf(bx, by, b);
  return ix !== jx || iy !== jy || ringPos(b) === ((ringPos(a) + 1) & 7);
}
/**
 * The search layer of a road tile entered by the step (dx, dy): a flyover's deck and the road under it are different
 * nodes for a router (1 = the road along y, so it can be added to a tile key), everything else is layer 0.
 */
export const routeLayer = (a: number, dx: number) => (isFlyoverAux(a) && dx === 0 ? 1 : 0);

// ---- placement ---------------------------------------------------------------------------------------
export const ROUNDABOUT_COST = 600;
export const FLYOVER_COST = 900;
/** Deck height of a flyover over the road beneath, in tiles (render/junctions.ts; a car is about 0.12 tall). */
export const FLYOVER_DECK_H = 0.3;

/** What the planners may read. `land` is null when the player may build there, else the reason why not. */
export interface JunctionEnv {
  tile(x: number, y: number): number | undefined;
  aux(x: number, y: number): number;
  land(x: number, y: number): string | null;
}
export interface JunctionPlan {
  ok: boolean; reason?: string;
  /** tiles to write, flat [x, y, aux, road (1/0), ...] */
  tiles?: number[];
  cost?: number;
}
const road = (env: JunctionEnv, x: number, y: number) => { const t = env.tile(x, y); return t !== undefined && isRoad(t); };
const STEPS: readonly (readonly [number, number])[] = [[1, 0], [0, -1], [-1, 0], [0, 1]];

/**
 * A roundabout centred on the junction (x, y): the junction becomes the island, the eight tiles round it the ring.
 * Corners must be clear (road, bare ground or an empty lot) and meet no road from outside.
 */
export function planRoundabout(x: number, y: number, env: JunctionEnv): JunctionPlan {
  if (!road(env, x, y)) return { ok: false, reason: 'Click a junction: a roundabout replaces a crossroads or T-junction' };
  if (isJunctionAux(env.aux(x, y))) return { ok: false, reason: 'That is already a roundabout or flyover' };
  let arms = 0;
  for (const [dx, dy] of STEPS) if (road(env, x + dx, y + dy)) arms++;
  if (arms < 3) return { ok: false, reason: 'A roundabout goes on a junction of three or four roads' };
  const own = env.land(x, y);
  if (own) return { ok: false, reason: own };
  const tiles: number[] = [x, y, ISLAND_AUX, 0];
  for (let p = 0; p < 8; p++) {
    const [ox, oy] = RING_POS[p], tx = x + ox, ty = y + oy;
    const t = env.tile(tx, ty);
    if (t === undefined) return { ok: false, reason: 'Too close to the edge of the loaded map' };
    if (env.aux(tx, ty)) return { ok: false, reason: 'Something else is in the way (a structure, track, runway or another junction)' };
    if (terrainOf(t) === Terrain.Water) return { ok: false, reason: 'A roundabout cannot go on water' };
    const lot = zoneOf(t) >= Zone.Residential && zoneOf(t) <= Zone.Office && levelOf(t) === 0 && !underConstruction(t); // an empty zoned lot is paved over
    if (!isRoad(t) && zoneOf(t) !== Zone.None && !lot) return { ok: false, reason: 'Clear the corners first: a roundabout needs the corner lots empty' };
    if (!isArmPos(p)) {
      // a corner: no road may join it from outside the 3×3
      if (road(env, tx + ox, ty) || road(env, tx, ty + oy)) return { ok: false, reason: 'A road meets the roundabout at a corner; side roads can only join in the middle of a side' };
    } else if (isFlyoverAux(env.aux(tx + ox, ty + oy))) return { ok: false, reason: 'Too close to a flyover' };
    const why = env.land(tx, ty);
    if (why) return { ok: false, reason: why };
    tiles.push(tx, ty, RING_AUX | p, 1);
  }
  return { ok: true, tiles, cost: ROUNDABOUT_COST };
}

/**
 * A flyover on the crossroads (x, y): the road along the deck axis goes over the other. `ew` picks the deck
 * (undefined: east-west when its ramps fit, else north-south). Clicking a flyover again swaps the deck.
 */
export function planFlyover(x: number, y: number, env: JunctionEnv, ew?: boolean): JunctionPlan {
  if (!road(env, x, y)) return { ok: false, reason: 'Click a crossroads: a flyover lifts one road over the other' };
  const a = env.aux(x, y);
  if (a && !isFlyoverAux(a)) return { ok: false, reason: 'Something else is in the way (a roundabout, track or runway)' };
  for (const [dx, dy] of STEPS) {
    if (!road(env, x + dx, y + dy)) return { ok: false, reason: 'A flyover goes on a crossroads: four roads meeting' };
    if (isJunctionAux(env.aux(x + dx, y + dy))) return { ok: false, reason: 'Too close to another flyover or a roundabout' };
  }
  // a ramp is a plain straight stretch: road on along the deck, nothing joining from the sides
  const ramps = (alongX: boolean) => {
    for (const s of [-1, 1]) {
      const rx = x + (alongX ? s : 0), ry = y + (alongX ? 0 : s);
      if (!road(env, rx + (alongX ? s : 0), ry + (alongX ? 0 : s))) return 'The road must carry on past each ramp';
      if (road(env, rx + (alongX ? 0 : 1), ry + (alongX ? 1 : 0)) || road(env, rx - (alongX ? 0 : 1), ry - (alongX ? 1 : 0))) return 'The ramps either side of a flyover must be plain straight road (no side roads)';
    }
    return null;
  };
  const want = isFlyoverAux(a) ? !deckEW(a) : ew;
  const okEW = ramps(true), okNS = ramps(false);
  const pick = want === undefined ? (!okEW ? true : !okNS ? false : null) : want;
  if (pick === null) return { ok: false, reason: okEW ?? 'No room for ramps' };
  const why = pick ? okEW : okNS;
  if (why) return { ok: false, reason: why };
  const land = env.land(x, y);
  if (land) return { ok: false, reason: land };
  return { ok: true, tiles: [x, y, pick ? FLYOVER_EW : FLYOVER_NS, 1], cost: isFlyoverAux(a) ? 0 : FLYOVER_COST };
}
