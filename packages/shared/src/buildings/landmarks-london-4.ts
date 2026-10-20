import type { KindDef, Op } from './schema';
import { repeat } from './helpers';
import { slab, lampPost, PAVING } from './tierkit';
import { theatre } from './leisure';

/**
 * Piccadilly Circus (kind id 116, collection tier 15 of the 'london' group; docs/buildings.md "Landmarks", docs/adverts.md
 * section 9): the West End junction where Piccadilly, Regent Street, Shaftesbury Avenue, Coventry Street and Haymarket
 * meet, with the Piccadilly Lights on the curved corner of the London Pavilion and Monico block. It works as a
 * theatre-family venue (the Criterion Theatre under the Criterion building), with nights out four times a week, and
 * like the other London landmarks is unlocked by the locked tech node 'lnd1'.
 *
 * The design, 4×2, about 33 m to a tile, +z towards the road (Piccadilly):
 *   - right: the Lights block. A stone corner of radius 0.75 about (0.35, -0.05) turns from facing west to facing the
 *     road; round it run six big screens (the `screens` op: three columns of 30 degrees, two rows), which the client
 *     lights and turns through the campaigns that rent them (render/adverts.ts). A deep block behind carries the
 *     shopfronts and windows on its front; the west arm behind the curve is blank stone with a lit sign blade, as the
 *     real one is all signs.
 *   - left: the Criterion, Portland stone with an arcaded ground floor, a mansard and dormers, its long front on the
 *     square and the theatre's lit canopy under it.
 *   - middle: the paved square with the Shaftesbury Memorial Fountain: an octagonal stepped base, the bronze basin and
 *     its tiers, and the winged aluminium archer (Anteros, known as Eros) balanced on one foot at the top.
 *   - Underground entrances at the front corners: stairs going down behind railings, each with its roundel; a pair of
 *     red telephone boxes and the square's lamps.
 *
 * Facade note (the windows check): boxes whose walls stand behind the round corner carry no windows on those walls, as
 * the corner's bounds would cover them: the deep block has windows on its front and back only, the west arm none.
 */

const TAGS = ['london'];

const PORTLAND = 0xe6dfcd, PORTLAND_DK = 0xcfc6b0, SLATE = 0x56606b, BRONZE = 0x4d5b47, BRONZE_DK = 0x3a4537;
const ALUMINIUM = 0xb9bec4, RAIL = 0x1f2a24, ROUNDEL_RED = 0xdc241f, ROUNDEL_BLUE = 0x0019a8;

/** The corner: centre and radius of the curve the Lights go round. */
const CX = 0.35, CZ = -0.05, R = 0.75;
/** The screens' foot and height on the curve. */
const LIGHTS_Y = 0.3, LIGHTS_H = 0.48;
const TOP = 1.02;

/**
 * The Shaftesbury Memorial Fountain at (x, z): an octagonal stepped base, the basin with its water, the bronze stem and
 * its tiers, and Anteros on top, winged, his bow drawn, balanced on his left foot with his right leg raised behind.
 */
function fountain(x: number, z: number): Op[] {
  const s = 1.25; // a little larger than life, so the statue reads from the street
  const at = (y: number) => 0.02 + y * s;
  const ops: Op[] = [
    // the granite ring round it, and three octagonal steps
    ['cyl', 0.3 * s, 0.3 * s, 0.006, x, 0.02, z, 0xb9b3a6, 24],
    ['cyl', 0.2 * s, 0.205 * s, 0.02 * s, x, at(0), z, PORTLAND_DK, 8],
    ['cyl', 0.175 * s, 0.18 * s, 0.02 * s, x, at(0.02), z, PORTLAND, 8],
    ['cyl', 0.15 * s, 0.155 * s, 0.02 * s, x, at(0.04), z, PORTLAND_DK, 8],
    // the basin and its water
    ['cyl', 0.135 * s, 0.13 * s, 0.035 * s, x, at(0.06), z, BRONZE_DK, 16],
    ['cyl', 0.12 * s, 0.12 * s, 0.033 * s, x, at(0.062), z, 'pond', 16],
    // the stem, the tazza and the upper cup, with the little dolphins' spouts round the stem
    ['cyl', 0.045 * s, 0.07 * s, 0.1 * s, x, at(0.08), z, BRONZE, 8],
    ...repeat(4, (i): Op => ['box', 0.02 * s, 0.025 * s, 0.02 * s, x + Math.sin((i * Math.PI) / 2 + 0.4) * 0.07 * s, at(0.1), z + Math.cos((i * Math.PI) / 2 + 0.4) * 0.07 * s, BRONZE_DK]),
    ['cyl', 0.08 * s, 0.03 * s, 0.025 * s, x, at(0.18), z, BRONZE, 12],
    ['cyl', 0.022 * s, 0.026 * s, 0.07 * s, x, at(0.205), z, BRONZE, 8],
    ['cyl', 0.042 * s, 0.016 * s, 0.016 * s, x, at(0.275), z, BRONZE, 10],
    ['cyl', 0.012 * s, 0.014 * s, 0.012 * s, x, at(0.291), z, BRONZE_DK, 6],
  ];
  // Anteros (Eros), in aluminium, facing the street: balanced on the left foot with the right leg kicked up behind,
  // leaning forward, arms out in front holding the bow, and the wings raised in a V behind the shoulders
  const y0 = at(0.303), k = s * 1.35, X = (v: number) => x + v * k, Y = (v: number) => y0 + v * k, Z = (v: number) => z + v * k;
  ops.push(
    ['lathe', x, Y(-0.004), z, ALUMINIUM, [0, 0, 0.007 * k, 0.003 * k, 0.006 * k, 0.006 * k, 0, 0.007 * k], { seg: 8 }], // the orb he stands on
    ['taper', 0.005 * k, 0.006 * k, 0.008 * k, 0.008 * k, 0.032 * k, X(-0.002), Y(0), z, ALUMINIUM, { shift: [0, 0.004 * k] }], // the standing left leg
    ['taper', 0.006 * k, 0.005 * k, 0.008 * k, 0.008 * k, 0.014 * k, X(0.004), Y(0.02), Z(-0.034), ALUMINIUM, { shift: [0, 0.03 * k] }], // the right leg, up behind
    ['taper', 0.013 * k, 0.009 * k, 0.017 * k, 0.01 * k, 0.03 * k, x, Y(0.03), Z(0.002), ALUMINIUM, { shift: [0, 0.007 * k] }], // the torso, leaning forward
    ['lathe', x, Y(0.06), Z(0.011), ALUMINIUM, [0, 0, 0.006 * k, 0.003 * k, 0.0075 * k, 0.008 * k, 0.006 * k, 0.012 * k, 0, 0.015 * k], { seg: 8 }], // the head
    // the arms out in front at the shoulders, the bow upright in the hands and its string
    ['box', 0.022 * k, 0.005 * k, 0.03 * k, x, Y(0.053), Z(0.024), ALUMINIUM],
    ['box', 0.003 * k, 0.05 * k, 0.004 * k, x, Y(0.03), Z(0.04), ALUMINIUM],
    ['box', 0.001 * k, 0.046 * k, 0.001 * k, x, Y(0.032), Z(0.034), 0x8e949b],
    // the wings: each a broad lower feathering and a long upper tip, raised and swept back from the shoulders
    ...[-1, 1].flatMap((side): Op[] => [
      ['taper', 0.004 * k, 0.022 * k, 0.003 * k, 0.012 * k, 0.03 * k, X(side * 0.007), Y(0.046), Z(-0.006), ALUMINIUM, { shift: [side * 0.022 * k, -0.012 * k] }],
      ['taper', 0.003 * k, 0.012 * k, 0.001 * k, 0.004 * k, 0.04 * k, X(side * 0.029), Y(0.076), Z(-0.018), ALUMINIUM, { shift: [side * 0.016 * k, -0.01 * k] }],
    ]),
  );
  return ops;
}

/**
 * Stairs down to the Underground at (x, z): an opening `w` along x and `d` along z going down towards -z (dark, with the
 * nosings of its steps), railings round the three closed sides, and the roundel on a post at the open end.
 */
function tubeStairs(x: number, z: number, w: number, d: number): Op[] {
  const ops: Op[] = [
    ['box', w, 0.004, d, x, 0.02, z, 0x17191c],
    ...repeat(4, (i): Op => ['box', w - 0.03, 0.003, 0.006, x, 0.0235, z + d / 2 - 0.02 - i * ((d - 0.04) / 3.5), 0x9c978c]),
    // the railings: posts and a top rail along the back and both sides
    ['box', w + 0.01, 0.006, 0.006, x, 0.075, z - d / 2 - 0.003, RAIL],
    ['box', 0.006, 0.006, d, x - w / 2 - 0.003, 0.075, z, RAIL], ['box', 0.006, 0.006, d, x + w / 2 + 0.003, 0.075, z, RAIL],
    ...[-1, 1].flatMap((sx): Op[] => [-1, 1].map((sz): Op => ['box', 0.008, 0.06, 0.008, x + sx * (w / 2 + 0.003), 0.02, z + sz * (d / 2), RAIL])),
    ['box', 0.006, 0.06, 0.006, x, 0.02, z - d / 2 - 0.003, RAIL],
    // the roundel on its post, facing the street: a red ring, the white field and the blue bar
    ['cyl', 0.005, 0.005, 0.15, x + w / 2 + 0.003, 0.02, z + d / 2, RAIL, 5],
    ['lathe', x + w / 2 + 0.003, 0.17, z + d / 2 + 0.004, ROUNDEL_RED, [0.026, 0, 0.026, 0.004], { seg: 16, axis: 'z' }],
    ['lathe', x + w / 2 + 0.003, 0.17, z + d / 2 + 0.008, 'white', [0.016, 0, 0.016, 0.002], { seg: 16, axis: 'z' }],
    ['box', 0.06, 0.009, 0.004, x + w / 2 + 0.003, 0.1655, z + d / 2 + 0.011, ROUNDEL_BLUE],
  ];
  return ops;
}

/** A red K6 telephone box at (x, z), its door towards +z. */
const phoneBox = (x: number, z: number): Op[] => [
  ['box', 0.05, 0.12, 0.05, x, 0.02, z, 'red', 'shop'],
  ['box', 0.054, 0.012, 0.054, x, 0.14, z, 'red'],
  ['box', 0.03, 0.01, 0.03, x, 0.152, z, 'red'],
];

const piccadillyOps = (): Op[] => {
  const ops: Op[] = [
    slab(4, 2, PAVING),
    // the square's setts, a darker band from the Criterion's front round to the corner
    ['box', 1.2, 0.004, 1.0, -0.55, 0.02, 0.45, 0xbdb6a8],

    // ---- the Lights block: the deep block on the east (windows front and back, shopfronts on the ground floor) ...
    ['box', 1.61, TOP - 0.02, 1.66, CX + 1.61 / 2, 0.02, -0.13, PORTLAND, 'shop', { name: 'pavilion', facade: { storeys: 4, bays: 6, sideBays: 0, ground: 'shopfront', margin: 0.04 } }],
    ['cornice', 'pavilion', 1, PORTLAND_DK], ['cornice', 'pavilion', 4, PORTLAND_DK],
    // ... the west arm behind the curve, blank stone with a lit sign blade on its west face
    ['box', 0.75, TOP - 0.02, 0.91, -0.025, 0.02, -0.505, PORTLAND_DK],
    ['box', 0.03, 0.42, 0.06, -0.415, 0.36, -0.55, 'marquee'], ['box', 0.034, 0.44, 0.07, -0.413, 0.35, -0.55, 'charcoal'],
    ['box', 0.78, 0.03, 0.92, -0.025, TOP, -0.5, PORTLAND_DK],
    // ... and the round corner: shop glass at its foot under a fascia, the screens (lit by the client), stone above, a cornice
    ['cyl', R, R, 0.2, CX, 0.02, CZ, 'glassDark', 36],
    ['cyl', R, R, 0.06, CX, 0.22, CZ, 0x1d2430, 36],
    ['screens', CX, LIGHTS_Y, CZ, R, -90, 0, 3, 2, LIGHTS_H, 0x101215],
    ['cyl', R, R, TOP - (LIGHTS_Y + LIGHTS_H + 0.016), CX, LIGHTS_Y + LIGHTS_H + 0.016, CZ, PORTLAND, 36],
    ['cyl', R + 0.02, R + 0.02, 0.035, CX, TOP, CZ, PORTLAND_DK, 36],
    // the London Pavilion's statues along its parapet, and plant on the roof
    ...[0, 1, 2, 3, 4].flatMap((i): Op[] => [['cyl', 0.012, 0.014, 0.05, CX + 0.25 + i * 0.3, TOP + 0.03, 0.66, PORTLAND, 6], ['cyl', 0.008, 0.008, 0.014, CX + 0.25 + i * 0.3, TOP + 0.08, 0.66, PORTLAND, 6]]),
    ['box', 0.3, 0.07, 0.2, 1.4, TOP, -0.6, 'plant'], ['box', 0.16, 0.1, 0.16, 0.9, TOP, -0.7, 'plant'],

    // ---- the Criterion: its long front on the square, the theatre's canopy, a mansard with dormers
    ['box', 0.91, 0.76, 1.56, -1.505, 0.02, -0.18, PORTLAND, true, { name: 'criterion', facade: { storeys: 4, bays: 4, sideBays: 8, margin: 0.04, top: 0.04 } }],
    ['door', 'criterion', 'right', 3], ['door', 'criterion', 'right', 4],
    ['awning', 'criterion', 'right', 3, 4, 'marquee'],
    ['cornice', 'criterion', 4, PORTLAND_DK],
    ['roof', 0.91, 0.2, 1.56, -1.505, 0.78, -0.18, SLATE, true, { name: 'criterionRoof' }],
    ['dormer', 'criterionRoof', 5, PORTLAND],

    // ---- the square: the fountain, its lamps, the telephone boxes and the Underground's stairs
    ...fountain(-0.62, 0.42),
    ...lampPost(-0.98, 0.1, 0.26, 'marquee'), ...lampPost(-0.2, 0.86, 0.26, 'marquee'), ...lampPost(-0.98, 0.86, 0.26, 'marquee'),
    ...phoneBox(-1.88, 0.72), ...phoneBox(-1.78, 0.72),
    ...tubeStairs(-1.45, 0.84, 0.22, 0.14),
    ...tubeStairs(1.6, 0.86, 0.22, 0.13),
  ];
  return ops;
};

export const piccadillyCircus: KindDef = {
  id: 'piccadilly-circus', name: 'Piccadilly Circus', code: 12, kindId: 116, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue',
  landmark: true, tags: TAGS, group: 'london', tier: 15,
  footprint: { w: 4, h: 2, door: [1, 1] },
  blurb: 'The West End\'s meeting place: the Piccadilly Lights on the curved corner of the London Pavilion, the Shaftesbury Memorial Fountain with its winged archer (Eros, properly Anteros), the Criterion Theatre and the Underground below. The screens are the most expensive advert slots in town, shared in turns.',
  howTo: 'A 4×2 plot facing a main road in the busiest part of town. Its six big screens take turns: rent one through the Campaigns panel (pick a screen) to put your campaign on all of them in turn. London landmark: unlock rule to be decided.',
  tool: { id: 'piccadilly', key: '', label: 'Piccadilly Circus', color: '#e8b923' },
  occupation: { ...theatre.occupation!, name: 'theatre and venue staff' },
  attrs: {
    ...theatre.attrs, visitorCapacity: 120, ticket: 16, leisureValue: 9, radius: 28, eventSize: 1.4, eventNights: [3, 4, 5, 6], stay: [1.5, 3],
    dayAppeal: 0.5, title: 'Piccadilly Circus',
  },
  lot: { wage: 17 },
  levels: [{
    capacity: 30, wage: 17, cost: 12000, upkeep: 80, work: 2400, parking: { surface: 0, underground: 20 },
    designs: [
      { name: 'the Piccadilly Lights round a curved corner, the Criterion and the Shaftesbury fountain with Eros', height: TOP + 0.09, ops: piccadillyOps() },
    ],
  }],
};
