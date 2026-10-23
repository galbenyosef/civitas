import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { office } from './office';
import { library } from './leisure';
import { slab, tree, lampPost, flags, helipad, PAVING } from './tierkit';

/**
 * Dubai landmarks (docs/buildings.md "Landmarks"): recognisable real buildings of the emirate, tagged 'world' and
 * 'dubai', rungs of the 'dubai' collection (groups.ts), tiers 1-5, their tools unlocked only by the locked tech node
 * 'wld1' (tech.ts) like the other world landmarks. Kind ids 167-171 (see landmarks-world.ts for the world
 * allocation). Scale: about 33 m to a tile, as for London; the Burj Khalifa is drawn far shorter than its 828 m so
 * it tops the world set at about a dozen tiles without dwarfing the cities.
 *
 * The set, in tier order:
 *   167 the Burj Khalifa: an office tower, the tallest thing in the world set
 *   168 the Burj Al Arab: an office tower, the sail on its island in the sea
 *   169 the Dubai Frame: a library-family daytime attraction, the two gold towers and the sky bridge
 *   170 the Museum of the Future: a library-family attraction, the glass torus standing on its edge
 *   171 the Jumeirah Mosque: a library-family attraction, the white mosque, dome and twin minarets
 */

const TAGS = ['world', 'dubai'];
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'dubai',
};
const attractionBase = {
  code: library.code, family: 'leisure' as const,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic' as const,
  landmark: true, tags: TAGS, group: 'dubai',
};

// ================================================================= 167 the Burj Khalifa

const SAND = 0xd9c9a8, SILVER = 0xbcc9d4, SILVER_DK = 0x8fa3b3;

/**
 * The world's tallest tower: eight silver setbacks, each a frustum whose top is nudged a little further round the
 * compass than the last, so the shaft reads as spiralling steps climbing to the needle (the shifts sum to zero, so
 * the crown stays centred). Every tier sits on the roof of the one below, inset from its walls. The stone podium
 * carries the door on the avenue front; the fountain pool plays on the pavement.
 */
// [wBot, wTop, shiftX, shiftZ] of each climbing tier
const BK_TIERS: [number, number, number, number][] = [
  [2.1, 1.88, 0.05, 0], [1.88, 1.66, 0.035, 0.035], [1.66, 1.44, 0, 0.05], [1.44, 1.24, -0.035, 0.035],
  [1.24, 1.06, -0.05, 0], [1.06, 0.88, -0.035, -0.035], [0.88, 0.72, 0, -0.05], [0.72, 0.56, 0.035, -0.035],
];

const burjKhalifaOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the stone podium, the door on the avenue front
  ops.push(['box', 2.5, 0.6, 2.5, 0, 0.02, 0, SAND, true, { name: 'base', facade: { storeys: 4, bays: 7, margin: 0.08, ground: 'plain', top: 0.12 } }]);
  ops.push(['door', 'base', 'front', 3], ['porch', 'base', 'front', 2, 4, 'gold']);
  // the eight spiralling setbacks
  let y = 0.62, cx = 0, cz = 0;
  for (const [wb, wt, sx, sz] of BK_TIERS) {
    ops.push(['taper', wb, wb, wt, wt, 1.15, cx, y, cz, SILVER, { win: 'office', shift: [sx, sz] }]);
    cx += sx; cz += sz; y += 1.15;
  }
  // the crown and the needle, with the aircraft light
  ops.push(['taper', 0.56, 0.56, 0.34, 0.34, 0.3, 0, y, 0, SILVER_DK]);
  ops.push(['cyl', 0.05, 0.07, 0.9, 0, y + 0.3, 0, 'steel', 8]);
  ops.push(['cyl', 0.02, 0.04, 0.55, 0, y + 1.2, 0, 'steel', 6]);
  ops.push(['cyl', 0.035, 0.035, 0.06, 0, y + 1.75, 0, 'red', 6]);
  // the fountain pool on the pavement, flagpoles, lamps and palms
  ops.push(['box', 2.4, 0.04, 0.52, 0, 0.02, 1.12, 'stone'], ['box', 2.28, 0.034, 0.4, 0, 0.02, 1.12, 'pond']);
  ops.push(...repeat(5, (i): Op => ['cone', 0.02, 0.08, -0.9 + i * 0.45, 0.054, 1.12, 0xdff2ff, 5]));
  ops.push(...flags(-0.9, 1.42, 5, 0.45, ['red', 'green', 'white'], 0.02));
  ops.push(...lampPost(-0.62, 1.44, 0.36, 'marquee', 0.02), ...lampPost(0.62, 1.44, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.32, 1.3, 0.7, 'green'), ...tree(1.32, 1.3, 0.7, 'green'), ...tree(-1.3, -1.3, 0.8, 'green'), ...tree(1.3, -1.3, 0.8, 'green'));
  return ops;
};

export const burjKhalifa: KindDef = {
  ...towerBase, id: 'burj-khalifa', name: 'the Burj Khalifa', kindId: 167, tier: 1,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'Downtown\'s silver spiral: eight setbacks winding round the shaft to the needle, the tallest thing in the world set and the biggest workplace in the game.',
  howTo: 'A 3×3 plot on a main avenue among offices; it holds more jobs than anything else, so give it a station or buses and leave the street in front clear. World landmark: unlock rule to be decided.',
  tool: { id: 'burjkhalifa', key: '', label: 'Burj Khalifa', color: '#9fb4c7' },
  levels: [{
    capacity: 450, wage: 48, cost: 30000, upkeep: 160, work: 5400, parking: { surface: 0, underground: 90 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'eight silver setbacks spiralling under the needle', height: 11.63, ops: burjKhalifaOps() },
    ],
  }],
};

// ================================================================= 168 the Burj Al Arab

const SAIL = 0xe8eef2, SAIL_DK = 0xd9e4ea;

/**
 * The sail of the Gulf: a podium on a round island in a lot of sea, with a causeway to the road; above it the glass
 * sail, three curving shells in z nudged further back as they climb, crossed by one shell in x, billowing out over
 * the atrium. The helipad cantilevers off the flank on its dark neck. Every shell springs from inside the walls of
 * the part below, so no wall half-hides another's windows.
 */
const burjAlArabOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, 'pale')];
  // the sea round the island, the island platform and the causeway to the road
  ops.push(['box', 2.96, 0.016, 2.96, 0, 0.02, 0, 'pond']);
  ops.push(['cyl', 1.28, 1.34, 0.12, 0, 0.02, 0, 'white', 24]);
  ops.push(['box', 0.4, 0.05, 0.2, 0, 0.02, 1.38, 'stone']);
  // the podium, the door on the shore front
  ops.push(['box', 1.7, 0.5, 1.7, 0, 0.14, 0, 'white', true, { name: 'base', facade: { storeys: 3, bays: 7, margin: 0.06, ground: 'door', top: 0.1 } }]);
  ops.push(['porch', 'base', 'front', 2, 4, 'gold', 'white']);
  // the sail: three shells curving back as they climb, one crossing them in x
  ops.push(['taper', 0.55, 1.68, 0.5, 1.55, 0.8, 0, 0.64, 0, SAIL, { win: 'office', shift: [0, 0.08] }]);
  ops.push(['taper', 0.5, 1.55, 0.42, 1.2, 0.85, 0, 1.44, 0.08, SAIL, { win: 'office', shift: [0, -0.12] }]);
  ops.push(['taper', 0.42, 1.2, 0.32, 0.7, 0.85, 0, 2.29, -0.04, SAIL, { win: 'office', shift: [0, -0.28] }]);
  ops.push(['taper', 1.3, 0.44, 0.6, 0.32, 1.3, 0, 1.5, -0.08, SAIL_DK, { win: 'office', shift: [0, -0.22] }]);
  // the mast and the spire
  ops.push(['taper', 0.32, 0.7, 0.1, 0.24, 0.5, 0, 3.14, -0.32, 'white']);
  ops.push(['cyl', 0.012, 0.03, 0.3, 0, 3.64, -0.32, 'steel', 6]);
  ops.push(['cyl', 0.025, 0.025, 0.04, 0, 3.94, -0.32, 'gold', 6]);
  // the helipad cantilevered off the flank on its neck
  ops.push(['box', 0.36, 0.03, 0.12, 0.72, 1.87, -0.18, 'charcoal']);
  ops.push(...helipad(0.98, 1.88, -0.18, 0.16));
  // palms, lamps and flagpoles on the island
  ops.push(...tree(-0.98, 0.75, 0.65, 'green', 0.14), ...tree(0.98, 0.75, 0.65, 'green', 0.14));
  ops.push(...lampPost(-0.35, 1.15, 0.3, 'marquee', 0.14), ...lampPost(0.35, 1.15, 0.3, 'marquee', 0.14));
  ops.push(...flags(-0.75, 1.0, 2, 1.5, ['red', 'green'], 0.14));
  return ops;
};

export const burjAlArab: KindDef = {
  ...towerBase, id: 'burj-al-arab', name: 'the Burj Al Arab', kindId: 168, tier: 2,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The sail of the Gulf: curving glass shells billowing up from an island in the sea, the helipad cantilevered off the flank and a gold tip at the mast.',
  howTo: 'A 3×3 plot with its causeway to the street; it works as an office tower, so give it buses or parking and let the sea show round the island. World landmark: unlock rule to be decided.',
  tool: { id: 'burjalarab', key: '', label: 'Burj Al Arab', color: '#dfe7ec' },
  levels: [{
    capacity: 340, wage: 45, cost: 24000, upkeep: 130, work: 4400, parking: { surface: 0, underground: 65 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the sail: curving glass shells on an island, the helipad off the flank', height: 3.98, ops: burjAlArabOps() },
    ],
  }],
};

// ================================================================= 169 the Dubai Frame

const GOLD = 0xd8b25a, GOLD_DK = 0xc9a53f, GOLD_DKER = 0xb8933a;

/**
 * Zabeel Park's picture frame: two gold-clad towers with civic windows, their tops joined by the sky bridge (its
 * ends stand a hand's width proud of the towers' outer walls, so nothing touches a windowed wall). The glass floor
 * hangs under the bridge in the gap; a gold walk leads between the doors.
 */
const dubaiFrameOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the gold walk between the doors
  ops.push(['box', 1.9, 0.006, 0.3, 0, 0.02, 0.5, GOLD]);
  // the two towers, doors on the street front, plain attic bands under the bridge
  ops.push(['box', 0.34, 2.3, 0.4, -0.62, 0.02, 0, GOLD, true, { name: 'west', facade: { storeys: 10, bays: 3, sideBays: 3, margin: 0.05, ground: 'door', top: 0.12 } }]);
  ops.push(['box', 0.34, 2.3, 0.4, 0.62, 0.02, 0, GOLD, true, { name: 'east', facade: { storeys: 10, bays: 3, sideBays: 3, margin: 0.05, ground: 'door', top: 0.12 } }]);
  ops.push(['cornice', 'west', 10, GOLD_DKER], ['cornice', 'east', 10, GOLD_DKER]);
  // the sky bridge, the gallery glass and the glass floor over the gap
  ops.push(['box', 1.7, 0.34, 0.32, 0, 2.32, 0, GOLD_DK]);
  ops.push(['box', 1.5, 0.14, 0.02, 0, 2.4, 0.18, 'glass']);
  ops.push(['box', 0.5, 0.024, 0.2, 0, 2.296, 0, 'glassDark']);
  // palms, lamps and the flags on the bridge
  ops.push(...tree(-0.82, 0.78, 0.55, 'green'), ...tree(0.82, 0.78, 0.55, 'green'));
  ops.push(...lampPost(-0.85, 0.95, 0.3, 'marquee', 0.02), ...lampPost(0.85, 0.95, 0.3, 'marquee', 0.02));
  ops.push(['flag', -0.5, 2.66, 0, 'red'], ['flag', 0.5, 2.66, 0, 'green']);
  return ops;
};

export const dubaiFrame: KindDef = {
  ...attractionBase, id: 'dubai-frame', name: 'the Dubai Frame', kindId: 169, tier: 3,
  footprint: { w: 2, h: 2, door: [1, 1] },
  occupation: { ...library.occupation!, name: 'frame concierge' },
  attrs: {
    ...library.attrs, visitorCapacity: 120, ticket: 18, openHours: [9, 17.5], stay: [1, 1.8], leisureValue: 8, radius: 28,
    dayAppeal: 1.4, eveningAppeal: 0.1, retireeAppeal: 1.6, childAppeal: 1.7, title: 'Dubai Frame',
  },
  lot: { wage: 16 },
  blurb: 'Zabeel Park\'s golden picture frame: two gold-clad towers holding a sky bridge with a glass floor, old Dubai below on one side and the new towers on the other.',
  howTo: 'A 2×2 plot on a street by a park or promenade; visitors come by day for the view, so give it buses and leave the front walk clear. World landmark: unlock rule to be decided.',
  tool: { id: 'dubaiframe', key: '', label: 'Dubai Frame', color: '#d8b25a' },
  levels: [{
    capacity: 24, wage: 16, cost: 10000, upkeep: 60, work: 2800, parking: { surface: 0, underground: 15 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'two gold towers holding the sky bridge over the frame', height: 2.86, ops: dubaiFrameOps() },
    ],
  }],
};

// ================================================================= 170 the Museum of the Future

/**
 * The torus, standing on its edge so the ring faces the road. A lathe profile may only rise in dy (and must start at
 * dy 0), so the tube's circular cross-section is split into four quarter-tube lathes on axis z: the lower half rising
 * from the tube's bottom, the upper half from its waist, each an inner and an outer surface. Together they close the
 * ring; a shallow glass lathe caps the hole just behind the front face, the atrium wall from the road. Steel ribs
 * stripe the glass tube.
 */
const MOTF_OPTS = { seg: 36, axis: 'z' as const, win: 'civic' as const, stripe: 'steel' as const, every: 3, width: 1 };
// quarter-tube profiles (r, dy) for tube centreline radius 0.92, tube radius 0.36
const MOTF_LO_IN = [0.92, 0, 0.827, 0.012, 0.74, 0.048, 0.665, 0.105, 0.608, 0.18, 0.572, 0.267, 0.56, 0.36];
const MOTF_LO_OUT = [0.92, 0, 1.013, 0.012, 1.1, 0.048, 1.175, 0.105, 1.232, 0.18, 1.268, 0.267, 1.28, 0.36];
const MOTF_UP_IN = [0.56, 0, 0.572, 0.093, 0.608, 0.18, 0.665, 0.255, 0.74, 0.312, 0.827, 0.348, 0.92, 0.36];
const MOTF_UP_OUT = [1.28, 0, 1.268, 0.093, 1.232, 0.18, 1.175, 0.255, 1.1, 0.312, 1.013, 0.348, 0.92, 0.36];

const museumOfTheFutureOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the reflecting pool and palms on the plaza
  ops.push(['box', 2.0, 0.03, 0.6, 0, 0.02, 1.05, 'stone'], ['box', 1.88, 0.024, 0.48, 0, 0.02, 1.05, 'pond']);
  ops.push(...tree(-1.25, 1.2, 0.7, 'green'), ...tree(1.25, 1.2, 0.7, 'green'), ...tree(-1.3, -0.9, 0.6, 'green'), ...tree(1.3, -0.9, 0.6, 'green'));
  // the ring itself: four quarter-tube lathes, lower half from the tube's base, upper half from its waist
  ops.push(['lathe', 0, 1.3, -0.46, 0x86b8cf, MOTF_LO_IN, MOTF_OPTS]);
  ops.push(['lathe', 0, 1.3, -0.46, 0x86b8cf, MOTF_LO_OUT, MOTF_OPTS]);
  ops.push(['lathe', 0, 1.3, -0.1, 0x86b8cf, MOTF_UP_IN, MOTF_OPTS]);
  ops.push(['lathe', 0, 1.3, -0.1, 0x86b8cf, MOTF_UP_OUT, MOTF_OPTS]);
  // the glass atrium wall capping the hole just behind the front face
  ops.push(['lathe', 0, 1.3, 0.22, 0x9fc6d8, [0.56, 0, 0.4, 0.015, 0.2, 0.03, 0, 0.04], { seg: 24, axis: 'z' }]);
  ops.push(...lampPost(-1.42, 0.55, 0.36, 'marquee', 0.02), ...lampPost(1.42, 0.55, 0.36, 'marquee', 0.02));
  return ops;
};

export const museumOfTheFuture: KindDef = {
  ...attractionBase, id: 'museum-of-the-future', name: 'the Museum of the Future', kindId: 170, tier: 4,
  footprint: { w: 3, h: 3, door: [1, 2] },
  occupation: { ...library.occupation!, name: 'gallery host' },
  attrs: {
    ...library.attrs, visitorCapacity: 160, ticket: 25, openHours: [10, 18], stay: [1.2, 2], leisureValue: 9, radius: 30,
    dayAppeal: 1.5, eveningAppeal: 0.15, retireeAppeal: 1.5, childAppeal: 1.8, title: 'Museum of the Future',
  },
  lot: { wage: 17 },
  blurb: 'The torus on Sheikh Zayed Road: a ring of glass and steel standing on its edge, glowing from within after dark, an exhibition of the world seventy years from now.',
  howTo: 'A 3×3 plot facing a main road so the ring faces the traffic; a daytime attraction, so put it near hotels and buses. World landmark: unlock rule to be decided.',
  tool: { id: 'motf', key: '', label: 'Museum of the Future', color: '#6fb7c9' },
  levels: [{
    capacity: 30, wage: 17, cost: 18000, upkeep: 90, work: 3200, parking: { surface: 0, underground: 25 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the glass torus on its side, steel ribs round the ring', height: 2.58, ops: museumOfTheFutureOps() },
    ],
  }],
};

// ================================================================= 171 the Jumeirah Mosque

const WHITE = 0xf6f2ea, WHITE_DK = 0xe8e2d2, WALL = 0xefe9db;

/**
 * The white mosque by the sea: a prayer hall with civic windows and its porch, the dome on its drum over the middle,
 * and twin minarets with their balconies and little domes flanking the courtyard. Low walls with a gilded gate wrap
 * the court, with the ablution fountain in the middle and palms along the front; the lamps and windows light it warm
 * at night.
 */
const jumeirahMosqueOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the courtyard: gravel, ablution fountain, low walls with the gate on the street
  ops.push(['box', 2.6, 0.012, 0.47, 0, 0.02, 0.685, 'gravel']);
  ops.push(['box', 1.12, 0.18, 0.06, -0.745, 0.02, 0.92, WALL], ['box', 1.12, 0.18, 0.06, 0.745, 0.02, 0.92, WALL]);
  ops.push(['box', 0.06, 0.18, 1.55, -1.31, 0.02, 0.05, WALL], ['box', 0.06, 0.18, 1.55, 1.31, 0.02, 0.05, WALL]);
  ops.push(['box', 0.07, 0.26, 0.07, -0.19, 0.02, 0.92, WHITE_DK], ['box', 0.07, 0.26, 0.07, 0.19, 0.02, 0.92, WHITE_DK]);
  ops.push(['box', 0.09, 0.03, 0.09, -0.19, 0.28, 0.92, 'gold'], ['box', 0.09, 0.03, 0.09, 0.19, 0.28, 0.92, 'gold']);
  ops.push(['cyl', 0.15, 0.17, 0.06, 0, 0.02, 0.68, 'stone', 14], ['cyl', 0.12, 0.12, 0.065, 0, 0.02, 0.68, 'pond', 14], ['cone', 0.02, 0.07, 0, 0.085, 0.68, 0xcfe8ff, 6]);
  // the prayer hall, the porch over the door, the dome on its drum
  ops.push(['box', 1.8, 0.62, 1.5, 0, 0.02, -0.3, WHITE, 'civic', { name: 'hall', facade: { storeys: 2, bays: 7, sideBays: 5, margin: 0.1, ground: 'plain', top: 0.1 } }]);
  ops.push(['door', 'hall', 'front', 3], ['porch', 'hall', 'front', 2, 4, 'cream', 'white']);
  ops.push(['cyl', 0.42, 0.44, 0.1, 0, 0.64, -0.3, 'white', 16]);
  ops.push(['lathe', 0, 0.74, -0.3, 0xf1ede2, [0.42, 0, 0.42, 0.03, 0.44, 0.1, 0.4, 0.22, 0.3, 0.32, 0.16, 0.4, 0.05, 0.46, 0, 0.5], { seg: 20 }]);
  ops.push(['cyl', 0.012, 0.012, 0.1, 0, 1.24, -0.3, 'gold', 6], ['cone', 0.02, 0.05, 0, 1.34, -0.3, 'gold', 6]);
  // the twin minarets flanking the court
  for (const mx of [-0.95, 0.95]) {
    ops.push(['taper', 0.18, 0.18, 0.14, 0.14, 0.95, mx, 0.02, 0.6, WHITE]);
    ops.push(['box', 0.22, 0.045, 0.22, mx, 0.97, 0.6, WHITE_DK]);
    ops.push(['cyl', 0.055, 0.062, 0.3, mx, 1.015, 0.6, 'white', 10]);
    ops.push(['lathe', mx, 1.315, 0.6, 0xf1ede2, [0.07, 0, 0.075, 0.03, 0.055, 0.07, 0.02, 0.1, 0, 0.12], { seg: 10 }]);
    ops.push(['cyl', 0.008, 0.008, 0.085, mx, 1.435, 0.6, 'gold', 4]);
  }
  // palms and lamps
  ops.push(...tree(-1.05, 1.25, 0.7, 'green'), ...tree(1.05, 1.25, 0.7, 'green'), ...tree(-1.35, -0.5, 0.6, 'green'), ...tree(1.35, -0.5, 0.6, 'green'));
  ops.push(...lampPost(-0.35, 1.15, 0.34, 'marquee', 0.02), ...lampPost(0.35, 1.15, 0.34, 'marquee', 0.02));
  return ops;
};

export const jumeirahMosque: KindDef = {
  ...attractionBase, id: 'jumeirah-mosque', name: 'the Jumeirah Mosque', kindId: 171, tier: 5,
  footprint: { w: 3, h: 3, door: [1, 2] },
  occupation: { ...library.occupation!, name: 'mosque caretaker' },
  attrs: {
    ...library.attrs, visitorCapacity: 80, ticket: 12, openHours: [9, 17], stay: [0.8, 1.5], leisureValue: 7, radius: 24,
    dayAppeal: 1.3, eveningAppeal: 0.2, retireeAppeal: 1.9, childAppeal: 1.4, title: 'Jumeirah Mosque',
  },
  lot: { wage: 16 },
  blurb: 'The white mosque by the sea: a dome and twin minarets in the Fatimid style, floodlit warm at night and open to visitors of every faith.',
  howTo: 'A 3×3 plot on a quiet avenue; a daytime attraction that retirees and children love, so put it near homes and a bus stop. World landmark: unlock rule to be decided.',
  tool: { id: 'jumeirah', key: '', label: 'Jumeirah Mosque', color: '#efe9db' },
  levels: [{
    capacity: 12, wage: 16, cost: 8000, upkeep: 50, work: 2600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the white mosque: dome and twin minarets round the courtyard', height: 1.52, ops: jumeirahMosqueOps() },
    ],
  }],
};

/** Dubai's landmarks, in kind-id order (landmarks-world.ts lists them in WORLD_LANDMARKS). */
export const DUBAI_LANDMARKS: KindDef[] = [burjKhalifa, burjAlArab, dubaiFrame, museumOfTheFuture, jumeirahMosque];
