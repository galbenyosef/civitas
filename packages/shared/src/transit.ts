import { surnameFor } from './names';

/**
 * Public transport, shared by every mode (docs/transit.md). A **line** is an owner's ordered list of stops, run as a
 * loop (S0 … Sn-1, back to S0) or there and back (S0 … Sn-1 … S1, back to S0). The order a vehicle visits the stops in
 * is the line's **calls**: a stop appears once per call, so on a there-and-back line the middle stops have two calls,
 * one per direction, and a rider's trip is from one call to a later one. Buses (server/src/sim/transit.ts) and
 * trains (the rail module) both run lines of this shape; the server keeps every line in one registry and plans
 * riders over all of them.
 */
export type TransitMode = 'bus' | 'rail' | 'metro';
/** A stop on a line: the tile of the stop building (a bus stop) or the door tile of a station. */
export interface StopRef { x: number; y: number }
export interface TransitLine {
  id: number;
  /** player id of the owner, who is paid the fares */
  owner: string;
  mode: TransitMode;
  /** the number on the front of the bus, 1-999 */
  number: number;
  /** livery / ribbon colour, 0xRRGGBB */
  colour: number;
  stops: StopRef[];
  /** true: a loop back to the first stop; false: there and back */
  loop: boolean;
  /** vehicles the owner wants in service (each needs a driver on shift) */
  vehicles: number;
  /** the line's name ("Central"), shown in place of its number where there is one (metro lines); absent in older worlds */
  name?: string;
}

/** Stop kinds by catalogue kind id, and the mode they serve (17: bus stop). Rail stations add their ids here. */
export const STOP_KINDS: Record<number, TransitMode> = { 17: 'bus', 18: 'rail', 19: 'rail', 20: 'rail', 22: 'metro', 23: 'metro' }; // 18 rail halt, 19 rail station, 20 freight yard (buildings/rail.ts); 22 metro entrance, 23 metro station (buildings/metro.ts)
export const BUS_STOP_KIND = 17;
export const BUS_DEPOT_KIND = 16;
export const stopModeOf = (kindId: number): TransitMode | undefined => STOP_KINDS[kindId];

/** Transit tunables (read at their use sites so an offline run can change them). */
export const TRANSIT = {
  /** fare per boarding, paid to the line owner (a change pays again); children ride free, retirees pay half */
  fare: 2,
  /** Manhattan tiles from the origin / to the destination within which a stop is used */
  catchment: 5,
  /** a change of line may walk this far (Manhattan tiles) to another stop, and costs this many perceived ticks on top */
  transferWalk: 4,
  transferPenalty: 10,
  /** riders a bus carries */
  busCapacity: 40,
  /** service hours (buses leave the depot for the first call at start and are back after end; end > 24 wraps past midnight) */
  serviceStart: 5.5,
  serviceEnd: 24.5,
  /** dwell at a stop: ticks to pull in and open the doors, plus ticks per rider boarding or alighting */
  dwellBase: 4,
  dwellPerRider: 0.34,
  /** anti-bunching: hold at a stop while closer than this share of the even headway behind the bus ahead, at most holdMax ticks */
  bunchShare: 0.5,
  holdMax: 12,
  /** buses per line at most, stops per line at most */
  maxVehicles: 12,
  maxStops: 24,
  /** a rider gives up and walks after waiting max(waitMin, waitMul × expected wait) ticks */
  waitMin: 60,
  waitMul: 3,
  /**
   * mode choice: money is worth this many ticks per dollar; waiting and walking feel this much longer than riding,
   * and a walk feels longer per minute the longer it is (walkCost): a 3-tile stroll to a stop barely counts, a 15-tile
   * trek on foot weighs about twice its time
   */
  ticksPerDollar: 10,
  waitWeight: 1.5,
  walkWeight: 1.3,
  walkFatigue: 60,
  /** trips shorter than this (Manhattan tiles) are always walked or driven */
  minTrip: 7,
  /** personal taste: transit time is perceived × (tasteMin + tasteSpan × hash) */
  tasteMin: 0.7,
  tasteSpan: 0.75,
  /** share of depot staff who are mechanics rather than drivers (hash-seeded per citizen) */
  mechanicShare: 0.2,
};

/** How long a walk of `ticks` feels, in ticks of riding (TRANSIT.walkWeight, growing with length by walkFatigue). */
export function walkCost(ticks: number): number {
  return TRANSIT.walkWeight * ticks * (1 + ticks / TRANSIT.walkFatigue);
}

/** A stable stop name from its tile, the same on server and client ('Okafor Road'). */
const STREET = ['Street', 'Road', 'Lane', 'Avenue', 'Square', 'Parade', 'Corner', 'Row'];
export function stopName(x: number, y: number): string {
  const s = (x * 7919 + y * 104729) | 0;
  return `${surnameFor(s)} ${STREET[Math.abs(s) % STREET.length]}`;
}

/** Service hours as fractions of a day: in service at hour-of-day h? */
export function inServiceHours(h: number): boolean {
  const s = TRANSIT.serviceStart, e = TRANSIT.serviceEnd;
  return e > 24 ? h >= s || h < e - 24 : h >= s && h < e;
}

/** A line as the client sees it: the line itself plus what the server worked out. */
export interface LineInfo extends TransitLine {
  ownerName: string;
  /** 'running', or why not ('no depot', 'no route between Okafor Road and …', 'no drivers on shift', 'outside service hours') */
  status: string;
  /** the road path one vehicle drives round, flat [x0,y0,…] tile coords (for the ribbon) */
  path: number[];
  /** stop index per call, and the path node of each call */
  calls: number[];
  callNodes: number[];
  inService: number;
  ridersToday: number; ridersYesterday: number;
  faresToday: number;
  /** per stop (same order as stops): boardings today */
  stopBoardings: number[];
}
/**
 * Why a line cannot run as drawn, or a warning about it (LinePreview.problem, and the text of a refused save): what is
 * wrong, which stops, how to fix it, and what to mark on the map.
 */
export interface LineProblem {
  message: string;
  fix?: string;
  /** stop indexes of the leg that failed (from → to), or the one stop at fault */
  from?: number; to?: number; stop?: number;
  /** the failing leg drawn straight, flat [x0, y0, x1, y1] tile coords (stop to stop, or depot to stop) */
  leg?: number[];
  /** tiles to mark in red: the land a road would join the streets over, a stop to move, flat [x, y, …] */
  tiles: number[];
  /** a tile to suggest instead (a free tile beside a plain stretch of road for a stop), flat [x, y] */
  suggest?: number[];
  /** true: the line cannot be saved; false: a warning (it saves, but buses will not run until it is fixed) */
  fatal: boolean;
}
/** A draft line routed by the server before it is saved (the 'linePreview' message, docs/transit.md "Building a network"). */
export interface LinePreview {
  /** the client's draft counter this answers */
  seq: number;
  ok: boolean;
  /** the lap, as far as it could be routed: flat [x0, y0, …] tiles (closed, back to node 0, when ok) */
  path: number[];
  /** stop index per call, and the path node of each call routed */
  calls: number[];
  callNodes: number[];
  /** where the bus turns round: flat [x, y, kind], kind 0 at a dead end, 1 in a junction mouth, 2 via the depot */
  turns: number[];
  /** tiles driven in one lap, and a rough round trip in ticks (driving, turning round, a dwell at each call) */
  length: number;
  lapTicks: number;
  problem?: LineProblem;
  /** metro lines (docs/underground.md): the tunnel tiles saving would bore, flat [x, y, …]; the new crossovers over
   * another line's tunnel, flat [x, y, …]; and what boring costs the owner ($0 when the tunnel is all there) */
  bore?: number[]; crossovers?: number[]; cost?: number;
}
/** LineProblem as one line of text: the message, then the fix. */
export const problemText = (p: LineProblem) => (p.fix ? `${p.message}: ${p.fix.charAt(0).toLowerCase()}${p.fix.slice(1)}` : p.message);
/** The parts of a LineInfo that change as the vehicles run (the 'lineStats' message). */
export type LineStats = Pick<LineInfo, 'id' | 'status' | 'inService' | 'ridersToday' | 'ridersYesterday' | 'faresToday' | 'stopBoardings'>;
/** A stop's tooltip section (BuildingInfo.transit). */
export interface StopInfo {
  name: string;
  /** the road tile buses pull in at */
  board?: [number, number];
  waiting: number;
  lines: { id: number; number: number; colour: number; waiting: number; nextArrival?: number; inService: number }[];
  boardingsToday: number; boardingsYesterday: number;
  /** why no bus can call here, when that is the case */
  problem?: string;
}
/** A bus's tooltip section (CitizenInfo.bus). */
export interface BusInfo {
  line: number; number: number; colour: number;
  nextStop?: string;
  load: number; capacity: number;
  /** game minutes behind the expected running time to the next stop (0 on time) */
  delayMin: number;
  state: string;
}
