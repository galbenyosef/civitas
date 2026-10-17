import { TRAFFIC_TUNING } from './tuning';
import { hash2 } from './noise';

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
  return { offset: Math.floor(hash2(x, y) * 2 * P), period: Math.round(P * (0.8 + 0.4 * hash2(y, x))) };
}
export interface SignalPhase {
  /** the axis that has right of way this phase */
  green: 'ns' | 'ew';
  /** the last TRAFFIC_TUNING.signalAmber ticks of a green: committed cars clear the box, nobody new enters */
  amber: boolean;
}
export function signalPhaseOf(t: SignalTiming, tick: number, out: SignalPhase = { green: 'ns', amber: false }): SignalPhase {
  const s = tick + t.offset;
  const n = Math.floor(s / t.period);
  out.green = ((n % 2) + 2) % 2 === 0 ? 'ns' : 'ew';
  out.amber = s - n * t.period >= t.period - TRAFFIC_TUNING.signalAmber;
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
