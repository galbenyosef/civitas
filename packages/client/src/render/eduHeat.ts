import { Group, Mesh, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Color, DoubleSide } from 'three';
import type { ParcelDTO } from '@msimcity/shared';

/**
 * The education overlay (docs/education.md section 14), the traffic heat's counterpart for homes: every parcel with
 * residents aged 25-64 is tinted by its education index (ParcelStats.eduIndex, 0-100, from the schools census), red
 * through soft yellow to blue. One merged mesh with per-vertex colour, rebuilt when the parcels change. A parcel with a
 * school gets a stronger edge so the supply can be read against the attainment.
 */
const LOW = new Color(0xe5484d), MID = new Color(0xf0dc82), HIGH = new Color(0x1f7bff);
/** a diverging ramp centred on the base mix (index 62): red below it, soft yellow at it, blue above it; clamped at 40 and 84 */
const FROM = 40, CENTRE = 62, TO = 84;

export function eduColour(index: number, out = new Color()): Color {
  return index < CENTRE ? out.copy(LOW).lerp(MID, Math.max(0, (index - FROM) / (CENTRE - FROM))) : out.copy(MID).lerp(HIGH, Math.min(1, (index - CENTRE) / (TO - CENTRE)));
}

export class EduHeat {
  group = new Group();
  private mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }));
  on = false;

  constructor() {
    this.mesh.renderOrder = 3; this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  setOn(on: boolean) { this.on = on; this.group.visible = on; }

  rebuild(parcels: Iterable<ParcelDTO>) {
    const pos: number[] = [], col: number[] = [];
    const c = new Color();
    const quad = (x0: number, z0: number, x1: number, z1: number, y: number, a: number) => {
      pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
      for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b, a);
    };
    for (const p of parcels) {
      const s = p.stats;
      if (!s.eduN && !s.places) continue; // nobody to measure and no school
      if (s.eduN) eduColour(s.eduIndex ?? 0, c); else c.set(0x8a93a3); // a school with no residents around it: grey
      quad(p.x, p.y, p.x + p.w, p.y + p.h, 0.03, 0.62);
      if (s.places) { // a school stands here: a bright edge
        c.set(0xffffff);
        const e = 0.18;
        quad(p.x, p.y, p.x + p.w, p.y + e, 0.035, 0.85); quad(p.x, p.y + p.h - e, p.x + p.w, p.y + p.h, 0.035, 0.85);
        quad(p.x, p.y + e, p.x + e, p.y + p.h - e, 0.035, 0.85); quad(p.x + p.w - e, p.y + e, p.x + p.w, p.y + p.h - e, 0.035, 0.85);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 4));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}
