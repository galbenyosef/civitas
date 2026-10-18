import {
  BufferGeometry, BoxGeometry, CylinderGeometry, IcosahedronGeometry, PlaneGeometry, Group, InstancedMesh, InstancedBufferAttribute, Matrix4, MeshBasicMaterial, Material,
  Quaternion, Euler, Vector3, Color, AdditiveBlending, CanvasTexture, LinearFilter, type Camera, type Texture,
} from 'three';
import {
  TICKS_PER_DAY, BOAT_TYPES, boatsAt, boatLifts, boatOperator, hash2, railService, trainsAt, trainPoses,
  type BoatState, type BoatType, type BoatHarbour, type BoatPhase, type Voyage, type FerryLineDTO, type RailService, type TrainState, type VehiclePose,
} from '@msimcity/shared';
import { vehicleMaterial, sceneUniforms } from './materials';
import { boatModel, type BoatModel } from './boatModels';

/**
 * Boats (docs/boats.md section 7). The harbours (their berths and lanes) come from the server's `harbours` message and the
 * boats from the shared pure schedule `boatsAt(harbours, tick)` (shared/src/boats.ts), which already includes the
 * keep-to-starboard offset; this file only draws them, and picks them.
 *
 * One InstancedMesh per type and part (render/boatModels.ts): hull and accent are tinted per boat, the works keep their own
 * colours, glass lights up at night, sails are tinted and trimmed to the day's wind, and a few types have an optional part
 * (a flybridge, deck cranes) and a choice of loads. Every boat is its own (organic rule): paint jitter and weathering,
 * sail tone, heave period and amplitude, roll and pitch phase, where it lies at its berth and how it is turned, how many
 * fenders it hangs, how warm its cabin light is and whether it is lit at all, and whether a sailboat sails or motors.
 */

const MAX_PER_TYPE = 64;
const MAX_LIGHTS = 720;
const MAX_FENDERS = 640;
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const RED = new Color(0xff2a20), GREEN = new Color(0x22ff55), WHITE = new Color(0xffffff), WARM = new Color(0xffe2b0), BLUE = new Color(0x3a6bff);
const GRIME = new Color(0x8f8a7e);
const GLASS_DAY = new Color(0x2b3f55), LIT_A = new Color(0xffc27a), LIT_B = new Color(0xfff0d0);
const FOAM = new Color(0xf4f8fb);

// ---- liveries -----------------------------------------------------------------------------------------------------
const hex = (c: number[], k: number) => c[Math.floor(k * c.length) % c.length];
const DINGHY_HULLS = [0xf1efe8, 0xf1efe8, 0xf3d14a, 0xe5812b, 0xc0392b, 0x2e6fb0, 0x4f9a63, 0xf6f6f6];
const DINGHY_SAILS = [0xf4f2ea, 0xf4f2ea, 0xc0392b, 0x2e6fb0, 0xd1b07a];
const BOOT_STRIPES = [0x1d2b4f, 0x1f7a7a, 0x7a1f3a, 0x1d2b4f];
const YACHT_HULLS = [0xf1efe8, 0xf1efe8, 0x1d2b4f, 0x2f5d3a, 0xa3302a, 0xf1efe8];
const CABINS = [0x2f6b4a, 0xa3302a, 0x2b5c9a, 0x2f6b4a, 0x6b4a8a, 0xc9a227];
const TRAWLER_HULLS = [0x2c5c8f, 0xb03a2e, 0x2f6b4a, 0x1d2024, 0xd9792b, 0x2c5c8f];
const BUS_LINES = [[0x1b4f8c, 0xf2c14e], [0xb3262e, 0xf2f0ea]];
interface Livery {
  hull: Color; accent: Color; sail: Color;
  wear: number;
  /** is the cabin lit at night, and how warm */
  lit: boolean; warm: Color;
  opt: boolean; cargo: number;
  /** a sailboat under motor this trip */
  motor: boolean;
  fenders: number; fenderCol: Color;
  /** lateral and longitudinal lie at the berth, and yaw */
  lieZ: number; lieX: number; lieYaw: number;
  /** heave period (rad/s), phases */
  w: number; p1: number; p2: number; p3: number;
  /** vertical size of the deck lights, small variation */
  k: number;
}
/** a livery colour as this boat wears it: a touch of jitter, then weathering */
function paint(out: Color, base: number, k: number, salt: number, wear: number): Color {
  out.setHex(base).offsetHSL((hash2(k, salt) - 0.5) * 0.02, (hash2(k, salt + 1) - 0.5) * 0.08, (hash2(k, salt + 2) - 0.5) * 0.06);
  return out.lerp(GRIME, wear * 0.45).multiplyScalar(1 - wear * 0.2);
}
function makeLivery(s: BoatState, line?: FerryLineDTO): Livery {
  const k = Math.floor(s.seed * 65536), r = (n: number) => hash2(k, n);
  const wear = r(41) ** 2 * 0.35;
  let hull = 0xf1efe8, accent = 0xffffff, sail = 0xf4f2ea;
  switch (s.type) {
    case 'dinghy': hull = hex(DINGHY_HULLS, r(1)); sail = hex(DINGHY_SAILS, r(2)); break;
    case 'motorCruiser': hull = 0xf1efe8; accent = hex(BOOT_STRIPES, r(1)); break;
    case 'sailboat': hull = hex(YACHT_HULLS, r(1)); accent = hull === 0xf1efe8 ? hex([0x1d2b4f, 0x7a1f3a, 0x2f5d3a], r(3)) : 0xf1efe8; sail = r(2) < 0.7 ? 0xf4f2ea : 0xe6dcc0; break;
    case 'narrowboat': hull = 0x1d1f22; accent = hex(CABINS, r(1)); break;
    case 'trawler': hull = hex(TRAWLER_HULLS, r(1)); accent = 0xf2f0ea; break;
    case 'riverBus': { const l = BUS_LINES[Math.floor(r(1) * 2)]; hull = line ? line.color : l[0]; accent = line ? 0xf2f0ea : l[1]; break; }
    case 'sailingBarge': hull = 0x1b1c1f; sail = 0x9a4527; break;
    case 'policeLaunch': hull = 0x1b3f8c; accent = 0xf2c91e; break;
    case 'fireBoat': hull = 0xc4302b; accent = 0xf2f0ea; break;
    default: { const op = boatOperator(s.type, s.seed); if (op) { hull = op.hull; accent = op.funnel; } else hull = 0x4a4f55; }
  }
  const model = boatModel(s.type);
  const variants = model.cargo.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const spec = BOAT_TYPES[s.type];
  const vk = s.voyage ? s.voyage.id : 0;
  return {
    hull: paint(new Color(), hull, k, 50, wear), accent: paint(new Color(), accent, k, 60, wear * 0.7), sail: paint(new Color(), sail, k, 70, wear * 0.5),
    wear, lit: s.lights.accommodation || r(10) < 0.5, warm: new Color().lerpColors(LIT_A, LIT_B, r(11)),
    opt: model.opt !== null && r(12) < (s.type === 'containerShip' ? 0.4 : s.type === 'coaster' ? 0.55 : 0.4),
    cargo: variants.length ? variants[Math.floor(r(13) * variants.length)] : -1,
    motor: hash2(k, vk + 7) < 0.3,
    fenders: 2 + Math.floor(r(21) * 3), fenderCol: new Color(hex([0xf2f0ea, 0xf2f0ea, 0x2e6fb0, 0xe8dfc0, 0xc0392b], r(22))),
    lieZ: (r(23) - 0.5) * 0.025 * (1 + spec.beam * 3), lieX: (r(24) - 0.5) * 0.04, lieYaw: (r(25) - 0.5) * 0.09,
    w: 1.1 + 0.9 * r(26), p1: r(27) * TAU, p2: r(28) * TAU, p3: r(29) * TAU,
    k: 0.9 + 0.2 * r(30),
  };
}

// ---- wind, bank and trim ------------------------------------------------------------------------------------------
/** the day's wind: the direction it blows to (atan2(dz, dx)) and a strength 0.45-1 */
const windOf = (day: number) => ({ dir: hash2(day, 7001) * TAU, str: 0.45 + 0.55 * hash2(day, 7002) });
/** how far a boat leans into a turn, rad per (rad/tick) */
const BANK: Partial<Record<BoatType, number>> = { dinghy: 0.08, motorCruiser: 0.14, trawler: 0.07, riverBus: 0.06, tug: 0.1, policeLaunch: 0.16, fireBoat: 0.08, sailboat: 0.05 };
/** bow-up trim at full speed */
const TRIM: Partial<Record<BoatType, number>> = { motorCruiser: 0.07, policeLaunch: 0.07, fireBoat: 0.04, riverBus: 0.03, tug: 0.03, trawler: 0.02, dinghy: 0.02 };
/** the lean of a sailing boat in the day's full wind, rad */
const HEEL: Partial<Record<BoatType, number>> = { dinghy: 0.28, sailboat: 0.3, sailingBarge: 0.16 };
const NO_LIGHTS = { nav: false, anchor: false, trawling: false, deck: false, accommodation: false };
const SAILERS = new Set<BoatType>(['dinghy', 'sailboat', 'sailingBarge']);

interface Rec { h: number; t: number; turn: number; sail: number; yaw: number; liv: Livery; seen: number }

// ---- wake textures -------------------------------------------------------------------------------------------------
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new CanvasTexture(cv);
  t.minFilter = LinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = false;
  return t;
}
/** A V wake behind a bow at the right edge: two diverging arms of foam and a churned trail between, fading to the left. */
function wakeTexture(): Texture {
  return canvasTex(512, 256, (c) => {
    const W = 512, H = 256;
    const dot = (x: number, y: number, r: number, a: number) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); };
    const rnd = (n: number) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
    for (let i = 0; i < 360; i++) {
      const f = i / 360, x = W * (1 - f), fade = (1 - f) ** 1.4;
      for (const sd of [-1, 1]) {
        const spread = 10 + f * 112 + (rnd(i * 3 + sd) - 0.5) * 8;
        dot(x, H / 2 + sd * spread, 9 + 7 * f, 0.34 * fade);
        if (i % 3 === 0) dot(x + (rnd(i + 5) - 0.5) * 6, H / 2 + sd * (spread - 6 - 14 * rnd(i + sd)), 4 + 4 * rnd(i), 0.22 * fade);
      }
      dot(x, H / 2 + (rnd(i * 7) - 0.5) * (10 + 18 * f), 13 + 6 * f, 0.3 * fade ** 1.7);
      if (i % 4 === 0) dot(x, H / 2 + (rnd(i * 11) - 0.5) * (40 + 60 * f), 3, 0.35 * fade ** 2);
    }
  });
}
/** A bow wave: foam crescents laid back from the tip at the right edge. */
function bowTexture(): Texture {
  return canvasTex(128, 128, (c) => {
    for (let i = 0; i < 90; i++) {
      const f = i / 90;
      for (const sd of [-1, 1]) {
        const x = 128 - f * 120, y = 64 + sd * (4 + 48 * f ** 0.8), g = c.createRadialGradient(x, y, 0, x, y, 8);
        g.addColorStop(0, `rgba(255,255,255,${0.55 * (1 - f * 0.7)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(x - 8, y - 8, 16, 16);
      }
    }
    const g = c.createRadialGradient(124, 64, 0, 124, 64, 22); g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(90, 30, 38, 68);
  });
}
/** A wake material whose alpha is scaled per instance (the `aFade` attribute). */
function wakeMaterial(map: Texture): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;').replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vFade;');
  };
  return m;
}

// ---- the view -----------------------------------------------------------------------------------------------------
interface Slot { mesh: InstancedMesh; n: number }
interface TypeSet {
  model: BoatModel; n: number;
  hull: Slot; accent: Slot | null; works: Slot; glass: Slot | null;
  sails: Slot[]; opt: Slot | null; cargo: (Slot | null)[];
}
/** Boat ids from here up are river buses (ferry lines run as rail services: shared/src/ferry.ts); the id is this plus line * 64 + boat. */
export const FERRY_ID_BASE = 2_000_000_000;
/** Where a river bus is in its line, as drawn last frame (panels). */
export interface FerryInfo { line: FerryLineDTO; train: number; stop: number; phase: 'dwell' | 'run' }

/** the wheelhouse eye as drawn this frame: where it is and how the boat is turned */
export interface HelmPose { x: number; y: number; z: number; q: Quaternion; wheelhouse: boolean }

export class BoatsView {
  group = new Group();
  /** the harbours the schedule runs on (an immutable array: a change makes a new one) */
  harbours: BoatHarbour[] = [];
  /** true once the server's own list has arrived; the dev mock then stops */
  real = false;
  /** the first-person view is on: the selected boat's own lights stay out of it */
  cabView = false;
  /** override the tick (screenshots, debugging); null follows the game clock */
  debugTick: number | null = null;
  states: BoatState[] = [];
  /** the boat under the cursor and the selected one, by boat id: drawn brighter */
  hover: number | null = null;
  selected: number | null = null;
  lastTick = 0;
  /** boats other than the harbours' (river buses on ferry lines, B5) add their states here */
  sources: ((tick: number, out: BoatState[]) => void)[] = [];
  private byId = new Map<number, BoatState>();
  private ferries: { dto: FerryLineDTO; svc: RailService }[] = [];
  private ferryById = new Map<number, FerryInfo>();
  private ferryTmp: TrainState[] = [];
  private poseTmp: VehiclePose[] = [];
  private harbourById = new Map<number, BoatHarbour>();
  private recs = new Map<number, Rec>();
  private picks: number[] = [];
  private types = new Map<BoatType, TypeSet>();
  private wakes: InstancedMesh; private wakeFade: InstancedBufferAttribute; private nWake = 0;
  private bows: InstancedMesh; private bowFade: InstancedBufferAttribute; private nBow = 0;
  private fenders: InstancedMesh; private nFender = 0;
  private lightBoxes: InstancedMesh; private glow: InstancedMesh; private glowMat: MeshBasicMaterial; private nLights = 0;
  private lastFrame = performance.now();
  private pose: HelmPose | null = null;
  private liftKey: { hs: BoatHarbour[]; day: number; map: Map<number, unknown> } | null = null;
  private m = new Matrix4(); private tmp = new Matrix4(); private mi = new Matrix4(); private mj = new Matrix4();
  private q = new Quaternion(); private e = new Euler(0, 0, 0, 'YZX'); private p = new Vector3(); private sc = new Vector3(); private v = new Vector3();
  private col = new Color(); private col2 = new Color();
  private vm = vehicleMaterial();
  private glassMat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

  constructor() {
    const wakeGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(-0.5, 0, 0);
    this.wakeFade = new InstancedBufferAttribute(new Float32Array(MAX_PER_TYPE * 2), 1);
    wakeGeo.setAttribute('aFade', this.wakeFade);
    this.wakes = new InstancedMesh(wakeGeo, wakeMaterial(wakeTexture()), MAX_PER_TYPE * 2);
    const bowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(-0.5, 0, 0);
    this.bowFade = new InstancedBufferAttribute(new Float32Array(MAX_PER_TYPE * 2), 1);
    bowGeo.setAttribute('aFade', this.bowFade);
    this.bows = new InstancedMesh(bowGeo, wakeMaterial(bowTexture()), MAX_PER_TYPE * 2);
    for (const w of [this.wakes, this.bows]) { w.count = 0; w.frustumCulled = false; w.renderOrder = 2; this.group.add(w); }
    this.fenders = new InstancedMesh(new CylinderGeometry(0.005, 0.005, 0.016, 6), this.vm, MAX_FENDERS);
    this.fenders.count = 0; this.fenders.frustumCulled = false; this.group.add(this.fenders);
    this.lightBoxes = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ toneMapped: false }), MAX_LIGHTS);
    this.glowMat = new MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    this.glow = new InstancedMesh(new IcosahedronGeometry(1, 2), this.glowMat, MAX_LIGHTS);
    for (const mesh of [this.lightBoxes, this.glow]) { mesh.count = 0; mesh.frustumCulled = false; this.group.add(mesh); }
  }

  /** Replace the harbour list (the server's `harbours` message sets `real`; the dev mock does not). */
  setHarbours(list: BoatHarbour[], real = false) {
    if (this.real && !real) return;
    if (real) this.real = true;
    this.harbours = list;
    this.harbourById = new Map(list.map((h) => [h.id, h]));
    this.liftKey = null;
  }

  private typeSet(type: BoatType): TypeSet {
    let ts = this.types.get(type);
    if (ts) return ts;
    const model = boatModel(type);
    const mk = (g: BufferGeometry, mat: Material = this.vm, shadow = true): Slot => {
      const mesh = new InstancedMesh(g, mat, MAX_PER_TYPE);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = shadow;
      this.group.add(mesh);
      return { mesh, n: 0 };
    };
    ts = {
      model, n: 0, hull: mk(model.hull), accent: model.accent ? mk(model.accent) : null, works: mk(model.works),
      glass: model.glass ? mk(model.glass, this.glassMat, false) : null,
      sails: model.sails.map((s) => mk(s.geo)), opt: model.opt ? mk(model.opt) : null, cargo: model.cargo.map((c) => (c ? mk(c) : null)),
    };
    this.types.set(type, ts);
    return ts;
  }

  /**
   * The river bus lines (the server's `ferryLines`): each running line's boats sail its rail service (B5, shared/src/ferry.ts)
   * along the water route, drawn here as river buses. A boat dwelling at a pier lies alongside, one running is under way.
   */
  setFerryLines(lines: FerryLineDTO[]) {
    this.ferries = lines.filter((l) => l.route && l.status === 'running').map((dto) => ({ dto, svc: railService(dto, dto.route!) }));
    for (const id of [...this.recs.keys()]) if (id >= FERRY_ID_BASE) this.recs.delete(id);
  }
  private ferryStates(tick: number, out: BoatState[]) {
    this.ferryById.clear();
    for (const { dto, svc } of this.ferries) {
      for (const st of trainsAt(svc, tick, this.ferryTmp)) {
        const pose = trainPoses(svc, st, this.poseTmp)[0];
        if (!pose) continue;
        const id = FERRY_ID_BASE + dto.id * 64 + st.train, dwell = st.phase === 'dwell';
        this.ferryById.set(id, { line: dto, train: st.train, stop: st.stop, phase: st.phase });
        // the bow points the way the boat goes (a pose faces up the route: a boat coming home runs the other way)
        const h = st.dir > 0 ? pose.h : pose.h + Math.PI;
        out.push({
          id, voyage: null, type: 'riverBus', seed: hash2(dto.id, st.train + 31), harbour: -1, berth: -1, phase: dwell ? 'alongside' : 'underway', x: pose.x, z: pose.z, h,
          speed: dwell ? 0 : st.v, astern: false, fade: 1, lane: -1, s: st.s, dir: st.dir,
          lights: { nav: !dwell, anchor: false, trawling: false, deck: false, accommodation: true },
        });
      }
    }
  }
  /** a river bus's line and where it is, or undefined for any other boat */
  ferryOf(id: number): FerryInfo | undefined { return this.ferryById.get(id); }

  /** The bascule lifts with a real boat booked on `day`, for hiding the landmark's decorative barge: is `seed` a span of them? */
  liftBooked(seed: number, day: number): boolean {
    if (!this.harbours.length) return false;
    if (!this.liftKey || this.liftKey.hs !== this.harbours || this.liftKey.day !== day) this.liftKey = { hs: this.harbours, day, map: boatLifts(this.harbours, day) };
    return this.liftKey.map.has(seed);
  }

  frame(tick: number) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const t = this.debugTick ?? tick;
    this.lastTick = t;
    const night = sceneUniforms.uNight.value, time = now / 1000;
    this.glowMat.opacity = 0.05 + 0.3 * night;
    for (const ts of this.types.values()) {
      ts.n = 0;
      for (const sl of [ts.hull, ts.accent, ts.works, ts.glass, ts.opt, ...ts.sails, ...ts.cargo]) if (sl) sl.n = 0;
    }
    this.nWake = 0; this.nBow = 0; this.nFender = 0; this.nLights = 0;
    this.picks.length = 0; this.pose = null;
    this.byId.clear();
    this.states.length = 0;
    if (this.harbours.length) boatsAt(this.harbours, t, this.states);
    if (this.ferries.length) this.ferryStates(t, this.states); else this.ferryById.clear();
    for (const src of this.sources) src(t, this.states);
    const day = Math.floor(t / TICKS_PER_DAY), wind = windOf(day);
    for (const s of this.states) {
      this.byId.set(s.id, s);
      const lift = s.id === this.selected ? 1.3 + 0.2 * Math.sin(now / 260) : s.id === this.hover ? 1.25 : 1;
      this.draw(s, dt, time, night, lift, wind, t);
    }
    for (const ts of this.types.values()) {
      ts.hull.n = ts.works.n = ts.n;
      if (ts.accent) ts.accent.n = ts.n;
      if (ts.glass) ts.glass.n = ts.n;
      for (const sl of [ts.hull, ts.accent, ts.works, ts.glass, ts.opt, ...ts.sails, ...ts.cargo]) {
        if (!sl) continue;
        sl.mesh.count = sl.n; sl.mesh.visible = sl.n > 0;
        sl.mesh.instanceMatrix.needsUpdate = true;
        if (sl.mesh.instanceColor) sl.mesh.instanceColor.needsUpdate = true;
      }
    }
    this.wakes.count = this.nWake; this.bows.count = this.nBow; this.fenders.count = this.nFender;
    this.lightBoxes.count = this.nLights; this.glow.count = this.nLights;
    for (const mesh of [this.wakes, this.bows, this.fenders, this.lightBoxes, this.glow]) { mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    this.wakeFade.needsUpdate = true; this.bowFade.needsUpdate = true;
    if (this.recs.size > 160) { for (const [id, r] of this.recs) if (!this.byId.has(id) && time - r.seen > 30) this.recs.delete(id); }
  }

  /** the dynamic state of a boat (turn rate, sail), created with its livery on first sight */
  private rec(s: BoatState, time: number, t: number): Rec {
    let r = this.recs.get(s.id);
    if (!r) { r = { h: s.h, t, turn: 0, sail: s.phase === 'underway' || s.phase === 'fishing' ? 1 : 0, yaw: 0, liv: makeLivery(s, this.ferryById.get(s.id)?.line), seen: time }; this.recs.set(s.id, r); }
    r.seen = time;
    return r;
  }

  private draw(s: BoatState, dt: number, time: number, night: number, lift: number, wind: { dir: number; str: number }, t: number) {
    const ts = this.typeSet(s.type);
    if (ts.n >= MAX_PER_TYPE) return;
    const i = ts.n++;
    const md = ts.model, spec = BOAT_TYPES[s.type];
    const rec = this.rec(s, time, t), L = rec.liv;
    const moored = s.phase === 'moored' || s.phase === 'alongside';
    const sp = clamp(s.speed / spec.speed, 0, 1.4);

    // turn rate, smoothed: motor boats bank into a turn
    const dT = t - rec.t;
    if (dT > 0.001 && dT < 3) { rec.turn += (angDiff(s.h, rec.h) / dT - rec.turn) * Math.min(1, dt * 3); rec.h = s.h; rec.t = t; }
    else if (dT < -0.001 || dT >= 3) { rec.h = s.h; rec.t = t; rec.turn = 0; }
    const bank = clamp(rec.turn * (BANK[s.type] ?? 0.02), -0.18, 0.18) * Math.min(1, sp * 2);

    // sails: up while sailing, furled otherwise; trimmed and heeled to the day's wind
    const sailer = SAILERS.has(s.type);
    const sailing = sailer && (s.phase === 'underway' || s.phase === 'fishing') && !s.astern && s.speed > 0.02 && !(s.type === 'sailboat' && L.motor);
    if (sailer) rec.sail += ((sailing ? 1 : 0) - rec.sail) * Math.min(1, dt * 0.6);
    let heel = 0, trim = 0;
    if (sailer) {
      const a = angDiff(wind.dir, s.h), sinA = Math.sin(a);
      heel = (HEEL[s.type] ?? 0) * wind.str * sinA * rec.sail;
      trim = clamp(sinA * 4, -1, 1) * 1.3 * (1 - Math.abs(a) / Math.PI);
      rec.yaw += (trim - rec.yaw) * Math.min(1, dt * 1.6);
    }

    // heave, pitch and roll on the swell: a third as much at a mooring
    const mk = moored ? 0.33 : 1, A = spec.heave * mk * L.k;
    const ph = time * L.w;
    const heave = A * (Math.sin(ph + L.p1) + 0.35 * Math.sin(ph * 1.73 + L.p2));
    const pitch = clamp((1.4 * spec.heave) / spec.len, 0.0006, 0.05) * mk * Math.cos(ph + L.p1) + (TRIM[s.type] ?? 0.008) * Math.min(1, sp) * (s.astern ? 0 : 1);
    const roll = clamp(spec.heave / spec.beam, 0.004, 0.06) * mk * Math.sin(ph * 0.83 + L.p3) + bank + heel;

    // where it lies at a berth, and how it is turned: no two boats alike
    let x = s.x, z = s.z, h = s.h;
    if (moored) {
      const ch = Math.cos(s.h), sh = Math.sin(s.h);
      x += ch * L.lieX - sh * L.lieZ; z += sh * L.lieX + ch * L.lieZ; h += L.lieYaw;
    }
    const fade = Math.max(0.001, s.fade);
    this.p.set(x, heave - (1 - s.fade) * 0.02, z);
    this.q.setFromEuler(this.e.set(roll, -h, pitch, 'YZX'));
    this.sc.set(fade, fade, fade);
    this.m.compose(this.p, this.q, this.sc);

    // parts
    ts.hull.mesh.setMatrixAt(i, this.m); ts.hull.mesh.setColorAt(i, this.col.copy(L.hull).multiplyScalar(lift));
    if (ts.accent) { ts.accent.mesh.setMatrixAt(i, this.m); ts.accent.mesh.setColorAt(i, this.col.copy(L.accent).multiplyScalar(lift)); }
    ts.works.mesh.setMatrixAt(i, this.m); ts.works.mesh.setColorAt(i, this.col.setScalar(lift));
    if (ts.glass) {
      const lit = night * (L.lit || s.lights.accommodation ? 1 : 0);
      // riding this boat: its windows would hang in front of the eye as dark panes, so they are left out of its own view
      ts.glass.mesh.setMatrixAt(i, this.cabView && s.id === this.selected ? this.tmp.makeScale(0, 0, 0) : this.m);
      ts.glass.mesh.setColorAt(i, this.col.copy(GLASS_DAY).lerp(L.warm, lit).multiplyScalar(lift * (1 + 0.5 * lit)));
    }
    md.sails.forEach((sd, k) => {
      const sl = ts.sails[k];
      const f = Math.max(0.08, rec.sail);
      this.tmp.copy(this.m).multiply(this.mi.makeTranslation(sd.pivot[0], sd.pivot[1], sd.pivot[2])).multiply(this.mi.makeRotationY(rec.yaw * sd.k * rec.sail));
      this.tmp.multiply(this.mj.makeScale(0.35 + 0.65 * f, f, 1));
      sl.mesh.setMatrixAt(sl.n, this.tmp); sl.mesh.setColorAt(sl.n, this.col.copy(L.sail).multiplyScalar(lift)); sl.n++;
    });
    if (L.opt && ts.opt) { ts.opt.mesh.setMatrixAt(ts.opt.n, this.m); ts.opt.mesh.setColorAt(ts.opt.n, this.col.setScalar(lift)); ts.opt.n++; }
    const cs = L.cargo >= 0 ? ts.cargo[L.cargo] : null;
    if (cs) { cs.mesh.setMatrixAt(cs.n, this.m); cs.mesh.setColorAt(cs.n, this.col.setScalar(lift)); cs.n++; }

    // fenders hung over the side of a boat at a berth
    if (moored && this.nFender + L.fenders * 2 <= MAX_FENDERS) {
      const fs = 0.6 + spec.beam * 2.5;
      for (let k = 0; k < L.fenders; k++) for (const sd of [-1, 1]) {
        const fx = (k - (L.fenders - 1) / 2) * spec.len * 0.28 + (hash2(Math.floor(s.seed * 65536), 40 + k) - 0.5) * spec.len * 0.06;
        this.tmp.copy(this.m).multiply(this.mi.makeTranslation(fx, md.free * 0.5, sd * (spec.beam / 2 + 0.002)));
        this.mi.makeScale(fs * fade, fs * fade, fs * fade);
        this.tmp.multiply(this.mi);
        this.fenders.setMatrixAt(this.nFender, this.tmp); this.fenders.setColorAt(this.nFender, this.col.copy(L.fenderCol)); this.nFender++;
      }
    }

    // wake and bow wave while it moves through the water
    if (!moored && s.speed > 0.012 && this.nWake < this.wakes.instanceMatrix.count) {
      const k = this.nWake++, wl = Math.min(9, spec.len * (1.6 + 3.2 * Math.min(1, sp))), ww = wl * 0.34 + spec.beam;
      const a = clamp(Math.min(1, sp) ** 0.7 * Math.min(1, fade) * 0.8, 0, 1);
      // astern, the bow wave and the wake swap ends
      const end = s.astern ? -spec.len / 2 : spec.len / 2;
      this.tmp.compose(this.p.set(x + Math.cos(h) * end * 0.92, 0.006, z + Math.sin(h) * end * 0.92), this.q.setFromAxisAngle(this.v.set(0, 1, 0), -h + (s.astern ? Math.PI : 0)), this.sc.set(wl, 1, ww));
      this.wakes.setMatrixAt(k, this.tmp);
      this.wakes.setColorAt(k, this.col.copy(FOAM).multiplyScalar(0.35 + 0.65 * (1 - night)));
      this.wakeFade.setX(k, a * 0.85);
      if (this.nBow < this.bows.instanceMatrix.count && sp > 0.15) {
        const b = this.nBow++, bl = spec.len * 0.9, bw = spec.beam * 3.2 + spec.len * 0.2;
        this.tmp.compose(this.p.set(x + Math.cos(h) * (end * 1.06), 0.007, z + Math.sin(h) * (end * 1.06)), this.q.setFromAxisAngle(this.v.set(0, 1, 0), -h + (s.astern ? Math.PI : 0)), this.sc.set(bl, 1, bw));
        this.bows.setMatrixAt(b, this.tmp);
        this.bows.setColorAt(b, this.col.copy(FOAM).multiplyScalar(0.4 + 0.6 * (1 - night)));
        this.bowFade.setX(b, clamp((sp - 0.15) * 1.3, 0, 1) * Math.min(1, fade) * 0.8);
      }
    }

    // lights
    this.m.compose(this.p.set(x, heave - (1 - s.fade) * 0.02, z), this.q.setFromEuler(this.e.set(roll, -h, pitch, 'YZX')), this.sc.set(fade, fade, fade));
    const size = clamp(0.009 + 0.006 * spec.len, 0.01, 0.034) * fade, dayK = 0.35 + 0.65 * night;
    const lt = this.cabView && s.id === this.selected ? NO_LIGHTS : s.lights;
    const add = (pos: readonly number[], sz: number, color: Color, glowK: number) => {
      if (this.nLights >= MAX_LIGHTS) return;
      const n = this.nLights++;
      this.v.set(pos[0], pos[1], pos[2]).applyMatrix4(this.m);
      this.mi.makeScale(sz, sz, sz).setPosition(this.v);
      this.lightBoxes.setMatrixAt(n, this.mi); this.lightBoxes.setColorAt(n, this.col2.copy(color).multiplyScalar(dayK));
      const gs = sz * glowK * (1 + 0.8 * night);
      this.mj.makeScale(gs, gs, gs).setPosition(this.v);
      this.glow.setMatrixAt(n, this.mj); this.glow.setColorAt(n, this.col2);
    };
    if (lt.nav) { add(md.port, size, RED, 1.7); add(md.stbd, size, GREEN, 1.7); add(md.stern, size, WHITE, 1.6); if (!lt.trawling) add(md.mast, size * 1.1, WHITE, 1.7); }
    else if (lt.anchor) add(md.mast, size * 1.1, WHITE, 1.8);
    if (lt.trawling) { add(md.mast, size * 1.1, GREEN, 1.7); add([md.mast[0], md.mast[1] - 0.025, md.mast[2]], size * 1.1, WHITE, 1.7); }
    if (lt.deck) for (const d of md.deck) add(d, size * 1.2, WARM, 2.2);
    if (md.blue && lt.nav && Math.floor(time * 3 + L.p1) % 2 === 0) add(md.blue, size * 1.2, BLUE, 2.2);

    // picking and the wheelhouse
    this.picks.push(x, 0.05, z, s.id, h, spec.len);
    if (s.id === this.selected) {
      const q = new Quaternion().copy(this.q), eye = new Vector3(md.eye[0] * fade, md.eye[1] * fade, md.eye[2] * fade).applyQuaternion(q);
      this.pose = { x: this.p.x + eye.x, y: this.p.y + eye.y, z: this.p.z + eye.z, q, wheelhouse: md.wheelhouse };
    }
  }

  /** The boat under a screen point, by id, or null. */
  pick(px: number, py: number, camera: Camera, w: number, h: number): number | null {
    let best: number | null = null, bd = 1;
    const v = new Vector3(), v2 = new Vector3();
    camera.updateMatrixWorld();
    for (let i = 0; i < this.picks.length; i += 6) {
      v.set(this.picks[i], this.picks[i + 1], this.picks[i + 2]).project(camera);
      if (v.z > 1) continue;
      const hd = this.picks[i + 4], half = this.picks[i + 5] / 2;
      v2.set(this.picks[i] + Math.cos(hd) * half, this.picks[i + 1], this.picks[i + 2] + Math.sin(hd) * half).project(camera);
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h, ex = ((v2.x + 1) / 2) * w, ey = ((1 - v2.y) / 2) * h;
      const r = Math.max(13, Math.hypot(ex - sx, ey - sy) * 1.1 + 5), d = ((sx - px) ** 2 + (sy - py) ** 2) / (r * r);
      if (d < bd) { bd = d; best = this.picks[i + 3]; }
    }
    return best;
  }
  /** A boat as drawn last frame; null if it is not on the water in sight. */
  stateOf(id: number): BoatState | null { return this.byId.get(id) ?? null; }
  harbourOf(id: number): BoatHarbour | undefined { return this.harbourById.get(id); }
  /** The wheelhouse eye of the selected boat as drawn this frame. */
  helmPose(): HelmPose | null { return this.pose; }
  /** Every boat at a tick (debugging, screenshots). */
  at(tick: number): BoatState[] { return boatsAt(this.harbours, tick); }
  /** Debug helper: the first tick from `from` when a boat (of this type, if given) is in `phase`. */
  findPhase(phase: BoatPhase, from: number, type?: BoatType, span = TICKS_PER_DAY * 2): number | null {
    const out: BoatState[] = [];
    for (let t = from; t < from + span; t += 1) { boatsAt(this.harbours, t, out); if (out.some((s) => s.phase === phase && (!type || s.type === type))) return t; }
    return null;
  }
  /** The voyage a boat is on, if any (panels). */
  voyageOf(s: BoatState): Voyage | null { return s.voyage; }
  /** rate of turn (rad/tick, + to starboard) and hull colour of a boat drawn recently */
  turnOf(id: number): number { return this.recs.get(id)?.turn ?? 0; }
  hullOf(id: number): number { return this.recs.get(id)?.liv.hull.getHex() ?? 0x888888; }
  /** under motor this trip (a sailboat) */
  motoring(id: number): boolean { return this.recs.get(id)?.liv.motor ?? false; }
  /** how many boats of each type were drawn last frame (debugging) */
  counts(): Record<string, number> { const o: Record<string, number> = {}; for (const [t, ts] of this.types) if (ts.n) o[t] = ts.n; return o; }
}
