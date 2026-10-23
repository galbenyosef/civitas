import type { KindDef, Op } from './schema';
import { library } from './leisure';
import { slab, tree, lampPost, PAVING } from './tierkit';

/**
 * Rome landmarks (docs/buildings.md "Landmarks"): the great buildings of the eternal city,
 * tagged 'world' and 'rome', rungs of the 'rome' collection (groups.ts), tiers 1-6, their
 * tools unlocked only by the locked tech node 'wld1' (tech.ts) like the other world cities.
 * Kind ids 141-146 (see landmarks-world.ts for the world allocation). Scale: about 33 m to
 * a tile, as for London.
 *
 * The set, in tier order:
 *   141 the Colosseum: a library-family daytime attraction, the amphitheatre of the
 *       emperors, the arena and the receding rings of arches
 *   142 St Peter's Basilica: a library-family attraction, the great church of the popes,
 *       the dome over the crossing, the colonnaded square with the obelisk
 *   143 the Pantheon: a library-family attraction, the columns and pediment before the
 *       great dome with its rings
 *   144-146 to follow, one building at a time.
 */

const TAGS = ['world', 'rome'];

// ================================================================= 141 the Colosseum

/**
 * The amphitheatre of the emperors on the Via Sacra: the outer wall in its three receding
 * storeys of arches stepped in as it climbs, the rim of the upper seating above it, and
 * the sand arena on the flat top, all turned as one lathe so the curve stays true - the
 * bowl reads from above, the arcade from the street. The four entrance boxes stand at the
 * cardinal points where a square wall can be tangent to the ring.
 */
const TRAVERTINE = 0xd8c9a4, TRAVERTINE_DK = 0xc4b48e;

const colosseumOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the amphitheatre in one turned mass: three receding storeys, the seating rim, the flat top
  ops.push(['lathe', 0, 0.02, 0, TRAVERTINE, [0.95, 0, 0.95, 0.2, 0.9, 0.2, 0.9, 0.4, 0.85, 0.4, 0.85, 0.58, 0.6, 0.58, 0.6, 0.62, 0, 0.62], { seg: 24 }]);
  // the sand arena on the top, with the rim of the upper seating showing round it
  ops.push(['cyl', 0.45, 0.47, 0.02, 0, 0.64, 0, 'sand', 20]);
  // the four entrances at the cardinal points, tangent to the ring
  ops.push(['box', 0.12, 0.3, 0.34, 0.93, 0.02, 0, TRAVERTINE_DK], ['box', 0.12, 0.3, 0.34, -0.93, 0.02, 0, TRAVERTINE_DK]);
  ops.push(['box', 0.34, 0.3, 0.12, 0, 0.02, 0.93, TRAVERTINE_DK], ['box', 0.34, 0.3, 0.12, 0, 0.02, -0.93, TRAVERTINE_DK]);
  // pines and lamps outside the wall
  ops.push(...tree(-0.72, 0.72, 0.5), ...tree(0.72, 0.72, 0.5));
  ops.push(...lampPost(-0.55, 0.88, 0.3, 'marquee', 0.02), ...lampPost(0.55, 0.88, 0.3, 'marquee', 0.02));
  return ops;
};

export const colosseum: KindDef = {
  id: 'colosseum', name: 'the Colosseum', code: library.code, kindId: 141, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'amphitheatre guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 200, ticket: 18, openHours: [9, 19.5], stay: [1.0, 2.0], leisureValue: 8, radius: 30,
    dayAppeal: 1.7, eveningAppeal: 0.3, retireeAppeal: 2.0, childAppeal: 1.9, title: 'the Colosseum',
  },
  lot: { wage: 17 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The amphitheatre of the emperors on the Via Sacra, fifty thousand Romans roaring over the sand below: the arena, the bowl of the cavea, and the three receding storeys of arches.',
  howTo: 'A 2×2 plot open to the street; a busy daytime outing for the whole city, so give it a metro or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'colosseum', key: '', label: 'Colosseum', color: '#d8c9a4' },
  levels: [{
    capacity: 48, wage: 17, cost: 15000, upkeep: 65, work: 3200, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the amphitheatre of the emperors, the arena and the receding rings of arches', height: 0.7, ops: colosseumOps() },
    ],
  }],
};

// ================================================================= 142 St Peter's Basilica

/**
 * The great church of the popes west of the Tiber: Maderna's long front with the nave
 * behind it, the transept under Michelangelo's dome rising from its drum, the choir
 * closing the cross, and before it all the colonnaded square, its two arms of columns
 * opening around the Egyptian obelisk. Plain stone and dark insets only, so no window
 * rule is touched.
 */
const VATICAN = 0xe8e0cc, DOME = 0xb9b2a0;

const stPetersOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the square with the obelisk at its centre
  ops.push(['cyl', 0.05, 0.06, 0.02, 0, 0.02, 0.25, 'stone', 14]);
  ops.push(['cyl', 0.018, 0.024, 0.36, 0, 0.04, 0.25, 0x8a4a3a, 4]);
  ops.push(['box', 0.05, 0.05, 0.012, 0, 0.4, 0.25, 'gold']);
  // the two colonnade arms: columns with their abaci along the front ellipse
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const th = 0.4 + i * 0.35;
      const cx = sx * Math.cos(th) * 0.85, cz = 0.25 + Math.sin(th) * 0.55;
      ops.push(['cyl', 0.014, 0.016, 0.15, cx, 0.02, cz, VATICAN, 6]);
      ops.push(['box', 0.045, 0.025, 0.045, cx, 0.17, cz, VATICAN]);
    }
  }
  // the church: the front, the nave, the transept and the choir behind
  ops.push(['box', 0.8, 0.42, 0.14, 0, 0.02, 0.6, VATICAN]);
  ops.push(['box', 0.14, 0.24, 0.015, 0, 0.02, 0.68, 0x3a3630]);
  ops.push(['box', 0.7, 0.35, 0.8, 0, 0.02, 0.05, VATICAN]);
  ops.push(['box', 1.0, 0.35, 0.2, 0, 0.02, -0.3, VATICAN]);
  ops.push(['box', 0.5, 0.32, 0.3, 0, 0.02, -0.55, VATICAN]);
  // Michelangelo's dome on its drum over the crossing, the lantern and the cross
  ops.push(['cyl', 0.24, 0.27, 0.12, 0, 0.37, -0.3, VATICAN, 14]);
  ops.push(['lathe', 0, 0.49, -0.3, DOME, [0.28, 0, 0.3, 0.06, 0.27, 0.16, 0.2, 0.26, 0.1, 0.32, 0.03, 0.36, 0, 0.38], { seg: 16 }]);
  ops.push(['cyl', 0.035, 0.04, 0.09, 0, 0.87, -0.3, VATICAN, 8]);
  ops.push(['box', 0.05, 0.07, 0.012, 0, 0.96, -0.3, 'gold']);
  // the lamps of the square
  ops.push(...lampPost(-0.4, 0.25, 0.3, 'marquee', 0.02), ...lampPost(0.4, 0.25, 0.3, 'marquee', 0.02));
  return ops;
};

export const stPeters: KindDef = {
  id: 'st-peters', name: 'St Peter\'s Basilica', code: library.code, kindId: 142, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'basilica verger' },
  attrs: {
    ...library.attrs, visitorCapacity: 240, ticket: 0, openHours: [7, 19], stay: [0.8, 1.8], leisureValue: 9, radius: 32,
    dayAppeal: 1.7, eveningAppeal: 0.5, retireeAppeal: 2.2, childAppeal: 1.4, title: 'St Peter\'s Basilica',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The great church of the popes west of the Tiber: Michelangelo\'s dome swelling over the crossing, and before it the colonnaded square where the obelisk has stood since the year 1586.',
  howTo: 'A 2×2 plot open at the front for the square; the grandest free visit in the city, drawing visitors all day, so give it a metro or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'stpeters', key: '', label: 'St Peter\'s', color: '#e8e0cc' },
  levels: [{
    capacity: 55, wage: 16, cost: 18000, upkeep: 70, work: 3600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the great church of the popes, the dome over the crossing, the colonnaded square with the obelisk', height: 1.03, ops: stPetersOps() },
    ],
  }],
};

// ================================================================= 143 the Pantheon

/**
 * The temple of all the gods, two thousand years a church: the columned portico with its
 * pediment on the street, the great brick rotunda behind it, and the dome rising in its
 * rings to the eye of the oculus. Plain brick and stone, the doors and the one window
 * inset dark, so no window rule is touched.
 */
const ROMAN_BRICK = 0xa5765a, ROMAN_BRICK_DK = 0x96685a;

const pantheonOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the rotunda and the dome in its rings
  ops.push(['cyl', 0.42, 0.44, 0.28, 0, 0.02, -0.1, ROMAN_BRICK, 20]);
  ops.push(['lathe', 0, 0.3, -0.1, ROMAN_BRICK_DK, [0.44, 0, 0.44, 0.03, 0.4, 0.03, 0.4, 0.08, 0.34, 0.08, 0.34, 0.13, 0.26, 0.13, 0.26, 0.17, 0.16, 0.17, 0.16, 0.2, 0.05, 0.2, 0, 0.22], { seg: 20 }]);
  // the one true window of the drum, inset dark
  ops.push(['box', 0.09, 0.11, 0.02, 0.36, 0.16, 0.22, 0x3a3630], ['box', 0.09, 0.11, 0.02, -0.36, 0.16, 0.22, 0x3a3630]);
  // the portico: six columns across, three deep each side, the entablature and pediment
  for (let i = 0; i < 6; i++) ops.push(['cyl', 0.022, 0.026, 0.22, -0.3 + i * 0.12, 0.02, 0.52, TRAVERTINE, 8]);
  for (const sx of [-1, 1]) for (const z of [0.4, 0.52]) ops.push(['cyl', 0.022, 0.026, 0.22, sx * 0.36, 0.02, z, TRAVERTINE, 8]);
  ops.push(['box', 0.78, 0.05, 0.3, 0, 0.24, 0.46, TRAVERTINE]);
  ops.push(['roof', 0.8, 0.12, 0.3, 0, 0.29, 0.46, TRAVERTINE_DK, false]);
  // the bronze doors under the portico
  ops.push(['box', 0.14, 0.2, 0.02, 0, 0.02, 0.31, 0x4a3b28]);
  // the piazza fountain, a lamp and a tree
  ops.push(['cyl', 0.12, 0.13, 0.03, -0.62, 0.02, 0.62, 'pond', 12]);
  ops.push(...lampPost(0.62, 0.62, 0.3, 'marquee', 0.02));
  ops.push(...tree(0.75, -0.72, 0.55));
  return ops;
};

export const pantheon: KindDef = {
  id: 'pantheon', name: 'the Pantheon', code: library.code, kindId: 143, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'temple keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 90, ticket: 0, openHours: [9, 19], stay: [0.4, 1.0], leisureValue: 7, radius: 22,
    dayAppeal: 1.4, eveningAppeal: 0.3, retireeAppeal: 1.8, childAppeal: 1.2, title: 'the Pantheon',
  },
  lot: { wage: 14 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The temple of all the gods, two thousand years a church: the columns and pediment on the piazza, and behind them the brick rotunda whose dome, a perfect hemisphere, still has no equal.',
  howTo: 'A 2×2 plot in the old town among shops and cafes; a short quiet visit between the grander sights, no ticket needed. World landmark: unlock rule to be decided.',
  tool: { id: 'pantheon', key: '', label: 'Pantheon', color: '#a5765a' },
  levels: [{
    capacity: 18, wage: 14, cost: 9000, upkeep: 40, work: 2000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the temple of all the gods, the columns and pediment before the great dome with its rings', height: 0.54, ops: pantheonOps() },
    ],
  }],
};

export const ROME_LANDMARKS: KindDef[] = [colosseum, stPeters, pantheon];
