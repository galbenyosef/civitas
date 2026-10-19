import {
  Group, Mesh, InstancedBufferGeometry, InstancedBufferAttribute, PlaneGeometry, ShaderMaterial, AdditiveBlending, NormalBlending,
  DynamicDrawUsage, DoubleSide,
} from 'three';
import { FIRE, FirePhase, FireOutcome, TICKS_PER_HOUR, hash2, fireProgress, type FireDTO } from '@msimcity/shared';
import type { ClientWorld } from '../world';
import { sceneUniforms } from './materials';
import { roofAnchor } from './issues';

const MAX_FIRES = 64;
const FLAMES_MAX = 10, PUFFS_MAX = 18, DROPS_MAX = 36;
/** one wind for the town (smoke leans the same general way), each fire and each puff turned off it by its own hash */
const WIND = 0.7;

/**
 * Per-instance data, one row per flame or puff, written when the list changes:
 * aP: the fire's roof anchor (x, roof height, z); aO: offset in the footprint (x, z), the footprint's half-size (x, z);
 * aS: seed, height or size scale, rate (flicker or rise period), fire index. aI (per frame): intensity, tone, phase, -.
 */
interface Pool { geo: InstancedBufferGeometry; P: Float32Array; O: Float32Array; S: Float32Array; I: Float32Array; n: number; mesh: Mesh }

const FLAME_VERT = /* glsl */ `
attribute vec3 aP; attribute vec4 aO; attribute vec4 aS; attribute vec4 aI;
uniform float uTime;
varying vec2 vUv; varying float vA; varying float vSeed; varying float vHot;
void main() {
  float seed = aS.x, hs = aS.y, rate = aS.z, inten = aI.x;
  // each tongue flickers at its own rate and phase, leans its own way and breathes in height: nothing in lockstep
  float t = uTime * rate + seed * 61.0;
  float breathe = 0.78 + 0.22 * sin(t) * sin(t * 0.47 + 2.0);
  float foot = 0.5 + 2.0 * max(aO.z, aO.w); // 1 over a lot, more over a bigger building
  float h = hs * (0.25 + 0.95 * inten) * breathe * foot * 0.9;
  float w = h * (0.42 + 0.18 * fract(seed * 7.3));
  vec3 base = aP + vec3(aO.x, -0.05, aO.y);
  vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
  float sway = (position.y + 0.5) * (position.y + 0.5) * 0.18 * h * sin(t * 0.8 + seed * 9.0);
  vec3 p = base + right * (position.x * w + sway) + vec3(0.0, (position.y + 0.5) * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = uv; vA = inten > 0.002 ? 1.0 : 0.0; vSeed = seed; vHot = aI.y;
}`;
const FLAME_FRAG = /* glsl */ `
uniform float uTime; uniform float uNight;
varying vec2 vUv; varying float vA; varying float vSeed; varying float vHot;
void main() {
  if (vA <= 0.0) discard;
  vec2 q = vec2(vUv.x * 2.0 - 1.0, vUv.y);
  // a teardrop narrowing to a licking tip, its edge rippling upward at the tongue's own pace
  float rip = 0.12 * sin(q.y * 11.0 - uTime * (7.0 + 3.0 * vSeed) + vSeed * 30.0) * q.y;
  float width = pow(max(0.0, 1.0 - q.y), 0.75) * (0.95 - 0.35 * q.y) + 0.04;
  float d = abs(q.x + rip) / width;
  float body = (1.0 - smoothstep(0.55, 1.0, d)) * smoothstep(0.0, 0.08, q.y) * (1.0 - smoothstep(0.7, 1.0, q.y));
  if (body < 0.01) discard;
  float core = (1.0 - smoothstep(0.0, 0.65, d)) * (1.0 - smoothstep(0.1, 0.75, q.y));
  vec3 col = mix(vec3(0.85, 0.16, 0.03), vec3(1.0, 0.62, 0.12), smoothstep(0.0, 0.6, 1.0 - d));
  col = mix(col, vec3(1.0, 0.93, 0.65), core * (0.6 + 0.4 * vHot));
  float glow = 1.15 + 0.6 * uNight;
  gl_FragColor = vec4(col * glow * body, body);
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uNight;
varying vec2 vUv; varying float vA; varying float vSeed; varying float vHot;
void main() {
  if (vA <= 0.0) discard;
  float r = length(vUv * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.0, 1.0, r));
  a = a * a * (0.25 + 0.75 * uNight) * vHot;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a, a);
}`;
const GLOW_VERT = /* glsl */ `
attribute vec3 aP; attribute vec4 aO; attribute vec4 aS; attribute vec4 aI;
uniform float uTime;
varying vec2 vUv; varying float vA; varying float vSeed; varying float vHot;
void main() {
  float seed = aS.x, inten = aI.x;
  float flick = 0.85 + 0.15 * sin(uTime * (9.0 + 4.0 * seed) + seed * 20.0) * sin(uTime * 3.1 + seed * 5.0);
  float s = (0.9 + 1.6 * inten) * (0.5 + 2.0 * max(aO.z, aO.w)) * 1.3 * flick;
  vec3 c = aP + vec3(0.0, 0.2, 0.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * s, 1.0);
  vUv = uv; vA = inten > 0.002 ? 1.0 : 0.0; vSeed = seed; vHot = inten;
}`;

const SMOKE_VERT = /* glsl */ `
attribute vec3 aP; attribute vec4 aO; attribute vec4 aS; attribute vec4 aI;
uniform float uTime; uniform float uWind;
varying vec2 vUv; varying float vA; varying float vTone; varying float vSeed;
void main() {
  float seed = aS.x, size = aS.y, period = aS.z, inten = aI.x;
  // a puff's life: born over the roof, rising, swelling and drifting downwind, each on its own clock and its own heading
  float life = fract(uTime / period + seed * 13.7);
  float drift = uWind + (fract(seed * 3.1) - 0.5) * 0.7 + aI.z;
  vec3 dir = vec3(cos(drift), 0.0, sin(drift));
  float foot = 0.5 + 2.0 * max(aO.z, aO.w); // 1 over a lot, more over a bigger building
  float rise = life * (0.9 + 1.3 * fract(seed * 5.3)) * (0.6 + 0.6 * inten + 0.3 * aI.w) * foot;
  float lean = pow(life, 1.4) * (0.5 + 0.9 * fract(seed * 9.1)) * foot;
  float wob = sin(uTime * (0.9 + fract(seed * 4.7)) + seed * 17.0) * 0.18 * life;
  vec3 c = aP + vec3(aO.x, 0.1, aO.y) + vec3(0.0, rise, 0.0) + dir * lean + vec3(-dir.z, 0.0, dir.x) * wob;
  float s = size * 0.5 * (0.3 + 1.1 * life) * foot * (0.7 + 0.5 * inten);
  float ang = seed * 6.283 + uTime * (fract(seed * 2.9) - 0.5) * 0.4;
  vec2 rp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * position.xy;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * rp.x + up * rp.y) * s, 1.0);
  vUv = uv;
  vA = inten * pow(sin(3.14159 * life), 0.7) * (1.0 - 0.35 * life);
  vTone = aI.y; vSeed = seed;
}`;
const SMOKE_FRAG = /* glsl */ `
uniform float uNight;
varying vec2 vUv; varying float vA; varying float vTone; varying float vSeed;
void main() {
  if (vA < 0.004) discard;
  vec2 q = vUv * 2.0 - 1.0;
  // a lumpy puff: the disc's edge pushed in and out by a few lobes of its own
  float ang = atan(q.y, q.x);
  float lobes = 0.82 + 0.1 * sin(ang * 3.0 + vSeed * 20.0) + 0.08 * sin(ang * 5.0 - vSeed * 11.0);
  float r = length(q) / lobes;
  float a = (1.0 - smoothstep(0.3, 1.0, r)) * vA * 0.8;
  if (a < 0.004) discard;
  // dark soot while it burns, pale steam once the hoses are on it (tone 0..1)
  vec3 col = mix(vec3(0.13, 0.12, 0.12), vec3(0.78, 0.78, 0.8), vTone) * (1.0 - 0.55 * uNight);
  col += vec3(0.25, 0.08, 0.0) * (1.0 - vTone) * (1.0 - smoothstep(0.0, 0.6, r)) * uNight; // lit from below at night
  gl_FragColor = vec4(col, a);
}`;

/**
 * Water: drops in an arc from where it is thrown (aP) to a point on the building (aO.xyz; aO.w the arc's height). A hose
 * (aS.w 0) is a steady stream, each drop on its own clock and wobble; a bucket chain (aS.w 1) throws in bursts, each
 * thrower on their own rhythm. aI.x is how hard they are at it (0 when not putting a fire out).
 */
const SPRAY_VERT = /* glsl */ `
attribute vec3 aP; attribute vec4 aO; attribute vec4 aS; attribute vec4 aI;
uniform float uTime;
varying vec2 vUv; varying float vA;
void main() {
  float seed = aS.x, size = aS.y, rate = aS.z, bucket = aS.w;
  float life = fract(uTime * rate + seed * 23.0);
  // a bucket flies in a short burst every couple of seconds; between, nothing (each thrower has their own beat)
  float beat = fract(uTime * (0.45 + 0.2 * fract(seed * 5.0)) + fract(seed * 3.7));
  float on = bucket > 0.5 ? step(beat, 0.45) : 1.0;
  if (bucket > 0.5) life = beat / 0.45;
  vec3 a = aP, b = aO.xyz;
  vec3 c = mix(a, b, life) + vec3(0.0, aO.w * 4.0 * life * (1.0 - life), 0.0);
  float spread = (bucket > 0.5 ? 0.22 : 0.07) * life;
  c += vec3(sin(seed * 91.0 + uTime * 3.0), 0.0, cos(seed * 57.0 + uTime * 2.3)) * spread;
  float s = size * (0.5 + 0.9 * life) * (bucket > 0.5 ? 1.6 : 1.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * s, 1.0);
  vUv = uv;
  vA = aI.x * on * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.85, 1.0, life));
}`;
const SPRAY_FRAG = /* glsl */ `
uniform float uNight;
varying vec2 vUv; varying float vA;
void main() {
  if (vA < 0.01) discard;
  float r = length(vUv * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * vA * 0.95;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.6, 0.8, 1.0) * (1.1 + 0.3 * uNight) * a, a);
}`;

const SCORCH_VERT = /* glsl */ `
attribute vec3 aP; attribute vec4 aO; attribute vec4 aS; attribute vec4 aI;
varying vec2 vUv; varying float vA; varying float vSeed;
void main() {
  float seed = aS.x, ang = seed * 6.283;
  vec2 rp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (position.xy * vec2(aO.z, aO.w) * 2.0 * (1.15 + 0.35 * fract(seed * 3.7)));
  vec3 p = vec3(aP.x + rp.x, 0.04 + 0.004 * fract(seed * 11.0), aP.z + rp.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = uv; vA = aI.x; vSeed = seed;
}`;
const SCORCH_FRAG = /* glsl */ `
varying vec2 vUv; varying float vA; varying float vSeed;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float ang = atan(q.y, q.x);
  float edge = 0.75 + 0.12 * sin(ang * 4.0 + vSeed * 31.0) + 0.08 * sin(ang * 9.0 - vSeed * 17.0) + 0.05 * sin(ang * 15.0 + vSeed * 7.0);
  float r = length(q) / edge;
  float a = (1.0 - smoothstep(0.45, 1.0, r)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.04, 0.035, 0.03), a * 0.8);
}`;

function pool(max: number, vert: string, frag: string, additive: boolean, order: number): Pool {
  const geo = new InstancedBufferGeometry();
  const plane = new PlaneGeometry(1, 1);
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  const P = new Float32Array(max * 3), O = new Float32Array(max * 4), S = new Float32Array(max * 4), I = new Float32Array(max * 4);
  geo.setAttribute('aP', new InstancedBufferAttribute(P, 3).setUsage(DynamicDrawUsage));
  geo.setAttribute('aO', new InstancedBufferAttribute(O, 4).setUsage(DynamicDrawUsage));
  geo.setAttribute('aS', new InstancedBufferAttribute(S, 4).setUsage(DynamicDrawUsage));
  geo.setAttribute('aI', new InstancedBufferAttribute(I, 4).setUsage(DynamicDrawUsage));
  geo.instanceCount = 0;
  const mat = new ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: DoubleSide, // the scorch is laid flat from a plane's x and y
    blending: additive ? AdditiveBlending : NormalBlending,
    uniforms: { uTime: sceneUniforms.uTime, uNight: sceneUniforms.uNight, uWind: { value: WIND } },
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return { geo, P, O, S, I, n: 0, mesh };
}

/**
 * House fires (server sim/fires.ts, message `fires`): flames over the roof of a burning building, soot then steam rising
 * and drifting downwind, an orange glow that carries at night, and the scorch on the ground that stays through the
 * aftermath. Four instanced passes, one draw call each, a few hundred instances at most.
 *
 * The standing organic rule: every flame has its own height, width, flicker rate and phase, sway and place on the roof;
 * every puff its own clock, rise, size, heading off the town's wind and wobble; every fire its own count of each, its own
 * lean of the wind and its own scorch outline, all from hash2 of the tile and the fire's seed. How big it is follows the
 * fire's own course (shared fireProgress): it grows as it takes hold, dies back under the hoses, smoulders afterwards.
 */
export class FiresView {
  group = new Group();
  private fires: FireDTO[] = [];
  private flames = pool(MAX_FIRES * FLAMES_MAX, FLAME_VERT, FLAME_FRAG, true, 9);
  private glows = pool(MAX_FIRES, GLOW_VERT, GLOW_FRAG, true, 8);
  private smoke = pool(MAX_FIRES * PUFFS_MAX, SMOKE_VERT, SMOKE_FRAG, false, 10);
  private scorch = pool(MAX_FIRES, SCORCH_VERT, SCORCH_FRAG, false, 1);
  private spray = pool(MAX_FIRES * DROPS_MAX, SPRAY_VERT, SPRAY_FRAG, true, 11);
  /** which fire each instance belongs to, per pool */
  private owner = new Map<Pool, Int16Array>();
  private builtAt = 0;

  constructor(private world: ClientWorld) {
    for (const p of [this.scorch, this.glows, this.flames, this.smoke, this.spray]) {
      this.group.add(p.mesh);
      this.owner.set(p, new Int16Array(p.P.length / 3));
    }
  }

  get count() { return this.fires.length; }

  /** The server's list (message `fires`). */
  set(list: FireDTO[]) { this.fires = list.slice(0, MAX_FIRES); this.rebuild(); }

  /** Lay out every instance: positions from the roofs drawn now, the variation from hashes. */
  private rebuild() {
    this.builtAt = performance.now();
    for (const p of [this.flames, this.glows, this.smoke, this.scorch, this.spray]) p.n = 0;
    this.fires.forEach((f, fi) => {
      const roof = roofAnchor(this.world, f.x, f.y, 0);
      const ground: [number, number, number] = [roof[0], 0, roof[2]];
      const hx = f.w / 2, hz = f.h / 2;
      const fx = f.x + 7919 * Math.floor(f.s * 997); // the fire's own seed in every hash: the drill house burns differently each time
      const nFl = 5 + Math.floor(hash2(fx * 3 + 1, f.y * 5 + 2) * (FLAMES_MAX - 4));
      for (let i = 0; i < nFl; i++) {
        const a = hash2(fx * 31 + i * 7, f.y * 17 + i * 3), b = hash2(f.y * 13 + i * 11, fx * 7 + i * 5), c = hash2(i * 19 + fx, i * 23 + f.y);
        // tongues cluster toward the middle of the roof, a few out at the edges
        const ox = (a - 0.5) * (a - 0.5) * Math.sign(a - 0.5) * 2.6 * hx, oz = (b - 0.5) * (b - 0.5) * Math.sign(b - 0.5) * 2.6 * hz;
        this.put(this.flames, fi, roof, [ox, oz, hx * 0.5, hz * 0.5], [c, 0.55 + 0.9 * hash2(c * 1000, i), 5.5 + 5 * a, fi]);
      }
      this.put(this.glows, fi, roof, [0, 0, hx * 0.5, hz * 0.5], [f.s, 1, 1, fi]);
      const nSm = 9 + Math.floor(hash2(fx * 7 + 3, f.y * 11 + 1) * (PUFFS_MAX - 8));
      for (let i = 0; i < nSm; i++) {
        const a = hash2(fx * 41 + i * 13, f.y * 29 + i), b = hash2(f.y * 37 + i * 3, fx * 43 + i * 9);
        this.put(this.smoke, fi, roof, [(a - 0.5) * hx * 0.8, (b - 0.5) * hz * 0.8, hx * 0.5, hz * 0.5], [hash2(i * 53 + fx, f.y * 3 + i), 0.55 + 0.6 * b, 3.2 + 3.6 * a, fi]);
      }
      this.put(this.scorch, fi, ground, [0, 0, hx, hz], [f.s, 1, 1, fi]);
      // water on it: the crew's hose from the engine at the kerb, or the neighbours' buckets from round the building
      if (f.hx !== undefined && f.hy !== undefined) {
        const n = 22 + Math.floor(hash2(fx * 5 + 9, f.y * 7 + 4) * (DROPS_MAX - 22));
        for (let i = 0; i < n; i++) {
          const a = hash2(fx * 59 + i * 7, f.y * 31 + i * 13), b = hash2(f.y * 61 + i * 11, fx * 37 + i * 3);
          const tx = roof[0] + (a - 0.5) * hx * 0.8, tz = roof[2] + (b - 0.5) * hz * 0.8, ty = roof[1] * (0.55 + 0.4 * b);
          this.put(this.spray, fi, [f.hx, 0.32, f.hy], [tx, ty, tz, 0.55 + 0.45 * a], [hash2(i * 17 + fx, f.y + i * 29), 0.11 + 0.06 * b, 0.8 + 0.6 * a, 0]);
        }
      } else if (f.bk) {
        const throwers = 3 + Math.floor(hash2(fx * 3 + 7, f.y * 9 + 1) * 3);
        for (let k = 0; k < throwers; k++) {
          const ang = (k / throwers) * Math.PI * 2 + f.s * 6.283, r = Math.max(hx, hz) + 0.35;
          const ox = roof[0] + Math.cos(ang) * r, oz = roof[2] + Math.sin(ang) * r;
          const seedK = hash2(fx * 13 + k * 41, f.y * 19 + k);
          for (let i = 0; i < 7; i++) this.put(this.spray, fi, [ox, 0.15, oz], [roof[0] + Math.cos(ang) * hx * 0.5, roof[1] * 0.35, roof[2] + Math.sin(ang) * hz * 0.5, 0.45], [seedK + i * 0.0013, 0.09 + 0.05 * hash2(k * 7 + i, fx), 1, 1]);
        }
      }
    });
    for (const p of [this.flames, this.glows, this.smoke, this.scorch, this.spray]) {
      p.geo.instanceCount = p.n;
      for (const k of ['aP', 'aO', 'aS']) (p.geo.getAttribute(k) as InstancedBufferAttribute).needsUpdate = true;
    }
  }

  private put(p: Pool, fi: number, at: readonly number[], o: readonly number[], s: readonly number[]) {
    const i = p.n++;
    p.P.set(at, i * 3); p.O.set(o, i * 4); p.S.set(s, i * 4);
    this.owner.get(p)![i] = fi;
  }

  /**
   * Once a frame: each fire's flame size, glow, smoke density and tone and scorch from the game clock (`tick`, fractional),
   * and the roofs again every couple of seconds (a building that lost levels is lower).
   */
  frame(tick: number) {
    if (!this.fires.length) return;
    if (performance.now() - this.builtAt > 2500) this.rebuild();
    const T = TICKS_PER_HOUR;
    const state = this.fires.map((f) => {
      const d = fireProgress(f, tick);
      let flame = 0, smoke = 0, tone = 0, scorch = 0, lean = (f.s - 0.5) * 0.8, lift = 0, water = 0;
      if (f.ph === FirePhase.Burning) {
        flame = 0.3 + 0.7 * Math.sqrt(d); smoke = 0.35 + 0.65 * Math.sqrt(d); tone = 0.05; scorch = 0.25 + 0.6 * d; lift = d;
      } else if (f.ph === FirePhase.Fighting) {
        const k = Math.max(0, Math.min(1, (tick - f.ta) / Math.max(1, f.t1 - f.ta)));
        const at = 0.3 + 0.7 * Math.sqrt(f.d);
        flame = at * (1 - k) * (1 - k); smoke = (0.4 + 0.6 * Math.sqrt(f.d)) * (1 - 0.5 * k); tone = 0.25 + 0.65 * k; scorch = 0.25 + 0.6 * f.d; lift = 0.5;
        water = k < 0.92 ? 1 : (1 - k) / 0.08;
      } else {
        const k = Math.max(0, Math.min(1, (tick - f.t1) / (FIRE.aftermathHours * T)));
        const burnt = f.out === FireOutcome.Burnt;
        smoke = (burnt ? 0.45 : 0.18) * (1 - k) * (1 - k); tone = burnt ? 0.35 : 0.6; lift = 0;
        scorch = (burnt ? 0.95 : f.out === FireOutcome.Partial ? 0.6 : 0.35) * (1 - Math.max(0, k - 0.6) / 0.4);
      }
      return [flame, smoke, tone, scorch, lean, lift, water];
    });
    this.state = state;
    this.write(this.flames, (st, I, j) => { I[j] = st[0]; I[j + 1] = Math.min(1, st[0] * 1.2); });
    this.write(this.glows, (st, I, j) => { I[j] = st[0]; });
    this.write(this.smoke, (st, I, j) => { I[j] = st[1]; I[j + 1] = st[2]; I[j + 2] = st[4]; I[j + 3] = st[5]; });
    this.write(this.scorch, (st, I, j) => { I[j] = st[3]; });
    this.write(this.spray, (st, I, j) => { I[j] = st[6]; });
  }

  /** each fire's [flame, smoke, tone, scorch, lean, lift, water] this frame */
  private state: number[][] = [];
  private write(p: Pool, fn: (st: number[], I: Float32Array, j: number) => void) {
    const own = this.owner.get(p)!;
    for (let i = 0; i < p.n; i++) fn(this.state[own[i]], p.I, i * 4);
    (p.geo.getAttribute('aI') as InstancedBufferAttribute).needsUpdate = true;
  }
}
