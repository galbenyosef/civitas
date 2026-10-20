import type { KindDef, Op } from './schema';
import { repeat } from './helpers';
import { slab, PAVING } from './tierkit';
import { cinema } from './leisure';

/**
 * The big screens corner (kind id 117, the cinema ladder's top rung; docs/adverts.md section 9): the generic big-screen
 * landmark for any city, Piccadilly Circus without the history. A cinema on a street corner whose rounded corner carries
 * six big screens (the `screens` op), which the client lights and turns through the campaigns renting them, house
 * adverts and the news (render/adverts.ts). Unlocked late, with the opera house and the stadium (tech 'cul5', Landmarks).
 *
 * Two designs, 2×2, +z towards the road (a modern grey block, a terracotta one with a copper dome over the corner), the
 * corner turning to the right side (+x), which wants a road too:
 *   - the cinema block along the front, glass shopfronts under a lit canopy, windows front and back;
 *   - the corner of radius 0.62 about (0.26, 0.26): shop glass at its foot, the screens (three columns of 30 degrees, two
 *     rows), stone above and a cornice;
 *   - the side block behind the corner, blank (its walls stand behind the curve, as on Piccadilly Circus) but for the
 *     cinema's lit sign blade on the side street.
 */

const CX = 0.26, CZ = 0.26, R = 0.62, TOP = 1.02, SY = 0.3, SH = 0.5;
const BODY = 0x8a929c, BODY_DK = 0x6f7782, STONE = 0xd9d3c4;

/** The two designs share the plan; `look` picks the body, the corner's crown and the sign. */
const cornerOps = (look: 'modern' | 'terracotta'): Op[] => look === 'terracotta' ? [
  slab(2, 2, PAVING),
  ['box', 1.2, TOP - 0.02, 1.82, -0.34, 0.02, -0.03, 0xb4553a, true, { name: 'cinema', facade: { storeys: 4, bays: 5, sideBays: 0, ground: 'shopfront', margin: 0.06 } }],
  ['awning', 'cinema', 'front', 0, 2, 'marquee'],
  ['cornice', 'cinema', 4, 0xe3c9a0],
  ['box', 0.62, TOP - 0.02, 1.2, CX + 0.31, 0.02, -0.34, 0x9c4732],
  ['box', 0.65, 0.03, 1.23, CX + 0.31, TOP, -0.34, 0xe3c9a0],
  ['box', 0.03, 0.5, 0.1, 0.9, 0.4, -0.6, 'marquee'], ['box', 0.034, 0.54, 0.14, 0.905, 0.38, -0.6, 'plum'],
  ['cyl', R, R, 0.2, CX, 0.02, CZ, 'glassDark', 32],
  ['cyl', R, R, 0.06, CX, 0.22, CZ, 0x3a2420, 32],
  ['screens', CX, SY, CZ, R, 0, 90, 3, 2, SH, 0x121010],
  ['cyl', R, R, TOP - (SY + SH + 0.016), CX, SY + SH + 0.016, CZ, 0xb4553a, 32],
  ['cyl', R + 0.02, R + 0.02, 0.035, CX, TOP, CZ, 0xe3c9a0, 32],
  // a copper dome on a drum over the corner, with its finial
  ['cyl', 0.3, 0.3, 0.12, CX, TOP + 0.035, CZ, 0xe3c9a0, 16],
  ['lathe', CX, TOP + 0.155, CZ, 0x6fae98, [0.3, 0, 0.28, 0.08, 0.22, 0.15, 0.12, 0.2, 0, 0.23], { seg: 16 }],
  ['cyl', 0.01, 0.014, 0.1, CX, TOP + 0.385, CZ, 'gold', 6],
  ...repeat(4, (i): Op => ['cyl', 0.012, 0.014, 0.05, -0.8 + i * 0.3, 0.02, 0.95, 'charcoal', 6]),
] : [
  slab(2, 2, PAVING),
  // the cinema block along the front: shopfronts below, three storeys over them
  ['box', 1.2, TOP - 0.02, 1.82, -0.34, 0.02, -0.03, BODY, true, { name: 'cinema', facade: { storeys: 4, bays: 5, sideBays: 0, ground: 'shopfront', margin: 0.04 } }],
  ['awning', 'cinema', 'front', 1, 3, 'marquee'],
  ['cornice', 'cinema', 4, STONE],
  // the side block behind the corner, and the cinema's sign blade on its side
  ['box', 0.62, TOP - 0.02, 1.2, CX + 0.31, 0.02, -0.34, BODY_DK],
  ['box', 0.03, 0.62, 0.12, 0.9, 0.32, -0.45, 'red'], ['box', 0.034, 0.58, 0.08, 0.905, 0.34, -0.45, 'marquee'],
  ['box', 0.65, 0.03, 1.23, CX + 0.31, TOP, -0.34, STONE],
  // the corner: shop glass, a fascia, the screens, stone and a cornice
  ['cyl', R, R, 0.2, CX, 0.02, CZ, 'glassDark', 32],
  ['cyl', R, R, 0.06, CX, 0.22, CZ, 0x1d2430, 32],
  ['screens', CX, SY, CZ, R, 0, 90, 3, 2, SH, 0x101215],
  ['cyl', R, R, TOP - (SY + SH + 0.016), CX, SY + SH + 0.016, CZ, STONE, 32],
  ['cyl', R + 0.02, R + 0.02, 0.035, CX, TOP, CZ, STONE, 32],
  // roof plant and a mast with the aircraft light, bollards along the kerb
  ['box', 0.36, 0.08, 0.3, -0.5, TOP, -0.5, 'plant'], ['cyl', 0.012, 0.012, 0.3, 0.5, TOP, -0.6, 'steel', 5], ['cyl', 0.02, 0.02, 0.02, 0.5, TOP + 0.3, -0.6, 'red', 6],
  ...repeat(4, (i): Op => ['cyl', 0.012, 0.014, 0.05, -0.8 + i * 0.3, 0.02, 0.95, 'charcoal', 6]),
];

export const bigScreens: KindDef = {
  id: 'big-screens', name: 'big screens corner', code: 11, kindId: 117, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue',
  group: 'cinema', tier: 4,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'A cinema on a street corner with six big screens round its rounded corner, lit day and night: the town\'s answer to Piccadilly Circus. Campaigns take turns on the screens, the dearest advert slots there are.',
  howTo: 'A 2×2 corner plot with roads on its front and its right side, on the busiest junction you have. Rent a turn on its screens from the Campaigns panel (pick a screen). Needs Landmarks.',
  tool: { id: 'bigscreens', key: '', label: 'Big screens corner', color: '#ff4fa8' },
  occupation: cinema.occupation,
  attrs: { ...cinema.attrs, visitorCapacity: 100, ticket: 10, leisureValue: 7, radius: 22, eventSize: 1.5, eventNights: [3, 4, 5], title: 'big screens corner' },
  lot: { wage: 15 },
  levels: [{
    capacity: 16, wage: 15, cost: 4200, upkeep: 45, work: 800, parking: { surface: 0, underground: 30 },
    designs: [
      { name: 'cinema on a corner with six big screens round its curve', height: TOP + 0.33, ops: cornerOps('modern') },
      { name: 'terracotta corner with big screens under a copper dome', height: TOP + 0.49, ops: cornerOps('terracotta') },
    ],
  }],
};
