import {
  DEFAULT_TAX, Terrain, TICKS_PER_DAY, TICKS_PER_HOUR, Zone, KIND_ID, KIND_NAMES, chunkKey, isBuildable, isRoad, packTile, terrainOf,
  zoneOf, levelOf, familyOf, subFor, workOf, isMultiTile, planStructure, planRunway, planRoundabout, planFlyover, trackDragPath, BUS_STOP_KIND,
  DEMO_TOWN, DEMO_OWNER, DEMO_BY_ID, demoSections, placedFromDoor, type DemoId, type DemoXY, type DemoRect, type DemoSection, type PlaceEnv,
  isMergedKind, planBridge, BridgeStyle, isDemoOwner, firstLevelOf, isRailAux, isMetroStationKind, SCHOOL_SPECS, capacityOf, Study, EduLevel, LifeStage, CitizenState, ALL_TECH_IDS, TECH_BY_ID,
  demoGraves, plotCapacity,
  demoUtilLinks, UTIL_ROLE_OF, UtilRole, MOTORWAY_KIND, tileKey, type UtilLinkDTO,
} from '@msimcity/shared';
import { World, emptyStats, DEV_FUNDS, type Building, type Citizen } from '../world';
import { ageOf, stageFor } from '../sim/life';
import { inheritValues } from '../sim/motivation';
import { seedCity } from '../loadtest/cities';
import { settleInteriors, GARDEN_KIND } from '../sim/blocks';
import { seedLondon } from './london';
import { fillCity, yieldNow } from '../fill';
import type { Simulation } from '../sim/simulation';
import type { Rail } from '../sim/rail';
import { Metro } from '../sim/metro';
import { Ferry } from '../sim/ferry';

/**
 * The demo seeder (docs/demo.md): builds a demo scenario (shared/src/demo/showcase.ts) into a fresh World through the
 * planners players go through: `planStructure` with the scenario's rotation for every multi-tile kind, the 1×1 rules
 * of the build tool (own land, a road beside it), `planRunway`, `Rail.paint` (planTrack) for every track drag,
 * `BusService.stopProblem` for bus stops, `Metro.platformFor` for the platform under a metro station and
 * `Transit.saveLine` (the registry's validation and routing, the metro's boring, the ferry's route on the water) for
 * every line. Harbours are multi-tile kinds like any other (their back rows over the scenario's water), and the
 * scenario's sea gates go to World.seaGates.
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
      let holder = DEMO_OWNER;
      if (l.frozen) { // its own owner without the construction track: nothing there upgrades or merges (showcase.ts)
        holder = `${DEMO_OWNER}:${l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const p = w.getOrCreatePlayer(holder, l.name, DEV_FUNDS);
        p.tech = ALL_TECH_IDS.filter((t) => TECH_BY_ID.get(t)?.track !== 'construction');
        p.devUnlimited = true; p.color = owner.color;
      }
      const parcel = { id: w.nextId++, owner: holder, name: l.name, x, y, w: pw, h: ph, taxRate: DEFAULT_TAX, stats: emptyStats() };
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
      eachTile(z.rect, (x, y) => { unmerge(x, y); const t = w.getTile(x, y); if (!isRoad(t) && isBuildable(t)) w.setTile(x, y, packTile(terrainOf(t), false, familyOf(k), z.level ?? DEMO_TOWN.built), subFor(k)); });
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
  // trunk links (docs/utilities.md 4.2), as the pylon and cable tools lay them: the drag's path, each end the plant or node
  // (or motorway connection) on or beside it; written to the save the Utilities module loads (sim/utilities.ts)
  const links: UtilLinkDTO[] = [];
  const endAt = (x: number, y: number): [number, number] | null => {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [ex, ey] = w.doorOf(x + dx, y + dy), b = w.buildings.get(tileKey(ex, ey));
      if (b && b.level > 0 && (b.id === MOTORWAY_KIND || UTIL_ROLE_OF[b.id] === UtilRole.Node || UTIL_ROLE_OF[b.id] === UtilRole.Plant)) return [ex, ey];
    }
    return null;
  };
  for (const l of demoUtilLinks(id)) {
    const path = trackDragPath([l.from[0], l.from[1]], [l.to[0], l.to[1]]), a = endAt(l.from[0], l.from[1]), b = endAt(l.to[0], l.to[1]);
    if (!a || !b) { problems.push(`${l.id}: no power station, node or motorway connection at ${at(a ? l.to : l.from)}`); continue; }
    links.push({ id: links.length + 1, util: 'power', owner: w.parcelAt(a[0], a[1])?.owner ?? DEMO_OWNER, mode: l.mode, a, b, tiles: path.flatMap(([x, y]) => [x, y]) });
  }
  if (links.length) w.utilitiesLoaded = { links, nextLink: links.length + 1, faults: [], nextFault: 1 };
  for (const pid of w.parcels.keys()) w.recountRoads(pid);
  // where the scenario's water meets the sea (docs/boats.md 2.3): every harbour derives its lanes to these
  w.seaGates = sections.flatMap((s) => (s.seaGates ?? []).map((g) => ({ ...g })));
  // estates (docs/world-map.md): land parcels combined by the players' rule, then named
  for (const s of sections) for (const e of s.estates ?? []) {
    const ids = e.lands.map((name) => [...w.parcels.values()].find((p) => p.name === name)?.id);
    if (ids.some((id) => id === undefined)) continue; // a demo without one of the lands (the transport demo has no riverside)
    const r = w.combineParcels(ids as number[], isDemoOwner);
    if (typeof r === 'string') { problems.push(`${s.id}: estate ${e.name}: ${r}`); continue; }
    for (const id of ids) { const p = w.parcels.get(id!); if (p) p.name = e.name; }
  }
  // street names a scenario gives (shared/src/streets.ts), as the owner renames a street from its context menu
  for (const s of sections) for (const n of s.streets ?? []) {
    const run = w.streets.streetsAt(n.at[0], n.at[1]).find((r) => r.ns === !!n.ns);
    if (!run) { problems.push(`${s.id}: no ${n.ns ? 'north-south' : 'east-west'} street through ${at(n.at)} to name ${n.name}`); continue; }
    w.streets.rename(run, n.name);
  }
  return problems;
}

/**
 * Phase 2: bus stops (BusService.stopProblem), track (Rail.paint), the platforms under the metro stations
 * (Metro.platformFor, as the station tools lay them), every named stop's and harbour's name, then every line through
 * the transit registry. The metro and ferry services are the ones registered with the registry (game.ts); a caller
 * that registers none (a check that builds its own Rail) gets one registered here when the scenario needs it.
 */
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
  const stations = sections.flatMap((s) => (s.placements ?? []).filter((p) => isMetroStationKind(kindId(p.kind))).map((p) => ({ s, p })));
  if (stations.length) {
    let metro = sim.transit.services.get('metro') as Metro | undefined;
    if (!metro) sim.transit.register(metro = new Metro(w, sim.transit));
    metro.sandbox = true;
    for (const { s, p } of stations) { // the platform a station tool lays with the entrance (net.ts), on the scenario's turn
      const k = kindId(p.kind), [x, y] = p.door;
      if (w.kindIdAt(x, y) !== k) continue; // phase 1 has said why it is not there
      const writes = metro.platformFor(k, x, y, p.rot);
      if (typeof writes === 'string') problems.push(`${s.id}: ${p.id ?? p.kind} at ${at(p.door)}: ${writes}`);
      else metro.lay(writes);
    }
  }
  // names at the door: a station's on its platform, a pier's on its line, a harbour's on its boats (sim/harbours.ts)
  for (const s of sections) for (const p of s.placements ?? []) if (p.name && w.kindIdAt(p.door[0], p.door[1]) === kindId(p.kind)) w.setStopName(p.door[0], p.door[1], p.name);
  if (sections.some((s) => s.lines?.some((l) => l.mode === 'ferry'))) {
    let ferry = sim.transit.services.get('ferry') as Ferry | undefined;
    if (!ferry) sim.transit.register(ferry = new Ferry(w, sim.transit));
    ferry.sandbox = true;
  }
  for (const s of sections) for (const l of s.lines ?? []) {
    const r = sim.transit.saveLine(DEMO_OWNER, { number: l.number, colour: l.colour, loop: l.loop, vehicles: l.vehicles, stops: l.stops.map(([x, y]) => ({ x, y })), ...(l.name ? { name: l.name } : {}) });
    if (typeof r === 'string') problems.push(`${s.id}: ${l.id}: ${r}`);
    else if (r.mode !== l.mode) problems.push(`${s.id}: ${l.id} came out as a ${r.mode} line, not ${l.mode}`);
  }
  seedDemoFamilies(w, sim, sections);
  return problems;
}

/**
 * How many families with children a demo with schools starts with (the rest of its beds fill through the gateways as
 * for any demo): at most `max`, and at most `share` of the family-sized places (four beds) in the homes in reach of a school.
 */
export const DEMO_FAMILIES = { max: 450, share: 0.8, ages: [3, 18] as const, babies: 0.15 } as const;

/**
 * Families for a demo that has schools (docs/education.md section 9, docs/demo.md "Schools in the demos"): a showcase
 * school is no use empty, and E5's families (sim/families.ts) do not move in while a demo fast-fills (the couples who
 * settle have no school-age children for years). Before the fill, homes within the catchment of a placed primary school take two adults and one to three children, 15% of them under three, the rest aged 3 to 17
 * (about the shape of E5's family newcomers), up to `DEMO_FAMILIES.max` families (one for every four beds, each by
 * chance, from a seeded stream, so the same town gets the same families). The adults find work at once. A demo with no school gets nothing, so the other demos play
 * as before. Returns the families and children made.
 */
export function seedDemoFamilies(w: World, sim: Simulation, sections: DemoSection[]): { families: number; children: number } {
  const schools = sections.flatMap((s) => s.placements ?? []).flatMap((p) => {
    const spec = SCHOOL_SPECS[kindId(p.kind)];
    return spec && spec.stage >= 1 && spec.stage <= 5 ? [{ x: p.door[0], y: p.door[1], reach: spec.catchment, stage: spec.stage }] : [];
  });
  if (!schools.length) return { families: 0, children: 0 };
  // a family lives within a primary school's catchment (the narrowest of the stages most children are in, so their
  // secondary and sixth form are in reach too); with no primary, within reach of any school
  const anchors = schools.some((q) => q.stage === Study.Primary) ? schools.filter((q) => q.stage === Study.Primary) : schools;
  const priv = sim as unknown as { makeCitizen(id: number, home: Building, age: number, health: number): Citizen; findJob(c: Citizen): boolean };
  const rnd = seededRandom(0x5c001);
  const homes = [...w.buildings.values()].filter((b) => familyOf(b.id) === Zone.Residential && b.level > 0 && capacityOf(b.id, b.level) >= 4
    && anchors.some((q) => Math.abs(q.x - b.x) + Math.abs(q.y - b.y) <= q.reach));
  // up to one family for every four beds, each by chance, so the cap is met from across the homes in reach
  const slots = homes.reduce((n, b) => n + Math.floor(capacityOf(b.id, b.level) / 4), 0);
  const take = Math.min(DEMO_FAMILIES.share, DEMO_FAMILIES.max / Math.max(1, slots));
  let families = 0, children = 0;
  for (const home of homes) for (let f = 0, n = Math.floor(capacityOf(home.id, home.level) / 4); f < n; f++) {
    if (rnd() >= take) continue;
    const room = capacityOf(home.id, home.level) - home.occupants;
    if (room < 3) break;
    const add = (age: number) => {
      const c = priv.makeCitizen(w.nextId++, home, age, 75 + 20 * rnd());
      w.addCitizen(c);
      home.occupants++;
      return c;
    };
    const a = add(28 + rnd() * 16), b = add(28 + rnd() * 16);
    a.partner = b.id; b.partner = a.id; w.setHousehold(b, a.hh);
    const kids = Math.min(room - 2, 1 + Math.floor(rnd() * 3));
    for (let i = 0; i < kids; i++) {
      const k = add(rnd() < DEMO_FAMILIES.babies ? rnd() * 3 : DEMO_FAMILIES.ages[0] + rnd() * (DEMO_FAMILIES.ages[1] - DEMO_FAMILIES.ages[0]));
      k.stage = stageFor(k.id, ageOf(k, w.tick)); k.car = false; k.money = 0; k.par = a.id; k.sn = a.sn;
      k.vals = inheritValues(k.id, [a, b]); // children take after their parents (sim/motivation.ts)
      w.setHousehold(k, a.hh);
      children++;
    }
    priv.findJob(a); priv.findJob(b);
    families++;
  }
  return { families, children };
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

/** The students a demo's universities start with, once the fill has staffed them (`seedDemoStudents`). */
export const DEMO_STUDENTS = { perCampus: 60, ages: [18, 23] as const, years: 14 };

/**
 * Students for a demo's universities, after its fill (docs/demo.md "Schools in the demos"). A university takes its first
 * students on the first Monday after a Saturday's results, a few game days away, and a visitor should not find the campus
 * empty: so each (the campus, and London's four landmarks) enrols up to `perCampus` or a sixth of its places, whichever
 * is fewer, from the young adults at home (aged 18-22, no longer in a job), at the stage of a second or third year
 * (`due` 0-13 of the 15 school days a degree takes, so a few graduate on the first Saturday and the rest follow week by
 * week). They go in through `Schools.enrolAt`, so only as many as the university's staffing allows. Deterministic (ids in
 * order, a hash for the year); returns how many were enrolled.
 */
/**
 * A demo's resting places with their long dead (docs/remembrance.md): each placement's share of its plots laid with people
 * who died years before the town began, so headstones stand on every churchyard and cemetery (and plaques in a
 * crematorium's garden) on the first visit. London's go back further (its cemeteries opened in the 1830s). Returns how
 * many were laid.
 */
export function seedDemoGraves(w: World, sim: Simulation, id: DemoId): number {
  let n = 0;
  for (const [i, g] of demoGraves(id).entries()) {
    const s = w.structureAt(g.door[0], g.door[1]);
    const b = w.buildings.get(`${g.door[0]},${g.door[1]}`);
    if (!s || !b) continue;
    n += sim.death.seedGraves(b.x, b.y, Math.round(g.share * plotCapacity(b.id, s.ax, s.ay)), 101 + i * 17, id === 'london' ? 180 : 90);
  }
  return n;
}

export function seedDemoStudents(w: World, sim: Simulation, id: DemoId): number {
  const unis = demoSections(id).flatMap((s) => s.placements ?? []).flatMap((p) => {
    const spec = SCHOOL_SPECS[kindId(p.kind)], b = w.buildings.get(`${p.door[0]},${p.door[1]}`);
    return spec && spec.stage === Study.Degree && b ? [{ b, n: Math.min(DEMO_STUDENTS.perCampus, Math.floor(spec.places / 6)) }] : [];
  });
  if (!unis.length) return 0;
  const pool = [...w.citizens.values()].filter((c) => c.state === CitizenState.Home && !c.study && !c.mig && c.stage === LifeStage.Adult
    && ageOf(c, w.tick) >= DEMO_STUDENTS.ages[0] && ageOf(c, w.tick) < DEMO_STUDENTS.ages[1] - 1).sort((a, b) => a.id - b.id);
  let n = 0;
  for (const { b, n: want } of unis) {
    const room = () => { const sc = sim.schools.list().find((q) => q.b === b); return sc ? sim.schools.admittingOf(sc) - sc.pupils : 0; };
    for (let got = 0; got < want && pool.length && room() > 0;) {
      const c = pool.shift()!;
      if (c.edu < EduLevel.Further) { c.edu = EduLevel.Further; c.track = 1 + (c.id % 2); } // A-levels first
      if (c.job) w.quitJob(c);
      if (!sim.schools.enrolAt(c, b, Study.Degree)) continue;
      c.due = Math.floor(DEMO_STUDENTS.years * (((c.id * 2654435761) >>> 0) / 4294967296)); c.att = Math.round(c.due * 0.9);
      got++; n++;
    }
  }
  return n;
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

/**
 * FNV-1a over every modified chunk's tile words, aux, sub and under bytes (sorted by chunk), the station names, the sea
 * gates (when there are any, so a world without leaves its hash as it was) and the transit lines.
 */
export function worldHash(w: World): string {
  let h = 0x811c9dc5;
  const byte = (b: number) => { h ^= b & 0xff; h = Math.imul(h, 0x01000193) >>> 0; };
  const keys = [...w.chunks.values()].filter((c) => c.modified).map((c) => [c.cx, c.cy, chunkKey(c.cx, c.cy)] as const).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [cx, cy] of keys) {
    const c = w.getChunk(cx, cy, false)!;
    for (const v of [cx, cy]) for (let s = 0; s < 32; s += 8) byte(v >> s);
    for (let i = 0; i < c.tiles.length; i++) { byte(c.tiles[i]); byte(c.tiles[i] >> 8); byte(c.aux[i]); byte(c.sub[i]); byte(c.under[i]); }
  }
  for (const ch of JSON.stringify([...w.stopNames].sort((a, b) => (a[0] < b[0] ? -1 : 1)))) byte(ch.charCodeAt(0));
  if (w.seaGates.length) for (const ch of JSON.stringify(w.seaGates)) byte(ch.charCodeAt(0));
  const lines = [...w.transitLines.values()].sort((a, b) => a.id - b.id).map((l) => [l.id, l.owner, l.mode, l.number, l.colour, l.loop, l.vehicles, l.stops.map((s) => [s.x, s.y]), l.name ?? '']);
  for (const ch of JSON.stringify(lines)) byte(ch.charCodeAt(0));
  return h.toString(16).padStart(8, '0');
}
