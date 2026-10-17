import { DoubleSide, Group, Mesh, MeshLambertMaterial, BufferGeometry, Float32BufferAttribute, Shape, ExtrudeGeometry, IcosahedronGeometry, ConeGeometry, CylinderGeometry, BoxGeometry, Color } from 'three';
import {
  CHUNK_SIZE, hash2, isRoad, hasFeature, isIslandAux, isFlyoverAux, deckEW, RING_POS, FLYOVER_DECK_H, FLYOVER_EW, FLYOVER_NS,
  planRoundabout, planFlyover, type JunctionEnv, type PlaceVerdict,
} from '@msimcity/shared';
import type { ClientChunk, ClientWorld } from '../world';
import { Kit } from './kit';
import { RING_ISLAND } from './atlas';

/**
 * Roundabouts and flyovers (shared/src/junctions.ts) above the ground: the planted island of each roundabout with
 * its kerb, chevron boards facing the ways in and give-way signs at them; each flyover's deck, its parapets and the
 * ramps up to it on the tiles either side. The ground cells (ring paint, the road beneath a deck) are chunkView's.
 * One merged mesh per chunk. Every island is planted from its own hash (a tree, flower beds, a monument or a
 * meadow, each scattered and sized differently), and decks vary in concrete tone and parapet, so no two repeat.
 * `roadY` lifts cars on a deck and its ramps to the surface they drive on.
 */
const H = FLYOVER_DECK_H;
/** the ramp profile: 0 at the far edge of a ramp tile, 1 where it meets the deck, easing in and out */
const ease = (t: number) => t * t * (3 - 2 * t);
/** a deck or ramp is the whole road, sidewalks too (walkers on it are lifted like cars); its carriageway is 0.75 wide as on a road cell */
const DECK_HALF = 0.49, CARRIAGE_HALF = 0.375;
const PAVING = 0x9a9ea5;
const GRASS = [0x5f9a4b, 0x6aa84f, 0x58904a, 0x73a85a];
const SHRUB = [0x3f7a3a, 0x4f8a3e, 0x2f6b34, 0x5a8f3c, 0x6b9a46];
const BLOOM = [0xe85a6a, 0xf2c14e, 0xf08a3c, 0xb06ad9, 0xffffff, 0xe94f9b];
const CONCRETE = [0xb9b6ae, 0xa9a59c, 0xc4c0b6, 0x9f9c95];

function roundedSquare(half: number, r: number): Shape {
  const s = new Shape(), a = half - r;
  s.moveTo(-a, -half); s.lineTo(a, -half); s.absarc(a, -a, r, -Math.PI / 2, 0, false);
  s.lineTo(half, a); s.absarc(a, a, r, 0, Math.PI / 2, false);
  s.lineTo(-a, half); s.absarc(-a, a, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-half, -a); s.absarc(-a, -a, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
/** a flat slab of a shape, `depth` tall, standing on y = 0 */
const slab = (sh: Shape, depth: number) => new ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);

/**
 * A ramp solid in its own frame: x from -0.5 (the far edge, at the ground) to +0.5 (the deck), z across. Top from the
 * profile, retaining walls down to the ground, the abutment face under the deck end, parapets along the top. Each
 * part goes to `put` with its colour (the caller turns it into place).
 */
function rampParts(put: (g: BufferGeometry, color: number) => void, wall: number, top: number, parapet: number, solidParapet: boolean, posts: number) {
  const N = 10, W = DECK_HALF, C = CARRIAGE_HALF;
  const y = (i: number) => H * ease(i / N);
  const x = (i: number) => -0.5 + i / N;
  const quad = (a: number[], b: number[], c: number[], d: number[], out: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const geo = (p: number[]) => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g; };
  const surf: number[] = [], walks: number[] = [], walls: number[] = [];
  for (let i = 0; i < N; i++) {
    quad([x(i), y(i), C], [x(i + 1), y(i + 1), C], [x(i + 1), y(i + 1), -C], [x(i), y(i), -C], surf);
    for (const [a, b] of [[C, W], [-W, -C]]) quad([x(i), y(i) + 0.006, b], [x(i + 1), y(i + 1) + 0.006, b], [x(i + 1), y(i + 1) + 0.006, a], [x(i), y(i) + 0.006, a], walks);
    quad([x(i), 0, W], [x(i + 1), 0, W], [x(i + 1), y(i + 1), W], [x(i), y(i), W], walls);
    quad([x(i), y(i), -W], [x(i + 1), y(i + 1), -W], [x(i + 1), 0, -W], [x(i), 0, -W], walls);
  }
  quad([0.5, 0, W], [0.5, 0, -W], [0.5, H, -W], [0.5, H, W], walls); // the abutment under the deck end
  put(geo(surf), top);
  put(geo(walks), PAVING);
  put(geo(walls), wall);
  for (const s of [-1, 1]) {
    const p: number[] = [];
    if (solidParapet) {
      const z = s * (W + 0.012);
      for (let i = 0; i < N; i++) {
        quad([x(i), y(i), z], [x(i + 1), y(i + 1), z], [x(i + 1), y(i + 1) + 0.045, z], [x(i), y(i) + 0.045, z], p);
        quad([x(i), y(i) + 0.045, z], [x(i + 1), y(i + 1) + 0.045, z], [x(i + 1), y(i + 1), z], [x(i), y(i), z], p);
      }
    } else {
      // a rail on posts, only where the ramp is high enough to need one
      const z = s * (W + 0.006);
      for (let i = N - posts; i < N; i++) quad([x(i), y(i) + 0.04, z - 0.006], [x(i + 1), y(i + 1) + 0.04, z - 0.006], [x(i + 1), y(i + 1) + 0.04, z + 0.006], [x(i), y(i) + 0.04, z + 0.006], p);
      for (let i = N - posts; i <= N; i++) put(new BoxGeometry(0.012, 0.045, 0.012).translate(x(i) - (i === N ? 0.006 : 0), y(i) + 0.0225, z), parapet);
    }
    put(geo(p), parapet);
  }
}

export class JunctionView {
  group = new Group();
  private meshes = new Map<string, Mesh>();
  private mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  /** deck and ramp tiles by tile key: [the deck runs east-west, ramp side (-1 / +1, 0 on the deck)] */
  private lift = new Map<number, [boolean, number]>();
  private liftByChunk = new Map<string, number[]>();

  constructor(private world: ClientWorld) {}

  /** Rebuild a chunk's islands and decks (after its tiles or aux bytes change). */
  scanChunk(key: string, chunk: ClientChunk) {
    this.dropChunk(key);
    const k = new Kit();
    let any = false;
    const lifts: number[] = [];
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cy * CHUNK_SIZE;
    for (let i = 0; i < chunk.aux.length; i++) {
      const a = chunk.aux[i];
      if (!a) continue;
      const x = x0 + (i % CHUNK_SIZE), z = z0 + Math.floor(i / CHUNK_SIZE);
      if (isIslandAux(a)) { this.island(k, x, z); any = true; }
      else if (isFlyoverAux(a) && isRoad(chunk.tiles[i])) {
        const ew = deckEW(a);
        this.flyover(k, x, z, ew);
        any = true;
        for (const s of [-1, 0, 1]) {
          const tk = this.tkey(x + (ew ? s : 0), z + (ew ? 0 : s));
          this.lift.set(tk, [ew, s]); lifts.push(tk);
        }
      }
    }
    if (lifts.length) this.liftByChunk.set(key, lifts);
    if (!any) return;
    const m = new Mesh(k.build(), this.mat);
    m.castShadow = true; m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    this.meshes.set(key, m);
    this.group.add(m);
  }
  dropChunk(key: string) {
    const m = this.meshes.get(key);
    if (m) { this.group.remove(m); m.geometry.dispose(); this.meshes.delete(key); }
    for (const tk of this.liftByChunk.get(key) ?? []) this.lift.delete(tk);
    this.liftByChunk.delete(key);
  }

  private tkey(x: number, z: number) { return (x + 0x8000) * 65536 + (z + 0x8000); }

  /**
   * Height of the road a vehicle at (x, z) heading (hx, hz) drives on: the deck on a flyover tile when it runs along
   * the deck, the ramp profile on the tiles either side, else the ground.
   */
  roadY(x: number, z: number, hx: number, hz: number): number {
    if (!this.lift.size) return 0;
    const tx = Math.floor(x), tz = Math.floor(z);
    const l = this.lift.get(this.tkey(tx, tz));
    if (!l) return 0;
    const [ew, s] = l;
    if ((Math.abs(hx) >= Math.abs(hz)) !== ew) return 0; // on the road beneath, or turning off a ramp
    if (s === 0) return H;
    const u = ew ? x - tx : z - tz; // across the ramp tile, 0..1 along +x / +z
    return H * ease(s < 0 ? u : 1 - u);
  }

  /** The planner's verdict for the junction tools at a hovered tile, worked out on the loaded chunks. */
  verdict(tool: 'roundabout' | 'flyover', x: number, y: number) {
    const me = this.world.myPlayer, pub = !!me && hasFeature(me.tech, 'publicRoads');
    const env: JunctionEnv = {
      tile: (tx, ty) => this.world.getTile(tx, ty),
      aux: (tx, ty) => this.world.auxAt(tx, ty),
      land: (tx, ty) => { const p = this.world.parcelAt(tx, ty); return p ? (this.world.mayEdit(p.owner) ? null : 'Not your land') : pub ? null : 'Buy this land first (or research Public works)'; },
    };
    return tool === 'roundabout' ? planRoundabout(x, y, env) : planFlyover(x, y, env);
  }
  /** Status-line text for a junction tool over (x, y). */
  status(tool: 'roundabout' | 'flyover', x: number, y: number): string {
    const v = this.verdict(tool, x, y);
    if (!v.ok) return ` · ${v.reason}`;
    if (tool === 'flyover' && v.cost === 0) return ' · click to put the other road on the deck';
    return ` · click to build a ${tool}, $${v.cost}`;
  }
  /** The hover outline for a junction tool: the 3×3 of a roundabout, a flyover's deck and ramps. */
  hoverArea(tool: 'roundabout' | 'flyover', h: [number, number]): { x: number; y: number; w: number; h: number; verdict: PlaceVerdict } {
    const v = this.verdict(tool, h[0], h[1]);
    const verdict = (v.ok ? { ok: true } : { ok: false, reason: v.reason ?? '' }) as PlaceVerdict;
    if (tool === 'roundabout') return { x: h[0] - 1, y: h[1] - 1, w: 3, h: 3, verdict };
    const ew = v.tiles ? v.tiles[2] === FLYOVER_EW : this.world.auxAt(h[0], h[1]) !== FLYOVER_NS;
    return ew ? { x: h[0] - 1, y: h[1], w: 3, h: 1, verdict } : { x: h[0], y: h[1] - 1, w: 1, h: 3, verdict };
  }

  // ---- models ----------------------------------------------------------------------------------------

  /** A roundabout's island at (x, z): kerb, lawn, planting from its hash, chevron boards and give-way signs. */
  private island(k: Kit, x: number, z: number) {
    const cx = x + 0.5, cz = z + 0.5;
    const r = (n: number) => hash2(x * 31 + n * 7, z * 17 - n * 13);
    const half = 0.5 + RING_ISLAND;
    k.part(slab(roundedSquare(half, RING_ISLAND), 0.022).translate(cx, 0, cz), 0xc9c5bb);
    k.part(slab(roundedSquare(half - 0.025, RING_ISLAND - 0.02), 0.03).translate(cx, 0, cz), GRASS[Math.floor(r(1) * GRASS.length)]);
    const top = 0.03;
    const shrub = (px: number, pz: number, s: number, n: number) => {
      k.part(new IcosahedronGeometry(s, 0).scale(1, 0.7 + 0.3 * r(n + 50), 1).translate(px, top + s * 0.6, pz), SHRUB[Math.floor(r(n + 60) * SHRUB.length)]);
    };
    const tree = (px: number, pz: number, s: number, n: number) => {
      k.cyl(0.014 * s, 0.02 * s, 0.14 * s, px, top, pz, 0x6b4a2b, 5);
      k.part(new IcosahedronGeometry(0.1 * s, 0).translate(px, top + 0.2 * s, pz), SHRUB[Math.floor(r(n + 70) * SHRUB.length)]);
      k.part(new IcosahedronGeometry(0.07 * s, 0).translate(px + 0.04 * s * (r(n + 71) - 0.5), top + 0.27 * s, pz + 0.04 * s * (r(n + 72) - 0.5)), SHRUB[Math.floor(r(n + 73) * SHRUB.length)]);
    };
    const style = Math.floor(r(2) * 4);
    const turn = r(3) * Math.PI * 2;
    if (style === 0) {
      // one big tree in the middle, a ring of shrubs round it
      tree(cx + (r(4) - 0.5) * 0.1, cz + (r(5) - 0.5) * 0.1, 1.6 + r(6) * 0.8, 6);
      const n = 6 + Math.floor(r(7) * 5);
      for (let i = 0; i < n; i++) {
        const a = turn + (i / n) * Math.PI * 2 + (r(10 + i) - 0.5) * 0.4, d = 0.42 + r(30 + i) * 0.2;
        shrub(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.04 + r(20 + i) * 0.035, i);
      }
    } else if (style === 1) {
      // flower beds: rings of blooms in two or three colours round a clipped conifer, a low hedge at the rim
      const cols = [BLOOM[Math.floor(r(8) * BLOOM.length)], BLOOM[Math.floor(r(9) * BLOOM.length)], BLOOM[Math.floor(r(11) * BLOOM.length)]];
      for (let ring = 0; ring < 3; ring++) {
        const d = 0.22 + ring * 0.14, n = 10 + ring * 6;
        for (let i = 0; i < n; i++) {
          const a = turn + (i / n) * Math.PI * 2 + (r(100 + ring * 40 + i) - 0.5) * 0.15;
          k.box(0.035, 0.012 + r(200 + i) * 0.01, 0.035, cx + Math.cos(a) * d, top, cz + Math.sin(a) * d, cols[ring]);
        }
      }
      k.cone(0.07, 0.24 + r(12) * 0.1, cx, top, cz, 0x2f6b34, 7);
      const n = 16;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; k.box(0.06, 0.035, 0.06, cx + Math.cos(a) * 0.66, top, cz + Math.sin(a) * 0.66, 0x3f7a3a); }
    } else if (style === 2) {
      // a monument on a plinth: an obelisk or a stepped column, clipped shrubs at four corners
      const stone = CONCRETE[Math.floor(r(13) * CONCRETE.length)];
      k.box(0.3, 0.05, 0.3, cx, top, cz, stone);
      if (r(14) < 0.5) { k.box(0.1, 0.32, 0.1, cx, top + 0.05, cz, stone); k.cone(0.072, 0.06, cx, top + 0.37, cz, stone, 4); }
      else { k.cyl(0.05, 0.06, 0.26, cx, top + 0.05, cz, stone, 8); k.part(new IcosahedronGeometry(0.06, 0).translate(cx, top + 0.36, cz), 0x8a7a5a); }
      for (let i = 0; i < 4; i++) { const a = turn + Math.PI / 4 + (i * Math.PI) / 2; shrub(cx + Math.cos(a) * 0.4, cz + Math.sin(a) * 0.4, 0.05 + r(40 + i) * 0.02, 80 + i); }
    } else {
      // meadow: tufts of long grass and two or three young trees, leaning a little
      const n = 22 + Math.floor(r(15) * 12);
      for (let i = 0; i < n; i++) {
        const a = r(300 + i) * Math.PI * 2, d = Math.sqrt(r(400 + i)) * 0.62;
        k.part(new ConeGeometry(0.02, 0.05 + r(500 + i) * 0.05, 4).translate(cx + Math.cos(a) * d, top + 0.03, cz + Math.sin(a) * d), r(600 + i) < 0.2 ? 0xc9b458 : 0x7fa24d);
      }
      const t = 2 + Math.floor(r(16) * 2);
      for (let i = 0; i < t; i++) { const a = turn + (i / t) * Math.PI * 2, d = 0.3 + r(700 + i) * 0.15; tree(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.9 + r(710 + i) * 0.5, 90 + i); }
    }
    // a chevron board facing each way in, on the island's edge, and a give-way sign on the kerb to the right of it
    for (let p = 0; p < 8; p += 2) {
      const [ox, oz] = RING_POS[p];
      const arm = this.world.getTile(x + 2 * ox, z + 2 * oz);
      if (arm === undefined || !isRoad(arm)) continue;
      const bx = cx + ox * (half - 0.06), bz = cz + oz * (half - 0.06), along = ox !== 0;
      k.box(along ? 0.012 : 0.2, 0.012, along ? 0.2 : 0.012, bx, 0.06, bz, 0x2b2e33);
      for (const q of [-1, 1]) k.box(0.01, 0.07, 0.01, bx + (along ? 0 : q * 0.08), top, bz + (along ? q * 0.08 : 0), 0x2b2e33);
      k.box(along ? 0.014 : 0.22, 0.06, along ? 0.22 : 0.014, bx, 0.072, bz, 0xf2f2ee);
      for (let c = -1; c <= 1; c++) k.box(along ? 0.016 : 0.028, 0.04, along ? 0.028 : 0.016, bx + (along ? 0 : c * 0.065), 0.082, bz + (along ? c * 0.065 : 0), 0x1c1e22);
      // on the near-side kerb of the arm, where cars coming in see it
      const rx = oz, rz = -ox; // right of a car heading in (-ox, -oz)
      const sx = cx + ox * 1.45 + rx * 0.45, sz = cz + oz * 1.45 + rz * 0.45;
      k.cyl(0.008, 0.008, 0.16, sx, 0, sz, 0x8e939b, 5);
      const tri = new CylinderGeometry(0.045, 0.045, 0.01, 3).rotateX(Math.PI / 2).rotateY(Math.atan2(ox, oz)).translate(sx, 0.17, sz);
      k.part(tri, 0xd23b2b);
      const inner = new CylinderGeometry(0.028, 0.028, 0.012, 3).rotateX(Math.PI / 2).rotateY(Math.atan2(ox, oz)).translate(sx + ox * 0.001, 0.172, sz + oz * 0.001);
      k.part(inner, 0xf2f2ee);
    }
  }

  /** A flyover at (x, z): the deck over the crossing tile and a ramp on each tile either side along it. */
  private flyover(k: Kit, x: number, z: number, ew: boolean) {
    const cx = x + 0.5, cz = z + 0.5;
    const r = (n: number) => hash2(x * 13 + n * 5, z * 29 - n * 3);
    const tone = new Color(CONCRETE[Math.floor(r(1) * CONCRETE.length)]).multiplyScalar(0.94 + 0.12 * r(2)).getHex();
    const asphalt = new Color(0x3d3f45).multiplyScalar(0.92 + 0.14 * r(3)).getHex();
    const solid = r(4) < 0.55, parapet = solid ? tone : 0x6a6e75;
    // the deck: a slab over the road beneath, parapets, a dashed centre line
    const L = 1.0, Wd = DECK_HALF * 2 + 0.02, T = 0.07;
    k.box(ew ? L : Wd, T, ew ? Wd : L, cx, H - T, cz, tone);
    k.box(ew ? L : CARRIAGE_HALF * 2, 0.004, ew ? CARRIAGE_HALF * 2 : L, cx, H - 0.002, cz, asphalt);
    for (const s of [-1, 1]) { const o = s * (CARRIAGE_HALF + DECK_HALF) / 2, w = DECK_HALF - CARRIAGE_HALF; k.box(ew ? L : w, 0.008, ew ? w : L, cx + (ew ? 0 : o), H - 0.002, cz + (ew ? o : 0), PAVING); }
    for (const s of [-1, 1]) {
      const px = cx + (ew ? 0 : s * (DECK_HALF + 0.012)), pz = cz + (ew ? s * (DECK_HALF + 0.012) : 0);
      if (solid) k.box(ew ? L : 0.024, 0.05, ew ? 0.024 : L, px, H, pz, parapet);
      else {
        k.box(ew ? L : 0.012, 0.008, ew ? 0.012 : L, px, H + 0.038, pz, parapet);
        for (let i = 0; i <= 6; i++) { const t = -0.5 + i / 6; k.box(0.012, 0.045, 0.012, px + (ew ? t * L * 0.98 : 0), H, pz + (ew ? 0 : t * L * 0.98), parapet); }
      }
    }
    for (let i = 0; i < 3; i++) { const t = -0.33 + i * 0.33; k.box(ew ? 0.12 : 0.016, 0.003, ew ? 0.016 : 0.12, cx + (ew ? t : 0), H + 0.002, cz + (ew ? 0 : t), 0xe3c75a); }
    // a soffit beam under each edge, so the deck reads as a bridge from below
    for (const s of [-1, 1]) k.box(ew ? L : 0.05, 0.05, ew ? 0.05 : L, cx + (ew ? 0 : s * (DECK_HALF - 0.02)), H - T - 0.04, cz + (ew ? s * (DECK_HALF - 0.02) : 0), tone);
    // ramps: their own kit, turned and moved onto each neighbour along the deck
    for (const s of [-1, 1]) {
      // own frame: +x towards the deck. Side +1 is the neighbour at +axis, whose deck end faces -axis.
      rampParts((g, c) => {
        if (s > 0) g.rotateY(Math.PI);
        if (!ew) g.rotateY(-Math.PI / 2);
        k.part(g.translate(cx + (ew ? s : 0), 0, cz + (ew ? 0 : s)), c);
      }, tone, asphalt, parapet, solid, 3 + Math.floor(r(5 + s) * 3));
    }
  }
}
