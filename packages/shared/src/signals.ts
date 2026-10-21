import { TRAFFIC_TUNING } from './tuning';
import { hash2 } from './noise';
import { isDividedAux, isDeckClassAux, isPedestrianAux, carStepOk, isClassAux } from './roadclass';

/**
 * Traffic-signal timing. A signalled junction alternates green between its
 * north-south and east-west roads. Every junction has its own offset and
 * period seeded from its tile, so neighbouring lights never switch together,
 * and the phase is a pure function of (x, y, tick): the server and every
 * client agree on it without sending anything over the wire.
 */
export interface SignalTiming { offset: number; period: number }
export function signalTiming(x: number, y: number): SignalTiming {
  const P = TRAFFIC_TUNING.signalPeriod;
  // green waves (TRAFFIC_TUNING.greenWave 1): one period, offsets along the diagonal timed for waveSpeed
  if (TRAFFIC_TUNING.greenWave === 1) return waveTiming(x, y);
  return { offset: Math.floor(hash2(x, y) * 2 * P), period: Math.round(P * (0.8 + 0.4 * hash2(y, x))) };
}
/** A green wave's timing at (x, y): every light the same period, offset by -(x + y) / waveSpeed ticks. */
function waveTiming(x: number, y: number): SignalTiming {
  const P = TRAFFIC_TUNING.signalPeriod, o = Math.round(-(x + y) / TRAFFIC_TUNING.waveSpeed);
  return { offset: ((o % (2 * P)) + 2 * P) % (2 * P), period: P };
}
/**
 * The timing of a junction group (R4, junctionGroup) at anchor (gx, gy): its anchor's, as signalTiming; with greenWave 2
 * a green wave at the groups only (the avenues' junctions), every single junction keeping its own.
 */
export const groupTiming = (gx: number, gy: number): SignalTiming => (TRAFFIC_TUNING.greenWave === 2 ? waveTiming(gx, gy) : signalTiming(gx, gy));
export interface SignalPhase {
  /** the axis that has right of way this phase */
  green: 'ns' | 'ew';
  /** the last TRAFFIC_TUNING.signalAmber ticks of a green: committed cars clear the box, nobody new enters */
  amber: boolean;
  /**
   * A four-phase junction group's protected left phase (groupPhaseOf): the green axis's left turns (and U-turns) go, its
   * straight on and right turns wait; false in a through phase, when they go and the lefts wait. Always false at a
   * two-phase junction, where lefts are permitted on the green and give way.
   */
  left?: boolean;
}
export function signalPhaseOf(t: SignalTiming, tick: number, out: SignalPhase = { green: 'ns', amber: false }): SignalPhase {
  const s = tick + t.offset;
  const n = Math.floor(s / t.period);
  out.green = ((n % 2) + 2) % 2 === 0 ? 'ns' : 'ew';
  out.amber = s - n * t.period >= t.period - TRAFFIC_TUNING.signalAmber;
  out.left = false;
  return out;
}
/** Ticks of a four-phase group's protected left phase, from its through phase's (TRAFFIC_TUNING.leftPhase share, at least amber + 3). */
export const leftTicks = (period: number) => Math.max(TRAFFIC_TUNING.signalAmber + 3, Math.round(period * TRAFFIC_TUNING.leftPhase));
/**
 * The phase of a junction group (junctionGroup) with `phases` 2 or 4. Two: signalPhaseOf, as every single junction.
 * Four (two divided roads crossing): north-south straight on and right turns for `period` ticks, then north-south lefts
 * (protected) for leftTicks, then east-west straight on and right, then east-west lefts; each ends with an amber.
 */
export function groupPhaseOf(t: SignalTiming, phases: number, tick: number, out: SignalPhase = { green: 'ns', amber: false }): SignalPhase {
  if (phases !== 4) return signalPhaseOf(t, tick, out);
  const P = t.period, L = leftTicks(P), c = 2 * (P + L);
  const r = (((tick + t.offset) % c) + c) % c, half = r >= P + L, h = half ? r - P - L : r;
  out.green = half ? 'ew' : 'ns';
  out.left = h >= P;
  out.amber = (out.left ? h - P : h) >= (out.left ? L : P) - TRAFFIC_TUNING.signalAmber;
  return out;
}
export function signalPhase(x: number, y: number, tick: number, out?: SignalPhase): SignalPhase {
  return signalPhaseOf(signalTiming(x, y), tick, out);
}

/** Road arms by mask bit (N=1 E=2 S=4 W=8, y grows south), as steps in x / y. */
export const ARM_STEPS: readonly (readonly [number, number, number])[] = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]];
/**
 * The arms of a road tile that count toward a signalled junction, as a mask
 * (N=1 E=2 S=4 W=8). Every road neighbour counts except the twin lane of a
 * two-tile-wide road: a neighbour that, like this tile, has road on both
 * sides across the arm is the same street running alongside, not a side road.
 * A tile with three or more counted arms gets lights (when the owner has the
 * technology); the server enforces them and the client draws one per arm.
 */
export function signalArms(road: (x: number, y: number) => boolean, x: number, y: number): number {
  let mask = 0;
  for (const [bit, dx, dy] of ARM_STEPS) {
    if (!road(x + dx, y + dy)) continue;
    const px = -dy, py = dx; // across the arm
    const twin = road(x + px, y + py) && road(x - px, y - py) && road(x + dx + px, y + dy + py) && road(x + dx - px, y + dy - py);
    if (!twin) mask |= bit;
  }
  return mask;
}
export const armCount = (mask: number) => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
/** Does a junction with these counted arms (signalArms) get lights? Crossroads always; T-junctions when TRAFFIC_TUNING.signalT is on. */
export const signalledArms = (mask: number) => armCount(mask) >= (TRAFFIC_TUNING.signalT ? 3 : 4);

// ---- junction groups (R4, docs/roads.md "Junctions") -------------------------------------------------------------

/** DIRS order (E, W, S, N) as steps, and the opposite way: the traffic model's own tables. */
const GD: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const GOPP = [1, 0, 3, 2];
/**
 * Do road tiles (x, y) and its neighbour heading d join for cars (the traffic model's Traffic.linked): always between
 * streets; not across a divided road's reservation, nor between a pedestrian street and a road cars use.
 */
export function roadsLinked(aux: (x: number, y: number) => number, x: number, y: number, d: number): boolean {
  const a = aux(x, y), b = aux(x + GD[d][0], y + GD[d][1]);
  const ca = isClassAux(a) ? a : 0, cb = isClassAux(b) ? b : 0;
  if (!ca && !cb) return true;
  if (isPedestrianAux(ca) !== isPedestrianAux(cb)) return false;
  return carStepOk(ca, cb, d, true) || carStepOk(cb, ca, GOPP[d], true);
}
/** Road neighbours of (x, y) that join it for cars (the traffic model's degreeOf, without flyovers). */
export function linkedDegree(road: (x: number, y: number) => boolean, aux: (x: number, y: number) => number, x: number, y: number): number {
  let n = 0;
  for (let d = 0; d < 4; d++) if (road(x + GD[d][0], y + GD[d][1]) && roadsLinked(aux, x, y, d)) n++;
  return n;
}
/** A box of junction tiles that work as one junction: anchor (min x, min y), size, and how many phases its lights run. */
export interface JunctionGroup { x: number; y: number; w: number; h: number; phases: 2 | 4 }
/**
 * The junction group of road tile (x, y). Where a divided road (an avenue or motorway, two one-way carriageways) is
 * crossed or joined, the crossing is two junction tiles (avenue × street, a T on an avenue) or four (avenue × avenue),
 * and they work as one junction: one controller, its timing seeded from the group's anchor (its min x, min y), one set
 * of phases, and the lights gate only cars coming into the group, not moves between its tiles. A group is the
 * 4-connected set of divided road tiles with three or more linked road neighbours round (x, y), when it fits a 2×2 box
 * (two divided roads crossing: four phases with protected lefts) or a 1×2 (two phases); anything bigger, and any other
 * junction, is a group of one, its own anchor, exactly as every junction was before groups. Null for a tile that is not
 * a member (not a road, or fewer than three arms). A pure function of the tiles at most three steps away, shared by the
 * server (Traffic.junction) and the client (render/signals.ts), so both see the same groups and phases.
 */
export function junctionGroup(road: (x: number, y: number) => boolean, aux: (x: number, y: number) => number, x: number, y: number): JunctionGroup | null {
  if (!road(x, y)) return null;
  const member = (tx: number, ty: number) => road(tx, ty) && isDividedAux(aux(tx, ty)) && !isDeckClassAux(aux(tx, ty)) && linkedDegree(road, aux, tx, ty) >= 3;
  if (!member(x, y)) return linkedDegree(road, aux, x, y) >= 3 ? { x, y, w: 1, h: 1, phases: 2 } : null;
  const seen: number[] = [x, y];
  let x0 = x, y0 = y, x1 = x, y1 = y;
  for (let i = 0; i < seen.length && seen.length <= 10; i += 2) {
    for (let d = 0; d < 4; d++) {
      const nx = seen[i] + GD[d][0], ny = seen[i + 1] + GD[d][1];
      let dup = false;
      for (let j = 0; j < seen.length; j += 2) if (seen[j] === nx && seen[j + 1] === ny) { dup = true; break; }
      if (dup || !roadsLinked(aux, seen[i], seen[i + 1], d) || !member(nx, ny)) continue;
      seen.push(nx, ny);
      x0 = Math.min(x0, nx); y0 = Math.min(y0, ny); x1 = Math.max(x1, nx); y1 = Math.max(y1, ny);
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w > 2 || h > 2 || seen.length > 8) return { x, y, w: 1, h: 1, phases: 2 };
  return { x: x0, y: y0, w, h, phases: w === 2 && h === 2 ? 4 : 2 };
}
/** Is (tx, ty) inside group g? */
export const inGroup = (g: JunctionGroup, tx: number, ty: number) => tx >= g.x && ty >= g.y && tx < g.x + g.w && ty < g.y + g.h;
/**
 * The arms of a group as signalArms counts them, over all its tiles (N=1 E=2 S=4 W=8): the sides of the group with a
 * road coming in or going out. A group with three or more gets lights as a single junction does.
 */
export function groupArms(road: (x: number, y: number) => boolean, g: JunctionGroup): number {
  let mask = 0;
  for (let ty = g.y; ty < g.y + g.h; ty++) for (let tx = g.x; tx < g.x + g.w; tx++) {
    const m = signalArms(road, tx, ty);
    for (const [bit, dx, dy] of ARM_STEPS) if (m & bit && !inGroup(g, tx + dx, ty + dy)) mask |= bit;
  }
  return mask;
}

// ---- signal crossings (pelicans, R4) -----------------------------------------------------------------------------

/**
 * A pelican crossing's cycle, in ticks from the moment a waiting walker's press is granted (`walkAt`): amber for cars,
 * then red (walkers cross), then flashing amber (walkers finish; cars give way to anyone still on it), then green for at
 * least `minGreen` before the next press is granted. Shared: the server grants presses and sends `walkAt`, and the
 * client draws the same lamps from it.
 */
export const PELICAN = { amber: 2, walk: 6, flash: 2, minGreen: 12 } as const;
export type PelicanLamp = 'green' | 'amber' | 'red' | 'flash';
export function pelicanPhase(walkAt: number, tick: number): PelicanLamp {
  const t = tick - walkAt;
  if (!(t >= 0)) return 'green';
  if (t < PELICAN.amber) return 'amber';
  if (t < PELICAN.amber + PELICAN.walk) return 'red';
  if (t < PELICAN.amber + PELICAN.walk + PELICAN.flash) return 'flash';
  return 'green';
}
/** May a new press be granted at `tick` (the last cycle done and its minimum green served)? */
export const pelicanReady = (walkAt: number, tick: number) => !(tick - walkAt < PELICAN.amber + PELICAN.walk + PELICAN.flash + PELICAN.minGreen);
/**
 * A straight road tile with a pedestrian street meeting it on both sides across it (a pedestrian street crossing a
 * street) is a signal crossing by default. `road` and `aux` read the tiles; returns the axis of the road it crosses
 * ('ew': the road runs east-west, walkers cross north-south), or null.
 */
export function implicitPelican(road: (x: number, y: number) => boolean, aux: (x: number, y: number) => number, x: number, y: number): 'ns' | 'ew' | null {
  if (!road(x, y) || isPedestrianAux(aux(x, y))) return null;
  const ped = (tx: number, ty: number) => road(tx, ty) && isPedestrianAux(aux(tx, ty));
  const car = (tx: number, ty: number) => road(tx, ty) && !isPedestrianAux(aux(tx, ty));
  if (ped(x, y - 1) && ped(x, y + 1) && car(x - 1, y) && car(x + 1, y)) return 'ew';
  if (ped(x - 1, y) && ped(x + 1, y) && car(x, y - 1) && car(x, y + 1)) return 'ns';
  return null;
}
