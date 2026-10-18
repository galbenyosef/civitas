import {
  TICKS_PER_DAY, Zone, zoneOf, terrainOf, packTile, hash2, RAIL_SIDES, oppSide, isRailAux, railMask, railAux, planTrack, routeLine,
  trainsAt, railStationAt, stationBuilt, stationTrackProblem, isRailStationKind, headwayMinutes,
  nextRide, routeTiles, nameFor, isFreightYardKind, consistLoad, YARD_CATCHMENT, RAIL_FREIGHT_FEE,
  isRoad, barrierDown,
  type RailEnv, type TrainInfo, type RailLineDef, type RailRoute, type RailService, type RailStationInfo, type TransitLine,
} from '@msimcity/shared';
import type { World, Player } from '../world';
import type { Transit, LineRoute } from './transit';
import { Timetabled, trainVehicleId, type TimetabledLine } from './timetabled';
import { ageOf } from './life';

export { trainVehicleId };
/** rows of a train's roster (a full train is 160 riders, so this only cuts a pathological one) */
const ROSTER_CAP = 200;
/** what a container holds, by hash per consignment (organic rule) */
const GOODS = ['machine parts', 'furniture', 'textiles', 'canned food', 'electronics', 'paper', 'building supplies', 'household goods', 'tools', 'bottled drinks', 'car parts', 'clothing'];
/** places on a train per carriage (the locomotive carries none) */
export const SEATS_PER_CAR = 40;

type RailLine = TimetabledLine;

/**
 * The timetable's view of a transit line: stations by their doors (a stop may name any tile of a station), carriages
 * the line's own (2-4 by hash, trimmed to the shortest platform by railService).
 */
export function railDef(l: TransitLine, doorOf: (x: number, y: number) => [number, number] = (x, y) => [x, y], kindAt: (x: number, y: number) => number = () => 0): RailLineDef {
  const stations = l.stops.map((s) => doorOf(s.x, s.y));
  return {
    id: l.id, owner: l.owner, number: l.number, name: `Line ${l.number}`, color: l.colour,
    stations, trains: Math.max(1, l.vehicles), cars: 2 + Math.floor(hash2(l.id, 71) * 3), loop: l.loop,
    freight: stations.length > 0 && stations.every(([x, y]) => isFreightYardKind(kindAt(x, y))) || undefined,
  };
}

/** One shipment going by rail: factory -> yard a (truck) -> yard b (train) -> shop (truck). */
interface Consignment {
  id: number; line: number; a: number; b: number;
  from: [number, number]; to: [number, number];
  /** the shipper (the factory's owner), who pays RAIL_FREIGHT_FEE and is paid by the shop as for any delivery */
  owner: string | null;
  state: 'truck' | 'yard' | 'train';
  vid: number; since: number;
}
/** The truck side of rail freight, provided by the simulation (index.ts wires it). */
export interface FreightTrucks { spawn(from: [number, number], to: [number, number], owner: string | null): number | null }
/** share of a factory's deliveries that go by rail when a freight line serves both ends */
export const RAIL_FREIGHT_SHARE = 0.65;
/** a delivery goes by rail only when the shop is at least this far (Manhattan) from the factory */
const RAIL_FREIGHT_MIN_TRIP = 14;
/** a container nobody collects within this long is written off */
const CONSIGNMENT_MAX_AGE = TICKS_PER_DAY * 1.5;

/**
 * Trains (shared/src/rail.ts, docs/rail.md) as one mode of the transit registry (sim/transit.ts). The registry owns
 * rail lines like bus lines (it persists them, plans riders over them and collects fares); the line-running half
 * (sim/timetabled.ts, shared with the metro) works out a line's route through the track, answers the planner's timing
 * questions from the pure timetable, and hands every call at a station to the registry so riders get on and off.
 * Where a train is at any moment is the same pure function the clients run, so nothing per train goes over the wire:
 * only the lines, with their routes ('railLines').
 *
 * This owns the track tool (`paint`, `removeTrack`), level crossings, freight and the rail section of a station's tooltip.
 */
export class Rail extends Timetabled {
  readonly mode = 'rail' as const;
  readonly env: RailEnv;
  private doorOf = (x: number, y: number) => this.w.doorOf(x, y);
  private kindAt = (x: number, y: number) => this.w.kindIdAt(x, y);
  protected def(l: TransitLine) { return railDef(l, this.doorOf, this.kindAt); }
  /** containers by id, and the trucks carrying them to a yard */
  private consignments = new Map<number, Consignment>();
  private byTruck = new Map<number, number>();
  private nextConsignment = 1;
  private yardStats = new Map<string, { day: number; inT: number; outT: number; inY: number; outY: number }>();
  /** how many deliveries went by rail since start (checks read it) */
  freightStats = { consigned: 0, atYard: 0, loaded: 0, delivered: 0, lost: 0, fees: 0 };
  /** set by index.ts: puts a delivery truck on the road (the last mile from a yard) */
  trucks: FreightTrucks | null = null;

  constructor(w: World, transit: Transit) {
    super(w, transit);
    this.env = { tile: (x, y) => w.peekTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y) };
  }

  // ---- ModeService: routes ----------------------------------------------------------------------

  stopProblem(x: number, y: number): string | null {
    const st = railStationAt(x, y, this.env);
    if (!st) return `(${x}, ${y}) is not a rail station`;
    const why = stationTrackProblem(st, this.env);
    return why ? `The station at (${st.doorX}, ${st.doorY}) is not on the track: ${why}` : null;
  }

  route(line: TransitLine): LineRoute | string {
    const def = this.def(line);
    for (const [x, y] of def.stations) {
      const q = this.w.parcelAt(x, y);
      if (!this.sandbox && railStationAt(x, y, this.env) && q?.owner !== line.owner) return `The station at (${x}, ${y}) is not yours: a line calls only at its owner's stations`;
    }
    const yards = def.stations.filter(([x, y]) => isFreightYardKind(this.kindAt(x, y))).length;
    if (yards && yards < def.stations.length) return `Line ${line.number}: a line calls at passenger stations or at freight yards, not both`;
    const r = routeLine(def, this.env);
    if (!r.ok) return `Line ${line.number}: ${r.reason}`;
    for (const other of this.byId.values()) {
      if (other.line.id === line.id || !other.tiles) continue;
      for (const k of r.tiles) if (other.tiles.has(k)) {
        const x = Math.floor(k / 65536) - 0x8000, y = (k % 65536) - 0x8000;
        return `Line ${line.number} would share track with line ${other.line.number} at (${x}, ${y}); lines cannot share track yet (no signals)`;
      }
    }
    return lapOf(r.route, def.stations.length);
  }

  /** The route through the track; an earlier line keeps track a later one also finds. */
  protected network(rl: RailLine): { route: RailRoute; tiles: Set<number> } | string {
    const r = routeLine(rl.def, this.env);
    if (!r.ok) return r.reason;
    for (const other of [...this.byId.values()].sort((a, b) => a.line.id - b.line.id)) {
      if (other.line.id >= rl.line.id || !other.tiles) continue;
      for (const k of r.tiles) if (other.tiles.has(k)) return `shares track with line ${other.line.number} (lines cannot share track yet)`;
    }
    return r;
  }
  protected unbuilt(rl: RailLine): [number, number] | undefined {
    return rl.def.stations.find(([x, y]) => { const p = railStationAt(x, y, this.env); return !p || !stationBuilt(p, this.env); });
  }

  // ---- ModeService: running ---------------------------------------------------------------------

  protected capacity(svc: RailService) { return svc.freight ? consistLoad(svc.consists[0]) : (svc.vehicles - 1) * SEATS_PER_CAR; }
  /** A train at a station: freight loads and unloads, passengers go through the registry. */
  protected serve(rl: RailLine, train: number, stop: number, dir: 1 | -1, arrival = true) {
    if (rl.svc!.freight) { this.serveFreight(rl, train, stop, dir, arrival); return; }
    super.serve(rl, train, stop, dir, arrival);
  }
  protected finish(rl: RailLine, train: number) {
    if (rl.svc!.freight) { this.unloadAll(trainVehicleId(rl.line.id, train), rl, 0); return; }
    super.finish(rl, train);
  }
  protected withdrawTrain(rl: RailLine, train: number) {
    if (rl.svc!.freight) { this.unloadAll(trainVehicleId(rl.line.id, train), rl, -1); return; }
    super.withdrawTrain(rl, train);
  }

  // ---- track -------------------------------------------------------------------------------------

  /** Lay track along a dragged path for a player; the toast to show. */
  paint(p: Player, path: [number, number][], anyLand = false): { ok: boolean; msg: string } { // anyLand: a sandbox lets track go on anyone's land
    const plan = planTrack(path, {
      ...this.env,
      tile: (x, y) => this.w.getTile(x, y),
      // a level crossing may go over a public road (unclaimed land), as anyone may use one
      land: (x, y) => { const q = this.w.parcelAt(x, y); return q ? (anyLand || q.owner === p.id ? null : 'Not your land') : isRoad(this.w.getTile(x, y)) ? null : 'Buy this land first: track goes on your own land'; },
    });
    if (!plan.ok) return { ok: false, msg: plan.reason ?? 'Track cannot go there' };
    if (!plan.tiles!.length) return { ok: true, msg: 'That track is already there' };
    if (p.money < plan.cost!) return { ok: false, msg: `Need $${plan.cost} for that track` };
    const tl = plan.tiles!;
    for (let i = 0; i < tl.length; i += 3) {
      const x = tl[i], y = tl[i + 1], t = this.w.getTile(x, y);
      if (zoneOf(t) !== Zone.None) this.w.setTile(x, y, packTile(terrainOf(t), false, 0, 0)); // an empty zoned lot is paved over
      this.w.setAux(x, y, tl[i + 2]);
      if (isRoad(t)) this.w.onTileChanged?.(x, y); // a level crossing: traffic re-reads the tile
    }
    if (plan.cost) this.w.credit(p.id, -plan.cost, 'build');
    this.pending = true;
    const xs = plan.crossings ? ` with ${plan.crossings} level crossing${plan.crossings === 1 ? '' : 's'}` : '';
    return { ok: true, msg: plan.fresh ? `Track laid: ${plan.fresh} tile${plan.fresh === 1 ? '' : 's'}${xs}, $${plan.cost}` : 'Track joined up' };
  }

  /**
   * Lift the track off a tile (bulldozing it is free) and cut the neighbours' connections to it. On a level crossing
   * the road stays (bulldoze again for it); a level crossing next door that would be left with a stub of track has
   * its track lifted too, so it is plain road again.
   */
  removeTrack(x: number, y: number) {
    const a = this.w.auxAt(x, y);
    if (!isRailAux(a)) return;
    const m = railMask(a);
    this.w.setAux(x, y, 0);
    if (isRoad(this.w.getTile(x, y))) this.w.onTileChanged?.(x, y);
    for (let s = 0; s < 4; s++) {
      if (!(m & (1 << s))) continue;
      const nx = x + RAIL_SIDES[s][0], ny = y + RAIL_SIDES[s][1], na = this.w.auxAt(nx, ny);
      if (!isRailAux(na)) continue;
      if (isRoad(this.w.getTile(nx, ny))) this.removeTrack(nx, ny);
      else this.w.setAux(nx, ny, railAux(railMask(na) & ~(1 << oppSide(s))));
    }
    this.pending = true;
  }

  /** Are the barriers of the level crossing (x, y) down now, for any line over it (shared/src/rail.ts crossingState)? */
  barrierDown(x: number, y: number): boolean {
    const k = (x + 0x8000) * 65536 + (y + 0x8000), now = this.railTick; // routeLine's tile key
    for (const l of this.byId.values()) if (l.svc && l.tiles?.has(k) && barrierDown(l.svc, x, y, now)) return true;
    return false;
  }

  // ---- tooltips ----------------------------------------------------------------------------------

  /** The rail section of the tooltip of the station covering (x, y). */
  describeStation(x: number, y: number): RailStationInfo | undefined {
    const st = railStationAt(x, y, this.env);
    if (!st || !isRailStationKind(st.kind)) return undefined;
    const problem = stationTrackProblem(st, this.env);
    const now = this.railTick, today = Math.floor(now / TICKS_PER_DAY);
    const s = this.stats.get(`${st.doorX},${st.doorY}`);
    const info: RailStationInfo = {
      track: problem ?? 'on the track', lines: [],
      callsToday: s && s.day === today ? s.calls : 0, boardedToday: s && s.day === today ? s.boarded : 0,
      alightedToday: s && s.day === today ? s.alighted : 0, faresToday: 0,
    };
    if (isFreightYardKind(st.kind)) {
      const y = this.yard(`${st.doorX},${st.doorY}`);
      let waiting = 0;
      for (const c of this.consignments.values()) if (c.state === 'yard' && this.doorOfStop(c)[0] === st.doorX && this.doorOfStop(c)[1] === st.doorY) waiting++;
      info.freight = { inToday: y.inT, outToday: y.outT, inYesterday: y.inY, outYesterday: y.outY, waiting };
    }
    for (const rl of [...this.byId.values()].sort((a, b) => a.line.number - b.line.number)) {
      const i = rl.def.stations.findIndex(([dx, dy]) => dx === st.doorX && dy === st.doorY);
      if (i < 0) continue;
      const row: RailStationInfo['lines'][number] = { id: rl.line.id, number: rl.line.number, name: rl.def.name, color: rl.line.colour, status: rl.status };
      if (rl.svc) {
        row.headwayMin = headwayMinutes(rl.svc);
        const n = rl.def.stations.length;
        for (const j of [i + 1 < n ? i + 1 : rl.def.loop ? 0 : -1, i > 0 && !rl.def.loop ? i - 1 : -1]) {
          if (j < 0) continue;
          const ride = nextRide(rl.svc, i, j, now);
          if (ride && (!row.next || ride.depart < row.next.tick)) row.next = { tick: ride.depart, toward: rl.def.loop ? 'round the loop' : `towards ${j > i ? 'the far end' : 'the first station'}` };
        }
      }
      info.lines.push(row);
    }
    return info;
  }

  // ---- freight -------------------------------------------------------------------------------------

  private yard(key: string) {
    const day = Math.floor(this.railTick / TICKS_PER_DAY);
    let y = this.yardStats.get(key);
    if (!y) { y = { day, inT: 0, outT: 0, inY: 0, outY: 0 }; this.yardStats.set(key, y); }
    if (y.day !== day) { if (y.day === day - 1) { y.inY = y.inT; y.outY = y.outT; } else { y.inY = 0; y.outY = 0; } y.inT = 0; y.outT = 0; y.day = day; }
    return y;
  }
  private doorOfStop(c: Consignment): [number, number] { const rl = this.byId.get(c.line); return rl ? rl.def.stations[c.state === 'yard' ? c.a : c.b] : [NaN, NaN]; }

  /**
   * The simulation's delivery dispatch asks here first (Simulation.freight): a factory -> shop delivery goes by rail
   * when a running freight line calls at a yard within YARD_CATCHMENT of the factory and at another within reach of the
   * shop, and the yards save road distance. Returns the consignment and the yard its truck should drive to, or null
   * (the truck drives to the shop as before). Part of the freight goes by road anyway (RAIL_FREIGHT_SHARE).
   */
  consign(from: [number, number], to: [number, number], owner: string | null): { id: number; yard: [number, number] } | null {
    const direct = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]);
    if (direct < RAIL_FREIGHT_MIN_TRIP) return null;
    let best: { rl: RailLine; a: number; b: number; road: number } | null = null;
    for (const rl of this.byId.values()) {
      if (!rl.svc?.freight) continue;
      const st = rl.def.stations;
      for (let a = 0; a < st.length; a++) {
        const da = Math.abs(st[a][0] - from[0]) + Math.abs(st[a][1] - from[1]);
        if (da > YARD_CATCHMENT) continue;
        for (let b = 0; b < st.length; b++) {
          if (b === a) continue;
          const db = Math.abs(st[b][0] - to[0]) + Math.abs(st[b][1] - to[1]);
          if (db > YARD_CATCHMENT || da + db >= direct) continue;
          if (!best || da + db < best.road) best = { rl, a, b, road: da + db };
        }
      }
    }
    if (!best || Math.random() >= RAIL_FREIGHT_SHARE) return null;
    const c: Consignment = { id: this.nextConsignment++, line: best.rl.line.id, a: best.a, b: best.b, from, to, owner, state: 'truck', vid: 0, since: this.w.tick };
    this.consignments.set(c.id, c);
    this.freightStats.consigned++;
    const d = best.rl.def.stations[best.a];
    return { id: c.id, yard: [d[0], d[1]] };
  }
  /** The first-mile truck for a consignment is on the road (vid) or could not start (null: the consignment is dropped). */
  truckStarted(id: number, vid: number | null) {
    const c = this.consignments.get(id);
    if (!c) return;
    if (vid === null) { this.consignments.delete(id); return; }
    c.vid = vid;
    this.byTruck.set(vid, id);
  }
  /** A delivery truck reached its destination: true when it was bringing a container to a yard (it unloads there, no shop fee). */
  truckArrived(vid: number): boolean {
    const id = this.byTruck.get(vid);
    if (id === undefined) return false;
    this.byTruck.delete(vid);
    const c = this.consignments.get(id);
    if (!c) return true;
    c.state = 'yard'; c.vid = 0; c.since = this.w.tick;
    const d = this.doorOfStop(c);
    this.yard(`${d[0]},${d[1]}`).inT++;
    this.freightStats.atYard++;
    return true;
  }
  /** A freight train at a yard: containers for this yard come off (and go on by truck), then waiting ones bound along the line go on. */
  private serveFreight(rl: RailLine, train: number, stop: number, dir: 1 | -1, arrival: boolean) {
    const vid = trainVehicleId(rl.line.id, train), svc = rl.svc!;
    const door = rl.def.stations[stop], key = `${door[0]},${door[1]}`;
    if (arrival) {
      const day = Math.floor(this.railTick / TICKS_PER_DAY);
      let s = this.stats.get(key);
      if (!s || s.day !== day) { s = { day, calls: 0, boarded: 0, alighted: 0 }; this.stats.set(key, s); }
      s.calls++;
      for (const c of [...this.consignments.values()]) {
        if (c.state !== 'train' || c.vid !== vid || c.b !== stop) continue;
        this.deliver(c, rl, door);
      }
    }
    let aboard = 0;
    for (const c of this.consignments.values()) if (c.state === 'train' && c.vid === vid) aboard++;
    const room = consistLoad(svc.consists[train] ?? svc.consists[0]) - aboard;
    if (room <= 0) return;
    const n = rl.def.stations.length;
    let loaded = 0;
    for (const c of this.consignments.values()) {
      if (loaded >= room) break;
      if (c.state !== 'yard' || c.line !== rl.line.id || c.a !== stop) continue;
      // there and back: only a train heading towards the consignment's yard takes it
      if (!rl.def.loop && n > 1 && (c.b > c.a ? 1 : -1) !== dir) continue;
      c.state = 'train'; c.vid = vid; c.since = this.w.tick;
      loaded++;
      this.freightStats.loaded++;
    }
    // containers nobody will collect: written off
    if (arrival) for (const [id, c] of this.consignments) if (this.w.tick - c.since > CONSIGNMENT_MAX_AGE) { this.consignments.delete(id); if (c.vid) this.byTruck.delete(c.vid); this.freightStats.lost++; }
  }
  /** Off the train at its yard: the shipper pays the line owner, and the yard sends the last-mile truck to the shop. */
  private deliver(c: Consignment, rl: RailLine, door: [number, number]) {
    this.consignments.delete(c.id);
    this.yard(`${door[0]},${door[1]}`).outT++;
    this.freightStats.delivered++;
    if (c.owner) { this.w.transfer(c.owner, rl.def.owner, RAIL_FREIGHT_FEE); if (c.owner !== rl.def.owner) this.freightStats.fees += RAIL_FREIGHT_FEE; }
    else this.w.credit(rl.def.owner, RAIL_FREIGHT_FEE, 'fees');
    this.trucks?.spawn([door[0], door[1]], c.to, c.owner);
  }
  /**
   * A freight train leaves service at yard `stop` (its day ends back at the first yard), or anywhere (-1: the line
   * stopped). Containers for that yard are delivered; the rest go back to wait at a yard for tomorrow's trains.
   */
  private unloadAll(vid: number, rl: RailLine, stop: number) {
    for (const c of [...this.consignments.values()]) {
      if (c.state !== 'train' || c.vid !== vid) continue;
      if (stop >= 0 && c.b === stop) { this.deliver(c, rl, rl.def.stations[stop]); continue; }
      c.state = 'yard'; c.vid = 0;
      if (stop >= 0) c.a = stop;
    }
  }

  /**
   * A train's tooltip: its state, what is on board and, for freight, where it comes off. `full` (the selected train's
   * panel) adds the roster: every citizen on board, or every container with what it holds and where it goes.
   */
  describeTrain(lineId: number, train: number, full = false): TrainInfo | null {
    const rl = this.byId.get(lineId);
    if (!rl?.svc) return null;
    const t = trainsAt(rl.svc, this.railTick).find((s) => s.train === train);
    if (!t) return null;
    const vid = trainVehicleId(lineId, train), st = rl.def.stations;
    const name = (i: number) => { const d = st[i]; const q = this.w.parcelAt(d[0], d[1]); return `${q ? q.name : 'station'} (${d[0]}, ${d[1]})`; };
    const info: TrainInfo = {
      line: lineId, number: rl.line.number, colour: rl.line.colour, freight: rl.svc.freight,
      state: t.phase === 'dwell' ? `${rl.svc.freight ? 'loading at' : 'standing at'} ${name(t.stop)}` : `running to ${name(t.stop)}`,
      load: 0, capacity: rl.svc.freight ? consistLoad(rl.svc.consists[train] ?? rl.svc.consists[0]) : this.capacity(rl.svc),
    };
    // the call before this one: dwelling, the station it stands at; running, the one behind it in the direction of travel
    const n = st.length;
    const prev = t.phase === 'dwell' ? t.stop : rl.def.loop ? (t.stop - 1 + n) % n : t.stop - t.dir;
    if (prev >= 0 && prev < n) info.prev = name(prev);
    info.next = name(t.stop);
    const place = (x: number, y: number) => { const q = this.w.parcelAt(x, y); return `${q ? q.name : 'unclaimed land'} (${x}, ${y})`; };
    if (rl.svc.freight) {
      const by = new Map<number, number>();
      const rows: NonNullable<TrainInfo['consignments']> = [];
      for (const c of this.consignments.values()) {
        if (c.state !== 'train' || c.vid !== vid) continue;
        by.set(c.b, (by.get(c.b) ?? 0) + 1); info.load++;
        if (full && rows.length < ROSTER_CAP) rows.push({ what: GOODS[Math.floor(hash2(c.id, c.from[0] * 31 + c.from[1]) * GOODS.length)], from: place(c.from[0], c.from[1]), to: place(c.to[0], c.to[1]), yard: name(c.b) });
      }
      info.cargo = [...by].map(([b, n]) => ({ yard: name(b), containers: n }));
      if (full) { info.consignments = rows; if (info.load > rows.length) info.truncated = true; }
    } else {
      info.load = this.transit.load(vid);
      if (full) {
        const aboard = this.transit.aboard(vid);
        info.riders = aboard.slice(0, ROSTER_CAP).map(({ c, off }) => ({
          id: c.id, name: nameFor(c.id, c.sn), activity: `to ${place(off.x, off.y)}`, here: true, age: Math.floor(ageOf(c, this.w.tick)), stage: c.stage,
        }));
        if (aboard.length > ROSTER_CAP) info.truncated = true;
      }
    }
    return info;
  }
}

/** The registry's view of a rail route: one lap of tiles (a there-and-back line runs out and back) and the tile of each call (the platform's middle). */
export function lapOf(route: RailRoute, n: number): LineRoute {
  const tiles = routeTiles(route), m = tiles.length - 1;
  const mid = (i: number) => route.stops[i].k + Math.floor(route.stops[i].len / 2);
  const path: number[] = [], calls: number[] = [], callNodes: number[] = [];
  for (const t of tiles) path.push(t.x, t.y);
  for (let i = 0; i < n; i++) { calls.push(i); callNodes.push(mid(i)); }
  if (!route.loop) {
    for (let j = m - 1; j >= 1; j--) path.push(tiles[j].x, tiles[j].y);
    for (let i = n - 2; i >= 1; i--) { calls.push(i); callNodes.push(m + (m - mid(i))); }
  }
  return { calls, path, callNodes };
}
