import {
  DEFAULT_TAX, Terrain, Zone, KIND_ID, ALL_TECH_IDS, packTile, isRoad, levelOf, zoneOf, isGrowableId, familyOf, subFor, hash2, placedFromAnchor, planStructure, workOf,
  planBridge, BridgeStyle, type BridgeStyleId,
  LONDON_MAP, LONDON_MARGIN, PARKS, PLACES, RESERVED, BOROUGHS, LT, geoF, lidx, inLondon, londonBase, londonScenario, placeAt, eachThamesTile, isDemoOwner,
  type Character, type DemoRect, type PlaceEnv,
} from '@msimcity/shared';
import { World, emptyStats, DEV_FUNDS } from '../world';
import { settleInteriors, GARDEN_KIND } from '../sim/blocks';

/**
 * The London demo's town (docs/demo.md "London", shared/src/demo/london.ts): paints the scenario's street plan
 * (shared/src/demo/londonMap.ts londonPlan) into a fresh World in place of seedCity's districts. The river and docks
 * are water, the roads and level crossings are the plan's, each named crossing is a road bridge in the style of the
 * real one; each block of lots between the roads is zoned by the character of the place nearest it and pre-built,
 * with merged towers and works placed through the shared placement rule where the character is dense and the lots
 * behind the frontage settled as deep plots and communal gardens (sim/blocks.ts). Deterministic: hashes only.
 *
 * The land belongs to the boroughs: each London borough is a player (`sys:<borough>`, every technology, an endless
 * treasury) whose parcels follow its real outline (BOROUGHS: polygons of real latitudes and longitudes, the river
 * the boundary between banks), each parcel named after the place nearest it in the borough, so the parcel overlay
 * reads as a map of the boroughs and the tooltips as one of the neighbourhoods. The lines belong to the town (`sys`).
 */

const K = KIND_ID as Record<string, number>;
const [MX, MY, MW, MH] = LONDON_MAP;
const N = MW * MH;
const inRect = (r: DemoRect, x: number, y: number) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
const DIRS: readonly [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/**
 * The style of each named crossing, after the real bridge: arches for the stone and iron arch bridges, girders for the
 * beam and box-girder ones, suspension where the real one hangs, Tower Bridge's bascules. Unnamed here: the tool's own
 * choice from span and hash (chooseBridgeStyle).
 */
const BRIDGE_STYLES: Record<string, BridgeStyleId> = {
  'Richmond Bridge': BridgeStyle.Arch, 'Kew Bridge': BridgeStyle.Arch, 'Chiswick Bridge': BridgeStyle.Arch,
  'Hammersmith Bridge': BridgeStyle.Suspension, 'Putney Bridge': BridgeStyle.Arch, 'Wandsworth Bridge': BridgeStyle.Girder,
  'Battersea Bridge': BridgeStyle.Arch, 'Chelsea Bridge': BridgeStyle.Suspension, 'Vauxhall Bridge': BridgeStyle.Arch,
  'Lambeth Bridge': BridgeStyle.Arch, 'Westminster Bridge': BridgeStyle.Arch, 'Waterloo Bridge': BridgeStyle.Girder,
  'Blackfriars Bridge': BridgeStyle.Arch, 'Southwark Bridge': BridgeStyle.Arch, 'London Bridge': BridgeStyle.Girder,
  'Tower Bridge': BridgeStyle.Bascule, 'Blackwall Tunnel': BridgeStyle.Girder, 'Woolwich Ferry': BridgeStyle.Suspension,
};

/** Is (px, py) inside the polygon (ray casting)? */
function inPoly(pts: readonly [number, number][], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * BOROUGHS index per map tile: the first borough whose polygon holds the tile's middle on the borough's own bank; a
 * tile none holds goes to the nearest borough over land on its bank, and the river to the nearer bank's borough, so
 * the boundary between banks runs down the middle of the river as the real one does.
 */
export function londonBoroughs(): Int16Array {
  const { bank } = londonBase();
  const out = new Int16Array(N).fill(-1);
  const polys = BOROUGHS.flatMap((b, bi) => b.polys.map((poly) => ({ bi, bank: b.bank === 'N' ? 1 : 2, pts: poly.map(([lat, lon]) => geoF(lat, lon)) })));
  const q: number[] = [];
  for (let y = MY; y < MY + MH; y++) for (let x = MX; x < MX + MW; x++) {
    const i = lidx(x, y);
    if (!bank[i]) continue;
    const p = polys.find((p) => p.bank === bank[i] && inPoly(p.pts, x + 0.5, y + 0.5));
    if (p) { out[i] = p.bi; q.push(i); }
  }
  // the rest of the land from its neighbours on the same bank, then the water from both banks at once
  for (const wet of [false, true]) {
    if (wet) for (let i = 0; i < N; i++) if (out[i] >= 0) q.push(i);
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = MX + (i % MW), y = MY + Math.floor(i / MW);
      for (const [dx, dy] of DIRS) {
        if (!inLondon(x + dx, y + dy)) continue;
        const j = lidx(x + dx, y + dy);
        if (out[j] >= 0 || (wet ? bank[j] !== 0 : bank[j] !== bank[i])) continue;
        out[j] = out[i];
        q.push(j);
      }
    }
    q.length = 0;
  }
  return out;
}

/**
 * Parcels are rectangles: the borough map on 4×4 cells, each its tiles' majority (2×2 cells where a 4×4 one holds
 * land of both banks, so the river stays the boundary), cut into rectangles of at most 32 tiles a side. Coarse cells
 * keep the count near the old 16×16 squares' (every parcel's stats go to every client when they change).
 */
const CELL = 2, MAX_CELLS = 16;
export function londonParcelRects(borough: Int16Array): { x: number; y: number; w: number; h: number; b: number }[] {
  const { bank } = londonBase();
  const CW = MW / CELL, CH = MH / CELL;
  const majority = (x0: number, y0: number, n: number) => {
    const votes = new Map<number, number>();
    let banks = 0;
    for (let k = 0; k < n * n; k++) { const i = lidx(x0 + (k % n), y0 + Math.floor(k / n)); votes.set(borough[i], (votes.get(borough[i]) ?? 0) + 1); banks |= bank[i]; }
    let best = -1, bn = 0;
    for (const [b, c] of votes) if (c > bn) { bn = c; best = b; }
    return { best, both: banks === 3 };
  };
  const cell = new Int16Array(CW * CH);
  for (let cy = 0; cy < CH; cy += 2) for (let cx = 0; cx < CW; cx += 2) {
    const big = majority(MX + cx * CELL, MY + cy * CELL, 2 * CELL);
    for (let k = 0; k < 4; k++) {
      const qx = cx + (k & 1), qy = cy + (k >> 1);
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
    out.push({ x: MX + cx * CELL, y: MY + cy * CELL, w: w * CELL, h: h * CELL, b });
  }
  return out;
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
const GREEN: Partial<Record<Character, number>> = { suburb: 0.12, outer: 0.03 };
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
/** Share of a dense character's blocks that get merged buildings, and how many at most per block (more in a bigger block). */
const DENSE_SHARE: Partial<Record<Character, number>> = { city: 0.9, westend: 0.35, civic: 0.4, inner: 0.12, industry: 0.45 };

/** Services and car parks per 25×25 cell, as in every seedCity district (local offsets; each moves to the nearest frontage lot). */
const SERVICES: [number, number, string][] = [
  [1, 1, 'police'], [16, 1, 'fire'], [1, 16, 'hospital'], [16, 16, 'yard'],
  [6, 3, 'parking'], [13, 6, 'parking'], [4, 13, 'parking'], [18, 11, 'parking'],
];

export interface LondonSeed { water: number; roads: number; bridges: number; crossings: number; lots: number; merged: number; parcels: number; boroughs: number; stranded: number; problems: string[] }

/**
 * Paint London into w: the town's player `ownerId` (every technology; it runs the lines) and a player per borough
 * (`ownerId:<borough>`) owning that borough's parcels. `keep` is land the scenario places structures on: no zones there.
 */
export function seedLondon(w: World, ownerId: string, keep: DemoRect[]): LondonSeed {
  const owner = w.getOrCreatePlayer(ownerId, 'London', 0);
  owner.color = 0x9e9e9e;
  owner.tech = [...ALL_TECH_IDS];
  const { plan, problems: planned } = londonScenario();
  const stats: LondonSeed = { water: 0, roads: 0, bridges: 0, crossings: 0, lots: 0, merged: 0, parcels: 0, boroughs: 0, stranded: 0, problems: [...planned] };
  const kept = new Uint8Array(N);
  for (const r of keep) for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (inLondon(x, y)) kept[lidx(x, y)] = 1;
  // the scenario's structures must keep off the railway corridors and the airfield
  for (const k of keep) for (const r of RESERVED.filter((q) => !q.airfield)) {
    if (k[0] < r.rect[0] + r.rect[2] && r.rect[0] < k[0] + k[2] && k[1] < r.rect[1] + r.rect[3] && r.rect[1] < k[1] + k[3]) stats.problems.push(`a placement at (${k[0]}, ${k[1]}) overlaps ${r.name}`);
  }

  // the boroughs and their parcels, each named after the place nearest it in the borough
  const borough = londonBoroughs();
  const ownerOf = (b: number) => `${ownerId}:${BOROUGHS[b].id}`;
  for (const b of BOROUGHS) {
    if (w.players.has(`${ownerId}:${b.id}`)) continue;
    const p = w.getOrCreatePlayer(`${ownerId}:${b.id}`, b.name, DEV_FUNDS);
    p.color = b.colour; p.tech = [...ALL_TECH_IDS]; p.devUnlimited = true;
    stats.boroughs++;
  }
  const places = PLACES.map(([name, lat, lon, , reach]) => {
    const [x, y] = geoF(lat, lon), tx = Math.max(MX, Math.min(MX + MW - 1, Math.floor(x))), ty = Math.max(MY, Math.min(MY + MH - 1, Math.floor(y)));
    return { name, x, y, reach: reach ?? 1, owner: ownerOf(borough[lidx(tx, ty)]) };
  });
  const heathrow = RESERVED.find((r) => r.airfield)!;
  for (const r of londonParcelRects(borough)) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, own = ownerOf(r.b);
    let name = BOROUGHS[r.b].name, bd = Infinity;
    if (inRect(heathrow.rect, Math.floor(cx), Math.floor(cy))) name = heathrow.name;
    else for (const p of places) { const d = Math.hypot(p.x - cx, p.y - cy) / p.reach; if (p.owner === own && d < bd) { bd = d; name = p.name; } }
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
  const blockZone = plan.blocks.map((b, n) => {
    const mix = MIX[blockChar[n]], h = hash2(b.x0 * 7 + 1, b.y0 * 13 + 3);
    let zi = 0;
    for (let acc = mix[0]; zi < 3 && h >= acc; acc += mix[++zi]);
    return ZONES[zi];
  });
  const blockGreen = plan.blocks.map((b, n) => hash2(b.x0 * 11 + 3, b.y0 * 7 + 5) < (GREEN[blockChar[n]] ?? 0));
  for (let y = MY; y < MY + MH; y++) for (let x = MX; x < MX + MW; x++) {
    const i = lidx(x, y);
    switch (plan.t[i]) {
      case LT.Water: case LT.Deck: w.setTile(x, y, packTile(Terrain.Water, false, 0, 0)); stats.water++; continue; // bridge decks go down below
      case LT.Road: w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0)); stats.roads++; continue;
      case LT.Crossing: w.setTile(x, y, packTile(Terrain.Grass, true, 0, 0)); stats.crossings++; continue;
      case LT.Park: parkTile(x, y, PARKS[plan.park[i]]?.heath ? 0.45 : 0.2); continue; // park tiles, with open grass between them (more on a heath)
      case LT.Land: break;
      default: w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue; // railways, the airfield, the scenario's structures
    }
    const b = plan.block[i], c = blockChar[b], zone = blockZone[b], reach = plan.reach[i];
    if (kept[i] || !reach) { w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue; }
    // commons and playing fields: some suburban blocks stay green, so the edge of town thins out
    if (blockGreen[b]) { parkTile(x, y, 0.45); continue; }
    // a lot behind the frontage: gardens behind suburban homes, zoned land elsewhere (deep plots and merges build on it)
    if (reach === 2 && (c === 'suburb' || c === 'outer') && zone === Zone.Residential) { w.setTile(x, y, packTile(Terrain.Grass, false, 0, 0)); continue; }
    w.setTile(x, y, packTile(Terrain.Grass, false, zone, reach === 2 ? 0 : lotLevel(c, zone, x, y)));
    stats.lots++;
  }

  // the bridges, as the road tool lays them
  for (const b of plan.bridges) {
    const dx = b.ns ? 0 : 1, dy = b.ns ? 1 : 0;
    const bp = planBridge(b.x, b.y, dx, dy, b.len, { tile: (x, y) => w.getTile(x, y), aux: (x, y) => w.auxAt(x, y), land: () => null }, BRIDGE_STYLES[b.name]);
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
        if (!inLondon(x, y)) continue;
        const i = lidx(x, y);
        if (plan.t[i] === LT.Land && plan.reach[i] === 1 && !kept[i] && !blockGreen[plan.block[i]] && w.hasRoadAccess(x, y)) spot = i;
      }
      if (spot < 0) continue;
      const k = K[kind];
      w.setTile(MX + (spot % MW), MY + Math.floor(spot / MW), packTile(Terrain.Grass, false, familyOf(k), 1), subFor(k));
    }
  }

  // merged buildings in dense blocks: towers in the City and Canary Wharf, stores in the West End, mid-rise homes,
  // works by the docks; every one through planStructure like the growth step's merges, anywhere in the block its
  // footprint fits on lots of the block's zone with its door on the road
  const env: PlaceEnv = {
    tile: (x, y) => w.getTile(x, y),
    aux: (x, y) => w.auxAt(x, y),
    sub: (x, y) => w.subAt(x, y),
    land: (x, y) => (isDemoOwner(w.parcelAt(x, y)?.owner) ? null : 'Not your land'),
  };
  plan.blocks.forEach((blk, n) => {
    const c = blockChar[n], share = DENSE_SHARE[c];
    if (!share || blockGreen[n] || hash2(blk.x0 * 3 + 11, blk.y0 * 5 + 13) >= share) return;
    const options = DENSE[c]?.[blockZone[n]];
    if (!options) return;
    const h = hash2(blk.x0 * 17 + 5, blk.y0 * 19 + 7);
    const mine = (x: number, y: number) => inLondon(x, y) && plan.block[lidx(x, y)] === n && !kept[lidx(x, y)];
    for (let o = 0; o < options.length; o++) {
      const [kind, lo, hi] = options[(Math.floor(h * options.length) + o) % options.length];
      const k = K[kind];
      if (!k) continue;
      for (let ay = blk.y0; ay <= blk.y1; ay++) for (let ax = blk.x0; ax <= blk.x1; ax++) for (let r0 = 0; r0 < 4; r0++) {
        const p = placedFromAnchor(k, ax, ay, (r0 + Math.floor(h * 4)) & 3);
        if (!isRoad(w.getTile(p.frontX, p.frontY))) continue;
        // only over lots of the block's own zone (empty or 1×1)
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

  // the lots behind the frontage, as growth would settle them: communal gardens in rings of homes, else deep plots
  // built from the frontage lot in front (sim/blocks.ts); a middle no frontage lot of its zone fronts stays an empty lot
  settleInteriors(w, MX, MY, MX + MW - 1, MY + MH - 1, 2);
  // pockets no road reaches: a communal garden on every 2×2 of them, open grass round it
  for (let y = MY; y < MY + MH - 1; y++) for (let x = MX; x < MX + MW - 1; x++) {
    let ok = true;
    for (let k = 0; k < 4 && ok; k++) {
      const qx = x + (k & 1), qy = y + (k >> 1), i = lidx(qx, qy);
      ok = plan.t[i] === LT.Land && plan.reach[i] === 0 && !kept[i] && !w.auxAt(qx, qy);
    }
    if (ok) w.placeStructure(placedFromAnchor(GARDEN_KIND, x, y, Math.floor(hash2(x * 5 + 1, y * 7 + 3) * 4) & 3), { work: 0, priority: 0, built: true, target: 1 });
  }

  // nothing may stand where no road reaches its door (nobody could ever get there): a lot cut off by the river, a park
  // or a railway stays an empty lot of its zone
  for (let y = MY; y < MY + MH; y++) for (let x = MX; x < MX + MW; x++) {
    const t = w.getTile(x, y);
    if (isRoad(t) || levelOf(t) === 0 || w.auxAt(x, y) || w.hasRoadAccess(x, y)) continue;
    const z = zoneOf(t);
    w.setTile(x, y, packTile(Terrain.Grass, false, isGrowableId(w.kindIdAt(x, y)) ? z : 0, 0), 0);
    stats.stranded++;
  }

  // round the map, a margin of plain country with the river running on out of it, so the noise terrain's lakes do not
  // read as more river from above
  const M = LONDON_MARGIN, wet = new Set<number>(), key = (x: number, y: number) => (x + 4096) * 8192 + y + 4096;
  eachThamesTile(MX - M, MY - M, MX + MW + M, MY + MH + M, (x, y) => wet.add(key(x, y)));
  for (let y = MY - M; y < MY + MH + M; y++) for (let x = MX - M; x < MX + MW + M; x++) {
    if (!inLondon(x, y)) w.setTile(x, y, packTile(wet.has(key(x, y)) ? Terrain.Water : Terrain.Grass, false, 0, 0));
  }
  return stats;
}
