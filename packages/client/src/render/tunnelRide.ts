import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Fog, InstancedMesh,
  LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Points, Quaternion, RepeatWrapping, Scene, ShaderMaterial,
  SRGBColorSpace, Vector3,
} from 'three';
import { hash2, railPoint, isTunnel, isPlatform, underMask, type RailGeometry } from '@msimcity/shared';
import { METRO_Y, crossoverDip } from './underground';

/**
 * The tunnel seen from a tube driver's cab (docs/underground.md section 5, U7). The surface is not drawn at all: this is a
 * scene of its own, rebuilt every frame from the line's route around the train, so it costs nothing while nobody rides
 * and a few thousand vertices while somebody does.
 *
 *  - **The bore** is a ring every RING tiles along the route (the bore's own centre line, so curves and the bore the train
 *    is in are right), with lit seams every quarter tile and its lamps on the shoulders, each lamp with its own warmth,
 *    brightness, flicker and now and then a dead one. Light is worked out per vertex, so the pools slide by as the train goes.
 *  - **Stations** are the same rings opened out into a tiled vault with an island platform between the two tracks,
 *    a frieze in the line's colour, and the station's name boards on the wall behind the track. A portal ring joins the
 *    two shapes, and the platform's light spills into the tunnel beyond it.
 *  - **Rails, sleepers, cables and lamps** are the same samples again. Lamp flares are additive points.
 *  - **Crossovers**: the north-south bore dips under the east-west one (the same `crossoverDip` the trains use, so the
 *    cab pitches with the track), and the other line's bore shows as a light in the floor or the roof.
 *  - **Riders and other trains** are the main scene's own groups (`fpv.ts` draws them in a second pass over this scene).
 */

const K = 24, HALF = K / 2;
/** ring spacing along the route, tiles; the view reaches AHEAD in front of the eye and BEHIND behind it */
const RING = 0.0625, AHEAD = 6.2, BEHIND = 0.9;
const MAXF = 240;
/** the bore: radius, centre height and floor; the station vault's radius */
const R = 0.19, YC = METRO_Y + 0.005, FLOOR = METRO_Y - 0.17, VR = 0.47;
/** tunnel bored straight on past a terminus (METRO.overrun) */
const OVERRUN = 2;
const LAMP_DS = 0.5, PLAT_LAMP_DS = 0.25, TILE_REPEAT = 0.046;
export const TUNNEL_BG = 0x020306;
export const TUNNEL_FOG = { color: 0x030409, near: 1.4, far: 6.4 };

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** what a ride needs from the world each frame (built by main.ts from the selected tube train) */
export interface TunnelFeed {
  geom: RailGeometry;
  /** where the eye is along the route, which way the train is going (+1 / -1), and how far its bore lies to the left of the route */
  s: number; dir: 1 | -1; off: number;
  /** the line: id (for the seed), colour, and its stations' names in calling order */
  line: number; colour: number; names: string[];
  /** the train: which stop it is at or heading for, and whether it stands */
  stop: number; dwelling: boolean;
}

interface Platform { a: number; b: number; idx: number; warm: number; hum: number }

/** one ring of the view */
interface Fr {
  s: number; kind: 0 | 1; ord: number;
  x: number; z: number; h: number; lx: number; lz: number;
  /** the crossover dip, a negative height (0 on the level) and 1 / 2 for an east-west / north-south crossover tile */
  dy: number; cross: number;
  /** the three nearest lamps: weight (spatial), angle on the ring, colour; and the floor's light */
  lw: Float32Array; lp: Float32Array; lc: Float32Array;
  head: number; spill: number;
  fl: Float32Array;
}
const frame = (): Fr => ({
  s: 0, kind: 0, ord: 0, x: 0, z: 0, h: 0, lx: 0, lz: 0, dy: 0, cross: 0,
  lw: new Float32Array(3), lp: new Float32Array(3), lc: new Float32Array(9), head: 0, spill: 0, fl: new Float32Array(3),
});

/** a growing triangle soup with a position and colour per vertex, redrawn every frame */
class Dyn {
  readonly geo = new BufferGeometry();
  readonly pos: Float32Array; readonly col: Float32Array; readonly uv: Float32Array | null; readonly idx: Uint32Array;
  nv = 0; ni = 0;
  constructor(maxV: number, maxI: number, uvs = false) {
    this.pos = new Float32Array(maxV * 3); this.col = new Float32Array(maxV * 3); this.idx = new Uint32Array(maxI);
    this.uv = uvs ? new Float32Array(maxV * 2) : null;
    const p = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage), c = new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', p); this.geo.setAttribute('color', c);
    if (this.uv) this.geo.setAttribute('uv', new BufferAttribute(this.uv, 2).setUsage(DynamicDrawUsage));
    this.geo.setIndex(new BufferAttribute(this.idx, 1).setUsage(DynamicDrawUsage));
  }
  reset() { this.nv = 0; this.ni = 0; }
  v(x: number, y: number, z: number, r: number, g: number, b: number, u = 0, w = 0): number {
    const i = this.nv++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    if (this.uv) { this.uv[i * 2] = u; this.uv[i * 2 + 1] = w; }
    return i;
  }
  quad(a: number, b: number, c: number, d: number) {
    if (this.ni + 6 > this.idx.length) return;
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
    this.idx[this.ni++] = a; this.idx[this.ni++] = c; this.idx[this.ni++] = d;
  }
  get room() { return this.pos.length / 3 - this.nv; }
  commit() {
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
    if (this.uv) (this.geo.getAttribute('uv') as BufferAttribute).needsUpdate = true;
    this.geo.getIndex()!.needsUpdate = true;
    this.geo.setDrawRange(0, this.ni);
  }
}

// ---- textures -----------------------------------------------------------------------------------

/** white glazed tiles with dark grout, four to a repeat */
function tileTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8c897f'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 214 + ((x * 7 + y * 13) % 5) * 5;
    g.fillStyle = `rgb(${v},${v - 4},${v - 14})`;
    g.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x * 32 + 2, y * 32 + 2, 27, 3);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.minFilter = LinearMipmapLinearFilter; t.anisotropy = 4;
  return t;
}

/** a station name board: the roundel with its bar, then the name, over a white panel with a stripe in the line's colour */
function boardTexture(name: string, colour: number): CanvasTexture {
  const W = 512, H = 144;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, W, H);
  g.fillStyle = `#${colour.toString(16).padStart(6, '0')}`; g.fillRect(0, H - 18, W, 18);
  g.fillStyle = '#1b2230'; g.fillRect(0, 0, W, 4);
  // the roundel
  const cx = 78, cy = 62, r = 44;
  g.lineWidth = 15; g.strokeStyle = '#e32017'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
  g.fillStyle = '#0b4aa8'; g.fillRect(cx - r - 14, cy - 11, 2 * r + 28, 22);
  g.fillStyle = '#fff'; g.font = '700 16px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UNDERGROUND', cx, cy + 1);
  g.fillStyle = '#12151c'; g.textAlign = 'left';
  let size = 64;
  g.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  while (size > 24 && g.measureText(name).width > W - 168) { size -= 4; g.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`; }
  g.fillText(name, 150, 62);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const FLARE_VERT = /* glsl */ `
attribute float aSize; attribute vec3 aCol; uniform float uScale; varying vec3 vCol;
void main() {
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.02, -mv.z), 0.0, 90.0) * smoothstep(0.04, 0.3, -mv.z);
}`;
const FLARE_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 2.4);
  gl_FragColor = vec4(vCol * a * 0.8, 1.0);
}`;

const MAX_BOARDS = 14, MAX_LAMPS = 72, MAX_SLEEPERS = 220, MAX_FLARES = 120;
const WARM: [number, number, number] = [1.0, 0.76, 0.46], COOL: [number, number, number] = [0.82, 0.92, 1.0];

export class TunnelRide {
  readonly scene = new Scene();
  /** the view is being drawn (set by update, cleared by hide) */
  active = false;
  private fog = new Fog(TUNNEL_FOG.color, TUNNEL_FOG.near, TUNNEL_FOG.far);
  private wall: Dyn; private solid: Dyn;
  private wallMesh: Mesh; private solidMesh: Mesh;
  private concrete = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  private tiled: MeshBasicMaterial;
  private sleepers: InstancedMesh; private lamps: InstancedMesh;
  private flares: Points; private flarePos: Float32Array; private flareCol: Float32Array; private flareSize: Float32Array; private nFlares = 0;
  private flareMat: ShaderMaterial;
  private boards: { mesh: Mesh; mat: MeshBasicMaterial }[] = [];
  private boardTex = new Map<string, CanvasTexture>();
  private fr: Fr[] = [];
  private n = 0;
  private plats: Platform[] = [];
  private m4 = new Matrix4(); private q = new Quaternion(); private v3 = new Vector3(); private sc = new Vector3(1, 1, 1);
  private tint = new Color();
  private seed = 0; private sEye = 0; private dir: 1 | -1 = 1; private off = 0; private sigma = 1;
  private line: [number, number, number] = [1, 1, 1];
  private time = 0;
  private capLo = false; private capHi = false;

  constructor(private underAt: (x: number, y: number) => number) {
    this.scene.fog = this.fog;
    for (let i = 0; i < MAXF; i++) this.fr.push(frame());
    this.wall = new Dyn(MAXF * K, MAXF * K * 6, true);
    this.solid = new Dyn(16000, 48000);
    this.tiled = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, map: tileTexture() });
    this.wallMesh = new Mesh(this.wall.geo, [this.concrete, this.tiled]);
    this.solidMesh = new Mesh(this.solid.geo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
    for (const m of [this.wallMesh, this.solidMesh]) { m.frustumCulled = false; this.scene.add(m); }
    this.sleepers = new InstancedMesh(new BoxGeometry(0.014, 0.006, 0.17), new MeshBasicMaterial({ toneMapped: true }), MAX_SLEEPERS);
    this.lamps = new InstancedMesh(new BoxGeometry(0.05, 0.007, 0.014), new MeshBasicMaterial({ toneMapped: false, fog: false }), MAX_LAMPS);
    for (const m of [this.sleepers, this.lamps]) { m.frustumCulled = false; m.instanceMatrix.setUsage(DynamicDrawUsage); m.count = 0; this.scene.add(m); }
    this.flarePos = new Float32Array(MAX_FLARES * 3); this.flareCol = new Float32Array(MAX_FLARES * 3); this.flareSize = new Float32Array(MAX_FLARES);
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(this.flarePos, 3).setUsage(DynamicDrawUsage));
    fg.setAttribute('aCol', new BufferAttribute(this.flareCol, 3).setUsage(DynamicDrawUsage));
    fg.setAttribute('aSize', new BufferAttribute(this.flareSize, 1).setUsage(DynamicDrawUsage));
    this.flareMat = new ShaderMaterial({
      uniforms: { uScale: { value: 500 } }, vertexShader: FLARE_VERT, fragmentShader: FLARE_FRAG,
      transparent: true, blending: AdditiveBlending, depthWrite: false,
    });
    this.flares = new Points(fg, this.flareMat);
    this.flares.frustumCulled = false;
    this.scene.add(this.flares);
    const plane = new PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_BOARDS; i++) {
      const mat = new MeshBasicMaterial({ side: DoubleSide, toneMapped: true });
      const mesh = new Mesh(plane, mat);
      mesh.matrixAutoUpdate = false; mesh.visible = false; mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.boards.push({ mesh, mat });
    }
  }

  /** pixel scale for the flares: the drawing buffer's height over the tangent of half the field of view */
  setView(heightPx: number, fovDeg: number) { this.flareMat.uniforms.uScale.value = heightPx / 2 / Math.tan((fovDeg * Math.PI) / 360); }

  hide() { this.active = false; }

  dispose() {
    this.wall.geo.dispose(); this.solid.geo.dispose(); this.concrete.dispose(); this.tiled.map?.dispose(); this.tiled.dispose();
    for (const t of this.boardTex.values()) t.dispose();
    this.boardTex.clear();
  }

  // ---- per frame ---------------------------------------------------------------------------------

  update(f: TunnelFeed, now: number) {
    this.active = true;
    this.time = now;
    this.seed = (f.line * 131 + 17) % 9973;
    this.sEye = f.s; this.dir = f.dir; this.off = f.off; this.sigma = f.off < 0 ? -1 : 1;
    this.tint.setHex(f.colour);
    this.line = [this.tint.r, this.tint.g, this.tint.b];
    this.platforms(f);
    this.rings(f);
    this.lighting();
    this.buildWall();
    this.buildSolid(f);
    this.buildBits(f);
  }

  /** the platforms near the eye as ranges of arclength (a loop's repeat once each side) */
  private platforms(f: TunnelFeed) {
    const g = f.geom, out = this.plats; out.length = 0;
    const lo = this.sEye - AHEAD - 2, hi = this.sEye + AHEAD + 2;
    const reps = g.loop ? [-1, 0, 1] : [0];
    g.route.stops.forEach((st, i) => {
      const mid = g.stopS[i], half = st.len / 2;
      for (const r of reps) {
        const a = mid - half + r * g.L, b = mid + half + r * g.L;
        if (b < lo || a > hi) continue;
        out.push({ a, b, idx: i, warm: hash2(i * 7 + f.line, 61), hum: hash2(i * 3 + f.line, 67) });
      }
    });
  }

  private platAt(s: number): number {
    for (let i = 0; i < this.plats.length; i++) { const p = this.plats[i]; if (s > p.a + 1e-6 && s < p.b - 1e-6) return i; }
    return -1;
  }

  /** the rings of the view, in increasing arclength, with two at each platform end (the portal) */
  private rings(f: TunnelFeed) {
    const g = f.geom;
    let lo = this.sEye - (this.dir > 0 ? BEHIND : AHEAD), hi = this.sEye + (this.dir > 0 ? AHEAD : BEHIND);
    this.capLo = this.capHi = false;
    if (!g.loop) {
      if (lo < -OVERRUN) { lo = -OVERRUN; this.capLo = true; }
      if (hi > g.L + OVERRUN) { hi = g.L + OVERRUN; this.capHi = true; }
    }
    const fr = this.fr;
    let n = 0;
    const add = (s: number, kind: 0 | 1, ord: number) => { if (n < MAXF) { const r = fr[n++]; r.s = s; r.kind = kind; r.ord = ord; } };
    const edge = (s: number) => { for (const p of this.plats) if (Math.abs(s - p.a) < 1e-5 || Math.abs(s - p.b) < 1e-5) return true; return false; };
    const onGrid = (s: number) => Math.abs(s / RING - Math.round(s / RING)) < 1e-6;
    for (let k = Math.ceil(lo / RING - 1e-9); k * RING <= hi + 1e-9; k++) {
      const s = k * RING;
      if (!edge(s)) add(s, this.platAt(s) >= 0 ? 1 : 0, 0);
    }
    // the clipped ends of a there-and-back line get a ring of their own where the bore stops
    if (this.capLo && !onGrid(lo)) add(lo, this.platAt(lo) >= 0 ? 1 : 0, 0);
    if (this.capHi && !onGrid(hi)) add(hi, this.platAt(hi) >= 0 ? 1 : 0, 0);
    for (const p of this.plats) {
      if (p.a >= lo && p.a <= hi) { add(p.a, 0, 0); add(p.a, 1, 1); }
      if (p.b >= lo && p.b <= hi) { add(p.b, 1, 0); add(p.b, 0, 1); }
    }
    // sort the used slice by arclength, then by order at a platform end
    const used = fr.slice(0, n).sort((a, b) => a.s - b.s || a.ord - b.ord);
    for (let i = 0; i < n; i++) fr[i] = used[i];
    this.n = n;
    // the geometry of each ring
    const P = { x: 0, z: 0, h: 0 };
    for (let i = 0; i < n; i++) {
      const r = fr[i];
      railPoint(g, r.s, P);
      r.x = P.x; r.z = P.z; r.h = P.h; r.lx = Math.sin(P.h); r.lz = -Math.cos(P.h);
      // a crossover tile: the bore dips or stays level, and the other line's light shows
      const tx = Math.floor(P.x), tz = Math.floor(P.z), b = this.underAt(tx, tz);
      r.dy = 0; r.cross = 0;
      if (isTunnel(b) && !isPlatform(b) && underMask(b) === 15) {
        const cd = crossoverDip(b, P.x, P.z, P.h);
        r.dy = -cd.drop; r.cross = Math.abs(Math.sin(P.h)) > Math.abs(Math.cos(P.h)) ? 2 : 1;
      }
    }
  }

  // ---- light -------------------------------------------------------------------------------------

  private lampOn(k: number): number {
    const t = this.time, sd = this.seed;
    if (hash2(k * 5 + 1, sd + 3) < 0.05) return 0.12; // a lamp that has gone
    const own = 0.8 + 0.4 * hash2(k * 3 + 2, sd + 5);
    const w = t / 2100 + hash2(k, sd + 9) * 9, slot = Math.floor(w), ph = w - slot;
    let fl = 1;
    if (hash2(slot * 13 + k, sd + 11) < 0.035 && ph < 0.16) fl = Math.sin(ph * 190) > 0 ? 0.95 : 0.12; // a lamp that stutters now and then
    return own * fl * (1 + 0.02 * Math.sin(t * 0.0113 + k));
  }
  private lampColour(k: number, out: Float32Array, o: number, I: number) {
    const w = hash2(k * 7 + 3, this.seed + 21);
    out[o] = mix(WARM[0], COOL[0], w) * I; out[o + 1] = mix(WARM[1], COOL[1], w) * I; out[o + 2] = mix(WARM[2], COOL[2], w) * I;
  }

  private lighting() {
    const LAMP_PHI = [1.0, 2.15];
    for (let i = 0; i < this.n; i++) {
      const r = this.fr[i];
      const k0 = Math.round(r.s / LAMP_DS);
      for (let j = 0; j < 3; j++) {
        const k = k0 - 1 + j, sk = k * LAMP_DS;
        const inStation = this.platAt(sk) >= 0;
        const ds = r.s - sk;
        r.lw[j] = inStation ? 0 : Math.exp(-(ds * ds) / 0.07);
        r.lp[j] = LAMP_PHI[k & 1];
        this.lampColour(k, r.lc, j * 3, inStation ? 0 : this.lampOn(k));
      }
      // the train's own headlamps light the way ahead, and the saloon behind it a little
      const hd = (r.s - this.sEye) * this.dir;
      r.head = hd >= -0.1 ? 0.62 * Math.exp(-Math.max(0, hd) / 1.5) : 0.2 * Math.exp((hd + 0.1) / 0.5);
      // a platform's light spills along the tunnel beyond its ends
      let sp = 0;
      for (const p of this.plats) { const d = r.s < p.a ? p.a - r.s : r.s > p.b ? r.s - p.b : 0; if (d > 0) sp = Math.max(sp, 0.9 * Math.exp(-d / 0.55)); }
      r.spill = sp;
      // light on the floor: the pools of the lamps seen from above, the headlamps, the spill
      let fl0 = 0.05 + r.head * 0.8 + sp * 0.7, fl1 = fl0, fl2 = fl0;
      for (let j = 0; j < 3; j++) { fl0 += r.lw[j] * r.lc[j * 3] * 0.4; fl1 += r.lw[j] * r.lc[j * 3 + 1] * 0.4; fl2 += r.lw[j] * r.lc[j * 3 + 2] * 0.4; }
      if (r.kind === 1) {
        const p = this.plats[this.platAt(r.s)] ?? this.plats.find((q) => Math.abs(q.a - r.s) < 1e-5 || Math.abs(q.b - r.s) < 1e-5);
        const wm = p ? p.warm : 0.5;
        fl0 = 0.55 * mix(1.0, 0.86, wm); fl1 = 0.55 * 0.94; fl2 = 0.55 * mix(0.84, 1.0, wm);
      }
      r.fl[0] = fl0; r.fl[1] = fl1; r.fl[2] = fl2;
    }
  }

  /** the light on a bore wall at angle phi of ring r (0 = the outer side, pi / 2 = the roof), into out */
  private wallLight(r: Fr, phi: number, out: number[]) {
    const lr = this.line;
    let L0 = 0.03 + r.head * 0.3 + r.spill * 0.4 + lr[0] * 0.02, L1 = 0.03 + r.head * 0.3 + r.spill * 0.36 + lr[1] * 0.02, L2 = 0.035 + r.head * 0.29 + r.spill * 0.3 + lr[2] * 0.025;
    for (let j = 0; j < 3; j++) {
      const w = r.lw[j];
      if (w < 0.002) continue;
      const d = angDiff(phi, r.lp[j]);
      const a = w * (0.2 + 0.8 * Math.exp(-(d * d) / 0.6)) * 0.85;
      L0 += a * r.lc[j * 3]; L1 += a * r.lc[j * 3 + 1]; L2 += a * r.lc[j * 3 + 2];
    }
    out[0] = L0; out[1] = L1; out[2] = L2;
  }

  // ---- geometry ----------------------------------------------------------------------------------

  /** the world position of the ring r at lateral u (left of the route, from the centre line) and height y */
  private at(r: Fr, u: number, y: number, out: Vector3): Vector3 { return out.set(r.x + r.lx * u, y + r.dy, r.z + r.lz * u); }

  private buildWall() {
    const w = this.wall, A: number[] = [], B: number[] = [];
    w.reset();
    const L = [0, 0, 0], seg = this.seed;
    for (let i = 0; i < this.n; i++) {
      const r = this.fr[i];
      const si = Math.round(r.s / RING);
      const seam = si % 4 === 0;
      const segTone = 0.82 + 0.3 * hash2(Math.floor(si / 4) + 5000, seg + 41);
      const p = r.kind === 1 ? this.plats[this.platAt(r.s)] ?? this.plats.find((q) => Math.abs(q.a - r.s) < 1e-5 || Math.abs(q.b - r.s) < 1e-5) : null;
      const warm = p ? p.warm : 0.5;
      for (let j = 0; j < K; j++) {
        let u: number, y: number, phi: number;
        if (r.kind === 0) {
          phi = (TAU * j) / K;
          u = this.off + this.sigma * R * Math.cos(phi);
          y = Math.max(FLOOR, YC + R * Math.sin(phi));
        } else if (j <= HALF) {
          phi = (Math.PI * j) / HALF;
          u = this.sigma * VR * Math.cos(phi); y = FLOOR + VR * Math.sin(phi);
        } else {
          phi = -Math.PI / 2;
          u = this.sigma * (-VR + (2 * VR * (j - HALF)) / HALF); y = FLOOR;
        }
        const wp = this.at(r, u, y, this.v3);
        let cr: number, cg: number, cb: number, tu = 0, tv = 0;
        const noise = 0.93 + 0.14 * hash2(si * 29 + j, seg + 43);
        if (r.kind === 0) {
          this.wallLight(r, phi, L);
          // concrete segments, a little of the line's colour in the grime, a darker seam and a darker floor
          const base = segTone * noise * (seam ? 0.5 : 1) * (j > HALF && y <= FLOOR + 1e-4 ? 0.55 : 1);
          cr = (0.24 + this.line[0] * 0.025) * base * L[0]; cg = (0.235 + this.line[1] * 0.025) * base * L[1]; cb = (0.23 + this.line[2] * 0.025) * base * L[2];
        } else {
          // tiles, bright; the vault a little darker towards the floor, the floor dark
          const shade = j <= HALF ? 0.7 + 0.3 * Math.sin(phi) : 0.42;
          const lampPulse = 0.93 + 0.07 * Math.cos(r.s * TAU / PLAT_LAMP_DS);
          const hum = p ? 1 + 0.015 * Math.sin(this.time * 0.01 + p.hum * 30) : 1;
          const base = shade * lampPulse * hum * noise * 0.62;
          cr = base * mix(1.0, 0.86, warm) * 1.05; cg = base * 0.94 * 1.05; cb = base * mix(0.84, 1.0, warm) * 1.05;
          const arc = j <= HALF ? VR * phi : VR * Math.PI + (j - HALF) * (2 * VR) / HALF;
          tu = r.s / TILE_REPEAT; tv = arc / TILE_REPEAT;
        }
        w.v(wp.x, wp.y, wp.z, cr, cg, cb, tu, tv);
      }
    }
    for (let i = 0; i + 1 < this.n; i++) {
      const r0 = this.fr[i], r1 = this.fr[i + 1];
      if (r1.s - r0.s > RING * 3) continue; // a gap (the view was clipped); nothing to join
      const tiled = r0.kind === 1 || r1.kind === 1, dst = tiled ? B : A;
      for (let j = 0; j < K; j++) {
        const j2 = (j + 1) % K, a = i * K + j, b = i * K + j2, c = (i + 1) * K + j2, d = (i + 1) * K + j;
        dst.push(a, b, c, a, c, d);
      }
    }
    // end caps: a dark wall across the bore's blind end
    const cap = (i: number) => {
      const r = this.fr[i];
      const mid = this.at(r, this.off, YC, this.v3);
      const m = w.v(mid.x, mid.y, mid.z, 0.01, 0.01, 0.012);
      for (let j = 0; j < K; j++) A.push(m, i * K + j, i * K + ((j + 1) % K));
    };
    if (this.capLo && this.n) cap(0);
    if (this.capHi && this.n) cap(this.n - 1);
    const idx = w.idx;
    let ni = 0;
    for (const t of A) if (ni < idx.length) idx[ni++] = t;
    const na = ni;
    for (const t of B) if (ni < idx.length) idx[ni++] = t;
    w.ni = ni;
    w.commit();
    const g = w.geo;
    g.clearGroups();
    if (na) g.addGroup(0, na, 0);
    if (ni > na) g.addGroup(na, ni - na, 1);
  }

  /** rails, the platform island and its lit edges, the frieze in the line's colour, cables */
  private buildSolid(f: TunnelFeed) {
    const s = this.solid;
    s.reset();
    const fr = this.fr, n = this.n;
    const off = this.off, sg = this.sigma;
    const lc = this.line;
    const L = [0, 0, 0];
    const p3 = new Vector3(), p4 = new Vector3();
    const ribbon = (i0: number, i1: number, ua: number, ya: number, ub: number, yb: number, col: number[], lum: (r: Fr, o: number[]) => void) => {
      const LA = [0, 0, 0], LB = [0, 0, 0];
      lum(fr[i0], LA);
      let a0 = -1, b0 = -1;
      for (let i = i0; i <= i1; i++) {
        const r = fr[i];
        lum(r, LB);
        this.at(r, ua, ya, p3); this.at(r, ub, yb, p4);
        const a = s.v(p3.x, p3.y, p3.z, col[0] * LB[0], col[1] * LB[1], col[2] * LB[2]);
        const b = s.v(p4.x, p4.y, p4.z, col[0] * LB[0], col[1] * LB[1], col[2] * LB[2]);
        if (a0 >= 0 && r.s - fr[i - 1].s < RING * 3 && r.s > fr[i - 1].s) s.quad(a0, b0, b, a);
        a0 = a; b0 = b;
      }
    };
    const floorLum = (r: Fr, o: number[]) => { o[0] = r.fl[0]; o[1] = r.fl[1]; o[2] = r.fl[2]; };
    // rails: the head catches the headlamps ahead
    const railLum = (r: Fr, o: number[]) => {
      const hd = Math.max(0, (r.s - this.sEye) * this.dir);
      const g = 0.5 + 1.1 * Math.exp(-hd / 1.1);
      o[0] = r.fl[0] * g; o[1] = r.fl[1] * g; o[2] = r.fl[2] * g * 1.05;
    };
    const ry = FLOOR + 0.026;
    for (const du of [-0.045, 0.045]) ribbon(0, n - 1, off + du - 0.0055, ry, off + du + 0.0055, ry, [0.55, 0.57, 0.62], railLum);
    // the conductor rails: one beside the track on the outer side, one in the middle between the running rails
    ribbon(0, n - 1, off + sg * 0.092 - 0.0045, FLOOR + 0.02, off + sg * 0.092 + 0.0045, FLOOR + 0.02, [0.34, 0.28, 0.2], floorLum);
    ribbon(0, n - 1, off - 0.004, FLOOR + 0.014, off + 0.004, FLOOR + 0.014, [0.3, 0.3, 0.33], floorLum);
    // ballast: a darker bed under the track
    ribbon(0, n - 1, off - 0.115, FLOOR + 0.004, off + 0.115, FLOOR + 0.004, [0.12, 0.115, 0.11], floorLum);

    // cables along the walls: three on the outer side, one on the inner, each hung between brackets with a sag
    const cableAt = (r: Fr, phi: number, rad: number, o: Vector3) => {
      const sag = (() => { const fr4 = (r.s / 0.25) - Math.floor(r.s / 0.25); return 4 * fr4 * (1 - fr4); })();
      const u = off + sg * rad * Math.cos(phi), y = Math.max(FLOOR, YC + rad * Math.sin(phi)) - 0.006 * sag;
      return this.at(r, u, y, o);
    };
    const cables: [number, number, number][] = [[0.34, 0.968, 0.07], [0.5, 0.968, 0.09], [0.12, 0.968, 0.06], [2.75, 0.968, 0.05]];
    cables.forEach(([phi, rad, shade], ci) => {
      let a0 = -1, b0 = -1;
      for (let i = 0; i < n; i++) {
        const r = fr[i];
        if (r.kind === 1 || fr[Math.max(0, i - 1)].kind === 1 || fr[Math.min(n - 1, i + 1)].kind === 1) { a0 = b0 = -1; continue; }
        this.wallLight(r, phi, L);
        const si = Math.round(r.s / RING), bracket = si % 4 === 0 ? 2.4 : 1;
        const tone = shade * bracket * (0.9 + 0.2 * hash2(si + ci * 977, this.seed + 53));
        cableAt(r, phi, rad * R, p3); cableAt(r, phi + 0.028, rad * R, p4);
        const a = s.v(p3.x, p3.y, p3.z, tone * L[0], tone * L[1], tone * L[2]), b = s.v(p4.x, p4.y, p4.z, tone * L[0], tone * L[1], tone * L[2]);
        if (a0 >= 0) s.quad(a0, b0, b, a);
        a0 = a; b0 = b;
      }
    });

    // stations: the island, its lit edges and end caps, the frieze, a sprinkle of posters
    for (const p of this.plats) {
      let i0 = -1, i1 = -1;
      for (let i = 0; i < n; i++) if (fr[i].kind === 1 && fr[i].s >= p.a - 1e-6 && fr[i].s <= p.b + 1e-6) { if (i0 < 0) i0 = i; i1 = i; }
      if (i0 < 0 || i1 <= i0) continue;
      const top = FLOOR + 0.1;
      const platLum = (r: Fr, o: number[]) => { o[0] = r.fl[0] * 1.2; o[1] = r.fl[1] * 1.2; o[2] = r.fl[2] * 1.2; };
      ribbon(i0, i1, -0.11, top, 0.11, top, [0.86, 0.82, 0.7], platLum);                    // the island's top
      for (const e of [-1, 1]) ribbon(i0, i1, e * 0.11, top + 0.0005, e * 0.13, top + 0.0005, [lc[0] * 1.5 + 0.1, lc[1] * 1.5 + 0.1, lc[2] * 1.5 + 0.1], platLum); // the lit edges
      for (const e of [-1, 1]) ribbon(i0, i1, e * 0.13, top, e * 0.13, FLOOR, [0.55, 0.52, 0.45], platLum);                  // its sides
      // end caps
      for (const iE of [i0, i1]) {
        const r = fr[iE], ca = this.at(r, -0.13, FLOOR, p3), cb = this.at(r, 0.13, FLOOR, p4);
        const q1 = s.v(ca.x, ca.y, ca.z, 0.5, 0.47, 0.4), q2 = s.v(cb.x, cb.y, cb.z, 0.5, 0.47, 0.4);
        this.at(r, 0.13, top, p3); const q3 = s.v(p3.x, p3.y, p3.z, 0.7, 0.66, 0.56);
        this.at(r, -0.13, top, p3); const q4 = s.v(p3.x, p3.y, p3.z, 0.7, 0.66, 0.56);
        s.quad(q1, q2, q3, q4);
      }
      // the frieze: a band in the line's colour on both walls at about eye height
      for (const e of [-1, 1]) {
        const phi0 = 0.2, phi1 = 0.34;
        const pa = (r: Fr, o: Vector3, phi: number) => this.at(r, e * VR * 0.998 * Math.cos(phi), FLOOR + VR * 0.998 * Math.sin(phi), o);
        let a0 = -1, b0 = -1;
        for (let i = i0; i <= i1; i++) {
          const r = fr[i];
          pa(r, p3, phi0); pa(r, p4, phi1);
          const k = 0.9 + 0.1 * hash2(Math.round(r.s / RING), this.seed + 71), lm = r.fl[0];
          const a = s.v(p3.x, p3.y, p3.z, lc[0] * k * lm * 1.6, lc[1] * k * lm * 1.6, lc[2] * k * lm * 1.6), b = s.v(p4.x, p4.y, p4.z, lc[0] * k * lm * 1.6, lc[1] * k * lm * 1.6, lc[2] * k * lm * 1.6);
          if (a0 >= 0) s.quad(a0, b0, b, a);
          a0 = a; b0 = b;
        }
      }
    }
    // the lit edges of the island go in as coloured top strips (drawn after the top, a hair above it)
    void f;
    s.commit();
  }

  /** lamps and flares, sleepers, name boards and the crossover lights */
  private buildBits(f: TunnelFeed) {
    const fr = this.fr, n = this.n;
    const sMin = n ? fr[0].s : 0, sMax = n ? fr[n - 1].s : 0;
    this.nFlares = 0;
    let nl = 0;
    const flare = (x: number, y: number, z: number, r: number, g: number, b: number, size: number, dist: number) => {
      if (this.nFlares >= MAX_FLARES) return;
      const fade = 1 - smooth(AHEAD - 2.2, AHEAD - 0.4, dist);
      if (fade <= 0.01) return;
      const k = this.nFlares++;
      this.flarePos[k * 3] = x; this.flarePos[k * 3 + 1] = y; this.flarePos[k * 3 + 2] = z;
      this.flareCol[k * 3] = r * fade; this.flareCol[k * 3 + 1] = g * fade; this.flareCol[k * 3 + 2] = b * fade;
      this.flareSize[k] = size;
    };
    const P = { x: 0, z: 0, h: 0 }, c3 = new Color();
    const frameAt = (s: number): Fr => { // a ring at an arbitrary s (lamps and sleepers sit between the grid rings)
      const r = TMP_FR;
      railPoint(f.geom, s, P);
      r.s = s; r.x = P.x; r.z = P.z; r.h = P.h; r.lx = Math.sin(P.h); r.lz = -Math.cos(P.h);
      const b = this.underAt(Math.floor(P.x), Math.floor(P.z));
      r.dy = isTunnel(b) && !isPlatform(b) && underMask(b) === 15 ? -crossoverDip(b, P.x, P.z, P.h).drop : 0;
      return r;
    };
    const yaw = (h: number) => this.q.setFromAxisAngle(UP, -h);
    const dist = (s: number) => Math.abs(s - this.sEye);
    // ---- lamps in the bore, on the shoulders, alternating
    if (n) {
      for (let k = Math.ceil(sMin / LAMP_DS); k * LAMP_DS <= sMax; k++) {
        const s = k * LAMP_DS;
        if (this.platAt(s) >= 0 || nl >= MAX_LAMPS) continue;
        const I = this.lampOn(k);
        const r = frameAt(s);
        const phi = (k & 1) ? 2.15 : 1.0;
        const u = this.off + this.sigma * R * 0.965 * Math.cos(phi), y = YC + R * 0.965 * Math.sin(phi);
        this.at(r, u, y, this.v3);
        this.m4.compose(this.v3, yaw(r.h), this.sc.set(1, 1, 1));
        this.lamps.setMatrixAt(nl, this.m4);
        this.lampColour(k, LC, 0, I * 4);
        this.lamps.setColorAt(nl, c3.setRGB(LC[0], LC[1], LC[2]));
        nl++;
        flare(this.v3.x, this.v3.y, this.v3.z, LC[0] * 0.55, LC[1] * 0.55, LC[2] * 0.55, 0.09 * Math.sqrt(I + 0.05), dist(s));
      }
      // station lamps: panels down the middle of the vault
      for (const p of this.plats) {
        for (let k = Math.ceil(Math.max(p.a, sMin) / PLAT_LAMP_DS); k * PLAT_LAMP_DS <= Math.min(p.b, sMax); k++) {
          const s = k * PLAT_LAMP_DS;
          if (s < p.a + 0.02 || s > p.b - 0.02 || nl >= MAX_LAMPS) continue;
          const r = frameAt(s), hum = 1 + 0.02 * Math.sin(this.time * 0.01 + k), dead = hash2(k * 5 + p.idx, this.seed + 83) < 0.06 ? 0.2 : 1;
          this.at(r, 0, FLOOR + VR * 0.985, this.v3);
          this.m4.compose(this.v3, yaw(r.h), this.sc.set(1.5, 1, 1.1));
          this.lamps.setMatrixAt(nl, this.m4);
          const cr = mix(1.0, 0.88, p.warm) * 2.4 * hum * dead, cg = 2.3 * hum * dead, cb = mix(0.84, 1.0, p.warm) * 2.3 * hum * dead;
          this.lamps.setColorAt(nl, c3.setRGB(cr, cg, cb));
          nl++;
          flare(this.v3.x, this.v3.y, this.v3.z, cr * 0.3, cg * 0.3, cb * 0.3, 0.12, dist(s));
        }
      }
    }
    this.lamps.count = nl;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    // ---- signals: now and then on the inner wall, green mostly, red when there is a train close ahead
    if (n) {
      const SIG = 2.3;
      for (let k = Math.ceil(sMin / SIG); k * SIG <= sMax; k++) {
        const s = k * SIG + 0.6 * hash2(k, this.seed + 91);
        if (s < sMin || s > sMax || this.platAt(s) >= 0 || this.platAt(s - 0.4) >= 0 || this.platAt(s + 0.4) >= 0) continue;
        const r = frameAt(s), pick = hash2(k * 3, this.seed + 97);
        const col: [number, number, number] = pick < 0.72 ? [0.2, 1.0, 0.4] : pick < 0.88 ? [1.0, 0.7, 0.15] : [1.0, 0.12, 0.08];
        this.at(r, this.off - this.sigma * R * 0.96 * Math.cos(0.5), YC + R * 0.96 * Math.sin(0.5) - 0.02, this.v3);
        const blink = hash2(k, this.seed + 99) < 0.2 ? (Math.sin(this.time * 0.006 + k) > 0 ? 1 : 0.2) : 1;
        flare(this.v3.x, this.v3.y, this.v3.z, col[0] * blink * 1.2, col[1] * blink * 1.2, col[2] * blink * 1.2, 0.045, dist(s));
      }
    }
    // ---- the other line's bore at a crossover: a glow in the floor (east-west) or the roof (north-south)
    for (let i = 0; i < n; i++) {
      const r = fr[i];
      if (!r.cross || (i % 2)) continue;
      const tile = (r.cross === 1 ? r.x : r.z) - Math.floor(r.cross === 1 ? r.x : r.z);
      const w = Math.sin(Math.PI * tile);
      if (w < 0.25) continue;
      const pulse = 0.55 + 0.45 * hash2(Math.floor(this.time / 330) + Math.floor(r.x) * 7, Math.floor(r.z) * 13 + this.seed);
      const up = r.cross === 1 ? FLOOR + 0.012 : YC + R - 0.02;
      this.at(r, this.off, up, this.v3);
      flare(this.v3.x, this.v3.y, this.v3.z, 0.5 * w * pulse, 0.8 * w * pulse, 1.2 * w * pulse, 0.11, dist(r.s));
    }
    this.flares.geometry.setDrawRange(0, this.nFlares);
    for (const a of ['position', 'aCol', 'aSize']) (this.flares.geometry.getAttribute(a) as BufferAttribute).needsUpdate = true;

    // ---- sleepers every SLEEP tiles
    let ns = 0;
    const SLEEP = 0.05;
    if (n) {
      for (let k = Math.ceil(sMin / SLEEP); k * SLEEP <= sMax && ns < MAX_SLEEPERS; k++) {
        const s = k * SLEEP, r = frameAt(s);
        this.at(r, this.off, FLOOR + 0.01, this.v3);
        this.m4.compose(this.v3, yaw(r.h), this.sc.set(1, 1, 1));
        this.sleepers.setMatrixAt(ns, this.m4);
        // lit like the floor there: take the nearest ring's floor light
        const idx = clamp(Math.round((s - sMin) / RING), 0, n - 1);
        const fl = fr[Math.min(n - 1, Math.max(0, this.nearest(s, idx)))].fl;
        const tone = 0.2 + 0.07 * hash2(k, this.seed + 101);
        this.sleepers.setColorAt(ns, c3.setRGB(tone * fl[0] * 1.3, tone * 0.92 * fl[1] * 1.3, tone * 0.8 * fl[2] * 1.3));
        ns++;
      }
    }
    this.sleepers.count = ns;
    this.sleepers.instanceMatrix.needsUpdate = true;
    if (this.sleepers.instanceColor) this.sleepers.instanceColor.needsUpdate = true;

    // ---- name boards on the wall behind the track, at the station's pace
    let nb = 0;
    for (const p of this.plats) {
      const name = f.names[p.idx] ?? '';
      if (!name) continue;
      const key = `${name}|${f.colour}`;
      let tex = this.boardTex.get(key);
      if (!tex) { tex = boardTexture(name, f.colour); this.boardTex.set(key, tex); if (this.boardTex.size > 40) { const first = this.boardTex.keys().next().value; if (first) { this.boardTex.get(first)?.dispose(); this.boardTex.delete(first); } } }
      const len = p.b - p.a, count = Math.max(2, Math.round(len / 0.62));
      for (let b = 0; b < count && nb < MAX_BOARDS; b++) {
        const jit = (hash2(p.idx * 17 + b, this.seed + 111) - 0.5) * 0.06;
        const s = p.a + len * ((b + 0.5) / count) + jit;
        if (s < sMin || s > sMax) continue;
        const r = frameAt(s);
        const phi = 0.62; // up the vault from the outer side, a bit above the eye
        const cu = this.sigma * (VR - 0.004) * Math.cos(phi), cy = FLOOR + (VR - 0.004) * Math.sin(phi);
        this.at(r, cu, cy, this.v3);
        // the board lies on the wall: its x along the way of travel, its y up the wall, its normal into the vault
        const sg = this.sigma, cp = Math.cos(phi), sp = Math.sin(phi);
        const bo = this.boards[nb++];
        const W = 0.2, H = 0.057;
        const wt = new Vector3(Math.cos(r.h) * sg, 0, Math.sin(r.h) * sg).multiplyScalar(W);
        const wu = new Vector3(r.lx * -sg * sp, cp, r.lz * -sg * sp).multiplyScalar(H);
        const wn = new Vector3(r.lx * -sg * cp, -sp, r.lz * -sg * cp);
        this.m4.makeBasis(wt, wu, wn).setPosition(this.v3);
        bo.mesh.matrix.copy(this.m4);
        bo.mesh.matrixWorld.copy(this.m4);
        if (bo.mat.map !== tex) { bo.mat.map = tex; bo.mat.needsUpdate = true; }
        const l = (0.85 + 0.12 * hash2(p.idx * 3 + b, this.seed + 113)) * (1 + 0.02 * Math.sin(this.time * 0.01 + p.hum * 30));
        bo.mat.color.setRGB(l, l, l);
        bo.mesh.visible = true;
      }
    }
    for (let i = nb; i < this.boards.length; i++) this.boards[i].mesh.visible = false;
  }

  /** the index of the ring nearest arclength s, searching out from a first guess */
  private nearest(s: number, guess: number): number {
    const fr = this.fr, n = this.n;
    let i = clamp(guess, 0, n - 1);
    while (i > 0 && fr[i].s > s) i--;
    while (i < n - 1 && fr[i + 1].s <= s) i++;
    return i;
  }

}

const UP = new Vector3(0, 1, 0);
const TMP_FR = frame();
const LC = new Float32Array(3);
