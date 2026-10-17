import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { office } from './office';
import { helipad } from './tierkit';
import { range } from "./zonekit";
import { block, bands, fins, stepped, tree, treeRow, ground, spire, roofPlant, carPark } from './zonekit';

/**
 * Merged office lots (zones.ts, docs/buildings.md "Merged lots"): a business centre, an office tower and, at the top,
 * a corporate campus (level 6) or a supertall (level 7). Grown from neighbouring office lots, never placed. Ids 79-81.
 */
const work = (level: number, area: number) => Math.round(60 * level * area * 0.6);
const base = {
  code: Zone.Office, family: 'office' as const, flags: { growable: true, workplace: true }, windows: 'office' as const,
  tints: office.tints, lotTint: office.lotTint, occupation: office.occupation, lot: { wage: 14 },
};
const desks = (capacity: number, wage: number, level: number, area: number, surface: number, underground: number) =>
  ({ capacity, wage, work: work(level, area), parking: { surface, underground } });

// ================================================================= 2×1 business centre, levels 2-3

const businessCentre = (): Op[] => [
  ground(2, 1, 'stone'),
  ...block(1.8, 0.7, 0.62, 0, -0.1, 'pale'), ...bands(1.8, 0.62, 0, -0.1, 0, 0.7, 2, 'dark', 0.02),
  ['box', 0.44, 0.8, 0.3, 0.2, 0.02, 0.18, 'glass', true], ['box', 0.46, 0.02, 0.32, 0.2, 0.82, 0.18, 'dark'],
  ['box', 0.3, 0.05, 0.02, -0.5, 0.55, 0.215, 'navy'], ...roofPlant(-0.6, 0.725, -0.2, 3),
  ...tree(-0.88, 0.36, 0.5), ...tree(0.85, 0.36, 0.5),
];
const warehouseOffices = (): Op[] => [
  ground(2, 1, 'stone'),
  ...block(1.86, 0.8, 0.66, 0, -0.08, 'brick', 0, 'charcoal'), ...bands(1.86, 0.66, 0, -0.08, 0, 0.8, 2, 0xa85a3c, 0.025),
  ['roof', 1.88, 0.18, 0.68, 0, 0.825, -0.08, 'slate'],
  ['box', 0.3, 0.34, 0.02, 0, 0.02, 0.255, 'glassDark'], ['box', 0.36, 0.04, 0.12, 0, 0.36, 0.3, 'charcoal'],
  ['box', 0.08, 0.22, 0.08, 0.7, 0.9, -0.15, 'chimney'],
  ...repeat(3, (i): Op => ['box', 0.12, 0.2, 0.08, -0.7 + i * 0.25, 0.85, 0.1, 'slate']),
];
const glassPair = (): Op[] => [
  ground(2, 1, 'stone'),
  ...block(0.8, 1.3, 0.7, -0.52, -0.08, 'glassDark'), ...bands(0.8, 0.7, -0.52, -0.08, 0, 1.3, 4, 'silver'),
  ...block(0.8, 1.1, 0.7, 0.52, -0.08, 'pale'), ...bands(0.8, 0.7, 0.52, -0.08, 0, 1.1, 3, 'dark'),
  ['box', 0.24, 0.14, 0.4, 0, 0.6, -0.08, 'glass', true], ['box', 0.24, 0.32, 0.3, 0, 0.02, 0.1, 'glass', true],
];
const chambers = (): Op[] => [
  ground(2, 1, 'stone'),
  ...block(1.86, 1.1, 0.62, 0, -0.14, 'stone'), ...bands(1.86, 0.62, 0, -0.14, 0.3, 1.1, 3, 'cream', 0.015),
  ['box', 0.9, 0.04, 0.3, 0, 0.02, 0.32, 'stone'],
  ...repeat(6, (i): Op => ['cyl', 0.025, 0.03, 0.4, -0.375 + i * 0.15, 0.06, 0.38, 'white', 8]),
  ['box', 0.9, 0.04, 0.26, 0, 0.46, 0.34, 'stone'], ['roof', 0.9, 0.12, 0.24, 0, 0.5, 0.34, 'stone'],
  ['box', 0.1, 0.2, 0.02, 0, 0.06, 0.175, 'door'],
];

export const offCentre: KindDef = {
  ...base, id: 'off-centre', name: 'business centre', kindId: 79, minLevel: 2,
  footprint: { w: 2, h: 1, door: [0, 0] },
  levels: [
    { ...desks(36, 26, 2, 2, 2, 20), feature: 'level2', designs: [
      { name: 'two-storey business centre with a glass entrance hall', height: 0.84, ops: businessCentre() },
      { name: 'converted brick warehouse offices under a slate roof', height: 1.12, ops: warehouseOffices() },
    ] },
    { ...desks(52, 32, 3, 2, 2, 30), feature: 'level3', designs: [
      { name: 'glass and white office pair joined by a bridge', height: 1.33, ops: glassPair() },
      { name: 'stone chambers with a columned portico', height: 1.13, ops: chambers() },
    ] },
  ],
};

// ================================================================= 2×2 office tower, levels 4-5

const podiumTower = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.8, 0.4, 1.6, 0, -0.1, 'stone'),
  ...block(1.2, 3.0, 1.2, 0, -0.15, 'glassDark', 0.425), ...bands(1.2, 1.2, 0, -0.15, 0.425, 3.425, 13, 'silver'),
  ['box', 0.9, 0.18, 0.9, 0, 3.45, -0.15, 'dark', true], ...roofPlant(-0.2, 3.63, -0.2, 2),
  ...treeRow(-0.85, 0.85, 0.86, 4, 0.5),
];
const steppedStone = (): Op[] => {
  const s = stepped(0, -0.15, 0, [[1.6, 1.4, 1.5], [1.2, 1.2, 1.1], [0.8, 1.0, 0.7]], 'stone', 'dark', 'pale', 0.2);
  return [ground(2, 2, 'stone'), ...s.ops, ...spire(0, s.top, -0.15, 0.25, 0.04), ...treeRow(-0.85, 0.85, 0.86, 3, 0.5)];
};
const twinGlass = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.8, 0.35, 1.4, 0, -0.2, 'charcoal'),
  ...block(0.72, 3.8, 0.9, -0.5, -0.3, 'glass', 0.375), ...bands(0.72, 0.9, -0.5, -0.3, 0.375, 4.175, 16, 'white'),
  ...block(0.72, 3.4, 0.9, 0.5, -0.3, 'glass', 0.375), ...bands(0.72, 0.9, 0.5, -0.3, 0.375, 3.775, 14, 'white'),
  ['box', 0.3, 0.16, 0.4, 0, 2.6, -0.3, 'steel', true],
  ...spire(-0.5, 4.2, -0.3, 0.3, 0.03), ...treeRow(-0.85, 0.85, 0.86, 3, 0.5),
];
const diagrid = (): Op[] => [
  ground(2, 2, 'stone'),
  ...block(1.3, 4.2, 1.3, 0, -0.15, 'glassDark'),
  ...range(10).flatMap((i): Op[] => [
    ['box', 1.32, 0.03, 0.03, 0, 0.3 + i * 0.4, -0.15 + 0.655, 'white'],
    ['box', 0.03, 0.03, 1.32, -0.655, 0.3 + i * 0.4 + 0.2, -0.15, 'white'], ['box', 0.03, 0.03, 1.32, 0.655, 0.3 + i * 0.4 + 0.2, -0.15, 'white'],
  ]),
  ...fins(1.3, 1.3, 0, -0.15, 4.0, 0.45, 8, 'white'), ['box', 1.1, 0.06, 1.1, 0, 4.4, -0.15, 'white', 'office'],
  ['box', 0.9, 0.03, 0.4, 0, 0.32, 0.72, 'charcoal'],
];

export const offTower: KindDef = {
  ...base, id: 'off-tower', name: 'office tower', kindId: 80, minLevel: 4,
  footprint: { w: 2, h: 2, door: [1, 1] },
  levels: [
    { ...desks(112, 36, 4, 4, 4, 60), feature: 'level4', designs: [
      { name: 'dark glass tower on a stone podium', height: 3.75, ops: podiumTower() },
      { name: 'stepped stone tower with a short spire', height: 3.95, ops: steppedStone() },
    ] },
    { ...desks(136, 38, 5, 4, 4, 75), feature: 'level5', designs: [
      { name: 'twin glass towers with a steel sky bridge', height: 4.5, ops: twinGlass() },
      { name: 'diagrid tower with a lit white crown', height: 4.46, ops: diagrid() },
    ] },
  ],
};

// ================================================================= 3×3 corporate campus (6) and supertall (7)

const campus = (): Op[] => [
  ground(3, 3, 'lawn'),
  ...block(2.8, 0.9, 0.55, 0, -1.1, 'glass'), ...bands(2.8, 0.55, 0, -1.1, 0, 0.9, 2, 'white'),
  ...block(0.55, 0.7, 1.4, -1.1, -0.1, 'white'), ...block(0.55, 0.7, 1.4, 1.1, -0.1, 'white'),
  ...block(0.6, 1.8, 0.6, 0, -1.0, 'glassDark', 0), ...spire(0, 1.825, -1.0, 0.25, 0.03),
  ['cyl', 0.42, 0.42, 0.03, 0.1, 0.02, 0.0, 'pond', 16], ...tree(-0.45, -0.3, 0.75), ...tree(-0.4, 0.4, 0.7), ...tree(0.6, 0.55, 0.65),
  ...carPark(0, 1.12, 2.6, 0.6, 4),
];
const ring = (): Op[] => [
  ground(3, 3, 'stone'),
  ...block(2.6, 0.9, 0.5, 0, -1.0, 'pale'), ...block(2.6, 0.9, 0.5, 0, 1.0, 'pale'),
  ...block(0.5, 0.9, 1.5, -1.05, 0, 'pale'), ...block(0.5, 0.9, 1.5, 1.05, 0, 'pale'),
  ...bands(2.6, 0.5, 0, 1.0, 0, 0.9, 2, 'glassDark'), ...bands(2.6, 0.5, 0, -1.0, 0, 0.9, 2, 'glassDark'),
  ['box', 0.4, 0.4, 0.04, 0, 0.02, 1.25, 'glass'],
  ...block(0.8, 2.4, 0.8, 0, 0, 'glassDark'), ...bands(0.8, 0.8, 0, 0, 0, 2.4, 9, 'silver'), ...helipad(0, 2.43, 0, 0.3),
];
const supertall = (): Op[] => {
  const s = stepped(0, -0.1, 0, [[2.0, 0.6, 2.0], [1.3, 3.0, 1.3], [1.1, 2.2, 1.1], [0.8, 1.2, 0.8]], 'glassDark', 'dark', 'silver', 0.2);
  return [ground(3, 3, 'stone'), ...s.ops, ...fins(0.8, 0.8, 0, -0.1, s.top - 1.0, 0.95, 6, 'white'), ...spire(0, s.top, -0.1, 1.0, 0.06), ...treeRow(-1.2, 1.2, 1.3, 5, 0.6)];
};
const setbackSupertall = (): Op[] => {
  const s = stepped(0, -0.2, 0, [[1.6, 3.2, 1.6], [1.25, 2.0, 1.25], [0.75, 1.0, 0.75]], 'pale', 'dark', 'glassDark', 0.2);
  return [
    ground(3, 3, 'stone'), ...s.ops,
    ['cyl', 0.3, 0.3, 0.3, 0, s.top, -0.2, 'white', 12], ...helipad(0, s.top + 0.3, -0.2, 0.28),
    ['box', 2.4, 0.04, 0.6, 0, 0.02, 1.0, 'pond'], ...treeRow(-1.2, 1.2, 1.35, 5, 0.55), ...tree(-1.2, 0.4, 0.6), ...tree(1.2, 0.4, 0.6),
  ];
};

export const offHq: KindDef = {
  ...base, id: 'off-hq', name: 'corporate headquarters', kindId: 81, minLevel: 6,
  footprint: { w: 3, h: 3, door: [1, 2] },
  levels: [
    { ...desks(310, 40, 6, 9, 30, 150), feature: 'level6', designs: [
      { name: 'corporate campus: glass wings round a lawn and a lake', height: 2.1, ops: campus() },
      { name: 'headquarters ring round a court with a helipad tower', height: 2.5, ops: ring() },
    ] },
    { ...desks(360, 44, 7, 9, 10, 190), feature: 'level7', designs: [
      { name: 'supertall in dark glass with setbacks and a spire', height: 8.05, ops: supertall() },
      { name: 'pale setback supertall with a helipad crown', height: 6.65, ops: setbackSupertall() },
    ] },
  ],
};

export const OFFICE_MERGED: KindDef[] = [offCentre, offTower, offHq];
