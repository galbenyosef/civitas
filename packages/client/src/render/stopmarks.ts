import {
  Group, Mesh, InstancedBufferGeometry, InstancedBufferAttribute, PlaneGeometry, ShaderMaterial, Color, DynamicDrawUsage, DoubleSide,
} from 'three';
import { hash2, type TransitMode } from '@msimcity/shared';
import { sceneUniforms } from './materials';
import { ICON_FADE_START, ICON_FADE_JITTER, ICON_FADE_LEN } from './issues';

/**
 * The stops of a line being edited, made easy to see (docs/transit.md "Stops you can see"; playtest ede1a287): every stop
 * of the draft's mode within reach (all four modes while a new line has no stop yet) wears a soft ring on the ground and a
 * small pin floating over it, in its mode's colour, both pulsing slowly. A stop already on the draft has a brighter, larger
 * ring in the line's colour (its number badge is lines.ts's, and stands where the pin would); the stop under the cursor
 * glows, grows and ignores the distance fade.
 *
 * Two instanced draws (the rings on the ground, the pins as billboards) over one set of per-stop attributes, built when
 * editing starts and when the stop set or the draft's stops change, never per frame: the pulse, the bob, the fade with
 * distance (the issue bubbles' fade, render/issues.ts, so the markers go as the name boards go) and the hover glow are
 * all in the shaders. Each stop has its own phase, pulse period and pin height, hashed from its tile (the organic rule),
 * and a marker is never smaller on screen than a few percent of its distance, so a line's stops still read when the whole
 * route is in view.
 */
export const MODE_COLOUR: Record<TransitMode, number> = { bus: 0xf2a33a, rail: 0x4f9bd9, metro: 0xe0483f, ferry: 0x2fb8a8 };
const MAX_MARKS = 2048;

/** one stop to mark: its tile (a station's door), the reach of its ring, the height its pin floats at, and the draft it is on */
export interface Mark {
  /** the stop's tile (a station's door): what a line knows it by */
  x: number; y: number; mode: TransitMode;
  /** where the ring and pin stand (the middle of a station; absent: the middle of the tile) */
  cx?: number; cz?: number;
  /** the ring's radius in tiles (a bigger building, a bigger ring) */
  radius: number;
  /** pin height over the ground */
  top: number;
  /** the line's colour when the stop is on the draft */
  colour?: number;
}

const COMMON = /* glsl */ `
attribute vec3 aP;
attribute vec4 aC;
attribute vec4 aS;
uniform float uTime;
uniform float uFadeStart;
uniform float uFadeLen;
uniform float uFadeJitter;
uniform vec2 uHover;
uniform float uY;
varying vec2 vUv;
varying vec4 vC;
varying float vA;
varying float vHov;
varying float vSeed;
float hoverOf() { return (abs(aP.x - uHover.x) < 0.01 && abs(aP.z - uHover.y) < 0.01) ? 1.0 : 0.0; }
float fadeOf(float d, float seed, float hov) {
  float fs = uFadeStart + uFadeJitter * (fract(seed * 13.0) - 0.5) * 2.0;
  return hov > 0.5 ? 1.0 : 1.0 - smoothstep(fs, fs + uFadeLen, d);
}`;

const RING_VERT = /* glsl */ `${COMMON}
void main() {
  float seed = aS.x, hov = hoverOf(), draft = aC.w;
  vec3 c = vec3(aP.x, aP.y + uY, aP.z);
  float d = distance(cameraPosition, c);
  // each ring breathes at its own pace; a ring on the draft is larger, and the hovered one larger still
  float breath = 1.0 + 0.07 * sin(uTime * (1.2 + 0.9 * fract(seed * 5.0)) + seed * 40.0);
  float R = max(aS.y, d * 0.016) * breath * (1.0 + 0.18 * draft + 0.22 * hov);
  float Q = R * 1.5; // the quad reaches past the ring for the glow and the spreading wave
  vec3 p = c + vec3(position.x * 2.0 * Q, 0.0, -position.y * 2.0 * Q);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = position.xy * 3.0; // -1.5..1.5, in units of the ring's radius
  vC = vec4(aC.rgb, draft); vHov = hov; vSeed = seed;
  vA = fadeOf(d, seed, hov);
}`;
const RING_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vC;
varying float vA;
varying float vHov;
varying float vSeed;
void main() {
  float r = length(vUv);
  float pulse = 0.5 + 0.5 * sin(uTime * (1.6 + 1.1 * fract(vSeed * 3.0)) + vSeed * 31.0);
  float band = smoothstep(0.74, 0.84, r) * (1.0 - smoothstep(0.96, 1.06, r));
  float fill = (1.0 - smoothstep(0.0, 0.98, r)) * (0.14 + 0.10 * pulse);
  // a wave spreading out from the ring and fading, on its own period
  float per = 2.2 + 1.6 * fract(vSeed * 7.0);
  float ph = fract(uTime / per + vSeed * 3.7);
  float wave = (1.0 - ph) * (1.0 - smoothstep(0.0, 0.09, abs(r - mix(0.9, 1.5, ph)))) * 0.7;
  float k = 0.70 + 0.30 * pulse + 0.5 * vC.w + 0.55 * vHov;
  float a = clamp((band * k + fill * (1.0 + vHov) + wave * (1.0 + vC.w)) * vA, 0.0, 1.0);
  if (a < 0.02) discard;
  vec3 col = mix(vC.rgb, vec3(1.0), 0.28 * vC.w + 0.35 * vHov + 0.25 * band * pulse);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const PIN_VERT = /* glsl */ `${COMMON}
void main() {
  float seed = aS.x, hov = hoverOf(), draft = aC.w;
  // a stop on the draft wears its number badge where the pin would float
  float bob = sin(uTime * (1.1 + 0.8 * fract(seed * 9.0)) + seed * 50.0) * (0.06 + 0.05 * fract(seed * 4.0));
  vec3 c = vec3(aP.x, aP.y + aS.z + bob + uY, aP.z);
  float d = distance(cameraPosition, c);
  float grow = 1.0 + 0.08 * sin(uTime * (1.4 + fract(seed * 6.0)) + seed * 17.0) + 0.38 * hov;
  float s = 0.42 * (1.0 + 0.2 * fract(seed * 11.0)) * clamp(d / 22.0, 1.0, 3.2) * grow;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * position.x + up * (position.y + 0.5)) * s; // the point of the pin is at c
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = uv; vC = vec4(aC.rgb, draft); vHov = hov; vSeed = seed;
  vA = draft > 0.5 ? 0.0 : fadeOf(d, seed, hov);
}`;
const PIN_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vC;
varying float vA;
varying float vHov;
void main() {
  if (vA < 0.02) discard;
  vec2 p = vUv - vec2(0.5, 0.64);
  float head = length(p) - 0.27;
  float tail = max(abs(p.x) - 0.27 * clamp((p.y + 0.6) / 0.6, 0.0, 1.0), max(-(p.y + 0.6), p.y));
  float d = min(head, tail);
  float body = 1.0 - smoothstep(-0.012, 0.012, d);
  float edge = body * smoothstep(-0.075, -0.045, d); // the white rim
  float dot_ = 1.0 - smoothstep(0.085, 0.105, length(p));
  float a = body * vA;
  if (a < 0.02) discard;
  vec3 col = mix(vC.rgb * (1.0 + 0.35 * vHov), vec3(1.0), edge);
  col = mix(col, vec3(1.0), dot_);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class StopMarks {
  readonly group = new Group();
  private geo = new InstancedBufferGeometry();
  private pos = new Float32Array(MAX_MARKS * 3);
  private col = new Float32Array(MAX_MARKS * 4);
  private sh = new Float32Array(MAX_MARKS * 4);
  private ringMat: ShaderMaterial;
  private pinMat: ShaderMaterial;
  private uniforms: Record<string, { value: unknown }>;
  private tmp = new Color();
  /** each stop's ring centre by its door tile, for the hover */
  private centres = new Map<string, [number, number]>();
  /** how many stops are marked, and how many of them are on the draft */
  count = 0; onDraft = 0;
  /** rebuilds so far (the check counts them) */
  builds = 0;

  constructor() {
    const plane = new PlaneGeometry(1, 1);
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setAttribute('uv', plane.getAttribute('uv'));
    this.geo.setAttribute('aP', new InstancedBufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aC', new InstancedBufferAttribute(this.col, 4).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aS', new InstancedBufferAttribute(this.sh, 4).setUsage(DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.uniforms = {
      uTime: sceneUniforms.uTime, uHover: { value: [-1e6, -1e6] }, uY: { value: 0 },
      uFadeStart: { value: ICON_FADE_START }, uFadeLen: { value: ICON_FADE_LEN }, uFadeJitter: { value: ICON_FADE_JITTER },
    };
    const make = (vertexShader: string, fragmentShader: string) => new ShaderMaterial({
      vertexShader, fragmentShader, uniforms: this.uniforms, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false,
    });
    this.ringMat = make(RING_VERT, RING_FRAG);
    this.pinMat = make(PIN_VERT, PIN_FRAG);
    this.pinMat.depthTest = false;
    const rings = new Mesh(this.geo, this.ringMat), pins = new Mesh(this.geo, this.pinMat);
    rings.frustumCulled = false; pins.frustumCulled = false;
    rings.renderOrder = 8; pins.renderOrder = 10;
    this.group.add(rings, pins);
    this.group.visible = false;
  }

  /**
   * Set the stops to mark. `under`: the markers sit at tunnel depth over the tunnels with the depth test off (a metro line
   * being edited, lines.ts), `yShift` the offset to there.
   */
  set(marks: Mark[], under = false, yShift = 0) {
    this.builds++;
    this.centres.clear();
    let n = 0, draft = 0;
    for (const m of marks) {
      if (n >= MAX_MARKS) break;
      const seed = hash2(m.x * 7 + 3, m.y * 11 + 5);
      const px = m.cx ?? m.x + 0.5, pz = m.cz ?? m.y + 0.5;
      this.pos[n * 3] = px; this.pos[n * 3 + 1] = 0.085 + 0.002 * (seed - 0.5); this.pos[n * 3 + 2] = pz;
      this.centres.set(`${m.x},${m.y}`, [px, pz]);
      this.tmp.setHex(m.colour ?? MODE_COLOUR[m.mode]);
      this.col[n * 4] = this.tmp.r; this.col[n * 4 + 1] = this.tmp.g; this.col[n * 4 + 2] = this.tmp.b; this.col[n * 4 + 3] = m.colour === undefined ? 0 : 1;
      this.sh[n * 4] = seed; this.sh[n * 4 + 1] = m.radius; this.sh[n * 4 + 2] = m.top * (0.94 + 0.12 * hash2(m.y * 5 + 9, m.x * 3 + 1)); this.sh[n * 4 + 3] = 0;
      if (m.colour !== undefined) draft++;
      n++;
    }
    this.count = n; this.onDraft = draft;
    this.geo.instanceCount = n;
    for (const k of ['aP', 'aC', 'aS']) (this.geo.getAttribute(k) as InstancedBufferAttribute).needsUpdate = true;
    this.uniforms.uY.value = yShift;
    this.ringMat.depthTest = !under;
    this.live = n > 0;
    this.group.visible = this.live && this.shown;
  }
  private live = false; private shown = true;
  /** Hide the markers without forgetting them (first person, where there is no map to read). */
  setShown(on: boolean) { this.shown = on; this.group.visible = this.live && on; }
  /** The tile under the cursor (a stop's door tile), or null: that stop glows. Returns whether a stop is there. */
  setHover(x: number | null, y: number | null): boolean {
    const at = x === null || y === null ? undefined : this.centres.get(`${x},${y}`);
    (this.uniforms.uHover.value as number[])[0] = at ? at[0] : -1e6;
    (this.uniforms.uHover.value as number[])[1] = at ? at[1] : -1e6;
    return !!at;
  }
  clear() { this.count = 0; this.onDraft = 0; this.geo.instanceCount = 0; this.live = false; this.group.visible = false; this.centres.clear(); this.setHover(null, null); }
  dispose() { this.geo.dispose(); this.ringMat.dispose(); this.pinMat.dispose(); }
}
