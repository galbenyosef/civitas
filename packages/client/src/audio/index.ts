import { AudioEngine } from './engine';
import { Ambience, type AmbSources } from './ambience';
import { FpvSound, type FpvSources } from './fpv';
import { fire } from './voices';
import { bindControls, bindMuteKey } from './controls';

export { AudioEngine } from './engine';
export type { AmbSources } from './ambience';
export type { FpvSources, RideNow } from './fpv';

export type UiSound = 'click' | 'place' | 'refuse' | 'undo';

export interface AudioHooks {
  ambience: AmbSources;
  fpv: FpvSources;
  /** the status line (main.ts): "Sound off" for a moment */
  status(text: string): void;
  /** put the status line back */
  restoreStatus(): void;
}

/** Everything audio, wired for the client (main.ts makes one). Nothing here runs a sound before the first gesture. */
export class Audio {
  readonly engine = new AudioEngine();
  readonly ambience: Ambience;
  readonly fpv: FpvSound;
  private uiAt: Record<string, number> = {};
  private n = 0;
  private salt = (Math.random() * 1e9) | 0;

  constructor(hooks: AudioHooks) {
    this.ambience = new Ambience(this.engine, hooks.ambience);
    this.fpv = new FpvSound(this.engine, hooks.fpv);
    this.engine.arm(window, document);
    let timer = 0;
    bindMuteKey(window, this.engine, (muted) => {
      hooks.status(muted ? 'Sound off' : 'Sound on');
      clearTimeout(timer);
      timer = window.setTimeout(() => hooks.restoreStatus(), 1500);
    });
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
    fire(this.engine, `ui-${id}`, { seed: (this.n++ * 7919 + this.salt) | 0 });
  }

  /** once a frame, after the camera and the vehicles have moved */
  frame(now: number) {
    if (!this.engine.ready) return;
    this.ambience.frame(now);
    this.fpv.frame(now);
  }

  /** for the perf readout */
  get stats() { return { tickMs: this.ambience.stats.avg, maxMs: this.ambience.stats.max, voices: this.engine.active, started: this.engine.started, muted: this.engine.muted }; }
}
