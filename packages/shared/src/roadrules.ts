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
  /**
   * R5 street rules on this road tile (StreetRule bits: 1 HGV ban, 2 bus lane, 4 double yellows, 8 20 zone). Kept per
   * tile, so a rule survives a street's rename and a partial demolition, and set and shown per street (streetRuleTiles).
   */
  st?: number;
  /** R5: the visitor limit on the gateway whose door is this tile (half the visitors come in by it) */
  gw?: 1;
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
export const ruleEmpty = (r: RoadRule) => !r.ban && !r.noEntry && !r.pelican && !r.st && !r.gw;

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

// ---- street rules (R5, docs/roads.md "Traffic control") -------------------------------------------------------------

/**
 * What a player sets on a street (R5): bits of RoadRule.st, one record per road tile. A rule is set and shown per street
 * (the straight run the Street rules tool clicks, or a drag of tiles for part of one) but stored per tile, so it survives
 * a rename and a partial demolition (a tile that stops being road takes its bits with it).
 */
export const StreetRule = { Hgv: 1, BusLane: 2, NoParking: 4, Zone20: 8 } as const;
export type StreetRuleBit = (typeof StreetRule)[keyof typeof StreetRule];
export type StreetRuleId = 'hgv' | 'bus' | 'yellow' | 'zone20';
export interface StreetRuleDef {
  id: StreetRuleId; bit: StreetRuleBit;
  /** the tool picker's title, and a sentence's words ("an HGV ban") */
  title: string; words: string;
  /** one-off per tile, and a day per tile with the parcel's roads */
  cost: number; upkeep: number;
  /** the tech feature that opens it (tech.ts unlocks) */
  feature: string;
  blurb: string;
  /** the colour of its chip, ghost and tooltip mark */
  colour: number;
}
export const STREET_RULE_DEFS: readonly StreetRuleDef[] = [
  { id: 'hgv', bit: StreetRule.Hgv, title: 'HGV ban', words: 'an HGV ban', cost: 3, upkeep: 0.05, feature: 'streetrules', colour: 0xd8423a,
    blurb: 'No lorries, except to deliver on the street itself. Vans and buses still come. Lorries find another way round.' },
  { id: 'bus', bit: StreetRule.BusLane, title: 'Bus lane', words: 'a bus lane', cost: 8, upkeep: 0.2, feature: 'buslane', colour: 0xc8362e,
    blurb: 'The kerb lane of a one-way street or an avenue for buses, bikes, taxis and emergencies. Cars use the other lane, and the kerb lane only to turn off at the last tile.' },
  { id: 'yellow', bit: StreetRule.NoParking, title: 'Double yellows', words: 'double yellow lines', cost: 1, upkeep: 0.02, feature: 'streetrules', colour: 0xf2c230,
    blurb: 'No parking at the kerb, so a parked car never takes a lane slot. Drivers who find no space park in a lot or on the next street and walk.' },
  { id: 'zone20', bit: StreetRule.Zone20, title: '20 zone', words: 'a 20 zone', cost: 6, upkeep: 0.1, feature: 'streetrules', colour: 0x2f8fd6,
    blurb: 'A 20 mph limit with speed humps: every vehicle at 60% speed. Quieter and safer for walkers, and through traffic goes another way.' },
];
export const STREET_RULE_BY_ID = new Map<string, StreetRuleDef>(STREET_RULE_DEFS.map((d) => [d.id, d]));
export const streetRuleDef = (bit: number) => STREET_RULE_DEFS.find((d) => d.bit === bit);
export const isStreetRuleId = (s: unknown): s is StreetRuleId => typeof s === 'string' && STREET_RULE_BY_ID.has(s);
/** The street rule bits on a record (0 for none). */
export const streetBits = (r: RoadRule | undefined) => r?.st ?? 0;
/** The record with bit `bit` of its street rules set or cleared. */
export function withStreetRule(r: RoadRule | undefined, bit: number, on: boolean): RoadRule {
  const out: RoadRule = { ...(r ?? {}) };
  const st = on ? (out.st ?? 0) | bit : (out.st ?? 0) & ~bit;
  if (st) out.st = st; else delete out.st;
  return out;
}
/** Words for the street rules on a tile ("HGV ban, 20 zone"), for the tooltip. */
export const streetRuleWords = (bits: number) => STREET_RULE_DEFS.filter((d) => bits & d.bit).map((d) => d.title).join(', ');
/** The day's upkeep of a tile's street rules. */
export const streetRuleUpkeep = (bits: number) => STREET_RULE_DEFS.reduce((s, d) => s + (bits & d.bit ? d.upkeep : 0), 0);

/** A 20 zone's speed for every vehicle, and what its tile adds to a route (a street's 1: the lane's 1.2 is a country lane's) */
export const ZONE20_SPEED = 0.6;
export const ZONE20_COST = 1.4;
/** Freight's route through a 20 zone costs this much more again: lorries keep out of residential streets */
export const ZONE20_FREIGHT = 1.5;

/** What the street rule tools read: road tiles and their aux bytes (as RuleEnv). */
export interface StreetEnv { road(x: number, y: number): boolean; aux(x: number, y: number): number }
/**
 * May a bus lane go on this road tile (aux a)? The kerb lane of a one-way tile with two lanes: a one-way street or an
 * avenue's carriageway, not a motorway, a 5×5 ring or a divided road's junction tile (which has no direction).
 */
export const busLaneOk = (a: number) => oneWayDirOf(a) >= 0 && (a & 7) !== 4 && (a & 7) !== 6 && (a & 7) !== 7;
/** A class byte's one-way direction (as roadclass.ts oneWayDir, inline here so this file needs nothing else). */
function oneWayDirOf(a: number): number {
  if (!(a > 0 && a < 0x40)) return -1;
  const cls = a & 7;
  if (cls !== 2 && cls !== 3 && cls !== 4 && cls !== 6 && cls !== 7) return -1;
  if (a & 0x20) return -1;
  return (a >> 3) & 3;
}
/** Why a bus lane cannot go on these tiles, or null: it needs at least one tile with two lanes one way. */
export function busLaneProblem(env: StreetEnv, tiles: readonly (readonly [number, number])[]): string | null {
  for (const [x, y] of tiles) if (env.road(x, y) && busLaneOk(env.aux(x, y))) return null;
  return 'One lane each way: a bus lane needs a one-way street or an avenue';
}
/**
 * The tiles a click with the Street rules tool on road tile (x, y) sets: the street through it along `ns` (the straight
 * run of road, shared/src/streets.ts), and on an avenue (a divided road's carriageway) its twin row beside it too, so an
 * HGV ban or a 20 zone covers both ways. A bus lane takes only the carriageway clicked (its kerb lane). In order along
 * the street, the twin's after.
 */
export function streetRuleTiles(env: StreetEnv, x: number, y: number, ns: boolean, rule: StreetRuleId): [number, number][] {
  if (!env.road(x, y)) return [];
  const run = (lx: number, ly: number): [number, number][] => {
    let a = ns ? ly : lx, b = a;
    const at = (i: number) => (ns ? env.road(lx, i) : env.road(i, ly));
    while (b - a < 512 && at(a - 1)) a--;
    while (b - a < 512 && at(b + 1)) b++;
    const out: [number, number][] = [];
    for (let i = a; i <= b; i++) out.push(ns ? [lx, i] : [i, ly]);
    return out;
  };
  const out = run(x, y);
  if (rule === 'bus') return out;
  // an avenue: its twin row (the parallel divided tiles along the other side of the reservation)
  const a = env.aux(x, y), cls = a > 0 && a < 0x40 ? a & 7 : 0;
  if (cls === 3 || cls === 4) {
    for (const s of [1, -1]) {
      const tx = ns ? x + s : x, ty = ns ? y : y + s, b = env.aux(tx, ty), bc = b > 0 && b < 0x40 ? b & 7 : 0;
      if (env.road(tx, ty) && bc === cls && (((b >> 3) & 3) < 2) === !ns && (((a >> 3) & 3) < 2) === !ns && !(b & 0x20 && a & 0x20)) {
        const seen = new Set(out.map(([px, py]) => `${px},${py}`));
        for (const t of run(tx, ty)) if (!seen.has(`${t[0]},${t[1]}`)) out.push(t);
        break;
      }
    }
  }
  return out;
}
/**
 * The axis of the street a click on road tile (x, y) means (true: north-south): a one-way tile's or an avenue
 * carriageway's own way (its twin beside it is no side road), a tile on one street only that street's, and at a
 * crossroads or a bend `prefer` (the arm the cursor is towards).
 */
export function streetAxisAt(env: StreetEnv, x: number, y: number, prefer: boolean): boolean {
  const a = env.aux(x, y), cls = a > 0 && a < 0x40 ? a & 7 : 0;
  if ((cls === 2 || cls === 3 || cls === 4) && !(a & 0x20)) return ((a >> 3) & 3) >= 2;
  const ew = env.road(x - 1, y) || env.road(x + 1, y), ns = env.road(x, y - 1) || env.road(x, y + 1);
  return ew && !ns ? false : ns && !ew ? true : prefer;
}
/** Cost to set rule `bit` on these tiles (only those that lack it, and are road), and the day's upkeep it adds. */
export function streetRuleCost(env: StreetEnv & { bits(x: number, y: number): number }, tiles: readonly (readonly [number, number])[], bit: number): { tiles: number; cost: number; upkeep: number; on: boolean } {
  const def = streetRuleDef(bit);
  if (!def) return { tiles: 0, cost: 0, upkeep: 0, on: false };
  let n = 0, have = 0;
  for (const [x, y] of tiles) {
    if (!env.road(x, y) || (bit === StreetRule.BusLane && !busLaneOk(env.aux(x, y)))) continue;
    n++;
    if (env.bits(x, y) & bit) have++;
  }
  // a click on a street that has the rule everywhere takes it off (free); otherwise it goes on where it is missing
  const on = have < n;
  const add = on ? n - have : 0;
  return { tiles: on ? add : have, cost: add * def.cost, upkeep: (on ? n : 0) * def.upkeep, on };
}

/**
 * Speed humps of a 20 zone (drawn, and the client's cars dip over them; the 60% speed is the zone's whole effect on the
 * simulation): along each straight run of zone tiles, the first a tile or two in from its start and then every four to
 * six tiles, by a hash of the run's line and the place (the organic rule), never on a junction (`junction` true for a
 * tile with three or more road arms). The run is the zone tiles along the axis `ns` through (x, y).
 */
export function humpAt(x: number, y: number, ns: boolean, zone: (x: number, y: number) => boolean, junction: (x: number, y: number) => boolean): boolean {
  if (!zone(x, y) || junction(x, y)) return false;
  // back to the run's start
  let s = ns ? y : x;
  const at = (i: number) => (ns ? zone(x, i) : zone(i, y));
  let guard = 0;
  while (at(s - 1) && guard++ < 512) s--;
  const line = ns ? x : y, me = ns ? y : x;
  let p = s + 1 + Math.floor(hashHump(line, s) * 2);
  guard = 0;
  while (p < me && guard++ < 256) p += 4 + Math.floor(hashHump(line * 7 + 3, p) * 3);
  return p === me;
}
function hashHump(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- the gateway visitor limit (R5) ------------------------------------------------------------------------------------

/** The share of visitors a gateway with the limit on lets in (Simulation.dispatch). */
export const VISITOR_LIMIT_SHARE = 0.5;
