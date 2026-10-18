import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, Quaternion, ShaderMaterial, Shape, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CHUNK_SIZE, hash2, isRoad, terrainOf, Terrain, isBridgeAux, bridgeNS, bridgeStyle, bridgeDeckH, BridgeStyle, BRIDGE_MAX_SPAN, BRIDGE_STYLE_NAMES,
  hasFeature, planBridge, bridgeClearance, basculeSeed, basculeLiftAt, BASCULE_LIFT, BASCULE_CLOSE_BEFORE, BASCULE_OPEN_AFTER,
  type BridgeStyleId, type BridgePlan,
} from '@msimcity/shared';
import type { ClientChunk, ClientWorld } from '../world';
import type { Crossing } from '../input';
import { Kit } from './kit';
import { sceneUniforms } from './materials';

/**
 * Road bridges (shared/src/bridges.ts) above the water: each span's deck, parapets, lamps and what holds it up, by
 * its style: stone arches on cutwater piers, a steel girder or truss on concrete piers, or a suspension span between
 * two towers. The ramps up to the deck are drawn on the landing road tiles (visual only: the world is flat), or on the
 * end deck tile when the landing is a junction, so nobody turning there is lifted. A bascule span (Tower Bridge) is
 * the landmark's own model (chunkView places it); here it gets its ramps, its lift and the gates on its approaches: half
 * barriers and flashing red lights that close for each lift on the server's schedule (shared/src/bridges.ts
 * basculeLiftAt; the traffic waits at them as at a level crossing), animated by `frame`.
 *
 * One merged mesh per chunk, built by the span's first deck tile (lowest x or y), plus the lamp heads and their light
 * pools on the deck after dark. Organic: every bridge takes its stone or paint, pier spacing, arch rise, parapet,
 * lamp design and spacing, tower height and colour from its own hash, and each lamp comes on at its own darkness.
 * `roadY` lifts cars and walkers onto the deck and its ramps.
 */

/** the deck is the whole road, pavements too; its carriageway is 0.75 wide as on a road cell */
const W = 0.49, C = 0.375;
const ASPHALT = 0x3d3f45, PAVING = 0x9a9ea5;
const STONE = [0xe3dccb, 0xd8cfb8, 0xa9a8a2, 0xd2b48c, 0xb5654a, 0xc9b48a];
const IRON = [0x2f5d46, 0x8e2b25, 0x2a2a2c, 0x4f5f70, 0x2f5d46];
const CONCRETE = [0xb9b6ae, 0xa9a59c, 0xc4c0b6, 0x9f9c95];
const PAINT = [0x3b6ea5, 0x3f6b4f, 0x9a3b2f, 0x7d8590, 0xd8cfb5, 0x2f4f6f];
const TOWER = [0xe8e4da, 0xb5432f, 0x3f6b4f, 0x8c949c, 0xd2c6a8];
const WARM = 0xffd9a0, COOL = 0xf2f6ff;

const ease = (t: number) => t * t * (3 - 2 * t);
const e01 = (t: number) => ease(Math.min(1, Math.max(0, t)));
const tkey = (x: number, z: number) => (x + 0x8000) * 65536 + (z + 0x8000);

/**
 * The deck's height along a bridge: u runs along it from the far edge of the low landing (so the first deck tile is
 * 1..2), the surface rises over [a, a + 1] and falls over [b - 1, b]. A one-tile bridge with junctions at both ends
 * makes a hump.
 */
interface Lift { ns: boolean; o: number; a: number; b: number; h: number; land: boolean }
const liftY = (l: Lift, u: number) => l.h * Math.min(e01(u - l.a), e01(l.b - u));

/** Lamp heads glow after dark, each from its own threshold (aOn); 2 never (a dead lamp). */
function lampMaterial() {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sceneUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aOn;\nvarying float vOn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOn = aOn;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vOn;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 1.8 * smoothstep(vOn - 0.04, vOn + 0.04, uNight);');
  };
  m.customProgramCacheKey = () => 'msc-bridge-lamp';
  return m;
}
/** A soft pool of light on the deck under each lamp, added on top after dark. */
function poolMaterial() {
  return new ShaderMaterial({
    uniforms: { uNight: sceneUniforms.uNight },
    vertexShader: /* glsl */ `
      attribute float aOn; attribute vec2 aUv; attribute vec3 color;
      varying float vOn; varying vec2 vUv; varying vec3 vCol;
      void main() { vOn = aOn; vUv = aUv; vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; varying float vOn; varying vec2 vUv; varying vec3 vCol;
      void main() {
        float d = length(vUv), a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vCol * a * a * 0.6 * smoothstep(vOn - 0.04, vOn + 0.04, uNight), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  });
}

/** Geometry with its glow thresholds, gathered per chunk. */
class Glow {
  heads: BufferGeometry[] = [];
  pools: BufferGeometry[] = [];
  private tag(g: BufferGeometry, color: number, on: number, bright = 1) {
    const ng = g.index ? g.toNonIndexed() : g;
    const n = ng.attributes.position.count, c = new Float32Array(n * 3);
    const r = (((color >> 16) & 255) / 255) * bright, gr = (((color >> 8) & 255) / 255) * bright, b = ((color & 255) / 255) * bright;
    for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; }
    ng.setAttribute('color', new Float32BufferAttribute(c, 3));
    ng.setAttribute('aOn', new Float32BufferAttribute(new Float32Array(n).fill(on), 1));
    ng.deleteAttribute('uv');
    return ng;
  }
  head(g: BufferGeometry, color: number, on: number) { this.heads.push(this.tag(g, color, on)); }
  /** a square pool of radius r centred on (x, y, z) in world space, flat; `bright` scales it (no two lamps alike) */
  pool(x: number, y: number, z: number, r: number, color: number, on: number, bright: number) {
    const g = new BufferGeometry();
    const p = [x - r, y, z - r, x + r, y, z - r, x + r, y, z + r, x - r, y, z - r, x + r, y, z + r, x - r, y, z + r];
    g.setAttribute('position', new Float32BufferAttribute(p, 3));
    g.setAttribute('aUv', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1], 2));
    this.pools.push(this.tag(g, color, on, bright));
  }
}

const UP = new Vector3(0, 1, 0);

/**
 * The stretch of deck boats pass under (shared/src/bridges.ts bridgeChannel): the middle tile of an odd span, the middle
 * two of an even one. The deck runs from u = 1 to L + 1, so the channel is centred on 1 + L / 2 and half a tile or a
 * whole tile either side of it.
 */
const channelOf = (L: number) => ({ c: 1 + L / 2, hw: L % 2 ? 0.5 : 1 });
/**
 * Pier positions (the first and last are the abutments) with none standing in the channel: an interior pier that falls
 * in it, or within `pad` of it, moves to the channel's edge on its own side, so the channel is one clear span, and a pier
 * that would then crowd another (closer than `gap`) or the bank goes. Everything else keeps its place.
 */
function clearOfChannel(piers: number[], L: number, pad: number, gap: number): number[] {
  const { c, hw } = channelOf(L), edge = hw + pad, last = piers.length - 1;
  const moved = piers.map((p, i) => (i > 0 && i < last && Math.abs(p - c) < edge ? { p: p < c ? c - edge : c + edge, fixed: true } : { p, fixed: false }));
  return moved.filter((o, i) => {
    if (i === 0 || i === last) return true;
    if (o.p < 1 + gap || o.p > L + 1 - gap) return false;
    if (o.fixed) return !moved.some((q, j) => j < i && q.fixed && Math.abs(q.p - o.p) < 1e-6);
    return !moved.some((q) => q.fixed && Math.abs(q.p - o.p) < gap);
  }).map((o) => o.p).sort((a, b) => a - b);
}

/** A bascule span's gates: the barrier arms on its approaches and their pairs of warning lights. */
interface Gate { root: Group; booms: [Group, number][]; lights: Mesh[][]; seed: number; phase: number }
const boomMat = new MeshLambertMaterial({ color: 0xf4f4f0 }), stripeMat = new MeshLambertMaterial({ color: 0xc8202a }), postMat = new MeshLambertMaterial({ color: 0x2a2c30 });
const lightOff = new MeshBasicMaterial({ color: 0x3a1010 }), lightOn = new MeshBasicMaterial({ color: 0xff2a1a });
/** hours the arms take to come down or go up */
const ARM_SWING = 0.03;
const ease01 = (t: number) => e01(t);

export class BridgeView {
  group = new Group();
  private meshes = new Map<string, Mesh[]>();
  private mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  private lampMat = lampMaterial();
  private poolMat = poolMaterial();
  private lift = new Map<number, Lift>();
  private liftByChunk = new Map<string, number[]>();
  private gates = new Map<string, Gate[]>();

  constructor(private world: ClientWorld) {}

  /** Rebuild the bridges whose first deck tile is in this chunk (after its tiles or aux bytes change). */
  scanChunk(key: string, chunk: ClientChunk) {
    this.dropChunk(key);
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cy * CHUNK_SIZE;
    let k: Kit | null = null, glow: Glow | null = null;
    const lifts: number[] = [], gates: Gate[] = [];
    for (let i = 0; i < chunk.aux.length; i++) {
      const a = chunk.aux[i];
      if (!isBridgeAux(a) || !isRoad(chunk.tiles[i])) continue;
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      const ns = bridgeNS(a), dx = ns ? 0 : 1, dz = ns ? 1 : 0;
      if (this.world.auxAt(x - dx, z - dz) === a) continue; // not the first deck tile
      let len = 1;
      while (len < BRIDGE_MAX_SPAN * 2 && this.world.auxAt(x + dx * len, z + dz * len) === a) len++;
      k ??= new Kit(); glow ??= new Glow();
      this.span(k, glow, lifts, x, z, len, ns, bridgeStyle(a));
      if (bridgeStyle(a) === BridgeStyle.Bascule) gates.push(this.gate(x, z, len, ns));
    }
    if (lifts.length) this.liftByChunk.set(key, lifts);
    if (gates.length) { this.gates.set(key, gates); for (const g of gates) this.group.add(g.root); }
    if (!k || !glow) return;
    const out: Mesh[] = [];
    const body = new Mesh(k.build(), this.mat);
    body.castShadow = true; body.receiveShadow = true;
    out.push(body);
    if (glow.heads.length) out.push(new Mesh(mergeGeometries(glow.heads, false)!, this.lampMat));
    if (glow.pools.length) { const p = new Mesh(mergeGeometries(glow.pools, false)!, this.poolMat); p.renderOrder = 2; out.push(p); }
    for (const m of out) { m.matrixAutoUpdate = false; this.group.add(m); }
    this.meshes.set(key, out);
  }
  dropChunk(key: string) {
    for (const m of this.meshes.get(key) ?? []) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes.delete(key);
    for (const tk of this.liftByChunk.get(key) ?? []) this.lift.delete(tk);
    this.liftByChunk.delete(key);
    for (const g of this.gates.get(key) ?? []) { this.group.remove(g.root); g.root.traverse((o) => (o as Mesh).geometry?.dispose()); }
    this.gates.delete(key);
  }

  /**
   * Move the bascule gates to game time `hours` (since day 0): the lights flash from just before the barriers close
   * until they open, the arms are down from the moment the server closes the span (BASCULE_CLOSE_BEFORE ahead of the
   * lift) to the moment it opens it again.
   */
  frame(hours: number) {
    for (const gs of this.gates.values()) for (const g of gs) {
      const start = basculeLiftAt(g.seed, hours, BASCULE_CLOSE_BEFORE + ARM_SWING + 0.02, BASCULE_OPEN_AFTER);
      const shut = start - BASCULE_CLOSE_BEFORE, open = start + BASCULE_LIFT + BASCULE_OPEN_AFTER;
      const down = Number.isNaN(start) ? 0 : Math.min(ease01((hours - shut + ARM_SWING) / ARM_SWING), ease01((open - hours) / ARM_SWING));
      for (const [b, dir] of g.booms) b.rotation.x = dir * (Math.PI / 2) * (1 - down);
      const flash = !Number.isNaN(start) && hours < open, tick = Math.floor(hours * 360 + g.phase) & 1;
      for (const pair of g.lights) { pair[0].material = flash && tick ? lightOn : lightOff; pair[1].material = flash && !tick ? lightOn : lightOff; }
    }
  }

  /** The gates of a bascule span from (x, z): a half barrier across the lane coming on at each end, on the right. */
  private gate(x: number, z: number, L: number, ns: boolean): Gate {
    const root = new Group(), H = bridgeDeckH(BridgeStyle.Bascule), O = (ns ? z : x) - 1, across = ns ? x : z;
    if (ns) { root.position.set(across + 0.5, 0, O); root.rotation.y = -Math.PI / 2; } else root.position.set(O, 0, across + 0.5);
    const g: Gate = { root, booms: [], lights: [], seed: basculeSeed(x, z), phase: hash2(x * 3 + 1, z * 5 + 2) * 2 };
    const box = (w: number, h: number, d: number, px: number, py: number, pz: number, m: MeshLambertMaterial | MeshBasicMaterial, parent: Group = root) => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), m); mesh.position.set(px, py, pz); mesh.castShadow = true; parent.add(mesh); return mesh;
    };
    // traffic drives on the right: coming on at the low end (heading +u) it keeps to +w, at the high end to -w
    for (const [u, side, face] of [[1 - 0.05, 1, -1], [L + 1 + 0.05, -1, 1]] as const) {
      const pw = side * 0.47, len = 0.42;
      box(0.025, 0.12, 0.025, u, H + 0.06, pw, postMat);
      const pivot = new Group();
      pivot.position.set(u, H + 0.075, pw);
      box(0.014, 0.014, len, 0, 0, -side * len / 2, boomMat, pivot);
      for (let i = 0; i < 3; i++) box(0.016, 0.016, 0.05, 0, 0, -side * (0.08 + i * 0.13), stripeMat, pivot);
      root.add(pivot);
      g.booms.push([pivot, side]);
      // two lights on a bar facing the traffic coming on
      box(0.012, 0.012, 0.09, u + face * 0.015, H + 0.14, pw - side * 0.02, postMat);
      const pair = [-1, 1].map((q) => box(0.008, 0.024, 0.024, u + face * 0.022, H + 0.14, pw - side * 0.02 + q * 0.035, lightOff));
      g.lights.push(pair);
    }
    return g;
  }

  /**
   * Height of the road a car or walker at (x, z) heading (hx, hz) is on: the deck and its ramps; on a ramp over a
   * landing only when heading along the bridge (anything crossing the landing stays on the ground).
   */
  roadY(x: number, z: number, hx: number, hz: number): number {
    if (!this.lift.size) return 0;
    const l = this.lift.get(tkey(Math.floor(x), Math.floor(z)));
    if (!l) return 0;
    if (l.land && (Math.abs(hz) > Math.abs(hx)) !== l.ns) return 0;
    return liftY(l, (l.ns ? z : x) - l.o);
  }

  /** The road tool's verdict on a drag out over the water (input.ts Crossing) to the bank in line with it, on the loaded chunks; `dev`: a ?dev client on a dev server. */
  crossingPlan(c: Crossing, dev: boolean): { plan: BridgePlan; x: number; y: number; w: number; h: number } {
    const wet = (tx: number, ty: number) => { const t = this.world.getTile(tx, ty); return t !== undefined && terrainOf(t) === Terrain.Water; };
    const [fx, fy] = c.from;
    let n = 0;
    while (n <= BRIDGE_MAX_SPAN && wet(fx + c.dx * (n + 1), fy + c.dy * (n + 1))) n++;
    const bx = fx + c.dx * (n + 1), by = fy + c.dy * (n + 1);
    const me = this.world.myPlayer, pub = dev || (!!me && hasFeature(me.tech, 'publicRoads'));
    const rect = { x: Math.min(fx, bx), y: Math.min(fy, by), w: Math.abs(bx - fx) + 1, h: Math.abs(by - fy) + 1 };
    if (!dev && (!me || !hasFeature(me.tech, 'bridges'))) return { plan: { ok: false, reason: 'Civil engineering is needed to bridge water' }, ...rect };
    const plan = planBridge(fx + c.dx, fy + c.dy, c.dx, c.dy, n, {
      // the banks are road by the time the bridge goes down (the drag lays them first)
      tile: (tx, ty) => { const t = this.world.getTile(tx, ty); return t !== undefined && ((tx === fx && ty === fy) || (tx === bx && ty === by)) && terrainOf(t) !== Terrain.Water ? t | 4 : t; },
      aux: (tx, ty) => this.world.auxAt(tx, ty),
      land: (tx, ty) => { const p = this.world.parcelAt(tx, ty); return p ? (this.world.mayEdit(p.owner) ? null : 'Not your land') : pub ? null : 'Public works is needed to lay roads outside your own land'; },
    });
    return { plan, ...rect };
  }
  /** Status-line text for the road tool's crossing in progress. */
  crossingStatus(c: Crossing, dev: boolean): string {
    const { plan } = this.crossingPlan(c, dev);
    if (!plan.ok) return ` · ${plan.reason}`;
    const n = plan.tiles!.length / 3;
    return n ? ` · ${BRIDGE_STYLE_NAMES[plan.style!]}, ${n} tile${n === 1 ? '' : 's'}, $${plan.cost} · drag on to the far bank` : ' · that bridge is there already';
  }

  // ---- models ----------------------------------------------------------------------------------------

  /** A whole bridge: `len` deck tiles from (x, z) along x (or z when ns). */
  private span(k: Kit, glow: Glow, lifts: number[], x: number, z: number, len: number, ns: boolean, style: BridgeStyleId) {
    const dx = ns ? 0 : 1, dz = ns ? 1 : 0;
    const r = (n: number) => hash2(x * 13 + n * 7, z * 29 - n * 3);
    const H = bridgeDeckH(style), L = len;
    // a landing that is a plain straight road takes the ramp; a junction keeps flat, and the end deck tile ramps instead
    const plain = (lx: number, lz: number) => {
      const t = this.world.getTile(lx, lz);
      if (t === undefined) return true;
      if (!isRoad(t) || this.world.auxAt(lx, lz)) return false;
      const side = (s: number) => { const q = this.world.getTile(lx + dz * s, lz + dx * s); return q !== undefined && isRoad(q); };
      return !side(1) && !side(-1);
    };
    const bascule = style === BridgeStyle.Bascule;
    const lowPlain = bascule || plain(x - dx, z - dz), highPlain = bascule || plain(x + dx * L, z + dz * L);
    const O = (ns ? z : x) - 1, across = ns ? x : z;
    const l: Lift = { ns, o: O, a: lowPlain ? 0 : 1, b: highPlain ? L + 2 : L + 1, h: H, land: false };
    const y = (u: number) => liftY(l, u);
    for (let i = lowPlain ? -1 : 0; i < L + (highPlain ? 1 : 0); i++) {
      const tk = tkey(x + dx * i, z + dz * i);
      this.lift.set(tk, { ...l, land: i < 0 || i >= L }); lifts.push(tk);
    }

    // everything below is in the bridge's own frame: u along it (see Lift), y up, w across (-0.5..0.5, +w to the right of +u)
    const place = (g: BufferGeometry) => (ns ? g.rotateY(-Math.PI / 2).translate(across + 0.5, 0, O) : g.translate(O, 0, across + 0.5));
    const put = (g: BufferGeometry, color: number) => k.part(place(g), color);
    const box = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, color: number) =>
      put(new BoxGeometry(u1 - u0, y1 - y0, w1 - w0).translate((u0 + u1) / 2, (y0 + y1) / 2, (w0 + w1) / 2), color);
    const strut = (a: Vector3, b: Vector3, rad: number, color: number, seg = 4) => {
      const d = b.clone().sub(a), n = d.length();
      if (n < 1e-4) return;
      const g = new CylinderGeometry(rad, rad, n, seg, 1, true).applyQuaternion(new Quaternion().setFromUnitVectors(UP, d.normalize()));
      put(g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), color);
    };
    const geo = (p: number[]) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g; };
    const STEP = 1 / 8;
    const samples = (u0: number, u1: number) => { const n = Math.max(1, Math.round((u1 - u0) / STEP)); return Array.from({ length: n + 1 }, (_, i) => u0 + ((u1 - u0) * i) / n); };
    /** an upright strip at w from lo(u) to hi(u) */
    const ribbon = (u0: number, u1: number, w: number, lo: (u: number) => number, hi: (u: number) => number, color: number) => {
      const s = samples(u0, u1), p: number[] = [];
      for (let i = 0; i + 1 < s.length; i++) { const a = s[i], b = s[i + 1]; p.push(a, lo(a), w, b, lo(b), w, b, hi(b), w, a, lo(a), w, b, hi(b), w, a, hi(a), w); }
      put(geo(p), color);
    };
    /** a flat strip from w0 to w1 at height f(u) */
    const sheet = (u0: number, u1: number, w0: number, w1: number, f: (u: number) => number, color: number) => {
      const s = samples(u0, u1), p: number[] = [];
      for (let i = 0; i + 1 < s.length; i++) { const a = s[i], b = s[i + 1]; p.push(a, f(a), w0, b, f(b), w0, b, f(b), w1, a, f(a), w0, b, f(b), w1, a, f(a), w1); }
      put(geo(p), color);
    };
    const toWorld = (u: number, yy: number, w: number): [number, number, number] => (ns ? [across + 0.5 - w, yy, O + u] : [O + u, yy, across + 0.5 + w]);
    /** a lamp head (world-space glow geometry) at (u, h, w) */
    const head = (g: BufferGeometry, u: number, hh: number, w: number, color: number, on: number) => {
      const [wx, wy, wz] = toWorld(u, hh, w);
      glow.head(g.translate(wx, wy, wz), color, on);
    };
    const lampOn = (n: number) => (r(500 + n) < 0.04 ? 2 : 0.1 + 0.5 * r(600 + n));
    const pool = (u: number, w: number, color: number, on: number, rad = 0.42) => {
      if (on > 1) return;
      const [wx, , wz] = toWorld(u, 0, w * 0.6);
      glow.pool(wx, y(u) + 0.012, wz, rad * (0.85 + 0.3 * hash2(wx * 31, wz * 17)), color, on, 0.6 + 0.5 * hash2(wx * 7 + 3, wz * 13 + 1));
    };

    // ---- the road: surface, pavements, centre line, over the whole lift (only the ramps for a bascule, whose deck is the model's)
    const roadParts: [number, number][] = bascule ? [[0, 1], [L + 1, L + 2]] : [[l.a, l.b]];
    const top = (u: number) => y(u) + 0.004;
    const walk = (u: number) => y(u) + 0.01;
    for (const [u0, u1] of roadParts) {
      sheet(u0, u1, -C, C, top, ASPHALT);
      sheet(u0, u1, C, W, walk, PAVING); sheet(u0, u1, -W, -C, walk, PAVING);
      ribbon(u0, u1, C, top, walk, 0x8e939b); ribbon(u0, u1, -C, top, walk, 0x8e939b); // kerbs
    }
    if (!bascule) for (let u = 1.1; u < L + 0.95; u += 0.33) box(u - 0.06, u + 0.06, top(u), top(u) + 0.003, -0.008, 0.008, 0xf2f2ee);
    // retaining walls under the ramps on land, and the ramp's parapet carries on from the deck's
    const wallTone = style === BridgeStyle.Arch ? STONE[Math.floor(r(1) * STONE.length)] : bascule ? 0xd8d0bf : CONCRETE[Math.floor(r(2) * CONCRETE.length)];
    const landRamps: [number, number][] = [];
    if (lowPlain) landRamps.push([0, 1]);
    if (highPlain) landRamps.push([L + 1, L + 2]);
    for (const [u0, u1] of landRamps) for (const s of [-1, 1]) ribbon(u0, u1, s * W, () => 0, walk, wallTone);

    // ---- by style
    if (style === BridgeStyle.Arch) this.arch(r, L, y, box, put, ribbon, head, pool, lampOn, wallTone, l);
    else if (style === BridgeStyle.Girder) this.girder(r, L, y, box, strut, ribbon, sheet, head, pool, lampOn, l);
    else if (style === BridgeStyle.Suspension) this.suspension(r, L, y, H, box, strut, ribbon, sheet, head, pool, lampOn, l);
    else for (const [u0, u1] of landRamps) for (const s of [-1, 1]) ribbon(u0, u1, s * (W + 0.012), walk, (u) => walk(u) + 0.05, 0xd8d0bf);
  }

  /** Stone arches on cutwater piers, a solid parapet or a balustrade, ornamental lamps over the piers. */
  private arch(
    r: (n: number) => number, L: number, y: (u: number) => number,
    box: (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, c: number) => void,
    put: (g: BufferGeometry, c: number) => void,
    ribbon: (u0: number, u1: number, w: number, lo: (u: number) => number, hi: (u: number) => number, c: number) => void,
    head: (g: BufferGeometry, u: number, h: number, w: number, c: number, on: number) => void,
    pool: (u: number, w: number, c: number, on: number, rad?: number) => void,
    lampOn: (n: number) => number, stone: number, l: Lift,
  ) {
    const iron = IRON[Math.floor(r(3) * IRON.length)];
    const ph = 0.055 + 0.03 * r(5), spring = 0.02 + 0.035 * r(6), flat = 0.55 + 0.4 * r(7); // pier half-width, springing height, how round the arch is
    const n0 = Math.max(1, Math.round(L / (1 + r(4) * 1.2)));
    // no pier in the channel: its arch is the widest, and its crown (never under BRIDGE_CLEARANCE) is where boats pass
    const piers = clearOfChannel(Array.from({ length: n0 + 1 }, (_, i) => 1 + (L * i) / n0), L, ph + 0.1, 0.4);
    const n = piers.length - 1;
    const under = (u: number) => y(u) - 0.004;
    // the spandrel wall the arches are cut from, extruded across the deck: its top follows the road
    const sh = new Shape();
    sh.moveTo(1, -0.03);
    for (let i = 0; i < n; i++) {
      const a = piers[i] + (i === 0 ? 0.02 : ph), b = piers[i + 1] - (i === n - 1 ? 0.02 : ph);
      const mid = (a + b) / 2, half = (b - a) / 2;
      let crown = Infinity;
      for (let u = a; u <= b; u += 0.05) crown = Math.min(crown, y(u) - 0.035);
      const rise = Math.min(crown - spring, half * flat);
      if (rise < 0.02 || half < 0.08) continue;
      sh.lineTo(a, -0.03); sh.lineTo(a, spring);
      for (let k = 1; k < 16; k++) { const t = Math.PI - (Math.PI * k) / 16; sh.lineTo(mid + half * Math.cos(t), spring + rise * Math.sin(t)); }
      sh.lineTo(b, spring); sh.lineTo(b, -0.03);
    }
    sh.lineTo(L + 1, -0.03);
    for (let u = L + 1; u > 1 - 1e-6; u -= 1 / 8) sh.lineTo(u, under(u));
    sh.lineTo(1, under(1));
    put(new ExtrudeGeometry(sh, { depth: 1.0, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -0.5), stone);
    // cutwaters at the piers, and a pilaster over each up to the parapet (a refuge on the pavement) on some bridges
    const pilasters = r(8) < 0.6;
    for (let i = 1; i < n; i++) for (const s of [-1, 1]) {
      const p = piers[i];
      put(new BoxGeometry(ph * 1.5, spring + 0.05, ph * 1.5).rotateY(Math.PI / 4).translate(p, (spring + 0.05) / 2 - 0.03, s * 0.5), stone);
      if (pilasters) box(p - ph, p + ph, spring, y(p) + 0.05, s * 0.5 - 0.03, s * 0.5 + 0.03, stone);
    }
    // parapet: a solid wall with coping, or stone balusters under a rail
    const solid = r(9) < 0.55;
    const parapet = (u0: number, u1: number) => {
      for (const s of [-1, 1]) {
        const w = s * (W + 0.012);
        if (solid) { ribbon(u0, u1, w, (u) => y(u) + 0.01, (u) => y(u) + 0.055, stone); ribbon(u0, u1, w + s * 0.012, (u) => y(u) + 0.05, (u) => y(u) + 0.062, 0xe8e2d4); }
        else {
          ribbon(u0, u1, w, (u) => y(u) + 0.045, (u) => y(u) + 0.058, stone);
          for (let u = u0 + 0.03; u < u1; u += 0.06) box(u - 0.01, u + 0.01, y(u) + 0.01, y(u) + 0.046, w - 0.01, w + 0.01, stone);
        }
      }
    };
    parapet(l.a, l.b);
    // lamps on the piers and the abutments: an iron standard with one lantern or three
    const triple = r(10) < 0.4, warm = r(11) < 0.8 ? WARM : COOL;
    let li = 0;
    for (const p of piers) for (const s of [-1, 1]) {
      const w = s * (W - 0.02), base = y(p) + 0.01, on = lampOn(li++);
      box(p - 0.008, p + 0.008, base, base + 0.13, w - 0.008, w + 0.008, iron);
      if (triple) {
        box(p - 0.03, p + 0.03, base + 0.11, base + 0.118, w - 0.004, w + 0.004, iron);
        for (const o of [-0.03, 0, 0.03]) head(new BoxGeometry(0.02, 0.028, 0.02).translate(0, 0.014, 0), p + o, base + (o ? 0.118 : 0.135), w, warm, on);
      } else head(new BoxGeometry(0.026, 0.034, 0.026).translate(0, 0.017, 0), p, base + 0.13, w, warm, on);
      if (p > 1.2 && p < L + 0.8) pool(p, s * 0.5, warm, on);
    }
  }

  /** Concrete piers under a steel deck: plate girders beneath, or a truss above; steel railings, tall lamps. */
  private girder(
    r: (n: number) => number, L: number, y: (u: number) => number,
    box: (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, c: number) => void,
    strut: (a: Vector3, b: Vector3, rad: number, c: number, seg?: number) => void,
    ribbon: (u0: number, u1: number, w: number, lo: (u: number) => number, hi: (u: number) => number, c: number) => void,
    sheet: (u0: number, u1: number, w0: number, w1: number, f: (u: number) => number, c: number) => void,
    head: (g: BufferGeometry, u: number, h: number, w: number, c: number, on: number) => void,
    pool: (u: number, w: number, c: number, on: number, rad?: number) => void,
    lampOn: (n: number) => number, l: Lift,
  ) {
    const paint = PAINT[Math.floor(r(3) * PAINT.length)], conc = CONCRETE[Math.floor(r(4) * CONCRETE.length)];
    const T = 0.04, gd = Math.min(0.04 + 0.05 * r(5), l.h - T - bridgeClearance(BridgeStyle.Girder)); // the plates stay above the boats' clearance
    const n = Math.max(1, Math.round(L / (2 + 1.5 * r(6))));
    const truss = L >= 3 && r(7) < 0.35;
    // deck slab and its fascia, plate girders under its edges
    sheet(1, L + 1, -0.5, 0.5, (u) => y(u) - T, conc);
    for (const s of [-1, 1]) {
      ribbon(1, L + 1, s * 0.5, (u) => y(u) - T, (u) => y(u) + 0.01, conc);
      if (!truss) ribbon(1, L + 1, s * 0.4, (u) => y(u) - T - gd, (u) => y(u) - T, paint);
    }
    if (!truss) for (const s of [-1, 1]) sheet(1, L + 1, s * 0.38, s * 0.42, (u) => y(u) - T - gd, paint);
    // abutment seats on the banks, piers between: twin columns under a cap beam, or a wall with rounded ends
    for (const u of [1, L + 1]) box(u - 0.05, u + 0.05, -0.03, y(u) - T, -0.5, 0.5, conc);
    const twin = r(8) < 0.6;
    // piers keep out of the channel: the clear span runs between the two nearest, whatever the span
    const piers = clearOfChannel(Array.from({ length: n + 1 }, (_, i) => 1 + (L * i) / n), L, 0.16, 0.5);
    for (const p of piers.slice(1, -1)) {
      const capY = y(p) - T - (truss ? 0 : gd);
      if (twin) {
        for (const w of [-0.3, 0.3]) strut(new Vector3(p, -0.03, w), new Vector3(p, capY - 0.04, w), 0.055, conc, 8);
        box(p - 0.06, p + 0.06, capY - 0.05, capY, -0.5, 0.5, conc);
      } else {
        box(p - 0.06, p + 0.06, -0.03, capY, -0.38, 0.38, conc);
        for (const w of [-0.38, 0.38]) strut(new Vector3(p, -0.03, w), new Vector3(p, capY, w), 0.06, conc, 8);
      }
    }
    // the railing: posts and a top rail, painted; with a truss, the truss is the side and the railing sits inside it
    const rw = W + 0.008;
    for (const s of [-1, 1]) {
      ribbon(l.a, l.b, s * rw, (u) => y(u) + 0.04, (u) => y(u) + 0.05, paint);
      for (let u = l.a + 0.05; u < l.b; u += 0.125) box(u - 0.005, u + 0.005, y(u) + 0.01, y(u) + 0.045, s * rw - 0.005, s * rw + 0.005, paint);
    }
    if (truss) {
      // a Warren truss each side: chords, end posts and diagonals
      const th = 0.16 + 0.06 * r(9), pn = Math.max(3, Math.round(L / 0.33));
      for (const s of [-1, 1]) {
        const w = s * 0.5, P = (u: number, up: number) => new Vector3(u, y(u) + up, w);
        const u0 = 1.04, u1 = L + 0.96;
        for (let i = 0; i < pn; i++) {
          const a = u0 + ((u1 - u0) * i) / pn, b = u0 + ((u1 - u0) * (i + 1)) / pn, m = (a + b) / 2;
          strut(P(a, 0), P(b, 0), 0.012, paint);
          strut(P(a, 0), P(m, th), 0.009, paint); strut(P(m, th), P(b, 0), 0.009, paint);
          if (i + 1 < pn) strut(P(m, th), P(m + (b - a), th), 0.014, paint);
        }
        strut(P(u0, 0), P(u0 + (u1 - u0) / (2 * pn), th), 0.014, paint);
      }
      // portal bracing over the road at intervals
      for (let i = 0; i < pn; i += 2) { const m = 1.04 + ((L - 0.08) * (i + 0.5)) / pn; box(m - 0.008, m + 0.008, y(m) + th - 0.012, y(m) + th, -0.5, 0.5, paint); }
    }
    // tall lamps on outreach arms, along one side or both, staggered
    const both = r(10) < 0.5, gap = 0.75 + 0.5 * r(11), cool = r(12) < 0.7 ? COOL : WARM;
    let li = 0;
    for (let u = 1 + gap / 2; u < L + 1; u += gap, li++) {
      const s = both ? (li % 2 ? 1 : -1) : 1, w = s * (W - 0.015), base = y(u) + 0.01, on = lampOn(li);
      box(u - 0.006, u + 0.006, base, base + 0.2, w - 0.006, w + 0.006, 0x6a6e75);
      box(u - 0.005, u + 0.005, base + 0.195, base + 0.203, Math.min(w, w - s * 0.09), Math.max(w, w - s * 0.09), 0x6a6e75);
      head(new BoxGeometry(0.04, 0.012, 0.024).translate(0, -0.006, 0), u, base + 0.198, w - s * 0.09, cool, on);
      pool(u, s * 0.6, cool, on);
    }
  }

  /** Two towers, main cables in a curve between them and back-stays to the ends, hangers down to a slim deck. */
  private suspension(
    r: (n: number) => number, L: number, y: (u: number) => number, H: number,
    box: (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, c: number) => void,
    strut: (a: Vector3, b: Vector3, rad: number, c: number, seg?: number) => void,
    ribbon: (u0: number, u1: number, w: number, lo: (u: number) => number, hi: (u: number) => number, c: number) => void,
    sheet: (u0: number, u1: number, w0: number, w1: number, f: (u: number) => number, c: number) => void,
    head: (g: BufferGeometry, u: number, h: number, w: number, c: number, on: number) => void,
    pool: (u: number, w: number, c: number, on: number, rad?: number) => void,
    lampOn: (n: number) => number, l: Lift,
  ) {
    const tower = TOWER[Math.floor(r(3) * TOWER.length)], deckPaint = PAINT[Math.floor(r(4) * PAINT.length)];
    const cable = r(5) < 0.5 ? 0x5a5e66 : tower;
    const T = 0.035;
    const inset = L >= 4 ? Math.max(0.6, L * (0.18 + 0.08 * r(6))) : 0.3;
    // the towers' caissons (±0.12) keep out of the channel; on a span too short to, they sit at the banks and stand on their legs alone
    const { c, hw } = channelOf(L), room = c - hw - 0.17;
    const t1 = Math.max(1.13, Math.min(1 + inset, room)), t2 = 2 * c - t1;
    const blocks = t1 + 0.12 > c - hw;
    const Ht = Math.min(1.3, Math.max(0.5, 0.42 + 0.075 * L)) * (0.9 + 0.2 * r(7));
    // the deck: a slab with a stiffening girder along each edge
    sheet(1, L + 1, -0.5, 0.5, (u) => y(u) - T, deckPaint);
    for (const s of [-1, 1]) ribbon(1, L + 1, s * 0.5, (u) => y(u) - T - 0.03, (u) => y(u) + 0.012, deckPaint);
    for (const u of [1, L + 1]) box(u - 0.05, u + 0.05, -0.03, y(u) - T, -0.5, 0.5, CONCRETE[0]);
    // towers: a caisson in the river, two legs and their cross-beams, a warning light on top
    const legW = 0.05 + 0.02 * r(8), cw = 0.56;
    let li = 0;
    for (const t of [t1, t2]) {
      if (!blocks) box(t - 0.12, t + 0.12, -0.03, 0.05, -0.68, 0.68, CONCRETE[1]);
      for (const s of [-1, 1]) {
        if (blocks) box(t - 0.1, t + 0.1, -0.03, 0.05, s * cw - 0.1, s * cw + 0.1, CONCRETE[1]);
        box(t - legW, t + legW, 0.05, H + Ht, s * cw - legW, s * cw + legW, tower);
        box(t - legW * 0.8, t + legW * 0.8, H + Ht, H + Ht + 0.03, s * cw - legW * 0.8, s * cw + legW * 0.8, tower);
        head(new BoxGeometry(0.03, 0.03, 0.03).translate(0, 0.015, 0), t, H + Ht + 0.03, s * cw, 0xff3a2a, li % 2 ? 0.05 : 0.08); // aircraft warning light
        li++;
      }
      for (const yy of [H - 0.07, H + Ht * 0.55, H + Ht - 0.05]) box(t - legW * 0.9, t + legW * 0.9, yy, yy + 0.05, -cw, cw, tower);
      if (r(9) < 0.5) for (const s of [-1, 1]) strut(new Vector3(t, H + 0.04, s * cw), new Vector3(t, H + Ht * 0.55, -s * cw), 0.012, tower); // cross-bracing
    }
    // main cables: back-stays from the deck ends up to the tower tops, a curve between the towers down nearly to the deck
    const sag = 0.06 + 0.04 * r(10);
    const cableY = (u: number) => {
      if (u <= t1) return y(1) + 0.04 + (H + Ht - y(1) - 0.04) * ((u - 1) / (t1 - 1 || 1));
      if (u >= t2) return y(L + 1) + 0.04 + (H + Ht - y(L + 1) - 0.04) * ((L + 1 - u) / (L + 1 - t2 || 1));
      const m = (t1 + t2) / 2, q = (u - m) / ((t2 - t1) / 2);
      return H + sag + (Ht - sag) * q * q;
    };
    for (const s of [-1, 1]) {
      const w = s * (cw - 0.02);
      const pts: number[] = [1, t1];
      for (let i = 1; i < 16; i++) pts.push(t1 + ((t2 - t1) * i) / 16);
      pts.push(t2, L + 1);
      for (let i = 0; i + 1 < pts.length; i++) strut(new Vector3(pts[i], cableY(pts[i]), w), new Vector3(pts[i + 1], cableY(pts[i + 1]), w), 0.011, cable);
      // hangers every fifth of a tile, from the cable down to the deck edge
      for (let u = 1.1; u < L + 0.95; u += 0.2) {
        if (Math.abs(u - t1) < 0.06 || Math.abs(u - t2) < 0.06) continue;
        const top = cableY(u);
        if (top - y(u) > 0.03) box(u - 0.003, u + 0.003, y(u), top, w - 0.003, w + 0.003, cable);
      }
    }
    // railing inside the cables, and slim lamps along the deck
    for (const s of [-1, 1]) {
      const rw = s * (W + 0.006);
      ribbon(l.a, l.b, rw, (u) => y(u) + 0.035, (u) => y(u) + 0.045, 0x6a6e75);
      for (let u = l.a + 0.05; u < l.b; u += 0.125) box(u - 0.004, u + 0.004, y(u) + 0.01, y(u) + 0.04, rw - 0.004, rw + 0.004, 0x6a6e75);
    }
    const gap = 0.6 + 0.4 * r(11), cool = r(12) < 0.6 ? COOL : WARM;
    for (let u = 1 + gap / 2; u < L + 1; u += gap, li++) for (const s of [-1, 1]) {
      const w = s * (W - 0.02), base = y(u) + 0.01, on = lampOn(li * 2 + (s > 0 ? 1 : 0));
      box(u - 0.005, u + 0.005, base, base + 0.15, w - 0.005, w + 0.005, 0x6a6e75);
      head(new BoxGeometry(0.02, 0.026, 0.02).translate(0, 0.013, 0), u, base + 0.15, w, cool, on);
      pool(u, s * 0.5, cool, on, 0.34);
    }
  }
}
