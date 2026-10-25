import { AudioEngine, MAX_VOICES, toDb } from './engine';
import { Ambience, type AmbSources } from './ambience';
import { FpvSound, type FpvSources } from './fpv';
import { fire } from './voices';
import { bindControls, bindMuteKey } from './controls';
import { VOICES } from './manifest';
import type { AudioState, VoiceRow } from './readout';
import { clipUrl } from './urls';
import { TourCues } from './tourcue';
import type { TourSound } from '@msimcity/shared';

export { AudioEngine } from './engine';
export type { AmbSources } from './ambience';
export type { FpvSources, RideNow } from './fpv';
export { TourCues } from './tourcue';
export { AudioReadout, type AudioState, type VoiceRow } from './readout';

export type UiSound = 'click' | 'place' | 'refuse' | 'undo';

export interface AudioHooks {
  ambience: AmbSources;
  fpv: FpvSources;
  /** a short notice in the status line: "Sound off" */
  notice(text: string): void;
}

/** Everything audio, wired for the client (main.ts makes one). Nothing here runs a sound before the first gesture. */
export class Audio {
  readonly engine = new AudioEngine({ url: clipUrl });
  readonly ambience: Ambience;
  readonly fpv: FpvSound;
  /** the tour's stop sounds (tourcue.ts): cues, the beds' bias and the ducking */
  readonly tour: TourCues;
  private uiAt: Record<string, number> = {};
  private n = 0;
  private salt = (Math.random() * 1e9) | 0;

  constructor(hooks: AudioHooks) {
    this.ambience = new Ambience(this.engine, hooks.ambience);
    this.fpv = new FpvSound(this.engine, hooks.fpv);
    this.tour = new TourCues(this.engine, this.ambience);
    try { this.tour.debug = new URLSearchParams(location.search).has('audiodebug'); } catch { /* no location */ }
    this.engine.arm(window, document);
    bindMuteKey(window, this.engine, (muted) => hooks.notice(muted ? 'Sound off' : 'Sound on'));
    bindControls(this.engine, {
      toggle: document.getElementById('soundOn') as HTMLInputElement | null,
      slider: document.getElementById('soundVol') as HTMLInputElement | null,
      chip: document.getElementById('soundBtn'),
      mount: document.getElementById('toasts'),
    });
  }

  /** a short interface sound; the same one is not repeated inside 70 ms (a drag that places many tiles is one thump) */
  ui(id: UiSound) {
    const t = performance.now();
    if (t - (this.uiAt[id] ?? -1e9) < 70) return;
    this.uiAt[id] = t;
    fire(this.engine, `ui-${id}`, { seed: (this.n++ * 7919 + this.salt) | 0, why: `ui: ${id}` });
  }

  /** msc.audio.debug = true prints every tour cue as it starts (or why it did not); ?audiodebug turns it on at load */
  get debug() { return this.tour.debug; }
  set debug(on: boolean) { this.tour.debug = on; }

  /** a tour stop is shown (tour.ts): play its sound `settle` seconds from now; undefined is a stop with none (the beds alone) */
  tourStop(stop: string, sound: TourSound | undefined, settle = 0) { this.tour.show(stop, sound, settle); }
  /** the tour closed: end its cues, bias and duck */
  tourEnd() { this.tour.clear(); }

  /** a firework shell (render/fireworks.ts), `at` seconds before it launches */
  firework(x: number, z: number, at: number, size: number) { this.ambience.firework(x, z, at, size); }

  /** once a frame, after the camera and the vehicles have moved */
  frame(now: number) {
    if (!this.engine.ready) return;
    this.ambience.frame(now);
    this.fpv.frame(now);
  }

  /**
   * What is sounding now and why, for the audio readout (readout.ts): the context, volume and mute, the voices and the cap, decodes in flight,
   * the duck layers, the ambience hour and its source, one row per voice (beds with their inputs, tour loops with their stop, the ride, the
   * one-shots still sounding) and the journal. Built only when the readout is open, twice a second; it only reads.
   */
  state(): AudioState {
    const e = this.engine, now = performance.now(), rows: VoiceRow[] = [];
    const level = (g: { gain?: { value?: unknown } } | null | undefined, bus: 'ambience' | 'vehicles' | 'ui') => { const v = g?.gain?.value; return typeof v === 'number' ? v * e.busGain(bus) : 0; };
    for (const b of this.ambience.bedList()) {
      const i = b.bed.info?.();
      rows.push({ id: b.id, cls: 'bed', bus: VOICES[b.id].bus, db: toDb(level(b.bed.out, VOICES[b.id].bus)), cents: i?.cents ?? null, take: i?.take ?? 'synth', age: now - b.born, why: b.why });
    }
    for (const l of this.tour.loopList()) {
      const i = l.bed.info?.();
      rows.push({ id: l.voice, cls: 'cue', bus: VOICES[l.voice].bus, db: toDb(level(l.bed.out, VOICES[l.voice].bus)), cents: i?.cents ?? null, take: i?.take ?? 'synth', age: now - l.born, why: `tour stop ${l.stop}, cue ${l.index} of ${l.of}, loop from +${l.at.toFixed(1)} s until the stop is left` });
    }
    const ride = this.fpv.state();
    if (ride) rows.push({ id: ride.id, cls: 'ride', bus: 'vehicles', db: toDb(ride.gain), cents: 1200 * Math.log2(0.8 + 0.5 * ride.speed), take: ride.take, age: now - ride.born, why: `riding ${ride.key}: a ${ride.kind} at ${Math.round(ride.speed * 100)}% of its top speed (pitch and level follow it); the ambience is down 6 dB` });
    for (const s of e.shots) if (s.until > now) rows.push({ id: s.id, cls: s.cls, bus: s.bus, db: s.db ?? -Infinity, cents: s.cents ?? null, take: s.take ?? 'synth', age: now - s.at, left: (s.until - now) / 1000, why: s.why });
    const h = this.ambience.hourInfo();
    return {
      at: now, context: e.ctx ? (e.ctx.state as AudioState['context']) : 'not started', muted: e.muted, volume: e.volume, masterDb: toDb(e.gainFor()),
      voices: e.active, cap: MAX_VOICES, loading: e.loading, ducks: e.duckLayers, hour: h.hour, hourSource: h.source, stop: this.tour.shown, rows, journal: e.journal.map((j) => ({ ...j })),
    };
  }

  /** for the perf readout (render/perfhud.ts): the 250 ms tick's cost, the voices, and the engine's event log and tick times for the trace and the jitter finder */
  get stats() { const c = this.ambience.cost; return { tickMs: c.median, maxMs: c.p95, voices: this.engine.active, started: this.engine.started, muted: this.engine.muted, events: this.engine.events, ticks: () => this.ambience.ticks() }; }
}
