import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { library } from './leisure';
import { office } from './office';
import { slab, tree, lampPost, PAVING } from './tierkit';

/**
 * Seattle landmarks (docs/buildings.md "Landmarks"): the buildings of the city
 * between the sound and the lakes, tagged 'world' and 'seattle', rungs of the
 * 'seattle' collection (groups.ts), tiers 1-4, their tools unlocked only by
 * the locked tech node 'wld1' (tech.ts) like the other world cities. Kind ids
 * 209-212 (see landmarks-world.ts for the world allocation). Scale: about
 * 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   209 the Space Needle: an office tower, the flying saucer on its tripod
 *       legs over the fairground
 *   210 Pike Place Market: a library-family attraction, the market sheds
 *       sloping to the harbour with their neon sign
 *   211 the Columbia Center: an office tower, the black glass monolith with
 *       its three white fins
 *   212 the Smith Tower: an office tower, the white terra-cotta tower of
 *       1914 with its pyramid roof and little cupola
 */

const TAGS = ['world', 'seattle'];

// shared base for the office towers, as in landmarks-beijing.ts
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'seattle',
};

// ================================================================= 209 the Space Needle

/**
 * The saucer the fairground built and the city refused to give back: three
 * tripod legs leaning together, the flying-saucer top with its ring of
 * windows, the orange roof disc, and the mast. Plain painted steel and
 * glass only, so no window rule is touched.
 */
const NEEDLE_WHITE = 0xe8e6e0, NEEDLE_ORANGE = 0xd97c2c;

const spaceNeedleOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the three tripod legs leaning together
  for (const [sx, sz] of [[-1, -1], [1, -1], [0, 1]] as const) {
    ops.push(['taper', 0.1, 0.1, 0.05, 0.05, 2.2, sx * 0.45, 0.02, sz * 0.45, NEEDLE_WHITE, { shift: [-sx * 0.38, -sz * 0.38] }]);
  }
  // the flying-saucer top with its ring of windows
  ops.push(['lathe', 0, 2.24, 0, NEEDLE_WHITE, [0.1, 0, 0.42, 0.05, 0.48, 0.12, 0.44, 0.2, 0.3, 0.26], { seg: 16, win: 'office' }]);
  // the orange roof disc and the mast
  ops.push(['lathe', 0, 2.5, 0, NEEDLE_ORANGE, [0.34, 0, 0.34, 0.05, 0, 0.05], { seg: 16 }]);
  ops.push(['cyl', 0.01, 0.01, 0.5, 0, 2.55, 0, 'steel', 6]);
  // the fairground: lamps and a pair of trees
  ops.push(...lampPost(-0.7, 0.75, 0.3, 'marquee', 0.02), ...lampPost(0.7, 0.75, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.8, -0.72, 0.5), ...tree(0.8, -0.72, 0.5));
  return ops;
};

const spaceNeedleOpsK31 = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  ops.push(['cyl', 0.8, 0.8, 0.025, 0, 0.01, 0, PAVING, 24]);
  ops.push(['cyl', 0.07, 0.09, 2.14, 0, 0.035, 0, 'steel', 12]);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 - Math.PI / 2;
    for (const side of [-0.11, 0.11]) {
      const b = a + side;
      const x = Math.cos(b) * 0.52, z = Math.sin(b) * 0.52;
      ops.push(['box', 0.14, 0.05, 0.14, x, 0.035, z, NEEDLE_WHITE]);
      ops.push(['taper', 0.065, 0.065, 0.038, 0.038, 2.08, x, 0.085, z, NEEDLE_WHITE, { shift: [Math.cos(b) * 0.12 - x, Math.sin(b) * 0.12 - z] }]);
    }
  }
  ops.push(['lathe', 0, 2.08, 0, NEEDLE_WHITE, [0.12, 0, 0.25, 0.06, 0.48, 0.15, 0.52, 0.2, 0.5, 0.24], { seg: 24 }]);
  ops.push(['cyl', 0.49, 0.49, 0.12, 0, 2.31, 0, 'dark', 24]);
  ops.push(['cyl', 0.52, 0.52, 0.035, 0, 2.43, 0, NEEDLE_WHITE, 24]);
  ops.push(['lathe', 0, 2.465, 0, NEEDLE_ORANGE, [0.51, 0, 0.46, 0.045, 0.3, 0.13, 0.12, 0.2, 0, 0.23], { seg: 24 }]);
  ops.push(['cyl', 0.025, 0.07, 0.4, 0, 2.65, 0, 'steel', 10]);
  ops.push(['cyl', 0.025, 0.025, 0.055, 0, 3.05, 0, 'red', 6]);
  for (const [x, z] of [[-0.72, 0.62], [0.72, 0.62], [0, -0.82]] as const) ops.push(...tree(x, z, 0.48));
  ops.push(...lampPost(-0.42, 0.78, 0.3, 'marquee', 0.02), ...lampPost(0.42, 0.78, 0.3, 'marquee', 0.02));
  return ops;
};

export const spaceNeedle: KindDef = {
  ...towerBase, id: 'space-needle', name: 'the Space Needle', kindId: 209, tier: 1,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The saucer the fairground built and the city refused to give back: three tripod legs leaning together, the flying-saucer top with its ring of windows a hundred and sixty metres up, and the orange roof disc over it all.',
  howTo: 'A 2×2 plot among offices on an avenue; a big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'spaceneedle', key: '', label: 'Space Needle', color: '#d97c2c' },
  levels: [{
    capacity: 280, wage: 44, cost: 19000, upkeep: 120, work: 4200, parking: { surface: 0, underground: 60 },
    designs: [
      { author: 'k3.1-pro', draft: true, name: 'six splayed legs around a lift core, a dark observation band and an orange halo roof', height: 3.11, ops: spaceNeedleOpsK31() },
      { author: 'kimi-2.8-preview', name: 'the flying saucer on its tripod legs over the fairground', height: 3.1, ops: spaceNeedleOps() },
    ],
  }],
};

// ================================================================= 210 Pike Place Market

/**
 * The market the city kept when the bulldozers came for the waterfront: the
 * long sheds with their stepped gable roofs sloping to the harbour, the neon
 * sign over the door, and the stalls out front where they throw the fish.
 * Plain timber and paint only, so no window rule is touched.
 */
const MARKET_RED = 0xa83a2c, MARKET_CREAM = 0xe8dcc0, MARKET_DK = 0x3a3630;

const pikePlaceOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the long market shed with its rows of windows
  ops.push(['box', 1.5, 0.3, 0.6, -0.1, 0.02, -0.15, MARKET_CREAM]);
  for (const x of [-0.6, -0.35, -0.1, 0.15, 0.4]) ops.push(['box', 0.12, 0.12, 0.02, x, 0.12, 0.155, MARKET_DK]);
  // the stepped gable roof
  ops.push(['box', 1.54, 0.08, 0.4, -0.1, 0.32, -0.15, MARKET_RED]);
  ops.push(['box', 1.54, 0.08, 0.22, -0.1, 0.4, -0.15, MARKET_RED]);
  // the neon sign over the door
  ops.push(['box', 0.06, 0.3, 0.04, -0.72, 0.02, 0.14, MARKET_DK]);
  ops.push(['box', 0.5, 0.12, 0.03, -0.45, 0.32, 0.16, 'marquee']);
  // the stalls out front where they throw the fish
  for (const [i, x] of [-0.5, -0.15, 0.2].entries()) {
    ops.push(['box', 0.2, 0.1, 0.14, x, 0.02, 0.5, MARKET_CREAM]);
    ops.push(['box', 0.24, 0.03, 0.18, x, 0.12, 0.5, i % 2 ? MARKET_RED : 'white']);
  }
  // the forecourt: lamps and a tree
  ops.push(...lampPost(-0.7, 0.85, 0.3, 'marquee', 0.02), ...lampPost(0.55, 0.85, 0.3, 'marquee', 0.02));
  ops.push(...tree(0.78, -0.7, 0.5, 'green'));
  return ops;
};

export const pikePlace: KindDef = {
  id: 'pike-place', name: 'Pike Place Market', code: library.code, kindId: 210, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'seattle',
  occupation: { ...library.occupation!, name: 'market keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 160, ticket: 0, openHours: [9, 18], stay: [0.6, 1.4], leisureValue: 8, radius: 24,
    dayAppeal: 1.5, eveningAppeal: 0.5, retireeAppeal: 1.6, childAppeal: 1.5, title: 'Pike Place Market',
  },
  lot: { wage: 15 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The market the city kept when the bulldozers came for the waterfront: the long sheds with their stepped gable roofs, the neon sign over the door, and the stalls out front where they throw the fish.',
  howTo: 'A 2×2 plot on a shopping avenue near the water; a free-to-wander daytime draw, best near cafes and a bus stop. World landmark: unlock rule to be decided.',
  tool: { id: 'pikeplace', key: '', label: 'Pike Place', color: '#a83a2c' },
  levels: [{
    capacity: 28, wage: 15, cost: 12000, upkeep: 50, work: 2600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the market sheds sloping to the harbour with their neon sign', height: 0.5, ops: pikePlaceOps() },
    ],
  }],
};

// ================================================================= 211 the Columbia Center

/**
 * The black monolith the bank raised over the downtown: seventy-six storeys
 * of smoked glass, the tallest thing on the coast, its crown stepping back
 * under the three white fins that run up the front. Plain glass and steel
 * only, so no window rule is touched.
 */
const COLUMBIA_GLASS = 0x2c3038, COLUMBIA_FIN = 0x8a97a8;

const columbiaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the black glass shaft with its stepped crown
  ops.push(['box', 0.85, 3.4, 0.55, 0, 0.02, -0.05, COLUMBIA_GLASS]);
  ops.push(['box', 0.6, 0.4, 0.45, 0, 3.42, -0.05, COLUMBIA_GLASS]);
  // the three white fins up the front
  for (const x of [-0.25, 0, 0.25]) ops.push(['box', 0.02, 3.4, 0.02, x, 0.02, 0.24, COLUMBIA_FIN]);
  // the entry canopy
  ops.push(['box', 0.4, 0.04, 0.2, 0, 0.16, 0.28, 'marquee']);
  // the pavement: lamps and a pair of trees
  ops.push(...lampPost(-0.72, 0.75, 0.3, 'marquee', 0.02), ...lampPost(0.72, 0.75, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.8, -0.72, 0.5), ...tree(0.8, -0.72, 0.5));
  return ops;
};

export const columbiaCenter: KindDef = {
  ...towerBase, id: 'columbia-center', name: 'the Columbia Center', kindId: 211, tier: 3,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The black monolith the bank raised over the downtown: seventy-six storeys of smoked glass, the tallest thing on the coast, its crown stepping back under the three white fins that run up the front.',
  howTo: 'A 2×2 plot among offices on an avenue; a very big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'columbiacenter', key: '', label: 'Columbia Center', color: '#2c3038' },
  levels: [{
    capacity: 460, wage: 47, cost: 25000, upkeep: 140, work: 4700, parking: { surface: 0, underground: 90 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the black glass monolith with its three white fins', height: 3.85, ops: columbiaOps() },
    ],
  }],
};

// ================================================================= 212 the Smith Tower

/**
 * The white tower of 1914 that was the city's boast for half a century: the
 * terra-cotta shaft with its lattice of windows, the four-sided pyramid of
 * the roof, and the little cupola with its ball on top, built by the
 * typewriter magnate. Plain painted terra-cotta only, so no window rule
 * is touched.
 */
const SMITH_WHITE = 0xe8e2d4, SMITH_ROOF = 0x5a6b5a;

const smithTowerOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the terra-cotta shaft with its lattice of windows
  ops.push(['taper', 0.52, 0.52, 0.42, 0.42, 2.6, 0, 0.02, -0.05, SMITH_WHITE, { win: 'office' }]);
  // the four-sided pyramid and the little cupola with its ball
  ops.push(['cone', 0.4, 0.5, 0, 2.62, -0.05, SMITH_ROOF, 4]);
  ops.push(['cyl', 0.06, 0.06, 0.16, 0, 3.12, -0.05, SMITH_WHITE, 8]);
  ops.push(['cone', 0.07, 0.1, 0, 3.28, -0.05, SMITH_ROOF, 8]);
  // the pavement: lamps and a pair of trees
  ops.push(...lampPost(-0.7, 0.72, 0.3, 'marquee', 0.02), ...lampPost(0.7, 0.72, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.78, -0.7, 0.5), ...tree(0.78, -0.7, 0.5));
  return ops;
};

export const smithTower: KindDef = {
  ...towerBase, id: 'smith-tower', name: 'the Smith Tower', kindId: 212, tier: 4,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The white tower of 1914 that was the city\'s boast for half a century: the terra-cotta shaft with its lattice of windows, the four-sided pyramid of the roof, and the little cupola with its ball on top, built by the typewriter magnate.',
  howTo: 'A 2×2 plot among offices on an avenue; a big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'smithtower', key: '', label: 'Smith Tower', color: '#e8e2d4' },
  levels: [{
    capacity: 300, wage: 43, cost: 17000, upkeep: 100, work: 4000, parking: { surface: 0, underground: 45 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the white terra-cotta tower of 1914 with its pyramid roof and cupola', height: 3.4, ops: smithTowerOps() },
    ],
  }],
};

export const SEATTLE_LANDMARKS: KindDef[] = [spaceNeedle, pikePlace, columbiaCenter, smithTower];
