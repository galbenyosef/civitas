import {
  CHUNK_SIZE, Zone, KIND_COUNT, KIND_ID_COUNT, packTile, zoneOf, levelOf, isRoad, underConstruction, withLevel, withConstruction, withZone, withPriority, withProgress,
  capacity, chunkKey, tileKey, parseKey, localIndex, chunkOf, makeTerrainSampler, hash2, CAR_OWNERSHIP, CAR_OWNERSHIP_OFFICE,
  terrainOf, isStructureAux, structureAt, eachTile, kindIdOf, familyOf, subFor, capacityOf, isGrowableId, CitizenState, type Placed,
  isJunctionAux, isRingAux, isIslandAux, isFlyoverAux, islandOf, isArmPos, RING_POS, Terrain, isBridgeAux, bridgeSpanAt,
  type TransitLine, type ParcelDTO, type ParcelStats, type PlayerDTO, type Counter, TICKS_PER_DAY,
  type LedgerCat, type LedgerDTO, type FinanceDTO, ECONOMY_TUNING, spendableMoney, stopName, planCombine, planSplit, KIND_NAMES, isBuildable, type SeaGate, type EduFields, hasPolicy, type PolicyId,
} from '@msimcity/shared';
import { LIFE, stageFor } from './sim/life';
import type { GoalState } from './goals';
import type { RankState } from './ranks';
import type { FireSave } from './sim/fires';
import type { AdvertsSave } from './sim/adverts';
import type { NewsSave } from './sim/news';
import type { DeathSave } from './sim/death';
import type { UtilitiesSave } from '@msimcity/shared';

import { StreetBook } from './streets';
export interface Chunk {
  cx: number; cy: number;
  tiles: Uint16Array;
  parcel: Int32Array;
  /** aux layer, one byte per tile (shared/src/structures.ts): multi-tile structure anchors and parts */
  aux: Uint8Array;
  /** sub layer, one byte per tile (docs/sub-kinds.md): the kind id of a sub-kind; 0 = the family's base kind */
  sub: Uint8Array;
  /** under layer, one byte per tile (docs/underground.md, shared/src/metro.ts): tunnels and platforms; nothing on the surface reads it */
  under: Uint8Array;
  /** true once a player has changed anything; only modified chunks are persisted */
  modified: boolean;
}
/** Any zoned or civic tile, including empty lots (level 0). */
export interface Building {
  /** zone: the family code (tile kind bits; the building index is by family); id: the catalogue kind id (tables, names, behaviour) */
  x: number; y: number; zone: number; id: number; level: number; occupants: number;
  /** workplaces: workers holding a skilled place (sim/skills.ts, docs/education.md section 7); rebuilt on load */
  qualified?: number;
  /** homes: until this tick newcomers leave the last free bed to a family here (a couple moving in, a baby on the way) */
  holdUntil?: number;
  /**
   * halls of residence: the students living here (sim/learning.ts, docs/education.md section 18). A hall is a civic
   * building whose `occupants` are its staff, so its residents are counted here instead (World.bedIn); rebuilt on load.
   */
  lodgers?: number;
}
/**
 * A building (or upgrade) waiting for builders. Lives beside the tile's construction flag. `kind` is the kind id.
 * `merge`: lots merged into one bigger building (zones.ts, World.mergeLots); the people of the merged lots are kept on at
 * the door until it completes, so nobody is evicted while it is built.
 */
export interface Site { x: number; y: number; kind: number; target: number; work: number; total: number; assigned: number; priority: number; created: number; merge?: boolean }
/** One merge the growth step decided on: the new structure, the level it is built to and the builder work. */
export interface MergePlan { placed: Placed; target: number; work: number }
export interface Parcel {
  id: number; owner: string; name: string;
  x: number; y: number; w: number; h: number;
  taxRate: number;
  stats: ParcelStats;
  /** the estate it belongs to (docs/world-map.md section 2); absent in older saves and for lone parcels */
  group?: number;
  /** a colour its owner gave it on the map; absent: the owner's */
  color?: number;
}
export type Progress = Record<Counter, number>;
export const emptyProgress = (): Progress => ({ built: 0, roads: 0, housed: 0, jobs: 0, parked: 0, pupils: 0, graduates: 0 });
/** Treasury a dev player with unlimited funds is held at. */
export const DEV_FUNDS = 10_000_000;
export interface Player {
  id: string; name: string; color: number; money: number; tech: string[]; progress: Progress; /** dev servers only: treasury never runs out */ devUnlimited?: boolean;
  /** money in and out by category, today and yesterday (credit); saved with the player, absent in older saves */
  ledger?: LedgerDTO;
  /** onboarding goals and hints (goals.ts); saved with the player, absent in older saves */
  onboarding?: GoalState;
  /** education policies switched on (shared policies.ts); saved with the player, absent in older saves */
  policies?: string[];
  /** midnights in a row the treasury was below zero (sim/finance.ts); saved, absent in older saves and when not overdrawn */
  adminDays?: number;
  /** in administration since that game day (sim/finance.ts): building stops, the regional grant is withdrawn; saved */
  admin?: { since: number };
  /** settlement rank and milestone feed (ranks.ts); saved with the player, absent in older saves (derived on first use) */
  ranks?: RankState;
}

/** Anything that moves along a path; drivers also live in a traffic lane. */
export interface Mover {
  id: number;
  x: number; y: number;                 // continuous position (tile units)
  path: number[]; pi: number;           // current leg: flat [x,y,...] and index of the node being approached
  lane: number;                         // traffic lane key while driving, -1 otherwise
  prog: number;                         // 0..1 along the current lane
  wait: number;                         // consecutive ticks held up in traffic
  stuck: number;                        // ticks held up on this leg in total
  speedMul: number; gapMul: number;     // personal driving style
  cls: number;                          // VehicleClass for rendering
  len: number;                          // vehicle length in tiles
  inDir: number;                        // direction the current lane was entered from (for turn geometry)
  committed: boolean;                   // past the stop line, crossing into the next tile
  /** lane progress moved last tick: the speed car following starts from (TRAFFIC_TUNING.follow); 0 or absent when it pulls out or a save loads */
  v?: number;
  priority: boolean;                    // emergency vehicles ignore signals
  /** a fire engine on its way to a fire (sim/fires.ts): it pulls out into its forecourt to wait for a gap, and drives on down the middle of the road when traffic stops it */
  call?: boolean;
  rerouted: number;                     // tick of the last re-route
  // walking: the leg's polyline, which point is being approached, and per-point crossing / node bookkeeping
  pts: number[] | null; pp: number; cross: number[] | null; node: number[] | null; xdir: number[] | null;
  trail: number[];                      // tiles actually passed this trip, flat [x,y,...], oldest first (capped)
  /** buses (sim/transit.ts): path node of the stop's road tile it must not drive past (-1 / absent: none), and true while dwelling there */
  halt?: number; dwell?: boolean;
}
/** Most tiles a trail keeps; the oldest drop off first. */
export const TRAIL_MAX_NODES = 400;
/** Record that a mover reached tile (x, y), skipping a repeat of the last one. */
export function noteTrail(m: Mover, x: number, y: number) {
  const t = m.trail;
  const n = t.length;
  if (n >= 2 && t[n - 2] === x && t[n - 1] === y) return;
  t.push(x, y);
  if (t.length > TRAIL_MAX_NODES * 2) t.splice(0, t.length - TRAIL_MAX_NODES * 2);
}
/** Start a fresh trail at (x, y) for a new trip. */
export function resetTrail(m: Mover, x: number, y: number) { m.trail = [x, y]; }
/** One stretch of a trip: walk or drive, and what to do on arrival. */
export interface Leg {
  path: number[]; drive: boolean; arrive: 'none' | 'park' | 'parkLot' | 'parkHome' | 'pickup' | 'stop'; dest?: [number, number];
  /** car sharing (sim/carpool.ts): on a driver's legs, the trip's token; a 'stop' leg ends at a pick-up or drop-off on the way */
  pool?: number;
  /** a lift in someone else's car (sim/carpool.ts): whose, and where the passenger is going; `path` is the drive, for the route ribbon */
  lift?: { driver: number; dest: [number, number] };
  /** a ride on a transit line (sim/transit.ts): calls `from` to `to`, boarding at stop tile `board`, getting off at `off`; `path` is the stops and the road between, for the route ribbon */
  ride?: { line: number; from: number; to: number; board: [number, number]; off: [number, number] };
  /** a taxi or private-hire booking (sim/taxis.ts): wait at the kerb, ride, get out at `dest`; `path` is from and to, for the route ribbon */
  hail?: { booking: number; dest: [number, number] };
}
/** A road user that is not a citizen: freight, visitors from outside, patrols and call-outs. */
export interface Vehicle extends Mover {
  vkind: number;                        // VehicleKind
  phase: 'out' | 'dwell' | 'back';
  from: [number, number]; to: [number, number];
  until: number;                        // end of the dwell
  parkedAt: string | null; parkKerb: boolean;
  owner: string | null;                 // parcel owner who dispatched it (freight, patrols)
  legs: Leg[]; leg: Leg | null;
  /** what the buyer pays on delivery when it is not FREIGHT_FEE (harbour freight: fish by the box, sim/harbours.ts) */
  fee?: number;
  /** a fire engine on a call (Mover.call) held up in stopped traffic, driving on down the middle of the road out of the lanes (Simulation.weave) */
  weave?: boolean;
}
export interface Citizen extends Mover, EduFields {
  hx: number; hy: number;               // home tile
  job: boolean; wx: number; wy: number; // workplace tile
  kind: number;                         // workplace kind (occupation)
  skill?: number;                       // the level the worker's place needs (sim/skills.ts): 0 an unskilled place
  drain?: number;                       // days a graduate has been out of work or over-qualified (brain drain)
  grad?: number;                        // game day of graduating (set by the schools, E3): "graduated", and the brain-drain check
  appr?: number;                        // an apprentice: shifts done of the apprenticeship (sim/learning.ts, E5); absent otherwise
  state: number;
  commute: number[] | null;             // cached home->work path (walkers)
  car: boolean;                         // owns a car
  legs: Leg[]; leg: Leg | null;         // the rest of the current trip and the leg under way
  parkedAt: string | null;              // tile key where the car is; null = at home
  parkKerb: boolean;                    // parked on the street rather than in a building or lot
  money: number;
  // schedule
  shiftStart: number;                   // tick of day the shift begins (includes personal jitter)
  shiftLen: number;                     // ticks
  cycle: number[]; phase: number;       // work/rest day pattern and where this citizen is in it
  nextAt: number;                       // absolute tick of the next scheduled transition
  idleDays: number;
  site: string | null;                  // builders: tile key of the site they are assigned to
  venue: string | null;                 // café/bar/restaurant currently being visited
  venueUntil: number;
  venueThen: number;                    // state to continue with after the venue (ToWork or ToHome)
  preStop: boolean;                     // planned café stop before the next shift
  // life (sim/life.ts): one step per game day per citizen, plus cheap counters where trips advance
  born: number;                         // game day of birth (fractional; negative for people born before day 0)
  stage: number;                        // LifeStage, refreshed by the life step
  health: number;                       // 0-100
  cond: number;                         // Cond bit set: flu, injury, chronic
  condDays: number;                     // game days left of the acute conditions (flu, injury)
  care: number;                         // tick of a planned doctor's visit; 0 none, -1 already seen for this illness
  errand: number;                       // 1 while the current venue trip is a doctor's visit
  sickDays: number;                     // shifts skipped through illness, ever
  offSickDay: number;                   // last game day a shift was skipped through illness
  hh: number;                           // household id: everyone in a household shares the home
  sn: number;                           // surname seed, nameFor(id, sn): own id, or the household's for children born here
  partner: number;                      // 0 = single
  babyWait: number;                     // tick until which this couple waits for a free bed for a baby (0 = not planning)
  par: number;                          // a parent's id (0 = arrived as an adult)
  friends: number[];                    // at most LIFE.maxFriends citizen ids
  happy: number;                        // 0-100, from the last life step
  commuteTicks: number;                 // smoothed door-to-door time of the trip to work
  leisure: number;                      // smoothed venue visits per day
  tripStart: number;                    // tick the current trip was planned
  ledgerDay: number; in7: number[]; out7: number[]; // money in / out per game day, last 7 days (slot = day % 7)
  statsDay: number; tripsToday: number; trafficTicksToday: number; // today's counters; statsDay is the day they belong to
  trafficTicksLife: number;             // ticks held up in traffic since the last life step
  // education (shared/src/education.ts EduFields, docs/education.md): edu, track, study, sx/sy, att/due, eduBits, eduLog
  // migration (sim/gateways.ts): 1 travelling in from a gateway, 2 leaving town once home, 3 on the way out to gateway (gx, gy)
  mig?: number; gx?: number; gy?: number;
  // motivation (sim/motivation.ts, docs/motivation.md): six values 0-15, four bits each (shared/src/motivation.ts); 0 not yet seeded
  vals: number;
}
export type CitizenLifeFields = Pick<Citizen, 'born' | 'stage' | 'health' | 'cond' | 'condDays' | 'care' | 'errand' | 'sickDays' | 'offSickDay'
  | 'hh' | 'sn' | 'partner' | 'babyWait' | 'par' | 'friends' | 'happy' | 'commuteTicks' | 'leisure' | 'tripStart' | 'ledgerDay' | 'in7' | 'out7'
  | 'statsDay' | 'tripsToday' | 'trafficTicksToday' | 'trafficTicksLife'>;
/** Life fields for a citizen of a given age at `tick`: their own household, no links, health as given. */
export function lifeDefaults(id: number, tick: number, age: number, health: number): CitizenLifeFields {
  const day = Math.floor(tick / TICKS_PER_DAY);
  return {
    born: tick / TICKS_PER_DAY - age * LIFE.daysPerYear, stage: stageFor(id, age), health, cond: 0, condDays: 0, care: 0, errand: 0,
    sickDays: 0, offSickDay: -1, hh: id, sn: id, partner: 0, babyWait: 0, par: 0, friends: [], happy: 50, commuteTicks: 0, leisure: 0, tripStart: tick,
    ledgerDay: day, in7: [0, 0, 0, 0, 0, 0, 0], out7: [0, 0, 0, 0, 0, 0, 0], statsDay: day, tripsToday: 0, trafficTicksToday: 0, trafficTicksLife: 0,
  };
}
/**
 * The fields only some citizens are given, later in their lives, all undefined: every citizen is made with them
 * (Simulation.makeCitizen, and a saved one as it is loaded), so all keep one shape. Objects that gain a field later
 * each take a new hidden class, and London had eleven among its movers: past four, every read of a mover's fields in
 * the traffic step went through V8's megamorphic path, about nine times slower.
 */
export const citizenLater = (): Pick<Citizen, 'skill' | 'drain' | 'grad' | 'appr' | 'mig' | 'gx' | 'gy' | 'call' | 'halt' | 'dwell' | 'vals'> => ({
  skill: undefined, drain: undefined, grad: undefined, appr: undefined, mig: undefined, gx: undefined, gy: undefined, call: undefined, halt: undefined, dwell: undefined,
  vals: 0, // seeded by Simulation.makeCitizen, or on load (snapshot.ts)
});
/** The people sharing one home as a family: partners, their children, adult children who have not moved out. */
export interface Household { id: number; sn: number; ids: number[] }

const PALETTE = [0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6,
  0xbfef45, 0xfabed4, 0x469990, 0xdcbeff, 0x9a6324, 0xfffac8, 0x800000, 0xaaffc3, 0x808000, 0xffd8b1, 0x000075];

export const emptyStats = (): ParcelStats => ({
  population: 0, jobs: 0, employed: 0, roads: 0, taxToday: 0, taxYesterday: 0,
  jobsByKind: new Array(KIND_ID_COUNT).fill(0), staffedByKind: new Array(KIND_ID_COUNT).fill(0), sites: 0, buildings: 0, value: 0, // by kind id
});

/**
 * The authoritative world. Chunks are generated lazily from the seed the first
 * time anything touches them, so the map is effectively unbounded.
 */
export class World {
  chunks = new Map<string, Chunk>();
  parcels = new Map<number, Parcel>();
  players = new Map<string, Player>();
  citizens = new Map<number, Citizen>();
  /** households by id; kept in step by addCitizen / removeCitizen / setHousehold */
  households = new Map<number, Household>();
  vehicles = new Map<number, Vehicle>();
  buildings = new Map<string, Building>();
  sites = new Map<string, Site>();
  /** cars parked inside a building or lot, by tile key */
  parking = new CountMap<string>((k) => { const [x, y] = parseKey(k); return chunkKey(chunkOf(x), chunkOf(y)); });
  /** drivers turned away today, by building */
  parkFail = new Map<string, number>();
  /** cars parked at the kerb, by numeric road tile key (see tkey) */
  kerb = new CountMap<number>((k) => { const [x, y] = untkey(k); return chunkKey(chunkOf(x), chunkOf(y)); });
  lotIncome = new Map<string, number>();
  /** bus lines (and any mode that keeps its lines in the shared registry), by id; persisted (store.ts v7) */
  transitLines = new Map<number, TransitLine>();
  nextLineId = 1;
  /** bumped whenever any player's technology changes so caches can refresh */
  techVersion = 0;
  /** called after any tile change so the traffic layer can drop cached road geometry */
  onTileChanged: ((x: number, y: number) => void) | null = null;
  nextId = 1;
  day = 0;
  tick = 0;
  /** fires (sim/fires.ts): what to save, set by the Fires module; and what a loaded snapshot carried, taken once by it */
  firesSave: (() => FireSave) | null = null;
  firesLoaded: FireSave | null = null;
  /** adverts (sim/adverts.ts): what to save and what the goals and ranks read, set by the Adverts module; and what a loaded snapshot carried */
  adverts: { save(): AdvertsSave; counts(owner: string): { campaigns: number; rentals: number; posted: boolean } } | null = null;
  advertsLoaded: AdvertsSave | null = null;
  /** the news (sim/news.ts): what to save, set by the News module; and what a loaded snapshot carried, taken once by it */
  newsSave: (() => NewsSave) | null = null;
  newsLoaded: NewsSave | null = null;
  /** death and remembrance (sim/death.ts): what to save, set by the Death module; and what a loaded snapshot carried, taken once by it */
  deathSave: (() => DeathSave) | null = null;
  deathLoaded: DeathSave | null = null;
  /** utilities (sim/utilities.ts, docs/utilities.md): what to save, set by the Utilities module; and what a loaded snapshot carried, taken once by it */
  utilitiesSave: (() => UtilitiesSave | null) | null = null;
  utilitiesLoaded: UtilitiesSave | null = null;
  /** fired when builders finish a site (completeSite), after the tile shows the finished building: the news reports openings */
  onSiteCompleted: ((site: Site) => void) | null = null;
  /** merged lots since start (zones.ts): sites opened, lots absorbed, people moved, sites completed, people evicted at completion, structures broken back into lots */
  mergeStats = { opened: 0, absorbed: 0, residents: 0, workers: 0, completed: 0, evicted: 0, brokenUp: 0 };

  // change tracking consumed by the network layer after each tick
  dirtyTiles = new Map<string, [number, number]>();
  /** tiles whose aux byte changed, sent as their own delta stream */
  dirtyAux = new Map<string, [number, number]>();
  /** tiles whose sub byte changed, sent as their own delta stream */
  dirtySub = new Map<string, [number, number]>();
  /** tiles whose under byte changed, sent as their own delta stream */
  dirtyUnder = new Map<string, [number, number]>();
  /** bumped on every under-layer change, so the metro can re-derive its lines after any edit */
  underVersion = 0;
  /** station names by tileKey of the entrance (docs/underground.md); persisted (snapshot v8) */
  stopNames = new Map<string, string>();
  /** street names (streets.ts, docs/roads.md "Street names"): persisted (an optional snapshot field) */
  streets: StreetBook = new StreetBook(this);
  /**
   * Where bodies of water leave a scenario world (docs/boats.md 2.3): boats come and go there. Written by the seeder,
   * persisted (an optional snapshot field). Empty in a procedural world, where open water gets its own offing.
   */
  seaGates: SeaGate[] = [];
  /** how this world began (seed.ts): beside the Commons, or a frontier (docs/first-five.md section 0); saved */
  start: 'commons' | 'frontier' = 'commons';
  /** a frontier's road end, where a new player first looks, and the free charter the first player gets; saved */
  home?: [number, number];
  charter?: { x: number; y: number; w: number; h: number };
  dirtyParcels = new Set<number>();
  removedParcels = new Set<number>();
  playersDirty = false;
  /** doors ("x,y") of services and builders' yards their owners mothballed (sim/finance.ts): no staff, no upkeep, no
   *  coverage; saved in the snapshot. A building that goes or changes kind leaves the set (syncBuilding). */
  mothballed = new Set<string>();
  /** a player's overdraft and administration for the players message (sim/finance.ts sets it) */
  financeDTO: ((p: Player) => FinanceDTO | undefined) | null = null;

  private sampler: (x: number, y: number) => number;

  constructor(public seed: number) {
    this.sampler = makeTerrainSampler(seed);
  }

  // ---- chunks & tiles -------------------------------------------------

  getChunk(cx: number, cy: number, create = true): Chunk | undefined {
    if (cx === this.lastCx && cy === this.lastCy) return this.lastChunk;
    const nk = (cx + 0x800) * 0x1000 + cy + 0x800;
    let c = this.chunkByNum.get(nk);
    if (c) { this.lastCx = cx; this.lastCy = cy; this.lastChunk = c; return c; }
    const key = chunkKey(cx, cy);
    c = this.chunks.get(key);
    if (!c && create) {
      c = this.generateChunk(cx, cy);
      this.chunks.set(key, c);
      // a search that met this chunk unloaded saw no roads in it
      for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y += CELL) for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x += CELL) this.noteJobEdit(x, y);
    }
    if (c) this.chunkByNum.set(nk, c);
    return c;
  }
  /**
   * `chunks` by numeric key (a small integer: |cx|, |cy| < 2048), filled as chunks are looked up, so the road searches'
   * tens of thousands of tile peeks a tick build no key strings, and the last chunk found. Chunks are only ever added,
   * never replaced, so neither can go stale.
   */
  private chunkByNum = new Map<number, Chunk>();
  private lastCx = NaN; private lastCy = NaN; private lastChunk: Chunk | undefined;

  generateChunk(cx: number, cy: number): Chunk {
    const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
    for (let ly = 0; ly < CHUNK_SIZE; ly++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++)
        tiles[ly * CHUNK_SIZE + lx] = packTile(this.sampler(x0 + lx, y0 + ly), false, 0, 0);
    return { cx, cy, tiles, parcel: new Int32Array(CHUNK_SIZE * CHUNK_SIZE), aux: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE), sub: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE), under: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE), modified: false };
  }

  /** Tile value, generating the chunk if needed. */
  getTile(x: number, y: number): number {
    return this.getChunk(chunkOf(x), chunkOf(y))!.tiles[localIndex(x, y)];
  }
  /** Tile value without generating; undefined if the chunk does not exist yet. */
  peekTile(x: number, y: number): number | undefined {
    const c = this.getChunk(chunkOf(x), chunkOf(y), false);
    return c ? c.tiles[localIndex(x, y)] : undefined;
  }
  /**
   * Write a tile word. `sub` sets the tile's sub byte (kind id, docs/sub-kinds.md) in the same write; without it the
   * byte is kept while the family code stays the same and cleared when the code changes, the tile is cleared or paved.
   */
  setTile(x: number, y: number, packed: number, sub?: number) {
    const c = this.getChunk(chunkOf(x), chunkOf(y))!;
    const i = localIndex(x, y);
    const subChanged = sub !== undefined && c.sub[i] !== sub;
    if (subChanged) this.setSub(x, y, sub);
    if (c.tiles[i] === packed) { if (subChanged && !c.aux[i]) this.syncBuilding(x, y, packed); return; }
    if (c.aux[i] && isStructureAux(c.aux[i]) && this.structureWrite(x, y, packed)) return;
    if (c.aux[i] && isJunctionAux(c.aux[i]) && !isRoad(packed)) this.removeJunction(x, y); // a ring or flyover tile dug up: the junction goes back to a crossroads
    if (c.aux[i] && isBridgeAux(c.aux[i]) && !isRoad(packed)) this.setAux(x, y, 0); // a bridge deck tile taken away: open water again
    if (c.tiles[i] === packed) return;
    if (c.sub[i] && sub === undefined && (zoneOf(packed) !== zoneOf(c.tiles[i]) || isRoad(packed))) this.setSub(x, y, 0);
    if (isRoad(c.tiles[i]) !== isRoad(packed)) this.noteJobEdit(x, y);
    c.tiles[i] = packed;
    c.modified = true;
    this.dirtyTiles.set(tileKey(x, y), [x, y]);
    this.syncBuilding(x, y, packed);
    this.onTileChanged?.(x, y);
  }
  /** Aux byte at a tile; 0 where the chunk does not exist yet. */
  auxAt(x: number, y: number): number {
    const c = this.getChunk(chunkOf(x), chunkOf(y), false);
    return c ? c.aux[localIndex(x, y)] : 0;
  }
  setAux(x: number, y: number, v: number) {
    const c = this.getChunk(chunkOf(x), chunkOf(y))!;
    const i = localIndex(x, y);
    if (c.aux[i] === v) return;
    c.aux[i] = v;
    this.noteJobEdit(x, y); // junctions and structures change which way a road search may go
    c.modified = true;
    this.dirtyAux.set(tileKey(x, y), [x, y]);
  }
  /** Sub byte at a tile (kind id of a sub-kind, 0 = the family's base kind); 0 where the chunk does not exist yet. */
  subAt(x: number, y: number): number {
    const c = this.getChunk(chunkOf(x), chunkOf(y), false);
    return c ? c.sub[localIndex(x, y)] : 0;
  }
  /** Set a sub byte without touching the tile word (setTile's `sub` argument is the usual way in). */
  setSub(x: number, y: number, v: number) {
    const c = this.getChunk(chunkOf(x), chunkOf(y))!;
    const i = localIndex(x, y);
    if (c.sub[i] === v) return;
    c.sub[i] = v;
    c.modified = true;
    this.dirtySub.set(tileKey(x, y), [x, y]);
  }
  /** Under byte at a tile (tunnel or platform, shared/src/metro.ts); 0 (solid ground) where the chunk does not exist yet. */
  underAt(x: number, y: number): number {
    const c = this.getChunk(chunkOf(x), chunkOf(y), false);
    return c ? c.under[localIndex(x, y)] : 0;
  }
  /** Set an under byte. The surface never reads the layer, so no road search or building is touched. */
  setUnder(x: number, y: number, v: number) {
    const c = this.getChunk(chunkOf(x), chunkOf(y))!;
    const i = localIndex(x, y);
    if (c.under[i] === v) return;
    c.under[i] = v;
    c.modified = true;
    this.underVersion++;
    this.dirtyUnder.set(tileKey(x, y), [x, y]);
  }
  /** A stop's name: the one given to the station at (x, y) (stopNames), else the generated stopName. */
  stopLabel(x: number, y: number): string { return this.stopNames.get(tileKey(x, y)) ?? stopName(x, y); }
  /** Name the stop at (x, y); null or an empty name goes back to the generated one. */
  setStopName(x: number, y: number, name: string | null) {
    if (name) this.stopNames.set(tileKey(x, y), name); else this.stopNames.delete(tileKey(x, y));
  }
  /** The catalogue kind id standing on a tile (0 for nothing), from its family code and sub byte. */
  kindIdAt(x: number, y: number): number {
    const c = this.getChunk(chunkOf(x), chunkOf(y), false);
    if (!c) return 0;
    const i = localIndex(x, y);
    return isRoad(c.tiles[i]) ? 0 : kindIdOf(zoneOf(c.tiles[i]), c.sub[i]);
  }

  // ---- multi-tile structures (shared/src/structures.ts, docs/aux-layer.md) ----------

  private auxFn = (x: number, y: number) => this.auxAt(x, y);
  private tileFn = (x: number, y: number) => this.peekTile(x, y);
  private subFn = (x: number, y: number) => this.subAt(x, y);
  /** The structure covering (x, y), or null for an ordinary tile. */
  structureAt(x: number, y: number): Placed | null { return structureAt(x, y, this.auxFn, this.tileFn, this.subFn); }
  /** The tile the simulation knows a building by: the door of a structure, else the tile itself. */
  doorOf(x: number, y: number): [number, number] {
    const s = this.auxAt(x, y) ? this.structureAt(x, y) : null;
    return s ? [s.doorX, s.doorY] : [x, y];
  }
  /** Write a tile without touching the building index (structure tiles other than the door). */
  private rawTile(x: number, y: number, packed: number) {
    const c = this.getChunk(chunkOf(x), chunkOf(y))!;
    const i = localIndex(x, y);
    if (c.tiles[i] === packed) return;
    if (isRoad(c.tiles[i]) !== isRoad(packed)) this.noteJobEdit(x, y);
    c.tiles[i] = packed;
    c.modified = true;
    this.dirtyTiles.set(tileKey(x, y), [x, y]);
    this.onTileChanged?.(x, y);
  }
  /** Drop whatever the index holds for a tile that is becoming a structure part. */
  private dropBuilding(x: number, y: number) {
    const key = tileKey(x, y);
    this.sites.delete(key);
    const b = this.buildings.get(key);
    if (b) { this.evict(b, 0); this.reindex(b, true); this.buildings.delete(key); }
  }
  /**
   * Put a structure on the map (placement already checked): aux bytes, the family code and sub byte (kind id) on
   * every tile, one Building and one Site at the door. With `built` it stands complete at once (seeding and tests)
   * instead of opening a site.
   */
  placeStructure(p: Placed, opts: { work: number; priority: number; built?: boolean; target?: number; merge?: boolean }): Site | undefined {
    const code = familyOf(p.kind), sub = subFor(p.kind);
    eachTile(p, (x, y, a) => {
      this.dropBuilding(x, y);
      this.setAux(x, y, a);
      this.setSub(x, y, sub);
      this.rawTile(x, y, packTile(terrainOf(this.getTile(x, y)), false, code, 0));
    });
    // the door write goes through structureWrite: the Building appears there and the word is mirrored
    if (opts.built) { this.setTile(p.doorX, p.doorY, withLevel(this.getTile(p.doorX, p.doorY), opts.target ?? 1)); return undefined; }
    const site = this.createSite(p.doorX, p.doorY, p.kind, opts.target ?? 1, opts.work, opts.priority);
    if (site && opts.merge) site.merge = true;
    return site;
  }
  /**
   * Write a roundabout or flyover (shared/src/junctions.ts; placement already checked): `tiles` is the plan's flat
   * [x, y, aux, road]. Roads go down first (an empty lot is paved over, the junction tile under an island cleared),
   * then the aux bytes.
   */
  placeJunction(tiles: number[]) {
    for (let i = 0; i < tiles.length; i += 4) {
      const x = tiles[i], y = tiles[i + 1], road = tiles[i + 3] === 1, t = this.getTile(x, y);
      if (isRoad(t) !== road || (!road && zoneOf(t) !== Zone.None)) this.setTile(x, y, packTile(terrainOf(t), road, 0, 0));
    }
    for (let i = 0; i < tiles.length; i += 4) { this.setAux(tiles[i], tiles[i + 1], tiles[i + 2]); this.onTileChanged?.(tiles[i], tiles[i + 1]); }
  }
  /** Lay a bridge's deck (shared/src/bridges.ts planBridge, already checked): `tiles` is the plan's flat [x, y, aux]. */
  placeBridge(tiles: number[]) {
    for (let i = 0; i < tiles.length; i += 3) {
      const x = tiles[i], y = tiles[i + 1];
      this.setAux(x, y, tiles[i + 2]);
      this.setTile(x, y, packTile(Terrain.Water, true, 0, 0));
    }
  }
  /** Take away the whole bridge one of whose deck tiles is (x, y): every deck tile of the span is open water again. */
  removeBridge(x: number, y: number) {
    const s = bridgeSpanAt(x, y, (tx, ty) => this.auxAt(tx, ty));
    if (!s) return;
    for (let i = 0; i < s.len; i++) this.setTile(s.x0 + s.dx * i, s.y0 + s.dy * i, packTile(Terrain.Water, false, 0, 0));
  }
  /**
   * Take away the roundabout or flyover at (x, y), any of its tiles: a flyover tile is a plain crossroads again; a
   * roundabout goes back to the crossroads it was, the island road again and the corners bare ground.
   */
  removeJunction(x: number, y: number) {
    const a = this.auxAt(x, y);
    if (isFlyoverAux(a)) { this.setAux(x, y, 0); this.onTileChanged?.(x, y); return; }
    if (!isRingAux(a) && !isIslandAux(a)) return;
    const [ix, iy] = isIslandAux(a) ? [x, y] : islandOf(x, y, a);
    const ring: [number, number, boolean][] = [];
    for (let p = 0; p < 8; p++) {
      const rx = ix + RING_POS[p][0], ry = iy + RING_POS[p][1], r = this.auxAt(rx, ry);
      if (isRingAux(r) && islandOf(rx, ry, r)[0] === ix && islandOf(rx, ry, r)[1] === iy) { this.setAux(rx, ry, 0); ring.push([rx, ry, isArmPos(p)]); }
    }
    if (isIslandAux(this.auxAt(ix, iy))) this.setAux(ix, iy, 0);
    for (const [rx, ry, arm] of ring) {
      const t = this.getTile(rx, ry);
      if (!arm && isRoad(t)) this.setTile(rx, ry, packTile(terrainOf(t), false, 0, 0));
      this.onTileChanged?.(rx, ry);
    }
    const t = this.getTile(ix, iy);
    if (!isRoad(t)) this.setTile(ix, iy, packTile(terrainOf(t), true, 0, 0));
    this.onTileChanged?.(ix, iy);
  }
  /**
   * Clear every tile of a structure back to bare ground (bulldozing any of its tiles lands here). A merged zone
   * building (zones.ts) breaks back into empty lots of its zone instead, so the land stays zoned.
   */
  removeStructure(p: Placed) {
    const lots = isGrowableId(p.kind) ? familyOf(p.kind) : 0;
    eachTile(p, (x, y) => { this.setAux(x, y, 0); this.setSub(x, y, 0); });
    eachTile(p, (x, y) => this.setTile(x, y, packTile(terrainOf(this.getTile(x, y)), false, lots, 0)));
    if (lots) this.mergeStats.brokenUp++;
  }

  /**
   * Merge zoned lots into bigger buildings (zones.ts; the growth step in sim/simulation.ts plans them). For each plan
   * every building under the footprint (1×1 lots and smaller merged structures, all of one zone and owner) hands its
   * residents or staff to the new structure's door, the structure is written (aux, sub byte and family code on every
   * tile) and one site opens at the door for the whole footprint. The site holds everyone on until it completes
   * (syncBuilding), so nobody loses their home or job to a merge; completeSite counts anyone the finished building
   * cannot take. One pass over the citizens serves every plan.
   */
  mergeLots(plans: MergePlan[]) {
    if (!plans.length) return;
    const to = new Map<number, MergePlan>();          // tkey of an absorbed building's door -> its plan
    const park = new Map<string, string>();           // tileKey of an absorbed building -> tileKey of the new door
    for (const m of plans) {
      const p = m.placed, doorKey = tileKey(p.doorX, p.doorY);
      eachTile(p, (x, y) => {
        const [dx, dy] = this.auxAt(x, y) ? this.doorOf(x, y) : [x, y];
        const key = tileKey(dx, dy), b = this.buildings.get(key);
        if (!b || to.has(tkey(dx, dy))) return;
        to.set(tkey(dx, dy), m);
        if (key !== doorKey) park.set(key, doorKey);
        b.occupants = 0; b.qualified = 0; // re-counted at the door below; dropping the building must not evict anyone
        this.mergeStats.absorbed++;
      });
      this.mergeStats.opened++;
    }
    for (const [from, door] of park) {
      const n = this.parking.get(from);
      if (n) { this.parking.set(door, (this.parking.get(door) ?? 0) + n); this.parking.delete(from); }
    }
    for (const m of plans) this.placeStructure(m.placed, { work: m.work, priority: 0, target: m.target, merge: true });
    const doorOf = (m: MergePlan) => this.buildings.get(tileKey(m.placed.doorX, m.placed.doorY));
    for (const c of this.citizens.values()) {
      const home = to.get(tkey(c.hx, c.hy));
      if (home) {
        const b = doorOf(home);
        if (b) {
          if (c.state === CitizenState.Home) { c.x = home.placed.doorX + 0.5; c.y = home.placed.doorY + 0.5; }
          c.hx = home.placed.doorX; c.hy = home.placed.doorY; c.commute = null;
          b.occupants++; this.mergeStats.residents++;
        }
      }
      if (c.job) {
        const job = to.get(tkey(c.wx, c.wy));
        const b = job && doorOf(job);
        if (job && b) {
          if (c.state === CitizenState.Work) { c.x = job.placed.doorX + 0.5; c.y = job.placed.doorY + 0.5; }
          c.wx = job.placed.doorX; c.wy = job.placed.doorY; c.kind = job.placed.kind; c.commute = null;
          b.occupants++; this.mergeStats.workers++;
          if (c.skill) b.qualified = (b.qualified ?? 0) + 1;
        }
      }
      if (c.parkedAt && !c.parkKerb) { const d = park.get(c.parkedAt); if (d) c.parkedAt = d; }
    }
    for (const v of this.vehicles.values()) if (v.parkedAt && !v.parkKerb) { const d = park.get(v.parkedAt); if (d) v.parkedAt = d; }
  }
  /**
   * setTile on a structure tile. Clearing or paving any tile removes the whole structure (returns false so the
   * caller then writes its own value on the now-plain tile). A write to the door goes through the building index
   * and is mirrored to every other tile, so all of them show the same kind, level and construction state; writes
   * to other tiles never reach the index. Returns true when the write was handled here.
   */
  private structureWrite(x: number, y: number, packed: number): boolean {
    const s = this.structureAt(x, y);
    if (!s) { this.setAux(x, y, 0); return false; } // stray byte: forget it
    if (zoneOf(packed) === Zone.None || isRoad(packed)) {
      this.removeStructure(s);
      // a merged zone building breaks back into empty lots; bulldozing leaves this tile a lot too, paving it does not
      return isGrowableId(s.kind) && !isRoad(packed);
    }
    if (x !== s.doorX || y !== s.doorY) { this.rawTile(x, y, packed); return true; }
    const c = this.getChunk(chunkOf(x), chunkOf(y))!;
    c.tiles[localIndex(x, y)] = packed;
    c.modified = true;
    this.dirtyTiles.set(tileKey(x, y), [x, y]);
    this.syncBuilding(x, y, packed);
    this.onTileChanged?.(x, y);
    const word = packed & ~7; // everything but terrain and the road bit
    eachTile(s, (tx, ty) => { if (tx !== x || ty !== y) this.rawTile(tx, ty, (this.getTile(tx, ty) & 3) | word); });
    return true;
  }

  parcelIdAt(x: number, y: number): number {
    const c = this.getChunk(chunkOf(x), chunkOf(y), false);
    return c ? c.parcel[localIndex(x, y)] : 0;
  }
  setParcelId(x: number, y: number, id: number) {
    const c = this.getChunk(chunkOf(x), chunkOf(y))!;
    c.parcel[localIndex(x, y)] = id;
    c.modified = true;
    this.dirtyTiles.set(tileKey(x, y), [x, y]);
  }
  parcelAt(x: number, y: number): Parcel | undefined {
    const id = this.parcelIdAt(x, y);
    return id ? this.parcels.get(id) : undefined;
  }
  /** A road beside the lot. A bridge deck (road on water, shared/src/bridges.ts) is nobody's road access: it is entered only at its ends. */
  hasRoadAccess(x: number, y: number): boolean {
    for (const [dx, dy] of DIRS) {
      const t = this.peekTile(x + dx, y + dy);
      if (t !== undefined && isRoad(t) && (t & 3) !== Terrain.Water) return true;
    }
    return false;
  }

  // ---- buildings index ------------------------------------------------

  /** Keep the building index in step with a tile change; evicts if capacity shrank, cancels stale sites. */
  syncBuilding(x: number, y: number, packed: number) {
    const key = tileKey(x, y);
    const z = zoneOf(packed), l = levelOf(packed), id = kindIdOf(z, this.subAt(x, y));
    const site = this.sites.get(key);
    if (site && (isRoad(packed) || id !== site.kind || !underConstruction(packed))) this.sites.delete(key);
    const existing = this.buildings.get(key);
    if (hasJobs(z) || (existing && hasJobs(existing.zone))) this.noteJobEdit(x, y);
    if (z === Zone.None || isRoad(packed)) {
      if (existing) { this.evict(existing, 0); this.reindex(existing, true); this.buildings.delete(key); this.mothballed.delete(key); }
      return;
    }
    if (!existing) {
      this.putBuilding({ x, y, zone: z, id, level: l, occupants: 0 });
      return;
    }
    if (existing.zone !== z || existing.id !== id) { this.evict(existing, 0); existing.zone = z; existing.id = id; this.mothballed.delete(key); }
    existing.level = l;
    const cap = capacityOf(id, l);
    // while merged lots are rebuilt (Site.merge) their people stay on at the door until the new building is up
    if (existing.occupants > cap && !this.sites.get(key)?.merge) this.evict(existing, cap);
    this.reindex(existing);
  }
  /** Add a building to the map and the built-building index (used by syncBuilding and when loading a world). */
  putBuilding(b: Building) {
    this.buildings.set(tileKey(b.x, b.y), b);
    this.reindex(b);
  }

  // Built buildings (level > 0) by zone: a flat list per zone for staggered sweeps, and a grid of CELL×CELL
  // cells per zone (plus one for every zone) so "candidates near (x, y)" is a few map lookups.
  private built: Building[][] = Array.from({ length: KIND_COUNT }, () => []);
  private builtAt = new Map<Building, { zone: number; i: number }>();
  private cells: Map<number, Set<Building>>[] = Array.from({ length: KIND_COUNT + 1 }, () => new Map());
  private cellBox = { x0: 0, y0: 0, x1: -1, y1: -1 };

  /** Built buildings (level > 0) of one zone, in no particular order. Do not mutate. */
  builtOf(zone: number): readonly Building[] { return this.built[zone] ?? []; }

  private reindex(b: Building, gone = false) {
    const cur = this.builtAt.get(b);
    const want = !gone && b.level > 0 && b.zone > Zone.None && b.zone < KIND_COUNT;
    if (cur && want && cur.zone === b.zone) return;
    const k = cellKey(cellOf(b.x), cellOf(b.y));
    if (cur) {
      const list = this.built[cur.zone];
      const last = list.pop()!;
      if (last !== b) { list[cur.i] = last; this.builtAt.get(last)!.i = cur.i; }
      this.builtAt.delete(b);
      for (const m of [this.cells[cur.zone], this.cells[KIND_COUNT]]) {
        const set = m.get(k);
        if (set) { set.delete(b); if (!set.size) m.delete(k); }
      }
    }
    if (!want) return;
    const list = this.built[b.zone];
    this.builtAt.set(b, { zone: b.zone, i: list.length });
    list.push(b);
    for (const m of [this.cells[b.zone], this.cells[KIND_COUNT]]) {
      let set = m.get(k);
      if (!set) m.set(k, (set = new Set()));
      set.add(b);
    }
    const cx = cellOf(b.x), cy = cellOf(b.y), box = this.cellBox;
    if (box.x1 < box.x0) { box.x0 = box.x1 = cx; box.y0 = box.y1 = cy; }
    else { box.x0 = Math.min(box.x0, cx); box.x1 = Math.max(box.x1, cx); box.y0 = Math.min(box.y0, cy); box.y1 = Math.max(box.y1, cy); }
  }

  /**
   * Visit built buildings (level > 0) of the given zones (every zone when null) within Manhattan distance
   * `maxDist` of (x, y), cell ring by cell ring outwards. `cutoff()`, checked before each ring, is the distance
   * beyond which the caller no longer cares, so a nearest-ish search stops after a handful of lookups.
   */
  eachBuiltNear(x: number, y: number, zones: readonly number[] | null, maxDist: number,
    visit: (b: Building, d: number) => void, cutoff?: () => number) {
    const box = this.cellBox;
    if (box.x1 < box.x0) return;
    const ccx = cellOf(x), ccy = cellOf(y), lx = x - ccx * CELL, ly = y - ccy * CELL;
    const maps = zones ? zones.map((z) => this.cells[z]) : [this.cells[KIND_COUNT]];
    const kMax = Math.max(ccx - box.x0, box.x1 - ccx, ccy - box.y0, box.y1 - ccy);
    const visitCell = (cx: number, cy: number) => {
      if (cx < box.x0 || cx > box.x1 || cy < box.y0 || cy > box.y1) return;
      const k = cellKey(cx, cy);
      for (const m of maps) {
        const set = m.get(k);
        if (!set) continue;
        for (const b of set) {
          const d = Math.abs(b.x - x) + Math.abs(b.y - y);
          if (d <= maxDist) visit(b, d);
        }
      }
    };
    for (let k = 0; k <= kMax; k++) {
      if (k > 0) {
        // nearest tile any ring-k cell can hold
        const ringMin = Math.min(k * CELL - lx, lx + 1 + (k - 1) * CELL, k * CELL - ly, ly + 1 + (k - 1) * CELL);
        if (ringMin > maxDist || (cutoff && ringMin > cutoff())) return;
      }
      if (k === 0) { visitCell(ccx, ccy); continue; }
      for (let i = -k; i <= k; i++) { visitCell(ccx + i, ccy - k); visitCell(ccx + i, ccy + k); }
      for (let i = -k + 1; i <= k - 1; i++) { visitCell(ccx - k, ccy + i); visitCell(ccx + k, ccy + i); }
    }
  }

  /**
   * The built building with the highest `score(b, d)` (null = not a candidate) within `maxDist`, where no score
   * exceeds `maxScore - d` (scores are "worth minus distance"), so rings too far away to win are never read.
   * `accept` is checked only for a would-be new best (e.g. road access), so it can afford a few tile reads.
   */
  bestBuiltNear(x: number, y: number, zones: readonly number[] | null, maxDist: number, maxScore: number,
    score: (b: Building, d: number) => number | null, accept?: (b: Building) => boolean): Building | null {
    let best: Building | null = null, bestT = -Infinity;
    this.eachBuiltNear(x, y, zones, maxDist, (b, d) => {
      const t = score(b, d);
      if (t === null || t <= bestT) return;
      if (accept && !accept(b)) return;
      best = b; bestT = t;
    }, () => maxScore - bestT);
    return best;
  }

  // Edits that could give a job search a different answer (Simulation.findJob caches searches that found nothing):
  // a workplace built, changed or upgraded, a road laid or dug up, a junction or structure byte, a chunk generated.
  // Jobs freed by people leaving are not counted here; the cache re-checks the full workplaces it saw instead.
  /** Count of such edits so far; a search remembers the count it ran at. */
  jobEdits = 0;
  /** The count at the last such edit in each CELL×CELL cell. */
  private jobEditAt = new Map<number, number>();
  private noteJobEdit(x: number, y: number) { this.jobEditAt.set(cellKey(cellOf(x), cellOf(y)), ++this.jobEdits); }
  /** Whether any such edit has touched a cell over tiles (x0, y0)..(x1, y1) since the count was `since`. */
  jobEditedSince(x0: number, y0: number, x1: number, y1: number, since: number): boolean {
    if (this.jobEdits === since) return false;
    for (let cy = cellOf(y0); cy <= cellOf(y1); cy++) {
      for (let cx = cellOf(x0); cx <= cellOf(x1); cx++) if ((this.jobEditAt.get(cellKey(cx, cy)) ?? 0) > since) return true;
    }
    return false;
  }

  /** Remove occupants from a building until only `keep` remain. */
  evict(b: Building, keep: number) {
    let n = b.occupants - keep;
    if (n <= 0) return;
    for (const c of this.citizens.values()) {
      if (n <= 0) break;
      if (b.zone === Zone.Residential) {
        if (c.hx === b.x && c.hy === b.y) { this.removeCitizen(c); n--; }
      } else if (c.job && c.wx === b.x && c.wy === b.y) { this.quitJob(c); n--; }
    }
  }
  /** called before a citizen is dropped so the simulation can free its lane and parking slot */
  onCitizenRemoved: ((c: Citizen) => void) | null = null;
  /** true while a test city or demo fast-fills (testcities.ts fillCity): newcomers move straight in, not through gateways */
  filling = false;
  /** Put a citizen in the world and in their household (the caller has counted them into their home). */
  addCitizen(c: Citizen) {
    this.citizens.set(c.id, c);
    this.joinHousehold(c);
  }
  removeCitizen(c: Citizen) {
    if (!this.citizens.delete(c.id)) return;
    this.leaveHousehold(c);
    this.onCitizenRemoved?.(c);
    const home = this.buildings.get(tileKey(c.hx, c.hy));
    if (home) this.bedIn(home, -1);
    this.quitJob(c);
  }
  /** Count n residents into (or, negative, out of) home b: a home's occupants, or the lodgers of a hall of residence. */
  bedIn(b: Building, n: number) {
    if (b.zone === Zone.Residential) b.occupants += n;
    else b.lodgers = Math.max(0, (b.lodgers ?? 0) + n);
  }
  /** Move a citizen into another household (they must already live in its home, or be moving there). */
  setHousehold(c: Citizen, hh: number) {
    if (c.hh === hh) return;
    this.leaveHousehold(c);
    c.hh = hh;
    this.joinHousehold(c);
  }
  private joinHousehold(c: Citizen) {
    let h = this.households.get(c.hh);
    if (!h) { h = { id: c.hh, sn: c.sn, ids: [] }; this.households.set(c.hh, h); }
    if (c.id === c.hh) h.sn = c.sn; // the founder names the household
    h.ids.push(c.id);
  }
  private leaveHousehold(c: Citizen) {
    const h = this.households.get(c.hh);
    if (!h) return;
    const i = h.ids.indexOf(c.id);
    if (i >= 0) { h.ids[i] = h.ids[h.ids.length - 1]; h.ids.pop(); }
    if (!h.ids.length) this.households.delete(c.hh);
  }
  quitJob(c: Citizen) {
    this.leaveSite(c);
    if (!c.job) return;
    const wb = this.buildings.get(tileKey(c.wx, c.wy));
    if (wb) { wb.occupants--; if (c.skill && wb.qualified) wb.qualified--; }
    c.skill = 0;
    c.job = false;
    c.commute = null;
    c.kind = 0;
  }

  // ---- construction ---------------------------------------------------

  /** Flag a tile as under construction for kind id `kind` and queue the work; no-op if a site already exists there. */
  createSite(x: number, y: number, kind: number, target: number, work: number, priority = 0): Site | undefined {
    const key = tileKey(x, y);
    if (this.sites.has(key)) return undefined;
    const t = this.getTile(x, y);
    this.setTile(x, y, withPriority(withConstruction(withZone(t, familyOf(kind)), true), priority), subFor(kind));
    const site: Site = { x, y, kind, target, work, total: work, assigned: 0, priority, created: this.tick };
    this.sites.set(key, site);
    return site;
  }
  setPriority(site: Site, priority: number) {
    site.priority = Math.max(-2, Math.min(2, Math.round(priority)));
    this.setTile(site.x, site.y, withPriority(this.getTile(site.x, site.y), site.priority));
  }
  completeSite(site: Site) {
    const key = tileKey(site.x, site.y);
    this.sites.delete(key);
    const b = this.buildings.get(key), before = b?.occupants ?? 0;
    const t = this.getTile(site.x, site.y);
    this.setTile(site.x, site.y, withProgress(withPriority(withConstruction(withLevel(t, site.target), false), 0), 0));
    if (site.merge) { this.mergeStats.completed++; this.mergeStats.evicted += Math.max(0, before - (this.buildings.get(key)?.occupants ?? 0)); }
    this.onSiteCompleted?.(site);
  }
  leaveSite(c: Citizen) {
    if (!c.site) return;
    const s = this.sites.get(c.site);
    if (s && s.assigned > 0) s.assigned--;
    c.site = null;
  }

  // ---- players & parcels ---------------------------------------------

  getOrCreatePlayer(id: string, name: string, startMoney: number): Player {
    let p = this.players.get(id);
    if (!p) {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
      p = { id, name, color: PALETTE[Math.abs(h) % PALETTE.length], money: startMoney, tech: [], progress: emptyProgress() };
      this.players.set(id, p);
      this.playersDirty = true;
    }
    return p;
  }
  /** `ledger`: include the day's money ledger (net.ts sends it once a game hour, not with every money change) */
  playerDTO(p: Player, online: boolean, ledger = false): PlayerDTO {
    return {
      id: p.id, name: p.name, color: p.color, money: Math.round(p.money * 100) / 100, online, tech: [...p.tech], policies: [...(p.policies ?? [])], progress: { ...p.progress }, devUnlimited: p.devUnlimited || undefined,
      ledger: ledger ? this.ledgerDTO(p) : undefined, fin: this.financeDTO?.(p),
    };
  }
  /** The player's ledger rolled forward to today, amounts to the cent. */
  ledgerDTO(p: Player): LedgerDTO {
    const L = this.ledgerOf(p);
    const round = (r: LedgerDTO['today']) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v! * 100) / 100]));
    return { day: L.day, today: round(L.today), yesterday: round(L.yesterday) };
  }
  private ledgerOf(p: Player): LedgerDTO {
    const L = (p.ledger ??= { day: this.day, today: {}, yesterday: {} });
    if (L.day !== this.day) { L.yesterday = L.day === this.day - 1 ? L.today : {}; L.today = {}; L.day = this.day; }
    return L;
  }
  /** Whether the owner of the parcel at a tile has an education policy on (unclaimed land: no). */
  ownerHasPolicy(x: number, y: number, id: PolicyId): boolean {
    const parcel = this.parcelAt(x, y);
    return hasPolicy(this.players.get(parcel?.owner ?? '')?.policies, id);
  }
  /** Raise a player's progress counter (peak-style counters pass the current value). */
  bump(playerId: string | undefined, counter: Counter, amount: number, peak = false) {
    if (!playerId) return;
    const p = this.players.get(playerId);
    if (!p) return;
    const v = peak ? Math.max(p.progress[counter], amount) : p.progress[counter] + amount;
    if (v !== p.progress[counter]) { p.progress[counter] = v; this.playersDirty = true; }
  }
  /** Whether the owner of the parcel at a tile has a feature (unclaimed land: no). */
  ownerHas(x: number, y: number, feature: string, has: (tech: readonly string[], f: string) => boolean): boolean {
    const parcel = this.parcelAt(x, y);
    const p = parcel ? this.players.get(parcel.owner) : undefined;
    return !!p && has(p.tech, feature);
  }
  /** Fresh mover defaults with a personal driving style seeded from the id. */
  moverDefaults(id: number): Pick<Mover, 'lane' | 'prog' | 'wait' | 'stuck' | 'speedMul' | 'gapMul' | 'cls' | 'len' | 'inDir' | 'committed' | 'priority' | 'rerouted' | 'pts' | 'pp' | 'cross' | 'node' | 'xdir' | 'trail'> {
    return { lane: -1, prog: 0, wait: 0, stuck: 0, speedMul: 0.88 + 0.24 * hash2(id, 5), gapMul: 0.85 + 0.45 * hash2(id, 6), cls: 0, len: 0.34, inDir: 0, committed: false, priority: false, rerouted: 0, pts: null, pp: 0, cross: null, node: null, xdir: null, trail: [] };
  }
  /** Car ownership is decided once per citizen, more likely for office workers (the office family; `kind` is a kind id). */
  ownsCar(id: number, kind: number) { return hash2(id, 41) < (familyOf(kind) === Zone.Office ? CAR_OWNERSHIP_OFFICE : CAR_OWNERSHIP); }
  parcelDTO(p: Parcel): ParcelDTO {
    return {
      id: p.id, owner: p.owner, name: p.name, x: p.x, y: p.y, w: p.w, h: p.h, taxRate: p.taxRate, stats: { ...p.stats, jobsByKind: [...p.stats.jobsByKind], staffedByKind: [...p.stats.staffedByKind] },
      ...(p.group !== undefined ? { group: p.group } : {}), ...(p.color !== undefined ? { color: p.color } : {}),
    };
  }

  // ---- parcel management (docs/world-map.md section 2; rules in shared/src/parcelops.ts) --------------------

  /** The parcels of an estate (empty for undefined). */
  estateOf(group: number | undefined): Parcel[] {
    return group === undefined ? [] : [...this.parcels.values()].filter((p) => p.group === group);
  }
  /**
   * Combine parcels (and the estates they are in): rectangles merge, whatever is left becomes one estate taking the
   * lowest id's name, colour and tax rate. Returns the reason on refusal, else what happened.
   */
  combineParcels(ids: readonly number[], mayEdit: (owner: string) => boolean): string | { merged: number; estate: number } {
    const plan = planCombine(ids, (id) => this.parcels.get(id), this.parcels.values(), mayEdit);
    if (!plan.ok) return plan.reason;
    const lead = this.parcels.get(Math.min(...plan.parcels))!;
    for (const [keep, gone] of plan.merges) {
      const k = this.parcels.get(keep)!, g = this.parcels.get(gone)!;
      for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) this.setParcelId(x, y, keep);
      const x0 = Math.min(k.x, g.x), y0 = Math.min(k.y, g.y); // the two make a rectangle: their bounding box
      Object.assign(k, { x: x0, y: y0, w: Math.max(k.x + k.w, g.x + g.w) - x0, h: Math.max(k.y + k.h, g.y + g.h) - y0 });
      k.stats.taxToday += g.stats.taxToday; k.stats.taxYesterday += g.stats.taxYesterday;
      this.parcels.delete(gone);
      this.removedParcels.add(gone); this.dirtyParcels.delete(gone);
    }
    // the rectangles' final extents (a parcel merged into twice is already up to date)
    for (const [id, r] of plan.rect) { const q = this.parcels.get(id); if (q) Object.assign(q, r); }
    const group = plan.estate.length > 1 ? this.nextId++ : undefined;
    for (const id of plan.rect.keys()) {
      const q = this.parcels.get(id)!;
      q.group = group;
      if (group === undefined) delete q.group;
      if (q !== lead) { q.name = lead.name; q.taxRate = lead.taxRate; if (lead.color === undefined) delete q.color; else q.color = lead.color; }
      this.recountRoads(id);
      this.dirtyParcels.add(id);
    }
    return { merged: plan.merges.length, estate: plan.estate.length };
  }
  /** Split a parcel along x = at or y = at; the new part leaves any estate. Returns the reason on refusal, else the new parcel. */
  splitParcel(id: number, axis: 'x' | 'y', at: number, mayEdit: (owner: string) => boolean): string | Parcel {
    const p = this.parcels.get(id);
    if (!p || !mayEdit(p.owner)) return 'Not your parcel';
    const plan = planSplit(p, axis, at, {
      isWater: (x, y) => !isBuildable(this.getTile(x, y)),
      doorOf: (x, y) => this.doorOf(x, y),
      nameAt: (x, y) => { const k = this.kindIdAt(x, y); return k ? `the ${KIND_NAMES[k]}` : 'a building'; },
    });
    if (!plan.ok) return plan.reason;
    const name = `${p.name.replace(/ \((east|south)\)$/, '')} (${plan.side})`.slice(0, 24);
    const q: Parcel = { id: this.nextId++, owner: p.owner, name, ...plan.part, taxRate: p.taxRate, stats: emptyStats(), ...(p.color !== undefined ? { color: p.color } : {}) };
    Object.assign(p, plan.keep);
    this.parcels.set(q.id, q);
    for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) this.setParcelId(x, y, q.id);
    this.recountRoads(p.id); this.recountRoads(q.id);
    this.dirtyParcels.add(p.id); this.dirtyParcels.add(q.id);
    return q;
  }
  /** Take a parcel out of its estate; an estate left with one member is dissolved. */
  leaveEstate(id: number, mayEdit: (owner: string) => boolean): string | null {
    const p = this.parcels.get(id);
    if (!p || !mayEdit(p.owner)) return 'Not your parcel';
    if (p.group === undefined) return 'That parcel is not in an estate';
    const rest = this.estateOf(p.group).filter((q) => q !== p);
    delete p.group;
    this.dirtyParcels.add(p.id);
    if (rest.length === 1) { delete rest[0].group; this.dirtyParcels.add(rest[0].id); }
    return null;
  }
  recountRoads(id: number) {
    const parcel = this.parcels.get(id);
    if (!parcel) return;
    let n = 0;
    for (let yy = parcel.y; yy < parcel.y + parcel.h; yy++)
      for (let xx = parcel.x; xx < parcel.x + parcel.w; xx++) if (isRoad(this.getTile(xx, yy))) n++;
    if (n !== parcel.stats.roads) { parcel.stats.roads = n; this.dirtyParcels.add(id); }
  }
  /** Pay into (or, negative, take out of) a player's treasury; `cat` files it in the day's ledger (by default income is tax, spending upkeep). */
  credit(playerId: string, amount: number, cat: LedgerCat = amount >= 0 ? 'tax' : 'upkeep') {
    const p = this.players.get(playerId);
    if (!p) return;
    p.money += amount;
    const day = this.ledgerOf(p).today;
    day[cat] = (day[cat] ?? 0) + amount;
    if (p.devUnlimited && p.money < DEV_FUNDS) p.money = DEV_FUNDS; // dev testing: spending never dents the treasury
    this.playersDirty = true;
  }
  /** Move money from one player to another (no-op when they are the same). */
  transfer(from: string | undefined, to: string | undefined, amount: number, cat: LedgerCat = 'fees') {
    if (!from || !to || from === to || amount === 0) return;
    this.credit(from, -amount, cat);
    this.credit(to, amount, cat);
  }
  /** A public service's wage bill for one shift: the owner pays ECONOMY_TUNING.civicPayroll of it, a regional grant the rest
   *  (withdrawn in administration, sim/finance.ts: the owner pays it all). */
  payroll(owner: string, wage: number) { this.credit(owner, -wage * this.payrollShare(owner), 'wages'); }
  /** The share of public-service wages an owner pays from the treasury. */
  payrollShare(owner: string) { return this.players.get(owner)?.admin ? 1 : ECONOMY_TUNING.civicPayroll; }
  /** What a player may spend: the treasury plus the overdraft line (ECONOMY_TUNING.overdraftLimit). */
  spendable(p: Player) { return spendableMoney(p.money, p.devUnlimited); }
  /**
   * The refusal for spending past the overdraft line, naming the limit. It starts "Need $" (or "Not enough money" without a
   * cost): the client's broke hint keys on those words.
   */
  shortOf(p: Player, cost: number | null, what = '') {
    const $ = (n: number) => `$${Math.round(n).toLocaleString('en-GB')}`;
    const left = `with the ${$(ECONOMY_TUNING.overdraftLimit)} overdraft limit you can spend ${$(Math.max(0, Math.floor(this.spendable(p))))}`;
    return cost === null ? `Not enough money: ${left}` : `Need ${$(cost)}${what ? ' ' + what : ''}: ${left}`;
  }
  /** Mothball a service or yard (its staff are let go, sim/finance.ts) or reopen it (job searches that found nothing look again). */
  setMothballed(b: Building, on: boolean) {
    const key = tileKey(b.x, b.y);
    if (on) { this.mothballed.add(key); this.evict(b, 0); }
    else if (this.mothballed.delete(key)) this.noteJobEdit(b.x, b.y);
  }
}

export const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Side, in tiles, of the cells of the built-building grid (World.eachBuiltNear). */
export const CELL = 16;
const cellOf = (v: number) => Math.floor(v / CELL);
/** A zone with jobs in it: anything built but homes and car parks (Simulation.findJob). */
export const hasJobs = (z: number) => z !== Zone.None && z !== Zone.Residential && z !== Zone.Parking;
const cellKey = (cx: number, cy: number) => (cx + 0x8000) * 65536 + (cy + 0x8000);
/** A tile -> count map that remembers which chunks changed, so the traffic broadcast resends only those. */
export class CountMap<K> extends Map<K, number> {
  /** chunk keys whose counts changed since the last broadcast */
  dirty = new Set<string>();
  /** told of every count set (0 for a delete): Traffic keeps its router cost arrays' kerb flags with it */
  onSet: ((k: K, v: number) => void) | null = null;
  constructor(private chunkOfKey: (k: K) => string) { super(); }
  override set(k: K, v: number) { if (super.get(k) !== v) this.dirty.add(this.chunkOfKey(k)); this.onSet?.(k, v); return super.set(k, v); }
  override delete(k: K) { if (super.has(k)) this.dirty.add(this.chunkOfKey(k)); this.onSet?.(k, 0); return super.delete(k); }
}
/** Numeric tile key for hot maps (|x|,|y| < 32768). */
export const tkey = (x: number, y: number) => (x + 0x8000) * 65536 + (y + 0x8000);
/** (written with floor: `k % 65536` of a key past 2^31 is a float remainder, ~18 ns in Node 20 against ~1 ns) */
export const untkey = (k: number): [number, number] => [Math.floor(k / 65536) - 0x8000, k - Math.floor(k / 65536) * 65536 - 0x8000];
