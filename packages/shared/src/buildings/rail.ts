import type { KindDef, Op, OccupationDef, Color } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';

/**
 * Rail stations (docs/rail.md): two sub-kinds of the transport-hub family (code 15), told apart from the airport
 * terminal and the bus depot by their kind ids in the sub layer. Each is a multi-tile structure placed by its door,
 * which faces a road. The **back row** (the row furthest from the road) is the platform; railway track runs on the
 * row just outside the footprint behind it, along the station's whole width, and trains stop with their middle at
 * the station's middle (shared/src/rail.ts `stationStop`).
 *
 * Recipes are authored in tiles for the whole footprint: x runs along the platform (-w/2..w/2), z -h/2..h/2, +z
 * faces the road. The platform edge is z = -h/2, right against the track; the platform top is PLATFORM_H above the
 * ground, the height trains' floors are drawn at.
 */
const PH = 0.12; // platform height (render/trains.ts draws carriage floors level with it)
const ASPHALT = 0x3a3d44;

const staff: OccupationDef = {
  name: 'station staff', rotate: true,
  // trains run 05:00-01:00: an early turn, a late turn and an evening turn that closes the station
  shifts: [{ start: 5, hours: 8, weight: 0.45 }, { start: 13, hours: 8, weight: 0.4 }, { start: 17, hours: 8, weight: 0.15 }],
  cycles: [[1, 1, 1, 1, 0, 0, 1], [1, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 1, 1, 0]],
};

/** a platform slab along the back row of a footprint `w` wide and `h` deep, with its safety line and tactile strip */
const platform = (w: number, h: number, color: Color): Op[] => {
  const z0 = -h / 2;
  return [
    ['box', w - 0.04, PH, 0.94, 0, 0, z0 + 0.49, color],
    ['box', w - 0.04, 0.006, 0.05, 0, PH, z0 + 0.1, 'white'],        // safety line near the edge
    ['box', w - 0.04, 0.006, 0.06, 0, PH, z0 + 0.2, 'yellow'],       // tactile strip
    ['box', w - 0.04, 0.03, 0.03, 0, PH - 0.03, z0 + 0.02, 'charcoal'], // coping
  ];
};
/** lamp posts along the platform */
const lamps = (xs: number[], z: number, color: Color = 'steel'): Op[] => xs.flatMap((x): Op[] => [
  ['cyl', 0.012, 0.014, 0.42, x, PH, z, color, 5],
  ['box', 0.08, 0.03, 0.05, x, PH + 0.42, z, 'white', 'civic'],
]);
/** the station name board on two posts */
const nameBoard = (x: number, z: number, color: Color): Op[] => [
  ['cyl', 0.01, 0.01, 0.36, x - 0.22, PH, z, 'steel', 4], ['cyl', 0.01, 0.01, 0.36, x + 0.22, PH, z, 'steel', 4],
  ['box', 0.56, 0.12, 0.02, x, PH + 0.28, z, color], ['box', 0.4, 0.04, 0.021, x, PH + 0.32, z, 'white'],
];
/** steps and a ramp from the front row up onto the platform at x */
const steps = (x: number, z: number): Op[] => repeat(3, (i): Op => ['box', 0.5, 0.04 * (i + 1), 0.1, x, 0, z + 0.25 - i * 0.1, 'stone']);
const bench = (x: number, z: number): Op[] => [['box', 0.36, 0.03, 0.1, x, PH + 0.09, z, 'brown'], ['box', 0.36, 0.08, 0.02, x, PH + 0.1, z + 0.05, 'brown'], ['box', 0.03, 0.09, 0.08, x - 0.15, PH, z, 'dark'], ['box', 0.03, 0.09, 0.08, x + 0.15, PH, z, 'dark']];
const bikes = (x: number, z: number, n: number): Op[] => repeat(n, (i): Op => ['wheel', 0.05, 0.01, x + i * 0.08, 0.05, z, 'charcoal']);

export const railHalt: KindDef = {
  id: 'rail-halt', name: 'rail halt', code: Zone.Hub, kindId: 18, family: 'transport',
  flags: { civic: true, workplace: true },
  windows: 'civic',
  footprint: { w: 4, h: 2, door: [1, 1], marks: [{ kind: 'platform', at: { edge: 'back', depth: 1 }, label: 'platform, track behind' }] },
  tool: { id: 'railhalt', key: '[', label: 'Rail halt (4×2)', color: '#b0563d' },
  blurb: 'A small station with a four-tile platform and three staff. Trains of the lines that call here stop with their middle at the platform\'s middle, and riders get on and off.',
  howTo: 'Four tiles across and two deep: the door faces a road and the back row is the platform. Lay track along the row just behind it, the whole width, joined tile to tile; then add it to a rail line. Needs Rail.',
  occupation: staff,
  lot: { wage: 18 },
  levels: [{
    capacity: 3, wage: 18, cost: 1500, upkeep: 20, work: 300, parking: { surface: 2, underground: 6 },
    attrs: { platformTiles: 4, title: 'rail halt', gateway: 'rail', gatewayModes: ['foot', 'taxi'], arrivalsPerHour: 8 },
    designs: [
      { name: 'country halt: timber shelter, gravel path and a ticket hut by the road', height: 0.7, ops: [
        ['box', 3.96, 0.02, 0.98, 0, 0, 0.5, 'gravel'],                       // front row: gravel forecourt
        ...platform(4, 2, 'stone'),
        // timber shelter, open to the track
        ['box', 1.1, 0.34, 0.05, -0.75, PH, -0.18, 'timber'],
        ['box', 0.05, 0.34, 0.34, -1.28, PH, -0.34, 'timber'], ['box', 0.05, 0.34, 0.34, -0.22, PH, -0.34, 'timber'],
        ['roof', 1.3, 0.14, 0.56, -0.75, PH + 0.34, -0.4, 'roofGrey'],
        ...bench(-0.75, -0.3),
        ...lamps([-1.7, 0.2, 1.7], -0.8),
        ...nameBoard(1.0, -0.62, 'navy'),
        ...steps(-0.5, 0.0),                                                 // up from the door
        // ticket hut by the road
        ['box', 0.5, 0.34, 0.42, 0.6, 0.02, 0.5, 'cream', true],
        ['roof', 0.6, 0.16, 0.52, 0.6, 0.36, 0.5, 'terracotta'],
        ['box', 0.14, 0.2, 0.02, 0.6, 0.02, 0.715, 'door'],
        ...bikes(1.3, 0.75, 4),
        ['box', 0.02, 0.12, 0.96, -1.97, 0.02, 0.5, 'timber'], ['box', 0.02, 0.12, 0.96, 1.97, 0.02, 0.5, 'timber'], // fence ends
        ['cyl', 0.012, 0.012, 0.4, -1.6, 0.02, 0.9, 'steel', 4], ['box', 0.3, 0.14, 0.02, -1.6, 0.34, 0.91, 'red'], ['box', 0.2, 0.04, 0.021, -1.6, 0.39, 0.92, 'white'], // rail sign
      ] },
      { name: 'concrete halt: glass shelter, ticket machine, covered bike racks', height: 0.62, ops: [
        ['box', 3.96, 0.02, 0.98, 0, 0, 0.5, 'grey'],                        // paved forecourt
        ...platform(4, 2, 'pale'),
        // glass shelter on a steel frame
        ['box', 1.0, 0.32, 0.03, 0.7, PH, -0.2, 'glass'],
        ['box', 0.03, 0.32, 0.3, 0.21, PH, -0.35, 'glass'], ['box', 0.03, 0.32, 0.3, 1.19, PH, -0.35, 'glass'],
        ['box', 1.16, 0.03, 0.5, 0.7, PH + 0.32, -0.42, 'charcoal'],
        ...bench(0.7, -0.3),
        ['box', 0.12, 0.24, 0.08, -0.3, PH, -0.3, 'signBlue'], ['box', 0.08, 0.06, 0.01, -0.3, PH + 0.14, -0.255, 'glassDark'], // ticket machine
        ...lamps([-1.6, -0.4, 1.6], -0.85, 'charcoal'),
        ...nameBoard(-1.2, -0.62, 'red'),
        ['box', 0.6, 0.06, 0.5, -0.5, 0, 0.1, 'stone'], ['box', 0.6, 0.04, 0.2, -0.5, 0.06, -0.05, 'stone'], // ramp
        // bike shelter and a totem
        ['box', 1.1, 0.03, 0.4, 1.2, 0.3, 0.6, 'charcoal'], ['cyl', 0.012, 0.012, 0.3, 0.7, 0.02, 0.6, 'steel', 4], ['cyl', 0.012, 0.012, 0.3, 1.7, 0.02, 0.6, 'steel', 4],
        ...bikes(0.85, 0.6, 9),
        ['box', 0.12, 0.5, 0.12, -1.7, 0.02, 0.85, 'charcoal'], ['box', 0.1, 0.1, 0.125, -1.7, 0.4, 0.85, 'red'], ['box', 0.06, 0.03, 0.126, -1.7, 0.43, 0.85, 'white'],
        ['box', 0.8, 0.005, 0.02, 0.8, 0.02, 0.2, 'white'],                   // forecourt markings
      ] },
    ],
  }],
};

export const railStation: KindDef = {
  id: 'rail-station', name: 'rail station', code: Zone.Hub, kindId: 19, family: 'transport',
  flags: { civic: true, workplace: true },
  windows: 'civic',
  footprint: { w: 6, h: 3, door: [2, 2], marks: [{ kind: 'platform', at: { edge: 'back', depth: 1 }, label: 'platform, track behind' }] },
  tool: { id: 'railstation', key: ']', label: 'Rail station (6×3)', color: '#8c3b2b' },
  blurb: 'A town station with a six-tile platform, a concourse and a clock tower, staffed on early, late and evening turns. Longer platforms take longer trains: a train is as long as the shortest platform on its line allows.',
  howTo: 'Six tiles across and three deep, the door facing a road and the platform along the back row. Lay track along the row behind the platform for its whole width; consecutive stations of a line must be joined by track. Needs Rail.',
  occupation: staff,
  lot: { wage: 20 },
  levels: [{
    capacity: 12, wage: 20, cost: 5000, upkeep: 80, work: 300, parking: { surface: 8, underground: 24 },
    attrs: { platformTiles: 6, title: 'rail station', gateway: 'rail', gatewayModes: ['foot', 'taxi'], arrivalsPerHour: 24 },
    designs: [
      { name: 'brick station: clock tower, ironwork canopy over the platform, taxi forecourt', height: 1.65, ops: [
        ['box', 5.96, 0.02, 0.98, 0, 0, 1.0, ASPHALT],                        // forecourt on the front row
        ['box', 5.96, 0.03, 0.06, 0, 0, 1.46, 'grey'],                        // kerb
        ...repeat(6, (i): Op => ['box', 0.02, 0.005, 0.3, 1.0 + i * 0.32, 0.02, 1.2, 'white']), // taxi bays
        ...platform(6, 3, 'stone'),
        // canopy on cast-iron columns over the platform
        ...repeat(6, (i): Op => ['cyl', 0.022, 0.026, 0.48, -2.5 + i, PH, -0.85, 'green', 6]),
        ['box', 5.6, 0.04, 0.9, 0, PH + 0.48, -1.05, 'green'],
        ['box', 5.6, 0.07, 0.02, 0, PH + 0.42, -1.49, 'cream'],              // valance
        ...lamps([-2.8, 2.8], -1.2),
        ...bench(-1.5, -0.9), ...bench(1.5, -0.9),
        ...nameBoard(0, -0.75, 'navy'),
        // the station building across the middle row
        ['box', 4.4, 0.7, 1.0, -0.4, 0.02, 0.0, 'brick', true],
        ['roof', 4.6, 0.34, 1.16, -0.4, 0.72, 0.0, 'slate'],
        ['box', 4.42, 0.05, 1.02, -0.4, 0.46, 0.0, 'cream'],                  // string course
        ...repeat(4, (i): Op => ['box', 0.06, 0.4, 0.04, -2.2 + i * 1.2, 0.36, 0.43, 'stone']), // chimneys / pilasters at the front
        // clock tower
        ['box', 0.62, 1.2, 0.62, 2.4, 0.02, 0.1, 'brick', true],
        ['box', 0.7, 0.05, 0.7, 2.4, 1.22, 0.1, 'stone'],
        ['roof', 0.7, 0.36, 0.7, 2.4, 1.27, 0.1, 'slate'],
        ['box', 0.3, 0.3, 0.02, 2.4, 0.86, 0.42, 'white'], ['box', 0.02, 0.12, 0.022, 2.4, 0.98, 0.42, 'dark'], ['box', 0.1, 0.02, 0.022, 2.44, 1.0, 0.42, 'dark'],
        ['box', 0.3, 0.3, 0.02, 2.4, 0.86, -0.22, 'white'],
        // porch over the door and the entrance steps
        ['box', 1.2, 0.04, 0.5, -0.5, 0.5, 0.72, 'slate'],
        ['cyl', 0.02, 0.02, 0.5, -1.0, 0, 0.92, 'green', 6], ['cyl', 0.02, 0.02, 0.5, 0.0, 0, 0.92, 'green', 6],
        ['box', 0.6, 0.24, 0.02, -0.5, 0.02, 0.51, 'door'],
        ['box', 1.4, 0.16, 0.03, -0.5, 0.56, 0.74, 'navy'], ['box', 1.0, 0.05, 0.031, -0.5, 0.61, 0.76, 'white'], // name over the porch
      ] },
      { name: 'glass concourse: long steel canopy, glazed hall, bus and taxi forecourt', height: 1.2, ops: [
        ['box', 5.96, 0.02, 0.98, 0, 0, 1.0, ASPHALT],
        ['box', 5.96, 0.03, 0.06, 0, 0, 1.46, 'grey'],
        ['box', 2.4, 0.04, 0.4, 1.6, 0.02, 1.2, 'pale'],                      // island with a taxi shelter
        ['box', 1.6, 0.03, 0.3, 1.6, 0.36, 1.2, 'silver'], ['cyl', 0.012, 0.012, 0.32, 1.0, 0.04, 1.2, 'steel', 4], ['cyl', 0.012, 0.012, 0.32, 2.2, 0.04, 1.2, 'steel', 4],
        ...platform(6, 3, 'pale'),
        // a long steel canopy on V columns
        ...repeat(5, (i): Op => ['cyl', 0.02, 0.035, 0.56, -2.4 + i * 1.2, PH, -0.9, 'steel', 6]),
        ['box', 5.8, 0.03, 0.92, 0, PH + 0.56, -1.03, 'silver'],
        ['box', 5.8, 0.06, 0.03, 0, PH + 0.53, -1.47, 'charcoal'],
        ...lamps([-2.9, -1.2, 1.2, 2.9], -1.25, 'charcoal'),
        ...bench(-0.6, -0.95), ...bench(0.6, -0.95),
        ['box', 0.12, 0.24, 0.08, -2.0, PH, -0.8, 'signBlue'], ['box', 0.12, 0.24, 0.08, 2.0, PH, -0.8, 'signBlue'], // ticket machines
        ...nameBoard(-1.8, -0.7, 'red'),
        // the glazed concourse with a light roof and a steel frame
        ['box', 4.8, 0.62, 1.0, -0.3, 0.02, 0.0, 'glass', true],
        ['box', 4.4, 0.5, 0.6, -0.3, 0.02, -0.05, 'pale', 'office'],
        ...repeat(9, (i): Op => ['box', 0.04, 0.62, 0.03, -2.6 + i * 0.575, 0.02, 0.51, 'steel']),
        ['box', 5.0, 0.06, 1.12, -0.3, 0.64, 0.0, 'silver'],
        ['roof', 3.0, 0.18, 1.0, -0.3, 0.7, 0.0, 'silver'],
        ['box', 1.4, 0.18, 0.04, -0.5, 0.42, 0.53, 'red'], ['box', 1.0, 0.06, 0.041, -0.5, 0.48, 0.55, 'white'], // logo band over the door
        ['box', 0.8, 0.4, 0.02, -0.5, 0.02, 0.52, 'glassDark'],                // doors
        // a tall totem by the road and bike racks
        ['box', 0.14, 0.9, 0.14, 2.75, 0.02, 0.8, 'charcoal'], ['box', 0.12, 0.12, 0.145, 2.75, 0.76, 0.8, 'red'], ['box', 0.07, 0.03, 0.146, 2.75, 0.8, 0.8, 'white'],
        ...bikes(-2.7, 0.8, 7),
      ] },
    ],
  }],
};

/**
 * A freight yard (docs/rail.md): a 6×3 transport-hub sub-kind on the same plan as a station. The back row is the
 * loading dock along the track, where freight trains stand to load and unload; the front row is the truck gate on the
 * road. Delivery trucks from industry within YARD_CATCHMENT bring containers here when a freight line runs to a yard near
 * the shop, and the yard sends the last-mile trucks out (server/src/sim/rail.ts).
 */
const CONTAINERS: Color[] = ['boxBlue', 'boxOrange', 'boxGreen', 'red', 'navy', 'boxBlue', 'yellow', 'boxOrange'];
const stack = (x: number, z: number, n: number, k: number): Op[] => repeat(n, (i): Op => ['box', 0.5, 0.19, 0.24, x, 0.02 + i * 0.195, z, CONTAINERS[(k + i * 3) % CONTAINERS.length]]);
const lorry = (x: number, z: number, load: Color): Op[] => [
  ['box', 0.16, 0.16, 0.2, x + 0.34, 0.03, z, 'white'], ['box', 0.02, 0.07, 0.17, x + 0.425, 0.1, z, 'glassDark'],
  ['box', 0.56, 0.04, 0.2, x - 0.06, 0.05, z, 'charcoal'], ['box', 0.5, 0.18, 0.21, x - 0.06, 0.09, z, load],
  ['wheel', 0.04, 0.03, x + 0.33, 0.04, z - 0.09, 'charcoal'], ['wheel', 0.04, 0.03, x + 0.33, 0.04, z + 0.09, 'charcoal'],
  ['wheel', 0.04, 0.03, x - 0.22, 0.04, z - 0.09, 'charcoal'], ['wheel', 0.04, 0.03, x - 0.22, 0.04, z + 0.09, 'charcoal'],
];
export const freightYard: KindDef = {
  id: 'freight-yard', name: 'freight yard', code: Zone.Hub, kindId: 20, family: 'transport',
  flags: { civic: true, workplace: true },
  windows: 'factory',
  footprint: { w: 6, h: 3, door: [2, 2], marks: [
    { kind: 'dock', at: { edge: 'back', depth: 1 }, label: 'loading dock, track behind' },
    { kind: 'gate', at: { edge: 'front', from: 1, to: 3 }, label: 'truck gate' },
  ] },
  tool: { id: 'freightyard', key: '\\', label: 'Freight yard (6×3)', color: '#c2762e' },
  blurb: 'A container yard with a loading dock along the back. Delivery trucks from factories within 12 tiles leave containers here; a freight train takes them to another yard, and a truck delivers the last mile to the shop.',
  howTo: 'Six tiles across and three deep, the door and truck gate facing a road, the dock along the back row with track behind it. Put one near industry and another near shops at least 14 tiles away, and join them with a freight line.',
  occupation: {
    name: 'yard crew', rotate: true,
    // freight runs through the day and loads into the night: three turns, the night one light
    shifts: [{ start: 6, hours: 8, weight: 0.45 }, { start: 14, hours: 8, weight: 0.4 }, { start: 22, hours: 8, weight: 0.15 }],
    cycles: [[1, 1, 1, 1, 1, 0, 0], [0, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 1, 1, 1]],
  },
  lot: { wage: 21 },
  levels: [{
    capacity: 10, wage: 21, cost: 4000, upkeep: 60, work: 300, parking: { surface: 4, underground: 10 },
    attrs: { platformTiles: 6, title: 'freight yard', noise: 3 },
    designs: [
      { name: 'container terminal: a gantry crane over the dock, container stacks, a gatehouse on the road', height: 1.24, ops: [
        ['box', 5.96, 0.02, 2.96, 0, 0, 0, ASPHALT],
        ['box', 5.96, PH * 0.5, 0.94, 0, 0, -1.02, 'grey'],                     // the dock along the track
        ['box', 5.96, 0.006, 0.05, 0, PH * 0.5, -1.4, 'yellow'],
        // gantry crane spanning the dock and the first stack row
        ...[-2.4, 2.4].flatMap((x): Op[] => [-1.42, -0.12].map((z): Op => ['box', 0.08, 1.02, 0.08, x, 0.02, z, 'yellow'])),
        ...[-1.42, -0.12].map((z): Op => ['box', 4.96, 0.1, 0.1, 0, 1.02, z, 'yellow']),
        ...[-2.4, 2.4].map((x): Op => ['box', 0.1, 0.1, 1.4, x, 1.02, -0.77, 'yellow']),
        ['box', 0.46, 0.12, 1.42, 0.6, 1.12, -0.77, 'dark'],                   // trolley
        ['box', 0.2, 0.16, 0.2, 0.6, 0.94, -0.3, 'white', 'factory'],          // operator's cab
        ['cyl', 0.008, 0.008, 0.52, 0.6, 0.6, -0.95, 'dark', 4],
        ['box', 0.44, 0.04, 0.2, 0.6, 0.56, -0.95, 'yellow'],                  // spreader with a box on it
        ['box', 0.42, 0.17, 0.19, 0.6, 0.38, -0.95, 'boxBlue'],
        // stacks in the middle row
        ...stack(-2.2, -0.25, 3, 0), ...stack(-1.65, -0.25, 2, 1), ...stack(-1.1, -0.25, 3, 2), ...stack(1.6, -0.25, 1, 3), ...stack(2.2, -0.25, 2, 4),
        ...stack(-2.2, 0.08, 2, 5), ...stack(-1.65, 0.08, 1, 6), ...stack(1.6, 0.08, 3, 7), ...stack(2.2, 0.08, 2, 2),
        ...lorry(-0.4, 0.15, 'boxOrange'),
        // the gate: a gatehouse, a barrier, lamps
        ['box', 0.42, 0.3, 0.36, 1.7, 0.02, 1.0, 'white', true], ['box', 0.48, 0.03, 0.42, 1.7, 0.32, 1.0, 'charcoal'],
        ['box', 0.7, 0.03, 0.03, 0.95, 0.2, 1.25, 'red'], ['box', 0.06, 0.2, 0.06, 1.33, 0.02, 1.25, 'grey'],
        ...lorry(-1.6, 1.05, 'boxGreen'),
        ...[-2.85, 2.85].flatMap((x): Op[] => [['cyl', 0.016, 0.02, 1.1, x, 0.02, 1.35, 'steel', 5], ['box', 0.14, 0.05, 0.08, x, 1.12, 1.35, 'white', 'factory']]),
      ] },
      { name: 'goods yard: brick goods shed with a canopy over the dock, a siding, grain silos and a yard crane', height: 1.2, ops: [
        ['box', 5.96, 0.02, 2.96, 0, 0, 0, 'gravel'],
        ['box', 5.96, PH * 0.5, 0.94, 0, 0, -1.02, 'stone'],
        ['box', 5.96, 0.006, 0.05, 0, PH * 0.5, -1.4, 'white'],
        // a siding across the middle row: two rails on sleepers, a van standing on it
        ...[-0.086, 0.086].map((dz): Op => ['box', 5.7, 0.02, 0.02, 0, 0.02, 0.05 + dz, 'steel']),
        ...repeat(18, (i): Op => ['box', 0.05, 0.015, 0.26, -2.75 + i * 0.32, 0.02, 0.05, 'timber']),
        ['box', 0.58, 0.2, 0.2, 1.0, 0.06, 0.05, 'brown'], ['box', 0.6, 0.03, 0.22, 1.0, 0.26, 0.05, 'roofGrey'],
        // goods shed and its canopy over the dock
        ['box', 2.4, 0.55, 0.62, -1.5, 0.02, -0.4, 'brick', true],
        ['roof', 2.56, 0.24, 0.76, -1.5, 0.57, -0.4, 'slate'],
        ['box', 2.4, 0.03, 0.62, -1.5, 0.48, -1.12, 'slate'],
        ...[-2.6, -1.5, -0.4].map((x): Op => ['cyl', 0.015, 0.015, 0.42, x, PH * 0.5, -1.36, 'dark', 5]),
        ...[-2.1, -0.9].map((x): Op => ['box', 0.4, 0.3, 0.02, x, 0.06, -0.72, 'door']),
        // silos with a chute to the dock
        ...[1.85, 2.45].flatMap((x): Op[] => [['cyl', 0.24, 0.24, 0.95, x, 0.02, -0.75, 'silver', 12], ['cone', 0.25, 0.22, x, 0.97, -0.75, 'silver', 12]]),
        ['box', 0.08, 0.08, 0.4, 2.15, 0.6, -1.1, 'steel'],
        // a yard crane
        ['cyl', 0.04, 0.05, 0.85, 0.5, 0.06, -0.85, 'red', 6], ['box', 0.9, 0.05, 0.05, 0.85, 0.88, -0.85, 'red'],
        ['cyl', 0.006, 0.006, 0.45, 1.25, 0.44, -0.85, 'dark', 4], ['box', 0.3, 0.12, 0.2, 1.25, 0.3, -0.85, 'boxGreen'],
        // the office and a lorry at the gate
        ['box', 0.8, 0.36, 0.42, 1.9, 0.02, 1.05, 'cream', true], ['roof', 0.9, 0.16, 0.52, 1.9, 0.38, 1.05, 'terracotta'],
        ...lorry(-1.2, 1.05, 'brown'),
        ['box', 5.96, 0.08, 0.03, 0, 0.02, 1.47, 'grey'],
      ] },
    ],
  }],
};
