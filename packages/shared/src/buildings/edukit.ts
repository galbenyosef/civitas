import type { Op, Color } from './schema';
import { repeat } from './helpers';
import { ASPHALT, PAVING, tree, pine } from './tierkit';

/**
 * Recipe parts for the education kinds (education.ts). Each returns plain ops in tile units: centre 0,0, ground
 * y = 0, +z towards the road, and a part standing on the ground sits at `y` (default 0.02, the top of the usual
 * 0.02 slab). Scatter helpers take a seed and place lamp posts, benches and trees at hashed offsets rather than on a
 * grid, so no two quads, lawns or playgrounds look stamped (the organic-variation rule, docs/buildings.md).
 */

export { ASPHALT, PAVING };
/** a hash in 0..1 of an integer seed, stable across runs */
export const h01 = (i: number): number => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** a jitter in -amp..amp for a seed */
export const jit = (i: number, amp: number): number => (h01(i) - 0.5) * 2 * amp;

/** a floor slab over the whole footprint */
export const ground = (w: number, d: number, color: Color, h = 0.02): Op => ['box', w - 0.04, h, d - 0.04, 0, 0, 0, color];
/** a flat painted or paved area on top of the slab */
export const patch = (w: number, d: number, x: number, z: number, color: Color, y = 0.02, h = 0.006): Op => ['box', w, h, d, x, y, z, color];

/** a hopscotch grid: squares of chalk-white and yellow along z, ending in a pair */
export const hopscotch = (x: number, z: number, y = 0.026): Op[] => [
  ...repeat(4, (i): Op => ['box', 0.04, 0.003, 0.04, x, y, z - i * 0.045, i % 2 ? 'yellow' : 'white']),
  ['box', 0.04, 0.003, 0.04, x - 0.045, y, z - 4 * 0.045, 'white'], ['box', 0.04, 0.003, 0.04, x + 0.045, y, z - 4 * 0.045, 'white'],
];
/** a climbing frame: four posts, a top bar, a cross bar and a slide */
export const climbingFrame = (x: number, z: number, y = 0.02, c1: Color = 'red', c2: Color = 'boxBlue'): Op[] => [
  ...[[-0.05, -0.04], [0.05, -0.04], [-0.05, 0.04], [0.05, 0.04]].map(([dx, dz]): Op => ['cyl', 0.007, 0.007, 0.13, x + dx, y, z + dz, c1, 4]),
  ['box', 0.12, 0.012, 0.012, x, y + 0.13, z - 0.04, c2], ['box', 0.12, 0.012, 0.012, x, y + 0.13, z + 0.04, c2],
  ['box', 0.012, 0.012, 0.09, x, y + 0.07, z, c2], ['box', 0.1, 0.08, 0.008, x, y + 0.02, z - 0.04, c2],
  ['box', 0.04, 0.012, 0.13, x + 0.09, y + 0.05, z + 0.02, 'yellow'], ['box', 0.04, 0.05, 0.012, x + 0.09, y, z - 0.04, 'yellow'],
];
/** football goal posts, mouth towards +z (or +x with alongZ) */
export const goal = (x: number, z: number, y = 0.02, alongZ = false): Op[] => alongZ
  ? [['cyl', 0.005, 0.005, 0.07, x, y, z - 0.06, 'white', 4], ['cyl', 0.005, 0.005, 0.07, x, y, z + 0.06, 'white', 4], ['box', 0.008, 0.008, 0.125, x, y + 0.07, z, 'white']]
  : [['cyl', 0.005, 0.005, 0.07, x - 0.06, y, z, 'white', 4], ['cyl', 0.005, 0.005, 0.07, x + 0.06, y, z, 'white', 4], ['box', 0.125, 0.008, 0.008, x, y + 0.07, z, 'white']];
/** pitch markings: touchlines, halfway line and centre circle on a w×d pitch centred at (x, z) whose surface is at y */
export const pitchLines = (w: number, d: number, x: number, z: number, y: number): Op[] => [
  ['box', w, 0.003, 0.008, x, y, z - d / 2 + 0.004, 'white'], ['box', w, 0.003, 0.008, x, y, z + d / 2 - 0.004, 'white'],
  ['box', 0.008, 0.003, d, x - w / 2 + 0.004, y, z, 'white'], ['box', 0.008, 0.003, d, x + w / 2 - 0.004, y, z, 'white'],
  ['box', w, 0.003, 0.006, x, y, z, 'white'],
  ['cyl', Math.min(w, d) * 0.14, Math.min(w, d) * 0.14, 0.004, x, y, z, 'white', 12],
];
/** a bell cupola: an octagonal louvred drum, a slate cap, a finial */
export const cupola = (x: number, y: number, z: number, s = 1, cap: Color = 'slate'): Op[] => [
  ['cyl', 0.05 * s, 0.056 * s, 0.03 * s, x, y, z, 'stone', 8],
  ['cyl', 0.042 * s, 0.042 * s, 0.07 * s, x, y + 0.03 * s, z, 'white', 8],
  ['cyl', 0.03 * s, 0.03 * s, 0.045 * s, x, y + 0.045 * s, z, 'dark', 8],
  ['cone', 0.06 * s, 0.07 * s, x, y + 0.1 * s, z, cap, 8], ['cyl', 0.004 * s, 0.004 * s, 0.045 * s, x, y + 0.17 * s, z, 'gold', 4],
];
/** a round clock face on a wall at z (facing +z) or at x (facing +x with onX), r in tiles, with hands */
export const clockFace = (x: number, y: number, z: number, r: number): Op[] => [
  ['lathe', x, y, z, 'stone', [r * 1.18, 0, r * 1.18, 0.012], { seg: 14, axis: 'z' }],
  ['lathe', x, y, z + 0.012, 'white', [r, 0, r, 0.008], { seg: 14, axis: 'z' }],
  ['box', r * 0.1, r * 0.75, 0.006, x, y, z + 0.02, 'charcoal'], ['box', r * 0.7, r * 0.09, 0.006, x + r * 0.28, y - r * 0.04, z + 0.02, 'charcoal'],
];
/** a row of cycle stands with bikes, under a flat roof on posts; w along x */
export const bikeShed = (x: number, z: number, w: number, y = 0.02, roof: Color = 'boxGreen'): Op[] => {
  const n = Math.max(2, Math.round(w / 0.035));
  return [
    ['cyl', 0.005, 0.005, 0.06, x - w / 2 + 0.01, y, z - 0.035, 'steel', 4], ['cyl', 0.005, 0.005, 0.06, x + w / 2 - 0.01, y, z - 0.035, 'steel', 4],
    ['cyl', 0.005, 0.005, 0.05, x - w / 2 + 0.01, y, z + 0.035, 'steel', 4], ['cyl', 0.005, 0.005, 0.05, x + w / 2 - 0.01, y, z + 0.035, 'steel', 4],
    ['box', w, 0.01, 0.1, x, y + 0.06, z, roof],
    ...repeat(n, (i): Op => ['box', 0.005, 0.03, 0.05, x - w / 2 + 0.03 + (i * (w - 0.06)) / Math.max(1, n - 1), y, z, i % 3 === 2 ? 'red' : i % 2 ? 'charcoal' : 'boxBlue']),
  ];
};
/** a park bench along x (or along z) */
export const bench = (x: number, z: number, alongX = true, y = 0.02): Op[] => [
  ['box', alongX ? 0.09 : 0.03, 0.012, alongX ? 0.03 : 0.09, x, y + 0.026, z, 'timber'],
  ['box', alongX ? 0.09 : 0.006, 0.026, alongX ? 0.006 : 0.09, x, y + 0.038, z + (alongX ? -0.012 : -0.012), 'timber'],
  ['box', 0.008, 0.026, 0.008, alongX ? x - 0.035 : x, y, alongX ? z : z - 0.035, 'charcoal'], ['box', 0.008, 0.026, 0.008, alongX ? x + 0.035 : x, y, alongX ? z : z + 0.035, 'charcoal'],
];
/** a lamp post whose head takes the night light of the civic windows */
export const lamp = (x: number, z: number, h = 0.17, y = 0.02): Op[] => [
  ['cyl', 0.005, 0.007, h, x, y, z, 'charcoal', 5], ['box', 0.022, 0.016, 0.022, x, y + h, z, 'marquee', 'venue'],
];
/** n lamps in a row from (x0, z0) to (x1, z1), each nudged by a hashed offset */
export const lampRow = (x0: number, z0: number, x1: number, z1: number, n: number, seed: number, h = 0.17, y = 0.02): Op[] =>
  Array.from({ length: n }, (_, i) => i).flatMap((i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    return lamp(x0 + (x1 - x0) * t + jit(seed + i * 3, 0.025), z0 + (z1 - z0) * t + jit(seed + i * 3 + 1, 0.025), h * (0.92 + 0.16 * h01(seed + i)), y);
  });
/** n trees scattered in a rectangle, species, size and crown colour hashed per tree */
export const scatterTrees = (x0: number, z0: number, x1: number, z1: number, n: number, seed: number, y = 0.02): Op[] =>
  Array.from({ length: n }, (_, i) => i).flatMap((i) => {
    const x = x0 + (x1 - x0) * h01(seed + i * 5), z = z0 + (z1 - z0) * h01(seed + i * 5 + 1), s = 0.8 + 0.5 * h01(seed + i * 5 + 2);
    return h01(seed + i * 5 + 3) < 0.28 ? pine(x, z, s, y) : tree(x, z, s, h01(seed + i * 5 + 4) < 0.3 ? 0x7a9c3a : 'hedge', y);
  });
/** benches at hashed spots along a line, half of them turned */
export const benchRow = (x0: number, z0: number, x1: number, z1: number, n: number, seed: number, y = 0.02): Op[] =>
  Array.from({ length: n }, (_, i) => i).flatMap((i) => {
    const t = (i + 0.5) / n;
    return bench(x0 + (x1 - x0) * t + jit(seed + i, 0.03), z0 + (z1 - z0) * t + jit(seed + i + 40, 0.03), h01(seed + i + 80) > 0.35, y);
  });
/** a clipped hedge */
export const hedge = (w: number, d: number, x: number, z: number, y = 0.02, h = 0.05): Op => ['box', w, h, d, x, y, z, 'hedge'];
/** a pushchair */
export const buggy = (x: number, z: number, y = 0.02, c: Color = 'navy'): Op[] => [['box', 0.04, 0.03, 0.06, x, y + 0.012, z, c], ['box', 0.036, 0.02, 0.012, x, y + 0.042, z - 0.026, c], ['cyl', 0.006, 0.006, 0.04, x, y, z + 0.034, 'charcoal', 4]];
/** a picket fence along x or z */
export const pickets = (x: number, z: number, len: number, alongX: boolean, y = 0.02, color: Color = 'white'): Op[] => {
  const n = Math.round(len / 0.03);
  return [
    alongX ? ['box', len, 0.01, 0.006, x, y + 0.03, z, color] : ['box', 0.006, 0.01, len, x, y + 0.03, z, color],
    ...repeat(n + 1, (i): Op => { const t = -len / 2 + (len * i) / n; return ['box', 0.01, 0.05, 0.01, alongX ? x + t : x, y, alongX ? z : z + t, color]; }),
  ];
};
