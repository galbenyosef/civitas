import { hash2 } from '@msimcity/shared';

/**
 * A night out in first person (playtest f425e885, "civs who have been out to dinner and/or drinking should have blurred FPV"),
 * as pure rules so client/scripts/lines-check.ts can run them on a fake clock. The server tells the client only a citizen's
 * activity line, so the evening is read from that:
 *
 *   - `out at a bar`            at the pub, bar or restaurant (the server says bar for all three after 16:00): the drink flows
 *   - `... out for the evening` on the way there (or `..., going out` on a bus or a lift): sober, the night has not begun
 *   - `... home`                on the way back (`walking home`, `driving home`, `..., going home`) after a night out
 *   - anything else             sober: the cinema, the theatre, a café, work, home, the library quiz
 *
 * The swim builds from nothing over the first RAMP_HOURS of game time at the bar (a visit lasts one to three hours), to a
 * strength of its own per citizen, and eases off over the walk home (by how far along the trip is when the server says,
 * else over WALK_HOURS), reaching nothing at the door. Someone first seen already at the bar is taken to have been there a
 * little while (an hour, hashed), so the view does not start clear in the middle of the evening.
 */
export type Phase = 'sober' | 'going' | 'at' | 'home';

/** the activity strings that count (the check lists them) */
export const BAR_ACTIVITY = 'out at a bar';
export const RAMP_HOURS = 1.6, WALK_HOURS = 0.5;

export function phaseOf(activity: string): Phase {
  if (activity === BAR_ACTIVITY) return 'at';
  if (/out for the evening$/.test(activity) || /, going out$/.test(activity)) return 'going';
  if (/(^| )home$/.test(activity) && !activity.startsWith('at home') && !activity.startsWith('moving to town')) return 'home';
  return 'sober';
}

/** a smooth 0..1 ramp */
const ease = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/**
 * What one citizen's swim looks like, from their id (the organic rule): the period of the slow sway, its phase, how far it
 * moves the picture and how far the double image sits (pixels at 720p, scaled to the view), the blur, how strongly the second
 * image shows, a second slower rhythm, and how tipsy they get at most.
 */
export interface SwimShape { period: number; phase: number; amp: number; ghost: number; blur: number; mix: number; ratio: number; peak: number }
export function swimShape(id: number): SwimShape {
  return {
    period: 3 + 2 * hash2(id, 71), phase: 6.2832 * hash2(id, 72),
    amp: 2 + 2.5 * hash2(id, 73), ghost: 3 + 3.5 * hash2(id, 74), blur: 1 + 1.5 * hash2(id, 75),
    mix: 0.22 + 0.16 * hash2(id, 77), ratio: 0.55 + 0.35 * hash2(id, 78), peak: 0.7 + 0.3 * hash2(id, 76),
  };
}

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
   */
  update(activity: string, hours: number, trip?: number): number {
    const ph = phaseOf(activity), first = this.fresh;
    this.fresh = false;
    if (ph === 'at') {
      if (this.since === null) this.since = hours - (first ? 0.4 + 0.9 * hash2(this.id, 79) : 0);
      this.left = null; this.prog = 0;
      this.strength = this.shape.peak * ease((hours - this.since) / RAMP_HOURS);
      this.from = this.strength;
    } else if (ph === 'home' && this.since !== null) {
      this.left ??= hours;
      // by the clock, or by how far along the leg is when the server says (a leg of a longer trip starts over, so never back)
      this.prog = Math.max(this.prog, (hours - this.left) / WALK_HOURS, trip ?? 0);
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
