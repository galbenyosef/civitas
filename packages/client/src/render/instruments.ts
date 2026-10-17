import { Vector3, type Quaternion } from 'three';

/**
 * Flight instruments for the first-person cockpit view (render/fpv.ts): a small glass-cockpit overlay drawn on a 2D
 * canvas over the FPV viewport, with an artificial horizon, airspeed and altitude tapes, a heading strip and a vertical
 * speed bar (a compact readout in the inset). Everything is derived from the cab's pose frame to frame, so any aircraft
 * works without its renderer knowing about it; the only inputs besides the pose are the calibration constants below.
 */

/** How to turn the game's tile-based motion into aircraft units. Set on `CabEye.instruments` by whoever builds the eye. */
export interface AircraftCal {
  /** knots per tile-per-tick of speed (the same scale the plane panel's knots use) */
  ktPerTile: number;
  /** feet per tile of altitude (the same scale as the plane panel's feet) */
  ftPerTile: number;
  /** game ticks per real second right now (0 while paused); speeds are measured in game time, so fast-forward reads true */
  ticksPerSec: number;
  /** the game tick (fractional) the pose was drawn at; when given, speeds are distance over ticks elapsed, so a clock resync, a pause or a speed change never reads as a burst of speed */
  tick?: number;
  /** the vehicle's own speed reading, in knots: shown while the game clock is stopped or frozen (a paused game, a debug tick), when no motion can be measured */
  knots?: number;
  /** how far the eye sits above the aircraft's own altitude, in tiles, so the gate reads 0 ft rather than the cockpit's height */
  eyeAbove: number;
}

/** The slice of a CabEye the instruments read. */
export interface InstrumentFeed {
  key: string;
  x: number; y: number; z: number;
  q: Quaternion;
  sway?: number; seed?: number;
  instruments?: AircraftCal;
}

const FT_PER_MIN_PER_KT = 101.27;
const GREEN = '#8dffb0', WHITE = '#e9f3ee', AMBER = '#ffc861', SKY = '#2f78c8', GROUND = '#8a5a2e';
const GLASS = 'rgba(6,12,18,0.52)', EDGE = 'rgba(200,255,225,0.3)', DIM = 'rgba(233,243,238,0.55)';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const DEG = Math.PI / 180;
/** layout boxes in logical pixels; the canvas scales them to the viewport */
const FULL_W = 360, FULL_H = 190, COMPACT_W = 150, COMPACT_H = 84;
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const labels = new Map<number, string>();
/** number to string, remembered: the tapes ask for the same few hundred labels every frame */
const lab = (n: number) => { let s = labels.get(n); if (s === undefined) { s = String(n); labels.set(n, s); } return s; };
const lab3 = (n: number) => { const k = n + 100000; let s = labels.get(k); if (s === undefined) { s = String(n).padStart(3, '0'); labels.set(k, s); } return s; };
const lab2 = (n: number) => { const k = n + 200000; let s = labels.get(k); if (s === undefined) { s = String(n).padStart(2, '0'); labels.set(k, s); } return s; };
const grouped = (n: number) => (n >= 1000 ? `${Math.floor(n / 1000)},${String(n % 1000).padStart(3, '0')}` : String(n));

const FWD = new Vector3(), UP = new Vector3(), RIGHT = new Vector3(), TRUE_UP = new Vector3(), Y = new Vector3(0, 1, 0);

export class Instruments {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shown = false;
  private sizeTag = '';
  private opacity = -1;
  private scale = 1;
  private compact = false;
  // motion, measured from the eye between frames
  private key = '';
  private have = false; private haveTick = false; private ltick = 0;
  private lx = 0; private ly = 0; private lz = 0;
  private kt = 0; private vs = 0;
  // attitude and heading this frame
  private pitch = 0; private bank = 0; private hdg = 0;
  private alt = 0;

  constructor(parent: HTMLElement, before: Element | null) {
    this.el = document.createElement('canvas');
    this.el.className = 'finst';
    this.el.style.display = 'none';
    parent.insertBefore(this.el, before);
    this.ctx = this.el.getContext('2d')!;
  }

  hide() {
    if (!this.shown) return;
    this.shown = false; this.have = false; this.haveTick = false; this.key = '';
    this.el.style.display = 'none';
  }

  /**
   * Measure, then draw. `w`/`h` is the FPV viewport in CSS pixels, `level` its fade (1 = fully shown).
   * `dt` is real seconds since the last frame, `now` the page clock in ms.
   */
  update(cab: InstrumentFeed, now: number, dt: number, mode: 'inset' | 'full', w: number, h: number, level: number) {
    const cal = cab.instruments;
    if (!cal || w < 40 || h < 40) { this.hide(); return; }
    if (!this.shown) { this.shown = true; this.el.style.display = 'block'; }
    this.measure(cab, cal, dt);
    this.fit(mode, w, h);
    const op = Math.round(level * 50) / 50;
    if (op !== this.opacity) { this.opacity = op; this.el.style.opacity = String(op); }
    this.draw(cab, now);
  }

  // ---- measuring ----------------------------------------------------------------------------

  private measure(cab: InstrumentFeed, cal: AircraftCal, dt: number) {
    const { x, y, z } = cab;
    // a new ride, or a long gap (the tab was in the background): start again rather than read the jump as speed
    if (cab.key !== this.key || dt > 0.25) { this.key = cab.key; this.have = false; this.haveTick = false; }
    // game ticks passed since the last frame: from the pose's own tick when it has one, else from real time at the current rate
    const ticks = cal.tick !== undefined ? (this.haveTick ? cal.tick - this.ltick : 0) : dt * cal.ticksPerSec;
    if (cal.tick !== undefined) { this.ltick = cal.tick; this.haveTick = true; }
    if (ticks <= 1e-4 && cal.knots !== undefined && dt > 1e-4) this.kt += (cal.knots - this.kt) * (1 - Math.exp(-dt / 0.7));
    if (this.have && dt > 1e-4 && ticks > 1e-4 && ticks < 40 && cal.ktPerTile > 0) {
      const perTick = 1 / ticks;
      const vx = (x - this.lx) * perTick, vy = (y - this.ly) * perTick, vz = (z - this.lz) * perTick;
      const kt = Math.hypot(vx, vy, vz) * cal.ktPerTile;
      // a vertical tile is as long as a horizontal one in the sim's own knots, so the climb rate comes off the same scale
      const vs = vy * cal.ktPerTile * FT_PER_MIN_PER_KT;
      if (kt < 700) {
        this.kt += (kt - this.kt) * (1 - Math.exp(-dt / 0.7));
        this.vs += (clamp(vs, -6000, 6000) - this.vs) * (1 - Math.exp(-dt / 1.1));
      }
    }
    this.lx = x; this.ly = y; this.lz = z; this.have = true;
    this.alt = Math.max(0, (y - cal.eyeAbove) * (cal.ftPerTile > 0 ? cal.ftPerTile : 312.5));

    // attitude straight off the aircraft's orientation (+x forward, +y up): pitch of the nose, bank of the wings, bearing of the nose
    FWD.set(1, 0, 0).applyQuaternion(cab.q);
    UP.set(0, 1, 0).applyQuaternion(cab.q);
    this.pitch = Math.asin(clamp(FWD.y, -1, 1));
    RIGHT.crossVectors(FWD, Y);
    if (RIGHT.lengthSq() > 1e-6) {
      RIGHT.normalize();
      TRUE_UP.crossVectors(RIGHT, FWD);
      // right wing down tips the aircraft's up vector away from the right
      this.bank = Math.atan2(-UP.dot(RIGHT), UP.dot(TRUE_UP));
    }
    // north is -z, east +x
    let hdg = Math.atan2(FWD.x, -FWD.z) / DEG;
    if (hdg < 0) hdg += 360;
    this.hdg = hdg;
  }

  // ---- canvas -------------------------------------------------------------------------------

  /** Size and place the canvas: bottom-right of the inset (compact readout), bottom-centre of the full window. */
  private fit(mode: 'inset' | 'full', w: number, h: number) {
    const compact = mode === 'inset';
    const lw = compact ? COMPACT_W : FULL_W, lh = compact ? COMPACT_H : FULL_H;
    const s = compact ? clamp(h / 190, 0.9, 1.7) : clamp(h / 600, 0.85, 1.5);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const tag = `${compact ? 'c' : 'f'}|${w}|${h}|${s.toFixed(3)}|${dpr}`;
    if (tag === this.sizeTag) return;
    this.sizeTag = tag; this.compact = compact; this.scale = s;
    const cw = Math.round(lw * s), ch = Math.round(lh * s);
    const st = this.el.style;
    st.width = `${cw}px`; st.height = `${ch}px`;
    this.el.width = Math.round(cw * dpr); this.el.height = Math.round(ch * dpr);
    if (compact) { st.left = 'auto'; st.right = '6px'; st.bottom = '6px'; st.transform = 'none'; }
    else { st.left = '50%'; st.right = 'auto'; st.bottom = '18px'; st.transform = 'translateX(-50%)'; }
    this.ctx.setTransform(this.el.width / lw, 0, 0, this.el.height / lh, 0, 0);
  }

  private draw(cab: InstrumentFeed, now: number) {
    const c = this.ctx;
    const lw = this.compact ? COMPACT_W : FULL_W, lh = this.compact ? COMPACT_H : FULL_H;
    c.clearRect(0, 0, lw, lh);

    // a little unsteadiness in rough air, per aircraft: needles and the horizon wander by a hair
    const turb = (cab.sway ?? 0) * (0.5 + 0.5 * Math.min(1, this.alt / 200));
    const ph = (cab.seed ?? 0) * 6.28;
    const wob = Math.sin(now * 0.0031 + ph) * 0.6 + Math.sin(now * 0.0077 + ph * 1.7) * 0.4;
    const wob2 = Math.sin(now * 0.0043 + ph * 2.3) * 0.6 + Math.sin(now * 0.0101 + ph) * 0.4;
    const pitch = this.pitch + wob * 0.0035 * turb;
    const bank = this.bank + wob2 * 0.006 * turb;
    const kt = Math.max(0, this.kt + wob2 * 0.7 * turb);
    const vs = this.vs + wob * 35 * turb;
    const alt = this.alt + wob * 1.5 * turb;
    const hdg = (this.hdg + wob2 * 0.25 * turb + 360) % 360;

    if (this.compact) this.drawCompact(pitch, bank, kt, alt, vs, hdg);
    else this.drawFull(pitch, bank, kt, alt, vs, hdg);
  }

  private glass(x: number, y: number, w: number, h: number, r = 5) {
    const c = this.ctx;
    c.beginPath(); c.roundRect(x, y, w, h, r);
    c.fillStyle = GLASS; c.fill();
    c.lineWidth = 1; c.strokeStyle = EDGE; c.stroke();
  }

  private text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 500) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${MONO}`;
    c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color;
    c.fillText(s, x, y);
  }

  private drawFull(pitch: number, bank: number, kt: number, alt: number, vs: number, hdg: number) {
    const c = this.ctx;
    const bx = 180, by = 112, br = 58;
    this.ball(bx, by, br, pitch, bank);

    // heading strip above the ball, with its digital readout
    this.headingStrip(100, 18, 160, 20, hdg);
    this.glass(158, 0, 44, 15, 4);
    this.text(lab3(Math.round(hdg) % 360 || 360), 180, 8, 11, GREEN, 'center', 700);

    // airspeed (left) and altitude (right) tapes with their readouts
    const ty = 52, th = 120;
    this.tape(16, ty, 74, th, kt, 1.7, 5, 20, 1, Math.round(kt), 0);
    this.tape(270, ty, 74, th, alt, 0.17, 50, 200, -1, Math.round(alt / 10) * 10, 1);
    this.text('KT', 53, ty + th + 11, 9, DIM, 'center');
    this.text('FT', 307, ty + th + 11, 9, DIM, 'center');

    // vertical speed: a bar beside the altitude tape, climbing up from the middle
    const vx = 348, vw = 10;
    this.glass(vx, ty, vw, th, 3);
    const mid = ty + th / 2, vpp = (th / 2 - 6) / 2000;
    c.strokeStyle = DIM; c.lineWidth = 1;
    c.beginPath();
    for (const t of [-2000, -1000, 0, 1000, 2000]) { const yy = mid - t * vpp; c.moveTo(vx + 1, yy); c.lineTo(vx + (t === 0 ? vw - 1 : 4), yy); }
    c.stroke();
    const vy = mid - clamp(vs, -2000, 2000) * vpp;
    c.fillStyle = vs >= 0 ? GREEN : AMBER;
    c.fillRect(vx + 3, Math.min(vy, mid), vw - 6, Math.max(1.5, Math.abs(vy - mid)));
    const vr = Math.round(vs / 50) * 50;
    this.text(`VS ${vr > 0 ? '+' : vr < 0 ? '-' : ''}${lab(Math.abs(vr))}`, 332, ty + th + 11, 9, vs >= 0 ? GREEN : AMBER, 'center', 600);
  }

  private drawCompact(pitch: number, bank: number, kt: number, alt: number, vs: number, hdg: number) {
    this.glass(0, 0, COMPACT_W, COMPACT_H, 8);
    this.ball(113, 43, 33, pitch, bank);
    const h = Math.round(hdg) % 360;
    this.text(`${lab3(h || 360)}° ${CARD[Math.round(hdg / 45) % 8]}`, 70, 14, 10.5, GREEN, 'right', 700);
    this.text(`${lab(Math.round(kt))} kt`, 70, 31, 10.5, WHITE, 'right');
    this.text(`${grouped(Math.round(alt / 10) * 10)} ft`, 70, 48, 10.5, WHITE, 'right');
    const vr = Math.round(vs / 50) * 50;
    this.text(`${vr > 0 ? '▲' : vr < 0 ? '▼' : '•'} ${lab(Math.abs(vr))} fpm`, 70, 65, 10.5, vs >= 0 ? GREEN : AMBER, 'right');
  }

  /** The artificial horizon: sky over ground, a pitch ladder that slides with the nose and a scale that rolls with the bank. */
  private ball(cx: number, cy: number, r: number, pitch: number, bank: number) {
    const c = this.ctx;
    c.save();
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
    c.translate(cx, cy);
    c.rotate(-bank);
    const K = r * 1.72;
    const hy = clamp(pitch, -1.45, 1.45) * K; // nose up: the horizon drops
    c.fillStyle = SKY; c.fillRect(-3 * r, hy - 6 * r, 6 * r, 6 * r);
    c.fillStyle = GROUND; c.fillRect(-3 * r, hy, 6 * r, 6 * r);
    c.lineWidth = Math.max(1, r / 36); c.strokeStyle = WHITE;
    c.beginPath(); c.moveTo(-3 * r, hy); c.lineTo(3 * r, hy); c.stroke();

    // pitch ladder: 5 degree ticks, 10 degree rungs with numbers
    c.lineWidth = Math.max(0.8, r / 50);
    c.beginPath();
    for (let d = -30; d <= 30; d += 5) {
      if (d === 0) continue;
      const yy = hy - d * DEG * K;
      if (yy < -r - 4 || yy > r + 4) continue;
      const half = d % 10 === 0 ? r * 0.3 : r * 0.14;
      c.moveTo(-half, yy); c.lineTo(half, yy);
    }
    c.stroke();
    if (r > 40) {
      const fs = Math.max(7, r * 0.15);
      for (let d = -30; d <= 30; d += 10) {
        if (d === 0) continue;
        const yy = hy - d * DEG * K;
        if (yy < -r + 6 || yy > r - 6) continue;
        this.text(lab(Math.abs(d)), -r * 0.3 - 3, yy, fs, WHITE, 'right');
        this.text(lab(Math.abs(d)), r * 0.3 + 3, yy, fs, WHITE, 'left');
      }
    }
    c.restore();

    // roll scale: ticks that turn with the horizon, read against the fixed pointer at the top
    c.save();
    c.translate(cx, cy);
    c.rotate(-bank);
    c.strokeStyle = WHITE; c.lineWidth = Math.max(0.8, r / 45);
    c.beginPath();
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const len = a % 30 === 0 ? r * 0.13 : r * 0.07, ca = Math.sin(a * DEG), sa = -Math.cos(a * DEG);
      c.moveTo(ca * (r - 1), sa * (r - 1)); c.lineTo(ca * (r - 1 - len), sa * (r - 1 - len));
    }
    c.stroke();
    c.restore();

    // bezel
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(200,255,225,0.55)'; c.lineWidth = 1.5; c.stroke();

    // fixed pointer and the aircraft's own symbol
    c.fillStyle = AMBER;
    c.beginPath(); c.moveTo(cx, cy - r + 1); c.lineTo(cx - r * 0.07, cy - r - r * 0.1); c.lineTo(cx + r * 0.07, cy - r - r * 0.1); c.closePath(); c.fill();
    c.strokeStyle = AMBER; c.lineWidth = Math.max(1.4, r / 24); c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(cx - r * 0.56, cy); c.lineTo(cx - r * 0.2, cy); c.lineTo(cx - r * 0.2, cy + r * 0.1);
    c.moveTo(cx + r * 0.56, cy); c.lineTo(cx + r * 0.2, cy); c.lineTo(cx + r * 0.2, cy + r * 0.1);
    c.stroke();
    c.fillStyle = AMBER;
    c.beginPath(); c.arc(cx, cy, Math.max(1.5, r / 26), 0, Math.PI * 2); c.fill();
  }

  /**
   * A vertical scrolling tape. `side` 1: ticks on the right edge (the airspeed tape, next to the ball), -1: on the left.
   * `shown` is the number in the readout box, set in thousands groups when `fmt` is 1.
   */
  private tape(x: number, y: number, w: number, h: number, v: number, pp: number, step: number, labelEvery: number, side: 1 | -1, shown: number, fmt: 0 | 1) {
    const c = this.ctx;
    this.glass(x, y, w, h);
    c.save();
    c.beginPath(); c.rect(x + 1, y + 1, w - 2, h - 2); c.clip();
    const cy = y + h / 2, span = h / 2 / pp + step;
    const edge = side === 1 ? x + w - 1 : x + 1;
    c.strokeStyle = WHITE; c.lineWidth = 1;
    c.beginPath();
    const first = Math.ceil((v - span) / step), last = Math.floor((v + span) / step);
    for (let n = Math.max(0, first); n <= last; n++) {
      const t = n * step, py = cy - (t - v) * pp, major = t % labelEvery === 0;
      c.moveTo(edge, py); c.lineTo(edge - side * (major ? 9 : 5), py);
    }
    c.stroke();
    for (let n = Math.max(0, first); n <= last; n++) {
      const t = n * step;
      if (t % labelEvery !== 0) continue;
      this.text(lab(t), edge - side * 13, cy - (t - v) * pp, 10, WHITE, side === 1 ? 'right' : 'left');
    }
    c.restore();
    // readout box over the middle of the tape, with a pointer toward the ball
    const bh = 20, bw = w - 14, bx = side === 1 ? x + 3 : x + w - 3 - bw;
    c.beginPath(); c.rect(bx, cy - bh / 2, bw, bh);
    c.fillStyle = 'rgba(0,0,0,0.78)'; c.fill();
    c.strokeStyle = GREEN; c.lineWidth = 1; c.stroke();
    c.beginPath();
    if (side === 1) { c.moveTo(bx + bw, cy - 4); c.lineTo(bx + bw + 5, cy); c.lineTo(bx + bw, cy + 4); }
    else { c.moveTo(bx, cy - 4); c.lineTo(bx - 5, cy); c.lineTo(bx, cy + 4); }
    c.closePath(); c.fillStyle = GREEN; c.fill();
    this.text(fmt ? grouped(shown) : lab(shown), bx + bw / 2, cy + 0.5, 12.5, GREEN, 'center', 700);
  }

  /** The compass strip: ticks every 5 degrees, a label every 30, letters at the four points. */
  private headingStrip(x: number, y: number, w: number, h: number, hdg: number) {
    const c = this.ctx;
    this.glass(x, y, w, h);
    c.save();
    c.beginPath(); c.rect(x + 1, y + 1, w - 2, h - 2); c.clip();
    const pp = 2.4, cx = x + w / 2, span = w / 2 / pp + 5;
    const first = Math.ceil((hdg - span) / 5), last = Math.floor((hdg + span) / 5);
    c.strokeStyle = WHITE; c.lineWidth = 1;
    c.beginPath();
    for (let n = first; n <= last; n++) {
      const px = cx + (n * 5 - hdg) * pp, major = n % 2 === 0;
      c.moveTo(px, y + h - 1); c.lineTo(px, y + h - (major ? 7 : 4));
    }
    c.stroke();
    for (let n = first; n <= last; n++) {
      const a = (((n * 5) % 360) + 360) % 360;
      if (a % 30 !== 0) continue;
      const px = cx + (n * 5 - hdg) * pp;
      const card = a % 90 === 0;
      this.text(card ? CARD[a / 45] : lab2(a / 10), px, y + 8, card ? 11 : 9.5, card ? GREEN : WHITE, 'center', card ? 700 : 500);
    }
    c.restore();
    c.fillStyle = AMBER;
    c.beginPath(); c.moveTo(cx, y + h + 1); c.lineTo(cx - 4, y + h + 6); c.lineTo(cx + 4, y + h + 6); c.closePath(); c.fill();
  }
}
