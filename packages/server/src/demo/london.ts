import {
  DEFAULT_TAX, Terrain, Zone, KIND_ID, ALL_TECH_IDS, packTile, isRoad, levelOf, zoneOf, isGrowableId, familyOf, subFor, hash2, placedFromAnchor, planStructure, workOf,
  LONDON_MAP, THAMES, DOCKS, PLACES, PARKS, RESERVED, geoF, type Character, type DemoRect, type PlaceEnv,
} from '@msimcity/shared';
import { World, emptyStats } from '../world';

/**
 * The London demo's town (docs/demo.md "London", shared/src/demo/london.ts): paints the map into a fresh World in
 * place of seedCity's districts. The river and docks are water; the roads are the usual grid (every 5th row and
 * column) except on water, in parks and on reserved land, with a causeway of road wherever a bridge crosses; each
 * block is zoned by the character of the place nearest it, pre-built, with merged towers and works placed through
 * the shared placement rule where the character is dense; services and car parks sit on a regular grid as in every
 * seedCity district. Deterministic: hashes only, no randomness.
 *
 * Bridges are causeways: v1 has no bridge pieces and roads may not be built on water (docs/structures.md E4), so the
 * crossing's water tiles become grass with a road on them. A landmark placed across the river (Tower Bridge, standing in
 * place of its causeway until roads can cross water) keeps its footprint: those tiles become land for it to stand on,
 * neither water nor causeway.
 *
 * Railway corridors are kept clear except where a grid road meets one at right angles with road on both sides: that
 * tile stays road, and the scenario's track drag crosses it as a level crossing (docs/rail.md "Level crossings"), so
 * the line does not cut the districts either side of it apart.
 */

const K = KIND_ID as Record<string, number>;
const [MX, MY, MW, MH] = LONDON_MAP;
const inMap = (x: number, y: number) => x >= MX && y >= MY && x < MX + MW && y < MY + MH;
const idx = (x: number, y: number) => (y - MY) * MW + (x - MX);
const inRect = (r: DemoRect, x: number, y: number) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
const mod5 = (v: number) => ((v % 5) + 5) % 5;
const isGridLine = (x: number, y: number) => mod5(x) === 0 || mod5(y) === 0;

/** Catmull-Rom through the Thames points: a smooth centre line with a width at every vertex. */
function thamesLine(): { x: number; y: number; w: number }[] {
  const p = THAMES.map(([lat, lon, w]) => { const [x, y] = geoF(lat, lon); return { x, y, w }; });
  const out: { x: number; y: number; w: number }[] = [];
  const at = (i: number) => p[Math.max(0, Math.min(p.length - 1, i))];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 1.5));
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * t });
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

/** Every tile inside [x0, x1) × [y0, y1) whose centre is within half the Thames' width of its centre line. */
function eachThamesTile(x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => void) {
  const line = thamesLine();
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const r = Math.max(a.w, b.w) / 2 + 1;
    const sx0 = Math.max(x0, Math.floor(Math.min(a.x, b.x) - r)), sx1 = Math.min(x1 - 1, Math.ceil(Math.max(a.x, b.x) + r));
    const sy0 = Math.max(y0, Math.floor(Math.min(a.y, b.y) - r)), sy1 = Math.min(y1 - 1, Math.ceil(Math.max(a.y, b.y) + r));
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
      const d = Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
      if (d <= (a.w + (b.w - a.w) * t) / 2) visit(x, y);
    }
  }
}

/** Water over the map: the Thames and the docks. */
export function londonWater(): Uint8Array {
  const water = new Uint8Array(MW * MH);
  eachThamesTile(MX, MY, MX + MW, MY + MH, (x, y) => { water[idx(x, y)] = 1; });
  for (const d of DOCKS) { const r = d.rect; for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (inMap(x, y)) water[idx(x, y)] = 1; }
  return water;
}

/**
 * Bridge causeways: for each named crossing, the shortest run of water along a grid line near it (a column or a row,
 * within a block of the crossing) that has land at both ends and no other bridge uses. Returns tile indexes.
 */
export function londonBridges(water: Uint8Array): { name: string; tiles: number[] }[] {
  const out: { name: string; tiles: number[] }[] = [];
  const wet = (x: number, y: number) => inMap(x, y) && water[idx(x, y)] === 1;
  const used = new Set<string>();
  for (const [lat, lon, w, name] of THAMES) {
    if (!name) continue;
    const [x, y] = geoF(lat, lon);
    let best: number[] | null = null, bestKey = '';
    // candidate lines: the columns and rows within a block either side of the crossing
    for (const vertical of [true, false]) for (const off of [-5, 0, 5, 10]) {
      const line = Math.floor((vertical ? x : y) / 5) * 5 + off;
      const key = `${vertical ? 'c' : 'r'}${line}`;
      if (used.has(key) || Math.abs(line - (vertical ? x : y)) > 7) continue;
      const along = vertical ? y : x;
      // the water run on this line nearest the crossing
      for (let d = 0; d <= 6; d++) for (const s0 of [Math.round(along) - d, Math.round(along) + d]) {
        const tx = vertical ? line : s0, ty = vertical ? s0 : line;
        if (!wet(tx, ty)) continue;
        let a = s0, b = s0;
        while (a - s0 > -20 && (vertical ? wet(line, a - 1) : wet(a - 1, line))) a--;
        while (b - s0 < 20 && (vertical ? wet(line, b + 1) : wet(b + 1, line))) b++;
        const landA = vertical ? inMap(line, a - 1) && !wet(line, a - 1) : inMap(a - 1, line) && !wet(a - 1, line);
        const landB = vertical ? inMap(line, b + 1) && !wet(line, b + 1) : inMap(b + 1, line) && !wet(b + 1, line);
        if (landA && landB && b - a + 2 >= w && (!best || b - a + 1 < best.length)) {
          best = []; bestKey = key;
          for (let v = a; v <= b; v++) best.push(vertical ? idx(line, v) : idx(v, line));
        }
        d = 7; break;
      }
    }
    if (best) { out.push({ name, tiles: best }); used.add(bestKey); }
  }
  return out;
}

/**
 * Park index per tile (-1 for none): every block whose middle is inside a park's box, and the roads between two such
 * blocks, so the roads round a park's edge stay.
 */
export function londonParks(): Int16Array {
  const park = new Int16Array(MW * MH).fill(-1);
  PARKS.forEach((p, n) => {
    const [x0, y0] = geoF(p.box[0], p.box[1]), [x1, y1] = geoF(p.box[2], p.box[3]);
    const blockIn = (bx: number, by: number) => { const cx = bx * 5 + 2.5, cy = by * 5 + 2.5; return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1; };
    for (let y = Math.floor(y0) - 5; y <= Math.ceil(y1) + 5; y++) for (let x = Math.floor(x0) - 5; x <= Math.ceil(x1) + 5; x++) {
      if (!inMap(x, y)) continue;
      const bx = Math.floor(x / 5), by = Math.floor(y / 5), lx = mod5(x), ly = mod5(y);
      const inside = lx && ly ? blockIn(bx, by)
        : lx ? blockIn(bx, by) && blockIn(bx, by - 1)
        : ly ? blockIn(bx, by) && blockIn(bx - 1, by)
        : blockIn(bx, by) && blockIn(bx - 1, by) && blockIn(bx, by - 1) && blockIn(bx - 1, by - 1);
      if (inside) park[idx(x, y)] = n;
    }
  });
  return park;
}

const PLACE_XY = PLACES.map(([name, lat, lon, c, reach]) => { const [x, y] = geoF(lat, lon); return { name, x, y, c, reach: reach ?? 1 }; });
/** The place nearest (x, y), each place's distance divided by its reach. */
export function placeAt(x: number, y: number) {
  let best = PLACE_XY[0], bd = Infinity;
  for (const p of PLACE_XY) { const d = Math.hypot(p.x - x, p.y - y) / p.reach; if (d < bd) { bd = d; best = p; } }
  return best;
}

/** Zone shares per character: residential, commercial, office, industrial. */
const MIX: Record<Character, [number, number, number, number]> = {
  city: [0.04, 0.22, 0.74, 0],
  westend: [0.2, 0.55, 0.25, 0],
  civic: [0.2, 0.2, 0.6, 0],
  inner: [0.7, 0.18, 0.12, 0],
  outer: [0.68, 0.18, 0.06, 0.08],
  suburb: [0.74, 0.16, 0.03, 0.07],
  industry: [0.08, 0.1, 0.02, 0.8],
};
/** Share of a character's blocks left green (commons, playing fields). */
const GREEN: Partial<Record<Character, number>> = { suburb: 0.25, outer: 0.08 };
const ZONES = [Zone.Residential, Zone.Commercial, Zone.Office, Zone.Industrial];
/**
 * 1×1 level (1-3) for a lot: the character's usual level with a per-lot nudge. Homes thin out towards the suburbs;
 * shops, offices and works stay full size everywhere, so every neighbourhood has jobs near it (a newcomer's job search
 * is a bounded breadth-first search, and one that finds nothing costs its whole budget).
 */
function lotLevel(c: Character, zone: number, x: number, y: number): number {
  const h = hash2(x * 31 + 7, y * 17 + 3);
  if (zone !== Zone.Residential) return h < 0.1 ? 2 : 3;
  switch (c) {
    case 'suburb': return h < 0.85 ? 1 : 2;
    case 'outer': return h < 0.6 ? 1 : h < 0.92 ? 2 : 3;
    case 'inner': return h < 0.5 ? 2 : 3;
    default: return h < 0.1 ? 2 : 3;
  }
}

/** Merged buildings a dense block may hold: kind, level range. Tried in order of the block's hash. */
const DENSE: Partial<Record<Character, Partial<Record<number, [string, number, number][]>>>> = {
  city: {
    [Zone.Office]: [['off-hq', 6, 7], ['off-tower', 4, 5], ['off-tower', 5, 5], ['off-hq', 7, 7]],
    [Zone.Commercial]: [['com-hotel', 6, 7], ['com-store', 4, 5]],
  },
  westend: { [Zone.Commercial]: [['com-store', 4, 5], ['com-centre', 5, 6]], [Zone.Office]: [['off-tower', 4, 5]] },
  civic: { [Zone.Office]: [['off-tower', 4, 5], ['off-hq', 6, 6]] },
  inner: { [Zone.Residential]: [['res-midrise', 4, 4], ['res-block', 5, 5], ['res-tower', 6, 6]] },
  industry: { [Zone.Industrial]: [['ind-works', 5, 5], ['ind-depot', 3, 4], ['ind-plant', 6, 7]] },
};
/** Share of a dense character's blocks that get merged buildings. */
const DENSE_SHARE: Partial<Record<Character, number>> = { city: 0.9, westend: 0.35, civic: 0.4, inner: 0.12, industry: 0.45 };

/** Services and car parks per 25×25 cell, as in every seedCity district (local offsets, all beside a road). */
const SERVICES: [number, number, string][] = [
  [1, 1, 'police'], [16, 1, 'fire'], [1, 16, 'hospital'], [16, 16, 'yard'],
  [6, 3, 'parking'], [13, 6, 'parking'], [4, 13, 'parking'], [18, 11, 'parking'],
];

export interface LondonSeed { water: number; roads: number; causeways: number; crossings: number; lots: number; merged: number; parcels: number; stranded: number; problems: string[] }

/**
 * Paint London into w for `owner` (every technology), parcels named after the nearest place. `keep` is land the
 * scenario places structures on: no roads and no zones there.
 */
export function seedLondon(w: World, ownerId: string, keep: DemoRect[]): LondonSeed {
  const owner = w.getOrCreatePlayer(ownerId, 'London', 0);
  owner.color = 0x9e9e9e;
  owner.tech = [...ALL_TECH_IDS];
  const water = londonWater();
  const bridges = londonBridges(water);
  const causeway = new Uint8Array(MW * MH);
  for (const b of bridges) for (const i of b.tiles) causeway[i] = 1;
  const park = londonParks();
  const reserved = (x: number, y: number) => RESERVED.some((r) => inRect(r.rect, x, y)) || keep.some((r) => inRect(r, x, y));
  const stats: LondonSeed = { water: 0, roads: 0, causeways: 0, crossings: 0, lots: 0, merged: 0, parcels: 0, stranded: 0, problems: [] };
  // a grid road over a railway corridor at right angles, with road on both sides: kept, for a level crossing. Never at
  // a corridor's ends or corners (the track turns or stops there) nor where a station or a park stops the road
  const corridors = RESERVED.filter((r) => !r.airfield);
  const gridRoad = (x: number, y: number) => inMap(x, y) && isGridLine(x, y) && (causeway[idx(x, y)] === 1 || (!water[idx(x, y)] && !reserved(x, y) && park[idx(x, y)] < 0));
  const crossing = (x: number, y: number) => {
    const on = corridors.filter((r) => inRect(r.rect, x, y));
    if (on.length !== 1 || keep.some((r) => inRect(r, x, y))) return false;
    const [rx, ry, rw] = on[0].rect, alongX = rw > 1;
    if (alongX ? x === rx || x === rx + rw - 1 || mod5(x) !== 0 : y === ry || y === ry + on[0].rect[3] - 1 || mod5(y) !== 0) return false;
    return alongX ? gridRoad(x, y - 1) && gridRoad(x, y + 1) : gridRoad(x - 1, y) && gridRoad(x + 1, y);
  };
  // the scenario's structures must keep off the railway corridors and the airfield
  for (const k of keep) for (const r of RESERVED.filter((q) => !q.airfield)) {
    if (k[0] < r.rect[0] + r.rect[2] && r.rect[0] < k[0] + k[2] && k[1] < r.rect[1] + r.rect[3] && r.rect[1] < k[1] + k[3]) stats.problems.push(`a placement at (${k[0]}, ${k[1]}) overlaps ${r.name}`);
  }

  // parcels: 16×16 squares, each named after the place nearest its middle
  const P = 16;
  for (let py = MY; py < MY + MH; py += P) for (let px = MX; px < MX + MW; px += P) {
    const name = placeAt(px + P / 2, py + P / 2).name;
    const parcel = { id: w.nextId++, owner: ownerId, name, x: px, y: py, w: P, h: P, taxRate: DEFAULT_TAX, stats: emptyStats() };
    w.parcels.set(parcel.id, parcel);
    for (let y = py; y < py + P; y++) for (let x = px; x < px + P; x++) w.setParcelId(x, y, parcel.id);
    w.dirtyParcels.add(parcel.id);
    stats.parcels++;
  }

  const parkId = K['park'];
  const blockChar = new Map<number, Character>();
  for (let y = MY; y < MY + MH; y++) for (let x = MX; x < MX + MW; x++) {
    const i = idx(x, y);
    const kept = keep.some((r) => inRect(r, x, y));
    if (causeway[i] && !kept) { w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0)); stats.causeways++; continue; }
    if (water[i] && !kept) { w.setTile(x, y, packTile(Terrain.Water, false, 0, 0)); stats.water++; continue; }
    if (crossing(x, y)) { w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0)); stats.crossings++; continue; }
    if (reserved(x, y)) { w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue; }
    if (park[i] >= 0) {
      // park tiles, with open grass between them (more on a heath)
      const open = hash2(x * 5 + 1, y * 7 + 2) < (PARKS[park[i]].heath ? 0.45 : 0.2);
      w.setTile(x, y, open ? packTile(Terrain.Grass, false, 0, 0) : packTile(Terrain.Grass, false, familyOf(parkId), 1), open ? 0 : subFor(parkId));
      continue;
    }
    if (isGridLine(x, y)) { w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0)); stats.roads++; continue; }
    const bx = Math.floor(x / 5), by = Math.floor(y / 5);
    const place = placeAt(bx * 5 + 2.5, by * 5 + 2.5);
    const c = place.c;
    blockChar.set((bx + 2048) * 4096 + by + 2048, c);
    // commons and playing fields: some suburban blocks stay green, so the edge of town thins out
    if (hash2(bx * 11 + 3, by * 7 + 5) < (GREEN[c] ?? 0)) {
      const open = hash2(x * 5 + 1, y * 7 + 2) < 0.45;
      w.setTile(x, y, open ? packTile(Terrain.Grass, false, 0, 0) : packTile(Terrain.Grass, false, familyOf(parkId), 1), open ? 0 : subFor(parkId));
      continue;
    }
    const mix = MIX[c], h = hash2(bx * 7 + 1, by * 13 + 3);
    let zi = 0;
    for (let acc = mix[0]; zi < 3 && h >= acc; acc += mix[++zi]);
    const zone = ZONES[zi];
    const lx = mod5(x), ly = mod5(y), inner = lx >= 2 && lx <= 3 && ly >= 2 && ly <= 3;
    // the four inner lots of a block have no road: gardens behind suburban homes, zoned land elsewhere (merges use it)
    if (inner && (c === 'suburb' || c === 'outer') && zone === Zone.Residential) { w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue; }
    w.setTile(x, y, packTile(Terrain.Grass, false, zone, inner ? 0 : lotLevel(c, zone, x, y)));
    stats.lots++;
  }

  // nothing may stand where no road reaches its door (nobody could ever get there): the parks' inner tiles stay open
  // grass, and a lot cut off by the river, a park or a railway corridor stays an empty lot of its zone
  for (let y = MY; y < MY + MH; y++) for (let x = MX; x < MX + MW; x++) {
    const t = w.getTile(x, y);
    if (isRoad(t) || levelOf(t) === 0 || w.auxAt(x, y) || w.hasRoadAccess(x, y)) continue;
    const z = zoneOf(t);
    w.setTile(x, y, packTile(Terrain.Grass, false, isGrowableId(w.kindIdAt(x, y)) ? z : 0, 0), 0);
    stats.stranded++;
  }

  // services and car parks on a 25-tile grid, where the lot is ordinary town beside a road
  for (let cy = Math.floor(MY / 25) * 25; cy < MY + MH; cy += 25) for (let cx = Math.floor(MX / 25) * 25; cx < MX + MW; cx += 25) {
    for (const [lx, ly, kind] of SERVICES) {
      const x = cx + lx, y = cy + ly;
      if (!inMap(x, y) || water[idx(x, y)] || park[idx(x, y)] >= 0 || reserved(x, y) || isGridLine(x, y) || !w.hasRoadAccess(x, y)) continue;
      const k = K[kind];
      w.setTile(x, y, packTile(Terrain.Grass, false, familyOf(k), 1), subFor(k));
    }
  }

  // merged buildings in dense blocks: towers in the City and Canary Wharf, stores in the West End, mid-rise homes,
  // works by the docks; every one through planStructure like the growth step's merges
  const env: PlaceEnv = {
    tile: (x, y) => w.getTile(x, y),
    aux: (x, y) => w.auxAt(x, y),
    sub: (x, y) => w.subAt(x, y),
    land: (x, y) => (inMap(x, y) && w.parcelAt(x, y)?.owner === ownerId ? null : 'Not your land'),
  };
  for (const [key, c] of blockChar) {
    const bx = Math.floor(key / 4096) - 2048, by = (key % 4096) - 2048;
    const share = DENSE_SHARE[c];
    if (!share || hash2(bx * 3 + 11, by * 5 + 13) >= share) continue;
    const x0 = bx * 5 + 1, y0 = by * 5 + 1;
    const t = w.getTile(x0, y0);
    const options = DENSE[c]?.[(t >> 3) & 15];
    if (!options) continue;
    // fill the block: start at a hashed option and corner, try every option at every corner and turn
    const h = hash2(bx * 17 + 5, by * 19 + 7);
    for (let n = 0; n < 4; n++) {
      const [kind, lo, hi] = options[(Math.floor(h * options.length) + n) % options.length];
      const k = K[kind];
      if (!k) continue;
      const level = lo + Math.floor(hash2(bx + n * 31, by * 3 + n) * (hi - lo + 1));
      for (let corner = 0; corner < 4; corner++) for (let r = 0; r < 4; r++) {
        const p0 = placedFromAnchor(k, 0, 0, (r + Math.floor(h * 4)) & 3);
        const ax = corner & 1 ? x0 + 4 - p0.w : x0, ay = corner & 2 ? y0 + 4 - p0.h : y0;
        const p = placedFromAnchor(k, ax, ay, p0.r);
        if (p.ax < x0 || p.ay < y0 || p.ax + p.w > x0 + 4 || p.ay + p.h > y0 + 4) continue;
        // only over lots of the block's own zone (empty or 1×1)
        let ok = true;
        for (let yy = p.ay; yy < p.ay + p.h && ok; yy++) for (let xx = p.ax; xx < p.ax + p.w && ok; xx++) {
          const tt = w.getTile(xx, yy);
          if (w.auxAt(xx, yy) || ((tt >> 3) & 15) !== familyOf(k) || w.subAt(xx, yy)) ok = false;
        }
        if (!ok) continue;
        const v = planStructure(k, p.doorX, p.doorY, {
          ...env,
          tile: (x, y) => { const tt = w.getTile(x, y); return x >= p.ax && y >= p.ay && x < p.ax + p.w && y < p.ay + p.h ? packTile(Terrain.Grass, false, familyOf(k), 0) : tt; },
        }, p.r);
        if (!v.ok) continue;
        w.placeStructure(v.placed, { work: workOf(k, level), priority: 0, built: true, target: level });
        stats.merged++;
      }
    }
  }
  // round the map, a margin of plain country with the river running on out of it, so the noise terrain's lakes do not
  // read as more river from above
  const M = 24, wet = new Set<number>(), key = (x: number, y: number) => (x + 4096) * 8192 + y + 4096;
  eachThamesTile(MX - M, MY - M, MX + MW + M, MY + MH + M, (x, y) => wet.add(key(x, y)));
  for (let y = MY - M; y < MY + MH + M; y++) for (let x = MX - M; x < MX + MW + M; x++) {
    if (!inMap(x, y)) w.setTile(x, y, packTile(wet.has(key(x, y)) ? Terrain.Water : Terrain.Grass, false, 0, 0));
  }
  return stats;
}
