import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';

/**
 * The airport terminal: an 8×7 multi-tile structure (docs/airport.md). Recipes are authored in tiles for the whole
 * footprint: x runs -4..4 along the runway, z -3.5..3.5, +z faces the road. The back four rows (z -3.5..0.5) are
 * the apron. The flight schedule (shared/src/flights.ts) parks planes there: two stands at x = ±1.65 (GATE_PITCH / 2),
 * main gear at z = -1.4 and noses stopping short of the building face at z = 0.6. The runway is painted separately,
 * five rows behind the back edge (shared/src/airport.ts). The middle rows hold the hall and the control tower, and
 * the front row holds the car park and the drop-off.
 */
const GATES = [-1.65, 1.65];
const APRON = 0xa4a8ad, ASPHALT = 0x3a3d44;

/** apron slab with stand markings, shared by both designs */
const apron = (): Op[] => [
  ['box', 7.96, 0.02, 3.98, 0, 0, -1.5, APRON],
  ['box', 7.9, 0.006, 0.04, 0, 0.02, 0.44, 'white'],                       // apron edge / service road line
  ['box', 7.9, 0.006, 0.03, 0, 0.02, -3.44, 'yellow'],                     // hold line at the taxiway
  ...GATES.flatMap((g): Op[] => [
    ['box', 0.05, 0.006, 3.3, g, 0.02, -1.75, 'yellow'],                   // lead-in line from the taxiway
    ['box', 0.5, 0.006, 0.05, g, 0.02, 0.3, 'yellow'],                     // stop bar under the nose
    ['box', 0.04, 0.006, 1.7, g - 1.45, 0.02, -1.45, 'white'],             // wingtip clearance lines
    ['box', 0.04, 0.006, 1.7, g + 1.45, 0.02, -1.45, 'white'],
    ['box', 0.16, 0.06, 0.1, g + 0.62, 0.02, 0.2, 'boxOrange'],            // baggage carts
    ['box', 0.16, 0.06, 0.1, g + 0.82, 0.02, 0.2, 'boxOrange'],
    ['box', 0.1, 0.05, 0.08, g + 0.45, 0.02, 0.2, 'charcoal'],             // tug
  ]),
  // floodlight masts at the apron corners
  ...[-3.85, 3.85].flatMap((x): Op[] => [['cyl', 0.016, 0.02, 0.9, x, 0.02, -3.3, 'steel', 5], ['box', 0.14, 0.05, 0.08, x, 0.92, -3.3, 'white']]),
];
/** landside: car park bays and the drop-off kerb on the front row (z 2.5..3.5) */
const carPark = (): Op[] => [
  ['box', 7.96, 0.02, 0.98, 0, 0, 3.0, ASPHALT],
  ['box', 7.96, 0.03, 0.06, 0, 0, 3.46, 'grey'],
  ...repeat(10, (i): Op => ['box', 0.02, 0.005, 0.32, -3.7 + i * 0.32, 0.02, 3.18, 'white']),  // bays either side of the drop-off
  ...repeat(7, (i): Op => ['box', 0.02, 0.005, 0.32, 1.7 + i * 0.32, 0.02, 3.18, 'white']),
];

export const terminal: KindDef = {
  id: 'airport', name: 'airport terminal', code: Zone.Airport, family: 'transport',
  flags: { civic: true, workplace: true },
  windows: 'civic',
  footprint: {
    w: 8, h: 7, door: [4, 6],
    marks: [
      { kind: 'apron', at: { edge: 'back', depth: 4 }, label: 'apron' },
      { kind: 'stand', at: [2, 2], label: 'stand 1' },
      { kind: 'stand', at: [5, 2], label: 'stand 2' },
      { kind: 'gate', at: { edge: 'back' }, label: 'airside edge (runway 5 tiles behind)' },
    ],
  },
  tool: { id: 'airport', key: 'J', label: 'Airport terminal (8×7)', color: '#5d8fc9' },
  blurb: 'An airport terminal with two gates and an apron for parked planes, staffed by ground crew on early and late shifts. With a runway behind it, it is an airport: planes land and take off on a timetable, and every landing pays the owner a fee.',
  howTo: 'Eight tiles across and seven deep: click the door tile (the middle of the front row) beside a road; Z and C turn it. Then paint a runway (U) of 10 or more tiles, five rows behind its back row and spanning its whole width. Needs Aviation.',
  occupation: {
    name: 'ground crew', rotate: true,
    // planes fly 05:00-21:30: an early and a late crew, check-in staff on days
    shifts: [{ start: 5, hours: 8, weight: 0.45 }, { start: 13, hours: 8, weight: 0.4 }, { start: 9, hours: 8, weight: 0.15 }],
    cycles: [[1, 1, 1, 1, 0, 0, 1], [1, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 1, 1, 0]],
  },
  lot: { wage: 22 },
  levels: [{
    capacity: 28, wage: 22, cost: 6000, upkeep: 140, work: 300, parking: { surface: 14, underground: 40 },
    attrs: { gates: 2, noise: 4, gateway: 'air', gatewayModes: ['taxi', 'foot'], arrivalsPerHour: 6 }, // plus a share of every plane's passengers (server sim/gateways.ts)
    designs: [
      { name: 'glass hall with jet bridges and a control tower', height: 2.42, ops: [
        ...apron(),
        ['box', 7.6, 0.04, 1.9, 0, 0, 1.5, 'stone'],                           // plinth under the hall
        ['box', 6.6, 0.62, 1.6, -0.4, 0.04, 1.5, 'glass', true],               // the glass hall
        ['box', 5.8, 0.5, 0.8, -0.4, 0.04, 1.75, 'pale', true],                // core behind the glass
        ...repeat(12, (i): Op => ['box', 0.04, 0.62, 0.03, -3.65 + i * 0.592, 0.04, 0.69, 'steel']), // mullions, airside
        ['box', 6.9, 0.05, 1.86, -0.4, 0.66, 1.5, 'silver'],                   // roof deck
        ['roof', 3.2, 0.2, 1.7, -0.4, 0.71, 1.5, 'silver'],                    // the vault over the departure hall
        ['box', 1.6, 0.16, 0.04, -0.4, 0.44, 2.33, 'signBlue'],                // landside sign
        ['box', 0.9, 0.06, 0.03, -0.4, 0.49, 2.36, 'white'],
        ...GATES.flatMap((g): Op[] => [
          ['cyl', 0.13, 0.13, 0.4, g - 0.4, 0.04, 0.76, 'steel', 10],          // rotunda at the hall
          ['box', 0.13, 0.12, 0.6, g - 0.4, 0.26, 0.36, 'pale', 'office'],     // jet bridge tunnel
          ['box', 0.2, 0.15, 0.12, g - 0.33, 0.25, 0.04, 'grey'],              // cab at the aircraft door
          ['box', 0.03, 0.26, 0.03, g - 0.4, 0.02, 0.12, 'dark'],              // drive column
          ['box', 0.12, 0.04, 0.06, g - 0.4, 0.02, 0.12, 'dark'],
        ]),
        ['box', 0.8, 0.5, 0.95, 3.45, 0.04, 1.5, 'pale', true],                // tower base building
        ['cyl', 0.16, 0.21, 1.3, 3.45, 0.54, 1.5, 'white', 12],                // tower shaft
        ['box', 0.58, 0.05, 0.58, 3.45, 1.79, 1.5, 'dark'],
        ['box', 0.56, 0.24, 0.56, 3.45, 1.84, 1.5, 'glassDark', true],         // the cab, lit at night
        ['box', 0.66, 0.05, 0.66, 3.45, 2.08, 1.5, 'dark'],
        ['cyl', 0.012, 0.012, 0.24, 3.45, 2.13, 1.5, 'steel', 4],
        ['box', 0.05, 0.05, 0.05, 3.45, 2.37, 1.5, 'red'],                     // obstruction light
        ...carPark(),
        ['box', 1.8, 0.04, 0.5, 0.5, 0.42, 2.66, 'silver'],                    // drop-off canopy over the door
        ...[-0.3, 1.3].map((x): Op => ['cyl', 0.02, 0.02, 0.42, x, 0, 2.86, 'steel', 6]),
      ] },
      { name: 'regional terminal with a brick tower and boarding stairs', height: 1.94, ops: [
        ...apron(),
        ['box', 6.0, 0.04, 1.86, -0.6, 0, 1.52, 'stone'],
        ['box', 5.4, 0.46, 1.4, -0.6, 0.04, 1.62, 'cream', true],              // the terminal building
        ['roof', 5.6, 0.32, 1.56, -0.6, 0.5, 1.62, 'terracotta'],
        ['box', 4.6, 0.36, 0.36, -0.6, 0.04, 0.8, 'glass', true],              // glazed departure lounge, airside
        ['box', 4.8, 0.03, 0.5, -0.6, 0.4, 0.8, 'slate'],                      // its canopy
        ['box', 1.2, 0.12, 0.04, -0.6, 0.3, 2.33, 'navy'],                     // landside sign
        ...GATES.flatMap((g): Op[] => [
          // a mobile boarding stair at each stand, beside the aircraft door
          ['box', 0.2, 0.06, 0.34, g - 0.42, 0.02, 0.28, 'white'],
          ...repeat(4, (i): Op => ['box', 0.12, 0.05, 0.08, g - 0.42, 0.06 + i * 0.05, 0.38 - i * 0.07, 'white']),
          ['box', 0.12, 0.02, 0.1, g - 0.42, 0.26, 0.06, 'white'],
          ['box', 0.06, 0.08, 0.12, g + 0.95, 0.02, 0.0, 'yellow'],             // a chocks-and-cones trolley
        ]),
        ['box', 0.26, 0.12, 0.62, 2.9, 0.02, 0.1, 'red'],                      // fuel bowser
        ['box', 0.26, 0.16, 0.18, 2.9, 0.02, -0.28, 'white'],
        ['box', 0.62, 1.3, 0.62, 3.2, 0.04, 1.62, 'brick', true],              // square brick tower
        ['box', 0.72, 0.04, 0.72, 3.2, 1.34, 1.62, 'stone'],
        ['box', 0.66, 0.26, 0.66, 3.2, 1.38, 1.62, 'glassDark', true],         // cab
        ['box', 0.76, 0.05, 0.76, 3.2, 1.64, 1.62, 'dark'],
        ['cyl', 0.012, 0.012, 0.22, 3.2, 1.69, 1.62, 'steel', 4],
        ['box', 0.05, 0.05, 0.05, 3.2, 1.89, 1.62, 'red'],
        ['cyl', 0.012, 0.012, 0.5, -3.75, 0.02, 0.2, 'steel', 4],             // windsock
        ['cone', 0.04, 0.2, -3.67, 0.46, 0.2, 'boxOrange', 6],
        ...carPark(),
        ['box', 1.0, 0.03, 0.4, 0.5, 0.36, 2.66, 'slate'],                     // porch over the door
        ['box', 0.5, 0.2, 0.12, -2.8, 0.02, 2.66, 'signBlue'],                 // bus shelter
      ] },
    ],
  }],
};
