import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';

/**
 * The pioneer camp (Audit #1, docs/start-from-zero.md B1): a new player's first settlers. A 2×2 residential sub-kind
 * (family code 1, kind id 120) placed like a civic structure, by its door on a road, that opens at once with no
 * construction site; its eight beds are offered to newcomers straight away (server sim/simulation.ts campSettlers),
 * and the simulation serves it as a level-1 home ever after. It never grows, merges or upgrades (no `growable` flag),
 * one per player stands at a time (net.ts), and bulldozing it rehomes its people nearby or sees them off.
 *
 * Recipes are authored for the whole footprint: x and z -1..1, +z the road side. Lamps and the fire pit carry the
 * `fire` window class: they glow from dusk and flicker on their own phase per camp (render/materials.ts).
 */
const GRASS = 0x8aa65e, TRAMPLED = 0x9c9a6a, CANVAS = 0xe9dfc4;

/** A ridge tent: a canvas prism with a dark door flap on the front, guy-line pegs at the corners. */
const ridgeTent = (x: number, z: number, w: number, d: number, h: number, colour: Color, alongZ = true): Op[] => [
  ['box', alongZ ? w + 0.06 : w + 0.1, 0.012, alongZ ? d + 0.1 : d + 0.06, x, 0.014, z, 'dark'], // groundsheet shadow
  ['roof', w, h, d, x, 0.02, z, colour, alongZ],
  alongZ ? ['box', w * 0.34, h * 0.62, 0.012, x, 0.02, z + d / 2 + 0.002, 'charcoal'] : ['box', 0.012, h * 0.62, d * 0.34, x + w / 2 + 0.002, 0.02, z, 'charcoal'],
  ...repeat(4, (i): Op => ['box', 0.012, 0.03, 0.012, x + (i & 1 ? 1 : -1) * (w / 2 + 0.05), 0.014, z + (i & 2 ? 1 : -1) * (d / 2 + 0.05), 'steel']),
];

/**
 * A touring caravan lying along z, hitch towards the road: a plain lower body with wheels and a stripe, and the living
 * box above it laid out as a facade (one window per bay, lit at night as a home), with its door on the left side.
 */
const caravan = (name: string, x: number, z: number, body: Color, stripe: Color, len = 0.5): Op[] => [
  ['box', 0.22, 0.07, len, x, 0.07, z, body],
  ['box', 0.225, 0.02, len + 0.005, x, 0.138, z, stripe],
  ['box', 0.22, 0.11, len, x, 0.162, z, body, 'home', { name, facade: { storeys: 1, bays: 1, sideBays: 3 } }],
  ['door', name, 'left', 2],
  ['box', 0.2, 0.02, len - 0.04, x, 0.272, z, 'white'],
  ['box', 0.08, 0.02, 0.1, x, 0.292, z - len * 0.15, 'grey'],                     // roof light
  ['wheel', 0.045, 0.03, x - 0.11, 0.045, z - 0.03, 'charcoal'],
  ['wheel', 0.045, 0.03, x + 0.11, 0.045, z - 0.03, 'charcoal'],
  ['box', 0.02, 0.02, 0.16, x, 0.06, z + len / 2 + 0.08, 'dark'],                // A-frame and hitch
  ['box', 0.03, 0.06, 0.03, x, 0.0, z + len / 2 + 0.15, 'dark'],                 // jockey wheel post
  ['box', 0.06, 0.012, 0.09, x - 0.15, 0.03, z - len / 6, 'grey'],              // step
];

/** The fire pit: a stone ring, ash, crossed logs and two flame blocks (`fire`), with log seats round it. */
const firePit = (x: number, z: number, seats: number, turn = 0): Op[] => [
  ['cyl', 0.13, 0.14, 0.04, x, 0.012, z, 'stone', 10],
  ['cyl', 0.095, 0.095, 0.045, x, 0.012, z, 'charcoal', 10],
  ['box', 0.17, 0.025, 0.035, x, 0.05, z, 'timber'],
  ['box', 0.035, 0.025, 0.17, x, 0.06, z, 'timber'],
  ['box', 0.07, 0.08, 0.07, x, 0.06, z, 'flare', 'fire'],
  ['box', 0.04, 0.07, 0.04, x + 0.012, 0.13, z - 0.01, 0xffd27a, 'fire'],
  ...repeat(seats, (i): Op => {
    const a = turn + (i / seats) * Math.PI * 2, r = 0.29;
    const along = Math.abs(Math.cos(a)) > 0.7;
    return ['box', along ? 0.05 : 0.17, 0.05, along ? 0.17 : 0.05, x + Math.cos(a) * r, 0.012, z + Math.sin(a) * r, 'brown'];
  }),
];

/** A lantern on a post: the lamp head glows (`fire`). */
const lanternPost = (x: number, z: number, h = 0.34): Op[] => [
  ['cyl', 0.008, 0.01, h, x, 0.012, z, 'timber', 5],
  ['box', 0.07, 0.008, 0.008, x + 0.03, h - 0.01, z, 'dark'],
  ['box', 0.04, 0.05, 0.04, x + 0.06, h - 0.07, z, 'marquee', 'fire'],
  ['box', 0.05, 0.01, 0.05, x + 0.06, h - 0.02, z, 'dark'],
];

/** Festoon lights on a wire between two posts along x at z: n bulbs (`fire`). */
const festoon = (x0: number, x1: number, z: number, n: number, h = 0.36): Op[] => [
  ['cyl', 0.008, 0.01, h, x0, 0.012, z, 'timber', 5], ['cyl', 0.008, 0.01, h, x1, 0.012, z, 'timber', 5],
  ['box', x1 - x0, 0.004, 0.004, (x0 + x1) / 2, h - 0.03, z, 'dark'],
  ...repeat(n, (i): Op => ['box', 0.022, 0.028, 0.022, x0 + ((i + 0.5) / n) * (x1 - x0), h - 0.07 + 0.02 * Math.abs(i - (n - 1) / 2) / n, z, 'marquee', 'fire']),
];

/** A washing line between two posts along z at x, with a few things pegged out. */
const washing = (x: number, z0: number, z1: number): Op[] => {
  const cloth: Color[] = ['white', 0x3b6ea5, 'red', 'yellow', 0x7aa36a];
  return [
    ['cyl', 0.007, 0.007, 0.26, x, 0.012, z0, 'timber', 5], ['cyl', 0.007, 0.007, 0.26, x, 0.012, z1, 'timber', 5],
    ['box', 0.003, 0.003, z1 - z0, x, 0.26, (z0 + z1) / 2, 'grey'],
    ...repeat(4, (i): Op => ['box', 0.006, 0.06 + 0.02 * (i % 2), 0.06, x, 0.26 - 0.06 - 0.02 * (i % 2), z0 + ((i + 0.7) / 4.4) * (z1 - z0), cloth[i % cloth.length]]),
  ];
};

/** A bell tent: a round canvas wall under a cone, a pole cap and a dark doorway facing +z. */
const bellTent = (x: number, z: number, r: number, colour: Color): Op[] => [
  ['cyl', r + 0.02, r + 0.02, 0.012, x, 0.012, z, 'dark', 12],
  ['cyl', r, r, 0.1, x, 0.02, z, colour, 12],
  ['cone', r + 0.02, r * 1.05, x, 0.12, z, colour, 12],
  ['cyl', 0.008, 0.008, 0.06, x, 0.12 + r * 1.05 - 0.01, z, 'timber', 5],
  ['box', 0.1, 0.09, 0.02, x, 0.02, z + r - 0.005, 'charcoal'],
];

/** A low dome tent (lathe). */
const domeTent = (x: number, z: number, r: number, colour: Color): Op[] => [
  ['lathe', x, 0.015, z, colour, [r, 0, r * 0.94, 0.05, r * 0.72, 0.1, r * 0.38, 0.14, 0, 0.155], { seg: 10 }],
  ['box', 0.06, 0.07, 0.012, x, 0.015, z + r * 0.86, 'charcoal'],
];

/** Odds and ends: a water butt, a stack of logs, a handcart. */
const butt = (x: number, z: number): Op => ['cyl', 0.045, 0.04, 0.11, x, 0.012, z, 'boxBlue', 8];
const logPile = (x: number, z: number): Op[] => repeat(3, (i): Op => ['box', 0.16, 0.03, 0.03, x, 0.012 + (i === 2 ? 0.03 : 0), z + (i === 2 ? 0 : (i - 0.5) * 0.034), 'timber']);
const handcart = (x: number, z: number): Op[] => [
  ['box', 0.16, 0.06, 0.1, x, 0.05, z, 'brown'],
  ['wheel', 0.04, 0.02, x - 0.055, 0.04, z, 'dark'], ['wheel', 0.04, 0.02, x + 0.055, 0.04, z, 'dark'],
  ['box', 0.012, 0.012, 0.14, x, 0.07, z + 0.12, 'timber'],
];

export const pioneerCamp: KindDef = {
  id: 'camp', name: 'pioneer camp', code: Zone.Residential, kindId: 120, family: 'residential',
  flags: { civic: true },
  windows: 'home',
  footprint: { w: 2, h: 2, door: [0, 1], marks: [{ kind: 'door', at: [0, 1], label: 'camp gate' }] },
  tool: { id: 'camp', key: '', label: 'Pioneer camp (2×2)', color: '#c98a3c' },
  blurb: 'Tents and caravans round a fire pit: the first eight settlers of a new town. It opens the moment it is pitched, with no builders needed, and its people arrive within the hour to work your builders\' yard and first shops. One camp per player at a time.',
  howTo: 'Two tiles by two beside a road on your land (Z and C turn it), ideally next to where your builders\' yard and first homes will go. It never grows; bulldoze it once proper homes stand and its people move into free beds nearby.',
  attrs: { style: 'camp', rentBand: 'low' },
  levels: [{
    // `work` is never done: the camp opens at once (net.ts); the catalogue's civic default keeps the tables uniform
    capacity: 8, cost: 150, upkeep: 4, work: 300, parking: { surface: 2, underground: 0 },
    designs: [
      { name: 'ridge tents and a caravan round a fire pit, festoon lights over the path', height: 0.4, ops: [
        ['box', 1.96, 0.012, 1.96, 0, 0, 0, GRASS],
        ['box', 0.2, 0.014, 0.95, -0.5, 0, 0.52, TRAMPLED],                       // the path in from the road
        ['cyl', 0.42, 0.42, 0.013, -0.15, 0, 0.0, TRAMPLED, 12],                 // trodden ground round the fire
        ...firePit(-0.15, 0.0, 4, 0.4),
        ...ridgeTent(-0.62, -0.55, 0.3, 0.42, 0.24, 0xd2642f),
        ...ridgeTent(-0.12, -0.66, 0.3, 0.4, 0.22, 0x6f7d45),
        ...ridgeTent(0.36, -0.58, 0.28, 0.38, 0.22, CANVAS),
        ...caravan('van', 0.62, 0.32, 'cream', 0x3b6ea5),
        ...festoon(-0.86, 0.12, 0.84, 6),
        ...lanternPost(-0.78, -0.08),
        ...washing(0.86, -0.82, -0.2),
        butt(0.3, 0.05), ...logPile(-0.6, 0.38), ...handcart(0.12, 0.6),
      ] },
      { name: 'bell tent, dome tent and two caravans by a fire pit and a lantern', height: 0.44, ops: [
        ['box', 1.96, 0.012, 1.96, 0, 0, 0, GRASS],
        ['box', 0.9, 0.014, 0.2, -0.3, 0, 0.78, TRAMPLED],                         // the track along the road edge
        ['cyl', 0.38, 0.38, 0.013, -0.25, 0, 0.2, TRAMPLED, 12],
        ...firePit(-0.25, 0.2, 3, 1.2),
        ...bellTent(-0.5, -0.5, 0.26, CANVAS),
        ...domeTent(0.05, -0.62, 0.17, 0x2f8f8a),
        ...caravan('vanA', 0.6, -0.42, 'white', 'red', 0.46),
        ...caravan('vanB', 0.62, 0.42, 'tan', 'green', 0.52),
        ...lanternPost(-0.02, 0.34, 0.36),
        ...lanternPost(-0.84, 0.62, 0.3),
        ['box', 0.26, 0.02, 0.12, 0.18, 0.1, 0.12, 'timber'],                       // a trestle table and benches
        ['box', 0.26, 0.012, 0.04, 0.18, 0.055, 0.03, 'timber'], ['box', 0.26, 0.012, 0.04, 0.18, 0.055, 0.21, 'timber'],
        ['box', 0.02, 0.1, 0.1, 0.07, 0.0, 0.12, 'timber'], ['box', 0.02, 0.1, 0.1, 0.29, 0.0, 0.12, 'timber'],
        butt(-0.86, -0.1), ...logPile(-0.75, 0.2), ...washing(-0.9, -0.85, -0.35),
      ] },
    ],
  }],
};
