import { Group, Mesh, BufferGeometry, BufferAttribute, MeshBasicMaterial, RingGeometry, OctahedronGeometry, DoubleSide } from 'three';

const TRAIL_COLOR = 0x93b4e6;
const ROUTE_COLOR = 0x62d2a2;
const TRAIL_Y = 0.06, ROUTE_Y = 0.07;
const TRAIL_W = 0.11, DRIVE_W = 0.13, WALK_W = 0.07;
/** Rebuild when the agent has moved this far since the last build (tile units). */
const MOVE_EPS = 0.03;

const ribbonMaterial = (color: number, opacity: number) =>
  new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide, toneMapped: false });

/** A flat strip through a polyline, mitred at the joints, rewritten in place as the line changes (also the transit line ribbons, lines.ts). */
export class Ribbon {
  readonly mesh: Mesh;
  private pos = new Float32Array(0);
  private idx = new Uint32Array(0);
  constructor(material: MeshBasicMaterial, private y: number) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.frustumCulled = false;
  }
  /** pts: flat [x,z,...] in scene units; widths: one per point. */
  set(pts: number[], widths: number[]) {
    const n = pts.length / 2;
    const geo = this.mesh.geometry;
    if (n < 2) { this.mesh.visible = false; return; }
    if (this.pos.length < n * 6 || this.idx.length < (n - 1) * 6) {
      this.pos = new Float32Array(n * 6 * 2);
      this.idx = new Uint32Array(n * 6 * 2);
      geo.setAttribute('position', new BufferAttribute(this.pos, 3));
      geo.setIndex(new BufferAttribute(this.idx, 1));
    }
    const p = this.pos, y = this.y;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      // unit directions of the segments either side of this point
      let ax = 0, az = 0, bx = 0, bz = 0;
      if (i > 0) { ax = x - pts[i * 2 - 2]; az = z - pts[i * 2 - 1]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
      if (i < n - 1) { bx = pts[i * 2 + 2] - x; bz = pts[i * 2 + 3] - z; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
      if (i === 0) { ax = bx; az = bz; }
      if (i === n - 1) { bx = ax; bz = az; }
      let tx = ax + bx, tz = az + bz;
      const tl = Math.hypot(tx, tz);
      if (tl < 1e-4) { tx = bx; tz = bz; } else { tx /= tl; tz /= tl; }
      // miter: widen the joint so the strip keeps its width round corners, capped for hairpins
      const scale = 1 / Math.max(0.5, tx * bx + tz * bz);
      const h = (widths[i] / 2) * scale;
      const nx = -tz * h, nz = tx * h;
      p[i * 6] = x + nx; p[i * 6 + 1] = y; p[i * 6 + 2] = z + nz;
      p[i * 6 + 3] = x - nx; p[i * 6 + 4] = y; p[i * 6 + 5] = z - nz;
    }
    const ix = this.idx;
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      ix.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
    geo.index!.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
    this.mesh.visible = true;
  }
  hide() { this.mesh.visible = false; }
}

/** Server route data for one agent, flat tile coords as in CitizenInfo. */
export interface RouteData {
  trail?: number[];
  route?: number[];
  legKinds?: ('walk' | 'drive' | 'ride')[];
  legStarts?: number[];
}

/**
 * The selected agent's journey drawn on the ground: where they have been
 * (a muted strip) and where they are going (accent strip, thinner on foot),
 * with a marker over the destination. Both strips meet under the agent's
 * rendered position, which is re-read every frame.
 */
export class RouteView {
  readonly group = new Group();
  private trail = new Ribbon(ribbonMaterial(TRAIL_COLOR, 0.65), TRAIL_Y);
  private ahead = new Ribbon(ribbonMaterial(ROUTE_COLOR, 0.85), ROUTE_Y);
  private ring = new Mesh(new RingGeometry(0.5, 0.64, 40).rotateX(-Math.PI / 2), ribbonMaterial(ROUTE_COLOR, 0.9));
  private pin = new Mesh(new OctahedronGeometry(0.16), new MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
  private data: RouteData | null = null;
  private lastPos: [number, number] | null = null;

  constructor() {
    this.trail.mesh.renderOrder = 3;
    this.ahead.mesh.renderOrder = 4;
    this.ring.renderOrder = 4;
    this.pin.renderOrder = 10;
    this.pin.scale.set(1, 1.6, 1);
    this.ring.position.y = ROUTE_Y;
    this.group.add(this.trail.mesh, this.ahead.mesh, this.ring, this.pin);
    this.clear();
  }

  /** New data from the server; drawn on the next frame. */
  set(d: RouteData) {
    this.data = d;
    this.lastPos = null;
  }

  clear() {
    this.data = null;
    this.lastPos = null;
    this.trail.hide(); this.ahead.hide();
    this.ring.visible = false; this.pin.visible = false;
  }

  get active() { return this.data !== null; }

  /** Keep the strips joined to the agent; pos is its rendered (x, z), or null while it is not on screen. */
  frame(pos: [number, number] | null, now: number) {
    const d = this.data;
    if (!d) return;
    if (this.pin.visible) this.pin.position.y = 1.7 + 0.12 * Math.sin(now / 400);
    if (pos && this.lastPos && Math.hypot(pos[0] - this.lastPos[0], pos[1] - this.lastPos[1]) < MOVE_EPS) return;
    if (!pos && this.lastPos) return;
    this.lastPos = pos ? [pos[0], pos[1]] : [NaN, NaN];
    this.build(d, pos);
  }

  private build(d: RouteData, pos: [number, number] | null) {
    const centre = (arr: number[], i: number): [number, number] => [arr[i * 2] + 0.5, arr[i * 2 + 1] + 0.5];
    const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

    // taken: tile centres, ending under the agent; a last node whose centre it has not reached yet is left off
    const trail = d.trail ?? [];
    const tn = trail.length / 2;
    const tp: number[] = [];
    let tEnd = tn;
    if (pos && tn >= 2 && near(pos, centre(trail, tn - 2)) < near(centre(trail, tn - 1), centre(trail, tn - 2))) tEnd = tn - 1;
    for (let i = 0; i < tEnd; i++) tp.push(...centre(trail, i));
    if (pos) tp.push(pos[0], pos[1]);
    const tpd = dedupe(tp);
    this.trail.set(tpd, new Array(tpd.length / 2).fill(TRAIL_W));

    // ahead: from the agent, skipping a first node it is already past
    const route = d.route ?? [];
    const rn = route.length / 2;
    let first = 0;
    if (pos && rn >= 2 && near(pos, centre(route, 1)) < near(centre(route, 0), centre(route, 1))) first = 1;
    const kinds = d.legKinds ?? [], starts = d.legStarts ?? [];
    const widthAt = (node: number) => {
      let leg = 0;
      while (leg + 1 < starts.length && starts[leg + 1] <= node) leg++;
      return kinds[leg] === 'walk' ? WALK_W : DRIVE_W;
    };
    const rp: number[] = [], rw: number[] = [];
    if (pos && rn > first) { rp.push(pos[0], pos[1]); rw.push(widthAt(first)); }
    for (let i = first; i < rn; i++) { rp.push(...centre(route, i)); rw.push(widthAt(i)); }
    const [dp, dw] = dedupeW(rp, rw);
    this.ahead.set(dp, dw);

    if (rn > 0) {
      const [gx, gz] = centre(route, rn - 1);
      this.ring.position.set(gx, ROUTE_Y, gz);
      this.pin.position.set(gx, this.pin.position.y || 1.7, gz);
      this.ring.visible = this.pin.visible = true;
    } else {
      this.ring.visible = this.pin.visible = false;
    }
  }
}

/** Drop consecutive points closer than a hair, which would give the strip no direction. */
function dedupe(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - pts[i]) < 1e-3 && Math.abs(out[n - 1] - pts[i + 1]) < 1e-3) continue;
    out.push(pts[i], pts[i + 1]);
  }
  return out;
}
function dedupeW(pts: number[], w: number[]): [number[], number[]] {
  const out: number[] = [], ow: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - pts[i]) < 1e-3 && Math.abs(out[n - 1] - pts[i + 1]) < 1e-3) continue;
    out.push(pts[i], pts[i + 1]); ow.push(w[i / 2]);
  }
  return [out, ow];
}
