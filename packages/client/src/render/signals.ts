import { InstancedMesh, Group, Matrix4, Quaternion, Vector3, Color, SphereGeometry, MeshBasicMaterial, MeshLambertMaterial, DynamicDrawUsage, AdditiveBlending, Shape, ShapeGeometry, type BufferGeometry } from 'three';
import {
  CHUNK_SIZE, isRoad, isJunctionAux, hash2, signalTiming, groupPhaseOf, signalArms, signalledArms, groupArms, junctionGroup, inGroup, linkedDegree,
  isClassAux, isDividedAux, isMotorwayAux, isRingClassAux, isDeckClassAux, isPedestrianAux, isFlyoverAux, oneWayDir, carStepOk, slipJunction,
  implicitPelican, pelicanPhase, TRAFFIC_TUNING, ARM_STEPS, type SignalTiming, type SignalPhase, type JunctionGroup, type RoadRule, type PelicanLamp,
} from '@msimcity/shared';
import type { ClientChunk } from '../world';
import { Kit } from './kit';
import { sceneUniforms } from './materials';

/** Road arms by tile mask bit (N=1 E=2 S=4 W=8, as the ground tiling uses), as the step toward that arm in x / z. */
const ARMS = ARM_STEPS;
/** DIRS order (E, W, S, N) as steps */
const CD: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Corner offset from the tile centre: on the sidewalk strip, just outside the walkers' line. */
const CORNER = 0.455;
const POLE_H = 0.3;
const HEAD_H = 0.17, HEAD_W = 0.065, HEAD_D = 0.05;
/** lamp centres in the head's frame (the head faces +z): green bottom, amber middle, red top */
const LAMP_Y = [POLE_H + 0.032, POLE_H + 0.085, POLE_H + 0.138];
const LAMP_Z = HEAD_D / 2;
const LAMP_R = 0.021;
const LIT = [0x38ff7a, 0xffb326, 0xff2e22];
const DIM = [0x0f2a17, 0x2e2108, 0x2e0c0a];
const MAX_HEADS = 4096;
/** a four-phase group's left-arrow head hangs beside the median pole's head, this far along the head's -x */
const ARROW_DX = -(HEAD_W + 0.012);
/** a pelican's red / green man: the lit figures' place on their box, in the pole's frame (it faces across the road, -x) */
const MAN_X = -0.032, MAN_Y = [0.215, 0.255], MAN_Z = 0;

/** What a head shows: a junction's through head, a four-phase group's left-arrow head, a pelican's car head or its walker's man. */
const enum Kind { Main, Left, Pel, Man }
interface Head {
  kind: Kind; ew: boolean; timing: SignalTiming; phases: number;
  matrix: Matrix4; glow: number;
  /** a pelican's tile (walkAt) */
  px?: number; pz?: number;
  /** the lamps moved off the head: a left-arrow head's round lamps (alt), a man's red and green figures (alt, alt2) */
  alt?: Matrix4; alt2?: Matrix4;
}

function poleGeometry(): BufferGeometry {
  const k = new Kit();
  k.cyl(0.012, 0.016, POLE_H, 0, 0, 0, 0x2b2e33, 6);
  k.box(HEAD_W, HEAD_H, HEAD_D, 0, POLE_H, 0, 0x1c1e22);
  k.box(HEAD_W * 1.5, 0.006, HEAD_D * 1.2, 0, POLE_H + HEAD_H, 0, 0x2b2e33); // cap
  for (let i = 0; i < 3; i++) k.part(new SphereGeometry(LAMP_R * 0.92, 8, 6).translate(0, LAMP_Y[i], LAMP_Z), DIM[i]);
  return k.build();
}
/** an arrow pointing to the head's +x (the left of a driver facing the head), in its xy plane, size s */
function arrowShape(s: number): Shape {
  const sh = new Shape();
  sh.moveTo(s, 0); sh.lineTo(0, s * 0.8); sh.lineTo(0, s * 0.3); sh.lineTo(-s, s * 0.3); sh.lineTo(-s, -s * 0.3); sh.lineTo(0, -s * 0.3); sh.lineTo(0, -s * 0.8); sh.closePath();
  return sh;
}
/** the left-arrow head: a housing beside the main head (no pole of its own), its green lamp an arrow */
function arrowHousing(): BufferGeometry {
  const k = new Kit();
  k.box(HEAD_W, HEAD_H, HEAD_D, ARROW_DX, POLE_H, 0, 0x1c1e22);
  k.box(0.02, 0.012, 0.012, ARROW_DX / 2, POLE_H + HEAD_H * 0.6, 0, 0x2b2e33); // the bracket to the main head
  for (let i = 1; i < 3; i++) k.part(new SphereGeometry(LAMP_R * 0.92, 8, 6).translate(ARROW_DX, LAMP_Y[i], LAMP_Z), DIM[i]);
  k.part(new ShapeGeometry(arrowShape(LAMP_R * 0.9)).translate(ARROW_DX, LAMP_Y[0], LAMP_Z + 0.001), DIM[0]);
  return k.build();
}
/** a pelican pole's extras: the push-button box facing the waiting walkers, the red/green man's box facing across the road */
function pelicanExtras(): BufferGeometry {
  const k = new Kit();
  k.box(0.03, 0.04, 0.022, 0, 0.1, -0.02, 0xd8c23a); // the button box (yellow) on the crossing's side of the pole
  k.box(0.012, 0.01, 0.006, 0, 0.122, -0.032, 0x1c1e22);
  k.box(0.028, 0.09, 0.05, MAN_X + 0.012, MAN_Y[0] - 0.03, MAN_Z, 0x1c1e22); // the man's box on the pole's far side
  for (const y of MAN_Y) k.box(0.004, 0.034, 0.034, MAN_X, y - 0.017, MAN_Z, 0x141516);
  return k.build();
}

/** What the lights need from the world beyond the tiles: road rules (pelicans) and each crossing's walk phase. */
export interface LightsWorld {
  roadRules: Map<string, RoadRule>;
  walkAt(x: number, y: number): number;
}

/**
 * The lights of junction tile (x, y) as the server works them out (sim/traffic.ts junction): its junction group (R4: an
 * avenue crossing's tiles are one junction, one controller timed from the anchor), whether it has lights by its layout
 * (the owner's technology aside: the caller's `signalled(g.x, g.y)`), and its phases (2, or 4 where divided roads
 * cross). Null for a tile that is no junction. No lights at a roundabout, flyover or mini-roundabout, on a ring or
 * motorway tile, nor where an interchange's slips meet its street.
 */
export function junctionLights(road: (x: number, y: number) => boolean, aux: (x: number, y: number) => number, x: number, y: number): { g: JunctionGroup; lit: boolean; phases: number } | null {
  const ca = (tx: number, ty: number) => { const a = aux(tx, ty); return isClassAux(a) ? a : 0; };
  const car = (tx: number, ty: number) => road(tx, ty) && !isPedestrianAux(ca(tx, ty));
  if (!car(x, y)) return null;
  const a = aux(x, y), c = ca(x, y);
  if (isFlyoverAux(a) || isDeckClassAux(c) || linkedDegree(road, ca, x, y) < 3) return null;
  const TT = TRAFFIC_TUNING;
  const gr = TT.groupSignals && isDividedAux(c) ? junctionGroup(road, ca, x, y) : null;
  if (gr && (gr.w > 1 || gr.h > 1)) {
    let bar = false;
    for (let ty = gr.y; ty < gr.y + gr.h; ty++) for (let tx = gr.x; tx < gr.x + gr.w; tx++) if (isMotorwayAux(ca(tx, ty)) || isJunctionAux(aux(tx, ty)) || isRingClassAux(ca(tx, ty))) bar = true;
    return { g: gr, lit: !bar && signalledArms(groupArms(car, gr)), phases: TT.groupSignals === 2 ? 2 : gr.phases };
  }
  const lit = !isJunctionAux(a) && !isMotorwayAux(c) && !isRingClassAux(c) && !slipJunction(ca, x, y) && signalledArms(signalArms(car, x, y));
  return { g: { x, y, w: 1, h: 1, phases: 2 }, lit, phases: 2 };
}

/**
 * Traffic lights at every signalled junction (three or more road arms, the parcel owner has the Traffic signals
 * technology): one pole on the right-hand near corner of each approach, its head facing the oncoming cars. An avenue
 * crossing (R4, a junction group) is one junction: its heads all take the anchor's timing, on the approaches into the
 * group from outside it; a divided road's approach has a second pole on its reservation's nose, and at a four-phase
 * group (two divided roads crossing) that pole carries a left-arrow head beside its own for the protected left phase.
 * Signal crossings (pelicans, R4) get a pole each way with the car head, a push-button box and the red/green man, lit
 * from the walk phase the server sends (pelicanPhase): amber, red, flashing amber, green.
 *
 * Poles, housings and unlit lamps are static instanced meshes; the lit lamps are three emissive instanced meshes (red,
 * amber, green) and the green arrow, holding only the lamps lit this frame, with a soft glow each after dark; a mesh
 * with nothing to show is hidden, so a town without these costs no draw calls. Phases come from the shared signal
 * timing, so they match what the server enforces without any wire traffic. Every pole stands a little differently,
 * lamps age to their own brightness, and each crossing flashes at its own rate.
 */
export class TrafficLights {
  group = new Group();
  private cands = new Map<string, number[]>(); // chunk key -> x, y, mask, kind (0 a junction, 1 a group's anchor, 2 a crossing) per entry
  private heads: Head[] = [];
  private poles: InstancedMesh;
  private arrows: InstancedMesh;
  private extras: InstancedMesh;
  private lit: InstancedMesh[];
  private litArrow: InstancedMesh;
  /** soft additive glow round each lit lamp, faded in with the night */
  private halo: InstancedMesh[];
  private dirty = false;
  private phase: SignalPhase = { green: 'ns', amber: false };
  private lastTick = NaN;
  private flashing = false;
  private tint = new Color();
  private road: (x: number, y: number) => boolean = () => false;
  private aux: (x: number, y: number) => number = () => 0;
  /** road rules and walk phases (main.ts sets it): signal crossings placed with the tool, and their lamps */
  world: LightsWorld | null = null;

  constructor() {
    const mk = (g: BufferGeometry, mat: MeshLambertMaterial | MeshBasicMaterial, shadow: boolean) => {
      const m = new InstancedMesh(g, mat, MAX_HEADS);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.visible = false;
      this.group.add(m);
      return m;
    };
    const lambert = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.poles = mk(poleGeometry(), lambert, true);
    this.arrows = mk(arrowHousing(), lambert, true);
    this.extras = mk(pelicanExtras(), lambert, true);
    this.lit = LIT.map((c, i) => {
      const m = mk(new SphereGeometry(LAMP_R * 1.18, 10, 8).translate(0, LAMP_Y[i], LAMP_Z + 0.004), new MeshBasicMaterial({ color: c, toneMapped: false }), false);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      return m;
    });
    this.litArrow = mk(new ShapeGeometry(arrowShape(LAMP_R * 1.05)).translate(ARROW_DX, LAMP_Y[0], LAMP_Z + 0.004), new MeshBasicMaterial({ color: LIT[0], toneMapped: false }), false);
    this.litArrow.instanceMatrix.setUsage(DynamicDrawUsage);
    const haloOf = (src: InstancedMesh, c: number, y: number, x = 0) => {
      const m = mk(new SphereGeometry(LAMP_R * 2.6, 10, 8).translate(x, y, LAMP_Z + 0.01),
        new MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), false);
      m.instanceMatrix = src.instanceMatrix; // same lamps, same matrices
      m.renderOrder = 2;
      return m;
    };
    this.halo = [...LIT.map((c, i) => haloOf(this.lit[i], c, LAMP_Y[i])), haloOf(this.litArrow, LIT[0], LAMP_Y[0], ARROW_DX)];
  }

  /** Record the junction tiles of a chunk (call after its tiles change). */
  scanChunk(key: string, chunk: ClientChunk, getTile: (x: number, y: number) => number | undefined, auxAt: (x: number, y: number) => number = () => 0) {
    const out: number[] = [];
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cy * CHUNK_SIZE;
    this.road = (x: number, z: number) => { const t = getTile(x, z); return t !== undefined && isRoad(t); };
    this.aux = auxAt;
    const road = this.road;
    const ca = (x: number, z: number) => { const a = auxAt(x, z); return isClassAux(a) ? a : 0; };
    const car = (x: number, z: number) => road(x, z) && !isPedestrianAux(ca(x, z));
    for (let i = 0; i < chunk.tiles.length; i++) {
      if (!isRoad(chunk.tiles[i])) continue;
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      const ip = implicitPelican(road, ca, x, z);
      if (ip) { out.push(x, z, ip === 'ns' ? 1 : 2, 2); continue; }
      const j = junctionLights(road, auxAt, x, z);
      if (!j || !j.lit) continue;
      if (j.g.w > 1 || j.g.h > 1) { if (j.g.x === x && j.g.y === z) out.push(x, z, 0, 1); } // a group: once, at its anchor
      else out.push(x, z, signalArms(car, x, z), 0); // the twin lane of a wide road is not an approach
    }
    if (out.length) this.cands.set(key, out); else this.cands.delete(key);
    this.dirty = true;
  }
  dropChunk(key: string) { if (this.cands.delete(key)) this.dirty = true; }
  /** Ownership, technology or road rules changed: re-check which junctions have lights. */
  invalidate() { this.dirty = true; }

  /** Rebuild the pole list if needed and light this tick's lamps. */
  frame(tick: number, signalled: (x: number, y: number) => boolean) {
    if (this.dirty) { this.rebuild(signalled); this.lastTick = NaN; }
    const night = sceneUniforms.uNight.value;
    for (const m of this.halo) (m.material as MeshBasicMaterial).opacity = 0.32 * night;
    if (tick === this.lastTick && !this.flashing) { this.showHalos(night); return; }
    this.lastTick = tick;
    const counts = [0, 0, 0];
    let arrows = 0;
    this.flashing = false;
    const now = performance.now() / 1000;
    const put = (m: InstancedMesh, n: number, mat: Matrix4, glow: number) => { m.setMatrixAt(n, mat); m.setColorAt(n, this.tint.setScalar(0.8 + 0.2 * glow)); }; // lamps age differently
    for (const h of this.heads) {
      if (h.kind === Kind.Pel || h.kind === Kind.Man) {
        const p: PelicanLamp = pelicanPhase(this.world?.walkAt(h.px!, h.pz!) ?? -Infinity, tick);
        if (p === 'flash') this.flashing = true;
        const blink = p === 'flash' && ((now * (1.6 + 0.4 * h.glow) + h.glow) % 1) < 0.55;
        if (h.kind === Kind.Pel) {
          const lamp = p === 'green' ? 0 : p === 'amber' ? 1 : p === 'red' ? 2 : blink ? 1 : -1;
          if (lamp >= 0) put(this.lit[lamp], counts[lamp]++, h.matrix, h.glow);
        } else if (p === 'red' || blink) put(this.lit[0], counts[0]++, h.alt2!, h.glow); // the green man while cars wait, flashing while walkers finish
        else if (p !== 'flash') put(this.lit[2], counts[2]++, h.alt!, h.glow); // the red man while cars go
        continue;
      }
      const ph = groupPhaseOf(h.timing, h.phases, tick, this.phase);
      const mine = (ph.green === 'ew') === h.ew;
      if (h.kind === Kind.Main) { const lamp = !mine || ph.left ? 2 : ph.amber ? 1 : 0; put(this.lit[lamp], counts[lamp]++, h.matrix, h.glow); continue; }
      // a left-arrow head: the green arrow in its own mesh, its red and amber the round lamps moved over to its housing
      if (mine && ph.left && !ph.amber) put(this.litArrow, arrows++, h.matrix, h.glow);
      else { const lamp = mine && ph.left ? 1 : 2; put(this.lit[lamp], counts[lamp]++, h.alt!, h.glow); }
    }
    this.lit.forEach((m, i) => {
      m.count = counts[i]; m.visible = counts[i] > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    this.litArrow.count = arrows; this.litArrow.visible = arrows > 0;
    this.litArrow.instanceMatrix.needsUpdate = true;
    if (this.litArrow.instanceColor) this.litArrow.instanceColor.needsUpdate = true;
    this.halo.forEach((m, i) => { m.count = i < 3 ? counts[i] : arrows; });
    this.showHalos(night);
  }
  private showHalos(night: number) { for (const m of this.halo) m.visible = night > 0.05 && m.count > 0; }

  private rebuild(signalled: (x: number, y: number) => boolean) {
    this.dirty = false;
    this.heads = [];
    const road = this.road, aux = this.aux;
    const ca = (x: number, z: number) => { const a = aux(x, z); return isClassAux(a) ? a : 0; };
    const car = (x: number, z: number) => road(x, z) && !isPedestrianAux(ca(x, z));
    const q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
    /** a pole at (px, pz) facing cars heading (hx, hz): its own jitter, turn of the head and size from seed */
    const pole = (px: number, pz: number, hx: number, hz: number, seed: number, y = 0) => {
      const jitter = (seed - 0.5) * 0.03;
      p.set(px + jitter * hx, y, pz + jitter * hz);
      q.setFromAxisAngle(up, Math.atan2(-hx, -hz) + (hash2(Math.round(px * 8) + 3, Math.round(pz * 8) - 5) - 0.5) * 0.12); // face the oncoming cars, set by hand
      const k = 0.94 + 0.12 * hash2(Math.round(px * 8) - 7, Math.round(pz * 8) + 11);
      s.set(k, k, k);
      return new Matrix4().compose(p, q, s);
    };
    const add = (h: Head) => { if (this.heads.length < MAX_HEADS) this.heads.push(h); };
    for (const list of this.cands.values()) {
      for (let i = 0; i < list.length; i += 4) {
        const x = list[i], z = list[i + 1], mask = list[i + 2], kind = list[i + 3];
        if (kind === 2) { this.pelican(x, z, mask === 1, pole, add); continue; }
        if (!signalled(x, z)) continue;
        if (kind === 0) {
          const timing = signalTiming(x, z);
          for (const [bit, ax, az] of ARMS) {
            if (!(mask & bit)) continue;
            // cars on this arm drive toward the centre: heading h = -arm; their right is (-hz, hx)
            const hx = -ax, hz = -az, rx = -hz, rz = hx;
            const seed = hash2(x * 4 + bit, z * 7 - bit);
            add({ kind: Kind.Main, ew: hx !== 0, timing, phases: 2, matrix: pole(x + 0.5 + CORNER * (rx - hx), z + 0.5 + CORNER * (rz - hz), hx, hz, seed), glow: seed });
          }
          continue;
        }
        // a junction group (R4): heads on every approach into it from outside, all on the anchor's timing
        const j = junctionLights(road, aux, x, z);
        if (!j || !j.lit) continue;
        const g = j.g, timing = signalTiming(g.x, g.y), phases = j.phases;
        for (let ty = g.y; ty < g.y + g.h; ty++) for (let tx = g.x; tx < g.x + g.w; tx++) for (let d = 0; d < 4; d++) {
          const [hx, hz] = CD[d], nx = tx - hx, nz = ty - hz;
          if (inGroup(g, nx, nz) || !car(nx, nz) || !carStepOk(ca(nx, nz), ca(tx, ty), d)) continue;
          const rx = -hz, rz = hx, seed = hash2(tx * 4 + d * 3, ty * 7 - d);
          add({ kind: Kind.Main, ew: hx !== 0, timing, phases, matrix: pole(tx + 0.5 + CORNER * (rx - hx), ty + 0.5 + CORNER * (rz - hz), hx, hz, seed), glow: seed });
          // a divided road's carriageway coming in: a second pole on its reservation's nose (the left-arrow head on it at four phases)
          const na = ca(nx, nz);
          if (!isDividedAux(na) || oneWayDir(na) !== d) continue;
          const s2 = hash2(tx * 9 + d, ty * 5 + 11);
          const m = pole(nx + 0.5 + 0.5 * hz + 0.31 * hx, nz + 0.5 - 0.5 * hx + 0.31 * hz, hx, hz, s2, 0.014);
          add({ kind: Kind.Main, ew: hx !== 0, timing, phases, matrix: m, glow: s2 });
          if (phases === 4) add({ kind: Kind.Left, ew: hx !== 0, timing, phases, matrix: m, glow: hash2(tx + d * 17, ty * 3), alt: m.clone().multiply(SHIFT) });
        }
      }
    }
    // signal crossings placed with the tool (the road rule record's pelican)
    if (this.world) for (const [k, r] of this.world.roadRules) {
      if (!r.pelican) continue;
      const [x, z] = k.split(',').map(Number);
      if (road(x, z)) this.pelican(x, z, road(x, z - 1) && road(x, z + 1), pole, add);
    }
    const tint = new Color();
    let np = 0, na = 0, ne = 0;
    for (const h of this.heads) {
      if (h.kind === Kind.Man) continue;
      const m = h.kind === Kind.Left ? this.arrows : this.poles, n = h.kind === Kind.Left ? na++ : np++;
      m.setMatrixAt(n, h.matrix);
      m.setColorAt(n, tint.setScalar(0.85 + 0.3 * h.glow));
      if (h.kind === Kind.Pel) { this.extras.setMatrixAt(ne, h.matrix); this.extras.setColorAt(ne, tint); ne++; }
    }
    for (const [m, n] of [[this.poles, np], [this.arrows, na], [this.extras, ne]] as [InstancedMesh, number][]) {
      m.count = n; m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** A signal crossing on straight (x, z): a pole each way on the right-hand kerb short of the stop line, the walker's man on each. */
  private pelican(x: number, z: number, ns: boolean, pole: (px: number, pz: number, hx: number, hz: number, seed: number, y?: number) => Matrix4, add: (h: Head) => void) {
    const timing = signalTiming(x, z);
    for (const sg of [-1, 1]) {
      const hx = ns ? 0 : sg, hz = ns ? sg : 0, rx = -hz, rz = hx;
      const seed = hash2(x * 13 + sg * 5, z * 17 - sg * 3);
      const m = pole(x + 0.5 - 0.27 * hx + 0.445 * rx, z + 0.5 - 0.27 * hz + 0.445 * rz, hx, hz, seed, 0.014);
      add({ kind: Kind.Pel, ew: !ns, timing, phases: 2, matrix: m, glow: seed, px: x, pz: z });
      // the man: the lit red and green spheres squashed into figures on its box
      const man = (i: number, y: number) => new Matrix4().makeTranslation(MAN_X - 0.003, y, MAN_Z).multiply(new Matrix4().makeScale(0.2, 0.75, 0.55)).multiply(new Matrix4().makeTranslation(0, -LAMP_Y[i], -(LAMP_Z + 0.004)));
      add({ kind: Kind.Man, ew: !ns, timing, phases: 2, matrix: m, glow: seed, px: x, pz: z, alt: m.clone().multiply(man(2, MAN_Y[1])), alt2: m.clone().multiply(man(0, MAN_Y[0])) });
    }
  }
}

/** a left-arrow head's round lamps: the main head's matrix moved to the arrow housing beside it */
const SHIFT = new Matrix4().makeTranslation(ARROW_DX, 0, 0);
