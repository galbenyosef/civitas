import type { KindDef, Op, OccupationDef } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';

/**
 * Underground railway stations (docs/underground.md section 2): two transport-hub sub-kinds (code 15, kind ids 22
 * and 23) that are only the surface half of a station. The platform is a straight run of tiles in the under layer
 * directly beneath the door tile (shared/src/metro.ts); everything here is the entrance a rider walks into.
 *
 * Recipes are authored in tiles for the whole footprint: x -w/2..w/2, z -h/2..h/2, +z faces the road.
 */
const OX = 0x7a2b28;      // oxblood glazed terracotta
const FAIENCE = 0xe6dcc2; // cream faience for the surrounds
const BLUE = 0x1f3f9a, RED = 0xdc241f; // the roundel

const staff = (name: string): OccupationDef => ({
  name, rotate: true,
  // the metro runs 05:00-01:00 like rail: an early turn, a late turn and an evening turn that closes the station
  shifts: [{ start: 5, hours: 8, weight: 0.45 }, { start: 13, hours: 8, weight: 0.4 }, { start: 17, hours: 8, weight: 0.15 }],
  cycles: [[1, 1, 1, 1, 0, 0, 1], [1, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 1, 1, 0]],
});

/** the red ring, white disc and blue bar, facing +z, centred at (x, y) with its back at z */
const roundel = (x: number, y: number, z: number, r: number): Op[] => [
  ['lathe', x, y, z, RED, [r, 0, r, 0.014], { seg: 16, axis: 'z' }],
  ['lathe', x, y, z, 'white', [r * 0.68, 0, r * 0.68, 0.018], { seg: 16, axis: 'z' }],
  ['box', r * 2.5, r * 0.4, 0.01, x, y - r * 0.2, z + 0.015, BLUE],
];
/** a post with a roundel on top (a street totem) */
const roundelPost = (x: number, z: number, h: number, r: number): Op[] => [
  ['cyl', 0.012, 0.012, h, x, 0.015, z, 'steel', 5],
  ...roundel(x, 0.015 + h + r * 0.5, z + 0.012, r),
];
/** a lit arched window on a plain wall whose face is at z: faience surround, a window box and an arched head */
const archWindow = (x: number, y0: number, z: number, w: number, h: number): Op[] => [
  ['box', w + 0.04, h, 0.008, x, y0, z + 0.004, FAIENCE],
  ['lathe', x, y0 + h, z, FAIENCE, [w / 2 + 0.02, 0, w / 2 + 0.02, 0.008], { seg: 12, axis: 'z' }],
  ['box', w, h, 0.012, x, y0, z + 0.006, 'glassDark', true, { name: `w${Math.round(x * 100)}_${Math.round(y0 * 100)}`, facade: { storeys: 1, bays: 1, sideBays: 0 } }],
  ['lathe', x, y0 + h, z, 'glassDark', [w / 2, 0, w / 2, 0.01], { seg: 12, axis: 'z', win: 'civic' }],
];
/** railings: posts every 0.25 and two rails along z, at x, from z0 to z1 */
const railing = (x: number, z0: number, z1: number): Op[] => {
  const n = Math.max(1, Math.round((z1 - z0) / 0.25)), len = z1 - z0;
  return [
    ...repeat(n + 1, (i): Op => ['cyl', 0.008, 0.008, 0.13, x, 0.015, z0 + (len * i) / n, 'charcoal', 4]),
    ['box', 0.012, 0.012, len, x, 0.135, (z0 + z1) / 2, 'charcoal'], ['box', 0.01, 0.01, len, x, 0.085, (z0 + z1) / 2, 'charcoal'],
  ];
};

export const metroEntrance: KindDef = {
  id: 'metro-entrance', name: 'metro entrance', code: Zone.Hub, kindId: 22, family: 'transport',
  flags: { civic: true, workplace: true },
  windows: 'civic',
  tool: { id: 'metroentrance', key: '', label: 'Metro entrance (1×1)', color: '#dc241f' },
  group: 'metro', tier: 1,
  blurb: 'A stair kiosk down to a four-tile platform under the street, with four staff. Trains of the metro lines that call here stop with their middle under the door, and riders get on and off.',
  howTo: 'One tile on your land beside a road. The four-tile platform lies under the kiosk door and runs along the street (Z and C turn it a quarter), so it needs clear ground or a plain tunnel for four tiles. Then add it to a metro line in the Lines panel. Needs Underground railway.',
  occupation: staff('station staff'),
  lot: { wage: 20 },
  levels: [{
    capacity: 4, wage: 20, cost: 3000, upkeep: 40, work: 200, parking: { surface: 0, underground: 0 },
    attrs: { platformTiles: 4, title: 'metro entrance' },
    designs: [
      { name: 'stair kiosk in oxblood terracotta with railings round the stairwell and a roundel on a post', height: 0.6, ops: [
        ['box', 0.96, 0.015, 0.96, 0, 0, 0, 'stone'],                              // paving
        ['box', 0.56, 0.26, 0.26, -0.08, 0.015, -0.3, OX, true, { name: 'kiosk', facade: { storeys: 1, bays: 3, sideBays: 0, ground: 'windows' } }],
        ['door', 'kiosk', 'front', 1],
        ['box', 0.6, 0.03, 0.3, -0.08, 0.275, -0.3, 'charcoal'],                   // roof slab
        ['box', 0.46, 0.06, 0.02, -0.08, 0.305, -0.15, 'navy'], ['box', 0.3, 0.016, 0.022, -0.08, 0.327, -0.15, 'white'], // name board
        ['box', 0.3, 0.004, 0.5, -0.08, 0.015, 0.15, 'dark'],                      // the stairwell
        ...repeat(5, (i): Op => ['box', 0.3, 0.003, 0.025, -0.08, 0.019, -0.05 + i * 0.1, 'charcoal']), // steps going down
        ...railing(-0.25, -0.1, 0.4), ...railing(0.09, -0.1, 0.4),
        ...roundelPost(0.36, 0.34, 0.46, 0.075),
        ['box', 0.07, 0.1, 0.07, 0.38, 0.015, -0.3, 'green'],                      // litter bin
      ] },
      { name: 'glass escalator canopy on a steel frame, a roundel totem at the kerb', height: 0.56, ops: [
        ['box', 0.96, 0.015, 0.96, 0, 0, 0, 'grey'],                               // paving
        ['box', 0.4, 0.004, 0.56, 0, 0.015, 0, 'dark'],                            // the escalator well
        ...repeat(7, (i): Op => ['box', 0.34, 0.003, 0.02, 0, 0.019, -0.24 + i * 0.08, 'steel']), // the moving treads
        ...[-0.1, 0.1].map((x): Op => ['box', 0.025, 0.045, 0.56, x, 0.015, 0, 'charcoal']),      // handrails
        ...[-0.24, 0.24].flatMap((x): Op[] => [-0.3, 0.3].map((z): Op => ['cyl', 0.012, 0.012, 0.28, x, 0.015, z, 'steel', 5])), // frame posts
        ['box', 0.02, 0.28, 0.62, -0.25, 0.015, 0, 'mint'], ['box', 0.02, 0.28, 0.62, 0.25, 0.015, 0, 'mint'],
        ['box', 0.46, 0.28, 0.02, 0, 0.015, -0.32, 'mint'],                       // back pane
        ['roof', 0.58, 0.1, 0.74, 0, 0.295, 0, 'pale', true],                     // glazed barrel roof, ridge along z
        ['box', 0.04, 0.025, 0.74, 0, 0.395, 0, 'steel'],                          // ridge beam
        ['box', 0.54, 0.02, 0.03, 0, 0.295, 0.34, 'charcoal'],                     // front header
        ['box', 0.1, 0.5, 0.05, 0.38, 0.015, 0.36, 'charcoal'],                    // the totem
        ...roundel(0.38, 0.45, 0.385, 0.05),
        ['box', 0.07, 0.1, 0.07, -0.38, 0.015, 0.34, 'green'],                     // litter bin
      ] },
    ],
  }],
};

export const metroStation: KindDef = {
  id: 'metro-station', name: 'metro station', code: Zone.Hub, kindId: 23, family: 'transport',
  flags: { civic: true, workplace: true },
  windows: 'civic',
  footprint: { w: 2, h: 1, door: [0, 0] },
  tool: { id: 'metrostation', key: '', label: 'Metro station (2×1)', color: '#a3141a' },
  group: 'metro', tier: 2,
  blurb: 'A station hall over a six-tile platform, with fourteen staff and room for the longest trains. A train is as long as the shortest platform on its line allows.',
  howTo: 'Two tiles across and one deep: the door is the left tile when you face the road, and the six-tile platform lies under the door and runs along the street (Z and C turn it). Needs clear ground or a plain tunnel for six tiles. Needs Underground railway.',
  occupation: staff('station staff'),
  lot: { wage: 20 },
  levels: [{
    capacity: 14, wage: 20, cost: 8000, upkeep: 120, work: 400, parking: { surface: 2, underground: 6 },
    attrs: { platformTiles: 6, title: 'metro station' },
    designs: [
      { name: 'oxblood terracotta hall with arched windows, a faience cornice and a roundel over the door', height: 0.66, ops: [
        ['box', 1.96, 0.03, 0.96, 0, 0, 0, 'stone'],                               // plinth
        ['box', 1.76, 0.5, 0.76, 0, 0.03, -0.04, OX],                              // the hall (plain wall; the windows stand proud of it)
        ['box', 1.78, 0.02, 0.77, 0, 0.28, -0.04, FAIENCE],                        // string course between the floors
        // the door: a faience arch with a dark door under it
        ['box', 0.26, 0.15, 0.01, -0.5, 0.03, 0.345, FAIENCE],
        ['lathe', -0.5, 0.18, 0.34, FAIENCE, [0.13, 0, 0.13, 0.006], { seg: 12, axis: 'z' }],
        ['box', 0.22, 0.12, 0.02, -0.5, 0.03, 0.345, 'door'],
        ['lathe', -0.5, 0.15, 0.34, 'door', [0.11, 0, 0.11, 0.014], { seg: 12, axis: 'z' }],
        ...[-0.2, 0.2, 0.6].flatMap((x) => archWindow(x, 0.06, 0.34, 0.2, 0.1)),    // ground floor
        ...[-0.78, -0.2, 0.2, 0.6].flatMap((x) => archWindow(x, 0.3, 0.34, 0.12, 0.1)), // first floor
        ...roundel(-0.5, 0.4, 0.34, 0.09),
        ['box', 1.84, 0.03, 0.82, 0, 0.53, -0.04, FAIENCE],                        // cornice
        ['box', 1.76, 0.04, 0.76, 0, 0.56, -0.04, OX],                             // parapet
        ['box', 1.7, 0.01, 0.7, 0, 0.6, -0.04, 'slate'],
        ['box', 0.5, 0.05, 0.3, 0.45, 0.6, -0.12, 'glass'], ['roof', 0.54, 0.04, 0.34, 0.45, 0.65, -0.12, 'glassDark'], // skylight over the booking hall
        ['cyl', 0.05, 0.05, 0.1, -0.7, 0.6, -0.2, OX, 8],                          // vent stack
        ...roundelPost(0.9, 0.44, 0.4, 0.06),
        ['box', 0.07, 0.1, 0.07, 0.9, 0.015, -0.4, 'green'],
      ] },
      { name: 'brick drum under a copper dome with a glazed frieze and roundels, a booking hall beside it', height: 0.74, ops: [
        ['box', 1.96, 0.03, 0.96, 0, 0, 0, 'stone'],                               // plinth
        ['cyl', 0.4, 0.4, 0.31, -0.5, 0.03, 0, 'brick', 14],                       // the drum
        ['lathe', -0.5, 0.34, 0, 'glass', [0.405, 0, 0.405, 0.1], { seg: 14, win: 'civic', stripe: RED, every: 7, width: 1 }], // glazed frieze
        ['cyl', 0.42, 0.42, 0.025, -0.5, 0.44, 0, 'stone', 14],                    // cornice ring
        ['cone', 0.4, 0.16, -0.5, 0.465, 0, 'green', 14],                          // the dome
        ['cyl', 0.05, 0.05, 0.05, -0.5, 0.62, 0, 'stone', 8], ['cone', 0.06, 0.07, -0.5, 0.67, 0, 'green', 8], // lantern
        ['box', 0.16, 0.14, 0.04, -0.5, 0.03, 0.41, 'door'],                       // door
        ['box', 0.24, 0.02, 0.1, -0.5, 0.17, 0.42, FAIENCE],                       // porch hood
        ...roundel(-0.5, 0.27, 0.4, 0.06),
        // the booking hall
        ['box', 0.9, 0.26, 0.7, 0.5, 0.03, 0, 'brick', true, { name: 'wing', facade: { storeys: 1, bays: 4, sideBays: 0, ground: 'windows' } }],
        ['door', 'wing', 'front', 1],
        ['box', 0.96, 0.03, 0.76, 0.5, 0.29, 0, 'slate'],
        ['box', 0.92, 0.02, 0.72, 0.5, 0.32, 0, FAIENCE],
        ['cyl', 0.04, 0.04, 0.16, 0.8, 0.34, -0.2, 'brick', 6],                    // ventilation stack
        ...roundelPost(0.9, 0.44, 0.4, 0.06),
      ] },
    ],
  }],
};
