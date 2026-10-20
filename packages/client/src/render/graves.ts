import { BufferGeometry, BoxGeometry, CylinderGeometry, ConeGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, MeshLambertMaterial, Matrix4, Quaternion, Euler, Vector3, Color, Group, type Camera } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  TICKS_PER_DAY, GRAVE_STRIDE, GRAVE_PLAQUE, STONE_TONES, Stone, DEATH, chunkKey, chunkOf, hash2, footprintPoint, plotSpots, restDesign, isRestKind, stoneLook,
  type GraveSiteDTO,
} from '@msimcity/shared';
import type { ClientWorld } from '../world';
import { Kit } from './kit';

/**
 * Headstones (docs/remembrance.md, shared/src/remembrance.ts): one stone on every filled plot of every churchyard and
 * cemetery, a memorial plaque in a crematorium's garden of remembrance, from the `graves` message. Each chunk's stones are
 * one instanced mesh: the shapes (a rounded tablet, a square one, a cross, an obelisk, a ledger slab, a plaque) are merged
 * into one geometry and the vertex shader keeps only the instance's own (`aShape` against `iShape`). Every stone is its
 * own (stoneLook, hashed from the deceased's id): shape, size, a lean and a tilt that grow with the years, the stone's
 * colour weathering darker and greener, fresh flowers on a new grave that wilt after a few weeks and come back on some
 * anniversaries. A funeral under way shows its open grave, a mound of earth and the mourners round it, each figure its
 * own coat, height, place and a bowed head or not.
 */

const SHAPES = 6;
const DAY = TICKS_PER_DAY;
const MAX_MOURNERS = 64, MAX_OPEN = 8;
const UP = new Vector3(0, 1, 0);

/** The merged stone shapes, authored a unit high and a unit wide (scaled per stone by height and width), each tagged with its shape. */
function stoneGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const shape = (k: Kit, id: number) => { const g = k.build(); const n = g.attributes.position.count; g.setAttribute('aShape', new Float32BufferAttribute(new Float32Array(n).fill(id), 1)); parts.push(g); };
  const W = 0xffffff, BASE = 0xd8d4cc;
  // rounded tablet on a little plinth
  shape(new Kit().box(1.2, 0.1, 0.45, 0, 0, 0.02, BASE).box(1, 0.74, 0.22, 0, 0.1, 0, W).part(new CylinderGeometry(0.5, 0.5, 0.22, 12).rotateX(Math.PI / 2).translate(0, 0.84, 0), W), Stone.Rounded);
  // square tablet with shoulders
  shape(new Kit().box(1.2, 0.1, 0.42, 0, 0, 0.02, BASE).box(1, 0.8, 0.2, 0, 0.1, 0, W).box(0.66, 0.12, 0.2, 0, 0.9, 0, W), Stone.Square);
  // a plain cross on a stepped base
  shape(new Kit().box(0.8, 0.12, 0.55, 0, 0, 0, BASE).box(0.55, 0.1, 0.4, 0, 0.12, 0, W).box(0.26, 0.78, 0.2, 0, 0.22, 0, W).box(0.86, 0.22, 0.2, 0, 0.62, 0, W), Stone.Cross);
  // an obelisk: a block, the shaft, a pyramid cap
  shape(new Kit().box(1, 0.16, 1, 0, 0, 0, BASE).box(0.62, 0.7, 0.62, 0, 0.16, 0, W).part(new ConeGeometry(0.44, 0.16, 4).rotateY(Math.PI / 4).translate(0, 0.94, 0), W), Stone.Pillar);
  // a ledger slab lying on the grave, a raised panel on top
  shape(new Kit().box(1, 0.75, 1.8, 0, 0, -0.4, W).box(0.82, 0.25, 1.6, 0, 0.75, -0.4, BASE), Stone.Ledger);
  // a memorial plaque, a small plate tipped up on its block
  shape(new Kit().box(1, 0.6, 0.7, 0, 0, 0, 0x9a968c).part(new BoxGeometry(0.92, 0.4, 0.62).rotateX(-0.5).translate(0, 0.75, 0), W), Stone.Plaque);
  return mergeGeometries(parts, false)!;
}
/** A posy laid at a stone: a few stems and blooms (the blooms take the instance's colour). */
function posyGeometry(): BufferGeometry {
  const k = new Kit();
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7, x = 0.012 * Math.cos(a), z = 0.01 * Math.sin(a);
    k.cyl(0.0015, 0.0015, 0.018, x, 0, z, 0x4a6a34, 3).box(0.009, 0.007, 0.009, x, 0.016, z, 0xffffff);
  }
  k.box(0.03, 0.004, 0.018, 0, 0, 0, 0x556b3a);
  return k.build();
}
/** An open grave and its mound of earth under a green cloth. */
function openGraveGeometry(): BufferGeometry {
  return new Kit().box(0.066, 0.004, 0.12, 0, 0.012, 0, 0x2a2018).box(0.078, 0.004, 0.13, 0, 0.011, 0, 0x6a5038).box(0.05, 0.034, 0.11, 0.075, 0.012, 0, 0x7a5c3e).box(0.056, 0.006, 0.116, 0.075, 0.042, 0, 0x4f7a3c).build();
}
/** A mourner: a long coat (the instance's colour) and, on its own mesh, the head. */
function coatGeometry(): BufferGeometry { return new Kit().box(0.034, 0.012, 0.022, 0, 0, 0, 0x222222).part(new CylinderGeometry(0.013, 0.019, 0.075, 6).translate(0, 0.012 + 0.0375, 0), 0xffffff).box(0.04, 0.012, 0.024, 0, 0.078, 0, 0xffffff).build(); }
function headGeometry(): BufferGeometry { return new Kit().part(new CylinderGeometry(0.011, 0.011, 0.02, 6).translate(0, 0.098, 0), 0xffffff).build(); }

const COATS = [0x1b1c20, 0x23262e, 0x2e2a2c, 0x1f2a3a, 0x3a3236, 0x2b2b2b, 0x3b3f46, 0x352a3a].map((c) => new Color(c));
const SKIN = [0xf1c8a6, 0xd9a47c, 0xb57d54, 0x8a5a3a, 0x5e3b26, 0xe8b996].map((c) => new Color(c));
const MOSS = new Color(0x56653f), WILTED = new Color(0x8a6a48);

/** The stones' material: Lambert, the instance colour on the vertex colours, and only the instance's own shape drawn. */
function stoneMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aShape;\nattribute float iShape;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (abs(aShape - iShape) > 0.5) transformed = vec3(0.0);');
  };
  m.customProgramCacheKey = () => 'graves-stone';
  return m;
}

interface ChunkStones { stones: InstancedMesh; posies: InstancedMesh; shape: InstancedBufferAttribute }
/** a stone as picking knows it: where its middle stands, and whose it is */
interface Pickable { x: number; y: number; z: number; id: number }

export class GravesView {
  readonly group = new Group();
  private stoneGeo = stoneGeometry();
  private posyGeo = posyGeometry();
  private stoneMat = stoneMaterial();
  private plainMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private chunks = new Map<string, ChunkStones>();
  private sites: GraveSiteDTO[] = [];
  private sig = '';
  private builtDay = -1;
  /** sites whose chunk was not loaded at the last build: built again once one is */
  private waiting: GraveSiteDTO[] = [];
  private waitCheck = 0;
  private picks: Pickable[] = [];
  private open: InstancedMesh; private coats: InstancedMesh; private heads: InstancedMesh;
  private m = new Matrix4(); private q = new Quaternion(); private e = new Euler(0, 0, 0, 'YXZ'); private p = new Vector3(); private s = new Vector3(); private c = new Color();
  private v = new Vector3();

  constructor(private world: ClientWorld) {
    const mk = (g: BufferGeometry, n: number) => { const im = new InstancedMesh(g, this.plainMat, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; this.group.add(im); return im; };
    this.open = mk(openGraveGeometry(), MAX_OPEN); this.open.castShadow = false;
    this.coats = mk(coatGeometry(), MAX_MOURNERS);
    this.heads = mk(headGeometry(), MAX_MOURNERS);
  }

  /** The graves message: every resting place's filled plots and the funerals under way. */
  set(list: GraveSiteDTO[]) {
    this.sites = list;
    const sig = JSON.stringify(list.map((s) => [s.x, s.y, s.g]));
    if (sig !== this.sig) { this.sig = sig; this.builtDay = -1; }
    this.funerals(-1);
  }

  /** Once a frame: stones again when the graves changed, a new game day came (flowers, weathering) or a waiting chunk arrived. */
  frame(tick: number, now: number) {
    const day = Math.floor(tick / DAY);
    if (this.waiting.length && now > this.waitCheck) { this.waitCheck = now + 1000; if (this.waiting.some((s) => this.world.structureAt(s.x, s.y))) this.builtDay = -1; }
    if (day !== this.builtDay) this.build(tick);
    this.funerals(tick);
  }

  private build(tick: number) {
    this.builtDay = Math.floor(tick / DAY);
    for (const c of this.chunks.values()) { this.group.remove(c.stones, c.posies); c.stones.dispose(); c.posies.dispose(); }
    this.chunks.clear();
    this.picks = [];
    this.waiting = [];
    // stones by chunk
    const by = new Map<string, { site: GraveSiteDTO; i: number }[]>();
    for (const site of this.sites) {
      const st = this.world.structureAt(site.x, site.y);
      if (!st || !isRestKind(st.kind)) { if (site.g.length) this.waiting.push(site); continue; }
      for (let i = 0; i < site.g.length; i += GRAVE_STRIDE) {
        const key = chunkKey(chunkOf(st.ax), chunkOf(st.ay));
        let l = by.get(key);
        if (!l) by.set(key, l = []);
        l.push({ site, i });
      }
    }
    for (const [key, list] of by) {
      const shape = new InstancedBufferAttribute(new Float32Array(list.length), 1);
      const geo = this.stoneGeo.clone();
      geo.setAttribute('iShape', shape);
      const stones = new InstancedMesh(geo, this.stoneMat, list.length);
      const posies = new InstancedMesh(this.posyGeo, this.plainMat, list.length);
      stones.castShadow = true; stones.receiveShadow = true; posies.castShadow = false;
      let n = 0, f = 0;
      for (const { site, i } of list) {
        const st = this.world.structureAt(site.x, site.y)!;
        const slot = site.g[i], id = site.g[i + 1], buried = site.g[i + 2], plaque = (site.g[i + 3] & GRAVE_PLAQUE) !== 0;
        const spots = plotSpots(st.kind, restDesign(st.kind, st.ax, st.ay));
        const at = spots[slot];
        if (!at) continue;
        const [wx, wz] = footprintPoint(st, at[0], at[1]);
        const look = stoneLook(id, buried, tick, plaque);
        const yaw = (st.r * Math.PI) / 2 + look.yaw;
        this.e.set(-look.lean, yaw, look.tilt, 'YXZ');
        this.q.setFromEuler(this.e);
        this.p.set(wx, 0.012, wz);
        this.s.set(look.w, look.h, look.w);
        this.m.compose(this.p, this.q, this.s);
        stones.setMatrixAt(n, this.m);
        const tone = this.c.setHex(STONE_TONES[look.tone]);
        tone.lerp(MOSS, look.weather * 0.45).multiplyScalar(1 - 0.28 * look.weather);
        stones.setColorAt(n, tone);
        shape.setX(n, look.shape);
        this.picks.push({ x: wx, y: 0.012 + look.h * 0.6, z: wz, id });
        n++;
        if (look.flowers) {
          // laid at the foot of the stone, towards the path (the model's front), a little to one side
          const fx = Math.sin(yaw) * (look.shape === Stone.Ledger ? 0.02 : 0.022) + Math.cos(yaw) * 0.012 * (hash2(id, 7) - 0.5);
          const fz = Math.cos(yaw) * (look.shape === Stone.Ledger ? 0.02 : 0.022) - Math.sin(yaw) * 0.012 * (hash2(id, 7) - 0.5);
          this.q.setFromAxisAngle(UP, yaw + hash2(id, 9) * 2);
          this.p.set(wx + fx, 0.014, wz + fz);
          this.s.setScalar(plaque ? 0.8 : 1);
          this.m.compose(this.p, this.q, this.s);
          posies.setMatrixAt(f, this.m);
          posies.setColorAt(f, look.flowers === 1 ? this.c.setHex(look.bloom) : WILTED);
          f++;
        }
      }
      stones.count = n; posies.count = f;
      stones.instanceMatrix.needsUpdate = true; posies.instanceMatrix.needsUpdate = true;
      if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
      if (posies.instanceColor) posies.instanceColor.needsUpdate = true;
      shape.needsUpdate = true;
      stones.computeBoundingSphere(); posies.computeBoundingSphere();
      this.group.add(stones, posies);
      this.chunks.set(key, { stones, posies, shape });
    }
  }

  /** Funerals under way: the open grave, the mound and the mourners round it (or at the chapel door for a cremation). */
  private funerals(tick: number) {
    let no = 0, nm = 0;
    for (const site of this.sites) {
      const f = site.f;
      if (!f) continue;
      const st = this.world.structureAt(site.x, site.y);
      if (!st) continue;
      const spots = plotSpots(st.kind, restDesign(st.kind, st.ax, st.ay));
      const at = f.slot >= 0 ? spots[f.slot] : undefined;
      const yaw = (st.r * Math.PI) / 2;
      let cx: number, cz: number;
      if (at && no < MAX_OPEN) {
        [cx, cz] = footprintPoint(st, at[0], at[1]);
        this.q.setFromAxisAngle(UP, yaw); this.p.set(cx, 0, cz); this.s.setScalar(1);
        this.m.compose(this.p, this.q, this.s);
        this.open.setMatrixAt(no++, this.m);
      } else {
        // a cremation, or no plot: they gather on the path inside the gate
        cx = site.x + 0.5 - Math.sin(yaw) * 0.3; cz = site.y + 0.5 - Math.cos(yaw) * 0.3;
      }
      // mourners: those there now, or a few as they arrive; the grave's family gather on its far side, each their own
      const n = Math.min(DEATH.mournersMax + 2, Math.max(f.n, tick >= 0 && tick < f.t0 + DAY / 48 ? 1 : 2) + 1);
      for (let i = 0; i < n && nm < MAX_MOURNERS; i++) {
        const h = hash2(f.id * 13 + i, 71), a = (i - (n - 1) / 2) * 0.62 + (h - 0.5) * 0.3, r = 0.1 + 0.035 * hash2(f.id + i, 73);
        // around the grave, on the side away from the road; facing it
        const ang = yaw + Math.PI + a;
        const mx = cx + Math.sin(ang) * r, mz = cz + Math.cos(ang) * r;
        const face = Math.atan2(cx - mx, cz - mz);
        const bow = hash2(f.id, i * 5 + 3) < 0.45 ? 0.18 : 0.04;
        const tall = (i === 0 ? 0.9 : 0.95) + 0.12 * hash2(f.id * 3 + i, 75);
        this.e.set(bow * 0.4, face, 0, 'YXZ'); this.q.setFromEuler(this.e);
        this.p.set(mx, 0.012, mz); this.s.set(1, tall, 1);
        this.m.compose(this.p, this.q, this.s);
        this.coats.setMatrixAt(nm, this.m);
        this.coats.setColorAt(nm, COATS[Math.floor(hash2(f.id * 7 + i, 77) * COATS.length)]);
        this.e.set(bow, face, 0, 'YXZ'); this.q.setFromEuler(this.e); this.m.compose(this.p, this.q, this.s);
        this.heads.setMatrixAt(nm, this.m);
        this.heads.setColorAt(nm, SKIN[Math.floor(hash2(f.id * 11 + i, 79) * SKIN.length)]);
        nm++;
      }
    }
    for (const [im, k] of [[this.open, no], [this.coats, nm], [this.heads, nm]] as const) {
      im.count = k; im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** The headstone under the pointer (screen pixels), or null: the nearest stone within a small radius. */
  pick(px: number, py: number, camera: Camera, width: number, height: number): number | null {
    if (!this.group.visible || !this.picks.length) return null;
    let best: number | null = null, bd = 13 * 13;
    const cam = (camera as unknown as { position: Vector3 }).position;
    for (const s of this.picks) {
      this.v.set(s.x, s.y, s.z);
      if (cam.distanceTo(this.v) > 60) continue;
      this.v.project(camera);
      if (this.v.z > 1) continue;
      const sx = (this.v.x + 1) * 0.5 * width, sy = (1 - this.v.y) * 0.5 * height;
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) { bd = d; best = s.id; }
    }
    return best;
  }
  /** Where a headstone stands (to fly to it from a panel), or null when it is not drawn. */
  where(id: number): [number, number] | null {
    const s = this.picks.find((p) => p.id === id);
    return s ? [s.x, s.z] : null;
  }
  get count() { let n = 0; for (const c of this.chunks.values()) n += c.stones.count; return n; }
}
