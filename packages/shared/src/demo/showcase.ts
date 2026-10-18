import { KIND_ID, MANIFEST, type KindToolId } from '../buildings/compiled';
import { MOTORWAY_KIND } from '../gateways';
import { ZONE_COST } from '../constants';
import type { KindManifest } from '../buildings/schema';
import type { Tool } from '../protocol';
import { STOP_KINDS, TRANSIT, type TransitMode } from '../transit';
import { METRO, isTunnel, isPlatform, underMask } from '../metro';
import { placedFromDoor, footprintOf, FRONT, FRONT_NAMES, type Placed } from '../structures';
import { kindManifest, CIVIC_COST } from '../tile';
import { techFor, TRACK_NAMES } from '../tech';
import { RUNWAY_COST, RUNWAY_MIN, RUNWAY_MAX, TERMINAL_ROW } from '../airport';
import { RAIL_COST, CROSSING_COST } from '../rail';
import { ROUNDABOUT_COST, FLYOVER_COST } from '../junctions';
import { BRIDGE_TILE_COST, BRIDGE_MAX_SPAN, BRIDGE_STYLE_NAMES, BridgeStyle, isBridgeAux, bridgeStyle, bridgeSpanAt, basculeSeed, basculeLiftAt } from '../bridges';
import { isCrossing } from '../rail';
import { GROW_FORMS, firstLevelOf } from '../zones';
import { capacityOf, isGrowableId, terrainOf, Terrain } from '../tile';
import { PLANE_TYPES, timetable, type PlaneType, type Airport } from '../flights';
import { heliTimetable, type Pad, type PadKind } from '../helicopters';
import { londonSections, LONDON_TOUR, LONDON_VIEW } from './london';
import { isCabOffice, isFoodVenue, isWasteDepot, isCourierDepot, TAXI, FOOD, REFUSE, COURIER, MOBILE } from '../fleet';
import { zoneOf, levelOf, Zone } from '../tile';

/**
 * Demo maps (docs/demo.md): a planned, lived-in town where every large object in the catalogue is placed once and
 * running, for showing the game and teaching it. This file is the scenario as data. The server's demo seeder
 * (server/src/demo/seed.ts) builds it through the same planners players use; the client's tour panel
 * (client/src/tour.ts) flies the camera through it in `TOUR` order; `npm run demo:check` fails when a placeable kind,
 * a size-ladder rung, a linear surface, a line mode or a registered feature (SHOWCASE_FEATURES) is missing from it.
 *
 * Geometry. The town is a 3×3 grid of Commons-style districts (`seedCity`, 22×22 tiles, roads every 5 tiles, zones
 * pre-built to level 3) spanning x and y from -35 to 34, with the perimeter roads on x = -35 and 34, y = -35 and 34.
 * Districts are A1 (north-west) to C3 (south-east), rows A-C north to south. Inside a district, a block is the 4×4 of
 * lots between roads; block (bi, bj) of the district at (X0, Y0) covers x X0+1+5bi..X0+4+5bi and the same in y.
 * Sections clear the blocks they use and place their objects there; rail, freight and the airport sit on extra land
 * outside the perimeter, where no road crosses the track or the runway.
 *
 * Coordinates are world tiles, y growing south. A placement names its catalogue kind (string id), the tile a player
 * would click (the door) and its rotation (FRONT order: 0 the door faces +y/south, 1 east, 2 north, 3 west).
 */

export type SectionId = 'downtown' | 'transport' | 'civic' | 'rail' | 'leisure' | 'airport' | 'industry' | 'riverside'
  | 'london-areas' | 'london-landmarks' | 'london-rail' | 'london-buses' | 'london-tube';
export type DemoId = 'showcase' | 'transport' | 'leisure' | 'civic' | 'london';
export type DemoXY = readonly [number, number];
/** x, y, width, height in tiles */
export type DemoRect = readonly [number, number, number, number];

export interface DemoPlacement {
  /** unique in the scenario; defaults to the kind id. Tour order refers to it */
  id?: string;
  /** catalogue kind id ('stadium', 'rail-station', 'bus-stop', ...) */
  kind: string;
  /** the tile a player clicks: the door of a structure, the tile itself for a 1×1 */
  door: DemoXY;
  /** FRONT order; required for multi-tile kinds */
  rot?: 0 | 1 | 2 | 3;
  /**
   * The level it stands at, for a merged lot (zones.ts GROW_FORMS: a zone kind bigger than 1×1 that growth assembles,
   * never placed by a player): the seeder builds it on lots of its zone as growth would. Default its first level.
   */
  level?: number;
  /** a metro station's name (World.setStopName), shown on the platform, the Tube map and the tooltips */
  name?: string;
}
export interface DemoZone { zone: 'residential' | 'commercial' | 'industrial' | 'office'; rect: DemoRect }
/** a runway dragged from `from` to `to` (shared/src/airport.ts planRunway) */
export interface DemoRunway { id: string; from: DemoXY; to: DemoXY }
/** railway track: each drag as a player makes it (rail.ts trackDragPath: the longer axis first, one corner) */
export interface DemoTrack { id: string; name: string; drags: readonly (readonly [DemoXY, DemoXY])[] }
/**
 * A road bridge (bridges.ts planBridge) whose deck runs from `from` to `to`, both water tiles in a line, with road on
 * the banks beyond them. `style` forces the style (else the tool's choice); `landmark` is the catalogue landmark a
 * bascule span is drawn as (Tower Bridge), which then counts as placed in the city's demo.
 */
export interface DemoBridge { id: string; name: string; from: DemoXY; to: DemoXY; style?: keyof typeof BridgeStyle; landmark?: string }
/** a roundabout or flyover clicked on the junction `at` (junctions.ts); a flyover's deck carries the `deck` road */
export interface DemoJunction { id: string; tool: 'roundabout' | 'flyover'; at: DemoXY; deck?: 'ew' | 'ns' }
/** A tour stop on something that is neither a kind nor a drag (a level crossing, the river): its caption is SPOT_CAPTIONS[spot]. */
export interface DemoSpot { id: string; spot: SpotKind; name: string; rect: DemoRect; inspect?: DemoXY; view?: 'under' }
export interface DemoLine {
  id: string; mode: TransitMode; number: number; colour: number;
  /** stops in calling order: bus stop tiles or station doors */
  stops: readonly DemoXY[];
  loop: boolean; vehicles: number;
  /** a rail line calling only at freight yards */
  freight?: boolean;
  /** the line's name ("Central"), shown in place of its number (metro lines) */
  name?: string;
}
/**
 * grown land the tour stops at: a block of a zone, not placed (zones grow by themselves). `inspect` is a lot on the
 * block's edge: the four inner lots of a seedCity block have no road beside them and stay empty.
 */
export interface DemoBlock {
  id: string; kind: string; name: string; rect: DemoRect; inspect: DemoXY;
  /** the tour caption, in place of the kind's blurb (a named area of a sample city) */
  blurb?: string;
  /** how it comes about, in place of the kind's howTo */
  how?: string;
}
export interface DemoSection {
  id: SectionId; name: string; blurb: string;
  /** extra land outside the districts, owned by the town */
  land?: { name: string; rect: DemoRect }[];
  /** blocks cleared to bare ground before anything is placed */
  clear?: DemoRect[];
  /** blocks rezoned (built to the town's level) */
  zones?: DemoZone[];
  /** open water painted into the terrain (a scenario's river: no tool makes water) */
  water?: DemoRect[];
  /** straight road drags as the road tool lays them, on own dry land (bridges are `bridges`, laid after) */
  roads?: readonly (readonly [DemoXY, DemoXY])[];
  placements?: DemoPlacement[];
  runways?: DemoRunway[];
  tracks?: DemoTrack[];
  junctions?: DemoJunction[];
  bridges?: DemoBridge[];
  lines?: DemoLine[];
  blocks?: DemoBlock[];
  spots?: DemoSpot[];
}
export interface DemoDef {
  id: DemoId; name: string; blurb: string;
  /** world-launcher slot: the child server listens on TEST_CITY_BASE_PORT + slot (8190 for the showcase) */
  slot: number;
  sections: SectionId[];
  /** the town under the sections: the 3×3 districts of DEMO_TOWN (the default), or the London map (london.ts) */
  town?: 'london';
  /** tour order, when not TOUR */
  tour?: string[];
  /** the welcome stop's camera, when not the 3×3 town's */
  view?: Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'>;
}

/** The town under every demo: seedCity options. Deterministic: same seed, same districts, same town. */
export const DEMO_TOWN = { seed: 7, districts: 3, built: 3, gap: 2 } as const;
/** Player id that owns the demo town (seedCity's Commons player). */
export const DEMO_OWNER = 'sys';

// district block helpers, for the rects below (the placements are literal tiles)
const D = (i: number) => -35 + 24 * i;
const block = (di: number, dj: number, bi: number, bj: number): DemoRect => [D(di) + 1 + 5 * bi, D(dj) + 1 + 5 * bj, 4, 4];
/** bus line 2's stops (x = -24, beside the x = -25 road): the civic district, the western suburb, the industrial estate */
const LINE_2_STOPS = [-33, -23, -9, -4, 1, 6, 15, 20, 25, 30];
/** blocks of a seedCity district that are not homes (its zone pattern repeats in every district) */
const NON_HOME_BLOCKS: [number, number][] = [[2, 0], [0, 1], [2, 1], [3, 1], [0, 2], [1, 2], [3, 2], [1, 3], [2, 3]];

/**
 * The riverside quarter south of the freight line: a river on rows 44-47 (four wide, the span Tower Bridge's model is
 * drawn for), four streets carried over it on bridges of every style, and a row of ten 4×4 blocks between the river road
 * (y = 49) and y = 54, with a street every 5 tiles from x = -20 to 30, and a row of ten blocks of homes behind them
 * (y = 55-58, a street on y = 59) whose people work in the quarter. The quarter is reached only over the bridges.
 */
const RIVER_ROWS = [44, 47] as const;
const QUARTER_X = Array.from({ length: 11 }, (_, i) => -20 + 5 * i);
const qblock = (i: number, row = 0): DemoRect => [-19 + 5 * i, 50 + 5 * row, 4, 4];
/** the streets that cross the river: from the perimeter road (y = 34) over the railway land to the river road */
const RIVER_BRIDGES: { id: string; name: string; x: number; style: keyof typeof BridgeStyle }[] = [
  { id: 'bridge-girder', name: 'Mill Lane bridge', x: -20, style: 'Girder' }, // over the freight line's level crossing too
  { id: 'bridge-arch', name: 'Stone bridge', x: 5, style: 'Arch' },
  { id: 'bridge-bascule', name: 'Lifting bridge', x: 15, style: 'Bascule' },
  { id: 'bridge-suspension', name: 'Suspension bridge', x: 25, style: 'Suspension' },
];
/** bus line 3's stops: beside the street down to the stone bridge, then the river road's north side out to its dead end at x = 33 */
const RIVER_LINE_STOPS: DemoXY[] = [[6, 40], [12, RIVER_ROWS[1] + 1], [22, RIVER_ROWS[1] + 1], [32, RIVER_ROWS[1] + 1]];
/** A merged lot (docs/buildings.md "Merged lots") with its footprint's top-left corner at (ax, ay): the door that puts it there. */
function mergedAt(kind: string, ax: number, ay: number, rot: 0 | 1 | 2 | 3, level: number): DemoPlacement {
  const k = (KIND_ID as Record<string, number>)[kind], fp = footprintOf(k), [w, h] = rot & 1 ? [fp.h, fp.w] : [fp.w, fp.h];
  for (let y = ay; y < ay + h; y++) for (let x = ax; x < ax + w; x++) {
    const p = placedFromDoor(k, x, y, rot);
    if (p.ax === ax && p.ay === ay) return { kind, door: [x, y], rot, level };
  }
  throw new Error(`no door puts ${kind} at (${ax}, ${ay})`);
}

/** Mobile-job bases on the tour (shared/src/fleet.ts): the door of a cab office, a takeaway, a waste depot and a parcel depot downtown. */
const MOBILE_SPOTS: [MobileSpot, number, number, string][] = [
  ['cab-office', 5, 0, 'Cab office'], ['takeaway', 6, 0, 'Takeaway'], ['waste-depot', 16, 0, 'Waste and recycling depot'], ['parcel-depot', 14, 0, 'Parcel depot'],
];
type MobileSpot = 'cab-office' | 'takeaway' | 'waste-depot' | 'parcel-depot';
/** Does the 1×1 lot at (x, y) of the seeded town hold that mobile-job role? */
const mobileRoleAt = (spot: MobileSpot, x: number, y: number, t: number, a: number) => {
  if (a) return false; // a structure's tile: the roles sit on lots
  const z = zoneOf(t);
  switch (spot) {
    case 'cab-office': return z === Zone.Commercial && isCabOffice(Zone.Commercial, x, y);
    case 'takeaway': return z === Zone.Commercial && isFoodVenue(Zone.Commercial, x, y);
    case 'waste-depot': return z === Zone.Industrial && isWasteDepot(Zone.Industrial, x, y);
    case 'parcel-depot': return z === Zone.Industrial && levelOf(t) > 0 && isCourierDepot(Zone.Industrial, levelOf(t), x, y);
  }
};

export const SECTIONS: DemoSection[] = [
  {
    id: 'downtown', name: 'Downtown',
    blurb: 'Nine districts of homes, shops, offices and industry, pre-built to level 3. Nobody places these: you zone land and it grows when there is demand and builders can reach it. District B1 is all homes: its people commute downtown, many by bus.',
    // the western district (B1) becomes a suburb: every shop, factory and office block there is homes, so its people
    // commute out, many by the two bus lines (with no jobs at home, their trips are long enough to ride); its east
    // column keeps an office and a shopping block so the town has a few more jobs than people
    zones: NON_HOME_BLOCKS.filter(([bi]) => bi < 3).map(([bi, bj]): DemoZone => ({ zone: 'residential', rect: block(0, 1, bi, bj) })),
    blocks: [
      { id: 'block-residential', kind: 'residential', name: 'Homes', rect: block(1, 1, 1, 1), inspect: [-5, -4] },
      { id: 'block-commercial', kind: 'commercial', name: 'Shops', rect: block(1, 1, 2, 0), inspect: [3, -9] },
      { id: 'block-office', kind: 'office', name: 'Offices', rect: block(1, 1, 3, 1), inspect: [8, -4] },
      { id: 'block-industrial', kind: 'industrial', name: 'Industry', rect: block(1, 1, 0, 2), inspect: [-10, 1] },
      // the middles of the blocks (sim/blocks.ts settleInteriors): deep plots grown back from the frontage, and a
      // communal garden inside a ring of homes
      { id: 'block-deep', kind: 'res-deep', name: 'Deep plots', rect: block(1, 1, 1, 0), inspect: [-4, -7] },
      { id: 'block-garden', kind: 'block-garden', name: 'Communal garden', rect: block(1, 1, 2, 2), inspect: [1, 2],
        blurb: 'A communal garden: the 2×2 middle of a block ringed by homes, which no road reaches, planted by the residents as a shared garden. Only the homes round it count it, as a small park nearby; nobody else can get in.',
        how: 'Nothing to build. Zone a block all homes and own its middle: once every home round it stands, the residents plant it. It costs nothing and has no upkeep.' },
    ],
    // mobile jobs (docs/mobile-jobs.md): roles of grown lots picked by tile hash, so these doors are where the hashes put them
    spots: MOBILE_SPOTS.map(([id, x, y, name]): DemoSpot => ({ id, spot: id, name, rect: [x, y, 1, 1], inspect: [x, y] })),
  },
  {
    id: 'transport', name: 'Buses and parking',
    blurb: 'A bus depot whose drivers run two lines out of the western suburb with a stop on every block, every size of car park from kerbside bays to a park and ride, and a roundabout and a flyover downtown.',
    // the roundabout at (-20, -6), one of the busiest crossroads, takes its four corner lots
    clear: [block(1, 1, 2, 1), block(1, 1, 1, 2), [-21, -7, 1, 1], [-19, -7, 1, 1], [-21, -5, 1, 1], [-19, -5, 1, 1]],
    // the motorway connection (gateways): just outside the west perimeter road, where newcomers, visitors and freight come in
    land: [{ name: 'Motorway junction', rect: [-39, -3, 4, 6] }],
    placements: [
      { kind: 'motorway', door: [-36, 0], rot: 1 },
      { kind: 'bus-depot', door: [1, -2], rot: 0 },
      { kind: 'multi-storey', door: [0, -5], rot: 2 },
      { kind: 'park-and-ride', door: [-4, 3], rot: 0 },
      { kind: 'kerbside-bays', door: [-5, 0] },
      { kind: 'parking', door: [-4, 0] },
      // line 1 runs west-east along y = -1 (stops on its north side), line 2 north-south along x = -25 through the western
      // suburb (stops on its east side): a stop in the middle of a block's frontage, never facing a junction, skipping the
      // depot and car park blocks and the civic section's lots
      ...[-33, -28, -23, -18, -9, 6, 15, 20, 25, 30].map((x, i): DemoPlacement => ({ id: i ? `bus-stop-${i + 1}` : 'bus-stop', kind: 'bus-stop', door: [x, -2] })),
      ...LINE_2_STOPS.map((y, i): DemoPlacement => ({ id: `bus-stop-${i + 11}`, kind: 'bus-stop', door: [-24, y] })),
    ],
    junctions: [
      { id: 'roundabout', tool: 'roundabout', at: [-20, -6] },
      // both bus lines cross here, line 1 over the deck and line 2 under it
      { id: 'flyover', tool: 'flyover', at: [-25, -1], deck: 'ew' },
    ],
    lines: [
      { id: 'line-bus-1', mode: 'bus', number: 1, colour: 0xe0a92e, loop: false, vehicles: 5, stops: [-33, -28, -23, -18, -9, 6, 15, 20, 25, 30].map((x): DemoXY => [x, -2]) },
      { id: 'line-bus-2', mode: 'bus', number: 2, colour: 0x3a86d4, loop: false, vehicles: 5, stops: LINE_2_STOPS.map((y): DemoXY => [-24, y]) },
    ],
  },
  {
    id: 'civic', name: 'Civic services',
    blurb: 'Every size of health, police, fire and builders, side by side in district A1: what each rung covers, who staffs it and what it costs.',
    clear: [block(0, 0, 1, 2), block(0, 0, 0, 2), block(0, 0, 2, 3), block(0, 0, 3, 1), block(0, 0, 3, 2), block(0, 0, 2, 1), block(0, 0, 1, 3)],
    placements: [
      { kind: 'gp-surgery', door: [-31, -24] },
      { kind: 'health-centre', door: [-22, -19], rot: 2 },
      { kind: 'walk-in-centre', door: [-24, -19], rot: 2 },
      { kind: 'hospital', door: [-31, -21] },
      { kind: 'community-hospital', door: [-23, -16], rot: 0 },
      { kind: 'general-hospital', door: [-33, -21], rot: 0 },
      { kind: 'teaching-hospital', door: [-27, -21], rot: 0 },
      { kind: 'police-box', door: [-19, -29] },
      { kind: 'police-post', door: [-18, -29] },
      { kind: 'police', door: [-17, -29] },
      { kind: 'divisional-station', door: [-19, -21], rot: 0 },
      { kind: 'police-hq', door: [-18, -26], rot: 0 },
      { kind: 'fire-post', door: [-24, -29] },
      { kind: 'fire', door: [-23, -29] },
      { kind: 'large-fire-station', door: [-16, -21], rot: 0 },
      { kind: 'fire-hq', door: [-23, -26], rot: 0 },
      { kind: 'handyman', door: [-26, -19] },
      { kind: 'yard', door: [-26, -16] },
      { kind: 'builders-depot', door: [-29, -19], rot: 2 },
      { kind: 'construction-company', door: [-29, -16], rot: 0 },
    ],
    // the general and teaching hospitals' air ambulances and the police headquarters' helicopter (docs/helicopters.md)
    spots: [{ id: 'helipads', spot: 'helipads', name: 'Helipads', rect: [-34, -27, 18, 10], inspect: [-27, -21] }],
  },
  {
    id: 'rail', name: 'Rail and freight',
    blurb: 'A halt among the homes of district A2 and a station beside the stadium, on a passenger line along the north edge, two freight yards on a freight line along the south edge (one beside the industrial estate, one beside the shops it delivers to), and an underground line from the rail station past the arena to a bus stop on line 1.',
    land: [{ name: 'North railway', rect: [-35, -41, 70, 6] }, { name: 'South railway', rect: [-35, 35, 70, 6] }],
    // the metro line's middle kiosk and its hall (beside the east road, x = 28) take a lot or two of the districts
    clear: [[27, -19, 1, 1], [27, -3, 1, 2]],
    // shops beside the east yard (the estate's nearest), homes in place of every shop nearer the estate than that
    zones: [
      { zone: 'commercial', rect: block(1, 2, 2, 3) },
      ...[block(0, 2, 3, 2), block(0, 2, 2, 0), block(0, 2, 0, 1), block(0, 1, 1, 3), block(1, 2, 0, 1)].map((rect): DemoZone => ({ zone: 'residential', rect })),
    ],
    placements: [
      { kind: 'rail-halt', door: [-7, -36], rot: 0 },
      { kind: 'rail-station', door: [20, -36], rot: 0 },
      { id: 'freight-yard-west', kind: 'freight-yard', door: [-30, 35], rot: 2 },
      { id: 'freight-yard-east', kind: 'freight-yard', door: [-2, 35], rot: 2 },
      // the underground line (docs/underground.md): a kiosk 3 tiles from the rail station's door, one by the arena, and a
      // hall 2 tiles from bus line 1's stop at (25, -2). Every platform runs north-south (rot 1: along y), so the tunnel
      // turns once under the stadium's district and runs straight down x = 27 under the roads and blocks between
      { kind: 'metro-entrance', door: [17, -36], rot: 1, name: 'Station Road' },
      { id: 'metro-entrance-2', kind: 'metro-entrance', door: [27, -19], rot: 1, name: 'Arena' },
      { kind: 'metro-station', door: [27, -2], rot: 1, name: 'Eastgate' },
    ],
    tracks: [
      // the halt's platform track runs on y = -38, the station's on y = -39: one drag with a corner, then along the station.
    // The halt sits by the homes of district A2 and the station by the stadium, 30 tiles apart: a match night out by train
      { id: 'track-passenger', name: 'Passenger line track', drags: [[[-10, -38], [15, -39]], [[15, -39], [25, -39]]] },
      { id: 'track-freight', name: 'Freight line track', drags: [[[-34, 38], [1, 38]]] },
    ],
    lines: [
      { id: 'line-rail-1', mode: 'rail', number: 1, colour: 0xb0563d, loop: false, vehicles: 1, stops: [[-7, -36], [20, -36]] },
      { id: 'line-freight-1', mode: 'rail', number: 9, colour: 0x6d6f73, loop: false, vehicles: 1, freight: true, stops: [[-30, 35], [-2, 35]] },
      { id: 'line-metro-1', mode: 'metro', number: 1, name: 'Crosstown', colour: 0x0098d4, loop: false, vehicles: 2, stops: [[17, -36], [27, -19], [27, -2]] },
    ],
  },
  {
    id: 'leisure', name: 'Leisure',
    blurb: 'Every park, cinema, theatre, sports venue and library size in district A3, with the people who go there by day and on event nights.',
    clear: [block(2, 0, 1, 0), block(2, 0, 0, 2), block(2, 0, 2, 1), block(2, 0, 3, 1), block(2, 0, 2, 3), block(2, 0, 3, 2), block(2, 0, 1, 3)],
    placements: [
      { kind: 'park', door: [24, -29] },
      { kind: 'lakeside-park', door: [25, -26], rot: 0 },
      { kind: 'botanical-garden', door: [16, -21], rot: 0 },
      { kind: 'cafe-cinema', door: [29, -24] },
      { kind: 'cinema', door: [30, -24] },
      { kind: 'multiplex', door: [30, -21], rot: 0 },
      { kind: 'studio-theatre', door: [29, -29] },
      { kind: 'theatre', door: [30, -29] },
      { kind: 'opera-house', door: [30, -26], rot: 0 },
      { kind: 'sports', door: [24, -19] },
      { kind: 'leisure-centre', door: [32, -21], rot: 0 },
      { kind: 'arena', door: [25, -16], rot: 0 },
      { kind: 'stadium', door: [20, -34], rot: 2 }, // facing the north road, a short walk from the rail station
      { kind: 'library', door: [22, -19] },
      { kind: 'central-library', door: [19, -19], rot: 2 },
      { kind: 'museum', door: [20, -16], rot: 0 },
    ],
  },
  {
    id: 'airport', name: 'Airport',
    blurb: 'An airport terminal facing the east perimeter road, with a 20-tile runway five rows behind it: a flight an hour, every type from the business jet to the jumbo, landing fees for the owner.',
    land: [{ name: 'Airfield', rect: [35, -12, 15, 24] }],
    // homes across the road from the terminal, whose nearest jobs are the ground crew's
    zones: [block(2, 1, 3, 1), block(2, 1, 3, 2)].map((rect): DemoZone => ({ zone: 'residential', rect })),
    placements: [{ kind: 'airport', door: [35, 0], rot: 3 }],
    // 20 tiles: long enough for the jumbo (flights.ts PLANE_TYPES minRunway), so every plane type flies here
    runways: [{ id: 'runway', from: [46, -10], to: [46, 9] }],
  },
  {
    id: 'industry', name: 'Industry',
    blurb: 'An industrial estate in district C1 beside the west freight yard: its factories send deliveries by train to the shops beside the east yard.',
    // the south-west corner of district C1 all factories, beside the west freight yard
    zones: [block(0, 2, 0, 3), block(0, 2, 1, 3), block(0, 2, 1, 2)].map((rect): DemoZone => ({ zone: 'industrial', rect })),
    blocks: [{ id: 'block-estate', kind: 'industrial', name: 'Industrial estate', rect: [-34, 24, 9, 9], inspect: [-34, 30] }],
  },
  {
    id: 'riverside', name: 'Riverside',
    blurb: 'A river south of the freight line, crossed by a stone arch, a steel girder, a suspension and a lifting bascule bridge, with a level crossing on the way down, and a quarter beyond it where every merged building stands: terraces to tower estates, parades to hotel towers, workshops to a heavy plant, a headquarters with a rooftop helipad.',
    land: [{ name: 'Riverside', rect: [-35, 41, 70, 20] }],
    // the river runs on off the town's land both ways (into the lake to the west)
    water: [[-60, RIVER_ROWS[0], 131, RIVER_ROWS[1] - RIVER_ROWS[0] + 1]],
    roads: [
      // the four streets down to the river; the freight line's track (rail section) crosses the first on a level crossing
      ...RIVER_BRIDGES.map((b): [DemoXY, DemoXY] => [[b.x, 35], [b.x, RIVER_ROWS[0] - 1]]),
      ...RIVER_BRIDGES.map((b): [DemoXY, DemoXY] => [[b.x, RIVER_ROWS[1] + 1], [b.x, RIVER_ROWS[1] + 1]]),
      [[-20, 49], [30, 49]], [[-20, 54], [30, 54]], [[-20, 59], [30, 59]],
      // the river road runs on past the quarter to a dead end, where line 3's buses turn round (sim/busroute.ts)
      [[31, 49], [33, 49]],
      ...QUARTER_X.map((x): [DemoXY, DemoXY] => [[x, 50], [x, 58]]),
    ],
    bridges: RIVER_BRIDGES.map((b): DemoBridge => ({ id: b.id, name: b.name, from: [b.x, RIVER_ROWS[0]], to: [b.x, RIVER_ROWS[1]], style: b.style })),
    // line 3, there and back from the street down to the stone bridge, along the river road to its dead end: the buses
    // turn round there by themselves (docs/transit.md); stops on the river side of the road, facing no junction
    lines: [{ id: 'line-bus-3', mode: 'bus', number: 3, colour: 0x2fa37a, loop: false, vehicles: 2, stops: RIVER_LINE_STOPS }],
    // works to the west, then shops, offices and homes; the merged lots stand on these zones (their own tiles first)
    zones: [
      ...[0, 1, 2].map((i): DemoZone => ({ zone: 'industrial', rect: qblock(i) })),
      ...[3, 4].map((i): DemoZone => ({ zone: 'commercial', rect: qblock(i) })),
      ...[5, 6].map((i): DemoZone => ({ zone: 'office', rect: qblock(i) })),
      ...[7, 8, 9].map((i): DemoZone => ({ zone: 'residential', rect: qblock(i) })), // the last a ring of homes round a communal garden
      // the homes behind, for the quarter's jobs (the town has more jobs than people without them)
      ...QUARTER_X.slice(1).map((_x, i): DemoZone => ({ zone: 'residential', rect: qblock(i, 1) })),
    ],
    // one of every merged lot (zones.ts GROW_FORMS but the deep plots, which settle into block middles by themselves),
    // the north ones facing the river road, the south ones y = 54
    placements: [
      ...RIVER_LINE_STOPS.map((door, i): DemoPlacement => ({ id: `bus-stop-${21 + i}`, kind: 'bus-stop', door })),
      mergedAt('ind-plant', -19, 50, 2, 7),
      mergedAt('ind-works', -14, 50, 2, 5), mergedAt('ind-row', -14, 53, 0, 3),
      mergedAt('ind-depot', -9, 50, 2, 4),
      mergedAt('com-centre', -4, 50, 2, 6), mergedAt('com-parade', -4, 53, 0, 3),
      mergedAt('com-store', 1, 50, 2, 5), mergedAt('com-hotel', 3, 50, 2, 7),
      mergedAt('off-tower', 6, 50, 2, 5),
      mergedAt('off-hq', 11, 50, 2, 7), mergedAt('off-centre', 11, 53, 0, 3), // the supertall with the helipad on its crown
      mergedAt('res-estate', 16, 50, 2, 7), mergedAt('res-terrace', 16, 53, 0, 3),
      mergedAt('res-midrise', 21, 50, 2, 4), mergedAt('res-tower', 23, 50, 2, 7), mergedAt('res-block', 21, 52, 0, 5),
    ],
    spots: [
      { id: 'river', spot: 'river', name: 'The river', rect: [-20, RIVER_ROWS[0], 51, RIVER_ROWS[1] - RIVER_ROWS[0] + 1] },
      { id: 'level-crossing', spot: 'level-crossing', name: 'Level crossing', rect: [-20, 38, 1, 1], inspect: [-30, 35] },
    ],
  },
];

/** Tour order: placement, block, runway, track, junction and line ids, plus 'welcome' (the whole town). */
export const TOUR: string[] = [
  'welcome',
  'block-residential', 'block-commercial', 'block-office', 'block-industrial', 'block-deep', 'block-garden',
  'cab-office', 'takeaway', 'waste-depot', 'parcel-depot',
  'bus-depot', 'bus-stop', 'line-bus-1', 'line-bus-2', 'kerbside-bays', 'parking', 'multi-storey', 'park-and-ride', 'motorway', 'roundabout', 'flyover',
  'gp-surgery', 'health-centre', 'walk-in-centre', 'hospital', 'community-hospital', 'general-hospital', 'teaching-hospital',
  'police-box', 'police-post', 'police', 'divisional-station', 'police-hq', 'helipads',
  'fire-post', 'fire', 'large-fire-station', 'fire-hq',
  'handyman', 'yard', 'builders-depot', 'construction-company',
  'rail-halt', 'track-passenger', 'rail-station', 'line-rail-1', 'metro-entrance', 'line-metro-1', 'metro-station',
  'park', 'lakeside-park', 'botanical-garden',
  'cafe-cinema', 'cinema', 'multiplex',
  'studio-theatre', 'theatre', 'opera-house',
  'sports', 'leisure-centre', 'arena', 'stadium',
  'library', 'central-library', 'museum',
  'airport', 'runway',
  'block-estate', 'freight-yard-west', 'track-freight', 'freight-yard-east', 'line-freight-1',
  'river', 'level-crossing', 'bridge-girder', 'bridge-arch', 'bridge-bascule', 'bridge-suspension', 'line-bus-3',
  'ind-plant', 'ind-works', 'ind-row', 'ind-depot', 'com-centre', 'com-parade', 'com-store', 'com-hotel',
  'off-tower', 'off-hq', 'off-centre', 'res-estate', 'res-terrace', 'res-midrise', 'res-tower', 'res-block',
];

export const DEMOS: DemoDef[] = [
  { id: 'showcase', name: 'Showcase', slot: 90, sections: ['downtown', 'transport', 'civic', 'rail', 'leisure', 'airport', 'industry', 'riverside'],
    blurb: 'A lived-in town with one of every large building and every merged lot, both kinds of line, an airport every plane type flies to, helicopters, and a river with every style of bridge, all running. Take the guided tour.' },
  { id: 'transport', name: 'Transport demo', slot: 91, sections: ['downtown', 'transport', 'rail', 'airport', 'industry'],
    blurb: 'Buses, parking, rail, freight and the airport, in the same town.' },
  { id: 'leisure', name: 'Leisure demo', slot: 92, sections: ['downtown', 'leisure'],
    blurb: 'Parks, cinemas, theatres, sport and libraries, every size.' },
  { id: 'civic', name: 'Civic demo', slot: 93, sections: ['downtown', 'civic'],
    blurb: 'Health, police, fire and builders, every size.' },
  { id: 'london', name: 'London', slot: 94, sections: ['london-areas', 'london-landmarks', 'london-rail', 'london-buses', 'london-tube'], town: 'london', tour: LONDON_TOUR, view: LONDON_VIEW,
    blurb: 'A sample city on the shape of London: the Thames winding past Westminster and round the Isle of Dogs to the estuary, the City and Canary Wharf, the West End, homes from Kensington to Hackney and Brixton, docks and industry down river, the parks, the termini and Heathrow, and the Central, Northern and Jubilee lines underneath.' },
];
export const DEMO_BY_ID = new Map(DEMOS.map((d) => [d.id, d]));
export const isDemoId = (s: unknown): s is DemoId => typeof s === 'string' && DEMO_BY_ID.has(s as DemoId);
export const demoSections = (id: DemoId): DemoSection[] => {
  const d = DEMO_BY_ID.get(id), want = new Set(d?.sections ?? []);
  // London's sections are planned with its streets, on first use (london.ts)
  return (d?.town === 'london' ? londonSections() : SECTIONS).filter((s) => want.has(s.id));
};
/** Land a demo's owners hold: the town's owner, and London's boroughs (`sys:<borough>`, server/src/demo/london.ts). */
export const isDemoOwner = (owner: string | undefined) => owner === DEMO_OWNER || !!owner?.startsWith(`${DEMO_OWNER}:`);

// ---------------------------------------------------------------- linear surfaces and lines (not catalogue kinds)

/**
 * Tools that paint a linear surface instead of placing a catalogue kind. Typed against `Tool`, so a new surface
 * tool fails the typecheck here until it is listed, and `demo:check` then fails until the showcase uses it.
 */
type SurfaceTool = Exclude<Tool, 'road' | 'bulldoze' | KindToolId>;
export const SURFACE_TOOLS: Record<SurfaceTool, true> = { runway: true, rail: true, roundabout: true, flyover: true };
/** Line modes, plus freight (a rail line between yards); a new TransitMode fails the typecheck until listed. */
export const LINE_MODES: Record<TransitMode | 'freight', true> = { bus: true, rail: true, metro: true, freight: true };

interface Caption { title: string; what: string; how: string; facts: [string, string][] }
const money = (n: number) => `$${n.toLocaleString('en-GB')}`;
const techLine = (feature: string) => {
  const t = techFor(feature);
  return t ? `${t.name} (${TRACK_NAMES[t.track]} tier ${t.tier}, ${money(t.cost)})` : 'available from the start';
};
const SURFACE_CAPTIONS: Record<SurfaceTool, Caption> = {
  runway: {
    title: 'Runway',
    what: 'Six rows of runway, shoulders and taxiway behind an airport terminal. A finished terminal with an intact strip is an airport: planes fly a timetable worked out from the tiles alone, and every landing pays the owner a fee by type (business jet $16, turboprop $24, regional jet $32, narrow-body $40; on runways of 16 tiles or more a wide-body $72, and from 20 tiles a jumbo $90).',
    how: `Pick Runway (U) and drag a straight line of ${RUNWAY_MIN} to ${RUNWAY_MAX} tiles, ${TERMINAL_ROW} rows behind the terminal's back row, along its whole width (a line up to 3 rows off snaps on). 16 tiles or more gives a flight an hour. Bulldozing any strip tile grounds the airport until it is repainted.`,
    facts: [['Tool', 'Runway (U), drag'], ['Footprint', '6 rows wide, 10-32 long'], ['Needs', 'a terminal in front, own dry land, no roads'], ['Technology', techLine('runway')], ['Cost', `${money(RUNWAY_COST)} a strip tile (${money(RUNWAY_COST * 6)} per tile of length)`]],
  },
  rail: {
    title: 'Railway track',
    what: 'Track that trains run on. Each tile remembers the sides it joins, so tracks laid side by side stay apart; a station is served when the track runs along the row behind its platform, its whole width.',
    how: 'Pick Railway track in the Transport group and drag: the path runs along the longer axis first, then turns once. Start a drag on existing track to join it. Drag straight across a straight road (or lay a road straight across track) for a level crossing: barriers close ahead of each train and the traffic waits. Track does not cross water yet, and two lines may not share track (no signals).',
    facts: [['Tool', 'Railway track (no key), drag'], ['Footprint', '1 tile wide, up to 160 per drag'], ['Needs', 'own clear dry land; roads only straight across, as level crossings'], ['Technology', techLine('rail')], ['Cost', `${money(RAIL_COST)} a tile, ${money(RAIL_COST + CROSSING_COST)} a level crossing, joining is free`]],
  },
  roundabout: {
    title: 'Roundabout',
    what: 'A crossroads or T-junction rebuilt as a one-way ring round a planted island. Traffic goes round anticlockwise (it drives on the right), and a car coming in gives way to cars already on the ring, so there are no lights and no waiting for a green.',
    how: 'Pick Roundabout and click a junction. The four corner lots round it must be empty: the ring takes them. Side roads join in the middle of each side. Bulldozing any of it turns it back into a crossroads.',
    facts: [['Tool', 'Roundabout (no key), click a junction'], ['Footprint', '3×3: the junction becomes the island'], ['Needs', 'three or four roads meeting, empty corner lots'], ['Technology', techLine('roundabout')], ['Cost', money(ROUNDABOUT_COST)]],
  },
  flyover: {
    title: 'Flyover',
    what: 'One road lifted over the other on a short deck: the two never meet, so nobody waits at the crossing. Nobody can turn there either; drivers who want to plan round it.',
    how: 'Pick Flyover and click a crossroads whose road carries on straight both sides (the ramps go there). The east-west road goes over when it can; click the flyover again to put the other road on top. Bulldozing it leaves a crossroads.',
    facts: [['Tool', 'Flyover (no key), click a crossroads'], ['Footprint', 'the crossing tile, ramps on the tiles either side'], ['Needs', 'four roads meeting, plain straight road either side of the deck'], ['Technology', techLine('flyover')], ['Cost', `${money(FLYOVER_COST)}, swapping the deck is free`]],
  },
};
/** A bridge on the tour (not a tool of its own: the road tool lays it over water). */
const BRIDGE_CAPTION: Caption = {
  title: 'Bridge',
  what: 'A road bridge over the water. To the traffic it is plain straight road, cars and walkers both ways; nothing joins it from the side and nobody parks on it. Short crossings are mostly stone arches, middling ones arches or steel girders, long ones mostly suspension spans.',
  how: `Drag a road straight out from a road on one bank across the water to the far bank (Civil engineering): the bridge goes down when the drag reaches dry land in line, up to ${BRIDGE_MAX_SPAN} tiles of water. Both ends land on road; bends and junctions on the water are refused. Bulldozing any of the deck takes the whole bridge away.`,
  facts: [['Tool', 'Road (3), drag across the water'], ['Needs', 'road on both banks in line, open water between'], ['Technology', techLine('bridges')], ['Cost', `${money(BRIDGE_TILE_COST)} a tile of deck`]],
};
/** What each style is, added to a bridge stop's caption when the scenario names the style. A new style fails the typecheck here. */
const STYLE_NOTES: Record<keyof typeof BridgeStyle, string> = {
  Arch: 'This one is stone arches on piers, the usual choice for a short crossing.',
  Girder: 'This one is steel girders on concrete piers, for middling spans.',
  Suspension: 'This one hangs its deck from cables between two towers, the usual choice for the longest spans.',
  Bascule: 'This one lifts, drawn as Tower Bridge: a few times a day its two leaves rise for a sailing barge, the barriers close the road and the traffic waits, as at a level crossing. The road tool never picks this style; scenarios lay it.',
};
/** Tour stops on things that are neither a kind nor a drag. A spot names one of these. */
export type SpotKind = 'level-crossing' | 'river' | 'helipads' | 'tube-crossover' | MobileSpot;
const SPOT_CAPTIONS: Record<SpotKind, Caption> = {
  'cab-office': {
    title: 'Cab office',
    what: 'A minicab firm in a shopfront (about one shop lot in eleven), its lit sign in taxi yellow. Every member of its staff drives: cabs with a roof sign lit while for hire, waiting at the nearest station or airport rank, and private-hire drivers who log on from home in their own car and wait where the last fare ended. People without a car to hand, out for the night or arriving with a suitcase book the nearest free one when it beats walking, the bus and driving; they wait at the kerb, ride, and pay at the door.',
    how: 'Nothing to build: zone shops and some become cab offices. The tooltip shows its drivers on shift, the taxis out and the fares today; a driver\'s panel links to the cab they are out in.',
    facts: [['Fare', `$${TAXI.flagfall} + $${TAXI.perTile} a tile`], ['Split', `${Math.round(TAXI.officeCut * 100)}% to the office for a cab, ${Math.round(TAXI.platformCut * 100)}% for private hire`], ['Reach', `the nearest free taxi within ${TAXI.reach} tiles`], ['Rota', 'round the clock, four shifts']],
  },
  takeaway: {
    title: 'Takeaway',
    what: 'Every café, bar and restaurant cooks for delivery, and a quarter of their staff are riders on bicycles and mopeds. Homes order at lunch and dinner; shortly before an order is ready the nearest free rider is sent to the kitchen, takes up to three orders for homes close together, rides at the kerb edge past queues of cars, and steps off at each door. The meal is taxed like a visit and the venue\'s owner gets the delivery fee.',
    how: 'Nothing to build: zone shops. The tooltip shows its riders, the orders in the kitchen and the deliveries today.',
    facts: [['Orders', `${FOOD.lunchRate} a household at lunch, ${FOOD.dinnerRate} at dinner`], ['Meal', `$${FOOD.mealBase} + the venue's level, $${FOOD.fee} delivery, $${FOOD.tip} tip`], ['Riders', `${Math.round(MOBILE.riderShare * 100)}% of staff, ${Math.round(MOBILE.bicycleShare * 100)}% on bicycles`]],
  },
  'waste-depot': {
    title: 'Waste and recycling depot',
    what: 'About one industrial lot in twelve is the waste depot. Each 16-tile district has its own collection weekday: from 06:30 the depot sends a bin lorry per three collectors on shift round every home\'s kerb, where it stops while the loaders tip the wheelie bins (the traffic waits behind it); two weekdays later a sweeper drives the district\'s streets with its beacon flashing. The homes\' owner pays the depot\'s owner per home emptied.',
    how: 'Nothing to build: zone industry within reach of your homes. A home\'s tooltip shows its bin day and when its bins were last emptied; the depot\'s shows its crews, the lorries out and the homes emptied today.',
    facts: [['Reach', `districts within ${REFUSE.reach} tiles`], ['Fee', `$${REFUSE.feePerHome} a home emptied`], ['Crew', `${REFUSE.crew} a lorry, Monday to Friday from 06:00`]],
  },
  'parcel-depot': {
    title: 'Parcel depot',
    what: 'Warehouses, freight depots and distribution centres (and some other industry) are parcel depots, and a third of their staff drive courier vans. Homes order parcels through the day; vans leave in a morning and an afternoon wave with up to 14 parcels, pull up at each kerb in turn and come back. The depot\'s owner is paid per parcel.',
    how: 'Nothing to build: zone industry. The tooltip shows its couriers, the parcels waiting and those delivered today.',
    facts: [['Parcels', `${COURIER.parcelRate} a household a day`], ['Vans', `from ${COURIER.waves.map((h) => `${h}:00`).join(' and ')}, ${COURIER.vanLoad} parcels each`], ['Fee', `$${COURIER.fee} a parcel`]],
  },
  'level-crossing': {
    title: 'Level crossing',
    what: 'A road over railway track. Barriers come down across the road ahead of each train and the traffic waits until it has passed. Here the freight line\'s trains cross the street down to the river.',
    how: 'Drag track straight across a straight road, or lay a road straight across straight track. Not at a junction or a corner, not where the track turns, and no road may run along the track beside it.',
    facts: [['Tool', 'Railway track or Road, drag across'], ['Needs', 'straight track, a straight road carrying on both sides'], ['Technology', techLine('rail')], ['Cost', `${money(CROSSING_COST)} on top of the track`]],
  },
  river: {
    title: 'The river',
    what: `Open water: nothing is built on it and only bridges cross it, each up to ${BRIDGE_MAX_SPAN} tiles of water between road on both banks. The quarter beyond it is reached only over its four bridges, one of each style, so everyone who lives or works there crosses one.`,
    how: 'Water is part of the terrain: no tool makes or fills it. Drag a road straight across it to bridge it.',
    facts: [['Bridges here', 'stone arch, steel girder, bascule, suspension'], ['Longest bridge', `${BRIDGE_MAX_SPAN} tiles of water`], ['Technology', techLine('bridges')]],
  },
  helipads: {
    title: 'Helipads',
    what: 'Helicopters land on the helipads drawn on buildings: air ambulances at the hospitals, the police helicopter at police headquarters, executive flights on the tallest offices (the headquarters and the office tower across the river), and the royal flight at Buckingham Palace in the London demo. The timetable is worked out from the pads alone, so everyone sees the same flights.',
    how: 'Nothing to build: a hospital, police headquarters or tall office whose design has a pad brings its service. Hover a helicopter for its callsign and errand, click it for its crew, and press I or O to ride in the cockpit.',
    facts: [['Air ambulance', '2-5 flights a pad a day, some go on to a second hospital'], ['Police', '2-3 a day, an hour or more on the pad'], ['Executive', '1-3 a day, some hop between towers'], ['Royal', 'Buckingham Palace (London demo)']],
  },
  'tube-crossover': {
    title: 'Under Waterloo',
    what: 'The Northern and Jubilee lines meet under Waterloo: two entrances a short walk apart and from the rail station\'s door, so riders change between the two lines and the trains to Clapham Junction. Underground, lines never share a tunnel; where one must cross another it bores straight across it at a crossover, the north-south bore dipping under the east-west one. In the underground view (N) each line glows in its colour, platforms are lit, and the trains run in twin bores, out in one and back in the other.',
    how: `Nothing extra to build: save a line whose tunnel has to cross another's and the boring picks a crossover, straight across at right angles (${money(METRO.crossoverCost)} on top of the tunnel). Lines may not cross on a curve, a junction or a platform. A change between lines is a walk of up to ${TRANSIT.transferWalk} tiles between their stops.`,
    facts: [['Tool', 'lines panel (top bar); N for the view'], ['Crossover', `${money(METRO.crossoverCost)} on top of the tunnel`], ['Change walk', `${TRANSIT.transferWalk} tiles`], ['Technology', techLine('metrostation')]],
  },
};
const LINE_CAPTIONS: Record<TransitMode | 'freight', Omit<Caption, 'title'>> = {
  bus: {
    what: 'A bus line: the owner\'s stops in calling order, run there and back (or as a loop) by buses from a depot, one bus per driver on shift, 05:30 to 00:30. Riders whose car is at home weigh it against walking and driving, wait at the stop and pay $2 a ride to the owner.',
    how: 'Open the lines chip in the top bar, make a line, click your stops in order, pick loop or there and back and the buses wanted. Each stop needs a plain stretch of road beside it, not a junction; the depot\'s drivers must be able to reach the route.',
    facts: [['Tool', 'lines panel (top bar)'], ['Technology', techLine('lines')], ['Fare', '$2 a ride, children free, retirees half']],
  },
  rail: {
    what: 'A passenger rail line between stations. Trains run a timetable that is a pure function of the line and its route, 05:00 to 01:00, 40 riders a carriage; a there-and-back line runs one train, a loop as many as fit.',
    how: 'Lay track behind each platform and join it up, then open the lines panel and pick the stations in calling order. Consecutive stations must be joined by track a train can run without reversing.',
    facts: [['Tool', 'lines panel (top bar)'], ['Technology', techLine('railstation')], ['Fare', '$2 a ride']],
  },
  metro: {
    what: `An underground line. Each station is a kiosk or a hall on the surface with a platform straight below it; the tunnel between them is bored when the line is saved, under roads, blocks and rivers alike. Trains of tube cars (${METRO.carRiders} riders a car, as many cars as the shortest platform has tiles) run rail's timetable, 05:00 to 01:00, out in one bore and back in the other, so a there-and-back line runs many trains, and they are never in traffic. Riders change to a bus or a train at any stop within a ${TRANSIT.transferWalk}-tile walk of the entrance. Press N for the underground view.`,
    how: `Pick Underground station in the Transport group (Z and C turn the platform), put the entrances on your land beside a road, then open the lines panel and click them in calling order. The preview shows the new tunnel and its cost (${money(METRO.tunnelCost)} a tile, ${money(METRO.wetTunnelCost)} under water, ${money(METRO.crossoverCost)} more to cross another line); tunnel that already exists is free. Lines never share tunnel or a platform: they cross at right angles.`,
    facts: [['Tool', 'lines panel (top bar)'], ['Technology', techLine('metrostation')], ['Fare', '$2 a ride, children free, retirees half']],
  },
  freight: {
    what: 'A freight line between two yards. Deliveries from factories within 12 tiles of one yard to shops within 12 tiles of the other go by train when that is shorter: a truck to the yard, containers on the train, a truck for the last mile. The shipper pays the line owner $4 a container.',
    how: 'Put a freight yard near industry and another near shops, at least 14 tiles apart, join their docks with track and make a line that calls only at yards.',
    facts: [['Tool', 'lines panel (top bar)'], ['Technology', techLine('freightyard')], ['Fee', '$4 a container']],
  },
};

// ---------------------------------------------------------------- the tour

export interface TourStop {
  id: string;
  section: SectionId; sectionName: string;
  title: string; what: string; how: string;
  facts: [string, string][];
  /** camera: ground point, distance, yaw and pitch for the rig */
  focus: [number, number]; dist: number; yaw: number; pitch: number;
  /** kind id, for the swatch and the live tooltip */
  kind?: number;
  /** the structure, for its outline and marks */
  placed?: Placed;
  /** an area to outline (a block, a runway strip, the extent of a line) */
  rect?: DemoRect;
  /** tiles to mark (track drags, line stops) */
  path?: DemoXY[];
  /** the tile to ask the server about for live stats */
  inspect?: DemoXY;
  line?: { mode: TransitMode; number: number; colour: number };
  /** 'under': the tour turns the underground view on at this stop (a metro line, a spot under ground) */
  view?: 'under';
}

const kindIdOf = (s: string): number => (KIND_ID as Record<string, number>)[s] ?? 0;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const FAMILY_WORD: Record<string, string> = { residential: 'homes', commercial: 'shops', office: 'offices', industrial: 'works' };
/**
 * What a merged lot is and how it comes about (docs/buildings.md "Merged lots", "Block interiors"), for a growable kind
 * bigger than 1×1 with no blurb of its own: nobody places them, so their catalogue entries carry no tool text.
 */
function mergedText(k: KindManifest): Pick<Caption, 'what' | 'how'> | null {
  const f = GROW_FORMS.flat().find((g) => g.kindId === k.kindId);
  if (!f) return null;
  const lots = FAMILY_WORD[k.family] ?? k.family;
  const levels = f.minLevel === f.topLevel ? `level ${f.minLevel}` : `levels ${f.minLevel} to ${f.topLevel}`;
  return f.deep
    ? { what: `A ${k.name}: a frontage building that has grown back into the landlocked middle of its block, one lot wide and two deep with its door on the road (${levels}). The middle of a 4×4 block has no road of its own, so only the building in front can use it.`,
        how: 'Nobody places it. Zone a block all round and growth builds the middle into deep plots from the frontage; a block ringed by homes keeps its middle for a communal garden instead.' }
    : { what: `A ${k.name}: ${f.w}×${f.h} lots of ${lots} merged into one building by growth (${levels}). When a busy building wins the demand roll, it may take in the lots beside it of the same zone and owner, and everyone who lived or worked there moves into the new building.`,
        how: 'Nobody places it: zone the land and let it grow. A merge needs neighbouring lots of one zone and one owner, its door on a road, demand, and High-rise for levels 4 to 7. Each neighbourhood\'s ambition, a hash, caps how tall its streets get, so not every block turns into towers.' };
}

function kindCaption(k: KindManifest, door: DemoXY, rot: number, level?: number): Caption {
  const fp = footprintOf(k.kindId), multi = fp.w * fp.h > 1;
  const l = k.levels[0];
  const facts: [string, string][] = [];
  if (k.tool) facts.push(['Tool', `${k.tool.label}${k.tool.key ? ` (${k.tool.key})` : ''}`]);
  facts.push(['Footprint', `${fp.w}×${fp.h}${multi ? `, door faces ${FRONT_NAMES[rot]} here${k.tool ? ' (Z/C turn it)' : ''}` : ''}`]);
  facts.push(['Placed at', `${door[0]}, ${door[1]}`]);
  facts.push(['Technology', k.tool ? techLine(k.tool.id) : 'grows by itself']);
  if (k.flags.growable) facts.push(['Zoning', `${money(ZONE_COST)} a tile, then it grows with demand`]);
  else facts.push(['Cost', `${money(CIVIC_COST[k.kindId] ?? l.cost ?? 0)}${l.upkeep ? `, ${money(l.upkeep)} a day upkeep` : ''}`]);
  const lv = level ?? firstLevelOf(k.kindId), held = k.flags.growable ? capacityOf(k.kindId, lv) : l.capacity;
  if (held) facts.push([k.flags.growable && k.family === 'residential' ? 'Residents' : 'Jobs', `${held}${k.flags.growable ? ` at level ${lv}${level ? ' here' : ''}` : ''}`]);
  const text = k.blurb ? null : isGrowableId(k.kindId) && multi ? mergedText(k) : null;
  return { title: cap(k.tool?.label?.replace(/\s*\(.*\)$/, '') ?? k.name), what: k.blurb ?? text?.what ?? '', how: k.howTo ?? text?.how ?? '', facts };
}

/** Where the camera stands for a footprint: in front of the door, a little to the side, far enough to see it whole. */
function framing(x: number, y: number, w: number, h: number, rot = 0, far = 1): Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'> {
  const [fx, fy] = FRONT[rot & 3];
  const size = Math.max(w, h);
  return { focus: [x + w / 2, y + h / 2], dist: Math.min(150, Math.max(13, (9 + size * 2.6) * far)), yaw: Math.atan2(fx, fy) + 0.45, pitch: size > 12 ? 0.95 : 0.72 };
}
const bbox = (pts: readonly DemoXY[]): DemoRect => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0 + 1, Math.max(...ys) - y0 + 1];
};

/** The tour stops of a demo, in TOUR order, for the sections it seeds. Pure: the client and the checks call it. */
export function demoTour(id: DemoId): TourStop[] {
  const sections = demoSections(id);
  const out: TourStop[] = [];
  const d = DEMO_BY_ID.get(id)!;
  for (const sid of d.tour ?? TOUR) {
    if (sid === 'welcome') {
      out.push({ id: sid, section: 'downtown', sectionName: d.name, title: d.town ? `Welcome to ${d.name}` : `Welcome to the ${d.name.toLowerCase()}`, what: d.blurb,
        how: 'Next and Previous fly the camera from object to object; Autoplay runs the tour by itself. Hover anything for its live tooltip. You have every technology and unlimited funds here: buy land at the edge and try the tools. Reset demo puts the town back exactly as it was.',
        facts: sections.map((s) => [s.name, s.blurb.split(/(?<=\.)\s/)[0]] as [string, string]),
        ...(d.view ?? { focus: [4, 0], dist: 118, yaw: Math.PI / 4, pitch: 1.0 }) });
      continue;
    }
    for (const s of sections) {
      const base = { section: s.id, sectionName: s.name };
      const p = s.placements?.find((q) => (q.id ?? q.kind) === sid);
      if (p) {
        const kid = kindIdOf(p.kind), k = kindManifest(kid);
        if (!k) continue;
        const rot = p.rot ?? 0, placed = footprintOf(kid).w * footprintOf(kid).h > 1 ? placedFromDoor(kid, p.door[0], p.door[1], rot) : undefined;
        const area = placed ? [placed.ax, placed.ay, placed.w, placed.h] as const : [p.door[0], p.door[1], 1, 1] as const;
        // a tall landmark (the Shard is 9.6 tiles) is framed from further out so its top stays in view
        const tall = Math.max(...k.levels.flatMap((l) => l.designs.map((dz) => dz.height)));
        const c = kindCaption(k, p.door, rot, p.level);
        out.push({ id: sid, ...base, ...c, title: p.name ? `${c.title}: ${p.name}` : c.title, ...framing(area[0], area[1], area[2], area[3], rot, tall > 3 ? tall / 3 : 1), kind: kid, placed, rect: placed ? undefined : area, inspect: p.door });
        continue;
      }
      const b = s.blocks?.find((q) => q.id === sid);
      if (b) {
        const k = kindManifest(kindIdOf(b.kind));
        if (!k) continue;
        const c = kindCaption(k, b.inspect, 0);
        out.push({ id: sid, ...base, ...c, title: b.name, what: b.blurb ?? c.what, how: b.how ?? c.how, facts: c.facts.filter(([f]) => f !== 'Placed at' && f !== 'Footprint'), ...framing(b.rect[0], b.rect[1], b.rect[2], b.rect[3], 0, 1.15), kind: k.kindId, rect: b.rect, inspect: b.inspect });
        continue;
      }
      const r = s.runways?.find((q) => q.id === sid);
      if (r) {
        const terminal = s.placements?.find((q) => q.kind === 'airport');
        const pts: DemoXY[] = [r.from, r.to];
        const box = bbox(pts);
        // the strip is six rows across the dragged line; widen the box towards the terminal side
        const across = box[2] === 1 ? [box[0] - 4, box[1], 6, box[3]] as const : [box[0], box[1] - 4, box[2], 6] as const;
        out.push({ id: sid, ...base, ...SURFACE_CAPTIONS.runway, ...framing(across[0], across[1], across[2], across[3], terminal?.rot ?? 0, 0.9), rect: across, inspect: terminal?.door });
        continue;
      }
      const t = s.tracks?.find((q) => q.id === sid);
      if (t) {
        const pts = t.drags.flat();
        const box = bbox(pts);
        const station = s.placements?.find((q) => /rail-|freight-/.test(q.kind) && q.door[0] >= box[0] - 2 && q.door[0] <= box[0] + box[2] && Math.abs(q.door[1] - box[1]) < 6);
        out.push({ id: sid, ...base, ...SURFACE_CAPTIONS.rail, title: t.name, ...framing(box[0], box[1], box[2], box[3], 0, 0.75), rect: box, path: pts, inspect: station?.door });
        continue;
      }
      const j = s.junctions?.find((q) => q.id === sid);
      if (j) {
        const area = [j.at[0] - 2, j.at[1] - 2, 5, 5] as const;
        out.push({ id: sid, ...base, ...SURFACE_CAPTIONS[j.tool], ...framing(area[0], area[1], area[2], area[3], 0, 0.8), rect: j.tool === 'roundabout' ? [j.at[0] - 1, j.at[1] - 1, 3, 3] : [j.at[0], j.at[1], 1, 1], inspect: j.tool === 'roundabout' ? [j.at[0] + 1, j.at[1]] : j.at });
        continue;
      }
      const br = s.bridges?.find((q) => q.id === sid);
      if (br) {
        const box = bbox([br.from, br.to]), ns = box[2] === 1;
        const span = ns ? box[3] : box[2], area = ns ? [box[0], box[1] - 1, 1, span + 2] as const : [box[0] - 1, box[1], span + 2, 1] as const;
        const k = br.landmark ? kindManifest(kindIdOf(br.landmark)) : undefined;
        const style = BRIDGE_STYLE_NAMES[BridgeStyle[br.style ?? 'Arch']];
        // a landmark bridge reads as the landmark (its blurb) and works as any bridge (no staff, no visitors)
        const c = k ? { ...BRIDGE_CAPTION, what: k.blurb ?? BRIDGE_CAPTION.what } : br.style ? { ...BRIDGE_CAPTION, what: `${BRIDGE_CAPTION.what} ${STYLE_NOTES[br.style]}` } : BRIDGE_CAPTION;
        const facts: [string, string][] = [['Span', `${span} tiles of water, ${br.style ? style : 'the tool\'s choice of style'}`], ...c.facts];
        out.push({ id: sid, ...base, ...c, title: br.name, facts, ...framing(area[0], area[1], area[2], area[3], ns ? 1 : 0, k ? 1.2 : 0.8), kind: k?.kindId, rect: area, inspect: br.from });
        continue;
      }
      const sp = s.spots?.find((q) => q.id === sid);
      if (sp) {
        const [x, y, w, h] = sp.rect;
        out.push({ id: sid, ...base, ...SPOT_CAPTIONS[sp.spot], title: sp.name, ...framing(x, y, w, h, 0, w * h === 1 ? 0.8 : 0.5), rect: sp.rect, inspect: sp.inspect, view: sp.view });
        continue;
      }
      const l = s.lines?.find((q) => q.id === sid);
      if (l) {
        const mode = l.freight ? 'freight' : l.mode;
        const box = bbox(l.stops);
        const title = l.freight ? `Freight line ${l.number}` : l.mode === 'bus' ? `Bus line ${l.number}` : l.mode === 'metro' ? `${l.name ?? `Line ${l.number}`} (underground)` : `Rail line ${l.number}`;
        const facts: [string, string][] = [['Stops', `${l.stops.length}, ${l.loop ? 'a loop' : 'there and back'}`], [l.mode === 'bus' ? 'Buses' : 'Trains', `${l.vehicles}`], ...LINE_CAPTIONS[mode].facts];
        // a metro line's stop turns the underground view on (client/src/tour.ts)
        out.push({ id: sid, ...base, title, what: LINE_CAPTIONS[mode].what, how: LINE_CAPTIONS[mode].how, facts, ...framing(box[0], box[1], box[2], box[3], 0, 0.8), rect: box, path: [...l.stops], inspect: l.stops[0], line: { mode: l.mode, number: l.number, colour: l.colour }, ...(l.mode === 'metro' ? { view: 'under' as const } : {}) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- keeping the showcase complete

/**
 * What a feature's check reads of a seeded demo. demo:check (server/src/demo/check.ts) seeds every demo through the
 * real planners and fills this in from its World, so a feature is checked against what was built, not what was meant.
 */
export interface SeededDemo {
  /** buildings and structures by kind id, with how many of each (a structure counts once, at its door) */
  kinds: ReadonlyMap<number, number>;
  /** visit every tile the seeding wrote: x, y, tile word, aux byte, under byte (tunnels and platforms) */
  scan(f: (x: number, y: number, tile: number, aux: number, under: number) => void): void;
  aux(x: number, y: number): number;
  /** the helipads on its buildings (shared/src/helipads.ts chunkPads) */
  pads: readonly Pad[];
  /** its operational airports (a finished terminal with an intact runway) */
  airports: readonly Airport[];
  /** each saved bus line's turns as its buses plan them (BusService.plan): flat [x, y, kind, ...], kind 0 a dead end, 1 a junction mouth, 2 via the depot */
  busTurns: readonly { number: number; turns: readonly number[] }[];
  /** every saved line: its mode (freight lines are 'rail') and its stops (bus stop tiles, station doors) */
  lines: readonly { mode: TransitMode; number: number; stops: readonly DemoXY[] }[];
}

/**
 * Something interesting that is not a catalogue kind (a bridge style, a level crossing, a plane type, a helicopter
 * service, a merged lot), which a demo must show. `npm run demo:check` fails while any enabled feature is missing.
 */
export interface ShowcaseFeature {
  id: string;
  /** what it is, as the check's message names it */
  caption: string;
  /** the demo that must show it: the showcase unless `rule` says why it lives elsewhere */
  demo?: DemoId;
  rule?: string;
  /** the tour stop that shows it, a stop of that demo's tour */
  tour?: string;
  /** the scenario has it (pure, over the demo's sections: showcaseProblems) */
  scenario?: (sections: readonly DemoSection[]) => boolean;
  /** the seeded demo has it (demo:check) */
  seeded?: (d: SeededDemo) => boolean;
  /** not enforced yet: why, and what turns it on */
  todo?: string;
}

/** Days of timetable read from day 0: every plane type and helicopter service must fly within them. */
export const FEATURE_DAYS = 7;
const days = () => Array.from({ length: FEATURE_DAYS }, (_, d) => d);
const placedKind = (kind: string) => (ss: readonly DemoSection[]) => ss.some((s) => s.placements?.some((p) => p.kind === kind));
const anyTile = (d: SeededDemo, f: (x: number, y: number, t: number, a: number, u: number) => boolean) => { let hit = false; d.scan((x, y, t, a, u) => { if (!hit && f(x, y, t, a, u)) hit = true; }); return hit; };
/** A metro line calls within the change walk (TRANSIT.transferWalk, Manhattan) of a stop of another mode's line. */
const metroInterchange = (lines: readonly { mode: TransitMode; stops: readonly DemoXY[] }[]) => lines.some((m) => m.mode === 'metro' && m.stops.some(([x, y]) =>
  lines.some((o) => o.mode !== 'metro' && o.stops.some(([ox, oy]) => Math.abs(ox - x) + Math.abs(oy - y) <= TRANSIT.transferWalk))));

// Typed against the source unions, so a new bridge style, junction tool, plane type or helicopter service fails the
// typecheck here until it has an entry, and demo:check then fails until the showcase shows it.
const BRIDGE_TOUR: Record<keyof typeof BridgeStyle, string> = { Arch: 'bridge-arch', Girder: 'bridge-girder', Suspension: 'bridge-suspension', Bascule: 'bridge-bascule' };
const JUNCTION_TOUR: Record<DemoJunction['tool'], string> = { roundabout: 'roundabout', flyover: 'flyover' };
const PLANE_CAPTIONS: Record<PlaneType, string> = {
  turboprop: 'a turboprop', regional: 'a regional jet', narrowbody: 'a narrow-body jet', widebody: 'a wide-body jet', jumbo: 'a jumbo jet', bizjet: 'a business jet',
};
const HELI_SERVICES: Record<PadKind, Pick<ShowcaseFeature, 'caption' | 'tour' | 'demo' | 'rule'>> = {
  medical: { caption: 'air ambulances (a hospital helipad)', tour: 'helipads' },
  police: { caption: 'the police helicopter (police headquarters)', tour: 'helipads' },
  corporate: { caption: 'executive helicopters (a tall office with a rooftop pad)', tour: 'off-hq' },
  royal: { caption: 'the royal flight (Buckingham Palace)', tour: 'buckingham-palace', demo: 'london',
    rule: 'only Buckingham Palace has a royal pad, and landmarks stand in their own city\'s demo (the London landmarks in London), not the showcase' },
};

/** Every bascule span in the seeded demo lifts at least once in FEATURE_DAYS (shared/src/bridges.ts basculeLiftAt). */
function basculeLifts(d: SeededDemo): boolean {
  const spans: [number, number][] = [];
  d.scan((x, y, _t, a) => {
    if (!isBridgeAux(a) || bridgeStyle(a) !== BridgeStyle.Bascule) return;
    const sp = bridgeSpanAt(x, y, (qx, qy) => d.aux(qx, qy));
    if (sp && sp.x0 === x && sp.y0 === y) spans.push([x, y]);
  });
  return spans.length > 0 && spans.every(([x, y]) => {
    for (let h = 0; h < FEATURE_DAYS * 24; h += 0.25) if (!Number.isNaN(basculeLiftAt(basculeSeed(x, y), h))) return true;
    return false;
  });
}

/**
 * The feature registry: everything interesting the showcase must show that is not a catalogue kind (those are checked
 * by kind: every placeable kind, ladder rung, surface tool and line mode, below). A new feature lands with its entry
 * here, its placement in a section and its tour stop, or demo:check fails (docs/demo.md "Keeping it complete").
 */
export const SHOWCASE_FEATURES: readonly ShowcaseFeature[] = [
  // ---- bridges: every style, laid as the road tool lays them, carrying real traffic
  ...(Object.keys(BRIDGE_TOUR) as (keyof typeof BridgeStyle)[]).map((style): ShowcaseFeature => ({
    id: `bridge-${style.toLowerCase()}`, caption: `a ${BRIDGE_STYLE_NAMES[BridgeStyle[style]]}`, tour: BRIDGE_TOUR[style],
    scenario: (ss) => ss.some((s) => s.bridges?.some((b) => b.style === style)),
    seeded: (d) => anyTile(d, (_x, _y, _t, a) => isBridgeAux(a) && bridgeStyle(a) === BridgeStyle[style]) && (style !== 'Bascule' || basculeLifts(d)),
  })),
  { id: 'river', caption: 'a river (open water) that the bridges cross', tour: 'river',
    scenario: (ss) => ss.some((s) => s.water?.length), seeded: (d) => anyTile(d, (_x, _y, t) => terrainOf(t) === Terrain.Water) },
  // ---- rail and roads
  { id: 'level-crossing', caption: 'a level crossing (a road over track, with barriers)', tour: 'level-crossing',
    seeded: (d) => anyTile(d, (_x, _y, t, a) => isCrossing(t, a)) },
  ...(Object.keys(JUNCTION_TOUR) as DemoJunction['tool'][]).map((tool): ShowcaseFeature => ({
    id: tool, caption: `a ${tool}`, tour: JUNCTION_TOUR[tool], scenario: (ss) => ss.some((s) => s.junctions?.some((j) => j.tool === tool)),
  })),
  { id: 'motorway-gateway', caption: 'a motorway connection, the gateway newcomers, visitors and freight arrive through', tour: 'motorway',
    scenario: placedKind('motorway'), seeded: (d) => (d.kinds.get(MOTORWAY_KIND) ?? 0) > 0 },
  // ---- aircraft: every plane type is scheduled at a showcase airport within FEATURE_DAYS (the jumbo needs 20 tiles of runway)
  ...(Object.keys(PLANE_CAPTIONS) as PlaneType[]).map((type): ShowcaseFeature => ({
    id: `plane-${type}`, caption: `${PLANE_CAPTIONS[type]} landing${PLANE_TYPES[type].minRunway ? ` (a runway of ${PLANE_TYPES[type].minRunway}+ tiles)` : ''}`, tour: 'runway',
    seeded: (d) => d.airports.some((ap) => days().some((day) => timetable(ap, day).some((f) => f.type === type))),
  })),
  // ---- helicopters: every service has a pad, and flies within FEATURE_DAYS
  ...(Object.keys(HELI_SERVICES) as PadKind[]).map((kind): ShowcaseFeature => ({
    id: `heli-${kind}`, ...HELI_SERVICES[kind],
    seeded: (d) => d.pads.some((p) => p.kind === kind) && days().some((day) => heliTimetable(d.pads, day).some((f) => f.kind === kind)),
  })),
  // ---- districts: every merged lot (zones.ts GROW_FORMS, from the catalogue, so a new form is enforced at once) and the
  // block middles: the deep plots settle by themselves (sim/blocks.ts), the other forms are placed
  ...GROW_FORMS.flat().map((f): ShowcaseFeature => {
    const id = Object.keys(KIND_ID).find((k) => (KIND_ID as Record<string, number>)[k] === f.kindId)!;
    return f.deep
      ? { id, caption: `a ${f.name} (a block middle grown from the frontage)`, tour: 'block-deep', seeded: (d) => (d.kinds.get(f.kindId) ?? 0) > 0 }
      : { id, caption: `a ${f.name} (a merged lot)`, tour: id, scenario: placedKind(id), seeded: (d) => (d.kinds.get(f.kindId) ?? 0) > 0 };
  }),
  { id: 'block-garden', caption: 'a communal garden (the middle of a ring of homes)', tour: 'block-garden', seeded: (d) => (d.kinds.get(KIND_ID['block-garden']) ?? 0) > 0 },
  // ---- buses
  { id: 'bus-turnaround', caption: 'a bus line that turns round at a dead end', tour: 'line-bus-3',
    seeded: (d) => d.busTurns.some((l) => l.turns.some((_v, i) => i % 3 === 2 && l.turns[i] === 0)) },
  // ---- metro (docs/underground.md): the showcase runs one underground line, which changes to rail and a bus
  { id: 'metro-interchange', caption: 'a metro line with an interchange (an entrance within the change walk of a rail or bus stop)', tour: 'line-metro-1',
    scenario: (ss) => metroInterchange(ss.flatMap((s) => s.lines ?? [])), seeded: (d) => metroInterchange(d.lines) },
  // ---- mobile jobs (docs/mobile-jobs.md): each tour spot's door holds its role (fleet.ts hashes)
  ...MOBILE_SPOTS.map(([spot, x, y, name]): ShowcaseFeature => ({
    id: spot, caption: `a ${name.toLowerCase()} at (${x}, ${y}) (a mobile-job base)`, tour: spot,
    seeded: (d) => anyTile(d, (tx, ty, t, a) => tx === x && ty === y && mobileRoleAt(spot, x, y, t, a)),
  })),
  { id: 'metro-crossover', caption: 'a metro crossover (one line\'s tunnel straight across another\'s)', tour: 'tube-crossover', demo: 'london',
    rule: 'the showcase runs one underground line; lines cross in London, where the Tube\'s Central, Northern and Jubilee lines meet',
    seeded: (d) => anyTile(d, (_x, _y, _t, _a, u) => isTunnel(u) && !isPlatform(u) && underMask(u) === 15) },
];

/** Problems with the feature registry that the scenario alone shows: a feature or its tour stop missing from its demo. */
export function featureProblems(features: readonly ShowcaseFeature[] = SHOWCASE_FEATURES): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const tours = new Map<DemoId, Set<string>>();
  const tourOf = (id: DemoId) => tours.get(id) ?? tours.set(id, new Set(demoTour(id).map((t) => t.id))).get(id)!;
  for (const f of features) {
    if (ids.has(f.id)) out.push(`feature ${f.id} is listed twice`);
    ids.add(f.id);
    if (f.todo) continue;
    const demo = f.demo ?? 'showcase', where = demo === 'showcase' ? 'the showcase' : `the ${DEMO_BY_ID.get(demo)?.name ?? demo} demo`;
    if (demo !== 'showcase' && !f.rule) out.push(`feature ${f.id} lives in ${where} but gives no rule why it is not in the showcase`);
    if (!f.scenario && !f.seeded) out.push(`feature ${f.id} has nothing to check`);
    if (f.scenario && !f.scenario(demoSections(demo))) out.push(`${f.caption} (feature ${f.id}) is not in ${where}`);
    if (!f.tour) out.push(`feature ${f.id} has no tour stop`);
    else if (!tourOf(demo).has(f.tour)) out.push(`feature ${f.id}'s tour stop ${f.tour} is not on the tour of ${where}`);
  }
  return out;
}

/** Problems a seeded demo shows: an enabled feature of that demo whose `seeded` test fails on what was built. */
export function seededFeatureProblems(demo: DemoId, d: SeededDemo, features: readonly ShowcaseFeature[] = SHOWCASE_FEATURES): string[] {
  return features.filter((f) => !f.todo && (f.demo ?? 'showcase') === demo && f.seeded && !f.seeded(d))
    .map((f) => `${f.caption} (feature ${f.id}) is not in the seeded ${demo === 'showcase' ? 'showcase' : `${demo} demo`}`);
}


/**
 * What the showcase is missing, as messages (empty when complete). Every placeable kind (a tool, not a draft, not a
 * growing zone) must be placed, in particular every kind bigger than 1×1 and every size-ladder rung; every zoning tool
 * must have a grown block on the tour; every surface tool must be painted and every line mode run; every placement
 * kind must be on the tour; tour ids and placement ids must be unique and resolve; every registered feature must be in
 * its demo's scenario with a tour stop (featureProblems; their `seeded` tests run in demo:check).
 */
export function showcaseProblems(manifest: readonly KindManifest[] = MANIFEST): string[] {
  const out: string[] = [];
  const sections = demoSections('showcase');
  const placed = new Set<string>(), ids = new Set<string>(), blockKinds = new Set<string>();
  const dup = (id: string) => { if (ids.has(id)) out.push(`id ${id} is used twice`); ids.add(id); };
  for (const s of sections) {
    for (const p of s.placements ?? []) { placed.add(p.kind); dup(p.id ?? p.kind); }
    for (const b of s.blocks ?? []) { blockKinds.add(b.kind); dup(b.id); }
    for (const r of s.runways ?? []) dup(r.id);
    for (const t of s.tracks ?? []) dup(t.id);
    for (const j of s.junctions ?? []) dup(j.id);
    for (const b of s.bridges ?? []) dup(b.id);
    for (const l of s.lines ?? []) dup(l.id);
    for (const sp of s.spots ?? []) dup(sp.id);
  }
  // landmarks (docs/buildings.md "Landmarks") stand in their own city's demo (the London ones in London), not the showcase;
  // a landmark drawn over a bridge (Tower Bridge) is placed by laying that bridge
  const inCity = new Set(DEMOS.filter((d) => d.id !== 'showcase').flatMap((d) => demoSections(d.id).flatMap((s) => [
    ...(s.placements ?? []).map((p) => p.kind), ...(s.bridges ?? []).flatMap((b) => (b.landmark ? [b.landmark] : [])),
  ])));
  for (const k of manifest) {
    if (k.draft || !k.tool) continue;
    if (k.landmark) {
      if (!inCity.has(k.id)) out.push(`${k.id} (a ${(k.tags ?? []).join(', ')} landmark) is not placed in its city's demo`);
      continue;
    }
    if (k.flags.growable) {
      if (!blockKinds.has(k.id)) out.push(`zone ${k.id} (${k.tool.label}) has no grown block on the showcase tour`);
      continue;
    }
    if (!placed.has(k.id)) {
      const why = k.group ? `a rung of the ${k.group} ladder (tier ${k.tier})` : k.footprint && k.footprint.w * k.footprint.h > 1 ? `a ${k.footprint.w}×${k.footprint.h} structure` : 'a placeable kind';
      out.push(`${k.id} (${why}) is not placed in the showcase`);
    }
  }
  const all = (f: (s: DemoSection) => unknown[] | undefined) => sections.flatMap((s) => f(s) ?? []);
  for (const tool of Object.keys(SURFACE_TOOLS) as SurfaceTool[]) {
    const n = tool === 'runway' ? all((s) => s.runways).length : tool === 'rail' ? all((s) => s.tracks).length : all((s) => s.junctions?.filter((j) => j.tool === tool)).length;
    if (!n) out.push(`no ${tool} is painted in the showcase`);
  }
  const lines = all((s) => s.lines) as DemoLine[];
  for (const m of Object.keys(LINE_MODES) as (TransitMode | 'freight')[]) {
    // a mode whose station kinds are all drafts (the metro until it is placed in the showcase) is not asked for yet
    if (m !== 'freight' && MANIFEST.filter((k) => STOP_KINDS[k.kindId] === m).every((k) => k.draft)) continue;
    if (!lines.some((l) => (l.freight ? 'freight' : l.mode) === m)) out.push(`no ${m} line runs in the showcase`);
  }
  const tourIds = new Set(TOUR);
  if (tourIds.size !== TOUR.length) out.push('the tour lists an id twice');
  for (const id of TOUR) if (id !== 'welcome' && !ids.has(id)) out.push(`tour stop ${id} names nothing in the scenario`);
  const toured = new Set(demoTour('showcase').map((t) => t.kind).filter((k): k is number => k !== undefined));
  for (const kind of placed) if (!toured.has(kindIdOf(kind))) out.push(`${kind} is placed but no tour stop shows it`);
  out.push(...featureProblems());
  for (const s of sections) for (const l of s.lines ?? []) {
    const want = l.mode === 'bus' ? ['bus-stop'] : l.freight ? ['freight-yard'] : l.mode === 'metro' ? ['metro-entrance', 'metro-station'] : ['rail-halt', 'rail-station'];
    for (const st of l.stops) {
      const p = sections.flatMap((q) => q.placements ?? []).find((q) => q.door[0] === st[0] && q.door[1] === st[1]);
      if (!p || !want.includes(p.kind)) out.push(`${l.id} stops at (${st[0]}, ${st[1]}), which is not a ${want.join(' or ')} placement`);
    }
  }
  return out;
}
