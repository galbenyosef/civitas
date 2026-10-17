import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { commercial } from './commercial';
import { flags, signBoard } from './tierkit';
import { range } from "./zonekit";
import { block, bands, fins, awning, shopfront, stepped, carPark, tree, treeRow, ground, spire, roofPlant } from './zonekit';

/**
 * Merged commercial lots (zones.ts, docs/buildings.md "Merged lots"): a high-street parade, a department store, a
 * shopping centre with its car park and a hotel tower. Grown from neighbouring commercial lots, never placed. Ids 75-78.
 * `visitorCapacity` is read by the simulation (zones.ts venueCapacityOf), so a store holds more café and shop visitors
 * than a corner shop.
 */
const work = (level: number, area: number) => Math.round(60 * level * area * 0.6);
const base = {
  code: Zone.Commercial, family: 'commercial' as const, flags: { growable: true, workplace: true, leisureReady: true }, windows: 'shop' as const,
  tints: commercial.tints, lotTint: commercial.lotTint, occupation: commercial.occupation, attrs: { commerceType: 'shop', openHours: [7, 22] as [number, number] }, lot: { wage: 10 },
};
const shops = (capacity: number, wage: number, level: number, area: number, visitorCapacity: number, surface: number, underground: number) =>
  ({ capacity, wage, work: work(level, area), parking: { surface, underground }, attrs: { visitorCapacity } });

// ================================================================= 2×1 high-street parade, levels 2-3

const parade = (): Op[] => {
  const fascia: Color[] = ['navy', 'red', 'green', 'gold'], aw: Color[] = ['awning', 'boxBlue', 'green', 'boxOrange'];
  return [
    ground(2, 1, 'stone'),
    ...block(1.88, 0.56, 0.6, 0, -0.1, 'brick'), ...bands(1.88, 0.6, 0, -0.1, 0.02, 0.56, 1, 'stone', 0.02),
    ...range(4).flatMap((i) => [...shopfront(-0.705 + i * 0.47, 0.2, 0.44, fascia[i]), ...awning(-0.705 + i * 0.47, 0.25, 0.2, 0.44, aw[i], i % 2 ? null : 'white', 4)]),
    ...repeat(3, (i): Op => ['box', 0.07, 0.12, 0.07, -0.47 + i * 0.47, 0.585, -0.25, 'chimney']),
  ];
};
const pubAndBakery = (): Op[] => [
  ground(2, 1, 'stone'),
  ['box', 0.9, 0.5, 0.62, -0.5, 0.02, -0.1, 'green', true], ['roof', 0.94, 0.2, 0.68, -0.5, 0.52, -0.1, 'slate'],
  ['box', 0.8, 0.07, 0.02, -0.5, 0.3, 0.215, 'gold'], ['box', 0.2, 0.18, 0.02, -0.65, 0.02, 0.215, 'door'], ['box', 0.36, 0.14, 0.02, -0.3, 0.06, 0.215, 'glass'],
  ['box', 0.12, 0.12, 0.02, -0.92, 0.36, 0.26, 'red'], ['box', 0.02, 0.02, 0.08, -0.92, 0.47, 0.23, 'charcoal'],
  ...range(2).flatMap((i): Op[] => [['cyl', 0.05, 0.05, 0.1, -0.7 + i * 0.4, 0.02, 0.38, 'timber', 8], ['cone', 0.1, 0.06, -0.7 + i * 0.4, 0.24, 0.38, 'white', 8], ['cyl', 0.006, 0.006, 0.14, -0.7 + i * 0.4, 0.1, 0.38, 'steel', 4]]),
  ...block(0.92, 0.6, 0.6, 0.5, -0.1, 'cream'), ...shopfront(0.5, 0.2, 0.84, 'brown'), ...awning(0.5, 0.25, 0.2, 0.84, 'awning', 'cream', 7),
  ['cyl', 0.07, 0.07, 0.03, 0.5, 0.645, 0.05, 'gold', 10],
];
const highStreet = (): Op[] => [
  ground(2, 1, 'stone'),
  ...block(1.86, 0.9, 0.66, 0, -0.1, 'stone'), ...bands(1.86, 0.66, 0, -0.1, 0.25, 0.9, 2, 'cream'),
  ...range(4).flatMap((i) => shopfront(-0.7 + i * 0.465, 0.23, 0.42, (['navy', 'red', 'green', 'charcoal'] as Color[])[i])),
  ['cyl', 0.15, 0.15, 1.12, 0.78, 0.02, 0.12, 'stone', 10], ['cone', 0.17, 0.2, 0.78, 1.14, 0.12, 'slate', 10],
  ['cyl', 0.07, 0.07, 0.012, 0.78, 0.92, 0.275, 'white', 12],
  ['box', 1.4, 0.05, 0.02, -0.2, 0.84, 0.235, 'gold'],
];
const arcade = (): Op[] => [
  ground(2, 1, 'stone'),
  ...block(0.72, 0.85, 0.7, -0.6, -0.08, 'cream'), ...block(0.72, 0.85, 0.7, 0.6, -0.08, 'cream'),
  ...shopfront(-0.6, 0.27, 0.66, 'plum'), ...shopfront(0.6, 0.27, 0.66, 'navy'),
  ['box', 0.46, 0.7, 0.7, 0, 0.02, -0.08, 'glass', true], ['roof', 0.5, 0.18, 0.72, 0, 0.72, -0.08, 'glassDark', true],
  ['box', 0.5, 0.12, 0.03, 0, 0.6, 0.29, 'marquee', 'venue'],
  ...repeat(4, (i): Op => ['box', 0.04, 0.24, 0.01, -0.85 + i * 0.25 + (i > 1 ? 0.95 : 0), 0.45, 0.285, i % 2 ? 'red' : 'gold']),
];

export const comParade: KindDef = {
  ...base, id: 'com-parade', name: 'high-street parade', kindId: 75, minLevel: 2,
  footprint: { w: 2, h: 1, door: [0, 0] },
  levels: [
    { ...shops(14, 20, 2, 2, 24, 2, 12), feature: 'level2', designs: [
      { name: 'parade of four shopfronts with awnings and flats above', height: 0.72, ops: parade() },
      { name: 'corner pub with a hanging sign beside a bakery', height: 0.72, attrs: { commerceType: 'pub', openHours: [11, 24] }, ops: pubAndBakery() },
    ] },
    { ...shops(20, 25, 3, 2, 36, 2, 18), feature: 'level3', designs: [
      { name: 'three-storey stone high-street block with a clock turret', height: 1.34, ops: highStreet() },
      { name: 'glazed shopping arcade between two cream blocks', height: 0.9, ops: arcade() },
    ] },
  ],
};

// ================================================================= 2×2 department store, levels 4-5

const rotunda = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.7, 1.2, 1.5, -0.05, -0.2, 'stone'), ...bands(1.7, 1.5, -0.05, -0.2, 0.3, 1.2, 3, 'cream'),
  ['box', 1.5, 0.22, 0.015, -0.15, 0.04, 0.56, 'glass'], ['box', 1.6, 0.03, 0.18, -0.1, 0.3, 0.64, 'charcoal'],
  ['cyl', 0.3, 0.3, 1.45, 0.62, 0.02, 0.6, 'cream', 14], ['cone', 0.33, 0.3, 0.62, 1.47, 0.6, 'glassDark', 14],
  ...flags(-0.7, -0.2, 4, 0.36, ['red', 'navy', 'gold', 'green'], 1.225),
  ['box', 0.9, 0.08, 0.02, -0.3, 0.98, 0.555, 'gold'],
];
const supermarket = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.8, 0.55, 1.0, 0, -0.45, 'white'), ['box', 1.82, 0.08, 1.02, 0, 0.47, -0.45, 'green'],
  ['box', 0.7, 0.3, 0.02, -0.3, 0.02, 0.055, 'glass'], ['box', 0.9, 0.03, 0.26, -0.3, 0.34, 0.17, 'green'],
  ...repeat(2, (i): Op => ['cyl', 0.012, 0.012, 0.32, -0.7 + i * 0.8, 0.02, 0.29, 'steel', 4]),
  ['box', 0.5, 0.1, 0.03, 0.5, 0.36, 0.06, 'yellow'], ...roofPlant(-0.6, 0.575, -0.6, 3),
  ...carPark(0, 0.6, 1.8, 0.7, 5),
];
const atriumStore = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.8, 1.6, 1.6, 0, -0.15, 'cream'), ...bands(1.8, 1.6, 0, -0.15, 0.3, 1.6, 4, 'stone'),
  ['box', 0.8, 0.4, 0.8, 0, 1.625, -0.15, 'glass', true], ['roof', 0.84, 0.2, 0.84, 0, 2.025, -0.15, 'glassDark', true],
  ['box', 0.6, 0.5, 0.02, 0, 0.02, 0.655, 'glass'], ['box', 0.8, 0.04, 0.2, 0, 0.55, 0.74, 'gold'],
  ...treeRow(-0.8, 0.8, 0.86, 2, 0.5),
];
const fashion = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.7, 1.5, 1.4, 0, -0.25, 'white'), ...fins(1.7, 1.4, 0, -0.25, 0.3, 1.2, 12, 'charcoal'),
  ['box', 1.5, 0.26, 0.015, 0, 0.04, 0.455, 'glassDark'], ['box', 1.7, 0.03, 0.3, 0, 0.3, 0.6, 'charcoal'],
  ...range(3).flatMap((i): Op[] => [['cyl', 0.006, 0.006, 0.14, -0.5 + i * 0.5, 1.525, -0.1, 'steel', 4], ['cone', 0.12, 0.06, -0.5 + i * 0.5, 1.64, -0.1, i % 2 ? 'white' : 'awning', 8]]),
  ['box', 1.5, 0.05, 0.01, 0, 1.525, 0.44, 'steel'],
  ...treeRow(-0.8, 0.8, 0.85, 3, 0.5),
];

export const comStore: KindDef = {
  ...base, id: 'com-store', name: 'department store', kindId: 76, minLevel: 4,
  footprint: { w: 2, h: 2, door: [1, 1] },
  attrs: { commerceType: 'department store', openHours: [9, 21] },
  levels: [
    { ...shops(44, 27, 4, 4, 60, 6, 40), feature: 'level4', designs: [
      { name: 'department store with a corner rotunda and roof flags', height: 1.8, ops: rotunda() },
      { name: 'supermarket with an entrance canopy and its own car park', height: 0.67, attrs: { commerceType: 'supermarket', openHours: [7, 22] }, ops: supermarket() },
    ] },
    { ...shops(52, 29, 5, 4, 72, 6, 48), feature: 'level5', designs: [
      { name: 'cream department store with a glass atrium roof', height: 2.25, ops: atriumStore() },
      { name: 'fashion house with a finned facade and a roof-terrace café', height: 1.75, ops: fashion() },
    ] },
  ],
};

// ================================================================= 3×3 shopping centre, levels 5-6

const mall = (): Op[] => [
  ground(3, 3, 'stone'),
  ...block(1.2, 0.7, 1.5, 0, -0.65, 'pale'), ['roof', 1.0, 0.25, 1.5, 0, 0.725, -0.65, 'glass', true],
  ...block(0.8, 0.95, 1.5, -1.0, -0.65, 'cream'), ...block(0.8, 0.95, 1.5, 1.0, -0.65, 'white'),
  ['box', 0.6, 0.08, 0.02, -1.0, 0.8, 0.11, 'red'], ['box', 0.6, 0.08, 0.02, 1.0, 0.8, 0.11, 'navy'],
  ['box', 0.8, 0.03, 0.3, 0, 0.45, 0.25, 'charcoal'], ['box', 0.6, 0.4, 0.02, 0, 0.02, 0.105, 'glass'],
  ...carPark(0, 0.85, 2.8, 1.2, 2),
  ['box', 0.08, 0.7, 0.08, 1.3, 0.02, 1.35, 'charcoal'], ['box', 0.2, 0.3, 0.04, 1.3, 0.5, 1.35, 'gold'],
];
const retailPark = (): Op[] => {
  const fas: Color[] = ['red', 'boxBlue', 'boxOrange'];
  return [
    ground(3, 3, 'stone'),
    ...range(3).flatMap((i): Op[] => [
      ...block(0.88, 0.55, 1.0, -0.95 + i * 0.95, -0.9, i === 1 ? 'grey' : 'white'),
      ['box', 0.88, 0.1, 0.03, -0.95 + i * 0.95, 0.45, -0.385, fas[i]], ['box', 0.4, 0.3, 0.015, -0.95 + i * 0.95, 0.02, -0.39, 'glass'],
    ]),
    ...carPark(0, 0.55, 2.8, 1.6, 6),
    ...treeRow(-1.3, 1.3, 1.38, 6, 0.55),
    ...signBoard(1.25, -0.25, 0.4, 'navy', 'white', 0, 0.4),
  ];
};
const deckMall = (): Op[] => [
  ground(3, 3, 'stone'),
  ...block(2.8, 0.8, 1.6, 0, -0.6, 'pale'), ...bands(2.8, 1.6, 0, -0.6, 0.25, 0.8, 1, 'cream'),
  ['box', 2.2, 0.32, 0.015, 0.1, 0.04, 0.205, 'glass'],
  ...block(1.2, 0.5, 1.0, -0.8, 0.85, 'grey', 0, 'dark', 'none'), ['box', 1.2, 0.02, 1.0, -0.8, 0.25, 0.85, 'grey'],
  ...carPark(-0.8, 0.85, 1.1, 0.9, 1).map((o): Op => (o[0] === 'box' ? ['box', o[1], o[2], o[3], o[4], (o[5] as number) + 0.5, o[6], o[7], o[8]] : o)),
  ...block(0.8, 2.2, 0.8, 0.9, -0.9, 'glassDark', 0.825), ...bands(0.8, 0.8, 0.9, -0.9, 0.825, 3.025, 7, 'silver'),
  ...treeRow(0.4, 1.3, 1.2, 3, 0.55),
];
const domeCentre = (): Op[] => [
  ground(3, 3, 'stone'),
  ...block(2.6, 1.1, 1.8, 0, -0.5, 'white'), ...bands(2.6, 1.8, 0, -0.5, 0.3, 1.1, 2, 'glass'),
  ['cyl', 0.6, 0.6, 0.3, 0, 1.125, -0.5, 'glass', 16], ['cone', 0.62, 0.55, 0, 1.425, -0.5, 'glassDark', 16],
  ['box', 1.2, 0.4, 0.02, 0, 0.02, 0.405, 'glass'], ['box', 1.4, 0.04, 0.3, 0, 0.45, 0.55, 'charcoal'],
  ['cyl', 0.24, 0.24, 0.05, 0, 0.02, 1.0, 'stone', 14], ['cyl', 0.2, 0.2, 0.055, 0, 0.02, 1.0, 'pond', 14], ['cyl', 0.02, 0.04, 0.2, 0, 0.02, 1.0, 'stone', 6],
  ...tree(-1.0, 0.9, 0.7), ...tree(1.0, 0.9, 0.7), ...tree(-0.6, 1.25, 0.6), ...tree(0.6, 1.25, 0.6),
];

export const comCentre: KindDef = {
  ...base, id: 'com-centre', name: 'shopping centre', kindId: 77, minLevel: 5,
  footprint: { w: 3, h: 3, door: [1, 2] },
  attrs: { commerceType: 'mall', openHours: [9, 21] },
  levels: [
    { ...shops(100, 27, 5, 9, 150, 24, 60), feature: 'level5', designs: [
      { name: 'mall with a glass-roofed atrium, two anchor stores and a car park', height: 1.0, ops: mall() },
      { name: 'retail park of three sheds round a car park', height: 0.65, ops: retailPark() },
    ] },
    { ...shops(120, 29, 6, 9, 180, 30, 90), feature: 'level6', designs: [
      { name: 'mall with a rooftop car-park deck and an office tower', height: 3.05, ops: deckMall() },
      { name: 'white shopping centre with a glass dome and a fountain plaza', height: 1.98, ops: domeCentre() },
    ] },
  ],
};

// ================================================================= 2×2 hotel tower, levels 6-7

const porteCochere = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.8, 0.35, 1.2, 0, -0.35, 'stone'),
  ...block(1.1, 2.8, 0.8, 0, -0.45, 'cream', 0.375), ...fins(1.1, 0.8, 0, -0.45, 0.4, 2.7, 9, 'white'),
  ['box', 0.8, 0.03, 0.5, 0, 0.3, 0.55, 'gold'], ...repeat(2, (i): Op => ['cyl', 0.015, 0.015, 0.28, -0.35 + i * 0.7, 0.02, 0.75, 'gold', 6]),
  ['box', 0.7, 0.16, 0.04, 0, 3.2, -0.05, 'red', 'venue'],
  ...treeRow(-0.85, 0.85, 0.85, 2, 0.5),
];
const artDeco = (): Op[] => {
  const s = stepped(0, -0.2, 0, [[1.5, 1.6, 1.3], [1.1, 0.9, 0.95], [0.7, 0.6, 0.6]], 'stone', 'dark', 'gold', 0.3);
  return [ground(2, 2, 'stone'), ...s.ops, ...spire(0, s.top, -0.2, 0.4, 0.05, 'gold'), ['box', 0.9, 0.04, 0.3, 0, 0.3, 0.6, 'gold'], ...treeRow(-0.85, 0.85, 0.85, 2, 0.5)];
};
const skyBar = (): Op[] => {
  const s = stepped(0, -0.1, 0, [[1.6, 0.4, 1.4], [1.0, 3.6, 1.0]], 'glassDark', 'dark', 'silver', 0.22);
  return [
    ground(2, 2, 'stone'), ...s.ops,
    ['box', 1.06, 0.18, 1.06, 0, s.top, -0.1, 'glass', 'venue'], ['box', 1.1, 0.02, 1.1, 0, s.top + 0.18, -0.1, 'dark'],
    ...spire(0, s.top + 0.2, -0.1, 0.6), ['box', 0.8, 0.03, 0.4, 0, 0.36, 0.75, 'charcoal'],
  ];
};
const sail = (): Op[] => {
  const tiers: [number, number, number, number][] = [[1.5, 0.9, 1.6, -0.15], [1.4, 1.0, 1.3, -0.3], [1.3, 1.0, 1.0, -0.45], [1.1, 0.9, 0.7, -0.6], [0.9, 0.6, 0.4, -0.75]];
  const out: Op[] = [ground(2, 2, 'pond'), ['box', 1.9, 0.03, 0.6, 0, 0, 0.68, 'sand']];
  let y = 0;
  for (const [w, h, d, z] of tiers) { out.push(['box', w, h, d, 0, y, z, 'white', true], ['box', w + 0.02, 0.02, d + 0.02, 0, y + h, z, 'glass']); y += h + 0.02; }
  out.push(...spire(0, y, -0.75, 0.5, 0.04, 'white'), ['cyl', 0.16, 0.16, 0.02, 0.3, 0.9, 0.5, 'dark', 12]);
  return out;
};

export const comHotel: KindDef = {
  ...base, id: 'com-hotel', name: 'hotel tower', kindId: 78, minLevel: 6,
  footprint: { w: 2, h: 2, door: [1, 1] },
  attrs: { commerceType: 'hotel', openHours: [0, 24] },
  occupation: {
    name: 'hotel worker', rotate: true,
    shifts: [{ start: 6, hours: 8, weight: 0.4 }, { start: 14, hours: 8, weight: 0.35 }, { start: 22, hours: 8, weight: 0.25 }],
    cycles: [[1, 1, 1, 1, 1, 0, 0], [1, 1, 0, 1, 1, 1, 0], [0, 0, 1, 1, 1, 1, 1]],
  },
  levels: [
    { ...shops(60, 30, 6, 4, 60, 8, 50), feature: 'level6', designs: [
      { name: 'cream hotel tower with white fins, a porte-cochère and a red roof sign', height: 3.4, ops: porteCochere() },
      { name: 'art-deco hotel with gold bands and a stepped crown', height: 3.65, ops: artDeco() },
    ] },
    { ...shops(72, 32, 7, 4, 80, 8, 60), feature: 'level7', designs: [
      { name: 'dark glass hotel tower with a lit sky bar and a spire', height: 5.05, ops: skyBar() },
      { name: 'white sail-shaped resort tower over a lagoon', height: 5.0, ops: sail() },
    ] },
  ],
};

export const COMMERCIAL_MERGED: KindDef[] = [comParade, comStore, comCentre, comHotel];
