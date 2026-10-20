import type { KindToolId } from './buildings/compiled';
import type { StopInfo, BusInfo, LineInfo, LineStats, LinePreview, TransitLine, TransitMode } from './transit';
import type { RailLineDef, RailRoute } from './rail';
import type { GatewayInfo } from './gateways';
import type { GoalsDTO } from './goals';
import type { RankDTO, RankUp, Milestone } from './ranks';
import type { RingsDTO } from './history';
import type { FleetInfo, MobileRows } from './fleet';
import type { BoatHarbour } from './boats';
import type { SeaGate } from './waterways';
import type { FireDTO } from './fires';
import type { AdTarget, AdsDTO } from './adverts';
import type { StoryDTO } from './news';
import type { UtilityInfo, UtilLinkDTO } from './utilities';
/** Build tools: roads, bulldozing, runways (shared/src/airport.ts), railway track (shared/src/rail.ts), roundabouts and flyovers (shared/src/junctions.ts) and one per catalogue kind that has a tool (buildings/*.ts). */
export type Tool = 'road' | 'bulldoze' | 'runway' | 'rail' | 'roundabout' | 'flyover' | 'pylons' | 'cable' | KindToolId;

export interface ParcelStats {
  population: number;
  jobs: number;
  employed: number;
  roads: number;
  taxToday: number;
  taxYesterday: number;
  /** job capacity and filled jobs per building kind (indexed by kind id; KIND_ID_COUNT long) */
  jobsByKind: number[];
  staffedByKind: number[];
  /** construction sites waiting for or receiving builders */
  sites: number;
  /** buildings standing (a structure counts once; a site on an empty lot is in `sites`); absent from older servers */
  buildings?: number;
  /** book value: what the land, roads and buildings cost to make (parcelops.ts buildingValue, docs/world-map.md); absent from older servers */
  value?: number;
  /** education (docs/education.md section 14; sim/schools.ts census, hourly; absent from older servers): pupils enrolled at the schools on this parcel, the day places those schools have */
  pupils?: number; places?: number;
  /** residents with a degree or more, and the education index (0-100, 20 x the mean level) of the `eduN` residents aged 25-64 who live here; 0 when eduN is 0 */
  grads?: number; eduIndex?: number; eduN?: number;
}
export interface ParcelDTO {
  id: number;
  owner: string;
  name: string;
  x: number; y: number; w: number; h: number;
  taxRate: number;
  stats: ParcelStats;
  /** the estate it belongs to (docs/world-map.md section 2): members share name, colour and tax rate */
  group?: number;
  /** a colour its owner gave it on the map (0xRRGGBB); absent: the owner's colour */
  color?: number;
}
export interface PlayerDTO {
  id: string;
  name: string;
  color: number;
  money: number;
  online: boolean;
  /** unlocked technology ids and the counters the tree's conditions read */
  tech: string[];
  progress: Record<string, number>;
  /** the education policies switched on (policies.ts); absent from older servers */
  policies?: string[];
  /** dev servers only */
  devUnlimited?: boolean;
  /** money in and out by game day (World.credit); sent at most once a game hour, absent in between (keep the last one) */
  ledger?: LedgerDTO;
  /** the overdraft and administration (server sim/finance.ts); present while the treasury is below zero, the player is in
   *  administration or has services mothballed, absent otherwise (and from older servers) */
  fin?: FinanceDTO;
}
/** What a treasury movement was for. Positive amounts are income, negative ones spending. */
export type LedgerCat = 'tax' | 'fees' | 'wages' | 'upkeep' | 'builders' | 'build' | 'land' | 'tech' | 'interest' | 'fire' | 'blast' | 'ads' | 'bills' | 'fuel' | 'other';
export const LEDGER_LABELS: Record<LedgerCat, string> = {
  tax: 'Taxes', fees: 'Fares and fees', wages: 'Staff wages', upkeep: 'Upkeep', builders: "Builders' fees",
  build: 'Construction', land: 'Land', tech: 'Technology', interest: 'Overdraft interest', fire: 'Fire damage', blast: 'Explosion damage', ads: 'Advertising',
  bills: 'Utility bills', fuel: 'Fuel and grid import', other: 'Other',
};
/**
 * Money that can run out (docs/start-from-zero.md B3): the overdraft line, the count of midnights below zero, and
 * administration with its recovery plan. The figures are the server's estimates, worked out at most once a game hour.
 */
export interface FinanceDTO {
  /** how far below zero spending may go (ECONOMY_TUNING.overdraftLimit on the server) */
  limit: number;
  /** midnights in a row the treasury was below zero; administration begins at `after` */
  days: number; after: number;
  /** interest a day on the balance now (a share of it, charged at midnight) */
  interest: number;
  /** the game day administration began; absent: not in administration */
  admin?: number;
  /** what each recovery action would do (the `recover` message) */
  plan: RecoveryPlanDTO;
}
export interface RecoveryPlanDTO {
  /** raise tax to `taxRate` on `taxParcels` parcels now below it: about `taxPerDay` more a day at yesterday's takings */
  taxRate: number; taxParcels: number; taxPerDay: number;
  /** sell land back: parcels of yours with nothing on them, their tiles and what they fetch now */
  sellParcels: number; sellTiles: number; sellCash: number;
  /** mothball services: how many of yours are open and what they cost a day (upkeep and your share of wages); how many are mothballed */
  mothball: number; mothballPerDay: number; mothballed: number;
}
/** The recovery plan's actions (sim/finance.ts); `keys` ("x,y" of a building's door) mothballs or reopens those buildings only. */
export type RecoverAction = 'tax' | 'sell' | 'mothball' | 'unmothball';
/** A player's money movements per category for the current game day so far and the whole of the day before. */
export interface LedgerDTO { day: number; today: Partial<Record<LedgerCat, number>>; yesterday: Partial<Record<LedgerCat, number>> }
export interface ChunkDTO {
  cx: number; cy: number;
  /** base64 of Uint16Array(CHUNK_SIZE^2) packed tiles */
  tiles: string;
  /** base64 of Int32Array(CHUNK_SIZE^2) parcel ids (0 = unclaimed) */
  parcels: string;
  /** base64 of Uint8Array(CHUNK_SIZE^2) aux bytes (structures.ts); omitted when the chunk's aux is all zero */
  aux?: string;
  /** base64 of Uint8Array(CHUNK_SIZE^2) sub bytes (kind ids of sub-kinds, docs/sub-kinds.md); omitted when all zero */
  sub?: string;
  /** base64 of Uint8Array(CHUNK_SIZE^2) under bytes (tunnels and platforms, docs/underground.md); omitted when all zero */
  under?: string;
}

export const CitizenState = { Home: 0, ToWork: 1, Work: 2, ToHome: 3, ToSite: 4, AtSite: 5, ToVenue: 6, AtVenue: 7 } as const;
export const Mode = { Walk: 0, Drive: 1 } as const;
/** Vehicle body on the wire (bits 8-9 of the flags). */
export const VehicleClass = { Sedan: 0, Truck: 1, Van: 2, Bus: 3 } as const;
/** Non-citizen road users use these in the kind bits so the client can colour them. */
export const VehicleKind = { Freight: 10, Visitor: 11, Patrol: 12, FireEngine: 13, Ambulance: 14, Bus: 15 } as const;
/** Life stage of a citizen (bits 12-13 of the wire flags). Adult is 0 so older frames read as adults. */
export const LifeStage = { Adult: 0, Child: 1, Retired: 2 } as const;
export const LIFE_STAGE_NAMES = ['adult', 'child', 'retired'] as const;
/**
 * citizens wire flags: bits 0-2 state, bit 3 mode (1 = in a vehicle), bits 4-7
 * occupation (the workplace's family code, so 4 bits stay enough past 16 kinds) / vehicle kind, bits 8-9 vehicle class, bit 10 queued, bit 11 emergency,
 * bits 12-13 life stage (LifeStage; vehicles 0), bit 14 moving in or leaving town (a suitcase on foot, a packed car; server sim/gateways.ts),
 * bit 15 backing up (a bus in the reverse of a three-point turn, server sim/traffic.ts: drawn facing against its motion),
 * bits 16-17 the driver's indicators (Indicator; server sim/indicators.ts). Bit 18 underground (CITIZEN_UNDER: waiting on a metro
 * platform or riding a metro train; OR it into packCitizenFlags). Bits 19-22 the fleet kind of a mobile worker's vehicle (FleetKind: taxi,
 * private hire, bicycle, moped, courier van, bin lorry, sweeper, trades van; 0 for anything else), bit 23 loaded (a taxi with a fare, a
 * rider or van with something to deliver), bit 24 working at a stop (bins on the lift, a rider at the door): shared/src/fleet.ts
 * packFleet, docs/mobile-jobs.md; a fleet vehicle sends kind 0 and the nearest body class. Bit 25 studying (CITIZEN_STUDY: a pupil or
 * student on the way to, at or back from their place of study, docs/education.md). Bits 26-30 are free.
 * A quad with state Home tells the client to drop that agent.
 */
export const packCitizenFlags = (state: number, mode: number, kind: number, cls = 0, queued = false, emergency = false, stage = 0, bag = false, rev = false, ind = 0) =>
  (state & 7) | ((mode & 1) << 3) | ((kind & 15) << 4) | ((cls & 3) << 8) | (queued ? 1 << 10 : 0) | (emergency ? 1 << 11 : 0) | ((stage & 3) << 12) | (bag ? 1 << 14 : 0) | (rev ? 1 << 15 : 0) | ((ind & 3) << 16);
export const citizenState = (f: number) => f & 7;
export const citizenMode = (f: number) => (f >> 3) & 1;
export const citizenKind = (f: number) => (f >> 4) & 15;
export const citizenClass = (f: number) => (f >> 8) & 3;
export const citizenQueued = (f: number) => ((f >> 10) & 1) === 1;
export const citizenEmergency = (f: number) => ((f >> 11) & 1) === 1;
export const citizenStage = (f: number) => (f >> 12) & 3;
/** moving in or leaving town with their luggage (bit 14) */
export const citizenBag = (f: number) => ((f >> 14) & 1) === 1;
/** backing up: draw it facing against its motion (bit 15) */
export const citizenReversing = (f: number) => ((f >> 15) & 1) === 1;
/** What a vehicle's indicators show (bits 16-17): the turn coming up, or hazards when it is stuck or backing up. */
export const Indicator = { None: 0, Left: 1, Right: 2, Hazard: 3 } as const;
export const citizenIndicator = (f: number) => (f >> 16) & 3;
/** bit 18: below ground, on a metro platform or train (docs/underground.md); the surface does not draw them */
export const CITIZEN_UNDER = 1 << 18;
export const citizenUnder = (f: number) => (f & CITIZEN_UNDER) !== 0;
/** bit 25: a pupil or student on the way to, at or back from school (docs/education.md), so the client draws a backpack, not staff */
export const CITIZEN_STUDY = 1 << 25;
export const citizenStudy = (f: number) => (f & CITIZEN_STUDY) !== 0;

/** One person (or dwelling vehicle) listed in a building's people panel. */
export interface PersonRow {
  id: number;
  name: string;
  activity: string;
  /** physically inside or at the building right now */
  here: boolean;
  /** citizens: age in years and life stage (LifeStage) */
  age?: number;
  stage?: number;
  /** residents: household id and its surname, so the panel can group families */
  household?: number;
  householdName?: string;
  /** citizens: highest qualification (EduLevel, shared/src/education.ts) */
  edu?: number;
}
/** Who belongs to or is visiting a building. Only sent when the inspect request asks for `full`. */
export interface BuildingPeople {
  residents: PersonRow[];
  workers: PersonRow[];
  visitors: PersonRow[];
  builders?: PersonRow[];
  parkedHere?: number;
  /** some list was cut at the row cap */
  truncated?: boolean;
}

/** Live detail for one building, answered on hover. */
export interface BuildingInfo {
  x: number; y: number;
  /** kind id (docs/sub-kinds.md) */
  kind: number; level: number;
  capacity: number; occupants: number;
  parcel?: { name: string; owner: string; taxRate: number };
  construction?: { done: number; total: number; builders: number; priority: number };
  /** residential */
  residents?: { total: number; employed: number; atHome: number; out: number; working: number; drivers: number; jobsByKind: number[] };
  /** workplaces */
  workers?: { total: number; onShift: number; commuting: number; offDuty: number; drivers: number; shifts: [string, number][] };
  wage?: number;
  upkeep?: number;
  /** a service or builders' yard its owner has mothballed (sim/finance.ts): no staff, no upkeep, no coverage */
  mothballed?: boolean;
  /** the viewer owns it and may mothball or reopen it */
  mothballable?: boolean;
  /** on fire, being put out, or the aftermath of one (server sim/fires.ts), in words */
  fire?: string;
  /** a media centre (docs/media.md): its channel, what it reaches and what it has reported */
  media?: MediaInfo;
  /** utilities (docs/utilities.md, server sim/utilities.ts): what it gets, from which node, its bill; a node's or plant's network */
  utilities?: UtilityInfo;
  visitors?: number;
  visitorCapacity?: number;
  /** builders' yard: sites its crews are on right now */
  activeSites?: number;
  /** leisure places (parks and venues): who is here, when it is open and the next event */
  venue?: {
    type: string; title: string; visitors: number; capacity: number; open: [number, number]; openNow: boolean;
    /** a venue with nobody on its payroll stays shut */
    staffed: boolean; ticket: number; visitsToday: number; visitsYesterday: number;
    nextEvent?: { weekday: string; hour: number; tonight: boolean; name: string };
    /** parks: visits a day that make it grow to the next level */
    upgradeVisits?: number;
    leisureValue: number; radius: number;
    /** a block's communal garden (sim/blocks.ts): the homes round it that count it, and their residents */
    block?: { homes: number; residents: number };
  };
  /** homes: leisure places within reach (coverage score: the sum of their leisure values, capped) */
  leisure?: { score: number; label: string; parks: number; venues: number };
  /** cars this building (or lot) can take off the street */
  parking?: { capacity: number; used: number; underground: boolean; turnedAway: number; fee?: number; incomeToday?: number };
  /** airport terminals: the runway behind it and today's flights (shared/src/airport.ts) */
  airport?: AirportInfo;
  /** transit stops: lines calling, people waiting, the next arrival (shared/src/transit.ts) */
  transit?: StopInfo;
  /** rail halts and stations: the track behind the platform, the lines calling here and today's riders (shared/src/rail.ts) */
  rail?: RailStationInfo;
  /** metro entrances and halls: the platform under the door, the lines calling, today's riders and where to change (sim/metro.ts) */
  metro?: MetroStationInfo;
  /** ferry piers: the berth (`track` says whether boats can call, `platform` its stop row), the lines calling, today's riders, where to change (sim/ferry.ts) */
  ferry?: MetroStationInfo;
  /** gateways (motorway connection, stations, coach depot, airport): arrivals and departures through it (shared/src/gateways.ts) */
  gateway?: GatewayInfo;
  /** named lists of everyone tied to this building; present only for a `full` inspect */
  people?: BuildingPeople;
  /** road work based here or serving here (docs/mobile-jobs.md): a cab office's taxis, a restaurant's orders and riders, a depot's rounds, a home's bins */
  mobile?: MobileRows[];
  /** harbours (docs/boats.md, server sim/harbours.ts): lanes, sea route, the catch, cargo and berth fees */
  harbour?: HarbourInfo;
  /** education kinds (docs/education.md, server sim/schools.ts): pupils, places, teachers and results */
  school?: SchoolInfo;
  /** homes, for a viewer with Focus groups (docs/motivation.md, Culture tier 2): what the people of this parcel care about */
  focus?: FocusInfo;
}

/** A Focus group's finding for one parcel (docs/motivation.md, BuildingInfo.focus): its grown-ups' values in whole percentages. */
export interface FocusInfo {
  parcel: string;
  /** adults and retirees asked (children are not) */
  people: number;
  /** percentages in Value order (shared/src/motivation.ts), summing to 100 */
  pct: number[];
}

/** A school, college or university for its tooltip (docs/education.md section 3). Stage is a Study value. */
export interface SchoolInfo {
  stage: number;
  /** enrolled now, and in today right now (at their desks) */
  pupils: number; present: number;
  /** the places the building has, and the places its teachers let it fill (an understaffed school admits in proportion) */
  places: number; admitting: number;
  /** staff holding a degree (teachers), and how many the school needs; postgraduates where a share of them must be */
  teachers: number; teachersNeeded: number; postgrads?: number; postgradsNeeded?: number;
  /** Manhattan tiles from home within which children are admitted; 0 = the whole city */
  catchment: number;
  /** the school day, hours (the university's are each student's own) */
  hours: [number, number];
  /** pass chance multiplier from staffing over the year, 0.5-1 */
  quality: number;
  /** results this school year: passed, failed (attendance or the exam), dropped out */
  passed: number; failed: number; droppedOut: number;
  /** children of this stage nearest here with no place anywhere in reach, at the last admissions */
  waiting: number;
  /** an FE college: learners on evening classes, its evening places and those its teachers let it fill (E5) */
  evening?: number; eveningPlaces?: number; eveningAdmitting?: number;
}

/** An airport terminal's runway and timetable, for its tooltip. Ticks are absolute game ticks. */
export interface AirportInfo {
  /** 'operational', or why planes are not flying */
  status: string;
  runwayLen?: number;
  gates: number;
  flightsPerHour?: number;
  flightsToday?: number;
  landedToday?: number;
  departedToday?: number;
  gatesInUse?: number;
  nextArrival?: { tick: number; type: string };
  nextDeparture?: { tick: number; type: string };
  passengersToday?: number;
  feesToday?: number;
  landingFee?: number;
}

/** A rail line on the wire: its definition, whether it runs, and its route through the track while it does (docs/rail.md). */
export interface RailLineDTO extends RailLineDef {
  /** 'running', or why no trains run */
  status: string;
  /** present while trains run: clients compute every train from this and the definition (railService) */
  route?: RailRoute;
  /** trains actually running (a there-and-back line runs one; a loop as many as fit) */
  running: number;
  /** why fewer trains run than asked */
  note?: string;
  headwayMin?: number;
}
/** A rail station's tooltip section. Ticks are absolute game ticks. */
export interface RailStationInfo {
  /** 'on the track', or what is wrong with the track behind the platform */
  track: string;
  lines: { id: number; number: number; name: string; color: number; status: string; headwayMin?: number; next?: { tick: number; toward: string } }[];
  callsToday: number;
  boardedToday: number;
  alightedToday: number;
  faresToday: number;
  /** freight yards: containers brought in by truck and sent out on trucks today, and those waiting for a train now */
  freight?: { inToday: number; outToday: number; waiting: number; inYesterday: number; outYesterday: number };
}
/**
 * A metro line on the wire ('metroLines', docs/underground.md): a rail line with `metro` set, whose route runs through
 * the under layer, plus its stations' names in calling order. Clients run its trains with railService, as on the surface.
 */
export interface MetroLineDTO extends RailLineDTO {
  names: string[];
}
/**
 * A ferry line on the wire ('ferryLines', docs/boats.md 6.2): a rail line with `ferry` set, whose route runs on the
 * water (RailRoute.water), plus its piers' names in calling order. Clients run its boats with railService.
 */
export interface FerryLineDTO extends RailLineDTO {
  names: string[];
}
/** A metro station's tooltip section: the rail section's fields (`track` says how the platform is), plus its name and the changes. */
export interface MetroStationInfo extends RailStationInfo {
  name: string;
  /** the platform's end tiles, [x0, y0, x1, y1], when there is one */
  platform?: [number, number, number, number];
  /** "change here for": routed stops of other lines within the change walk (TRANSIT.transferWalk), nearest first */
  changes: { name: string; x: number; y: number; mode: TransitMode; lines: { id: number; number: number; name?: string; colour: number }[] }[];
}
/** A train's tooltip (sim/rail.ts), answered to an inspectTrain. The consist the client works out itself. */
export interface TrainInfo {
  line: number; number: number; colour: number; freight: boolean;
  /** 'standing at …', 'running to …' */
  state: string;
  /** riders (passenger) or containers (freight) on board, and room */
  load: number; capacity: number;
  /** freight: containers on board by the yard they come off at */
  cargo?: { yard: string; containers: number }[];
  /** the station it last called at and the one it calls at next (the same while standing) */
  prev?: string; next?: string;
  /** only for a `full` inspect (the selected train): the citizens on board, activity 'to <station>' */
  riders?: PersonRow[];
  /** only for a `full` inspect of a freight train: each container on board, what it holds, the factory it left and the shop it goes to */
  consignments?: { what: string; from: string; to: string; yard: string }[];
  /** a list was cut at the row cap */
  truncated?: boolean;
}

/** Live detail for one road tile. */
export interface RoadInfo {
  x: number; y: number;
  /** 0-1 congestion level, moving average */
  congestion: number;
  vehiclesNow: number;
  queuedNow: number;
  /** average speed of the cars on it as a fraction of free flow */
  speedPct: number;
  junction: 'none' | 'yield' | 'signal' | 'roundabout' | 'flyover';
  /** which axis has green right now, for signals */
  green?: 'ns' | 'ew';
  /** the green is in its last (amber) ticks */
  amber?: boolean;
  kerbParked: number;
  parcel?: { name: string; owner: string };
  /** on a bridge deck (shared/src/bridges.ts): its style name and length in tiles */
  bridge?: { style: string; span: number };
}

/** Live detail for one person or vehicle. */
export interface CitizenInfo {
  id: number;
  name: string;
  /** 'citizen' or a vehicle kind label */
  role: string;
  occupation?: string;
  /** kind: kind id */
  employer?: { x: number; y: number; kind: number; level: number; parcel?: string };
  home?: { x: number; y: number; parcel?: string };
  activity: string;
  destination?: { x: number; y: number; label: string };
  shift?: { label: string; workingToday: boolean };
  /** 'ride': on board a bus or train (sim/transit.ts) */
  mode: 'walk' | 'drive' | 'none' | 'ride';
  /** times this driver has been re-routed on the trip under way (absent when none) */
  reroutes?: number;
  ownsCar?: boolean;
  money?: number;
  parked?: { x: number; y: number; where: string };
  status: 'moving' | 'queued' | 'idle';
  waitTicks: number;
  tripDone?: number; tripTotal?: number;
  speedPct?: number;
  /** tiles passed this trip, flat [x0,y0,x1,y1,…], oldest first (capped); only for an inspect with `route` */
  trail?: number[];
  /** tiles still to go: the rest of the current leg, then every queued leg, flat like `trail` */
  route?: number[];
  /** per planned leg: how it is travelled, and the node index in `route` where it begins */
  legKinds?: ('walk' | 'drive' | 'ride')[];
  legStarts?: number[];
  /** citizens only: age, health, family, friends and how they feel about life */
  life?: CitizenLife;
  /** buses: line, next stop, load and delay (shared/src/transit.ts) */
  bus?: BusInfo;
  /** a citizen driving a shared car (server sim/carpool.ts): the driver first (relation 'driver'), then the passengers; inspect only */
  occupants?: PersonRef[];
  /** a citizen riding in (or about to get into) someone else's car: the driver, relation as seen by the passenger */
  liftWith?: PersonRef;
  /** a mobile worker's road job, or a fleet vehicle's (docs/mobile-jobs.md) */
  fleet?: FleetInfo;
  /** a passenger in a taxi or waiting for one (sim/taxis.ts): the vehicle, so the panel can select it */
  taxi?: { vehicle: number; label: string };
  /** a fishing harbour's crew member whose trawler is out (server sim/harbours.ts): "at sea on the Kittiwake" */
  atSea?: { boat: number; name: string };
}

/** Someone a citizen is connected to, for the panel (clickable). */
export interface PersonRef {
  id: number;
  name: string;
  age: number;
  /** 'partner', 'child', 'parent', 'sibling', 'relative' for household members; 'friend' otherwise */
  relation: string;
  activity: string;
}
/** The life of one citizen, as the citizen panel shows it. Server-computed; the client only displays it. */
export interface CitizenLife {
  /** years (1 game week is about a year, see LIFE in server/src/sim/life.ts) */
  age: number;
  stage: 'adult' | 'child' | 'retired';
  /** 0-100 */
  health: number;
  /** 'flu', 'injury', 'chronic illness' */
  conditions: string[];
  /** what being unwell is doing to them right now, e.g. 'off sick today', 'doctor's visit planned' */
  care?: string;
  household: { id: number; name: string; members: PersonRef[] };
  friends: PersonRef[];
  /** people with the same workplace (computed on demand) */
  colleagues: number;
  /** 0-100, refreshed once a game day */
  happiness: number;
  /** the biggest contributions to happiness, largest first; delta in happiness points */
  reasons: { label: string; delta: number }[];
  /** money in (wages, pension) and out (tax, spending, parking) over the last 7 game days */
  income7: number;
  spend7: number;
  tripsToday: number;
  /** game minutes held up in traffic today (as a driver) */
  trafficMinToday: number;
  /** shifts missed through illness, ever */
  sickDays: number;
  /** 0-100: how much they need a day out (0 = just had one); visits restore it, a park nearby slows the drain */
  leisureNeed?: number;
  /** the moment of the game week they turn a year older (a game week is a year): weekday 0 = Monday, hour */
  birthday?: { weekday: number; hour: number };
  education?: CitizenEducation;
  /** what they care about, in words (docs/motivation.md section 9): "Cares most about family; restless" */
  values?: string;
  /** their latest change of job or home of their own accord, in words, while recent: "changed job for the pay" */
  lately?: string;
}
/** A citizen's schooling for the panel (docs/education.md); level, track and stage are EduLevel, EduTrack and Study. */
export interface CitizenEducation {
  level: number;
  track?: number;
  studying?: {
    place: { x: number; y: number; name: string };
    stage: number;
    /** school stages: 0 = Reception, then Year 1 to Year 13 */
    yearGroup?: number;
    /** share of the school days held so far that they attended, 0-1 */
    attendance: number;
    /** share of the stage done, 0-1 */
    progress: number;
  };
  /** finished stages, oldest first (at most EDU.logMax); week = game week it ended; result: EDU_RESULT_NAMES */
  history: { stage: number; place: string; week: number; result: number }[];
  /** an apprentice (E5): share of the apprenticeship done at their workplace, 0-1 */
  apprentice?: number;
  /** went to nursery, dropped out of a stage */
  nursery?: boolean;
  droppedOut?: boolean;
}

/** One node of the technology tree as the client shows it. */
export interface TechDTO { id: string; track: string; tier: number; name: string; blurb: string; cost: number; requires: string[]; condition: string; unlocks: string[] }

/** kind: kind id */
export interface SiteDTO { x: number; y: number; kind: number; level: number; target: number; done: number; total: number; builders: number; priority: number; created: number }

/**
 * `GET /api/config` on a main server: how the deployment is run, read by the page before it joins (docs/demo.md,
 * "A public showcase"). `spectate`: SPECTATE=1, the whole deployment is read-only (each world says so again in its
 * welcome, and refuses every intent that changes it). `defaultDemo`: DEFAULT_DEMO=<id>, a page opened without
 * `?demo=`, `?ws=` or `?city=` goes to that demo instead of the live world. `defaultView`: DEFAULT_VIEW, the camera's opening shot.
 */
export interface ServerConfig { spectate?: boolean; defaultDemo?: string; /** DEFAULT_VIEW: the opening camera shot for a page with no camera parameters, "x,y,dist,yaw,pitch[,hour]" (yaw and pitch in degrees; client camera.ts) */ defaultView?: string }

export type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'inspect'; x: number; y: number; full?: boolean }
  | { t: 'sites'; id: number }
  | { t: 'priority'; x: number; y: number; priority: number }
  | { t: 'sub'; chunks: [number, number][] }
  | { t: 'unsub'; chunks: [number, number][] }
  | { t: 'buy'; x: number; y: number; w: number; h: number }
  /** `dev` (sent with ?dev) skips technology locks, honoured only by a server not running in production */
  | { t: 'build'; tool: Tool; tiles: [number, number][]; dev?: boolean;
      /** multi-tile kinds: the orientation the player chose (0-3, the direction the front faces: 0 = +y, 1 = +x, 2 = -y, 3 = -x); left out = the server picks the road side */
      rot?: number;
      /** bulldoze in the underground view: fill unused tunnel instead of clearing the surface (docs/underground.md) */
      under?: true }
  /** `color` -1 clears it back to the owner's colour; on an estate member every setting applies to the whole estate */
  | { t: 'parcel'; id: number; taxRate?: number; name?: string; color?: number }
  /** parcel management on the world map (docs/world-map.md section 2, shared/src/parcelops.ts) */
  | { t: 'parcelOp'; op: 'combine'; ids: number[] }
  | { t: 'parcelOp'; op: 'split'; id: number; axis: 'x' | 'y'; at: number }
  | { t: 'parcelOp'; op: 'ungroup'; id: number }
  /** the world map's ground (shared/src/worldmap.ts): flat [sx, sy, version held, …] of the sectors in view, at detail `l` (0 a byte per tile, 1 per 4×4, 2 per 16×16; default 0); answered with a 'mapSector' for each whose version differs */
  | { t: 'map'; s: number[]; l?: number }
  /** `route` asks for the trail taken and the route ahead (the selected agent; hovers leave it off) */
  | { t: 'inspectCitizen'; id: number; route?: boolean }
  | { t: 'unlock'; id: string }
  /** switch an education policy (policies.ts) on or off for the schools on your parcels */
  | { t: 'setPolicy'; id: string; on: boolean }
  /** the recovery plan (sim/finance.ts, docs/start-from-zero.md B3): raise tax, sell empty land back, mothball or reopen
   *  services; `keys` ("x,y" doors) limits mothball/unmothball to those buildings, otherwise every service of yours */
  | { t: 'recover'; action: RecoverAction; keys?: string[] }
  /** dev servers only (ignored in production): unlimited funds toggle, a cash grant (`amount`, default $100,000; negative takes
   *  money away, for economy runs from a lower start), or every technology */
  /** `fire`: set the building at (x, y) on fire now (server sim/fires.ts), for testing and screenshots */
  | { t: 'dev'; action: 'unlimited' | 'money' | 'tech' | 'fire'; on?: boolean; amount?: number; x?: number; y?: number }
  | { t: 'ping'; n: number }
  /** a train's tooltip (sim/rail.ts); `full` adds who and what is on board (the selected train's panel) */
  | { t: 'inspectTrain'; line: number; train: number; full?: boolean }
  /** transit lines (shared/src/transit.ts): ask for every line; create or replace one of yours (no id: a new line); delete one */
  | { t: 'lines' }
  | { t: 'line'; op: 'save'; line: Partial<TransitLine> }
  | { t: 'line'; op: 'delete'; id: number }
  /** route a draft line without saving it: answered with 'linePreview' (docs/transit.md) */
  | { t: 'line'; op: 'preview'; line: Partial<TransitLine>; seq: number }
  /** onboarding (shared/src/goals.ts): skip or resume the goal chain; dismiss a hint for good */
  | { t: 'goals'; op: 'skip' | 'resume' }
  | { t: 'hint'; id: string }
  /** the charts panel (docs/charts.md): open (answered with 'history', then an hourly 'histSample' follows) or closed */
  | { t: 'hist'; open: boolean }
  /** a boat's panel (docs/boats.md section 7): what the server knows beyond the schedule; answered with 'boat' */
  | { t: 'inspectBoat'; id: number }
  // ---- issue bubbles and overlays (shared/src/issues.ts, server/src/sim/issues.ts) ----
  /** the data overlay to send for the subscribed chunks (Overlay: 1 coverage, 2 leisure, 3 happiness, 4 jobs/homes; 0 none) */
  | { t: 'overlay'; ch: number }
  /** adverts (docs/adverts.md, server sim/adverts.ts): a new campaign; put one up on slots ([door x, door y, slot]) or the n free ones nearest a point; take posters down, or end a campaign */
  | { t: 'adCampaign'; theme: number; claim: number; look: number; target?: AdTarget }
  | { t: 'adRent'; campaign: number; slots?: [number, number, number][]; near?: { x: number; y: number; n: number } }
  | { t: 'adEnd'; slots?: [number, number, number][]; campaign?: number; drop?: boolean }
  /** utilities (docs/utilities.md, server sim/utilities.ts): take down the trunk link through (x, y); pin a node as protected, or switch your grid import */
  | { t: 'utilLink'; op: 'remove'; x: number; y: number }
  | { t: 'utilNode'; x: number; y: number; protect?: boolean; importOn?: boolean };

export type ServerMsg =
  | { t: 'welcome'; you: string; seed: number; day: number; /** a frontier start (docs/first-five.md section 0) and its road end, where the goals' "show me" looks */ start?: 'frontier'; home?: [number, number]; /** a sandbox (test city or demo): anyone may edit any parcel and buy land anywhere */ sandbox?: boolean; /** a read-only showcase (SPECTATE=1 on the server): only looking; every intent that changes the world is refused */ spectate?: boolean; players: PlayerDTO[]; parcels: ParcelDTO[] }
  | { t: 'chunk'; chunk: ChunkDTO }
  /** flat quads: x, y, packedTile, parcelId */
  | { t: 'tiles'; u: number[] }
  /** flat triples: x, y, aux byte; only for tiles whose aux changed, sent just before the matching 'tiles' */
  | { t: 'aux'; u: number[] }
  /** flat triples: x, y, sub byte (kind id of a sub-kind, 0 = base kind); only for tiles whose sub changed, sent after 'aux' and before 'tiles' */
  | { t: 'sub'; u: number[] }
  /** flat triples: x, y, under byte (docs/underground.md); only for tiles whose under byte changed, sent before 'aux' and 'tiles' */
  | { t: 'under'; u: number[] }
  | { t: 'parcels'; parcels: ParcelDTO[]; removed?: number[] }
  /** a sector of the world map (shared/src/worldmap.ts): its version and the run-length coded map bytes of its modified chunks; chunks not listed are as the seed made them */
  | { t: 'mapSector'; sx: number; sy: number; v: number; /** detail level (absent: 0) */ l?: number; c: [number, number, string][] }
  | { t: 'players'; players: PlayerDTO[] }
  /** flat quads: id, x, y, flags (see packCitizenFlags) */
  | { t: 'citizens'; c: number[] }
  | { t: 'stats'; day: number; dayFrac: number; population: number; jobs: number; employed: number; moving: number; driving: number; sites: number; outAndAbout: number; chunks: number; vehicles: number; queued: number; speedPct: number; parked: number; /** server tick time over the last minute, ms (sim + flush); absent from older servers */ tickAvg?: number; tickP95?: number; tickMax?: number; /** newcomers in and leavers out through gateways today (absent from older servers) */ migIn?: number; migOut?: number; /** newcomers queued at the gates */ migWaiting?: number; /** game ticks per TICK_MS of wall time for the client's clock: 0 paused, 2 or 4 fast-forward (local mode, docs/local-mode.md); absent means 1 */ rate?: number }
  | { t: 'building'; x: number; y: number; info: BuildingInfo | null }
  | { t: 'road'; x: number; y: number; info: RoadInfo | null }
  | { t: 'citizen'; id: number; info: CitizenInfo | null }
  /** per chunk: base64 Uint8Array(CHUNK_SIZE^2); roads carry congestion 0-255, parking lots the cars parked */
  | { t: 'traffic'; cx: number; cy: number; d: string; /** cars parked at the kerb per road tile (base64 u8); absent when there are none */ k?: string }
  | { t: 'sitelist'; id: number; sites: SiteDTO[] }
  | { t: 'toast'; kind: 'info' | 'error'; msg: string }
  /** every rail line in the world, sent with the welcome and whenever any line's definition, status or route changes */
  | { t: 'railLines'; lines: RailLineDTO[] }
  /** every metro line (sim/metro.ts), sent with the welcome and whenever any line's definition, status or route changes */
  | { t: 'metroLines'; lines: MetroLineDTO[] }
  /** riders on board each running metro train, every 25 ticks while it changes: flat [lineId, trains, load0, load1, …, lineId, …] */
  | { t: 'metroLoads'; l: number[] }
  /** every ferry line (sim/ferry.ts), sent with the welcome and whenever any line's definition, status or route changes */
  | { t: 'ferryLines'; lines: FerryLineDTO[] }
  | { t: 'train'; line: number; train: number; info: TrainInfo | null }
  | { t: 'pong'; n: number }
  /** every transit line, and which line each bus on the road runs (flat [busId, lineId, …], for the livery) */
  | { t: 'lines'; lines: LineInfo[]; buses: number[]; saved?: number }
  /** between full 'lines' messages (sent when a line changes): what changes as the buses run, and the livery map */
  | { t: 'lineStats'; lines: LineStats[]; buses: number[] }
  | { t: 'linePreview'; preview: LinePreview }
  /** your onboarding goals (shared/src/goals.ts), to you only, whenever they change; `completed` names a goal just finished and its reward */
  | { t: 'goals'; goals: GoalsDTO; completed?: { id: string; reward: string } }
  /** your settlement rank (shared/src/ranks.ts), to you only, whenever it changes; `up`: a rank just reached (the celebration), `fresh`: milestones new since the last one */
  | { t: 'rank'; rank: RankDTO; up?: RankUp; fresh?: Milestone[] }
  /** an advisor hint (shared/src/goals.ts HINTS); `msg` replaces the stock wording when the server has numbers to put in it */
  /** `at`: a tile the hint is about (the first-settlers moment flies the camera there, docs/first-five.md) */
  | { t: 'hint'; id: string; msg?: string; at?: [number, number] }
  /** the city's history for the charts panel, to you only, when you open it: the world's series and yours (shared/src/history.ts) */
  | { t: 'history'; hour: number; world: RingsDTO; mine: RingsDTO }
  /** the newest hourly sample, to clients with the charts panel open: WORLD_SERIES values `w` and your PLAYER_SERIES values `p` */
  | { t: 'histSample'; hour: number; w: number[]; p: number[] }
  /** every harbour with its lanes, and the sea gates (docs/boats.md 6.5): on hello and whenever anything changes, always a new list */
  | { t: 'harbours'; list: HarbourDTO[]; gates: SeaGate[] }
  | { t: 'boat'; id: number; info: BoatInfo | null }
  // ---- issue bubbles and overlays (shared/src/issues.ts, server/src/sim/issues.ts) ----
  /** per chunk: base64 Uint8Array(CHUNK_SIZE^2) of issue codes (Issue, at a building's door tile); '' when the chunk has none. On subscribe and when the chunk's codes change */
  | { t: 'issues'; cx: number; cy: number; d: string }
  /** every fire burning, being put out or in its aftermath (server sim/fires.ts, shared/src/fires.ts), whenever the list changes */
  | { t: 'fires'; f: FireDTO[] }
  /** your own parcels' problems, flat triples x, y, code: on hello, then when they change (at most every ISSUE_TUNING.problemsHours) */
  | { t: 'problems'; p: number[]; /** one per triple: why a very unhappy home is (shared/src/issues.ts MOOD_REASONS), 0 for others; absent when none */ r?: number[] }
  /** per chunk: the overlay you asked for, base64 Uint8Array(CHUNK_SIZE^2) (overlayByte; 0 no data), sent when it changes */
  | { t: 'overlay'; ch: number; cx: number; cy: number; d: string }
  /** every campaign and rented ad slot (shared/src/adverts.ts AdsDTO), on join and whenever they change (rare: intents and midnight) */
  | ({ t: 'ads' } & AdsDTO)
  /** the news (shared/src/news.ts): stories new or changed since the last, or with `all` the newest NEWS.helloSend on joining; the client keeps them by id */
  | { t: 'news'; s: StoryDTO[]; all?: boolean }
  /** utilities (shared/src/utilities.ts): every node's state once a game hour and on a fault or repair, flat [x, y, UtilState, load %, ...] (doors); `h` the game hour */
  | { t: 'utilState'; h: number; n: number[] }
  /** every trunk link (shared/src/utilities.ts UtilLinkDTO), on hello and whenever one is laid, taken down or faults */
  | { t: 'utilLinks'; links: UtilLinkDTO[]; /** link ids faulted now */ down?: number[] };

/** A broadcaster in the building panel (server sim/news.ts describe). */
export interface MediaInfo {
  /** the channel's name and owner */
  channel: string; owner: string;
  /** tiles it reaches (square, from the door); 0 the whole map */
  radius: number;
  tier: number;
  /** staffed: only a centre with staff on the payroll reports */
  staffed: boolean;
  /** other players' channels whose centres reach this one's door */
  rivals: string[];
  /** stories this channel has run in the log, and the newest headlines */
  stories: number; latest: string[];
  /** news helicopters based on its roof (N3 flies them) */
  helicopters: number;
}

/**
 * A harbour on the wire (server sim/harbours.ts): what the boat schedule reads (boats.ts BoatHarbour: id, kind, the
 * anchor as x and y, name, active, berths, lanes) and where it stands. Clients run boatsAt on the list as it comes.
 */
export interface HarbourDTO extends BoatHarbour {
  /** rotation: the FRONT index the door faces */
  r: number;
  door: [number, number];
  owner: string | null;
  /** the fairway tile every lane starts at */
  fairway: [number, number];
  /** the lanes its kind wants that could not be derived, and why ("no sea route for container ships: ...") */
  refused?: string[];
}
/** A harbour's tooltip (server sim/harbours.ts). Money is dollars today; counts are today's unless named otherwise. */
export interface HarbourInfo {
  role: string;
  /** staffed: its boats sail */
  active: boolean;
  lanes: { purpose: string; cls: string; tiles: number; gate?: string }[];
  refused: string[];
  /** the sea gate (or open water's offing) its sea lanes leave by; a cargo port is a gateway only with one */
  sea?: string;
  /** without a sea gate in the world: how many tiles of water it stands on (counted up to the open-sea size) */
  waterTiles?: number;
  boats: number;
  /** its boats away now */
  away: number;
  /** fishing: boxes landed today, sent to market today, waiting on the quay */
  landed?: number; sold?: number; stock?: number;
  /** cargo port: ship calls today, containers landed and taken on, waiting to go by lorry, in the export stack, passengers off */
  calls?: number; imports?: number; exports?: number; importQueue?: number; exportStack?: number; passengers?: number;
  /** port dues (port) or berth fees (marina) earned today */
  fees?: number;
}
/** A boat's panel: what the server knows beyond the schedule (the client has the type, name, crew roles and route). */
export interface BoatInfo {
  id: number;
  harbour: number;
  harbourName?: string;
  /** a trawler's crew: real citizens on the harbour's payroll */
  crew?: { id: number; name: string }[];
  /** boxes of fish this trawler landed today */
  landedToday?: number;
  /** a ship's call: containers landed and taken on, passengers off */
  cargo?: { imports: number; exports: number; passengers: number };
}
