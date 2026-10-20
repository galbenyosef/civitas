import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { slab, van, tree, pine, fence, PAVING, ASPHALT } from './tierkit';
import { repeat } from './helpers';

/**
 * Power (docs/utilities.md section 4): the electricity network's plants, nodes and depot, placed civic sub-kinds of the
 * transport-hub family (code 15, kind ids 160-166; 160-209 are the utilities' block). Two ladders:
 *
 * - `grid`: the substation (a node: supply spreads `nodeRadius` road steps from its door), the grid supply point (a
 *   bigger node that can bring in more of the National Grid) and the power depot (lineworkers in repair vans);
 * - `power`: the plants, a wind turbine, a solar farm, a gas and a coal power station, each generating `supply` units an
 *   hour at full staff and availability.
 *
 * The attributes the game reads (shared/src/utilities.ts flattens them by kind id): `utility`, `supply`, `nodeRadius`,
 * `nodeCapacity`, `importCap`, `pollution`, `fuel`, `availability` and `crews`.
 *
 * Per-instance variation: two designs a kind, facade tints per tile, and stack and mast tips in the `beacon` window
 * class, which blinks on a period and phase of its own per building and per light.
 */

/** Lineworkers and plant operators round the clock: a control room never sleeps, and the evening peak is the busiest. */
const OCCUPATION = {
  name: 'plant operator', rotate: true,
  shifts: [{ start: 6, hours: 8, weight: 0.35 }, { start: 14, hours: 8, weight: 0.35 }, { start: 22, hours: 8, weight: 0.3 }],
  cycles: [[1, 1, 1, 1, 0, 0, 1], [1, 1, 0, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 0]],
};
const LINEWORK = {
  name: 'lineworker', rotate: true,
  shifts: [{ start: 7, hours: 8, weight: 0.45 }, { start: 15, hours: 8, weight: 0.35 }, { start: 23, hours: 8, weight: 0.2 }],
  cycles: [[1, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 1, 1, 0], [1, 1, 0, 0, 1, 1, 1]],
};
const base = {
  code: Zone.Hub, family: 'utility' as const, flags: { civic: true, workplace: true }, windows: 'civic' as const,
  occupation: OCCUPATION, lot: { wage: 18 },
  tints: [0xffffff, 0xf2efe8, 0xeef1f4, 0xf4efe6],
};
const GRAVEL = 0xb3ab9c, CONCRETE = 0xa9acb1, TRANSFORMER = 0x7b8a7a, INSULATOR = 0xd8d2c4;

/** A transformer: a tank with cooling fins either side, bushings on top. */
const transformer = (x: number, z: number, s = 1, body: Color = TRANSFORMER): Op[] => [
  ['box', 0.18 * s, 0.14 * s, 0.13 * s, x, 0.02, z, body],
  ['box', 0.03 * s, 0.11 * s, 0.15 * s, x - 0.105 * s, 0.03, z, 0x5f6b5e], ['box', 0.03 * s, 0.11 * s, 0.15 * s, x + 0.105 * s, 0.03, z, 0x5f6b5e],
  ...[-0.05, 0, 0.05].map((dx): Op => ['cyl', 0.008 * s, 0.012 * s, 0.07 * s, x + dx * s, 0.16 * s + 0.02, z, INSULATOR, 5]),
];
/** A steel palisade round a w×d yard centred at (x, z), open where the gate is (front, middle). */
const palisade = (w: number, d: number, x = 0, z = 0, gate = 0.24): Op[] => [
  ...fence(x, z - d / 2, w, true, 0x5d6672, 0.11),
  ...fence(x - w / 2, z, d, false, 0x5d6672, 0.11), ...fence(x + w / 2, z, d, false, 0x5d6672, 0.11),
  ...fence(x - (w + gate) / 4, z + d / 2, (w - gate) / 2, true, 0x5d6672, 0.11), ...fence(x + (w + gate) / 4, z + d / 2, (w - gate) / 2, true, 0x5d6672, 0.11),
];
/** A "Danger of death" plate on the fence: yellow with a black flash. */
const danger = (x: number, z: number): Op[] => [['box', 0.05, 0.05, 0.006, x, 0.05, z, 'yellow'], ['box', 0.012, 0.03, 0.007, x, 0.06, z, 'charcoal']];
/** A busbar gantry: two lattice posts and a beam with insulators hanging from it, across x. */
const gantry = (x: number, z: number, w: number, h: number): Op[] => [
  ['box', 0.03, h, 0.03, x - w / 2, 0.02, z, 'steel'], ['box', 0.03, h, 0.03, x + w / 2, 0.02, z, 'steel'],
  ['box', w + 0.04, 0.025, 0.03, x, 0.02 + h, z, 'steel'],
  ...repeat(3, (i): Op => ['cyl', 0.008, 0.012, 0.06, x - w / 3 + (i * w) / 3, h - 0.04, z, INSULATOR, 5]),
];
/** A small control hut with a door and a flat roof. */
const hut = (x: number, z: number, w: number, d: number, h: number, body: Color = 'brick'): Op[] => [
  ['box', w, h, d, x, 0.02, z, body, true], ['box', w + 0.02, 0.02, d + 0.02, x, 0.02 + h, z, 'dark'],
];
/** A lattice pylon for a plant's or a node's line out: a tapered mast, two cross arms and an aviation tip. */
const towerOut = (x: number, z: number, h: number): Op[] => [
  ['taper', 0.12, 0.12, 0.02, 0.02, h, x, 0.02, z, 'steel'],
  ['box', 0.26, 0.016, 0.02, x, 0.02 + h * 0.62, z, 'steel'], ['box', 0.2, 0.016, 0.02, x, 0.02 + h * 0.82, z, 'steel'],
  ['box', 0.02, 0.02, 0.02, x, 0.02 + h, z, 'red', 'beacon'],
];
/** A tall stack with a red band and a beacon at the top. */
const stack = (x: number, z: number, h: number, r: number, body: Color = 'chimney'): Op[] => [
  ['cyl', r, r * 1.3, h, x, 0.02, z, body, 10],
  ['cyl', r * 1.02, r * 1.02, 0.04, x, 0.02 + h * 0.86, z, 'red', 10],
  ['box', 0.03, 0.03, 0.03, x, 0.02 + h, z, 'red', 'beacon'],
];
/** A hyperboloid cooling tower (a lathe): wide at the foot, waisted, flaring a little at the lip. */
const coolingTower = (x: number, z: number, h: number, r: number): Op[] => [
  ['lathe', x, 0.02, z, 0xc9c4ba, [r, 0, r * 0.82, h * 0.35, r * 0.62, h * 0.75, r * 0.66, h * 0.98, r * 0.66, h], { seg: 16 }],
  ['cyl', r * 0.6, r * 0.6, 0.02, x, h - 0.02, z, 0x6d6a65, 16], // the dark mouth
];
/** A three-blade wind turbine of hub height h at (x, z), the rotor turned `turn` degrees (each tower stands at its own). */
const turbine = (x: number, z: number, h: number, turn: number): Op[] => {
  const blade = h * 0.42, t = (turn * Math.PI) / 180;
  const ops: Op[] = [
    ['cyl', 0.014, 0.03, h, x, 0.02, z, 'white', 8],
    ['box', 0.05, 0.04, 0.09, x, h, z - 0.01, 'white'], // nacelle, facing the road
    ['cyl', 0.016, 0.016, 0.02, x, h + 0.01, z + 0.045, 'silver', 8],
  ];
  // the blades: thin boxes from the hub at three angles in the rotor plane (x-y), built from short segments so they lean
  for (let k = 0; k < 3; k++) {
    const a = t + (k * 2 * Math.PI) / 3;
    for (let s = 0; s < 4; s++) {
      const r = (s + 0.5) * (blade / 4);
      ops.push(['box', 0.018 - s * 0.003, 0.018 - s * 0.003, 0.008, x + Math.cos(a) * r, h + 0.02 + Math.sin(a) * r - 0.009, z + 0.05, 'white']);
    }
  }
  return ops;
};
/** A row of solar panels tilted south (towards -z, the back), n panels along x from x0 spaced dx. */
const panelRow = (x0: number, z: number, n: number, dx: number, w = 0.2, d = 0.16, color: Color = 0x23344f): Op[] =>
  repeat(n, (i): Op => ['taper', w, d, w, 0.02, 0.06, x0 + i * dx, 0.03, z, color, { shift: [0, d * 0.42] }]);
/** A rack of shipping-container-sized units (switchgear, inverters). */
const cabinet = (x: number, z: number, w: number, color: Color = 0x8e9aa6): Op[] => [['box', w, 0.1, 0.1, x, 0.02, z, color], ['box', w + 0.01, 0.01, 0.11, x, 0.12, z, 'dark']];

// ================================================================= grid 1: the substation

export const substation: KindDef = {
  ...base, id: 'substation', name: 'substation', kindId: 160, group: 'grid', tier: 1,
  occupation: LINEWORK,
  blurb: 'A fenced yard of transformers: the local node. Power spreads 10 road tiles along the streets from its gate, up to 300 units an hour, and it takes in the National Grid when a motorway connection is within reach.',
  howTo: 'One tile beside a road in the middle of the streets it should serve. Supply follows the roads, not the crow: a good street grid reaches further. Homes need power to grow to two storeys. Needs Electrification.',
  tool: { id: 'substation', key: '', label: 'Substation', color: '#d9a43a' },
  attrs: { utility: 'power', nodeRadius: 10, nodeCapacity: 300, importCap: 300, title: 'substation' },
  levels: [{
    capacity: 2, wage: 20, cost: 1500, upkeep: 25, work: 180, parking: { surface: 1, underground: 1 },
    designs: [
      { name: 'palisade yard with two transformers, a gantry and a danger plate', height: 0.42, ops: [
        slab(1, 1, GRAVEL),
        ['box', 0.84, 0.03, 0.4, 0, 0.02, -0.14, CONCRETE],
        ...transformer(-0.2, -0.14), ...transformer(0.2, -0.14),
        ...gantry(0, -0.36, 0.7, 0.34),
        ...hut(0.3, 0.26, 0.24, 0.2, 0.16),
        ...palisade(0.92, 0.92),
        ...danger(-0.24, 0.46),
      ] },
      { name: 'brick-walled compound with a transformer bay and a switch room', height: 0.4, ops: [
        slab(1, 1, GRAVEL),
        ['box', 0.9, 0.18, 0.04, 0, 0.02, -0.44, 'brick'], ['box', 0.04, 0.18, 0.86, -0.44, 0.02, 0, 'brick'], ['box', 0.04, 0.18, 0.86, 0.44, 0.02, 0, 'brick'],
        ...hut(-0.18, -0.18, 0.44, 0.4, 0.26, 'brick'),
        ['roof', 0.48, 0.1, 0.44, -0.18, 0.28, -0.18, 'slate'],
        ...transformer(0.24, -0.12, 1.1),
        ...cabinet(0.22, 0.2, 0.26),
        ...fence(0, 0.44, 0.9, true, 0x5d6672, 0.1),
        ...danger(0.18, 0.45),
        ...tree(-0.36, 0.34, 0.6),
      ] },
    ],
  }],
};

// ================================================================= grid 2: the grid supply point

export const gridSupplyPoint: KindDef = {
  ...base, id: 'grid-supply-point', name: 'grid supply point', kindId: 161, group: 'grid', tier: 2,
  occupation: LINEWORK,
  footprint: { w: 2, h: 2, door: [0, 1] },
  blurb: 'A big switching yard with gantries and busbars: a node that passes on 1,500 units an hour along 14 road tiles of street, and brings in up to 1,500 from the National Grid near a motorway connection.',
  howTo: 'Two tiles by two, the gate on a road. Put one near the motorway connection to bring the grid into a growing town, or where a power station\'s trunk line comes in. Needs Power stations.',
  tool: { id: 'gridsupply', key: '', label: 'Grid supply point (2×2)', color: '#c98f2c' },
  attrs: { utility: 'power', nodeRadius: 14, nodeCapacity: 1500, importCap: 1500, title: 'grid supply point' },
  levels: [{
    capacity: 6, wage: 22, cost: 6000, upkeep: 90, work: 520, parking: { surface: 3, underground: 3 },
    designs: [
      { name: 'switching yard: three gantries, four transformers and a control building', height: 0.72, ops: [
        slab(2, 2, GRAVEL),
        ['box', 1.7, 0.03, 0.9, 0, 0.02, -0.35, CONCRETE],
        ...gantry(-0.45, -0.75, 0.7, 0.6), ...gantry(0.45, -0.75, 0.7, 0.6), ...gantry(0, -0.2, 1.4, 0.48),
        ...transformer(-0.6, -0.4, 1.3), ...transformer(-0.2, -0.4, 1.3), ...transformer(0.2, -0.4, 1.3), ...transformer(0.6, -0.4, 1.3),
        ...hut(0.45, 0.45, 0.7, 0.38, 0.28, 'brick'),
        ...towerOut(-0.8, -0.85, 0.66),
        ...palisade(1.92, 1.92, 0, 0, 0.3),
        ...danger(-0.3, 0.96), ...danger(0.7, 0.96),
        ...van(-0.45, 0.5, 'white', 'yellow'),
      ] },
      { name: 'indoor switch hall with a transformer row and a line gantry behind', height: 0.7, ops: [
        slab(2, 2, GRAVEL),
        ['box', 1.3, 0.42, 0.6, -0.2, 0.02, 0.15, 0xd9d4ca, true, { name: 'hall', facade: { storeys: 2, bays: 6, sideBays: 3, ground: 'plain', margin: 0.06 } }],
        ['box', 1.34, 0.03, 0.64, -0.2, 0.44, 0.15, 'dark'],
        ...transformer(-0.6, -0.55, 1.2), ...transformer(-0.15, -0.55, 1.2), ...transformer(0.3, -0.55, 1.2),
        ...gantry(0, -0.85, 1.6, 0.58),
        ...cabinet(0.75, 0.2, 0.3), ...cabinet(0.75, 0.45, 0.3),
        ...towerOut(0.8, -0.8, 0.68),
        ...palisade(1.92, 1.92, 0, 0, 0.3),
        ...danger(0.3, 0.96),
      ] },
    ],
  }],
};

// ================================================================= grid 3: the power depot

export const powerDepot: KindDef = {
  ...base, id: 'power-depot', name: 'power depot', kindId: 162, group: 'grid', tier: 3, windows: 'factory',
  occupation: LINEWORK,
  footprint: { w: 2, h: 1, door: [0, 0] },
  blurb: 'A yard of cable drums and repair vans. Its lineworkers drive out to faults on your network: the sooner they get there, the sooner the lights come back.',
  howTo: 'Two tiles wide beside a road, central to your network: a fault stays dark while the van drives to it and the crew digs. Without a depot a contractor takes ten hours. Needs Power stations.',
  tool: { id: 'powerdepot', key: '', label: 'Power depot (2×1)', color: '#b07d2a' },
  attrs: { utility: 'power', crews: 1, title: 'power depot' },
  levels: [{
    capacity: 8, wage: 21, cost: 2500, upkeep: 40, work: 340, parking: { surface: 4, underground: 6 },
    designs: [
      { name: 'corrugated shed, cable drums and two vans on the yard', height: 0.42, ops: [
        slab(2, 1, ASPHALT),
        ['box', 0.9, 0.32, 0.6, -0.45, 0.02, -0.15, 'corrugated', true, { name: 'shed', facade: { storeys: 1, bays: 2, sideBays: 2, ground: 'garage' } }],
        ['roof', 0.94, 0.1, 0.64, -0.45, 0.34, -0.15, 'roofGrey'],
        ...[0.25, 0.45].map((x): Op => ['wheel', 0.09, 0.08, x, 0.11, -0.3, 0x7a5a36]),
        ['wheel', 0.07, 0.07, 0.65, 0.09, -0.3, 'charcoal'],
        ...van(0.3, 0.2, 'white', 'yellow', true), ...van(0.7, 0.1, 'white', 'yellow', true),
        ...fence(0.5, -0.46, 0.96, true, 'grey', 0.08),
      ] },
      { name: 'brick office, a vehicle bay and a pole stack', height: 0.46, ops: [
        slab(2, 1, ASPHALT),
        ['box', 0.6, 0.36, 0.5, -0.65, 0.02, -0.1, 'brick', true, { name: 'office', facade: { storeys: 2, bays: 3, sideBays: 2 } }],
        ['door', 'office', 'front', 1],
        ['box', 0.64, 0.02, 0.54, -0.65, 0.38, -0.1, 'dark'],
        ['box', 0.7, 0.26, 0.5, 0.25, 0.02, -0.18, 0xb9bdc3], ['box', 0.72, 0.02, 0.52, 0.25, 0.28, -0.18, 'dark'],
        ...repeat(5, (i): Op => ['cyl', 0.02, 0.02, 0.6, 0.62, 0.03 + i * 0.04, -0.4, 0x6e5233, 6]),
        ...van(0.05, 0.26, 'white', 'yellow', true), ...van(0.45, 0.28, 'white', 'yellow', true),
        ...tree(-0.88, 0.36, 0.55),
      ] },
    ],
  }],
};

// ================================================================= power 1: the wind turbine

export const windTurbine: KindDef = {
  ...base, id: 'wind-turbine', name: 'wind turbine', kindId: 165, group: 'power', tier: 1, windows: 'none',
  occupation: { ...OCCUPATION, name: 'wind technician', shifts: [{ start: 8, hours: 8, weight: 1 }], cycles: [[1, 1, 1, 1, 1, 0, 0]] },
  blurb: 'A white tower and a three-blade rotor: up to 40 units an hour when the wind blows, nothing to burn and next to no upkeep. Its output rises and falls with the weather.',
  howTo: 'One tile beside a road, on open ground; a row of them adds up. Pair them with a power station for the calm hours. Needs Renewables.',
  tool: { id: 'windturbine', key: '', label: 'Wind turbine', color: '#e8eef2' },
  attrs: { utility: 'power', supply: 40, availability: 'wind', pollution: 0, title: 'wind turbine' },
  levels: [{
    capacity: 1, wage: 20, cost: 900, upkeep: 8, work: 160, parking: { surface: 1, underground: 1 },
    designs: [
      { name: 'tall white tower on a grass pad, rotor at ten o\'clock', height: 1.6, ops: [
        slab(1, 1, 0x7fae63), ['cyl', 0.1, 0.12, 0.03, 0, 0.02, -0.05, CONCRETE, 10], ...turbine(0, -0.05, 1.15, 20), cabinet(0.3, 0.3, 0.14)[0],
      ] },
      { name: 'shorter tower beside its kiosk, rotor turned further', height: 1.4, ops: [
        slab(1, 1, 0x7fae63), ['cyl', 0.09, 0.11, 0.03, -0.08, 0.02, -0.1, CONCRETE, 10], ...turbine(-0.08, -0.1, 0.98, 75), ...cabinet(0.28, 0.25, 0.16), ...pine(0.36, -0.36, 0.6),
      ] },
    ],
  }],
};

// ================================================================= power 2: the solar farm

export const solarFarm: KindDef = {
  ...base, id: 'solar-farm', name: 'solar farm', kindId: 166, group: 'power', tier: 2, windows: 'none',
  occupation: { ...OCCUPATION, name: 'solar technician', shifts: [{ start: 8, hours: 8, weight: 1 }], cycles: [[1, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 1, 1, 0]] },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'Rows of panels tilted to the sun: up to 100 units an hour at noon, less morning and evening, none at night. Nothing to burn and quiet.',
  howTo: 'Two tiles by two beside a road. It covers the daytime load; the evening peak comes after sunset, so keep a power station or the grid for that. Needs Renewables.',
  tool: { id: 'solarfarm', key: '', label: 'Solar farm (2×2)', color: '#3b5a8a' },
  attrs: { utility: 'power', supply: 100, availability: 'sun', pollution: 0, title: 'solar farm' },
  levels: [{
    capacity: 2, wage: 20, cost: 3000, upkeep: 15, work: 300, parking: { surface: 1, underground: 1 },
    designs: [
      { name: 'five rows of panels, an inverter kiosk and a fence', height: 0.2, ops: [
        slab(2, 2, 0x86b06a),
        ...[0, 1, 2, 3, 4].flatMap((r) => panelRow(-0.75, -0.75 + r * 0.32, 7, 0.25)),
        ...cabinet(0.7, 0.82, 0.24),
        ...fence(0, -0.97, 1.96, true, 'grey', 0.07), ...fence(-0.97, 0, 1.96, false, 'grey', 0.07), ...fence(0.97, 0, 1.96, false, 'grey', 0.07),
      ] },
      { name: 'four long arrays with a track between them and a hedge', height: 0.2, ops: [
        slab(2, 2, 0x86b06a),
        ['box', 0.12, 0.012, 1.9, -0.05, 0.02, 0, GRAVEL],
        ...[0, 1, 2, 3].flatMap((r) => [...panelRow(-0.85, -0.7 + r * 0.42, 3, 0.26, 0.24, 0.22), ...panelRow(0.2, -0.7 + r * 0.42, 3, 0.26, 0.24, 0.22)]),
        ...cabinet(-0.05, 0.85, 0.2),
        ['box', 1.96, 0.08, 0.06, 0, 0.02, -0.95, 'hedge'],
      ] },
    ],
  }],
};

// ================================================================= power 3: the gas power station

export const gasPlant: KindDef = {
  ...base, id: 'gas-plant', name: 'gas power station', kindId: 163, group: 'power', tier: 3, windows: 'factory',
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'A turbine hall and two slim stacks: 1,200 units an hour whenever it is staffed, quick to follow the evening peak. It burns gas at $0.02 a unit and dirties the air a little.',
  howTo: 'Three tiles by three beside a road at the edge of town, near a substation whose streets reach its gate, or joined to one by pylons or a buried cable. Needs Power stations.',
  tool: { id: 'gasplant', key: '', label: 'Gas power station (3×3)', color: '#8f9aa6' },
  attrs: { utility: 'power', supply: 1200, availability: 'steady', fuel: 0.02, pollution: 3, title: 'gas power station' },
  levels: [{
    capacity: 24, wage: 24, cost: 8000, upkeep: 180, work: 900, parking: { surface: 8, underground: 12 },
    designs: [
      { name: 'clad turbine hall, two slim stacks, a transformer yard and a line tower', height: 2.0, ops: [
        slab(3, 3, PAVING),
        ['box', 1.7, 0.62, 1.0, -0.4, 0.02, -0.55, 0x9aa7b4, true, { name: 'hall', facade: { storeys: 2, bays: 8, sideBays: 4, ground: 'plain', margin: 0.06 } }],
        ['box', 1.74, 0.04, 1.04, -0.4, 0.64, -0.55, 'dark'],
        ['box', 0.9, 0.42, 0.6, -0.4, 0.66, -0.55, 0x8a96a3],
        ...stack(0.75, -0.9, 1.9, 0.07, 0xc9ccd2), ...stack(1.05, -0.9, 1.9, 0.07, 0xc9ccd2),
        ...transformer(0.85, -0.2, 1.5), ...transformer(0.85, 0.25, 1.5),
        ...towerOut(1.3, -0.1, 0.9),
        ...hut(-0.9, 0.55, 0.8, 0.5, 0.34, 'white'),
        ['box', 0.4, 0.18, 0.4, 0.2, 0.02, 0.6, 0xd6c26a], // gas reception skid
        ...fence(0, 1.46, 2.9, true, 0x5d6672, 0.1),
        ...van(0.65, 1.1, 'white', 'navy', true),
      ] },
      { name: 'brick-and-glass hall under a barrel roof, a single tall stack and a heat recovery block', height: 2.1, ops: [
        slab(3, 3, PAVING),
        ['box', 2.0, 0.55, 0.9, -0.25, 0.02, -0.6, 'brick', true, { name: 'hall', facade: { storeys: 2, bays: 9, sideBays: 4, ground: 'plain', margin: 0.05 } }],
        ['lathe', -1.25, 0.57, -0.6, 'roofGrey', [0.45, 0, 0.45, 2.0], { axis: 'x', seg: 10 }],
        ['box', 0.5, 0.9, 0.5, 1.12, 0.02, -0.75, 0x9ea4ab],
        ...stack(1.0, -0.2, 2.05, 0.09, 'chimney'),
        ...transformer(-0.9, 0.45, 1.5), ...transformer(-0.4, 0.45, 1.5),
        ...towerOut(-1.3, 0.1, 0.92),
        ...hut(0.55, 0.65, 0.7, 0.45, 0.3, 0xe7e2d8),
        ...tree(1.25, 1.2, 0.8), ...tree(-1.25, 1.25, 0.7),
      ] },
    ],
  }],
};

// ================================================================= power 4: the coal power station

export const coalPlant: KindDef = {
  ...base, id: 'coal-plant', name: 'coal power station', kindId: 164, group: 'power', tier: 4, windows: 'factory',
  footprint: { w: 4, h: 4, door: [1, 3] },
  blurb: 'A brick cathedral of power with chimneys, a coal yard and cooling towers: 2,000 units an hour at the cheapest fuel there is ($0.012 a unit), and the dirtiest.',
  howTo: 'Four tiles by four, the gate on a road, well away from homes. Its trunk line to town can run on pylons (cheap) or buried cable. Needs Power stations.',
  tool: { id: 'coalplant', key: '', label: 'Coal power station (4×4)', color: '#5a5048' },
  attrs: { utility: 'power', supply: 2000, availability: 'steady', fuel: 0.012, pollution: 8, title: 'coal power station' },
  levels: [{
    capacity: 40, wage: 23, cost: 15000, upkeep: 250, work: 1400, parking: { surface: 10, underground: 14 },
    designs: [
      { name: 'brick hall with four chimneys at the corners and a coal yard', height: 2.6, ops: [
        slab(4, 4, 0x8c877f),
        ['box', 1.8, 0.85, 1.0, -0.5, 0.02, -0.7, 'brick', true, { name: 'hall', facade: { storeys: 3, bays: 8, sideBays: 4, ground: 'plain', margin: 0.08 } }],
        ['box', 1.84, 0.05, 1.04, -0.5, 0.87, -0.7, 0x6d4c3a],
        ...stack(-1.65, -1.45, 2.4, 0.12, 0xe8e2d6), ...stack(0.65, -1.45, 2.4, 0.12, 0xe8e2d6), ...stack(-1.65, 0.05, 2.4, 0.12, 0xe8e2d6), ...stack(0.65, 0.05, 2.4, 0.12, 0xe8e2d6),
        ...repeat(3, (i): Op => ['cone', 0.3, 0.22, 1.3, 0.02, -1.4 + i * 0.6, 0x2a2a2d, 8]), // coal heaps
        ...coolingTower(1.4, 0.9, 1.4, 0.45),
        ...transformer(-0.6, 0.6, 1.6), ...transformer(-0.1, 0.6, 1.6),
        ...towerOut(-1.7, 0.9, 1.0),
        ...hut(0.4, 1.55, 0.7, 0.5, 0.3, 'brick'),
      ] },
      { name: 'concrete boiler house, one tall stack and two cooling towers by the coal stage', height: 2.9, ops: [
        slab(4, 4, 0x8c877f),
        ['box', 1.4, 1.1, 1.1, -0.8, 0.02, -0.9, 0xb7b3ab, true, { name: 'boiler', facade: { storeys: 4, bays: 6, sideBays: 4, ground: 'plain', margin: 0.06 } }],
        ['box', 1.2, 0.5, 0.9, 0.65, 0.02, -1.0, 0x9a8f80, true],
        ...stack(0.0, -1.75, 2.85, 0.16, 0xd6d1c7),
        ...coolingTower(1.2, 0.4, 1.5, 0.5), ...coolingTower(1.25, 1.45, 1.3, 0.42),
        ['box', 0.9, 0.3, 0.12, -0.5, 0.02, 0.0, 0x585048], // the conveyor gantry
        ...repeat(2, (i): Op => ['cone', 0.34, 0.25, -1.4 + i * 0.7, 0.02, 0.5, 0x2a2a2d, 8]),
        ...transformer(-1.4, 1.3, 1.6),
        ...towerOut(-1.75, 1.6, 1.0),
        ...hut(0.0, 1.6, 0.8, 0.4, 0.3, 0xe6e1d6),
      ] },
    ],
  }],
};

/** The power kinds in catalogue order (catalogue.ts lists them after the media centre). */
export const POWER: KindDef[] = [substation, gridSupplyPoint, powerDepot, windTurbine, solarFarm, gasPlant, coalPlant];
