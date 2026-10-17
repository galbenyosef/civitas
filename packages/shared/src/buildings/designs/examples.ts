import type { ExtraDesign } from './index';

/**
 * The worked examples of docs/buildings.md "Brief for AI designers": one house, one shop and one factory built with
 * facades and the helper ops. Drafts (viewer only); buildings:check keeps them compiling and free of window collisions.
 */
export const FACADE_EXAMPLES: ExtraDesign[] = [
  { kind: 'residential', level: 2, design: { name: 'example: brick semi with a bay and a balcony', height: 0.74, draft: true, author: 'docs example', ops: [
    ['box', 0.56, 0.5, 0.5, 0, 0, 0, 'brick', true, { name: 'house', facade: { storeys: 2, bays: 3 } }],
    ['roof', 0.62, 0.22, 0.56, 0, 0.5, 0, 'slate'],
    ['door', 'house', 'front', 1],
    ['baywindow', 'house', 'front', 0, 0],
    ['balcony', 'house', 'front', 1, 2, 2],
    ['cornice', 'house', 1],
    ['box', 0.07, 0.16, 0.07, -0.18, 0.56, -0.12, 'chimney'],
  ] } },
  { kind: 'commercial', level: 1, design: { name: 'example: corner shop with a flat above', height: 0.56, draft: true, author: 'docs example', ops: [
    ['box', 0.64, 0.48, 0.52, 0, 0, -0.06, 'cream', true, { name: 'shop', facade: { storeys: 2, bays: 3, sideBays: 2 } }],
    ['box', 0.68, 0.04, 0.56, 0, 0.48, -0.06, 'dark'],
    ['awning', 'shop', 'front', 0, 2, 'awning'],
    ['door', 'shop', 'right', 1, 'green'],
    ['cornice', 'shop', 1, 'green'],
    ['box', 0.12, 0.1, 0.12, 0.18, 0.52, -0.18, 'plant'],
  ] } },
  { kind: 'industrial', level: 1, design: { name: 'example: brick works with loading doors', height: 0.62, draft: true, author: 'docs example', ops: [
    ['box', 0.76, 0.36, 0.6, 0, 0, -0.04, 'brick', true, { name: 'hall', facade: { storeys: 1, bays: 4, sideBays: 3 } }],
    ['roof', 0.8, 0.16, 0.64, 0, 0.36, -0.04, 'corrugated'],
    ['garage', 'hall', 'front', 1],
    ['garage', 'hall', 'front', 2],
    ['door', 'hall', 'front', 0],
    ['box', 0.2, 0.2, 0.16, 0.28, 0, 0.38, 'grey', 'office', { name: 'office', facade: { storeys: 1, bays: 2, sideBays: 1, ground: 'door' } }], // a gatehouse office, clear of the hall's wall
    ['chimneyStack', -0.26, 0.36, -0.2, 0.26, 0.05],
  ] } },
];
