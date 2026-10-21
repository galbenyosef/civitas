import {
  BufferGeometry, BufferAttribute, Uint32BufferAttribute, Mesh, Group, InstancedMesh, InstancedBufferAttribute, Matrix4, Quaternion, Vector3,
  Color, MeshLambertMaterial, IcosahedronGeometry, SphereGeometry, DynamicDrawUsage, type Material, type Camera, type Texture,
} from 'three';
import {
  CHUNK_SIZE, Terrain, hash2, isRoad, terrainOf, signalArms, armCount, signalledArms, isMarkedJunction, mouthControl, mouthCrossing,
  boxJunction, leafySide, streetTreeAt, midZebraAt, MouthCrossing, MouthControl, isRingAux, ringPos, isArmPos, RING_POS, isFlyoverAux, deckEW,
  isBridgeAux, bridgeNS, bridgeStyle, BridgeStyle, isRailAux, railMask,
} from '@msimcity/shared';
import type { ClientChunk } from '../world';
import { Geo, buildTile, buildRing, surfaceY, ringSurfaceY, STREET, SIDE, type RoadTile, type RoadProfile } from './roadGeo';
import { lampTexture, OVL_SIZE, groundMaterial, lanternMaterial, sceneUniforms } from './materials';
import { Kit } from './kit';

/**
 * The streets near the camera as geometry (render/roadGeo.ts) and their furniture: lamp columns of three designs
 * with lanterns that light their own pools on the road, street trees in the verges, bollards at corners, litter bins,
 * Belisha beacons at zebras and the posts that will carry street name plates. Further off a road is its atlas cell on
 * the ground mesh (atlas.ts draws those to the same plan), so the far view costs what it always did.
 *
 * Detail tiers by distance from the camera (3D, tiles): a chunk within NEAR_IN of a camera gets its road mesh (one
 * draw call, the ground's material) and its furniture; past NEAR_OUT it drops back to the flat cells. Each road tile's
 * look is worked out from the tiles round it into a description (roadGeo RoadTile) and built once; a rebuild of the
 * chunk (any tile in it changed) reuses every tile whose description is unchanged, so a growing town does not
 * rebuild its streets. Furniture is instanced across all near chunks (a dozen draw calls in all) and refilled only
 * when a chunk's furniture or the near set changes.
 *
 * Street lamps are placed for every loaded chunk, near or not: their positions and habits go into lampTexture, from
 * which the ground and road shaders pool the light and the lanterns glow, each lamp coming on at its own darkness,
 * a few dead or sputtering, sodium-warm or LED-white by street (the organic rule).
 *
 * Nothing here touches the simulation: the road bit, the routing graph and the lanes cars drive are as they were.
 */
export const NEAR_IN = 74, NEAR_OUT = 84;
/** chunks built per frame at most, and the time budget for them (ms) */
const BUILD_BUDGET = 3, BUILD_MS = 8;
const N = CHUNK_SIZE * CHUNK_SIZE;
const UP = new Vector3(0, 1, 0);

/** what a tile's road needs from the world */
export interface RoadCtx {
  tile: (x: number, y: number) => number | undefined;
  aux: (x: number, y: number) => number;
  /** the junction's owner has the Traffic signals technology */
  signalled: (x: number, y: number) => boolean;
}

/** The class of a road tile. One today; R3 reads the aux class byte here. */
export const profileOf = (_tile: number, _aux: number): RoadProfile => STREET;

// ---- furniture ------------------------------------------------------------------------------------------------------

const F = { Post0: 0, Post1: 1, Post2: 2, Lens0: 3, Lens1: 4, Lens2: 5, Trunk: 6, Crown: 7, Column: 8, Bollard: 9, Bin: 10, Sign: 11, Beacon: 12, Globe: 13 } as const;
const F_COUNT = 14;
interface Furn { f: number; m: Matrix4; c: Color; lamp?: [number, number, number, number] }

/** A name plate's post (R2 draws the street's name on it): the plate's centre, its yaw (it faces along +z turned by yaw) and the street tile it names. */
export interface NamePlate { x: number; y: number; z: number; yaw: number; street: [number, number] }

const LAMP_H = [0.5, 0.56, 0.38], LAMP_REACH = [0.13, 0.15, 0];
function postGeometry(design: number) {
  const k = new Kit();
  const h = LAMP_H[design], reach = LAMP_REACH[design];
  if (design === 0) {
    // a modern column: a slim grey shaft, a level arm and a flat LED head
    k.cyl(0.0065, 0.009, h, 0, 0, 0, 0x8d939a, 6);
    k.box(reach + 0.01, 0.008, 0.008, reach / 2, h - 0.008, 0, 0x8d939a);
    k.box(0.07, 0.012, 0.032, reach, h - 0.016, 0, 0x6b7077);
  } else if (design === 1) {
    // an older column with a swan-neck bracket and a cobra head over the road
    k.cyl(0.006, 0.011, h, 0, 0, 0, 0x9aa0a4, 6);
    k.box(0.01, 0.01, 0.01, 0.01, h - 0.01, 0, 0x9aa0a4);
    k.box(reach - 0.02, 0.008, 0.008, reach / 2, h + 0.004, 0, 0x9aa0a4);
    k.taper(0.075, 0.034, 0.05, 0.02, 0.022, reach + 0.01, h - 0.012, 0, 0xb4b9bd);
  } else {
    // a heritage lamp: a black fluted column on a plinth, the lantern on top
    k.cyl(0.016, 0.019, 0.04, 0, 0, 0, 0x1d2024, 8);
    k.cyl(0.0065, 0.01, h - 0.08, 0, 0.04, 0, 0x1d2024, 8);
    k.cyl(0.012, 0.007, 0.012, 0, h - 0.04, 0, 0x1d2024, 8);
    k.cone(0.03, 0.022, 0, h, 0, 0x1d2024, 6);
  }
  return k.build();
}
function lensGeometry(design: number) {
  const k = new Kit();
  const h = LAMP_H[design], reach = LAMP_REACH[design];
  if (design === 0) k.box(0.055, 0.003, 0.024, reach, h - 0.019, 0, 0xffffff);
  else if (design === 1) k.box(0.05, 0.004, 0.022, reach + 0.012, h - 0.016, 0, 0xffffff);
  else k.taper(0.026, 0.026, 0.034, 0.034, 0.03, 0, h - 0.03, 0, 0xffffff);
  return k.build();
}
function treeGeometries() {
  // canopies are white: the instance colour is the species' leaf
  const trunk = new Kit().cyl(0.009, 0.014, 0.16, 0, 0, 0, 0x6b4a2b, 5).build();
  const crown = new Kit();
  crown.part(new IcosahedronGeometry(0.085, 0).translate(0, 0.2, 0), 0xffffff);
  crown.part(new IcosahedronGeometry(0.06, 0).translate(0.035, 0.26, -0.02), 0xf2f2f2);
  crown.part(new IcosahedronGeometry(0.05, 0).translate(-0.04, 0.17, 0.03), 0xe8e8e8);
  const column = new Kit();
  column.part(new SphereGeometry(0.05, 6, 5).scale(1, 2.6, 1).translate(0, 0.25, 0), 0xffffff);
  return { trunk, crown: crown.build(), column: column.build() };
}
function smallGeometries() {
  const bollard = new Kit().cyl(0.0075, 0.0085, 0.045, 0, 0, 0, 0x1b1d20, 6).box(0.017, 0.006, 0.017, 0, 0.034, 0, 0xe8e8e2).build();
  const bin = new Kit().cyl(0.014, 0.012, 0.036, 0, 0, 0, 0xffffff, 8).cyl(0.016, 0.016, 0.006, 0, 0.036, 0, 0xffffff, 8).build();
  const sign = new Kit();
  for (const x of [-0.03, 0.03]) sign.box(0.005, 0.07, 0.005, x, 0, 0, 0x2b2e33);
  sign.box(0.084, 0.03, 0.004, 0, 0.05, 0, 0x1c1e22).box(0.078, 0.024, 0.005, 0, 0.053, 0.0005, 0xf4f4f0);
  const beacon = new Kit();
  for (let i = 0; i < 6; i++) beacon.cyl(0.0055, 0.0055, 0.03, 0, i * 0.03, 0, i % 2 ? 0xf2f2ee : 0x1b1d20, 6);
  const globe = new Kit().part(new SphereGeometry(0.017, 10, 8).translate(0, 0.195, 0), 0xffffff).build();
  return { bollard, bin: bin, sign: sign.build(), beacon: beacon.build(), globe };
}

/** Belisha globes: amber, flashing about once a second, each crossing at its own rate and phase (aLamp.x). */
function beaconMaterial() {
  const m = new MeshLambertMaterial({ vertexColors: true, color: 0xffa31a });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sceneUniforms.uTime; shader.uniforms.uNight = sceneUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aLamp;\nvarying vec4 vLamp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLamp = aLamp;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uNight;\nvarying vec4 vLamp;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float ph = fract(uTime * (0.85 + 0.2 * vLamp.x) + vLamp.y);
  totalEmissiveRadiance += vec3(1.0, 0.55, 0.08) * step(ph, 0.5) * (0.9 + 1.4 * uNight);`);
  };
  m.customProgramCacheKey = () => 'msc-belisha';
  return m;
}

/** Leaf colours of street trees: plane and lime greens, a copper beech now and then, cherries in blossom. */
const LEAF = [0x6aa84f, 0x5e9a46, 0x78b45a, 0x6f9e3f, 0x8a4a3c, 0xf0b4c4, 0xf4dde4].map((c) => new Color(c));

// ---- per chunk ------------------------------------------------------------------------------------------------------

interface TileCache {
  sig: string;
  t: RoadTile | null;
  ring: { pos: number; arm: boolean } | null;
  p: Float32Array; n: Float32Array; c: Float32Array; uv: Float32Array; idx: Uint32Array;
  furn: Furn[];
  /** the road tile's aRoad value (16 + its N E S W road bits) */
  road: number;
}
interface Entry {
  key: string; cx: number; cy: number;
  chunk: ClientChunk;
  dirty: boolean; near: boolean;
  mesh: Mesh | null;
  tiles: Map<number, TileCache>;
  /** per tile in the mesh: local index, first vertex, vertex count (heat updates) */
  ranges: number[];
  heat: Uint8Array | undefined;
  /** smoothed congestion per tile, and the wear level it gave at the last build */
  wear: Float32Array; wearAt: Uint8Array; wearSeen: boolean; wearBuilt: number;
  /** junction tiles and whether they were signalled at the last build (local index, 0/1 pairs) */
  junctions: number[];
  furn: Furn[];
}
const ckey = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

export class RoadLayer {
  /** the road meshes (the ground's shader fades them in the underground view) */
  group = new Group();
  /** street furniture: ghosted with the rest of the surface in the underground view */
  furniture = new Group();
  readonly material: Material;
  private entries = new Map<number, Entry>();
  private byKey = new Map<string, Entry>();
  private ctx: RoadCtx | null = null;
  private furnDirty = false;
  private lampDirty = false;
  private lampData = lampTexture.image.data as Uint8Array;
  private meshes: InstancedMesh[] = [];
  private plates: NamePlate[] = [];
  private tmpV = new Vector3();

  constructor(atlas: Texture) {
    this.material = groundMaterial(atlas, true);
    this.group.name = 'roads'; this.furniture.name = 'street furniture';
    const furnMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const lens = lanternMaterial(), beacon = beaconMaterial();
    const tree = treeGeometries(), small = smallGeometries();
    const geos = [postGeometry(0), postGeometry(1), postGeometry(2), lensGeometry(0), lensGeometry(1), lensGeometry(2),
      tree.trunk, tree.crown, tree.column, small.bollard, small.bin, small.sign, small.beacon, small.globe];
    const caps = [6000, 6000, 6000, 6000, 6000, 6000, 12000, 12000, 12000, 6000, 3000, 3000, 2000, 2000];
    this.meshes = geos.map((g, i) => {
      const lamp = i >= F.Lens0 && i <= F.Lens2, glob = i === F.Globe;
      if (lamp || glob) g.setAttribute('aLamp', new InstancedBufferAttribute(new Float32Array(caps[i] * 4), 4).setUsage(DynamicDrawUsage));
      const m = new InstancedMesh(g, lamp ? lens : glob ? beacon : furnMat, caps[i]);
      m.count = 0; m.frustumCulled = false;
      m.castShadow = i <= F.Post2 || i === F.Trunk || i === F.Crown || i === F.Column || i === F.Beacon;
      m.receiveShadow = i === F.Crown || i === F.Column;
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      this.furniture.add(m);
      return m;
    });
  }

  // ---- the chunk lifecycle (main.ts calls these beside the other per-chunk renderers) ---------------------------------

  /** A chunk's tiles or aux bytes changed (or it arrived): place its lamps now, rebuild its streets when near. */
  scanChunk(key: string, chunk: ClientChunk, getTile: (x: number, y: number) => number | undefined, auxAt: (x: number, y: number) => number) {
    if (!this.ctx) this.ctx = { tile: getTile, aux: auxAt, signalled: () => false };
    else { this.ctx.tile = getTile; this.ctx.aux = auxAt; }
    let e = this.byKey.get(key);
    if (!e) {
      e = { key, cx: chunk.cx, cy: chunk.cy, chunk, dirty: true, near: false, mesh: null, tiles: new Map(), ranges: [], heat: undefined,
        wear: new Float32Array(N), wearAt: new Uint8Array(N), wearSeen: false, wearBuilt: 0, junctions: [], furn: [] };
      this.byKey.set(key, e); this.entries.set(ckey(chunk.cx, chunk.cy), e);
    }
    e.chunk = chunk; e.dirty = true;
    this.placeLamps(e);
  }

  dropChunk(key: string) {
    const e = this.byKey.get(key);
    if (!e) return;
    this.dropMesh(e);
    this.clearLamps(e);
    if (e.near && e.furn.length) this.furnDirty = true;
    this.byKey.delete(key); this.entries.delete(ckey(e.cx, e.cy));
  }

  /** The congestion bytes for a chunk changed (ChunkView.tintRoads): the heat overlay's attribute, and the wear they leave. */
  setHeat(cx: number, cy: number, heat: Uint8Array | undefined) {
    const e = this.entries.get(ckey(cx, cy));
    if (!e) return;
    e.heat = heat;
    this.tint(e);
    if (!heat) return;
    // wear follows traffic slowly: a smoothed congestion per tile, and a rebuild (cached tiles mostly) when a level changes
    let changed = false;
    for (let i = 0; i < N; i++) {
      const h = heat[i] / 255;
      e.wear[i] = e.wearSeen ? e.wear[i] * 0.9 + h * 0.1 : h;
      if (wearLevel(e.wear[i]) !== e.wearAt[i]) changed = true;
    }
    e.wearSeen = true;
    if (changed && performance.now() - e.wearBuilt > 60000) e.dirty = true;
  }

  /** Ownership or technology changed: junctions whose lights came or went are re-marked. */
  invalidate() {
    for (const e of this.entries.values()) {
      if (!e.junctions.length || !this.ctx) continue;
      const x0 = e.cx * CHUNK_SIZE, z0 = e.cy * CHUNK_SIZE;
      for (let i = 0; i < e.junctions.length; i += 2) {
        const li = e.junctions[i], x = x0 + (li % CHUNK_SIZE), z = z0 + Math.floor(li / CHUNK_SIZE);
        if ((this.isSignalled(x, z) ? 1 : 0) !== e.junctions[i + 1]) { e.dirty = true; break; }
      }
    }
  }

  /** Tiers for the cameras drawing this frame, chunk builds within the budget, the furniture and the lamp map. */
  frame(cams: readonly Camera[], signalled: (x: number, y: number) => boolean) {
    if (this.ctx) this.ctx.signalled = signalled;
    const t0 = performance.now();
    let budget = BUILD_BUDGET;
    const todo: [number, Entry][] = [];
    for (const e of this.entries.values()) {
      const d = this.distance(e, cams);
      const near = e.near ? d < NEAR_OUT : d < NEAR_IN;
      if (near !== e.near) {
        e.near = near;
        if (e.mesh) e.mesh.visible = near;
        if (e.furn.length) this.furnDirty = true;
        if (!near) this.dropMesh(e);
      }
      if (near && (e.dirty || !e.mesh)) todo.push([d, e]);
    }
    todo.sort((a, b) => a[0] - b[0]);
    for (const [, e] of todo) {
      if (budget-- <= 0 || performance.now() - t0 > BUILD_MS) break;
      this.build(e);
    }
    if (this.furnDirty) this.fillFurniture();
    if (this.lampDirty) { lampTexture.needsUpdate = true; this.lampDirty = false; }
  }

  /** Height of the surface a walker stands on at (x, z): a pavement's near the camera, else the ground's (0). */
  walkY(x: number, z: number): number {
    const tx = Math.floor(x), tz = Math.floor(z);
    const e = this.entries.get(ckey(Math.floor(tx / CHUNK_SIZE), Math.floor(tz / CHUNK_SIZE)));
    if (!e || !e.mesh || !e.near) return 0;
    const lx = tx - e.cx * CHUNK_SIZE, lz = tz - e.cy * CHUNK_SIZE;
    const tc = e.tiles.get(lz * CHUNK_SIZE + lx);
    if (!tc) return 0;
    if (tc.t) return surfaceY(tc.t, x, z);
    if (tc.ring) return ringSurfaceY(tx, tz, tc.ring.pos, tc.ring.arm, STREET, x, z);
    return 0;
  }

  /** Name plate posts near the camera (the hook for R2's street names). */
  namePlates(): readonly NamePlate[] { return this.plates; }

  // ---- building -----------------------------------------------------------------------------------------------------

  private distance(e: Entry, cams: readonly Camera[]): number {
    let best = Infinity;
    const x0 = e.cx * CHUNK_SIZE, z0 = e.cy * CHUNK_SIZE;
    for (const cam of cams) {
      const p = cam.getWorldPosition(this.tmpV);
      const dx = Math.max(x0 - p.x, 0, p.x - (x0 + CHUNK_SIZE)), dz = Math.max(z0 - p.z, 0, p.z - (z0 + CHUNK_SIZE));
      best = Math.min(best, Math.hypot(dx, p.y, dz));
    }
    return best;
  }

  private isSignalled(x: number, z: number): boolean {
    const c = this.ctx!;
    const road = this.roadFn;
    return signalledArms(signalArms(road, x, z)) && c.signalled(x, z);
  }
  /** road for shapes: an unloaded neighbour is taken as road (the street carries on), as the ground cells do */
  private roadFn = (x: number, z: number) => { const t = this.ctx!.tile(x, z); return t === undefined ? true : isRoad(t); };

  private dropMesh(e: Entry) {
    if (!e.mesh) return;
    this.group.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh = null;
  }

  private build(e: Entry) {
    const ctx = this.ctx!;
    e.dirty = false;
    e.wearBuilt = performance.now();
    const x0 = e.cx * CHUNK_SIZE, z0 = e.cy * CHUNK_SIZE;
    const keep = new Map<number, TileCache>();
    const junctions: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = e.chunk.tiles[i];
      if (!isRoad(t)) continue;
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      e.wearAt[i] = wearLevel(e.wear[i]);
      const d = this.describe(x, z, t, e.chunk.aux[i], e.wearAt[i]);
      if (!d) continue;
      if (d.t?.junction) junctions.push(i, d.t.cross.some((k) => k === MouthCrossing.Signal) ? 1 : 0);
      const old = e.tiles.get(i);
      if (old && old.sig === d.sig) { keep.set(i, old); continue; }
      const g = new Geo();
      if (d.t) buildTile(d.t, g); else if (d.ring) buildRing(x, z, d.ring.pos, d.ring.arm, STREET, g);
      keep.set(i, {
        sig: d.sig, t: d.t, ring: d.ring, road: 16 + (d.t ? d.t.m8 & 15 : 15),
        p: new Float32Array(g.p), n: new Float32Array(g.n), c: new Float32Array(g.c), uv: new Float32Array(g.uv), idx: new Uint32Array(g.idx),
        furn: d.t ? this.furnish(d.t) : d.ring ? this.furnishRing(x, z) : [],
      });
    }
    e.tiles = keep; e.junctions = junctions;
    // one mesh for the chunk
    let nv = 0, ni = 0;
    for (const tc of keep.values()) { nv += tc.p.length / 3; ni += tc.idx.length; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), colr = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const road = new Float32Array(nv), heat = new Float32Array(nv), idx = new Uint32Array(ni);
    let v = 0, k = 0;
    e.ranges = [];
    const furn: Furn[] = [];
    for (const [li, tc] of keep) {
      const n = tc.p.length / 3;
      pos.set(tc.p, v * 3); nrm.set(tc.n, v * 3); colr.set(tc.c, v * 3); uv.set(tc.uv, v * 2);
      road.fill(tc.road, v, v + n);
      for (let j = 0; j < tc.idx.length; j++) idx[k + j] = tc.idx[j] + v;
      e.ranges.push(li, v, n);
      v += n; k += tc.idx.length;
      for (const f of tc.furn) furn.push(f);
    }
    this.dropMesh(e);
    if (ni) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('normal', new BufferAttribute(nrm, 3));
      geo.setAttribute('color', new BufferAttribute(colr, 3));
      geo.setAttribute('uv', new BufferAttribute(uv, 2));
      geo.setAttribute('aRoad', new BufferAttribute(road, 1));
      geo.setAttribute('aHeat', new BufferAttribute(heat, 1));
      geo.setIndex(new Uint32BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, this.material);
      mesh.matrixAutoUpdate = false; mesh.receiveShadow = true;
      mesh.visible = e.near;
      e.mesh = mesh;
      this.group.add(mesh);
      this.tint(e);
    }
    e.furn = furn;
    this.furnDirty = true;
  }

  private tint(e: Entry) {
    if (!e.mesh) return;
    const a = e.mesh.geometry.attributes.aHeat as BufferAttribute, arr = a.array as Float32Array;
    for (let i = 0; i < e.ranges.length; i += 3) arr.fill(e.heat ? e.heat[e.ranges[i]] / 255 : 0, e.ranges[i + 1], e.ranges[i + 1] + e.ranges[i + 2]);
    a.needsUpdate = true;
  }

  /** Everything a road tile's look depends on, and a signature of it; null for tiles drawn by others (decks, ramps). */
  private describe(x: number, z: number, tw: number, a: number, wear: number): { sig: string; t: RoadTile | null; ring: { pos: number; arm: boolean } | null } | null {
    const ctx = this.ctx!, road = this.roadFn;
    if (terrainOf(tw) === Terrain.Water) return null; // a bridge deck: render/bridges.ts
    if (isRingAux(a)) {
      const p = ringPos(a), arm = isArmPos(p) && road(x + RING_POS[p][0], z + RING_POS[p][1]);
      return { sig: `R${p}${arm ? 1 : 0}`, t: null, ring: { pos: p, arm } };
    }
    if (this.isRamp(x, z, a)) return null; // under a flyover's or a bridge's ramp
    const under = isFlyoverAux(a);
    let m8 = 0;
    const DIAG: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    for (let s = 0; s < 4; s++) if (road(x + SIDE[s][0], z + SIDE[s][1])) m8 |= 1 << s;
    for (let s = 0; s < 4; s++) if (road(x + DIAG[s][0], z + DIAG[s][1])) m8 |= 16 << s;
    if (under) m8 &= deckEW(a) ? ~(2 | 8 | 0xf0) : ~(1 | 4 | 0xf0); // the deck's ramps are not this road's sides
    const arms = under ? (deckEW(a) ? 5 : 10) & m8 : signalArms(road, x, z);
    const junction = !under && isMarkedJunction(road, a, x, z);
    const sig0 = junction && this.isSignalled(x, z);
    const cross = [0, 0, 0, 0], ctrl = [0, 0, 0, 0], nCross = [0, 0, 0, 0], nCtrl = [0, 0, 0, 0], nArms = [0, 0, 0, 0];
    let leafy = 0;
    for (let s = 0; s < 4; s++) {
      const bit = 1 << s, nx = x + SIDE[s][0], nz = z + SIDE[s][1];
      if (junction && arms & bit && !isRingAux(ctx.aux(nx, nz))) { cross[s] = mouthCrossing(x, z, bit, sig0); ctrl[s] = mouthControl(road, x, z, bit, sig0); }
      // the junction next door, when this tile is one of its arms (not its twin lane)
      if (arms & bit && !junction && !under) {
        const na = ctx.aux(nx, nz), nt = ctx.tile(nx, nz);
        if (nt !== undefined && isMarkedJunction(road, na, nx, nz)) {
          const nArm = signalArms(road, nx, nz), back = 1 << ((s + 2) & 3);
          if (nArm & back) {
            const ns = this.isSignalled(nx, nz);
            nCross[s] = mouthCrossing(nx, nz, back, ns); nCtrl[s] = mouthControl(road, nx, nz, back, ns); nArms[s] = nArm;
          }
        }
      }
      if (!(m8 & bit) && leafySide(ctx.tile(nx, nz))) leafy |= bit;
    }
    const box = junction && boxJunction(road, x, z, sig0, wear >= 2);
    const rail = isRailAux(a) ? railMask(a) : 0;
    const zebra = !junction && !under && midZebraAt(road, a, x, z);
    const t: RoadTile = { x, z, prof: profileOf(tw, a), m8, arms, junction, cross, ctrl, box, nCross, nCtrl, nArms, leafy, rail, under, zebra, wear };
    const sig = `${m8},${arms},${junction ? 1 : 0}${cross.join('')}${ctrl.join('')}${box ? 1 : 0}${nCross.join('')}${nCtrl.join('')},${nArms.join('.')},${leafy},${rail},${under ? 1 : 0}${zebra ? 1 : 0},${wear}`;
    return { sig, t, ring: null };
  }

  /** A road tile under a flyover's ramp or a bridge's landing ramp (those draw it; render/junctions.ts, bridges.ts). */
  private isRamp(x: number, z: number, a: number): boolean {
    const ctx = this.ctx!;
    for (let s = 0; s < 4; s++) {
      const nx = x + SIDE[s][0], nz = z + SIDE[s][1], na = ctx.aux(nx, nz);
      if (!na) continue;
      const alongX = s === 1 || s === 3;
      if (isFlyoverAux(na) && deckEW(na) === alongX) { const nt = ctx.tile(nx, nz); if (nt !== undefined && isRoad(nt)) return true; }
      if (isBridgeAux(na) && bridgeNS(na) === !alongX) {
        const nt = ctx.tile(nx, nz);
        if (nt === undefined || terrainOf(nt) !== Terrain.Water) continue;
        if (bridgeStyle(na) === BridgeStyle.Bascule) return true;
        // a plain straight landing takes the ramp (bridges.ts span: no aux of its own, no road either side across)
        const px = alongX ? 0 : 1, pz = alongX ? 1 : 0;
        if (!a && !this.roadFn(x + px, z + pz) && !this.roadFn(x - px, z - pz)) return true;
      }
    }
    return false;
  }

  // ---- lamps --------------------------------------------------------------------------------------------------------

  /** Where a road tile's lamp stands (tile-local), where its light falls, and its habits; null for none. */
  private lampOf(x: number, z: number, tw: number, a: number): { px: number; pz: number; lx: number; lz: number; yaw: number; on: number; flags: number; design: number } | null {
    const road = this.roadFn;
    if (terrainOf(tw) === Terrain.Water || isRailAux(a) || isFlyoverAux(a) || isBridgeAux(a) || this.isRamp(x, z, a)) return null;
    if (midZebraAt(road, a, x, z)) return null; // the zebra's beacons stand there
    const r = (n: number) => hash2(x * 41 + n * 13, z * 37 - n * 7);
    let px = 0, pz = 0, lx = 0, lz = 0, line = 0, st = 0;
    if (isRingAux(a)) {
      const p = ringPos(a);
      if (!(p & 1) || r(1) > 0.5) return null;
      // on the outer corner of the ring, leaning in over it
      const [ox, oz] = RING_POS[p];
      px = ox * 0.44; pz = oz * 0.44; lx = ox * 0.3; lz = oz * 0.3; line = x; st = z;
    } else {
      const arms = signalArms(road, x, z), n = armCount(arms);
      if (arms === 5 || arms === 10) {
        // along a straight: every third tile, the side alternating, the spacing set by the street's own phase
        const ns = arms === 5, along = ns ? z : x;
        line = ns ? x : z;
        const k = along + Math.floor(hash2(line * 7 + 3, ns ? 41 : 43) * 3);
        if (((k % 3) + 3) % 3 !== 0) return null;
        let side = Math.floor(k / 3) & 1 ? 1 : -1;
        const sideRoad = (sd: number) => (ns ? road(x + sd, z) : road(x, z + sd));
        if (sideRoad(side)) side = -side;
        if (sideRoad(side)) return null;
        const j = (r(2) - 0.5) * 0.3;
        // the lantern reaches out over the road from the back of the pavement
        if (ns) { px = side * 0.47; pz = j; lx = side * 0.34; lz = j; } else { px = j; pz = side * 0.47; lx = j; lz = side * 0.34; }
        st = Math.floor(along / 8);
      } else if (n === 2) {
        // a bend: on the outside corner, leaning in over the turn
        if (r(3) > 0.6) return null;
        const sx = arms & 2 ? -1 : 1, sz = arms & 4 ? -1 : 1;
        px = sx * 0.43; pz = sz * 0.43; lx = sx * 0.34; lz = sz * 0.34; line = x + z; st = 0;
      } else return null;
    }
    if (r(4) < 0.04) return null; // a column taken down and not replaced
    // the street's lamps: one design and colour per stretch, now and then a replacement that does not match
    const ds = hash2(line * 11 + 5, st * 3 + 1), odd = r(5) < 0.08;
    const design = odd ? Math.floor(r(6) * 3) : ds < 0.45 ? 0 : ds < 0.8 ? 1 : 2;
    const led = design === 0 ? r(7) > 0.1 : design === 2 ? r(7) < 0.5 : r(7) < 0.15;
    if (design === 2) { lx = px; lz = pz; }
    const dead = r(8) < 0.04, sput = !dead && r(9) < 0.05;
    const bright = Math.floor(r(10) * 31);
    const flags = (dead ? 1 : 0) | (sput ? 2 : 0) | (led ? 4 : 0) | (bright << 3);
    return { px, pz, lx, lz, yaw: Math.atan2(-(lz - pz), lx - px), on: 0.1 + 0.55 * r(11), flags, design };
  }

  private placeLamps(e: Entry) {
    const x0 = e.cx * CHUNK_SIZE, z0 = e.cy * CHUNK_SIZE, d = this.lampData;
    for (let i = 0; i < N; i++) {
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      const o = (((z % OVL_SIZE) + OVL_SIZE) % OVL_SIZE * OVL_SIZE + (((x % OVL_SIZE) + OVL_SIZE) % OVL_SIZE)) * 4;
      const t = e.chunk.tiles[i];
      const l = isRoad(t) ? this.lampOf(x, z, t, e.chunk.aux[i]) : null;
      if (!l) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; continue; }
      d[o] = Math.max(1, Math.round(l.on * 255)); d[o + 1] = Math.round((l.lx + 0.5) * 255); d[o + 2] = Math.round((l.lz + 0.5) * 255); d[o + 3] = l.flags;
    }
    this.lampDirty = true;
  }
  private clearLamps(e: Entry) {
    const x0 = e.cx * CHUNK_SIZE, z0 = e.cy * CHUNK_SIZE, d = this.lampData;
    for (let i = 0; i < N; i++) {
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      const o = (((z % OVL_SIZE) + OVL_SIZE) % OVL_SIZE * OVL_SIZE + (((x % OVL_SIZE) + OVL_SIZE) % OVL_SIZE)) * 4;
      d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;
    }
    this.lampDirty = true;
  }

  // ---- furniture ----------------------------------------------------------------------------------------------------

  /** A road tile's furniture: its lamp, street trees, bollards at junction corners, a bin, Belisha beacons, name plates. */
  private furnish(t: RoadTile): Furn[] {
    const ctx = this.ctx!;
    const out: Furn[] = [];
    const ox = t.x + 0.5, oz = t.z + 0.5;
    const r = (n: number) => hash2(t.x * 53 + n * 11, t.z * 47 - n * 5);
    const at = (lx: number, lz: number) => surfaceY(t, ox + lx, oz + lz);
    const put = (f: number, lx: number, lz: number, yaw: number, s: number, c: Color, lean = 0, leanDir = 0, lamp?: [number, number, number, number]) => {
      const q = new Quaternion().setFromAxisAngle(UP, yaw);
      if (lean) q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(Math.cos(leanDir), 0, -Math.sin(leanDir)), lean));
      out.push({ f, m: new Matrix4().compose(new Vector3(ox + lx, at(lx, lz), oz + lz), q, new Vector3(s, s, s)), c, lamp });
    };
    const tw = ctx.tile(t.x, t.z)!;
    const l = this.lampOf(t.x, t.z, tw, ctx.aux(t.x, t.z));
    let lampSide = -1, lampAlong = 0;
    if (l) {
      const s = 0.95 + 0.1 * r(1);
      const tone = new Color().setScalar(0.85 + 0.25 * r(2));
      put(F.Post0 + l.design, l.px, l.pz, l.yaw, s, tone, (r(3) - 0.5) * 0.04, r(4) * 6.28);
      put(F.Lens0 + l.design, l.px, l.pz, l.yaw, s, new Color(1, 1, 1), (r(3) - 0.5) * 0.04, r(4) * 6.28, [l.on, l.flags, t.x, t.z]);
      lampSide = Math.abs(l.px) > Math.abs(l.pz) ? (l.px > 0 ? 1 : 3) : (l.pz > 0 ? 2 : 0);
      lampAlong = Math.abs(l.px) > Math.abs(l.pz) ? l.pz : l.px;
    }
    // street trees in the verge
    for (let s = 0; s < 4; s++) {
      const tree = streetTreeAt(ctx.tile, t.x, t.z, 1 << s);
      if (!tree || (s === lampSide && Math.abs(tree.along - lampAlong) < 0.2)) continue;
      const off = 0.482, [dx, dz] = SIDE[s];
      const lx = dx * off + (dx === 0 ? tree.along : 0), lz = dz * off + (dz === 0 ? tree.along : 0);
      const k = tree.k, species = k < 0.55 ? 0 : k < 0.75 ? 1 : 2;
      const size = (species === 2 ? 1.35 : 1.75) + 0.7 * hash2(t.x * 3 + s, t.z * 5 - s);
      const leaf = species === 2 ? LEAF[5 + (hash2(t.x + s, t.z) < 0.6 ? 0 : 1)] : LEAF[Math.floor(hash2(t.x * 7 + s, t.z * 3) * 4.99)];
      const c = leaf.clone().multiplyScalar(0.85 + 0.25 * hash2(t.z * 11 + s, t.x * 13));
      const lean = 0.03 + 0.06 * hash2(t.x * 19 + s, t.z * 23), leanDir = Math.atan2(-dz, -dx) + (hash2(t.x, t.z * 3 + s) - 0.5) * 1.2; // towards the open road, for the light
      const yaw = hash2(t.x * 29 + s, t.z * 31) * 6.28;
      put(F.Trunk, lx, lz, yaw, size, new Color().setScalar(0.85 + 0.3 * hash2(t.x + 9, t.z + s)), lean, leanDir);
      put(species === 1 ? F.Column : F.Crown, lx, lz, yaw, size * (species === 1 ? 1 : 1 + 0.15 * hash2(t.x, t.z + s * 7)), c, lean, leanDir);
    }
    if (t.junction) {
      const c = t.prof.carriage;
      // bollards round some corners, clear of the walkers' corner (the sidewalk line meets at 45°)
      for (const [sx, sz, sa, sb] of [[1, -1, 1, 0], [1, 1, 1, 2], [-1, 1, 3, 2], [-1, -1, 3, 0]]) {
        if (!(t.m8 & (1 << sa)) || !(t.m8 & (1 << sb)) || r(20 + sa * 3 + sb) > 0.45) continue;
        for (const ang of [0.35, 1.22]) {
          const lx = sx * (0.5 - Math.cos(ang) * 0.104), lz = sz * (0.5 - Math.sin(ang) * 0.104);
          put(F.Bollard, lx, lz, 0, 0.95 + 0.1 * r(30 + sa), new Color().setScalar(0.9 + 0.2 * r(31 + sb)));
        }
      }
      // Belisha beacons at both ends of each zebra, in step with each other, each crossing at its own rate
      for (let s = 0; s < 4; s++) {
        if (t.cross[s] !== MouthCrossing.Zebra) continue;
        const [dx, dz] = SIDE[s], rx = -dz, rz = dx;
        for (const e of [-1, 1]) {
          const lx = dx * 0.41 + rx * e * (c + 0.055), lz = dz * 0.41 + rz * e * (c + 0.055);
          put(F.Beacon, lx, lz, 0, 1, new Color(1, 1, 1));
          put(F.Globe, lx, lz, 0, 1, new Color(1, 1, 1), 0, 0, [r(40 + s), r(44 + s), 0, 0]);
        }
      }
    } else if (t.zebra) {
      // Belisha beacons at the ends of a mid-block zebra
      const ns = t.arms === 5, c = t.prof.carriage;
      for (const e of [-1, 1]) {
        const lx = ns ? e * (c + 0.055) : 0, lz = ns ? 0 : e * (c + 0.055);
        put(F.Beacon, lx, lz, 0, 1, new Color(1, 1, 1));
        put(F.Globe, lx, lz, 0, 1, new Color(1, 1, 1), 0, 0, [r(40), r(44), 0, 0]);
      }
    } else if ((t.arms === 5 || t.arms === 10) && r(50) < 0.1) {
      // a litter bin on the pavement, away from the lamp
      const ns = t.arms === 5, sides = ns ? [1, 3] : [0, 2];
      const s = sides[r(51) < 0.5 ? 0 : 1];
      if (s !== lampSide && !(t.m8 & (1 << s))) {
        const [dx, dz] = SIDE[s], along = (r(52) - 0.5) * 0.6;
        const binC = r(53) < 0.6 ? new Color(0x2b3a2e) : r(53) < 0.85 ? new Color(0x1d1f22) : new Color(0x6b2a24);
        put(F.Bin, dx * 0.468 + (dx === 0 ? along : 0), dz * 0.468 + (dz === 0 ? along : 0), r(54) * 6.28, 1, binC);
      }
    }
    // a name plate post on the minor road's corner where it meets a junction (R2 names the street on it)
    for (let s = 0; s < 4; s++) {
      if (t.nCtrl[s] !== MouthControl.GiveWay) continue;
      const [dx, dz] = SIDE[s], rx = -dz, rz = dx;
      const e = r(60 + s) < 0.5 ? -1 : 1;
      if (t.m8 & (1 << (e > 0 ? (s + 1) & 3 : (s + 3) & 3))) continue;
      const lx = dx * 0.36 + rx * e * 0.468, lz = dz * 0.36 + rz * e * 0.468;
      const yaw = Math.atan2(rx * e, rz * e) + Math.PI / 2;
      put(F.Sign, lx, lz, yaw, 1, new Color(1, 1, 1));
    }
    return out;
  }

  private furnishRing(x: number, z: number): Furn[] {
    const ctx = this.ctx!;
    const tw = ctx.tile(x, z)!;
    const l = this.lampOf(x, z, tw, ctx.aux(x, z));
    if (!l) return [];
    const m = new Matrix4().compose(new Vector3(x + 0.5 + l.px, STREET.kerb, z + 0.5 + l.pz), new Quaternion().setFromAxisAngle(UP, l.yaw), new Vector3(1, 1, 1));
    return [{ f: F.Post0 + l.design, m, c: new Color(1, 1, 1) }, { f: F.Lens0 + l.design, m, c: new Color(1, 1, 1), lamp: [l.on, l.flags, x, z] }];
  }

  private fillFurniture() {
    this.furnDirty = false;
    const counts = new Array(F_COUNT).fill(0);
    this.plates = [];
    const sign = new Vector3(), sq = new Quaternion(), ss = new Vector3();
    for (const e of this.entries.values()) {
      if (!e.near || !e.mesh) continue;
      for (const f of e.furn) {
        const mesh = this.meshes[f.f], i = counts[f.f];
        if (i >= mesh.instanceMatrix.count) continue;
        mesh.setMatrixAt(i, f.m);
        mesh.setColorAt(i, f.c);
        if (f.lamp) (mesh.geometry.attributes.aLamp as InstancedBufferAttribute).setXYZW(i, ...f.lamp);
        counts[f.f]++;
        if (f.f === F.Sign) {
          f.m.decompose(sign, sq, ss);
          const yaw = 2 * Math.atan2(sq.y, sq.w);
          this.plates.push({ x: sign.x, y: sign.y + 0.053, z: sign.z, yaw, street: [Math.floor(sign.x), Math.floor(sign.z)] });
        }
      }
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.visible = counts[i] > 0; // no draw call (nor shadow pass) for a kind with nothing to show
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      const al = m.geometry.attributes.aLamp as InstancedBufferAttribute | undefined;
      if (al) al.needsUpdate = true;
    });
  }

  /** for the console and tests: chunks near, built, tiles cached, furniture drawn */
  stats() {
    let near = 0, built = 0, tiles = 0, tris = 0;
    for (const e of this.entries.values()) {
      if (e.near) near++;
      if (e.mesh) { built++; tris += (e.mesh.geometry.index?.count ?? 0) / 3; }
      tiles += e.tiles.size;
    }
    return { chunks: this.entries.size, near, built, tiles, tris, furniture: this.meshes.reduce((n, m) => n + m.count, 0) };
  }
}

/** congestion smoothed (0..1) to a wear level 0..3 */
const wearLevel = (w: number) => (w > 0.45 ? 3 : w > 0.25 ? 2 : w > 0.1 ? 1 : 0);
