import type { KindDef, Op } from './schema';
import { library } from './leisure';
import { slab, tree, lampPost, PAVING } from './tierkit';

/**
 * Rio de Janeiro landmarks (docs/buildings.md "Landmarks"): the monuments of the marvell-
 * ous city between the mountains and the sea, tagged 'world' and 'rio', rungs of the 'rio'
 * collection (groups.ts), tiers 1-5, their tools unlocked only by the locked tech node
 * 'wld1' (tech.ts) like the other world cities. Kind ids 183-187 (see landmarks-world.ts
 * for the world allocation). Scale: about 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   183 Christ the Redeemer: a library-family daytime attraction, the soapstone Christ
 *       with his outstretched arms on the peak of Corcovado
 *   184 Sugarloaf Mountain: a library-family attraction, the granite dome from the sea,
 *       the cable car climbing to its station on the summit
 *   185-187 to follow, one building at a time.
 */

const TAGS = ['world', 'rio'];

// ================================================================= 183 Christ the Redeemer

/**
 * The soapstone Christ on the peak of Corcovado, arms open over the city and the bay:
 * the jungle mountain turned as one lathe, and on its summit the figure, his outstretched
 * arms a single bar across the shoulders. Plain stone and jungle green only, so no window
 * rule is touched.
 */
const JUNGLE = 0x3f7a45, SOAPSTONE = 0xcfd4d8;

const christOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the peak of Corcovado under its jungle
  ops.push(['lathe', 0, 0.02, 0, JUNGLE, [1.0, 0, 0.8, 0.2, 0.55, 0.4, 0.35, 0.6, 0.22, 0.72, 0, 0.78], { seg: 20 }]);
  // the soapstone Christ: the figure and his outstretched arms
  ops.push(['lathe', 0, 0.8, 0, SOAPSTONE, [0.05, 0, 0.06, 0.05, 0.05, 0.15, 0.045, 0.22, 0.03, 0.26, 0, 0.28], { seg: 10 }]);
  ops.push(['box', 0.62, 0.045, 0.05, 0, 0.98, 0, SOAPSTONE]);
  // the little chapel platform at his feet and the lamps of the lookout
  ops.push(['box', 0.3, 0.03, 0.3, 0, 0.78, 0.18, 'stone']);
  ops.push(...lampPost(-0.3, 0.62, 0.28, 'marquee', 0.02), ...lampPost(0.3, 0.62, 0.28, 'marquee', 0.02));
  return ops;
};

export const christRedeemer: KindDef = {
  id: 'christ-the-redeemer', name: 'Christ the Redeemer', code: library.code, kindId: 183, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rio',
  occupation: { ...library.occupation!, name: 'sanctuary keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 160, ticket: 12, openHours: [8, 19], stay: [0.8, 1.6], leisureValue: 9, radius: 34,
    dayAppeal: 1.7, eveningAppeal: 0.4, retireeAppeal: 2.0, childAppeal: 1.5, title: 'Christ the Redeemer',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The soapstone Christ on the peak of Corcovado, thirty metres of open arms over the city and the bay: the jungle mountain, the lookout at his feet, and the figure himself against the sky.',
  howTo: 'A 2×2 plot high over the city, lawns below; a day out with a view that draws everyone, so give it a bus route. World landmark: unlock rule to be decided.',
  tool: { id: 'christredeemer', key: '', label: 'Christ the Redeemer', color: '#cfd4d8' },
  levels: [{
    capacity: 36, wage: 16, cost: 14000, upkeep: 60, work: 3000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the soapstone Christ with his outstretched arms on the peak of Corcovado', height: 1.08, ops: christOps() },
    ],
  }],
};

// ================================================================= 184 Sugarloaf Mountain

/**
 * The sugarloaf of granite rising sheer from the sea at the mouth of the bay: the dome
 * turned as one lathe from the water, the beach at its foot, and the cable car climbing
 * from its station on the shore to the little station on the summit, the cabin midway.
 * Plain stone and water only, so no window rule is touched.
 */
const GRANITE = 0x8a8f96;

const sugarloafOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the sea round the foot and the beach strip
  ops.push(['cyl', 0.85, 0.9, 0.015, 0, 0.02, 0, 'pond', 24]);
  ops.push(['box', 1.7, 0.012, 0.26, 0, 0.02, 0.82, 'sand']);
  // the dome of granite
  ops.push(['lathe', 0, 0.02, 0, GRANITE, [0.75, 0, 0.78, 0.08, 0.72, 0.2, 0.6, 0.32, 0.42, 0.42, 0.2, 0.5, 0, 0.54], { seg: 20 }]);
  // the cable car: shore station, the two cables, the cabin midway, the summit station
  ops.push(['box', 0.16, 0.1, 0.14, 0, 0.03, 0.68, 'stone']);
  ops.push(['taper', 0.012, 0.012, 0.012, 0.012, 0.44, 0, 0.12, 0.6, 'dark', { shift: [0, -0.46] }]);
  ops.push(['taper', 0.012, 0.012, 0.012, 0.012, 0.44, 0.05, 0.12, 0.6, 'dark', { shift: [-0.05, -0.46] }]);
  ops.push(['box', 0.07, 0.06, 0.07, 0.02, 0.34, 0.36, 'red']);
  ops.push(['box', 0.14, 0.08, 0.14, 0, 0.56, 0.02, 'stone']);
  // the palms of the shore
  ops.push(...tree(-0.68, 0.7, 0.55, 'green'), ...tree(0.68, 0.7, 0.55, 'green'));
  return ops;
};

export const sugarloaf: KindDef = {
  id: 'sugarloaf', name: 'Sugarloaf Mountain', code: library.code, kindId: 184, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rio',
  occupation: { ...library.occupation!, name: 'cable car operator' },
  attrs: {
    ...library.attrs, visitorCapacity: 130, ticket: 20, openHours: [8.5, 20], stay: [1.0, 1.8], leisureValue: 8, radius: 28,
    dayAppeal: 1.6, eveningAppeal: 0.6, retireeAppeal: 1.6, childAppeal: 1.7, title: 'Sugarloaf Mountain',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The sugarloaf of granite rising sheer from the sea at the mouth of the bay: the cable car climbing to the little station on the summit, the beach and the palms below.',
  howTo: 'A 2×2 plot by the water; a ride and a view that fills all afternoon, so give it a bus route. World landmark: unlock rule to be decided.',
  tool: { id: 'sugarloaf', key: '', label: 'Sugarloaf', color: '#8a8f96' },
  levels: [{
    capacity: 30, wage: 16, cost: 13000, upkeep: 60, work: 3000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the granite dome from the sea, the cable car climbing to its station on the summit', height: 0.64, ops: sugarloafOps() },
    ],
  }],
};

export const RIO_LANDMARKS: KindDef[] = [christRedeemer, sugarloaf];
