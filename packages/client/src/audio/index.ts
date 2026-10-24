import { AudioEngine } from './engine';
import { Ambience, type AmbSources } from './ambience';
import { FpvSound, type FpvSources } from './fpv';
import { fire } from './voices';
import { bindControls, bindMuteKey } from './controls';
import { clipUrl } from './urls';

export { AudioEngine } from './engine';
export type { AmbSources } from './ambience';
export type { FpvSources, RideNow } from './fpv';

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
  private uiAt: Record<string, number> = {};
  private n = 0;
  private salt = (Math.random() * 1e9) | 0;

  constructor(hooks: AudioHooks) {
    this.ambience = new Ambience(this.engine, hooks.ambience);
    this.fpv = new FpvSound(this.engine, hooks.fpv);
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
    fire(this.engine, `ui-${id}`, { seed: (this.n++ * 7919 + this.salt) | 0 });
  }

  /** a firework shell (render/fireworks.ts), `at` seconds before it launches */
  firework(x: number, z: number, at: number, size: number) { this.ambience.firework(x, z, at, size); }

  /** once a frame, after the camera and the vehicles have moved */
  frame(now: number) {
    if (!this.engine.ready) return;
    this.ambience.frame(now);
    this.fpv.frame(now);
  }

  /** for the perf readout */
  get stats() { const c = this.ambience.cost; return { tickMs: c.median, maxMs: c.p95, voices: this.engine.active, started: this.engine.started, muted: this.engine.muted }; }
}
