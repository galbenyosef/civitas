import {
  CHUNK_SIZE, TICKS_PER_DAY, TRANSIT, Zone, hash2, packTile, terrainOf, familyOf, subFor, zoneOf, levelOf, isBuildable, isRoad, underConstruction,
  RAIL_SIDES, oppSide, trackKey, routeNet, railService, trainsAt, nextRide, headwayMinutes, nameFor,
  METRO, METRO_ENTRANCE, isMetroStationKind, isTunnel, isPlatform, underMask, tunnelByte, metroStop, metroStationAt, metroStationBuilt,
  planPlatform, orphanPlatform, underNet, planBore, lineSides, kioskTurn, platformAlongX, problemText,
  type MetroEnv, type RailLineDef, type RailRoute, type RailService, type TransitLine, type StopRef, type LinePreview, type LineProblem,
  type MetroLineDTO, type MetroStationInfo, type TrainInfo,
} from '@msimcity/shared';
import type { World, Player } from '../world';
import type { Transit, LineRoute } from './transit';
import { Timetabled, trainVehicleId, type TimetabledLine } from './timetabled';
import { lapOf } from './rail';
import { ageOf } from './life';

/** how often platforms whose entrance has gone are turned back into tunnel (orphanPlatform) */
const ORPHAN_EVERY = 10;
/** how often riders per train go out ('metroLoads'), while they change */
const LOADS_EVERY = 25;
/** rows of a train's roster */
const ROSTER_CAP = 200;
/** tiles round a station tried for a suggested entrance when a leg cannot be bored, and how many are bored to test */
const SUGGEST_TRIES = 4;

/** The timetable's view of a metro line: stations by their doors, tube stock (`metro`), its name when it has one. */
export function metroDef(l: TransitLine, doorOf: (x: number, y: number) => [number, number] = (x, y) => [x, y]): RailLineDef {
  return {
    id: l.id, owner: l.owner, number: l.number, name: l.name || `Line ${l.number}`, color: l.colour,
    stations: l.stops.map((s) => doorOf(s.x, s.y)), trains: Math.max(1, l.vehicles), cars: 0, loop: l.loop, metro: true,
  };
}

/**
 * Underground railways (docs/underground.md, shared/src/metro.ts) as the 'metro' mode of the transit registry. Lines
 * are made in the Lines panel like bus lines: `plan` serves the editor's preview and `commit` bores the tunnel a line
 * is missing and charges for it when it is saved. The route is then derived from the under layer with surface rail's
 * own search (`routeNet` over `underNet`), each line keeping off the tunnels of the others except straight across at a
 * crossover, and trains run rail's timetable with twin bores (sim/timetabled.ts). Riders wait on the platform and ride
 * below ground, flagged CITIZEN_UNDER.
 *
 * It also places a station's platform (`platformFor` / `lay`), turns a platform whose entrance has gone back into
 * plain tunnel, fills unused tunnel for the underground bulldozer (`fill`), and answers station and train tooltips.
 */
export class Metro extends Timetabled {
  readonly mode = 'metro' as const;
  readonly under = true;
  readonly env: MetroEnv;
  private doorOf = (x: number, y: number) => this.w.doorOf(x, y);
  protected def(l: TransitLine) { return metroDef(l, this.doorOf); }
  /** World.underVersion when the lines were last re-derived */
  private seenUnder = -1;
  /** what the lines were last derived from (rebuildInputs): a rebuild with nothing changed is skipped */
  private rebuilt = '';
  /** one tile of every platform run in the layer, rescanned after any under edit (null: rescan) */
  private platforms: [number, number][] | null = null;
  /** riders per running train, flat [lineId, trains, load…], and whether it changed since net last sent it */
  loads: number[] = [];
  loadsChanged = false;
  private loadsSig = '';
  /** what the last commit bored, for the save toast */
  lastBore: { tiles: number; crossovers: number; cost: number } | null = null;

  constructor(w: World, transit: Transit) {
    super(w, transit);
    this.env = { tile: (x, y) => w.peekTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y), under: (x, y) => w.underAt(x, y) };
  }

  // ---- ModeService: routes ----------------------------------------------------------------------

  stopProblem(x: number, y: number): string | null {
    const s = metroStop(x, y, this.env);
    return 'reason' in s ? cap(s.reason) : null;
  }

  /** The sides every routed metro line but `except` runs on at a tile (planBore's inUse, underNet's taken), overruns included. */
  private sidesOf(keep: (rl: TimetabledLine) => boolean): (x: number, y: number) => number {
    const m = new Map<number, number>();
    for (const rl of this.byId.values()) if (rl.route && keep(rl)) lineSides(rl.route, this.env, m);
    return (x, y) => m.get(trackKey(x, y)) ?? 0;
  }

  route(line: TransitLine): LineRoute | string {
    const def = this.def(line);
    for (const [x, y] of def.stations) {
      if (!this.sandbox && metroStationAt(x, y, this.env) && this.w.parcelAt(x, y)?.owner !== line.owner) return `The station at (${x}, ${y}) is not yours: a line calls only at its owner's stations`;
    }
    const r = routeNet(def, underNet(this.env, this.sidesOf((o) => o.line.id !== line.id)));
    if (!r.ok) return `${cap(lineName(line))}: ${this.blame(def, r.reason, (o) => o.line.id !== line.id)}`;
    return lapOf(r.route, def.stations.length);
  }

  /** The route through the tunnels, keeping off every other line's (earlier lines as just derived, later ones as they were). */
  protected network(rl: TimetabledLine): { route: RailRoute; tiles: Set<number> } | string {
    const r = routeNet(rl.def, underNet(this.env, this.sidesOf((o) => o !== rl)));
    return r.ok ? r : this.blame(rl.def, r.reason, (o) => o !== rl);
  }
  /** A line that cannot be routed: when it could be with the other lines' tunnels open, say whose tunnel it would run in. */
  private blame(def: RailLineDef, reason: string, others: (o: TimetabledLine) => boolean): string {
    const free = routeNet(def, underNet(this.env));
    if (!free.ok) return reason;
    const mine = lineSides(free.route);
    for (const o of [...this.byId.values()].sort((a, b) => a.line.id - b.line.id)) {
      if (!o.route || !others(o)) continue;
      const theirs = lineSides(o.route, this.env);
      for (const [k, m] of mine) if ((theirs.get(k) ?? 0) & m) return `it would run in ${lineName(o.line)}'s tunnel (lines share no tunnel; they cross only at right angles)`;
    }
    return reason;
  }
  protected unbuilt(rl: TimetabledLine): [number, number] | undefined {
    return rl.def.stations.find(([x, y]) => { const s = metroStationAt(x, y, this.env); return !s || !metroStationBuilt(s, this.env); });
  }

  // ---- ModeService: the editor and saving -------------------------------------------------------

  /** A draft line bored and routed as a save would do it: the lap, the new tunnel and crossovers, the cost, or what is wrong. */
  plan(line: TransitLine): Omit<LinePreview, 'seq'> {
    const none = { ok: false, path: [], calls: [], callNodes: [], turns: [], length: 0, lapTicks: 0 };
    const capped = this.capProblem(line);
    if (capped) return { ...none, problem: { message: capped, tiles: [], fatal: true } };
    const def = this.def(line);
    const p = planBore(def, this.env, this.sidesOf((o) => o.line.id !== line.id));
    if (!p.ok) return { ...none, problem: this.withFix(p.problem, line) };
    const lap = lapOf(p.route, def.stations.length);
    const out: Omit<LinePreview, 'seq'> = {
      ok: true, path: lap.path, calls: lap.calls, callNodes: lap.callNodes, turns: [], length: lap.path.length / 2,
      lapTicks: Math.round(railService(def, p.route).T), bore: p.bore, crossovers: p.crossovers, cost: p.cost,
    };
    const short = this.shortOf(line.owner, p.cost);
    if (short) { out.ok = false; out.problem = { message: short, tiles: [], fatal: true }; }
    return out;
  }
  /** Bore what the line is missing and charge the owner (Transit.saveLine, before route()); an error refuses the save. */
  commit(line: TransitLine): string | null {
    this.lastBore = null;
    const capped = this.capProblem(line);
    if (capped) return capped;
    const p = planBore(this.def(line), this.env, this.sidesOf((o) => o.line.id !== line.id));
    if (!p.ok) return problemText(this.withFix(p.problem, line));
    const short = this.shortOf(line.owner, p.cost);
    if (short) return short;
    for (let i = 0; i < p.writes.length; i += 3) this.w.setUnder(p.writes[i], p.writes[i + 1], p.writes[i + 2]);
    if (p.cost) this.w.credit(line.owner, -p.cost, 'build');
    this.lastBore = { tiles: p.bore.length / 2, crossovers: p.crossovers.length / 2, cost: p.cost };
    this.pending = true;
    return null;
  }
  private capProblem(line: TransitLine): string | null {
    let n = 0;
    for (const l of this.w.transitLines.values()) if (l.mode === 'metro' && l.owner === line.owner && l.id !== line.id) n++;
    return n >= METRO.linesPerOwner ? `You run ${METRO.linesPerOwner} metro lines already, the most one owner may` : null;
  }
  private shortOf(owner: string, cost: number): string | null {
    const p = this.w.players.get(owner);
    return p && cost > 0 && p.money < cost && !p.devUnlimited ? `Boring the tunnel costs $${cost.toLocaleString('en-GB')}; the treasury has $${Math.floor(p.money).toLocaleString('en-GB')}` : null;
  }

  /**
   * A refusal from planBore, told with the stations' names and a tile to fix it with: for a leg that cannot be bored,
   * a free tile within the change walk of one of the two stations where an entrance's platform would let the leg
   * through; for a station another line already calls at, a free tile nearby for a second entrance.
   */
  private withFix(p: LineProblem, line: TransitLine): LineProblem {
    const label = (i: number) => { const [x, y] = this.doorOf(line.stops[i].x, line.stops[i].y); return `${this.w.stopLabel(x, y)} (stop ${i + 1})`; };
    const out: LineProblem = { ...p };
    if (p.from !== undefined && p.to !== undefined) {
      const closing = line.loop && p.to === 0 && p.from === line.stops.length - 1 && line.stops.length > 1;
      out.message = closing
        ? `No tunnel can be bored from ${label(p.from)} back round into ${label(p.to)}`
        : `No tunnel can be bored from ${label(p.from)} to ${label(p.to)}`;
      for (const which of [p.to, p.from]) {
        const s = this.suggestMove(line, which, which === p.to ? p.from : p.to);
        if (!s) continue;
        out.suggest = s;
        out.fix = `${p.fix ?? 'Move a station'}; an entrance at (${s[0]}, ${s[1]}) in place of ${label(which)} would let the tunnel through`;
        break;
      }
    } else if (p.stop !== undefined && /already calls/.test(p.message)) {
      const [dx, dy] = this.doorOf(line.stops[p.stop].x, line.stops[p.stop].y);
      out.message = `Another line already calls at ${label(p.stop)}`;
      const s = this.freeTiles(line.owner, dx, dy, TRANSIT.transferWalk)[0];
      if (s) { out.suggest = [s[0], s[1]]; out.fix = `${p.fix}: an entrance at (${s[0]}, ${s[1]}) is within the walk`; }
    } else if (p.stop !== undefined && /broken|no platform/.test(p.message)) {
      out.fix ??= 'Bulldoze the entrance and build it again: its platform is laid with it';
    }
    return out;
  }
  /**
   * Tiles within r (Manhattan) of (x, y), nearest first, where `owner` could put an entrance kiosk now: their land
   * (any land in a sandbox), dry, clear, beside a road, with room for its platform. Each is [x, y, alongX].
   */
  private freeTiles(owner: string, x: number, y: number, r: number): [number, number, boolean][] {
    const out: [number, number, boolean, number][] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (!d || d > r) continue;
      const tx = x + dx, ty = y + dy, t = this.w.peekTile(tx, ty);
      if (t === undefined || !isBuildable(t) || isRoad(t) || this.w.auxAt(tx, ty)) continue;
      if (zoneOf(t) !== Zone.None && (levelOf(t) > 0 || underConstruction(t))) continue;
      if (!this.sandbox && this.w.parcelAt(tx, ty)?.owner !== owner) continue;
      const turn = kioskTurn(tx, ty, (a, b) => this.w.peekTile(a, b));
      if (turn < 0) continue;
      const along = platformAlongX(turn);
      if (!planPlatform(METRO_ENTRANCE, tx, ty, along, this.env).ok) continue;
      out.push([tx, ty, along, d]);
    }
    out.sort((a, b) => a[3] - b[3] || a[1] - b[1] || a[0] - b[0]);
    return out.map(([a, b, c]) => [a, b, c]);
  }
  /** A tile to move station `which` to so the leg between it and station `other` can be bored, or null. */
  private suggestMove(line: TransitLine, which: number, other: number): [number, number] | null {
    const [wx, wy] = this.doorOf(line.stops[which].x, line.stops[which].y);
    const [ox, oy] = this.doorOf(line.stops[other].x, line.stops[other].y);
    const old = metroStationAt(wx, wy, this.env);
    const inUse = this.sidesOf((o) => o.line.id !== line.id);
    for (const [cx, cy, along] of this.freeTiles(line.owner, wx, wy, TRANSIT.transferWalk).slice(0, SUGGEST_TRIES)) {
      const plat = planPlatform(METRO_ENTRANCE, cx, cy, along, this.env);
      const under = new Map<number, number>();
      if (old) for (let a = old.a0; a <= old.a1; a++) { const [x, y] = old.alongX ? [a, old.row] : [old.row, a]; under.set(trackKey(x, y), tunnelByte(underMask(this.env.under(x, y)))); }
      for (let i = 0; i < plat.writes.length; i += 3) under.set(trackKey(plat.writes[i], plat.writes[i + 1]), plat.writes[i + 2]);
      const kiosk = packTile(terrainOf(this.w.peekTile(cx, cy)!), false, familyOf(METRO_ENTRANCE), 1), ck = trackKey(cx, cy);
      const env: MetroEnv = {
        tile: (x, y) => (trackKey(x, y) === ck ? kiosk : this.env.tile(x, y)),
        aux: (x, y) => (trackKey(x, y) === ck ? 0 : this.env.aux(x, y)),
        sub: (x, y) => (trackKey(x, y) === ck ? subFor(METRO_ENTRANCE) : this.env.sub(x, y)),
        under: (x, y) => under.get(trackKey(x, y)) ?? this.env.under(x, y),
      };
      const pair: [number, number][] = which > other ? [[ox, oy], [cx, cy]] : [[cx, cy], [ox, oy]];
      if (planBore({ stations: pair, loop: false }, env, inUse).ok) return [cx, cy];
    }
    return null;
  }

  /** Riders cross the platform to the train and use the stairs at both ends: the timetable's time plus METRO.access. */
  rideTicks(line: TransitLine, a: number, b: number): number {
    return super.rideTicks(line, a, b) + METRO.access;
  }
  /** A rider waits at a seeded spot along the platform, on either side of the track (organic: everyone has their own). */
  waitSpot(stop: StopRef, citizenId: number): [number, number] | null {
    const s = metroStationAt(stop.x, stop.y, this.env);
    if (!s) return null;
    const along = s.a0 + 0.3 + hash2(citizenId, 63) * (s.len - 0.6);
    const off = (hash2(citizenId, 64) < 0.5 ? -1 : 1) * (0.3 + 0.12 * hash2(citizenId, 65));
    return s.alongX ? [along, s.row + 0.5 + off] : [s.row + 0.5 + off, along];
  }

  // ---- running ----------------------------------------------------------------------------------

  protected capacity(svc: RailService) { return svc.vehicles * METRO.carRiders; }

  tick() {
    if (this.w.tick % ORPHAN_EVERY === 0) this.orphans();
    // any under edit (a bore, a platform, the bulldozer, the seeder) re-derives the lines at this tick, as track edits do for rail
    if (this.w.underVersion !== this.seenUnder) { this.seenUnder = this.w.underVersion; this.platforms = null; this.pending = true; }
    super.tick();
    if (this.w.tick % LOADS_EVERY === 0) this.noteLoads();
  }
  /**
   * Re-derive every line, unless nothing a route or a service is derived from has changed since the last time: the
   * layer (World.underVersion), the lines and their stops, the station doors' tile words (built, bulldozed) and the
   * registry's verdicts. Unlike surface track, nothing else can move a metro route.
   */
  rebuild() {
    if (this.rebuildInputs() === this.rebuilt) return;
    super.rebuild();
    this.rebuilt = this.rebuildInputs();
  }
  private rebuildInputs(): string {
    let s = `${this.w.underVersion}`;
    for (const l of this.w.transitLines.values()) {
      if (l.mode !== 'metro') continue;
      s += `|${l.id}:${l.vehicles}:${l.loop ? 1 : 0}:${this.transit.routeProblem(l.id)}`;
      for (const st of l.stops) { const [x, y] = this.doorOf(st.x, st.y); s += `,${x},${y},${this.w.peekTile(x, y)}`; }
    }
    return s;
  }
  /** Platforms whose entrance has gone (bulldozed, or a site given up) turn back into plain tunnel. */
  private orphans() {
    if (!this.platforms) this.platforms = this.scanPlatforms();
    let any = false;
    for (const [x, y] of this.platforms) {
      const writes = orphanPlatform(x, y, this.env);
      for (let i = 0; i < writes.length; i += 3) { this.w.setUnder(writes[i], writes[i + 1], writes[i + 2]); any = true; }
    }
    if (any) this.platforms = null;
  }
  /** The first tile of every platform run in the layer (a full scan, only after the layer changed). */
  private scanPlatforms(): [number, number][] {
    const out: [number, number][] = [];
    for (const ch of this.w.chunks.values()) {
      const u = ch.under;
      for (let i = 0; i < u.length; i++) {
        if (!isPlatform(u[i])) continue;
        const x = ch.cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = ch.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        const alongX = underMask(u[i]) === 10, prev = alongX ? this.w.underAt(x - 1, y) : this.w.underAt(x, y - 1);
        if (!isPlatform(prev) || prev !== u[i]) out.push([x, y]);
      }
    }
    return out;
  }
  private noteLoads() {
    const out: number[] = [];
    for (const rl of [...this.byId.values()].sort((a, b) => a.line.id - b.line.id)) {
      if (!rl.svc) continue;
      out.push(rl.line.id, rl.svc.trains);
      for (let i = 0; i < rl.svc.trains; i++) out.push(this.transit.load(trainVehicleId(rl.line.id, i)));
    }
    const sig = out.join(',');
    if (sig !== this.loadsSig) { this.loadsSig = sig; this.loads = out; this.loadsChanged = true; }
  }

  /** The lines on the wire ('metroLines'): rail's form, with the stations' names. */
  dtos(): MetroLineDTO[] {
    return super.dtos().map((d) => ({ ...d, names: d.stations.map(([x, y]) => this.w.stopLabel(x, y)) }));
  }

  // ---- stations and tunnels ---------------------------------------------------------------------

  /**
   * The platform a metro station with its door at (x, y) puts under it, as flat [x, y, byte] writes, or why it cannot
   * go there. `rot` is the turn (a hall's placed turn, or the kiosk tool's Z/C); with none a kiosk faces its road.
   */
  platformFor(kind: number, x: number, y: number, rot?: number): number[] | string {
    if (!isMetroStationKind(kind)) return [];
    const r = rot ?? kioskTurn(x, y, (a, b) => this.w.peekTile(a, b));
    if (r < 0) return 'A metro entrance needs a road next to it';
    const plan = planPlatform(kind, x, y, platformAlongX(r), this.env);
    return plan.ok ? plan.writes : plan.reason ?? 'The platform cannot go there';
  }
  /** Write a platform from platformFor. */
  lay(writes: number[]) {
    for (let i = 0; i < writes.length; i += 3) this.w.setUnder(writes[i], writes[i + 1], writes[i + 2]);
  }
  /**
   * The underground bulldozer: fill the tunnel tile (x, y), free and for nothing back, when no line runs through it, it
   * is not a platform and it is not under someone else's land (`anyLand` in a sandbox). Its neighbours' joints to it go
   * too. Returns why not, or null.
   */
  fill(p: Player, x: number, y: number, anyLand = false): string | null {
    const b = this.w.underAt(x, y);
    if (!isTunnel(b)) return 'There is no tunnel there';
    if (isPlatform(b)) return 'That is a platform: bulldoze its station on the surface';
    const k = trackKey(x, y);
    for (const rl of [...this.byId.values()].sort((a, c) => a.line.id - c.line.id)) {
      if (rl.route && lineSides(rl.route, this.env).has(k)) return `${lineName(rl.line)} runs through that tunnel`;
    }
    const q = this.w.parcelAt(x, y);
    if (q && q.owner !== p.id && !anyLand) return 'That tunnel is under someone else\'s land';
    const m = underMask(b);
    this.w.setUnder(x, y, 0);
    for (let s = 0; s < 4; s++) {
      if (!(m & (1 << s))) continue;
      const nx = x + RAIL_SIDES[s][0], ny = y + RAIL_SIDES[s][1], nb = this.w.underAt(nx, ny);
      if (isTunnel(nb) && !isPlatform(nb)) this.w.setUnder(nx, ny, tunnelByte(underMask(nb) & ~(1 << oppSide(s))));
    }
    this.pending = true;
    return null;
  }

  // ---- tooltips ----------------------------------------------------------------------------------

  /** The metro section of the tooltip of the station covering (x, y). */
  describeStation(x: number, y: number): MetroStationInfo | undefined {
    const [dx, dy] = this.doorOf(x, y);
    if (!isMetroStationKind(this.w.kindIdAt(dx, dy))) return undefined;
    const st = metroStop(dx, dy, this.env);
    const now = this.railTick, today = Math.floor(now / TICKS_PER_DAY);
    const s = this.stats.get(`${dx},${dy}`);
    const info: MetroStationInfo = {
      name: this.w.stopLabel(dx, dy),
      track: 'reason' in st ? cap(st.reason) : metroStationBuilt(st, this.env) ? 'open' : 'opens when the entrance is built',
      lines: [], changes: [],
      callsToday: s && s.day === today ? s.calls : 0, boardedToday: s && s.day === today ? s.boarded : 0,
      alightedToday: s && s.day === today ? s.alighted : 0, faresToday: 0,
    };
    if (!('reason' in st)) {
      const [x0, y0] = st.alongX ? [st.a0, st.row] : [st.row, st.a0], [x1, y1] = st.alongX ? [st.a1, st.row] : [st.row, st.a1];
      info.platform = [x0, y0, x1, y1];
    }
    for (const rl of [...this.byId.values()].sort((a, b) => a.line.number - b.line.number)) {
      const i = rl.def.stations.findIndex(([sx, sy]) => sx === dx && sy === dy);
      if (i < 0) continue;
      const row: MetroStationInfo['lines'][number] = { id: rl.line.id, number: rl.line.number, name: rl.def.name, color: rl.line.colour, status: rl.status };
      if (rl.svc) {
        row.headwayMin = headwayMinutes(rl.svc);
        const n = rl.def.stations.length, names = (j: number) => this.w.stopLabel(rl.def.stations[j][0], rl.def.stations[j][1]);
        for (const j of [i + 1 < n ? i + 1 : rl.def.loop ? 0 : -1, i > 0 && !rl.def.loop ? i - 1 : -1]) {
          if (j < 0) continue;
          const ride = nextRide(rl.svc, i, j, now);
          const end = rl.def.loop ? 'round the loop' : `towards ${names(j > i ? n - 1 : 0)}`;
          if (ride && (!row.next || ride.depart < row.next.tick)) row.next = { tick: ride.depart, toward: end };
        }
      }
      info.lines.push(row);
    }
    // change here for: other routed stops within the walk, with their lines (this station's own lines left out)
    const mine = new Set(info.lines.map((l) => l.id));
    for (const { s: o, lines } of this.transit.stopsAround(dx, dy, TRANSIT.transferWalk)) {
      if (o.x === dx && o.y === dy) continue;
      const others = lines.filter((l) => !mine.has(l.id));
      if (!others.length) continue;
      info.changes.push({
        name: this.w.stopLabel(o.x, o.y), x: o.x, y: o.y, mode: others[0].mode,
        lines: others.map((l) => ({ id: l.id, number: l.number, name: l.name, colour: l.colour })),
      });
    }
    return info;
  }

  /** A metro train's tooltip; `full` (the selected train's panel) adds everyone on board. */
  describeTrain(lineId: number, train: number, full = false): TrainInfo | null {
    const rl = this.byId.get(lineId);
    if (!rl?.svc) return null;
    const t = trainsAt(rl.svc, this.railTick).find((s) => s.train === train);
    if (!t) return null;
    const vid = trainVehicleId(lineId, train), st = rl.def.stations, n = st.length;
    const name = (i: number) => this.w.stopLabel(st[i][0], st[i][1]);
    const info: TrainInfo = {
      line: lineId, number: rl.line.number, colour: rl.line.colour, freight: false,
      state: t.phase === 'dwell' ? `standing at ${name(t.stop)}` : `running to ${name(t.stop)}`,
      load: this.transit.load(vid), capacity: this.capacity(rl.svc),
    };
    const prev = t.phase === 'dwell' ? t.stop : rl.def.loop ? (t.stop - 1 + n) % n : t.stop - t.dir;
    if (prev >= 0 && prev < n) info.prev = name(prev);
    info.next = name(t.stop);
    if (full) {
      const aboard = this.transit.aboard(vid);
      info.riders = aboard.slice(0, ROSTER_CAP).map(({ c, off }) => ({
        id: c.id, name: nameFor(c.id, c.sn), activity: `to ${this.w.stopLabel(off.x, off.y)}`, here: true, age: Math.floor(ageOf(c, this.w.tick)), stage: c.stage,
      }));
      if (aboard.length > ROSTER_CAP) info.truncated = true;
    }
    return info;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lineName = (l: TransitLine) => (l.name ? `the ${l.name} line` : `line ${l.number}`);
