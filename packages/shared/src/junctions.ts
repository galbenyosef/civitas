import { isRoad, zoneOf, levelOf, underConstruction, terrainOf, Terrain } from './tile';
import { Zone } from './buildings/codes';
import { isBridgeAux, bridgeStepOk, BRIDGE_AUX } from './bridges';
import { isClassAux, auxClass, auxDir, auxJunction, isDividedAux, isMotorwayAux, isPedestrianAux, isDeckClassAux, deckAxisStep, isRingClassAux, RoadCls, classByte, CDIRS, oneWayDir } from './roadclass';
import { junctionGroup, linkedDegree } from './signals';

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
/**
 * R4 (docs/roads.md "Junctions"). **Mini-roundabout** (0xfb): the junction tile of a crossroads or T of streets or
 * lanes, still a road, drawn as a painted disc; one car in the box at a time, giving way to the left (Traffic.canEnter).
 * **Big island** (0xfc): an island tile of a 5×5 two-lane roundabout (planBigRoundabout), not a road; its nine tiles
 * are planted as one (the centre is the one with island on all four sides). The ring itself is road class 6
 * (roadclass.ts RoadCls.Ring), one way round in each tile's direction.
 */
export const MINI_AUX = 0xfb;
export const BIG_ISLAND_AUX = 0xfc;
export const isMiniAux = (a: number) => a === MINI_AUX;
export const isBigIslandAux = (a: number) => a === BIG_ISLAND_AUX;
export const isRingAux = (a: number) => (a & 0xf8) === RING_AUX;
export const ringPos = (a: number) => a & 7;
export const isIslandAux = (a: number) => a === ISLAND_AUX;
export const isFlyoverAux = (a: number) => a === FLYOVER_EW || a === FLYOVER_NS;
/** The flyover's deck carries the east-west road (else the north-south one). */
export const deckEW = (a: number) => a === FLYOVER_EW;
/** Any junction byte: ring, island, flyover, mini-roundabout or big island. */
export const isJunctionAux = (a: number) => a >= RING_AUX && a <= BIG_ISLAND_AUX;
/** Routers skip junctionStepOk for aux bytes below this: nothing under it (airfield paint) restricts a step. */
export const STEP_RULE_AUX = BRIDGE_AUX;

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
 * not known, e.g. the first tile of a search)? Round a ring only forwards; across a flyover only straight on; off a
 * bridge deck only along it.
 */
export function junctionStepOk(aux: (x: number, y: number) => number, ax: number, ay: number, bx: number, by: number, pdx: number, pdy: number): boolean {
  const a = aux(ax, ay);
  if (isDeckClassAux(a)) return (pdx === 0 && pdy === 0) || (bx - ax === pdx && by - ay === pdy); // on the deck or under it: straight on
  if (isBridgeAux(a)) return bridgeStepOk(a, ax, ay, bx, by); // off a bridge deck only along it (shared/src/bridges.ts)
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
export const routeLayer = (a: number, dx: number) => ((isFlyoverAux(a) && dx === 0) || (isDeckClassAux(a) && deckAxisStep(a, dx)) ? 1 : 0);
/** Must a router call junctionStepOk for a step out of a tile with aux byte a (bridges, rings, flyovers, deck tiles)? */
export const stepRuleAux = (a: number) => a >= STEP_RULE_AUX || (a & 0xe7) === 7;

// ---- placement ---------------------------------------------------------------------------------------
export const ROUNDABOUT_COST = 600;
export const FLYOVER_COST = 900;
/** R4 junction prefabs (docs/structures.md "Built: R4 junctions"): a painted mini-roundabout, a 5×5 two-lane ring, a diamond interchange. */
export const MINI_ROUNDABOUT_COST = 150;
export const BIG_ROUNDABOUT_COST = 1500;
export const INTERCHANGE_COST = 2500;
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

// ---- R4: mini-roundabouts, 5×5 roundabouts, diamond interchanges ------------------------------------------------

const roadOf = (env: JunctionEnv) => (x: number, y: number) => road(env, x, y);
/** The class byte of a road tile, 0 for a street or any other byte. */
const clsAux = (env: JunctionEnv, x: number, y: number) => { const a = env.aux(x, y); return isClassAux(a) ? a : 0; };

/**
 * A mini-roundabout on the junction (x, y): a crossroads or T of streets or country lanes (three or four arms cars use,
 * none of them a divided road: an avenue needs the big roundabout). The tile stays road and takes MINI_AUX, so its
 * lights, if any, go.
 */
export function planMiniRoundabout(x: number, y: number, env: JunctionEnv): JunctionPlan {
  if (!road(env, x, y)) return { ok: false, reason: 'Click a junction: a mini-roundabout goes on a crossroads or T-junction of streets' };
  const a = env.aux(x, y);
  if (isMiniAux(a)) return { ok: false, reason: 'That is already a mini-roundabout' };
  if (a && !(isClassAux(a) && auxClass(a) === RoadCls.Lane)) return { ok: false, reason: isClassAux(a) ? 'A mini-roundabout goes where streets or lanes meet (an avenue needs the big roundabout)' : 'Something else is in the way (a roundabout, flyover, track or bridge)' };
  const env2 = { road: roadOf(env), aux: (tx: number, ty: number) => clsAux(env, tx, ty) };
  if (linkedDegree(env2.road, env2.aux, x, y) < 3) return { ok: false, reason: 'A mini-roundabout goes on a junction of three or four roads' };
  for (const [dx, dy] of STEPS) {
    const b = env.aux(x + dx, y + dy);
    if (!road(env, x + dx, y + dy)) continue;
    if (isDividedAux(b) || (isClassAux(b) && auxClass(b) === RoadCls.OneWay)) return { ok: false, reason: 'A mini-roundabout goes where two-way streets meet (avenues and one-way streets: the big roundabout or lights)' };
    if (isFlyoverAux(b) || isRingAux(b)) return { ok: false, reason: 'Too close to a flyover or roundabout' };
  }
  const own = env.land(x, y);
  if (own) return { ok: false, reason: own };
  return { ok: true, tiles: [x, y, MINI_AUX, 1], cost: MINI_ROUNDABOUT_COST };
}

/**
 * A 5×5 roundabout's ring, in driving order from the north-west corner, as offsets from the box's min corner, with each
 * tile's way out (DIRS index: E 0, W 1, S 2, N 3). Anticlockwise seen from above (traffic drives on the right): down the
 * west side, east along the south, up the east side, west along the north. Arms join at the middle three tiles of a side.
 */
export const BIG_RING: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) out.push([0, i, 2]); // west side going south (the north-west corner's way out is south)
  for (let i = 0; i < 4; i++) out.push([i, 4, 0]); // south side going east
  for (let i = 0; i < 4; i++) out.push([4, 4 - i, 3]); // east side going north
  for (let i = 0; i < 4; i++) out.push([4 - i, 0, 1]); // north side going west
  return out;
})();
/** Is (ox, oy) (offsets in a 5×5 box) a corner of the ring? */
const ringCorner = (ox: number, oy: number) => (ox === 0 || ox === 4) && (oy === 0 || oy === 4);

/**
 * A 5×5 two-lane roundabout on an avenue junction (R4): the junction group of the clicked tile (shared/src/signals.ts
 * junctionGroup) at the box's middle, its 3×3 island round it (BIG_ISLAND_AUX, not road), the sixteen tiles round that
 * the ring (road class 6, one way round, two lanes). Each arm must join at the middle three tiles of a side: an avenue's
 * two carriageways come in at two of them (the way out first in driving order, then the way in), a street at the middle
 * one; corners take no road. The box goes from the group's anchor less two each way, so an avenue's pair sits at a
 * side's second and third tiles from the group's side.
 */
export function planBigRoundabout(x: number, y: number, env: JunctionEnv): JunctionPlan {
  if (!road(env, x, y)) return { ok: false, reason: 'Click an avenue junction: the big roundabout replaces where an avenue is crossed or joined' };
  if (isJunctionAux(env.aux(x, y)) || isRingClassAux(env.aux(x, y))) return { ok: false, reason: 'That is already a roundabout or flyover' };
  const rf = roadOf(env), ca = (tx: number, ty: number) => clsAux(env, tx, ty);
  const g = junctionGroup(rf, ca, x, y);
  if (!g) return { ok: false, reason: 'A roundabout goes on a junction of three or four roads' };
  let divided = false;
  for (let ty = g.y; ty < g.y + g.h; ty++) for (let tx = g.x; tx < g.x + g.w; tx++) if (isDividedAux(ca(tx, ty))) divided = true;
  if (!divided) return { ok: false, reason: 'The big roundabout is for avenues (a street junction takes the 3×3 roundabout)' };
  for (let ty = g.y; ty < g.y + g.h; ty++) for (let tx = g.x; tx < g.x + g.w; tx++) if (isMotorwayAux(ca(tx, ty))) return { ok: false, reason: 'Motorways have no roundabouts: an interchange joins a street to one' };
  const X0 = g.x - 2, Y0 = g.y - 2;
  const tiles: number[] = [];
  const inBox = (tx: number, ty: number) => tx >= X0 && ty >= Y0 && tx < X0 + 5 && ty < Y0 + 5;
  for (let oy = 0; oy < 5; oy++) for (let ox = 0; ox < 5; ox++) {
    const tx = X0 + ox, ty = Y0 + oy, t = env.tile(tx, ty);
    if (t === undefined) return { ok: false, reason: 'Too close to the edge of the loaded map' };
    const a = env.aux(tx, ty);
    if (a && !isClassAux(a)) return { ok: false, reason: 'Something else is in the way (a structure, track, bridge or another junction)' };
    if (isMotorwayAux(a) || isPedestrianAux(a)) return { ok: false, reason: 'A motorway or pedestrian street is in the way' };
    if (terrainOf(t) === Terrain.Water) return { ok: false, reason: 'A roundabout cannot go on water' };
    const lot = zoneOf(t) >= Zone.Residential && zoneOf(t) <= Zone.Office && levelOf(t) === 0 && !underConstruction(t);
    if (!isRoad(t) && zoneOf(t) !== Zone.None && !lot) return { ok: false, reason: 'Clear the land first: the big roundabout needs 5×5 tiles of road, empty lots or open ground' };
    const why = env.land(tx, ty);
    if (why) return { ok: false, reason: why };
  }
  // the ring, and the roads that meet it from outside: only at the middle three tiles of a side, never a corner
  for (const [ox, oy, out] of BIG_RING) {
    const tx = X0 + ox, ty = Y0 + oy;
    for (const [dx, dy] of STEPS) {
      const nx = tx + dx, ny = ty + dy;
      if (inBox(nx, ny) || !road(env, nx, ny)) continue;
      if (ringCorner(ox, oy)) return { ok: false, reason: 'A road meets the roundabout at a corner; roads can only join a side' };
      const b = env.aux(nx, ny);
      if (isJunctionAux(b) || isRingClassAux(b)) return { ok: false, reason: 'Too close to another roundabout or flyover' };
      if (isMotorwayAux(b)) return { ok: false, reason: 'A motorway meets it: motorways join streets by interchanges' };
      if (isPedestrianAux(b)) continue; // a pedestrian street at its edge is no arm
      // a one-way arm must run with the ring: in to it, or out of it, never along it from outside
      const od = oneWayDir(b);
      if (od >= 0 && CDIRS[od][0] !== -dx && CDIRS[od][1] !== -dy && CDIRS[od][0] !== dx && CDIRS[od][1] !== dy) return { ok: false, reason: 'A one-way road runs alongside the roundabout' };
    }
    tiles.push(tx, ty, classByte(RoadCls.Ring, out), 1);
  }
  for (let oy = 1; oy < 4; oy++) for (let ox = 1; ox < 4; ox++) tiles.push(X0 + ox, Y0 + oy, BIG_ISLAND_AUX, 0);
  return { ok: true, tiles, cost: BIG_ROUNDABOUT_COST };
}
/** The 5×5 box (min corner) of the big roundabout one of whose ring or island tiles is (x, y), or null. */
export function bigRingAt(aux: (x: number, y: number) => number, x: number, y: number): [number, number] | null {
  const a = aux(x, y);
  if (!isRingClassAux(a) && !isBigIslandAux(a)) return null;
  // walk to the island's north-west tile: the island tile with no island west or north of it
  let ix = x, iy = y;
  if (isRingClassAux(a)) {
    let found = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) if (isBigIslandAux(aux(x + dx, y + dy))) { ix = x + dx; iy = y + dy; found = true; break; }
    if (!found) return null;
  }
  for (let i = 0; i < 3 && isBigIslandAux(aux(ix - 1, iy)); i++) ix--;
  for (let i = 0; i < 3 && isBigIslandAux(aux(ix, iy - 1)); i++) iy--;
  return [ix - 1, iy - 1];
}

/**
 * A diamond interchange (R4, docs/structures.md section 4) where a street meets or crosses a motorway: click the
 * motorway (or the street's tile beside it). The street goes over both carriageways on a deck (road class 7 under it);
 * each carriageway gets an off slip that leaves it four tiles before the bridge and an on slip that joins it four tiles
 * after, one-way streets running parallel a tile out (a verge row between) to a junction with the street, where they
 * give way. Footprint 9 along the motorway × 6 across. Everything is an ordinary road tile of its class, so the
 * traffic model and the routers need nothing new but the deck.
 *
 * Laid out in a frame along the motorway: u along it, v across, carriageway A (v0) the one going -u with its slips on
 * the -v side, B (v0 + 1) going +u with its slips on the +v side. An east-west motorway: u = x, v = y (A westbound, the
 * north row). A north-south one: x = v, y = -u (A southbound, the west column).
 */
export interface InterchangeLayout {
  /** tiles to write, flat [x, y, aux, road (1/0), ...], as JunctionPlan.tiles */
  tiles: number[];
  /** the deck's two tiles, and the ramp tiles either side (drawn rising to it) */
  deck: [number, number][]; ramps: [number, number][];
  /** the box: min corner and size */
  x: number; y: number; w: number; h: number;
}
export function planInterchange(x: number, y: number, env: JunctionEnv): JunctionPlan & { layout?: InterchangeLayout } {
  if (!road(env, x, y)) return { ok: false, reason: 'Click a motorway where a street meets it' };
  // the motorway tile: the clicked one, or the street's neighbour on the motorway
  let mx = x, my = y;
  if (!isMotorwayAux(env.aux(x, y))) {
    let found = false;
    for (const [dx, dy] of STEPS) if (road(env, x + dx, y + dy) && isMotorwayAux(env.aux(x + dx, y + dy))) { mx = x + dx; my = y + dy; found = true; break; }
    if (!found) return { ok: false, reason: 'Click a motorway where a street meets it' };
  }
  const ma = env.aux(mx, my);
  if (isDeckClassAux(ma)) return { ok: false, reason: 'There is an interchange here already' };
  if (auxJunction(ma)) return { ok: false, reason: 'Not at a motorway junction: pick a straight stretch' };
  const md = auxDir(ma), ew = md < 2;
  // A goes -u: an east-west motorway's westbound row (1), a north-south one's southbound column (2)
  const aDir = ew ? 1 : 2, bDir = ew ? 0 : 3;
  // the frame: world from (u, v), and v0 (carriageway A) from the clicked carriageway
  const W = (u: number, v: number): [number, number] => (ew ? [u, v] : [v, -u]);
  const [mu, mv] = ew ? [mx, my] : [-my, mx];
  const v0 = md === aDir ? mv : mv - 1, us = mu;
  const dirOf = (ld: 'u-' | 'u+' | 'v-' | 'v+') => (ew ? { 'u-': 1, 'u+': 0, 'v-': 3, 'v+': 2 } : { 'u-': 2, 'u+': 3, 'v-': 1, 'v+': 0 })[ld];
  // the motorway: plain, straight and the right way along both carriageways from us - 5 to us + 5
  for (let u = us - 5; u <= us + 5; u++) for (const [v, want] of [[v0, aDir], [v0 + 1, bDir]] as const) {
    const [tx, ty] = W(u, v), a = env.aux(tx, ty);
    if (!road(env, tx, ty) || !isMotorwayAux(a) || isDeckClassAux(a) || auxClass(a) !== RoadCls.Motorway) return { ok: false, reason: 'An interchange needs a straight motorway five tiles either side of the street' };
    if (auxJunction(a) || auxDir(a) !== want) return { ok: false, reason: 'Too close to the end, a bend or a junction of the motorway' };
  }
  const tiles: number[] = [], deck: [number, number][] = [], ramps: [number, number][] = [];
  const put = (u: number, v: number, aux: number, isRoad: 0 | 1) => { const [tx, ty] = W(u, v); tiles.push(tx, ty, aux, isRoad); };
  const ow = (ld: 'u-' | 'u+' | 'v-' | 'v+') => classByte(RoadCls.OneWay, dirOf(ld));
  // each side: s = -1 for A's slips (v0 - 1, v0 - 2), +1 for B's (v0 + 2, v0 + 3)
  for (const s of [-1, 1] as const) {
    const vVerge = s < 0 ? v0 - 1 : v0 + 2, vSlip = s < 0 ? v0 - 2 : v0 + 3;
    // A flows -u: off slip from us + 4 (upstream), on slip back at us - 4; B flows +u: off at us - 4, on at us + 4
    const off = s < 0 ? us + 4 : us - 4, on = s < 0 ? us - 4 : us + 4;
    const along = s < 0 ? 'u-' : 'u+', outward = s < 0 ? 'v-' : 'v+', inward = s < 0 ? 'v+' : 'v-';
    put(off, vVerge, ow(outward), 1); // the diverge: off the carriageway, outward
    put(on, vVerge, ow(inward), 1); // the merge: back in to the carriageway
    for (let u = us - 4; u <= us + 4; u++) {
      if (u === us) { put(u, vSlip, 0, 1); put(u, vVerge, 0, 1); continue; } // the street: its junction with the slips, and the ramp
      put(u, vSlip, u === on ? ow(inward) : ow(along), 1); // the slips run along the motorway; the on slip's last tile turns in
      if (u !== off && u !== on) put(u, vVerge, 0, 0); // the verge between slips and carriageway
    }
    ramps.push(W(us, vVerge));
  }
  put(us, v0, classByte(RoadCls.Deck, aDir), 1); put(us, v0 + 1, classByte(RoadCls.Deck, bDir), 1);
  deck.push(W(us, v0), W(us, v0 + 1));
  // check every tile the plan writes (but the deck): open ground, an empty lot, or the street at us; and land
  const box = new Set<string>();
  for (let i = 0; i < tiles.length; i += 4) box.add(`${tiles[i]},${tiles[i + 1]}`);
  for (let i = 0; i < tiles.length; i += 4) {
    const tx = tiles[i], ty = tiles[i + 1], t = env.tile(tx, ty);
    if (t === undefined) return { ok: false, reason: 'Too close to the edge of the loaded map' };
    const why = env.land(tx, ty);
    if (why) return { ok: false, reason: why };
    if (isDeckClassAux(tiles[i + 2])) continue;
    const a = env.aux(tx, ty);
    const [u] = ew ? [tx] : [-ty];
    if (terrainOf(t) === Terrain.Water) return { ok: false, reason: 'An interchange cannot go on water' };
    if (isRoad(t) && u !== us) return { ok: false, reason: 'Another road is in the way of the slip roads' };
    if (a && !(isRoad(t) && isClassAux(a) && !isDividedAux(a))) return { ok: false, reason: 'Something else is in the way (a structure, track, bridge or junction)' };
    const lot = zoneOf(t) >= Zone.Residential && zoneOf(t) <= Zone.Office && levelOf(t) === 0 && !underConstruction(t);
    if (!isRoad(t) && zoneOf(t) !== Zone.None && !lot) return { ok: false, reason: 'Clear the land first: an interchange needs 9×6 tiles of open ground or empty lots beside the motorway' };
  }
  // roads from outside may meet it only where the street runs on, beyond each slip junction
  for (let i = 0; i < tiles.length; i += 4) {
    if (!tiles[i + 3] || isDeckClassAux(tiles[i + 2])) continue;
    const tx = tiles[i], ty = tiles[i + 1];
    for (const [dx, dy] of STEPS) {
      const nx = tx + dx, ny = ty + dy;
      if (box.has(`${nx},${ny}`) || !road(env, nx, ny) || isMotorwayAux(env.aux(nx, ny))) continue;
      const [nu] = ew ? [nx] : [-ny];
      if (nu === us) continue; // the street running on
      return { ok: false, reason: 'A road meets the slip roads; only the street through the interchange may' };
    }
  }
  const all = tiles.filter((_, i) => i % 4 < 2);
  const xs = all.filter((_, i) => i % 2 === 0), ys = all.filter((_, i) => i % 2 === 1);
  const bx = Math.min(...xs), by = Math.min(...ys);
  return { ok: true, tiles, cost: INTERCHANGE_COST, layout: { tiles, deck, ramps, x: bx, y: by, w: Math.max(...xs) - bx + 1, h: Math.max(...ys) - by + 1 } };
}
