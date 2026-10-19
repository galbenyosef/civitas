import type { Op, Color, Win } from './schema';
import { repeat } from './helpers';
import { adBoard } from './tierkit';

/**
 * Recipe parts for the merged zone kinds (residential-merged.ts and the other three). Like tierkit.ts each part returns
 * plain ops in tile units: the footprint is centred on x=0, z=0, the ground is y=0 and +z faces the road. Nothing here
 * is a new op.
 */

/** A lit block (the kind's own window class) with a thin dark parapet. */
export const block = (w: number, h: number, d: number, x: number, z: number, body: Color, y = 0, cap: Color | null = 'dark', win: Win = true): Op[] => [
  ['box', w, h, d, x, y, z, body, win],
  ...(cap ? [['box', w + 0.02, 0.025, d + 0.02, x, y + h, z, cap] as Op] : []),
];
/** Floor bands: n slabs a hair wider than a w×d body between y0 and y1. */
export const bands = (w: number, d: number, x: number, z: number, y0: number, y1: number, n: number, color: Color, t = 0.018): Op[] =>
  repeat(n, (i) => ['box', w + 0.012, t, d + 0.012, x, y0 + ((y1 - y0) * (i + 1)) / (n + 1), z, color]);
/** Vertical fins along the front (+z) face of a w-wide body of depth d, from y0 up h. */
export const fins = (w: number, d: number, x: number, z: number, y0: number, h: number, n: number, color: Color): Op[] =>
  repeat(n, (i) => ['box', 0.02, h, 0.03, x - w / 2 + (w * (i + 0.5)) / n, y0, z + d / 2 + 0.005, color]);
/** Balcony slabs with a dark rail along the front (+z) of a body, every dy from y0. */
export const balconies = (w: number, x: number, zFront: number, y0: number, n: number, dy: number, slab: Color = 'white'): Op[] =>
  range(n).flatMap((i): Op[] => [
    ['box', w, 0.022, 0.09, x, y0 + i * dy, zFront + 0.045, slab],
    ['box', w, 0.045, 0.01, x, y0 + i * dy + 0.022, zFront + 0.085, 'dark'],
  ]);
/** A house with a pitched roof (ridge along x), a front door and an optional chimney; base at y. */
export const house = (x: number, z: number, w: number, d: number, h: number, wall: Color, roof: Color, o: { chimney?: number; door?: Color; roofH?: number; y?: number } = {}): Op[] => {
  const y = o.y ?? 0.02, rh = o.roofH ?? Math.min(0.24, d * 0.45);
  return [
    ['box', w, h, d, x, y, z, wall, true],
    ['roof', w + 0.02, rh, d + 0.06, x, y + h, z, roof],
    ['box', Math.min(0.09, w * 0.4), Math.min(0.16, h * 0.55), 0.02, x, y, z + d / 2 + 0.006, o.door ?? 'door'],
    ...(o.chimney !== undefined ? [['box', 0.06, rh * 0.8, 0.06, x + o.chimney, y + h + rh * 0.35, z - d * 0.2, 'chimney'] as Op] : []),
  ];
};
/** A low hedge or wall along x. */
export const hedge = (x: number, z: number, len: number, color: Color = 'hedge', h = 0.05): Op => ['box', len, h, 0.05, x, 0.02, z, color];
/** Rooftop plant: n boxes in a row along x. */
export const roofPlant = (x: number, y: number, z: number, n = 2, s = 0.1): Op[] => repeat(n, (i) => ['box', s, s * 0.7, s, x + i * s * 1.3, y, z, 'plant']);
/** A water tank on legs (the New York kind). */
export const waterTank = (x: number, y: number, z: number, r = 0.07): Op[] => [
  ['box', r * 1.6, 0.06, r * 1.6, x, y, z, 'dark'],
  ['cyl', r, r, r * 2, x, y + 0.06, z, 'brown', 8], ['cone', r * 1.08, r * 0.8, x, y + 0.06 + r * 2, z, 'dark', 8],
];
/** A tower with setbacks: each tier [w, h, d] sits on the last; returns the ops and the top height. */
export const stepped = (x: number, z: number, y0: number, tiers: [number, number, number][], body: Color, cap: Color = 'dark', bandColor: Color | null = null, floorsPer = 0.18): { ops: Op[]; top: number } => {
  const ops: Op[] = [];
  let y = y0;
  for (const [w, h, d] of tiers) {
    ops.push(...block(w, h, d, x, z, body, y, cap));
    if (bandColor) ops.push(...bands(w, d, x, z, y, y + h, Math.max(0, Math.round(h / floorsPer) - 1), bandColor));
    y += h + 0.025;
  }
  return { ops, top: y };
};
/** A surface car park w×d with bay lines and parked cars in two rows facing a middle aisle. */
export const carPark = (x: number, z: number, w: number, d: number, seed = 3): Op[] => {
  const cs: Color[] = ['red', 'white', 'navy', 'silver', 'yellow', 0x2f6a4f, 'charcoal', 0x8a2b3a];
  const out: Op[] = [['box', w, 0.012, d, x, 0.012, z, 0x3a3d44]];
  const n = Math.max(1, Math.floor((w - 0.06) / 0.14));
  const x0 = x - ((n - 1) * 0.14) / 2;
  for (const [row, zz] of [[0, z - d / 2 + 0.13], [1, z + d / 2 - 0.13]] as const) {
    if (d < 0.5 && row === 1) break;
    for (let i = 0; i < n; i++) {
      out.push(['box', 0.01, 0.004, 0.2, x0 - 0.07 + i * 0.14, 0.026, zz, 'white']);
      if ((i * 7 + seed + row * 3) % 5 === 0) continue;
      out.push(['box', 0.09, 0.045, 0.18, x0 + i * 0.14, 0.024, zz, cs[(i * 3 + seed + row) % cs.length]], ['box', 0.075, 0.035, 0.09, x0 + i * 0.14, 0.069, zz, 'glassDark']);
    }
  }
  return out;
};
/** A broadleaf tree (trunk and two crowns), s scales it. */
export const tree = (x: number, z: number, s = 1, y = 0.02): Op[] => [
  ['cyl', 0.012 * s, 0.018 * s, 0.1 * s, x, y, z, 'timber', 5],
  ['cone', 0.085 * s, 0.14 * s, x, y + 0.07 * s, z, 'hedge', 7],
  ['cone', 0.065 * s, 0.12 * s, x, y + 0.14 * s, z, 'green', 7],
];
/** Trees along x from x0 to x1 at z. */
export const treeRow = (x0: number, x1: number, z: number, n: number, s = 1, y = 0.02): Op[] =>
  range(n).flatMap((i) => tree(n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1), z, s * (i % 2 ? 0.85 : 1), y));
/** Shop awning over a shopfront, striped or plain. */
export const awning = (x: number, y: number, zFront: number, w: number, a: Color, b: Color | null = 'white', n = 6): Op[] =>
  b === null ? [['box', w, 0.025, 0.14, x, y, zFront + 0.07, a]]
    : repeat(n, (i) => ['box', w / n, 0.025, 0.14, x - w / 2 + (w / n) * (i + 0.5), y, zFront + 0.07, i % 2 ? b : a]);
/** A shopfront: glazing, a door and a fascia sign, on the front face at zFront. */
export const shopfront = (x: number, zFront: number, w: number, fascia: Color, y = 0.02): Op[] => [
  ['box', w * 0.86, 0.15, 0.015, x, y + 0.02, zFront + 0.008, 'glass'],
  ['box', 0.07, 0.15, 0.016, x + w * 0.3, y + 0.02, zFront + 0.009, 'door'],
  ['box', w * 0.9, 0.05, 0.02, x, y + 0.2, zFront + 0.01, fascia],
];
/** A sawtooth roof of n teeth over a w×d hall at height y (ridges along z). */
export const sawtooth = (x: number, y: number, z: number, w: number, d: number, n: number, color: Color): Op[] =>
  repeat(n, (i) => ['roof', w / n, 0.12, d, x - w / 2 + (w / n) * (i + 0.5), y, z, color, true]);
/** A loading dock: n roller doors along the front of a hall, with a canopy. */
export const docks = (x: number, zFront: number, w: number, n: number, door: Color = 'grey', y = 0.02): Op[] => [
  ...repeat(n, (i) => ['box', (w / n) * 0.6, 0.16, 0.015, x - w / 2 + (w / n) * (i + 0.5), y, zFront + 0.008, door] as Op),
  ['box', w, 0.02, 0.1, x, y + 0.2, zFront + 0.05, 'dark'],
];
/** A lorry: cab and box trailer, nose towards +z unless alongX. */
export const lorry = (x: number, z: number, body: Color = 'white', alongX = false, y = 0.02): Op[] => {
  const [tw, td, cw, cd, cx, cz] = alongX ? [0.36, 0.12, 0.1, 0.12, x + 0.24, z] : [0.12, 0.36, 0.12, 0.1, x, z + 0.24];
  return [['box', tw, 0.13, td, x, y + 0.02, z, body], ['box', cw, 0.1, cd, cx, y, cz, 'red'], ['box', alongX ? 0.02 : cw * 0.9, 0.04, alongX ? cd * 0.9 : 0.02, cx + (alongX ? 0.05 : 0), y + 0.05, cz + (alongX ? 0 : 0.05), 'glassDark']];
};
/** A storage tank: cylinder with a domed top. */
export const tank = (x: number, z: number, r: number, h: number, color: Color = 'silver', y = 0.02): Op[] => [
  ['cyl', r, r, h, x, y, z, color, 12], ['cone', r, r * 0.4, x, y + h, z, color, 12],
];
/** A cooling tower: a waisted hyperboloid from three stacked frusta. */
export const coolingTower = (x: number, z: number, r: number, h: number, y = 0.02): Op[] => [
  ['cyl', r * 0.78, r, h * 0.55, x, y, z, 'pale', 14],
  ['cyl', r * 0.82, r * 0.78, h * 0.3, x, y + h * 0.55, z, 'pale', 14],
  ['cyl', r * 0.86, r * 0.82, h * 0.15, x, y + h * 0.85, z, 'stone', 14],
];
/** A pipe run along x (or z) on short posts, at height y. */
export const pipe = (x: number, z: number, len: number, alongX: boolean, y: number, r = 0.018, color: Color = 'steel'): Op[] => [
  alongX ? ['box', len, r * 2, r * 2, x, y, z, color] : ['box', r * 2, r * 2, len, x, y, z, color],
  ...repeat(Math.max(2, Math.round(len / 0.3) + 1), (i): Op => {
    const t = -len / 2 + (len * i) / Math.max(1, Math.round(len / 0.3));
    return ['box', 0.02, y, 0.02, alongX ? x + t : x, 0.02, alongX ? z : z + t, 'charcoal'];
  }),
];
/** A spire or mast with a red light on top. */
export const spire = (x: number, y: number, z: number, h: number, r = 0.03, color: Color = 'steel'): Op[] => [
  ['cyl', r * 0.25, r, h, x, y, z, color, 6], ['cyl', 0.012, 0.012, 0.03, x, y + h, z, 'red', 5],
];
/** A paved forecourt or a lawn covering most of a w×h footprint. */
export const ground = (w: number, h: number, color: Color, x = 0, z = 0, t = 0.02): Op => ['box', w - 0.04, t, h - 0.04, x, 0, z, color];
/** 0..n-1, for building parts with flatMap. */
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
/** A roadside 48-sheet billboard on tall legs (docs/adverts.md section 2), its board named `name`: over a car park's hedge or a forecourt. */
export const billboard = (x: number, z: number, legs = 0.2, name = 'billboard'): Op[] => adBoard(name, x, z, 'billboard', legs);
