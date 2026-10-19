/**
 * Issue bubbles, the problems list and the data overlays (docs/audit-2026-10.md section 4.4, server/src/sim/issues.ts,
 * client/src/render/issues.ts, client/src/problems.ts). Shared so both sides agree on the codes and the wording.
 */

/** What is wrong with a building or lot: one 3-bit code per tile (the door tile of a structure); 0 is nothing. When several hold,
 * the first of on fire, no road, no builders, unstaffed, no customers, parking full, very unhappy is shown (server/src/sim/issues.ts).
 * On fire is set the moment a fire starts and cleared when it is out (server/src/sim/fires.ts), not on the issues' round. */
export const Issue = { None: 0, NoRoad: 1, NoBuilders: 2, Unstaffed: 3, ParkingFull: 4, NoCustomers: 5, Unhappy: 6, Fire: 7 } as const;
export type IssueCode = (typeof Issue)[keyof typeof Issue];
/** in the problems panel's order: a fire first, it is the one that will not wait */
export const ISSUE_CODES = [7, 1, 2, 3, 4, 5, 6] as const;

export interface IssueText {
  /** the panel's group heading and the tooltip's line */
  title: string;
  /** one line: what it means and what fixes it */
  explain: string;
}
export const ISSUE_TEXT: Record<number, IssueText> = {
  [Issue.NoRoad]: { title: 'No road', explain: 'Nothing grows or opens without a road beside it. Lay a road along the lot, or zone the lot next to one.' },
  [Issue.NoBuilders]: { title: 'No builders', explain: 'Builders were at work elsewhere but none came here for an hour. Place a builders\' yard of your own, check a road links it, or raise this site\'s priority.' },
  [Issue.Unstaffed]: { title: 'Unstaffed', explain: 'Fewer than half the staff it needs are at work. It needs homes nearby (people to hire) and a road to reach it.' },
  [Issue.ParkingFull]: { title: 'Parking full', explain: 'Drivers find it full and park at the kerb, slowing the street. Put a parking lot within ten tiles, or Deep foundations for parking underneath.' },
  [Issue.NoCustomers]: { title: 'No customers', explain: 'Nobody came all of yesterday. Customers need homes in reach by road; check the street links up.' },
  [Issue.Fire]: { title: 'On fire', explain: 'A fire is burning. The nearest staffed fire post or station within 14 tiles sends an engine; with none in reach it burns down. A fire post (Emergency services) is cheap.' },
  [Issue.Unhappy]: { title: 'Very unhappy', explain: 'The people living here are miserable: high taxes, long commutes, no services or nothing to do. Hover a resident to see why.' },
};

/** The data overlays the server can send (message `overlay`); congestion is the traffic message's own tint. 0 is none. */
export const Overlay = { None: 0, Coverage: 1, Leisure: 2, Happiness: 3, JobsHomes: 4 } as const;
export const OVERLAY_COUNT = 5;
export interface OverlayText { name: string; /** the legend's two ends */ lo: string; hi: string; /** 0 sequential (viridis-like), 1 diverging (blue-orange) */ ramp: 0 | 1; explain: string }
export const OVERLAY_TEXT: Record<number, OverlayText> = {
  [Overlay.Coverage]: { name: 'coverage', lo: 'none', hi: 'police, fire and health', ramp: 0, explain: 'Police, fire and health cover from staffed stations, on every lot' },
  [Overlay.Leisure]: { name: 'leisure', lo: 'nothing to do', hi: 'plenty to do', ramp: 0, explain: 'Parks and open venues in reach of each lot' },
  [Overlay.Happiness]: { name: 'happiness', lo: 'miserable', hi: 'happy', ramp: 0, explain: 'Mean happiness of the people living in each home' },
  [Overlay.JobsHomes]: { name: 'jobs / homes', lo: 'needs jobs', hi: 'needs homes', ramp: 1, explain: 'Jobs minus residents within 8 tiles: orange has more people than work, blue more work than people' },
};

/** Overlay bytes: 0 is no data (water, roads, a happiness tile with nobody home); 1-255 carry the value. */
export const overlayByte = (v01: number) => 1 + Math.round(Math.max(0, Math.min(1, v01)) * 254);
export const overlayValue = (b: number) => (b - 1) / 254;
/** service coverage that fills the ramp (three families at full strength) */
export const OVERLAY_COVERAGE_FULL = 3;
/** jobs-minus-residents within the radius that reaches either end of the diverging ramp */
export const OVERLAY_JOBS_RADIUS = 8, OVERLAY_JOBS_FULL = 80;
