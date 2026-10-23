import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { office } from './office';
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
 *   179 the Great Wall: a library-family attraction, the wall climbing over the ridge with
 *       its watchtower and beacon
 *   180 Tiananmen Gate: a library-family attraction, the rostrum and double-eaved tower
 *       over the gate of heavenly peace, the golden-water bridges before it
 *   181 the CCTV Headquarters: an office, the two leaning towers joined head to heel in a
 *       loop of glass over the avenue
 *   182 the Summer Palace: a library-family attraction, the tower of Buddhist incense on
 *       its hill above the lake, the marble causeway over the water
 */

const TAGS = ['world', 'beijing'];
const IMPERIAL_RED = 0x9e2b22, GLAZED_GOLD = 0xd8a83c, MARBLE_W = 0xe8e2d4, GLAZED_BLUE = 0x3f6fb5;
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'beijing',
};

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

// ================================================================= 179 the Great Wall

/**
 * The wall over the mountains north of the capital, drawn along z with the door at the
 * south end: the battlements climbing the ridge in their grey stone, cresting at the
 * watchtower with its hipped roof and beacon, and dropping to the pass below. Plain stone,
 * so no window rule is touched.
 */
const WALL_STONE = 0x8a8578, WALL_DK = 0x7a7568;

const greatWallOps = (): Op[] => {
  const ops: Op[] = [slab(1, 4, 'lawn')];
  // the ridge profile the wall climbs, south to north
  const H = [0.06, 0.38, 0.22, 0.05];
  for (let i = 0; i < 4; i++) {
    const z = -1.5 + i;
    ops.push(['box', 0.5, H[i] + 0.12, 0.98, 0, 0.02, z, WALL_STONE]);
    ops.push(['box', 0.06, 0.06, 0.98, -0.22, H[i] + 0.14, z, WALL_DK], ['box', 0.06, 0.06, 0.98, 0.22, H[i] + 0.14, z, WALL_DK]);
  }
  // the watchtower on the crest with its hipped roof and beacon
  ops.push(['box', 0.7, 0.3, 0.7, 0, 0.52, -0.5, WALL_STONE]);
  ops.push(['roof', 0.8, 0.16, 0.8, 0, 0.82, -0.5, WALL_DK, true]);
  ops.push(['cone', 0.03, 0.07, 0, 0.98, -0.5, 'gold', 6]);
  // pines on the slopes below
  ops.push(...tree(-0.36, 0.9, 0.45), ...tree(0.36, -1.6, 0.45));
  return ops;
};

export const greatWall: KindDef = {
  id: 'great-wall', name: 'the Great Wall', code: library.code, kindId: 179, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'beijing',
  occupation: { ...library.occupation!, name: 'wall warden' },
  attrs: {
    ...library.attrs, visitorCapacity: 120, ticket: 16, openHours: [8.5, 18], stay: [0.8, 1.6], leisureValue: 7, radius: 26,
    dayAppeal: 1.5, eveningAppeal: 0.2, retireeAppeal: 1.8, childAppeal: 1.6, title: 'the Great Wall',
  },
  lot: { wage: 16 },
  footprint: { w: 1, h: 4, door: [0, 3] },
  blurb: 'The wall over the mountains north of the capital, twenty thousand li of stone and watchfire: the battlements climbing the ridge, the tower cresting the pass, the beacon that once called the alarm.',
  howTo: 'Placed with its tool it is a 1×4 landmark on dry land, its door at one end; in a real city it would run the ridge it defends. World landmark: unlock rule to be decided.',
  tool: { id: 'greatwall', key: '', label: 'Great Wall', color: '#8a8578' },
  levels: [{
    capacity: 24, wage: 16, cost: 11000, upkeep: 50, work: 2400, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the wall climbing over the ridge, the watchtower at the crest with its beacon', height: 1.05, ops: greatWallOps() },
    ],
  }],
};

// ================================================================= 180 Tiananmen Gate

/**
 * The gate of heavenly peace at the head of the imperial way: the red rostrum with its
 * dark arch, the gilded portrait frame on the wall, the double-eaved tower of yellow tile
 * rising above, and before it the golden-water stream with its five marble bridges. Plain
 * walls and dark insets only, so no window rule is touched.
 */
const tiananmenOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the golden-water stream and its five marble bridges
  ops.push(['box', 1.6, 0.01, 0.3, 0, 0.02, 0.5, 'pond']);
  for (let i = 0; i < 5; i++) ops.push(['box', 0.14, 0.03, 0.34, -0.6 + i * 0.3, 0.02, 0.5, MARBLE_W]);
  // the red rostrum, the gate arch, the portrait frame
  ops.push(['box', 1.5, 0.3, 0.7, 0, 0.02, -0.2, IMPERIAL_RED]);
  ops.push(['box', 0.3, 0.22, 0.02, 0, 0.04, 0.16, 0x3a2a20]);
  ops.push(['box', 0.12, 0.16, 0.012, 0, 0.12, 0.16, GLAZED_GOLD]);
  // the double-eaved tower of yellow tile
  ops.push(['box', 0.95, 0.22, 0.5, 0, 0.32, -0.2, IMPERIAL_RED]);
  ops.push(['box', 0.7, 0.1, 0.02, 0, 0.36, 0.06, 0x3a2a20]);
  ops.push(['taper', 1.15, 0.6, 0.95, 0.42, 0.08, 0, 0.54, -0.2, GLAZED_GOLD]);
  ops.push(['taper', 0.8, 0.4, 0.6, 0.24, 0.07, 0, 0.62, -0.2, GLAZED_GOLD]);
  ops.push(['box', 0.55, 0.035, 0.1, 0, 0.69, -0.2, GLAZED_GOLD]);
  ops.push(['cone', 0.02, 0.05, -0.24, 0.72, -0.2, GLAZED_GOLD, 6], ['cone', 0.02, 0.05, 0.24, 0.72, -0.2, GLAZED_GOLD, 6]);
  // the red flags and lamps of the square
  ops.push(...flags(-0.55, 0.55, 2, 0.55, ['red', 'yellow'], 1.1));
  ops.push(...lampPost(-0.75, 0.85, 0.3, 'marquee', 0.02), ...lampPost(0.75, 0.85, 0.3, 'marquee', 0.02));
  return ops;
};

export const tiananmenGate: KindDef = {
  id: 'tiananmen-gate', name: 'Tiananmen Gate', code: library.code, kindId: 180, family: 'leisure', tier: 4,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'beijing',
  occupation: { ...library.occupation!, name: 'gate keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 90, ticket: 0, openHours: [8.5, 17.5], stay: [0.4, 0.9], leisureValue: 6, radius: 20,
    dayAppeal: 1.2, eveningAppeal: 0.3, retireeAppeal: 1.6, childAppeal: 1.0, title: 'Tiananmen Gate',
  },
  lot: { wage: 14 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The gate of heavenly peace at the head of the imperial way: the red rostrum with its arch, the tower of yellow tile above, and the golden-water stream with its five marble bridges before it.',
  howTo: 'A 2×2 plot at the head of an axis, open to the square; a short free visit that anchors a ceremonial district. World landmark: unlock rule to be decided.',
  tool: { id: 'tiananmen', key: '', label: 'Tiananmen Gate', color: '#d8a83c' },
  levels: [{
    capacity: 14, wage: 14, cost: 8000, upkeep: 35, work: 1600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the rostrum and double-eaved tower over the gate of heavenly peace, the golden-water bridges before it', height: 0.77, ops: tiananmenOps() },
    ],
  }],
};

// ================================================================= 181 the CCTV Headquarters

/**
 * The great loop of glass the broadcasters built in the new CBD: two leaning towers, each
 * rising and tipping toward the other until they cross, joined by the horizontal bars at
 * the waist and the crown, an Escher figure forty-four storeys tall. Each tower is one
 * leaning taper, so there are no stacked walls to half-hide a window.
 */
const CCTV_GLASS = 0x5a6b7a, CCTV_DK = 0x46545f;

const cctvOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the two leaning towers, each tipping toward the other until they cross
  ops.push(['taper', 0.38, 0.38, 0.34, 0.34, 2.1, -0.42, 0.02, 0, CCTV_GLASS, { win: 'office', shift: [0.55, 0] }]);
  ops.push(['taper', 0.38, 0.38, 0.34, 0.34, 2.1, 0.42, 0.02, 0, CCTV_GLASS, { win: 'office', shift: [-0.55, 0] }]);
  // the horizontal bars at the waist and the crown
  ops.push(['box', 0.62, 0.14, 0.32, 0, 0.82, 0, CCTV_DK]);
  ops.push(['box', 0.62, 0.14, 0.32, 0, 1.62, 0, CCTV_DK]);
  // the pavement: lamps and a pair of trees
  ops.push(...lampPost(-0.8, 0.8, 0.32, 'marquee', 0.02), ...lampPost(0.8, 0.8, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.85, -0.75, 0.55), ...tree(0.85, -0.75, 0.55));
  return ops;
};

export const cctvTower: KindDef = {
  ...towerBase, id: 'cctv-tower', name: 'the CCTV Headquarters', kindId: 181, tier: 5,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The great loop of glass in the new CBD: two leaning towers tipping toward each other until they cross, joined at the waist and the crown, an Escher figure on the skyline.',
  howTo: 'A 2×2 plot among offices on an avenue; a big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'cctv', key: '', label: 'CCTV Tower', color: '#5a6b7a' },
  levels: [{
    capacity: 340, wage: 44, cost: 24000, upkeep: 130, work: 4600, parking: { surface: 0, underground: 65 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the leaning towers joined head to heel, the loop of glass over the avenue', height: 2.12, ops: cctvOps() },
    ],
  }],
};

// ================================================================= 182 the Summer Palace

/**
 * The garden of the empress by the western lake: the water of Kunming in front, the
 * marble causeway crossing it, the hill of longevity behind with the tower of Buddhist
 * incense on its top, four storeys of red drums under the golden eaves. Plain walls and
 * dark insets only, so no window rule is touched.
 */
const summerOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the lake and the marble causeway crossing it
  ops.push(['cyl', 0.7, 0.74, 0.015, 0, 0.02, 0.3, 'pond', 24]);
  ops.push(['box', 0.22, 0.03, 0.24, 0.1, 0.02, 0.08, MARBLE_W], ['box', 0.22, 0.045, 0.2, 0.22, 0.02, 0.3, MARBLE_W], ['box', 0.22, 0.03, 0.24, 0.32, 0.02, 0.5, MARBLE_W]);
  // the hill of longevity, three stone steps up
  ops.push(['box', 1.2, 0.14, 0.7, 0, 0.02, -0.42, 'stone']);
  ops.push(['box', 1.0, 0.12, 0.55, 0, 0.16, -0.48, 'stone']);
  ops.push(['box', 0.8, 0.1, 0.45, 0, 0.28, -0.5, 'stone']);
  // the tower of Buddhist incense: four storeys of red drums under golden eaves
  ops.push(['cyl', 0.26, 0.28, 0.08, 0, 0.38, -0.5, IMPERIAL_RED, 12]);
  ops.push(['cone', 0.4, 0.05, 0, 0.46, -0.5, GLAZED_GOLD, 16]);
  ops.push(['cyl', 0.2, 0.22, 0.07, 0, 0.51, -0.5, IMPERIAL_RED, 12]);
  ops.push(['cone', 0.33, 0.05, 0, 0.58, -0.5, GLAZED_GOLD, 16]);
  ops.push(['cyl', 0.15, 0.17, 0.07, 0, 0.63, -0.5, IMPERIAL_RED, 10]);
  ops.push(['cone', 0.26, 0.05, 0, 0.7, -0.5, GLAZED_GOLD, 16]);
  ops.push(['cyl', 0.11, 0.13, 0.06, 0, 0.75, -0.5, IMPERIAL_RED, 10]);
  ops.push(['cone', 0.19, 0.05, 0, 0.81, -0.5, GLAZED_GOLD, 14]);
  ops.push(['cyl', 0.02, 0.025, 0.08, 0, 0.86, -0.5, GLAZED_GOLD, 6]);
  // the willows and lamps of the shore
  ops.push(...tree(-0.62, 0.75, 0.6), ...tree(0.68, 0.72, 0.6));
  ops.push(...lampPost(-0.35, 0.62, 0.3, 'marquee', 0.02), ...lampPost(0.5, 0.6, 0.3, 'marquee', 0.02));
  return ops;
};

export const summerPalace: KindDef = {
  id: 'summer-palace', name: 'the Summer Palace', code: library.code, kindId: 182, family: 'leisure', tier: 6,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'beijing',
  occupation: { ...library.occupation!, name: 'garden keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 130, ticket: 16, openHours: [8.5, 18], stay: [1.0, 2.0], leisureValue: 8, radius: 26,
    dayAppeal: 1.5, eveningAppeal: 0.2, retireeAppeal: 2.2, childAppeal: 1.4, title: 'the Summer Palace',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The garden of the empress by the western lake: the water of Kunming, the marble causeway, and the hill of longevity with the tower of Buddhist incense rising over it all, four storeys under the golden eaves.',
  howTo: 'A 2×2 plot with lawns and water, a park setting suits it; a calm daytime visit for retirees and school trips. World landmark: unlock rule to be decided.',
  tool: { id: 'summerpalace', key: '', label: 'Summer Palace', color: '#3f6fb5' },
  levels: [{
    capacity: 28, wage: 16, cost: 12000, upkeep: 55, work: 2600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the tower of buddhist incense on its hill above the lake, the marble causeway over the water', height: 0.94, ops: summerOps() },
    ],
  }],
};

export const BEIJING_LANDMARKS: KindDef[] = [forbiddenCity, templeOfHeaven, greatWall, tiananmenGate, cctvTower, summerPalace];
