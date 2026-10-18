/**
 * Traffic tunables, read at their use sites so an offline A/B run
 * (server/src/loadtest/ab.ts --set name=value,...) can change them without
 * editing code. The values here are the defaults the live game runs with;
 * docs/traffic-tuning.md has the matrix they were chosen from (ab.ts `old=1`
 * restores the rules as they were before it). Change them only before a world
 * is built: a few are cached (signal timing per junction). Flags are numbers
 * (0 / 1 / mode) so every knob parses the same way.
 */
export const TRAFFIC_TUNING = {
  // ---- the stuck rule -------------------------------------------------------------------
  /** Ticks a driver may go without progress before the stuck rule kicks in (0: never). */
  stuckLimit: 60,
  /**
   * How "without progress" is counted: 0 every stopped tick on the whole leg (a long commute through a few red
   * lights ran out of it without ever being jammed); 1 ticks since the car last reached a new tile.
   */
  stuckClock: 1,
  /**
   * At the stuck limit: 0 give up at once (citizen home, vehicle removed); 1 re-route around the blocked tile and keep
   * driving (abandonAfter); 2 give up only when clear of any junction box, a driver parking at the kerb and walking on
   * and a vehicle being withdrawn (home only as a last resort, after twice the limit); 3 the old give-up but never inside
   * a junction box; 4 as 0 outside a box, while a car stuck inside one has the first car clear of every box along the
   * chain holding it up released instead (itself only after three times the limit). See docs/traffic-tuning.md for why 0.
   */
  stuckReroute: 0,
  /** Ticks without progress after which a driver looks for a way round the blocked exit (then every 25 ticks; 0: only at the stuck limit). */
  rerouteAt: 0,
  /** With stuckReroute 4, a citizen who gives up parks at the kerb and walks on when there is a lot beside the car (otherwise goes home). */
  stuckKerb: 0,
  /** With stuckReroute 1, ticks stuck past the limit before the trip is abandoned (0: never). Never while inside a junction box. */
  abandonAfter: 0,

  // ---- re-routing on cumulative delay (Simulation.maybeReroute; docs/traffic-tuning.md) ----------------
  /**
   * 1: besides the driver at a standstill, one whose drive leg has taken much longer than expected at departure also
   * looks for another way at the re-route cadence, even while creeping rather than stopped (walkers: never).
   */
  delayReroute: 0,
  /** Running late: elapsed time on the leg exceeds the expected time (route cost at departure at free-flow speed) by this share ... */
  delayFrac: 0.4,
  /** ... and by at least this many ticks. */
  delayMinTicks: 20,
  /** A* node budget of a late driver's search (a held-up driver's stays at 4000). */
  delayNodes: 12000,
  /** A late driver takes the new route only when it costs less than this share of the rest of the current one (a held-up driver's is 0.85). */
  delayGain: 0.85,
  /** Most re-routes for lateness per leg. */
  delayMax: 3,

  // ---- two-wheelers (delivery bikes and mopeds, docs/mobile-jobs.md) -------------------------------------------------
  /**
   * A bike and a car filtering past each other in a lane while either is turning: 1 the body guard holds them as any two
   * vehicles; 2 only the bike gives way (a car is never held by a bike, so the two never wait for each other); 0 they
   * filter through turns too.
   */
  bikeTurnGuard: 1,

  // ---- signals (signalT, signalPeriod and signalAmber are shared with the client, which draws the same phase) -------
  /** Lights at T-junctions as well as crossroads (1) or only at four-arm junctions (0). */
  signalT: 1,
  /** Ticks per signal phase, before each junction's own ±20%. */
  signalPeriod: 15,
  /** Amber ticks at the end of each green. */
  signalAmber: 2,
  /** 1: hold a green while nobody waits on red and someone waits on green, up to 2× the period (server-side only: the client would not show it). */
  signalActuated: 0,

  // ---- junction entry rules ---------------------------------------------------------------
  /**
   * Same approach, different exit: 0 the follower waits until the leader has left the box; 1 may enter once the
   * leader is past the box centre; 2 (with conflictRemaining) once the rest of the leader's path no longer crosses its own.
   */
  sameApproachRelax: 2,
  /**
   * Who counts as in a box on the way in: 0 a car whose progress is past its stop line (the old test, which a car
   * stopped exactly at the line can pass by rounding, so two cars facing each other each see the other "in the box"
   * and wait for ever); 1 a car that has committed to going in (decided at the stop line), wherever it is.
   */
  boxByCommit: 1,
  /**
   * What a car already in a box blocks: 0 every movement its whole path through the tile conflicts with (the table);
   * 1 only movements that conflict with the part of its path still under or ahead of its rear bumper, so a car
   * waiting at the far edge of a box no longer holds movements its turn crossed earlier.
   */
  conflictRemaining: 1,
  /**
   * 1: stop lines and "clear of the box" are measured along the real path, not in lane-progress units. Progress is
   * a fraction of the lane, and a right-turn arc is only half a tile long, so a car stopped at the old line on a
   * right-hand bend has its nose in the next tile, and a car turning right out of a junction leaves the box later
   * than its progress says.
   */
  arcAware: 1,
  /**
   * Arriving at a building: 0 wait until nothing at all is in its forecourt (the old rule, which deadlocks with a car
   * waiting to pull out of the same building); 1 wait only for movements that cross yours (the conflict table: the
   * in and out lanes of a driveway are straight and a lane apart, so a car pulling out does not block one pulling in).
   */
  forecourtConflict: 1,
  /** Don't block the box: 1 at junctions, 2 at every road tile, enter only when the tile after it will take you too. */
  boxClear: 0,
  /**
   * 1: a car may go into a box past a conflicting car that is standing still there (held up by something else)
   * when its own whole path through the box clears that car's body; the body guard covers that car moving off later.
   */
  passStationary: 0,
  /**
   * 1: a car pulls out (from a building, an entry tile or the kerb) only when nothing else is in that tile's box and no
   * pedestrian is where it would appear; 2 also, out of a building, only when the road tile would let it in, so cars
   * wait in the garage rather than in the forecourt (where they block cars arriving from the building's other side).
   */
  spawnClear: 2,
  /** Ramp metering: a car leaves a building only while the congestion of the road tile outside is below this (0..1; 1: always). */
  meterCongestion: 1,
  /** Lane admission: 0 a fixed count (laneCap); 1 by length, sum of (length + MIN_GAP) of the cars in the lane plus the newcomer within laneRoom. */
  laneByLength: 0,
  laneCap: 2,
  laneRoom: 1.0,
  /** Route cost of a fully congested tile on top of the empty-road cost of 1 (drivers route round jams by this). */
  congestionWeight: 8,

  // ---- pedestrians and crossings ------------------------------------------------------------
  /** Ticks a car waits for pedestrians on the crossing before nosing in when there is a gap (0: never; the body guard keeps it off them). */
  carYieldMax: 15,
  /** Ticks a pedestrian waits at an unsignalled kerb for cars in the box before stepping out anyway (0: never). */
  crossingWaitMax: 20,
  /** 1: cars read only last tick's crossings (one-tick lag); 0: last tick's and this tick's. */
  crossingLag: 1,
  /** 1: a pedestrian waiting at an unsignalled kerb claims the crossing, so no new car enters while the box clears. */
  pedPriority: 0,
  /** 1: at lights a pedestrian never crosses against the red or into a busy box, however long the wait (no hard cap). */
  pedSignalPatient: 1,
  /** Unsignalled crossings: a pedestrian at the kerb lets a car go first once it has waited this many ticks at that tile's stop line (0: never). */
  pedYieldAfter: 0,
  /** 1: a pedestrian steps off the kerb only when the whole crossing ahead is clear of car bodies (so nobody is stranded between stopped cars). */
  pedPathClear: 0,

  // ---- the body guard: last resort behind all of the above ---------------------------------------
  /**
   * 1: a car never moves its body onto a pedestrian ahead of it (it stops short, wherever it is, driveways included),
   * and a pedestrian never steps into a car's body (walking out of one is always allowed).
   */
  bodyGuard: 1,
  /** 1: the guard also keeps cars apart: a car never moves its body into another car's ahead of it (oriented rectangles). */
  carGuard: 1,
  /**
   * The guard also protects bodies as the client draws them, a bit mask: 1 a moving car's body is also tested facing
   * the way it moves this tick (the client draws it facing its motion, not its path tangent, which differs by up to
   * ~35° on a tight turn); 2 a pedestrian also never steps into a car drawn that way; 4 a car pulls out only when
   * nobody stands within its length of the start, whichever way it faces. 7 is all three: about ten times fewer
   * contacts as drawn (what a player sees), for about 20% more give-ups (docs/traffic-tuning.md).
   */
  guardDrawn: 7,
  /** With bodyGuard, pedestrians behind a car's centre: 0 ignored (driving on takes it away from them), 1 the car still never swings its rear onto one. */
  pedBehind: 0,
  /** With bodyGuard, ticks a pedestrian held on a crossing by a car's body waits before stepping back to the kerb (0: never). */
  pedRetreatAfter: 10,
  /** With bodyGuard, ticks a pedestrian held by a car's body waits before walking on anyway (deadlock breaker; 0: never, the stuck rule frees them). */
  guardWaitMax: 0,

  // ---- roundabouts (shared/src/junctions.ts; docs/traffic-tuning.md "Roundabouts and flyovers") ----------
  /**
   * Give way on entry: a car coming onto a roundabout waits while a car already circulating, and moving, is within
   * this many tiles of the entry (0: no give-way, first come first served like a plain junction).
   */
  ringYield: 0.7,
  /**
   * 1: on a ring tile, merging is following: a car already out in the exit lane ahead of me no longer blocks the box
   * (the gap rule keeps the distance), and a car may go in behind one still in the box. 0: the plain junction rules.
   */
  ringMerge: 1,
  /**
   * Speed factor for the turns on to and off a roundabout (a turn at a plain junction slows a car to 0.6 for each
   * half; the ring's own wide corners never slow it). docs/traffic-tuning.md: 0.8 costs about a sixth of the capacity.
   */
  ringSlow: 1,
  /** Places round the ring (lane capacity × 8) a car coming on must leave free, so the ring never fills and locks. */
  ringSpare: 4,
};
export type TrafficTuning = typeof TRAFFIC_TUNING;
/** Hard cap on a pedestrian's wait at a signalled crossing: longer than any red. */
export const signalWaitMax = () => 2 * TRAFFIC_TUNING.signalPeriod * (TRAFFIC_TUNING.signalActuated ? 2 : 1);

/**
 * Economy tunables for the first hours of play (docs/early-game-audit.md, "After Gauntlet 3"), read at their use
 * sites. Like TRAFFIC_TUNING they may be overridden for an offline run: the server's ECON env var takes
 * `name=value,...` (server/src/index.ts).
 */
export const ECONOMY_TUNING = {
  /**
   * Share of public-service staff wages (police, fire, health and builders' yards; libraries and other leisure venues
   * pay staff from their takings) that comes out of the owner's treasury; the rest is a regional grant. At 1 a police
   * and a fire station and a yard (31 staff) cost a new player about $400 a day against $115-$360 of tax on days 2-4:
   * the cash cliff (docs/early-game-audit.md).
   */
  civicPayroll: 0.5,
};
export type EconomyTuning = typeof ECONOMY_TUNING;
