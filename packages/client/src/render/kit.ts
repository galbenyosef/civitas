import { BufferGeometry, BoxGeometry, CylinderGeometry, ConeGeometry, Float32BufferAttribute, Color } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CompiledFacade } from '@msimcity/shared/src/buildings/schema';
import { CELL, faceFrame, facadeGrid, facePoint, cellMode } from '@msimcity/shared/src/buildings/facade';

const col = new Color();

/**
 * Tiny constructive kit for low-poly models. Every part gets baked vertex
 * colours and an `aWin` attribute (the window class, see Win in materials.ts;
 * 0 = no windows) and an `aTop` attribute (the part's top height). Parts are
 * non-indexed so shading is flat and crisp.
 *
 * A Kit made with `{ facades: true }` (building models) also gives every part `aFac` (cell u, cell v, cell
 * mode, wall) and `aCell` (bay, storey, cell width, cell height). A box with a facade (shared buildings/facade.ts)
 * is built as one quad per cell so the shader can draw exactly one window per cell; every other part gets zeros
 * there, which the shader reads as the legacy window grid. Facade-free models keep their geometry byte for byte.
 */
export class Kit {
  private parts: BufferGeometry[] = [];
  constructor(private readonly opts: { facades?: boolean } = {}) {}

  /** axis-aligned box w×h×d with its base at y, centred on x,z; with a facade its walls are split into cells */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, win = 0, facade?: CompiledFacade) {
    if (facade && win && this.opts.facades) return this.add(facadeBox(w, h, d, x, y, z, facade), color, win);
    return this.add(new BoxGeometry(w, h, d).translate(x, y + h / 2, z), color, win);
  }
  cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, color: number, seg = 8) {
    return this.add(new CylinderGeometry(rTop, rBot, h, seg).translate(x, y + h / 2, z), color, 0);
  }
  cone(r: number, h: number, x: number, y: number, z: number, color: number, seg = 8) {
    return this.add(new ConeGeometry(r, h, seg).translate(x, y + h / 2, z), color, 0);
  }
  /** wheel: a cylinder whose axis runs along x */
  wheel(r: number, w: number, x: number, y: number, z: number, color: number) {
    return this.add(new CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2).translate(x, y, z), color, 0);
  }
  /** pitched roof prism: footprint w×d, height h, base at y; ridge along x unless alongZ */
  roof(w: number, h: number, d: number, x: number, y: number, z: number, color: number, alongZ = false) {
    const hw = w / 2, hd = d / 2;
    const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
    const tris: number[][][] = alongZ
      ? (() => { const R1 = [0, h, -hd], R2 = [0, h, hd]; return [[A, B, R1], [D, C, R2], [A, D, R2], [A, R2, R1], [B, C, R2], [B, R2, R1]]; })()
      : (() => { const R1 = [-hw, h, 0], R2 = [hw, h, 0]; return [[A, B, R2], [A, R2, R1], [D, C, R2], [D, R2, R1], [A, R1, D], [B, C, R2]]; })();
    const pos: number[] = [];
    for (let [a, b, c] of tris) {
      // wind every face outward from the prism's centre
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3 - h / 2, cz = (a[2] + b[2] + c[2]) / 3;
      if (nx * cx + ny * cy + nz * cz < 0) [b, c] = [c, b];
      pos.push(...a, ...b, ...c);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.translate(x, y, z);
    return this.add(g, color, 0);
  }

  /** a box whose top is another rectangle wt×dt (0×0: a pyramid) centred at (sx, sz) from the base's centre; base at y */
  taper(wb: number, db: number, wt: number, dt: number, h: number, x: number, y: number, z: number, color: number, win = 0, sx = 0, sz = 0) {
    const b = [[-wb / 2, 0, -db / 2], [wb / 2, 0, -db / 2], [wb / 2, 0, db / 2], [-wb / 2, 0, db / 2]];
    const t = [[sx - wt / 2, h, sz - dt / 2], [sx + wt / 2, h, sz - dt / 2], [sx + wt / 2, h, sz + dt / 2], [sx - wt / 2, h, sz + dt / 2]];
    const pos: number[] = [];
    const tri = (a: number[], c: number[], d: number[]) => {
      // skip the zero-area triangles a pointed or knife-edged top leaves
      const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9) return;
      pos.push(...a, ...c, ...d);
    };
    const quad = (a: number[], c: number[], d: number[], e: number[]) => { tri(a, c, d); tri(a, d, e); };
    // sides wound outward (counter-clockwise seen from outside), then the top
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[i], t[i], t[j], b[j]); }
    quad(t[0], t[3], t[2], t[1]);
    return this.add(flat(pos).translate(x, y, z), color, win);
  }
  /**
   * A solid of revolution: profile [r, dy, ...] from the base up, `seg` facets round, each ring turned `twist` degrees
   * per tile of height. With `every` > 0, facets i with i % every < width take `stripe`: straight bands, or spirals
   * when twisted. A flat cap closes an open top. `axis` 1 or 2 lays it along +x or +z.
   */
  lathe(x: number, y: number, z: number, color: number, seg: number, stripe: number, every: number, width: number, twist: number, axis: number, win: number, profile: readonly number[]) {
    const plain: number[] = [], banded: number[] = [];
    const tw = (twist * Math.PI) / 180;
    const pt = (r: number, dy: number, i: number) => { const a = (i / seg) * Math.PI * 2 + tw * dy; return [Math.sin(a) * r, dy, Math.cos(a) * r]; };
    const n = profile.length / 2;
    for (let j = 0; j < n - 1; j++) {
      const r0 = profile[2 * j], y0 = profile[2 * j + 1], r1 = profile[2 * j + 2], y1 = profile[2 * j + 3];
      for (let i = 0; i < seg; i++) {
        const out = every > 0 && i % every < width ? banded : plain;
        const a = pt(r0, y0, i), b = pt(r0, y0, i + 1), c = pt(r1, y1, i + 1), d = pt(r1, y1, i);
        if (r0 > 0) out.push(...a, ...b, ...c);
        if (r1 > 0) out.push(...a, ...c, ...d);
      }
    }
    const rTop = profile[2 * n - 2], yTop = profile[2 * n - 1];
    if (rTop > 0) for (let i = 0; i < seg; i++) plain.push(0, yTop, 0, ...pt(rTop, yTop, i), ...pt(rTop, yTop, i + 1));
    const place = (g: BufferGeometry) => (axis === 1 ? g.rotateZ(-Math.PI / 2) : axis === 2 ? g.rotateX(Math.PI / 2) : g).translate(x, y, z);
    this.add(place(flat(plain)), color, win);
    if (banded.length) this.add(place(flat(banded)), stripe, win);
    return this;
  }

  /** any geometry as a part, flat-coloured */
  part(g: BufferGeometry, color: number) { return this.add(g, color, 0); }

  private add(g: BufferGeometry, color: number, win: number) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    ng.deleteAttribute('uv');
    const n = ng.attributes.position.count;
    const c = new Float32Array(n * 3);
    col.setHex(color);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    ng.setAttribute('color', new Float32BufferAttribute(c, 3));
    ng.setAttribute('aWin', new Float32BufferAttribute(new Float32Array(n).fill(win), 1));
    // the part's top height, for the window shader (clerestories sit under the eaves); not part of the geometry snapshot
    ng.computeBoundingBox();
    ng.setAttribute('aTop', new Float32BufferAttribute(new Float32Array(n).fill(ng.boundingBox!.max.y), 1));
    if (this.opts.facades && !ng.attributes.aFac) {
      ng.setAttribute('aFac', new Float32BufferAttribute(new Float32Array(n * 4), 4));
      ng.setAttribute('aCell', new Float32BufferAttribute(new Float32Array(n * 4), 4));
    }
    this.parts.push(ng);
    return this;
  }

  build(): BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Non-indexed triangles with flat normals. */
function flat(pos: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A box whose four walls are split along its facade grid: margins, one quad per storey × bay cell, the top band.
 * Each vertex carries its cell coordinates (0-1 across the cell), the cell's mode and wall (aFac) and the cell's
 * bay, storey and size in tiles (aCell). Margins, the top band, blank walls, the roof and the floor are plain.
 */
function facadeBox(w: number, h: number, d: number, x: number, y: number, z: number, f: CompiledFacade): BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], fac: number[] = [], cel: number[] = [];
  const b = [w, h, d, x, y, z] as const;
  const quad = (p: number[][], n: number[], uv: number[][], mode: number, face: number, cell: number[]) => {
    // two triangles, wound to face along n
    const [a, bq, c] = p;
    const ux = bq[0] - a[0], uy = bq[1] - a[1], uz = bq[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    for (const i of flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
      pos.push(...p[i]); nrm.push(...n); fac.push(uv[i][0], uv[i][1], mode, face); cel.push(...cell);
    }
  };
  for (let face = 0; face < 4; face++) {
    const fr = faceFrame(b, face), g = facadeGrid(b, f, face);
    const n = fr.axis === 2 ? [0, 0, fr.out] : [fr.out, 0, 0];
    // column and row edges along the wall; a cell is column k (0..bays-1) of the grid inside the margins
    const cols = g.bays ? [0, g.m, ...Array.from({ length: g.bays }, (_, k) => g.m + (k + 1) * g.bw), fr.width] : [0, fr.width];
    const rows = [...Array.from({ length: g.storeys + 1 }, (_, k) => k * g.sh), h];
    for (let ci = 0; ci + 1 < cols.length; ci++) {
      const s0 = cols[ci], s1 = cols[ci + 1];
      if (s1 - s0 < 1e-6) continue;
      const bay = g.bays ? ci - 1 : -1;
      for (let ri = 0; ri + 1 < rows.length; ri++) {
        const y0 = rows[ri], y1 = rows[ri + 1];
        if (y1 - y0 < 1e-6) continue;
        const inGrid = bay >= 0 && bay < g.bays && ri < g.storeys;
        const mode = inGrid ? cellMode(f, face, ri, bay) : CELL.plain;
        const p = [facePoint(fr, s0, y + y0), facePoint(fr, s1, y + y0), facePoint(fr, s1, y + y1), facePoint(fr, s0, y + y1)];
        quad(p, n, [[0, 0], [1, 0], [1, 1], [0, 1]], mode, face, inGrid ? [bay, ri, g.bw, g.sh] : [0, 0, 0, 0]);
      }
    }
  }
  const hw = w / 2, hd = d / 2, flat = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const [yy, ny] of [[y + h, 1], [y, -1]]) {
    quad([[x - hw, yy, z - hd], [x + hw, yy, z - hd], [x + hw, yy, z + hd], [x - hw, yy, z + hd]], [0, ny, 0], flat, CELL.plain, 0, [0, 0, 0, 0]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFac', new Float32BufferAttribute(fac, 4));
  g.setAttribute('aCell', new Float32BufferAttribute(cel, 4));
  return g;
}
