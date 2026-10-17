import { DEFAULT_TAX, Zone, isBuildable, packTile, terrainOf, ALL_TECH_IDS } from '@msimcity/shared';
import { World, emptyStats } from './world';
import { settleInteriors } from './sim/blocks';

/**
 * A fresh world gets a small public "Commons" district around the origin so
 * there is immediately somewhere for citizens to live and work. It is owned by
 * a system player; real players buy land around it.
 */
export function seedCommons(w: World, built = 0) {
  const sys = w.getOrCreatePlayer('sys', 'Commons', 0);
  sys.color = 0x9e9e9e;
  sys.tech = [...ALL_TECH_IDS]; // the Commons has every technology, so it shows what the tree leads to
  const x0 = -11, y0 = -11, size = 22;
  const parcel = { id: w.nextId++, owner: sys.id, name: 'The Commons', x: x0, y: y0, w: size, h: size, taxRate: DEFAULT_TAX, stats: emptyStats() };
  w.parcels.set(parcel.id, parcel);
  const pattern = [Zone.Residential, Zone.Residential, Zone.Commercial, Zone.Residential, Zone.Industrial, Zone.Office, Zone.Residential, Zone.Commercial, Zone.Industrial];
  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const x = x0 + lx, y = y0 + ly;
      w.setParcelId(x, y, parcel.id);
      const t = w.getTile(x, y);
      if (!isBuildable(t)) continue;
      const onRoad = lx % 5 === 0 || ly % 5 === 0 || lx === size - 1 || ly === size - 1;
      if (onRoad) { w.setTile(x, y, packTile(terrainOf(t), true, 0, 0)); continue; }
      const bx = Math.floor(lx / 5), by = Math.floor(ly / 5);
      const zone = pattern[(bx + by * 2) % pattern.length];
      // homes start built so the first citizens exist to staff the yard; everything else is built by them
      // (unless a dev start asks for a ready-made town)
      w.setTile(x, y, packTile(terrainOf(t), false, zone, built > 0 ? built : zone === Zone.Residential ? 1 : 0));
    }
  }
  // services and a builders' yard, already complete so the district works from day one
  const civic: [number, number, number][] = [[1, 1, Zone.Police], [16, 1, Zone.Fire], [1, 16, Zone.Hospital], [16, 16, Zone.Yard],
    [6, 3, Zone.Parking], [13, 6, Zone.Parking], [4, 13, Zone.Parking], [18, 11, Zone.Parking]]; // lots sit against a road
  for (const [lx, ly, kind] of civic) {
    const t = w.getTile(x0 + lx, y0 + ly);
    if (isBuildable(t)) w.setTile(x0 + lx, y0 + ly, packTile(terrainOf(t), false, kind, 1));
  }
  // each block's landlocked 2×2 middle: a communal garden in a ring of homes, else deep plots from the frontage (sim/blocks.ts)
  settleInteriors(w, x0, y0, x0 + size - 1, y0 + size - 1, built);
  w.dirtyParcels.add(parcel.id);
}
