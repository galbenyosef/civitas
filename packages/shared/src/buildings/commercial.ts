import type { KindDef } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';

export const commercial: KindDef = {
  id: 'commercial', name: 'commercial', code: Zone.Commercial, family: 'commercial',
  flags: { growable: true, workplace: true, leisureReady: true },
  windows: 'shop',
  tool: { id: 'com', key: '5', label: 'Commercial', color: 'var(--com)' },
  blurb: 'Shops, cafés, bars and restaurants. They employ people on early, day and late shifts, take deliveries from industry, and double as somewhere to go: residents stop for a coffee or a meal, and visitors drive in from the edge of town.',
  howTo: 'Drag Commercial (5) over your own land beside a road; it grows when there are more people than jobs. Put shops where people pass and within a short drive of factories, whose trucks deliver to the nearest shop (or by train, through a freight line).',
  attrs: { commerceType: 'shop', openHours: [7, 22] },
  occupation: {
    name: 'shop worker', rotate: true,
    shifts: [{ start: 9, hours: 8, weight: 0.4 }, { start: 12, hours: 8, weight: 0.3 }, { start: 6, hours: 8, weight: 0.2 }, { start: 14, hours: 8, weight: 0.1 }],
    cycles: [[1, 1, 1, 1, 1, 0, 0], [1, 1, 0, 1, 1, 1, 0], [0, 1, 1, 1, 1, 1, 0]],
  },
  tints: [0xffffff, 0xfff3e0, 0xeef2f7, 0xf7e8e8, 0xf4f7ec],
  lotTint: 0x7ab6ff,
  lot: { wage: 10 },
  levels: [
    {
      capacity: 3, wage: 15, work: 60, parking: { surface: 1, underground: 3 },
      attrs: { visitorCapacity: 6 },
      designs: [
        { name: 'white shop with awning and sign', height: 0.5, ops: [
          ['box', 0.72, 0.38, 0.6, 0, 0, -0.03, 'white', true],
          ['box', 0.72, 0.03, 0.6, 0, 0.38, -0.03, 'grey'],
          ['box', 0.74, 0.03, 0.16, 0, 0.27, 0.35, 'awning'],
          ['box', 0.5, 0.1, 0.03, 0, 0.4, 0.25, 'signBlue'],
        ] },
        { name: 'brick corner store with striped awning', height: 0.48, ops: [
          ['box', 0.76, 0.42, 0.62, 0, 0, -0.04, 'brick', true], ['box', 0.78, 0.06, 0.64, 0, 0.42, -0.04, 'stone'],
          ...repeat(6, (i) => ['box', 0.125, 0.025, 0.16, -0.31 + i * 0.125, 0.28, 0.34, i % 2 ? 'white' : 'awning']),
          ['box', 0.3, 0.2, 0.02, -0.05, 0.02, 0.27, 'glass'], ['box', 0.1, 0.17, 0.02, 0.25, 0, 0.27, 'door'],
        ] },
        { name: 'café with pavement umbrellas', height: 0.4, attrs: { commerceType: 'café', openHours: [6, 19] }, ops: [
          ['box', 0.6, 0.36, 0.5, -0.08, 0, -0.1, 'green', true], ['box', 0.62, 0.03, 0.52, -0.08, 0.36, -0.1, 'dark'],
          ['box', 0.62, 0.03, 0.14, -0.08, 0.27, 0.2, 'cream'], ['box', 0.3, 0.08, 0.02, -0.08, 0.3, 0.15, 'cream'],
          ['cyl', 0.01, 0.01, 0.2, 0.32, 0, 0.3, 'steel', 4], ['cone', 0.12, 0.05, 0.32, 0.2, 0.3, 'awning', 8],
          ['cyl', 0.01, 0.01, 0.2, 0.32, 0, 0.02, 'steel', 4], ['cone', 0.12, 0.05, 0.32, 0.2, 0.02, 'cream', 8],
          ['box', 0.08, 0.16, 0.02, -0.3, 0, 0.16, 'door'],
        ] },
        { name: 'chrome diner with a tall sign', height: 0.64, attrs: { commerceType: 'restaurant', openHours: [7, 24] }, ops: [
          ['box', 0.7, 0.3, 0.5, 0.02, 0, -0.05, 'silver', true], ['box', 0.72, 0.06, 0.52, 0.02, 0.3, -0.05, 'red'], ['box', 0.74, 0.02, 0.54, 0.02, 0.36, -0.05, 'dark'],
          ['box', 0.5, 0.14, 0.02, 0.07, 0.08, 0.21, 'glass'],
          ['box', 0.04, 0.55, 0.04, -0.38, 0, 0.3, 'steel'], ['box', 0.24, 0.14, 0.04, -0.27, 0.5, 0.3, 'red'], ['box', 0.2, 0.1, 0.02, -0.27, 0.52, 0.33, 'yellow'],
        ] },
        // Worked example from docs/buildings.md: a draft design. Drafts show in /viewer.html
        // but are never placed in the city; drop `draft` to add it to the street rotation.
        { name: 'news kiosk with a striped canopy', height: 0.34, draft: true, attrs: { commerceType: 'kiosk', openHours: [6, 20], visitorCapacity: 2 }, ops: [
          ['box', 0.9, 0.02, 0.9, 0, 0, 0, 'stone'],
          ['box', 0.3, 0.24, 0.24, -0.12, 0.02, -0.08, 'green', true],
          ['box', 0.34, 0.03, 0.28, -0.12, 0.26, -0.08, 'dark'],
          ...repeat(4, (i) => ['box', 0.085, 0.02, 0.14, -0.248 + i * 0.085, 0.22, 0.1, i % 2 ? 'cream' : 'green']),
          ['box', 0.26, 0.07, 0.02, -0.12, 0.27, 0.075, 'yellow'],
          ['box', 0.12, 0.12, 0.06, 0.16, 0.02, 0.12, 'signBlue'], ['box', 0.1, 0.02, 0.07, 0.16, 0.14, 0.12, 'white'],
          ['cyl', 0.012, 0.012, 0.18, 0.3, 0.02, -0.2, 'steel', 5], ['box', 0.1, 0.12, 0.02, 0.3, 0.2, -0.2, 'red'],
        ] },
      ],
    },
    {
      capacity: 6, wage: 20, work: 120, parking: { surface: 1, underground: 6 }, feature: 'level2',
      attrs: { visitorCapacity: 12 },
      designs: [
        { name: 'stone two-storey with glass ground floor', height: 0.91, ops: [
          ['box', 0.8, 0.75, 0.76, 0, 0, 0, 'stone', true],
          ['box', 0.82, 0.24, 0.78, 0, 0, 0, 'glass'],
          ['box', 0.84, 0.04, 0.8, 0, 0.75, 0, 'dark'],
          ['box', 0.44, 0.12, 0.03, 0, 0.79, 0.3, 'signBlue'],
        ] },
        { name: 'supermarket with entrance canopy and rooftop plant', height: 0.66, attrs: { commerceType: 'supermarket', openHours: [7, 22] }, ops: [
          ['box', 0.86, 0.5, 0.78, 0, 0, 0, 'stone', true], ['box', 0.6, 0.2, 0.04, 0, 0.05, 0.4, 'glass'],
          ['box', 0.9, 0.04, 0.3, 0, 0.3, 0.4, 'signBlue'], ['box', 0.5, 0.14, 0.04, 0, 0.52, 0.3, 'signBlue'],
          ['box', 0.2, 0.1, 0.2, -0.25, 0.5, -0.2, 'grey'], ['box', 0.2, 0.1, 0.2, 0.2, 0.5, -0.25, 'grey'],
        ] },
        { name: 'shop below, flats above, mansard roof', height: 0.94, ops: [
          ['box', 0.78, 0.26, 0.7, 0, 0, 0, 'dark'], ['box', 0.6, 0.18, 0.02, 0, 0.04, 0.36, 'glass'], ['box', 0.74, 0.03, 0.12, 0, 0.26, 0.38, 'awning'],
          ['box', 0.78, 0.5, 0.7, 0, 0.26, 0, 'cream', 'home'],
          ['roof', 0.84, 0.18, 0.76, 0, 0.76, 0, 'slate'], ['box', 0.06, 0.14, 0.06, 0.25, 0.8, -0.15, 'chimney'],
        ] },
        { name: 'two-block mall with canopy and flags', height: 0.8, attrs: { commerceType: 'mall' }, ops: [
          ['box', 0.5, 0.7, 0.76, -0.18, 0, 0, 'white', true], ['box', 0.36, 0.5, 0.7, 0.26, 0, 0, 'pale', true],
          ['box', 0.3, 0.03, 0.2, 0.26, 0.3, 0.42, 'signBlue'], ['box', 0.26, 0.12, 0.03, -0.18, 0.72, 0.3, 'signBlue'],
          ['flag', 0.1, 0.5, 0.1, 'red'], ['flag', 0.3, 0.5, -0.2, 'yellow'],
        ] },
      ],
    },
    {
      capacity: 9, wage: 25, work: 180, parking: { surface: 1, underground: 9 }, feature: 'level3',
      attrs: { visitorCapacity: 18 },
      designs: [
        { name: 'glass tower on a podium', height: 2.25, ops: [
          ['box', 0.84, 0.3, 0.84, 0, 0, 0, 'white', true],
          ['box', 0.66, 1.7, 0.66, 0, 0.3, 0, 'glass', true],
          ['box', 0.7, 0.05, 0.7, 0, 2.0, 0, 'dark'],
          ['box', 0.26, 0.2, 0.26, 0, 2.05, 0, 'grey'],
        ] },
        { name: 'hotel with vertical fins and a roof sign', height: 2.1, attrs: { commerceType: 'hotel', openHours: [0, 24] }, ops: [
          ['box', 0.84, 0.3, 0.84, 0, 0, 0, 'stone', true], ['box', 0.78, 1.6, 0.5, 0, 0.3, -0.1, 'cream', 'home'],
          ...repeat(7, (i) => ['box', 0.03, 1.6, 0.06, (i - 3) * 0.11, 0.3, 0.17, 'white']),
          ['box', 0.8, 0.04, 0.54, 0, 1.9, -0.1, 'dark'], ['box', 0.4, 0.14, 0.04, 0, 1.94, -0.05, 'red'], ['box', 0.5, 0.03, 0.2, 0, 0.3, 0.45, 'dark'],
        ] },
        { name: 'stepped department store', height: 1.9, attrs: { commerceType: 'department store' }, ops: [
          ['box', 0.88, 0.7, 0.88, 0, 0, 0, 'stone', true], ['box', 0.74, 0.6, 0.74, 0, 0.7, 0, 'cream', true], ['box', 0.56, 0.5, 0.56, 0, 1.3, 0, 'cream', true],
          ['box', 0.6, 0.04, 0.6, 0, 1.8, 0, 'dark'], ['box', 0.9, 0.03, 0.16, 0, 0.4, 0.46, 'awning'],
          ['flag', -0.3, 0.7, 0.3, 'red'], ['flag', 0.3, 0.7, 0.3, 'signBlue'],
        ] },
        { name: 'stacked offset cubes', height: 2.14, ops: [
          ['box', 0.7, 0.7, 0.7, -0.06, 0, 0.04, 'glassDark', true], ['box', 0.7, 0.7, 0.7, 0.08, 0.7, -0.06, 'glass', true],
          ['box', 0.6, 0.7, 0.6, -0.08, 1.4, 0.02, 'white', true], ['box', 0.62, 0.04, 0.62, -0.08, 2.1, 0.02, 'dark'],
        ] },
      ],
    },
  ],
};
