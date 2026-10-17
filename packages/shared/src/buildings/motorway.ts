import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';

/**
 * The motorway connection: the town's road link to the rest of the world (the gateways card). A 2×3 transport-hub
 * sub-kind (code 15, kind id 21) placed by its door on the road, ideally at a road end on the edge of town; the
 * dual carriageway runs off the back of the footprint towards a ring road or another city, which is hand-waved.
 * Newcomers who own a car drive in through it, leavers drive out, and through-traffic (visitors) and inter-city
 * freight enter and leave town here instead of at the farthest road tile (server sim/gateways.ts).
 *
 * Recipes are authored in tiles for the whole footprint: x -1..1 across the two carriageways, z -1.5..1.5, +z the
 * road side. The front row is the junction apron where the slip roads meet the town road.
 */
const ASPHALT = 0x3a3d44, ASPHALT_WORN = 0x464a52, BARRIER = 0xb9bec6;

/** a carriageway centred on x running from the back edge to z1, with its lane divider dashes and edge lines */
const carriageway = (x: number, z1: number, tone: number): Op[] => {
  const z0 = -1.5, len = z1 - z0, mid = (z0 + z1) / 2;
  return [
    ['box', 0.78, 0.02, len, x, 0, mid, tone],
    ['box', 0.02, 0.004, len, x - 0.35, 0.02, mid, 'white'],                 // edge lines
    ['box', 0.02, 0.004, len, x + 0.35, 0.02, mid, 'white'],
    ...repeat(Math.floor(len / 0.3), (i): Op => ['box', 0.018, 0.004, 0.14, x, 0.02, z0 + 0.12 + i * 0.3, 'white']), // lane divider
  ];
};
/** the central reservation: a grass strip with a steel barrier down the middle */
const reservation = (z1: number): Op[] => {
  const z0 = -1.5, len = z1 - z0, mid = (z0 + z1) / 2;
  return [
    ['box', 0.2, 0.03, len, 0, 0, mid, 'lawnDark'],
    ['box', 0.03, 0.05, len, -0.03, 0.03, mid, BARRIER], ['box', 0.03, 0.05, len, 0.03, 0.03, mid, BARRIER],
  ];
};
/** blue overhead gantry at z with a direction board over each carriageway */
const gantry = (z: number, h: number): Op[] => [
  ['cyl', 0.025, 0.03, h, -0.95, 0, z, 'steel', 6], ['cyl', 0.025, 0.03, h, 0.95, 0, z, 'steel', 6],
  ['box', 1.94, 0.05, 0.05, 0, h - 0.02, z, 'steel'],
  ['box', 0.66, 0.22, 0.03, -0.5, h - 0.24, z + 0.03, 'signBlue'], ['box', 0.66, 0.22, 0.03, 0.5, h - 0.24, z + 0.03, 'signBlue'],
  ['box', 0.44, 0.03, 0.032, -0.5, h - 0.12, z + 0.03, 'white'], ['box', 0.3, 0.03, 0.032, -0.55, h - 0.18, z + 0.03, 'white'],
  ['box', 0.44, 0.03, 0.032, 0.5, h - 0.12, z + 0.03, 'white'], ['box', 0.36, 0.03, 0.032, 0.45, h - 0.18, z + 0.03, 'white'],
  ['box', 0.08, 0.08, 0.034, -0.72, h - 0.16, z + 0.03, 'white'], ['box', 0.08, 0.08, 0.034, 0.28, h - 0.16, z + 0.03, 'white'], // junction numbers
];
/** a blue roadside board on two legs, facing the town road */
const roadsideSign = (x: number, z: number, w: number): Op[] => [
  ['cyl', 0.014, 0.014, 0.42, x - w * 0.38, 0, z, 'steel', 5], ['cyl', 0.014, 0.014, 0.42, x + w * 0.38, 0, z, 'steel', 5],
  ['box', w, 0.26, 0.025, x, 0.3, z, 'signBlue'],
  ['box', w * 0.7, 0.03, 0.027, x, 0.47, z, 'white'], ['box', w * 0.5, 0.03, 0.027, x - w * 0.1, 0.41, z, 'white'],
  ['box', 0.1, 0.1, 0.028, x + w * 0.32, 0.38, z, 'white'],
];
/** lamp columns with twin arms on the reservation */
const lamps = (zs: number[]): Op[] => zs.flatMap((z): Op[] => [
  ['cyl', 0.012, 0.016, 0.62, 0, 0.03, z, 'steel', 5],
  ['box', 0.36, 0.015, 0.02, 0, 0.64, z, 'steel'],
  ['box', 0.08, 0.025, 0.05, -0.18, 0.62, z, 'white', 'civic'], ['box', 0.08, 0.025, 0.05, 0.18, 0.62, z, 'white', 'civic'],
]);
/** the junction apron on the front row where the slip roads meet the town road */
const apron = (tone: number): Op[] => [
  ['box', 1.98, 0.02, 0.98, 0, 0, 1.0, tone],
  ['box', 1.9, 0.004, 0.03, 0, 0.02, 1.44, 'white'],                         // give-way line at the town road
  ...repeat(6, (i): Op => ['box', 0.08, 0.004, 0.03, -0.75 + i * 0.3, 0.02, 1.38, 'white']),
  ['box', 0.36, 0.03, 0.5, 0, 0, 0.88, 'stone'], ['box', 0.3, 0.02, 0.44, 0, 0.03, 0.88, 'lawn'], // splitter island
];
const verge = (): Op[] => [['box', 1.99, 0.012, 2.99, 0, 0, 0, 'lawn']];

export const motorwayStub: KindDef = {
  id: 'motorway', name: 'motorway connection', code: Zone.Hub, kindId: 21, family: 'transport',
  flags: { civic: true },
  windows: 'none',
  footprint: { w: 2, h: 3, door: [1, 2], marks: [{ kind: 'gate', at: { edge: 'back' }, label: 'to the motorway' }, { kind: 'gate', at: { edge: 'front' }, label: 'slip roads' }] },
  tool: { id: 'motorway', key: '', label: 'Motorway connection (2×3)', color: '#2f8fd6' },
  blurb: 'The road out of town. Newcomers with a car drive in here, people leaving drive out, and visitors and inter-city freight trucks come and go through it instead of appearing at the edge of the road network.',
  howTo: 'Two tiles across and three deep, the junction facing the end of a road on the edge of town (Z and C turn it). One is enough to start; a second on another side brings more visitors in. No technology needed.',
  attrs: { gateway: 'motorway', gatewayModes: ['car', 'taxi'], arrivalsPerHour: 30 },
  levels: [{
    capacity: 0, cost: 400, upkeep: 6, work: 300, parking: { surface: 0, underground: 0 },
    designs: [
      { name: 'dual carriageway end under a blue gantry, lamp columns on the reservation', height: 0.82, ops: [
        ...verge(),
        ...carriageway(-0.5, 0.5, ASPHALT), ...carriageway(0.5, 0.5, ASPHALT),
        ...reservation(0.6),
        ...apron(ASPHALT),
        ...gantry(-0.6, 0.82),
        ...lamps([-1.2, 0.2]),
        ['box', 0.03, 0.04, 2.0, -0.95, 0.02, -0.5, BARRIER], ['box', 0.03, 0.04, 2.0, 0.95, 0.02, -0.5, BARRIER], // outer barriers
      ] },
      { name: 'motorway spur with a roadside direction board and chevrons at the slip', height: 0.6, ops: [
        ...verge(),
        ...carriageway(-0.5, 0.5, ASPHALT_WORN), ...carriageway(0.5, 0.5, ASPHALT_WORN),
        ...reservation(0.6),
        ...apron(ASPHALT_WORN),
        ...roadsideSign(-0.62, 0.4, 0.62),
        ...lamps([-0.6]),
        ...repeat(3, (i): Op => ['box', 0.1, 0.1, 0.02, 0.62 + i * 0.12, 0.08, 0.42, i % 2 ? 'white' : 'signBlue']), // chevron boards
        ['box', 0.03, 0.04, 2.0, -0.95, 0.02, -0.5, BARRIER], ['box', 0.03, 0.04, 2.0, 0.95, 0.02, -0.5, BARRIER],
      ] },
    ],
  }],
};
