import { Rings, TICKS_PER_HOUR, WORLD_KEYS, PLAYER_KEYS, type RingsDTO } from '@msimcity/shared';
import type { World } from './world';
import type { Simulation } from './sim/simulation';

/**
 * City history (docs/charts.md): once a game hour the key figures of the city, and of each player's treasury and
 * holdings, go into fixed-size rings (shared/src/history.ts) that are saved with the world and sent to a client when
 * its charts panel opens. Pure (no Node APIs), so a local-mode worker keeps it too. Sampling reads counters the
 * simulation already keeps; nothing is allocated per tick.
 */

/** per player: the rings and what is needed to turn the ledger's day totals into hourly flows */
interface PlayerHist {
  rings: Rings;
  /** day and today's income / spending as of the last sample (the ledger resets at midnight) */
  day: number; lastIn: number; lastOut: number;
  /** the flows of the last 24 hours, a ring indexed by hour % 24 */
  inH: number[]; outH: number[];
}
export interface HistoryJSON {
  v: 1; hour: number;
  world: RingsDTO;
  players: Record<string, { rings: RingsDTO; day: number; lastIn: number; lastOut: number; inH: number[]; outH: number[] }>;
  /** counters the world flows are measured against */
  prev?: { migIn: number; migOut: number; boarded: number };
}

const zeros = () => new Array<number>(24).fill(0);
const sum = (a: number[]) => { let s = 0; for (const v of a) s += v; return s; };
/** positive and negative parts of a ledger row */
function split(r: Partial<Record<string, number>> | undefined): [number, number] {
  let i = 0, o = 0;
  if (r) for (const k in r) { const v = r[k]!; if (v > 0) i += v; else o -= v; }
  return [i, o];
}

export class History {
  readonly world = new Rings(WORLD_KEYS);
  private players = new Map<string, PlayerHist>();
  /** game hour of the newest sample; -1 before the first */
  hour = -1;
  /** the newest sample, as sent in a 'histSample' message */
  readonly lastWorld = new Float64Array(WORLD_KEYS.length);
  private lastPlayer = new Map<string, Float64Array>();
  private prev = { migIn: 0, migOut: 0, boarded: -1 };

  private playerHist(id: string): PlayerHist {
    let p = this.players.get(id);
    if (!p) { p = { rings: new Rings(PLAYER_KEYS), day: -1, lastIn: 0, lastOut: 0, inH: zeros(), outH: zeros() }; this.players.set(id, p); }
    return p;
  }
  /** drop a player's series (a spectator's, net.ts, when they leave: nothing of theirs is kept) */
  forget(id: string) { this.players.delete(id); this.lastPlayer.delete(id); }
  playerRings(id: string): Rings | null { return this.players.get(id)?.rings ?? null; }
  /** the newest hourly values for a player (an empty list before they have a sample) */
  playerSample(id: string): ArrayLike<number> { return this.lastPlayer.get(id) ?? new Float64Array(PLAYER_KEYS.length); }

  /**
   * Take the sample if a new game hour has begun. Returns true when it did (the caller pushes it to open charts panels).
   * `tickAvg` / `tickP95`: server tick time over the last minute (ms), 0 when not measured.
   */
  sample(w: World, sim: Simulation, tickAvg = 0, tickP95 = 0): boolean {
    const hour = Math.floor(w.tick / TICKS_PER_HOUR);
    if (hour <= this.hour) return false;
    this.hour = hour;
    const v = this.lastWorld;
    const mig = sim.gateways.today(), boarded = sim.transit.stats.boarded;
    const vehicles = sim.traffic.lastVehicles;
    v[0] = sim.population; v[1] = sim.employed; v[2] = sim.vacantJobs;
    v[3] = w.buildings.size; v[4] = w.sites.size;
    // newcomers and leavers are per-day counters at the gates; a smaller figure means the day rolled over
    v[5] = mig.in >= this.prev.migIn ? mig.in - this.prev.migIn : mig.in;
    v[6] = mig.out >= this.prev.migOut ? mig.out - this.prev.migOut : mig.out;
    this.prev.migIn = mig.in; this.prev.migOut = mig.out;
    v[7] = sim.moving; v[8] = vehicles;
    v[9] = Math.round(sim.traffic.lastSpeedPct * 100);
    v[10] = vehicles ? Math.round((100 * sim.traffic.lastQueued) / vehicles) : 0;
    v[11] = sim.parkedCars;
    v[12] = this.prev.boarded >= 0 && boarded >= this.prev.boarded ? boarded - this.prev.boarded : 0;
    this.prev.boarded = boarded;
    v[13] = tickAvg; v[14] = tickP95;
    this.world.push(hour, v);
    this.samplePlayers(w, hour);
    return true;
  }

  private samplePlayers(w: World, hour: number) {
    const housed = new Map<string, number>(), jobs = new Map<string, number>(), staffed = new Map<string, number>();
    for (const p of w.parcels.values()) {
      housed.set(p.owner, (housed.get(p.owner) ?? 0) + p.stats.population);
      jobs.set(p.owner, (jobs.get(p.owner) ?? 0) + p.stats.jobs);
      staffed.set(p.owner, (staffed.get(p.owner) ?? 0) + p.stats.employed);
    }
    const day = w.day;
    for (const pl of w.players.values()) {
      const h = this.playerHist(pl.id);
      // today's totals and, if the ledger has not rolled over yet, yesterday's are the old "today"
      const L = pl.ledger;
      const [inT, outT] = L && L.day === day ? split(L.today) : [0, 0];
      const [inY, outY] = L && L.day === day ? split(L.yesterday) : L && L.day === day - 1 ? split(L.today) : [0, 0];
      let dIn: number, dOut: number;
      if (h.day === day) { dIn = inT - h.lastIn; dOut = outT - h.lastOut; }
      else if (h.day === day - 1) { dIn = inY - h.lastIn + inT; dOut = outY - h.lastOut + outT; }
      else { dIn = inT; dOut = outT; }
      h.day = day; h.lastIn = inT; h.lastOut = outT;
      h.inH[hour % 24] = Math.max(0, dIn); h.outH[hour % 24] = Math.max(0, dOut);
      let v = this.lastPlayer.get(pl.id);
      if (!v) { v = new Float64Array(PLAYER_KEYS.length); this.lastPlayer.set(pl.id, v); }
      v[0] = pl.money; v[1] = sum(h.inH); v[2] = sum(h.outH);
      v[3] = housed.get(pl.id) ?? 0; v[4] = jobs.get(pl.id) ?? 0; v[5] = staffed.get(pl.id) ?? 0;
      h.rings.push(hour, v);
    }
  }

  /** a player's rings for the wire, created empty if they have none yet (so an economy tab opens at once) */
  playerDTO(id: string): RingsDTO { return this.playerHist(id).rings.toDTO(); }

  toJSON(): HistoryJSON {
    const players: HistoryJSON['players'] = {};
    for (const [id, p] of this.players) players[id] = { rings: p.rings.toDTO(), day: p.day, lastIn: p.lastIn, lastOut: p.lastOut, inH: p.inH, outH: p.outH };
    return { v: 1, hour: this.hour, world: this.world.toDTO(), players, prev: { ...this.prev } };
  }

  /** Restore saved history (old saves have none; bad data leaves it empty). */
  load(j: HistoryJSON | undefined | null) {
    if (!j || j.v !== 1) return;
    try {
      const rings = Rings.fromDTO(WORLD_KEYS, j.world);
      for (let i = 0; i < rings.tiers.length; i++) { const t = this.world.tiers[i], s = rings.tiers[i]; t.data.set(s.data); t.last = s.last; t.period = s.period; t.cnt = s.cnt; t.sum.set(s.sum); }
      this.world.hour = rings.hour;
      this.hour = Number.isInteger(j.hour) ? j.hour : rings.hour;
      if (j.prev) this.prev = { migIn: +j.prev.migIn || 0, migOut: +j.prev.migOut || 0, boarded: -1 }; // the boarding counter restarts with the process
      const nums = (a: unknown) => Array.isArray(a) && a.length === 24 ? a.map((x) => +x || 0) : zeros();
      for (const [id, p] of Object.entries(j.players ?? {})) {
        this.players.set(id, { rings: Rings.fromDTO(PLAYER_KEYS, p.rings), day: Number.isInteger(p.day) ? p.day : -1, lastIn: +p.lastIn || 0, lastOut: +p.lastOut || 0, inH: nums(p.inH), outH: nums(p.outH) });
      }
    } catch (e) { console.error('history: could not restore', e); }
  }
}

/** One History per World, kept off the World class itself (snapshot.ts and game.ts reach it through here). */
const registry = new WeakMap<World, History>();
export function historyOf(w: World): History {
  let h = registry.get(w);
  if (!h) { h = new History(); registry.set(w, h); }
  return h;
}
