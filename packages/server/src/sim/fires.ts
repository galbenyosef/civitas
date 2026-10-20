import {
  FIRE, FirePhase, FireOutcome, burntShare, fireRamp, TICKS_PER_HOUR, TICKS_PER_DAY, SERVICE_RADIUS_OF, PATROL_RATE_OF, KIND_NAMES, Zone, TECH_BY_ID,
  hash2, tileKey, capacityOf, isGrowableId, isMergedKind, firstLevelOf, leisureAt, buildingValue, withLevel, withConstruction,
  BLAST_CAUSES, type BlastCause, type BlastSpec, type FireDTO, type HintId,
} from '@msimcity/shared';
import type { Building, World } from '../world';
import { tkey, untkey } from '../world';
import type { Simulation } from './simulation';

const TPH = TICKS_PER_HOUR, DAY = TICKS_PER_DAY;
/** the zones whose buildings burn: homes and works */
const BURNS = [Zone.Residential, Zone.Commercial, Zone.Industrial, Zone.Office] as const;
const BASE_NAMES: Record<number, string> = { [Zone.Residential]: 'house', [Zone.Commercial]: 'shop', [Zone.Industrial]: 'works', [Zone.Office]: 'office' };
/** engines sent to one fire at most (the first got lost: no road, stuck and gave up) */
const MAX_TRIES = 3;

interface Fire {
  id: number; x: number; y: number; owner: string;
  /** kind and level when it caught light (the damage and the bill are worked out on these) */
  kind: number; level: number;
  t0: number; burn: number; seed: number;
  ph: number;
  /** the engine on its way or at work (a vehicle id; vehicles are not saved, so a loaded fire sends another), its station's door */
  engine: number | null; station: [number, number] | null; tries: number;
  /** share burnt when help arrived (0 until then), the tick help arrived, the tick it will be (or went) out */
  d: number; ta: number; t1: number;
  /** attended by an engine crew (not only the bucket chain) */
  crew: boolean;
  /** a fire a step or two from the station, too close for the engine to drive: the crew run over with the hose, there at this tick */
  onFoot?: number;
  /** where the crew's hose plays from while they put it out (the engine pulled up at the kerb), for the drawing */
  hose?: [number, number];
  /** the owner's warning fire: never worse than the bucket chain leaves it */
  warning?: boolean;
  /** a demo's fire drill (FIRE.drillGapHours): it lights again after it is out, costs nothing and never burns down */
  drill?: boolean;
  out?: number; lost?: number; cost?: number;
  w: number; h: number;
  // ---- v2 (all optional: a fire saved before them loads as an ordinary fire)
  /** the tick of its next hourly roll to spread or blow up (FIRE.spreadMax, blastMax); absent in an older save: due on the hour from t0 */
  next?: number;
  /** caught from a fire next door (1) or a blast (2) */
  from?: 1 | 2;
  /** the tick it exploded (explode: a works, FIRE.blastMax; a gas leak), and what the blast itself cost */
  bx?: number; blastCost?: number;
  /** what blew up, when not a works (BLAST_CAUSES); and whether the blast destroyed the building outright (damage 1) */
  cause?: BlastCause; levelled?: boolean;
  /** a demo drill's engines are held until this tick (the row has to be seen to spread, the works to blow) */
  hold?: number;
  /** a demo's spread drill: the round it belongs to (the lead house's tick) */
  round?: number;
}
interface PlayerFire {
  /** when the warning fire is due (absent until the owner first houses FIRE.warnHoused) and when it caught light */
  warnAt?: number; warned?: number;
}
/** What the snapshot keeps (snapshot.ts `fires`): fires burning or in their aftermath, buildings still young, each player's warning. */
export interface FireSave {
  fires: Fire[];
  /** door tile x, y and the tick it was first seen standing, for buildings younger than FIRE.matureDays */
  born: [number, number, number][];
  players: Record<string, PlayerFire>;
  nextId: number;
}
/** Something to tell one owner (net.ts sends a hint or a toast). */
export interface FireNotice {
  owner: string; msg: string; hint?: HintId;
  /** a line for the owner's milestone feed too (ranks.ts incident): an explosion */
  feed?: string;
}
/**
 * A fire's news (sim/news.ts, docs/media.md): it caught light (`engine` when a crew was sent), went out (`outcome` a
 * FireOutcome, `lost` levels), caught from a neighbour or a blast ('spread', ignite's `opts.from`), or blew up
 * ('explosion', in blast(): its `cause`, the buildings it set alight and whether it levelled the building). `quiet` is
 * explode()'s fresh source, whose story is the explosion's.
 */
export interface FireStoryEvent {
  phase: 'lit' | 'out' | 'spread' | 'explosion';
  id: number; x: number; y: number; owner: string; kind: number;
  engine?: boolean; warning?: boolean; drill?: boolean; crew?: boolean;
  outcome?: number; lost?: number; quiet?: boolean;
  cause?: BlastCause; lit?: number; levelled?: boolean;
}

/**
 * House fires with real dispatch (docs/incidents.md, docs/audit-2026-10.md card 3).
 *
 * Every home and works is rolled once a game hour (a slice of the built-building lists each tick, the way the dispatcher
 * rolls freight), against a hash of its tile and the hour, so a run is the same for a given world whatever else draws
 * from Math.random. The chance is FIRE.perDay times its weight: its density (level, or a merged building's jobs or beds
 * over six), its age (FIRE.youngRisk rising to 1 over matureDays) and, in reach of a staffed fire engine, coveredRisk.
 *
 * A fire takes hold slowly, then fast (FIRE.growth), burning out in about FIRE.burnHours. The nearest staffed fire post or station whose
 * reach covers it (FIRE.reach, or the station's own cover when wider) sends its engine with priority through the
 * signals; when the engine parks there the share burnt is frozen and the crew puts it out. Then the building loses
 * floor(level x share burnt) levels, and the owner pays costShare of its book value times that share ('fire' in the
 * ledger). With no engine it burns out: the lot goes back to an empty lot of its zone (a merged building breaks back into
 * lots), its people leave, and the owner pays costShare of the whole value.
 *
 * Fairness (the first hour): a player's first fire is a warning, a hashed 3-9 hours after they first house warnHoused
 * people, always put out by the neighbours' bucket chain with nothing lost when no engine comes, with an advisor hint
 * that points at the fire post. Ordinary fires begin graceDays after it, and only once the owner has met Emergency
 * services' condition (so they could have bought it). The Commons burns from the start (its stations answer).
 *
 * Pure sim layer: Net reads `changed`, `dtos()` and drains `notices`; Issues reads `burningAt` for the "on fire" badge.
 */
export class Fires {
  notices: FireNotice[] = [];
  /** set whenever the list the clients draw changed (net.ts broadcasts `fires`) */
  changed = true;
  /** FIRES=0 or a sandbox owner's opt-out later: nothing catches light */
  enabled = true;
  /** a demo's fire drill homes (index.ts, from the scenario's 'house-fire' spots) */
  drills: [number, number][] = [];
  /** a demo's spread drills: rows of homes, the lead first, that catch one after another (the scenario's 'fire-spread' spots) */
  rows: [number, number][][] = [];
  /** a demo's blast drills: works that catch light and blow up (the scenario's 'fire-blast' spots) */
  blastDrills: [number, number][] = [];
  /** self-timing for the load test */
  ms = 0; ticks = 0;
  /** counters since start, for the probes: fires lit, by outcome, engines sent, engines that arrived */
  stats = { lit: 0, warning: 0, saved: 0, partial: 0, burnt: 0, gone: 0, engines: 0, arrived: 0, cost: 0, spread: 0, blasts: 0, blastCost: 0, capped: 0 };
  /** fired after any fire starts, changes phase or goes out (game.ts points it at Issues.fireChanged) */
  onChange: ((x: number, y: number) => void) | null = null;
  /** fired when a fire starts and when it goes out, for the news (game.ts points it at News.fire) */
  onStory: ((e: FireStoryEvent) => void) | null = null;

  private fires = new Map<string, Fire>();
  private born = new Map<number, number>();
  private players: Record<string, PlayerFire> = {};
  private nextId = 1;
  /** first hour after start: a building seen for the first time in an old world is taken as mature */
  private startTick: number;
  private drillOut = new Map<string, number>();

  constructor(private w: World, private sim: Simulation, private issues?: { fireChanged(x: number, y: number): void }) {
    this.startTick = w.tick;
    sim.held = (into) => this.held(into);
    const s = w.firesLoaded;
    if (s) {
      for (const f of s.fires ?? []) if (f && Number.isInteger(f.x) && Number.isInteger(f.y)) this.fires.set(tileKey(f.x, f.y), { ...f, engine: null, tries: 0 });
      for (const [x, y, t] of s.born ?? []) this.born.set(tkey(x, y), t);
      this.players = { ...(s.players ?? {}) };
      this.nextId = Math.max(1, s.nextId ?? 1);
      w.firesLoaded = null;
    }
    w.firesSave = () => this.save();
  }

  /** Whether a fire is burning or being put out at a door tile. */
  burningAt(x: number, y: number): boolean {
    if (!this.fires.size) return false; // the usual case: Issues asks for every building it looks at
    const f = this.fires.get(tileKey(x, y));
    return !!f && f.ph !== FirePhase.Out;
  }
  /** Every tile of each building burning or being put out (Simulation.held: growth leaves them alone). */
  held(into: Set<number>) {
    for (const f of this.fires.values()) {
      if (f.ph === FirePhase.Out) continue;
      const s = f.w * f.h > 1 ? this.w.structureAt(f.x, f.y) : null;
      if (!s) { into.add(tkey(f.x, f.y)); continue; }
      for (let y = s.ay; y < s.ay + s.h; y++) for (let x = s.ax; x < s.ax + s.w; x++) into.add(tkey(x, y));
    }
  }
  /** Fires burning or being put out now. */
  get active(): number { let n = 0; for (const f of this.fires.values()) if (f.ph !== FirePhase.Out) n++; return n; }

  /** Once per simulation tick (game.ts), after the simulation. */
  tick() {
    const t0 = performance.now();
    const w = this.w, now = w.tick;
    if (this.enabled) {
      if (now % TPH === 0) this.warnings();
      this.roll();
      this.runDrills();
    }
    if (this.fires.size) for (const f of [...this.fires.values()]) this.step(f, now);
    this.ms += performance.now() - t0; this.ticks++;
  }

  /** The list the clients draw. */
  dtos(): FireDTO[] {
    const out: FireDTO[] = [];
    for (const f of this.fires.values()) {
      out.push({ x: f.x, y: f.y, s: f.seed, ph: f.ph, t0: f.t0, burn: f.burn, d: f.d, ta: f.ta, t1: f.t1, w: f.w, h: f.h,
        ...((f.engine !== null || f.onFoot !== undefined) && f.ph === FirePhase.Burning ? { eng: 1 } : {}), ...(f.out !== undefined ? { out: f.out } : {}),
        ...(f.ph === FirePhase.Fighting ? (f.hose ? { hx: f.hose[0], hy: f.hose[1] } : f.crew ? {} : { bk: 1 }) : {}),
        ...(f.bx !== undefined ? { bx: f.bx, ...(f.cause ? { bc: BLAST_CAUSES[f.cause].code } : {}) } : {}) });
    }
    return out;
  }

  /** What a building's tooltip says while it burns, or null. */
  describe(x: number, y: number): string | null {
    const f = this.fires.get(tileKey(x, y));
    if (!f) return null;
    const on = f.bx !== undefined ? 'Blown up and on fire' : f.from === 2 ? 'On fire from the explosion next door' : f.from ? 'On fire, caught from next door' : 'On fire';
    if (f.ph === FirePhase.Burning) return f.station ? `${on}: the fire crew are on their way` : f.warning ? `${on}: the neighbours are fighting it with buckets`
      : f.hold !== undefined && this.w.tick < f.hold ? `${on}: nobody has called the fire crew yet` : `${on}, with no engine in reach: it will burn down and may spread`;
    if (f.ph === FirePhase.Fighting) return f.crew ? `${on}: the fire crew are putting it out` : `${on}: the bucket chain has it under control`;
    if (f.levelled) return `Destroyed by ${f.cause ? `a ${BLAST_CAUSES[f.cause].label.toLowerCase()}` : 'an explosion'}`;
    return f.out === FireOutcome.Burnt ? 'Burnt out' : f.out === FireOutcome.Partial ? `Fire damage: ${f.lost} level${f.lost === 1 ? '' : 's'} lost` : 'A fire here was put out';
  }

  /** Start a fire at a building now (probes, the demo drill, a dev action). Returns false when it cannot burn. */
  ignite(b: Building, opts: { warning?: boolean; drill?: boolean; from?: 1 | 2; hold?: number; round?: number; quiet?: boolean; seed?: number } = {}): boolean {
    const w = this.w, key = tileKey(b.x, b.y), old = this.fires.get(key);
    if ((old && !(opts.drill && old.ph === FirePhase.Out)) || b.level <= 0 || w.buildings.get(key) !== b) return false; // a drill may light again over its aftermath
    const owner = w.parcelAt(b.x, b.y)?.owner;
    if (!owner) return false;
    const now = w.tick, seed = opts.seed ?? hash2(b.x * 31 + now % 9973, b.y * 17 + 3);
    const s = w.structureAt(b.x, b.y);
    const f: Fire = {
      id: this.nextId++, x: b.x, y: b.y, owner, kind: b.id, level: b.level,
      t0: now, burn: Math.round(FIRE.burnHours * TPH * (0.85 + 0.35 * hash2(b.y * 7 + 1, b.x * 13 + now % 7919))), seed,
      ph: FirePhase.Burning, engine: null, station: null, tries: 0, d: 0, ta: 0, t1: 0, crew: false,
      ...(opts.warning ? { warning: true } : {}), ...(opts.drill ? { drill: true } : {}),
      w: s ? s.w : 1, h: s ? s.h : 1, next: now + TPH,
      ...(opts.from ? { from: opts.from } : {}), ...(opts.hold !== undefined ? { hold: opts.hold } : {}), ...(opts.round !== undefined ? { round: opts.round } : {}),
    };
    this.fires.set(key, f);
    this.stats.lit++;
    if (opts.warning) this.stats.warning++;
    if (opts.from) this.stats.spread++;
    this.dispatch(f);
    const what = this.name(b);
    if (!opts.drill && !opts.quiet && owner !== 'sys') { // quiet: an explosion lit it, and says so itself
      const help = f.station ? `the crew from the ${KIND_NAMES[w.buildings.get(tileKey(...f.station!))?.id ?? Zone.Fire]} is on its way`
        : f.warning ? 'no engine is in reach, so the neighbours are fighting it with buckets. Next time there may be nobody to help: a fire post covers 14 tiles'
          : 'no staffed fire post or station is in reach: it will burn down';
      const how = opts.from === 2 ? ', set alight by an explosion next door' : opts.from ? ', caught from the fire next door' : '';
      this.notices.push({ owner, msg: `Fire at the ${what} at (${b.x}, ${b.y})${how}: ${help}`, ...(f.warning ? { hint: 'fire' as const } : {}) });
    }
    this.onStory?.({ phase: opts.from ? 'spread' : 'lit', id: f.id, x: f.x, y: f.y, owner, kind: f.kind, engine: !!f.station, ...(f.warning ? { warning: true } : {}), ...(f.drill ? { drill: true } : {}), ...(opts.quiet && !opts.from ? { quiet: true } : {}) });
    this.touch(f);
    return true;
  }

  // ---- what starts fires -----------------------------------------------------------------

  /** Once a game hour: each player who first housed FIRE.warnHoused gets a warning fire due a hashed few hours later; light it when due. */
  private warnings() {
    const w = this.w, now = w.tick;
    for (const p of w.players.values()) {
      if (p.id === 'sys') continue;
      let st = this.players[p.id];
      if (st?.warned !== undefined) continue;
      if (!st) {
        if ((p.progress.housed ?? 0) < FIRE.warnHoused) continue;
        st = this.players[p.id] = { warnAt: now + Math.round(TPH * (FIRE.warnMinHours + FIRE.warnSpanHours * this.hashId(p.id))) };
      }
      if (st.warnAt === undefined || now < st.warnAt) continue;
      // the owner's standing home or works with the highest hash of the hour (a lot under construction does not burn)
      let best: Building | null = null, bh = -1;
      for (const z of BURNS) for (const b of w.builtOf(z)) {
        if (!this.burnable(b) || w.parcelAt(b.x, b.y)?.owner !== p.id) continue;
        const h = hash2(b.x * 7 + now % 101, b.y * 3 + 11);
        if (h > bh) { bh = h; best = b; }
      }
      if (!best) { st.warnAt = now + TPH; continue; } // nothing standing yet: try again in an hour
      if (this.ignite(best, { warning: true })) st.warned = now;
    }
  }

  /**
   * This tick's slice of the hourly rolls: every built home and works once per game hour (a rotating slice of each list,
   * as Simulation.dispatch rolls freight), against a hash of the tile, the hour and the world seed.
   */
  private roll() {
    const w = this.w, now = w.tick, slot = now % TPH, hour = Math.floor(now / TPH);
    if (this.active >= FIRE.maxWorld) return;
    const mix = (w.seed * 2654435761) >>> 0;
    for (const z of BURNS) {
      const list = w.builtOf(z), n = list.length;
      const i0 = Math.floor((n * slot) / TPH), i1 = Math.floor((n * (slot + 1)) / TPH);
      for (let i = i0; i < i1; i++) {
        const b = list[i];
        const age = this.ageRisk(b, now);
        const p = (FIRE.perDay / 24) * this.density(b) * age;
        // cheap first: the hash against the highest the chance could be (cover only lowers it)
        const r = hash2(b.x * 92821 + (hour ^ mix), b.y * 68917 + hour * 7919 + (mix & 0xffff));
        if (r >= p) continue;
        if (!this.burnable(b) || this.fires.has(tileKey(b.x, b.y))) continue;
        const owner = w.parcelAt(b.x, b.y)?.owner;
        if (!owner || !this.ownerBurns(owner, now)) continue;
        if (r >= p * (this.stationFor(b.x, b.y) ? FIRE.coveredRisk : 1)) continue;
        if (this.ownerActive(owner) >= FIRE.maxPerOwner) continue;
        this.ignite(b);
        if (this.active >= FIRE.maxWorld) return;
      }
    }
  }

  /** A demo's drill home lights again a little while after its last fire is out. */
  private runDrills() {
    const w = this.w, now = w.tick;
    for (const [x, y] of this.drills) {
      const key = tileKey(...w.doorOf(x, y)); // the home may have grown into a bigger building meanwhile
      if (this.fires.has(key)) continue;
      const outAt = this.drillOut.get(key) ?? -Infinity;
      if (now - outAt < FIRE.drillGapHours * TPH) continue;
      const b = w.buildings.get(key);
      if (b && this.burnable(b)) this.ignite(b, { drill: true });
    }
    for (const row of this.rows) this.rowDrill(row, now);
    for (const [x, y] of this.blastDrills) this.blastDrill(x, y, now);
  }

  /**
   * A demo's spread drill: the lead house of the row catches light with its engines held (FIRE.drillHoldHours), and
   * each house still burning with no crew on it lights the next one FIRE.drillSpreadHours later, once a round, so a
   * visitor sees the fire run along the row and stop where the engines get there. A round starts again
   * FIRE.drillGapHours after the whole row is out. Drill fires cost nothing and never burn a house down.
   */
  private rowDrill(row: [number, number][], now: number) {
    const w = this.w, keys = row.map(([x, y]) => tileKey(...w.doorOf(x, y)));
    const live = keys.map((k) => { const f = this.fires.get(k); return f && f.ph !== FirePhase.Out ? f : null; });
    if (!live.some((f) => f)) {
      const outAt = Math.max(-Infinity, ...keys.map((k) => this.drillOut.get(k) ?? -Infinity));
      const b = w.buildings.get(keys[0]);
      if (now - outAt >= FIRE.drillGapHours * TPH && b && this.burnable(b)) this.ignite(b, { drill: true, hold: now + Math.round(FIRE.drillHoldHours * TPH), round: now });
      return;
    }
    for (let i = 0; i + 1 < keys.length; i++) {
      const f = live[i];
      if (!f || f.ph !== FirePhase.Burning || f.round === undefined || now - f.t0 < FIRE.drillSpreadHours * TPH) continue;
      const nf = this.fires.get(keys[i + 1]);
      if (nf && (nf.ph !== FirePhase.Out || nf.round === f.round)) continue; // burning, or already burnt this round
      const b = w.buildings.get(keys[i + 1]);
      if (b && this.burnable(b)) this.ignite(b, { drill: true, from: 1, hold: f.hold, round: f.round });
    }
  }

  /**
   * A demo's blast drill: the works catches light with its engines held, blows up FIRE.drillBlastHours later (setting
   * light to everything within FIRE.blastReach, as a real blast does, as drill fires), and lights again
   * FIRE.drillBlastGapHours after its fire and every fire the blast started are out.
   */
  private blastDrill(x: number, y: number, now: number) {
    const w = this.w, key = tileKey(...w.doorOf(x, y)), f = this.fires.get(key);
    const b = w.buildings.get(key);
    if (f && f.ph !== FirePhase.Out) {
      if (b && f.bx === undefined && f.ph === FirePhase.Burning && now - f.t0 >= FIRE.drillBlastHours * TPH) this.explode(f.x, f.y, { cause: 'industrial' });
      return;
    }
    if (!b || !this.burnable(b) || now - (this.drillOut.get(key) ?? -Infinity) < FIRE.drillBlastGapHours * TPH) return;
    for (const g of this.fires.values()) if (g.drill && g.from === 2 && g.ph !== FirePhase.Out && Math.max(Math.abs(g.x - b.x), Math.abs(g.y - b.y)) <= FIRE.blastReach + 4) return; // the last blast's fires still burning
    this.ignite(b, { drill: true, hold: now + Math.round(FIRE.drillBlastHours * TPH) });
  }

  /** May this owner's buildings catch light now? The Commons always (FIRE.commons); a player after their warning and grace, once they could buy Emergency services. */
  private ownerBurns(owner: string, now: number): boolean {
    if (owner === 'sys') return FIRE.commons;
    const p = this.w.players.get(owner), st = this.players[owner];
    if (!p || st?.warned === undefined || now - st.warned < FIRE.graceDays * DAY) return false;
    const civ1 = TECH_BY_ID.get('civ1');
    return !civ1 || p.tech.includes('civ1') || (p.progress[civ1.condition.counter] ?? 0) >= civ1.condition.min;
  }
  private ownerActive(owner: string) { let n = 0; for (const f of this.fires.values()) if (f.owner === owner && f.ph !== FirePhase.Out) n++; return n; }

  /** A standing home or works that is not a block's garden and has no builders on it. */
  private burnable(b: Building): boolean {
    if (b.level <= 0 || !isGrowableId(b.id) || this.w.sites.has(tileKey(b.x, b.y))) return false;
    return !leisureAt(b.id, b.level, b.x, b.y);
  }
  /** levels for a lot, a merged building's places over six (a lot holds about six a level), as the dispatcher weighs freight */
  private density(b: Building) { return isMergedKind(b.id) ? Math.max(1, capacityOf(b.id, b.level) / 6) : b.level; }
  /** FIRE.youngRisk for a new building, rising to 1 over matureDays; a building first seen in the first hour of an old world counts as mature */
  private ageRisk(b: Building, now: number) {
    const k = tkey(b.x, b.y);
    let t = this.born.get(k);
    if (t === undefined) {
      t = now - this.startTick < TPH && this.startTick > FIRE.matureDays * DAY ? -Infinity : now;
      if (t === -Infinity) return 1;
      this.born.set(k, t);
    }
    const days = (now - t) / DAY;
    if (days >= FIRE.matureDays) { this.born.delete(k); return 1; } // old enough: forgotten, so the save stays small (an unknown building is mature after the first hour)
    return FIRE.youngRisk + (1 - FIRE.youngRisk) * days / FIRE.matureDays;
  }
  private hashId(id: string) { let h = 0; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return hash2(h, this.w.seed); }

  // ---- dispatch and the fire's course ----------------------------------------------------

  /** Engines a fire building keeps: one at a post, two at a station, more at the big ones (twice its call-out rate, tiers.ts). */
  private engines(s: Building) { return Math.max(1, Math.round(2 * PATROL_RATE_OF[s.id])); }
  /** Engines out from a station now: at a fire or on the way to one. */
  private out(s: Building) { let n = 0; for (const f of this.fires.values()) if ((f.engine !== null || f.onFoot !== undefined) && f.ph !== FirePhase.Out && f.station && f.station[0] === s.x && f.station[1] === s.y) n++; return n; }

  /**
   * The nearest staffed fire building whose reach covers (x, y) and which is not `skip`, or null. `free`: only one with an
   * engine at home (dispatch); without it any in reach (the risk roll's cover, which is about smoke alarms and inspections).
   */
  private stationFor(x: number, y: number, skip?: Set<string>, free = false): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const s of this.sim.staffedServices) {
      if (s.zone !== Zone.Fire || skip?.has(tileKey(s.x, s.y))) continue;
      if (free && this.out(s) >= this.engines(s)) continue;
      const r = Math.max(FIRE.reach, SERVICE_RADIUS_OF[s.id]);
      if (Math.abs(s.x - x) > r || Math.abs(s.y - y) > r) continue;
      const d = Math.abs(s.x - x) + Math.abs(s.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Send the nearest engine in reach that has a road to the fire; stations already tried are skipped. */
  private dispatch(f: Fire) {
    if (f.hold !== undefined && this.w.tick < f.hold) return; // a demo drill: nobody has called them yet
    const tried = new Set<string>();
    while (f.tries < MAX_TRIES) {
      const s = this.stationFor(f.x, f.y, tried, true);
      if (!s) return;
      tried.add(tileKey(s.x, s.y));
      f.tries++;
      const owner = this.w.parcelAt(s.x, s.y)?.owner ?? null;
      const id = this.sim.spawnFireEngine([s.x, s.y], [f.x, f.y], owner);
      if (id !== null) { f.engine = id; f.station = [s.x, s.y]; this.stats.engines++; return; }
      if (Math.abs(s.x - f.x) + Math.abs(s.y - f.y) <= 3) { f.onFoot = this.w.tick + Math.round(TPH / 12); f.station = [s.x, s.y]; this.stats.engines++; return; } // next door: no road trip to drive
    }
  }

  private step(f: Fire, now: number) {
    const w = this.w, key = tileKey(f.x, f.y);
    if (f.ph === FirePhase.Out) {
      if (now - f.t1 >= FIRE.aftermathHours * TPH) { this.fires.delete(key); this.changed = true; }
      return;
    }
    const b = w.buildings.get(key);
    if (!b || b.level <= 0 || b.id !== f.kind) { this.finish(f, now, null); return; } // bulldozed, merged or rezoned meanwhile
    if (now >= (f.next ??= f.t0 + TPH * Math.max(1, Math.ceil((now - f.t0) / TPH)))) { this.hourly(f, b, now); if (f.ph === FirePhase.Out) return; }
    const d = burntShare(now - f.t0, f.burn);
    if (f.ph === FirePhase.Burning) {
      if (f.onFoot !== undefined) {
        if (now >= f.onFoot) {
          f.ph = FirePhase.Fighting; f.ta = now; f.d = Math.max(d, FIRE.minDamage); f.crew = true; f.onFoot = undefined;
          if (f.station) f.hose = [(f.station[0] + f.x) / 2 + 0.5, (f.station[1] + f.y) / 2 + 0.5]; // run out from the station door
          f.t1 = now + Math.round(FIRE.fightHours * TPH * (0.4 + f.d));
          this.stats.arrived++;
          this.touch(f);
        }
        return;
      }
      if (f.engine !== null) {
        const v = w.vehicles.get(f.engine);
        if (!v) { f.engine = null; this.dispatch(f); this.touch(f); } // lost on the way (stuck, gave up): the next station in reach
        else if (v.phase === 'dwell') {
          f.ph = FirePhase.Fighting; f.ta = now; f.d = Math.max(d, FIRE.minDamage); f.crew = true;
          f.hose = this.pullUp(v);
          f.t1 = now + Math.round(FIRE.fightHours * TPH * (0.4 + d));
          v.until = Math.max(v.until, f.t1); // the crew stay until it is out
          this.stats.arrived++;
          this.touch(f);
          return;
        }
      } else if ((now % 25 === 0 || now === f.hold) && f.tries < MAX_TRIES) { this.dispatch(f); if (f.engine !== null || f.onFoot !== undefined) this.touch(f); } // a station staffed since (a shift came on), or a drill's engines called
      // the warning fire with no engine: the neighbours' bucket chain; a drill fire the engines cannot reach in time likewise (a demo never loses a building)
      if (f.engine === null && f.onFoot === undefined && ((f.warning && d >= FIRE.bucketAt) || (f.drill && d >= 0.9))) {
        f.ph = FirePhase.Fighting; f.ta = now; f.d = Math.max(d, FIRE.minDamage); f.t1 = now + Math.round(FIRE.fightHours * TPH); // buckets take a while
        this.touch(f);
        return;
      }
      if (d >= 1) { f.d = 1; this.finish(f, now, b); }
      return;
    }
    if (now >= f.t1) this.finish(f, now, b);
  }

  // ---- v2: spread and explosions (docs/incidents.md "Fires v2") ---------------------------------------------------

  /**
   * A burning fire's hourly roll, on the hour from when it lit: a works may blow up (FIRE.blastMax), then each building
   * next door may catch (FIRE.spreadMax). Both chances rise with the time it has burned with no crew on it and drop to a
   * stray ember's once an engine crew is putting it out. Hashes of the tiles, the fire, the hour and the world seed, so
   * a run is the same for a given world. The warning fire and the demo's drills never roll (the drills are staged).
   */
  private hourly(f: Fire, b: Building, now: number) {
    const at = f.next!;
    f.next = at + TPH;
    if (f.warning || f.drill || !this.enabled) return;
    const crew = f.ph === FirePhase.Fighting && f.crew;
    if (f.ph !== FirePhase.Burning && !crew) return;
    const u = (now - f.t0) / Math.max(1, f.burn), mix = (this.w.seed * 2654435761) >>> 0, hr = Math.floor(at / TPH);
    if (f.bx === undefined && b.zone === Zone.Industrial) {
      const p = crew ? FIRE.blastAttended : FIRE.blastMax * fireRamp(u, FIRE.blastFrom, FIRE.blastPow);
      if (p > 0 && hash2(f.x * 7907 + f.id * 31 + (hr ^ mix), f.y * 6151 + hr * 4099 + (mix & 0xffff)) < p) { this.explode(f.x, f.y, { cause: 'industrial' }); return; }
    }
    const base = crew ? FIRE.spreadAttended : FIRE.spreadMax * fireRamp(u, FIRE.spreadFrom, FIRE.spreadPow);
    if (base <= 0) return;
    for (const [nb, diag] of this.neighbours(f, 1)) {
      const p = base * this.catchOf(nb) * (diag ? FIRE.diagonal : 1);
      if (hash2(nb.x * 48611 + f.id * 131 + (hr ^ mix), nb.y * 96769 + hr * 7349 + (mix & 0xffff)) >= p) continue;
      this.spreadTo(nb, 1);
    }
  }

  /** Light a building from a fire or a blast next door, inside the spread caps and the fairness rules (its owner's warning and grace). */
  private spreadTo(nb: Building, from: 1 | 2, drill = false): boolean {
    const key = tileKey(nb.x, nb.y), old = this.fires.get(key);
    if (!this.burnable(nb) || (old && old.ph !== FirePhase.Out)) return false;
    const owner = this.w.parcelAt(nb.x, nb.y)?.owner;
    if (!owner || (!drill && !this.ownerBurns(owner, this.w.tick))) return false;
    if (this.active >= FIRE.spreadWorld || this.ownerActive(owner) >= FIRE.spreadPerOwner) { this.stats.capped++; return false; }
    if (old && !drill) this.fires.delete(key); // over the aftermath of an earlier fire there (a drill lights over it by itself)
    return this.ignite(nb, { from, ...(drill ? { drill: true } : {}) });
  }

  /**
   * An explosion at the building at (x, y), whatever the cause (docs/incidents.md "Explosions"): the one entry point for
   * a burning works' blast (the hourly roll, the demo's drill) and for later causes (a gas leak, card 968d0d2f). The
   * cause's defaults (shared BLAST_CAUSES) can be overridden: `radius`, `damage` (1: destroyed outright), `costShare`;
   * `seed` sets the drawing's variation when the blast starts the fire (else it comes of the tile and the tick). A
   * building not already burning catches light with it. Returns false when nothing at (x, y) can burn, or it has blown
   * up already. The client draws the cause its own way (FireDTO.bc).
   */
  explode(x: number, y: number, opts: { cause: BlastCause; radius?: number; damage?: number; costShare?: number; seed?: number }): boolean {
    const w = this.w, key = tileKey(...w.doorOf(x, y)), b = w.buildings.get(key);
    if (!b) return false;
    let f = this.fires.get(key);
    if (f && f.ph !== FirePhase.Out && f.bx !== undefined) return false; // one blast to a fire
    if (!f || f.ph === FirePhase.Out) {
      if (!this.burnable(b)) return false;
      if (f) this.fires.delete(key); // over the aftermath of an earlier fire
      if (!this.ignite(b, { quiet: true, ...(opts.seed !== undefined ? { seed: opts.seed } : {}) })) return false;
      f = this.fires.get(key)!;
    }
    const d = BLAST_CAUSES[opts.cause];
    this.blast(f, b, w.tick, opts.cause, { radius: opts.radius ?? d.radius, damage: opts.damage ?? d.damage, costShare: opts.costShare ?? d.costShare, label: d.label });
    return true;
  }

  /**
   * The blast itself (explode): damage there and then (`damage` of it: an unattended fire carries on from that share
   * burnt, one being put out is held at it; 1 destroys the building and clears the lot), a bill of its own ('blast'),
   * and every building whose lot is within `radius` tiles catches light. A toast and a line in the owner's milestone
   * feed (net.ts). Drills cost nothing and destroy nothing.
   */
  private blast(f: Fire, b: Building, now: number, cause: BlastCause, spec: BlastSpec) {
    f.bx = now;
    if (cause !== 'industrial') f.cause = cause;
    this.stats.blasts++;
    const levelled = spec.damage >= 1 && !f.drill;
    if (levelled) { f.d = 1; f.levelled = true; }
    else if (f.ph === FirePhase.Fighting) {
      f.d = Math.max(f.d, spec.damage);
      f.t1 = Math.max(f.t1, now + Math.round(FIRE.fightHours * TPH * (0.4 + f.d) * 0.5));
      const v = f.engine !== null ? this.w.vehicles.get(f.engine) : undefined;
      if (v) v.until = Math.max(v.until, f.t1); // the crew stay on
    } else if (burntShare(now - f.t0, f.burn) < spec.damage) {
      f.t0 = now - Math.round(f.burn * Math.pow(Math.min(0.99, spec.damage), 1 / FIRE.growth)); // the client reads the jump off the clock (fireProgress)
    }
    const round = this.neighbours(f, spec.radius); // before the source goes (a destroyed merged building breaks back into lots)
    const cost = f.drill ? 0 : Math.round(spec.costShare * buildingValue(b.id, b.level));
    if (cost > 0) { this.w.credit(f.owner, -cost, 'blast'); f.blastCost = cost; this.stats.blastCost += cost; }
    if (levelled) this.finish(f, now, b);
    let lit = 0;
    for (const [nb] of round) if (this.spreadTo(nb, 2, !!f.drill)) lit++;
    if (!f.drill) this.onStory?.({ phase: 'explosion', id: f.id, x: f.x, y: f.y, owner: f.owner, kind: b.id, cause, lit, ...(levelled ? { levelled: true } : {}) });
    if (!f.drill && f.owner !== 'sys') {
      const what = this.name(b), set = lit ? `${lit} building${lit === 1 ? '' : 's'} round it caught light` : 'nothing round it caught light';
      const at = `${spec.label} at the ${levelled ? '' : 'burning '}${what} at (${f.x}, ${f.y})`;
      this.notices.push({ owner: f.owner, msg: `${at}: ${levelled ? 'destroyed, ' : ''}${set}${cost ? `, $${cost.toLocaleString('en-GB')} of blast damage` : ''}`,
        feed: `${spec.label} at the ${what} at (${f.x}, ${f.y}): ${levelled ? 'destroyed, ' : ''}${set}` });
    }
    this.touch(f);
  }

  /**
   * The buildings whose lots come within `reach` tiles of the fire's (1: touching it, corners included), each once, and
   * whether it touches only at a corner. Roads, parks and empty lots hold no building: a lot across a road is two away.
   */
  private neighbours(f: Fire, reach: number): [Building, boolean][] {
    const w = this.w, [ax, ay, fw, fh] = this.rect(f.x, f.y);
    const out: [Building, boolean][] = [], seen = new Set<string>([tileKey(f.x, f.y)]);
    for (let y = ay - reach; y < ay + fh + reach; y++) for (let x = ax - reach; x < ax + fw + reach; x++) {
      if (x >= ax && x < ax + fw && y >= ay && y < ay + fh) continue;
      const k = tileKey(...w.doorOf(x, y));
      if (seen.has(k)) continue;
      seen.add(k);
      const nb = w.buildings.get(k);
      if (!nb || nb.level <= 0) continue;
      const [bx, by, bw, bh] = this.rect(nb.x, nb.y);
      const overlapX = bx < ax + fw && ax < bx + bw, overlapY = by < ay + fh && ay < by + bh;
      out.push([nb, !overlapX && !overlapY]);
    }
    return out;
  }
  /** a building's footprint: x, y, width, height */
  private rect(x: number, y: number): [number, number, number, number] {
    const s = this.w.auxAt(x, y) ? this.w.structureAt(x, y) : null;
    return s ? [s.ax, s.ay, s.w, s.h] : [x, y, 1, 1];
  }
  /** how readily a neighbour takes (FIRE.catchByLevel): by its level, a merged building (a terrace, a tower, a works) as the top */
  private catchOf(b: Building) {
    const c = FIRE.catchByLevel;
    return isMergedKind(b.id) ? c[c.length - 1] : c[Math.max(0, Math.min(c.length - 1, b.level - 1))];
  }

  /** The fire is out: the damage, the bill, the notice. `b` null: the building went some other way. */
  private finish(f: Fire, now: number, b: Building | null) {
    const w = this.w;
    f.ph = FirePhase.Out; f.t1 = now; f.engine = null; f.onFoot = undefined; f.hose = undefined;
    if (f.drill) this.drillOut.set(tileKey(f.x, f.y), now);
    if (!b) { f.out = FireOutcome.Saved; f.lost = 0; this.stats.gone++; this.onStory?.({ phase: 'out', id: f.id, x: f.x, y: f.y, owner: f.owner, kind: f.kind, outcome: f.out, lost: 0 }); this.touch(f); return; }
    const burnt = (f.levelled && !f.drill) || (f.d >= 1 && !f.crew && !f.warning && !f.drill);
    const lost = f.drill || f.warning ? 0 : burnt ? b.level : Math.floor(b.level * f.d);
    const cost = f.drill ? 0 : Math.round(FIRE.costShare * buildingValue(b.id, b.level) * (burnt ? 1 : f.d));
    f.out = burnt ? FireOutcome.Burnt : lost > 0 ? FireOutcome.Partial : FireOutcome.Saved;
    f.lost = lost; f.cost = cost;
    this.stats[burnt ? 'burnt' : lost > 0 ? 'partial' : 'saved']++;
    this.stats.cost += cost;
    if (cost > 0) w.credit(f.owner, -cost, 'fire');
    const what = this.name(b);
    if (burnt) {
      this.born.delete(tkey(b.x, b.y));
      const s = isMergedKind(b.id) ? w.structureAt(b.x, b.y) : null;
      if (s) w.removeStructure(s); // a merged building breaks back into empty lots of its zone
      else w.setTile(b.x, b.y, withConstruction(withLevel(w.getTile(b.x, b.y), 0), false));
    } else if (lost > 0) {
      const to = Math.max(isMergedKind(b.id) ? firstLevelOf(b.id) : 1, b.level - lost);
      f.lost = b.level - to;
      if (to < b.level) w.setTile(b.x, b.y, withConstruction(withLevel(w.getTile(b.x, b.y), to), false));
    }
    // a fire put out with nothing lost tells nobody (the badge clears, the bill is in the ledger): the toasts stay few
    if (!f.drill && f.owner !== 'sys' && (burnt || f.lost || f.warning)) {
      const bill = cost > 0 ? `, $${cost.toLocaleString('en-GB')} of damage` : '';
      this.notices.push({ owner: f.owner, msg: f.levelled
        ? `The ${what} at (${f.x}, ${f.y}) was destroyed${bill}; the lot will be rebuilt`
        : burnt
        ? `The ${what} at (${f.x}, ${f.y}) burnt down${bill}: no engine came. A fire post covers 14 tiles; the lot will be rebuilt`
        : f.lost ? `Fire out at the ${what} at (${f.x}, ${f.y}): ${f.lost} level${f.lost === 1 ? '' : 's'} lost${bill}`
          : `Fire out at the ${what} at (${f.x}, ${f.y})${f.crew ? ' before it spread' : ': the bucket chain saved it'}${bill}` });
    }
    this.onStory?.({ phase: 'out', id: f.id, x: f.x, y: f.y, owner: f.owner, kind: f.kind, outcome: f.out, lost: f.lost ?? 0, crew: f.crew, ...(f.drill ? { drill: true } : {}) });
    this.touch(f);
  }

  /**
   * The engine has arrived: it stands at the kerb of the road tile before the door, facing the fire, lights on, and is
   * drawn there while the crew work (Simulation.agents shows a parked engine on a call). Returns where the hose plays from.
   */
  private pullUp(v: { x: number; y: number; path: number[] }): [number, number] {
    const p = v.path, n = p.length / 2;
    if (n >= 2) {
      const rx = p[(n - 2) * 2], ry = p[(n - 2) * 2 + 1], bx = p[(n - 1) * 2], by = p[(n - 1) * 2 + 1];
      v.x = rx + 0.5 + 0.28 * Math.sign(bx - rx); v.y = ry + 0.5 + 0.28 * Math.sign(by - ry);
    }
    return [v.x, v.y];
  }
  private touch(f: Fire) { this.changed = true; this.issues?.fireChanged(f.x, f.y); this.onChange?.(f.x, f.y); }
  /** a lot's family base kind reads as what it is (KIND_NAMES has 'residential'); a merged or placed kind its own name */
  private name(b: Building) { return BASE_NAMES[b.id] ?? KIND_NAMES[b.id] ?? 'building'; }

  private save(): FireSave {
    const born: [number, number, number][] = [];
    for (const [k, t] of this.born) { const [x, y] = untkey(k); born.push([x, y, t]); }
    return { fires: [...this.fires.values()].map((f) => ({ ...f, engine: null })), born, players: this.players, nextId: this.nextId };
  }
}
