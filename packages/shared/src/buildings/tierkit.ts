import type { Op, Color, Win } from './schema';
import { repeat } from './helpers';
import { AD_SIZE, type AdSize } from './adslot';

/**
 * Recipe parts shared by the size-tier kinds (civic-tiers.ts, parking.ts, leisure-tiers.ts). Each returns plain ops in
 * tile units (centre 0,0, ground y=0, +z towards the road), so a design reads as a list of named parts. Nothing here
 * is a new op: they expand to boxes, roofs, cylinders and cones at authoring time.
 */

export const ASPHALT = 0x3a3d44;
export const PAVING = 0xcfc8ba;

/** A slab over a w×d footprint, inset by 0.02 so neighbouring lots read apart. */
export const slab = (w: number, d: number, color: Color, h = 0.02, x = 0, z = 0): Op => ['box', w - 0.04, h, d - 0.04, x, 0, z, color];

/** A parked car, nose along z (or along x), body and cabin. */
export const car = (x: number, z: number, color: Color, alongX = false, y = 0.02): Op[] => {
  const [bw, bd, cw, cd] = alongX ? [0.2, 0.1, 0.1, 0.085] : [0.1, 0.2, 0.085, 0.1];
  return [['box', bw, 0.045, bd, x, y, z, color], ['box', cw, 0.035, cd, x, y + 0.045, z, 'glassDark']];
};
/** A row of parked cars along x starting at x0 with spacing dx; colours cycle and about one bay in five is empty. */
export const carRow = (x0: number, z: number, n: number, dx: number, alongX = false, y = 0.02, skip = 3): Op[] => {
  const cs: Color[] = ['red', 'white', 'navy', 'silver', 'yellow', 0x2f6a4f, 'charcoal', 0x8a2b3a];
  const out: Op[] = [];
  for (let i = 0; i < n; i++) if ((i * 7 + skip) % 5 !== 0) out.push(...car(x0 + i * dx, z, cs[(i * 3 + skip) % cs.length], alongX, y));
  return out;
};
/** Painted bay lines: n+1 lines along x from x0 every dx, each `len` deep, centred on z. */
export const bayLines = (x0: number, z: number, n: number, dx: number, len: number, y = 0.02, color: Color = 'white'): Op[] =>
  repeat(n + 1, (i) => ['box', 0.014, 0.004, len, x0 + i * dx, y, z, color]);

/** A van-like vehicle (ambulance, police van, builder's lorry), nose towards +z unless alongX. */
export const van = (x: number, z: number, body: Color, stripe: Color, alongX = false, y = 0.02): Op[] => {
  const [w, d] = alongX ? [0.26, 0.12] : [0.12, 0.26];
  return [
    ['box', w, 0.1, d, x, y, z, body],
    ['box', alongX ? w + 0.004 : w + 0.004, 0.025, alongX ? d + 0.004 : d + 0.004, x, y + 0.045, z, stripe],
    ['box', alongX ? 0.05 : w * 0.9, 0.035, alongX ? d * 0.9 : 0.05, x + (alongX ? w / 2 - 0.03 : 0), y + 0.06, z + (alongX ? 0 : d / 2 - 0.03), 'glassDark'],
  ];
};
/** A fire engine: long red body, a ladder on top. */
export const engine = (x: number, z: number, alongX = false, y = 0.02): Op[] => {
  const [w, d] = alongX ? [0.36, 0.13] : [0.13, 0.36];
  return [
    ['box', w, 0.11, d, x, y, z, 'red'],
    ['box', alongX ? 0.07 : w * 0.92, 0.04, alongX ? d * 0.92 : 0.07, x + (alongX ? w / 2 - 0.04 : 0), y + 0.07, z + (alongX ? 0 : d / 2 - 0.04), 'glassDark'],
    ['box', alongX ? w * 0.7 : 0.05, 0.02, alongX ? 0.05 : d * 0.7, x - (alongX ? 0.03 : 0), y + 0.11, z - (alongX ? 0 : 0.03), 'silver'],
  ];
};
/** A broadleaf tree: trunk and two stacked crowns (s scales it). */
export const tree = (x: number, z: number, s = 1, crown: Color = 'hedge', y = 0): Op[] => [
  ['cyl', 0.012 * s, 0.018 * s, 0.1 * s, x, y, z, 'timber', 5],
  ['cone', 0.085 * s, 0.14 * s, x, y + 0.07 * s, z, crown, 7],
  ['cone', 0.065 * s, 0.12 * s, x, y + 0.14 * s, z, crown === 'hedge' ? 'green' : 'hedge', 7],
];
/** A conifer: trunk and a tall cone. */
export const pine = (x: number, z: number, s = 1, y = 0): Op[] => [
  ['cyl', 0.01 * s, 0.014 * s, 0.06 * s, x, y, z, 'timber', 5],
  ['cone', 0.06 * s, 0.24 * s, x, y + 0.05 * s, z, 'green', 7],
];
/** Trees along a line from (x0, z0) to (x1, z1), n of them, alternating sizes. */
export const treeLine = (x0: number, z0: number, x1: number, z1: number, n: number, s = 1): Op[] =>
  Array.from({ length: n }, (_, i) => i).flatMap((i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    return i % 3 === 2 ? pine(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, s * 0.9) : tree(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, s * (i % 2 ? 0.85 : 1));
  });
/** A helipad on a roof or the ground: dark disc, yellow ring, white H. */
export const helipad = (x: number, y: number, z: number, r = 0.16): Op[] => [
  ['cyl', r, r, 0.02, x, y, z, 0x4a4f58, 14],
  ['cyl', r * 0.82, r * 0.82, 0.022, x, y, z, 'yellow', 14],
  ['cyl', r * 0.74, r * 0.74, 0.024, x, y, z, 0x4a4f58, 14],
  ['box', r * 0.12, 0.006, r * 0.8, x - r * 0.26, y + 0.024, z, 'white'], ['box', r * 0.12, 0.006, r * 0.8, x + r * 0.26, y + 0.024, z, 'white'],
  ['box', r * 0.5, 0.006, r * 0.12, x, y + 0.024, z, 'white'],
];
/** A radio mast: thin tapered pole, two cross arms and a red tip. */
export const mast = (x: number, y: number, z: number, h: number): Op[] => [
  ['cyl', 0.008, 0.02, h, x, y, z, 'steel', 5],
  ['box', 0.12, 0.012, 0.012, x, y + h * 0.55, z, 'steel'], ['box', 0.09, 0.012, 0.012, x, y + h * 0.8, z, 'steel'],
  ['cyl', 0.012, 0.012, 0.03, x, y + h, z, 'red', 5],
];
/** A blue lamp on a short post (police) or a red one (fire). */
export const lampPost = (x: number, z: number, h: number, light: Color, y = 0): Op[] => [
  ['cyl', 0.008, 0.01, h, x, y, z, 'charcoal', 5], ['box', 0.04, 0.04, 0.04, x, y + h, z, light, 'civic'],
];
/** A flat sign panel on two posts, facing the road. */
export const signBoard = (x: number, z: number, w: number, color: Color, text: Color = 'white', y = 0, h = 0.22): Op[] => [
  ['cyl', 0.008, 0.008, h, x - w / 2 + 0.02, y, z, 'steel', 4], ['cyl', 0.008, 0.008, h, x + w / 2 - 0.02, y, z, 'steel', 4],
  ['box', w, 0.07, 0.015, x, y + h - 0.05, z, color], ['box', w * 0.7, 0.025, 0.016, x, y + h - 0.03, z, text],
];
/** A low fence along x (len) or along z, with posts. */
export const fence = (x: number, z: number, len: number, alongX: boolean, color: Color = 'grey', h = 0.06): Op[] => {
  const n = Math.max(2, Math.round(len / 0.2) + 1);
  return [
    alongX ? ['box', len, 0.012, 0.01, x, h - 0.012, z, color] : ['box', 0.01, 0.012, len, x, h - 0.012, z, color],
    ...repeat(n, (i): Op => { const t = -len / 2 + (len * i) / (n - 1); return ['box', 0.012, h, 0.012, alongX ? x + t : x, 0, alongX ? z : z + t, color]; }),
  ];
};
/** A window-banded block: body plus a coloured band and a dark parapet, the usual civic massing. */
export const block = (w: number, h: number, d: number, x: number, z: number, body: Color, band: Color | null, y = 0, win: Win = true): Op[] => [
  ['box', w, h, d, x, y, z, body, win],
  ...(band ? [['box', w + 0.01, 0.05, d + 0.01, x, y + h * 0.72, z, band] as Op] : []),
  ['box', w + 0.02, 0.025, d + 0.02, x, y + h, z, 'dark'],
];
/** Rooftop plant boxes. */
export const plant = (x: number, y: number, z: number, n = 2): Op[] => repeat(n, (i) => ['box', 0.08, 0.06, 0.08, x + i * 0.11, y, z, 'plant']);
/** A row of flags on poles along x. */
export const flags = (x0: number, z: number, n: number, dx: number, colors: Color[], y = 0): Op[] => repeat(n, (i) => ['flag', x0 + i * dx, y, z, colors[i % colors.length]]);
/**
 * A free-standing advertising board on two posts, facing the road (docs/adverts.md section 2): a dark backing board named
 * `name` (unique in the design) with an ad slot of `size` on its front, its foot `legs` above y. A banner by a stadium gate,
 * a poster case by a car park.
 */
export const adBoard = (name: string, x: number, z: number, size: AdSize, legs = 0.04, y = 0): Op[] => {
  const d = AD_SIZE[size], bw = d.w + 2 * d.border + 0.02, bh = d.h + 2 * d.border + 0.02;
  return [
    ...[-1, 1].map((k): Op => ['box', 0.016, legs + bh * 0.7, 0.016, x + k * bw * 0.32, y, z - 0.016, 'charcoal']),
    ['box', bw, bh, 0.016, x, y + legs, z, 0x24382c, undefined, { name }],
    ['adslot', name, 'front', 0, 0, size],
  ];
};
