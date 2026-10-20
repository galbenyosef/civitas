import {
  RANKS, TOP_RANK, NEED_HOW, TICKS_PER_DAY, GOAL_BY_ID, TECH_BY_ID, Zone, CAMP_KIND, MAX_PARCEL_EDGE, DEFAULT_TAX, isLeisure, charterRing, rankNeeds, rankRewardText,
  type Milestone, type RankDTO, type RankNeedId, type RankUp, type ServerMsg,
} from '@msimcity/shared';
import { emptyStats, type World, type Player } from './world';
import { running } from './goals';

/**
 * A player's settlement rank (shared/src/ranks.ts, docs/ranks.md), saved with the player. Absent in older saves: the
 * first look derives it from the town as it stands (no grant for ranks already reached), so a save from before ranks
 * loads at the rank it has earned.
 */
export interface RankState {
  rank: number;
  /** the tick each rank was reached (the first entry: when the record began) */
  at: number[];
  /** the milestone feed, newest first */
  feed: Milestone[];
  /** milestone keys already in the feed (or already true when the record began) */
  seen: string[];
  /** finished days in a row with taxes and fees covering wages and upkeep, and the ledger day last looked at */
  black?: number; blackDay?: number;
  /** a frontier's charter holder: the rank whose ring of land the charter has been given */
  ring?: number;
  /** the most residents yet and the tick it was reached: growth that pauses gets a nudge in the feed */
  peak?: number; peakAt?: number;
}

/**
 * A rank reached or a milestone passed, for the news (sim/news.ts, docs/media.md): which player, where (the rank-up's
 * celebration spot, or the middle of their buildings), the feed's words and, for a rank, which one and its grant.
 */
export interface RankStoryEvent { kind: 'rank' | 'milestone'; player: string; at: [number, number]; text: string; rank?: number; grant?: number }
/** The milestone kinds that make news: residents and jobs marks, firsts and research (not needs, goals, money or land). */
const NEWS_KINDS = new Set<Milestone['kind']>(['people', 'jobs', 'first', 'tech']);

/** Residents not rising for this long (half a game day, four real minutes at 1×) is a pause worth a word; at most this many words a pause. */
const STALL_TICKS = TICKS_PER_DAY / 2, STALL_WORDS = 3;

/** Milestones kept per player, and sent. */
const FEED_KEEP = 40, FEED_SEND = 12;
/** Marks the feed notes as they are passed: residents, jobs filled on your land, building work done, a day's taxes. */
/** 10, 25, 50, 75, 100, then every `a` to `to`, every `b` after that to `end` */
const steps = (first: number[], a: number, to: number, b: number, end: number) => {
  const out = [...first];
  for (let n = first[first.length - 1] + a; n <= to; n += a) out.push(n);
  for (let n = to + b; n <= end; n += b) out.push(n);
  return out;
};
// fine enough that a town still growing passes one every few minutes (docs/ranks.md: no stretch over six without news)
const POP_STEPS = steps([10, 25, 50, 75, 100], 25, 1000, 50, 1500).concat([1750, 2000, 2500, 3000, 4000, 5000]);
const JOB_STEPS = steps([5, 10, 20, 30, 40, 50], 25, 1000, 50, 1200).concat([1500, 2000]);
const BUILT_STEPS = steps([500, 1000], 1000, 10000, 2500, 50000).concat([60000, 75000, 100000]);
const TAX_STEPS = [25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];

/** What the needs and the feed's firsts read on a player's own land. */
interface Tally {
  homes: number; shops: number; works: number; offices: number; level2: number; level3: number; police: number; fire: number;
  leisure: number; yards: number; cx: number; cy: number; n: number;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-GB')}`;

/**
 * Settlement ranks and the milestone feed. Net calls `check` with the goals (a few times a game hour, for each online
 * player) and sends the `rank` message when anything changed; a rank reached pays its grant through the ledger ('other')
 * and, for a frontier's charter holder, grows the charter (`grantRing`). `landRefusal` keeps a frontier's land for its
 * charter: the holder may buy beyond the charter only from the rank that opens it, and nobody else inside the City ring.
 */
export class Ranks {
  /** this tick's measurement per player, so every tab a player has open gets the same rank-up and milestones */
  private last = new Map<string, { tick: number; r: { msg: ServerMsg & { t: 'rank' }; sig: string } }>();
  /** fired for each rank reached and each milestone of NEWS_KINDS (game.ts points it at News.rank) */
  onStory: ((e: RankStoryEvent) => void) | null = null;

  constructor(private w: World) {}

  /** The player's ranks, derived from their town on first use (an older save, or a new player: Camp). */
  state(p: Player): RankState {
    if (p.ranks) return p.ranks;
    const t = this.tally(p);
    const ledger = this.w.ledgerDTO(p).yesterday;
    const blackNow = (ledger.tax ?? 0) > 0 && running(ledger) >= 0 ? 1 : 0;
    let rank = 0;
    while (rank < TOP_RANK && this.met(rank + 1, this.measure(rank + 1, p, t, 99))) rank++; // the books are taken as balanced: a streak cannot be read back
    const s: RankState = { rank, at: [this.w.tick], feed: [], seen: [], black: blackNow, blackDay: this.w.ledgerDTO(p).day };
    for (let r = 1; r <= rank; r++) s.at.push(this.w.tick);
    p.ranks = s;
    // whatever is already true is history, not news
    for (const m of this.milestones(p, s, t)) s.seen.push(m.key);
    if (rank > 0) s.feed.unshift({ tick: this.w.tick, kind: 'rank', text: `${RANKS[rank].name}: the record begins` });
    if (this.holder() === p.id) this.grantRing(p, s, rank);
    return s;
  }

  /** Something that happened to the player's town (an explosion, sim/fires.ts) as a line of the feed: news once, no key. */
  incident(p: Player, text: string) {
    const s = this.state(p);
    s.feed.unshift({ tick: this.w.tick, kind: 'incident', text });
    if (s.feed.length > FEED_KEEP) s.feed.length = FEED_KEEP;
  }

  private met(rank: number, have: number[]) { return this.needs(rank).every((q, i) => have[i] >= q.target); }

  /** A rank's needs here: a frontier world's targets differ (shared rankNeeds). */
  private needs(rank: number) { return rankNeeds(rank, this.w.start === 'frontier'); }
  /** Each need of `rank`, in the order of RANKS[rank].needs. `black` overrides the streak (derivation counts it met). */
  private measure(rank: number, p: Player, t: Tally, black?: number): number[] {
    return this.needs(rank).map((q) => this.need(q.id, p, t, black ?? p.ranks?.black ?? 0));
  }
  private need(id: RankNeedId, p: Player, t: Tally, black: number): number {
    switch (id) {
      case 'residents': return p.progress.housed;
      case 'jobs': return p.progress.jobs;
      case 'shops': return t.shops;
      case 'leisure': return t.leisure;
      case 'cover': return Math.min(1, t.police) + Math.min(1, t.fire);
      case 'level2': return t.level2;
      case 'black': return black;
      case 'school': return p.progress.pupils > 0 || this.busLine(p) ? 1 : 0;
      case 'busline': return this.busLine(p) ? 1 : 0;
    }
  }
  private busLine(p: Player) { for (const l of this.w.transitLines.values()) if (l.owner === p.id && l.stops.length >= 2) return true; return false; }

  /**
   * Measure; when the next rank's needs are all met, reach it (one rank per call), pay the grant and grow a frontier
   * charter. Returns the `rank` message and a signature of what it shows, so net sends it only when it changed.
   */
  check(p: Player): { msg: ServerMsg & { t: 'rank' }; sig: string } {
    const seen = this.last.get(p.id);
    if (seen && seen.tick === this.w.tick) return seen.r;
    const r = this.measureNow(p);
    this.last.set(p.id, { tick: this.w.tick, r });
    return r;
  }
  private measureNow(p: Player): { msg: ServerMsg & { t: 'rank' }; sig: string } {
    const s = this.state(p), w = this.w;
    // the books, once a finished day
    const L = w.ledgerDTO(p);
    if (s.blackDay !== L.day && Object.keys(L.yesterday).length) {
      s.blackDay = L.day;
      s.black = (L.yesterday.tax ?? 0) > 0 && running(L.yesterday) >= 0 ? (s.black ?? 0) + 1 : 0;
    }
    const t = this.tally(p);
    const fresh: Milestone[] = [];
    const seen = new Set(s.seen); // (a set for the look-ups: a grown town has a few hundred keys)
    const note = (key: string, kind: Milestone['kind'], text: string) => {
      s.seen.push(key); seen.add(key);
      const m = { tick: w.tick, kind, text };
      s.feed.unshift(m); fresh.push(m);
    };
    let up: RankUp | undefined;
    if (s.rank < TOP_RANK) {
      const next = s.rank + 1, have = this.measure(next, p, t);
      this.needs(next).forEach((q, i) => { const key = `need:${next}:${q.id}`; if (have[i] >= q.target && !seen.has(key)) note(key, 'need', `${RANKS[next].name}: ${q.label} ✓`); });
      if (this.met(next, have)) {
        s.rank = next; s.at[next] = w.tick;
        const def = RANKS[next];
        if (def.grant) w.credit(p.id, def.grant, 'other');
        const land = this.holder() === p.id ? this.grantRing(p, s, next) : undefined;
        note(`rank:${next}`, 'rank', `${def.name}! ${rankRewardText(next, !!land)}`);
        up = { rank: next, grant: def.grant, ...(land ? { land } : {}), at: t.n ? [Math.round(t.cx / t.n), Math.round(t.cy / t.n)] : this.home(p) };
        w.playersDirty = true;
      }
    }
    for (const m of this.milestones(p, s, t)) if (!seen.has(m.key)) note(m.key, m.kind, m.text);
    // growth that has paused: say why and what to do (lots waiting for builders, else the next rank's first need short)
    const housed = p.progress.housed;
    if (housed > (s.peak ?? 0)) { s.peak = housed; s.peakAt = w.tick; }
    else if (housed >= 25 && s.peakAt !== undefined) {
      const k = Math.floor((w.tick - s.peakAt) / STALL_TICKS), key = `stall:${s.peak}:${k}`;
      if (k >= 1 && k <= STALL_WORDS && !seen.has(key)) note(key, 'need', this.stallText(p, s));
    }
    if (this.onStory && fresh.length) {
      const mid: [number, number] = t.n ? [Math.round(t.cx / t.n), Math.round(t.cy / t.n)] : this.home(p);
      for (const m of fresh) {
        if (m.kind === 'rank' && up) this.onStory({ kind: 'rank', player: p.id, at: up.at, text: m.text, rank: up.rank, grant: up.grant });
        else if (NEWS_KINDS.has(m.kind)) this.onStory({ kind: 'milestone', player: p.id, at: mid, text: m.text });
      }
    }
    if (s.feed.length > FEED_KEEP) s.feed.length = FEED_KEEP;
    if (s.seen.length > 600) s.seen = s.seen.slice(-600); // the keys are bounded by the steps above; a guard, not a rule
    const mark = POP_STEPS.find((n) => n > p.progress.housed);
    const rank: RankDTO = {
      rank: s.rank, have: s.rank < TOP_RANK ? this.measure(s.rank + 1, p, t) : [], at: [...s.at], feed: s.feed.slice(0, FEED_SEND),
      ...(this.w.start === 'frontier' ? { frontier: true } : {}),
      ...(mark ? { mark: [p.progress.housed, mark] as [number, number] } : {}),
      ...this.rings(p, s),
    };
    return { msg: { t: 'rank', rank, ...(up ? { up } : {}), ...(fresh.length ? { fresh: fresh.reverse() } : {}) }, sig: JSON.stringify(rank) };
  }

  private stallText(p: Player, s: RankState): string {
    let waiting = 0;
    for (const q of this.w.sites.values()) if (this.w.parcelAt(q.x, q.y)?.owner === p.id) waiting++;
    if (waiting >= 15) return `Growth has paused at ${s.peak} residents with ${waiting} lots waiting for builders: another builders' yard (Y) puts more crews on them`;
    const have = s.rank < TOP_RANK ? this.measure(s.rank + 1, p, this.tally(p)) : [];
    const short = this.needs(s.rank + 1).find((q, i) => have[i] < q.target);
    return `Growth has paused at ${s.peak} residents: ${(NEED_HOW[short?.id ?? 'residents']).replace(/\.$/, '')}`;
  }

  /** The milestones true now, each with its key (fired once ever): residents, jobs, building work, taxes, firsts, research, goals. */
  private milestones(p: Player, s: RankState, t: Tally): { key: string; kind: Milestone['kind']; text: string }[] {
    const out: { key: string; kind: Milestone['kind']; text: string }[] = [];
    const pr = p.progress;
    for (const n of POP_STEPS) if (pr.housed >= n) out.push({ key: `pop:${n}`, kind: 'people', text: `${n.toLocaleString('en-GB')} residents` });
    for (const n of JOB_STEPS) if (pr.jobs >= n) out.push({ key: `jobs:${n}`, kind: 'jobs', text: `${n.toLocaleString('en-GB')} jobs filled on your land` });
    for (const n of BUILT_STEPS) if (pr.built >= n) out.push({ key: `built:${n}`, kind: 'first', text: `${n.toLocaleString('en-GB')} units of building work done` });
    const tax = this.w.ledgerDTO(p).yesterday.tax ?? 0;
    for (const n of TAX_STEPS) if (tax >= n) out.push({ key: `tax:${n}`, kind: 'money', text: `A day's taxes passed ${usd(n)}` });
    const firsts: [boolean, string, string][] = [
      [t.homes > 0, 'home', 'The first house finished'], [t.shops > 0, 'shop', 'The first shop opens'], [t.works > 0, 'works', 'The first works opens'],
      [t.offices > 0, 'office', 'The first office opens'], [t.level2 > 0, 'level2', 'The first two-storey building'], [t.level3 > 0, 'level3', 'The first three-storey building'],
      [t.police > 0, 'police', 'A police building opens'], [t.fire > 0, 'fire', 'A fire building opens'], [t.leisure > 0, 'leisure', 'Somewhere to go: the first park or venue'],
      [t.yards > 1, 'yard2', 'A second builders\' yard'], [pr.pupils > 0, 'school', 'The first pupils at school'], [this.busLine(p), 'bus', 'The first bus line runs'],
      [!!this.w.adverts?.counts(p.id).posted, 'poster', 'Your first poster goes up'],
      [(s.black ?? 0) >= 1, 'black', 'A day in the black: taxes covered the running costs'], [(s.black ?? 0) >= 7, 'black7', 'A week in the black'],
    ];
    for (const [ok, key, text] of firsts) if (ok) out.push({ key: `first:${key}`, kind: 'first', text });
    for (const id of p.tech) out.push({ key: `tech:${id}`, kind: 'tech', text: `${TECH_BY_ID.get(id)?.name ?? id} unlocked` });
    for (const id of p.onboarding?.done ?? []) out.push({ key: `goal:${id}`, kind: 'goal', text: `Goal done: ${GOAL_BY_ID.get(id)?.title ?? id}` });
    return out;
  }

  private tally(p: Player): Tally {
    const w = this.w, seen = new Set<object>();
    const t: Tally = { homes: 0, shops: 0, works: 0, offices: 0, level2: 0, level3: 0, police: 0, fire: 0, leisure: 0, yards: 0, cx: 0, cy: 0, n: 0 };
    // every building once, kept when it stands on the player's land (cheaper than walking the land tile by tile)
    for (const b of w.buildings.values()) {
      if (b.level <= 0 || seen.has(b)) continue;
      seen.add(b);
      if (w.parcelAt(b.x, b.y)?.owner !== p.id) continue;
      const x = b.x, y = b.y;
      t.cx += x; t.cy += y; t.n++;
      if (b.id === CAMP_KIND) continue; // tents are not a house
      const z = b.zone;
      if (z === Zone.Residential) t.homes++;
      else if (z === Zone.Commercial) t.shops++;
      else if (z === Zone.Industrial) t.works++;
      else if (z === Zone.Office) t.offices++;
      else if (z === Zone.Police) t.police++;
      else if (z === Zone.Fire) t.fire++;
      else if (z === Zone.Yard) t.yards++;
      else if (isLeisure(b.id)) t.leisure++;
      if (z >= Zone.Residential && z <= Zone.Office) { if (b.level >= 2) t.level2++; if (b.level >= 3) t.level3++; }
    }
    return t;
  }

  // ---- a frontier's charter (docs/first-five.md section 0) -----------------------------------------------------------

  /** The player holding a frontier's charter (the owner of its seeded corner), or null on the Commons or before anyone joined. */
  private holder(): string | null {
    const ch = this.w.charter;
    return this.w.start === 'frontier' && ch ? this.w.parcelAt(ch.x, ch.y)?.owner ?? null : null;
  }
  private rings(p: Player, s: RankState): Pick<RankDTO, 'ring' | 'next'> {
    const ch = this.w.charter;
    if (!ch || this.holder() !== p.id) return {};
    return { ring: charterRing(ch, s.rank), ...(s.rank < TOP_RANK ? { next: charterRing(ch, s.rank + 1) } : {}) };
  }
  private home(p: Player): [number, number] {
    let best: [number, number] = this.w.home ?? [0, 0], area = 0;
    for (const q of this.w.parcels.values()) if (q.owner === p.id && q.w * q.h > area) { area = q.w * q.h; best = [q.x + (q.w >> 1), q.y + (q.h >> 1)]; }
    return best;
  }

  /**
   * Grow the charter to its ring for `rank`: every unclaimed tile between the land it holds and that ring becomes the
   * holder's, as parcels of at most MAX_PARCEL_EDGE a side combined into the charter's estate (a lone run where someone
   * else's land is in the way). Tiles anyone already owns are left alone. Returns the new ring, or undefined when there
   * was nothing to give.
   */
  private grantRing(p: Player, s: RankState, rank: number): { x: number; y: number; w: number; h: number } | undefined {
    const w = this.w, ch = w.charter!;
    if ((s.ring ?? 0) >= rank) return undefined;
    const B = charterRing(ch, rank);
    const lead = w.parcelAt(ch.x, ch.y);
    const ids: number[] = [];
    // rows of the ring outside the charter's own square, cut into runs of unclaimed tiles at most MAX_PARCEL_EDGE long,
    // stacked into rectangles where consecutive rows share a run (so open country is a handful of parcels)
    const open = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let y = B.y; y < B.y + B.h; y++) {
      const runs: [number, number][] = [];
      let x = B.x;
      while (x < B.x + B.w) {
        if (x >= ch.x && x < ch.x + ch.w && y >= ch.y && y < ch.y + ch.h) { x = ch.x + ch.w; continue; }
        if (w.parcelIdAt(x, y) !== 0) { x++; continue; }
        const x0 = x;
        while (x < B.x + B.w && x - x0 < MAX_PARCEL_EDGE && w.parcelIdAt(x, y) === 0 && !(x >= ch.x && x < ch.x + ch.w && y >= ch.y && y < ch.y + ch.h)) x++;
        runs.push([x0, x - x0]);
      }
      const next = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const [x0, len] of runs) {
        const k = `${x0},${len}`, r = open.get(k);
        if (r && r.h < MAX_PARCEL_EDGE) { r.h++; next.set(k, r); open.delete(k); } else next.set(k, { x: x0, y, w: len, h: 1 });
      }
      for (const r of open.values()) ids.push(this.parcel(p, r, lead?.taxRate));
      open.clear();
      for (const [k, r] of next) open.set(k, r);
    }
    for (const r of open.values()) ids.push(this.parcel(p, r, lead?.taxRate));
    s.ring = rank;
    if (!ids.length) return B;
    if (lead) w.combineParcels([lead.id, ...ids], (o) => o === p.id); // one estate with the charter: its name, colour and tax rate
    return B;
  }
  private parcel(p: Player, r: { x: number; y: number; w: number; h: number }, taxRate = DEFAULT_TAX): number {
    const w = this.w;
    const q = { id: w.nextId++, owner: p.id, name: `${p.name}'s charter`, ...r, taxRate, stats: emptyStats() };
    w.parcels.set(q.id, q);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) w.setParcelId(x, y, q.id);
    w.recountRoads(q.id);
    w.dirtyParcels.add(q.id);
    return q.id;
  }

  /**
   * A frontier's land rule (net.ts buy): the charter holder buys beyond the charter only from the rank that opens the
   * land (City); anyone else may not buy inside the ring the charter will reach at City. Null when the purchase may go
   * on to the ordinary rules (landrules.ts).
   */
  landRefusal(p: Player, r: { x: number; y: number; w: number; h: number }): string | null {
    const ch = this.w.charter, holder = this.holder();
    if (!ch || !holder) return null;
    if (holder === p.id) {
      const s = this.state(p);
      if (RANKS[s.rank].open) return null;
      const now = charterRing(ch, s.rank), nx = RANKS[s.rank + 1];
      return `Your charter is ${now.w}×${now.h} for a ${RANKS[s.rank].name}; more land comes with rank: as a ${nx.name} it reaches ${nx.side}×${nx.side}${nx.open ? ', and land beyond it may be bought' : ''} (the rank chip at the top shows what that needs)`;
    }
    const all = charterRing(ch, TOP_RANK);
    const hits = r.x < all.x + all.w && r.x + r.w > all.x && r.y < all.y + all.h && r.y + r.h > all.y;
    return hits ? `That land is held for ${this.w.players.get(holder)?.name ?? holder}'s charter, which grows to ${all.w}×${all.h} as their town does` : null;
  }
}
