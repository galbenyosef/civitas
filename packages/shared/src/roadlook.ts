import { hash2 } from './noise';
import { isRoad, terrainOf, zoneOf, levelOf, Terrain } from './tile';
import { Zone } from './buildings/codes';
import { signalArms, armCount, signalledArms, ARM_STEPS } from './signals';
import { isJunctionAux } from './junctions';
import { isBridgeAux } from './bridges';
import { isRailAux } from './rail';

/**
 * How a street is marked and furnished (client/src/render/roads.ts draws it; the Showcase checks it): pure functions of
 * the tiles round a road tile, so the same street always looks the same to everyone and nothing here touches the
 * simulation. Arms are counted as the signals count them (signalArms): the twin lane of a wide road is not an arm.
 * Every choice that is not forced by the layout is hashed from the tile, so no two junctions are marked alike.
 */
export type RoadFn = (x: number, y: number) => boolean;
export type TileFn = (x: number, y: number) => number | undefined;

/** What crosses a junction mouth on foot: dropped kerbs only, a zebra (Belisha beacons) or a signal crossing (studs). */
export const MouthCrossing = { Dropped: 1, Zebra: 2, Signal: 3 } as const;
/** What an approach to a junction is told: nothing (the major road), give way (triangle, double dashes) or a stop line at lights. */
export const MouthControl = { None: 0, GiveWay: 1, Stop: 2 } as const;

/** How far a straight run is followed to tell a major road from a minor one at a crossroads. */
const RUN = 8;
/** The share of unsignalled junction mouths with a zebra; the rest are dropped kerbs. */
const ZEBRA_SHARE = 0.35;

/** A junction tile for marking: a plain road tile (no roundabout, flyover or bridge byte) with three or more arms. */
export function isMarkedJunction(road: RoadFn, aux: number, x: number, y: number): boolean {
  if (isJunctionAux(aux) || isBridgeAux(aux) || isRailAux(aux)) return false;
  return armCount(signalArms(road, x, y)) >= 3;
}

/** Road tiles straight on from (x, y) along (dx, dy), up to RUN. */
function run(road: RoadFn, x: number, y: number, dx: number, dy: number): number {
  let n = 0;
  while (n < RUN && road(x + dx * (n + 1), y + dy * (n + 1))) n++;
  return n;
}

/** Is the north-south road the minor one at a crossroads (x, y)? The shorter straight run gives way; a tie by hash. */
function nsMinor(road: RoadFn, x: number, y: number): boolean {
  const ns = run(road, x, y, 0, -1) + run(road, x, y, 0, 1), ew = run(road, x, y, -1, 0) + run(road, x, y, 1, 0);
  return ns !== ew ? ns < ew : hash2(x * 5 + 3, y * 7 + 1) < 0.5;
}

/**
 * The control on the approach by arm `bit` (N=1 E=2 S=4 W=8) of junction (x, y). `signalled`: the junction has lights
 * (its owner has the technology and signalledArms). With lights every approach stops at a line; at a T the stem gives
 * way; at a crossroads the minor road (the shorter straight run) gives way; other approaches are unmarked.
 */
export function mouthControl(road: RoadFn, x: number, y: number, bit: number, signalled: boolean): number {
  const arms = signalArms(road, x, y);
  if (!(arms & bit)) return MouthControl.None;
  if (signalled) return MouthControl.Stop;
  const n = armCount(arms), opp = ((bit << 2) | (bit >> 2)) & 15;
  if (n === 3) return arms & opp ? MouthControl.None : MouthControl.GiveWay;
  if (n >= 4) return (bit === 1 || bit === 4) === nsMinor(road, x, y) ? MouthControl.GiveWay : MouthControl.None;
  return MouthControl.None;
}

/** What crosses junction (x, y)'s mouth `bit` on foot: a signal crossing at lights, else a zebra on about a third (hashed), else dropped kerbs. */
export function mouthCrossing(x: number, y: number, bit: number, signalled: boolean): number {
  if (signalled) return MouthCrossing.Signal;
  return hash2(x * 7 + bit * 13, y * 11 - bit * 5) < ZEBRA_SHARE ? MouthCrossing.Zebra : MouthCrossing.Dropped;
}

/**
 * A zebra in the middle of a street: on a plain straight (no aux byte) at least two tiles clear of any junction, at
 * one place in each stretch of nine tiles along the street (its phase hashed by the street) and there in a little under
 * half of the stretches. Walkers cross anywhere and cars stop for anyone on the carriageway, so it is paint and
 * beacons only; it gives a town with lights everywhere its zebras.
 */
export function midZebraAt(road: RoadFn, aux: number, x: number, y: number): boolean {
  if (aux) return false;
  const arms = signalArms(road, x, y);
  if (arms !== 5 && arms !== 10) return false;
  const ns = arms === 5;
  for (const d of [-2, -1, 1, 2]) {
    const tx = ns ? x : x + d, ty = ns ? y + d : y;
    if (!road(tx, ty) || armCount(signalArms(road, tx, ty)) >= 3) return false;
  }
  const line = ns ? x : y, pos = ns ? y : x, stride = 9;
  const phase = Math.floor(hash2(line * 5 + 1, ns ? 3 : 4) * stride);
  if ((((pos + phase) % stride) + stride) % stride !== 0) return false;
  return hash2(line * 7 + 3, Math.floor((pos + phase) / stride) * 11 + (ns ? 1 : 2)) < 0.45;
}

/**
 * Does crossroads (x, y) get yellow box hatching? Where it is busy (`busy`: the client's wear from the traffic it has
 * seen; the Showcase's check passes false) and at about two in five signalled crossroads, hashed, so a grid of lights
 * is not boxed all over.
 */
export function boxJunction(road: RoadFn, x: number, y: number, signalled: boolean, busy = false): boolean {
  if (armCount(signalArms(road, x, y)) < 4) return false;
  return busy || (signalled && hash2(x * 13 + 7, y * 3 + 11) < 0.4);
}

/** The lights rule as the client draws it, for a sandbox (every owner has the technology): the Showcase's check. */
export const sandboxSignalled = (road: RoadFn, x: number, y: number) => signalledArms(signalArms(road, x, y));

/** Is this tile a front garden or open grass a verge and street trees can stand beside: a house's lot (up to level 2), or plain land? */
export function leafySide(t: number | undefined): boolean {
  if (t === undefined || isRoad(t)) return false;
  const z = zoneOf(t);
  return (z === Zone.Residential && levelOf(t) <= 2) || (z === Zone.None && terrainOf(t) === Terrain.Grass);
}

/**
 * The street tree beside road tile (x, y) on side `bit`, or null: on straights (two opposite arms) with a home's lot or
 * open grass on that side, in about seven streets in ten (hashed by the street and a stretch of it, so whole lengths
 * are tree-lined or bare), every other tile, staggered across the road. `along` is the offset along the street from the
 * tile's middle (-0.5..0.5), `k` a hash for the tree's species, size and lean.
 */
export function streetTreeAt(tile: TileFn, x: number, y: number, bit: number): { along: number; k: number } | null {
  const road = (tx: number, ty: number) => { const t = tile(tx, ty); return t !== undefined && isRoad(t); };
  const arms = signalArms(road, x, y);
  const ns = arms === 5, ew = arms === 10;
  if (!ns && !ew) return null;
  const step = ARM_STEPS.find((s) => s[0] === bit);
  if (!step || (ns && (bit === 1 || bit === 4)) || (ew && (bit === 2 || bit === 8))) return null;
  if (!leafySide(tile(x + step[1], y + step[2]))) return null;
  const line = ns ? x : y, pos = ns ? y : x, stretch = Math.floor(pos / 10);
  if (hash2(line * 3 + (ns ? 1 : 2), stretch * 7 + 5) > 0.7) return null;
  const side = bit === 2 || bit === 4 ? 1 : 0;
  if (((pos + side) & 1) !== 0) return null;
  const k = hash2(x * 17 + bit, y * 23 - bit);
  if (k < 0.08) return null; // a gap: a tree lost and not replanted
  return { along: (hash2(x * 5 - bit, y * 3 + bit * 7) - 0.5) * 0.3, k };
}
