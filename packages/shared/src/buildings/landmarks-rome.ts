import type { KindDef, Op } from './schema';
import { library } from './leisure';
import { slab, tree, lampPost, PAVING } from './tierkit';

/**
 * Rome landmarks (docs/buildings.md "Landmarks"): the great buildings of the eternal city,
 * tagged 'world' and 'rome', rungs of the 'rome' collection (groups.ts), tiers 1-6, their
 * tools unlocked only by the locked tech node 'wld1' (tech.ts) like the other world cities.
 * Kind ids 141-146 (see landmarks-world.ts for the world allocation). Scale: about 33 m to
 * a tile, as for London.
 *
 * The set, in tier order:
 *   141 the Colosseum: a library-family daytime attraction, the amphitheatre of the
 *       emperors, the arena and the receding rings of arches
 *   142 St Peter's Basilica: a library-family attraction, the great church of the popes,
 *       the dome over the crossing, the colonnaded square with the obelisk
 *   143 the Pantheon: a library-family attraction, the columns and pediment before the
 *       great dome with its rings
 *   144 the Trevi Fountain: a library-family attraction day and night, the arch and
 *       Oceanus above the cascade into the great basin
 *   145 the Altare della Patria: a library-family daytime attraction, the white terraces
 *       and colonnades of the Vittoriano, the unknown soldier with his flame
 *   146 Castel Sant'Angelo: a library-family attraction, the round keep on the river,
 *       the archangel on his tower
 */

const TAGS = ['world', 'rome'];

// ================================================================= 141 the Colosseum

/**
 * The amphitheatre of the emperors on the Via Sacra: the outer wall in its three receding
 * storeys of arches stepped in as it climbs, the rim of the upper seating above it, and
 * the sand arena on the flat top, all turned as one lathe so the curve stays true - the
 * bowl reads from above, the arcade from the street. The four entrance boxes stand at the
 * cardinal points where a square wall can be tangent to the ring.
 */
const TRAVERTINE = 0xd8c9a4, TRAVERTINE_DK = 0xc4b48e;

const colosseumOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the amphitheatre in one turned mass: three receding storeys, the seating rim, the flat top
  ops.push(['lathe', 0, 0.02, 0, TRAVERTINE, [0.95, 0, 0.95, 0.2, 0.9, 0.2, 0.9, 0.4, 0.85, 0.4, 0.85, 0.58, 0.6, 0.58, 0.6, 0.62, 0, 0.62], { seg: 24 }]);
  // the sand arena on the top, with the rim of the upper seating showing round it
  ops.push(['cyl', 0.45, 0.47, 0.02, 0, 0.64, 0, 'sand', 20]);
  // the four entrances at the cardinal points, tangent to the ring
  ops.push(['box', 0.12, 0.3, 0.34, 0.93, 0.02, 0, TRAVERTINE_DK], ['box', 0.12, 0.3, 0.34, -0.93, 0.02, 0, TRAVERTINE_DK]);
  ops.push(['box', 0.34, 0.3, 0.12, 0, 0.02, 0.93, TRAVERTINE_DK], ['box', 0.34, 0.3, 0.12, 0, 0.02, -0.93, TRAVERTINE_DK]);
  // pines and lamps outside the wall
  ops.push(...tree(-0.72, 0.72, 0.5), ...tree(0.72, 0.72, 0.5));
  ops.push(...lampPost(-0.55, 0.88, 0.3, 'marquee', 0.02), ...lampPost(0.55, 0.88, 0.3, 'marquee', 0.02));
  return ops;
};

const colosseumOpsK31 = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  ops.push(['cyl', 0.92, 0.94, 0.045, 0, 0.015, 0, TRAVERTINE_DK, 32]);
  ops.push(['cyl', 0.69, 0.69, 0.5, 0, 0.06, 0, 'dark', 32]);
  for (let level = 0; level < 3; level++) {
    const y = 0.06 + level * 0.18;
    const r = 0.84 - level * 0.035;
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      ops.push(['cyl', 0.027, 0.033, 0.145, x, y, z, TRAVERTINE, 6]);
      ops.push(['box', 0.065, 0.025, 0.065, x, y + 0.145, z, TRAVERTINE_DK]);
    }
    ops.push(['cyl', r + 0.055, r + 0.055, 0.035, 0, y + 0.145, 0, TRAVERTINE, 32]);
  }
  ops.push(['cyl', 0.79, 0.79, 0.055, 0, 0.585, 0, TRAVERTINE_DK, 32]);
  ops.push(['cyl', 0.55, 0.55, 0.018, 0, 0.64, 0, 'sand', 32]);
  for (const x of [-0.24, 0, 0.24]) ops.push(['box', 0.055, 0.012, 0.74, x, 0.658, 0, 'dark']);
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * 0.08 + i * Math.PI * 0.084;
    ops.push(['box', 0.09, 0.12 + (i % 3) * 0.025, 0.09, Math.cos(a) * 0.77, 0.64, Math.sin(a) * 0.77, TRAVERTINE]);
  }
  ops.push(...tree(-0.78, 0.72, 0.45), ...tree(0.78, 0.72, 0.45));
  ops.push(...lampPost(-0.45, 0.9, 0.28, 'marquee', 0.02), ...lampPost(0.45, 0.9, 0.28, 'marquee', 0.02));
  return ops;
};

export const colosseum: KindDef = {
  id: 'colosseum', name: 'the Colosseum', code: library.code, kindId: 141, family: 'leisure', tier: 1,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'amphitheatre guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 200, ticket: 18, openHours: [9, 19.5], stay: [1.0, 2.0], leisureValue: 8, radius: 30,
    dayAppeal: 1.7, eveningAppeal: 0.3, retireeAppeal: 2.0, childAppeal: 1.9, title: 'the Colosseum',
  },
  lot: { wage: 17 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The amphitheatre of the emperors on the Via Sacra, fifty thousand Romans roaring over the sand below: the arena, the bowl of the cavea, and the three receding storeys of arches.',
  howTo: 'A 2×2 plot open to the street; a busy daytime outing for the whole city, so give it a metro or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'colosseum', key: '', label: 'Colosseum', color: '#d8c9a4' },
  levels: [{
    capacity: 48, wage: 17, cost: 15000, upkeep: 65, work: 3200, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'k3.1-pro', draft: true, name: 'three open arcaded rings, a broken upper rim and the excavated hypogeum in the arena', height: 0.82, ops: colosseumOpsK31() },
      { author: 'kimi-2.8-preview', name: 'the amphitheatre of the emperors, the arena and the receding rings of arches', height: 0.7, ops: colosseumOps() },
    ],
  }],
};

// ================================================================= 142 St Peter's Basilica

/**
 * The great church of the popes west of the Tiber: Maderna's long front with the nave
 * behind it, the transept under Michelangelo's dome rising from its drum, the choir
 * closing the cross, and before it all the colonnaded square, its two arms of columns
 * opening around the Egyptian obelisk. Plain stone and dark insets only, so no window
 * rule is touched.
 */
const VATICAN = 0xe8e0cc, DOME = 0xb9b2a0;

const stPetersOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the square with the obelisk at its centre
  ops.push(['cyl', 0.05, 0.06, 0.02, 0, 0.02, 0.25, 'stone', 14]);
  ops.push(['cyl', 0.018, 0.024, 0.36, 0, 0.04, 0.25, 0x8a4a3a, 4]);
  ops.push(['box', 0.05, 0.05, 0.012, 0, 0.4, 0.25, 'gold']);
  // the two colonnade arms: columns with their abaci along the front ellipse
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const th = 0.4 + i * 0.35;
      const cx = sx * Math.cos(th) * 0.85, cz = 0.25 + Math.sin(th) * 0.55;
      ops.push(['cyl', 0.014, 0.016, 0.15, cx, 0.02, cz, VATICAN, 6]);
      ops.push(['box', 0.045, 0.025, 0.045, cx, 0.17, cz, VATICAN]);
    }
  }
  // the church: the front, the nave, the transept and the choir behind
  ops.push(['box', 0.8, 0.42, 0.14, 0, 0.02, 0.6, VATICAN]);
  ops.push(['box', 0.14, 0.24, 0.015, 0, 0.02, 0.68, 0x3a3630]);
  ops.push(['box', 0.7, 0.35, 0.8, 0, 0.02, 0.05, VATICAN]);
  ops.push(['box', 1.0, 0.35, 0.2, 0, 0.02, -0.3, VATICAN]);
  ops.push(['box', 0.5, 0.32, 0.3, 0, 0.02, -0.55, VATICAN]);
  // Michelangelo's dome on its drum over the crossing, the lantern and the cross
  ops.push(['cyl', 0.24, 0.27, 0.12, 0, 0.37, -0.3, VATICAN, 14]);
  ops.push(['lathe', 0, 0.49, -0.3, DOME, [0.28, 0, 0.3, 0.06, 0.27, 0.16, 0.2, 0.26, 0.1, 0.32, 0.03, 0.36, 0, 0.38], { seg: 16 }]);
  ops.push(['cyl', 0.035, 0.04, 0.09, 0, 0.87, -0.3, VATICAN, 8]);
  ops.push(['box', 0.05, 0.07, 0.012, 0, 0.96, -0.3, 'gold']);
  // the lamps of the square
  ops.push(...lampPost(-0.4, 0.25, 0.3, 'marquee', 0.02), ...lampPost(0.4, 0.25, 0.3, 'marquee', 0.02));
  return ops;
};

const stPetersOpsK31 = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  ops.push(['box', 0.76, 0.46, 0.88, 0, 0.03, -0.35, VATICAN]);
  ops.push(['roof', 0.78, 0.18, 0.9, 0, 0.49, -0.35, DOME, true]);
  ops.push(['box', 1.14, 0.42, 0.32, 0, 0.03, -0.42, VATICAN]);
  ops.push(['cyl', 0.31, 0.33, 0.4, 0, 0.03, -0.65, VATICAN, 20]);
  ops.push(['box', 1.18, 0.48, 0.17, 0, 0.03, 0.15, VATICAN]);
  for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) ops.push(['box', x === 0 ? 0.15 : 0.11, 0.25, 0.018, x, 0.04, 0.245, 'dark']);
  for (let i = 0; i < 10; i++) {
    const x = -0.52 + i * 0.104;
    ops.push(['cyl', 0.022, 0.026, 0.36, x, 0.05, 0.285, VATICAN, 8]);
    ops.push(['box', 0.06, 0.03, 0.06, x, 0.41, 0.285, VATICAN]);
    ops.push(['box', 0.035, 0.075, 0.035, x, 0.57, 0.15, VATICAN]);
  }
  ops.push(['box', 1.23, 0.07, 0.26, 0, 0.48, 0.19, VATICAN]);
  ops.push(['roof', 0.48, 0.17, 0.18, 0, 0.55, 0.19, VATICAN]);
  ops.push(['cyl', 0.27, 0.29, 0.18, 0, 0.5, -0.43, VATICAN, 24]);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI * 2 / 12;
    ops.push(['box', 0.035, 0.13, 0.035, Math.cos(a) * 0.275, 0.525, -0.43 + Math.sin(a) * 0.275, 'dark']);
  }
  ops.push(['lathe', 0, 0.68, -0.43, DOME, [0.28, 0, 0.31, 0.06, 0.28, 0.18, 0.2, 0.3, 0.09, 0.39, 0.04, 0.43, 0, 0.45], { seg: 24 }]);
  ops.push(['cyl', 0.055, 0.065, 0.12, 0, 1.13, -0.43, VATICAN, 12]);
  ops.push(['lathe', 0, 1.25, -0.43, DOME, [0.065, 0, 0.05, 0.04, 0, 0.07], { seg: 12 }]);
  ops.push(['box', 0.025, 0.13, 0.025, 0, 1.32, -0.43, 'gold']);
  ops.push(['box', 0.1, 0.025, 0.025, 0, 1.37, -0.43, 'gold']);
  for (const x of [-0.38, 0.38]) {
    ops.push(['cyl', 0.11, 0.13, 0.09, x, 0.45, -0.1, VATICAN, 16]);
    ops.push(['lathe', x, 0.54, -0.1, DOME, [0.13, 0, 0.14, 0.05, 0.08, 0.13, 0, 0.17], { seg: 16 }]);
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const a = 0.12 + i * 0.16;
      const x = sx * Math.sin(a) * 0.88, z = 0.45 + Math.cos(a) * 0.43;
      ops.push(['cyl', 0.016, 0.02, 0.16, x, 0.03, z, VATICAN, 8]);
      ops.push(['box', 0.055, 0.025, 0.055, x, 0.19, z, VATICAN]);
    }
  }
  ops.push(['cyl', 0.09, 0.1, 0.035, 0, 0.03, 0.59, 'stone', 16]);
  ops.push(['taper', 0.055, 0.055, 0.025, 0.025, 0.39, 0, 0.065, 0.59, 'sand']);
  ops.push(['cyl', 0.012, 0.012, 0.07, 0, 0.455, 0.59, 'gold', 6]);
  for (const x of [-0.43, 0.43]) ops.push(['cyl', 0.12, 0.15, 0.025, x, 0.03, 0.59, 'pond', 20]);
  return ops;
};

export const stPeters: KindDef = {
  id: 'st-peters', name: 'St Peter\'s Basilica', code: library.code, kindId: 142, family: 'leisure', tier: 2,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'basilica verger' },
  attrs: {
    ...library.attrs, visitorCapacity: 240, ticket: 0, openHours: [7, 19], stay: [0.8, 1.8], leisureValue: 9, radius: 32,
    dayAppeal: 1.7, eveningAppeal: 0.5, retireeAppeal: 2.2, childAppeal: 1.4, title: 'St Peter\'s Basilica',
  },
  lot: { wage: 16 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The great church of the popes west of the Tiber: Michelangelo\'s dome swelling over the crossing, and before it the colonnaded square where the obelisk has stood since the year 1586.',
  howTo: 'A 2×2 plot open at the front for the square; the grandest free visit in the city, drawing visitors all day, so give it a metro or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'stpeters', key: '', label: 'St Peter\'s', color: '#e8e0cc' },
  levels: [{
    capacity: 55, wage: 16, cost: 18000, upkeep: 70, work: 3600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'k3.1-pro', draft: true, name: 'a columned facade with rooftop saints, a ribbed great dome and two small domes around the elliptical square', height: 1.45, ops: stPetersOpsK31() },
      { author: 'kimi-2.8-preview', name: 'the great church of the popes, the dome over the crossing, the colonnaded square with the obelisk', height: 1.03, ops: stPetersOps() },
    ],
  }],
};

// ================================================================= 143 the Pantheon

/**
 * The temple of all the gods, two thousand years a church: the columned portico with its
 * pediment on the street, the great brick rotunda behind it, and the dome rising in its
 * rings to the eye of the oculus. Plain brick and stone, the doors and the one window
 * inset dark, so no window rule is touched.
 */
const ROMAN_BRICK = 0xa5765a, ROMAN_BRICK_DK = 0x96685a;

const pantheonOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the rotunda and the dome in its rings
  ops.push(['cyl', 0.42, 0.44, 0.28, 0, 0.02, -0.1, ROMAN_BRICK, 20]);
  ops.push(['lathe', 0, 0.3, -0.1, ROMAN_BRICK_DK, [0.44, 0, 0.44, 0.03, 0.4, 0.03, 0.4, 0.08, 0.34, 0.08, 0.34, 0.13, 0.26, 0.13, 0.26, 0.17, 0.16, 0.17, 0.16, 0.2, 0.05, 0.2, 0, 0.22], { seg: 20 }]);
  // the one true window of the drum, inset dark
  ops.push(['box', 0.09, 0.11, 0.02, 0.36, 0.16, 0.22, 0x3a3630], ['box', 0.09, 0.11, 0.02, -0.36, 0.16, 0.22, 0x3a3630]);
  // the portico: six columns across, three deep each side, the entablature and pediment
  for (let i = 0; i < 6; i++) ops.push(['cyl', 0.022, 0.026, 0.22, -0.3 + i * 0.12, 0.02, 0.52, TRAVERTINE, 8]);
  for (const sx of [-1, 1]) for (const z of [0.4, 0.52]) ops.push(['cyl', 0.022, 0.026, 0.22, sx * 0.36, 0.02, z, TRAVERTINE, 8]);
  ops.push(['box', 0.78, 0.05, 0.3, 0, 0.24, 0.46, TRAVERTINE]);
  ops.push(['roof', 0.8, 0.12, 0.3, 0, 0.29, 0.46, TRAVERTINE_DK, false]);
  // the bronze doors under the portico
  ops.push(['box', 0.14, 0.2, 0.02, 0, 0.02, 0.31, 0x4a3b28]);
  // the piazza fountain, a lamp and a tree
  ops.push(['cyl', 0.12, 0.13, 0.03, -0.62, 0.02, 0.62, 'pond', 12]);
  ops.push(...lampPost(0.62, 0.62, 0.3, 'marquee', 0.02));
  ops.push(...tree(0.75, -0.72, 0.55));
  return ops;
};

const pantheonOpsK31 = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  ops.push(['cyl', 0.56, 0.58, 0.46, 0, 0.025, -0.23, ROMAN_BRICK, 32]);
  ops.push(['cyl', 0.59, 0.59, 0.045, 0, 0.485, -0.23, TRAVERTINE_DK, 32]);
  ops.push(['lathe', 0, 0.53, -0.23, ROMAN_BRICK_DK, [0.58, 0, 0.58, 0.045, 0.535, 0.045, 0.535, 0.105, 0.47, 0.105, 0.47, 0.17, 0.37, 0.17, 0.37, 0.235, 0.24, 0.235, 0.24, 0.29, 0.1, 0.29, 0.1, 0.315, 0, 0.315], { seg: 32 }]);
  ops.push(['cyl', 0.102, 0.102, 0.008, 0, 0.845, -0.23, 'dark', 24]);
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    ops.push(['box', 0.055, 0.3, 0.04, Math.sin(a) * 0.565, 0.1, -0.23 + Math.cos(a) * 0.565, ROMAN_BRICK_DK]);
  }
  ops.push(['box', 0.88, 0.36, 0.17, 0, 0.025, 0.36, ROMAN_BRICK]);
  ops.push(['box', 0.18, 0.29, 0.02, 0, 0.025, 0.455, 0x41352b]);
  for (const x of [-0.06, 0.06]) ops.push(['box', 0.008, 0.27, 0.024, x, 0.035, 0.455, 'gold']);
  for (const z of [0.51, 0.73]) {
    for (let i = 0; i < 8; i++) {
      const x = -0.49 + i * 0.14;
      ops.push(['cyl', 0.027, 0.034, 0.36, x, 0.025, z, TRAVERTINE, 10]);
      ops.push(['box', 0.075, 0.035, 0.075, x, 0.025, z, TRAVERTINE_DK]);
      ops.push(['box', 0.07, 0.03, 0.07, x, 0.385, z, TRAVERTINE]);
    }
  }
  ops.push(['box', 1.1, 0.075, 0.43, 0, 0.415, 0.62, TRAVERTINE]);
  ops.push(['roof', 1.14, 0.21, 0.46, 0, 0.49, 0.62, TRAVERTINE_DK, false]);
  ops.push(['roof', 0.96, 0.14, 0.025, 0, 0.515, 0.86, TRAVERTINE, false]);
  for (const x of [-0.38, -0.19, 0, 0.19, 0.38]) ops.push(['box', 0.08, 0.035, 0.02, x, 0.45, 0.845, ROMAN_BRICK_DK]);
  ops.push(['cyl', 0.21, 0.23, 0.045, -0.69, 0.025, 0.45, TRAVERTINE_DK, 20]);
  ops.push(['cyl', 0.18, 0.18, 0.012, -0.69, 0.07, 0.45, 'pond', 20]);
  ops.push(['cyl', 0.055, 0.08, 0.18, -0.69, 0.082, 0.45, TRAVERTINE, 12]);
  ops.push(['taper', 0.07, 0.07, 0.018, 0.018, 0.43, -0.69, 0.262, 0.45, ROMAN_BRICK_DK]);
  ops.push(['cone', 0.018, 0.07, -0.69, 0.692, 0.45, 'gold', 4]);
  ops.push(...lampPost(0.76, 0.65, 0.32, 'marquee', 0.02));
  return ops;
};

export const pantheon: KindDef = {
  id: 'pantheon', name: 'the Pantheon', code: library.code, kindId: 143, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'temple keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 90, ticket: 0, openHours: [9, 19], stay: [0.4, 1.0], leisureValue: 7, radius: 22,
    dayAppeal: 1.4, eveningAppeal: 0.3, retireeAppeal: 1.8, childAppeal: 1.2, title: 'the Pantheon',
  },
  lot: { wage: 14 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The temple of all the gods, two thousand years a church: the columns and pediment on the piazza, and behind them the brick rotunda whose dome, a perfect hemisphere, still has no equal.',
  howTo: 'A 2×2 plot in the old town among shops and cafes; a short quiet visit between the grander sights, no ticket needed. World landmark: unlock rule to be decided.',
  tool: { id: 'pantheon', key: '', label: 'Pantheon', color: '#a5765a' },
  levels: [{
    capacity: 18, wage: 14, cost: 9000, upkeep: 40, work: 2000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'k3.1-pro', draft: true, name: 'sixteen granite columns before the brick drum, a five-stepped dome with an open oculus and the piazza obelisk', height: 0.853, ops: pantheonOpsK31() },
      { author: 'kimi-2.8-preview', name: 'the temple of all the gods, the columns and pediment before the great dome with its rings', height: 0.54, ops: pantheonOps() },
    ],
  }],
};

// ================================================================= 144 the Trevi Fountain

/**
 * The fountain of the waters against the palace wall: the triumphal arch with its niche,
 * the little figure of Oceanus white in the shadow, the columns and attic above, and the
 * rocky cascade stepping down into the great basin where the coins fly. Plain stone and
 * dark insets only, so no window rule is touched.
 */
const TREVI_ST = 0xd0bf9c;

const treviOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the palace front behind the fountain
  ops.push(['box', 1.7, 0.5, 0.35, 0, 0.02, -0.55, TREVI_ST]);
  ops.push(['box', 0.1, 0.14, 0.015, -0.55, 0.2, -0.37, 0x3a3630], ['box', 0.1, 0.14, 0.015, 0.55, 0.2, -0.37, 0x3a3630]);
  ops.push(['box', 0.1, 0.12, 0.015, -0.55, 0.36, -0.37, 0x3a3630], ['box', 0.1, 0.12, 0.015, 0.55, 0.36, -0.37, 0x3a3630]);
  // the fountain against it: the arch, Oceanus in his niche, the flanking columns and attic
  ops.push(['box', 0.34, 0.32, 0.06, 0, 0.06, -0.34, TREVI_ST]);
  ops.push(['box', 0.24, 0.26, 0.02, 0, 0.08, -0.31, 0x2b3a42]);
  ops.push(['lathe', 0, 0.09, -0.3, 'white', [0.045, 0, 0.05, 0.02, 0.035, 0.06, 0.028, 0.09, 0.012, 0.11, 0, 0.12], { seg: 8 }]);
  ops.push(['cyl', 0.012, 0.014, 0.07, -0.24, 0.06, -0.34, TREVI_ST, 8], ['cyl', 0.012, 0.014, 0.07, 0.24, 0.06, -0.34, TREVI_ST, 8]);
  ops.push(['box', 0.62, 0.05, 0.08, 0, 0.4, -0.34, TREVI_ST]);
  // the cascade stepping down to the basin
  ops.push(['box', 0.9, 0.1, 0.2, 0, 0.02, -0.2, TREVI_ST]);
  ops.push(['box', 0.7, 0.08, 0.18, 0, 0.02, -0.04, TREVI_ST]);
  ops.push(['box', 1.5, 0.05, 0.56, 0, 0.02, 0.32, 'pond']);
  ops.push(['box', 1.58, 0.06, 0.64, 0, 0.02, 0.32, TREVI_ST]);
  // the lamps of the little square
  ops.push(...lampPost(-0.72, 0.72, 0.3, 'marquee', 0.02), ...lampPost(0.72, 0.72, 0.3, 'marquee', 0.02));
  return ops;
};

export const treviFountain: KindDef = {
  id: 'trevi-fountain', name: 'the Trevi Fountain', code: library.code, kindId: 144, family: 'leisure', tier: 4,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'fountain keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 100, ticket: 0, openHours: [8, 21.5], stay: [0.3, 0.8], leisureValue: 7, radius: 20,
    dayAppeal: 1.3, eveningAppeal: 0.8, retireeAppeal: 1.6, childAppeal: 1.6, title: 'the Trevi Fountain',
  },
  lot: { wage: 14 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The fountain of the waters against the palace wall: the arch and its niche, the little figure of Oceanus white above the cascade, and the basin where a coin promises a return to Rome.',
  howTo: 'A 2×2 plot tucked into the old town among shops and cafes; a short free visit that glows at night, best near restaurants. World landmark: unlock rule to be decided.',
  tool: { id: 'trevi', key: '', label: 'Trevi Fountain', color: '#d0bf9c' },
  levels: [{
    capacity: 16, wage: 14, cost: 8000, upkeep: 35, work: 1600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the fountain of the waters, the arch and Oceanus above the cascade into the great basin', height: 0.52, ops: treviOps() },
    ],
  }],
};

// ================================================================= 145 the Altare della Patria

/**
 * The Vittoriano at Piazza Venezia, the wedding cake of white marble: the great terraces,
 * the grand staircase down to the square, the colonnade across the top with its wings,
 * and between the columns the unknown soldier with his flame, guarded day and night.
 * Plain marble and dark insets only, so no window rule is touched.
 */
const MARBLE = 0xf0ece2, MARBLE_DK = 0xdcd6c8;

const altareOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the terraces and the grand staircase down to the square
  ops.push(['box', 1.8, 0.14, 1.5, 0, 0.02, -0.1, MARBLE]);
  ops.push(['box', 1.6, 0.12, 1.3, 0, 0.16, -0.15, MARBLE_DK]);
  ops.push(['box', 1.0, 0.03, 0.12, 0, 0.02, 0.66, MARBLE], ['box', 1.2, 0.03, 0.12, 0, 0.05, 0.75, MARBLE]);
  ops.push(['box', 1.4, 0.03, 0.12, 0, 0.08, 0.84, MARBLE], ['box', 1.6, 0.03, 0.12, 0, 0.11, 0.93, MARBLE]);
  // the colonnade across the top, the hall behind it, the wings at the ends
  for (let i = 0; i < 9; i++) ops.push(['cyl', 0.028, 0.032, 0.16, -0.64 + i * 0.16, 0.28, 0.18, MARBLE, 8]);
  ops.push(['box', 1.5, 0.05, 0.14, 0, 0.44, 0.18, MARBLE_DK]);
  ops.push(['box', 1.3, 0.2, 0.3, 0, 0.28, -0.05, MARBLE_DK]);
  ops.push(['box', 0.3, 0.26, 0.4, -0.72, 0.28, -0.02, MARBLE], ['box', 0.3, 0.26, 0.4, 0.72, 0.28, -0.02, MARBLE]);
  // the unknown soldier on his bier between the columns, the two flames
  ops.push(['box', 0.16, 0.06, 0.1, 0, 0.28, 0.24, MARBLE_DK]);
  ops.push(['lathe', 0, 0.34, 0.24, 'white', [0.05, 0, 0.055, 0.02, 0.04, 0.08, 0.032, 0.12, 0.014, 0.15, 0, 0.17], { seg: 8 }]);
  ops.push(['cyl', 0.03, 0.035, 0.03, -0.3, 0.28, 0.24, MARBLE_DK, 8], ['cyl', 0.03, 0.035, 0.03, 0.3, 0.28, 0.24, MARBLE_DK, 8]);
  ops.push(['cone', 0.018, 0.04, -0.3, 0.31, 0.24, 'marquee', 6], ['cone', 0.018, 0.04, 0.3, 0.31, 0.24, 'marquee', 6]);
  // the lamps of the square
  ops.push(...lampPost(-0.7, 0.6, 0.3, 'marquee', 0.02), ...lampPost(0.7, 0.6, 0.3, 'marquee', 0.02));
  return ops;
};

export const altareDellaPatria: KindDef = {
  id: 'altare-della-patria', name: 'the Altare della Patria', code: library.code, kindId: 145, family: 'leisure', tier: 5,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'memorial guard' },
  attrs: {
    ...library.attrs, visitorCapacity: 80, ticket: 0, openHours: [9, 20], stay: [0.4, 0.9], leisureValue: 6, radius: 22,
    dayAppeal: 1.2, eveningAppeal: 0.4, retireeAppeal: 2.0, childAppeal: 1.0, title: 'the Altare della Patria',
  },
  lot: { wage: 15 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The wedding cake of white marble at Piazza Venezia: the terraces, the grand staircase, the colonnade across the top, and between its columns the unknown soldier, his flame never out.',
  howTo: 'A 2×2 plot on a grand avenue; a short free visit that suits a ceremonial part of town. World landmark: unlock rule to be decided.',
  tool: { id: 'altare', key: '', label: 'Altare della Patria', color: '#f0ece2' },
  levels: [{
    capacity: 14, wage: 15, cost: 9000, upkeep: 40, work: 1800, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the white terraces and colonnades of the Vittoriano, the unknown soldier with his flame', height: 0.51, ops: altareOps() },
    ],
  }],
};

// ================================================================= 146 Castel Sant'Angelo

/**
 * The mausoleum of Hadrian on the Tiber, a castle for a thousand years: the great round
 * drum of the Roman tomb, the smaller ring of the keep on its top with its crenellations,
 * and the archangel on his pedestal between the battlements, his sword sheathed. Plain
 * stone and dark insets only, so no window rule is touched.
 */
const CASTLE = 0xcbbfa5, CASTLE_DK = 0xbcae92;

const castelOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the drum of the mausoleum and the keep ring on its top
  ops.push(['cyl', 0.5, 0.54, 0.42, 0, 0.02, -0.1, CASTLE, 20]);
  ops.push(['cyl', 0.36, 0.4, 0.16, 0, 0.44, -0.1, CASTLE_DK, 16]);
  // the windows of the drum, inset dark
  ops.push(['box', 0.08, 0.12, 0.02, 0, 0.18, 0.42, 0x3a3630], ['box', 0.08, 0.12, 0.02, 0.38, 0.18, -0.06, 0x3a3630]);
  ops.push(['box', 0.08, 0.12, 0.02, -0.38, 0.18, -0.06, 0x3a3630]);
  // the crenellations around the keep
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ops.push(['box', 0.07, 0.05, 0.07, Math.cos(a) * 0.36, 0.6, -0.1 + Math.sin(a) * 0.36, CASTLE]);
  }
  // the archangel on his pedestal, wings and sheathed sword
  ops.push(['cyl', 0.05, 0.055, 0.05, 0, 0.6, -0.1, CASTLE_DK, 8]);
  ops.push(['lathe', 0, 0.65, -0.1, 'white', [0.04, 0, 0.045, 0.02, 0.032, 0.07, 0.026, 0.1, 0.012, 0.115, 0, 0.13], { seg: 8 }]);
  ops.push(['box', 0.12, 0.055, 0.012, -0.05, 0.72, -0.12, 'white'], ['box', 0.12, 0.055, 0.012, 0.05, 0.72, -0.12, 'white']);
  ops.push(['box', 0.012, 0.07, 0.012, 0.045, 0.64, -0.08, 'gold']);
  // the approach from the bridge and the lamps of the bank
  ops.push(['box', 0.5, 0.012, 0.5, 0, 0.02, 0.62, 'stone']);
  ops.push(...lampPost(-0.55, 0.75, 0.3, 'marquee', 0.02), ...lampPost(0.55, 0.75, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.78, -0.72, 0.55), ...tree(0.78, -0.72, 0.55));
  return ops;
};

export const castelSantAngelo: KindDef = {
  id: 'castel-sant-angelo', name: 'Castel Sant\'Angelo', code: library.code, kindId: 146, family: 'leisure', tier: 6,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'rome',
  occupation: { ...library.occupation!, name: 'castle warder' },
  attrs: {
    ...library.attrs, visitorCapacity: 70, ticket: 12, openHours: [9, 19.5], stay: [0.6, 1.2], leisureValue: 6, radius: 22,
    dayAppeal: 1.2, eveningAppeal: 0.5, retireeAppeal: 1.6, childAppeal: 1.2, title: 'Castel Sant\'Angelo',
  },
  lot: { wage: 15 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The mausoleum of Hadrian on the Tiber, a castle for a thousand years: the great round drum, the keep with its battlements, and the archangel on his tower whose sheathed sword marks the end of the plague.',
  howTo: 'A 2×2 plot by the water suits the old fortress; a modest ticketed visit, prettiest from across the river. World landmark: unlock rule to be decided.',
  tool: { id: 'castelsangelo', key: '', label: 'Castel Sant\'Angelo', color: '#cbbfa5' },
  levels: [{
    capacity: 12, wage: 15, cost: 8000, upkeep: 35, work: 1600, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the mausoleum of Hadrian, the round keep with the archangel on his tower', height: 0.8, ops: castelOps() },
    ],
  }],
};

export const ROME_LANDMARKS: KindDef[] = [colosseum, stPeters, pantheon, treviFountain, altareDellaPatria, castelSantAngelo];
