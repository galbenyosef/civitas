import { VOICES, type BusId } from './manifest';

/**
 * The audio engine (docs/audio.md): one AudioContext, made lazily on the first pointer or key event (browsers refuse it
 * before), the buses (ambience, vehicles, ui) into a master gain and a limiter, the volume and the mute, both kept in
 * localStorage (`msimcity.audio`), the voice budget and the noise buffers. Everything that makes a sound lives in
 * voices.ts, ambience.ts and fpv.ts and talks to this. Client only: nothing here touches the simulation.
 */
export const AUDIO_KEY = 'msimcity.audio';
/** one-shots, beds and the ridden vehicle together */
export const MAX_VOICES = 24;
export const DEFAULT_VOLUME = 0.6;

export interface AudioPrefs { volume: number; muted: boolean; /** the "sound on" chip has been shown and dismissed or timed out */ chipSeen: boolean }

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export interface EngineOpts {
  storage?: Store | null;
  create?: () => AudioContext;
  fetch?: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
}

export const clampVolume = (v: number, fallback = DEFAULT_VOLUME) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

export function readPrefs(store: Store | null | undefined): AudioPrefs {
  const out: AudioPrefs = { volume: DEFAULT_VOLUME, muted: false, chipSeen: false };
  try {
    const raw = store?.getItem(AUDIO_KEY);
    if (!raw) return out;
    const j = JSON.parse(raw) as Partial<AudioPrefs>;
    out.volume = clampVolume(typeof j.volume === 'number' ? j.volume : DEFAULT_VOLUME);
    out.muted = j.muted === true;
    out.chipSeen = j.chipSeen === true;
  } catch { /* storage blocked or garbled: the defaults */ }
  return out;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  buses = {} as Record<BusId, GainNode>;
  volume: number; muted: boolean; chipSeen: boolean;
  /** true once the context exists and any recordings have been tried */
  ready = false;
  /** how many voices are sounding now (beds, events, the ridden vehicle) */
  active = 0;
  private store: Store | null;
  private make: () => AudioContext;
  private fetcher: EngineOpts['fetch'];
  private listeners = new Set<() => void>();
  private onStart = new Set<() => void>();
  private noises = new Map<string, AudioBuffer>();
  private samples = new Map<string, AudioBuffer>();
  private armed = false;

  constructor(opts: EngineOpts = {}) {
    this.store = opts.storage === undefined ? safeLocal() : opts.storage;
    this.make = opts.create ?? (() => new (window.AudioContext ?? (window as any).webkitAudioContext)({ latencyHint: 'playback' }));
    this.fetcher = opts.fetch ?? (typeof fetch === 'function' ? (u) => fetch(u) : undefined);
    const p = readPrefs(this.store);
    this.volume = p.volume; this.muted = p.muted; this.chipSeen = p.chipSeen;
  }

  /** Listen for the first user gesture (pointer, key, touch) on `win`; the context is made then and never before. */
  arm(win: { addEventListener(t: string, f: () => void, o?: unknown): void; removeEventListener(t: string, f: () => void): void }, doc?: { hidden: boolean; addEventListener(t: string, f: () => void): void }) {
    if (this.armed) return;
    this.armed = true;
    const go = () => {
      this.start();
      if (this.ctx && this.ctx.state === 'running') for (const t of ['pointerdown', 'keydown', 'touchend', 'click']) win.removeEventListener(t, go);
    };
    for (const t of ['pointerdown', 'keydown', 'touchend', 'click']) win.addEventListener(t, go, { passive: true });
    doc?.addEventListener('visibilitychange', () => {
      const c = this.ctx;
      if (!c) return;
      if (doc.hidden) void c.suspend?.();
      else if (!this.muted) void c.resume?.();
    });
  }

  /** Make the context (once) and resume it. Call from a gesture handler. */
  start() {
    if (!this.ctx) {
      let c: AudioContext;
      try { c = this.make(); } catch { return; } // no Web Audio here: silent, nothing else breaks
      this.ctx = c;
      const master = c.createGain();
      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -9; limiter.knee.value = 6; limiter.ratio.value = 14; limiter.attack.value = 0.003; limiter.release.value = 0.2;
      master.connect(limiter); limiter.connect(c.destination);
      this.master = master;
      const levels: Record<BusId, number> = { ambience: 0.9, vehicles: 0.8, ui: 0.7 };
      for (const id of Object.keys(levels) as BusId[]) { const b = c.createGain(); b.gain.value = levels[id]; b.connect(master); this.buses[id] = b; }
      this.applyGain(true);
      void this.loadSamples().then(() => { this.ready = true; for (const f of this.onStart) f(); });
    }
    if (this.ctx.state !== 'running' && !this.muted) void this.ctx.resume();
  }

  get started() { return this.ctx !== null; }
  /** the context's clock, 0 before it exists */
  get now() { return this.ctx?.currentTime ?? 0; }

  /** called once the context and any recordings are ready */
  whenReady(f: () => void) { if (this.ready) f(); else this.onStart.add(f); }
  onChange(f: () => void) { this.listeners.add(f); return () => void this.listeners.delete(f); }

  setVolume(v: number) {
    this.volume = clampVolume(v, this.volume);
    this.applyGain(false); this.save(); this.emit();
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) { if (m) this.applyGain(false); else { void this.ctx.resume?.(); this.applyGain(false); } }
    this.save(); this.emit();
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  markChipSeen() { if (!this.chipSeen) { this.chipSeen = true; this.save(); } }

  /** the master gain for a volume: squared so the slider feels even */
  gainFor(volume = this.volume, muted = this.muted) { return muted ? 0 : volume * volume; }
  private applyGain(immediate: boolean) {
    if (!this.ctx || !this.master) return;
    const g = this.gainFor();
    if (immediate) this.master.gain.value = g;
    else this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
  }
  /** lower the ambience bus by `db` (negative), eased over about a second; 0 restores it */
  duckAmbience(db: number, tc = 0.35) {
    if (!this.ctx) return;
    this.buses.ambience.gain.setTargetAtTime(0.9 * Math.pow(10, db / 20), this.ctx.currentTime, tc);
  }

  private save() {
    try { this.store?.setItem(AUDIO_KEY, JSON.stringify({ volume: Math.round(this.volume * 1000) / 1000, muted: this.muted, chipSeen: this.chipSeen })); } catch { /* not remembered */ }
  }
  private emit() { for (const f of this.listeners) f(); }

  // ---- the voice budget ----------------------------------------------------------------------------------------
  /** Reserve a voice for `seconds` (0: held until `give`). False when the budget is spent: the caller skips the sound. */
  take(seconds = 0): boolean {
    if (this.active >= MAX_VOICES) return false;
    this.active++;
    if (seconds > 0) setTimeout(() => this.give(), seconds * 1000 + 50);
    return true;
  }
  give() { if (this.active > 0) this.active--; }

  // ---- noise and recordings -------------------------------------------------------------------------------------
  /** A loopable buffer of white, pink or brown noise, made once (6 s, the seam cross-faded). */
  noise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const hit = this.noises.get(kind);
    if (hit) return hit;
    const c = this.ctx!;
    const rate = c.sampleRate, n = Math.floor(rate * 6), x = Math.floor(rate * 0.1);
    const raw = new Float32Array(n + x);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    // a fixed-seed generator: the buffer is the same every session, the variation is in how each voice plays it
    let s = 0x9e3779b9 >>> 0;
    const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; };
    for (let i = 0; i < raw.length; i++) {
      const w = r();
      if (kind === 'white') raw[i] = w * 0.5;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; raw[i] = last * 3.5; }
      else {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
    const buf = c.createBuffer(1, n, rate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = raw[i];
    for (let i = 0; i < x; i++) { const t = i / x; d[i] = d[i] * Math.sqrt(t) + raw[n + i] * Math.sqrt(1 - t); } // equal-power seam
    this.noises.set(kind, buf);
    return buf;
  }
  /** The decoded recording for a voice, or null when it has none (or it did not load). */
  sample(id: string): AudioBuffer | null { return this.samples.get(id) ?? null; }

  private async loadSamples() {
    const c = this.ctx, f = this.fetcher;
    if (!c || !f) return;
    await Promise.all(Object.values(VOICES).filter((v) => v.file).map(async (v) => {
      try {
        const res = await f(v.file!);
        if (!res.ok) return;
        this.samples.set(v.id, await c.decodeAudioData(await res.arrayBuffer()));
      } catch { /* not there, or not decodable: the voice is synthesised */ }
    }));
  }
}

function safeLocal(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
