import { hash2 } from '@msimcity/shared';
import type { AudioEngine } from './engine';
import { fire, makeRide, type Ride, type RideKind } from './voices';

/**
 * First-person sound (docs/audio.md). While the player rides a vehicle in the FPV (inset or full) its engine is the loud
 * thing: a car, a truck or a bus by its speed, a train's traction whine and rail joints, a tube train's tunnel boom,
 * a boat's chug, an aircraft's roar, and a bus's door hiss and stop bell, a train's door chime. The city's ambience
 * ducks by 6 dB under it. The speed is worked out here from the vehicle's position (no vehicle reports one in the
 * same units), scaled to the fastest it has been seen, so a stopped bus is silent-ish and a cruising one is not.
 */
export interface RideNow {
  /** a new key starts a new ride ('c12' a road vehicle, 't3:0', 'b7', 'p1:4012', 'h3') */
  key: string;
  kind: RideKind;
  x: number; z: number;
  /** a train's doors are open */
  doors?: boolean;
}
export interface FpvSources { riding(): RideNow | null }

const TICK_MS = 100;
/** a speed in tiles a second that counts as full for each kind until a faster one is seen */
const TOP: Record<RideKind, number> = { car: 3, truck: 3, bus: 2.5, train: 8, metro: 8, boat: 2, plane: 30, heli: 12 };

export class FpvSound {
  private ride: Ride | null = null;
  private key = '';
  private kind: RideKind = 'car';
  private at = 0;
  private px = 0; private pz = 0; private have = false;
  private sm = 0; private top = 1;
  private stopped = false; private stoppedFor = 0; private lastDoors = false; private joint = 0;
  private n = 0;
  constructor(private eng: AudioEngine, private src: FpvSources, private salt = (Math.random() * 1e9) | 0) {}

  get riding() { return this.ride !== null; }
  get speed() { return this.sm / this.top; }

  frame(now: number) {
    if (now - this.at < TICK_MS) return;
    const dt = Math.min(0.5, (now - this.at) / 1000);
    this.at = now;
    const eng = this.eng;
    if (!eng.ready || !eng.ctx || eng.ctx.state !== 'running') return;
    const r = eng.muted ? null : this.src.riding();
    if (!r) { this.end(); return; }
    if (r.key !== this.key || r.kind !== this.kind || !this.ride) {
      this.end();
      this.ride = makeRide(eng, r.kind, hash2(this.n++, this.salt));
      this.key = r.key; this.kind = r.kind; this.top = TOP[r.kind]; this.have = false; this.sm = 0; this.stopped = false; this.stoppedFor = 0; this.joint = 0;
      this.lastDoors = !!r.doors;
      if (this.ride) eng.duckAmbience(-6, 0.4);
    }
    if (!this.ride) return;
    // speed from position
    if (this.have) {
      const d = Math.hypot(r.x - this.px, r.z - this.pz);
      if (d < 8) { this.sm += (d / dt - this.sm) * 0.35; if (this.sm > this.top) this.top = this.sm; } else this.sm = 0; // a jump is not speed
    }
    this.px = r.x; this.pz = r.z; this.have = true;
    this.top = Math.max(TOP[r.kind], this.top * (1 - dt * 0.004));
    const s = Math.min(1, this.sm / this.top);
    this.ride.set(s);
    this.events(r, s, dt);
  }

  private events(r: RideNow, s: number, dt: number) {
    const eng = this.eng, seed = () => (hash2(this.n++, this.salt) * 1e9) | 0;
    if (r.kind === 'bus') { // a stop: the doors hiss open; pulling away, the stop bell and the doors closing
      if (s < 0.04) this.stoppedFor += dt; else if (s > 0.12) {
        if (this.stopped) {
          this.stopped = false;
          if (this.stoppedFor > 1.2) { fire(eng, 'fx-stopbell', { seed: seed() }); fire(eng, 'fx-hiss', { seed: seed(), delay: 0.35, gain: 0.7 }); }
        }
        this.stoppedFor = 0;
      }
      if (!this.stopped && this.stoppedFor > 0.5) { this.stopped = true; fire(eng, 'fx-hiss', { seed: seed() }); }
    } else if (r.kind === 'train' || r.kind === 'metro') {
      const doors = !!r.doors;
      if (doors && !this.lastDoors) fire(eng, 'fx-hiss', { seed: seed(), gain: 0.8 });
      else if (!doors && this.lastDoors) { fire(eng, 'fx-chime', { seed: seed() }); fire(eng, 'fx-hiss', { seed: seed(), delay: 0.5, gain: 0.6 }); }
      this.lastDoors = doors;
      // rail joints: a clack-clack a bogie apart, more often the faster it goes (a tube train's are duller and softer)
      this.joint += dt * 8 * s;
      if (this.joint >= 1) { this.joint %= 1; fire(eng, 'fx-joint', { seed: seed(), gain: (0.5 + 0.5 * s) * (r.kind === 'metro' ? 0.5 : 1), delay: hash2(this.n++, this.salt) * 0.03 }); }
    }
  }

  private end() {
    if (this.ride) { this.ride.stop(); this.ride = null; this.eng.duckAmbience(0, 0.6); }
    this.key = ''; this.have = false;
  }
}
