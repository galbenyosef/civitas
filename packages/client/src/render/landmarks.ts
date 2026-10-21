import {
  Group, Mesh, InstancedMesh, MeshLambertMaterial, BufferGeometry, TorusGeometry, CylinderGeometry, SphereGeometry, BoxGeometry, CircleGeometry, RingGeometry,
  Matrix4, Vector3, Quaternion, Color, Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, KIND_ID, Terrain, hash2, zoneOf, levelOf, kindIdOf, isRoad, terrainOf, isAnchorAux, auxOrientation, placedFromAnchor, FRONT, isBridgeAux, bridgeNS, bridgeStyle, BridgeStyle,
  basculeLiftAt, basculeOpen, basculeSeed, BASCULE_LIFT } from '@msimcity/shared';
import { LONDON_EYE, BIG_BEN, TOWER_BRIDGE } from '@msimcity/shared/src/buildings/landmarks-london-2';
import { CLOCK_TOWER } from '@msimcity/shared/src/buildings/landmark-drafts';
import type { ClientChunk } from '../world';
import { nightUniform } from './materials';

/**
 * The moving and lit parts of the London landmarks (shared/src/buildings/landmarks-london-2.ts), which a recipe cannot
 * hold: the London Eye's wheel and capsules turning, Big Ben's four dials, lit at night, with hands at the game's
 * time, and Tower Bridge's bascules rising for a passing sailing barge. Each landmark standing in a loaded chunk gets a small group placed as chunkView places the structure (centred
 * on its footprint, turned to its door); `frame` moves them from the game clock, so every client sees the same.
 *
 * Organic: each instance has its own hash. An Eye starts turning a little earlier or later than another, its wheel
 * stands at its own angle, and its rim lights take their own colour each night (mostly blue and white, now and then
 * something else); a dial switches on at its own darkness and burns at its own brightness; each bridge lifts its own
 * number of times a day, at its own hours.
 */

const EYE = LONDON_EYE, BB = BIG_BEN, TB = TOWER_BRIDGE;
const EYE_KIND = KIND_ID['london-eye'], BRIDGE_KIND = KIND_ID['tower-bridge'];
/** Clock towers: kind id to where its dials stand (the constant its recipe file exports, BIG_BEN's shape). A new clock tower is one more row. */
interface ClockSpec { x: number; z: number; y: number; face: number; r: number }
const CLOCKS = new Map<number, ClockSpec>([[KIND_ID['parliament'], BB], [KIND_ID['town-clock-tower'], CLOCK_TOWER]]);
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpP = new Vector3(), tmpS = new Vector3(1, 1, 1), tmpC = new Color();

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the London Eye

/** Rim lights, by night: the usual blues and white, and on about one night in eight a show colour (hashed per wheel and night). */
const EYE_USUAL = [0x3d8bff, 0x5aa0ff, 0x2f6dff, 0xcfe0ff], EYE_SHOWS = [0xff4fa3, 0xb04dff, 0xff3b3b, 0x34d07a];

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
  const pick = hash2(e.seed + day * 7, 41), list = pick < 0.125 ? EYE_SHOWS : EYE_USUAL;
  const show = list[Math.floor(hash2(e.seed + day * 7, 43) * list.length)];
  e.rimMat.emissive.setHex(show);
  const on = smooth(e.lit, e.lit + 0.25, night);
  e.rimMat.emissiveIntensity = 1.1 * on;
  e.rimMat.color.setHex(0xf2f4f6).lerp(tmpC.setHex(0x202838), on);
  // the capsules glow while the wheel runs, dimmer once it has closed for the night
  const h = t - Math.floor(t / 24) * 24, running = h >= e.open[0] && h < e.open[1];
  e.capMat.emissiveIntensity = (running ? 0.75 : 0.25) * on;
}

// ---------------------------------------------------------------- Big Ben

const dialGeos = new Map<number, { face: BufferGeometry; ring: BufferGeometry; hour: BufferGeometry; minute: BufferGeometry }>();
function dialGeometry(radius: number) {
  const cached = dialGeos.get(radius);
  if (cached) return cached;
  const r = radius - 0.006;
  const dialGeo = {
    face: new CircleGeometry(r, 28),
    ring: mergeGeometries([new RingGeometry(r * 0.8, r * 0.86, 28).translate(0, 0, 0.001), new CircleGeometry(0.012, 10).translate(0, 0, 0.004)], false)!,
    // hands pointing up (12 o'clock) from the centre
    hour: new BoxGeometry(0.014, r * 0.55, 0.003).translate(0, r * 0.22, 0.003),
    minute: new BoxGeometry(0.009, r * 0.85, 0.003).translate(0, r * 0.38, 0.005),
  };
  dialGeos.set(radius, dialGeo);
  return dialGeo;
}
const handMat = new MeshLambertMaterial({ color: 0x1b1d22 });

interface ClockInst { kind: 'clock'; root: Group; dials: { mat: MeshLambertMaterial; hour: Mesh; minute: Mesh; k: number }[]; seed: number; lit: number }

function makeClock(seed: number, spec: ClockSpec): ClockInst {
  const g = dialGeometry(spec.r);
  const root = new Group();
  const dials: ClockInst['dials'] = [];
  // the four faces, each turned to look out of its side of the clock stage
  for (let f = 0; f < 4; f++) {
    const face = new Group();
    face.position.set(spec.x, spec.y, spec.z);
    face.rotation.y = (f * Math.PI) / 2;
    const mat = new MeshLambertMaterial({ color: 0xf6f1e2, emissive: 0xffe0a0, emissiveIntensity: 0 });
    const disc = new Mesh(g.face, mat), ring = new Mesh(g.ring, handMat), hour = new Mesh(g.hour, handMat), minute = new Mesh(g.minute, handMat);
    for (const m of [disc, ring, hour, minute]) { m.position.z = spec.face + 0.006; face.add(m); }
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

// ---------------------------------------------------------------- Tower Bridge

let leafGeo: { deck: BufferGeometry; girders: BufferGeometry; rails: BufferGeometry } | null = null;
let bargeGeo: { hull: BufferGeometry; rig: BufferGeometry; sails: BufferGeometry } | null = null;
/** A bascule leaf in its hinge's frame: reaching from the hinge towards -z, its road on top at y = 0. */
function leafGeometry() {
  if (leafGeo) return leafGeo;
  const L = TB.leaf, W = TB.width;
  leafGeo = {
    deck: new BoxGeometry(W, 0.03, L).translate(0, -0.015, -L / 2),
    girders: mergeGeometries([-1, 1].map((sx) => new BoxGeometry(0.03, 0.07, L).translate(sx * 0.265, -0.035, -L / 2).toNonIndexed()), false)!,
    rails: mergeGeometries([-1, 1].map((sx) => new BoxGeometry(0.012, 0.012, L).translate(sx * 0.265, 0.046, -L / 2).toNonIndexed()), false)!,
  };
  return leafGeo;
}
/** A Thames sailing barge along +x: black hull, mast and sprit, red-brown sails. */
function bargeGeometry() {
  if (bargeGeo) return bargeGeo;
  bargeGeo = {
    hull: new BoxGeometry(0.5, 0.06, 0.13).translate(0, 0.03, 0),
    rig: mergeGeometries([new CylinderGeometry(0.006, 0.008, 0.55, 4).translate(0.04, 0.33, 0).toNonIndexed(), new BoxGeometry(0.26, 0.05, 0.11).translate(-0.12, 0.085, 0).toNonIndexed()], false)!,
    sails: mergeGeometries([new BoxGeometry(0.26, 0.4, 0.006).translate(-0.09, 0.33, 0.01).toNonIndexed(), new BoxGeometry(0.14, 0.2, 0.006).translate(0.15, 0.2, 0.01).toNonIndexed()], false)!,
  };
  return bargeGeo;
}
const deckMat = new MeshLambertMaterial({ color: 0x3a3d44 }), blueMat = new MeshLambertMaterial({ color: 0x86b2da }), whiteMat = new MeshLambertMaterial({ color: 0xf6f2ea });
const hullMat = new MeshLambertMaterial({ color: 0x24262b }), rigMat = new MeshLambertMaterial({ color: 0x5a3d26 }), sailMat = new MeshLambertMaterial({ color: 0x9a4527 });

interface BridgeInst { kind: 'bridge'; root: Group; leaves: Group[]; barge: Group; river: boolean; seed: number }

function makeBridge(seed: number, river: boolean): BridgeInst {
  const g = leafGeometry(), b = bargeGeometry();
  const root = new Group(), leaves: Group[] = [];
  for (const side of [1, -1]) {
    const hinge = new Group();
    hinge.position.set(0, TB.deckY, side * TB.hinge);
    if (side < 0) hinge.rotation.y = Math.PI; // the -z leaf is the +z one turned round
    for (const [geo, mat] of [[g.deck, deckMat], [g.girders, blueMat], [g.rails, whiteMat]] as const) { const m = new Mesh(geo, mat); m.castShadow = true; hinge.add(m); }
    root.add(hinge);
    leaves.push(hinge);
  }
  const barge = new Group();
  for (const [geo, mat] of [[b.hull, hullMat], [b.rig, rigMat], [b.sails, sailMat]] as const) { const m = new Mesh(geo, mat); m.castShadow = true; barge.add(m); }
  barge.visible = false;
  root.add(barge);
  return { kind: 'bridge', root, leaves, barge, river, seed };
}

/** The leaves follow the shared lift schedule (shared/src/bridges.ts basculeLiftAt), the one the server's barriers keep. */
function updateBridge(b: BridgeInst, t: number, hidden: ((seed: number, day: number) => boolean) | null) {
  const start = basculeLiftAt(b.seed, t), u = t - start;
  const angle = basculeOpen(b.seed, t) * (80 * Math.PI) / 180;
  for (const l of b.leaves) l.rotation.x = angle;
  // the barge comes down the river while the leaves rise and is through before they fall (only where there is a river)
  // a span with real boats booked into its lifts (render/boats.ts, shared boatLifts) hands over to them
  b.barge.visible = b.river && !Number.isNaN(start) && !(hidden && hidden(b.seed, Math.floor(t / 24)));
  if (b.barge.visible) {
    const dir = hash2(b.seed + Math.floor(start * 10), 3) < 0.5 ? 1 : -1;
    b.barge.position.set(dir * (-3 + (6 * u) / BASCULE_LIFT), 0.004, 0.05 * dir);
    b.barge.rotation.y = dir > 0 ? 0 : Math.PI;
  }
}

// ---------------------------------------------------------------- placement in the city

type Inst = EyeInst | ClockInst | BridgeInst;
const make = (kind: number, seed: number, river: boolean): Inst[] =>
  kind === EYE_KIND ? [makeEye(seed)] : CLOCKS.has(kind) ? [makeClock(seed, CLOCKS.get(kind)!)] : kind === BRIDGE_KIND ? [makeBridge(seed, river)] : [];
function update(i: Inst, t: number, night: number, hidden: ((seed: number, day: number) => boolean) | null = null) {
  if (i.kind === 'eye') updateEye(i, t, night); else if (i.kind === 'clock') updateClock(i, t, night); else updateBridge(i, t, hidden);
}

/** The kinds with moving or lit parts. */
const MOVING = new Set<number>([EYE_KIND, BRIDGE_KIND, ...CLOCKS.keys()]);

/**
 * Every landmark with moving parts in the loaded chunks. `scanChunk` after a chunk's tiles change (`getTile` reads
 * neighbours: a bridge shows its barge only with water either side), `dropChunk` when it unloads, `frame` once a frame
 * with the game time in hours since day 0.
 */
export class LandmarkMotion {
  group = new Group();
  private perChunk = new Map<string, { insts: Inst[]; roots: Object3D[] }>();

  scanChunk(key: string, c: ClientChunk, getTile: (x: number, y: number) => number | undefined) {
    this.dropChunk(key);
    const insts: Inst[] = [], roots: Object3D[] = [];
    const x0 = c.cx * CHUNK_SIZE, z0 = c.cy * CHUNK_SIZE;
    for (let i = 0; i < c.tiles.length; i++) {
      const a = c.aux[i];
      if (isBridgeAux(a) && bridgeStyle(a) === BridgeStyle.Bascule && isRoad(c.tiles[i])) { this.bascule(c, i, a, insts, roots); continue; }
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
      // a river across a bridge: water beside the middle of its span on both sides
      const [fx, fy] = FRONT[p.r], mx = Math.floor(p.ax + p.w / 2), my = Math.floor(p.ay + p.h / 2);
      const wet = (dx: number, dy: number) => { const w = getTile(mx + dx, my + dy); return w !== undefined && terrainOf(w) === Terrain.Water; };
      const px = -fy, py = fx, reach = Math.floor((px ? p.w : p.h) / 2) + 1;
      const river = wet(px * reach, py * reach) && wet(-px * reach, -py * reach);
      for (const inst of make(kind, basculeSeed(x, z), river)) { root.add(inst.root); insts.push(inst); }
      roots.push(root);
      this.group.add(root);
    }
    if (insts.length) this.perChunk.set(key, { insts, roots });
  }

  /**
   * A bascule bridge span (shared/src/bridges.ts) is Tower Bridge on a real road crossing (chunkView draws the model,
   * render/bridges.ts the ramps): its leaves and barge from the span's first deck tile, centred on the span and turned
   * along it, stretched to its length as the model is. The river is always there.
   */
  private bascule(c: ClientChunk, i: number, a: number, insts: Inst[], roots: Object3D[]) {
    const x = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE), z = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
    const ns = bridgeNS(a), dx = ns ? 0 : 1, dz = ns ? 1 : 0;
    const at = (tx: number, tz: number) => { const lx = tx - c.cx * CHUNK_SIZE, lz = tz - c.cy * CHUNK_SIZE; return lx >= 0 && lz >= 0 && lx < CHUNK_SIZE && lz < CHUNK_SIZE ? c.aux[lz * CHUNK_SIZE + lx] : this.auxAt(tx, tz); };
    if (at(x - dx, z - dz) === a) return; // not the span's first tile
    let len = 1;
    while (len < 24 && at(x + dx * len, z + dz * len) === a) len++;
    const root = new Group();
    root.position.set(x + (ns ? 0.5 : len / 2), 0, z + (ns ? len / 2 : 0.5));
    root.quaternion.setFromAxisAngle(UP, ns ? 0 : Math.PI / 2);
    root.scale.set(1, 1, len / 4);
    for (const inst of make(BRIDGE_KIND, basculeSeed(x, z), true)) { root.add(inst.root); insts.push(inst); }
    roots.push(root);
    this.group.add(root);
  }
  /** aux bytes beyond the chunk being scanned (a span running into the next chunk); 0 where not loaded */
  auxAt: (x: number, y: number) => number = () => 0;

  dropChunk(key: string) {
    const c = this.perChunk.get(key);
    if (!c) return;
    for (const r of c.roots) this.group.remove(r);
    for (const i of c.insts) if (i.kind === 'eye') { i.rimMat.dispose(); i.capMat.dispose(); i.caps.dispose(); } else if (i.kind === 'clock') for (const d of i.dials) d.mat.dispose();
    this.perChunk.delete(key);
  }

  /** is this bascule span's decorative barge replaced by a real boat on this day? (set by main from BoatsView.liftBooked) */
  bargeHidden: ((seed: number, day: number) => boolean) | null = null;

  /** pins the game time the landmarks show (debugging and screenshots: `msc.landmarks.fixedHours = 31.2`); null follows the clock */
  fixedHours: number | null = null;

  frame(hours: number) {
    if (this.fixedHours !== null) hours = this.fixedHours;
    const night = nightUniform.value;
    for (const c of this.perChunk.values()) for (const i of c.insts) update(i, hours, night, this.bargeHidden);
  }
}

/** The moving parts of one landmark kind for the building viewer: its group (in the model's frame) and how to move it. */
export function landmarkPreview(kind: number): { object: Object3D; update(hours: number, night: number): void } | null {
  if (!MOVING.has(kind)) return null;
  const insts = make(kind, 12345, true);
  const object = new Group();
  for (const i of insts) object.add(i.root);
  return { object, update: (hours, night) => { for (const i of insts) update(i, hours, night); } };
}
