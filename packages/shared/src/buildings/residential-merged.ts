import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { residential } from './residential';
import { car } from './tierkit';
import { range } from "./zonekit";
import { block, bands, balconies, house, hedge, roofPlant, waterTank, stepped, tree, treeRow, ground, spire, fins } from './zonekit';

/**
 * Merged residential lots (zones.ts, docs/buildings.md "Merged lots"). Growth assembles neighbouring residential lots
 * of one owner into these when demand allows; they are never placed. Ids 70-74. Every design is authored for its whole
 * footprint, +z towards the road.
 */
const work = (level: number, area: number) => Math.round(60 * level * area * 0.6);
const base = { code: Zone.Residential, family: 'residential' as const, flags: { growable: true }, windows: 'home' as const, tints: residential.tints, lotTint: residential.lotTint };
const homes = (capacity: number, level: number, area: number, style: string, rentBand: 'low' | 'mid' | 'high') =>
  ({ capacity, work: work(level, area), parking: { surface: Math.round(capacity * 0.7), underground: capacity }, attrs: { style, rentBand } });

// ================================================================= 2×1 terrace row, levels 2-3

const terraceA = (): Op[] => {
  const walls: Color[] = ['brick', 0xb86a48, 'brick', 0xc27a56];
  return [
    ground(2, 1, 'lawn'),
    ['box', 1.9, 0.021, 0.16, 0, 0, 0.36, 'stone'],
    ...range(4).flatMap((i) => house(-0.69 + i * 0.46, -0.1, 0.46, 0.5, 0.36, walls[i], 'slate', { chimney: i % 2 ? 0.15 : -0.15, roofH: 0.2 })),
    ...repeat(4, (i): Op => hedge(-0.69 + i * 0.46, 0.27, 0.3)),
    ...tree(-0.88, 0.38, 0.55), ...tree(0.88, 0.38, 0.5),
  ];
};
const semiPair = (): Op[] => [
  ground(2, 1, 'lawn'),
  ['box', 0.2, 0.021, 0.9, 0, 0, 0, 'grey'],
  ...house(-0.48, -0.08, 0.62, 0.54, 0.42, 'cream', 'terracotta', { chimney: -0.2, roofH: 0.24 }),
  ...house(0.48, -0.08, 0.62, 0.54, 0.42, 'tan', 'terracotta', { chimney: 0.2, roofH: 0.24 }),
  ['box', 0.2, 0.16, 0.14, -0.3, 0.02, 0.24, 'cream'], ['roof', 0.24, 0.08, 0.18, -0.3, 0.18, 0.24, 'terracotta'],
  ['box', 0.2, 0.16, 0.14, 0.3, 0.02, 0.24, 'tan'], ['roof', 0.24, 0.08, 0.18, 0.3, 0.18, 0.24, 'terracotta'],
  ...car(0, 0.3, 'navy'), ...tree(-0.86, 0.32, 0.65), ...tree(0.86, 0.3, 0.6),
  hedge(-0.55, 0.44, 0.7), hedge(0.55, 0.44, 0.7),
];
const mews = (): Op[] => [
  ground(2, 1, 'gravel'),
  ...house(-0.62, -0.12, 0.6, 0.46, 0.34, 'white', 'slate', { chimney: 0.18, roofH: 0.2 }),
  ...house(0, -0.12, 0.6, 0.46, 0.34, 'mint', 'slate', { chimney: -0.18, roofH: 0.2 }),
  ...house(0.62, -0.12, 0.6, 0.46, 0.34, 'cream', 'slate', { chimney: 0.18, roofH: 0.2 }),
  ...repeat(3, (i): Op => ['box', 0.12, 0.05, 0.12, -0.62 + i * 0.62 + 0.18, 0.02, 0.24, 'hedge']),
  ...car(-0.32, 0.32, 'red', true), ...tree(0.86, 0.34, 0.55),
];
const georgian = (): Op[] => {
  const walls: Color[] = ['cream', 'white', 'cream', 'white', 'cream'];
  return [
    ground(2, 1, 'stone'),
    ...range(5).flatMap((i): Op[] => [
      ['box', 0.37, 0.66, 0.56, -0.74 + i * 0.37, 0.02, -0.08, walls[i], true],
      ['box', 0.08, 0.17, 0.02, -0.74 + i * 0.37 + 0.1, 0.02, 0.205, 'door'],
      ['box', 0.12, 0.03, 0.06, -0.74 + i * 0.37 + 0.1, 0.19, 0.23, 'stone'],
    ]),
    ['box', 1.86, 0.03, 0.58, 0, 0.66, -0.08, 'stone'], ['roof', 1.86, 0.14, 0.56, 0, 0.69, -0.08, 'slate'],
    ...repeat(4, (i): Op => ['box', 0.08, 0.14, 0.1, -0.555 + i * 0.37, 0.76, -0.08, 'chimney']),
    ['box', 1.86, 0.06, 0.01, 0, 0.02, 0.34, 'charcoal'], ...repeat(10, (i): Op => ['box', 0.012, 0.07, 0.012, -0.9 + i * 0.2, 0.02, 0.34, 'charcoal']),
  ];
};
const modernTownhouses = (): Op[] => {
  const walls: Color[] = ['pale', 'white', 'pale', 'white'];
  return [
    ground(2, 1, 'stone'),
    ...range(4).flatMap((i): Op[] => {
      const x = -0.69 + i * 0.46;
      return [
        ['box', 0.44, 0.56, 0.6, x, 0.02, -0.08, walls[i], true],
        ['box', 0.38, 0.22, 0.36, x, 0.58, -0.2, 'charcoal', true],
        ['box', 0.4, 0.02, 0.38, x, 0.8, -0.2, 'dark'],
        ['box', 0.3, 0.3, 0.015, x - 0.04, 0.2, 0.225, 'glass'],
        ['box', 0.1, 0.4, 0.02, x + 0.15, 0.1, 0.23, 'timber'],
        ['box', 0.08, 0.15, 0.02, x - 0.12, 0.02, 0.225, 'door'],
        ['box', 0.42, 0.04, 0.01, x, 0.6, 0.21, 'steel'],
      ];
    }),
    ...treeRow(-0.8, 0.8, 0.4, 3, 0.5),
  ];
};

export const resTerrace: KindDef = {
  ...base, id: 'res-terrace', name: 'terrace row', kindId: 70, minLevel: 2,
  footprint: { w: 2, h: 1, door: [0, 0] },
  levels: [
    { ...homes(18, 2, 2, 'terrace', 'mid'), feature: 'level2', designs: [
      { name: 'four brick houses with front gardens and chimneys', height: 0.62, ops: terraceA() },
      { name: 'semi-detached pair with porches and a shared drive', height: 0.7, ops: semiPair() },
      { name: 'mews of three cottages on a gravel yard', height: 0.6, ops: mews() },
    ] },
    { ...homes(26, 3, 2, 'townhouses', 'high'), feature: 'level3', designs: [
      { name: 'Georgian terrace of five stucco townhouses with railings', height: 0.9, ops: georgian() },
      { name: 'modern townhouses with roof terraces and timber screens', height: 0.82, ops: modernTownhouses() },
    ] },
  ],
};

// ================================================================= 2×2 mid-rise apartments, level 4

const courtyard = (): Op[] => [
  ground(2, 2, 'lawn'),
  ...block(0.74, 1.2, 0.42, -0.53, 0.68, 'brick'), ...block(0.74, 1.2, 0.42, 0.53, 0.68, 'brick'),
  ...block(0.34, 0.8, 0.42, 0, 0.68, 'brick', 0.42), ['box', 0.32, 0.4, 0.4, 0, 0.02, 0.68, 0x2a2420],
  ...block(1.8, 1.2, 0.42, 0, -0.68, 'brick'),
  ...block(0.42, 1.2, 0.94, -0.69, 0, 0xb86a48), ...block(0.42, 1.2, 0.94, 0.69, 0, 0xb86a48),
  ['roof', 1.82, 0.2, 0.44, 0, 1.225, 0.68, 'slate'], ['roof', 1.82, 0.2, 0.44, 0, 1.225, -0.68, 'slate'],
  ['roof', 0.44, 0.2, 0.94, -0.69, 1.225, 0, 'slate', true], ['roof', 0.44, 0.2, 0.94, 0.69, 1.225, 0, 'slate', true],
  ...bands(1.8, 0.42, 0, -0.68, 0, 1.2, 4, 'stone', 0.015),
  ...tree(-0.2, -0.1, 0.8), ...tree(0.22, 0.12, 0.7), ['cyl', 0.1, 0.1, 0.04, 0, 0.02, -0.25, 'pond', 10],
];
const steppedMidrise = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.7, 1.5, 0.7, 0, -0.45, 'cream'),
  ...block(1.7, 0.9, 0.6, 0, 0.35, 'cream'),
  ...balconies(1.6, 0, 0.65, 0.3, 3, 0.26),
  ...balconies(1.6, 0, -0.1, 1.05, 2, 0.24, 'pale'),
  ['box', 1.6, 0.02, 0.5, 0, 0.925, 0.35, 'lawn'], ...tree(-0.5, 0.35, 0.55, 0.945), ...tree(0.45, 0.4, 0.5, 0.945),
  ['box', 0.3, 0.16, 0.24, 0.5, 1.525, -0.55, 'grey'],
  ...treeRow(-0.85, 0.85, 0.88, 4, 0.6),
];

export const resMidrise: KindDef = {
  ...base, id: 'res-midrise', name: 'mid-rise apartments', kindId: 71, minLevel: 4,
  footprint: { w: 2, h: 2, door: [1, 1] },
  levels: [
    { ...homes(64, 4, 4, 'mid-rise apartments', 'mid'), feature: 'level4', designs: [
      { name: 'brick courtyard apartments round a garden, with an arched gateway', height: 1.45, ops: courtyard() },
      { name: 'stepped cream mid-rise with balconies and a roof garden', height: 1.7, ops: steppedMidrise() },
    ] },
  ],
};

// ================================================================= 3×2 perimeter block, level 5

const perimeter = (): Op[] => [
  ground(3, 2, 'lawn'),
  ...block(2.5, 1.6, 0.45, -0.15, 0.72, 'stone'), ...bands(2.5, 0.45, -0.15, 0.72, 0, 1.6, 5, 'cream', 0.015),
  ...block(2.8, 1.6, 0.45, 0, -0.72, 'stone'),
  ...block(0.45, 1.6, 1.0, -1.17, 0, 'cream'), ...block(0.45, 1.6, 1.0, 1.17, 0, 'cream'),
  ['roof', 2.5, 0.22, 0.47, -0.15, 1.625, 0.72, 'slate'], ['roof', 2.82, 0.22, 0.47, 0, 1.625, -0.72, 'slate'],
  ['roof', 0.47, 0.22, 1.0, -1.17, 1.625, 0, 'slate', true], ['roof', 0.47, 0.22, 1.0, 1.17, 1.625, 0, 'slate', true],
  ['cyl', 0.24, 0.24, 1.86, 1.22, 0.02, 0.72, 'stone', 12], ['cone', 0.27, 0.36, 1.22, 1.88, 0.72, 'slate', 12],
  ['box', 0.36, 0.3, 0.02, -0.15, 0.02, 0.955, 0x2a2420],
  ...tree(-0.5, 0, 0.8), ...tree(0.3, -0.1, 0.75), ...tree(0.7, 0.15, 0.6), hedge(-0.1, 0.2, 0.8),
];
const mansion = (): Op[] => [
  ground(3, 2, 'lawn'),
  ...block(2.8, 1.7, 0.5, 0, -0.7, 'brick'),
  ...block(0.6, 1.7, 1.4, -1.15, 0.0, 'brick'), ...block(0.6, 1.7, 1.4, 1.15, 0.0, 'brick'),
  ['roof', 2.82, 0.24, 0.52, 0, 1.725, -0.7, 'slate'], ['roof', 0.62, 0.24, 1.4, -1.15, 1.725, 0, 'slate', true], ['roof', 0.62, 0.24, 1.4, 1.15, 1.725, 0, 'slate', true],
  ...bands(2.8, 0.5, 0, -0.7, 0, 1.7, 5, 'stone', 0.015),
  ['box', 0.2, 1.5, 0.1, -1.15, 0.12, 0.75, 'brick', true], ['box', 0.2, 1.5, 0.1, 1.15, 0.12, 0.75, 'brick', true],
  ['box', 0.24, 0.04, 0.14, -1.15, 1.62, 0.75, 'stone'], ['box', 0.24, 0.04, 0.14, 1.15, 1.62, 0.75, 'stone'],
  ['box', 0.3, 0.3, 0.02, 0, 0.02, -0.44, 0x2a2420],
  ['cyl', 0.16, 0.16, 0.05, 0, 0.02, 0.05, 'stone', 12], ['cyl', 0.12, 0.12, 0.055, 0, 0.02, 0.05, 'pond', 12], ['cyl', 0.02, 0.03, 0.16, 0, 0.02, 0.05, 'stone', 6],
  ...tree(-0.5, -0.15, 0.7), ...tree(0.5, -0.15, 0.7), ...tree(-0.55, 0.55, 0.6), ...tree(0.55, 0.55, 0.6),
  ['box', 1.6, 0.06, 0.01, 0, 0.02, 0.94, 'charcoal'],
];

export const resBlock: KindDef = {
  ...base, id: 'res-block', name: 'perimeter block', kindId: 72, minLevel: 5,
  footprint: { w: 3, h: 2, door: [1, 1] },
  levels: [
    { ...homes(114, 5, 6, 'perimeter block', 'high'), feature: 'level5', designs: [
      { name: 'stone perimeter block round a garden court, with a corner turret', height: 2.25, ops: perimeter() },
      { name: 'brick mansion block with bay windows and a fountain court', height: 1.97, ops: mansion() },
    ] },
  ],
};

// ================================================================= 2×2 residential tower, levels 6-7

const slabTower = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.8, 0.35, 1.6, 0, -0.1, 'stone'),
  ...block(1.1, 2.6, 0.9, 0, -0.25, 'pale', 0.375),
  ...balconies(1.0, 0, 0.2, 0.62, 9, 0.26),
  ['box', 0.36, 0.2, 0.3, 0.25, 3.0, -0.3, 'grey'], ...roofPlant(-0.4, 3.0, -0.4, 2),
  ...treeRow(-0.8, 0.8, 0.86, 4, 0.55),
];
const twinCore = (): Op[] => [
  ground(2, 2, 'lawn'),
  ...block(1.8, 0.3, 1.8, 0, 0, 'stone'), ['box', 1.6, 0.02, 0.6, 0, 0.32, 0.55, 'lawn'],
  ...block(0.7, 2.6, 0.7, -0.5, -0.4, 'cream', 0.32), ...block(0.7, 3.0, 0.7, 0.5, -0.4, 'white', 0.32),
  ...bands(0.7, 0.7, -0.5, -0.4, 0.32, 2.9, 9, 'tan'), ...bands(0.7, 0.7, 0.5, -0.4, 0.32, 3.3, 10, 'pale'),
  ['box', 0.32, 0.12, 0.3, 0, 2.1, -0.4, 'glass', true],
  ...tree(-0.5, 0.55, 0.6, 0.34), ...tree(0.2, 0.6, 0.55, 0.34), ...tree(0.6, 0.5, 0.5, 0.34),
];
const glassResTower = (): Op[] => {
  const s = stepped(0, -0.1, 0, [[1.4, 0.5, 1.4], [1.0, 3.2, 1.0], [0.8, 0.5, 0.8]], 'pale', 'dark', 'glassDark', 0.2);
  return [ground(2, 2, 'stone'), ...s.ops, ...fins(0.8, 0.8, 0, -0.1, s.top - 0.52, 0.5, 6, 'white'), ...spire(0, s.top, -0.1, 0.5), ...treeRow(-0.8, 0.8, 0.86, 4, 0.5)];
};
const skyGardens = (): Op[] => {
  const s = stepped(0, -0.15, 0, [[1.6, 1.3, 1.5], [1.2, 1.4, 1.1], [0.85, 1.4, 0.75]], 'cream', 'dark', 'tan', 0.2);
  return [
    ground(2, 2, 'lawn'), ...s.ops,
    ...tree(-0.68, 0.45, 0.55, 1.33), ...tree(0.68, -0.75, 0.5, 1.33), ...tree(-0.5, 0.35, 0.45, 2.76), ...tree(0.5, -0.6, 0.45, 2.76),
    ...spire(0.2, s.top, -0.2, 0.35, 0.025), ...treeRow(-0.8, 0.8, 0.88, 3, 0.55),
  ];
};

export const resTower: KindDef = {
  ...base, id: 'res-tower', name: 'residential tower', kindId: 73, minLevel: 6,
  footprint: { w: 2, h: 2, door: [1, 1] },
  levels: [
    { ...homes(96, 6, 4, 'tower flats', 'mid'), feature: 'level6', designs: [
      { name: 'slab tower with balcony stripes on a stone podium', height: 3.2, ops: slabTower() },
      { name: 'twin-core tower with a bridge and a garden podium', height: 3.35, ops: twinCore() },
    ] },
    { ...homes(120, 7, 4, 'tower flats', 'high'), feature: 'level7', designs: [
      { name: 'slender glass tower with a finned crown and a spire', height: 4.8, ops: glassResTower() },
      { name: 'stepped tower with sky gardens on every setback', height: 4.6, ops: skyGardens() },
    ] },
  ],
};

// ================================================================= 3×3 tower estate, levels 6-7

const twoTowers = (): Op[] => [
  ground(3, 3, 'lawn'),
  ...block(2.8, 0.3, 1.6, 0, -0.6, 'stone'),
  ...block(0.9, 2.6, 0.9, -0.8, -0.75, 'cream', 0.32), ...block(0.9, 2.2, 0.9, 0.8, -0.5, 'white', 0.32),
  ...balconies(0.8, -0.8, -0.3, 0.6, 8, 0.28), ...balconies(0.8, 0.8, -0.05, 0.6, 7, 0.26, 'pale'),
  ...treeRow(-1.2, 1.2, 0.6, 6, 0.7), ...treeRow(-1.2, 1.2, 1.2, 5, 0.6),
  ['box', 0.5, 0.02, 0.4, 0.8, 0.02, 0.9, 'sand'], ['box', 0.2, 0.12, 0.02, 0.8, 0.02, 0.9, 'red'],
];
const crescent = (): Op[] => [
  ground(3, 3, 'lawn'),
  ...block(2.8, 1.8, 0.6, 0, -1.1, 'stone'), ...bands(2.8, 0.6, 0, -1.1, 0, 1.8, 6, 'pale', 0.015),
  ...block(0.6, 1.4, 1.5, -1.1, 0.0, 'stone'), ...block(0.6, 1.4, 1.5, 1.1, 0.0, 'stone'),
  ...block(0.8, 1.1, 0.6, 0.6, -1.1, 'cream', 1.825),
  ...balconies(2.6, 0, -0.8, 0.4, 5, 0.28),
  ['cyl', 0.42, 0.42, 0.03, 0, 0.02, 0.1, 'pond', 16], ...tree(-0.5, -0.4, 0.75), ...tree(0.5, -0.4, 0.75), ...tree(-0.4, 0.75, 0.7), ...tree(0.45, 0.8, 0.65),
  hedge(0, 1.35, 1.2),
];
const threeTowers = (): Op[] => [
  ground(3, 3, 'lawn'),
  ...block(2.8, 0.3, 2.8, 0, 0, 'stone'), ['box', 1.4, 0.02, 1.2, 0.5, 0.32, 0.6, 'lawn'],
  ...block(0.9, 4.2, 0.9, -0.85, -0.85, 'pale', 0.32), ...bands(0.9, 0.9, -0.85, -0.85, 0.32, 4.52, 14, 'glassDark'),
  ...block(0.8, 3.4, 0.8, 0.85, -0.9, 'white', 0.32), ...bands(0.8, 0.8, 0.85, -0.9, 0.32, 3.72, 11, 'tan'),
  ...block(0.8, 2.6, 0.8, -0.9, 0.85, 'cream', 0.32), ...bands(0.8, 0.8, -0.9, 0.85, 0.32, 2.92, 8, 'tan'),
  ...spire(-0.85, 4.545, -0.85, 0.4),
  ...tree(0.3, 0.4, 0.6, 0.34), ...tree(0.8, 0.8, 0.55, 0.34), ...tree(0.3, 1.0, 0.5, 0.34),
];
const poolDeck = (): Op[] => [
  ground(3, 3, 'stone'),
  ...block(2.8, 0.35, 2.6, 0, -0.1, 'stone'),
  ...block(2.6, 1.0, 0.9, 0, -0.9, 'white', 0.375), ...balconies(2.5, 0, -0.45, 0.6, 3, 0.26),
  ...block(1.2, 4.4, 1.2, 0.7, -0.5, 'pale', 0.375), ...bands(1.2, 1.2, 0.7, -0.5, 0.375, 4.775, 14, 'glass'),
  ['box', 1.0, 0.05, 0.25, 0.7, 4.8, -0.5, 'white'],
  ['box', 0.9, 0.03, 0.5, -0.65, 0.375, 0.5, 'pond'], ['box', 1.0, 0.02, 0.6, -0.65, 0.37, 0.5, 'white'],
  ...tree(-1.25, 0.95, 0.5, 0.375), ...tree(0.1, 0.95, 0.5, 0.375), ...repeat(3, (i): Op => ['cone', 0.06, 0.08, -1.0 + i * 0.3, 0.42, 1.0, 'awning', 8]),
];

export const resEstate: KindDef = {
  ...base, id: 'res-estate', name: 'tower estate', kindId: 74, minLevel: 6,
  footprint: { w: 3, h: 3, door: [1, 2] },
  levels: [
    { ...homes(216, 6, 9, 'tower estate', 'mid'), feature: 'level6', designs: [
      { name: 'two towers on a landscaped podium with a playground', height: 2.95, ops: twoTowers() },
      { name: 'stepped crescent of flats round a park with a pond', height: 2.95, ops: crescent() },
    ] },
    { ...homes(270, 7, 9, 'tower estate', 'high'), feature: 'level7', designs: [
      { name: 'three towers of different heights round a podium garden', height: 4.95, ops: threeTowers() },
      { name: 'tall tower beside a terrace wing and a podium pool deck', height: 4.85, ops: poolDeck() },
    ] },
  ],
};

export const RESIDENTIAL_MERGED: KindDef[] = [resTerrace, resMidrise, resBlock, resTower, resEstate];
