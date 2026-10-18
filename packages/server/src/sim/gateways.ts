import {
  TICKS_PER_DAY, TICKS_PER_HOUR, Zone, GATEWAY_OF, MOTORWAY_KIND, hash2,
  type GatewaySpec, type GatewayMode, type GatewayInfo,
} from '@msimcity/shared';
import type { Building, Citizen, World } from '../world';
import { tkey } from '../world';

/**
 * Gateways (the gateways card): newcomers arrive through a motorway connection, a rail station or halt, a coach
 * (bus) depot or an airport terminal, travel to their new home and move in; leavers travel out to one before they
 * go. Which kinds are gateways and how many people each brings in an hour is catalogue data (shared/src/gateways.ts).
 *
 * This class is the bookkeeping: the live gates, their hourly capacity (a token bucket, topped up by planes landing
 * at an airport), the queue of newcomers waiting at each gate for a home that has room, the pick of a gate for an
 * arrival or a departure, and the per-day counts. The trips themselves are ordinary citizen trips planned by the
 * Simulation (citizens carry `mig`, see MIG). Nothing here is persisted: queues refill from demand after a restart.
 */
export const MIG = {
  /** travelling in from the gate (gx, gy) to their new home */
  In: 1,
  /** has decided to leave; sets off for a gate the next time they are at home */
  Leaving: 2,
  /** on the way out to the gate (gx, gy); removed on arrival */
  Out: 3,
} as const;

const REFRESH_EVERY = Math.max(1, Math.round(TICKS_PER_HOUR / 6)); // re-scan the built gateways every 10 game minutes
const RELEASE_EVERY = 5;
/** share of a plane's (or a ro-ro ferry's) arriving passengers who are moving here (the rest are visitors and returning residents) */
const PLANE_NEWCOMER_SHARE = 0.08;

/** `free`: one of a pioneer camp's first wave (wave), released when due whether or not the gate has a token left */
interface QueuedArrival { hx: number; hy: number; due: number; free?: boolean }
export interface Gate {
  key: number; x: number; y: number; kind: number; spec: GatewaySpec;
  /** the road tile in front of the door: cars start and end their trips on it rather than pulling out of the building */
  fx: number; fy: number;
  tokens: number; last: number;
  queue: QueuedArrival[];
  day: number; inToday: number; outToday: number; inYesterday: number; outYesterday: number;
}

export class Gateways {
  private gates = new Map<number, Gate>();
  /** newcomers queued per home tile (tkey), so the home is not offered twice */
  private pending = new Map<number, number>();
  /** arrivals the planner could not route from their gate (they moved straight in) since start */
  unroutable = 0;
  /** arrivals and departures through gateways since the simulation started (probes read these) */
  totals = { in: 0, out: 0, fallbackIn: 0, fallbackOut: 0, roadIn: 0 };

  private scanned = false;
  /** Has the cargo port whose door is (x, y) a sea route? (sim/harbours.ts, set by game.ts) A sea gate opens only with one. */
  seaRoute: ((x: number, y: number) => boolean) | null = null;

  constructor(private w: World) {}

  get any() { return this.gates.size > 0; }
  get list(): Iterable<Gate> { return this.gates.values(); }

  /** Re-scan the finished gateways: a motorway connection once built, the rest while they have staff on the books. */
  refresh() {
    const seen = new Set<number>();
    for (const b of this.w.builtOf(Zone.Hub)) {
      const spec = GATEWAY_OF[b.id];
      if (!spec || b.level === 0) continue;
      if (spec.type !== 'motorway' && b.occupants === 0) continue;
      if (spec.type === 'sea' && !this.seaRoute?.(b.x, b.y)) continue;
      const key = tkey(b.x, b.y);
      seen.add(key);
      if (this.gates.has(key)) continue;
      const burst = this.burst(spec);
      const st = this.w.structureAt(b.x, b.y);
      this.gates.set(key, { key, x: b.x, y: b.y, fx: st?.frontX ?? b.x, fy: st?.frontY ?? b.y, kind: b.id, spec, tokens: burst / 2, last: this.w.tick, queue: [], day: this.day, inToday: 0, outToday: 0, inYesterday: 0, outYesterday: 0 });
    }
    for (const [key, g] of this.gates) {
      if (seen.has(key)) continue;
      for (const q of g.queue) this.unpend(q.hx, q.hy);
      this.gates.delete(key);
    }
  }

  private burst(spec: GatewaySpec) { return Math.max(2, spec.perHour / 3); }
  private get day() { return Math.floor(this.w.tick / TICKS_PER_DAY); }
  private roll(g: Gate) {
    const d = this.day;
    if (g.day === d) return;
    g.inYesterday = g.day === d - 1 ? g.inToday : 0; g.outYesterday = g.day === d - 1 ? g.outToday : 0;
    g.inToday = 0; g.outToday = 0; g.day = d;
  }
  private queueMax(g: Gate) { return Math.max(6, Math.ceil(g.spec.perHour)); }

  pendingAt(x: number, y: number) { return this.pending.get(tkey(x, y)) ?? 0; }
  /** Beds at (x, y) spoken for by newcomers coming by other means (a camp's road wave, sim/firstfive.ts): spawn() leaves them. */
  reserve(x: number, y: number, n: number) { const k = tkey(x, y); this.pending.set(k, (this.pending.get(k) ?? 0) + n); }
  release(x: number, y: number) { this.unpend(x, y); }
  private unpend(x: number, y: number) {
    const k = tkey(x, y), n = (this.pending.get(k) ?? 1) - 1;
    if (n > 0) this.pending.set(k, n); else this.pending.delete(k);
  }

  /**
   * A home with room wants a newcomer: queue one at the best gate (nearest, weighted by capacity, a little noise so
   * neighbouring homes spread over the gates), due after `jitter` ticks. False when there is no gate at all (the
   * caller falls back to spawning in place); true also when every gate's queue is full (the newcomer does not come).
   */
  request(home: Building, jitter: number): boolean {
    if (!this.gates.size || this.w.filling) return false;
    let best: Gate | null = null, bestS = Infinity;
    for (const g of this.gates.values()) {
      if (g.queue.length >= this.queueMax(g)) continue;
      const d = Math.abs(g.x - home.x) + Math.abs(g.y - home.y);
      const s = (d + 8) / (0.5 + g.spec.perHour / 20) * (0.8 + 0.4 * Math.random());
      if (s < bestS) { bestS = s; best = g; }
    }
    if (!best) return true;
    best.queue.push({ hx: home.x, hy: home.y, due: this.w.tick + Math.floor(Math.random() * jitter) });
    const k = tkey(home.x, home.y);
    this.pending.set(k, (this.pending.get(k) ?? 0) + 1);
    return true;
  }

  /**
   * A pioneer camp's settlers (sim/firstfive.ts): n newcomers for `home` at the nearest gate, due spread over the next
   * `within` ticks. They are released as they fall due on a one-off allowance, past the gate's hourly bucket and its
   * queue limit, so the camp fills within the hour without holding anyone else up. False with no gate at all (the
   * caller moves them in at once).
   */
  wave(home: Building, n: number, within: number): boolean {
    if (!this.gates.size || this.w.filling) return false;
    let best: Gate | null = null, bestD = Infinity;
    for (const g of this.gates.values()) { const d = Math.abs(g.x - home.x) + Math.abs(g.y - home.y); if (d < bestD) { bestD = d; best = g; } }
    for (let i = 0; i < n; i++) best!.queue.push({ hx: home.x, hy: home.y, due: this.w.tick + Math.floor(((i + Math.random()) / n) * within), free: true });
    const k = tkey(home.x, home.y);
    this.pending.set(k, (this.pending.get(k) ?? 0) + n);
    return true;
  }

  /** Release the newcomers due at each gate while it has capacity this hour; `arrive` puts them on their way. */
  tick(arrive: (g: Gate, hx: number, hy: number) => void) {
    const now = this.w.tick;
    if (now % REFRESH_EVERY === 5 || !this.scanned) { this.scanned = true; this.refresh(); }
    if (now % RELEASE_EVERY !== 0) return;
    for (const g of this.gates.values()) {
      const burst = this.burst(g.spec);
      if (g.tokens < burst) g.tokens = Math.min(burst, g.tokens + ((now - g.last) * g.spec.perHour) / TICKS_PER_HOUR);
      g.last = now;
      if (!g.queue.length) continue;
      // due order is not queue order (each newcomer has their own jitter): release whoever is due
      for (let i = 0; i < g.queue.length;) {
        const q = g.queue[i];
        if (q.due > now || (g.tokens < 1 && !q.free)) { i++; continue; } // a camp's first wave rides on its own allowance
        g.queue[i] = g.queue[g.queue.length - 1]; g.queue.pop();
        this.unpend(q.hx, q.hy);
        if (!q.free) g.tokens -= 1;
        arrive(g, q.hx, q.hy);
      }
    }
  }

  /** A plane landed at the terminal whose door is (x, y): some of its passengers are moving here. */
  planeLanded(x: number, y: number, passengers: number) {
    const g = this.gates.get(tkey(x, y));
    if (!g) return;
    const add = passengers * PLANE_NEWCOMER_SHARE * (0.6 + 0.8 * Math.random());
    g.tokens = Math.min(this.burst(g.spec) + 40, g.tokens + add);
  }

  /** A ro-ro ferry berthed at the cargo port whose door is (x, y) (sim/harbours.ts): planeLanded's twin. */
  shipBerthed(x: number, y: number, passengers: number) { this.planeLanded(x, y, passengers); }

  /**
   * The gate a leaver heads for from (x, y): the nearest, with a car preferring the motorway and without one a
   * station or coach depot, each person weighing them by their own hash-seeded taste.
   */
  forDeparture(c: Citizen, x: number, y: number): Gate | null {
    let best: Gate | null = null, bestS = Infinity;
    for (const g of this.gates.values()) {
      const d = Math.abs(g.x - x) + Math.abs(g.y - y);
      const m = g.spec.modes;
      const w = c.car ? (m.includes('car') ? 0.7 : 1.2) : (m.includes('foot') ? 0.8 : 1.3);
      const s = (d + 4) * w * (0.85 + 0.3 * hash2(c.id, 300 + (g.key % 97)));
      if (s < bestS) { bestS = s; best = g; }
    }
    return best;
  }

  /** How a newcomer or leaver gets between the gate and home: their own car through a motorway, else a taxi when it is further than they care to walk with luggage. */
  modeFor(g: Gate, c: Citizen, dist: number): GatewayMode {
    const m = g.spec.modes;
    if (m.includes('car') && c.car) return 'car';
    const walkMax = 6 + 14 * hash2(c.id, 301); // tiles this person will carry a suitcase
    if (m.includes('taxi') && (dist > walkMax || !m.includes('foot'))) return 'taxi';
    return m.includes('foot') ? 'foot' : 'taxi';
  }

  at(x: number | undefined, y: number | undefined): Gate | undefined { return x === undefined || y === undefined ? undefined : this.gates.get(tkey(x, y)); }
  /** A pseudo-gate (key -1: a road end a camp's settlers come up, sim/firstfive.ts) counts under `roadIn`, not as a gateway arrival. */
  noteIn(g: Gate) { this.roll(g); g.inToday++; if (g.key < 0) this.totals.roadIn++; else this.totals.in++; }
  noteOut(g: Gate | undefined) { this.totals.out++; if (g) { this.roll(g); g.outToday++; } }

  /** Road entry points for through-traffic and inter-city freight: the road in front of each motorway connection. */
  motorwayEntries(): [number, number][] {
    const out: [number, number][] = [];
    for (const g of this.gates.values()) if (g.kind === MOTORWAY_KIND) out.push([g.fx, g.fy]);
    return out;
  }

  /** Today's arrivals and departures over every gate, and the newcomers queued. */
  today(): { in: number; out: number; waiting: number } {
    let i = 0, o = 0, q = 0;
    for (const g of this.gates.values()) { this.roll(g); i += g.inToday; o += g.outToday; q += g.queue.length; }
    return { in: i, out: o, waiting: q };
  }

  /** The inspect panel's figures for the gateway whose door is (x, y). */
  describe(b: Building, enRoute: number): GatewayInfo | undefined {
    const spec = GATEWAY_OF[b.id];
    if (!spec) return undefined;
    const g = this.gates.get(tkey(b.x, b.y));
    if (g) this.roll(g);
    return {
      type: spec.type, modes: spec.modes, perHour: spec.perHour,
      arrivalsToday: g?.inToday ?? 0, departuresToday: g?.outToday ?? 0, arrivalsYesterday: g?.inYesterday ?? 0, departuresYesterday: g?.outYesterday ?? 0,
      waiting: g?.queue.length ?? 0, enRoute, open: !!g,
    };
  }
}
