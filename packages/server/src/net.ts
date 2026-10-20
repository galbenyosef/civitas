import type { Conn, ConnSource } from './transport';
import {
  CHUNK_SIZE, START_MONEY, FRONTIER_MONEY, LAND_PRICE_PER_TILE, MAX_PARCEL_EDGE, ROAD_COST, PUBLIC_ROAD_COST, ZONE_COST,
  BULLDOZE_COST, MAX_SUBS, MAX_TAX, DEFAULT_TAX, Zone, CitizenState, CIVIC_COST, workOf, KIND_NAMES, TRAFFIC_EVERY,
  isRoad, isBuildable, isGrowable, zoneOf, levelOf, terrainOf, packTile, chunkKey, chunkOf, parseKey, packCitizenFlags, localIndex, isStructureAux,
  u16ToB64, i32ToB64, u8ToB64, hasFeature, techFor, TECH_BY_ID, ALL_TECH_IDS, checkPurchase, ZONE_TOOLS, CIVIC_TOOLS, MANIFEST,
  isMultiTile, planStructure, planRunway, isAirfieldAux, RUNWAY_MAX, isRailAux, isRailStationKind, RAIL_DRAG_MAX, roadOverTrackProblem, CROSSING_COST, familyOf, subFor, kindManifest, isHarbourId,
  isJunctionAux, isRingAux, isIslandAux, planRoundabout, planFlyover,
  isBridgeAux, planBridge, joinsBridgeSide, BRIDGE_STYLE_NAMES, type BridgePlan,
  type LandRect, type ClientMsg, type ServerMsg, type Tool, type HintId, BUS_STOP_KIND, type TransitLine, TICKS_PER_HOUR, underConstruction,
  isMetroStationKind, CITIZEN_UNDER, isFerryPierKind, CAMP_KIND, type RecoverAction,
} from '@msimcity/shared';
import { World, emptyStats, DEV_FUNDS, untkey, tkey, type Player } from './world';
import type { Simulation } from './sim/simulation';
import { interiorLots } from './sim/blocks';
import type { Airports } from './sim/airports';
import type { Harbours } from './sim/harbours';
import type { Rail } from './sim/rail';
import type { Metro } from './sim/metro';
import type { Ferry } from './sim/ferry';
import { Onboarding } from './goals';
import { Ranks } from './ranks';
import { historyOf, type History } from './history';
import { MapSummaries } from './worldmap';
import { setPolicy } from './policies';
import { mothballable, adminRefusal, type Finance } from './sim/finance';
import type { Issues } from './sim/issues';
import type { Fires } from './sim/fires';
import type { Adverts } from './sim/adverts';
import type { News } from './sim/news';
import { Overlays } from './overlays';
import { ISSUE_TUNING, OVERLAY_COUNT, Issue } from '@msimcity/shared';

interface Client {
  conn: Conn; player: Player | null; subs: Set<string>; lastHint: number;
  /** builder hints (builderHints): tick of the last one, and the player's `built` counter and the tick it was last seen to move */
  builderHint: number; builtSeen: number; builtMoved: number;
  /** the last goals message sent (goals.ts), so only changes go out */
  goalsSig?: string;
  /** the last rank message sent (ranks.ts) */
  rankSig?: string;
  /** the charts panel is open (history.ts): it gets each hourly sample */
  hist?: boolean;
  /** issue bubbles (flushIssues): the last problems list sent; the overlay channel asked for, a hash of what each chunk last got, chunks still to look at */
  probSig?: string; ovl?: number; ovlSent?: Map<string, number>; ovlQueue?: string[];
}

/** tool id -> kind id, from the building catalogue: zoning tools for growable kinds, placement tools for civic ones.
 * Placing writes the kind's family code into the tile word and its id into the sub layer (docs/sub-kinds.md). */
const TOOL_ZONE: Record<string, number> = ZONE_TOOLS;
const TOOL_CIVIC: Record<string, number> = CIVIC_TOOLS;
const HINT_EVERY = 1200;
/** Lots of yours waiting with no builder on them before the hourly check says why (builderHints), and how often it may. */
const WAITING_HINT = 8;
const BUILDER_HINT_EVERY = TICKS_PER_HOUR * 24 * 3; // the issue bubbles show waiting sites all the time now (sim/issues.ts)
/** Onboarding goals are measured this often (a quarter of a game hour). */
const GOALS_EVERY = TICKS_PER_HOUR / 4;
/** How this game is run, set by its host (index.ts for the server; a local-mode worker later, docs/local-mode.md). */
export interface GameConfig {
  /** dev tools: draft kinds can be placed (also on unclaimed land), and the dev actions (unlimited funds, money, tech) work */
  devTools: boolean;
  /** a sandbox (a test city or a demo map): every technology and an endless treasury for whoever joins, no onboarding goals */
  sandbox: boolean;
  /** a read-only showcase (SPECTATE=1, docs/demo.md "A public showcase"): only the READ_ONLY intents are answered, every other one
   *  is refused with a toast; no onboarding, and a visitor's player record goes again when they leave */
  spectate?: boolean;
}
/**
 * What a spectator may still ask: looking, never changing. A whitelist, so an intent added to ClientMsg later is refused in
 * spectate mode until it is listed here. (hello and ping are answered before this, as for everyone.)
 */
const READ_ONLY = new Set<ClientMsg['t']>(['sub', 'unsub', 'inspect', 'inspectCitizen', 'inspectTrain', 'sites', 'lines', 'hist', 'map', 'inspectBoat', 'overlay']);
const SPECTATE_REFUSAL = 'Read-only showcase: you can look around, but nothing can be changed here';
const DRAFT_TOOLS = new Set(MANIFEST.filter((k) => k.draft && k.tool).map((k) => k.tool!.id));
const isDraftKind = (id: number) => !!kindManifest(id)?.draft;

const r2 = (v: number) => Math.round(v * 100) / 100;
/** A number for chunk (cx, cy), one to one for |cx|, |cy| < 2^21 (a subscription takes up to 1e6), for the agents' buckets. */
const chunkNum = (cx: number, cy: number) => (cx + 0x200000) * 0x400000 + (cy + 0x200000);
/** chunkNum of the chunk holding the point (x, y) */
const agentChunk = (x: number, y: number) => chunkNum(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));

/** shortest gap between two line previews for one client (editLine) */
const PREVIEW_MS = 100;

/**
 * The game protocol over any transport (transport.ts: WebSockets on the server, a MessagePort in local mode). Clients subscribe to the chunks they can see and only
 * receive tile and citizen updates for those, which is what keeps per-client
 * bandwidth independent of total world size.
 */

export class Net {
  private clients = new Set<Client>();
  /** last quad sent per agent, so only movement goes on the wire */
  /** per agent: x, y and flags as last sent, and the flush that last saw it */
  private lastSent = new Map<number, [number, number, number, number]>();
  /** the city's airports (sim/airports.ts), for terminal tooltips; set by index.ts */
  airports: Airports | null = null;
  /** railways (sim/rail.ts): the track tool, station tooltips and the 'railLines' message; set by index.ts */
  rail: Rail | null = null;
  /** underground railways (sim/metro.ts): platforms under new stations, the underground bulldozer, station tooltips and the 'metroLines' and 'metroLoads' messages; set by game.ts */
  metro: Metro | null = null;
  /** river buses (sim/ferry.ts): pier tooltips, boat tooltips and the 'ferryLines' message; set by game.ts */
  ferry: Ferry | null = null;
  /** harbours (sim/harbours.ts): the 'harbours' message, harbour tooltips, boat panels, a cargo port's sea check; set by game.ts */
  harbours: Harbours | null = null;
  /** the overdraft, administration and the recovery plan (sim/finance.ts); set by game.ts */
  finance: Finance | null = null;
  /** house fires (sim/fires.ts): the 'fires' message, building tooltips and the owners' notices; set by game.ts */
  fires: Fires | null = null;
  /** campaigns and rented ad slots (sim/adverts.ts): the 'ads' message and the advert intents; set by game.ts */
  adverts: Adverts | null = null;
  /** the news story log (sim/news.ts): the 'news' message, media centres' building panels, the news overlay; set by game.ts */
  news: News | null = null;
  /** server tick time over the last minute in ms, filled by index.ts's main loop and sent with the stats message */
  tickStats: { avg: number; p95: number; max: number } | null = null;
  /** game ticks per TICK_MS of wall time, sent with the stats message when it is not 1 so the client's clock follows a paused or
   *  fast-forwarded local game (docs/local-mode.md); the server never changes it */
  rate = 1;
  /** flushes so far: which tenth of the stationary agents is re-sent this time (keeps them alive on clients) */
  private flushes = 0;
  /** false while a test city is still being filled: new sockets are closed so nobody joins a half-grown world */
  accepting = true;
  /** onboarding goals and advisor hints (goals.ts); none in test cities and demos */
  private onboarding: Onboarding | null;
  /** settlement ranks and the milestone feed (ranks.ts); none in test cities and demos */
  readonly ranks: Ranks | null;
  /** spectate: player records made by a visitor's hello, removed when the last socket with that player closes */
  private visitors = new Set<string>();
  /** the world map's ground, per sector (worldmap.ts, docs/world-map.md) */
  readonly map: MapSummaries;

  constructor(private w: World, private sim: Simulation, source: ConnSource, private cfg: GameConfig) {
    this.onboarding = this.cfg.sandbox || this.cfg.spectate ? null : new Onboarding(w, sim.traffic);
    this.ranks = this.cfg.sandbox || this.cfg.spectate ? null : new Ranks(w);
    this.map = new MapSummaries(w);
    source.onConnection((conn) => {
      if (!this.accepting) { conn.close(1013, 'starting'); return; }
      const c: Client = { conn, player: null, subs: new Set(), lastHint: 0, builderHint: -Infinity, builtSeen: -1, builtMoved: 0 };
      this.clients.add(c);
      conn.onMessage((data) => {
        let msg: ClientMsg;
        try { msg = JSON.parse(data); } catch { return; }
        try { this.handle(c, msg); } catch (e) { console.error('handler error', e); }
      });
      conn.onClose(() => { this.clients.delete(c); this.w.playersDirty = true; if (c.player) this.leave(c.player.id); });
    });
  }

  private send(c: Client, m: ServerMsg) {
    if (c.conn.open) c.conn.send(JSON.stringify(m));
  }
  private broadcast(m: ServerMsg) {
    const s = JSON.stringify(m);
    for (const c of this.clients) if (c.player && c.conn.open) c.conn.send(s);
  }
  private toast(c: Client, msg: string, kind: 'info' | 'error' = 'error') { this.send(c, { t: 'toast', kind, msg }); }

  private isOnline(id: string) {
    for (const c of this.clients) if (c.player?.id === id) return true;
    return false;
  }
  private playerDTOs(ledger = false) { return [...this.w.players.values()].map((p) => this.w.playerDTO(p, this.isOnline(p.id), ledger)); }
  /** game hour of the last players message that carried the ledgers */
  private ledgerHour = -1;

  // ---- inbound ---------------------------------------------------------------

  private handle(c: Client, m: ClientMsg) {
    if (m.t === 'hello') return this.hello(c, m.name);
    if (m.t === 'ping') return this.send(c, { t: 'pong', n: m.n });
    if (!c.player) return;
    if (this.cfg.spectate && !READ_ONLY.has(m.t)) return this.toast(c, SPECTATE_REFUSAL);
    // administration (sim/finance.ts): building, buying, zoning, roads, research and lines stop; bulldozing, parcel
    // settings and the recovery plan still work
    if (c.player.admin) { const no = adminRefusal(m); if (no) return this.toast(c, no); }
    switch (m.t) {
      case 'sub': return this.subscribe(c, m.chunks);
      case 'unsub': for (const [cx, cy] of m.chunks) { c.subs.delete(chunkKey(cx, cy)); c.ovlSent?.delete(chunkKey(cx, cy)); } return;
      case 'buy': return this.buy(c, m.x, m.y, m.w, m.h);
      case 'build': return m.under === true && m.tool === 'bulldoze' ? this.fillTunnels(c, m.tiles) : this.build(c, m.tool, m.tiles, this.cfg.devTools && m.dev === true, typeof m.rot === 'number' ? m.rot : undefined);
      case 'parcel': return this.editParcel(c, m.id, m.taxRate, m.name, m.color);
      case 'parcelOp': return this.parcelOp(c, m);
      case 'map': for (const json of this.map.answer(m.s, m.l)) if (c.conn.open) c.conn.send(json); return;
      case 'inspect': return this.inspect(c, m.x, m.y, m.full === true);
      case 'inspectCitizen': {
        const info = this.sim.describeCitizen(Number(m.id), m.route === true), atSea = info && this.harbours?.atSea(Number(m.id));
        if (info && atSea) info.atSea = atSea; // a fishing crew member out on their trawler (sim/harbours.ts)
        return this.send(c, { t: 'citizen', id: Number(m.id), info });
      }
      case 'unlock': return this.unlock(c, String(m.id));
      case 'setPolicy': { const r = setPolicy(this.w, c.player, String(m.id), m.on === true); return this.toast(c, r.msg, r.ok ? 'info' : undefined); }
      case 'recover': return this.recover(c, m.action, m.keys);
      case 'dev': return this.dev(c, m.action, m.on, m.amount, m.x, m.y);
      case 'sites': return this.siteList(c, m.id);
      case 'priority': return this.setPriority(c, m.x, m.y, m.priority);
      case 'inspectTrain': return this.send(c, { t: 'train', line: Number(m.line), train: Number(m.train), info: this.rail?.describeTrain(Number(m.line), Number(m.train), !!m.full) ?? this.metro?.describeTrain(Number(m.line), Number(m.train), !!m.full) ?? this.ferry?.describeTrain(Number(m.line), Number(m.train), !!m.full) ?? null });
      case 'lines': return this.send(c, this.linesMsg());
      case 'line': return this.editLine(c, m);
      case 'hist': return this.histOpen(c, m.open === true);
      case 'goals': case 'hint': this.onboarding?.command(c.player, m); return this.goals(c);
      case 'inspectBoat': return this.send(c, { t: 'boat', id: Number(m.id), info: this.harbours?.inspectBoat(Number(m.id)) ?? null });
      case 'overlay': return this.setOverlay(c, Number(m.ch));
      case 'adCampaign': case 'adRent': case 'adEnd': return this.advert(c, m);
    }
  }

  /** The charts panel opened or closed: on opening, the whole history (docs/charts.md); then each hour's sample until it closes. */
  private histOpen(c: Client, open: boolean) {
    c.hist = open;
    if (!open || !c.player) return;
    const h = historyOf(this.w);
    this.send(c, { t: 'history', hour: h.hour, world: h.world.toDTO(), mine: h.playerDTO(c.player.id) });
  }
  /** A new hourly sample (game.ts): to every client with the charts panel open. */
  historySample(h: History) {
    for (const c of this.clients) {
      if (!c.hist || !c.player || !c.conn.open) continue;
      this.send(c, { t: 'histSample', hour: h.hour, w: Array.from(h.lastWorld, r2), p: Array.from(h.playerSample(c.player.id), r2) });
    }
  }

  /** Testing aids, only on a non-production server: unlimited funds, a cash grant, every technology, a fire. */
  private dev(c: Client, action: string, on?: boolean, amount?: number, x?: number, y?: number) {
    if (!this.cfg.devTools) return this.toast(c, 'Dev tools are off on this server');
    const p = c.player!;
    if (action === 'unlimited') {
      p.devUnlimited = on !== false;
      if (p.devUnlimited) p.money = Math.max(p.money, DEV_FUNDS);
      this.w.playersDirty = true;
      return this.toast(c, p.devUnlimited ? 'Unlimited funds on' : 'Unlimited funds off', 'info');
    }
    if (action === 'money') {
      const n = typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount) : 100_000;
      this.w.credit(p.id, n, 'other');
      return this.toast(c, `${n >= 0 ? 'Granted' : 'Took away'} $${Math.abs(n).toLocaleString('en-GB')}`, 'info');
    }
    if (action === 'tech') {
      p.tech = [...new Set([...p.tech, ...ALL_TECH_IDS])];
      this.w.techVersion++;
      this.w.playersDirty = true;
      return this.toast(c, 'Every technology unlocked', 'info');
    }
    if (action === 'fire' && this.fires && Number.isInteger(x) && Number.isInteger(y)) {
      const [dx, dy] = this.w.doorOf(x!, y!), b = this.w.buildings.get(`${dx},${dy}`);
      return this.toast(c, b && this.fires.ignite(b) ? `Set the ${KIND_NAMES[b.id]} at (${b.x}, ${b.y}) on fire` : 'Nothing there that can burn', 'info');
    }
  }

  private hello(c: Client, rawName: string) {
    const name = String(rawName ?? '').trim().slice(0, 20);
    if (!name) return this.toast(c, 'Name required');
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (id === 'sys') return this.toast(c, 'That name is reserved');
    if (this.cfg.spectate && !this.w.players.has(id)) this.visitors.add(id);
    const newcomer = !this.w.players.has(id);
    c.player = this.w.getOrCreatePlayer(id, name, this.w.start === 'frontier' ? FRONTIER_MONEY : START_MONEY);
    if (newcomer && this.w.start === 'frontier') this.charter(c.player);
    if (this.cfg.sandbox && !this.cfg.spectate) { // a test city is a sandbox: every technology and an endless treasury for whoever joins
      c.player.tech = [...new Set([...c.player.tech, ...ALL_TECH_IDS])];
      c.player.devUnlimited = true;
      c.player.money = Math.max(c.player.money, DEV_FUNDS);
      this.w.techVersion++;
    }
    this.w.playersDirty = true;
    this.send(c, {
      t: 'welcome', you: c.player.id, seed: this.w.seed, day: this.w.day, ...(this.cfg.sandbox ? { sandbox: true } : {}), ...(this.cfg.spectate ? { spectate: true } : {}),
      ...(this.w.start === 'frontier' ? { start: 'frontier' as const, ...(this.w.home ? { home: this.w.home } : {}) } : {}),
      players: this.playerDTOs(true),
      parcels: [...this.w.parcels.values()].map((p) => this.w.parcelDTO(p)),
    });
    this.send(c, this.linesMsg());
    if (this.rail) this.send(c, { t: 'railLines', lines: this.rail.dtos() });
    if (this.metro) { this.send(c, { t: 'metroLines', lines: this.metro.dtos() }); if (this.metro.loads.length) this.send(c, { t: 'metroLoads', l: this.metro.loads }); }
    if (this.ferry) this.send(c, { t: 'ferryLines', lines: this.ferry.dtos() });
    if (this.harbours) this.send(c, this.harbours.msg());
    if (this.fires) this.send(c, { t: 'fires', f: this.fires.dtos() });
    if (this.adverts) this.send(c, { t: 'ads', ...this.adverts.dto() });
    if (this.news) this.send(c, { t: 'news', s: this.news.recent(), all: true });
    c.goalsSig = undefined; this.goals(c);
    c.rankSig = undefined; this.rankTo(c);
    c.probSig = undefined; this.problemsTo(c);
  }

  /** Spectate: a visitor's player record (made by their hello) goes when their last socket closes, so a public showcase's saves do not
   *  fill up with everyone who ever looked. A record that was there before they came is never touched. */
  private leave(id: string) {
    if (!this.visitors.has(id) || this.isOnline(id)) return;
    this.visitors.delete(id);
    this.w.players.delete(id);
    historyOf(this.w).forget(id);
  }

  /** The player's goals when they changed (or a goal was just completed), measured afresh (goals.ts). */
  private goals(c: Client) {
    if (!this.onboarding || !c.player) return;
    const r = this.onboarding.check(c.player);
    if (r.sig === c.goalsSig && !r.msg.completed) return;
    c.goalsSig = r.sig;
    this.send(c, r.msg);
  }
  /** The player's settlement rank and milestones when they changed (ranks.ts); a rank reached pays and celebrates. */
  private rankTo(c: Client) {
    if (!this.ranks || !c.player) return;
    const r = this.ranks.check(c.player);
    if (r.sig === c.rankSig && !r.msg.up && !r.msg.fresh) return;
    c.rankSig = r.sig;
    this.send(c, r.msg);
  }
  /** An advisor hint (goals.ts), unless dismissed or heard today; in test cities a toast as before. */
  private hint(c: Client, id: HintId, msg: string) {
    if (!this.onboarding) return this.toast(c, msg, 'info');
    const m = this.onboarding.hint(c.player!, id, msg);
    if (m) this.send(c, m);
  }

  // ---- transit lines (sim/transit.ts) -------------------------------------------------------------

  /** Every line with its route and today's riders, and which line each bus on the road runs (for the livery). */
  private linesMsg(saved?: number): ServerMsg {
    const name = (id: string) => this.w.players.get(id)?.name ?? id;
    return { t: 'lines', lines: this.sim.transit.lineInfos(name), buses: this.sim.buses.liveryPairs(), saved };
  }
  private lastLines = '';
  private lastStats = ''; private lastBuses = ''; private statsAt = 0;
  /** Create, replace or delete one of your lines; everyone gets the new list. */
  private editLine(c: Client, m: { op: 'save'; line: Partial<TransitLine> } | { op: 'delete'; id: number } | { op: 'preview'; line: Partial<TransitLine>; seq: number }) {
    const p = c.player!;
    if (m.op === 'preview') return this.previewLine(c, m);
    const need = this.locked(p, 'lines');
    if (need && !(this.cfg.devTools && p.devUnlimited)) return this.toast(c, `${need} is needed before you can run bus lines`);
    if (m.op === 'delete') {
      const err = this.sim.transit.deleteLine(p.id, Number(m.id));
      if (err) return this.toast(c, err);
      this.toast(c, 'Line deleted', 'info');
    } else if (m.op === 'save') {
      const r = this.sim.transit.saveLine(p.id, m.line ?? {});
      if (typeof r === 'string') return this.toast(c, r);
      if (!m.line?.id) this.news?.line(r); // a new line's first service is news
      const bored = r.mode === 'metro' ? this.metro?.lastBore : null;
      if (r.mode === 'metro') this.toast(c, `${r.name ? `The ${r.name} line` : `Line ${r.number}`} saved: ${r.stops.length} stations, ${r.vehicles} train${r.vehicles === 1 ? '' : 's'} asked for${bored?.tiles ? `; ${bored.tiles} tiles of tunnel bored${bored.crossovers ? ` with ${bored.crossovers} crossover${bored.crossovers === 1 ? '' : 's'}` : ''} for $${bored.cost.toLocaleString('en-GB')}` : ''}`, 'info');
      else if (r.mode === 'ferry') this.toast(c, `${r.name ? `The ${r.name} line` : `Line ${r.number}`} saved: ${r.stops.length} piers, ${r.vehicles} boat${r.vehicles === 1 ? '' : 's'} asked for`, 'info');
      else this.toast(c, r.mode === 'rail' ? `Line ${r.number} saved: ${r.stops.length} stations, ${r.vehicles} train${r.vehicles === 1 ? '' : 's'} asked for` : `Line ${r.number} saved: ${r.stops.length} stops, ${r.vehicles} bus${r.vehicles === 1 ? '' : 'es'}`, 'info');
      this.send(c, this.linesMsg(r.id));
    } else return;
    this.lastLines = '';
  }

  /**
   * The line editor's live preview: the draft routed as a save would route it, nothing kept. At most one every
   * PREVIEW_MS per client; requests in between are coalesced into the latest (a route can be a few dozen searches).
   */
  private previews = new WeakMap<Client, { at: number; next: { line: Partial<TransitLine>; seq: number } | null; timer?: ReturnType<typeof setTimeout> }>();
  private previewLine(c: Client, m: { line: Partial<TransitLine>; seq: number }) {
    let st = this.previews.get(c);
    if (!st) this.previews.set(c, st = { at: 0, next: null });
    st.next = m;
    const run = () => {
      st!.timer = undefined;
      const q = st!.next;
      if (!q || !c.player) return;
      st!.next = null; st!.at = Date.now();
      this.send(c, { t: 'linePreview', preview: this.sim.transit.previewLine(c.player.id, q.line ?? {}, Number(q.seq) || 0) });
    };
    const wait = st.at + PREVIEW_MS - Date.now();
    if (wait <= 0) run();
    else st.timer ??= setTimeout(run, wait);
  }

  private subscribe(c: Client, chunks: [number, number][]) {
    if (!Array.isArray(chunks)) return;
    for (const pair of chunks.slice(0, MAX_SUBS)) {
      const cx = Number(pair[0]) | 0, cy = Number(pair[1]) | 0;
      if (Math.abs(cx) > 1e6 || Math.abs(cy) > 1e6) continue;
      const key = chunkKey(cx, cy);
      if (c.subs.has(key)) continue;
      if (c.subs.size >= MAX_SUBS) break;
      c.subs.add(key);
      const ch = this.w.getChunk(cx, cy)!;
      this.send(c, { t: 'chunk', chunk: {
        cx, cy, tiles: u16ToB64(ch.tiles), parcels: i32ToB64(ch.parcel),
        aux: ch.aux.some((v) => v !== 0) ? u8ToB64(ch.aux) : undefined, sub: ch.sub.some((v) => v !== 0) ? u8ToB64(ch.sub) : undefined,
        under: ch.under.some((v) => v !== 0) ? u8ToB64(ch.under) : undefined,
      } });
      const traffic = this.trafficBytes(cx, cy);
      const kerb = this.kerbBytes(cx, cy);
      if (traffic || kerb) this.send(c, { t: 'traffic', cx, cy, d: u8ToB64(traffic ?? new Uint8Array(0)), ...(kerb ? { k: u8ToB64(kerb) } : {}) });
      this.issuesOnSub(c, key);
      // everyone already moving in this chunk, since later frames only carry changes
      const out: number[] = [];
      for (const a of this.sim.agents()) {
        if (Math.floor(a.x / CHUNK_SIZE) !== cx || Math.floor(a.y / CHUNK_SIZE) !== cy) continue;
        out.push(a.id, Math.round(a.x * 100) / 100, Math.round(a.y * 100) / 100, packCitizenFlags(a.state, a.mode, a.kind, a.cls, a.queued, a.emergency, a.stage, a.bag, a.rev, a.ind) | (a.under ? CITIZEN_UNDER : 0) | (a.extra ?? 0));
      }
      if (out.length) this.send(c, { t: 'citizens', c: out });
    }
  }

  private unlock(c: Client, id: string) {
    const p = c.player!;
    const t = TECH_BY_ID.get(id);
    if (!t) return;
    if (p.tech.includes(id)) return;
    if (t.locked) return this.toast(c, `${t.name}: ${t.locked}`); // unlock rule still to be decided (tech.ts): sandboxes and dev only
    for (const r of t.requires) if (!p.tech.includes(r)) return this.toast(c, `${t.name} needs ${TECH_BY_ID.get(r)?.name ?? r} first`);
    if (p.progress[t.condition.counter] < t.condition.min) return this.toast(c, `${t.name} is not available yet`);
    if (this.w.spendable(p) < t.cost) return this.toast(c, this.w.shortOf(p, t.cost, `to unlock ${t.name}`));
    this.w.credit(p.id, -t.cost, 'tech');
    p.tech.push(id);
    this.w.techVersion++;
    this.w.playersDirty = true;
    this.toast(c, `Unlocked ${t.name}`, 'info');
  }

  /** The recovery plan (sim/finance.ts): raise tax, sell empty land back, mothball or reopen services. */
  private recover(c: Client, action: RecoverAction, keys?: string[]) {
    if (!this.finance) return;
    if (action !== 'tax' && action !== 'sell' && action !== 'mothball' && action !== 'unmothball') return;
    const r = this.finance.recover(c.player!, action, Array.isArray(keys) ? keys.map(String) : undefined);
    this.toast(c, r.msg, r.ok ? 'info' : 'error');
  }

  /** The feature a tool needs, checked against the player's technology; null when allowed. */
  private locked(p: Player, feature: string): string | null {
    if (hasFeature(p.tech, feature)) return null;
    return techFor(feature)?.name ?? feature;
  }

  /** Adverts (sim/adverts.ts, docs/adverts.md): create a campaign, put it up on slots, take posters down. */
  private advert(c: Client, m: Extract<ClientMsg, { t: 'adCampaign' | 'adRent' | 'adEnd' }>) {
    const a = this.adverts, p = c.player!;
    if (!a) return;
    if (m.t === 'adCampaign') {
      const r = a.create(p, m, this.cfg.sandbox);
      if (typeof r === 'string') return this.toast(c, r);
      this.toast(c, `Campaign ready: "${r.text}". Now rent some slots for it`, 'info');
    } else if (m.t === 'adRent') {
      const r = a.rent(p, Number(m.campaign), m.slots, m.near);
      if (typeof r === 'string') return this.toast(c, r);
      this.toast(c, `${r.n === 1 ? 'A poster goes' : `${r.n} posters go`} up: $${r.cost} today, the same each day after`, 'info');
    } else {
      const r = a.end(p, m.slots, m.campaign === undefined ? undefined : Number(m.campaign), m.drop === true);
      if (typeof r === 'string') return this.toast(c, r);
      this.toast(c, m.drop ? 'Campaign ended' : `${r === 1 ? 'A poster' : `${r} posters`} taken down`, 'info');
    }
    this.goals(c);
  }

  /** Whether this player may edit land owned by `owner`: their own, or anyone's in a sandbox (a test city or demo: nobody's work is protected). */
  private mayEdit(p: Player, owner: string) { return owner === p.id || this.cfg.sandbox; }

  private buy(c: Client, x: number, y: number, w: number, h: number) {
    const p = c.player!;
    x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h);
    if (!(w >= 1 && h >= 1 && w <= MAX_PARCEL_EDGE && h <= MAX_PARCEL_EDGE)) return this.toast(c, `Parcels are 1–${MAX_PARCEL_EDGE} tiles per side`);
    const cost = w * h * LAND_PRICE_PER_TILE;
    if (this.w.spendable(p) < cost) return this.toast(c, this.w.shortOf(p, cost, 'for that land'));
    let land = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (this.w.parcelIdAt(xx, yy) !== 0) return this.toast(c, 'That land overlaps an existing parcel');
      if (isBuildable(this.w.getTile(xx, yy))) land++;
    }
    if (land === 0) return this.toast(c, 'That is all water');
    const held = this.cfg.sandbox ? null : this.ranks?.landRefusal(p, { x, y, w, h }); // a frontier's charter grows with rank (ranks.ts)
    if (held) return this.toast(c, held);
    const owned: LandRect[] = [];
    for (const q of this.w.parcels.values()) if (q.owner === p.id) owned.push(q);
    const verdict = this.cfg.sandbox ? { ok: true as const } : checkPurchase({ x, y, w, h }, p.id, { // a sandbox has no border or islanding rules
      owned,
      ownerAt: (tx, ty) => this.w.parcelAt(tx, ty)?.owner ?? null,
      isWater: (tx, ty) => !isBuildable(this.w.getTile(tx, ty)),
      ownerName: (id) => this.w.players.get(id)?.name ?? id,
    });
    if (!verdict.ok) return this.toast(c, verdict.reason);
    const parcel = { id: this.w.nextId++, owner: p.id, name: `${p.name}'s plot`, x, y, w, h, taxRate: DEFAULT_TAX, stats: emptyStats() };
    this.w.parcels.set(parcel.id, parcel);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.w.setParcelId(xx, yy, parcel.id);
    this.w.credit(p.id, -cost, 'land');
    this.w.dirtyParcels.add(parcel.id);
    this.toast(c, `Bought ${w}×${h} tiles for $${cost}`, 'info');
    if (owned.length === 0 && !this.roadNear(x, y, w, h)) this.toast(c, "No road reaches this land yet, and lots grow only beside a road the builders can reach. Extend your land to the nearest road (new land must border yours) and lay a road along it; roads on unclaimed land need Public works", 'info');
  }

  /**
   * A frontier's free charter (seed.ts seedFrontier, docs/first-five.md section 0): the land round the road end goes to
   * the first player to join, free. Later players buy land as anywhere.
   */
  private charter(p: Player) {
    const ch = this.w.charter;
    if (!ch || this.w.parcelIdAt(ch.x, ch.y) !== 0) return;
    const parcel = { id: this.w.nextId++, owner: p.id, name: `${p.name}'s charter`, x: ch.x, y: ch.y, w: ch.w, h: ch.h, taxRate: DEFAULT_TAX, stats: emptyStats() };
    this.w.parcels.set(parcel.id, parcel);
    for (let yy = ch.y; yy < ch.y + ch.h; yy++) for (let xx = ch.x; xx < ch.x + ch.w; xx++) this.w.setParcelId(xx, yy, parcel.id);
    this.w.recountRoads(parcel.id);
    this.w.dirtyParcels.add(parcel.id);
  }

  /** `dev`: the client has ?dev and this is not a production server, so technology locks are skipped (for testing). */
  private build(c: Client, tool: Tool, tiles: [number, number][], dev = false, rot?: number) {
    const p = c.player!;
    if (!Array.isArray(tiles)) return;
    if (DRAFT_TOOLS.has(tool) && !this.cfg.devTools) return this.toast(c, 'That building is still a draft');
    if (tool === 'runway') return this.runway(c, tiles, dev);
    if (tool === 'rail') return this.track(c, tiles, dev);
    if (tool === 'roundabout' || tool === 'flyover') return this.junction(c, tool, tiles, dev);
    let spent = 0, zoned = false;
    const recount = new Set<number>();
    // zoning and parking lots go round roads and buildings instead of paving over them (counted for one toast)
    const paint = tool in TOOL_ZONE || tool === 'park';
    let skipRoad = 0, skipBuilt = 0, sideJoin = 0;
    const zonedAt: [number, number][] = [];
    // the road tool over water lays bridges (shared/src/bridges.ts): runs of water tiles in drag order, after the land
    const wet: [number, number][][] = [];
    let lastWet = false;
    for (const pair of tiles.slice(0, 256)) {
      const x = Math.floor(Number(pair[0])), y = Math.floor(Number(pair[1]));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const t = this.w.getTile(x, y);
      // a harbour's wet tiles (docs/boats.md section 5) are bulldozed like any structure tile: the water stays
      const wetPart = tool === 'bulldoze' && isStructureAux(this.w.auxAt(x, y));
      if (!isBuildable(t) && !wetPart) {
        if (tool === 'road') { if (!lastWet) wet.push([]); wet[wet.length - 1].push([x, y]); lastWet = true; }
        else if (tool === 'bulldoze' && isBridgeAux(this.w.auxAt(x, y))) {
          // a deck tile takes the whole bridge with it, for nothing back
          const q = this.w.parcelAt(x, y);
          if (q && !this.mayEdit(p, q.owner)) { this.toast(c, 'Not your land'); return; }
          const touched = new Set<number>();
          for (let d = -12; d <= 12; d++) for (const [qx, qy] of [[x + d, y], [x, y + d]]) { const q = this.w.parcelIdAt(qx, qy); if (q) touched.add(q); }
          this.w.removeBridge(x, y);
          for (const q of touched) recount.add(q);
        }
        continue;
      }
      lastWet = false;
      const parcel = this.w.parcelAt(x, y);
      const ownsIt = !!parcel && this.mayEdit(p, parcel.owner);
      let cost = 0;
      let apply: () => void;
      const need = dev ? null : this.locked(p, tool);
      if (need && tool !== 'road' && tool !== 'bulldoze') { this.toast(c, `${need} is needed before you can build that`); return; }
      if (tool !== 'bulldoze' && this.w.auxAt(x, y)) {
        if (paint) { skipBuilt++; continue; }
        if (isAirfieldAux(this.w.auxAt(x, y))) { this.toast(c, 'That is part of a runway; bulldoze it first'); return; }
        if (isRailAux(this.w.auxAt(x, y))) {
          if (tool !== 'road') { this.toast(c, 'That is railway track; bulldoze it first'); return; }
          // a road over straight track makes a level crossing (shared/src/rail.ts); checked with the road below
        } else if (isJunctionAux(this.w.auxAt(x, y))) {
          if (tool === 'road' && isRoad(t)) continue;
          this.toast(c, `That is part of a ${isRingAux(this.w.auxAt(x, y)) || isIslandAux(this.w.auxAt(x, y)) ? 'roundabout' : 'flyover'}; bulldoze it first`); return;
        } else {
          const s = this.w.structureAt(x, y);
          if (s) { this.toast(c, `That is part of a ${KIND_NAMES[s.kind]}; bulldoze it first`); return; }
        }
      }
      if (tool in TOOL_CIVIC && isMultiTile(TOOL_CIVIC[tool])) {
        // one structure per click: the clicked tile is its door
        if (zoned = this.placeStructure(c, TOOL_CIVIC[tool], x, y, this.w.spendable(p) - spent, rot)) spent += CIVIC_COST[TOOL_CIVIC[tool]];
        break;
      }
      if (tool === 'road') {
        if (!ownsIt && parcel) { this.toast(c, 'Not your land'); return; }
        if (!parcel) { const pw = this.locked(p, 'publicRoads'); if (pw) { this.toast(c, `${pw} is needed to lay roads outside your own land`); return; } }
        if (isRoad(t)) continue;
        if (joinsBridgeSide(x, y, this.auxFn)) { sideJoin++; continue; }
        const xing = roadOverTrackProblem(this.trackEnv, x, y);
        if (xing) { this.toast(c, xing); return; }
        cost = (parcel ? ROAD_COST : PUBLIC_ROAD_COST) + (isRailAux(this.w.auxAt(x, y)) ? CROSSING_COST : 0);
        apply = () => { this.w.setTile(x, y, packTile(terrainOf(t), true, 0, 0)); this.w.bump(p.id, 'roads', 1); };
      } else if (tool in TOOL_ZONE) {
        if (!ownsIt) { this.toast(c, parcel ? 'Not your land' : 'Buy this land before zoning it'); return; }
        const z = TOOL_ZONE[tool];
        if (isRoad(t)) { skipRoad++; continue; }
        if (this.w.kindIdAt(x, y) === z) continue;
        if (this.occupied(t)) { skipBuilt++; continue; }
        cost = ZONE_COST; zoned = true;
        apply = () => { this.w.setTile(x, y, packTile(terrainOf(t), false, familyOf(z), 0), subFor(z)); zonedAt.push([x, y]); };
      } else if (tool in TOOL_CIVIC) {
        if (!ownsIt) { this.toast(c, parcel ? 'Not your land' : 'Buy this land first'); return; }
        const k = TOOL_CIVIC[tool];
        if (isRoad(t)) { this.toast(c, `A ${KIND_NAMES[k]} goes beside the road, not on it`); return; }
        if (this.w.kindIdAt(x, y) === k) continue;
        if (this.occupied(t)) { this.toast(c, 'Something is built there already; bulldoze it first'); return; }
        if (!this.w.hasRoadAccess(x, y)) { this.toast(c, `A ${KIND_NAMES[k]} needs a road next to it`); return; }
        // a metro entrance lays its platform under the door (sim/metro.ts), along the street it faces
        const platform = isMetroStationKind(k) ? this.metro?.platformFor(k, x, y, rot) ?? 'No underground railways on this server' : null;
        if (typeof platform === 'string') { this.toast(c, platform); return; }
        cost = CIVIC_COST[k]; zoned = true;
        // a player's first builders' yard opens at once: without one their lots wait behind the Commons' own streets
        const starter = familyOf(k) === Zone.Yard && !this.hasYard(p.id);
        apply = () => {
          this.w.setTile(x, y, packTile(terrainOf(t), false, 0, 0));
          const site = this.w.createSite(x, y, k, 1, workOf(k, 1), familyOf(k) === Zone.Yard ? 2 : 1); // a yard is urgent: it brings its own builders; work per kind (size tiers: a police box is quicker than a station)
          if (site && starter) {
            this.w.completeSite(site);
            const { hired: n, camp: fromCamp } = this.sim.start.starterYard(x, y);
            const who = n === 0 ? '' : fromCamp === n ? (n === 1 ? 'your settler takes' : `${n} of your settlers take`) : fromCamp ? `${fromCamp} of your settlers and ${n - fromCamp} neighbour${n - fromCamp === 1 ? '' : 's'} take` : `${n} ${n === 1 ? 'neighbour takes' : 'neighbours take'}`;
            this.toast(c, n ? `Your first builders' yard opens at once: ${who} up tools and set off for your nearest lots now` : 'Your first builders\' yard opens at once; whoever it hires starts work straight away', 'info');
          }
          if (platform) this.metro!.lay(platform);
        };
      } else if (tool === 'busstop') {
        // a shelter beside a plain stretch of road, put up at once like a parking lot (sim/transit.ts)
        if (!ownsIt) { this.toast(c, parcel ? 'Not your land' : 'Buy this land first'); return; }
        if (isRoad(t)) { this.toast(c, 'A bus stop goes beside the road, not on it'); return; }
        if (this.w.kindIdAt(x, y) === BUS_STOP_KIND) continue;
        const why = this.sim.buses.stopProblem(x, y);
        if (why) { this.toast(c, why); return; }
        cost = CIVIC_COST[BUS_STOP_KIND];
        apply = () => this.w.setTile(x, y, packTile(terrainOf(t), false, familyOf(BUS_STOP_KIND), 1), subFor(BUS_STOP_KIND));
      } else if (tool === 'park') {
        if (!ownsIt) { this.toast(c, parcel ? 'Not your land' : 'Buy this land first'); return; }
        if (isRoad(t)) { skipRoad++; continue; }
        if (zoneOf(t) === Zone.Parking) continue;
        if (this.occupied(t)) { skipBuilt++; continue; }
        if (!this.w.hasRoadAccess(x, y)) { this.toast(c, 'A parking lot needs a road next to it'); return; }
        cost = CIVIC_COST[Zone.Parking];
        apply = () => this.w.setTile(x, y, packTile(terrainOf(t), false, Zone.Parking, 1)); // a lot is just paint and paving
      } else if (tool === 'bulldoze') {
        if (parcel && !ownsIt) { this.toast(c, 'Not your land'); return; }
        if (isJunctionAux(this.w.auxAt(x, y))) {
          // a roundabout or flyover goes back to the crossroads it was (shared/src/junctions.ts); bulldoze again for the road
          const touched = new Set<number>();
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const q = this.w.parcelIdAt(x + dx, y + dy); if (q) touched.add(q); }
          apply = () => { this.w.removeJunction(x, y); for (const q of touched) recount.add(q); };
        } else if (isRailAux(this.w.auxAt(x, y))) {
          // railway track is lifted for free; the neighbours' joints to it go too, and lines over it stop (sim/rail.ts)
          apply = () => { if (this.rail) this.rail.removeTrack(x, y); else this.w.setAux(x, y, 0); };
        } else if (isAirfieldAux(this.w.auxAt(x, y))) {
          // a runway or taxiway tile is paint: lifting it is free, and the airport stops until it is repainted
          apply = () => this.w.setAux(x, y, 0);
        } else {
          if (!isRoad(t) && zoneOf(t) === Zone.None) continue;
          cost = levelOf(t) > 0 ? BULLDOZE_COST : 0;
          apply = () => { this.sim.start.campCleared(x, y); this.w.setTile(x, y, packTile(terrainOf(t), false, 0, 0)); }; // a camp's people find beds nearby first (sim/firstfive.ts)
        }
      } else return;
      if (this.w.spendable(p) - spent < cost) { this.toast(c, this.w.shortOf(p, spent ? null : cost)); break; }
      spent += cost;
      const wasRoad = isRoad(t);
      apply();
      if (parcel && wasRoad !== isRoad(this.w.getTile(x, y))) recount.add(parcel.id);
    }
    if (tool in TOOL_ZONE && zonedAt.length) {
      // the landlocked middle of a block zoned all round goes with it, so a building beside it can grow back into it (sim/blocks.ts)
      const z = TOOL_ZONE[tool];
      let inner = 0;
      for (const [x, y] of interiorLots(this.w, zonedAt, z, p.id)) {
        if (this.w.spendable(p) - spent < ZONE_COST) break;
        spent += ZONE_COST; inner++;
        this.w.setTile(x, y, packTile(terrainOf(this.w.getTile(x, y)), false, familyOf(z), 0), subFor(z));
      }
      if (inner) this.toast(c, `Also zoned ${inner} lot${inner === 1 ? '' : 's'} in the middle of the block: the buildings beside ${inner === 1 ? 'it grow back into it' : 'them grow back into them'}`, 'info');
    }
    for (const run of wet) {
      if (this.w.spendable(p) - spent < 0) break;
      const r = this.bridge(c, run, tiles, dev, this.w.spendable(p) - spent);
      if (!r) continue;
      spent += r.cost!;
      for (let i = 0; i < r.tiles!.length; i += 3) { const q = this.w.parcelIdAt(r.tiles![i], r.tiles![i + 1]); if (q) recount.add(q); }
    }
    if (sideJoin) this.toast(c, 'No road may join a bridge from the side: bridges meet roads only at their ends');
    for (const id of recount) this.w.recountRoads(id);
    if (spent) this.w.credit(p.id, -spent, 'build');
    if (skipRoad || skipBuilt) {
      const what = [skipRoad ? `${skipRoad} road tile${skipRoad === 1 ? '' : 's'}` : '', skipBuilt ? `${skipBuilt} building${skipBuilt === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
      this.toast(c, `Left ${what} as they were: bulldoze first to build there`, 'info');
    }
    const noRoad = zonedAt.filter(([x, y]) => !this.w.hasRoadAccess(x, y)).length;
    if (noRoad) this.toast(c, `${noRoad} of the lots you zoned ${noRoad === 1 ? 'has' : 'have'} no road beside ${noRoad === 1 ? 'it' : 'them'}: only a building of the same zone next door can grow back into ${noRoad === 1 ? 'it' : 'them'} until a road is laid`, 'info');
    if (zoned && this.w.tick - c.lastHint > HINT_EVERY && !this.anyYard()) {
      c.lastHint = this.w.tick;
      this.toast(c, "Nothing gets built without builders: place a builders' yard somewhere on the road network", 'info');
    }
  }

  /**
   * A bridge over one run of water tiles from a road drag (`run`, in drag order; `drag` is the whole message, for the
   * way a one-tile run goes). Land as for roads: the player's own, or unclaimed with Public works. Lays the deck and
   * returns the plan (the caller charges and recounts), or null with a toast.
   */
  private bridge(c: Client, run: [number, number][], drag: [number, number][], dev: boolean, budget: number): BridgePlan | null {
    const p = c.player!;
    if (!dev) { const need = this.locked(p, 'bridges'); if (need) { this.toast(c, `${need} is needed to bridge water`); return null; } }
    const [x0, y0] = run[0];
    let dx = 0, dy = 0;
    if (run.length > 1) { dx = run[1][0] - x0; dy = run[1][1] - y0; }
    else {
      // one tile of water: the way the drag went through it, else whichever axis has road on both banks
      const i = drag.findIndex((q) => Math.floor(Number(q[0])) === x0 && Math.floor(Number(q[1])) === y0);
      const nb = drag[i + 1] ?? drag[i - 1];
      if (nb) { dx = Math.abs(Math.floor(Number(nb[0])) - x0); dy = Math.abs(Math.floor(Number(nb[1])) - y0); }
      if (dx + dy !== 1) { const ew = isRoad(this.w.getTile(x0 - 1, y0)) && isRoad(this.w.getTile(x0 + 1, y0)); dx = ew ? 1 : 0; dy = ew ? 0 : 1; }
    }
    for (let i = 1; i < run.length; i++) {
      if (run[i][0] - run[i - 1][0] !== dx || run[i][1] - run[i - 1][1] !== dy) { this.toast(c, 'A bridge runs straight across the water: no bends or junctions on it'); return null; }
    }
    const pub = dev || !this.locked(p, 'publicRoads');
    const plan = planBridge(x0, y0, dx, dy, run.length, {
      tile: (x, y) => this.w.peekTile(x, y),
      aux: this.auxFn,
      land: (x, y) => { const q = this.w.parcelAt(x, y); return q ? (this.mayEdit(p, q.owner) ? null : 'Not your land') : pub ? null : 'Public works is needed to lay roads outside your own land'; },
    });
    if (!plan.ok) { this.toast(c, plan.reason ?? 'A bridge cannot go there'); return null; }
    if (!plan.tiles!.length) return null;
    if (budget < plan.cost!) { this.toast(c, this.w.shortOf(p, plan.cost!, 'for that bridge')); return null; }
    this.w.placeBridge(plan.tiles!);
    this.w.bump(p.id, 'roads', plan.tiles!.length / 3);
    this.toast(c, `${BRIDGE_STYLE_NAMES[plan.style!][0].toUpperCase()}${BRIDGE_STYLE_NAMES[plan.style!].slice(1)} built for $${plan.cost}: ${run.length} tile${run.length === 1 ? '' : 's'} over the water`, 'info');
    return plan;
  }
  private auxFn = (x: number, y: number) => this.w.auxAt(x, y);

  /** Place a multi-tile kind with its door on (x, y); returns whether it was placed (the caller charges). */
  private placeStructure(c: Client, kind: number, x: number, y: number, budget: number, rot?: number): boolean {
    const p = c.player!;
    const draft = isDraftKind(kind);
    const verdict = planStructure(kind, x, y, {
      tile: (tx, ty) => this.w.getTile(tx, ty),
      aux: (tx, ty) => this.w.auxAt(tx, ty),
      sub: (tx, ty) => this.w.subAt(tx, ty),
      land: (tx, ty) => {
        const q = this.w.parcelAt(tx, ty);
        if (q ? this.mayEdit(p, q.owner) : draft && this.cfg.devTools) return null;
        return q ? 'Not your land' : 'Buy this land first';
      },
    }, rot);
    if (!verdict.ok) { this.toast(c, verdict.reason); return false; }
    if (budget < CIVIC_COST[kind]) { this.toast(c, this.w.shortOf(p, CIVIC_COST[kind], `for the ${KIND_NAMES[kind]}`)); return false; }
    const sea = this.harbours?.placeProblem(verdict.placed); // a cargo port on a lake that never reaches the sea
    if (sea) { this.toast(c, sea); return false; }
    // a metro hall lays its platform under the door (sim/metro.ts), along the street its front faces
    const platform = isMetroStationKind(kind) ? this.metro?.platformFor(kind, verdict.placed.doorX, verdict.placed.doorY, verdict.placed.r) ?? 'No underground railways on this server' : null;
    if (typeof platform === 'string') { this.toast(c, platform); return false; }
    // a pioneer camp (docs/first-five.md) opens at once, one per player at a time, and its settlers set out now (sim/firstfive.ts)
    const camp = kind === CAMP_KIND;
    if (camp && this.hasCamp(p.id)) { this.toast(c, 'You already have a pioneer camp: bulldoze it before pitching another'); return false; }
    this.w.placeStructure(verdict.placed, { work: workOf(kind, 1), priority: 1, built: camp }); // build work scales with the tier (CIVIC_WORK for the original kinds)
    if (camp) { const how = this.sim.start.campPitched(verdict.placed.doorX, verdict.placed.doorY); this.toast(c, how === 'gate' ? 'Camp pitched: eight settlers are on their way through the gate and arrive within the hour' : how === 'road' ? 'Camp pitched: eight settlers are coming up the road and arrive within the hour' : 'Camp pitched: eight settlers move in', 'info'); }
    if (platform) this.metro!.lay(platform);
    return true;
  }
  private hasCamp(owner: string) { return this.w.builtOf(Zone.Residential).some((b) => b.id === CAMP_KIND && this.w.parcelAt(b.x, b.y)?.owner === owner); }

  /**
   * Paint a runway from a dragged line (shared/src/airport.ts): six rows (shoulders, runway, taxiway) behind an
   * airport terminal. Repainting tiles that are already right is free, so a gap can be repaired.
   */
  private runway(c: Client, tiles: [number, number][], dev: boolean) {
    const p = c.player!;
    if (!dev) { const need = this.locked(p, 'runway'); if (need) return this.toast(c, `${need} is needed before you can build that`); }
    const line: [number, number][] = [];
    for (const pair of tiles.slice(0, RUNWAY_MAX + 1)) {
      const x = Math.floor(Number(pair?.[0])), y = Math.floor(Number(pair?.[1]));
      if (Number.isFinite(x) && Number.isFinite(y)) line.push([x, y]);
    }
    const plan = planRunway(line, {
      tile: (x, y) => this.w.getTile(x, y),
      aux: (x, y) => this.w.auxAt(x, y),
      sub: (x, y) => this.w.subAt(x, y),
      land: (x, y) => { const q = this.w.parcelAt(x, y); return q ? (this.mayEdit(p, q.owner) ? null : 'Not your land') : 'Buy this land first'; },
    });
    if (!plan.ok) return this.toast(c, plan.reason ?? 'A runway cannot go there');
    if (this.w.spendable(p) < plan.cost!) return this.toast(c, this.w.shortOf(p, plan.cost!, 'for that runway'));
    const tl = plan.tiles!;
    for (let i = 0; i < tl.length; i += 3) {
      const x = tl[i], y = tl[i + 1], t = this.w.getTile(x, y);
      if (zoneOf(t) !== Zone.None) this.w.setTile(x, y, packTile(terrainOf(t), false, 0, 0)); // an empty zoned lot is paved over
      this.w.setAux(x, y, tl[i + 2]);
    }
    if (plan.cost) this.w.credit(p.id, -plan.cost, 'build');
    this.toast(c, plan.fresh ? `Runway laid: ${plan.s1! - plan.s0! + 1} tiles long, $${plan.cost}` : 'That runway is already there', 'info');
  }

  /**
   * A roundabout or flyover on the clicked junction (shared/src/junctions.ts). Land as for roads: the player's own,
   * or unclaimed land with Public works. Clicking a flyover again swaps the road on the deck.
   */
  private junction(c: Client, tool: 'roundabout' | 'flyover', tiles: [number, number][], dev: boolean) {
    const p = c.player!;
    if (!dev) { const need = this.locked(p, tool); if (need) return this.toast(c, `${need} is needed before you can build that`); }
    const x = Math.floor(Number(tiles?.[0]?.[0])), y = Math.floor(Number(tiles?.[0]?.[1]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const pub = dev || !this.locked(p, 'publicRoads');
    const env = {
      tile: (tx: number, ty: number) => this.w.getTile(tx, ty),
      aux: (tx: number, ty: number) => this.w.auxAt(tx, ty),
      land: (tx: number, ty: number) => { const q = this.w.parcelAt(tx, ty); return q ? (this.mayEdit(p, q.owner) ? null : 'Not your land') : pub ? null : 'Buy this land first (or research Public works)'; },
    };
    const plan = tool === 'roundabout' ? planRoundabout(x, y, env) : planFlyover(x, y, env);
    if (!plan.ok) return this.toast(c, plan.reason ?? `A ${tool} cannot go there`);
    if (this.w.spendable(p) < plan.cost!) return this.toast(c, this.w.shortOf(p, plan.cost!, `for that ${tool}`));
    const swap = tool === 'flyover' && isJunctionAux(this.w.auxAt(x, y));
    this.w.placeJunction(plan.tiles!);
    const touched = new Set<number>();
    for (let i = 0; i < plan.tiles!.length; i += 4) { const q = this.w.parcelIdAt(plan.tiles![i], plan.tiles![i + 1]); if (q) touched.add(q); }
    for (const q of touched) this.w.recountRoads(q);
    if (plan.cost) this.w.credit(p.id, -plan.cost);
    this.toast(c, swap ? 'The other road is on the deck now' : tool === 'roundabout' ? `Roundabout built for $${plan.cost}: traffic goes round anticlockwise and gives way to the ring` : `Flyover built for $${plan.cost}: nobody turns here now`, 'info');
  }

  /**
   * The bulldozer in the underground view (docs/underground.md): fill each dragged tunnel tile that no line runs
   * through and that is not under someone else's land (sim/metro.ts fill). Free, and nothing is refunded.
   */
  private fillTunnels(c: Client, tiles: [number, number][]) {
    if (!this.metro || !Array.isArray(tiles)) return;
    let filled = 0, why: string | null = null;
    for (const pair of tiles.slice(0, 256)) {
      const x = Math.floor(Number(pair?.[0])), y = Math.floor(Number(pair?.[1]));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const r = this.metro.fill(c.player!, x, y, this.cfg.sandbox);
      if (r) why ??= r; else filled++;
    }
    if (filled) this.toast(c, `Filled ${filled} tile${filled === 1 ? '' : 's'} of tunnel${why ? ` (not all: ${why.charAt(0).toLowerCase()}${why.slice(1)})` : ''}`, 'info');
    else if (why) this.toast(c, why);
  }

  /** Lay railway track along a dragged path (shared/src/rail.ts planTrack, sim/rail.ts). */
  private track(c: Client, tiles: [number, number][], dev: boolean) {
    const p = c.player!;
    if (!this.rail) return this.toast(c, 'No railways on this server');
    if (!dev) { const need = this.locked(p, 'rail'); if (need) return this.toast(c, `${need} is needed before you can lay track`); }
    const path: [number, number][] = [];
    for (const pair of tiles.slice(0, RAIL_DRAG_MAX + 1)) {
      const x = Math.floor(Number(pair?.[0])), y = Math.floor(Number(pair?.[1]));
      if (Number.isFinite(x) && Number.isFinite(y)) path.push([x, y]);
    }
    const r = this.rail.paint(p, path, this.cfg.sandbox);
    this.toast(c, r.msg, r.ok ? 'info' : 'error');
  }

  /** What the level-crossing rules read (shared/src/rail.ts roadOverTrackProblem). */
  private trackEnv = { tile: (x: number, y: number) => this.w.peekTile(x, y), aux: (x: number, y: number) => this.w.auxAt(x, y) };

  /** Whether a lot holds anything a paint tool must not cover: a building, a site, a parking lot or a bus stop (an empty zoned lot does not count). */
  private occupied(t: number) { return zoneOf(t) !== Zone.None && (levelOf(t) > 0 || underConstruction(t)); }

  /** Whether a road lies inside the rectangle or touches its edge. */
  private roadNear(x: number, y: number, w: number, h: number) {
    for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) {
      const t = this.w.peekTile(xx, yy);
      if (t !== undefined && isRoad(t)) return true;
    }
    return false;
  }

  /**
   * Once a game hour: an owner with WAITING_HINT or more lots that no builder is working on hears why, at most once a
   * game day. With no builders' yard of their own the Commons' yard is the only one, and it works the nearest sites
   * first (its own streets); with a yard of their own and nothing built on their land for a whole day, no road links it.
   */
  private builderHints() {
    const w = this.w;
    const waiting = new Map<string, number>();
    for (const s of w.sites.values()) {
      if (s.assigned > 0 || s.priority <= -2) continue;
      const o = w.parcelAt(s.x, s.y)?.owner;
      if (o) waiting.set(o, (waiting.get(o) ?? 0) + 1);
    }
    for (const c of this.clients) {
      const p = c.player;
      if (!p || p.devUnlimited) continue;
      if (p.progress.built !== c.builtSeen) { c.builtSeen = p.progress.built; c.builtMoved = w.tick; }
      const n = waiting.get(p.id) ?? 0;
      if (n < WAITING_HINT || w.tick - c.builderHint < BUILDER_HINT_EVERY) continue;
      if (!this.hasYard(p.id)) {
        c.builderHint = w.tick;
        this.hint(c, 'builders', `${n} of your lots are waiting for builders. The Commons' builders' yard works the nearest sites first, its own streets: place a builders' yard ($300; your first opens at once) beside one of your roads and your lots go up much faster`);
      } else if (w.tick - c.builtMoved >= TICKS_PER_HOUR * 24) {
        c.builderHint = w.tick;
        this.hint(c, 'buildersRoad', `${n} of your lots are waiting and nobody has built on your land for a day: check that a road links your builders' yard to them`);
      }
    }
  }

  /** Once a game hour: the advisor's server-side hints (goals.ts) for everyone online. */
  private advise() {
    if (!this.onboarding) return;
    this.onboarding.hourly();
    for (const c of this.clients) if (c.player && !c.player.devUnlimited) for (const m of this.onboarding.advise(c.player)) this.send(c, m);
  }

  /** Whether a player has a builders' yard (any family member: yard, depot, construction company), built or being built. */
  private hasYard(owner: string) {
    for (const b of this.w.buildings.values()) if (b.zone === Zone.Yard && this.w.parcelAt(b.x, b.y)?.owner === owner) return true;
    for (const s of this.w.sites.values()) if (familyOf(s.kind) === Zone.Yard && this.w.parcelAt(s.x, s.y)?.owner === owner) return true;
    return false;
  }

  private anyYard() {
    for (const b of this.w.buildings.values()) if (b.zone === Zone.Yard && b.level > 0) return true;
    return false;
  }

  private inspect(c: Client, x: number, y: number, full = false) {
    x = Math.floor(Number(x)); y = Math.floor(Number(y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const t = this.w.peekTile(x, y);
    if (t !== undefined && isRoad(t)) return this.send(c, { t: 'road', x, y, info: this.sim.describeRoad(x, y) });
    const [dx, dy] = this.w.doorOf(x, y); // any tile of a structure answers for the structure
    const b = this.w.buildings.get(`${dx},${dy}`);
    const info = b ? this.sim.describe(b, full) : null;
    if (info && b!.id === Zone.Airport && this.airports) info.airport = this.airports.describe(dx, dy); // the airport kind, not every transport hub
    if (info && isRailStationKind(b!.id) && this.rail) info.rail = this.rail.describeStation(dx, dy);
    if (info && isMetroStationKind(b!.id) && this.metro) info.metro = this.metro.describeStation(dx, dy);
    if (info && isFerryPierKind(b!.id) && this.ferry) info.ferry = this.ferry.describeStation(dx, dy);
    if (info && isHarbourId(b!.id) && this.harbours) info.harbour = this.harbours.describe(b!);
    if (info && this.w.mothballed.has(`${dx},${dy}`)) info.mothballed = true;
    if (info && mothballable(b!) && this.w.parcelAt(dx, dy)?.owner === c.player?.id) info.mothballable = true;
    const fire = info && this.fires?.describe(dx, dy);
    if (info && fire) info.fire = fire;
    const media = info && this.news?.describe(b!);
    if (info && media) info.media = media;
    this.send(c, { t: 'building', x, y, info });
  }

  /** Congestion (roads) and cars parked (lots) for one chunk, or null when there is nothing to show. */
  private trafficBytes(cx: number, cy: number): Uint8Array | null {
    const ch = this.w.getChunk(cx, cy, false);
    if (!ch || !ch.modified) return null;
    const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    let any = false;
    for (let i = 0; i < ch.tiles.length; i++) {
      const t = ch.tiles[i];
      const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      let v = 0;
      if (isRoad(t)) v = Math.round(255 * Math.min(1, this.sim.traffic.congestionAt(x, y)));
      else if (zoneOf(t) === Zone.Parking) v = this.w.parking.get(`${x},${y}`) ?? 0;
      if (v) { out[i] = v; any = true; }
    }
    return any ? out : null;
  }

  /** Cars parked at the kerb of each road tile of a chunk (0-255), or null when there are none. */
  private kerbBytes(cx: number, cy: number): Uint8Array | null {
    const ch = this.w.getChunk(cx, cy, false);
    if (!ch || !ch.modified || !this.w.kerb.size) return null;
    const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    let any = false;
    for (let i = 0; i < ch.tiles.length; i++) {
      if (!isRoad(ch.tiles[i])) continue;
      const n = this.w.kerb.get(tkey(cx * CHUNK_SIZE + (i % CHUNK_SIZE), cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE)));
      if (n) { out[i] = n; any = true; }
    }
    return any ? out : null;
  }

  private siteList(c: Client, id: number) {
    const parcel = this.w.parcels.get(Number(id));
    if (!parcel) return;
    const sites = [];
    for (const s of this.w.sites.values()) {
      if (this.w.parcelIdAt(s.x, s.y) !== parcel.id) continue;
      const lvl = levelOf(this.w.getTile(s.x, s.y));
      sites.push({ x: s.x, y: s.y, kind: s.kind, level: lvl, target: s.target, done: s.total - s.work, total: s.total, builders: s.assigned, priority: s.priority, created: s.created });
    }
    sites.sort((a, b) => b.priority - a.priority || a.created - b.created);
    this.send(c, { t: 'sitelist', id: parcel.id, sites });
  }

  private setPriority(c: Client, x: number, y: number, priority: number) {
    x = Math.floor(Number(x)); y = Math.floor(Number(y));
    [x, y] = this.w.doorOf(x, y);
    const site = this.w.sites.get(`${x},${y}`);
    if (!site) return;
    const parcel = this.w.parcelAt(x, y);
    if (!parcel || !this.mayEdit(c.player!, parcel.owner)) return this.toast(c, 'Not your build');
    this.w.setPriority(site, Number(priority));
    this.siteList(c, parcel.id);
  }

  /** Name, tax rate and colour of a parcel; on an estate member, of the whole estate (docs/world-map.md section 2). */
  private editParcel(c: Client, id: number, taxRate?: number, name?: string, color?: number) {
    const parcel = this.w.parcels.get(Number(id));
    if (!parcel || !this.mayEdit(c.player!, parcel.owner)) return this.toast(c, 'Not your parcel');
    const all = parcel.group !== undefined ? this.w.estateOf(parcel.group) : [parcel];
    for (const p of all) {
      if (typeof taxRate === 'number' && Number.isFinite(taxRate)) p.taxRate = Math.round(Math.min(MAX_TAX, Math.max(0, taxRate)) * 100) / 100;
      if (typeof name === 'string' && name.trim()) p.name = name.trim().slice(0, 24);
      if (typeof color === 'number' && Number.isInteger(color)) { if (color < 0) delete p.color; else p.color = color & 0xffffff; }
      this.w.dirtyParcels.add(p.id);
    }
  }
  /** Combine, split or leave an estate (World.combineParcels etc., rules in shared/src/parcelops.ts). */
  private parcelOp(c: Client, m: Extract<ClientMsg, { t: 'parcelOp' }>) {
    const may = (owner: string) => this.mayEdit(c.player!, owner);
    if (m.op === 'combine') {
      if (!Array.isArray(m.ids)) return;
      const r = this.w.combineParcels(m.ids.slice(0, 256).map(Number), may);
      if (typeof r === 'string') return this.toast(c, r);
      return this.toast(c, r.estate > 1 ? `Combined into an estate of ${r.estate} parcels${r.merged ? ` (${r.merged} merged into one)` : ''}` : 'Combined into one parcel', 'info');
    }
    if (m.op === 'split') {
      if (m.axis !== 'x' && m.axis !== 'y') return;
      const r = this.w.splitParcel(Number(m.id), m.axis, Number(m.at), may);
      if (typeof r === 'string') return this.toast(c, r);
      return this.toast(c, `Split off ${r.name}, ${r.w}×${r.h} tiles`, 'info');
    }
    if (m.op === 'ungroup') {
      const r = this.w.leaveEstate(Number(m.id), may);
      if (r) return this.toast(c, r);
      return this.toast(c, 'Taken out of the estate', 'info');
    }
  }

  // ---- outbound, called after every simulation tick -------------------------

  /** the stats message (every 5 ticks from flush; at once from a local host when it pauses or changes speed) */
  sendStats() {
    const w = this.w;
    this.broadcast({
      t: 'stats', day: w.day, dayFrac: this.sim.dayFrac,
      population: this.sim.population, jobs: this.sim.jobs, employed: this.sim.employed,
      moving: this.sim.moving, driving: this.sim.driving, sites: w.sites.size, outAndAbout: this.sim.outAndAbout, chunks: w.chunks.size,
      vehicles: this.sim.traffic.lastVehicles, queued: this.sim.traffic.lastQueued, speedPct: Math.round(this.sim.traffic.lastSpeedPct * 100), parked: this.sim.parkedCars,
      ...(this.tickStats ? { tickAvg: this.tickStats.avg, tickP95: this.tickStats.p95, tickMax: this.tickStats.max } : {}),
      ...this.migStats(),
      ...(this.rate !== 1 ? { rate: this.rate } : {}),
    });
  }

  flush() {
    const w = this.w;
    // under bytes (tunnels and platforms, docs/underground.md): nothing on the surface reads them, so they only need to beat the tile words
    if (w.dirtyUnder.size) {
      const byChunk = new Map<string, number[]>();
      for (const [x, y] of w.dirtyUnder.values()) {
        const key = chunkKey(chunkOf(x), chunkOf(y));
        let arr = byChunk.get(key);
        if (!arr) { arr = []; byChunk.set(key, arr); }
        arr.push(x, y, w.underAt(x, y));
      }
      w.dirtyUnder.clear();
      for (const c of this.clients) {
        if (!c.player) continue;
        const u: number[] = [];
        for (const [key, arr] of byChunk) if (c.subs.has(key)) for (const v of arr) u.push(v);
        if (u.length) this.send(c, { t: 'under', u });
      }
    }
    // aux bytes first, so a client applying the tile words that follow already knows which tiles are structure parts
    if (w.dirtyAux.size) {
      const byChunk = new Map<string, number[]>();
      for (const [x, y] of w.dirtyAux.values()) {
        this.map.touch(x, y);
        const key = chunkKey(chunkOf(x), chunkOf(y));
        let arr = byChunk.get(key);
        if (!arr) { arr = []; byChunk.set(key, arr); }
        arr.push(x, y, w.auxAt(x, y));
      }
      w.dirtyAux.clear();
      for (const c of this.clients) {
        if (!c.player) continue;
        const u: number[] = [];
        for (const [key, arr] of byChunk) if (c.subs.has(key)) for (const v of arr) u.push(v);
        if (u.length) this.send(c, { t: 'aux', u });
      }
    }
    // then sub bytes (kind ids, docs/sub-kinds.md), so the tile words that follow resolve to the right kind
    if (w.dirtySub.size) {
      const byChunk = new Map<string, number[]>();
      for (const [x, y] of w.dirtySub.values()) {
        this.map.touch(x, y);
        const key = chunkKey(chunkOf(x), chunkOf(y));
        let arr = byChunk.get(key);
        if (!arr) { arr = []; byChunk.set(key, arr); }
        arr.push(x, y, w.subAt(x, y));
      }
      w.dirtySub.clear();
      for (const c of this.clients) {
        if (!c.player) continue;
        const u: number[] = [];
        for (const [key, arr] of byChunk) if (c.subs.has(key)) for (const v of arr) u.push(v);
        if (u.length) this.send(c, { t: 'sub', u });
      }
    }
    if (w.dirtyTiles.size) {
      const byChunk = new Map<string, number[]>();
      for (const [x, y] of w.dirtyTiles.values()) {
        this.map.touch(x, y);
        const key = chunkKey(chunkOf(x), chunkOf(y));
        let arr = byChunk.get(key);
        if (!arr) { arr = []; byChunk.set(key, arr); }
        arr.push(x, y, w.getTile(x, y), w.parcelIdAt(x, y));
      }
      w.dirtyTiles.clear();
      for (const c of this.clients) {
        if (!c.player) continue;
        const u: number[] = [];
        for (const [key, arr] of byChunk) if (c.subs.has(key)) for (const v of arr) u.push(v);
        if (u.length) this.send(c, { t: 'tiles', u });
      }
    }
    if (w.dirtyParcels.size || w.removedParcels.size) {
      const parcels = [...w.dirtyParcels].map((id) => w.parcels.get(id)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => w.parcelDTO(p));
      this.broadcast({ t: 'parcels', parcels, removed: [...w.removedParcels] });
      w.dirtyParcels.clear(); w.removedParcels.clear();
    }
    // the ledgers ride along once a game hour; money and counters whenever they change
    const hour = Math.floor(w.tick / TICKS_PER_HOUR), ledgerDue = hour !== this.ledgerHour;
    if ((w.playersDirty && w.tick % 5 === 0) || ledgerDue) {
      this.broadcast({ t: 'players', players: this.playerDTOs(ledgerDue) });
      w.playersDirty = false;
      if (ledgerDue) { this.ledgerHour = hour; this.builderHints(); this.advise(); }
    }
    // rail lines with their routes (sim/rail.ts), whenever any line's status or route changed
    if (this.rail?.changed) { this.rail.changed = false; this.broadcast({ t: 'railLines', lines: this.rail.dtos() }); }
    // metro lines likewise (sim/metro.ts), and riders per train for the carriage crowds when they change (every 25 ticks at most)
    if (this.metro?.changed) { this.metro.changed = false; this.broadcast({ t: 'metroLines', lines: this.metro.dtos() }); }
    if (this.metro?.loadsChanged) { this.metro.loadsChanged = false; this.broadcast({ t: 'metroLoads', l: this.metro.loads }); }
    // ferry lines likewise (sim/ferry.ts)
    if (this.ferry?.changed) { this.ferry.changed = false; this.broadcast({ t: 'ferryLines', lines: this.ferry.dtos() }); }
    // harbours and their lanes (sim/harbours.ts): a new list whenever any harbour, its staffing or the water changed
    if (this.harbours?.changed) { this.harbours.changed = false; this.broadcast(this.harbours.msg()); }
    // fires burning, being put out and in their aftermath (sim/fires.ts): the whole short list whenever it changed
    if (this.fires?.changed) { this.fires.changed = false; this.broadcast({ t: 'fires', f: this.fires.dtos() }); }
    // campaigns and rented ad slots (sim/adverts.ts): the whole short list whenever it changed, and the renters' notices
    if (this.adverts?.changed) { this.adverts.changed = false; this.broadcast({ t: 'ads', ...this.adverts.dto() }); }
    // the news (sim/news.ts): stories new or changed since the last frame
    if (this.news?.fresh.size) this.broadcast({ t: 'news', s: this.news.drain() });
    if (this.adverts?.notices.length) for (const n of this.adverts.notices.splice(0)) for (const c of this.clients) if (c.player?.id === n.owner) this.toast(c, n.msg, 'info');
    // transit lines (checked every 10 ticks): the whole list when a line changed (routes, stops, colours), otherwise
    // only what changes as the buses run and which line each bus runs, when that changed
    if (w.tick % 10 === 0) {
      const msg = this.linesMsg() as Extract<ServerMsg, { t: 'lines' }>;
      const full = JSON.stringify({ ...msg, lines: msg.lines.map((l) => ({ ...l, status: '', inService: 0, ridersToday: 0, ridersYesterday: 0, faresToday: 0, stopBoardings: [] })), buses: [] });
      const light: ServerMsg = { t: 'lineStats', buses: msg.buses, lines: msg.lines.map((l) => ({ id: l.id, status: l.status, inService: l.inService, ridersToday: l.ridersToday, ridersYesterday: l.ridersYesterday, faresToday: l.faresToday, stopBoardings: l.stopBoardings })) };
      const statsSig = JSON.stringify(light.lines), busSig = msg.buses.join(',');
      // a bus joining or leaving the road (its livery) at once; the counters (riders, fares) at most every 50 ticks
      const statsDue = statsSig !== this.lastStats && w.tick - this.statsAt >= 50, busesDue = busSig !== this.lastBuses;
      let out: string | null = null;
      if (full !== this.lastLines) { out = JSON.stringify(msg); this.lastStats = statsSig; this.lastBuses = busSig; this.statsAt = w.tick; }
      else if (statsDue || busesDue) {
        out = JSON.stringify({ t: 'lineStats', buses: msg.buses, lines: statsDue ? light.lines : [] });
        this.lastBuses = busSig;
        if (statsDue) { this.lastStats = statsSig; this.statsAt = w.tick; }
      }
      this.lastLines = full;
      if (out) for (const c of this.clients) if (c.player && c.conn.open) c.conn.send(out);
    }
    if (w.tick % 5 === 0) this.sendStats();
    // notices from the simulation for one owner's screen (sim/gateways.ts: newcomers with no gateway to come through; that one is an advisor hint)
    // the first settlers on a player's land (sim/firstfive.ts): the camera moment, once per player (goals.ts)
    if (this.sim.start.settlers.length) for (const st of this.sim.start.settlers.splice(0)) for (const c of this.clients) if (c.player?.id === st.owner && this.onboarding) {
      const m = this.onboarding.settlers(c.player, st.x, st.y, st.who);
      if (m) this.send(c, m);
    }
    if (this.sim.notices.length) {
      for (const n of this.sim.notices.splice(0)) for (const c of this.clients) if (c.player?.id === n.owner) {
        if (n.msg.startsWith('Newcomers are moving')) this.hint(c, 'newcomers', n.msg); else this.toast(c, n.msg, 'info');
      }
    }
    // the overdraft and administration (sim/finance.ts): advisor hints and toasts for the owner, at midnight
    if (this.finance?.notices.length) {
      for (const n of this.finance.notices.splice(0)) for (const c of this.clients) if (c.player?.id === n.owner) {
        if (n.hint) this.hint(c, n.hint, n.msg); else this.toast(c, n.msg, 'info');
      }
    }
    // fires (sim/fires.ts): the warning fire is an advisor hint, the rest toasts
    if (this.fires?.notices.length) {
      for (const n of this.fires.notices.splice(0)) for (const c of this.clients) if (c.player?.id === n.owner) {
        if (n.hint) this.hint(c, n.hint, n.msg); else this.toast(c, n.msg, 'info');
      }
    }
    // onboarding goals, measured a few times a game hour
    if (this.onboarding && w.tick % GOALS_EVERY === 0) for (const c of this.clients) { this.goals(c); this.rankTo(c); }
    // congestion, lot occupancy and kerb cars, per chunk that changed
    if (w.tick % TRAFFIC_EVERY === 0 && (this.sim.traffic.dirty.size || w.parking.dirty.size || w.kerb.dirty.size)) {
      const chunks = new Set<string>([...w.parking.dirty, ...w.kerb.dirty]);
      for (const k of this.sim.traffic.dirty) { const [x, y] = untkey(k); chunks.add(chunkKey(chunkOf(x), chunkOf(y))); }
      this.sim.traffic.dirty.clear(); w.parking.dirty.clear(); w.kerb.dirty.clear();
      const payload = new Map<string, { d: string; k?: string }>();
      for (const key of chunks) {
        const [cx, cy] = parseKey(key);
        const bytes = this.trafficBytes(cx, cy), kerb = this.kerbBytes(cx, cy);
        payload.set(key, { d: u8ToB64(bytes ?? new Uint8Array(0)), ...(kerb ? { k: u8ToB64(kerb) } : {}) });
      }
      for (const c of this.clients) {
        if (!c.player) continue;
        for (const [key, p] of payload) if (c.subs.has(key)) { const [cx, cy] = parseKey(key); this.send(c, { t: 'traffic', cx, cy, ...p }); }
      }
    }
    this.flushIssues();
    // citizens and vehicles: only what changed, bucketed by chunk (by a numeric chunk key, so no key strings); a
    // Home-state quad removes an agent. With nobody subscribed to any chunk the buckets are not filled at all: what was
    // last sent is still kept up to date, so the first frame anyone is sent later is the same as it would have been.
    const buckets = new Map<number, number[]>();
    const keep = this.flushes++ % 10; // per flush, not per tick: with several ticks a flush (local mode's 2x/4x) every id still gets its turn
    const seen = this.flushes;
    let anySubs = false;
    for (const c of this.clients) if (c.player && c.subs.size) anySubs = true;
    for (const a of this.sim.agents()) {
      const x = Math.round(a.x * 100) / 100, y = Math.round(a.y * 100) / 100;
      const flags = packCitizenFlags(a.state, a.mode, a.kind, a.cls, a.queued, a.emergency, a.stage, a.bag, a.rev, a.ind) | (a.under ? CITIZEN_UNDER : 0) | (a.extra ?? 0);
      const prev = this.lastSent.get(a.id);
      if (prev) prev[3] = seen;
      if (prev && prev[0] === x && prev[1] === y && prev[2] === flags && a.id % 10 !== keep) continue;
      if (prev) { prev[0] = x; prev[1] = y; prev[2] = flags; } else this.lastSent.set(a.id, [x, y, flags, seen]);
      if (!anySubs) continue;
      const key = agentChunk(a.x, a.y);
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(a.id, x, y, flags);
    }
    for (const [id, prev] of this.lastSent) {
      if (prev[3] === seen) continue;
      this.lastSent.delete(id);
      if (!anySubs) continue;
      const key = agentChunk(prev[0], prev[1]);
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(id, prev[0], prev[1], packCitizenFlags(CitizenState.Home, 0, 0));
    }
    for (const c of this.clients) {
      if (!c.player || c.subs.size === 0) continue;
      const out: number[] = [];
      for (const key of c.subs) {
        const [cx, cy] = parseKey(key);
        const arr = buckets.get(chunkNum(cx, cy));
        if (arr) for (const v of arr) out.push(v);
      }
      if (out.length) this.send(c, { t: 'citizens', c: out });
    }
  }

  /** Net migration through gateways today, for the stats line (sim/gateways.ts); nothing until the town has one. */
  private migStats(): { migIn?: number; migOut?: number; migWaiting?: number } {
    if (!this.sim.gateways.any) return {};
    const t = this.sim.gateways.today();
    return { migIn: t.in, migOut: t.out, migWaiting: t.waiting };
  }

  get connections() { return this.clients.size; }

  // ---- issue bubbles, the problems list and the overlays (sim/issues.ts, overlays.ts, shared/src/issues.ts) ----------

  /** set by game.ts; without it (load tests, older hosts) none of this runs */
  issues: Issues | null = null;
  private overlays: Overlays | null = null;
  private problemsAt = -Infinity; private problemsVer = -1;
  /** overlay bytes worked out this period, shared by every client asking for the same chunk and channel */
  private ovlCache = new Map<string, { d: string; sig: number }>(); private ovlPeriod = -1;

  private issueMsg(key: string) {
    const [cx, cy] = parseKey(key), b = this.issues!.chunkBytes(key);
    return JSON.stringify({ t: 'issues', cx, cy, d: b ? u8ToB64(b) : '' } satisfies ServerMsg);
  }
  /** A chunk just subscribed: its icons, and the overlay when one is on. */
  private issuesOnSub(c: Client, key: string) {
    if (!this.issues) return;
    if (this.issues.chunks.has(key) && c.conn.open) c.conn.send(this.issueMsg(key));
    if (c.ovl) (c.ovlQueue ??= []).push(key);
  }
  /** Your own parcels' problems, when they differ from what you last got. */
  private problemsTo(c: Client, by = this.issues?.byOwner()) {
    if (!c.player || !by) return;
    const p = by.get(c.player.id) ?? [];
    // why each very unhappy home is (sim/issues.ts whyAt), when any is
    let r: number[] | undefined;
    for (let i = 0; i < p.length; i += 3) if (p[i + 2] === Issue.Unhappy) { r ??= new Array(p.length / 3).fill(0); r[i / 3] = this.issues!.whyAt(p[i], p[i + 1]); }
    const sig = r ? `${p.join(',')}|${r.join(',')}` : p.join(',');
    if (sig === c.probSig) return;
    c.probSig = sig;
    this.send(c, r ? { t: 'problems', p, r } : { t: 'problems', p });
  }
  /** The overlay channel a client wants (0 none): every subscribed chunk is looked at again. */
  private setOverlay(c: Client, ch: number) {
    if (!this.issues) return;
    c.ovl = Number.isInteger(ch) && ch > 0 && ch < OVERLAY_COUNT ? ch : 0;
    c.ovlSent = new Map();
    c.ovlQueue = c.ovl ? [...c.subs] : [];
  }
  /** After every tick: changed icon planes, problem lists that changed (at most once per problemsHours), overlay chunks a few at a time. */
  private flushIssues() {
    const w = this.w, is = this.issues;
    if (!is) return;
    if (w.tick % TRAFFIC_EVERY === 0 && is.dirty.size) {
      const out = new Map<string, string>();
      for (const key of is.dirty) out.set(key, this.issueMsg(key));
      is.dirty.clear();
      for (const c of this.clients) if (c.player && c.conn.open) for (const [key, msg] of out) if (c.subs.has(key)) c.conn.send(msg);
    }
    const P = Math.max(1, Math.round(ISSUE_TUNING.problemsHours * TICKS_PER_HOUR));
    if (is.version !== this.problemsVer && w.tick - this.problemsAt >= P) {
      this.problemsVer = is.version; this.problemsAt = w.tick;
      const by = is.byOwner();
      for (const c of this.clients) this.problemsTo(c, by);
    }
    let anyOvl = false;
    for (const c of this.clients) if (c.ovl) { anyOvl = true; break; }
    if (!anyOvl) return;
    const period = Math.floor(w.tick / P);
    if (period !== this.ovlPeriod) {
      this.ovlPeriod = period; this.ovlCache.clear();
      for (const c of this.clients) if (c.ovl) c.ovlQueue = [...c.subs];
    }
    this.overlays ??= new Overlays(w, this.sim, is);
    this.overlays.news = this.news;
    let budget = OVERLAY_CHUNKS_PER_TICK;
    for (const c of this.clients) {
      const q = c.ovlQueue;
      if (!c.ovl || !q || !c.player || !c.conn.open) continue;
      while (q.length && budget > 0) {
        const key = q.shift()!;
        if (!c.subs.has(key)) continue;
        const ck = `${c.ovl}:${key}`;
        let hit = this.ovlCache.get(ck);
        if (!hit) {
          budget--;
          const [cx, cy] = parseKey(key);
          const b = this.overlays.bytes(c.ovl, cx, cy);
          hit = b ? { d: u8ToB64(b), sig: fnv(b) } : { d: '', sig: 0 };
          this.ovlCache.set(ck, hit);
        }
        if (c.ovlSent?.get(key) === hit.sig) continue;
        c.ovlSent?.set(key, hit.sig);
        const [cx, cy] = parseKey(key);
        this.send(c, { t: 'overlay', ch: c.ovl, cx, cy, d: hit.d });
      }
    }
  }
}

/** overlay chunks worked out per tick across all clients (each is a few thousand array writes) */
const OVERLAY_CHUNKS_PER_TICK = 24;
/** FNV-1a over a chunk's bytes: whether a client already has them */
function fnv(b: Uint8Array) { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); } return h >>> 0 || 1; }

// kept for shard routing work later
void isGrowable; void localIndex;
