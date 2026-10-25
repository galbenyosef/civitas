import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { library } from './leisure';
import { office } from './office';
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
 *   199 Camp Nou: a library-family stadium attraction, the great blue bowl of the
 *       football club by the metro line
 *   200 Torre Glories: an office tower, the blue bullet by the old waterfront with
 *       its band of red
 */

const TAGS = ['world', 'barcelona'];
const SAGRADA_ST = 0xe3d5b8, SAGRADA_DK = 0xd0bf9c;

// shared base for the office tower (Torre Glories), as in landmarks-beijing.ts
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'barcelona',
};

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

const sagradaOpsK31 = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  ops.push(['box', 1.02, 0.35, 0.82, 0, 0.02, -0.12, SAGRADA_ST]);
  ops.push(['roof', 0.92, 0.2, 0.72, 0, 0.37, -0.12, SAGRADA_DK, true]);
  ops.push(['cyl', 0.33, 0.36, 0.3, 0, 0.02, -0.53, SAGRADA_ST, 16]);
  for (const x of [-0.3, 0, 0.3]) {
    ops.push(['box', 0.17, 0.24, 0.025, x, 0.02, 0.303, 'dark']);
    ops.push(['taper', 0.24, 0.08, 0.04, 0.04, 0.22, x, 0.26, 0.29, SAGRADA_DK]);
  }
  const tips = ['red', 'gold', 'green', 'marquee'] as const;
  const tower = (x: number, z: number, y: number, h: number, r: number, tip: number): void => {
    for (let i = 0; i < 5; i++) {
      const rb = r * (1 - i * 0.12), rt = r * (1 - (i + 1) * 0.12);
      ops.push(['taper', rb * 2, rb * 2, rt * 2, rt * 2, h / 5 - 0.012, x, y + h * i / 5, z, i % 2 ? SAGRADA_DK : SAGRADA_ST]);
      ops.push(['cyl', rt * 0.92, rt * 0.92, 0.014, x, y + h * (i + 1) / 5 - 0.014, z, 'dark', 10]);
    }
    ops.push(['lathe', x, y + h, z, tips[tip % tips.length], [r * 0.5, 0, r * 0.65, 0.035, r * 0.35, 0.09, 0, 0.13], { seg: 10 }]);
  };
  const facadeTowers = [[-0.4, 0.16, 0.72], [-0.15, 0.2, 0.86], [0.15, 0.2, 0.86], [0.4, 0.16, 0.72], [-0.4, -0.34, 0.8], [0.4, -0.34, 0.8], [-0.4, -0.62, 0.68], [0.4, -0.62, 0.68]] as const;
  facadeTowers.forEach(([x, z, h], i) => tower(x, z, 0.37, h, 0.065, i));
  for (const [x, z] of [[-0.18, -0.08], [0.18, -0.08], [-0.18, -0.4], [0.18, -0.4]] as const) tower(x, z, 0.5, 0.83, 0.07, 1);
  tower(0, -0.24, 0.52, 1.04, 0.1, 1);
  ops.push(['box', 0.035, 0.2, 0.035, 0, 1.69, -0.24, 'gold']);
  ops.push(['box', 0.16, 0.035, 0.035, 0, 1.76, -0.24, 'gold']);
  ops.push(['taper', 0.035, 0.035, 0.025, 0.025, 0.75, 0.72, 0.02, -0.42, 'yellow']);
  ops.push(['box', 0.62, 0.025, 0.025, 0.44, 0.77, -0.42, 'yellow']);
  ops.push(['box', 0.018, 0.28, 0.018, 0.15, 0.49, -0.42, 'dark']);
  ops.push(...tree(-0.78, 0.68, 0.5), ...tree(0.78, 0.68, 0.5));
  ops.push(...lampPost(-0.52, 0.82, 0.28, 'marquee', 0.02), ...lampPost(0.52, 0.82, 0.28, 'marquee', 0.02));
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
      { author: 'k3.1-pro', draft: true, name: 'thirteen perforated towers with mosaic tips around the central cross, plus the perennial crane', height: 1.9, ops: sagradaOpsK31() },
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

// ================================================================= 199 Camp Nou

/**
 * The great bowl of the football club, the biggest stadium in Europe for a hundred
 * years: the two-tiered concrete stands, the ring of blue seats that gives the bowl
 * its colour on match night, the green pitch sunk in the middle, and the four
 * floodlight masts leaning over it all. Solid stone and plain insets only, so no
 * window rule is touched.
 */
const NOU_BOWL = 0xb8b4a8, NOU_BLUE = 0x2c5f9e, NOU_PITCH = 0x3f8a3f;

const campNouOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the two-tiered bowl of the stands
  ops.push(['lathe', 0, 0.02, 0, NOU_BOWL, [0.9, 0, 0.9, 0.14, 0.8, 0.14, 0.8, 0.28, 0.66, 0.28, 0.66, 0.34, 0.44, 0.34, 0.44, 0.36, 0, 0.36], { seg: 24 }]);
  // the ring of blue seats around the upper tier
  ops.push(['lathe', 0, 0.24, 0, NOU_BLUE, [0.81, 0, 0.81, 0.06, 0, 0.06], { seg: 24 }]);
  // the green pitch sunk in the middle
  ops.push(['cyl', 0.42, 0.44, 0.015, 0, 0.37, 0, NOU_PITCH, 20]);
  // the four floodlight masts leaning over the bowl
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ops.push(['taper', 0.04, 0.04, 0.03, 0.03, 0.4, sx * 0.82, 0.02, sz * 0.82, 'dark', { shift: [-sx * 0.06, -sz * 0.06] }]);
    ops.push(['box', 0.1, 0.06, 0.04, sx * 0.76, 0.43, sz * 0.76, 'marquee']);
  }
  // the plaza: lamps and a pair of palms
  ops.push(...lampPost(-0.6, 0.92, 0.3, 'marquee', 0.02), ...lampPost(0.6, 0.92, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.78, 0.7, 0.5, 'green'), ...tree(0.78, 0.7, 0.5, 'green'));
  return ops;
};

export const campNou: KindDef = {
  id: 'camp-nou', name: 'Camp Nou', code: library.code, kindId: 199, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'barcelona',
  occupation: { ...library.occupation!, name: 'stadium steward' },
  attrs: {
    ...library.attrs, visitorCapacity: 400, ticket: 24, openHours: [10, 22.5], stay: [1.6, 2.6], leisureValue: 9, radius: 32,
    dayAppeal: 1.3, eveningAppeal: 1.0, retireeAppeal: 1.1, childAppeal: 2.0, title: 'Camp Nou',
  },
  lot: { wage: 17 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The great bowl of the football club, the biggest stadium in Europe for a hundred years: the two tiers of concrete, the ring of blue seats, the green pitch sunk in the middle, and the floodlights leaning over it all.',
  howTo: 'A 2×2 plot near transit; it fills on match nights and pays for itself, so give it a metro and leave the streets clear after the whistle. World landmark: unlock rule to be decided.',
  tool: { id: 'campnou', key: '', label: 'Camp Nou', color: '#2c5f9e' },
  levels: [{
    capacity: 65, wage: 17, cost: 19000, upkeep: 85, work: 4000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the great blue bowl with its green pitch and floodlight masts', height: 0.52, ops: campNouOps() },
    ],
  }],
};

// ================================================================= 200 Torre Glories

/**
 * The blue bullet the architect dropped by the old waterfront, shining over the
 * district that rebuilt itself around it: the glass body swelling out of the
 * ground, the collar of red where it begins to climb, the dome of the crown that
 * lights the whole city at night. Plain glass only, so no window rule is touched.
 */
const GLORIES_BLUE = 0x2c4f8a, GLORIES_RED = 0xc9372c;

const torreGloriesOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the glass bullet, swelling out of the ground and narrowing to its dome
  ops.push(['lathe', 0, 0.02, 0, GLORIES_BLUE, [0.3, 0, 0.38, 0.1, 0.42, 0.3, 0.4, 0.6, 0.34, 0.85, 0.24, 1.05, 0.1, 1.15, 0, 1.18], { seg: 20 }]);
  // the collar of red where the tower begins to climb
  ops.push(['lathe', 0, 0.72, 0, GLORIES_RED, [0.39, 0, 0.39, 0.06, 0, 0.06], { seg: 20 }]);
  // the little entrance pod at its foot
  ops.push(['box', 0.5, 0.12, 0.3, 0, 0.02, 0.42, 0x8a97a8]);
  // the plaza: lamps and a pair of trees
  ops.push(...lampPost(-0.7, 0.75, 0.3, 'marquee', 0.02), ...lampPost(0.7, 0.75, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.8, -0.6, 0.5), ...tree(0.8, -0.6, 0.5));
  return ops;
};

export const torreGlories: KindDef = {
  ...towerBase, id: 'torre-glories', name: 'Torre Glories', kindId: 200, tier: 4,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The blue bullet by the old waterfront: the glass body swelling out of the ground, the collar of red where it begins to climb, and the dome of the crown that lights the whole district at night.',
  howTo: 'A 2×2 plot among offices on an avenue; a big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'torreglories', key: '', label: 'Torre Glories', color: '#2c4f8a' },
  levels: [{
    capacity: 260, wage: 42, cost: 21000, upkeep: 120, work: 4400, parking: { surface: 0, underground: 60 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the blue bullet with its collar of red over the new district', height: 1.22, ops: torreGloriesOps() },
    ],
  }],
};

export const BARCELONA_LANDMARKS: KindDef[] = [sagradaFamilia, casaBatllol, campNou, torreGlories];
