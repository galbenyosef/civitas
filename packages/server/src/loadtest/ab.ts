/**
 * Offline traffic A/B harness.
 *
 *   npx tsx packages/server/src/loadtest/ab.ts --hour 8 --ticks 1500 --set stuckLimit=150,signalT=0
 *
 * Builds a 1×1 Commons (seedCity, built 3), runs it from midnight to the given hour of the second day (about
 * 1.3 game days at 08:00, by when the population has settled), then measures `--ticks` ticks. Everything is
 * deterministic for a given --seed: Math.random is replaced by a seeded generator before the world is built.
 * `--set` overrides TRAFFIC_TUNING (shared/src/tuning.ts) for the whole run, fill included; `old=1` first restores
 * the rules as they were before the tuning (OLD_RULES); `smooth=0` turns the smooth-flow rules off (UNSMOOTH); `carOwnership=0.55` also changes who owns a car (office
 * workers +0.15); `noLots=1` builds the city without its four parking lots; `noSignals=1` takes the signals technology
 * away (every junction is give-way); `ring=1` adds a public ring road two tiles outside the district, joined to the end
 * of every street; `bus=N` lays a bus network on the Commons (a depot and twelve stops on two lines, docs/transit.md) with
 * N buses per line (`busFare=…` changes the fare; `busTiles=1` lays the depot and stops but runs no lines, the control
 * for the homes and jobs they take); `districts=2` builds a 2×2 city instead (the tick-cost check); `avenues=2` makes each district's doubled
 * edge roads avenues, `avenues=1` also widens its middle streets into avenues over the lots beside them; `oneway=1` makes its inner streets
 * one-way, alternating (road classes, docs/roads.md); `edu=0` turns off education's effects on jobs (sim/skills.ts, the E4 control). Reports: vehicle-weighted mean speed, queued share,
 * give-ups by kind (Traffic.counters), junction entries per tick, mean commute time, and true body overlaps
 * every tick (oriented rectangles VEHICLE_LEN × VEHICLE_WIDTH with the heading from the lane geometry, and
 * pedestrians as 0.07-radius discs; the same test as the live probe-obb.mjs).
 * Options: --hour H (default 8), --ticks N (1500), --seed S (1), --set k=v,..., --then k=v,... (changed after the fill, for the
 * measured window only: a tick-cost comparison on the same traffic), --label L, --json FILE, --quiet.
 */
import { writeFileSync } from 'node:fs';
import { DRIVE_SPEED, TICKS_PER_DAY, TICKS_PER_HOUR, TRAFFIC_TUNING, VEHICLE_LEN, VEHICLE_WIDTH, CitizenState as S, Zone, Terrain, TECH, TRANSIT, VehicleClass, BUS_STOP_KIND, BUS_DEPOT_KIND, BIKE_CLASS, MOBILE, SKILLS, hash2, isRoad, packTile, terrainOf, familyOf, subFor, planStructure, roadDragPath, RoadCls, type TrafficTuning, type StopRef } from '@msimcity/shared';
import { World, tkey, type Citizen, type Mover } from '../world';
import { Simulation } from '../sim/simulation';
import { seedCity } from './cities';
import { layClass } from './classbench';

const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
/** smoothness thresholds, tiles per tick (full speed DRIVE_SPEED is 0.5): standing under STOP_V, moving again over MOVE_V */
const STOP_V = 0.01, MOVE_V = 0.05;
const PED_R = 0.07, W = VEHICLE_WIDTH, BIKE_W = 0.05;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const desc = (m: Mover) => `#${m.id} (${m.x.toFixed(2)},${m.y.toFixed(2)}) lane ${Math.floor(m.lane / 4) >= 0 ? `${Math.floor(m.lane / 4 / 65536) - 0x8000},${(Math.floor(m.lane / 4) % 65536) - 0x8000}` : '-'} d${m.lane % 4} path ${m.path.slice(Math.max(0, (m.pi - 1) * 2), m.pi * 2 + 4).join(',')} pi ${m.pi} prog ${m.prog.toFixed(2)} c${+m.committed} w${m.wait} s${m.stuck}`;
interface Body { m: Mover; x: number; y: number; hx: number; hy: number; len: number; wid: number }
/** Separating-axis test for two oriented rectangles. */
function obbOverlap(a: Body, b: Body): boolean {
  const axes = [[a.hx, a.hy], [-a.hy, a.hx], [b.hx, b.hy], [-b.hy, b.hx]];
  const corners = (o: Body) => {
    const ux = o.hx * o.len / 2, uy = o.hy * o.len / 2, vx = -o.hy * o.wid / 2, vy = o.hx * o.wid / 2;
    return [[o.x + ux + vx, o.y + uy + vy], [o.x + ux - vx, o.y + uy - vy], [o.x - ux + vx, o.y - uy + vy], [o.x - ux - vx, o.y - uy - vy]];
  };
  const ca = corners(a), cb = corners(b);
  for (const [ax, ay] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, y] of ca) { const p = x * ax + y * ay; if (p < amin) amin = p; if (p > amax) amax = p; }
    for (const [x, y] of cb) { const p = x * ax + y * ay; if (p < bmin) bmin = p; if (p > bmax) bmax = p; }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}
function pointInObb(px: number, py: number, o: Body): boolean {
  const dx = px - o.x, dy = py - o.y;
  const along = dx * o.hx + dy * o.hy, across = -dx * o.hy + dy * o.hx;
  return Math.abs(along) < o.len / 2 + PED_R && Math.abs(across) < o.wid / 2 + PED_R;
}

export interface AbResult {
  label: string; set: Record<string, number>; hour: number; ticks: number; seed: number;
  citizens: number; carOwners: number;
  speedPct: number; queuedPct: number; peakCars: number; peakQueuedPct: number; firstHourQueuedPct: number; firstHourSpeedPct: number;
  giveUps: number; visibleGiveUps: number;
  counters: Record<string, number>;
  junctionEntriesPerTick: number;
  commutes: number; commuteMean: number; driveCommuteMean: number;
  ccPerTick: number; cpPerTick: number; ccTicks: number; cpTicks: number; ccDrawnPerTick: number; cpDrawnPerTick: number;
  cpWhere: Record<string, number>; ccWhere: Record<string, number>;
  examples: string[];
  wallSec: number; simMsPerTick: number;
  /** trips planned in the window by mode, and the share by transit; every trip's door-to-door ticks (mean), those that rode */
  modes: { walk: number; drive: number; transit: number; transitShare: number };
  trips: number; tripMean: number; transitTrips: number; transitTripMean: number;
  /** cars on the road per tick (citizens driving plus non-bus vehicles), mean and peak; buses on the road, mean */
  carsMean: number; carsPeak: number; busesMean: number;
  /** body overlaps involving a bus (counted inside car-car too) */
  busCarPerTick: number;
  /** transit counters over the window (boarded, got off, gave up waiting, buses withdrawn …) */
  transit: Record<string, number>;
  /** re-routes in the window by kind (held up / running late / forced), searches tried for lateness, cars that drove, the most one citizen was re-routed in a day */
  reroute: { slow: number; late: number; forced: number; lateTried: number; cars: number; perCar: number; maxPerCitizenDay: number };
  /** driven legs that ended in the window: count, mean elapsed / expected ratio, 50th and 90th percentile of it, share running late by the delayFrac / delayMinTicks test */
  legs: { n: number; ratioMean: number; ratioP50: number; ratioP90: number; lateShare: number; ticksMean: number };
  /** mobile jobs over the window (docs/mobile-jobs.md): fleet vehicles on the road per tick, and each service's counters */
  /**
   * Smoothness (docs/traffic-tuning.md "Smooth flow"), from each road vehicle's drawn position tick to tick (distance per
   * tick in tiles, the speed a player sees): tiles driven; stops (speed falls under STOP_V after being over MOVE_V since
   * the last stop) and stops per 10 tiles; dead stops (from at least half of full speed to a stop in one tick); mean
   * |Δv| per car-tick (jerk) in tiles per tick, and the share of car-ticks with |Δv| over a fifth of full speed (harsh);
   * the share of car-ticks standing (speed under STOP_V), and of those not the first car at a junction's or a level
   * crossing's stop line (standing in the stream).
   */
  smooth: { stopsAt: Record<string, number>; tiles: number; stops: number; stopsPer10: number; deadStops: number; jerk: number; harshPct: number; standPct: number; standStreamPct: number; carTicks: number };
  mobile: { onRoadMean: number; bikesCarOverlaps: number; bikePedContacts: number; fleetPedContacts: number; fleetPedWhere: Record<string, number>; taxi: Record<string, number>; food: Record<string, number>; bins: Record<string, number>; parcels: Record<string, number>; foodMinutes: number[] };
}

/**
 * The traffic rules as they were before docs/traffic-tuning.md (`--set old=1`, then any later keys on top). One fix
 * is not switchable and is in both: a re-route never sends a car back through the tile behind it (a U-turn).
 */
export const OLD_RULES: Partial<TrafficTuning> = {
  stuckLimit: 75, stuckClock: 0, stuckReroute: 0, rerouteAt: 0, stuckKerb: 0, abandonAfter: 0,
  signalT: 1, signalPeriod: 30, signalAmber: 2, signalActuated: 0,
  sameApproachRelax: 0, boxByCommit: 0, conflictRemaining: 0, arcAware: 0, forecourtConflict: 0, boxClear: 0, passStationary: 0,
  spawnClear: 0, meterCongestion: 1, laneByLength: 0, laneCap: 2, laneRoom: 1, congestionWeight: 4,
  carYieldMax: 15, crossingWaitMax: 20, crossingLag: 1, pedPriority: 0, pedSignalPatient: 0, pedYieldAfter: 0, pedPathClear: 0,
  bodyGuard: 0, carGuard: 0, guardWaitMax: 40, pedRetreatAfter: 0, pedBehind: 0, guardDrawn: 0,
  delayReroute: 0,
  follow: 0, platoon: 0, startGap: 0, lookAhead: 0, mainRoad: 0, greenWave: 0,
};
/** The smooth-flow rules (docs/traffic-tuning.md "Smooth flow") all off, as before 2026-10-21 (`--set smooth=0`). */
export const UNSMOOTH: Partial<TrafficTuning> = { follow: 0, platoon: 0, startGap: 0, lookAhead: 0, mainRoad: 0, greenWave: 0 };

/** Keys that change the test city rather than TRAFFIC_TUNING: car ownership, no parking lots, no signals technology. */
const CITY_KEYS = ['carOwnership', 'noLots', 'noSignals', 'ring', 'bus', 'busFare', 'busTiles', 'mobile', 'edu', 'districts', 'avenues', 'oneway'];

/**
 * A bus network on the Commons (local coordinates of the 22×22 district): a depot whose door faces the y=5 street;
 * line 1 a loop of six stops round the inner ring of streets (x 5 and 15, y 5 and 15), past the residential blocks
 * and the jobs in the middle; line 2 there and back from the north-west corner down the middle street (x=10) to the
 * south-west corner, six stops, within a short walk of line 1 at three places for changes. Every stop faces a plain
 * stretch of road. Returns the stop tiles of each line (world coordinates).
 */
export function layBusNetwork(w: World, x0: number, y0: number): { depot: [number, number]; lines: StopRef[][] } {
  const at = (lx: number, ly: number): [number, number] => [x0 + lx, y0 + ly];
  const clear = (x: number, y: number) => w.setTile(x, y, packTile(terrainOf(w.getTile(x, y)), false, 0, 0));
  // depot: footprint x 11..13, y 3..4 (door 12,4 facing the street at y=5)
  const [dx, dy] = at(12, 4);
  for (let y = dy - 1; y <= dy; y++) for (let x = dx - 1; x <= dx + 1; x++) clear(x, y);
  const v = planStructure(BUS_DEPOT_KIND, dx, dy, { tile: (x, y) => w.peekTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y), land: () => null });
  if (!v.ok) throw new Error(`bus depot: ${v.reason}`);
  w.placeStructure(v.placed, { work: 0, priority: 0, built: true });
  const stop = (lx: number, ly: number): StopRef => {
    const [x, y] = at(lx, ly);
    w.setTile(x, y, packTile(terrainOf(w.getTile(x, y)), false, familyOf(BUS_STOP_KIND), 1), subFor(BUS_STOP_KIND));
    return { x, y };
  };
  const ring = [stop(7, 4), stop(14, 6), stop(16, 12), stop(12, 16), stop(4, 12), stop(6, 7)];
  const cross = [stop(4, 2), stop(9, 2), stop(12, 9), stop(11, 13), stop(9, 17), stop(4, 17)];
  return { depot: [dx, dy], lines: [ring, cross] };
}

export function parseSet(spec: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!spec) return out;
  for (const kv of spec.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--set ${kv}: not a number`);
    if (k === 'old') { if (n) Object.assign(out, OLD_RULES); continue; }
    if (k === 'smooth') { if (!n) Object.assign(out, UNSMOOTH); continue; }
    if (!CITY_KEYS.includes(k) && !(k in TRAFFIC_TUNING)) throw new Error(`--set ${k}: unknown tunable (known: ${Object.keys(TRAFFIC_TUNING).join(', ')}, ${CITY_KEYS.join(', ')}, old)`);
    out[k] = n;
  }
  return out;
}

export function runAb(opts: { hour: number; ticks: number; seed: number; set: Record<string, number>; then?: Record<string, number>; label?: string; log?: (s: string) => void }): AbResult {
  const t0 = performance.now();
  const log = opts.log ?? (() => {});
  Math.random = mulberry32(opts.seed * 2654435761);
  for (const [k, v] of Object.entries(opts.set)) if (k in TRAFFIC_TUNING) (TRAFFIC_TUNING as Record<string, number>)[k] = v;
  MOBILE.on = opts.set.mobile !== 0; // mobile=0: no taxis, riders, bin lorries or couriers (docs/mobile-jobs.md), the control
  if (opts.set.edu === 0) SKILLS.on = false; // edu=0: no skill gate, wages, newcomer tilt or brain drain (docs/education.md), the control
  if (opts.set.carOwnership !== undefined) {
    const own = opts.set.carOwnership, office = Math.min(1, own + 0.15);
    World.prototype.ownsCar = (id: number, kind: number) => hash2(id, 41) < (kind === Zone.Office ? office : own);
  }

  const w = new World(opts.seed);
  const layout = seedCity(w, { districts: opts.set.districts ?? 1, built: 3, lots: !opts.set.noLots });
  if (opts.set.noSignals) for (const p of w.players.values()) p.tech = p.tech.filter((t) => !TECH.find((n) => n.id === t)?.unlocks.includes('signals'));
  if (opts.set.ring) {
    // a public ring road two tiles outside the district, joined to the end of every street: a parallel way round
    const { x0, y0, span } = layout, lo = -2, hi = span + 1;
    const road = (x: number, y: number) => w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0));
    for (let i = lo; i <= hi; i++) { road(x0 + i, y0 + lo); road(x0 + i, y0 + hi); road(x0 + lo, y0 + i); road(x0 + hi, y0 + i); }
    for (let i = 0; i < span; i++) {
      if (i % 5 !== 0 && i !== span - 1) continue;
      road(x0 + i, y0 - 1); road(x0 + i, y0 + span); road(x0 - 1, y0 + i); road(x0 + span, y0 + i);
    }
  }
  // road classes (R3, docs/roads.md "Classes"): every district's doubled edge roads (local 20 and 21) as avenues, and
  // with avenues=1 also its middle streets (10) widened into avenues over the lots beside them (11); oneway=1 makes the
  // inner streets (5, 10, 15) one-way, alternating, the edges staying two-way
  if (opts.set.avenues || opts.set.oneway) for (const d of layout.districts) {
    const L = (a: [number, number], b: [number, number], cls: number) => layClass(w, roadDragPath([d.x + a[0], d.y + a[1]], [d.x + b[0], d.y + b[1]]), cls);
    if (opts.set.avenues) {
      L([0, 21], [21, 21], RoadCls.Avenue); L([20, 0], [20, 21], RoadCls.Avenue); // drag row and its twin on the left: (y 21 east, 20 west), (x 20 south, 21 north)
      if (opts.set.avenues === 1) { L([0, 11], [21, 11], RoadCls.Avenue); L([10, 0], [10, 21], RoadCls.Avenue); }
    }
    if (opts.set.oneway) for (const [i, v] of [5, 10, 15].entries()) {
      L(i % 2 ? [21, v] : [0, v], i % 2 ? [0, v] : [21, v], RoadCls.OneWay);
      L(i % 2 ? [v, 21] : [v, 0], i % 2 ? [v, 0] : [v, 21], RoadCls.OneWay);
    }
  }
  const busNet = opts.set.bus || opts.set.busTiles ? layBusNetwork(w, layout.x0, layout.y0) : null;
  if (opts.set.busFare !== undefined) TRANSIT.fare = opts.set.busFare;
  for (const id of w.parcels.keys()) w.recountRoads(id);
  const sim = new Simulation(w);
  const tr = sim.traffic;
  if (busNet && opts.set.bus) busNet.lines.forEach((stops, i) => {
    const r = sim.transit.saveLine('sys', { number: i + 1, colour: i ? 0x2f8fd6 : 0xd94f4f, stops, loop: i === 0, vehicles: opts.set.bus });
    if (typeof r === 'string') throw new Error(`bus line ${i + 1}: ${r}`);
  });

  const start = DAY + Math.round(opts.hour * TPH);
  while (w.tick < start) sim.tick();
  // --then: tunables changed only for the measured window (the same city and traffic, for a fair tick cost)
  for (const [k, v] of Object.entries(opts.then ?? {})) if (k in TRAFFIC_TUNING) (TRAFFIC_TUNING as Record<string, number>)[k] = v;
  log(`[ab] filled to day ${Math.floor(w.tick / DAY)} ${opts.hour}:00, ${w.citizens.size} citizens`);

  const c0 = { ...tr.counters };
  let vehSum = 0, qSum = 0, spSum = 0, peakCars = 0, peakQ = 0;
  let fhV = 0, fhQ = 0, fhS = 0;
  let cc = 0, cp = 0, ccTicks = 0, cpTicks = 0, ccDrawn = 0, cpDrawn = 0;
  const cpWhere: Record<string, number> = {}, ccWhere: Record<string, number> = {};
  const examples: string[] = [];
  const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
  const started = new Map<number, { at: number; drove: boolean }>();
  const prevState = new Map<number, number>();
  const trips: number[] = [], driveTrips: number[] = [];
  const hd: [number, number] = [0, 0];
  const drove = new Set<number>();
  let maxDay = 0;
  const rl0 = { slow: sim.rerouteLog.slow, late: sim.rerouteLog.late, forced: sim.rerouteLog.forced, lateTried: sim.rerouteLog.lateTried };
  const m0 = { ...sim.modeLog }, t0s = { ...sim.transit.stats, ...prefix(sim.buses.stats, 'bus.') };
  const travel = (st: number) => st === S.ToWork || st === S.ToHome || st === S.ToSite || st === S.ToVenue;
  const allTrips: number[] = [], rideTrips: number[] = [], rode = new Set<number>();
  let carsSum = 0, carsPeak = 0, busesSum = 0, busCar = 0, fleetSum = 0, bikeCar = 0, bikePed = 0, fleetPed = 0;
  const fleetPedWhere: Record<string, number> = {};
  const mob0 = { taxi: { ...sim.taxis.stats }, food: { ...sim.delivery.stats }, bins: { ...sim.refuse.stats }, parcels: { ...sim.couriers.stats }, minutes: sim.delivery.minutes.length };
  sim.legSamples = [];
  // smoothness: each road vehicle's position and speed last tick, and whether it has moved off since its last stop
  let prevPos = new Map<number, { x: number; y: number; v: number; armed: boolean }>();
  let curPos = new Map<number, { x: number; y: number; v: number; armed: boolean }>();
  const stopsAt: Record<string, number> = {};
  let smTiles = 0, smStops = 0, smDead = 0, smJerk = 0, smJerkN = 0, smHarsh = 0, smStand = 0, smStream = 0, smN = 0;
  const smooth = (m: Mover) => {
    const p = prevPos.get(m.id);
    if (!p) { curPos.set(m.id, { x: m.x, y: m.y, v: -1, armed: false }); return; }
    const v = Math.hypot(m.x - p.x, m.y - p.y);
    if (v > 1) { curPos.set(m.id, { x: m.x, y: m.y, v: -1, armed: false }); return; } // a jump (a new trip): not driving
    let armed = p.armed || v >= MOVE_V;
    smTiles += v; smN++;
    if (v < STOP_V) {
      smStand++;
      if (!tr.headAtStopLine(m)) smStream++;
      if (p.armed) { smStops++; armed = false; if (p.v >= DRIVE_SPEED / 2) smDead++; bump(stopsAt, tr.standing(m)); }
    }
    if (p.v >= 0) { const dv = Math.abs(v - p.v); smJerk += dv; smJerkN++; if (dv > DRIVE_SPEED / 5) smHarsh++; }
    curPos.set(m.id, { x: m.x, y: m.y, v, armed });
  };

  let simMs = 0;
  for (let i = 0; i < opts.ticks; i++) {
    const ts = performance.now();
    sim.tick();
    simMs += performance.now() - ts;
    const v = tr.lastVehicles, q = tr.lastQueued, sp = tr.lastSpeedPct * v;
    vehSum += v; qSum += q; spSum += sp;
    if (v > peakCars) { peakCars = v; peakQ = v ? q / v : 0; }
    if (i < TPH) { fhV += v; fhQ += q; fhS += sp; }

    // commute times
    for (const c of w.citizens.values()) {
      const ps = prevState.get(c.id);
      if (c.leg?.ride) rode.add(c.id);
      if (ps !== undefined && travel(ps) && !travel(c.state)) {
        allTrips.push(w.tick - c.tripStart);
        if (rode.has(c.id)) rideTrips.push(w.tick - c.tripStart);
        rode.delete(c.id);
      }
      if (c.state !== ps) {
        if (c.state === S.ToWork && ps !== S.ToWork) started.set(c.id, { at: w.tick, drove: false });
        if (c.state === S.Work && ps === S.ToWork) {
          const s0 = started.get(c.id);
          if (s0) { trips.push(w.tick - s0.at); if (s0.drove) driveTrips.push(w.tick - s0.at); started.delete(c.id); }
        }
        prevState.set(c.id, c.state);
      }
      if (c.state === S.ToWork && c.leg?.drive) { const s0 = started.get(c.id); if (s0) s0.drove = true; }
      if (c.leg?.drive && c.lane >= 0) { drove.add(c.id); if (sim.rerouteLog.byDay.size) { const d = sim.reroutesOf(c).day; if (d > maxDay) maxDay = d; } }
    }

    for (const c of w.citizens.values()) if (c.leg?.drive && c.lane >= 0) smooth(c);
    for (const veh of w.vehicles.values()) if (veh.phase !== 'dwell' && veh.lane >= 0) smooth(veh);
    { const t = prevPos; prevPos = curPos; curPos = t; curPos.clear(); }

    // bodies this tick
    const cars: Body[] = [];
    const peds: Citizen[] = [];
    const drawn: Body[] = [];
    const addCar = (m: Mover) => {
      if (!tr.headingOf(m, hd)) return;
      const len = VEHICLE_LEN[m.cls] ?? VEHICLE_LEN[0], wid = m.cls === BIKE_CLASS ? BIKE_W : W; // a delivery bike and rider are narrow
      cars.push({ m, x: m.x, y: m.y, hx: hd[0], hy: hd[1], len, wid });
      // as the client draws it: facing the direction it last moved in (east until it first moves, as the probe assumes)
      if (!tr.motionOf(m, hd)) { hd[0] = 1; hd[1] = 0; }
      drawn.push({ m, x: m.x, y: m.y, hx: hd[0], hy: hd[1], len, wid });
    };
    for (const c of w.citizens.values()) {
      if (c.state === S.Home || c.state === S.Work || c.state === S.AtSite || c.state === S.AtVenue) continue;
      if (c.leg?.drive) { if (c.lane >= 0) addCar(c); } else if (c.leg && !sim.transit.isRiding(c) && !sim.taxis.isAboard(c) && !sim.pool.aboard(c)) peds.push(c); // riders on board are inside the bus, the taxi or a shared car
    }
    for (const veh of w.vehicles.values()) if (veh.phase !== 'dwell' && veh.lane >= 0) { addCar(veh); drove.add(veh.id); }
    { let n = 0, nb = 0; for (const b of cars) { if (b.m.cls === VehicleClass.Bus) nb++; else n++; } carsSum += n; busesSum += nb; if (n > carsPeak) carsPeak = n; }
    for (const u of sim.mobile.units.values()) if (u.v.lane >= 0) fleetSum++;
    const grid = new Map<number, Body[]>();
    for (const b of cars) { const k = tkey(Math.floor(b.x), Math.floor(b.y)); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(b); }
    let tcc = 0, tcp = 0;
    for (const a of cars) {
      const ax = Math.floor(a.x), ay = Math.floor(a.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = grid.get(tkey(ax + dx, ay + dy));
        if (!l) continue;
        for (const b of l) {
          if (b.m.id <= a.m.id) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) > (a.len + b.len) / 2 + 0.2) continue;
          if (!obbOverlap(a, b)) continue;
          // a bike filtering past a car at the kerb edge is counted on its own (bike-car), not as two cars touching
          if ((a.m.cls === BIKE_CLASS) !== (b.m.cls === BIKE_CLASS)) { bikeCar++; continue; }
          tcc++;
          if (a.m.cls === VehicleClass.Bus || b.m.cls === VehicleClass.Bus) busCar++;
          const mx = Math.floor((a.x + b.x) / 2), my = Math.floor((a.y + b.y) / 2), mt = w.peekTile(mx, my);
          const deg = tr.degreeOf(mx, my);
          const sameLane = a.m.lane === b.m.lane;
          const key = `${mt === undefined || !isRoad(mt) ? 'building tile' : deg >= 3 ? 'junction' : 'road'}${sameLane ? ' same lane' : ''}${a.m.prog === 0 || b.m.prog === 0 ? ' just pulled out' : ''}`;
          bump(ccWhere, key);
          if (examples.filter((e) => e.startsWith('cc')).length < 12) examples.push(`cc t${w.tick} ${key} ${desc(a.m)} | ${desc(b.m)}`);
        }
      }
    }
    for (const p of peds) {
      const px = Math.floor(p.x), py = Math.floor(p.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = grid.get(tkey(px + dx, py + dy));
        if (!l) continue;
        for (const a of l) {
          if (Math.hypot(a.x - p.x, a.y - p.y) > a.len / 2 + 0.2 || !pointInObb(p.x, p.y, a)) continue;
          tcp++;
          if (a.m.cls === BIKE_CLASS) bikePed++;
          const t = w.peekTile(px, py);
          const onRoad = t !== undefined && isRoad(t);
          const crossing = !!(p.cross && p.pp < p.cross.length && p.cross[p.pp]);
          const deg = onRoad ? tr.degreeOf(px, py) : 0;
          const key = !onRoad ? 'off-road (building tile)' : crossing ? `crossing ${deg >= 3 ? 'junction' : 'mid-block'}${a.m.wait >= TRAFFIC_TUNING.carYieldMax && TRAFFIC_TUNING.carYieldMax > 0 ? ' car nosed' : ''}${p.wait > 0 ? ' ped forced' : ''}` : `sidewalk ${deg >= 3 ? 'junction' : 'road'}`;
          bump(cpWhere, key);
          if (sim.mobile.units.has(a.m.id)) { fleetPed++; bump(fleetPedWhere, `${key} ${(a.m as { vkind?: number }).vkind}${(a.m as { dwell?: boolean }).dwell ? ' dwelling' : ''}`); }
          if (examples.filter((e) => e.startsWith('cp')).length < 30) examples.push(`cp t${w.tick} ${key} ped #${p.id}(${p.x.toFixed(2)},${p.y.toFixed(2)} pp ${p.pp} wait ${p.wait} seg ${p.pts ? [p.pts[(p.pp - 1) * 2], p.pts[(p.pp - 1) * 2 + 1], p.pts[p.pp * 2], p.pts[p.pp * 2 + 1]].map((v) => v?.toFixed(2)).join(',') : '-'} path ${p.path.slice(0, 8).join(',')} st ${p.state} leg ${p.leg?.arrive}) car #${a.m.id}(${a.x.toFixed(2)},${a.y.toFixed(2)} lane ${a.m.lane} prog ${a.m.prog.toFixed(2)} wait ${a.m.wait} c${+a.m.committed})`);
        }
      }
    }
    cc += tcc; cp += tcp; if (tcc) ccTicks++; if (tcp) cpTicks++;
    // the same tests with bodies facing their motion, as the client draws them (and the live probe measures)
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i], b = drawn[j];
      const rr = (a.len + b.len) / 2 + 0.2;
      if ((a.m.cls === BIKE_CLASS) !== (b.m.cls === BIKE_CLASS)) continue;
      if (Math.abs(a.x - b.x) < rr && Math.abs(a.y - b.y) < rr && obbOverlap(a, b)) ccDrawn++;
    }
    for (const p of peds) for (const a of drawn) if (Math.abs(a.x - p.x) < a.len / 2 + 0.2 && Math.abs(a.y - p.y) < a.len / 2 + 0.2 && pointInObb(p.x, p.y, a)) {
      cpDrawn++;
      if (examples.filter((e) => e.startsWith('cpd')).length < 16) {
        const g = cars.find((c) => c.m === a.m)!;
        examples.push(`cpd t${w.tick} ped #${p.id}(${p.x.toFixed(2)},${p.y.toFixed(2)} pp ${p.pp} wait ${p.wait} cross ${p.cross?.[p.pp] ? 1 : 0} path ${p.path.slice(0, 6).join(',')}) car ${desc(a.m)} drawn h(${a.hx.toFixed(2)},${a.hy.toFixed(2)}) path h(${g.hx.toFixed(2)},${g.hy.toFixed(2)}) geomContact ${pointInObb(p.x, p.y, g)}`);
      }
    }
  }

  const c1 = tr.counters;
  const samples = sim.legSamples ?? []; sim.legSamples = null;
  const ratios = samples.map(([e, x]) => e / x).sort((a, b) => a - b);
  const late = samples.filter(([e, x]) => e - x >= TRAFFIC_TUNING.delayMinTicks && e - x > x * TRAFFIC_TUNING.delayFrac).length;
  const rl = sim.rerouteLog;
  const rerouteN = rl.slow - rl0.slow + rl.late - rl0.late + rl.forced - rl0.forced;
  const counters: Record<string, number> = {};
  for (const k of Object.keys(c1) as (keyof typeof c1)[]) counters[k] = c1[k] - c0[k];
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  let owners = 0; for (const c of w.citizens.values()) if (c.car) owners++;
  const md = { walk: sim.modeLog.walk - m0.walk, drive: sim.modeLog.drive - m0.drive, transit: sim.modeLog.transit - m0.transit };
  const t1s: Record<string, number> = { ...sim.transit.stats, ...prefix(sim.buses.stats, 'bus.') };
  const transitDelta: Record<string, number> = {};
  for (const k of Object.keys(t1s)) transitDelta[k] = t1s[k] - ((t0s as Record<string, number>)[k] ?? 0);
  return {
    label: opts.label ?? (Object.entries(opts.set).map(([k, v]) => `${k}=${v}`).join(',') || 'defaults'),
    set: opts.set, hour: opts.hour, ticks: opts.ticks, seed: opts.seed,
    citizens: w.citizens.size, carOwners: owners,
    speedPct: vehSum ? (100 * spSum) / vehSum : 100, queuedPct: vehSum ? (100 * qSum) / vehSum : 0,
    peakCars, peakQueuedPct: 100 * peakQ,
    firstHourQueuedPct: fhV ? (100 * fhQ) / fhV : 0, firstHourSpeedPct: fhV ? (100 * fhS) / fhV : 100,
    giveUps: counters.stuckHome + counters.stuckDespawn + counters.abandonKerb + counters.abandonDespawn,
    visibleGiveUps: counters.stuckHome + counters.stuckDespawn + counters.abandonDespawn,
    counters,
    junctionEntriesPerTick: counters.junctionEntries / opts.ticks,
    commutes: trips.length, commuteMean: avg(trips), driveCommuteMean: avg(driveTrips),
    ccPerTick: cc / opts.ticks, cpPerTick: cp / opts.ticks, ccTicks, cpTicks, cpWhere, ccWhere, examples,
    ccDrawnPerTick: ccDrawn / opts.ticks, cpDrawnPerTick: cpDrawn / opts.ticks,
    wallSec: (performance.now() - t0) / 1000,
    simMsPerTick: simMs / opts.ticks,
    reroute: { slow: rl.slow - rl0.slow, late: rl.late - rl0.late, forced: rl.forced - rl0.forced, lateTried: rl.lateTried - rl0.lateTried, cars: drove.size, perCar: drove.size ? rerouteN / drove.size : 0, maxPerCitizenDay: maxDay },
    modes: { ...md, transitShare: md.walk + md.drive + md.transit ? md.transit / (md.walk + md.drive + md.transit) : 0 },
    trips: allTrips.length, tripMean: avg(allTrips), transitTrips: rideTrips.length, transitTripMean: avg(rideTrips),
    carsMean: carsSum / opts.ticks, carsPeak, busesMean: busesSum / opts.ticks, busCarPerTick: busCar / opts.ticks, transit: transitDelta,
    legs: { n: samples.length, ratioMean: avg(ratios), ratioP50: ratios[Math.floor(ratios.length * 0.5)] ?? 0, ratioP90: ratios[Math.floor(ratios.length * 0.9)] ?? 0, lateShare: samples.length ? late / samples.length : 0, ticksMean: avg(samples.map(([e]) => e)) },
    smooth: {
      stopsAt, tiles: smTiles, stops: smStops, stopsPer10: smTiles ? (10 * smStops) / smTiles : 0, deadStops: smDead,
      jerk: smJerkN ? smJerk / smJerkN : 0, harshPct: smJerkN ? (100 * smHarsh) / smJerkN : 0,
      standPct: smN ? (100 * smStand) / smN : 0, standStreamPct: smN ? (100 * smStream) / smN : 0, carTicks: smN,
    },
    mobile: {
      onRoadMean: fleetSum / opts.ticks, bikesCarOverlaps: bikeCar, bikePedContacts: bikePed, fleetPedContacts: fleetPed, fleetPedWhere,
      taxi: delta(sim.taxis.stats, mob0.taxi), food: delta(sim.delivery.stats, mob0.food), bins: delta(sim.refuse.stats, mob0.bins), parcels: delta(sim.couriers.stats, mob0.parcels),
      foodMinutes: sim.delivery.minutes.slice(mob0.minutes),
    },
  };
}

const delta = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(Object.keys(a).map((k) => [k, Math.round((a[k] - (b[k] ?? 0)) * 100) / 100]));

export function summary(r: AbResult): string {
  const f1 = (v: number) => v.toFixed(1), f3 = (v: number) => v.toFixed(3);
  const c = r.counters;
  return [
    `[${r.label}] ${r.hour}:00 +${r.ticks} ticks, seed ${r.seed}: ${r.citizens} citizens (${r.carOwners} own a car)`,
    `  speed ${f1(r.speedPct)}%  queued ${f1(r.queuedPct)}%  (first hour: speed ${f1(r.firstHourSpeedPct)}%, queued ${f1(r.firstHourQueuedPct)}%)  peak ${r.peakCars} cars, ${f1(r.peakQueuedPct)}% queued`,
    `  give-ups ${r.giveUps} (sent home ${c.stuckHome}, vehicles removed ${c.stuckDespawn}, kerb+walk ${c.abandonKerb}, withdrawn ${c.abandonDespawn}); garage ${c.garageGiveUp}; re-routes ${c.reroutes} + forced ${c.stuckReroutes}`,
    `  re-routes: held up ${r.reroute.slow}, late ${r.reroute.late} (${r.reroute.lateTried} searches), forced ${r.reroute.forced}; ${f3(r.reroute.perCar)} per car (${r.reroute.cars} cars), most for one citizen in a day ${r.reroute.maxPerCitizenDay}`,
    `  driven legs ${r.legs.n}: mean ${f1(r.legs.ticksMean)} ticks, elapsed/expected mean ${f3(r.legs.ratioMean)} p50 ${f3(r.legs.ratioP50)} p90 ${f3(r.legs.ratioP90)}, ${f1(100 * r.legs.lateShare)}% over the late threshold`,
    `  junction entries ${f1(r.junctionEntriesPerTick)}/tick  commutes ${r.commutes}, mean ${f1(r.commuteMean)} ticks (drivers ${f1(r.driveCommuteMean)})`,
    `  overlaps per tick: car-car ${f3(r.ccPerTick)} (${r.ccTicks} ticks), car-ped ${f3(r.cpPerTick)} (${r.cpTicks} ticks); as drawn (facing motion): car-car ${f3(r.ccDrawnPerTick)}, car-ped ${f3(r.cpDrawnPerTick)}; cars nosed ${c.carNosed}, peds forced ${c.pedForced}`,
    `  car-ped where: ${JSON.stringify(r.cpWhere)}  car-car where: ${JSON.stringify(r.ccWhere)}`,
    `  trips ${r.trips}, mean ${f1(r.tripMean)} ticks; planned walk ${r.modes.walk} drive ${r.modes.drive} transit ${r.modes.transit} (${f1(100 * r.modes.transitShare)}% transit); by transit ${r.transitTrips}, mean ${f1(r.transitTripMean)} ticks`,
    `  cars on the road ${f1(r.carsMean)} mean, ${r.carsPeak} peak; buses ${f1(r.busesMean)}; bus-car overlaps ${f3(r.busCarPerTick)}/tick; transit ${JSON.stringify(r.transit)}`,
    `  mobile jobs: ${f1(r.mobile.onRoadMean)} fleet vehicles on the road; taxi ${JSON.stringify(r.mobile.taxi)}; food ${JSON.stringify(r.mobile.food)}; bins ${JSON.stringify(r.mobile.bins)}; parcels ${JSON.stringify(r.mobile.parcels)}; bike-car overlaps ${r.mobile.bikesCarOverlaps}, bike-ped contacts ${r.mobile.bikePedContacts}, fleet-ped contacts ${r.mobile.fleetPedContacts} ${JSON.stringify(r.mobile.fleetPedWhere)}`,
    `  smooth: ${f1(r.smooth.tiles)} tiles, ${r.smooth.stops} stops (${f3(r.smooth.stopsPer10)} per 10 tiles, ${r.smooth.deadStops} dead), jerk ${f3(r.smooth.jerk)} tiles/tick (harsh ${f1(r.smooth.harshPct)}%), standing ${f1(r.smooth.standPct)}% (in the stream ${f1(r.smooth.standStreamPct)}%); stops at ${JSON.stringify(r.smooth.stopsAt)}`,
    `  sim ${r.simMsPerTick.toFixed(3)} ms/tick over the window; wall ${f1(r.wallSec)} s`,
  ].join('\n');
}

const isMain = process.argv[1] && /ab\.ts$/.test(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  const get = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const r = runAb({
    hour: Number(get('hour') ?? 8), ticks: Number(get('ticks') ?? 1500), seed: Number(get('seed') ?? 1),
    set: parseSet(get('set')), then: parseSet(get('then')), label: get('label'), log: argv.includes('--quiet') ? undefined : (s) => process.stderr.write(s + '\n'),
  });
  console.log(summary(r));
  if (argv.includes('--examples')) console.log(r.examples.join('\n'));
  const json = get('json');
  if (json) writeFileSync(json, JSON.stringify(r) + '\n', { flag: 'a' });
}

function prefix(o: Record<string, number>, p: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) out[p + k] = v;
  return out;
}
