import type { CompiledOp } from './schema';
import { PALETTE } from './palette';
import { faceFrame, facePoint, facadeGrid, windowRects, windowCollisions, CELL, type FaceFrame } from './facade';

/**
 * Ad slots on buildings (docs/adverts.md section 2): modest, believable places for a poster, drawn as an empty frame in
 * the building's own model so a street looks right with no adverts at all. A slot is a frame on a wall plus a record the
 * game reads: which way it faces, its size and the poster's rectangle in model space (compile.ts collects them per design
 * into AD_SLOTS in compiled.ts). The poster itself is drawn by the client (render/adverts.ts) on top of the frame when
 * the slot is rented.
 *
 * Pure, shared by the compiler, the validator and `buildings:check`. Sizes are in tiles at the models' scale (a storey
 * is about 0.25, a door 0.19), which is about 15 m to the tile: a 48-sheet billboard (6 x 3 m) is 0.44 x 0.22.
 */

export type AdSize = 'panel' | 'poster' | 'hoarding' | 'billboard' | 'banner' | 'screen';
/** Size codes in slot records, in this order (new sizes go on the end, so old codes keep their meaning). */
export const AD_SIZES: readonly AdSize[] = ['panel', 'poster', 'hoarding', 'billboard', 'banner', 'screen'];
export interface AdSizeDef {
  /** the poster's width and height (tiles); a slot on a small wall shrinks to fit, keeping the shape */
  w: number; h: number;
  /** base rent per game day (shared/src/adverts.ts) */
  rent: number;
  /** which artwork shape it shows (render/adverts.ts atlas): L landscape 2:1, P portrait 3:4, B banner 3:8 */
  cell: 'L' | 'P' | 'B';
  /** how fast it wears relative to a poster (big billboards are out of reach, shelter panels at hand) */
  wear: number;
  /** lit at night (billboards and shelter panels have lamps; paper on a wall does not) */
  lit: boolean;
  /** the frame's colour and border (tiles) */
  frame: number; border: number;
  label: string;
}
export const AD_SIZE: Record<AdSize, AdSizeDef> = {
  panel: { w: 0.12, h: 0.16, rent: 2, cell: 'P', wear: 1.3, lit: true, frame: PALETTE.steel, border: 0.008, label: 'shelter panel' },
  poster: { w: 0.16, h: 0.21, rent: 3, cell: 'P', wear: 1, lit: false, frame: PALETTE.charcoal, border: 0.01, label: 'poster' },
  hoarding: { w: 0.42, h: 0.14, rent: 6, cell: 'L', wear: 1.15, lit: false, frame: PALETTE.dark, border: 0.01, label: 'hoarding' },
  billboard: { w: 0.44, h: 0.22, rent: 10, cell: 'L', wear: 0.6, lit: true, frame: 0x24382c, border: 0.014, label: 'billboard' },
  banner: { w: 0.11, h: 0.29, rent: 8, cell: 'B', wear: 0.7, lit: false, frame: PALETTE.charcoal, border: 0.008, label: 'banner' },
  // a big screen (docs/adverts.md section 9): lit, animated, its turns shared round the building's screens; it never wears
  screen: { w: 0.5, h: 0.28, rent: 40, cell: 'L', wear: 0, lit: true, frame: 0x14171b, border: 0.012, label: 'big screen' },
};
export const isAdSize = (s: unknown): s is AdSize => typeof s === 'string' && (AD_SIZES as readonly string[]).includes(s);

/**
 * Numbers per slot in a record: face (0 front, 1 right, 3 left: the nearest wall's for a screen on a curve), size code,
 * poster centre x y z, poster w h, and the way the poster faces as a turn about y in model space (radians: 0 faces +z,
 * pi/2 +x; a wall's own direction, or a screen panel's on a curve).
 */
export const AD_STRIDE = 8;
/** The turn about y that faces a wall (front, right, back, left). */
export const FACE_YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2] as const;
/** How far the poster stands out of the wall (in front of the frame's paper). */
export const AD_POSTER_OUT = 0.0125;
/** The blank paper an empty frame shows, and the black glass of a screen that is off. */
const PAPER = 0xe6e2d6, GLASS = 0x0b0d10;

/**
 * The frame for one slot on a wall: a border box and the blank paper inside it, and the slot record. `s` is the poster's
 * centre along the wall from its left edge, `yc` its centre height; `pw`, `ph` its size.
 */
export function adFrame(fr: FaceFrame, s: number, yc: number, size: AdSize, pw: number, ph: number, slots?: number[]): CompiledOp[] {
  const def = AD_SIZE[size], b = def.border;
  const out: CompiledOp[] = [];
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const onWall = (width: number, y: number, h: number, n1: number, hex: number) => {
    const [cx, , cz] = facePoint(fr, s, y, n1 / 2);
    out.push(fr.axis === 2 ? ['box', r4(width), r4(h), r4(n1), r4(cx), r4(y), r4(cz), hex, 0] : ['box', r4(n1), r4(h), r4(width), r4(cx), r4(y), r4(cz), hex, 0]);
  };
  onWall(pw + 2 * b, yc - ph / 2 - b, ph + 2 * b, 0.008, def.frame);
  onWall(pw, yc - ph / 2, ph, 0.011, size === 'screen' ? GLASS : PAPER);
  if (slots) {
    const [x, y, z] = facePoint(fr, s, yc, AD_POSTER_OUT);
    slots.push(fr.face, AD_SIZES.indexOf(size), r4(x), r4(y), r4(z), r4(pw), r4(ph), r4(FACE_YAW[fr.face]));
  }
  return out;
}

/**
 * A bank of screens on a curve (the `screens` op, docs/adverts.md section 9): `cols` × `rows` flat panels round the
 * outside of a vertical arc of radius `r` about (x, z), from `from` to `to` degrees (0 faces +z, the front; 90 the
 * right, -90 the left), the bank's foot at `y` and its height `h`. Each column is one facet of a dark bezel cylinder
 * whose segments line up with the columns (so `360 / ((to - from) / cols)` must be a whole number and `from` a
 * multiple of a column's angle; validate.ts checks). Every panel is a `screen` slot of its own, facing out of its facet.
 */
export function screenArc(x: number, y: number, z: number, r: number, from: number, to: number, cols: number, rows: number, h: number, bezel: number, slots?: number[]): CompiledOp[] {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const step = (to - from) / cols, segs = Math.round(360 / step), rad = Math.PI / 180;
  const gap = 0.012, rim = 0.016;
  const chord = 2 * r * Math.sin((step * rad) / 2), apo = r * Math.cos((step * rad) / 2);
  const pw = chord - gap, ph = (h - (rows + 1) * gap) / rows;
  // the bezel: one band, its facets the columns', a hair taller than the panels. Nothing stands proud of radius r, so a
  // wall the curve meets tangentially keeps its windows (the windows check)
  const out: CompiledOp[] = [['cyl', r4(r), r4(r), r4(h + 2 * rim), r4(x), r4(y - rim), r4(z), bezel, segs]];
  if (slots) for (let row = 0; row < rows; row++) for (let c = 0; c < cols; c++) {
    const a = (from + (c + 0.5) * step) * rad, d = apo + 0.004;
    const yc = y + gap + ph / 2 + row * (ph + gap);
    const deg = a / rad, face = deg >= 45 ? 1 : deg <= -45 ? 3 : 0;
    slots.push(face, AD_SIZES.indexOf('screen'), r4(x + Math.sin(a) * d), r4(yc), r4(z + Math.cos(a) * d), r4(pw), r4(ph), r4(a));
  }
  return out;
}

/** The poster's size on a wall `width` wide and `height` tall: the size's own, shrunk (keeping its shape) to fit with a margin. */
export function fitPoster(size: AdSize, width: number, height: number): [number, number] {
  const d = AD_SIZE[size], b = d.border;
  const k = Math.min(1, (width - 0.03) / (d.w + 2 * b), (height - 0.02) / (d.h + 2 * b));
  return [Math.max(0.02, d.w * k), Math.max(0.02, d.h * k)];
}

type BoxOp = Extract<CompiledOp, { 0: 'box' }>;
const boxOf = (op: BoxOp) => [op[1], op[2], op[3], op[4], op[5], op[6]] as const;

/**
 * Problems with a design's slots once compiled (compile.ts runs it on every design): a frame may not cover a window on
 * any wall (docs/adverts.md section 2, "treated like a signboard"). `first` is the index of the first frame op.
 */
export function adFrameCollisions(ops: CompiledOp[], frames: Set<number>): string[] {
  const errs: string[] = [];
  for (const c of windowCollisions(ops)) if (frames.has(c.part)) errs.push(`ad slot frame (op ${c.part}) covers windows on the ${c.face} wall of op ${c.box}: ${c.windows.slice(0, 3).join(', ')}`);
  return errs;
}

/** Axis-aligned bounds of the boxes and round parts, for the "something stands in front of it" test. */
function extent(op: CompiledOp): [number, number, number, number, number, number] | null {
  switch (op[0]) {
    case 'box': case 'roof': return [op[4] - op[1] / 2, op[4] + op[1] / 2, op[5], op[5] + op[2], op[6] - op[3] / 2, op[6] + op[3] / 2];
    case 'cyl': { const r = Math.max(op[1], op[2]); return [op[4] - r, op[4] + r, op[5], op[5] + op[3], op[6] - r, op[6] + r]; }
    case 'cone': return [op[3] - op[1], op[3] + op[1], op[4], op[4] + op[2], op[5] - op[1], op[5] + op[1]];
    default: return null;
  }
}
const overlaps = (a: number[], b: number[]) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3] && a[4] < b[5] && b[4] < a[5];

/**
 * A default slot for a design with none of its own (compile.ts gives one to about one commercial or leisure design in
 * three, docs/adverts.md section 2): a poster on a side wall of the main block, in the bay nearest the road (a facade wall's
 * cells under it become plain wall, a blank bay as on a real shop's flank) or wherever it covers no window, with nothing
 * standing in front of it; or a billboard on legs over the front of a flat roof. `seed` (0-1) picks which is tried
 * first and where along the wall, so a street's frames differ. Returns the frame ops (to append) and the slot record,
 * or null when nothing fits.
 */
export function autoAdSlot(ops: readonly CompiledOp[], seed: number, leisure: boolean): { ops: CompiledOp[]; slot: number[]; main?: CompiledOp; mainAt?: number } | null {
  let main: BoxOp | null = null, best = 0;
  for (const op of ops) {
    if (op[0] !== 'box' || !op[8] || op[5] > 0.05) continue;
    const v = op[1] * op[2] * op[3];
    if (v > best) { best = v; main = op; }
  }
  if (!main) return null;
  const b = boxOf(main);
  const [w, h, d, x, y, z] = b;
  type Found = { ops: CompiledOp[]; slot: number[]; main?: BoxOp };
  const tryWall = (): Found | null => {
    const faces = seed < 0.5 ? [3, 1] : [1, 3];
    const size: 'poster' | 'banner' = leisure && h >= 0.5 ? 'banner' : 'poster';
    const f = main![9];
    for (const face of faces) {
      const fr = faceFrame(b, face);
      if (fr.width < 0.22) continue;
      const [pw, ph] = fitPoster(size, fr.width, Math.min(h, 0.5));
      if (pw < 0.1) continue;
      // the side wall's front end: the right wall's s runs from the front (+z) back, the left wall's from the back forward
      const fromFront = (t: number) => (face === 1 ? 0.03 + pw / 2 + t * (fr.width - pw - 0.06) : fr.width - 0.03 - pw / 2 - t * (fr.width - pw - 0.06));
      const tries: { s: number; yc: number }[] = [];
      if (f) {
        // a facade wall: the poster takes the bay nearest the road (or the next one), and the cells it covers become plain wall
        const g = facadeGrid(b, f, face);
        const sh = g.sh;
        const yc = ph + 0.03 <= sh ? y + sh / 2 : y + 0.03 + ph / 2;
        if (g.bays) for (const k of seed < 0.7 ? [0, 1] : [1, 0]) {
          if (k >= g.bays) continue;
          const bay = face === 1 ? k : g.bays - 1 - k;
          tries.push({ s: g.m + (bay + 0.5) * g.bw, yc });
        } else for (const t of [0.15, 0.4]) tries.push({ s: fromFront(t), yc });
      } else {
        for (let i = 0; i < 6; i++) for (const dy of [0.04, 0.12]) tries.push({ s: fromFront((i + 0.5) / 6), yc: y + dy + ph / 2 });
      }
      for (const { s, yc } of tries) {
        if (yc + ph / 2 > y + h - 0.02) continue;
        let host: BoxOp = main!;
        if (f) {
          // blank the cells under the poster (and a hair round it) on this wall
          const g = facadeGrid(b, f, face);
          const c = [...(f.c ?? [])];
          for (let st = 0; st < g.storeys; st++) for (let bay = 0; bay < g.bays; bay++) {
            const c0 = g.m + bay * g.bw, c1 = c0 + g.bw, r0 = y + st * g.sh, r1 = r0 + g.sh;
            if (c1 > s - pw / 2 - 0.01 && c0 < s + pw / 2 + 0.01 && r1 > yc - ph / 2 - 0.01 && r0 < yc + ph / 2 + 0.01) c.push(face, st, bay, CELL.plain);
          }
          host = [...main!.slice(0, 9), { ...f, c }] as unknown as BoxOp;
        }
        const wins = windowRects(host, face);
        const s0 = s - pw / 2 - 0.015, s1 = s + pw / 2 + 0.015, y0 = yc - ph / 2 - 0.015, y1 = yc + ph / 2 + 0.015;
        if (wins.some((r) => r.s1 > s0 && r.s0 < s1 && r.y1 > y0 && r.y0 < y1)) continue;
        const slot: number[] = [];
        const frame = adFrame(fr, s, yc, size, pw, ph, slot);
        const all = ops.map((o) => (o === main ? host : o));
        if (blocked(ops, main!, fr, s, yc, pw, ph) || adFrameCollisions([...all, ...frame], new Set(frame.map((_, k) => ops.length + k))).length) continue;
        return { ops: frame, slot, main: host === main ? undefined : host };
      }
    }
    return null;
  };
  const tryRoof = (): Found | null => {
    if (h > 0.9 || w < 0.4 || d < 0.2) return null;
    const top = y + h;
    if (ops.some((op) => op[0] === 'roof' && Math.abs(op[4] - x) < w / 2 && Math.abs(op[6] - z) < d / 2 && op[5] >= top - 0.01)) return null;
    // a flat top: nothing taller than a parapet stands where the board goes (plant, a tank, a sign)
    const front = z + d / 2;
    const bb = Math.min(0.44, w - 0.06), bh = bb / 2, legs = 0.07;
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
    for (const bz of [front - 0.1, z]) for (const bx of [x, x - w / 4, x + w / 4]) {
      if (Math.abs(bx - x) + bb / 2 > w / 2 - 0.02) continue;
      const region = [bx - bb / 2 - 0.02, bx + bb / 2 + 0.02, top + 0.035, top + legs + bh + 0.04, bz - 0.06, bz + 0.04];
      if (ops.some((op) => { if (op === main) return false; const e = extent(op); return !!e && overlaps(e, region); })) continue;
      const out: CompiledOp[] = [];
      // two legs and a walkway under the board
      for (const lx of [bx - bb * 0.32, bx + bb * 0.32]) out.push(['box', 0.02, legs + 0.02, 0.02, r4(lx), top, r4(bz - 0.012), PALETTE.charcoal, 0]);
      out.push(['box', bb + 0.04, 0.006, 0.05, r4(bx), r4(top + legs - 0.004), r4(bz + 0.02), PALETTE.charcoal, 0]);
      // the back of the board, then its frame on the front face
      const back: BoxOp = ['box', r4(bb + 0.03), r4(bh + 0.03), 0.016, r4(bx), r4(top + legs), r4(bz - 0.008), 0x24382c, 0];
      out.push(back);
      const fr = faceFrame(boxOf(back), 0);
      const slot: number[] = [];
      out.push(...adFrame(fr, fr.width / 2, top + legs + 0.015 + bh / 2, 'billboard', bb, bh, slot));
      return { ops: out, slot };
    }
    return null;
  };
  const order = seed < 0.4 ? [tryRoof, tryWall] : [tryWall, tryRoof];
  for (const f of order) { const r = f(); if (r) return { ...r, mainAt: r.main ? ops.indexOf(main) : undefined }; }
  return null;
}

/** Whether another part stands in front of a poster on this wall (an annex, a wing, a tree), hiding it. */
function blocked(ops: readonly CompiledOp[], main: CompiledOp, fr: FaceFrame, s: number, yc: number, pw: number, ph: number): boolean {
  const [ax, , az] = facePoint(fr, s - pw / 2, 0, 0.004), [bx, , bz] = facePoint(fr, s + pw / 2, 0, 0.12);
  const region = [Math.min(ax, bx), Math.max(ax, bx), yc - ph / 2, yc + ph / 2, Math.min(az, bz), Math.max(az, bz)];
  for (const op of ops) {
    if (op === main) continue;
    const e = extent(op);
    if (e && overlaps(e, region)) return true;
  }
  return false;
}
