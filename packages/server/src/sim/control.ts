import {
  TICKS_PER_DAY, TICKS_PER_HOUR, VehicleKind, VehicleClass, StreetRule, ZONE20_FREIGHT, VISITOR_LIMIT_SHARE, POLICY, DEFAULT_TAX,
  JAM_WHY_STRIDE, CHUNK_SIZE, MOTORWAY_KIND, GATEWAY_WORDS, hasPolicy, inCurfew, hash2, isRoad, kindManifest,
  type TrafficPanelInfo,
} from '@msimcity/shared';
import type { Citizen, Mover, Vehicle, World } from '../world';
import { tkey, untkey } from '../world';
import { findRoute, lorryAccess } from '../pathfinding';
import type { Traffic } from './traffic';
import type { Gateways } from './gateways';

/** What a visitor spends at the shop or office it visits (Simulation's VISITOR_SPEND): the visitor limit's stated cost. */
const VISITOR_SPEND = 5;
/** fleet vehicle kinds (sim/mobile.ts FLEET_VKIND 32 + FleetKind) */
const FLEET_VKIND = 32;

/** A day's count kept with yesterday's (rolled on first touch of a new day). */
interface DayCount { day: number; today: number; yesterday: number }
const bumpDay = (m: Map<number, DayCount>, k: number, day: number, n = 1) => {
  let c = m.get(k);
  if (!c) m.set(k, (c = { day, today: 0, yesterday: 0 }));
  roll(c, day);
  c.today += n;
};
const roll = (c: DayCount, day: number) => { if (c.day !== day) { c.yesterday = c.day === day - 1 ? c.today : 0; c.today = 0; c.day = day; } };

/**
 * Traffic control (R5, docs/roads.md "Traffic control"): the bookkeeping the street rules, the visitor limit, the lorry
 * curfew and the Traffic panel need beside the simulation. Nothing here changes the traffic of a world without street
 * rules, gateway limits or the curfew: its tests read `World.streetAny`, the limits and the policy first.
 *
 * - **Freight routing**: a lorry (VehicleKind.Freight) never drives an HGV-banned street but to reach one end of its
 *   trip (pathfinding.ts lorryAccess), and a 20 zone costs it ZONE20_FREIGHT times what it costs a car.
 * - **The visitor limit**: a gateway's record (World.roadRules, `gw`) halves the visitors who come in by it.
 * - **The lorry curfew**: a freight lorry for or from a player with the policy on waits at its depot from 22:00 to 06:00.
 * - **Give-ups by junction, dispatches by hour**: what the Traffic panel lists.
 */
export class TrafficControl {
  /** give-ups by the tile the car was waiting to get into (a junction's tile where it was one) */
  private giveUpAt = new Map<number, DayCount>();
  /** give-ups today by who drove: residents, visitors, freight, other */
  private giveUpKind = { day: -1, residents: 0, visitors: 0, freight: 0, other: 0 };
  /** visitors dispatched through each entry (its road tile key), and the ticks visitors and lorries set off (the last hour) */
  private visitorsBy = new Map<number, DayCount>();
  private visitTicks: number[] = []; private freightTicks: number[] = [];
  /** lorries held by the curfew since the start (the harness reads it), and released */
  curfew = { held: 0, released: 0 };
  /** lorries waiting out the curfew at their depot: vehicle id to the tick they set off (Simulation.moveVehicles) */
  holds = new Map<number, number>();

  constructor(private w: World, private traffic: Traffic, private gateways: Gateways) {}

  private get day() { return Math.floor(this.w.tick / TICKS_PER_DAY); }

  // ---- routing ----------------------------------------------------------------------------------------------------

  /** Is m a lorry the HGV ban applies to (freight; not vans, buses, fleet vehicles or emergencies)? */
  isLorry(m: Mover): boolean { return (m as Vehicle).vkind === VehicleKind.Freight; }
  /** The router's cost for a lorry: as a car's, and ZONE20_FREIGHT times more through a 20 zone. */
  freightCost = (x: number, y: number): number => {
    const c = this.traffic.cost(x, y);
    return this.w.streetAny & StreetRule.Zone20 && this.w.streetAt(x, y) & StreetRule.Zone20 ? c * ZONE20_FREIGHT : c;
  };
  /** The cost function for m's routes. */
  costFor(m: Mover | null, vkind = -1): (x: number, y: number) => number {
    const lorry = m ? this.isLorry(m) : vkind === VehicleKind.Freight;
    return lorry && this.w.streetAny & StreetRule.Zone20 ? this.freightCost : (x, y) => this.traffic.cost(x, y);
  }
  /** Does lorry m's way from path node `from` on use an HGV-banned street it has no business on? */
  breaksBan(m: Mover, from: number): boolean {
    if (!(this.w.streetAny & StreetRule.Hgv) || !this.isLorry(m)) return false;
    const p = m.path, n = p.length / 2;
    const acc = lorryAccess(this.w, p[0], p[1], p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
    for (let i = Math.max(1, from); i + 1 < n; i++) {
      const x = p[i * 2], y = p[i * 2 + 1];
      if (this.w.streetAt(x, y) & StreetRule.Hgv && !acc?.has(tkey(x, y))) return true;
    }
    return false;
  }

  // ---- the lorry curfew ---------------------------------------------------------------------------------------------

  /**
   * The tick a freight lorry from `owner`'s land, or for the land at `to`, may set off, when the lorry curfew holds it
   * (one of them has the policy on and it is between curfewFrom and curfewTo); undefined when it may go now. The
   * lorries leave again over the first hour of the morning, each at its own minute (hash).
   */
  curfewHold(id: number, owner: string | null, to: [number, number]): number | undefined {
    const hour = (this.w.tick % TICKS_PER_DAY) / TICKS_PER_HOUR;
    if (!inCurfew(hour)) return undefined;
    const has = (o: string | null | undefined) => !!o && hasPolicy(this.w.players.get(o)?.policies, 'curfew');
    if (!has(owner) && !has(this.w.parcelAt(to[0], to[1])?.owner)) return undefined;
    const dayStart = Math.floor(this.w.tick / TICKS_PER_DAY) * TICKS_PER_DAY;
    let until = dayStart + POLICY.curfewTo * TICKS_PER_HOUR;
    if (until <= this.w.tick) until += TICKS_PER_DAY;
    this.curfew.held++;
    return until + Math.floor(hash2(id, 0x5c) * TICKS_PER_HOUR);
  }
  /** The curfew's running cost, each midnight, for every player with it on. */
  chargeCurfew() {
    for (const p of this.w.players.values()) if (hasPolicy(p.policies, 'curfew')) this.w.credit(p.id, -POLICY.curfewPerDay, 'upkeep');
  }

  // ---- the visitor limit --------------------------------------------------------------------------------------------

  /** The gateways' entry road tiles (key) with the visitor limit on, refreshed when asked and the rules changed. */
  private limited = new Set<number>(); private limitedAt = -1; private limitedVer = -1;
  /** Should a visitor about to come in by entry e be turned away (the limit at its gateway, or `all` for every entry)? */
  dropVisitor(e: [number, number], all: boolean, rand: () => number): boolean {
    if (!all) {
      if (this.limitedVer !== this.w.rulesVersion || this.w.tick - this.limitedAt > TICKS_PER_HOUR / 6) this.refreshLimits();
      if (!this.limited.size || !this.limited.has(tkey(e[0], e[1]))) return false;
    }
    return rand() >= VISITOR_LIMIT_SHARE;
  }
  private refreshLimits() {
    this.limited.clear(); this.limitedAt = this.w.tick; this.limitedVer = this.w.rulesVersion;
    for (const g of this.gateways.list) if (this.w.roadRuleAt(g.x, g.y)?.gw) this.limited.add(tkey(g.fx, g.fy));
  }
  /** Is the visitor limit on at the gateway whose door is (x, y)? */
  limitAt(x: number, y: number) { return !!this.w.roadRuleAt(x, y)?.gw; }
  setLimit(x: number, y: number, on: boolean) {
    const r = this.w.roadRuleAt(x, y);
    this.w.setRoadRule(x, y, { ...(r ?? {}), gw: on ? 1 : undefined });
  }
  /** A visitor set off from entry (x, y); a lorry set off. */
  noteVisitor(x: number, y: number) { bumpDay(this.visitorsBy, tkey(x, y), this.day); this.visitTicks.push(this.w.tick); this.prune(this.visitTicks); }
  noteFreight() { this.freightTicks.push(this.w.tick); this.prune(this.freightTicks); }
  private prune(a: number[]) { if (a.length > 64 && a[0] < this.w.tick - TICKS_PER_HOUR) { let i = 0; while (i < a.length && a[i] < this.w.tick - TICKS_PER_HOUR) i++; a.splice(0, i); } }
  visitorsAt(fx: number, fy: number): DayCount { const c = this.visitorsBy.get(tkey(fx, fy)); if (c) roll(c, this.day); return c ?? { day: this.day, today: 0, yesterday: 0 }; }
  /** About what the visitor limit at a gate costs in visitor tax a day: the visitors it turns away (yesterday's, or today's so far) times their spend at the mean tax rate. */
  limitCost(fx: number, fy: number, on: boolean): number {
    const c = this.visitorsAt(fx, fy);
    let sum = 0, n = 0;
    for (const p of this.w.parcels.values()) { sum += p.taxRate; n++; }
    const rate = n ? sum / n : DEFAULT_TAX, came = Math.max(c.yesterday, c.today);
    // with the limit on, those who came were half: as many again were turned away
    const turned = on ? came * (1 / VISITOR_LIMIT_SHARE - 1) : came * (1 - VISITOR_LIMIT_SHARE);
    return Math.round(turned * VISITOR_SPEND * rate * 100) / 100;
  }

  // ---- give-ups -----------------------------------------------------------------------------------------------------

  /** Mover m gave up waiting (the stuck rule): remember where (the tile it was waiting to get into) and who it was. */
  noteGiveUp(m: Citizen | Vehicle) {
    const day = this.day, k = this.giveUpKind;
    if (k.day !== day) { k.day = day; k.residents = 0; k.visitors = 0; k.freight = 0; k.other = 0; }
    const vk = (m as Vehicle).vkind;
    if (vk === undefined) k.residents++; else if (vk === VehicleKind.Visitor) k.visitors++; else if (vk === VehicleKind.Freight) k.freight++; else k.other++;
    if (m.pi * 2 + 1 >= m.path.length) return;
    let x = m.path[m.pi * 2], y = m.path[m.pi * 2 + 1];
    // the junction it was queuing for: the first tile ahead with three or more roads, within a few tiles
    for (let i = m.pi, n = m.path.length / 2; i < n && i < m.pi + 4; i++) if (this.traffic.degreeOf(m.path[i * 2], m.path[i * 2 + 1]) >= 3) { x = m.path[i * 2]; y = m.path[i * 2 + 1]; break; }
    bumpDay(this.giveUpAt, tkey(x, y), day);
  }

  // ---- the Traffic panel and the overlay's explanation ---------------------------------------------------------------

  /** Who drives what (the panel's cars on the road by kind). */
  private kindOf(m: Mover): 'residents' | 'visitors' | 'freight' | 'buses' | 'services' {
    const vk = (m as Vehicle).vkind;
    if (vk === undefined) return 'residents';
    if (vk === VehicleKind.Visitor) return 'visitors';
    if (vk === VehicleKind.Freight) return 'freight';
    if (vk === VehicleKind.Bus || m.cls === VehicleClass.Bus) return 'buses';
    return 'services'; // patrols, fire engines, ambulances, and the fleet (taxis, couriers, bin lorries: sim/mobile.ts)
  }
  /**
   * The Traffic panel: cars on the road now by kind, visitors and lorries set off in the last hour, today's give-ups by
   * kind, the gateways' arrivals and visitors, the five junctions with the most give-ups since yesterday began, and the
   * three streets with the most cars queued now. `me` marks the player's own gateways. On request only.
   */
  panel(me: string, mayEdit: (owner: string) => boolean): TrafficPanelInfo {
    const w = this.w, day = this.day;
    const onRoad = { residents: 0, visitors: 0, freight: 0, buses: 0, services: 0 };
    const queued = new Map<number, { n: number; fv: number }>();
    const each = (m: Mover) => {
      if (m.lane < 0) return;
      const k = this.kindOf(m);
      onRoad[k]++;
      if (m.wait > 1 && m.pi >= 1) {
        const tx = m.path[(m.pi - 1) * 2], ty = m.path[(m.pi - 1) * 2 + 1], key = tkey(tx, ty);
        let q = queued.get(key); if (!q) queued.set(key, (q = { n: 0, fv: 0 }));
        q.n++; if (k === 'visitors' || k === 'freight') q.fv++;
      }
    };
    for (const c of w.citizens.values()) if (c.leg?.drive) each(c);
    for (const v of w.vehicles.values()) if (v.phase !== 'dwell') each(v);
    const cut = w.tick - TICKS_PER_HOUR;
    while (this.visitTicks.length && this.visitTicks[0] < cut) this.visitTicks.shift();
    while (this.freightTicks.length && this.freightTicks[0] < cut) this.freightTicks.shift();
    const g = this.giveUpKind.day === day ? this.giveUpKind : { residents: 0, visitors: 0, freight: 0, other: 0 };
    const gateways: TrafficPanelInfo['gateways'] = [];
    for (const gate of this.gateways.list) {
      const v = this.visitorsAt(gate.fx, gate.fy), owner = w.parcelAt(gate.x, gate.y)?.owner ?? '';
      const limit = this.limitAt(gate.x, gate.y);
      gateways.push({
        x: gate.x, y: gate.y, name: kindManifest(gate.kind)?.name ?? GATEWAY_WORDS[gate.spec.type], type: gate.spec.type, perHour: gate.spec.perHour,
        arrivalsToday: gate.inToday, visitorsToday: v.today, visitorsYesterday: v.yesterday, limit, mine: owner ? mayEdit(owner) : false,
        limitCost: gate.kind === MOTORWAY_KIND ? this.limitCost(gate.fx, gate.fy, limit) : 0,
      });
    }
    gateways.sort((a, b) => b.visitorsToday + b.arrivalsToday - (a.visitorsToday + a.arrivalsToday));
    const name = (x: number, y: number) => { const r = w.streets.streetsAt(x, y); return r.length ? (r.length > 1 ? `${w.streets.nameOf(r[0])} / ${w.streets.nameOf(r[1])}` : w.streets.nameOf(r[0])) : `${x}, ${y}`; };
    const junctions = [...this.giveUpAt.entries()].map(([k, c]) => { roll(c, day); return { k, n: c.today + c.yesterday }; })
      .filter((e) => e.n > 0).sort((a, b) => b.n - a.n || a.k - b.k).slice(0, 5)
      .map((e) => { const [x, y] = untkey(e.k); return { x, y, name: name(x, y), giveUps: e.n }; });
    // streets by the cars queued on their tiles (a tile on two streets counts for the longer)
    const byStreet = new Map<string, { x: number; y: number; name: string; queued: number; freightOrVisitors: number }>();
    for (const [k, q] of queued) {
      const [x, y] = untkey(k), t = w.peekTile(x, y);
      if (t === undefined || !isRoad(t)) continue;
      const runs = w.streets.streetsAt(x, y);
      if (!runs.length) continue;
      const nm = w.streets.nameOf(runs[0]);
      let s = byStreet.get(nm);
      if (!s) byStreet.set(nm, (s = { x, y, name: nm, queued: 0, freightOrVisitors: 0 }));
      s.queued += q.n; s.freightOrVisitors += q.fv;
    }
    const streets = [...byStreet.values()].sort((a, b) => b.queued - a.queued || (a.name < b.name ? -1 : 1)).slice(0, 3);
    void me;
    return {
      onRoad, lastHour: { visitors: this.visitTicks.length, freight: this.freightTicks.length },
      giveUps: { residents: g.residents, visitors: g.visitors, freight: g.freight, other: g.other },
      gateways, junctions, streets,
    };
  }

  /**
   * Why the traffic in chunk (cx, cy) is held up, from Traffic.whyHeld for every car on a road tile there: per tile with
   * a car held, [x, y, cars, the six causes' counts (JAM_CAUSES), freight and visitors among them]. On request only.
   */
  jamWhy(cx: number, cy: number, parkSearch: (m: Mover) => boolean): number[] {
    const w = this.w, x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
    const tiles = new Map<number, number[]>();
    const each = (m: Mover) => {
      if (m.lane < 0 || m.pi < 1) return;
      const tx = m.path[(m.pi - 1) * 2], ty = m.path[(m.pi - 1) * 2 + 1];
      if (tx < x0 || ty < y0 || tx >= x0 + CHUNK_SIZE || ty >= y0 + CHUNK_SIZE) return;
      let why = this.traffic.whyHeld(m);
      if (why >= 0 && why !== 1 && parkSearch(m)) why = 4;
      const k = tkey(tx, ty);
      let e = tiles.get(k);
      if (!e) tiles.set(k, (e = [tx, ty, 0, 0, 0, 0, 0, 0, 0, 0]));
      e[2]++;
      if (why >= 0) e[3 + why]++;
      const vk = (m as Vehicle).vkind;
      if (vk === VehicleKind.Freight || vk === VehicleKind.Visitor) e[9]++;
    };
    for (const c of w.citizens.values()) if (c.leg?.drive) each(c);
    for (const v of w.vehicles.values()) if (v.phase !== 'dwell') each(v);
    const out: number[] = [];
    for (const e of tiles.values()) if (e[3] + e[4] + e[5] + e[6] + e[7] + e[8] > 0) out.push(...e);
    void JAM_WHY_STRIDE; void FLEET_VKIND;
    return out;
  }

  /**
   * The Street rules tool's ghost for an HGV ban (R5): a sample lorry's route from one end of the tiles to the other
   * (the road beyond each end), before and after the ban, in route cost (about tiles); -1 when the ban leaves no way
   * round. With the ban on already, "before" is without it.
   */
  probeBan(tiles: [number, number][]): { before: number; after: number } {
    const w = this.w;
    if (tiles.length < 2) return { before: -1, after: -1 };
    // the first straight run of the tiles (a click on an avenue sends its twin row after it)
    let n = 1;
    while (n < tiles.length && Math.abs(tiles[n][0] - tiles[n - 1][0]) + Math.abs(tiles[n][1] - tiles[n - 1][1]) === 1) n++;
    const line = tiles.slice(0, n);
    // a lorry passing through: from the first junction along it to the last (the street between them closed to it), or,
    // with one junction or none, from the road beyond one end to the road beyond the other
    const junc: number[] = [];
    line.forEach(([x, y], i) => { if (this.traffic.degreeOf(x, y) >= 3) junc.push(i); });
    let ends: [number, number][], walls: [number, number][];
    if (junc.length >= 2 && junc.at(-1)! - junc[0] >= 2) {
      ends = [line[junc[0]], line[junc.at(-1)!]];
      walls = line.slice(junc[0] + 1, junc.at(-1)!);
    } else {
      const [ax, ay] = line[0], [bx, by] = line[line.length - 1];
      ends = [];
      for (const [ex, ey, ox, oy] of [[ax, ay, bx, by], [bx, by, ax, ay]] as const) {
        const dx = Math.sign(ex - ox), dy = Math.sign(ey - oy), nx = ex + dx, ny = ey + dy, t = w.peekTile(nx, ny);
        ends.push(t !== undefined && isRoad(t) ? [nx, ny] : [ex, ey]);
      }
      walls = line.filter(([x, y]) => !ends.some(([ex, ey]) => ex === x && ey === y));
    }
    const [s, g] = ends;
    // before: a lorry's way with no ban at all; after: with these tiles (and every ban there is) closed to it
    const before = findRoute(w, s[0], s[1], g[0], g[1], this.freightCost, 0.4, 6000);
    const after = findRoute(w, s[0], s[1], g[0], g[1], this.freightCost, 0.4, 6000, -1, Infinity, false, false, new Set(walls.map(([x, y]) => tkey(x, y))));
    return { before: before ? Math.round(before.cost) : -1, after: after ? Math.round(after.cost) : -1 };
  }
}
