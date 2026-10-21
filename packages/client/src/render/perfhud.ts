import type { WebGLRenderer } from 'three';
import type { NetClient } from '../net';

/** The server's tick budget: one tick interval (TICK_MS), and the average the loop should stay under. */
const BUDGET_MS = 200, AMBER_MS = 50;

export interface PerfSources {
  net: NetClient;
  renderer: WebGLRenderer;
  /** agents currently drawn (citizens.count) */
  agentsDrawn: () => number;
  chunksLoaded: () => number;
  /** the audio engine's cost, for one line of the readout (client/src/audio) */
  audio?: () => { tickMs: number; maxMs: number; voices: number; started: boolean; muted: boolean };
}

/**
 * Performance readout: how the server's 5 Hz tick is coping against its budget, what this client receives
 * (agents streamed, bytes) and what it draws (FPS, frame time, agents, chunks, draw calls).
 * A plain DOM panel; toggled by the "perf" chip in the top bar or Shift+M (M alone is the sound mute), and forced on in test cities.
 * Server figures come from the optional tickAvg / tickP95 / tickMax fields of the stats message (last minute of
 * ticks, simulation plus network flush); everything else is measured here once a second.
 */
export class PerfHud {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private on = false;
  private last = performance.now();
  private prevNow = 0;
  private frames = 0;
  private frameSum = 0;
  private frameWorst = 0;
  private rx0 = { bytes: 0, msgs: 0, agents: 0 };
  private tick: { avg: number; p95: number; max: number } | null = null;
  private serverSeen = false;
  /** the last second's figures, for tests and the console (window.msc.perf.readout) */
  readout = { fps: 0, ms: 0, worst: 0, bps: 0, aps: 0, mps: 0, calls: 0, agents: 0, chunks: 0, tick: null as { avg: number; p95: number; max: number } | null };
  private calls = 0;
  private triangles = 0;

  constructor(private src: PerfSources, mount: HTMLElement, private chip: HTMLElement | null, opts: { forceOn?: boolean } = {}) {
    this.el = document.createElement('div');
    this.el.id = 'perf';
    this.el.className = 'hidden';
    this.body = document.createElement('div');
    this.el.appendChild(this.body);
    mount.appendChild(this.el);
    src.net.tap((m) => {
      if (m.t === 'stats' && m.tickAvg !== undefined) { this.tick = { avg: m.tickAvg, p95: m.tickP95 ?? 0, max: m.tickMax ?? 0 }; this.serverSeen = true; }
    });
    chip?.addEventListener('click', () => this.set(!this.on));
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.set(!this.on);
    });
    this.set(opts.forceOn ?? false);
  }

  get visible() { return this.on; }
  set(on: boolean) {
    this.on = on;
    this.el.classList.toggle('hidden', !on);
    this.chip?.classList.toggle('on', on);
    if (on) this.render({ fps: 0, ms: 0, worst: 0, bps: 0, aps: 0, mps: 0 });
  }
  toggle() { this.set(!this.on); }

  /** Call once per animation frame, at the top of the frame (the renderer's info still holds the previous frame's draw). */
  frame(now: number) {
    if (this.prevNow) {
      const dt = now - this.prevNow;
      this.frames++; this.frameSum += dt; if (dt > this.frameWorst) this.frameWorst = dt;
    }
    this.prevNow = now;
    const info = this.src.renderer.info.render;
    this.calls = info.calls; this.triangles = info.triangles;
    const span = now - this.last;
    if (span < 1000) return;
    const rx = this.src.net.rx;
    const rate = {
      fps: this.frames * 1000 / span, ms: this.frames ? this.frameSum / this.frames : 0, worst: this.frameWorst,
      bps: (rx.bytes - this.rx0.bytes) * 1000 / span, aps: (rx.agents - this.rx0.agents) * 1000 / span, mps: (rx.msgs - this.rx0.msgs) * 1000 / span,
    };
    this.rx0 = { ...rx };
    this.readout = { ...rate, calls: this.calls, agents: this.src.agentsDrawn(), chunks: this.src.chunksLoaded(), tick: this.tick };
    this.last = now; this.frames = 0; this.frameSum = 0; this.frameWorst = 0;
    if (this.on) this.render(rate);
  }

  private render(r: { fps: number; ms: number; worst: number; bps: number; aps: number; mps: number }) {
    const cls = (v: number) => (v > BUDGET_MS ? 'bad' : v > AMBER_MS ? 'warn' : '');
    const num = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
    const t = this.tick, a = this.src.audio?.();
    const server = t
      ? `<span class="${cls(t.avg)}">avg <b>${num(t.avg)}</b></span> · <span class="${cls(t.p95)}">p95 <b>${num(t.p95)}</b></span> · <span class="${cls(t.max)}">max <b>${num(t.max)}</b></span> ms <i>of ${BUDGET_MS}</i>`
      : `<i>${this.serverSeen ? '' : 'waiting for the server…'}</i>`;
    const kb = r.bps / 1024;
    const fpsCls = r.fps && r.fps < 20 ? 'bad' : r.fps && r.fps < 40 ? 'warn' : '';
    this.body.innerHTML =
      `<div class="prow"><span>server tick, last minute</span><span>${server}</span></div>` +
      `<div class="prow"><span>stream</span><span><b>${Math.round(r.aps).toLocaleString()}</b> agents/s · <b>${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)}</b> KB/s · ${Math.round(r.mps)} msg/s</span></div>` +
      `<div class="prow"><span>client</span><span class="${fpsCls}"><b>${r.fps.toFixed(0)}</b> fps · <b>${r.ms.toFixed(1)}</b> ms/frame <i>(worst ${r.worst.toFixed(0)})</i></span></div>` +
      `<div class="prow"><span>drawn</span><span><b>${this.src.agentsDrawn().toLocaleString()}</b> agents · <b>${this.src.chunksLoaded()}</b> chunks · <b>${this.calls.toLocaleString()}</b> draw calls · ${(this.triangles / 1000).toFixed(0)}k tris</span></div>` +
      (a ? `<div class="prow"><span>sound</span><span>${a.started ? (a.muted ? 'muted' : `<b>${a.tickMs.toFixed(2)}</b> ms/tick <i>(worst ${a.maxMs.toFixed(1)})</i> · <b>${a.voices}</b> voices`) : 'waiting for a click'}</span></div>` : '');
  }
}
