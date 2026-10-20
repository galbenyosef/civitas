/**
 * Onboarding (docs/early-game-audit.md, "Onboarding"): a chain of goals for a new player's first two hours and the
 * advisor's one-shot hints. The definitions are data both sides read: the server (server/src/goals.ts) measures each
 * goal's parts and pays the reward, the client (client/src/onboarding.ts) draws the card, the "show me" and the hints.
 */

import { ECONOMY_TUNING } from './tuning';

/** The overdraft line in words, for the money hints (server/src/sim/finance.ts has the rules). */
const OD = `$${ECONOMY_TUNING.overdraftLimit.toLocaleString('en-GB')} overdraft at ${Math.round(ECONOMY_TUNING.overdraftInterestPerDay * 100)}% interest a day`;

export type GoalId =
  | 'plot' | 'road' | 'camp' | 'homes' | 'yard' | 'res12' | 'shops' | 'res50' | 'masonry' | 'cover' | 'leisure' | 'adverts' | 'books' | 'res250' | 'busline';

/** Where "show me" points the camera: the open land beside the Commons, the player's own land, or the nearest free ad slot. */
export type GoalFocus = 'commons' | 'plot' | 'slot';

export interface GoalDef {
  id: GoalId;
  title: string;
  /** what to do, one line */
  how: string;
  /** why it matters, one line */
  why: string;
  /** what is measured, each with its target; the goal is done when every part reaches its target */
  parts: { label: string; target: number }[];
  /** cash paid on completion, and/or a technology granted for free (when already owned, its price is paid instead) */
  reward: { cash?: number; tech?: string };
  /** the "show me" button: a tool to pick, a panel to open, where to look */
  show: { tool?: string; panel?: 'tech' | 'ledger' | 'lines' | 'admin' | 'adverts'; focus?: GoalFocus };
  /** on a frontier (docs/first-five.md section 0; welcome.start): other words, and another tool to light */
  frontier?: { how?: string; why?: string; tool?: string };
}

/**
 * The chain, in order: one goal is active at a time and the next two are previewed. The first five goals fall in the
 * first three minutes (docs/first-five.md: plot, street, camp, homes, yard, each answered on screen within seconds);
 * then 12 / 50 / 250 residents at about 4 / 15 / 60 minutes. Rewards are modest (about $3,000 over the whole chain
 * against $10-15k of tax in the same two hours) and land in the stretches where cash runs thin.
 */
export const GOALS: GoalDef[] = [
  { id: 'plot', title: 'Claim your plot', how: 'Buy Land (2) and drag out at least 8×8 tiles beside the Commons\' edge road.',
    why: 'Lots only grow beside a road the builders can reach: land touching the Commons is already connected.',
    parts: [{ label: 'tiles of land', target: 64 }], reward: {}, show: { tool: 'buy', focus: 'commons' } },
  { id: 'road', title: 'Lay a street', how: 'Road (3): drag streets through your plot and join them to the Commons\' road.',
    why: 'Every lot needs a road beside it; every third row is a good rhythm.',
    parts: [{ label: 'road tiles on your land', target: 12 }], reward: { cash: 100 }, show: { tool: 'road', focus: 'plot' },
    frontier: { how: 'Road (3): drag a street on from the end of the country road into your land, and a side street or two.', why: 'Every lot needs a road beside it; the country road already joins your land to the gate everyone arrives through.' } },
  // the pioneer camp (docs/first-five.md): it opens the moment it is pitched and its eight settlers come up the road at once
  { id: 'camp', title: 'Pitch camp', how: 'Pioneer camp (under Residential): click a tile beside your street. It opens at once, no builders needed.',
    why: 'Eight settlers come up the road within the hour: your first residents, and the crew for your builders\' yard.',
    parts: [{ label: 'pioneer camp', target: 1 }], reward: { cash: 150 }, show: { tool: 'camp', focus: 'plot' },
    frontier: { why: 'Eight settlers come in through the gate within the hour: your first residents, and the crew for your handyman.' } },
  { id: 'homes', title: 'Zone homes', how: 'Residential (4): paint lots along your streets. Zoning goes round roads.',
    why: 'Each lot opens a building site. Homes bring residents, and residents pay property tax to you.',
    parts: [{ label: 'residential lots beside a road', target: 24 }], reward: { cash: 200 }, show: { tool: 'res', focus: 'plot' } },
  { id: 'yard', title: 'Hire your own builders', how: "Builders' yard (Y): place one beside your street, near the camp ($300; your first opens at once).",
    why: 'Your settlers take its jobs and set off for the nearest sites the moment it opens; a first house takes them minutes.',
    parts: [{ label: "builders' yard", target: 1 }], reward: { cash: 300 }, show: { tool: 'yard', focus: 'plot' },
    frontier: { how: "Handyman's workshop (Builders, the first size, $120): place it beside your street, near the camp. It opens at once.", why: 'Two of your settlers take its jobs and set off for the nearest sites the moment it opens; a first house takes them minutes.', tool: 'handyman' } },
  { id: 'res12', title: 'First homes', how: 'Watch the first houses finish and families move in: builders walk site to site and work their shift.',
    why: 'Twelve residents in proper homes (the camp aside) open Commercial zoning on the tech tree.',
    parts: [{ label: 'residents in homes', target: 12 }], reward: { tech: 'zon1' }, show: { focus: 'plot' } },
  { id: 'shops', title: 'Open the shops', how: 'Commercial (5): zone a few lots near your homes.',
    why: 'Shops give your residents work close by, and their staff pay income tax to you rather than to the Commons.',
    parts: [{ label: 'commercial lots', target: 6 }, { label: 'shop jobs filled', target: 8 }], reward: { cash: 300 }, show: { tool: 'com', focus: 'plot' } },
  { id: 'res50', title: 'A growing town', how: 'Keep zoning homes along your streets, and a few more shops.',
    why: 'Fifty residents open Industrial zoning and most of tier 2.',
    parts: [{ label: 'residents', target: 50 }], reward: { cash: 300 }, show: { tool: 'res', focus: 'plot' } },
  { id: 'masonry', title: 'Masonry', how: 'Open the tech tree (T) and unlock Masonry once 1,500 units of building work are done.',
    why: 'Two-storey buildings: each lot holds twice the people.',
    parts: [{ label: 'Masonry unlocked', target: 1 }], reward: { cash: 250 }, show: { panel: 'tech' } },
  { id: 'cover', title: 'Police and fire cover', how: 'Unlock Emergency services (T), then place a police box and a fire post: cheap, with few staff.',
    why: 'Covered homes grow faster and put up with higher taxes. Half their staff wages come from a regional grant.',
    parts: [{ label: 'police building', target: 1 }, { label: 'fire building', target: 1 }], reward: { cash: 200 }, show: { tool: 'policebox', focus: 'plot' } },
  { id: 'leisure', title: 'Somewhere to go', how: 'Park (G): place one among your homes ($120, no technology needed).',
    why: 'Bored residents are unhappy residents; a park nearby keeps them content.',
    parts: [{ label: 'park or venue', target: 1 }], reward: { cash: 150 }, show: { tool: 'citypark', focus: 'plot' } },
  // adverts (docs/adverts.md): unlock Advertising, make a campaign, rent two frames. "Show me" opens the tech tree until it is
  // unlocked, then the Campaigns panel, and flies to the nearest free frame (client onboarding.ts)
  { id: 'adverts', title: 'Run your first campaign', how: 'Unlock Advertising (T), then open the ads chip: pick a theme and a claim, and rent two empty frames on shops, shelters or hoardings.',
    why: 'Your posters go up on real walls for everyone to see, and rent for frames on your own frontage comes back to you.',
    parts: [{ label: 'Advertising unlocked', target: 1 }, { label: 'campaign made', target: 1 }, { label: 'frames rented', target: 2 }], reward: { cash: 250 }, show: { panel: 'adverts', focus: 'slot' } },
  { id: 'books', title: 'Balance the books', how: 'Open the ledger (click the treasury) and finish a day with taxes covering wages and upkeep.',
    why: 'Running costs come out every day. The tax slider in a parcel panel is the quickest lever.',
    parts: [{ label: 'residents', target: 40 }, { label: 'days in the black', target: 1 }], reward: { cash: 300 }, show: { panel: 'ledger' } },
  { id: 'res250', title: 'A real town', how: 'Grow to 250 residents: more homes, jobs near them, and signals (T) when the crossroads clog.',
    why: 'Public transport (tier 5) opens at 200 residents; regional services at 300.',
    parts: [{ label: 'residents', target: 250 }], reward: { cash: 500 }, show: { tool: 'res', focus: 'plot' } },
  { id: 'busline', title: 'First bus line', how: 'Unlock Public transport (T), place bus stops beside your roads and draw a line in the Lines panel.',
    why: 'A bus takes a dozen cars off a jammed street, and fares go to you.',
    parts: [{ label: 'bus line with 2+ stops', target: 1 }], reward: { cash: 400 }, show: { tool: 'busstop', panel: 'lines', focus: 'plot' } },
];
export const GOAL_BY_ID = new Map(GOALS.map((g) => [g.id, g]));
/** Goals shown after the active one. */
export const GOAL_PREVIEW = 2;

/** A player's onboarding as the server sends it, only to that player. */
export interface GoalsDTO {
  /** goals completed (in completion order) */
  done: GoalId[];
  /** the goal being worked on, or null when the chain is finished */
  active: GoalId | null;
  /** the active goal's parts, current values in the order of GoalDef.parts */
  parts: number[];
  /** the player chose to skip the tutorial: no card, no tips (alerts still come) */
  skipped: boolean;
  /** hints the player dismissed: never shown again */
  dismissed: string[];
}

/**
 * Advisor hints. `alert`s name a problem and come even after the tutorial is skipped; `tip`s are teaching and stop with
 * it. The server sends the ones only it can see (builders, the books, the jam, boredom, newcomers), the client raises the
 * rest (night, a refused build on an empty treasury); either way the client shows at most one per HINT_GAP ticks.
 */
export type HintId = 'settlers' | 'builders' | 'buildersRoad' | 'deficit' | 'overdraft' | 'admin' | 'broke' | 'jam' | 'bored' | 'newcomers' | 'night' | 'fire' | 'power';
/** `panel` 'admin': the overdraft and administration panel (client finance.ts) */
export interface HintDef { kind: 'tip' | 'alert'; msg: string; tool?: string; panel?: 'tech' | 'ledger' | 'lines' | 'admin' }
export const HINTS: Record<HintId, HintDef> = {
  // the first-settlers moment (docs/first-five.md): the server sends it once per player with `at` (the camp) and the
  // first arrival's name in `msg`; the client flies the camera there for a few seconds instead of showing a strip
  settlers: { kind: 'tip', msg: 'Your first settlers have arrived' },
  builders: { kind: 'alert', tool: 'yard', msg: "Your lots are waiting: the Commons' builders serve the Commons first. Place a builders' yard ($300; your first opens at once) beside one of your roads." },
  buildersRoad: { kind: 'alert', msg: "Your lots are waiting and nobody has built on your land for a day: check that a road links your builders' yard to them." },
  deficit: { kind: 'alert', panel: 'ledger', msg: `You are spending more than you earn, two days running: staff wages and upkeep come out of your treasury. Raise the tax slider in a parcel, add homes, or hold off on services. Below zero you run on the ${OD}; ${ECONOMY_TUNING.adminAfterDays} midnights in a row below zero and the city goes into administration.` },
  overdraft: { kind: 'alert', panel: 'admin', msg: `The treasury is below zero: you are on the ${OD}. ${ECONOMY_TUNING.adminAfterDays} midnights in a row below zero and the city goes into administration. Three levers: raise tax, sell empty land back, mothball services.` },
  admin: { kind: 'alert', panel: 'admin', msg: 'Your city is in administration: building, buying land, zoning, roads and research are stopped and the regional grant for staff wages is withdrawn until a midnight finds the treasury at zero or above. The recovery plan: raise tax, sell empty land back, mothball services.' },
  broke: { kind: 'alert', panel: 'ledger', msg: 'The treasury is nearly empty.' },
  jam: { kind: 'alert', tool: 'res', panel: 'tech', msg: 'Traffic has been jammed all day: traffic signals (T), a bus line, or jobs closer to the homes all help.' },
  bored: { kind: 'tip', tool: 'citypark', msg: 'Residents are bored, with nowhere to go: a park costs $120 and needs no technology.' },
  newcomers: { kind: 'tip', tool: 'motorway', panel: 'tech', msg: 'Newcomers are moving straight into your homes. Parking lots (T, $150) also brings the motorway connection: newcomers then drive in through it, and visitors and freight use it too.' },
  fire: { kind: 'alert', tool: 'firepost', panel: 'tech', msg: 'A fire has broken out. A staffed fire post or station sends its engine to fires within 14 tiles and keeps the damage down; without one a building burns down and you pay for it. Emergency services (T) brings the fire post.' },
  night: { kind: 'tip', msg: "It's night in the city. The light chip at the top right holds the view at mid-afternoon; click it again to follow the clock." },
  // utilities (docs/utilities.md section 3.4): growth to two storeys held back by power
  power: { kind: 'alert', tool: 'substation', panel: 'tech', msg: 'Buildings want power to grow to two storeys. Unlock Electrification (T) and place a substation beside your streets: its supply runs 10 road tiles along them, and the National Grid feeds it (at a price) while it is within 64 road tiles of a motorway connection.' },
};
export const isHintId = (id: string): id is HintId => id in HINTS;

/** Words for a goal's reward, e.g. "$300" or "Commercial zoning, free". */
export function rewardText(g: GoalDef, techName: (id: string) => string): string {
  const bits: string[] = [];
  if (g.reward.cash) bits.push(`$${g.reward.cash}`);
  if (g.reward.tech) bits.push(`${techName(g.reward.tech)}, free`);
  return bits.join(' and ');
}
