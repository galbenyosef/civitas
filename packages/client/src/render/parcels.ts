import { Group, Mesh, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Color, DoubleSide } from 'three';
import type { ParcelDTO, PlayerDTO } from '@msimcity/shared';

/**
 * Ownership overlay: a faint tinted fill and a solid ribbon border per parcel,
 * all merged into two meshes with per-vertex RGBA so it is two draw calls.
 */
export class ParcelsView {
  group = new Group();
  private fills = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }));
  private ribbons = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }));

  constructor() {
    this.fills.renderOrder = 1; this.ribbons.renderOrder = 2;
    this.group.add(this.fills, this.ribbons);
  }

  rebuild(parcels: Iterable<ParcelDTO>, players: Map<string, PlayerDTO>, me: string, selectedId: number) {
    const fp: number[] = [], fc: number[] = [], rp: number[] = [], rc: number[] = [];
    const quad = (pos: number[], col: number[], x0: number, z0: number, x1: number, z1: number, y: number, c: Color, a: number) => {
      pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
      for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b, a);
    };
    const white = new Color(0xffffff);
    for (const p of parcels) {
      const color = new Color(players.get(p.owner)?.color ?? 0xffffff);
      const mine = p.owner === me, selected = p.id === selectedId;
      const x0 = p.x, z0 = p.y, x1 = p.x + p.w, z1 = p.y + p.h;
      quad(fp, fc, x0, z0, x1, z1, 0.012, color, selected ? 0.16 : mine ? 0.09 : 0.045);
      const w = selected ? 0.2 : 0.11, rcol = selected ? white : color, y = 0.025;
      quad(rp, rc, x0 - w, z0 - w, x1 + w, z0 + w, y, rcol, 0.95);
      quad(rp, rc, x0 - w, z1 - w, x1 + w, z1 + w, y, rcol, 0.95);
      quad(rp, rc, x0 - w, z0 + w, x0 + w, z1 - w, y, rcol, 0.95);
      quad(rp, rc, x1 - w, z0 + w, x1 + w, z1 - w, y, rcol, 0.95);
    }
    for (const [mesh, pos, col] of [[this.fills, fp, fc], [this.ribbons, rp, rc]] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new Float32BufferAttribute(col, 4));
      mesh.geometry.dispose();
      mesh.geometry = g;
    }
  }
}
