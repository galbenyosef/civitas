import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { office } from './office';
import { slab, car, carRow, bayLines, van, tree, helipad, fence, PAVING } from './tierkit';

/**
 * The media centre ladder (docs/media.md N1): a local TV studio, a broadcast centre and a media centre with a news
 * helipad, the city's broadcasters. One building line serves the news (shared/src/news.ts, server/src/sim/news.ts) and,
 * later, adverts' TV airtime (docs/adverts.md section 9: the media centre IS its TV studio). They are placed civic
 * sub-kinds of the office family (code 4, kind ids 130-132), like the London towers: they employ office-track
 * graduates (`skill`), pay upkeep and never grow or burn.
 *
 * The attributes the game reads: `newsRadius`, the tiles (square, from the door) a channel covers, 0 for the whole map
 * (shared/src/news.ts `channelReach`); `newsTier`, which channel wins a story two players' centres both reach; and
 * `newsHelicopters`, the news helicopters based on the roof pad (N3 flies them; the pad is a PadKind 'news',
 * shared/src/helipads.ts).
 *
 * Per-instance variation: two designs per rung, the facade tints picked per tile, and the lights. Mast and roof-corner
 * beacons use the `beacon` window class (each blinks on its own period and phase per building and per light) and the
 * logos and screens the `sign` class (lit from a dusk time of their own per building, render/materials.ts).
 */

/**
 * A satellite dish of radius r standing at (x, y, z): a pedestal and a bowl. `face` is where the bowl looks: up at
 * the sky, or out towards the front (+z), the right (+x) or the back (-z), so no two dish fields look alike.
 */
const dish = (x: number, y: number, z: number, r: number, face: 'up' | 'front' | 'right' | 'back', color: Color = 'white'): Op[] => {
  const bowl = [r * 0.14, 0, r * 0.62, r * 0.2, r, r * 0.34];
  if (face === 'up') return [
    ['cyl', r * 0.12, r * 0.22, r * 0.45, x, y, z, 'steel', 6],
    ['lathe', x, y + r * 0.45, z, color, bowl, { seg: 14 }],
  ];
  const cy = y + r * 1.05;
  return [
    ['cyl', r * 0.1, r * 0.2, r * 1.05, x, y, z, 'steel', 6],
    face === 'right' ? ['lathe', x - r * 0.12, cy, z, color, bowl, { seg: 14, axis: 'x' }]
      : face === 'front' ? ['lathe', x, cy, z - r * 0.12, color, bowl, { seg: 14, axis: 'z' }]
        : ['lathe', x, cy, z - r * 0.22, color, [r, 0, r * 0.62, r * 0.14, r * 0.14, r * 0.34], { seg: 14, axis: 'z' }],
    ['cyl', 0.006, 0.006, r * 0.5, x, cy, z, 'charcoal', 4], // the feed arm
  ];
};
/** A lattice broadcast mast of height h with cross arms, a beacon at the tip and, on a tall one, another half way. */
const beaconMast = (x: number, y: number, z: number, h: number): Op[] => [
  ['cyl', 0.008, 0.024, h, x, y, z, 'steel', 5],
  ['box', 0.14, 0.012, 0.012, x, y + h * 0.45, z, 'steel'], ['box', 0.1, 0.012, 0.012, x, y + h * 0.7, z, 'steel'], ['box', 0.012, 0.012, 0.08, x, y + h * 0.85, z, 'steel'],
  ['box', 0.03, 0.03, 0.03, x, y + h, z, 'red', 'beacon'],
  ...(h > 0.7 ? [['box', 0.024, 0.024, 0.024, x, y + h * 0.5, z + 0.016, 'red', 'beacon'] as Op] : []),
];
/** Small beacons on the corners of a roof (w × d centred at x, z, standing at y). */
const roofBeacons = (x: number, y: number, z: number, w: number, d: number): Op[] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]): Op => ['box', 0.025, 0.03, 0.025, x + i * (w / 2 - 0.03), y, z + j * (d / 2 - 0.03), 'red', 'beacon']);
/** A lit logo board standing on a roof or a drum, facing the road: a dark frame and the glowing panel in front. */
const logo = (x: number, y: number, z: number, w: number, h: number, color: Color): Op[] => [
  ['box', w + 0.02, h + 0.02, 0.02, x, y, z, 'charcoal'],
  ['box', w, h, 0.012, x, y + 0.01, z + 0.016, color, 'sign'],
];
/** A big outdoor screen on two legs: the frame, the lit picture and a strip of the station colour under it. */
const bigScreen = (x: number, y: number, z: number, w: number, h: number, legs: number, band: Color): Op[] => [
  ...[-1, 1].map((k): Op => ['box', 0.03, legs + h * 0.6, 0.03, x + k * w * 0.36, y, z - 0.03, 'charcoal']),
  ['box', w + 0.04, h + 0.04, 0.04, x, y + legs, z, 0x1a1d24],
  ['box', w, h * 0.82, 0.012, x, y + legs + 0.02 + h * 0.16, z + 0.026, 0x4a86d8, 'sign'],
  ['box', w, h * 0.14, 0.012, x, y + legs + 0.02, z + 0.026, band, 'sign'],
];
/** An outside-broadcast van: white with the station's stripe and a folded dish on the roof. */
const obVan = (x: number, z: number, stripe: Color, alongX = false): Op[] => [
  ...van(x, z, 'white', stripe, alongX),
  ['cyl', 0.035, 0.03, 0.012, x, 0.12, z, 'silver', 10],
];

/** Who works at a broadcaster: newsroom and studio crews round the clock in shifts, with the evening bulletin the busiest. */
const OCCUPATION = {
  name: 'broadcast staff', rotate: true,
  shifts: [{ start: 6, hours: 8, weight: 0.3 }, { start: 9, hours: 8, weight: 0.35 }, { start: 14, hours: 9, weight: 0.3 }, { start: 22, hours: 8, weight: 0.05 }],
  cycles: [[1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 0, 0, 1, 1], [0, 0, 1, 1, 1, 1, 1]],
};
const base = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: OCCUPATION, lot: { wage: office.lot?.wage ?? 14 }, group: 'media',
  tints: [0xffffff, 0xeef3fa, 0xf6f1ea, 0xeaf1f0, 0xf3eef6],
};

// ================================================================= tier 1: the local TV studio

export const tvStudio: KindDef = {
  ...base, id: 'tv-studio', name: 'local TV studio', kindId: 130, tier: 1,
  blurb: 'A local radio and television studio: a newsroom, a small sound stage and a mast. It reports the news of its own town and, later, sells TV airtime to advertisers.',
  howTo: 'One tile beside a road. Its channel covers 24 tiles round it, about a town; a rival player\'s channel that reaches the same streets competes for the stories. Needs Local television.',
  tool: { id: 'tvstudio', key: '', label: 'TV studio', color: '#c8463c' },
  attrs: { newsRadius: 24, newsTier: 1, newsHelicopters: 0, skill: [4, 0.4] },
  levels: [{
    capacity: 14, wage: 22, cost: 900, upkeep: 35, work: 260, parking: { surface: 3, underground: 6 },
    designs: [
      { name: 'brick newsroom with a sound stage behind and a lattice mast', height: 0.98, ops: [
        slab(1, 1, PAVING),
        ['box', 0.5, 0.42, 0.34, -0.12, 0.02, 0.06, 'brick', true, { name: 'newsroom', facade: { storeys: 2, bays: 3, sideBays: 2 } }],
        ['door', 'newsroom', 'front', 1],
        ['cornice', 'newsroom', 2, 'charcoal'],
        ['box', 0.62, 0.3, 0.28, 0, 0.02, -0.31, 0x5d6470], ['box', 0.64, 0.025, 0.3, 0, 0.32, -0.31, 'dark'],
        ...beaconMast(0.2, 0.345, -0.31, 0.62),
        ...dish(-0.25, 0.47, 0.1, 0.07, 'front'),
        ...logo(-0.04, 0.47, 0.17, 0.16, 0.07, 'red'),
        ...obVan(0.31, 0.06, 'red'),
        ...tree(-0.4, 0.38, 0.6),
      ] },
      { name: 'white single-storey studio with a roof dish farm and a tall mast', height: 1.0, ops: [
        slab(1, 1, PAVING),
        ['box', 0.76, 0.3, 0.5, 0, 0.02, -0.12, 'white', true, { name: 'studio', facade: { storeys: 1, bays: 4, sideBays: 2, ground: 'door' } }],
        ['box', 0.8, 0.03, 0.54, 0, 0.32, -0.12, 'charcoal'],
        ...dish(-0.22, 0.35, -0.22, 0.08, 'up'), ...dish(0.02, 0.35, -0.26, 0.065, 'right'),
        ...beaconMast(0.27, 0.35, -0.26, 0.62),
        ...logo(-0.1, 0.35, 0.06, 0.3, 0.07, 0x2f8fd6),
        ...car(-0.28, 0.33, 'navy', true), ...car(0.25, 0.33, 'silver', true),
      ] },
    ],
  }],
};

// ================================================================= tier 2: the broadcast centre

export const broadcastCentre: KindDef = {
  ...base, id: 'broadcast-centre', name: 'broadcast centre', kindId: 131, tier: 2,
  footprint: { w: 2, h: 2, door: [0, 1], marks: [{ kind: 'stand', at: [1, 0], label: 'satellite dishes' }] },
  blurb: 'A regional broadcast centre: live studios, a satellite dish yard and a lit logo. Its channel covers a whole district, and its outside-broadcast vans go out to the stories.',
  howTo: 'Two tiles by two, entrance on the left of the frontage. Covers 48 tiles round it. Needs Broadcasting.',
  tool: { id: 'broadcast', key: '', label: 'Broadcast centre', color: '#b13a5a' },
  attrs: { newsRadius: 48, newsTier: 2, newsHelicopters: 0, skill: [4, 0.5] },
  levels: [{
    capacity: 40, wage: 26, cost: 3000, upkeep: 90, work: 900, parking: { surface: 10, underground: 24 },
    designs: [
      { name: 'glass studio block, sound stages behind, a dish yard and a lattice mast', height: 1.48, ops: [
        slab(2, 2, PAVING),
        ['box', 1.3, 0.62, 0.8, -0.3, 0.02, 0.35, 'glass', true, { name: 'front', facade: { storeys: 3, bays: 7, sideBays: 4, ground: 'door' } }],
        ['cornice', 'front', 3, 'red'],
        ['box', 1.3, 0.5, 0.7, -0.3, 0.02, -0.55, 0x5d6470], ['box', 1.32, 0.03, 0.72, -0.3, 0.52, -0.55, 'dark'],
        ...beaconMast(-0.75, 0.55, -0.6, 0.92),
        ...logo(-0.3, 0.64, 0.5, 0.5, 0.12, 'red'),
        ['box', 0.6, 0.004, 1.0, 0.65, 0.02, -0.42, 'gravel'],
        ...dish(0.55, 0.024, -0.72, 0.15, 'up'), ...dish(0.8, 0.024, -0.3, 0.12, 'front'), ...dish(0.52, 0.024, -0.12, 0.09, 'right'),
        ...fence(0.97, -0.42, 1.0, false), ...fence(0.65, -0.93, 0.6, true),
        ...obVan(0.62, 0.62, 'red'), ...obVan(0.84, 0.62, 'red'),
        ...tree(-0.88, 0.88, 0.7),
      ] },
      { name: 'stone broadcasting house with a round studio drum and a row of roof dishes', height: 1.33, ops: [
        slab(2, 2, PAVING),
        ['box', 1.6, 0.48, 0.7, 0, 0.02, -0.5, 'stone', true, { name: 'house', facade: { storeys: 2, bays: 8, sideBays: 3 } }],
        ['door', 'house', 'front', 4],
        ['cornice', 'house', 2, 'charcoal'],
        ['cyl', 0.38, 0.38, 0.42, -0.45, 0.02, 0.35, 0x8a9099, 18], ['cyl', 0.4, 0.4, 0.03, -0.45, 0.44, 0.35, 'charcoal', 18],
        ...logo(-0.45, 0.47, 0.5, 0.34, 0.1, 0xd8b25a),
        ...dish(0.2, 0.53, -0.5, 0.1, 'up'), ...dish(0.45, 0.53, -0.55, 0.09, 'front'), ...dish(0.68, 0.53, -0.48, 0.1, 'up'),
        ...beaconMast(-0.6, 0.53, -0.6, 0.8),
        ...obVan(0.48, 0.45, 'navy'), ...bayLines(0.12, 0.86, 4, 0.18, 0.24), ...carRow(0.21, 0.86, 4, 0.18, false, 0.02, 2),
        ...tree(0.86, 0.3, 0.7),
      ] },
    ],
  }],
};

// ================================================================= tier 3: the media centre with the news helipad

export const mediaCentre: KindDef = {
  ...base, id: 'media-centre', name: 'media centre', kindId: 132, tier: 3,
  footprint: { w: 3, h: 2, door: [1, 1], marks: [{ kind: 'stand', at: [0, 0], label: 'news helipad' }, { kind: 'stand', at: [2, 0], label: 'dish array' }] },
  blurb: 'A national media centre: a tower with the news helicopter on its roof, a big screen, a satellite dish array and studios for every channel. Its channel reaches the whole map.',
  howTo: 'Three tiles across and two deep, entrance in the middle of the frontage. Covers the whole map, so rival channels compete with it everywhere. Needs Media centres.',
  tool: { id: 'mediacentre', key: '', label: 'Media centre', color: '#8e2f6e' },
  attrs: { newsRadius: 0, newsTier: 3, newsHelicopters: 1, skill: [4, 0.6] },
  levels: [{
    capacity: 90, wage: 30, cost: 7500, upkeep: 200, work: 2000, parking: { surface: 20, underground: 60 },
    designs: [
      { name: 'glass tower with the news helipad on its roof, a big screen and a dish array', height: 1.7, ops: [
        slab(3, 2, PAVING),
        ['box', 2.6, 0.5, 1.0, -0.1, 0.02, 0.35, 'glassDark', true, { name: 'podium', facade: { storeys: 2, bays: 12, sideBays: 5, ground: 'door' } }],
        ['cornice', 'podium', 2, 'silver'],
        ['box', 0.9, 1.6, 0.76, -0.85, 0.02, -0.58, 'glass', true, { name: 'tower', facade: { storeys: 7, bays: 5, sideBays: 4 } }],
        ['box', 0.92, 0.03, 0.78, -0.85, 1.62, -0.58, 'charcoal'],
        ...helipad(-0.85, 1.65, -0.58, 0.3),
        ...roofBeacons(-0.85, 1.65, -0.58, 0.9, 0.76),
        ...bigScreen(-0.05, 0.55, -0.02, 0.6, 0.32, 0.06, 0x8e2f6e),
        ...dish(0.45, 0.55, 0.35, 0.11, 'up'), ...dish(0.72, 0.55, 0.42, 0.09, 'front'), ...dish(0.98, 0.55, 0.3, 0.12, 'up'),
        ...beaconMast(1.02, 0.55, 0.68, 0.95),
        ['box', 1.36, 0.004, 0.72, 0.72, 0.02, -0.6, 'gravel'],
        ...dish(0.3, 0.024, -0.62, 0.2, 'up'), ...dish(0.78, 0.024, -0.6, 0.18, 'front'), ...dish(1.2, 0.024, -0.66, 0.15, 'right'),
        ...fence(0.72, -0.97, 1.36, true),
        ...obVan(1.38, 0.62, 0x8e2f6e), ...obVan(1.38, 0.28, 0x8e2f6e),
        ...tree(-1.42, -0.55, 0.55),
      ] },
      { name: 'stepped broadcast centre with a glass newsroom drum carrying the helipad, a forecourt screen and dish terraces', height: 1.6, ops: [
        slab(3, 2, PAVING),
        ['box', 2.8, 0.7, 0.7, 0, 0.02, -0.6, 'stone', true, { name: 'block', facade: { storeys: 3, bays: 14, sideBays: 3 } }],
        ['cornice', 'block', 3, 'red'],
        ['cyl', 0.55, 0.55, 0.9, 0.8, 0.02, 0.35, 'glass', 20], ['cyl', 0.57, 0.57, 0.03, 0.8, 0.92, 0.35, 'charcoal', 20],
        ...helipad(0.8, 0.95, 0.35, 0.3),
        ...roofBeacons(0.8, 0.95, 0.35, 0.8, 0.8),
        ...logo(-0.55, 0.75, -0.32, 0.8, 0.14, 'red'),
        ...[0, 1, 2, 3].flatMap((i) => dish(-1.2 + i * 0.32, 0.75, -0.72, 0.1 + 0.02 * (i % 2), (['up', 'front', 'up', 'right'] as const)[i])),
        ...beaconMast(1.25, 0.75, -0.7, 0.85),
        ...bigScreen(-0.75, 0.02, 0.5, 0.7, 0.38, 0.2, 'red'),
        ...obVan(-0.1, 0.55, 'red'), ...obVan(0.1, 0.6, 'red'),
        ...bayLines(-1.42, 0.86, 3, 0.18, 0.24), ...carRow(-1.33, 0.86, 3, 0.18, false, 0.02, 1),
        ...tree(1.38, 0.88, 0.6), ...tree(1.38, -0.05, 0.55),
      ] },
    ],
  }],
};

export const MEDIA: KindDef[] = [tvStudio, broadcastCentre, mediaCentre];
