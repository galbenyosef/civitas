import { InstancedMesh, Matrix4, Quaternion, Vector3, Color, type Group } from 'three';
import { hash2 } from '@msimcity/shared';
import { Kit } from './kit';
import { vehicleMaterial } from './materials';

/**
 * Luggage for people moving in or leaving town through a gateway (server sim/gateways.ts, wire flag bit 14): a
 * wheeled suitcase trailing at a walker's right hand, and a roof box on a packed car. Each person's case and box
 * takes its own colour, size and tilt from a hash of their id, so a trainload walking out of a station is not a
 * row of identical bags. citizens.ts calls begin, walker / car per agent with the flag, then end.
 */
const CASE_COLOURS = [0x24324f, 0x8c2f2f, 0x1d1f24, 0x2f6f6a, 0xc79a2e, 0x6b4a8c, 0x9aa3ad, 0xb5523b].map((c) => new Color(c));
const BOX_COLOURS = [0x1d1f24, 0x2b2e36, 0xdfe3e8, 0x9aa3ad, 0x2f4f8f].map((c) => new Color(c));
const UP = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

function suitcase() {
  const k = new Kit();
  k.box(0.06, 0.085, 0.032, 0, 0.012, 0, 0xffffff)            // the case, standing on its wheels
    .box(0.062, 0.006, 0.034, 0, 0.05, 0, 0xd8d8d8)          // a strap round the middle
    .box(0.006, 0.08, 0.006, 0.026, 0.097, 0, 0x2a2a2a)      // the pulled-out handle
    .box(0.012, 0.006, 0.02, 0.026, 0.177, 0, 0x2a2a2a);
  k.wheel(0.008, 0.03, -0.022, 0.008, 0, 0x151515);
  return k.build();
}
function roofBox() {
  const k = new Kit();
  k.box(0.17, 0.035, 0.11, 0, 0.012, 0, 0xffffff)
    .box(0.13, 0.012, 0.09, 0, 0.047, 0, 0xffffff)
    .box(0.02, 0.012, 0.15, 0.05, 0, 0, 0x2a2a2a).box(0.02, 0.012, 0.15, -0.06, 0, 0, 0x2a2a2a); // roof bars
  return k.build();
}

export class Luggage {
  private cases: InstancedMesh;
  private boxes: InstancedMesh;
  private nc = 0; private nb = 0;
  private m = new Matrix4(); private q = new Quaternion(); private t = new Quaternion(); private p = new Vector3(); private s = new Vector3();
  private off = new Vector3();

  constructor(group: Group) {
    const mat = vehicleMaterial();
    this.cases = new InstancedMesh(suitcase(), mat, 1500);
    this.boxes = new InstancedMesh(roofBox(), mat, 600);
    for (const mesh of [this.cases, this.boxes]) { mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; group.add(mesh); }
  }

  begin() { this.nc = 0; this.nb = 0; }

  /** a suitcase at the right hand of a walker at (x, z) facing `yaw` (forward +x), sized to the figure */
  walker(x: number, z: number, yaw: number, height: number, id: number) {
    if (this.nc >= this.cases.instanceMatrix.count) return;
    const size = height * (0.85 + 0.35 * hash2(id, 401));
    this.q.setFromAxisAngle(UP, yaw);
    this.off.set(-0.05 - 0.02 * hash2(id, 402), 0, 0.075 * height).applyQuaternion(this.q); // trailing a little behind, on the right
    this.p.set(x, 0, z).add(this.off);
    this.t.setFromAxisAngle(Z, -(0.25 + 0.2 * hash2(id, 403))); // tipped onto its wheels, handle towards the hand
    this.s.set(size, size, size);
    this.m.compose(this.p, this.q.multiply(this.t), this.s);
    this.cases.setMatrixAt(this.nc, this.m);
    this.cases.setColorAt(this.nc, CASE_COLOURS[Math.floor(hash2(id, 404) * CASE_COLOURS.length)]);
    this.nc++;
  }

  /** a roof box on a sedan at (x, z) heading `ang` */
  car(x: number, z: number, ang: number, id: number) {
    if (this.nb >= this.boxes.instanceMatrix.count) return;
    this.q.setFromAxisAngle(UP, ang);
    this.off.set(-0.02, 0.21, 0).applyQuaternion(this.q);
    this.p.set(x, 0, z).add(this.off);
    const l = 0.9 + 0.25 * hash2(id, 405);
    this.s.set(l, 0.8 + 0.4 * hash2(id, 406), 1);
    this.m.compose(this.p, this.q, this.s);
    this.boxes.setMatrixAt(this.nb, this.m);
    this.boxes.setColorAt(this.nb, BOX_COLOURS[Math.floor(hash2(id, 407) * BOX_COLOURS.length)]);
    this.nb++;
  }

  end() {
    for (const [mesh, n] of [[this.cases, this.nc], [this.boxes, this.nb]] as [InstancedMesh, number][]) {
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
