import { InstancedMesh, PlaneGeometry, ShaderMaterial, InstancedBufferAttribute, DynamicDrawUsage, AdditiveBlending, UniformsUtils, UniformsLib, Matrix4, Quaternion, Vector3 } from 'three';
import { hash2 } from '@msimcity/shared';
import { sceneUniforms } from './materials';

/**
 * Vehicle lamps after dark, without a single three.js light: the lamp boxes on the car models glow (the vehicle
 * material reads their tag from `aWin`), and each moving vehicle lays one additive quad on the road ahead, shaped
 * like a dipped beam. Every driver keeps their own habits, seeded from the agent id: the darkness at which they
 * switch on (some at the first hint of dusk, some only when it is properly dark), halogen, LED or xenon colour,
 * brightness, the odd daytime-running-light car and the odd blown bulb. Tail lights brighten when the car is held up.
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
float mscLampGain(float seed) { return 0.75 + 0.55 * fract(seed * 11.3); }`;

/** Vertex and fragment additions for the vehicle material (call from its onBeforeCompile). */
export function lampShader(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }) {
  shader.uniforms.uNight = sceneUniforms.uNight;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute float aWin;
attribute vec2 aLampI;
varying float vLamp;
varying vec3 vLampI;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vLamp = aWin; vLampI = vec3(aLampI, step(0.0, position.z));`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uNight;
varying float vLamp;
varying vec3 vLampI;
${LAMP_GLSL}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vLamp > 0.5 && vLampI.x >= 0.0) {
  float seed = vLampI.x, on = mscLampOn(seed, uNight);
  if (vLamp < 1.5) {
    float dead = step(fract(seed * 23.7), 0.04) * vLampI.z; // a blown bulb on one side
    totalEmissiveRadiance += mscLampColor(seed) * mscLampGain(seed) * on * 2.6 * (1.0 - dead);
  } else if (vLamp < 2.5) {
    totalEmissiveRadiance += vec3(1.0, 0.07, 0.035) * (on * 0.9 + vLampI.y * (0.5 + 1.6 * on));
  } else {
    totalEmissiveRadiance += vec3(1.0, 0.82, 0.4) * on * 1.3;
  }
}`);
}

/** A per-instance (seed, brake) attribute for a vehicle mesh; every mesh drawn with the vehicle material needs one. */
export function lampAttribute(count: number, seed = 0): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(DynamicDrawUsage);
  if (seed) for (let i = 0; i < count; i++) a.setX(i, seed);
  return a;
}

const POOL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv; vSeed = aSeed;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const POOL_FRAG = /* glsl */ `
uniform float uNight;
varying vec2 vUv;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
${LAMP_GLSL}
void main() {
  float on = mscLampOn(vSeed, uNight) * smoothstep(0.02, 0.3, uNight);
  if (on < 0.003) discard;
  // a dipped beam: narrow at the bumper, widening and fading down the road
  float f = vUv.x, s = vUv.y - 0.5;
  float w = 0.11 + 0.30 * f;
  float lat = exp(-(s * s) / (w * w) * 2.4);
  float along = smoothstep(0.0, 0.12, f) * pow(1.0 - f, 1.5);
  vec3 c = mscLampColor(vSeed) * mscLampGain(vSeed) * on * lat * along * 0.5;
  #ifdef USE_FOG
    c *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const tm = new Matrix4(), tp = new Vector3(), ts = new Vector3();

/** One additive beam quad on the road ahead of each moving vehicle, all in a single draw call. */
export class HeadlightPools {
  readonly mesh: InstancedMesh;
  private seeds: InstancedBufferAttribute;
  private n = 0;

  constructor(max: number) {
    // quad in the xz plane, uv.x running forward from the bumper
    const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.seeds = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage);
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
  /** A vehicle at (x, z) facing `q`, its bumper `front` tiles ahead of its centre; the beam is `len` long and `width` wide. */
  add(x: number, z: number, q: Quaternion, dirX: number, dirZ: number, front: number, len: number, width: number, seed: number) {
    if (this.n >= this.seeds.count) return;
    const d = front + len / 2;
    tp.set(x + dirX * d, 0.004, z + dirZ * d);
    tm.compose(tp, q, ts.set(len, 1, width));
    this.mesh.setMatrixAt(this.n, tm);
    this.seeds.setX(this.n, seed);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.seeds.needsUpdate = true;
  }
}
