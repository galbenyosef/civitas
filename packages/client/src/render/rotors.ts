import {
  BufferGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Shape, Group, InstancedMesh, Matrix4, Quaternion,
  Vector3, type Camera,
} from 'three';
import { ROTOR_MOUNTS, ROTOR, rotorTarget, rotorStep, windAt, windYaw, hash2 } from '@msimcity/shared';
import { Kit } from './kit';
import { vehicleMaterial } from './materials';

/**
 * The wind turbines' rotors (docs/utilities.md 4.5). The kit builds each tower (shared/src/buildings/utilities.ts); this
 * pass draws what stands on it and moves: a nacelle that yaws to face the wind, a hub with a spinner and three tapered,
 * twisted blades turning at a speed the wind sets while the plant is generating (the server's hourly `p` field: its
 * output as a percent of its rating), winding down over ten seconds when it is not: unstaffed, mothballed, out of any
 * network, or with no demand to serve. Two instanced meshes (the nacelles and the rotors), one draw call each for every
 * turbine in range.
 *
 * Organic rule: each tower has its own rotor phase, a speed within about 10% of its neighbours', and its own offset from
 * the wind's heading, and it follows a change of heading at its own pace; two rotors never turn in step. The state (angle,
 * speed, heading) lives in a map by tile, so a chunk rebuild that re-places the tower changes nothing.
 *
 * Cost: a turbine more than RANGE tiles from every camera is neither updated nor drawn (its angle waits); none in range
 * hides the group and the draws go away; in range it is a handful of matrix writes a frame.
 */
const MAX = 512, RANGE = 190;
/** the heading follows the wind at most this fast, rad/s */
const YAW_RATE = 0.05;

interface Turbine {
  key: string; x: number; z: number;
  /** pivot (world), the tower's scale, its blade length in model units, its tile */
  px: number; py: number; pz: number; s: number; r: number;
  tileX: number; tileZ: number;
}
interface State { angle: number; speed: number; yaw: number; phase0: number; jitter: number; offset: number }

const WHITE = 0xf3f4f1, GREY = 0xc9cdd2, DARK = 0x4a4f58;

/** the nacelle: a housing on the pivot, a darker rear cowl and the cooling fins; origin at the tower's axis, +z into the wind */
function nacelleGeometry(): BufferGeometry {
  const k = new Kit(), len = ROTOR.nacelleLen, hgt = ROTOR.nacelleHeight;
  k.box(0.052, hgt, len, 0, 0, len * 0.2, WHITE);
  k.box(0.046, hgt * 0.7, 0.03, 0, hgt * 0.05, -len * 0.3 + 0.004, GREY);
  k.box(0.016, 0.01, 0.036, 0, hgt, len * 0.05, GREY); // the anemometer boom
  return k.build();
}

/**
 * Three blades and the hub, in the rotor's frame: axis +z, the hub at the origin, blades along +x/+y/..., each a thin
 * extruded outline (chord broadest near the root, narrowing to the tip, the trailing edge bowed) twisted from the root to
 * the tip like a real blade, with a spinner cone and a hub drum.
 */
export function bladeGeometry(r: number): BufferGeometry {
  const r0 = 0.02, L = r - r0, N = 12;
  const chord = (u: number) => (u < 0.14 ? 0.05 + 0.012 * (u / 0.14) : 0.062 * (1 - 0.82 * ((u - 0.14) / 0.86) ** 0.85));
  const lead: [number, number][] = [], trail: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, c = chord(u), x = r0 + u * L;
    lead.push([x, c * 0.28]);
    trail.push([x, -c * (0.72 - 0.1 * Math.sin(u * Math.PI))]); // the trailing edge bows out a little
  }
  const shape = new Shape();
  shape.moveTo(lead[0][0], lead[0][1]);
  for (const [x, y] of lead) shape.lineTo(x, y);
  for (let i = N; i >= 0; i--) shape.lineTo(trail[i][0], trail[i][1]);
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false, steps: 1 }).translate(0, 0, -0.003);
  // pitch twist: about 16 degrees at the root easing to 0 at the tip, turning the chord out of the rotor plane
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), u = Math.min(1, Math.max(0, (x - r0) / L));
    const a = 0.28 * (1 - u) ** 1.4, cs = Math.cos(a), sn = Math.sin(a);
    pos.setXYZ(i, x, y * cs - z * sn, y * sn + z * cs);
  }
  const k = new Kit();
  for (let b = 0; b < 3; b++) k.part(geo.clone().rotateZ((b * 2 * Math.PI) / 3), WHITE);
  geo.dispose();
  k.part(new CylinderGeometry(0.02, 0.02, 0.034, 10).rotateX(Math.PI / 2).translate(0, 0, 0.002), GREY);
  k.part(new ConeGeometry(0.02, 0.04, 10).rotateX(Math.PI / 2).translate(0, 0, 0.038), WHITE);
  const g = k.build();
  g.computeVertexNormals();
  return g;
}

export class RotorsView {
  readonly group = new Group();
  /** the world seed (the wind is hashed from it, the same signal the server's wind output follows) */
  seed = 0;
  /** a plant's output percent at its tile, or undefined when the server has not said (then it turns by the wind alone, until it does) */
  output: (x: number, y: number) => number | undefined = () => undefined;
  /** whether the server has said anything about plants yet: before that every rotor turns, so a joining client never sees them stopped */
  told: () => boolean = () => false;
  /** turbines in range last frame */
  inRange = 0;
  /** the last frame's cost, ms */
  lastMs = 0;
  private perChunk = new Map<string, Turbine[]>();
  private state = new Map<string, State>();
  private nacelle: InstancedMesh; private rotor: InstancedMesh;
  private last = performance.now();
  private head = new Matrix4(); private hub = new Matrix4(); private spin = new Matrix4(); private tmp = new Matrix4();
  private q = new Quaternion(); private qz = new Quaternion(); private p = new Vector3(); private sc = new Vector3(); private v = new Vector3();
  private up = new Vector3(0, 1, 0); private zAxis = new Vector3(0, 0, 1);
  private bladeR = 0;
  private frames = 0;

  constructor() {
    const mat = vehicleMaterial();
    const mk = (g: BufferGeometry, material = mat, shadow = true) => {
      const m = new InstancedMesh(g, material, MAX);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = false;
      this.group.add(m);
      return m;
    };
    // the tallest tower's blade length sets the geometry; shorter towers scale it
    const rMax = Math.max(...Object.values(ROTOR_MOUNTS).map((m) => m.r));
    this.bladeR = rMax;
    this.nacelle = mk(nacelleGeometry());
    this.rotor = mk(bladeGeometry(rMax));
    this.group.visible = false;
  }

  /** One chunk's buildings were (re)placed: keep the turbines among them. `items` is every placement of the chunk. */
  setChunk(key: string, items: { key: string; matrix: Matrix4; sign?: unknown }[]) {
    const list: Turbine[] = [];
    for (const it of items) {
      const m = ROTOR_MOUNTS[it.key];
      if (!m || !it.sign) continue; // not a turbine, or a site's shell that is still rising
      const e = it.matrix.elements, s = Math.hypot(e[0], e[1], e[2]);
      this.v.set(m.x, m.y, m.z).applyMatrix4(it.matrix);
      list.push({ key: it.key, x: e[12], z: e[14], px: this.v.x, py: this.v.y, pz: this.v.z, s, r: m.r, tileX: Math.floor(e[12]), tileZ: Math.floor(e[14]) });
    }
    if (list.length) this.perChunk.set(key, list); else this.perChunk.delete(key);
  }
  /** a chunk's buildings are being replaced or dropped: its towers' state stays (a rebuild places them again next), and is pruned later */
  clear(key: string) { this.perChunk.delete(key); }
  /** forget the state of towers that no chunk holds any more (a demolished turbine's next one starts afresh) */
  private prune() {
    const live = new Set<string>();
    for (const l of this.perChunk.values()) for (const t of l) live.add(`${t.tileX},${t.tileZ}`);
    for (const k of this.state.keys()) if (!live.has(k)) this.state.delete(k);
  }
  /** how many turbines stand in the loaded chunks */
  count(): number { let n = 0; for (const l of this.perChunk.values()) n += l.length; return n; }
  /** a tower's spin state by tile, for the checks and the debugging console */
  stateAt(tx: number, tz: number): Readonly<State> | undefined { return this.state.get(`${tx},${tz}`); }

  frame(tick: number, cams: readonly Camera[], visible = true) {
    const t0 = performance.now();
    if (++this.frames % 600 === 0) this.prune();
    const dt = Math.min(0.1, (t0 - this.last) / 1000);
    this.last = t0;
    if (!visible || !this.perChunk.size || !cams.length) { this.group.visible = false; this.inRange = 0; this.lastMs = 0; return; }
    const wind = windAt(tick, this.seed), heading = windYaw(tick, this.seed), told = this.told();
    const r2 = RANGE * RANGE;
    let n = 0;
    for (const list of this.perChunk.values()) {
      for (const t of list) {
        let near = false;
        for (const c of cams) { const dx = c.position.x - t.px, dy = c.position.y - t.py, dz = c.position.z - t.pz; if (dx * dx + dy * dy + dz * dz < r2) { near = true; break; } }
        if (!near) continue;
        if (n >= MAX) break;
        const sk = `${t.tileX},${t.tileZ}`;
        let st = this.state.get(sk);
        if (!st) {
          const h = (k: number) => hash2(t.tileX * 31 + k, t.tileZ * 17 + 5 + k * 3);
          const offset = (h(2) - 0.5) * 0.5;
          st = { angle: h(1) * Math.PI * 2, speed: 0, yaw: heading + offset, phase0: h(3), jitter: 0.9 + 0.2 * h(4), offset };
          // a tower seen for the first time is already turning at its pace, not starting up from rest
          const pct = this.output(t.tileX, t.tileZ);
          if (pct === undefined ? !told : pct > 0) st.speed = rotorTarget(true, wind, st.jitter);
          this.state.set(sk, st);
        }
        const step = dt;
        const pct = this.output(t.tileX, t.tileZ);
        const generating = pct === undefined ? !told : pct > 0;
        const target = rotorTarget(generating, wind, st.jitter);
        const next = rotorStep(st.angle, st.speed, target, step);
        st.angle = next.angle; st.speed = next.speed;
        // the heading follows the wind slowly, by the short way round, its own offset kept
        let dy = heading + st.offset - st.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const maxStep = YAW_RATE * step * (0.7 + 0.6 * st.phase0);
        st.yaw += Math.abs(dy) < maxStep ? dy : Math.sign(dy) * maxStep;
        // the nacelle: at the pivot, turned to its heading, at the tower's scale
        this.q.setFromAxisAngle(this.up, st.yaw);
        this.p.set(t.px, t.py, t.pz); this.sc.set(t.s, t.s, t.s);
        this.head.compose(this.p, this.q, this.sc);
        this.nacelle.setMatrixAt(n, this.head);
        // the rotor: out to the hub, turned about the axis, scaled to this tower's blade length
        const bs = t.r / this.bladeR; // the tower's own blade length against the one geometry; the tower's scale is in the head's matrix
        this.hub.makeTranslation(0, ROTOR.hubY, ROTOR.hubZ);
        this.qz.setFromAxisAngle(this.zAxis, st.angle);
        this.spin.compose(this.p.set(0, 0, 0), this.qz, this.sc.set(bs, bs, bs));
        this.tmp.multiplyMatrices(this.head, this.hub).multiply(this.spin);
        this.rotor.setMatrixAt(n, this.tmp);
        n++;
      }
    }
    this.inRange = n;
    this.group.visible = n > 0;
    for (const m of [this.nacelle, this.rotor]) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    this.lastMs = performance.now() - t0;
  }
}
