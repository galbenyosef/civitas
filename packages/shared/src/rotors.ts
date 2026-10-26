/**
 * The wind turbine's rotor (docs/utilities.md 4.5). The kit (buildings/utilities.ts) builds only the tower; the client's
 * rotor pass (client/src/render/rotors.ts) draws the nacelle, hub and three blades on top of it, turning, so where the
 * tower stands and how tall it is live here, once, for both.
 */
import { hash2 } from './noise';
import { TICKS_PER_HOUR } from './constants';

/** the wind turbine's kind id (buildings/utilities.ts windTurbine); a design's key is `${id}:1:${design}` */
export const TURBINE_KIND = 165;

/** A tower's pivot in model space (tile units, y up): where its nacelle turns, on the top of the tower (the kit's tower stands to h + 0.02). */
export interface RotorMount { x: number; y: number; z: number }
/** The rotor in the nacelle's frame: the hub's offset from the pivot (+z is into the wind) and the blade radius as a share of the tower's height. */
export const ROTOR = { hubY: 0.026, hubZ: 0.058, bladeShare: 0.46, nacelleLen: 0.1, nacelleHeight: 0.046 } as const;

/** The towers of the two designs, by design index: the tower's axis (x, z) and the hub height. */
export const TURBINE_TOWERS: readonly { x: number; z: number; h: number }[] = [
  { x: 0, z: -0.05, h: 1.15 },
  { x: -0.08, z: -0.1, h: 0.98 },
];

/** Design key to the rotor mount, for the keys the building placement carries (`165:1:0`, `165:1:1`). */
export const ROTOR_MOUNTS: Record<string, RotorMount & { r: number }> = Object.fromEntries(
  TURBINE_TOWERS.map((t, i) => [`${TURBINE_KIND}:1:${i}`, { x: t.x, y: t.h + 0.02, z: t.z, r: t.h * ROTOR.bladeShare }]),
);

// ---------------------------------------------------------------- what turns it (pure: client/scripts/turbine-check.ts)

/** Rotor speed, rad/s, in the lightest breeze that still turns it and in a gale-force signal of 1. */
export const ROTOR_SPEED = { min: 0.45, max: 2.1 } as const;
/** Seconds a rotor takes to wind down from full speed to a stop, and to wind up to it. */
export const ROTOR_STOP_SECONDS = 10, ROTOR_START_SECONDS = 6;

/** The speed a rotor wants: 0 when its plant is not generating, else the wind (0.15-1, windAt) mapped onto the speed range, times its own jitter (about 1 ± 0.1). */
export function rotorTarget(generating: boolean, wind: number, jitter: number): number {
  if (!generating) return 0;
  const w = Math.min(1, Math.max(0, (wind - 0.15) / 0.85));
  return (ROTOR_SPEED.min + (ROTOR_SPEED.max - ROTOR_SPEED.min) * w) * jitter;
}
/** One step of a rotor: the speed ramps linearly to its target (down over ROTOR_STOP_SECONDS from full, up over ROTOR_START_SECONDS), the angle turns by the mean speed. */
export function rotorStep(angle: number, speed: number, target: number, dt: number): { angle: number; speed: number } {
  const up = (ROTOR_SPEED.max * 1.1) / ROTOR_START_SECONDS, down = (ROTOR_SPEED.max * 1.1) / ROTOR_STOP_SECONDS;
  const next = target > speed ? Math.min(target, speed + up * dt) : Math.max(target, speed - down * dt);
  return { angle: (angle + 0.5 * (speed + next) * dt) % (Math.PI * 2), speed: next };
}

/**
 * The direction the wind blows from, in radians (the turbines face into it): a slow signal hashed from the world seed,
 * eased along the shortest arc between values every twelve game hours, so a town's rotors all lean the same general way
 * and swing round together when the weather turns. Each tower adds its own offset on top (the client).
 */
export function windYaw(tick: number, seed: number): number {
  const span = 12 * TICKS_PER_HOUR, i = Math.floor(tick / span), f = (tick - i * span) / span;
  const a = hash2(i * 5 + 11, seed * 7 + 3) * Math.PI * 2, b = hash2((i + 1) * 5 + 11, seed * 7 + 3) * Math.PI * 2;
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * f * f * (3 - 2 * f);
}
