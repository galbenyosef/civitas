import { BufferGeometry, BufferAttribute, Float32BufferAttribute, Uint16BufferAttribute, Mesh, Group, Color, Matrix4, Vector3, Quaternion, Material } from 'three';
import {
  CHUNK_SIZE, MANIFEST, Terrain, Zone, terrainOf, isRoad, zoneOf, levelOf, underConstruction, progressOf, priorityOf, hash2, kindIdOf,
  isPartAux, isAnchorAux, partDx, partDy, auxOrientation, isMultiTile, placedFromAnchor, footprintOf, type Placed,
  isAirfieldAux, airfieldOrientation, airfieldRow, FRONT, isRailAux, railMask,
  isRingAux, ringPos, isArmPos, isIslandAux, isFlyoverAux, deckEW, RING_POS,
  isBridgeAux, bridgeNS, bridgeStyle, BridgeStyle, KIND_ID,
} from '@msimcity/shared';
import type { ClientChunk } from '../world';
import { Cell, cellUV } from './atlas';
import { variant } from './models';
import type { Buildings, Placement } from './buildings';

const N = CHUNK_SIZE * CHUNK_SIZE;
// empty-lot ground tint and facade tints per kind id, from the building catalogue (shared/src/buildings)
const ZONE_TINT: Record<number, Color> = Object.fromEntries(MANIFEST.filter((k) => k.lotTint !== undefined).map((k) => [k.kindId, new Color(k.lotTint)]));
const WHITE = new Color(0xffffff);
// facade tints per kind: houses pastel, the rest subtle so glass and roofs keep their colour
const FACADE_TINT: Record<number, Color[]> = Object.fromEntries(MANIFEST.filter((k) => k.tints?.length).map((k) => [k.kindId, k.tints!.map((c) => new Color(c))]));
const CONCRETE = new Color(0x8e939b);
// crane tint by build priority: paused, low, normal, high, urgent
const CRANE_TINT = [new Color(0x55596a), new Color(0xb5aa88), new Color(0xffffff), new Color(0xffa060), new Color(0xff6a5a)];
const UP = new Vector3(0, 1, 0);
/** a bascule bridge span is drawn as the Tower Bridge landmark (render/bridges.ts draws its ramps) */
const TOWER_BRIDGE_KIND = KIND_ID['tower-bridge'];

const tmpC = new Color();
let heatEnabled = false;
const tmpQ = new Quaternion();
const tmpP = new Vector3();
const tmpS = new Vector3();

/**
 * Which atlas cell an airfield tile (runway, shoulder or taxiway row, shared/src/airport.ts) shows, and how the
 * cell's own frame (x along the runway, y across it) is mirrored onto the tile. Ends and the touchdown zone are found
 * by looking along the runway for the same row's bytes; an unloaded neighbour reads as the end until it arrives.
 */
function airfieldCell(a: number, x: number, z: number, auxAt: (x: number, y: number) => number): { cell: number; flipA: boolean; flipB: boolean } {
  const o = airfieldOrientation(a), k = airfieldRow(a);
  const ax = o & 1 ? 0 : 1, az = o & 1 ? 1 : 0;
  const run = (d: number) => { let n = 0; while (n < 3 && auxAt(x + ax * d * (n + 1), z + az * d * (n + 1)) === a) n++; return n; };
  const lo = run(-1), hi = run(1);
  const end = lo === 0 || hi === 0;
  const flipA = lo !== 0 && hi === 0; // the high end: the cell's outer end (x = 0) points along +axis
  const tdz = (lo >= 1 && lo <= 2) || (hi >= 1 && hi <= 2);
  switch (k) {
    case 0: return { cell: end ? Cell.ShoulderEndFar : Cell.Shoulder, flipA, flipB: true };
    case 1: return { cell: end ? Cell.RwyEnd : tdz ? Cell.RwyTdz : Cell.Rwy, flipA, flipB: false };
    case 2: return { cell: end ? Cell.ShoulderEndNear : Cell.Shoulder, flipA, flipB: false };
    case 3: return { cell: end ? Cell.TaxiInnerEnd : Cell.TaxiInner, flipA, flipB: false };
    case 4: return { cell: end ? Cell.TaxiCentreEnd : Cell.TaxiCentre, flipA, flipB: false };
    default: return { cell: Cell.TaxiOuter, flipA, flipB: false };
  }
}

/**
 * One chunk = one textured, vertex-tinted ground mesh (1024 quads, UVs into
 * the atlas, roads auto-tiled from their neighbours) plus a list of building
 * placements handed to the shared BatchedMesh.
 */
export class ChunkView {
  group = new Group();
  private geo = new BufferGeometry();
  private colors = new Float32Array(N * 4 * 3);
  private uvs = new Float32Array(N * 4 * 2);
  private roads = new Float32Array(N * 4);
  private heats = new Float32Array(N * 4);

  constructor(public cx: number, public cy: number, groundMaterial: Material) {
    const pos = new Float32Array(N * 4 * 3);
    const normal = new Float32Array(N * 4 * 3);
    const idx = new Uint16Array(N * 6);
    const x0 = cx * CHUNK_SIZE, z0 = cy * CHUNK_SIZE;
    for (let i = 0; i < N; i++) {
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      const v = i * 4;
      const corners = [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]];
      for (let k = 0; k < 4; k++) {
        pos[(v + k) * 3] = corners[k][0]; pos[(v + k) * 3 + 1] = 0; pos[(v + k) * 3 + 2] = corners[k][1];
        normal[(v + k) * 3 + 1] = 1;
      }
      idx.set([v, v + 2, v + 1, v, v + 3, v + 2], i * 6);
    }
    this.geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('normal', new Float32BufferAttribute(normal, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geo.setAttribute('uv', new BufferAttribute(this.uvs, 2));
    this.geo.setAttribute('aRoad', new BufferAttribute(this.roads, 1));
    this.geo.setAttribute('aHeat', new BufferAttribute(this.heats, 1));
    this.geo.setIndex(new Uint16BufferAttribute(idx, 1));
    const ground = new Mesh(this.geo, groundMaterial);
    ground.matrixAutoUpdate = false;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  rebuild(chunk: ClientChunk, key: string, getTile: (x: number, y: number) => number | undefined, buildings: Buildings, auxAt: (x: number, y: number) => number = () => 0) {
    const x0 = this.cx * CHUNK_SIZE, z0 = this.cy * CHUNK_SIZE;
    const items: Placement[] = [];
    const roadAt = (x: number, z: number) => { const t = getTile(x, z); return t === undefined ? true : isRoad(t); }; // unknown neighbour: assume the road continues

    for (let i = 0; i < N; i++) {
      const t = chunk.tiles[i];
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      // code: the family code (ground cells by family); kind: the kind id (model, tints, footprint), docs/sub-kinds.md
      const code = zoneOf(t), level = levelOf(t), road = isRoad(t), uc = underConstruction(t);
      const building = code !== Zone.None && !road;
      const kind = building ? kindIdOf(code, chunk.sub[i]) : 0;
      // multi-tile structures (aux layer): every tile is styled from the anchor's hash so the pad looks like one
      // lot; the anchor draws the one model, parts draw ground only
      const a = building ? chunk.aux[i] : 0;
      let sx = x, sz = z, part = false, anchor: Placed | null = null;
      if (a && isPartAux(a)) { part = true; sx = x - partDx(a); sz = z - partDy(a); }
      else if (a && isAnchorAux(a) && isMultiTile(kind)) anchor = placedFromAnchor(kind, x, z, auxOrientation(a));
      const h = hash2(sx, sz), h2 = hash2(sz * 3 + 1, sx * 5 + 7), pick = hash2(sx * 13 + 5, sz * 17 + 11);

      // ---- ground cell + tint
      let cell: number;
      tmpC.setScalar(0.92 + 0.16 * h);
      const mask = (roadAt(x, z - 1) ? 1 : 0) | (roadAt(x + 1, z) ? 2 : 0) | (roadAt(x, z + 1) ? 4 : 0) | (roadAt(x - 1, z) ? 8 : 0);
      // a bridge deck (shared/src/bridges.ts) is drawn over open water by render/bridges.ts, with its own lamps: no lamp
      // pools from the ground shader on it or on the water round it
      const deck = road && terrainOf(t) === Terrain.Water;
      const deckAt = (dx: number, dz: number) => { const q = getTile(x + dx, z + dz); return q !== undefined && isRoad(q) && terrainOf(q) === Terrain.Water; };
      const lampMask = mask & ~((deckAt(0, -1) ? 1 : 0) | (deckAt(1, 0) ? 2 : 0) | (deckAt(0, 1) ? 4 : 0) | (deckAt(-1, 0) ? 8 : 0));
      this.roads.fill(deck ? 0 : (road ? 16 : 0) | lampMask, i * 4, i * 4 + 4); // lets the shader place street lamps on this and neighbouring road tiles
      let turn = 0; // quarter turns anticlockwise of a roundabout cell
      if (deck) {
        cell = Cell.Water;
        tmpC.setScalar(0.96 + 0.08 * h);
        const ba = chunk.aux[i];
        if (isBridgeAux(ba) && bridgeStyle(ba) === BridgeStyle.Bascule && auxAt(x - (bridgeNS(ba) ? 0 : 1), z - (bridgeNS(ba) ? 1 : 0)) !== ba) this.bascule(items, x, z, ba, auxAt);
      } else if (road) {
        cell = Cell.Road + mask;
        tmpC.setScalar(0.97 + 0.06 * h);
        // roundabouts and flyovers (shared/src/junctions.ts): the ring's own cells turned to face the island; a flyover shows the road beneath
        const ja = chunk.aux[i];
        if (ja && isRingAux(ja)) {
          const p = ringPos(ja);
          cell = !isArmPos(p) ? Cell.RingCorner : roadAt(x + RING_POS[p][0], z + RING_POS[p][1]) ? Cell.RingArm : Cell.RingSide;
          turn = p >> 1;
        } else if (ja && isFlyoverAux(ja)) cell = Cell.Road + (deckEW(ja) ? 5 : 10);
        else if (ja && isRailAux(ja)) { cell = Cell.Crossing; turn = railMask(ja) === 10 ? 1 : 0; } // a level crossing (shared/src/rail.ts)
      } else if (building && terrainOf(t) === Terrain.Water) {
        // a harbour's wet rows (docs/boats.md section 5): open water under the pontoons and quays the model draws
        cell = Cell.Water;
        tmpC.setScalar(0.96 + 0.08 * h);
      } else if (building) {
        if (code === Zone.Parking) { cell = Cell.Pavement; tmpC.setScalar(0.62 + 0.06 * h); }
        else if (code === Zone.Yard || (uc && level === 0)) cell = Cell.Dirt;
        else if (level > 0) { cell = Cell.Pavement; tmpC.setScalar(0.95 + 0.1 * h); }
        else { cell = Cell.Lot; tmpC.copy(WHITE).lerp(ZONE_TINT[kind] ?? WHITE, 0.55); }
      } else {
        const terr = terrainOf(t);
        cell = terr === Terrain.Water ? Cell.Water : terr === Terrain.Sand ? Cell.Sand : Cell.Grass;
        if (terr === Terrain.Water) tmpC.setScalar(0.96 + 0.08 * h);
      }
      const af = !road && !building ? chunk.aux[i] : 0;
      if (af && isAirfieldAux(af)) {
        const r = airfieldCell(af, x, z, auxAt);
        this.orientedUV(i, r.cell, airfieldOrientation(af), r.flipA, r.flipB);
        tmpC.setScalar(0.97 + 0.05 * h);
        for (let k = 0; k < 4; k++) tmpC.toArray(this.colors, (i * 4 + k) * 3);
        continue;
      }
      if (af && isRailAux(af)) { cell = Cell.Rail + railMask(af); tmpC.setScalar(0.95 + 0.08 * h); } // railway track (shared/src/rail.ts)
      if (af && isIslandAux(af)) cell = Cell.Island; // a roundabout's island (render/junctions.ts plants it)
      const [u0, v0, u1, v1] = cellUV(cell);
      const uvi = i * 8;
      this.uvs[uvi] = u0; this.uvs[uvi + 1] = v1;       // (x, z)       top-left of the cell
      this.uvs[uvi + 2] = u1; this.uvs[uvi + 3] = v1;   // (x+1, z)
      this.uvs[uvi + 4] = u1; this.uvs[uvi + 5] = v0;   // (x+1, z+1)
      this.uvs[uvi + 6] = u0; this.uvs[uvi + 7] = v0;   // (x, z+1)
      if (turn) this.turnUV(i, turn);
      for (let k = 0; k < 4; k++) tmpC.toArray(this.colors, (i * 4 + k) * 3);
      if (!building || part) continue;
      if (anchor) { this.structure(items, anchor, t, h2, pick); continue; }

      // ---- buildings: face the road, jitter a little, rise while under construction
      let yaw: number;
      if (roadAt(x, z + 1) && getTile(x, z + 1) !== undefined) yaw = 0;
      else if (roadAt(x + 1, z) && getTile(x + 1, z) !== undefined) yaw = Math.PI / 2;
      else if (roadAt(x - 1, z) && getTile(x - 1, z) !== undefined) yaw = -Math.PI / 2;
      else if (roadAt(x, z - 1) && getTile(x, z - 1) !== undefined) yaw = Math.PI;
      else yaw = Math.floor(h * 4) * (Math.PI / 2);
      const s = 0.95 + 0.1 * h2;
      tmpP.set(x + 0.5, 0, z + 0.5);
      if (level > 0) {
        const v = variant(kind, level, pick);
        if (v) {
          tmpQ.setFromAxisAngle(UP, yaw); tmpS.set(s, s, s);
          const palette = FACADE_TINT[kind];
          const tint = palette ? palette[Math.floor(h2 * palette.length)].clone() : new Color(WHITE);
          items.push({ key: v.key, matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: tint.multiplyScalar(0.9 + 0.2 * hash2(x * 7 + 3, z)), sign: { kind, x, y: z, r: Math.round(yaw / (Math.PI / 2)) & 3 } });
          if (uc) {
            tmpP.y = v.height * s; tmpQ.setFromAxisAngle(UP, Math.floor(h2 * 4) * (Math.PI / 2)); tmpS.set(1, 1, 1);
            items.push({ key: 'crane', matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: CRANE_TINT[priorityOf(t) + 2] });
          }
        }
      } else if (uc) {
        const v = variant(kind, 1, pick); // the shell that rises is the design that will stand there
        if (v) {
          const p = (progressOf(t) + 0.5) / 4;
          tmpQ.setFromAxisAngle(UP, yaw); tmpS.set(s, s * (0.06 + 0.94 * p), s);
          items.push({ key: v.key, matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: CONCRETE });
          tmpQ.identity(); tmpS.set(1, 1, 1);
          items.push({ key: 'site', matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: WHITE });
          tmpQ.setFromAxisAngle(UP, Math.floor(h2 * 4) * (Math.PI / 2));
          items.push({ key: 'crane', matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: CRANE_TINT[priorityOf(t) + 2] });
        }
      }
    }
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.aRoad.needsUpdate = true;
    this.tintRoads();
    buildings.setChunk(key, items);
  }

  /**
   * One model over a whole footprint: the recipe is authored in tiles for the footprint, centred on it and facing
   * the road the door is on, so it is placed unscaled. Sites scale the fence to the footprint.
   */
  private structure(items: Placement[], p: Placed, t: number, h2: number, pick: number) {
    const kind = p.kind, level = levelOf(t), uc = underConstruction(t);
    const fp = footprintOf(kind);
    const centre = () => tmpP.set(p.ax + p.w / 2, 0, p.ay + p.h / 2);
    const yawQ = () => tmpQ.setFromAxisAngle(UP, (p.r * Math.PI) / 2);
    const crane = (y: number) => {
      centre().y = y; tmpQ.setFromAxisAngle(UP, Math.floor(h2 * 4) * (Math.PI / 2)); tmpS.set(1, 1, 1);
      items.push({ key: 'crane', matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: CRANE_TINT[priorityOf(t) + 2] });
    };
    if (level > 0) {
      const v = variant(kind, level, pick);
      if (!v) return;
      const palette = FACADE_TINT[kind];
      const tint = palette ? palette[Math.floor(h2 * palette.length)].clone() : new Color(WHITE);
      centre(); yawQ(); tmpS.set(1, 1, 1);
      items.push({ key: v.key, matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: tint.multiplyScalar(0.95 + 0.1 * h2), sign: { kind, x: p.ax, y: p.ay, r: p.r & 3 } });
      if (uc) crane(v.height);
    } else if (uc) {
      const v = variant(kind, 1, pick);
      if (!v) return;
      const q = (progressOf(t) + 0.5) / 4;
      centre(); yawQ(); tmpS.set(1, 0.06 + 0.94 * q, 1);
      items.push({ key: v.key, matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: CONCRETE });
      centre(); yawQ(); tmpS.set(fp.w, 1, fp.h);
      items.push({ key: 'site', matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: WHITE });
      crane(0);
    }
  }

  /**
   * Tower Bridge over a bascule span starting at (x, z): the landmark's model (shared/src/buildings/landmarks-london-2.ts,
   * one tile wide and four long along its z) centred on the span, turned along it and stretched to its length.
   */
  private bascule(items: Placement[], x: number, z: number, a: number, auxAt: (x: number, y: number) => number) {
    const ns = bridgeNS(a), dx = ns ? 0 : 1, dz = ns ? 1 : 0;
    let len = 1;
    while (len < 24 && auxAt(x + dx * len, z + dz * len) === a) len++;
    const v = variant(TOWER_BRIDGE_KIND, 1, 0);
    if (!v) return;
    tmpP.set(x + (ns ? 0.5 : len / 2), 0, z + (ns ? len / 2 : 0.5));
    tmpQ.setFromAxisAngle(UP, ns ? 0 : Math.PI / 2); tmpS.set(1, 1, len / 4);
    items.push({ key: v.key, matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: WHITE });
  }

  /** Turn a tile's UVs by `r` quarter turns anticlockwise (seen from above, north up): corner k shows the cell's corner k + r. */
  private turnUV(i: number, r: number) {
    const u = this.uvs.slice(i * 8, i * 8 + 8);
    for (let k = 0; k < 4; k++) { const j = (k + r) & 3; this.uvs[i * 8 + k * 2] = u[j * 2]; this.uvs[i * 8 + k * 2 + 1] = u[j * 2 + 1]; }
  }

  /** UVs for a cell drawn in a strip frame: `o` is the airfield orientation (FRONT order: the way to the terminal). */
  private orientedUV(i: number, cell: number, o: number, flipA: boolean, flipB: boolean) {
    const [u0, v0, u1, v1] = cellUV(cell);
    const B = FRONT[o & 3];
    for (let k = 0; k < 4; k++) {
      const dx = k === 1 || k === 2 ? 1 : 0, dz = k >= 2 ? 1 : 0; // corner order (x,z) (x+1,z) (x+1,z+1) (x,z+1)
      let along = o & 1 ? dz : dx;
      let across = o & 1 ? (B[0] > 0 ? dx : 1 - dx) : (B[1] > 0 ? dz : 1 - dz);
      if (flipA) along = 1 - along;
      if (flipB) across = 1 - across;
      this.uvs[i * 8 + k * 2] = u0 + along * (u1 - u0);
      this.uvs[i * 8 + k * 2 + 1] = v1 - across * (v1 - v0);
    }
  }

  /** congestion bytes for this chunk, kept so a rebuild keeps its tint */
  heat: Uint8Array | undefined;
  static setHeat(on: boolean) { heatEnabled = on; }
  static get heatOn() { return heatEnabled; }

  /** Feed the congestion bytes to the ground shader's overlay (a per-tile attribute; the colours stay as they are). */
  tintRoads() {
    const h = this.heat;
    for (let i = 0; i < N; i++) this.heats.fill(h ? h[i] / 255 : 0, i * 4, i * 4 + 4);
    this.geo.attributes.aHeat.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); }
}
