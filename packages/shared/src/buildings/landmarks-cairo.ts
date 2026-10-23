import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { office } from './office';
import { library } from './leisure';
import { slab, tree, lampPost, flags, PAVING } from './tierkit';

/**
 * Cairo landmarks (docs/buildings.md "Landmarks"): the monuments of Giza and the great buildings of the medieval and
 * modern city, tagged 'world' and 'cairo', rungs of the 'cairo' collection (groups.ts), tiers 1-5, their tools unlocked
 * only by the locked tech node 'wld1' (tech.ts) like the New York and London landmarks. Kind ids 155-159 (see
 * landmarks-world.ts for the world allocation). Scale: about 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   155 the Great Pyramid of Giza: a library-family daytime attraction, the smooth golden pyramid to a point, its
 *       entrance passage on the north (road) face
 *   156 the Sphinx: a library-family attraction, the reclining lion body and the head, stylised from primitives on
 *       its plateau
 *   157 the Pyramid of Khafre: a library-family attraction, slightly smaller, keeping its flat capstone of polished
 *       stone at the top of the slope
 *   158 the Cairo Tower: an office tower, the lattice concrete cylinder on its podium, the restaurant ring under the
 *       mast at the top
 *   159 the Sultan Hassan Mosque: a library-family attraction, the Mamluk mosque and madrasa, its dome behind the
 *       great portal, pencil minarets at the corners
 */

const TAGS = ['world', 'cairo'];
const attractionBase = {
  code: library.code, family: 'leisure' as const,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic' as const,
  occupation: library.occupation, lot: { wage: 16 }, landmark: true, tags: TAGS, group: 'cairo',
};
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 16 }, landmark: true, tags: TAGS, group: 'cairo',
};

// ================================================================= 155 the Great Pyramid of Giza

/**
 * The smooth golden pyramid to a point: one taper in the Egyptian slope (about 1.27 tiles up per tile in), standing on
 * the sand of the Giza plateau. The original entrance is the descending passage on the north face: a dark block standing
 * proud of the slope at the base, on the road side. The excavation lamps and palms line the approach.
 */
const pyramidOps = (): Op[] => {
  const ops: Op[] = [slab(4, 4, 'sand')];
  // the pyramid itself, one smooth taper to a point, base 3.6 so an apron of plateau is free in front
  ops.push(['taper', 3.6, 3.6, 0, 0, 2.3, 0, 0.02, 0, 'gold']);
  // the descending passage entrance: a dark block proud of the sloping face, which at its top has receded to z = 1.53
  ops.push(['box', 0.34, 0.34, 0.15, 0, 0.02, 1.72, 'door']);
  // the approach: palms and excavation lamps either side of the entrance, small flags along the front edge
  ops.push(...tree(-1.55, 1.85, 0.6), ...tree(1.55, 1.85, 0.6));
  ops.push(...lampPost(-0.75, 1.92, 0.36, 'marquee', 0.02), ...lampPost(0.75, 1.92, 0.36, 'marquee', 0.02));
  ops.push(...flags(-0.24, 1.94, 3, 0.24, ['red', 'white', 'gold'], 0.02));
  return ops;
};

export const greatPyramid: KindDef = {
  ...attractionBase, id: 'great-pyramid', name: 'the Great Pyramid of Giza', kindId: 155, tier: 1,
  occupation: { ...library.occupation!, name: 'pyramid guide' },
  footprint: { w: 4, h: 4, door: [1, 3] },
  blurb: 'The last wonder of the ancient world: two million golden blocks rising in one smooth slope to a point, the tomb of Khufu on the Giza plateau west of the Nile, entered down a passage on its north face.',
  howTo: 'A 4×4 plot on the edge of town, its north face and entrance passage towards the road. A daytime attraction that draws families, retirees and visitors from across the map. World landmark: unlock rule to be decided.',
  tool: { id: 'greatpyramid', key: '', label: 'Great Pyramid', color: '#d8b25a' },
  attrs: {
    ...library.attrs, visitorCapacity: 150, ticket: 20, openHours: [9, 17.5], stay: [1.5, 2.5], leisureValue: 9, radius: 32,
    dayAppeal: 1.5, eveningAppeal: 0.1, retireeAppeal: 2.0, childAppeal: 2.0, title: 'the Great Pyramid of Giza',
  },
  levels: [{
    capacity: 24, wage: 16, cost: 9000, upkeep: 60, work: 2800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the smooth golden pyramid to a point, the entrance passage on the north face', height: 2.32, ops: pyramidOps() },
    ],
  }],
};

// ================================================================= 156 the Sphinx

const SANDSTONE = 0xc9ae74, SANDSTONE_LT = 0xd4ba86;

/**
 * The Sphinx on its plateau, stylised from primitives: the reclining lion body a long taper, haunches high at the back
 * and shoulders low at the front; the paws stretching forward; the head with its flaring nemes headdress above. All on
 * a slab of desert sand with two palms behind.
 */
const sphinxOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, 'sand')];
  // the lion body: long and low, wider at the haunches (the back) than the shoulders (the front)
  ops.push(['taper', 0.8, 2.1, 0.6, 1.5, 0.5, 0, 0.02, -0.15, SANDSTONE]);
  // the paws, stretching out in front
  ops.push(['box', 0.22, 0.16, 0.5, -0.17, 0.02, 1.15, SANDSTONE_LT], ['box', 0.22, 0.16, 0.5, 0.17, 0.02, 1.15, SANDSTONE_LT]);
  // the tail along the right flank
  ops.push(['box', 0.04, 0.05, 0.9, 0.42, 0.06, -0.3, SANDSTONE]);
  // the head on the shoulders, and the flaring nemes headdress behind it
  ops.push(['box', 0.4, 0.38, 0.36, 0, 0.52, 0.45, SANDSTONE_LT]);
  ops.push(['box', 0.48, 0.4, 0.24, 0, 0.5, 0.32, SANDSTONE]);
  // the plateau behind: a pair of palms
  ops.push(...tree(-1.25, -1.25, 0.55), ...tree(1.25, -1.25, 0.5));
  return ops;
};

export const sphinx: KindDef = {
  ...attractionBase, id: 'sphinx', name: 'the Sphinx', kindId: 156, tier: 2,
  occupation: { ...library.occupation!, name: 'sphinx guide' },
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The sentinel of the necropolis: the body of a lion couchant with the head of a pharaoh in his nemes headdress, carved from the living rock of the plateau and gazing east over the Nile.',
  howTo: 'A 3×3 plot beside the road, its paws and face towards the street. A quiet daytime attraction that children and retirees especially love. World landmark: unlock rule to be decided.',
  tool: { id: 'sphinx', key: '', label: 'Sphinx', color: '#c9ae74' },
  attrs: {
    ...library.attrs, visitorCapacity: 100, ticket: 15, openHours: [9, 17.5], stay: [1, 2], leisureValue: 8, radius: 26,
    dayAppeal: 1.4, eveningAppeal: 0.1, retireeAppeal: 2.2, childAppeal: 1.8, title: 'the Sphinx',
  },
  levels: [{
    capacity: 16, wage: 16, cost: 8000, upkeep: 55, work: 2600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the reclining lion body and the head with its nemes headdress, on the sand plateau', height: 0.9, ops: sphinxOps() },
    ],
  }],
};

// ================================================================= 157 the Pyramid of Khafre

/**
 * Khafre's pyramid, a little smaller than his father's, drawn in a slightly paler gold. Where the casing is stripped
 * elsewhere it survives here: the slope runs up to a flat capstone of polished stone, a pale block catching the light
 * at the top. Palms at the corners of its plateau.
 */
const khafreOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, 'sand')];
  // the slope, a touch under the Great Pyramid's, running to a small flat top
  ops.push(['taper', 2.6, 2.6, 0.26, 0.26, 1.55, 0, 0.02, 0, 0xd4b168]);
  // the capstone of polished stone on the flat top
  ops.push(['box', 0.3, 0.1, 0.3, 0, 1.57, 0, 0xf2ede0]);
  // palms at the corners
  ops.push(...tree(-1.38, -1.42, 0.45), ...tree(1.38, 1.42, 0.5));
  return ops;
};

export const khafre: KindDef = {
  ...attractionBase, id: 'pyramid-of-khafre', name: 'the Pyramid of Khafre', kindId: 157, tier: 3,
  occupation: { ...library.occupation!, name: 'egyptologist' },
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The second pyramid of Giza, Khafre\'s tomb: a little smaller than the Great Pyramid but keeping its polished casing capstone at the top of the slope, which is why it can seem the taller from below.',
  howTo: 'A 3×3 plot near the road. A daytime attraction; pair it with the Sphinx or the Great Pyramid so visitors wander between them. World landmark: unlock rule to be decided.',
  tool: { id: 'khafre', key: '', label: 'Pyramid of Khafre', color: '#d4b168' },
  attrs: {
    ...library.attrs, visitorCapacity: 90, ticket: 15, openHours: [9, 17.5], stay: [1, 2], leisureValue: 8, radius: 26,
    dayAppeal: 1.35, eveningAppeal: 0.1, retireeAppeal: 2.0, childAppeal: 1.7, title: 'the Pyramid of Khafre',
  },
  levels: [{
    capacity: 16, wage: 16, cost: 9500, upkeep: 60, work: 2800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the smaller golden slope with its flat capstone of polished stone', height: 1.67, ops: khafreOps() },
    ],
  }],
};

// ================================================================= 158 the Cairo Tower

const CONCRETE = 0xbdb7ab, CONCRETE_LT = 0xcfc9bc, CONCRETE_DK = 0x9a948a;

/**
 * The lattice concrete cylinder over Zamalek: a windowed podium on the pavement, then the shaft — a lathe whose facets
 * alternate dark, reading as the open concrete lattice — bulging into the restaurant ring at the top with its mast and
 * aircraft light. Every stage stands clear of the podium's walls, so no window is ever covered.
 */
const cairoTowerOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the podium: a concrete base, the door on the street front under its porch
  ops.push(['box', 1.7, 0.6, 1.7, 0, 0.02, 0, CONCRETE_LT, true, { name: 'base', facade: { storeys: 3, bays: 5, margin: 0.08, ground: 'plain', top: 0.1 } }]);
  ops.push(['door', 'base', 'front', 2], ['porch', 'base', 'front', 1, 3, 'charcoal']);
  // the lattice shaft: a cylinder whose alternate facets are dark concrete, from the podium top to the restaurant
  ops.push(['lathe', 0, 0.62, 0, CONCRETE, [0.5, 0, 0.5, 3.0, 0.36, 3.0], { seg: 12, stripe: CONCRETE_DK, every: 2, width: 1 }]);
  // the restaurant: a ring with windows that bulges over the shaft, then the roof, mast and aircraft light
  ops.push(['lathe', 0, 3.62, 0, 0xc7c2b6, [0.7, 0, 0.76, 0.1, 0.76, 0.28, 0.68, 0.34], { seg: 16, win: 'office' }]);
  ops.push(['cyl', 0.5, 0.5, 0.06, 0, 3.96, 0, CONCRETE_DK, 12]);
  ops.push(['cyl', 0.008, 0.02, 0.5, 0, 4.02, 0, 'steel', 6]);
  ops.push(['cyl', 0.03, 0.03, 0.05, 0, 4.52, 0, 'red', 6]);
  // the pavement: flags, street lamps, a pair of trees
  ops.push(...flags(-0.6, 1.42, 4, 0.4, ['red', 'white', 'red'], 0.02));
  ops.push(...lampPost(-0.78, 1.44, 0.36, 'marquee', 0.02), ...lampPost(0.78, 1.44, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.28, 1.2, 0.6), ...tree(1.28, 1.2, 0.6));
  return ops;
};

export const cairoTower: KindDef = {
  ...towerBase, id: 'cairo-tower', name: 'the Cairo Tower', kindId: 158, tier: 4,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The concrete lotus of Zamalek: a lattice-work cylinder 187 metres high, built in the sixties, its revolving restaurant under the mast the best view in Cairo.',
  howTo: 'A 3×3 plot on an avenue among offices; a big workplace, so give it buses or a station. World landmark: unlock rule to be decided.',
  tool: { id: 'cairotower', key: '', label: 'Cairo Tower', color: '#9fb0c9' },
  levels: [{
    capacity: 300, wage: 45, cost: 18000, upkeep: 120, work: 4200, parking: { surface: 0, underground: 65 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the lattice concrete cylinder on its podium, the restaurant ring under the mast', height: 4.57, ops: cairoTowerOps() },
    ],
  }],
};

// ================================================================= 159 the Sultan Hassan Mosque

const MAMLUK = 0xd3c9b4, MAMLUK_DK = 0xc4b89e, DOME = 0x8f949c;

/** A pencil minaret: a stone base, the shaft, a balcony ring, the upper stage and the dark point. */
const minaret = (x: number, z: number): Op[] => [
  ['box', 0.24, 0.44, 0.24, x, 0.02, z, MAMLUK_DK],
  ['cyl', 0.075, 0.09, 1.0, x, 0.46, z, MAMLUK, 10],
  ['cyl', 0.13, 0.13, 0.05, x, 1.46, z, MAMLUK_DK, 10],
  ['cyl', 0.055, 0.055, 0.34, x, 1.51, z, MAMLUK, 8],
  ['cone', 0.06, 0.16, x, 1.85, z, DOME, 8],
];

/**
 * The Mamluk mosque and madrasa of Sultan Hassan: the great prayer hall across the back with its stone dome on a drum,
 * the tall pishtaq portal standing proud of the hall's front wall — exactly three window cells wide, so no window is
 * half-hidden — the courtyard with its ablutions fountain in front, and a pencil minaret at each front corner.
 */
const mosqueOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the prayer hall, its windows by the facade grid
  ops.push(['box', 2.3, 0.72, 1.3, 0, 0.02, -0.5, MAMLUK, true, { name: 'hall', facade: { storeys: 3, bays: 7, sideBays: 3, margin: 0.05, top: 0.06 } }]);
  ops.push(['cornice', 'hall', 3, MAMLUK_DK]);
  ops.push(['door', 'hall', 'front', 3]);
  // the great portal: three whole window cells wide, standing clear of the front wall, taller than the hall
  ops.push(['box', 0.95, 0.85, 0.14, 0, 0.02, 0.22, MAMLUK_DK]);
  // the dome on its drum over the hall
  ops.push(['cyl', 0.34, 0.38, 0.16, 0, 0.74, -0.5, MAMLUK_DK, 12]);
  ops.push(['lathe', 0, 0.9, -0.5, DOME, [0.38, 0, 0.38, 0.02, 0.32, 0.14, 0.22, 0.24, 0.09, 0.31, 0, 0.34], { seg: 16 }]);
  ops.push(['cyl', 0.012, 0.012, 0.1, 0, 1.24, -0.5, 'gold', 6]);
  // the courtyard: gravel, the ablutions fountain, and the corner minarets
  ops.push(['box', 2.3, 0.006, 1.1, 0, 0.02, 0.75, 'gravel']);
  ops.push(['cyl', 0.16, 0.18, 0.05, 0, 0.026, 0.85, 'stone', 10], ['cyl', 0.13, 0.13, 0.052, 0, 0.026, 0.85, 'pond', 10]);
  ops.push(...minaret(-1.02, 0.95), ...minaret(1.02, 0.95));
  ops.push(...tree(-1.28, -1.28, 0.55), ...tree(1.28, -1.28, 0.5));
  return ops;
};

export const sultanHassan: KindDef = {
  ...attractionBase, id: 'sultan-hassan', name: 'the Sultan Hassan Mosque', kindId: 159, tier: 5,
  occupation: { ...library.occupation!, name: 'mosque guide' },
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The fourteenth-century mosque and madrasa below the citadel: the tallest portal in Cairo, the great dome over the prayer hall, and two pencil minarets that ruled the skyline for five hundred years.',
  howTo: 'A 3×3 plot facing a street, the portal and courtyard towards the road. A daytime attraction that draws visitors of every age from across the city. World landmark: unlock rule to be decided.',
  tool: { id: 'sultanhassan', key: '', label: 'Sultan Hassan Mosque', color: '#8f9c7a' },
  attrs: {
    ...library.attrs, visitorCapacity: 120, ticket: 12, openHours: [9, 17.5], stay: [1, 1.8], leisureValue: 9, radius: 30,
    dayAppeal: 1.3, eveningAppeal: 0.15, retireeAppeal: 1.9, childAppeal: 1.6, title: 'the Sultan Hassan Mosque',
  },
  levels: [{
    capacity: 30, wage: 17, cost: 13000, upkeep: 80, work: 3200, parking: { surface: 0, underground: 20 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the prayer hall with its dome behind the tall portal, courtyard and two pencil minarets', height: 2.01, ops: mosqueOps() },
    ],
  }],
};

/** Cairo's landmarks, in kind-id order (landmarks-world.ts lists them in WORLD_LANDMARKS). */
export const CAIRO_LANDMARKS: KindDef[] = [greatPyramid, sphinx, khafre, cairoTower, sultanHassan];
