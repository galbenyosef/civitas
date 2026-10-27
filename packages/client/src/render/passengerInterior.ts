import { hash2, HOUSE_ADS, AD_PALETTES, type PlaneType } from '@msimcity/shared';
import { Layers, rgb, roundRect, vgrad, MONO, SANS } from './vehicleInterior';
import type { Seat, PaxKind } from './passenger';

/**
 * What a passenger sees of the vehicle around them in the first-person view (render/fpv.ts, render/passenger.ts): a bus from a
 * seat a few rows back, a carriage from a window seat, a tube car from a seat looking across, a plane's cabin from its seat.
 *
 * The `Layers` pattern of render/vehicleInterior.ts: a back layer painted only when the viewport's size, the vehicle, the seat, how
 * full it is (in eighths) or the cabin's light changes, and a small front layer for what moves (the next-stop display, the door
 * lamps, the straps, the seat-belt sign, the route map, the wing's lights), redrawn only when its state changes, or every frame
 * while the straps swing. The bus, carriage and tube car are a box room projected with the camera's own field of view from the
 * eye's seat, so the walls, seats and windows sit where the world seen through the cut-out windows says they should; the plane's
 * cabin is drawn round its window, with the wing outside projected the same way. Everything is a pure function of the vehicle's
 * seed and the seat's (organic rule): moquette and its colour from the line's, adverts above the windows, scuffs, a dropped paper,
 * who sits near you (from the load), the neighbour's blind, the airline's trim.
 */

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NEAR = 0.004;
/** the first-person camera's vertical field of view (render/fpv.ts) */
const FOV = 70;

/** what the interior needs each frame (main.ts builds it, reused) */
export interface PassengerFeed {
  kind: PaxKind;
  seat: Seat;
  /** the vehicle's own seed (0..1) and the line's colour (a plane: the airline's tail colour), 0xrrggbb */
  vseed: number; colour: number;
  /** how full the car is, 0..1 (who sits near you), and the night, 0..1 */
  fill: number; night: number;
  /** the stop it calls at next, standing at a stop, the doors open, its speed in tiles a second */
  next: string; stopping: boolean; doors: boolean; speed: number;
  /** a plane: its type, phase, how far along the leg it is (0..1, -1: the screen is off), the leg's two ends, the belts sign, the cabin dimmed */
  plane: PlaneType; phase: string; flown: number; from: string; to: string; belts: boolean; dim: boolean;
}
export const passengerFeed = (): PassengerFeed => ({
  kind: 'bus', seat: { x: 0, y: 0, z: 0, yaw: 0, dip: 0, side: 1, car: 0, row: 0, letter: 0, window: true, wing: false, seed: 0 },
  vseed: 0, colour: 0x888888, fill: 0, night: 0, next: '', stopping: false, doors: false, speed: 0,
  plane: 'narrowbody', phase: '', flown: -1, from: '', to: '', belts: false, dim: false,
});

/** A pinhole projection from a seat (vehicle frame) onto the w x h viewport, with near-plane clipping. */
class Proj {
  w = 0; h = 0; F = 0;
  private ex = 0; private ey = 0; private ez = 0; private fx = 1; private fz = 0; private cd = 1; private sd = 0;
  /** the last point projected: screen x, y and depth */
  sx = 0; sy = 0; d = 0;
  private vx = new Float64Array(24); private vy = new Float64Array(24); private vz = new Float64Array(24);
  set(s: Seat, w: number, h: number) {
    this.w = w; this.h = h; this.F = h / 2 / Math.tan((FOV * Math.PI) / 360);
    this.ex = s.x; this.ey = s.y; this.ez = s.z;
    this.fx = Math.cos(s.yaw); this.fz = Math.sin(s.yaw); this.cd = Math.cos(s.dip); this.sd = Math.sin(s.dip);
  }
  private view(x: number, y: number, z: number, i: number) {
    const dx = x - this.ex, dy = y - this.ey, dz = z - this.ez;
    const f = dx * this.fx + dz * this.fz;
    this.vx[i] = -dx * this.fz + dz * this.fx; this.vy[i] = dy * this.cd + f * this.sd; this.vz[i] = f * this.cd - dy * this.sd;
  }
  /** project one point; false when it is behind the eye */
  pt(x: number, y: number, z: number): boolean {
    this.view(x, y, z, 23);
    const d = this.vz[23];
    if (d < NEAR) return false;
    this.sx = this.w / 2 + (this.vx[23] / d) * this.F; this.sy = this.h / 2 - (this.vy[23] / d) * this.F; this.d = d;
    return true;
  }
  /** a polygon (flat x,y,z list in the vehicle frame) as the context's current path, clipped at the near plane; false when nothing is left */
  path(c: CanvasRenderingContext2D, p: number[]): boolean {
    const n = p.length / 3;
    for (let i = 0; i < n; i++) this.view(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], i);
    c.beginPath();
    let m = 0;
    const put = (x: number, y: number, z: number) => {
      const sx = this.w / 2 + (x / z) * this.F, sy = this.h / 2 - (y / z) * this.F;
      if (m++) c.lineTo(sx, sy); else c.moveTo(sx, sy);
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = this.vz[i] >= NEAR, b = this.vz[j] >= NEAR;
      if (a) put(this.vx[i], this.vy[i], this.vz[i]);
      if (a !== b) {
        const t = (NEAR - this.vz[i]) / (this.vz[j] - this.vz[i]);
        put(this.vx[i] + (this.vx[j] - this.vx[i]) * t, this.vy[i] + (this.vy[j] - this.vy[i]) * t, NEAR);
      }
    }
    if (m < 3) return false;
    c.closePath();
    return true;
  }
}

/** quads in the vehicle frame: across (z) or along (x) at a fixed coordinate */
const qx = (x: number, y0: number, y1: number, z0: number, z1: number) => [x, y0, z0, x, y0, z1, x, y1, z1, x, y1, z0];
const qz = (z: number, x0: number, x1: number, y0: number, y1: number) => [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z];
const qy = (y: number, x0: number, x1: number, z0: number, z1: number) => [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];

/** hair and clothes of the people who sit near you */
const HAIR = [0x1c1410, 0x3b2a1e, 0x6b4a2b, 0xa7804f, 0xd8c08a, 0x8a8a8a, 0x2a2a2a, 0x5a2e1a];
const COATS = [0x2b3a55, 0x6d2e2e, 0x2f5a3c, 0x55504a, 0x1f1f24, 0x8a6a3a, 0x3c4f6b, 0x7a3f62, 0xb7b0a2];
const SKIN = [0xf1c9a5, 0xe0ac7e, 0xc68a5a, 0x8d5a3a, 0x5c3a24, 0xf5d6c0];

export class PassengerInterior {
  private L: Layers;
  private P = new Proj();
  /** the front layer's box and what it last showed */
  private bx = 0; private by = 0; private bw = 0; private bh = 0;
  private shown = new Float64Array(8); private shownNext = ''; private dirty = true;
  /** the straps' swing (tube): angle and its rate, driven by the change of speed */
  private sw = 0; private swv = 0; private lastSpeed = 0;

  constructor(parent: HTMLElement, before: Element | null) { this.L = new Layers(parent, before); }

  hide() { this.L.hide(); }

  update(f: PassengerFeed, now: number, dt: number, w: number, h: number, level: number) {
    if (w < 150 || h < 80) { this.hide(); return; }
    this.P.set(f.seat, w, h);
    this.frontBox(f, w, h);
    const s = f.seat;
    const k1 = Math.floor(f.vseed * 1e5) * 7 + Math.round(s.seed * 1e4) + Math.round(s.yaw * 100) * 131;
    const k2 = Math.round(clamp(f.fill, 0, 1) * 8) * 64 + (f.night > 0.5 ? 32 : 0) + (f.dim ? 16 : 0) + ['bus', 'rail', 'metro', 'plane'].indexOf(f.kind) * 4 + (s.window ? 2 : 0) + (s.wing ? 1 : 0);
    if (this.L.place(w, h, level, this.bx, this.by, this.bw, this.bh, k1, k2)) { this.paint(f, w, h); this.dirty = true; }
    // the straps swing back on a pull-away and forward on braking, then settle (each its own phase when drawn)
    if (dt > 0) {
      const acc = (f.speed - this.lastSpeed) / dt;
      this.swv += (-acc * 0.06 - this.sw * 9 - this.swv * 2.2) * dt;
      this.sw = clamp(this.sw + this.swv * dt, -0.5, 0.5);
    }
    this.lastSpeed = f.speed;
    this.front(f, now, w, h);
  }

  // ---- the back layer ---------------------------------------------------------------------------------

  private paint(f: PassengerFeed, w: number, h: number) {
    const c = this.L.b;
    c.clearRect(0, 0, w, h);
    c.save();
    if (f.kind === 'plane') this.cabin(c, f, w, h);
    else if (f.kind === 'bus') this.bus(c, f);
    else if (f.kind === 'rail') this.carriage(c, f);
    else this.tube(c, f);
    c.restore();
  }

  /** fill a polygon of the vehicle frame */
  private fill(c: CanvasRenderingContext2D, p: number[], style: string | CanvasGradient | CanvasPattern, edge?: string, lw = 1) {
    if (!this.P.path(c, p)) return;
    c.fillStyle = style; c.fill();
    if (edge) { c.strokeStyle = edge; c.lineWidth = lw; c.stroke(); }
  }
  /** punch a window through the layer, so the world drawn behind shows; a dark rubber seal round it */
  private cut(c: CanvasRenderingContext2D, p: number[], seal = 'rgba(20,22,26,0.95)') {
    if (!this.P.path(c, p)) return;
    c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fill(); c.restore();
    c.strokeStyle = seal; c.lineWidth = Math.max(2, this.P.h * 0.008); c.stroke();
  }
  /** a pane seen from inside that does not show the world (a far window, a door's glass): dark glass with the cabin's lights in it */
  private glass(c: CanvasRenderingContext2D, p: number[], night: number) {
    if (!this.P.path(c, p)) return;
    const P = this.P;
    c.fillStyle = night > 0.5 ? 'rgba(14,18,26,0.96)' : 'rgba(92,112,128,0.9)'; c.fill();
    c.save(); c.clip();
    c.fillStyle = night > 0.5 ? 'rgba(255,240,210,0.08)' : 'rgba(255,255,255,0.12)';
    c.fillRect(0, P.h * 0.2, P.w, P.h * 0.08);
    c.restore();
    c.strokeStyle = 'rgba(20,22,26,0.9)'; c.lineWidth = Math.max(2, P.h * 0.007); c.stroke();
  }
  /** a pole from (x, y0, z) to (x, y1, z), as thick as it is near */
  private pole(c: CanvasRenderingContext2D, x: number, y0: number, y1: number, z: number, col: string, r = 0.0045) {
    const P = this.P;
    if (!P.pt(x, y0, z)) return;
    const ax = P.sx, ay = P.sy, d0 = P.d;
    if (!P.pt(x, y1, z)) return;
    c.strokeStyle = col; c.lineCap = 'round'; c.lineWidth = Math.max(1.5, (r * 2 * P.F) / ((d0 + P.d) / 2));
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(P.sx, P.sy); c.stroke(); c.lineCap = 'butt';
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth *= 0.25;
    c.beginPath(); c.moveTo(ax - 1, ay); c.lineTo(P.sx - 1, P.sy); c.stroke();
  }
  /** a seated or standing person at (x, z), facing the eye: coat, shoulders, head with hair; `top` is the head's height */
  private person(c: CanvasRenderingContext2D, x: number, z: number, top: number, seed: number, night: number, phone: boolean, standing = false) {
    const P = this.P;
    if (!P.pt(x, top - 0.012, z)) return;
    const k = P.F / P.d, hx = P.sx, hy = P.sy;
    const coat = rgb(COATS[Math.floor(hash2(seed, 3) * COATS.length)], 0.85 + 0.3 * hash2(seed, 4));
    const sh = 0.03 * k, body = (standing ? 0.12 : 0.045) * k;
    c.fillStyle = coat;
    c.beginPath(); c.moveTo(hx - sh, hy + 0.034 * k + body); c.lineTo(hx - sh, hy + 0.03 * k); c.quadraticCurveTo(hx - sh, hy + 0.012 * k, hx, hy + 0.012 * k);
    c.quadraticCurveTo(hx + sh, hy + 0.012 * k, hx + sh, hy + 0.03 * k); c.lineTo(hx + sh, hy + 0.034 * k + body); c.closePath(); c.fill();
    const r = 0.0105 * k;
    c.fillStyle = rgb(SKIN[Math.floor(hash2(seed, 5) * SKIN.length)]);
    c.beginPath(); c.ellipse(hx, hy, r * 0.85, r, 0, 0, TAU); c.fill();
    c.fillStyle = rgb(HAIR[Math.floor(hash2(seed, 6) * HAIR.length)]);
    const long = hash2(seed, 7);
    c.beginPath(); c.ellipse(hx, hy - r * 0.35, r * 0.92, r * (long > 0.6 ? 0.95 : 0.7), 0, Math.PI, TAU); c.fill();
    if (long > 0.6) { c.fillRect(hx - r * 0.92, hy - r * 0.35, r * 0.3, r * 1.4); c.fillRect(hx + r * 0.62, hy - r * 0.35, r * 0.3, r * 1.4); }
    if (phone) {
      // looking down at a phone: its glow on the face, brighter after dark
      const px = hx + (hash2(seed, 8) - 0.5) * sh, py = hy + 0.024 * k;
      c.fillStyle = '#0b0d12'; roundRect(c, px - r * 0.45, py, r * 0.9, r * 1.3, r * 0.15); c.fill();
      c.fillStyle = night > 0.5 ? 'rgba(170,205,255,0.95)' : 'rgba(170,205,255,0.55)'; roundRect(c, px - r * 0.36, py + r * 0.1, r * 0.72, r * 1.05, r * 0.1); c.fill();
      if (night > 0.5) {
        const g = c.createRadialGradient(px, py, 0, px, py, r * 3.2);
        g.addColorStop(0, 'rgba(150,190,255,0.35)'); g.addColorStop(1, 'rgba(150,190,255,0)');
        c.fillStyle = g; c.fillRect(px - r * 3.2, py - r * 3.2, r * 6.4, r * 6.4);
      }
    }
  }
  /** moquette: a small repeating tile in the line's colour, its pattern and shade the vehicle's own */
  private moquette(c: CanvasRenderingContext2D, colour: number, seed: number, night: number): CanvasPattern | string {
    const t = document.createElement('canvas'), n = 24;
    t.width = t.height = n;
    const g = t.getContext('2d');
    if (!g) return rgb(colour, 0.5);
    const dim = night > 0.5 ? 0.8 : 1;
    g.fillStyle = rgb(0x1d2233, dim + 0.2 * hash2(seed, 21)); g.fillRect(0, 0, n, n);
    const kind = Math.floor(hash2(seed, 22) * 3), acc = AD_PALETTES[Math.floor(hash2(seed, 23) * AD_PALETTES.length)].accent;
    g.fillStyle = rgb(colour, 0.75 * dim);
    if (kind === 0) { for (let i = 0; i < 4; i++) g.fillRect((i * 7) % n, (i * 11) % n, 5, 3); g.fillStyle = acc; g.fillRect(3, 17, 3, 2); g.fillRect(15, 6, 2, 3); }
    else if (kind === 1) { g.beginPath(); g.arc(6, 6, 4, 0, TAU); g.arc(18, 18, 4, 0, TAU); g.fill(); g.fillStyle = acc; g.fillRect(17, 4, 3, 3); }
    else { for (let i = 0; i < n; i += 6) g.fillRect(i, 0, 2, n); g.fillStyle = acc; g.fillRect(0, 10, n, 2); }
    return c.createPattern(t, 'repeat') ?? rgb(colour, 0.5);
  }
  /** a row of advert cards along a wall (the cove over the windows): the town's house adverts in their palettes */
  private adverts(c: CanvasRenderingContext2D, z: number, x0: number, x1: number, y0: number, y1: number, seed: number, card = 0.075) {
    for (let x = x0, i = 0; x + card * 0.9 < x1; x += card, i++) {
      const pal = AD_PALETTES[Math.floor(hash2(seed * 977 + i, 31) * AD_PALETTES.length)];
      const p = qz(z, x + 0.002, x + card - 0.002, y0, y1);
      if (!this.P.path(c, p)) continue;
      c.fillStyle = pal.bg; c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.stroke();
      // the brand name (kept to its card), or a line of small print
      if (this.P.pt(x + card / 2, (y0 + y1) / 2, z)) {
        const fs = Math.min(40, ((y1 - y0) * 0.42 * this.P.F) / this.P.d);
        if (fs > 5) {
          c.save(); c.clip();
          c.fillStyle = pal.ink; c.font = `700 ${fs}px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(HOUSE_ADS[Math.floor(hash2(seed * 991 + i, 33) * HOUSE_ADS.length)], this.P.sx, this.P.sy);
          c.restore();
        } else { c.fillStyle = pal.accent; c.fillRect(this.P.sx - fs * 2, this.P.sy - 1, fs * 4, 2); }
      }
    }
  }

  /** a single-decker bus: forward-facing seats in pairs, side windows each side, the windscreen ahead beyond the driver's screen */
  private bus(c: CanvasRenderingContext2D, f: PassengerFeed) {
    const s = f.seat, vs = f.vseed, n = f.night;
    const Y0 = 0.072, Y1 = 0.216, W = 0.091, XB = -0.3, XF = 0.29, WY0 = 0.142, WY1 = 0.206;
    const lit = n > 0.5;
    const wall = lit ? '#cfcabb' : '#b9b6aa', ceil = lit ? '#f1ece0' : '#d9d6cc';
    this.fill(c, qy(Y1, XB, XF, -W, W), ceil);
    this.fill(c, qy(Y0, XB, XF, -W, W), lit ? '#4a4c52' : '#3c3f45');
    for (const z of [-W, W]) this.fill(c, qz(z, XB, XF, Y0, Y1), wall);
    this.fill(c, qx(XF, Y0, Y1, -W, W), '#2a2d33');
    // a yellow edge on the step at the middle doors, a dropped ticket
    this.fill(c, qy(Y0 + 0.0005, -0.02, 0.0, -W, -W + 0.06), '#e2b83a');
    if (hash2(vs, 41) < 0.6) { const px = 0.02 + 0.15 * hash2(vs, 42), pz = (hash2(vs, 43) - 0.5) * 0.02; this.fill(c, qy(Y0 + 0.001, px, px + 0.012, pz, pz + 0.008), 'rgba(235,232,220,0.9)'); }
    // windows: panes between pillars along both sides, and the windscreen
    const panes = [-0.255, -0.165, -0.075, 0.015, 0.105, 0.2];
    for (const z of [-W, W]) for (let i = 0; i + 1 < panes.length; i++) this.cut(c, qz(z, panes[i] + 0.006, panes[i + 1] - 0.006, WY0, WY1));
    this.cut(c, qx(XF - 0.001, 0.125, 0.205, -0.083, 0.083));
    // a sticker on a pane, the band of the line's colour under the windows
    if (hash2(vs, 44) < 0.7) { const px = panes[1 + Math.floor(hash2(vs, 45) * 3)] + 0.01, z = hash2(vs, 46) < 0.5 ? -W + 0.0005 : W - 0.0005; this.fill(c, qz(z, px, px + 0.014, WY0 + 0.004, WY0 + 0.016), AD_PALETTES[Math.floor(hash2(vs, 47) * AD_PALETTES.length)].bg); }
    for (const z of [-W + 0.0005, W - 0.0005]) this.fill(c, qz(z, XB, XF, WY0 - 0.012, WY0 - 0.004), rgb(f.colour, 0.85));
    this.adverts(c, -W + 0.0008, -0.26, 0.2, WY1 + 0.001, Y1 - 0.001, vs);
    this.adverts(c, W - 0.0008, -0.26, 0.2, WY1 + 0.001, Y1 - 0.001, vs + 0.5);
    // ceiling lights
    for (const z of [-0.035, 0.035]) this.fill(c, qy(Y1 - 0.0005, -0.27, 0.25, z - 0.006, z + 0.006), lit ? 'rgba(255,250,232,1)' : 'rgba(250,250,245,0.9)');
    // the driver's screen and cab on the left, the front destination box overhead
    this.fill(c, qx(0.21, Y0, 0.17, -W, -0.012), '#3a3f47', 'rgba(255,255,255,0.15)');
    this.fill(c, qx(0.209, 0.12, 0.168, -W + 0.004, -0.016), 'rgba(150,180,200,0.35)');
    this.fill(c, qx(XF - 0.004, 0.205, Y1, -0.06, 0.06), '#111317');
    // seats ahead, far rows first, and the people in them
    const moq = this.moquette(c, f.colour, vs, n);
    const rows: number[] = [];
    for (let x = s.x + 0.065; x < 0.19; x += 0.065) rows.push(x);
    for (let r = rows.length - 1; r >= 0; r--) {
      const X = rows[r];
      for (const side of [-1, 1]) {
        const z0 = side < 0 ? -0.087 : 0.013, z1 = side < 0 ? -0.013 : 0.087, zm = (z0 + z1) / 2;
        for (const half of [0, 1]) {
          const occ = hash2(Math.floor(vs * 1e4) + r * 7 + side * 3 + half, 51) < f.fill * 1.3 - 0.05;
          if (occ) this.person(c, X + 0.024, zm + (half ? 0.017 : -0.017), 0.195 + 0.012 * hash2(r * 5 + half, side + 60), Math.floor(vs * 1e4) + r * 13 + side * 5 + half, n, hash2(r * 3 + half, side + 70) < 0.35);
        }
        this.fill(c, qy(0.16, X - 0.012, X, z0, z1), rgb(0x2a2f3a, 1.2));
        this.fill(c, qx(X - 0.012, 0.1, 0.16, z0, z1), moq, 'rgba(0,0,0,0.4)', 1.5);
        this.fill(c, qx(X - 0.0125, 0.148, 0.16, zm - 0.03, zm + 0.03), rgb(f.colour, 0.7));
      }
    }
    // grab poles with their stop buttons, and the rails along the ceiling
    for (const [x, z] of [[0.19, 0.012], [0.19, -0.012], [-0.01, -0.012], [0.07, 0.012]] as const) {
      this.pole(c, x, Y0, Y1, z, '#e7b928');
      if (this.P.pt(x, 0.15, z)) { c.fillStyle = '#d23a2c'; c.beginPath(); c.arc(this.P.sx, this.P.sy, Math.max(1.5, (0.004 * this.P.F) / this.P.d), 0, TAU); c.fill(); }
    }
  }

  /** a carriage: a window seat in a bay, the seat back ahead (or a table and the seats facing), the luggage rack, the aisle and the far side */
  private carriage(c: CanvasRenderingContext2D, f: PassengerFeed) {
    const s = f.seat, vs = f.vseed, n = f.night, lit = n > 0.5;
    const Y0 = 0.06, YW = 0.2, Y1 = 0.24, W = 0.1, XB = -0.42, XF = 0.42, WY0 = 0.15, WY1 = 0.215;
    const fwd = Math.cos(s.yaw) >= 0 ? 1 : -1; // the way the seat faces along the carriage
    const near = s.side, far = -s.side;
    this.fill(c, qy(Y1, XB, XF, -0.06, 0.06), lit ? '#efe9dc' : '#dcd8ce');
    for (const z of [-1, 1]) this.fill(c, [XB, YW, z * W, XF, YW, z * W, XF, Y1, z * 0.06, XB, Y1, z * 0.06], lit ? '#e2dccd' : '#cfcbc0');
    this.fill(c, qy(Y0, XB, XF, -W, W), rgb(0x3b3a40, lit ? 1.1 : 1));
    for (const z of [-W, W]) this.fill(c, qz(z, XB, XF, Y0, YW), lit ? '#d6d0c2' : '#c4bfb3');
    for (const x of [XB, XF]) {
      this.fill(c, qx(x, Y0, Y1, -W, W), '#9a9488');
      this.fill(c, qx(x - Math.sign(x) * 0.001, Y0, 0.205, -0.03, 0.03), '#5d6066', 'rgba(0,0,0,0.4)', 1.5); // the gangway door
      this.glass(c, qx(x - Math.sign(x) * 0.002, 0.14, 0.195, -0.02, 0.02), n);
    }
    // the near side's window by the seat shows the world; the others are glass seen across the carriage
    const panes = [[-0.415, -0.245], [-0.135, 0.135], [0.245, 0.415]];
    for (const [a, b] of panes) {
      if (a === -0.135) this.cut(c, qz(near * (W - 0.001), a, b, WY0, WY1));
      else this.glass(c, qz(near * (W - 0.001), a, b, WY0, WY1), n);
      this.glass(c, qz(far * (W - 0.001), a, b, WY0, WY1), n);
    }
    this.adverts(c, far * (W - 0.002), -0.4, 0.4, WY1 + 0.004, YW - 0.003, vs, 0.1);
    // luggage racks over both rows of windows, the lights along the ceiling
    for (const z of [-1, 1]) {
      this.fill(c, qy(0.222, XB, XF, z * W, z * (W - 0.035)), 'rgba(170,175,182,0.85)', 'rgba(60,62,68,0.6)', 1.5);
      if (hash2(vs, 80 + z) < 0.7) { const bx = (hash2(vs, 82 + z) - 0.5) * 0.5; this.fill(c, [bx, 0.222, z * (W - 0.003), bx + 0.05, 0.222, z * (W - 0.003), bx + 0.05, 0.236, z * (W - 0.01), bx, 0.236, z * (W - 0.01)], rgb(COATS[Math.floor(hash2(vs, 84 + z) * COATS.length)])); }
    }
    this.fill(c, qy(Y1 - 0.0005, XB + 0.02, XF - 0.02, -0.008, 0.008), lit ? '#fffbea' : '#f5f4ef');
    // the seats: a bay of four with a table when the hash says so, else airline-style rows, all facing the way the seat does
    const moq = this.moquette(c, f.colour, vs, n);
    const table = hash2(Math.floor(vs * 1e4) + s.car, 85) < 0.45;
    const seatAt = (X: number, z0: number, z1: number, faces: number, occ: boolean, k: number) => {
      const back = X - faces * 0.012, zm = (z0 + z1) / 2;
      // facing away: the person is beyond their seat back (only the head shows over it); facing the eye: in front of it
      const pers = () => { if (occ) this.person(c, X + faces * 0.026, zm, 0.21, Math.floor(vs * 1e4) + k, n, hash2(k, 90) < 0.3); };
      if (faces === fwd) pers();
      this.fill(c, qy(0.175, Math.min(back, X), Math.max(back, X), z0, z1), rgb(0x2a2f3a, 1.2));
      this.fill(c, qx(faces === fwd ? back : X, 0.1, 0.175, z0, z1), moq, 'rgba(0,0,0,0.4)', 1.5);
      this.fill(c, qx((faces === fwd ? back : X) - fwd * 0.0005, 0.16, 0.175, zm - 0.02, zm + 0.02), 'rgba(240,240,236,0.9)');
      if (faces !== fwd) pers();
    };
    const half = (z: number) => (z < 0 ? [-W + 0.004, -0.014] : [0.014, W - 0.004]);
    const occ = (k: number) => hash2(Math.floor(vs * 1e4) + k, 87) < f.fill * 1.3 - 0.05;
    const rows: [number, number][] = []; // [x, faces]
    if (table) { rows.push([s.x + fwd * 0.19, fwd], [s.x + fwd * 0.12, -fwd]); }
    else for (let k = 1; k <= 3; k++) rows.push([s.x + fwd * 0.075 * k, fwd]);
    for (let i = rows.length - 1; i >= 0; i--) {
      const [X, faces] = rows[i];
      for (const z of [far, near]) { const [z0, z1] = half(z * 0.05); seatAt(X, z0, z1, faces, occ(i * 5 + z * 2 + 9), i * 17 + z * 3); }
    }
    if (table) {
      const z0 = near < 0 ? -W + 0.002 : 0.02, z1 = near < 0 ? -0.02 : W - 0.002;
      this.fill(c, qy(0.13, s.x + fwd * 0.03, s.x + fwd * 0.1, z0, z1), '#c9c2b2', 'rgba(0,0,0,0.35)', 1.5);
      if (hash2(vs, 88) < 0.5 && this.P.pt(s.x + fwd * 0.06, 0.131, (z0 + z1) / 2 + 0.01)) { c.fillStyle = '#f4f1ea'; c.beginPath(); c.ellipse(this.P.sx, this.P.sy, (0.009 * this.P.F) / this.P.d, (0.004 * this.P.F) / this.P.d, 0, 0, TAU); c.fill(); } // a paper cup
    }
    // a grab handle on the seat backs along the aisle
    this.pole(c, s.x + fwd * 0.075, 0.175, 0.18, 0.014 * near, '#9aa0a8', 0.002);
  }

  /** a tube car from a seat on one side: the seats across with the people in them, the far window, doors, poles, the cove of adverts */
  private tube(c: CanvasRenderingContext2D, f: PassengerFeed) {
    const s = f.seat, vs = f.vseed, n = f.night;
    const Y0 = 0.052, YW = 0.172, Y1 = 0.214, W = 0.09, XB = -0.42, XF = 0.42, WY0 = 0.122, WY1 = 0.178;
    const far = -s.side;
    this.fill(c, qy(Y1, XB, XF, -0.05, 0.05), '#e9e8e3');
    for (const z of [-1, 1]) this.fill(c, [XB, YW, z * W, XF, YW, z * W, XF, Y1, z * 0.05, XB, Y1, z * 0.05], '#dedcd4');
    this.fill(c, qy(Y0, XB, XF, -W, W), '#55534f');
    for (const z of [-W, W]) this.fill(c, qz(z, XB, XF, Y0, YW), '#d3d1c9');
    for (const x of [XB, XF]) { this.fill(c, qx(x, Y0, Y1, -W, W), '#c7c5bd'); this.fill(c, qx(x - Math.sign(x) * 0.001, Y0, 0.19, -0.035, 0.035), '#7a7d84', 'rgba(0,0,0,0.35)', 1.5); }
    // the far wall: the window across from the seat shows the tunnel; the others and the doors' glass are seen as glass
    const own = s.x < 0 ? -1 : 1;
    const wins: [number, number][] = [[-0.415, -0.345], [-0.235, -0.055], [0.055, 0.235], [0.345, 0.415]];
    for (const [a, b] of wins) {
      if (a === (own < 0 ? -0.235 : 0.055)) this.cut(c, qz(far * (W - 0.001), a, b, WY0, WY1));
      else this.glass(c, qz(far * (W - 0.001), a, b, WY0, WY1), 1);
    }
    for (const dx of [-0.29, 0, 0.29]) {
      this.fill(c, qz(far * (W - 0.0015), dx - 0.045, dx + 0.045, Y0, 0.19), rgb(f.colour, 0.95), 'rgba(0,0,0,0.4)', 1.5);
      this.glass(c, qz(far * (W - 0.002), dx - 0.035, dx - 0.004, 0.115, 0.182), 1);
      this.glass(c, qz(far * (W - 0.002), dx + 0.004, dx + 0.035, 0.115, 0.182), 1);
      this.fill(c, qy(Y0 + 0.0005, dx - 0.045, dx + 0.045, far * (W - 0.012), far * W), '#e2b83a'); // the step's yellow edge
    }
    // the cove over the far windows: adverts, and the line map over the middle door
    this.adverts(c, far * (W - 0.0025), -0.415, -0.05, YW + 0.002, 0.2, vs, 0.06);
    this.adverts(c, far * (W - 0.0025), 0.05, 0.415, YW + 0.002, 0.2, vs + 0.37, 0.06);
    this.fill(c, qz(far * (W - 0.0025), -0.045, 0.045, YW + 0.003, 0.199), '#f7f6f1', rgb(f.colour), 1.5);
    if (this.P.path(c, qz(far * (W - 0.003), -0.04, 0.04, 0.184, 0.187))) { c.fillStyle = rgb(f.colour); c.fill(); }
    // seats along the far wall between the doors, in the line's moquette, with the people across from you
    const moq = this.moquette(c, f.colour, vs, n);
    const zs = far * (W - 0.036), zw = far * W;
    const peopleAt: number[] = [];
    for (const [a, b] of [[-0.42, -0.335], [-0.245, -0.045], [0.045, 0.245], [0.335, 0.42]]) {
      this.fill(c, qz(zw - far * 0.001, a, b, 0.09, 0.13), moq, 'rgba(0,0,0,0.35)', 1.5);
      this.fill(c, qy(0.09, a, b, zs, zw), moq, 'rgba(0,0,0,0.35)', 1.5);
      this.fill(c, qz(zs, a, b, Y0, 0.09), '#3a3c42');
      for (let x = a + 0.0225; x < b - 0.01; x += 0.045) {
        this.pole(c, x + 0.0225, 0.09, 0.105, zw - far * 0.03, '#8d9097', 0.002);
        if (hash2(Math.floor(vs * 1e4) + Math.round(x * 1000), 91) < f.fill * 1.4) peopleAt.push(x);
      }
    }
    for (const x of peopleAt) this.person(c, x, zw - far * 0.03, 0.172 + 0.01 * hash2(Math.round(x * 1000), 92), Math.floor(vs * 1e4) + Math.round(x * 1000), n, hash2(Math.round(x * 997), 93) < 0.4);
    // standing at the doors when it is full
    if (f.fill > 0.55) for (const dx of [-0.29, 0, 0.29]) {
      const k = Math.round(dx * 100) + 50;
      if (hash2(Math.floor(vs * 1e4) + k, 94) < (f.fill - 0.5) * 2) this.person(c, dx + (hash2(k, 95) - 0.5) * 0.05, far * 0.03, 0.2, Math.floor(vs * 1e4) + k * 3, n, hash2(k, 96) < 0.5, true);
    }
    // the yellow poles by the doors and the rails the straps hang from
    for (const dx of [-0.29, 0, 0.29]) for (const e of [-0.06, 0.06]) this.pole(c, dx + e, Y0, Y1, far * 0.05, '#e7b928');
    for (const z of [-0.045, 0.045]) if (this.P.path(c, [XB, 0.2, z - 0.002, XF, 0.2, z - 0.002, XF, 0.2, z + 0.002, XB, 0.2, z + 0.002])) { c.strokeStyle = '#c8ccd2'; c.lineWidth = 3; c.stroke(); }
    this.fill(c, qy(Y1 - 0.0005, XB + 0.02, XF - 0.02, -0.012, 0.012), '#fdfcf4');
    // scuffs on the floor, a free paper on the seat across
    for (let i = 0; i < 4; i++) { const px = (hash2(vs * 1e3 + i, 97) - 0.5) * 0.7, pz = (hash2(vs * 1e3 + i, 98) - 0.5) * 0.12; this.fill(c, qy(Y0 + 0.0005, px, px + 0.03, pz, pz + 0.006), 'rgba(30,30,30,0.18)'); }
    if (hash2(vs, 99) < 0.5) { const px = -0.2 + 0.4 * hash2(vs, 100); this.fill(c, qy(0.0905, px, px + 0.018, zs + far * 0.006, zs + far * 0.02), 'rgba(236,233,224,0.95)'); }
  }

  /** a plane's cabin round the window (mirrored for a seat on the left), the wing outside projected from the seat, the seat back ahead */
  private cabin(c: CanvasRenderingContext2D, f: PassengerFeed, w: number, h: number) {
    const s = f.seat, dim = f.dim;
    this.tip = null;
    // the wing first: it is outside the window, so it is drawn in the opening once the opening is cut
    const wall = dim ? ['#2b3346', '#1b2130'] : ['#e9e4d8', '#c9c3b6'];
    c.fillStyle = vgrad(c, 0, h, wall[0], wall[1]); c.fillRect(0, 0, w, h);
    if (s.side < 0) { c.translate(w, 0); c.scale(-1, 1); }
    const win = this.window(w, h, s.window);
    // the neighbour's window ahead, its blind where they left it
    const nb = hash2(s.seed * 1e4, 7);
    const nw = { x: win.x - win.w * 1.55, y: win.y + win.h * 0.06, w: win.w * 0.62, h: win.h * 0.82 };
    roundRect(c, nw.x - nw.w * 0.18, nw.y - nw.h * 0.1, nw.w * 1.36, nw.h * 1.2, nw.w * 0.5); c.fillStyle = dim ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'; c.fill();
    roundRect(c, nw.x, nw.y, nw.w, nw.h, nw.w * 0.42);
    c.save(); c.globalCompositeOperation = 'destination-out'; c.fill(); c.restore();
    c.save(); roundRect(c, nw.x, nw.y, nw.w, nw.h, nw.w * 0.42); c.clip();
    c.fillStyle = dim ? '#4a4f5a' : '#e8e4da'; c.fillRect(nw.x, nw.y, nw.w, nw.h * nb);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(nw.x, nw.y + nw.h * nb - 2, nw.w, 3);
    c.restore();
    // our window: the reveal, the opening, the blind pushed up
    roundRect(c, win.x - win.w * 0.2, win.y - win.h * 0.12, win.w * 1.4, win.h * 1.24, win.w * 0.55);
    c.fillStyle = dim ? '#353d52' : '#f4f1ea'; c.fill();
    c.strokeStyle = dim ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)'; c.lineWidth = Math.max(1, h * 0.004); c.stroke();
    roundRect(c, win.x, win.y, win.w, win.h, win.w * 0.42);
    c.save(); c.globalCompositeOperation = 'destination-out'; c.fill(); c.restore();
    c.lineWidth = Math.max(2, h * 0.012); c.strokeStyle = dim ? '#20263a' : '#d4cfc4'; c.stroke();
    c.save(); roundRect(c, win.x, win.y, win.w, win.h, win.w * 0.42); c.clip();
    if (s.wing) this.wing(c, f);
    c.fillStyle = dim ? '#3d4456' : '#eeeae0'; c.fillRect(win.x, win.y - 2, win.w, win.h * 0.07);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(win.x + win.w * 0.4, win.y + win.h * 0.07 - 2, win.w * 0.2, 4);
    c.restore();
    // the neighbour by the window when the seat is not a window seat
    if (!s.window) {
      const cx = win.x + win.w * 0.35, cy = win.y + win.h * 1.05, k = h * 0.32;
      c.fillStyle = rgb(COATS[Math.floor(hash2(s.seed * 1e4, 9) * COATS.length)], dim ? 0.5 : 0.85);
      c.beginPath(); c.ellipse(cx, cy + k * 0.5, k * 0.55, k * 0.5, 0, Math.PI, TAU); c.fill();
      c.fillStyle = rgb(HAIR[Math.floor(hash2(s.seed * 1e4, 10) * HAIR.length)], dim ? 0.5 : 1);
      c.beginPath(); c.ellipse(cx + k * 0.05, cy - k * 0.12, k * 0.2, k * 0.24, 0, 0, TAU); c.fill();
    }
    // the locker overhead with the service panel under it (reading lights, the vents; the signs are on the front layer)
    const ly = h * 0.16;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(w, 0); c.lineTo(w, ly * 0.7); c.quadraticCurveTo(w * 0.5, ly * 1.35, 0, ly); c.closePath();
    c.fillStyle = vgrad(c, 0, ly * 1.3, dim ? '#232a3a' : '#f3f0e8', dim ? '#161b27' : '#cfcac0'); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = Math.max(1, h * 0.003); c.stroke();
    const py = ly * 1.1;
    c.fillStyle = dim ? '#1a2030' : '#dcd7cc'; c.fillRect(w * 0.02, py, w * 0.36, h * 0.05);
    for (let i = 0; i < 3; i++) { c.fillStyle = '#9ca3ad'; c.beginPath(); c.arc(w * (0.05 + i * 0.045), py + h * 0.025, h * 0.011, 0, TAU); c.fill(); }
    if (dim) { c.fillStyle = 'rgba(90,120,220,0.5)'; c.fillRect(0, ly * 0.95, w, h * 0.008); } // mood lighting along the bins
    // the seat back ahead, on the side towards the nose, in the airline's colours, with its screen (front layer) and tray latch
    const sx = w * 0.02, sw = w * 0.3, sy = h * 0.42;
    c.beginPath(); c.moveTo(sx - w * 0.05, h); c.lineTo(sx - w * 0.03, sy + h * 0.05); c.quadraticCurveTo(sx, sy - h * 0.04, sx + sw * 0.55, sy - h * 0.035);
    c.quadraticCurveTo(sx + sw, sy - h * 0.03, sx + sw * 1.02, sy + h * 0.08); c.lineTo(sx + sw * 0.95, h); c.closePath();
    c.fillStyle = vgrad(c, sy, h, rgb(0x2b3140, dim ? 0.6 : 1), rgb(0x161a23, dim ? 0.6 : 1)); c.fill();
    c.fillStyle = rgb(f.colour, dim ? 0.55 : 0.95);
    c.beginPath(); c.moveTo(sx + sw * 0.08, sy - h * 0.01); c.quadraticCurveTo(sx + sw * 0.5, sy - h * 0.06, sx + sw * 0.92, sy); c.lineTo(sx + sw * 0.9, sy + h * 0.07); c.quadraticCurveTo(sx + sw * 0.5, sy + h * 0.03, sx + sw * 0.1, sy + h * 0.06); c.closePath(); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(c, sx + sw * 0.42, sy + h * 0.37, sw * 0.16, h * 0.02, h * 0.008); c.fill();
    c.fillStyle = '#05070a'; roundRect(c, sx + sw * 0.18, sy + h * 0.1, sw * 0.62, h * 0.22, h * 0.015); c.fill();
    // the front layer's parts in viewport pixels (it is not mirrored, so its words read the right way round)
    const real = (r: { x: number; y: number; w: number; h: number }) => (s.side < 0 ? { x: w - r.x - r.w, y: r.y, w: r.w, h: r.h } : r);
    this.screen = real({ x: sx + sw * 0.2, y: sy + h * 0.11, w: sw * 0.58, h: h * 0.2 });
    this.sign = real({ x: w * 0.19, y: py + h * 0.005, w: w * 0.17, h: h * 0.04 });
    this.win = real(win);
    const tip = this.tip as [number, number, number] | null; // (set by wing())
    if (tip && s.side < 0) tip[0] = w - tip[0];
  }
  private screen = { x: 0, y: 0, w: 0, h: 0 }; private sign = { x: 0, y: 0, w: 0, h: 0 }; private win = { x: 0, y: 0, w: 0, h: 0 };
  /** where our window opens on the view: near and large at a window seat, smaller beyond a neighbour */
  private window(w: number, h: number, by: boolean) {
    const ww = h * (by ? 0.44 : 0.3), wh = ww * 1.42;
    return { x: w * (by ? 0.58 : 0.62) - ww / 2, y: h * (by ? 0.55 : 0.53) - wh / 2, w: ww, h: wh };
  }
  /** the wing as render/planes.ts builds it, projected from the seat, with its flap and the light at the tip (front layer) */
  private wing(c: CanvasRenderingContext2D, f: PassengerFeed) {
    const W = WING[f.plane], z = f.seat.side;
    // in the plane's frame relative to the gear, the same as the seat's
    const [y, le, ch, lt, ct, zr, zt, dih] = W;
    const root = [le, y + 0.02, z * zr], rootT = [le - ch, y + 0.02, z * zr], tipT = [lt - ct, y + dih + 0.02, z * zt], tip = [lt, y + dih + 0.02, z * zt];
    const mir = (p: number[]) => [p[0], p[1], z < 0 ? -p[2] : p[2]];
    // the projection is of the seat's own side; the layer is mirrored for a left seat, so project the right-hand twin
    const P = this.P, seat = f.seat;
    const yaw0 = seat.yaw, z0 = seat.z;
    if (z < 0) { seat.yaw = -yaw0; seat.z = -z0; P.set(seat, P.w, P.h); }
    const pts = [...mir(root), ...mir(rootT), ...mir(tipT), ...mir(tip)];
    if (this.P.path(c, pts)) {
      const dark = f.night > 0.5;
      c.fillStyle = vgrad(c, 0, P.h, dark ? '#3a3f48' : f.dim ? '#7d8592' : '#e4e8ec', dark ? '#24282f' : f.dim ? '#5a616c' : '#a9b0b8'); c.fill();
      c.strokeStyle = 'rgba(40,44,52,0.6)'; c.lineWidth = 1.5; c.stroke();
      // the leading edge catches the light; a walkway line and a panel seam run out along the top
      const lead = [...mir(root), ...mir(tip), tip[0] - 0.03, tip[1], z < 0 ? -tip[2] : tip[2], root[0] - 0.06, root[1], z < 0 ? -root[2] : root[2]];
      if (this.P.path(c, lead)) { c.fillStyle = f.dim ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.45)'; c.fill(); }
      const m0 = mir([(root[0] + rootT[0]) / 2, root[1] + 0.001, root[2]]), m1 = mir([(tip[0] + tipT[0]) / 2, tip[1] + 0.001, tip[2]]);
      if (this.P.pt(m0[0], m0[1], m0[2])) { const ax = this.P.sx, ay = this.P.sy; if (this.P.pt(m1[0], m1[1], m1[2])) { c.strokeStyle = 'rgba(60,64,72,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(ax, ay); c.lineTo(this.P.sx, this.P.sy); c.stroke(); } }
    }
    // the flap along the trailing edge, let down for take-off and landing
    const flaps = f.phase === 'takeoff' || f.phase === 'rotate' || f.phase === 'approach' || f.phase === 'flare' || f.phase === 'rollout' ? 1 : f.phase === 'climb' ? 0.4 : 0;
    const fl = 0.07 * (0.5 + flaps), droop = 0.03 * flaps;
    const a = 0.12, b = 0.62;
    const lerp = (p: number[], q: number[], t: number) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const t0 = mir(lerp(rootT, tipT, a)), t1 = mir(lerp(rootT, tipT, b));
    if (this.P.path(c, [...t0, ...t1, t1[0] - fl, t1[1] - droop, t1[2], t0[0] - fl, t0[1] - droop, t0[2]])) { c.fillStyle = f.dim ? '#4c525e' : '#c3c9d0'; c.fill(); c.strokeStyle = 'rgba(30,34,40,0.7)'; c.lineWidth = 1.2; c.stroke(); }
    const tp = mir(tip);
    this.tip = this.P.pt(tp[0] - 0.02, tp[1], tp[2]) ? [this.P.sx, this.P.sy, this.P.F / this.P.d] : null;
    if (z < 0) { seat.yaw = yaw0; seat.z = z0; P.set(seat, P.w, P.h); }
  }
  private tip: [number, number, number] | null = null;

  // ---- the front layer ---------------------------------------------------------------------------------

  /** where the moving parts are, in viewport pixels (the front layer's box) */
  private frontBox(f: PassengerFeed, w: number, h: number) {
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    const P = this.P;
    const take = (x: number, y: number, z: number) => { if (P.pt(x, y, z)) { x0 = Math.min(x0, P.sx); x1 = Math.max(x1, P.sx); y0 = Math.min(y0, P.sy); y1 = Math.max(y1, P.sy); } };
    const s = f.seat;
    if (f.kind === 'bus') { for (const z of [-0.05, 0.05]) for (const y of [0.188, 0.215]) take(0.284, y, z); }
    else if (f.kind === 'rail') { const x = Math.cos(s.yaw) >= 0 ? 0.418 : -0.418; for (const z of [-0.05, 0.05]) for (const y of [0.198, 0.236]) take(x, y, z); }
    else if (f.kind === 'metro') {
      const far = -s.side * 0.09;
      for (const x of [-0.42, 0.42]) for (const y of [0.15, 0.214]) { take(x, y, far); take(x, y, -s.side * 0.03); }
    } else { x0 = 0; y0 = 0; x1 = w; y1 = h * 0.75; }
    if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = 2; y1 = 2; }
    const m = h * 0.02;
    this.bx = clamp(x0 - m, 0, w - 2); this.by = clamp(y0 - m, 0, h - 2);
    this.bw = clamp(x1 + m, this.bx + 2, w) - this.bx; this.bh = clamp(y1 + m, this.by + 2, h) - this.by;
  }

  /** redraw the moving parts when they changed (or every frame while the straps swing) */
  private front(f: PassengerFeed, now: number, w: number, h: number) {
    const blink = Math.floor(now / 500) % 2, strobe = Math.floor(now / 1000 + f.vseed) % 2;
    const st = this.shown;
    const v0 = f.doors ? 1 + blink : 0, v1 = f.stopping ? 1 : 0, v2 = f.kind === 'plane' ? (f.belts ? 1 : 0) + strobe * 2 : 0, v3 = Math.round(f.flown * 200);
    const v4 = f.kind === 'metro' ? Math.round(this.sw * 400) + Math.floor(now / 90) : 0, v5 = f.dim ? 1 : 0, v6 = f.night > 0.5 ? 1 : 0;
    if (!this.dirty && st[0] === v0 && st[1] === v1 && st[2] === v2 && st[3] === v3 && st[4] === v4 && st[5] === v5 && st[6] === v6 && this.shownNext === f.next) return;
    st[0] = v0; st[1] = v1; st[2] = v2; st[3] = v3; st[4] = v4; st[5] = v5; st[6] = v6; this.shownNext = f.next; this.dirty = false;
    const c = this.L.f;
    c.clearRect(this.bx, this.by, this.bw, this.bh);
    c.save();
    c.beginPath(); c.rect(this.bx, this.by, this.bw, this.bh); c.clip();
    if (f.kind === 'plane') this.planeFront(c, f, w, h, strobe === 1);
    else this.display(c, f, now, blink === 1);
    c.restore();
  }

  /** the next-stop display (amber dots on black), the stopping sign, the door lamps and the straps */
  private display(c: CanvasRenderingContext2D, f: PassengerFeed, now: number, blink: boolean) {
    const P = this.P, s = f.seat;
    let pts: number[];
    if (f.kind === 'bus') pts = qx(0.285, 0.19, 0.212, -0.048, 0.048);
    else if (f.kind === 'rail') { const x = Math.cos(s.yaw) >= 0 ? 0.417 : -0.417; pts = qx(x, 0.2, 0.222, -0.045, 0.045); }
    else pts = qz(-s.side * 0.0875, -0.045, 0.045, 0.2, 0.211);
    if (P.path(c, pts)) {
      c.fillStyle = '#07080a'; c.fill(); c.strokeStyle = '#3b3f47'; c.lineWidth = 1.5; c.stroke();
      const [x, y, z] = [(pts[0] + pts[6]) / 2, (pts[1] + pts[7]) / 2, (pts[2] + pts[8]) / 2];
      if (P.pt(x, y, z)) {
        const fs = clamp((0.0085 * P.F) / P.d, 6, 28);
        const label = f.stopping && f.kind === 'bus' ? 'BUS STOPPING' : f.doors ? (f.next ? `${f.next}` : 'Doors open') : f.next ? `Next: ${f.next}` : '';
        c.font = `700 ${fs}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = f.stopping && f.kind === 'bus' ? '#ff5340' : '#ffb347';
        c.save(); c.clip();
        c.fillText(label.length > 26 ? `${label.slice(0, 25)}…` : label, P.sx, P.sy);
        c.restore();
      }
    }
    // door lamps: off while running, amber and flashing with the doors open
    const lamps: number[][] = f.kind === 'metro' ? [[-0.29, 0.193, -s.side * 0.088], [0, 0.193, -s.side * 0.088], [0.29, 0.193, -s.side * 0.088]]
      : f.kind === 'rail' ? [[Math.cos(s.yaw) >= 0 ? 0.417 : -0.417, 0.228, 0.035]] : [[0.285, 0.2, 0.055]];
    for (const [x, y, z] of lamps) {
      if (!P.pt(x, y, z)) continue;
      const r = clamp((0.0035 * P.F) / P.d, 1.5, 12), on = f.doors && blink;
      c.fillStyle = on ? '#ffb347' : f.kind === 'bus' && f.stopping ? '#ff5340' : '#3a2e1c';
      c.beginPath(); c.arc(P.sx, P.sy, r, 0, TAU); c.fill();
      if (on || (f.kind === 'bus' && f.stopping)) { c.shadowColor = c.fillStyle as string; c.shadowBlur = r * 3; c.fill(); c.shadowBlur = 0; }
    }
    // the straps along the far rail, each swinging on its own phase
    if (f.kind === 'metro') {
      const z = -s.side * 0.045, t = now / 1000;
      for (let x = -0.4, i = 0; x < 0.41; x += 0.055, i++) {
        if (!P.pt(x, 0.2, z)) continue;
        const ax = P.sx, ay = P.sy, k = P.F / P.d;
        const ph = hash2(Math.floor(f.vseed * 1e4) + i, 101) * TAU;
        const a = this.sw * (0.8 + 0.4 * hash2(i, 102)) + 0.06 * Math.sin(t * 1.9 + ph) * Math.min(1, f.speed);
        const len = 0.026 * k, ex = ax + Math.sin(a) * len, ey = ay + Math.cos(a) * len;
        c.strokeStyle = '#d9dbe0'; c.lineWidth = Math.max(1, 0.0025 * k); c.beginPath(); c.moveTo(ax, ay); c.lineTo(ex, ey); c.stroke();
        c.strokeStyle = '#f1f1ee'; c.lineWidth = Math.max(1.5, 0.003 * k); c.beginPath(); c.ellipse(ex, ey + 0.005 * k, 0.006 * k, 0.0055 * k, a, 0, TAU); c.stroke();
      }
    }
  }

  /** the seat-belt sign, the screen's route map and the wing tip's lights */
  private planeFront(c: CanvasRenderingContext2D, f: PassengerFeed, w: number, h: number, strobe: boolean) {
    void w; void h;
    // the seat-belt and no-smoking signs: lit amber by phase, the cabin's light behind them
    const sg = this.sign;
    for (let i = 0; i < 2; i++) {
      const x = sg.x + i * sg.w * 0.55, on = i === 0 ? f.belts : true;
      roundRect(c, x, sg.y, sg.w * 0.42, sg.h, sg.h * 0.25); c.fillStyle = on ? '#ffcf6b' : f.dim ? '#2a3040' : '#cfc9bd'; c.fill();
      c.fillStyle = on ? '#3b2a0a' : 'rgba(0,0,0,0.25)'; c.font = `700 ${Math.max(6, sg.h * 0.55)}px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(i === 0 ? 'FASTEN' : 'NO ⌀', x + sg.w * 0.21, sg.y + sg.h * 0.52);
    }
    // the screen: the leg's two ends and the plane between them; dark while the plane taxis or stands
    const sc = this.screen;
    c.fillStyle = '#05070a'; c.fillRect(sc.x, sc.y, sc.w, sc.h);
    if (f.flown >= 0) {
      const g = c.createLinearGradient(sc.x, sc.y, sc.x, sc.y + sc.h);
      g.addColorStop(0, '#0d2a4a'); g.addColorStop(1, '#123a2a');
      c.fillStyle = g; c.fillRect(sc.x + 2, sc.y + 2, sc.w - 4, sc.h - 4);
      const ax = sc.x + sc.w * 0.15, ay = sc.y + sc.h * 0.7, bx = sc.x + sc.w * 0.85, by = sc.y + sc.h * 0.35;
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.setLineDash([4, 3]); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2, sc.y + sc.h * 0.18, bx, by); c.stroke(); c.setLineDash([]);
      const t = clamp(f.flown, 0, 1), mx = (ax + bx) / 2, my = sc.y + sc.h * 0.18;
      const px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx, py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
      c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(px, py, Math.max(2.5, sc.h * 0.05), 0, TAU); c.fill();
      c.fillStyle = '#fff'; c.font = `600 ${Math.max(6, sc.h * 0.09)}px ${SANS}`; c.textBaseline = 'middle';
      c.textAlign = 'left'; c.fillText(f.from, ax - sc.w * 0.1, ay + sc.h * 0.14);
      c.textAlign = 'right'; c.fillText(f.to, bx + sc.w * 0.1, by - sc.h * 0.12);
      for (const [x, y] of [[ax, ay], [bx, by]]) { c.beginPath(); c.arc(x, y, Math.max(1.5, sc.h * 0.025), 0, TAU); c.fill(); }
    }
    // the wing tip's navigation light (green on the right, red on the left) and its white strobe, inside the window
    if (f.seat.wing && this.tip) {
      const [x, y, k] = this.tip, wn = this.win;
      if (x > wn.x && x < wn.x + wn.w && y > wn.y && y < wn.y + wn.h) {
        const r = clamp(0.012 * k, 1.5, 9);
        c.fillStyle = f.seat.side > 0 ? '#52ff7a' : '#ff4a3d';
        c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        c.shadowColor = c.fillStyle as string; c.shadowBlur = r * 4; c.fill(); c.shadowBlur = 0;
        if (strobe) { const g = c.createRadialGradient(x, y, 0, x, y, r * 6); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x - r * 6, y - r * 6, r * 12, r * 12); }
      }
    }
  }
}

/** each type's wing half as render/planes.ts builds it: height, root leading edge x and chord, tip leading edge x and chord, root and tip span, the tip's rise */
const WING: Record<PlaneType, [number, number, number, number, number, number, number, number]> = {
  turboprop: [0.38, 0.55, 0.55, 0.5, 0.3, 0.1, 1.05, 0],
  regional: [0.13, 0.42, 0.5, -0.06, 0.16, 0.09, 0.95, 0.05],
  narrowbody: [0.2, 0.75, 0.65, 0.15, 0.2, 0.12, 1.3, 0.06],
  widebody: [0.28, 0.95, 0.95, -0.18, 0.24, 0.18, 1.59, 0.12],
  jumbo: [0.3, 1.0, 1.0, -0.3, 0.22, 0.2, 1.59, 0.12],
  bizjet: [0.11, 0.35, 0.37, -0.05, 0.1, 0.05, 0.6, 0.03],
};
