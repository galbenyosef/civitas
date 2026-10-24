import type { KindDef, Op } from './schema';
import { library, theatre } from './leisure';
import { slab, tree, lampPost, flags, PAVING } from './tierkit';
import { haikuEiffelOps, haikuArcOps, haikuNotreDameOps, haikuLouvreOps, haikuOperaOps, haikuSacreCoeurOps } from './landmarks-paris-haiku';
import { sonnetEiffelOps, sonnetArcOps, sonnetNotreDameOps, sonnetLouvreOps, sonnetOperaOps, sonnetSacreCoeurOps } from './landmarks-paris-sonnet';
import { opusEiffelOps, opusArcOps, opusNotreDameOps, opusLouvreOps, opusOperaOps, opusSacreCoeurOps } from './landmarks-paris-opus';
import { fableEiffelOps, fableArcOps, fableNotreDameOps, fableLouvreOps, fableOperaOps, fableSacreCoeurOps } from './landmarks-paris-fable';

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
      { author: 'kimi-2.8-preview', name: 'the iron lace of four legs leaning together over the Champ de Mars, the two floors and the antenna above the city', height: 5.13, ops: eiffelOps() },
      { author: 'claude-haiku-5-5', draft: true, name: 'the iron tower on its stone plinth, the tapering legs rising to two galleries, the antenna with its red light', height: 4.95, ops: haikuEiffelOps() },
      { author: 'claude-sonnet-5-5', draft: true, name: 'the four-legged iron lattice with its girder belts, two galleries, the slender shaft and the red-lit antenna', height: 4.95, ops: sonnetEiffelOps() },
      { author: 'claude-opus-5-5', draft: true, name: 'the four splayed legs and their lattice belts, the two floors, the long shaft to the summit room and red-lit antenna', height: 5.02, ops: opusEiffelOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the legs bending in from four stone feet through the great arches to the first floor, the second stage, the needle in three shades of brown', height: 5.06, ops: fableEiffelOps() },
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
      { author: 'kimi-2.8-preview', name: 'the great arch on its roundabout, the vault over the unknown soldier, the friezes of the attic above', height: 1.66, ops: arcOps() },
      { author: 'claude-haiku-5-5', draft: true, name: 'the arch on its roundabout, two piers and the dark archway, the attic and stepped roof above', height: 1.34, ops: haikuArcOps() },
      { author: 'claude-sonnet-5-5', draft: true, name: 'the great arch on its roundabout, two sculpted piers around the dark vault, the friezed attic and stepped crown', height: 1.27, ops: sonnetArcOps() },
      { author: 'claude-opus-5-5', draft: true, name: 'the arch on the paved Étoile, two sculpted piers and the open vault, side arches, the attic and its cornices', height: 1.44, ops: opusArcOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the arch in its true proportions on the twelve-avenue star, the round-headed vault, the frieze, the attic and its shields', height: 1.5, ops: fableArcOps() },
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
      { author: 'kimi-2.8-preview', name: 'the twin-towered west front with the rose window, the lead spire over the crossing, the flying buttresses of the apse', height: 1.4, ops: notreDameOps() },
      { author: 'claude-haiku-5-5', draft: true, name: 'the nave under its slate roof, the west front with two towers and the rose window, the lead spire at the crossing', height: 1.25, ops: haikuNotreDameOps() },
      { author: 'claude-sonnet-5-5', draft: true, name: 'the high nave with aisles and flying buttresses, the flat-topped west towers and rose window, the lead flèche', height: 1.31, ops: sonnetNotreDameOps() },
      { author: 'claude-opus-5-5', draft: true, name: 'the cruciform nave and transept under lead, the round apse, flat-topped twin towers and rose, the flèche', height: 1.67, ops: opusNotreDameOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the whole plan in one piece: double aisles, the fan of flyers round the chevet, the round rose between flat-topped towers, the lead flèche', height: 1.5, ops: fableNotreDameOps() },
    ],
  }],
};

// ================================================================= 136 the Louvre

/**
 * The palace of the kings turned museum: three wings closing the Cour Napoleon, their
 * ground floors blank stone under the slate roofs, the great glass pyramid rising from
 * the court between the two round fountain basins. The pyramid is a four-segment cone;
 * the wings' windows sit on the upper storey only, with nothing stacked over them.
 */
const LSTONE = 0xd6cbb2, PYR = 0xbcd2c6;

const louvreOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the three wings of the court, ground floor plain, windows on the upper storey
  const wingF = { storeys: 2, bays: 3, sideBays: 6, margin: 0.05, ground: 'plain' as const, top: 0.05 };
  ops.push(['box', 0.44, 0.5, 1.05, -0.72, 0.02, 0.025, LSTONE, 'civic', { name: 'west', facade: wingF }]);
  ops.push(['box', 0.44, 0.5, 1.05, 0.72, 0.02, 0.025, LSTONE, 'civic', { name: 'east', facade: wingF }]);
  ops.push(['box', 1.0, 0.5, 0.4, 0, 0.02, -0.72, LSTONE, 'civic', { name: 'back', facade: { storeys: 2, bays: 6, sideBays: 2, margin: 0.05, ground: 'plain', top: 0.05 } }]);
  ops.push(['roof', 0.48, 0.12, 1.09, -0.72, 0.52, 0.025, 'slate', true], ['roof', 0.48, 0.12, 1.09, 0.72, 0.52, 0.025, 'slate', true]);
  ops.push(['roof', 1.04, 0.12, 0.44, 0, 0.52, -0.72, 'slate', false]);
  // the court: the glass pyramid between the two fountain basins
  ops.push(['cone', 0.42, 0.44, 0, 0.02, 0, PYR, 4]);
  ops.push(['cyl', 0.14, 0.15, 0.025, -0.3, 0.02, 0.28, 'pond', 14], ['cyl', 0.14, 0.15, 0.025, 0.3, 0.02, 0.28, 'pond', 14]);
  // the street front: lamps and a pair of trees
  ops.push(...lampPost(-0.4, 0.82, 0.32, 'marquee', 0.02), ...lampPost(0.4, 0.82, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.82, 0.82, 0.6), ...tree(0.82, 0.82, 0.6));
  return ops;
};

export const louvre: KindDef = {
  id: 'louvre', name: 'the Louvre', code: library.code, kindId: 136, family: 'leisure', tier: 4,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'paris',
  occupation: { ...library.occupation!, name: 'museum curator' },
  attrs: {
    ...library.attrs, visitorCapacity: 260, ticket: 26, openHours: [9, 21], stay: [1.4, 2.6], leisureValue: 9, radius: 32,
    dayAppeal: 1.7, eveningAppeal: 0.5, retireeAppeal: 1.8, childAppeal: 1.6, title: 'the Louvre',
  },
  lot: { wage: 19 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The palace of the kings turned museum: three wings closing the Cour Napoleon under their slate roofs, and the glass pyramid rising between the fountains to light the halls below.',
  howTo: 'A 2×2 plot open to the street, lawns suit it; the grandest museum in the city, drawing visitors all day, so give it a metro or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'louvre', key: '', label: 'the Louvre', color: '#d6cbb2' },
  levels: [{
    capacity: 60, wage: 19, cost: 20000, upkeep: 85, work: 4200, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the three wings of the Cour Napoleon under their slate roofs, the glass pyramid between the two fountains', height: 0.66, ops: louvreOps() },
      { author: 'claude-haiku-5-5', draft: true, name: 'three stone wings under slate roofs around the court, the glass pyramid and its fountain basins', height: 0.68, ops: haikuLouvreOps() },
      { author: 'claude-sonnet-5-5', draft: true, name: 'the mansard-roofed wings round the Cour Napoléon, the tall central pavilion, the glass pyramid and its satellites', height: 0.77, ops: sonnetLouvreOps() },
      { author: 'claude-opus-5-5', draft: true, name: 'the mansarded wings and corner pavilions round the court, the Pavillon de l\'Horloge, the pyramid and its sisters', height: 0.86, ops: opusLouvreOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'three pavilions a wing under steep slate roofs, the Horloge dome, the pyramid in its real ratio, the Carrousel arch at the open end', height: 0.9, ops: fableLouvreOps() },
    ],
  }],
};

// ================================================================= 137 the Opéra Garnier

/**
 * The opera house Charles Garnier built for Napoleon the Third: the columned front on the
 * street, its windows on the front wall only, the green copper dome over the grand staircase
 * at the corner, and the tall plain stage tower rising behind where the scenery flies. The
 * sides and back stay blank so the tower can stand against them, and the porch shades the
 * door on the plain ground floor.
 */
const OPERA = 0xd9c9a8, OPERA_DK = 0xc4b28e, VERDIGRIS = 0x5f8f6f;

const operaGarnierOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the auditorium front: windows on the street wall only, plain sides and back
  ops.push(['box', 1.4, 0.55, 0.75, 0, 0.02, 0.28, OPERA, true, { name: 'hall', facade: { storeys: 2, bays: 5, sideBays: 0, margin: 0.06, ground: 'plain', top: 0.05 } }]);
  ops.push(['roof', 1.44, 0.14, 0.79, 0, 0.57, 0.28, OPERA_DK, false]);
  // the columned porch over the door, the frieze and the attic cornice
  ops.push(['door', 'hall', 'front', 2], ['porch', 'hall', 'front', 1, 3, 'gold']);
  ops.push(...[-1, 1].map((sx): Op => ['cyl', 0.028, 0.032, 0.24, sx * 0.42, 0.02, 0.72, OPERA, 8]));
  ops.push(['box', 1.1, 0.045, 0.05, 0, 0.515, 0.7, 'gold']);
  // the green dome over the grand staircase at the corner
  ops.push(['cyl', 0.15, 0.16, 0.08, 0.42, 0.6, 0.42, OPERA, 10]);
  ops.push(['lathe', 0.42, 0.66, 0.42, VERDIGRIS, [0.16, 0, 0.17, 0.03, 0.15, 0.07, 0.1, 0.11, 0.045, 0.13, 0, 0.15], { seg: 12 }]);
  ops.push(['cyl', 0.008, 0.008, 0.06, 0.42, 0.81, 0.42, 'gold', 5]);
  // the stage tower behind, standing clear of the hall's back wall
  ops.push(['box', 1.2, 1.0, 0.6, 0, 0.02, -0.55, OPERA_DK]);
  ops.push(['box', 1.26, 0.05, 0.66, 0, 1.02, -0.55, OPERA]);
  // the square: lamps, flags and a pair of trees
  ops.push(...lampPost(-0.55, 0.88, 0.32, 'marquee', 0.02), ...lampPost(0.55, 0.88, 0.32, 'marquee', 0.02));
  ops.push(...flags(-0.4, 0.4, 3, 0.5, ['navy', 'white', 'red'], 0.4));
  ops.push(...tree(-0.82, -0.82, 0.6), ...tree(0.82, -0.82, 0.6));
  return ops;
};

export const operaGarnier: KindDef = {
  id: 'opera-garnier', name: 'the Opéra Garnier', code: 12, kindId: 137, family: 'leisure', tier: 5,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue', landmark: true, tags: TAGS, group: 'paris',
  occupation: { ...theatre.occupation!, name: 'opera house staff' },
  attrs: {
    ...theatre.attrs, visitorCapacity: 200, ticket: 30, openHours: [13, 24], stay: [2.2, 3.2], leisureValue: 10, radius: 30,
    eventNights: [2, 4, 5, 6], eventStart: 19.5, eveningAppeal: 1.5, retireeAppeal: 1.4, title: 'the Opéra Garnier',
  },
  lot: { wage: 20 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The opera house Charles Garnier built for Napoleon the Third: the columned front under the green copper dome, and behind it the great stage where the chandelier fell.',
  howTo: 'A 2×2 plot on a busy street near restaurants and bars for the pre-show crowd; it fills on show nights. World landmark: unlock rule to be decided.',
  tool: { id: 'operagarnier', key: '', label: 'Opéra Garnier', color: '#5f8f6f' },
  levels: [{
    capacity: 40, wage: 20, cost: 14000, upkeep: 100, work: 3000, parking: { surface: 0, underground: 30 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the columned opera house under its green dome, the stage tower rising behind', height: 1.1, ops: operaGarnierOps() },
      { author: 'claude-haiku-5-5', draft: true, name: 'the colonnaded opera front under its roof, the green dome at the corner, the stage house behind', height: 1.08, ops: haikuOperaOps() },
      { author: 'claude-sonnet-5-5', draft: true, name: 'the arcaded front between two gilded pavilions, the great green cupola and the stage house behind', height: 1.24, ops: sonnetOperaOps() },
      { author: 'claude-opus-5-5', draft: true, name: 'the loggia between domed end pavilions, the crowned copper dome, the gabled stage house with Apollo', height: 1.28, ops: opusOperaOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the arcaded loggia between the two rotundas, the low wide copper dome, the stone pediment of the stage house with Apollo', height: 1.29, ops: fableOperaOps() },
    ],
  }],
};

// ================================================================= 138 the Sacré-Cœur

/**
 * The white basilica on the hill of Montmartre, its travertine bright over the city: the
 * church on its high terrace above the front steps, the great white dome over the crossing
 * with its lantern, the square bell tower to one side, and the row of small domes along the
 * choir. Plain white stone and dark insets only, so no window rule is touched.
 */
const CHALK = 0xf2ede4, CHALK_DK = 0xe0d8c8;

const sacreCoeurOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the terrace of the hill and the steps down to the street
  ops.push(['box', 1.7, 0.16, 1.7, 0, 0.02, -0.1, 'stone']);
  ops.push(['box', 1.0, 0.05, 0.24, 0, 0.02, 0.86, 'stone'], ['box', 1.2, 0.05, 0.18, 0, 0.07, 0.76, 'stone'], ['box', 1.4, 0.05, 0.14, 0, 0.12, 0.68, 'stone']);
  // the basilica front: the portico arches and the gable
  ops.push(['box', 1.0, 0.42, 0.8, 0, 0.18, -0.15, CHALK]);
  ops.push(['box', 0.16, 0.26, 0.02, -0.24, 0.2, 0.26, 0x3a3630], ['box', 0.16, 0.26, 0.02, 0, 0.2, 0.26, 0x3a3630], ['box', 0.16, 0.26, 0.02, 0.24, 0.2, 0.26, 0x3a3630]);
  ops.push(['roof', 1.04, 0.12, 0.2, 0, 0.6, 0.2, CHALK_DK, false]);
  // the great dome on its drum over the crossing, the lantern and gold finial
  ops.push(['cyl', 0.2, 0.22, 0.1, 0, 0.6, -0.15, CHALK, 12]);
  ops.push(['lathe', 0, 0.68, -0.15, CHALK, [0.23, 0, 0.24, 0.05, 0.2, 0.14, 0.12, 0.24, 0.05, 0.3, 0, 0.34], { seg: 14 }]);
  ops.push(['cyl', 0.03, 0.035, 0.06, 0, 1.02, -0.15, CHALK, 8], ['cone', 0.02, 0.05, 0, 1.08, -0.15, 'gold', 6]);
  // the square bell tower with its own small dome
  ops.push(['box', 0.18, 0.5, 0.18, 0.42, 0.18, 0.1, CHALK]);
  ops.push(['box', 0.1, 0.16, 0.02, 0.42, 0.44, 0.2, 0x3a3630]);
  ops.push(['lathe', 0.42, 0.68, 0.1, CHALK, [0.11, 0, 0.12, 0.03, 0.09, 0.08, 0.04, 0.12, 0, 0.15], { seg: 10 }]);
  ops.push(['cyl', 0.006, 0.006, 0.05, 0.42, 0.83, 0.1, 'gold', 5]);
  // the row of small domes over the choir
  for (const dx of [-0.28, 0, 0.28]) {
    ops.push(['lathe', dx, 0.6, -0.48, CHALK, [0.09, 0, 0.1, 0.02, 0.07, 0.06, 0.03, 0.09, 0, 0.11], { seg: 8 }]);
  }
  // the hilltop square: lamps and a pair of trees
  ops.push(...lampPost(-0.5, 0.55, 0.3, 'marquee', 0.02), ...lampPost(0.5, 0.55, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.85, 0.85, 0.6), ...tree(0.85, 0.85, 0.6));
  return ops;
};

export const sacreCoeur: KindDef = {
  id: 'sacre-coeur', name: 'the Sacré-Cœur', code: library.code, kindId: 138, family: 'leisure', tier: 6,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'paris',
  occupation: { ...library.occupation!, name: 'sacristan' },
  attrs: {
    ...library.attrs, visitorCapacity: 130, ticket: 0, openHours: [8, 20], stay: [0.5, 1.2], leisureValue: 7, radius: 26,
    dayAppeal: 1.3, eveningAppeal: 0.5, retireeAppeal: 2.4, childAppeal: 1.2, title: 'Sacré-Cœur',
  },
  lot: { wage: 15 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The white basilica on the hill of Montmartre, its travertine bright over the rooftops: the great dome over the crossing, the bell tower, and the steps where the city lies below.',
  howTo: 'A 2×2 plot, lawns below the terrace; a quiet free visit for retirees and evening strollers, best with a metro nearby. World landmark: unlock rule to be decided.',
  tool: { id: 'sacrecoeur', key: '', label: 'Sacré-Cœur', color: '#f2ede4' },
  levels: [{
    capacity: 24, wage: 15, cost: 10000, upkeep: 45, work: 2200, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the white basilica on its terrace above the steps, the great dome and the bell tower over the city', height: 1.13, ops: sacreCoeurOps() },
      { author: 'claude-haiku-5-5', draft: true, name: 'the white basilica on its terrace over the steps, the great dome and the square bell tower', height: 1.27, ops: haikuSacreCoeurOps() },
      { author: 'claude-sonnet-5-5', draft: true, name: 'the white basilica on its terrace, the portico, the great ovoid dome with four lesser domes, the campanile', height: 1.37, ops: sonnetSacreCoeurOps() },
      { author: 'claude-opus-5-5', draft: true, name: 'the white basilica above its steps, the tall ovoid dome and lantern, four lesser domes, the campanile behind', height: 1.48, ops: opusSacreCoeurOps() },
      { author: 'claude-fable-5-1', draft: true, name: 'the ovoid domes over the grass embankment and its stair, the arcaded drum, the campanile as tall as the dome', height: 1.46, ops: fableSacreCoeurOps() },
    ],
  }],
};

export const PARIS_LANDMARKS: KindDef[] = [eiffelTower, arcDeTriomphe, notreDame, louvre, operaGarnier, sacreCoeur];
