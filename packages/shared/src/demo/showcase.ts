import { KIND_ID, MANIFEST, type KindToolId } from '../buildings/compiled';
import { ZONE_COST } from '../constants';
import type { KindManifest } from '../buildings/schema';
import type { Tool } from '../protocol';
import type { TransitMode } from '../transit';
import { placedFromDoor, footprintOf, FRONT, FRONT_NAMES, type Placed } from '../structures';
import { kindManifest, CIVIC_COST } from '../tile';
import { techFor, TRACK_NAMES } from '../tech';
import { RUNWAY_COST, RUNWAY_MIN, RUNWAY_MAX, TERMINAL_ROW } from '../airport';
import { RAIL_COST, CROSSING_COST } from '../rail';
import { ROUNDABOUT_COST, FLYOVER_COST } from '../junctions';
import { BRIDGE_TILE_COST, BRIDGE_MAX_SPAN, BRIDGE_STYLE_NAMES, BridgeStyle } from '../bridges';
import { londonSections, LONDON_TOUR, LONDON_VIEW } from './london';

/**
 * Demo maps (docs/demo.md): a planned, lived-in town where every large object in the catalogue is placed once and
 * running, for showing the game and teaching it. This file is the scenario as data. The server's demo seeder
 * (server/src/demo/seed.ts) builds it through the same planners players use; the client's tour panel
 * (client/src/tour.ts) flies the camera through it in `TOUR` order; `npm run demo:check` fails when a placeable kind,
 * a size-ladder rung, a linear surface or a line mode is missing from the showcase.
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

export type SectionId = 'downtown' | 'transport' | 'civic' | 'rail' | 'leisure' | 'airport' | 'industry'
  | 'london-areas' | 'london-landmarks' | 'london-rail' | 'london-buses';
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
export interface DemoLine {
  id: string; mode: TransitMode; number: number; colour: number;
  /** stops in calling order: bus stop tiles or station doors */
  stops: readonly DemoXY[];
  loop: boolean; vehicles: number;
  /** a rail line calling only at freight yards */
  freight?: boolean;
}
/**
 * grown land the tour stops at: a block of a zone, not placed (zones grow by themselves). `inspect` is a lot on the
 * block's edge: the four inner lots of a seedCity block have no road beside them and stay empty.
 */
export interface DemoBlock {
  id: string; kind: string; name: string; rect: DemoRect; inspect: DemoXY;
  /** the tour caption, in place of the kind's blurb (a named area of a sample city) */
  blurb?: string;
}
export interface DemoSection {
  id: SectionId; name: string; blurb: string;
  /** extra land outside the districts, owned by the town */
  land?: { name: string; rect: DemoRect }[];
  /** blocks cleared to bare ground before anything is placed */
  clear?: DemoRect[];
  /** blocks rezoned (built to the town's level) */
  zones?: DemoZone[];
  placements?: DemoPlacement[];
  runways?: DemoRunway[];
  tracks?: DemoTrack[];
  junctions?: DemoJunction[];
  bridges?: DemoBridge[];
  lines?: DemoLine[];
  blocks?: DemoBlock[];
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
    ],
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
  },
  {
    id: 'rail', name: 'Rail and freight',
    blurb: 'A halt among the homes of district A2 and a station beside the stadium, on a passenger line along the north edge, and two freight yards on a freight line along the south edge: one beside the industrial estate, one beside the shops it delivers to.',
    land: [{ name: 'North railway', rect: [-35, -41, 70, 6] }, { name: 'South railway', rect: [-35, 35, 70, 6] }],
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
    blurb: 'An airport terminal facing the east perimeter road, with a 16-tile runway five rows behind it: a flight an hour, landing fees for the owner.',
    land: [{ name: 'Airfield', rect: [35, -12, 15, 24] }],
    // homes across the road from the terminal, whose nearest jobs are the ground crew's
    zones: [block(2, 1, 3, 1), block(2, 1, 3, 2)].map((rect): DemoZone => ({ zone: 'residential', rect })),
    placements: [{ kind: 'airport', door: [35, 0], rot: 3 }],
    runways: [{ id: 'runway', from: [46, -8], to: [46, 7] }],
  },
  {
    id: 'industry', name: 'Industry',
    blurb: 'An industrial estate in district C1 beside the west freight yard: its factories send deliveries by train to the shops beside the east yard.',
    // the south-west corner of district C1 all factories, beside the west freight yard
    zones: [block(0, 2, 0, 3), block(0, 2, 1, 3), block(0, 2, 1, 2)].map((rect): DemoZone => ({ zone: 'industrial', rect })),
    blocks: [{ id: 'block-estate', kind: 'industrial', name: 'Industrial estate', rect: [-34, 24, 9, 9], inspect: [-34, 30] }],
  },
];

/** Tour order: placement, block, runway, track, junction and line ids, plus 'welcome' (the whole town). */
export const TOUR: string[] = [
  'welcome',
  'block-residential', 'block-commercial', 'block-office', 'block-industrial',
  'bus-depot', 'bus-stop', 'line-bus-1', 'line-bus-2', 'kerbside-bays', 'parking', 'multi-storey', 'park-and-ride', 'motorway', 'roundabout', 'flyover',
  'gp-surgery', 'health-centre', 'walk-in-centre', 'hospital', 'community-hospital', 'general-hospital', 'teaching-hospital',
  'police-box', 'police-post', 'police', 'divisional-station', 'police-hq',
  'fire-post', 'fire', 'large-fire-station', 'fire-hq',
  'handyman', 'yard', 'builders-depot', 'construction-company',
  'rail-halt', 'track-passenger', 'rail-station', 'line-rail-1',
  'park', 'lakeside-park', 'botanical-garden',
  'cafe-cinema', 'cinema', 'multiplex',
  'studio-theatre', 'theatre', 'opera-house',
  'sports', 'leisure-centre', 'arena', 'stadium',
  'library', 'central-library', 'museum',
  'airport', 'runway',
  'block-estate', 'freight-yard-west', 'track-freight', 'freight-yard-east', 'line-freight-1',
];

export const DEMOS: DemoDef[] = [
  { id: 'showcase', name: 'Showcase', slot: 90, sections: ['downtown', 'transport', 'civic', 'rail', 'leisure', 'airport', 'industry'],
    blurb: 'A lived-in town with one of every large building, both kinds of line and an airport, all running. Take the guided tour.' },
  { id: 'transport', name: 'Transport demo', slot: 91, sections: ['downtown', 'transport', 'rail', 'airport', 'industry'],
    blurb: 'Buses, parking, rail, freight and the airport, in the same town.' },
  { id: 'leisure', name: 'Leisure demo', slot: 92, sections: ['downtown', 'leisure'],
    blurb: 'Parks, cinemas, theatres, sport and libraries, every size.' },
  { id: 'civic', name: 'Civic demo', slot: 93, sections: ['downtown', 'civic'],
    blurb: 'Health, police, fire and builders, every size.' },
  { id: 'london', name: 'London', slot: 94, sections: ['london-areas', 'london-landmarks', 'london-rail', 'london-buses'], town: 'london', tour: LONDON_TOUR, view: LONDON_VIEW,
    blurb: 'A sample city on the shape of London: the Thames winding past Westminster and round the Isle of Dogs to the estuary, the City and Canary Wharf, the West End, homes from Kensington to Hackney and Brixton, docks and industry down river, the parks, the termini and Heathrow.' },
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
export const LINE_MODES: Record<TransitMode | 'freight', true> = { bus: true, rail: true, freight: true };

interface Caption { title: string; what: string; how: string; facts: [string, string][] }
const money = (n: number) => `$${n.toLocaleString('en-GB')}`;
const techLine = (feature: string) => {
  const t = techFor(feature);
  return t ? `${t.name} (${TRACK_NAMES[t.track]} tier ${t.tier}, ${money(t.cost)})` : 'available from the start';
};
const SURFACE_CAPTIONS: Record<SurfaceTool, Caption> = {
  runway: {
    title: 'Runway',
    what: 'Six rows of runway, shoulders and taxiway behind an airport terminal. A finished terminal with an intact strip is an airport: planes fly a timetable worked out from the tiles alone, and every landing pays the owner a fee (turboprop $24, narrow-body $40, business jet $16).',
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
}

const kindIdOf = (s: string): number => (KIND_ID as Record<string, number>)[s] ?? 0;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function kindCaption(k: KindManifest, door: DemoXY, rot: number): Caption {
  const fp = footprintOf(k.kindId), multi = fp.w * fp.h > 1;
  const l = k.levels[0];
  const facts: [string, string][] = [];
  if (k.tool) facts.push(['Tool', `${k.tool.label}${k.tool.key ? ` (${k.tool.key})` : ''}`]);
  facts.push(['Footprint', `${fp.w}×${fp.h}${multi ? `, door faces ${FRONT_NAMES[rot]} here (Z/C turn it)` : ''}`]);
  facts.push(['Placed at', `${door[0]}, ${door[1]}`]);
  facts.push(['Technology', k.tool ? techLine(k.tool.id) : 'grows by itself']);
  if (k.flags.growable) facts.push(['Zoning', `${money(ZONE_COST)} a tile, then it grows with demand`]);
  else facts.push(['Cost', `${money(CIVIC_COST[k.kindId] ?? l.cost ?? 0)}${l.upkeep ? `, ${money(l.upkeep)} a day upkeep` : ''}`]);
  if (l.capacity) facts.push([k.flags.growable && k.family === 'residential' ? 'Residents' : 'Jobs', `${l.capacity}${k.flags.growable ? ' at level 1' : ''}`]);
  return { title: cap(k.tool?.label?.replace(/\s*\(.*\)$/, '') ?? k.name), what: k.blurb ?? '', how: k.howTo ?? '', facts };
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
        out.push({ id: sid, ...base, ...kindCaption(k, p.door, rot), ...framing(area[0], area[1], area[2], area[3], rot, tall > 3 ? tall / 3 : 1), kind: kid, placed, rect: placed ? undefined : area, inspect: p.door });
        continue;
      }
      const b = s.blocks?.find((q) => q.id === sid);
      if (b) {
        const k = kindManifest(kindIdOf(b.kind));
        if (!k) continue;
        const c = kindCaption(k, b.inspect, 0);
        out.push({ id: sid, ...base, ...c, title: b.name, what: b.blurb ?? c.what, facts: c.facts.filter(([f]) => f !== 'Placed at' && f !== 'Footprint'), ...framing(b.rect[0], b.rect[1], b.rect[2], b.rect[3], 0, 1.15), kind: k.kindId, rect: b.rect, inspect: b.inspect });
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
        const c = k ? { ...BRIDGE_CAPTION, what: k.blurb ?? BRIDGE_CAPTION.what } : BRIDGE_CAPTION;
        const facts: [string, string][] = [['Span', `${span} tiles of water, ${br.style ? style : 'the tool\'s choice of style'}`], ...c.facts];
        out.push({ id: sid, ...base, ...c, title: br.name, facts, ...framing(area[0], area[1], area[2], area[3], ns ? 1 : 0, k ? 1.2 : 0.8), kind: k?.kindId, rect: area, inspect: br.from });
        continue;
      }
      const l = s.lines?.find((q) => q.id === sid);
      if (l) {
        const mode = l.freight ? 'freight' : l.mode;
        const box = bbox(l.stops);
        const title = l.freight ? `Freight line ${l.number}` : l.mode === 'bus' ? `Bus line ${l.number}` : `Rail line ${l.number}`;
        const facts: [string, string][] = [['Stops', `${l.stops.length}, ${l.loop ? 'a loop' : 'there and back'}`], [l.mode === 'bus' ? 'Buses' : 'Trains', `${l.vehicles}`], ...LINE_CAPTIONS[mode].facts];
        out.push({ id: sid, ...base, title, what: LINE_CAPTIONS[mode].what, how: LINE_CAPTIONS[mode].how, facts, ...framing(box[0], box[1], box[2], box[3], 0, 0.8), rect: box, path: [...l.stops], inspect: l.stops[0], line: { mode: l.mode, number: l.number, colour: l.colour } });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- keeping the showcase complete

/**
 * What the showcase is missing, as messages (empty when complete). Every placeable kind (a tool, not a draft, not a
 * growing zone) must be placed, in particular every kind bigger than 1×1 and every size-ladder rung; every zoning tool
 * must have a grown block on the tour; every surface tool must be painted and every line mode run; every placement
 * kind must be on the tour; tour ids and placement ids must be unique and resolve.
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
    if (!lines.some((l) => (l.freight ? 'freight' : l.mode) === m)) out.push(`no ${m} line runs in the showcase`);
  }
  const tourIds = new Set(TOUR);
  if (tourIds.size !== TOUR.length) out.push('the tour lists an id twice');
  for (const id of TOUR) if (id !== 'welcome' && !ids.has(id)) out.push(`tour stop ${id} names nothing in the scenario`);
  const toured = new Set(demoTour('showcase').map((t) => t.kind).filter((k): k is number => k !== undefined));
  for (const kind of placed) if (!toured.has(kindIdOf(kind))) out.push(`${kind} is placed but no tour stop shows it`);
  for (const s of sections) for (const l of s.lines ?? []) {
    const want = l.mode === 'bus' ? ['bus-stop'] : l.freight ? ['freight-yard'] : ['rail-halt', 'rail-station'];
    for (const st of l.stops) {
      const p = sections.flatMap((q) => q.placements ?? []).find((q) => q.door[0] === st[0] && q.door[1] === st[1]);
      if (!p || !want.includes(p.kind)) out.push(`${l.id} stops at (${st[0]}, ${st[1]}), which is not a ${want.join(' or ')} placement`);
    }
  }
  return out;
}
