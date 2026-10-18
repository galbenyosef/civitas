import type { KindDef, Op, OccupationDef } from './schema';
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
 * These are drafts with one placeholder design each. B7 draws the real models, two designs per kind; the berths below
 * are kind data the schedule (boats.ts) and the renderer share, so a design must leave them clear.
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

/** timber piles (posts standing on the water surface) under a deck at height h */
const piles = (pts: [number, number][], h: number): Op[] => pts.map(([x, z]): Op => ['cyl', 0.018, 0.022, h, x, 0, z, 'timber', 5]);
/** a quay wall along the back of the dry rows: a dark wall face at z0 and a stone coping strip */
const quayEdge = (w: number, z0: number): Op[] => [
  ['box', w, 0.06, 0.08, 0, 0, z0 + 0.04, WATER_STONE],
  ['box', w, 0.012, 0.1, 0, 0.06, z0 + 0.05, 'stone'],
];
/** bollards along a quay at z, x from x0 to x1 */
const bollards = (x0: number, x1: number, z: number, n: number): Op[] =>
  repeat(n, (i): Op => ['cyl', 0.014, 0.016, 0.035, x0 + ((x1 - x0) * i) / Math.max(1, n - 1), 0.072, z, 'charcoal', 6]);

const staff = (name: string, shifts: OccupationDef['shifts'], cycles: number[][], rotate = true): OccupationDef => ({ name, rotate, shifts, cycles });
const WEEK = [[1, 1, 1, 1, 1, 0, 0], [0, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 1, 1, 1]];

// ---------------------------------------------------------------- jetty (24): 1×2, the back tile over water

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
    designs: [
      { name: 'timber jetty on piles with a boathouse and a slipway (placeholder)', height: 0.42, ops: [
        ['box', 0.96, 0.02, 0.96, 0, 0, 0.5, 'gravel'],                              // hardstanding on the bank
        ['box', 0.3, 0.015, 0.5, 0.28, 0.02, 0.27, 'stone'],                        // slipway down to the water
        ['box', 0.46, 0.26, 0.4, -0.2, 0.02, 0.62, 'timber', true, { name: 'boathouse', facade: { storeys: 1, bays: 2, sideBays: 1 } }],
        ['roof', 0.52, 0.14, 0.46, -0.2, 0.28, 0.62, 'slate'],
        ['door', 'boathouse', 'front', 0],
        ...quayEdge(0.98, -0.02),
        ...piles([[-0.08, -0.15], [0.08, -0.15], [-0.08, -0.55], [0.08, -0.55], [-0.08, -0.92], [0.08, -0.92]], 0.05),
        ['box', 0.22, 0.02, 0.96, 0, 0.05, -0.5, 'timber'],                         // the planks
        ...bollards(-0.09, -0.09, -0.9, 1), ...bollards(0.09, 0.09, -0.4, 1),
        ['cyl', 0.01, 0.01, 0.3, 0.09, 0.07, -0.95, 'white', 4],                   // a lamp at the end
        ['box', 0.04, 0.04, 0.04, 0.09, 0.37, -0.95, 'white', 'civic'],
      ] },
    ],
  }],
};

// ---------------------------------------------------------------- marina (25): 4×4, two back rows over water

/** fingers off the spine at x = 0, each 0.66 long, between the berth rows of `MARINA_BERTHS` */
const fingers = (): Op[] => [-1, 1].flatMap((side) => repeat(6, (i): Op => ['box', 0.66, 0.025, 0.05, side * 0.45, 0, -1.825 + i * 0.35, PONTOON]));

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
    designs: [
      { name: 'pontoon spine with fingers, a harbourmaster\'s office and a café on the quay (placeholder)', height: 0.62, ops: [
        ['box', 3.96, 0.02, 1.96, 0, 0, 1.0, 'stone'],                               // the quay and the front row
        ['box', 1.5, 0.004, 0.7, 1.15, 0.02, 1.5, ASPHALT],                         // a car park by the road
        ['box', 1.2, 0.42, 0.6, -1.25, 0.02, 1.0, 'white', true, { name: 'office', facade: { storeys: 2, bays: 5, sideBays: 2 } }],
        ['box', 1.26, 0.03, 0.66, -1.25, 0.44, 1.0, 'navy'],
        ['door', 'office', 'front', 2],
        ['box', 0.8, 0.26, 0.5, 0.25, 0.02, 0.55, 'cream', true, { name: 'cafe', facade: { storeys: 1, bays: 4, sideBays: 2, ground: 'shopfront' } }],
        ['awning', 'cafe', 'front', 0, 3, 'navy'],
        ['box', 0.86, 0.03, 0.56, 0.25, 0.28, 0.55, 'slate'],
        ['cyl', 0.015, 0.015, 0.5, 1.7, 0.02, 0.3, 'white', 5],                    // flagstaff
        ...quayEdge(3.98, -0.02),
        ...bollards(-1.8, 1.8, 0.1, 6),
        ['box', 0.2, 0.03, 0.4, 0, 0.03, -0.2, 'steel'],                           // gangway down to the pontoons
        ['box', 0.24, 0.03, 1.9, 0, 0, -1.03, PONTOON],                            // the spine
        ...fingers(),
        ...[-1.9, -1.2, -0.5].flatMap((z) => piles([[-0.14, z], [0.14, z]], 0.1)), // piles the spine rides on
      ] },
    ],
  }],
};

// ---------------------------------------------------------------- fishing harbour (26): 4×3, the back row over water

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
    designs: [
      { name: 'stone fish quay with a market hall, an ice plant and fish boxes (placeholder)', height: 0.62, ops: [
        ['box', 3.96, 0.05, 1.96, 0, 0, 0.5, 'stone'],                               // the quay and the market yard
        ...quayEdge(3.98, -0.52),
        ...bollards(-1.7, 1.7, -0.4, 5),
        ['box', 2.2, 0.36, 0.7, -0.75, 0.05, 1.05, 'cream', true, { name: 'market', facade: { storeys: 1, bays: 7, sideBays: 2 } }],
        ['roof', 2.28, 0.18, 0.78, -0.75, 0.41, 1.05, 'corrugated'],
        ['garage', 'market', 'front', 2], ['garage', 'market', 'front', 4], ['door', 'market', 'front', 0],
        ['box', 0.6, 0.48, 0.5, 1.4, 0.05, 1.0, 'grey', true, { name: 'ice', facade: { storeys: 2, bays: 2, sideBays: 2 } }], // the ice plant
        ['cyl', 0.08, 0.08, 0.14, 1.5, 0.53, 0.95, 'silver', 8],
        ...repeat(5, (i): Op => ['box', 0.12, 0.06, 0.08, -1.5 + i * 0.16, 0.05, 0.1, i % 2 ? 'boxBlue' : 'red']), // fish boxes on the quay
        ['box', 0.12, 0.06, 0.08, -1.42, 0.11, 0.1, 'boxOrange'],
        ['cyl', 0.012, 0.012, 0.42, 1.85, 0.05, -0.35, 'steel', 5],                 // quay lamp
        ['box', 0.08, 0.03, 0.05, 1.85, 0.47, -0.35, 'white', 'civic'],
      ] },
    ],
  }],
};

// ---------------------------------------------------------------- ferry pier (27): 2×2, the pontoon over water

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
    designs: [
      { name: 'pontoon with a canopy, a gangway and a ticket office on the bank (placeholder)', height: 0.5, ops: [
        ['box', 1.96, 0.02, 0.96, 0, 0, 0.5, 'stone'],                               // the riverside walk
        ['box', 0.6, 0.3, 0.4, -0.55, 0.02, 0.62, 'navy', true, { name: 'ticket', facade: { storeys: 1, bays: 3, sideBays: 2 } }],
        ['door', 'ticket', 'front', 1],
        ['box', 0.66, 0.03, 0.46, -0.55, 0.32, 0.62, 'white'],
        ...quayEdge(1.98, -0.02),
        ['box', 0.2, 0.03, 0.46, 0.45, 0.02, -0.23, 'steel'],                       // the gangway
        ['box', 1.9, 0.04, 0.5, 0, 0, -0.74, PONTOON],                              // the pontoon, along the back edge
        ['box', 1.9, 0.012, 0.04, 0, 0.04, -0.97, 'yellow'],                        // edge line where the boats lie
        ...[-0.75, 0, 0.75].flatMap((x): Op[] => [['cyl', 0.014, 0.014, 0.26, x, 0.04, -0.6, 'steel', 5]]),
        ['box', 1.7, 0.025, 0.36, 0, 0.3, -0.7, 'white'],                           // canopy
        ['box', 0.5, 0.08, 0.02, -0.4, 0.33, -0.52, 'navy'],                        // pier name board
      ] },
    ],
  }],
};

// ---------------------------------------------------------------- cargo port (28): 8×6, the back row over water

const CONTAINERS = ['boxBlue', 'boxOrange', 'boxGreen', 'red', 'navy', 'grey'] as const;
/** a stack of n containers at (x, z), coloured from k */
const stack = (x: number, z: number, n: number, k: number): Op[] =>
  repeat(n, (i): Op => ['box', 0.5, 0.18, 0.22, x, 0.02 + i * 0.185, z, CONTAINERS[(k + i * 5) % CONTAINERS.length]]);
/** a ship-to-shore gantry crane on the quay at x: legs on the rails at z -1.85 and -1.15, the boom out over the berth */
const gantry = (x: number): Op[] => [
  ...[-0.22, 0.22].flatMap((dx): Op[] => [-1.85, -1.15].map((z): Op => ['box', 0.07, 1.2, 0.07, x + dx, 0.06, z, 'red'])),
  ...[-0.22, 0.22].map((dx): Op => ['box', 0.07, 0.07, 1.96, x + dx, 1.26, -1.98, 'red']),        // the boom, out over the water
  ['box', 0.5, 0.07, 0.07, x, 1.26, -1.5, 'red'],
  ['box', 0.3, 0.16, 0.3, x, 1.33, -1.25, 'white', 'factory'],                                    // machinery house
  ['box', 0.16, 0.1, 0.16, x, 1.16, -2.6, 'dark'],                                                // trolley and cab over the berth
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
    designs: [
      { name: 'container quay with two gantry cranes, stacks, a transit shed and a gatehouse (placeholder)', height: 1.5, ops: [
        ['box', 7.96, 0.02, 3.96, 0, 0, 1.0, ASPHALT],                               // the yard
        ['box', 7.96, 0.06, 0.98, 0, 0, -1.5, 'grey'],                               // the quay apron
        ...[-1.85, -1.15].map((z): Op => ['box', 7.9, 0.008, 0.03, 0, 0.06, z, 'steel']), // crane rails
        ...quayEdge(7.98, -2.02),
        ...bollards(-3.8, 3.8, -1.9, 9),
        ...gantry(-2.2), ...gantry(0.6),
        // container stacks in the two middle rows
        ...[-3.2, -2.6, -2.0, -1.4].flatMap((x, i) => [...stack(x, -0.7, 1 + (i % 3), i), ...stack(x, -0.4, 2 - (i % 2), i + 2)]),
        ...[0.4, 1.0, 1.6].flatMap((x, i) => [...stack(x, -0.7, 3 - i, i + 1), ...stack(x, -0.4, 1 + i, i + 3)]),
        // the transit shed
        ['box', 2.4, 0.5, 0.9, 2.6, 0.02, 0.35, 'corrugated', true, { name: 'shed', facade: { storeys: 1, bays: 8, sideBays: 3 } }],
        ['roof', 2.48, 0.14, 0.98, 2.6, 0.52, 0.35, 'roofGrey'],
        ['garage', 'shed', 'front', 2], ['garage', 'shed', 'front', 5],
        // the gatehouse, barrier and lamps at the truck gate
        ['box', 0.42, 0.3, 0.36, 0.4, 0.02, 2.55, 'white', true, { name: 'gate', facade: { storeys: 1, bays: 2, sideBays: 2 } }],
        ['box', 0.48, 0.03, 0.42, 0.4, 0.32, 2.55, 'charcoal'],
        ['box', 0.7, 0.03, 0.03, -0.4, 0.2, 2.8, 'red'], ['box', 0.06, 0.2, 0.06, -0.02, 0.02, 2.8, 'grey'],
        ...[-3.85, 3.85].flatMap((x): Op[] => [['cyl', 0.016, 0.02, 1.1, x, 0.02, 2.6, 'steel', 5], ['box', 0.14, 0.05, 0.08, x, 1.12, 2.6, 'white', 'factory']]),
      ] },
    ],
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
