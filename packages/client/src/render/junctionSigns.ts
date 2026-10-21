import { Group, Mesh, MeshLambertMaterial, Matrix4, Quaternion, Vector3, CylinderGeometry, BoxGeometry, Shape, ShapeGeometry, Color, type BufferGeometry } from 'three';
import {
  hash2, isRoad, isClassAux, isPedestrianAux, junctionGroup, carStepOk, inGroup, armState, Turn, type ArmState, type JunctionGroup, type RoadRule,
} from '@msimcity/shared';
import { Kit } from './kit';

/** DIRS order (E, W, S, N) as steps, and the opposite way */
const CD: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const OPP = [1, 0, 3, 2];
const RED = 0xc8262a, WHITE = 0xf2f2ee, BLACK = 0x17181a, POST = 0x8e939b;

/** What the signs read: the tiles and the road rule records (the client world). */
export interface SignsWorld {
  getTile(x: number, y: number): number | undefined;
  auxAt(x: number, y: number): number;
  roadRules: Map<string, RoadRule>;
}

/**
 * Turn-ban and no-entry signs (R4, shared/src/roadrules.ts): for each junction's road rule record, a small UK-style sign
 * on a post at the kerb of each signed arm. A turn ban stands on the right-hand kerb of the way in, facing the cars
 * coming in by that arm: a red ring on white with a black arrow (left, right or straight on) struck through by a red
 * bar, one plate per banned move. A no entry stands where the arm leaves the junction, facing the cars that would turn
 * into it: a red disc with a white bar, on both kerbs (now and then one of the pair is missing). Each sign its own
 * height, size, lean, turn and fading (organic rule).
 *
 * All the signs are one merged mesh (one draw call, none without signs), rebuilt when a rule changes or a chunk comes
 * or goes. The Turn rules tool's ghost: `preview` shows the sign the next click would put up, translucent.
 */
export class JunctionSigns {
  group = new Group();
  private mesh: Mesh | null = null;
  private ghost: Mesh | null = null;
  private ghostKey = '';
  private mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private ghostMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.55, depthWrite: false });

  constructor(private world: SignsWorld) { this.group.name = 'junction signs'; }

  /** Build every sign again (a rule changed, or a chunk with one came or went). */
  rebuild() {
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const k = new Kit();
    let any = false;
    for (const [key, r] of this.world.roadRules) {
      if (!r.ban && !r.noEntry) continue;
      const [x, y] = key.split(',').map(Number);
      const g = this.groupAt(x, y);
      if (!g) continue;
      for (let arm = 0; arm < 4; arm++) any = this.arm(k, g, arm, r, 1) || any;
    }
    if (!any) return;
    const m = new Mesh(k.build(), this.mat);
    m.castShadow = true; m.matrixAutoUpdate = false;
    this.mesh = m;
    this.group.add(m);
  }

  /**
   * The Turn rules tool's ghost: the sign the next click would put up on `arm` of junction group g (null: none; state
   * 'none' shows nothing, the click takes the sign down), translucent over whatever stands there now.
   */
  preview(g: JunctionGroup | null, arm: number, state: ArmState | null) {
    const key = g && state && state !== 'none' ? `${g.x},${g.y},${arm},${state}` : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    if (this.ghost) { this.group.remove(this.ghost); this.ghost.geometry.dispose(); this.ghost = null; }
    if (!g || !key) return;
    const k = new Kit();
    const r: RoadRule = state === 'noEntry' ? { noEntry: 1 << arm } : { ban: 1 << (arm * 3 + (state === 'noLeft' ? Turn.Left : state === 'noRight' ? Turn.Right : Turn.Straight)) };
    if (!this.arm(k, g, arm, r, 0)) return;
    this.ghost = new Mesh(k.build(), this.ghostMat);
    this.ghost.renderOrder = 3;
    this.group.add(this.ghost);
  }

  private road = (x: number, y: number) => { const t = this.world.getTile(x, y); return t !== undefined && isRoad(t); };
  private ca = (x: number, y: number) => { const a = this.world.auxAt(x, y); return isClassAux(a) ? a : 0; };
  /** the junction group anchored at (x, y) (its min corner) */
  private groupAt(x: number, y: number): JunctionGroup | null {
    const g = junctionGroup(this.road, this.ca, x, y);
    return g && g.x === x && g.y === y ? g : g ? { ...g, x, y, w: 1, h: 1 } : null;
  }

  /** The signs of one arm of group g under record r into k; `seeded` 0 for the ghost (no missing twin). True when any went up. */
  private arm(k: Kit, g: JunctionGroup, arm: number, r: RoadRule, seeded: number): boolean {
    const st = armState(r, arm);
    if (st === 'none') return false;
    const [ax, ay] = CD[arm];
    const bans = ((r.ban ?? 0) >> (arm * 3)) & 7, noEntry = ((r.noEntry ?? 0) >> arm) & 1;
    let any = false;
    for (let ty = g.y; ty < g.y + g.h; ty++) for (let tx = g.x; tx < g.x + g.w; tx++) {
      const nx = tx + ax, ny = ty + ay;
      if (inGroup(g, nx, ny) || !this.road(nx, ny) || isPedestrianAux(this.ca(nx, ny))) continue;
      const seed = (n: number) => hash2(nx * 31 + arm * 7 + n * 13, ny * 17 - n * 5);
      if (bans && carStepOk(this.ca(nx, ny), this.ca(tx, ty), OPP[arm])) {
        // the way in: cars head h = -arm; the sign on their right-hand kerb, just short of the junction, facing them
        const hx = -ax, hy = -ay, rx = -hy, ry = hx;
        const turns = [Turn.Left, Turn.Straight, Turn.Right].filter((t) => bans & (1 << t));
        this.sign(k, nx + 0.5 + hx * 0.34 + rx * 0.46, ny + 0.5 + hy * 0.34 + ry * 0.46, hx, hy, turns.map((t) => (t === Turn.Left ? 'L' : t === Turn.Right ? 'R' : 'S')), seed);
        any = true;
      }
      if (noEntry && carStepOk(this.ca(tx, ty), this.ca(nx, ny), arm)) {
        // the way out: a pair facing the junction, on both kerbs of the road leaving (heading arm)
        const rx = -ay, ry = ax;
        for (const sd of [1, -1]) {
          if (seeded && sd < 0 && seed(9) < 0.15) continue; // one of the pair knocked down and not put back
          this.sign(k, nx + 0.5 - ax * 0.36 + rx * 0.46 * sd, ny + 0.5 - ay * 0.36 + ry * 0.46 * sd, -ax, -ay, ['E'], (n) => seed(n + (sd > 0 ? 0 : 20)));
          any = true;
        }
      }
    }
    return any;
  }

  /**
   * One sign at (px, pz) facing cars heading (hx, hz): a post and its plates stacked (L, R, S: no left, right, straight
   * on; E: no entry), each sign its own size, height, lean, turn and fading.
   */
  private sign(k: Kit, px: number, pz: number, hx: number, hz: number, plates: string[], seed: (n: number) => number) {
    const R = 0.042 + 0.008 * seed(1), H = 0.17 + 0.03 * seed(2), fade = 0.86 + 0.16 * seed(3);
    const yaw = Math.atan2(-hx, -hz) + (seed(4) - 0.5) * 0.18;
    const lean = new Quaternion().setFromAxisAngle(new Vector3(Math.cos(seed(5) * 6.28), 0, Math.sin(seed(5) * 6.28)), (seed(6) - 0.5) * 0.06);
    const q = lean.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
    const m = new Matrix4().compose(new Vector3(px + (seed(7) - 0.5) * 0.04 * hx, 0.014, pz + (seed(7) - 0.5) * 0.04 * hz), q, new Vector3(1, 1, 1));
    const tone = (c: number) => new Color(c).multiplyScalar(fade).getHex();
    const put = (g: BufferGeometry, c: number) => k.part(g.applyMatrix4(m), tone(c));
    const top = H + (plates.length - 1) * (2 * R + 0.012);
    put(new CylinderGeometry(0.007, 0.008, top + 0.01, 5).translate(0, (top + 0.01) / 2, -0.008), POST);
    plates.forEach((p, i) => {
      const y = H + i * (2 * R + 0.012);
      const disc = (r: number, z: number, c: number) => put(new CylinderGeometry(r, r, 0.004, 18).rotateX(Math.PI / 2).translate(0, y, z), c);
      if (p === 'E') {
        // no entry: a red disc, a white bar across
        disc(R, 0, RED);
        put(new BoxGeometry(R * 1.3, R * 0.36, 0.004).translate(0, y, 0.003), WHITE);
        return;
      }
      disc(R, 0, RED); disc(R * 0.8, 0.002, WHITE);
      // the black arrow, a little below centre: a shaft up, then on, left or right (the viewer's left is the plate's -x)
      const s = R * 0.5, w = R * 0.16, z = 0.0045;
      const arrow = new Shape();
      if (p === 'S') {
        arrow.moveTo(-w / 2, -s); arrow.lineTo(w / 2, -s); arrow.lineTo(w / 2, s * 0.35); arrow.lineTo(w * 1.6, s * 0.35); arrow.lineTo(0, s); arrow.lineTo(-w * 1.6, s * 0.35); arrow.lineTo(-w / 2, s * 0.35);
      } else {
        // up the shaft, along the turn, a head pointing off to the side (mirrored for a left turn)
        const d = p === 'L' ? -1 : 1, X = (v: number) => v * d, b = s * 0.3, h0 = s * 0.42;
        arrow.moveTo(X(-w / 2), -s); arrow.lineTo(X(w / 2), -s); arrow.lineTo(X(w / 2), b - w / 2); arrow.lineTo(X(h0), b - w / 2); arrow.lineTo(X(h0), b - w * 1.7);
        arrow.lineTo(X(s * 0.95), b); arrow.lineTo(X(h0), b + w * 1.7); arrow.lineTo(X(h0), b + w / 2); arrow.lineTo(X(-w / 2), b + w / 2);
      }
      arrow.closePath();
      put(new ShapeGeometry(arrow).translate(0, y - R * 0.05, z), BLACK);
      // the red bar, top left to bottom right as you look at it
      put(new BoxGeometry(R * 1.62, R * 0.17, 0.004).rotateZ(-Math.PI / 4).translate(0, y, z + 0.001), RED);
    });
  }
}
