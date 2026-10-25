import {
  DEFAULT_TAX, Terrain, Zone, KIND_ID, ALL_TECH_IDS, packTile, isRoad, levelOf, zoneOf, isGrowableId, familyOf, subFor, hash2, placedFromAnchor, planStructure, workOf,
  planBridge, BridgeStyle, LT, cityScenario, cityPlaces, cityBase, eachWaterTile, inPolygon, isDemoOwner,
  type CityDemo, type CityGrid, type DemoRect, type PlaceEnv,
} from '@msimcity/shared';
import { World, emptyStats, DEV_FUNDS } from '../world';
import { settleInteriors, GARDEN_KIND } from '../sim/blocks';
import { MIX, GREEN, ZONES, lotLevel, DENSE, DENSE_SHARE, SERVICES } from './london';

/**
 * A sample city's town on the city-map kit (docs/demo.md "Sample cities and the city-map kit", shared/src/demo/
 * citydemo.ts): paints the scenario's street plan (citymap.ts cityPlan) into a fresh World in place of seedCity's
 * districts, as seedLondon paints London's, with London's zoning by character (MIX, DENSE: shared from london.ts) and
 * the same order: water, roads, crossings and parks; the blocks zoned by the place nearest them and pre-built; the
 * bridges in their styles through planBridge; services on a 25-tile grid; merged buildings in dense blocks; the block
 * middles settled; a margin of plain country round the map with the water running on out of it.
 *
 * The land belongs to the city's districts, each a player (`sys:<district>`, every technology, an endless treasury)
 * whose parcels follow its outline (a polygon of latitudes and longitudes; a tile none holds goes to the nearest
 * district on its own land mass, the water to the nearer shore's), each parcel named after the place nearest it in the
 * district. The lines belong to the town (`sys`). Deterministic: hashes only.
 */

const K = KIND_ID as Record<string, number>;
const ZONE_WORD: Record<number, 'residential' | 'commercial' | 'office' | 'industrial'> = { [Zone.Residential]: 'residential', [Zone.Commercial]: 'commercial', [Zone.Office]: 'office', [Zone.Industrial]: 'industrial' };
const DIRS: readonly [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** The district index per map tile: its polygon's, else the nearest district's over the same land, the water from the nearer shore. */
export function cityDistricts(g: CityGrid): Int16Array {
  const { mass } = cityBase(g), { N, MX, MY, MW, MH } = g;
  const out = new Int16Array(N).fill(-1);
  const polys = g.map.districts.map((d) => (d.tiles ? d.tiles.map(([x, y]): [number, number] => [x, y]) : g.polyXY(d.poly ?? [])));
  /** the land mass each district keeps to (`on`), 0 for any */
  const massAt = ([lat, lon]: readonly [number, number]) => { const [x, y] = g.geo(lat, lon); return g.inMap(x, y) ? mass[g.idx(x, y)] : 0; };
  const onMass = g.map.districts.map((d) => (d.on ? massAt(d.on) : 0));
  const q: number[] = [];
  for (let y = MY; y < MY + MH; y++) for (let x = MX; x < MX + MW; x++) {
    const i = g.idx(x, y);
    if (!mass[i]) continue;
    const d = polys.findIndex((p, n) => (!onMass[n] || onMass[n] === mass[i]) && inPolygon(p, x + 0.5, y + 0.5));
    if (d >= 0) { out[i] = d; q.push(i); }
  }
  // the rest of the land from its neighbours on the same land mass; then the water, and any land mass no district's
  // outline holds (an island), from the nearest district over the water
  for (const pass of ['land', 'water'] as const) {
    if (pass === 'water') for (let i = 0; i < N; i++) if (out[i] >= 0) q.push(i);
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = g.tx(i), y = g.ty(i);
      for (const [dx, dy] of DIRS) {
        if (!g.inMap(x + dx, y + dy)) continue;
        const j = g.idx(x + dx, y + dy);
        if (out[j] >= 0 || (pass === 'land' && mass[j] !== mass[i])) continue;
        out[j] = out[i];
        q.push(j);
      }
    }
    q.length = 0;
  }
  return out;
}

/** Parcels: the district map on 4×4 cells (2×2 where a cell holds two land masses), cut into rectangles of at most 32 tiles a side. */
const CELL = 2, MAX_CELLS = 16;
export function cityParcelRects(g: CityGrid, district: Int16Array): { x: number; y: number; w: number; h: number; b: number }[] {
  const { mass } = cityBase(g), { MX, MY, MW, MH } = g;
  const CW = Math.ceil(MW / CELL), CH = Math.ceil(MH / CELL);
  const majority = (x0: number, y0: number, n: number) => {
    const votes = new Map<number, number>(), masses = new Set<number>();
    for (let k = 0; k < n * n; k++) {
      const x = x0 + (k % n), y = y0 + Math.floor(k / n);
      if (!g.inMap(x, y)) continue;
      const i = g.idx(x, y);
      votes.set(district[i], (votes.get(district[i]) ?? 0) + 1);
      if (mass[i]) masses.add(mass[i]);
    }
    let best = -1, bn = 0;
    for (const [b, c] of votes) if (c > bn) { bn = c; best = b; }
    return { best, both: masses.size > 1 };
  };
  const cell = new Int16Array(CW * CH);
  for (let cy = 0; cy < CH; cy += 2) for (let cx = 0; cx < CW; cx += 2) {
    const big = majority(MX + cx * CELL, MY + cy * CELL, 2 * CELL);
    for (let k = 0; k < 4; k++) {
      const qx = cx + (k & 1), qy = cy + (k >> 1);
      if (qx >= CW || qy >= CH) continue;
      cell[qy * CW + qx] = big.both ? majority(MX + qx * CELL, MY + qy * CELL, CELL).best : big.best;
    }
  }
  const done = new Uint8Array(CW * CH), out: { x: number; y: number; w: number; h: number; b: number }[] = [];
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    if (done[cy * CW + cx]) continue;
    const b = cell[cy * CW + cx];
    let w = 1, h = 1;
    while (cx + w < CW && w < MAX_CELLS && !done[cy * CW + cx + w] && cell[cy * CW + cx + w] === b) w++;
    for (; cy + h < CH && h < MAX_CELLS; h++) {
      let ok = true;
      for (let k = 0; k < w && ok; k++) ok = !done[(cy + h) * CW + cx + k] && cell[(cy + h) * CW + cx + k] === b;
      if (!ok) break;
    }
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) done[(cy + j) * CW + cx + k] = 1;
    const x = MX + cx * CELL, y = MY + cy * CELL;
    out.push({ x, y, w: Math.min(w * CELL, MX + MW - x), h: Math.min(h * CELL, MY + MH - y), b });
  }
  return out;
}

export interface CitySeed { water: number; roads: number; bridges: number; crossings: number; lots: number; merged: number; parcels: number; districts: number; stranded: number; problems: string[] }

/**
 * Paint a sample city into w: the town's player `ownerId` (every technology; it runs the lines) and a player per
 * district (`ownerId:<district>`) owning that district's parcels. `keep` is land the scenario places structures on.
 */
export function seedCityMap(w: World, ownerId: string, city: CityDemo, keep: DemoRect[]): CitySeed {
  const owner = w.getOrCreatePlayer(ownerId, city.name, 0);
  owner.color = 0x9e9e9e;
  owner.tech = [...ALL_TECH_IDS];
  const { plan, grid: g, problems: planned } = cityScenario(city);
  const { MX, MY, MW, MH } = g;
  const { placeAt, xy: placesXY } = cityPlaces(g);
  const stats: CitySeed = { water: 0, roads: 0, bridges: 0, crossings: 0, lots: 0, merged: 0, parcels: 0, districts: 0, stranded: 0, problems: [...planned] };
  const kept = new Uint8Array(g.N);
  for (const r of keep) for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (g.inMap(x, y)) kept[g.idx(x, y)] = 1;

  // the districts and their parcels, each named after the place nearest it in the district
  const district = cityDistricts(g);
  const ownerOf = (b: number) => `${ownerId}:${city.districts[b].id}`;
  for (const d of city.districts) {
    if (w.players.has(`${ownerId}:${d.id}`)) continue;
    const p = w.getOrCreatePlayer(`${ownerId}:${d.id}`, d.name, DEV_FUNDS);
    // a low-rise district grows no taller than level 2 (no Steel frame or High-rise, tech.ts con3 and con5); what it
    // was seeded with stands
    p.color = d.colour; p.tech = d.lowRise ? ALL_TECH_IDS.filter((t) => t !== 'con3' && t !== 'con5') : [...ALL_TECH_IDS]; p.devUnlimited = true;
    stats.districts++;
  }
  const places = placesXY.map((p) => {
    const tx = Math.max(MX, Math.min(MX + MW - 1, Math.floor(p.x))), ty = Math.max(MY, Math.min(MY + MH - 1, Math.floor(p.y)));
    return { ...p, owner: ownerOf(Math.max(0, district[g.idx(tx, ty)])) };
  });
  for (const r of cityParcelRects(g, district)) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, own = ownerOf(Math.max(0, r.b));
    let name = city.districts[Math.max(0, r.b)].name, bd = Infinity;
    for (const p of places) { const d = Math.hypot(p.x - cx, p.y - cy) / p.reach; if (p.owner === own && d < bd) { bd = d; name = p.name; } }
    const parcel = { id: w.nextId++, owner: own, name, x: r.x, y: r.y, w: r.w, h: r.h, taxRate: DEFAULT_TAX, stats: emptyStats() };
    w.parcels.set(parcel.id, parcel);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) w.setParcelId(x, y, parcel.id);
    w.dirtyParcels.add(parcel.id);
    stats.parcels++;
  }

  // the tiles: water, roads and crossings, parks, and every block zoned by the character of the place nearest it
  const parkId = K['park'];
  const parkTile = (x: number, y: number, open: number) => {
    const o = hash2(x * 5 + 1, y * 7 + 2) < open;
    w.setTile(x, y, o ? packTile(Terrain.Grass, false, 0, 0) : packTile(Terrain.Grass, false, familyOf(parkId), 1), o ? 0 : subFor(parkId));
  };
  const blockChar = plan.blocks.map((b) => placeAt(b.cx, b.cy).c);
  /** blocks nearest a `homes` place: all homes, no services */
  const blockHomes = plan.blocks.map((b) => placeAt(b.cx, b.cy).homes);
  const blockZone = plan.blocks.map((b, n) => {
    if (blockHomes[n]) return Zone.Residential;
    const mix = city.mix?.[blockChar[n]] ?? MIX[blockChar[n]], h = hash2(b.x0 * 7 + 1, b.y0 * 13 + 3);
    let zi = 0;
    for (let acc = mix[0]; zi < 3 && h >= acc; acc += mix[++zi]);
    return ZONES[zi];
  });
  const blockGreen = plan.blocks.map((b, n) => hash2(b.x0 * 11 + 3, b.y0 * 7 + 5) < (GREEN[blockChar[n]] ?? 0));
  const parks = city.parks ?? [];
  for (let y = MY; y < MY + MH; y++) for (let x = MX; x < MX + MW; x++) {
    const i = g.idx(x, y);
    switch (plan.t[i]) {
      case LT.Water: case LT.Deck: w.setTile(x, y, packTile(Terrain.Water, false, 0, 0)); stats.water++; continue;
      case LT.Road: w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0)); stats.roads++; continue;
      case LT.Crossing: w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0)); stats.crossings++; continue;
      case LT.Park: parkTile(x, y, parks[plan.park[i]]?.heath ? 0.45 : 0.2); continue;
      case LT.Land: break;
      default: w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue;
    }
    const b = plan.block[i], c = blockChar[b], zone = blockZone[b], reach = plan.reach[i];
    if (kept[i] || !reach) { w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue; }
    if (blockGreen[b]) { parkTile(x, y, 0.45); continue; }
    if (reach === 2 && (c === 'suburb' || c === 'outer') && zone === Zone.Residential) { w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue; }
    const capped = c === 'city' ? 99 : (city.lotLevels?.[ZONE_WORD[zone]] ?? 99);
    w.setTile(x, y, packTile(Terrain.Grass, false, zone, reach === 2 ? 0 : Math.min(capped, lotLevel(c, zone, x, y))));
    stats.lots++;
  }

  // the bridges, in the style of the real ones, as the road tool lays them
  for (const b of plan.bridges) {
    const dx = b.ns ? 0 : 1, dy = b.ns ? 1 : 0;
    const bp = planBridge(b.x, b.y, dx, dy, b.len, { tile: (x, y) => w.getTile(x, y), aux: (x, y) => w.auxAt(x, y), land: () => null }, BridgeStyle[b.spec.style]);
    if (!bp.ok) { stats.problems.push(`${b.name} at (${b.x}, ${b.y}): ${bp.reason}`); continue; }
    w.placeBridge(bp.tiles!);
    stats.bridges++;
  }

  // services and car parks on a 25-tile grid, each on the frontage lot nearest its spot
  for (let cy = Math.floor(MY / 25) * 25; cy < MY + MH; cy += 25) for (let cx = Math.floor(MX / 25) * 25; cx < MX + MW; cx += 25) {
    for (const [lx, ly, kind] of SERVICES) {
      let spot = -1;
      for (let r = 0; r <= 2 && spot < 0; r++) for (let oy = -r; oy <= r && spot < 0; oy++) for (let ox = -r; ox <= r && spot < 0; ox++) {
        const x = cx + lx + ox, y = cy + ly + oy;
        if (!g.inMap(x, y)) continue;
        const i = g.idx(x, y);
        if (plan.t[i] === LT.Land && plan.reach[i] === 1 && !kept[i] && !blockGreen[plan.block[i]] && !blockHomes[plan.block[i]] && w.hasRoadAccess(x, y)) spot = i;
      }
      if (spot < 0) continue;
      const k = K[kind];
      w.setTile(g.tx(spot), g.ty(spot), packTile(Terrain.Grass, false, familyOf(k), 1), subFor(k));
    }
  }

  // merged buildings in dense blocks, through planStructure like the growth step's merges
  const env: PlaceEnv = {
    tile: (x, y) => w.getTile(x, y),
    aux: (x, y) => w.auxAt(x, y),
    sub: (x, y) => w.subAt(x, y),
    land: (x, y) => (isDemoOwner(w.parcelAt(x, y)?.owner) ? null : 'Not your land'),
  };
  plan.blocks.forEach((blk, n) => {
    const c = blockChar[n], share = DENSE_SHARE[c];
    if (!share || blockGreen[n] || hash2(blk.x0 * 3 + 11, blk.y0 * 5 + 13) >= share) return;
    // a city's height cap for the character (CityMapData.heights): taller options go, the rest stop at the cap
    const cap = city.heights?.[c] ?? 99;
    const options = DENSE[c]?.[blockZone[n]]?.filter(([, lo]) => lo <= cap).map(([k, lo, hi]): [string, number, number] => [k, lo, Math.min(hi, cap)]);
    if (!options?.length) return;
    const h = hash2(blk.x0 * 17 + 5, blk.y0 * 19 + 7);
    const mine = (x: number, y: number) => g.inMap(x, y) && plan.block[g.idx(x, y)] === n && !kept[g.idx(x, y)];
    for (let o = 0; o < options.length; o++) {
      const [kind, lo, hi] = options[(Math.floor(h * options.length) + o) % options.length];
      const k = K[kind];
      if (!k) continue;
      for (let ay = blk.y0; ay <= blk.y1; ay++) for (let ax = blk.x0; ax <= blk.x1; ax++) for (let r0 = 0; r0 < 4; r0++) {
        const p = placedFromAnchor(k, ax, ay, (r0 + Math.floor(h * 4)) & 3);
        if (!isRoad(w.getTile(p.frontX, p.frontY))) continue;
        let ok = true;
        for (let yy = p.ay; yy < p.ay + p.h && ok; yy++) for (let xx = p.ax; xx < p.ax + p.w && ok; xx++) {
          const tt = w.getTile(xx, yy);
          if (!mine(xx, yy) || w.auxAt(xx, yy) || zoneOf(tt) !== familyOf(k) || w.subAt(xx, yy)) ok = false;
        }
        if (!ok) continue;
        const v = planStructure(k, p.doorX, p.doorY, {
          ...env,
          tile: (x, y) => { const tt = w.getTile(x, y); return x >= p.ax && y >= p.ay && x < p.ax + p.w && y < p.ay + p.h ? packTile(Terrain.Grass, false, familyOf(k), 0) : tt; },
        }, p.r);
        if (!v.ok) continue;
        const level = lo + Math.floor(hash2(ax + o * 31, ay * 3 + o) * (hi - lo + 1));
        w.placeStructure(v.placed, { work: workOf(k, level), priority: 0, built: true, target: level });
        stats.merged++;
      }
    }
  });

  settleInteriors(w, MX, MY, MX + MW - 1, MY + MH - 1, 2);
  for (let y = MY; y < MY + MH - 1; y++) for (let x = MX; x < MX + MW - 1; x++) {
    let ok = true;
    for (let k = 0; k < 4 && ok; k++) {
      const qx = x + (k & 1), qy = y + (k >> 1), i = g.idx(qx, qy);
      ok = plan.t[i] === LT.Land && plan.reach[i] === 0 && !kept[i] && !w.auxAt(qx, qy);
    }
    if (ok) w.placeStructure(placedFromAnchor(GARDEN_KIND, x, y, Math.floor(hash2(x * 5 + 1, y * 7 + 3) * 4) & 3), { work: 0, priority: 0, built: true, target: 1 });
  }
  for (let y = MY; y < MY + MH; y++) for (let x = MX; x < MX + MW; x++) {
    const t = w.getTile(x, y);
    if (isRoad(t) || levelOf(t) === 0 || w.auxAt(x, y) || w.hasRoadAccess(x, y)) continue;
    const z = zoneOf(t);
    w.setTile(x, y, packTile(Terrain.Grass, false, isGrowableId(w.kindIdAt(x, y)) ? z : 0, 0), 0);
    stats.stranded++;
  }

  // round the map, a margin of plain country with the water running on out of it to the sea gates
  const M = city.margin, wet = new Set<number>(), key = (x: number, y: number) => (x + 4096) * 8192 + y + 4096;
  eachWaterTile(g, MX - M, MY - M, MX + MW + M, MY + MH + M, (x, y) => wet.add(key(x, y)));
  for (let y = MY - M; y < MY + MH + M; y++) for (let x = MX - M; x < MX + MW + M; x++) {
    if (!g.inMap(x, y)) w.setTile(x, y, packTile(wet.has(key(x, y)) ? Terrain.Water : Terrain.Grass, false, 0, 0));
  }
  return stats;
}
