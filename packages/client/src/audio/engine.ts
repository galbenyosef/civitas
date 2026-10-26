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
/** voices kept back from one-shots for the beds and the ridden vehicle */
export const HELD_RESERVE = 4;
export const DEFAULT_VOLUME = 0.6;

/** something the engine did that costs main-thread time or changes the graph, for the perf readout and the frame trace (render/perfhud.ts) */
export interface AudioEvent { at: number; kind: 'start' | 'decode' | 'bed' | 'crossfade' | 'stop' | 'event'; id: string; /** decode: ms from the fetch to the decoded buffer */ ms?: number }

/** what kind of sound a voice is, for the audio readout (readout.ts): a bed runs all the time, an event is fired once, a ride is the ridden vehicle, a cue is the tour's, ui is an interface click */
export type VoiceClass = 'bed' | 'event' | 'ride' | 'cue' | 'ui';
/** what a one-shot is and why it sounds, handed to `take` so the readout can list it; `db` is the level at the start (post-bus), `cents` the pitch offset, `take` the file or "synth" */
export interface VoiceTag { id: string; cls: VoiceClass; bus: BusId; why: string; db?: number; cents?: number | null; take?: string }
/** a one-shot still sounding: its tag, when it started and when its voice is given back (performance.now ms) */
export interface ShotRow extends VoiceTag { at: number; until: number }
/** one start, stop or skipped start in the journal the readout shows (the last JOURNAL); `t` is performance.now ms */
export interface JournalRow { t: number; ev: 'start' | 'stop' | 'skip'; cls: VoiceClass | 'engine'; id: string; why: string; /** the same row repeated inside two seconds (rail joints, footsteps) is one row with a count */ n?: number }
export const JOURNAL = 40;
/** a linear gain in dB (-Infinity for silence) */
export const toDb = (g: number) => (g > 1e-6 ? 20 * Math.log10(g) : -Infinity);

export interface AudioPrefs { volume: number; muted: boolean; /** the "sound on" chip has been shown and dismissed or timed out */ chipSeen: boolean }

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export interface EngineOpts {
  storage?: Store | null;
  create?: () => AudioContext;
  fetch?: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** the URL of a recording file named in the manifest (files/<name>.opus); the client passes the bundler's resolver (urls.ts) */
  url?: (file: string) => string | undefined;
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
  /** true once the context exists (recordings load lazily, the first time a voice is wanted) */
  ready = false;
  /** how many voices are sounding now (beds, events, the ridden vehicle) */
  active = 0;
  private store: Store | null;
  private make: () => AudioContext;
  private fetcher: EngineOpts['fetch'];
  private listeners = new Set<() => void>();
  private onStart = new Set<() => void>();
  private noises = new Map<string, AudioBuffer>();
  /** decoded takes of each voice, filled as they arrive */
  private takes = new Map<string, AudioBuffer[]>();
  /** voices whose files have been asked for (once; a failed file is not asked again) */
  private asked = new Set<string>();
  private waiting = new Map<string, ((b: AudioBuffer) => void)[]>();
  private resolveUrl: (file: string) => string | undefined;
  private armed = false;
  /** the last 256 events: context start, each decode as it lands, beds made, cross-fades to a recording, stops; voices.ts and ambience.ts push */
  readonly events: AudioEvent[] = [];
  /** the last JOURNAL starts, stops and skipped starts with their cause, for the audio readout (readout.ts); the tour's rows go here too (tourcue.ts) */
  readonly journal: JournalRow[] = [];
  log(ev: JournalRow['ev'], cls: JournalRow['cls'], id: string, why: string) {
    const t = performance.now(), last = this.journal[this.journal.length - 1];
    if (last && last.ev === ev && last.cls === cls && last.id === id && t - last.t < 2000) { last.t = t; last.why = why; last.n = (last.n ?? 1) + 1; return; }
    this.journal.push({ t, ev, cls, id, why });
    if (this.journal.length > JOURNAL) this.journal.shift();
  }
  /** one-shots started lately (those still sounding are the ones whose `until` is ahead), pruned as they pass */
  readonly shots: ShotRow[] = [];
  /** recording files being fetched or decoded now */
  loading = 0;
  private names = new Map<string, string[]>();
  note(kind: AudioEvent['kind'], id: string, ms?: number) { this.events.push({ at: performance.now(), kind, id, ...(ms !== undefined ? { ms } : {}) }); if (this.events.length > 256) this.events.shift(); }

  constructor(opts: EngineOpts = {}) {
    this.store = opts.storage === undefined ? safeLocal() : opts.storage;
    this.make = opts.create ?? (() => new (window.AudioContext ?? (window as any).webkitAudioContext)({ latencyHint: 'playback' }));
    this.fetcher = opts.fetch ?? (typeof fetch === 'function' ? (u) => fetch(u) : undefined);
    this.resolveUrl = opts.url ?? ((f) => `audio/${f}`);
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
      this.ready = true; // recordings are fetched and decoded in the background when a voice first wants one; synthesis plays until then
      this.note('start', 'context');
      for (const f of this.onStart) f();
    }
    if (this.ctx.state !== 'running' && !this.muted) void this.ctx.resume();
  }

  get started() { return this.ctx !== null; }
  /** a bus's gain now (the ambience bus carries the ducking), 1 when there is none to read */
  busGain(bus: BusId): number { const v = this.buses[bus]?.gain?.value; return typeof v === 'number' ? v : 1; }
  /** the context's clock, 0 before it exists */
  get now() { return this.ctx?.currentTime ?? 0; }

  /** called once the context is ready */
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
  /**
   * Lower the ambience bus by `db` (negative), eased over about a second; 0 restores it. Each caller keeps a `layer` of its own
   * (the ridden vehicle, the tour's cues) and the layers add, so one letting go does not undo another.
   */
  duckAmbience(db: number, tc = 0.35, layer = 'ride') {
    if (db === 0) this.ducks.delete(layer); else this.ducks.set(layer, db);
    if (!this.ctx) return;
    let sum = 0;
    for (const v of this.ducks.values()) sum += v;
    this.buses.ambience.gain.setTargetAtTime(0.9 * Math.pow(10, sum / 20), this.ctx.currentTime, tc);
  }
  private ducks = new Map<string, number>();
  /** the ambience bus's dips by layer, dB (the audio readout) */
  get duckLayers(): [string, number][] { return [...this.ducks]; }

  private save() {
    try { this.store?.setItem(AUDIO_KEY, JSON.stringify({ volume: Math.round(this.volume * 1000) / 1000, muted: this.muted, chipSeen: this.chipSeen })); } catch { /* not remembered */ }
  }
  private emit() { for (const f of this.listeners) f(); }

  // ---- the voice budget ----------------------------------------------------------------------------------------
  /**
   * Reserve a voice for `seconds`, or (0) hold it until `give` as a bed or the ridden vehicle does. False when the budget is
   * spent and the caller skips the sound. One-shots leave the last few voices free, so a bed or an engine can always start.
   */
  take(seconds = 0, tag?: VoiceTag): boolean {
    if (this.active >= (seconds > 0 ? MAX_VOICES - HELD_RESERVE : MAX_VOICES)) return false;
    this.active++;
    if (seconds > 0) setTimeout(() => this.give(), seconds * 1000 + 50);
    if (tag && seconds > 0) { // the readout's list of one-shots: a small row, dropped once its voice is given back
      const at = performance.now();
      if (this.shots.length > 40) { const live = this.shots.filter((x) => x.until > at); this.shots.length = 0; this.shots.push(...live); }
      this.shots.push({ ...tag, at, until: at + seconds * 1000 + 50 });
      this.log('start', tag.cls, tag.id, tag.why);
    }
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
  /**
   * A decoded recording for a voice (one of its takes, chosen by `pick` 0..1), or null while none has loaded or the voice has no
   * file. The first call for a voice starts fetching and decoding its takes in the background (decodeAudioData runs off the main
   * thread); the caller plays synthesis, or nothing, until they arrive.
   */
  sample(id: string, pick = 0): AudioBuffer | null {
    const def = VOICES[id];
    if (!def?.takes?.length) return null;
    if (!this.asked.has(id)) this.ask(id);
    const have = this.takes.get(id);
    return have?.length ? have[Math.min(have.length - 1, Math.floor(pick * have.length))] : null;
  }
  /** call `f` with a take as soon as the voice has one (now, if it already does); never when the files are missing */
  whenSample(id: string, f: (b: AudioBuffer) => void, pick = 0.5) {
    const b = this.sample(id, pick);
    if (b) { f(b); return; }
    if (!VOICES[id]?.takes?.length) return;
    (this.waiting.get(id) ?? this.waiting.set(id, []).get(id)!).push(f);
  }
  /** the file a decoded take of `id` came from, or "synth" (the audio readout) */
  fileOf(id: string, buf: AudioBuffer | null): string { const i = buf ? this.takes.get(id)?.indexOf(buf) ?? -1 : -1; return i >= 0 ? this.names.get(id)?.[i] ?? 'synth' : 'synth'; }
  /** how many takes of a voice are decoded now */
  loaded(id: string) { return this.takes.get(id)?.length ?? 0; }

  private ask(id: string) {
    this.asked.add(id);
    const c = this.ctx, f = this.fetcher, files = VOICES[id].takes ?? [];
    if (!c || !f) return;
    for (const file of files) {
      void (async () => {
        this.loading++;
        try {
          const url = this.resolveUrl(file);
          if (!url) return;
          const t0 = performance.now();
          const res = await f(url);
          if (!res.ok) return;
          const buf = await c.decodeAudioData(await res.arrayBuffer());
          this.note('decode', id, performance.now() - t0);
          const have = this.takes.get(id) ?? this.takes.set(id, []).get(id)!;
          have.push(buf);
          (this.names.get(id) ?? this.names.set(id, []).get(id)!).push(file);
          const w = this.waiting.get(id);
          if (w) { this.waiting.delete(id); for (const cb of w) cb(buf); }
        } catch { /* not there, or not decodable: the voice stays synthesised (or silent, if it has no synthesis) */ } finally { this.loading--; }
      })();
    }
  }
}

function safeLocal(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
