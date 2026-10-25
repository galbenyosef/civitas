import { hash2, type AmbienceHint, Terrain, terrainOf, isRoad, zoneOf, familyOf, Zone } from '@msimcity/shared';
import type { AudioEngine } from './engine';
import { fire, makeBed, ringBell, type Bed, type BedId } from './voices';
import { VOICES } from './manifest';

/**
 * The ambient mix (docs/audio.md). Every 250 ms (never per frame) it reads what the client already knows: the vehicles
 * and walkers drawn round the camera, the kinds of tile in a radius round the camera target, the hour and the zoom
 * distance, and turns that into a target level and tone for each bed, which the beds glide to over one to three
 * seconds. Events (birds, owls, horns, bells, the crossing's beep) are drawn on Poisson clocks from the same numbers.
 */
const TICK_MS = 250;

export interface AgentLike { rx: number; rz: number; car: boolean; trav: boolean }
export interface AmbSources {
  /** the game hour, 0..24 */
  hour(): number;
  camera(): { x: number; z: number; dist: number; map: boolean; rightX: number; rightZ: number };
  tileAt(x: number, y: number): number | undefined;
  kindIdAt(x: number, y: number): number;
  agents(): Iterable<AgentLike>;
  /** the nearest signal crossing within `r` tiles of (x, z) that holds the cars at red (render/signals.ts redPelicanNear) */
  pelican?(x: number, z: number, r: number): { x: number; z: number } | null;
}

/** what the tile scan found round the camera, as shares of the tiles sampled (0..1) */
export interface Scan {
  res: number; com: number; ind: number; park: number; water: number; road: number; bell: number; bellDeep: number; cars: number; walkers: number;
  /** counts of the sampled tiles that are a school or nursery, a stadium, a fire station, a police station, a builders' depot, a fountain */
  school: number; stadium: number; fire: number; police: number; builders: number; fountain: number;
}
export const newScan = (): Scan => ({ res: 0, com: 0, ind: 0, park: 0, water: 0, road: 0, bell: 0, bellDeep: 0, cars: 0, walkers: 0, school: 0, stadium: 0, fire: 0, police: 0, builders: 0, fountain: 0 });

/** kind ids that give a place its own sound (the second pass): which Scan count each raises */
const SPOT_KIND = new Map<number, 'school' | 'stadium' | 'fire' | 'police' | 'builders' | 'fountain'>([
  [101, 'school'], [102, 'school'], [103, 'school'], [67, 'stadium'], [186, 'stadium'], [199, 'stadium'],
  [50, 'fire'], [51, 'fire'], [52, 'fire'], [46, 'police'], [47, 'police'], [48, 'police'], [49, 'police'], [54, 'builders'], [55, 'builders'], [144, 'fountain'],
]);

/** kind ids that ring the hour: the churchyard (151) and the Houses of Parliament (96) */
const BELL_KIND = 151, BELL_DEEP_KIND = 96;
/** power stations hum like works */
const POWER_FIRST = 163, POWER_LAST = 164;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** how busy the city is at an hour, 0.25 at night to 1 by day */
export const activityAt = (h: number) => (h < 5 ? 0.25 : h < 8 ? lerp(0.25, 1, (h - 5) / 3) : h < 21 ? 1 : lerp(1, 0.25, Math.min(1, (h - 21) / 3)));

/** Fill `out` from the tiles round (cx, cz) within `rad` tiles (a grid of at most 15 by 15 samples) and the agents drawn round it. */
export function scanAround(src: AmbSources, cx: number, cz: number, dist: number, out: Scan): Scan {
  const rad = Math.max(6, Math.min(24, dist * 0.5)), step = Math.max(1, Math.floor(rad / 7));
  let n = 0, res = 0, com = 0, ind = 0, park = 0, water = 0, road = 0, bell = 0, deep = 0;
  const x0 = Math.floor(cx), z0 = Math.floor(cz);
  out.school = out.stadium = out.fire = out.police = out.builders = out.fountain = 0;
  for (let dz = -rad; dz <= rad; dz += step) {
    for (let dx = -rad; dx <= rad; dx += step) {
      const x = x0 + Math.round(dx), z = z0 + Math.round(dz), t = src.tileAt(x, z);
      if (t === undefined) continue;
      n++;
      if (terrainOf(t) === Terrain.Water) { water++; continue; }
      if (isRoad(t)) { road++; continue; }
      const z4 = zoneOf(t);
      if (z4 === 0) continue;
      const id = src.kindIdAt(x, z), fam = familyOf(id);
      if (id === BELL_KIND) bell++; else if (id === BELL_DEEP_KIND) deep++;
      const spot = SPOT_KIND.get(id);
      if (spot) out[spot]++;
      if (fam === Zone.Residential) res++;
      else if (fam === Zone.Commercial || fam === Zone.Office) com++;
      else if (fam === Zone.Industrial || (id >= POWER_FIRST && id <= POWER_LAST)) ind++;
      else if (fam === 10) park++;
    }
  }
  const k = n ? 1 / n : 0;
  out.res = res * k; out.com = com * k; out.ind = ind * k; out.park = park * k; out.water = water * k; out.road = road * k;
  out.bell = bell; out.bellDeep = deep;
  // agents: cars within a radius that grows with the zoom, walkers within a smaller one
  const rc = Math.max(25, Math.min(140, dist * 0.9)), rw = Math.max(15, Math.min(60, dist * 0.5));
  const rc2 = rc * rc, rw2 = rw * rw;
  let cars = 0, walkers = 0;
  for (const a of src.agents()) {
    const dx = a.rx - cx, dz = a.rz - cz, d2 = dx * dx + dz * dz;
    if (a.car) { if (d2 < rc2) cars++; } else if (a.trav && d2 < rw2) walkers++;
  }
  out.cars = cars; out.walkers = walkers;
  return out;
}

export interface Target { level: number; tone: number }
export type Mix = Record<BedId, Target>;
/** the five beds that always run (they have a synthesised recipe); the rest start when their level is wanted and stop after a while at zero */
const ALWAYS: readonly BedId[] = ['traffic', 'wind', 'crowd', 'industry', 'water'];
export const newMix = (): Mix => {
  const m = {} as Mix;
  for (const id of ['traffic', 'wind', 'crowd', 'industry', 'water', 'rain-light', 'rain-heavy', 'market', 'pub', 'playground', 'stadium', 'fountain'] as BedId[]) m[id] = { level: 0, tone: 0.5 };
  return m;
};
/**
 * The most each bed is ever driven to by the scene (mixFor's own ceilings), so a tour stop's bias (shared/src/demo/tourSound.ts
 * AmbienceHint, 0 to 1) is a share of the bed's own range: 1 is as loud as that bed gets, 0.5 half of it.
 */
export const HINT_CEIL: Record<keyof AmbienceHint, number> = { traffic: 0.6, wind: 0.57, crowd: 0.4, industry: 0.45, water: 0.4, market: 0.35, pub: 0.3, playground: 0.4, stadium: 0.5, fountain: 0.35 };
/** Lay a tour stop's bias over a mix: each bed it names is held at its share of the bed's ceiling, with a slow breath of its own (the organic rule). Pure. */
export function applyHint(mix: Mix, hint: AmbienceHint | null, now: number, salt = 0): Mix {
  if (!hint) return mix;
  for (const k of Object.keys(hint) as (keyof AmbienceHint)[]) {
    const v = hint[k], t = mix[k];
    if (v === undefined || !t) continue;
    const ph = hash2(k.length * 31 + k.charCodeAt(0), salt) * 6.28;
    t.level = v * HINT_CEIL[k] * (1 + 0.07 * Math.sin(now / 1000 * (0.13 + 0.1 * hash2(k.charCodeAt(1), salt)) + ph));
  }
  return mix;
}

/** a window of the day: 1 between `a` and `b` o'clock, easing over an hour at each end (a > b wraps midnight) */
const during = (h: number, a: number, b: number) => (a <= b ? smooth(a - 0.5, a + 0.5, h) * (1 - smooth(b - 0.5, b + 0.5, h)) : Math.max(smooth(a - 0.5, a + 0.5, h), 1 - smooth(b - 0.5, b + 0.5, h)));

/** The target level and tone of every bed for a scan, a camera distance and an hour. Pure, so a test can read it. */
export function mixFor(s: Scan, dist: number, hour: number, map: boolean, out: Mix = newMix(), rain = 0): Mix {
  const act = activityAt(hour);
  const near = (full: number, gone: number) => 1 - smooth(full, gone, dist); // 1 close in, 0 zoomed out
  const density = clamp01(s.cars / 45);
  out.traffic.level = (0.5 * Math.sqrt(density) + 0.1 * s.road) * lerp(0.45, 1, act) * lerp(1, 0.4, smooth(40, 400, dist));
  out.traffic.tone = 0.2 + 0.7 * density;
  const h = smooth(20, 320, dist);
  out.wind.level = 0.07 + 0.5 * Math.pow(h, 0.8);
  out.wind.tone = h;
  out.crowd.level = 0.4 * Math.sqrt(clamp01(s.walkers / 25)) * (0.55 + 0.9 * Math.min(0.5, s.com)) * act * near(60, 170);
  out.crowd.tone = 0.3 + 0.5 * act;
  out.industry.level = 0.45 * Math.min(1, s.ind * 2.5) * lerp(0.6, 1, act) * near(120, 320);
  out.industry.tone = 0.3 + 0.5 * Math.min(1, s.ind * 2.5);
  out.water.level = 0.4 * Math.min(1, s.water * 3) * near(100, 330);
  out.water.tone = 0.3 + 0.5 * near(40, 200);
  // the second pass: places with a bed of their own (recordings only; a bed with no file is never started)
  out.market.level = 0.35 * smooth(0.1, 0.35, s.com) * Math.sqrt(clamp01(s.walkers / 15)) * during(hour, 8, 17) * near(45, 130);
  out.pub.level = 0.3 * smooth(0.08, 0.3, s.com) * during(hour, 16.5, 24) * near(40, 110);
  out.playground.level = 0.4 * Math.min(1, s.school) * during(hour, 8.75, 15.5) * near(30, 100);
  out.stadium.level = 0.5 * Math.min(1, s.stadium) * during(hour, 13, 22) * near(60, 180);
  out.fountain.level = 0.35 * Math.min(1, s.fountain) * near(25, 90);
  // rain comes from the weather hook (Ambience.setWeather): light under 0.6, heavy over 0.4, the two cross-fading between
  const wet = clamp01(rain) * lerp(1, 0.55, smooth(60, 300, dist));
  out['rain-light'].level = 0.45 * wet * (1 - smooth(0.4, 0.8, rain));
  out['rain-heavy'].level = 0.55 * wet * smooth(0.4, 0.8, rain);
  if (map) { // zoomed out to the map: only the wind, thin
    out.traffic.level *= 0.1; out.crowd.level = 0; out.industry.level *= 0.1; out.water.level *= 0.2; out.wind.level = 0.2;
    out.market.level = out.pub.level = out.playground.level = out.stadium.level = out.fountain.level = 0;
  }
  return out;
}

/** events per second for the birds and owls, from the scan and the hour (0 when the camera is far off) */
export function birdRate(s: Scan, hour: number, dist: number): number {
  const green = Math.min(1, s.park * 3 + s.res * 1.2);
  const nearF = 1 - smooth(100, 220, dist);
  let base = 0;
  if (hour >= 4.5 && hour < 7) base = 0.7 + 2.3 * green;            // the dawn chorus
  else if (hour >= 7 && hour < 19) base = 0.05 + 0.5 * green;
  else if (hour >= 19 && hour < 21) base = 0.2 * green;
  return base * nearF * (green > 0.05 ? 1 : 0.3);
}
export function owlRate(s: Scan, hour: number, dist: number): number {
  if (!(hour >= 21 || hour < 4.5)) return 0;
  const green = Math.min(1, s.park * 3 + s.res * 0.8);
  return green < 0.1 ? 0 : 0.06 * green * (1 - smooth(80, 180, dist));
}

export class Ambience {
  /** the cost of the 250 ms tick, ms: the last, the worst steady one, the number run, and the first (which builds the beds and the noise) */
  stats = { last: 0, max: 0, ticks: 0, setup: 0 };
  private recent = new Float32Array(64);
  /** the median and 95th percentile of the last 64 steady ticks, ms (read once a second by the perf readout, never per frame) */
  get cost() {
    const n = Math.min(this.stats.ticks - 1, 64);
    if (n < 1) return { median: 0, p95: 0 };
    const a = Array.from(this.recent.subarray(0, n)).sort((x, y) => x - y);
    return { median: a[Math.floor(n / 2)], p95: a[Math.min(n - 1, Math.floor(n * 0.95))] };
  }
  readonly scan = newScan();
  readonly mix = newMix();
  private beds: Partial<Record<BedId, Bed>> = {};
  /** seconds each optional bed has been wanted at nothing: it is stopped after a while, freeing its voice */
  private quiet: Partial<Record<BedId, number>> = {};
  /** the weather hook: rain 0..1. Nothing in the game sets it yet (there is no weather); a future weather system calls setWeather */
  private rain = 0;
  /** the tour stop's bias on the beds (setHint), or null */
  private hint: AmbienceHint | null = null;
  private made = false;
  private at = 0;
  private n = 0;
  private lastHour = -1;
  private lastBell = -1e9;
  private beepAt = 0;

  constructor(private eng: AudioEngine, private src: AmbSources, private salt = (Math.random() * 1e9) | 0) {}

  /** A tour stop's bias on the beds (client/src/audio/tourcue.ts): the beds it names are held at their share of their ceiling while it is shown; null gives them back to the scene. */
  setHint(h: AmbienceHint | null) { this.hint = h && Object.keys(h).length ? { ...h } : null; }
  get hinted() { return this.hint; }

  /** The weather hook: rain 0 (dry) to 1 (a downpour). Starts the rain beds and, over 0.6, the thunder. Not called by anything yet. */
  setWeather(rain: number) { this.rain = clamp01(rain); }

  /**
   * A firework shell from the fireworks system (render/fireworks.ts calls this for each shell as a show is scheduled): `at` seconds from now
   * it launches, and its bang is heard a second or so later, a little later still the further off it is, softer, and to the side it is on.
   */
  firework(x: number, z: number, at: number, size: number) {
    const cam = this.src.camera(), dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
    const far = 1 - smooth(25, 260 + cam.dist, d);
    if (far < 0.03) return;
    fire(this.eng, 'fireworks', { seed: (this.rand() * 1e9) | 0, gain: far * Math.min(1, 0.5 + 0.2 * size), delay: Math.max(0, at) + 1.1 + Math.min(2, d / 150), pan: Math.max(-1, Math.min(1, (dx * cam.rightX + dz * cam.rightZ) / (12 + d * 0.3))) });
  }

  private rand() { return hash2(this.n++, this.salt); }
  private rate(lambda: number, dt: number) { return lambda > 0 && this.rand() < 1 - Math.exp(-lambda * dt); }

  /** Call every frame; it works once in 250 ms. */
  frame(now: number) {
    if (now - this.at < TICK_MS) return;
    const dt = Math.min(1, (now - this.at) / 1000);
    this.at = now;
    const eng = this.eng;
    if (!eng.ready || eng.muted || !eng.ctx || eng.ctx.state !== 'running') return;
    const t0 = performance.now();
    this.tick(dt, now);
    const ms = performance.now() - t0, s = this.stats;
    s.last = ms;
    if (s.ticks === 0) s.setup = ms; // the first tick makes the beds and the noise buffers: counted apart
    else { this.recent[(s.ticks - 1) & 63] = ms; if (ms > s.max) s.max = ms; }
    s.ticks++;
  }

  private tick(dt: number, now: number) {
    const src = this.src, cam = src.camera(), hour = src.hour(), eng = this.eng;
    if (!this.made) {
      this.made = true;
      for (const id of ALWAYS) {
        const b = makeBed(eng, id, hash2(this.n++, this.salt));
        if (b) this.beds[id] = b;
      }
    }
    const sc = scanAround(src, cam.x, cam.z, cam.dist, this.scan);
    const mix = applyHint(mixFor(sc, cam.dist, hour, cam.map, this.mix, this.rain), this.hint, now, this.salt);
    for (const id of Object.keys(mix) as BedId[]) { // the optional beds (recordings only) start when wanted and stop after eight quiet seconds
      if (ALWAYS.includes(id)) continue;
      const lv = mix[id].level;
      if (lv > 0.02 && !this.beds[id] && VOICES[id].takes?.length) { const b = makeBed(eng, id, hash2(this.n++, this.salt)); if (b) this.beds[id] = b; }
      if (lv < 0.004 && this.beds[id]) { const q = (this.quiet[id] ?? 0) + dt; this.quiet[id] = q; if (q > 8) { this.beds[id]!.stop(); delete this.beds[id]; this.quiet[id] = 0; } } else this.quiet[id] = 0;
    }
    for (const id in this.beds) {
      const k = id as BedId, tg = mix[k];
      this.beds[k]!.tune(tg.level, tg.tone, 0.5 + 0.7 * hash2(k.length, this.salt)); // each bed glides at its own pace: 1.5 to 3.6 s
    }
    if (cam.map) return;
    // events
    if (this.rate(birdRate(sc, hour, cam.dist), dt)) {
      const chorus = hour >= 4.5 && hour < 7, n = chorus ? 1 + Math.floor(this.rand() * 3) : 1;
      for (let i = 0; i < n; i++) fire(eng, 'bird', { seed: (this.rand() * 1e9) | 0, delay: i * (0.15 + this.rand() * 0.5), gain: 0.5 + 0.5 * this.rand() });
    }
    if (this.rate(owlRate(sc, hour, cam.dist), dt)) fire(eng, 'owl', { seed: (this.rand() * 1e9) | 0, gain: 0.6 + 0.4 * this.rand() });
    if (sc.cars > 5 && cam.dist < 90 && this.rate(0.006 * Math.min(1, sc.cars / 30) * lerp(0.4, 1, activityAt(hour)), dt)) {
      fire(eng, 'horn', { seed: (this.rand() * 1e9) | 0, gain: 0.4 + 0.6 * this.rand() * (1 - smooth(20, 90, cam.dist)) });
    }
    this.places(sc, cam, hour, dt);
    // the hour: a bell, if one is in the view and it is a striking hour (every third, by day) and has not just rung
    const hf = Math.floor(hour);
    if (this.lastHour >= 0 && hf !== this.lastHour && hf >= 6 && hf <= 21 && hf % 3 === 0 && cam.dist < 140 && (sc.bell > 0 || sc.bellDeep > 0) && now - this.lastBell > 40000) {
      this.lastBell = now;
      if (hf === 10 || (hf === 18 && sc.bell > 0)) { // a peal at ten and six (in place of the strikes at six) when there is a recording
        if (VOICES['bell-peal'].takes?.length && sc.bellDeep === 0) { fire(eng, 'bell-peal', { seed: (this.rand() * 1e9) | 0, gain: 1 - smooth(40, 140, cam.dist), pan: this.rand() * 1.2 - 0.6 }); this.lastHour = hf; return; }
      }
      ringBell(eng, sc.bellDeep > 0, (this.rand() * 1e9) | 0, Math.min(6, hf % 12 || 12), 1 - smooth(40, 140, cam.dist), this.rand() * 1.2 - 0.6);
    }
    this.lastHour = hf;
    // a signal crossing holding the cars at red, near the camera: its beep, every half second
    if (src.pelican && cam.dist < 80 && now >= this.beepAt) {
      const p = src.pelican(cam.x, cam.z, 18);
      if (p) {
        this.beepAt = now + 500;
        const dx = p.x - cam.x, dz = p.z - cam.z, d = Math.hypot(dx, dz);
        fire(eng, 'beep', { seed: (this.rand() * 1e9) | 0, gain: (1 - d / 20) * (1 - smooth(30, 80, cam.dist)), pan: Math.max(-1, Math.min(1, (dx * cam.rightX + dz * cam.rightZ) / 12)) });
      }
    }
  }

  /** the second pass's events: each a Poisson clock from the scan and the hour; no file, no sound (fire skips a recording-only voice that has none) */
  private places(sc: Scan, cam: ReturnType<AmbSources['camera']>, hour: number, dt: number) {
    const eng = this.eng, d = cam.dist, day = during(hour, 6.5, 20), act = activityAt(hour);
    const go = (id: Parameters<typeof fire>[1], lambda: number, gain: number, pan?: number) => {
      if (lambda > 0 && gain > 0.02 && VOICES[id].takes?.length && this.rate(lambda, dt)) fire(eng, id, { seed: (this.rand() * 1e9) | 0, gain, pan: pan ?? this.rand() * 1.6 - 0.8 });
    };
    go('gust', 0.045 * smooth(40, 260, d), 0.35 + 0.6 * smooth(60, 300, d));
    go('footsteps', 0.3 * clamp01(sc.walkers / 12) * act * (1 - smooth(25, 50, d)), 0.35 + 0.65 * this.rand());
    go('siren', 0.004 * Math.min(1, sc.police) * (1 - smooth(60, 120, d)), 0.4 + 0.6 * (1 - smooth(30, 110, d))); // a call from a station in the view: the hook for a real response vehicle
    go('siren-fire', 0.003 * Math.min(1, sc.fire) * (1 - smooth(60, 120, d)), 0.4 + 0.6 * (1 - smooth(30, 110, d)));
    go('seagulls', 0.05 * Math.min(1, sc.water * 3) * day * (1 - smooth(100, 170, d)), 0.3 + 0.7 * this.rand());
    go('pigeons', 0.04 * clamp01(sc.park * 4 + sc.com) * day * (1 - smooth(60, 120, d)), 0.3 + 0.7 * this.rand());
    go('dog', 0.02 * clamp01(sc.res * 2) * during(hour, 7, 21) * (1 - smooth(40, 100, d)), 0.3 + 0.7 * this.rand());
    go('bike-bell', 0.012 * clamp01(sc.walkers / 8) * clamp01(sc.road * 4) * day * (1 - smooth(25, 55, d)), 0.4 + 0.6 * this.rand());
    go('bin-lorry', 0.006 * clamp01(sc.res * 2) * during(hour, 6, 10) * (1 - smooth(40, 100, d)), 0.4 + 0.5 * this.rand());
    go('station-chime', 0.008 * smooth(0.12, 0.4, sc.com) * day * (1 - smooth(30, 70, d)), 0.4 + 0.5 * this.rand());
    go('heli-over', 0.004 * during(hour, 7, 20) * smooth(50, 120, d), 0.4 + 0.5 * this.rand());
    go('plane-over', 0.006 * during(hour, 6, 23) * smooth(70, 160, d), 0.4 + 0.5 * this.rand());
    go('boat-horn', 0.008 * clamp01(sc.water * 4) * (1 - smooth(80, 150, d)), 0.4 + 0.6 * this.rand());
    const works = Math.min(1, sc.builders) * during(hour, 7.5, 17) * (1 - smooth(25, 80, d));
    go('hammer', 0.12 * works, 0.4 + 0.6 * this.rand());
    go('drill', 0.05 * works, 0.4 + 0.6 * this.rand());
    go('lawnmower', 0.004 * clamp01(sc.res * 3) * during(hour, 10, 17) * (1 - smooth(30, 80, d)), 0.4 + 0.5 * this.rand());
    go('thunder', 0.02 * smooth(0.6, 0.9, this.rain), 0.5 + 0.5 * this.rand());
  }

  /** drop every bed (the context is going away, or the player left the world) */
  dispose() { for (const id in this.beds) this.beds[id as BedId]!.stop(); this.beds = {}; this.quiet = {}; this.made = false; }
}
