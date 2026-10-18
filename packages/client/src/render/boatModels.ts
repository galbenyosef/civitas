import { BufferGeometry, BoxGeometry, CylinderGeometry, Float32BufferAttribute, Quaternion, Vector3 } from 'three';
import { hash2, type BoatType } from '@msimcity/shared';
import { Kit } from './kit';

/**
 * The boat models (docs/boats.md section 7), built once from boxes, cylinders and lofted hulls. Model frame: +x forward
 * (the bow), +y up, +z to starboard, the origin at the middle of the hull on the waterline; lengths are tiles and follow
 * BOAT_TYPES (shared/src/boats.ts). The part under the waterline is drawn too: the ground is the water, so it hides it.
 *
 * Each type is a handful of geometries, one InstancedMesh each (render/boats.ts):
 *  - `hull` and `accent` are white and tinted per boat (hull paint, boot stripe, cabin, funnel);
 *  - `works` keeps its own colours (decks, superstructure, rigging, fittings);
 *  - `glass` is windows, lit at night;
 *  - `sails` are white and tinted per boat, each turning about its pivot as the sail is trimmed;
 *  - `opt` is a part only some boats of the type have (a flybridge, deck cranes);
 *  - `cargo` are variants of the load (containers, heaps), a boat takes one by its seed.
 */

type V3 = [number, number, number];
const WHITE = 0xffffff;
const TEAK = 0xb48d5a, DECK = 0x7a7f86, DARK = 0x23262b, CREAM = 0xe6dcc0, PAINT_W = 0xf1efe8, RIG = 0x5a4228, STEEL = 0x8a9096, ORANGE = 0xe0661f;

/** Triangles with their winding set outward from a reference point. */
class Tris {
  pos: number[] = [];
  tri(a: V3, b: V3, c: V3, ref: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dx = (a[0] + b[0] + c[0]) / 3 - ref[0], dy = (a[1] + b[1] + c[1]) / 3 - ref[1], dz = (a[2] + b[2] + c[2]) / 3 - ref[2];
    if (nx * dx + ny * dy + nz * dz < 0) this.pos.push(...a, ...c, ...b); else this.pos.push(...a, ...b, ...c);
  }
  quad(a: V3, b: V3, c: V3, d: V3, ref: V3) { this.tri(a, b, c, ref); this.tri(a, c, d, ref); }
  /** both faces, for sails */
  both(a: V3, b: V3, c: V3) { this.pos.push(...a, ...b, ...c, ...a, ...c, ...b); }
  geo(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    return g;
  }
}

// ---- hulls --------------------------------------------------------------------------------------------------
interface Stn { x: number; hw: number; hwb: number; top: number; bot: number }
interface HullOpts {
  len: number; beam: number; top: number; bot: number;
  /** where the bow's taper starts, as a fraction of the length from the stern; and how sharp it is */
  bowAt?: number; bowPow?: number;
  /** half-beam at the transom as a fraction of the full; the keel's width as a fraction of the deck's; the sheer at the bow */
  sternK?: number; bottomK?: number; sheer?: number;
}
const N_STN = 18;
function stations(o: HullOpts): Stn[] {
  const tb = o.bowAt ?? 0.6, bp = o.bowPow ?? 1.8, sk = o.sternK ?? 0.8, bk = o.bottomK ?? 0.6, sh = o.sheer ?? 0;
  const out: Stn[] = [];
  for (let i = 0; i < N_STN; i++) {
    const t = i / (N_STN - 1);
    let hw = o.beam / 2;
    if (t < 0.2) { const u = t / 0.2; hw *= sk + (1 - sk) * (2 * u - u * u); }
    let bot = o.bot;
    if (t > tb) { const u = (t - tb) / (1 - tb); hw *= Math.pow(Math.max(0, 1 - Math.pow(u, bp)), 0.6); bot = o.bot * (1 - 0.75 * u * u); }
    out.push({ x: -o.len / 2 + o.len * t, hw, hwb: hw * bk, top: o.top + sh * t * t, bot });
  }
  return out;
}
/** half-beam of the deck at x */
function hwAt(st: Stn[], x: number): number {
  for (let i = 0; i + 1 < st.length; i++) if (x <= st[i + 1].x) { const f = (x - st[i].x) / (st[i + 1].x - st[i].x); return st[i].hw + f * (st[i + 1].hw - st[i].hw); }
  return 0;
}
const pt = (s: Stn, f: number, side: number): V3 => [s.x, s.bot + f * (s.top - s.bot), side * (s.hwb + f * (s.hw - s.hwb))];
/** both sides of the hull between heights f0 and f1 (0 the keel, 1 the deck); from the keel up it also closes the bottom */
function hullBand(st: Stn[], f0: number, f1: number): BufferGeometry {
  const t = new Tris(), mid = st[st.length >> 1], ref: V3 = [mid.x, (mid.top + mid.bot) / 2, 0];
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i], b = st[i + 1];
    for (const sd of [-1, 1]) t.quad(pt(a, f0, sd), pt(b, f0, sd), pt(b, f1, sd), pt(a, f1, sd), ref);
    if (f0 === 0) t.quad(pt(a, 0, -1), pt(b, 0, -1), pt(b, 0, 1), pt(a, 0, 1), ref);
  }
  const s = st[0]; // the transom
  t.quad(pt(s, f0, -1), pt(s, f0, 1), pt(s, f1, 1), pt(s, f1, -1), ref);
  return t.geo();
}
/** the deck's top surface, at the sheer line, `lift` above it */
function deckFace(st: Stn[], lift = 0): BufferGeometry {
  const t = new Tris(), mid = st[st.length >> 1], ref: V3 = [mid.x, mid.bot, 0];
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i], b = st[i + 1];
    t.quad([a.x, a.top + lift, -a.hw], [b.x, b.top + lift, -b.hw], [b.x, b.top + lift, b.hw], [a.x, a.top + lift, a.hw], ref);
  }
  return t.geo();
}
/** a rod between two points */
function rod(a: V3, b: V3, r: number, seg = 5): BufferGeometry {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
  const g = new CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
/** a cylinder along x */
const cylX = (r: number, x0: number, x1: number, y: number, z: number, seg = 8) => new CylinderGeometry(r, r, x1 - x0, seg).rotateZ(-Math.PI / 2).translate((x0 + x1) / 2, y, z);

/** A sail: triangles or a quad with some belly (+z), both faces, in the sail's pivot frame (y up from the foot). */
function sailGeo(polys: V3[][], belly = 0.01): BufferGeometry {
  const t = new Tris();
  for (const p of polys) {
    const c: V3 = [0, 0, belly];
    for (const v of p) { c[0] += v[0] / p.length; c[1] += v[1] / p.length; }
    for (let i = 0; i < p.length; i++) t.both(p[i], p[(i + 1) % p.length], c);
  }
  return new Kit().part(t.geo(), WHITE).build(); // vertex colours white: the sail is tinted per instance
}

// ---- the model description ------------------------------------------------------------------------------------
export interface SailDef { geo: BufferGeometry; pivot: V3; /** how far this sail swings as the main does */ k: number }
export interface BoatModel {
  hull: BufferGeometry; accent: BufferGeometry | null; works: BufferGeometry; glass: BufferGeometry | null;
  sails: SailDef[];
  opt: BufferGeometry | null;
  cargo: (BufferGeometry | null)[];
  /** navigation lights: port (red, z < 0), starboard (green), the masthead, the stern light, deck floods */
  port: V3; stbd: V3; mast: V3; stern: V3; deck: V3[]; blue?: V3;
  /** the wheelhouse eye; none where there is no wheelhouse (a dinghy's helm sits in the open) */
  eye: V3; wheelhouse: boolean;
  /** the bow's tip, for the bow wave, and the stern, for the wake */
  bow: number;
  /** height of the deck over the water: where fenders hang */
  free: number;
}
interface Parts { hull: Kit; accent: Kit; works: Kit; glass: Kit }
const parts = (): Parts => ({ hull: new Kit(), accent: new Kit(), works: new Kit(), glass: new Kit() });
const done = (p: Parts, extra: Partial<BoatModel> & Pick<BoatModel, 'port' | 'stbd' | 'mast' | 'stern' | 'eye' | 'bow' | 'free'>, useAccent = true): BoatModel => {
  const empty = (k: Kit) => (k as unknown as { parts: unknown[] }).parts.length === 0; // Kit.build() needs a part to merge
  const glass = empty(p.glass) ? null : p.glass.build(), accent = useAccent && !empty(p.accent) ? p.accent.build() : null;
  return { hull: p.hull.build(), accent, works: p.works.build(), glass, sails: [], opt: null, cargo: [], deck: [], wheelhouse: true, ...extra };
};
/** a window: a thin glass box proud of a wall */
const win = (p: Parts, w: number, h: number, d: number, x: number, y: number, z: number) => { p.glass.box(w, h, d, x, y, z, WHITE); };
/** a row of `n` windows along both sides of a house (centre x, span, wall half-width) */
const sideWindows = (p: Parts, n: number, x: number, span: number, hw: number, y: number, h: number, w: number) => {
  for (let i = 0; i < n; i++) for (const sd of [-1, 1]) win(p, w, h, 0.004, x - span / 2 + (span * (i + 0.5)) / n, y, sd * (hw + 0.001));
};

// ---- the models -----------------------------------------------------------------------------------------------
function dinghy(): BoatModel {
  const p = parts(), L = 0.22, B = 0.09, top = 0.036;
  const st = stations({ len: L, beam: B, top, bot: -0.012, bowAt: 0.45, bowPow: 1.7, sternK: 0.7, bottomK: 0.5, sheer: 0.008 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.works.part(deckFace(st, 0.001), 0xcaa974);
  p.works.box(0.01, 0.005, 0.07, 0.015, top - 0.002, 0, TEAK).box(0.01, 0.005, 0.06, -0.05, top - 0.002, 0, TEAK) // thwarts
    .box(0.05, 0.004, 0.012, -0.12, top + 0.006, 0, TEAK) // tiller
    .cyl(0.003, 0.0035, 0.2, 0.045, top, 0, 0xd9d4c8, 5); // mast
  const sail = sailGeo([[[0, 0.012, 0], [-0.1, 0.012, 0], [0, 0.17, 0]]], 0.006);
  return done(p, { free: top,
    sails: [{ geo: sail, pivot: [0.045, top, 0], k: 1 }], wheelhouse: false, eye: [-0.06, top + 0.05, 0],
    port: [0.07, top + 0.006, -0.03], stbd: [0.07, top + 0.006, 0.03], mast: [0.045, 0.2, 0], stern: [-0.1, top + 0.006, 0], bow: L / 2,
  }, false);
}

function motorCruiser(): BoatModel {
  const p = parts(), L = 0.42, B = 0.14, top = 0.04;
  const st = stations({ len: L, beam: B, top, bot: -0.02, bowAt: 0.5, bowPow: 1.6, sternK: 0.85, bottomK: 0.6, sheer: 0.012 });
  p.hull.part(hullBand(st, 0, 0.58), WHITE).part(hullBand(st, 0.72, 1), WHITE);
  p.accent.part(hullBand(st, 0.58, 0.72), WHITE);
  p.works.part(deckFace(st, 0.001), 0xe4dfd2);
  p.works.box(0.17, 0.034, 0.1, 0.0, top, 0, PAINT_W) // cabin
    .box(0.19, 0.004, 0.115, 0.0, top + 0.034, 0, 0xdedad0) // roof
    .box(0.05, 0.004, 0.13, -0.18, top + 0.002, 0, TEAK) // swim platform
    .cyl(0.003, 0.003, 0.028, -0.02, top + 0.038, 0, STEEL, 5) // radar mast
    .box(0.02, 0.003, 0.02, -0.02, top + 0.066, 0, DARK);
  p.glass.box(0.004, 0.024, 0.09, 0.087, top + 0.006, 0, WHITE); // windscreen
  sideWindows(p, 3, -0.005, 0.12, 0.05, top + 0.012, 0.016, 0.03);
  const o = new Kit(); // flybridge
  o.box(0.07, 0.02, 0.09, -0.04, top + 0.038, 0, PAINT_W).box(0.074, 0.003, 0.094, -0.04, top + 0.058, 0, 0xdedad0).box(0.004, 0.014, 0.08, 0.002, top + 0.044, 0, DARK);
  return done(p, { free: top,
    opt: o.build(), eye: [0.05, top + 0.022, 0],
    port: [0.12, top + 0.004, -0.05], stbd: [0.12, top + 0.004, 0.05], mast: [-0.02, 0.09, 0], stern: [-0.19, top + 0.01, 0], bow: L / 2, deck: [],
  });
}

function sailboat(): BoatModel {
  const p = parts(), L = 0.5, B = 0.15, top = 0.05;
  const st = stations({ len: L, beam: B, top, bot: -0.04, bowAt: 0.5, bowPow: 1.7, sternK: 0.55, bottomK: 0.35, sheer: 0.02 });
  p.hull.part(hullBand(st, 0, 0.78), WHITE).part(hullBand(st, 0.9, 1), WHITE);
  p.accent.part(hullBand(st, 0.78, 0.9), WHITE);
  p.works.part(deckFace(st, 0.001), TEAK);
  p.works.box(0.2, 0.024, 0.07, 0.02, top, 0, PAINT_W).box(0.1, 0.004, 0.05, -0.04, top + 0.024, 0, 0xcfcab9) // trunk, hatch
    .box(0.05, 0.003, 0.09, -0.2, top, 0, 0x555a60) // cockpit well
    .cyl(0.0035, 0.0045, 0.34, 0.07, top, 0, 0xd4d6d8, 6) // mast
    .part(rod([0.07, 0.36, 0], [-0.235, top, 0], 0.0012), STEEL).part(rod([0.07, 0.36, 0], [0.245, top + 0.01, 0], 0.0012), STEEL);
  for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) win(p, 0.022, 0.012, 0.004, -0.04 + i * 0.045, top + 0.007, sd * 0.0355);
  // main on a boom, and a jib on the forestay
  const main = sailGeo([[[0, 0.03, 0], [-0.17, 0.03, 0], [-0.1, 0.19, 0]], [[0, 0.03, 0], [-0.1, 0.19, 0], [0, 0.325, 0]]], 0.012);
  const jib = sailGeo([[[0, 0, 0], [-0.17, 0.31, 0], [-0.1, 0.012, 0]]], 0.008);
  return done(p, { free: top,
    sails: [{ geo: main, pivot: [0.07, top + 0.004, 0], k: 1 }, { geo: jib, pivot: [0.245, top + 0.006, 0], k: 0.75 }],
    wheelhouse: false, eye: [-0.17, top + 0.05, 0],
    port: [0.2, top + 0.02, -0.05], stbd: [0.2, top + 0.02, 0.05], mast: [0.07, 0.38, 0], stern: [-0.235, top + 0.02, 0], bow: L / 2, deck: [],
  });
}

function narrowboat(): BoatModel {
  const p = parts(), L = 0.62, B = 0.07, top = 0.026;
  const st = stations({ len: L, beam: B, top, bot: -0.012, bowAt: 0.82, bowPow: 2.2, sternK: 0.85, bottomK: 0.9, sheer: 0.004 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.works.part(deckFace(st, 0.001), 0x5c3a2e);
  p.accent.box(0.4, 0.03, 0.062, -0.07, top, 0, WHITE); // the painted cabin
  p.works.box(0.41, 0.004, 0.066, -0.07, top + 0.03, 0, 0xcdc7b4) // roof
    .cyl(0.004, 0.0045, 0.018, 0.04, top + 0.034, 0, 0x2a2622, 6) // chimney
    .box(0.1, 0.022, 0.05, 0.215, top, 0, 0x2d4a3a) // the cratch
    .box(0.05, 0.003, 0.03, -0.31, top + 0.0, 0, 0x6b4a2a).box(0.012, 0.008, 0.006, -0.32, top + 0.003, 0.01, DARK) // tiller
    .part(cylX(0.0025, -0.18, 0.04, top + 0.037, 0.018, 4), STEEL); // a pole on the roof
  // lined panels: a pin-stripe either side, and a name board
  for (const sd of [-1, 1]) {
    p.works.box(0.4, 0.0018, 0.0012, -0.07, top + 0.012, sd * 0.0314, 0xe8d9a0).box(0.4, 0.0018, 0.0012, -0.07, top + 0.021, sd * 0.0314, 0xe8d9a0)
      .box(0.07, 0.008, 0.0012, 0.07, top + 0.014, sd * 0.0316, CREAM);
  }
  for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) win(p, 0.028, 0.012, 0.003, -0.2 + i * 0.065 + (i > 2 ? 0.02 : 0), top + 0.011, sd * 0.0315);
  return done(p, { free: top,
    wheelhouse: false, eye: [-0.3, top + 0.03, 0],
    port: [0.26, top + 0.004, -0.025], stbd: [0.26, top + 0.004, 0.025], mast: [0.04, 0.07, 0], stern: [-0.31, top + 0.01, 0], bow: L / 2, deck: [],
  });
}

function trawler(): BoatModel {
  const p = parts(), L = 0.55, B = 0.16, top = 0.058;
  const st = stations({ len: L, beam: B, top, bot: -0.045, bowAt: 0.62, bowPow: 1.8, sternK: 0.85, bottomK: 0.55, sheer: 0.025 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.accent.part(hullBand(st, 0.9, 1), WHITE);
  p.works.part(deckFace(st, 0.001), DECK);
  p.works.box(0.13, 0.06, 0.11, 0.1, top + 0.004, 0, 0xf2f0ea) // wheelhouse
    .box(0.145, 0.004, 0.125, 0.1, top + 0.064, 0, 0xdedad0)
    .box(0.03, 0.04, 0.05, 0.03, top + 0.004, 0, DARK) // funnel stack
    .cyl(0.004, 0.005, 0.12, 0.09, top + 0.068, 0, 0xd4d6d8, 6) // mast
    .box(0.07, 0.003, 0.003, 0.09, top + 0.15, 0, STEEL) // crosstree
    .box(0.07, 0.02, 0.1, -0.08, top, 0, 0x4a4f55) // winch and net drum
    .box(0.1, 0.034, 0.13, -0.17, top, 0.0, 0xd9692a).box(0.08, 0.026, 0.1, -0.16, top + 0.034, 0.005, 0x4a8c5a) // nets
    .box(0.04, 0.012, 0.04, 0.02, top, -0.04, 0x2e6fb0).box(0.04, 0.012, 0.04, 0.02, top + 0.012, -0.04, 0x2e6fb0); // fish boxes
  // the stern gantry: an A-frame with a block
  p.works.part(rod([-0.23, top, -0.06], [-0.23, top + 0.09, -0.012], 0.004), STEEL).part(rod([-0.23, top, 0.06], [-0.23, top + 0.09, 0.012], 0.004), STEEL)
    .box(0.01, 0.01, 0.04, -0.23, top + 0.088, 0, STEEL);
  win(p, 0.004, 0.026, 0.1, 0.1 + 0.066, top + 0.026, 0); win(p, 0.1, 0.022, 0.004, 0.1, top + 0.028, 0.0555); win(p, 0.1, 0.022, 0.004, 0.1, top + 0.028, -0.0555);
  return done(p, { free: top,
    eye: [0.13, top + 0.045, 0],
    port: [0.2, top + 0.03, -0.065], stbd: [0.2, top + 0.03, 0.065], mast: [0.09, 0.17, 0], stern: [-0.26, top + 0.02, 0], bow: L / 2,
    deck: [[-0.22, top + 0.1, -0.03], [-0.22, top + 0.1, 0.03], [0.04, top + 0.04, 0]],
  });
}

function riverBus(): BoatModel {
  const p = parts(), L = 0.95, top = 0.05;
  const st = stations({ len: L, beam: 0.1, top, bot: -0.03, bowAt: 0.6, bowPow: 1.5, sternK: 0.8, bottomK: 0.5, sheer: 0.012 });
  for (const sd of [-1, 1]) { p.hull.part(hullBand(st, 0, 1).translate(0, 0, sd * 0.08), WHITE); p.works.part(deckFace(st, 0.001).translate(0, 0, sd * 0.08), DECK); }
  p.works.box(0.8, 0.008, 0.2, -0.02, top, 0, 0xe4e0d4) // the deck between the hulls
    .box(0.5, 0.05, 0.19, -0.1, top + 0.008, 0, 0xf2f0ea) // saloon
    .box(0.52, 0.004, 0.2, -0.1, top + 0.058, 0, 0xdedad0)
    .box(0.12, 0.03, 0.12, 0.2, top + 0.058, 0, 0xf2f0ea).box(0.13, 0.004, 0.13, 0.2, top + 0.088, 0, 0xdedad0) // wheelhouse
    .cyl(0.003, 0.004, 0.025, 0.18, top + 0.092, 0, STEEL, 5).box(0.03, 0.004, 0.003, 0.18, top + 0.114, 0, DARK) // radar
    .box(0.18, 0.012, 0.18, -0.38, top + 0.008, 0, 0x6b6f76); // seats aft
  p.accent.box(0.5, 0.012, 0.192, -0.1, top + 0.034, 0, WHITE).box(0.14, 0.012, 0.19, 0.27, top + 0.008, 0, WHITE); // the line's stripe
  sideWindows(p, 6, -0.1, 0.46, 0.095, top + 0.016, 0.016, 0.06);
  win(p, 0.004, 0.02, 0.19, 0.152, top + 0.022, 0); win(p, 0.004, 0.02, 0.11, 0.262, top + 0.064, 0);
  return done(p, { free: top,
    eye: [0.21, top + 0.08, 0],
    port: [0.36, top + 0.01, -0.1], stbd: [0.36, top + 0.01, 0.1], mast: [0.18, 0.1, 0], stern: [-0.45, top + 0.02, 0], bow: L / 2, deck: [],
  });
}

function ropax(): BoatModel {
  const p = parts(), L = 1.6, B = 0.35, top = 0.09;
  const st = stations({ len: L, beam: B, top, bot: -0.06, bowAt: 0.7, bowPow: 2.2, sternK: 0.85, bottomK: 0.7, sheer: 0.02 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.works.part(deckFace(st, 0.001), DECK);
  p.works.box(1.25, 0.05, 0.31, -0.08, top, 0, 0xf4f2ec).box(1.0, 0.045, 0.27, -0.14, top + 0.05, 0, 0xf4f2ec) // two decks
    .box(0.2, 0.036, 0.33, 0.2, top + 0.095, 0, 0xf4f2ec) // the bridge, with its wings
    .box(0.1, 0.007, 0.19, 0.1, top + 0.131, 0, 0xdedad0)
    .cyl(0.004, 0.006, 0.09, 0.2, top + 0.131, 0, 0xd4d6d8, 6) // mast
    .box(0.9, 0.02, 0.004, 0.0, top - 0.035, 0.1745, DARK).box(0.9, 0.02, 0.004, 0.0, top - 0.035, -0.1745, DARK) // the vehicle-deck openings
    .box(0.09, 0.006, 0.34, 0.2, top + 0.099, 0, 0xe2dfd4);
  for (const sd of [-1, 1]) { // lifeboats
    p.works.box(0.1, 0.014, 0.022, -0.1, top + 0.1, sd * 0.13, ORANGE).box(0.1, 0.014, 0.022, 0.0, top + 0.1, sd * 0.13, ORANGE);
  }
  p.accent.part(new CylinderGeometry(0.036, 0.04, 0.085, 12).scale(1.7, 1, 1).translate(-0.3, top + 0.095 + 0.0425 + 0.044, 0), WHITE); // funnel
  p.works.part(new CylinderGeometry(0.037, 0.037, 0.012, 12).scale(1.7, 1, 1).translate(-0.3, top + 0.095 + 0.1, 0), DARK);
  sideWindows(p, 18, -0.08, 1.2, 0.155, top + 0.025, 0.014, 0.045);
  sideWindows(p, 14, -0.14, 0.95, 0.135, top + 0.074, 0.014, 0.045);
  win(p, 0.004, 0.02, 0.3, 0.3, top + 0.108, 0);
  return done(p, { free: top,
    eye: [0.24, top + 0.125, 0],
    port: [0.22, top + 0.12, -0.17], stbd: [0.22, top + 0.12, 0.17], mast: [0.2, 0.3, 0], stern: [-0.78, top + 0.03, 0], bow: L / 2,
    deck: [[-0.55, top + 0.1, -0.1], [0.5, top + 0.06, 0.1]],
  });
}

/** loads for the barge, the coaster and the container ship are variants of one geometry each */
function heap(k: Kit, x0: number, x1: number, hw: number, y: number, h: number, colors: number[], seed: number) {
  const n = Math.max(2, Math.round((x1 - x0) / 0.1));
  for (let i = 0; i < n; i++) {
    const f = Math.sin(((i + 0.5) / n) * Math.PI), x = x0 + ((i + 0.5) * (x1 - x0)) / n;
    const hh = h * (0.45 + 0.55 * f) * (0.85 + 0.3 * hash2(seed, 90 + i));
    k.taper((x1 - x0) / n + 0.01, hw * 2 * (0.7 + 0.3 * f), (x1 - x0) / n * 0.4, hw * 0.9, hh, x, y, 0, colors[i % colors.length]);
  }
}
const BOX_COLORS = [0xc0392b, 0x2e6fb0, 0x2f7d4f, 0xe08a1e, 0x8a8f96, 0xeeeeee, 0xd9b52b, 0x7a4a2a, 0x1f8a8a, 0x7a2f6a, 0xb8c0c8];
/** stacks of containers over a rectangle of deck; `fill` is how many bays are laden */
function containers(k: Kit, hs: Stn[], x0: number, x1: number, y: number, bay: number, w: number, h: number, maxTier: number, fill: number, seed: number, lines: number[]) {
  const cols = Math.floor((hwAt(hs, 0) * 2) / w);
  const n = Math.floor((x1 - x0) / bay);
  for (let b = 0; b < n; b++) {
    const x = x0 + (b + 0.5) * bay, room = hwAt(hs, x + bay / 2) * 2 - 0.02;
    const c = Math.min(cols, Math.floor(room / w));
    for (let j = 0; j < c; j++) {
      const z = (j - (c - 1) / 2) * w;
      const tiers = hash2(seed, 300 + b * 31 + j) > fill ? 0 : 1 + Math.floor(hash2(seed, 700 + b * 17 + j * 3) * maxTier);
      const col = hash2(seed, 1100 + b) < 0.45 ? lines[Math.floor(hash2(seed, 1300 + b) * lines.length)] : BOX_COLORS[Math.floor(hash2(seed, 1500 + b * 13 + j * 5) * BOX_COLORS.length)];
      for (let t = 0; t < tiers; t++) k.box(bay * 0.93, h * 0.96, w * 0.92, x, y + t * h, z, hash2(seed, 1700 + b * 7 + j * 11 + t) < 0.18 ? BOX_COLORS[Math.floor(hash2(seed, 1900 + b + t * 19 + j) * BOX_COLORS.length)] : col);
    }
  }
}

function barge(): BoatModel {
  const p = parts(), L = 0.9, B = 0.2, top = 0.045;
  const st = stations({ len: L, beam: B, top, bot: -0.03, bowAt: 0.85, bowPow: 2.2, sternK: 0.85, bottomK: 0.85, sheer: 0.008 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.works.part(deckFace(st, 0.001), DECK);
  p.works.box(0.62, 0.014, 0.15, 0.06, top, 0, 0x3a3d44) // the hold's coaming
    .box(0.11, 0.05, 0.13, -0.36, top, 0, CREAM).box(0.12, 0.004, 0.14, -0.36, top + 0.05, 0, 0xcdc7b4).cyl(0.004, 0.005, 0.03, -0.38, top + 0.054, 0.04, DARK, 5);
  win(p, 0.004, 0.02, 0.11, -0.3, top + 0.025, 0);
  const cargo: Kit[] = [new Kit(), new Kit(), new Kit(), new Kit()];
  heap(cargo[0], -0.22, 0.38, 0.065, top + 0.014, 0.05, [0x8a8379, 0x7d766b, 0x948d80], 11); // aggregate
  heap(cargo[1], -0.22, 0.38, 0.065, top + 0.014, 0.045, [0xc9b27a, 0xbfa76d], 12); // sand
  containers(cargo[2], st, -0.24, 0.4, top + 0.014, 0.1, 0.045, 0.034, 2, 0.8, 13, [0x2e6fb0, 0xc0392b]);
  return done(p, { free: top,
    cargo: [cargo[0].build(), cargo[1].build(), cargo[2].build(), null], eye: [-0.33, top + 0.04, 0],
    port: [0.3, top + 0.01, -0.09], stbd: [0.3, top + 0.01, 0.09], mast: [-0.38, 0.08, 0], stern: [-0.43, top + 0.02, 0], bow: L / 2,
    deck: [[-0.3, top + 0.08, 0.05]],
  });
}

function sailingBarge(): BoatModel {
  const p = parts(), L = 0.5, B = 0.13, top = 0.04;
  const st = stations({ len: L, beam: B, top, bot: -0.03, bowAt: 0.8, bowPow: 2.0, sternK: 0.8, bottomK: 0.8, sheer: 0.01 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.works.part(deckFace(st, 0.001), 0x6b4a2a);
  p.works.box(0.12, 0.012, 0.08, 0.0, top, 0, 0x4a3320) // hatches
    .box(0.1, 0.04, 0.1, -0.17, top, 0, 0x6b4a2a).box(0.11, 0.004, 0.11, -0.17, top + 0.04, 0, 0x4a3320) // the doghouse
    .cyl(0.005, 0.007, 0.34, 0.03, top, 0, RIG, 6).cyl(0.003, 0.004, 0.16, 0.03, top + 0.33, 0, RIG, 5) // mast and topmast
    .part(rod([0.03, top + 0.03, 0.004], [-0.1, top + 0.36, 0.004], 0.003), RIG) // the sprit
    .part(rod([0.22, top + 0.01, 0], [0.03, top + 0.4, 0], 0.0012), STEEL)
    .part(new BoxGeometry(0.1, 0.045, 0.004).rotateZ(0.0).translate(-0.01, top + 0.025, 0.07 + 0.0), 0x3a2a18); // leeboard
  p.works.part(new BoxGeometry(0.1, 0.045, 0.004).translate(-0.01, top + 0.012, -0.07), 0x3a2a18);
  win(p, 0.003, 0.014, 0.07, -0.119, top + 0.014, 0);
  const main = sailGeo([[[0, 0.04, 0], [-0.2, 0.04, 0], [-0.13, 0.33, 0]], [[0, 0.04, 0], [-0.13, 0.33, 0], [0, 0.3, 0]], [[0, 0.3, 0], [-0.08, 0.35, 0], [0, 0.52, 0]]], 0.012);
  const fore = sailGeo([[[0, 0, 0], [-0.19, 0.38, 0], [-0.13, 0.012, 0]]], 0.008);
  const mizzen = sailGeo([[[0, 0.02, 0], [-0.08, 0.02, 0], [-0.02, 0.2, 0]]], 0.006);
  return done(p, { free: top,
    sails: [{ geo: main, pivot: [0.03, top, 0], k: 1 }, { geo: fore, pivot: [0.22, top + 0.01, 0], k: 0.7 }, { geo: mizzen, pivot: [-0.2, top, 0], k: 1.1 }],
    eye: [-0.17, top + 0.025, 0],
    port: [0.17, top + 0.015, -0.055], stbd: [0.17, top + 0.015, 0.055], mast: [0.03, 0.55, 0], stern: [-0.24, top + 0.02, 0], bow: L / 2, deck: [],
  }, false);
}

function coaster(): BoatModel {
  const p = parts(), L = 2.0, B = 0.35, top = 0.08;
  const st = stations({ len: L, beam: B, top, bot: -0.07, bowAt: 0.6, bowPow: 1.7, sternK: 0.75, bottomK: 0.75, sheer: 0.03 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.works.part(hullBand(st, 0.4, 0.5).scale(1.004, 1, 1.004), 0x7a2a22); // the waterline stripe
  p.works.part(deckFace(st, 0.001), 0x4d5258);
  p.works.box(0.36, 0.09, 0.3, -0.78, top, 0, CREAM).box(0.24, 0.04, 0.31, -0.78, top + 0.09, 0, CREAM).box(0.25, 0.004, 0.32, -0.78, top + 0.13, 0, 0xcdc7b4) // accommodation and bridge
    .cyl(0.004, 0.006, 0.1, -0.76, top + 0.134, 0, 0xd4d6d8, 6)
    .box(0.62, 0.016, 0.24, -0.1, top, 0, 0x3a3d44).box(0.5, 0.012, 0.22, -0.1, top + 0.016, 0, 0x5b6e84) // hatch coaming and cover
    .box(0.4, 0.016, 0.24, 0.55, top, 0, 0x3a3d44).box(0.3, 0.012, 0.22, 0.55, top + 0.016, 0, 0x5b6e84)
    .cyl(0.008, 0.01, 0.1, 0.18, top, 0, STEEL, 6); // a samson post
  p.accent.part(new CylinderGeometry(0.03, 0.034, 0.07, 10).translate(-0.9, top + 0.09 + 0.035, 0), WHITE); // funnel
  p.works.part(new CylinderGeometry(0.031, 0.031, 0.01, 10).translate(-0.9, top + 0.162, 0), DARK);
  win(p, 0.004, 0.018, 0.28, -0.655, top + 0.108, 0);
  sideWindows(p, 5, -0.78, 0.28, 0.15, top + 0.05, 0.016, 0.03);
  const o = new Kit(); // two deck cranes
  for (const x of [0.2, 0.34]) o.cyl(0.008, 0.01, 0.12, x, top, -0.12, STEEL, 6).part(rod([x, top + 0.12, -0.12], [x + 0.1, top + 0.14, 0.0], 0.004), STEEL).box(0.02, 0.02, 0.02, x, top + 0.02, -0.12, ORANGE);
  const cargo: Kit[] = [new Kit(), new Kit()];
  containers(cargo[0], st, -0.38, 0.32, top + 0.028, 0.1, 0.07, 0.04, 2, 0.8, 21, [0x2e6fb0, 0xc0392b, 0x2f7d4f]);
  for (let i = 0; i < 4; i++) cargo[1].part(rod([0.35 + i * 0.012, top + 0.03 + i * 0.012, -0.08], [0.35 + i * 0.012, top + 0.03 + i * 0.012, 0.08], 0.01), 0xb0864f);
  return done(p, { free: top,
    opt: o.build(), cargo: [null, cargo[0].build(), null], eye: [-0.7, top + 0.115, 0],
    port: [0.75, top + 0.03, -0.14], stbd: [0.75, top + 0.03, 0.14], mast: [-0.76, 0.24, 0], stern: [-0.96, top + 0.05, 0], bow: L / 2,
    deck: [[-0.62, top + 0.12, 0], [0.5, top + 0.1, 0]],
  });
}

function containerShip(): BoatModel {
  const p = parts(), L = 4.4, B = 0.62, top = 0.15;
  const st = stations({ len: L, beam: B, top, bot: -0.12, bowAt: 0.72, bowPow: 2.0, sternK: 0.6, bottomK: 0.8, sheer: 0.04 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.works.part(hullBand(st, 0.44, 0.53).scale(1.003, 1, 1.003), 0x8a1f1f); // boot-top
  p.works.part(deckFace(st, 0.001), 0x5d5a50);
  // the deckhouse aft: a stack of tiers, the bridge on top
  const hx = -1.72;
  p.works.box(0.5, 0.06, 0.5, hx, top, 0, 0xf4f2ec).box(0.46, 0.06, 0.5, hx, top + 0.06, 0, 0xf4f2ec).box(0.42, 0.06, 0.5, hx, top + 0.12, 0, 0xf4f2ec)
    .box(0.26, 0.05, 0.62, hx + 0.04, top + 0.18, 0, 0xf4f2ec).box(0.28, 0.005, 0.64, hx + 0.04, top + 0.23, 0, 0xdedad0)
    .cyl(0.006, 0.01, 0.13, hx + 0.04, top + 0.235, 0, 0xd4d6d8, 6).box(0.004, 0.004, 0.1, hx + 0.04, top + 0.34, 0, STEEL);
  p.accent.part(new BoxGeometry(0.2, 0.12, 0.2).translate(hx - 0.31, top + 0.06 + 0.06, 0).rotateY(0), WHITE);
  p.works.box(0.2, 0.01, 0.2, hx - 0.31, top + 0.12 + 0.12, 0, DARK);
  p.works.box(0.03, 0.035, 0.05, 1.9, top + 0.04, 0, 0xd8d3c4).cyl(0.01, 0.012, 0.18, 1.85, top + 0.04, 0, 0xd4d6d8, 6); // the forward mast
  for (const sd of [-1, 1]) p.works.box(4.0, 0.012, 0.01, -0.05, top, sd * (hwAt(st, 0) - 0.005), 0x6a665a); // the rail's coaming
  for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) win(p, 0.4 - i * 0.04, 0.016, 0.004, hx, top + 0.022 + i * 0.06, sd * 0.2515);
  win(p, 0.004, 0.02, 0.6, hx + 0.171, top + 0.2, 0);
  // geared ships have two cranes straddling the hatches
  const o = new Kit();
  for (const x of [-0.6, 0.55]) {
    for (const sd of [-1, 1]) o.cyl(0.01, 0.014, 0.24, x, top, sd * 0.3, STEEL, 6);
    o.box(0.04, 0.018, 0.62, x, top + 0.24, 0, ORANGE).part(rod([x, top + 0.25, 0], [x + 0.42, top + 0.2, 0.0], 0.006), ORANGE);
  }
  const lines = [0x2e6fb0, 0xc0392b, 0x2f7d4f, 0x8a8f96];
  const cargo: Kit[] = [new Kit(), new Kit(), new Kit(), new Kit()];
  const fills = [0.95, 0.75, 0.55, 0.85];
  cargo.forEach((c, i) => containers(c, st, -1.38, 1.72, top + 0.012, 0.1, 0.075, 0.045, 3 + (i & 1), fills[i], 31 + i, [lines[i], lines[(i + 1) % 4]]));
  return done(p, { free: top,
    opt: o.build(), cargo: cargo.map((c) => c.build()), eye: [hx + 0.05, top + 0.205, 0],
    port: [1.75, top + 0.05, -0.2], stbd: [1.75, top + 0.05, 0.2], mast: [hx + 0.04, 0.48, 0], stern: [-2.17, top + 0.08, 0], bow: L / 2,
    deck: [[1.0, top + 0.08, 0.25], [-1.0, top + 0.08, -0.25]],
  });
}

function tug(): BoatModel {
  const p = parts(), L = 0.4, B = 0.15, top = 0.045;
  const st = stations({ len: L, beam: B, top, bot: -0.04, bowAt: 0.55, bowPow: 1.6, sternK: 0.8, bottomK: 0.7, sheer: 0.018 });
  p.hull.part(hullBand(st, 0, 1), WHITE);
  p.works.part(deckFace(st, 0.001), 0x4a4f55);
  p.accent.box(0.17, 0.04, 0.115, 0.01, top, 0, WHITE).part(new CylinderGeometry(0.014, 0.017, 0.05, 8).translate(-0.06, top + 0.04 + 0.025, 0), WHITE);
  p.works.box(0.11, 0.032, 0.095, 0.03, top + 0.04, 0, 0xf2f0ea).box(0.12, 0.004, 0.105, 0.03, top + 0.072, 0, 0xdedad0)
    .cyl(0.003, 0.004, 0.04, 0.04, top + 0.076, 0, STEEL, 5).cyl(0.01, 0.012, 0.012, -0.12, top, 0, STEEL, 6);
  for (let i = 0; i < 4; i++) p.works.part(new CylinderGeometry(0.009, 0.009, 0.012, 8).rotateX(Math.PI / 2).translate(0.2 - Math.abs(i - 1.5) * 0.012, top - 0.01, (i - 1.5) * 0.026), DARK); // bow fenders
  win(p, 0.004, 0.018, 0.09, 0.086, top + 0.05, 0);
  return done(p, { free: top,
    eye: [0.06, top + 0.06, 0],
    port: [0.1, top + 0.045, -0.05], stbd: [0.1, top + 0.045, 0.05], mast: [0.04, 0.12, 0], stern: [-0.18, top + 0.014, 0], bow: L / 2,
    deck: [[-0.13, top + 0.03, 0]],
  });
}

function policeLaunch(): BoatModel {
  const p = parts(), L = 0.45, B = 0.13, top = 0.04;
  const st = stations({ len: L, beam: B, top, bot: -0.025, bowAt: 0.5, bowPow: 1.6, sternK: 0.85, bottomK: 0.6, sheer: 0.012 });
  p.hull.part(hullBand(st, 0, 0.55), WHITE).part(hullBand(st, 0.8, 1), WHITE);
  p.accent.part(hullBand(st, 0.55, 0.8), WHITE);
  p.works.part(deckFace(st, 0.001), 0xd8d4c8);
  p.works.box(0.16, 0.036, 0.09, 0.0, top, 0, PAINT_W).box(0.17, 0.004, 0.1, 0.0, top + 0.036, 0, 0x1b3f8c).box(0.02, 0.006, 0.07, 0.0, top + 0.04, 0, 0x2a5fd8) // light bar
    .cyl(0.003, 0.003, 0.03, -0.04, top + 0.04, 0, STEEL, 5);
  win(p, 0.004, 0.022, 0.08, 0.082, top + 0.008, 0); sideWindows(p, 3, -0.005, 0.11, 0.045, top + 0.01, 0.016, 0.028);
  return done(p, { free: top,
    eye: [0.03, top + 0.02, 0],
    port: [0.12, top + 0.004, -0.045], stbd: [0.12, top + 0.004, 0.045], mast: [-0.04, 0.09, 0], stern: [-0.2, top + 0.008, 0], bow: L / 2, blue: [0.0, top + 0.046, 0],
  });
}

function fireBoat(): BoatModel {
  const p = parts(), L = 0.6, B = 0.18, top = 0.045;
  const st = stations({ len: L, beam: B, top, bot: -0.03, bowAt: 0.55, bowPow: 1.7, sternK: 0.8, bottomK: 0.65, sheer: 0.016 });
  p.hull.part(hullBand(st, 0, 0.8), WHITE);
  p.accent.part(hullBand(st, 0.8, 1), WHITE);
  p.works.part(deckFace(st, 0.001), 0x8a2a24);
  p.works.box(0.22, 0.04, 0.12, -0.03, top, 0, PAINT_W).box(0.23, 0.004, 0.13, -0.03, top + 0.04, 0, 0xb02a24)
    .cyl(0.005, 0.006, 0.05, 0.02, top + 0.044, 0, STEEL, 6).part(rod([0.02, top + 0.09, 0], [0.09, top + 0.1, 0], 0.005), STEEL) // a monitor
    .cyl(0.005, 0.006, 0.04, 0.2, top, 0, STEEL, 6).part(rod([0.2, top + 0.04, 0], [0.25, top + 0.05, 0], 0.005), STEEL);
  win(p, 0.004, 0.022, 0.1, 0.08, top + 0.012, 0); sideWindows(p, 4, -0.03, 0.18, 0.06, top + 0.013, 0.018, 0.03);
  return done(p, { free: top,
    eye: [0.04, top + 0.025, 0],
    port: [0.16, top + 0.01, -0.06], stbd: [0.16, top + 0.01, 0.06], mast: [-0.1, 0.14, 0], stern: [-0.27, top + 0.01, 0], bow: L / 2, blue: [-0.03, top + 0.046, 0],
  });
}

const BUILD: Record<BoatType, () => BoatModel> = {
  dinghy, motorCruiser, sailboat, narrowboat, trawler, riverBus, ropax, barge, sailingBarge, coaster, containerShip, tug, policeLaunch, fireBoat,
};
const cache = new Map<BoatType, BoatModel>();
export function boatModel(type: BoatType): BoatModel {
  let m = cache.get(type);
  if (!m) { m = BUILD[type](); cache.set(type, m); }
  return m;
}
