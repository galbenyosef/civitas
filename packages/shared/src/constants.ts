/** Tiles per chunk edge. The world is an unbounded grid of chunks. */
export const CHUNK_SIZE = 32;
/** Simulation tick length in ms (5 Hz). */
export const TICK_MS = 200;
/** Ticks per in-game day (8 min real time). */
export const TICKS_PER_DAY = 2400;
export const TICKS_PER_HOUR = TICKS_PER_DAY / 24;
export const TICKS_PER_MINUTE = TICKS_PER_HOUR / 60;
/** Ticks for n game minutes. */
export const gameMin = (n: number) => Math.round(n * TICKS_PER_MINUTE);
export const DAYS_PER_WEEK = 7;
/** Starting treasury for a new player. */
export const START_MONEY = 20000;
/**
 * A frontier start (docs/first-five.md section 0): the treasury, and the free land charter round the road end (tiles per
 * side). The money is tuned with the frontier's rank targets (shared/src/ranks.ts, docs/ranks.md section 3): bot F's
 * treasury stays above $5,000 for the first three hours, and the ranks keep their times.
 */
export const FRONTIER_MONEY = 18000;
export const FRONTIER_CHARTER = 32;
/** Price per tile when buying unclaimed land. */
export const LAND_PRICE_PER_TILE = 10;
/** Largest parcel edge a single purchase may claim. */
export const MAX_PARCEL_EDGE = 48;
export const ROAD_COST = 10;
/** Roads on unclaimed (public) land cost more but anyone may lay them. */
export const PUBLIC_ROAD_COST = 20;
export const ZONE_COST = 25;
export const BULLDOZE_COST = 5;
/** Daily upkeep charged to a parcel owner per road tile inside the parcel. */
export const ROAD_UPKEEP = 0.5;
/** Highest level any zone reaches (the tile's 3-bit level field): 1×1 lots stop at 3, merged lots (zones.ts) climb to 7. */
export const MAX_LEVEL = 7;
/** Max chunks a single client may hold subscriptions to. */
export const MAX_SUBS = 256;
/** Movement speeds: tiles per game hour, and the derived tiles per tick. */
export const WALK_TILES_PER_HOUR = 20;
export const DRIVE_TILES_PER_HOUR = 50;
export const WALK_SPEED = WALK_TILES_PER_HOUR / TICKS_PER_HOUR;
export const DRIVE_SPEED = DRIVE_TILES_PER_HOUR / TICKS_PER_HOUR;
/** Share of citizens who own a car (office workers a little more), and the shortest trip worth driving. */
export const CAR_OWNERSHIP = 0.7;
export const CAR_OWNERSHIP_OFFICE = 0.85;
export const DRIVE_MIN_TILES = 4;
/** Walking distance a driver will go to fetch a car parked away from where they are. */
export const CAR_FETCH_RADIUS = 8;

// ---- traffic -----------------------------------------------------------------
// Lane capacity, signal timing, crossing waits and the stuck rule are runtime tunables: see TRAFFIC_TUNING in tuning.ts.
/** Clear air kept between bumpers, in tiles (personal variation is added on top). */
export const MIN_GAP = 0.12;
/** Lane centre and sidewalk line, as offsets from a road tile's centreline (right-hand traffic). The road texture's sidewalk strip is 0.125 wide. */
export const LANE_OFFSET = 0.19;
export const SIDEWALK_OFFSET = 0.42;
/** Vehicle length in tiles by VehicleClass (sedan, truck, van, bus, and the server-only two-wheeler BIKE_CLASS 4 of fleet.ts) and the common width. */
export const VEHICLE_LEN = [0.34, 0.46, 0.4, 0.6, 0.16];
export const VEHICLE_WIDTH = 0.18;
/** How far (in tiles) a driver will go to find a lot when the destination is full. */
export const PARK_RADIUS = 10;
/** Fee a parking lot charges per stay, paid to the parcel owner. */
export const PARKING_FEE = 2;
/** Cars that can park at the kerb of one road tile; each one costs the lane a slot. */
export const KERB_CAP = 2;
/** Congestion is reported per chunk every this many ticks. */
export const TRAFFIC_EVERY = 10;
/** Freight: trucks per industrial level per game day; visitors per 100 population per peak hour. */
export const FREIGHT_TRIPS_PER_LEVEL_PER_DAY = 6;
export const VISITORS_PER_100_PEAK_HOUR = 12;
/** Default tax rate for a freshly bought parcel. */
export const DEFAULT_TAX = 0.1;
export const MAX_TAX = 0.5;
/** Civic services: staffed buildings within this many tiles cover a home. */
export const SERVICE_RADIUS = 14;
