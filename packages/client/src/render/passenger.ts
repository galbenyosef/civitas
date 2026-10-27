import { hash2, ACROSS, SEATS, type PlaneType } from '@msimcity/shared';

/**
 * Riding as a passenger in the first-person view (render/fpv.ts, docs/transit.md "Riding along"): where a rider sits in a bus,
 * a carriage, a tube car or a plane, and the hand-over between following them on the street and sitting with them aboard.
 * Pure functions of the rider and the vehicle, so the same rider always takes the same seat (scripts/passenger-check.ts).
 */

export type PaxKind = 'bus' | 'rail' | 'metro' | 'plane';

/**
 * A seat in the vehicle's own frame: +x forward (a train's: towards its front, the way its arclength grows; a plane's nose), +y up from
 * the pose's own height (the road, the rail head, the plane's gear), +z to the right. The eye looks `yaw` radians to the right of
 * the nose and `dip` radians down.
 */
export interface Seat {
  x: number; y: number; z: number;
  yaw: number; dip: number;
  /** the side of the vehicle the seat is on: -1 left, 1 right */
  side: -1 | 1;
  /** a train: the vehicle index in the consist (0 the front); a plane: the row (1 the front) and the letter (0 = A, from the left window) */
  car: number; row: number; letter: number;
  /** a plane: the seat is by the window (otherwise one or more seats in), and the wing is outside it */
  window: boolean; wing: boolean;
  /** 0..1, the seed for everything about the seat's surroundings (organic rule) */
  seed: number;
}
export const seat = (): Seat => ({ x: 0, y: 0, z: 0, yaw: 0, dip: 0, side: 1, car: 0, row: 0, letter: 0, window: true, wing: false, seed: 0 });

/** a train's passenger vehicles in a consist: carriages (1), driving trailers (2), tube cars (7, 8); locomotives and wagons carry nobody */
export const carriesRiders = (kind: number) => kind === 1 || kind === 2 || kind === 7 || kind === 8;

/**
 * Where a rider sits. Bus: a forward-facing seat one to four rows behind the middle door, left or right of the aisle. Carriage: a
 * window seat in the middle bay (inside the carriage's middle window, so nothing of the body is in the view), turned 35 degrees to
 * the window so the world slides by it. Tube car: a seat on one side under a window, looking straight across the car and out of
 * the far window, as one does on the tube. `kinds` is the consist (trains), the car is picked among the ones that carry riders.
 * `dir` (trains) is the way the train runs (+1 towards its front): a forward-facing seat faces it.
 */
export function pickSeat(kind: Exclude<PaxKind, 'plane'>, rider: number, kinds: readonly number[] | null, dir: 1 | -1, out: Seat): Seat {
  const side: -1 | 1 = hash2(rider, 405) < 0.5 ? -1 : 1;
  out.side = side; out.seed = hash2(rider, 417); out.row = 0; out.letter = 0; out.window = true; out.wing = false; out.car = 0;
  if (kind === 'bus') {
    // the window band runs x -0.27..0.23 and y 0.135..0.21 (render/citizens.ts busBody); seated eye just above its middle
    const row = Math.floor(hash2(rider, 403) * 4);
    out.x = 0.08 - 0.065 * row; out.y = 0.178; out.z = side * 0.046;
    out.yaw = 0; out.dip = 0.06; out.row = row + 1;
    return out;
  }
  if (kinds?.length) {
    let n = 0;
    for (const k of kinds) if (carriesRiders(k)) n++;
    let pick = Math.floor(hash2(rider, 401) * Math.max(1, n));
    for (let j = 0; j < kinds.length; j++) if (carriesRiders(kinds[j]) && pick-- === 0) { out.car = j; break; }
  }
  const back = dir < 0 ? Math.PI : 0;
  if (kind === 'rail') {
    // the carriage's middle window is x -0.135..0.135, y 0.15..0.215 over the rail head (render/trains.ts carriage)
    out.x = (hash2(rider, 407) - 0.5) * 0.16; out.y = 0.178; out.z = side * 0.056;
    // facing the way the train runs, turned to the window: to the right of the run is +z when it runs forward, -z when it runs back
    out.yaw = back + side * dir * 0.62; out.dip = 0.07;
    return out;
  }
  // a tube car's windows are x ±(0.055..0.235), y 0.12..0.18 over the rail head (render/trains.ts tubeBody); seated eye in that band
  out.x = (hash2(rider, 411) < 0.5 ? -1 : 1) * (0.145 + (hash2(rider, 413) - 0.5) * 0.07);
  out.y = 0.138; out.z = side * 0.062;
  out.yaw = -side * Math.PI / 2; out.dip = 0.025;
  return out;
}

/**
 * Each plane type's cabin as render/planes.ts builds it: the fuselage radius, the window band (x from its rear to its front, and the
 * eye's height in the middle of it, so the eye sits inside the band's glass and the body hides nothing), and the wing root's trailing
 * and leading edge (a turboprop's wing is high, over the windows).
 */
export const CABIN: Record<PlaneType, { r: number; x0: number; x1: number; y: number; w0: number; w1: number; high?: boolean }> = {
  turboprop: { r: 0.13, x0: -0.27, x1: 0.66, y: 0.3, w0: 0.0, w1: 0.55, high: true },
  regional: { r: 0.115, x0: -0.35, x1: 0.93, y: 0.258, w0: -0.08, w1: 0.42 },
  narrowbody: { r: 0.17, x0: -0.25, x1: 1.12, y: 0.346, w0: 0.1, w1: 0.75 },
  widebody: { r: 0.25, x0: -0.75, x1: 1.65, y: 0.498, w0: 0.0, w1: 0.95 },
  jumbo: { r: 0.26, x0: -0.85, x1: 1.65, y: 0.508, w0: 0.0, w1: 1.0 },
  bizjet: { r: 0.075, x0: -0.08, x1: 0.42, y: 0.18, w0: -0.02, w1: 0.35 },
};
/** how far off the nose a passenger looks out of the window */
export const WINDOW_YAW = (70 * Math.PI) / 180;
/** over the wing: just aft of the beam, where the swept wing runs out to its tip */
export const WING_YAW = (100 * Math.PI) / 180;

/**
 * A seat of a plane from its manifest label ('12C'): the row from the front of the window band to its back, the letter's side
 * (A from the left window), the eye near the window for a window seat and further in for the others, looking 70 degrees off the
 * nose and a little down. `wing` when the row is over the wing root. Null for a label the type has no seat for.
 */
export function cabinSeat(type: PlaneType, label: string, out: Seat): Seat | null {
  const m = /^(\d+)([A-Z])$/.exec(label);
  if (!m) return null;
  const across = ACROSS[type], rows = Math.ceil(SEATS[type] / across);
  const row = Number(m[1]), letter = m[2].charCodeAt(0) - 65;
  if (row < 1 || row > rows || letter < 0 || letter >= across) return null;
  const c = CABIN[type];
  const side: -1 | 1 = letter < across / 2 ? -1 : 1;
  const fromWindow = side < 0 ? letter : across - 1 - letter;
  out.x = c.x1 - 0.04 - ((row - 1) / Math.max(1, rows - 1)) * (c.x1 - c.x0 - 0.08);
  out.y = c.y;
  out.z = side * c.r * (fromWindow === 0 ? 0.72 : Math.max(0.12, 0.5 - 0.14 * (fromWindow - 1)));
  out.side = side; out.car = 0; out.row = row; out.letter = letter;
  out.window = fromWindow === 0; out.wing = out.x >= c.w0 - 0.02 && out.x <= c.w1 + 0.02;
  // the wing sweeps back from beside the seat: over it, look a little aft of the beam and down (up at a turboprop's high wing) to have it in the window
  out.yaw = side * (out.wing ? WING_YAW : WINDOW_YAW); out.dip = out.wing ? (c.high ? -0.1 : 0.06) : 0.1;
  out.seed = hash2(row * 31 + letter, 419);
  return out;
}

// ---- the hand-over --------------------------------------------------------------------------------

/** what the first-person view shows of a followed citizen: the street follow or a seat (`key` the vehicle's, aboardKey) */
export interface Handover { shown: 'street' | 'seat'; key: string; lost: number }
export const handover = (): Handover => ({ shown: 'street', key: '', lost: 0 });
export interface HandIn {
  /** the street has the citizen (the agent stream draws them) */
  eye: boolean;
  /** the vehicle the latest inspect sits them in ('' none) */
  aboard: string;
  /** that vehicle's seat can be posed this frame, and the one on show can (its vehicle may be another) */
  found: boolean; foundShown: boolean;
  /** the inspect says they ride (or the trip has a ride leg): wait longer before giving up */
  riding: boolean;
  /** the fade, 0 dark .. 1 shown */
  level: number;
  dt: number;
}
export interface HandOut {
  /** what to draw this frame: the street follow, the seat on show, or nothing new (the last picture holds) */
  draw: 'street' | 'seat' | 'none';
  /** fade out (the room fade) */
  hold: boolean;
  /** give up: end the view */
  end: boolean;
  /** the view just changed to `draw` (it was dark): start its pose afresh */
  switched: boolean;
}
export const handOut = (): HandOut => ({ draw: 'street', hold: false, end: false, switched: false });

/** how long the view waits, dark, for a citizen who has gone from the street with no seat to show; longer on a ride */
export const LOST_WAIT = 3, RIDE_WAIT = 5;

/**
 * One frame of the hand-over. A citizen who has gone from the street while the inspect sits them in a vehicle fades through black
 * into the seat; once the inspect stops saying so and the street has them again, it fades back to the street follow (and a change
 * of vehicle fades from one seat to the next). Nothing to show (gone from the street and not, or not yet, aboard a vehicle the
 * client can pose): the picture holds, fades after 0.35 s, and the view ends after LOST_WAIT seconds, RIDE_WAIT on a ride, since
 * boarding takes up to a second to show in the inspect.
 */
export function handStep(h: Handover, i: HandIn, out: HandOut): HandOut {
  const seatWanted = i.aboard !== '' && (!i.eye || h.shown === 'seat');
  const want = seatWanted ? (i.found ? 'seat' : 'none') : i.eye ? 'street' : 'none';
  const keep = h.shown === 'seat' ? (i.foundShown ? 'seat' : 'none') : i.eye ? 'street' : 'none';
  out.end = false; out.switched = false;
  if (want === 'none') {
    h.lost += i.dt;
    out.draw = keep; out.hold = h.lost > 0.35;
    out.end = h.lost > (i.riding || h.shown === 'seat' ? RIDE_WAIT : LOST_WAIT);
    return out;
  }
  h.lost = 0;
  if (want === h.shown && (want === 'street' || h.key === i.aboard)) { out.draw = want; out.hold = false; return out; }
  // a different view: fade the one on show out first, then change while it is dark
  if (i.level > 0) { out.draw = keep; out.hold = true; return out; }
  h.shown = want; h.key = want === 'seat' ? i.aboard : '';
  out.draw = want; out.hold = false; out.switched = true;
  return out;
}

/** the key of the vehicle an inspect's `aboard` names ('' none): a bus by its agent id, a train by its line and number */
export const aboardKey = (ab: { mode: string; vehicle: number; line: number; train?: number } | undefined): string =>
  !ab ? '' : ab.mode === 'bus' ? `c${ab.vehicle}` : `t${ab.line}:${ab.train ?? 0}`;
