import { Quaternion, Vector3 } from 'three';
import {
  hash2, TRANSIT, METRO, TRAIN_VMAX, AIRLINES, SEATS, liveryIndex, flightAboard,
  type CitizenInfo, type FlightManifest, type FlightState, type RailLineDTO,
} from '@msimcity/shared';
import type { CabEye, Aboard } from './render/fpv';
import type { CitizensView } from './render/citizens';
import { carPose, type TrainsView } from './render/trains';
import type { PlanesView } from './render/planes';
import type { TunnelFeed } from './render/tunnelRide';
import { passengerFeed } from './render/passengerInterior';
import { pickSeat, cabinSeat, seat } from './render/passenger';
import { sceneUniforms } from './render/materials';
import { trainKmh, planeDoing, planeFeet } from './vehicles';
import { KMH_PER_TPS } from './render/vehicleInterior';

const UP = new Vector3(0, 1, 0), AXIS_Z = new Vector3(0, 0, 1);
/** places in a carriage (server sim/rail.ts SEATS_PER_CAR) */
const RAIL_CAR_RIDERS = 40;
/** the HUD's words are rebuilt at most this often (ms) */
const WORDS_MS = 400;

export interface SeatSources {
  citizens: CitizensView;
  trains: TrainsView;
  planes: PlanesView;
  /** a metro line's station names in calling order (the 'metroLines' message), for the tunnel's boards */
  metroNames(line: number): string[] | undefined;
}

/**
 * The first-person eye of a passenger (render/passenger.ts, render/fpv.ts): from the pose each vehicle was drawn with this frame, the
 * seat's eye and orientation, the interior's feed, the tunnel's for a tube car, and the HUD's words. One eye object is reused (no
 * allocation per frame); its words are rebuilt a couple of times a second and `rev` says when they changed.
 */
export class SeatEyes {
  private st = seat();
  private pose = carPose();
  private feed = passengerFeed();
  private tunnel: TunnelFeed = { geom: null as unknown as TunnelFeed['geom'], s: 0, dir: 1, off: 0, line: 0, colour: 0, names: [], stop: 0, dwelling: false };
  private q = new Quaternion();
  private v = new Vector3();
  private eye: CabEye = { key: '', x: 0, y: 0, z: 0, q: new Quaternion(), label: '', lines: ['', '', ''], passenger: this.feed, rev: 0 };
  private wordsAt = -1e9; private wordsKey = '';
  private line: RailLineDTO | undefined;
  private nextRaw: string | undefined = ''; private next = '';
  private keyNum = -1;
  /** the eye's key ('c<bus>', 't<line>:<train>:<dir>'), made only when it changes */
  private keyOf(n: number, k: string, a: number, b = 0, c = 0): string {
    if (n !== this.keyNum) { this.keyNum = n; this.eye.key = k === 'c' ? `c${a}` : `t${a}:${b}:${c}`; }
    return this.eye.key;
  }

  constructor(private d: SeatSources) {}

  /** A citizen's seat in the bus, carriage or tube car the inspect says they are aboard, or null when that vehicle is not drawn here. */
  seat(ab: Aboard, rider: number, info: CitizenInfo): CabEye | null {
    const e = this.eye, f = this.feed, st = this.st, now = performance.now();
    e.tunnel = undefined; e.instruments = undefined; e.fogFar = undefined;
    if (ab.mode === 'bus') {
      const a = this.d.citizens.agents.get(ab.vehicle);
      if (!a || !a.car) return null;
      pickSeat('bus', rider, null, 1, st);
      const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
      // the bus's frame: +x along its heading (cos ang, -sin ang), +z to its right (sin ang, cos ang)
      e.x = a.rx + ca * st.x + sa * st.z; e.z = a.rz - sa * st.x + ca * st.z;
      e.y = this.d.citizens.roadY(a.rx, a.rz, a.hx, a.hy) + st.y;
      e.q.setFromAxisAngle(UP, a.ang - st.yaw);
      const speed = Math.hypot(a.vx, a.vy) * 1000; // tiles a second, as drawn (render/glide.ts)
      e.key = this.keyOf(ab.vehicle * 4 + 3, 'c', ab.vehicle); e.dip = st.dip; e.sway = Math.min(1, speed / 2.5) * 0.9; e.seed = hash2(ab.vehicle, 433);
      f.kind = 'bus'; f.vseed = hash2(ab.vehicle, 431); f.colour = this.d.citizens.liveryOf(ab.vehicle) ?? 0xe6b734;
      f.fill = ab.load / TRANSIT.busCapacity; f.next = ab.next ?? ''; f.stopping = speed < 0.06; f.doors = f.stopping; f.speed = speed;
      this.common(f);
      if (now - this.wordsAt > WORDS_MS) this.words(`${info.name} · on the bus`, info.activity, ab.next ? `next stop ${ab.next}` : '', `${Math.round(speed * KMH_PER_TPS)} km/h`, now);
      return e;
    }
    const tr = this.d.trains, svc = tr.serviceOf(ab.line), train = ab.train ?? 0;
    if (!svc) return null;
    if (this.line?.id !== ab.line) this.line = tr.lines.find((l) => l.id === ab.line);
    const kind = ab.mode === 'metro' ? 'metro' : 'rail';
    const kinds = svc.consists[train] ?? svc.consists[0];
    pickSeat(kind, rider, kinds, 1, st);
    const p = tr.carOf(ab.line, train, st.car, this.pose);
    if (!p || !p.st) return null;
    pickSeat(kind, rider, kinds, p.dir, st); // the same car; the seat faces the way the train runs now
    const ch = Math.cos(p.h), sh = Math.sin(p.h);
    // the car's frame: +x along the track towards the train's front (cos h, sin h), +z to its right (-sin h, cos h)
    e.x = p.x + ch * st.x - sh * st.z; e.z = p.z + sh * st.x + ch * st.z; e.y = p.y + st.y;
    e.q.setFromAxisAngle(UP, -p.h);
    if (p.pitch) e.q.multiply(this.q.setFromAxisAngle(AXIS_Z, p.pitch)); // down a crossover's dip
    e.q.multiply(this.q.setFromAxisAngle(UP, -st.yaw));
    const ts = p.st, colour = this.line?.color ?? 0x888888;
    // a train reversing at a terminus turns the seat round: a new key, so the view blinks rather than swings
    e.key = this.keyOf((ab.line * 16 + train) * 4 + (p.dir > 0 ? 1 : 0), 't', ab.line, train, p.dir); e.dip = st.dip; e.sway = (ts.v / TRAIN_VMAX) * (p.metro ? 1.4 : 1); e.seed = hash2(ab.line * 16 + train, 437);
    let riders = 0;
    for (const k of kinds) if (k === 1 || k === 2 || k === 7 || k === 8) riders++;
    f.kind = kind; f.vseed = hash2(ab.line * 16 + train + st.car * 997, 435); f.colour = colour;
    f.fill = ab.load / Math.max(1, riders * (p.metro ? METRO.carRiders : RAIL_CAR_RIDERS));
    if (ab.next !== this.nextRaw) { this.nextRaw = ab.next; this.next = (ab.next ?? '').replace(/ \(-?\d+, -?\d+\)$/, ''); } // a station's name without its tile
    const next = this.next;
    f.next = next; f.stopping = ts.phase === 'dwell'; f.doors = ts.doors; f.speed = ts.v / TRAIN_VMAX;
    this.common(f);
    if (p.metro) {
      const t = this.tunnel;
      t.geom = svc.geom; t.s = p.s + st.x; t.dir = p.dir; t.off = p.off; t.line = ab.line; t.colour = colour;
      t.names = this.d.metroNames(ab.line) ?? t.names; t.stop = ts.stop; t.dwelling = ts.phase === 'dwell';
      e.tunnel = t;
    }
    if (now - this.wordsAt > WORDS_MS) {
      const name = this.line ? (this.line.name === `Line ${this.line.number}` ? `line ${this.line.number}` : this.line.name) : 'the line';
      this.words(`${info.name} · ${name} · ${p.metro ? 'car' : 'carriage'} ${st.car + 1}`, info.activity,
        ts.phase === 'dwell' ? (ts.doors ? 'standing · doors open' : 'standing') : next ? `next stop ${next}` : 'running', `${trainKmh(ts.v)} km/h`, now);
    }
    return e;
  }

  /**
   * A plane's cabin from a seat of its manifest (render/passenger.ts cabinSeat): the window 70 degrees off the nose, banking with the
   * plane; the seat-belt sign by phase, the screen's route map, the wing outside for wing rows.
   */
  cabin(s: FlightState, m: FlightManifest, seatLabel: string, who: string, key: string, knots: () => number): CabEye | null {
    const st = cabinSeat(s.type, seatLabel, this.st);
    if (!st) return null;
    const e = this.eye, f = this.feed, now = performance.now();
    this.d.planes.cabinOf(s, st.x, st.y, st.z, st.yaw, this.v, e.q);
    e.x = this.v.x; e.y = this.v.y; e.z = this.v.z;
    e.key = key; e.dip = st.dip; e.sway = s.y > 0.05 ? 0.5 : 0.18; e.seed = s.seed; e.fogFar = 150; e.tunnel = undefined; e.instruments = undefined;
    const ph = s.phase, inbound = ph === 'approach' || ph === 'flare' || ph === 'rollout' || ph === 'taxiIn' || (ph === 'dwell' && s.progress < 0.5);
    f.kind = 'plane'; f.plane = s.type; f.phase = ph; f.vseed = s.seed; f.colour = AIRLINES[liveryIndex(s.seed)].tail;
    f.fill = flightAboard(m, ph, s.progress).count / SEATS[s.type];
    f.flown = ph === 'takeoff' ? 0.005 : ph === 'rotate' ? 0.01 : ph === 'climb' ? 0.01 + 0.08 * s.progress : ph === 'approach' ? 0.9 + 0.08 * s.progress : ph === 'flare' ? 0.985 : ph === 'rollout' ? 0.995 : -1;
    f.from = inbound ? m.origin : 'here'; f.to = inbound ? 'here' : m.destination;
    f.belts = ph !== 'dwell'; f.next = ''; f.stopping = false; f.doors = ph === 'dwell'; f.speed = 0;
    this.common(f);
    f.dim = f.night > 0.5 || ph === 'approach' || ph === 'flare';
    if (now - this.wordsAt > WORDS_MS) {
      const no = inbound ? m.inbound : m.outbound, kt = knots();
      this.words(`${no} · ${m.airline} · seat ${seatLabel}${who ? ` · ${who}` : ''}`, planeDoing(s, m), `${s.y > 0.05 ? `${planeFeet(s.y).toLocaleString()} ft · ` : ''}${kt} kt`, '', now);
    }
    return e;
  }

  private common(f: typeof this.feed) {
    f.seat = this.st; f.night = sceneUniforms.uNight.value; f.dim = false;
  }

  /** the HUD's label and lines; `rev` moves only when they changed */
  private words(label: string, a: string, b: string, c: string, now: number) {
    this.wordsAt = now;
    const key = `${label}|${a}|${b}|${c}`;
    if (key === this.wordsKey) return;
    this.wordsKey = key;
    const e = this.eye;
    e.label = label;
    e.lines.length = 0;
    for (const l of [a, b, c]) if (l) e.lines.push(l);
    e.rev = (e.rev ?? 0) + 1;
  }
}
