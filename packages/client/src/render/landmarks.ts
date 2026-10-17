import {
  Group, Mesh, InstancedMesh, MeshLambertMaterial, BufferGeometry, TorusGeometry, CylinderGeometry, SphereGeometry, BoxGeometry, CircleGeometry, RingGeometry,
  Matrix4, Vector3, Quaternion, Color, Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, KIND_ID, hash2, zoneOf, levelOf, kindIdOf, isRoad, isAnchorAux, auxOrientation, placedFromAnchor } from '@msimcity/shared';
import { LONDON_EYE, BIG_BEN } from '@msimcity/shared/src/buildings/landmarks-london-2';
import type { ClientChunk } from '../world';
import { nightUniform } from './materials';

/**
 * The moving and lit parts of the London landmarks (shared/src/buildings/landmarks-london-2.ts), which a recipe cannot
 * hold: the London Eye's wheel and capsules turning, and Big Ben's four dials, lit at night, with hands at the game's
 * time. Each landmark standing in a loaded chunk gets a small group placed as chunkView places the structure (centred
 * on its footprint, turned to its door); `frame` moves them from the game clock, so every client sees the same.
 *
 * Organic: each instance has its own hash. An Eye starts turning a little earlier or later than another, its wheel
 * stands at its own angle, and its rim lights take their own colour each night (mostly blue and white, now and then
 * something else); a dial switches on at its own darkness and burns at its own brightness.
 */

const EYE = LONDON_EYE, BB = BIG_BEN;
const EYE_KIND = KIND_ID['london-eye'], BIGBEN_KIND = KIND_ID['parliament'];
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpP = new Vector3(), tmpS = new Vector3(1, 1, 1), tmpC = new Color();

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the London Eye

/** Rim lights, by night: mostly the usual blue and white, now and then a show colour (hashed per wheel and night). */
const EYE_SHOWS = [0x3d8bff, 0x5aa0ff, 0x2f6dff, 0xdfe9ff, 0x3d8bff, 0x5aa0ff, 0xff4fa3, 0xb04dff, 0xff3b3b, 0x34d07a];

let eyeGeo: { rim: BufferGeometry; frame: BufferGeometry; capsule: BufferGeometry } | null = null;
/** The wheel in its own frame: centred on the hub, in the x-y plane (the axle along z). */
function eyeGeometry() {
  if (eyeGeo) return eyeGeo;
  const R = EYE.r, inner = R - 0.08;
  // the main rim (it carries the lights) and the two smaller rims of its truss
  const rim = new TorusGeometry(R, 0.024, 6, 112);
  const parts: BufferGeometry[] = [new TorusGeometry(inner, 0.009, 4, 96).translate(0, 0, 0.06), new TorusGeometry(inner, 0.009, 4, 96).translate(0, 0, -0.06)];
  const strut = (a: Vector3, b: Vector3, r: number) => {
    const d = b.clone().sub(a), len = d.length();
    const g = new CylinderGeometry(r, r, len, 3, 1, true);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, d.normalize()));
    return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  };
  for (let i = 0; i < EYE.capsules; i++) {
    const t = (i / EYE.capsules) * TAU, c = Math.cos(t), s = Math.sin(t);
    const onRim = new Vector3(s * R, c * R, 0);
    // the truss: struts from the two inner rims out to the main rim, and the cable spokes in to the hub
    for (const z of [-0.06, 0.06]) parts.push(strut(new Vector3(s * inner, c * inner, z), onRim, 0.006));
    const tz = i % 2 ? 0.13 : -0.13, ht = t + Math.PI / EYE.capsules;
    parts.push(strut(new Vector3(Math.sin(ht) * 0.16, Math.cos(ht) * 0.16, tz), new Vector3(Math.sin(ht) * inner, Math.cos(ht) * inner, i % 2 ? 0.06 : -0.06), 0.003));
  }
  const frame = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  // a capsule: an egg of glass along the axle, with a collar at each end where it is held
  const egg = new SphereGeometry(1, 16, 10).scale(0.072, 0.066, 0.13);
  const collars = [0.09, -0.09].map((z) => new TorusGeometry(0.06, 0.008, 4, 14).translate(0, 0, z));
  const capsule = mergeGeometries([egg, ...collars].map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  eyeGeo = { rim, frame, capsule };
  return eyeGeo;
}
const eyeFrameMat = new MeshLambertMaterial({ color: 0xe9edf1 });

interface EyeInst { kind: 'eye'; root: Group; wheel: Group; rim: Mesh; rimMat: MeshLambertMaterial; capMat: MeshLambertMaterial; caps: InstancedMesh; seed: number; open: [number, number]; phase: number; lit: number }

function makeEye(seed: number): EyeInst {
  const g = eyeGeometry();
  const root = new Group(), wheel = new Group();
  wheel.position.set(0, EYE.hubY, EYE.z);
  const rimMat = new MeshLambertMaterial({ color: 0xf2f4f6, emissive: 0x3d8bff, emissiveIntensity: 0 });
  const rim = new Mesh(g.rim, rimMat);
  const frame = new Mesh(g.frame, eyeFrameMat);
  for (const m of [rim, frame]) { m.castShadow = true; wheel.add(m); }
  const capMat = new MeshLambertMaterial({ color: 0xb7d3e4, emissive: 0xf4f7ff, emissiveIntensity: 0 });
  const caps = new InstancedMesh(g.capsule, capMat, EYE.capsules);
  caps.castShadow = true;
  caps.frustumCulled = false;
  root.add(wheel, caps);
  const h1 = hash2(seed, 71), h2 = hash2(seed, 113);
  return { kind: 'eye', root, wheel, rim, rimMat, capMat, caps, seed, open: [EYE.open[0] - 0.5 + h1, EYE.open[1] - 0.5 + h2], phase: hash2(seed, 29) * TAU, lit: 0.08 + 0.1 * hash2(seed, 5) };
}

/** Hours the wheel has run up to game time `t` (hours since day 0): it turns only while open, so the angle never jumps. */
function eyeRunHours(e: EyeInst, t: number): number {
  const [o0, o1] = e.open, day = Math.floor(t / 24), h = t - day * 24;
  return day * (o1 - o0) + Math.min(o1 - o0, Math.max(0, h - o0));
}

function updateEye(e: EyeInst, t: number, night: number) {
  const a = e.phase + (eyeRunHours(e, t) / EYE.turnHours) * TAU;
  e.wheel.rotation.z = a;
  // the capsules ride round on the rim but hang level
  for (let i = 0; i < EYE.capsules; i++) {
    const th = a + (i / EYE.capsules) * TAU;
    tmpP.set(-Math.sin(th) * EYE.capsuleR, EYE.hubY + Math.cos(th) * EYE.capsuleR, EYE.z);
    e.caps.setMatrixAt(i, tmpM.compose(tmpP, tmpQ.identity(), tmpS));
  }
  e.caps.instanceMatrix.needsUpdate = true;
  // lights: the rim's colour is chosen per wheel per night, and comes up at its own darkness
  const day = Math.floor((t - 12) / 24);
  const show = EYE_SHOWS[Math.floor(hash2(e.seed + day * 7, 41) * EYE_SHOWS.length)];
  e.rimMat.emissive.setHex(show);
  const on = smooth(e.lit, e.lit + 0.25, night);
  e.rimMat.emissiveIntensity = 1.1 * on;
  e.rimMat.color.setHex(0xf2f4f6).lerp(tmpC.setHex(0x202838), on);
  // the capsules glow while the wheel runs, dimmer once it has closed for the night
  const h = t - Math.floor(t / 24) * 24, running = h >= e.open[0] && h < e.open[1];
  e.capMat.emissiveIntensity = (running ? 0.75 : 0.25) * on;
}

// ---------------------------------------------------------------- Big Ben

let dialGeo: { face: BufferGeometry; ring: BufferGeometry; hour: BufferGeometry; minute: BufferGeometry } | null = null;
function dialGeometry() {
  if (dialGeo) return dialGeo;
  const r = BB.r - 0.006;
  dialGeo = {
    face: new CircleGeometry(r, 28),
    ring: mergeGeometries([new RingGeometry(r * 0.8, r * 0.86, 28).translate(0, 0, 0.001), new CircleGeometry(0.012, 10).translate(0, 0, 0.004)], false)!,
    // hands pointing up (12 o'clock) from the centre
    hour: new BoxGeometry(0.014, r * 0.55, 0.003).translate(0, r * 0.22, 0.003),
    minute: new BoxGeometry(0.009, r * 0.85, 0.003).translate(0, r * 0.38, 0.005),
  };
  return dialGeo;
}
const handMat = new MeshLambertMaterial({ color: 0x1b1d22 });

interface ClockInst { kind: 'clock'; root: Group; dials: { mat: MeshLambertMaterial; hour: Mesh; minute: Mesh; k: number }[]; seed: number; lit: number }

function makeClock(seed: number): ClockInst {
  const g = dialGeometry();
  const root = new Group();
  const dials: ClockInst['dials'] = [];
  // the four faces, each turned to look out of its side of the clock stage
  for (let f = 0; f < 4; f++) {
    const face = new Group();
    face.position.set(BB.x, BB.y, BB.z);
    face.rotation.y = (f * Math.PI) / 2;
    const mat = new MeshLambertMaterial({ color: 0xf6f1e2, emissive: 0xffe0a0, emissiveIntensity: 0 });
    const disc = new Mesh(g.face, mat), ring = new Mesh(g.ring, handMat), hour = new Mesh(g.hour, handMat), minute = new Mesh(g.minute, handMat);
    for (const m of [disc, ring, hour, minute]) { m.position.z = BB.face + 0.006; face.add(m); }
    root.add(face);
    dials.push({ mat, hour, minute, k: 0.85 + 0.3 * hash2(seed + f, 17) });
  }
  return { kind: 'clock', root, dials, seed, lit: 0.1 + 0.15 * hash2(seed, 3) };
}

function updateClock(c: ClockInst, t: number, night: number) {
  const h = ((t % 12) + 12) % 12, m = (t * 60) % 60;
  const on = smooth(c.lit, c.lit + 0.2, night);
  for (const d of c.dials) {
    d.hour.rotation.z = -(h / 12) * TAU;
    d.minute.rotation.z = -(m / 60) * TAU;
    d.mat.emissiveIntensity = 1.15 * d.k * on;
  }
}

// ---------------------------------------------------------------- placement in the city

type Inst = EyeInst | ClockInst;
const make = (kind: number, seed: number): Inst[] =>
  kind === EYE_KIND ? [makeEye(seed)] : kind === BIGBEN_KIND ? [makeClock(seed)] : [];
function update(i: Inst, t: number, night: number) {
  if (i.kind === 'eye') updateEye(i, t, night); else updateClock(i, t, night);
}

/** The kinds with moving or lit parts. */
const MOVING = new Set<number>([EYE_KIND, BIGBEN_KIND]);

/**
 * Every landmark with moving parts in the loaded chunks. `scanChunk` after a chunk's tiles change, `dropChunk` when it
 * unloads, `frame` once a frame with the game time in hours since day 0.
 */
export class LandmarkMotion {
  group = new Group();
  private perChunk = new Map<string, { insts: Inst[]; roots: Object3D[] }>();

  scanChunk(key: string, c: ClientChunk) {
    this.dropChunk(key);
    const insts: Inst[] = [], roots: Object3D[] = [];
    const x0 = c.cx * CHUNK_SIZE, z0 = c.cy * CHUNK_SIZE;
    for (let i = 0; i < c.tiles.length; i++) {
      const a = c.aux[i];
      if (!a || !isAnchorAux(a)) continue;
      const t = c.tiles[i];
      if (isRoad(t) || levelOf(t) === 0) continue;
      const kind = kindIdOf(zoneOf(t), c.sub[i]);
      if (!MOVING.has(kind)) continue;
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      const p = placedFromAnchor(kind, x, z, auxOrientation(a));
      const root = new Group();
      root.position.set(p.ax + p.w / 2, 0, p.ay + p.h / 2);
      root.quaternion.setFromAxisAngle(UP, (p.r * Math.PI) / 2);
      for (const inst of make(kind, x * 7919 + z * 104729)) { root.add(inst.root); insts.push(inst); }
      roots.push(root);
      this.group.add(root);
    }
    if (insts.length) this.perChunk.set(key, { insts, roots });
  }

  dropChunk(key: string) {
    const c = this.perChunk.get(key);
    if (!c) return;
    for (const r of c.roots) this.group.remove(r);
    for (const i of c.insts) if (i.kind === 'eye') { i.rimMat.dispose(); i.capMat.dispose(); i.caps.dispose(); } else for (const d of i.dials) d.mat.dispose();
    this.perChunk.delete(key);
  }

  frame(hours: number) {
    const night = nightUniform.value;
    for (const c of this.perChunk.values()) for (const i of c.insts) update(i, hours, night);
  }
}

/** The moving parts of one landmark kind for the building viewer: its group (in the model's frame) and how to move it. */
export function landmarkPreview(kind: number): { object: Object3D; update(hours: number, night: number): void } | null {
  if (!MOVING.has(kind)) return null;
  const insts = make(kind, 12345);
  const object = new Group();
  for (const i of insts) object.add(i.root);
  return { object, update: (hours, night) => { for (const i of insts) update(i, hours, night); } };
}
