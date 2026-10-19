import {
  FIRE, FirePhase, FireOutcome, burntShare, TICKS_PER_HOUR, TICKS_PER_DAY, SERVICE_RADIUS_OF, PATROL_RATE_OF, KIND_NAMES, Zone, TECH_BY_ID,
  hash2, tileKey, capacityOf, isGrowableId, isMergedKind, firstLevelOf, leisureAt, buildingValue, withLevel, withConstruction,
  type FireDTO, type HintId,
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
  /** the owner's warning fire: never worse than the bucket chain leaves it */
  warning?: boolean;
  /** a demo's fire drill (FIRE.drillGapHours): it lights again after it is out, and costs nothing */
  drill?: boolean;
  out?: number; lost?: number; cost?: number;
  w: number; h: number;
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
export interface FireNotice { owner: string; msg: string; hint?: HintId }

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
  /** self-timing for the load test */
  ms = 0; ticks = 0;
  /** counters since start, for the probes: fires lit, by outcome, engines sent, engines that arrived */
  stats = { lit: 0, warning: 0, saved: 0, partial: 0, burnt: 0, gone: 0, engines: 0, arrived: 0, cost: 0 };
  /** fired after any fire starts, changes phase or goes out (game.ts points it at Issues.fireChanged) */
  onChange: ((x: number, y: number) => void) | null = null;

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
        ...((f.engine !== null || f.onFoot !== undefined) && f.ph === FirePhase.Burning ? { eng: 1 } : {}), ...(f.out !== undefined ? { out: f.out } : {}) });
    }
    return out;
  }

  /** What a building's tooltip says while it burns, or null. */
  describe(x: number, y: number): string | null {
    const f = this.fires.get(tileKey(x, y));
    if (!f) return null;
    if (f.ph === FirePhase.Burning) return f.station ? 'On fire: the fire crew are on their way' : f.warning ? 'On fire: the neighbours are fighting it with buckets' : 'On fire, with no engine in reach: it will burn down';
    if (f.ph === FirePhase.Fighting) return f.crew ? 'On fire: the fire crew are putting it out' : 'On fire: the bucket chain has it under control';
    return f.out === FireOutcome.Burnt ? 'Burnt out' : f.out === FireOutcome.Partial ? `Fire damage: ${f.lost} level${f.lost === 1 ? '' : 's'} lost` : 'A fire here was put out';
  }

  /** Start a fire at a building now (probes, the demo drill, a dev action). Returns false when it cannot burn. */
  ignite(b: Building, opts: { warning?: boolean; drill?: boolean } = {}): boolean {
    const w = this.w, key = tileKey(b.x, b.y);
    if (this.fires.has(key) || b.level <= 0 || w.buildings.get(key) !== b) return false;
    const owner = w.parcelAt(b.x, b.y)?.owner;
    if (!owner) return false;
    const now = w.tick, seed = hash2(b.x * 31 + now % 9973, b.y * 17 + 3);
    const s = w.structureAt(b.x, b.y);
    const f: Fire = {
      id: this.nextId++, x: b.x, y: b.y, owner, kind: b.id, level: b.level,
      t0: now, burn: Math.round(FIRE.burnHours * TPH * (0.85 + 0.35 * hash2(b.y * 7 + 1, b.x * 13 + now % 7919))), seed,
      ph: FirePhase.Burning, engine: null, station: null, tries: 0, d: 0, ta: 0, t1: 0, crew: false,
      ...(opts.warning ? { warning: true } : {}), ...(opts.drill ? { drill: true } : {}),
      w: s ? s.w : 1, h: s ? s.h : 1,
    };
    this.fires.set(key, f);
    this.stats.lit++;
    if (opts.warning) this.stats.warning++;
    this.dispatch(f);
    const what = this.name(b);
    if (!opts.drill && owner !== 'sys') {
      const help = f.station ? `the crew from the ${KIND_NAMES[w.buildings.get(tileKey(...f.station!))?.id ?? Zone.Fire]} is on its way`
        : f.warning ? 'no engine is in reach, so the neighbours are fighting it with buckets. Next time there may be nobody to help: a fire post covers 14 tiles'
          : 'no staffed fire post or station is in reach: it will burn down';
      this.notices.push({ owner, msg: `Fire at the ${what} at (${b.x}, ${b.y}): ${help}`, ...(f.warning ? { hint: 'fire' as const } : {}) });
    }
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
    const d = burntShare(now - f.t0, f.burn);
    if (f.ph === FirePhase.Burning) {
      if (f.onFoot !== undefined) {
        if (now >= f.onFoot) {
          f.ph = FirePhase.Fighting; f.ta = now; f.d = Math.max(d, FIRE.minDamage); f.crew = true; f.onFoot = undefined;
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
          f.t1 = now + Math.round(FIRE.fightHours * TPH * (0.4 + d));
          v.until = Math.max(v.until, f.t1); // the crew stay until it is out
          this.stats.arrived++;
          this.touch(f);
          return;
        }
      } else if (now % 25 === 0 && f.tries < MAX_TRIES) { this.dispatch(f); if (f.engine !== null || f.onFoot !== undefined) this.touch(f); } // a station staffed since (a shift came on)
      if (f.engine === null && f.warning && d >= FIRE.bucketAt) {
        f.ph = FirePhase.Fighting; f.ta = now; f.d = Math.max(d, FIRE.minDamage); f.t1 = now + Math.round(FIRE.fightHours * TPH * 0.5);
        this.touch(f);
        return;
      }
      if (d >= 1) { f.d = 1; this.finish(f, now, b); }
      return;
    }
    if (now >= f.t1) this.finish(f, now, b);
  }

  /** The fire is out: the damage, the bill, the notice. `b` null: the building went some other way. */
  private finish(f: Fire, now: number, b: Building | null) {
    const w = this.w;
    f.ph = FirePhase.Out; f.t1 = now; f.engine = null; f.onFoot = undefined;
    if (f.drill) this.drillOut.set(tileKey(f.x, f.y), now);
    if (!b) { f.out = FireOutcome.Saved; f.lost = 0; this.stats.gone++; this.touch(f); return; }
    const burnt = f.d >= 1 && !f.crew && !f.warning;
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
      this.notices.push({ owner: f.owner, msg: burnt
        ? `The ${what} at (${f.x}, ${f.y}) burnt down${bill}: no engine came. A fire post covers 14 tiles; the lot will be rebuilt`
        : f.lost ? `Fire out at the ${what} at (${f.x}, ${f.y}): ${f.lost} level${f.lost === 1 ? '' : 's'} lost${bill}`
          : `Fire out at the ${what} at (${f.x}, ${f.y})${f.crew ? ' before it spread' : ': the bucket chain saved it'}${bill}` });
    }
    this.touch(f);
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
