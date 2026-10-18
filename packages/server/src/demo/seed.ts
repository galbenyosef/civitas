import {
  DEFAULT_TAX, Terrain, TICKS_PER_DAY, TICKS_PER_HOUR, Zone, KIND_ID, KIND_NAMES, chunkKey, isBuildable, isRoad, packTile, terrainOf,
  zoneOf, levelOf, familyOf, subFor, workOf, isMultiTile, planStructure, planRunway, planRoundabout, planFlyover, trackDragPath, BUS_STOP_KIND,
  DEMO_TOWN, DEMO_OWNER, DEMO_BY_ID, demoSections, placedFromDoor, type DemoId, type DemoXY, type DemoRect, type DemoSection, type PlaceEnv,
  isMergedKind, planBridge, BridgeStyle, isDemoOwner, firstLevelOf, isRailAux,
} from '@msimcity/shared';
import { World, emptyStats, DEV_FUNDS } from '../world';
import { seedCity } from '../loadtest/cities';
import { settleInteriors, GARDEN_KIND } from '../sim/blocks';
import { seedLondon } from './london';
import { fillCity, yieldNow } from '../fill';
import type { Simulation } from '../sim/simulation';
import type { Rail } from '../sim/rail';

/**
 * The demo seeder (docs/demo.md): builds a demo scenario (shared/src/demo/showcase.ts) into a fresh World through the
 * planners players go through: `planStructure` with the scenario's rotation for every multi-tile kind, the 1×1 rules
 * of the build tool (own land, a road beside it), `planRunway`, `Rail.paint` (planTrack) for every track drag,
 * `BusService.stopProblem` for bus stops and `Transit.saveLine` (the registry's validation and routing) for every line.
 * Anything a planner refuses is a problem; the caller fails loudly on any, so a broken scenario never seeds quietly.
 * Everything is pre-built complete (no waiting for builders).
 *
 * Two phases, because stops, track and lines need the simulation's services: `seedDemoTown` before the Simulation
 * exists (like seedCity), `seedDemoNetwork` once the transit registry and rail are registered.
 */

const kindId = (s: string): number => (KIND_ID as Record<string, number>)[s] ?? 0;
const eachTile = (r: DemoRect, f: (x: number, y: number) => void) => { for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) f(x, y); };
const at = (p: DemoXY) => `(${p[0]}, ${p[1]})`;

/** Placement on the demo's land (the town's, or a London borough's), the same reads the build tool gives planStructure. */
function placeEnv(w: World): PlaceEnv {
  return {
    tile: (x, y) => w.getTile(x, y),
    aux: (x, y) => w.auxAt(x, y),
    sub: (x, y) => w.subAt(x, y),
    land: (x, y) => { const q = w.parcelAt(x, y); return q ? (isDemoOwner(q.owner) ? null : 'Not your land') : 'Buy this land first'; },
  };
}

/**
 * Land a painted town (London) keeps free of roads and zones for the scenario: every placement's footprint (a bus
 * stop's lot too, so no merged building covers it), so the planners find it clear.
 */
function keptLand(sections: DemoSection[]): DemoRect[] {
  const out: DemoRect[] = [];
  for (const s of sections) for (const p of s.placements ?? []) {
    const k = kindId(p.kind);
    if (!k) continue;
    const q = isMultiTile(k) ? placedFromDoor(k, p.door[0], p.door[1], p.rot ?? 0) : null;
    out.push(q ? [q.ax, q.ay, q.w, q.h] : [p.door[0], p.door[1], 1, 1]);
  }
  return out;
}

/** Phase 1: the town (seedCity districts), extra land, cleared and rezoned blocks, every placement but bus stops, runways. */
export function seedDemoTown(w: World, id: DemoId): string[] {
  const demo = DEMO_BY_ID.get(id);
  if (!demo) return [`no demo called ${id}`];
  const problems: string[] = [];
  const sections = demoSections(id);
  if (demo.town === 'london') problems.push(...seedLondon(w, DEMO_OWNER, keptLand(sections)).problems);
  else seedCity(w, { districts: DEMO_TOWN.districts, built: DEMO_TOWN.built, gap: DEMO_TOWN.gap });
  const owner = w.players.get(DEMO_OWNER)!;
  owner.name = demo.name;
  owner.money = DEV_FUNDS; owner.devUnlimited = true; // a sandbox: the town never runs out of money
  const env = placeEnv(w);
  /** a deep plot or other merged lot of the districts (sim/blocks.ts settleInteriors) under a cleared or rezoned tile breaks up first */
  const unmerge = (x: number, y: number) => { const m = w.auxAt(x, y) ? w.structureAt(x, y) : null; if (m && (isMergedKind(m.kind) || m.kind === GARDEN_KIND)) w.removeStructure(m); };
  for (const s of sections) {
    for (const l of s.land ?? []) {
      const [x, y, pw, ph] = l.rect;
      const parcel = { id: w.nextId++, owner: DEMO_OWNER, name: l.name, x, y, w: pw, h: ph, taxRate: DEFAULT_TAX, stats: emptyStats() };
      w.parcels.set(parcel.id, parcel);
      eachTile(l.rect, (tx, ty) => {
        if (w.parcelIdAt(tx, ty)) problems.push(`${s.id}: land ${l.name} overlaps a parcel at ${at([tx, ty])}`);
        w.setParcelId(tx, ty, parcel.id);
        if (terrainOf(w.getTile(tx, ty)) === Terrain.Water) w.setTile(tx, ty, packTile(Terrain.Grass, false, 0, 0)); // as seedCity flattens its districts
      });
      w.dirtyParcels.add(parcel.id);
    }
    // a scenario's river: open water, whoever's land it is (no tool makes water)
    for (const r of s.water ?? []) eachTile(r, (x, y) => { unmerge(x, y); w.setTile(x, y, packTile(Terrain.Water, false, 0, 0)); });
    for (const r of s.clear ?? []) eachTile(r, (x, y) => { unmerge(x, y); const t = w.getTile(x, y); if (!isRoad(t)) w.setTile(x, y, packTile(terrainOf(t), false, 0, 0)); });
    // straight road drags, as the road tool lays them on the owner's dry land (the track drawn later crosses them)
    for (const [a, b] of s.roads ?? []) {
      if (a[0] !== b[0] && a[1] !== b[1]) { problems.push(`${s.id}: road ${at(a)} to ${at(b)} is not straight`); continue; }
      const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]), n = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      for (let i = 0; i <= n; i++) {
        const x = a[0] + dx * i, y = a[1] + dy * i, t = w.getTile(x, y), why = env.land(x, y);
        if (isRoad(t)) continue;
        if (why) problems.push(`${s.id}: road at ${at([x, y])}: ${why}`);
        else if (!isBuildable(t)) problems.push(`${s.id}: road at ${at([x, y])} is on water (lay a bridge)`);
        else if (w.auxAt(x, y) && !isRailAux(w.auxAt(x, y))) problems.push(`${s.id}: road at ${at([x, y])} is on a structure, runway or junction`);
        else { unmerge(x, y); w.setTile(x, y, packTile(terrainOf(t), true, 0, 0)); }
      }
    }
    for (const z of s.zones ?? []) {
      const k = kindId(z.zone);
      eachTile(z.rect, (x, y) => { unmerge(x, y); const t = w.getTile(x, y); if (!isRoad(t) && isBuildable(t)) w.setTile(x, y, packTile(terrainOf(t), false, familyOf(k), DEMO_TOWN.built), subFor(k)); });
    }
  }
  // merged lots (docs/buildings.md "Merged lots") stand on their zoned lots as growth builds them: through the shared
  // placement rule with those lots seen as empty, before the block middles round them are settled
  for (const s of sections) for (const p of s.placements ?? []) {
    const k = kindId(p.kind);
    if (!k || !isMergedKind(k)) continue;
    const v = planStructure(k, p.door[0], p.door[1], {
      ...env,
      tile: (x, y) => { const t = w.getTile(x, y); return zoneOf(t) === familyOf(k) && !w.auxAt(x, y) ? packTile(terrainOf(t), false, familyOf(k), 0) : t; },
    }, p.rot ?? 0);
    if (!v.ok) { problems.push(`${s.id}: ${p.id ?? p.kind} at ${at(p.door)} rot ${p.rot ?? 0}: ${v.reason}`); continue; }
    const level = p.level ?? firstLevelOf(k);
    w.placeStructure(v.placed, { work: workOf(k, level), priority: 0, built: true, target: level });
  }
  // rezoned blocks get their middles settled as seedCity's are: a garden in a ring of homes, else deep plots (sim/blocks.ts)
  for (const s of sections) for (const z of s.zones ?? []) settleInteriors(w, z.rect[0] - 1, z.rect[1] - 1, z.rect[0] + z.rect[2], z.rect[1] + z.rect[3], DEMO_TOWN.built);
  // placements after every section's land and clearing, so their order in the file does not matter
  for (const s of sections) {
    for (const p of s.placements ?? []) {
      const k = kindId(p.kind);
      if (!k) { problems.push(`${s.id}: no catalogue kind ${p.kind}`); continue; }
      if (k === BUS_STOP_KIND || isMergedKind(k)) continue; // phase 2: a stop needs the traffic model's junction test; merged lots are up
      const [x, y] = p.door;
      if (isMultiTile(k)) {
        if (p.rot === undefined) { problems.push(`${s.id}: ${p.id ?? p.kind} is multi-tile and needs a rotation`); continue; }
        const v = planStructure(k, x, y, env, p.rot);
        if (!v.ok) { problems.push(`${s.id}: ${p.id ?? p.kind} at ${at(p.door)} rot ${p.rot}: ${v.reason}`); continue; }
        w.placeStructure(v.placed, { work: workOf(k, 1), priority: 1, built: true });
        continue;
      }
      // a 1×1: the build tool's rules (own land, dry, not a road, a road beside it, nothing built there)
      const t = w.getTile(x, y), why = env.land(x, y);
      if (why) problems.push(`${s.id}: ${p.kind} at ${at(p.door)}: ${why}`);
      else if (!isBuildable(t) || isRoad(t)) problems.push(`${s.id}: ${p.kind} at ${at(p.door)} is ${isRoad(t) ? 'a road' : 'water'}`);
      else if (w.auxAt(x, y)) problems.push(`${s.id}: ${p.kind} at ${at(p.door)} is part of a structure, runway or track`);
      else if (zoneOf(t) !== Zone.None && levelOf(t) > 0) problems.push(`${s.id}: ${p.kind} at ${at(p.door)} would replace a ${KIND_NAMES[w.kindIdAt(x, y)]}`);
      else if (!w.hasRoadAccess(x, y)) problems.push(`${s.id}: ${p.kind} at ${at(p.door)} needs a road next to it`);
      else w.setTile(x, y, packTile(terrainOf(t), false, familyOf(k), 1), subFor(k));
    }
    for (const r of s.runways ?? []) {
      const line: [number, number][] = [];
      const [ax, ay] = r.from, [bx, by] = r.to, n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let i = 0; i <= n; i++) line.push([ax + Math.sign(bx - ax) * i, ay + Math.sign(by - ay) * i]);
      const plan = planRunway(line, env);
      if (!plan.ok) { problems.push(`${s.id}: ${r.id}: ${plan.reason}`); continue; }
      const tl = plan.tiles!;
      for (let i = 0; i < tl.length; i += 3) {
        const x = tl[i], y = tl[i + 1], t = w.getTile(x, y);
        if (zoneOf(t) !== Zone.None) w.setTile(x, y, packTile(terrainOf(t), false, 0, 0)); // an empty zoned lot is paved over, as the tool does
        w.setAux(x, y, tl[i + 2]);
      }
    }
    for (const j of s.junctions ?? []) { // roundabouts and flyovers, as the tools build them (shared/src/junctions.ts)
      const [x, y] = j.at;
      const plan = j.tool === 'roundabout' ? planRoundabout(x, y, env) : planFlyover(x, y, env, j.deck ? j.deck === 'ew' : undefined);
      if (!plan.ok) { problems.push(`${s.id}: ${j.id} at ${at(j.at)}: ${plan.reason}`); continue; }
      w.placeJunction(plan.tiles!);
    }
    for (const b of s.bridges ?? []) { // road bridges, as the road tool lays them (shared/src/bridges.ts); one the town already has stands
      const dx = Math.sign(b.to[0] - b.from[0]), dy = Math.sign(b.to[1] - b.from[1]), len = Math.abs(b.to[0] - b.from[0]) + Math.abs(b.to[1] - b.from[1]) + 1;
      const plan = (dx && dy) ? { ok: false, reason: 'not a straight line' } : planBridge(b.from[0], b.from[1], dx || (dy ? 0 : 1), dy, len, env, b.style ? BridgeStyle[b.style] : undefined);
      if (!plan.ok) { problems.push(`${s.id}: ${b.id} from ${at(b.from)} to ${at(b.to)}: ${plan.reason}`); continue; }
      if (plan.tiles!.length) w.placeBridge(plan.tiles!);
    }
  }
  for (const pid of w.parcels.keys()) w.recountRoads(pid);
  return problems;
}

/** Phase 2: bus stops (BusService.stopProblem), track (Rail.paint), then every line through the transit registry. */
export function seedDemoNetwork(w: World, sim: Simulation, rail: Rail, id: DemoId): string[] {
  const problems: string[] = [];
  const owner = w.players.get(DEMO_OWNER);
  if (!owner) return ['the demo town has no owner (seedDemoTown first)'];
  const sections = demoSections(id);
  // a demo is a sandbox (index.ts runs its child with sandbox on): lines call at any owner's stops and stations and
  // run from any owner's depot, track goes on any owner's land; London's land belongs to its boroughs, its lines to the town
  sim.transit.sandbox = sim.buses.sandbox = rail.sandbox = true;
  for (const s of sections) for (const p of s.placements ?? []) {
    if (kindId(p.kind) !== BUS_STOP_KIND) continue;
    const [x, y] = p.door, t = w.getTile(x, y);
    if (isRoad(t)) { problems.push(`${s.id}: ${p.id ?? p.kind} at ${at(p.door)}: a bus stop goes beside the road, not on it`); continue; }
    if (!isDemoOwner(w.parcelAt(x, y)?.owner)) { problems.push(`${s.id}: ${p.id ?? p.kind} at ${at(p.door)}: not the town's land`); continue; }
    const merged = w.auxAt(x, y) ? w.structureAt(x, y) : null;
    if (w.auxAt(x, y) && !(merged && isMergedKind(merged.kind))) { problems.push(`${s.id}: ${p.id ?? p.kind} at ${at(p.door)}: would bulldoze part of a structure, runway or track`); continue; }
    if (merged) w.removeStructure(merged); // a district lot settled into a deep plot (sim/blocks.ts) breaks back into lots first
    w.setTile(x, y, packTile(terrainOf(t), false, 0, 0)); // bulldoze the lot it goes on (a home or shop in a district)
    const why = sim.buses.stopProblem(x, y);
    if (why) { problems.push(`${s.id}: ${p.id ?? p.kind}: ${why}`); continue; }
    w.setTile(x, y, packTile(terrainOf(t), false, familyOf(BUS_STOP_KIND), 1), subFor(BUS_STOP_KIND));
  }
  for (const s of sections) for (const tr of s.tracks ?? []) for (const [a, b] of tr.drags) {
    const r = rail.paint(owner, trackDragPath([a[0], a[1]], [b[0], b[1]]), true);
    if (!r.ok) problems.push(`${s.id}: ${tr.id} drag ${at(a)} to ${at(b)}: ${r.msg}`);
  }
  for (const s of sections) for (const l of s.lines ?? []) {
    const r = sim.transit.saveLine(DEMO_OWNER, { number: l.number, colour: l.colour, loop: l.loop, vehicles: l.vehicles, stops: l.stops.map(([x, y]) => ({ x, y })) });
    if (typeof r === 'string') problems.push(`${s.id}: ${l.id}: ${r}`);
    else if (r.mode !== l.mode) problems.push(`${s.id}: ${l.id} came out as a ${r.mode} line, not ${l.mode}`);
  }
  return problems;
}

/**
 * Child side: fill the town (fillCity: until the population settles), then run on through one more full game day and
 * stop at 09:30, so a visitor arrives in the morning with yesterday's counters (visits, riders, flights) filled in.
 */
export async function fillDemo(w: World, step: () => void, onProgress: (p: { tick: number; of: number; pop: number }) => void) {
  const DAY = TICKS_PER_DAY;
  const first = await fillCity(w, step, (p) => onProgress({ ...p, of: p.of + 2 * DAY }), 1.5);
  const t0 = w.tick, morning = Math.round(9.5 * TICKS_PER_HOUR);
  let end = (Math.floor((t0 + DAY) / DAY) + 1) * DAY + morning;
  if (end - (t0 + DAY) > DAY) end -= DAY; // at least a whole day after the fill, at most two
  let ticks = 0;
  while (w.tick < end) {
    for (let i = 0; i < TICKS_PER_HOUR && w.tick < end; i++, ticks++) step();
    onProgress({ tick: first.ticks + ticks, of: first.ticks + (end - t0), pop: w.citizens.size });
    await yieldNow();
  }
  return { ticks: first.ticks + ticks, pop: w.citizens.size, settled: first.settled };
}

/** A small deterministic generator (mulberry32) to stand in for Math.random while a demo is seeded and filled. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over every modified chunk's tile words, aux and sub bytes (sorted by chunk) and the transit lines. */
export function worldHash(w: World): string {
  let h = 0x811c9dc5;
  const byte = (b: number) => { h ^= b & 0xff; h = Math.imul(h, 0x01000193) >>> 0; };
  const keys = [...w.chunks.values()].filter((c) => c.modified).map((c) => [c.cx, c.cy, chunkKey(c.cx, c.cy)] as const).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [cx, cy] of keys) {
    const c = w.getChunk(cx, cy, false)!;
    for (const v of [cx, cy]) for (let s = 0; s < 32; s += 8) byte(v >> s);
    for (let i = 0; i < c.tiles.length; i++) { byte(c.tiles[i]); byte(c.tiles[i] >> 8); byte(c.aux[i]); byte(c.sub[i]); }
  }
  const lines = [...w.transitLines.values()].sort((a, b) => a.id - b.id).map((l) => [l.id, l.owner, l.mode, l.number, l.colour, l.loop, l.vehicles, l.stops.map((s) => [s.x, s.y])]);
  for (const ch of JSON.stringify(lines)) byte(ch.charCodeAt(0));
  return h.toString(16).padStart(8, '0');
}
