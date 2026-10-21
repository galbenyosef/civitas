import { Color, Vector2, ShapeUtils } from 'three';
import { hash2, MouthCrossing, MouthControl } from '@msimcity/shared';
import { Cell, cellUV, RING_APRON, RING_OUTER } from './atlas';

/**
 * Road tiles as geometry (render/roads.ts assembles them per chunk): the carriageway, raised pavements behind a kerb
 * with a granite top and a gutter, corners rounded at junctions and bends, dropped kerbs with tactile paving at every
 * junction mouth, verges where a pavement meets a garden or open grass, and the paint: centre lines by context,
 * give-way and stop lines, triangles, turn arrows, zebra and signal crossings, box junctions, the roundabout ring's
 * marks and the level crossing's panels. Manhole covers, gullies, patched tarmac and wheel-track wear vary per tile.
 *
 * Shapes are built a quarter of a tile at a time. Each quarter knows the road on its two sides and the diagonal
 * between them, which picks one of five templates in the quarter's own frame (a along its east-west side, b along its
 * north-south side, both 0 at the tile centre and 0.5 at its edges): all carriageway; a carriageway with a rounded
 * pavement corner where two roads meet (radius = the pavement's width, centred on the lot corner, so a walker on the
 * sidewalk line stays on it); a pavement along one side; or an outer corner rounded about the tile centre (bends and
 * dead ends). Every template meets its neighbours' along the tile edges, so kerbs run on unbroken. Heights come from a
 * function of (a, b): the kerb, dropped near a crossing, ramping up again over a few hundredths of a tile.
 *
 * Everything is in one vertex format, the ground's (position, normal, colour, atlas UV), so the road takes the
 * ground material: street-lamp pools, the congestion and data overlays and the underground fade all come with it.
 */

export type P = [number, number];

/**
 * A road's cross-section. Class 0, the street, is the only one today; R3 adds country lanes, one-ways, avenues
 * (lanes 2, a planted median), motorways and pedestrian streets as more of these, keyed by their aux class.
 */
export interface RoadProfile {
  /** half the carriageway, kerb to kerb (the lanes are LANE_OFFSET either side of the centre line) */
  carriage: number;
  /** kerb height in tiles */
  kerb: number;
  /** lanes each way (lane lines between them) */
  lanes: number;
  /** half the central reservation (0: a painted centre line) */
  median: number;
  /** one way: no centre line */
  oneWay: boolean;
}
export const STREET: RoadProfile = { carriage: 0.375, kerb: 0.014, lanes: 1, median: 0, oneWay: false };

/** Side index s (0..3) is N, E, S, W; its mask bit is 1 << s and its step SIDE[s]. */
export const SIDE: readonly P[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Everything a road tile's look depends on (roads.ts works it out from the tiles round it). */
export interface RoadTile {
  x: number; z: number;
  prof: RoadProfile;
  /** road on the 8 neighbours for the shape: N E S W (bits 0-3), NE SE SW NW (bits 4-7) */
  m8: number;
  /** arms as the signals count them (no twin lanes) */
  arms: number;
  junction: boolean;
  /** this junction's mouths, per side: crossing (MouthCrossing, 0 none) and control (MouthControl) */
  cross: number[]; ctrl: number[];
  box: boolean;
  /** the junction next door, per side: its crossing and control on the mouth facing us, and its arms (0: none) */
  nCross: number[]; nCtrl: number[]; nArms: number[];
  /** sides (mask bits) with a verge: a home's lot or open grass beyond the pavement */
  leafy: number;
  /** a level crossing: the track's mask (0: none) */
  rail: number;
  /** the road under a flyover's deck */
  under: boolean;
  /** a zebra across the middle of this straight (roadlook midZebraAt) */
  zebra: boolean;
  /** 0..3, from the traffic the tile has seen */
  wear: number;
}

// ---- colours (linear, via Color.setHex) -----------------------------------------------------------------------
const col = (hex: number) => new Color(hex);
const WHITE = col(0xf2f2ee), YELLOW = col(0xe8c53a), BLACK = col(0x1d1f22);
const KERB = col(0xa2a39f), GUTTER = col(0x5d6066), IRON = col(0x2c2e31), IRON_RIM = col(0x55585c);
const TACTILE_BUFF = col(0xd6c08a), TACTILE_RED = col(0xb55a48);
const PANEL = col(0x8d8a83), RAIL_DARK = col(0x2b2a28), RAIL_HEAD = col(0xd9dcdf);
const tmp = new Color();

/** Heights above the carriageway of the paint and patches laid on it (the same mesh, drawn after it). */
const Y_GUTTER = 0.0006, Y_PATCH = 0.0009, Y_PAINT = 0.0014, Y_KERBTOP = 0.0008;
/** dropped kerb: the lip left (a fraction of the kerb), where the drop starts and where it is flat (from the tile centre) */
const LOW = 0.22;
const RAMP_LEN = 0.11;
/** the band of a junction mouth's crossing, from the junction tile's centre (walkers cross on the sidewalk line, 0.42) */
const BAND0 = 0.33, BAND1 = 0.49;
const KERB_W = 0.016, GUTTER_W = 0.022, VERGE_W = 0.036;

// ---- the vertex buffer --------------------------------------------------------------------------------------------

/** One tile's triangles in the ground's vertex format (indexed), world coordinates. */
export class Geo {
  p: number[] = []; n: number[] = []; c: number[] = []; uv: number[] = []; idx: number[] = [];
  /** the tile's origin, for atlas UVs */
  tx = 0; tz = 0;
  private uvc = cellUV(Cell.Paint);
  setCell(cell: number) { this.uvc = cellUV(cell); return this; }
  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: Color) {
    const i = this.p.length / 3;
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(c.r, c.g, c.b);
    const [u0, v0, u1, v1] = this.uvc;
    const lu = Math.min(1, Math.max(0, x - this.tx)), lv = Math.min(1, Math.max(0, z - this.tz));
    this.uv.push(u0 + lu * (u1 - u0), v1 - lv * (v1 - v0));
    return i;
  }
  /** a horizontal-ish triangle facing up; ys per corner */
  tri(a: P, b: P, c: P, ya: number, yb: number, yc: number, color: Color) {
    if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) { [b, c] = [c, b]; [yb, yc] = [yc, yb]; }
    const i = this.vert(a[0], ya, a[1], 0, 1, 0, color), j = this.vert(b[0], yb, b[1], 0, 1, 0, color), k = this.vert(c[0], yc, c[1], 0, 1, 0, color);
    this.idx.push(i, j, k);
  }
  /** a convex polygon at heights y(p), fanned */
  fan(pts: P[], y: (p: P) => number, color: Color) {
    for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0], pts[i], pts[i + 1], y(pts[0]), y(pts[i]), y(pts[i + 1]), color);
  }
  /** an upright quad from p0 to p1, bottom ya/yb, top ta/tb, facing (nx, nz) */
  wall(p0: P, p1: P, ya: number, ta: number, yb: number, tb: number, nx: number, nz: number, color: Color) {
    if (ta - ya < 1e-5 && tb - yb < 1e-5) return;
    // wound so the face is seen from (nx, nz): counter-clockwise from that side
    const ex = p1[0] - p0[0], ez = p1[1] - p0[1];
    const flip = ez * nx - ex * nz > 0; // (edge × up) points the other way
    const [a, b, ay, by, at, bt] = flip ? [p1, p0, yb, ya, tb, ta] : [p0, p1, ya, yb, ta, tb];
    const i = this.vert(a[0], ay, a[1], nx, 0, nz, color), j = this.vert(b[0], by, b[1], nx, 0, nz, color);
    const k = this.vert(b[0], bt, b[1], nx, 0, nz, color), l = this.vert(a[0], at, a[1], nx, 0, nz, color);
    this.idx.push(i, j, k, i, k, l);
  }
}

// ---- 2D helpers ---------------------------------------------------------------------------------------------------

const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n: number): P[] => {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return out;
};
/** triangles of a simple polygon (ear clipping) */
function triangulate(poly: P[]): P[][] {
  if (poly.length === 3) return [poly];
  const faces = ShapeUtils.triangulateShape(poly.map(([x, z]) => new Vector2(x, z)), []);
  return faces.map(([i, j, k]) => [poly[i], poly[j], poly[k]]);
}
/** keep the part of a convex polygon with p·(nx, nz) <= d */
function clip(poly: P[], nx: number, nz: number, d: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * nz - d, db = b[0] * nx + b[1] * nz - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
/** split convex pieces along the line p[axis] = d */
function split(pieces: P[][], axis: 0 | 1, d: number): P[][] {
  const out: P[][] = [];
  const nx = axis === 0 ? 1 : 0, nz = 1 - nx;
  for (const p of pieces) {
    const lo = clip(p, nx, nz, d), hi = clip(p, -nx, -nz, -d);
    if (lo.length >= 3) out.push(lo);
    if (hi.length >= 3) out.push(hi);
  }
  return out;
}
const centroid = (p: P[]): P => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
/** a polyline with points added where it crosses p[axis] = d */
function cut(line: P[], axis: 0 | 1, d: number): P[] {
  const out: P[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    if ((a[axis] - d) * (b[axis] - d) < 0) { const t = (d - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    out.push(b);
  }
  return out;
}

// ---- the quarter templates ---------------------------------------------------------------------------------------

/**
 * A drop along one axis of a quarter: 0 none, 1 this junction's crossing band (flat out to the edge), 2 the ramp up
 * from the junction next door, 3 a crossing across the middle of the tile (a mid-block zebra: flat about the centre).
 */
type Drop = 0 | 1 | 2 | 3;
/** half the flat of a mid-block crossing's drop */
const MID = 0.075;
const dropBreaks = (d: Drop, c: number): number[] => (d === 1 ? [c - 0.03 - RAMP_LEN, c - 0.03] : d === 2 ? [0.5 - RAMP_LEN] : d === 3 ? [MID, MID + RAMP_LEN] : []);
function dropF(d: Drop, t: number, c: number): number {
  if (d === 1) { const r1 = c - 0.03, r0 = r1 - RAMP_LEN; return t <= r0 ? 1 : t >= r1 ? LOW : 1 - ((t - r0) / RAMP_LEN) * (1 - LOW); }
  if (d === 2) { const r0 = 0.5 - RAMP_LEN; return t <= r0 ? 1 : LOW + ((0.5 - t) / RAMP_LEN) * (1 - LOW); }
  if (d === 3) return t <= MID ? LOW : t >= MID + RAMP_LEN ? 1 : LOW + ((t - MID) / RAMP_LEN) * (1 - LOW);
  return 1;
}
/** is t in the flat (tactile) part of a drop? */
const dropFlat = (d: Drop, t: number, c: number) => (d === 1 ? t > c - 0.03 : d === 3 ? t < MID : false);

interface Quarter {
  /** quarter signs: tile-local x = sx * a, z = sz * b */
  sx: number; sz: number;
  /** road beyond the a side (east or west), the b side (north or south) and the corner between */
  h: boolean; v: boolean; d: boolean;
  dropA: Drop; dropB: Drop;
  /** tactile colour in the flat of a drop (null: none) */
  tacA: Color | null; tacB: Color | null;
  /** verge along the a side / the b side */
  vergeA: boolean; vergeB: boolean;
}

/** Shapes of a quarter in its own frame: carriageway pieces, pavement pieces and kerb lines (carriageway towards (0, 0)). */
function quarterShape(q: Quarter, c: number): { car: P[][]; pave: P[]; kerb: P[] | null } {
  const pw = 0.5 - c;
  if (q.h && q.v && q.d) return { car: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]], pave: [], kerb: null };
  if (q.h && q.v) {
    const corner = arc(0.5, 0.5, pw, Math.PI, Math.PI * 1.5, 6);
    return {
      car: triangulate([[0, 0], [0.5, 0], ...corner.slice().reverse(), [0, 0.5]]),
      pave: [[0.5, 0.5], ...corner],
      kerb: corner,
    };
  }
  if (q.v) return { car: [[[0, 0], [c, 0], [c, 0.5], [0, 0.5]]], pave: [[c, 0], [0.5, 0], [0.5, 0.5], [c, 0.5]], kerb: [[c, 0], [c, 0.5]] };
  if (q.h) return { car: [[[0, 0], [0.5, 0], [0.5, c], [0, c]]], pave: [[0, c], [0.5, c], [0.5, 0.5], [0, 0.5]], kerb: [[0, c], [0.5, c]] };
  const round = arc(0, 0, c, 0, Math.PI / 2, 10);
  return { car: [[[0, 0], ...round]], pave: [[c, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], ...round.slice().reverse().slice(0, -1)], kerb: round };
}

/** Pavement height at (a, b) of a quarter (kerb heights; 0 on the carriageway is the caller's business). */
const quarterH = (q: Quarter, a: number, b: number, c: number, k: number) => k * Math.min(dropF(q.dropA, a, c), dropF(q.dropB, b, c));

/** Is (a, b) on the pavement of a quarter? (for walkers' height) */
function onPavement(q: Quarter, a: number, b: number, c: number): boolean {
  const pw = 0.5 - c;
  if (q.h && q.v && q.d) return false;
  if (q.h && q.v) return (a - 0.5) ** 2 + (b - 0.5) ** 2 < pw * pw;
  if (q.v) return a > c;
  if (q.h) return b > c;
  return a * a + b * b > c * c;
}

/** the four quarters of a plain road tile: NE, SE, SW, NW */
const QUARTERS: readonly [number, number, number, number, number][] = [
  // sx, sz, a-side index, b-side index, diagonal bit
  [1, -1, 1, 0, 4], [1, 1, 1, 2, 5], [-1, 1, 3, 2, 6], [-1, -1, 3, 0, 7],
];

function quartersOf(t: RoadTile): Quarter[] {
  return QUARTERS.map(([sx, sz, sa, sb, db]) => {
    const h = !!(t.m8 & (1 << sa)), v = !!(t.m8 & (1 << sb)), d = !!(t.m8 & (1 << db));
    // a mid-block zebra drops the kerbs along the street's axis: b for a north-south street, a for an east-west one
    const mid = (s: number) => t.zebra && (s === 0 || s === 2 ? t.arms === 5 : t.arms === 10);
    const drop = (s: number): Drop => (t.junction && t.cross[s] ? 1 : t.nCross[s] ? 2 : mid(s) ? 3 : 0);
    const tac = (s: number) => (t.junction && t.cross[s] ? (t.cross[s] === MouthCrossing.Signal ? TACTILE_RED : TACTILE_BUFF) : mid(s) ? TACTILE_BUFF : null);
    return {
      sx, sz, h, v, d, dropA: drop(sa), dropB: drop(sb), tacA: tac(sa), tacB: tac(sb),
      vergeA: !h && !!(t.leafy & (1 << sa)), vergeB: !v && !!(t.leafy & (1 << sb)),
    };
  });
}

/** Height of the surface a walker stands on at world (x, z) on road tile t: the pavement's, or 0 on the carriageway. */
export function surfaceY(t: RoadTile, x: number, z: number): number {
  const lx = x - t.x - 0.5, lz = z - t.z - 0.5, c = t.prof.carriage;
  const qi = lx >= 0 ? (lz < 0 ? 0 : 1) : (lz < 0 ? 3 : 2);
  const q = quartersOf(t)[qi], a = lx * q.sx, b = lz * q.sz;
  return onPavement(q, a, b, c) ? quarterH(q, a, b, c, t.prof.kerb) : 0;
}

// ---- a plain road tile -------------------------------------------------------------------------------------------

/** Per-tile hashes. */
const hk = (t: RoadTile, n: number) => hash2(t.x * 31 + n * 7, t.z * 17 - n * 13);
/** a street's stretch: tiles of one straight run share tone and resurfacing over about six tiles */
function stretch(t: RoadTile, n: number) {
  const ns = (t.arms & 5) !== 0 && (t.arms & 10) === 0;
  const line = ns ? t.x : t.z, pos = ns ? t.z : t.x;
  return hash2(line * 13 + n * 5 + (ns ? 1 : 2), Math.floor(pos / 6) * 7 + n);
}

/** Build a plain road tile (shape, kerbs, verges, then its paint and ironwork) into g. */
export function buildTile(t: RoadTile, g: Geo) {
  g.tx = t.x; g.tz = t.z;
  const c = t.prof.carriage, K = t.prof.kerb;
  const ox = t.x + 0.5, oz = t.z + 0.5;
  // tones: the asphalt by stretch (now and then a resurfaced, darker run), the paving by street, a buff stone street or two
  const fresh = stretch(t, 1) < 0.16;
  const asphalt = new Color().setScalar((fresh ? 0.8 : 0.94 + 0.1 * stretch(t, 2)) * (1 - 0.035 * t.wear) * (0.97 + 0.06 * hk(t, 1)));
  const paveTone = 0.9 + 0.14 * stretch(t, 3);
  const pave = stretch(t, 4) < 0.15 ? new Color(1.0, 0.95, 0.85).multiplyScalar(paveTone) : new Color().setScalar(paveTone * (0.97 + 0.06 * hk(t, 2)));
  const kerb = KERB.clone().multiplyScalar(0.92 + 0.14 * hk(t, 3));
  const verge = new Color(0.85, 0.95, 0.8).multiplyScalar(0.86 + 0.16 * stretch(t, 5));
  const qs = quartersOf(t);
  for (const q of qs) {
    const W = (p: P): P => [ox + q.sx * p[0], oz + q.sz * p[1]];
    const sh = quarterShape(q, c);
    g.setCell(Cell.Asphalt);
    for (const piece of sh.car) for (const tri of piece.length === 3 ? [piece] : triangulate(piece)) {
      const w = tri.map(W);
      g.tri(w[0], w[1], w[2], 0, 0, 0, asphalt);
    }
    if (!sh.pave.length) continue;
    // pavement pieces: triangles split where drops ramp and where a verge starts, each coloured by where it lies
    let pieces = triangulate(sh.pave);
    for (const br of dropBreaks(q.dropA, c)) pieces = split(pieces, 0, br);
    for (const br of dropBreaks(q.dropB, c)) pieces = split(pieces, 1, br);
    if (q.vergeA) pieces = split(pieces, 0, 0.5 - VERGE_W);
    if (q.vergeB) pieces = split(pieces, 1, 0.5 - VERGE_W);
    const H = (p: P) => quarterH(q, p[0], p[1], c, K);
    for (const piece of pieces) {
      const [ca, cb] = centroid(piece);
      const isVerge = (q.vergeA && ca > 0.5 - VERGE_W) || (q.vergeB && cb > 0.5 - VERGE_W);
      const tac = q.tacB && dropFlat(q.dropB, cb, c) ? q.tacB : q.tacA && dropFlat(q.dropA, ca, c) ? q.tacA : null;
      g.setCell(isVerge ? Cell.Grass : tac ? Cell.Tactile : Cell.Pavement);
      const w = piece.map(W), hs = piece.map(H);
      for (let i = 1; i + 1 < w.length; i++) g.tri(w[0], w[i], w[i + 1], hs[0], hs[i], hs[i + 1], isVerge ? verge : tac ?? pave);
    }
    g.setCell(Cell.Paint);
    // the kerb: its face down to the road, a granite strip along its top, a concrete gutter at its foot
    if (sh.kerb) {
      let line = sh.kerb;
      for (const br of dropBreaks(q.dropA, c)) line = cut(line, 0, br);
      for (const br of dropBreaks(q.dropB, c)) line = cut(line, 1, br);
      kerbLine(g, line, W, H, kerb);
    }
    // outer faces where the pavement meets land that is not road
    if (!q.h) edgeFace(g, 0, W, H, c, q, kerb);
    if (!q.v) edgeFace(g, 1, W, H, c, q, kerb);
  }
  paint(t, g);
}

/** The kerb along `line` (quarter frame): its face down to the road, a granite strip along its top, a concrete gutter at its foot. */
function kerbLine(g: Geo, line: P[], W: (p: P) => P, H: (p: P) => number, kerb: Color) {
  // normals towards the carriageway (the quarter's origin side) per segment, then averaged per point
  const segN: P[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    let nx = -ez / L, nz = ex / L;
    if (nx * -(a[0] + b[0]) + nz * -(a[1] + b[1]) < 0) { nx = -nx; nz = -nz; }
    segN.push([nx, nz]);
  }
  const ptN = line.map((_, i): P => {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
    const x = a[0] + b[0], z = a[1] + b[1], L = Math.hypot(x, z) || 1;
    return [x / L, z / L];
  });
  const off = (i: number, d: number): P => [line[i][0] + ptN[i][0] * d, line[i][1] + ptN[i][1] * d];
  const face = kerb.clone().multiplyScalar(0.8);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], ha = H(a), hb = H(b);
    const wa = W(a), wb = W(b), wn = W([a[0] + segN[i][0], a[1] + segN[i][1]]);
    g.wall(wa, wb, 0, ha, 0, hb, wn[0] - wa[0], wn[1] - wa[1], face);
    const ia = off(i, -KERB_W), ib = off(i + 1, -KERB_W);
    const wia = W(ia), wib = W(ib);
    g.tri(wa, wb, wib, ha + Y_KERBTOP, hb + Y_KERBTOP, H(ib) + Y_KERBTOP, kerb);
    g.tri(wa, wib, wia, ha + Y_KERBTOP, H(ib) + Y_KERBTOP, H(ia) + Y_KERBTOP, kerb);
    g.fan([wa, wb, W(off(i + 1, GUTTER_W)), W(off(i, GUTTER_W))], () => Y_GUTTER, GUTTER);
  }
}

/** The face where a quarter's pavement meets land that is not road, along its a side (axis 0) or b side (axis 1). */
function edgeFace(g: Geo, axis: 0 | 1, W: (p: P) => P, H: (p: P) => number, c: number, q: Quarter, color: Color) {
  let line: P[] = axis === 0 ? [[0.5, 0], [0.5, 0.5]] : [[0, 0.5], [0.5, 0.5]];
  for (const br of dropBreaks(q.dropA, c)) line = cut(line, 0, br);
  for (const br of dropBreaks(q.dropB, c)) line = cut(line, 1, br);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], wa = W(a), wo = W([a[0] + (axis === 0 ? 1 : 0), a[1] + (axis === 1 ? 1 : 0)]);
    g.wall(wa, W(b), 0, H(a), 0, H(b), wo[0] - wa[0], wo[1] - wa[1], color);
  }
}

// ---- paint and ironwork -------------------------------------------------------------------------------------------

/** a rectangle centred at tile-local (cx, cz), `len` along (dx, dz), `wid` across, as a world polygon */
function rect(ox: number, oz: number, cx: number, cz: number, dx: number, dz: number, len: number, wid: number): P[] {
  const ax = (dx * len) / 2, az = (dz * len) / 2, bx = (-dz * wid) / 2, bz = (dx * wid) / 2;
  return [[ox + cx - ax - bx, oz + cz - az - bz], [ox + cx + ax - bx, oz + cz + az - bz], [ox + cx + ax + bx, oz + cz + az + bz], [ox + cx - ax + bx, oz + cz - az + bz]];
}

function paint(t: RoadTile, g: Geo) {
  const ox = t.x + 0.5, oz = t.z + 0.5, c = t.prof.carriage;
  const at = (y: number) => () => y;
  g.setCell(Cell.Paint);
  const decal = (poly: P[], color: Color, y = Y_PAINT) => g.fan(poly, at(y), color);
  const wear = 1 - 0.07 * t.wear; // paint fades where the traffic is heavy
  const white = WHITE.clone().multiplyScalar(wear * (0.94 + 0.06 * hk(t, 9)));
  const ns = t.arms === 5, ew = t.arms === 10;

  // ---- surface: patches, wheel-track wear, ironwork
  const tarmac = (k: number) => tmp.setScalar(k).clone();
  const straight = ns || ew;
  const inner = straight ? c - 0.012 : t.junction ? c : 0;
  if (inner > 0) {
    const nPatch = Math.floor(hk(t, 20) * 2.2) + (t.wear >= 2 ? 1 : 0);
    for (let i = 0; i < nPatch; i++) {
      const r = (n: number) => hk(t, 30 + i * 7 + n);
      const trench = r(0) < 0.4;
      const along = straight ? (ns ? [0, 1] : [1, 0]) as P : (r(1) < 0.5 ? [0, 1] : [1, 0]) as P;
      // a trench is a long narrow strip across or along the lane; a patch a rough square over a pothole
      const across = trench && r(2) < 0.5;
      const dir: P = across ? [-along[1], along[0]] : along;
      const len = trench ? 0.3 + 0.5 * r(3) : 0.07 + 0.1 * r(3), wid = trench ? 0.05 + 0.04 * r(4) : 0.06 + 0.08 * r(4);
      const cx = (r(5) - 0.5) * (straight && !ns ? 0.9 : 2 * inner * 0.8), cz = (r(6) - 0.5) * (straight && ns ? 0.9 : 2 * inner * 0.8);
      let poly = rect(0, 0, cx, cz, dir[0], dir[1], len, wid);
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const lim = straight ? ((nx !== 0) === ns ? inner : 0.5) : inner;
        poly = clip(poly, nx, nz, lim);
      }
      if (poly.length < 3) continue;
      decal(poly.map(([x, z]) => [ox + x, oz + z] as P), tarmac(0.043 + 0.014 * r(7) + (r(8) < 0.5 ? -0.009 : 0.007)), Y_PATCH);
    }
    if (straight && t.wear >= 1) {
      // wheel tracks: polished, darker paths where the tyres run (LANE_OFFSET ± a car's half track)
      const k = tarmac(0.037 - 0.002 * t.wear);
      for (const lane of [-0.19, 0.19]) for (const w of [-0.065, 0.065]) {
        const off = lane + w;
        decal(ns ? rect(ox, oz, off, 0, 0, 1, 1, 0.03) : rect(ox, oz, 0, off, 1, 0, 1, 0.03), k, Y_PATCH - 0.0001);
      }
    }
    // a manhole cover, now and then, and a gully in the gutter
    if (hk(t, 40) < 0.32) {
      const mx = (hk(t, 41) - 0.5) * (straight && !ns ? 0.8 : 0.5), mz = (hk(t, 42) - 0.5) * (straight && ns ? 0.8 : 0.5);
      const round = hk(t, 43) < 0.55, s = 0.05 + 0.02 * hk(t, 44);
      const outer = round ? arc(ox + mx, oz + mz, s * 0.62, 0, Math.PI * 2, 10).slice(0, -1) : rect(ox, oz, mx, mz, 1, 0, s, s);
      const inn = round ? arc(ox + mx, oz + mz, s * 0.5, 0, Math.PI * 2, 10).slice(0, -1) : rect(ox, oz, mx, mz, 1, 0, s * 0.8, s * 0.8);
      decal(outer, IRON_RIM, Y_PAINT);
      decal(inn, IRON.clone().multiplyScalar(0.9 + 0.3 * hk(t, 45)), Y_PAINT + 0.0002);
    }
    if (straight) for (const side of [-1, 1]) {
      if (hk(t, 50 + side) > 0.55) continue;
      const along = (hk(t, 52 + side) - 0.5) * 0.7, off = side * (c - 0.022);
      decal(ns ? rect(ox, oz, off, along, 0, 1, 0.06, 0.03) : rect(ox, oz, along, off, 1, 0, 0.06, 0.03), IRON);
    }
  }

  // ---- lines
  if (t.junction) junctionPaint(t, g, decal, white);
  else if (t.rail) railPaint(t, g, decal, white);
  else if (straight) {
    // the centre line: short dashes, or the long dashes of a warning line on the approach to a junction
    const toJ = [0, 1, 2, 3].filter((s) => t.nArms[s]);
    const warn = toJ.length > 0;
    const dashes: [number, number][] = warn ? [[-0.4, -0.08], [0.04, 0.36]] : [[-0.34, -0.16], [0.16, 0.34]];
    const sgn = ns ? (toJ.includes(0) ? -1 : 1) : (toJ.includes(3) ? -1 : 1); // keep the gap at the junction's end
    if (t.zebra) zebraPaint(t, decal, white);
    else if (!t.prof.oneWay && t.prof.median === 0) for (const [a0, a1] of dashes) {
      const m = ((a0 + a1) / 2) * sgn, L = a1 - a0;
      decal(ns ? rect(ox, oz, 0, m, 0, 1, L, 0.024) : rect(ox, oz, m, 0, 1, 0, L, 0.024), white);
    }
    for (const s of toJ) approachPaint(t, s, decal, white);
  } else if (!t.under && (t.m8 & 15) === t.arms) {
    // (a corner of a wide road's crossing, where twin lanes meet, has no line of its own)
    const bits = t.arms;
    const n = (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1) + ((bits >> 3) & 1);
    if (n === 2) {
      // a bend: two dashes round the inside corner, on the centre line's radius
      const sxc = bits & 2 ? 1 : -1, szc = bits & 4 ? 1 : -1;
      const kx = ox + sxc * 0.5, kz = oz + szc * 0.5;
      const a0 = Math.atan2(-szc, 0), a1 = Math.atan2(0, -sxc);
      let from = a0, to = a1;
      while (to - from > Math.PI) to -= Math.PI * 2;
      while (from - to > Math.PI) to += Math.PI * 2;
      for (const [f0, f1] of [[0.12, 0.38], [0.62, 0.88]]) {
        const inner2 = arc(kx, kz, 0.488, from + (to - from) * f0, from + (to - from) * f1, 4), outer2 = arc(kx, kz, 0.512, from + (to - from) * f0, from + (to - from) * f1, 4);
        for (let i = 0; i < 4; i++) decal([inner2[i], inner2[i + 1], outer2[i + 1], outer2[i]], white);
      }
    }
  }
}

type Decal = (poly: P[], color: Color, y?: number) => void;

/** A zebra across the middle of a straight: stripes along the traffic across the carriageway, a give-way line each side. */
function zebraPaint(t: RoadTile, decal: Decal, white: Color) {
  const ox = t.x + 0.5, oz = t.z + 0.5, c = t.prof.carriage, ns = t.arms === 5;
  // along: the street's axis; across: from kerb to kerb
  const P2 = (along: number, across: number): P => (ns ? [ox + across, oz + along] : [ox + along, oz + across]);
  const stripe = 0.056, gap = 0.046, n = Math.floor((2 * c - 0.04 + gap) / (stripe + gap)), span = n * stripe + (n - 1) * gap;
  for (let i = 0; i < n; i++) { const c0 = -span / 2 + i * (stripe + gap); decal([P2(-MID, c0), P2(MID, c0), P2(MID, c0 + stripe), P2(-MID, c0 + stripe)], white); }
  // traffic drives on the right: heading +along, a car's right is -across on a north-south street, +across on an east-west one
  for (const sg of [-1, 1]) for (let k = 0; k < 4; k++) {
    const a = sg * (MID + 0.06), c0 = 0.02 + k * 0.09, c1 = Math.min(c - 0.01, c0 + 0.055), side = ns ? sg : -sg;
    decal([P2(a - 0.011, side * c0), P2(a + 0.011, side * c0), P2(a + 0.011, side * c1), P2(a - 0.011, side * c1)], white);
  }
}

/** forward (into the junction) and right-hand directions for an approach from side s of the junction's neighbour */
const frame = (s: number): { f: P; r: P } => { const f: P = [-SIDE[s][0], -SIDE[s][1]]; return { f, r: [-f[1], f[0]] }; };

/** Give-way or stop line, triangle and arrows on the approach tile t whose side s is a junction. */
function approachPaint(t: RoadTile, s: number, decal: Decal, white: Color) {
  const ox = t.x + 0.5, oz = t.z + 0.5, c = t.prof.carriage;
  // in this tile: the junction lies at +SIDE[s]; cars approaching it drive along f = SIDE[s] in the lane on their right
  const f: P = [SIDE[s][0], SIDE[s][1]], r: P = [-f[1], f[0]];
  const P2 = (along: number, across: number): P => [ox + f[0] * along + r[0] * across, oz + f[1] * along + r[1] * across];
  const quad = (a0: number, a1: number, c0: number, c1: number): P[] => [P2(a0, c0), P2(a1, c0), P2(a1, c1), P2(a0, c1)];
  const ctrl = t.nCtrl[s];
  if (ctrl === MouthControl.Stop) decal(quad(0.455, 0.49, 0.01, c - 0.01), white);
  else if (ctrl === MouthControl.GiveWay) {
    for (const a of [0.44, 0.475]) for (let k = 0; k < 4; k++) { const c0 = 0.02 + k * 0.09; decal(quad(a - 0.012, a + 0.012, c0, Math.min(c - 0.01, c0 + 0.055)), white); }
    // the triangle: its point to the driver, its base towards the line
    const b0 = 0.08, b1 = 0.34, half = 0.075, w = 0.016, mid = 0.19;
    const A = P2(b0, mid), B = P2(b1, mid - half), C = P2(b1, mid + half);
    const thick = (p: P, q: P) => { const ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez), nx = (-ez / L) * w / 2, nz = (ex / L) * w / 2; return [[p[0] - nx, p[1] - nz], [q[0] - nx, q[1] - nz], [q[0] + nx, q[1] + nz], [p[0] + nx, p[1] + nz]] as P[]; };
    decal(thick(A, B), white); decal(thick(B, C), white); decal(thick(C, A), white);
  }
  if (ctrl !== MouthControl.GiveWay && t.nArms[s]) {
    // turn arrows: which ways the junction lets this lane go (straight on, left, right: traffic drives on the right)
    const arms = t.nArms[s];
    const has = (dx: number, dz: number) => { const i = SIDE.findIndex(([x, z]) => x === dx && z === dz); return i >= 0 && !!(arms & (1 << i)); };
    const straight = has(f[0], f[1]), right = has(r[0], r[1]), left = has(-r[0], -r[1]);
    const mid = 0.19, base = 0.04, top = 0.3, w = 0.02;
    decal(quad(base, top - (straight ? 0.05 : 0.08), mid - w / 2, mid + w / 2), white);
    if (straight) decal([P2(top, mid), P2(top - 0.06, mid - 0.035), P2(top - 0.06, mid + 0.035)], white);
    for (const [on, sg] of [[left, -1], [right, 1]] as [boolean, number][]) {
      if (!on) continue;
      // a short stalk off the shaft and a head pointing across the lane
      const y0 = top - 0.1;
      decal(quad(y0 - w / 2, y0 + w / 2, mid, mid + sg * 0.06).map((p) => p), white);
      const tip = P2(y0, mid + sg * 0.11), b1 = P2(y0 - 0.032, mid + sg * 0.055), b2 = P2(y0 + 0.032, mid + sg * 0.055);
      decal([tip, b1, b2], white);
    }
  }
}

/** A junction tile's paint: the crossings at its mouths and, at busy crossroads, the yellow box. */
function junctionPaint(t: RoadTile, _g: Geo, decal: Decal, white: Color) {
  const ox = t.x + 0.5, oz = t.z + 0.5, c = t.prof.carriage;
  for (let s = 0; s < 4; s++) {
    if (!t.cross[s]) continue;
    const { f, r } = frame(s); // f points into the junction from side s
    const P2 = (along: number, across: number): P => [ox - f[0] * along + r[0] * across, oz - f[1] * along + r[1] * across];
    if (t.cross[s] === MouthCrossing.Zebra) {
      // stripes along the traffic, across the whole carriageway
      const stripe = 0.056, gap = 0.046, n = Math.floor((2 * c - 0.04 + gap) / (stripe + gap));
      const span = n * stripe + (n - 1) * gap, from = -span / 2;
      for (let i = 0; i < n; i++) { const c0 = from + i * (stripe + gap); decal([P2(BAND0, c0), P2(BAND1, c0), P2(BAND1, c0 + stripe), P2(BAND0, c0 + stripe)], white); }
    } else if (t.cross[s] === MouthCrossing.Signal) {
      // two lines of studs either side of the crossing
      for (const a of [BAND0, BAND1 - 0.01]) for (let x = -c + 0.03; x < c - 0.02; x += 0.045) decal([P2(a - 0.008, x), P2(a + 0.008, x), P2(a + 0.008, x + 0.022), P2(a - 0.008, x + 0.022)], white);
    }
  }
  if (t.box) {
    // the yellow box: a border and criss-cross hatching inside the crossings
    const e = BAND0 - 0.02, yel = YELLOW.clone().multiplyScalar(0.92 + 0.1 * hk(t, 60));
    const lw = 0.018;
    for (const [x0, z0, x1, z1] of [[-e, -e, e, -e + lw], [-e, e - lw, e, e], [-e, -e, -e + lw, e], [e - lw, -e, e, e]]) decal([[ox + x0, oz + z0], [ox + x1, oz + z0], [ox + x1, oz + z1], [ox + x0, oz + z1]], yel);
    for (const dir of [1, -1]) for (let k = -2 * e; k <= 2 * e + 1e-6; k += 0.12) {
      // a line x - dir*z = k, as a thin quad clipped to the box
      const L = 2, nx = 1 / Math.SQRT2, nz = -dir / Math.SQRT2;
      const cx = (k * nx), cz = (k * nz);
      let poly: P[] = [[cx - nz * L - nx * lw / 2, cz + nx * L - nz * lw / 2], [cx + nz * L - nx * lw / 2, cz - nx * L - nz * lw / 2], [cx + nz * L + nx * lw / 2, cz - nx * L + nz * lw / 2], [cx - nz * L + nx * lw / 2, cz + nx * L + nz * lw / 2]];
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) poly = clip(poly, ax, az, e - lw);
      if (poly.length >= 3) decal(poly.map(([x, z]) => [ox + x, oz + z] as P), yel);
    }
  }
}

/** A level crossing: the track's concrete panels across road and pavements, its rails, stop lines and keep-clear hatching. */
function railPaint(t: RoadTile, g: Geo, decal: Decal, white: Color) {
  const ox = t.x + 0.5, oz = t.z + 0.5, c = t.prof.carriage, K = t.prof.kerb;
  const trackNS = t.rail === 5; // the track runs north-south, the road east-west
  const P2 = (along: number, across: number): P => (trackNS ? [ox + along, oz + across] : [ox + across, oz + along]);
  const band = 0.234, gauge = 0.086;
  // panels: on the carriageway, and on each pavement at its height
  decal([P2(-band, -c), P2(band, -c), P2(band, c), P2(-band, c)], PANEL, Y_PATCH);
  for (const s of [-1, 1]) {
    const y = K + Y_KERBTOP;
    g.fan([P2(-band, s * c), P2(band, s * c), P2(band, s * 0.5), P2(-band, s * 0.5)], () => y, PANEL);
  }
  for (const o of [-gauge, gauge]) {
    decal([P2(o - 0.027, -0.5), P2(o + 0.027, -0.5), P2(o + 0.027, 0.5), P2(o - 0.027, 0.5)].map((p) => p), RAIL_DARK, Y_PAINT);
    for (const s of [-1, 1]) g.fan([P2(o - 0.027, s * c), P2(o + 0.027, s * c), P2(o + 0.027, s * 0.5), P2(o - 0.027, s * 0.5)], () => K + Y_PAINT, RAIL_DARK);
    decal([P2(o - 0.009, -c), P2(o + 0.009, -c), P2(o + 0.009, c), P2(o - 0.009, c)], RAIL_HEAD, Y_PAINT + 0.0003);
  }
  // centre line up to the panels, a stop line across each approach lane at the tile's edge, yellow hatching between
  for (const s of [-1, 1]) decal([P2(s * (band + 0.04), -0.012), P2(s * 0.47, -0.012), P2(s * 0.47, 0.012), P2(s * (band + 0.04), 0.012)], white);
  decal([P2(-0.49, 0.01), P2(-0.455, 0.01), P2(-0.455, c - 0.01), P2(-0.49, c - 0.01)], white);
  decal([P2(0.455, -c + 0.01), P2(0.49, -c + 0.01), P2(0.49, -0.01), P2(0.455, -0.01)], white);
  const yel = YELLOW.clone().multiplyScalar(0.8);
  for (const s of [-1, 1]) for (let k = -0.6; k < 0.6; k += 0.11) {
    let poly: P[] = [[k - 0.01, -c], [k + 0.01, -c], [k + 0.01 + 2 * c, c], [k - 0.01 + 2 * c, c]];
    const lo = s < 0 ? -0.45 : band + 0.03, hi = s < 0 ? -band - 0.03 : 0.45;
    poly = clip(clip(clip(clip(poly, 1, 0, hi), -1, 0, -lo), 0, 1, c - 0.03), 0, -1, c - 0.03);
    if (poly.length >= 3) decal(poly.map(([a, b]) => P2(a, b)), yel);
  }
}

// ---- roundabout ring tiles ---------------------------------------------------------------------------------------

/**
 * A tile of a roundabout's ring (shared/src/junctions.ts): `pos` its place round the island (RING_POS order), `arm`
 * whether a road leaves it (an arm place with a road beyond). Built in the frame of the east side and of the
 * north-east corner and turned into place: the overrun apron of setts round the island (render/junctions.ts plants
 * the island itself), the ring's carriageway, the pavement round the outside opening for the arm, and the paint.
 */
export function buildRing(x: number, z: number, pos: number, arm: boolean, prof: RoadProfile, g: Geo) {
  g.tx = x; g.tz = z;
  const K = prof.kerb, c = prof.carriage, A = RING_APRON, O = RING_OUTER;
  const turn = pos >> 1;
  const ox = x + 0.5, oz = z + 0.5;
  // canonical (east side / north-east corner) tile-local point to world: `turn` quarter turns anticlockwise from above
  const W = (p: P): P => { let [a, b] = p; for (let i = 0; i < turn; i++) [a, b] = [b, -a]; return [ox + a, oz + b]; };
  const r = (n: number) => hash2(x * 19 + n * 3, z * 23 - n * 11);
  const asphalt = new Color().setScalar(0.93 + 0.1 * r(1)), pave = new Color().setScalar(0.92 + 0.12 * r(2)), kerb = KERB.clone().multiplyScalar(0.9 + 0.15 * r(3));
  const sett = new Color().setScalar(0.95 + 0.1 * r(4));
  const flat = (poly: P[], y: number, color: Color, cell: number) => {
    g.setCell(cell);
    for (const tri of triangulate(poly)) { const w = tri.map(W); g.tri(w[0], w[1], w[2], y, y, y, color); }
  };
  const wallC = kerb.clone().multiplyScalar(0.82);
  const wall = (line: P[], ya: number, yb: number, toward: P) => {
    g.setCell(Cell.Paint);
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
      let nx = -ez / L, nz = ex / L;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (nx * (toward[0] - mx) + nz * (toward[1] - mz) < 0) { nx = -nx; nz = -nz; }
      const wa = W(a), wn = W([a[0] + nx, a[1] + nz]);
      g.wall(wa, W(b), ya, yb, ya, yb, wn[0] - wa[0], wn[1] - wa[1], wallC);
    }
  };
  const APRON_Y = 0.005;
  if (!(pos & 1)) {
    // east side: island edge at lx = -0.5; u = lx + 0.5 out from it
    const L = (u: number) => u - 0.5;
    flat([[L(0), -0.5], [L(A), -0.5], [L(A), 0.5], [L(0), 0.5]], APRON_Y, sett, Cell.Setts);
    flat([[L(A), -0.5], [L(O), -0.5], [L(O), 0.5], [L(A), 0.5]], 0, asphalt, Cell.Asphalt);
    wall([[L(A), -0.5], [L(A), 0.5]], 0, APRON_Y, [L(O), 0]);
    if (arm) {
      flat([[L(O), -c], [0.5, -c], [0.5, c], [L(O), c]], 0, asphalt, Cell.Asphalt);
      const rr = 0.06;
      for (const s of [-1, 1]) {
        const corner = arc(L(O) + rr, s * (c + rr), rr, s < 0 ? Math.PI / 2 : -Math.PI / 2, s < 0 ? Math.PI : -Math.PI, 4);
        const piece: P[] = [[0.5, s * c], [0.5, s * 0.5], [L(O), s * 0.5], ...corner.slice().reverse()];
        flat(piece, K, pave, Cell.Pavement);
        // the corner's road side (outside the fillet) is carriageway too
        flat([[L(O), s * c], ...corner], 0, asphalt, Cell.Asphalt);
        wall([[L(O), s * 0.5], ...corner.slice().reverse(), [0.5, s * c]], 0, K, [L(A), 0]);
        wall([[0.5, s * c], [0.5, s * 0.5]], 0, K, [1, 0]);
      }
      // give way: a double dashed line across the way in (the north half), and a painted splitter
      g.setCell(Cell.Paint);
      for (const u of [O + 0.015, O + 0.045]) for (let w = -c + 0.02; w < -0.03; w += 0.07) {
        const q: P[] = [[L(u), w], [L(u + 0.016), w], [L(u + 0.016), w + 0.04], [L(u), w + 0.04]];
        g.fan(q.map(W), () => Y_PAINT, WHITE);
      }
      const sp: P[] = [[0.5, -0.07], [L(O) + 0.03, 0], [0.5, 0.07]];
      g.fan(sp.map(W), () => Y_PAINT, WHITE);
      g.fan([[0.5, -0.045], [L(O) + 0.09, 0], [0.5, 0.045]].map((p) => W(p as P)), () => Y_PAINT + 0.0002, new Color().setScalar(0.16));
    } else {
      flat([[L(O), -0.5], [0.5, -0.5], [0.5, 0.5], [L(O), 0.5]], K, pave, Cell.Pavement);
      wall([[L(O), -0.5], [L(O), 0.5]], 0, K, [L(A), 0]);
      wall([[0.5, -0.5], [0.5, 0.5]], 0, K, [1, 0]);
    }
    // the ring's inner edge line by the apron
    g.setCell(Cell.Paint);
    g.fan([[L(A + 0.025), -0.5], [L(A + 0.043), -0.5], [L(A + 0.043), 0.5], [L(A + 0.025), 0.5]].map((p) => W(p as P)), () => Y_PAINT, WHITE);
  } else {
    // north-east corner: arcs round the island's corner at the tile's south-west
    const kx = -0.5, kz = 0.5;
    const ring = (rad: number, n = 10) => arc(kx, kz, rad, -Math.PI / 2, 0, n);
    flat([[kx, kz], ...ring(A)], APRON_Y, sett, Cell.Setts);
    flat([...ring(O, 14), ...ring(A).reverse()], 0, asphalt, Cell.Asphalt);
    const outer = ring(O, 14);
    flat([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], ...outer.slice().reverse()], K, pave, Cell.Pavement);
    wall(ring(A), 0, APRON_Y, [0.5, -0.5]);
    wall(outer, 0, K, [kx, kz]);
    wall([[-0.5, -0.5], [0.5, -0.5]], 0, K, [0, -1]);
    wall([[0.5, -0.5], [0.5, 0.5]], 0, K, [1, 0]);
    g.setCell(Cell.Paint);
    const e0 = ring(A + 0.025), e1 = ring(A + 0.043);
    for (let i = 0; i + 1 < e0.length; i++) g.fan([e0[i], e0[i + 1], e1[i + 1], e1[i]].map(W), () => Y_PAINT, WHITE);
    // an arrow round the ring, anticlockwise: in from the south edge, out by the west
    const R = 0.69, a0 = -0.5, a1 = -1.0;
    const s0 = arc(kx, kz, R - 0.012, a0, a1, 5), s1 = arc(kx, kz, R + 0.012, a0, a1, 5);
    const arrowC = WHITE.clone().multiplyScalar(0.8);
    for (let i = 0; i < 5; i++) g.fan([s0[i], s0[i + 1], s1[i + 1], s1[i]].map(W), () => Y_PAINT, arrowC);
    const hx = kx + R * Math.cos(a1), hz = kz + R * Math.sin(a1), tx = Math.sin(a1), tz = -Math.cos(a1);
    g.fan([[hx - tx * 0.07, hz - tz * 0.07], [hx + Math.cos(a1) * 0.045, hz + Math.sin(a1) * 0.045], [hx - Math.cos(a1) * 0.045, hz - Math.sin(a1) * 0.045]].map((p) => W(p as P)), () => Y_PAINT, arrowC);
  }
}

/** Height a walker stands at on a ring tile (canonical frame as buildRing). */
export function ringSurfaceY(x: number, z: number, pos: number, arm: boolean, prof: RoadProfile, wx: number, wz: number): number {
  let a = wx - x - 0.5, b = wz - z - 0.5;
  for (let i = 0; i < (pos >> 1); i++) [a, b] = [-b, a]; // undo the turn
  const O = RING_OUTER, c = prof.carriage;
  if (!(pos & 1)) return a + 0.5 > O && !(arm && Math.abs(b) < c) ? prof.kerb : 0;
  return Math.hypot(a + 0.5, b - 0.5) > O ? prof.kerb : 0;
}
