import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { office } from './office';
import { sports, library } from './leisure';
import { slab, tree, PAVING } from './tierkit';

/**
 * London landmarks, the second five (docs/buildings.md "Landmarks"; the first five and the framework are in
 * landmarks-london.ts, which lists these after its own): Big Ben and the Houses of Parliament (96), the London Eye (97),
 * the Tower of London (98), Buckingham Palace (99) and Tower Bridge (100), collection tiers 6-10.
 *
 * Roles: Parliament is government offices; the Eye a leisure venue of the sports family (day and evening rides); the
 * Tower and the Palace daytime attractions of the library family (a ticket, long visits, retirees and children).
 *
 * Moving parts are drawn by the client (render/landmarks.ts), placed from the constants exported here so the two stay
 * in step: the Eye's wheel and capsules turn, Tower Bridge's bascules rise for ships, and Big Ben's four dials light
 * at night and show the game's time. The recipe holds everything that stands still, so the far tier, thumbnails and
 * the building viewer show the whole building (the viewer adds the moving parts too).
 *
 * Scale: about 33 m to a tile, as for the first five. Elizabeth Tower (96 m) is 2.9 tiles, the Victoria Tower (98 m)
 * 3, the Eye (135 m) 4.1, Tower Bridge's towers (65 m) 2. The Palace of Westminster and the Tower of London are drawn
 * shorter than life so each fits a London block.
 */

const TAGS = ['london'];
const landmark = { landmark: true, tags: TAGS, group: 'london' } as const;

// ---------------------------------------------------------------- shared bits

/** A row of pinnacles: n small pointed spirelets along x (or z) from a to b at height y. */
const pinnacles = (n: number, a: number, b: number, at: number, y: number, alongX: boolean, color: Color, s = 1): Op[] =>
  repeat(n, (i): Op => {
    const t = a + ((b - a) * i) / Math.max(1, n - 1);
    return ['taper', 0.035 * s, 0.035 * s, 0, 0, 0.13 * s, alongX ? t : at, y, alongX ? at : t, color];
  });
/** A union flag on a pole: navy field with a white and a red cross, flying towards +x. */
const unionFlag = (x: number, y: number, z: number, pole = 0.32): Op[] => [
  ['cyl', 0.006, 0.008, pole, x, y, z, 'steel', 4],
  ['box', 0.16, 0.1, 0.008, x + 0.085, y + pole - 0.11, z, 'navy'],
  ['box', 0.16, 0.026, 0.01, x + 0.085, y + pole - 0.073, z, 'white'], ['box', 0.03, 0.1, 0.01, x + 0.085, y + pole - 0.11, z, 'white'],
  ['box', 0.16, 0.013, 0.012, x + 0.085, y + pole - 0.067, z, 'red'], ['box', 0.016, 0.1, 0.012, x + 0.085, y + pole - 0.11, z, 'red'],
];
/** Merlons along a wall top: n teeth along x (or z) centred on (x, z), the wall `thick` deep. */
const merlons = (n: number, len: number, x: number, y: number, z: number, alongX: boolean, thick: number, color: Color): Op[] =>
  repeat(n, (i): Op => {
    const t = -len / 2 + (len * (i + 0.5)) / n;
    return alongX ? ['box', (len / n) * 0.55, 0.035, thick, x + t, y, z, color] : ['box', thick, 0.035, (len / n) * 0.55, x, y, z + t, color];
  });

// ================================================================= 96 Big Ben and the Houses of Parliament

const LIME = 0xd8c398, LIME_DK = 0xc2a978, LEAD = 0x56606d;

/**
 * Elizabeth Tower: where its clock stage stands and how big a dial is. The recipe draws the stone, the gilded surrounds
 * and white dials; render/landmarks.ts lays a dial over each that lights at night, with hands at the game's time.
 * Front (+z) is the side the door faces; `face` is the distance from the tower's axis to the face of a dial.
 */
export const BIG_BEN = { x: -1.48, z: 1.6, y: 1.75, face: 0.218, r: 0.118 };
const BB = BIG_BEN;

const elizabethTower = (): Op[] => {
  const { x: X, z: Z } = BB;
  const dial = (dx: number, dz: number): Op => dz !== 0
    ? ['lathe', X, BB.y, Z + dz * (BB.face - 0.004), 0xf3eee0, [0, 0, BB.r, 0, BB.r, 0.006], { seg: 24, axis: 'z' }]
    : ['lathe', X + dx * (BB.face - 0.004), BB.y, Z, 0xf3eee0, [0, 0, BB.r, 0, BB.r, 0.006], { seg: 24, axis: 'x' }];
  return [
    // the shaft: narrow lancets in pairs up the faces, the corners carried up as pilasters
    ['box', 0.36, 1.5, 0.36, X, 0.02, Z, LIME, 'civic', { name: 'bigben', facade: { storeys: 8, bays: 2, sideBays: 2, margin: 0.06 } }],
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Op => ['box', 0.045, 1.5, 0.045, X + sx * 0.165, 0.02, Z + sz * 0.165, LIME_DK]),
    ['box', 0.41, 0.03, 0.41, X, 1.52, Z, LIME_DK],
    // the clock stage, a little wider: a gilded square round a white dial on every face
    ['box', 0.4, 0.44, 0.4, X, 1.55, Z, LIME],
    ['box', 0.31, 0.31, 0.012, X, BB.y - 0.155, Z + 0.2, 'gold'], ['box', 0.31, 0.31, 0.012, X, BB.y - 0.155, Z - 0.2, 'gold'],
    ['box', 0.012, 0.31, 0.31, X + 0.2, BB.y - 0.155, Z, 'gold'], ['box', 0.012, 0.31, 0.31, X - 0.2, BB.y - 0.155, Z, 'gold'],
    dial(0, 1), dial(0, -1), dial(1, 0), dial(-1, 0),
    ['box', 0.43, 0.035, 0.43, X, 1.99, Z, LIME_DK],
    // the belfry: open arches over the clock, then the iron spire with gilded bands and a finial
    ['box', 0.34, 0.24, 0.34, X, 2.025, Z, LIME, 'civic', { facade: { storeys: 1, bays: 2, sideBays: 2, margin: 0.03 } }],
    ['box', 0.38, 0.03, 0.38, X, 2.265, Z, 'gold'],
    ['taper', 0.36, 0.36, 0.22, 0.22, 0.14, X, 2.295, Z, 0x3f4651],
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Op => ['taper', 0.05, 0.05, 0, 0, 0.2, X + sx * 0.16, 2.295, Z + sz * 0.16, 'gold']),
    ['box', 0.23, 0.025, 0.23, X, 2.435, Z, 'gold'],
    ['taper', 0.22, 0.22, 0.02, 0.02, 0.48, X, 2.46, Z, 0x3a404b],
    ['cyl', 0.012, 0.02, 0.07, X, 2.94, Z, 'gold', 6],
  ];
};

/** The z-extent of cells k0..k1-1 of a facade wall running along z from z0 (margin m, cell width cw). */
const cells = (z0: number, m: number, cw: number, k0: number, k1: number): [number, number] => [z0 + m + k0 * cw, z0 + m + k1 * cw];

/**
 * The palace is a grid of ranges round courtyards. Whatever stands against a windowed wall covers whole window cells
 * (buildings:check refuses half-hidden windows), so the pavilions, the cross ranges and the inner range are laid out on
 * the river range's cells: RZ0 its south end, RCW the width of one of its 24 cells along the river.
 */
const RZ0 = -1.86, RZ1 = 1.37, RM = 0.04, RCW = (RZ1 - RZ0 - 2 * RM) / 24;
const rc = (k0: number, k1: number) => cells(RZ0, RM, RCW, k0, k1);
const span = ([z0, z1]: [number, number]) => ({ d: z1 - z0, z: (z0 + z1) / 2 });

const palaceOfWestminster = (): Op[] => {
  const ops: Op[] = [slab(4, 4, PAVING)];
  // the river wall and terrace along the left (the river side)
  ops.push(['box', 0.06, 0.09, 3.9, -1.95, 0.02, 0, 0xb8b0a0]);
  // the river front: one long Gothic range of tall windows under a lead roof, pinnacles along both eaves
  const river = span([RZ0, RZ1]);
  ops.push(['box', 0.58, 0.7, river.d, -1.58, 0.02, river.z, LIME, 'civic', { name: 'river', facade: { storeys: 3, bays: 2, sideBays: 24, margin: RM, top: 0.06 } }]);
  ops.push(['box', 0.6, 0.04, river.d + 0.02, -1.58, 0.72, river.z, LIME_DK], ['roof', 0.56, 0.2, river.d - 0.02, -1.58, 0.76, river.z, LEAD, true]);
  ops.push(...pinnacles(16, RZ0 + 0.06, RZ1 - 0.08, -1.86, 0.74, false, LIME_DK), ...pinnacles(16, RZ0 + 0.06, RZ1 - 0.08, -1.3, 0.74, false, LIME_DK));
  // its pavilions at the ends and the middle stand forward and higher, each under a pyramid of lead
  for (const [z0, z1] of [[RZ0, rc(0, 2)[1]], rc(11, 13), [rc(22, 24)[0], RZ1]] as [number, number][]) {
    const p = span([z0, z1]);
    ops.push(['box', 0.66, 0.9, p.d, -1.58, 0.02, p.z, LIME], ['box', 0.68, 0.035, p.d + 0.02, -1.58, 0.92, p.z, LIME_DK]);
    ops.push(['taper', 0.62, p.d - 0.04, 0.1, 0.06, 0.24, -1.58, 0.955, p.z, LEAD]);
    ops.push(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Op => ['taper', 0.045, 0.045, 0, 0, 0.18, -1.58 + sx * 0.3, 0.955, p.z + sz * (p.d / 2 - 0.03), LIME_DK]));
  }
  // the inner range on the same cells, and the cross ranges between them round the courtyards
  const inner = span(rc(3, 21));
  ops.push(['box', 0.44, 0.62, inner.d, -0.78, 0.02, inner.z, LIME, 'civic', { facade: { storeys: 3, bays: 2, sideBays: 18, top: 0.04 } }]);
  ops.push(['box', 0.46, 0.03, inner.d + 0.02, -0.78, 0.64, inner.z, LIME_DK], ['roof', 0.44, 0.18, inner.d, -0.78, 0.67, inner.z, LEAD, true]);
  for (const c of [rc(5, 7), rc(16, 18)]) { const x = span(c); ops.push(['box', 0.29, 0.7, x.d, -1.145, 0.02, x.z, LIME], ['roof', 0.29, 0.14, x.d, -1.145, 0.72, x.z, LEAD]); }
  // St Stephen's Hall west from the Central Lobby (on the middle cells) to Westminster Hall, and the Central Tower
  const lobby = span(rc(11, 13));
  ops.push(['box', 1.58, 0.66, lobby.d, 0.23, 0.02, lobby.z, LIME], ['roof', 1.58, 0.16, lobby.d, 0.23, 0.68, lobby.z, LEAD]);
  ops.push(['lathe', -0.2, 0.02, lobby.z, LIME, [0.2, 0, 0.2, 0.78, 0.17, 0.78, 0.17, 1.4, 0.19, 1.42, 0.19, 1.46], { seg: 8, win: 'civic' }]);
  ops.push(['lathe', -0.2, 1.48, lobby.z, LEAD, [0.16, 0, 0.11, 0.3, 0.035, 0.86, 0, 0.98], { seg: 8 }]);
  ops.push(...repeat(8, (i): Op => ['taper', 0.03, 0.03, 0, 0, 0.16, -0.2 + 0.18 * Math.sin((i + 0.5) * Math.PI / 4), 1.46, lobby.z + 0.18 * Math.cos((i + 0.5) * Math.PI / 4), LIME_DK]));
  ops.push(['cyl', 0.008, 0.012, 0.06, -0.2, 2.46, lobby.z, 'gold', 5]);
  // Westminster Hall: the medieval hall, plain walls and a great north window, under its steep roof and louvre
  ops.push(['box', 0.52, 0.6, 1.56, 1.28, 0.02, 0.67, LIME_DK, 'civic', { name: 'hall', facade: { storeys: 1, bays: 1, sideBays: 6, margin: 0.1, top: 0.12 } }]);
  ops.push(['roof', 0.54, 0.46, 1.58, 1.28, 0.62, 0.67, LEAD, true], ['taper', 0.1, 0.1, 0.02, 0.02, 0.2, 1.28, 1.02, 0.67, LEAD]);
  for (const x of [1.03, 1.53]) ops.push(['box', 0.11, 0.9, 0.11, x, 0.02, 1.45, LIME], ['taper', 0.11, 0.11, 0, 0, 0.14, x, 0.92, 1.45, LEAD]);
  // New Palace Yard in front of the hall: trees and railings
  ops.push(...tree(0.25, 1.55, 0.8), ...tree(0.65, 1.78, 0.7), ...tree(1.8, 1.8, 0.65), ['box', 1.9, 0.05, 0.015, 0.95, 0.02, 1.94, 'charcoal']);
  // the Royal Gallery along the south (on the river range's end cells), the range north to St Stephen's
  const gal = span(rc(1, 3));
  ops.push(['box', 1.52, 0.7, gal.d, -0.53, 0.02, gal.z, LIME], ['roof', 1.49, 0.16, gal.d, -0.545, 0.72, gal.z, LEAD]);
  ops.push(['box', 0.38, 0.62, lobby.z - lobby.d / 2 - (gal.z + gal.d / 2), 0.62, 0.02, (lobby.z - lobby.d / 2 + gal.z + gal.d / 2) / 2, LIME]);
  // the Victoria Tower: a plain base over the Sovereign's Entrance, the windowed shaft, corner turrets and the flag
  const VX = 0.62, VZ = -1.5;
  ops.push(['box', 0.78, 0.74, 0.78, VX, 0.02, VZ, LIME_DK], ['box', 0.3, 0.42, 0.79, VX, 0.02, VZ, 0x3b3226]);
  ops.push(['box', 0.74, 1.84, 0.74, VX, 0.76, VZ, LIME, 'civic', { name: 'victoria', facade: { storeys: 5, bays: 3, sideBays: 3, margin: 0.1, top: 0.1 } }]);
  ops.push(...[-0.31, 0.31].map((dx): Op => ['box', 0.035, 1.84, 0.02, VX + dx, 0.76, VZ + 0.375, LIME_DK]));
  ops.push(['box', 0.78, 0.06, 0.78, VX, 2.6, VZ, LIME_DK]);
  ops.push(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Op => ['lathe', VX + sx * 0.33, 2.66, VZ + sz * 0.33, LIME, [0.07, 0, 0.07, 0.24, 0.08, 0.25, 0.075, 0.28, 0.02, 0.43, 0, 0.45], { seg: 8 }]));
  ops.push(...pinnacles(3, VX - 0.2, VX + 0.2, VZ + 0.35, 2.66, true, LIME_DK), ...pinnacles(3, VX - 0.2, VX + 0.2, VZ - 0.35, 2.66, true, LIME_DK));
  ops.push(...unionFlag(VX, 2.66, VZ, 0.36));
  // Elizabeth Tower at the north end of the river front, by Westminster Bridge
  ops.push(...elizabethTower());
  return ops;
};

export const parliament: KindDef = {
  id: 'parliament', name: 'the Houses of Parliament', code: Zone.Office, kindId: 96, family: 'office', tier: 6,
  flags: { civic: true, workplace: true }, windows: 'civic', ...landmark,
  occupation: { ...office.occupation!, name: 'parliamentary staff' }, lot: { wage: 16 },
  footprint: { w: 4, h: 4, door: [1, 3] },
  blurb: 'The Palace of Westminster on the Thames: the long Gothic river front, the Victoria Tower, Westminster Hall and Elizabeth Tower, whose clock lights up at night and keeps the city\'s time.',
  howTo: 'A 4×4 block on the river, its door on the street at the clock tower end. A workplace for government staff and the most famous clock in the world. London landmark: unlock rule to be decided.',
  tool: { id: 'bigben', key: '', label: 'Big Ben and Parliament', color: '#b8a06a' },
  levels: [{
    capacity: 260, wage: 30, cost: 24000, upkeep: 120, work: 4200, parking: { surface: 0, underground: 40 },
    designs: [
      { name: 'Gothic river front with the Victoria Tower, Westminster Hall and Elizabeth Tower', height: 3.06, ops: palaceOfWestminster() },
    ],
  }],
};

// ================================================================= 97 the London Eye

/**
 * The wheel (drawn and turned by render/landmarks.ts): its hub at `hubY` over the middle of the plot, in the plane
 * z = `z` near the front; `r` is the rim's radius, capsules ride outside it at `capsuleR`. One turn takes `turnHours`
 * game hours while it runs (`open`, per instance a little earlier or later).
 */
export const LONDON_EYE = { hubY: 2.3, z: 0.95, r: 1.74, capsuleR: 1.83, capsules: 32, turnHours: 3, open: [10, 23] as const };
const EYE = LONDON_EYE;

const eyeOps = (): Op[] => {
  const apexZ = EYE.z - 0.24, legTop = EYE.hubY - 0.04, footZ = apexZ - legTop / Math.tan((65 * Math.PI) / 180);
  return [
    slab(4, 4, PAVING),
    // Jubilee Gardens behind: lawn and trees
    ['box', 3.7, 0.012, 1.3, 0, 0.02, -1.25, 'lawn'],
    ...tree(-1.5, -1.6, 0.8), ...tree(-0.9, -1.05, 0.7), ...tree(0.9, -1.1, 0.8), ...tree(1.55, -1.6, 0.7), ...tree(-0.2, -1.75, 0.6),
    // the A-frame: two white legs from footings on the bank, leaning out over the river to the spindle
    ...[-1, 1].flatMap((s): Op[] => [
      ['box', 0.34, 0.08, 0.34, s * 0.95, 0.02, footZ, 0xb9b6ae],
      ['taper', 0.11, 0.11, 0.07, 0.07, legTop - 0.1, s * 0.95, 0.1, footZ, 0xeef0f2, { shift: [-s * 0.83, apexZ - footZ] }],
    ]),
    // the backstay cables from the apex down to the anchors at the back
    ...[-1, 1].map((s): Op => ['taper', 0.018, 0.018, 0.018, 0.018, legTop - 0.02, s * 0.25, 0.02, -1.85, 0xdfe3e8, { shift: [-s * 0.13, apexZ + 1.85] }]),
    ['box', 0.5, 0.1, 0.3, 0, 0.02, -1.85, 0xb9b6ae],
    // the spindle and hub the wheel turns on
    ['lathe', 0, EYE.hubY, apexZ - 0.06, 0xe8eaec, [0.08, 0, 0.08, EYE.z - apexZ + 0.2], { seg: 12, axis: 'z' }],
    ['lathe', 0, EYE.hubY, EYE.z - 0.1, 0xd4d8dc, [0.15, 0, 0.17, 0.06, 0.17, 0.14, 0.15, 0.2], { seg: 16, axis: 'z' }],
    // the boarding platform the capsules pass along, the ticket kiosks and queue rails
    ['box', 1.5, 0.3, 0.46, 0, 0.02, EYE.z, 0xc9ccd2], ['box', 1.52, 0.02, 0.48, 0, 0.32, EYE.z, 'steel'],
    ['box', 0.26, 0.04, 0.6, -0.9, 0.02, EYE.z + 0.02, 0xc9ccd2],
    ['box', 0.36, 0.18, 0.2, 1.45, 0.02, 0.3, 'glass', 'venue'], ['box', 0.4, 0.03, 0.24, 1.45, 0.2, 0.3, 'navy'],
    ...repeat(4, (i): Op => ['box', 0.012, 0.05, 0.6, -0.55 + i * 0.12, 0.02, 1.6, 'steel']),
    ['box', 0.6, 0.012, 0.012, -0.37, 0.07, 1.3, 'steel'], ['box', 0.6, 0.012, 0.012, -0.37, 0.07, 1.9, 'steel'],
  ];
};

export const londonEye: KindDef = {
  id: 'london-eye', name: 'the London Eye', code: 13, kindId: 97, family: 'leisure', tier: 7,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue', ...landmark,
  footprint: { w: 4, h: 4, door: [2, 3] },
  blurb: 'The giant observation wheel on the South Bank: thirty-two glass capsules turning slowly over the river, lit blue and white at night. Everyone in town wants a ride.',
  howTo: 'A 4×4 plot on the river bank, the wheel towards the street. It turns while it is open and draws visitors from across the city, day and evening. London landmark: unlock rule to be decided.',
  tool: { id: 'londoneye', key: '', label: 'London Eye', color: '#4f86c6' },
  occupation: { ...sports.occupation!, name: 'wheel crew' },
  attrs: {
    ...sports.attrs, venueType: 'sports', openHours: [10, 23], visitorCapacity: 160, ticket: 18, stay: [0.8, 1.4],
    leisureValue: 10, radius: 34, eventNights: [], dayAppeal: 1.2, eveningAppeal: 1.3, retireeAppeal: 0.9, childAppeal: 1.9,
    title: 'London Eye',
  },
  lot: { wage: 16 },
  levels: [{
    capacity: 36, wage: 16, cost: 14000, upkeep: 80, work: 3000, parking: { surface: 0, underground: 0 },
    designs: [
      { name: 'observation wheel on a leaning A-frame over Jubilee Gardens', height: 4.2, ops: eyeOps() },
    ],
  }],
};

// ================================================================= 98 the Tower of London

const RAG = 0xa99f8a, RAG_DK = 0x958b77, CAEN = 0xe9e4d6, LEADC = 0x7c848d;

/** A lead cupola (an ogee dome) with a gilded vane, on a turret top at (x, y, z). */
const cupola = (x: number, y: number, z: number, r: number): Op[] => [
  ['lathe', x, y, z, LEADC, [r, 0, r * 1.12, 0.35 * r, r * 1.02, 0.8 * r, r * 0.6, 1.3 * r, r * 0.18, 1.7 * r, 0, 2.0 * r], { seg: 12 }],
  ['cyl', 0.004, 0.004, 0.07, x, y + 2.0 * r, z, 'gold', 4], ['box', 0.03, 0.02, 0.004, x + 0.012, y + 2.0 * r + 0.045, z, 'gold'],
];

const towerOps = (): Op[] => {
  const ops: Op[] = [slab(4, 3, 'lawn')];
  // the dry moat (grass) round the outer wall, the wharf and the river side at the back
  ops.push(['box', 3.96, 0.014, 0.22, 0, 0.02, -1.37, PAVING]);
  ops.push(...repeat(5, (i): Op => ['cyl', 0.018, 0.022, 0.12, -1.4 + i * 0.7, 0.035, -1.4, 'charcoal', 6]));
  // outer curtain wall with round bastions at the corners
  const OX = 1.66, OZ = 1.08, OH = 0.2;
  ops.push(['box', 2 * OX, OH, 0.06, 0, 0.02, OZ, RAG], ['box', 2 * OX, OH, 0.06, 0, 0.02, -OZ, RAG], ['box', 0.06, OH, 2 * OZ, OX, 0.02, 0, RAG], ['box', 0.06, OH, 2 * OZ, -OX, 0.02, 0, RAG]);
  ops.push(...merlons(24, 2 * OX, 0, 0.02 + OH, OZ, true, 0.06, RAG), ...merlons(24, 2 * OX, 0, 0.02 + OH, -OZ, true, 0.06, RAG));
  ops.push(...merlons(14, 2 * OZ, OX, 0.02 + OH, 0, false, 0.06, RAG), ...merlons(14, 2 * OZ, -OX, 0.02 + OH, 0, false, 0.06, RAG));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ops.push(['cyl', 0.13, 0.14, OH + 0.06, sx * OX, 0.02, sz * OZ, RAG_DK, 12]);
  // St Thomas's Tower over Traitors' Gate on the river side, and the Byward and Middle Towers at the west entrance
  ops.push(['box', 0.56, 0.34, 0.18, -0.35, 0.02, -OZ, RAG_DK], ['box', 0.3, 0.16, 0.19, -0.35, 0.02, -OZ, 0x2a2d33]);
  ops.push(...[-0.55, -0.15].flatMap((x): Op[] => [['cyl', 0.07, 0.07, 0.42, x, 0.02, -OZ - 0.04, RAG_DK, 10], ['cone', 0.08, 0.12, x, 0.44, -OZ - 0.04, LEADC, 10]]));
  ops.push(['box', 0.24, 0.34, 0.3, OX - 0.02, 0.02, -0.72, RAG_DK], ['box', 0.12, 0.16, 0.31, OX - 0.02, 0.02, -0.72, 0x2a2d33]);
  ops.push(['box', 0.24, 0.3, 0.26, OX + 0.18, 0.02, -0.72, RAG], ['box', 0.12, 0.15, 0.27, OX + 0.18, 0.02, -0.72, 0x2a2d33]);
  // inner curtain wall, higher, with its towers: round and square, the Beauchamp Tower on the west
  const IX = 1.3, IZ = 0.78, IH = 0.32;
  ops.push(['box', 2 * IX, IH, 0.07, 0, 0.02, IZ, RAG], ['box', 2 * IX, IH, 0.07, 0, 0.02, -IZ, RAG], ['box', 0.07, IH, 2 * IZ, IX, 0.02, 0, RAG], ['box', 0.07, IH, 2 * IZ, -IX, 0.02, 0, RAG]);
  ops.push(...merlons(20, 2 * IX, 0, 0.02 + IH, IZ, true, 0.07, RAG), ...merlons(20, 2 * IX, 0, 0.02 + IH, -IZ, true, 0.07, RAG));
  ops.push(...merlons(12, 2 * IZ, IX, 0.02 + IH, 0, false, 0.07, RAG), ...merlons(12, 2 * IZ, -IX, 0.02 + IH, 0, false, 0.07, RAG));
  const round: [number, number][] = [[-IX, IZ], [IX, IZ], [-IX, -IZ], [IX, -IZ], [-0.4, IZ], [0.5, -IZ], [-IX, 0]];
  for (const [x, z] of round) ops.push(['cyl', 0.11, 0.12, IH + 0.12, x, 0.02, z, RAG_DK, 12], ...merlons(1, 0.1, x, IH + 0.14, z, true, 0.1, RAG_DK));
  const square: [number, number][] = [[0.45, IZ], [IX, 0], [-0.75, -IZ], [-0.2, -IZ]];
  for (const [x, z] of square) ops.push(['box', 0.22, IH + 0.14, 0.22, x, 0.02, z, RAG_DK], ['box', 0.24, 0.035, 0.24, x, IH + 0.16, z, RAG]);
  // the inner ward: Tower Green, the Waterloo Block (the Crown Jewels), the chapel and the timbered Queen's House
  ops.push(['box', 0.7, 0.012, 0.44, 0.75, 0.02, -0.14, 'lawnDark']);
  ops.push(['box', 0.84, 0.28, 0.2, 0.78, 0.02, 0.5, 0xc8b894, 'civic', { facade: { storeys: 2, bays: 8, sideBays: 1, margin: 0.03 } }], ['roof', 0.84, 0.12, 0.2, 0.78, 0.3, 0.5, 'slate']);
  ops.push(['box', 0.34, 0.2, 0.16, 0.99, 0.02, 0.2, RAG, 'civic'], ['roof', 0.34, 0.1, 0.16, 0.99, 0.22, 0.2, 'slate'], ['box', 0.06, 0.12, 0.06, 0.86, 0.22, 0.2, 'white'], ['cone', 0.05, 0.08, 0.86, 0.34, 0.2, LEADC, 6]);
  ops.push(['box', 0.4, 0.24, 0.16, 0.95, 0.02, -0.62, 0xefe6d2], ['roof', 0.42, 0.12, 0.18, 0.95, 0.26, -0.62, 'slate']);
  ops.push(...repeat(7, (i): Op => ['box', 0.014, 0.24, 0.166, 0.78 + i * 0.058, 0.02, -0.62, 0x3a2e26]), ['box', 0.4, 0.014, 0.166, 0.95, 0.13, -0.62, 0x3a2e26]);
  // the White Tower: the Norman keep of pale stone, battlements and four corner turrets with lead cupolas; windows
  // keep to the middle of each wall, clear of the turrets
  const WX = -0.3, WZ = 0.0, WW = 1.1, WD = 0.94, WH = 0.82;
  ops.push(['box', WW, WH, WD, WX, 0.02, WZ, CAEN, 'civic', { name: 'keep', facade: { storeys: 3, bays: 4, sideBays: 3, margin: 0.14, top: 0.08 } }]);
  ops.push(...merlons(13, WW, WX, 0.02 + WH, WZ + WD / 2 - 0.02, true, 0.04, CAEN), ...merlons(13, WW, WX, 0.02 + WH, WZ - WD / 2 + 0.02, true, 0.04, CAEN));
  ops.push(...merlons(11, WD, WX + WW / 2 - 0.02, 0.02 + WH, WZ, false, 0.04, CAEN), ...merlons(11, WD, WX - WW / 2 + 0.02, 0.02 + WH, WZ, false, 0.04, CAEN));
  ops.push(['roof', WW - 0.12, 0.08, WD - 0.12, WX, 0.02 + WH - 0.04, WZ, LEADC]);
  // three square turrets and the round one (on the front left: north-east, with the river behind)
  const TH = WH + 0.24;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1]]) {
    const x = WX + sx * (WW / 2 - 0.03), z = WZ + sz * (WD / 2 - 0.03);
    ops.push(['box', 0.16, TH, 0.16, x, 0.02, z, CAEN], ['box', 0.18, 0.03, 0.18, x, 0.02 + TH, z, 0xdcd5c4], ...cupola(x, 0.05 + TH, z, 0.085));
  }
  { const x = WX - (WW / 2 - 0.02), z = WZ + (WD / 2 - 0.02); ops.push(['cyl', 0.1, 0.1, TH + 0.04, x, 0.02, z, CAEN, 14], ...cupola(x, 0.06 + TH, z, 0.1)); }
  ops.push(...unionFlag(WX + 0.15, 0.02 + WH, WZ + 0.1, 0.34));
  return ops;
};

export const towerOfLondon: KindDef = {
  id: 'tower-of-london', name: 'the Tower of London', code: library.code, kindId: 98, family: 'leisure', tier: 8,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', ...landmark,
  footprint: { w: 4, h: 3, door: [2, 2] },
  blurb: 'The Norman White Tower with its four lead-capped turrets inside two rings of walls and towers and a grassed moat: the Crown Jewels, the Beefeaters and nine hundred years of history.',
  howTo: 'A 4×3 plot by the river, the gate on the street. A day out that draws families, retirees and visitors from the whole city. London landmark: unlock rule to be decided.',
  tool: { id: 'toweroflondon', key: '', label: 'Tower of London', color: '#8d8573' },
  occupation: { ...library.occupation!, name: 'Yeoman Warder' },
  attrs: {
    ...library.attrs, visitorCapacity: 180, ticket: 22, openHours: [9, 17.5], stay: [2, 3.5], leisureValue: 9, radius: 32,
    dayAppeal: 1.5, eveningAppeal: 0.1, retireeAppeal: 2.2, childAppeal: 1.9, title: 'Tower of London',
  },
  lot: { wage: 17 },
  levels: [{
    capacity: 40, wage: 17, cost: 12000, upkeep: 70, work: 3000, parking: { surface: 0, underground: 20 },
    designs: [
      { name: 'Norman keep with four lead cupolas inside two rings of walls and a grassed moat', height: 1.38, ops: towerOps() },
    ],
  }],
};

// ================================================================= 99 Buckingham Palace

const PORTLAND = 0xe8e3d4, PORTLAND_DK = 0xd3ccb8;

/**
 * The east front on the Mall: 21 bays, its end pavilions and its centre laid on whole bays (EX0 its left end, ECW one
 * bay), so nothing half-hides a window; the rest of the quadrangle stands behind it as one block round a roofed court.
 */
const EX0 = -1.78, EM = 0.05, ECW = (3.56 - 2 * EM) / 21;
const ec = (k0: number, k1: number) => cells(EX0, EM, ECW, k0, k1);

const palaceOps = (): Op[] => {
  const ops: Op[] = [slab(4, 4, 'gravel')];
  // the east front, and the rest of the quadrangle behind it (windows on the garden front and the sides)
  ops.push(['box', 3.56, 0.72, 0.44, 0, 0.02, -0.08, PORTLAND, 'civic', { name: 'east', facade: { storeys: 3, bays: 21, sideBays: 2, margin: EM, top: 0.05 } }]);
  ops.push(['box', 3.6, 0.05, 0.48, 0, 0.74, -0.08, PORTLAND_DK]);
  ops.push(['box', 3.5, 0.74, 1.58, 0, 0.02, -1.11, PORTLAND_DK, 'civic', { name: 'quad', facade: { storeys: 3, bays: 17, sideBays: 8, margin: 0.06, top: 0.05 } }]);
  ops.push(['box', 3.54, 0.04, 1.62, 0, 0.76, -1.11, PORTLAND], ['box', 2.4, 0.012, 0.9, 0, 0.8, -1.05, 0x8d9097], ['box', 2.0, 0.014, 0.6, 0, 0.8, -1.05, 'gravel']);
  // the end pavilions: a little higher, standing forward, windows on their fronts
  for (const [x0, x1] of [[-1.8, ec(0, 3)[1]], [ec(18, 21)[0], 1.8]]) {
    const w = x1 - x0, x = (x0 + x1) / 2;
    ops.push(['box', w, 0.8, 0.485, x, 0.02, -0.0225, PORTLAND, 'civic', { facade: { storeys: 3, bays: 3, sideBays: 0, margin: 0.06, top: 0.1 } }]);
    ops.push(['box', w + 0.04, 0.05, 0.52, x, 0.82, -0.0225, PORTLAND_DK]);
  }
  // the centre: five bays standing forward under a pediment, columns in front and the balcony over the middle three
  const [c0, c1] = ec(8, 13);
  ops.push(['box', c1 - c0, 0.8, 0.505, 0, 0.02, -0.0125, PORTLAND, 'civic', { name: 'centre', facade: { storeys: 3, bays: 5, sideBays: 0, top: 0.1, ground: 'plain' } }]);
  ops.push(['balcony', 'centre', 'front', 1, 1, 3, 'charcoal', PORTLAND_DK]);
  ops.push(...repeat(3, (i): Op => ['box', 0.1, 0.16, 0.012, (i - 1) * ((c1 - c0) / 5), 0.02, 0.246, 0x3a3630]));
  ops.push(...repeat(6, (i): Op => ['cyl', 0.02, 0.022, 0.46, -0.36 + i * 0.144, 0.3, 0.3, PORTLAND, 8]));
  ops.push(['box', 0.84, 0.06, 0.12, 0, 0.76, 0.27, PORTLAND_DK], ['roof', 0.84, 0.16, 0.12, 0, 0.82, 0.27, PORTLAND, true]);
  // the balustrade's urns, and the flag over the centre (the Royal Standard: the monarch is in)
  ops.push(...repeat(9, (i): Op => ['cyl', 0.018, 0.022, 0.06, -1.6 + i * 0.4, 0.79, 0.1, PORTLAND, 6]));
  ops.push(['cyl', 0.007, 0.01, 0.36, 0, 0.85, -0.1, 'steel', 4]);
  ops.push(['box', 0.08, 0.05, 0.008, 0.045, 1.11, -0.1, 'red'], ['box', 0.08, 0.05, 0.008, 0.125, 1.16, -0.1, 'red'], ['box', 0.08, 0.05, 0.008, 0.045, 1.16, -0.1, 'gold'], ['box', 0.08, 0.05, 0.008, 0.125, 1.11, -0.1, 'navy']);
  // the forecourt: railings, gilded gates and the guardsmen in red with bearskins at their sentry boxes
  ops.push(['box', 3.7, 0.008, 0.66, 0, 0.02, 0.6, 'gravel']);
  ops.push(['box', 3.8, 0.012, 0.012, 0, 0.13, 0.94, 'charcoal'], ['box', 3.8, 0.012, 0.012, 0, 0.05, 0.94, 'charcoal']);
  ops.push(...repeat(25, (i): Op => ['box', 0.012, 0.16, 0.012, -1.86 + i * 0.155, 0.02, 0.94, 'charcoal']));
  for (const x of [-1.86, -0.62, 0.62, 1.86]) ops.push(['box', 0.07, 0.24, 0.07, x, 0.02, 0.94, PORTLAND], ['box', 0.05, 0.04, 0.05, x, 0.26, 0.94, 'gold']);
  for (const x of [-0.25, 0.25]) ops.push(['box', 0.36, 0.2, 0.02, x, 0.02, 0.94, 0x2b2e36], ['box', 0.3, 0.03, 0.025, x, 0.18, 0.94, 'gold']);
  for (const x of [-0.9, 0.9]) {
    ops.push(['box', 0.08, 0.16, 0.08, x, 0.02, 0.62, 0x2b2e36], ['roof', 0.09, 0.04, 0.09, x, 0.18, 0.62, 0x2b2e36]);
    ops.push(['box', 0.03, 0.055, 0.025, x + 0.09, 0.025, 0.66, 0x22252c], ['box', 0.035, 0.05, 0.028, x + 0.09, 0.08, 0.66, 'crossRed'], ['cyl', 0.017, 0.017, 0.045, x + 0.09, 0.13, 0.66, 0x111111, 6]);
  }
  // the Victoria Memorial in front: flower beds, white marble steps and pylon, the seated Queen and the gilded Victory
  const MZ = 1.42;
  ops.push(['cyl', 0.55, 0.55, 0.012, 0, 0.02, MZ, 'lawn', 24], ['cyl', 0.5, 0.5, 0.016, 0, 0.02, MZ, 0xc8323a, 24], ['cyl', 0.44, 0.44, 0.02, 0, 0.02, MZ, 'lawn', 24]);
  ops.push(['cyl', 0.36, 0.38, 0.04, 0, 0.03, MZ, 0xf3f0ea, 20], ['cyl', 0.3, 0.32, 0.04, 0, 0.07, MZ, 0xf3f0ea, 20]);
  ops.push(['cyl', 0.07, 0.07, 0.03, -0.27, 0.11, MZ, 'pond', 10], ['cyl', 0.07, 0.07, 0.03, 0.27, 0.11, MZ, 'pond', 10]);
  ops.push(['box', 0.24, 0.16, 0.24, 0, 0.11, MZ, 0xf3f0ea], ['taper', 0.16, 0.16, 0.08, 0.08, 0.36, 0, 0.27, MZ, 0xf6f3ee]);
  ops.push(['box', 0.07, 0.07, 0.05, 0, 0.17, MZ + 0.14, 0xf6f3ee], ['box', 0.05, 0.05, 0.04, 0, 0.24, MZ + 0.14, 0xeae6de]);
  ops.push(['cyl', 0.035, 0.028, 0.03, 0, 0.63, MZ, 'gold', 8], ['cone', 0.022, 0.09, 0, 0.66, MZ, 'gold', 8], ['cyl', 0.012, 0.012, 0.02, 0, 0.75, MZ, 'gold', 6]);
  ops.push(['taper', 0.012, 0.03, 0.09, 0.012, 0.07, 0, 0.69, MZ - 0.01, 'gold']);
  ops.push(...tree(-1.75, 1.75, 0.8), ...tree(1.75, 1.75, 0.8), ...tree(-1.75, 1.15, 0.7), ...tree(1.75, 1.15, 0.7));
  return ops;
};

export const buckinghamPalace: KindDef = {
  id: 'buckingham-palace', name: 'Buckingham Palace', code: library.code, kindId: 99, family: 'leisure', tier: 9,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', ...landmark,
  footprint: { w: 4, h: 4, door: [2, 3] },
  blurb: 'The monarch\'s London home: the pale stone east front and its balcony, the forecourt and the guards, and the gilded Victoria Memorial at the end of the Mall. The state rooms open to visitors.',
  howTo: 'A 4×4 block at the end of a long avenue, the front and the memorial towards the street. Tours of the state rooms draw visitors by day. London landmark: unlock rule to be decided.',
  tool: { id: 'buckingham', key: '', label: 'Buckingham Palace', color: '#c9b37a' },
  occupation: { ...library.occupation!, name: 'royal household staff' },
  attrs: {
    ...library.attrs, visitorCapacity: 150, ticket: 30, openHours: [9.5, 17.5], stay: [1.5, 2.5], leisureValue: 9, radius: 30,
    dayAppeal: 1.4, eveningAppeal: 0.05, retireeAppeal: 2.4, childAppeal: 1.3, title: 'Buckingham Palace',
  },
  lot: { wage: 18 },
  levels: [{
    capacity: 60, wage: 18, cost: 20000, upkeep: 110, work: 3600, parking: { surface: 0, underground: 20 },
    designs: [
      { name: 'Portland stone east front with a portico and balcony, the forecourt and the Victoria Memorial', height: 1.21, ops: palaceOps() },
    ],
  }],
};

/** The second five, in kind-id order (landmarks-london.ts appends them to LONDON_LANDMARKS). */
export const LONDON_LANDMARKS_B: KindDef[] = [parliament, londonEye, towerOfLondon, buckinghamPalace];
