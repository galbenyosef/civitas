import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BoxGeometry, CylinderGeometry, Color, Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3, AdditiveBlending, type BufferGeometry, type Camera } from 'three';
import {
  CHUNK_SIZE, CAR_LEN, RAIL_VEHICLE_LEN, RAIL_VEHICLE_GAP, hash2, isRailAux, railMask, isRoad, railService, trainsAt, trainPoses, railPoint, metroBore, TICKS_PER_DAY,
  type RailLineDTO, type RailService, type TrainState, type VehiclePose,
} from '@msimcity/shared';
import type { ClientChunk } from '../world';
import { Kit } from './kit';
import { vehicleMaterial, sceneUniforms } from './materials';
import { CrossingsView } from './crossings';
import { METRO_Y, crossoverDip } from './underground';

/**
 * Trains and the overhead line (shared/src/rail.ts, docs/rail.md). Where every train is comes from the shared pure
 * function `trainsAt(railService(line, route), tick)`; the lines and their routes arrive in the 'railLines' message,
 * so a train is drawn wherever it is, loaded chunk or not. This file only draws.
 *
 * Model frame: +x forward (towards higher arclength, the way the locomotive faces), +y up, +z across; the origin is
 * the middle of the vehicle at rail height. Each vehicle type (locomotive, carriage, driving trailer) has four
 * instanced parts: the shell (tinted with the livery's main colour), the trim (its second colour), fixed parts
 * with their own colours, and glass (dark by day, lit at night with a per-vehicle warmth). Each line colour has two
 * liveries, picked per train by hash: the colour with white trim, or white with a band of the colour.
 * Head and tail lights are small boxes with an additive glow that brightens at dusk.
 */

const MAX_VEHICLES = 600;
const MAX_LIGHTS = 400;
const RAIL_TOP = 0.014;
/** tube stock (docs/underground.md section 5): the rail head of the bores (render/underground.ts: the floor is METRO_Y - 0.17, the rail 0.025 tall) and how far each bore lies from the tunnel's middle */
const TUBE_TOP = METRO_Y - 0.17 + 0.025, BORE_OFF = 0.2;
const MAX_TUBE = 1500, MAX_TUBE_LIGHTS = 1200, MAX_FIGURES = 6000;
/** how far up the underground view must be for its trains to be picked, and for the carriages' riders to show */
const SHOW_LEVEL = 0.04, USE_LEVEL = 0.5;
const W = 0.21;
const WHITE = new Color(0xffffff), PALE = new Color(0xe9edf0), HEAD = new Color(0xfff3d0), TAIL = new Color(0xff2a1c);
const ROOF = 0x8f949c, UNDER = 0x2a2c30, BOGIE = 0x1d1e21, GREY = 0x6b6f76, YELLOW = 0xe8c53a;

type Parts = { shell: BufferGeometry; trim: BufferGeometry; fixed: BufferGeometry; glass: BufferGeometry | null };

/** running gear and roof shared by every vehicle */
function chassis(k: Kit) {
  k.box(0.8, 0.03, 0.17, 0, 0.02, 0, UNDER);
  for (const x of [-0.3, 0.3]) {
    k.box(0.17, 0.035, 0.18, x, 0.0, 0, BOGIE);
    for (const dx of [-0.05, 0.05]) for (const z of [-0.075, 0.075]) k.wheel(0.025, 0.02, x + dx, 0.025, z, BOGIE).part(new BoxGeometry(0.02, 0.05, 0.02).rotateX(Math.PI / 2).translate(x + dx, 0.025, z), BOGIE);
  }
  k.box(0.84, 0.022, 0.19, 0, 0.25, 0, ROOF);
}
function carriage(cabAtBack: boolean): Parts {
  const shell = new Kit(), trim = new Kit(), fixed = new Kit(), glass = new Kit();
  chassis(fixed);
  shell.box(0.84, 0.2, W, 0, 0.05, 0, 0xffffff);
  trim.box(0.845, 0.022, W + 0.004, 0, 0.085, 0, 0xffffff);                     // lower band
  for (const x of [-0.2, 0.2]) trim.box(0.075, 0.15, W + 0.006, x, 0.065, 0, 0xffffff); // doors
  for (const [x, l] of [[-0.33, 0.17], [0, 0.27], [0.33, 0.17]]) glass.box(l, 0.065, W + 0.008, x, 0.15, 0, 0xffffff);
  if (cabAtBack) {
    glass.box(0.012, 0.07, 0.16, -0.425, 0.155, 0, 0xffffff);                  // windscreen at the -x end
    fixed.box(0.012, 0.07, 0.18, -0.426, 0.06, 0, YELLOW);                      // warning panel
  } else {
    for (const x of [-0.425, 0.425]) fixed.box(0.02, 0.17, 0.14, x, 0.06, 0, GREY); // gangways
  }
  return { shell: shell.build(), trim: trim.build(), fixed: fixed.build(), glass: glass.build() };
}
/**
 * Tube stock for the bores (RailVehicle 7 and 8): a squat barrel-roofed car that fits the 0.16 bore, sliding doors and a
 * stripe in the line's colour (the trim), a lit window band (the glass, bright whatever the hour) and silver sides (the shell).
 * The cab car has its driver's end at +x; the rear one is flipped by trainPoses.
 */
const TUBE_W = 0.19;
function tubeChassis(k: Kit) {
  k.box(0.8, 0.025, 0.15, 0, 0.025, 0, UNDER);
  for (const x of [-0.3, 0.3]) {
    k.box(0.15, 0.03, 0.16, x, 0.0, 0, BOGIE);
    for (const dx of [-0.045, 0.045]) for (const z of [-0.07, 0.07]) k.wheel(0.022, 0.018, x + dx, 0.022, z, BOGIE);
  }
  k.box(0.6, 0.01, 0.07, 0, 0.238, 0, GREY); // roof vents
}
function tubeBody(doors: number[], windows: [number, number][]): Parts {
  const shell = new Kit(), trim = new Kit(), fixed = new Kit(), glass = new Kit();
  tubeChassis(fixed);
  shell.box(0.84, 0.15, TUBE_W, 0, 0.04, 0, 0xffffff);
  shell.taper(0.84, TUBE_W, 0.84, 0.12, 0.05, 0, 0.19, 0, 0xffffff);                 // the barrel roof
  trim.box(0.845, 0.016, TUBE_W + 0.004, 0, 0.085, 0, 0xffffff);                     // the stripe
  for (const x of doors) {
    trim.box(0.09, 0.15, TUBE_W + 0.006, x, 0.04, 0, 0xffffff);                      // sliding doors
    glass.box(0.05, 0.07, TUBE_W + 0.01, x, 0.115, 0, 0xffffff);
  }
  for (const [x, l] of windows) glass.box(l, 0.06, TUBE_W + 0.008, x, 0.12, 0, 0xffffff);
  return { shell: shell.build(), trim: trim.build(), fixed: fixed.build(), glass: glass.build() };
}
function tubeCar(): Parts {
  const p = tubeBody([-0.29, 0, 0.29], [[-0.145, 0.18], [0.145, 0.18], [-0.38, 0.07], [0.38, 0.07]]);
  const g = new Kit();
  for (const x of [-0.425, 0.425]) g.box(0.02, 0.15, 0.14, x, 0.045, 0, GREY); // gangways
  return { ...p, fixed: mergeParts(p.fixed, g.build()) };
}
function tubeCab(): Parts {
  const p = tubeBody([-0.29, 0], [[-0.145, 0.18], [0.145, 0.18], [-0.38, 0.07], [0.31, 0.12]]);
  const g = new Kit(), w = new Kit();
  g.box(0.02, 0.15, 0.14, -0.425, 0.045, 0, GREY);                                  // gangway at the back
  g.box(0.016, 0.17, 0.17, 0.427, 0.04, 0, 0x2b2d33);                                // the nose
  g.box(0.014, 0.022, 0.12, 0.433, 0.05, 0, YELLOW);                                 // warning panel
  w.box(0.014, 0.065, 0.14, 0.434, 0.115, 0, 0xffffff);                              // windscreen
  return { ...p, fixed: mergeParts(p.fixed, g.build()), glass: mergeParts(p.glass!, w.build()) };
}
function mergeParts(a: BufferGeometry, b: BufferGeometry): BufferGeometry { return mergeGeometries([a, b], false)!; }
/** a rider seen through a carriage window: head and shoulders, a thin plate standing against the glass (base at the sill) */
function figure(): BufferGeometry {
  return mergeGeometries([new BoxGeometry(0.022, 0.032, 0.004).translate(0, 0.016, 0), new BoxGeometry(0.013, 0.014, 0.004).translate(0, 0.039, 0)], false)!;
}
const CLOTHES = [0x2a2d35, 0x3b2f2a, 0x1f3a52, 0x4a2a2f, 0x2c4a3a, 0x55504a, 0x6a3b2a, 0x1a1c22, 0x5a6270].map((c) => new Color(c));
const SILVER = new Color(0xc9ced6);

/** a short wagon's frame and two bogies (wagons are RAIL_VEHICLE_LEN 0.58 long) */
function wagonChassis(k: Kit) {
  k.box(0.56, 0.03, 0.17, 0, 0.025, 0, UNDER);
  for (const x of [-0.19, 0.19]) {
    k.box(0.13, 0.035, 0.18, x, 0.0, 0, BOGIE);
    for (const dx of [-0.04, 0.04]) for (const z of [-0.075, 0.075]) k.wheel(0.022, 0.02, x + dx, 0.022, z, BOGIE);
  }
  for (const x of [-0.29, 0.29]) k.box(0.01, 0.03, 0.12, x, 0.04, 0, GREY); // buffers
}
/** container flat: a deck with one or two boxes on it (the boxes take the trim colour) */
function flatWagon(): Parts {
  const shell = new Kit(), trim = new Kit(), fixed = new Kit();
  wagonChassis(fixed);
  shell.box(0.57, 0.025, 0.19, 0, 0.055, 0, 0xffffff);
  trim.box(0.26, 0.17, 0.19, -0.135, 0.08, 0, 0xffffff).box(0.26, 0.17, 0.19, 0.135, 0.08, 0, 0xe8e8e8);
  for (const x of [-0.135, 0.135]) fixed.box(0.005, 0.15, 0.17, x + 0.131, 0.09, 0, 0x55595f); // door ends
  return { shell: shell.build(), trim: trim.build(), fixed: fixed.build(), glass: null };
}
function tankWagon(): Parts {
  const shell = new Kit(), trim = new Kit(), fixed = new Kit();
  wagonChassis(fixed);
  shell.part(new CylinderGeometry(0.085, 0.085, 0.52, 12).rotateZ(Math.PI / 2).translate(0, 0.15, 0), 0xffffff);
  trim.box(0.53, 0.02, 0.172, 0, 0.13, 0, 0xffffff);                              // a band along the barrel
  fixed.part(new CylinderGeometry(0.03, 0.03, 0.03, 8).translate(0, 0.25, 0), GREY).box(0.5, 0.008, 0.06, 0, 0.235, 0, GREY); // dome and walkway
  return { shell: shell.build(), trim: trim.build(), fixed: fixed.build(), glass: null };
}
function hopperWagon(): Parts {
  const shell = new Kit(), trim = new Kit(), fixed = new Kit();
  wagonChassis(fixed);
  shell.box(0.54, 0.14, 0.19, 0, 0.1, 0, 0xffffff);
  for (const x of [-0.13, 0.13]) shell.part(new CylinderGeometry(0.04, 0.09, 0.06, 4).rotateY(Math.PI / 4).translate(x, 0.07, 0), 0xffffff); // chutes
  trim.box(0.55, 0.02, 0.195, 0, 0.24, 0, 0xffffff);
  for (let i = 0; i < 4; i++) fixed.box(0.01, 0.13, 0.195, -0.2 + i * 0.133, 0.105, 0, 0x55595f); // ribs
  return { shell: shell.build(), trim: trim.build(), fixed: fixed.build(), glass: null };
}
function coveredVan(): Parts {
  const shell = new Kit(), trim = new Kit(), fixed = new Kit();
  wagonChassis(fixed);
  shell.box(0.55, 0.18, 0.19, 0, 0.055, 0, 0xffffff);
  trim.part(new CylinderGeometry(0.1, 0.1, 0.56, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.25, 0.97).translate(0, 0.235, 0), 0xffffff); // curved roof
  fixed.box(0.14, 0.15, 0.195, 0, 0.065, 0, 0x55595f);                            // sliding door
  return { shell: shell.build(), trim: trim.build(), fixed: fixed.build(), glass: null };
}
/** wagon body colours (by hash, per wagon) and container colours */
const WAGON_COLOURS = [0x6b4a33, 0x3d4a3e, 0x7a2f26, 0x55595f, 0x2e3a52, 0x8a6a3a].map((c) => new Color(c));
const TANK_COLOURS = [0x1f2124, 0xe8eaec, 0xb9bec4, 0x2a2c30, 0xd8d2c0].map((c) => new Color(c));
const BOX_COLOURS = [0x2f6fb5, 0xd9752b, 0x4f9a5c, 0xcb3b2d, 0x2d4a9c, 0xe6b734, 0x8e5bd6, 0xe8e8e8].map((c) => new Color(c));
function locomotive(): Parts {
  const shell = new Kit(), trim = new Kit(), fixed = new Kit(), glass = new Kit();
  chassis(fixed);
  shell.box(0.84, 0.2, W, 0, 0.05, 0, 0xffffff);
  trim.box(0.845, 0.03, W + 0.004, 0, 0.1, 0, 0xffffff);                        // a band down each side
  trim.box(0.06, 0.14, W + 0.004, 0.31, 0.07, 0, 0xffffff);                     // cab door
  for (const x of [-0.425, 0.425]) {
    glass.box(0.012, 0.07, 0.17, x, 0.16, 0, 0xffffff);                         // a cab at each end
    fixed.box(0.012, 0.07, 0.19, x * 1.002, 0.06, 0, YELLOW);
    glass.box(0.08, 0.06, W + 0.008, x * 0.82, 0.16, 0, 0xffffff);
  }
  for (const x of [-0.12, 0, 0.12]) fixed.box(0.08, 0.08, W + 0.006, x, 0.12, 0, GREY); // grilles
  // pantograph up to the contact wire
  fixed.box(0.14, 0.015, 0.1, 0.12, 0.272, 0, BOGIE);
  fixed.part(new BoxGeometry(0.012, 0.1, 0.012).rotateZ(0.5).translate(0.1, 0.33, 0), BOGIE);
  fixed.box(0.02, 0.01, 0.15, 0.08, 0.37, 0, BOGIE);
  return { shell: shell.build(), trim: trim.build(), fixed: fixed.build(), glass: glass.build() };
}

interface TypeMeshes { shell: InstancedMesh; trim: InstancedMesh; fixed: InstancedMesh; glass: InstancedMesh | null; n: number }

/** catenary furniture of one chunk: mast positions and wire segments */
interface ChunkWires { masts: number[]; wires: number[] }
const WIRE_Y = 0.37, MAST_OFF = 0.36;

export class TrainsView {
  group = new Group();
  /**
   * The underground view's trains and their riders (docs/underground.md section 5). Not inside `group`, which the view
   * ghosts with the rest of the surface; shown while `level` (how far the view is up, 0..1, set by main.ts) is above SHOW_LEVEL.
   */
  readonly under = new Group();
  level = 0;
  /** the under layer's byte at a tile, so tube trains can follow a crossover's dip (set by main.ts) */
  underAt: ((x: number, y: number) => number) | null = null;
  /** the lines as the server last sent them: the surface's, then the metro's (line ids are unique across modes) */
  lines: RailLineDTO[] = [];
  private surfaceLines: RailLineDTO[] = []; private metroLines: RailLineDTO[] = [];
  private services: { dto: RailLineDTO; svc: RailService }[] = [];
  private types: TypeMeshes[];
  private glassMat = new MeshBasicMaterial({ toneMapped: false });
  private tubeGlass = new MeshBasicMaterial({ toneMapped: false });
  private tLightBoxes: InstancedMesh; private tGlow: InstancedMesh; private nTLights = 0;
  /** riders seen through the windows, from 'metroLoads' (riders per train, by train index) */
  private figures: InstancedMesh; private nFig = 0;
  private loads = new Map<number, number[]>();
  private lightBoxes: InstancedMesh;
  private glow: InstancedMesh;
  private glowMat = new MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  private masts: InstancedMesh;
  private arms: InstancedMesh;
  private wires: InstancedMesh;
  private chunks = new Map<string, ChunkWires>();
  private wiresChanged = true;
  private m = new Matrix4(); private mi = new Matrix4();
  private p = new Vector3(); private q = new Quaternion(); private qz = new Quaternion(); private s = new Vector3(1, 1, 1);
  private col = new Color();
  private states: TrainState[] = [];
  private poses: VehiclePose[] = [];
  private nLights = 0;
  /** trains drawn last frame, by line id (window.msc and checks read it) */
  drawn = new Map<number, TrainState[]>();
  /** vehicle centres drawn last frame, flat x, y, z, line id, train, for picking */
  private picks: number[] = [];
  /** freeze trains at a tick (screenshots) */
  debugTick: number | null = null;
  /** the train under the cursor and the selected one: drawn brighter (the selected one pulsing) */
  hover: { line: number; train: number } | null = null;
  selected: { line: number; train: number } | null = null;
  /** the tick drawn last frame, so a cab view sits exactly on the train as drawn */
  lastTick = 0;

  constructor() {
    const mat = vehicleMaterial();
    // the tube stock has its own materials: the underground view ghosts the surface's by material, and no sun reaches the bores (a fill keeps them readable)
    const tubeMat = vehicleMaterial();
    tubeMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.4;');
    };
    const mk = (parts: Parts, tube = false): TypeMeshes => {
      const cap = tube ? MAX_TUBE : MAX_VEHICLES, into = tube ? this.under : this.group;
      const t: TypeMeshes = {
        shell: new InstancedMesh(parts.shell, tube ? tubeMat : mat, cap), trim: new InstancedMesh(parts.trim, tube ? tubeMat : mat, cap),
        fixed: new InstancedMesh(parts.fixed, tube ? tubeMat : mat, cap), glass: parts.glass ? new InstancedMesh(parts.glass, tube ? this.tubeGlass : this.glassMat, cap) : null, n: 0,
      };
      for (const mesh of [t.shell, t.trim, t.fixed, t.glass]) {
        if (!mesh) continue;
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = !tube && mesh !== t.glass; mesh.receiveShadow = !tube;
        mesh.setColorAt(0, WHITE);
        into.add(mesh);
      }
      return t;
    };
    // by RailVehicle kind: locomotive, carriage, driving trailer, container flat, tank, hopper, covered van, tube motor car, tube car
    this.types = [mk(locomotive()), mk(carriage(false)), mk(carriage(true)), mk(flatWagon()), mk(tankWagon()), mk(hopperWagon()), mk(coveredVan()), mk(tubeCab(), true), mk(tubeCar(), true)];
    this.tLightBoxes = new InstancedMesh(new BoxGeometry(0.02, 0.025, 0.035), new MeshBasicMaterial({ toneMapped: false }), MAX_TUBE_LIGHTS);
    this.tGlow = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), MAX_TUBE_LIGHTS);
    this.figures = new InstancedMesh(figure(), new MeshBasicMaterial({ toneMapped: false }), MAX_FIGURES);
    for (const mesh of [this.tLightBoxes, this.tGlow, this.figures]) { mesh.count = 0; mesh.frustumCulled = false; mesh.setColorAt(0, WHITE); this.under.add(mesh); }
    this.under.visible = false;
    this.lightBoxes = new InstancedMesh(new BoxGeometry(0.02, 0.025, 0.035), new MeshBasicMaterial({ toneMapped: false }), MAX_LIGHTS);
    this.glow = new InstancedMesh(new IcosahedronGeometry(1, 1), this.glowMat, MAX_LIGHTS);
    for (const mesh of [this.lightBoxes, this.glow]) { mesh.count = 0; mesh.frustumCulled = false; mesh.setColorAt(0, WHITE); this.group.add(mesh); }
    const steel = vehicleMaterial();
    const mastKit = new Kit(); mastKit.box(0.022, WIRE_Y + 0.06, 0.022, 0, 0, 0, 0x8a8f96).box(0.05, 0.02, 0.05, 0, 0, 0, 0x55595f);
    const armKit = new Kit(); armKit.box(1, 0.012, 0.012, 0.5, 0, 0, 0x8a8f96);
    const wireKit = new Kit(); wireKit.box(1, 0.005, 0.005, 0, 0, 0, 0x2b2d31);
    this.masts = new InstancedMesh(mastKit.build(), steel, 20000);
    this.arms = new InstancedMesh(armKit.build(), steel, 20000);
    this.wires = new InstancedMesh(wireKit.build(), steel, 40000);
    for (const mesh of [this.masts, this.arms, this.wires]) { mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = mesh === this.masts; this.group.add(mesh); }
    this.group.add(this.crossings.group);
  }

  /** New line list from the server: services are rebuilt from each running line's definition and route. */
  setLines(lines: RailLineDTO[]) { this.surfaceLines = lines; this.rebuildServices(); }
  /** The metro's lines ('metroLines'): their services run in the bores, drawn while the underground view is up. */
  setMetroLines(lines: RailLineDTO[]) { this.metroLines = lines; this.rebuildServices(); }
  /** Riders per train of each metro line ('metroLoads' l: [lineId, trains, load0, ...]), for the crowds at the windows. */
  setLoads(l: number[]) {
    this.loads.clear();
    for (let i = 0; i + 1 < l.length;) { const n = l[i + 1]; this.loads.set(l[i], l.slice(i + 2, i + 2 + n)); i += 2 + n; }
  }
  private rebuildServices() {
    this.lines = [...this.surfaceLines, ...this.metroLines];
    this.services = this.lines.filter((l) => l.route && l.status === 'running').map((dto) => ({ dto, svc: railService(dto, dto.route!) }));
    this.svcs = this.services.filter((s) => !s.svc.metro).map((s) => s.svc); // level crossings are the surface's
  }
  private svcs: RailService[] = [];
  /** level-crossing barriers and lamps (render/crossings.ts), timed from the same services */
  readonly crossings = new CrossingsView();
  /** The service of a line, if it runs. */
  serviceOf(id: number): RailService | undefined { return this.services.find((s) => s.dto.id === id)?.svc; }

  // ---- overhead line --------------------------------------------------------------------------------
  /** Re-read one chunk's track (after chunkView rebuilt it): a mast every other straight tile, wire over every piece. */
  scanChunk(key: string, c: ClientChunk) {
    this.crossings.scanChunk(key, c);
    const had = this.chunks.has(key);
    const masts: number[] = [], wires: number[] = [];
    for (let i = 0; i < c.aux.length; i++) {
      const a = c.aux[i];
      if (!a || !isRailAux(a)) continue;
      const m = railMask(a);
      const x = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE), z = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      const ns = (m & 5) === 5, ew = (m & 10) === 10, road = isRoad(c.tiles[i]); // no mast in the road on a level crossing
      // straights: wire end to end, a mast on one side every other tile (organic: the side alternates by run)
      if (ew) { wires.push(x, z + 0.5, x + 1, z + 0.5); if (!road && ((x % 2) + 2) % 2 === 0) masts.push(x + 0.5, z + 0.5 + (hash2(z, 3) < 0.5 ? MAST_OFF : -MAST_OFF), x + 0.5, z + 0.5); }
      if (ns) { wires.push(x + 0.5, z, x + 0.5, z + 1); if (!road && ((z % 2) + 2) % 2 === 0) masts.push(x + 0.5 + (hash2(x, 5) < 0.5 ? MAST_OFF : -MAST_OFF), z + 0.5, x + 0.5, z + 0.5); }
      // curves (any two adjacent sides joined, as the atlas draws them): two chords round the corner
      const mids = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
      for (let s = 0; s < 4; s++) {
        const t = (s + 1) & 3;
        if (!(m & (1 << s)) || !(m & (1 << t))) continue;
        if (m === 15) continue; // a diamond crossing has no curves
        const sides = [0, 1, 2, 3].filter((q) => m & (1 << q));
        if (sides.length === 3 && (m & (1 << ((s + 2) & 3))) && (m & (1 << ((t + 2) & 3)))) continue; // a turnout curves only into its branch
        const cxr = mids[s][0] === 0.5 ? mids[t][0] : mids[s][0], czr = mids[s][1] === 0.5 ? mids[t][1] : mids[s][1];
        const a0 = Math.atan2(mids[s][1] - czr, mids[s][0] - cxr), a1 = Math.atan2(mids[t][1] - czr, mids[t][0] - cxr);
        let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        const pt = (f: number) => [x + cxr + 0.5 * Math.cos(a0 + da * f), z + czr + 0.5 * Math.sin(a0 + da * f)];
        const [p0, p1, p2] = [pt(0), pt(0.5), pt(1)];
        wires.push(p0[0], p0[1], p1[0], p1[1], p1[0], p1[1], p2[0], p2[1]);
        if (sides.length === 2) { const o = pt(0.5); masts.push(x + cxr + (o[0] - x - cxr) * 1.7, z + czr + (o[1] - z - czr) * 1.7, o[0], o[1]); }
      }
    }
    if (masts.length || wires.length) this.chunks.set(key, { masts, wires }); else this.chunks.delete(key);
    if (had || masts.length || wires.length) this.wiresChanged = true;
  }
  dropChunk(key: string) { this.crossings.dropChunk(key); if (this.chunks.delete(key)) this.wiresChanged = true; }

  private rebuildWires() {
    this.wiresChanged = false;
    let nm = 0, nw = 0;
    const up = new Vector3(0, 1, 0);
    for (const { masts, wires } of this.chunks.values()) {
      for (let i = 0; i + 3 < masts.length && nm < this.masts.instanceMatrix.count; i += 4) {
        const mx = masts[i], mz = masts[i + 1], tx = masts[i + 2], tz = masts[i + 3];
        this.m.makeTranslation(mx, 0, mz);
        this.masts.setMatrixAt(nm, this.m);
        const len = Math.hypot(tx - mx, tz - mz);
        this.q.setFromAxisAngle(up, -Math.atan2(tz - mz, tx - mx));
        this.m.compose(this.p.set(mx, WIRE_Y + 0.04, mz), this.q, this.s.set(len, 1, 1));
        this.arms.setMatrixAt(nm, this.m);
        nm++;
      }
      for (let i = 0; i + 3 < wires.length && nw < this.wires.instanceMatrix.count; i += 4) {
        const x0 = wires[i], z0 = wires[i + 1], x1 = wires[i + 2], z1 = wires[i + 3];
        this.q.setFromAxisAngle(up, -Math.atan2(z1 - z0, x1 - x0));
        this.m.compose(this.p.set((x0 + x1) / 2, WIRE_Y, (z0 + z1) / 2), this.q, this.s.set(Math.hypot(x1 - x0, z1 - z0) + 0.01, 1, 1));
        this.wires.setMatrixAt(nw++, this.m);
      }
    }
    this.s.set(1, 1, 1);
    this.masts.count = nm; this.arms.count = nm; this.wires.count = nw;
    for (const mesh of [this.masts, this.arms, this.wires]) mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- trains -----------------------------------------------------------------------------------------
  frame(tick: number) {
    if (this.wiresChanged) this.rebuildWires();
    const night = sceneUniforms.uNight.value;
    const t = this.debugTick ?? tick;
    this.lastTick = t;
    this.crossings.frame(t, this.svcs);
    for (const ty of this.types) ty.n = 0;
    this.nLights = 0; this.nTLights = 0; this.nFig = 0;
    const under = this.level > SHOW_LEVEL;
    this.under.visible = under;
    this.drawn.clear();
    this.picks.length = 0;
    // glass: blue-grey by day, warm and lit at night (the per-vehicle colour gives each carriage its own warmth)
    this.glassMat.color.setRGB(0.22 + 0.95 * night, 0.27 + 0.8 * night, 0.34 + 0.5 * night);
    this.glowMat.opacity = 0.18 + 0.5 * night;
    const day = Math.floor(t / TICKS_PER_DAY);
    for (const { dto, svc } of this.services) {
      if (svc.metro && !under) continue;
      const states = trainsAt(svc, t, this.states).map((s) => ({ ...s }));
      this.drawn.set(dto.id, states);
      for (const st of states) this.drawTrain(dto, svc, st, night, day);
    }
    for (const ty of this.types) for (const mesh of [ty.shell, ty.trim, ty.fixed, ty.glass]) {
      if (!mesh) continue;
      mesh.count = ty.n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.lightBoxes.count = this.nLights; this.glow.count = this.nLights;
    this.tLightBoxes.count = this.nTLights; this.tGlow.count = this.nTLights; this.figures.count = this.nFig;
    for (const mesh of [this.lightBoxes, this.glow, this.tLightBoxes, this.tGlow, this.figures]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }

  private drawTrain(dto: RailLineDTO, svc: RailService, st: TrainState, night: number, _day: number) {
    const line = this.col.setHex(dto.color).clone();
    const hv = hash2(dto.id * 13 + st.train, 29);
    const metro = svc.metro;
    const liveryB = hv < 0.5; // white with a band of the line colour, else the colour with white trim
    const wear = 0.9 + 0.1 * hash2(dto.id + st.train * 7, 31);
    // hovered or selected: lifted above full brightness (instance colours are float), the selected one pulsing gently
    const mine = (h: { line: number; train: number } | null) => !!h && h.line === dto.id && h.train === st.train;
    const lift = mine(this.selected) ? 1.3 + 0.2 * Math.sin(performance.now() / 260) : mine(this.hover) ? 1.25 : 1;
    // tube stock: silver sides with the line's colour on the doors and stripe, or (a train in four) painted in the line's colour with pale doors
    const painted = metro && hv < 0.25;
    const main = (metro ? (painted ? line.clone().multiplyScalar(0.85) : SILVER.clone()) : liveryB ? PALE.clone() : line.clone()).multiplyScalar(wear * lift);
    const accent = (metro ? (painted ? PALE.clone() : line.clone()) : liveryB ? line.clone() : WHITE.clone()).multiplyScalar(wear * lift);
    const poses = trainPoses(svc, st, this.poses);
    const n = poses.length;
    // a metro train runs in the bore to the left of its direction of travel, and crosses over in the middle of its dwell at a terminus
    const off = metro ? metroBore(svc, st) * BORE_OFF : 0, base = metro ? TUBE_TOP : RAIL_TOP, cap = metro ? MAX_TUBE : MAX_VEHICLES;
    const pickable = !metro || this.level > USE_LEVEL;
    const riders = metro && this.level > USE_LEVEL && !mine(this.ridden) ? (this.loads.get(dto.id)?.[st.train] ?? 0) / Math.max(1, n) : 0;
    for (const v of poses) {
      const ty = this.types[v.kind];
      const i = ty.n;
      if (i >= cap) continue;
      ty.n++;
      const vx = v.x + Math.sin(v.h) * off, vz = v.z - Math.cos(v.h) * off;
      if (pickable) this.picks.push(vx, metro ? base + 0.1 : 0.15, vz, dto.id, st.train);
      // a crossover dips the north-south bores: the car rides down and up it on its bogies
      let dy = 0, pitch = 0;
      if (metro && this.underAt) { this.dipPose(v.x, v.z, v.h); dy = this.dipY; pitch = v.flip ? -this.dipPitch : this.dipPitch; }
      this.q.setFromAxisAngle(UP, -v.h + (v.flip ? Math.PI : 0));
      if (pitch) this.q.multiply(this.qz.setFromAxisAngle(AXIS_Z, pitch));
      this.m.compose(this.p.set(vx, base + dy, vz), this.q, this.s.set(1, 1, 1));
      for (const mesh of [ty.shell, ty.trim, ty.fixed, ty.glass]) mesh?.setMatrixAt(i, this.m);
      ty.fixed.setColorAt(i, lift > 1 ? this.col.copy(WHITE).multiplyScalar(lift) : WHITE);
      if (v.kind >= 3 && v.kind <= 6) {
        // wagons: their own colours, seeded per wagon (organic rule); containers mixed on the flats
        const hw = hash2(dto.id * 97 + st.train * 13 + v.j, 41), hc = hash2(dto.id * 53 + st.train * 29 + v.j, 43);
        ty.shell.setColorAt(i, (v.kind === 4 ? TANK_COLOURS[Math.floor(hw * TANK_COLOURS.length)] : WAGON_COLOURS[Math.floor(hw * WAGON_COLOURS.length)]).clone().multiplyScalar(wear * lift));
        ty.trim.setColorAt(i, (v.kind === 3 ? BOX_COLOURS[Math.floor(hc * BOX_COLOURS.length)] : (v.kind === 4 ? WAGON_COLOURS[Math.floor(hc * WAGON_COLOURS.length)] : TANK_COLOURS[Math.floor(hc * 3)])).clone().multiplyScalar(lift));
        continue;
      }
      // lit windows: each vehicle its own warmth and brightness, a few dim ones (organic rule)
      const hw = hash2(dto.id * 31 + st.train * 5 + v.j, 37);
      if (metro) {
        // each car its own grime on the sides, and its own lamp colour and brightness in the saloon, lit at every hour
        ty.shell.setColorAt(i, this.col.copy(main).multiplyScalar(0.92 + 0.08 * hash2(dto.id * 19 + st.train * 11 + v.j, 73)));
        ty.trim.setColorAt(i, accent);
        this.col.setRGB(1, 0.9 + 0.08 * hw, 0.66 + 0.3 * hw).multiplyScalar(hw < 0.1 ? 0.6 : 0.85 + 0.15 * hw);
        ty.glass?.setColorAt(i, this.col);
        if (riders > 0) this.seat(dto.id, st.train, v, vx, vz, riders, dy);
        continue;
      }
      ty.shell.setColorAt(i, main);
      ty.trim.setColorAt(i, accent);
      this.col.setRGB(1, 0.86 + 0.1 * hw, 0.62 + 0.25 * hw).multiplyScalar(v.kind === 0 ? 0.7 : hw < 0.12 ? 0.45 : 0.8 + 0.2 * hw);
      ty.glass?.setColorAt(i, this.col);
    }
    // head lights at the leading end in the direction of travel, red tail lights at the other
    const lead = st.dir > 0 ? poses[0] : poses[n - 1], tail = st.dir > 0 ? poses[n - 1] : poses[0];
    const sz = metro ? 0.04 : 0.03 + 0.06 * night; // a tunnel is dark at every hour
    for (const z of [-0.065, 0.065]) {
      this.light(lead, st.dir * (CAR_LEN / 2 + 0.005), z, 0.07, HEAD, sz * (st.phase === 'dwell' ? 0.6 : 1), metro, off, metro ? this.leadDy(lead, st.dir) : 0);
      this.light(tail, -st.dir * (CAR_LEN / 2 + 0.005), z, 0.07, TAIL, sz * 0.6, metro, off, metro ? this.leadDy(tail, -st.dir) : 0);
    }
  }
  /** a crossover's dip under a car at (x, z) heading h: the height of its middle (dipY) and its pitch (dipPitch), from the bogies' two points */
  private dipY = 0; private dipPitch = 0;
  private dipPose(x: number, z: number, h: number) {
    const c = Math.cos(h) * 0.3, s = Math.sin(h) * 0.3;
    const f = this.dropAt(x + c, z + s, h), b = this.dropAt(x - c, z - s, h);
    this.dipY = -(f + b) / 2;
    this.dipPitch = f === b ? 0 : Math.atan2(b - f, 0.6);
  }
  private dropAt(x: number, z: number, h: number): number { return crossoverDip(this.underAt!(Math.floor(x), Math.floor(z)), x, z, h).drop; }
  /** the dip at the end of a car, for its head and tail lamps */
  private leadDy(v: VehiclePose, dir: number): number {
    if (!this.underAt) return 0;
    return -this.dropAt(v.x + Math.cos(v.h) * dir * CAR_LEN / 2, v.z + Math.sin(v.h) * dir * CAR_LEN / 2, v.h);
  }
  private light(v: VehiclePose, dx: number, dz: number, y: number, color: Color, glow: number, tube = false, off = 0, dy = 0) {
    const boxes = tube ? this.tLightBoxes : this.lightBoxes, halo = tube ? this.tGlow : this.glow;
    if ((tube ? this.nTLights : this.nLights) >= boxes.instanceMatrix.count) return;
    const k = tube ? this.nTLights++ : this.nLights++;
    const c = Math.cos(v.h), s = Math.sin(v.h);
    this.p.set(v.x + c * dx - s * dz + s * off, (tube ? TUBE_TOP : RAIL_TOP) + y + dy, v.z + s * dx + c * dz - c * off);
    this.q.setFromAxisAngle(UP, -v.h);
    this.m.compose(this.p, this.q, this.s.set(1, 1, 1));
    boxes.setMatrixAt(k, this.m);
    boxes.setColorAt(k, color);
    this.mi.makeScale(glow, glow, glow).setPosition(this.p);
    halo.setMatrixAt(k, this.mi);
    halo.setColorAt(k, color);
  }
  /**
   * The riders of one car, seen through its windows: `per` is the riders per car ('metroLoads' over the cars), drawn as up to
   * eight head-and-shoulders silhouettes against the lit glass, each at its own spot, seated or standing, in its own clothes.
   */
  private seat(line: number, train: number, v: VehiclePose, vx: number, vz: number, per: number, dy = 0) {
    if (per < 0.5) return;
    const cls = hash2(line * 41 + train * 7 + v.j, 75);
    const k = Math.min(8, 1 + Math.floor(per / 5)) + (cls < 0.25 ? -1 : cls > 0.8 ? 1 : 0);
    const c = Math.cos(v.h), s = Math.sin(v.h);
    for (let r = 0; r < Math.min(8, k) && this.nFig < MAX_FIGURES; r++) {
      const h1 = hash2(line * 53 + train * 29 + v.j * 7 + r, 79), h2 = hash2(line * 59 + train * 31 + v.j * 11 + r, 83), h3 = hash2(line * 61 + train * 37 + v.j * 13 + r, 89);
      const lx = (h1 < 0.4 ? -0.145 : h1 < 0.8 ? 0.145 : h1 < 0.9 ? -0.38 : 0.38) + (h2 - 0.5) * (h1 < 0.8 ? 0.12 : 0.03);
      const lz = (h3 < 0.5 ? -1 : 1) * (TUBE_W / 2 + 0.0095);
      this.q.setFromAxisAngle(UP, -v.h);
      this.m.compose(this.p.set(vx + c * lx - s * lz, TUBE_TOP + 0.118 + dy, vz + s * lx + c * lz), this.q, this.s.set(1, h2 < 0.45 ? 1.2 : 0.95, 1));
      this.figures.setMatrixAt(this.nFig, this.m);
      this.figures.setColorAt(this.nFig, this.col.copy(CLOTHES[Math.floor(hash2(line * 67 + train * 41 + v.j * 17 + r, 97) * CLOTHES.length)]).multiplyScalar(0.7 + 0.6 * h1));
      this.nFig++;
    }
    this.s.set(1, 1, 1);
  }

  /** The train under a screen point (within `radius` px of one of its vehicles), or null. */
  pick(px: number, py: number, camera: Camera, w: number, h: number, radius = 22): { line: number; train: number } | null {
    let best: { line: number; train: number } | null = null, bd = radius * radius;
    const v = new Vector3();
    camera.updateMatrixWorld();
    for (let i = 0; i < this.picks.length; i += 5) {
      v.set(this.picks[i], this.picks[i + 1], this.picks[i + 2]).project(camera);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h, d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) { bd = d; best = { line: this.picks[i + 3], train: this.picks[i + 4] }; }
    }
    return best;
  }
  /** A train of a line as drawn last frame (or at `tick`), or null when it is not in service. */
  stateOf(line: number, train: number, tick = this.lastTick): TrainState | null {
    const svc = this.serviceOf(line);
    return svc ? trainsAt(svc, tick, []).find((s) => s.train === train) ?? null : null;
  }
  /**
   * The driver's eye of a train as drawn last frame: just ahead of the leading cab (the locomotive, or the driving
   * trailer on the way home), at window height, and the heading of travel along the track.
   */
  cabOf(line: number, train: number): { x: number; y: number; z: number; h: number; st: TrainState; s: number; dir: 1 | -1; off: number; pitch: number } | null {
    const svc = this.serviceOf(line), st = this.stateOf(line, train);
    if (!svc || !st) return null;
    const poses = trainPoses(svc, st, []);
    // standing at either end of a there-and-back line the driver changes ends halfway through the stand
    let dir = st.dir;
    if (st.phase === 'dwell' && !svc.geom.loop && (st.stop === 0 || st.stop === svc.geom.stopS.length - 1) && st.progress < 0.5) dir = -dir as 1 | -1;
    const lead = dir > 0 ? poses[0] : poses[poses.length - 1];
    const h = lead.h + (dir > 0 ? 0 : Math.PI), d = CAR_LEN / 2 + 0.012;
    // a metro driver sits in the bore the train runs in, at METRO_Y
    const off = svc.metro ? metroBore(svc, st) * BORE_OFF : 0;
    const x = lead.x + Math.cos(h) * d + Math.sin(lead.h) * off, z = lead.z + Math.sin(h) * d - Math.cos(lead.h) * off;
    let dy = 0, pitch = 0;
    if (svc.metro && this.underAt) { const cd = crossoverDip(this.underAt(Math.floor(x), Math.floor(z)), x, z, h); dy = -cd.drop; pitch = Math.atan(cd.slope); }
    return { x, y: (svc.metro ? TUBE_TOP : RAIL_TOP) + 0.165 + dy, z, h, st, s: st.s + dir * (svc.length / 2 + 0.012), dir, off, pitch };
  }
  /**
   * One vehicle of a train as drawn last frame, for a passenger's seat (render/passenger.ts): its middle at rail height (in its
   * bore for a tube car, down a crossover's dip), the heading of the track (+x of its frame, towards the train's front), the
   * crossover's pitch, the arclength of its middle, the way the train runs and its bore offset. Reuses `out` and its own arrays.
   */
  carOf(line: number, train: number, car: number, out: CarPose): CarPose | null {
    const svc = this.serviceOf(line);
    if (!svc) return null;
    // the state drawn this frame (a tube train is drawn only while a ride or the underground view has the trains up)
    let st: TrainState | null = null;
    const drawn = this.drawn.get(line) ?? trainsAt(svc, this.lastTick, this.carStates);
    for (let i = 0; i < drawn.length; i++) if (drawn[i].train === train) { st = drawn[i]; break; }
    if (!st) return null;
    const poses = trainPoses(svc, st, this.carPoses);
    const v = poses[Math.min(car, poses.length - 1)];
    const kinds = svc.consists[train] ?? svc.consists[0];
    let s = st.s + svc.length / 2;
    for (let j = 0; j < v.j; j++) s -= RAIL_VEHICLE_LEN[kinds[j]] + RAIL_VEHICLE_GAP;
    s -= RAIL_VEHICLE_LEN[kinds[v.j]] / 2;
    const off = svc.metro ? metroBore(svc, st) * BORE_OFF : 0;
    out.x = v.x + Math.sin(v.h) * off; out.z = v.z - Math.cos(v.h) * off; out.h = v.h; out.pitch = 0;
    out.y = svc.metro ? TUBE_TOP : RAIL_TOP;
    if (svc.metro && this.underAt) { this.dipPose(v.x, v.z, v.h); out.y += this.dipY; out.pitch = this.dipPitch; }
    out.s = s; out.dir = st.dir; out.off = off; out.st = st; out.metro = !!svc.metro; out.cars = poses.length;
    return out;
  }
  private carStates: TrainState[] = []; private carPoses: VehiclePose[] = [];
  /** riders seen at the windows (metroLoads) of a tube train: the one a passenger rides in is not drawn (their own car's window figures would be in their view) */
  ridden: { line: number; train: number } | null = null;
  /** riders on board a tube train as 'metroLoads' last said */
  loadOf(line: number, train: number): number { return this.loads.get(line)?.[train] ?? 0; }
  /** The consist of a line's train (vehicle kinds, front first), for its tooltip. */
  consistOf(line: number, train: number): number[] | null { const svc = this.serviceOf(line); return svc ? svc.consists[train] ?? null : null; }

  /** Debug: the first tick at or after `from` when a running train of line `id` has its middle on tile (x, y). */
  findOnTile(id: number, x: number, y: number, from: number, span = TICKS_PER_DAY): number | null {
    const svc = this.serviceOf(id);
    if (!svc) return null;
    const p = { x: 0, z: 0, h: 0 };
    for (let t = from; t < from + span; t += 0.5) {
      for (const s of trainsAt(svc, t, [])) { if (s.phase !== 'run') continue; railPoint(svc.geom, s.s, p); if (Math.floor(p.x) === x && Math.floor(p.z) === y) return t; }
    }
    return null;
  }
  /** Debug: the first tick at or after `from` when line `id` has a train in `phase` (optionally at stop `stop`). */
  findTick(id: number, phase: 'dwell' | 'run', from: number, stop = -1, span = TICKS_PER_DAY): number | null {
    const svc = this.serviceOf(id);
    if (!svc) return null;
    for (let t = from; t < from + span; t += 0.5) {
      if (trainsAt(svc, t, []).some((s) => s.phase === phase && (stop < 0 || s.stop === stop) && (phase === 'dwell' || s.progress > 0.4))) return t;
    }
    return null;
  }
}
const UP = new Vector3(0, 1, 0), AXIS_Z = new Vector3(0, 0, 1);
/** one vehicle of a train as drawn (TrainsView.carOf) */
export interface CarPose { x: number; y: number; z: number; h: number; pitch: number; s: number; dir: 1 | -1; off: number; st: TrainState | null; metro: boolean; cars: number }
export const carPose = (): CarPose => ({ x: 0, y: 0, z: 0, h: 0, pitch: 0, s: 0, dir: 1, off: 0, st: null, metro: false, cars: 0 });
