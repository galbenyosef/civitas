import { InstancedMesh, Matrix4, Color, Vector3, Quaternion, Group, BufferGeometry, MeshLambertMaterial } from 'three';
import { CHUNK_SIZE, Zone, hash2, zoneOf, isRoad } from '@msimcity/shared';
import { Kit } from './kit';
import { sceneUniforms, vehicleMaterial } from './materials';
import type { ClientWorld } from '../world';

/**
 * Cars standing still: the ones in single-tile parking lots (the server reports the count per lot in the chunk's
 * traffic bytes) and the ones left at the kerb of a road tile (the optional `k` bytes of the same message).
 *
 * The server only says how many cars a site holds, so the client keeps the bays: a car that arrives takes a free
 * bay picked from a hash of the site and its arrival count, and keeps it until some car leaves (a hash picks which).
 * Nothing hops between bays when the count changes, bays fill in no particular order, and each newcomer is a fresh
 * car (model, paint, angle, offset) seeded the same way. Three instanced meshes (sedan, van, truck) carry every
 * parked car in the world; they are rewritten only when a count actually changed.
 */

const SEDAN_SCALE = 0.76, VAN_SCALE = 0.68, TRUCK_SCALE = 0.66;
/** no near-black paints (see CAR_PALETTE in citizens.ts): faces turned from the sun get ambient only */
const PAINT = [0xe8e8e8, 0xf5f5f5, 0x6a707a, 0x8e8e8e, 0xc0392b, 0x2e86de, 0x3b5fd6, 0xe1b12c, 0x6c9a3c, 0x2f6b4a, 0xc9b48a, 0x7a5236, 0x2a8a8a, 0xb0b6bd].map((c) => new Color(c));
const UP = new Vector3(0, 1, 0);

/** bay centres in a lot tile's local frame: six across at z = ±0.27 (the bay lines drawn by buildings/parking.ts and transport.ts) */
const LOT_BAYS: [number, number][] = [];
for (let i = 0; i < 6; i++) { const x = -0.35 + i * 0.14; LOT_BAYS.push([x, -0.27], [x, 0.27]); }
/** kerb slots on a road tile: [lateral side, distance along the road] */
const KERB_SLOTS: [number, number][] = [[1, -0.23], [1, 0.23], [-1, -0.23], [-1, 0.23]];
const KERB_LATERAL = 0.3;

function sedan(): BufferGeometry {
  const k = new Kit();
  k.box(0.34, 0.09, 0.18, 0, 0.045, 0, 0xffffff)
    .box(0.17, 0.075, 0.15, -0.02, 0.135, 0, 0x3d4f68)
    .box(0.025, 0.02, 0.035, 0.17, 0.075, 0.06, 0xfff2b0).box(0.025, 0.02, 0.035, 0.17, 0.075, -0.06, 0xfff2b0)
    .box(0.015, 0.02, 0.035, -0.17, 0.075, 0.06, 0xd62020).box(0.015, 0.02, 0.035, -0.17, 0.075, -0.06, 0xd62020);
  for (const [x, z] of [[0.11, 0.095], [-0.11, 0.095], [0.11, -0.095], [-0.11, -0.095]]) k.wheel(0.04, 0.035, x, 0.04, z, 0x151515);
  return k.build();
}
function van(): BufferGeometry {
  const k = new Kit();
  k.box(0.4, 0.18, 0.2, -0.01, 0.045, 0, 0xffffff)
    .box(0.07, 0.085, 0.18, 0.155, 0.14, 0, 0x3d4f68)
    .box(0.11, 0.03, 0.14, -0.03, 0.225, 0, 0xdde7ff)
    .box(0.025, 0.02, 0.035, 0.2, 0.075, 0.065, 0xfff2b0).box(0.025, 0.02, 0.035, 0.2, 0.075, -0.065, 0xfff2b0)
    .box(0.015, 0.03, 0.03, -0.21, 0.09, 0.07, 0xd62020).box(0.015, 0.03, 0.03, -0.21, 0.09, -0.07, 0xd62020);
  for (const [x, z] of [[0.12, 0.105], [-0.13, 0.105], [0.12, -0.105], [-0.13, -0.105]]) k.wheel(0.042, 0.035, x, 0.042, z, 0x151515);
  return k.build();
}
function truck(): BufferGeometry {
  const k = new Kit();
  k.box(0.12, 0.16, 0.2, 0.16, 0.045, 0, 0xffffff)
    .box(0.02, 0.07, 0.17, 0.225, 0.115, 0, 0x3d4f68)
    .box(0.3, 0.035, 0.2, -0.07, 0.045, 0, 0x5c5f66)
    .box(0.09, 0.09, 0.09, -0.12, 0.08, 0.045, 0xa8553a).box(0.075, 0.075, 0.075, -0.02, 0.08, -0.05, 0xd8c08a)
    .box(0.012, 0.025, 0.035, 0.224, 0.07, 0.065, 0xfff2b0).box(0.012, 0.025, 0.035, 0.224, 0.07, -0.065, 0xfff2b0)
    .box(0.012, 0.02, 0.03, -0.224, 0.05, 0.08, 0xd62020).box(0.012, 0.02, 0.03, -0.224, 0.05, -0.08, 0xd62020);
  for (const [x, z] of [[0.15, 0.105], [-0.1, 0.105], [-0.17, 0.105], [0.15, -0.105], [-0.1, -0.105], [-0.17, -0.105]]) k.wheel(0.042, 0.035, x, 0.042, z, 0x151515);
  return k.build();
}

/** The bays of one lot or kerb tile: 0 = free, otherwise the generation of the car standing there. */
interface Site {
  kerb: boolean; x: number; y: number; slots: Uint16Array; n: number;
  /** cars that have ever arrived: the seed for the next bay and the next car */
  arrivals: number; leavings: number;
}

type Model = 0 | 1 | 2;

export class ParkedCars {
  group = new Group();
  private meshes: InstancedMesh[];
  private sites = new Map<string, Site>();
  /** site keys per chunk, so a lot that is gone from a chunk's bytes is emptied */
  private byChunk = new Map<string, Set<string>>();
  private dirty = false;
  private m = new Matrix4(); private p = new Vector3(); private q = new Quaternion(); private s = new Vector3(); private c = new Color();

  constructor(private world: ClientWorld) {
    const mat: MeshLambertMaterial = vehicleMaterial();
    // same fill light as the moving cars: faces turned from the sun would otherwise render almost black
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = sceneUniforms.uNight;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(0.16, 0.04, uNight);');
    };
    this.meshes = [new InstancedMesh(sedan(), mat, 9000), new InstancedMesh(van(), mat, 2500), new InstancedMesh(truck(), mat, 1500)];
    for (const mesh of this.meshes) { mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; this.group.add(mesh); }
  }

  /** Fold the counts of these chunks (their traffic bytes just changed, or they were dropped) into the bays. */
  update(keys: Iterable<string>) {
    for (const key of keys) this.syncChunk(key);
    // chunks the client no longer holds
    for (const key of this.byChunk.keys()) if (!this.world.chunks.has(key)) this.syncChunk(key);
    if (this.dirty) this.rebuild();
  }

  private syncChunk(key: string) {
    const w = this.world, chunk = w.chunks.get(key);
    const want = new Map<string, { kerb: boolean; x: number; y: number; n: number }>();
    if (chunk) {
      const lots = w.traffic.get(key), kerb = w.kerb.get(key);
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const x = chunk.cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = chunk.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        const t = chunk.tiles[i];
        if (lots && lots[i] && zoneOf(t) === Zone.Parking && !isRoad(t) && !chunk.aux[i]) { // a multi-storey or park and ride draws its cars in its own model
          want.set(`L${x},${y}`, { kerb: false, x, y, n: Math.min(lots[i], LOT_BAYS.length) });
        } else if (kerb && kerb[i] && isRoad(t)) {
          want.set(`K${x},${y}`, { kerb: true, x, y, n: Math.min(kerb[i], KERB_SLOTS.length) });
        }
      }
    }
    const before = this.byChunk.get(key);
    if (before) for (const sk of before) if (!want.has(sk)) { this.setCount(sk, null, 0); }
    if (want.size) this.byChunk.set(key, new Set(want.keys())); else this.byChunk.delete(key);
    for (const [sk, w2] of want) this.setCount(sk, w2, w2.n);
  }

  private setCount(sk: string, info: { kerb: boolean; x: number; y: number } | null, n: number) {
    let site = this.sites.get(sk);
    if (!site) {
      if (!info || n <= 0) return;
      site = { kerb: info.kerb, x: info.x, y: info.y, slots: new Uint16Array(info.kerb ? KERB_SLOTS.length : LOT_BAYS.length), n: 0, arrivals: 0, leavings: 0 };
      this.sites.set(sk, site);
    }
    if (site.n === n) return;
    const seed = site.x * 31 + site.y * 17 + (site.kerb ? 7 : 0);
    while (site.n < n) { // a car arrives: any free bay
      const free: number[] = [];
      for (let b = 0; b < site.slots.length; b++) if (!site.slots[b]) free.push(b);
      if (!free.length) break;
      site.arrivals++;
      site.slots[free[Math.floor(hash2(seed + site.arrivals * 131, site.arrivals * 7 + 3) * free.length)]] = site.arrivals & 0x7fff | 0x8000; // generation, never 0
      site.n++;
    }
    while (site.n > n) { // a car leaves: whichever the hash picks
      const used: number[] = [];
      for (let b = 0; b < site.slots.length; b++) if (site.slots[b]) used.push(b);
      if (!used.length) break;
      site.leavings++;
      site.slots[used[Math.floor(hash2(seed + site.leavings * 53, site.leavings * 11 + 5) * used.length)]] = 0;
      site.n--;
    }
    if (site.n === 0) this.sites.delete(sk);
    this.dirty = true;
  }

  /** Place every parked car: one pass over the sites, only when a count changed. */
  private rebuild() {
    this.dirty = false;
    const counts = [0, 0, 0];
    for (const site of this.sites.values()) {
      const vertical = site.kerb ? this.vertical(site.x, site.y) : false;
      if (vertical === null) continue; // a kerb at a junction or a corner: no kerb line to stand on
      for (let b = 0; b < site.slots.length; b++) {
        const gen = site.slots[b];
        if (!gen) continue;
        const h = hash2(site.x * 29 + b * 3 + (gen & 0x7fff) * 101, site.y * 23 + (site.kerb ? 9 : 4)); // this car, in this bay
        const h2 = hash2(h * 977, gen & 0x7fff), h3 = hash2(h2 * 631, b + 1), h4 = hash2(h3 * 389, 17);
        // mostly sedans, a few vans, now and then a delivery truck (none in the tight kerb slots)
        const model: Model = h4 < 0.78 ? 0 : h4 < (site.kerb ? 0.97 : 0.91) ? 1 : site.kerb ? 1 : 2;
        const mesh = this.meshes[model];
        const i = counts[model];
        if (i >= mesh.instanceMatrix.count) continue;
        counts[model]++;
        let px: number, pz: number, yaw: number;
        if (site.kerb) {
          const [side, along] = KERB_SLOTS[b];
          const lat = side * (KERB_LATERAL + (h2 - 0.5) * 0.03), lon = along + (h3 - 0.5) * 0.08;
          // right-hand traffic: facing the way the near lane flows
          if (vertical) { px = site.x + 0.5 + lat; pz = site.y + 0.5 + lon; yaw = side < 0 ? -Math.PI / 2 : Math.PI / 2; }
          else { px = site.x + 0.5 + lon; pz = site.y + 0.5 + lat; yaw = side > 0 ? 0 : Math.PI; }
          yaw += (h4 - 0.5) * 0.07;
        } else {
          const [bx, bz] = LOT_BAYS[b];
          px = site.x + 0.5 + bx + (h2 - 0.5) * 0.012; pz = site.y + 0.5 + bz + (h3 - 0.5) * 0.04;
          // each lot has a habit (nose to the aisle or tail to it); one driver in six does it the other way
          const noseIn = hash2(site.x * 3 + 1, site.y * 5 + 2) < 0.5 !== (h4 > 0.9);
          yaw = (bz < 0) === noseIn ? -Math.PI / 2 : Math.PI / 2;
          yaw += (h2 - 0.5) * 0.09;
        }
        const scale = (model === 0 ? SEDAN_SCALE : model === 1 ? VAN_SCALE : TRUCK_SCALE) * (0.97 + 0.06 * h3);
        this.p.set(px, 0, pz);
        this.q.setFromAxisAngle(UP, yaw);
        this.s.setScalar(scale);
        this.m.compose(this.p, this.q, this.s);
        mesh.setMatrixAt(i, this.m);
        this.c.copy(PAINT[Math.floor(h * PAINT.length) % PAINT.length]).multiplyScalar(0.88 + 0.2 * h2);
        mesh.setColorAt(i, this.c);
      }
    }
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** True when the road runs north-south, false east-west, null for a junction, a corner or a lone tile. */
  private vertical(x: number, y: number): boolean | null {
    const road = (dx: number, dy: number) => { const t = this.world.getTile(x + dx, y + dy); return t !== undefined && isRoad(t); };
    const n = road(0, -1), s = road(0, 1), e = road(1, 0), w = road(-1, 0);
    if ((n || s) && !e && !w) return true;
    if ((e || w) && !n && !s) return false;
    return null;
  }
}
