import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { slab, carRow, bayLines, tree, treeLine, signBoard, lampPost, ASPHALT, PAVING } from './tierkit';

/**
 * The parking ladder (groups.ts 'parking'): kerbside bays → the surface lot (transport.ts, unchanged) → a
 * multi-storey car park → park and ride. The bigger rungs are civic structures of the parking family (code 9), built
 * by builders: parking capacity comes from the level's `parking` numbers like any lot, drivers pay the lot fee, the
 * owner pays upkeep, and the client draws parked cars only on single-tile lots (the decks are in the model).
 * Kind ids 56-58. Park and ride carries `busStop: true` as a hook for the buses card: a stop built into its frontage.
 */

/** A lighting column with a two-way head. */
const column = (x: number, z: number, h = 0.5): Op[] => [['cyl', 0.01, 0.014, h, x, 0, z, 'steel', 5], ['box', 0.16, 0.02, 0.04, x, h, z, 'white', 'civic']];
/** One deck of a multi-storey: slab, edge barrier and parked cars in two rows. */
const deck = (w: number, d: number, y: number, x: number, z: number, edge: 'grey' | 'stone' | 'timber' | 'green', skip: number): Op[] => [
  ['box', w, 0.04, d, x, y, z, 'grey'],
  ['box', w, 0.06, 0.02, x, y + 0.04, z - d / 2 + 0.01, edge], ['box', w, 0.06, 0.02, x, y + 0.04, z + d / 2 - 0.01, edge],
  ['box', 0.02, 0.06, d, x - w / 2 + 0.01, y + 0.04, z, edge], ['box', 0.02, 0.06, d, x + w / 2 - 0.01, y + 0.04, z, edge],
  ...carRow(x - w / 2 + 0.14, z - d / 4, Math.floor((w - 0.2) / 0.16), 0.16, false, y + 0.04, skip),
  ...carRow(x - w / 2 + 0.14, z + d / 4, Math.floor((w - 0.2) / 0.16), 0.16, false, y + 0.04, skip + 2),
];

export const kerbsideBays: KindDef = {
  id: 'kerbside-bays', name: 'kerbside bays', code: Zone.Parking, kindId: 56, family: 'transport',
  flags: { civic: true, parking: true }, windows: 'none',
  group: 'parking', tier: 1,
  blurb: 'Half a dozen marked bays on a paved court with a pay-and-display machine. Takes the overflow off a busy street for very little upkeep.',
  howTo: 'One tile beside a road, next to the shops or offices that fill up. Builders mark it out in no time.',
  tool: { id: 'kerbbays', key: '', label: 'Kerbside bays', color: '#7a808c' },
  lot: { parking: { surface: 6, underground: 6 } },
  levels: [{
    capacity: 0, cost: 60, upkeep: 1, work: 60, parking: { surface: 6, underground: 6 },
    designs: [
      { name: 'paved court with bays, tree pits and a pay-and-display machine', height: 0.3, ops: [
        slab(1, 1, PAVING), ['box', 0.86, 0.006, 0.86, 0, 0.02, 0, 0x5a5e66],
        // bays where the client parks cars on a single-tile lot (render/citizens.ts BAYS: six across, at z = ±0.27)
        ...bayLines(-0.42, -0.27, 6, 0.14, 0.3, 0.026), ...bayLines(-0.42, 0.27, 6, 0.14, 0.3, 0.026),
        ['box', 0.05, 0.14, 0.04, 0.46, 0.02, 0.0, 'charcoal'], ['box', 0.045, 0.04, 0.045, 0.46, 0.12, 0.0, 'yellow'],
        ...tree(-0.46, 0.0, 0.55), ...tree(-0.46, 0.46, 0.45), ...tree(0.46, -0.46, 0.45),
      ] },
      { name: 'cobbled bays between planters, with a parking sign', height: 0.3, ops: [
        slab(1, 1, 0x8f8a80), ['box', 0.86, 0.006, 0.86, 0, 0.02, 0, 0x6e6a62],
        ...bayLines(-0.42, -0.27, 6, 0.14, 0.3, 0.026, 'yellow'), ...bayLines(-0.42, 0.27, 6, 0.14, 0.3, 0.026, 'yellow'),
        ['box', 0.05, 0.06, 0.8, -0.465, 0.02, 0, 'hedge'], ['box', 0.05, 0.06, 0.8, 0.465, 0.02, 0, 'hedge'],
        ['cyl', 0.01, 0.01, 0.26, 0.465, 0.02, 0.46, 'steel', 4], ['box', 0.08, 0.08, 0.015, 0.465, 0.24, 0.46, 'signBlue'], ['box', 0.03, 0.04, 0.016, 0.465, 0.26, 0.46, 'white'],
      ] },
    ],
  }],
};

export const multiStorey: KindDef = {
  id: 'multi-storey', name: 'multi-storey car park', code: Zone.Parking, kindId: 57, family: 'transport',
  flags: { civic: true, parking: true }, windows: 'none',
  group: 'parking', tier: 3,
  footprint: { w: 2, h: 2, door: [1, 1], marks: [{ kind: 'gate', at: { edge: 'front', from: 1, to: 1 }, label: 'barrier and ramp' }] },
  blurb: 'Four decks of bays over a 2×2 plot with a spiral ramp and a stair tower. Takes eight times a surface lot\'s cars off the street, more again with deep foundations.',
  howTo: 'A 2×2 lot by a busy centre; cars come and go through the barrier on the right of the frontage. Needs Steel frame.',
  tool: { id: 'multistorey', key: '', label: 'Multi-storey car park', color: '#4e535e' },
  lot: { parking: { surface: 0, underground: 0 } },
  attrs: { decks: 4 },
  levels: [{
    capacity: 0, cost: 1200, upkeep: 18, work: 800, parking: { surface: 96, underground: 128 },
    designs: [
      { name: 'four concrete decks with a corner ramp drum and a glazed stair tower', height: 1.12, ops: [
        slab(2, 2, ASPHALT),
        ...[0, 0.26, 0.52, 0.78].flatMap((y, i): Op[] => deck(1.5, 1.8, y + 0.02, -0.2, 0, 'stone', i + 1)),
        ['box', 1.5, 0.04, 1.8, -0.2, 1.06, 0, 'grey'],
        ...repeat(9, (i): Op => ['box', 0.05, 1.04, 0.05, -0.9 + (i % 3) * 0.7, 0.02, -0.82 + Math.floor(i / 3) * 0.82, 'stone']),
        ['cyl', 0.3, 0.3, 1.06, 0.68, 0.02, -0.55, 'stone', 16], ...repeat(4, (i): Op => ['cyl', 0.31, 0.31, 0.02, 0.68, 0.26 + i * 0.26, -0.55, 'yellow', 16]),
        ['box', 0.26, 1.2, 0.26, 0.72, 0.02, 0.4, 'glass', 'civic'], ['box', 0.28, 0.03, 0.28, 0.72, 1.22, 0.4, 'dark'],
        ['box', 0.06, 0.06, 0.24, 0.48, 0.02, 0.84, 'charcoal'], ['box', 0.3, 0.012, 0.012, 0.6, 0.12, 0.84, 'red'],
        ['box', 0.34, 0.12, 0.02, -0.2, 0.6, 0.91, 'signBlue'], ['box', 0.1, 0.08, 0.022, -0.2, 0.62, 0.91, 'white'],
      ] },
      { name: 'timber-clad decks behind a green wall, with solar panels on top', height: 1.08, ops: [
        slab(2, 2, ASPHALT),
        ...[0, 0.26, 0.52, 0.78].flatMap((y, i): Op[] => deck(1.84, 1.5, y + 0.02, 0, -0.15, i % 2 ? 'timber' : 'green', i + 2)),
        ...repeat(10, (i): Op => ['box', 0.03, 1.02, 0.04, -0.9 + i * 0.2, 0.02, 0.62, i % 3 ? 'timber' : 'hedge']),
        ...repeat(6, (i): Op => ['box', 0.26, 0.02, 0.4, -0.7 + (i % 3) * 0.6, 1.06 + 0.04, -0.5 + Math.floor(i / 3) * 0.6, 'glassDark']),
        ['box', 1.84, 0.04, 1.5, 0, 1.04, -0.15, 'grey'],
        ['box', 0.36, 0.02, 0.36, 0.6, 0.02, 0.8, 'yellow'], ['box', 0.06, 0.06, 0.06, 0.4, 0.02, 0.8, 'charcoal'],
        ...signBoard(-0.5, 0.86, 0.4, 'signBlue', 'white', 0.02, 0.3),
      ] },
    ],
  }],
};

export const parkAndRide: KindDef = {
  id: 'park-and-ride', name: 'park and ride', code: Zone.Parking, kindId: 58, family: 'transport',
  flags: { civic: true, parking: true }, windows: 'none',
  group: 'parking', tier: 4,
  footprint: { w: 3, h: 3, door: [1, 2], marks: [{ kind: 'stand', at: [0, 2], label: 'bus stop (later)' }, { kind: 'gate', at: { edge: 'front', from: 1, to: 1 }, label: 'entrance' }] },
  blurb: 'A big lit car park on the edge of town with a ticket hall and room for a bus stop at the gate. Drivers leave the car and ride in; for now it is the largest lot there is.',
  howTo: 'A 3×3 lot on a road into town. The front-left tile is kept for a bus stop that a later card will run buses through. Needs Public transport.',
  tool: { id: 'parkride', key: '', label: 'Park and ride', color: '#3f6f8f' },
  lot: { parking: { surface: 0, underground: 0 } },
  attrs: { busStop: true },
  levels: [{
    capacity: 0, cost: 1600, upkeep: 22, work: 900, parking: { surface: 120, underground: 150 },
    designs: [
      { name: 'lit surface car park with a ticket hall and a bus shelter at the gate', height: 0.62, ops: [
        slab(3, 3, ASPHALT),
        ...[-1.0, -0.35, 0.3].flatMap((z, r): Op[] => [...bayLines(-1.3, z, 15, 0.17, 0.3, 0.02), ...carRow(-1.215, z, 15, 0.17, false, 0.02, r + 1)]),
        ...[-0.67, -0.02].flatMap((z) => [-0.9, 0, 0.9].flatMap((x) => column(x, z))),
        ['box', 0.5, 0.3, 0.3, 0.85, 0.02, 0.95, 'glass', 'civic'], ['box', 0.56, 0.04, 0.36, 0.85, 0.32, 0.95, 'boxBlue'],
        ['box', 0.6, 0.006, 0.4, -1.1, 0.02, 1.1, 'stone'], ['box', 0.36, 0.22, 0.02, -1.1, 0.02, 1.02, 'glass'], ['box', 0.42, 0.02, 0.18, -1.1, 0.24, 1.08, 'charcoal'],
        ['cyl', 0.012, 0.012, 0.36, -0.82, 0.02, 1.3, 'steel', 5], ['box', 0.1, 0.1, 0.02, -0.82, 0.3, 1.3, 'yellow'],
        ...treeLine(-1.35, 0.7, 0.4, 0.7, 6, 0.75), ...tree(1.35, 0.6, 0.8),
      ] },
      { name: 'two-level deck beside a surface lot, a canopy walkway to the stop', height: 0.66, ops: [
        slab(3, 3, ASPHALT),
        ['box', 1.4, 0.04, 2.0, -0.7, 0.3, -0.45, 'grey'], ...repeat(8, (i): Op => ['box', 0.05, 0.3, 0.05, -1.3 + (i % 4) * 0.4, 0.02, -1.3 + Math.floor(i / 4) * 1.7, 'stone']),
        ['box', 1.4, 0.06, 0.02, -0.7, 0.34, -1.44, 'stone'], ['box', 1.4, 0.06, 0.02, -0.7, 0.34, 0.54, 'stone'],
        ...carRow(-1.28, -1.0, 8, 0.16, false, 0.34, 1), ...carRow(-1.28, -0.1, 8, 0.16, false, 0.34, 3),
        ...carRow(-1.28, -1.0, 8, 0.16, false, 0.02, 2), ...carRow(-1.28, -0.1, 8, 0.16, false, 0.02, 4),
        ...[-1.1, -0.45, 0.2].flatMap((z, r): Op[] => [...bayLines(0.15, z, 7, 0.17, 0.3, 0.02), ...carRow(0.235, z, 7, 0.17, false, 0.02, r)]),
        ['box', 0.12, 0.02, 1.0, -1.1, 0.26, 0.85, 'boxBlue'], ...repeat(3, (i): Op => ['cyl', 0.01, 0.01, 0.24, -1.15, 0.02, 0.45 + i * 0.4, 'steel', 4]),
        ['box', 0.4, 0.2, 0.02, -1.1, 0.02, 1.3, 'glass'], ['box', 0.44, 0.02, 0.16, -1.1, 0.22, 1.36, 'charcoal'],
        ...lampPost(1.3, 0.8, 0.5, 'white'), ...lampPost(0.2, 0.8, 0.5, 'white'), ...tree(0.75, 1.2, 0.8), ...tree(1.3, 1.25, 0.7),
      ] },
    ],
  }],
};

export const PARKING_TIERS: KindDef[] = [kerbsideBays, multiStorey, parkAndRide];
