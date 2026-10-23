import type { KindDef, Op, Color } from './schema';
import { library, theatre } from './leisure';
import { slab, tree, lampPost, PAVING, ASPHALT } from './tierkit';

/**
 * Sydney landmarks (docs/buildings.md "Landmarks"): the buildings of the harbour city,
 * tagged 'world' and 'sydney', rungs of the 'sydney' collection (groups.ts), tiers 1-4,
 * their tools unlocked only by the locked tech node 'wld1' (tech.ts) like the other world
 * cities. Kind ids 188-191 (see landmarks-world.ts for the world allocation). Scale: about
 * 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   188 the Opera House: a theatre-family venue, the white sails over the harbour on their
 *       grand podium
 *   189 the Harbour Bridge: a library-family attraction, the great arch in its granite
 *       pylons over the harbour crossing
 *   190 Sydney Tower: a library-family attraction, the golden turret on its slender shaft
 *       over the shopping centre
 *   191 St Mary's Cathedral: a library-family attraction, the sandstone nave and its twin
 *       spires over the square
 */

const TAGS = ['world', 'sydney'];

// ================================================================= 188 the Opera House

/**
 * Utzon's sails on Bennelong Point: the grand podium on the water, and above it the
 * cluster of white shells, each a leaning slab, rising highest at the back and stepping
 * down to the water's edge. Plain white concrete only, so no window rule is touched.
 */
const SHELL = 0xf4f2ec, PODIUM = 0xd9d4cc;

const operaHouseOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the harbour in front and the grand podium on the point
  ops.push(['cyl', 0.48, 0.5, 0.015, 0, 0.02, 0.45, 'pond', 24]);
  ops.push(['box', 1.6, 0.14, 1.0, 0, 0.02, -0.2, PODIUM]);
  // the sails, highest at the back and stepping down to the water
  ops.push(['taper', 0.5, 0.07, 0.3, 0.07, 0.42, -0.35, 0.16, -0.35, SHELL, { shift: [0.15, 0.08] }]);
  ops.push(['taper', 0.46, 0.07, 0.26, 0.07, 0.38, 0.15, 0.16, -0.3, SHELL, { shift: [0.12, -0.06] }]);
  ops.push(['taper', 0.4, 0.07, 0.2, 0.07, 0.3, -0.15, 0.16, -0.05, SHELL, { shift: [0.1, 0.05] }]);
  ops.push(['taper', 0.3, 0.07, 0.16, 0.07, 0.22, 0.25, 0.16, 0.0, SHELL, { shift: [0.08, 0.03] }]);
  ops.push(['taper', 0.2, 0.07, 0.12, 0.07, 0.16, 0.42, 0.16, 0.12, SHELL, { shift: [0.05, 0.02] }]);
  // the lamps of the promenade
  ops.push(...lampPost(-0.72, -0.78, 0.3, 'marquee', 0.02), ...lampPost(0.72, -0.78, 0.3, 'marquee', 0.02));
  return ops;
};

export const operaHouse: KindDef = {
  id: 'sydney-opera-house', name: 'the Opera House', code: 12, kindId: 188, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue', landmark: true, tags: TAGS, group: 'sydney',
  occupation: { ...theatre.occupation!, name: 'opera house staff' },
  attrs: {
    ...theatre.attrs, visitorCapacity: 210, ticket: 28, openHours: [12, 23], stay: [2, 3], leisureValue: 10, radius: 32,
    eventNights: [2, 4, 5, 6], eventStart: 19.5, eveningAppeal: 1.5, retireeAppeal: 1.6, childAppeal: 1.6, title: 'the Opera House',
  },
  lot: { wage: 20 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'Utzon\'s sails on Bennelong Point, the young architect\'s shells that became the harbour itself: the grand podium on the water, the white sails rising highest at the back, the ferries passing below.',
  howTo: 'A 2×2 plot at the water\'s edge, open to the harbour; a night-time venue that fills on show nights, so give it ferries or buses and restaurants near. World landmark: unlock rule to be decided.',
  tool: { id: 'operahouse', key: '', label: 'Opera House', color: '#f4f2ec' },
  levels: [{
    capacity: 40, wage: 20, cost: 15000, upkeep: 100, work: 3000, parking: { surface: 0, underground: 30 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the white sails over the harbour on their grand podium', height: 0.6, ops: operaHouseOps() },
    ],
  }],
};

// ================================================================= 189 the Harbour Bridge

/**
 * The coathanger over the harbour, drawn along z with the door at the south end: the deck
 * between the granite pylons, the great parabolic arch in seven bars above it, and the
 * hangers dropping the deck to the curve. Plain steel and granite only, so no window
 * rule is touched.
 */
const STEEL = 0x8a8f96, GRANITE = 0xb8ab90;

const harbourBridgeOps = (): Op[] => {
  const ops: Op[] = [];
  // a sloping bar from (z0, y0) to (z1, y1) at x
  const bar = (x: number, z0: number, y0: number, z1: number, y1: number, t: number, c: Color): Op => {
    if (Math.abs(y1 - y0) < 0.04) return ['box', t, t, Math.abs(z1 - z0), x, Math.min(y0, y1), (z0 + z1) / 2, c];
    const [zl, yl, zh, yh] = y0 < y1 ? [z0, y0, z1, y1] : [z1, y1, z0, y0];
    return ['taper', t, t, t, t, yh - yl, x, yl, zl, c, { shift: [0, zh - zl] }];
  };
  // the deck and its promenade rails
  ops.push(['box', 0.5, 0.04, 3.9, 0, 0.22, 0, ASPHALT]);
  ops.push(['box', 0.54, 0.03, 3.9, 0, 0.26, 0, STEEL]);
  // the four granite pylons at the arch ends
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ops.push(['box', 0.14, 0.52, 0.14, sx * 0.28, 0.02, sz * 1.1, GRANITE]);
    ops.push(['box', 0.18, 0.05, 0.18, sx * 0.28, 0.54, sz * 1.1, GRANITE]);
  }
  // the great arch in seven bars, and the hangers dropping the deck to the curve
  const rise = (z: number) => 0.27 + 0.5 * (1 - (z / 1.15) ** 2);
  const pts = [-1.1, -0.75, -0.4, 0, 0.4, 0.75, 1.1];
  for (let i = 0; i < pts.length - 1; i++) {
    ops.push(bar(-0.18, pts[i], rise(pts[i]), pts[i + 1], rise(pts[i + 1]), 0.045, STEEL));
    ops.push(bar(0.18, pts[i], rise(pts[i]), pts[i + 1], rise(pts[i + 1]), 0.045, STEEL));
  }
  for (const z of [-0.9, -0.55, -0.2, 0.2, 0.55, 0.9]) {
    ops.push(['box', 0.36, rise(z) - 0.27, 0.014, 0, 0.28, z, STEEL]);
  }
  // the lamps at the ends
  ops.push(...lampPost(-0.2, 1.85, 0.3, 'marquee', 0.02), ...lampPost(0.2, 1.85, 0.3, 'marquee', 0.02));
  return ops;
};

export const harbourBridge: KindDef = {
  id: 'harbour-bridge', name: 'the Harbour Bridge', code: library.code, kindId: 189, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'sydney',
  occupation: { ...library.occupation!, name: 'bridge walk guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 100, ticket: 14, openHours: [9, 19], stay: [0.8, 1.6], leisureValue: 8, radius: 26,
    dayAppeal: 1.5, eveningAppeal: 0.5, retireeAppeal: 1.5, childAppeal: 1.5, title: 'the Harbour Bridge',
  },
  lot: { wage: 16 },
  footprint: { w: 1, h: 4, door: [0, 3] },
  blurb: 'The coathanger over the harbour, the arch the climbers pay to scale at dawn: the deck between the granite pylons, the great curve of steel, and the harbour shining through the hangers.',
  howTo: 'Placed with its tool it is a 1×4 landmark on dry land, its door at one end; in a real city it would span the water it crosses. World landmark: unlock rule to be decided.',
  tool: { id: 'harbourbridge', key: '', label: 'Harbour Bridge', color: '#8a8f96' },
  levels: [{
    capacity: 22, wage: 16, cost: 13000, upkeep: 60, work: 3000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the great arch in its granite pylons over the harbour crossing', height: 0.81, ops: harbourBridgeOps() },
    ],
  }],
};

// ================================================================= 190 Sydney Tower

/**
 * The tallest watchtower of the southern sky, rising from the shopping centre in the middle
 * of the city: the podium block below, the slender shaft climbing out of it, the golden
 * turret of the observation deck, and the spire with its aircraft light over all. Plain
 * concrete and gold only, so no window rule is touched.
 */
const sydneyTowerOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the shopping centre podium below
  ops.push(['box', 0.8, 0.25, 0.8, 0, 0.02, 0, PODIUM]);
  // the slender shaft out of the podium
  ops.push(['taper', 0.1, 0.1, 0.06, 0.06, 1.05, 0, 0.27, 0, STEEL]);
  // the golden turret of the observation deck
  ops.push(['cyl', 0.16, 0.17, 0.13, 0, 1.32, 0, 'gold', 12]);
  ops.push(['cyl', 0.17, 0.17, 0.03, 0, 1.45, 0, STEEL, 12]);
  // the spire and its aircraft light
  ops.push(['cyl', 0.012, 0.018, 0.3, 0, 1.48, 0, 'steel', 6]);
  ops.push(['cyl', 0.03, 0.03, 0.05, 0, 1.78, 0, 'red', 6]);
  // the plaza: lamps and a pair of trees
  ops.push(...lampPost(-0.55, 0.55, 0.3, 'marquee', 0.02), ...lampPost(0.55, 0.55, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.72, -0.72, 0.55), ...tree(0.72, -0.72, 0.55));
  return ops;
};

export const sydneyTower: KindDef = {
  id: 'sydney-tower', name: 'Sydney Tower', code: library.code, kindId: 190, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'sydney',
  occupation: { ...library.occupation!, name: 'lookout host' },
  attrs: {
    ...library.attrs, visitorCapacity: 110, ticket: 20, openHours: [10, 21], stay: [0.8, 1.4], leisureValue: 8, radius: 26,
    dayAppeal: 1.4, eveningAppeal: 0.9, retireeAppeal: 1.5, childAppeal: 1.7, title: 'Sydney Tower',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The golden turret over the shopping centre in the middle of the city: the slender shaft, the observation deck three hundred metres up, and the harbour and the bridge in one glance.',
  howTo: 'A 2×2 plot in the retail heart; a day-and-night lookout that draws the young, best with a station under it. World landmark: unlock rule to be decided.',
  tool: { id: 'sydneytower', key: '', label: 'Sydney Tower', color: '#d8a83c' },
  levels: [{
    capacity: 26, wage: 16, cost: 12000, upkeep: 60, work: 2800, parking: { surface: 0, underground: 40 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the golden turret on its slender shaft over the shopping centre', height: 1.83, ops: sydneyTowerOps() },
    ],
  }],
};

// ================================================================= 191 St Mary's Cathedral

/**
 * The sandstone cathedral across the square from the cathedral's own green: the long nave
 * under its pitched roof, the rounded apse behind, the twin towers at the front, and above
 * them the two tall spires that were only finished in our century. Plain sandstone and
 * dark insets only, so no window rule is touched.
 */
const SANDSTONE = 0xcfc0a0, SANDSTONE_DK = 0xbcac8a;

const stMarysOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the nave, its roof, and the rounded apse
  ops.push(['box', 0.9, 0.42, 1.3, 0, 0.02, -0.1, SANDSTONE]);
  ops.push(['roof', 0.94, 0.14, 1.34, 0, 0.44, -0.1, 'slate', true]);
  ops.push(['cyl', 0.28, 0.3, 0.34, 0, 0.02, -0.7, SANDSTONE, 12]);
  // the front, the rose window, the twin towers with their tall spires
  ops.push(['box', 0.16, 0.16, 0.02, 0, 0.28, 0.56, 'navy']);
  ops.push(['box', 0.12, 0.2, 0.015, 0, 0.02, 0.56, 0x3a3630]);
  ops.push(['box', 0.26, 0.42, 0.26, -0.29, 0.02, 0.5, SANDSTONE_DK], ['box', 0.26, 0.42, 0.26, 0.29, 0.02, 0.5, SANDSTONE_DK]);
  ops.push(['taper', 0.16, 0.16, 0.03, 0.03, 0.5, -0.29, 0.44, 0.5, SANDSTONE]);
  ops.push(['taper', 0.16, 0.16, 0.03, 0.03, 0.5, 0.29, 0.44, 0.5, SANDSTONE]);
  ops.push(['cyl', 0.008, 0.008, 0.06, -0.29, 0.94, 0.5, 'gold', 5], ['cyl', 0.008, 0.008, 0.06, 0.29, 0.94, 0.5, 'gold', 5]);
  // the buttresses along the flanks and the lamps of the square
  for (const z of [0.2, -0.4]) {
    ops.push(['box', 0.08, 0.3, 0.08, -0.5, 0.02, z, SANDSTONE_DK], ['box', 0.08, 0.3, 0.08, 0.5, 0.02, z, SANDSTONE_DK]);
  }
  ops.push(...lampPost(-0.55, 0.82, 0.3, 'marquee', 0.02), ...lampPost(0.55, 0.82, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.78, -0.82, 0.55), ...tree(0.78, -0.82, 0.55));
  return ops;
};

export const stMarys: KindDef = {
  id: 'st-marys-cathedral', name: 'St Mary\'s Cathedral', code: library.code, kindId: 191, family: 'leisure', tier: 4,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'sydney',
  occupation: { ...library.occupation!, name: 'verger' },
  attrs: {
    ...library.attrs, visitorCapacity: 80, ticket: 0, openHours: [8, 19], stay: [0.4, 0.9], leisureValue: 6, radius: 20,
    dayAppeal: 1.2, eveningAppeal: 0.3, retireeAppeal: 1.8, childAppeal: 1.0, title: 'St Mary\'s Cathedral',
  },
  lot: { wage: 14 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The sandstone cathedral across the square from the green: the long nave, the rose window, and the twin spires that watched the city for a hundred years before they were finished.',
  howTo: 'A 2×2 plot facing a park or square; a short free visit that adds quiet to the civic heart. World landmark: unlock rule to be decided.',
  tool: { id: 'stmarys', key: '', label: 'St Mary\'s', color: '#cfc0a0' },
  levels: [{
    capacity: 14, wage: 14, cost: 8000, upkeep: 35, work: 1600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the sandstone cathedral with its twin spires over the square', height: 1.0, ops: stMarysOps() },
    ],
  }],
};

export const SYDNEY_LANDMARKS: KindDef[] = [operaHouse, harbourBridge, sydneyTower, stMarys];
