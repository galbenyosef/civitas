import {
  BufferGeometry, BoxGeometry, CylinderGeometry, CircleGeometry, IcosahedronGeometry, Group, InstancedMesh, Matrix4,
  MeshBasicMaterial, Material, Quaternion, Euler, Vector3, Color, AdditiveBlending, DoubleSide, type Camera,
} from 'three';
import {
  TICKS_PER_DAY, helicoptersAt, heliState, heliTimetable, heliOperator, hash2,
  type Pad, type HeliState, type HeliType, type PadKind,
} from '@msimcity/shared';
import { chunkPads } from '@msimcity/shared/src/helipads';
import type { ClientChunk, ClientWorld } from '../world';
import { clientEnv } from '../airports';
import { Kit } from './kit';
import { vehicleMaterial, sceneUniforms } from './materials';

/**
 * Helicopters. The pads come from the buildings in the loaded chunks (shared/src/helipads.ts finds each design's
 * helipad and places it as chunkView places the model) and the flights from the shared pure schedule
 * `helicoptersAt(pads, tick)` (shared/src/helicopters.ts); this file only draws them.
 *
 * Model frame: +x forward, +y up, +z to the right, the origin between the skids on the ground. Two airframes: a
 * light twin on skids (air ambulance, police) and a longer medium twin with wheels and a T-shaped tailplane
 * (executive, royal). Per type, InstancedMeshes for the painted body and the operator's stripe (tinted per
 * instance), the unpainted parts (glass, skids, rotor head), the main rotor blades, the tail rotor and translucent
 * blur discs that come up with the rotor speed. Every airframe is its own: paint jitter and weathering, and the
 * rotors' phase, are per flight (organic rule). Lights: red and green nav, a red beacon, white strobes in flight and
 * a landing light near the pads.
 */

const MAX_HELIS = 24;
const RED = new Color(0xff2a20), GREEN = new Color(0x22ff55), WHITE = new Color(0xffffff), WARM = new Color(0xfff0c8);
const GLASS = 0x1f2c3a, DARK = 0x1a1c20, STEEL = 0x8a9096;
const GRIME = new Color(0x8f8a7e);

type V3 = [number, number, number];
/** cylinder along x, radius rFront at x1 and rBack at x0 */
const cylX = (rFront: number, rBack: number, x0: number, x1: number, y: number, z: number, seg = 10) =>
  new CylinderGeometry(rFront, rBack, x1 - x0, seg).rotateZ(-Math.PI / 2).translate((x0 + x1) / 2, y, z);

interface HeliModel {
  body: BufferGeometry; stripe: BufferGeometry; fixed: BufferGeometry;
  /** main rotor hub (blades turn about +y here), tail rotor hub (blades turn about +z), blade radii */
  hub: V3; tailHub: V3; rotorR: number; tailR: number; blades: number;
  navL: V3; navR: V3; tail: V3; beacon: V3; landing: V3;
  /** the pilot's eye */
  eye: V3;
}

/** A light twin: rounded cabin and glazed nose, slim tail boom with a fin, skids. */
function light(): HeliModel {
  const b = new Kit(), s = new Kit(), f = new Kit();
  const y = 0.13;
  b.part(cylX(0.078, 0.078, -0.08, 0.1, y, 0, 12), 0xffffff)
    .part(cylX(0.03, 0.078, 0.1, 0.22, y - 0.012, 0, 12), 0xffffff)
    .part(cylX(0.06, 0.03, -0.16, -0.08, y + 0.02, 0, 10), 0xffffff)
    .box(0.16, 0.05, 0.1, -0.03, y + 0.055, 0, 0xffffff) // engine deck
    .part(cylX(0.026, 0.016, -0.42, -0.12, y + 0.03, 0, 8), 0xffffff) // tail boom
    .part(new BoxGeometry(0.07, 0.12, 0.012).translate(-0.4, y + 0.09, 0), 0xffffff) // fin
    .box(0.05, 0.008, 0.14, -0.33, y + 0.03, 0, 0xffffff); // tailplane
  s.box(0.2, 0.026, 0.158, 0.0, y - 0.02, 0, 0xffffff).box(0.16, 0.012, 0.036, -0.27, y + 0.03, 0, 0xffffff).box(0.055, 0.03, 0.014, -0.4, y + 0.12, 0, 0xffffff);
  f.part(cylX(0.064, 0.072, 0.07, 0.2, y + 0.018, 0, 12), GLASS) // canopy
    .box(0.08, 0.04, 0.162, -0.02, y + 0.01, 0, GLASS) // cabin windows
    .cyl(0.012, 0.016, 0.05, -0.02, y + 0.1, 0, STEEL, 6); // mast
  for (const z of [-0.075, 0.075]) {
    f.part(cylX(0.008, 0.008, -0.13, 0.14, 0.008, z, 6), DARK).part(cylX(0.008, 0.008, 0.14, 0.17, 0.016, z, 6), DARK);
    for (const x of [-0.07, 0.08]) f.box(0.012, 0.075, 0.012, x, 0.008, z * 0.85, DARK);
  }
  return {
    body: b.build(), stripe: s.build(), fixed: f.build(), hub: [-0.02, y + 0.15, 0], tailHub: [-0.41, y + 0.1, 0.02], rotorR: 0.25, tailR: 0.05, blades: 4,
    navL: [-0.02, y + 0.02, -0.08], navR: [-0.02, y + 0.02, 0.08], tail: [-0.43, y + 0.03, 0], beacon: [-0.03, y + 0.085, 0], landing: [0.17, y - 0.06, 0], eye: [0.15, y + 0.04, 0.025],
  };
}

/** A medium twin: a longer cabin with a drooped nose, sponsons, wheels, a taller fin and a T-shaped tailplane. */
function medium(): HeliModel {
  const b = new Kit(), s = new Kit(), f = new Kit();
  const y = 0.15;
  b.part(cylX(0.088, 0.088, -0.12, 0.14, y, 0, 12), 0xffffff)
    .part(cylX(0.03, 0.088, 0.14, 0.3, y - 0.02, 0, 12), 0xffffff)
    .part(cylX(0.07, 0.03, -0.22, -0.12, y + 0.025, 0, 10), 0xffffff)
    .box(0.24, 0.055, 0.12, -0.05, y + 0.065, 0, 0xffffff)
    .part(cylX(0.03, 0.018, -0.54, -0.18, y + 0.04, 0, 8), 0xffffff)
    .part(new BoxGeometry(0.09, 0.15, 0.014).translate(-0.51, y + 0.11, 0), 0xffffff)
    .box(0.05, 0.008, 0.16, -0.53, y + 0.18, 0, 0xffffff); // T tailplane on the fin
  for (const z of [-1, 1]) b.box(0.12, 0.035, 0.035, -0.04, y - 0.06, z * 0.095, 0xffffff); // sponsons
  s.box(0.3, 0.03, 0.178, 0.0, y - 0.025, 0, 0xffffff).box(0.22, 0.014, 0.04, -0.34, y + 0.04, 0, 0xffffff).box(0.07, 0.035, 0.016, -0.51, y + 0.16, 0, 0xffffff);
  f.part(cylX(0.07, 0.082, 0.1, 0.27, y + 0.015, 0, 12), GLASS)
    .box(0.16, 0.042, 0.18, -0.03, y + 0.012, 0, GLASS)
    .cyl(0.014, 0.018, 0.06, -0.03, y + 0.12, 0, STEEL, 6);
  // wheels: a nose wheel and two mains under the sponsons
  f.box(0.01, 0.07, 0.01, 0.2, 0.02, 0, DARK).part(new CylinderGeometry(0.022, 0.022, 0.02, 8).rotateX(Math.PI / 2).translate(0.2, 0.022, 0), DARK);
  for (const z of [-1, 1]) f.box(0.012, 0.06, 0.012, -0.04, 0.03, z * 0.1, DARK).part(new CylinderGeometry(0.026, 0.026, 0.024, 8).rotateX(Math.PI / 2).translate(-0.04, 0.026, z * 0.11), DARK);
  return {
    body: b.build(), stripe: s.build(), fixed: f.build(), hub: [-0.03, y + 0.18, 0], tailHub: [-0.53, y + 0.11, 0.022], rotorR: 0.31, tailR: 0.06, blades: 5,
    navL: [-0.04, y - 0.06, -0.115], navR: [-0.04, y - 0.06, 0.115], tail: [-0.55, y + 0.05, 0], beacon: [-0.05, y + 0.095, 0], landing: [0.24, y - 0.08, 0], eye: [0.22, y + 0.045, 0.03],
  };
}

interface TypeMeshes {
  body: InstancedMesh; stripe: InstancedMesh; fixed: InstancedMesh;
  rotor: InstancedMesh; disc: InstancedMesh; tailRotor: InstancedMesh; tailDisc: InstancedMesh;
  model: HeliModel; n: number;
}

/** A livery colour as this airframe wears it: a touch of jitter, then weathering. */
function paint(out: Color, base: number, seed: number, k: number, wear: number): Color {
  const n = Math.floor(seed * 65536);
  out.setHex(base).offsetHSL((hash2(n, k) - 0.5) * 0.02, (hash2(n, k + 1) - 0.5) * 0.08, (hash2(n, k + 2) - 0.5) * 0.06);
  return out.lerp(GRIME, wear * 0.45).multiplyScalar(1 - wear * 0.2);
}

export class HelicoptersView {
  group = new Group();
  /** every pad in the loaded chunks, sorted by id: the schedule's input */
  pads: Pad[] = [];
  /** override the tick (screenshots, debugging); null follows the game clock */
  debugTick: number | null = null;
  states: HeliState[] = [];
  /** the helicopter under the cursor and the selected one, by flight id: drawn brighter */
  hover: number | null = null;
  selected: number | null = null;
  lastTick = 0;
  private chunks = new Map<string, Pad[]>();
  private picks: number[] = [];
  private types: Record<HeliType, TypeMeshes>;
  private lightBoxes: InstancedMesh;
  private glow: InstancedMesh;
  private glowMat: MeshBasicMaterial;
  private nLights = 0;
  /** accumulated rotor angles per flight, so a rotor spinning up or down never jumps */
  private spin = new Map<number, number>();
  private last = performance.now();
  private m = new Matrix4();
  private mi = new Matrix4();
  private tmp = new Matrix4();
  private q = new Quaternion();
  private e = new Euler(0, 0, 0, 'YZX');
  private p = new Vector3();
  private s = new Vector3();
  private col = new Color();

  constructor() {
    const vm = vehicleMaterial();
    const discMat = new MeshBasicMaterial({ color: 0x1c1f24, transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide });
    const mk = (g: BufferGeometry, mat: Material = vm, shadow = true) => {
      const mesh = new InstancedMesh(g, mat, MAX_HELIS);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = shadow;
      this.group.add(mesh);
      return mesh;
    };
    const make = (model: HeliModel): TypeMeshes => {
      // blades from the hub outwards, evenly spaced; the tail rotor's turn about z
      const bk = new Kit(), tk = new Kit();
      for (let i = 0; i < model.blades; i++) bk.part(new BoxGeometry(model.rotorR, 0.006, 0.022).translate(model.rotorR / 2, 0, 0).rotateY((i * 2 * Math.PI) / model.blades), DARK);
      bk.cyl(0.02, 0.02, 0.014, 0, -0.007, 0, STEEL, 8);
      for (let i = 0; i < 2; i++) tk.part(new BoxGeometry(0.012, model.tailR * 2, 0.004).rotateZ(i * Math.PI / 2), DARK);
      return {
        body: mk(model.body), stripe: mk(model.stripe), fixed: mk(model.fixed), rotor: mk(bk.build()),
        disc: mk(new CircleGeometry(model.rotorR, 24).rotateX(-Math.PI / 2), discMat, false),
        tailRotor: mk(tk.build(), vm, false), tailDisc: mk(new CircleGeometry(model.tailR, 12), discMat, false),
        model, n: 0,
      };
    };
    this.types = { light: make(light()), medium: make(medium()) };
    this.lightBoxes = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ toneMapped: false }), MAX_HELIS * 6);
    this.glowMat = new MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    this.glow = new InstancedMesh(new IcosahedronGeometry(1, 1), this.glowMat, MAX_HELIS * 6);
    for (const mesh of [this.lightBoxes, this.glow]) { mesh.count = 0; mesh.frustumCulled = false; this.group.add(mesh); }
  }

  /** Re-read one chunk's pads (after chunkView rebuilt it). */
  scanChunk(key: string, c: ClientChunk, world: ClientWorld) {
    const pads = chunkPads(c.cx, c.cy, clientEnv(world));
    const had = this.chunks.get(key);
    if (!pads.length && !had) return;
    if (pads.length) this.chunks.set(key, pads); else this.chunks.delete(key);
    this.rebuildPads();
  }
  dropChunk(key: string) { if (this.chunks.delete(key)) this.rebuildPads(); }
  private rebuildPads() { this.pads = [...this.chunks.values()].flat().sort((a, b) => a.id - b.id); }
  /** Replace the pads outright (previews and scripts). */
  setPads(list: Pad[]) { this.chunks.clear(); this.chunks.set('set', list.slice()); this.rebuildPads(); }

  frame(tick: number) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const night = sceneUniforms.uNight.value;
    const t = this.debugTick ?? tick;
    this.lastTick = t;
    this.glowMat.opacity = 0.25 + 0.3 * night;
    for (const tm of Object.values(this.types)) tm.n = 0;
    this.nLights = 0;
    this.picks.length = 0;
    helicoptersAt(this.pads, t, this.states);
    for (const s of this.states) {
      this.draw(s, dt, now / 1000, night, s.id === this.selected ? 1.3 + 0.2 * Math.sin(now / 260) : s.id === this.hover ? 1.25 : 1);
      this.picks.push(s.x, s.y + 0.15 * s.scale, s.z, s.id);
    }
    for (const tm of Object.values(this.types)) {
      for (const mesh of [tm.body, tm.stripe, tm.fixed, tm.rotor, tm.disc, tm.tailRotor, tm.tailDisc]) {
        mesh.count = tm.n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.lightBoxes.count = this.nLights; this.glow.count = this.nLights;
    for (const mesh of [this.lightBoxes, this.glow]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    if (this.spin.size > 64) { const alive = new Set(this.states.map((s) => s.id)); for (const id of [...this.spin.keys()]) if (!alive.has(id)) this.spin.delete(id); }
  }

  /** The helicopter under a screen point, by flight id, or null. */
  pick(px: number, py: number, camera: Camera, w: number, h: number, radius = 22): number | null {
    let best: number | null = null, bd = radius * radius;
    const v = new Vector3();
    camera.updateMatrixWorld();
    for (let i = 0; i < this.picks.length; i += 4) {
      v.set(this.picks[i], this.picks[i + 1], this.picks[i + 2]).project(camera);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h, d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) { bd = d; best = this.picks[i + 3]; }
    }
    return best;
  }
  /** A flight at `tick` (default: as drawn last frame); null once it has gone. */
  stateOf(flight: number, tick = this.lastTick): HeliState | null {
    const f = heliTimetable(this.pads, Math.floor(flight / 10000)).find((x) => x.id === flight);
    if (!f || tick < f.tStart || tick > f.tEnd) return null;
    return heliState(f, tick);
  }
  /** The pilot's eye (right-hand seat, just behind the canopy) and the airframe's orientation. */
  cockpitOf(s: HeliState): { x: number; y: number; z: number; q: Quaternion } {
    const e = this.types[s.type].model.eye;
    const q = new Quaternion().setFromEuler(new Euler(s.bank, -s.heading, s.pitch, 'YZX'));
    const p = new Vector3(e[0] * s.scale, e[1] * s.scale, e[2] * s.scale).applyQuaternion(q);
    return { x: s.x + p.x, y: s.y + p.y, z: s.z + p.z, q };
  }
  /** Every helicopter at a tick (debugging, screenshots). */
  at(tick: number): HeliState[] { return helicoptersAt(this.pads, tick); }
  /** Debug helper: the first tick from `from` when a helicopter of this service (any if omitted) is in `phase`. */
  findPhase(phase: HeliState['phase'], from: number, kind?: PadKind, span = TICKS_PER_DAY * 2): number | null {
    for (let t = from; t < from + span; t += 0.5) for (const s of helicoptersAt(this.pads, t)) if (s.phase === phase && (!kind || s.kind === kind)) return t;
    return null;
  }

  private draw(s: HeliState, dt: number, time: number, night: number, lift: number) {
    const tm = this.types[s.type];
    const i = tm.n;
    if (i >= MAX_HELIS) return;
    tm.n++;
    const md = tm.model;
    const sc = Math.max(0.001, s.fade) * s.scale;
    this.p.set(s.x, s.y + 0.004, s.z);
    this.q.setFromEuler(this.e.set(s.bank, -s.heading, s.pitch, 'YZX'));
    this.s.set(sc, sc, sc);
    this.m.compose(this.p, this.q, this.s);
    for (const mesh of [tm.body, tm.stripe, tm.fixed]) mesh.setMatrixAt(i, this.m);
    const op = heliOperator(s.flight), wear = hash2(Math.floor(s.seed * 65536), 41) ** 2 * 0.35;
    tm.body.setColorAt(i, paint(this.col, op.body, s.seed, 50, wear).multiplyScalar(lift));
    tm.stripe.setColorAt(i, paint(this.col, op.stripe, s.seed, 60, wear).multiplyScalar(lift));
    tm.fixed.setColorAt(i, this.col.setScalar(lift));

    // rotors: the angle accumulates with the rotor speed, from a per-flight phase
    const a = (this.spin.get(s.id) ?? s.seed * 6.28) + dt * 42 * s.rotor;
    this.spin.set(s.id, a);
    const blur = s.rotor > 0.25 ? Math.min(1, (s.rotor - 0.25) * 2) : 0;
    this.tmp.copy(this.m).multiply(this.mi.makeTranslation(md.hub[0], md.hub[1], md.hub[2])).multiply(this.mi.makeRotationY(a));
    tm.rotor.setMatrixAt(i, this.tmp);
    tm.rotor.setColorAt(i, this.col.setScalar(1 - 0.5 * blur));
    this.tmp.copy(this.m).multiply(this.mi.makeTranslation(md.hub[0], md.hub[1] + 0.002, md.hub[2])).multiply(this.mi.makeScale(blur || 0.0001, 1, blur || 0.0001));
    tm.disc.setMatrixAt(i, this.tmp);
    this.tmp.copy(this.m).multiply(this.mi.makeTranslation(md.tailHub[0], md.tailHub[1], md.tailHub[2])).multiply(this.mi.makeRotationZ(a * 2.7));
    tm.tailRotor.setMatrixAt(i, this.tmp);
    this.tmp.copy(this.m).multiply(this.mi.makeTranslation(md.tailHub[0], md.tailHub[1], md.tailHub[2] + 0.002)).multiply(this.mi.makeScale(blur || 0.0001, blur || 0.0001, 1));
    tm.tailDisc.setMatrixAt(i, this.tmp);

    // lights
    const lt = s.lights, ms = time * 1000 + s.seed * 1900;
    const strobeOn = lt.strobe && ((ms % 1300) < 60);
    const beaconOn = lt.beacon && ((ms % 1000) < 380);
    const add = (pos: V3, size: number, color: Color, glowSize: number) => {
      if (this.nLights >= MAX_HELIS * 6) return;
      const k = this.nLights++;
      this.tmp.copy(this.m).multiply(this.mi.makeTranslation(pos[0], pos[1], pos[2]));
      this.p.setFromMatrixPosition(this.tmp);
      this.mi.makeScale(size * sc, size * sc, size * sc).setPosition(this.p);
      this.lightBoxes.setMatrixAt(k, this.mi);
      this.lightBoxes.setColorAt(k, color);
      this.mi.makeScale(glowSize * sc, glowSize * sc, glowSize * sc).setPosition(this.p);
      this.glow.setMatrixAt(k, this.mi);
      this.glow.setColorAt(k, color);
    };
    if (lt.nav) { add(md.navL, 0.014, RED, 0.03 + 0.03 * night); add(md.navR, 0.014, GREEN, 0.03 + 0.03 * night); add(md.tail, 0.012, WHITE, 0.025 + 0.02 * night); }
    if (beaconOn) add(md.beacon, 0.018, RED, 0.05 + 0.05 * night);
    if (strobeOn) add(md.tail, 0.018, WHITE, 0.08 + 0.08 * night);
    if (lt.landing) add(md.landing, 0.02, WARM, 0.05 + 0.08 * night);
  }
}
