import { InstancedMesh, PlaneGeometry, ShaderMaterial, InstancedBufferAttribute, DynamicDrawUsage, AdditiveBlending, UniformsUtils, UniformsLib, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { hash2 } from '@msimcity/shared';
import { sceneUniforms } from './materials';

/**
 * Vehicle lamps after dark, without a single three.js light: the lamp boxes on the car models glow (the vehicle
 * material reads their tag from `aWin`), and each moving vehicle lays one additive quad on the road ahead holding
 * two dipped beams, one from each headlamp, toed in a touch so they meet down the road. Every driver keeps their own
 * habits, seeded from the agent id: the darkness at which they switch on (some at the first hint of dusk, some only
 * when it is properly dark), halogen, LED or xenon colour, brightness, the odd daytime-running-light car. Each bulb
 * is its own: a little brighter or dimmer than its twin, aimed a touch differently, now and then older and warmer,
 * and in about one car in sixty blown (that lens dark, that beam missing). Tail lights brighten when the car is held
 * up or slowing, a bus backing up shows white reversing lamps, and the outer third of each corner lamp is the
 * indicator: amber, blinking at the driver's own rate on the side the server says it is turning (shared Indicator),
 * both sides for hazards, and only near the camera.
 */

/** Lamp tags on vehicle model parts, carried in the Kit's `aWin` attribute (vehicles have no windows). */
export const LAMP = { head: 1, tail: 2, sign: 3 } as const;
/** A driver's lamp habits, in [0, 1); parked cars use -1 (lamps off). */
export const lampSeed = (id: number) => hash2(id, 61);

/** Shared by the vehicle material and the road pools so the two always agree. */
export const LAMP_GLSL = /* glsl */ `
float mscLampOn(float seed, float night) {
  float thr = 0.04 + 0.6 * fract(seed * 7.13);
  float on = smoothstep(thr - 0.035, thr + 0.035, night);
  return max(on, step(fract(seed * 17.9), 0.05) * 0.3); // a few cars run daytime lights
}
vec3 mscLampColor(float seed) {
  float k = fract(seed * 3.71);
  if (k < 0.45) return vec3(1.0, 0.80, 0.52);   // halogen
  if (k < 0.88) return vec3(0.90, 0.95, 1.0);   // LED
  return vec3(0.78, 0.87, 1.0);                 // xenon
}
float mscLampGain(float seed) { return 0.75 + 0.55 * fract(seed * 11.3); }
// side: 0 the car's left lamp (-z in the model), 1 its right; about one car in sixty has one bulb blown
float mscLampLive(float seed, float side) {
  float dead = step(fract(seed * 23.7), 0.016);
  return 1.0 - dead * (1.0 - step(0.5, abs(step(0.5, fract(seed * 31.3)) - side)));
}
// one bulb: brighter or dimmer than its twin, and now and then an older, warmer, dimmer one
vec3 mscBulb(float seed, float side) {
  float k = fract(seed * (side > 0.5 ? 43.1 : 37.9));
  float aged = step(0.86, fract(seed * (side > 0.5 ? 53.3 : 47.9)));
  vec3 c = mscLampColor(seed) * mscLampGain(seed) * (0.88 + 0.24 * k);
  return c * mix(vec3(1.0), vec3(0.95, 0.74, 0.5), aged) * mscLampLive(seed, side);
}`;

/** Blink rate (Hz) and phase of a driver's indicators, so the dashboard (render/fpv.ts) can blink with the lamps. */
export const blinkRate = (seed: number) => 1.35 + 0.3 * ((seed * 9.7) % 1);
const BLINK_GLSL = /* glsl */ `
float mscBlink(float seed, float t) {
  float p = fract(t * (1.35 + 0.3 * fract(seed * 9.7)) + fract(seed * 5.3));
  return smoothstep(0.0, 0.06, p) * (1.0 - smoothstep(0.5, 0.56, p));
}`;
/** Is an indicator lamp lit at wall-clock time `t` (seconds, as sceneUniforms.uTime) for this lamp seed? Mirrors mscBlink. */
export function blinkLit(seed: number, t: number): boolean {
  const p = (t * blinkRate(seed) + ((seed * 5.3) % 1)) % 1;
  return p < 0.53;
}
/** Indicators fade out between these camera distances (tiles): they are a close-up detail. */
const BLINK_NEAR = 14, BLINK_FAR = 24;

/** Vertex and fragment additions for the vehicle material (call from its onBeforeCompile). */
export function lampShader(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }) {
  shader.uniforms.uNight = sceneUniforms.uNight;
  shader.uniforms.uTime = sceneUniforms.uTime;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute float aWin;
attribute vec4 aLampI;
varying float vLamp;
varying vec4 vLampI;
varying float vLampSide;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vLamp = aWin; vLampI = aLampI; vLampSide = step(0.0, position.z);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uTime;
varying float vLamp;
varying vec4 vLampI;
varying float vLampSide;
${LAMP_GLSL}
${BLINK_GLSL}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vLamp > 0.5 && vLampI.x >= 0.0) {
  float seed = vLampI.x, on = mscLampOn(seed, uNight), side = vLampSide, ind = vLampI.z;
  float tag = floor(vLamp + 0.01), outer = step(0.6, fract(vLamp + 0.01) * 2.5); // the outer third of a corner lamp (lampLenses)
  // this side's indicator is set (1 left, 2 right, 3 both)
  float set = step(0.5, ind) * max(step(2.5, ind), 1.0 - step(0.5, abs(ind - 1.0 - side)));
  if (tag < 1.5) {
    totalEmissiveRadiance += mscBulb(seed, side) * on * 2.6 * (1.0 - outer);
  } else if (tag < 2.5) {
    totalEmissiveRadiance += vec3(1.0, 0.07, 0.035) * (on * 0.9 + vLampI.y * (0.5 + 1.6 * on)) * (1.0 - outer * set);
    totalEmissiveRadiance += vec3(1.0, 0.96, 0.88) * vLampI.w * 2.2 * (1.0 - outer); // reversing lamps
  } else {
    totalEmissiveRadiance += vec3(1.0, 0.82, 0.4) * on * 1.3;
  }
  if (tag < 2.5 && set * outer > 0.5) {
    float near = 1.0 - smoothstep(${BLINK_NEAR.toFixed(1)}, ${BLINK_FAR.toFixed(1)}, length(vViewPosition));
    totalEmissiveRadiance += vec3(1.0, 0.48, 0.04) * mscBlink(seed, uTime) * near * (2.2 + 1.2 * uNight);
  }
}`);
}

/**
 * Per-instance (seed, brake, indicator, reversing) for a vehicle mesh; every mesh drawn with the vehicle material
 * needs one. Indicator is the wire's shared Indicator (0 none, 1 left, 2 right, 3 hazards).
 */
export function lampAttribute(count: number, seed = 0): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(DynamicDrawUsage);
  if (seed) for (let i = 0; i < count; i++) a.setX(i, seed);
  return a;
}

/**
 * Mark the outer part of each head and tail lamp box of a built vehicle model as its indicator lens: a lamp vertex's
 * `aWin` becomes its tag plus 0.4 × how far out it sits across the box (0 at the inner face, 1 at the outer), which
 * the shader reads back per fragment. Lamp boxes are runs of vertices with one tag and one side of the model.
 */
export function lampLenses(geo: BufferGeometry): BufferGeometry {
  const win = geo.getAttribute('aWin'), pos = geo.getAttribute('position');
  const n = win.count;
  for (let i = 0; i < n;) {
    const tag = win.getX(i), side = Math.sign(pos.getZ(i));
    let j = i;
    if (tag === LAMP.head || tag === LAMP.tail) {
      let lo = Infinity, hi = -Infinity;
      while (j < n && win.getX(j) === tag && Math.sign(pos.getZ(j)) === side) { const z = Math.abs(pos.getZ(j)); lo = Math.min(lo, z); hi = Math.max(hi, z); j++; }
      for (let k = i; k < j; k++) win.setX(k, tag + 0.4 * (hi > lo ? (Math.abs(pos.getZ(k)) - lo) / (hi - lo) : 0));
    } else j++;
    i = j;
  }
  win.needsUpdate = true;
  return geo;
}

const POOL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uNight;
attribute vec3 aSeed; // lamp seed, half the lamp spacing and the quad's width, both in tiles
varying vec2 vUv;
varying vec3 vSeed;
// per instance, worked out here once rather than per fragment: each bulb's colour (switched on or not) and aim
varying vec3 vBulb0;
varying vec3 vBulb1;
varying vec2 vAim;
${LAMP_GLSL}
void main() {
  vUv = uv; vSeed = aSeed;
  float seed = aSeed.x, on = mscLampOn(seed, uNight) * smoothstep(0.02, 0.3, uNight);
  vBulb0 = mscBulb(seed, 0.0) * on; vBulb1 = mscBulb(seed, 1.0) * on;
  vAim = (fract(seed * vec2(67.1, 71.3)) - 0.5) * 0.07; // each lamp aimed a touch its own way
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const POOL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vSeed;
varying vec3 vBulb0;
varying vec3 vBulb1;
varying vec2 vAim;
#include <common>
#include <fog_pars_fragment>
void main() {
  if (vBulb0.r + vBulb1.r < 0.003) discard;
  // two dipped beams, one from each lamp: narrow at the bumper, widening, toed in a touch and fading down the road,
  // so they read as two pools by the car and merge ahead of it. uv.y runs to the car's left (-z in the model).
  float f = vUv.x, y = (vUv.y - 0.5) * vSeed.z;
  float w = 0.024 + 0.115 * f, k = 2.4 / (w * w);
  float d0 = y - vSeed.y * (1.0 - 0.3 * f) - vAim.x * f, d1 = y + vSeed.y * (1.0 - 0.3 * f) - vAim.y * f;
  vec3 c = vBulb0 * exp(-d0 * d0 * k) + vBulb1 * exp(-d1 * d1 * k);
  c *= smoothstep(0.0, 0.1, f) * pow(1.0 - f, 1.5) * 0.34;
  #ifdef USE_FOG
    c *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const tm = new Matrix4(), tp = new Vector3(), ts = new Vector3();

const FLARE_VERT = /* glsl */ `
#include <common>
attribute float aSeed;
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
varying float vGlow;
${BLINK_GLSL}
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vGlow = mscBlink(aSeed, uTime) * (1.0 - smoothstep(${BLINK_NEAR.toFixed(1)}, ${BLINK_FAR.toFixed(1)}, length(mv.xyz))) * (0.75 + 0.5 * uNight);
  mv.xyz += normalize(-mv.xyz) * 0.05; // a touch toward the camera, so the car's own body does not cut the glow in half
  mv.xy += position.xy * 0.065;
  gl_Position = vGlow < 0.004 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv; // dark between blinks: off screen, no fragments
}`;
const FLARE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vGlow;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec3 c = vec3(1.0, 0.45, 0.04) * (exp(-r2 * 12.0) * 1.6 + (1.0 - r2) * 0.3) * vGlow; // amber, not clipped to yellow
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * The glow of a lit indicator lamp, a small camera-facing amber flare at the corner of a vehicle, so a blinker reads
 * from the overhead camera where the lamp lens itself is a few pixels. Only vehicles near the camera that are
 * indicating get any (CitizensView gates on `eye`, the last camera to draw these), so it costs nothing further out.
 */
export class IndicatorFlares {
  readonly mesh: InstancedMesh;
  /** where the last camera to draw the flares was */
  readonly eye = new Vector3(1e9, 1e9, 1e9);
  private seeds: InstancedBufferAttribute;
  private n = 0;

  constructor(max: number) {
    const geo = new PlaneGeometry(2, 2);
    this.seeds = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('aSeed', this.seeds);
    const mat = new ShaderMaterial({
      uniforms: { uTime: sceneUniforms.uTime, uNight: sceneUniforms.uNight },
      vertexShader: FLARE_VERT, fragmentShader: FLARE_FRAG,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.mesh = new InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'indicator-flares';
    // stays visible with no instances, so this still runs and the gate opens once the camera comes close
    this.mesh.onBeforeRender = (_r, _s, cam) => { this.eye.setFromMatrixPosition(cam.matrixWorld); };
  }

  /** Is (x, y, z) close enough to the camera for its indicators to show? */
  near(x: number, y: number, z: number) { return (x - this.eye.x) ** 2 + (y - this.eye.y) ** 2 + (z - this.eye.z) ** 2 < BLINK_FAR * BLINK_FAR; }
  begin() { this.n = 0; }
  add(x: number, y: number, z: number, seed: number) {
    if (this.n >= this.seeds.count) return;
    this.mesh.setMatrixAt(this.n, tm.makeTranslation(x, y, z));
    this.seeds.setX(this.n, seed);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.seeds.needsUpdate = true;
  }
}

/** One additive beam quad on the road ahead of each moving vehicle, all in a single draw call. */
export class HeadlightPools {
  readonly mesh: InstancedMesh;
  /** per beam quad: lamp seed, half the lamp spacing, quad width (tiles) */
  private seeds: InstancedBufferAttribute;
  private n = 0;

  constructor(max: number) {
    // quad in the xz plane, uv.x running forward from the bumper
    const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.seeds = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('aSeed', this.seeds);
    const mat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uNight: { value: 0 } }]),
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG,
      transparent: true, depthWrite: false, blending: AdditiveBlending, fog: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    mat.uniforms.uNight = sceneUniforms.uNight;
    this.mesh = new InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'headlight-pools';
  }

  /** Pools are only filled while it is dark enough for someone to have their lamps on. */
  get active() { return sceneUniforms.uNight.value > 0.02; }

  begin() { this.n = 0; }
  /**
   * A vehicle at (x, z) facing `q`, its bumper `front` tiles ahead of its centre and its headlamps `half` either side
   * of its middle; each beam is `len` long and spreads to about `width` wide.
   */
  add(x: number, z: number, q: Quaternion, dirX: number, dirZ: number, front: number, len: number, width: number, half: number, seed: number) {
    if (this.n >= this.seeds.count) return;
    const d = front + len / 2, w = width + 2 * half;
    tp.set(x + dirX * d, 0.004, z + dirZ * d);
    tm.compose(tp, q, ts.set(len, 1, w));
    this.mesh.setMatrixAt(this.n, tm);
    this.seeds.setXYZ(this.n, seed, half, w);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.seeds.needsUpdate = true;
  }
}
