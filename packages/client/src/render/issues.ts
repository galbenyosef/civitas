import {
  Group, Mesh, InstancedBufferGeometry, InstancedBufferAttribute, PlaneGeometry, ShaderMaterial, CanvasTexture, LinearFilter,
  RingGeometry, MeshBasicMaterial, DoubleSide, Vector3, DynamicDrawUsage, Frustum, Matrix4, type Camera,
} from 'three';
import { CHUNK_SIZE, ISSUE_CODES, Issue, hash2, levelOf, underConstruction, zoneOf, isRoad, kindIdOf, parseKey } from '@msimcity/shared';
import type { ClientWorld } from '../world';
import { variant } from './models';
import { SIGN_MAX_DIST } from './signs';
import { sceneUniforms } from './materials';

const CELL = 128, CODES = 8;
const MAX_ICONS = 4096;
/** icons start to fade this far from the camera (past the name boards, render/signs.ts), each a hashed few tiles either way, over FADE_LEN */
export const ICON_FADE_START = SIGN_MAX_DIST * 2.4, ICON_FADE_JITTER = 14, ICON_FADE_LEN = 26;
/**
 * A starter town flags dozens of homes at once; a screen of badges says nothing. Badges of one code within GROUP_TILES of
 * each other show as one (a little larger the more it stands for), and at most ON_SCREEN show in view at a time: taken
 * a code at a time in the problems panel's order (most severe first), the nearest of each, round and round. A fire, and a
 * badge "show me" is pulsing, always show. The rest are in the problems list.
 */
export const GROUP_TILES = 4, ON_SCREEN = 5;

/** Ring colour per code: distinct hues that stay apart for colour-blind eyes, and every glyph has its own shape anyway. */
export const ISSUE_COLOUR: Record<number, string> = {
  [Issue.NoRoad]: '#ff8a3d', [Issue.NoBuilders]: '#ffd23f', [Issue.Unstaffed]: '#b98cff',
  [Issue.ParkingFull]: '#4fa3ff', [Issue.NoCustomers]: '#3ddbd9', [Issue.Unhappy]: '#ff5a7a', [Issue.Fire]: '#ff3418', [Issue.NoBurial]: '#9fc46a',
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
    case Issue.Fire: { // a flame with a bright heart
      g.beginPath();
      g.moveTo(0, 28); g.bezierCurveTo(-24, 28, -26, 4, -14, -8); g.bezierCurveTo(-12, 0, -8, 4, -5, 5);
      g.bezierCurveTo(-8, -10, 0, -22, 4, -30); g.bezierCurveTo(8, -16, 22, -8, 22, 10); g.bezierCurveTo(22, 22, 12, 28, 0, 28);
      g.fill();
      g.fillStyle = c;
      g.beginPath(); g.moveTo(0, 24); g.bezierCurveTo(-10, 24, -12, 12, -6, 4); g.bezierCurveTo(-2, 10, 4, 6, 4, 0); g.bezierCurveTo(10, 8, 12, 14, 10, 18); g.bezierCurveTo(8, 22, 4, 24, 0, 24); g.fill();
      break;
    }
    case Issue.NoBurial: { // a headstone with nowhere to stand: a stone over a struck-through plot (docs/remembrance.md)
      g.beginPath(); g.moveTo(-14, 16); g.lineTo(-14, -10); g.arc(0, -10, 14, Math.PI, 0); g.lineTo(14, 16); g.closePath(); g.fill();
      g.fillStyle = '#1a1f29'; g.fillRect(-7, -8, 14, 3); g.fillRect(-5, -1, 10, 3);
      g.strokeStyle = '#ffffff'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(-26, 24); g.lineTo(26, 24); g.stroke();
      g.strokeStyle = c; g.lineWidth = 7;
      g.beginPath(); g.moveTo(-24, -26); g.lineTo(24, 26); g.stroke();
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

/**
 * Where a door tile's badge floats: over the middle of its structure, a little above the roof of the design standing there
 * (the fires drawn over a burning building start from the same roof, render/fires.ts).
 */
export function roofAnchor(w: ClientWorld, x: number, y: number, above = 0.35): [number, number, number] {
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
    if (v) h = v.height * (s ? 1 : sc) + (uc ? 1.2 : above);
    else if (!uc) h = above > 0.3 ? 0.5 : 0.02;
  }
  return [mx, h, my];
}

/** One badge as an image URL, for the problems panel (client/src/problems.ts). */
export function issueGlyphUrl(code: number): string {
  const cv = document.createElement('canvas');
  cv.width = CELL; cv.height = CELL;
  drawBadge(cv.getContext('2d')!, 0, code);
  return cv.toDataURL();
}

/** one badge while the instances are rebuilt: n is how many of its code it stands for, d its (favoured) camera distance */
interface Badge { x: number; y: number; code: number; seed: number; n: number; flash: boolean; d: number; at?: [number, number, number] }

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
  float s = (1.0 + 0.22 * seed) * (1.0 + 0.25 * aD.w) * clamp(d / 24.0, 1.0, 3.4) * pulse;
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
 * Issue bubbles (docs/audit-2026-10.md section 4.4): a badge over the buildings and lots the server flags (message
 * `issues`, ClientWorld.issues), floating over its roof, one per group of neighbours with the same problem and at most
 * ON_SCREEN in view (picked again as the camera moves). One instanced billboard pass, one draw call: a canvas atlas of
 * the seven glyphs, each instance its own bob and size from hash2 (the organic rule), fading past the name boards'
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
  private frustum = new Frustum(); private m4 = new Matrix4();
  private camera: Camera | null = null;
  /** where the camera was at the last rebuild, to rebuild when it moves (the picks follow the view) */
  private camAt = new Vector3(Infinity, 0, 0); private camDir = new Vector3(); private dir = new Vector3();
  /** door tiles ("x,y") shown at the last rebuild: a little favoured next time, so badges do not swap as the view drifts */
  private shown = new Set<string>();

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
    this.ring = new Mesh(new RingGeometry(0.62, 1.08, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffb020, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide, toneMapped: false }));
    this.ring.visible = false; this.ring.renderOrder = 11;
    this.group.add(this.ring);
  }

  get count() { return this.geo.instanceCount; }

  /**
   * Once a frame: rebuild the instances when the codes changed, when the camera has moved or turned (the badges in view are
   * picked again, at most every quarter second), or every couple of seconds as heights follow the tiles; animate a flash.
   */
  frame(now: number, camera?: Camera) {
    if (camera) this.camera = camera;
    let moved = false;
    if (this.camera && now - this.builtAt > 250) {
      const cp = (this.camera as unknown as { position: Vector3 }).position;
      this.camera.getWorldDirection(this.dir);
      moved = cp.distanceTo(this.camAt) > 1.5 || this.dir.dot(this.camDir) < 0.996;
    }
    if (this.world.issuesVersion !== this.builtVersion || moved || now - this.builtAt > 2000) this.rebuild(now);
    if (this.flashes.size) {
      let changed = false;
      for (const [k, until] of this.flashes) if (now > until) { this.flashes.delete(k); changed = true; }
      if (changed) this.rebuild(now);
    }
    if (this.ring.visible) {
      const f = (now - this.ringAt) / 1000;
      if (now > this.ringUntil) this.ring.visible = false;
      else { const s = this.ringSize * (1 + 0.25 * Math.sin(f * 6)); this.ring.scale.set(s, 1, s); (this.ring.material as MeshBasicMaterial).opacity = 0.8 + 0.2 * Math.sin(f * 6); }
    }
  }

  private rebuild(now: number) {
    const w = this.world;
    this.builtAt = now; this.builtVersion = w.issuesVersion;
    this.tiles.length = 0;
    const cam = this.camera;
    if (cam) {
      this.camAt.copy((cam as unknown as { position: Vector3 }).position); cam.getWorldDirection(this.camDir);
      cam.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    }
    // every badge, then one per group: the first in a stable hashed order holds its code's cells round it
    const all: Badge[] = [];
    for (const [key, bytes] of w.issues) {
      const [cx, cy] = parseKey(key);
      for (let i = 0; i < bytes.length; i++) {
        const code = bytes[i];
        if (!code) continue;
        const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        all.push({ x, y, code, seed: hash2(x * 5 + 1, y * 3 + 7), n: 1, flash: this.flashes.has(`${x},${y}`), d: 0 });
      }
    }
    all.sort((a, b) => a.seed - b.seed);
    const held = new Map<string, Badge>(), groups: Badge[] = [];
    for (const b of all) {
      if (b.code === Issue.Fire || b.flash) { groups.push(b); continue; }
      const gx = Math.floor(b.x / GROUP_TILES), gy = Math.floor(b.y / GROUP_TILES);
      let into: Badge | undefined;
      for (let j = -1; j <= 1 && !into; j++) for (let i = -1; i <= 1 && !into; i++) {
        const o = held.get(`${b.code},${gx + i},${gy + j}`);
        if (o && Math.abs(o.x - b.x) <= GROUP_TILES && Math.abs(o.y - b.y) <= GROUP_TILES) into = o;
      }
      if (into) { into.n++; continue; }
      const k = `${b.code},${gx},${gy}`;
      if (!held.has(k)) held.set(k, b);
      groups.push(b);
    }
    // the ones in view, a code at a time (most severe first), the nearest of each; fires and flashes on top of the count
    const camPos = cam ? (cam as unknown as { position: Vector3 }).position : null;
    const pick: Badge[] = [], queues = new Map<number, Badge[]>();
    for (const b of groups) {
      const at = this.anchor(b.x, b.y);
      b.at = at;
      if (b.code === Issue.Fire || b.flash || !camPos) { pick.push(b); continue; }
      this.v.set(at[0], at[1], at[2]);
      b.d = camPos.distanceTo(this.v) * (this.shown.has(`${b.x},${b.y}`) ? 0.8 : 1);
      if (b.d > ICON_FADE_START + ICON_FADE_JITTER + ICON_FADE_LEN || !this.frustum.containsPoint(this.v)) continue;
      let q = queues.get(b.code);
      if (!q) queues.set(b.code, q = []);
      q.push(b);
    }
    for (const q of queues.values()) q.sort((a, b) => a.d - b.d);
    for (let round = 0, left = ON_SCREEN; left > 0; round++) {
      let any = false;
      for (const code of ISSUE_CODES) {
        const b = queues.get(code)?.[round];
        if (!b || left <= 0) continue;
        pick.push(b); left--; any = true;
      }
      if (!any) break;
    }
    this.shown.clear();
    let n = 0;
    for (const b of pick) {
      if (n >= MAX_ICONS) break;
      const at = b.at!;
      this.shown.add(`${b.x},${b.y}`);
      this.pos[n * 3] = at[0]; this.pos[n * 3 + 1] = at[1] + (b.code === Issue.Fire ? 1.0 : 0); this.pos[n * 3 + 2] = at[2]; // on fire: above the flames (render/fires.ts)
      // a group's badge a touch larger the more it stands for (data.w), each its own hashed bob and size as ever
      this.data[n * 4] = b.code; this.data[n * 4 + 1] = b.seed; this.data[n * 4 + 2] = b.flash ? 1 : 0; this.data[n * 4 + 3] = Math.min(1, (b.n - 1) / 6);
      this.tiles.push(b.x, b.y);
      n++;
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('aP') as InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aD') as InstancedBufferAttribute).needsUpdate = true;
  }

  private anchor(x: number, y: number): [number, number, number] { return roofAnchor(this.world, x, y); }

  /** The door tile of the badge under the pointer (screen px), or null. */
  pick(px: number, py: number, camera: Camera, width: number, height: number): [number, number] | null {
    if (!this.group.visible) return null;
    let best = -1, bestD = 22 * 22;
    const camPos = (camera as unknown as { position: Vector3 }).position;
    for (let i = 0; i < this.geo.instanceCount; i++) {
      const d = camPos.distanceTo(this.v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]));
      if (d > ICON_FADE_START + ICON_FADE_JITTER + ICON_FADE_LEN * 0.5) continue;
      const s = (1.0 + 0.22 * this.data[i * 4 + 1]) * (1 + 0.25 * this.data[i * 4 + 3]) * Math.min(3.4, Math.max(1.0, d / 24));
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

