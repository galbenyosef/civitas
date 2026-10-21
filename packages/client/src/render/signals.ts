import { InstancedMesh, Group, Matrix4, Quaternion, Vector3, Color, SphereGeometry, MeshBasicMaterial, MeshLambertMaterial, DynamicDrawUsage, AdditiveBlending, type BufferGeometry } from 'three';
import { CHUNK_SIZE, isRoad, isJunctionAux, hash2, signalTiming, signalPhaseOf, signalArms, signalledArms, signalSite, isPedestrianAux, isMotorwayAux, ARM_STEPS, type SignalTiming, type SignalPhase } from '@msimcity/shared';
import type { ClientChunk } from '../world';
import { Kit } from './kit';
import { sceneUniforms } from './materials';

/** Road arms by tile mask bit (N=1 E=2 S=4 W=8, as the ground tiling uses), as the step toward that arm in x / z. */
const ARMS = ARM_STEPS;
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

interface Head { x: number; y: number; ew: boolean; timing: SignalTiming; matrix: Matrix4; glow: number }

function poleGeometry(): BufferGeometry {
  const k = new Kit();
  k.cyl(0.012, 0.016, POLE_H, 0, 0, 0, 0x2b2e33, 6);
  k.box(HEAD_W, HEAD_H, HEAD_D, 0, POLE_H, 0, 0x1c1e22);
  k.box(HEAD_W * 1.5, 0.006, HEAD_D * 1.2, 0, POLE_H + HEAD_H, 0, 0x2b2e33); // cap
  for (let i = 0; i < 3; i++) k.part(new SphereGeometry(LAMP_R * 0.92, 8, 6).translate(0, LAMP_Y[i], LAMP_Z), DIM[i]);
  return k.build();
}

/**
 * Traffic lights at every signalled junction (three or more road arms, the
 * parcel owner has the Traffic signals technology): one pole on the
 * right-hand near corner of each approach, its head facing the oncoming
 * cars. Poles, housings and unlit lamps are one static instanced mesh; the
 * lit lamps are three emissive instanced meshes (red, amber, green) holding
 * only the lamps lit this frame. Phases come from the shared signal timing,
 * so they match what the server enforces without any wire traffic.
 */
export class TrafficLights {
  group = new Group();
  private cands = new Map<string, number[]>(); // chunk key -> x, y, armMask, timing x, timing y per junction tile
  private heads: Head[] = [];
  private poles: InstancedMesh;
  private lit: InstancedMesh[];
  /** soft additive glow round each lit lamp, faded in with the night */
  private halo: InstancedMesh[];
  private dirty = false;
  private phase: SignalPhase = { green: 'ns', amber: false };
  private lastTick = NaN;
  private tint = new Color();

  constructor() {
    this.poles = new InstancedMesh(poleGeometry(), new MeshLambertMaterial({ vertexColors: true, flatShading: true }), MAX_HEADS);
    this.poles.count = 0;
    this.poles.frustumCulled = false;
    this.poles.castShadow = true;
    this.group.add(this.poles);
    this.lit = LIT.map((c, i) => {
      const m = new InstancedMesh(new SphereGeometry(LAMP_R * 1.18, 10, 8).translate(0, LAMP_Y[i], LAMP_Z + 0.004), new MeshBasicMaterial({ color: c, toneMapped: false }), MAX_HEADS);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      this.group.add(m);
      return m;
    });
    this.halo = LIT.map((c, i) => {
      const m = new InstancedMesh(new SphereGeometry(LAMP_R * 2.6, 10, 8).translate(0, LAMP_Y[i], LAMP_Z + 0.01),
        new MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), MAX_HEADS);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix = this.lit[i].instanceMatrix; // same lamps, same matrices
      m.renderOrder = 2;
      this.group.add(m);
      return m;
    });
  }

  /** Record the junction tiles of a chunk (call after its tiles change). */
  scanChunk(key: string, chunk: ClientChunk, getTile: (x: number, y: number) => number | undefined, auxAt: (x: number, y: number) => number = () => 0) {
    const out: number[] = [];
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cy * CHUNK_SIZE;
    // a road cars use (a pedestrian street is no approach), as the server counts arms (sim/traffic.ts carRoadAt)
    const road = (x: number, z: number) => { const t = getTile(x, z); return t !== undefined && isRoad(t) && !isPedestrianAux(auxAt(x, z)); };
    const arms = (x: number, z: number) => signalArms(road, x, z); // the twin lane of a wide road is not an approach
    for (let i = 0; i < chunk.tiles.length; i++) {
      if (!isRoad(chunk.tiles[i]) || isJunctionAux(chunk.aux[i])) continue; // roundabouts and flyovers have no lights
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      // a divided road's crossing is one junction with one timing (shared roadclass.ts signalSite); motorways have no lights
      if (isMotorwayAux(chunk.aux[i])) continue;
      const site = signalSite(x, z, road, auxAt, arms, signalledArms);
      if (site.signalled && site.arms) out.push(x, z, site.arms, site.tx, site.ty);
    }
    if (out.length) this.cands.set(key, out); else this.cands.delete(key);
    this.dirty = true;
  }
  dropChunk(key: string) { if (this.cands.delete(key)) this.dirty = true; }
  /** Ownership or technology changed: re-check which junctions have lights. */
  invalidate() { this.dirty = true; }

  /** Rebuild the pole list if needed and light this tick's lamps. */
  frame(tick: number, signalled: (x: number, y: number) => boolean) {
    if (this.dirty) { this.rebuild(signalled); this.lastTick = NaN; }
    const night = sceneUniforms.uNight.value;
    for (const m of this.halo) { m.visible = night > 0.05; (m.material as MeshBasicMaterial).opacity = 0.32 * night; }
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    const counts = [0, 0, 0];
    for (const h of this.heads) {
      const ph = signalPhaseOf(h.timing, tick, this.phase);
      const lamp = (ph.green === 'ew') !== h.ew ? 2 : ph.amber ? 1 : 0;
      const m = this.lit[lamp], n = counts[lamp]++;
      m.setMatrixAt(n, h.matrix);
      m.setColorAt(n, this.tint.setScalar(0.8 + 0.2 * h.glow)); // lamps age differently: no two quite the same brightness
    }
    this.halo.forEach((m, i) => { m.count = counts[i]; });
    for (const m of this.lit) {
      m.count = counts[this.lit.indexOf(m)];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private rebuild(signalled: (x: number, y: number) => boolean) {
    this.dirty = false;
    this.heads = [];
    const q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
    for (const list of this.cands.values()) {
      for (let i = 0; i < list.length; i += 5) {
        const x = list[i], z = list[i + 1], mask = list[i + 2];
        if (!signalled(x, z)) continue;
        const timing = signalTiming(list[i + 3], list[i + 4]);
        for (const [bit, ax, az] of ARMS) {
          if (!(mask & bit)) continue;
          // cars on this arm drive toward the centre: heading h = -arm; their right is (-hz, hx)
          const hx = -ax, hz = -az, rx = -hz, rz = hx;
          const seed = hash2(x * 4 + bit, z * 7 - bit);
          const jitter = (seed - 0.5) * 0.03;
          p.set(x + 0.5 + CORNER * (rx - hx) + jitter * hx, 0, z + 0.5 + CORNER * (rz - hz) + jitter * hz);
          q.setFromAxisAngle(up, Math.atan2(-hx, -hz) + (hash2(z * 3 + bit, x * 5) - 0.5) * 0.12); // face the oncoming cars, set by hand
          const k = 0.94 + 0.12 * hash2(x + bit * 11, z - bit * 13);
          s.set(k, k, k);
          this.heads.push({ x, y: z, ew: hx !== 0, timing, matrix: new Matrix4().compose(p, q, s), glow: seed });
          if (this.heads.length >= MAX_HEADS) break;
        }
      }
    }
    const tint = new Color();
    this.heads.forEach((h, i) => {
      this.poles.setMatrixAt(i, h.matrix);
      this.poles.setColorAt(i, tint.setScalar(0.85 + 0.3 * h.glow));
    });
    this.poles.count = this.heads.length;
    this.poles.instanceMatrix.needsUpdate = true;
    if (this.poles.instanceColor) this.poles.instanceColor.needsUpdate = true;
  }
}
