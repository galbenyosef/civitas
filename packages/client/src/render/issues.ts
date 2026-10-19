import {
  Group, Mesh, InstancedBufferGeometry, InstancedBufferAttribute, PlaneGeometry, ShaderMaterial, CanvasTexture, LinearFilter,
  RingGeometry, MeshBasicMaterial, DoubleSide, Vector3, DynamicDrawUsage, type Camera,
} from 'three';
import { CHUNK_SIZE, Issue, hash2, levelOf, underConstruction, zoneOf, isRoad, kindIdOf, parseKey } from '@msimcity/shared';
import type { ClientWorld } from '../world';
import { variant } from './models';
import { SIGN_MAX_DIST } from './signs';
import { sceneUniforms } from './materials';

const CELL = 128, CODES = 6;
const MAX_ICONS = 4096;
/** icons start to fade this far from the camera (past the name boards, render/signs.ts), each a hashed few tiles either way, over FADE_LEN */
export const ICON_FADE_START = SIGN_MAX_DIST * 2.4, ICON_FADE_JITTER = 14, ICON_FADE_LEN = 26;

/** Ring colour per code: distinct hues that stay apart for colour-blind eyes, and every glyph has its own shape anyway. */
export const ISSUE_COLOUR: Record<number, string> = {
  [Issue.NoRoad]: '#ff8a3d', [Issue.NoBuilders]: '#ffd23f', [Issue.Unstaffed]: '#b98cff',
  [Issue.ParkingFull]: '#4fa3ff', [Issue.NoCustomers]: '#3ddbd9', [Issue.Unhappy]: '#ff5a7a',
};

/** Draw one badge (a dark disc in its code's ring, a white glyph, a point underneath) into a CELL×CELL box at (ox, 0). */
function drawBadge(g: CanvasRenderingContext2D, ox: number, code: number) {
  const c = ISSUE_COLOUR[code];
  const cx = ox + CELL / 2, cy = 52, r = 42;
  g.save();
  // the point, then the disc over it
  g.fillStyle = c;
  g.beginPath(); g.moveTo(cx - 16, cy + 30); g.lineTo(cx + 16, cy + 30); g.lineTo(cx, cy + 66); g.closePath(); g.fill();
  g.beginPath(); g.arc(cx, cy, r + 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1a1f29';
  g.beginPath(); g.arc(cx, cy, r - 1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.translate(cx, cy);
  switch (code) {
    case Issue.NoRoad: { // a stretch of road with a bar through it
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(-12, -26); g.lineTo(-18, 26); g.moveTo(12, -26); g.lineTo(18, 26); g.stroke();
      g.lineWidth = 4; g.setLineDash([7, 7]);
      g.beginPath(); g.moveTo(0, -24); g.lineTo(0, 26); g.stroke(); g.setLineDash([]);
      g.strokeStyle = c; g.lineWidth = 8;
      g.beginPath(); g.moveTo(-26, -20); g.lineTo(26, 20); g.stroke();
      break;
    }
    case Issue.NoBuilders: { // a crane with nobody on the hook
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(-14, 28); g.lineTo(-14, -24); g.lineTo(26, -24); g.moveTo(-14, -24); g.lineTo(-26, -24); g.stroke();
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(-14, -12); g.lineTo(6, -24); g.moveTo(18, -24); g.lineTo(18, 2); g.stroke();
      g.beginPath(); g.arc(18, 7, 5, Math.PI * 1.1, Math.PI * 2.1); g.stroke();
      g.fillRect(-24, 26, 20, 5);
      break;
    }
    case Issue.Unstaffed: { // a person with a minus
      g.beginPath(); g.arc(-6, -14, 10, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(-26, 26); g.quadraticCurveTo(-26, 0, -6, 0); g.quadraticCurveTo(14, 0, 14, 26); g.closePath(); g.fill();
      g.strokeStyle = c; g.lineWidth = 7;
      g.beginPath(); g.moveTo(14, -16); g.lineTo(30, -16); g.stroke();
      break;
    }
    case Issue.ParkingFull: { // a P over a full bar
      g.font = 'bold 50px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('P', 0, -4);
      g.fillStyle = c; g.fillRect(-20, 22, 40, 7);
      break;
    }
    case Issue.NoCustomers: { // an empty basket
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(-26, -4); g.lineTo(26, -4); g.lineTo(18, 24); g.lineTo(-18, 24); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(-14, -4); g.lineTo(-4, -24); g.moveTo(14, -4); g.lineTo(4, -24); g.stroke();
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(-8, 4); g.lineTo(-6, 18); g.moveTo(0, 4); g.lineTo(0, 18); g.moveTo(8, 4); g.lineTo(6, 18); g.stroke();
      break;
    }
    case Issue.Unhappy: { // a frowning face
      g.lineWidth = 4;
      g.beginPath(); g.arc(0, 0, 27, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(-10, -7, 4, 0, Math.PI * 2); g.arc(10, -7, 4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(0, 19, 12, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      break;
    }
  }
  g.restore();
}

/** One badge as an image URL, for the problems panel (client/src/problems.ts). */
export function issueGlyphUrl(code: number): string {
  const cv = document.createElement('canvas');
  cv.width = CELL; cv.height = CELL;
  drawBadge(cv.getContext('2d')!, 0, code);
  return cv.toDataURL();
}

const VERT = /* glsl */ `
attribute vec3 aP;
attribute vec4 aD;
uniform float uTime;
uniform float uFadeStart;
uniform float uFadeLen;
uniform float uFadeJitter;
varying vec2 vUv;
varying float vA;
varying float vCode;
void main() {
  float seed = aD.y, flash = aD.z;
  // each icon bobs at its own pace and phase, and is its own size (hashed): nothing moves in lockstep
  float bob = sin(uTime * (1.3 + 0.7 * seed) + seed * 40.0) * (0.10 + 0.08 * fract(seed * 7.0));
  vec3 c = aP + vec3(0.0, bob, 0.0);
  float d = distance(cameraPosition, c);
  float pulse = flash > 0.0 ? 1.0 + 0.35 * (0.5 + 0.5 * sin(uTime * 9.0)) : 1.0;
  float s = (1.0 + 0.22 * seed) * clamp(d / 24.0, 1.0, 3.4) * pulse;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = c + (right * position.x + up * (position.y + 0.5)) * s; // the point of the badge sits on the roof
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float fs = uFadeStart + uFadeJitter * (fract(seed * 13.0) - 0.5) * 2.0;
  vA = flash > 0.0 ? 1.0 : 1.0 - smoothstep(fs, fs + uFadeLen, d);
  vUv = uv;
  vCode = aD.x;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uNight;
varying vec2 vUv;
varying float vA;
varying float vCode;
void main() {
  vec4 t = texture2D(uAtlas, vec2((vCode - 1.0 + vUv.x) / ${CODES}.0, vUv.y));
  float a = t.a * vA;
  if (a < 0.03) discard;
  gl_FragColor = vec4(t.rgb * (1.0 - 0.18 * uNight), a);
}`;

/**
 * Issue bubbles (docs/audit-2026-10.md section 4.4): a badge over every building or lot the server flags (message
 * `issues`, ClientWorld.issues), floating over its roof. One instanced billboard pass, one draw call: a canvas atlas of
 * the six glyphs, each instance its own bob and size from hash2 (the organic rule), fading past the name boards'
 * distance by its own hashed amount. The caller hides it in the world map, the underground view and first person.
 */
export class IssuesView {
  group = new Group();
  private geo = new InstancedBufferGeometry();
  private pos = new Float32Array(MAX_ICONS * 3);
  private data = new Float32Array(MAX_ICONS * 4);
  private mat: ShaderMaterial;
  private mesh: Mesh;
  /** door tile of each instance, for picking and flashing */
  private tiles: number[] = [];
  private builtAt = -1; private builtVersion = -1;
  private flashes = new Map<string, number>();
  private ring: Mesh;
  private ringUntil = 0; private ringAt = 0; private ringSize = 1;
  private v = new Vector3();

  constructor(private world: ClientWorld) {
    const cv = document.createElement('canvas');
    cv.width = CELL * CODES; cv.height = CELL;
    const g = cv.getContext('2d')!;
    for (let i = 0; i < CODES; i++) drawBadge(g, i * CELL, i + 1);
    const tex = new CanvasTexture(cv);
    tex.minFilter = LinearFilter; tex.generateMipmaps = false;
    const plane = new PlaneGeometry(1, 1);
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setAttribute('uv', plane.getAttribute('uv'));
    this.geo.setAttribute('aP', new InstancedBufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aD', new InstancedBufferAttribute(this.data, 4).setUsage(DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uAtlas: { value: tex }, uTime: sceneUniforms.uTime, uNight: sceneUniforms.uNight,
        uFadeStart: { value: ICON_FADE_START }, uFadeLen: { value: ICON_FADE_LEN }, uFadeJitter: { value: ICON_FADE_JITTER },
      },
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.group.add(this.mesh);
    // "show me": a ring pulsing on the tile
    this.ring = new Mesh(new RingGeometry(0.62, 0.8, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffd479, transparent: true, depthWrite: false, side: DoubleSide }));
    this.ring.visible = false; this.ring.renderOrder = 11;
    this.group.add(this.ring);
  }

  get count() { return this.geo.instanceCount; }

  /** Once a frame: rebuild the instances when the codes changed (or every couple of seconds, as heights follow the tiles), animate a flash. */
  frame(now: number) {
    if (this.world.issuesVersion !== this.builtVersion || now - this.builtAt > 2000) this.rebuild(now);
    if (this.flashes.size) {
      let changed = false;
      for (const [k, until] of this.flashes) if (now > until) { this.flashes.delete(k); changed = true; }
      if (changed) this.rebuild(now);
    }
    if (this.ring.visible) {
      const f = (now - this.ringAt) / 1000;
      if (now > this.ringUntil) this.ring.visible = false;
      else { const s = this.ringSize * (1 + 0.25 * Math.sin(f * 6)); this.ring.scale.set(s, 1, s); (this.ring.material as MeshBasicMaterial).opacity = 0.55 + 0.4 * Math.sin(f * 6); }
    }
  }

  private rebuild(now: number) {
    const w = this.world;
    this.builtAt = now; this.builtVersion = w.issuesVersion;
    this.tiles.length = 0;
    let n = 0;
    for (const [key, bytes] of w.issues) {
      const [cx, cy] = parseKey(key);
      for (let i = 0; i < bytes.length && n < MAX_ICONS; i++) {
        const code = bytes[i];
        if (!code) continue;
        const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        const at = this.anchor(x, y);
        this.pos[n * 3] = at[0]; this.pos[n * 3 + 1] = at[1]; this.pos[n * 3 + 2] = at[2];
        this.data[n * 4] = code; this.data[n * 4 + 1] = hash2(x * 5 + 1, y * 3 + 7); this.data[n * 4 + 2] = this.flashes.has(`${x},${y}`) ? 1 : 0; this.data[n * 4 + 3] = 0;
        this.tiles.push(x, y);
        n++;
      }
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('aP') as InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aD') as InstancedBufferAttribute).needsUpdate = true;
  }

  /** Where a door tile's badge floats: over the middle of its structure, a little above the roof of the design standing there. */
  private anchor(x: number, y: number): [number, number, number] {
    const w = this.world;
    const s = w.structureAt(x, y);
    const ax = s ? s.ax : x, ay = s ? s.ay : y;
    const mx = s ? s.ax + s.w / 2 : x + 0.5, my = s ? s.ay + s.h / 2 : y + 0.5;
    const t = w.getTile(x, y);
    let h = 0.5;
    if (t !== undefined && !isRoad(t)) {
      const kind = kindIdOf(zoneOf(t), w.subAt(x, y)), level = levelOf(t), uc = underConstruction(t);
      // the same design pick and scale as render/chunkView.ts, so the badge sits on the roof that is drawn
      const pick = hash2(ax * 13 + 5, ay * 17 + 11), sc = 0.95 + 0.1 * hash2(ay * 3 + 1, ax * 5 + 7);
      const v = level > 0 ? variant(kind, level, pick) : uc ? variant(kind, 1, pick) : undefined;
      if (v) h = v.height * (s ? 1 : sc) + (uc ? 1.2 : 0.35);
    }
    return [mx, h, my];
  }

  /** The door tile of the badge under the pointer (screen px), or null. */
  pick(px: number, py: number, camera: Camera, width: number, height: number): [number, number] | null {
    if (!this.group.visible) return null;
    let best = -1, bestD = 22 * 22;
    const camPos = (camera as unknown as { position: Vector3 }).position;
    for (let i = 0; i < this.geo.instanceCount; i++) {
      const d = camPos.distanceTo(this.v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]));
      if (d > ICON_FADE_START + ICON_FADE_JITTER + ICON_FADE_LEN * 0.5) continue;
      const s = (1.0 + 0.22 * this.data[i * 4 + 1]) * Math.min(3.4, Math.max(1.0, d / 24));
      this.v.y += s * 0.55; // the disc's middle, above the point
      this.v.project(camera);
      if (this.v.z > 1) continue;
      const sx = (this.v.x + 1) * 0.5 * width, sy = (1 - this.v.y) * 0.5 * height;
      const dd = (sx - px) ** 2 + (sy - py) ** 2;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best < 0 ? null : [this.tiles[best * 2], this.tiles[best * 2 + 1]];
  }

  /** "show me": the badge pulses (and ignores the distance fade) and a ring circles the tile for a few seconds. */
  flash(x: number, y: number, ms = 5000) {
    const now = performance.now();
    this.flashes.set(`${x},${y}`, now + ms);
    this.builtVersion = -1;
    const s = this.world.structureAt(x, y);
    const w = s ? Math.max(s.w, s.h) : 1;
    this.ring.position.set(s ? s.ax + s.w / 2 : x + 0.5, 0.06, s ? s.ay + s.h / 2 : y + 0.5);
    this.ringSize = w;
    this.ring.visible = true; this.ringAt = now; this.ringUntil = now + ms;
  }
}

