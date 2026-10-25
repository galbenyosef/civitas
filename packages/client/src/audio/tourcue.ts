import { hash2, type AmbienceHint, type TourCue, type TourSound } from '@msimcity/shared';
import type { AudioEngine } from './engine';
import type { Ambience } from './ambience';
import { makeBed, playClip, type Bed, type BedId } from './voices';
import { VOICES } from './manifest';

/**
 * Tour cues (docs/audio.md "Tour cues"). The tour tells this which stop is shown and what that stop sounds like
 * (shared/src/demo/tourSound.ts): it biases the ambient beds for as long as the stop is shown, plays each cue shortly after the
 * camera has settled (a one-shot recording, varied like every event: take, pitch, level, pan, and the moment, a little different
 * each play; or a loop that runs until the stop is left), ducks the beds while a cue sounds, and gives everything back at the
 * next stop or when the tour closes. A muted engine, or one with no gesture yet, plays nothing (the engine's own rule) but the
 * log still says what would have. Client only: nothing here touches the simulation.
 */
export const DEFAULT_DUCK_DB = 4;
/** the tour's cues sit a little above the ambient events: they are the point of the stop */
export const CUE_BOOST = 1.3;
/** a cue whose recording is still arriving this long after its moment is dropped rather than played late over another stop */
const STALE_MS = 6000;

export interface CueLog { t: number; stop: string; voice: string; kind: 'cue' | 'loop' | 'ambience' | 'none'; at: number; gain: number; result: string }

export class TourCues {
  /** what has happened, newest last (capped): the debug flag prints each as it happens, a test reads them */
  readonly log: CueLog[] = [];
  private gen = 0;
  private stop = '';
  private timers: ReturnType<typeof setTimeout>[] = [];
  private loops = new Set<Bed>();
  private duckDb = DEFAULT_DUCK_DB;
  private duckUntil = 0;
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  private n = 0;
  private salt = (Math.random() * 1e9) | 0;
  /** print each log line to the console (msc.audio.debug) */
  debug = false;

  constructor(private eng: AudioEngine, private amb: Ambience) {}

  private rand() { return hash2(this.n++, this.salt); }
  private note(e: Omit<CueLog, 't' | 'stop'>) {
    const row: CueLog = { t: Math.round(performance.now()), stop: this.stop, ...e };
    this.log.push(row);
    if (this.log.length > 500) this.log.splice(0, 100);
    if (this.debug) console.log(`[tour-cue] ${row.stop} | ${row.kind} ${row.voice} +${row.at.toFixed(2)}s x${row.gain.toFixed(2)} ${row.result}`);
  }

  /**
   * A stop is shown: `sound` is what it sounds like (undefined: nothing of its own, the beds alone), `settle` the seconds until the
   * camera has arrived. The previous stop's cues, loops and bias end.
   */
  show(stop: string, sound: TourSound | undefined, settle = 0) {
    this.reset();
    this.stop = stop;
    const gen = this.gen;
    if (sound === undefined || sound === 'ambience') { this.note({ voice: '-', kind: sound ? 'ambience' : 'none', at: 0, gain: 1, result: sound ? 'the beds alone, on purpose' : 'no sound row' }); return; }
    this.amb.setHint(sound.ambience ?? null);
    this.duckDb = sound.duck ?? DEFAULT_DUCK_DB;
    if (sound.ambience) this.note({ voice: JSON.stringify(sound.ambience), kind: 'ambience', at: 0, gain: 1, result: 'beds biased' });
    for (const cue of sound.cues) {
      if (this.eng.ready) this.eng.sample(cue.voice); // start fetching and decoding now, so the recording is there when its moment comes
      const at = Math.max(0, settle + (cue.at !== undefined ? cue.at + (this.rand() - 0.5) * 0.4 : 0.3 + 0.9 * this.rand()));
      this.timers.push(setTimeout(() => this.play(gen, cue, at), at * 1000));
    }
  }

  /** the tour closed (or is leaving): every cue, loop, bias and duck ends */
  clear() { this.reset(); this.stop = ''; }

  private reset() {
    this.gen++;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    for (const b of this.loops) { try { b.stop(); } catch { /* gone */ } }
    this.loops.clear();
    this.amb.setHint(null);
    this.duckUntil = 0;
    if (this.duckTimer) { clearTimeout(this.duckTimer); this.duckTimer = null; }
    this.eng.duckAmbience(0, 0.6, 'tour');
  }

  private play(gen: number, cue: TourCue, at: number) {
    if (gen !== this.gen) return;
    const eng = this.eng, gain = (cue.gain ?? 1) * CUE_BOOST, kind = cue.loop ? 'loop' : 'cue';
    const def = VOICES[cue.voice];
    if (!def) { this.note({ voice: cue.voice, kind, at, gain, result: 'NO SUCH VOICE' }); return; }
    if (!eng.ready) { this.note({ voice: cue.voice, kind, at, gain, result: 'silent: no gesture yet' }); return; }
    if (eng.muted) { this.note({ voice: cue.voice, kind, at, gain, result: 'silent: muted' }); return; }
    if (!def.takes?.length) { this.note({ voice: cue.voice, kind, at, gain, result: 'silent: no recording' }); return; }
    const born = performance.now();
    const go = () => {
      if (gen !== this.gen) return;
      if (performance.now() - born > STALE_MS) { this.note({ voice: cue.voice, kind, at, gain, result: 'dropped: the recording came too late' }); return; }
      const seed = (this.rand() * 1e9) | 0;
      if (cue.loop) {
        const bed = makeBed(eng, cue.voice as BedId, seed);
        if (!bed) { this.note({ voice: cue.voice, kind, at, gain, result: 'silent: no voice free' }); return; }
        bed.tune(0.8 * gain, 0.85, 0.5);
        this.loops.add(bed);
        this.applyDuck();
        this.note({ voice: cue.voice, kind, at, gain, result: 'looping until the stop is left' });
        return;
      }
      const sec = playClip(eng, cue.voice, { seed, gain, pan: this.rand() * 1.2 - 0.6 });
      if (sec <= 0) { this.note({ voice: cue.voice, kind, at, gain, result: 'silent: no voice free' }); return; }
      this.duckFor(sec);
      this.note({ voice: cue.voice, kind, at, gain, result: `played ${sec.toFixed(1)} s, beds ducked ${this.duckDb} dB` });
    };
    eng.sample(cue.voice);
    eng.whenSample(cue.voice, go);
  }

  /** dip the beds for `sec` seconds (and a moment more) */
  private duckFor(sec: number) {
    const now = performance.now();
    this.duckUntil = Math.max(this.duckUntil, now + (Math.min(sec, 10) + 0.3) * 1000);
    this.applyDuck();
    if (this.duckTimer) clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => { this.duckTimer = null; this.applyDuck(); }, Math.max(0, this.duckUntil - now) + 60);
  }
  /** the beds' dip now: the full amount while a one-shot sounds, half of it while only a loop runs, none otherwise */
  private applyDuck() {
    const shot = performance.now() < this.duckUntil ? this.duckDb : 0;
    const held = this.loops.size ? this.duckDb * 0.5 : 0;
    const db = Math.max(shot, held);
    this.eng.duckAmbience(db > 0 ? -db : 0, shot ? 0.2 : 0.7, 'tour');
  }

  /** for the check and the perf readout: the ambience bias now, and how many loops run */
  get state(): { hint: AmbienceHint | null; loops: number; stop: string } { return { hint: this.amb.hinted, loops: this.loops.size, stop: this.stop }; }
}
