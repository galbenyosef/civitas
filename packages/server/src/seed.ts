import { DEFAULT_TAX, Zone, isBuildable, packTile, terrainOf, ALL_TECH_IDS, Terrain, TICKS_PER_HOUR, FRONTIER_CHARTER, MOTORWAY_KIND, planStructure, workOf } from '@msimcity/shared';
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

/**
 * A frontier (docs/first-five.md section 0, start-from-zero option A): no Commons. One country road comes in from the
 * west and stops in the middle of what will be the first player's free FRONTIER_CHARTER² charter; at its far end stands
 * the gate (the motorway connection, kind 21) everyone arrives through. The clock starts at dawn. `World.start`,
 * `home` (the road end) and `charter` are saved with the world; net.ts grants the charter and FRONTIER_MONEY to the
 * first player who joins.
 */
export function seedFrontier(w: World) {
  const half = FRONTIER_CHARTER / 2;
  const charter = { x: -half - 4, y: -half, w: FRONTIER_CHARTER, h: FRONTIER_CHARTER }; // the road end sits a third of the way in
  const end: [number, number] = [charter.x + Math.floor(FRONTIER_CHARTER / 3), 0];
  const gateDoor: [number, number] = [charter.x - 14, 0];
  // the country road, a causeway where the seed put water, from the tile in front of the gate to the road end
  for (let x = gateDoor[0] + 1; x <= end[0]; x++) w.setTile(x, 0, packTile(Terrain.Grass, true, 0, 0));
  // the gate: its door faces the road (east), the carriageways run off west; dry land under it
  for (let dx = -2; dx <= 0; dx++) for (let dy = -2; dy <= 2; dy++) { const t = w.getTile(gateDoor[0] + dx, dy); if (!isBuildable(t)) w.setTile(gateDoor[0] + dx, dy, packTile(Terrain.Grass, false, 0, 0)); }
  const v = planStructure(MOTORWAY_KIND, gateDoor[0], gateDoor[1], {
    tile: (x, y) => w.getTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y), land: () => null,
  }, 1);
  if (v.ok) w.placeStructure(v.placed, { work: workOf(MOTORWAY_KIND, 1), priority: 0, built: true });
  else console.warn(`frontier: the gate could not be placed: ${v.reason}`);
  w.start = 'frontier'; w.home = end; w.charter = charter;
  w.tick = 6 * TICKS_PER_HOUR; // dawn
}
