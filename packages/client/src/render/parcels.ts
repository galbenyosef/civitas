import { Group, Mesh, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Color, DoubleSide } from 'three';
import type { ParcelDTO, PlayerDTO } from '@msimcity/shared';

/** A straight run of an outline: from `a` to `b` along a row (`horiz`, at `at` = y) or a column (at `at` = x). */
export interface OutlineRun { horiz: boolean; at: number; a: number; b: number }
type Rect = { x: number; y: number; w: number; h: number };

/**
 * The outline of the union of non-overlapping rectangles: the stretches of their edges with the union on one side
 * only (a side two rectangles share is inside, not outline), merged into the longest straight runs. Per grid line, a
 * sweep over the edges lying on it: O(n log n).
 */
export function unionOutline(rects: readonly Rect[]): OutlineRun[] {
  const out: OutlineRun[] = [];
  for (const horiz of [true, false]) {
    // per line: [from, to, side] intervals, side 1 for the union on the far side of the line, 2 for the near side
    const lines = new Map<number, [number, number, number][]>();
    const add = (at: number, a: number, b: number, side: number) => { let l = lines.get(at); if (!l) lines.set(at, (l = [])); l.push([a, b, side]); };
    for (const r of rects) {
      if (horiz) { add(r.y, r.x, r.x + r.w, 1); add(r.y + r.h, r.x, r.x + r.w, 2); }
      else { add(r.x, r.y, r.y + r.h, 1); add(r.x + r.w, r.y, r.y + r.h, 2); }
    }
    for (const [at, ivs] of lines) {
      const ev: [number, number][] = [];
      for (const [a, b, side] of ivs) { const bit = side === 1 ? 1 : 1 << 16; ev.push([a, bit], [b, -bit]); }
      ev.sort((p, q) => p[0] - q[0]);
      let cover = 0, start = NaN;
      for (let i = 0; i < ev.length;) {
        const x = ev[i][0];
        for (; i < ev.length && ev[i][0] === x; i++) cover += ev[i][1];
        // outline where exactly one side is covered
        const edge = ((cover & 0xffff) > 0) !== ((cover >> 16) > 0);
        if (edge && Number.isNaN(start)) start = x;
        else if (!edge && !Number.isNaN(start)) { out.push({ horiz, at, a: start, b: x }); start = NaN; }
      }
    }
  }
  return out;
}

/**
 * Ownership overlay: a faint tinted fill per parcel and a solid ribbon round each owner's land, all merged into two
 * meshes with per-vertex RGBA so it is two draw calls. A player's land bought as several rectangles reads as one shape:
 * the ribbon follows the outline of the union of the owner's parcels (`unionOutline`), not each rectangle, so only
 * the edges between owners (and round the land's outside) are drawn. The selected parcel keeps its own white outline.
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
    /** a ribbon `w` either side of each run; rows reach over the corners, columns stop short of them, so no corner is drawn twice */
    const ribbon = (runs: OutlineRun[], w: number, y: number, c: Color) => {
      for (const r of runs) {
        if (r.horiz) quad(rp, rc, r.a - w, r.at - w, r.b + w, r.at + w, y, c, 0.95);
        else quad(rp, rc, r.at - w, r.a + w, r.at + w, r.b - w, y, c, 0.95);
      }
    };
    const byOwner = new Map<string, ParcelDTO[]>();
    let selected: ParcelDTO | null = null;
    const all = [...parcels];
    for (const p of all) {
      const color = new Color(p.color ?? players.get(p.owner)?.color ?? 0xffffff); // a colour given on the world map, else the owner's
      const mine = p.owner === me;
      if (p.id === selectedId) selected = p;
      quad(fp, fc, p.x, p.y, p.x + p.w, p.y + p.h, 0.012, color, p.id === selectedId ? 0.16 : mine ? 0.09 : 0.045);
      let l = byOwner.get(p.owner);
      if (!l) byOwner.set(p.owner, (l = []));
      l.push(p);
    }
    for (const [owner, list] of byOwner) ribbon(unionOutline(list), 0.11, 0.025, new Color(players.get(owner)?.color ?? 0xffffff));
    // the selected parcel, or the whole estate it is in (docs/world-map.md)
    if (selected) { const g = selected.group; ribbon(unionOutline(g === undefined ? [selected] : all.filter((q) => q.group === g)), 0.2, 0.027, new Color(0xffffff)); }
    for (const [mesh, pos, col] of [[this.fills, fp, fc], [this.ribbons, rp, rc]] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new Float32BufferAttribute(col, 4));
      mesh.geometry.dispose();
      mesh.geometry = g;
    }
  }
}
