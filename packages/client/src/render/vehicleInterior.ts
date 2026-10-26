import { hash2 } from '@msimcity/shared';

/**
 * What you see of the vehicle you are riding in, drawn over the first-person view (render/fpv.ts): a car, van, truck or
 * bus seen through its windscreen, or a train driver's cab. Siblings of the aircraft panel in render/instruments.ts.
 *
 * Each interior is two stacked canvases: a back layer with the body (pillars, roof, mirror, bonnet, dash), painted once
 * whenever the size or the vehicle changes, and a small front layer redrawn every frame with the parts that move (the
 * speedometer needle, the steering wheel, the indicator lamps, the brake handle). Everything about how a vehicle looks
 * is a pure function of its id, so the same car always has the same dash.
 */

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rgb = (n: number, f = 1) => `rgb(${Math.min(255, ((n >> 16) & 255) * f) | 0},${Math.min(255, ((n >> 8) & 255) * f) | 0},${Math.min(255, (n & 255) * f) | 0})`;
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** one tile is about 13 m (a car is 0.34 tiles); the game's own tile-per-second speeds read in km/h through this */
export const KMH_PER_TPS = 3.6 * 13 * 0.5;

/** dash tones and the trim that goes with them, picked per vehicle */
const DASH = [0x24262b, 0x353029, 0x1f2733, 0x2f2c36, 0x2b3a33, 0x40382f];
const TRIM = [0xc8a14a, 0x9aa4ad, 0xc0392b, 0x2e86de, 0x4caf7a, 0xd9752b];
const GLOW = ['#ffffff', '#ffd9a0', '#9fd8ff', '#9dffb8', '#ffb0a0'];
const STICKERS = [0xe1b12c, 0x2e86de, 0xc0392b, 0x4caf7a, 0xffffff];

/** The two canvases an interior draws on, sized to the FPV viewport. */
class Layers {
  readonly back = document.createElement('canvas');
  readonly front = document.createElement('canvas');
  readonly b: CanvasRenderingContext2D;
  readonly f: CanvasRenderingContext2D;
  private shown = false;
  /** the numbers the layers were last sized and painted for: w, h, dpr, front box, and the caller's two keys */
  private tag = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  private tagOn = false;
  private opacity = -1;

  constructor(parent: HTMLElement, before: Element | null) {
    for (const c of [this.back, this.front]) { c.className = 'fint'; c.style.display = 'none'; parent.insertBefore(c, before); }
    this.b = this.back.getContext('2d')!;
    this.f = this.front.getContext('2d')!;
  }

  get on() { return this.shown; }

  hide() {
    if (!this.shown) return;
    this.shown = false; this.tagOn = false;
    this.back.style.display = 'none'; this.front.style.display = 'none';
  }

  /**
   * Size both layers for a w x h viewport and keep the front layer to the rectangle (fx, fy, fw, fh) that the moving parts
   * live in. Returns true when the back layer was just cleared and needs painting. Drawing on both layers uses viewport
   * coordinates; `level` is the fade.
   */
  place(w: number, h: number, level: number, fx: number, fy: number, fw: number, fh: number, k1: number, k2: number): boolean {
    if (!this.shown) { this.shown = true; this.back.style.display = 'block'; this.front.style.display = 'block'; }
    const op = Math.round(level * 50) / 50;
    if (op !== this.opacity) { this.opacity = op; this.back.style.opacity = this.front.style.opacity = String(op); }
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w * h * dpr * dpr > 4.5e6) dpr = Math.sqrt(4.5e6 / (w * h));
    const t = this.tag;
    fx = Math.round(fx); fy = Math.round(fy); fw = Math.round(fw); fh = Math.round(fh);
    if (this.tagOn && t[0] === w && t[1] === h && t[2] === dpr && t[3] === fx && t[4] === fy && t[5] === fw && t[6] === fh && t[7] === k1 && t[8] === k2) return false;
    t[0] = w; t[1] = h; t[2] = dpr; t[3] = fx; t[4] = fy; t[5] = fw; t[6] = fh; t[7] = k1; t[8] = k2; this.tagOn = true;
    this.back.style.cssText = `display:block;opacity:${op};left:0;top:0;width:${w}px;height:${h}px`;
    this.back.width = Math.round(w * dpr); this.back.height = Math.round(h * dpr);
    this.b.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.front.style.cssText = `display:block;opacity:${op};left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px`;
    this.front.width = Math.round(fw * dpr); this.front.height = Math.round(fh * dpr);
    this.f.setTransform(dpr, 0, 0, dpr, -fx * dpr, -fy * dpr);
    return true;
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.roundRect(x, y, w, h, r);
}

function vgrad(c: CanvasRenderingContext2D, y0: number, y1: number, a: string, b: string) {
  const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g;
}

/** A round gauge face with a ring of ticks over `sweep` radians from `start`; the caller draws the needle. */
function dialFace(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, max: number, majorEvery: number, minorEvery: number, glow: string, labels: boolean) {
  c.beginPath(); c.arc(cx, cy, r, 0, TAU);
  c.fillStyle = '#090b0e'; c.fill();
  c.lineWidth = Math.max(1.5, r * 0.07); c.strokeStyle = '#3b3f47'; c.stroke();
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
  c.strokeStyle = glow; c.fillStyle = glow; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `600 ${Math.max(6, r * 0.2)}px ${MONO}`;
  for (let v = 0; v <= max + 1e-6; v += minorEvery) {
    const a = a0 + (v / max) * sweep, major = Math.abs(v / majorEvery - Math.round(v / majorEvery)) < 1e-6;
    const ca = Math.cos(a), sa = Math.sin(a), r1 = r * 0.9, r0 = r * (major ? 0.74 : 0.82);
    c.lineWidth = Math.max(1, r * (major ? 0.045 : 0.025));
    c.beginPath(); c.moveTo(cx + ca * r0, cy + sa * r0); c.lineTo(cx + ca * r1, cy + sa * r1); c.stroke();
    if (major && labels) c.fillText(String(Math.round(v)), cx + ca * r * 0.58, cy + sa * r * 0.58);
  }
}

function needle(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, frac: number, color: string) {
  const a = Math.PI * 0.75 + clamp(frac, 0, 1) * Math.PI * 1.5, ca = Math.cos(a), sa = Math.sin(a);
  c.lineCap = 'round'; c.strokeStyle = color; c.lineWidth = Math.max(1.5, r * 0.06);
  c.beginPath(); c.moveTo(cx - ca * r * 0.14, cy - sa * r * 0.14); c.lineTo(cx + ca * r * 0.86, cy + sa * r * 0.86); c.stroke();
  c.beginPath(); c.arc(cx, cy, Math.max(2, r * 0.1), 0, TAU); c.fillStyle = '#20232a'; c.fill();
  c.lineCap = 'butt';
}

// ---- cars, vans, trucks and buses --------------------------------------------------------------------------

/** What the car interior needs from the first-person view each frame. */
export interface CarFeed {
  id: number;
  /** the eye's height above the road, in tiles (sedan 0.16, van and truck 0.22, bus 0.27) */
  height: number;
  /** tiles per second along the road */
  speedTps: number;
  /** the view's turn rate, radians per second, positive to the left */
  yawRate: number;
  /** body colour 0xrrggbb when known */
  color?: number;
  /** the lamps lit right now: -1 left, 1 right, 2 both (hazards), 0 none; the caller supplies the blink */
  indicator: number;
}

/** A windscreen view from inside a vehicle, with a dash, a steering wheel and a working speedometer. */
export class CarInterior {
  private L: Layers;
  private kmh = 0; private yaw = 0; private wheel = 0; private ready = false;
  private big = false; private bus = false;
  private id = 0;

  constructor(parent: HTMLElement, before: Element | null) { this.L = new Layers(parent, before); }

  hide() { if (this.L.on) { this.L.hide(); this.ready = false; } }

  update(f: CarFeed, now: number, dt: number, w: number, h: number, level: number) {
    if (w < 150 || h < 80) { this.hide(); return; }
    if (f.id !== this.id) { this.id = f.id; this.ready = false; }
    const bus = f.height >= 0.25, big = f.height >= 0.2;
    this.big = big; this.bus = bus;
    // the wheel and the gauge live in a box low in the middle of the view
    const R = h * (bus ? 0.37 : big ? 0.33 : 0.31), hubY = h * 1.03;
    const fw = Math.min(w, R * 2.3), fx = (w - fw) / 2, fy = h * (bus ? 0.6 : 0.64);
    const col = f.color ?? 0x888888;
    if (this.L.place(w, h, level, fx, fy, fw, h - fy, f.id * 4 + (bus ? 2 : big ? 1 : 0), col)) this.paint(f.id, col, w, h, big, bus);

    if (!this.ready) { this.kmh = f.speedTps * KMH_PER_TPS; this.yaw = f.yawRate; this.ready = true; }
    else if (dt > 0) {
      this.kmh += (f.speedTps * KMH_PER_TPS - this.kmh) * (1 - Math.exp(-dt / 0.25));
      this.yaw += (f.yawRate - this.yaw) * (1 - Math.exp(-dt / 0.2));
    }
    // turning left turns the wheel counter-clockwise as the driver sees it; a bigger wheel needs a little more lock
    const target = clamp(-this.yaw * (bus ? 1.5 : 1.15), -2.1, 2.1);
    this.wheel += (target - this.wheel) * (dt > 0 ? 1 - Math.exp(-dt / 0.12) : 0);
    this.draw(f, now, w, h, R, hubY);
  }

  /** the back layer: roof, pillars, mirror, bonnet and dash */
  private paint(id: number, body: number, w: number, h: number, big: boolean, bus: boolean) {
    const c = this.L.b;
    const r1 = hash2(id, 71), r2 = hash2(id, 72), r3 = hash2(id, 73), r4 = hash2(id, 74);
    const dash = DASH[Math.floor(r1 * DASH.length)], trim = TRIM[Math.floor(r2 * TRIM.length)];
    c.clearRect(0, 0, w, h);

    // bonnet: the car's own colour, rising to a crown ahead of the dash (buses and trucks sit over the engine, so none)
    const dashY = h * (bus ? 0.8 : big ? 0.78 : 0.76);
    if (!bus) {
      const crown = h * (big ? 0.68 : 0.585), side = h * (big ? 0.77 : 0.73);
      c.beginPath();
      c.moveTo(w * 0.03, dashY + h * 0.02);
      c.quadraticCurveTo(w * 0.5, crown - (side - crown) * 0.0, w * 0.97, dashY + h * 0.02);
      c.lineTo(w * 0.97, h); c.lineTo(w * 0.03, h); c.closePath();
      c.fillStyle = vgrad(c, crown, dashY + h * 0.05, rgb(body, 0.95), rgb(body, 0.55)); c.fill();
      c.beginPath(); c.moveTo(w * 0.03, dashY + h * 0.02); c.quadraticCurveTo(w * 0.5, crown, w * 0.97, dashY + h * 0.02);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = Math.max(1, h * 0.004); c.stroke();
    }

    // roof lining, deeper at the sides, with a sun visor band on the big cabs
    const roofC = h * (big ? 0.05 : 0.07), roofS = h * (big ? 0.1 : 0.16);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(w, 0);
    for (let i = 12; i >= 0; i--) { const x = (w * i) / 12, t = (i / 6 - 1); c.lineTo(x, roofC + (roofS - roofC) * t * t); }
    c.closePath(); c.fillStyle = vgrad(c, 0, roofS, '#0f1012', '#2a2c31'); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = Math.max(1, h * 0.003); c.stroke();
    if (big) {
      c.fillStyle = vgrad(c, 0, h * 0.14, 'rgba(20,40,30,0.0)', 'rgba(20,40,30,0.45)');
      c.fillRect(w * 0.1, roofC, w * 0.8, h * 0.07);
    }

    // A-pillars; the side windows beyond them are mostly pillar and door at this angle
    const pTop = w * (big ? 0.12 : 0.15), pBot = w * (big ? 0.065 : 0.07), pY = dashY - h * 0.06;
    for (const s of [0, 1]) {
      c.save();
      if (s) { c.translate(w, 0); c.scale(-1, 1); }
      c.beginPath(); c.moveTo(0, 0); c.lineTo(pTop, 0); c.lineTo(pTop, roofC * 0.7); c.lineTo(pBot, pY); c.lineTo(pBot, dashY + h * 0.05); c.lineTo(0, dashY + h * 0.05); c.closePath();
      const g = c.createLinearGradient(0, 0, pTop, 0); g.addColorStop(0, '#0c0d0f'); g.addColorStop(1, '#25272c'); c.fillStyle = g; c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = Math.max(1.2, h * 0.005);
      c.beginPath(); c.moveTo(pTop, roofC * 0.7); c.lineTo(pBot, pY); c.stroke();
      // door mirror: a small dark wedge just outside the glass, low on the pillar
      if (!bus) { c.beginPath(); c.moveTo(pBot, pY - h * 0.2); c.lineTo(pBot + w * 0.035, pY - h * 0.15); c.lineTo(pBot, pY - h * 0.1); c.closePath(); c.fillStyle = '#17181b'; c.fill(); }
      c.restore();
    }
    if (bus) { c.fillStyle = '#16181b'; c.fillRect(w * 0.5 - w * 0.0025, roofC, w * 0.005, dashY - h * 0.1 - roofC); } // the split screen

    // rear-view mirror on a short stalk from the roof
    const mw = w * (bus ? 0.2 : 0.16), mh = h * (bus ? 0.085 : 0.07), mx = w * 0.5 - mw / 2, my = roofC + h * 0.035;
    c.fillStyle = '#16171a'; c.fillRect(w * 0.5 - w * 0.006, roofC * 0.8, w * 0.012, my - roofC * 0.8 + 2);
    roundRect(c, mx, my, mw, mh, mh * 0.3); c.fillStyle = '#1a1b1e'; c.fill();
    roundRect(c, mx + mw * 0.03, my + mh * 0.1, mw * 0.94, mh * 0.8, mh * 0.22);
    const mg = vgrad(c, my, my + mh, '#a9c0d6', '#56626d'); c.fillStyle = mg; c.fill();
    c.save(); roundRect(c, mx + mw * 0.03, my + mh * 0.1, mw * 0.94, mh * 0.8, mh * 0.22); c.clip();
    c.fillStyle = 'rgba(70,82,70,0.55)'; c.fillRect(mx, my + mh * 0.55, mw, mh);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.moveTo(mx + mw * 0.1, my); c.lineTo(mx + mw * 0.3, my); c.lineTo(mx + mw * 0.15, my + mh); c.lineTo(mx, my + mh); c.fill();
    c.restore();

    // a little life on the windscreen: an air freshener on the mirror, a permit sticker low in the corner
    if (r3 < 0.42) {
      const fx = w * 0.5 + mw * 0.32, fy = my + mh, len = h * (0.05 + 0.03 * r4);
      c.strokeStyle = 'rgba(220,220,220,0.7)'; c.lineWidth = Math.max(1, h * 0.003);
      c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx, fy + len); c.stroke();
      const sz = h * 0.032, tone = r4 < 0.5 ? 0x3d9a55 : r4 < 0.75 ? 0xe05a9d : 0x3aa0e6;
      c.fillStyle = rgb(tone);
      if (r4 < 0.5) { c.beginPath(); c.moveTo(fx, fy + len); c.lineTo(fx - sz * 0.7, fy + len + sz * 1.7); c.lineTo(fx + sz * 0.7, fy + len + sz * 1.7); c.closePath(); c.fill(); }
      else { c.beginPath(); c.arc(fx, fy + len + sz * 0.8, sz * 0.8, 0, TAU); c.fill(); }
    }
    if (r4 > 0.62 && !bus) {
      const sx = pBot + w * 0.025, sy = pY - h * 0.12, sz = h * 0.05;
      roundRect(c, sx, sy, sz, sz * 0.8, sz * 0.15); c.fillStyle = rgb(STICKERS[Math.floor(r3 * STICKERS.length)], 0.9); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(sx + sz * 0.18, sy + sz * 0.2, sz * 0.64, sz * 0.12);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(sx + sz * 0.18, sy + sz * 0.45, sz * 0.4, sz * 0.1);
    }

    // dash: a low panel with a hump over the instruments in the middle, a trim stripe and a pair of vents
    const hump = dashY - h * (bus ? 0.015 : 0.045);
    c.beginPath(); c.moveTo(0, dashY + h * 0.03); c.lineTo(w * 0.14, dashY + h * 0.012);
    c.bezierCurveTo(w * 0.27, dashY, w * 0.31, hump, w * 0.38, hump);
    c.lineTo(w * 0.62, hump);
    c.bezierCurveTo(w * 0.69, hump, w * 0.73, dashY, w * 0.86, dashY + h * 0.012); c.lineTo(w, dashY + h * 0.03); c.lineTo(w, h); c.lineTo(0, h); c.closePath();
    c.fillStyle = vgrad(c, hump, h, rgb(dash, 1.35), rgb(dash, 0.55)); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = Math.max(1, h * 0.004); c.stroke();
    c.strokeStyle = rgb(trim, 0.9); c.lineWidth = Math.max(1.5, h * 0.006);
    c.beginPath(); c.moveTo(0, dashY + h * 0.085); c.lineTo(w * 0.3, dashY + h * 0.07); c.moveTo(w * 0.7, dashY + h * 0.07); c.lineTo(w, dashY + h * 0.085); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.55)';
    for (const vx of [0.1, 0.84]) for (let k = 0; k < 3; k++) { roundRect(c, w * vx, dashY + h * (0.045 + k * 0.022), w * 0.06, h * 0.012, h * 0.006); c.fill(); }
    // the dial hood
    roundRect(c, w * 0.5 - h * 0.15, hump - h * 0.005, h * 0.3, h * 0.2, h * 0.07); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
  }

  private draw(f: CarFeed, now: number, w: number, h: number, R: number, hubY: number) {
    const c = this.L.f, cx = w / 2, bus = this.bus, big = this.big;
    const r1 = hash2(f.id, 71), r2 = hash2(f.id, 72), r5 = hash2(f.id, 75);
    const trim = TRIM[Math.floor(r2 * TRIM.length)], glow = GLOW[Math.floor(r5 * GLOW.length)];
    const fy0 = h * (bus ? 0.6 : 0.64);
    c.clearRect(cx - R * 1.15, fy0 - 2, R * 2.3, h - fy0 + 4);

    // speedometer in the middle of the dash, a little jitter on the needle at speed
    const gr = h * 0.098, gy = h * (bus ? 0.855 : 0.835);
    const max = bus ? 100 : 200, kmh = clamp(this.kmh, 0, max); // a motorway runs a car at 130 to 165 (KMH_PER_TPS)
    const jit = Math.sin(now * 0.013 + r1 * 9) * 0.0035 * Math.min(1, kmh / 30);
    dialFace(c, cx, gy, gr, max, bus ? 20 : 40, bus ? 10 : 20, glow, h > 330);
    needle(c, cx, gy, gr, kmh / max + jit, '#ff6a3d');
    c.fillStyle = glow; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 ${Math.max(7, gr * 0.32)}px ${MONO}`; c.fillText(String(Math.round(kmh)), cx, gy + gr * 0.5);
    c.font = `500 ${Math.max(5, gr * 0.17)}px ${MONO}`; c.globalAlpha = 0.65; c.fillText('km/h', cx, gy + gr * 0.74); c.globalAlpha = 1;

    // indicator lamps either side of the dial; the feed says which are lit this instant, in step with the lamps outside
    for (const s of [-1, 1]) {
      const on = f.indicator === s || f.indicator === 2;
      const ax = cx + s * gr * 1.55, ay = gy - gr * 0.55, sz = gr * 0.2;
      c.beginPath(); c.moveTo(ax + s * sz, ay); c.lineTo(ax - s * sz * 0.5, ay - sz * 0.9); c.lineTo(ax - s * sz * 0.5, ay + sz * 0.9); c.closePath();
      c.fillStyle = on ? '#58ff7a' : 'rgba(40,70,48,0.65)'; c.fill();
      if (on) { c.shadowColor = '#58ff7a'; c.shadowBlur = sz * 2; c.fill(); c.shadowBlur = 0; }
    }

    // the wheel: a rim with a marker at twelve o'clock and three spokes, turning with the car; most of it is below the screen
    c.save();
    c.translate(cx, hubY); if (bus) c.scale(1, 0.78); c.rotate(this.wheel);
    const rim = h * (bus ? 0.044 : 0.034);
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = rim * 1.5; c.beginPath(); c.arc(0, h * 0.006, R, 0, TAU); c.stroke();
    c.strokeStyle = r1 < 0.5 ? '#141518' : '#2a2420'; c.lineWidth = rim; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = rim * 0.18; c.beginPath(); c.arc(0, 0, R - rim * 0.3, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    c.strokeStyle = rgb(trim, 0.95); c.lineWidth = rim * 0.55; c.beginPath(); c.moveTo(0, -R - rim * 0.42); c.lineTo(0, -R + rim * 0.42); c.stroke();
    c.strokeStyle = '#1a1b1f'; c.lineWidth = rim * 0.9; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-R + rim * 0.5, 0); c.lineTo(R - rim * 0.5, 0); c.moveTo(0, 0); c.lineTo(0, R - rim * 0.5); c.stroke();
    c.lineCap = 'butt';
    c.beginPath(); c.arc(0, 0, h * (big ? 0.075 : 0.06), 0, TAU); c.fillStyle = '#1e2025'; c.fill();
    c.strokeStyle = rgb(trim, 0.7); c.lineWidth = Math.max(1, h * 0.004); c.stroke();
    c.restore();
  }
}

// ---- trains ------------------------------------------------------------------------------------------------

/** What a train cab needs, set on `CabEye.interior` by whoever builds the eye (main.ts). */
export interface TrainCabFeed {
  kind: 'train';
  /** road speed in km/h and the line's top speed */
  kmh: number; vmax: number;
  /** the station it calls at next, when known */
  next?: string;
  /** doors open (standing at a platform) */
  doors?: boolean;
  /** per-train variation seed, 0..1 */
  seed: number;
}

/** A driver's cab: window frames with an off-centre pillar, and a desk with a speed dial, a next-stop display and a power/brake handle. */
export class TrainCab {
  private L: Layers;
  private kmh = 0; private accel = 0; private lever = 0; private lastKmh = 0; private ready = false;
  private seed = -1;

  constructor(parent: HTMLElement, before: Element | null) { this.L = new Layers(parent, before); }

  hide() { if (this.L.on) { this.L.hide(); this.ready = false; } }

  update(f: TrainCabFeed, now: number, dt: number, w: number, h: number, level: number) {
    if (w < 150 || h < 80) { this.hide(); return; }
    const fx = w * 0.18, fw = w * 0.76, fy = h * 0.66;
    if (this.L.place(w, h, level, fx, fy, fw, h - fy, f.seed, 0)) this.paint(w, h, f.seed);
    if (!this.ready) { this.kmh = this.lastKmh = f.kmh; this.accel = 0; this.lever = f.kmh < 1 ? -0.7 : 0; this.ready = true; }
    else if (dt > 0) {
      this.kmh += (f.kmh - this.kmh) * (1 - Math.exp(-dt / 0.2));
      // acceleration in km/h per second, smoothed: it moves the handle (power up, brake down; at a platform the brake is held on)
      this.accel += ((f.kmh - this.lastKmh) / dt - this.accel) * (1 - Math.exp(-dt / 0.5));
      const want = f.kmh < 1 ? -0.7 : clamp(this.accel / 9, -1, 1);
      this.lever += (want - this.lever) * (1 - Math.exp(-dt / 0.35));
    }
    this.lastKmh = f.kmh;
    this.draw(f, now, w, h);
  }

  private paint(w: number, h: number, seed: number) {
    const c = this.L.b;
    c.clearRect(0, 0, w, h);
    const frame = '#1b1d22', edge = 'rgba(255,255,255,0.13)';
    const topY = h * 0.1, deskY = h * 0.7;
    const px = w * 0.06, cx = w * (0.62 + 0.06 * seed), cw = w * 0.032;
    // ceiling and window frame: one dark shape with the glass cut out, so the corners round naturally
    c.beginPath(); c.rect(0, 0, w, h);
    c.moveTo(px, deskY); c.lineTo(px + w * 0.015, topY + h * 0.03); c.quadraticCurveTo(px + w * 0.02, topY, px + w * 0.06, topY);
    c.lineTo(w - px - w * 0.06, topY); c.quadraticCurveTo(w - px - w * 0.02, topY, w - px - w * 0.015, topY + h * 0.03); c.lineTo(w - px, deskY); c.closePath();
    c.fillStyle = frame; c.fill('evenodd');
    c.strokeStyle = edge; c.lineWidth = Math.max(1.5, h * 0.005); c.stroke();
    // a pillar between the two panes, off to one side as in a real cab
    c.fillStyle = frame; c.fillRect(cx - cw / 2, topY, cw, deskY - topY);
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(cx - cw / 2, topY, cw * 0.18, deskY - topY);
    // ceiling lamp and the grab rail along the header
    c.fillStyle = vgrad(c, 0, topY, '#2a2d33', '#16171b'); c.fillRect(0, 0, w, topY * 0.8);
    c.fillStyle = 'rgba(255,240,200,0.55)'; roundRect(c, w * 0.46, topY * 0.2, w * 0.08, topY * 0.28, topY * 0.1); c.fill();
    c.strokeStyle = 'rgba(190,196,204,0.5)'; c.lineWidth = Math.max(1.5, h * 0.006);
    c.beginPath(); c.moveTo(px + w * 0.03, topY * 0.86); c.lineTo(w - px - w * 0.03, topY * 0.86); c.stroke();

    // the desk: a sloped panel with a bevelled front edge
    c.beginPath(); c.moveTo(0, deskY + h * 0.02); c.lineTo(w * 0.08, deskY); c.lineTo(w * 0.92, deskY); c.lineTo(w, deskY + h * 0.02); c.lineTo(w, h); c.lineTo(0, h); c.closePath();
    c.fillStyle = vgrad(c, deskY, h, '#3a4350', '#14171c'); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = Math.max(1, h * 0.004);
    c.beginPath(); c.moveTo(0, deskY + h * 0.02); c.lineTo(w * 0.08, deskY); c.lineTo(w * 0.92, deskY); c.lineTo(w, deskY + h * 0.02); c.stroke();
    // coloured bands and rows of switches
    const band = [0xd9752b, 0x2e86de, 0x4caf7a, 0xc0392b][Math.floor(seed * 4) % 4];
    c.fillStyle = rgb(band, 0.85); c.fillRect(0, deskY + h * 0.035, w, h * 0.008);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    for (let i = 0; i < 6; i++) { c.fillRect(w * (0.06 + i * 0.03), deskY + h * 0.11, w * 0.018, h * 0.026); c.fillRect(w * (0.9 - i * 0.03), deskY + h * 0.11, w * 0.018, h * 0.026); }
    for (let i = 0; i < 6; i++) {
      c.fillStyle = i % 3 === 0 ? 'rgba(255,190,90,0.8)' : i % 3 === 1 ? 'rgba(90,220,130,0.7)' : 'rgba(150,170,190,0.6)';
      c.beginPath(); c.arc(w * (0.075 + i * 0.03), deskY + h * 0.17, h * 0.008, 0, TAU); c.fill();
    }
  }

  private draw(f: TrainCabFeed, now: number, w: number, h: number) {
    const c = this.L.f, deskY = h * 0.7;
    c.clearRect(w * 0.17, h * 0.65, w * 0.78, h * 0.36);
    // speed dial, left of centre
    const gr = h * 0.105, gx = w * 0.36, gy = deskY + h * 0.16;
    const max = Math.max(60, Math.ceil(f.vmax / 20) * 20), kmh = clamp(this.kmh, 0, max);
    dialFace(c, gx, gy, gr, max, 20, 10, '#9dffb8', h > 330);
    needle(c, gx, gy, gr, kmh / max, '#ffb347');
    c.fillStyle = '#9dffb8'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 ${Math.max(7, gr * 0.34)}px ${MONO}`; c.fillText(String(Math.round(kmh)), gx, gy + gr * 0.5);
    c.font = `500 ${Math.max(5, gr * 0.17)}px ${MONO}`; c.globalAlpha = 0.65; c.fillText('km/h', gx, gy + gr * 0.74); c.globalAlpha = 1;

    // next-stop display: an amber-on-black panel
    const dx = w * 0.5, dw = w * 0.22, dy = deskY + h * 0.075, dh = h * 0.1;
    roundRect(c, dx, dy, dw, dh, h * 0.012); c.fillStyle = '#07090b'; c.fill();
    c.strokeStyle = '#3b3f47'; c.lineWidth = Math.max(1, h * 0.004); c.stroke();
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(255,190,80,0.6)';
    c.font = `500 ${Math.max(5, h * 0.018)}px ${MONO}`; c.fillText(f.doors ? 'AT STATION' : 'NEXT STOP', dx + dw * 0.05, dy + dh * 0.24);
    c.fillStyle = '#ffbe50';
    let name = f.next ?? '—';
    c.font = `700 ${Math.max(7, h * 0.03)}px ${MONO}`;
    while (name.length > 3 && c.measureText(name).width > dw * 0.9) name = `${name.slice(0, -2)}…`;
    c.fillText(name, dx + dw * 0.05, dy + dh * 0.66);

    // door lamp under the display: green when closed, flashing amber at a platform with them open
    const lamp = f.doors ? (Math.floor(now / 500) % 2 === 0 ? '#ffb347' : '#5a4220') : '#58ff7a';
    c.beginPath(); c.arc(dx + dw * 0.08, dy + dh + h * 0.04, h * 0.011, 0, TAU); c.fillStyle = lamp; c.fill();
    c.fillStyle = 'rgba(220,230,240,0.55)'; c.font = `500 ${Math.max(5, h * 0.016)}px ${SANS}`; c.textAlign = 'left';
    c.fillText('DOORS', dx + dw * 0.15, dy + dh + h * 0.04);

    // power / brake handle: a slot with a lever that rides up with acceleration and down with braking
    const sx = w * 0.82, sy0 = deskY + h * 0.05, sh = h * 0.19, sw = h * 0.026;
    roundRect(c, sx - sw / 2, sy0, sw, sh, sw / 2); c.fillStyle = '#07090b'; c.fill();
    c.strokeStyle = '#3b3f47'; c.lineWidth = Math.max(1, h * 0.004); c.stroke();
    c.fillStyle = 'rgba(160,230,180,0.7)'; c.font = `600 ${Math.max(5, h * 0.018)}px ${SANS}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('P', sx + sw * 1.1, sy0 + sh * 0.1); c.fillStyle = 'rgba(255,150,120,0.8)'; c.fillText('B', sx + sw * 1.1, sy0 + sh * 0.9);
    const ky = sy0 + sh * (0.5 - 0.4 * this.lever);
    c.strokeStyle = '#8c929b'; c.lineWidth = sw * 0.42; c.lineCap = 'round';
    c.beginPath(); c.moveTo(sx, ky); c.lineTo(sx + sw * 0.15, ky + h * 0.055); c.stroke(); c.lineCap = 'butt';
    c.beginPath(); c.arc(sx, ky, sw * 0.95, 0, TAU);
    c.fillStyle = this.lever < -0.05 ? '#b8442f' : this.lever > 0.05 ? '#3f9d5f' : '#3b4048'; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = Math.max(1, h * 0.003); c.stroke();
  }
}

// ---- boats -------------------------------------------------------------------------------------------------

/** What a wheelhouse needs, set on `CabEye.helm` by whoever builds the eye (main.ts). */
export interface HelmFeed {
  kind: 'helm';
  /** a wheelhouse with windows all round; otherwise an open helm, which shows only the bow and the tiller */
  wheelhouse: boolean;
  /** speed through the water, knots, and the type's cruising speed */
  knots: number; vmax: number;
  /** compass heading, degrees (0 north: -z), and the rate of turn, positive to starboard, -1..1 */
  heading: number; turn: number;
  /** the hull's colour, 0xrrggbb */
  hull: number;
  /** per-boat variation seed, 0..1 */
  seed: number;
}
const WHEELHOUSE_FRAMES = [0x1d2a2e, 0x2b2420, 0x23272d, 0x2d3326];

/** A wheelhouse: window frames with mullions, a console with a wheel, a compass, a radar, a speed readout and throttle levers. */
export class HelmCab {
  private L: Layers;
  private wheel = 0; private lever = 0; private kn = 0; private turn = 0; private ready = false;
  private open = false;

  constructor(parent: HTMLElement, before: Element | null) { this.L = new Layers(parent, before); }

  hide() { if (this.L.on) { this.L.hide(); this.ready = false; } }

  update(f: HelmFeed, now: number, dt: number, w: number, h: number, level: number) {
    if (w < 150 || h < 80) { this.hide(); return; }
    this.open = !f.wheelhouse;
    const fy = h * 0.6;
    if (this.L.place(w, h, level, 0, fy, w, h - fy, f.seed, f.wheelhouse ? 1 : 0)) this.paint(f, w, h);
    if (!this.ready) { this.kn = f.knots; this.turn = f.turn; this.lever = clamp(f.knots / Math.max(1, f.vmax), 0, 1); this.ready = true; }
    else if (dt > 0) {
      this.kn += (f.knots - this.kn) * (1 - Math.exp(-dt / 0.5));
      this.turn += (f.turn - this.turn) * (1 - Math.exp(-dt / 0.4));
      this.lever += (clamp(f.knots / Math.max(1, f.vmax), 0, 1) - this.lever) * (1 - Math.exp(-dt / 0.8));
    }
    this.wheel += (clamp(this.turn, -1, 1) * 1.6 - this.wheel) * (1 - Math.exp(-dt / 0.3));
    this.draw(f, now, w, h);
  }

  private paint(f: HelmFeed, w: number, h: number) {
    const c = this.L.b;
    c.clearRect(0, 0, w, h);
    if (!f.wheelhouse) return; // an open helm has nothing painted: the real foredeck is in the view, and the tiller is drawn on the front layer
    const frame = rgb(WHEELHOUSE_FRAMES[Math.floor(f.seed * WHEELHOUSE_FRAMES.length) % WHEELHOUSE_FRAMES.length]), edge = 'rgba(255,255,255,0.14)';
    const topY = h * 0.09, deskY = h * 0.7, px = w * 0.035;
    c.beginPath(); c.rect(0, 0, w, h);
    c.moveTo(px, deskY); c.lineTo(px + w * 0.02, topY + h * 0.02); c.lineTo(w - px - w * 0.02, topY + h * 0.02); c.lineTo(w - px, deskY); c.closePath();
    c.fillStyle = frame; c.fill('evenodd');
    c.strokeStyle = edge; c.lineWidth = Math.max(1.5, h * 0.005); c.stroke();
    // mullions that lean in at the corners, and a header with a lamp
    const mw = w * 0.018;
    for (const mx of [0.3 + 0.03 * f.seed, 0.7 - 0.03 * f.seed]) {
      c.beginPath(); c.moveTo(w * mx - mw / 2, deskY); c.lineTo(w * mx - mw / 2, topY); c.lineTo(w * mx + mw / 2, topY); c.lineTo(w * mx + mw / 2, deskY); c.closePath();
      c.fillStyle = frame; c.fill(); c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(w * mx - mw / 2, topY, mw * 0.2, deskY - topY);
    }
    c.fillStyle = vgrad(c, 0, topY, '#2a2d33', '#15171a'); c.fillRect(0, 0, w, topY * 0.85);
    c.fillStyle = 'rgba(255,200,130,0.45)'; roundRect(c, w * 0.47, topY * 0.2, w * 0.06, topY * 0.25, topY * 0.1); c.fill();
    // the console: a sloped panel with a bevel, a brass strip, instrument recesses
    c.beginPath(); c.moveTo(0, deskY + h * 0.03); c.lineTo(w * 0.05, deskY); c.lineTo(w * 0.95, deskY); c.lineTo(w, deskY + h * 0.03); c.lineTo(w, h); c.lineTo(0, h); c.closePath();
    c.fillStyle = vgrad(c, deskY, h, '#3a3f45', '#121417'); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = Math.max(1, h * 0.004);
    c.beginPath(); c.moveTo(0, deskY + h * 0.03); c.lineTo(w * 0.05, deskY); c.lineTo(w * 0.95, deskY); c.lineTo(w, deskY + h * 0.03); c.stroke();
    c.fillStyle = 'rgba(200,160,70,0.8)'; c.fillRect(0, deskY + h * 0.045, w, h * 0.006);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i < 7; i++) { c.fillRect(w * (0.04 + i * 0.026), deskY + h * 0.11, w * 0.014, h * 0.022); c.fillRect(w * (0.96 - 0.014 - i * 0.026), deskY + h * 0.11, w * 0.014, h * 0.022); }
  }

  private draw(f: HelmFeed, now: number, w: number, h: number) {
    const c = this.L.f;
    c.clearRect(0, h * 0.58, w, h * 0.43);
    if (this.open) {
      // the tiller swings with the turn
      const bx = w * 0.84, by = h * 1.02, a = -1.15 + this.turn * 0.5;
      c.strokeStyle = '#7a5530'; c.lineWidth = Math.max(3, h * 0.022); c.lineCap = 'round';
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a) * h * 0.36, by + Math.sin(a) * h * 0.36); c.stroke(); c.lineCap = 'butt';
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = `600 ${Math.max(7, h * 0.03)}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(`${Math.round(this.kn)} kt`, w * 0.5, h * 0.95);
      return;
    }
    const deskY = h * 0.7;
    // compass card: turns with the heading, the lubber line fixed
    const cr = h * 0.075, cx = w * 0.3, cy = deskY + h * 0.17;
    c.beginPath(); c.arc(cx, cy, cr, 0, TAU); c.fillStyle = '#090b0e'; c.fill();
    c.lineWidth = Math.max(1.5, cr * 0.08); c.strokeStyle = '#8a7a4a'; c.stroke();
    c.save(); c.translate(cx, cy); c.rotate((-f.heading * Math.PI) / 180);
    c.strokeStyle = '#d7e4d0'; c.fillStyle = '#d7e4d0'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 ${Math.max(6, cr * 0.34)}px ${SANS}`;
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180, major = d % 90 === 0;
      c.lineWidth = Math.max(1, cr * (major ? 0.07 : 0.035));
      c.beginPath(); c.moveTo(Math.sin(a) * cr * (major ? 0.62 : 0.8), -Math.cos(a) * cr * (major ? 0.62 : 0.8)); c.lineTo(Math.sin(a) * cr * 0.92, -Math.cos(a) * cr * 0.92); c.stroke();
    }
    for (const [t, d] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) { const a = (d * Math.PI) / 180; c.fillStyle = d === 0 ? '#ff6a4d' : '#d7e4d0'; c.fillText(t, Math.sin(a) * cr * 0.42, -Math.cos(a) * cr * 0.42); }
    c.restore();
    c.strokeStyle = '#ffb347'; c.lineWidth = Math.max(1.5, cr * 0.09); c.beginPath(); c.moveTo(cx, cy - cr * 1.02); c.lineTo(cx, cy - cr * 0.78); c.stroke();

    // radar: a phosphor disc with range rings, a sweep and a few echoes of the shore
    const rr = h * 0.105, rx = w * 0.5, ry = deskY + h * 0.165;
    c.beginPath(); c.arc(rx, ry, rr, 0, TAU); c.fillStyle = '#031208'; c.fill();
    c.save(); c.beginPath(); c.arc(rx, ry, rr, 0, TAU); c.clip();
    c.strokeStyle = 'rgba(80,255,140,0.25)'; c.lineWidth = Math.max(1, rr * 0.02);
    for (const k of [0.33, 0.66, 1]) { c.beginPath(); c.arc(rx, ry, rr * k, 0, TAU); c.stroke(); }
    const sweep = (now / 2600 + f.seed) * TAU;
    for (let i = 0; i < 24; i++) { const a = sweep - i * 0.06; c.strokeStyle = `rgba(90,255,150,${0.5 * (1 - i / 24)})`; c.lineWidth = Math.max(1.5, rr * 0.05); c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr); c.stroke(); }
    for (let i = 0; i < 9; i++) {
      const a = (i * 0.7 + f.seed * 5) % TAU, d = rr * (0.45 + 0.4 * ((i * 0.37 + f.seed) % 1)), age = ((sweep - a) % TAU + TAU) % TAU;
      c.fillStyle = `rgba(120,255,170,${Math.max(0, 0.9 - age / 4)})`;
      c.fillRect(rx + Math.cos(a) * d - rr * 0.03, ry + Math.sin(a) * d - rr * 0.03, rr * 0.1, rr * 0.05);
    }
    c.restore();
    c.lineWidth = Math.max(1.5, rr * 0.06); c.strokeStyle = '#3b3f47'; c.beginPath(); c.arc(rx, ry, rr, 0, TAU); c.stroke();

    // speed readout and twin throttle levers
    const sx = w * 0.64, sy = deskY + h * 0.09, sw = w * 0.1, sh = h * 0.07;
    roundRect(c, sx, sy, sw, sh, h * 0.01); c.fillStyle = '#07090b'; c.fill(); c.strokeStyle = '#3b3f47'; c.lineWidth = Math.max(1, h * 0.004); c.stroke();
    c.fillStyle = '#9dffb8'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 ${Math.max(8, sh * 0.5)}px ${MONO}`; c.fillText(this.kn.toFixed(1), sx + sw / 2, sy + sh * 0.4);
    c.font = `500 ${Math.max(5, sh * 0.2)}px ${MONO}`; c.globalAlpha = 0.65; c.fillText('KNOTS', sx + sw / 2, sy + sh * 0.82); c.globalAlpha = 1;
    for (let i = 0; i < 2; i++) {
      const lx = w * (0.8 + i * 0.045), y0 = deskY + h * 0.07, sl = h * 0.19, lw = h * 0.02;
      roundRect(c, lx - lw / 2, y0, lw, sl, lw / 2); c.fillStyle = '#07090b'; c.fill(); c.strokeStyle = '#3b3f47'; c.stroke();
      const ky = y0 + sl * (0.9 - 0.8 * clamp(this.lever + (i ? 0.02 : 0), 0, 1));
      c.strokeStyle = '#8c929b'; c.lineWidth = lw * 0.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(lx, ky); c.lineTo(lx, ky + h * 0.05); c.stroke(); c.lineCap = 'butt';
      c.beginPath(); c.arc(lx, ky, lw * 0.95, 0, TAU); c.fillStyle = i ? '#c8402f' : '#3f9d5f'; c.fill();
    }

    // the wheel: eight spokes with handles, turning with the helm
    const R = h * 0.19, hubY = h * 1.0, hubX = w * 0.5 - w * 0.0;
    c.save(); c.translate(hubX, hubY + h * 0.02); c.rotate(this.wheel);
    c.strokeStyle = '#4a3320'; c.lineWidth = Math.max(3, h * 0.026);
    c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();
    c.strokeStyle = '#8a6a3f'; c.lineWidth = Math.max(1.5, h * 0.01);
    c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();
    c.strokeStyle = '#4a3320'; c.lineWidth = Math.max(2, h * 0.014);
    for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12); c.stroke(); }
    c.beginPath(); c.arc(0, 0, h * 0.032, 0, TAU); c.fillStyle = '#b5893a'; c.fill();
    c.restore();
  }
}
