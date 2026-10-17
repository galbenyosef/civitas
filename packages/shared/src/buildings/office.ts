import type { KindDef, Op } from './schema';
import { Zone } from './codes';

export const office: KindDef = {
  id: 'office', name: 'office', code: Zone.Office, family: 'office',
  flags: { growable: true, workplace: true },
  windows: 'office',
  tool: { id: 'off', key: '7', label: 'Office', color: '#9b7fe0' },
  blurb: 'Office towers: the most jobs per tile, mostly nine to five on weekdays, so the heaviest commuter rush in the morning and the evening.',
  howTo: 'Drag Office (7) over your own land beside a road; it needs Office zoning. Offices pull commuters from far away, so give them good roads, parking or a bus line.',
  occupation: {
    name: 'office worker', rotate: false,
    shifts: [{ start: 9, hours: 8, weight: 0.6 }, { start: 8, hours: 8, weight: 0.2 }, { start: 10, hours: 8, weight: 0.15 }, { start: 7, hours: 8, weight: 0.05 }],
    cycles: [[1, 1, 1, 1, 1, 0, 0]],
  },
  tints: [0xffffff, 0xeaf0f8, 0xf4f4f0, 0xe4ecf7, 0xf1eef8],
  lotTint: 0xc9a8ff,
  lot: { wage: 14 },
  levels: [
    {
      capacity: 8, wage: 20, work: 60, parking: { surface: 1, underground: 5 },
      designs: [
        { name: 'glass box on a dark plinth', height: 1.17, ops: [
          ['box', 0.74, 0.12, 0.74, 0, 0, 0, 'dark'],
          ['box', 0.7, 1.0, 0.7, 0, 0.12, 0, 'glass', true],
          ['box', 0.72, 0.05, 0.72, 0, 1.12, 0, 'grey'],
        ] },
        { name: 'brick office with window bands and a canopy', height: 0.94, ops: [
          ['box', 0.76, 0.9, 0.72, 0, 0, 0, 'brick', true], ['box', 0.78, 0.1, 0.74, 0, 0.25, 0, 'glassDark'], ['box', 0.78, 0.1, 0.74, 0, 0.55, 0, 'glassDark'],
          ['box', 0.8, 0.04, 0.76, 0, 0.9, 0, 'dark'], ['box', 0.36, 0.03, 0.16, 0, 0.3, 0.42, 'dark'],
        ] },
        { name: 'white concrete with dark glass columns', height: 1.04, ops: [
          ['box', 0.7, 1.0, 0.7, 0, 0, 0, 'white', true], ['box', 0.72, 0.04, 0.72, 0, 1.0, 0, 'grey'],
          ...[-2, -1, 0, 1, 2].flatMap((i): Op[] => [
            ['box', 0.05, 1.0, 0.02, i * 0.14, 0, 0.36, 'glassDark'], ['box', 0.02, 1.0, 0.05, 0.36, 0, i * 0.14, 'glassDark'],
          ]),
        ] },
        { name: 'low campus pair with a link', height: 0.83, ops: [
          ['box', 0.36, 0.6, 0.7, -0.25, 0, 0, 'glass', true], ['box', 0.36, 0.8, 0.7, 0.25, 0, 0, 'glassDark', true], ['box', 0.2, 0.3, 0.3, 0, 0.1, 0, 'white'],
          ['box', 0.38, 0.03, 0.72, -0.25, 0.6, 0, 'dark'], ['box', 0.38, 0.03, 0.72, 0.25, 0.8, 0, 'dark'],
        ] },
      ],
    },
    {
      capacity: 16, wage: 26, work: 120, parking: { surface: 1, underground: 10 }, feature: 'level2',
      designs: [
        { name: 'pale tower with a dark crown', height: 2.3, ops: [
          ['box', 0.78, 1.5, 0.78, 0, 0, 0, 'pale', true],
          ['box', 0.56, 0.7, 0.56, 0, 1.5, 0, 'glassDark', true],
          ['box', 0.2, 0.08, 0.2, 0, 2.2, 0, 'dark'],
        ] },
        { name: 'twin towers with a bridge', height: 1.65, ops: [
          ['box', 0.34, 1.6, 0.6, -0.24, 0, 0, 'glass', true], ['box', 0.34, 1.3, 0.6, 0.24, 0, 0, 'glass', true],
          ['box', 0.16, 0.1, 0.3, 0, 1.0, 0, 'white'], ['box', 0.36, 0.04, 0.62, -0.24, 1.6, 0, 'dark'], ['box', 0.36, 0.04, 0.62, 0.24, 1.3, 0, 'dark'],
        ] },
        { name: 'stone ziggurat', height: 2.4, ops: [
          ['box', 0.84, 0.6, 0.84, 0, 0, 0, 'stone', true], ['box', 0.66, 0.6, 0.66, 0, 0.6, 0, 'stone', true], ['box', 0.48, 0.6, 0.48, 0, 1.2, 0, 'stone', true],
          ['box', 0.3, 0.5, 0.3, 0, 1.8, 0, 'stone', true], ['box', 0.12, 0.1, 0.12, 0, 2.3, 0, 'dark'],
        ] },
        { name: 'dark glass slab with a white spine', height: 2.4, ops: [
          ['box', 0.8, 1.9, 0.46, 0, 0, 0, 'glassDark', true], ['box', 0.18, 2.0, 0.5, 0.2, 0, 0, 'white'],
          ['box', 0.82, 0.04, 0.48, 0, 1.9, 0, 'dark'], ['cyl', 0.012, 0.012, 0.4, 0.2, 2.0, 0, 'steel', 5],
        ] },
      ],
    },
    {
      capacity: 24, wage: 32, work: 180, parking: { surface: 1, underground: 15 }, feature: 'level3',
      designs: [
        { name: 'dark glass tower with a lit crown and mast', height: 3.4, ops: [
          ['box', 0.8, 2.2, 0.8, 0, 0, 0, 'glassDark', true],
          ['box', 0.84, 0.06, 0.84, 0, 2.2, 0, 'white'],
          ['box', 0.56, 0.5, 0.56, 0, 2.26, 0, 'glass', true],
          ['cyl', 0.02, 0.02, 0.6, 0, 2.76, 0, 'steel', 6],
        ] },
        { name: 'tapered tower with a spire', height: 3.7, ops: [
          ['box', 0.84, 0.8, 0.84, 0, 0, 0, 'pale', true], ['box', 0.7, 0.9, 0.7, 0, 0.8, 0, 'pale', true],
          ['box', 0.54, 0.9, 0.54, 0, 1.7, 0, 'pale', true], ['box', 0.36, 0.6, 0.36, 0, 2.6, 0, 'pale', true],
          ['cone', 0.1, 0.5, 0, 3.2, 0, 'steel', 6],
        ] },
        { name: 'paired wings with a sky bridge', height: 3.05, ops: [
          ['box', 0.36, 3.0, 0.7, -0.26, 0, 0, 'glass', true], ['box', 0.36, 2.4, 0.7, 0.26, 0, 0, 'glassDark', true],
          ['box', 0.2, 0.16, 0.4, 0, 1.9, 0, 'white'], ['box', 0.38, 0.05, 0.72, -0.26, 3.0, 0, 'white'], ['box', 0.38, 0.05, 0.72, 0.26, 2.4, 0, 'white'],
        ] },
        { name: 'wide slab on a podium with a helipad', height: 2.97, ops: [
          ['box', 0.9, 0.4, 0.9, 0, 0, 0, 'stone', true], ['box', 0.86, 2.4, 0.4, 0, 0.4, -0.1, 'glassDark', true],
          ['box', 0.88, 0.05, 0.44, 0, 2.8, -0.1, 'white'],
          ['cyl', 0.14, 0.14, 0.02, 0.2, 2.85, -0.1, 'dark', 12], ['box', 0.2, 0.12, 0.2, -0.25, 2.85, -0.1, 'grey'],
        ] },
      ],
    },
  ],
};
