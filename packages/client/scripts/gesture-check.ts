// Trackpad / mouse wheel classification and what it does to the camera rig. Run: npx tsx packages/client/scripts/gesture-check.ts
import { CameraRig } from '../src/camera';
import { WheelClassifier, type WheelLike } from '../src/gestures';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  document: { getElementById: () => null },
  window: { addEventListener() {} },
});
const { Input } = await import('../src/input');

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// ---- classifier alone -------------------------------------------------------------------------
type Ev = Partial<WheelLike>;
const ev = (t: number, e: Ev): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, timeStamp: t, ...e });
const run = (c: WheelClassifier, mode: 'auto' | 'trackpad' | 'mouse', evs: WheelLike[]) => evs.map((e) => c.classify(e, mode));

// a swipe: both axes, fractional, 16ms apart, then a momentum tail
const swipe = Array.from({ length: 12 }, (_, i) => ev(1000 + i * 16, { deltaX: 1.5 - i * 0.1, deltaY: 6.25 - i * 0.4 }));
let c = new WheelClassifier();
let k = run(c, 'auto', swipe);
ok(k[0] === 'scroll' && k.every((x) => x === 'scroll'), 'trackpad swipe -> scroll from the first event');
// a vertical-only integer tail right after stays trackpad (hysteresis)
k = run(c, 'auto', [ev(1300, { deltaY: 3 }), ev(1316, { deltaY: 2 }), ev(1332, { deltaY: 1 }), ev(1348, { deltaY: 1 })]);
ok(k.every((x) => x === 'scroll'), 'integer momentum tail keeps scroll');
// pinch
k = run(c, 'auto', [ev(2000, { ctrlKey: true, deltaY: -2.5 })]);
ok(k[0] === 'pinch', 'ctrl+wheel -> pinch');
// the mouse is plugged in: big discrete steps
k = run(c, 'auto', [ev(5000, { deltaY: 100 }), ev(5400, { deltaY: 100 }), ev(5800, { deltaY: -100 })]);
ok(k.every((x) => x === 'wheel'), 'mouse notches flip back to wheel at once');
// fresh classifier: mouse wheel from cold
c = new WheelClassifier();
k = run(c, 'auto', [ev(0, { deltaY: 100 }), ev(500, { deltaY: 100 }), ev(1000, { deltaY: 100 })]);
ok(k.every((x) => x === 'wheel'), 'cold mouse wheel -> wheel');
// Firefox lines
c = new WheelClassifier();
ok(run(c, 'auto', [ev(0, { deltaY: 3, deltaMode: 1 })])[0] === 'wheel', 'line-mode wheel -> wheel');
// ambiguous: slow single integer events fall back to zoom
c = new WheelClassifier();
ok(run(c, 'auto', [ev(0, { deltaY: 4 }), ev(500, { deltaY: 4 }), ev(1000, { deltaY: 8 })]).every((x) => x === 'wheel'), 'ambiguous -> wheel (zoom)');
// a fast-spun Mac mouse: small integers in a stream, no x -> still not a trackpad
c = new WheelClassifier();
ok(run(c, 'auto', Array.from({ length: 20 }, (_, i) => ev(i * 20, { deltaY: 10 + (i % 3) }))).every((x) => x === 'wheel'), 'fast integer stream alone stays wheel');
// shift+mouse wheel in Chrome reports deltaX only
c = new WheelClassifier();
ok(run(c, 'auto', [ev(0, { deltaX: 100, shiftKey: true }), ev(400, { deltaX: 100, shiftKey: true })]).every((x) => x === 'wheel'), 'shift+wheel (deltaX only) -> wheel');
// forced modes
ok(run(new WheelClassifier(), 'mouse', [ev(0, { deltaX: 1.5, deltaY: 6.25 })])[0] === 'wheel', 'mouse mode forces wheel');
ok(run(new WheelClassifier(), 'trackpad', [ev(0, { deltaY: 100 })])[0] === 'scroll', 'trackpad mode forces scroll');
ok(run(new WheelClassifier(), 'mouse', [ev(0, { ctrlKey: true, deltaY: 3 })])[0] === 'pinch', 'ctrl+wheel zooms in every mode');

// ---- Input + rig ------------------------------------------------------------------------------
function make() {
  const handlers = new Map<string, (e: any) => void>();
  const canvas: any = {
    addEventListener: (t: string, f: any) => handlers.set(t, f),
    clientWidth: 1000, clientHeight: 700, style: {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const rig = new CameraRig(1000 / 700);
  rig.update(); rig.camera.updateMatrixWorld();
  const input = new Input(canvas, rig, { onBuild() {}, onBuy() {}, onSelect() {}, onHover() {}, onToolChange() {}, onRotate() {}, onKey() {} });
  let prevented = 0;
  let t = 100;
  const wheel = (e: Ev & { altKey?: boolean; metaKey?: boolean; offsetX?: number; offsetY?: number }, dtMs = 16) => {
    t += dtMs;
    const full = { altKey: false, metaKey: false, offsetX: 500, offsetY: 350, ...ev(t, e), preventDefault: () => { prevented++; } };
    handlers.get('wheel')!(full);
  };
  const settle = () => { for (let i = 0; i < 120; i++) input.update(1 / 60); rig.update(); };
  return { rig, input, wheel, settle, prevented: () => prevented, handlers };
}
const snap = (r: CameraRig) => ({ x: r.target.x, z: r.target.z, yaw: r.yaw, pitch: r.pitch, dist: r.dist });

{ // two-finger scroll pans, nothing else moves
  const m = make(); const a = snap(m.rig);
  for (let i = 0; i < 10; i++) m.wheel({ deltaX: 3.5, deltaY: 8.25 });
  m.settle(); const b = snap(m.rig);
  ok(Math.hypot(b.x - a.x, b.z - a.z) > 1, 'scroll pans the target');
  ok(b.yaw === a.yaw && b.pitch === a.pitch && b.dist === a.dist, 'scroll leaves yaw, pitch and distance alone');
  ok(m.prevented() === 10, 'scroll events are prevented');
  // direction: fingers up (natural scrolling: deltaY > 0) drags content up the screen = the view moves toward the camera, like dragging up
  const m2 = make(); const f0 = m2.rig.forward().clone(); const t0 = m2.rig.target.clone();
  for (let i = 0; i < 10; i++) m2.wheel({ deltaY: 8.25, deltaX: 0.5 });
  m2.settle(); const d = m2.rig.target.clone().sub(t0);
  const drag = make(); drag.rig.panPixels(0, -80, 700);
  ok(d.dot(f0) < 0 && drag.rig.target.clone().sub(t0).dot(f0) < 0, 'deltaY>0 moves the view the way a drag up does');
  // smoothing: the move is eased over frames, not applied in one
  const m3 = make(); m3.wheel({ deltaX: 2.5, deltaY: 40.5 }); m3.input.update(1 / 60);
  const mid = m3.rig.target.length(); m3.settle(); const end = m3.rig.target.length();
  ok(mid > 0 && mid < end * 0.9, 'motion is eased in over several frames');
}
{ // mouse wheel: immediate zoom, exactly as before
  const m = make(); const d0 = m.rig.dist;
  m.wheel({ deltaY: 100 }, 400);
  ok(Math.abs(m.rig.dist - d0 * Math.exp(100 * 0.0015)) < 1e-9, 'mouse wheel zooms immediately by exp(dy*0.0015)');
  ok(m.rig.target.length() === 0, 'mouse wheel does not pan');
  const m2 = make(); m2.wheel({ deltaY: 100 }, 400); m2.wheel({ deltaY: 100, altKey: true }, 400); m2.settle();
  ok(m2.prevented() === 1 && m2.rig.yaw === Math.PI / 4, 'mouse Alt+wheel still does nothing and is not prevented');
  const m3 = make(); m3.wheel({ deltaY: 100, metaKey: true }, 400);
  ok(m3.prevented() === 0 && m3.rig.dist === 48, 'Cmd+wheel is left to the browser');
}
{ // pinch zooms about the cursor; page zoom prevented
  const m = make(); const d0 = m.rig.dist;
  const cx = 800, cy = 450;
  const before = m.rig.groundAt(cx, cy, 1000, 700)!.clone();
  for (let i = 0; i < 8; i++) m.wheel({ ctrlKey: true, deltaY: -4.5, offsetX: cx, offsetY: cy });
  m.settle(); m.rig.camera.updateMatrixWorld();
  const after = m.rig.groundAt(cx, cy, 1000, 700)!;
  ok(m.rig.dist < d0 * 0.8, 'pinch out zooms in');
  ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.05, `the ground point under the cursor holds still (${Math.hypot(after.x - before.x, after.z - before.z).toExponential(1)})`);
  ok(m.prevented() === 8, 'pinch is prevented (no page zoom)');
  const m2 = make(); m2.wheel({ ctrlKey: true, deltaY: 100 }, 500); m2.settle();
  ok(m2.rig.dist > 48, 'Ctrl+mouse wheel zooms too, prevented: ' + m2.prevented());
}
{ // Alt + two-finger scroll orbits and tilts, about the cursor
  const m = make(); const a = snap(m.rig);
  const cx = 300, cy = 400, p = m.rig.groundAt(cx, cy, 1000, 700)!.clone();
  const r0 = Math.hypot(m.rig.target.x - p.x, m.rig.target.z - p.z);
  m.wheel({ deltaX: 2.5, deltaY: 3.5, altKey: true, offsetX: cx, offsetY: cy }); // trackpad-ish so verdict is decided
  for (let i = 0; i < 20; i++) m.wheel({ deltaX: 6.5, deltaY: -4.25, altKey: true, offsetX: cx, offsetY: cy });
  m.settle(); const b = snap(m.rig);
  ok(b.yaw > a.yaw && b.pitch > a.pitch, 'Alt+scroll turns and tilts (right -> yaw up; fingers down -> tilt up)');
  ok(b.dist === a.dist, 'Alt+scroll does not zoom');
  const r1 = Math.hypot(m.rig.target.x - p.x, m.rig.target.z - p.z);
  ok(Math.abs(r1 - r0) < 1e-6 && Math.hypot(b.x - a.x, b.z - a.z) > 1, 'the view orbits the point under the cursor (target swings round it at a fixed radius)');
}
{ // a mouse then a trackpad: the verdict follows, in the same Input
  const m = make();
  m.wheel({ deltaY: 100 }, 400); const d1 = m.rig.dist;
  m.wheel({ deltaX: 1.5, deltaY: 6.25 }, 400); m.wheel({ deltaX: 1.5, deltaY: 6.25 }, 16); const d2 = m.rig.dist; // the verdict takes two events to turn
  for (let i = 0; i < 6; i++) m.wheel({ deltaX: 1.5, deltaY: 6.25 }, 16); m.settle();
  ok(d1 > 48 && m.rig.dist === d2 && m.rig.target.length() > 0, 'switching device mid-session: wheel zooms, then swipe pans');
}
{ // setting
  const m = make();
  store.set('msimcity.padMode', 'trackpad');
  const t = make(); t.wheel({ deltaY: 100 }, 400); t.settle();
  ok(t.rig.dist === 48 && t.rig.target.length() > 0, 'stored "trackpad" mode makes even a big step pan');
  store.set('msimcity.padMode', 'mouse');
  const u = make(); u.wheel({ deltaX: 1.5, deltaY: 6.25 }); 
  ok(u.rig.dist !== 48, 'stored "mouse" mode makes a swipe zoom');
  store.set('msimcity.padMode', 'garbage');
  const v = make(); v.wheel({ deltaX: 1.5, deltaY: 6.25 }); v.settle();
  ok(v.rig.dist === 48 && v.rig.target.length() > 0, 'a bad stored value falls back to auto');
  void m;
}
{ // Safari gestures
  const m = make(); const a = snap(m.rig);
  const g = (type: string, o: any = {}) => m.handlers.get(type)!({ type, preventDefault() {}, clientX: 500, clientY: 350, scale: 1, rotation: 0, ...o });
  g('gesturestart');
  for (let s = 1.05; s < 1.6; s += 0.05) g('gesturechange', { scale: s, rotation: 3 }); // wobble under the dead zone
  m.settle(); const b = snap(m.rig);
  ok(b.dist < a.dist * 0.7 && b.yaw === a.yaw, 'Safari pinch zooms; a small wobble does not orbit');
  g('gestureend');
  g('gesturestart');
  for (let r = 4; r <= 44; r += 4) g('gesturechange', { scale: 1, rotation: r });
  m.settle(); const c2 = snap(m.rig);
  ok(c2.yaw > b.yaw + 0.4 && c2.yaw < b.yaw + 0.8, `Safari twist orbits past the dead zone (${(c2.yaw - b.yaw).toFixed(2)} rad for 36 deg)`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
