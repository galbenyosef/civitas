// Scroll, pinch, drag and key controls and what they do to the camera rig (gestures.ts, input.ts). Run: npx tsx packages/client/scripts/gesture-check.ts
import { CameraRig } from '../src/camera';

interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean; timeStamp: number }

const store = new Map<string, string>();
const winHandlers = new Map<string, (e: any) => void>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  performance: globalThis.performance,
  document: { getElementById: () => null },
  window: { addEventListener: (t: string, f: any) => winHandlers.set(t, f) },
});
const { Input } = await import('../src/input');

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

type Ev = Partial<WheelLike>;
const ev = (t: number, e: Ev): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, timeStamp: t, ...e });

// ---- Input + rig ------------------------------------------------------------------------------
function make(onSelect: () => void = () => {}, extra: Record<string, unknown> = {}) {
  winHandlers.clear();
  const handlers = new Map<string, (e: any) => void>();
  const canvas: any = {
    addEventListener: (t: string, f: any) => handlers.set(t, f),
    clientWidth: 1000, clientHeight: 700, style: {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const rig = new CameraRig(1000 / 700);
  rig.update(); rig.camera.updateMatrixWorld();
  const input = new Input(canvas, rig, { onBuild() {}, onBuy() {}, onSelect, onHover() {}, onToolChange() {}, onRotate() {}, onKey() {}, ...extra });
  let prevented = 0;
  let t = 100;
  const wheel = (e: Ev & { altKey?: boolean; metaKey?: boolean; offsetX?: number; offsetY?: number }, dtMs = 16) => {
    t += dtMs;
    const full = { altKey: false, metaKey: false, offsetX: 500, offsetY: 350, ...ev(t, e), preventDefault: () => { prevented++; } };
    handlers.get('wheel')!(full);
  };
  const settle = () => { for (let i = 0; i < 120; i++) input.update(1 / 60); rig.update(); };
  return { rig, input, wheel, settle, prevented: () => prevented, handlers, win: new Map(winHandlers) };
}
const snap = (r: CameraRig) => ({ x: r.target.x, z: r.target.z, yaw: r.yaw, pitch: r.pitch, dist: r.dist });

{ // scroll zooms about the cursor, the same for every device: a mouse notch, a smooth-scroll mouse, two fingers
  for (const [what, evs] of [
    ['a mouse wheel notch', [{ deltaY: 100 }]],
    ['Firefox line-mode notches', [{ deltaY: 3, deltaMode: 1 }, { deltaY: 3, deltaMode: 1 }]],
    ['a smooth-scrolling Mac mouse', Array.from({ length: 12 }, (_, i) => ({ deltaY: 4.73 + (i % 3) * 1.37 }))],
    ['a two-finger trackpad scroll (with sideways drift)', Array.from({ length: 12 }, (_, i) => ({ deltaX: 1.5 - i * 0.1, deltaY: 6.25 - i * 0.4 }))],
  ] as [string, Ev[]][]) {
    const m = make(); const d0 = m.rig.dist; const cx = 800, cy = 450;
    const before = m.rig.groundAt(cx, cy, 1000, 700)!.clone();
    for (const e of evs) m.wheel({ ...e, offsetX: cx, offsetY: cy });
    m.settle(); m.rig.camera.updateMatrixWorld();
    const after = m.rig.groundAt(cx, cy, 1000, 700)!;
    ok(m.rig.dist > d0 && m.rig.yaw === Math.PI / 4, `${what} zooms out (scroll down)`);
    ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.05, `${what}: the ground point under the cursor holds still`);
    ok(m.prevented() === evs.length, `${what}: no page scroll`);
  }
  const up = make(); up.wheel({ deltaY: -100 }); up.settle();
  ok(up.rig.dist < 48, 'scroll up zooms in');
  const m = make(); m.wheel({ deltaY: 100 }); m.input.update(1 / 60);
  const mid = m.rig.dist; m.settle();
  ok(mid > 48 && mid < m.rig.dist, 'a notch is eased in over a few frames, not one jump');
  ok(Math.abs(m.rig.dist - 48 * Math.exp(100 * 0.0015)) < 1e-3, `a notch zooms by exp(100 * 0.0015), as before (${m.rig.dist.toFixed(4)} vs ${(48 * Math.exp(0.15)).toFixed(4)})`);
  const big = make(); big.wheel({ deltaY: 3000 }); big.settle();
  ok(big.rig.dist <= 48 * Math.exp(150 * 0.0015) + 1e-6, 'one huge event is capped');
}
{ // Shift+scroll pans, nothing else moves
  const m = make(); const a = snap(m.rig);
  for (let i = 0; i < 10; i++) m.wheel({ deltaX: 3.5, deltaY: 8.25, shiftKey: true });
  m.settle(); const b = snap(m.rig);
  ok(Math.hypot(b.x - a.x, b.z - a.z) > 1 && b.yaw === a.yaw && b.pitch === a.pitch && b.dist === a.dist, 'Shift+scroll pans and only pans');
}
{ // the "scroll pans" setting: plain scroll pans, pinch still zooms
  store.set('msimcity.scroll', 'pan');
  const m = make(); const a = snap(m.rig);
  for (let i = 0; i < 10; i++) m.wheel({ deltaX: 3.5, deltaY: 8.25 });
  m.settle(); const b = snap(m.rig);
  ok(Math.hypot(b.x - a.x, b.z - a.z) > 1 && b.dist === a.dist, 'scroll set to pan: two-finger scroll pans');
  for (let i = 0; i < 8; i++) m.wheel({ ctrlKey: true, deltaY: -4.5 });
  m.settle();
  ok(m.rig.dist < a.dist, 'scroll set to pan: pinch still zooms');
  // direction: fingers up (deltaY > 0, natural scrolling) moves the view the way dragging the map up does
  const m2 = make(); const f0 = m2.rig.forward().clone(); const t0 = m2.rig.target.clone();
  for (let i = 0; i < 10; i++) m2.wheel({ deltaY: 8.25 });
  m2.settle();
  const drag = make(); drag.rig.panPixels(0, -80, 700);
  ok(m2.rig.target.clone().sub(t0).dot(f0) < 0 && drag.rig.target.clone().sub(t0).dot(f0) < 0, 'pan direction matches dragging the map');
  store.set('msimcity.scroll', 'zoom');
  store.delete('msimcity.scroll'); store.set('msimcity.padMode', 'trackpad');
  const old = make(); old.wheel({ deltaY: 8 }); old.settle();
  ok(old.rig.dist === 48 && old.rig.target.length() > 0, 'the old "trackpad" setting carries over as pan');
  store.set('msimcity.padMode', 'auto');
  const old2 = make(); old2.wheel({ deltaX: 1.5, deltaY: 6.25 }); old2.settle();
  ok(old2.rig.dist > 48, 'the old "auto" setting becomes zoom');
  store.clear();
}
{ // pinch zooms about the cursor; page zoom prevented
  const m = make(); const d0 = m.rig.dist;
  const cx = 800, cy = 450;
  const before = m.rig.groundAt(cx, cy, 1000, 700)!.clone();
  for (let i = 0; i < 8; i++) m.wheel({ ctrlKey: true, deltaY: -4.5, offsetX: cx, offsetY: cy });
  m.settle(); m.rig.camera.updateMatrixWorld();
  const after = m.rig.groundAt(cx, cy, 1000, 700)!;
  ok(m.rig.dist < d0 * 0.8, 'pinch out zooms in');
  ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.05, 'pinch: the ground point under the cursor holds still');
  ok(m.prevented() === 8, 'pinch is prevented (no page zoom)');
  const m2 = make(); m2.wheel({ ctrlKey: true, deltaY: 100 }); m2.settle();
  ok(m2.rig.dist > 48, 'Ctrl+mouse wheel zooms too');
  const m3 = make(); m3.wheel({ deltaY: 100, metaKey: true });
  ok(m3.prevented() === 0 && m3.rig.dist === 48, 'Cmd+scroll is left to the browser');
}
{ // Alt + scroll orbits and tilts about the cursor
  const m = make(); const a = snap(m.rig);
  const cx = 300, cy = 400, p = m.rig.groundAt(cx, cy, 1000, 700)!.clone();
  const r0 = Math.hypot(m.rig.target.x - p.x, m.rig.target.z - p.z);
  for (let i = 0; i < 20; i++) m.wheel({ deltaX: 6.5, deltaY: -4.25, altKey: true, offsetX: cx, offsetY: cy });
  m.settle(); const b = snap(m.rig);
  ok(b.yaw > a.yaw && b.pitch > a.pitch, 'Alt+scroll turns and tilts');
  ok(b.dist === a.dist, 'Alt+scroll does not zoom');
  const r1 = Math.hypot(m.rig.target.x - p.x, m.rig.target.z - p.z);
  ok(Math.abs(r1 - r0) < 1e-6 && Math.hypot(b.x - a.x, b.z - a.z) > 1, 'the view orbits the point under the cursor');
}
{ // select tool: a click selects on release; a drag grabs the map and pans, and selects nothing
  let selected = 0;
  const m = make(() => { selected++; });
  const pd = (type: string, x: number, y: number, o: any = {}) => m.handlers.get(type)!({ type, button: 0, clientX: x, clientY: y, offsetX: x, offsetY: y, movementX: 0, movementY: 0, altKey: false, shiftKey: false, pointerId: 1, ...o });
  pd('pointerdown', 500, 350); pd('pointermove', 502, 351, { movementX: 2, movementY: 1 }); pd('pointerup', 502, 351);
  ok(selected === 1 && m.rig.target.length() === 0, 'a click (under the slop) selects and does not pan');
  pd('pointerdown', 500, 350);
  for (let i = 1; i <= 10; i++) pd('pointermove', 500, 350 - i * 8, { movementY: -8 });
  pd('pointerup', 500, 270);
  ok(selected === 1 && m.rig.target.length() > 1, 'a drag pans the map and selects nothing');
  pd('pointerdown', 500, 350); pd('pointercancel', 500, 350);
  ok(selected === 1, 'a cancelled press selects nothing');
}
{ // keys: + and - zoom
  const m = make();
  const kd = (code: string) => m.win.get('keydown')!({ code, key: code, target: null, repeat: false, metaKey: false, ctrlKey: false, altKey: false });
  const ku = (code: string) => m.win.get('keyup')!({ code });
  kd('Equal'); for (let i = 0; i < 30; i++) m.input.update(1 / 60); ku('Equal'); m.settle();
  const zin = m.rig.dist;
  kd('Minus'); for (let i = 0; i < 60; i++) m.input.update(1 / 60); ku('Minus'); m.settle();
  ok(zin < 48 && m.rig.dist > zin, '+ zooms in, - zooms out');
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
{ // the road tool (docs/roads.md "The road tool"): one drag, sent on release, straight or one corner, Shift held for a loop, Esc to let go, Ctrl/Cmd+Z to undo
  const roads: { tiles: [number, number][]; shape: string }[] = [];
  let built = 0, undos = 0;
  const road = new Set(['7,0']);
  const m = make(() => {}, {
    onBuild: () => { built++; }, onRoad: (tiles: [number, number][], shape: string) => roads.push({ tiles, shape }), onUndoRoad: () => { undos++; },
    isRoad: (x: number, y: number) => road.has(`${x},${y}`), isWater: () => false,
  });
  // a tile every 10 pixels, so the drags read in tiles
  (m.input as any).tileAt = (px: number, py: number) => [Math.floor(px / 10), Math.floor(py / 10)];
  const pd = (type: string, tx: number, ty: number, o: any = {}) => m.handlers.get(type)!({ type, button: 0, clientX: tx * 10 + 5, clientY: ty * 10 + 5, offsetX: tx * 10 + 5, offsetY: ty * 10 + 5, movementX: 0, movementY: 0, altKey: false, shiftKey: false, pointerId: 1, ...o });
  const key = (type: 'keydown' | 'keyup', k: string, o: any = {}) => m.win.get(type)!({ code: k === 'Shift' ? 'ShiftLeft' : k === 'Escape' ? 'Escape' : `Key${k.toUpperCase()}`, key: k, target: null, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: k === 'Shift', preventDefault() {}, ...o });
  const tiles = (p: [number, number][] | null | undefined) => (p ?? []).map(([x, y]) => `${x},${y}`).join(' ');
  key('keydown', '3');
  ok(m.input.tool === 'road', '3 picks the road tool');
  pd('pointerdown', 20, 20); pd('pointermove', 23, 20); pd('pointermove', 25, 23);
  ok(roads.length === 0 && built === 0, 'nothing is sent while the road is dragged');
  ok(tiles(m.input.roadPath) === '20,20 21,20 22,20 23,20 24,20 25,20 25,21 25,22 25,23', `an L, along the way the drag first went (${tiles(m.input.roadPath)})`);
  pd('pointerup', 25, 23);
  ok(roads.length === 1 && roads[0].tiles.length === 9 && roads[0].shape === 'line' && !m.input.roadPath, 'let go: the whole drag goes in one message');
  pd('pointerdown', 20, 20); pd('pointermove', 20, 22); pd('pointermove', 25, 23);
  ok(tiles(m.input.roadPath).startsWith('20,20 20,21 20,22 20,23 21,23'), 'first down, then across: the corner follows the drag');
  key('keydown', 'Shift');
  ok(m.input.roadShape === 'loop' && m.input.roadPath!.length === 2 * (5 + 3), `Shift held during the drag: a loop round the rectangle (${m.input.roadPath!.length} tiles)`);
  key('keyup', 'Shift');
  ok(m.input.roadShape === 'line' && m.input.roadPath!.length === 9, 'Shift let go: a line again');
  key('keydown', 'Escape', { code: 'Escape' });
  pd('pointerup', 25, 23);
  ok(roads.length === 1 && m.input.tool === 'road', 'Esc mid-drag lets go of the road and keeps the tool');
  pd('pointerdown', 0, 0); pd('pointermove', 5, 0); pd('pointerup', 5, 0);
  ok(tiles(roads[1]?.tiles) === '0,0 1,0 2,0 3,0 4,0 5,0 6,0', 'stopping one tile short of a road snaps on to meet it');
  pd('pointerdown', 0, 0, { shiftKey: true }); pd('pointermove', 5, 0, { shiftKey: true }); pd('pointerup', 5, 0);
  ok(roads.length === 2, 'Shift at the press still pans, as with any tool: no road');
  key('keydown', 'z', { ctrlKey: true, code: 'KeyZ' });
  key('keydown', 'z', { metaKey: true, code: 'KeyZ' });
  ok(undos === 2, 'Ctrl+Z and Cmd+Z with the road tool: undo the last drag');
  key('keydown', 'Escape', { code: 'Escape' });
  ok(m.input.tool === 'select', 'Esc with no drag: back to select');
  key('keydown', 'z', { ctrlKey: true, code: 'KeyZ' });
  ok(undos === 2, 'Ctrl+Z with another tool: nothing');
}
{ // road classes (docs/roads.md "Classes"): 3 opens the road tool's class picker (the ladder hook, ui.ts), a drag's tiles go in drag order (a one-way street goes the way it was dragged), and a drag along a road sends every tile (an upgrade in place)
  const roads: [number, number][][] = [];
  const keyed: string[] = [];
  const road = new Set(Array.from({ length: 10 }, (_, x) => `${x},5`));
  const m = make(() => {}, {
    ladderKey: (t: string) => { keyed.push(t); return t; }, onRoad: (tiles: [number, number][]) => roads.push(tiles),
    isRoad: (x: number, y: number) => road.has(`${x},${y}`), isWater: () => false,
  });
  (m.input as any).tileAt = (px: number, py: number) => [Math.floor(px / 10), Math.floor(py / 10)];
  const pd = (type: string, tx: number, ty: number) => m.handlers.get(type)!({ type, button: 0, clientX: tx * 10 + 5, clientY: ty * 10 + 5, offsetX: tx * 10 + 5, offsetY: ty * 10 + 5, movementX: 0, movementY: 0, altKey: false, shiftKey: false, pointerId: 1 });
  m.win.get('keydown')!({ code: 'Digit3', key: '3', target: null, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {} });
  ok(m.input.tool === 'road' && keyed.includes('road'), '3: the road tool, through the ladder hook that opens its class picker on the class last picked');
  pd('pointerdown', 9, 0); pd('pointermove', 2, 0); pd('pointerup', 2, 0);
  ok(roads[0]?.[0]?.join() === '9,0' && roads[0]?.at(-1)?.join() === '2,0', 'a drag from east to west sends its tiles east first: a one-way street laid by it goes west');
  pd('pointerdown', 0, 5); pd('pointermove', 9, 5); pd('pointerup', 9, 5);
  ok(roads[1]?.length === 10 && roads[1].every(([, y]) => y === 5), 'a drag along a road sends every tile of it: the server upgrades them in place');
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
