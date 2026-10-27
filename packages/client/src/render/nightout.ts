import { hash2 } from '@msimcity/shared';

/**
 * A night out in first person (playtest f425e885, "civs who have been out to dinner and/or drinking should have blurred FPV",
 * then "make it a lot blurrier please - depending on how long they were out for"), as pure rules so
 * client/scripts/nightout-check.ts can run them on a fake clock.
 *
 * The view blurs more the longer the evening has gone on, with no plateau until the third hour:
 *
 *   hours at the bar   strength   blur px (720p)   double image px   HUD
 *   1                  0.22       2                3 to 5           a little tipsy
 *   2                  0.55       5                8 to 12          tipsy
 *   3 and more         1.0        8 to 10          14 to 22         very drunk
 *
 * (for a citizen of average weight; `peak` below scales their hours, 0.7 to 1.3, so a lightweight is where an average person is
 * at 70% of the time and a heavyweight 30% sooner).
 *
 * Where the hours come from: the server's inspect carries `night` (exact hours at the venue and whether the drink flows;
 * server sim/simulation.ts nightOf), fed to `update` as `night`. Without it (an older server) the evening is read from the
 * activity line alone, as the first build did:
 *
 *   - `out at a bar`            at the pub, bar or restaurant (the server says bar for all three after 16:00): the drink flows
 *   - `... out for the evening` on the way there (or `..., going out` on a bus or a lift): sober, the night has not begun
 *   - `... home`                on the way back (`walking home`, `driving home`, `..., going home`) after a night out
 *   - anything else             sober: the cinema, the theatre, a café, work, home, the library quiz
 *
 * and someone first seen already at the bar is taken to have been there a little while (an hour, hashed), so the view does
 * not start clear in the middle of the evening. On the walk home it eases off over a time that grows with how drunk they
 * left (WALK_MIN to WALK_MAX hours), or by how far along the trip is when the server says, reaching nothing at the door.
 */
export type Phase = 'sober' | 'going' | 'at' | 'home';

/** the activity strings that count (the check lists them) */
export const BAR_ACTIVITY = 'out at a bar';
/** the walk home eases off over this long for a light evening and for a heavy one (game hours); in between by strength */
export const WALK_MIN = 0.5, WALK_MAX = 1.5;
export const WALK_HOURS = WALK_MIN;
/** hours (for an average citizen) at which the swim stops growing */
export const HEAVY_HOURS = 3;
/** a trip leg's end counts as the door only when the activity line says it is the last leg (not a bus or lift `..., going home`) */
const LAST_LEG = /^(?!.*, going home$)/;

export function phaseOf(activity: string): Phase {
  if (activity === BAR_ACTIVITY) return 'at';
  if (/out for the evening$/.test(activity) || /, going out$/.test(activity)) return 'going';
  if (/(^| )home$/.test(activity) && !activity.startsWith('at home') && !activity.startsWith('moving to town')) return 'home';
  return 'sober';
}

/** a smooth 0..1 ramp */
const ease = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/**
 * How drunk after `e` effective hours at the bar, 0..1: about 0.22 at one hour, 0.55 at two, 1 from three (capped). A cubic
 * through those points, so it keeps building: no plateau until the cap.
 */
export function drunkOf(e: number): number {
  const x = Math.max(0, e) / HEAVY_HOURS;
  return Math.min(1, 0.505 * x + 0.45 * x * x + 0.045 * x * x * x);
}
/** the strengths at 1.5 and 2.5 hours: where "a little tipsy" gives way to "tipsy", and that to "very drunk" */
const TIPSY_AT = drunkOf(1.5), DRUNK_AT = drunkOf(2.5);
/** the HUD's word for a strength (what the picture is doing, so a lightweight reads as it looks) */
export function wordOf(strength: number): string {
  return strength < TIPSY_AT ? 'a little tipsy' : strength < DRUNK_AT ? 'tipsy' : 'very drunk';
}
/** how long the walk home takes to clear a view that left at this strength (game hours) */
export function walkHoursFor(strength: number): number {
  return WALK_MIN + (WALK_MAX - WALK_MIN) * Math.min(1, Math.max(0, strength));
}

/**
 * What one citizen's swim looks like, from their id (the organic rule): the period of the slow sway (it slows as they get
 * drunker), its phase, how far it moves the picture and how far the double image sits (pixels at 720p at full strength, scaled
 * to the view and to the strength), the blur, how strongly the second image shows, a second slower rhythm, and how fast they get
 * drunk (their weight: 0.7 a lightweight, 1.3 a hardened drinker).
 */
export interface SwimShape { period: number; phase: number; amp: number; ghost: number; blur: number; mix: number; ratio: number; peak: number }
export function swimShape(id: number): SwimShape {
  return {
    period: 3 + 2 * hash2(id, 71), phase: 6.2832 * hash2(id, 72),
    amp: 7 + 4 * hash2(id, 73), ghost: 14 + 8 * hash2(id, 74), blur: 8 + 2 * hash2(id, 75),
    mix: 0.35 + 0.15 * hash2(id, 77), ratio: 0.55 + 0.35 * hash2(id, 78), peak: 0.7 + 0.6 * hash2(id, 76),
  };
}

/** What the server's inspect says of the outing (CitizenInfo.night), with the game hour it was read at (default: now). */
export interface NightFeed { hours: number; drinks: boolean; at?: number }

/** One citizen's evening, fed their activity line (and the game clock in hours) as it changes. */
export class NightOut {
  /** 0..1, the swim's strength now (before the view eases toward it) */
  strength = 0;
  private fresh = true;
  /** game hour they sat down at the bar (earlier than first seen, if they were already there), or null */
  private since: number | null = null;
  /** the strength they set off home with, and the hour they did */
  private from = 0; private left: number | null = null; private prog = 0;
  readonly shape: SwimShape;
  constructor(readonly id: number) { this.shape = swimShape(id); }

  /**
   * `hours`: the game clock in hours (it may run past 24; only differences matter). `trip`: how far along the walk or drive
   * the current leg is, 0..1, when the server says. The ease-off follows whichever of the clock and the trip is further on.
   * `night`: the server's exact reading of the outing, when it sends one.
   */
  update(activity: string, hours: number, trip?: number, night?: NightFeed): number {
    let ph = phaseOf(activity);
    const first = this.fresh;
    this.fresh = false;
    // the server's reading wins: drinks at the venue (past midnight the line says "at a café"), a coffee or a film is not a night
    if (night) ph = night.drinks && night.hours > 0 ? 'at' : ph === 'at' ? 'sober' : ph;
    if (ph === 'at') {
      if (night) this.since = (night.at ?? hours) - night.hours;
      else if (this.since === null) this.since = hours - (first ? 0.4 + 0.9 * hash2(this.id, 79) : 0);
      this.left = null; this.prog = 0;
      this.strength = drunkOf((hours - this.since) * this.shape.peak);
      this.from = this.strength;
    } else if (ph === 'home' && this.since !== null) {
      this.left ??= hours;
      // by the clock (slower the drunker they left), or by how far along the leg is when the server says (a leg of a longer
      // trip starts over, so never back; a bus or lift leg's end is not the door)
      let clock = (hours - this.left) / walkHoursFor(this.from);
      const door = trip !== undefined && LAST_LEG.test(activity);
      if (door && trip < 1 && this.from > 0.95) clock = Math.min(clock, 0.9); // three hours or more: not clear before the door
      this.prog = Math.max(this.prog, clock, door ? trip : 0);
      this.strength = this.from * (1 - ease(this.prog));
    } else if (ph === 'going' && this.since === null) {
      this.strength = 0;
    } else if (ph === 'sober') {
      // home again, or somewhere sober: the evening is over
      this.since = null; this.left = null; this.prog = 0; this.from = 0; this.strength = 0;
    }
    return this.strength;
  }
}
