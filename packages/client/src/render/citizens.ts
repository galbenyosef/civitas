import { InstancedMesh, RingGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, Matrix4, Color, Vector3, Quaternion, Group, BufferGeometry, InstancedBufferAttribute, Frustum, Sphere, type Camera } from 'three';
import { CitizenState, TICK_MS, Zone, VehicleClass, VehicleKind, citizenState, citizenMode, citizenKind, citizenClass, citizenQueued, citizenEmergency, citizenStage, citizenBag, citizenReversing, citizenIndicator, Indicator, LifeStage, hash2, citizenFleet, fleetLoaded, fleetWorking, citizenUnder, citizenStudy } from '@msimcity/shared';
import { METRO_Y } from './underground';
import { Luggage } from './luggage';
import { Kit } from './kit';
import { P } from './models';
import { vehicleMaterial, sceneUniforms } from './materials';
import { HeadlightPools, IndicatorFlares, LAMP, lampSeed, lampShader, lampAttribute, lampLenses, blinkLit } from './headlights';
import { Crowd, lookOf, dressFor, EYE, type Look } from './people';
import { FleetMeshes } from './fleet';

interface Agent {
  x: number; y: number; px: number; py: number; tx: number; ty: number; t: number;
  hx: number; hy: number;
  state: number; drives: boolean; kind: number; cls: number; queued: boolean; emergency: boolean; last: number;
  /** LifeStage: children are drawn smaller, retirees bob more slowly (the server already walks them slower) */
  stage: number;
  /** last rendered world position, for picking and the follow camera */
  rx: number; rz: number;
  /** smoothed facing angle */
  ang: number;
  /** drawn this frame as a moving walker or driver (not loitering), and as a vehicle */
  trav: boolean; car: boolean;
  /** pedestrians: what they look like and wear (render/people.ts), stride swing and pose, both eased */
  look?: Look; gait: number; pose: number;
  /** the state the look was last checked for */
  dressed?: number;
  /** moving in or leaving town: a suitcase on foot, a roof box on the car (render/luggage.ts) */
  bag?: boolean;
  /** vehicles: the indicators the server says are on (shared Indicator), backing up, and until when (ms) the brake lights stay on after slowing */
  ind: number; rev: boolean; brake: number;
  /** a mobile worker's vehicle (shared FleetKind, render/fleet.ts), with a fare or delivery aboard, at a stop doing the job */
  fleet: number; loaded: boolean; working: boolean;
  /** waiting on a metro platform (CITIZEN_UNDER): drawn only in the underground view */
  under: boolean;
  /** on a school trip (CITIZEN_STUDY): a student's rucksack and lanyard, not a worker's outfit */
  study: boolean;
}

/** Where a first-person camera sits for an agent, in world units (a tile is 1). */
export interface Eye {
  x: number; z: number;
  /** facing as the model's yaw: forward is (cos ang, -sin ang) in (x, z) */
  ang: number;
  height: number;
  car: boolean; travelling: boolean;
  /** tiles per second along the path, 0 when held up or standing */
  speed: number;
  /** body bob phase advance per millisecond (walkers) */
  pace: number;
  /** a car's body colour, 0xrrggbb (the dashboard's bonnet) */
  color?: number;
}

const MAX = 8000;
/** pedestrians closer to the camera than this (tiles) get the detailed figure, up to NEAR_MAX of them */
const NEAR = 13, NEAR_MAX = 2500;
/** the gait phase wraps here: every rate the pose shader uses is a whole number of hundredths, so this is seamless */
const PHASE_WRAP = 200 * Math.PI;
// no near-black paints: faces turned from the sun get ambient light only, and a 0x2b2b2b car then renders as a pure black silhouette from street level
const CAR_PALETTE = [0xe8e8e8, 0x6a707a, 0xc0392b, 0x2e86de, 0xf5f5f5, 0x8e8e8e, 0x3b5fd6, 0xe1b12c, 0x6c9a3c].map((c) => new Color(c));
const FREIGHT_PALETTE = [0x2f6fb5, 0xd9752b, 0x4f9a5c, 0x9d5b30, 0xc8c8c8, 0xe6b734].map((c) => new Color(c));
const EMERGENCY_RED = new Color(0xff3b2f), EMERGENCY_BLUE = new Color(0x3b7bff);
const TYPES = ['sedan', 'truck', 'van'] as const;
/** VehicleClass.Bus: drawn from two meshes, the body in the line colour and the roof, skirt and sign in a pale version of it */
const BUS_CLASS = VehicleClass.Bus;
const BUS_DEFAULT = new Color(0xe6b734), WHITE = new Color(0xffffff);
type VType = typeof TYPES[number];
/** how far either side of the middle each model's headlamps sit (the models below and the beams on the road) */
const LAMP_Z: Record<VType | 'bus', number> = { sedan: 0.06, van: 0.065, truck: 0.07, bus: 0.075 };
/** bumper distance ahead of the centre and headlight beam length and spread, by model */
const BEAM: Record<VType | 'bus', [number, number, number]> = { sedan: [0.17, 0.85, 0.3], van: [0.21, 0.9, 0.32], truck: [0.23, 0.95, 0.34], bus: [0.3, 1.0, 0.36] };
/** where the indicator flares sit on each model: front and rear lamp faces (x), out to the side (z) and height */
const BLINKER: Record<VType | 'bus', [number, number, number, number]> = {
  sedan: [0.184, -0.179, 0.072, 0.085], van: [0.214, -0.219, 0.077, 0.1], truck: [0.231, -0.231, 0.082, 0.082], bus: [0.311, -0.309, 0.088, 0.08],
};
const UP = new Vector3(0, 1, 0);
const LERP_SECONDS = TICK_MS / 1000;
const tmpC = new Color();

// vehicles are sized to the server's VEHICLE_LEN / VEHICLE_WIDTH so two fit a tile with daylight between them
function sedan(): BufferGeometry {
  const k = new Kit();
  k.box(0.34, 0.09, 0.18, 0, 0.045, 0, 0xffffff)
    .box(0.17, 0.075, 0.15, -0.02, 0.135, 0, 0x3d4f68)
    .box(0.025, 0.02, 0.035, 0.17, 0.075, LAMP_Z.sedan, 0xfff2b0, LAMP.head).box(0.025, 0.02, 0.035, 0.17, 0.075, -LAMP_Z.sedan, 0xfff2b0, LAMP.head)
    .box(0.015, 0.02, 0.035, -0.17, 0.075, 0.06, 0xd62020, LAMP.tail).box(0.015, 0.02, 0.035, -0.17, 0.075, -0.06, 0xd62020, LAMP.tail);
  for (const [x, z] of [[0.11, 0.095], [-0.11, 0.095], [0.11, -0.095], [-0.11, -0.095]]) k.wheel(0.04, 0.035, x, 0.04, z, 0x151515);
  return lampLenses(k.build());
}
function van(): BufferGeometry {
  const k = new Kit();
  k.box(0.4, 0.18, 0.2, -0.01, 0.045, 0, 0xffffff)
    .box(0.07, 0.085, 0.18, 0.155, 0.14, 0, 0x3d4f68)
    .box(0.11, 0.03, 0.14, -0.03, 0.225, 0, 0xdde7ff)
    .box(0.025, 0.02, 0.035, 0.2, 0.075, LAMP_Z.van, 0xfff2b0, LAMP.head).box(0.025, 0.02, 0.035, 0.2, 0.075, -LAMP_Z.van, 0xfff2b0, LAMP.head)
    .box(0.015, 0.03, 0.03, -0.21, 0.09, 0.07, 0xd62020, LAMP.tail).box(0.015, 0.03, 0.03, -0.21, 0.09, -0.07, 0xd62020, LAMP.tail);
  for (const [x, z] of [[0.12, 0.105], [-0.13, 0.105], [0.12, -0.105], [-0.13, -0.105]]) k.wheel(0.042, 0.035, x, 0.042, z, 0x151515);
  return lampLenses(k.build());
}
function truck(): BufferGeometry {
  const k = new Kit();
  k.box(0.12, 0.16, 0.2, 0.16, 0.045, 0, 0xffffff)
    .box(0.02, 0.07, 0.17, 0.225, 0.115, 0, 0x3d4f68)
    .box(0.3, 0.035, 0.2, -0.07, 0.045, 0, 0x5c5f66)
    .box(0.09, 0.09, 0.09, -0.12, 0.08, 0.045, P.brick).box(0.075, 0.075, 0.075, -0.02, 0.08, -0.05, P.sand)
    .box(0.012, 0.025, 0.035, 0.224, 0.07, LAMP_Z.truck, 0xfff2b0, LAMP.head).box(0.012, 0.025, 0.035, 0.224, 0.07, -LAMP_Z.truck, 0xfff2b0, LAMP.head)
    .box(0.012, 0.02, 0.03, -0.224, 0.05, 0.08, 0xd62020, LAMP.tail).box(0.012, 0.02, 0.03, -0.224, 0.05, -0.08, 0xd62020, LAMP.tail);
  for (const [x, z] of [[0.15, 0.105], [-0.1, 0.105], [-0.17, 0.105], [0.15, -0.105], [-0.1, -0.105], [-0.17, -0.105]]) k.wheel(0.042, 0.035, x, 0.042, z, 0x151515);
  return lampLenses(k.build());
}

// a 0.6-tile single-decker (VEHICLE_LEN[3]): the body takes the line colour, the trim mesh a pale version of it
function busBody(): BufferGeometry {
  const k = new Kit();
  k.box(0.6, 0.17, 0.19, 0, 0.05, 0, 0xffffff)                                   // body
    .box(0.5, 0.075, 0.195, -0.02, 0.135, 0, 0x2a3546)                           // window band
    .box(0.02, 0.09, 0.17, 0.295, 0.12, 0, 0x2a3546)                             // windscreen
    .box(0.02, 0.02, 0.04, 0.3, 0.07, LAMP_Z.bus, 0xfff2b0, LAMP.head).box(0.02, 0.02, 0.04, 0.3, 0.07, -LAMP_Z.bus, 0xfff2b0, LAMP.head) // headlights
    .box(0.015, 0.02, 0.04, -0.3, 0.07, LAMP_Z.bus, 0xd62020, LAMP.tail).box(0.015, 0.02, 0.04, -0.3, 0.07, -LAMP_Z.bus, 0xd62020, LAMP.tail);
  for (const [x, z] of [[0.19, 0.1], [-0.17, 0.1], [0.19, -0.1], [-0.17, -0.1]]) k.wheel(0.045, 0.035, x, 0.045, z, 0x151515);
  return lampLenses(k.build());
}
function busTrim(): BufferGeometry {
  const k = new Kit();
  k.box(0.6, 0.025, 0.19, 0, 0.22, 0, 0xffffff)                                  // roof
    .box(0.56, 0.03, 0.196, 0, 0.05, 0, 0xffffff)                                // skirt stripe
    .box(0.012, 0.03, 0.12, 0.302, 0.19, 0, 0xffe680, LAMP.sign);                // destination sign, lit after dark
  return k.build();
}

/**
 * Citizens arrive as flat [id,x,y,flags] quads at the server tick rate and are
 * interpolated toward their latest position. Pedestrians are low-poly figures
 * dressed for what they are doing, walking with a shader gait (render/people.ts); drivers become sedans,
 * vans or trucks in the right-hand lane. Only changes come over the wire; a
 * quad in the Home state removes an agent. Parked cars in lots are render/parkedCars.ts.
 */
export class CitizensView {
  group = new Group();
  private luggage = new Luggage(this.group);
  /** Height of the road surface under a vehicle at (x, z) heading (hx, hz): flyover decks and their ramps (render/junctions.ts); 0 on the ground. */
  roadY: (x: number, z: number, hx: number, hz: number) => number = () => 0;
  /** pedestrians: detailed figures near the camera, simpler ones further off */
  private people: Crowd; private crowd: Crowd;
  /** where the last camera to draw the crowd was, for the detail split and culling */
  private eye = new Vector3(); private frustum = new Frustum(); private seen = false;
  private vehicles: Record<VType, InstancedMesh>;
  /** buses: body and trim, plus the selected bus's own copies (layer 1, like the other selected models) */
  private bus: InstancedMesh; private busTrim: InstancedMesh;
  private selBus: InstancedMesh; private selBusTrim: InstancedMesh;
  /** line colour by bus id, from the server's 'lines' message (render/lines.ts feeds it) */
  private livery = new Map<number, number>();
  /**
   * The selected agent is drawn from these single-instance copies on layer 1, which the overhead camera sees and the
   * first-person camera (layer 0 only) does not, so the view is never from inside the model.
   */
  private selPerson: Crowd;
  /**
   * Riders on metro platforms: a crowd of their own in `under`, outside `group` so the underground view does not ghost them.
   * main.ts sets `underLevel` (how far the view is up) and `platformAlongX` (the platform's axis under a tile).
   */
  readonly under = new Group();
  private platform = new Crowd(false, 1200, undefined, true);
  underLevel = 0;
  platformAlongX: (x: number, y: number) => boolean = () => true;
  private selVeh: Record<VType, InstancedMesh>;
  private ring: Mesh;
  /** per-instance lamp (seed, brake) for every mesh drawn with the vehicle material */
  private lamp = new Map<InstancedMesh, InstancedBufferAttribute>();
  /** headlight beams on the road ahead of moving vehicles after dark */
  pools = new HeadlightPools(MAX);
  /** taxis, delivery bikes, courier vans, bin lorries and sweepers (render/fleet.ts) */
  private fleet: FleetMeshes;
  /** lit indicator glows near the camera; the selected vehicle's on layer 1 like its model */
  private flares = new IndicatorFlares(2000); private selFlares = new IndicatorFlares(4);
  agents = new Map<number, Agent>();
  private m = new Matrix4();
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);
  private q = new Quaternion();
  private v = new Vector3();
  private sphere = new Sphere();
  count = 0;
  selected = 0;

  constructor() {
    this.people = new Crowd(true, NEAR_MAX);
    this.crowd = new Crowd(false, MAX);
    const pm = new Matrix4();
    for (const c of [this.people, this.crowd]) {
      c.mesh.onBeforeRender = (_r, _s, cam) => {
        this.eye.setFromMatrixPosition(cam.matrixWorld);
        this.frustum.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        this.seen = true;
      };
      this.group.add(c.mesh);
    }
    const vm = vehicleMaterial();
    // Faces turned from the sun get only the hemisphere light, which left cars seen from behind (street-level view) almost black.
    // A fill proportional to the paint colour keeps them readable by day and fades out at night.
    // Lamp boxes (tagged in aWin) glow after dark with each driver's own habits: render/headlights.ts.
    vm.onBeforeCompile = (shader) => {
      lampShader(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(0.16, 0.04, uNight);');
    };
    this.vehicles = { sedan: new InstancedMesh(sedan(), vm, MAX), van: new InstancedMesh(van(), vm, 2000), truck: new InstancedMesh(truck(), vm, 2000) };
    this.bus = new InstancedMesh(busBody(), vm, 400);
    this.busTrim = new InstancedMesh(busTrim(), vm, 400);
    for (const mesh of [this.bus, this.busTrim, ...Object.values(this.vehicles)]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
      this.group.add(mesh);
    }
    for (const mesh of [this.bus, this.busTrim, ...Object.values(this.vehicles)]) this.lampOf(mesh);
    this.fleet = new FleetMeshes(this.group, vm, (mesh) => this.lampOf(mesh));
    this.group.add(this.pools.mesh, this.flares.mesh, this.selFlares.mesh);
    this.selFlares.mesh.layers.set(1);
    const own = (geo: BufferGeometry, mat: MeshLambertMaterial) => {
      // the selected agent's own copy: vehicles get their own geometry so its lamp attribute is its own
      const mesh = new InstancedMesh(mat === vm ? geo.clone() : geo, mat, 1);
      if (mat === vm) this.lampOf(mesh);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.layers.set(1);
      this.group.add(mesh);
      return mesh;
    };
    this.under.add(this.platform.mesh);
    this.selPerson = this.people.twin(1);
    this.selPerson.mesh.layers.set(1);
    this.group.add(this.selPerson.mesh);
    this.selVeh = { sedan: own(this.vehicles.sedan.geometry, vm), van: own(this.vehicles.van.geometry, vm), truck: own(this.vehicles.truck.geometry, vm) };
    this.selBus = own(this.bus.geometry, vm);
    this.selBusTrim = own(this.busTrim.geometry, vm);
    this.ring = new Mesh(new RingGeometry(0.3, 0.4, 24).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.visible = false;
    this.ring.layers.set(1);
    this.ring.position.y = 0.05;
    this.group.add(this.ring);
  }

  private lampOf(mesh: InstancedMesh) {
    const a = lampAttribute(mesh.instanceMatrix.count);
    mesh.geometry.setAttribute('aLampI', a);
    this.lamp.set(mesh, a);
  }
  /** lamp habits, brake lights, indicators and reversing lamps for instance `at` of a vehicle mesh; queued, standing still or slowing shows the brake lights */
  private setLamp(mesh: InstancedMesh, at: number, id: number, a: Agent, now: number) {
    const brake = a.queued || now < a.brake || (a.tx - a.px) ** 2 + (a.ty - a.py) ** 2 < 1e-4 ? 1 : 0;
    this.lamp.get(mesh)!.setXYZW(at, lampSeed(id), brake, a.ind, a.rev ? 1 : 0);
  }

  update(c: number[], now: number) {
    for (let i = 0; i < c.length; i += 4) {
      const id = c[i], x = c[i + 1], y = c[i + 2], f = c[i + 3];
      const state = citizenState(f);
      if (state === CitizenState.Home) { this.agents.delete(id); continue; }
      const drives = citizenMode(f) === 1, kind = citizenKind(f), cls = citizenClass(f), queued = citizenQueued(f), emergency = citizenEmergency(f), stage = citizenStage(f);
      const a = this.agents.get(id);
      const ind = drives ? citizenIndicator(f) : Indicator.None, rev = citizenReversing(f);
      const fleet = citizenFleet(f), loaded = fleetLoaded(f), working = fleetWorking(f);
      if (!a) { this.agents.set(id, { x, y, px: x, py: y, tx: x, ty: y, t: 1, hx: 1, hy: 0, state, drives, kind, cls, queued, emergency, last: now, rx: x, rz: y, ang: 0, stage, trav: false, car: false, gait: 0, pose: 0, bag: citizenBag(f), ind, rev, brake: 0, fleet, loaded, working, under: citizenUnder(f), study: citizenStudy(f) }); continue; }
      const dx = x - a.tx, dy = y - a.ty;
      // slowing hard since the last tick: the brake lights come on for a moment
      if (drives && (dx * dx + dy * dy) < 0.5 * ((a.tx - a.px) ** 2 + (a.ty - a.py) ** 2) && (a.tx - a.px) ** 2 + (a.ty - a.py) ** 2 > 1e-4) a.brake = now + 700;
      // facing the way it moves, except a bus backing up in a three-point turn (server sim/traffic.ts)
      if (dx * dx + dy * dy > 1e-4) { const d = Math.hypot(dx, dy) * (rev ? -1 : 1); a.hx = dx / d; a.hy = dy / d; }
      a.px = a.x; a.py = a.y; a.tx = x; a.ty = y; a.t = 0; a.state = state; a.drives = drives; a.kind = kind; a.cls = cls; a.queued = queued; a.emergency = emergency; a.last = now; a.stage = stage; a.study = citizenStudy(f); a.bag = citizenBag(f); a.ind = ind; a.rev = rev;
      a.fleet = fleet; a.loaded = loaded; a.working = working; a.under = citizenUnder(f);
    }
  }

  frame(now: number, dt: number) {
    this.people.begin(); this.crowd.begin(); this.selPerson.begin(); this.luggage.begin(); this.platform.begin();
    const evening = sceneUniforms.uNight.value > 0.5, cull = this.seen;
    const easeGait = 1 - Math.exp(-dt * 7), easePose = 1 - Math.exp(-dt * 3);
    const nv: Record<VType, number> = { sedan: 0, van: 0, truck: 0 };
    this.ring.visible = false;
    const sel = { sedan: 0, van: 0, truck: 0, bus: 0 };
    let nb = 0;
    const beams = this.pools.active;
    this.pools.begin(); this.flares.begin(); this.selFlares.begin(); this.fleet.begin();
    for (const [id, a] of this.agents) {
      if (now - a.last > 6000) { this.agents.delete(id); continue; }
      a.t = Math.min(1, a.t + dt / LERP_SECONDS);
      a.x = a.px + (a.tx - a.px) * a.t; a.y = a.py + (a.ty - a.py) * a.t;
      const travelling = a.state === CitizenState.ToWork || a.state === CitizenState.ToHome || a.state === CitizenState.ToSite || a.state === CitizenState.ToVenue;
      const car = travelling && a.drives;
      a.trav = travelling; a.car = car;
      const mine = id === this.selected;
      // the server already places everyone on their lane or sidewalk; only crowds outside bars and on sites get a jitter
      let x = a.x, z = a.y;
      if (!travelling) { x += (hash2(id, 7) - 0.5) * 0.9; z += (hash2(id, 13) - 0.5) * 0.9; }
      a.rx = x; a.rz = z;
      // turn smoothly toward the direction of travel instead of snapping at corners
      const target = Math.atan2(-a.hy, a.hx);
      let da = target - a.ang;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      a.ang += da * Math.min(1, dt * 12);
      if (id === this.selected) { this.ring.visible = true; this.ring.position.x = x; this.ring.position.z = z; }
      if (car && a.cls === BUS_CLASS) {
        // a bus: body in the line colour, roof, skirt and sign in a pale version of it
        if (!mine && nb >= this.bus.instanceMatrix.count) continue;
        this.p.set(x, this.roadY(x, z, a.hx, a.hy), z);
        this.q.setFromAxisAngle(UP, a.ang);
        this.m.compose(this.p, this.q, this.s);
        const body = mine ? this.selBus : this.bus, trim = mine ? this.selBusTrim : this.busTrim, at = mine ? 0 : nb;
        body.setMatrixAt(at, this.m); trim.setMatrixAt(at, this.m);
        const lc = this.livery.get(id);
        tmpC.copy(lc === undefined ? BUS_DEFAULT : tmpC.setHex(lc));
        body.setColorAt(at, tmpC);
        trim.setColorAt(at, tmpC.lerp(WHITE, 0.72));
        this.setLamp(body, at, id, a, now); this.setLamp(trim, at, id, a, now);
        if (beams) this.beam(x, z, a.ang, 'bus', id);
        if (a.ind) this.blinkers(x, this.p.y, z, a.ang, 'bus', a.ind, id, mine);
        if (mine) sel.bus = 1; else nb++;
      } else if (car && a.fleet) {
        // a mobile worker's vehicle: taxi, bike, van, bin lorry (render/fleet.ts); beams and blinkers as the body it is closest to
        const y = this.roadY(x, z, a.hx, a.hy);
        this.q.setFromAxisAngle(UP, a.ang);
        this.fleet.put(id, a.fleet, x, y, z, a.ang, a.loaded, a.working, now, mine, (mesh, at) => this.setLamp(mesh, at, id, a, now));
        const fb = FleetMeshes.body(a.fleet);
        if (fb && beams) this.beam(x, z, a.ang, fb, id);
        if (fb && a.ind) this.blinkers(x, y, z, a.ang, fb, a.ind, id, mine);
      } else if (car) {
        const type: VType = TYPES[a.cls] ?? 'sedan';
        const mesh = mine ? this.selVeh[type] : this.vehicles[type];
        if (!mine && nv[type] >= mesh.instanceMatrix.count) continue;
        this.p.set(x, this.roadY(x, z, a.hx, a.hy), z);
        this.q.setFromAxisAngle(UP, a.ang);
        this.m.compose(this.p, this.q, this.s);
        mesh.setMatrixAt(mine ? 0 : nv[type], this.m);
        mesh.setColorAt(mine ? 0 : nv[type], this.carColor(id, a, now));
        this.setLamp(mesh, mine ? 0 : nv[type], id, a, now);
        if (beams) this.beam(x, z, a.ang, type, id);
        if (a.ind) this.blinkers(x, this.p.y, z, a.ang, type, a.ind, id, mine);
        if (a.bag && type === 'sedan') this.luggage.car(x, z, a.ang, id);
        if (mine) sel[type] = 1; else nv[type]++;
      } else if (a.under) {
        if (this.underLevel > 0.5) this.platformRider(id, a, evening);
      } else {
        const look = a.look && a.dressed === a.state ? a.look : this.dress(id, a, evening);
        // gait: the stride swing follows walking speed (so feet roughly keep pace with the ground), eased in and out
        const seg = Math.hypot(a.tx - a.px, a.ty - a.py);
        const moving = travelling && !a.queued && seg > 1e-4 && now - a.last < TICK_MS * 2.25;
        // half a step over the leg length: steps are pace * 1000 / 2π cycles a second, two steps a cycle
        const swing = moving ? Math.min(0.75, Math.atan(seg / LERP_SECONDS / (look.pace * 1000 / (2 * Math.PI) * 4 * 0.19 * look.height))) : 0;
        a.gait += (swing - a.gait) * easeGait;
        // standing about: some check their phones; builders on site hammer away
        const pose = moving ? 0 : a.state === CitizenState.AtSite ? -1 : look.phone && (a.queued || !travelling) ? 1 : 0;
        a.pose += (pose - a.pose) * easePose;
        // crowds outside bars and on sites face every which way; a queue at a stop roughly faces the same way
        const yaw = a.ang + (travelling ? (a.queued ? look.turn * 0.45 : 0) : look.turn * 2.5);
        if (a.bag && travelling) this.luggage.walker(x, z, yaw, look.height, id);
        const y = this.roadY(x, z, a.hx, a.hy); // on a flyover deck's pavement, up on the deck
        if (!mine) {
          if (cull && !this.frustum.intersectsSphere(this.sphere.set(this.v.set(x, y + 0.2, z), 0.8))) continue;
          const d2 = (x - this.eye.x) ** 2 + (y - this.eye.y) ** 2 + (z - this.eye.z) ** 2;
          const target = d2 < NEAR * NEAR && !this.people.full ? this.people : this.crowd;
          if (target.full) continue;
          target.put(x, y, z, yaw, look, (now * look.pace + id) % PHASE_WRAP, a.gait, a.pose);
        } else this.selPerson.put(x, y, z, yaw, look, (now * look.pace + id) % PHASE_WRAP, a.gait, a.pose);
      }
    }
    this.count = this.agents.size;
    this.pools.end(); this.flares.end(); this.selFlares.end(); this.fleet.end();
    for (const attr of this.lamp.values()) attr.needsUpdate = true;
    this.people.end(); this.crowd.end(); this.selPerson.end(); this.luggage.end(); this.platform.end();
    for (const type of TYPES) {
      const mesh = this.vehicles[type];
      mesh.count = nv[type]; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const own = this.selVeh[type];
      own.count = sel[type]; own.instanceMatrix.needsUpdate = true;
      if (own.instanceColor) own.instanceColor.needsUpdate = true;
    }
    for (const [mesh, n] of [[this.bus, nb], [this.busTrim, nb], [this.selBus, sel.bus], [this.selBusTrim, sel.bus]] as [InstancedMesh, number][]) {
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Metro riders waiting on a platform (docs/underground.md section 4): in the underground view, on the island platform at
   * METRO_Y. The server spreads them 0.30 to 0.42 tiles either side of the track, which the island between the two bores
   * squeezes to its width; each faces its track, with a turn and a stoop of its own.
   */
  private platformRider(id: number, a: Agent, evening: boolean) {
    const look = a.look && a.dressed === a.state ? a.look : this.dress(id, a, evening);
    const alongX = this.platformAlongX(Math.floor(a.x), Math.floor(a.y));
    const c = alongX ? a.y : a.x, side = c - Math.floor(c) - 0.5 < 0 ? -1 : 1;
    const across = side * (0.03 + Math.min(1, Math.max(0, (Math.abs(c - Math.floor(c) - 0.5) - 0.3) / 0.12)) * 0.08);
    const x = alongX ? a.x : Math.floor(a.x) + 0.5 + across, z = alongX ? Math.floor(a.y) + 0.5 + across : a.y;
    const yaw = (alongX ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? 0 : Math.PI) + look.turn * 0.8;
    a.rx = x; a.rz = z;
    this.platform.put(x, METRO_Y - 0.07, z, yaw, look, (performance.now() * look.pace + id) % PHASE_WRAP, 0, look.phone ? 1 : 0);
  }

  /** How many riders wait on the platform between two end tiles (for the station tooltip). */
  platformCrowd(x0: number, y0: number, x1: number, y1: number): number {
    let n = 0;
    for (const a of this.agents.values()) if (a.under && a.x >= Math.min(x0, x1) && a.x < Math.max(x0, x1) + 1 && a.y >= Math.min(y0, y1) && a.y < Math.max(y0, y1) + 1) n++;
    return n;
  }

  /** A pedestrian's look, re-dressed when they switch between work and leisure (walking home keeps what they had on). */
  private dress(id: number, a: Agent, evening: boolean): Look {
    const work = dressFor(a.state, a.kind), cur = a.look?.dress;
    const want = work === null ? cur ?? (a.kind ? 'w' : 'l') : work ? 'w' : cur === 'e' || cur === 'l' ? cur : evening ? 'e' : 'l';
    if (!a.look || cur !== want || a.look.student !== a.study) a.look = lookOf(id, a.kind, a.stage, want === 'w', want === 'e', a.study);
    a.dressed = a.state;
    return a.look;
  }

  private beam(x: number, z: number, ang: number, type: VType | 'bus', id: number) {
    const [front, len, width] = BEAM[type];
    this.pools.add(x, z, this.q, Math.cos(ang), -Math.sin(ang), front, len, width, LAMP_Z[type], lampSeed(id));
  }

  /** Indicator flares at the corners of a vehicle near the camera: one side's front and rear, or all four for hazards. */
  private blinkers(x: number, y: number, z: number, ang: number, type: VType | 'bus', ind: number, id: number, mine: boolean) {
    const fl = mine ? this.selFlares : this.flares;
    if (!fl.near(x, y, z)) return;
    const [fx, rx, w, h] = BLINKER[type], c = Math.cos(ang), s = Math.sin(ang), seed = lampSeed(id);
    // the car's left is -z in the model; (lx, lz) in the model is (lx c + lz s, -lx s + lz c) in the world
    for (let side = -1; side <= 1; side += 2) {
      if (ind !== Indicator.Hazard && (side < 0) !== (ind === Indicator.Left)) continue;
      const lz = side * w;
      fl.add(x + fx * c + lz * s, y + h, z - fx * s + lz * c, seed);
      fl.add(x + rx * c + lz * s, y + h, z - rx * s + lz * c, seed);
    }
  }

  /**
   * The indicators on a vehicle (for the cockpit dashboard): -1 turning left, 1 turning right, 'hazard' for both,
   * 0 for none or when it is not a vehicle on the road. indicatorLit says whether the lamps are lit at that moment.
   */
  indicatorOf(id: number): -1 | 0 | 1 | 'hazard' {
    const a = this.agents.get(id);
    if (!a?.car) return 0;
    return a.ind === Indicator.Left ? -1 : a.ind === Indicator.Right ? 1 : a.ind === Indicator.Hazard ? 'hazard' : 0;
  }
  /** Is this vehicle's indicator lamp lit at wall-clock `t` seconds (sceneUniforms.uTime), in step with the lamps outside. */
  indicatorLit(id: number, t = sceneUniforms.uTime.value): boolean {
    return this.indicatorOf(id) !== 0 && blinkLit(lampSeed(id), t);
  }

  /** Buses on the road and their line colours: flat [busId, lineId, …] and line id -> colour (the 'lines' message). */
  setLivery(pairs: number[], colours: Map<number, number>) {
    this.livery.clear();
    for (let i = 0; i + 1 < pairs.length; i += 2) { const c = colours.get(pairs[i + 1]); if (c !== undefined) this.livery.set(pairs[i], c); }
  }

  /** The agent nearest to a screen point, within `radius` pixels; 0 when none. */
  pick(px: number, py: number, camera: Camera, w: number, h: number, radius = 18): number {
    let best = 0, bestD = radius * radius;
    for (const [id, a] of this.agents) {
      if (a.under && this.underLevel <= 0.5) continue;
      this.v.set(a.rx, a.under ? METRO_Y + 0.1 : 0.3, a.rz).project(camera);
      if (this.v.z > 1) continue;
      const sx = (this.v.x + 1) * 0.5 * w, sy = (1 - this.v.y) * 0.5 * h;
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }
  /** Current rendered position of an agent, or null when it is not on screen any more. */
  positionOf(id: number): [number, number] | null {
    const a = this.agents.get(id);
    return a ? [a.rx, a.rz] : null;
  }

  /**
   * Where a first-person camera should sit for this agent, or null when it is not drawn (gone indoors).
   * Eye heights are in tile units: a walker's own figure (adults about 0.36, children about 0.25), sedan drivers 0.16, vans and trucks 0.22.
   */
  eyeOf(id: number): Eye | null {
    const a = this.agents.get(id);
    if (!a) return null;
    let height: number, pace: number;
    if (a.car && a.fleet) { height = FleetMeshes.eye(a.fleet); pace = 0.014; }
    else if (a.car) { height = a.cls === BUS_CLASS ? 0.27 : (TYPES[a.cls] ?? 'sedan') === 'sedan' ? 0.16 : 0.22; pace = 0.014; }
    else {
      // the walker's own eyes: their figure's height, a little lower for a stoop
      const look = this.dress(id, a, sceneUniforms.uNight.value > 0.5);
      height = EYE * look.height * Math.cos(look.stoop) - (a.stage === LifeStage.Child ? 0 : 0.004); pace = look.pace;
    }
    const speed = a.t < 1 ? Math.hypot(a.tx - a.px, a.ty - a.py) / LERP_SECONDS : 0;
    return { x: a.rx, z: a.rz, ang: a.ang, height, car: a.car, travelling: a.trav, speed, pace, color: a.car ? (a.fleet ? FleetMeshes.color(a.fleet, id) : this.carColor(id, a, 0).getHex()) : undefined };
  }

  private carColor(id: number, a: Agent, now: number): Color {
    if (a.emergency) return tmpC.copy(Math.floor(now / 180 + id) % 2 ? EMERGENCY_RED : EMERGENCY_BLUE).lerp(new Color(0xffffff), 0.35);
    switch (a.kind) {
      case Zone.Police: case VehicleKind.Patrol: return tmpC.setHex(0xe8eefc);
      case Zone.Fire: case VehicleKind.FireEngine: return tmpC.setHex(0xd63b2c);
      case Zone.Hospital: case VehicleKind.Ambulance: return tmpC.setHex(0xffffff);
      case Zone.Yard: return tmpC.setHex(0xf2b134);
      case VehicleKind.Freight: return tmpC.copy(FREIGHT_PALETTE[Math.floor(hash2(id, 3) * FREIGHT_PALETTE.length)]);
    }
    if (a.cls === VehicleClass.Truck) return tmpC.copy(FREIGHT_PALETTE[Math.floor(hash2(id, 3) * FREIGHT_PALETTE.length)]);
    return tmpC.copy(CAR_PALETTE[Math.floor(hash2(id, 3) * CAR_PALETTE.length)]);
  }
}
