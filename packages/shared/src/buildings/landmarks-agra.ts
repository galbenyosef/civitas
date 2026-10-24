import type { KindDef, Op } from './schema';
import { library } from './leisure';
import { slab, tree, lampPost, PAVING } from './tierkit';

/**
 * Agra landmarks (docs/buildings.md "Landmarks"): the buildings of the old
 * Mughal capital on the river, tagged 'world' and 'agra', rungs of the
 * 'agra' collection (groups.ts), tiers 1-4, their tools unlocked only by
 * the locked tech node 'wld1' (tech.ts) like the other world cities. Kind
 * ids 213-216 (see landmarks-world.ts for the world allocation). Scale:
 * about 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   213 the Taj Mahal: a library-family daytime attraction, the white marble
 *       mausoleum with its dome and minarets on the riverfront terrace
 *   214 the Agra Fort: a library-family attraction, the red sandstone walls
 *       of the emperors' palace above the river
 *   215 Fatehpur Sikri: a library-family attraction, the emperor's abandoned
 *       city on the ridge, its great gate still standing
 *   216 to follow, one building at a time.
 */

const TAGS = ['world', 'agra'];

// ================================================================= 213 the Taj Mahal

/**
 * The marble teardrop the emperor built for his wife and the whole world
 * came to see: the riverfront terrace, the great white plinth, the cube of
 * the mausoleum under its onion dome, the four chhatris at its corners, the
 * four minarets standing guard, and the long reflecting pool down the
 * garden axis. Plain marble and dark insets only, so no window rule is
 * touched.
 */
const TAJ_WHITE = 0xf2ede2, TAJ_DK = 0x6a7a6a;

const tajMahalOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the riverfront terrace and the great white plinth
  ops.push(['box', 1.5, 0.06, 1.1, 0, 0.02, -0.2, TAJ_WHITE]);
  // the mausoleum: the cube, the drum and the onion dome
  ops.push(['box', 0.5, 0.42, 0.5, 0, 0.08, -0.25, TAJ_WHITE]);
  ops.push(['box', 0.42, 0.08, 0.42, 0, 0.5, -0.25, TAJ_WHITE]);
  ops.push(['lathe', 0, 0.58, -0.25, TAJ_WHITE, [0.2, 0, 0.26, 0.08, 0.24, 0.16, 0.18, 0.24, 0.08, 0.3, 0.02, 0.34, 0, 0.36], { seg: 16 }]);
  // the great arch of the pishtaq, dark against the marble
  ops.push(['box', 0.18, 0.24, 0.02, 0, 0.14, 0.005, TAJ_DK]);
  // the four chhatris at the plinth corners
  for (const [cx, cz] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.22], [0.62, 0.22]] as const) {
    ops.push(['cyl', 0.05, 0.05, 0.14, cx, 0.08, cz, TAJ_WHITE, 8]);
    ops.push(['cone', 0.06, 0.07, cx, 0.22, cz, TAJ_WHITE, 8]);
  }
  // the four minarets standing guard at the terrace corners
  for (const [mx, mz] of [[-0.85, -0.75], [0.85, -0.75], [-0.85, 0.45], [0.85, 0.45]] as const) {
    ops.push(['taper', 0.05, 0.05, 0.03, 0.03, 0.72, mx, 0.02, mz, TAJ_WHITE]);
    ops.push(['cone', 0.035, 0.06, mx, 0.74, mz, TAJ_WHITE, 8]);
  }
  // the long reflecting pool down the garden axis, the cypresses beside it
  ops.push(['box', 0.18, 0.015, 1.3, 0, 0.02, 0.35, 'pond']);
  for (const z of [0.05, 0.4, 0.75]) {
    ops.push(...tree(-0.32, z, 0.5, 'dark'), ...tree(0.32, z, 0.5, 'dark'));
  }
  return ops;
};

export const tajMahal: KindDef = {
  id: 'taj-mahal', name: 'the Taj Mahal', code: library.code, kindId: 213, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'agra',
  occupation: { ...library.occupation!, name: 'monument keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 320, ticket: 20, openHours: [8, 19], stay: [1.2, 2.4], leisureValue: 10, radius: 34,
    dayAppeal: 1.9, eveningAppeal: 0.6, retireeAppeal: 1.9, childAppeal: 1.3, title: 'the Taj Mahal',
  },
  lot: { wage: 17 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The marble teardrop the emperor built for his wife and the whole world came to see: the riverfront terrace, the cube of the mausoleum under its onion dome, the four minarets standing guard, and the long reflecting pool down the garden axis.',
  howTo: 'A 2×2 plot at the city\'s green edge or on the river; the heaviest daytime draw of the world set, so give it a bus stop and leave the garden walkable. World landmark: unlock rule to be decided.',
  tool: { id: 'tajmahal', key: '', label: 'Taj Mahal', color: '#f2ede2' },
  levels: [{
    capacity: 55, wage: 17, cost: 20000, upkeep: 80, work: 3600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the white marble mausoleum with its dome, minarets and reflecting pool', height: 1.0, ops: tajMahalOps() },
    ],
  }],
};

// ================================================================= 214 the Agra Fort

/**
 * The red walls the emperors kept above the river: the sandstone ramparts
 * with their battlements, the great gate, the white mosque inside, and the
 * gardens where the court once walked. Plain sandstone and dark insets
 * only, so no window rule is touched.
 */
const FORT_RED = 0xa8503c, FORT_DK = 0x4a2c22;

const agraFortOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the sandstone ramparts with their battlements
  ops.push(['box', 1.5, 0.4, 1.0, 0, 0.02, -0.15, FORT_RED]);
  for (let i = 0; i < 10; i++) ops.push(['box', 0.08, 0.08, 0.08, -0.63 + i * 0.14, 0.42, 0.35, FORT_RED]);
  // the great gate with its dark arch
  ops.push(['box', 0.34, 0.5, 0.2, -0.4, 0.02, 0.38, FORT_RED]);
  ops.push(['box', 0.14, 0.24, 0.02, -0.4, 0.06, 0.49, FORT_DK]);
  // the Jahangiri palace block and the white mosque inside the walls
  ops.push(['box', 0.5, 0.34, 0.3, -0.25, 0.02, -0.3, FORT_RED]);
  ops.push(['box', 0.24, 0.18, 0.2, 0.35, 0.02, -0.35, 0xf2ede2]);
  ops.push(['lathe', 0.35, 0.2, -0.35, 0xf2ede2, [0.06, 0, 0.08, 0.03, 0.07, 0.06, 0.02, 0.09, 0, 0.1], { seg: 12 }]);
  // the court lamps
  ops.push(...lampPost(-0.6, 0.65, 0.3, 'marquee', 0.02), ...lampPost(0.5, 0.65, 0.3, 'marquee', 0.02));
  return ops;
};

export const agraFort: KindDef = {
  id: 'agra-fort', name: 'the Agra Fort', code: library.code, kindId: 214, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'agra',
  occupation: { ...library.occupation!, name: 'fort keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 220, ticket: 14, openHours: [8.5, 18.5], stay: [1.0, 2.0], leisureValue: 8, radius: 28,
    dayAppeal: 1.5, eveningAppeal: 0.3, retireeAppeal: 1.6, childAppeal: 1.4, title: 'the Agra Fort',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The red walls the emperors kept above the river: the sandstone ramparts with their battlements, the great gate, the white mosque inside, and the gardens where the court once walked.',
  howTo: 'A 2×2 plot near the river or the old town; a ticketed daytime visit, best near the Taj Mahal for the tourist trail and a bus stop. World landmark: unlock rule to be decided.',
  tool: { id: 'agrafort', key: '', label: 'Agra Fort', color: '#a8503c' },
  levels: [{
    capacity: 40, wage: 16, cost: 15000, upkeep: 60, work: 3000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the red sandstone walls of the emperors\' palace above the river', height: 0.55, ops: agraFortOps() },
    ],
  }],
};

// ================================================================= 215 Fatehpur Sikri

/**
 * The city the emperor built on the ridge and abandoned in a single
 * generation: the great gate of the mosque still standing over the court,
 * its domed chhatris silhouetted against the sky, and beside it the white
 * marble tomb of the saint whose blessing founded the place. Plain
 * sandstone, marble and dark insets only, so no window rule is touched.
 */
const SIKRI_SAND = 0xc09a6a, SIKRI_DK = 0x4a3828;

const fatehpurSikriOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the great gate of the mosque: the tall pishtaq with its dark arch
  ops.push(['box', 0.7, 0.75, 0.4, 0, 0.02, -0.2, SIKRI_SAND]);
  ops.push(['box', 0.3, 0.5, 0.02, 0, 0.06, 0.005, SIKRI_DK]);
  // the six domed chhatris along the gate top
  for (const cx of [-0.28, -0.14, 0, 0.14, 0.28]) {
    ops.push(['cyl', 0.045, 0.045, 0.1, cx, 0.77, -0.2, SIKRI_SAND, 8]);
    ops.push(['cone', 0.055, 0.08, cx, 0.87, -0.2, SIKRI_SAND, 8]);
  }
  // the white marble tomb of the saint with its jali screens
  ops.push(['box', 0.3, 0.25, 0.3, 0.55, 0.02, 0.3, 0xf2ede2]);
  ops.push(['box', 0.1, 0.14, 0.02, 0.55, 0.08, 0.46, SIKRI_DK]);
  ops.push(['lathe', 0.55, 0.27, 0.3, 0xf2ede2, [0.09, 0, 0.12, 0.04, 0.1, 0.09, 0.03, 0.13, 0, 0.15], { seg: 12 }]);
  // the ridge court: lamps and a pair of trees
  ops.push(...lampPost(-0.6, 0.6, 0.3, 'marquee', 0.02), ...lampPost(-0.2, 0.75, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.75, -0.7, 0.5, 'dark'), ...tree(0.75, -0.72, 0.5, 'dark'));
  return ops;
};

export const fatehpurSikri: KindDef = {
  id: 'fatehpur-sikri', name: 'Fatehpur Sikri', code: library.code, kindId: 215, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'agra',
  occupation: { ...library.occupation!, name: 'ridge city keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 180, ticket: 12, openHours: [8.5, 18], stay: [1.0, 2.0], leisureValue: 8, radius: 26,
    dayAppeal: 1.4, eveningAppeal: 0.2, retireeAppeal: 1.6, childAppeal: 1.4, title: 'Fatehpur Sikri',
  },
  lot: { wage: 15 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The city the emperor built on the ridge and abandoned in a single generation: the great gate of the mosque still standing over the court, its domed chhatris against the sky, and beside it the white marble tomb of the saint whose blessing founded the place.',
  howTo: 'A 2×2 plot at the city\'s edge; a ticketed daytime visit, best near the Taj Mahal for the tourist trail and a bus stop. World landmark: unlock rule to be decided.',
  tool: { id: 'fatehpursikri', key: '', label: 'Fatehpur Sikri', color: '#c09a6a' },
  levels: [{
    capacity: 34, wage: 15, cost: 14000, upkeep: 55, work: 2800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the abandoned city on the ridge, its great gate still standing', height: 0.95, ops: fatehpurSikriOps() },
    ],
  }],
};

export const AGRA_LANDMARKS: KindDef[] = [tajMahal, agraFort, fatehpurSikri];
