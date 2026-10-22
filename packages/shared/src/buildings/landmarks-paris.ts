import type { KindDef, Op } from './schema';
import { library } from './leisure';
import { slab, tree, lampPost, flags, PAVING } from './tierkit';

/**
 * Paris landmarks (docs/buildings.md "Landmarks"): the recognisable buildings of the ville
 * lumiere, tagged 'world' and 'paris', rungs of the 'paris' collection (groups.ts), tiers 1-8,
 * their tools unlocked only by the locked tech node 'wld1' (tech.ts) like the other world
 * cities. Kind ids 133-140 (see landmarks-world.ts for the world allocation). Scale: about
 * 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   133 the Eiffel Tower: a library-family attraction day and night, the iron lace of four
 *       legs leaning together, the two floors, the antenna with its aircraft light
 *   134 the Arc de Triomphe: a library-family daytime attraction, the great arch on its
 *       roundabout, the vault with the eternal flame, the friezes of the attic above
 *   135 Notre-Dame: a library-family attraction, the twin-towered west front, the spire
 *       over the crossing, the flying buttresses along the apse
 *   136-140 to follow, one building at a time.
 */

const TAGS = ['world', 'paris'];

// ================================================================= 133 the Eiffel Tower

/**
 * The 1889 iron lady of the Champ de Mars: four arched legs leaning together to the first
 * floor, the second stage narrower above it, then the single taper to the summit and the
 * antenna with its red aircraft light. Every part is a taper, cylinder or box, so no wall
 * can half-hide a window. Tricolour flags and lamps line the esplanade; the door is under
 * the arch between the south legs.
 */
const IRON = 0x6e5b48, IRON_LT = 0x7d6a55;

const eiffelOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the esplanade cross of gravel paths from the street to the tower
  ops.push(['box', 0.5, 0.004, 2.0, 0, 0.02, 0, 'gravel'], ['box', 2.0, 0.004, 0.5, 0, 0.02, 0, 'gravel']);
  // the four masonry feet and the leaning legs, each inset as it climbs
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ops.push(['box', 0.22, 0.1, 0.22, sx * 0.58, 0.02, sz * 0.58, 'stone']);
    ops.push(['taper', 0.15, 0.15, 0.1, 0.1, 1.33, sx * 0.58, 0.12, sz * 0.58, IRON, { shift: [-sx * 0.42, -sz * 0.42] }]);
  }
  // the lattice: girder rings between the legs at the two gallery heights
  ops.push(['box', 0.92, 0.035, 0.035, 0, 0.55, -0.46, IRON_LT], ['box', 0.92, 0.035, 0.035, 0, 0.55, 0.46, IRON_LT]);
  ops.push(['box', 0.035, 0.035, 0.92, -0.46, 0.55, 0, IRON_LT], ['box', 0.035, 0.035, 0.92, 0.46, 0.55, 0, IRON_LT]);
  ops.push(['box', 0.7, 0.03, 0.03, 0, 1.05, -0.35, IRON_LT], ['box', 0.7, 0.03, 0.03, 0, 1.05, 0.35, IRON_LT]);
  ops.push(['box', 0.03, 0.03, 0.7, -0.35, 1.05, 0, IRON_LT], ['box', 0.03, 0.03, 0.7, 0.35, 1.05, 0, IRON_LT]);
  // the first floor on its overhanging gallery, then the second stage of slimmer legs
  ops.push(['box', 0.98, 0.12, 0.98, 0, 1.45, 0, IRON_LT]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ops.push(['taper', 0.09, 0.09, 0.06, 0.06, 1.28, sx * 0.16, 1.57, sz * 0.16, IRON, { shift: [-sx * 0.06, -sz * 0.06] }]);
  }
  // the second floor with its overhang, the single taper of the upper shaft
  ops.push(['box', 0.56, 0.1, 0.56, 0, 2.85, 0, IRON_LT]);
  ops.push(['taper', 0.4, 0.4, 0.13, 0.13, 1.25, 0, 2.95, 0, IRON]);
  // the summit room and the antenna with its aircraft light
  ops.push(['cyl', 0.07, 0.08, 0.28, 0, 4.2, 0, IRON_LT, 10]);
  ops.push(['cyl', 0.015, 0.02, 0.6, 0, 4.48, 0, 'steel', 6]);
  ops.push(['cyl', 0.032, 0.032, 0.05, 0, 5.08, 0, 'red', 6]);
  // the esplanade dressing: lamps, tricolours and a pair of pollarded trees
  ops.push(...lampPost(-0.62, 0.88, 0.34, 'marquee', 0.02), ...lampPost(0.62, 0.88, 0.34, 'marquee', 0.02));
  ops.push(...flags(-0.5, 0.5, 3, 0.5, ['navy', 'white', 'red'], 0.5));
  ops.push(...tree(-0.82, -0.82, 0.6), ...tree(0.82, -0.82, 0.6));
  return ops;
};

export const eiffelTower: KindDef = {
  id: 'eiffel-tower', name: 'the Eiffel Tower', code: library.code, kindId: 133, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'paris',
  occupation: { ...library.occupation!, name: 'tower steward' },
  attrs: {
    ...library.attrs, visitorCapacity: 180, ticket: 22, openHours: [9, 23.5], stay: [1.0, 2.0], leisureValue: 9, radius: 34,
    dayAppeal: 1.6, eveningAppeal: 1.2, retireeAppeal: 2.0, childAppeal: 1.8, title: 'Eiffel Tower',
  },
  lot: { wage: 18 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The 1889 iron lady of the Champ de Mars: four arched legs leaning 312 metres into the sky, the two galleries with the whole of Paris below, and the sparking antenna over it all.',
  howTo: 'A 2×2 plot open to the street, lawns around. A day-and-night attraction that draws everyone in the city, so give it a metro or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'eiffeltower', key: '', label: 'Eiffel Tower', color: '#6e5b48' },
  levels: [{
    capacity: 45, wage: 18, cost: 16000, upkeep: 70, work: 3400, parking: { surface: 0, underground: 0 },
    designs: [
      { name: 'the iron lace of four legs leaning together over the Champ de Mars, the two floors and the antenna above the city', height: 5.13, ops: eiffelOps() },
    ],
  }],
};

// ================================================================= 134 the Arc de Triomphe

/**
 * Napoleon's arch at the top of the Champs-Elysees: two great piers carrying the vault, the
 * dark tunnel under it with the tricolour hung in the opening, and the high attic with its
 * friezes, cornice and stepped roof. All plain stone, so no window can be covered; the arch
 * reads from the model alone.
 */
const STONE = 0xcfc5ae, STONE_DK = 0xbdb29a;

const arcOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the roundabout ring around the arch
  ops.push(['cyl', 0.86, 0.9, 0.006, 0, 0.02, 0, 'gravel', 28]);
  // the two piers and the shadowed vault between them, the barrel reading as the arch
  ops.push(['box', 0.36, 0.95, 0.55, -0.42, 0.02, 0, STONE], ['box', 0.36, 0.95, 0.55, 0.42, 0.02, 0, STONE]);
  ops.push(['box', 0.48, 0.6, 0.42, 0, 0.02, 0, 0x2b2e36]);
  ops.push(['lathe', -0.24, 0.62, 0, 0x2b2e36, [0.21, 0, 0.21, 0.48], { axis: 'x', seg: 12 }]);
  // the tricolour hung in the opening under the vault
  ops.push(['box', 0.14, 0.09, 0.012, 0, 0.5, 0, 'navy'], ['box', 0.14, 0.06, 0.012, 0, 0.44, 0, 'white'], ['box', 0.14, 0.03, 0.012, 0, 0.41, 0, 'red']);
  // the attic with its friezes, the cornice and the stepped roof
  ops.push(['box', 1.2, 0.5, 0.55, 0, 0.97, 0, STONE]);
  ops.push(['box', 0.03, 0.34, 0.4, -0.61, 1.02, 0, STONE_DK], ['box', 0.03, 0.34, 0.4, 0.61, 1.02, 0, STONE_DK]);
  ops.push(['box', 0.44, 0.3, 0.03, -0.3, 1.04, 0.285, STONE_DK], ['box', 0.44, 0.3, 0.03, 0.3, 1.04, 0.285, STONE_DK]);
  ops.push(['box', 0.44, 0.3, 0.03, -0.3, 1.04, -0.285, STONE_DK], ['box', 0.44, 0.3, 0.03, 0.3, 1.04, -0.285, STONE_DK]);
  ops.push(['box', 1.26, 0.06, 0.61, 0, 1.47, 0, STONE_DK]);
  ops.push(['box', 1.1, 0.05, 0.46, 0, 1.53, 0, STONE]);
  ops.push(['box', 0.7, 0.08, 0.3, 0, 1.58, 0, STONE]);
  // the eternal flame at the vault's foot
  ops.push(['cyl', 0.03, 0.035, 0.02, 0, 0.02, 0.32, 'stone', 10]);
  ops.push(['cone', 0.02, 0.05, 0, 0.04, 0.32, 'marquee', 6]);
  // plane trees and lamps around the roundabout
  ops.push(...tree(-0.8, -0.8, 0.6), ...tree(0.8, -0.8, 0.6));
  ops.push(...lampPost(-0.55, 0.75, 0.32, 'marquee', 0.02), ...lampPost(0.55, 0.75, 0.32, 'marquee', 0.02));
  return ops;
};

export const arcDeTriomphe: KindDef = {
  id: 'arc-de-triomphe', name: 'the Arc de Triomphe', code: library.code, kindId: 134, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'paris',
  occupation: { ...library.occupation!, name: 'memorial keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 110, ticket: 14, openHours: [10, 19], stay: [0.6, 1.2], leisureValue: 7, radius: 26,
    dayAppeal: 1.4, eveningAppeal: 0.3, retireeAppeal: 2.4, childAppeal: 1.2, title: 'Arc de Triomphe',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'Napoleon\'s 50-metre arch at the top of the Champs-Elysees: the vault over the unknown soldier, his flame still lit, the friezes of the great attic above the roundabout.',
  howTo: 'A 2×2 plot open to the street; a daytime outing for retirees and school trips, best with a metro or buses nearby. World landmark: unlock rule to be decided.',
  tool: { id: 'arcdetriomphe', key: '', label: 'Arc de Triomphe', color: '#cfc5ae' },
  levels: [{
    capacity: 26, wage: 16, cost: 11000, upkeep: 55, work: 2800, parking: { surface: 0, underground: 0 },
    designs: [
      { name: 'the great arch on its roundabout, the vault over the unknown soldier, the friezes of the attic above', height: 1.66, ops: arcOps() },
    ],
  }],
};

// ================================================================= 135 Notre-Dame

/**
 * The cathedral of Paris on its island: the twin-towered west front with the rose window,
 * the long nave under its pitched roof, the apse rounded behind, and the lead spire rising
 * from the crossing with the flying buttresses stepping in from both flanks. All plain
 * limestone and lead, the lancets and doors inset dark, so no window rule is touched.
 */
const LIME_ST = 0xc9c0a8, LEAD = 0x5a6570;

const notreDameOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the nave, its pitched roof, and the rounded apse behind
  ops.push(['box', 1.04, 0.55, 1.3, 0, 0.02, -0.08, LIME_ST]);
  ops.push(['roof', 1.04, 0.18, 1.3, 0, 0.57, -0.08, 'slate', true]);
  ops.push(['cyl', 0.5, 0.54, 0.5, 0, 0.02, -0.46, LIME_ST, 14]);
  // the west front and the two square towers, the rose window between them
  ops.push(['box', 1.08, 0.52, 0.14, 0, 0.02, 0.62, LIME_ST]);
  ops.push(['box', 0.22, 0.22, 0.02, 0, 0.26, 0.7, 'navy']);
  ops.push(['box', 0.42, 0.85, 0.42, -0.33, 0.02, 0.55, LIME_ST], ['box', 0.42, 0.85, 0.42, 0.33, 0.02, 0.55, LIME_ST]);
  ops.push(['cone', 0.035, 0.12, -0.51, 0.87, 0.36, LIME_ST, 6], ['cone', 0.035, 0.12, -0.15, 0.87, 0.36, LIME_ST, 6]);
  ops.push(['cone', 0.035, 0.12, 0.15, 0.87, 0.36, LIME_ST, 6], ['cone', 0.035, 0.12, 0.51, 0.87, 0.36, LIME_ST, 6]);
  // the three west doors, the lancets of towers and nave flanks
  ops.push(['box', 0.13, 0.18, 0.015, 0, 0.02, 0.7, 0x3a3630], ['box', 0.08, 0.14, 0.015, -0.2, 0.02, 0.7, 0x3a3630], ['box', 0.08, 0.14, 0.015, 0.2, 0.02, 0.7, 0x3a3630]);
  ops.push(['box', 0.015, 0.3, 0.1, -0.545, 0.3, 0.55, 0x3a3630], ['box', 0.015, 0.3, 0.1, 0.545, 0.3, 0.55, 0x3a3630]);
  for (const z of [0.3, -0.1, -0.5]) {
    ops.push(['box', 0.015, 0.24, 0.14, -0.525, 0.14, z, 0x3a3630], ['box', 0.015, 0.24, 0.14, 0.525, 0.14, z, 0x3a3630]);
  }
  // the lead spire over the crossing, its little stage partway up
  ops.push(['lathe', 0, 0.57, -0.15, LEAD, [0.12, 0, 0.1, 0.08, 0.05, 0.3, 0.028, 0.55, 0.01, 0.72, 0, 0.78], { seg: 12 }]);
  ops.push(['cone', 0.012, 0.05, 0, 1.35, -0.15, 'gold', 5]);
  // the flying buttresses: outer piers and the bars stepping in to the nave top
  for (const sx of [-1, 1]) {
    for (const z of [0.3, -0.1, -0.5]) {
      ops.push(['box', 0.07, 0.4, 0.07, sx * 0.62, 0.02, z, LIME_ST]);
      ops.push(['taper', 0.05, 0.05, 0.03, 0.03, 0.3, sx * 0.58, 0.32, z, LIME_ST, { shift: [-sx * 0.08, 0] }]);
    }
  }
  // the parvis: lamps and a pair of trees
  ops.push(...lampPost(-0.5, 0.9, 0.32, 'marquee', 0.02), ...lampPost(0.5, 0.9, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.82, 0.86, 0.6), ...tree(0.82, 0.86, 0.6));
  return ops;
};

export const notreDame: KindDef = {
  id: 'notre-dame', name: 'Notre-Dame', code: library.code, kindId: 135, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'paris',
  occupation: { ...library.occupation!, name: 'verger' },
  attrs: {
    ...library.attrs, visitorCapacity: 150, ticket: 0, openHours: [8, 19.5], stay: [0.6, 1.4], leisureValue: 8, radius: 28,
    dayAppeal: 1.5, eveningAppeal: 0.4, retireeAppeal: 2.2, childAppeal: 1.3, title: 'Notre-Dame',
  },
  lot: { wage: 15 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The cathedral of Paris on its island: the twin west towers over the rose window, the lead spire flying from the crossing, buttresses stepping over the Seine-side apse.',
  howTo: 'A 2×2 plot by the water suits it; a quiet day out for retirees and school trips, no ticket needed. World landmark: unlock rule to be decided.',
  tool: { id: 'notredame', key: '', label: 'Notre-Dame', color: '#c9c0a8' },
  levels: [{
    capacity: 30, wage: 15, cost: 12000, upkeep: 50, work: 2600, parking: { surface: 0, underground: 0 },
    designs: [
      { name: 'the twin-towered west front with the rose window, the lead spire over the crossing, the flying buttresses of the apse', height: 1.4, ops: notreDameOps() },
    ],
  }],
};

export const PARIS_LANDMARKS: KindDef[] = [eiffelTower, arcDeTriomphe, notreDame];
