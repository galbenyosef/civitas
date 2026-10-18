import {
  BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Mesh, Points, Group, Color, MeshBasicMaterial, ShaderMaterial,
  AdditiveBlending, DoubleSide, type Material, type Object3D, type WebGLRenderer,
} from 'three';
import { CHUNK_SIZE, hash2, isRoad, terrainOf, Terrain, isTunnel, isPlatform, underMask, platformRun, trackKey, type StationStop } from '@msimcity/shared';
import type { ClientChunk, ClientWorld } from '../world';
import { sceneUniforms } from './materials';
import type { Lighting } from './lighting';

/**
 * The underground (docs/underground.md section 5): the view that fades the surface and shows the under layer, and the
 * few traces the normal view keeps (street grates over tunnels; the station entrances are ordinary buildings).
 *
 *  - **The view** (`set(true)`, key N, the "underground" chip) eases `sceneUniforms.uUnder` 0 -> 1 over FADE_S. The ground
 *    and buildings fade in their own shaders (render/materials.ts); the other opaque surface things (trees, cars,
 *    people, bridges ...) are ghosted by material opacity, collected from `surface` when a fade starts and put back
 *    when it ends, so nothing costs anything while the view is off.
 *  - **Tunnels and platforms** are drawn per chunk from the under bytes into one merged mesh (bores with collars,
 *    curves, junctions, a crossover whose north-south bores dip under the east-west ones, island platforms with lit
 *    edges, the shaft and roundel at each station door) plus a translucent vault over every platform. A chunk's
 *    geometry is built only while the view is on, a couple of chunks a frame, and again when its bytes change.
 *  - **Lines** colour the bores Tube-map style. `setLines` takes, per line, a colour and the sides it runs on at each
 *    tile (`lineSides(route, env)` from shared/src/metro.ts). Until it is called every tunnel is neutral.
 *  - **Grates** sit on road tiles over tunnels, about one in five by hash, each with its own size, turn, rust, lamp
 *    glow and steam: the glow flickers after dark and the steam rises on cold nights, never in step.
 *  - **The placement preview** (`setPreview`) is the planned platform, ghosted green or red.
 */

/** the depth of the track below the ground, and how long the view takes to fade */
export const METRO_Y = -0.9;
const FADE_S = 0.3;
/** how far the surface fades: buildings' and ground alpha are in the shaders (materials.ts); this is the rest */
const GHOST_OPACITY = 0.2;
const BORE_R = 0.16, BORE_OFF = 0.2;
const TUBE_K = 8;
/** the most time a frame spends building tunnel chunks (one chunk always gets built) */
const BUILD_MS = 4;

type RGB = [number, number, number];
const rgbOf = (hex: number): RGB => { const c = new Color(hex); return [c.r, c.g, c.b]; };
const NEUTRAL = rgbOf(0xa4afc2), UNUSED = rgbOf(0x626b78);
const FLOOR = rgbOf(0x2a2f38), RAIL = rgbOf(0x474d58), WALL = rgbOf(0x626b78), CREAM = rgbOf(0xeadfc3);
const ROUNDEL_RED = rgbOf(0xe32017), ROUNDEL_BLUE = rgbOf(0x0b4aa8);
const OK_TINT = rgbOf(0x4fe29a), BAD_TINT = rgbOf(0xff4a3a);
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** N E S W as (dx, dz), the sides of rail's masks (N 1, E 2, S 4, W 8) */
const DIR: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// ---- merged geometry -------------------------------------------------------------------------------
class Geo {
  pos: number[] = []; col: number[] = []; idx: number[] = [];
  vert(x: number, y: number, z: number, c: RGB, k = 1): number {
    this.pos.push(x, y, z); this.col.push(c[0] * k, c[1] * k, c[2] * k);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  get empty() { return this.idx.length === 0; }
  /** an axis-aligned box centred on x, z with its base at y; the bottom is left out, sides shaded darker than the top */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: RGB, k = 1) {
    const x0 = x - sx / 2, x1 = x + sx / 2, z0 = z - sz / 2, z1 = z + sz / 2, y1 = y + sy;
    const top = [this.vert(x0, y1, z0, c, k), this.vert(x1, y1, z0, c, k), this.vert(x1, y1, z1, c, k), this.vert(x0, y1, z1, c, k)];
    this.quad(top[0], top[3], top[2], top[1]);
    const side = (ax: number, az: number, bx: number, bz: number, s: number) => {
      const a = this.vert(ax, y, az, c, k * s), b = this.vert(bx, y, bz, c, k * s), cc = this.vert(bx, y1, bz, c, k * s), d = this.vert(ax, y1, az, c, k * s);
      this.quad(a, b, cc, d);
    };
    side(x0, z0, x1, z0, 0.72); side(x1, z0, x1, z1, 0.62); side(x1, z1, x0, z1, 0.72); side(x0, z1, x0, z0, 0.62);
  }
  /** a flat quad at height y with corners (x0,z0) (x1,z0) (x1,z1) (x0,z1), facing up */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, c: RGB, k = 1) {
    const a = this.vert(x0, y, z0, c, k), b = this.vert(x1, y, z0, c, k), cc = this.vert(x1, y, z1, c, k), d = this.vert(x0, y, z1, c, k);
    this.quad(a, d, cc, b);
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setIndex(new Uint32BufferAttribute(this.idx, 1));
    return g;
  }
}

/**
 * A tube of `radii.length - 1` bands along the path P(t), t in 0..1; radii[i] is the ring at t = i / bands, so a
 * larger one makes a collar. `arc` keeps only part of the circle (a vault). Shaded from the top down.
 */
function tube(g: Geo, P: (t: number) => [number, number, number], radii: number[], rgb: RGB, opts: { arc?: [number, number]; k?: number; caps?: boolean } = {}) {
  const bands = radii.length - 1, K = opts.k ?? TUBE_K;
  const [a0, a1] = opts.arc ?? [0, Math.PI * 2], full = !opts.arc, cols = full ? K : K + 1;
  const base = g.pos.length / 3;
  for (let i = 0; i <= bands; i++) {
    const t = i / bands, c = P(t), pa = P(Math.min(1, t + 0.02)), pb = P(Math.max(0, t - 0.02));
    let tx = pa[0] - pb[0], ty = pa[1] - pb[1], tz = pa[2] - pb[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // S = T x up, U = S x T (up is never along the track)
    let sx = ty * 0 - tz * 1, sy = tz * 0 - tx * 0, sz = tx * 1 - ty * 0;
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * tz - sz * ty, uy = sz * tx - sx * tz, uz = sx * ty - sy * tx;
    const r = radii[i], tone = 0.9 + (r / radii[0] - 1) * 3.2;
    for (let j = 0; j < cols; j++) {
      const a = a0 + ((a1 - a0) * j) / K, ca = Math.cos(a), sa = Math.sin(a);
      const nx = ca * sx + sa * ux, ny = ca * sy + sa * uy, nz = ca * sz + sa * uz;
      const shade = 0.4 + 0.6 * Math.pow(Math.max(0, ny), 0.8);
      g.vert(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r, rgb, shade * tone);
    }
  }
  for (let i = 0; i < bands; i++) {
    for (let j = 0; j < (full ? K : K); j++) {
      const j2 = full ? (j + 1) % K : j + 1;
      const v00 = base + i * cols + j, v01 = base + i * cols + j2, v10 = base + (i + 1) * cols + j, v11 = base + (i + 1) * cols + j2;
      g.quad(v00, v01, v11, v10);
    }
  }
  if (opts.caps && full) { // a closed end at t = 1 (a stub's blind end)
    const c = P(1), mid = g.vert(c[0], c[1], c[2], rgb, 0.3);
    const ring = base + bands * cols;
    for (let j = 0; j < K; j++) g.idx.push(mid, ring + j, ring + ((j + 1) % K));
  }
}

const COLLAR = 1.13;
const RADII4 = [BORE_R, BORE_R * COLLAR, BORE_R * COLLAR, BORE_R, BORE_R];
const RADII6 = [BORE_R, BORE_R * COLLAR, BORE_R * COLLAR, BORE_R, BORE_R, BORE_R, BORE_R];
const DIP = 0.4;

/** What the lines running through each tile look like: sides it covers and its colour. */
interface TileLine { mask: number; rgb: RGB }
/** one line for `setLines`: its colour and the sides it runs on at each tile, keyed by trackKey (shared lineSides) */
export interface UndergroundLine { colour: number; sides: ReadonlyMap<number, number> }

interface Entry {
  cx: number; cy: number; under: Uint8Array;
  /** bumped on every scan and every setLines; the geometry is current when built === rev */
  rev: number; built: number;
  grates: Group | null;
  /** platforms and shafts (opaque), the bore tubes (see-through, so trains inside show), the platform vaults (see-through) */
  solid: Mesh | null; bore: Mesh | null; shell: Mesh | null;
}

/** street grates and platforms are built from these shaders/materials, shared by every chunk */
const solidMaterial = () => new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
const boreMaterial = () => new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.5, depthWrite: false });
const shellMaterial = () => new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.17, depthWrite: false });
const previewMaterial = () => new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.62, depthWrite: false });

const GRATE_VERT = /* glsl */ `
attribute vec3 aPh;
varying vec2 vUv;
varying vec3 vPh;
void main() {
  vUv = uv; vPh = aPh;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const GRATE_FRAG = /* glsl */ `
uniform float uNight;
uniform float uTime;
uniform float uFade;
varying vec2 vUv;
varying vec3 vPh;
void main() {
  // lit slats: a train's lights flickering through the bars, each grate at its own pace and phase
  float slat = step(0.5, fract(vUv.x * 5.0 + 0.25)) * step(0.12, vUv.y) * step(vUv.y, 0.88);
  float fl = sin(uTime * vPh.y + vPh.x * 40.0) * sin(uTime * vPh.y * 0.37 + vPh.x * 17.0);
  float on = smoothstep(0.2, 0.55, uNight) * smoothstep(-0.2, 0.5, fl);
  vec3 warm = mix(vec3(1.0, 0.62, 0.25), vec3(0.75, 0.9, 1.0), vPh.z);
  gl_FragColor = vec4(warm * 0.9, slat * on * 0.55 * uFade);
}`;
const STEAM_VERT = /* glsl */ `
attribute vec3 aPh;
uniform float uTime;
uniform float uPx;
uniform float uNight;
varying float vA;
void main() {
  float t = fract(uTime * (0.07 + 0.08 * aPh.y) + aPh.x);
  vec3 p = position;
  p.y += t * (0.7 + 0.5 * aPh.z);
  p.x += sin(aPh.x * 40.0 + t * 4.0) * 0.07 * t;
  p.z += cos(aPh.x * 23.0 + t * 3.0) * 0.07 * t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.10 + 0.34 * t) * (0.8 + 0.5 * aPh.z) * uPx / max(0.1, -mv.z);
  vA = smoothstep(0.0, 0.12, t) * (1.0 - t) * smoothstep(0.25, 0.8, uNight) * (0.12 + 0.12 * aPh.y);
}`;
const STEAM_FRAG = /* glsl */ `
uniform float uFade;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vA * uFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.82, 0.86, 0.92, a);
}`;

const FADE_UNIFORM = { value: 1 };

export class UndergroundView {
  group = new Group();
  /** other opaque surface groups ghosted while the view is on (trees, cars, people, bridges ...) */
  surface: Object3D[] = [];
  /** the building mesh: ghosted by its own shader; it stops casting shadows while the view is on */
  buildings: Object3D | null = null;
  private entries = new Map<string, Entry>();
  private solidMat = solidMaterial();
  private shellMat = shellMaterial();
  private boreMat = boreMaterial();
  private grateMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private glowMat = new ShaderMaterial({ vertexShader: GRATE_VERT, fragmentShader: GRATE_FRAG, transparent: true, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    uniforms: { uNight: sceneUniforms.uNight, uTime: sceneUniforms.uTime, uFade: FADE_UNIFORM } });
  private steamMat = new ShaderMaterial({ vertexShader: STEAM_VERT, fragmentShader: STEAM_FRAG, transparent: true, depthWrite: false,
    uniforms: { uNight: sceneUniforms.uNight, uTime: sceneUniforms.uTime, uPx: { value: 400 }, uFade: FADE_UNIFORM } });
  private tileLines = new Map<number, TileLine[]>();
  private hasLines = false;
  private want = 0; private p = 0;
  /** eased fade, 0 (surface) to 1 (underground) */
  level = 0;
  private saved: { m: Material; transparent: boolean; depthWrite: boolean; opacity: number }[] = [];
  private ordered: { o: Object3D; ro: number }[] = [];
  private fading = false;
  private preview = new Mesh(new BufferGeometry(), previewMaterial());
  private previewKey = '';
  /** the surface materials the view fades by shader (ground, buildings): they are made transparent while it is up */
  shaderMaterials: Material[] = [];
  /** shadow casting of the building mesh before the view took it off */
  private castBefore = true;

  constructor(private world: ClientWorld) {
    this.group.add(this.preview);
    this.preview.visible = false;
    this.preview.frustumCulled = false;
    this.preview.renderOrder = -1;
  }

  get on() { return this.want === 1; }
  /** the view is up, or fading */
  get active() { return this.p > 0 || this.want === 1; }
  set(on: boolean) { this.want = on ? 1 : 0; }

  // ---- lines ---------------------------------------------------------------------------------------
  /**
   * Colour the tunnels by line (U6 calls this from the metroLines message): `sides` is `lineSides(route, env)`. Tiles
   * no line runs on go grey; with no lines at all every tunnel is neutral.
   */
  setLines(lines: UndergroundLine[]) {
    this.tileLines.clear();
    for (const l of lines) {
      const rgb = rgbOf(l.colour);
      for (const [k, mask] of l.sides) {
        const a = this.tileLines.get(k);
        if (a) a.push({ mask, rgb }); else this.tileLines.set(k, [{ mask, rgb }]);
      }
    }
    this.hasLines = lines.length > 0;
    for (const e of this.entries.values()) e.rev++;
  }

  /** the colour of a bore piece leaving a tile by `sides` */
  private colourOf(x: number, y: number, sides: number): RGB {
    if (!this.hasLines) return NEUTRAL;
    const a = this.tileLines.get(trackKey(x, y));
    if (a) for (const l of a) if (l.mask & sides) return l.rgb;
    return UNUSED;
  }

  // ---- scanning ------------------------------------------------------------------------------------
  /** a chunk's bytes changed or arrived: redo its grates now, its tunnels when the view next needs them */
  scanChunk(key: string, chunk: ClientChunk) {
    let any = false;
    for (let i = 0; i < chunk.under.length; i++) if (chunk.under[i]) { any = true; break; }
    let e = this.entries.get(key);
    if (!any) { if (e) this.dropChunk(key); return; }
    if (!e) { e = { cx: chunk.cx, cy: chunk.cy, under: chunk.under, rev: 0, built: -1, grates: null, solid: null, bore: null, shell: null }; this.entries.set(key, e); }
    e.under = chunk.under;
    e.rev++;
    this.clearGrates(e);
    e.grates = this.buildGrates(chunk);
    if (e.grates) this.group.add(e.grates);
  }
  dropChunk(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    this.clearGrates(e); this.clearSolid(e);
    this.entries.delete(key);
  }
  private clearGrates(e: Entry) {
    if (!e.grates) return;
    this.group.remove(e.grates);
    e.grates.traverse((o) => { (o as Mesh).geometry?.dispose(); });
    e.grates = null;
  }
  private clearSolid(e: Entry) {
    for (const m of [e.solid, e.bore, e.shell]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    e.solid = e.bore = e.shell = null;
  }

  // ---- grates --------------------------------------------------------------------------------------
  private buildGrates(chunk: ClientChunk): Group | null {
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cy * CHUNK_SIZE;
    const plate = new Geo(), glow: number[] = [], glowUv: number[] = [], glowPh: number[] = [], glowIdx: number[] = [];
    const steamPos: number[] = [], steamPh: number[] = [];
    let n = 0;
    for (let i = 0; i < chunk.under.length; i++) {
      if (!isTunnel(chunk.under[i])) continue;
      const t = chunk.tiles[i];
      if (!isRoad(t) || terrainOf(t) === Terrain.Water) continue;
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      const h = hash2(x * 11 + 3, z * 7 + 5);
      if (h > 0.2) continue;
      const h2 = hash2(x * 5 + 9, z * 13 + 1), h3 = hash2(z * 3 + 2, x * 17 + 7), h4 = hash2(x + 40, z * 3 + 11), h5 = hash2(z + 70, x * 2 + 31), h6 = hash2(x * 19 + 4, z + 90);
      const w = 0.2 + 0.14 * h2, d = w * (0.5 + 0.25 * h3);
      const cx = x + 0.5 + (h4 - 0.5) * 0.56, cz = z + 0.5 + (h5 - 0.5) * 0.56;
      const along = h6 < 0.5, yaw = (h3 - 0.5) * 0.12;
      // axis (u) and across (v) vectors of the grate, turned a little off the grid
      const ux = Math.cos(yaw) * (along ? 1 : 0) - Math.sin(yaw) * (along ? 0 : 1), uz = Math.sin(yaw) * (along ? 1 : 0) + Math.cos(yaw) * (along ? 0 : 1);
      const vx = -uz, vz = ux;
      const corner = (a: number, b: number): [number, number] => [cx + ux * a + vx * b, cz + uz * a + vz * b];
      const rust = h2 * h2 * 0.7, tone = 0.8 + 0.5 * h5;
      const metal = mix([0.24, 0.25, 0.28], [0.42, 0.23, 0.11], rust);
      const Y = 0.012;
      const quad = (a0: number, a1: number, b0: number, b1: number, y: number, c: RGB, k: number) => {
        const [p0, p1, p2, p3] = [corner(a0, b0), corner(a1, b0), corner(a1, b1), corner(a0, b1)];
        const v = [plate.vert(p0[0], y, p0[1], c, k), plate.vert(p1[0], y, p1[1], c, k), plate.vert(p2[0], y, p2[1], c, k), plate.vert(p3[0], y, p3[1], c, k)];
        plate.quad(v[0], v[3], v[2], v[1]);
      };
      quad(-w / 2, w / 2, -d / 2, d / 2, Y, metal, tone);                       // the frame
      const slats = 4, gap = (w - 0.04) / slats;
      for (let s = 0; s < slats; s++) {                                         // dark bars between lighter slats
        const a0 = -w / 2 + 0.02 + s * gap + gap * 0.5;
        quad(a0, a0 + gap * 0.42, -d / 2 + 0.02, d / 2 - 0.02, Y + 0.002, [0.03, 0.035, 0.04], 1);
      }
      // the glow quad (uv 0..1 over the grate)
      const g0 = glow.length / 3, ph = [h3, 5 + 14 * h6, h5 < 0.3 ? 1 : 0];
      for (const [a, b, u, v] of [[-w / 2, -d / 2, 0, 0], [w / 2, -d / 2, 1, 0], [w / 2, d / 2, 1, 1], [-w / 2, d / 2, 0, 1]] as const) {
        const c = corner(a, b); glow.push(c[0], 0.0185, c[1]); glowUv.push(u, v); glowPh.push(...ph);
      }
      glowIdx.push(g0, g0 + 3, g0 + 2, g0, g0 + 2, g0 + 1);
      if (h4 < 0.55) for (let s = 0; s < 2; s++) { steamPos.push(cx, 0.02, cz); steamPh.push(hash2(x * 3 + s * 17, z * 5 + 1), 0.3 + 0.7 * hash2(z * 7 + s, x + 2), hash2(x + s * 9, z * 2 + s)); }
      n++;
    }
    if (!n) return null;
    const g = new Group();
    const plateMesh = new Mesh(plate.build(), this.grateMat);
    g.add(plateMesh);
    const gg = new BufferGeometry();
    gg.setAttribute('position', new Float32BufferAttribute(glow, 3));
    gg.setAttribute('uv', new Float32BufferAttribute(glowUv, 2));
    gg.setAttribute('aPh', new Float32BufferAttribute(glowPh, 3));
    gg.setIndex(glowIdx);
    g.add(new Mesh(gg, this.glowMat));
    if (steamPos.length) {
      const sg = new BufferGeometry();
      sg.setAttribute('position', new Float32BufferAttribute(steamPos, 3));
      sg.setAttribute('aPh', new Float32BufferAttribute(steamPh, 3));
      const pts = new Points(sg, this.steamMat);
      pts.frustumCulled = false; // the points rise out of their positions in the shader
      g.add(pts);
    }
    return g;
  }

  // ---- tunnels -------------------------------------------------------------------------------------
  private underAt = (x: number, y: number) => this.world.underAt(x, y);

  private buildChunk(e: Entry) {
    const solid = new Geo(), bore = new Geo(), shell = new Geo();
    const x0 = e.cx * CHUNK_SIZE, z0 = e.cy * CHUNK_SIZE, under = e.under;
    for (let i = 0; i < under.length; i++) {
      const b = under[i];
      if (!isTunnel(b)) continue;
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      if (isPlatform(b)) this.platformTile(solid, shell, x, z, underMask(b) === 10, null);
      else this.tunnelTile(bore, x, z, underMask(b));
    }
    this.clearSolid(e);
    if (!solid.empty) { e.solid = new Mesh(solid.build(), this.solidMat); this.group.add(e.solid); }
    if (!bore.empty) { e.bore = new Mesh(bore.build(), this.boreMat); e.bore.renderOrder = -1; this.group.add(e.bore); }
    if (!shell.empty) { e.shell = new Mesh(shell.build(), this.shellMat); e.shell.renderOrder = -1; this.group.add(e.shell); }
    e.built = e.rev;
  }

  /** one tunnel tile: twin bores for the sides in `mask` */
  private tunnelTile(g: Geo, x: number, z: number, mask: number) {
    const cx = x + 0.5, cz = z + 0.5, Y = METRO_Y;
    const tone = 1.15 + 0.2 * hash2(x * 3 + 1, z * 5 + 2);
    const n = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
    const tint = (sides: number) => mul(this.colourOf(x, z, sides), tone);
    /** a straight bore pair from side `a` through to its opposite, at depth y(t) */
    const straight = (ns: boolean, rgb: RGB, dip: boolean) => {
      for (const off of [-BORE_OFF, BORE_OFF]) {
        tube(g, (t) => {
          const s = t - 0.5, y = dip ? Y - DIP * Math.pow(Math.sin(Math.PI * t), 2) : Y;
          return ns ? [cx + off, y, cz + s] : [cx + s, y, cz + off];
        }, dip ? RADII6 : RADII4, rgb);
      }
    };
    /** a bore pair from the edge of `side` to the tile's middle (a stub, or the third arm of a junction) */
    const arm = (side: number, rgb: RGB, cap: boolean) => {
      const [dx, dz] = DIR[side];
      for (const off of [-BORE_OFF, BORE_OFF]) {
        tube(g, (t) => [cx + dx * (0.5 - 0.5 * t) + -dz * off, Y, cz + dz * (0.5 - 0.5 * t) + dx * off], RADII4, rgb, { caps: cap });
      }
    };
    if (n === 0) return;
    if (n === 4) { straight(false, tint(10), false); straight(true, tint(5), true); return; }
    if (n === 1) { arm(mask === 1 ? 0 : mask === 2 ? 1 : mask === 4 ? 2 : 3, tint(mask), true); return; }
    if (n === 2) {
      if (mask === 5) straight(true, tint(mask), false);
      else if (mask === 10) straight(false, tint(mask), false);
      else this.curve(g, cx, cz, mask, tint(mask));
      return;
    }
    // 3 sides: the pair of opposite sides runs through, the other side is an arm into it
    const ns = (mask & 5) === 5, through = ns ? 5 : 10, rest = mask & ~through;
    straight(ns, tint(through), false);
    arm(rest === 1 ? 0 : rest === 2 ? 1 : rest === 4 ? 2 : 3, tint(rest), false);
  }

  /** a quarter turn between two adjacent sides: two concentric arcs about the shared corner */
  private curve(g: Geo, cx: number, cz: number, mask: number, rgb: RGB) {
    const sides = [0, 1, 2, 3].filter((s) => mask & (1 << s));
    const [a, b] = DIR[sides[0]], [c, d] = DIR[sides[1]];
    const px = cx + (a + c) * 0.5, pz = cz + (b + d) * 0.5;
    const th0 = Math.atan2(-d, -c), th1 = Math.atan2(-b, -a);
    let dth = th1 - th0; while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
    for (const r of [0.5 - BORE_OFF, 0.5 + BORE_OFF]) {
      tube(g, (t) => [px + r * Math.cos(th0 + dth * t), METRO_Y, pz + r * Math.sin(th0 + dth * t)], RADII6, rgb);
    }
  }

  /**
   * A platform tile: a cavity with two tracks, an island platform between them with lit edges, low walls, and over it a
   * translucent vault. The tile under a station's door gets the shaft up to the street and the roundel. `tint` ghosts it
   * green or red for the placement preview.
   */
  private platformTile(g: Geo, shell: Geo, x: number, z: number, alongX: boolean, tint: RGB | null, door = this.isDoor(x, z, alongX)) {
    const cx = x + 0.5, cz = z + 0.5, Y = METRO_Y;
    const h = hash2(x * 7 + 2, z * 3 + 9), lampWarm = hash2(Math.floor(alongX ? x / 6 : z / 6) + 31, alongX ? z : x);
    const lineC = tint ?? this.colourOf(x, z, alongX ? 10 : 5);
    const ghost = (c: RGB, t: number = 0.55): RGB => (tint ? mix(c, tint, t) : c);
    const lit = tint ? 1.2 : 1.55;
    const tonef = 0.94 + 0.12 * h;
    // local (along, across) -> world
    const P = (a: number, c: number): [number, number] => (alongX ? [cx + a, cz + c] : [cx + c, cz + a]);
    const slab = (a0: number, a1: number, c0: number, c1: number, y: number, hgt: number, col: RGB, k = 1) => {
      const p0 = P((a0 + a1) / 2, (c0 + c1) / 2);
      const sx = alongX ? a1 - a0 : c1 - c0, sz = alongX ? c1 - c0 : a1 - a0;
      g.box(p0[0], y, p0[1], sx, hgt, sz, col, k);
    };
    const floor = Y - 0.17;
    slab(-0.5, 0.5, -0.44, 0.44, floor - 0.04, 0.04, ghost(FLOOR), tonef);                       // the bed
    for (const s of [-1, 1]) slab(-0.5, 0.5, s * BORE_OFF - 0.045, s * BORE_OFF + 0.045, floor, 0.025, ghost(RAIL), 1); // tracks
    const warm = mix([1.0, 0.92, 0.78], [0.82, 0.92, 1.0], lampWarm);
    slab(-0.5, 0.5, -0.13, 0.13, floor, 0.1, ghost(mix(CREAM, warm, 0.5), 0.4), tonef);       // the island platform
    for (const s of [-1, 1]) slab(-0.5, 0.5, s * 0.13 - 0.018 + (s > 0 ? -0.018 : 0.018), s * 0.13 + 0.018 + (s > 0 ? -0.018 : 0.018), floor + 0.1, 0.004, ghost(lineC, 0.5), lit); // lit edges
    for (const s of [-1, 1]) slab(-0.5, 0.5, s * 0.455 - 0.012, s * 0.455 + 0.012, floor, 0.34, ghost(WALL), tonef * 0.85); // the cavity walls
    // lamps along the platform: a bright panel every tile, a little brighter or dimmer from tile to tile
    slab(-0.16, 0.16, -0.03, 0.03, floor + 0.1, 0.004, ghost(warm, 0.4), 1.7 + 0.5 * h);
    // the vault over it, translucent
    const arcR = 0.47;
    tube(shell, (t) => { const [px, pz] = P(t - 0.5, 0); return [px, floor, pz]; }, [arcR, arcR], tint ? mix(NEUTRAL, tint, 0.7) : mix(NEUTRAL, lineC, 0.55), { arc: [0, Math.PI], k: 10 });
    if (door) {
      // the shaft from the platform up to the street, and a roundel lit on the platform and on a post above the door
      const [px, pz] = P(0, 0);
      shell.box(px, floor + 0.1, pz, 0.18, -(floor + 0.1), 0.18, tint ? mix(NEUTRAL, tint, 0.8) : [0.8, 0.9, 1.0]);
      if (!tint) this.roundel(g, px, floor + 0.108, pz, 0.075);
      g.box(px, 0.0, pz, 0.02, 1.15, 0.02, [1.1, 1.1, 1.2], 1.4); // the beacon post
      this.roundel(g, px, 1.16, pz, 0.12, tint);
    }
  }

  /** a roundel lying flat: a red ring and a blue bar */
  private roundel(g: Geo, x: number, y: number, z: number, r: number, tint: RGB | null = null) {
    const N = 14, base = g.pos.length / 3, red = tint ?? ROUNDEL_RED, blue = tint ?? ROUNDEL_BLUE;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      g.vert(x + c * r, y, z + s * r, red, 1.5); g.vert(x + c * r * 0.68, y, z + s * r * 0.68, red, 1.5);
    }
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; g.quad(base + i * 2, base + j * 2, base + j * 2 + 1, base + i * 2 + 1); }
    g.flat(x - r * 1.18, z - r * 0.17, x + r * 1.18, z + r * 0.17, y + 0.001, blue, 1.5);
  }
  /** is this platform tile the one under a station's door (the middle of its run)? */
  private isDoor(x: number, z: number, alongX: boolean): boolean {
    const run = platformRun(x, z, { under: this.underAt });
    if (!run) return false;
    const mid = run.a0 + Math.floor((run.a1 - run.a0 + 1) / 2);
    return (alongX ? x : z) === mid;
  }

  // ---- placement preview ---------------------------------------------------------------------------
  /** Show (or with null, hide) the platform a station tool would build under its door, green when it is allowed. */
  setPreview(stop: StationStop | null, ok = true) {
    if (!stop) { this.preview.visible = false; this.previewKey = ''; return; }
    const key = `${stop.doorX},${stop.doorY},${stop.alongX},${stop.len},${ok}`;
    this.preview.visible = true;
    if (key === this.previewKey) return;
    this.previewKey = key;
    const solid = new Geo(), shell = new Geo(), tint = ok ? OK_TINT : BAD_TINT;
    for (let a = stop.a0; a <= stop.a1; a++) {
      const x = stop.alongX ? a : stop.row, z = stop.alongX ? stop.row : a;
      this.platformTile(solid, shell, x, z, stop.alongX, tint, a === stop.a0 + Math.floor(stop.len / 2));
    }
    // fold the translucent vault into the preview's own mesh
    const base = solid.pos.length / 3;
    for (let i = 0; i < shell.pos.length; i++) solid.pos.push(shell.pos[i]);
    for (let i = 0; i < shell.col.length; i++) solid.col.push(shell.col[i]);
    for (const i of shell.idx) solid.idx.push(i + base);
    this.preview.geometry.dispose();
    this.preview.geometry = solid.build();
  }

  // ---- frame ---------------------------------------------------------------------------------------
  /** advance the fade, apply it, and build the tunnel geometry the view needs */
  frame(dt: number, renderer: WebGLRenderer) {
    const step = Math.max(0, dt) / FADE_S; // the first frame's dt can be negative (main.ts takes `last` from performance.now())
    this.p = Math.min(1, Math.max(0, this.p + (this.want ? step : -step)));
    const u = this.p * this.p * (3 - 2 * this.p);
    this.level = u;
    sceneUniforms.uUnder.value = u;
    FADE_UNIFORM.value = 1 - u;
    const live = this.p > 0;
    if (live && !this.fading) this.beginFade();
    else if (!live && this.fading) this.endFade();
    if (this.fading) {
      const op = 1 - (1 - GHOST_OPACITY) * u;
      for (const s of this.saved) s.m.opacity = s.opacity * op;
    }
    // the grates are a normal-view detail: gone once the surface is dim, and asleep by day
    const night = sceneUniforms.uNight.value;
    const gratesOn = u < 0.98;
    this.grateMat.opacity = 1 - u;
    this.grateMat.color.setScalar(1 - 0.75 * night); // unlit material: dim the plates with the street after dark
    this.steamMat.uniforms.uPx.value = renderer.domElement.height * 0.5 * 0.9;
    for (const e of this.entries.values()) {
      if (e.grates) {
        e.grates.visible = gratesOn;
        // glow and steam only matter after dark; the plates always draw
        const c = e.grates.children;
        for (let i = 1; i < c.length; i++) c[i].visible = night > 0.2;
      }
      if (e.solid) e.solid.visible = live;
      if (e.bore) e.bore.visible = live;
      if (e.shell) e.shell.visible = live;
    }
    // build what is missing, within a few milliseconds a frame (a tile costs about 20 microseconds)
    if (live) {
      const t0 = performance.now();
      for (const e of this.entries.values()) {
        if (e.built === e.rev) continue;
        this.buildChunk(e);
        if (performance.now() - t0 > BUILD_MS) break;
      }
    }
  }

  /** the look of the view: sky and light shift, subtly (call after Lighting.update, which sets them afresh every frame) */
  look(lighting: Lighting, renderer: WebGLRenderer) {
    const u = this.level;
    renderer.toneMappingExposure = BASE_EXPOSURE * (1 - 0.1 * u);
    if (u <= 0) return;
    lighting.sky.lerp(UNDER_SKY, 0.78 * u);
    lighting.sun.intensity *= 1 - 0.5 * u;
    lighting.hemi.intensity *= 1 - 0.18 * u;
  }

  private beginFade() {
    this.fading = true;
    this.saved.length = 0; this.ordered.length = 0;
    const seen = new Set<Material>(this.shaderMaterials);
    for (const m of this.shaderMaterials) { m.transparent = true; m.needsUpdate = true; }
    for (const root of this.surface) {
      root.traverse((o) => {
        if (o === this.buildings) return; // faded by its own shader
        const mat = (o as Mesh).material as Material | Material[] | undefined;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) {
          if (seen.has(m) || m.transparent || !(m as { isMeshLambertMaterial?: boolean }).isMeshLambertMaterial && !(m as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial) continue;
          seen.add(m);
          this.saved.push({ m, transparent: m.transparent, depthWrite: m.depthWrite, opacity: m.opacity });
          m.transparent = true; m.depthWrite = false; m.needsUpdate = true;
        }
        this.ordered.push({ o, ro: o.renderOrder }); o.renderOrder = 2;
      });
    }
    if (this.buildings) { this.castBefore = this.buildings.castShadow; this.buildings.castShadow = false; this.ordered.push({ o: this.buildings, ro: this.buildings.renderOrder }); this.buildings.renderOrder = 1; }
    for (const m of this.shaderMaterials) m.depthWrite = false;
  }
  private endFade() {
    this.fading = false;
    for (const s of this.saved) { s.m.transparent = s.transparent; s.m.depthWrite = s.depthWrite; s.m.opacity = s.opacity; s.m.needsUpdate = true; }
    this.saved.length = 0;
    for (const r of this.ordered) r.o.renderOrder = r.ro;
    this.ordered.length = 0;
    for (const m of this.shaderMaterials) { m.transparent = false; m.depthWrite = true; m.needsUpdate = true; }
    if (this.buildings) this.buildings.castShadow = this.castBefore;
  }
}

const UNDER_SKY = new Color(0x0d1219);
/** main.ts sets the renderer's exposure once; the view dims it a little and gives it back */
const BASE_EXPOSURE = 1.05;
