import { InstancedMesh, Group, Matrix4, Quaternion, Vector3, Color, SphereGeometry, MeshBasicMaterial, AdditiveBlending, DynamicDrawUsage } from 'three';
import { CHUNK_SIZE, hash2, isRoad, isRailAux, railMask, crossingState, BARRIER_MOVE, type RailService } from '@msimcity/shared';
import type { ClientChunk } from '../world';
import { Kit } from './kit';
import { vehicleMaterial, sceneUniforms } from './materials';

/**
 * Level crossings (shared/src/rail.ts, docs/rail.md "Level crossings"): on each approach a post on the right-hand
 * kerb just short of the track, with a pair of red lamps and an amber one facing the oncoming traffic, and a red and
 * white half-barrier across the approach lane. When the timetable says a train is due (`crossingState`, the same pure
 * function the server holds traffic by) the amber shows, the reds flash alternately (wig-wag) and the arm comes down;
 * once the train has cleared, the lamps go out and the arm rises. Each crossing flashes at its own phase and rate and
 * each post stands a little differently (organic rule); the timing itself is the timetable's, as safety needs.
 */

const MAX_RIGS = 2048;
/** post: from the tile centre, back along the approach and out to the right-hand kerb */
const BACK = 0.33, KERB = 0.44;
const ARM_Y = 0.105, ARM_LEN = 0.4;
const LAMP_Y = 0.19, LAMP_X = 0.024, LAMP_Z = 0.014, AMBER_Y = 0.155;
/** ticks the amber shows before the reds start */
const AMBER = 2;

interface Rig { x: number; z: number; m: Matrix4; seed: number }

function postGeometry() {
  const k = new Kit();
  k.cyl(0.011, 0.014, 0.23, 0, 0, 0, 0x30333a, 6);
  k.box(0.035, 0.05, 0.03, 0, ARM_Y - 0.03, 0, 0x30333a); // the barrier's motor housing
  k.box(0.085, 0.04, 0.008, 0, LAMP_Y - 0.02, 0.004, 0x15161a); // backboard
  k.box(0.022, 0.022, 0.008, 0, AMBER_Y - 0.011, 0.004, 0x15161a);
  for (const x of [-LAMP_X, LAMP_X]) k.part(new SphereGeometry(0.011, 8, 6).translate(x, LAMP_Y, LAMP_Z), 0x3a0d0b);
  k.part(new SphereGeometry(0.008, 8, 6).translate(0, AMBER_Y, LAMP_Z), 0x3a2a08);
  // the cross on top (white with a red edge)
  k.box(0.09, 0.012, 0.006, 0, 0.235, 0, 0xf2f2ee);
  return k.build();
}
function armGeometry() {
  // along local -x from the pivot: red and white bands, a little weight at the pivot end
  const k = new Kit();
  const n = 6, seg = ARM_LEN / n;
  for (let i = 0; i < n; i++) k.box(seg, 0.012, 0.01, -seg * (i + 0.5), -0.006, 0, i % 2 ? 0xf4f4f0 : 0xd22b22);
  k.box(0.04, 0.022, 0.016, 0.02, -0.011, 0, 0x30333a);
  return k.build();
}

export class CrossingsView {
  group = new Group();
  private cands = new Map<string, number[]>(); // chunk key -> x, z, track mask per crossing tile
  private rigs: Rig[] = [];
  private dirty = false;
  private posts: InstancedMesh;
  private arms: InstancedMesh;
  /** lit lamps: red and amber, and their glows at night */
  private red: InstancedMesh;
  private amber: InstancedMesh;
  private halo: InstancedMesh[];
  private st = { down: false, since: Infinity };
  private one = { down: false, since: Infinity };
  private m = new Matrix4(); private q = new Quaternion(); private p = new Vector3(); private s = new Vector3(1, 1, 1);
  private lamp = new Matrix4(); private col = new Color();

  constructor() {
    const mat = vehicleMaterial();
    this.posts = new InstancedMesh(postGeometry(), mat, MAX_RIGS);
    this.arms = new InstancedMesh(armGeometry(), mat, MAX_RIGS);
    const lit = (c: number, r: number) => new InstancedMesh(new SphereGeometry(r, 10, 8), new MeshBasicMaterial({ color: c, toneMapped: false }), MAX_RIGS);
    this.red = lit(0xff2e22, 0.013);
    this.amber = lit(0xffb326, 0.0095);
    this.halo = [this.red, this.amber].map((src, i) => {
      const h = new InstancedMesh(new SphereGeometry(i ? 0.024 : 0.034, 10, 8),
        new MeshBasicMaterial({ color: i ? 0xffb326 : 0xff2e22, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), MAX_RIGS);
      h.instanceMatrix = src.instanceMatrix;
      h.renderOrder = 2;
      return h;
    });
    for (const mesh of [this.posts, this.arms, this.red, this.amber, ...this.halo]) {
      mesh.count = 0; mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.posts.castShadow = this.arms.castShadow = true;
    for (const mesh of [this.arms, this.red, this.amber]) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  }

  /** Record a chunk's level crossings (call after its tiles or aux bytes change). */
  scanChunk(key: string, c: ClientChunk) {
    const out: number[] = [];
    for (let i = 0; i < c.aux.length; i++) {
      if (!isRailAux(c.aux[i]) || !isRoad(c.tiles[i])) continue;
      out.push(c.cx * CHUNK_SIZE + (i % CHUNK_SIZE), c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE), railMask(c.aux[i]));
    }
    const had = this.cands.has(key);
    if (out.length) this.cands.set(key, out); else this.cands.delete(key);
    if (had || out.length) this.dirty = true;
  }
  dropChunk(key: string) { if (this.cands.delete(key)) this.dirty = true; }

  private rebuild() {
    this.dirty = false;
    this.rigs = [];
    const up = new Vector3(0, 1, 0);
    for (const list of this.cands.values()) for (let i = 0; i < list.length; i += 3) {
      const x = list[i], z = list[i + 1], ns = list[i + 2] === 5; // track north-south: the road and its traffic run east-west
      for (const sgn of [1, -1]) {
        if (this.rigs.length >= MAX_RIGS) break;
        const hx = ns ? sgn : 0, hz = ns ? 0 : sgn, rx = -hz, rz = hx; // heading of the approach, and its right
        const seed = hash2(x * 7 + sgn, z * 11 - sgn);
        const back = BACK + (seed - 0.5) * 0.04, kerb = KERB + (hash2(z * 5 + sgn, x * 3) - 0.5) * 0.02;
        this.p.set(x + 0.5 - hx * back + rx * kerb, 0, z + 0.5 - hz * back + rz * kerb);
        this.q.setFromAxisAngle(up, Math.atan2(-hx, -hz) + (seed - 0.5) * 0.08); // facing the oncoming cars, set by hand
        this.rigs.push({ x, z, m: new Matrix4().compose(this.p, this.q, this.s), seed });
      }
    }
    const tint = new Color();
    this.rigs.forEach((r, i) => { this.posts.setMatrixAt(i, r.m); this.posts.setColorAt(i, tint.setScalar(0.85 + 0.25 * r.seed)); });
    this.posts.count = this.rigs.length;
    this.posts.instanceMatrix.needsUpdate = true;
    if (this.posts.instanceColor) this.posts.instanceColor.needsUpdate = true;
  }

  /** Arms and lamps for `tick` (fractional), from the running lines' timetables. */
  frame(tick: number, services: readonly RailService[]) {
    if (this.dirty) this.rebuild();
    const night = sceneUniforms.uNight.value;
    this.halo.forEach((h, i) => { h.visible = night > 0.05; (h.material as MeshBasicMaterial).opacity = (i ? 0.35 : 0.45) * night; });
    const now = performance.now() / 1000;
    let nr = 0, na = 0;
    const roll = new Quaternion(), zAxis = new Vector3(0, 0, 1);
    for (let i = 0; i < this.rigs.length; i++) {
      const r = this.rigs[i];
      // a rig's two posts share a crossing: work its state out once
      if (i === 0 || this.rigs[i - 1].x !== r.x || this.rigs[i - 1].z !== r.z) this.stateAt(r.x, r.z, tick, services);
      const { down, since } = this.st;
      // how far the arm is down, 0 (up) to 1 (across the lane): it starts after the amber and takes BARRIER_MOVE
      const lower = down ? Math.min(1, Math.max(0, (since - AMBER) / BARRIER_MOVE)) : 1 - Math.min(1, since / BARRIER_MOVE);
      const ease = lower * lower * (3 - 2 * lower);
      roll.setFromAxisAngle(zAxis, -(1 - ease) * 1.45);
      this.m.copy(r.m).multiply(this.lamp.compose(this.p.set(0, ARM_Y, 0.022), roll, this.s));
      this.arms.setMatrixAt(i, this.m);
      if (!down) continue;
      if (since < AMBER) { this.amber.setMatrixAt(na++, this.m.copy(r.m).multiply(this.lamp.makeTranslation(0, AMBER_Y, LAMP_Z + 0.003))); continue; }
      // wig-wag: the two reds alternate, each crossing at its own rate and phase (both posts of a crossing together)
      const seed = hash2(r.x * 13 + 1, r.z * 17 + 3), rate = 1.3 + 0.25 * seed;
      const side = Math.floor(now * rate * 2 + seed * 2) & 1 ? LAMP_X : -LAMP_X;
      this.red.setMatrixAt(nr, this.m.copy(r.m).multiply(this.lamp.makeTranslation(side, LAMP_Y, LAMP_Z + 0.003)));
      this.red.setColorAt(nr++, this.col.setScalar(0.85 + 0.15 * r.seed));
    }
    this.arms.count = this.rigs.length;
    this.red.count = this.halo[0].count = nr;
    this.amber.count = this.halo[1].count = na;
    for (const mesh of [this.arms, this.red, this.amber]) mesh.instanceMatrix.needsUpdate = true;
    if (this.red.instanceColor) this.red.instanceColor.needsUpdate = true;
  }

  /** The barriers of the crossing (x, z) over every line that runs across it, into this.st. */
  private stateAt(x: number, z: number, tick: number, services: readonly RailService[]) {
    let down = false, since = Infinity, downSince = 0;
    const s = this.one;
    for (const svc of services) {
      crossingState(svc, x, z, tick, s);
      if (s.down) { down = true; downSince = Math.max(downSince, s.since); }
      else since = Math.min(since, s.since);
    }
    this.st.down = down; this.st.since = down ? downSince : since;
  }
}
