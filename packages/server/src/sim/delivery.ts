import {
  TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE, gameMin, CitizenState, LifeStage, Zone, FleetKind, FOOD, MOBILE,
  tileKey, hash2, kindManifest, signSource, signText, isFoodVenue,
} from '@msimcity/shared';
import type { Building, Citizen, World } from '../world';
import { tkey } from '../world';
import { noteIncome, noteSpend } from './life';
import type { Mobile, Unit, Stop, FleetService, FleetInfoRows } from './mobile';

const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
const S = CitizenState;
/** homes are rolled once per this many ticks, a rotating slice each tick (like freight) */
const ROLL_EVERY = 10;
/** households per resident, for the order rate (a home of 12 is about 7 households) */
const HOUSEHOLDS_PER_RESIDENT = 0.6;
/** what a stop is for: collecting from the kitchen, handing over at the door */
const COLLECT = 1, DROP = 2;

interface Order {
  id: number;
  home: [number, number];
  venue: [number, number];
  placed: number;
  ready: number;
  /** cooking: in the kitchen, nobody sent for it yet; assigned: a rider is on the way to collect it; out: on the bike */
  state: 'cooking' | 'assigned' | 'out' | 'done' | 'cancelled';
  /** the meal's price (the venue's level) */
  meal: number;
  vid: number;
}

/**
 * Food delivery (docs/mobile-jobs.md section 3). Homes order at lunch and dinner from a food venue within reach; the
 * kitchen takes 8-18 game minutes. Riders are on a venue's payroll and wait there between jobs, but work like a
 * delivery app's: shortly before an order is ready the nearest free rider within FOOD.riderReach is sent to collect it
 * (with up to two more ready there for homes close by), rides to each kerb, stands at the door and rides back. A
 * resident at home pays for the meal (sales tax to the venue's parcel, like a visit) and a delivery fee to the venue's
 * owner, and tips the rider.
 */
export class Delivery implements FleetService {
  readonly kinds = [FleetKind.Bicycle, FleetKind.Moped];
  private orders = new Map<number, Order>();
  /** orders nobody has been sent for yet, oldest first */
  private open: Order[] = [];
  private nextId = 1;
  /** riders on shift now, refreshed with each roll */
  private onShift = 0;
  /** grown-ups by home tile key, rebuilt once a game hour (who is in to pay) */
  private homes = new Map<number, Citizen[]>();
  private homesAt = -1;
  /** per venue: today's orders and deliveries */
  private venues = new Map<number, { day: number; orders: number; done: number; yOrders: number; yDone: number }>();
  /** since start (loadtest/mobile.ts reads these); minutes: order to door, per delivery */
  stats = { placed: 0, delivered: 0, cancelled: 0, failed: 0, handedBack: 0, batched: 0, busy: 0, noVenue: 0, money: 0 };
  minutes: number[] = [];

  constructor(private w: World, private mobile: Mobile) {}

  private hour() { return (this.w.tick % DAY) / TPH; }
  private mealtime(h: number) { return (h >= FOOD.lunch[0] && h < FOOD.lunch[1]) || (h >= FOOD.dinner[0] && h < FOOD.dinner[1]); }
  venueName(x: number, y: number): string {
    const b = this.w.buildings.get(tileKey(x, y)), k = b ? kindManifest(b.id) : undefined;
    return k ? signText(signSource(k, x, y)) : 'the restaurant';
  }

  tick() {
    if (!MOBILE.on) return;
    const w = this.w, tick = w.tick, h = this.hour();
    const slot = tick % ROLL_EVERY;
    if (slot === 0) { this.onShift = 0; for (const kind of this.kinds) this.onShift += this.mobile.onShift(kind).length; }
    if (this.mealtime(h) && this.onShift > 0) {
      // order rolls: each home once per ROLL_EVERY ticks
      const homes = w.builtOf(Zone.Residential), n = homes.length;
      const rate = h < 16 ? FOOD.lunchRate / (FOOD.lunch[1] - FOOD.lunch[0]) : FOOD.dinnerRate / (FOOD.dinner[1] - FOOD.dinner[0]);
      const i0 = Math.floor((n * slot) / ROLL_EVERY), i1 = Math.floor((n * (slot + 1)) / ROLL_EVERY);
      for (let i = i0; i < i1; i++) {
        const b = homes[i];
        if (!b.occupants) continue;
        const taste = 0.3 + 1.4 * hash2(b.x * 37 + 11, b.y * 53 + 7); // some streets order in a lot more than others
        const p = (b.occupants * HOUSEHOLDS_PER_RESIDENT * rate * taste * ROLL_EVERY) / TPH;
        if (Math.random() < p) this.place(b);
      }
    }
    if (tick % 2 === 0) this.dispatch();
  }

  /** Someone at home b orders a meal from a food venue within reach, unless every rider has more than enough to do. */
  private place(b: Building) {
    const w = this.w, tick = w.tick;
    if (this.open.length >= FOOD.busyPerRider * this.onShift) { this.stats.busy++; return; } // the app says "busy, try later"
    if (!this.payerAt(b.x, b.y, 15)) return; // nobody in with the money for it
    const v = w.bestBuiltNear(b.x, b.y, [Zone.Commercial], FOOD.reach, 4, (c, d) => (isFoodVenue(c.id, c.x, c.y) ? 4 * Math.random() - d / 3 : null), (c) => w.hasRoadAccess(c.x, c.y));
    if (!v) { this.stats.noVenue++; return; }
    const prep = gameMin(FOOD.prepMin + Math.random() * (FOOD.prepMax - FOOD.prepMin));
    const o: Order = { id: this.nextId++, home: [b.x, b.y], venue: [v.x, v.y], placed: tick, ready: tick + prep, state: 'cooking', meal: FOOD.mealBase + Math.min(4, v.level), vid: 0 };
    this.orders.set(o.id, o);
    this.open.push(o);
    this.venueDay(v.x, v.y).orders++;
    this.stats.placed++;
  }
  private venueDay(x: number, y: number) {
    const k = tkey(x, y), day = Math.floor(this.w.tick / DAY);
    let v = this.venues.get(k);
    if (!v) this.venues.set(k, v = { day, orders: 0, done: 0, yOrders: 0, yDone: 0 });
    if (v.day !== day) { const y1 = v.day === day - 1; v.yOrders = y1 ? v.orders : 0; v.yDone = y1 ? v.done : 0; v.orders = 0; v.done = 0; v.day = day; }
    return v;
  }
  /** A grown-up at home at (x, y) with at least `money`, or null. */
  private payerAt(x: number, y: number, money: number): Citizen | null {
    const w = this.w;
    if (w.tick - this.homesAt >= TPH || this.homesAt < 0) {
      this.homes.clear(); this.homesAt = w.tick;
      for (const c of w.citizens.values()) {
        if (c.stage === LifeStage.Child) continue;
        const k = tkey(c.hx, c.hy);
        let l = this.homes.get(k);
        if (!l) this.homes.set(k, l = []);
        l.push(c);
      }
    }
    for (const c of this.homes.get(tkey(x, y)) ?? []) if (c.state === S.Home && c.money >= money && w.citizens.has(c.id)) return c;
    return null;
  }

  /**
   * Send riders for orders nearly ready, oldest first: the nearest free rider within riderReach of the kitchen (waiting
   * at their own venue, or riding back with nothing aboard), with up to batchMax orders from that kitchen for homes close
   * together. Orders nobody could be sent for within cancelAfter of being ready are cancelled.
   */
  private dispatch() {
    const tick = this.w.tick;
    const lead = gameMin(FOOD.leadMin);
    for (let i = 0; i < this.open.length; i++) {
      const o = this.open[i];
      if (o.state !== 'cooking') { this.open.splice(i--, 1); continue; }
      if (tick - o.ready > gameMin(FOOD.cancelAfter)) { this.open.splice(i--, 1); o.state = 'cancelled'; this.orders.delete(o.id); this.stats.cancelled++; continue; }
      if (o.ready - tick > lead) continue;
      const r = this.nearestRider(o.venue);
      if (!r) continue;
      const take = [o];
      for (let j = i + 1; j < this.open.length && take.length < FOOD.batchMax; j++) {
        const p = this.open[j];
        if (p.state !== 'cooking' || p.venue[0] !== o.venue[0] || p.venue[1] !== o.venue[1] || p.ready - tick > lead) continue;
        if (Math.abs(p.home[0] - o.home[0]) + Math.abs(p.home[1] - o.home[1]) > FOOD.batchReach) continue;
        take.push(p);
      }
      const stops: Stop[] = [this.mobile.stopAt(o.venue[0], o.venue[1], 2, COLLECT, o.id), ...take.map((t) => this.mobile.stopAt(t.home[0], t.home[1], FOOD.doorDwell, DROP, t.id))];
      const task = `riding to ${this.venueName(o.venue[0], o.venue[1])} to collect ${take.length > 1 ? `${take.length} orders` : 'an order'}`;
      const u = r.unit ? (this.mobile.retask(r.unit, stops, task) ? r.unit : null) : this.mobile.launch(this, r.c, r.kind, [r.c.wx, r.c.wy], [r.c.wx, r.c.wy], stops, task);
      if (!u || !u.stops.some((s) => s.what === COLLECT && s.ref === o.id)) continue; // try again later
      for (const t of take) { t.state = 'assigned'; t.vid = u.v.id; }
      this.stats.batched += take.length - 1;
      this.open.splice(i--, 1);
    }
  }
  /** The free rider nearest a kitchen within riderReach: at their own venue, or riding back empty. */
  private nearestRider(at: [number, number]): { c: Citizen; kind: number; unit?: Unit } | null {
    let best: { c: Citizen; kind: number; unit?: Unit } | null = null, bd = FOOD.riderReach + 1;
    for (const kind of this.kinds) for (const c of this.mobile.onShift(kind)) {
      if (!this.mobile.free(c)) continue;
      const u = this.mobile.unitOf(c.id);
      const x = u ? Math.floor(u.v.x) : c.wx, y = u ? Math.floor(u.v.y) : c.wy;
      const d = Math.abs(x - at[0]) + Math.abs(y - at[1]);
      if (d < bd) { bd = d; best = { c, kind, unit: u }; }
    }
    return best;
  }

  // ---- the rider's side (FleetService) -----------------------------------------------------------------------------

  arrive(u: Unit, s: Stop) {
    const w = this.w, tick = w.tick;
    if (s.what === COLLECT) {
      // at the kitchen: wait for whatever is not ready yet, then it all goes in the box
      let ready = tick;
      for (const t of u.stops) { const o = t.what === DROP ? this.orders.get(t.ref) : undefined; if (o && o.state === 'assigned') { o.state = 'out'; ready = Math.max(ready, o.ready); } }
      u.dwellUntil = Math.max(u.dwellUntil, ready);
      u.loaded = true;
      u.task = `collecting at ${this.venueName(s.bx, s.by)}`;
      return;
    }
    const o = this.orders.get(s.ref);
    if (!o || o.state !== 'out') return;
    o.state = 'done';
    this.orders.delete(o.id);
    this.stats.delivered++;
    this.minutes.push((tick - o.placed) / TICKS_PER_MINUTE);
    // whoever is in pays: the meal (sales tax to the venue's parcel, as a visit), the fee to its owner, a tip to the rider
    const payer = this.payerAt(o.home[0], o.home[1], 0);
    const total = o.meal + FOOD.fee + FOOD.tip;
    if (payer) { const paid = Math.min(total, Math.max(0, payer.money)); payer.money -= paid; noteSpend(payer, paid, tick); }
    const parcel = w.parcelAt(o.venue[0], o.venue[1]);
    if (parcel) {
      const tax = o.meal * parcel.taxRate;
      w.credit(parcel.owner, tax); parcel.stats.taxToday += tax; w.dirtyParcels.add(parcel.id);
      w.credit(parcel.owner, FOOD.fee, 'fees');
    }
    const rider = w.citizens.get(u.worker);
    if (rider) { rider.money += FOOD.tip; noteIncome(rider, FOOD.tip, tick); }
    this.mobile.note(u, FOOD.tip);
    this.stats.money += total;
    this.venueDay(o.venue[0], o.venue[1]).done++;
    u.task = `at the door of (${o.home[0]}, ${o.home[1]})`;
  }
  depart(u: Unit, _s: Stop) {
    const next = u.stops[0];
    const o = next ? this.orders.get(next.ref) : undefined;
    if (o) u.task = `delivering an order from ${this.venueName(o.venue[0], o.venue[1])} to (${o.home[0]}, ${o.home[1]})`;
    else { u.loaded = false; u.task = `riding back to ${this.venueName(u.base[0], u.base[1])}`; }
  }
  unreachable(u: Unit, s: Stop) {
    // a kitchen it cannot get to: its orders go back on the list for someone else; a door it cannot get to: the order is lost
    if (s.what === COLLECT) {
      for (const t of u.stops) { const o = t.what === DROP ? this.orders.get(t.ref) : undefined; if (o && o.state === 'assigned') { o.state = 'cooking'; o.vid = 0; this.open.unshift(o); } }
      u.stops = [];
    } else this.drop(s.ref);
    if (!u.stops.length) u.loaded = false;
  }
  withdrawn(u: Unit, _at: [number, number]) {
    // the rider gave up in a jam: what they were carrying goes back to its kitchen for the next rider
    for (const s of u.stops) {
      const o = s.what === DROP ? this.orders.get(s.ref) : undefined;
      if (!o || (o.state !== 'assigned' && o.state !== 'out')) continue;
      o.state = 'cooking'; o.vid = 0; o.ready = Math.min(o.ready, this.w.tick);
      this.open.unshift(o);
      this.stats.handedBack++;
    }
  }
  returned(_u: Unit) {}
  private drop(id: number) {
    const o = this.orders.get(id);
    if (!o) return;
    o.state = 'cancelled'; this.orders.delete(id); this.stats.failed++;
  }

  label(u: Unit) { return `${this.venueName(u.base[0], u.base[1])} rider`; }
  baseName(c: Citizen) { return this.venueName(c.wx, c.wy); }
  /** A food venue's tooltip: its riders, orders in the kitchen, deliveries today and yesterday. */
  describe(bx: number, by: number, kindId: number): FleetInfoRows | null {
    if (!isFoodVenue(kindId, bx, by)) return null;
    let bikes = 0, mopeds = 0, outNow = 0;
    for (const kind of this.kinds) for (const c of this.mobile.onShift(kind)) {
      if (c.wx !== bx || c.wy !== by) continue;
      if (kind === FleetKind.Bicycle) bikes++; else mopeds++;
      if (this.mobile.unitOf(c.id)) outNow++;
    }
    let cooking = 0, waiting = 0;
    const tick = this.w.tick;
    for (const o of this.orders.values()) if (o.venue[0] === bx && o.venue[1] === by && (o.state === 'cooking' || o.state === 'assigned')) { if (o.ready > tick) cooking++; else waiting++; }
    const v = this.venueDay(bx, by);
    if (!bikes && !mopeds && !cooking && !waiting && !v.orders && !v.yOrders) return null;
    return {
      role: 'takeaway and delivery',
      rows: [
        ['Its riders on shift', bikes + mopeds ? `${bikes} on bicycles, ${mopeds} on mopeds${outNow ? ` (${outNow} out)` : ''}` : 'none just now'],
        ['In the kitchen', `${cooking} cooking, ${waiting} ready for a rider`],
        ['Orders', `${v.orders} today (${v.done} delivered) · ${v.yOrders} yesterday`],
      ],
    };
  }
}
