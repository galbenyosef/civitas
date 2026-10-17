import { BoxGeometry, Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Color, AdditiveBlending } from 'three';
import {
  CHUNK_SIZE, FRONT, isAirfieldAux, airfieldOrientation, airfieldRow, airfieldTerminal, airportFor,
  type Airport, type AirportLink, type Placed,
} from '@msimcity/shared';
import type { ClientChunk, ClientWorld } from '../world';
import { chunkTerminals, sortTerminals, clientAirports, clientEnv } from '../airports';
import { sceneUniforms } from './materials';

/**
 * Runway and taxiway lights for the airfield strips painted on the map (shared/src/airport.ts), and the client's
 * airports: the terminals anchored in loaded chunks, linked to their runways by the shared derivation. The ground
 * markings themselves are atlas cells drawn by chunkView. Lights are small emissive boxes with an additive glow that
 * comes up at dusk: white along the runway edges, green across the thresholds, blue along the taxiway.
 */
const MAX_LIGHTS = 6000;
const COLORS = [new Color(0xfff4d6), new Color(0x3cff6e), new Color(0x4d82ff)];
const WHITE = 0, GREEN = 1, BLUE = 2;

export class AirfieldView {
  group = new Group();
  /** every loaded terminal with its runway status, and the descriptor when operational and fully loaded */
  links: AirportLink[] = [];
  private chunks = new Map<string, { terminals: Placed[]; lights: number[] }>();
  private changed = true;
  private boxes: InstancedMesh;
  private glow: InstancedMesh;
  private boxMat = new MeshBasicMaterial({ toneMapped: false });
  private glowMat = new MeshBasicMaterial({ transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  private m = new Matrix4();

  constructor() {
    this.boxes = new InstancedMesh(new BoxGeometry(0.05, 0.035, 0.05), this.boxMat, MAX_LIGHTS);
    this.glow = new InstancedMesh(new IcosahedronGeometry(0.1, 1), this.glowMat, MAX_LIGHTS);
    for (const mesh of [this.boxes, this.glow]) { mesh.count = 0; mesh.frustumCulled = false; this.group.add(mesh); }
  }

  /** Re-read one chunk (after chunkView rebuilt it): its terminal anchors and the lights of its airfield tiles. */
  scanChunk(key: string, c: ClientChunk, world: ClientWorld) {
    const had = this.chunks.has(key);
    const terminals = chunkTerminals(c);
    const lights: number[] = [];
    for (let i = 0; i < c.aux.length; i++) {
      const a = c.aux[i];
      if (a && isAirfieldAux(a)) this.tileLights(a, c.cx * CHUNK_SIZE + (i % CHUNK_SIZE), c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE), world, lights);
    }
    if (terminals.length || lights.length) this.chunks.set(key, { terminals, lights }); else this.chunks.delete(key);
    if (had || terminals.length || lights.length) this.changed = true;
  }
  dropChunk(key: string) { if (this.chunks.delete(key)) this.changed = true; }

  private tileLights(a: number, x: number, z: number, world: ClientWorld, out: number[]) {
    const o = airfieldOrientation(a), k = airfieldRow(a);
    const ax = o & 1 ? 0 : 1, az = o & 1 ? 1 : 0;
    const [bx, bz] = FRONT[o];
    const lo = world.auxAt(x - ax, z - az) !== a, hi = world.auxAt(x + ax, z + az) !== a;
    const put = (along: number, across: number, color: number) => out.push(x + 0.5 + ax * along + bx * across, z + 0.5 + az * along + bz * across, color);
    const endAlong = lo ? -0.45 : 0.45;
    if (k === 0 || k === 2) put(0, k === 0 ? 0.23 : -0.23, lo || hi ? GREEN : WHITE);
    else if (k === 1 && (lo || hi)) for (const c of [-0.3, 0, 0.3]) put(endAlong, c, GREEN);
    else if (k === 4) put(0, -0.22, BLUE);
    else if (k === 5) put(0, 0.05, BLUE);
  }

  /** Once per frame: rebuild the light instances and the airport links if anything changed. True when it did. */
  update(world: ClientWorld): boolean {
    if (!this.changed) return false;
    this.changed = false;
    let n = 0;
    const col = new Color();
    for (const { lights } of this.chunks.values()) {
      for (let i = 0; i < lights.length && n < MAX_LIGHTS; i += 3, n++) {
        this.m.makeTranslation(lights[i], 0.03, lights[i + 1]);
        this.boxes.setMatrixAt(n, this.m);
        this.glow.setMatrixAt(n, this.m);
        col.copy(COLORS[lights[i + 2]]);
        this.boxes.setColorAt(n, col);
        this.glow.setColorAt(n, col);
      }
    }
    for (const mesh of [this.boxes, this.glow]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.links = clientAirports(world, sortTerminals([...this.chunks.values()].flatMap((c) => c.terminals)));
    return true;
  }

  /** Operational airports whose whole strip is loaded: what the planes fly from. */
  airports(): Airport[] { return this.links.filter((l) => l.airport && l.complete).map((l) => l.airport!); }

  /** The terminal and runway status for an airfield tile (runway tooltips). */
  linkAt(x: number, y: number, world: ClientWorld): AirportLink | null {
    const env = clientEnv(world);
    const t = airfieldTerminal(x, y, env);
    if (!t) return null;
    return this.links.find((l) => l.terminal.ax === t.ax && l.terminal.ay === t.ay) ?? airportFor(t, env);
  }

  frame() {
    const night = sceneUniforms.uNight.value;
    this.boxMat.color.setScalar(0.35 + 0.9 * night);
    this.glowMat.opacity = 0.55 * night;
    this.glow.visible = night > 0.02;
  }
}
