import { isRoad } from './tile';
import { ROAD_COST, ROAD_UPKEEP } from './constants';

/**
 * Road classes (R3, docs/roads.md "Classes"): what a road tile is, kept in the low range of its aux byte
 * (docs/aux-layer.md). Class 0, the street, has no byte at all, so every road laid before classes is a street and
 * old worlds read as they did. The simulation (routing, lanes, speed, access), the tool, the drawing and the tooltip
 * all read the class from here.
 *
 * Byte: `cls | dir << 3 | junction << 5` (0x01-0x3d), the class in bits 0-2, a one-way direction in bits 3-4 and the
 * junction flag in bit 5. Directions are in DIRS order (E 0, W 1, S 2, N 3: y grows south), the order the traffic model
 * keys its lanes by. Bits 6-7 are always 0, so a class byte never reads as a structure, airfield, bridge, rail or
 * junction byte, and a road tile with one of those bytes (a bridge deck, a level crossing, a roundabout ring, a
 * flyover) has no class of its own: it is a street to everything here, and the class of the roads it joins carries on
 * either side of it.
 *
 * The avenue and the motorway are **divided**: a pair of parallel one-way tiles, one each way, with the central
 * reservation on their shared edge. Each tile carries two lanes in its direction, at the street's own two lane
 * positions, so an avenue is 2+2 and a one-way street is 2 lanes. Where a divided road meets a crossing road, turns a
 * corner or ends, the server sets the junction flag (`divJunction`) on its tiles: a junction tile has no one-way rule of
 * its own (the tiles round it still have theirs) and may be crossed, so cars turn and cross only there.
 */

/** Class ids (the low three bits of the byte). */
export const RoadCls = { Street: 0, Lane: 1, OneWay: 2, Avenue: 3, Motorway: 4, Pedestrian: 5, Ring: 6, Deck: 7 } as const;
export type RoadClsId = (typeof RoadCls)[keyof typeof RoadCls];

export interface RoadClassDef {
  id: number;
  /** lower case, as in a sentence ("Mill Lane, one-way street") */
  name: string;
  /** the tool picker's title */
  title: string;
  /** lanes on each tile: each way on a two-way road, the one way on a one-way tile (an avenue's tile is one carriageway) */
  lanes: number;
  /** one-way tiles: the drag direction is the way traffic goes */
  oneWay: boolean;
  /** laid as a pair of one-way tiles, one each way, the drag's row going the drag's way and its twin on the left */
  divided: boolean;
  /** driving speed against a street's */
  speed: number;
  /** what a tile adds to a car's route against a street's 1: the hierarchy routers prefer */
  routeCost: number;
  /** cars a tile holds each way (lanes x TRAFFIC_TUNING.laneCap at the default 2) */
  capacity: number;
  /** who may use it: everyone; 'noFrontage' (no building takes its access from it, joined only by slips); 'pedestrian' (walkers, bikes, emergencies, deliveries off-hours) */
  access: 'all' | 'noFrontage' | 'pedestrian';
  /** per tile laid on the player's own land (a divided class: per tile, so a length of avenue costs twice this) */
  cost: number;
  /** a day, per tile, charged with the parcel's roads */
  upkeep: number;
  /** the feature a tech node unlocks it by (tech.ts), or '' when free from the start */
  feature: string;
  /** rank for main-road priority (Traffic.roadRank): a bigger road wins */
  rank: number;
  /** the ghost and the overlay */
  colour: number;
  /** one line for the picker and the tour */
  blurb: string;
  /** how to build it, for the tour */
  howTo: string;
}

export const ROAD_CLASS_DEFS: readonly RoadClassDef[] = [
  { id: 0, name: 'street', title: 'Street', lanes: 1, oneWay: false, divided: false, speed: 1, routeCost: 1, capacity: 2, access: 'all', cost: ROAD_COST, upkeep: ROAD_UPKEEP, feature: '', rank: 2, colour: 0x8fb8e8,
    blurb: 'The everyday road: a lane each way, pavements, lamps, and room to park at the kerb.', howTo: 'Road (3), Street: drag from a road.' },
  { id: 1, name: 'country lane', title: 'Country lane', lanes: 1, oneWay: false, divided: false, speed: 0.8, routeCost: 1.2, capacity: 2, access: 'all', cost: 5, upkeep: 0.25, feature: '', rank: 1, colour: 0xc8b878,
    blurb: 'A cheap lane between grass verges: no kerbs, no centre line, and cars take it slowly.', howTo: 'Road (3), Country lane: drag out across open land.' },
  { id: 2, name: 'one-way street', title: 'One-way street', lanes: 2, oneWay: true, divided: false, speed: 1, routeCost: 1, capacity: 4, access: 'all', cost: 12, upkeep: 0.5, feature: 'onewayStreets', rank: 2, colour: 0x7fd0c0,
    blurb: 'Two lanes going one way: drag the way the traffic should go. Pair two of them to carry a busy route.', howTo: 'Road (3), One-way street: drag in the direction of travel; drag again the other way to reverse it.' },
  { id: 3, name: 'avenue', title: 'Avenue', lanes: 2, oneWay: true, divided: true, speed: 1, routeCost: 0.9, capacity: 4, access: 'all', cost: 25, upkeep: 1, feature: 'avenues', rank: 3, colour: 0x8ccf6a,
    blurb: 'Two tiles wide: two lanes each way either side of a planted reservation. Twice a street\'s traffic, and cars turn across it only at junctions.', howTo: 'Road (3), Avenue: drag; the row you drag goes your way and its twin is laid on your left.' },
  { id: 4, name: 'motorway', title: 'Motorway', lanes: 2, oneWay: true, divided: true, speed: 2.5, routeCost: 0.5, capacity: 4, access: 'noFrontage', cost: 40, upkeep: 2, feature: 'motorways', rank: 4, colour: 0x5f9be8,
    blurb: 'Fast and two tiles wide, with no buildings on it: streets join it by slip roads, giving way, and never cross it.', howTo: 'Road (3), Motorway: drag from the motorway connection; streets that meet it become slip roads.' },
  { id: 5, name: 'pedestrian street', title: 'Pedestrian street', lanes: 1, oneWay: false, divided: false, speed: 0.4, routeCost: 1, capacity: 2, access: 'pedestrian', cost: 15, upkeep: 0.75, feature: 'pedestrianStreets', rank: 0, colour: 0xe8a0c8,
    blurb: 'Paving and bollards: walkers and bikes only, with emergency vehicles, and deliveries before 10:00 and after 19:00. Shops on it see the most passers-by.', howTo: 'Road (3), Pedestrian street: drag along a row of shops.' },
];
export const ROAD_CLASS_COUNT = ROAD_CLASS_DEFS.length;
/**
 * The two classes no drag lays (R4, docs/roads.md "Junctions"): they are parts of junction prefabs, written by the
 * junction tools, and the picker never shows them. **Ring** (6): a tile of a 5×5 two-lane roundabout (shared/src/
 * junctions.ts planBigRoundabout), one way round in its direction (a corner: the way out of it), two lanes. **Deck** (7):
 * a motorway carriageway tile with a street carried over it on a deck on the other axis (the diamond interchange's
 * bridge, planInterchange): to everything under it a motorway tile; a step along the deck's axis is a street step on
 * route layer 1 (routeLayer), as a flyover's.
 */
export const JUNCTION_CLASS_DEFS: readonly RoadClassDef[] = [
  { id: 6, name: 'roundabout', title: 'Roundabout', lanes: 2, oneWay: true, divided: false, speed: 1, routeCost: 0.9, capacity: 4, access: 'all', cost: 0, upkeep: 1, feature: 'roundabout', rank: 3, colour: 0x9fc86a,
    blurb: 'A two-lane ring round a planted island: the inner lane for cars going past the second exit.', howTo: 'Roundabout, click an avenue junction.' },
  { id: 7, name: 'motorway', title: 'Motorway', lanes: 2, oneWay: true, divided: true, speed: 2.5, routeCost: 0.5, capacity: 4, access: 'noFrontage', cost: 0, upkeep: 2, feature: 'motorways', rank: 4, colour: 0x5f9be8,
    blurb: 'A motorway under a street bridge.', howTo: 'Interchange, click where a street meets a motorway.' },
];
/** A class the road tool may lay (the picker's six). */
export const isRoadClass = (cls: number) => Number.isInteger(cls) && cls >= 0 && cls < ROAD_CLASS_COUNT;
export const classDef = (cls: number): RoadClassDef => ROAD_CLASS_DEFS[cls] ?? JUNCTION_CLASS_DEFS[cls - ROAD_CLASS_COUNT] ?? ROAD_CLASS_DEFS[0];

/** Does a street's name already say its class ("Kingsway Avenue" on an avenue, "Hedge Lane" on a country lane)? Then the class is not said again. */
export const namesClass = (name: string, cls: number) => name.toLowerCase().endsWith(` ${classDef(cls).name.split(' ').pop()}`);

/** Hours (game clock) when deliveries may use a pedestrian street: before 10:00 and from 19:00. */
export const PEDESTRIAN_DELIVERY_HOURS: readonly [number, number] = [10, 19];
export const pedestrianDeliveryOpen = (hour: number) => hour < PEDESTRIAN_DELIVERY_HOURS[0] || hour >= PEDESTRIAN_DELIVERY_HOURS[1];

// ---- the byte -----------------------------------------------------------------------------------------------------

/** DIRS order (E, W, S, N) as steps, and the turns, the same tables as the server's traffic model. */
export const CDIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const COPP = [1, 0, 3, 2] as const;
/** The DIRS index of the step from a to b (adjacent tiles). */
export const cdirOf = (dx: number, dy: number) => (dx > 0 ? 0 : dx < 0 ? 1 : dy > 0 ? 2 : 3);
const sameAxis = (a: number, b: number) => (a < 2) === (b < 2);

export const CLASS_JUNCTION = 0x20;
/** Is this aux byte a class byte (any road class but the street)? */
export const isClassAux = (a: number) => a > 0 && a < 0x40;
/** The byte for a class, a one-way direction (DIRS index, ignored for two-way classes) and the junction flag; 0 for a street. */
export function classByte(cls: number, dir = 0, junction = false): number {
  if (!cls) return 0;
  const d = classDef(cls).oneWay ? dir & 3 : 0;
  return cls | (d << 3) | (junction && classDef(cls).divided ? CLASS_JUNCTION : 0);
}
/** The class of a road tile's aux byte: 0 (a street) for no byte or any other kind of byte. */
export const auxClass = (a: number) => (a > 0 && a < 0x40 ? a & 7 : 0);
/** The class of the road on a tile (0 when it is not a road). */
export const roadClassAt = (tile: number, aux: number) => (isRoad(tile) ? auxClass(aux) : 0);
/** The one-way direction stored in a class byte (DIRS index), whatever the junction flag says. */
export const auxDir = (a: number) => (a >> 3) & 3;
export const auxJunction = (a: number) => isClassAux(a) && (a & CLASS_JUNCTION) !== 0;
export const isOneWayAux = (a: number) => isClassAux(a) && classDef(a & 7).oneWay;
export const isDividedAux = (a: number) => isClassAux(a) && classDef(a & 7).divided;
/** A motorway carriageway tile: the motorway class, or a deck tile (the motorway under a street bridge). */
export const isMotorwayAux = (a: number) => isClassAux(a) && ((a & 7) === RoadCls.Motorway || (a & 7) === RoadCls.Deck);
/** A 5×5 roundabout's ring tile (class 6). */
export const isRingClassAux = (a: number) => isClassAux(a) && (a & 7) === RoadCls.Ring;
/** A motorway tile under a street deck (class 7): `(a & 0xe7) === 7`, the test routers make in their inner loops. */
export const isDeckClassAux = (a: number) => (a & 0xe7) === RoadCls.Deck;
/** Is the step (dx, ·) on deck tile byte a along its deck (the street over the motorway), not along the motorway? */
export const deckAxisStep = (a: number, dx: number) => ((a >> 3) & 3) < 2 ? dx === 0 : dx !== 0;
export const isPedestrianAux = (a: number) => isClassAux(a) && (a & 7) === RoadCls.Pedestrian;
/** The way traffic must go on this tile (DIRS index), or -1: two-way, or a divided road's junction tile. */
export const oneWayDir = (a: number) => (isOneWayAux(a) && !(a & CLASS_JUNCTION) ? (a >> 3) & 3 : -1);

// ---- the rules a car follows ----------------------------------------------------------------------------------------

/**
 * May a car step from road tile A (aux aA) to its neighbour B (aux aB), heading d (DIRS index)? Not against a one-way
 * tile's direction, out of A or into B; not across a divided road's reservation (between two of its tiles that both
 * have a direction, sideways to both); not onto a pedestrian street unless `service` (an emergency, or a delivery out
 * of hours). A junction tile of a divided road has no direction, so turns and crossings go through it. Street to
 * street (both bytes 0) is always allowed, so plain worlds never get past the first test.
 */
export function carStepOk(aA: number, aB: number, d: number, service = false): boolean {
  if (!(aA > 0 && aA < 0x40) && !(aB > 0 && aB < 0x40)) return true;
  // on a deck tile (class 7) a step along the deck is the street over the motorway: a street step
  if (isDeckClassAux(aA) && deckAxisStep(aA, d < 2 ? 1 : 0)) aA = 0;
  if (isDeckClassAux(aB) && deckAxisStep(aB, d < 2 ? 1 : 0)) aB = 0;
  if (!aA && !aB) return true;
  if (!service && isPedestrianAux(aB)) return false;
  const ea = oneWayDir(aA), eb = oneWayDir(aB), back = COPP[d];
  if (ea === back || eb === back) return false;
  if (ea >= 0 && eb >= 0 && ea !== d && eb !== d && isDividedAux(aA) && isDividedAux(aB)) return false; // across the reservation
  return true;
}

/**
 * How many lanes the edge from A to B heading d has (1 or 2): two where both tiles are one-way classes going that way
 * (or one of them is a divided road's junction tile, or turns the corner with it), else one. A car crosses an edge in
 * one lane of it (Traffic: strand 0 the right-hand lane at the street's lane position, strand 1 the left), so the
 * single lane of every other edge is strand 0 and plain roads are the model as it always was.
 */
export function edgeLanes(aA: number, aB: number, d: number): number {
  if (!isOneWayAux(aA) || !isOneWayAux(aB)) return 1;
  if ((isDeckClassAux(aA) && deckAxisStep(aA, d < 2 ? 1 : 0)) || (isDeckClassAux(aB) && deckAxisStep(aB, d < 2 ? 1 : 0))) return 1; // the street on the deck
  const ea = oneWayDir(aA), eb = oneWayDir(aB), back = COPP[d];
  if (ea === back || eb === back) return 1;
  return ea === d || eb === d ? 2 : 1;
}

/** Is this tile a road no building takes its access from (a motorway)? */
export const noFrontageAux = (a: number) => isMotorwayAux(a);

/**
 * Should divided road tile (x, y) be a junction tile (CLASS_JUNCTION)? Where a crossing road meets it from the side
 * (any road but its own twin, the parallel tile of the same road; a motorway is met only by another motorway, since
 * streets join it by slips and never cross), and where one meets its twin so (a street ending at an avenue from one
 * side makes both carriageways' tiles the junction: one crossing, not two); where it ends or begins (no road ahead or
 * behind, so traffic can turn round), and where its twin ends. A corner of an avenue is therefore a junction. A pure
 * function of the byte and road tiles at most two steps away, so the server keeps it by looking at the 5×5 round any
 * road change (World.refreshRoadFlags).
 */
export function divJunction(x: number, y: number, road: (x: number, y: number) => boolean, aux: (x: number, y: number) => number): boolean {
  const a = aux(x, y);
  if (!isDividedAux(a) || isDeckClassAux(a)) return false; // a deck tile is a carriageway under a bridge, never a junction
  if (crossedDivided(x, y, a, road, aux)) return true;
  const d = auxDir(a), [dx, dy] = CDIRS[d];
  if (!road(x + dx, y + dy) || !road(x - dx, y - dy)) return true;
  for (const s of [1, -1]) {
    const nx = x - dy * s, ny = y + dx * s, b = aux(nx, ny);
    if (!road(nx, ny) || !isDividedAux(b) || !sameAxis(auxDir(b), d)) continue;
    const [tx, ty] = CDIRS[auxDir(b)];
    if (!road(nx + tx, ny + ty) || !road(nx - tx, ny - ty) || crossedDivided(nx, ny, b, road, aux)) return true;
  }
  return false;
}
/** A road other than its twin meets divided tile (x, y) (byte a) from the side (divJunction's first rule). */
function crossedDivided(x: number, y: number, a: number, road: (x: number, y: number) => boolean, aux: (x: number, y: number) => number): boolean {
  const d = auxDir(a), [dx, dy] = CDIRS[d], motorway = isMotorwayAux(a);
  for (const s of [1, -1]) {
    const nx = x - dy * s, ny = y + dx * s;
    if (!road(nx, ny)) continue;
    const b = aux(nx, ny);
    if (isDividedAux(b) && sameAxis(auxDir(b), d)) continue; // its twin
    if (motorway && !isMotorwayAux(b)) continue;
    return true;
  }
  return false;
}

/** The tile on the left of divided tile (x, y) (byte a): where its twin carriageway runs. */
export const twinTileOf = (x: number, y: number, a: number): [number, number] => { const [dx, dy] = CDIRS[auxDir(a)]; return [x + dy, y - dx]; };

// ---- laying a divided road -----------------------------------------------------------------------------------------

/**
 * The tiles of a drag with their one-way directions: each tile takes the way the drag goes on from it (the last, the
 * way it came in), so a corner takes the way out of it.
 */
export function dragDirs(path: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const [ax, ay] = path[i], nb = path[i + 1] ?? path[i - 1];
    if (!nb) { out.push(0); continue; }
    const fwd = i + 1 < path.length;
    out.push(fwd ? cdirOf(nb[0] - ax, nb[1] - ay) : cdirOf(ax - nb[0], ay - nb[1]));
  }
  return out;
}

/**
 * A divided road's second row: the twin of each tile of the drag, one step to the drag's left (traffic keeps right,
 * so the row going the other way is on the left), going the other way. Round a corner the twin row cuts inside or runs
 * outside it, without repeating a tile or taking one of the drag's own. In drag order, with each tile's direction and
 * the drag tile it pairs with (`from`, an index into the path).
 */
export function twinRow(path: readonly (readonly [number, number])[]): { x: number; y: number; dir: number; from: number }[] {
  const dirs = dragDirs(path), on = new Set(path.map(([x, y]) => `${x},${y}`)), seen = new Set<string>();
  const out: { x: number; y: number; dir: number; from: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    // the left of the way in and the way out (they differ only at a corner)
    const dIn = i > 0 ? cdirOf(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]) : dirs[i];
    for (const d of dIn === dirs[i] ? [dirs[i]] : [dIn, dirs[i]]) {
      const [dx, dy] = CDIRS[d];
      const lx = path[i][0] + dy, ly = path[i][1] - dx; // left of heading (dx, dy) with y down
      const k = `${lx},${ly}`;
      if (on.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push({ x: lx, y: ly, dir: COPP[d], from: i });
    }
  }
  // an outside corner: the twin row has a gap at the corner's diagonal; fill it so the row joins up
  for (let i = 1; i + 1 < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 2 && a.x !== b.x && a.y !== b.y) {
      const c = { x: a.x + (b.x - a.x) * (a.dir < 2 ? 1 : 0), y: a.y + (b.y - a.y) * (a.dir < 2 ? 0 : 1), dir: a.dir, from: a.from };
      const k = `${c.x},${c.y}`;
      if (!on.has(k) && !seen.has(k)) { seen.add(k); out.splice(i, 0, c); i++; }
    }
  }
  return out;
}
