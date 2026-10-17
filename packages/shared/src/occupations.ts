import { TICKS_PER_HOUR } from './constants';
import { MANIFEST } from './buildings/compiled';
import type { OccupationDef, Shift } from './buildings/schema';

export type { Shift };
export interface Occupation extends OccupationDef {
  /** workplace kind id that employs this occupation */
  kind: number;
}

/**
 * Who works when, by workplace kind id. Most people are on something like 9-5,
 * but shops, factories and emergency services keep the roads busy at all
 * hours. Shift starts are in hours; the simulation adds each citizen's
 * personal jitter and commute time. The rosters live with each kind in the
 * building catalogue (buildings/*.ts).
 */
export const OCCUPATIONS: Record<number, Occupation> = Object.fromEntries(
  MANIFEST.filter((k) => k.occupation).map((k) => [k.kindId, { ...k.occupation!, kind: k.kindId }]),
);

export function pickShift(o: Occupation, rand = Math.random): Shift {
  const total = o.shifts.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const s of o.shifts) { r -= s.weight; if (r <= 0) return s; }
  return o.shifts[o.shifts.length - 1];
}
export const hoursToTicks = (h: number) => Math.round(h * TICKS_PER_HOUR);
