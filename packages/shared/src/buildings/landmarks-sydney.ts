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
 *   190-191 to follow, one building at a time.
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

export const SYDNEY_LANDMARKS: KindDef[] = [operaHouse, harbourBridge];
