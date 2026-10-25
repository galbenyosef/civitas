import { BufferGeometry, BufferAttribute, Float32BufferAttribute, Uint16BufferAttribute, Mesh, Group, Color, Matrix4, Vector3, Quaternion, Material } from 'three';
import {
  CHUNK_SIZE, MANIFEST, Terrain, Zone, terrainOf, isRoad, zoneOf, levelOf, underConstruction, progressOf, priorityOf, hash2, kindIdOf,
  isPartAux, isAnchorAux, partDx, partDy, auxOrientation, isMultiTile, placedFromAnchor, footprintOf, type Placed,
  isAirfieldAux, airfieldOrientation, airfieldRow, FRONT, isRailAux, railMask,
  isRingAux, ringPos, isArmPos, isIslandAux, isFlyoverAux, deckEW, RING_POS,
  isBridgeAux, bridgeNS, bridgeStyle, bridgeDeckH, BridgeStyle, KIND_ID, isClassAux, auxClass, oneWayDir, RoadCls, isMotorwayAux, isMiniAux, isRingClassAux, bigRingAt, isPedestrianAux,
} from '@msimcity/shared';
import type { ClientChunk } from '../world';
import { Cell, cellUV } from './atlas';
import { variant } from './models';
import { landmarkSpanAt } from './bridges';
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
/** the top of each bridge landmark's own road deck in its model (landmarks-new-york.ts, landmarks-san-francisco.ts), so the model sits with it at the road's height */
const MODEL_DECK: Record<number, number> = { [KIND_ID['brooklyn-bridge']]: 0.25, [KIND_ID['golden-gate']]: 0.365 };

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

/** DIRS order (E, W, S, N) to a side (N 0, E 1, S 2, W 3) */
const DIR_SIDE = [1, 3, 2, 0];
/**
 * The far cell of a road of a class other than the street (R3): a lane's by its connection mask; a one-way's, an
 * avenue's or a motorway's carriageway turned to its flow (the cells flow north, `turn` anticlockwise quarter turns);
 * a pedestrian street's paving. Junction tiles and the odd bend keep the street's cell.
 */
function classCell(a: number, mask: number, x: number, z: number, roadAt: (x: number, z: number) => boolean): { cell: number; turn: number } {
  const cls = auxClass(a), ow = oneWayDir(a);
  if (cls === RoadCls.Lane) return { cell: Cell.LaneRoad + mask, turn: 0 };
  if (cls === RoadCls.Pedestrian) return mask === 5 || mask === 10 ? { cell: Cell.PedStraight, turn: mask === 10 ? 1 : 0 } : { cell: Cell.Ped, turn: 0 };
  // a crossroads: pavement corners only where there is no road on the diagonal (two avenues crossing share their middle)
  const road = mask === 15
    ? { cell: Cell.Cross + (roadAt(x + 1, z - 1) ? 1 : 0) + (roadAt(x + 1, z + 1) ? 2 : 0) + (roadAt(x - 1, z + 1) ? 4 : 0) + (roadAt(x - 1, z - 1) ? 8 : 0), turn: 0 }
    : { cell: Cell.Road + mask, turn: 0 };
  if (ow < 0) return road;
  const side = DIR_SIDE[ow], ns = side === 0 || side === 2, turn = (4 - side) & 3;
  if (cls === RoadCls.OneWay) {
    if (mask !== (ns ? 5 : 10)) return road;
    const line = ns ? x : z, pos = ns ? z : x, per = 4 + Math.floor(hash2(line * 3 + 1, 9) * 3), ph = Math.floor(hash2(line * 5 + 2, 11) * per);
    return { cell: (((pos + ph) % per) + per) % per === 0 ? Cell.OneWayArrow : Cell.OneWay, turn };
  }
  return { cell: cls === RoadCls.Motorway || cls === RoadCls.Deck ? Cell.Motorway : Cell.Avenue, turn }; // (under an interchange's deck: the motorway)
}
/**
 * A 5×5 roundabout's ring tile (R4) from far off: its place round the island (the cells are the east side and the
 * north-east corner, turned anticlockwise), a side with or without a road joining; null when its island has gone.
 */
function bigRingCell(x: number, z: number, auxAt: (x: number, y: number) => number, roadAt: (x: number, z: number) => boolean): { cell: number; turn: number } | null {
  const box = bigRingAt(auxAt, x, z);
  if (!box) return null;
  const ox = x - box[0], oz = z - box[1];
  if ((ox === 0 || ox === 4) && (oz === 0 || oz === 4)) return { cell: Cell.BigRingCorner, turn: ox === 4 && oz === 0 ? 0 : ox === 0 && oz === 0 ? 1 : ox === 0 ? 2 : 3 };
  const turn = ox === 4 ? 0 : oz === 0 ? 1 : ox === 0 ? 2 : 3, [dx, dz] = [[1, 0], [0, -1], [-1, 0], [0, 1]][turn];
  return { cell: roadAt(x + dx, z + dz) && !isPedestrianAux(auxAt(x + dx, z + dz)) ? Cell.BigRingArm : Cell.BigRingSide, turn };
}
/** A mini-roundabout's cell (R4): on a crossroads, or a T turned to its missing arm (the cell has no road to the south). */
const miniCell = (mask: number) => (mask === 15 ? { cell: Cell.MiniCross, turn: 0 } : { cell: Cell.MiniT, turn: mask === 13 ? 1 : mask === 14 ? 2 : mask === 7 ? 3 : 0 });

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
      // a bridge deck (shared/src/bridges.ts) is drawn over open water by render/bridges.ts, with its own lamps
      const deck = road && terrainOf(t) === Terrain.Water;
      // the ground shader pools street lamps (render/roads.ts, lampTexture) on road tiles (16 + their road sides) and on
      // tiles with a road among their eight neighbours (1 or more), where a lamp's light can reach
      const near = mask || roadAt(x + 1, z + 1) || roadAt(x - 1, z + 1) || roadAt(x + 1, z - 1) || roadAt(x - 1, z - 1) ? 1 : 0;
      this.roads.fill(deck ? 0 : road ? 16 + mask : Math.max(mask, near), i * 4, i * 4 + 4);
      let turn = 0; // quarter turns anticlockwise of a roundabout cell
      if (deck) {
        cell = Cell.Water;
        tmpC.setScalar(0.96 + 0.08 * h);
        const ba = chunk.aux[i];
        if (isBridgeAux(ba) && auxAt(x - (bridgeNS(ba) ? 0 : 1), z - (bridgeNS(ba) ? 1 : 0)) !== ba) {
          const lk = landmarkSpanAt(x, z);
          if (bridgeStyle(ba) === BridgeStyle.Bascule) this.bascule(items, x, z, ba, auxAt);
          else if (lk) this.bascule(items, x, z, ba, auxAt, lk);
        }
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
        else if (ja && isMiniAux(ja)) { const k = miniCell(mask); cell = k.cell; turn = k.turn; } // a mini-roundabout (R4)
        else if (ja && isRingClassAux(ja) && bigRingCell(x, z, auxAt, roadAt)) { const k = bigRingCell(x, z, auxAt, roadAt)!; cell = k.cell; turn = k.turn; } // a 5×5 roundabout's ring (R4)
        else if (ja && isClassAux(ja)) { const k = classCell(ja, mask, x, z, roadAt); cell = k.cell; turn = k.turn; } // a road class (shared/src/roadclass.ts)
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
      if (anchor) { this.structure(items, anchor, t, h2, pick, chunk.parcel[i]); continue; }

      // ---- buildings: face the road (never a motorway: no frontage, shared/src/roadclass.ts), jitter a little, rise while under construction
      const front = (fx: number, fz: number) => roadAt(fx, fz) && getTile(fx, fz) !== undefined && !isMotorwayAux(auxAt(fx, fz));
      let yaw: number;
      if (front(x, z + 1)) yaw = 0;
      else if (front(x + 1, z)) yaw = Math.PI / 2;
      else if (front(x - 1, z)) yaw = -Math.PI / 2;
      else if (front(x, z - 1)) yaw = Math.PI;
      else yaw = Math.floor(h * 4) * (Math.PI / 2);
      const s = 0.95 + 0.1 * h2;
      tmpP.set(x + 0.5, 0, z + 0.5);
      if (level > 0) {
        const v = variant(kind, level, pick);
        if (v) {
          tmpQ.setFromAxisAngle(UP, yaw); tmpS.set(s, s, s);
          const palette = FACADE_TINT[kind];
          const tint = palette ? palette[Math.floor(h2 * palette.length)].clone() : new Color(WHITE);
          items.push({ key: v.key, matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: tint.multiplyScalar(0.9 + 0.2 * hash2(x * 7 + 3, z)), sign: { kind, x, y: z, r: Math.round(yaw / (Math.PI / 2)) & 3 }, ad: [x, z, chunk.parcel[i]] });
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
          tmpS.set(1, 1, 1); // the fence turns with the shell, so its hoarding (an ad slot, docs/adverts.md) faces the road
          items.push({ key: 'site', matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: WHITE, ad: [x, z, chunk.parcel[i]] });
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
  private structure(items: Placement[], p: Placed, t: number, h2: number, pick: number, parcel: number) {
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
      items.push({ key: v.key, matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: tint.multiplyScalar(0.95 + 0.1 * h2), sign: { kind, x: p.ax, y: p.ay, r: p.r & 3 }, ad: [p.doorX, p.doorY, parcel] });
      if (uc) crane(v.height);
    } else if (uc) {
      const v = variant(kind, 1, pick);
      if (!v) return;
      const q = (progressOf(t) + 0.5) / 4;
      centre(); yawQ(); tmpS.set(1, 0.06 + 0.94 * q, 1);
      items.push({ key: v.key, matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: CONCRETE });
      centre(); yawQ(); tmpS.set(fp.w, 1, fp.h);
      items.push({ key: 'site', matrix: new Matrix4().compose(tmpP, tmpQ, tmpS), color: WHITE, ad: [p.doorX, p.doorY, parcel] });
      crane(0);
    }
  }

  /**
   * Tower Bridge over a bascule span starting at (x, z): the landmark's model (shared/src/buildings/landmarks-london-2.ts,
   * one tile wide and four long along its z) centred on the span, turned along it and stretched to its length. With
   * `kind`, another landmark drawn over its span the same way (render/bridges.ts LANDMARK_SPANS: the Brooklyn Bridge,
   * the Golden Gate), raised or lowered so its own deck meets the road's (bridgeDeckH of the span's style).
   */
  private bascule(items: Placement[], x: number, z: number, a: number, auxAt: (x: number, y: number) => number, kind: number = TOWER_BRIDGE_KIND) {
    const ns = bridgeNS(a), dx = ns ? 0 : 1, dz = ns ? 1 : 0;
    let len = 1;
    while (len < 24 && auxAt(x + dx * len, z + dz * len) === a) len++;
    const v = variant(kind, 1, 0);
    if (!v) return;
    const deck = MODEL_DECK[kind];
    tmpP.set(x + (ns ? 0.5 : len / 2), deck ? bridgeDeckH(bridgeStyle(a)) - deck : 0, z + (ns ? len / 2 : 0.5));
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

  /** the road geometry's hook for the same bytes (render/roads.ts: the overlay on its mesh, and wear) */
  static onTint: ((cx: number, cy: number, heat: Uint8Array | undefined) => void) | null = null;

  /** Feed the congestion bytes to the ground shader's overlay (a per-tile attribute; the colours stay as they are). */
  tintRoads() {
    const h = this.heat;
    for (let i = 0; i < N; i++) this.heats.fill(h ? h[i] / 255 : 0, i * 4, i * 4 + 4);
    this.geo.attributes.aHeat.needsUpdate = true;
    ChunkView.onTint?.(this.cx, this.cy, h);
  }

  dispose() { this.geo.dispose(); }
}
