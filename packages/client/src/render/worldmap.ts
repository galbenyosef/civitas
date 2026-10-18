import {
  Scene, Color, Mesh, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, DataTexture, RGBAFormat, NearestFilter, LinearMipmapLinearFilter,
  DoubleSide, Vector3, type PerspectiveCamera,
} from 'three';
import {
  CHUNK_SIZE, SECTOR_CHUNKS, SECTOR_TILES, MAP_MAX_SECTORS, MapClass, mapClassOf, mapLevelOf, mapBuilding, rleDecode, terrainClass, makeTerrainSampler,
  routeTiles, edgeAdjacent, type ParcelDTO, type PlayerDTO, type LineInfo, type RailLineDTO,
} from '@msimcity/shared';
import { unionOutline, type OutlineRun } from './parcels';

/**
 * The world map's drawing (docs/world-map.md section 1): the ground as textured cells built from the per-sector map
 * summaries the server sends (and the seed's terrain where nobody has built), parcels as owner-coloured fills and
 * union outlines of a constant screen width, transit lines as ribbons, and HTML labels that never overlap. Its own
 * Scene, so the 3D city costs nothing while the map is up. Coordinates are tiles: tile (x, y) is world (x, z = y).
 */

/** Tiles a cell covers per level: L0 a sector at a texel per tile, L1 4×4 sectors at 4 tiles a texel, L2 16×16 sectors at 16. */
const CELL_TILES = [SECTOR_TILES, SECTOR_TILES * 4, SECTOR_TILES * 16];
const RES = 256;
/** cells kept (each a 256² RGBA texture with mipmaps, ~350 KB of GPU memory) */
const CELL_CAP = 160;
/** CPU time per frame for building cell textures, ms */
const BUILD_BUDGET = 6;
const skey = (sx: number, sy: number) => (sx + 0x8000) * 65536 + (sy + 0x8000);

// ---- colours ---------------------------------------------------------------------------------------
const BASE: Record<number, number> = {
  [MapClass.Grass]: 0x7fa35a, [MapClass.Sand]: 0xd9c58f, [MapClass.Water]: 0x3f79a8, [MapClass.Road]: 0x4a4d55, [MapClass.Track]: 0x8a6a4a,
  [MapClass.Airfield]: 0x9a9fa6, [MapClass.Residential]: 0x8cc96c, [MapClass.Commercial]: 0x5c9de0, [MapClass.Industrial]: 0xe0a447,
  [MapClass.Office]: 0x9b7fe0, [MapClass.Civic]: 0xe06464, [MapClass.Transport]: 0x7c8a99, [MapClass.Leisure]: 0x3f8f4f,
};
/** RGB per map byte */
const LUT = new Uint8Array(256 * 3);
{
  const c = new Color(), white = new Color(0xffffff), site = new Color(0xc8b48a);
  for (let b = 0; b < 256; b++) {
    const cls = mapClassOf(b), lvl = mapLevelOf(b);
    c.setHex(BASE[cls] ?? 0xff00ff);
    if (cls >= MapClass.Residential) {
      if (lvl === 0) c.lerp(white, 0.45); // a zoned, empty lot
      else c.multiplyScalar(1.12 - 0.08 * lvl); // taller is darker
      if (mapBuilding(b)) c.lerp(site, 0.45);
    }
    LUT[b * 3] = Math.min(255, Math.round(c.r * 255)); LUT[b * 3 + 1] = Math.min(255, Math.round(c.g * 255)); LUT[b * 3 + 2] = Math.min(255, Math.round(c.b * 255));
  }
}

/** the far view's land: the terrain's colours mixed this much into this tint */
const FAR_TINT = [104, 132, 98], FAR_MIX = 0.35;

interface SectorData { v: number; chunks: Map<number, Uint8Array> }
interface Cell { lvl: number; cx: number; cy: number; mesh: Mesh; tex: DataTexture; data: Uint8Array; built: boolean; row: number; used: number }
export interface MapLabel { text: string; x: number; z: number; w: number; h: number; kind: 'owner' | 'parcel' | 'line'; colour: number; el?: HTMLDivElement }
/** A shape to draw over the parcels: rectangles filled and outlined (selection, combine and split previews). */
export interface MapMark { rects: { x: number; y: number; w: number; h: number }[]; fill?: number; fillA?: number; line?: number; px?: number }

const QUAD_GEO = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
})();

export class MapView {
  readonly scene = new Scene();
  private sampler: (x: number, y: number) => number = () => 0;
  private sectors = new Map<number, SectorData>();
  private cells = new Map<string, Cell>();
  private frameNo = 0;
  /** sectors asked for and when, so a request is not repeated while it is answered */
  private asked = new Map<number, number>();
  private fills = this.vcMesh(10);
  private ribbons = this.vcMesh(11);
  private lineRibbons = this.vcMesh(12);
  private marks = this.vcMesh(13);
  private labelsEl: HTMLDivElement;
  private labels: MapLabel[] = [];
  private labelsDirty = true;
  private lastLayout = '';
  private overlayWpp = 0;
  private overlayDirty = true;
  private parcels: ParcelDTO[] = [];
  private players = new Map<string, PlayerDTO>();
  private selected = new Set<number>();
  private markList: MapMark[] = [];
  private busLines: LineInfo[] = [];
  private railLines: RailLineDTO[] = [];
  private metroLines: RailLineDTO[] = [];
  private tmp = new Vector3();
  /** cell textures built since start and the time they took, ms (docs/world-map.md section 4) */
  stats = { built: 0, ms: 0, cells: 0, drawn: 0, pending: 0 };

  constructor(mount: HTMLElement) {
    this.scene.background = new Color(0x1d232b);
    this.scene.add(this.fills, this.ribbons, this.lineRibbons, this.marks);
    this.labelsEl = document.createElement('div');
    this.labelsEl.id = 'mapLabels';
    this.labelsEl.className = 'hidden';
    mount.prepend(this.labelsEl);
  }

  private vcMesh(order: number) {
    const m = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide, toneMapped: false }));
    m.renderOrder = order;
    m.frustumCulled = false;
    return m;
  }

  /** A new game: the seed's terrain, and nothing known of any sector. */
  reset(seed: number) {
    this.sampler = makeTerrainSampler(seed);
    this.sectors.clear(); this.asked.clear(); this.parcelSig = '';
    for (const c of this.cells.values()) this.dropCell(c);
    this.cells.clear();
  }
  setVisible(on: boolean) { this.labelsEl.classList.toggle('hidden', !on); if (!on) for (const l of this.labels) l.el?.remove(); this.lastLayout = ''; }

  // ---- data ----------------------------------------------------------------------------------------
  /** The map byte of a tile: the server's summary where the chunk was changed, else the terrain the seed makes. */
  byteAt(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE);
    const s = this.sectors.get(skey(Math.floor(cx / SECTOR_CHUNKS), Math.floor(cy / SECTOR_CHUNKS)));
    const ch = s?.chunks.get((cy - Math.floor(cy / SECTOR_CHUNKS) * SECTOR_CHUNKS) * SECTOR_CHUNKS + (cx - Math.floor(cx / SECTOR_CHUNKS) * SECTOR_CHUNKS));
    if (ch) return ch[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)];
    return terrainClass(this.sampler(x, y));
  }
  isWater(x: number, y: number) { return mapClassOf(this.byteAt(x, y)) === MapClass.Water; }

  /** A 'mapSector' answer. Cells over it are rebuilt when what it holds changed. */
  applySector(sx: number, sy: number, v: number, c: [number, number, string][]) {
    const k = skey(sx, sy), old = this.sectors.get(k);
    const chunks = new Map<number, Uint8Array>();
    for (const [cx, cy, d] of c) {
      const b = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
      if (rleDecode(d, b)) chunks.set((cy - sy * SECTOR_CHUNKS) * SECTOR_CHUNKS + (cx - sx * SECTOR_CHUNKS), b);
    }
    this.sectors.set(k, { v, chunks });
    if (!old?.chunks.size && !chunks.size) return; // untouched land, as already drawn from the seed
    const x0 = sx * SECTOR_TILES, y0 = sy * SECTOR_TILES;
    for (const cell of this.cells.values()) {
      const T = CELL_TILES[cell.lvl];
      if (cell.cx * T <= x0 && x0 < (cell.cx + 1) * T && cell.cy * T <= y0 && y0 < (cell.cy + 1) * T) cell.row = 0; // rebuild, the old texture shows meanwhile
    }
  }
  /** The 'map' request for these sectors: flat [sx, sy, version held], at most MAP_MAX_SECTORS of those not asked lately. */
  request(sx0: number, sy0: number, sx1: number, sy1: number, now: number, refreshMs: number): number[] {
    const out: number[] = [];
    const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;
    const list: [number, number, number][] = [];
    for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) list.push([sx, sy, Math.hypot(sx - cx, sy - cy)]);
    list.sort((a, b) => a[2] - b[2]);
    for (const [sx, sy] of list) {
      const k = skey(sx, sy), at = this.asked.get(k), have = this.sectors.get(k);
      if (at !== undefined && now - at < (have ? refreshMs : 4000)) continue; // asked lately: an unchanged sector gets no answer
      this.asked.set(k, now);
      out.push(sx, sy, have?.v ?? 0);
      if (out.length >= MAP_MAX_SECTORS * 3) break;
    }
    return out;
  }

  /** The parcels and owners; redrawn only when what is drawn changed (a parcels message mostly carries new stats). */
  setParcels(parcels: Iterable<ParcelDTO>, players: Map<string, PlayerDTO>) {
    this.parcels = [...parcels]; this.players = players;
    let sig = '';
    for (const p of this.parcels) sig += `${p.id},${p.owner},${p.name},${p.x},${p.y},${p.w},${p.h},${p.group},${p.color};`;
    for (const o of new Set(this.parcels.map((p) => p.owner))) { const pl = players.get(o); sig += `${o}=${pl?.name},${pl?.color};`; }
    if (sig === this.parcelSig) return;
    this.parcelSig = sig;
    this.outlines = null;
    this.overlayDirty = true; this.labelsDirty = true;
  }
  private parcelSig = '';
  setSelection(ids: Iterable<number>, marks: MapMark[]) {
    const sel = [...ids], sig = JSON.stringify([sel, marks]);
    if (sig === this.selSig) return;
    this.selSig = sig;
    this.selected = new Set(sel); this.markList = marks; this.overlayDirty = true;
  }
  private selSig = '';
  setBusLines(l: LineInfo[]) { this.busLines = l.filter((x) => x.mode === 'bus'); this.linesChanged(); }
  setRailLines(l: RailLineDTO[]) { this.railLines = l; this.linesChanged(); }
  setMetroLines(l: RailLineDTO[]) { this.metroLines = l; this.linesChanged(); }
  /** every line's path (flat tile x, y) with its label and colour, worked out once per lines message */
  private linePaths: { text: string; pts: number[]; colour: number }[] = [];
  private linesChanged() {
    const rail = (l: RailLineDTO) => {
      if (!l.route) return l.stations.flat();
      const t = routeTiles(l.route), pts: number[] = [];
      for (const q of t) pts.push(q.x, q.y);
      if (l.route.loop && t.length) pts.push(t[0].x, t[0].y);
      return pts;
    };
    this.linePaths = [
      ...this.busLines.map((l) => ({ text: l.name || `Bus ${l.number}`, pts: l.path?.length ? l.path : l.stops.flatMap((s) => [s.x, s.y]), colour: l.colour })),
      ...this.railLines.map((l) => ({ text: l.name || `${l.freight ? 'Freight' : 'Rail'} ${l.number}`, pts: rail(l), colour: l.color })),
      ...this.metroLines.map((l) => ({ text: `${l.name || `Line ${l.number}`} (underground)`, pts: rail(l), colour: l.color })),
    ];
    this.overlayDirty = true; this.labelsDirty = true;
  }
  /** outlines of each estate or lone parcel, and of each owner's land, worked out when the parcels change (not with the zoom) */
  private outlines: { shapes: OutlineRun[][]; owners: { colour: number; runs: OutlineRun[] }[] } | null = null;

  // ---- per frame -------------------------------------------------------------------------------------
  /** The ground area in view, in tiles (a top-down camera: the view's half extents round the target, a little over). */
  view(cam: PerspectiveCamera, tx: number, tz: number, dist: number) {
    const hh = dist * Math.tan((cam.fov * Math.PI) / 360) * 1.08, hw = hh * cam.aspect;
    return { x0: tx - hw, x1: tx + hw, z0: tz - hh, z1: tz + hh };
  }
  frame(cam: PerspectiveCamera, tx: number, tz: number, dist: number, wpp: number, vw: number, vh: number) {
    this.frameNo++;
    const v = this.view(cam, tx, tz, dist);
    if (![v.x0, v.x1, v.z0, v.z1].every(Number.isFinite)) return; // no sane view yet
    const want = wpp < 1 ? 0 : wpp < 4 ? 1 : 2;
    const needed: Cell[] = [];
    for (let lvl = 2; lvl >= want; lvl--) {
      const T = CELL_TILES[lvl];
      if ((Math.floor(v.x1 / T) - Math.floor(v.x0 / T) + 1) * (Math.floor(v.z1 / T) - Math.floor(v.z0 / T) + 1) > 80) continue; // too fine for this view: the coarser level shows
      for (let cy = Math.floor(v.z0 / T); cy <= Math.floor(v.z1 / T); cy++) for (let cx = Math.floor(v.x0 / T); cx <= Math.floor(v.x1 / T); cx++) {
        const key = `${lvl}:${cx},${cy}`;
        let c = this.cells.get(key);
        if (!c) { c = this.makeCell(lvl, cx, cy); this.cells.set(key, c); }
        c.used = this.frameNo;
        needed.push(c);
      }
    }
    let drawn = 0;
    for (const c of this.cells.values()) { c.mesh.visible = c.used === this.frameNo && c.built; if (c.mesh.visible) drawn++; }
    this.stats.drawn = drawn; this.stats.cells = this.cells.size;
    // build: coarse levels first (one L2 cell is a backdrop for the whole view), nearest the centre first
    const todo = needed.filter((c) => c.row >= 0).sort((a, b) => b.lvl - a.lvl || dist2(a, tx, tz) - dist2(b, tx, tz));
    this.stats.pending = todo.length;
    const t0 = performance.now();
    for (const c of todo) {
      while (c.row >= 0 && performance.now() - t0 < BUILD_BUDGET) this.buildRows(c, 4);
      if (performance.now() - t0 >= BUILD_BUDGET) break;
    }
    this.stats.ms += performance.now() - t0;
    if (this.cells.size > CELL_CAP) {
      const old = [...this.cells.values()].filter((c) => c.used !== this.frameNo).sort((a, b) => a.used - b.used);
      for (const c of old.slice(0, this.cells.size - CELL_CAP)) { this.dropCell(c); this.cells.delete(`${c.lvl}:${c.cx},${c.cy}`); }
    }
    if (this.overlayDirty || Math.abs(Math.log(wpp / (this.overlayWpp || 1))) > 0.14) { this.buildOverlay(wpp); this.overlayWpp = wpp; this.overlayDirty = false; }
    this.layoutLabels(cam, wpp, vw, vh);
  }

  private makeCell(lvl: number, cx: number, cy: number): Cell {
    const data = new Uint8Array(RES * RES * 4);
    const tex = new DataTexture(data, RES, RES, RGBAFormat);
    tex.magFilter = NearestFilter; tex.minFilter = LinearMipmapLinearFilter; tex.generateMipmaps = true;
    const mesh = new Mesh(QUAD_GEO, new MeshBasicMaterial({ map: tex, depthTest: false, depthWrite: false, side: DoubleSide, toneMapped: false }));
    const T = CELL_TILES[lvl];
    mesh.position.set(cx * T, 0, cy * T);
    mesh.scale.set(T, 1, T);
    mesh.renderOrder = 2 - lvl; // finer cells over coarser
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);
    return { lvl, cx, cy, mesh, tex, data, built: false, row: 0, used: this.frameNo };
  }
  private dropCell(c: Cell) { this.scene.remove(c.mesh); c.tex.dispose(); (c.mesh.material as MeshBasicMaterial).dispose(); }

  /** Fill `n` texel rows of a cell; on the last row the texture is uploaded. */
  private buildRows(c: Cell, n: number) {
    const T = CELL_TILES[c.lvl], s = T / RES, x0 = c.cx * T, y0 = c.cy * T, d = c.data;
    const end = Math.min(RES, c.row + n);
    const span = CHUNK_SIZE / s; // texels per chunk (s is at most 16, so a texel never straddles chunks)
    for (let r = c.row; r < end; r++) {
      const ty = y0 + r * s;
      const cyy = Math.floor(ty / CHUNK_SIZE), syy = Math.floor(cyy / SECTOR_CHUNKS), ly = ty - cyy * CHUNK_SIZE;
      for (let q0 = 0; q0 < RES; q0 += span) {
        // one chunk's worth of texels: its summary looked up once
        const cxx = Math.floor((x0 + q0 * s) / CHUNK_SIZE), sxx = Math.floor(cxx / SECTOR_CHUNKS);
        const ch = this.sectors.get(skey(sxx, syy))?.chunks.get((cyy - syy * SECTOR_CHUNKS) * SECTOR_CHUNKS + (cxx - sxx * SECTOR_CHUNKS));
        for (let q = q0; q < q0 + span; q++) {
          const tx = x0 + q * s, o = (r * RES + q) * 4;
          if (!ch) {
            if (c.lvl < 2) { const b = terrainClass(this.sampler(tx + (s >> 1), ty + (s >> 1))) * 3; d[o] = LUT[b]; d[o + 1] = LUT[b + 1]; d[o + 2] = LUT[b + 2]; d[o + 3] = 255; continue; }
            // far out, four samples averaged, so lakes smaller than a texel read as a tint, not speckle
            let rr = 0, gg = 0, bb = 0;
            for (let k = 0; k < 4; k++) {
              const b = terrainClass(this.sampler(tx + ((k & 1) * 2 + 1) * (s >> 2), ty + ((k >> 1) * 2 + 1) * (s >> 2))) * 3;
              rr += LUT[b]; gg += LUT[b + 1]; bb += LUT[b + 2];
            }
            // far out the land is muted towards one tint (the lakes are smaller than a few pixels), so what people built stands out
            d[o] = (rr / 4) * FAR_MIX + FAR_TINT[0] * (1 - FAR_MIX); d[o + 1] = (gg / 4) * FAR_MIX + FAR_TINT[1] * (1 - FAR_MIX); d[o + 2] = (bb / 4) * FAR_MIX + FAR_TINT[2] * (1 - FAR_MIX); d[o + 3] = 255;
            continue;
          }
          const lx = tx - cxx * CHUNK_SIZE;
          if (s === 1) { const b = ch[ly * CHUNK_SIZE + lx] * 3; d[o] = LUT[b]; d[o + 1] = LUT[b + 1]; d[o + 2] = LUT[b + 2]; d[o + 3] = 255; continue; }
          let rr = 0, gg = 0, bb = 0;
          for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const b = ch[(ly + j) * CHUNK_SIZE + lx + i] * 3; rr += LUT[b]; gg += LUT[b + 1]; bb += LUT[b + 2]; }
          const k = s * s;
          d[o] = rr / k; d[o + 1] = gg / k; d[o + 2] = bb / k; d[o + 3] = 255;
        }
      }
    }
    c.row = end >= RES ? -1 : end;
    if (c.row < 0) { c.tex.needsUpdate = true; c.built = true; this.stats.built++; }
  }

  // ---- overlays: parcels, lines, selection and previews ----------------------------------------------
  private buildOverlay(wpp: number) {
    const fp: number[] = [], fc: number[] = [], rp: number[] = [], rc: number[] = [], lp: number[] = [], lc: number[] = [], mp: number[] = [], mc: number[] = [];
    const col = new Color();
    const quad = (pos: number[], cols: number[], x0: number, z0: number, x1: number, z1: number, c: Color, a: number) => {
      pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
      for (let i = 0; i < 6; i++) cols.push(c.r, c.g, c.b, a);
    };
    const ribbon = (pos: number[], cols: number[], runs: OutlineRun[], w: number, c: Color, a: number) => {
      for (const r of runs) {
        if (r.horiz) quad(pos, cols, r.a - w, r.at - w, r.b + w, r.at + w, c, a);
        else quad(pos, cols, r.at - w, r.a + w, r.at + w, r.b - w, c, a);
      }
    };
    const colourOf = (owner: string) => this.players.get(owner)?.color ?? 0xffffff;
    // fills, in the parcel's own colour or its owner's
    for (const p of this.parcels) {
      col.setHex(p.color ?? colourOf(p.owner));
      quad(fp, fc, p.x, p.y, p.x + p.w, p.y + p.h, col, this.selected.has(p.id) ? 0.42 : 0.24);
    }
    if (!this.outlines) {
      const byOwner = new Map<string, ParcelDTO[]>(), byShape = new Map<string, ParcelDTO[]>();
      for (const p of this.parcels) {
        let l = byOwner.get(p.owner); if (!l) byOwner.set(p.owner, (l = [])); l.push(p);
        const shape = p.group !== undefined ? `g${p.group}` : `p${p.id}`;
        let s = byShape.get(shape); if (!s) byShape.set(shape, (s = [])); s.push(p);
      }
      this.outlines = { shapes: [...byShape.values()].map((l) => unionOutline(l)), owners: [...byOwner].map(([o, l]) => ({ colour: colourOf(o), runs: unionOutline(l) })) };
    }
    // between one owner's estates and lone parcels a thin dark line, round each owner's land a ribbon in its colour
    const thin = Math.max(0.06, wpp * 0.7), thick = Math.max(0.12, wpp * 1.6);
    col.setHex(0x111418);
    for (const runs of this.outlines.shapes) ribbon(rp, rc, runs, thin, col, 0.55);
    for (const o of this.outlines.owners) { col.setHex(o.colour); ribbon(rp, rc, o.runs, thick, col, 0.95); }
    // selected parcels and their estates: white
    const sel = this.parcels.filter((p) => this.selected.has(p.id));
    if (sel.length) {
      const groups = new Set(sel.map((p) => p.group).filter((g) => g !== undefined));
      const estate = this.parcels.filter((p) => p.group !== undefined && groups.has(p.group) && !this.selected.has(p.id));
      col.setHex(0xffffff);
      if (estate.length) ribbon(rp, rc, unionOutline([...sel, ...estate]), thick, col, 0.7);
      for (const p of sel) ribbon(rp, rc, unionOutline([p]), thick * 1.1, col, 1);
    }
    // previews
    for (const m of this.markList) {
      if (m.fill !== undefined) { col.setHex(m.fill); for (const r of m.rects) quad(mp, mc, r.x, r.y, r.x + r.w, r.y + r.h, col, m.fillA ?? 0.4); }
      if (m.line !== undefined) { col.setHex(m.line); ribbon(mp, mc, unionOutline(m.rects), Math.max(0.1, wpp * (m.px ?? 2)), col, 1); }
    }
    // transit lines
    const lw = Math.max(0.12, wpp * 1.8);
    const path = (pts: number[], c: number) => {
      col.setHex(c);
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i] + 0.5, az = pts[i + 1] + 0.5, bx = pts[i + 2] + 0.5, bz = pts[i + 3] + 0.5;
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        const nx = (-dz / len) * lw, nz = (dx / len) * lw, ex = (dx / len) * lw, ez = (dz / len) * lw;
        lp.push(ax - nx - ex, 0, az - nz - ez, bx - nx + ex, 0, bz - nz + ez, bx + nx + ex, 0, bz + nz + ez, ax - nx - ex, 0, az - nz - ez, bx + nx + ex, 0, bz + nz + ez, ax + nx - ex, 0, az + nz - ez);
        for (let k = 0; k < 6; k++) lc.push(col.r, col.g, col.b, 0.9);
      }
    };
    for (const l of this.linePaths) path(l.pts, l.colour);
    for (const [mesh, pos, cols] of [[this.fills, fp, fc], [this.ribbons, rp, rc], [this.lineRibbons, lp, lc], [this.marks, mp, mc]] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new Float32BufferAttribute(cols, 4));
      mesh.geometry.dispose();
      mesh.geometry = g;
    }
  }

  // ---- labels ---------------------------------------------------------------------------------------------
  private buildLabels() {
    for (const l of this.labels) l.el?.remove();
    const out: MapLabel[] = [];
    const nameOf = (owner: string) => this.players.get(owner)?.name ?? owner;
    // each owner's land in joined-up clusters: the owner's name over each (the districts of a sample city are its boroughs)
    const byOwner = new Map<string, ParcelDTO[]>();
    for (const p of this.parcels) { let l = byOwner.get(p.owner); if (!l) byOwner.set(p.owner, (l = [])); l.push(p); }
    for (const [owner, list] of byOwner) {
      const seen = new Set<number>();
      for (const p of list) {
        if (seen.has(p.id)) continue;
        const cl = [p]; seen.add(p.id);
        for (let i = 0; i < cl.length; i++) for (const q of list) if (!seen.has(q.id) && edgeAdjacent(cl[i], q)) { seen.add(q.id); cl.push(q); }
        const b = bbox(cl);
        out.push({ text: nameOf(owner), x: b.x + b.w / 2, z: b.y + b.h / 2, w: b.w, h: b.h, kind: 'owner', colour: this.players.get(owner)?.color ?? 0xffffff });
      }
    }
    // estates and lone parcels: their name, over their biggest rectangle
    const shapes = new Map<string, ParcelDTO[]>();
    for (const p of this.parcels) { const k = p.group !== undefined ? `g${p.group}` : `p${p.id}`; let l = shapes.get(k); if (!l) shapes.set(k, (l = [])); l.push(p); }
    for (const list of shapes.values()) {
      const big = list.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
      const b = bbox(list);
      out.push({ text: big.name, x: big.x + big.w / 2, z: big.y + big.h / 2, w: b.w, h: b.h, kind: 'parcel', colour: big.color ?? this.players.get(big.owner)?.color ?? 0xffffff });
    }
    // lines: their number or name, at the middle of the route
    const lineLabel = (text: string, pts: number[], colour: number) => {
      if (pts.length < 2) return;
      const n = pts.length >> 1, m = (n >> 1) * 2;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      out.push({ text, x: pts[m] + 0.5, z: pts[m + 1] + 0.5, w: x1 - x0 + 1, h: y1 - y0 + 1, kind: 'line', colour });
    };
    for (const l of this.linePaths) lineLabel(l.text, l.pts, l.colour);
    for (const l of out) {
      const el = document.createElement('div');
      el.className = `mlabel ${l.kind}`;
      el.textContent = l.text;
      el.style.setProperty('--c', '#' + l.colour.toString(16).padStart(6, '0'));
      l.el = el;
    }
    this.labels = out;
    this.lastLayout = '';
  }

  /**
   * Place labels where they fit: owners' names first when zoomed far out (a cluster smaller than the name hides it),
   * then lines, then estates and parcels by size, each only where it covers none already placed.
   */
  private layoutLabels(cam: PerspectiveCamera, wpp: number, vw: number, vh: number) {
    if (this.labelsDirty) { this.buildLabels(); this.labelsDirty = false; }
    const sig = `${cam.position.x.toFixed(2)},${cam.position.y.toFixed(2)},${cam.position.z.toFixed(2)},${wpp.toFixed(4)},${vw},${vh}`;
    if (sig === this.lastLayout) return;
    this.lastLayout = sig;
    cam.updateMatrixWorld(); // the rig moved the camera this frame; the render that updates its matrices comes after
    const far = wpp > 1.2;
    // owners first (far out every owner's name, nearer only where their land has room for it), then lines, then estates and
    // parcels by size; a parcel name already shown is not repeated (sample cities name several parcels after one area)
    const rank = (l: MapLabel) => (l.kind === 'owner' ? 0 : l.kind === 'line' ? 1 : 2) * 1e9 - l.w * l.h;
    const order = [...this.labels].sort((a, b) => rank(a) - rank(b));
    const taken: [number, number, number, number][] = [];
    const said = new Set<string>();
    let shown = 0;
    for (const l of order) {
      const el = l.el!;
      const tw = l.text.length * (l.kind === 'owner' ? 7.4 : 6.4) + 14, th = l.kind === 'owner' ? 22 : 18;
      const sw = l.w / wpp, sh = l.h / wpp; // its size on screen
      let ok = shown < 160 && (l.kind === 'owner' ? far || (sw > tw * 1.3 && sh > 40) : l.kind === 'line' ? Math.max(sw, sh) > 60 : !far && sw > tw * 0.8 && sh > 14 && !said.has(l.text));
      let px = 0, py = 0;
      if (ok) {
        this.tmp.set(l.x, 0, l.z).project(cam);
        px = ((this.tmp.x + 1) / 2) * vw; py = ((1 - this.tmp.y) / 2) * vh;
        ok = px > -40 && px < vw + 40 && py > 40 && py < vh + 10;
      }
      if (ok) {
        const box: [number, number, number, number] = [px - tw / 2, py - th / 2, px + tw / 2, py + th / 2];
        ok = !taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]);
        if (ok) taken.push(box);
      }
      if (ok) {
        if (l.kind === 'parcel') said.add(l.text);
        if (!el.isConnected) this.labelsEl.appendChild(el);
        el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%)`;
        shown++;
      } else if (el.isConnected) el.remove();
    }
  }
}

const dist2 = (c: Cell, tx: number, tz: number) => { const T = CELL_TILES[c.lvl]; return (c.cx * T + T / 2 - tx) ** 2 + (c.cy * T + T / 2 - tz) ** 2; };
function bbox(list: readonly { x: number; y: number; w: number; h: number }[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of list) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
