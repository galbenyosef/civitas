import { DEFAULT_TAX, Zone, Terrain, isBuildable, packTile, terrainOf, ALL_TECH_IDS } from '@msimcity/shared';
import { World, emptyStats } from '../world';
import { settleInteriors } from '../sim/blocks';

/**
 * Test cities for load testing: an N×N grid of Commons-style districts.
 *
 * Each district is the 22×22 block `seedCommons` laid until 2026-10-21 (roads every 5 tiles plus the far edge, its zone
 * pattern, police / fire / hospital / builders' yard and four parking lots); the Commons itself is on a mix of block
 * sizes now (seed.ts COMMONS), and the test cities keep the old grid so load-test results stay comparable. Districts sit on a stride of
 * 22 + gap tiles. In the gap every street of the district carries straight on to the next district, so the whole
 * city is one connected road network on a regular grid; the rest of the gap is open land. Each district is its own
 * parcel (it also covers the gap to its right and below), all owned by one system player with every technology.
 *
 * With `flatten: false`, N=1 is tile-for-tile the old Commons. Each block's landlocked 2×2 middle is settled as growth would
 * (sim/blocks.ts settleInteriors): a communal garden inside a ring of homes, else deep plots built from the frontage, so no
 * door is left without a road. Fully grown (built=3) a district has 1,228 beds (it was 1,248 with stranded middles) and
 * ~1,670 jobs; after a game day the population sits at about 950. N=2/3/4/6 therefore
 * hold roughly 4× / 9× / 16× / 36× that. Deterministic: no
 * randomness, and with `flatten` (the default) water under the footprint becomes grass, so the terrain seed
 * cannot break the road grid (the Commons itself sits on water for some seeds).
 */
export const DISTRICT = 22;
const PATTERN = [Zone.Residential, Zone.Residential, Zone.Commercial, Zone.Residential, Zone.Industrial, Zone.Office, Zone.Residential, Zone.Commercial, Zone.Industrial];
const CIVIC: [number, number, number][] = [[1, 1, Zone.Police], [16, 1, Zone.Fire], [1, 16, Zone.Hospital], [16, 16, Zone.Yard]];
const LOTS: [number, number, number][] = [[6, 3, Zone.Parking], [13, 6, Zone.Parking], [4, 13, Zone.Parking], [18, 11, Zone.Parking]];

export interface CityOptions {
  districts: number;
  /** pre-built level for every zoned tile (0: homes at level 1, the rest empty, as a fresh Commons) */
  built?: number;
  /** include the four parking lots per district (default true) */
  lots?: boolean;
  /** owning player id (default 'sys', the Commons player) */
  seedOwner?: string;
  /** tiles between districts (default 2) */
  gap?: number;
  /** turn water under the footprint into grass (default true) */
  flatten?: boolean;
}
export interface DistrictRect { i: number; j: number; x: number; y: number; parcelId: number }
export interface CityLayout { n: number; gap: number; stride: number; x0: number; y0: number; span: number; districts: DistrictRect[] }

/** A street row/column inside a district: every 5th line plus the far edge. */
const isStreet = (v: number) => v % 5 === 0 || v === DISTRICT - 1;

export function cityLayout(n: number, gap = 2): Omit<CityLayout, 'districts'> {
  const stride = DISTRICT + gap;
  const span = n * DISTRICT + (n - 1) * gap;
  const x0 = -Math.floor(span / 2);
  return { n, gap, stride, x0, y0: x0, span };
}

export function seedCity(w: World, opts: CityOptions): CityLayout {
  const n = Math.max(1, Math.floor(opts.districts));
  const built = opts.built ?? 0, lots = opts.lots ?? true, gap = opts.gap ?? 2, flatten = opts.flatten ?? true;
  const ownerId = opts.seedOwner ?? 'sys';
  const owner = w.getOrCreatePlayer(ownerId, ownerId === 'sys' ? 'Commons' : ownerId, 0);
  owner.color = 0x9e9e9e;
  owner.tech = [...ALL_TECH_IDS];
  const base = cityLayout(n, gap);
  const layout: CityLayout = { ...base, districts: [] };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = base.x0 + i * base.stride, y0 = base.y0 + j * base.stride;
      const pw = DISTRICT + (i < n - 1 ? gap : 0), ph = DISTRICT + (j < n - 1 ? gap : 0);
      const name = n === 1 ? 'The Commons' : `District ${String.fromCharCode(65 + j)}${i + 1}`;
      const parcel = { id: w.nextId++, owner: owner.id, name, x: x0, y: y0, w: pw, h: ph, taxRate: DEFAULT_TAX, stats: emptyStats() };
      w.parcels.set(parcel.id, parcel);
      layout.districts.push({ i, j, x: x0, y: y0, parcelId: parcel.id });
      for (let ly = 0; ly < ph; ly++) {
        for (let lx = 0; lx < pw; lx++) {
          const x = x0 + lx, y = y0 + ly;
          w.setParcelId(x, y, parcel.id);
          let t = w.getTile(x, y);
          if (flatten && terrainOf(t) === Terrain.Water) t = packTile(Terrain.Grass, false, 0, 0);
          if (!isBuildable(t)) continue;
          if (lx >= DISTRICT || ly >= DISTRICT) {
            // the gap: streets carry straight on to the neighbouring district, the rest stays open land
            const link = (lx >= DISTRICT && ly < DISTRICT && isStreet(ly)) || (ly >= DISTRICT && lx < DISTRICT && isStreet(lx));
            w.setTile(x, y, packTile(terrainOf(t), link, 0, 0));
            continue;
          }
          const onRoad = lx % 5 === 0 || ly % 5 === 0 || lx === DISTRICT - 1 || ly === DISTRICT - 1;
          if (onRoad) { w.setTile(x, y, packTile(terrainOf(t), true, 0, 0)); continue; }
          const zone = PATTERN[(Math.floor(lx / 5) + Math.floor(ly / 5) * 2) % PATTERN.length];
          w.setTile(x, y, packTile(terrainOf(t), false, zone, built > 0 ? built : zone === Zone.Residential ? 1 : 0));
        }
      }
      for (const [lx, ly, kind] of lots ? [...CIVIC, ...LOTS] : CIVIC) {
        const t = w.getTile(x0 + lx, y0 + ly);
        if (isBuildable(t)) w.setTile(x0 + lx, y0 + ly, packTile(terrainOf(t), false, kind, 1));
      }
      // each block's landlocked 2×2 middle: a communal garden in a ring of homes, else deep plots from the frontage (sim/blocks.ts)
      settleInteriors(w, x0, y0, x0 + DISTRICT - 1, y0 + DISTRICT - 1, built);
      w.dirtyParcels.add(parcel.id);
    }
  }
  return layout;
}
