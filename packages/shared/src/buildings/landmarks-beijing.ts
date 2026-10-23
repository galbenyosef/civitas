import type { KindDef, Op } from './schema';
import { library } from './leisure';
import { slab, tree, lampPost, flags, PAVING } from './tierkit';

/**
 * Beijing landmarks (docs/buildings.md "Landmarks"): the imperial and modern monuments of
 * the capital, tagged 'world' and 'beijing', rungs of the 'beijing' collection (groups.ts),
 * tiers 1-6, their tools unlocked only by the locked tech node 'wld1' (tech.ts) like the
 * other world cities. Kind ids 177-182 (see landmarks-world.ts for the world allocation).
 * Scale: about 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   177 the Forbidden City: a library-family daytime attraction, the hall of supreme
 *       harmony on its triple white terrace under the golden double eaves
 *   178 the Temple of Heaven: a library-family attraction, the blue triple-eaved hall of
 *       prayer on its round marble terrace among the pines
 *   179-182 to follow, one building at a time.
 */

const TAGS = ['world', 'beijing'];
const IMPERIAL_RED = 0x9e2b22, GLAZED_GOLD = 0xd8a83c, MARBLE_W = 0xe8e2d4, GLAZED_BLUE = 0x3f6fb5;

// ================================================================= 177 the Forbidden City

/**
 * The hall of supreme harmony, the greatest of the imperial halls: the red-walled hall on
 * its triple terrace of white marble, the broad central stairs, and above it all the
 * double eaves of yellow glazed tile with the gilded ridge. Plain walls and dark door
 * insets only, so no window rule is touched.
 */
const forbiddenOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the triple white terrace and the central stairs
  ops.push(['box', 1.7, 0.1, 1.4, 0, 0.02, -0.1, MARBLE_W]);
  ops.push(['box', 1.5, 0.1, 1.2, 0, 0.12, -0.1, MARBLE_W]);
  ops.push(['box', 1.3, 0.1, 1.0, 0, 0.22, -0.1, MARBLE_W]);
  ops.push(['box', 0.3, 0.1, 0.14, 0, 0.02, 0.62, MARBLE_W], ['box', 0.3, 0.2, 0.14, 0, 0.02, 0.52, MARBLE_W], ['box', 0.3, 0.3, 0.14, 0, 0.02, 0.42, MARBLE_W]);
  // the red hall with its dark doors
  ops.push(['box', 0.75, 0.28, 0.55, 0, 0.32, -0.05, IMPERIAL_RED]);
  ops.push(['box', 0.5, 0.16, 0.02, 0, 0.34, 0.235, 0x3a2a20]);
  // the golden double eaves and the ridge with its ornaments
  ops.push(['taper', 1.05, 0.85, 0.85, 0.65, 0.1, 0, 0.6, -0.05, GLAZED_GOLD]);
  ops.push(['taper', 0.7, 0.5, 0.5, 0.32, 0.09, 0, 0.7, -0.05, GLAZED_GOLD]);
  ops.push(['box', 0.5, 0.04, 0.1, 0, 0.79, -0.05, GLAZED_GOLD]);
  ops.push(['cone', 0.02, 0.05, -0.22, 0.83, -0.05, GLAZED_GOLD, 6], ['cone', 0.02, 0.05, 0.22, 0.83, -0.05, GLAZED_GOLD, 6]);
  // the imperial way: yellow flags and lamps, no trees in the great court
  ops.push(...flags(-0.6, 0.6, 2, 0.5, ['yellow', 'red'], 1.2));
  ops.push(...lampPost(-0.7, 0.72, 0.3, 'marquee', 0.02), ...lampPost(0.7, 0.72, 0.3, 'marquee', 0.02));
  return ops;
};

export const forbiddenCity: KindDef = {
  id: 'forbidden-city', name: 'the Forbidden City', code: library.code, kindId: 177, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'beijing',
  occupation: { ...library.occupation!, name: 'palace guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 220, ticket: 24, openHours: [8.5, 17], stay: [1.2, 2.4], leisureValue: 9, radius: 32,
    dayAppeal: 1.7, eveningAppeal: 0.1, retireeAppeal: 1.9, childAppeal: 1.7, title: 'the Forbidden City',
  },
  lot: { wage: 17 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The greatest of the imperial halls, nine thousand rooms behind the vermilion walls: the hall of supreme harmony on its triple terrace of white marble under the golden double eaves.',
  howTo: 'A 2×2 plot on a grand axis, walled courts around; a heavy daytime draw from across the city, so give it a metro or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'forbiddencity', key: '', label: 'Forbidden City', color: '#9e2b22' },
  levels: [{
    capacity: 50, wage: 17, cost: 16000, upkeep: 70, work: 3400, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the hall of supreme harmony on its triple white terrace under the golden double eaves', height: 0.88, ops: forbiddenOps() },
    ],
  }],
};

// ================================================================= 178 the Temple of Heaven

/**
 * The hall of prayer for good harvests in the temple park: the round terrace of white
 * marble, the red drum of the hall, and above it the three blue eaves stepping in, one on
 * the other, with the gilded finial over all. Plain walls and dark door insets only, so
 * no window rule is touched.
 */
const templeOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the round marble terrace and the steps
  ops.push(['cyl', 0.6, 0.64, 0.08, 0, 0.02, 0, MARBLE_W, 20]);
  ops.push(['box', 0.36, 0.04, 0.12, 0, 0.02, 0.62, MARBLE_W], ['box', 0.36, 0.08, 0.12, 0, 0.02, 0.54, MARBLE_W]);
  // the red drum of the hall with its dark doors
  ops.push(['cyl', 0.3, 0.32, 0.16, 0, 0.1, 0, IMPERIAL_RED, 14]);
  ops.push(['box', 0.22, 0.12, 0.02, 0, 0.12, 0.3, 0x3a2a20]);
  // the three blue eaves with the red drums between, the gilded finial
  ops.push(['cone', 0.45, 0.06, 0, 0.26, 0, GLAZED_BLUE, 16]);
  ops.push(['cyl', 0.24, 0.26, 0.06, 0, 0.32, 0, IMPERIAL_RED, 12]);
  ops.push(['cone', 0.37, 0.06, 0, 0.38, 0, GLAZED_BLUE, 16]);
  ops.push(['cyl', 0.18, 0.2, 0.06, 0, 0.44, 0, IMPERIAL_RED, 12]);
  ops.push(['cone', 0.28, 0.08, 0, 0.5, 0, GLAZED_BLUE, 16]);
  ops.push(['cyl', 0.025, 0.03, 0.1, 0, 0.58, 0, GLAZED_GOLD, 8]);
  // the park pines and the lamps of the approach
  ops.push(...tree(-0.72, 0.72, 0.55), ...tree(0.72, 0.72, 0.55));
  ops.push(...lampPost(-0.45, 0.85, 0.3, 'marquee', 0.02), ...lampPost(0.45, 0.85, 0.3, 'marquee', 0.02));
  return ops;
};

export const templeOfHeaven: KindDef = {
  id: 'temple-of-heaven', name: 'the Temple of Heaven', code: library.code, kindId: 178, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'beijing',
  occupation: { ...library.occupation!, name: 'temple keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 140, ticket: 14, openHours: [8, 18], stay: [0.8, 1.6], leisureValue: 8, radius: 26,
    dayAppeal: 1.5, eveningAppeal: 0.2, retireeAppeal: 2.4, childAppeal: 1.2, title: 'the Temple of Heaven',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The hall of prayer for good harvests in the temple park: the blue triple eaves stepping in over the red drum, the marble terrace round it, and the old pines that guard the fasting ground.',
  howTo: 'A 2×2 plot with lawns and pines, a park setting suits it; a calm daytime visit for retirees and school trips. World landmark: unlock rule to be decided.',
  tool: { id: 'templeofheaven', key: '', label: 'Temple of Heaven', color: '#3f6fb5' },
  levels: [{
    capacity: 30, wage: 16, cost: 12000, upkeep: 55, work: 2800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the blue triple-eaved hall of prayer on its round marble terrace among the pines', height: 0.68, ops: templeOps() },
    ],
  }],
};

export const BEIJING_LANDMARKS: KindDef[] = [forbiddenCity, templeOfHeaven];
