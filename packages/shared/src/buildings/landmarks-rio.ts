import type { KindDef, Op } from './schema';
import { library, theatre } from './leisure';
import { slab, tree, lampPost, PAVING, ASPHALT } from './tierkit';

/**
 * Rio de Janeiro landmarks (docs/buildings.md "Landmarks"): the monuments of the marvell-
 * ous city between the mountains and the sea, tagged 'world' and 'rio', rungs of the 'rio'
 * collection (groups.ts), tiers 1-5, their tools unlocked only by the locked tech node
 * 'wld1' (tech.ts) like the other world cities. Kind ids 183-187 (see landmarks-world.ts
 * for the world allocation). Scale: about 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   183 Christ the Redeemer: a library-family daytime attraction, the soapstone Christ
 *       with his outstretched arms on the peak of Corcovado
 *   184 Sugarloaf Mountain: a library-family attraction, the granite dome from the sea,
 *       the cable car climbing to its station on the summit
 *   185 the Metropolitan Cathedral: a library-family attraction, the great cone of the
 *       crown of thorns with its ring of concrete ribs
 *   186 the Maracana: a library-family sports venue, the great bowl with its green pitch
 *       and floodlight towers
 *   187 the Sambadrome: a theatre-family carnival venue, the parade avenue between the
 *       coloured grandstands to the square of the apotheosis
 */

const TAGS = ['world', 'rio'];

// ================================================================= 183 Christ the Redeemer

/**
 * The soapstone Christ on the peak of Corcovado, arms open over the city and the bay:
 * the jungle mountain turned as one lathe, and on its summit the figure, his outstretched
 * arms a single bar across the shoulders. Plain stone and jungle green only, so no window
 * rule is touched.
 */
const JUNGLE = 0x3f7a45, SOAPSTONE = 0xcfd4d8;

const christOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the peak of Corcovado under its jungle
  ops.push(['lathe', 0, 0.02, 0, JUNGLE, [1.0, 0, 0.8, 0.2, 0.55, 0.4, 0.35, 0.6, 0.22, 0.72, 0, 0.78], { seg: 20 }]);
  // the soapstone Christ: the figure and his outstretched arms
  ops.push(['lathe', 0, 0.8, 0, SOAPSTONE, [0.05, 0, 0.06, 0.05, 0.05, 0.15, 0.045, 0.22, 0.03, 0.26, 0, 0.28], { seg: 10 }]);
  ops.push(['box', 0.62, 0.045, 0.05, 0, 0.98, 0, SOAPSTONE]);
  // the little chapel platform at his feet and the lamps of the lookout
  ops.push(['box', 0.3, 0.03, 0.3, 0, 0.78, 0.18, 'stone']);
  ops.push(...lampPost(-0.3, 0.62, 0.28, 'marquee', 0.02), ...lampPost(0.3, 0.62, 0.28, 'marquee', 0.02));
  return ops;
};

const christOpsK31 = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  ops.push(['lathe', 0, 0.02, 0, JUNGLE, [0.96, 0, 0.86, 0.08, 0.58, 0.2, 0.4, 0.29, 0.32, 0.35], { seg: 24 }]);
  ops.push(['cyl', 0.39, 0.39, 0.045, 0, 0.37, 0, PAVING, 24]);
  ops.push(['taper', 0.34, 0.34, 0.26, 0.26, 0.17, 0, 0.415, 0, 'stone']);
  ops.push(['box', 0.3, 0.035, 0.3, 0, 0.585, 0, SOAPSTONE]);
  ops.push(['lathe', 0, 0.62, 0, SOAPSTONE, [0.16, 0, 0.17, 0.04, 0.135, 0.24, 0.105, 0.43, 0.14, 0.5, 0.1, 0.54, 0, 0.55], { seg: 20 }]);
  for (const x of [-0.09, -0.045, 0, 0.045, 0.09]) ops.push(['taper', 0.015, 0.018, 0.009, 0.012, 0.35, x, 0.65, 0.135, 'white']);
  ops.push(['cyl', 0.055, 0.06, 0.08, 0, 1.15, 0, SOAPSTONE, 12]);
  ops.push(['lathe', 0, 1.23, 0, SOAPSTONE, [0.055, 0, 0.078, 0.04, 0.075, 0.11, 0.045, 0.16, 0, 0.18], { seg: 16 }]);
  ops.push(['box', 0.36, 0.13, 0.15, 0, 1.04, 0, SOAPSTONE]);
  for (const sx of [-1, 1]) {
    ops.push(['taper', 0.2, 0.15, 0.3, 0.1, 0.1, sx * 0.2, 1.055, 0, SOAPSTONE, { shift: [sx * 0.08, 0] }]);
    ops.push(['box', 0.34, 0.065, 0.09, sx * 0.43, 1.075, 0, SOAPSTONE]);
    ops.push(['box', 0.09, 0.045, 0.105, sx * 0.645, 1.085, 0, SOAPSTONE]);
  }
  for (let i = 0; i < 5; i++) ops.push(['box', 0.22, 0.025, 0.09, 0, 0.31 - i * 0.055, 0.38 + i * 0.09, 'stone']);
  ops.push(...tree(-0.78, 0.7, 0.5), ...tree(0.78, 0.7, 0.5), ...tree(-0.8, -0.65, 0.45));
  return ops;
};

export const christRedeemer: KindDef = {
  id: 'christ-the-redeemer', name: 'Christ the Redeemer', code: library.code, kindId: 183, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rio',
  occupation: { ...library.occupation!, name: 'sanctuary keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 160, ticket: 12, openHours: [8, 19], stay: [0.8, 1.6], leisureValue: 9, radius: 34,
    dayAppeal: 1.7, eveningAppeal: 0.4, retireeAppeal: 2.0, childAppeal: 1.5, title: 'Christ the Redeemer',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The soapstone Christ on the peak of Corcovado, thirty metres of open arms over the city and the bay: the jungle mountain, the lookout at his feet, and the figure himself against the sky.',
  howTo: 'A 2×2 plot high over the city, lawns below; a day out with a view that draws everyone, so give it a bus route. World landmark: unlock rule to be decided.',
  tool: { id: 'christredeemer', key: '', label: 'Christ the Redeemer', color: '#cfd4d8' },
  levels: [{
    capacity: 36, wage: 16, cost: 14000, upkeep: 60, work: 3000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'k3.1-pro', draft: true, name: 'a monumental robed figure with wide sleeves and open hands above the Corcovado lookout', height: 1.41, ops: christOpsK31() },
      { author: 'kimi-2.8-preview', name: 'the soapstone Christ with his outstretched arms on the peak of Corcovado', height: 1.08, ops: christOps() },
    ],
  }],
};

// ================================================================= 184 Sugarloaf Mountain

/**
 * The sugarloaf of granite rising sheer from the sea at the mouth of the bay: the dome
 * turned as one lathe from the water, the beach at its foot, and the cable car climbing
 * from its station on the shore to the little station on the summit, the cabin midway.
 * Plain stone and water only, so no window rule is touched.
 */
const GRANITE = 0x8a8f96;

const sugarloafOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the sea round the foot and the beach strip
  ops.push(['cyl', 0.85, 0.9, 0.015, 0, 0.02, 0, 'pond', 24]);
  ops.push(['box', 1.7, 0.012, 0.26, 0, 0.02, 0.82, 'sand']);
  // the dome of granite
  ops.push(['lathe', 0, 0.02, 0, GRANITE, [0.75, 0, 0.78, 0.08, 0.72, 0.2, 0.6, 0.32, 0.42, 0.42, 0.2, 0.5, 0, 0.54], { seg: 20 }]);
  // the cable car: shore station, the two cables, the cabin midway, the summit station
  ops.push(['box', 0.16, 0.1, 0.14, 0, 0.03, 0.68, 'stone']);
  ops.push(['taper', 0.012, 0.012, 0.012, 0.012, 0.44, 0, 0.12, 0.6, 'dark', { shift: [0, -0.46] }]);
  ops.push(['taper', 0.012, 0.012, 0.012, 0.012, 0.44, 0.05, 0.12, 0.6, 'dark', { shift: [-0.05, -0.46] }]);
  ops.push(['box', 0.07, 0.06, 0.07, 0.02, 0.34, 0.36, 'red']);
  ops.push(['box', 0.14, 0.08, 0.14, 0, 0.56, 0.02, 'stone']);
  // the palms of the shore
  ops.push(...tree(-0.68, 0.7, 0.55, 'green'), ...tree(0.68, 0.7, 0.55, 'green'));
  return ops;
};

export const sugarloaf: KindDef = {
  id: 'sugarloaf', name: 'Sugarloaf Mountain', code: library.code, kindId: 184, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rio',
  occupation: { ...library.occupation!, name: 'cable car operator' },
  attrs: {
    ...library.attrs, visitorCapacity: 130, ticket: 20, openHours: [8.5, 20], stay: [1.0, 1.8], leisureValue: 8, radius: 28,
    dayAppeal: 1.6, eveningAppeal: 0.6, retireeAppeal: 1.6, childAppeal: 1.7, title: 'Sugarloaf Mountain',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The sugarloaf of granite rising sheer from the sea at the mouth of the bay: the cable car climbing to the little station on the summit, the beach and the palms below.',
  howTo: 'A 2×2 plot by the water; a ride and a view that fills all afternoon, so give it a bus route. World landmark: unlock rule to be decided.',
  tool: { id: 'sugarloaf', key: '', label: 'Sugarloaf', color: '#8a8f96' },
  levels: [{
    capacity: 30, wage: 16, cost: 13000, upkeep: 60, work: 3000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the granite dome from the sea, the cable car climbing to its station on the summit', height: 0.64, ops: sugarloafOps() },
    ],
  }],
};

// ================================================================= 185 the Metropolitan Cathedral

/**
 * The crown of thorns the archbishop built in the new centre: the dark glass cone of the
 * nave rising between the ring of concrete ribs, the cross over the skylight at its top.
 * Plain concrete, glass and dark insets only, so no window rule is touched.
 */
const CONCRETE = 0xb8b4ac, CATH_GLASS = 0x3a4a52;

const cathedralOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the dark glass cone of the nave
  ops.push(['cone', 0.5, 0.5, 0, 0.02, 0, CATH_GLASS, 16]);
  ops.push(['cyl', 0.1, 0.12, 0.04, 0, 0.52, 0, CONCRETE, 10]);
  ops.push(['box', 0.03, 0.12, 0.03, 0, 0.56, 0, CONCRETE]);
  // the ring of concrete ribs round it, with the doors between
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rx = Math.cos(a) * 0.56, rz = Math.sin(a) * 0.56;
    ops.push(['box', 0.06, 0.3, 0.06, rx, 0.02, rz, CONCRETE]);
  }
  ops.push(['box', 0.14, 0.2, 0.03, 0, 0.02, 0.58, 0x2b3630], ['box', 0.14, 0.2, 0.03, 0, 0.02, -0.58, 0x2b3630]);
  // the lamps of the square
  ops.push(...lampPost(-0.62, 0.62, 0.3, 'marquee', 0.02), ...lampPost(0.62, 0.62, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.75, -0.72, 0.55), ...tree(0.75, -0.72, 0.55));
  return ops;
};

export const rioCathedral: KindDef = {
  id: 'rio-cathedral', name: 'the Metropolitan Cathedral', code: library.code, kindId: 185, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rio',
  occupation: { ...library.occupation!, name: 'verger' },
  attrs: {
    ...library.attrs, visitorCapacity: 70, ticket: 0, openHours: [8, 18], stay: [0.3, 0.8], leisureValue: 6, radius: 18,
    dayAppeal: 1.1, eveningAppeal: 0.3, retireeAppeal: 1.6, childAppeal: 0.9, title: 'the Metropolitan Cathedral',
  },
  lot: { wage: 14 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The crown of thorns the archbishop built in the new centre: the dark glass cone of the nave between its ring of concrete ribs, four thousand souls under the skylight at Mass.',
  howTo: 'A 2×2 plot in the middle of the modern city among offices; a short free visit that adds quiet to a busy district. World landmark: unlock rule to be decided.',
  tool: { id: 'riocathedral', key: '', label: 'Rio Cathedral', color: '#b8b4ac' },
  levels: [{
    capacity: 12, wage: 14, cost: 7000, upkeep: 30, work: 1400, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the great cone of the crown of thorns with its ring of concrete ribs', height: 0.68, ops: cathedralOps() },
    ],
  }],
};

// ================================================================= 186 the Maracana

/**
 * The house of football where two hundred thousand once roared: the great bowl turned as
 * one lathe, the green pitch on the flat top, and the four floodlight towers at the
 * corners. Plain concrete only, so no window rule is touched.
 */
const BOWL = 0xc9c2b4, PITCH = 0x4a8a4a;

const maracanaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the bowl of the stands
  ops.push(['lathe', 0, 0.02, 0, BOWL, [0.88, 0, 0.88, 0.16, 0.82, 0.16, 0.82, 0.26, 0.6, 0.26, 0.6, 0.28, 0, 0.28], { seg: 24 }]);
  // the green pitch on the flat top, with the rim of the upper tier showing round it
  ops.push(['cyl', 0.55, 0.57, 0.015, 0, 0.3, 0, PITCH, 20]);
  // the four floodlight towers at the corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ops.push(['taper', 0.04, 0.04, 0.03, 0.03, 0.34, sx * 0.8, 0.02, sz * 0.8, 'dark', { shift: [-sx * 0.06, -sz * 0.06] }]);
    ops.push(['box', 0.1, 0.06, 0.04, sx * 0.74, 0.36, sz * 0.74, 'marquee']);
  }
  // the plaza: lamps and a pair of palms
  ops.push(...lampPost(-0.6, 0.92, 0.3, 'marquee', 0.02), ...lampPost(0.6, 0.92, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.78, 0.7, 0.5, 'green'), ...tree(0.78, 0.7, 0.5, 'green'));
  return ops;
};

export const maracana: KindDef = {
  id: 'maracana', name: 'the Maracana', code: library.code, kindId: 186, family: 'leisure', tier: 4,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rio',
  occupation: { ...library.occupation!, name: 'stadium steward' },
  attrs: {
    ...library.attrs, visitorCapacity: 300, ticket: 22, openHours: [10, 22], stay: [1.6, 2.6], leisureValue: 9, radius: 30,
    dayAppeal: 1.4, eveningAppeal: 0.9, retireeAppeal: 1.2, childAppeal: 2.0, title: 'the Maracana',
  },
  lot: { wage: 17 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The house of football where two hundred thousand once roared at the World Cup final: the great bowl, the green pitch, the floodlight towers, and the noise that never quite dies.',
  howTo: 'A 2×2 plot near transit; it fills on match nights and pays for itself, so give it a metro or buses and leave the streets clear after the whistle. World landmark: unlock rule to be decided.',
  tool: { id: 'maracana', key: '', label: 'Maracana', color: '#4a8a4a' },
  levels: [{
    capacity: 60, wage: 17, cost: 17000, upkeep: 80, work: 3800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the great bowl with its green pitch and floodlight towers', height: 0.44, ops: maracanaOps() },
    ],
  }],
};

// ================================================================= 187 the Sambadrome

/**
 * The avenue Oscar Niemeyer built for the carnival: the parade street running the length
 * of the plot, the grandstands in their carnival colours on both sides, and at the far
 * end the square of the apotheosis with its little arch. The schools dance here one night
 * a year; the rest of the year it is the city strangest empty street.
 */
const CARNAVAL = [0xc9372c, 0xe8c53c, 0x2c5f9e, 0x3f9e4d];

const sambadromeOps = (): Op[] => {
  const ops: Op[] = [slab(1, 4, ASPHALT)];
  // the parade avenue
  ops.push(['box', 0.34, 0.006, 3.9, 0, 0.02, 0, ASPHALT]);
  // the grandstands in their carnival colours, four to a side
  for (let i = 0; i < 4; i++) {
    const z = -1.5 + i;
    ops.push(['box', 0.28, 0.14, 0.95, -0.31, 0.02, z, CARNAVAL[i]]);
    ops.push(['box', 0.28, 0.14, 0.95, 0.31, 0.02, z, CARNAVAL[(i + 2) % 4]]);
  }
  // the square of the apotheosis at the far end, with its arch
  ops.push(['box', 0.9, 0.16, 0.4, 0, 0.02, -1.75, 0xc9372c]);
  ops.push(['box', 0.06, 0.2, 0.06, -0.18, 0.18, -1.75, 'marquee'], ['box', 0.06, 0.2, 0.06, 0.18, 0.18, -1.75, 'marquee']);
  ops.push(['box', 0.44, 0.06, 0.08, 0, 0.38, -1.75, 'marquee']);
  // the entrance lamps
  ops.push(...lampPost(-0.35, 1.85, 0.3, 'marquee', 0.02), ...lampPost(0.35, 1.85, 0.3, 'marquee', 0.02));
  return ops;
};

export const sambadrome: KindDef = {
  id: 'sambadrome', name: 'the Sambadrome', code: 12, kindId: 187, family: 'leisure', tier: 5,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue', landmark: true, tags: TAGS, group: 'rio',
  occupation: { ...theatre.occupation!, name: 'carnival steward' },
  attrs: {
    ...theatre.attrs, visitorCapacity: 260, ticket: 28, openHours: [18, 24], stay: [2.5, 3.5], leisureValue: 10, radius: 30,
    eventNights: [5, 6], eventStart: 20, eveningAppeal: 1.8, retireeAppeal: 0.8, childAppeal: 1.8, title: 'the Sambadrome',
  },
  lot: { wage: 18 },
  footprint: { w: 1, h: 4, door: [0, 3] },
  blurb: 'The avenue Oscar Niemeyer built for the carnival: the parade street between the coloured grandstands, and at the far end the square of the apotheosis where the schools of samba make their last turn.',
  howTo: 'Placed with its tool it is a 1×4 landmark on dry land, its door at one end; it fills on carnival nights, so give it a metro and leave the avenue clear for the parade. World landmark: unlock rule to be decided.',
  tool: { id: 'sambadrome', key: '', label: 'Sambadrome', color: '#e8c53c' },
  levels: [{
    capacity: 45, wage: 18, cost: 14000, upkeep: 90, work: 2800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the parade avenue between the coloured grandstands to the square of the apotheosis', height: 0.44, ops: sambadromeOps() },
    ],
  }],
};

export const RIO_LANDMARKS: KindDef[] = [christRedeemer, sugarloaf, rioCathedral, maracana, sambadrome];
