import { InstancedMesh, PlaneGeometry, ShaderMaterial, InstancedBufferAttribute, DynamicDrawUsage, StaticDrawUsage, AdditiveBlending, UniformsUtils, UniformsLib, Group, Matrix4, Quaternion, Vector3, Color } from 'three';
import {
  CHUNK_SIZE, MANIFEST, PALETTE, isRoad, zoneOf, levelOf, underConstruction, hash2, kindIdOf, leisureAt, isLeisure, openJitter, eventOn, eventStartAt,
  isPartAux, isAnchorAux, isMultiTile, placedFromAnchor, auxOrientation, type Attributes, type CompiledOp, type LeisureSpec,
} from '@msimcity/shared';
import { RECIPES } from '@msimcity/shared/src/buildings/recipes';
import type { ClientChunk } from '../world';
import { variant, type Design } from './models';
import { sceneUniforms } from './materials';

/**
 * Leisure venues and nightlife after dark, drawn as light rather than lights: a halo on every lamp, bulb and sign
 * of the design (its marquee-coloured parts and thin venue-lit panels), a warm pool on the pavement at the door,
 * floodlit pitches and pools at sports grounds, and lamp pools along park paths. Two instanced meshes (halos and
 * ground pools), additive, no three.js lights.
 *
 * Brightness follows each place's own schedule as the server keeps it (shared/src/leisure.ts: opening hours with
 * the per-place jitter, event nights and their start), so a cinema's marquee blazes until midnight and drops to a
 * night glow when it shuts, a sports ground floodlights its match nights and some training evenings, and a pub's
 * door spills light till closing. Nothing switches in lockstep: every place switches on at its own darkness, warms
 * up and winds down over its own time after closing, every floodlight mast strikes up on its own delay, and a few
 * signs chase, flicker or stay dark.
 */

const MAX_HALOS = 12000, MAX_POOLS = 6000;
const UP = new Vector3(0, 1, 0);
const MARQUEE = PALETTE.marquee, DOOR = PALETTE.door;
const LAWNS = new Set<number>([PALETTE.lawn, PALETTE.lawnDark, PALETTE.court, PALETTE.pond]);
const VENUE_WIN = 6;
/** commerce that keeps going after dark (shared/src/buildings commerceType) */
const NIGHTLIFE = new Set(['pub', 'restaurant', 'hotel', 'bar', 'club']);

/** What a light is for: decides how it follows the schedule (an index into Place.level). */
const Role = { Sign: 0, Flood: 1, Door: 2, Path: 3, Pitch: 4 } as const;
/** Halo animation: steady, chasing bulbs, a sputtering tube. */
const Anim = { Steady: 0, Chase: 1, Sputter: 2 } as const;

interface Light { role: number; color: Color; gain: number; seed: number }
export interface Place {
  /** world tile seeding the schedule (the anchor for structures) */
  x: number; z: number;
  seed: number;
  open: number; close: number;
  /** leisure places: events and their start; nightlife has none */
  spec?: LeisureSpec;
  sports: boolean;
  halos: Light[]; pools: Light[];
  /** instance ranges, set when the meshes are filled */
  h0: number; p0: number;
  /** smoothed brightness per role, so changes fade instead of popping */
  level: number[];
}
interface Built { places: Place[]; halo: { m: Matrix4; anim: number; seed: number }[]; pool: { m: Matrix4; shape: number; seed: number }[] }

const recipeOps = new Map<string, CompiledOp[]>(RECIPES.map((r) => [r.key, r.ops]));
const attrsOf = new Map<string, Attributes>();
for (const k of MANIFEST) for (const l of k.levels) for (const d of l.designs) attrsOf.set(`${k.kindId}:${l.level}:${d.index}`, d.attrs);

const HALO_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aCol;
attribute vec2 aAnim;
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = uv - 0.5;
  float on = aCol.a;
  if (aAnim.y > 0.5 && aAnim.y < 1.5) on *= 0.55 + 0.45 * step(0.0, sin(uTime * 7.0 - aAnim.x * 40.0));
  else if (aAnim.y > 1.5) on *= 0.25 + 0.75 * step(0.35, fract(sin(floor(uTime * 11.0) + aAnim.x * 91.0) * 4375.85));
  vCol = vec4(aCol.rgb, on);
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = length(instanceMatrix[0].xyz);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const HALO_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
#include <common>
#include <fog_pars_fragment>
void main() {
  float r2 = dot(vUv, vUv) * 4.0;
  float g = exp(-r2 * 5.0) * 0.9 + exp(-r2 * 40.0) * 1.6; // soft bloom and a hot core
  vec3 c = vCol.rgb * vCol.a * g * (1.0 - smoothstep(0.7, 1.0, r2));
  if (max(c.r, max(c.g, c.b)) < 0.002) discard;
  #ifdef USE_FOG
    c *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const POOL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aCol;
attribute vec2 aShape;
varying vec2 vUv;
varying vec4 vCol;
varying vec2 vShape;
void main() {
  vUv = uv - 0.5; vCol = aCol; vShape = aShape;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const POOL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
varying vec2 vShape;
#include <common>
#include <fog_pars_fragment>
void main() {
  float k;
  if (vShape.y < 0.5) { float r = length(vUv) * 2.0; k = pow(1.0 - smoothstep(0.0, 1.0, r), 1.6); }  // a round pool
  else {                                                                                          // a floodlit pitch
    vec2 q = abs(vUv) * 2.0;
    k = (1.0 - smoothstep(0.72, 1.0, q.x)) * (1.0 - smoothstep(0.72, 1.0, q.y));
    k *= 0.85 + 0.15 * cos(vUv.x * 9.0 + vShape.x * 6.0) * cos(vUv.y * 7.0); // overlapping beams, a little uneven
  }
  vec3 c = vCol.rgb * vCol.a * k;
  if (max(c.r, max(c.g, c.b)) < 0.002) discard;
  #ifdef USE_FOG
    c *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function additive(vert: string, frag: string, offset: boolean) {
  const m = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: vert, fragmentShader: frag,
    transparent: true, depthWrite: false, blending: AdditiveBlending, fog: true,
    polygonOffset: offset, polygonOffsetFactor: offset ? -1 : 0, polygonOffsetUnits: offset ? -4 : 0,
  });
  m.uniforms.uTime = sceneUniforms.uTime;
  return m;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const WARM = new Color(1.0, 0.78, 0.5), BULB = new Color(1.0, 0.86, 0.6), HALIDE = new Color(0.85, 0.93, 1.0), PATH = new Color(1.0, 0.76, 0.45);
/** facade glow by venue type and by kind of business */
const TINT: Record<string, Color> = {
  cinema: new Color(1.0, 0.72, 0.78), theatre: new Color(1.0, 0.8, 0.52), sports: HALIDE, library: new Color(1.0, 0.86, 0.68),
  pub: new Color(1.0, 0.68, 0.38), restaurant: WARM, hotel: new Color(1.0, 0.86, 0.66),
};
const tq = new Quaternion(), tp = new Vector3(), ts = new Vector3(), tl = new Vector3();

/** Lights of every venue and late-opening business in the loaded chunks. */
export class VenueLights {
  group = new Group();
  private halos: InstancedMesh; private pools: InstancedMesh;
  private haloCol: InstancedBufferAttribute; private poolCol: InstancedBufferAttribute;
  private haloAnim: InstancedBufferAttribute; private poolShape: InstancedBufferAttribute;
  private perChunk = new Map<string, Built>();
  private places: Place[] = [];
  private dirty = false;
  private last = -1;
  private scratch = [0, 0, 0, 0, 0];

  constructor() {
    const quad = () => new PlaneGeometry(1, 1);
    const hg = quad(), pg = quad().rotateX(-Math.PI / 2);
    this.haloCol = new InstancedBufferAttribute(new Float32Array(MAX_HALOS * 4), 4).setUsage(DynamicDrawUsage);
    this.haloAnim = new InstancedBufferAttribute(new Float32Array(MAX_HALOS * 2), 2).setUsage(StaticDrawUsage);
    this.poolCol = new InstancedBufferAttribute(new Float32Array(MAX_POOLS * 4), 4).setUsage(DynamicDrawUsage);
    this.poolShape = new InstancedBufferAttribute(new Float32Array(MAX_POOLS * 2), 2).setUsage(StaticDrawUsage);
    hg.setAttribute('aCol', this.haloCol); hg.setAttribute('aAnim', this.haloAnim);
    pg.setAttribute('aCol', this.poolCol); pg.setAttribute('aShape', this.poolShape);
    this.halos = new InstancedMesh(hg, additive(HALO_VERT, HALO_FRAG, false), MAX_HALOS);
    this.pools = new InstancedMesh(pg, additive(POOL_VERT, POOL_FRAG, true), MAX_POOLS);
    for (const m of [this.halos, this.pools]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 1; this.group.add(m); }
    this.halos.name = 'venue-halos'; this.pools.name = 'venue-pools';
  }

  /** Re-read a chunk's venues (after its tiles change). */
  scanChunk(key: string, chunk: ClientChunk, getTile: (x: number, y: number) => number | undefined) {
    const out: Built = { places: [], halo: [], pool: [] };
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cy * CHUNK_SIZE;
    const roadAt = (x: number, z: number) => { const t = getTile(x, z); return t === undefined ? true : isRoad(t); };
    for (let i = 0; i < chunk.tiles.length; i++) {
      const t = chunk.tiles[i];
      if (isRoad(t) || underConstruction(t)) continue;
      const level = levelOf(t);
      if (!level) continue;
      const kind = kindIdOf(zoneOf(t), chunk.sub[i]);
      if (!kind) continue;
      const a = chunk.aux[i];
      if (a && isPartAux(a)) continue;
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      const pick = hash2(x * 13 + 5, z * 17 + 11);
      const v = variant(kind, level, pick) as Design | undefined;
      if (!v) continue;
      const attrs = attrsOf.get(v.key) ?? {};
      const sp = isLeisure(kind) ? leisureAt(kind, level, x, z) : undefined;
      const commerce = typeof attrs.commerceType === 'string' ? attrs.commerceType : '';
      if (!sp && !NIGHTLIFE.has(commerce)) continue;
      // placement exactly as chunkView draws the model
      let cx: number, cz: number, yaw: number, s: number;
      if (a && isAnchorAux(a) && isMultiTile(kind)) {
        const p = placedFromAnchor(kind, x, z, auxOrientation(a));
        cx = p.ax + p.w / 2; cz = p.ay + p.h / 2; yaw = (p.r * Math.PI) / 2; s = 1;
      } else {
        const h = hash2(x, z);
        if (roadAt(x, z + 1) && getTile(x, z + 1) !== undefined) yaw = 0;
        else if (roadAt(x + 1, z) && getTile(x + 1, z) !== undefined) yaw = Math.PI / 2;
        else if (roadAt(x - 1, z) && getTile(x - 1, z) !== undefined) yaw = -Math.PI / 2;
        else if (roadAt(x, z - 1) && getTile(x, z - 1) !== undefined) yaw = Math.PI;
        else yaw = Math.floor(h * 4) * (Math.PI / 2);
        cx = x + 0.5; cz = z + 0.5; s = 0.95 + 0.1 * hash2(z * 3 + 1, x * 5 + 7);
      }
      const hours = sp ? [sp.open, sp.close] : Array.isArray(attrs.openHours) ? (attrs.openHours as number[]) : [11, 24];
      const seed = hash2(x * 31 + 7, z * 19 + 3);
      const place: Place = {
        x, z, seed, open: hours[0], close: hours[1], spec: sp,
        sports: sp?.type === 'sports', halos: [], pools: [], h0: 0, p0: 0, level: [0, 0, 0, 0, 0],
      };
      const world = (lx: number, ly: number, lz: number) => tl.set(lx * s, ly * s, lz * s).applyAxisAngle(UP, yaw).add(tp.set(cx, 0, cz));
      const halo = (lx: number, ly: number, lz: number, size: number, role: number, color: Color, gain: number, anim: number, k: number) => {
        const w = world(lx, ly, lz);
        out.halo.push({ m: new Matrix4().compose(w, tq.identity(), ts.setScalar(size * s)), anim, seed: hash2(seed * 977 + k, k * 13 + 1) });
        place.halos.push({ role, color, gain, seed: hash2(k * 7 + 3, seed * 431) });
      };
      const pool = (lx: number, ly: number, lz: number, w: number, d: number, shape: number, role: number, color: Color, gain: number, k: number) => {
        const p = world(lx, ly, lz);
        tq.setFromAxisAngle(UP, yaw);
        out.pool.push({ m: new Matrix4().compose(p, tq, ts.set(w * s, 1, d * s)), shape, seed: hash2(k * 5 + 1, seed * 211) });
        place.pools.push({ role, color, gain, seed: hash2(k * 11 + 2, seed * 173) });
      };
      const ops = recipeOps.get(v.key) ?? [];
      const signAnim = (k: number) => { const r = hash2(seed * 53 + k, 17); return r < 0.06 ? Anim.Sputter : Anim.Steady; };
      const chase = hash2(seed * 3, 41) < 0.5 ? Anim.Chase : Anim.Steady; // some marquees chase
      let k = 0;
      // pitch: the extent of flat lawn, court or pool parts, for the floodlights
      let pMinX = Infinity, pMaxX = -Infinity, pMinZ = Infinity, pMaxZ = -Infinity, pTop = 0, highest = 0;
      // the front of the main building (the windowed part nearest the road), for the facade glow and the forecourt
      let front = -Infinity, fx = 0, fw = 0, fh = 0;
      for (const op of ops) {
        if (op[0] === 'box') {
          const [, w, h, d, ox, oy, oz, color, win] = op;
          highest = Math.max(highest, oy + h);
          if (win && oy < 0.1 && h > 0.15 && (oz + d / 2 > front + 0.02 || (oz + d / 2 > front - 0.02 && w > fw))) { front = oz + d / 2; fx = ox; fw = w; fh = oy + h; }
          if (color === MARQUEE) {
            // bulbs or a lamp bank: a row of halos along the long side
            const along = w >= d, len = Math.max(w, d), n = Math.max(1, Math.min(8, Math.round(len / 0.14)));
            const flood = place.sports && oy > 0.5;
            for (let j = 0; j < n; j++) {
              const f = (j + 0.5) / n - 0.5;
              const lx = ox + (along ? f * w : 0), lz = oz + (along ? 0 : f * d) + (along ? d / 2 : 0) * 0.5;
              if (flood) halo(lx, oy + h / 2, lz, 0.42, Role.Flood, HALIDE, 1.6, Anim.Steady, k++);
              else halo(lx, oy + h / 2, lz, Math.min(0.16, 0.06 + h * 0.8), Role.Sign, BULB, 1.1, n > 2 ? chase : signAnim(k), k++);
            }
          } else if (win === VENUE_WIN && Math.min(w, h, d) <= 0.06 && Math.max(w, d) <= 1.0 && h >= 0.03) {
            // a lit sign or screen: a halo in its own colour
            const c = new Color(color);
            const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl); c.setHSL(hsl.h, Math.min(1, hsl.s * 1.2 + 0.2), 0.6);
            halo(ox, oy + h / 2, oz + (w >= d ? d : 0), Math.min(0.32, 0.1 + Math.max(w, h) * 0.4), Role.Sign, c, 0.9, signAnim(k), k++);
          } else if (color === DOOR && oy < 0.05 && h > 0.08) {
            // the entrance: a lantern over it and light spilling onto the pavement
            halo(ox, oy + h + 0.03, oz + 0.03, 0.1, Role.Door, WARM, 0.9, Anim.Steady, k++);
            pool(ox, 0.025, oz + 0.16, 0.55, 0.45, 0, Role.Door, WARM, 0.55, k++);
          } else if (place.sports && LAWNS.has(color) && h <= 0.05 && w * d > 0.08) {
            pMinX = Math.min(pMinX, ox - w / 2); pMaxX = Math.max(pMaxX, ox + w / 2);
            pMinZ = Math.min(pMinZ, oz - d / 2); pMaxZ = Math.max(pMaxZ, oz + d / 2);
            pTop = Math.max(pTop, oy + h);
          }
        } else if (op[0] === 'cyl') {
          const [, rTop, rBot, h, ox, oy, oz, color] = op;
          highest = Math.max(highest, oy + h);
          const r = Math.max(rTop, rBot);
          if (color === MARQUEE) {
            // a ring of lights (an arena's crown) or a round lamp
            const n = r > 0.3 ? Math.min(24, Math.round((2 * Math.PI * r) / 0.22)) : 1;
            for (let j = 0; j < n; j++) {
              const an = (j / n) * Math.PI * 2;
              halo(ox + (n > 1 ? Math.cos(an) * r : 0), oy + h / 2, oz + (n > 1 ? Math.sin(an) * r : 0), n > 1 ? 0.22 : 0.12, Role.Sign, BULB, 1, Anim.Steady, k++);
            }
          } else if (place.sports && LAWNS.has(color) && h <= 0.05 && r > 0.3) {
            pMinX = Math.min(pMinX, ox - r); pMaxX = Math.max(pMaxX, ox + r);
            pMinZ = Math.min(pMinZ, oz - r); pMaxZ = Math.max(pMaxZ, oz + r);
            pTop = Math.max(pTop, oy + h);
          }
        }
      }
      if (pMaxX > pMinX) {
        const w = pMaxX - pMinX, d = pMaxZ - pMinZ;
        pool((pMinX + pMaxX) / 2, pTop + 0.006, (pMinZ + pMaxZ) / 2, w * 1.1, d * 1.1, 1, Role.Pitch, HALIDE, 0.55, k++);
        // a small court with no lamp bank of its own still gets mast-top glows at its corners
        if (!place.halos.some((l) => l.role === Role.Flood)) {
          for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) halo((pMinX + pMaxX) / 2 + fx * w * 0.52, Math.max(0.5, highest * 0.9), (pMinZ + pMaxZ) / 2 + fz * d * 0.52, 0.3, Role.Flood, HALIDE, 1.2, Anim.Steady, k++);
        }
      }
      // the building lit up while it is open: a soft glow over its front and light across the forecourt
      if (sp?.type !== 'park' && front > -Infinity) {
        const tint = TINT[sp?.type ?? commerce] ?? WARM;
        halo(fx, fh * 0.45, front + 0.12, Math.min(2.2, fw * 1.3 + 0.3), Role.Sign, tint, 0.38, Anim.Steady, k++);
        pool(fx, 0.025, front + 0.3, fw * 1.1, 0.7, 0, Role.Door, tint, 0.8, k++);
      }
      // parks: lamp pools along the paths, more in bigger parks
      if (sp?.type === 'park') {
        const n = Math.round((isMultiTile(kind) ? 6 : 2) + 2 * hash2(seed * 9, 5));
        const span = isMultiTile(kind) ? 1.2 : 0.38;
        for (let j = 0; j < n; j++) {
          const lx = (hash2(seed * 101 + j, 7) - 0.5) * 2 * span, lz = (hash2(seed * 103 + j, 11) - 0.5) * 2 * span;
          pool(lx, 0.03, lz, 0.5, 0.5, 0, Role.Path, PATH, 0.4, k++);
          halo(lx, 0.16, lz, 0.08, Role.Path, PATH, 0.8, Anim.Steady, k++);
        }
      }
      if (place.halos.length || place.pools.length) out.places.push(place);
    }
    if (out.places.length) this.perChunk.set(key, out);
    else if (!this.perChunk.delete(key)) return;
    this.dirty = true;
  }
  dropChunk(key: string) { if (this.perChunk.delete(key)) this.dirty = true; }

  private fill() {
    this.places = [];
    let nh = 0, np = 0;
    for (const b of this.perChunk.values()) {
      if (nh + b.halo.length > MAX_HALOS || np + b.pool.length > MAX_POOLS) continue;
      let hi = nh, pi = np;
      for (const p of b.places) { p.h0 = hi; p.p0 = pi; hi += p.halos.length; pi += p.pools.length; this.places.push(p); }
      for (const h of b.halo) { this.halos.setMatrixAt(nh, h.m); this.haloAnim.setXY(nh, h.seed, h.anim); nh++; }
      for (const p of b.pool) { this.pools.setMatrixAt(np, p.m); this.poolShape.setXY(np, p.seed, p.shape); np++; }
    }
    this.halos.count = nh; this.pools.count = np;
    for (const m of [this.halos, this.pools]) m.instanceMatrix.needsUpdate = true;
    this.haloAnim.needsUpdate = true; this.poolShape.needsUpdate = true;
  }

  /** `day` is the game day, for event nights. */
  frame(day: number) {
    if (this.dirty) { this.dirty = false; this.fill(); this.last = -1; }
    const night = sceneUniforms.uNight.value, hour = sceneUniforms.uHour.value;
    const lit = night > 0.02 && this.places.length > 0;
    this.group.visible = lit;
    if (!lit) return;
    const now = performance.now();
    const dt = this.last < 0 ? 1 : Math.min(1, (now - this.last) / 1000);
    this.last = now;
    for (const p of this.places) {
      const target = venueLevels(p, hour, night, day, this.scratch);
      for (let r = 0; r < 5; r++) p.level[r] += (target[r] - p.level[r]) * Math.min(1, dt * 1.5);
      for (let j = 0; j < p.halos.length; j++) this.write(this.haloCol, p.h0 + j, p.halos[j], p.level, hour);
      for (let j = 0; j < p.pools.length; j++) this.write(this.poolCol, p.p0 + j, p.pools[j], p.level, hour);
    }
    this.haloCol.needsUpdate = true; this.poolCol.needsUpdate = true;
  }

  private write(attr: InstancedBufferAttribute, i: number, l: Light, level: number[], hour: number) {
    let v = level[l.role] * l.gain;
    // floodlight masts strike up one by one, each warming over a few minutes
    if (l.role === Role.Flood || l.role === Role.Pitch) v *= 0.35 + 0.65 * smooth(0, 0.15 + 0.2 * l.seed, level[l.role] - 0.1 * l.seed);
    // a few lamps and sign letters are simply out
    if (l.seed < 0.04 && l.role !== Role.Pitch) v *= hour > 12 ? 0 : 0.2;
    attr.setXYZW(i, l.color.r, l.color.g, l.color.b, v * (0.85 + 0.3 * l.seed));
  }
}

/** Brightness per role (Role order) for a place at this moment, from its schedule; `night` is uNight, `day` the game day. */
export function venueLevels(p: Place, hour: number, night: number, day: number, out = [0, 0, 0, 0, 0]): number[] {
  const j = openJitter(p.x, p.z);
  const dark = smooth(0.1 + 0.4 * p.seed, 0.2 + 0.4 * p.seed, night);
  // open, with lights coming up a little before opening and lingering a while after closing
  const t = hour < 6 ? hour + 24 : hour;
  const open = p.open + j, close = p.close + (p.close >= 24 ? 0.1 * j : j);
  const linger = 0.25 + 0.6 * hash2(p.x + 5, p.z + day);
  const allDay = p.close - p.open >= 24;
  const on = allDay ? 1 : smooth(open - 0.3, open, t) * (1 - smooth(close, close + linger, t));
  // event night: the evening's show or match, from shortly before it starts to when the crowd has gone
  let ev = 0;
  if (p.spec && eventOn(p.spec, t >= 24 ? day - 1 : day)) {
    const st = eventStartAt(p.spec, p.x, p.z), len = p.spec.stayMax + 0.5;
    ev = smooth(st - 1.2, st - 0.6, t) * (1 - smooth(st + len, st + len + 0.5, t));
  }
  // sports grounds without a match: floodlit for training on some evenings only
  const training = p.sports && hash2(p.x * 3 + day * 17, p.z * 7 + 1) < 0.5 ? 0.65 : 0;
  out[Role.Sign] = dark * Math.max(on * (0.85 + 0.35 * ev), p.seed < 0.35 ? 0.12 : 0); // a night glow on some after closing
  out[Role.Flood] = out[Role.Pitch] = dark * Math.max(ev, on * training);
  out[Role.Door] = dark * Math.max(on, 0.06);
  out[Role.Path] = dark * (0.35 + 0.65 * on);
  return out;
}
