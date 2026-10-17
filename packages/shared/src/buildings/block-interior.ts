import type { KindDef, Op, Color, FacadeSpec } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { residential } from './residential';
import { commercial } from './commercial';
import { office } from './office';
import { industrial } from './industrial';
import { hedge, roofPlant, tree, ground, range, lorry, tank, sawtooth } from './zonekit';
import { car } from './tierkit';

/**
 * Block interiors (docs/buildings.md "Block interiors"). A block between roads is typically 4×4 tiles: the twelve edge
 * tiles have frontage, the 2×2 in the middle has none, so nothing grows there on its own. Two things use it:
 *
 * - **Deep plots** (ids 86-89): merged lots 1 wide and 2 deep, levels 2-4. A frontage building grows back into the landlocked lot
 *   of its zone and owner behind it, keeping its door on the road (server/src/sim/simulation.ts `planMerge`, with the
 *   landlocked rule in sim/blocks.ts). Levels 2-3 have the numbers of each family's 2×1 form (terrace row, parade, business
 *   centre, workshop row) and level 4 half those of its 2×2 form, so the merged-lot rules hold.
 * - **Communal garden** (id 90, park family): when all twelve edge tiles of a block are homes, the residents plant the
 *   2×2 middle as a shared garden (sim/blocks.ts). A small park counted only by the homes round it.
 *
 * Every design is authored for its whole footprint, +z towards the road (for the garden, towards its gate side).
 */
const work = (level: number, area: number) => Math.round(60 * level * area * 0.6);
const DEEP = { w: 1, h: 2, door: [0, 1] as [number, number] };

// ================================================================= residential deep plot, levels 2-3

const resBase = { code: Zone.Residential, family: 'residential' as const, flags: { growable: true }, windows: 'home' as const, tints: residential.tints, lotTint: residential.lotTint };
const homes = (capacity: number, level: number, style: string, rentBand: 'low' | 'mid' | 'high') =>
  ({ capacity, work: work(level, 2), parking: { surface: Math.round(capacity * 0.7), underground: capacity }, attrs: { style, rentBand } });

/** A lit box with a facade (docs/buildings.md "Facades"), standing on the plot's ground slab. */
const fb = (name: string, w: number, h: number, d: number, x: number, z: number, color: Color, facade: FacadeSpec, y = 0.02): Op =>
  ['box', w, h, d, x, y, z, color, true, { name, facade }];

const backWing = (): Op[] => [
  ground(1, 2, 'lawn'),
  ['box', 0.12, 0.021, 0.2, 0, 0, 0.88, 'stone'],
  fb('house', 0.84, 0.42, 0.54, 0, 0.43, 'brick', { storeys: 2, bays: 3, ground: 'door' }),
  ['roof', 0.86, 0.2, 0.6, 0, 0.44, 0.43, 'slate'], ['box', 0.06, 0.14, 0.06, 0.28, 0.52, 0.36, 'chimney'],
  fb('wing', 0.44, 0.34, 0.62, -0.17, -0.42, 0xb86a48, { storeys: 2, bays: 2, sideBays: 3 }),
  ['roof', 0.46, 0.14, 0.64, -0.17, 0.36, -0.42, 'slate', true],
  ['box', 0.2, 0.004, 0.46, 0.27, 0.02, -0.35, 'stone'],
  ['box', 0.16, 0.13, 0.14, 0.28, 0.02, -0.84, 'timber'], ['roof', 0.18, 0.05, 0.16, 0.28, 0.15, -0.84, 'green'],
  ...tree(-0.3, -0.88, 0.55), ...tree(0.3, -0.56, 0.45),
  hedge(-0.25, 0.95, 0.4),
];
const backland = (): Op[] => [
  ground(1, 2, 'lawn'),
  ['box', 0.16, 0.021, 1.9, 0.36, 0, 0, 'gravel'],
  fb('front', 0.62, 0.36, 0.46, -0.1, 0.5, 'cream', { storeys: 2, bays: 3, ground: 'door' }),
  ['roof', 0.64, 0.2, 0.52, -0.1, 0.38, 0.5, 'terracotta'], ['box', 0.06, 0.12, 0.06, -0.3, 0.46, 0.44, 'chimney'],
  fb('back', 0.62, 0.3, 0.42, -0.1, -0.5, 'tan', { storeys: 1, bays: 3, ground: 'door' }),
  ['roof', 0.64, 0.18, 0.48, -0.1, 0.32, -0.5, 'terracotta'], ['box', 0.06, 0.1, 0.06, 0.1, 0.4, -0.56, 'chimney'],
  hedge(-0.1, 0.02, 0.6), ...tree(-0.36, -0.9, 0.42), ...tree(0.36, -0.9, 0.4),
  ['box', 0.14, 0.05, 0.06, 0.36, 0.02, 0.92, 'timber'],
];
const lightWell = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('front', 0.86, 0.84, 0.64, 0, 0.56, 'brick', { storeys: 3, bays: 3, ground: 'door', top: 0.06 }),
  ['roof', 0.88, 0.18, 0.66, 0, 0.86, 0.56, 'slate'], ['box', 0.06, 0.14, 0.06, 0.3, 0.94, 0.5, 'chimney'],
  fb('rear', 0.86, 0.64, 0.56, 0, -0.6, 0xb86a48, { storeys: 3, bays: 3, top: 0.04 }),
  ['box', 0.88, 0.025, 0.58, 0, 0.66, -0.6, 'dark'], ...roofPlant(-0.2, 0.685, -0.6, 3, 0.09),
  ['box', 0.22, 0.3, 0.44, -0.32, 0.02, -0.04, 'brick'], ['box', 0.24, 0.02, 0.46, -0.32, 0.32, -0.04, 'dark'],
  ['box', 0.44, 0.012, 0.44, 0.18, 0.02, -0.04, 'lawnDark'], ...tree(0.18, -0.04, 0.4),
];
const mansionFlats = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('flats', 0.9, 0.98, 0.7, 0, 0.5, 'cream', { storeys: 4, bays: 4, ground: 'door', top: 0.04 }),
  ['balcony', 'flats', 'front', 2, 0, 3], ['balcony', 'flats', 'front', 3, 1, 2],
  ['box', 0.92, 0.025, 0.72, 0, 1.0, 0.5, 'dark'],
  fb('wing', 0.6, 0.76, 0.66, 0.12, -0.5, 'pale', { storeys: 3, bays: 3 }),
  ['box', 0.56, 0.02, 0.62, 0.12, 0.78, -0.5, 'lawn'], ...tree(0.02, -0.55, 0.4, 0.8), ...tree(0.24, -0.38, 0.35, 0.8),
  ['box', 0.2, 0.012, 0.6, -0.37, 0.02, -0.5, 'lawnDark'], ['box', 0.04, 0.05, 0.14, -0.4, 0.04, -0.6, 'timber'],
];
const deepMansion = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('front', 0.9, 1.2, 0.66, 0, 0.55, 'brick', { storeys: 4, bays: 4, ground: 'door', top: 0.04 }),
  ['cornice', 'front', 1], ['box', 0.92, 0.025, 0.68, 0, 1.22, 0.55, 'stone'],
  fb('rear', 0.86, 1.0, 0.6, 0, -0.58, 0xb86a48, { storeys: 4, bays: 3, top: 0.04 }),
  ['box', 0.88, 0.025, 0.62, 0, 1.02, -0.58, 'dark'], ...roofPlant(-0.25, 1.045, -0.58, 2, 0.1),
  ['box', 0.8, 0.012, 0.46, 0, 0.02, -0.03, 'lawn'], ...tree(-0.2, -0.03, 0.5), ...tree(0.22, 0.0, 0.42),
];
const deepApartments = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('apts', 0.6, 1.12, 1.76, -0.16, 0, 'cream', { storeys: 4, bays: 2, sideBays: 7, ground: 'door', top: 0.04 }),
  ['balcony', 'apts', 'right', 1, 1, 5], ['balcony', 'apts', 'right', 3, 1, 5],
  ['box', 0.62, 0.025, 1.78, -0.16, 1.14, 0, 'dark'],
  ['box', 0.16, 0.004, 1.8, 0.38, 0.02, 0, 'gravel'], ...tree(0.38, -0.7, 0.45), ...tree(0.38, 0.1, 0.4),
];

export const resDeep: KindDef = {
  ...resBase, id: 'res-deep', name: 'deep-plot house', kindId: 86, minLevel: 2,
  footprint: DEEP,
  levels: [
    { ...homes(18, 2, 'house with a back wing', 'mid'), feature: 'level2', designs: [
      { name: 'brick house with a two-storey back wing, a shed and a side path', height: 0.66, ops: backWing() },
      { name: 'cottage at the front and a backland cottage down a side passage', height: 0.64, ops: backland() },
    ] },
    { ...homes(26, 3, 'deep townhouse', 'high'), feature: 'level3', designs: [
      { name: 'brick townhouse and rear block round a planted light well', height: 1.08, ops: lightWell() },
      { name: 'cream mansion flats with a rear wing and a roof garden', height: 1.03, ops: mansionFlats() },
    ] },
    { ...homes(32, 4, 'deep mansion block', 'high'), feature: 'level4', designs: [
      { name: 'four-storey brick mansion block and rear range round a garden court', height: 1.25, ops: deepMansion() },
      { name: 'cream apartment block running deep with balconies down its side', height: 1.17, ops: deepApartments() },
    ] },
  ],
};

// ================================================================= commercial deep plot, levels 2-3

const comBase = {
  code: Zone.Commercial, family: 'commercial' as const, flags: { growable: true, workplace: true, leisureReady: true }, windows: 'shop' as const,
  tints: commercial.tints, lotTint: commercial.lotTint, occupation: commercial.occupation, attrs: { commerceType: 'shop', openHours: [7, 22] as [number, number] }, lot: { wage: 10 },
};
const shops = (capacity: number, wage: number, level: number, visitorCapacity: number, surface: number, underground: number) =>
  ({ capacity, wage, work: work(level, 2), parking: { surface, underground }, attrs: { visitorCapacity } });

const van = (x: number, z: number, body: Color): Op[] => [
  ['box', 0.28, 0.12, 0.13, x, 0.03, z, body], ['box', 0.09, 0.09, 0.12, x + 0.19, 0.03, z, 'red'], ['box', 0.02, 0.04, 0.1, x + 0.235, 0.08, z, 'glassDark'],
];
const stockroom = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('shop', 0.9, 0.5, 0.58, 0, 0.6, 'cream', { storeys: 2, bays: 4, ground: 'shopfront', top: 0.06 }),
  ['awning', 'shop', 'front', 0, 3], ['box', 0.7, 0.04, 0.02, 0, 0.47, 0.9, 'signBlue'],
  ['box', 0.72, 0.3, 0.6, -0.08, 0.02, -0.2, 'corrugated'], ['roof', 0.74, 0.08, 0.62, -0.08, 0.32, -0.2, 'roofGrey', true],
  ['box', 0.9, 0.012, 0.3, 0, 0.02, -0.8, 0x3a3d44], ...van(-0.06, -0.8, 'white'),
  ['box', 0.08, 0.1, 0.08, 0.4, 0.02, -0.25, 'boxGreen'], ['box', 0.08, 0.1, 0.08, 0.4, 0.02, -0.37, 'grey'],
];
const beerGarden = (): Op[] => [
  ground(1, 2, 'lawn'),
  fb('pub', 0.9, 0.46, 0.56, 0, 0.6, 0x7a2e2a, { storeys: 2, bays: 3, ground: 'shopfront' }),
  ['roof', 0.92, 0.18, 0.6, 0, 0.48, 0.6, 'slate'], ['box', 0.06, 0.16, 0.06, -0.3, 0.56, 0.55, 'chimney'],
  ['cyl', 0.008, 0.008, 0.3, 0.42, 0.02, 0.96, 'charcoal', 4], ['box', 0.1, 0.1, 0.012, 0.42, 0.22, 0.96, 'gold'],
  fb('alley', 0.28, 0.2, 0.7, -0.29, -0.5, 'timber', { storeys: 1, bays: 1, sideBays: 4 }),
  ['roof', 0.3, 0.08, 0.72, -0.29, 0.22, -0.5, 'green', true],
  ['box', 0.5, 0.004, 0.86, 0.2, 0.02, -0.45, 'gravel'],
  ...range(3).flatMap((i): Op[] => [
    ['box', 0.12, 0.04, 0.08, 0.2, 0.024, -0.12 - i * 0.28, 'timber'],
    ['cyl', 0.006, 0.006, 0.12, 0.2, 0.06, -0.12 - i * 0.28, 'steel', 4],
    ['cone', 0.1, 0.05, 0.2, 0.17, -0.12 - i * 0.28, i % 2 ? 'cream' : 'awning', 8],
  ]),
  ...tree(0.36, -0.88, 0.45),
];
const marketHall = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('front', 0.94, 0.76, 0.44, 0, 0.62, 'stone', { storeys: 3, bays: 4, ground: 'shopfront', top: 0.08 }),
  ['awning', 'front', 'front', 0, 3, 'green'], ['box', 0.5, 0.05, 0.02, 0, 0.715, 0.85, 'green'],
  ['box', 0.06, 0.1, 0.06, -0.4, 0.78, 0.62, 'gold'], ['box', 0.06, 0.1, 0.06, 0.4, 0.78, 0.62, 'gold'],
  fb('hall', 0.84, 0.42, 1.2, 0, -0.3, 'brick', { storeys: 1, bays: 3, sideBays: 6 }),
  ['roof', 0.88, 0.24, 1.22, 0, 0.44, -0.3, 'slate', true], ['box', 0.16, 0.06, 1.0, 0, 0.64, -0.3, 'glass'],
];
const smallSupermarket = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('store', 0.92, 0.42, 1.1, 0, 0.35, 'white', { storeys: 1, bays: 4, sideBays: 0, ground: 'shopfront', top: 0.12 }),
  ['box', 0.8, 0.08, 0.02, 0, 0.335, 0.91, 'red'], ['box', 0.94, 0.03, 1.12, 0, 0.44, 0.35, 'dark'],
  ...roofPlant(-0.25, 0.47, 0.1, 3, 0.1),
  ['box', 0.9, 0.012, 0.6, 0, 0.02, -0.65, 0x3a3d44], ...van(-0.12, -0.68, 'red'),
  ['box', 0.1, 0.12, 0.1, 0.38, 0.02, -0.45, 'grey'], ['box', 0.1, 0.12, 0.1, 0.38, 0.02, -0.58, 'boxBlue'],
];
const deepStore = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('store', 0.92, 0.9, 0.8, 0, 0.44, 'cream', { storeys: 3, bays: 4, ground: 'shopfront', top: 0.1 }),
  ['awning', 'store', 'front', 0, 3, 'navy'], ['box', 0.6, 0.06, 0.02, 0, 0.84, 0.845, 'gold'],
  fb('hall', 0.86, 0.6, 0.72, 0, -0.56, 'pale', { storeys: 2, bays: 3 }),
  ['box', 0.88, 0.025, 0.74, 0, 0.62, -0.56, 'dark'], ['box', 0.5, 0.08, 0.5, 0, 0.645, -0.56, 'glass'],
];
const glassArcade = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('west', 0.3, 0.62, 1.7, -0.31, 0, 'cream', { storeys: 2, bays: 1, sideBays: 7, top: 0.06 }),
  fb('east', 0.3, 0.62, 1.7, 0.31, 0, 'cream', { storeys: 2, bays: 1, sideBays: 7, top: 0.06 }),
  ['box', 0.3, 0.03, 1.7, 0, 0.6, 0, 'glass'], ['box', 0.03, 0.06, 1.7, 0, 0.63, 0, 'steel'],
  ['box', 0.26, 0.012, 1.7, 0, 0.02, 0, 'gravel'],
  ['box', 0.26, 0.08, 0.02, 0, 0.5, 0.85, 'gold'],
];

export const comDeep: KindDef = {
  ...comBase, id: 'com-deep', name: 'deep-plot shop', kindId: 87, minLevel: 2,
  footprint: DEEP,
  levels: [
    { ...shops(14, 20, 2, 24, 2, 12), feature: 'level2', designs: [
      { name: 'corner shop with a long stockroom and a loading bay behind', height: 0.56, ops: stockroom() },
      { name: 'pub with a beer garden and a skittle alley out the back', height: 0.82, attrs: { commerceType: 'pub', openHours: [11, 24] }, ops: beerGarden() },
    ] },
    { ...shops(20, 25, 3, 36, 2, 18), feature: 'level3', designs: [
      { name: 'covered market hall reaching back from a stone shopfront', height: 0.92, attrs: { commerceType: 'market' }, ops: marketHall() },
      { name: 'small supermarket with a service yard behind', height: 0.5, attrs: { commerceType: 'supermarket' }, ops: smallSupermarket() },
    ] },
    { ...shops(22, 27, 4, 30, 3, 20), feature: 'level4', designs: [
      { name: 'three-storey store with a top-lit hall behind', height: 0.92, attrs: { commerceType: 'department' }, ops: deepStore() },
      { name: 'glass-roofed shopping arcade running back from the street', height: 0.69, ops: glassArcade() },
    ] },
  ],
};

// ================================================================= office deep plot, levels 2-3

const offBase = {
  code: Zone.Office, family: 'office' as const, flags: { growable: true, workplace: true }, windows: 'office' as const,
  tints: office.tints, lotTint: office.lotTint, occupation: office.occupation, lot: { wage: 14 },
};
const desks = (capacity: number, wage: number, level: number, surface: number, underground: number) =>
  ({ capacity, wage, work: work(level, 2), parking: { surface, underground } });

const annexe = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('front', 0.9, 0.6, 0.54, 0, 0.6, 'pale', { storeys: 2, bays: 5, ground: 'door', top: 0.04 }),
  ['box', 0.92, 0.025, 0.56, 0, 0.62, 0.6, 'dark'],
  fb('annexe', 0.76, 0.44, 0.54, 0, -0.55, 'white', { storeys: 2, bays: 4 }),
  ['box', 0.78, 0.02, 0.56, 0, 0.46, -0.55, 'dark'], ...roofPlant(-0.15, 0.48, -0.55, 2, 0.1),
  ['box', 0.6, 0.012, 0.36, 0, 0.02, 0.03, 'lawn'], ...tree(-0.2, 0.03, 0.42), ['box', 0.12, 0.02, 0.04, 0.18, 0.04, 0.03, 'timber'],
];
const coachHouse = (): Op[] => [
  ground(1, 2, 'gravel'),
  fb('front', 0.9, 0.64, 0.52, 0, 0.62, 'cream', { storeys: 3, bays: 3, ground: 'door' }),
  ['porch', 'front', 'front', 1, 1], ['roof', 0.92, 0.18, 0.56, 0, 0.66, 0.62, 'slate'],
  fb('coach', 0.8, 0.3, 0.46, 0, -0.62, 'brick', { storeys: 1, bays: 3, ground: 'garage' }),
  ['roof', 0.82, 0.16, 0.5, 0, 0.32, -0.62, 'slate'],
  ...car(-0.2, -0.05, 'navy'), ...car(0.2, -0.08, 'silver'),
];
const atriumOffice = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('office', 0.9, 1.06, 1.7, 0, 0, 'pale', { storeys: 5, bays: 5, ground: 'door', top: 0.04 }),
  ['box', 0.92, 0.025, 1.72, 0, 1.08, 0, 'dark'],
  ['box', 0.4, 0.06, 0.7, 0, 1.105, -0.1, 'glass'], ...roofPlant(-0.25, 1.105, 0.6, 2, 0.1),
];
const chambersRear = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('front', 0.9, 0.84, 0.54, 0, 0.55, 'stone', { storeys: 3, bays: 4, ground: 'door', top: 0.06 }),
  ['porch', 'front', 'front', 1, 2, 'stone', 'white'], ['cornice', 'front', 3],
  fb('rear', 0.8, 1.08, 0.74, 0, -0.5, 'glassDark', { storeys: 5, bays: 4 }),
  ['box', 0.82, 0.025, 0.76, 0, 1.1, -0.5, 'steel'],
];
const deepSlab = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('base', 0.9, 0.3, 1.7, 0, 0, 'stone', { storeys: 1, bays: 4, sideBays: 8, ground: 'door' }),
  fb('upper', 0.86, 0.9, 1.6, 0, 0, 'glassDark', { storeys: 4, bays: 4, sideBays: 8, top: 0.04 }, 0.32),
  ['box', 0.88, 0.025, 1.62, 0, 1.22, 0, 'steel'], ...roofPlant(-0.2, 1.245, -0.4, 3, 0.1),
];
const millOffices = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('mill', 0.9, 1.0, 1.7, 0, 0, 'brick', { storeys: 4, bays: 3, sideBays: 7, ground: 'door' }),
  ['roof', 0.46, 0.2, 1.72, -0.22, 1.02, 0, 'slate', true], ['roof', 0.46, 0.2, 1.72, 0.22, 1.02, 0, 'slate', true],
  ...[[-0.2, -0.6]].flatMap(([x, z]): Op[] => [['box', 0.14, 0.12, 0.14, x, 1.12, z, 'dark'], ['cyl', 0.07, 0.07, 0.14, x, 1.24, z, 'brown', 8]]),
];

export const offDeep: KindDef = {
  ...offBase, id: 'off-deep', name: 'deep-plot office', kindId: 88, minLevel: 2,
  footprint: DEEP,
  levels: [
    { ...desks(36, 26, 2, 2, 20), feature: 'level2', designs: [
      { name: 'office with a glass link to a white annexe behind', height: 0.66, ops: annexe() },
      { name: 'Georgian front office with a converted coach house behind', height: 0.86, ops: coachHouse() },
    ] },
    { ...desks(52, 32, 3, 2, 30), feature: 'level3', designs: [
      { name: 'deep-plan office with fins and a glazed atrium roof', height: 1.19, ops: atriumOffice() },
      { name: 'stone chambers with a glass block reaching back', height: 1.14, ops: chambersRear() },
    ] },
    { ...desks(56, 36, 4, 2, 30), feature: 'level4', designs: [
      { name: 'deep office slab, dark glass on a stone base', height: 1.25, ops: deepSlab() },
      { name: 'twin-gabled brick mill converted to offices', height: 1.38, ops: millOffices() },
    ] },
  ],
};

// ================================================================= industrial deep plot, levels 2-3

const indBase = {
  code: Zone.Industrial, family: 'industrial' as const, flags: { growable: true, workplace: true }, windows: 'factory' as const,
  tints: industrial.tints, lotTint: industrial.lotTint, occupation: industrial.occupation, attrs: { goodsType: 'manufactured' }, lot: { wage: 9 },
};
const jobs = (capacity: number, wage: number, level: number, surface: number, underground: number, pollution: number, noise: number) =>
  ({ capacity, wage, work: work(level, 2), parking: { surface, underground }, attrs: { pollution, noise } });
const pallets = (x: number, z: number, n: number, color: Color = 'timber'): Op[] =>
  repeat(n, (i) => ['box', 0.1, 0.03 + (i % 3) * 0.03, 0.1, x + (i % 2) * 0.12, 0.02, z - Math.floor(i / 2) * 0.12, color]);

const yardWorkshop = (): Op[] => [
  ground(1, 2, 'gravel'),
  fb('shed', 0.9, 0.36, 0.66, 0, 0.55, 'corrugated', { storeys: 2, bays: 3, ground: 'garage' }),
  ['roof', 0.92, 0.1, 0.68, 0, 0.38, 0.55, 'roofGrey'],
  ['box', 0.9, 0.06, 0.02, 0, 0.02, -0.97, 'charcoal'], ['box', 0.02, 0.06, 1.0, -0.45, 0.02, -0.48, 'charcoal'], ['box', 0.02, 0.06, 1.0, 0.45, 0.02, -0.48, 'charcoal'],
  ['box', 0.3, 0.2, 0.28, -0.22, 0.02, -0.7, 'rust'], ...pallets(0.12, -0.3, 5), ...pallets(0.12, -0.7, 3, 'boxBlue'),
];
const sprayShop = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('garage', 0.9, 0.34, 0.6, 0, 0.57, 'brick', { storeys: 1, bays: 2, ground: 'garage', top: 0.08 }),
  ['box', 0.7, 0.05, 0.02, 0, 0.29, 0.88, 'signBlue'], ['box', 0.92, 0.025, 0.62, 0, 0.36, 0.57, 'dark'],
  fb('spray', 0.8, 0.3, 0.6, 0, -0.52, 'white', { storeys: 1, bays: 3 }),
  ['roof', 0.82, 0.08, 0.62, 0, 0.32, -0.52, 'roofGrey', true],
  ['cyl', 0.04, 0.04, 0.3, 0.25, 0.4, -0.6, 'steel', 8], ['cyl', 0.05, 0.04, 0.03, 0.25, 0.7, -0.6, 'charcoal', 8],
  ...car(-0.2, 0.0, 'red', true),
];
const longWorks = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('works', 0.88, 0.5, 1.76, 0, 0, 'corrugated', { storeys: 2, bays: 3, sideBays: 8, ground: 'garage' }),
  ...sawtooth(0, 0.52, 0, 0.88, 1.76, 3, 'roofGrey'),
  ['box', 0.04, 0.3, 0.04, -0.42, 0.64, -0.6, 'yellow'], ['box', 0.04, 0.3, 0.04, 0.42, 0.64, -0.6, 'yellow'], ['box', 0.9, 0.05, 0.05, 0, 0.94, -0.6, 'yellow'],
  ['chimneyStack', 0.3, 0.64, 0.4, 0.3, 0.035],
];
const bakeryWorks = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('bakery', 0.9, 0.46, 0.78, 0, 0.5, 'brick', { storeys: 2, bays: 4, ground: 'garage', top: 0.08 }),
  ['box', 0.6, 0.05, 0.02, 0, 0.415, 0.9, 'cream'], ['box', 0.92, 0.025, 0.8, 0, 0.48, 0.5, 'dark'],
  ...tank(-0.22, -0.55, 0.13, 0.62, 'silver'), ...tank(0.12, -0.6, 0.13, 0.62, 'white'),
  ['box', 0.04, 0.04, 0.5, -0.05, 0.55, -0.2, 'steel'],
  ...lorry(0.32, -0.62, 'cream'),
];
const craneBay = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('bay', 0.9, 0.62, 1.76, 0, 0, 'corrugated', { storeys: 2, bays: 3, sideBays: 8, ground: 'garage' }),
  ['roof', 0.92, 0.14, 1.78, 0, 0.64, 0, 'roofGrey', true],
  ['box', 0.04, 0.26, 0.04, -0.42, 0.78, 0.5, 'yellow'], ['box', 0.04, 0.26, 0.04, 0.42, 0.78, 0.5, 'yellow'], ['box', 0.9, 0.05, 0.06, 0, 1.04, 0.5, 'yellow'],
  ['chimneyStack', -0.25, 0.78, -0.6, 0.4, 0.04],
];
const coldStore = (): Op[] => [
  ground(1, 2, 'stone'),
  fb('front', 0.9, 0.5, 0.6, 0, 0.6, 'white', { storeys: 2, bays: 3, ground: 'garage', top: 0.08 }),
  ['box', 0.6, 0.05, 0.02, 0, 0.445, 0.905, 'signBlue'],
  ['box', 0.86, 0.7, 1.0, 0, 0.02, -0.42, 'silver'], ['box', 0.88, 0.025, 1.02, 0, 0.72, -0.42, 'dark'],
  ...repeat(3, (i): Op => ['box', 0.16, 0.08, 0.16, -0.28 + i * 0.28, 0.745, -0.42, 'plant']),
];

export const indDeep: KindDef = {
  ...indBase, id: 'ind-deep', name: 'deep-plot works', kindId: 89, minLevel: 2,
  footprint: DEEP,
  levels: [
    { ...jobs(26, 19, 2, 4, 16, 2, 3), feature: 'level2', designs: [
      { name: 'roller-door workshop with a fenced yard and a store behind', height: 0.48, ops: yardWorkshop() },
      { name: 'garage with a spray shop and its extractor behind', height: 0.73, attrs: { goodsType: 'repairs' }, ops: sprayShop() },
    ] },
    { ...jobs(38, 24, 3, 4, 24, 3, 3), feature: 'level3', designs: [
      { name: 'long sawtooth works shed with a gantry over the back', height: 0.99, ops: longWorks() },
      { name: 'bakery works with flour silos behind', height: 0.81, attrs: { goodsType: 'food' }, ops: bakeryWorks() },
    ] },
    { ...jobs(46, 27, 4, 5, 25, 2, 4), feature: 'level4', designs: [
      { name: 'deep crane-bay works with a gantry over the yard door', height: 1.09, ops: craneBay() },
      { name: 'cold store: a loading front and an insulated block behind', height: 0.83, attrs: { goodsType: 'food' }, ops: coldStore() },
    ] },
  ],
};

// ================================================================= communal garden, 2×2 park

const bench = (x: number, z: number, alongX = true): Op[] => [
  ['box', alongX ? 0.12 : 0.04, 0.02, alongX ? 0.04 : 0.12, x, 0.04, z, 'timber'],
  ['box', alongX ? 0.12 : 0.012, 0.03, alongX ? 0.012 : 0.12, x - (alongX ? 0 : 0.02), 0.06, z - (alongX ? 0.02 : 0), 'timber'],
];
const lawn = (c: Color = 'lawn'): Op => ['box', 1.96, 0.012, 1.96, 0, 0, 0, c];
const path = (w: number, d: number, x: number, z: number, c: Color = 'gravel'): Op => ['box', w, 0.004, d, x, 0.012, z, c];
const shed = (x: number, z: number, wall: Color, roof: Color): Op[] => [['box', 0.24, 0.16, 0.18, x, 0.012, z, wall], ['roof', 0.27, 0.07, 0.21, x, 0.172, z, roof]];
const bed = (x: number, z: number, w: number, d: number, blooms: Color[]): Op[] => [
  ['box', w, 0.035, d, x, 0.012, z, 'timber'], ['box', w - 0.03, 0.038, d - 0.03, x, 0.012, z, 'brown'],
  ...range(Math.max(2, Math.round(w / 0.1))).map((i): Op => ['cone', 0.03, 0.05, x - w / 2 + 0.05 + i * ((w - 0.1) / Math.max(1, Math.round(w / 0.1) - 1)), 0.05, z, blooms[i % blooms.length], 5]),
];

/** Lawn round a fruit-tree orchard, benches and a tool shed. */
const orchardLawn = (): Op[] => [
  lawn(), path(1.7, 0.1, 0, 0.55), path(0.1, 1.0, -0.2, 0.0),
  ...[[-0.68, -0.6], [-0.22, -0.7], [0.22, -0.48], [0.66, -0.7], [0.6, -0.12], [-0.68, -0.1]].flatMap(([x, z], i) => tree(x, z, 1.0 + (i % 3) * 0.15)),
  ...shed(0.72, 0.78, 'green', 'slate'), ...bench(-0.5, 0.42), ...bench(0.3, 0.42), ...bench(0.0, 0.7),
  ['box', 0.02, 0.18, 0.02, -0.8, 0.012, 0.75, 'steel'], ['box', 0.02, 0.18, 0.02, -0.4, 0.012, 0.75, 'steel'], ['box', 0.4, 0.004, 0.004, -0.6, 0.18, 0.75, 'white'],
  ...repeat(4, (i): Op => ['box', 0.05, 0.06, 0.004, -0.72 + i * 0.08, 0.12, 0.75, (['white', 'signBlue', 'red', 'yellow'] as const)[i]]),
];
/** Allotment beds, a greenhouse, a compost bay and a water butt. */
const allotments = (): Op[] => [
  lawn('lawnDark'), path(0.12, 1.8, 0, 0), path(1.8, 0.1, 0, 0.62),
  ...range(3).flatMap((i) => bed(-0.5, -0.65 + i * 0.4, 0.6, 0.24, i % 2 ? ['red', 'green'] : ['yellow', 'green', 'awning'])),
  ...range(2).flatMap((i) => bed(0.5, -0.65 + i * 0.4, 0.6, 0.24, ['plum', 'green'])),
  ['box', 0.42, 0.2, 0.28, 0.5, 0.012, 0.2, 'glass'], ['roof', 0.44, 0.08, 0.3, 0.5, 0.212, 0.2, 'glass'],
  ['cyl', 0.05, 0.05, 0.12, -0.12, 0.012, 0.78, 'green', 8], ...shed(-0.62, 0.82, 'timber', 'green'),
  ['box', 0.22, 0.08, 0.16, 0.7, 0.012, 0.82, 'brown'], ...bench(0.3, 0.82), ...tree(0.8, -0.8, 1.2), ...tree(-0.84, 0.3, 1.0),
];
/** A play garden: sandpit, swings and a climbing frame under big trees. */
const playGarden = (): Op[] => [
  lawn(), ['cyl', 0.62, 0.62, 0.006, 0, 0.012, 0, 'gravel', 20],
  ['box', 0.34, 0.025, 0.34, -0.3, 0.012, -0.25, 'sand'], ...repeat(4, (i): Op => ['box', i < 2 ? 0.36 : 0.02, 0.035, i < 2 ? 0.02 : 0.36, -0.3 + (i === 2 ? -0.17 : i === 3 ? 0.17 : 0), 0.012, -0.25 + (i === 0 ? -0.17 : i === 1 ? 0.17 : 0), 'timber']),
  ['box', 0.02, 0.22, 0.02, 0.15, 0.012, -0.35, 'red'], ['box', 0.02, 0.22, 0.02, 0.5, 0.012, -0.35, 'red'], ['box', 0.39, 0.02, 0.02, 0.325, 0.23, -0.35, 'red'],
  ['box', 0.07, 0.01, 0.04, 0.24, 0.07, -0.35, 'charcoal'], ['box', 0.07, 0.01, 0.04, 0.41, 0.07, -0.35, 'charcoal'],
  ['box', 0.24, 0.02, 0.24, 0.3, 0.16, 0.25, 'yellow'], ...repeat(4, (i): Op => ['box', 0.02, 0.18, 0.02, 0.19 + (i % 2) * 0.22, 0.012, 0.14 + Math.floor(i / 2) * 0.22, 'signBlue']),
  ['box', 0.08, 0.02, 0.3, 0.3, 0.09, 0.5, 'red'],
  ...tree(-0.74, 0.7, 1.6), ...tree(0.76, -0.76, 1.5), ...tree(-0.78, -0.74, 1.3), ...tree(0.78, 0.7, 1.25),
  ...bench(-0.35, 0.3), ...bench(0.0, -0.7), ...bench(-0.62, 0.0, false),
];
/** A courtyard garden: pergola, lily pond and borders. */
const pondGarden = (): Op[] => [
  lawn(), path(1.5, 0.5, 0, 0.05, 'stone'),
  ['cyl', 0.3, 0.32, 0.03, 0, 0.012, -0.55, 'stone', 16], ['cyl', 0.26, 0.26, 0.032, 0, 0.012, -0.55, 'pond', 16],
  ...repeat(3, (i): Op => ['cyl', 0.03, 0.03, 0.034, -0.1 + i * 0.1, 0.012, -0.5 - (i % 2) * 0.08, 'lawnDark', 8]),
  ...repeat(6, (i): Op => ['box', 0.025, 0.24, 0.025, -0.6 + (i % 3) * 0.6, 0.012, -0.1 + Math.floor(i / 3) * 0.3, 'white']),
  ...repeat(5, (i): Op => ['box', 0.03, 0.02, 0.36, -0.6 + i * 0.3, 0.252, 0.05, 'white']),
  ['box', 1.3, 0.02, 0.06, 0, 0.27, 0.05, 'hedge'],
  ...bed(-0.55, 0.62, 0.7, 0.18, ['plum', 'red', 'yellow']), ...bed(0.55, 0.62, 0.7, 0.18, ['white', 'plum', 'awning']),
  hedge(-0.8, -0.85, 0.3), hedge(0.8, -0.85, 0.3), ...tree(-0.74, -0.6, 1.3), ...tree(0.76, -0.55, 1.15),
  ...bench(-0.3, 0.05), ...bench(0.3, 0.05),
];

export const blockGarden: KindDef = {
  id: 'block-garden', name: 'communal garden', code: 10, kindId: 90, family: 'leisure',
  flags: { civic: true, leisureReady: true }, windows: 'shop',
  footprint: { w: 2, h: 2, door: [0, 1] },
  // a park counted only by the homes round its block (blockOnly, sim/blocks.ts); nobody travels to it (no road reaches it)
  attrs: {
    venueType: 'park', openHours: [6, 22], ticket: 0, stay: [0.5, 1.5], dayAppeal: 1, eveningAppeal: 0.5, retireeAppeal: 1.5, childAppeal: 1.8,
    trees: 0, benches: 0, title: 'communal garden', blockOnly: true,
  },
  cost: 0, work: 300, capacity: 0, parking: { surface: 0, underground: 0 },
  levels: [{
    upkeep: 0, attrs: { visitorCapacity: 1, leisureValue: 3, radius: 4 },
    designs: [
      { name: 'communal lawn with fruit trees, benches, a washing line and a tool shed', height: 0.25, ops: orchardLawn() },
      { name: 'allotment beds with a greenhouse, a water butt and a compost bay', height: 0.29, ops: allotments() },
      { name: 'play garden with a sandpit, swings and a climbing frame under big trees', height: 0.3, ops: playGarden() },
      { name: 'courtyard garden with a pergola, a lily pond and flower borders', height: 0.29, ops: pondGarden() },
    ],
  }],
};

export const BLOCK_INTERIOR: KindDef[] = [resDeep, comDeep, offDeep, indDeep, blockGarden];
