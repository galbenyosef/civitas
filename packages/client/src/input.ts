import { MAX_PARCEL_EDGE, MANIFEST, KIND_TOOLS, isMultiTile, trackDragPath, BRIDGE_MAX_SPAN, type KindToolId } from '@msimcity/shared';
import type { CameraRig } from './camera';
import { Vector3 } from 'three';
import { WheelClassifier, pinchFactor, type PadMode } from './gestures';

const PAD_KEY = 'msimcity.padMode';
/** What two-finger scroll does: 'auto' tells a trackpad from a mouse wheel by the events (gestures.ts), the others force it. */
function readPadMode(): PadMode {
  try { const v = localStorage.getItem(PAD_KEY); if (v === 'auto' || v === 'trackpad' || v === 'mouse') return v; } catch { /* storage blocked: auto */ }
  return 'auto';
}
/** Safari's trackpad pinch/rotate (GestureEvent is not in lib.dom) */
interface GestureLike extends UIEvent { scale: number; rotation: number; clientX: number; clientY: number }

export type ToolId = 'select' | 'buy' | 'road' | 'bulldoze' | 'runway' | 'rail' | 'roundabout' | 'flyover' | KindToolId;
/** `?dev` in the URL shows draft kinds (catalogue `draft: true`) in the tool bar and on their keys. */
export const DEV_TOOLS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');
/** Kinds whose tool shows: every catalogue kind with a tool, drafts only with ?dev. */
export const TOOL_KINDS = MANIFEST.filter((k) => k.tool && (!k.draft || DEV_TOOLS));
/** Shortcut keys: the fixed tools plus one per catalogue kind with a tool (buildings/*.ts). */
export const TOOL_KEYS: Record<string, ToolId> = {
  '1': 'select', '2': 'buy', '3': 'road', 'x': 'bulldoze', 'u': 'runway',
  ...Object.fromEntries(TOOL_KINDS.map((k) => [k.tool!.key.toLowerCase(), k.tool!.id as KindToolId])),
};
/** The multi-tile kind a tool places (its footprint follows the cursor and it is placed by a click, not a drag), or 0. */
export function structureTool(tool: string): number {
  const k = (KIND_TOOLS as Record<string, number>)[tool];
  return k !== undefined && isMultiTile(k) ? k : 0;
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface InputCallbacks {
  onBuild(tool: ToolId, tiles: [number, number][]): void;
  onBuy(r: Rect): void;
  onSelect(x: number, y: number, px: number, py: number): void;
  onHover(tile: [number, number] | null): void;
  onToolChange(tool: ToolId): void;
  /** Z (dir +1, anticlockwise) or C (dir -1, clockwise) while a multi-tile tool is active; the handler works out where the turn starts from */
  onRotate(tool: ToolId, dir: 1 | -1): void;
  /** a right-click: the button went down and up without a drag (a drag pans); px/py are canvas pixels, cx/cy client pixels */
  onContext?(px: number, py: number, cx: number, cy: number): void;
  /** keys that are not tools or camera (e.g. overlays, panels) */
  onKey(code: string): void;
  /** a shortcut key of a size ladder (client/src/picker.ts): the size to select instead (the last one used), or undefined */
  ladderKey?(tool: ToolId): ToolId | undefined;
  /** whether a tile is water (the road tool bridges it: see Input.crossing); unloaded tiles count as dry */
  isWater?(x: number, y: number): boolean;
}

/**
 * A road drag out over water (shared/src/bridges.ts): `from` is the last dry tile before it, (dx, dy) the way the
 * bridge goes. Nothing is sent while the cursor is over the water; once it reaches dry land on the far side, in line,
 * the whole straight run and the far bank go in one message. Released over the water, or turned back, nothing is built.
 */
export interface Crossing { from: [number, number]; dx: number; dy: number }

/** Mouse/keyboard handling: camera control, painting tools and land selection. */
export class Input {
  tool: ToolId = 'select';
  hover: [number, number] | null = null;
  buyRect: Rect | null = null;
  /** the runway being dragged: a straight line of tiles from where the drag started, along its longer axis */
  runwayLine: [number, number][] | null = null;
  private runwayStart: [number, number] | null = null;
  /** railway track being dragged (shared/src/rail.ts trackDragPath): along the longer axis from the start, then the other, so a drag can turn one corner */
  railPath: [number, number][] | null = null;
  private railStart: [number, number] | null = null;
  private keys = new Set<string>();
  /** orientation chosen with Z/C per multi-tile tool (0-3, FRONT order in shared/src/structures.ts); a tool absent here places with automatic facing */
  private rotations = new Map<string, number>();
  private panning = false;
  /** where the right button went down, until the pointer has travelled far enough for it to be a pan rather than a click */
  private rightDown: { x: number; y: number; moved: boolean } | null = null;
  private orbiting = false;
  private pivot = new Vector3();
  painting = false;
  /** a road drag out over the water, until it reaches the far bank */
  crossing: Crossing | null = null;
  private lastDry: [number, number] | null = null;
  private painted = new Set<string>();
  private lastPaint: [number, number] | null = null;
  private buyStart: [number, number] | null = null;
  private tmp = new Vector3();
  /** trackpad input (two-finger scroll, pinch, rotate) is gathered here and eased into the rig a frame at a time in update() */
  private pend = { panX: 0, panY: 0, yaw: 0, pitch: 0, zoom: 0 };
  private zoomAt: { x: number; y: number } | null = null;
  private gPivot = new Vector3();
  private gPivotAt = -1e9;
  private pad: PadMode = readPadMode();
  private cls = new WheelClassifier();
  /** a Safari gesture in progress: the last scale/rotation seen, and whether the rotation has passed its dead zone */
  private gest: { scale: number; rot: number; armed: boolean } | null = null;

  constructor(private canvas: HTMLCanvasElement, private rig: CameraRig, private cb: InputCallbacks) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) canvas.addEventListener(t, this.gesture as EventListener, { passive: false });
    const sel = document.getElementById('padMode') as HTMLSelectElement | null;
    if (sel) {
      sel.value = this.pad;
      sel.addEventListener('change', () => {
        this.pad = sel.value as PadMode;
        try { localStorage.setItem(PAD_KEY, this.pad); } catch { /* not remembered */ }
        sel.blur(); // a focused select swallows the camera keys
      });
    }
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // middle button: stop browser autoscroll / paste so it can drive the orbit
    canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** The orientation the player chose for a multi-tile tool, or undefined while it still faces the road automatically. */
  rotationOf(tool: string): number | undefined { return this.rotations.get(tool); }
  setRotation(tool: string, r: number) { this.rotations.set(tool, r & 3); }

  setTool(t: ToolId) {
    if (this.tool === t) return;
    this.tool = t;
    this.buyStart = null; this.buyRect = null; this.painting = false;
    this.runwayStart = null; this.runwayLine = null;
    this.railStart = null; this.railPath = null;
    this.crossing = null; this.lastDry = null;
    this.cb.onToolChange(t);
  }

  tileAt(px: number, py: number): [number, number] | null {
    const hit = this.rig.groundAt(px, py, this.canvas.clientWidth, this.canvas.clientHeight, this.tmp);
    return hit ? [Math.floor(hit.x), Math.floor(hit.z)] : null;
  }

  /** Continuous keyboard camera movement; call once per frame. */
  update(dt: number) {
    const k = this.keys;
    const speed = this.rig.dist * 1.1 * dt;
    if (k.has('KeyW') || k.has('ArrowUp')) this.rig.target.addScaledVector(this.rig.forward(), speed);
    if (k.has('KeyS') || k.has('ArrowDown')) this.rig.target.addScaledVector(this.rig.forward(), -speed);
    if (k.has('KeyA') || k.has('ArrowLeft')) this.rig.target.addScaledVector(this.rig.right(), -speed);
    if (k.has('KeyD') || k.has('ArrowRight')) this.rig.target.addScaledVector(this.rig.right(), speed);
    if (k.has('KeyQ')) this.rig.rotate(1.6 * dt);
    if (k.has('KeyE')) this.rig.rotate(-1.6 * dt);
    if (k.has('KeyR')) this.rig.rotate(0, 1.2 * dt);
    if (k.has('KeyF')) this.rig.rotate(0, -1.2 * dt);
    this.drain(dt);
  }

  /** Ease the gathered trackpad motion into the camera: a short time constant, so it follows the fingers without the steps of coarse events. */
  private drain(dt: number) {
    const p = this.pend;
    if (!(p.panX || p.panY || p.yaw || p.pitch || p.zoom)) return;
    const f = 1 - Math.exp(-Math.min(dt, 0.25) * 30);
    const take = (v: number) => (Math.abs(v) < 1e-4 ? v : v * f);
    const h = this.canvas.clientHeight;
    const px = take(p.panX), py = take(p.panY);
    if (px || py) { this.rig.panPixels(px, py, h); p.panX -= px; p.panY -= py; }
    const yaw = take(p.yaw), pitch = take(p.pitch);
    if (yaw || pitch) { this.rig.orbitAround(this.gPivot, yaw, pitch); p.yaw -= yaw; p.pitch -= pitch; }
    const z = take(p.zoom);
    if (z) {
      if (this.zoomAt) this.rig.zoomAt(Math.exp(z), this.zoomAt.x, this.zoomAt.y, this.canvas.clientWidth, h);
      else this.rig.zoom(Math.exp(z));
      p.zoom -= z;
    }
    if (Math.abs(p.panX) < 0.01) p.panX = 0;
    if (Math.abs(p.panY) < 0.01) p.panY = 0;
    if (Math.abs(p.yaw) < 1e-5) p.yaw = 0;
    if (Math.abs(p.pitch) < 1e-5) p.pitch = 0;
    if (Math.abs(p.zoom) < 1e-4) p.zoom = 0;
  }

  private down = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // orbit around the ground point under the cursor; fall back to the view centre over the sky
      const hit = this.rig.groundAt(e.offsetX, e.offsetY, this.canvas.clientWidth, this.canvas.clientHeight, this.pivot);
      if (!hit) this.pivot.copy(this.rig.target);
      this.orbiting = true; this.canvas.style.cursor = 'grabbing'; return;
    }
    if (e.button === 2) { this.panning = true; this.rightDown = { x: e.clientX, y: e.clientY, moved: false }; return; }
    if (e.button === 0 && e.shiftKey) { this.panning = true; return; }
    if (e.button !== 0) return;
    const tile = this.tileAt(e.offsetX, e.offsetY);
    if (!tile) return;
    if (this.tool === 'select') { this.cb.onSelect(tile[0], tile[1], e.offsetX, e.offsetY); return; }
    if (this.tool === 'buy') { this.buyStart = tile; this.buyRect = { x: tile[0], y: tile[1], w: 1, h: 1 }; return; }
    if (this.tool === 'runway') { this.runwayStart = tile; this.runwayLine = [tile]; return; }
    if (this.tool === 'rail') { this.railStart = tile; this.railPath = [tile]; return; }
    this.painting = true; this.painted.clear(); this.lastPaint = null; this.crossing = null; this.lastDry = null;
    this.paint(tile);
  };

  private move = (e: PointerEvent) => {
    if (this.orbiting) { this.rig.orbitAround(this.pivot, -e.movementX * 0.006, e.movementY * 0.005); return; }
    if (this.panning) {
      const rd = this.rightDown;
      if (rd && !rd.moved) { // a right press that has not yet travelled a few pixels may still be a click
        if (Math.hypot(e.clientX - rd.x, e.clientY - rd.y) < 5) return;
        rd.moved = true;
      }
      this.rig.panPixels(e.movementX, e.movementY, this.canvas.clientHeight);
      return;
    }
    const tile = this.tileAt(e.offsetX, e.offsetY);
    if (tile && this.runwayStart) {
      // before the hover callback, so the status line judges the line as it now stands
      const [sx, sy] = this.runwayStart;
      const alongX = Math.abs(tile[0] - sx) >= Math.abs(tile[1] - sy);
      const n = Math.min(64, Math.abs(alongX ? tile[0] - sx : tile[1] - sy)), d = Math.sign(alongX ? tile[0] - sx : tile[1] - sy);
      this.runwayLine = Array.from({ length: n + 1 }, (_, i): [number, number] => (alongX ? [sx + d * i, sy] : [sx, sy + d * i]));
    }
    if (tile && this.railStart) this.railPath = trackDragPath(this.railStart, tile);
    if (!tile !== !this.hover || (tile && this.hover && (tile[0] !== this.hover[0] || tile[1] !== this.hover[1]))) {
      this.hover = tile;
      this.cb.onHover(tile);
    }
    if (!tile) return;
    if (this.painting && !structureTool(this.tool) && this.tool !== 'roundabout' && this.tool !== 'flyover') {
      const was = this.crossing;
      this.paint(tile); // junction tools: one click, one junction
      if (was !== this.crossing) this.cb.onHover(tile); // a crossing began or ended: the status line follows
    }
    if (this.buyStart) {
      const [sx, sy] = this.buyStart;
      let x0 = Math.min(sx, tile[0]), y0 = Math.min(sy, tile[1]);
      let x1 = Math.max(sx, tile[0]), y1 = Math.max(sy, tile[1]);
      if (x1 - x0 >= MAX_PARCEL_EDGE) { if (tile[0] > sx) x1 = x0 + MAX_PARCEL_EDGE - 1; else x0 = x1 - MAX_PARCEL_EDGE + 1; }
      if (y1 - y0 >= MAX_PARCEL_EDGE) { if (tile[1] > sy) y1 = y0 + MAX_PARCEL_EDGE - 1; else y0 = y1 - MAX_PARCEL_EDGE + 1; }
      this.buyRect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
  };

  private up = (e: PointerEvent) => {
    if (this.rightDown && !this.rightDown.moved && e.type === 'pointerup' && e.button === 2) this.cb.onContext?.(e.offsetX, e.offsetY, e.clientX, e.clientY);
    this.rightDown = null;
    if (this.buyStart && this.buyRect) this.cb.onBuy(this.buyRect);
    if (this.runwayStart && this.runwayLine) this.cb.onBuild('runway', this.runwayLine);
    if (this.railStart && this.railPath) this.cb.onBuild('rail', this.railPath);
    this.railStart = null; this.railPath = null;
    this.buyStart = null; this.buyRect = null;
    this.runwayStart = null; this.runwayLine = null;
    const crossed = !!this.crossing;
    this.painting = false; this.panning = false; this.crossing = null; this.lastDry = null;
    if (crossed) this.cb.onHover(this.hover); // the status line drops the bridge preview
    if (this.orbiting) { this.orbiting = false; this.canvas.style.cursor = ''; }
  };

  /**
   * The wheel, by what produced it (gestures.ts): a mouse wheel zooms, as ever; a trackpad two-finger scroll pans (with Alt:
   * orbits and tilts); a pinch (ctrl+wheel in Chrome/Firefox) zooms about the cursor. Cmd+wheel is left to the browser.
   */
  private wheel = (e: WheelEvent) => {
    if (e.metaKey) return;
    const kind = this.cls.classify(e, this.pad);
    const lines = e.deltaMode === 0 ? 1 : 16;
    const dx = e.deltaX * lines, dy = e.deltaY * lines;
    if (kind === 'pinch') {
      e.preventDefault(); // otherwise the browser zooms the whole page
      this.pend.zoom += Math.log(pinchFactor(e.deltaY, e.deltaMode));
      this.zoomAt = { x: e.offsetX, y: e.offsetY };
      return;
    }
    if (e.altKey) {
      // Alt + two-finger scroll orbits; with a mouse Alt+wheel does nothing, as before
      if (this.pad === 'mouse' || (this.pad === 'auto' && this.cls.verdict === 'mouse')) return;
      e.preventDefault();
      this.setPivot(e.offsetX, e.offsetY, e.timeStamp);
      this.pend.yaw += dx * 0.006;
      this.pend.pitch -= dy * 0.005;
      return;
    }
    e.preventDefault();
    if (kind === 'scroll') { this.pend.panX -= dx; this.pend.panY -= dy; return; }
    this.rig.zoom(Math.exp(e.deltaY * 0.0015));
  };

  /** the ground point a trackpad orbit turns about: under the cursor where the burst began, kept while it goes on */
  private setPivot(x: number, y: number, now: number) {
    if (now - this.gPivotAt > 300) {
      if (!this.rig.groundAt(x, y, this.canvas.clientWidth, this.canvas.clientHeight, this.gPivot)) this.gPivot.copy(this.rig.target);
    }
    this.gPivotAt = now;
  }

  /** Safari only: trackpad pinch zooms about the cursor; a twist orbits once it passes a dead zone (a pinch always wobbles a little) */
  private gesture = (ev: Event) => {
    const e = ev as GestureLike;
    e.preventDefault(); // otherwise Safari zooms the page
    if (e.type === 'gesturestart') {
      const r = this.canvas.getBoundingClientRect();
      this.gest = { scale: 1, rot: 0, armed: false };
      this.zoomAt = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (!this.rig.groundAt(this.zoomAt.x, this.zoomAt.y, this.canvas.clientWidth, this.canvas.clientHeight, this.gPivot)) this.gPivot.copy(this.rig.target);
      this.gPivotAt = performance.now();
      return;
    }
    const g = this.gest;
    if (!g || e.type === 'gestureend') { this.gest = null; return; }
    if (e.scale > 0 && g.scale > 0) this.pend.zoom += Math.log(g.scale / e.scale);
    g.scale = e.scale;
    if (!g.armed && Math.abs(e.rotation) > 8) { g.armed = true; g.rot = e.rotation; }
    if (g.armed) {
      this.gPivotAt = performance.now(); // pivot is fixed for the gesture
      this.pend.yaw += (e.rotation - g.rot) * Math.PI / 180; // Safari's rotation is clockwise-positive; clockwise turns the view that way
      g.rot = e.rotation;
    }
  };

  private keydown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return; // typing
    this.keys.add(e.code);
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if ((key === 'z' || key === 'c') && structureTool(this.tool)) {
      // turn the footprint a quarter: Z anticlockwise, C clockwise (1×1 tools ignore both)
      if (!e.repeat) this.cb.onRotate(this.tool, key === 'z' ? 1 : -1);
      return;
    }
    const tool = TOOL_KEYS[key];
    if (tool) this.setTool(this.cb.ladderKey?.(tool) ?? tool);
    if (e.code === 'Escape') this.setTool('select');
    this.cb.onKey(e.code);
  };

  /** Paint a tile, filling the straight line from the previous paint so fast drags leave no gaps. */
  private paint(tile: [number, number]) {
    const line: [number, number][] = [];
    if (this.lastPaint) {
      let [x0, y0] = this.lastPaint;
      const [x1, y1] = tile;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 512; guard++) {
        line.push([x0, y0]);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    } else line.push(tile);
    this.lastPaint = tile;
    const tiles: [number, number][] = [];
    const push = (t: [number, number]) => {
      const k = `${t[0]},${t[1]}`;
      if (this.painted.has(k)) return;
      this.painted.add(k); tiles.push(t);
    };
    // a crossing goes whole, bank to bank (the server checks the run between them), even where this drag has been before
    if (this.tool === 'road' && this.cb.isWater) this.bridging(line, (t, whole) => { if (whole) { this.painted.add(`${t[0]},${t[1]}`); tiles.push(t); } else push(t); });
    else for (const t of line) push(t);
    if (tiles.length) this.cb.onBuild(this.tool, tiles);
  }

  /**
   * A stretch of the road tool's drag with water taken out, except a whole straight crossing (see Crossing) once the
   * drag reaches the far bank: the water run and the bank tile, then the rest of the drag. Sees every tile of the line,
   * painted before or not, so going back over the same water still makes a crossing.
   */
  private bridging(tiles: [number, number][], out: (t: [number, number], whole: boolean) => void) {
    const wet = this.cb.isWater!;
    for (const t of tiles) {
      if (wet(t[0], t[1])) {
        if (!this.crossing && this.lastDry) {
          // out over the water: the bridge goes the way the drag stepped off the bank (the wet way, if it stepped diagonally)
          const [fx, fy] = this.lastDry;
          let dx = Math.sign(t[0] - fx), dy = Math.sign(t[1] - fy);
          if (dx && dy) { if (wet(fx + dx, fy)) dy = 0; else dx = 0; }
          if (dx || dy) this.crossing = { from: [fx, fy], dx, dy };
        }
        continue;
      }
      const c = this.crossing;
      if (c) {
        this.crossing = null;
        // the far bank along the bridge's line: commit once the drag is at or past it
        const run: [number, number][] = [];
        let [x, y] = c.from;
        for (let i = 0; i <= BRIDGE_MAX_SPAN; i++) { x += c.dx; y += c.dy; if (!wet(x, y)) break; run.push([x, y]); }
        const along = (t[0] - c.from[0]) * c.dx + (t[1] - c.from[1]) * c.dy;
        if (run.length && !wet(x, y) && along >= run.length + 1) for (const q of [c.from, ...run, [x, y] as [number, number]]) out(q, true);
      }
      out(t, false);
      this.lastDry = t;
    }
  }
}
