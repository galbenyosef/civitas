/**
 * Settlement ranks (docs/ranks.md, Audit #4; docs/start-from-zero.md option C): Camp → Hamlet → Village → Town → City.
 * Each rank has needs measured on the player's own land, pays a charter grant when it is reached, and on a frontier
 * (docs/first-five.md section 0) grows the free charter by a ring of land. The goal chain (goals.ts) teaches the first
 * hour; ranks are what the town is working towards for the next three, so they never share a target with a goal.
 * The definitions are data both sides read: the server (server/src/ranks.ts) measures and pays, the client
 * (client/src/ranks.ts) draws the rank chip, the needs card, the milestone feed and the celebration.
 */

export type RankNeedId = 'residents' | 'jobs' | 'shops' | 'leisure' | 'cover' | 'black' | 'school' | 'busline' | 'level2';

export interface RankNeed { id: RankNeedId; label: string; target: number }

export interface RankDef {
  name: string;
  /** one line for the card: what this rank means for the town */
  blurb: string;
  /** what must all be met to reach it (empty for the starting rank) */
  needs: RankNeed[];
  /** the charter grant paid on reaching it */
  grant: number;
  /** on a frontier: the charter's side (tiles) at this rank, before the gate-side cap (charterRing) */
  side: number;
  /** on a frontier: from this rank on, land beyond the charter may be bought as anywhere (the land rules of landrules.ts) */
  open?: boolean;
}

/**
 * The ladder, tuned with the frontier bot (docs/ranks.md section 3): a player who follows the goals card reaches Hamlet
 * at about 20 real minutes at 1×, Village at 45, Town at 90 and City at 150. The grants sit where the frontier's cash
 * trough was (docs/first-five.md: $750-1,300 from minute 2 to minute 20) and grow with what the next rank costs to build.
 */
export const RANKS: RankDef[] = [
  { name: 'Camp', blurb: 'Tents round a fire pit at the end of the road, and a town to come.', needs: [], grant: 0, side: 32 },
  { name: 'Hamlet', blurb: 'A cluster of homes with a shop and somewhere to sit: people start to call it a place.',
    needs: [{ id: 'residents', label: 'residents', target: 80 }, { id: 'shops', label: 'shops open', target: 2 }, { id: 'leisure', label: 'park or venue', target: 1 }],
    grant: 2000, side: 48 },
  { name: 'Village', blurb: 'Its own jobs, a police box and a fire post: a village looks after itself.',
    needs: [{ id: 'residents', label: 'residents', target: 180 }, { id: 'jobs', label: 'jobs filled on your land', target: 60 }, { id: 'cover', label: 'police and fire cover', target: 2 }],
    grant: 3500, side: 64 },
  { name: 'Town', blurb: 'Two-storey streets, a working economy and books that balance: a market town.',
    needs: [{ id: 'residents', label: 'residents', target: 320 }, { id: 'jobs', label: 'jobs filled on your land', target: 120 }, { id: 'level2', label: 'two-storey buildings', target: 10 }, { id: 'black', label: 'days in the black in a row', target: 3 }],
    grant: 6000, side: 80 },
  { name: 'City', blurb: 'Schools or buses, and people coming from far off to work: a city, with the land rules of the wide world.',
    needs: [{ id: 'residents', label: 'residents', target: 550 }, { id: 'jobs', label: 'jobs filled on your land', target: 220 }, { id: 'school', label: 'pupils at school, or a bus line', target: 1 }],
    grant: 10000, side: 96, open: true },
];
export const TOP_RANK = RANKS.length - 1;

/** A frontier charter grows by at most this many tiles towards the gate (west): the gate stands 14 tiles off its west edge (server seed.ts). */
export const CHARTER_WEST_MAX = 10;

/**
 * The charter's land at a rank: RANKS[rank].side square, the seeded charter grown evenly north and south, and east and
 * west except that it never comes more than CHARTER_WEST_MAX tiles towards the gate (the rest of the growth goes east).
 */
export function charterRing(ch: { x: number; y: number; w: number; h: number }, rank: number) {
  const grow = Math.max(0, (RANKS[Math.max(0, Math.min(TOP_RANK, rank))].side - ch.w) / 2) | 0;
  const west = Math.min(grow, CHARTER_WEST_MAX);
  return { x: ch.x - west, y: ch.y - grow, w: ch.w + 2 * grow, h: ch.h + 2 * grow };
}

/** One line of the milestone feed (newest first in RankDTO.feed). */
export interface Milestone {
  /** the world tick it happened */
  tick: number;
  /** what kind of thing: a rank reached, a goal done, a need met, a population or jobs mark, a first of something, research, money */
  kind: 'rank' | 'goal' | 'need' | 'people' | 'jobs' | 'first' | 'tech' | 'money' | 'land';
  text: string;
}

/** A player's ranks as the server sends them, only to that player. */
export interface RankDTO {
  /** index into RANKS */
  rank: number;
  /** the next rank's needs, current values in the order of RANKS[rank + 1].needs (empty at the top) */
  have: number[];
  /** the tick each rank was reached (index = rank; the starting rank's is when the record began) */
  at: number[];
  /** the latest milestones, newest first */
  feed: Milestone[];
  /** on a frontier, for the charter holder: the charter's land now and at the next rank */
  ring?: { x: number; y: number; w: number; h: number };
  next?: { x: number; y: number; w: number; h: number };
}

/** The `rank` message: the state, and when a rank was just reached, what came with it and where to celebrate. */
export interface RankUp { rank: number; grant: number; land?: { x: number; y: number; w: number; h: number }; at: [number, number] }

/** Words for what a rank brings: "$2,000 and the charter to 48×48". */
export function rankRewardText(rank: number, frontier: boolean): string {
  const r = RANKS[rank];
  const bits = [`$${r.grant.toLocaleString('en-GB')}`];
  if (frontier) bits.push(r.open ? `the charter to ${r.side}×${r.side} and open land beyond` : `the charter to ${r.side}×${r.side}`);
  return bits.join(' and ');
}
