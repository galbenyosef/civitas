import { hash2, Terrain, terrainOf, isRoad, zoneOf, familyOf, Zone } from '@msimcity/shared';
import type { AudioEngine } from './engine';
import { fire, makeBed, ringBell, type Bed } from './voices';

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
export interface Scan { res: number; com: number; ind: number; park: number; water: number; road: number; bell: number; bellDeep: number; cars: number; walkers: number }
export const newScan = (): Scan => ({ res: 0, com: 0, ind: 0, park: 0, water: 0, road: 0, bell: 0, bellDeep: 0, cars: 0, walkers: 0 });

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
export interface Mix { traffic: Target; wind: Target; crowd: Target; industry: Target; water: Target }
export const newMix = (): Mix => ({ traffic: { level: 0, tone: 0 }, wind: { level: 0, tone: 0 }, crowd: { level: 0, tone: 0 }, industry: { level: 0, tone: 0 }, water: { level: 0, tone: 0 } });

/** The target level and tone of every bed for a scan, a camera distance and an hour. Pure, so a test can read it. */
export function mixFor(s: Scan, dist: number, hour: number, map: boolean, out: Mix = newMix()): Mix {
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
  if (map) { // zoomed out to the map: only the wind, thin
    out.traffic.level *= 0.1; out.crowd.level = 0; out.industry.level *= 0.1; out.water.level *= 0.2; out.wind.level = 0.2;
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
  /** the cost of the 250 ms tick, ms: last, running average and worst */
  stats = { last: 0, avg: 0, max: 0, ticks: 0 };
  readonly scan = newScan();
  readonly mix = newMix();
  private beds: Partial<Record<keyof Mix, Bed>> = {};
  private made = false;
  private at = 0;
  private n = 0;
  private lastHour = -1;
  private lastBell = -1e9;
  private beepAt = 0;

  constructor(private eng: AudioEngine, private src: AmbSources, private salt = (Math.random() * 1e9) | 0) {}

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
    s.last = ms; s.avg = s.ticks ? s.avg * 0.95 + ms * 0.05 : ms; if (ms > s.max) s.max = ms; s.ticks++;
  }

  private tick(dt: number, now: number) {
    const src = this.src, cam = src.camera(), hour = src.hour(), eng = this.eng;
    if (!this.made) {
      this.made = true;
      for (const id of ['traffic', 'wind', 'crowd', 'industry', 'water'] as const) {
        const b = makeBed(eng, id, hash2(this.n++, this.salt));
        if (b) this.beds[id] = b;
      }
    }
    const sc = scanAround(src, cam.x, cam.z, cam.dist, this.scan);
    const mix = mixFor(sc, cam.dist, hour, cam.map, this.mix);
    for (const id in this.beds) {
      const k = id as keyof Mix, tg = mix[k];
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
    // the hour: a bell, if one is in the view and it is a striking hour (every third, by day) and has not just rung
    const hf = Math.floor(hour);
    if (this.lastHour >= 0 && hf !== this.lastHour && hf >= 6 && hf <= 21 && hf % 3 === 0 && cam.dist < 140 && (sc.bell > 0 || sc.bellDeep > 0) && now - this.lastBell > 40000) {
      this.lastBell = now;
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

  /** drop every bed (the context is going away, or the player left the world) */
  dispose() { for (const id in this.beds) this.beds[id as keyof Mix]!.stop(); this.beds = {}; this.made = false; }
}
