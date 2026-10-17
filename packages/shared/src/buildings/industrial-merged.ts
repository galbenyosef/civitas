import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { industrial } from './industrial';
import { van } from './tierkit';
import { range } from "./zonekit";
import { block, sawtooth, docks, lorry, tank, coolingTower, pipe, carPark, ground, treeRow, bands } from './zonekit';

/**
 * Merged industrial lots (zones.ts, docs/buildings.md "Merged lots"): a workshop row, a warehouse or distribution
 * centre, a factory complex and the 4×4 heavy plant. Grown from neighbouring industrial lots, never placed. Ids 82-85.
 * `pollution` climbs with size (8-9 for a heavy plant) for the derived-fields card (zones.ts pollutionOf).
 */
const work = (level: number, area: number) => Math.round(60 * level * area * 0.6);
const base = {
  code: Zone.Industrial, family: 'industrial' as const, flags: { growable: true, workplace: true }, windows: 'factory' as const,
  tints: industrial.tints, lotTint: industrial.lotTint, occupation: industrial.occupation, attrs: { goodsType: 'manufactured' }, lot: { wage: 9 },
};
const jobs = (capacity: number, wage: number, level: number, area: number, surface: number, underground: number, pollution: number, noise: number) =>
  ({ capacity, wage, work: work(level, area), parking: { surface, underground }, attrs: { pollution, noise } });
const containers = (x: number, z: number, n: number, stacks: number, alongX = true): Op[] => {
  const cs: Color[] = ['boxBlue', 'boxOrange', 'boxGreen', 'red', 'grey'];
  const out: Op[] = [];
  for (let i = 0; i < n; i++) for (let s = 0; s < stacks; s++) {
    if ((i + s) % 3 === 2 && s > 0) continue;
    out.push(alongX ? ['box', 0.3, 0.1, 0.12, x, 0.02 + s * 0.1, z + i * 0.13, cs[(i * 2 + s) % cs.length]] : ['box', 0.12, 0.1, 0.3, x + i * 0.13, 0.02 + s * 0.1, z, cs[(i * 2 + s) % cs.length]]);
  }
  return out;
};

// ================================================================= 2×1 workshop row, levels 2-3

const workshops = (): Op[] => [
  ground(2, 1, 'grey'),
  ...block(1.84, 0.4, 0.62, 0, -0.12, 'corrugated', 0, null),
  ...repeat(4, (i): Op => ['roof', 0.46, 0.12, 0.64, -0.69 + i * 0.46, 0.42, -0.12, 'roofGrey']),
  ...docks(0, 0.19, 1.84, 4, 'steel'),
  ...van(0.6, 0.36, 'white', 'boxBlue', true), ['box', 0.14, 0.1, 0.1, -0.7, 0.02, 0.34, 'timber'],
];
const brickWorkshops = (): Op[] => [
  ground(2, 1, 'grey'),
  ...block(1.1, 0.45, 0.6, -0.42, -0.15, 'brick', 0, null), ...sawtooth(-0.42, 0.47, -0.15, 1.1, 0.6, 3, 'roofGrey'),
  ['box', 0.3, 0.26, 0.02, -0.42, 0.02, 0.155, 'grey'],
  ['box', 0.68, 0.06, 0.01, 0.6, 0.02, 0.44, 'grey'], ['box', 0.01, 0.06, 0.82, 0.94, 0.02, 0.02, 'grey'],
  ...van(0.4, 0.2, 'white', 'red', true), ...containers(0.72, -0.35, 3, 2, true),
];
const lightIndustrial = (): Op[] => [
  ground(2, 1, 'grey'),
  ...block(1.4, 0.55, 0.7, -0.22, -0.08, 'pale', 0, null), ...sawtooth(-0.22, 0.57, -0.08, 1.4, 0.7, 5, 'roofGrey'),
  ...docks(-0.22, 0.27, 1.3, 3, 'boxBlue'),
  ...block(0.44, 0.75, 0.7, 0.71, -0.08, 'white'), ...bands(0.44, 0.7, 0.71, -0.08, 0, 0.75, 2, 'glassDark', 0.03),
  ...lorry(0.7, 0.18, 'white', true),
];
const bottling = (): Op[] => [
  ground(2, 1, 'grey'),
  ...block(1.1, 0.6, 0.66, -0.4, -0.1, 'cream'), ['roof', 1.12, 0.14, 0.68, -0.4, 0.625, -0.1, 'rust'],
  ...docks(-0.4, 0.23, 1.0, 2, 'grey'),
  ...tank(0.45, -0.18, 0.13, 0.55, 'silver'), ...tank(0.75, -0.18, 0.13, 0.5, 'silver'), ...tank(0.6, 0.22, 0.11, 0.4, 'white'),
  ['chimneyStack', -0.8, 0.02, -0.3, 0.95, 0.05], ...pipe(0.25, -0.18, 0.3, true, 0.35),
];

export const indRow: KindDef = {
  ...base, id: 'ind-row', name: 'workshop row', kindId: 82, minLevel: 2,
  footprint: { w: 2, h: 1, door: [0, 0] },
  levels: [
    { ...jobs(26, 19, 2, 2, 4, 16, 2, 3), feature: 'level2', designs: [
      { name: 'row of four corrugated workshops with roller doors', height: 0.55, ops: workshops() },
      { name: 'brick sawtooth workshops beside a fenced yard', height: 0.6, attrs: { goodsType: 'repairs' }, ops: brickWorkshops() },
    ] },
    { ...jobs(38, 24, 3, 2, 4, 24, 3, 3), feature: 'level3', designs: [
      { name: 'light-industrial units with a sawtooth roof and an office end', height: 0.8, ops: lightIndustrial() },
      { name: 'bottling works with steel tanks and a chimney', height: 1.04, attrs: { goodsType: 'food' }, ops: bottling() },
    ] },
  ],
};

// ================================================================= 2×2 warehouse / distribution centre, levels 3-4

const warehouse = (): Op[] => [
  ground(2, 2, 'grey'),
  ...block(1.8, 0.65, 1.1, 0, -0.42, 'corrugated', 0, null), ['roof', 1.82, 0.16, 1.12, 0, 0.67, -0.42, 'roofGrey'],
  ...docks(0, 0.13, 1.7, 5, 'steel'),
  ...lorry(-0.5, 0.5, 'white'), ...lorry(0.1, 0.55, 'boxBlue'), ...lorry(0.6, 0.62, 'white', true),
];
const coldStore = (): Op[] => [
  ground(2, 2, 'grey'),
  ...block(1.1, 0.75, 1.0, -0.4, -0.45, 'white', 0, 'charcoal'), ...bands(1.1, 1.0, -0.4, -0.45, 0, 0.75, 1, 'boxBlue', 0.05),
  ...docks(-0.4, 0.05, 1.0, 3, 'boxBlue'),
  ...containers(0.45, -0.85, 6, 3, true), ...containers(0.82, -0.85, 6, 2, true),
  ...lorry(-0.4, 0.5, 'white'),
];
const distribution = (): Op[] => [
  ground(2, 2, 'grey'),
  ...block(1.86, 0.8, 1.2, 0, -0.36, 'pale', 0, 'charcoal'), ...bands(1.86, 1.2, 0, -0.36, 0, 0.8, 1, 'boxOrange', 0.06),
  ...docks(0.15, 0.24, 1.5, 8, 'grey'),
  ...block(0.32, 0.6, 0.3, -0.75, 0.39, 'white'),
  ...lorry(-0.3, 0.65, 'white'), ...lorry(0.1, 0.65, 'boxOrange'), ...lorry(0.5, 0.65, 'white'),
];
const highBay = (): Op[] => [
  ground(2, 2, 'grey'),
  ...block(1.1, 1.2, 1.2, -0.4, -0.35, 'grey', 0, 'charcoal'), ...bands(1.1, 1.2, -0.4, -0.35, 0, 1.2, 3, 'roofGrey', 0.02),
  ...docks(-0.4, 0.25, 1.0, 3, 'boxGreen'),
  ...containers(0.48, -0.75, 9, 2, true),
  ['box', 0.05, 0.8, 0.05, 0.3, 0.02, -0.85, 'yellow'], ['box', 0.05, 0.8, 0.05, 0.3, 0.02, 0.45, 'yellow'],
  ['box', 0.05, 0.8, 0.05, 0.9, 0.02, -0.85, 'yellow'], ['box', 0.05, 0.8, 0.05, 0.9, 0.02, 0.45, 'yellow'],
  ['box', 0.66, 0.06, 0.06, 0.6, 0.82, -0.85, 'yellow'], ['box', 0.66, 0.06, 0.06, 0.6, 0.82, 0.45, 'yellow'],
  ['box', 0.08, 0.06, 1.36, 0.6, 0.82, -0.2, 'yellow'], ['box', 0.12, 0.08, 0.12, 0.6, 0.74, -0.3, 'dark'],
  ...lorry(-0.4, 0.62, 'white', true),
];

export const indDepot: KindDef = {
  ...base, id: 'ind-depot', name: 'distribution centre', kindId: 83, minLevel: 3,
  footprint: { w: 2, h: 2, door: [1, 1] },
  attrs: { goodsType: 'freight' },
  levels: [
    { ...jobs(76, 24, 3, 4, 8, 40, 2, 4), feature: 'level3', designs: [
      { name: 'corrugated warehouse with loading docks and lorries', height: 0.83, attrs: { goodsType: 'storage' }, ops: warehouse() },
      { name: 'cold store beside a container yard', height: 0.8, ops: coldStore() },
    ] },
    { ...jobs(92, 27, 4, 4, 10, 50, 2, 4), feature: 'level4', designs: [
      { name: 'distribution centre with eight dock doors and a truck yard', height: 0.83, ops: distribution() },
      { name: 'high-bay warehouse with a gantry crane over its containers', height: 1.22, attrs: { goodsType: 'storage' }, ops: highBay() },
    ] },
  ],
};

// ================================================================= 3×3 factory complex, level 5

const factory = (): Op[] => [
  ground(3, 3, 'grey'),
  ...block(2.6, 0.8, 0.9, -0.1, -0.95, 'brick', 0, null), ...sawtooth(-0.1, 0.82, -0.95, 2.6, 0.9, 8, 'rust'),
  ...block(1.4, 0.7, 0.9, -0.6, 0.2, 'pale', 0, null), ...sawtooth(-0.6, 0.72, 0.2, 1.4, 0.9, 4, 'roofGrey'),
  ...docks(-0.6, 0.65, 1.3, 3, 'grey'),
  ['chimneyStack', 1.1, 0.02, -1.15, 1.9, 0.09], ['chimneyStack', 0.75, 0.02, -1.15, 1.6, 0.08],
  ...tank(0.95, 0.15, 0.17, 0.6), ...tank(0.95, 0.65, 0.17, 0.6), ...tank(0.55, 0.45, 0.13, 0.45, 'white'),
  ...pipe(0.95, -0.4, 0.8, false, 0.5), ...pipe(0.2, -0.3, 0.8, true, 0.55),
  ...lorry(-1.0, 1.05, 'white', true), ...lorry(0.2, 1.1, 'boxBlue', true),
];
const carPlant = (): Op[] => [
  ground(3, 3, 'grey'),
  ...block(2.8, 0.75, 1.1, 0, -0.85, 'white', 0, 'charcoal'), ...bands(2.8, 1.1, 0, -0.85, 0, 0.75, 1, 'navy', 0.05),
  ...block(1.2, 0.6, 0.8, -0.75, 0.2, 'pale', 0, 'charcoal'),
  ['box', 1.3, 0.012, 0.06, 0.65, 0.02, -0.1, 0x3a3d44], ['box', 1.3, 0.012, 0.06, 0.65, 0.02, 0.7, 0x3a3d44],
  ['box', 0.06, 0.012, 0.8, 0.03, 0.02, 0.3, 0x3a3d44], ['box', 0.06, 0.012, 0.8, 1.27, 0.02, 0.3, 0x3a3d44],
  ...carPark(0.65, 0.3, 1.0, 0.6, 2),
  ...carPark(-0.75, 1.05, 1.2, 0.6, 7),
  ['chimneyStack', 1.2, 0.77, -1.2, 0.5, 0.05], ...treeRow(0.4, 1.3, 1.35, 3, 0.5),
];

export const indWorks: KindDef = {
  ...base, id: 'ind-works', name: 'factory complex', kindId: 84, minLevel: 5,
  footprint: { w: 3, h: 3, door: [1, 2] },
  levels: [
    { ...jobs(210, 28, 5, 9, 16, 100, 5, 5), feature: 'level5', designs: [
      { name: 'factory complex: sawtooth halls, two chimneys and a tank farm', height: 1.98, ops: factory() },
      { name: 'car plant with assembly halls and a test track', height: 1.3, attrs: { goodsType: 'vehicles', pollution: 4 }, ops: carPlant() },
    ] },
  ],
};

// ================================================================= 4×4 heavy plant, levels 6-7

const steelworks = (): Op[] => [
  ground(4, 4, 'grey'),
  ['cyl', 0.38, 0.45, 2.0, -0.9, 0.02, -1.0, 'rust', 12], ['cone', 0.38, 0.3, -0.9, 2.02, -1.0, 'charcoal', 12],
  ['cyl', 0.08, 0.08, 0.8, -0.9, 2.2, -1.0, 'chimney', 8],
  ...block(1.4, 0.9, 1.0, 0.6, -1.2, 'rust', 0, null), ['roof', 1.42, 0.2, 1.02, 0.6, 0.92, -1.2, 'roofGrey'],
  ['chimneyStack', 1.5, 0.02, -0.5, 2.6, 0.11], ['chimneyStack', 1.5, 0.02, 0.0, 2.4, 0.1], ['chimneyStack', 1.5, 0.02, 0.5, 2.2, 0.1],
  ...block(2.2, 0.7, 0.8, -0.6, 0.3, 'corrugated', 0, null), ['roof', 2.22, 0.18, 0.82, -0.6, 0.72, 0.3, 'rust'],
  ['cone', 0.35, 0.3, -1.3, 0.02, 1.3, 'rust', 10], ['cone', 0.3, 0.26, -0.6, 0.02, 1.35, 'brown', 10],
  ['box', 0.12, 0.08, 2.0, 0.5, 0.6, 0.6, 'charcoal'], ...pipe(-0.2, -0.3, 1.4, true, 0.9, 0.03),
  ...lorry(0.6, 1.3, 'yellow', true),
];
const chemicals = (): Op[] => [
  ground(4, 4, 'grey'),
  ...range(4).flatMap((i): Op[] => [['cyl', 0.1, 0.12, 2.0 + (i % 2) * 0.4, -1.2 + i * 0.45, 0.02, -1.2, 'silver', 10], ['cyl', 0.13, 0.13, 0.04, -1.2 + i * 0.45, 0.8 + i * 0.1, -1.2, 'charcoal', 10]]),
  ...range(3).flatMap((i) => tank(-1.1 + i * 0.6, 0.6, 0.24, 0.45, i % 2 ? 'white' : 'silver')),
  ...tank(1.2, 0.6, 0.3, 0.5, 'white'),
  ...pipe(0, -0.7, 3.4, true, 0.7, 0.025), ...pipe(0, -0.5, 3.4, true, 0.55, 0.02, 'yellow'), ...pipe(0.6, 0.0, 1.0, false, 0.6),
  ...block(1.0, 0.6, 0.7, 1.2, -1.2, 'pale'),
  ['cyl', 0.02, 0.03, 2.6, 1.6, 0.02, 1.5, 'steel', 6], ['cone', 0.06, 0.18, 1.6, 2.62, 1.5, 'flare', 6],
  ...lorry(-0.6, 1.5, 'white', true), ...lorry(0.4, 1.5, 'silver', true),
];
const powerStation = (): Op[] => [
  ground(4, 4, 'grey'),
  ...coolingTower(-1.05, -1.0, 0.75, 2.2), ...coolingTower(0.6, -1.05, 0.7, 2.0),
  ...block(2.6, 0.9, 0.9, -0.3, 0.4, 'pale', 0, 'charcoal'), ...bands(2.6, 0.9, -0.3, 0.4, 0, 0.9, 2, 'glassDark', 0.03),
  ['box', 0.8, 1.3, 0.8, 1.35, 0.02, 0.4, 'brick', true],
  ['cyl', 0.12, 0.18, 3.4, 1.4, 0.02, -0.4, 'stone', 12], ['cyl', 0.13, 0.13, 0.12, 1.4, 3.42, -0.4, 'red', 12],
  ...pipe(-0.3, 1.2, 3.0, true, 0.35), ['box', 0.06, 1.2, 0.06, -1.6, 0.02, 1.6, 'steel'], ['box', 0.06, 1.2, 0.06, 1.6, 0.02, 1.6, 'steel'],
];
const refinery = (): Op[] => [
  ground(4, 4, 'grey'),
  ...range(5).flatMap((i): Op[] => [['cyl', 0.11, 0.13, 2.2 + (i % 3) * 0.5, -1.4 + i * 0.4, 0.02, -1.0, i % 2 ? 'silver' : 'steel', 10], ['box', 0.3, 0.02, 0.3, -1.4 + i * 0.4, 1.2, -1.0, 'charcoal']]),
  ...range(6).flatMap((i) => tank(-1.35 + (i % 3) * 0.6, 0.55 + Math.floor(i / 3) * 0.75, 0.26, 0.35, 'white')),
  ...pipe(0.0, -0.4, 3.6, true, 0.8, 0.03), ...pipe(0.0, -0.2, 3.6, true, 0.6, 0.02, 'yellow'), ...pipe(0.6, 0.6, 1.4, false, 0.5),
  ['cyl', 0.03, 0.04, 3.2, 1.5, 0.02, 1.3, 'steel', 6], ['cone', 0.08, 0.26, 1.5, 3.22, 1.3, 'flare', 6],
  ...block(0.8, 0.5, 0.6, 1.3, -1.3, 'pale'),
];

export const indPlant: KindDef = {
  ...base, id: 'ind-plant', name: 'heavy plant', kindId: 85, minLevel: 6,
  footprint: { w: 4, h: 4, door: [1, 3] },
  levels: [
    { ...jobs(380, 30, 6, 16, 24, 170, 8, 6), feature: 'level6', designs: [
      { name: 'steelworks with a blast furnace, three stacks and ore heaps', height: 3.0, attrs: { goodsType: 'steel' }, ops: steelworks() },
      { name: 'chemical plant with distillation columns, pipe racks and a flare', height: 2.82, attrs: { goodsType: 'chemicals' }, ops: chemicals() },
    ] },
    { ...jobs(420, 32, 7, 16, 24, 200, 9, 6), feature: 'level7', designs: [
      { name: 'power station with two cooling towers and a tall chimney', height: 3.54, attrs: { goodsType: 'power' }, ops: powerStation() },
      { name: 'refinery with cracking columns, a tank farm and a flare stack', height: 3.48, attrs: { goodsType: 'fuel' }, ops: refinery() },
    ] },
  ],
};

export const INDUSTRIAL_MERGED: KindDef[] = [indRow, indDepot, indWorks, indPlant];
