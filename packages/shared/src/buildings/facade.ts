import type { Color, CompiledFacade, CompiledOp, FacadeSpec, FaceName, Op, PartRef } from './schema';
import { PALETTE, WINDOW_CLASSES, type WindowClass } from './palette';

/**
 * Facades: windows laid out per wall, and features placed by cell (docs/buildings.md "Facades").
 *
 * A windowed box may carry `{ facade: { storeys, bays, ... } }`. Each of its four walls is then a grid of
 * storeys × bays cells aligned to that wall's own edges, and the window shader (client render/materials.ts)
 * draws one window centred in each cell instead of using the fixed model-space grid. Every cell has a mode:
 * a window, plain wall (behind a door or a bay window), a glazed door (behind a balcony), a shopfront, a garage
 * door or a bay-window pane. The compiler sets modes from the spec's `ground` and from the helper ops that
 * place doors, garage doors, balconies, bay windows, porches, awnings, dormers and cornices by cell (`FEATURES`).
 *
 * This module is pure and shared by the compiler, the validator, the client kit and `buildings:check`, which
 * uses `windowRects` and `windowCollisions` to find parts that cover windows. The window layouts in `RECT`
 * mirror the shader; keep the two in step.
 */

/** Wall faces in the order compiled cell overrides use: 0 front (+z, the road), 1 right (+x), 2 back (-z), 3 left (-x). */
export const FACES: readonly FaceName[] = ['front', 'right', 'back', 'left'];
/** Cell modes, carried per vertex (aFac.z) to the shader. 0 means "not a facade box" (the legacy grid). */
export const CELL = { plain: 1, window: 2, balconyDoor: 3, shopfront: 4, garage: 5, bayPane: 6 } as const;
export const GROUND_KINDS = ['windows', 'door', 'shopfront', 'garage', 'plain'] as const;
/** Helper ops that place features by cell; the compiler expands them into boxes and roofs (`featureOps`). */
export const FEATURES: Record<string, { args: string[]; min: number }> = {
  door: { args: ['part', 'face', 'bay', 'color'], min: 3 },
  balcony: { args: ['part', 'face', 'storey', 'fromBay', 'toBay', 'color', 'slabColor'], min: 5 },
  baywindow: { args: ['part', 'face', 'storey', 'bay', 'color'], min: 4 },
  porch: { args: ['part', 'face', 'fromBay', 'toBay', 'color', 'postColor'], min: 4 },
  awning: { args: ['part', 'face', 'fromBay', 'toBay', 'color'], min: 4 },
  garage: { args: ['part', 'face', 'bay'], min: 3 },
  dormer: { args: ['roofPart', 'n', 'color'], min: 2 },
  cornice: { args: ['part', 'storey', 'color'], min: 2 },
};
export const isFeature = (name: unknown): boolean => typeof name === 'string' && name in FEATURES;

type Box = readonly [number, number, number, number, number, number]; // w h d x y z, base at y
const colour = (c: Color) => (typeof c === 'number' ? c : PALETTE[c]);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------- faces and grids

/**
 * One wall of a box. `s` runs along the wall from the left edge as seen from outside (0) to the right (width);
 * world horizontal coordinate = left + dir * s on the axis that is not `axis`. `axis` is the normal's axis
 * (0 = x, 2 = z) and `plane` the wall's coordinate on it; `out` is +1 when the wall faces + on that axis.
 */
export interface FaceFrame { face: number; axis: 0 | 2; plane: number; out: 1 | -1; left: number; dir: 1 | -1; width: number; y0: number; y1: number }
export function faceFrame(b: Box, face: number): FaceFrame {
  const [w, h, d, x, y, z] = b;
  const y0 = y, y1 = y + h;
  switch (face) {
    case 0: return { face, axis: 2, plane: z + d / 2, out: 1, left: x - w / 2, dir: 1, width: w, y0, y1 };
    case 1: return { face, axis: 0, plane: x + w / 2, out: 1, left: z + d / 2, dir: -1, width: d, y0, y1 };
    case 2: return { face, axis: 2, plane: z - d / 2, out: -1, left: x + w / 2, dir: -1, width: w, y0, y1 };
    default: return { face, axis: 0, plane: x - w / 2, out: -1, left: z - d / 2, dir: 1, width: d, y0, y1 };
  }
}
/** A point on a wall (s along it, height y, n out from it) in model coordinates. */
export function facePoint(fr: FaceFrame, s: number, y: number, n = 0): [number, number, number] {
  const h = fr.left + fr.dir * s, p = fr.plane + fr.out * n;
  return fr.axis === 2 ? [h, y, p] : [p, y, h];
}

export interface FacadeGrid { bays: number; bw: number; sh: number; m: number; storeys: number }
/** The cell grid on one wall: `bays` columns of width `bw` between margins `m`, `storeys` rows of height `sh` from the base. */
export function facadeGrid(b: Box, f: CompiledFacade, face: number): FacadeGrid {
  const width = face % 2 === 0 ? b[0] : b[2];
  const bays = face % 2 === 0 ? f.b : f.sb;
  const m = Math.min(f.m, width / 2);
  return { bays, bw: bays ? (width - 2 * m) / bays : 0, sh: (b[1] - f.t) / f.s, m, storeys: f.s };
}
/** A cell's mode: a window unless a ground spec or a feature changed it (the last override wins). */
export function cellMode(f: CompiledFacade, face: number, storey: number, bay: number): number {
  let mode: number = CELL.window;
  const c = f.c;
  if (c) for (let i = 0; i < c.length; i += 4) if (c[i] === face && c[i + 1] === storey && c[i + 2] === bay) mode = c[i + 3];
  return mode;
}

/** Spec -> the compact form carried in recipes.ts. Ground cells are written as overrides on the front wall. */
export function compileFacade(spec: FacadeSpec, cls: number, w: number, h: number, d: number): { facade: CompiledFacade; doorBay: number } {
  const bays = spec.bays;
  const sb = spec.sideBays ?? Math.max(1, Math.round((bays * d) / w));
  const f: CompiledFacade = { s: spec.storeys, b: bays, sb, m: spec.margin ?? 0, t: spec.top ?? 0 };
  const ground = spec.ground ?? (cls === WINDOW_CLASSES.shop ? 'shopfront' : 'windows');
  const mode = ground === 'shopfront' ? CELL.shopfront : ground === 'garage' ? CELL.garage : ground === 'plain' ? CELL.plain : 0;
  const c: number[] = [];
  if (mode) for (let b = 0; b < bays; b++) c.push(0, 0, b, mode);
  if (c.length) f.c = c;
  return { facade: f, doorBay: ground === 'door' ? Math.floor(bays / 2) : -1 };
}

// ---------------------------------------------------------------- window layouts (mirror of the shader)

export type Layout = 'house' | 'shopHouse' | 'shopfront' | 'curtain' | 'ribbon' | 'civic' | 'factory' | 'venue' | 'glazed' | 'bay' | 'garage';
/**
 * What each layout draws in a cell, frame, sill and signboard included: x0 y0 x1 y1 as fractions of the cell
 * (render/materials.ts WINDOWS draws these). `protect` narrows what other parts must keep clear of: a balcony's
 * railing is meant to stand across the bottom of the glazed doors behind it.
 */
export const RECT: Record<Layout, { r: [number, number, number, number]; protect?: [number, number]; pane?: [number, number]; maxAspect?: number }> = {
  house: { r: [0.17, 0.235, 0.83, 0.835], pane: [0.46, 0.48], maxAspect: 0.75 },
  shopHouse: { r: [0.15, 0.235, 0.85, 0.835], pane: [0.60, 0.48], maxAspect: 0.75 },
  shopfront: { r: [0.0, 0.03, 1.0, 0.97], protect: [0.03, 0.88] }, // an awning on the floor line above may hang over the top of the signboard
  curtain: { r: [0.0, 0.22, 1.0, 1.0] },
  ribbon: { r: [0.03, 0.235, 0.97, 0.87] },
  civic: { r: [0.24, 0.045, 0.76, 0.955], pane: [0.40, 0.81], maxAspect: 0.5 },
  factory: { r: [0.04, 0.52, 0.96, 0.85] },
  venue: { r: [0.16, 0.015, 0.84, 0.955], pane: [0.56, 0.84], maxAspect: 0.6 },
  glazed: { r: [0.26, 0.0, 0.74, 0.83], protect: [0.36, 0.83], pane: [0.40, 0.78], maxAspect: 0.6 },
  bay: { r: [0.06, 0.08, 0.94, 0.90] },
  garage: { r: [0.12, 0.0, 0.88, 0.74] },
};
/** The window's height above the cell's base on the legacy grid (yTop in the shader); a window the roofline would cut is left out. */
const LEGACY_TOP: Partial<Record<Layout, number>> = { house: 0.84, shopHouse: 0.84, ribbon: 0.88, civic: 0.96, venue: 0.96 };

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** The shader's curtain-wall test: an office wall whose linear blue beats its red by 0.2 is glass. */
export const isGlassy = (hex: number) => lin((hex & 0xff) / 255) - lin(((hex >> 16) & 0xff) / 255) > 0.2;

/** Which layout a cell draws. `ground` is the bottom row (legacy: model y in [0, 0.2)). */
export function layoutOf(cls: number, mode: number, ground: boolean, glassy: boolean): Layout | null {
  if (mode === CELL.plain) return null;
  if (mode === CELL.balconyDoor) return 'glazed';
  if (mode === CELL.shopfront) return 'shopfront';
  if (mode === CELL.garage) return 'garage';
  if (mode === CELL.bayPane) return 'bay';
  const facade = mode !== 0;
  switch (cls) {
    case WINDOW_CLASSES.home: return 'house';
    case WINDOW_CLASSES.shop: return ground && !facade ? 'shopfront' : 'shopHouse';
    case WINDOW_CLASSES.office: return glassy ? 'curtain' : 'ribbon';
    case WINDOW_CLASSES.civic: return 'civic';
    case WINDOW_CLASSES.factory: return 'factory';
    case WINDOW_CLASSES.venue: return 'venue';
    default: return null;
  }
}
/** Horizontal squeeze for a facade cell wider than its window should be: x' = 0.5 + (x - 0.5) / squeeze. */
export function squeezeOf(layout: Layout, cellW: number, cellH: number): number {
  const L = RECT[layout];
  if (!L.pane || !L.maxAspect || cellH <= 0) return 1;
  return Math.max(1, (L.pane[0] * cellW) / (L.pane[1] * cellH) / L.maxAspect);
}

/** A window drawn on a wall, in that wall's coordinates (s along it from the left, y up), and the cell it sits in. */
export interface WindowRect { s0: number; s1: number; y0: number; y1: number; cell: { s0: number; s1: number; y0: number; y1: number }; label: string }

/** Every window the shader draws on one wall of a windowed box op, facade or legacy grid. */
export function windowRects(op: Extract<CompiledOp, { 0: 'box' }>, face: number): WindowRect[] {
  const b: Box = [op[1], op[2], op[3], op[4], op[5], op[6]];
  const cls = op[8], hex = op[7], f = op[9];
  if (!cls) return [];
  const glassy = isGlassy(hex);
  const fr = faceFrame(b, face);
  const out: WindowRect[] = [];
  if (f) {
    const g = facadeGrid(b, f, face);
    for (let st = 0; st < g.storeys; st++) for (let bay = 0; bay < g.bays; bay++) {
      const mode = cellMode(f, face, st, bay);
      const L = layoutOf(cls, mode, st === 0, glassy);
      if (!L) continue;
      const k = squeezeOf(L, g.bw, g.sh);
      const [x0, ry0, x1, ry1] = RECT[L].r;
      const [y0, y1] = RECT[L].protect ?? [ry0, ry1];
      const cs = g.m + bay * g.bw, cy = fr.y0 + st * g.sh;
      out.push({
        s0: cs + (0.5 + (x0 - 0.5) / k) * g.bw, s1: cs + (0.5 + (x1 - 0.5) / k) * g.bw, y0: cy + y0 * g.sh, y1: cy + y1 * g.sh,
        cell: { s0: cs, s1: cs + g.bw, y0: cy, y1: cy + g.sh }, label: `${FACES[face]} storey ${st} bay ${bay}${mode === CELL.window ? '' : ` (${Object.keys(CELL).find((n) => CELL[n as keyof typeof CELL] === mode)})`}`,
      });
    }
    return out;
  }
  // the legacy grid: 7 × 5 cells per unit in model coordinates, whatever the wall's size
  const top = fr.y1;
  const lo = Math.min(fr.left, fr.left + fr.dir * fr.width), hi = Math.max(fr.left, fr.left + fr.dir * fr.width);
  const toS = (c: number) => (c - fr.left) * fr.dir;
  const push = (c0: number, c1: number, y0: number, y1: number, cell: WindowRect['cell'], label: string) => {
    const a = Math.max(c0, lo), z = Math.min(c1, hi), b0 = Math.max(y0, fr.y0), b1 = Math.min(y1, fr.y1);
    if (z - a < 0.004 || b1 - b0 < 0.004) return;
    const s0 = toS(a), s1 = toS(z);
    out.push({ s0: Math.min(s0, s1), s1: Math.max(s0, s1), y0: b0, y1: b1, cell, label });
  };
  if (cls === WINDOW_CLASSES.factory) {
    if (top > 0.2) push(lo, hi, top - 0.172, top - 0.028, { s0: 0, s1: fr.width, y0: top - 0.2, y1: top }, `${FACES[face]} clerestory`);
    return out;
  }
  for (let col = Math.floor(lo * 7); col < hi * 7; col++) for (let row = Math.floor(fr.y0 * 5); row < fr.y1 * 5; row++) {
    const L = layoutOf(cls, 0, row === 0, glassy);
    if (!L) continue;
    const yTop = LEGACY_TOP[L];
    if (yTop && top > 0.01 && (row + yTop) / 5 > top + 0.004) continue;
    const [x0, y0, x1, y1] = RECT[L].r;
    const c0 = toS(col / 7), c1 = toS((col + 1) / 7);
    const cell = { s0: Math.max(0, Math.min(c0, c1)), s1: Math.min(fr.width, Math.max(c0, c1)), y0: Math.max(fr.y0, row / 5), y1: Math.min(fr.y1, (row + 1) / 5) };
    push((col + x0) / 7, (col + x1) / 7, (row + y0) / 5, (row + y1) / 5, cell, `${FACES[face]} grid cell ${col},${row}`);
  }
  return out;
}

// ---------------------------------------------------------------- collisions (buildings:check)

/**
 * A part counts on a wall when its near side is within NEAR of it (or behind it, poking out): a door, a balcony, a bay,
 * a wing built against it. Something standing further out is a tree, a car or a neighbouring wall's door seen side-on.
 * REACH is how far out of the wall a roof's slope still counts.
 */
export const NEAR = 0.03;
export const REACH = 0.12;
const EPS = 0.002;

type Shadow = { kind: 'rect'; s0: number; s1: number; y0: number; y1: number } | { kind: 'tri'; pts: [number, number][] };

function bounds(op: CompiledOp): { min: [number, number, number]; max: [number, number, number] } {
  switch (op[0]) {
    case 'box': case 'roof': return { min: [op[4] - op[1] / 2, op[5], op[6] - op[3] / 2], max: [op[4] + op[1] / 2, op[5] + op[2], op[6] + op[3] / 2] };
    case 'cyl': { const r = Math.max(op[1], op[2]); return { min: [op[4] - r, op[5], op[6] - r], max: [op[4] + r, op[5] + op[3], op[6] + r] }; }
    case 'cone': return { min: [op[3] - op[1], op[4], op[5] - op[1]], max: [op[3] + op[1], op[4] + op[2], op[5] + op[1]] };
    case 'wheel': return { min: [op[3] - op[2] / 2, op[4] - op[1], op[5] - op[1]], max: [op[3] + op[2] / 2, op[4] + op[1], op[5] + op[1]] };
  }
}

/** What a part hides on a wall: its outline seen head-on, for the slice of it between the wall and REACH in front. */
function shadowOn(op: CompiledOp, fr: FaceFrame): Shadow | null {
  const { min, max } = bounds(op);
  const a = fr.axis, hAxis = a === 2 ? 0 : 2;
  const n0 = fr.out > 0 ? min[a] - fr.plane : fr.plane - max[a], n1 = fr.out > 0 ? max[a] - fr.plane : fr.plane - min[a];
  if (n1 <= EPS || n0 >= NEAR) return null;
  const sA = (min[hAxis] - fr.left) * fr.dir, sB = (max[hAxis] - fr.left) * fr.dir;
  const s0 = Math.min(sA, sB), s1 = Math.max(sA, sB);
  if (op[0] !== 'roof') return { kind: 'rect', s0, s1, y0: min[1], y1: max[1] };
  const alongZ = op[8], h = op[2], y = op[5];
  const ridgeAxis = alongZ ? 2 : 0;
  if (ridgeAxis === a) return { kind: 'tri', pts: [[s0, y], [s1, y], [(s0 + s1) / 2, y + h]] }; // the gable end faces this wall
  // ridge parallel to the wall: the slope nearest the wall rises away from it, so only its low part is within reach
  const mid = (n0 + n1) / 2, half = (n1 - n0) / 2;
  const lo = Math.max(n0, EPS), hi = Math.min(n1, REACH);
  const best = lo <= mid && mid <= hi ? mid : Math.abs(lo - mid) < Math.abs(hi - mid) ? lo : hi;
  const top = half > 0 ? h * (1 - Math.abs(best - mid) / half) : 0;
  return top > EPS ? { kind: 'rect', s0, s1, y0: y, y1: y + top } : null;
}

/** Area of a convex polygon clipped to an axis-aligned rectangle (Sutherland-Hodgman). */
function clippedArea(pts: [number, number][], s0: number, s1: number, y0: number, y1: number): number {
  let poly = pts;
  const clip = (inside: (p: [number, number]) => boolean, cut: (p: [number, number], q: [number, number]) => [number, number]) => {
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      if (inside(q)) { if (!inside(p)) out.push(cut(p, q)); out.push(q); } else if (inside(p)) out.push(cut(p, q));
    }
    poly = out;
  };
  const atX = (x: number) => (p: [number, number], q: [number, number]): [number, number] => [x, p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0])];
  const atY = (y: number) => (p: [number, number], q: [number, number]): [number, number] => [p[0] + ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]), y];
  clip((p) => p[0] >= s0, atX(s0)); clip((p) => p[0] <= s1, atX(s1)); clip((p) => p[1] >= y0, atY(y0)); clip((p) => p[1] <= y1, atY(y1));
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(area) / 2;
}

export interface WindowCollision { box: number; face: FaceName; part: number; windows: string[] }
/**
 * Parts that cover windows: for every windowed box and each of its walls, any other part reaching out of the wall
 * (up to REACH in front) whose outline overlaps a window's frame, unless it hides that window's whole cell (an
 * annex or a neighbouring block, which reads as a wall, not as a door over a window). Indexes are compiled op indexes.
 */
export function windowCollisions(ops: CompiledOp[]): WindowCollision[] {
  const out: WindowCollision[] = [];
  ops.forEach((op, bi) => {
    if (op[0] !== 'box' || !op[8]) return;
    const b: Box = [op[1], op[2], op[3], op[4], op[5], op[6]];
    for (let face = 0; face < 4; face++) {
      const rects = windowRects(op, face);
      if (!rects.length) continue;
      const fr = faceFrame(b, face);
      ops.forEach((part, pi) => {
        if (pi === bi) return;
        const sh = shadowOn(part, fr);
        if (!sh) return;
        const hit: string[] = [];
        for (const w of rects) {
          if (sh.kind === 'rect') {
            const ow = Math.min(sh.s1, w.s1) - Math.max(sh.s0, w.s0), oh = Math.min(sh.y1, w.y1) - Math.max(sh.y0, w.y0);
            if (ow <= 0.003 || oh <= 0.003) continue;
            const c = w.cell;
            if (sh.s0 <= c.s0 + EPS && sh.s1 >= c.s1 - EPS && sh.y0 <= c.y0 + EPS && sh.y1 >= c.y1 - EPS) continue; // hides the whole cell
          } else if (clippedArea(sh.pts, w.s0, w.s1, w.y0, w.y1) < 2e-5) continue;
          hit.push(w.label);
        }
        if (hit.length) out.push({ box: bi, face: FACES[face], part: pi, windows: hit });
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------- feature helper ops

export interface FeatureTarget {
  /** the box (or roof) op as authored: w h d x y z */
  box: Box;
  /** resolved colour and window class number of the target */
  hex: number; cls: number;
  /** its compiled facade (boxes) — features add cell overrides to it */
  facade?: CompiledFacade;
  /** roofs: ridge along z */
  alongZ?: boolean;
}

const faceIndex = (f: unknown) => FACES.indexOf(f as FaceName);
/** Free height above a floor line (fraction of the storey) before the lowest thing a class draws there. */
const FREE_ABOVE: Record<number, number> = { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.04, 5: 0.5, 6: 0.012 };

/** Expand one feature op into primitive compiled ops; cell overrides go onto the target's facade. */
export function featureOps(op: Op, t: FeatureTarget, featureColour: (c: Color | undefined, dflt: Color) => number): CompiledOp[] {
  const a = op as unknown as unknown[];
  const name = a[0] as string;
  const out: CompiledOp[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number, win = 0, f?: CompiledFacade) => {
    out.push(f ? ['box', r4(w), r4(h), r4(d), r4(x), r4(y), r4(z), hex, win, f] : ['box', r4(w), r4(h), r4(d), r4(x), r4(y), r4(z), hex, win]);
  };
  /** a box against a wall: centred at s (along the wall), base at y, reaching from n0 to n1 out of the wall */
  const onWall = (fr: FaceFrame, s: number, width: number, y: number, h: number, n0: number, n1: number, hex: number, win = 0, f?: CompiledFacade) => {
    const [cx, , cz] = facePoint(fr, s, y, (n0 + n1) / 2);
    const across = n1 - n0;
    if (fr.axis === 2) box(width, h, across, cx, y, cz, hex, win, f); else box(across, h, width, cx, y, cz, hex, win, f);
  };
  const set = (face: number, st: number, bay: number, mode: number) => { (t.facade!.c ??= []).push(face, st, bay, mode); };

  if (name === 'dormer') {
    const [w, h, d, x, y, z] = t.box;
    const n = a[2] as number, body = featureColour(a[3] as Color | undefined, 'white');
    // dormers on the front slope (ridge along x) or the right slope (ridge along z), evenly spaced along the ridge
    const len = t.alongZ ? d : w, depth = t.alongZ ? w : d;
    const dw = Math.min(0.13, (0.6 * len) / n), b = 0.18 * h, dh = Math.max(0.05, Math.min(0.4 * h, h - b - 0.06));
    const front = (depth / 2) * (1 - b / h), dd = (depth / 2) * 0.75;
    for (let i = 0; i < n; i++) {
      const along = -len / 2 + ((i + 0.5) * len) / n;
      const cap = Math.min(0.06, h - b - dh);
      // one window, on the wall facing down the slope (front for a ridge along x, right for one along z); the rest is plain
      const f: CompiledFacade = t.alongZ
        ? { s: 1, b: 1, sb: 1, m: 0, t: 0, c: [0, 0, 0, CELL.plain, 2, 0, 0, CELL.plain, 3, 0, 0, CELL.plain] }
        : { s: 1, b: 1, sb: 0, m: 0, t: 0, c: [2, 0, 0, CELL.plain] };
      if (t.alongZ) {
        box(dd, dh, dw, x + front - dd / 2, y + b, z + along, body, t.cls, f);
        if (cap > 0.01) out.push(['roof', r4(dd + 0.01), r4(cap), r4(dw + 0.03), r4(x + front - dd / 2), r4(y + b + dh), r4(z + along), t.hex, false]);
      } else {
        box(dw, dh, dd, x + along, y + b, z + front - dd / 2, body, t.cls, f);
        if (cap > 0.01) out.push(['roof', r4(dw + 0.03), r4(cap), r4(dd + 0.01), r4(x + along), r4(y + b + dh), r4(z + front - dd / 2), t.hex, true]);
      }
    }
    return out;
  }

  const f = t.facade!;
  if (name === 'cornice') {
    const [w, h, d, x, y, z] = t.box;
    const st = a[2] as number, hex = featureColour(a[3] as Color | undefined, 'stone');
    const sh = (h - f.t) / f.s, p = 0.015;
    if (st >= f.s) {
      // the top of the window grid: a cap on the wall top, or a band in the attic strip
      if (f.t > 0.012) box(w + 2 * p, Math.min(0.035, f.t), d + 2 * p, x, y + h - f.t, z, hex);
      else box(w + 2 * p, 0.03, d + 2 * p, x, y + h, z, hex);
    } else {
      const th = Math.max(0.01, Math.min(0.035, (FREE_ABOVE[t.cls] ?? 0.2) * sh));
      box(w + 2 * p, th, d + 2 * p, x, y + st * sh, z, hex);
    }
    return out;
  }

  const face = faceIndex(a[2]);
  const fr = faceFrame(t.box, face);
  const g = facadeGrid(t.box, f, face);
  const cellS = (bay: number) => g.m + bay * g.bw;
  const floor = (st: number) => fr.y0 + st * g.sh;

  if (name === 'door') {
    const bay = a[3] as number, hex = featureColour(a[4] as Color | undefined, 'door');
    const dw = Math.min(0.6 * g.bw, 0.11), dh = Math.min(0.8 * g.sh, 0.19);
    const s = cellS(bay) + g.bw / 2;
    onWall(fr, s, dw, fr.y0, dh, -0.004, 0.012, hex);
    onWall(fr, s, Math.min(dw + 0.03, g.bw * 0.95), fr.y0, 0.012, 0, 0.035, PALETTE.stone); // the step
    set(face, 0, bay, CELL.plain);
  } else if (name === 'balcony') {
    const st = a[3] as number, from = a[4] as number, to = a[5] as number;
    const rail = featureColour(a[6] as Color | undefined, 'dark'), slab = featureColour(a[7] as Color | undefined, 'stone');
    const s0 = cellS(from) + 0.01, s1 = cellS(to + 1) - 0.01, depth = Math.min(0.1, 0.6 * g.sh);
    const th = Math.max(0.008, Math.min(0.025, 0.15 * g.sh)), rh = 0.3 * g.sh, y = floor(st);
    onWall(fr, (s0 + s1) / 2, s1 - s0, y - th, th, 0, depth, slab);
    onWall(fr, (s0 + s1) / 2, s1 - s0, y, rh, depth - 0.01, depth, rail);
    onWall(fr, s0 + 0.005, 0.01, y, rh, 0, depth, rail);
    onWall(fr, s1 - 0.005, 0.01, y, rh, 0, depth, rail);
    for (let b = from; b <= to; b++) set(face, st, b, CELL.balconyDoor);
  } else if (name === 'baywindow') {
    const st = a[3] as number, bay = a[4] as number, roofHex = featureColour(a[5] as Color | undefined, 'slate');
    const bw = 0.84 * g.bw, base = floor(st) + (st === 0 ? 0 : 0.08 * g.sh), bh = (st === 0 ? 0.88 : 0.8) * g.sh, depth = Math.min(0.08, 0.6 * bw);
    const s = cellS(bay) + g.bw / 2;
    // the bay's own facade: one pane across its front and one in each cheek; its back is inside the wall
    const bf: CompiledFacade = { s: 1, b: 1, sb: 1, m: 0, t: 0, c: [] };
    // the bay box's walls share the host's orientation: the one facing back into the host is plain
    for (let k = 0; k < 4; k++) bf.c!.push(k, 0, 0, k === (face + 2) % 4 ? CELL.plain : CELL.bayPane);
    onWall(fr, s, bw, base, bh, 0, depth, t.hex, t.cls, bf);
    onWall(fr, s, bw + 0.02, base + bh, 0.02, 0, depth + 0.012, roofHex);
    set(face, st, bay, CELL.plain);
  } else if (name === 'garage') {
    set(face, 0, a[3] as number, CELL.garage); // drawn by the shader: no geometry
  } else if (name === 'awning') {
    const from = a[3] as number, to = a[4] as number, hex = featureColour(a[5] as Color | undefined, 'awning');
    const s0 = cellS(from) + 0.005, s1 = cellS(to + 1) - 0.005, depth = Math.min(0.11, 0.7 * g.sh), y = floor(1);
    const th = Math.max(0.008, Math.min(0.022, 0.1 * g.sh));
    onWall(fr, (s0 + s1) / 2, s1 - s0, y - th, th, 0, depth, hex);
    onWall(fr, (s0 + s1) / 2, s1 - s0, y - th - 0.028, 0.028, depth - 0.008, depth, hex); // the valance, hanging at the front
  } else if (name === 'porch') {
    const from = a[3] as number, to = a[4] as number;
    const roofHex = featureColour(a[5] as Color | undefined, 'slate'), post = featureColour(a[6] as Color | undefined, 'white');
    const s0 = cellS(from), s1 = cellS(to + 1), depth = Math.min(0.12, 0.8 * g.sh);
    const th = Math.max(0.008, Math.min(0.025, 0.15 * g.sh)), y = floor(1);
    onWall(fr, (s0 + s1) / 2, s1 - s0, y - th, th, 0, depth, roofHex);
    for (const s of [s0 + 0.012, s1 - 0.012]) onWall(fr, s, 0.014, fr.y0, y - th - fr.y0, depth - 0.022, depth - 0.008, post);
  }
  return out;
}

/** Part references in a design: names on box and roof ops, and the op index (0-based, as authored). */
export function partIndex(ops: Op[]): Map<string | number, number> {
  const m = new Map<string | number, number>();
  ops.forEach((op, i) => {
    if (op[0] !== 'box' && op[0] !== 'roof') return;
    m.set(i, i);
    const opts = op[9];
    if (opts && typeof opts === 'object' && typeof opts.name === 'string') m.set(opts.name, i);
  });
  return m;
}

/** Problems with facades and feature ops in one design (the parts they name, faces, storey and bay ranges). */
export function facadeErrors(ops: Op[], where: string, windows: WindowClass | undefined): string[] {
  const errs: string[] = [];
  const parts = partIndex(ops);
  const names = new Set<string>();
  ops.forEach((op, i) => {
    if ((op[0] === 'box' || op[0] === 'roof') && op[9] !== undefined) {
      const o = op[9] as unknown;
      const w = `${where} op ${i}`;
      if (!o || typeof o !== 'object' || Array.isArray(o)) { errs.push(`${w}: the options after the ${op[0] === 'box' ? 'window class' : 'alongZ flag'} must be an object { name?, facade? }`); return; }
      const { name, facade, ...rest } = o as { name?: unknown; facade?: unknown };
      for (const k of Object.keys(rest)) errs.push(`${w}: unknown option '${k}' (name, facade)`);
      if (name !== undefined) {
        if (typeof name !== 'string' || !/^[A-Za-z][\w-]*$/.test(name)) errs.push(`${w}: name must be a word (letters, digits, - and _)`);
        else if (names.has(name)) errs.push(`${w}: part name '${name}' used twice`); else names.add(name);
      }
      if (facade !== undefined) {
        if (op[0] !== 'box') errs.push(`${w}: only a box can carry a facade`);
        else {
          const win = op[8] === true ? windows : op[8];
          if (!win || win === 'none') errs.push(`${w}: a facade needs a window class (true or a class name before the options)`);
          errs.push(...facadeSpecErrors(facade, op[1], op[2], op[3], w));
        }
      }
    }
  });
  ops.forEach((op, i) => {
    const name = op[0];
    if (!isFeature(name)) return;
    const a = op as unknown as unknown[];
    const w = `${where} op ${i} (${name})`;
    const ref = a[1] as PartRef;
    const ti = parts.get(ref);
    if (ti === undefined) { errs.push(`${w}: no box or roof ${typeof ref === 'string' ? `named '${ref}'` : `at op index ${ref}`} in this design`); return; }
    const target = ops[ti];
    if (name === 'dormer') {
      if (target[0] !== 'roof') errs.push(`${w}: a dormer goes on a roof part; op ${ti} is a ${target[0]}`);
      const n = a[2];
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 8) errs.push(`${w}: n must be 1-8 dormers`);
      return;
    }
    const spec = target[0] === 'box' && target[9] && typeof target[9] === 'object' ? (target[9] as { facade?: FacadeSpec }).facade : undefined;
    if (!spec) { errs.push(`${w}: op ${ti} has no facade; give that box { facade: { storeys, bays } } so ${name} can place by cell`); return; }
    if (facadeSpecErrors(spec, (target as number[])[1] as never, (target as number[])[2] as never, (target as number[])[3] as never, w).length) return;
    const tb = target as unknown as number[];
    const sideBays = spec.sideBays ?? Math.max(1, Math.round((spec.bays * tb[3]) / tb[1]));
    const intIn = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
    if (name === 'cornice') {
      if (!intIn(a[2], 1, spec.storeys)) errs.push(`${w}: storey must be 1-${spec.storeys} (the floor line it sits on; ${spec.storeys} is the top)`);
      return;
    }
    const face = faceIndex(a[2]);
    if (face < 0) { errs.push(`${w}: face must be one of ${FACES.join(', ')}`); return; }
    const bays = face % 2 === 0 ? spec.bays : sideBays;
    if (!bays) { errs.push(`${w}: the ${a[2]} wall has no bays (sideBays 0)`); return; }
    const bay = (v: unknown, what: string) => { if (!intIn(v, 0, bays - 1)) errs.push(`${w}: ${what} ${JSON.stringify(v)} outside 0-${bays - 1} on the ${a[2]} wall`); };
    const storey = (v: unknown, lo: number) => { if (!intIn(v, lo, spec.storeys - 1)) errs.push(`${w}: storey ${JSON.stringify(v)} outside ${lo}-${spec.storeys - 1}`); };
    if (name === 'door') bay(a[3], 'bay');
    else if (name === 'balcony') { storey(a[3], 1); bay(a[4], 'fromBay'); bay(a[5], 'toBay'); if ((a[4] as number) > (a[5] as number)) errs.push(`${w}: fromBay after toBay`); }
    else if (name === 'baywindow') { storey(a[3], 0); bay(a[4], 'bay'); }
    else if (name === 'porch' || name === 'awning') { bay(a[3], 'fromBay'); bay(a[4], 'toBay'); if ((a[3] as number) > (a[4] as number)) errs.push(`${w}: fromBay after toBay`); }
    else if (name === 'garage') bay(a[3], 'bay');
  });
  return errs;
}

export function facadeSpecErrors(spec: unknown, w: number, h: number, d: number, where: string): string[] {
  const errs: string[] = [];
  if (!spec || typeof spec !== 'object') return [`${where}: facade must be { storeys, bays, sideBays?, ground?, margin?, top? }`];
  const s = spec as Record<string, unknown>;
  const intIn = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  for (const k of Object.keys(s)) if (!['storeys', 'bays', 'sideBays', 'ground', 'margin', 'top'].includes(k)) errs.push(`${where}: unknown facade field '${k}'`);
  if (!intIn(s.storeys, 1, 60)) errs.push(`${where}: facade storeys must be an integer 1-60`);
  if (!intIn(s.bays, 1, 24)) errs.push(`${where}: facade bays must be an integer 1-24`);
  if (s.sideBays !== undefined && !intIn(s.sideBays, 0, 24)) errs.push(`${where}: facade sideBays must be an integer 0-24`);
  if (s.ground !== undefined && !(GROUND_KINDS as readonly unknown[]).includes(s.ground)) errs.push(`${where}: facade ground must be one of ${GROUND_KINDS.join(', ')}`);
  const m = s.margin ?? 0, t = s.top ?? 0;
  if (typeof m !== 'number' || m < 0 || m * 2 >= Math.min(w, d)) errs.push(`${where}: facade margin must be a number from 0 to under half the narrower wall`);
  if (typeof t !== 'number' || t < 0 || t >= h) errs.push(`${where}: facade top must be a number from 0 to under the box height`);
  return errs;
}
