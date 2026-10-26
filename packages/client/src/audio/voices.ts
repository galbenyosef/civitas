import { hash2 } from '@msimcity/shared';
import { toDb, type AudioEngine, type VoiceClass, type VoiceTag } from './engine';
import { VOICES, type BusId } from './manifest';

/**
 * The synthesised voices (docs/audio.md). Each is built from oscillators and shaped noise, and each instance varies:
 * a bed picks its own start point in the noise, its own playback rate, its own LFO rates and phases from `seed`; an
 * event varies its onset, pitch (3 to 8%), filter and gain. Nothing here loops a fixed sound the same way twice.
 * A voice whose manifest row names a recording plays that instead, with the same variation (playSample, sampleBed).
 */
const P = (id: string) => VOICES[id].params;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const vary = (base: number, frac: number, r: number) => base * (1 + (r * 2 - 1) * frac);
/** per-instance randomness: a seed is usually a hash2 fraction in [0, 1), so scale it to an integer first (`| 0` alone made every bed and ride share seed 0) */
const r = (seed: number, i: number) => hash2(seed < 1 && seed > -1 ? Math.floor(seed * 2147483647) : seed | 0, i);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** What an ambience bed gives its controller: a level (0..1), a tone (0..1, each bed maps it to its own filter) and how fast to move. */
export interface Bed {
  out: GainNode;
  /** which recording it plays and its pitch offset in cents, for the audio readout (no `info`: the synthesis) */
  info?(): { take: string; cents: number | null };
  tune(level: number, tone: number, tc: number): void;
  stop(): void;
}
/** The ridden vehicle's sound: speed 0..1. */
export interface Ride {
  out: GainNode;
  /** the recording it plays, for the audio readout (no `info`: the synthesis) */
  info?(): { take: string };
  set(speed: number): void;
  stop(): void;
}

class Rack {
  nodes: AudioScheduledSourceNode[] = [];
  add<T extends AudioScheduledSourceNode>(n: T, at = 0): T { n.start(at); this.nodes.push(n); return n; }
  stop(at: number) { for (const n of this.nodes) { try { n.stop(at); } catch { /* already stopped */ } } this.nodes.length = 0; }
}

/** a looping noise source, started at its own random point in the buffer */
function noiseSrc(eng: AudioEngine, rack: Rack, kind: 'white' | 'pink' | 'brown', seed: number): AudioBufferSourceNode {
  const c = eng.ctx!, s = c.createBufferSource();
  s.buffer = eng.noise(kind); s.loop = true;
  s.playbackRate.value = vary(1, 0.04, r(seed, 1));
  s.start(0, r(seed, 2) * s.buffer.duration);
  rack.nodes.push(s);
  return s;
}

function osc(c: AudioContext, rack: Rack, type: OscillatorType, freq: number): OscillatorNode {
  const o = c.createOscillator(); o.type = type; o.frequency.value = freq; return rack.add(o);
}
/** a low-frequency oscillator adding `depth` to `target`, at its own rate and starting phase */
function lfo(c: AudioContext, rack: Rack, hz: number, depth: number, target: AudioParam): OscillatorNode {
  const o = c.createOscillator(); o.frequency.value = hz;
  const g = c.createGain(); g.gain.value = depth;
  o.connect(g); g.connect(target);
  rack.add(o, 0);
  return o;
}
function filt(c: AudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f;
}
function gainNode(c: AudioContext, v: number): GainNode { const g = c.createGain(); g.gain.value = v; return g; }

/** Fade out and stop a rack, and give the voice slot back. */
function finish(eng: AudioEngine, rack: Rack, out: GainNode, fade = 1.2) {
  const c = eng.ctx!, t = c.currentTime;
  out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, fade / 4);
  rack.stop(t + fade + 0.2);
  setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } eng.give(); }, (fade + 0.3) * 1000);
}

/** A recording as a bed: looped from a random point at a slightly different rate, through the same level and a tone filter. */
function sampleBed(eng: AudioEngine, id: string, buf: AudioBuffer, seed: number, dest: AudioNode): Bed {
  const c = eng.ctx!, rack = new Rack(), level = VOICES[id]?.level ?? 1;
  const rate = vary(1, 0.03, r(seed, 3));
  const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  s.start(0, r(seed, 4) * buf.duration); rack.nodes.push(s);
  const out = gainNode(c, 0), f = filt(c, 'lowpass', 18000, 0.5);
  s.connect(f); f.connect(out); out.connect(dest);
  return { out, info: () => ({ take: eng.fileOf(id, buf), cents: 1200 * Math.log2(rate) }), tune: (lv, tone, tc) => { out.gain.setTargetAtTime(lv * level, c.currentTime, tc); f.frequency.setTargetAtTime(lerp(2500, 18000, tone), c.currentTime, tc); }, stop: () => finish(eng, rack, out) };
}

/** every voice that is a bed: the five with a synthesised recipe, and the second pass's recordings */
export type BedId = 'traffic' | 'wind' | 'crowd' | 'industry' | 'water' | 'rain-light' | 'rain-heavy' | 'market' | 'pub' | 'playground' | 'stadium' | 'fountain' | 'zone-ind' | 'zone-com' | 'zone-off' | 'zone-res' | 'zone-civic';
export const BEDS: readonly BedId[] = ['traffic', 'wind', 'crowd', 'industry', 'water', 'rain-light', 'rain-heavy', 'market', 'pub', 'playground', 'stadium', 'fountain', 'zone-ind', 'zone-com', 'zone-off', 'zone-res', 'zone-civic'];

/**
 * Make the bed for a manifest id; null when the voice budget is spent (or a recording-only voice has no file). A voice with a
 * recording plays it; one whose recording has not decoded yet plays its synthesis (a recording-only one stays silent) and
 * cross-fades to the recording over about two seconds when it arrives. Never decodes on the tick: that is the engine's job.
 */
export function makeBed(eng: AudioEngine, id: BedId, seed: number, pick?: number): Bed | null {
  const def = VOICES[id], dest = eng.buses[def.bus];
  const hasTakes = !!def.takes?.length;
  if (def.synth === false && !hasTakes) return null;
  if (!eng.take()) return null;
  const rec = eng.sample(id, pick ?? r(seed, 6));
  eng.note('bed', id);
  if (rec) return sampleBed(eng, id, rec, seed, dest);
  let cur: Bed | null = def.synth === false ? null : synthBed(eng, id, seed, dest);
  if (!hasTakes) return cur;
  let last = { lv: 0, tone: 0.5, tc: 1 }, stopped = false;
  eng.whenSample(id, (buf) => {
    if (stopped || !eng.ctx) return;
    if (cur && !eng.take()) return; // no voice to spare for the recording: keep the synthesis
    eng.note('crossfade', id);
    const next = sampleBed(eng, id, buf, seed, dest);
    next.tune(last.lv, last.tone, 0.7);
    const old = cur; cur = next;
    old?.stop(); // fades out over 1.2 s and gives its voice back; the recording has taken another (or the one reserved above)
  }, pick);
  return {
    get out() { return cur?.out ?? (null as unknown as GainNode); },
    info: () => cur?.info?.() ?? { take: 'synth', cents: null },
    tune: (lv, tone, tc) => { last = { lv, tone, tc }; cur?.tune(lv, tone, tc); },
    stop: () => { stopped = true; eng.note('stop', id); if (cur) cur.stop(); else eng.give(); },
  } as Bed;
}

/** The synthesised bed for the five voices that have a recipe (its voice is taken by makeBed). */
function synthBed(eng: AudioEngine, id: BedId, seed: number, dest: AudioNode): Bed {
  const c = eng.ctx!, p = P(id), rack = new Rack();
  const out = gainNode(c, 0);
  out.connect(dest);
  let f: BiquadFilterNode, lo: number, hi: number;
  if (id === 'traffic') {
    const n = noiseSrc(eng, rack, 'brown', seed);
    lo = p.lpMin; hi = p.lpMax;
    const sw = gainNode(c, 1); sw.connect(out);
    f = filt(c, 'lowpass', lo, p.q); n.connect(f); f.connect(sw);
    lfo(c, rack, vary(p.swellHz, 0.4, r(seed, 5)), p.swell * 0.3, sw.gain); // the swell of passing cars
  } else if (id === 'wind') {
    const n = noiseSrc(eng, rack, 'pink', seed);
    lo = p.bpMin; hi = p.bpMax;
    const sw = gainNode(c, 1); sw.connect(out);
    f = filt(c, 'bandpass', lo, p.q); n.connect(f); f.connect(sw);
    lfo(c, rack, vary(p.driftHz, 0.5, r(seed, 5)), p.drift * 300, f.frequency); // the gusts move the band
    lfo(c, rack, vary(p.driftHz * 1.7, 0.5, r(seed, 7)), 0.2, sw.gain);
  } else if (id === 'crowd') {
    const n = noiseSrc(eng, rack, 'pink', seed);
    lo = p.bpMin; hi = p.bpMax;
    f = filt(c, 'bandpass', lo, p.q);
    const am = gainNode(c, 1 - p.amDepth - p.amDepth2);
    n.connect(f); f.connect(am); am.connect(out);
    lfo(c, rack, vary(p.amHz, 0.35, r(seed, 5)), p.amDepth, am.gain);
    lfo(c, rack, vary(p.amHz2, 0.35, r(seed, 7)), p.amDepth2, am.gain);
  } else if (id === 'industry') {
    lo = p.lpMin; hi = p.lpMax;
    f = filt(c, 'lowpass', lo, p.q);
    const f0 = vary(p.f0, 0.05, r(seed, 5));
    const a = osc(c, rack, 'sawtooth', f0), b = osc(c, rack, 'sawtooth', f0 * (1 + p.detune / 1000 * (1 + r(seed, 6))));
    const h = osc(c, rack, 'sawtooth', f0 * 1.5);
    const mix = gainNode(c, 0.22), hg = gainNode(c, 0.07);
    const sw = gainNode(c, 1); sw.connect(out);
    a.connect(mix); b.connect(mix); h.connect(hg); hg.connect(mix); mix.connect(f); f.connect(sw);
    lfo(c, rack, vary(0.11, 0.5, r(seed, 7)), 0.15, sw.gain);
  } else { // water
    const n = noiseSrc(eng, rack, 'pink', seed);
    lo = p.lpMin; hi = p.lpMax;
    const sw = gainNode(c, 1); sw.connect(out);
    f = filt(c, 'lowpass', lo, 0.6); n.connect(f); f.connect(sw);
    lfo(c, rack, vary(p.swellHz, 0.5, r(seed, 5)), p.swell * 0.6, sw.gain);
    lfo(c, rack, vary(p.swellHz * 0.37, 0.5, r(seed, 7)), 180, f.frequency);
  }
  return {
    out,
    tune: (level, tone, tc) => {
      const t = c.currentTime;
      out.gain.setTargetAtTime(level, t, tc);
      f.frequency.setTargetAtTime(lerp(lo, hi, clamp(tone, 0, 1)), t, tc);
    },
    stop: () => finish(eng, rack, out),
  };
}

// ---- one-shots ---------------------------------------------------------------------------------------------------

export interface Shot {
  /** varies everything that varies: pass something unique per call */
  seed: number;
  /** 0..1 on top of the voice's own gain (distance, loudness) */
  gain?: number;
  /** -1 left to 1 right */
  pan?: number;
  /** seconds from now */
  delay?: number;
  /** what asked for it, in plain words, for the audio readout (readout.ts): "crossing red at 12,40", "ui: place" */
  why?: string;
  /** the readout's class for it: a tour cue says 'cue'; otherwise 'ui' for the interface clicks and 'event' */
  cls?: VoiceClass;
}
const clsOf = (id: string, o: Shot): VoiceClass => o.cls ?? (id.startsWith('ui-') ? 'ui' : 'event');

/** The node an event connects its output to: a panner into the voice's bus. */
function sink(eng: AudioEngine, bus: BusId, pan = 0): AudioNode {
  const c = eng.ctx!, dest = eng.buses[bus];
  if (!c.createStereoPanner) return dest;
  const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(dest);
  return p;
}

function playSample(eng: AudioEngine, id: string, o: Shot): boolean {
  const buf = eng.sample(id, r(o.seed, 5));
  if (!buf) return false;
  startSample(eng, id, buf, o);
  return true;
}
/** play a decoded take once, varied (pitch, gain, pan, take); returns the seconds it sounds for, 0 when the voice budget was spent */
function startSample(eng: AudioEngine, id: string, buf: AudioBuffer, o: Shot): number {
  const c = eng.ctx!, def = VOICES[id];
  const rate = vary(1, 0.05, r(o.seed, 3)), level = (o.gain ?? 1) * (def.level ?? 1) * vary(1, 0.1, r(o.seed, 4));
  if (!eng.take(buf.duration, { id, cls: clsOf(id, o), bus: def.bus, why: o.why ?? '', db: toDb(level * eng.busGain(def.bus)), cents: 1200 * Math.log2(rate), take: eng.fileOf(id, buf) })) return 0;
  const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const g = gainNode(c, level);
  s.connect(g); g.connect(sink(eng, def.bus, o.pan ?? (def.bus === 'ui' ? 0 : r(o.seed, 21) * 1.2 - 0.6)));
  s.start(c.currentTime + (o.delay ?? 0));
  return buf.duration / rate;
}
/**
 * Play a voice's recording once, for a tour cue (docs/audio.md "Tour cues"): the seconds it sounds for, or 0 when nothing did
 * (muted, no context, the recording not decoded yet, the budget spent). Never the synthesis: a cue is a recording.
 */
export function playClip(eng: AudioEngine, id: string, o: Shot): number {
  const c = eng.ctx;
  if (!c || !eng.ready || eng.muted || c.state !== 'running') return 0;
  const buf = eng.sample(id, r(o.seed, 5));
  return buf ? startSample(eng, id, buf, o) : 0;
}

/** A sine or other tone with an attack/decay envelope, a pitch glide and a filter, connected to `dest`; returns its end time. */
function tone(c: AudioContext, dest: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, len: number, peak: number, lp = 0): number {
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.01, len / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  if (lp) { const f = filt(c, 'lowpass', lp, 0.7); o.connect(f); f.connect(g); } else o.connect(g);
  g.connect(dest);
  o.start(t0); o.stop(t0 + len + 0.05);
  return t0 + len;
}
/** a short burst of white noise, band-passed or high-passed, with an envelope */
function burst(eng: AudioEngine, dest: AudioNode, type: BiquadFilterType, freq: number, q: number, t0: number, len: number, peak: number, attack = 0.004, seed = 0) {
  const c = eng.ctx!, s = c.createBufferSource();
  s.buffer = eng.noise('white'); s.loop = true;
  const f = filt(c, type, freq, q), g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t0, r(seed, 9) * 5); s.stop(t0 + len + 0.05);
}

export type EventId = 'bird' | 'owl' | 'bell' | 'bell-deep' | 'horn' | 'beep' | 'ui-click' | 'ui-place' | 'ui-refuse' | 'ui-undo' | 'fx-hiss' | 'fx-stopbell' | 'fx-chime' | 'fx-joint'
  | 'gust' | 'thunder' | 'footsteps' | 'siren' | 'siren-fire' | 'seagulls' | 'pigeons' | 'dog' | 'bell-peal' | 'bike-bell' | 'bin-lorry' | 'station-chime' | 'heli-over' | 'plane-over' | 'boat-horn' | 'fireworks' | 'hammer' | 'drill' | 'lawnmower'
  | DistrictVoice | TourVoice;
/** the district events (manifest.ts, "the districts"): recordings only, fired by the ambience while a zone wins the soft-max */
export type DistrictVoice = 'metal-clank' | 'reverse-beep' | 'steam-vent' | 'till' | 'busker' | 'music-door' | 'revolving-door' | 'lift-ding' | 'radio-window' | 'front-door' | 'kids-yard' | 'camera-shutter';
/** the recording-only voices only the tour cues play (manifest.ts, "the tour cues") */
export type TourVoice = 'big-ben' | 'bus-pass' | 'tube-arrive' | 'tube-gap' | 'train-pass' | 'boat-pass' | 'port' | 'crowd-roar' | 'whistle' | 'jet-takeoff' | 'shop-bell' | 'ducks' | 'applause' | 'orchestra' | 'siren-ambulance' | 'school-bell' | 'crows' | 'fox' | 'rigging' | 'bridge-bell' | 'parakeets';

/** Fire an event voice. Skipped (silently) when the budget is spent or the context is not running. */
export function fire(eng: AudioEngine, id: EventId, o: Shot): void {
  const c = eng.ctx;
  if (!c || !eng.ready || eng.muted || c.state !== 'running') return;
  if (playSample(eng, id, o)) return;
  if (VOICES[id].synth === false) return; // a recording-only voice, and the recording has not arrived (or is missing): silence
  const def = VOICES[id], p = def.params, k = o.gain ?? 1, sd = o.seed;
  const t = c.currentTime + (o.delay ?? 0);
  const gain = p.gain * k * vary(1, 0.15, r(sd, 4));
  const pitch = vary(1, 0.06, r(sd, 3)); // 3 to 8%: the spread each voice below keeps
  const tag: VoiceTag = { id, cls: clsOf(id, o), bus: def.bus, why: o.why ?? '', db: toDb(gain * eng.busGain(def.bus)), cents: 1200 * Math.log2(pitch), take: 'synth' };
  const take = (sec: number) => eng.take(sec, tag);
  switch (id) {
    case 'bird': {
      if (!take(1.2)) return;
      const dest = sink(eng, def.bus, o.pan ?? r(sd, 20) * 1.6 - 0.8);
      const car = c.createOscillator(), mod = c.createOscillator(), md = c.createGain(), g = c.createGain();
      const base = lerp(p.fMin, p.fMax, r(sd, 5)), n = Math.round(lerp(p.sylMin, p.sylMax, r(sd, 6)));
      mod.frequency.value = base * lerp(0.5, 2, r(sd, 7)); md.gain.value = base * p.fm * lerp(0.5, 1.5, r(sd, 8));
      mod.connect(md); md.connect(car.frequency);
      car.type = 'sine';
      g.gain.setValueAtTime(0.0001, t);
      let at = t, f = base;
      car.frequency.setValueAtTime(f, at);
      for (let i = 0; i < n; i++) {
        const len = lerp(0.04, 0.11, r(sd, 30 + i)), up = r(sd, 40 + i) > 0.45;
        const f2 = clamp(f * (up ? lerp(1.1, 1.5, r(sd, 50 + i)) : lerp(0.65, 0.9, r(sd, 50 + i))), 1500, 6500);
        car.frequency.setValueAtTime(f, at); car.frequency.linearRampToValueAtTime(f2, at + len);
        g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(gain * lerp(0.6, 1, r(sd, 60 + i)), at + len * 0.3); g.gain.linearRampToValueAtTime(0.0001, at + len);
        f = f2 * lerp(0.92, 1.08, r(sd, 70 + i));
        at += len + lerp(0.03, 0.1, r(sd, 80 + i));
      }
      car.connect(g); g.connect(dest);
      car.start(t); mod.start(t); car.stop(at + 0.05); mod.stop(at + 0.05);
      return;
    }
    case 'owl': {
      if (!take(2)) return;
      const dest = sink(eng, def.bus, o.pan ?? r(sd, 20) * 1.4 - 0.7);
      const f = p.f * pitch, gap = lerp(0.4, 0.6, r(sd, 5));
      for (let i = 0; i < 2; i++) {
        const o1 = c.createOscillator(), v = c.createOscillator(), vg = c.createGain(), g = c.createGain(), lp = filt(c, 'lowpass', 700, 0.7);
        o1.type = 'sine'; const fi = f * (i ? 0.9 : 1);
        o1.frequency.setValueAtTime(fi * 1.04, t + i * gap); o1.frequency.exponentialRampToValueAtTime(fi, t + i * gap + 0.12);
        v.frequency.value = p.vib * vary(1, 0.2, r(sd, 6)); vg.gain.value = fi * 0.012; v.connect(vg); vg.connect(o1.frequency);
        const t0 = t + i * gap, len = lerp(0.32, 0.42, r(sd, 7));
        g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.07); g.gain.linearRampToValueAtTime(0.0001, t0 + len);
        o1.connect(lp); lp.connect(g); g.connect(dest);
        o1.start(t0); v.start(t0); o1.stop(t0 + len + 0.05); v.stop(t0 + len + 0.05);
      }
      return;
    }
    case 'bell': case 'bell-deep': return; // rung by ringBell, which takes a count
    case 'horn': {
      if (!take(0.8)) return;
      const dest = sink(eng, def.bus, o.pan ?? r(sd, 20) * 1.8 - 0.9);
      const f = p.f * pitch * lerp(0.8, 1.15, r(sd, 5)), len = lerp(0.18, 0.45, r(sd, 6));
      const g = c.createGain(), lp = filt(c, 'lowpass', vary(1900, 0.25, r(sd, 7)), 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.setValueAtTime(gain, t + len); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.04);
      const a = c.createOscillator(), b = c.createOscillator();
      a.type = 'square'; b.type = 'square'; a.frequency.value = f; b.frequency.value = f * p.ratio * (1 + p.detune * (r(sd, 8) * 2 - 1));
      a.connect(lp); b.connect(lp); lp.connect(g); g.connect(dest);
      const reps = r(sd, 9) > 0.7 ? 2 : 1;
      for (let i = 0; i < reps; i++) { /* a double toot restarts the envelope */ if (i) { const t2 = t + len + 0.12; g.gain.setValueAtTime(0.0001, t2); g.gain.linearRampToValueAtTime(gain, t2 + 0.02); g.gain.linearRampToValueAtTime(0.0001, t2 + len); } }
      const end = t + (reps === 2 ? len * 2 + 0.2 : len + 0.06);
      a.start(t); b.start(t); a.stop(end); b.stop(end);
      return;
    }
    case 'beep': {
      if (!take(0.6)) return;
      const dest = sink(eng, def.bus, o.pan ?? 0);
      const f = p.f * pitch, pulses = 2;
      for (let i = 0; i < pulses; i++) tone(c, dest, 'sine', f, f, t + i * (p.pulse + p.gap), p.pulse, gain);
      return;
    }
    case 'ui-click': {
      if (!take(0.1)) return;
      const dest = sink(eng, def.bus);
      burst(eng, dest, 'bandpass', 3200 * pitch, 1.2, t, 0.012, p.gain * k * 0.9, 0.001, sd);
      tone(c, dest, 'sine', p.f * pitch, p.f * pitch * 0.8, t, p.len, p.gain * k * vary(1, 0.12, r(sd, 4)));
      return;
    }
    case 'ui-place': {
      if (!take(0.3)) return;
      const dest = sink(eng, def.bus);
      tone(c, dest, 'sine', p.f * pitch, 60 * pitch, t, p.len, p.gain * k * vary(1, 0.12, r(sd, 4)));
      burst(eng, dest, 'bandpass', vary(1400, 0.2, r(sd, 5)), 0.8, t, 0.03, p.gain * k * 0.5, 0.002, sd);
      return;
    }
    case 'ui-refuse': {
      if (!take(0.5)) return;
      const dest = sink(eng, def.bus);
      const f = p.f * pitch;
      tone(c, dest, 'triangle', f, f * 0.93, t, p.len * 0.5, p.gain * k, 1200);
      tone(c, dest, 'triangle', f * 0.8, f * 0.72, t + p.len * 0.45, p.len * 0.6, p.gain * k, 1000);
      return;
    }
    case 'ui-undo': {
      if (!take(0.3)) return;
      const dest = sink(eng, def.bus);
      tone(c, dest, 'sine', p.f * pitch, p.f * pitch * 1.8, t, p.len, p.gain * k * vary(1, 0.1, r(sd, 4)));
      return;
    }
    case 'fx-hiss': {
      if (!take(1.2)) return;
      const dest = sink(eng, def.bus, o.pan ?? 0);
      const len = p.len * vary(1, 0.2, r(sd, 5));
      burst(eng, dest, 'highpass', vary(2800, 0.15, r(sd, 6)), 0.7, t, len, gain, len * 0.18, sd);
      burst(eng, dest, 'bandpass', vary(6000, 0.1, r(sd, 7)), 1.5, t, len * 0.8, gain * 0.5, len * 0.12, sd + 1);
      return;
    }
    case 'fx-stopbell': {
      if (!take(1)) return;
      const dest = sink(eng, def.bus, o.pan ?? 0);
      const f = p.f * pitch;
      tone(c, dest, 'sine', f, f, t, p.len, gain); tone(c, dest, 'sine', f * 2.76, f * 2.76, t, p.len * 0.5, gain * 0.35);
      return;
    }
    case 'fx-chime': {
      if (!take(1.2)) return;
      const dest = sink(eng, def.bus, o.pan ?? 0);
      const f = p.f * pitch;
      tone(c, dest, 'sine', f, f, t, p.len, gain); tone(c, dest, 'sine', f * 0.75, f * 0.75, t + 0.28, p.len * 1.1, gain);
      return;
    }
    case 'fx-joint': {
      if (!take(0.4)) return;
      const dest = sink(eng, def.bus, o.pan ?? 0);
      const f = p.f * pitch * lerp(0.8, 1.2, r(sd, 5)), gap = p.gap * vary(1, 0.12, r(sd, 6));
      burst(eng, dest, 'bandpass', f, 2.5, t, 0.05, gain, 0.001, sd);
      burst(eng, dest, 'bandpass', f * 0.9, 2.5, t + gap, 0.05, gain * 0.8, 0.001, sd + 1);
      tone(c, dest, 'sine', 90 * pitch, 70 * pitch, t, 0.08, gain * 0.5);
      return;
    }
  }
}

/** Ring a bell `strikes` times (1 to 6): five or six inharmonic partials a strike, the low ones ringing longest, every strike a little different. */
export function ringBell(eng: AudioEngine, deep: boolean, seed: number, strikes: number, k = 1, pan = 0, why = '') {
  const c = eng.ctx;
  if (!c || !eng.ready || eng.muted || c.state !== 'running') return;
  const id = deep ? 'bell-deep' : 'bell', def = VOICES[id], p = def.params;
  const n = clamp(Math.round(strikes), 1, 6), every = deep ? 3.6 : 2.4;
  if (!eng.take(n * every + p.decay * 1.4, { id, cls: 'event', bus: def.bus, why, db: toDb(k * (def.level ?? 1) * eng.busGain(def.bus)), cents: 0, take: `${n} strike${n > 1 ? 's' : ''}` })) return;
  const dest = sink(eng, def.bus, pan);
  if (eng.sample(id, 0.5)) { // recorded strikes: a take for each, at its own pitch and strength, spaced as the synthesis spaces them
    for (let i = 0; i < n; i++) {
      const sd = seed * 31 + i, buf = eng.sample(id, r(sd, 5));
      if (!buf) break;
      const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = vary(1, 0.04, r(sd, 3));
      const g = gainNode(c, k * (def.level ?? 1) * vary(1, 0.18, r(sd, 4)) * (i === 0 ? 1 : 0.9));
      src.connect(g); g.connect(dest);
      src.start(c.currentTime + 0.05 + i * every * vary(1, 0.06, r(sd, 1)));
    }
    return;
  }
  const ratios = [0.5, 1, 1.183, 1.506, 2, 2.514], amps = [0.7, 1, 0.6, 0.5, 0.35, 0.2], decays = [1.4, 1, 0.7, 0.5, 0.35, 0.25];
  const t0 = c.currentTime + 0.05;
  for (let i = 0; i < n; i++) {
    const sd = seed * 31 + i, ti = t0 + i * every * vary(1, 0.06, r(sd, 1)), f0 = p.f0 * vary(1, 0.04, r(seed, 2)) * vary(1, 0.008, r(sd, 3));
    const hit = p.gain * k * vary(1, 0.18, r(sd, 4)) * (i === 0 ? 1 : 0.9);
    for (let j = 0; j < ratios.length; j++) {
      const f = f0 * ratios[j] * vary(1, 0.004, r(sd, 10 + j));
      tone(c, dest, 'sine', f, f, ti, p.decay * decays[j] * vary(1, 0.15, r(sd, 20 + j)), hit * amps[j]);
    }
    burst(eng, dest, 'bandpass', f0 * 4, 1.5, ti, 0.04, hit * 0.4, 0.001, sd); // the clapper
  }
}

// ---- the ridden vehicle (first person) -----------------------------------------------------------------------------

export type RideKind = 'car' | 'truck' | 'bus' | 'train' | 'metro' | 'boat' | 'plane' | 'heli';

/** The sound of the vehicle the player is riding in: a bed on the vehicles bus whose pitch, cutoff and tremor follow its speed (0..1). */
export function makeRide(eng: AudioEngine, kind: RideKind, seed: number): Ride | null {
  const id = `veh-${kind}`, takes = VOICES[id].takes;
  const rec = eng.sample(id, r(seed, 6));
  if (rec) { // a recording is ready: the engine sound is the file, pitched and loudened with the speed
    if (!eng.take()) return null;
    const c = eng.ctx!, out = gainNode(c, 0);
    out.connect(eng.buses.vehicles);
    return recRide(eng, rec, seed, out, VOICES[id].level ?? 1, eng.fileOf(id, rec));
  }
  const synth = synthRide(eng, kind, seed);
  if (!synth || !takes?.length) return synth;
  // not decoded yet: the synthesis runs, and when the recording arrives the two cross-fade over about two seconds
  const c = eng.ctx!, mix = gainNode(c, 1), sf = gainNode(c, 1), rf = gainNode(c, 0);
  mix.connect(eng.buses.vehicles); synth.out.disconnect(); synth.out.connect(sf); sf.connect(mix); rf.connect(mix);
  let speed = 0, inner: Ride | null = null, stopped = false, synthDone = false;
  eng.whenSample(id, (buf) => {
    if (stopped || !eng.ctx || !eng.take()) return; // no voice to spare for the recording: keep the synthesis
    const t = c.currentTime;
    inner = recRide(eng, buf, seed, rf, VOICES[id].level ?? 1, eng.fileOf(id, buf));
    inner.set(speed);
    sf.gain.setTargetAtTime(0, t, 0.5);
    setTimeout(() => { if (!synthDone) { synthDone = true; synth.stop(); } }, 2500); // the synthesis lets go of its voice
  });
  return {
    out: mix,
    info: () => inner?.info?.() ?? { take: 'synth' },
    set: (v) => { speed = v; if (!synthDone) synth.set(v); inner?.set(v); },
    stop: () => { stopped = true; inner?.stop(); if (!synthDone) { synthDone = true; synth.stop(); } setTimeout(() => { try { mix.disconnect(); } catch { /* gone */ } }, 2500); },
  };
}

/** A recording as the ridden vehicle: looped from its own point, its pitch and level following the speed. The caller has taken its voice. */
function recRide(eng: AudioEngine, buf: AudioBuffer, seed: number, out: GainNode, level: number, take: string): Ride {
  const c = eng.ctx!, rack = new Rack(), now = () => c.currentTime;
  const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, r(seed, 4) * buf.duration); rack.nodes.push(s);
  s.connect(out);
  return {
    out,
    info: () => ({ take }),
    set: (v) => { s.playbackRate.setTargetAtTime(0.8 + 0.5 * v, now(), 0.2); out.gain.setTargetAtTime(level * (0.5 + 0.5 * v), now(), 0.2); },
    stop: () => finish(eng, rack, out, 0.8),
  };
}

function synthRide(eng: AudioEngine, kind: RideKind, seed: number): Ride | null {
  if (!eng.take()) return null;
  const c = eng.ctx!, dest = eng.buses.vehicles, rack = new Rack();
  const out = gainNode(c, 0); out.connect(dest);
  const now = () => c.currentTime;
  if (kind === 'car' || kind === 'truck' || kind === 'bus') {
    const p = P(`veh-${kind}`);
    const saw = osc(c, rack, 'sawtooth', p.f0), sub = osc(c, rack, 'triangle', p.f0 / 2);
    sub.detune.value = (r(seed, 5) * 2 - 1) * 9; saw.detune.value = (r(seed, 6) * 2 - 1) * 6;
    const lp = filt(c, 'lowpass', p.lpMin, 2), mix = gainNode(c, 0.3), trem = gainNode(c, 1 - p.depth / 2);
    const rate = vary(p.tremor, 0.1, r(seed, 7)), tl = lfo(c, rack, rate, p.depth / 2, trem.gain);
    saw.connect(mix); sub.connect(mix); mix.connect(lp); lp.connect(trem); trem.connect(out);
    const rum = filt(c, 'lowpass', 160, 0.7), rg = gainNode(c, 0.1);
    noiseSrc(eng, rack, 'brown', seed).connect(rum); rum.connect(rg); rg.connect(out);
    return {
      out,
      set: (v) => {
        const t = now(), s = clamp(v, 0, 1.6), f = lerp(p.f0, p.f1, Math.pow(s, 0.8)); // past 1: a motorway's pace (audio/fpv.ts KNEE)
        saw.frequency.setTargetAtTime(f, t, 0.12); sub.frequency.setTargetAtTime(f / 2, t, 0.12);
        lp.frequency.setTargetAtTime(lerp(p.lpMin, p.lpMax, s), t, 0.15);
        tl.frequency.setTargetAtTime(rate * (0.6 + 0.9 * s), t, 0.2);
        rg.gain.setTargetAtTime(p.rumble * (0.08 + 0.4 * s), t, 0.2);
        out.gain.setTargetAtTime(0.55 + 0.35 * s, t, 0.2);
      },
      stop: () => finish(eng, rack, out, 0.8),
    };
  }
  if (kind === 'train' || kind === 'metro') {
    const p = P(`veh-${kind}`), metro = kind === 'metro';
    const w1 = osc(c, rack, 'triangle', p.whine0), w2 = osc(c, rack, 'triangle', p.whine0 * 1.5);
    w2.detune.value = (r(seed, 5) * 2 - 1) * 12;
    const wg = gainNode(c, 0), wl = filt(c, 'lowpass', 2400, 0.7);
    w1.connect(wl); const w2g = gainNode(c, 0.5); w2.connect(w2g); w2g.connect(wl); wl.connect(wg); wg.connect(out);
    const rum = filt(c, 'lowpass', metro ? 240 : 150, 0.7), rg = gainNode(c, 0.1);
    noiseSrc(eng, rack, 'brown', seed).connect(rum); rum.connect(rg); rg.connect(out);
    let boom: GainNode | null = null, hiss: GainNode | null = null;
    if (metro) { // the tunnel: a resonance in the rumble
      const bf = filt(c, 'bandpass', p.boom, 4); boom = gainNode(c, 0);
      noiseSrc(eng, rack, 'brown', seed + 1).connect(bf); bf.connect(boom); boom.connect(out);
    } else { // wheel hiss on the rails
      const hf = filt(c, 'bandpass', 900, 1); hiss = gainNode(c, 0);
      noiseSrc(eng, rack, 'pink', seed + 1).connect(hf); hf.connect(hiss); hiss.connect(out);
    }
    return {
      out,
      set: (v) => {
        const t = now(), s = clamp(v, 0, 1), f = lerp(p.whine0, p.whine1, s);
        w1.frequency.setTargetAtTime(f, t, 0.25); w2.frequency.setTargetAtTime(f * 1.5, t, 0.25);
        wg.gain.setTargetAtTime((metro ? 0.1 : 0.06) * Math.pow(s, 1.4), t, 0.25);
        rg.gain.setTargetAtTime(p.rumble * (0.12 + 0.55 * s), t, 0.3);
        boom?.gain.setTargetAtTime(0.5 * s, t, 0.3); hiss?.gain.setTargetAtTime(p.hiss * s, t, 0.3);
        out.gain.setTargetAtTime(0.6 + 0.3 * s, t, 0.2);
      },
      stop: () => finish(eng, rack, out, 0.8),
    };
  }
  if (kind === 'boat') {
    const p = P('veh-boat');
    const saw = osc(c, rack, 'sawtooth', p.f * vary(1, 0.04, r(seed, 5))), sub = osc(c, rack, 'sawtooth', p.f / 2);
    const lp = filt(c, 'lowpass', 240, 1.5), chug = gainNode(c, 0.5), mix = gainNode(c, 0.3);
    const cl = lfo(c, rack, p.chug0, 0.5, chug.gain);
    saw.connect(mix); sub.connect(mix); mix.connect(lp); lp.connect(chug); chug.connect(out);
    const lap = filt(c, 'lowpass', 700, 0.6), lg = gainNode(c, 0.1);
    noiseSrc(eng, rack, 'pink', seed).connect(lap); lap.connect(lg); lg.connect(out);
    return {
      out,
      set: (v) => {
        const t = now(), s = clamp(v, 0, 1);
        cl.frequency.setTargetAtTime(lerp(p.chug0, p.chug1, s), t, 0.3);
        saw.frequency.setTargetAtTime(p.f * (1 + 0.5 * s), t, 0.3); lp.frequency.setTargetAtTime(lerp(200, 520, s), t, 0.3);
        lg.gain.setTargetAtTime(p.lap * (0.2 + 0.8 * s), t, 0.3); out.gain.setTargetAtTime(0.6 + 0.3 * s, t, 0.2);
      },
      stop: () => finish(eng, rack, out, 0.8),
    };
  }
  if (kind === 'plane') {
    const p = P('veh-plane');
    const bp = filt(c, 'bandpass', p.bp0, 0.6), ng = gainNode(c, 0.1);
    noiseSrc(eng, rack, 'white', seed).connect(bp); bp.connect(ng); ng.connect(out);
    const saw = osc(c, rack, 'sawtooth', p.f0 * vary(1, 0.04, r(seed, 5))), sl = filt(c, 'lowpass', 400, 0.7), sg = gainNode(c, 0.1);
    saw.connect(sl); sl.connect(sg); sg.connect(out);
    return {
      out,
      set: (v) => {
        const t = now(), s = clamp(v, 0, 1);
        bp.frequency.setTargetAtTime(lerp(p.bp0, p.bp1, s), t, 0.4); ng.gain.setTargetAtTime(0.1 + 0.45 * s, t, 0.4);
        saw.frequency.setTargetAtTime(lerp(p.f0, p.f1, s), t, 0.4); sg.gain.setTargetAtTime(0.12 + 0.12 * s, t, 0.4);
        out.gain.setTargetAtTime(0.6 + 0.3 * s, t, 0.2);
      },
      stop: () => finish(eng, rack, out, 0.8),
    };
  }
  // heli: noise chopped by the rotor over a low saw
  const p = P('veh-heli');
  const lp = filt(c, 'lowpass', 900, 0.7), chop = gainNode(c, 0.5), ng = gainNode(c, 0.5);
  noiseSrc(eng, rack, 'pink', seed).connect(lp); lp.connect(chop); chop.connect(ng); ng.connect(out);
  const cl = lfo(c, rack, p.chop0 * vary(1, 0.04, r(seed, 5)), 0.5, chop.gain);
  const saw = osc(c, rack, 'sawtooth', p.f), sl = filt(c, 'lowpass', 300, 0.7), sg = gainNode(c, 0.12);
  saw.connect(sl); sl.connect(sg); sg.connect(out);
  return {
    out,
    set: (v) => {
      const t = now(), s = clamp(v, 0, 1);
      cl.frequency.setTargetAtTime(lerp(p.chop0, p.chop1, s), t, 0.4); ng.gain.setTargetAtTime(0.5 + 0.4 * s, t, 0.4);
      saw.frequency.setTargetAtTime(p.f * (1 + 0.3 * s), t, 0.4); out.gain.setTargetAtTime(0.6 + 0.3 * s, t, 0.2);
    },
    stop: () => finish(eng, rack, out, 0.8),
  };
}
