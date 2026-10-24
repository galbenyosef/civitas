import { Group, Points, PointsMaterial, BufferGeometry, BufferAttribute, AdditiveBlending, CanvasTexture, DynamicDrawUsage, Color } from 'three';
import { hash2 } from '@msimcity/shared';

/**
 * Fireworks over a town that has just gone up a rank (client/src/ranks.ts, docs/ranks.md). No two shows and no two
 * shells alike (the organic-effects rule): each shell is seeded from the show and its index, and picks its own launch
 * delay, launch spot, apex height, colours (a palette pair with a hue jitter per spark), break shape (peony, willow,
 * ring, crackle), spark count, speed and lifetime; each spark then keeps its own speed, life and twinkle phase. A rocket
 * trail climbs to the break, the sparks fall under gravity and drag and fade, a willow's slower and longer. One Points
 * object per shell, additive, gone when its last spark is.
 */

/** Tiles (world units) above the ground a shell breaks at, at least and at most. */
const APEX_MIN = 9, APEX_MAX = 17;
const GRAVITY = 6;
/** gold, rose, teal, violet, white-blue, lime, amber, coral: a shell takes one, a two-tone shell two */
const PALETTE = [0xffd479, 0xff6f91, 0x5ee6c8, 0xb388ff, 0xcfe8ff, 0xc6ff6b, 0xffa94d, 0xff8a65];
type Shape = 'peony' | 'willow' | 'ring' | 'crackle';

interface Shell {
  points: Points; pos: Float32Array; col: Float32Array;
  /** seconds from the show's start to launch, climb time, and the launch spot and apex */
  at: number; climb: number; x0: number; z0: number; x: number; y: number; z: number;
  shape: Shape; n: number;
  vel: Float32Array; life: Float32Array; phase: Float32Array; base: Float32Array;
  drag: number; t: number; broke: boolean;
}

let sprite: CanvasTexture | null = null;
function spark() {
  if (sprite) return sprite;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return (sprite = new CanvasTexture(c));
}

export class Fireworks {
  readonly group = new Group();
  private shells: Shell[] = [];
  private shows = 0;
  /** called for every shell of a show as it is scheduled: (tile x, tile z, seconds from now until it launches, size); the sound (audio/) listens */
  onShell: ((x: number, z: number, at: number, size: number) => void) | null = null;

  constructor() { this.group.renderOrder = 30; }

  /** A show over tile (x, y): `size` 1 for a Hamlet up to 4 for a City, more shells over a wider spread for bigger ranks. */
  show(x: number, y: number, size = 1, seed = this.shows) {
    this.shows++;
    const s = seed * 7919 + 13;
    const count = 7 + Math.round(size * 3 + hash2(s, 1) * 4);
    const spread = 4 + size * 2.5;
    const span = 5 + size * 1.5; // seconds the show lasts
    for (let i = 0; i < count; i++) {
      const h = (k: number) => hash2(s + i * 31, k);
      // launches bunch a little (a pair, then a breath) rather than ticking at an even rate
      const at = Math.pow(h(2), 0.85) * span + (h(3) < 0.25 ? 0.12 : 0);
      const x0 = x + 0.5 + (h(4) - 0.5) * spread, z0 = y + 0.5 + (h(5) - 0.5) * spread;
      const apex = APEX_MIN + h(6) * (APEX_MAX - APEX_MIN) + size;
      const shape: Shape = h(7) < 0.42 ? 'peony' : h(7) < 0.64 ? 'willow' : h(7) < 0.82 ? 'ring' : 'crackle';
      const n = Math.round((shape === 'ring' ? 46 : shape === 'willow' ? 90 : 70) * (0.75 + h(8) * 0.6));
      this.onShell?.(x0, z0, at, size);
      this.shells.push(this.shell(h, at, x0, z0, x0 + (h(9) - 0.5) * 2, apex, z0 + (h(10) - 0.5) * 2, shape, n));
    }
  }

  private shell(h: (k: number) => number, at: number, x0: number, z0: number, x: number, y: number, z: number, shape: Shape, n: number): Shell {
    const geo = new BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    geo.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(col, 3).setUsage(DynamicDrawUsage));
    const mat = new PointsMaterial({
      size: shape === 'willow' ? 0.42 : 0.55 + h(11) * 0.2, map: spark(), vertexColors: true, transparent: true,
      blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    this.group.add(points);
    const vel = new Float32Array(n * 3), life = new Float32Array(n), phase = new Float32Array(n), base = new Float32Array(n * 3);
    const c1 = new Color(PALETTE[Math.floor(h(12) * PALETTE.length)]);
    const c2 = h(13) < 0.4 ? new Color(PALETTE[Math.floor(h(14) * PALETTE.length)]) : c1; // two-tone now and then
    const speed = (shape === 'willow' ? 4.2 : shape === 'ring' ? 6.5 : 6) * (0.8 + h(15) * 0.45);
    const lifeOf = shape === 'willow' ? 2.8 : shape === 'crackle' ? 1.5 : 1.9;
    // a ring breaks in a plane tilted its own way
    const tilt = h(16) * Math.PI, turn = h(17) * Math.PI * 2;
    const tmp = new Color();
    for (let i = 0; i < n; i++) {
      const r = (k: number) => hash2(i * 97 + Math.floor(h(18) * 1e6), k);
      let dx: number, dy: number, dz: number;
      if (shape === 'ring') {
        const a = (i / n) * Math.PI * 2 + r(1) * 0.05;
        const px = Math.cos(a), pz = Math.sin(a);
        dx = px * Math.cos(turn) - pz * Math.sin(turn) * Math.cos(tilt); dz = px * Math.sin(turn) + pz * Math.cos(turn) * Math.cos(tilt); dy = pz * Math.sin(tilt);
      } else {
        const u = r(1) * 2 - 1, a = r(2) * Math.PI * 2, q = Math.sqrt(1 - u * u);
        dx = q * Math.cos(a); dy = u; dz = q * Math.sin(a);
      }
      const sp = speed * (shape === 'ring' ? 0.95 + r(3) * 0.1 : 0.55 + r(3) * 0.5);
      vel[i * 3] = dx * sp; vel[i * 3 + 1] = dy * sp + 0.6; vel[i * 3 + 2] = dz * sp;
      life[i] = lifeOf * (0.7 + r(4) * 0.6);
      phase[i] = r(5) * Math.PI * 2;
      tmp.copy(r(6) < 0.5 ? c1 : c2).offsetHSL((r(7) - 0.5) * 0.06, 0, (r(8) - 0.5) * 0.12);
      base[i * 3] = tmp.r; base[i * 3 + 1] = tmp.g; base[i * 3 + 2] = tmp.b;
    }
    return { points, pos, col, at, climb: 0.9 + h(19) * 0.6, x0, z0, x, y, z, shape, n, vel, life, phase, base, drag: shape === 'willow' ? 1.6 : 0.9, t: -at, broke: false };
  }

  get active() { return this.shells.length > 0; }

  /** Once a frame. */
  frame(dt: number) {
    for (let k = this.shells.length - 1; k >= 0; k--) {
      const s = this.shells[k];
      s.t += dt;
      if (s.t < 0) continue;
      const pos = s.pos, col = s.col, n = s.n;
      s.points.visible = true;
      if (s.t < s.climb) {
        // the rocket: a short comet of the first sparks along its climb, warm white, eased to a stop at the apex
        const f = s.t / s.climb, e = 1 - (1 - f) * (1 - f);
        for (let i = 0; i < n; i++) {
          const back = Math.min(1, i / 10) * 0.12, g = Math.max(0, e - back);
          pos[i * 3] = s.x0 + (s.x - s.x0) * g; pos[i * 3 + 1] = s.y * g; pos[i * 3 + 2] = s.z0 + (s.z - s.z0) * g;
          const a = i < 10 ? (1 - i / 10) * 0.9 : 0;
          col[i * 3] = a; col[i * 3 + 1] = a * 0.85; col[i * 3 + 2] = a * 0.6;
        }
      } else {
        const t = s.t - s.climb;
        if (!s.broke) { s.broke = true; for (let i = 0; i < n; i++) { pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z; } }
        let alive = 0;
        const damp = Math.exp(-s.drag * dt);
        for (let i = 0; i < n; i++) {
          const v = i * 3;
          s.vel[v] *= damp; s.vel[v + 2] *= damp;
          s.vel[v + 1] = s.vel[v + 1] * damp - GRAVITY * (s.shape === 'willow' ? 0.55 : 1) * dt;
          pos[v] += s.vel[v] * dt; pos[v + 1] += s.vel[v + 1] * dt; pos[v + 2] += s.vel[v + 2] * dt;
          const f = t / s.life[i];
          let a = f >= 1 ? 0 : (1 - f) * (1 - f * 0.4) * Math.min(1, t * 12);
          if (s.shape === 'crackle' && f > 0.45) a *= (0.5 + 0.5 * Math.sin(t * 38 + s.phase[i])) > 0.2 ? 1.3 : 0.1; // the crackle: sparks flick on and off
          else a *= 0.85 + 0.15 * Math.sin(t * 9 + s.phase[i]);
          if (a > 0) alive++;
          col[v] = s.base[v] * a; col[v + 1] = s.base[v + 1] * a; col[v + 2] = s.base[v + 2] * a;
        }
        if (!alive && t > 0.5) { this.group.remove(s.points); s.points.geometry.dispose(); (s.points.material as PointsMaterial).dispose(); this.shells.splice(k, 1); continue; }
      }
      (s.points.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (s.points.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    }
  }
}
