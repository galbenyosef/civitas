import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { library } from './leisure';
import { office } from './office';
import { slab, tree, lampPost, flags, PAVING } from './tierkit';

/**
 * Toronto landmarks (docs/buildings.md "Landmarks"): the buildings of the city
 * on the north shore of the lake, tagged 'world' and 'toronto', rungs of the
 * 'toronto' collection (groups.ts), tiers 1-4, their tools unlocked only by
 * the locked tech node 'wld1' (tech.ts) like the other world cities. Kind ids
 * 205-208 (see landmarks-world.ts for the world allocation). Scale: about
 * 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   205 the CN Tower: an office tower, the concrete needle over the harbour
 *       with its pod in the sky
 *   206 Casa Loma: a library-family attraction, the millionaire's castle on
 *       the hill above the avenue
 *   207 the Royal Ontario Museum: a library-family attraction, the stone
 *       museum with the glass crystal bursting out of its front corner
 *   208 Old City Hall: an office tower, the Romanesque sandstone pile with
 *       its clock tower over the old market square
 */

const TAGS = ['world', 'toronto'];

// shared base for the office towers, as in landmarks-beijing.ts
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'toronto',
};

// ================================================================= 205 the CN Tower

/**
 * The needle the railway built to hold its antennas over the harbour: the
 * concrete shaft climbing out of the rail lands, the great pod with its
 * glass-floor lookouts, the smaller skypod, and the antenna painted in
 * bands of red and white. Plain concrete and glass only, so no window
 * rule is touched.
 */
const CN_CONCRETE = 0xb8b4a8, CN_POD = 0xd8dcd8;

const cnTowerOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the concrete needle out of the rail lands
  ops.push(['lathe', 0, 0.02, 0, CN_CONCRETE, [0.34, 0, 0.28, 1.6, 0.22, 3.0, 0.17, 4.2], { seg: 12 }]);
  // the great pod with its lookouts
  ops.push(['lathe', 0, 3.3, 0, CN_POD, [0.17, 0, 0.5, 0.14, 0.54, 0.34, 0.48, 0.5, 0.2, 0.56], { seg: 16, win: 'office' }]);
  // the smaller skypod and the antenna in bands of red and white
  ops.push(['lathe', 0, 3.9, 0, CN_POD, [0.14, 0, 0.2, 0.1, 0.2, 0.24, 0.12, 0.3], { seg: 12 }]);
  ops.push(['cyl', 0.012, 0.012, 0.5, 0, 4.2, 0, 'white', 6]);
  ops.push(['cyl', 0.012, 0.012, 0.5, 0, 4.7, 0, 'red', 6]);
  // the plaza: flags, lamps, a pair of trees
  ops.push(...flags(-0.5, 0.8, 3, 0.5, ['red', 'white', 'red'], 0.02));
  ops.push(...lampPost(-0.72, 0.72, 0.3, 'marquee', 0.02), ...lampPost(0.72, 0.72, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.8, -0.7, 0.5), ...tree(0.8, -0.7, 0.5));
  return ops;
};

const cnTowerOpsK31 = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  ops.push(['cyl', 0.72, 0.72, 0.025, 0, 0.01, 0, 'gravel', 24]);
  ops.push(['taper', 0.34, 0.34, 0.12, 0.12, 4.55, 0, 0.035, 0, CN_CONCRETE]);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + Math.PI / 6;
    const x = Math.cos(a) * 0.32, z = Math.sin(a) * 0.32;
    ops.push(['taper', 0.17, 0.17, 0.09, 0.09, 1.45, x, 0.035, z, CN_CONCRETE, { shift: [-x * 0.72, -z * 0.72] }]);
  }
  ops.push(['lathe', 0, 3.15, 0, CN_POD, [0.16, 0, 0.34, 0.08, 0.5, 0.18, 0.54, 0.24, 0.54, 0.29], { seg: 24 }]);
  ops.push(['cyl', 0.535, 0.535, 0.16, 0, 3.44, 0, 'dark', 24]);
  ops.push(['cyl', 0.55, 0.55, 0.04, 0, 3.6, 0, CN_POD, 24]);
  ops.push(['lathe', 0, 3.64, 0, CN_POD, [0.5, 0, 0.48, 0.07, 0.26, 0.18, 0.16, 0.25], { seg: 24 }]);
  ops.push(['lathe', 0, 4.15, 0, CN_POD, [0.12, 0, 0.22, 0.06, 0.25, 0.13, 0.22, 0.21, 0.13, 0.25], { seg: 20 }]);
  ops.push(['cyl', 0.22, 0.22, 0.09, 0, 4.28, 0, 'dark', 20]);
  for (let i = 0; i < 5; i++) ops.push(['taper', 0.075 - i * 0.011, 0.075 - i * 0.011, 0.064 - i * 0.011, 0.064 - i * 0.011, 0.18, 0, 4.4 + i * 0.18, 0, i % 2 ? 'red' : 'white']);
  ops.push(['cyl', 0.018, 0.018, 0.08, 0, 5.3, 0, 'red', 6]);
  ops.push(['box', 0.9, 0.14, 0.42, 0, 0.035, 0.5, CN_POD]);
  for (const x of [-0.28, 0, 0.28]) ops.push(['box', 0.18, 0.09, 0.02, x, 0.055, 0.72, 'dark']);
  for (const x of [-0.65, -0.52]) ops.push(['box', 0.025, 0.018, 1.5, x, 0.035, -0.05, 'steel']);
  ops.push(...flags(0.2, 0.72, 2, 0.48, ['red', 'white'], 0.02));
  ops.push(...tree(-0.8, 0.72, 0.45), ...tree(0.82, -0.68, 0.45));
  return ops;
};

export const cnTower: KindDef = {
  ...towerBase, id: 'cn-tower', name: 'the CN Tower', kindId: 205, tier: 1,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The needle the railway built over the harbour: the concrete shaft climbing out of the rail lands, the great pod with its glass-floor lookouts three hundred and fifty metres up, and the antenna painted in bands of red and white.',
  howTo: 'A 2×2 plot among offices on an avenue; a big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'cntower', key: '', label: 'CN Tower', color: '#b8b4a8' },
  levels: [{
    capacity: 320, wage: 45, cost: 20000, upkeep: 130, work: 4400, parking: { surface: 0, underground: 70 },
    designs: [
      { author: 'k3.1-pro', draft: true, name: 'three concrete buttresses, two dark glazing bands and a separate SkyPod below the striped antenna', height: 5.38, ops: cnTowerOpsK31() },
      { author: 'kimi-2.8-preview', name: 'the concrete needle with its pod in the sky over the harbour', height: 5.25, ops: cnTowerOps() },
    ],
  }],
};

// ================================================================= 206 Casa Loma

/**
 * The castle the millionaire built on the hill above the avenue and never
 * quite finished paying for: the great hall with its rows of windows, the
 * square tower with its battlements and turrets, the stables wing, and the
 * gardens falling away below. Plain stone and dark insets only, so no
 * window rule is touched.
 */
const LOMA_STONE = 0xcabf9f, LOMA_DK = 0x3a3630, LOMA_ROOF = 0x5a6b5a;

const casaLomaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the terrace of the hill and the gardens falling away
  ops.push(['box', 1.5, 0.05, 1.3, 0, 0.02, -0.1, PAVING]);
  // the great hall with its rows of dark windows
  ops.push(['box', 0.9, 0.45, 0.5, -0.1, 0.07, -0.2, LOMA_STONE]);
  for (const y of [0.16, 0.3, 0.44]) {
    for (const x of [-0.38, -0.14, 0.1, 0.34]) ops.push(['box', 0.09, 0.12, 0.02, x, y, 0.065, LOMA_DK]);
  }
  // the square tower with its battlements and the turret with its cone roof
  ops.push(['box', 0.3, 0.8, 0.3, 0.42, 0.07, -0.3, LOMA_STONE]);
  for (const [bx, bz] of [[-0.12, -0.12], [0, -0.12], [0.12, -0.12], [-0.12, 0.12], [0, 0.12], [0.12, 0.12]] as const) {
    ops.push(['box', 0.06, 0.07, 0.06, 0.42 + bx, 0.87, -0.3 + bz, LOMA_STONE]);
  }
  ops.push(['cyl', 0.12, 0.12, 0.5, -0.62, 0.07, -0.32, LOMA_STONE, 8]);
  ops.push(['cone', 0.14, 0.2, -0.62, 0.57, -0.32, LOMA_ROOF, 8]);
  // the entrance porch and the stables wing
  ops.push(['box', 0.24, 0.14, 0.16, -0.1, 0.07, 0.12, LOMA_STONE]);
  ops.push(['box', 0.06, 0.05, 0.02, -0.1, 0.07, 0.2, LOMA_DK]);
  ops.push(['box', 0.5, 0.22, 0.3, -0.55, 0.07, -0.05, LOMA_STONE]);
  // the gardens: trees and lamps
  ops.push(...tree(-0.8, 0.6, 0.55, 'green'), ...tree(0.75, 0.65, 0.5, 'green'), ...tree(0.85, -0.75, 0.5, 'green'));
  ops.push(...lampPost(-0.4, 0.75, 0.3, 'marquee', 0.02), ...lampPost(0.35, 0.75, 0.3, 'marquee', 0.02));
  return ops;
};

export const casaLoma: KindDef = {
  id: 'casa-loma', name: 'Casa Loma', code: library.code, kindId: 206, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'toronto',
  occupation: { ...library.occupation!, name: 'castle caretaker' },
  attrs: {
    ...library.attrs, visitorCapacity: 140, ticket: 18, openHours: [9, 17], stay: [0.8, 1.6], leisureValue: 8, radius: 24,
    dayAppeal: 1.5, eveningAppeal: 0.3, retireeAppeal: 1.6, childAppeal: 1.6, title: 'Casa Loma',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The castle the millionaire built on the hill and never quite finished paying for: the great hall with its rows of windows, the square tower with its battlements, the turret with its cone roof, and the gardens falling away below.',
  howTo: 'A 2×2 plot above a shopping avenue; a ticketed daytime visit, best near restaurants and cafes. World landmark: unlock rule to be decided.',
  tool: { id: 'casaloma', key: '', label: 'Casa Loma', color: '#cabf9f' },
  levels: [{
    capacity: 24, wage: 16, cost: 11000, upkeep: 50, work: 2400, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the millionaire castle on the hill with its tower and gardens', height: 0.98, ops: casaLomaOps() },
    ],
  }],
};

// ================================================================= 207 the Royal Ontario Museum

/**
 * The museum of stone and crystal on the avenue: the pale 1914 building with
 * its rows of arched windows, and the crystal the architect bolted onto its
 * front corner — five glass prisms stepping out over the pavement, jagged
 * as a quartz seam. Plain stone and glass only, so no window rule is touched.
 */
const ROM_STONE = 0xcabf9f, ROM_DK = 0x3a3630, ROM_GLASS = 0xbfd4e0;

const romOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the 1914 building of pale stone
  ops.push(['box', 1.1, 0.5, 0.6, -0.25, 0.02, -0.25, ROM_STONE]);
  for (const y of [0.14, 0.32]) {
    for (const x of [-0.6, -0.35, -0.1, 0.15]) ops.push(['box', 0.1, 0.14, 0.02, x, y, 0.065, ROM_DK]);
  }
  // the crystal: five glass prisms stepping out over the front corner
  ops.push(['box', 0.34, 0.2, 0.34, 0.42, 0.02, 0.25, ROM_GLASS]);
  ops.push(['box', 0.3, 0.34, 0.3, 0.5, 0.22, 0.3, ROM_GLASS]);
  ops.push(['box', 0.24, 0.3, 0.24, 0.58, 0.56, 0.34, ROM_GLASS]);
  ops.push(['box', 0.16, 0.22, 0.16, 0.64, 0.86, 0.36, ROM_GLASS]);
  ops.push(['cone', 0.1, 0.24, 0.66, 1.08, 0.36, ROM_GLASS, 4]);
  // the pavement: lamps and a pair of trees
  ops.push(...lampPost(-0.7, 0.75, 0.3, 'marquee', 0.02), ...lampPost(0.3, 0.78, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.82, -0.7, 0.5), ...tree(0.8, -0.72, 0.5));
  return ops;
};

export const royalOntarioMuseum: KindDef = {
  id: 'royal-ontario-museum', name: 'the Royal Ontario Museum', code: library.code, kindId: 207, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'toronto',
  occupation: { ...library.occupation!, name: 'museum guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 200, ticket: 16, openHours: [10, 17.5], stay: [0.9, 1.8], leisureValue: 8, radius: 26,
    dayAppeal: 1.4, eveningAppeal: 0.4, retireeAppeal: 1.6, childAppeal: 1.8, title: 'the Royal Ontario Museum',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The museum of stone and crystal on the avenue: the pale 1914 building with its arched windows, and the crystal bolted onto its front corner — five glass prisms stepping out over the pavement, jagged as a quartz seam.',
  howTo: 'A 2×2 plot on a shopping avenue among apartments; a ticketed visit that glows at dusk, best near cafes and a bus stop. World landmark: unlock rule to be decided.',
  tool: { id: 'rom', key: '', label: 'Royal Ontario Museum', color: '#bfd4e0' },
  levels: [{
    capacity: 30, wage: 16, cost: 13000, upkeep: 55, work: 2800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the stone museum with the glass crystal bursting out of its corner', height: 1.35, ops: romOps() },
    ],
  }],
};

// ================================================================= 208 Old City Hall

/**
 * The Romanesque pile the city raised over the old market square: the
 * sandstone mass with its rows of round-arched windows, the grand arch of
 * the door, and the clock tower that has kept the courts' time for over a
 * hundred years. Plain sandstone and dark insets only, so no window rule
 * is touched.
 */
const HALL_SAND = 0x9a7a5a, HALL_DK = 0x3a3028, HALL_ROOF = 0x4a5a6a;

const oldCityHallOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the sandstone mass with its rows of dark windows
  ops.push(['box', 1.3, 0.5, 0.7, -0.1, 0.02, -0.2, HALL_SAND]);
  for (const y of [0.14, 0.32]) {
    for (const x of [-0.55, -0.3, -0.05, 0.2, 0.45]) ops.push(['box', 0.1, 0.13, 0.02, x, y, 0.165, HALL_DK]);
  }
  // the grand arch of the door
  ops.push(['box', 0.3, 0.22, 0.04, -0.1, 0.02, 0.165, HALL_DK]);
  // the clock tower with its faces and pointed roof
  ops.push(['box', 0.34, 0.95, 0.34, 0.42, 0.02, -0.28, HALL_SAND]);
  ops.push(['box', 0.16, 0.16, 0.02, 0.42, 0.8, -0.095, 'white']);
  ops.push(['box', 0.16, 0.16, 0.02, 0.42, 0.8, -0.465, 'white']);
  ops.push(['box', 0.02, 0.16, 0.16, 0.245, 0.8, -0.28, 'white']);
  ops.push(['cone', 0.26, 0.22, 0.42, 0.97, -0.28, HALL_ROOF, 8]);
  // the square: lamps, flags, a pair of trees
  ops.push(...lampPost(-0.6, 0.75, 0.3, 'marquee', 0.02), ...lampPost(0.3, 0.75, 0.3, 'marquee', 0.02));
  ops.push(...flags(-0.15, 0.85, 2, 0.4, ['red', 'white'], 0.02));
  ops.push(...tree(-0.82, -0.72, 0.5), ...tree(0.8, -0.75, 0.5));
  return ops;
};

export const oldCityHall: KindDef = {
  ...towerBase, id: 'old-city-hall', name: 'Old City Hall', kindId: 208, tier: 4,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The Romanesque pile over the old market square: the sandstone mass with its round-arched windows, the grand arch of the door, and the clock tower that has kept the courts\' time for over a hundred years.',
  howTo: 'A 2×2 plot among offices near a square; a big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'oldcityhall', key: '', label: 'Old City Hall', color: '#9a7a5a' },
  levels: [{
    capacity: 340, wage: 44, cost: 19000, upkeep: 110, work: 4200, parking: { surface: 0, underground: 50 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the Romanesque sandstone pile with its clock tower over the square', height: 1.2, ops: oldCityHallOps() },
    ],
  }],
};

export const TORONTO_LANDMARKS: KindDef[] = [cnTower, casaLoma, royalOntarioMuseum, oldCityHall];
