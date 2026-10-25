import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { office } from './office';
import { library } from './leisure';
import { slab, tree, lampPost, PAVING, ASPHALT } from './tierkit';
import { fableGoldenGateOps, fableTransamericaOps, fableCoitOps, fableFerryOps, fableAlcatrazOps } from './landmarks-san-francisco-fable';

/**
 * San Francisco landmarks (docs/buildings.md "Landmarks"): the monuments of the bay city
 * on its hills, tagged 'world' and 'san-francisco', rungs of the 'san-francisco'
 * collection (groups.ts), tiers 1-5, their tools unlocked only by the locked tech node
 * 'wld1' (tech.ts) like the other world cities. Kind ids 192-196 (see landmarks-world.ts
 * for the world allocation). Scale: about 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   192 the Golden Gate Bridge: a library-family attraction, the orange towers and the
 *       great cables over the strait
 *   193 the Transamerica Pyramid: an office, the white pyramid with its wings and spire
 *   194 Coit Tower: a library-family attraction, the white tower on its hill above the
 *       bay, the dark observation band under its cap
 *   195 the Ferry Building: a library-family attraction, the arched hall on the pier with
 *       its clock tower over the embarkation front
 *   196 Alcatraz: a library-family attraction, the rock in the bay with its cellhouse and
 *       lighthouse
 */

const TAGS = ['world', 'san-francisco'];
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'san-francisco',
};

// ================================================================= 192 the Golden Gate Bridge

/**
 * The bridge they said could not be built, drawn along z with the door at the city end:
 * the orange deck on its towers, each a pair of legs joined by a strut, and the great
 * cables sagging between the tower tops in bars, the hangers dropping to the deck.
 * Plain steel only, so no window rule is touched.
 */
const INTL_ORANGE = 0xc0362c, ORANGE_DK = 0xa82e26;

const goldenGateOps = (): Op[] => {
  const ops: Op[] = [];
  // a sloping bar from (z0, y0) to (z1, y1) at x
  const bar = (x: number, z0: number, y0: number, z1: number, y1: number, t: number, c: Color): Op => {
    if (Math.abs(y1 - y0) < 0.04) return ['box', t, t, Math.abs(z1 - z0), x, Math.min(y0, y1), (z0 + z1) / 2, c];
    const [zl, yl, zh, yh] = y0 < y1 ? [z0, y0, z1, y1] : [z1, y1, z0, y0];
    return ['taper', t, t, t, t, yh - yl, x, yl, zl, c, { shift: [0, zh - zl] }];
  };
  // the deck and its promenade rails
  ops.push(['box', 0.4, 0.04, 3.9, 0, 0.3, 0, ASPHALT]);
  ops.push(['box', 0.46, 0.025, 3.9, 0, 0.34, 0, INTL_ORANGE]);
  // the two great towers, each a pair of legs with a mid strut and a cap
  for (const sz of [-1, 1]) {
    ops.push(['box', 0.05, 0.68, 0.06, -0.07, 0.02, sz * 0.75, INTL_ORANGE], ['box', 0.05, 0.68, 0.06, 0.07, 0.02, sz * 0.75, INTL_ORANGE]);
    ops.push(['box', 0.19, 0.06, 0.07, 0, 0.32, sz * 0.75, INTL_ORANGE]);
    ops.push(['box', 0.19, 0.06, 0.07, 0, 0.66, sz * 0.75, INTL_ORANGE]);
  }
  // the main cables sagging between the tower tops, and the hangers to the deck
  const sag = (z: number) => 0.68 - 0.24 * (1 - (z / 0.75) ** 2);
  const pts = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];
  for (let i = 0; i < pts.length - 1; i++) {
    ops.push(bar(-0.15, pts[i], sag(pts[i]), pts[i + 1], sag(pts[i + 1]), 0.03, INTL_ORANGE));
    ops.push(bar(0.15, pts[i], sag(pts[i]), pts[i + 1], sag(pts[i + 1]), 0.03, INTL_ORANGE));
  }
  for (const z of [-0.5, -0.25, 0, 0.25, 0.5]) {
    ops.push(['box', 0.32, sag(z) - 0.34, 0.012, 0, 0.36, z, ORANGE_DK]);
  }
  // the cypresses of the Presidio end and the lamps
  ops.push(...tree(-0.3, 1.75, 0.5, 'green'), ...tree(0.3, 1.75, 0.5, 'green'));
  ops.push(...lampPost(-0.18, 1.9, 0.3, 'marquee', 0.02), ...lampPost(0.18, 1.9, 0.3, 'marquee', 0.02));
  return ops;
};

const goldenGateOpsK31 = (): Op[] => {
  const ops: Op[] = [slab(1, 4, 'pond')];
  const bar = (x: number, z0: number, y0: number, z1: number, y1: number): Op => {
    const [zl, zh] = y0 < y1 ? [z0, z1] : [z1, z0];
    return ['taper', 0.022, 0.022, 0.022, 0.022, Math.abs(y1 - y0) + 0.006, x, Math.min(y0, y1) - 0.003, zl, INTL_ORANGE, { shift: [0, zh - zl] }];
  };
  ops.push(['box', 0.43, 0.07, 3.94, 0, 0.3, 0, INTL_ORANGE]);
  ops.push(['box', 0.36, 0.025, 3.94, 0, 0.37, 0, ASPHALT]);
  for (const x of [-0.205, 0.205]) ops.push(['box', 0.025, 0.09, 3.94, x, 0.37, 0, INTL_ORANGE]);
  for (const z of [-0.82, 0.82]) {
    for (const x of [-0.16, 0.16]) {
      ops.push(['box', 0.13, 0.12, 0.2, x, 0.02, z, ORANGE_DK]);
      ops.push(['taper', 0.075, 0.1, 0.045, 0.065, 1.28, x, 0.14, z, INTL_ORANGE]);
      ops.push(['box', 0.075, 0.035, 0.095, x, 1.42, z, INTL_ORANGE]);
    }
    for (const y of [0.48, 0.87, 1.24]) ops.push(['box', 0.37, 0.055, 0.075, 0, y, z, INTL_ORANGE]);
  }
  const mainSag = (z: number) => 0.58 + 0.86 * (z / 0.82) ** 2;
  const sideSag = (z: number) => 0.48 + 0.96 * (1 - (Math.abs(z) - 0.82) / 1.13) ** 2;
  const cableY = (z: number) => Math.abs(z) <= 0.82 ? mainSag(z) : sideSag(z);
  const points = [-1.95, -1.67, -1.39, -1.11, -0.82, -0.615, -0.41, -0.205, 0, 0.205, 0.41, 0.615, 0.82, 1.11, 1.39, 1.67, 1.95];
  for (const x of [-0.235, 0.235]) {
    for (let i = 0; i < points.length - 1; i++) ops.push(bar(x, points[i], cableY(points[i]), points[i + 1], cableY(points[i + 1])));
    for (let z = -1.8; z <= 1.81; z += 0.2) {
      if (Math.abs(Math.abs(z) - 0.82) < 0.1) continue;
      ops.push(['box', 0.012, cableY(z) - 0.42, 0.012, x, 0.4, z, ORANGE_DK]);
    }
  }
  for (const [x, z, color] of [[-0.09, -1.35, 'white'], [0.09, -0.42, 'yellow'], [-0.09, 0.28, 'navy'], [0.09, 1.3, 'white']] as const) {
    ops.push(['box', 0.055, 0.035, 0.12, x, 0.395, z, color]);
  }
  for (const z of [-1.88, 1.88]) {
    ops.push(['box', 0.48, 0.1, 0.22, 0, 0.01, z, 'stone']);
    ops.push(['box', 0.46, 0.025, 0.2, 0, 0.11, z, 'lawn']);
  }
  return ops;
};

export const goldenGate: KindDef = {
  id: 'golden-gate', name: 'the Golden Gate Bridge', code: library.code, kindId: 192, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'san-francisco',
  occupation: { ...library.occupation!, name: 'bridge walk guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 110, ticket: 10, openHours: [9, 19], stay: [0.8, 1.6], leisureValue: 8, radius: 28,
    dayAppeal: 1.6, eveningAppeal: 0.5, retireeAppeal: 1.5, childAppeal: 1.6, title: 'the Golden Gate Bridge',
  },
  lot: { wage: 16 },
  footprint: { w: 1, h: 4, door: [0, 3] },
  blurb: 'The bridge they said could not be built, the orange towers wading through the fog of the strait: the deck a mile and a half long, the cables sagging between the tower tops, the whole bay in one glance from the middle.',
  howTo: 'Placed with its tool it is a 1×4 landmark on dry land, its door at one end; in a real city it would span the strait it crosses. World landmark: unlock rule to be decided.',
  tool: { id: 'goldengate', key: '', label: 'Golden Gate', color: '#c0362c' },
  levels: [{
    capacity: 24, wage: 16, cost: 14000, upkeep: 65, work: 3200, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'k3.1-pro', draft: true, name: 'tall art-deco towers, continuous side-span cables, separate suspenders and tiny traffic above the water', height: 1.46, ops: goldenGateOpsK31() },
      { author: 'kimi-2.8-preview', draft: true, name: 'the orange towers and the great cables over the strait', height: 0.74, ops: goldenGateOps() },
      { author: 'claude-fable-5-1', name: 'the orange towers tall over the strait between the two headlands, the cables sagging to the deck and the hangers dropping from them', height: 2.0, ops: fableGoldenGateOps() },
    ],
  }],
};

// ================================================================= 193 the Transamerica Pyramid

/**
 * The pyramid on the skyline, the tallest thing in the city for a generation: the white
 * shaft tapering to a point, the two wings rising on its flanks near the top, and the
 * spire with its aircraft light over all. One taper, so there are no stacked walls to
 * half-hide a window.
 */
const PYRAMID = 0xe8e4da;

const transamericaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, ASPHALT)];
  // the small podium at the foot
  ops.push(['box', 1.0, 0.08, 1.0, 0, 0.02, 0, 0xcfc9bc]);
  // the pyramid shaft, the wings on its flanks, the spire
  ops.push(['taper', 0.82, 0.82, 0.06, 0.06, 1.45, 0, 0.1, 0, PYRAMID, { win: 'office' }]);
  ops.push(['taper', 0.05, 0.12, 0.04, 0.08, 0.34, -0.17, 1.05, 0, PYRAMID]);
  ops.push(['taper', 0.05, 0.12, 0.04, 0.08, 0.34, 0.17, 1.05, 0, PYRAMID]);
  ops.push(['cyl', 0.015, 0.02, 0.2, 0, 1.55, 0, 'steel', 6]);
  ops.push(['cyl', 0.028, 0.028, 0.05, 0, 1.75, 0, 'red', 6]);
  // the pavement: lamps and a pair of trees
  ops.push(...lampPost(-0.62, 0.72, 0.3, 'marquee', 0.02), ...lampPost(0.62, 0.72, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.78, -0.72, 0.5), ...tree(0.78, -0.72, 0.5));
  return ops;
};

export const transamerica: KindDef = {
  ...towerBase, id: 'transamerica-pyramid', name: 'the Transamerica Pyramid', kindId: 193, tier: 2,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The pyramid on the skyline, the tallest thing in the city for a generation: the white shaft tapering to its point, the little wings on its flanks, and the spire that blinks over the fog.',
  howTo: 'A 2×2 plot downtown among offices; a big workplace, so give it buses or a station. World landmark: unlock rule to be decided.',
  tool: { id: 'transamerica', key: '', label: 'Transamerica Pyramid', color: '#e8e4da' },
  levels: [{
    capacity: 260, wage: 42, cost: 20000, upkeep: 110, work: 4200, parking: { surface: 0, underground: 55 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the white pyramid with its wings and spire', height: 1.8, ops: transamericaOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the pyramid at its real slenderness over the open truss base, the wings following its slope, the aluminium spire', height: 3.58, ops: fableTransamericaOps() },
    ],
  }],
};

// ================================================================= 194 Coit Tower

/**
 * The plain white column the firemen\'s benefactor left on Telegraph Hill: the green hill
 * over the bay, and on its top the fluted shaft, the dark band of the observation windows
 * under the cap, and the little lobby at its foot. Plain concrete only, so no window rule
 * is touched.
 */
const COIT_WHITE = 0xf0ece2;

const coitOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the hill of telegraph hill
  ops.push(['lathe', 0, 0.02, 0, 0x5f7a4a, [0.85, 0, 0.7, 0.12, 0.5, 0.22, 0.3, 0.28, 0, 0.3], { seg: 20 }]);
  // the white shaft with its dark observation band and cap
  ops.push(['cyl', 0.14, 0.15, 0.4, 0, 0.32, 0, COIT_WHITE, 12]);
  ops.push(['cyl', 0.152, 0.152, 0.06, 0, 0.64, 0, 0x3a3630, 12]);
  ops.push(['cyl', 0.155, 0.165, 0.04, 0, 0.7, 0, COIT_WHITE, 12]);
  ops.push(['cyl', 0.05, 0.06, 0.1, 0, 0.32, 0.16, COIT_WHITE, 8]);
  // the parrots\' trees and the lamps of the hill
  ops.push(...tree(-0.52, 0.42, 0.55), ...tree(0.5, -0.5, 0.55));
  ops.push(...lampPost(-0.3, 0.55, 0.3, 'marquee', 0.02), ...lampPost(0.3, 0.55, 0.3, 'marquee', 0.02));
  return ops;
};

export const coitTower: KindDef = {
  id: 'coit-tower', name: 'Coit Tower', code: library.code, kindId: 194, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'san-francisco',
  occupation: { ...library.occupation!, name: 'lookout host' },
  attrs: {
    ...library.attrs, visitorCapacity: 70, ticket: 10, openHours: [10, 18.5], stay: [0.4, 0.9], leisureValue: 6, radius: 20,
    dayAppeal: 1.3, eveningAppeal: 0.4, retireeAppeal: 1.6, childAppeal: 1.1, title: 'Coit Tower',
  },
  lot: { wage: 14 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The plain white column on Telegraph Hill, the gift of a firemen\'s friend who loved the city\'s heroes: the shaft over the bay, the dark band of the observation windows, the wild parrots in the trees below.',
  howTo: 'A 2×2 plot high over the water, lawns below; a short cheap visit for the view, prettiest at dusk. World landmark: unlock rule to be decided.',
  tool: { id: 'coittower', key: '', label: 'Coit Tower', color: '#f0ece2' },
  levels: [{
    capacity: 12, wage: 14, cost: 7000, upkeep: 30, work: 1400, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the white tower on its hill above the bay, the dark observation band under its cap', height: 0.76, ops: coitOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the fluted column flared at its top on a higher Telegraph Hill, the arcaded lookout, the Filbert steps down the front', height: 1.64, ops: fableCoitOps() },
    ],
  }],
};

// ================================================================= 195 the Ferry Building

/**
 * The great hall of the ferries at the foot of the market street, where the whole city
 * once changed trams: the long arched hall on the pier, its three great arches on the
 * embarkation front, the row of little windows above, and the clock tower with its gold
 * faces rising over all. Plain stone and dark insets only, so no window rule is touched.
 */
const FERRY = 0xd9c9a8, FERRY_DK = 0xc4b28e, CLOCK_GOLD = 0xd8a83c;

const ferryOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the little basin at the pier head
  ops.push(['cyl', 0.25, 0.28, 0.012, 0, 0.02, 0.72, 'pond', 16]);
  // the long hall with its three great arches and the windows above and along the flanks
  ops.push(['box', 1.7, 0.35, 0.7, 0, 0.02, -0.2, FERRY]);
  for (const x of [-0.5, 0, 0.5]) ops.push(['box', 0.16, 0.2, 0.02, x, 0.04, 0.16, 0x3a3630]);
  for (const x of [-0.62, -0.37, -0.12, 0.12, 0.37, 0.62]) ops.push(['box', 0.09, 0.1, 0.015, x, 0.25, 0.155, FERRY_DK]);
  for (const sx of [-1, 1]) for (const z of [-0.4, -0.15, 0.05]) ops.push(['box', 0.015, 0.12, 0.09, sx * 0.855, 0.14, z, FERRY_DK]);
  ops.push(['box', 1.74, 0.04, 0.74, 0, 0.37, -0.2, FERRY_DK]);
  // the clock tower with its gold faces and pyramidal cap
  ops.push(['box', 0.28, 0.8, 0.28, 0, 0.02, 0.32, FERRY]);
  ops.push(['box', 0.13, 0.13, 0.012, 0, 0.6, 0.47, CLOCK_GOLD]);
  ops.push(['box', 0.13, 0.13, 0.012, 0, 0.6, 0.17, CLOCK_GOLD]);
  ops.push(['cone', 0.14, 0.1, 0, 0.82, 0.32, 'slate', 8]);
  // the lamps of the pier
  ops.push(...lampPost(-0.72, 0.6, 0.3, 'marquee', 0.02), ...lampPost(0.72, 0.6, 0.3, 'marquee', 0.02));
  return ops;
};

export const ferryBuilding: KindDef = {
  id: 'ferry-building', name: 'the Ferry Building', code: library.code, kindId: 195, family: 'leisure', tier: 4,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'san-francisco',
  occupation: { ...library.occupation!, name: 'pier master' },
  attrs: {
    ...library.attrs, visitorCapacity: 90, ticket: 0, openHours: [9, 19], stay: [0.5, 1.1], leisureValue: 6, radius: 22,
    dayAppeal: 1.3, eveningAppeal: 0.3, retireeAppeal: 1.6, childAppeal: 1.1, title: 'the Ferry Building',
  },
  lot: { wage: 15 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The great hall of the ferries at the foot of the market street: the three arches on the embarkation front, the row of little windows above, and the clock tower whose gold faces greeted every boat from the bay.',
  howTo: 'A 2×2 plot at the water\'s edge with the pier towards it; a free visit that anchors the market district, best near shops. World landmark: unlock rule to be decided.',
  tool: { id: 'ferrybuilding', key: '', label: 'Ferry Building', color: '#d9c9a8' },
  levels: [{
    capacity: 16, wage: 15, cost: 9000, upkeep: 40, work: 1800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the arched hall on the pier with its clock tower over the embarkation front', height: 0.92, ops: ferryOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the long arcade of thirteen arches under a stepped clock tower with four dials, the bay and a ferry behind', height: 1.59, ops: fableFerryOps() },
    ],
  }],
};

// ================================================================= 196 Alcatraz

/**
 * The rock in the bay, the prison they said no one escaped: the island rising sheer from
 * the water, the long cellhouse with its rows of window slits, the lighthouse at its end,
 * and the cell blocks where the birdman kept his birds. Plain stone and dark insets only,
 * so no window rule is touched.
 */
const ROCK = 0x8a8578, CELLHOUSE = 0xd9d4cc;

const alcatrazOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'pond')];
  // the island rising from the water
  ops.push(['lathe', 0, 0.02, 0, ROCK, [0.6, 0, 0.56, 0.05, 0.42, 0.11, 0.34, 0.11, 0.3, 0.14, 0, 0.14], { seg: 20 }]);
  // the parade ground on the flat top
  ops.push(['box', 0.34, 0.012, 0.2, 0.12, 0.15, 0.12, 0xb9b4a8]);
  // the long cellhouse with its window slits
  ops.push(['box', 0.55, 0.14, 0.24, 0, 0.16, -0.05, CELLHOUSE]);
  for (const sx of [-1, 1]) for (const x of [-0.18, -0.06, 0.06, 0.18]) {
    ops.push(['box', 0.05, 0.05, 0.012, x, 0.21, -0.05 + sx * 0.125, 0x3a3630]);
  }
  // the lighthouse at the end of the rock
  ops.push(['cyl', 0.03, 0.035, 0.16, 0.32, 0.16, -0.05, CELLHOUSE, 8]);
  ops.push(['cyl', 0.02, 0.025, 0.04, 0.32, 0.32, -0.05, 'marquee', 6]);
  ops.push(['cone', 0.025, 0.03, 0.32, 0.36, -0.05, 'slate', 6]);
  return ops;
};

export const alcatraz: KindDef = {
  id: 'alcatraz', name: 'Alcatraz', code: library.code, kindId: 196, family: 'leisure', tier: 5,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'san-francisco',
  occupation: { ...library.occupation!, name: 'island warden' },
  attrs: {
    ...library.attrs, visitorCapacity: 80, ticket: 18, openHours: [9, 18.5], stay: [1.0, 1.8], leisureValue: 7, radius: 26,
    dayAppeal: 1.4, eveningAppeal: 0.3, retireeAppeal: 1.4, childAppeal: 1.6, title: 'Alcatraz',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The rock in the bay, the prison they said no one escaped: the ferry out past the island, the cellhouse with its rows of window slits, the lighthouse still sweeping the gate of the bay.',
  howTo: 'A 2×2 plot on the water suits the island; a ticketed day trip for the curious, best with a ferry pier or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'alcatraz', key: '', label: 'Alcatraz', color: '#8a8578' },
  levels: [{
    capacity: 20, wage: 16, cost: 10000, upkeep: 45, work: 2000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the rock in the bay, the cellhouse and the lighthouse on their island', height: 0.4, ops: alcatrazOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the oval rock in the bay, the cellhouse along its top, the lighthouse, the water tower and the dock with its ferry', height: 0.54, ops: fableAlcatrazOps() },
    ],
  }],
};

export const SAN_FRANCISCO_LANDMARKS: KindDef[] = [goldenGate, transamerica, coitTower, ferryBuilding, alcatraz];
