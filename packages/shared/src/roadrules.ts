/**
 * Road rules (R4, docs/roads.md "Junctions"): what a player sets on a junction or a road tile that the tiles themselves
 * cannot hold (there is no aux room left for them). One small record per junction anchor (the junction group's min x,
 * min y: shared/src/signals.ts junctionGroup; the tile itself for a plain junction or a crossing), kept by the server
 * (World.roadRules), saved as an optional snapshot field and sent to every client (`roadRules` on hello and on change).
 * R5 (traffic control: lorry bans, bus lanes, parking, 20 zones) adds its fields to the same record.
 *
 * Arms are in DIRS order (E 0, W 1, S 2, N 3): arm d is the road that leaves the junction heading d. A car coming in by
 * arm a heads OPP[a]; its movement through the junction is left (a U-turn counts as left), straight on or right, from
 * the way it came in and the way it leaves.
 */
export interface RoadRule {
  /** turn bans: bit `arm * 3 + turn` (Turn), set when cars coming in by that arm may not make that turn */
  ban?: number;
  /** no entry: bit `arm`, set when no car may leave the junction into that arm */
  noEntry?: number;
  /** a signal crossing (pelican) placed on this straight road tile */
  pelican?: 1;
}
export const Turn = { Left: 0, Straight: 1, Right: 2 } as const;
export type TurnId = (typeof Turn)[keyof typeof Turn];
const OPP = [1, 0, 3, 2], RIGHT = [2, 3, 1, 0];
export const banBit = (arm: number, turn: number) => 1 << (arm * 3 + turn);
/** The turn a car makes coming in heading `inH` and leaving heading `outH` (DIRS indices): a U-turn counts as left. */
export const turnOf = (inH: number, outH: number): TurnId => (outH === inH ? Turn.Straight : outH === RIGHT[inH] ? Turn.Right : Turn.Left);
/**
 * May a car coming into the junction heading `inH` leave it heading `outH` under rule r? An emergency vehicle on a call
 * ignores turn bans, never a no-entry.
 */
export function turnAllowed(r: RoadRule | undefined, inH: number, outH: number, emergency = false): boolean {
  if (!r) return true;
  if (r.noEntry && r.noEntry & (1 << outH)) return false;
  if (!emergency && r.ban && r.ban & banBit(OPP[inH], turnOf(inH, outH))) return false;
  return true;
}
/** Does the record restrict any movement (turn bans or no entry)? */
export const restricts = (r: RoadRule | undefined) => !!r && !!(r.ban || r.noEntry);
/** Is the record empty (nothing left to keep)? */
export const ruleEmpty = (r: RoadRule) => !r.ban && !r.noEntry && !r.pelican;

/**
 * What one click with the Turn rules tool on an arm cycles it through (the arm's own bits): no rule, no left turn, no
 * right turn, no straight on, no entry, and round again. An arm with some other mix (set another way) goes back to none.
 */
export const ARM_STATES = ['none', 'noLeft', 'noRight', 'noStraight', 'noEntry'] as const;
export type ArmState = (typeof ARM_STATES)[number];
export function armState(r: RoadRule | undefined, arm: number): ArmState | 'mixed' {
  const b = ((r?.ban ?? 0) >> (arm * 3)) & 7, e = ((r?.noEntry ?? 0) >> arm) & 1;
  if (!b && !e) return 'none';
  if (e && !b) return 'noEntry';
  if (!e && b === 1 << Turn.Left) return 'noLeft';
  if (!e && b === 1 << Turn.Right) return 'noRight';
  if (!e && b === 1 << Turn.Straight) return 'noStraight';
  return 'mixed';
}
/** The record with arm `arm` set to state s (other arms as they were). */
export function withArmState(r: RoadRule | undefined, arm: number, s: ArmState): RoadRule {
  const out: RoadRule = { ...(r ?? {}) };
  let ban = (out.ban ?? 0) & ~(7 << (arm * 3)), ne = (out.noEntry ?? 0) & ~(1 << arm);
  if (s === 'noLeft') ban |= banBit(arm, Turn.Left);
  else if (s === 'noRight') ban |= banBit(arm, Turn.Right);
  else if (s === 'noStraight') ban |= banBit(arm, Turn.Straight);
  else if (s === 'noEntry') ne |= 1 << arm;
  if (ban) out.ban = ban; else delete out.ban;
  if (ne) out.noEntry = ne; else delete out.noEntry;
  return out;
}
/** The state after `s` in the click cycle (a mixed arm goes back to none). */
export const nextArmState = (s: ArmState | 'mixed'): ArmState => (s === 'mixed' ? 'none' : ARM_STATES[(ARM_STATES.indexOf(s) + 1) % ARM_STATES.length]);
/** Words for a sign, the tooltip and the toast. */
export const ARM_WORDS: Record<ArmState, string> = { none: 'no rule', noLeft: 'no left turn', noRight: 'no right turn', noStraight: 'no straight on', noEntry: 'no entry' };
/** One line per restricted arm of a record ("from the east: no left turn"), for the tooltip. */
export function ruleLines(r: RoadRule | undefined): string[] {
  const names = ['east', 'west', 'south', 'north'], out: string[] = [];
  if (!r) return out;
  for (let a = 0; a < 4; a++) {
    const b = ((r.ban ?? 0) >> (a * 3)) & 7;
    const bans = [b & (1 << Turn.Left) ? 'no left turn' : '', b & (1 << Turn.Straight) ? 'no straight on' : '', b & (1 << Turn.Right) ? 'no right turn' : ''].filter(Boolean);
    if (bans.length) out.push(`from the ${names[a]}: ${bans.join(', ')}`);
    if ((r.noEntry ?? 0) & (1 << a)) out.push(`no entry to the ${names[a]}`);
  }
  return out;
}
/** A wire entry: the anchor tile and its record. */
export type RoadRuleDTO = [number, number, RoadRule];
/** Costs (docs/roads.md "Junctions"): a turn rule sign on an arm, and a signal crossing. */
export const TURN_RULE_COST = 40;
export const PELICAN_COST = 250;
