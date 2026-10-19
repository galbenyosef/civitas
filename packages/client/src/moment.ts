import type { CameraRig } from './camera';

/**
 * A short camera moment (Audit #1, the first settlers): fly from wherever the camera is to a tile, hold there with a
 * caption while the view turns slowly, then fly back to where it was, as the demo tour's flights do (tour.ts). Any
 * input (a press, the wheel, a key) ends it at once and leaves the camera to the player. main.ts calls `frame` before
 * the rig places the camera.
 */
interface View { x: number; z: number; dist: number; yaw: number; pitch: number }

const FLY_S = 1.8, HOLD_S = 4.5, TURN = 0.35; // seconds out and back, seconds held, radians the view turns while held
const TAU = Math.PI * 2;

export class CameraMoment {
  private run: { at: number; from: View; to: View; hold: number } | null = null;
  private cap = document.createElement('div');

  constructor(private rig: CameraRig, private onStart: () => void = () => {}) {
    this.cap.id = 'moment';
    this.cap.className = 'hidden';
    document.getElementById('ui')?.appendChild(this.cap);
    const style = document.createElement('style');
    style.textContent = `
#moment { position: absolute; left: 50%; bottom: 14%; z-index: 7; transform: translateX(-50%); padding: 10px 18px; border-radius: 12px; pointer-events: none;
  background: linear-gradient(120deg, rgba(40,36,22,0.9), rgba(16,20,27,0.88)); border: 1px solid rgba(255,212,121,0.7); color: #ffe7b0;
  font-size: 17px; font-weight: 600; letter-spacing: 0.01em; box-shadow: 0 10px 30px rgba(0,0,0,0.35); animation: momentIn 0.6s ease-out; white-space: nowrap; }
#moment small { display: block; margin-top: 2px; font-size: 11px; font-weight: 400; color: rgba(255,231,176,0.7); text-align: center; }
#moment.hidden { display: none; }
@keyframes momentIn { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translateX(-50%); } }`;
    document.head.appendChild(style);
    // any input hands the camera back
    const stop = () => { if (this.run) this.stop(); };
    for (const ev of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, stop, { capture: true, passive: true });
  }

  get active() { return !!this.run; }

  /**
   * Look at tile (x, y) for a few seconds with `caption`, then return. `opts` (a rank-up, client/src/ranks.ts): a wider
   * view (`dist`, `pitch`) held for `hold` seconds.
   */
  play(x: number, y: number, caption: string, opts: { dist?: number; pitch?: number; hold?: number } = {}) {
    const r = this.rig;
    const from: View = { x: r.target.x, z: r.target.z, dist: r.dist, yaw: r.yaw, pitch: r.pitch };
    const to: View = { x: x + 1, z: y + 1, dist: opts.dist ?? 11, yaw: r.yaw + 0.25, pitch: opts.pitch ?? 0.66 };
    this.run = { at: performance.now(), from, to, hold: opts.hold ?? HOLD_S };
    this.cap.innerHTML = `${esc(caption)}<small>any key or click to carry on</small>`;
    this.cap.className = '';
    this.onStart();
  }

  stop() {
    this.run = null;
    this.cap.className = 'hidden';
  }

  /** Once per frame, before the rig updates. */
  frame() {
    const m = this.run;
    if (!m) return;
    const t = (performance.now() - m.at) / 1000;
    if (t < FLY_S) this.place(m.from, m.to, t / FLY_S);
    else if (t < FLY_S + m.hold) this.place(m.to, { ...m.to, yaw: m.to.yaw + TURN }, (t - FLY_S) / m.hold, false);
    else if (t < 2 * FLY_S + m.hold) { this.cap.className = 'hidden'; this.place({ ...m.to, yaw: m.to.yaw + TURN }, m.from, (t - FLY_S - m.hold) / FLY_S); }
    else { this.place(m.from, m.from, 1); this.stop(); }
  }

  /** The camera between two views, f in 0..1 (smoothstep, or linear for the slow turn), lifted a little mid-flight on long hops. */
  private place(a: View, b: View, f: number, ease = true) {
    const r = this.rig, e = ease ? f * f * (3 - 2 * f) : f;
    let dy = (b.yaw - a.yaw) % TAU;
    if (dy > Math.PI) dy -= TAU; else if (dy < -Math.PI) dy += TAU;
    const hop = Math.hypot(b.x - a.x, b.z - a.z);
    const lift = ease ? Math.min(40, hop * 0.3) * Math.sin(Math.PI * e) : 0;
    r.target.set(a.x + (b.x - a.x) * e, 0, a.z + (b.z - a.z) * e);
    r.dist = a.dist + (b.dist - a.dist) * e + lift;
    r.yaw = a.yaw + dy * e;
    r.pitch = a.pitch + (b.pitch - a.pitch) * e;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
