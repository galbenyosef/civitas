/**
 * Incidents: house fires with real dispatch (docs/incidents.md, server/src/sim/fires.ts, client/src/render/fires.ts);
 * v2 adds fires spreading to the buildings next door and explosions at burning works. Shared so the server's rules, the
 * wire format and the client's drawing agree.
 */

/**
 * Fire rules. Rates are per game day; times in game hours. A town's first fire is a warning: it comes a few hours after
 * the owner first houses `warnHoused` people, and is always survivable. Ordinary fires follow `graceDays` after it, once
 * the owner could have bought Emergency services (civ1's `housed` condition).
 */
export const FIRE = {
  /** expected fires a day per unit of weight (a level-1 lot, fully aged, with no cover); hourly hash rolls per building */
  perDay: 1 / 250,
  /** risk of a building in reach of a staffed fire engine (inspections, smoke alarms fitted), times the uncovered risk */
  coveredRisk: 0.6,
  /** a new building's risk, times a mature one's; it rises in a straight line to 1 over matureDays */
  youngRisk: 0.4, matureDays: 10,
  /** at most this many fires burning at once in one owner's parcels, and in the whole world */
  maxPerOwner: 2, maxWorld: 12,
  /** the warning fire: a hashed 3-9 hours after the owner first houses this many people */
  warnHoused: 12, warnMinHours: 3, warnSpanHours: 6,
  /** ordinary fires in a player's parcels begin this long after their warning fire */
  graceDays: 1,
  /** hours an unattended fire takes to burn a building out (a hashed 0.85-1.2 of it per fire) */
  burnHours: 4,
  /**
   * how a fire takes hold: the share burnt is (time / burn time) to this power, slow while it smoulders and fast once it
   * has spread (2.5: under a fifth burnt at half time). An engine held up in traffic for an hour still finds most of it standing.
   */
  growth: 2.5,
  /** an engine answers fires within this many tiles (square, as service cover) of its station, or the station's own cover when that is wider */
  reach: 14,
  /** the warning fire with no engine to come: the neighbours' bucket chain has it under control at this share burnt */
  bucketAt: 0.15,
  /** hours an engine crew spends putting a fire out once there: fightHours x (0.4 + the share burnt) */
  fightHours: 1.5,
  /** however soon help comes, smoke and water do this much (the share burnt a fire put out is never less) */
  minDamage: 0.12,
  /** the owner pays this share of the building's book value (parcelops.ts buildingValue) times the share burnt */
  costShare: 0.5,
  /** hours the ruin smoulders and the scorch shows after a fire is out (the client fades them) */
  aftermathHours: 6,
  /** the Commons' buildings burn too (its stations answer); false keeps the Commons fire-free */
  commons: true,
  /** a demo's fire drill (docs/incidents.md): the drill home catches light again this long after the last drill fire is out */
  drillGapHours: 0.6,

  // ---- v2: spread and explosions (docs/incidents.md "Fires v2"). Each burning fire rolls once a game hour after it lit.
  /**
   * The chance an hour that a fire with no engine crew on scene sets light to one building next door (a lot touching
   * its own, diagonals included): spreadMax x ramp x the neighbour's catch, ramp = ((u - spreadFrom) / (1 - spreadFrom))
   * ^ spreadPow on u, the share of its burn time gone (0 before spreadFrom: nothing in the first hour; 0.3 near burn-out).
   * Roads, parks and empty lots between are firebreaks: a lot a tile away does not touch.
   */
  spreadMax: 0.3, spreadFrom: 0.2, spreadPow: 1.6,
  /** the same chance an hour once an engine crew is putting it out, times the neighbour's catch (a stray ember) */
  spreadAttended: 0.01,
  /**
   * A neighbour's catch: by its level (1 to 5; a merged building as dense as the top), how readily it takes (a detached
   * cottage less, a terrace or a tower more), times `diagonal` when it touches only at a corner.
   */
  catchByLevel: [0.7, 0.85, 1, 1.1, 1.2], diagonal: 0.5,
  /** fires caught from another fire or a blast may burn at once to these caps (the ordinary rolls keep maxPerOwner and maxWorld) */
  spreadPerOwner: 6, spreadWorld: 20,
  /** an explosion at a burning works (an industrial building): blastMax x ((u - blastFrom) / (1 - blastFrom)) ^ blastPow an hour unattended */
  blastMax: 0.16, blastFrom: 0.1, blastPow: 1.5,
  /** the chance an hour of an explosion once an engine crew is on it */
  blastAttended: 0.015,
  /** a blast sets light to every building whose lot is this many tiles or less from the works' lot (roads are no break) */
  blastReach: 2,
  /** the share of the works the blast destroys there and then (the fire then carries on from there, or is put out at it) */
  blastDamage: 0.7,
  /** the owner pays this share of the works' book value for the blast itself (ledger 'blast'), on top of the fire's bill */
  blastCostShare: 0.25,
  /** a demo's spread drill: each house of the row catches this long after the one before; the engines are held this long after the first lit */
  drillSpreadHours: 0.5, drillHoldHours: 1.6,
  /** a demo's blast drill: the works blows this long after it caught light (the engines held till then), and lights again this long after its fire is out */
  drillBlastHours: 0.6, drillBlastGapHours: 1.5,
};
export type FireTuning = typeof FIRE;

/** A fire's phase on the wire: burning (an engine may be on its way), being put out, out (the aftermath). */
export const FirePhase = { Burning: 0, Fighting: 1, Out: 2 } as const;
/** How a fire ended: put out with nothing lost, put out with damage, burnt out. */
export const FireOutcome = { Saved: 0, Partial: 1, Burnt: 2 } as const;

/** One fire as the client draws it (message `fires`, the whole list whenever it changes). Ticks are world ticks. */
export interface FireDTO {
  /** the building's door tile */
  x: number; y: number;
  /** hash for the drawing's variation (0-1) */
  s: number;
  /** FirePhase */
  ph: number;
  /** the tick it caught light and the ticks it would take to burn out unattended */
  t0: number; burn: number;
  /** share burnt when the engine (or the bucket chain) arrived; 0 while burning */
  d: number;
  /** fighting and out: the tick help arrived (an engine crew or the bucket chain) */
  ta: number;
  /** fighting: the tick it will be out; out: the tick it went out */
  t1: number;
  /** 1 while an engine is on its way */
  eng?: number;
  /** out: FireOutcome */
  out?: number;
  /** being put out by a crew: where their hose plays from (the engine at the kerb), in tiles */
  hx?: number; hy?: number;
  /** being put out by the neighbours' bucket chain (the warning fire with no engine in reach) */
  bk?: number;
  /** the structure's footprint (1×1 lots: 1, 1), so the flames spread over a merged building */
  w: number; h: number;
  /** the tick the building blew up (an explosion at a burning works, FIRE.blastMax): the client's flash, shockwave, debris and smoke column */
  bx?: number;
}

/** The share burnt `ticks` after a fire caught light, unattended (FIRE.growth: slow, then fast). */
export const burntShare = (ticks: number, burn: number) => Math.pow(Math.max(0, Math.min(1, ticks / Math.max(1, burn))), FIRE.growth);
/** How far a fire has got at tick `now` (0-1): unattended it burns to 1 (burntShare); attended it stops at `d`. */
export function fireProgress(f: Pick<FireDTO, 'ph' | 't0' | 'burn' | 'd'>, now: number): number {
  if (f.ph !== FirePhase.Burning) return f.d;
  return burntShare(now - f.t0, f.burn);
}

/** The ramp of the spread and blast chances: 0 until `from` of the burn time has gone, rising to 1 at burn-out. */
export const fireRamp = (u: number, from: number, pow: number) => Math.pow(Math.max(0, Math.min(1, (u - from) / (1 - from))), pow);
