import type { ExtraDesign } from './index';

/**
 * Trial: ten residential designs by claude-haiku-5-5 as it wrote them, with doors, balconies and bay windows as raw
 * boxes over the fixed window grid (drafts, viewer only). Kept as the "before" of the facade comparison: buildings:check
 * lists their window collisions without failing. HAIKU_SAMPLE below is the same massing redone with facades.
 */
export const HAIKU_RAW: ExtraDesign[] = [
  { kind: 'residential', level: 1, design: { name: 'cottage with bay window', height: 0.48, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.46, 0.28, 0.4, 0, 0, 0, 'cream', true],
    ['roof', 0.54, 0.2, 0.48, 0, 0.28, 0, 'terracotta'],
    ['box', 0.16, 0.18, 0.08, -0.12, 0, 0.24, 'pale'],
    ['roof', 0.2, 0.06, 0.12, -0.12, 0.18, 0.24, 'terracotta'],
    ['box', 0.09, 0.15, 0.02, 0.1, 0, 0.21, 'door'],
    ['box', 0.06, 0.18, 0.06, 0.16, 0.28, -0.1, 'chimney'],
  ] } },
  { kind: 'residential', level: 1, design: { name: 'gabled farmhouse with corrugated shed', height: 0.54, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.5, 0.28, 0.36, 0, 0, 0, 'cream', true],
    ['roof', 0.6, 0.26, 0.44, 0, 0.28, 0, 'terracotta', true],
    ['box', 0.14, 0.2, 0.3, 0.32, 0, 0, 'corrugated'],
    ['roof', 0.16, 0.1, 0.34, 0.32, 0.2, 0, 'slate', true],
    ['box', 0.09, 0.15, 0.02, -0.08, 0, 0.19, 'door'],
    ['box', 0.1, 0.1, 0.02, 0.1, 0.1, 0.19, 'glass'],
  ] } },
  { kind: 'residential', level: 1, design: { name: 'modern flat-roof bungalow', height: 0.41, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.56, 0.26, 0.4, 0, 0, 0, 'white', true],
    ['box', 0.6, 0.03, 0.44, 0, 0.26, 0, 'dark'],
    ['box', 0.24, 0.12, 0.2, -0.14, 0.29, -0.05, 'cream', true],
    ['box', 0.3, 0.18, 0.02, 0.1, 0.02, 0.21, 'glass'],
    ['box', 0.09, 0.15, 0.02, -0.16, 0, 0.21, 'door'],
    ['box', 0.08, 0.1, 0.08, 0.33, 0, 0.14, 'green'],
  ] } },
  { kind: 'residential', level: 1, design: { name: 'house with side garage', height: 0.5, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.46, 0.3, 0.36, -0.12, 0, 0, 'tan', true],
    ['roof', 0.5, 0.2, 0.42, -0.12, 0.3, 0, 'slate', true],
    ['box', 0.3, 0.22, 0.36, 0.27, 0, 0, 'brick'],
    ['roof', 0.32, 0.12, 0.4, 0.27, 0.22, 0, 'slate'],
    ['box', 0.22, 0.16, 0.02, 0.27, 0, 0.19, 'steel'],
    ['box', 0.09, 0.15, 0.02, -0.22, 0, 0.19, 'door'],
    ['box', 0.1, 0.1, 0.02, -0.05, 0.1, 0.19, 'glass'],
  ] } },
  { kind: 'residential', level: 2, design: { name: 'terrace pair, brick and cream, gable fronts', height: 0.68, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.4, 0.5, 0.56, -0.2, 0, 0, 'brick', true],
    ['box', 0.4, 0.5, 0.56, 0.2, 0, 0, 'cream', true],
    ['roof', 0.42, 0.18, 0.6, -0.2, 0.5, 0, 'slate', true],
    ['roof', 0.42, 0.18, 0.6, 0.2, 0.5, 0, 'slate', true],
    ['box', 0.09, 0.17, 0.02, -0.2, 0, 0.29, 'door'],
    ['box', 0.09, 0.17, 0.02, 0.2, 0, 0.29, 'door'],
    ['box', 0.12, 0.12, 0.02, -0.2, 0.28, 0.29, 'glass'],
    ['box', 0.12, 0.12, 0.02, 0.2, 0.28, 0.29, 'glass'],
  ] } },
  { kind: 'residential', level: 2, design: { name: 'townhouse with first-floor balcony', height: 0.7, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.5, 0.5, 0.48, 0, 0, 0, 'stone', true],
    ['box', 0.36, 0.03, 0.14, 0, 0.3, 0.31, 'timber'],
    ['box', 0.36, 0.1, 0.02, 0, 0.33, 0.37, 'dark'],
    ['box', 0.12, 0.15, 0.02, 0, 0.33, 0.25, 'glass'],
    ['box', 0.09, 0.16, 0.02, -0.12, 0, 0.25, 'door'],
    ['box', 0.12, 0.12, 0.02, 0.14, 0.08, 0.25, 'glass'],
    ['roof', 0.56, 0.2, 0.6, 0, 0.5, 0, 'slate', true],
  ] } },
  { kind: 'residential', level: 2, design: { name: 'corner house with turret', height: 0.7, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.56, 0.44, 0.5, -0.06, 0, -0.04, 'cream', true],
    ['roof', 0.62, 0.22, 0.56, -0.06, 0.44, -0.04, 'terracotta'],
    ['cyl', 0.1, 0.1, 0.5, 0.2, 0, 0.2, 'stone', 10],
    ['cone', 0.12, 0.2, 0.2, 0.5, 0.2, 'slate', 10],
    ['box', 0.09, 0.15, 0.02, -0.2, 0, 0.22, 'door'],
    ['box', 0.12, 0.12, 0.02, -0.06, 0.2, 0.22, 'glass'],
  ] } },
  { kind: 'residential', level: 3, design: { name: 'brick mansion block, stone cornice, slate attic', height: 1.26, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.74, 1.0, 0.66, 0, 0, 0, 'brick', true],
    ['box', 0.76, 0.05, 0.68, 0, 0.5, 0, 'stone'],
    ['box', 0.78, 0.04, 0.7, 0, 1.0, 0, 'stone'],
    ['box', 0.52, 0.22, 0.46, 0, 1.04, 0, 'slate', true],
    ['box', 0.14, 0.22, 0.02, 0, 0, 0.34, 'door'],
    ['box', 0.24, 0.03, 0.1, 0, 0.22, 0.38, 'dark'],
  ] } },
  { kind: 'residential', level: 3, design: { name: 'balcony block with rooftop garden', height: 1.42, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.8, 1.1, 0.5, 0, 0, 0, 'pale', true],
    ['box', 0.72, 0.12, 0.16, 0, 0.3, 0.28, 'white'],
    ['box', 0.72, 0.12, 0.16, 0, 0.6, 0.28, 'white'],
    ['box', 0.72, 0.12, 0.16, 0, 0.9, 0.28, 'white'],
    ['box', 0.14, 0.2, 0.02, 0, 0, 0.26, 'door'],
    ['box', 0.7, 0.1, 0.4, 0, 1.1, 0, 'green'],
    ['cone', 0.1, 0.22, -0.2, 1.2, 0, 'hedge', 8],
    ['cone', 0.08, 0.16, 0.2, 1.2, 0.05, 'lawn', 8],
  ] } },
  { kind: 'residential', level: 3, design: { name: 'narrow tower with water tank', height: 1.76, draft: true, author: 'claude-haiku-5-5 (raw)', ops: [
    ['box', 0.4, 1.3, 0.4, 0, 0, 0, 'grey', true],
    ['box', 0.44, 0.04, 0.44, 0, 1.3, 0, 'dark'],
    ['box', 0.16, 0.1, 0.16, 0.12, 1.34, 0.1, 'dark'],
    ['cyl', 0.1, 0.1, 0.24, 0.12, 1.44, 0.1, 'brown', 8],
    ['cone', 0.12, 0.08, 0.12, 1.68, 0.1, 'dark', 8],
    ['box', 0.1, 0.16, 0.02, -0.1, 0, 0.2, 'door'],
  ] } },
];

/**
 * The same ten designs, massing and names kept, with every windowed wall on a facade grid and doors, balconies, bay
 * windows, porches and cornices placed by cell (docs/buildings.md "Facades"), so nothing sits over a window.
 */
export const HAIKU_SAMPLE: ExtraDesign[] = [
  { kind: 'residential', level: 1, design: { name: 'cottage with bay window', height: 0.48, draft: true, author: 'claude-haiku-5-5', ops: [
    ['box', 0.46, 0.28, 0.4, 0, 0, 0, 'cream', true, { name: 'house', facade: { storeys: 1, bays: 3, sideBays: 2 } }],
    ['roof', 0.54, 0.2, 0.48, 0, 0.28, 0, 'terracotta'],
    ['baywindow', 'house', 'front', 0, 0, 'terracotta'],
    ['door', 'house', 'front', 2],
    ['box', 0.06, 0.18, 0.06, 0.16, 0.28, -0.1, 'chimney'],
  ] } },
  { kind: 'residential', level: 1, design: { name: 'gabled farmhouse with corrugated shed', height: 0.54, draft: true, author: 'claude-haiku-5-5', ops: [
    // the shed stands against the right wall, so the gable ends stay blank
    ['box', 0.5, 0.28, 0.36, 0, 0, 0, 'cream', true, { name: 'house', facade: { storeys: 1, bays: 3, sideBays: 0, ground: 'door' } }],
    ['roof', 0.6, 0.26, 0.44, 0, 0.28, 0, 'terracotta', true],
    ['box', 0.14, 0.2, 0.3, 0.32, 0, 0, 'corrugated'],
    ['roof', 0.16, 0.1, 0.34, 0.32, 0.2, 0, 'slate', true],
  ] } },
  { kind: 'residential', level: 1, design: { name: 'modern flat-roof bungalow', height: 0.41, draft: true, author: 'claude-haiku-5-5', ops: [
    ['box', 0.56, 0.26, 0.4, 0, 0, 0, 'white', true, { name: 'house', facade: { storeys: 1, bays: 4, sideBays: 2 } }],
    ['box', 0.6, 0.03, 0.44, 0, 0.26, 0, 'dark'],
    ['box', 0.24, 0.12, 0.2, -0.14, 0.29, -0.05, 'cream', true, { name: 'study', facade: { storeys: 1, bays: 2, sideBays: 1 } }],
    ['baywindow', 'house', 'front', 0, 2],
    ['door', 'house', 'front', 1],
    ['box', 0.08, 0.1, 0.08, 0.33, 0, 0.24, 'green'],
  ] } },
  { kind: 'residential', level: 1, design: { name: 'house with side garage', height: 0.5, draft: true, author: 'claude-haiku-5-5', ops: [
    // the garage stands against the right wall, so the side walls stay blank
    ['box', 0.46, 0.3, 0.36, -0.12, 0, 0, 'tan', true, { name: 'house', facade: { storeys: 1, bays: 3, sideBays: 0 } }],
    ['roof', 0.5, 0.2, 0.42, -0.12, 0.3, 0, 'slate', true],
    ['box', 0.3, 0.22, 0.36, 0.27, 0, 0, 'brick'],
    ['roof', 0.32, 0.12, 0.4, 0.27, 0.22, 0, 'slate'],
    ['box', 0.22, 0.16, 0.02, 0.27, 0, 0.19, 'steel'],
    ['door', 'house', 'front', 0],
  ] } },
  { kind: 'residential', level: 2, design: { name: 'terrace pair, brick and cream, gable fronts', height: 0.68, draft: true, author: 'claude-haiku-5-5', ops: [
    ['box', 0.4, 0.5, 0.56, -0.2, 0, 0, 'brick', true, { name: 'west', facade: { storeys: 2, bays: 3, ground: 'door' } }],
    ['box', 0.4, 0.5, 0.56, 0.2, 0, 0, 'cream', true, { name: 'east', facade: { storeys: 2, bays: 3, ground: 'door' } }],
    ['roof', 0.42, 0.18, 0.6, -0.2, 0.5, 0, 'slate', true],
    ['roof', 0.42, 0.18, 0.6, 0.2, 0.5, 0, 'slate', true],
  ] } },
  { kind: 'residential', level: 2, design: { name: 'townhouse with first-floor balcony', height: 0.7, draft: true, author: 'claude-haiku-5-5', ops: [
    ['box', 0.5, 0.5, 0.48, 0, 0, 0, 'stone', true, { name: 'house', facade: { storeys: 2, bays: 3 } }],
    ['balcony', 'house', 'front', 1, 0, 2, 'dark', 'timber'],
    ['door', 'house', 'front', 0],
    ['roof', 0.56, 0.2, 0.6, 0, 0.5, 0, 'slate', true],
  ] } },
  { kind: 'residential', level: 2, design: { name: 'corner house with turret', height: 0.7, draft: true, author: 'claude-haiku-5-5', ops: [
    // plain piers at the corners leave room for the turret
    ['box', 0.56, 0.44, 0.5, -0.06, 0, -0.04, 'cream', true, { name: 'house', facade: { storeys: 2, bays: 3, sideBays: 2, margin: 0.12 } }],
    ['roof', 0.62, 0.22, 0.56, -0.06, 0.44, -0.04, 'terracotta'],
    ['cyl', 0.1, 0.1, 0.5, 0.2, 0, 0.2, 'stone', 10],
    ['cone', 0.12, 0.2, 0.2, 0.5, 0.2, 'slate', 10],
    ['door', 'house', 'front', 0],
  ] } },
  { kind: 'residential', level: 3, design: { name: 'brick mansion block, stone cornice, slate attic', height: 1.26, draft: true, author: 'claude-haiku-5-5', ops: [
    ['box', 0.74, 1.0, 0.66, 0, 0, 0, 'brick', true, { name: 'block', facade: { storeys: 4, bays: 5, ground: 'door' } }],
    ['cornice', 'block', 2],
    ['box', 0.78, 0.04, 0.7, 0, 1.0, 0, 'stone'],
    ['box', 0.52, 0.22, 0.46, 0, 1.04, 0, 'slate', true, { name: 'attic', facade: { storeys: 1, bays: 3, sideBays: 2 } }],
    ['porch', 'block', 'front', 2, 2, 'dark'],
  ] } },
  { kind: 'residential', level: 3, design: { name: 'balcony block with rooftop garden', height: 1.42, draft: true, author: 'claude-haiku-5-5', ops: [
    ['box', 0.8, 1.1, 0.5, 0, 0, 0, 'pale', true, { name: 'block', facade: { storeys: 4, bays: 5, ground: 'door' } }],
    ['balcony', 'block', 'front', 1, 0, 4, 'white', 'white'],
    ['balcony', 'block', 'front', 2, 0, 4, 'white', 'white'],
    ['balcony', 'block', 'front', 3, 0, 4, 'white', 'white'],
    ['box', 0.7, 0.1, 0.4, 0, 1.1, 0, 'green'],
    ['cone', 0.1, 0.22, -0.2, 1.2, 0, 'hedge', 8],
    ['cone', 0.08, 0.16, 0.2, 1.2, 0.05, 'lawn', 8],
  ] } },
  { kind: 'residential', level: 3, design: { name: 'narrow tower with water tank', height: 1.76, draft: true, author: 'claude-haiku-5-5', ops: [
    ['box', 0.4, 1.3, 0.4, 0, 0, 0, 'grey', true, { name: 'tower', facade: { storeys: 6, bays: 2, sideBays: 2 } }],
    ['box', 0.44, 0.04, 0.44, 0, 1.3, 0, 'dark'],
    ['box', 0.16, 0.1, 0.16, 0.12, 1.34, 0.1, 'dark'],
    ['cyl', 0.1, 0.1, 0.24, 0.12, 1.44, 0.1, 'brown', 8],
    ['cone', 0.12, 0.08, 0.12, 1.68, 0.1, 'dark', 8],
    ['door', 'tower', 'front', 0],
  ] } },
];
