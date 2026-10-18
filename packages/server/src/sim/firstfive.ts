import { CitizenState, LifeStage, START_TUNING, TICKS_PER_DAY, TICKS_PER_HOUR, Zone, CAMP_KIND, capacityOf, tileKey, nameFor } from '@msimcity/shared';
import type { Building, Citizen, World } from '../world';
import { tkey } from '../world';
import type { Gate, Gateways } from './gateways';
import { LIFE } from './life';
import { pathBetween } from '../pathfinding';

const S = CitizenState;

/** What FirstFive borrows from the Simulation: its private steps, passed in as closures. */
export interface FirstFiveDeps {
  /** a newcomer moves straight into `home` (no gateway) */
  spawn(home: Building): void;
  /** a newcomer for `home` appears on the road at (x, y) and travels there with their luggage (Simulation.arriveVia through `roadGate`) */
  arriveFrom(home: Building, x: number, y: number): void;
  /** `c` takes a job at `b`, with this walking route */
  hire(c: Citizen, b: Building, commute: number[]): void;
  /** may `c` take a place at `b` (room, and from Education E4 the skill gate) */
  canTake(c: Citizen, b: Building): boolean;
  /** `c` moves into `to`, keeping household `hh` (they are at home or at work) */
  moveHome(c: Citizen, to: Building, hh: number): void;
  /** the road entries through-traffic uses (Simulation.entries): the farthest road tiles, or the motorway gates */
  entries(): readonly [number, number][];
}

/** A settler of a camp's road wave, due to set off from the road end (x, y). */
interface RoadWave { home: Building; x: number; y: number; due: number }

/**
 * The first five minutes of a new player (docs/first-five.md):
 *
 * - **the pioneer camp**: when one is pitched (net.ts; it opens at once) every free bed gets a newcomer straight away,
 *   through the nearest gate on a one-off allowance (`Gateways.wave`), or with no gate up the road from the nearest
 *   road end far enough away to be seen coming (`roadGate`, Simulation.arriveVia), or in place when there is no road
 *   end either (`campPitched`); bulldozing it rehomes its people in free beds nearby (`campCleared`); a settler at the
 *   camp moves into a finished home nearby in time, so the camp is a transit camp, not a slum (`campStep`);
 * - **the instant crew**: a player's first builders' yard opens at once (net.ts); it hires people out of work within
 *   reach on the spot, camp settlers leave a far-off job for it, and for its first game day whoever it hires sets out
 *   for a shift now rather than at the next roster start (`starterYard`, `hired`);
 * - **the first settlers**: the first newcomer to move in on the land of an owner with nobody housed yet is queued in
 *   `settlers` for the camera moment (net.ts sends it once per player, server goals.ts keeps the flag).
 *
 * The Simulation keeps one of these and calls it from one-line hooks (tick, hire, spawnCitizen, migrantHome, lifeStep).
 */
export class FirstFive {
  /** First settlers on an owner's land (net.ts drains it each tick): the camp (or home) and who came first. */
  settlers: { owner: string; x: number; y: number; who: string }[] = [];
  /** Starter yards (tkey of the door) and the tick until which anyone they hire starts a shift at once. */
  private quick = new Map<number, number>();
  /** Camp settlers still to set off up the road (no gate in town). */
  private waves: RoadWave[] = [];

  constructor(private w: World, private gateways: Gateways, private d: FirstFiveDeps) {}

  /**
   * A pioneer camp has just been pitched with its door at (x, y): a newcomer for every free bed now, bypassing
   * spawn()'s 25% roll and its vacant-jobs test (the settlers are the workforce for the player's yard and first shops).
   * Through the nearest gate they are due within START_TUNING.campWaveHours; with no gate they come up the road from
   * a road end at least campWalkMin tiles away over the same spread; with neither they move in at once. Returns how.
   */
  campPitched(x: number, y: number): 'gate' | 'road' | 'place' | 'none' {
    const b = this.w.buildings.get(tileKey(x, y));
    if (!b || b.id !== CAMP_KIND || b.level === 0) return 'none';
    const free = capacityOf(b.id, b.level) - b.occupants - this.gateways.pendingAt(b.x, b.y);
    if (free <= 0) return 'none';
    const within = Math.max(1, Math.round(START_TUNING.campWaveHours * TICKS_PER_HOUR));
    if (this.gateways.wave(b, free, within)) return 'gate';
    const from = this.roadEnd(b);
    if (from) {
      for (let i = 0; i < free; i++) this.waves.push({ home: b, x: from[0], y: from[1], due: this.w.tick + Math.floor(((i + Math.random()) / free) * within) });
      this.gateways.reserve(b.x, b.y, free); // spawn() sees the beds as spoken for meanwhile
      return 'road';
    }
    for (let i = 0; i < free; i++) this.d.spawn(b);
    return 'place';
  }

  /** The road end settlers come from: the nearest entry at least campWalkMin tiles from the camp, else the farthest one at all. */
  private roadEnd(b: Building): [number, number] | null {
    let best: [number, number] | null = null, bestD = Infinity, far: [number, number] | null = null, farD = -1;
    for (const e of this.d.entries()) {
      const d = Math.abs(e[0] - b.x) + Math.abs(e[1] - b.y);
      if (d >= START_TUNING.campWalkMin && d < bestD) { bestD = d; best = e; }
      if (d > farD) { farD = d; far = e; }
    }
    return best ?? (farD >= 4 ? far : null);
  }

  /** Once a tick (Simulation.tick, after the gateways): settlers whose time has come set off up the road. */
  tick() {
    if (!this.waves.length) return;
    const now = this.w.tick;
    for (let i = 0; i < this.waves.length;) {
      const q = this.waves[i];
      if (q.due > now) { i++; continue; }
      this.waves[i] = this.waves[this.waves.length - 1]; this.waves.pop();
      this.gateways.release(q.home.x, q.home.y);
      if (this.w.buildings.get(tileKey(q.home.x, q.home.y)) !== q.home) continue; // the camp went meanwhile
      this.d.arriveFrom(q.home, q.x, q.y);
    }
  }

  /**
   * A gate that is only a point on the road at (x, y): Simulation.arriveVia plans the trip home from it as from a
   * motorway connection (their own car with a roof box, or on foot with a suitcase). Key -1 marks it for the counts.
   */
  roadGate(x: number, y: number): Gate {
    return {
      key: -1, x, y, kind: -1, spec: { kind: -1, type: 'motorway', modes: ['car', 'foot'], perHour: 0, needsWater: false },
      fx: x, fy: y, tokens: 0, last: this.w.tick, queue: [], day: 0, inToday: 0, outToday: 0, inYesterday: 0, outYesterday: 0,
    };
  }

  /**
   * The camp at (x, y) (any of its tiles) is about to be bulldozed: everyone at home or at work there moves into a free
   * bed nearby, found as the life step's move-out does; whoever finds none is evicted with the camp, as from any home.
   */
  campCleared(x: number, y: number) {
    const w = this.w;
    const [dx, dy] = w.doorOf(x, y);
    const b = w.buildings.get(tileKey(dx, dy));
    if (!b || b.id !== CAMP_KIND) return;
    for (const c of [...w.citizens.values()]) {
      if (c.hx !== b.x || c.hy !== b.y || c.mig || (c.state !== S.Home && c.state !== S.Work)) continue;
      const to = this.bedNear(b, 1);
      if (to) this.d.moveHome(c, to, c.hh);
    }
  }

  /**
   * One life step a game day for a citizen at home (Simulation.lifeStep): a camp settler moves into a finished home
   * with room nearby, taking a partner who lives with them along, with START_TUNING.campMoveOutPerDay a day. True
   * when they moved.
   */
  campStep(c: Citizen): boolean {
    const w = this.w;
    if (c.mig || c.stage === LifeStage.Child) return false;
    const home = w.buildings.get(tileKey(c.hx, c.hy));
    if (!home || home.id !== CAMP_KIND || Math.random() >= START_TUNING.campMoveOutPerDay) return false;
    const partner = c.partner ? w.citizens.get(c.partner) : undefined;
    const together = partner && partner.hx === c.hx && partner.hy === c.hy && !partner.mig && (partner.state === S.Home || partner.state === S.Work) ? partner : null;
    const to = this.bedNear(home, together ? 2 : 1);
    if (!to) return false;
    this.d.moveHome(c, to, c.hh);
    if (together) this.d.moveHome(together, to, c.hh);
    return true;
  }

  /** A finished home (not a camp) with `beds` free within the move-out radius of `from`, beside a road, nearer preferred. */
  private bedNear(from: Building, beds: number): Building | null {
    const w = this.w;
    return w.bestBuiltNear(from.x, from.y, [Zone.Residential], LIFE.moveOutRadius, 6,
      (h, d) => (h !== from && h.id !== CAMP_KIND && h.occupants + beds <= capacityOf(h.id, h.level) ? 6 * Math.random() - d : null), (h) => w.hasRoadAccess(h.x, h.y));
  }

  /**
   * A player's first builders' yard has just opened at once with its door at (x, y). For START_TUNING.starterCrewDays
   * whoever it hires sets out for a shift at once (`hired`). Adults out of work within starterCrewRadius tiles, nearest
   * first, are hired now rather than at their next hourly look for work, and camp settlers whose job is more than
   * starterCrewSwitchDist tiles away leave it for the yard (they came to build this town). Returns how many were hired,
   * and how many of those from a camp (the toast's wording).
   */
  starterYard(x: number, y: number): { hired: number; camp: number } {
    const w = this.w;
    const b = w.buildings.get(tileKey(x, y));
    if (!b || b.zone !== Zone.Yard || b.level === 0) return { hired: 0, camp: 0 };
    this.quick.set(tkey(x, y), w.tick + Math.round(START_TUNING.starterCrewDays * TICKS_PER_DAY));
    const r = START_TUNING.starterCrewRadius, dist = (c: Citizen) => Math.abs(c.hx - x) + Math.abs(c.hy - y);
    const far = (c: Citizen) => Math.abs(c.wx - c.hx) + Math.abs(c.wy - c.hy) > START_TUNING.starterCrewSwitchDist;
    const inCamp = (c: Citizen) => w.buildings.get(tileKey(c.hx, c.hy))?.id === CAMP_KIND;
    const cands = [...w.citizens.values()]
      .filter((c) => !c.study && !c.mig && c.stage === LifeStage.Adult && c.state === S.Home && dist(c) <= r && (!c.job || (inCamp(c) && far(c))))
      .sort((a, c) => dist(a) - dist(c));
    let hired = 0, camp = 0;
    for (const c of cands) {
      if (!this.d.canTake(c, b)) break;
      const path = pathBetween(w, c.hx, c.hy, b.x, b.y);
      if (!path) continue;
      if (c.job) w.quitJob(c);
      if (inCamp(c)) camp++;
      this.d.hire(c, b, path);
      hired++;
    }
    return { hired, camp };
  }

  /** Called at the end of every hire: taken on by a starter yard in its first day, they set out now (a full shift from now). */
  hired(c: Citizen, b: Building) {
    if (!this.quick.size) return;
    const k = tkey(b.x, b.y), until = this.quick.get(k);
    if (until === undefined) return;
    if (until < this.w.tick) { this.quick.delete(k); return; }
    if (c.state === S.Home && !c.mig) c.nextAt = this.w.tick; // depart() on the next tick; anyone out keeps the roster
  }

  /** Called when a newcomer moves in: the first on the land of an owner with nobody housed yet. */
  settled(c: Citizen) {
    const w = this.w;
    if (w.filling) return;
    const owner = w.parcelAt(c.hx, c.hy)?.owner;
    if (!owner || this.settlers.some((s) => s.owner === owner)) return;
    const p = w.players.get(owner);
    if (!p || p.progress.housed > 0) return;
    const home = w.buildings.get(tileKey(c.hx, c.hy));
    const more = home ? capacityOf(home.id, home.level) - 1 : 0; // the rest of the camp's wave is behind them
    const name = nameFor(c.id);
    const who = home?.id === CAMP_KIND && more > 0 ? `Your first settlers are here: ${name} and ${more} more are pitching camp` : `Your first resident is here: ${name} has moved in`;
    this.settlers.push({ owner, x: c.hx, y: c.hy, who });
  }
}
