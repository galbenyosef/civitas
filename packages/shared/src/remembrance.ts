import { MANIFEST, KIND_ID, DESIGN_COUNT_TABLE } from './buildings/compiled';
import { LEVEL_SLOTS } from './buildings/codes';
import { hash2 } from './noise';
import { designPick } from './leisure';
import { footprintOf } from './structures';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';

/**
 * Death and remembrance (docs/remembrance.md): what happens to a citizen who dies. Shared so the server's rules
 * (server/src/sim/death.ts), the wire and the client's drawing (render/graves.ts, remembrance.ts) agree.
 *
 * A death leaves a body where it happened. A funeral director's hearse collects it; a service follows two to four
 * game days later at a chapel or crematorium, family and close friends going to it and close family taking the day
 * off; then a burial fills a plot (a headstone stands on it from then on) or a cremation a memorial plaque. With no
 * burial space the body waits at the hospital mortuary. Partner, children and parents grieve; money and the home pass
 * to the partner, then the children, after the funeral director's and the resting place's fees.
 */

/** How someone died (Dead.cause on the server, DeceasedInfo.cause). */
export const Cause = { OldAge: 1, Illness: 2, Fire: 3, Explosion: 4, Accident: 5 } as const;
export type CauseId = (typeof Cause)[keyof typeof Cause];
/** "died of old age", "died in a fire" */
export const CAUSE_DIED: Record<number, string> = {
  [Cause.OldAge]: 'died of old age', [Cause.Illness]: 'died after an illness', [Cause.Fire]: 'died in a fire',
  [Cause.Explosion]: 'was killed in an explosion', [Cause.Accident]: 'was killed in an accident at work',
};
/** the cause on its own, for a headstone panel ("old age", "a fire") */
export const CAUSE_NOUN: Record<number, string> = {
  [Cause.OldAge]: 'old age', [Cause.Illness]: 'illness', [Cause.Fire]: 'fire', [Cause.Explosion]: 'explosion', [Cause.Accident]: 'accident at work',
};
/** causes that are incidents: the news reports them (shared/news.ts 'death') */
export const isIncident = (cause: number) => cause === Cause.Fire || cause === Cause.Explosion || cause === Cause.Accident;

const TPH = TICKS_PER_HOUR, DAY = TICKS_PER_DAY;

/** The rules. Times in game days or hours as named; chances per occupant (incidents) or per game day (accidents). */
export const DEATH = {
  /** off switch (DEATH=0 on the server: deaths as before, the citizen simply goes) */
  on: true,
  /** no one in a player's town dies in their first real hour (18,000 ticks at 1×; the first-hour safety rail) */
  graceTicks: 18000,
  /** records kept: beyond this the oldest go first, but never one whose headstone or plaque still stands */
  archiveCap: 1500,
  /** the service: this many days after the body reaches the funeral director (hashed per person), starting between serviceFrom and serviceFrom + serviceSpan o'clock, lasting serviceHours */
  serviceDaysMin: 2, serviceDaysMax: 4, serviceFrom: 10.5, serviceSpan: 5, serviceHours: 1.25,
  /** the hearse leaves this long before the service; mourners set off this long before it */
  hearseLeadHours: 0.75, mournerLeadHours: 1,
  /** close family (partner, children, parents) and at most friendsMax friends go; at most mournersMax in all */
  mournersMax: 6, friendsMax: 3,
  /** share of a funeral director's staff who drive its hearse */
  hearseShare: 0.5,
  /** ticks the hearse stands at the door collecting a body */
  collectDwell: Math.round(TPH * 0.4),
  /** tiles (Manhattan) a funeral director serves, and a resting place takes funerals from its door */
  funeralReach: 80, restReach: 80,
  /** a body waiting for burial space: looked at again this often; after mortuaryMaxDays the county takes it */
  mortuaryCheckHours: 2, mortuaryMaxDays: 10,
  /** no funeral director in reach (or before Remembrance): the county takes the body out of town and buries it this long after, for countyFee */
  awayDays: 5, countyFee: 150,
  /** a crematorium's services a day when its kind says nothing */
  cremationsPerDay: 6,
  /** grief: days for the partner, children and parents; a funeral on time ends it afterService days after the service;
   *  every day the body waits adds waitDays; never more than maxDays. Happiness and the chance a grieving worker stays home */
  griefDays: 5, griefAfterService: 2, griefWaitDays: 1, griefMaxDays: 16, griefMood: -8, griefWaitMood: -12, griefSkip: 0.25,
  /** fires (sim/fires.ts): each occupant there when it is out dies with fireUnattended when it burnt down with no crew,
   *  fireAttended × (share burnt when the crew came)^2 when a crew put it out; an explosion kills blastSource of those in
   *  the building, blastLevelled when it flattens it. The warning fire and the demos' drills never kill */
  fireUnattended: 0.18, fireAttended: 0.12, blastSource: 0.3, blastLevelled: 0.55,
  /** a working day's chance of a fatal accident at a works or a building site, for someone at work there; halved in hospital cover */
  accidentIndustrial: 0.0005, accidentYard: 0.0004, accidentCovered: 0.5,
  /** headstones: fresh flowers for this many days after a burial, wilted ones until wiltedDays; on an anniversary some have flowers again */
  freshDays: 10, wiltedDays: 24, anniversaryFlowers: 0.45, visitedFlowers: 0.06,
  /** demos: a funeral drill (the showcase's churchyard) runs every drillGapHours */
  drillGapHours: 2.2,
};

// ---- the kinds -------------------------------------------------------------------------------------------------

export const FUNERAL_KIND: number = KIND_ID['funeral-director'];
export const CHURCHYARD_KIND: number = KIND_ID['churchyard'];
export const CEMETERY_KIND: number = KIND_ID['municipal-cemetery'];
export const GARDEN_CEMETERY_KIND: number = KIND_ID['garden-cemetery'];
export const CREMATORIUM_KIND: number = KIND_ID['crematorium'];

/** A resting place as the rules read it (buildings/remembrance.ts attributes). */
export interface RestSpec {
  kind: number;
  type: 'burial' | 'cremation';
  /** what the estate pays its owner for a burial or cremation (ledger 'burial') */
  fee: number;
  /** a crematorium's services a day */
  cremations: number;
  /** per live design: the plot rectangles [x0, z0, x1, z1, cols, rows, ...] in the model frame */
  plots: number[][];
  /** how far each plot is nudged off its grid (a garden cemetery's are irregular) */
  jitter: number;
  title: string;
}
const REST_OF: (RestSpec | undefined)[] = [];
const FEE_OF = new Uint16Array(256);
for (const k of MANIFEST) {
  const l = k.levels[0];
  if (!l) continue;
  const a = { ...k.attrs, ...l.attrs };
  if (a.funeral) FEE_OF[k.kindId] = typeof a.fee === 'number' ? a.fee : 200;
  if (a.rest !== 'burial' && a.rest !== 'cremation') continue;
  const live = l.designs.filter((d) => !d.draft);
  REST_OF[k.kindId] = {
    kind: k.kindId, type: a.rest, fee: typeof a.fee === 'number' ? a.fee : 120,
    cremations: typeof a.cremations === 'number' ? a.cremations : DEATH.cremationsPerDay,
    plots: live.map((d) => (Array.isArray(d.attrs.plots) ? (d.attrs.plots as number[]) : [])),
    jitter: typeof a.plotJitter === 'number' ? a.plotJitter : 0.012, title: typeof a.title === 'string' ? a.title : k.name,
  };
}
export const restSpec = (kind: number): RestSpec | undefined => REST_OF[kind];
export const isRestKind = (kind: number) => REST_OF[kind] !== undefined;
export const isFuneralKind = (kind: number) => FEE_OF[kind] > 0 && !REST_OF[kind];
/** what a funeral director charges an estate (ledger 'funeral') */
export const funeralFee = (kind: number) => FEE_OF[kind];
/** Any of the five: the funeral director or a resting place. */
export const isRemembranceKind = (kind: number) => isFuneralKind(kind) || isRestKind(kind);

/** Which design of a resting place stands with its anchor at (ax, ay): the renderer's pick (render/chunkView.ts). */
export function restDesign(kind: number, ax: number, ay: number): number {
  const n = DESIGN_COUNT_TABLE[kind * LEVEL_SLOTS + 1] || 1;
  return Math.min(n - 1, Math.floor(designPick(ax, ay) * n));
}

const SPOTS = new Map<number, [number, number][]>();
/**
 * The plots of a design, in footprint coordinates (x 0..w across, y 0..h with y = h the front edge, the units of
 * shared/src/structures.ts footprintPoint), in the order they fill: front rows first, left to right, rectangle by
 * rectangle. Each is nudged off its grid by a hash (`jitter`), so no two rows are ruled straight.
 */
export function plotSpots(kind: number, design: number): readonly [number, number][] {
  const key = kind * 16 + design;
  let out = SPOTS.get(key);
  if (out) return out;
  out = [];
  const spec = REST_OF[kind], plots = spec?.plots[design] ?? spec?.plots[0] ?? [];
  const fp = footprintOf(kind), j = spec?.jitter ?? 0;
  const rects: [number, number, number, number, number, number][] = [];
  for (let i = 0; i + 5 < plots.length; i += 6) rects.push([plots[i], plots[i + 1], plots[i + 2], plots[i + 3], plots[i + 4], plots[i + 5]]);
  rects.sort((a, b) => b[3] - a[3] || a[0] - b[0]); // the rectangle nearest the road first
  for (const [x0, z0, x1, z1, cols, rows] of rects) {
    for (let r = rows - 1; r >= 0; r--) for (let c = 0; c < cols; c++) {
      const n = out.length;
      const mx = x0 + ((c + 0.5) * (x1 - x0)) / cols + j * (hash2(n * 7 + kind, design * 13 + 1) - 0.5) * 2;
      const mz = z0 + ((r + 0.5) * (z1 - z0)) / rows + j * (hash2(n * 11 + 3, kind + design * 5) - 0.5) * 2;
      out.push([mx + fp.w / 2, mz + fp.h / 2]);
    }
  }
  SPOTS.set(key, out);
  return out;
}
/** Plots (or plaques) at the resting place whose anchor is (ax, ay). */
export const plotCapacity = (kind: number, ax: number, ay: number) => plotSpots(kind, restDesign(kind, ax, ay)).length;

// ---- headstones ------------------------------------------------------------------------------------------------

/** Headstone shapes the client draws (render/graves.ts): a rounded tablet, a square one with shoulders, a cross, a pillar, a ledger slab, a plaque. */
export const Stone = { Rounded: 0, Square: 1, Cross: 2, Pillar: 3, Ledger: 4, Plaque: 5 } as const;
/** Stone colours: grey granite, sandstone, slate, marble, red granite, black granite, limestone. */
export const STONE_TONES = [0xb9b9b3, 0xd6c29a, 0x7a818a, 0xf0ede6, 0xa8665a, 0x45494f, 0xcfcfc8];
export interface StoneLook {
  shape: number;
  /** height, width (tiles), lean back and side (radians), turn off square (radians), nudge on the plot */
  h: number; w: number; lean: number; tilt: number; yaw: number;
  /** STONE_TONES index, and weathering 0 (new) .. 1 (a century of rain): darker, greener, leaning further */
  tone: number; weather: number;
  /** 0 none, 1 fresh flowers, 2 wilted */
  flowers: 0 | 1 | 2;
  /** the flowers' colour (fresh) */
  bloom: number;
}
const BLOOMS = [0xd23a5a, 0xf2f0ea, 0xe7c13e, 0xb64d8a, 0xe9893c, 0x8f6fd0];
/**
 * The look of the headstone of deceased `id` buried at tick `buried`, seen at tick `now`: everything from hashes of the
 * id (so a stone looks the same on every screen and every visit), its weathering and lean from the years since the
 * burial, flowers on a recent grave, wilting after a few weeks, and again on some anniversaries. `plaque`: a
 * crematorium's memorial plaque, a small flat plate.
 */
export function stoneLook(id: number, buried: number, now: number, plaque = false): StoneLook {
  const h1 = hash2(id, 601), h2 = hash2(id, 603), h3 = hash2(id, 605), h4 = hash2(id, 607), h5 = hash2(id, 609);
  const years = Math.max(0, (now - buried) / DAY / 7);
  const weather = Math.min(1, years / 40 + h5 * 0.25);
  const daysSince = (now - buried) / DAY;
  let flowers: 0 | 1 | 2 = daysSince < DEATH.freshDays ? 1 : daysSince < DEATH.wiltedDays ? 2 : 0;
  if (!flowers) {
    // an anniversary (within a day of the burial's day of the game year, which is a week) or a visit this week
    const week = Math.floor(now / (7 * DAY)), dayOfWeek = ((now - buried) / DAY) % 7;
    if ((dayOfWeek < 1 || dayOfWeek > 6) && hash2(id, week * 3 + 11) < DEATH.anniversaryFlowers) flowers = 1;
    else if (hash2(id * 3 + 1, week) < DEATH.visitedFlowers) flowers = hash2(id, week + 5) < 0.6 ? 1 : 2;
  }
  const bloom = BLOOMS[Math.floor(h4 * BLOOMS.length)];
  if (plaque) return { shape: Stone.Plaque, h: 0.026 + 0.006 * h2, w: 0.055 + 0.012 * h1, lean: 0, tilt: 0, yaw: (h2 - 0.5) * 0.08, tone: h3 < 0.5 ? 3 : h3 < 0.8 ? 5 : 1, weather: weather * 0.4, flowers, bloom };
  const shape = h1 < 0.38 ? Stone.Rounded : h1 < 0.6 ? Stone.Square : h1 < 0.72 ? Stone.Cross : h1 < 0.84 ? Stone.Ledger : Stone.Pillar;
  const h = shape === Stone.Ledger ? 0.025 + 0.012 * h2 : shape === Stone.Pillar ? 0.1 + 0.05 * h2 : 0.055 + 0.04 * h2;
  const w = shape === Stone.Ledger ? 0.06 + 0.012 * h3 : shape === Stone.Pillar ? 0.026 + 0.006 * h3 : 0.042 + 0.018 * h3;
  const lean = shape === Stone.Ledger ? 0 : (h4 - 0.35) * 0.06 + weather * (h5 - 0.3) * 0.22;
  const tilt = shape === Stone.Ledger ? 0 : (h3 - 0.5) * 0.04 + weather * (h2 - 0.5) * 0.18;
  const tone = Math.floor(hash2(id, 611) * STONE_TONES.length);
  return { shape, h, w, lean, tilt, yaw: (h5 - 0.5) * 0.12, tone, weather, flowers, bloom };
}

// ---- the wire --------------------------------------------------------------------------------------------------

/** Entries per filled plot in GraveSiteDTO.g: slot, deceased id, the tick of the burial, flags. */
export const GRAVE_STRIDE = 4;
/** GraveSiteDTO.g flags: a crematorium's memorial plaque rather than a headstone */
export const GRAVE_PLAQUE = 1;
/** A funeral under way at a resting place: the client draws the open grave and the mourners round it. */
export interface FuneralDTO {
  /** the plot being filled (-1 a cremation), the deceased, when it started and ends, mourners there now */
  slot: number; id: number; t0: number; t1: number; n: number;
}
/** One resting place's filled plots (message `graves`): its door, the plots, a funeral there now. */
export interface GraveSiteDTO {
  x: number; y: number;
  /** flat [slot, id, buried tick, flags] × filled plots */
  g: number[];
  f?: FuneralDTO;
}
/** Someone the panel names: living (a citizen id to select) or not (a deceased id to open). */
export interface FamilyRef { id: number; name: string; relation: string; living: boolean; age?: number }
/** A deceased person's panel (message `deceased`): the headstone, the family tree, how the funeral went. */
export interface DeceasedInfo {
  id: number; name: string;
  /** game day of birth (fractional) and the tick of death; age at death in years */
  born: number; died: number; age: number;
  cause: number;
  /** where it happened, in words ("at home", "at Patel's Bakery", "in the fire at the house at (12, 4)") */
  where: string;
  state: 'awaiting' | 'parlour' | 'service' | 'mortuary' | 'away' | 'buried' | 'cremated' | 'gone';
  /** the state in words ("waiting at the hospital mortuary: no burial space") */
  stateText: string;
  /** the resting place (absent before the burial, and when the county took them) */
  rest?: { x: number; y: number; kind: number; name: string; slot?: number };
  /** the service, planned or held */
  funeral?: { at: number; place: string; mourners: number; held: boolean };
  family: FamilyRef[];
  /** the estate: what was left, what the fees took, who had it */
  estate?: { left: number; fees: number; to: string[] };
  /** the news story about it (shared/news.ts), for an incident */
  story?: number;
}
/** A funeral director's, resting place's or mortuary's lines in the building panel. */
export interface RemembranceInfo {
  role: 'funeral' | 'burial' | 'cremation' | 'mortuary';
  /** its own name, when it has one (a scenario's: Highgate Cemetery) */
  name?: string;
  /** plots: filled, free, booked for funerals to come */
  plots?: { used: number; free: number; booked: number };
  /** what it charges an estate */
  fee?: number;
  /** bodies waiting here for burial space (a mortuary), or at a funeral director's for their service */
  waiting?: number;
  /** some of those are waiting because no resting place in reach has room */
  noSpace?: boolean;
  /** the most recent burials (headstones you can open) */
  recent?: { id: number; name: string; died: number; age: number }[];
  /** funerals planned, soonest first */
  funerals?: { at: number; id: number; name: string; place: string }[];
  /** funerals held here, ever */
  held?: number;
}

/**
 * The year a game day falls in, for headstones: a game week is a year of a citizen's life (server sim/life.ts LIFE.daysPerYear),
 * and day 0 is EPOCH_YEAR, so someone who died at 81 on day 12 reads "1946 – 2027".
 */
export const EPOCH_YEAR = 2026;
export const yearOfDay = (day: number) => EPOCH_YEAR + Math.floor(day / 7);

/** The day and hour a service is due for someone whose body reached the funeral director at `tick` (hashed per person). */
export function serviceTick(id: number, tick: number): number {
  const days = DEATH.serviceDaysMin + Math.floor(hash2(id, 621) * (DEATH.serviceDaysMax - DEATH.serviceDaysMin + 1));
  const hour = DEATH.serviceFrom + DEATH.serviceSpan * hash2(id, 623);
  return (Math.floor(tick / DAY) + days) * DAY + Math.round(hour * TPH);
}
