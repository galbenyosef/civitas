import {
  CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter, InstancedMesh, InstancedBufferAttribute, PlaneGeometry,
  MeshLambertMaterial, Matrix4, DynamicDrawUsage,
} from 'three';
import { MANIFEST, SIGN_POOLS, signSource, signText, houseNumber, hash2, type CompiledOp, type KindManifest } from '@msimcity/shared';
import { RECIPES } from '@msimcity/shared/src/buildings/recipes';
import { shapeExtent } from '@msimcity/shared/src/buildings/facade';
import { sceneUniforms } from './materials';

/**
 * Name boards on building fronts, drawn only for chunks in the near detail tier (buildings.ts LOD): shops, offices,
 * works, venues and civic buildings carry their name (shared names.ts) on a fascia just above the ground floor, homes
 * a street number over the door. Every name the city can show is drawn once into one canvas atlas at start-up; a sign
 * is an instanced quad pointing into it. Each sign fades in and out with its own distance from the camera, from a
 * per-sign start (hashed), with hashed alpha so nothing sorts or pops; shop and venue boards light up at night.
 */

/** distance (tiles) where a sign starts to fade, before its per-sign jitter, and how long the fade is */
export const SIGN_FADE_START = 22, SIGN_FADE_JITTER = 6, SIGN_FADE_LEN = 7;
/** the farthest a sign can still show: chunks beyond this from every camera need no signs at all */
export const SIGN_MAX_DIST = SIGN_FADE_START + SIGN_FADE_JITTER + SIGN_FADE_LEN;

const ATLAS = 2048;
const BIG_W = 256, BIG_H = 40, NUM_W = 64, NUM_H = 40;
/** board aspect: the slot's, so text keeps its shape */
const BIG_ASPECT = BIG_W / BIG_H, NUM_ASPECT = NUM_W / NUM_H;
const MAX_HOUSE_NUMBER = 198;
const MAX_SIGNS = 16384;

interface Style { board: string; ink: string; edge: string; font: string; upper?: boolean; glow: number }
const SERIF = 'Georgia, "Times New Roman", serif', SANS = '"Helvetica Neue", Arial, sans-serif';
/** board styles per name pool family; a slot takes one by hash so a street's shops differ */
const STYLES: Record<string, Style[]> = {
  shop: [
    { board: '#1f4d3a', ink: '#f3e6c4', edge: '#c8b27a', font: `bold ${SERIF}`, glow: 0.9 },
    { board: '#6b1f2a', ink: '#e8c66a', edge: '#e8c66a', font: `bold ${SERIF}`, glow: 0.9 },
    { board: '#1d2f55', ink: '#ffffff', edge: '#9fb3d9', font: `bold ${SANS}`, glow: 1 },
    { board: '#151515', ink: '#e2be5b', edge: '#e2be5b', font: `italic bold ${SERIF}`, glow: 0.8 },
    { board: '#efe6d0', ink: '#24452f', edge: '#24452f', font: `bold ${SERIF}`, glow: 0.7 },
    { board: '#1f6d6b', ink: '#ffffff', edge: '#ffffff', font: `bold ${SANS}`, glow: 1 },
    { board: '#c4472b', ink: '#fff4e0', edge: '#fff4e0', font: `bold ${SANS}`, glow: 1 },
  ],
  store: [{ board: '#1b2440', ink: '#e6c873', edge: '#e6c873', font: `bold ${SERIF}`, upper: true, glow: 1 }],
  mall: [{ board: '#f4f4f0', ink: '#11706b', edge: '#11706b', font: `bold ${SANS}`, glow: 1 }],
  hotel: [{ board: '#121212', ink: '#e9c66d', edge: '#e9c66d', font: `bold ${SERIF}`, upper: true, glow: 1 }],
  // waste and recycling depots (shared/src/fleet.ts): council green
  waste: [{ board: '#1f5e34', ink: '#ffffff', edge: '#b8e0c2', font: `bold ${SANS}`, glow: 0.6 }],
  // cab offices (shared/src/fleet.ts): a lit minicab sign, black and taxi yellow or white on blue
  cabs: [
    { board: '#17171b', ink: '#ffcf33', edge: '#ffcf33', font: `bold ${SANS}`, upper: true, glow: 1 },
    { board: '#1d3f8f', ink: '#ffffff', edge: '#ffcf33', font: `bold ${SANS}`, upper: true, glow: 1 },
  ],
  office: [
    { board: '#c9cdd2', ink: '#23272e', edge: '#8e949c', font: `bold ${SANS}`, glow: 0.4 },
    { board: '#2a2f36', ink: '#f2f4f7', edge: '#59616b', font: `bold ${SANS}`, glow: 0.6 },
    { board: '#e9edf2', ink: '#1f4f8f', edge: '#1f4f8f', font: `${SANS}`, glow: 0.3 },
  ],
  industry: [
    { board: '#333333', ink: '#f2c230', edge: '#f2c230', font: `bold ${SANS}`, upper: true, glow: 0.3 },
    { board: '#1e4f8a', ink: '#ffffff', edge: '#ffffff', font: `bold ${SANS}`, upper: true, glow: 0.2 },
    { board: '#e8e2d2', ink: '#7a1d1d', edge: '#7a1d1d', font: `bold ${SANS}`, upper: true, glow: 0 },
  ],
  venue: [
    { board: '#a3161a', ink: '#ffe36b', edge: '#ffe36b', font: `bold ${SANS}`, upper: true, glow: 1.2 },
    { board: '#111111', ink: '#e9c66d', edge: '#e9c66d', font: `bold ${SERIF}`, glow: 1.1 },
  ],
  civic: [{ board: '#1d4f91', ink: '#ffffff', edge: '#ffffff', font: `bold ${SANS}`, glow: 0.7 }],
  transport: [{ board: '#22513a', ink: '#ffffff', edge: '#ffffff', font: `bold ${SANS}`, glow: 0.8 }],
  number: [
    { board: '#f4f4f0', ink: '#1d3f7a', edge: '#1d3f7a', font: `bold ${SANS}`, glow: 0 },
    { board: '#151515', ink: '#d9b45a', edge: '#d9b45a', font: `bold ${SERIF}`, glow: 0 },
    { board: '#b08a3e', ink: '#1a1a1a', edge: '#6e5420', font: `bold ${SERIF}`, glow: 0 },
    { board: '#3c4249', ink: '#ffffff', edge: '#ffffff', font: `bold ${SANS}`, glow: 0 },
  ],
};
const styleFamily = (pool: string) => (pool.startsWith('venue:') ? 'venue' : pool);

/** One board in the atlas: its UV rectangle (u0, v0, du, dv) and how much it glows at night. */
interface Slot { rect: [number, number, number, number]; glow: number }

/** The name atlas: every pool name, every fixed kind name and every house number, drawn once. */
class SignAtlas {
  readonly texture: CanvasTexture;
  private slots = new Map<string, Slot>();

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS;
    const g = canvas.getContext('2d')!;
    let bx = 0, by = 0;
    const big = (id: string, text: string, family: string, seed: number) => {
      if (this.slots.has(id)) return;
      if (bx + BIG_W > ATLAS) { bx = 0; by += BIG_H; }
      if (by + BIG_H > ATLAS) return;
      const s = this.pick(family, seed);
      this.draw(g, bx, by, BIG_W, BIG_H, s.upper ? text.toUpperCase() : text, s);
      this.slots.set(id, { rect: this.uv(bx, by, BIG_W, BIG_H), glow: s.glow });
      bx += BIG_W;
    };
    for (const [pool, names] of Object.entries(SIGN_POOLS)) names.forEach((n, i) => big(`${pool}#${i}`, n, styleFamily(pool), i));
    for (const k of MANIFEST) {
      const src = signSource(k, 0, 0);
      if ('text' in src) big(`=${src.text}`, src.text, k.family === 'transport' ? 'transport' : k.family === 'leisure' ? 'venue' : 'civic', k.kindId);
    }
    // house numbers in narrow slots below the names
    let nx = 0, ny = by + BIG_H;
    for (let n = 1; n <= MAX_HOUSE_NUMBER; n++) {
      if (nx + NUM_W > ATLAS) { nx = 0; ny += NUM_H; }
      if (ny + NUM_H > ATLAS) break;
      const s = this.pick('number', n);
      this.draw(g, nx, ny, NUM_W, NUM_H, String(n), s);
      this.slots.set(`#${n}`, { rect: this.uv(nx, ny, NUM_W, NUM_H), glow: 0 });
      nx += NUM_W;
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    this.texture = t;
  }

  slot(id: string) { return this.slots.get(id); }

  private pick(family: string, seed: number): Style {
    const list = STYLES[family] ?? STYLES.civic;
    return list[Math.floor(hash2(seed * 7 + 1, family.length * 13 + 5) * list.length)];
  }
  private uv(x: number, y: number, w: number, h: number): [number, number, number, number] {
    // half a texel in so mip levels do not bleed in from the next slot (flipY: canvas row 0 is v = 1)
    const i = 1.5;
    return [(x + i) / ATLAS, 1 - (y + h - i) / ATLAS, (w - 2 * i) / ATLAS, (h - 2 * i) / ATLAS];
  }
  private draw(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, s: Style) {
    g.save();
    g.translate(x, y);
    g.fillStyle = s.board; g.fillRect(0, 0, w, h);
    g.strokeStyle = s.edge; g.lineWidth = 2; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = s.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    const [, pre, family] = /^((?:italic |bold )*)(.*)$/.exec(s.font)!;
    const fit = w - 18;
    // shrink long names to fit the board
    let px = Math.round(h * 0.62);
    g.font = `${pre}${px}px ${family}`;
    while (px > 9 && g.measureText(text).width > fit) { px--; g.font = `${pre}${px}px ${family}`; }
    g.fillText(text, w / 2, h / 2 + 1, fit);
    g.restore();
  }
}

/** Where a design's board goes, in model space (front = +z): centre and size. */
interface Spot { x: number; y: number; z: number; w: number; h: number }
const spots = new Map<string, Spot | null>();
const recipeOps = new Map<string, readonly CompiledOp[]>(RECIPES.map((r) => [r.key, r.ops]));
const kindById = new Map<number, KindManifest>(MANIFEST.map((k) => [k.kindId, k]));

/** Axis-aligned bounds of a recipe part: x0, x1, y0, y1, z0, z1. */
function bounds(op: CompiledOp): number[] {
  switch (op[0]) {
    case 'box': case 'roof': return [op[4] - op[1] / 2, op[4] + op[1] / 2, op[5], op[5] + op[2], op[6] - op[3] / 2, op[6] + op[3] / 2];
    case 'cyl': { const r = Math.max(op[1], op[2]); return [op[4] - r, op[4] + r, op[5], op[5] + op[3], op[6] - r, op[6] + r]; }
    case 'cone': return [op[3] - op[1], op[3] + op[1], op[4], op[4] + op[2], op[5] - op[1], op[5] + op[1]];
    case 'wheel': return [op[3] - op[2] / 2, op[3] + op[2] / 2, op[4] - op[1], op[4] + op[1], op[5] - op[1], op[5] + op[1]];
    case 'taper': case 'lathe': return shapeExtent(op);
  }
}

/**
 * The board for a design: on the front wall of its main block (the biggest windowed box standing on the ground),
 * a fascia just above the ground floor for a named building, a small plaque over the door for a home. Anything
 * built against that wall where the board would go (a loading door, a porch, an entrance block, an awning) lifts
 * the board above it; a fascia with no room left on the wall goes under the eaves, in front of whatever sticks out.
 * Designs with no windowed block (parks, car parks, bus stops) get none, and so does a home whose door is boxed in.
 */
function spotFor(key: string, home: boolean): Spot | null {
  const id = `${key}|${home ? 'h' : 'n'}`;
  const hit = spots.get(id);
  if (hit !== undefined) return hit;
  const ops = recipeOps.get(key) ?? [];
  type BoxOp = Extract<CompiledOp, { 0: 'box' }>;
  let main: BoxOp | null = null, best = 0;
  for (const op of ops) {
    if (op[0] !== 'box' || !op[8] || op[5] > 0.05) continue;
    const v = op[1] * op[2] * op[3];
    if (v > best) { best = v; main = op; }
  }
  let spot: Spot | null = null;
  if (main) {
    const [, w, h, d, x, y, z] = main;
    const f = main[9];
    const sh = f ? (h - f.t) / f.s : Math.min(0.32, h * 0.45);
    const front = z + d / 2;
    // parts against the front wall (reaching it or standing out from it), as bounds
    const against = ops.filter((op) => op !== main).map(bounds).filter((b) => b[5] >= front - 0.005 && b[4] <= front + 0.03);
    /** lowest board bottom from `y0` up that no part against the wall covers, or null past `top` */
    const clear = (cx: number, bw: number, bh: number, y0: number, top: number) => {
      let yb = y0;
      for (let pass = 0; pass < 8; pass++) {
        const hits = against.filter((b) => b[1] > cx - bw / 2 && b[0] < cx + bw / 2 && b[3] > yb && b[2] < yb + bh);
        if (!hits.length) return yb + bh <= top ? yb : null;
        yb = Math.max(...hits.map((b) => b[3])) + 0.008;
      }
      return null;
    };
    if (home) {
      // over the door: the ground-floor front cell the facade left plain, else the middle of the front
      let cx = x;
      if (f && f.b > 0) {
        const m = Math.min(f.m, w / 2), bw = (w - 2 * m) / f.b;
        const c = f.c ?? [];
        for (let i = 0; i < c.length; i += 4) if (c[i] === 0 && c[i + 1] === 0 && c[i + 3] === 1) cx = x - w / 2 + m + (c[i + 2] + 0.5) * bw;
      }
      const pw = Math.min(0.075, w * 0.3), ph = pw / NUM_ASPECT;
      const doorTop = Math.min(0.8 * sh, 0.19);
      const yb = clear(cx, pw, ph, y + doorTop + 0.012, y + Math.min(h, sh * 1.2));
      if (yb !== null) spot = { x: cx, y: yb + ph / 2, z: front + 0.004, w: pw, h: ph };
    } else {
      const bw = Math.min(0.86 * w, 1.6, BIG_ASPECT * 0.5 * sh + 0.25);
      const bh = bw / BIG_ASPECT;
      const top = y + h - 0.01;
      const yb = clear(x, bw, bh, y + sh + 0.004, top);
      if (yb !== null) spot = { x, y: yb + bh / 2, z: front + 0.006, w: bw, h: bh };
      else {
        // under the eaves, standing proud of anything that reaches that high
        const yt = Math.max(y + sh + 0.004, top - bh);
        const out = against.filter((b) => b[1] > x - bw / 2 && b[0] < x + bw / 2 && b[3] > yt && b[2] < yt + bh).reduce((m, b) => Math.max(m, b[5]), front);
        spot = { x, y: yt + bh / 2, z: out + 0.006, w: bw, h: bh };
      }
    }
  }
  spots.set(id, spot);
  return spot;
}

/** What chunkView knows about a placed building, for its sign: the kind, the anchor tile and the way it faces. */
export interface SignInfo { kind: number; x: number; y: number; r: number }

/** What a building's board says (or would, on a design with no room for one): a home's street number, else its name. */
export function signLabel(s: SignInfo): string | null {
  const k = kindById.get(s.kind);
  if (!k) return null;
  return k.family === 'residential' ? `No. ${houseNumber(s.x, s.y, s.r)}` : signText(signSource(k, s.x, s.y));
}

const tmpM = new Matrix4();
const local = new Matrix4();

/** The instanced boards for every near-tier chunk. */
export class Signs {
  readonly mesh: InstancedMesh;
  private atlas = new SignAtlas();
  private rect: InstancedBufferAttribute;
  private info: InstancedBufferAttribute;
  /** per chunk: matrices (16 floats), rects (4) and info (4) per sign */
  private perChunk = new Map<string, { m: Float32Array; r: Float32Array; i: Float32Array; n: number }>();
  private dirty = false;

  constructor() {
    const mat = new MeshLambertMaterial({ map: this.atlas.texture, alphaHash: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = sceneUniforms.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 aRect;
attribute vec4 aSign;
varying float vFade;
varying float vGlow;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
vMapUv = aRect.xy + uv * aRect.zw;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 sp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vFade = 1.0 - smoothstep(aSign.x, aSign.x + ${SIGN_FADE_LEN.toFixed(1)}, distance(sp.xyz, cameraPosition));
  vGlow = aSign.y;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uNight;
varying float vFade;
varying float vGlow;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.a *= vFade;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vGlow * uNight * 0.85;`);
    };
    const geo = new PlaneGeometry(1, 1);
    this.rect = new InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 4), 4).setUsage(DynamicDrawUsage);
    this.info = new InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 4), 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('aRect', this.rect);
    geo.setAttribute('aSign', this.info);
    this.mesh = new InstancedMesh(geo, mat, MAX_SIGNS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  /** Boards for one chunk's buildings: `items` pairs the design key and world matrix with the building's sign info. */
  setChunk(key: string, items: { key: string; matrix: Matrix4; sign: SignInfo }[]) {
    const m: number[] = [], r: number[] = [], inf: number[] = [];
    for (const it of items) {
      const k = kindById.get(it.sign.kind);
      if (!k) continue;
      const home = k.family === 'residential';
      const spot = spotFor(it.key, home);
      if (!spot) continue;
      let slot;
      if (home) slot = this.atlas.slot(`#${houseNumber(it.sign.x, it.sign.y, it.sign.r)}`);
      else {
        const src = signSource(k, it.sign.x, it.sign.y);
        slot = this.atlas.slot('text' in src ? `=${src.text}` : `${src.pool}#${src.index}`);
      }
      if (!slot) continue;
      local.makeScale(spot.w, spot.h, 1).setPosition(spot.x, spot.y, spot.z);
      tmpM.multiplyMatrices(it.matrix, local);
      m.push(...tmpM.elements);
      r.push(...slot.rect);
      const h = hash2(it.sign.x * 3 + 11, it.sign.y * 5 + 2);
      // the odd board stays dark at night (a closed shop, a blown tube)
      const glow = hash2(it.sign.y + 17, it.sign.x + 29) < 0.18 ? 0 : slot.glow;
      inf.push(SIGN_FADE_START + (h - 0.5) * 2 * SIGN_FADE_JITTER, glow, 0, 0);
    }
    this.perChunk.set(key, { m: new Float32Array(m), r: new Float32Array(r), i: new Float32Array(inf), n: r.length / 4 });
    this.dirty = true;
  }

  clear(key: string) {
    if (this.perChunk.delete(key)) this.dirty = true;
  }
  has(key: string) { return this.perChunk.has(key); }

  /** Pack every near chunk's boards into the instance buffers, once per frame at most. */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const im = this.mesh.instanceMatrix.array as Float32Array, ra = this.rect.array as Float32Array, ia = this.info.array as Float32Array;
    let n = 0;
    for (const c of this.perChunk.values()) {
      const take = Math.min(c.n, MAX_SIGNS - n);
      if (take <= 0) break;
      im.set(c.m.subarray(0, take * 16), n * 16);
      ra.set(c.r.subarray(0, take * 4), n * 4);
      ia.set(c.i.subarray(0, take * 4), n * 4);
      n += take;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rect.needsUpdate = true;
    this.info.needsUpdate = true;
  }

  get count() { return this.mesh.count; }
}
