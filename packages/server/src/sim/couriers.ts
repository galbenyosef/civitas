import { TICKS_PER_DAY, TICKS_PER_HOUR, Zone, FleetKind, COURIER, MOBILE, hash2, isCourierDepot, kindManifest, signSource, signText, tileKey } from '@msimcity/shared';
import type { Citizen, World } from '../world';
import { tkey } from '../world';
import type { Mobile, Unit, Stop, FleetService, FleetInfoRows } from './mobile';

const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
/** households per resident, as for food orders */
const HOUSEHOLDS_PER_RESIDENT = 0.6;
/** a van wave goes out within this many hours of its start (each van at its own minute) */
const WAVE_SPREAD = 1.5;
const DROP = 1;

interface Parcel { id: number; home: [number, number]; at: number }

/**
 * Parcel couriers (docs/mobile-jobs.md section 5). Warehouses, freight depots and distribution centres (and a hashed
 * share of other industry) are parcel depots, and about a third of their staff drive vans. Homes get parcels through
 * the day, each sent to the nearest depot within reach; vans leave in two waves, morning and early afternoon, with up
 * to COURIER.vanLoad parcels in nearest-neighbour order, pull up at each kerb for a few ticks and come back. The depot's
 * owner is paid per parcel; what is not delivered today goes out tomorrow.
 */
export class Couriers implements FleetService {
  readonly kinds = [FleetKind.CourierVan];
  /** parcels waiting at each depot (tile key), oldest first */
  private waiting = new Map<number, Parcel[]>();
  /** parcels on a van, by id */
  private onVan = new Map<number, Parcel>();
  /** the stop each parcel is behind (stop ref -> parcel ids) */
  private byStop = new Map<number, number[]>();
  private nextId = 1; private nextStop = 1;
  private rolledHour = -1;
  private depots = new Map<number, { day: number; done: number; yDone: number; vans: number }>();
  /** since start (loadtest/mobile.ts reads these) */
  stats = { parcels: 0, delivered: 0, vans: 0, returned: 0, noDepot: 0, fees: 0 };
  /** hours from ordering to the door, per delivered parcel */
  hours: number[] = [];

  constructor(private w: World, private mobile: Mobile) {}

  depotName(x: number, y: number): string {
    const b = this.w.buildings.get(tileKey(x, y)), k = b ? kindManifest(b.id) : undefined;
    return k ? signText(signSource(k, x, y)) : 'the depot';
  }

  tick() {
    if (!MOBILE.on) return;
    const w = this.w, tick = w.tick, hourIdx = Math.floor(tick / TPH), h = (tick % DAY) / TPH;
    // parcels ordered over the last hour, once an hour
    if (hourIdx !== this.rolledHour) { this.rolledHour = hourIdx; this.order(); }
    if (tick % 10 === 6 && COURIER.waves.some((s) => h >= s && h < s + WAVE_SPREAD + 0.5)) this.dispatch(h);
  }

  private order() {
    const w = this.w;
    const perHour = COURIER.parcelRate / 24;
    for (const b of w.builtOf(Zone.Residential)) {
      if (!b.occupants) continue;
      let n = b.occupants * HOUSEHOLDS_PER_RESIDENT * perHour;
      for (; n > 0; n -= 1) {
        if (Math.random() >= n) break;
        const d = w.bestBuiltNear(b.x, b.y, [Zone.Industrial], COURIER.reach, 0, (c, dist) => (isCourierDepot(c.id, c.level, c.x, c.y) && c.occupants > 0 ? -dist : null), (c) => w.hasRoadAccess(c.x, c.y));
        if (!d) { this.stats.noDepot++; continue; }
        push(this.waiting, tkey(d.x, d.y), { id: this.nextId++, home: [b.x, b.y], at: w.tick });
        this.stats.parcels++;
      }
    }
  }

  /** Vans out of every depot with parcels and a courier on shift, each at its own minute of the wave. */
  private dispatch(h: number) {
    const m = this.mobile;
    const free = new Map<number, Citizen[]>();
    for (const c of m.onShift(FleetKind.CourierVan)) if (m.free(c) && !m.unitOf(c.id)) push(free, tkey(c.wx, c.wy), c);
    for (const [k, list] of this.waiting) {
      if (!list.length) continue;
      const couriers = free.get(k);
      if (!couriers?.length) continue;
      const c = couriers[0];
      const wave = COURIER.waves.find((s) => h >= s && h < s + WAVE_SPREAD + 0.5)!;
      if (h < wave + WAVE_SPREAD * hash2(c.id, Math.floor(this.w.tick / DAY))) continue; // this van's minute has not come yet
      couriers.shift();
      const depot: [number, number] = [c.wx, c.wy];
      // the van's load: up to vanLoad parcels, delivered nearest-first from the depot, one stop per kerb
      const load = list.splice(0, COURIER.vanLoad);
      const kerbs = new Map<number, { s: Stop; ids: number[] }>();
      for (const p of load) {
        const s = m.stopAt(p.home[0], p.home[1], COURIER.doorDwell, DROP, 0);
        const sk = tkey(s.x, s.y);
        let e = kerbs.get(sk);
        if (!e) { s.ref = this.nextStop++; kerbs.set(sk, e = { s, ids: [] }); }
        else e.s.dwell += 1;
        e.ids.push(p.id);
        this.onVan.set(p.id, p);
      }
      const left = [...kerbs.values()], stops: Stop[] = [];
      let cx = depot[0], cy = depot[1];
      while (left.length) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < left.length; i++) { const d = Math.abs(left[i].s.x - cx) + Math.abs(left[i].s.y - cy); if (d < bd) { bd = d; bi = i; } }
        const e = left.splice(bi, 1)[0];
        stops.push(e.s); this.byStop.set(e.s.ref, e.ids);
        cx = e.s.x; cy = e.s.y;
      }
      const u = m.launch(this, c, FleetKind.CourierVan, depot, depot, stops, `delivering ${load.length} parcel${load.length === 1 ? '' : 's'}`);
      if (!u) { this.putBack(stops); continue; }
      u.loaded = true;
      this.stats.vans++;
      this.depotDay(depot).vans++;
    }
  }
  private putBack(stops: Stop[]) {
    for (const s of stops) {
      for (const id of this.byStop.get(s.ref) ?? []) {
        const p = this.onVan.get(id);
        if (!p) continue;
        this.onVan.delete(id);
        // back to the depot it came from: the nearest one again
        const d = this.w.bestBuiltNear(p.home[0], p.home[1], [Zone.Industrial], COURIER.reach, 0, (c, dist) => (isCourierDepot(c.id, c.level, c.x, c.y) && c.occupants > 0 ? -dist : null));
        if (d) push(this.waiting, tkey(d.x, d.y), p);
      }
      this.byStop.delete(s.ref);
    }
  }
  private depotDay(d: [number, number]) {
    const k = tkey(d[0], d[1]), day = Math.floor(this.w.tick / DAY);
    let v = this.depots.get(k);
    if (!v) this.depots.set(k, v = { day, done: 0, yDone: 0, vans: 0 });
    if (v.day !== day) { v.yDone = v.day === day - 1 ? v.done : 0; v.done = 0; v.vans = 0; v.day = day; }
    return v;
  }

  // ---- the van's side (FleetService) -------------------------------------------------------------------------------

  arrive(u: Unit, s: Stop) {
    const ids = this.byStop.get(s.ref) ?? [];
    this.byStop.delete(s.ref);
    const w = this.w, owner = w.parcelAt(u.base[0], u.base[1])?.owner;
    for (const id of ids) {
      const p = this.onVan.get(id);
      if (!p) continue;
      this.onVan.delete(id);
      this.stats.delivered++;
      this.hours.push((w.tick - p.at) / TPH);
      if (owner) w.credit(owner, COURIER.fee, 'fees');
      this.stats.fees += COURIER.fee;
    }
    this.depotDay(u.base).done += ids.length;
    this.mobile.note(u, COURIER.fee * ids.length);
    u.task = `at the door with ${ids.length} parcel${ids.length === 1 ? '' : 's'}`;
  }
  depart(u: Unit, _s: Stop) {
    let n = 0;
    for (const s of u.stops) n += this.byStop.get(s.ref)?.length ?? 0;
    if (!n) u.loaded = false;
    u.task = n ? `delivering ${n} parcel${n === 1 ? '' : 's'}` : `driving back to ${this.depotName(u.base[0], u.base[1])}`;
  }
  unreachable(_u: Unit, s: Stop) { this.putBack([s]); }
  withdrawn(u: Unit, _at: [number, number]) { this.putBack(u.stops); }
  returned(_u: Unit) { this.stats.returned++; }

  label(u: Unit) { return `${this.depotName(u.base[0], u.base[1])} van`; }
  baseName(c: Citizen) { return `${this.depotName(c.wx, c.wy)} parcel depot`; }
  /** A parcel depot's tooltip: couriers on shift, parcels waiting, delivered today and yesterday. */
  describe(bx: number, by: number, kindId: number): FleetInfoRows | null {
    const b = this.w.buildings.get(tileKey(bx, by));
    if (!b || !isCourierDepot(kindId, b.level, bx, by)) return null;
    let on = 0, out = 0;
    for (const c of this.mobile.onShift(FleetKind.CourierVan)) if (c.wx === bx && c.wy === by) { on++; if (this.mobile.unitOf(c.id)) out++; }
    const v = this.depotDay([bx, by]);
    return {
      role: `parcel depot: ${this.depotName(bx, by)}`,
      rows: [
        ['Couriers on shift', `${on}${out ? ` (${out} out)` : ''}`],
        ['Parcels waiting', `${this.waiting.get(tkey(bx, by))?.length ?? 0}`],
        ['Delivered', `${v.done} today (${v.vans} van${v.vans === 1 ? '' : 's'}) · ${v.yDone} yesterday`],
      ],
    };
  }
}
function push<K, T>(m: Map<K, T[]>, k: K, v: T) { let l = m.get(k); if (!l) m.set(k, l = []); l.push(v); }
