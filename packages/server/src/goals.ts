import {
  GOALS, HINTS, DEFICIT_COVER_DAYS, deficitMsg, TECH_BY_ID, Zone, runningBalance, TICKS_PER_DAY, CAMP_KIND, familyOf, isLeisure, isHintId, rewardText, tileKey, isFuneralKind, isRestKind,
  type GoalDef, type GoalId, type GoalsDTO, type HintId, type LedgerDTO, type LedgerCat, LEDGER_GROUP, type ServerMsg,
} from '@msimcity/shared';
import type { World, Player } from './world';

/** A player's onboarding, saved with the player (absent in older saves: created on the next join). */
export interface GoalState {
  done: GoalId[];
  skipped?: boolean;
  /** hints dismissed for good */
  dismissed?: string[];
  /** days in a row that ended with running costs above taxes and fees, and the day that was last looked at */
  negStreak?: number; negDay?: number;
  /** tick each server hint was last sent, so none comes more than once a game day */
  hintAt?: Partial<Record<HintId, number>>;
  /** the first-settlers moment has happened (docs/first-five.md; absent in older saves) */
  settlers?: boolean;
  /** the game day the record began: the deficit hint keeps quiet for the first two days (absent in older saves) */
  since?: number;
  /** road tiles already on the player's land when the record began (a frontier charter's country road): "Lay a street" counts the ones after */
  roadBase?: number;
  /** event goals an event has brought in (shared GoalDef.event: the burial goal after a town's first death), until done */
  due?: GoalId[];
}

/** A server hint is sent again (unless dismissed) at most this often, tips less often than alerts; the client spaces whatever arrives. */
const HINT_REPEAT = { alert: TICKS_PER_DAY, tip: TICKS_PER_DAY * 3 };
/** Hints that say what a goal already says: quiet while that goal is the active one. */
const SAID_BY_GOAL: Partial<Record<HintId, GoalId>> = { builders: 'yard', bored: 'leisure', deficit: 'books', burial: 'burial' };
/** Where "Pitch camp" sits in the chain: a player saved past it (before the camp existed) is not sent back to it. */
const CAMP_AT = GOALS.findIndex((g) => g.id === 'camp');
/** Hourly samples of the world's queued share, and the share over a day of them that counts as jammed. */
const JAM_HOURS = 24, JAM_SHARE = 0.5, JAM_MIN_VEHICLES = 40;

/** What the goals measure on a player's own land. */
interface Tally { land: number; camps: number; homePop: number; roads: number; resLots: number; comLots: number; shopJobs: number; yards: number; police: number; fire: number; leisure: number; funeral: number; rest: number }

/**
 * Onboarding goals and the advisor's server-side hints (shared/src/goals.ts). Net calls `check` a few times a game hour
 * for every online player and sends what it returns; completion is measured from the counters the tech tree already
 * reads (progress), the player's parcels and their buildings, so nothing new is tracked in the simulation.
 */
export class Onboarding {
  /** the world's queued share, one sample a game hour (newest last) */
  private jam: number[] = [];

  /** growths held back by power in the last game hour, by owner (sim/utilities.ts heldBack); set by game.ts */
  powerHeld: ((owner: string) => number) | null = null;

  constructor(private w: World, private traffic: { lastQueued: number; lastVehicles: number }) {}

  /** The player's state, created on first use; goals a returning player has already met are marked done without a reward. */
  private state(p: Player): GoalState {
    if (p.onboarding) {
      const s = p.onboarding;
      if (!s.done.includes('camp') && s.done.some((id) => GOALS.findIndex((g) => g.id === id) > CAMP_AT)) s.done.push('camp');
      return s;
    }
    const s: GoalState = { done: [], since: this.w.day };
    p.onboarding = s;
    const t = this.tally(p);
    if (t.roads) s.roadBase = t.roads;
    for (const g of GOALS) if (this.met(g, this.measure(g, p, t))) s.done.push(g.id);
    return s;
  }

  /**
   * The goal being worked on: an event goal that is due and can be done now (its first part's technology could be bought:
   * shared GoalDef.event), ahead of the chain; else the chain's first goal not done (event goals are not in the chain).
   */
  private active(s: GoalState, p?: Player): GoalDef | null {
    for (const id of s.due ?? []) {
      const g = GOALS.find((x) => x.id === id);
      if (g && !s.done.includes(id) && (!p || this.doable(g, p))) return g;
    }
    return GOALS.find((g) => !g.event && !s.done.includes(g.id)) ?? null;
  }
  /** An event goal can be worked on once the technology it asks for could be bought (or is owned). */
  private doable(g: GoalDef, p: Player): boolean {
    const t = g.id === 'burial' ? TECH_BY_ID.get('rem1') : undefined;
    return !t || p.tech.includes(t.id) || (p.progress[t.condition.counter] ?? 0) >= t.condition.min;
  }
  /** An event brings in an event goal (net.ts: a town's first death brings 'burial'). */
  due(p: Player, id: GoalId) {
    const s = this.state(p);
    if (s.done.includes(id) || s.due?.includes(id)) return;
    (s.due ??= []).push(id);
  }
  private met(g: GoalDef, parts: number[]) { return g.parts.every((q, i) => parts[i] >= q.target); }

  /**
   * Measure the active goal; when it is met, pay its reward and move on (one goal per call, so completions arrive one
   * at a time). Returns the goals message and whether anything changed since `lastSig`.
   */
  check(p: Player): { msg: ServerMsg & { t: 'goals' }; sig: string } {
    const s = this.state(p);
    let g = this.active(s, p);
    let completed: { id: string; reward: string } | undefined;
    let t: Tally | null = null;
    if (g && !s.skipped) {
      t = this.tally(p);
      if (this.met(g, this.measure(g, p, t))) {
        s.done.push(g.id);
        completed = { id: g.id, reward: this.pay(p, g) };
        if (s.due) s.due = s.due.filter((id) => id !== g!.id);
        g = this.active(s, p);
        t = this.tally(p);
      }
    }
    const goals: GoalsDTO = {
      done: [...s.done], active: g?.id ?? null, parts: g && t ? this.measure(g, p, t) : [],
      skipped: !!s.skipped, dismissed: [...(s.dismissed ?? [])],
    };
    return { msg: { t: 'goals', goals, completed }, sig: JSON.stringify(goals) };
  }

  /** Cash through the ledger ('other'), a free technology (its price when already owned). Returns the words for it. */
  private pay(p: Player, g: GoalDef): string {
    const w = this.w;
    if (g.reward.cash) w.credit(p.id, g.reward.cash, 'grant');
    const tech = g.reward.tech ? TECH_BY_ID.get(g.reward.tech) : undefined;
    if (tech) {
      if (p.tech.includes(tech.id)) w.credit(p.id, tech.cost, 'grant');
      else { p.tech.push(tech.id); w.techVersion++; }
    }
    w.playersDirty = true;
    return rewardText(g, (id) => TECH_BY_ID.get(id)?.name ?? id);
  }

  /** Each part of a goal, in the order of GoalDef.parts. */
  private measure(g: GoalDef, p: Player, t: Tally): number[] {
    const housed = p.progress.housed;
    switch (g.id) {
      case 'plot': return [t.land];
      case 'road': return [Math.max(0, t.roads - (p.onboarding?.roadBase ?? 0))];
      case 'camp': return [t.camps || (housed >= 8 ? 1 : 0)]; // or eight people housed another way: the chain never blocks on the camp
      case 'homes': return [t.resLots];
      case 'yard': return [t.yards];
      case 'res12': return [t.homePop]; // in houses, not the camp's tents
      case 'res50': case 'res250': return [housed];
      case 'shops': return [t.comLots, t.shopJobs];
      case 'masonry': return [p.tech.includes('con1') ? 1 : 0];
      case 'cover': return [t.police, t.fire];
      case 'leisure': return [t.leisure];
      case 'adverts': { const a = this.w.adverts?.counts(p.id); return [p.tech.includes('adv1') ? 1 : 0, a?.campaigns ?? 0, a?.rentals ?? 0]; }
      case 'books': return [housed, this.inTheBlack(p) ? 1 : 0];
      case 'busline': return [[...this.w.transitLines.values()].filter((l) => l.owner === p.id && l.stops.length >= 2).length];
      case 'burial': return [p.tech.includes('rem1') ? 1 : 0, t.funeral, t.rest];
    }
  }

  /** Yesterday's taxes and fees covered its wages and upkeep (building and buying are choices, not running costs). */
  private inTheBlack(p: Player) {
    const y = this.w.ledgerDTO(p).yesterday;
    return (y.tax ?? 0) > 0 && running(y) >= 0;
  }

  private tally(p: Player): Tally {
    const w = this.w;
    const t: Tally = { land: 0, camps: 0, homePop: 0, roads: 0, resLots: 0, comLots: 0, shopJobs: 0, yards: 0, police: 0, fire: 0, leisure: 0, funeral: 0, rest: 0 };
    for (const q of w.parcels.values()) {
      if (q.owner !== p.id) continue;
      t.land += q.w * q.h;
      t.roads += q.stats.roads;
      q.stats.staffedByKind.forEach((n, k) => { if (n && familyOf(k) === Zone.Commercial) t.shopJobs += n; });
      for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) {
        const b = w.buildings.get(tileKey(x, y));
        if (!b) continue;
        if (b.id === CAMP_KIND) { if (b.level > 0) t.camps++; continue; } // a camp is not a lot that grows
        if (b.zone === Zone.Residential && b.level > 0) t.homePop += b.occupants;
        if (b.zone === Zone.Residential && w.hasRoadAccess(x, y)) t.resLots++;
        else if (b.zone === Zone.Commercial) t.comLots++;
        if (b.level <= 0) continue;
        if (isFuneralKind(b.id)) t.funeral++;
        else if (isRestKind(b.id)) t.rest++;
        if (b.zone === Zone.Yard) t.yards++;
        else if (b.zone === Zone.Police) t.police++;
        else if (b.zone === Zone.Fire) t.fire++;
        else if (isLeisure(b.id)) t.leisure++;
      }
    }
    // a yard still being built counts: the player has done their part
    for (const s of w.sites.values()) if (familyOf(s.kind) === Zone.Yard && w.parcelAt(s.x, s.y)?.owner === p.id) t.yards++;
    // and a funeral director or resting place going up (docs/remembrance.md)
    for (const s of w.sites.values()) if ((isFuneralKind(s.kind) || isRestKind(s.kind)) && w.parcelAt(s.x, s.y)?.owner === p.id) { if (isFuneralKind(s.kind)) t.funeral++; else t.rest++; }
    return t;
  }

  // ---- hints -----------------------------------------------------------------------------------

  /** A hint for this player, or null when they dismissed it, skipped the tutorial (tips only) or heard it within a day. */
  hint(p: Player, id: HintId, msg?: string): ServerMsg | null {
    const s = this.state(p);
    if (s.dismissed?.includes(id) || (s.skipped && HINTS[id].kind === 'tip')) return null;
    if (!s.skipped && SAID_BY_GOAL[id] && this.active(s, p)?.id === SAID_BY_GOAL[id]) return null;
    const at = (s.hintAt ??= {})[id];
    if (at !== undefined && this.w.tick - at < HINT_REPEAT[HINTS[id].kind] && at <= this.w.tick) return null;
    s.hintAt[id] = this.w.tick;
    return { t: 'hint', id, msg };
  }

  /**
   * The first settlers have moved in on this player's land, at the camp (x, y) (sim/firstfive.ts): the camera moment,
   * once per player ever, never after "skip the tutorial". Null when it has happened already.
   */
  settlers(p: Player, x: number, y: number, who: string): ServerMsg | null {
    const s = this.state(p);
    if (s.settlers) return null;
    s.settlers = true;
    // a player with a town already (a save from before the moment existed): no "first settlers" for them
    if (s.skipped || s.done.includes('res12') || p.progress.housed > 12) return null;
    return { t: 'hint', id: 'settlers', msg: who, at: [x, y] };
  }

  /** Once a game hour: sample the world's traffic. */
  hourly() {
    const v = this.traffic.lastVehicles;
    this.jam.push(v >= JAM_MIN_VEHICLES ? this.traffic.lastQueued / v : 0);
    if (this.jam.length > JAM_HOURS) this.jam.shift();
  }

  /** Once a game hour per online player: the hints only the server can see. */
  advise(p: Player): ServerMsg[] {
    const s = this.state(p), out: ServerMsg[] = [];
    const add = (id: HintId, msg?: string) => { const m = this.hint(p, id, msg); if (m) out.push(m); };
    // the books: two finished days in a row with running costs above taxes and fees
    const L = this.w.ledgerDTO(p);
    if (s.negDay !== L.day && Object.keys(L.yesterday).length) {
      s.negDay = L.day;
      s.negStreak = running(L.yesterday) < 0 ? (s.negStreak ?? 0) + 1 : 0;
    }
    if ((s.negStreak ?? 0) >= 2) {
      // only when the bank is running low: it covers less than DEFICIT_COVER_DAYS days of the running costs (wages, upkeep,
      // interest, bills), read from yesterday's ledger, and the record is past its first two game days
      const cost = outgoings(L.yesterday), loss = -running(L.yesterday), early = s.since !== undefined && this.w.day - s.since < 2;
      if (!early && cost > 0 && p.money < DEFICIT_COVER_DAYS * cost) add('deficit', deficitMsg(p.money > 0 && loss > 0 ? p.money / loss : null));
    }
    if (p.progress.housed >= 30 && this.jam.length >= JAM_HOURS && this.jam.reduce((a, b) => a + b, 0) / this.jam.length > JAM_SHARE) add('jam');
    if (p.progress.housed >= 60 && this.tally(p).leisure === 0) add('bored');
    if ((this.powerHeld?.(p.id) ?? 0) > 0) add('power');
    return out;
  }

  /** Skip or resume the chain, or dismiss a hint for good. */
  command(p: Player, m: { t: 'goals'; op: string } | { t: 'hint'; id: string }) {
    const s = this.state(p);
    if (m.t === 'goals') s.skipped = m.op === 'skip';
    else if (isHintId(String(m.id)) && !s.dismissed?.includes(m.id)) (s.dismissed ??= []).push(m.id);
  }
}

/** What a day's running costs came to (wages, upkeep, interest, bills: the running lines that went out), as a positive sum. */
export const outgoings = (r: LedgerDTO['today']) =>
  (Object.keys(r) as LedgerCat[]).reduce((a, k) => a + (LEDGER_GROUP[k] === 'running' && (r[k] ?? 0) < 0 ? -(r[k] ?? 0) : 0), 0);
/** A day's running balance, as the ledger shows it (shared LEDGER_GROUP). */
export const running = (r: LedgerDTO['today']) => runningBalance(r);
