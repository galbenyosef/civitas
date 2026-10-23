import type { KindDef, Op } from './schema';
import { library } from './leisure';
import { slab, tree, lampPost, PAVING } from './tierkit';

/**
 * Barcelona landmarks (docs/buildings.md "Landmarks"): the buildings of the modernist
 * city on the Mediterranean, tagged 'world' and 'barcelona', rungs of the 'barcelona'
 * collection (groups.ts), tiers 1-4, their tools unlocked only by the locked tech node
 * 'wld1' (tech.ts) like the other world cities. Kind ids 197-200 (see landmarks-world.ts
 * for the world allocation). Scale: about 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   197 the Sagrada Familia: a library-family daytime attraction, the spires of the
 *       unfinished basilica with their crane still on the job
 *   198 Casa Batllo: a library-family attraction, the house of bones with its dragon
 *       roof on the grand avenue
 *   199-200 to follow, one building at a time.
 */

const TAGS = ['world', 'barcelona'];
const SAGRADA_ST = 0xe3d5b8, SAGRADA_DK = 0xd0bf9c;

// ================================================================= 197 the Sagrada Familia

/**
 * The basilica the architect left unfinished on purpose, so the work would never stop:
 * the sandstone nave and apse, the eight spires with their gilded tips, the triple portal
 * of the nativity front, and the yellow crane that has stood over the crossing for a
 * hundred years. Plain stone and dark insets only, so no window rule is touched.
 */
const sagradaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the nave and the rounded apse
  ops.push(['box', 0.9, 0.28, 0.55, 0, 0.02, -0.15, SAGRADA_ST]);
  ops.push(['cyl', 0.26, 0.28, 0.24, 0, 0.02, -0.42, SAGRADA_ST, 12]);
  // the triple portal of the nativity front
  for (const x of [-0.24, 0, 0.24]) ops.push(['box', 0.14, 0.2, 0.02, x, 0.02, 0.135, 0x4a3b28]);
  // the eight spires, four tall at the corners and four lower between them, gilded tips
  for (const [x, z, h] of [[-0.32, -0.05, 0.72], [0.32, -0.05, 0.72], [-0.32, -0.35, 0.72], [0.32, -0.35, 0.72]] as const) {
    ops.push(['taper', 0.09, 0.09, 0.025, 0.025, h, x, 0.3, z, SAGRADA_DK]);
    ops.push(['cyl', 0.008, 0.008, 0.05, x, 0.3 + h, z, 'gold', 5]);
  }
  for (const [x, z, h] of [[0, -0.05, 0.5], [0, -0.35, 0.5], [-0.32, -0.2, 0.5], [0.32, -0.2, 0.5]] as const) {
    ops.push(['taper', 0.08, 0.08, 0.02, 0.02, h, x, 0.3, z, SAGRADA_ST]);
    ops.push(['cyl', 0.008, 0.008, 0.05, x, 0.3 + h, z, 'gold', 5]);
  }
  // the crane that has stood over the crossing for a hundred years
  ops.push(['taper', 0.03, 0.03, 0.02, 0.02, 0.55, 0.5, 0.02, -0.2, 0xe8c53c]);
  ops.push(['box', 0.5, 0.02, 0.02, 0.28, 0.56, -0.2, 0xe8c53c]);
  // the park around: trees and lamps
  ops.push(...tree(-0.72, 0.62, 0.55), ...tree(0.72, 0.62, 0.55));
  ops.push(...lampPost(-0.5, 0.75, 0.3, 'marquee', 0.02), ...lampPost(0.5, 0.75, 0.3, 'marquee', 0.02));
  return ops;
};

export const sagradaFamilia: KindDef = {
  id: 'sagrada-familia', name: 'the Sagrada Familia', code: library.code, kindId: 197, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'barcelona',
  occupation: { ...library.occupation!, name: 'works guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 240, ticket: 22, openHours: [9, 19.5], stay: [1.0, 2.2], leisureValue: 9, radius: 32,
    dayAppeal: 1.7, eveningAppeal: 0.3, retireeAppeal: 1.8, childAppeal: 1.5, title: 'the Sagrada Familia',
  },
  lot: { wage: 17 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The basilica the architect left unfinished on purpose, so the work would never stop: the sandstone spires with their gilded tips, the nativity front in its green shade, and the yellow crane that has stood over the crossing for a hundred years.',
  howTo: 'A 2×2 plot in the Eixample grid among apartments; a heavy daytime draw from across the city, so give it a metro or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'sagradafamilia', key: '', label: 'Sagrada Familia', color: '#e3d5b8' },
  levels: [{
    capacity: 52, wage: 17, cost: 16000, upkeep: 70, work: 3400, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the spires of the unfinished basilica with their crane still on the job', height: 1.1, ops: sagradaOps() },
    ],
  }],
};

// ================================================================= 198 Casa Batllo

/**
 * The house of bones the master rebuilt for the Batllo family on the grand avenue: the
 * sand-gold facade with its rows of irregular windows, the white balconies like skulls,
 * and the blue back of the dragon curving over the roof to the little tower with its
 * cross. Plain walls and dark insets only, so no window rule is touched.
 */
const BATLLO_SAND = 0xd8b86a, BATLLO_BLUE = 0x3a6fb5, BONE = 0xf0ece2;

const casaBatllolOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the facade with its three rows of irregular windows and the bone balconies
  ops.push(['box', 0.7, 0.55, 0.3, 0, 0.02, -0.1, BATLLO_SAND]);
  const rows = [0.12, 0.26, 0.4];
  rows.forEach((y, r) => {
    for (let i = 0; i < 3; i++) {
      const x = -0.2 + i * 0.2 + (r % 2 ? 0.03 : -0.02);
      ops.push(['box', 0.08, 0.13, 0.02, x, y, 0.065, 0x3a4a42]);
    }
    ops.push(['box', 0.62, 0.02, 0.04, 0, y - 0.02, 0.07, BONE]);
  });
  // the dragon's back of blue scales over the roof
  ops.push(['taper', 0.52, 0.32, 0.34, 0.18, 0.16, 0, 0.57, -0.1, BATLLO_BLUE]);
  ops.push(['taper', 0.36, 0.2, 0.22, 0.12, 0.1, 0, 0.7, -0.1, 0x5a8fd5]);
  // the little tower with its gilded cross
  ops.push(['taper', 0.08, 0.08, 0.04, 0.04, 0.12, 0.28, 0.72, -0.1, BATLLO_SAND]);
  ops.push(['box', 0.05, 0.09, 0.012, 0.28, 0.84, -0.1, 'gold']);
  // the avenue: lamps and a tree
  ops.push(...lampPost(-0.5, 0.6, 0.3, 'marquee', 0.02), ...lampPost(0.5, 0.6, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.72, -0.6, 0.55));
  return ops;
};

export const casaBatllol: KindDef = {
  id: 'casa-batllo', name: 'Casa Batllo', code: library.code, kindId: 198, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'barcelona',
  occupation: { ...library.occupation!, name: 'house guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 80, ticket: 18, openHours: [9.5, 20], stay: [0.6, 1.2], leisureValue: 8, radius: 24,
    dayAppeal: 1.4, eveningAppeal: 0.6, retireeAppeal: 1.5, childAppeal: 1.6, title: 'Casa Batllo',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The house of bones the master rebuilt for the Batllo family: the sand-gold facade, the windows like the mouths of fish, the white balconies of skulls, and the blue back of the dragon curving over the roof.',
  howTo: 'A 2×2 plot on a shopping avenue among apartments; a ticketed visit that glows at dusk, best near restaurants and cafes. World landmark: unlock rule to be decided.',
  tool: { id: 'casabatllol', key: '', label: 'Casa Batllo', color: '#d8b86a' },
  levels: [{
    capacity: 18, wage: 16, cost: 10000, upkeep: 50, work: 2200, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the house of bones with its dragon roof on the grand avenue', height: 0.95, ops: casaBatllolOps() },
    ],
  }],
};

export const BARCELONA_LANDMARKS: KindDef[] = [sagradaFamilia, casaBatllol];
