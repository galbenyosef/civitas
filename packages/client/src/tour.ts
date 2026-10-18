import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type Scene } from 'three';
import {
  demoTour, isDemoId, kindManifest, trackDragPath, DEMO_BY_ID, demoSections, type DemoId, type TourStop, type BuildingInfo, type LineInfo, type ServerMsg,
} from '@msimcity/shared';
import type { NetClient } from './net';
import type { CameraRig } from './camera';
import { FootprintOverlay } from './render/footprint';
import { apiBase } from './worlds';

/**
 * Demo maps and the guided tour (docs/demo.md). A demo is a child world the server runs (server/src/testcities.ts,
 * slot 90+), reached through the main server at `/demo-ws/<id>`; `?demo=<id>` on the page connects to it (starting it
 * first if it is stopped). The tour panel walks the scenario's TOUR order (shared/src/demo/showcase.ts demoTour): the
 * camera flies to each object, a card shows what it does, how to build it, its technology and costs (from the
 * catalogue's blurb and howTo, so captions follow the data) and its live tooltip (the server's ordinary inspect
 * answer), with the footprint's outline and marks drawn on it. While the panel is open every stop has a floating
 * label; clicking one jumps there. A line's stop draws the line's ribbon from the 'lines' message.
 */

export const demoOf = (params: URLSearchParams): DemoId | null => { const d = params.get('demo'); return isDemoId(d) ? d : null; };
/** The demo's socket, through the main server (works on a deployment that publishes one port). */
export const demoWsUrl = (id: DemoId) => `${apiBase().replace(/^http/, 'ws')}/demo-ws/${id}`;

export interface DemoInfo {
  id: DemoId; name: string; blurb: string; port: number; status: 'stopped' | 'starting' | 'running' | 'stopping' | 'resetting';
  saved: boolean; snapshot: boolean; citizens?: number; clients?: number; fill?: number; fillPopulation?: number; startHash?: string; error?: string;
}
export async function demoList(): Promise<DemoInfo[] | null> {
  try {
    const r = await fetch(`${apiBase()}/api/demos`, { cache: 'no-store' });
    const j = r.ok ? (await r.json()) as { available?: boolean; demos?: DemoInfo[] } : null;
    return j?.available && j.demos ? j.demos : null;
  } catch { return null; }
}
async function post(id: DemoId, what: 'start' | 'reset'): Promise<DemoInfo | null> {
  try { const r = await fetch(`${apiBase()}/api/demos/${id}/${what}`, { method: 'POST' }); return r.ok ? ((await r.json()) as DemoInfo) : null; } catch { return null; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Start a demo (or wait for a reset) until it is running; false if it fails or stops. */
export async function startDemo(id: DemoId, progress: (d: DemoInfo | null) => void = () => {}, kick: 'start' | 'reset' = 'start'): Promise<boolean> {
  let d = await post(id, kick);
  progress(d);
  const t0 = Date.now();
  while (Date.now() - t0 < 20 * 60_000) {
    await sleep(1000);
    d = (await demoList())?.find((x) => x.id === id) ?? d;
    progress(d);
    if (d?.status === 'running') return true;
    if (d?.status === 'stopped') { if (d.error) return false; d = await post(id, 'start'); }
  }
  return false;
}
/** A dropped demo socket usually means the demo was stopped (idle, or the server restarted): ask for it again. */
export function reviveDemo(id: DemoId, net: NetClient) {
  let lastTry = 0;
  const prev = net.onStatus;
  net.onStatus = (ok) => {
    prev(ok);
    if (ok || Date.now() - lastTry < 5000) return;
    lastTry = Date.now();
    void post(id, 'start');
  };
}
export function showDemoBanner(id: DemoId, params: URLSearchParams, mount: HTMLElement) {
  const back = new URLSearchParams(params);
  back.delete('demo'); back.delete('ws');
  const el = document.createElement('div');
  el.id = 'cityBanner';
  el.className = 'demo';
  el.innerHTML = `${DEMO_BY_ID.get(id)?.name ?? 'Demo'}: a sandbox, not the live world · <a href="${location.pathname}?${back.toString()}">back to the live world</a>`;
  mount.appendChild(el);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const FLY_S = 1.7;
const DWELL_S = 14;
const TAU = Math.PI * 2;

interface Deps {
  demo: DemoId; net: NetClient; rig: CameraRig; scene: Scene;
  /** the tooltip's summary rows for a building (ui.ts), so the card shows exactly what hovering shows */
  buildingHtml: (info: BuildingInfo) => string;
  /** the top-bar chip that reopens the panel */
  chipMount: HTMLElement;
  /** stop following anyone when the tour moves the camera */
  onFly: () => void;
  /** the underground view (main.ts setUnder), on at a stop with `view: 'under'` (a metro line) and off again after it */
  setUnder?: (on: boolean) => void;
}

export class TourPanel {
  readonly stops: TourStop[];
  private i = 0;
  private open = true;
  private auto = false;
  private autoAt = 0;
  private el = document.createElement('div');
  private chip = document.createElement('button');
  private labels = document.createElement('div');
  private chips: { el: HTMLElement; x: number; z: number; i: number }[] = [];
  private footprint = new FootprintOverlay();
  private marks = new Group();
  /** the camera flight under way: wall-clock start (a slow frame rate must not slow the flight), from where, to which stop */
  private fly: { at: number; from: { x: number; z: number; dist: number; yaw: number; pitch: number }; to: TourStop } | null = null;
  private live: BuildingInfo | null = null;
  private lineInfo = new Map<number, LineInfo>();
  /** the line whose ribbon is drawn, so it is redrawn when its route first arrives */
  private ribbonFor = '';
  private poll = 0;
  private tmp = new Vector3();
  /** the tour turned the underground view on, so it turns it off again at the next stop */
  private under = false;

  constructor(private d: Deps) {
    this.stops = demoTour(d.demo);
    this.el.id = 'tour';
    this.labels.id = 'tourLabels';
    const ui = document.getElementById('ui')!;
    ui.appendChild(this.el);
    ui.prepend(this.labels); // under every panel, the tour card included
    d.scene.add(this.footprint.group, this.marks);
    this.chip.className = 'chip on'; this.chip.id = 'tourBtn'; this.chip.textContent = 'tour';
    this.chip.title = 'The guided tour of this demo';
    this.chip.onclick = () => this.setOpen(!this.open);
    d.chipMount.before(this.chip);
    for (const [i, s] of this.stops.entries()) {
      if (s.id === 'welcome') continue;
      const c = document.createElement('div');
      c.className = 'tlabel';
      c.textContent = s.title;
      c.onclick = () => this.go(i);
      this.labels.appendChild(c);
      this.chips.push({ el: c, x: s.focus[0], z: s.focus[1], i });
    }
    d.net.tap((m) => this.onMsg(m));
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'next') this.go(this.i + 1);
      else if (act === 'prev') this.go(this.i - 1);
      else if (act === 'auto') { this.auto = !this.auto; this.autoAt = performance.now() + (this.fly ? FLY_S * 1000 : 0) + DWELL_S * 1000; this.render(); }
      else if (act === 'close') this.setOpen(false);
      else if (act === 'reset') void this.reset();
    });
    this.el.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      if (sel.dataset.act === 'jump') this.go(Number(sel.value));
    });
    this.poll = window.setInterval(() => this.ask(), 1500);
    this.go(0, true);
  }

  get current() { return this.stops[this.i]; }
  get index() { return this.i; }
  get flying() { return !!this.fly; }

  setOpen(open: boolean) {
    this.open = open;
    this.el.classList.toggle('hidden', !open);
    this.labels.style.display = open ? '' : 'none';
    this.chip.classList.toggle('on', open);
    if (!open) { this.auto = false; this.footprint.hide(); this.marks.visible = false; } else this.show();
  }

  /** Fly to stop i (wrapping), show its card, outline and live stats. */
  go(i: number, instant = false) {
    const n = this.stops.length;
    this.i = ((i % n) + n) % n;
    const s = this.current, r = this.d.rig;
    this.d.onFly();
    this.fly = instant ? null : { at: performance.now(), from: { x: r.target.x, z: r.target.z, dist: r.dist, yaw: r.yaw, pitch: r.pitch }, to: s };
    if (instant) this.place(s, 1);
    const under = s.view === 'under';
    if (under !== this.under) { this.d.setUnder?.(under); this.under = under; }
    this.live = null;
    this.autoAt = performance.now() + (instant ? 0 : FLY_S * 1000) + DWELL_S * 1000;
    if (!this.open) this.setOpen(true); else this.show();
    this.ask();
  }

  private show() {
    const s = this.current;
    // outline: the structure with its marks, or the area (a block, the runway strip, a line's extent) and its points
    if (s.placed) this.footprint.show(s.placed, { ok: null, road: true, faint: false });
    else this.footprint.hide();
    this.buildMarks(s);
    this.render();
  }

  /** The live line a stop is about (from the 'lines' message), matched by mode and number. */
  private lineOf(s: TourStop): LineInfo | undefined {
    return s.line ? [...this.lineInfo.values()].find((x) => x.mode === s.line!.mode && x.number === s.line!.number) : undefined;
  }

  private buildMarks(s: TourStop) {
    for (const c of [...this.marks.children]) { this.marks.remove(c); (c as Mesh).geometry.dispose(); }
    const colour = s.line ? s.line.colour : s.path ? 0x4aa3ff : 0xffd23f;
    const mat = new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, depthWrite: false });
    const quad = (x0: number, z0: number, x1: number, z1: number, y = 0.06) => {
      const m = new Mesh(new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), mat);
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      m.renderOrder = 21;
      this.marks.add(m);
    };
    if (s.rect && !s.placed) {
      const [x, y, w, h] = s.rect, t = 0.09;
      quad(x - t, y - t, x + w + t, y); quad(x - t, y + h, x + w + t, y + h + t);
      quad(x - t, y, x, y + h); quad(x + w, y, x + w + t, y + h);
    }
    if (s.path) {
      // a track: every tile its drags lay; a line: a square at each stop
      const tiles = s.line ? s.path : this.trackTiles(s);
      const r = s.line ? 0.36 : 0.18;
      for (const [x, y] of tiles) quad(x + 0.5 - r, y + 0.5 - r, x + 0.5 + r, y + 0.5 + r, 0.07);
    }
    // a line's ribbon: the lap its vehicles run (LineInfo.path, tile centres), as the lines panel draws it
    const l = this.lineOf(s);
    this.ribbonFor = l ? `${l.id}:${l.path.length}` : '';
    if (l) {
      const p = l.path, w = 0.26; // wide enough to read from a whole-line view
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k] + 0.5, ay = p[k + 1] + 0.5, bx = p[k + 2] + 0.5, by = p[k + 3] + 0.5;
        if (Math.abs(ax - bx) + Math.abs(ay - by) > 1.01) continue; // a jump (the lap closing), not a step
        quad(Math.min(ax, bx) - w, Math.min(ay, by) - w, Math.max(ax, bx) + w, Math.max(ay, by) + w, 0.065);
      }
    }
    this.marks.visible = this.open;
  }
  private trackTiles(s: TourStop): [number, number][] {
    const out: [number, number][] = [];
    const pts = s.path ?? [];
    for (let k = 0; k + 1 < pts.length; k += 2) out.push(...trackDragPath([pts[k][0], pts[k][1]], [pts[k + 1][0], pts[k + 1][1]]));
    return out;
  }

  private ask() {
    const s = this.current;
    if (!this.open || !s?.inspect || !this.d.net.connected) return;
    this.d.net.send({ t: 'inspect', x: s.inspect[0], y: s.inspect[1] });
  }
  private onMsg(m: ServerMsg) {
    if (m.t === 'building') {
      const s = this.current;
      if (s?.inspect && m.x === s.inspect[0] && m.y === s.inspect[1]) { this.live = m.info; if (this.open) this.renderLive(); }
    } else if (m.t === 'lines') {
      this.lineInfo = new Map(m.lines.map((l) => [l.id, l]));
      if (this.open && this.current.line) {
        const l = this.lineOf(this.current);
        if (l && this.ribbonFor !== `${l.id}:${l.path.length}`) this.buildMarks(this.current);
        this.renderLive();
      }
    } else if (m.t === 'lineStats') {
      for (const st of m.lines) { const l = this.lineInfo.get(st.id); if (l) Object.assign(l, st); }
      if (this.open && this.current.line) this.renderLive();
    }
  }

  private render() {
    const s = this.current, n = this.stops.length;
    const k = s.kind ? kindManifest(s.kind) : undefined;
    const swatch = s.line ? hex(s.line.colour) : k?.tool?.color ?? '#62d2a2';
    const sections = demoSections(this.d.demo);
    const options = this.stops.map((t, j) => `<option value="${j}"${j === this.i ? ' selected' : ''}>${j + 1}. ${esc(t.title)}${t.id === 'welcome' ? '' : ` (${esc(sections.find((x) => x.id === t.section)?.name ?? '')})`}</option>`).join('');
    this.el.innerHTML = `
      <div class="thead"><span class="tsec">${esc(s.sectionName)}</span><span class="tnum">${this.i + 1} / ${n}</span><button class="tx" data-act="close" title="Close the tour (the tour chip reopens it)">×</button></div>
      <h3><span class="sw" style="background:${swatch}"></span>${esc(s.title)}</h3>
      <div class="tbody">
        ${s.what ? `<p class="twhat">${esc(s.what)}</p>` : ''}
        ${s.how ? `<p class="thow"><b>How to build it.</b> ${esc(s.how)}</p>` : ''}
        <table class="tfacts">${s.facts.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
        <div class="tlive"></div>
      </div>
      <div class="tctl">
        <button class="chip" data-act="prev">‹ Previous</button>
        <button class="chip${this.auto ? ' on' : ''}" data-act="auto">${this.auto ? 'Autoplay on' : 'Autoplay'}</button>
        <button class="chip" data-act="next">Next ›</button>
        <select data-act="jump" title="Jump to a stop">${options}</select>
        <button class="chip treset" data-act="reset" title="Put the town back exactly as it was first seeded">Reset demo</button>
      </div>`;
    this.renderLive();
    for (const c of this.chips) c.el.classList.toggle('on', c.i === this.i);
  }

  private renderLive() {
    const box = this.el.querySelector<HTMLElement>('.tlive');
    if (!box) return;
    const s = this.current;
    let html = '';
    if (s.line) {
      const l = this.lineOf(s);
      if (l) html += `<div class="sect">Live</div><div class="row"><span>Status</span><span>${esc(l.status || 'running')}</span></div><div class="row"><span>${l.mode === 'bus' ? 'Buses' : 'Trains'} in service</span><span>${l.inService}</span></div><div class="row"><span>Riders</span><span>${l.ridersToday} today · ${l.ridersYesterday} yesterday</span></div>`;
    }
    if (this.live) html += `<div class="sect">Live tooltip${s.line || s.path || (s.rect && !s.kind) ? ` · ${esc(s.line ? 'first stop' : 'served by')}` : ''}</div><div class="ttip">${this.d.buildingHtml(this.live)}</div>`;
    else if (s.inspect) html += '<div class="tmuted">asking the server…</div>';
    box.innerHTML = html;
  }

  private async reset() {
    if (!confirm('Reset the demo? The town goes back exactly to how it was first built, for everyone here; anything built since is lost.')) return;
    const btn = this.el.querySelector<HTMLButtonElement>('.treset');
    if (btn) { btn.disabled = true; btn.textContent = 'Resetting…'; }
    const ok = await startDemo(this.d.demo, (d) => { if (btn && d) btn.textContent = d.status === 'starting' && d.fill !== undefined ? `Seeding… ${Math.round(d.fill * 100)}%` : 'Resetting…'; }, 'reset');
    if (ok) location.reload(); else if (btn) { btn.disabled = false; btn.textContent = 'Reset failed, try again'; }
  }

  /** Camera between `from` and the stop, f in 0..1 (smoothstep). */
  private place(s: TourStop, f: number, from = this.fly?.from) {
    const r = this.d.rig;
    const e = f * f * (3 - 2 * f);
    const a = from ?? { x: s.focus[0], z: s.focus[1], dist: s.dist, yaw: s.yaw, pitch: s.pitch };
    let dy = (s.yaw - a.yaw) % TAU;
    if (dy > Math.PI) dy -= TAU; else if (dy < -Math.PI) dy += TAU;
    // pull back a little mid-flight on long hops, so the town passes underneath
    const hop = Math.hypot(s.focus[0] - a.x, s.focus[1] - a.z);
    const lift = Math.min(60, hop * 0.35) * Math.sin(Math.PI * e);
    r.target.set(a.x + (s.focus[0] - a.x) * e, 0, a.z + (s.focus[1] - a.z) * e);
    r.dist = a.dist + (s.dist - a.dist) * e + lift;
    r.yaw = a.yaw + dy * e;
    r.pitch = a.pitch + (s.pitch - a.pitch) * e;
  }

  /** Once per frame, before the rig updates: the flight, autoplay, labels and the outline's chips. */
  frame(_dt: number) {
    const now = performance.now();
    if (this.fly) {
      const f = Math.min(1, (now - this.fly.at) / (FLY_S * 1000));
      this.place(this.fly.to, f);
      if (f >= 1) this.fly = null;
    }
    if (this.auto && this.open && !this.fly && now >= this.autoAt) this.go(this.i + 1);
    if (!this.open) return;
    this.placeLabels();
    this.footprint.frame(this.d.rig.camera, innerWidth, innerHeight);
  }

  /**
   * Labels over the objects near the view: the current stop's always, then the others nearest the view centre first,
   * each only where it does not cover one already placed, so a zoomed-out view shows a readable few, not a pile.
   */
  private placeLabels() {
    const r = this.d.rig, cam = r.camera, vw = innerWidth, vh = innerHeight;
    const near = Math.max(16, r.dist * 0.9);
    const order = this.chips
      .map((c) => ({ c, d: c.i === this.i ? -1 : Math.hypot(c.x - r.target.x, c.z - r.target.z) }))
      .sort((a, b) => a.d - b.d);
    const taken: [number, number, number, number][] = [];
    for (const { c, d } of order) {
      let show = d <= near;
      let px = 0, py = 0;
      if (show) {
        this.tmp.set(c.x, 1.2, c.z).project(cam);
        px = ((this.tmp.x + 1) / 2) * vw; py = ((1 - this.tmp.y) / 2) * vh;
        show = this.tmp.z < 1 && px > 0 && px < vw && py > 40 && py < vh;
      }
      if (show) {
        const w = c.el.textContent!.length * 6.2 + 18, h = 20;
        const box: [number, number, number, number] = [px - w / 2, py - h, px + w / 2, py];
        show = d < 0 || !taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]);
        if (show) taken.push(box);
      }
      c.el.style.display = show ? '' : 'none';
      if (show) c.el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
    }
  }
}
