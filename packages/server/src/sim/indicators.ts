import { Indicator, TRAFFIC_TUNING as TT } from '@msimcity/shared';
import type { Mover } from '../world';
import { dirBetween } from './traffic';

const RIGHT = [2, 3, 1, 0];
/** The indicator for a turn from heading a onto heading b (DIRS indices); turning round is a left turn, since cars keep right. */
const turn = (a: number, b: number) => (a === b ? Indicator.None : b === RIGHT[a] ? Indicator.Right : Indicator.Left);
/** Heading from path node i to node i + 1, or -1 off either end of the path. */
function dirAt(m: Mover, i: number): number {
  const p = m.path;
  if (i < 0 || i * 2 + 3 >= p.length) return -1;
  return dirBetween(p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3]);
}

/**
 * What a driver's indicators show (shared Indicator, wire bits 16-17), from the route it is already driving: the
 * turn at the end of its lane, or, once it is half way down a lane that goes straight through the next tile, the turn
 * on the tile after that, so a driver signals about a tile ahead. Still coming out of the turn into its lane it keeps
 * that turn's indicator on until the wheel is straight (the turn ends half way down the lane). Hazards while backing up (a bus's three-point turn)
 * or when it has been stuck on one tile for three quarters of the stuck limit, about to give up.
 */
export function indicatorOf(m: Mover, reversing: boolean): number {
  if (m.lane < 0 || m.pi < 1) return Indicator.None;
  if (reversing || (TT.stuckLimit > 0 && m.wait > 0 && m.stuck >= TT.stuckLimit * 0.75)) return Indicator.Hazard;
  const d = dirAt(m, m.pi - 1);
  if (d < 0) return Indicator.None;
  if (m.prog < 0.45 && m.inDir !== d) return turn(m.inDir, d);
  const next = dirAt(m, m.pi);
  if (next < 0) return Indicator.None;
  if (next !== d) return turn(d, next);
  if (m.prog < 0.5) return Indicator.None;
  const after = dirAt(m, m.pi + 1);
  return after < 0 ? Indicator.None : turn(next, after);
}
