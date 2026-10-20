import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from './constants';
import { hash2 } from './noise';
import { NEWS, type StoryDTO, type StoryKind } from './news';
import { HELI_TYPES, HOVER, CRUISE_Y, Profile, type Pad, type HeliFlight, type HeliState, type HeliPhase } from './helicopters';

/**
 * News helicopters (docs/media.md N3). A media centre's roof pad (helipads.ts, PadKind 'news') keeps one helicopter in
 * its channel's livery. It flies to the newest live story its channel covers, orbits or hovers over it while the story
 * is live (and a little after: the aftermath), then flies home; on the 08:00 and 17:00 rush it goes out on a traffic
 * watch when there is no story. Like the timetable in helicopters.ts this is a pure function, of the pads and the story
 * log every client already holds (client news.ts), so every viewer sees the same flight with nothing on the wire.
 *
 * The plan of one pad is a list of segments (parked, lifting off, flying, over the scene, landing) found by walking
 * through the moments something changes (a story becomes worth flying to, a story ends, a rush-hour watch starts or ends)
 * and re-targeting from wherever the helicopter is then. It is cached per pad, day and story set.
 *
 * Organic rule: each sortie's orbit has its own radius, height, speed, direction and wobble, from the pad and story ids;
 * some hover and creep round instead of circling.
 */

/** A news pad with whose channel it is: the owner of the parcel the media centre stands on (the story's `ch`). */
export interface NewsPad extends Pad {
  owner: string;
  /** the channel's name on air ("Ada TV") and its colour: the helicopter's livery */
  channel: string;
  color: number;
}

export const NEWS_HELI = {
  /** stories smaller than this are not worth the helicopter (a house fire is 34 and up, a bus route 30, the showcase's drills 12) */
  minSalience: 10,
  kinds: ['fire', 'explosion', 'rank', 'milestone', 'opening', 'line'] as readonly StoryKind[],
  /** game minutes from the story breaking to lifting off */
  delay: [5, 14] as [number, number],
  /** it stays over the scene at least this long once there (game hours), even when the story ends sooner */
  onSceneMin: 1.5,
  /** the orbit: radius and height above the ground (tiles), speed along it (tiles a tick) */
  radius: [2.6, 4.4] as [number, number], height: [5.2, 7.6] as [number, number], speed: [0.12, 0.24] as [number, number],
  /** the share of sorties that hover and creep round slowly instead of circling */
  hoverShare: 0.22,
  /** the rush-hour traffic watches: their hours, how long they last (hours), how far out from the pad (tiles) */
  traffic: { hours: [8, 17], len: [0.6, 1.1] as [number, number], dist: [7, 16] as [number, number] },
};

const T_SPOOL = 9, T_LIFT = 6, T_TURN = 5, T_SETTLE = 8, T_SPIN = 10;
const T_UP = T_SPOOL + T_LIFT + T_TURN, T_DOWN = T_TURN + T_SETTLE + T_SPIN;
const V = HELI_TYPES.light.vCruise;
/** the fastest climb or descent between two points, tiles a tick */
const CLIMB = 0.08;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Something to fly to: a story, or a rush-hour traffic watch over a point near the pad. */
interface Mission {
  /** a story's id, or a traffic watch's negative key */
  id: number;
  story?: StoryDTO;
  x: number; z: number;
  go: number; stop: number;
  /** the orbit, per sortie */
  r: number; h: number; v: number; dir: 1 | -1; seed: number;
}

type P3 = { x: number; y: number; z: number };
type Seg =
  | { k: 'pad'; t0: number; t1: number }
  | { k: 'lift'; t0: number; t1: number; course: number }
  | { k: 'fly'; t0: number; t1: number; from: P3; to: P3; course: number; dist: number; prof: Profile; cruise: number; m: Mission | null; v0: number }
  | { k: 'orbit'; t0: number; t1: number; m: Mission; a0: number }
  | { k: 'land'; t0: number; t1: number; course: number };

/** Whether a story is one the helicopter flies to. */
export const newsWorthy = (s: StoryDTO) => !!s.ch && s.s >= NEWS_HELI.minSalience && NEWS_HELI.kinds.includes(s.k);

/**
 * When a story's helicopter lifts off and when it stops covering it (absolute ticks): when the story ends, but not before
 * it has had NEWS_HELI.onSceneMin over the scene, counted from when it gets there from `pad` (straight, at cruise). A
 * story live again after an end (`lit`) is flown to again from then.
 */
export function storyWindow(s: StoryDTO, pad?: Pick<Pad, 'x' | 'z'>): [number, number] {
  const t0 = s.lit ?? s.t;
  const go = t0 + Math.round(lerp(NEWS_HELI.delay[0], NEWS_HELI.delay[1], hash2(s.id * 7 + t0, 1201)) * TICKS_PER_MINUTE);
  const end = s.end ?? t0 + NEWS.liveHours[s.k] * TICKS_PER_HOUR;
  const there = pad ? T_UP + Math.hypot(s.x + 0.5 - pad.x, s.y + 0.5 - pad.z) / (V * 0.85) : 0;
  return [go, Math.max(end, Math.round(go + there + NEWS_HELI.onSceneMin * TICKS_PER_HOUR))];
}

function mission(pad: NewsPad, id: number, x: number, z: number, go: number, stop: number, story?: StoryDTO): Mission {
  const H = (k: number) => hash2(pad.id % 1000003 + id * 131, 1300 + k);
  const hover = H(0) < NEWS_HELI.hoverShare;
  return {
    id, story, x, z, go, stop,
    r: hover ? lerp(1.6, 2.4, H(1)) : lerp(NEWS_HELI.radius[0], NEWS_HELI.radius[1], H(1)),
    h: lerp(NEWS_HELI.height[0], NEWS_HELI.height[1], H(2)),
    v: hover ? lerp(0.015, 0.04, H(3)) : lerp(NEWS_HELI.speed[0], NEWS_HELI.speed[1], H(3)),
    dir: H(4) < 0.5 ? 1 : -1, seed: H(5),
  };
}

/** The stories one pad's helicopter covers: its channel's, nearest to it of that channel's pads (so two centres share). */
function padStories(pad: NewsPad, pads: readonly NewsPad[], stories: readonly StoryDTO[]): StoryDTO[] {
  const mine = pads.filter((p) => p.owner === pad.owner);
  const out: StoryDTO[] = [];
  for (const s of stories) {
    if (s.ch !== pad.owner || !newsWorthy(s)) continue;
    if (mine.length > 1) {
      let best = mine[0], bd = Infinity;
      for (const p of mine) { const d = Math.hypot(p.x - s.x - 0.5, p.z - s.y - 0.5); if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && p.id < best.id)) { best = p; bd = d; } }
      if (best.id !== pad.id) continue;
    }
    out.push(s);
  }
  return out.sort((a, b) => a.id - b.id);
}

const planCache = new Map<string, Seg[]>();

/** The segments of one pad's plan over the day `day` (and the day before, so a sortie under way at midnight carries on). */
function plan(pad: NewsPad, list: readonly StoryDTO[], day: number): Seg[] {
  let key = `${pad.id}|${Math.round(pad.x * 64)},${Math.round(pad.z * 64)},${Math.round(pad.y * 64)}|${day}|`;
  for (const s of list) key += `${s.id}:${s.t}:${s.lit ?? ''}:${s.end ?? ''}:${Math.round(s.x)},${Math.round(s.y)};`;
  const hit = planCache.get(key);
  if (hit) return hit;
  const out = build(pad, list, day);
  if (planCache.size > 64) planCache.clear();
  planCache.set(key, out);
  return out;
}

function build(pad: NewsPad, list: readonly StoryDTO[], day: number): Seg[] {
  const S = (day - 1) * TICKS_PER_DAY, E = (day + 1) * TICKS_PER_DAY;
  const ms: Mission[] = [];
  for (const s of list) {
    const [go, stop] = storyWindow(s, pad);
    if (stop > S && go < E) ms.push(mission(pad, s.id, s.x + 0.5, s.y + 0.5, go, stop, s));
  }
  // the rush-hour traffic watches of the day before and this day, over a point out from the pad
  for (const d of [day - 1, day]) NEWS_HELI.traffic.hours.forEach((h0, i) => {
    const H = (k: number) => hash2(pad.id % 1000003 + d * 977 + i * 31, 1400 + k);
    const go = Math.round(d * TICKS_PER_DAY + (h0 + (H(0) - 0.5) * 0.66) * TICKS_PER_HOUR);
    const stop = go + Math.round(lerp(NEWS_HELI.traffic.len[0], NEWS_HELI.traffic.len[1], H(1)) * TICKS_PER_HOUR);
    const a = H(2) * Math.PI * 2, r = lerp(NEWS_HELI.traffic.dist[0], NEWS_HELI.traffic.dist[1], H(3));
    ms.push(mission(pad, -(d * 2 + i + 1), pad.x + Math.cos(a) * r, pad.z + Math.sin(a) * r, go, stop));
  });
  const times = [...new Set(ms.flatMap((m) => [m.go, m.stop]))].filter((t) => t >= S && t < E).sort((a, b) => a - b);
  const choose = (t: number): Mission | null => {
    let best: Mission | null = null;
    for (const m of ms) {
      if (t < m.go || t >= m.stop) continue;
      // the newest live story first; a traffic watch only when no story is live
      if (!best || (m.story && (!best.story || m.id > best.story.id))) best = m;
    }
    return best;
  };
  const segs: Seg[] = [{ k: 'pad', t0: -Infinity, t1: Infinity }];
  let cur: Mission | null = null;
  for (const t of times) {
    const want = choose(t);
    if (want === cur) continue;
    retarget(pad, segs, t, want);
    cur = want;
  }
  return segs;
}

/** Re-plan from tick t: fly from wherever the helicopter is to mission m (or home when null). */
function retarget(pad: NewsPad, segs: Seg[], t: number, m: Mission | null) {
  let i = segs.findIndex((s) => t >= s.t0 && t < s.t1);
  if (i < 0) i = segs.length - 1;
  const s = segs[i];
  const hover: P3 = { x: pad.x, y: pad.y + HOVER, z: pad.z };
  if (s.k === 'pad') {
    if (!m) return;
    s.t1 = t;
    segs.length = i + 1;
    const lift: Seg = { k: 'lift', t0: t, t1: t + T_UP, course: 0 };
    segs.push(lift);
    const f = flyTo(hover, 0, lift.t1, m);
    lift.course = f.course;
    segs.push(f, orbitAfter(f, m));
    return;
  }
  if (s.k === 'lift') {
    // lifting off already: go on up, then head for the new target (or straight back down)
    segs.length = i + 1;
    if (!m) { s.t1 = t; segs.push({ k: 'land', t0: t, t1: t + T_DOWN, course: s.course }, { k: 'pad', t0: t + T_DOWN, t1: Infinity }); return; }
    const f = flyTo(hover, 0, s.t1, m);
    s.course = f.course;
    segs.push(f, orbitAfter(f, m));
    return;
  }
  // in the air: from where it is now
  const p = poseOf(pad, s, t);
  s.t1 = t;
  segs.length = i + 1;
  if (m) { const f = flyTo(p, p.speed, t, m); segs.push(f, orbitAfter(f, m)); return; }
  const f = flyHome(pad, p, p.speed, t);
  segs.push(f, { k: 'land', t0: f.t1, t1: f.t1 + T_DOWN, course: f.course }, { k: 'pad', t0: f.t1 + T_DOWN, t1: Infinity });
}

/** A flight between two points at the light twin's cruise, from speed v0 to v1, climbing to clear the town on a long hop. */
function fly(from: P3, to: P3, v0: number, v1: number, t0: number, m: Mission | null): Extract<Seg, { k: 'fly' }> {
  const dx = to.x - from.x, dz = to.z - from.z, dist = Math.max(1e-3, Math.hypot(dx, dz));
  // a short hop with a big change of height goes slower, so it never climbs faster than CLIMB
  const vMax = Math.min(V, Math.max(0.04, (dist * CLIMB) / Math.max(1e-3, Math.abs(to.y - from.y))));
  const prof = new Profile(Math.min(v0, vMax));
  const dAcc = Math.min(dist * 0.35, 3), dDec = Math.min(dist * 0.4, v1 < 0.05 ? 5 : 2.5);
  prof.ramp(vMax, dAcc).ramp(vMax, dist - dAcc - dDec).ramp(Math.min(v1, vMax), dDec);
  const top = Math.max(from.y, to.y);
  const cruise = dist > 12 ? Math.min(CRUISE_Y, top + 1.5 + dist * 0.05) : top;
  return { k: 'fly', t0, t1: t0 + prof.total, from, to, course: Math.atan2(dz, dx), dist, prof, cruise, m, v0 };
}
/** To where the orbit of m is joined: the point where the line from `from` meets its circle at a tangent, going its way round. */
function flyTo(from: P3, v0: number, t0: number, m: Mission) {
  const dx = from.x - m.x, dz = from.z - m.z, d = Math.hypot(dx, dz);
  const aP = Math.atan2(dz, dx);
  const a = d > m.r * 1.05 ? aP + m.dir * Math.acos(m.r / d) : aP;
  return fly(from, { x: m.x + Math.cos(a) * m.r, y: m.h, z: m.z + Math.sin(a) * m.r }, v0, m.v, t0, m);
}
function flyHome(pad: NewsPad, from: P3, v0: number, t0: number) {
  return fly(from, { x: pad.x, y: pad.y + HOVER, z: pad.z }, v0, 0, t0, null);
}
function orbitAfter(f: Extract<Seg, { k: 'fly' }>, m: Mission): Seg {
  return { k: 'orbit', t0: f.t1, t1: Infinity, m, a0: Math.atan2(f.to.z - m.z, f.to.x - m.x) };
}

/** The pose inside a segment: position, heading, speed and the bits the state needs. */
interface Pose extends P3 { heading: number; speed: number; acc: number; pitch: number; bank: number; rotor: number; phase: HeliPhase }
function poseOf(pad: NewsPad, s: Seg, t: number, seed = 0): Pose {
  const wob = (a: number, fr: number, o: number) => a * (Math.sin(t * fr + seed * 97 + o) * 0.6 + Math.sin(t * fr * 2.3 + seed * 165 + o) * 0.4);
  const base: Pose = { x: pad.x, y: pad.y, z: pad.z, heading: pad.heading, speed: 0, acc: 0, pitch: 0, bank: 0, rotor: 0, phase: 'onPad' };
  switch (s.k) {
    case 'pad': return base;
    case 'lift': {
      const u = t - s.t0;
      if (u < T_SPOOL) return { ...base, rotor: smooth01(u / T_SPOOL) };
      const w = smooth01((u - T_SPOOL) / T_LIFT * 1.5);
      return {
        ...base, phase: 'liftoff', rotor: 1,
        x: pad.x + wob(0.012, 0.9, 0) * w, z: pad.z + wob(0.012, 0.8, 2) * w,
        y: pad.y + HOVER * smooth01((u - T_SPOOL) / T_LIFT) + wob(0.008, 1.1, 4) * w,
        heading: pad.heading + wrapPi(s.course - pad.heading) * smooth01((u - T_SPOOL - T_LIFT * 0.6) / T_TURN),
        pitch: wob(0.02, 0.7, 6) * w, bank: wob(0.025, 0.6, 8) * w,
      };
    }
    case 'fly': {
      const [d, v, a] = s.prof.at(Math.min(t - s.t0, s.prof.total));
      const u = d / s.dist, fx = (s.to.x - s.from.x) / s.dist, fz = (s.to.z - s.from.z) / s.dist;
      // climb out and drop in steeply near the ends, easing into the cruise between
      const sd = s.dist - d;
      let y = lerp(s.from.y, s.to.y, smooth01(u));
      if (s.cruise > Math.max(s.from.y, s.to.y)) y = Math.max(y, Math.min(s.cruise, s.from.y + d * 0.9, s.to.y + sd * 0.6));
      const home = !s.m;
      return {
        x: s.from.x + fx * d, y: y + wob(0.02, 0.2, 12), z: s.from.z + fz * d, heading: s.course, speed: v, acc: a,
        pitch: clamp(-0.13 * (v / V) - 3.5 * a, -0.22, 0.2), bank: wob(0.025, 0.25, 10), rotor: 1,
        phase: home ? (sd < 6 ? 'approach' : 'outbound') : d < 5 && s.v0 < 0.05 ? 'departing' : 'inbound',
      };
    }
    case 'orbit': {
      const m = s.m, dt = t - s.t0;
      const r = m.r * (1 + 0.08 * Math.sin(dt * 0.013 + m.seed * 40) + 0.04 * Math.sin(dt * 0.031 + m.seed * 71));
      const ang = s.a0 + (m.dir * m.v * dt) / m.r;
      const y = m.h + 0.35 * Math.sin(dt * 0.009 + m.seed * 23) + 0.12 * Math.sin(dt * 0.027 + m.seed * 9);
      const v = m.v;
      return {
        x: m.x + Math.cos(ang) * r, y, z: m.z + Math.sin(ang) * r, heading: ang + m.dir * Math.PI / 2, speed: v, acc: 0,
        // banked into the turn by its speed, nose a touch down
        pitch: -0.13 * (v / V) * 0.6 + wob(0.012, 0.3, 14), bank: m.dir * clamp((v * v) / m.r * 9, 0, 0.32) + wob(0.02, 0.25, 16),
        rotor: 1, phase: 'onScene',
      };
    }
    case 'land': {
      const u = t - s.t0;
      if (u < T_TURN + T_SETTLE) {
        const k = clamp((u - T_TURN) / T_SETTLE, 0, 1), w = 1 - smooth01(k * 1.4 - 0.4);
        return {
          ...base, phase: 'landing', rotor: 1,
          x: pad.x + wob(0.012, 0.9, 1) * w, z: pad.z + wob(0.012, 0.8, 3) * w,
          y: pad.y + HOVER * (1 - smooth01(k)) + wob(0.008, 1.1, 5) * w,
          heading: s.course + wrapPi(pad.heading - s.course) * smooth01(u / T_TURN),
          pitch: wob(0.02, 0.7, 7) * w + 0.03 * (1 - k), bank: wob(0.025, 0.6, 9) * w,
        };
      }
      return { ...base, rotor: 1 - smooth01((u - T_TURN - T_SETTLE) / T_SPIN) };
    }
  }
}

const flights = new Map<number, HeliFlight>();
/** The flight record a news helicopter's state carries (one per pad, kept so a selection follows it from sortie to sortie). */
function flightOf(pad: NewsPad, day: number, n: number): HeliFlight {
  const id = -pad.id;
  let f = flights.get(id);
  const seed = hash2(pad.id % 1000003, 1501);
  if (!f) {
    if (flights.size > 64) flights.clear();
    f = {
      id, day, type: 'light', kind: 'news', seed, scale: clamp((pad.r * 2 * 1.3) / HELI_TYPES.light.rotor, 0.62, 1),
      stops: [{ pad, tDown: -Infinity, tUp: Infinity }], from: [pad.x, pad.z], to: [pad.x, pad.z], tStart: -Infinity, tEnd: Infinity, legs: [], legT: [],
    };
    flights.set(id, f);
  }
  f.day = day; f.stops[0].pad = pad;
  f.op = { name: pad.channel, body: pad.color, stripe: 0xf4f4f0, callsign: `News ${n}` };
  return f;
}

/**
 * Every news helicopter at this (fractional) tick, parked on its pad or out: one per news pad, flying for the channel
 * that owns the pad. `stories` is the client's story log (any order); uncovered stories and other channels' are skipped.
 */
export function newsHelisAt(pads: readonly NewsPad[], stories: readonly StoryDTO[], tick: number, out: HeliState[] = []): HeliState[] {
  out.length = 0;
  const day = Math.floor(tick / TICKS_PER_DAY);
  const sorted = [...pads].sort((a, b) => a.id - b.id);
  const count = new Map<string, number>();
  for (const pad of sorted) {
    const n = (count.get(pad.owner) ?? 0) + 1;
    count.set(pad.owner, n);
    out.push(newsHeliState(pad, sorted, stories, tick, day, n));
  }
  return out;
}

/** One news helicopter's state at a tick (newsHelisAt for all of them). */
export function newsHeliState(pad: NewsPad, pads: readonly NewsPad[], stories: readonly StoryDTO[], tick: number, day = Math.floor(tick / TICKS_PER_DAY), n = 1): HeliState {
  const segs = plan(pad, padStories(pad, pads, stories), day);
  let s = segs[segs.length - 1];
  for (const g of segs) if (tick >= g.t0 && tick < g.t1) { s = g; break; }
  const f = flightOf(pad, day, n);
  const p = poseOf(pad, s, tick, f.seed);
  const m = s.k === 'fly' ? s.m : s.k === 'orbit' ? s.m : null;
  const out = s.k === 'lift' ? nextMission(segs, s) : m;
  const doing = s.k === 'pad' ? 'parked' : s.k === 'orbit' ? 'live' : s.k === 'land' || (s.k === 'fly' && !s.m) ? 'home' : 'out';
  const air = s.k !== 'pad' && !(s.k === 'land' && tick - s.t0 >= T_TURN + T_SETTLE) && !(s.k === 'lift' && tick - s.t0 < T_SPOOL);
  return {
    flight: f, id: f.id, type: 'light', kind: 'news', seed: f.seed, scale: f.scale, phase: p.phase,
    pad: doing === 'parked' || doing === 'home' || s.k === 'lift' ? pad : null, stop: 0,
    x: p.x, y: p.y, z: p.z, heading: p.heading, pitch: p.pitch, bank: p.bank, rotor: p.rotor, speed: p.speed, fade: 1,
    lights: { nav: true, beacon: p.rotor > 0.05, strobe: air, landing: (s.k === 'fly' && !s.m && s.dist - (s.prof.at(tick - s.t0)[0]) < 10) || s.k === 'lift' || s.k === 'land' },
    news: {
      channel: pad.owner, name: pad.channel, doing,
      ...(out?.story ? { story: out.story.id } : {}), ...(out && !out.story ? { traffic: true } : {}),
      ...(out ? { look: [out.x, out.z] as [number, number] } : {}),
    },
  };
}
function nextMission(segs: Seg[], s: Seg): Mission | null {
  const i = segs.indexOf(s), n = segs[i + 1];
  return n && n.k === 'fly' ? n.m : null;
}

/** The pads of `kind` 'news' among these, with their channels: `owner(x, y)` is the parcel owner at the media centre's anchor. */
export function newsPadsOf(pads: readonly Pad[], owner: (x: number, y: number) => string | undefined, channel: (owner: string) => { name: string; color: number }): NewsPad[] {
  const out: NewsPad[] = [];
  for (const p of pads) {
    if (p.kind !== 'news') continue;
    const o = owner(p.bx, p.by);
    if (!o) continue;
    const c = channel(o);
    out.push({ ...p, owner: o, channel: c.name, color: c.color });
  }
  return out;
}
