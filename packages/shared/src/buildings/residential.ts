import type { KindDef, Op } from './schema';
import { Zone } from './codes';

export const residential: KindDef = {
  id: 'residential', name: 'residential', code: Zone.Residential, family: 'residential',
  flags: { growable: true },
  windows: 'home',
  tool: { id: 'res', key: '4', label: 'Residential', color: 'var(--res)' },
  blurb: 'Homes. Zoned land grows into houses, then terraces, then apartment blocks (levels 1 to 3) when there are more jobs than people and builders can reach it. Each resident takes the nearest job anywhere on the road network and pays property tax to whoever owns the land they live on.',
  howTo: 'Drag Residential (4) over land you own beside a road; there is nothing to place. A builders\' yard must reach the lots by road. Levels 2 and 3 need Masonry and Steel frame, and the top level wants police, fire or health cover nearby; parks and venues help it grow.',
  attrs: { style: 'mixed', rentBand: 'low' },
  tints: [0xffffff, 0xffd9b8, 0xfff0b3, 0xcfe3f7, 0xd6ebc9, 0xf7cfcf, 0xf2e6ff, 0xffe4c4],
  lotTint: 0x8fe07a,
  levels: [
    {
      capacity: 4, work: 60, parking: { surface: 4, underground: 4 },
      attrs: { style: 'house', rentBand: 'low' },
      designs: [
        { name: 'cottage, pitched roof and chimney', height: 0.52, ops: [
          ['box', 0.5, 0.3, 0.42, 0, 0, 0, 'cream', true, { name: 'house', facade: { storeys: 1, bays: 3, sideBays: 2 } }],
          ['roof', 0.58, 0.22, 0.5, 0, 0.3, 0, 'terracotta'],
          ['box', 0.07, 0.16, 0.07, 0.15, 0.32, -0.1, 'chimney'],
          ['door', 'house', 'front', 2],
        ] },
        { name: 'bungalow with carport', height: 0.44, ops: [
          // the top band keeps the side windows below the carport roof
          ['box', 0.62, 0.26, 0.4, -0.05, 0, 0, 'tan', true, { name: 'house', facade: { storeys: 1, bays: 4, sideBays: 2, top: 0.06 } }],
          ['roof', 0.7, 0.18, 0.48, -0.05, 0.26, 0, 'slate', true],
          ['box', 0.22, 0.02, 0.32, 0.34, 0.2, 0.04, 'grey'],
          ['box', 0.02, 0.2, 0.02, 0.43, 0, 0.18, 'steel'], ['box', 0.02, 0.2, 0.02, 0.43, 0, -0.1, 'steel'],
          ['door', 'house', 'front', 1],
        ] },
        { name: 'tall narrow cottage, steep roof, dormer, porch', height: 0.66, ops: [
          ['box', 0.4, 0.36, 0.46, 0, 0, 0, 'white', true],
          ['roof', 0.46, 0.3, 0.52, 0, 0.36, 0, 'terracotta', true],
          ['box', 0.12, 0.1, 0.1, 0.1, 0.4, 0.14, 'white'], ['roof', 0.14, 0.07, 0.12, 0.1, 0.5, 0.14, 'terracotta'],
          ['box', 0.08, 0.14, 0.02, -0.08, 0, 0.23, 'door'], ['box', 0.44, 0.02, 0.1, 0, 0.17, 0.27, 'dark'],
          ['box', 0.06, 0.14, 0.06, -0.13, 0.36, -0.14, 'chimney'],
        ] },
        { name: 'L-shaped brick house', height: 0.5, ops: [
          ['box', 0.5, 0.3, 0.3, -0.05, 0, -0.1, 'brick', true],
          ['roof', 0.56, 0.2, 0.36, -0.05, 0.3, -0.1, 'slate'],
          ['box', 0.26, 0.3, 0.3, 0.12, 0, 0.17, 'brick', true],
          ['roof', 0.32, 0.2, 0.34, 0.12, 0.3, 0.17, 'slate', true],
          ['box', 0.09, 0.14, 0.02, -0.15, 0, 0.05, 'door'], ['box', 0.06, 0.14, 0.06, -0.22, 0.32, -0.12, 'chimney'],
        ] },
      ],
    },
    {
      capacity: 8, work: 120, parking: { surface: 8, underground: 8 }, feature: 'level2',
      attrs: { style: 'townhouse', rentBand: 'mid' },
      designs: [
        { name: 'brick townhouse', height: 0.66, ops: [
          ['box', 0.64, 0.5, 0.56, 0, 0, 0, 'brick', true, { name: 'house', facade: { storeys: 2, bays: 5 } }],
          ['roof', 0.7, 0.16, 0.62, 0, 0.5, 0, 'slate', true],
          ['door', 'house', 'front', 3], ['door', 'house', 'front', 1],
          ['box', 0.06, 0.14, 0.06, -0.22, 0.55, 0.12, 'chimney'],
        ] },
        { name: 'duplex, two tones, flat parapet roof', height: 0.56, ops: [
          ['box', 0.32, 0.52, 0.56, -0.17, 0, 0, 'cream', true, { name: 'west', facade: { storeys: 2, bays: 2 } }],
          ['box', 0.32, 0.52, 0.56, 0.17, 0, 0, 'tan', true, { name: 'east', facade: { storeys: 2, bays: 2 } }],
          ['box', 0.68, 0.04, 0.6, 0, 0.52, 0, 'dark'],
          ['door', 'west', 'front', 1], ['door', 'east', 'front', 0],
          ['box', 0.26, 0.02, 0.1, 0, 0.2, 0.32, 'dark'],
        ] },
        { name: 'timber-framed gable with cross wing', height: 0.72, ops: [
          ['box', 0.64, 0.44, 0.5, 0, 0, 0, 'white', true],
          ['roof', 0.7, 0.28, 0.56, 0, 0.44, 0, 'timber'],
          ['box', 0.66, 0.03, 0.52, 0, 0.22, 0, 'timber'],
          ['box', 0.26, 0.5, 0.24, 0.14, 0, 0.2, 'white', true],
          ['roof', 0.3, 0.22, 0.28, 0.14, 0.5, 0.2, 'timber', true],
          ['box', 0.1, 0.17, 0.02, -0.15, 0, 0.25, 'door'], ['box', 0.07, 0.18, 0.07, -0.2, 0.5, -0.1, 'chimney'],
        ] },
        { name: 'modern stacked boxes with picture window', height: 0.63, ops: [
          ['box', 0.64, 0.3, 0.56, 0, 0, 0, 'pale', true], ['box', 0.5, 0.3, 0.46, 0.07, 0.3, -0.05, 'white', true],
          ['box', 0.52, 0.03, 0.48, 0.07, 0.6, -0.05, 'dark'],
          ['box', 0.3, 0.14, 0.02, -0.1, 0.08, 0.28, 'glass'], ['box', 0.1, 0.17, 0.02, 0.18, 0, 0.28, 'door'],
          ['box', 0.24, 0.02, 0.12, -0.2, 0.3, 0.26, 'dark'],
        ] },
      ],
    },
    {
      capacity: 12, work: 180, parking: { surface: 12, underground: 12 }, feature: 'level3',
      attrs: { style: 'apartments', rentBand: 'high' },
      designs: [
        { name: 'cream block with rooftop setback', height: 1.36, ops: [
          ['box', 0.74, 1.0, 0.74, 0, 0, 0, 'cream', true],
          ['box', 0.78, 0.04, 0.78, 0, 1.0, 0, 'dark'],
          ['box', 0.5, 0.22, 0.5, 0, 1.04, 0, 'grey', true],
          ['box', 0.14, 0.1, 0.14, 0.12, 1.26, -0.1, 'dark'],
          ['box', 0.3, 0.03, 0.12, 0, 0.25, 0.42, 'dark'],
        ] },
        { name: 'brick walk-up with water tank', height: 1.2, ops: [
          ['box', 0.78, 0.9, 0.7, 0, 0, 0, 'brick', true, { name: 'block', facade: { storeys: 3, bays: 5, ground: 'door' } }], ['box', 0.82, 0.04, 0.74, 0, 0.9, 0, 'dark'],
          ['box', 0.3, 0.16, 0.3, -0.15, 0.94, -0.1, 'grey'],
          ['cyl', 0.09, 0.09, 0.16, 0.22, 1.0, 0.15, 'brown', 8], ['cone', 0.1, 0.05, 0.22, 1.16, 0.15, 'dark', 8],
          ['box', 0.14, 0.06, 0.14, 0.22, 0.94, 0.15, 'dark'],
          ['box', 0.3, 0.03, 0.12, 0, 0.26, 0.4, 'dark'],
        ] },
        { name: 'slab with balconies and a lift room', height: 1.4, ops: [
          ['box', 0.86, 1.2, 0.5, 0, 0, -0.1, 'mint', true], ['box', 0.88, 0.04, 0.54, 0, 1.2, -0.1, 'dark'],
          ...[0.3, 0.6, 0.9].flatMap((y): Op[] => [
            ['box', 0.8, 0.03, 0.14, 0, y, 0.22, 'white'], ['box', 0.8, 0.06, 0.015, 0, y + 0.03, 0.285, 'dark'],
          ]),
          ['box', 0.2, 0.14, 0.2, 0.25, 1.24, -0.15, 'grey'],
        ] },
        { name: 'tower on a podium with a dark service core', height: 1.65, ops: [
          ['box', 0.7, 0.2, 0.7, 0, 0, 0, 'stone', true],
          ['box', 0.56, 1.3, 0.56, 0, 0.2, 0, 'pale', true], ['box', 0.2, 1.36, 0.2, -0.2, 0.2, -0.2, 'dark'],
          ['box', 0.6, 0.05, 0.6, 0, 1.5, 0, 'white'], ['box', 0.3, 0.1, 0.3, 0.05, 1.55, 0.05, 'grey'],
        ] },
      ],
    },
  ],
};
