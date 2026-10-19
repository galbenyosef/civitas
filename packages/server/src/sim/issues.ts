import {
  TICKS_PER_DAY, TICKS_PER_HOUR, CHUNK_SIZE, PARK_RADIUS, ISSUE_TUNING as IT, Issue, Zone, CitizenState as S,
  OCCUPATIONS, capacityOf, parkingOf, venueCapacityOf, isCivicId, isParkingId, isGrowableId, leisureAt, hasFeature, hash2,
  tileKey, chunkKey, chunkOf, localIndex, underConstruction, isRoad, moodReasonOf,
} from '@msimcity/shared';
import type { Building, Citizen, World } from '../world';
import { tkey, untkey } from '../world';
import type { Simulation } from './simulation';

const TPH = TICKS_PER_HOUR, DAY = TICKS_PER_DAY;
/** road tiles counted out from a flagged building's door: a building on the network reads the cap whatever is edited elsewhere */
const REACH_CAP = 300;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** What one building or lot remembers between looks. Everything is recomputed after a restart (nothing is saved). */
interface TileState {
  /** the tick it was first seen standing and open (no customers needs a whole day of it) */
  since: number;
  /** it was already standing when first looked at (a load, or the first round): very unhappy needs no grace */
  old: boolean;
  /** a site: work left at the last look, and builder-time ticks since anyone worked it */
  work: number; idle: number;
  /** unstaffed: the tick staffing first fell short (later than now during a new crew's grace), or -1; staff employed when it was flagged */
  low: number; hired: number;
  /** unstaffed or no customers: road tiles joined to its door (up to REACH_CAP) when it was flagged, or -1; a change means the way there changed */
  roads: number;
  /** full parking: decaying count of drivers sent to the kerb, when it was last decayed, parking in reach at the last look */
  park: number; parkAt: number; parkCap: number;
  /** the code it shows now; for very unhappy, why (shared/src/issues.ts MOOD_REASONS) */
  code: number; why: number;
}

/**
 * Issue bubbles (docs/audit-2026-10.md section 4.4): which buildings and zoned lots are stuck, as a 3-bit code per door
 * tile (shared/src/issues.ts). Every building and lot is looked at once per ISSUE_TUNING.evalHours, a slice each tick
 * picked by a hash of its tile, so the cost is spread over the period; one pass over the citizens at the start of each
 * period gathers what the looks need (residents' happiness per home, staff at work per workplace). Net reads `chunks`
 * for the per-chunk icon plane (message `issues`) and `byOwner()` for each player's problems list (message `problems`).
 * Pure sim layer: no sockets, nothing persisted.
 */
export class Issues {
  /** codes per chunk: chunk key -> local tile index -> code (only flagged tiles) */
  readonly chunks = new Map<string, Map<number, number>>();
  /** chunks whose codes changed since Net last sent them */
  readonly dirty = new Set<string>();
  /** bumped whenever any code changes, so Net can skip rebuilding problem lists */
  version = 0;
  /** a sandbox (test city, demo): the Commons' buildings get icons too */
  sandbox = false;
  /** self-timing for the load test: ms spent in tick() and ticks counted */
  ms = 0; ticks = 0;
  /** a fire burning at a door tile (sim/fires.ts, set by game.ts): on fire outranks every other code */
  burning: ((x: number, y: number) => boolean) | null = null;

  private state = new Map<number, TileState>();
  private slices: Building[][] = [];
  private period: number;
  /** per period, from the census: residents, summed happiness and the unhappiest resident per home, staff at work or on the way per workplace */
  private homes = new Map<number, { n: number; sum: number; low: Citizen }>();
  /** residents' mean happiness per owner (very unhappy is measured against the town), worked out on the period's first need */
  private towns: Map<string, number> | null = null;
  /** the tick a site of each owner's was last seen worked, and the owners with a builders' yard standing (no builders: nobody is building for them) */
  private served = new Map<string, number>();
  private yards = new Set<string>();
  private staff = new Map<number, number>();
  /** builders made progress somewhere during the last period (sites wait out the night without counting) */
  private busy = false;
  private builtSum = -1;
  /** share of a kind's roster at work at each hour of the day, by kind id (lazily filled) */
  private rosterShare = new Map<number, Float32Array>();

  constructor(private w: World, private sim: Simulation) {
    this.period = Math.max(1, Math.round(IT.evalHours * TPH));
  }

  /** One tick's slice. Called once per simulation tick (game.ts). */
  tick() {
    const t0 = performance.now();
    const w = this.w;
    const P = this.period = Math.max(1, Math.round(IT.evalHours * TPH));
    const slot = w.tick % P;
    if (slot === 0 || this.slices.length !== P) this.census(P);
    const list = this.slices[slot];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (w.buildings.get(tileKey(b.x, b.y)) !== b) continue; // gone since the census (the census clears its code)
      this.look(b);
    }
    this.ms += performance.now() - t0; this.ticks++;
  }

  /** A fire started or went out at a door tile (sim/fires.ts): look again now rather than on the round, so the badge follows at once. */
  fireChanged(x: number, y: number) {
    const b = this.w.buildings.get(tileKey(x, y));
    if (b) this.look(b); else { this.state.delete(tkey(x, y)); this.set(x, y, 0); }
  }

  /** The code at a tile (its door for a structure), 0 when none. */
  codeAt(x: number, y: number): number {
    return this.chunks.get(chunkKey(chunkOf(x), chunkOf(y)))?.get(localIndex(x, y)) ?? 0;
  }

  /** A chunk's codes as one byte per tile, or null when it has none. */
  chunkBytes(key: string): Uint8Array | null {
    const m = this.chunks.get(key);
    if (!m || !m.size) return null;
    const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (const [i, c] of m) out[i] = c;
    return out;
  }

  /** Every flagged tile by its parcel's owner, flat triples x, y, code sorted by code then position. */
  byOwner(): Map<string, number[]> {
    const w = this.w, rows = new Map<string, number[][]>();
    for (const [key, m] of this.chunks) {
      const [cx, cy] = key.split(',').map(Number);
      for (const [i, code] of m) {
        const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        const owner = w.parcelAt(x, y)?.owner;
        if (!owner) continue;
        let r = rows.get(owner);
        if (!r) rows.set(owner, r = []);
        r.push([code, x, y]);
      }
    }
    const out = new Map<string, number[]>();
    for (const [owner, r] of rows) {
      r.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
      const flat: number[] = [];
      for (const [code, x, y] of r) flat.push(x, y, code);
      out.set(owner, flat);
    }
    return out;
  }

  /** Why the very unhappy home at a tile is (shared/src/issues.ts MOOD_REASONS), 0 when it is not or nobody knows. */
  whyAt(x: number, y: number): number {
    return this.codeAt(x, y) === Issue.Unhappy ? this.state.get(tkey(x, y))?.why ?? 0 : 0;
  }

  /** Happiness 0-100 of a home's residents at the last census, or -1 with nobody there (the happiness overlay). */
  happinessAt(x: number, y: number): number {
    const h = this.homes.get(tkey(x, y));
    return h && h.n ? h.sum / h.n : -1;
  }

  // ---- the period's census ----------------------------------------------------------------

  /** Once per period: who lives and works where, whether builders were busy, and the next period's slices. */
  private census(P: number) {
    const w = this.w;
    this.homes.clear(); this.staff.clear(); this.towns = null;
    for (const c of w.citizens.values()) {
      const hk = tkey(c.hx, c.hy);
      const h = this.homes.get(hk);
      if (h) { h.n++; h.sum += c.happy; if (c.happy < h.low.happy) h.low = c; } else this.homes.set(hk, { n: 1, sum: c.happy, low: c });
      if (!c.job) continue;
      const st = c.state;
      if (st === S.Work || st === S.AtSite || st === S.ToSite || st === S.ToWork || (st === S.ToVenue && c.venueThen === S.ToWork)) {
        const wk = tkey(c.wx, c.wy);
        this.staff.set(wk, (this.staff.get(wk) ?? 0) + 1);
      }
    }
    let built = 0;
    for (const p of w.players.values()) built += p.progress.built;
    this.busy = this.builtSum >= 0 && built > this.builtSum;
    this.builtSum = built;
    // a period nobody built anywhere (builders rest at night) does not count against an owner, as it does not for a site's idle
    if (!this.busy) for (const [o, t] of this.served) this.served.set(o, t + P);
    // slices for the coming period, by a hash of the tile so a building keeps its slot from period to period
    if (this.slices.length !== P) this.slices = Array.from({ length: P }, () => []);
    for (const s of this.slices) s.length = 0;
    this.yards.clear();
    for (const b of w.buildings.values()) {
      this.slices[Math.floor(hash2(b.x * 7 + 3, b.y * 11 + 5) * P) % P].push(b);
      if (b.zone === Zone.Yard && b.level > 0) { const o = w.parcelAt(b.x, b.y)?.owner; if (o) this.yards.add(o); }
    }
    // tiles whose building went (bulldozed, merged away): clear their code and memory
    for (const [k] of this.state) {
      const [x, y] = untkey(k);
      if (!w.buildings.has(tileKey(x, y))) { this.state.delete(k); this.set(x, y, 0); }
    }
  }

  // ---- one building's look ----------------------------------------------------------------

  private look(b: Building) {
    const w = this.w, now = w.tick, k = tkey(b.x, b.y), key = tileKey(b.x, b.y);
    let st = this.state.get(k);
    if (!st) this.state.set(k, st = { since: -1, old: b.level > 0, work: Infinity, idle: 0, low: -1, hired: 0, roads: -1, park: 0, parkAt: now, parkCap: -1, code: 0, why: 0 });
    const site = w.sites.get(key);
    const uc = !!site || underConstruction(w.getTile(b.x, b.y));
    const standing = b.level > 0; // an upgrade being built still stands and works at its level
    if (!standing) { st.since = -1; st.old = false; } else if (st.since < 0) st.since = now;
    let code = 0;
    // 1 no road: a building or site with no road at its door, or an empty lot that no road and no frontage neighbour reaches
    if (!w.hasRoadAccess(b.x, b.y) && !this.blockOnly(b) && (b.level > 0 || uc || !this.frontageNear(b))) code = Issue.NoRoad;
    // any site worked since its last look (an upgrade too) means builders are at work for its owner
    if (site && site.work < st.work && st.work !== Infinity) { const o = w.parcelAt(b.x, b.y)?.owner; if (o) this.served.set(o, now); }
    // 2 no builders: nobody worked the site of a new building for an hour of builder time (a waiting upgrade is not stuck), and
    // nobody worked any of its owner's sites in that hour either, and they have no builders' yard of their own; a site queued
    // behind its owner's own crew (or sent elsewhere by it) only after two days
    if (site && b.level === 0) {
      if (site.assigned > 0 || site.work < st.work || site.priority <= -2) st.idle = 0;
      else if (this.busy) st.idle += this.period;
      st.work = site.work;
      if (!code && st.idle >= IT.noBuildersHours * TPH && site.priority > -2) {
        const o = w.parcelAt(b.x, b.y)?.owner ?? '', served = this.served.get(o) ?? -Infinity;
        if ((now - served >= IT.noBuildersHours * TPH && !this.yards.has(o)) || st.idle >= IT.noBuildersStuckHours * TPH) code = Issue.NoBuilders;
      }
    } else { st.idle = 0; st.work = site ? site.work : Infinity; }
    if (standing) {
      // precedence: what stops it working first (nobody comes at all says more than where they park)
      if (!code && this.unstaffed(b, st, now)) code = Issue.Unstaffed;
      const full = this.parkingFull(b, st, key, now); // always: it drains and decays the count
      if (!code && this.noCustomers(b, st, key, now)) code = Issue.NoCustomers;
      if (!code && full) code = Issue.ParkingFull;
      if (!code && b.zone === Zone.Residential && this.unhappy(b, k, st, now)) code = Issue.Unhappy;
    } else st.low = -1;
    st.why = code === Issue.Unhappy ? this.why(k) : 0;
    st.code = code;
    if (this.burning?.(b.x, b.y)) code = Issue.Fire; // not kept in st.code: the other conditions' memory carries on under it
    if (!IT.commons && !this.sandbox && code && w.parcelAt(b.x, b.y)?.owner === 'sys') code = 0;
    this.set(b.x, b.y, code);
  }

  private set(x: number, y: number, code: number) {
    const key = chunkKey(chunkOf(x), chunkOf(y)), i = localIndex(x, y);
    let m = this.chunks.get(key);
    const prev = m?.get(i) ?? 0;
    if (prev === code) return;
    if (code) { if (!m) this.chunks.set(key, m = new Map()); m.set(i, code); }
    else { m!.delete(i); if (!m!.size) this.chunks.delete(key); }
    this.dirty.add(key);
    this.version++;
  }

  /** a block's communal garden has no road by design (sim/blocks.ts) */
  private blockOnly(b: Building) { return !!leisureAt(b.id, b.level, b.x, b.y)?.blockOnly; }

  /** An empty zoned lot beside a lot of the same zone and owner that has a road: that building grows back into it (sim/blocks.ts). */
  private frontageNear(b: Building) {
    if (!isGrowableId(b.id)) return false;
    const w = this.w, owner = w.parcelAt(b.x, b.y)?.owner;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = b.x + dx, y = b.y + dy;
      const n = w.buildings.get(tileKey(...w.doorOf(x, y)));
      if (!n || n.zone !== b.zone || w.parcelAt(x, y)?.owner !== owner) continue;
      if (w.hasRoadAccess(n.x, n.y)) return true;
    }
    return false;
  }

  /** Civic and service buildings and staffed venues with staff at work or on the way under half what the roster expects, for an hour. */
  private unstaffed(b: Building, st: TileState, now: number): boolean {
    if (isParkingId(b.id)) return false;
    const sp = leisureAt(b.id, b.level, b.x, b.y);
    if (!isCivicId(b.id) && !sp?.staffed) return false;
    const cap = capacityOf(b.id, b.level);
    if (cap <= 0) return false;
    const flagged = st.code === Issue.Unstaffed;
    // what fixes it is hiring or a way there: new hires filling the share, or the road joined to its door changed; then the crew
    // gets a grace to turn up for a shift before it can show again
    if (flagged) {
      st.hired = Math.min(st.hired, b.occupants);
      if ((b.occupants > st.hired && b.occupants >= IT.unstaffedShare * cap) || this.roadsChanged(b, st)) { st.low = now + IT.unstaffedGraceHours * TPH; st.roads = -1; return false; }
    }
    const expected = cap * this.share(b.id, (now % DAY) / TPH);
    if (expected < IT.unstaffedMinExpected) return flagged; // closed hours: keep what it was
    const present = this.staff.get(tkey(b.x, b.y)) ?? 0;
    if (present >= IT.unstaffedShare * expected) { st.low = -1; return false; }
    if (st.low < 0) st.low = now;
    if (now - st.low < IT.unstaffedHours * TPH) return false;
    if (!flagged) { st.hired = b.occupants; st.roads = this.roadsNear(b); }
    return true;
  }

  /**
   * Road tiles joined to a building's door, counted out to REACH_CAP (only for flagged buildings, a few hundred tile reads):
   * cut off, it is the size of its scrap of road; joined up, the cap. A change means the way there changed.
   */
  private roadsNear(b: Building) {
    const w = this.w, seen = new Set<number>(), queue: number[] = [];
    const push = (x: number, y: number) => {
      const k = tkey(x, y), t = w.peekTile(x, y);
      if (seen.has(k) || t === undefined || !isRoad(t)) return;
      seen.add(k); queue.push(x, y);
    };
    for (const [dx, dy] of DIRS4) push(b.x + dx, b.y + dy);
    for (let i = 0; i < queue.length && seen.size < REACH_CAP; i += 2) for (const [dx, dy] of DIRS4) push(queue[i] + dx, queue[i + 1] + dy);
    return Math.min(seen.size, REACH_CAP);
  }
  private roadsChanged(b: Building, st: TileState) { return st.roads >= 0 && this.roadsNear(b) !== st.roads; }

  /** Share of a kind's staff the roster has at work at hour h (shifts by weight, times the days worked in a cycle). */
  private share(kind: number, h: number): number {
    let row = this.rosterShare.get(kind);
    if (!row) {
      row = new Float32Array(24);
      const o = OCCUPATIONS[kind];
      if (o?.shifts.length) {
        const total = o.shifts.reduce((s, x) => s + x.weight, 0) || 1;
        const days = o.cycles.length ? o.cycles.reduce((s, c) => s + c.reduce((a, v) => a + v, 0) / Math.max(1, c.length), 0) / o.cycles.length : 1;
        for (let hr = 0; hr < 24; hr++) {
          let on = 0;
          for (const sh of o.shifts) if ((((hr + 0.5 - sh.start) % 24) + 24) % 24 < sh.hours) on += sh.weight;
          row[hr] = (on / total) * days;
        }
      }
      this.rosterShare.set(kind, row);
    }
    return row[Math.floor(h) % 24];
  }

  /** Drivers this building turned away who found no lot in reach (Simulation.kerbOut), as a count decaying by half every parkingHalfLifeHours. */
  private parkingFull(b: Building, st: TileState, key: string, now: number): boolean {
    const w = this.w, out = this.sim.kerbOut;
    const n = out.get(key) ?? 0;
    if (!n && st.park === 0) { st.parkAt = now; return false; } // the common case: nobody sent to the kerb
    if (n) out.delete(key);
    st.park = st.park * Math.pow(0.5, (now - st.parkAt) / (IT.parkingHalfLifeHours * TPH)) + n;
    st.parkAt = now;
    if (st.park < 0.05) { st.park = 0; st.parkCap = -1; return false; }
    // parking in reach grew (a lot laid, Deep foundations): the drivers have somewhere to go now
    let cap = parkingOf(b.id, b.level, w.ownerHas(b.x, b.y, 'underground', hasFeature));
    w.eachBuiltNear(b.x, b.y, [Zone.Parking], PARK_RADIUS, (lot) => { cap += parkingOf(lot.id, lot.level, false); });
    if (st.parkCap >= 0 && cap > st.parkCap) st.park = 0;
    st.parkCap = cap;
    return st.code === Issue.ParkingFull ? st.park >= IT.parkingClearAt : st.park >= IT.parkingFullAt;
  }

  /** A shop (any commercial building with room for visitors) or a staffed venue, standing all of yesterday, with nobody yesterday or yet today. */
  private noCustomers(b: Building, st: TileState, key: string, now: number): boolean {
    const sp = leisureAt(b.id, b.level, b.x, b.y);
    const shop = b.zone === Zone.Commercial && venueCapacityOf(b.id, b.level) > 0;
    if (!shop && !(sp && sp.staffed && !sp.blockOnly)) return false;
    const flagged = st.code === Issue.NoCustomers;
    // the road joined to its door changed since it was flagged: the player worked on the way there; give it a fresh day
    if (flagged && this.roadsChanged(b, st)) { st.since = now; st.roads = -1; return false; }
    const yesterday = Math.floor(now / DAY) * DAY - IT.noCustomersDays * DAY;
    if (st.since < 0 || st.since > yesterday) return false;
    const v = this.sim.visitsOf(key);
    const none = v.today === 0 && v.yesterday === 0;
    if (none && !flagged) st.roads = this.roadsNear(b);
    return none;
  }

  /**
   * Residents' mean happiness under unhappyBelow in a home standing unhappyGraceHours, and unhappyMargin under its owner's
   * town (or the whole town under unhappyTownBelow), until it is back over unhappyClear. A new town's newcomers all start
   * broke, jobless and friendless; only the homes doing worse than the rest of it say something the player can act on.
   */
  private unhappy(b: Building, k: number, st: TileState, now: number): boolean {
    const h = this.homes.get(k);
    if (!h || !h.n) return false;
    const mean = h.sum / h.n;
    if (st.code === Issue.Unhappy) return mean <= IT.unhappyClear;
    if (mean >= IT.unhappyBelow || (!st.old && now - st.since < IT.unhappyGraceHours * TPH)) return false;
    const town = this.townMood(this.w.parcelAt(b.x, b.y)?.owner ?? '');
    return town < IT.unhappyTownBelow || mean <= town - IT.unhappyMargin;
  }

  /** Residents' mean happiness on an owner's land at this period's census (every home's owner, worked out once a period when first asked). */
  private townMood(owner: string): number {
    if (!this.towns) {
      const sums = new Map<string, { n: number; sum: number }>();
      for (const [k, h] of this.homes) {
        const [x, y] = untkey(k), o = this.w.parcelAt(x, y)?.owner;
        if (!o) continue;
        const t = sums.get(o);
        if (t) { t.n += h.n; t.sum += h.sum; } else sums.set(o, { n: h.n, sum: h.sum });
      }
      this.towns = new Map([...sums].map(([o, t]) => [o, t.sum / t.n]));
    }
    return this.towns.get(owner) ?? 50;
  }

  /** Why a home is very unhappy: its unhappiest resident's largest complaint the player can act on (MOOD_REASONS), 0 if none. */
  private why(k: number): number {
    const c = this.homes.get(k)?.low;
    if (!c || !this.w.citizens.has(c.id)) return 0;
    for (const p of this.sim.moodParts(c)) if (p.delta < 0) { const r = moodReasonOf(p.label); if (r) return r; }
    return 0;
  }
}
