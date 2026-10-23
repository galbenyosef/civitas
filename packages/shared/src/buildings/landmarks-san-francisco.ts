import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { office } from './office';
import { library } from './leisure';
import { slab, tree, lampPost, ASPHALT } from './tierkit';

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
 *   194-196 to follow, one building at a time.
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
      { author: 'kimi-2.8-preview', name: 'the orange towers and the great cables over the strait', height: 0.74, ops: goldenGateOps() },
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
    ],
  }],
};

export const SAN_FRANCISCO_LANDMARKS: KindDef[] = [goldenGate, transamerica];
