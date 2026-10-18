import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Vector3, type PerspectiveCamera } from 'three';
import { FRONT, placedMarks, type MarkKind, type Placed, type PlacedMark } from '@msimcity/shared';

/** Colour of each mark kind in the footprint overlay; the door's is green or red by whether a road is in front. */
export const MARK_COLOR: Record<MarkKind, number> = {
  door: 0x3ddc84, gate: 0xff9f1c, platform: 0x4aa3ff, apron: 0xb4bcc8, stand: 0xffd23f, dock: 0x2ec4b6,
  quay: 0xd9d2c3, berth: 0x1e90ff,
};
const GOOD = 0x3ddc84, BAD = 0xff4d44, LINE = 0xffffff;
const Y_FILL = 0.046, Y_LINE = 0.052, Y_MARK = 0.058;

export interface OverlayState {
  /** the placement verdict of a preview; null for an existing structure under the cursor */
  ok: boolean | null;
  /** is there a road tile ahead of the door */
  road: boolean;
  /** an existing structure (dim) rather than a preview */
  faint: boolean;
  /** the tile under the cursor; with faint, only the labels of marks there are shown */
  hover?: [number, number] | null;
}

/** Flat coloured triangles, built in tile coordinates on the ground plane. */
class Quads {
  pos: number[] = [];
  col: number[] = [];
  private c = new Color();
  private push(x: number, y: number, z: number) { this.pos.push(x, y, z); this.col.push(this.c.r, this.c.g, this.c.b); }
  rect(x0: number, z0: number, x1: number, z1: number, y: number, hex: number) {
    this.c.setHex(hex);
    this.push(x0, y, z0); this.push(x0, y, z1); this.push(x1, y, z1);
    this.push(x0, y, z0); this.push(x1, y, z1); this.push(x1, y, z0);
  }
  tri(a: [number, number], b: [number, number], c: [number, number], y: number, hex: number) {
    this.c.setHex(hex);
    this.push(a[0], y, a[1]); this.push(b[0], y, b[1]); this.push(c[0], y, c[1]);
  }
  /** a quad from four corners (any winding; materials are double sided) */
  quad(p: [number, number][], y: number, hex: number) { this.tri(p[0], p[1], p[2], y, hex); this.tri(p[0], p[2], p[3], y, hex); }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    return g;
  }
}

const material = (opacity: number) => new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, depthTest: false, side: DoubleSide });

interface Chip { el: HTMLDivElement; mark: PlacedMark; x: number; z: number }

/**
 * The outline of a structure's footprint, one crisp outline per tile, and its significant parts as flat coloured strips:
 * the door as an arrow towards the road, and the catalogue's marks (gate, platform, apron, stand, dock; shared/src/structures.ts
 * placedMarks). Shown at full strength under the cursor while placing, faintly over a structure that stands. Labels are small
 * DOM chips projected onto the ground.
 */
export class FootprintOverlay {
  readonly group = new Group();
  private lines = new Mesh(new BufferGeometry(), material(0.95));
  private fills = new Mesh(new BufferGeometry(), material(0.4));
  private key = '';
  private chips: Chip[] = [];
  private box = document.createElement('div');
  private hover: [number, number] | null = null;
  private faint = false;
  private tmp = new Vector3();

  constructor() {
    for (const m of [this.fills, this.lines]) { m.frustumCulled = false; m.renderOrder = 20; this.group.add(m); }
    this.group.visible = false;
    this.box.id = 'markLabels';
    document.body.appendChild(this.box);
  }

  hide() {
    this.group.visible = false;
    this.box.style.display = 'none';
    this.key = '';
  }

  show(p: Placed, st: OverlayState) {
    this.hover = st.hover ?? null;
    this.faint = st.faint;
    this.group.visible = true;
    const key = `${p.kind}:${p.ax},${p.ay}:${p.r}:${st.ok}:${st.road}:${st.faint}`;
    if (key !== this.key) { this.key = key; this.rebuild(p, st); }
    this.lines.scale.setScalar(1);
    (this.lines.material as MeshBasicMaterial).opacity = st.faint ? 0.4 : 0.95;
    (this.fills.material as MeshBasicMaterial).opacity = st.faint ? 0.16 : 0.4;
    this.box.style.display = '';
  }

  private rebuild(p: Placed, st: OverlayState) {
    const lines = new Quads(), fills = new Quads();
    const edge = st.ok === null ? LINE : st.ok ? GOOD : BAD;
    // one outline per tile: interior grid lines thin, the outer boundary heavier and coloured by the verdict
    const T = 0.03, B = 0.065;
    for (let i = 1; i < p.w; i++) lines.rect(p.ax + i - T / 2, p.ay, p.ax + i + T / 2, p.ay + p.h, Y_LINE, LINE);
    for (let j = 1; j < p.h; j++) lines.rect(p.ax, p.ay + j - T / 2, p.ax + p.w, p.ay + j + T / 2, Y_LINE, LINE);
    lines.rect(p.ax - B / 2, p.ay - B / 2, p.ax + p.w + B / 2, p.ay + B / 2, Y_LINE, edge);
    lines.rect(p.ax - B / 2, p.ay + p.h - B / 2, p.ax + p.w + B / 2, p.ay + p.h + B / 2, Y_LINE, edge);
    lines.rect(p.ax - B / 2, p.ay + B / 2, p.ax + B / 2, p.ay + p.h - B / 2, Y_LINE, edge);
    lines.rect(p.ax + p.w - B / 2, p.ay + B / 2, p.ax + p.w + B / 2, p.ay + p.h - B / 2, Y_LINE, edge);

    this.chips.forEach((c) => c.el.remove());
    this.chips = [];
    for (const m of placedMarks(p)) {
      const colour = m.kind === 'door' ? (st.road ? GOOD : BAD) : MARK_COLOR[m.kind];
      if (m.kind === 'door') this.arrow(lines, m, colour);
      else if (m.edge && Math.min(m.w, m.h) >= 1) {
        // a band (the apron): translucent fill with a solid edge on its inner side
        fills.rect(m.x, m.y, m.x + m.w, m.y + m.h, Y_FILL, colour);
        this.bandEdge(lines, m, colour);
      } else if (m.edge) lines.rect(m.x, m.y, m.x + m.w, m.y + m.h, Y_MARK, colour);
      else {
        // one tile: an inset square, filled, with a solid frame
        const i = 0.14, f = 0.05;
        fills.rect(m.x + i, m.y + i, m.x + m.w - i, m.y + m.h - i, Y_FILL, colour);
        lines.rect(m.x + i, m.y + i, m.x + m.w - i, m.y + i + f, Y_MARK, colour);
        lines.rect(m.x + i, m.y + m.h - i - f, m.x + m.w - i, m.y + m.h - i, Y_MARK, colour);
        lines.rect(m.x + i, m.y + i + f, m.x + i + f, m.y + m.h - i - f, Y_MARK, colour);
        lines.rect(m.x + m.w - i - f, m.y + i + f, m.x + m.w - i, m.y + m.h - i - f, Y_MARK, colour);
      }
      const label = m.kind === 'door' && !st.road && st.ok !== null ? 'door: needs a road' : m.label;
      if (label) this.chips.push(this.chip(label, colour, m));
    }
    this.lines.geometry.dispose(); this.fills.geometry.dispose();
    this.lines.geometry = lines.geometry(); this.fills.geometry = fills.geometry();
  }

  /** the door mark as an arrow from the door tile out across its front edge towards the road */
  private arrow(q: Quads, m: PlacedMark, colour: number) {
    const [fx, fy] = FRONT[m.facing], cx = m.x + 0.5, cz = m.y + 0.5;
    const px = -fy, pz = fx; // perpendicular
    const at = (a: number, b: number): [number, number] => [cx + fx * a + px * b, cz + fy * a + pz * b];
    q.quad([at(-0.2, -0.06), at(0.5, -0.06), at(0.5, 0.06), at(-0.2, 0.06)], Y_MARK, colour); // shaft
    q.tri(at(0.38, -0.24), at(0.38, 0.24), at(0.92, 0), Y_MARK, colour);                     // head, tip over the road tile
  }

  /** the inner edge of an apron band, so the band reads as an area with a limit */
  private bandEdge(q: Quads, m: PlacedMark, colour: number) {
    const [fx, fy] = FRONT[m.facing], t = 0.04;
    // the band's side furthest from its edge: opposite the outward direction
    if (fx > 0) q.rect(m.x, m.y, m.x + t, m.y + m.h, Y_MARK, colour);
    else if (fx < 0) q.rect(m.x + m.w - t, m.y, m.x + m.w, m.y + m.h, Y_MARK, colour);
    else if (fy > 0) q.rect(m.x, m.y, m.x + m.w, m.y + t, Y_MARK, colour);
    else q.rect(m.x, m.y + m.h - t, m.x + m.w, m.y + m.h, Y_MARK, colour);
  }

  private chip(text: string, colour: number, m: PlacedMark): Chip {
    const el = document.createElement('div');
    el.className = 'mark-chip';
    el.textContent = text;
    el.style.borderColor = '#' + colour.toString(16).padStart(6, '0');
    this.box.appendChild(el);
    // the door's label sits over the road tile the arrow points at, so it does not hide the strips beside it
    const [fx, fy] = FRONT[m.facing], out = m.kind === 'door' ? 1.5 : 0;
    return { el, mark: m, x: m.x + m.w / 2 + fx * out, z: m.y + m.h / 2 + fy * out };
  }

  /** the cursor tile lies on this mark (a thin boundary line counts the tile inside it) */
  private under(m: PlacedMark, tx: number, ty: number): boolean {
    let { x, y, w, h } = m;
    if (m.edge && Math.min(w, h) < 1) {
      const [fx, fy] = FRONT[m.facing];
      // widen a boundary line to the one tile inside it
      if (fx !== 0) { x = fx > 0 ? x + w / 2 - 1 : x + w / 2; w = 1; } else { y = fy > 0 ? y + h / 2 - 1 : y + h / 2; h = 1; }
    }
    const cx = tx + 0.5, cy = ty + 0.5;
    return cx > x && cx < x + w && cy > y && cy < y + h;
  }

  /** Place the label chips; call once per frame while shown. */
  frame(camera: PerspectiveCamera, vw: number, vh: number) {
    if (!this.group.visible) return;
    for (const c of this.chips) {
      let show = true;
      if (this.faint) show = !!this.hover && this.under(c.mark, this.hover[0], this.hover[1]);
      if (show) {
        this.tmp.set(c.x, Y_MARK, c.z).project(camera);
        show = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.05 && Math.abs(this.tmp.y) < 1.05;
      }
      c.el.style.display = show ? '' : 'none';
      if (show) c.el.style.transform = `translate(${((this.tmp.x + 1) / 2) * vw}px, ${((1 - this.tmp.y) / 2) * vh}px) translate(-50%, -50%)`;
    }
  }
}
