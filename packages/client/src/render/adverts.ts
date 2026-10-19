import {
  CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter, InstancedMesh, InstancedBufferAttribute, PlaneGeometry,
  MeshLambertMaterial, Matrix4, Vector3, Quaternion, DynamicDrawUsage,
} from 'three';
import {
  AD_SLOTS, AD_STRIDE, AD_SIZE, AD_SIZES, AD_PALETTES, AD_ICONS, unpackLook, adSeed, adWear, adAge, hash2, TICKS_PER_HOUR,
  type CampaignDTO, type AdSize,
} from '@msimcity/shared';
import { sceneUniforms } from './materials';
import { SIGN_FADE_START, SIGN_FADE_JITTER, SIGN_FADE_LEN } from './signs';
import { FAR_AT } from './buildings';

/**
 * Posters on the ad slots of buildings (docs/adverts.md section 5), modelled on the name boards (signs.ts).
 *
 * - **One InstancedMesh** of quads for every rented slot in the loaded chunks: one draw call. Empty slots are a frame in
 *   the building's own model (shared buildings/adslot.ts), so nothing is drawn for them.
 * - **Near tier**: within the signs' fade (SIGN_FADE_START plus a hashed per-poster jitter) a poster shows its artwork;
 *   past it the same quad shows the campaign's main colour as a flat tint, and past FAR_AT nothing.
 * - **The ad atlas**: one 2048² canvas. Each campaign gets a 256² block drawn once (a landscape cell for billboards and
 *   hoardings, a portrait one for posters and panels, a tall one for banners); the bottom row holds 16 graffiti tags, four
 *   crews' styles, drawn at start-up. No canvas work after a campaign's first sight.
 * - **Wear in the shader**: each instance carries its wear (0-1), a seed and flags. The fragment shader fades and
 *   yellows the paper, tears it where a seeded noise falls under the wear, and lays one tag, then a second, over it once
 *   the wear passes seeded points. Wear comes from the shared formula (adWear) and is refreshed once a game hour
 *   (`refreshWear`): a few hundred floats into one attribute. Nothing runs per frame but the shader.
 * - **Every poster differs** (the organic-effects rule): wear rate (the seed's 0.7-1.3x), the tags and where they sit,
 *   the tear pattern, the crew (the area's), and a slight tilt and offset on the wall.
 * - Billboards and shelter panels are lit at night; paper on walls is not.
 */

const ATLAS = 2048, BLOCK = 256, COLS = ATLAS / BLOCK, ROWS = 7;
const MAX_CELLS = COLS * ROWS;
const TAG_W = 128, TAG_H = 64, TAG_Y = ROWS * BLOCK;
const MAX_ADS = 4096;
/** flags (aAd.w): bit 0 lit at night, bit 1 a free slot highlighted while picking, bits 2-3 the area's crew */
const LIT = 1, PICK = 2;

/** One campaign's cells: [u0, v0, du, dv] for the landscape, portrait and banner shapes, and its main colour. */
interface Cells { L: number[]; P: number[]; B: number[]; tint: [number, number, number] }

const SANS = '"Helvetica Neue", Arial, sans-serif', SERIF = 'Georgia, "Times New Roman", serif';
const TAG_FONTS = ['Impact, "Arial Black", sans-serif', '"Marker Felt", "Comic Sans MS", cursive', '"Chalkduster", "Trebuchet MS", sans-serif', '"Arial Black", Impact, sans-serif'];
const TAG_WORDS = ['ZEK', 'KRU', 'OI!', 'NOVA', 'DUB', 'RAZE', 'MOX', 'FLO', 'KAY', 'YUP', 'SKRT', 'ACE', 'PLUM', 'JINX', 'REM', 'BOZ'];
/** crews' colours (docs/adverts.md section 6): fill, outline */
const CREWS: [string, string][][] = [
  [['#111111', '#e03a3a'], ['#e03a3a', '#111111'], ['#111111', '#ffffff'], ['#d42e2e', '#ffd9d9']],
  [['#ff4fa8', '#ffffff'], ['#ffffff', '#ff4fa8'], ['#b33ad9', '#ffffff'], ['#ff78c4', '#2a0f22']],
  [['#7ad321', '#103d10'], ['#c4f53b', '#1a3a12'], ['#2fa84a', '#e9ffd6'], ['#9bff4f', '#000000']],
  [['#4fb6ff', '#0b2440'], ['#cfd8e6', '#2b3d63'], ['#2a6fdb', '#ffffff'], ['#9be0ff', '#14273f']],
];

const rng = (seed: number) => { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); };

/** The ad atlas: campaign blocks drawn on first sight, graffiti tags drawn once. */
class AdAtlas {
  readonly texture: CanvasTexture;
  private g: CanvasRenderingContext2D;
  private cells = new Map<number, Cells & { block: number; sig: string }>();
  private free: number[] = [];

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS;
    this.g = canvas.getContext('2d')!;
    for (let i = MAX_CELLS - 1; i >= 0; i--) this.free.push(i);
    this.drawTags();
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 8;
    this.texture = t;
  }

  /** The campaign's cells, drawing its block the first time (or again if its look or words changed). */
  cellsOf(c: CampaignDTO, ownerName: string, ownerColour: number): Cells | null {
    const sig = `${c.look}|${c.text}|${ownerName}`;
    const had = this.cells.get(c.id);
    if (had && had.sig === sig) return had;
    const block = had?.block ?? this.free.pop();
    if (block === undefined) return null;
    const bx = (block % COLS) * BLOCK, by = Math.floor(block / COLS) * BLOCK;
    this.drawCampaign(bx, by, c, ownerName, ownerColour);
    const pal = AD_PALETTES[unpackLook(c.look).palette];
    const rgb = parseInt(pal.bg.slice(1), 16);
    const cells = {
      L: this.uv(bx, by, 256, 128), P: this.uv(bx, by + 128, 96, 128), B: this.uv(bx + 96, by + 128, 48, 128),
      tint: [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255] as [number, number, number], block, sig,
    };
    this.cells.set(c.id, cells);
    this.texture.needsUpdate = true;
    return cells;
  }
  /** Give back the blocks of campaigns that have ended. */
  retain(ids: Set<number>) {
    for (const [id, c] of this.cells) if (!ids.has(id)) { this.cells.delete(id); this.free.push(c.block); }
  }

  private uv(x: number, y: number, w: number, h: number): number[] {
    const i = 1.5; // half a texel and more in, so mips do not bleed from the next cell
    return [(x + i) / ATLAS, 1 - (y + h - i) / ATLAS, (w - 2 * i) / ATLAS, (h - 2 * i) / ATLAS];
  }

  private drawCampaign(bx: number, by: number, c: CampaignDTO, owner: string, ownerColour: number) {
    const g = this.g, { layout, icon, palette } = unpackLook(c.look), pal = AD_PALETTES[palette];
    const own = '#' + (ownerColour >>> 0).toString(16).padStart(6, '0').slice(-6);
    g.clearRect(bx, by, BLOCK, BLOCK);
    const panel = (x: number, y: number, w: number, h: number, shape: 'L' | 'P' | 'B') => {
      g.save();
      g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.translate(x, y);
      g.fillStyle = pal.bg; g.fillRect(0, 0, w, h);
      // the layouts: a bold slab of colour with a big icon, a diagonal banner across, or a framed classic
      if (layout === 1) {
        g.fillStyle = pal.accent; g.beginPath(); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.38); g.lineTo(w, h * 0.58); g.lineTo(0, h * 0.82); g.closePath(); g.fill();
      } else if (layout === 2) {
        g.strokeStyle = pal.accent; g.lineWidth = Math.max(2, w * 0.03); g.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      } else {
        g.fillStyle = pal.accent; g.fillRect(0, h - Math.max(8, h * 0.13), w, Math.max(8, h * 0.13));
      }
      const serif = layout === 2;
      const textBox = (tx: number, ty: number, tw: number, th: number, size: number) => this.text(c.text, tx, ty, tw, th, size, pal.ink, serif);
      if (shape === 'L') {
        this.icon(AD_ICONS[icon], h * 0.42, h * 0.46, h * 0.32, pal.accent, pal.ink);
        textBox(h * 0.85, h * 0.1, w - h * 0.95, h * 0.62, 30);
        this.owner(owner, own, w - 6, h - 4, Math.max(9, h * 0.09), layout === 0 ? pal.bg : pal.ink, 'right');
      } else if (shape === 'P') {
        this.icon(AD_ICONS[icon], w / 2, h * 0.22, w * 0.2, pal.accent, pal.ink);
        textBox(w * 0.08, h * 0.38, w * 0.84, h * 0.44, 18);
        this.owner(owner, own, w / 2, h - 3, 9, layout === 0 ? pal.bg : pal.ink, 'center');
      } else {
        this.icon(AD_ICONS[icon], w / 2, h * 0.14, w * 0.3, pal.accent, pal.ink);
        // a banner: the words run down it, one per line
        textBox(w * 0.06, h * 0.28, w * 0.88, h * 0.6, 12);
      }
      g.restore();
    };
    panel(bx, by, 256, 128, 'L');
    panel(bx, by + 128, 96, 128, 'P');
    panel(bx + 96, by + 128, 48, 128, 'B');
  }

  /** The claim, wrapped onto as few lines as fit, as big as fits. */
  private text(s: string, x: number, y: number, w: number, h: number, max: number, ink: string, serif: boolean) {
    const g = this.g, family = serif ? SERIF : SANS;
    const words = s.split(' ');
    for (let px = max; px >= 7; px--) {
      g.font = `bold ${px}px ${family}`;
      const lines: string[] = [];
      let line = '';
      for (const wd of words) {
        const t = line ? `${line} ${wd}` : wd;
        if (g.measureText(t).width <= w || !line) line = t; else { lines.push(line); line = wd; }
      }
      if (line) lines.push(line);
      const lh = px * 1.08;
      if (lines.length * lh > h || lines.some((l) => g.measureText(l).width > w)) continue;
      g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
      const y0 = y + h / 2 - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, i) => g.fillText(l, x + w / 2, y0 + i * lh));
      return;
    }
  }
  /** The renter's name, small, in their colour on a chip. */
  private owner(name: string, colour: string, x: number, y: number, px: number, ink: string, align: CanvasTextAlign) {
    const g = this.g;
    g.font = `bold ${Math.round(px)}px ${SANS}`; g.textAlign = align; g.textBaseline = 'bottom';
    const w = g.measureText(name).width;
    const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    g.fillStyle = colour; g.fillRect(x0 - 5, y - px - 1, 3, px);
    g.fillStyle = ink; g.fillText(name, x, y);
  }
  /** A simple icon from the fixed set, centred at x, y, radius r. */
  private icon(kind: string, x: number, y: number, r: number, fill: string, ink: string) {
    const g = this.g;
    g.save(); g.translate(x, y); g.fillStyle = fill; g.strokeStyle = ink; g.lineWidth = Math.max(1.5, r * 0.12); g.lineJoin = 'round';
    g.beginPath();
    switch (kind) {
      case 'house': g.moveTo(-r, 0); g.lineTo(0, -r); g.lineTo(r, 0); g.lineTo(r * 0.75, 0); g.lineTo(r * 0.75, r); g.lineTo(-r * 0.75, r); g.lineTo(-r * 0.75, 0); g.closePath(); g.fill(); g.stroke(); g.fillStyle = ink; g.fillRect(-r * 0.18, r * 0.35, r * 0.36, r * 0.65); break;
      case 'coin': g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = ink; g.font = `bold ${Math.round(r * 1.3)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, r * 0.06); break;
      case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); g.stroke(); break;
      case 'tree': g.arc(0, -r * 0.25, r * 0.7, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = ink; g.fillRect(-r * 0.12, r * 0.3, r * 0.24, r * 0.7); break;
      case 'clock': g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r * 0.65); g.moveTo(0, 0); g.lineTo(r * 0.5, r * 0.2); g.stroke(); break;
      case 'compass': g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.fillStyle = ink; g.moveTo(0, -r * 0.8); g.lineTo(r * 0.25, 0); g.lineTo(0, r * 0.8); g.lineTo(-r * 0.25, 0); g.closePath(); g.fill(); break;
      case 'heart': g.moveTo(0, r * 0.9); g.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.6, -r * 1.1, 0, -r * 0.35); g.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.4, -r * 0.1, 0, r * 0.9); g.fill(); g.stroke(); break;
      default: g.moveTo(-r, -r * 0.2); g.lineTo(0, -r * 0.7); g.lineTo(r, -r * 0.2); g.lineTo(0, r * 0.3); g.closePath(); g.fill(); g.stroke(); g.fillStyle = ink; g.fillRect(-r * 0.5, r * 0.05, r, r * 0.45); // a mortarboard
    }
    g.restore();
  }

  /** 16 tags in a strip along the bottom: four per crew, each a word in a crew's colours with an outline, a swoosh and a drip. */
  private drawTags() {
    const g = this.g;
    for (let i = 0; i < 16; i++) {
      const crew = Math.floor(i / 4), [fill, line] = CREWS[crew][i % 4], r = rng(i * 7919 + 13);
      const x0 = i * TAG_W, y0 = TAG_Y;
      g.save();
      g.beginPath(); g.rect(x0, y0, TAG_W, TAG_H); g.clip();
      g.translate(x0 + TAG_W / 2, y0 + TAG_H / 2);
      g.rotate((r() - 0.5) * 0.35);
      const word = TAG_WORDS[(i * 5 + crew) % TAG_WORDS.length];
      const px = 30 + Math.floor(r() * 10);
      g.font = `${crew === 1 ? 'italic ' : ''}${px}px ${TAG_FONTS[crew]}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = line; g.strokeText(word, 0, -2);
      g.fillStyle = fill; g.fillText(word, 0, -2);
      // a swoosh under it and a drip or two
      g.lineCap = 'round'; g.strokeStyle = fill; g.lineWidth = 3 + r() * 2;
      g.beginPath(); g.moveTo(-44 + r() * 10, 18); g.quadraticCurveTo(0, 26 + r() * 6, 46 - r() * 10, 12 + r() * 6); g.stroke();
      for (let k = 0; k < 1 + Math.floor(r() * 2); k++) { const dx = (r() - 0.5) * 50; g.lineWidth = 2; g.beginPath(); g.moveTo(dx, 6); g.lineTo(dx, 14 + r() * 14); g.stroke(); }
      g.restore();
    }
  }
}

/** A building with slots, as chunkView placed it: its design key, world matrix, door tile and the parcel at the door. */
export interface AdHostItem { key: string; matrix: Matrix4; door: [number, number]; parcel: number }
/** A rental as the client keeps it (shared AD_RENTAL). */
export interface RentalView { campaign: number; age: number; rate: number; at: number; placed: number; size: number }

const tmpM = new Matrix4(), local = new Matrix4(), tilt = new Matrix4();
const tmpQ = new Quaternion(), tmpV = new Vector3(), tmpS = new Vector3(), tmpP = new Vector3();
const FACE_YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** The instanced posters for every loaded chunk. */
export class AdvertsView {
  readonly mesh: InstancedMesh;
  private atlas = new AdAtlas();
  private rect: InstancedBufferAttribute;
  private ad: InstancedBufferAttribute;
  private tint: InstancedBufferAttribute;
  private hosts = new Map<string, AdHostItem[]>();
  /** per chunk: matrices, rects, ad (wear, seed, fade start, flags), tints, and what each instance is for (for the hourly wear) */
  private perChunk = new Map<string, { m: Float32Array; r: Float32Array; a: Float32Array; t: Float32Array; refs: { k: string; seed: number }[]; n: number }>();
  private dirty = false;
  private rentals = new Map<string, RentalView>();
  private campaigns = new Map<number, CampaignDTO>();
  private hour = -1;
  /** free slots glow while the Campaigns panel is picking (`setPicking`) */
  private picking = false;
  /** a renter's name and colour, from the players list (main.ts) */
  owner: (id: string) => { name: string; color: number } = (id) => ({ name: id, color: 0x888888 });
  /** whether a free slot can be seen from the street (shared adSlotOpen, against the client's tiles), for the picking glow */
  open: (door: [number, number], i: number) => boolean = () => true;
  /** the server tick now, for the wear */
  tick: () => number = () => 0;

  constructor() {
    const mat = new MeshLambertMaterial({ map: this.atlas.texture, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, transparent: false, alphaTest: 0.5 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = sceneUniforms.uNight;
      sh.uniforms.uTime = sceneUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 aRect;
attribute vec4 aAd;
attribute vec3 aTint;
varying vec2 vAdUv;
varying vec4 vAd;
varying vec3 vTint;
varying float vFade;
varying float vDist;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
vMapUv = aRect.xy + uv * aRect.zw;
vAdUv = uv;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 sp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vDist = distance(sp.xyz, cameraPosition);
  vFade = 1.0 - smoothstep(aAd.z, aAd.z + ${SIGN_FADE_LEN.toFixed(1)}, vDist);
  vAd = aAd; vTint = aTint;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uTime;
varying vec2 vAdUv;
varying vec4 vAd;
varying vec3 vTint;
varying float vFade;
varying float vDist;
float adHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float adNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(adHash(i), adHash(i + vec2(1.0, 0.0)), f.x), mix(adHash(i + vec2(0.0, 1.0)), adHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// one graffiti tag (crew c, tag t of four) laid over the poster at a seeded spot; returns its colour and cover
vec4 adTag(vec2 uv, float crew, float t, float s) {
  vec2 size = vec2(0.55 + 0.25 * fract(s * 7.3), 0.32 + 0.14 * fract(s * 3.1));
  vec2 pos = vec2(fract(s * 13.7) * (1.0 - size.x), 0.08 + fract(s * 5.9) * (0.84 - size.y));
  vec2 q = (uv - pos) / size;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
  float idx = crew * 4.0 + t;
  vec2 tuv = vec2((idx * ${TAG_W.toFixed(1)} + 2.0 + q.x * ${(TAG_W - 4).toFixed(1)}) / ${ATLAS.toFixed(1)}, 1.0 - (${TAG_Y.toFixed(1)} + 2.0 + (1.0 - q.y) * ${(TAG_H - 4).toFixed(1)}) / ${ATLAS.toFixed(1)});
  return texture2D(map, tuv);
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float wear = vAd.x, seed = vAd.y, flags = vAd.w;
  float crew = mod(floor(flags / 4.0), 4.0);
  vec2 uv = vAdUv;
  vec3 col = diffuseColor.rgb;
  // the sun and rain: faded, yellowed, a little grey
  float age = smoothstep(0.05, 0.95, wear);
  col = mix(col, col * 0.78 + vec3(0.13, 0.11, 0.03), age);
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), 0.45 * age);
  // grime streaks from the top, each poster its own
  float streak = adNoise(vec2(uv.x * 9.0 + seed * 31.0, uv.y * 1.5)) * smoothstep(0.4, 1.0, uv.y + 0.2);
  col *= 1.0 - 0.25 * age * streak;
  // tags: the first once wear passes a seeded point, the second later
  float t1 = 0.22 + 0.22 * fract(seed * 17.0), t2 = 0.5 + 0.2 * fract(seed * 29.0);
  if (wear > t1) { vec4 g = adTag(uv, crew, floor(fract(seed * 3.7) * 4.0), seed * 1.91 + 0.13); col = mix(col, g.rgb, g.a * smoothstep(t1, t1 + 0.04, wear)); }
  if (wear > t2) { vec4 g = adTag(uv, crew, floor(fract(seed * 8.3) * 4.0), seed * 4.77 + 0.61); col = mix(col, g.rgb, g.a * smoothstep(t2, t2 + 0.04, wear)); }
  // tears: the paper comes away from the edges first, in a pattern of its own, showing the old paste and paper behind
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float n = adNoise(uv * vec2(6.0, 8.0) + seed * 43.0) * 0.7 + adNoise(uv * vec2(17.0, 21.0) + seed * 11.0) * 0.3;
  float tear = (wear - 0.42) * 1.5 - (n * 0.6 + edge * 1.4);
  if (tear > 0.0) col = mix(vec3(0.80, 0.78, 0.71), vec3(0.62, 0.60, 0.55), adNoise(uv * 30.0 + seed)) * (0.9 + 0.1 * n);
  // far away: the campaign's colour as a flat tint
  col = mix(vTint * 0.9, col, vFade);
  // picking (the Campaigns panel): a free frame glows and pulses
  if (mod(flags, 4.0) >= 2.0) {
    float pulse = 0.55 + 0.45 * sin(uTime * 5.0 + seed * 6.0);
    float rim = 1.0 - smoothstep(0.0, 0.12, edge);
    col = mix(vec3(1.0, 0.86, 0.25) * (0.5 + 0.5 * pulse), vec3(1.0, 0.95, 0.6), rim);
  }
  diffuseColor.rgb = col;
  if (vDist > ${FAR_AT.toFixed(1)}) discard;
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float lit = mod(vAd.w, 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * lit * uNight * 0.8 * vFade;
  if (mod(vAd.w, 4.0) >= 2.0) totalEmissiveRadiance += diffuseColor.rgb * 0.6;
}`);
    };
    const geo = new PlaneGeometry(1, 1);
    this.rect = new InstancedBufferAttribute(new Float32Array(MAX_ADS * 4), 4).setUsage(DynamicDrawUsage);
    this.ad = new InstancedBufferAttribute(new Float32Array(MAX_ADS * 4), 4).setUsage(DynamicDrawUsage);
    this.tint = new InstancedBufferAttribute(new Float32Array(MAX_ADS * 3), 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('aRect', this.rect);
    geo.setAttribute('aAd', this.ad);
    geo.setAttribute('aTint', this.tint);
    this.mesh = new InstancedMesh(geo, mat, MAX_ADS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  /** The campaigns and rentals (the `ads` message): every chunk's posters again. */
  setAds(campaigns: CampaignDTO[], r: number[], stride: number) {
    this.campaigns = new Map(campaigns.map((c) => [c.id, c]));
    this.rentals.clear();
    for (let i = 0; i + stride <= r.length; i += stride) this.rentals.set(`${r[i]},${r[i + 1]}#${r[i + 2]}`, { campaign: r[i + 3], age: r[i + 4], rate: r[i + 5], at: r[i + 6], placed: r[i + 7], size: r[i + 8] ?? 1 });
    this.atlas.retain(new Set(this.campaigns.keys()));
    for (const key of this.hosts.keys()) this.build(key);
  }
  rental(x: number, y: number, i: number) { return this.rentals.get(`${x},${y}#${i}`); }
  campaign(id: number) { return this.campaigns.get(id); }
  campaignList(): CampaignDTO[] { return [...this.campaigns.values()]; }
  /** every rental as `x,y#slot` and its state */
  rentalEntries(): IterableIterator<[string, RentalView]> { return this.rentals.entries(); }

  /** Light up the free frames (picking slots in the Campaigns panel), or stop. */
  setPicking(on: boolean) {
    if (on === this.picking) return;
    this.picking = on;
    for (const key of this.hosts.keys()) this.build(key);
  }

  /** One chunk's buildings that have slots (render/buildings.ts calls it with every chunk it places). */
  setChunk(key: string, items: AdHostItem[]) {
    if (!items.length) { this.clear(key); return; }
    this.hosts.set(key, items);
    this.build(key);
  }
  clear(key: string) {
    this.hosts.delete(key);
    if (this.perChunk.delete(key)) this.dirty = true;
  }

  private build(key: string) {
    const items = this.hosts.get(key) ?? [];
    const m: number[] = [], r: number[] = [], a: number[] = [], t: number[] = [], refs: { k: string; seed: number }[] = [];
    const now = this.tick();
    for (const it of items) {
      const slots = AD_SLOTS[it.key];
      if (!slots) continue;
      for (let i = 0; i * AD_STRIDE < slots.length; i++) {
        const k = `${it.door[0]},${it.door[1]}#${i}`;
        const rent = this.rentals.get(k);
        const free = !rent && this.picking && this.open(it.door, i);
        if (!rent && !free) continue;
        const o = i * AD_STRIDE, size = AD_SIZES[slots[o + 1]] as AdSize, face = slots[o];
        const seed = adSeed(it.door[0], it.door[1], i, rent?.campaign ?? 0);
        let rect = [0, 0, 0, 0], tint: [number, number, number] = [1, 0.85, 0.3];
        if (rent) {
          const c = this.campaigns.get(rent.campaign);
          const own = c ? this.owner(c.owner) : null;
          const cells = c && own ? this.atlas.cellsOf(c, own.name, own.color) : null;
          if (!cells) continue;
          const shape = AD_SIZE[size].cell;
          rect = [...cells[shape]];
          if (size === 'hoarding') { rect[1] += rect[3] / 6; rect[3] *= 2 / 3; } // 3:1 from the 2:1 cell's middle band
          tint = cells.tint;
        }
        // where: the slot's centre turned to its wall, a hair of seeded tilt and offset, the poster's size (not stretched with a site's fence)
        it.matrix.decompose(tmpP, tmpQ, tmpS);
        const u = Math.min(tmpS.x, tmpS.y, tmpS.z), along = face === 0 ? tmpS.x : tmpS.z;
        const jx = (hash2(i * 13 + 7, it.door[0] * 3 + it.door[1]) - 0.5) * 0.008, jy = (hash2(it.door[1] * 5 + i, it.door[0] + 11) - 0.5) * 0.006;
        local.makeRotationY(FACE_YAW[face]);
        tilt.makeRotationZ((seed - 0.5) * 0.05);
        local.multiply(tilt);
        local.scale(tmpV.set((slots[o + 5] * u) / along, (slots[o + 6] * u) / tmpS.y, 1));
        const lx = slots[o + 2] + (face === 0 ? jx : 0), lz = slots[o + 4] + (face === 0 ? 0 : jx);
        local.setPosition(lx, slots[o + 3] + jy, lz);
        tmpM.multiplyMatrices(it.matrix, local);
        m.push(...tmpM.elements);
        r.push(...rect);
        const crew = Math.floor(hash2(it.parcel * 7 + 3, 19) * 4);
        const wear = rent ? adWear(adAge(rent.age, rent.rate, rent.at, now), seed) : 0;
        const fade = SIGN_FADE_START + (hash2(it.door[0] * 3 + 11 + i, it.door[1] * 5 + 2) - 0.5) * 2 * SIGN_FADE_JITTER;
        a.push(wear, seed, fade, (AD_SIZE[size].lit ? LIT : 0) + (free ? PICK : 0) + crew * 4);
        t.push(...tint);
        refs.push({ k: rent ? k : '', seed });
      }
    }
    this.perChunk.set(key, { m: new Float32Array(m), r: new Float32Array(r), a: new Float32Array(a), t: new Float32Array(t), refs, n: refs.length });
    this.dirty = true;
  }

  /** Once a game hour (or when asked): every poster's wear from the shared formula. A few hundred floats, never per frame. */
  refreshWear(force = false) {
    const now = this.tick(), hour = Math.floor(now / TICKS_PER_HOUR);
    if (!force && hour === this.hour) return;
    this.hour = hour;
    for (const c of this.perChunk.values()) for (let j = 0; j < c.n; j++) {
      const ref = c.refs[j], rent = ref.k ? this.rentals.get(ref.k) : undefined;
      if (rent) c.a[j * 4] = adWear(adAge(rent.age, rent.rate, rent.at, now), ref.seed);
    }
    this.dirty = true;
  }

  /** Pack every chunk's posters into the instance buffers, once a frame at most. */
  flush() {
    this.refreshWear();
    if (!this.dirty) return;
    this.dirty = false;
    const im = this.mesh.instanceMatrix.array as Float32Array, ra = this.rect.array as Float32Array, aa = this.ad.array as Float32Array, ta = this.tint.array as Float32Array;
    let n = 0;
    for (const c of this.perChunk.values()) {
      const take = Math.min(c.n, MAX_ADS - n);
      if (take <= 0) break;
      im.set(c.m.subarray(0, take * 16), n * 16);
      ra.set(c.r.subarray(0, take * 4), n * 4);
      aa.set(c.a.subarray(0, take * 4), n * 4);
      ta.set(c.t.subarray(0, take * 3), n * 3);
      n += take;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rect.needsUpdate = true;
    this.ad.needsUpdate = true;
    this.tint.needsUpdate = true;
  }

  get count() { return this.mesh.count; }
  /** The hosts in a chunk (the panel's picking and the nearest free slot). */
  hostsIn(key: string): readonly AdHostItem[] { return this.hosts.get(key) ?? []; }
  allHosts(): IterableIterator<AdHostItem[]> { return this.hosts.values(); }
}
