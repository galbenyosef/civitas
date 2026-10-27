import {
  BufferGeometry, BoxGeometry, CylinderGeometry, CircleGeometry, ConeGeometry, IcosahedronGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, Material, Quaternion, Euler, Vector3, Color, AdditiveBlending, DoubleSide, type Camera,
} from 'three';
import {
  flightsAt, flightState, timetable, PLANE_TYPES, airportFrame, gateCount, gateU, liveryIndex, bodyTintIndex, RUNWAY_WIDTH, TAXI_OFFSET, STAND_OFFSET, TERMINAL_OFFSET,
  TICKS_PER_DAY, AIRLINES, hash2, type Airport, type FlightState, type FlightPhase, type PlaneType,
} from '@msimcity/shared';
import { Kit } from './kit';
import { vehicleMaterial, sceneUniforms } from './materials';

/**
 * Planes. The schedule and every plane's pose come from the shared pure function
 * `flightsAt(airport, tick)` (shared/src/flights.ts); this file only draws them.
 *
 * Model frame: +x is forward, +y up, +z the right wing, and the origin is the main
 * gear contact point so a plane pitches about its wheels. Each type has its own silhouette
 * (shared/src/flights.ts PLANE_TYPES): engines on the wing or the tail, a T-tail or a low
 * one, slim or twin-aisle fuselages, two engines or four. One InstancedMesh per plane type
 * for the white body, two for the airline's livery (the fin, winglets and engine lips in
 * the tail colour, the cheat line in the stripe colour; shared/src/crews.ts AIRLINES), a gear
 * mesh that retracts, and for the turboprop spinning propellers. Every plane's paint is its
 * own: the colours jitter a little and weather by a per-flight amount (organic rule).
 * Lights (nav, beacon, strobes, landing) are small emissive boxes plus additive glow blobs.
 */

const MAX_PLANES = 16;
const GROUND_LIFT = 0.03;
const BODY_TINTS = [0xffffff, 0xf2f0e8, 0xe4eaf0, 0xf6f6f6].map((c) => new Color(c));
const AIRLINE_COLORS = AIRLINES.map((a) => ({ tail: new Color(a.tail), stripe: new Color(a.stripe), body: a.body !== undefined ? new Color(a.body) : null }));
const GRIME = new Color(0x8f8a7e);
/** A livery colour as this plane wears it: a touch of hue, saturation and lightness jitter, then weathering. */
function paint(out: Color, base: Color, seed: number, k: number, wear: number): Color {
  const n = Math.floor(seed * 65536);
  out.copy(base).offsetHSL((hash2(n, k) - 0.5) * 0.02, (hash2(n, k + 1) - 0.5) * 0.08, (hash2(n, k + 2) - 0.5) * 0.06);
  return out.lerp(GRIME, wear * 0.45).multiplyScalar(1 - wear * 0.2);
}
const RED = new Color(0xff2a20), GREEN = new Color(0x22ff55), WHITE = new Color(0xffffff), WARM = new Color(0xfff0c8);

// ---- geometry helpers -------------------------------------------------------------------------
type V3 = [number, number, number];

/** A convex solid from points and faces (vertex index loops), faces wound outward automatically. */
function solid(pts: V3[], faces: number[][]): BufferGeometry {
  const c: V3 = [0, 0, 0];
  for (const p of pts) { c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length; }
  const pos: number[] = [];
  for (const f of faces) {
    for (let i = 1; i + 1 < f.length; i++) {
      let a = pts[f[0]], b = pts[f[i]], d = pts[f[i + 1]];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (a[0] + b[0] + d[0]) / 3 - c[0], my = (a[1] + b[1] + d[1]) / 3 - c[1], mz = (a[2] + b[2] + d[2]) / 3 - c[2];
      if (nx * mx + ny * my + nz * mz < 0) [b, d] = [d, b];
      pos.push(...a, ...b, ...d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
/** a quad (four points in order around its outline) thickened by ±off/2 */
function slab(q: V3[], off: V3): BufferGeometry {
  const pts: V3[] = [...q.map((p): V3 => [p[0] + off[0] / 2, p[1] + off[1] / 2, p[2] + off[2] / 2]), ...q.map((p): V3 => [p[0] - off[0] / 2, p[1] - off[1] / 2, p[2] - off[2] / 2])];
  return solid(pts, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]);
}
/** a swept wing half: root leading/trailing edge x at z=±zRoot, tip at ±zTip, tip raised by dih */
function wing(side: 1 | -1, y: number, xLERoot: number, chordRoot: number, xLETip: number, chordTip: number, zRoot: number, zTip: number, dih: number, thick: number): BufferGeometry {
  return slab([
    [xLERoot, y, side * zRoot], [xLERoot - chordRoot, y, side * zRoot],
    [xLETip - chordTip, y + dih, side * zTip], [xLETip, y + dih, side * zTip],
  ], [0, thick, 0]);
}
/** a vertical fin: base at y0, tip at y0+h, thickness t */
function fin(y0: number, h: number, xLERoot: number, chordRoot: number, xLETip: number, chordTip: number, t: number): BufferGeometry {
  return slab([[xLERoot, y0, 0], [xLERoot - chordRoot, y0, 0], [xLETip - chordTip, y0 + h, 0], [xLETip, y0 + h, 0]], [0, 0, t]);
}
/** cylinder along x, radius rFront at x1 (front) and rBack at x0 */
function cylX(rFront: number, rBack: number, x0: number, x1: number, y: number, z: number, seg = 12): BufferGeometry {
  return new CylinderGeometry(rFront, rBack, x1 - x0, seg).rotateZ(-Math.PI / 2).translate((x0 + x1) / 2, y, z);
}
/** wheel with its axle along z */
function wheelZ(r: number, w: number, x: number, y: number, z: number): BufferGeometry {
  return new CylinderGeometry(r, r, w, 10).rotateX(Math.PI / 2).translate(x, y, z);
}

interface LightLayout {
  navL: V3; navR: V3; navT: V3;
  beacon: V3;
  strobes: V3[];
  landing: V3;
  /** engine propeller centres (turboprop only) */
  props: V3[];
  gearPivot: V3;
  /** scale of glow blobs relative to the narrow-body */
  size: number;
}
interface TypeModel { body: BufferGeometry; tail: BufferGeometry; stripe: BufferGeometry; gear: BufferGeometry; lights: LightLayout }

/** the cockpit eye (x forward, y up from the main gear) just ahead of the nose */
const COCKPIT: Record<PlaneType, [number, number]> = {
  turboprop: [1.23, 0.285], regional: [1.53, 0.26], narrowbody: [1.83, 0.33], widebody: [2.38, 0.47], jumbo: [2.3, 0.74], bizjet: [0.8, 0.168],
};

const BODY = 0xffffff, WING = 0xe6eaee, GLASS = 0x1f2c3a, DARK = 0x16181b, NACELLE = 0xc4cad0, INTAKE = 0x24272b;

function narrowbody(): TypeModel {
  const c = 0.3, r = 0.17;
  const k = new Kit(), lv = new Kit(), st = new Kit(), gk = new Kit();
  k.part(cylX(r, r, -0.7, 1.3, c, 0), BODY)
    .part(cylX(0.04, r, 1.3, 1.8, c - 0.01, 0), BODY)
    .part(cylX(0.05, r, -1.2, -0.7, c + 0.04, 0), BODY)
    .box(1.45, 0.032, 0.352, 0.45, c + 0.03, 0, GLASS)
    .box(0.14, 0.05, 0.31, 1.38, c + 0.025, 0, GLASS);
  for (const side of [1, -1] as const) {
    k.part(wing(side, 0.2, 0.75, 0.65, 0.15, 0.2, 0.12, 1.3, 0.06, 0.035), WING);
    k.part(wing(side, c + 0.08, -0.85, 0.28, -1.12, 0.14, 0.05, 0.55, 0.02, 0.025), WING);
    k.part(cylX(0.07, 0.07, 0.12, 0.6, 0.13, side * 0.5, 10), NACELLE).part(cylX(0.055, 0.055, 0.6, 0.62, 0.13, side * 0.5, 10), INTAKE);
    lv.part(wing(side, 0.2 + 0.06, 0.2, 0.14, 0.12, 0.1, 1.3, 1.3, 0.16, 0.02), 0xffffff); // winglet
  }
  lv.part(fin(c + 0.12, 0.55, -0.75, 0.45, -1.05, 0.2, 0.03), 0xffffff);
  for (const side of [1, -1]) lv.part(cylX(0.074, 0.074, 0.585, 0.6, 0.13, side * 0.5, 10), 0xffffff); // engine lips
  st.box(2.0, 0.026, 0.354, 0.1, c - 0.055, 0, 0xffffff);
  // gear: nose + two mains with a pair of wheels each
  gk.cyl(0.012, 0.012, 0.14, 1.25, 0.05, 0, DARK, 5).part(wheelZ(0.035, 0.05, 1.25, 0.035, 0), DARK);
  for (const s of [1, -1]) gk.cyl(0.014, 0.014, 0.17, 0, 0.05, s * 0.2, DARK, 5).part(wheelZ(0.045, 0.1, 0, 0.045, s * 0.2), DARK);
  return {
    body: k.build(), tail: lv.build(), stripe: st.build(), gear: gk.build(),
    lights: { navL: [0.02, 0.27, -1.3], navR: [0.02, 0.27, 1.3], navT: [-1.27, c + 0.5, 0], beacon: [0.2, c + 0.18, 0], strobes: [[0.02, 0.27, -1.3], [0.02, 0.27, 1.3], [-1.27, c + 0.5, 0]], landing: [1.3, 0.2, 0], props: [], gearPivot: [0.5, 0.2, 0], size: 1 },
  };
}

function turboprop(): TypeModel {
  const c = 0.26, r = 0.13;
  const k = new Kit(), lv = new Kit(), st = new Kit(), gk = new Kit();
  k.part(cylX(r, r, -0.45, 0.85, c, 0), BODY)
    .part(cylX(0.035, r, 0.85, 1.2, c - 0.01, 0), BODY)
    .part(cylX(0.045, r, -0.8, -0.45, c + 0.03, 0), BODY)
    .box(1.0, 0.03, 0.272, 0.2, c + 0.025, 0, GLASS)
    .box(0.1, 0.045, 0.24, 0.98, c + 0.02, 0, GLASS);
  for (const side of [1, -1] as const) {
    k.part(wing(side, c + 0.12, 0.55, 0.55, 0.5, 0.3, 0.1, 1.05, 0.0, 0.03), WING);
    k.part(wing(side, c + 0.66, -0.52, 0.26, -0.7, 0.16, 0.0, 0.4, 0.0, 0.022), WING); // T-tail plane
    k.part(cylX(0.065, 0.065, -0.2, 0.62, c + 0.06, side * 0.45, 10), NACELLE).part(cylX(0.012, 0.065, 0.62, 0.7, c + 0.06, side * 0.45, 10), INTAKE);
  }
  lv.part(fin(c + 0.08, 0.58, -0.38, 0.4, -0.62, 0.18, 0.028), 0xffffff);
  st.box(1.5, 0.022, 0.274, 0.15, c - 0.04, 0, 0xffffff);
  for (const s of [1, -1]) {
    gk.cyl(0.012, 0.012, 0.22, 0.1, 0.04, s * 0.45, DARK, 5).part(wheelZ(0.04, 0.07, 0.1, 0.04, s * 0.45), DARK);
  }
  gk.cyl(0.01, 0.01, 0.17, 0.85, 0.04, 0, DARK, 5).part(wheelZ(0.03, 0.04, 0.85, 0.03, 0), DARK);
  return {
    body: k.build(), tail: lv.build(), stripe: st.build(), gear: gk.build(),
    lights: {
      navL: [0.35, c + 0.12, -1.05], navR: [0.35, c + 0.12, 1.05], navT: [-0.78, c + 0.55, 0], beacon: [0.1, c + 0.14, 0],
      strobes: [[0.35, c + 0.12, -1.05], [0.35, c + 0.12, 1.05], [-0.78, c + 0.55, 0]], landing: [0.95, 0.2, 0],
      props: [[0.7, c + 0.06, -0.45], [0.7, c + 0.06, 0.45]], gearPivot: [0.3, 0.2, 0], size: 0.8,
    },
  };
}

function bizjet(): TypeModel {
  const c = 0.15, r = 0.075;
  const k = new Kit(), lv = new Kit(), st = new Kit(), gk = new Kit();
  k.part(cylX(r, r, -0.25, 0.45, c, 0, 10), BODY)
    .part(cylX(0.02, r, 0.45, 0.78, c - 0.005, 0, 10), BODY)
    .part(cylX(0.03, r, -0.52, -0.25, c + 0.02, 0, 10), BODY)
    .box(0.55, 0.02, 0.156, 0.18, c + 0.02, 0, GLASS)
    .box(0.07, 0.03, 0.14, 0.6, c + 0.015, 0, GLASS);
  for (const side of [1, -1] as const) {
    k.part(wing(side, c - 0.04, 0.35, 0.37, -0.05, 0.1, 0.05, 0.6, 0.03, 0.02), WING);
    k.part(wing(side, c + 0.3, -0.42, 0.14, -0.5, 0.08, 0.0, 0.2, 0.0, 0.014), WING);
    k.part(cylX(0.04, 0.036, -0.55, -0.2, c + 0.045, side * 0.115, 8), NACELLE);
  }
  lv.part(fin(c + 0.05, 0.27, -0.38, 0.22, -0.52, 0.1, 0.02), 0xffffff);
  st.box(0.85, 0.016, 0.158, 0.12, c - 0.03, 0, 0xffffff);
  gk.cyl(0.007, 0.007, 0.08, 0.55, 0.03, 0, DARK, 5).part(wheelZ(0.02, 0.03, 0.55, 0.02, 0), DARK);
  for (const s of [1, -1]) gk.cyl(0.008, 0.008, 0.1, 0.0, 0.03, s * 0.1, DARK, 5).part(wheelZ(0.026, 0.035, 0, 0.026, s * 0.1), DARK);
  return {
    body: k.build(), tail: lv.build(), stripe: st.build(), gear: gk.build(),
    lights: { navL: [-0.1, c - 0.01, -0.6], navR: [-0.1, c - 0.01, 0.6], navT: [-0.5, c + 0.3, 0], beacon: [0.1, c + 0.09, 0], strobes: [[-0.1, c - 0.01, -0.6], [-0.1, c - 0.01, 0.6], [-0.5, c + 0.3, 0]], landing: [0.7, 0.12, 0], props: [], gearPivot: [0.25, 0.1, 0], size: 0.6 },
  };
}

/** A CRJ-like regional jet: slim and long, low wing, two engines hung on the tail under a T-tail. */
function regional(): TypeModel {
  const c = 0.22, r = 0.115;
  const k = new Kit(), lv = new Kit(), st = new Kit(), gk = new Kit();
  k.part(cylX(r, r, -0.55, 1.12, c, 0), BODY)
    .part(cylX(0.03, r, 1.12, 1.5, c - 0.01, 0), BODY)
    .part(cylX(0.04, r, -1.0, -0.55, c + 0.03, 0), BODY)
    .box(1.35, 0.026, 0.234, 0.3, c + 0.025, 0, GLASS)
    .box(0.09, 0.04, 0.2, 1.24, c + 0.02, 0, GLASS);
  for (const side of [1, -1] as const) {
    k.part(wing(side, 0.13, 0.42, 0.5, -0.06, 0.16, 0.09, 0.95, 0.05, 0.03), WING);
    k.part(wing(side, c + 0.5, -0.78, 0.2, -0.92, 0.11, 0.0, 0.36, 0.0, 0.02), WING); // T-tail plane
    // engines on short pylons either side of the rear fuselage
    k.box(0.22, 0.03, 0.1, -0.52, c + 0.05, side * 0.14, NACELLE);
    k.part(cylX(0.058, 0.05, -0.78, -0.36, c + 0.07, side * 0.215, 10), NACELLE).part(cylX(0.046, 0.046, -0.36, -0.345, c + 0.07, side * 0.215, 10), INTAKE);
    lv.part(wing(side, 0.13 + 0.05, -0.04, 0.12, -0.1, 0.07, 0.95, 0.95, 0.12, 0.016), 0xffffff); // winglet
    lv.part(cylX(0.062, 0.062, -0.375, -0.36, c + 0.07, side * 0.215, 10), 0xffffff);
  }
  lv.part(fin(c + 0.08, 0.43, -0.6, 0.38, -0.85, 0.18, 0.026), 0xffffff);
  st.box(1.7, 0.022, 0.234, 0.2, c - 0.04, 0, 0xffffff);
  gk.cyl(0.01, 0.01, 0.12, 1.2, 0.04, 0, DARK, 5).part(wheelZ(0.03, 0.04, 1.2, 0.03, 0), DARK);
  for (const s of [1, -1]) gk.cyl(0.012, 0.012, 0.13, 0, 0.04, s * 0.15, DARK, 5).part(wheelZ(0.038, 0.08, 0, 0.038, s * 0.15), DARK);
  return {
    body: k.build(), tail: lv.build(), stripe: st.build(), gear: gk.build(),
    lights: {
      navL: [-0.06, 0.18, -0.95], navR: [-0.06, 0.18, 0.95], navT: [-0.92, c + 0.5, 0], beacon: [0.2, c + 0.12, 0],
      strobes: [[-0.06, 0.18, -0.95], [-0.06, 0.18, 0.95], [-0.92, c + 0.5, 0]], landing: [1.05, 0.15, 0], props: [], gearPivot: [0.5, 0.16, 0], size: 0.8,
    },
  };
}

/** A big underwing turbofan on a pylon, with a dark intake and exhaust cone; its lip goes in the livery kit. */
function bigEngine(k: Kit, lv: Kit, x0: number, x1: number, y: number, z: number, rad: number, wingY: number) {
  k.box((x1 - x0) * 0.7, wingY - y - rad * 0.6, 0.03, (x0 + x1) / 2 + 0.04, y + rad * 0.6, z, NACELLE) // pylon
    .part(cylX(rad, rad * 0.8, x0, x1, y, z, 12), NACELLE)
    .part(cylX(rad * 0.82, rad * 0.82, x1, x1 + 0.015, y, z, 12), INTAKE)
    .part(cylX(rad * 0.45, 0.001, x0 - 0.12, x0, y, z, 8), INTAKE); // exhaust cone
  lv.part(cylX(rad * 1.04, rad * 1.04, x1 - 0.05, x1, y, z, 12), 0xffffff);
}

/** A 777-like twin-aisle wide-body: a fat fuselage on tall gear, long swept wings with two huge engines, a low tail. */
function widebody(): TypeModel {
  const c = 0.42, r = 0.25;
  const k = new Kit(), lv = new Kit(), st = new Kit(), gk = new Kit();
  k.part(cylX(r, r, -0.85, 1.85, c, 0, 16), BODY)
    .part(cylX(0.06, r, 1.85, 2.34, c - 0.02, 0, 16), BODY)
    .part(cylX(0.07, r, -1.56, -0.85, c + 0.07, 0, 16), BODY)
    .box(2.5, 0.036, 2 * r + 0.004, 0.45, c + 0.06, 0, GLASS)
    .box(0.13, 0.06, 0.4, 1.98, c + 0.05, 0, GLASS)
    .box(0.75, 0.1, 0.42, 0.42, 0.26, 0, WING); // wing-to-body fairing
  for (const side of [1, -1] as const) {
    k.part(wing(side, 0.28, 0.95, 0.95, -0.18, 0.24, 0.18, 1.59, 0.12, 0.05), WING);
    k.part(wing(side, c + 0.1, -1.04, 0.42, -1.4, 0.18, 0.06, 0.72, 0.05, 0.03), WING);
    bigEngine(k, lv, 0.38, 1.0, 0.18, side * 0.6, 0.13, 0.3);
  }
  lv.part(fin(c + 0.2, 0.8, -1.0, 0.62, -1.42, 0.26, 0.04), 0xffffff);
  st.box(3.0, 0.04, 2 * r + 0.006, 0.3, c - 0.07, 0, 0xffffff).box(2.6, 0.016, 2 * r + 0.008, 0.35, c - 0.02, 0, 0xffffff);
  // gear: a twin-wheel nose leg and two six-wheel bogies
  gk.cyl(0.016, 0.016, 0.3, 1.95, 0.05, 0, DARK, 5).part(wheelZ(0.045, 0.07, 1.95, 0.045, 0), DARK);
  for (const s of [1, -1]) {
    gk.cyl(0.022, 0.022, 0.32, 0, 0.06, s * 0.3, DARK, 5).box(0.34, 0.02, 0.02, 0, 0.06, s * 0.3, DARK);
    for (const x of [-0.12, 0, 0.12]) gk.part(wheelZ(0.055, 0.14, x, 0.055, s * 0.3), DARK);
  }
  return {
    body: k.build(), tail: lv.build(), stripe: st.build(), gear: gk.build(),
    lights: {
      navL: [-0.2, 0.42, -1.59], navR: [-0.2, 0.42, 1.59], navT: [-1.55, c + 0.1, 0], beacon: [0.4, c + r + 0.02, 0],
      strobes: [[-0.2, 0.42, -1.59], [-0.2, 0.42, 1.59], [-1.55, c + 0.1, 0]], landing: [1.4, 0.3, 0], props: [], gearPivot: [0.9, 0.36, 0], size: 1.35,
    },
  };
}

/** A 747-like jumbo: the upper-deck hump over the nose, four engines under the wings, a low tail. */
function jumbo(): TypeModel {
  const c = 0.44, r = 0.26;
  const k = new Kit(), lv = new Kit(), st = new Kit(), gk = new Kit();
  k.part(cylX(r, r, -0.9, 1.95, c, 0, 16), BODY)
    .part(cylX(0.07, r, 1.95, 2.46, c - 0.03, 0, 16), BODY)
    .part(cylX(0.07, r, -1.64, -0.9, c + 0.07, 0, 16), BODY)
    // the hump: an upper deck from the nose back over the wing root, faired in at both ends
    .part(cylX(0.18, 0.18, 0.9, 1.95, c + 0.16, 0, 14), BODY)
    .part(cylX(0.05, 0.18, 1.95, 2.3, c + 0.1, 0, 14), BODY)
    .part(cylX(0.18, 0.04, 0.5, 0.9, c + 0.17, 0, 14), BODY)
    .box(2.6, 0.036, 2 * r + 0.004, 0.4, c + 0.05, 0, GLASS)
    .box(1.0, 0.03, 0.364, 1.4, c + 0.24, 0, GLASS)
    .box(0.08, 0.035, 0.24, 2.08, c + 0.17, 0, GLASS)
    .box(0.8, 0.1, 0.44, 0.45, 0.27, 0, WING);
  for (const side of [1, -1] as const) {
    k.part(wing(side, 0.3, 1.0, 1.0, -0.3, 0.22, 0.2, 1.59, 0.12, 0.05), WING);
    k.part(wing(side, c + 0.1, -1.1, 0.45, -1.5, 0.2, 0.06, 0.78, 0.05, 0.03), WING);
    bigEngine(k, lv, 0.48, 0.96, 0.2, side * 0.56, 0.095, 0.32);
    bigEngine(k, lv, 0.04, 0.5, 0.25, side * 1.06, 0.09, 0.37);
    lv.part(wing(side, 0.3 + 0.12, -0.28, 0.16, -0.36, 0.08, 1.59, 1.6, 0.14, 0.02), 0xffffff); // winglet
  }
  lv.part(fin(c + 0.2, 0.84, -1.05, 0.64, -1.5, 0.26, 0.04), 0xffffff);
  st.box(3.1, 0.04, 2 * r + 0.006, 0.2, c - 0.08, 0, 0xffffff).box(1.05, 0.02, 0.368, 1.4, c + 0.2, 0, 0xffffff);
  gk.cyl(0.016, 0.016, 0.32, 2.05, 0.05, 0, DARK, 5).part(wheelZ(0.045, 0.07, 2.05, 0.045, 0), DARK);
  for (const s of [1, -1]) for (const z of [0.16, 0.38]) {
    gk.cyl(0.02, 0.02, 0.32, z === 0.16 ? -0.15 : 0.05, 0.06, s * z, DARK, 5);
    for (const x of [-0.07, 0.07]) gk.part(wheelZ(0.055, 0.12, x + (z === 0.16 ? -0.15 : 0.05), 0.055, s * z), DARK);
  }
  return {
    body: k.build(), tail: lv.build(), stripe: st.build(), gear: gk.build(),
    lights: {
      navL: [-0.3, 0.44, -1.6], navR: [-0.3, 0.44, 1.6], navT: [-1.63, c + 0.1, 0], beacon: [0.4, c + r + 0.02, 0],
      strobes: [[-0.3, 0.44, -1.6], [-0.3, 0.44, 1.6], [-1.63, c + 0.1, 0]], landing: [1.5, 0.3, 0], props: [], gearPivot: [0.9, 0.38, 0], size: 1.4,
    },
  };
}

interface TypeMeshes {
  body: InstancedMesh; tail: InstancedMesh; stripe: InstancedMesh; gear: InstancedMesh;
  props?: InstancedMesh; discs?: InstancedMesh;
  lights: LightLayout; n: number;
}

// ---- the view ---------------------------------------------------------------------------------

export class PlanesView {
  group = new Group();
  airports: Airport[] = [];
  /** override the tick the planes are drawn at (screenshots, debugging); null follows the game clock */
  debugTick: number | null = null;
  /** states drawn in the last frame, and the airport of each */
  states: FlightState[] = [];
  stateAirports: Airport[] = [];
  /** the plane under the cursor and the selected one, as `airport:flight` keys: drawn brighter (the selected one pulsing) */
  hover: string | null = null;
  selected: string | null = null;
  /** the tick drawn last frame, so a cockpit view sits exactly on the plane as drawn */
  lastTick = 0;
  /** plane centres drawn last frame, flat x, y, z, airport id, flight id, for picking */
  private picks: number[] = [];
  private types: Record<PlaneType, TypeMeshes>;
  private lightBoxes: InstancedMesh;
  private glow: InstancedMesh;
  private beams: InstancedMesh;
  private glowMat: MeshBasicMaterial;
  private beamMat: MeshBasicMaterial;
  private fields: Group[] = [];
  private fieldLights: { mesh: InstancedMesh; mat: MeshBasicMaterial }[] = [];
  private gearAnim = new Map<number, number>();
  private last = performance.now();
  private m = new Matrix4();
  private mi = new Matrix4();
  private tmp = new Matrix4();
  private q = new Quaternion();
  private e = new Euler(0, 0, 0, 'YZX');
  private p = new Vector3();
  private s = new Vector3();
  private col = new Color();
  private nLights = 0;
  private nBeams = 0;
  private prewarmed = -1;

  constructor() {
    const vm = vehicleMaterial();
    const make = (model: TypeModel, props: boolean): TypeMeshes => {
      const mk = (g: BufferGeometry, mat: Material = vm, max = MAX_PLANES) => {
        const mesh = new InstancedMesh(g, mat, max);
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
        this.group.add(mesh);
        return mesh;
      };
      const t: TypeMeshes = { body: mk(model.body), tail: mk(model.tail), stripe: mk(model.stripe), gear: mk(model.gear), lights: model.lights, n: 0 };
      if (props) {
        // two crossed blades (four in all) and a translucent disc standing in for the blur
        const bk = new Kit();
        bk.part(new BoxGeometry(0.02, 0.5, 0.04), 0x16181b).part(new BoxGeometry(0.02, 0.04, 0.5), 0x16181b);
        t.props = mk(bk.build(), vm, MAX_PLANES * 2);
        t.props.castShadow = false;
        const disc = new MeshBasicMaterial({ color: 0x20242a, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });
        t.discs = mk(new CircleGeometry(0.26, 16).rotateY(Math.PI / 2), disc, MAX_PLANES * 2);
        t.discs.castShadow = false;
      }
      return t;
    };
    this.types = {
      turboprop: make(turboprop(), true), regional: make(regional(), false), narrowbody: make(narrowbody(), false),
      widebody: make(widebody(), false), jumbo: make(jumbo(), false), bizjet: make(bizjet(), false),
    };

    // light boxes (colour per instance), glow blobs and landing-light beams
    this.lightBoxes = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ toneMapped: false }), MAX_PLANES * 10);
    this.glowMat = new MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    this.glow = new InstancedMesh(new IcosahedronGeometry(1, 1), this.glowMat, MAX_PLANES * 10);
    this.beamMat = new MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    this.beams = new InstancedMesh(new ConeGeometry(0.55, 6, 12, 1, true).rotateZ(Math.PI / 2).translate(3, 0, 0).rotateZ(-0.22), this.beamMat, MAX_PLANES * 2);
    for (const mesh of [this.lightBoxes, this.glow, this.beams]) { mesh.count = 0; mesh.frustumCulled = false; this.group.add(mesh); }
  }

  private real: Airport[] = [];
  private previews: Airport[] = [];
  /** Airports built on the map (terminal + runway tiles draw their own field). Planes only. */
  setAirports(list: Airport[]) {
    this.real = list.slice();
    this.airports = [...this.real, ...this.previews];
  }
  /** `?airport=` previews on open land: planes plus the placeholder field decals below. */
  setPreviews(list: Airport[]) {
    this.previews = list.slice();
    this.airports = [...this.real, ...this.previews];
    for (const f of this.fields) { this.group.remove(f); f.traverse((o) => { if (o instanceof Mesh || o instanceof InstancedMesh) o.geometry.dispose(); }); }
    this.fields = []; this.fieldLights = [];
    for (const ap of this.previews) this.buildField(ap);
  }

  /**
   * Placeholder airfield for `?airport=` previews on open land: a runway, taxiway, apron, gate stands and a box
   * terminal drawn as flat decals. Real airports draw nothing here: the terminal is a catalogue structure
   * (buildings/terminal.ts) and the runway is airfield tiles (chunkView, render/airfield.ts).
   */
  private buildField(ap: Airport) {
    const L = Math.max(8, ap.runwayLen), f = airportFrame(ap);
    const k = new Kit();
    const APRON = 0x8f9396, ASPHALT = 0x2f3236, PAINT = 0xf2f2f2, YELLOW = 0xe8c53a, TERM = 0xb9bec4, GLASS_C = 0x35506b;
    const y0 = 0, hA = 0.015, yR = hA, hR = 0.015, yM = hA + hR, hM = 0.012;
    // apron slab, runway, taxiway and the two connectors
    k.box(L + 3, hA, TERMINAL_OFFSET - 2.2 + 0.2, 0, y0, (TERMINAL_OFFSET + 2.2) / 2, APRON);
    k.box(L + 1.5, hR, RUNWAY_WIDTH, 0, yR, 0, ASPHALT);
    k.box(L + 1.0, hR, 1.2, 0, yR, TAXI_OFFSET, ASPHALT);
    for (const sgn of [1, -1]) k.box(1.1, hR, TAXI_OFFSET - RUNWAY_WIDTH / 2 + 0.2, sgn * (L / 2 - 0.9), yR, (TAXI_OFFSET + RUNWAY_WIDTH / 2) / 2 - 0.1, ASPHALT);
    // runway markings: centreline dashes, threshold bars, edge stripes
    for (let u = -L / 2 + 2.2; u < L / 2 - 1.6; u += 1.0) k.box(0.55, hM, 0.07, u, yM, 0, PAINT);
    for (const sgn of [1, -1]) for (let i = -3; i <= 3; i++) if (i) k.box(0.55, hM, 0.07, sgn * (L / 2 - 0.35), yM, i * 0.18, PAINT);
    for (const sgn of [1, -1]) k.box(L + 1.0, hM, 0.025, 0, yM, sgn * (RUNWAY_WIDTH / 2 - 0.05), PAINT);
    // taxiway centre line and the lead-in lines to each stand
    k.box(L + 0.8, hM, 0.04, 0, yM, TAXI_OFFSET, YELLOW);
    for (const sgn of [1, -1]) k.box(0.04, hM, TAXI_OFFSET - 0.2, sgn * (L / 2 - 0.9), yM, TAXI_OFFSET / 2, YELLOW);
    const n = gateCount(ap);
    for (let i = 0; i < n; i++) {
      const u = gateU(ap, i);
      k.box(0.04, hM, STAND_OFFSET - TAXI_OFFSET, u, yM, (STAND_OFFSET + TAXI_OFFSET) / 2, YELLOW);
      k.box(0.7, hM, 0.04, u, yM, STAND_OFFSET + 1.75, YELLOW);
      k.box(0.05, hM, 0.5, u - 1.4, yM, STAND_OFFSET + 0.5, PAINT).box(0.05, hM, 0.5, u + 1.4, yM, STAND_OFFSET + 0.5, PAINT);
    }
    // box terminal
    const tw = Math.max(L, (n - 1) * 3.3 + 4);
    k.box(tw, 0.42, 1.5, 0, hA, TERMINAL_OFFSET + 0.85, TERM).box(tw - 0.4, 0.12, 1.52, 0, 0.2, TERMINAL_OFFSET + 0.85, GLASS_C);
    const mat = vehicleMaterial();
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
    const mesh = new Mesh(k.build(), mat);
    mesh.receiveShadow = true; mesh.castShadow = false;

    // runway edge lights (bright at night)
    const lightMat = new MeshBasicMaterial({ color: 0x777770, toneMapped: false });
    const lights = [] as number[]; // u, v, blue?
    for (let u = -L / 2 - 0.2; u <= L / 2 + 0.21; u += 1.0) for (const v of [-RUNWAY_WIDTH / 2 - 0.05, RUNWAY_WIDTH / 2 + 0.05]) lights.push(u, v, 0);
    for (let u = -L / 2; u <= L / 2 + 0.01; u += 1.5) for (const v of [TAXI_OFFSET - 0.65, TAXI_OFFSET + 0.65]) lights.push(u, v, 1);
    const edge = new InstancedMesh(new BoxGeometry(0.045, 0.03, 0.045), lightMat, lights.length / 3);
    for (let i = 0; i < lights.length / 3; i++) {
      edge.setMatrixAt(i, this.tmp.makeTranslation(lights[i * 3], 0.035, lights[i * 3 + 1]));
      edge.setColorAt(i, lights[i * 3 + 2] ? this.col.setHex(0x4d82ff) : this.col.setHex(0xfff4d6));
    }
    edge.frustumCulled = false;

    const g = new Group();
    g.add(mesh, edge);
    g.position.set(f.cx, 0, f.cz);
    g.rotation.y = -Math.atan2(f.az, f.ax);
    this.group.add(g);
    this.fields.push(g);
    this.fieldLights.push({ mesh: edge, mat: lightMat });
  }

  /** the flights currently shown (all airports) */
  flights(tick: number): FlightState[] {
    const out: FlightState[] = [];
    for (const ap of this.airports) flightsAt(ap, tick, []).forEach((s) => out.push(s));
    return out;
  }

  /**
   * Debug helper: the first tick at or after `from` when some plane at the first airport is in `phase`
   * (optionally the `progress` fraction of the way through it), searching up to `span` ticks ahead.
   */
  findPhase(phase: FlightPhase, from: number, progress = 0.5, span = TICKS_PER_DAY * 2, type?: PlaneType): number | null {
    const ap = this.airports[0];
    if (!ap) return null;
    for (let t = from; t < from + span; t += 0.5) {
      const day = Math.floor(t / TICKS_PER_DAY);
      for (const f of timetable(ap, day)) {
        if (t < f.tApproach || t > f.tEnd || (type && f.type !== type)) continue;
        const s = flightsAt(ap, t).find((x) => x.id === f.id);
        if (s && s.phase === phase && s.progress >= progress) return t;
      }
    }
    return null;
  }

  frame(tick: number) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const night = sceneUniforms.uNight.value;
    const time = now / 1000;
    const t = this.debugTick ?? tick;

    // edge lights come up at dusk
    for (const fl of this.fieldLights) fl.mat.color.setScalar(0.45 + 0.75 * night);
    this.glowMat.opacity = 0.25 + 0.3 * night;
    this.beamMat.opacity = 0.09 * night * night;

    for (const tm of Object.values(this.types)) tm.n = 0;
    this.nLights = 0; this.nBeams = 0;
    this.states.length = 0; this.stateAirports.length = 0; this.picks.length = 0;
    this.lastTick = t;
    const day = Math.floor(t / TICKS_PER_DAY);
    const prewarm = (t % TICKS_PER_DAY) > TICKS_PER_DAY - 200 && this.prewarmed !== day;
    if (prewarm) this.prewarmed = day;
    for (const ap of this.airports) {
      // build tomorrow's timetable before midnight so there is no hitch when the day turns over
      if (prewarm) timetable(ap, day + 1);
      for (const s of flightsAt(ap, t)) {
        this.states.push(s); this.stateAirports.push(ap);
        this.draw(s, dt, time, night, this.lift(`${ap.id}:${s.id}`));
        // three points along the fuselage, so a long plane is picked by its nose and tail as well as its middle
        const len = PLANE_TYPES[s.type].length, c = Math.cos(s.heading), sn = Math.sin(s.heading);
        for (const f of [-0.35, 0.1, 0.5]) this.picks.push(s.x + c * len * f, s.y + 0.25, s.z + sn * len * f, ap.id, s.id);
      }
    }
    for (const type of Object.values(this.types)) {
      for (const mesh of [type.body, type.tail, type.stripe, type.gear, type.props, type.discs]) {
        if (!mesh) continue;
        mesh.count = mesh === type.props || mesh === type.discs ? type.n * 2 : type.n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.lightBoxes.count = this.nLights; this.glow.count = this.nLights; this.beams.count = this.nBeams;
    for (const mesh of [this.lightBoxes, this.glow, this.beams]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // forget the gear animation of planes that have gone
    if (this.gearAnim.size > 64) { const alive = new Set(this.states.map((s) => s.id)); for (const id of [...this.gearAnim.keys()]) if (!alive.has(id)) this.gearAnim.delete(id); }
  }

  /** colour lift of a plane: hovered, or selected and pulsing gently */
  private lift(key: string) { return key === this.selected ? 1.3 + 0.2 * Math.sin(performance.now() / 260) : key === this.hover ? 1.25 : 1; }

  /** The plane under a screen point (within `radius` px of its fuselage), or null. */
  pick(px: number, py: number, camera: Camera, w: number, h: number, radius = 26): { airport: number; flight: number } | null {
    let best: { airport: number; flight: number } | null = null, bd = radius * radius;
    const v = new Vector3();
    camera.updateMatrixWorld();
    for (let i = 0; i < this.picks.length; i += 5) {
      v.set(this.picks[i], this.picks[i + 1], this.picks[i + 2]).project(camera);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h, d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) { bd = d; best = { airport: this.picks[i + 3], flight: this.picks[i + 4] }; }
    }
    return best;
  }
  /** A flight at `tick` (default: as drawn last frame), with its airport; null once it has gone (or not yet come). */
  stateOf(airport: number, flight: number, tick = this.lastTick): { ap: Airport; s: FlightState } | null {
    const ap = this.airports.find((a) => a.id === airport);
    if (!ap) return null;
    // flight ids are day * 1000 + index (shared/src/flights.ts)
    const f = timetable(ap, Math.floor(flight / 1000)).find((x) => x.id === flight);
    if (!f || tick < f.tApproach || tick > f.tEnd) return null;
    return { ap, s: flightState(ap, f, tick) };
  }
  /** The pilot's eye: just ahead of and above the nose, in the plane's frame (+x forward), and the plane's orientation. */
  cockpitOf(s: FlightState): { x: number; y: number; z: number; q: Quaternion } {
    const o = COCKPIT[s.type];
    const q = new Quaternion().setFromEuler(new Euler(s.bank, -s.heading, s.pitch, 'YZX'));
    const p = new Vector3(o[0], o[1], 0).applyQuaternion(q);
    return { x: s.x + p.x, y: s.y + GROUND_LIFT + p.y, z: s.z + p.z, q };
  }

  /**
   * A cabin seat's eye (render/passenger.ts cabinSeat): the point (x, y, z) of the plane's own frame (+x the nose, +y up from the
   * main gear, +z the right wing) where it is now, and the plane's orientation turned `yaw` to the right, into `pos` and `q`.
   */
  cabinOf(s: FlightState, x: number, y: number, z: number, yaw: number, pos: Vector3, q: Quaternion) {
    q.setFromEuler(this.ce.set(s.bank, -s.heading, s.pitch, 'YZX'));
    pos.set(x, y, z).applyQuaternion(q);
    pos.x += s.x; pos.y += s.y + GROUND_LIFT; pos.z += s.z;
    q.multiply(this.cq.setFromAxisAngle(this.cy, -yaw));
  }
  private ce = new Euler(); private cq = new Quaternion(); private cy = new Vector3(0, 1, 0);

  private draw(s: FlightState, dt: number, time: number, night: number, lift = 1) {
    const type = this.types[s.type];
    const i = type.n;
    if (i >= MAX_PLANES) return;
    type.n++;
    const sc = Math.max(0.001, s.fade);
    this.p.set(s.x, s.y + GROUND_LIFT, s.z);
    this.q.setFromEuler(this.e.set(s.bank, -s.heading, s.pitch, 'YZX'));
    this.s.set(sc, sc, sc);
    this.m.compose(this.p, this.q, this.s);
    type.body.setMatrixAt(i, this.m);
    type.tail.setMatrixAt(i, this.m);
    type.stripe.setMatrixAt(i, this.m);
    // the airline's livery as this airframe wears it: per-plane jitter and weathering (a private jet is plain)
    const al = AIRLINE_COLORS[liveryIndex(s.seed)], wear = hash2(Math.floor(s.seed * 65536), 31) ** 2 * 0.4;
    const biz = s.type === 'bizjet';
    paint(this.col, (!biz && al.body) || BODY_TINTS[bodyTintIndex(s.seed, BODY_TINTS.length)], s.seed, 10, wear * 0.6);
    type.body.setColorAt(i, this.col.multiplyScalar(lift));
    type.tail.setColorAt(i, paint(this.col, al.tail, s.seed, 20, wear).multiplyScalar(lift));
    type.stripe.setColorAt(i, paint(this.col, al.stripe, s.seed, 30, wear).multiplyScalar(lift));

    // landing gear folds up into the belly
    const gl = type.lights.gearPivot;
    const target = s.gear ? 1 : 0;
    let g = this.gearAnim.get(s.id) ?? target;
    g += (target - g) * Math.min(1, dt * 3.5);
    this.gearAnim.set(s.id, g);
    const gs = Math.max(0.0001, g);
    this.tmp.makeTranslation(gl[0], gl[1], gl[2]).multiply(this.mi.makeScale(gs, gs, gs)).multiply(this.mi.makeTranslation(-gl[0], -gl[1], -gl[2]));
    this.tmp.premultiply(this.m);
    type.gear.setMatrixAt(i, this.tmp);

    // propellers
    if (type.props && type.discs) {
      const spin = s.engines ? time * 55 + s.seed * 50 : s.seed * 6;
      type.lights.props.forEach((pp, k) => {
        this.tmp.copy(this.m).multiply(this.mi.makeTranslation(pp[0], pp[1], pp[2])).multiply(this.mi.makeRotationX(spin + k * 0.7));
        type.props!.setMatrixAt(i * 2 + k, this.tmp);
        this.tmp.copy(this.m).multiply(this.mi.makeTranslation(pp[0] + 0.01, pp[1], pp[2])).multiply(this.mi.makeScale(1, s.engines ? 1 : 0.0001, s.engines ? 1 : 0.0001));
        type.discs!.setMatrixAt(i * 2 + k, this.tmp);
      });
    }

    // lights
    const L = type.lights, sz = L.size, lt = s.lights;
    const ms = time * 1000 + s.seed * 1900;
    const strobeOn = lt.strobe && ((ms % 1500) < 70 || ((ms % 1500) > 170 && (ms % 1500) < 240));
    const beaconOn = lt.beacon && ((ms % 1000) < 420);
    const addLight = (pos: V3, size: number, color: Color, glowSize: number) => {
      if (this.nLights >= MAX_PLANES * 10) return;
      const k = this.nLights++;
      this.tmp.copy(this.m).multiply(this.mi.makeTranslation(pos[0], pos[1], pos[2]));
      this.p.setFromMatrixPosition(this.tmp);
      this.mi.makeScale(size * sz * sc, size * sz * sc, size * sz * sc).setPosition(this.p);
      this.lightBoxes.setMatrixAt(k, this.mi);
      this.col.copy(color);
      this.lightBoxes.setColorAt(k, this.col);
      const gsz = glowSize * sz * sc;
      this.mi.makeScale(gsz, gsz, gsz).setPosition(this.p);
      this.glow.setMatrixAt(k, this.mi);
      this.glow.setColorAt(k, this.col);
    };
    if (lt.nav) {
      addLight(L.navL, 0.04, RED, 0.05 + 0.03 * night);
      addLight(L.navR, 0.04, GREEN, 0.05 + 0.03 * night);
      addLight(L.navT, 0.04, WHITE, 0.045 + 0.03 * night);
    }
    if (beaconOn) addLight(L.beacon, 0.05, RED, 0.08 + 0.06 * night);
    if (strobeOn) for (const sp of L.strobes) addLight(sp, 0.05, WHITE, 0.13 + 0.1 * night);
    if (lt.landing) {
      addLight(L.landing, 0.06, WARM, 0.07 + 0.05 * night);
      if (this.nBeams < MAX_PLANES * 2) {
        this.tmp.copy(this.m).multiply(this.mi.makeTranslation(L.landing[0], L.landing[1], L.landing[2])).multiply(this.mi.makeScale(sz, sz, sz));
        this.beams.setMatrixAt(this.nBeams++, this.tmp);
      }
    }
  }
}
