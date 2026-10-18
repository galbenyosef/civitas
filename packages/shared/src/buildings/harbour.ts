import type { Color, Design, KindDef, Op, OccupationDef } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';

/**
 * Harbours (docs/boats.md section 5): five transport-hub sub-kinds (code 15, kind ids 24-28) whose back rows stand over
 * water. `footprint.wet` is how many back rows are water and `footprint.fairwayClearance` the width class of the water
 * behind (1 narrow, 2 river, 3 open); structures.ts places them. The door is on the front row, on land, facing a road;
 * the last dry row is the quay. Ids 29-31 are reserved: a sea lock, a boatyard and a lifeboat station.
 *
 * Recipes are authored in tiles for the whole footprint: x -w/2..w/2, z -h/2..h/2, +z the road side, so the wet rows
 * run from z = -h/2 to -h/2 + wet. The water surface is y = 0 (chunkView draws water under wet tiles); pontoons float
 * on it, piles and quay walls stand on it. Boats are not part of a recipe: render/boats.ts draws them at the berths.
 *
 * These are drafts with two designs each (B7). The berths below are kind data the schedule (boats.ts) and the renderer
 * share, so a design leaves them clear: nothing but a quay wall, fenders and mooring posts stands where a boat lies, and
 * the cranes' booms stay up at 1.25 and over. The wet rows are recipe z < -h/2 + wet and the water surface is y = 0.
 * Each tile picks one of a kind's designs by hash, so two harbours of a kind rarely look alike.
 */

/**
 * A berth slot in footprint coordinates (the units of footprint marks): x 0..w across, y 0..h with y = h the front edge
 * and y = 0 the back edge, so wet rows lie at y < wet and the ferry pier's berth (outside the footprint) at y < 0.
 * `dir` is the way the bow points when the boat lies there, in footprint quarter turns (0 = +y towards the road, 1 = +x,
 * 2 = -y out to the water, 3 = -x); the boat may lie either way along it when `alongside`. `len` is the longest boat it
 * takes, in tiles.
 */
export interface BerthSlot {
  x: number; y: number; dir: 0 | 1 | 2 | 3; len: number;
  /** alongside a quay or pontoon, or bow-in between fingers */
  mode: 'alongside' | 'bowIn';
  label: string;
}

const WATER_STONE = 0x8d8a80; // quay wall below the coping
const PONTOON = 0xb9b2a2;
const ASPHALT = 0x3a3d44;

// ---------------------------------------------------------------- shared bits for the models

const TAR = 0x25211d; // tarred boards
const WEATHERED = 0x8a7a64; // silvered decking
const ROPE = 0xbfa56c;
const RUBBER = 0x1b1c20;
const NETC = 0x58867c; // drying nets
const HIVIS = 0xe8c21a; // port machinery yellow
const BUOY = [0xe0701f, 0xcb3b2d, 0xe6b734, 0xf6f2ea] as const;

/** a gull at rest, facing +x (f = 1) or -x: body, head, beak and folded wings; y is the perch */
const gull = (x: number, y: number, z: number, f: 1 | -1 = 1): Op[] => [
  ['box', 0.042, 0.018, 0.018, x, y, z, 'white'],
  ['box', 0.016, 0.014, 0.014, x + 0.026 * f, y + 0.008, z, 'white'],
  ['box', 0.01, 0.005, 0.006, x + 0.038 * f, y + 0.012, z, 'yellow'],
  ['box', 0.03, 0.006, 0.016, x - 0.004 * f, y + 0.018, z, 'grey'],
];
/** a ring buoy on a stand: a red disc with a white eye, facing +z; y is the ring's centre */
const lifebuoy = (x: number, y: number, z: number): Op[] => [
  ['lathe', x, y, z, 'crossRed', [0, 0, 0.022, 0, 0.022, 0.008], { seg: 12, axis: 'z' }],
  ['lathe', x, y, z + 0.004, 'white', [0, 0, 0.011, 0, 0.011, 0.008], { seg: 8, axis: 'z' }],
];
/** a lamp standard whose head glows after dark */
const lamp = (x: number, y: number, z: number, h: number, win: 'civic' | 'factory' = 'civic'): Op[] => [
  ['cyl', 0.007, 0.009, h, x, y, z, 'steel', 5],
  ['box', 0.045, 0.014, 0.03, x, y + h, z, 'white', win],
];
/** a parked car, nose along z */
const car = (x: number, z: number, c: Color, y = 0.02): Op[] => [
  ['box', 0.085, 0.03, 0.19, x, y, z, c],
  ['box', 0.07, 0.026, 0.1, x, y + 0.03, z - 0.01, 'glassDark'],
];
/** a bench with its back to z -1 or +1 (s) */
const bench = (x: number, y: number, z: number, w = 0.16): Op[] => [
  ['box', w, 0.012, 0.045, x, y + 0.03, z, 'timber'],
  ['box', w, 0.03, 0.01, x, y + 0.042, z - 0.022, 'timber'],
  ['box', 0.012, 0.03, 0.04, x - w / 2 + 0.012, y, z, 'dark'], ['box', 0.012, 0.03, 0.04, x + w / 2 - 0.012, y, z, 'dark'],
];
/** a rigged dinghy on a launching trolley, bow towards +z: hull, trolley wheels, mast, a taper for the sail */
const dinghy = (x: number, y: number, z: number, hull: Color, sail: Color, mast = 0.3): Op[] => [
  ['box', 0.05, 0.01, 0.1, x, y + 0.012, z - 0.02, 'dark'],
  ['wheel', 0.013, 0.008, x - 0.05, y + 0.013, z - 0.04, 'dark'], ['wheel', 0.013, 0.008, x + 0.05, y + 0.013, z - 0.04, 'dark'],
  ['box', 0.09, 0.03, 0.26, x, y + 0.022, z, hull],
  ['box', 0.094, 0.006, 0.264, x, y + 0.046, z, 'white'],
  ['cyl', 0.004, 0.004, mast, x, y + 0.052, z + 0.06, 'steel', 4],
  ['taper', 0.004, 0.13, 0.002, 0.012, mast - 0.07, x, y + 0.06, z - 0.01, sail, { shift: [0, 0.06] }],
  ['box', 0.004, 0.004, 0.14, x, y + 0.075, z - 0.01, 'steel'],
];
/** a rack of timber piles for the pier: [x, z] pairs */
const piles = (pts: [number, number][], h: number): Op[] => pts.map(([x, z]): Op => ['cyl', 0.018, 0.022, h, x, 0, z, 'timber', 5]);
const quayEdge = (w: number, z0: number): Op[] => [
  ['box', w, 0.06, 0.08, 0, 0, z0 + 0.04, WATER_STONE],
  ['box', w, 0.012, 0.1, 0, 0.06, z0 + 0.05, 'stone'],
];
const bollards = (x0: number, x1: number, z: number, n: number, y = 0.072): Op[] =>
  repeat(n, (i): Op => ['cyl', 0.014, 0.016, 0.035, x0 + ((x1 - x0) * i) / Math.max(1, n - 1), y, z, 'charcoal', 6]);
/** fenders hung along a pontoon or quay wall: black cylinders at x, from z0 in steps */
const fenders = (x: number, z0: number, step: number, n: number, y = 0.004): Op[] =>
  repeat(n, (i): Op => ['cyl', 0.008, 0.008, 0.024, x, y, z0 + i * step, RUBBER, 6]);
/** a round table with an umbrella over it */
const cafeTable = (x: number, z: number, y: number, c: Color): Op[] => [
  ['cyl', 0.005, 0.005, 0.03, x, y, z, 'steel', 4], ['cyl', 0.032, 0.032, 0.006, x, y + 0.03, z, 'white', 8],
  ['cyl', 0.003, 0.003, 0.09, x, y + 0.036, z, 'steel', 4], ['cone', 0.06, 0.03, x, y + 0.096, z, c, 8],
];

const staff = (name: string, shifts: OccupationDef['shifts'], cycles: number[][], rotate = true): OccupationDef => ({ name, rotate, shifts, cycles });
const WEEK = [[1, 1, 1, 1, 1, 0, 0], [0, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 1, 1, 1]];

// ---------------------------------------------------------------- jetty (24): 1×2, the back tile over water

/** the planks run down x -0.11..0.11 and the piles stay inside them: the berths either side keep |x| > 0.13 */
const JETTY_DESIGNS: Design[] = [
  { name: 'timber jetty on piles with a boathouse, slipway, ladder and lifebuoy', height: 0.42, ops: [
    ['box', 0.96, 0.02, 0.96, 0, 0, 0.5, 'gravel'],                                   // hardstanding on the bank
    ['box', 0.3, 0.018, 0.16, 0.3, 0.02, 0.42, 'stone'], ['box', 0.3, 0.012, 0.16, 0.3, 0.02, 0.26, 'stone'], ['box', 0.3, 0.006, 0.16, 0.3, 0.02, 0.1, 'stone'], // the slipway, stepping down to the water
    ['box', 0.014, 0.02, 0.48, 0.17, 0.02, 0.26, 'steel'], ['box', 0.014, 0.02, 0.48, 0.43, 0.02, 0.26, 'steel'],
    ['box', 0.46, 0.26, 0.4, -0.2, 0.02, 0.62, 'timber', true, { name: 'boathouse', facade: { storeys: 1, bays: 3, sideBays: 1 } }],
    ['roof', 0.52, 0.14, 0.46, -0.2, 0.28, 0.62, 'slate'],
    ['garage', 'boathouse', 'front', 1], ['door', 'boathouse', 'front', 2],
    ...gull(-0.2, 0.42, 0.62),
    ['box', 0.1, 0.03, 0.26, 0.28, 0.02, 0.78, 'red'], ['box', 0.012, 0.01, 0.26, 0.28, 0.05, 0.78, 'timber'],       // dinghies drawn up, upside down
    ['box', 0.1, 0.03, 0.24, 0.4, 0.02, 0.8, 'boxBlue'], ['box', 0.012, 0.01, 0.24, 0.4, 0.05, 0.8, 'timber'],
    ['cyl', 0.008, 0.008, 0.16, -0.42, 0.02, 0.9, 'timber', 5], ['box', 0.14, 0.06, 0.012, -0.42, 0.1, 0.9, 'signBlue'], ['box', 0.1, 0.012, 0.014, -0.42, 0.124, 0.9, 'white'], // hire board
    ...BUOY.map((c, i): Op => ['cyl', 0.018, 0.018, 0.04, -0.44 + (i % 2) * 0.04, 0.02 + (i > 1 ? 0.04 : 0), 0.2 + (i % 2) * 0.01, c, 7]),
    ...quayEdge(0.98, -0.02),
    ...piles([-0.12, -0.4, -0.68, -0.94].flatMap((z): [number, number][] => [[-0.1, z], [0.1, z]]), 0.05),
    ['box', 0.22, 0.02, 0.96, 0, 0.05, -0.5, WEATHERED],                              // the planks
    ...repeat(23, (i): Op => ['box', 0.222, 0.002, 0.006, 0, 0.07, -0.06 - i * 0.04, 'charcoal']),
    ['box', 0.012, 0.022, 0.96, -0.116, 0.048, -0.5, 'timber'], ['box', 0.012, 0.022, 0.96, 0.116, 0.048, -0.5, 'timber'], // the rubbing strakes
    ...[-0.3, -0.55, -0.8].flatMap((z): Op[] => [['box', 0.02, 0.01, 0.012, -0.098, 0.07, z, 'steel'], ['box', 0.02, 0.01, 0.012, 0.098, 0.07, z, 'steel']]), // mooring cleats
    ['cyl', 0.012, 0.014, 0.09, 0.09, 0.07, -0.95, 'timber', 6], ...gull(0.09, 0.16, -0.95, -1),
    ...lamp(-0.09, 0.07, -0.95, 0.28),
    ['box', 0.004, 0.075, 0.004, -0.02, 0, -0.99, 'steel'], ['box', 0.004, 0.075, 0.004, 0.02, 0, -0.99, 'steel'],     // the ladder down the end
    ...[0.015, 0.035, 0.055].map((y): Op => ['box', 0.04, 0.004, 0.004, 0, y, -0.99, 'steel']),
    ['cyl', 0.005, 0.005, 0.12, 0.09, 0.07, -0.13, 'white', 4], ...lifebuoy(0.09, 0.15, -0.12),
  ] },
  { name: 'floating hire pontoon on a gangway with a tackle hut, racked dinghies and a flagstaff', height: 0.42, ops: [
    ['box', 0.96, 0.02, 0.96, 0, 0, 0.5, 'sand'],                                     // the foreshore walk
    ['box', 0.42, 0.24, 0.32, -0.22, 0.02, 0.68, 'green', 'shop', { name: 'hut', facade: { storeys: 1, bays: 3, sideBays: 1 } }],
    ['box', 0.48, 0.02, 0.38, -0.22, 0.26, 0.68, 'corrugated'],
    ['awning', 'hut', 'front', 0, 2, 'red'], ['door', 'hut', 'front', 2],
    ['box', 0.1, 0.05, 0.05, -0.4, 0.02, 0.9, 'white'], ['box', 0.1, 0.012, 0.055, -0.4, 0.07, 0.9, 'boxBlue'],     // ice chest and bait freezer by the hut
    ...bench(-0.1, 0.02, 0.92), ['cyl', 0.02, 0.018, 0.05, 0.02, 0.02, 0.9, 'green', 8],
    ...[0.62, 0.82].map((z): Op => ['cyl', 0.008, 0.008, 0.12, 0.27, 0.02, z, 'timber', 5]),                // the dinghy rack
    ...[0.62, 0.82].map((z): Op => ['cyl', 0.008, 0.008, 0.12, 0.4, 0.02, z, 'timber', 5]),
    ['box', 0.16, 0.012, 0.26, 0.335, 0.05, 0.72, 'timber'], ['box', 0.16, 0.012, 0.26, 0.335, 0.1, 0.72, 'timber'],
    ['box', 0.09, 0.028, 0.24, 0.3, 0.062, 0.72, 'red'], ['box', 0.09, 0.028, 0.24, 0.37, 0.062, 0.72, 'white'],
    ['box', 0.09, 0.028, 0.24, 0.3, 0.112, 0.72, 'boxBlue'], ['box', 0.09, 0.028, 0.24, 0.37, 0.112, 0.72, 'yellow'],
    ['cyl', 0.01, 0.012, 0.36, 0.37, 0.02, 0.3, 'white', 6], ['box', 0.1, 0.05, 0.004, 0.42, 0.34, 0.3, 'red'],  // flagstaff and its pennant
    ...gull(0.37, 0.38, 0.3, -1),
    ...quayEdge(0.98, -0.02),
    ['box', 0.1, 0.012, 0.3, 0, 0.02, -0.12, 'steel'],                                 // the hinged gangway
    ...[-0.056, 0.056].flatMap((x): Op[] => [['box', 0.006, 0.05, 0.006, x, 0.032, -0.02, 'steel'], ['box', 0.006, 0.05, 0.006, x, 0.032, -0.26, 'steel'], ['box', 0.006, 0.006, 0.25, x, 0.08, -0.14, 'steel']]),
    ['box', 0.22, 0.03, 0.74, 0, 0, -0.6, 0xe4dfd2],                                  // the floating pontoon
    ['box', 0.214, 0.004, 0.734, 0, 0.03, -0.6, 'pale'],
    ...repeat(8, (i): Op => ['box', 0.216, 0.002, 0.008, 0, 0.034, -0.27 - i * 0.1, 'grey']),
    ...fenders(-0.115, -0.3, 0.14, 5), ...fenders(0.115, -0.3, 0.14, 5),
    ['cyl', 0.016, 0.018, 0.16, 0, 0, -0.97, 'timber', 6], ...gull(0, 0.16, -0.97),         // a guide pile at the head
    ...lamp(0, 0.034, -0.9, 0.2),
    ...lifebuoy(0.09, 0.09, -0.3), ['cyl', 0.005, 0.005, 0.06, 0.09, 0.034, -0.3, 'white', 4],
    ['box', 0.02, 0.01, 0.012, -0.098, 0.034, -0.45, 'steel'], ['box', 0.02, 0.01, 0.012, 0.098, 0.034, -0.45, 'steel'],
    ['box', 0.02, 0.01, 0.012, -0.098, 0.034, -0.75, 'steel'], ['box', 0.02, 0.01, 0.012, 0.098, 0.034, -0.75, 'steel'],
  ] },
];

export const jetty: KindDef = {
  id: 'jetty', name: 'jetty', code: Zone.Hub, kindId: 24, family: 'transport',
  flags: { civic: true, workplace: true, leisureReady: true }, draft: true,
  windows: 'civic',
  footprint: { w: 1, h: 2, door: [0, 1], wet: 1, fairwayClearance: 1, marks: [
    { kind: 'berth', at: [0, 0], label: 'two boat slots by the planks' },
    { kind: 'quay', at: [0, 1], label: 'slipway' },
  ] },
  tool: { id: 'jetty', key: '', label: 'Jetty (1×2)', color: '#7aa6c2' },
  group: 'harbour', tier: 1,
  blurb: 'A timber jetty with a slipway and a boathouse. One or two dinghies or a motor cruiser are based here, and people come down to hire a boat for an outing.',
  howTo: 'One tile on the bank facing a road and one over the water behind it, which must be open water at least a channel wide. Needs Harbours.',
  occupation: staff('boat hirer', [{ start: 9, hours: 8, weight: 0.5 }, { start: 13, hours: 8, weight: 0.5 }], WEEK),
  lot: { wage: 14 },
  attrs: { harbour: 'jetty', title: 'jetty' },
  levels: [{
    capacity: 2, wage: 14, cost: 600, upkeep: 8, work: 150, parking: { surface: 1, underground: 0 },
    designs: JETTY_DESIGNS,
  }],
};

// ---------------------------------------------------------------- marina (25): 4×4, two back rows over water

/** fingers off the spine at x = 0, each 0.66 long, between the berth rows of `MARINA_BERTHS` (z = -1.65 + 0.35 i); the tips are 12 finger z's */
const FINGER_Z = Array.from({ length: 6 }, (_, i) => -1.825 + i * 0.35);
const fingers = (c: Color): Op[] => [-1, 1].flatMap((side) => FINGER_Z.map((z): Op => ['box', 0.66, 0.025, 0.05, side * 0.45, 0, z, c]));
/** the spine and its extras, shared by both designs: spine, gangway, lamps and power pedestals, a fuel dock at the far end */
const marinaWater = (deck: Color, tip: 'pile' | 'post'): Op[] => [
  ['box', 0.2, 0.03, 0.4, 0, 0.03, -0.2, 'steel'],                                  // gangway down to the pontoons
  ...[-0.1, 0.1].map((x): Op => ['box', 0.006, 0.05, 0.4, x, 0.06, -0.2, 'steel']),
  ['box', 0.24, 0.03, 1.9, 0, 0, -1.03, deck],                                      // the spine
  ...fingers(deck),
  ...[-1.9, -1.2, -0.5].flatMap((z) => piles([[-0.14, z], [0.14, z]], 0.1)),         // piles the spine rides on
  ...[-0.55, -0.85, -1.15, -1.45, -1.75].flatMap((z, i): Op[] => [['box', 0.02, 0.045, 0.02, i % 2 ? 0.1 : -0.1, 0.03, z, 'white'], ['box', 0.022, 0.012, 0.022, i % 2 ? 0.1 : -0.1, 0.075, z, i % 2 ? 'boxBlue' : 'boxGreen']]), // power and water pedestals
  ...[-0.4, -1.1, -1.7].flatMap((z) => lamp(0, 0.03, z, 0.1)),
  ['box', 0.7, 0.03, 0.1, 0, 0, -1.93, deck],                                       // the fuel dock across the head of the spine
  ...[-0.26, 0.26].flatMap((x): Op[] => [['box', 0.04, 0.07, 0.03, x, 0.03, -1.93, 'red'], ['box', 0.03, 0.012, 0.032, x, 0.1, -1.93, 'yellow'], ['box', 0.008, 0.03, 0.008, x + (x > 0 ? 0.03 : -0.03), 0.03, -1.93, 'charcoal']]),
  ...(tip === 'pile'
    ? [-1, 1].flatMap((side) => FINGER_Z.map((z): Op => ['cyl', 0.011, 0.013, 0.06, side * 0.8, 0, z, 'timber', 5]))
    : [-1, 1].flatMap((side) => FINGER_Z.flatMap((z): Op[] => [['cyl', 0.011, 0.013, 0.08, side * 0.8, 0, z, WEATHERED, 5], ['cyl', 0.006, 0.006, 0.012, side * 0.8, 0.08, z, 'white', 5]]))),
];
const MARINA_DESIGNS: Design[] = [
  { name: 'pontoon marina with a harbourmaster\'s office and lookout, a quayside café and a fuel dock', height: 0.7, ops: [
    ['box', 3.96, 0.02, 1.96, 0, 0, 1.0, 'stone'],                                    // the quay and the front row
    ['box', 1.5, 0.004, 0.7, 1.15, 0.02, 1.5, ASPHALT],                               // a car park by the road
    ...repeat(5, (i): Op => ['box', 0.01, 0.002, 0.2, 0.5 + i * 0.3, 0.024, 1.5, 'white']),
    ...[0.65, 0.95, 1.55, 1.85].map((x, i) => car(x, 1.5, (['red', 'navy', 'silver', 'boxGreen'] as const)[i], 0.024)).flat(),
    ['box', 1.2, 0.42, 0.6, -1.25, 0.02, 1.0, 'white', 'office', { name: 'office', facade: { storeys: 2, bays: 5, sideBays: 2 } }],
    ['box', 1.26, 0.03, 0.66, -1.25, 0.44, 1.0, 'navy'],
    ['door', 'office', 'front', 2], ['balcony', 'office', 'front', 1, 1, 3, 'navy', 'stone'],
    ['box', 0.36, 0.12, 0.3, -1.45, 0.47, 1.0, 'white', 'office', { name: 'lookout', facade: { storeys: 1, bays: 3, sideBays: 2 } }],
    ['box', 0.42, 0.02, 0.36, -1.45, 0.59, 1.0, 'navy'],
    ['flag', -0.9, 0.47, 1.0, 'red'], ['box', 0.2, 0.012, 0.012, -0.9, 0.56, 1.0, 'steel'],  // the signal mast
    ['box', 0.8, 0.26, 0.5, 0.25, 0.02, 0.55, 'cream', 'shop', { name: 'cafe', facade: { storeys: 1, bays: 4, sideBays: 2, ground: 'shopfront' } }],
    ['awning', 'cafe', 'front', 0, 3, 'navy'],
    ['box', 0.86, 0.03, 0.56, 0.25, 0.28, 0.55, 'slate'],
    ...gull(0.5, 0.31, 0.55),
    ...cafeTable(-0.05, 0.98, 0.02, 'navy'), ...cafeTable(0.25, 1.0, 0.02, 'red'), ...cafeTable(0.55, 0.98, 0.02, 'navy'),
    ['cyl', 0.015, 0.015, 0.5, 1.7, 0.02, 0.35, 'white', 5], ['box', 0.1, 0.06, 0.01, 1.75, 0.46, 0.35, 'navy'],      // flagstaff
    ...quayEdge(3.98, -0.02),
    ...bollards(-1.8, 1.8, 0.03, 7),
    ...[-1.4, 0.9, 1.7].flatMap((x) => lamp(x, 0.02, 0.15, 0.3)),
    ...lifebuoy(-0.5, 0.15, 0.12), ['cyl', 0.005, 0.005, 0.11, -0.5, 0.02, 0.12, 'white', 4],
    ...marinaWater(PONTOON, 'pile'),
  ] },
  { name: 'sailing club with a verandah over the water, a rigged dinghy park, a boat hoist and timber pontoons', height: 0.72, ops: [
    ['box', 3.96, 0.02, 1.96, 0, 0, 1.0, 'stone'],
    ['box', 1.4, 0.004, 0.52, -0.8, 0.02, 1.63, 'lawn'],                              // the club lawn
    ['box', 1.7, 0.004, 0.5, 1.15, 0.02, 1.7, ASPHALT],
    ...[0.55, 0.85, 1.15, 1.45, 1.75].map((x, i) => car(x, 1.7, (['boxBlue', 'silver', 'brick', 'white', 'navy'] as const)[i], 0.024)).flat(),
    ['box', 1.7, 0.42, 0.56, -0.8, 0.02, 1.0, 'cream', 'office', { name: 'club', facade: { storeys: 2, bays: 8, sideBays: 2 } }],
    ['roof', 1.78, 0.17, 0.64, -0.8, 0.44, 1.0, 'slate'],
    ['door', 'club', 'front', 4], ['porch', 'club', 'front', 3, 5, 'slate', 'white'],
    ['balcony', 'club', 'back', 1, 1, 6, 'navy', 'timber'],                           // the verandah over the water
    ['cyl', 0.016, 0.02, 0.3, -1.45, 0.61, 1.0, 'brick', 6], ['cyl', 0.02, 0.02, 0.02, -1.45, 0.91, 1.0, 'chimney', 6],
    ['cyl', 0.008, 0.012, 0.62, 0.28, 0.02, 1.15, 'white', 6], ['box', 0.26, 0.012, 0.012, 0.28, 0.5, 1.15, 'steel'],  // the signal mast and its flags
    ...(['red', 'yellow', 'navy', 'white', 'boxGreen'] as const).map((c, i): Op => ['box', 0.03, 0.04, 0.004, 0.28 + (i - 2) * 0.052, 0.46, 1.15, c]),
    ['box', 0.09, 0.05, 0.005, 0.325, 0.58, 1.15, 'red'],
    ...gull(0.28, 0.64, 1.15, -1),
    ...[0.62, 0.95, 1.28, 1.61].flatMap((x, i) => [
      ...dinghy(x, 0.02, 0.75, (['red', 'boxBlue', 'white', 'boxOrange'] as const)[i], (['white', 'yellow', 'red', 'white'] as const)[i], 0.26 + (i % 3) * 0.03),
      ...dinghy(x + 0.02, 0.02, 1.22, (['boxGreen', 'navy', 'yellow', 'red'] as const)[i], (['white', 'white', 'boxBlue', 'yellow'] as const)[i], 0.3 - (i % 2) * 0.04),
    ]),
    // a yacht on a cradle under the boat hoist
    ...[-0.2, 0.2].map((dx): Op => ['box', 0.07, 0.04, 0.2, 1.5 + dx, 0.02, 0.26, 'timber']),
    ['box', 0.62, 0.12, 0.2, 1.5, 0.06, 0.26, 'white'], ['box', 0.64, 0.02, 0.21, 1.5, 0.1, 0.26, 'navy'], ['box', 0.2, 0.07, 0.12, 1.5, 0.18, 0.26, 'cream'],
    ...[1.12, 1.88].flatMap((x) => [0.1, 0.42].map((z): Op => ['box', 0.05, 0.56, 0.05, x, 0.02, z, HIVIS])),
    ...[0.1, 0.42].map((z): Op => ['box', 0.82, 0.05, 0.05, 1.5, 0.58, z, HIVIS]),
    ['box', 0.05, 0.05, 0.37, 1.12, 0.58, 0.26, HIVIS], ['box', 0.05, 0.05, 0.37, 1.88, 0.58, 0.26, HIVIS],
    ['box', 0.14, 0.06, 0.1, 1.5, 0.63, 0.26, 'dark'],
    ...quayEdge(3.98, -0.02),
    ...bollards(-1.8, 1.8, 0.03, 7),
    ...[-1.7, 0.1, 1.0].flatMap((x) => lamp(x, 0.02, 0.2, 0.3)),
    ...lifebuoy(-0.3, 0.15, 0.12), ['cyl', 0.005, 0.005, 0.11, -0.3, 0.02, 0.12, 'white', 4],
    ...marinaWater(WEATHERED, 'post'),
  ] },
];

export const marina: KindDef = {
  id: 'marina', name: 'marina', code: Zone.Hub, kindId: 25, family: 'transport',
  flags: { civic: true, workplace: true, leisureReady: true }, draft: true,
  windows: 'civic',
  footprint: { w: 4, h: 4, door: [1, 3], wet: 2, fairwayClearance: 1, marks: [
    { kind: 'berth', at: { edge: 'back', depth: 2 }, label: 'ten berths on the pontoons' },
    ...[0, 1, 2, 3].map((x) => ({ kind: 'quay' as const, at: [x, 2] as [number, number], ...(x === 0 ? { label: 'quay' } : {}) })),
  ] },
  tool: { id: 'marina', key: '', label: 'Marina (4×4)', color: '#3b8fc0' },
  group: 'harbour', tier: 3,
  blurb: 'Pontoons with ten berths, a harbourmaster and a café. Six to ten pleasure boats are based here, sized to the water, and their owners pay berth fees; people visit it as an outing.',
  howTo: 'Four tiles across and four deep: the front two rows on the bank facing a road, the back two over open water at least a channel wide. Narrowboats suit a river, sailboats want wider water. Needs Harbours.',
  occupation: staff('marina staff', [{ start: 7, hours: 8, weight: 0.55 }, { start: 13, hours: 8, weight: 0.45 }], WEEK),
  lot: { wage: 16 },
  attrs: { harbour: 'marina', title: 'marina', berthFee: 4 },
  levels: [{
    capacity: 8, wage: 16, cost: 4000, upkeep: 60, work: 650, parking: { surface: 6, underground: 0 },
    designs: MARINA_DESIGNS,
  }],
};

// ---------------------------------------------------------------- fishing harbour (26): 4×3, the back row over water

/** trawlers lie at x = -1.3, 0, 1.3 (±0.4), z -0.9..-0.5; only the quay wall, fenders and mooring posts go near them */
const fishQuay = (): Op[] => [
  ...quayEdge(3.98, -0.52),
  ...bollards(-1.7, 1.7, -0.47, 7, 0.072),
  ...repeat(9, (i): Op => ['cyl', 0.007, 0.007, 0.05, -1.75 + i * 0.4375, 0.002, -0.53, RUBBER, 6]), // tyre fenders hung on the quay face
  ...[-0.65, 0.65].flatMap((x): Op[] => [['cyl', 0.016, 0.02, 0.1, x, 0, -0.62, 'timber', 6], ...gull(x, 0.1, -0.62, x > 0 ? 1 : -1)]), // mooring piles between the berths
  ...[-1.8, -0.8, 0.8, 1.8].flatMap((x): Op[] => [['box', 0.004, 0.06, 0.004, x - 0.02, 0, -0.535, 'steel'], ['box', 0.004, 0.06, 0.004, x + 0.02, 0, -0.535, 'steel'], ...[0.012, 0.032, 0.052].map((y): Op => ['box', 0.044, 0.004, 0.006, x, y, -0.535, 'steel'])]), // ladders in the gaps between berths
];
/** a drying frame with a net slung over it, along x at z */
const netFrame = (x: number, z: number, w: number): Op[] => [
  ...[-1, 1].map((s): Op => ['cyl', 0.007, 0.008, 0.16, x + (s * w) / 2, 0.05, z, 'timber', 5]),
  ['box', w + 0.02, 0.008, 0.008, x, 0.21, z, 'timber'],
  ['box', w * 0.92, 0.1, 0.006, x, 0.11, z, NETC], ['box', w * 0.7, 0.05, 0.006, x + w * 0.05, 0.06, z, 0x4a7469],
];
const FISH_DESIGNS: Design[] = [
  { name: 'stone fish quay with an open auction canopy, a market hall, an ice plant and a derrick', height: 0.7, ops: [
    ['box', 3.96, 0.05, 1.96, 0, 0, 0.5, 'stone'],                                    // the quay and the market yard
    ...repeat(7, (i): Op => ['box', 3.9, 0.003, 0.012, 0, 0.05, -0.38 + i * 0.28, 'grey']),  // paving joints
    ...fishQuay(),
    ['box', 2.2, 0.36, 0.7, -0.75, 0.05, 1.05, 'cream', 'factory', { name: 'market', facade: { storeys: 1, bays: 7, sideBays: 2 } }],
    ['roof', 2.28, 0.18, 0.78, -0.75, 0.41, 1.05, 'corrugated'],
    ['garage', 'market', 'front', 2], ['garage', 'market', 'front', 4], ['door', 'market', 'front', 0],
    ['box', 1.3, 0.03, 0.1, -0.75, 0.59, 1.05, 'glass'],                                // a lantern light along the ridge
    // the auction canopy in front of the hall: posts and a flat roof over the fish boxes
    ...repeat(6, (i): Op => ['cyl', 0.01, 0.01, 0.24, -1.7 + i * 0.38, 0.05, 0.22, 'steel', 5]),
    ['box', 2.1, 0.02, 0.46, -0.75, 0.29, 0.42, 'pale'], ['box', 2.1, 0.03, 0.012, -0.75, 0.275, 0.656, 'red'],
    ...repeat(6, (i): Op => ['box', 0.17, 0.05, 0.1, -1.6 + i * 0.37, 0.05, 0.4, (['white', 'boxBlue', 'white', 'boxOrange'] as const)[i % 4]]),
    ...repeat(6, (i): Op => ['box', 0.16, 0.04, 0.09, -1.6 + i * 0.37, 0.1, 0.4, (['boxBlue', 'white', 'boxGreen'] as const)[i % 3]]),
    ...gull(-1.9, 0.31, 0.42),
    ['box', 0.6, 0.48, 0.5, 1.4, 0.05, 1.0, 'grey', 'factory', { name: 'ice', facade: { storeys: 2, bays: 2, sideBays: 2 } }],   // the ice plant
    ['door', 'ice', 'front', 0],
    ['cyl', 0.1, 0.1, 0.16, 1.4, 0.53, 0.95, 'silver', 10], ['cone', 0.1, 0.05, 1.4, 0.69, 0.95, 'roofGrey', 10],
    ['wheel', 0.012, 0.5, 1.15, 0.12, 0.62, 'silver'], ['box', 0.03, 0.12, 0.03, 0.9, 0.05, 0.62, 'silver'],         // the ice pipe out to the quay
    ['box', 0.12, 0.05, 0.1, 1.75, 0.05, 0.62, 'white'], ['box', 0.1, 0.04, 0.08, 1.75, 0.1, 0.62, 'boxBlue'],
    // the landing derrick at the quay edge: mast, jib that stops at the wall, a hook line
    ['box', 0.07, 0.05, 0.07, 0.62, 0.05, -0.3, 'charcoal'], ['cyl', 0.012, 0.016, 0.38, 0.62, 0.1, -0.3, 'rust', 6],
    ['box', 0.02, 0.02, 0.2, 0.62, 0.44, -0.4, 'rust'], ['cyl', 0.003, 0.003, 0.18, 0.62, 0.26, -0.49, ROPE, 4], ['box', 0.04, 0.03, 0.04, 0.62, 0.23, -0.49, 'steel'],
    ...netFrame(-1.3, 0.0, 0.5), ...netFrame(-0.5, 0.0, 0.4),                          // nets drying on the quay
    ...repeat(4, (i): Op => ['cyl', 0.03, 0.03, 0.06, 0.2 + (i % 2) * 0.08, 0.05 + (i > 1 ? 0.06 : 0), 0.0 + (i % 2) * 0.01, i < 3 ? 'boxBlue' : 'red', 8]), // oil drums
    ...repeat(6, (i): Op => ['cyl', 0.016, 0.016, 0.03, 1.1 + (i % 3) * 0.04, 0.05, 0.2 + Math.floor(i / 3) * 0.04, BUOY[i % 4], 7]), // floats
    ...[1.9].flatMap((x) => lamp(x, 0.05, -0.35, 0.42)), ...lamp(-1.9, 0.05, -0.35, 0.42),
    ...gull(1.9, 0.5, -0.35), ...gull(-0.5, 0.59, 1.05, -1), ...gull(1.2, 0.69, 0.95),
    ...repeat(5, (i): Op => ['box', 0.12, 0.06, 0.08, -1.7 + i * 0.16, 0.05, 0.1 + (i % 2) * 0.1, i % 2 ? 'boxBlue' : 'red']),   // fish boxes on the quay
  ] },
  { name: 'harbour arms with a lighthouse, tarred net lofts, a smokehouse and a café with market stalls', height: 0.9, ops: [
    ['box', 3.96, 0.05, 1.96, 0, 0, 0.5, 'tan'],                                      // sandy cobbles
    ...repeat(7, (i): Op => ['box', 3.9, 0.003, 0.012, 0, 0.05, -0.38 + i * 0.28, 'sand']),
    ...fishQuay(),
    // the two arms of the harbour, out into the wet row at each end, with a light on each
    ['box', 0.2, 0.08, 0.95, -1.9, 0, -0.975, 'stone'], ['box', 0.2, 0.012, 0.97, -1.9, 0.08, -0.975, 'grey'],
    ['box', 0.2, 0.08, 0.95, 1.9, 0, -0.975, 'stone'], ['box', 0.2, 0.012, 0.97, 1.9, 0.08, -0.975, 'grey'],
    ['cyl', 0.012, 0.014, 0.12, -1.9, 0.092, -1.35, 'green', 6], ['box', 0.04, 0.03, 0.04, -1.9, 0.212, -1.35, 'white', 'civic'],
    ['lathe', 1.9, 0.092, -1.2, 'white', [0.09, 0, 0.075, 0.2, 0.06, 0.4], { seg: 12 }],
    ['lathe', 1.9, 0.292, -1.2, 'red', [0.0675, 0, 0.062, 0.1], { seg: 12 }],
    ['lathe', 1.9, 0.392, -1.2, 'white', [0.062, 0, 0.056, 0.16], { seg: 12 }],
    ['cyl', 0.074, 0.058, 0.02, 1.9, 0.552, -1.2, 'charcoal', 12], ['box', 0.07, 0.07, 0.07, 1.9, 0.572, -1.2, 'glass'], ['box', 0.05, 0.05, 0.05, 1.9, 0.582, -1.2, 'white', 'civic'],
    ['cone', 0.06, 0.07, 1.9, 0.642, -1.2, 'red', 8],
    ...gull(-1.9, 0.092, -0.8), ...gull(1.9, 0.092, -0.7, -1),
    // net lofts: two tall tarred boards with hoists
    ['box', 0.46, 0.4, 0.42, -1.65, 0.05, 1.0, TAR, 'home', { name: 'loft1', facade: { storeys: 2, bays: 2, sideBays: 1 } }],
    ['roof', 0.52, 0.2, 0.48, -1.65, 0.45, 1.0, 'slate'],
    ['door', 'loft1', 'front', 0],
    ['box', 0.03, 0.03, 0.14, -1.65, 0.38, 1.28, 'timber'], ['cyl', 0.003, 0.003, 0.12, -1.65, 0.26, 1.32, ROPE, 4], // the hoist beam out from the gable
    ['box', 0.44, 0.36, 0.4, -1.12, 0.05, 1.02, TAR, 'home', { name: 'loft2', facade: { storeys: 2, bays: 2, sideBays: 1 } }],
    ['roof', 0.5, 0.18, 0.46, -1.12, 0.41, 1.02, 'roofGrey'],
    ['door', 'loft2', 'front', 1],
    ...netFrame(-1.4, 0.45, 0.5),
    // the café and the smokehouse
    ['box', 0.9, 0.26, 0.5, -0.3, 0.05, 1.0, 'cream', 'shop', { name: 'cafe', facade: { storeys: 1, bays: 5, sideBays: 2, ground: 'shopfront' } }],
    ['roof', 0.98, 0.14, 0.58, -0.3, 0.31, 1.0, 'terracotta'],
    ['awning', 'cafe', 'front', 0, 4, 'signBlue'],
    ...cafeTable(-0.6, 1.4, 0.05, 'red'), ...cafeTable(-0.3, 1.42, 0.05, 'boxBlue'), ...cafeTable(0.0, 1.4, 0.05, 'red'),
    ['box', 0.36, 0.3, 0.36, 1.1, 0.05, 1.02, 'brick'], ['roof', 0.42, 0.14, 0.42, 1.1, 0.35, 1.02, 'slate'],       // smokehouse
    ['chimneyStack', 1.1, 0.35, 1.02, 0.36, 0.036, 'brick'], ['box', 0.02, 0.16, 0.012, 1.1, 0.1, 1.2, 'dark'],
    ...gull(1.1, 0.49, 1.02),
    // stalls on the quay
    ...[0.35, 0.7, 1.05].flatMap((x, i): Op[] => [
      ['box', 0.26, 0.035, 0.12, x, 0.05, 0.18, 'timber'], ['box', 0.22, 0.02, 0.08, x, 0.085, 0.18, 'white'],
      ...[-0.12, 0.12].map((dx): Op => ['cyl', 0.005, 0.005, 0.15, x + dx, 0.05, 0.1, 'steel', 4]),
      ['box', 0.3, 0.012, 0.22, x, 0.2, 0.14, i % 2 ? 'signBlue' : 'red'],
    ]),
    // a boat hauled out, and lobster pots, floats and rope coils
    ['box', 0.12, 0.05, 0.9, 1.45, 0.05, 0.2, 'timber'],
    ['box', 0.34, 0.12, 0.9, 1.45, 0.1, 0.2, 'boxBlue'], ['box', 0.36, 0.015, 0.92, 1.45, 0.22, 0.2, 'white'], ['box', 0.2, 0.12, 0.22, 1.45, 0.235, 0.0, 'white', 'civic'],
    ...repeat(8, (i): Op => ['box', 0.07, 0.05, 0.09, -0.9 + (i % 4) * 0.075, 0.05 + Math.floor(i / 4) * 0.05, 0.12, 'timber']),
    ...repeat(8, (i): Op => ['cyl', 0.014, 0.014, 0.03, -0.9 + (i % 4) * 0.075, 0.15, 0.12, BUOY[i % 4], 7]),
    ...lamp(-0.2, 0.05, -0.3, 0.4), ...lamp(0.9, 0.05, -0.3, 0.4),
  ] },
];

export const fishingHarbour: KindDef = {
  id: 'fishing-harbour', name: 'fishing harbour', code: Zone.Hub, kindId: 26, family: 'transport',
  flags: { civic: true, workplace: true }, draft: true,
  windows: 'factory',
  footprint: { w: 4, h: 3, door: [1, 2], wet: 1, fairwayClearance: 2, marks: [
    { kind: 'berth', at: { edge: 'back', depth: 1 }, label: 'three trawler berths' },
    ...[0, 1, 2, 3].map((x) => ({ kind: 'quay' as const, at: [x, 1] as [number, number], ...(x === 0 ? { label: 'fish quay' } : {}) })),
  ] },
  tool: { id: 'fishharbour', key: '', label: 'Fishing harbour (4×3)', color: '#2f6f8f' },
  group: 'harbour', tier: 4,
  blurb: 'A fish quay with three trawlers, a fish market and an ice plant. The trawlers sail before dawn, fish for half a day and land their catch, which goes to cafés, restaurants and food works.',
  howTo: 'Four tiles across and three deep: two rows on the bank facing a road, the back row over open water at least three tiles wide behind it. Needs Harbours.',
  occupation: staff('fishing crew', [{ start: 4, hours: 12, weight: 0.77 }, { start: 5, hours: 8, weight: 0.23 }], [[1, 1, 1, 1, 1, 1, 0]], false),
  lot: { wage: 19 },
  attrs: { harbour: 'fishing', title: 'fishing harbour', noise: 2 },
  levels: [{
    capacity: 26, wage: 19, cost: 5000, upkeep: 80, work: 600, parking: { surface: 4, underground: 0 },
    designs: FISH_DESIGNS,
  }],
};

// ---------------------------------------------------------------- ferry pier (27): 2×2, the pontoon over water

/** a London-style roundel facing +z: a red ring, a white eye and a blue bar; (x, y) is its centre */
const roundel = (x: number, y: number, z: number, r: number): Op[] => [
  ['lathe', x, y, z, 'crossRed', [0, 0, r, 0, r, 0.01], { seg: 20, axis: 'z' }],
  ['lathe', x, y, z + 0.0045, 'white', [0, 0, r * 0.7, 0, r * 0.7, 0.0085], { seg: 16, axis: 'z' }],
  ['box', r * 2.3, r * 0.34, 0.016, x, y - r * 0.17, z - 0.002, 'navy'],
];
/** the ferry berth is at z = -1.5, outside the footprint: nothing here goes beyond z = -1.0 */
const FERRY_DESIGNS: Design[] = [
  { name: 'covered floating pontoon on a gangway, a ticket kiosk and roundel signs', height: 0.52, ops: [
    ['box', 1.96, 0.02, 0.96, 0, 0, 0.5, 'stone'],                                    // the riverside walk
    ['box', 0.6, 0.3, 0.4, -0.55, 0.02, 0.62, 'navy', 'shop', { name: 'ticket', facade: { storeys: 1, bays: 3, sideBays: 2, ground: 'shopfront' } }],
    ['awning', 'ticket', 'front', 0, 2, 'white'],
    ['box', 0.66, 0.03, 0.46, -0.55, 0.32, 0.62, 'white'],
    ['cyl', 0.005, 0.005, 0.1, -0.55, 0.35, 0.64, 'steel', 4], ...roundel(-0.55, 0.45, 0.64, 0.055),   // the kiosk's roundel
    ['cyl', 0.008, 0.01, 0.34, 0.62, 0.02, 0.85, 'steel', 6], ...roundel(0.62, 0.38, 0.85, 0.07),     // the pier sign by the walk
    ['box', 0.3, 0.1, 0.012, 0.3, 0.1, 0.9, 'signBlue'], ['cyl', 0.005, 0.005, 0.1, 0.17, 0.02, 0.9, 'steel', 4], ['cyl', 0.005, 0.005, 0.1, 0.43, 0.02, 0.9, 'steel', 4], // route board
    ['box', 0.2, 0.012, 0.012, 0.3, 0.17, 0.9, 'white'],
    ...bench(-0.1, 0.02, 0.9), ['cyl', 0.02, 0.018, 0.05, 0.0, 0.02, 0.9, 'dark', 8],
    ...repeat(4, (i): Op => ['box', 0.012, 0.05, 0.012, 0.75 + i * 0.05, 0.02, 0.45, 'steel']), ['box', 0.2, 0.01, 0.012, 0.825, 0.05, 0.45, 'steel'], // cycle rack
    ...lamp(0.9, 0.02, 0.2, 0.34), ...lamp(-0.92, 0.02, 0.2, 0.34),
    ...quayEdge(1.98, -0.02),
    ['box', 0.2, 0.015, 0.46, 0.45, 0.02, -0.23, 'steel'],                            // the gangway
    ...[0.35, 0.55].flatMap((x): Op[] => [['box', 0.006, 0.05, 0.46, x, 0.035, -0.23, 'steel'], ['box', 0.006, 0.006, 0.46, x, 0.085, -0.23, 'steel']]),
    ['box', 1.9, 0.04, 0.5, 0, 0, -0.74, PONTOON],                                    // the pontoon, along the back edge
    ['box', 1.9, 0.012, 0.04, 0, 0.04, -0.97, 'yellow'],                              // edge line where the boats lie
    ...[-0.9, 0.9].flatMap((x): Op[] => [['cyl', 0.014, 0.016, 0.03, x, 0.04, -0.93, 'charcoal', 6], ['cyl', 0.022, 0.026, 0.2, x > 0 ? 0.97 : -0.97, 0, -0.9, 'timber', 6]]),
    ...[-0.8, -0.4, 0, 0.4, 0.8].flatMap((x): Op[] => [['cyl', 0.012, 0.012, 0.26, x, 0.04, -0.55, 'steel', 5], ['cyl', 0.012, 0.012, 0.26, x, 0.04, -0.93, 'steel', 5]]),
    ['taper', 1.8, 0.46, 1.8, 0.2, 0.07, 0, 0.3, -0.74, 'white'],                     // canopy, folded plate
    ['box', 0.5, 0.07, 0.012, -0.45, 0.37, -0.74, 'navy'], ['box', 0.4, 0.02, 0.014, -0.45, 0.395, -0.74, 'white'], // pier name board
    ...[-0.6, -0.2, 0.2, 0.6].map((x): Op => ['box', 0.08, 0.012, 0.04, x, 0.288, -0.74, 'white', 'civic']),
    ...bench(-0.5, 0.04, -0.74, 0.22), ...bench(0.5, 0.04, -0.74, 0.22),
    ...lifebuoy(0.8, 0.17, -0.538),
    ...gull(0.975, 0.2, -0.9, -1),
  ] },
  { name: 'timber pier head on piles with a cast-iron pavilion, a gangway bridge and a clock-turret ticket office', height: 0.72, ops: [
    ['box', 1.96, 0.02, 0.96, 0, 0, 0.5, 'tan'],                                      // the embankment walk
    ['box', 0.56, 0.34, 0.4, -0.5, 0.02, 0.62, 'brick', 'office', { name: 'office', facade: { storeys: 1, bays: 3, sideBays: 2 } }],
    ['roof', 0.62, 0.16, 0.46, -0.5, 0.36, 0.62, 'slate'],
    ['door', 'office', 'front', 1], ['awning', 'office', 'front', 0, 0, 'green'], ['awning', 'office', 'front', 2, 2, 'green'],
    ['box', 0.12, 0.1, 0.12, -0.5, 0.5, 0.62, 'white'], ['cone', 0.1, 0.1, -0.5, 0.6, 0.62, 'green', 4],      // the clock turret
    ['lathe', -0.5, 0.55, 0.682, 'gold', [0, 0, 0.042, 0, 0.042, 0.004], { seg: 14, axis: 'z' }], ['lathe', -0.5, 0.55, 0.685, 'white', [0, 0, 0.035, 0, 0.035, 0.004], { seg: 14, axis: 'z' }],
    ['box', 0.004, 0.028, 0.004, -0.5, 0.55, 0.69, 'charcoal'], ['box', 0.022, 0.004, 0.004, -0.49, 0.55, 0.69, 'charcoal'],
    ['cyl', 0.012, 0.014, 0.01, 0.5, 0.02, 0.8, 'green', 6], ['cyl', 0.006, 0.006, 0.32, 0.5, 0.03, 0.8, 'green', 5], ['box', 0.08, 0.06, 0.012, 0.5, 0.28, 0.8, 'navy'],  // the pier sign
    ...bench(0.15, 0.02, 0.88, 0.2),
    ...lamp(0.88, 0.02, 0.4, 0.3), ...lamp(-0.9, 0.02, 0.4, 0.3),
    ...quayEdge(1.98, -0.02),
    // the bridge to the pier head: a timber deck on two trestles with iron rails
    ['box', 0.2, 0.02, 0.47, 0.55, 0.04, -0.255, 'timber'],
    ...[0.45, 0.65].flatMap((x): Op[] => [-0.12, -0.4].map((z): Op => ['cyl', 0.014, 0.018, 0.04, x, 0, z, 'timber', 5])),
    ...[0.44, 0.66].flatMap((x): Op[] => [['box', 0.008, 0.05, 0.47, x, 0.06, -0.255, 'green'], ['box', 0.012, 0.006, 0.47, x, 0.11, -0.255, 'green']]),
    // the pier head
    ...piles(Array.from({ length: 8 }, (_, i) => -0.8 + i * 0.2286).flatMap((x): [number, number][] => [[x, -0.55], [x, -0.93]]), 0.05),
    ['box', 1.7, 0.02, 0.5, 0, 0.05, -0.74, WEATHERED],
    ...repeat(8, (i): Op => ['box', 1.7, 0.002, 0.006, 0, 0.07, -0.52 - i * 0.06, 'charcoal']),
    ['box', 1.74, 0.03, 0.02, 0, 0.035, -0.985, 'timber'],                            // rubbing strake along the berth edge
    ...[-0.56, -0.28, 0, 0.28, 0.56].flatMap((x): Op[] => [['cyl', 0.01, 0.012, 0.21, x, 0.07, -0.55, 'green', 6], ['cyl', 0.01, 0.012, 0.21, x, 0.07, -0.93, 'green', 6]]),
    ['roof', 1.3, 0.12, 0.5, 0, 0.28, -0.74, 'slate'],
    ...repeat(13, (i): Op => ['box', 0.07, 0.025, 0.006, -0.6 + i * 0.1, 0.255, -0.495, 'cream']), ...repeat(13, (i): Op => ['box', 0.07, 0.025, 0.006, -0.6 + i * 0.1, 0.255, -0.985, 'cream']),
    ['box', 0.36, 0.05, 0.1, 0, 0.4, -0.74, 'glass'], ['roof', 0.4, 0.05, 0.14, 0, 0.45, -0.74, 'slate'],     // the lantern light along the ridge
    ['cone', 0.012, 0.05, -0.6, 0.4, -0.74, 'gold', 5], ['cone', 0.012, 0.05, 0.6, 0.4, -0.74, 'gold', 5],
    ['flag', -0.25, 0.4, -0.74, 'red'],
    ...bench(-0.3, 0.07, -0.74, 0.22), ...bench(0.3, 0.07, -0.74, 0.22),
    ...[-0.88, 0.88].flatMap((x) => lamp(x, 0.07, -0.55, 0.26)),
    ...[-0.8, 0.8].map((x): Op => ['box', 0.02, 0.01, 0.012, x, 0.07, -0.95, 'steel']),
    ...lifebuoy(0.56, 0.2, -0.538),
    ...gull(0.6, 0.4, -0.74, -1),
  ] },
];

export const ferryPier: KindDef = {
  id: 'ferry-pier', name: 'ferry pier', code: Zone.Hub, kindId: 27, family: 'transport',
  flags: { civic: true, workplace: true }, draft: true,
  windows: 'civic',
  footprint: { w: 2, h: 2, door: [0, 1], wet: 1, fairwayClearance: 1, marks: [
    { kind: 'quay', at: { edge: 'back', depth: 1 }, label: 'pontoon' },
    { kind: 'berth', at: { edge: 'back' }, label: 'ferries call behind the pontoon' },
  ] },
  tool: { id: 'ferrypier', key: '', label: 'Ferry pier (2×2)', color: '#1f8a8a' },
  group: 'harbour', tier: 2,
  blurb: 'A pontoon with a gangway and a ticket office: a stop for a river bus line. Boats call on the water just behind the pontoon, one line to a pier.',
  howTo: 'Two tiles across and two deep: the front row on the bank facing a road, the pontoon row over the water, with open water behind it for the boats to lie in. Add it to a ferry line in the Lines panel. Needs River buses.',
  occupation: staff('pier staff', [{ start: 6, hours: 8, weight: 0.5 }, { start: 14, hours: 8, weight: 0.5 }], WEEK),
  lot: { wage: 16 },
  attrs: { harbour: 'pier', title: 'ferry pier' },
  levels: [{
    capacity: 3, wage: 16, cost: 1500, upkeep: 20, work: 250, parking: { surface: 0, underground: 0 },
    designs: FERRY_DESIGNS,
  }],
};

// ---------------------------------------------------------------- cargo port (28): 8×6, the back row over water

const CONTAINERS = ['boxBlue', 'boxOrange', 'boxGreen', 'red', 'navy', 'grey', 'rust', 'yellow', 'white'] as const;
/** a stack of n containers (len along x) at (x, z), coloured from k; the lower ones are a shade apart so a stack never reads as one block */
const stack = (x: number, z: number, n: number, k: number, len = 0.5): Op[] =>
  repeat(n, (i): Op => ['box', len, 0.18, 0.22, x, 0.02 + i * 0.185, z, CONTAINERS[(k + i * 5 + (i > 1 ? 2 : 0)) % CONTAINERS.length]]);
/** a container lorry parked along z with a box on its trailer: cab, chassis, wheels */
const lorry = (x: number, z: number, c: Color, k: Color): Op[] => [
  ['box', 0.2, 0.1, 0.13, x, 0.05, z + 0.3, c], ['box', 0.17, 0.04, 0.02, x, 0.1, z + 0.37, 'glassDark'],
  ['box', 0.19, 0.025, 0.6, x, 0.035, z - 0.1, 'dark'],
  ['box', 0.2, 0.18, 0.5, x, 0.06, z - 0.12, k],
  ...[0.3, -0.2, -0.32].flatMap((dz): Op[] => [['wheel', 0.026, 0.03, x - 0.1, 0.026, z + dz, RUBBER], ['wheel', 0.026, 0.03, x + 0.1, 0.026, z + dz, RUBBER]]),
];
/** a straddle carrier standing over a lane, legs at the four corners, cab on one corner */
const straddle = (x: number, z: number): Op[] => [
  ...[-0.29, 0.29].flatMap((dx) => [-0.13, 0.13].map((dz): Op => ['box', 0.035, 0.34, 0.035, x + dx, 0.02, z + dz, HIVIS])),
  ['box', 0.64, 0.04, 0.34, x, 0.36, z, HIVIS], ['box', 0.1, 0.07, 0.1, x - 0.25, 0.4, z + 0.1, 'dark'],
  ...[-0.29, 0.29].flatMap((dx) => [-0.13, 0.13].map((dz): Op => ['wheel', 0.026, 0.03, x + dx, 0.026, z + dz, RUBBER])),
];
/** a ship-to-shore gantry crane on the quay at x: legs on the rails at z -1.85 and -1.15, a boom out over the berth, and the stays */
const gantry = (x: number, tone: Color): Op[] => [
  ...[-0.22, 0.22].flatMap((dx) => [-1.85, -1.15].map((z): Op => ['box', 0.12, 0.04, 0.12, x + dx, 0.068, z, 'dark'])),   // the bogies
  ...[-0.22, 0.22].flatMap((dx): Op[] => [-1.85, -1.15].map((z): Op => ['box', 0.07, 1.12, 0.07, x + dx, 0.108, z, tone])),
  ...[-1.85, -1.15].map((z): Op => ['box', 0.51, 0.07, 0.07, x, 1.228, z, tone]),            // the portal's cross-beams
  ...[-0.22, 0.22].map((dx): Op => ['box', 0.07, 0.07, 0.77, x + dx, 0.62, -1.5, tone]),       // mid-height ties
  ...[-0.22, 0.22].map((dx): Op => ['box', 0.07, 0.07, 1.96, x + dx, 1.298, -1.98, tone]),    // the boom, out over the water
  ...[-2.9, -2.4, -1.9].map((z): Op => ['box', 0.51, 0.04, 0.04, x, 1.298, z, tone]),
  ...[-0.22, 0.22].map((dx): Op => ['box', 0.05, 0.3, 0.05, x + dx, 1.368, -1.5, tone]),      // the apex posts
  ['box', 0.49, 0.04, 0.05, x, 1.668, -1.5, tone],
  ...[-0.22, 0.22].flatMap((dx): Op[] => [
    ['taper', 0.012, 0.012, 0.01, 0.01, 0.37, x + dx, 1.298, -2.92, 0x5a5e66, { shift: [0, 1.42] }],           // forestay to the boom tip
    ['taper', 0.012, 0.012, 0.01, 0.01, 0.37, x + dx, 1.298, -0.98, 0x5a5e66, { shift: [0, -0.52] }],          // backstay to the machinery house
  ]),
  ['box', 0.3, 0.16, 0.3, x, 1.368, -1.15, 'white', 'factory'],                               // machinery house
  ['box', 0.2, 0.05, 0.12, x, 1.368, -0.9, 'dark'],                                          // counterweight
  ['box', 0.16, 0.05, 0.16, x, 1.248, -2.6, 'dark'], ['box', 0.07, 0.06, 0.1, x + 0.1, 1.188, -2.6, 'dark', 'factory'],   // trolley and the driver's cab
  ['box', 0.016, 0.016, 0.012, x, 1.708, -1.5, 'red', 'civic'],                                // warning light on the apex, lit after dark
];
/** logs lying along x in a triangular pile of three layers */
const logPile = (x: number, z: number): Op[] => [6, 5, 4].flatMap((n, l) => repeat(n, (k): Op => ['wheel', 0.03, 0.62, x, 0.05 + l * 0.052, z + (k - (n - 1) / 2) * 0.062, (['brown', 'timber', 'rust'] as const)[(k + l) % 3]]));
const PORT_COMMON: Op[] = [
  ['box', 7.96, 0.02, 3.96, 0, 0, 1.0, ASPHALT],                                      // the yard
  ['box', 7.96, 0.06, 0.98, 0, 0, -1.5, 'grey'],                                      // the quay apron
  ['box', 7.9, 0.002, 0.03, 0, 0.06, -1.95, 'yellow'],
  ...[-1.85, -1.15].map((z): Op => ['box', 7.9, 0.008, 0.03, 0, 0.06, z, 'steel']),   // crane rails
  ...quayEdge(7.98, -2.02),
  ...bollards(-3.8, 3.8, -1.9, 9),
  ...repeat(7, (i): Op => ['box', 0.03, 0.002, 0.7, -3.6 + i * 1.2, 0.02, 2.1, 'white']), // lane markings in the truck yard
  // the gatehouse, barrier and lamps at the truck gate
  ['box', 0.42, 0.3, 0.36, 0.4, 0.02, 2.55, 'white', 'office', { name: 'gate', facade: { storeys: 1, bays: 2, sideBays: 2 } }],
  ['box', 0.48, 0.03, 0.42, 0.4, 0.32, 2.55, 'charcoal'], ['door', 'gate', 'front', 0],
  ['box', 0.7, 0.03, 0.03, -0.4, 0.2, 2.8, 'red'], ['box', 0.06, 0.2, 0.06, -0.02, 0.02, 2.8, 'grey'],
  ...[-3.85, 3.85].flatMap((x) => lamp(x, 0.02, 2.6, 1.1, 'factory')),
];
const PORT_DESIGNS: Design[] = [
  { name: 'container quay with two gantry cranes, stacks, straddle carriers, a transit shed and a control tower', height: 1.8, ops: [
    ...PORT_COMMON,
    ...gantry(-1.8, 'red'), ...gantry(2.5, 'red'),
    // container stacks in two bands, with a lane between for the carriers
    ...[-3.4, -2.8, -2.2, -1.6, -1.0, -0.4].flatMap((x, i) => [...stack(x, -0.72, 1 + (i % 4), i), ...stack(x, -0.47, 2 + ((i + 1) % 3), i + 2)]),
    ...[0.2, 0.8].flatMap((x, i) => [...stack(x, -0.72, 3 - i, i + 1), ...stack(x, -0.47, 1 + i, i + 3)]),
    ...[1.5, 2.1, 2.7, 3.3].flatMap((x, i) => [...stack(x, -0.72, 1 + ((i * 2) % 3), i + 4), ...stack(x, -0.47, 2 + (i % 2), i + 1)]),
    ...[-3.4, -2.8, -2.2, -1.6].flatMap((x, i) => [...stack(x, 0.46, 1 + (i % 3), i + 3), ...stack(x, 0.71, 2 + (i % 2), i)]),
    ...straddle(-2.4, -0.05), ...straddle(0.9, -0.05),
    // the transit shed
    ['box', 2.4, 0.5, 0.9, 2.6, 0.02, 0.35, 'corrugated', 'factory', { name: 'shed', facade: { storeys: 1, bays: 8, sideBays: 3 } }],
    ['roof', 2.48, 0.14, 0.98, 2.6, 0.52, 0.35, 'roofGrey'],
    ['garage', 'shed', 'front', 2], ['garage', 'shed', 'front', 5],
    // the port's control tower
    ['box', 0.34, 0.7, 0.34, -3.3, 0.02, 1.7, 'white', 'office', { name: 'tower', facade: { storeys: 3, bays: 2, sideBays: 2 } }],
    ['door', 'tower', 'front', 0],
    ['box', 0.46, 0.02, 0.46, -3.3, 0.72, 1.7, 'charcoal'], ['box', 0.4, 0.12, 0.4, -3.3, 0.74, 1.7, 'glass'], ['box', 0.46, 0.02, 0.46, -3.3, 0.86, 1.7, 'charcoal'],
    ['cyl', 0.008, 0.01, 0.2, -3.3, 0.88, 1.7, 'steel', 5], ['box', 0.1, 0.02, 0.02, -3.3, 1.04, 1.7, 'steel'],
    ...gull(-3.3, 0.88, 1.9),
    ...lorry(1.2, 1.0, 'red', 'boxBlue'), ...lorry(1.9, 1.5, 'navy', 'boxOrange'), ...lorry(-1.4, 1.7, 'yellow', 'grey'),
  ] },
  { name: 'general cargo quay with two harbour cranes, grain silos and a gallery, sawtooth warehouses, log piles and a rail siding', height: 1.6, ops: [
    ...PORT_COMMON,
    // two slewing harbour cranes on portal frames: pedestal, cab, a leaning lattice jib out over the berth, a counterweight
    ...[-0.6, 2.5].flatMap((x): Op[] => [
      ...[-0.25, 0.25].flatMap((dx) => [-1.85, -1.15].map((z): Op => ['box', 0.07, 0.54, 0.07, x + dx, 0.068, z, 'green'])),
      ...[-0.25, 0.25].map((dx): Op => ['box', 0.07, 0.07, 0.77, x + dx, 0.608, -1.5, 'green']),
      ['box', 0.6, 0.06, 0.8, x, 0.678, -1.5, 'dark'],
      ['cyl', 0.13, 0.15, 0.3, x, 0.738, -1.5, HIVIS, 12],
      ['box', 0.34, 0.2, 0.38, x, 1.038, -1.5, HIVIS], ['box', 0.2, 0.1, 0.02, x, 1.12, -1.69, 'glass'],
      ['box', 0.26, 0.2, 0.18, x, 1.038, -1.2, 'charcoal'],
      ['taper', 0.1, 0.12, 0.06, 0.06, 0.55, x, 1.1, -1.7, 'red', { shift: [0, -1.0] }],                // the jib
      ['taper', 0.05, 0.05, 0.03, 0.03, 0.5, x - 0.04, 1.1, -1.7, 0x6a6e75, { shift: [0, -0.95] }],
      ['box', 0.05, 0.08, 0.05, x, 1.65, -2.72, 'dark'], ['box', 0.014, 0.014, 0.012, x, 1.73, -2.72, 'red', 'civic'],
    ]),
    // grain silos and the gallery
    ...[-3.3, -2.7, -2.1, -1.5].flatMap((x, i): Op[] => [
      ['cyl', 0.26, 0.26, 0.9, x, 0.02, 0.35, i % 2 ? 'white' : 'silver', 14], ['cone', 0.26, 0.14, x, 0.92, 0.35, 'roofGrey', 14],
      ['cyl', 0.06, 0.06, 0.06, x, 1.06, 0.35, 'steel', 8],
    ]),
    ['box', 0.08, 0.07, 2.0, -2.1, 0.54, -0.88, 'steel'],                              // the conveyor gallery to the quay loader
    ...repeat(7, (i): Op => ['box', 0.03, 0.54, 0.03, -2.1, 0, -0.1 - i * 0.28, 'steel']),
    ['box', 0.08, 0.44, 0.08, -2.1, 0.06, -1.9, 'steel'], ['box', 0.16, 0.12, 0.16, -2.1, 0.5, -1.9, HIVIS],
    // sawtooth warehouses
    ...[0.9, 2.9].flatMap((x, i): Op[] => [
      ['box', 1.8, 0.3, 0.9, x, 0.02, 0.45, i ? 'cream' : 'brick', 'factory', { name: `wh${i}`, facade: { storeys: 1, bays: 6, sideBays: 3 } }],
      ...repeat(4, (j): Op => ['roof', 0.44, 0.12, 0.94, x - 0.675 + j * 0.45, 0.32, 0.45, 'corrugated', true]),
      ['garage', `wh${i}`, 'front', 1], ['garage', `wh${i}`, 'front', 4], ['door', `wh${i}`, 'front', 2],
    ]),
    // log piles stacked in threes, and pallets of sacks
    ...logPile(-3.1, 1.25), ...logPile(-3.1, 1.65),
    ...repeat(6, (i): Op => ['box', 0.1, 0.07, 0.1, -1.0 + (i % 3) * 0.12, 0.02 + Math.floor(i / 3) * 0.07, 1.2, 'cream']),
    // a siding with two wagons
    ['box', 7.9, 0.01, 0.14, 0, 0.02, 1.95, 'gravel'], ['box', 7.9, 0.012, 0.012, 0, 0.03, 1.91, 'steel'], ['box', 7.9, 0.012, 0.012, 0, 0.03, 1.99, 'steel'],
    ...[-0.2, 1.2].flatMap((x, i): Op[] => [
      ['box', 1.0, 0.1, 0.14, x, 0.04, 1.95, i ? 'rust' : 'boxBlue'], ['box', 1.02, 0.015, 0.15, x, 0.14, 1.95, 'dark'],
      ...[-0.35, 0.35].flatMap((dx): Op[] => [['wheel', 0.025, 0.012, x + dx, 0.04, 1.91, 'dark'], ['wheel', 0.025, 0.012, x + dx, 0.04, 1.99, 'dark']]),
    ]),
    // a few containers by the small berth, and a lorry at the shed
    ...[2.5, 3.1, 3.7].flatMap((x, i) => [...stack(x, -0.72, 2 + (i % 2), i + 2), ...stack(x, -0.47, 1 + (i % 3), i)]),
    ...straddle(3.1, -0.2),
    ...lorry(-0.6, 1.0, 'red', 'boxGreen'),
    ...gull(0.9, 0.44, 0.45), ...gull(-1.5, 1.5, 0.35, -1),
  ] },
];

export const cargoPort: KindDef = {
  id: 'cargo-port', name: 'cargo port', code: Zone.Hub, kindId: 28, family: 'transport',
  flags: { civic: true, workplace: true }, draft: true,
  windows: 'factory',
  footprint: { w: 8, h: 6, door: [3, 5], wet: 1, fairwayClearance: 3, marks: [
    { kind: 'berth', at: { edge: 'back', from: 0, to: 4, depth: 1 }, label: 'big berth (5 tiles)' },
    { kind: 'berth', at: { edge: 'back', from: 5, to: 7, depth: 1 }, label: 'small berth (3 tiles)' },
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((x) => ({ kind: 'quay' as const, at: [x, 1] as [number, number], ...(x === 0 ? { label: 'quay and cranes' } : {}) })),
    { kind: 'gate', at: { edge: 'front', from: 2, to: 4 }, label: 'truck gate' },
  ] },
  tool: { id: 'cargoport', key: '', label: 'Cargo port (8×6)', color: '#24506e' },
  group: 'harbour', tier: 5,
  blurb: 'A container quay with two gantry cranes, a big and a small berth and a truck gate: the city\'s seaport. Ships bring containers in and take exports out, and ferries bring newcomers.',
  howTo: 'Eight tiles across and six deep: five rows on the bank with the truck gate facing a road, the back row over open water at least five tiles wide that reaches the sea. Needs Seaport.',
  occupation: staff('docker', [{ start: 6, hours: 8, weight: 0.42 }, { start: 14, hours: 8, weight: 0.38 }, { start: 22, hours: 8, weight: 0.2 }], WEEK),
  lot: { wage: 22 },
  attrs: { harbour: 'port', title: 'cargo port', noise: 4, gateway: 'sea', gatewayModes: ['foot', 'taxi'], arrivalsPerHour: 6, needsWater: true },
  levels: [{
    capacity: 70, wage: 22, cost: 14000, upkeep: 200, work: 1600, parking: { surface: 10, underground: 0 },
    designs: PORT_DESIGNS,
  }],
};

export const HARBOURS: KindDef[] = [jetty, marina, fishingHarbour, ferryPier, cargoPort];

/** marina berths: five bow-in slots a side of the spine (at x = 2), between the fingers */
const MARINA_BERTHS: BerthSlot[] = [-1, 1].flatMap((side) => Array.from({ length: 5 }, (_, i): BerthSlot => ({
  x: 2 + side * 0.45, y: 0.35 + i * 0.35, dir: side < 0 ? 1 : 3, len: 0.65, mode: 'bowIn', label: `pontoon ${side < 0 ? 'A' : 'B'}${i + 1}`,
})));

/** Berth slots by kind id string (BerthSlot above). The schedule books them; the renderer moors boats on them. */
export const HARBOUR_BERTHS: Record<string, BerthSlot[]> = {
  jetty: [
    { x: 0.3, y: 0.5, dir: 2, len: 0.45, mode: 'alongside', label: 'west side' },
    { x: 0.7, y: 0.5, dir: 2, len: 0.45, mode: 'alongside', label: 'east side' },
  ],
  marina: MARINA_BERTHS,
  'fishing-harbour': [0.7, 2.0, 3.3].map((x, i) => ({ x, y: 0.8, dir: 1 as const, len: 0.7, mode: 'alongside' as const, label: `berth ${i + 1}` })),
  // the 2-tile row outside, behind the pontoon (rail's stationStop for ferries): an outbound and an inbound boat lie nose to tail
  'ferry-pier': [{ x: 1, y: -0.5, dir: 1, len: 2, mode: 'alongside', label: 'ferry berth' }],
  'cargo-port': [
    { x: 2.5, y: 0.6, dir: 3, len: 5, mode: 'alongside', label: 'big berth' },
    { x: 6.5, y: 0.75, dir: 3, len: 3, mode: 'alongside', label: 'small berth' },
  ],
};
