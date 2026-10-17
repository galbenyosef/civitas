import type { KindDef, Op } from './schema';
import { repeat } from './helpers';

/**
 * Leisure places: parks (no staff, three levels that grow with use) and staffed venues people visit for an
 * evening or an afternoon. Behaviour comes from the attributes (shared/src/leisure.ts reads them): venueType,
 * openHours, visitorCapacity, ticket, stay, eventNights / eventStart, leisureValue, radius and the appeal numbers.
 * Kind codes 10-14 (the tile's 4-bit kind field; 15 is left for multi-tile parts).
 * Park trees and benches are not in these recipes: render/parks.ts scatters them as instances inside park tiles,
 * keeping clear of the path layout named by `paths`.
 */

/** A park tile's lawn, laid over the paved lot. */
const lawn = (c: 'lawn' | 'lawnDark' = 'lawn'): Op => ['box', 0.98, 0.012, 0.98, 0, 0, 0, c];
/** Gravel paths crossing the tile, `w` wide. */
const cross = (w: number): Op[] => [['box', w, 0.004, 0.98, 0, 0.012, 0, 'gravel'], ['box', 0.98, 0.004, w, 0, 0.012, 0, 'gravel']];
/** A square ring path of half-size r and width w, with an entrance from the road side. */
const ring = (r: number, w: number): Op[] => [
  ['box', 2 * r + w, 0.004, w, 0, 0.012, -r, 'gravel'], ['box', 2 * r + w, 0.004, w, 0, 0.012, r, 'gravel'],
  ['box', w, 0.004, 2 * r, -r, 0.012, 0, 'gravel'], ['box', w, 0.004, 2 * r, r, 0.012, 0, 'gravel'],
  ['box', w, 0.004, 0.49 - r, 0, 0.012, r + (0.49 - r) / 2, 'gravel'],
];
/** Low hedges along the four edges, broken where a cross path leaves the tile. */
const hedgeCorners = (gap: number): Op[] => {
  const len = 0.49 - gap / 2, mid = gap / 2 + len / 2;
  return [-1, 1].flatMap((sx): Op[] => [-1, 1].flatMap((sz): Op[] => [
    ['box', len, 0.05, 0.035, sx * mid, 0.012, sz * 0.47, 'hedge'],
    ['box', 0.035, 0.05, len, sx * 0.47, 0.012, sz * mid, 'hedge'],
  ]));
};
/** A flower bed: a stone kerb and a few blooms. */
const bed = (x: number, z: number, r: number): Op[] => [
  ['cyl', r, r, 0.03, x, 0.012, z, 'stone', 10], ['cyl', r * 0.85, r * 0.85, 0.034, x, 0.012, z, 'lawnDark', 10],
  ['cone', r * 0.3, 0.05, x - r * 0.4, 0.04, z, 'red', 5], ['cone', r * 0.3, 0.05, x + r * 0.4, 0.04, z + r * 0.2, 'yellow', 5],
  ['cone', r * 0.3, 0.05, x, 0.04, z - r * 0.45, 'awning', 5],
];
/** A round fountain: basin, water, column, bowl and a spout. */
const fountain = (r: number): Op[] => [
  ['cyl', r, r * 1.05, 0.05, 0, 0.012, 0, 'stone', 16], ['cyl', r * 0.86, r * 0.86, 0.052, 0, 0.012, 0, 'pond', 16],
  ['cyl', 0.03, 0.04, r * 0.9, 0, 0.012, 0, 'stone', 8], ['cyl', r * 0.38, r * 0.2, 0.035, 0, 0.012 + r * 0.9, 0, 'stone', 12],
  ['cyl', r * 0.3, r * 0.3, 0.036, 0, 0.013 + r * 0.9, 0, 'pond', 12], ['cone', 0.025, 0.08, 0, 0.04 + r * 0.9, 0, 0xcfe8ff, 6],
];

export const park: KindDef = {
  id: 'park', name: 'park', code: 10, family: 'leisure',
  flags: { civic: true, leisureReady: true },
  windows: 'shop',
  tool: { id: 'citypark', key: 'G', label: 'Park', color: '#4f9a5c' },
  group: 'park', tier: 1,
  blurb: 'A one-tile park that grows with use: a pocket park becomes a park with a fountain or a bandstand, then a large park with a tea pavilion or a boating pond.',
  howTo: 'Drop one beside a road among homes; no technology needed. The busier it is, the sooner the builders add to it.',
  attrs: {
    venueType: 'park', openHours: [6, 22], ticket: 0, stay: [0.5, 1.5],
    dayAppeal: 1.2, eveningAppeal: 0.35, retireeAppeal: 1.8, childAppeal: 2.0,
  },
  cost: 120, work: 300, capacity: 0, parking: { surface: 2, underground: 2 },
  levels: [
    {
      upkeep: 3, attrs: { title: 'pocket park', visitorCapacity: 12, leisureValue: 3, radius: 8, upgradeVisits: 24 },
      designs: [
        { name: 'pocket park with cross paths and a flower bed', height: 0.1, attrs: { paths: 'cross', trees: 4, benches: 2 }, ops: [
          lawn(), ...cross(0.14), ...hedgeCorners(0.16), ...bed(0, 0, 0.11),
        ] },
        { name: 'pocket park with a ring path and a sandpit', height: 0.16, attrs: { paths: 'ring', trees: 5, benches: 2 }, ops: [
          lawn('lawnDark'), ...ring(0.3, 0.09),
          ['box', 0.24, 0.025, 0.24, 0, 0.012, 0, 'sand'], ['box', 0.26, 0.03, 0.02, 0, 0.012, -0.13, 'timber'], ['box', 0.26, 0.03, 0.02, 0, 0.012, 0.13, 'timber'],
          ['box', 0.03, 0.12, 0.03, -0.06, 0.012, -0.05, 'red'], ['box', 0.03, 0.12, 0.03, 0.06, 0.012, -0.05, 'red'], ['box', 0.16, 0.02, 0.05, 0, 0.13, -0.05, 'yellow'],
        ] },
      ],
    },
    {
      upkeep: 5, attrs: { title: 'park', visitorCapacity: 24, leisureValue: 5, radius: 10, upgradeVisits: 50 },
      designs: [
        { name: 'park with cross paths, hedges and a fountain', height: 0.2, attrs: { paths: 'cross', trees: 7, benches: 4 }, ops: [
          lawn(), ...cross(0.17), ['cyl', 0.24, 0.24, 0.006, 0, 0.012, 0, 'gravel', 16], ...hedgeCorners(0.19), ...fountain(0.15),
        ] },
        { name: 'park with a ring path and a bandstand', height: 0.32, attrs: { paths: 'ring', trees: 7, benches: 4, eventNights: [6], eventStart: 15 }, ops: [
          lawn(), ...ring(0.32, 0.1),
          ['cyl', 0.17, 0.18, 0.05, 0, 0.012, 0, 'stone', 8],
          ...repeat(6, (i) => ['cyl', 0.01, 0.01, 0.17, 0.14 * Math.cos((i * Math.PI) / 3), 0.06, 0.14 * Math.sin((i * Math.PI) / 3), 'white', 4]),
          ['cone', 0.21, 0.09, 0, 0.23, 0, 'green', 8], ['cyl', 0.012, 0.012, 0.05, 0, 0.3, 0, 'gold', 4],
        ] },
      ],
    },
    {
      upkeep: 8, attrs: { title: 'large park', visitorCapacity: 40, leisureValue: 8, radius: 12 },
      designs: [
        { name: 'large park: plaza, tiered fountain and a tea pavilion', height: 0.36, attrs: { paths: 'plaza', trees: 9, benches: 6, eventNights: [6], eventStart: 14 }, ops: [
          lawn(), ...cross(0.18), ['box', 0.5, 0.005, 0.5, 0, 0.012, 0, 'gravel'], ...hedgeCorners(0.2), ...fountain(0.19),
          ['cyl', 0.07, 0.05, 0.03, 0, 0.26, 0, 'stone', 10], ['cone', 0.02, 0.07, 0, 0.29, 0, 0xcfe8ff, 6],
          ['box', 0.2, 0.15, 0.14, -0.33, 0.012, -0.33, 'cream', true], ['roof', 0.24, 0.07, 0.18, -0.33, 0.162, -0.33, 'green'],
          ['box', 0.16, 0.02, 0.06, -0.33, 0.11, -0.24, 'awning'],
        ] },
        { name: 'large park with a boating pond, footbridge and kiosk', height: 0.22, attrs: { paths: 'pond', trees: 9, benches: 4 }, ops: [
          lawn(), ['box', 0.98, 0.004, 0.13, 0, 0.012, 0.36, 'gravel'], ['box', 0.12, 0.004, 0.5, 0.3, 0.012, 0.08, 'gravel'],
          ['box', 0.58, 0.02, 0.48, -0.12, 0.012, -0.14, 'stone'], ['box', 0.53, 0.022, 0.43, -0.12, 0.012, -0.14, 'pond'],
          ['box', 0.1, 0.03, 0.5, -0.12, 0.03, -0.14, 'timber'], ['box', 0.12, 0.05, 0.015, -0.12, 0.03, -0.39, 'timber'], ['box', 0.12, 0.05, 0.015, -0.12, 0.03, 0.11, 'timber'],
          ['box', 0.07, 0.02, 0.04, -0.3, 0.034, -0.24, 'white'], ['box', 0.07, 0.02, 0.04, 0.02, 0.034, -0.05, 'red'],
          ['box', 0.14, 0.13, 0.12, 0.33, 0.012, -0.32, 'green', true], ['box', 0.17, 0.02, 0.15, 0.33, 0.142, -0.32, 'cream'], ['box', 0.15, 0.03, 0.05, 0.33, 0.09, -0.24, 'cream'],
        ] },
      ],
    },
  ],
};

/** Venue staff rosters cover evenings and weekends, so cycles keep Friday-Sunday mostly staffed. */
const EVENING_CYCLES = [[0, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 1, 1, 1], [1, 1, 1, 0, 0, 1, 1], [1, 1, 1, 1, 1, 0, 0]];

export const cinema: KindDef = {
  id: 'cinema', name: 'cinema', code: 11, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true },
  windows: 'venue',
  tool: { id: 'cinema', key: '', label: 'Cinema', color: '#b8434f' }, // C and Z rotate a footprint being placed, so the cinema is tool bar only
  group: 'cinema', tier: 2,
  blurb: 'A picture house of a few screens with premieres on Friday and Saturday nights. Evening crowds and ticket sales taxed in your parcel.',
  howTo: 'One tile on a busy street; give it parking nearby for premiere nights.',
  occupation: {
    name: 'cinema usher', rotate: true,
    shifts: [{ start: 12, hours: 8, weight: 0.4 }, { start: 16, hours: 8, weight: 0.6 }],
    cycles: EVENING_CYCLES,
  },
  attrs: {
    venueType: 'cinema', openHours: [12, 24], visitorCapacity: 30, ticket: 8, stay: [2, 2.6],
    leisureValue: 4, radius: 14, eventNights: [4, 5], eventStart: 19.5,
    dayAppeal: 0.25, eveningAppeal: 1.6, retireeAppeal: 0.7, childAppeal: 1.2,
  },
  lot: { wage: 14 },
  levels: [{
    capacity: 6, wage: 14, cost: 700, upkeep: 12, work: 300, parking: { surface: 6, underground: 16 },
    designs: [
      { name: 'art-deco picture house with a bulb marquee and a sign blade', height: 0.86, ops: [
        ['box', 0.8, 0.52, 0.66, 0, 0, -0.1, 'cream', true], ['box', 0.82, 0.04, 0.68, 0, 0.52, -0.1, 'gold'],
        ['box', 0.44, 0.14, 0.06, 0, 0.52, 0.2, 'cream'], ['box', 0.3, 0.06, 0.065, 0, 0.66, 0.2, 'gold'],
        ['box', 0.72, 0.06, 0.2, 0, 0.27, 0.32, 'marquee'], ['box', 0.74, 0.02, 0.22, 0, 0.33, 0.32, 'red'], ['box', 0.74, 0.02, 0.22, 0, 0.25, 0.32, 'red'],
        ['box', 0.06, 0.42, 0.14, 0.3, 0.38, 0.26, 'red'], ...repeat(5, (i) => ['box', 0.065, 0.04, 0.1, 0.3, 0.42 + i * 0.07, 0.26, 'yellow']),
        ['box', 0.36, 0.22, 0.02, 0, 0.02, 0.24, 'glass'], ['box', 0.1, 0.14, 0.02, -0.3, 0.06, 0.24, 'signBlue'], ['box', 0.1, 0.14, 0.02, 0.18, 0.06, 0.24, 'plum'],
      ] },
      { name: 'multiplex with a glass foyer and a poster wall', height: 0.74, ops: [
        ['box', 0.86, 0.62, 0.54, 0, 0, -0.18, 'charcoal'], ['box', 0.86, 0.06, 0.55, 0, 0.5, -0.18, 'red', true],
        ['box', 0.62, 0.32, 0.26, -0.06, 0, 0.24, 'glass', true], ['box', 0.66, 0.03, 0.3, -0.06, 0.32, 0.24, 'silver'],
        ...repeat(4, (i) => ['box', 0.1, 0.2, 0.012, -0.32 + i * 0.13, 0.36, 0.093, (['red', 'yellow', 'signBlue', 'plum'] as const)[i]]),
        ['box', 0.4, 0.1, 0.04, 0.12, 0.62, 0, 'red'], ['box', 0.3, 0.05, 0.045, 0.12, 0.645, 0, 'white'],
        ['box', 0.16, 0.36, 0.16, 0.36, 0, 0.28, 'red', true],
      ] },
    ],
  }],
};

export const theatre: KindDef = {
  id: 'theatre', name: 'theatre', code: 12, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true },
  windows: 'venue',
  tool: { id: 'theatre', key: 'V', label: 'Theatre', color: '#7a3e8f' },
  group: 'theatre', tier: 2,
  blurb: 'A playhouse with performances three nights a week. The best night out in town until the opera house, drawing people from far away.',
  howTo: 'One tile near restaurants and bars, where theatre-goers eat before the show.',
  occupation: {
    name: 'theatre staff', rotate: true,
    shifts: [{ start: 13, hours: 8, weight: 0.4 }, { start: 16, hours: 8, weight: 0.6 }],
    cycles: EVENING_CYCLES,
  },
  attrs: {
    venueType: 'theatre', openHours: [14, 24], visitorCapacity: 40, ticket: 14, stay: [2.4, 3],
    leisureValue: 6, radius: 18, eventNights: [3, 4, 5], eventStart: 19.5,
    dayAppeal: 0.15, eveningAppeal: 1.2, retireeAppeal: 1.3, childAppeal: 0.4,
  },
  lot: { wage: 18 },
  levels: [{
    capacity: 10, wage: 18, cost: 1200, upkeep: 20, work: 300, parking: { surface: 6, underground: 20 },
    designs: [
      { name: 'classical playhouse with a portico and a fly tower', height: 0.96, ops: [
        ['box', 0.78, 0.5, 0.56, 0, 0, -0.14, 'stone', true], ['box', 0.5, 0.92, 0.3, 0, 0, -0.26, 'stone'], ['box', 0.52, 0.04, 0.32, 0, 0.92, -0.26, 'dark'],
        ['box', 0.8, 0.03, 0.58, 0, 0.5, -0.14, 'gold'],
        ['box', 0.66, 0.03, 0.26, 0, 0, 0.27, 'white'], ['box', 0.62, 0.03, 0.22, 0, 0.03, 0.27, 'white'],
        ...repeat(4, (i) => ['cyl', 0.028, 0.032, 0.32, -0.24 + i * 0.16, 0.06, 0.33, 'white', 8]),
        ['box', 0.62, 0.04, 0.2, 0, 0.38, 0.29, 'white'], ['roof', 0.62, 0.12, 0.2, 0, 0.42, 0.29, 'white', true],
        ['box', 0.2, 0.2, 0.02, 0, 0.06, 0.15, 'door'], ['box', 0.12, 0.16, 0.02, -0.3, 0.12, 0.15, 'plum'], ['box', 0.12, 0.16, 0.02, 0.3, 0.12, 0.15, 'plum'],
      ] },
      { name: 'modern theatre with a glass drum foyer and banners', height: 0.84, ops: [
        ['box', 0.82, 0.48, 0.5, 0, 0, -0.2, 'plum', true], ['box', 0.46, 0.8, 0.28, 0.12, 0, -0.28, 'charcoal'], ['box', 0.48, 0.04, 0.3, 0.12, 0.8, -0.28, 'gold'],
        ['cyl', 0.22, 0.22, 0.42, -0.14, 0, 0.16, 'glass', 14], ['cyl', 0.24, 0.24, 0.03, -0.14, 0.42, 0.16, 'silver', 14],
        ['box', 0.36, 0.03, 0.2, 0.22, 0.28, 0.16, 'dark'],
        ['flag', 0.38, 0.3, 0.3, 'gold'], ['flag', 0.24, 0.3, 0.3, 'red'],
        ['box', 0.3, 0.08, 0.02, 0.22, 0.38, 0.06, 'marquee'],
      ] },
    ],
  }],
};

export const sports: KindDef = {
  id: 'sports', name: 'sports hall', code: 13, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true },
  windows: 'venue',
  tool: { id: 'sports', key: 'B', label: 'Sports hall', color: '#2f6fb5' },
  group: 'sports', tier: 1,
  blurb: 'A hall or a floodlit five-a-side court with match nights twice a week. Popular with children and anyone after work.',
  howTo: 'One tile among homes. A leisure centre adds a pool; arenas and stadiums bring the big crowds.',
  occupation: {
    name: 'leisure attendant', rotate: true,
    shifts: [{ start: 7, hours: 8, weight: 0.4 }, { start: 14, hours: 8, weight: 0.6 }],
    cycles: EVENING_CYCLES,
  },
  attrs: {
    venueType: 'sports', openHours: [7, 22], visitorCapacity: 24, ticket: 5, stay: [1.2, 2.2],
    leisureValue: 4, radius: 12, eventNights: [2, 5], eventStart: 19,
    dayAppeal: 0.6, eveningAppeal: 1.2, retireeAppeal: 0.4, childAppeal: 1.4,
  },
  lot: { wage: 14 },
  levels: [{
    capacity: 5, wage: 14, cost: 600, upkeep: 10, work: 300, parking: { surface: 6, underground: 14 },
    designs: [
      { name: 'sports hall with a long pitched roof and a blue entrance', height: 0.62, ops: [
        ['box', 0.88, 0.36, 0.72, 0, 0, -0.08, 'silver', true], ['roof', 0.92, 0.22, 0.76, 0, 0.36, -0.08, 'corrugated', true],
        ['box', 0.88, 0.04, 0.73, 0, 0.18, -0.08, 'boxBlue'],
        ['box', 0.36, 0.24, 0.12, 0.16, 0, 0.32, 'boxBlue', true], ['box', 0.4, 0.03, 0.16, 0.16, 0.24, 0.33, 'dark'],
        ['box', 0.22, 0.07, 0.02, 0.16, 0.27, 0.39, 'white'], ['box', 0.14, 0.18, 0.02, 0.16, 0, 0.385, 'glass'],
      ] },
      { name: 'brick hall beside a floodlit five-a-side court', height: 0.82, ops: [
        ['box', 0.46, 0.42, 0.84, -0.24, 0, 0, 'brick', true], ['box', 0.48, 0.03, 0.86, -0.24, 0.42, 0, 'dark'], ['box', 0.2, 0.08, 0.02, -0.24, 0.3, 0.43, 'boxBlue'],
        ['box', 0.42, 0.012, 0.84, 0.25, 0, 0, 'court'], ['box', 0.42, 0.014, 0.012, 0.25, 0, 0, 'white'], ['cyl', 0.06, 0.06, 0.014, 0.25, 0, 0, 'white', 10], ['cyl', 0.05, 0.05, 0.016, 0.25, 0, 0, 'court', 10],
        ['box', 0.12, 0.08, 0.02, 0.25, 0.012, -0.4, 'white'], ['box', 0.12, 0.08, 0.02, 0.25, 0.012, 0.4, 'white'],
        ['cyl', 0.012, 0.012, 0.78, 0.45, 0, -0.42, 'steel', 5], ['box', 0.1, 0.05, 0.03, 0.42, 0.76, -0.42, 'marquee'],
        ['cyl', 0.012, 0.012, 0.78, 0.45, 0, 0.42, 'steel', 5], ['box', 0.1, 0.05, 0.03, 0.42, 0.76, 0.42, 'marquee'],
      ] },
    ],
  }],
};

export const library: KindDef = {
  id: 'library', name: 'library', code: 14, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true },
  windows: 'office',
  tool: { id: 'library', key: 'L', label: 'Library', color: '#a8875a' },
  group: 'library', tier: 1,
  blurb: 'A library or a community hall: free daytime outings that retirees and children love, and a quiz night at the hall.',
  howTo: 'One tile in a neighbourhood; free places close to home are where children go on their own.',
  occupation: {
    name: 'librarian', rotate: true,
    shifts: [{ start: 9, hours: 8, weight: 0.6 }, { start: 11, hours: 8, weight: 0.4 }],
    cycles: [[1, 1, 1, 1, 1, 1, 0], [1, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 1, 1, 0]],
  },
  attrs: {
    venueType: 'library', openHours: [9, 19], visitorCapacity: 16, ticket: 0, stay: [0.6, 1.8],
    leisureValue: 3, radius: 10,
    dayAppeal: 1.0, eveningAppeal: 0.3, retireeAppeal: 2.0, childAppeal: 1.6,
  },
  lot: { wage: 16 },
  levels: [{
    capacity: 4, wage: 16, cost: 450, upkeep: 10, work: 300, parking: { surface: 3, underground: 6 },
    designs: [
      { name: 'stone library with steps, columns and a dome', height: 0.78, ops: [
        ['box', 0.76, 0.42, 0.58, 0, 0, -0.08, 'stone', true], ['box', 0.78, 0.05, 0.6, 0, 0.42, -0.08, 'cream'],
        ['cyl', 0.17, 0.17, 0.1, 0, 0.47, -0.08, 'stone', 12], ['cyl', 0.05, 0.17, 0.14, 0, 0.57, -0.08, 'roofGrey', 12], ['cyl', 0.03, 0.03, 0.06, 0, 0.71, -0.08, 'gold', 6],
        ['box', 0.42, 0.025, 0.18, 0, 0, 0.3, 'white'], ['box', 0.36, 0.025, 0.14, 0, 0.025, 0.29, 'white'],
        ['cyl', 0.025, 0.025, 0.3, -0.12, 0.05, 0.26, 'white', 8], ['cyl', 0.025, 0.025, 0.3, 0.12, 0.05, 0.26, 'white', 8],
        ['box', 0.34, 0.05, 0.12, 0, 0.35, 0.26, 'cream'], ['box', 0.12, 0.17, 0.02, 0, 0.05, 0.215, 'door'],
        ['box', 0.3, 0.05, 0.02, 0, 0.36, 0.325, 'dark'],
      ] },
      { name: 'timber community hall with a porch and a noticeboard', height: 0.62, attrs: { title: 'community hall', openHours: [9, 22], ticket: 2, eventNights: [1], eventStart: 19, eveningAppeal: 0.8, visitorCapacity: 20 }, ops: [
        ['box', 0.74, 0.32, 0.5, 0, 0, -0.12, 'tan', true], ['roof', 0.8, 0.22, 0.56, 0, 0.32, -0.12, 'terracotta'],
        ['box', 0.26, 0.24, 0.16, -0.14, 0, 0.2, 'tan'], ['roof', 0.3, 0.1, 0.2, -0.14, 0.24, 0.2, 'terracotta', true],
        ['box', 0.1, 0.18, 0.02, -0.14, 0, 0.285, 'door'],
        ['cyl', 0.012, 0.012, 0.2, 0.2, 0, 0.3, 'timber', 5], ['cyl', 0.012, 0.012, 0.2, 0.36, 0, 0.3, 'timber', 5],
        ['box', 0.2, 0.12, 0.02, 0.28, 0.1, 0.3, 'brown'], ['box', 0.05, 0.06, 0.005, 0.23, 0.13, 0.312, 'white'], ['box', 0.05, 0.04, 0.005, 0.31, 0.15, 0.312, 'yellow'],
        ['flag', -0.36, 0.32, 0.12, 'red'],
      ] },
    ],
  }],
};

export const LEISURE_KINDS: KindDef[] = [park, cinema, theatre, sports, library];
