import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { office } from './office';
import { sports, library } from './leisure';
import { slab, tree, pine, lampPost, flags, PAVING } from './tierkit';

/**
 * Shanghai landmarks (docs/buildings.md "Landmarks"): recognisable real buildings of the Lujiazui skyline and the old
 * city, tagged 'world' and 'shanghai', rungs of the 'shanghai' collection (groups.ts), tiers 1-5, their tools unlocked
 * only by a locked tech node like the London and New York landmarks. Kind ids 172-176 (see landmarks-world.ts for the
 * world allocation). Scale: about 33 m to a tile, as for London and New York.
 *
 * The set, in tier order:
 *   172 the Oriental Pearl Tower: a sports-family venue like the London Eye, the tower of spheres over the promenade
 *   173 the Shanghai Tower: an office tower, the twisting glass spiral
 *   174 the Jin Mao Tower: an office tower, the pagoda-inspired stainless setbacks
 *   175 the Shanghai World Financial Center: an office tower, the bottle-opener with its slot at the top
 *   176 the Yu Garden: a library-family daytime attraction, the pavilions, zigzag bridge and pond of the old garden
 */

const TAGS = ['world', 'shanghai'];
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'shanghai',
};

// ================================================================= 172 the Oriental Pearl Tower

/**
 * The tower of spheres on the Lujiazui promenade: a low ticket hall, a drum and three great slanted columns carrying
 * the shaft, and up it the three pink pearls - the big lower pearl, the middle one, the small top sphere - with red
 * collars at their throats and the mast and beacon over all. Observation runs by day and evening. The door is on the
 * street front under the porch; lamps and red-and-gold flags line the pavement.
 */
const PEARL = 0xe0879c, PEARL_BASE = 0xd9d4cc;

const pearlOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the ticket hall: a low windowed box, the door on the street front
  ops.push(['box', 2.0, 0.45, 2.0, 0, 0.02, 0, PEARL_BASE, true, { name: 'hall', facade: { storeys: 2, bays: 8, margin: 0.08, ground: 'plain', top: 0.1 } }]);
  ops.push(['door', 'hall', 'front', 4], ['porch', 'hall', 'front', 3, 5, 'slate']);
  // the drum under the shaft, and the three great slanted columns up to the lower pearl
  ops.push(['cyl', 0.68, 0.72, 0.2, 0, 0.47, 0, 'stone', 20]);
  for (const [sx, sz] of [[1, 0], [-0.5, 0.866], [-0.5, -0.866]] as const) {
    ops.push(['taper', 0.18, 0.18, 0.11, 0.11, 0.55, sx * 0.5, 0.67, sz * 0.5, 'stone', { shift: [-sx * 0.32, -sz * 0.32] }]);
  }
  // the shaft: concrete, slightly tapering, from the drum through the pearls to the top sphere
  ops.push(['cyl', 0.12, 0.18, 3.3, 0, 0.67, 0, 'stone', 14]);
  // the lower pearl, the biggest, with its red collar
  ops.push(['lathe', 0, 1.2, 0, PEARL, [0, 0, 0.38, 0.07, 0.52, 0.2, 0.56, 0.35, 0.48, 0.5, 0.3, 0.62, 0, 0.72], { seg: 20 }]);
  ops.push(['cyl', 0.2, 0.24, 0.07, 0, 1.13, 0, 'red', 12]);
  // the middle pearl
  ops.push(['lathe', 0, 2.62, 0, PEARL, [0, 0, 0.2, 0.04, 0.28, 0.12, 0.3, 0.25, 0.26, 0.36, 0.13, 0.44, 0, 0.5], { seg: 20 }]);
  ops.push(['cyl', 0.17, 0.2, 0.06, 0, 2.56, 0, 'red', 12]);
  // the top sphere
  ops.push(['lathe', 0, 3.94, 0, PEARL, [0, 0, 0.16, 0.04, 0.23, 0.12, 0.24, 0.2, 0.2, 0.28, 0.12, 0.35, 0, 0.4], { seg: 20 }]);
  ops.push(['cyl', 0.14, 0.17, 0.06, 0, 3.88, 0, 'red', 12]);
  // the mast stages and the aircraft beacon
  ops.push(['cyl', 0.05, 0.08, 1.1, 0, 4.34, 0, 'steel', 8]);
  ops.push(['cyl', 0.012, 0.025, 0.6, 0, 5.44, 0, 'steel', 6]);
  ops.push(['cyl', 0.035, 0.035, 0.06, 0, 6.04, 0, 'red', 6]);
  // the pavement: lamps and red-and-gold flags along the promenade, trees behind
  ops.push(...lampPost(-0.8, 1.35, 0.36, 'marquee', 0.02), ...lampPost(0.8, 1.35, 0.36, 'marquee', 0.02));
  ops.push(...flags(-1.0, 1.42, 5, 0.5, ['red', 'yellow']));
  ops.push(...tree(-1.28, -1.28, 0.7), ...tree(1.28, -1.28, 0.7));
  return ops;
};

export const orientalPearl: KindDef = {
  id: 'oriental-pearl', name: 'the Oriental Pearl Tower', kindId: 172, tier: 1,
  code: 13, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue',
  landmark: true, tags: TAGS, group: 'shanghai',
  occupation: { ...sports.occupation!, name: 'pearl tower crew' },
  attrs: {
    ...sports.attrs, venueType: 'sports', openHours: [9, 22], visitorCapacity: 140, ticket: 16, stay: [0.8, 1.4],
    leisureValue: 10, radius: 32, eventNights: [], dayAppeal: 1.2, eveningAppeal: 1.3, retireeAppeal: 0.9, childAppeal: 1.9,
    title: 'Oriental Pearl Tower',
  },
  lot: { wage: 16 },
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The tower of spheres over the Lujiazui promenade: three pink pearls on a tapering shaft, glowing red and gold at night, with observation decks running from morning to late evening.',
  howTo: 'A 3×3 plot by the water or a main avenue; it draws visitors from across the city, day and evening, so give it a station or buses and leave the street in front clear. World landmark: unlock rule to be decided.',
  tool: { id: 'orientalpearl', key: '', label: 'Oriental Pearl Tower', color: '#d97f92' },
  levels: [{
    capacity: 32, wage: 16, cost: 15000, upkeep: 80, work: 3200, parking: { surface: 0, underground: 40 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'three pink pearls on a tapering shaft over slanted columns, the mast and beacon above', height: 6.1, ops: pearlOps() },
    ],
  }],
};

// ================================================================= 173 the Shanghai Tower

/**
 * The twisting glass spiral of Lujiazui: six shrinking glass tiers, each one shifted a little at the top so the
 * silhouette turns as it climbs - northeast, northwest, southwest, southeast - to the glass crown, mast and beacon.
 * The door and porch are on the street front of the lobby base.
 */
const GLASS_A = 0x9cc3d4, GLASS_B = 0x86b0c4, LOBBY = 0xb9c4cc;

const shanghaiTowerOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the lobby: a low glass base, the door on the street front
  ops.push(['box', 2.4, 0.4, 2.4, 0, 0.02, 0, LOBBY, true, { name: 'lobby', facade: { storeys: 3, bays: 9, margin: 0.1, ground: 'door', top: 0.1 } }]);
  ops.push(['porch', 'lobby', 'front', 4, 6, 'slate']);
  // the spiral: six shrinking tiers, each top shifted a step round so the shaft appears to twist
  const tiers: [number, number, number, number, [number, number]][] = [
    [2.0, 1.9, 1.2, 0.42, [0.04, 0.04]],
    [1.86, 1.76, 1.2, 1.62, [-0.04, 0.04]],
    [1.72, 1.62, 1.2, 2.82, [-0.04, -0.04]],
    [1.58, 1.48, 1.2, 4.02, [0.04, -0.04]],
    [1.4, 1.3, 1.15, 5.22, [0.05, 0.05]],
    [1.3, 1.2, 1.1, 6.37, [-0.05, 0.05]],
  ];
  tiers.forEach(([w0, w1, h, y, shift], i) => {
    ops.push(['taper', w0, w0, w1, w1, h, 0, y, 0, i % 3 === 2 ? GLASS_B : GLASS_A, { win: 'office', shift }]);
  });
  // the crown tapering to the mast and beacon
  ops.push(['taper', 1.1, 1.1, 0.26, 0.26, 0.7, 0, 7.47, 0, GLASS_A, { win: 'office', shift: [0.03, 0.03] }]);
  ops.push(['cyl', 0.02, 0.02, 0.3, 0, 8.17, 0, 'steel', 6]);
  ops.push(['cyl', 0.035, 0.035, 0.06, 0, 8.47, 0, 'red', 6]);
  // the pavement: street lamps and a pair of trees
  ops.push(...lampPost(-1.0, 1.35, 0.36, 'marquee', 0.02), ...lampPost(1.0, 1.35, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.28, -1.28, 0.7), ...tree(1.28, -1.28, 0.7));
  return ops;
};

export const shanghaiTower: KindDef = {
  ...towerBase, id: 'shanghai-tower', name: 'the Shanghai Tower', kindId: 173, tier: 2,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The twisting glass spiral of Lujiazui: the tallest building in China, its shrinking tiers turning a little with every floor so the shaft winds up into the sky.',
  howTo: 'A 3×3 plot among offices; it holds the most jobs of any building, so give it rail or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'shanghaitower', key: '', label: 'Shanghai Tower', color: '#7fb3c4' },
  levels: [{
    capacity: 450, wage: 48, cost: 30000, upkeep: 160, work: 5400, parking: { surface: 0, underground: 90 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'six shrinking glass tiers stepped round so the shaft twists, a crown, mast and beacon', height: 8.53, ops: shanghaiTowerOps() },
    ],
  }],
};

// ================================================================= 174 the Jin Mao Tower

/**
 * The pagoda-inspired stainless setbacks: five tiers of steel glass, each inset from the one below so no wall ever
 * half-hides another's windows, with silver cornice bands at every setback line. The crown is a lathe of four flaring
 * eaves - the neon pagoda spire - with a mast and beacon above. The door and porch are on the street front.
 */
const STEEL_A = 0xc9cfd6, STEEL_B = 0xb4bcc6;

const jinmaoOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the five setback tiers, each inset from the one below
  ops.push(['box', 2.2, 0.4, 2.2, 0, 0.02, 0, STEEL_A, true, { name: 'base', facade: { storeys: 3, bays: 8, margin: 0.08, ground: 'door', top: 0.1 } }]);
  ops.push(['box', 1.9, 1.6, 1.9, 0, 0.42, 0, STEEL_A, true, { name: 't1', facade: { storeys: 12, bays: 7, margin: 0.08 } }]);
  ops.push(['box', 1.6, 1.4, 1.6, 0, 2.02, 0, STEEL_A, true, { name: 't2', facade: { storeys: 10, bays: 6, margin: 0.08 } }]);
  ops.push(['box', 1.3, 1.2, 1.3, 0, 3.42, 0, STEEL_B, true, { name: 't3', facade: { storeys: 9, bays: 5, margin: 0.06 } }]);
  ops.push(['box', 1.0, 0.9, 1.0, 0, 4.62, 0, STEEL_B, true, { name: 't4', facade: { storeys: 6, bays: 4, margin: 0.06 } }]);
  // silver cornice bands at each setback line
  ops.push(['cornice', 'base', 3, 'silver'], ['cornice', 't1', 12, 'silver'], ['cornice', 't2', 10, 'silver'], ['cornice', 't3', 9, 'silver']);
  ops.push(['porch', 'base', 'front', 3, 6, 'slate']);
  // the pagoda crown: four flaring eaves stepping in, then the mast and beacon
  ops.push(['lathe', 0, 5.52, 0, 0x9fb0be, [0.44, 0, 0.54, 0.05, 0.38, 0.12, 0.46, 0.19, 0.3, 0.28, 0.38, 0.35, 0.22, 0.43, 0.28, 0.5, 0.13, 0.56, 0.06, 0.6, 0, 0.72], { seg: 16 }]);
  ops.push(['cyl', 0.03, 0.06, 0.5, 0, 6.24, 0, 'steel', 6]);
  ops.push(['cyl', 0.03, 0.03, 0.06, 0, 6.74, 0, 'red', 6]);
  // the pavement: street lamps and a pair of trees
  ops.push(...lampPost(-1.0, 1.35, 0.36, 'marquee', 0.02), ...lampPost(1.0, 1.35, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.28, -1.28, 0.7), ...tree(1.28, -1.28, 0.7));
  return ops;
};

export const jinmao: KindDef = {
  ...towerBase, id: 'jin-mao', name: 'the Jin Mao Tower', kindId: 174, tier: 3,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The pagoda in steel and glass: stainless setbacks climbing to the flared neon crown, for years the tallest building in China and still the tallest hotel in the world.',
  howTo: 'A 3×3 plot among offices on an avenue; a big workplace, so give it buses or a station. World landmark: unlock rule to be decided.',
  tool: { id: 'jinmao', key: '', label: 'Jin Mao Tower', color: '#b8c0cc' },
  levels: [{
    capacity: 360, wage: 46, cost: 24000, upkeep: 130, work: 4600, parking: { surface: 0, underground: 70 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'five stainless setback tiers under a flaring pagoda crown of eaves, mast and beacon', height: 6.8, ops: jinmaoOps() },
    ],
  }],
};

// ================================================================= 175 the Shanghai World Financial Center

/**
 * The bottle-opener: a straight glass prism for two thirds of its height, then the two faces taper to the top, where
 * the shaft splits into two piers with the sky between - the slot - and the bridge spans it. The observation rim and
 * the beacon crown the bridge; the door and porch are on the street front of the lobby base.
 */
const SWFC_GLASS = 0x9fb8cc, SWFC_TAPER = 0x8aa6bc, SWFC_BASE = 0xccd2d9;

const swfcOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the lobby: a metal base, the door on the street front
  ops.push(['box', 2.2, 0.4, 2.2, 0, 0.02, 0, SWFC_BASE, true, { name: 'lobby', facade: { storeys: 3, bays: 8, margin: 0.08, ground: 'door', top: 0.1 } }]);
  ops.push(['porch', 'lobby', 'front', 3, 6, 'silver']);
  // the shaft: a straight glass prism, then the two faces taper to the top
  ops.push(['taper', 2.0, 2.0, 1.98, 1.98, 3.0, 0, 0.42, 0, SWFC_GLASS, { win: 'office' }]);
  ops.push(['taper', 1.94, 1.94, 1.5, 1.5, 1.6, 0, 3.42, 0, SWFC_TAPER, { win: 'office' }]);
  // the slot: two piers with the sky between them, the bridge over the top, the observation rim above that
  ops.push(...repeat(2, (i): Op => {
    const sx = i === 0 ? -1 : 1;
    return ['taper', 0.62, 1.46, 0.58, 1.4, 0.72, sx * 0.44, 5.02, 0, SWFC_TAPER, { win: 'office' }];
  }));
  ops.push(['box', 1.48, 0.22, 1.42, 0, 5.74, 0, 'silver']);
  ops.push(['box', 1.3, 0.16, 1.3, 0, 5.96, 0, SWFC_GLASS, true]);
  ops.push(['cyl', 0.02, 0.02, 0.28, 0, 6.12, 0, 'steel', 6]);
  ops.push(['cyl', 0.032, 0.032, 0.06, 0, 6.4, 0, 'red', 6]);
  // the pavement: street lamps and a pair of trees
  ops.push(...lampPost(-1.0, 1.35, 0.36, 'marquee', 0.02), ...lampPost(1.0, 1.35, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.28, -1.28, 0.7), ...tree(1.28, -1.28, 0.7));
  return ops;
};

export const swfc: KindDef = {
  ...towerBase, id: 'swfc', name: 'the Shanghai World Financial Center', kindId: 175, tier: 4,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The bottle-opener of Lujiazui: a trapezoid glass shaft whose two faces taper to the bridge at the top, the sky seen through the slot below it; the observation deck rides the bridge.',
  howTo: 'A 3×3 plot among offices; a big workplace, so give it buses or a station and leave the street in front clear. World landmark: unlock rule to be decided.',
  tool: { id: 'swfc', key: '', label: 'World Financial Center', color: '#8fa9c9' },
  levels: [{
    capacity: 320, wage: 45, cost: 22000, upkeep: 120, work: 4200, parking: { surface: 0, underground: 60 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'trapezoid glass shaft split into two piers at the top, the slot between, the bridge over it', height: 6.46, ops: swfcOps() },
    ],
  }],
};

// ================================================================= 176 the Yu Garden

/**
 * The old garden behind its tiled walls: the pond crossed by the zigzag bridge, pavilions with flared two-tier roofs
 * and gold finials, the craggy rockery, pines and lantern posts - a daytime outing, quiet by evening. Everything
 * stands on the paving inside the garden walls; the gate is on the street front.
 */
const ROCK = 0x8a8f96;

/** A Chinese pavilion: stone platform, timber columns, cream walls, a flaring eave skirt and the roof pyramid with a gold finial. */
const pavilion = (x: number, z: number, w = 0.5, d = 0.4): Op[] => [
  ['box', w + 0.1, 0.05, d + 0.1, x, 0.02, z, 'stone'],
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Op => ['cyl', 0.018, 0.02, 0.22, x + sx * (w / 2 - 0.03), 0.07, z + sz * (d / 2 - 0.03), 'timber', 6]),
  ['box', w - 0.08, 0.16, d - 0.08, x, 0.09, z, 'cream', 'civic', { facade: { storeys: 1, bays: 3, sideBays: 2, margin: 0.06, top: 0.02 } }],
  ['taper', w + 0.16, d + 0.16, w + 0.02, d + 0.02, 0.08, x, 0.26, z, 'slate'],
  ['taper', w + 0.02, d + 0.02, 0.03, 0.03, 0.14, x, 0.34, z, 'slate'],
  ['cyl', 0.012, 0.012, 0.06, x, 0.48, z, 'gold', 5],
];

const yuGardenOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the garden walls on three sides, with tiled coping; the front opens to the street
  ops.push(['box', 2.94, 0.14, 0.06, 0, 0.02, -1.42, 'white']);
  ops.push(['roof', 2.94, 0.07, 0.12, 0, 0.16, -1.42, 'slate']);
  ops.push(['box', 0.06, 0.14, 2.94, -1.42, 0.02, 0, 'white']);
  ops.push(['roof', 0.12, 0.07, 2.94, -1.42, 0.16, 0, 'slate']);
  ops.push(['box', 0.06, 0.14, 2.94, 1.42, 0.02, 0, 'white']);
  ops.push(['roof', 0.12, 0.07, 2.94, 1.42, 0.16, 0, 'slate']);
  // the pond with its stone edging, crossed by the zigzag bridge
  ops.push(['box', 1.3, 0.03, 0.94, -0.5, 0.02, 0.3, 'stone']);
  ops.push(['box', 1.24, 0.032, 0.88, -0.5, 0.02, 0.3, 'pond']);
  ops.push(['box', 0.56, 0.025, 0.15, -0.82, 0.052, 0.14, 'timber']);
  ops.push(['box', 0.15, 0.025, 0.5, -0.53, 0.052, 0.39, 'timber']);
  ops.push(['box', 0.44, 0.025, 0.15, -0.29, 0.052, 0.64, 'timber']);
  ops.push(['box', 0.02, 0.035, 0.5, -0.595, 0.077, 0.39, 'timber'], ['box', 0.02, 0.035, 0.5, -0.465, 0.077, 0.39, 'timber']);
  // the craggy rockery beside the pond
  ops.push(['lathe', -0.98, 0.02, 0.85, ROCK, [0.26, 0, 0.34, 0.12, 0.2, 0.26, 0.3, 0.42, 0.14, 0.56, 0, 0.68], { seg: 8 }]);
  // the pavilions: the main tea pavilion by the pond, one in the back corner, one by the wall
  ops.push(...pavilion(0.72, 0.62, 0.56, 0.46));
  ops.push(...pavilion(-0.85, -0.78));
  ops.push(...pavilion(0.95, -0.95, 0.42, 0.36));
  // the paths: from the gate to the bridge and along the back
  ops.push(['box', 0.4, 0.004, 1.6, 0, 0.02, 0.6, 'gravel']);
  ops.push(['box', 2.4, 0.004, 0.34, 0, 0.02, -0.25, 'gravel']);
  // the gate on the street front: timber posts under a little roof, red lanterns either side
  ops.push(['box', 0.07, 0.26, 0.07, -0.24, 0.02, 1.32, 'timber'], ['box', 0.07, 0.26, 0.07, 0.24, 0.02, 1.32, 'timber']);
  ops.push(['roof', 0.66, 0.12, 0.18, 0, 0.28, 1.32, 'slate']);
  ops.push(...lampPost(-0.5, 1.05, 0.3, 'red', 0.02), ...lampPost(0.5, 1.05, 0.3, 'red', 0.02));
  // the planting: pines at the corners, a broadleaf tree, a lawn patch by the main pavilion
  ops.push(...pine(-1.3, 0.15, 0.95), ...pine(1.32, -0.35, 0.9), ...tree(-1.28, -1.28, 0.7));
  ops.push(['box', 0.8, 0.014, 0.5, 0.8, 0.02, -0.15, 'lawn']);
  return ops;
};

export const yuGarden: KindDef = {
  id: 'yu-garden', name: 'the Yu Garden', kindId: 176, tier: 5,
  code: library.code, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic',
  landmark: true, tags: TAGS, group: 'shanghai',
  occupation: { ...library.occupation!, name: 'garden keeper' },
  attrs: {
    ...library.attrs, visitorCapacity: 120, ticket: 18, openHours: [9, 17.5], stay: [1.5, 2.5],
    leisureValue: 8, radius: 28, dayAppeal: 1.5, eveningAppeal: 0.1, retireeAppeal: 2.2, childAppeal: 1.9,
    title: 'Yu Garden',
  },
  lot: { wage: 16 },
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The Ming-dynasty garden behind its tiled walls: the pond crossed by the zigzag bridge, flared-roof pavilions for tea, and the rockery - four hundred years of the old city.',
  howTo: 'A 3×3 plot in a neighbourhood among homes; a day out that draws retirees and children, quiet after it closes at dusk. World landmark: unlock rule to be decided.',
  tool: { id: 'yugarden', key: '', label: 'Yu Garden', color: '#6e8f5a' },
  levels: [{
    capacity: 24, wage: 16, cost: 14000, upkeep: 80, work: 3200, parking: { surface: 0, underground: 20 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'walled garden of pavilions, the pond under its zigzag bridge and the craggy rockery', height: 0.7, ops: yuGardenOps() },
    ],
  }],
};

/** Shanghai's landmarks, in kind-id order (landmarks-world.ts lists them in WORLD_LANDMARKS). */
export const SHANGHAI_LANDMARKS: KindDef[] = [orientalPearl, shanghaiTower, jinmao, swfc, yuGarden];
