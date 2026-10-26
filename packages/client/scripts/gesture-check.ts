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
const { bindReadoutKey } = await import('../src/audio/controls');

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
{ // Shift+S opens the audio readout and does not pan the camera; S alone still pans back (docs/audio.md "Readout")
  const m = make();
  const down = (o: Record<string, unknown>) => ({ code: 'KeyS', key: 'S', target: null, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...o });
  // the readout's listener is in the capture phase on window, so it runs before the Input's and can stop the press reaching it
  let toggled = 0; let capture: ((e: any) => void) | null = null;
  bindReadoutKey({ addEventListener: (_t: 'keydown', f: (e: any) => void, c?: boolean) => { if (c) capture = f; } }, () => toggled++);
  const dispatch = (o: Record<string, unknown>) => { let stopped = false; const e = { ...down(o), stopPropagation() { stopped = true; } }; capture!(e); if (!stopped) m.win.get('keydown')!(e); };
  const before = snap(m.rig);
  dispatch({ shiftKey: true }); for (let i = 0; i < 90; i++) m.input.update(1 / 60); m.win.get('keyup')!({ code: 'KeyS' }); m.settle();
  const after = snap(m.rig);
  ok(toggled === 1 && Math.hypot(after.x - before.x, after.z - before.z) < 1e-6, 'Shift+S toggles the audio readout and the camera does not move');
  dispatch({}); for (let i = 0; i < 90; i++) m.input.update(1 / 60); m.win.get('keyup')!({ code: 'KeyS' }); m.settle();
  const panned = snap(m.rig);
  ok(toggled === 1 && Math.hypot(panned.x - after.x, panned.z - after.z) > 0.5, 'S alone still pans the camera back and leaves the readout shut');
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
{ // the junction tools (R4, docs/roads.md "Junctions"): one click builds one junction or sets one sign; a drag paints nothing more; Esc keeps the scheme
  const built: [string, [number, number][]][] = [];
  const m = make(() => {}, { onBuild: (tool: string, tiles: [number, number][]) => built.push([tool, tiles]) });
  (m.input as any).tileAt = (px: number, py: number) => [Math.floor(px / 10), Math.floor(py / 10)];
  const pd = (type: string, tx: number, ty: number, extra: Record<string, unknown> = {}) => m.handlers.get(type)!({ type, button: 0, clientX: tx * 10 + 5, clientY: ty * 10 + 5, offsetX: tx * 10 + 5, offsetY: ty * 10 + 5, movementX: 0, movementY: 0, altKey: false, shiftKey: false, pointerId: 1, ...extra });
  for (const tool of ['roundabout', 'miniroundabout', 'flyover', 'interchange', 'turnrule', 'pelican'] as const) {
    built.length = 0;
    m.input.setTool(tool);
    pd('pointerdown', 4, 4); pd('pointermove', 5, 4); pd('pointermove', 8, 4); pd('pointerup', 8, 4);
    ok(built.length === 1 && built[0][0] === tool && built[0][1].length === 1 && built[0][1][0].join() === '4,4', `${tool}: a click sends the one tile clicked, a drag after it nothing more (${built.length} message(s))`);
    pd('pointerdown', 4, 4, { shiftKey: true }); pd('pointermove', 6, 4, { shiftKey: true }); pd('pointerup', 6, 4);
    ok(built.length === 1, `${tool}: Shift at the press pans, as with every tool`);
  }
  m.win.get('keydown')!({ code: 'Escape', key: 'Escape', target: null, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {} });
  ok(m.input.tool === 'select', 'Esc with a junction tool: back to select');
}
{ // the Street rules tool (R5, docs/roads.md "Traffic control"): a click sets the whole street (one message, street), a straight drag part of one; Ctrl/Cmd+Z undoes; Shift at the press pans; Esc lets go, then back to select
  const sent: { tiles: [number, number][]; street: boolean; ns: boolean }[] = [];
  let built = 0, undos = 0;
  const m = make(() => {}, { onBuild: () => { built++; }, onStreetRule: (tiles: [number, number][], street: boolean, ns: boolean) => sent.push({ tiles, street, ns }), onUndoStreetRule: () => { undos++; } });
  (m.input as any).tileAt = (px: number, py: number) => [Math.floor(px / 10), Math.floor(py / 10)];
  const pd = (type: string, tx: number, ty: number, o: any = {}) => m.handlers.get(type)!({ type, button: 0, clientX: tx * 10 + 5, clientY: ty * 10 + 5, offsetX: tx * 10 + 5, offsetY: ty * 10 + 5, movementX: 0, movementY: 0, altKey: false, shiftKey: false, pointerId: 1, ...o });
  const key = (k: string, o: any = {}) => m.win.get('keydown')!({ code: k === 'Escape' ? 'Escape' : `Key${k.toUpperCase()}`, key: k, target: null, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...o });
  m.input.setTool('streetrule');
  pd('pointerdown', 4, 4); pd('pointerup', 4, 4);
  ok(sent.length === 1 && sent[0].street && sent[0].tiles.length === 1 && sent[0].tiles[0].join() === '4,4' && built === 0, 'street rules: a click sends the tile, as a whole street (the handler takes the street through it)');
  pd('pointerdown', 4, 4); pd('pointermove', 6, 4); pd('pointermove', 9, 5);
  ok(sent.length === 1 && m.input.streetPath?.length === 6 && m.input.streetPath.every(([, y]) => y === 4), `nothing sent while dragging; the drag is a straight line along its longer axis (${m.input.streetPath?.length} tiles)`);
  pd('pointerup', 9, 5);
  ok(sent.length === 2 && !sent[1].street && sent[1].tiles.length === 6 && !sent[1].ns && !m.input.streetPath, 'let go: the dragged tiles go in one message, part of a street');
  pd('pointerdown', 4, 4); pd('pointermove', 4, 8); pd('pointerup', 4, 8);
  ok(sent[2]?.ns === true && sent[2].tiles.length === 5, 'a north-south drag says so');
  pd('pointerdown', 4, 4, { shiftKey: true }); pd('pointermove', 7, 4, { shiftKey: true }); pd('pointerup', 7, 4);
  ok(sent.length === 3, 'Shift at the press pans, as with every tool');
  key('z', { ctrlKey: true }); key('z', { metaKey: true });
  ok(undos === 2, 'Ctrl+Z and Cmd+Z with the Street rules tool: undo the last rule');
  pd('pointerdown', 4, 4); pd('pointermove', 7, 4); key('Escape');
  ok(!m.input.streetPath && m.input.tool === 'streetrule', 'Esc mid-drag lets go and keeps the tool');
  pd('pointerup', 7, 4);
  ok(sent.length === 3, 'and the release after it sends nothing');
  key('Escape');
  ok(m.input.tool === 'select', 'Esc again: back to select');
}
{ // the Traffic panel (R5, client/src/trafficpanel.ts): asks the server only while open, every few seconds; a junction or street is a link to the camera; the visitor limit switch
  const els: any[] = [];
  const el = (): any => { const e: any = { children: [] as any[], listeners: new Map<string, any>(), cls: new Set<string>(), style: {}, innerHTML: '', id: '', className: '',
    classList: { add: (c: string) => e.cls.add(c), remove: (c: string) => e.cls.delete(c), toggle: (c: string, on?: boolean) => { const v = on ?? !e.cls.has(c); if (v) e.cls.add(c); else e.cls.delete(c); return v; }, contains: (c: string) => e.cls.has(c) },
    setAttribute() {}, appendChild: (c: any) => { e.children.push(c); return c; }, addEventListener: (t: string, f: any) => e.listeners.set(t, f) }; els.push(e); return e; };
  const ui = el();
  const timers: (() => void)[] = [];
  const saved = { document: (globalThis as any).document, window: (globalThis as any).window };
  Object.assign(globalThis, {
    document: { getElementById: (id: string) => (id === 'ui' ? ui : null), createElement: () => el(), head: el() },
    window: { ...saved.window, setInterval: (f: () => void) => { timers.push(f); return timers.length; } },
    clearInterval: (n: number) => { if (n) timers[n - 1] = () => {}; },
  });
  const { TrafficPanel } = await import('../src/trafficpanel');
  let asks = 0;
  const jumps: string[] = [], limits: string[] = [];
  const p = new TrafficPanel({ ask: () => { asks++; }, jump: (x, y) => jumps.push(`${x},${y}`), limit: (x, y, on) => limits.push(`${x},${y},${on}`) });
  ok(asks === 0 && !p.open, 'Traffic panel: closed, nothing asked');
  p.toggle(true);
  ok(asks === 1 && !p.el.cls.has('hidden') && timers.length === 1, 'opened: it asks at once and sets a poll');
  timers[0]();
  ok(asks === 2, 'the poll asks again');
  const info = { onRoad: { residents: 10, visitors: 6, freight: 4, buses: 1, services: 2 }, lastHour: { visitors: 12, freight: 5 }, giveUps: { residents: 1, visitors: 2, freight: 3, other: 0 },
    gateways: [{ x: -58, y: -20, name: 'Motorway connection', type: 'motorway', perHour: 12, arrivalsToday: 3, visitorsToday: 40, visitorsYesterday: 55, limit: false, mine: true, limitCost: 13.75 }],
    junctions: [{ x: 3, y: 4, name: 'Mill Lane / Station Road', giveUps: 9 }], streets: [{ x: 7, y: 8, name: 'Mill Lane', queued: 6, freightOrVisitors: 4 }] };
  p.show(info);
  ok(/23 on the road now · 43% visitors and lorries/.test(p.el.innerHTML) && /Mill Lane \/ Station Road/.test(p.el.innerHTML) && /Limit visitors · about \$13\.75\/day/.test(p.el.innerHTML), 'it shows the cars by kind, the junctions, the gateway with its limit switch');
  const click = (attrs: Record<string, string>) => p.el.listeners.get('click')({ target: { closest: (sel: string) => (sel === '.x' ? null : Object.keys(attrs).some((k) => sel === `[data-${k}]`) ? { dataset: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.replace(/-(\w)/g, (_, c) => c.toUpperCase()), v])) } : null) } });
  click({ jx: '3', jy: '4' });
  ok(jumps[0] === '3,4', 'a junction is a link: the camera goes there');
  click({ lim: '1', gx: '-58', gy: '-20' });
  ok(limits[0] === '-58,-20,true', 'the switch sends the visitor limit for that gateway');
  p.toggle(false);
  const before = asks; timers[0]();
  ok(asks === before && p.el.cls.has('hidden'), 'closed: the poll stops');
  Object.assign(globalThis, saved);
}
{ // picking by building column (pick.ts, camera.ts tileAt): a click on a tall building lands on the building, not on the ground behind it
  const { columnHeights, pickColumn } = await import('../src/pick');
  const { packTile, partAux, anchorAux, familyOf } = await import('@msimcity/shared');
  const { Vector3 } = await import('three');
  const rig = new CameraRig(1000 / 700);
  rig.target.set(10.5, 0, 10.5); rig.yaw = 0; rig.pitch = 0.95; rig.dist = 22; // from the south, looking north
  rig.update(); rig.camera.updateMatrixWorld();
  const px = (x: number, y: number, z: number) => { const v = new Vector3(x, y, z).project(rig.camera); return [(v.x + 1) * 500, (1 - v.y) * 350] as const; };
  // a 3-level building (3 high) on tile (10, 12), two tiles in front of the empty ground at (10, 10); the camera is to the south (+z)
  const col = { heightAt: (x: number, y: number) => (x === 10 && y === 12 ? 3 : 0), maxH: 3.2 };
  const at = (p: readonly [number, number], c: typeof col | null) => rig.tileAt(p[0], p[1], 1000, 700, c);
  const wall = px(10.5, 2.5, 13.0); // the upper floors of the wall facing the camera
  const plane = at(wall, null)!;
  ok(plane[1] < 12, `the ground plane alone puts a click on the upper floors on the tile behind (${plane.join(',')}): the old bug`);
  ok(at(wall, col)!.join() === '10,12', `a ray through the upper floors picks the building (${at(wall, col)!.join()})`);
  const roof = px(10.5, 3.0, 12.5);
  ok(at(roof, col)!.join() === '10,12', `a click on the roof picks the building (${at(roof, col)!.join()})`);
  const above = px(10.5, 4.5, 12.5); // well over the roof: the sky side
  ok(at(above, col)!.join() === at(above, null)!.join() && at(above, col)!.join() !== '10,12', `a ray well over the roof falls to the ground behind (${at(above, col)!.join()})`);
  const edge = px(10.5, 3.06, 12.0); // a couple of pixels over the far roof edge: still the building
  ok(at(edge, col)!.join() === '10,12', `a click a pixel or two over the roof edge still prefers the building (${at(edge, col)!.join()})`);
  const bare = px(14.5, 0, 14.5);
  ok(at(bare, col)!.join() === '14,14' && at(bare, null)!.join() === '14,14', `a ray onto bare ground picks the ground tile (${at(bare, col)!.join()})`);
  const side = px(13.5, 0, 12.5); // beside the building on the ground, nothing in the way
  ok(at(side, col)!.join() === '13,12', 'a ray beside the building, onto ground, is not captured by it');
  const front = px(10.5, 0, 14.5); // ground in front of the building (nearer the camera)
  ok(at(front, col)!.join() === '10,14', 'ground in front of the building is the ground tile');
  const lo = new CameraRig(1000 / 700); lo.pitch = 0.3; lo.dist = 22; lo.update(); lo.camera.updateMatrixWorld();
  ok(lo.tileAt(500, 0, 1000, 700, col) === null && lo.tileAt(500, 700, 1000, 700, col) !== null, 'above the horizon, no tile; below it, a tile');
  ok(pickColumn(0, 10, 0, 0, 1, 0, col) === null && pickColumn(0, 10, 0, 1, 0, 0, col) === null, 'a ray that does not come down picks nothing');
  // a tall tower far from the cursor's ground point is still hit by the walk (a skyscraper in front of a long view)
  const tower = { heightAt: (x: number, y: number) => (x === 10 && y === 16 ? 9 : 0), maxH: 9.5 };
  const hi = px(10.5, 6, 16.9);
  ok(at(hi, tower)!.join() === '10,16', `a 9-tall tower is hit high on its wall (${at(hi, tower)!.join()}; the ground says ${at(hi, null)!.join()})`);

  // heights from the world's tiles: single tiles, a multi-tile structure's part, a site rising, roads, bare land, unloaded
  const tiles = new Map<string, number>(), aux = new Map<string, number>(), sub = new Map<string, number>();
  const k = (x: number, y: number) => `${x},${y}`;
  const kind = 2, depot = 16; // any family will do for a single tile (the fake variant ignores it); the bus depot is a 2×1 structure
  tiles.set(k(0, 0), packTile(0, false, kind, 3));        // a built tile
  tiles.set(k(2, 0), packTile(0, false, familyOf(depot), 2)); aux.set(k(2, 0), anchorAux(0)); sub.set(k(2, 0), depot); // a structure's anchor ...
  tiles.set(k(3, 0), packTile(0, false, familyOf(depot), 2)); aux.set(k(3, 0), partAux(1, 0)); sub.set(k(3, 0), depot); // ... and its part tile east of it
  tiles.set(k(5, 0), packTile(0, true, 0, 0));            // a road
  tiles.set(k(6, 0), packTile(0, false, 0, 0));           // bare land
  const world = { getTile: (x: number, y: number) => tiles.get(k(x, y)), auxAt: (x: number, y: number) => aux.get(k(x, y)) ?? 0, subAt: (x: number, y: number) => sub.get(k(x, y)) ?? 0 };
  const seen: number[] = [];
  const h = columnHeights(world, (kd, level, pick) => { seen.push(level); return { height: level * 0.5 + pick * 0 }; });
  ok(h(0, 0) > 1.4 && h(0, 0) < 1.65, `a single tile's column is its design's height, a little jittered (${h(0, 0).toFixed(2)} for 1.5)`);
  ok(h(5, 0) === 0 && h(6, 0) === 0 && h(40, 40) === 0, 'a road, bare land and an unloaded tile have no column');
  ok(h(3, 0) === h(2, 0) && h(2, 0) === 1, `a part tile of a structure is the anchor's column, unscaled (${h(3, 0)}, ${h(2, 0)})`);
  const seen2 = seen.length;
  ok(seen2 > 0, 'the variant is asked only for built tiles');

  { // Input: select and hover read the column; the road tool's drag reads the ground (a drag over a building must not hop to its roof)
    const hovered: ([number, number] | null)[] = [], picked: [number, number][] = [];
    const m = make((() => {}) as any, { onHover: (t: [number, number] | null) => hovered.push(t), onSelect: (x: number, y: number) => picked.push([x, y]), onRoad: () => {} });
    m.rig.target.set(10.5, 0, 10.5); m.rig.yaw = 0; m.rig.pitch = 0.95; m.rig.dist = 22; m.rig.update(); m.rig.camera.updateMatrixWorld();
    m.input.column = col;
    const w = px(10.5, 2.5, 13.0);
    const pd = (type: string, o: any = {}) => m.handlers.get(type)!({ type, button: 0, clientX: w[0], clientY: w[1], offsetX: w[0], offsetY: w[1], movementX: 0, movementY: 0, altKey: false, shiftKey: false, pointerId: 1, ...o });
    pd('pointermove');
    ok(hovered.at(-1)?.join() === '10,12', `hover over the upper floors reports the building's tile (${hovered.at(-1)?.join()})`);
    pd('pointerdown'); pd('pointerup');
    ok(picked.at(-1)?.join() === '10,12', `a select click there opens the building's tile (${picked.at(-1)?.join()})`);
    m.input.setTool('road');
    pd('pointerdown');
    ok(m.input.roadPath?.[0].join() === plane.join(), `the road tool starts on the ground tile behind it, not the building (${m.input.roadPath?.[0].join()})`);
    pd('pointermove', { offsetX: w[0] + 1, clientX: w[0] + 1 });
    ok(m.input.roadPath!.at(-1)!.join() === plane.join() || m.input.roadPath!.at(-1)!.join() === rig.tileAt(w[0] + 1, w[1], 1000, 700, null)!.join(), `dragging the road over the building still reads ground tiles (${m.input.roadPath!.at(-1)!.join()})`);
    pd('pointerup');
  }
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
