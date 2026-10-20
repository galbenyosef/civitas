import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { office } from './office';
import { slab, car, tree, pine, treeLine, fence, signBoard, PAVING, ASPHALT } from './tierkit';

/**
 * Death and remembrance (docs/remembrance.md): the funeral director, the churchyard, the municipal and the garden
 * cemetery and the crematorium. The simulation (server/src/sim/death.ts) reads them through shared/src/remembrance.ts.
 *
 * - The funeral director (kind id 150) is a placed sub-kind of the office family, like the broadcasters: a small
 *   business whose staff drive the hearse (FleetKind.Hearse, shared/src/fleet.ts). Attribute `funeral` marks it, `fee`
 *   is what it charges an estate (ledger 'funeral').
 * - The resting places (kind ids 151-154) are a size ladder of the park family (code 10, group 'remembrance'): leisure
 *   places of low appeal, so a cemetery is quiet green space (a little leisure value and "park nearby" for the homes in
 *   its radius, the odd retiree's walk). `rest` says what they do ('burial' or 'cremation'), `fee` what a burial or a
 *   cremation costs the estate (ledger 'burial'), `cremations` a crematorium's services a day.
 * - Each design carries its own `plots`: flat rectangles [x0, z0, x1, z1, cols, rows, ...] in the model's own frame
 *   (tile units, centre 0,0, +z towards the road), each split into cols × rows plots. Headstones (a crematorium's
 *   memorial plaques) are not in the recipe: the client draws one per filled plot (render/graves.ts), each its own
 *   shape, height, lean, weathering and flowers. The recipes leave those rectangles as open lawn.
 *
 * Faith-neutral throughout (Rich's answer 5a): chapels and a crematorium, no specific faith's places or signs.
 */

const lawn = (w: number, d: number, c: Color = 'lawn'): Op => ['box', w - 0.04, 0.012, d - 0.04, 0, 0, 0, c];
const gravel = (w: number, d: number, x: number, z: number): Op => ['box', w, 0.004, d, x, 0.012, z, 'gravel'];
/** A low wall along x (or z) of length len, centred on (x, z). */
const wall = (x: number, z: number, len: number, alongX: boolean, h = 0.06, c: Color = 'stone'): Op =>
  alongX ? ['box', len, h, 0.035, x, 0, z, c] : ['box', 0.035, h, len, x, 0, z, c];
/** A clipped hedge along x or z. */
const hedge = (x: number, z: number, len: number, alongX: boolean, h = 0.06): Op => (alongX ? ['box', len, h, 0.05, x, 0.012, z, 'hedge'] : ['box', 0.05, h, len, x, 0.012, z, 'hedge']);
/** A yew: a dark, dense, rounded cone. */
const yew = (x: number, z: number, s = 1): Op[] => [
  ['cyl', 0.014 * s, 0.02 * s, 0.05 * s, x, 0, z, 'timber', 5],
  ['cone', 0.11 * s, 0.24 * s, x, 0.03 * s, z, 0x2a4529, 8],
  ['cone', 0.08 * s, 0.14 * s, x, 0.19 * s, z, 0x30502e, 8],
];
/** A cedar of Lebanon: a stout trunk and wide flat tiers. */
const cedar = (x: number, z: number, s = 1): Op[] => [
  ['cyl', 0.03 * s, 0.045 * s, 0.22 * s, x, 0, z, 'timber', 6],
  ['cone', 0.34 * s, 0.1 * s, x, 0.16 * s, z, 0x2f4f34, 10],
  ['cone', 0.27 * s, 0.1 * s, x + 0.03 * s, 0.25 * s, z - 0.02 * s, 0x355a3a, 10],
  ['cone', 0.18 * s, 0.1 * s, x - 0.02 * s, 0.34 * s, z + 0.02 * s, 0x2f4f34, 9],
];
/** A wooden bench on the gravel (along x, or along z). */
const bench = (x: number, z: number, alongX = true): Op[] => [
  ['box', alongX ? 0.11 : 0.035, 0.018, alongX ? 0.035 : 0.11, x, 0.03, z, 'timber'],
  ['box', alongX ? 0.11 : 0.01, 0.028, alongX ? 0.01 : 0.11, alongX ? x : x - 0.016, 0.048, alongX ? z - 0.016 : z, 'timber'],
];
/** A lych-gate: two timber posts and a little slate roof over the path, ridge along x. */
const lychGate = (x: number, z: number): Op[] => [
  ['box', 0.022, 0.14, 0.022, x - 0.12, 0, z, 'timber'], ['box', 0.022, 0.14, 0.022, x + 0.12, 0, z, 'timber'],
  ['box', 0.022, 0.14, 0.022, x - 0.12, 0, z - 0.08, 'timber'], ['box', 0.022, 0.14, 0.022, x + 0.12, 0, z - 0.08, 'timber'],
  ['roof', 0.32, 0.08, 0.16, x, 0.14, z - 0.04, 'slate'],
];
/** Stone gate piers with caps either side of an opening `gap` wide at (x, z). */
const piers = (x: number, z: number, gap: number, h = 0.16): Op[] => [-1, 1].flatMap((k): Op[] => [
  ['box', 0.07, h, 0.07, x + k * (gap / 2 + 0.035), 0, z, 'stone'], ['box', 0.085, 0.025, 0.085, x + k * (gap / 2 + 0.035), h, z, 'pale'],
  ['cone', 0.03, 0.04, x + k * (gap / 2 + 0.035), h + 0.025, z, 'stone', 6],
]);
/** An obelisk on a plinth. */
const obelisk = (x: number, z: number, h: number): Op[] => [
  ['box', 0.08, 0.04, 0.08, x, 0.012, z, 'stone'],
  ['taper', 0.045, 0.045, 0.012, 0.012, h, x, 0.052, z, 'pale'],
];
/** A chest tomb (a table tomb), weathered stone. */
const chestTomb = (x: number, z: number, alongX = false): Op[] => [
  ['box', alongX ? 0.14 : 0.07, 0.045, alongX ? 0.07 : 0.14, x, 0.012, z, 0xb9b3a6],
  ['box', alongX ? 0.155 : 0.085, 0.012, alongX ? 0.085 : 0.155, x, 0.057, z, 0xa8a294],
];
/** A small mausoleum: a stone cell with a pediment and a dark door, facing +z. */
const mausoleum = (x: number, z: number, s = 1, c: Color = 0xc9c3b6): Op[] => [
  ['box', 0.16 * s, 0.13 * s, 0.18 * s, x, 0.012, z, c],
  ['roof', 0.19 * s, 0.05 * s, 0.2 * s, x, 0.012 + 0.13 * s, z, c, true],
  ['box', 0.05 * s, 0.08 * s, 0.01, x, 0.012, z + 0.09 * s, 'dark'],
];
/** A memorial cross on a stepped plinth (faith-neutral enough for a war memorial: a plain tall stone cross). */
const memorial = (x: number, z: number, h = 0.32): Op[] => [
  ['box', 0.14, 0.03, 0.14, x, 0.012, z, 'stone'], ['box', 0.1, 0.03, 0.1, x, 0.042, z, 'stone'],
  ['box', 0.03, h, 0.03, x, 0.072, z, 'pale'], ['box', 0.12, 0.025, 0.03, x, 0.072 + h * 0.66, z, 'pale'],
];
/** A rose bed: a round bed of dark soil with a few blooms. */
const roses = (x: number, z: number, r: number, bloom: Color = 0xd23a5a): Op[] => [
  ['cyl', r, r, 0.016, x, 0.012, z, 0x5b4636, 10],
  ...repeat(5, (i): Op => ['cone', r * 0.32, 0.05, x + r * 0.55 * Math.cos(i * 1.26), 0.026, z + r * 0.55 * Math.sin(i * 1.26), i % 2 ? bloom : 0xf0a3b8, 5]),
];
/** A gabled chapel with its door on the front (+z) gable (a facade nave named `name`): nave along z, a little bell-cote over the door. */
const chapelZ = (name: string, x: number, z: number, w: number, d: number, h: number, body: Color, roof: Color, bell = true, sideBays = 3): Op[] => [
  ['box', w, h, d, x, 0.012, z, body, 'civic', { name, facade: { storeys: 1, bays: 1, sideBays, ground: 'door' } }],
  ['roof', w + 0.05, h * 0.62, d + 0.05, x, 0.012 + h, z, roof, true],
  ...(bell ? [['box', 0.07, 0.1, 0.05, x, 0.012 + h + h * 0.5, z + d / 2 - 0.03, body] as Op, ['roof', 0.09, 0.05, 0.07, x, 0.012 + h + h * 0.5 + 0.1, z + d / 2 - 0.03, roof, true] as Op] : []),
];

/** The number of plots in a flat plot list. */
export const plotCount = (plots: number[]) => { let n = 0; for (let i = 0; i + 5 < plots.length; i += 6) n += plots[i + 4] * plots[i + 5]; return n; };

// ================================================================= the funeral director

const FUNERAL_OCC = {
  name: 'funeral staff', rotate: true,
  shifts: [{ start: 8, hours: 9, weight: 0.75 }, { start: 10, hours: 8, weight: 0.25 }],
  cycles: [[1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 0, 1, 1, 0], [0, 1, 1, 1, 1, 1, 0], [1, 0, 1, 1, 0, 1, 1]],
};

export const funeralDirector: KindDef = {
  id: 'funeral-director', name: 'funeral director', code: Zone.Office, kindId: 150, family: 'office',
  flags: { civic: true, workplace: true }, windows: 'shop',
  tool: { id: 'funeral', key: '', label: 'Funeral director', color: '#2b2b33' },
  occupation: FUNERAL_OCC, lot: { wage: office.lot?.wage ?? 14 },
  blurb: 'An undertaker\'s on the high street: a chapel of rest, a hearse and the staff to arrange a funeral. It collects the dead, holds the service at a chapel or crematorium and is paid from the estate.',
  howTo: 'One tile beside a road, within 60 tiles of the homes it serves. It needs a churchyard, cemetery or crematorium to take its funerals to. Needs Remembrance.',
  attrs: { funeral: 1, fee: 220, title: 'funeral director' },
  tints: [0xffffff, 0xf2efe8, 0xeef0f2],
  levels: [{
    capacity: 6, wage: 18, cost: 600, upkeep: 12, work: 300, parking: { surface: 2, underground: 4 },
    designs: [
      { name: 'Victorian brick undertaker\'s with a black fascia and a coach arch', height: 0.6, ops: [
        slab(1, 1, PAVING),
        ['box', 0.58, 0.52, 0.46, -0.14, 0.02, -0.16, 'brick', true, { name: 'shop', facade: { storeys: 2, bays: 3, sideBays: 2, ground: 'shopfront' } }],
        ['cornice', 'shop', 2, 'stone'],
        ['roof', 0.62, 0.12, 0.5, -0.14, 0.54, -0.16, 'slate'],
        ['awning', 'shop', 'front', 0, 2, 0x1b1c22],
        ['box', 0.3, 0.32, 0.46, 0.32, 0.02, -0.16, 'brick'], ['box', 0.3, 0.03, 0.48, 0.33, 0.34, -0.16, 'stone'],
        ['box', 0.2, 0.2, 0.012, 0.32, 0.02, 0.075, 0x1d1e24],
        ['box', 0.08, 0.03, 0.06, -0.3, 0.02, 0.15, 0x6b5a4a], ['cone', 0.03, 0.06, -0.3, 0.05, 0.15, 'hedge', 6],
        ['box', 0.08, 0.03, 0.06, 0.02, 0.02, 0.15, 0x6b5a4a], ['cone', 0.03, 0.06, 0.02, 0.05, 0.15, 'hedge', 6],
      ] },
      { name: 'pale stone chapel of rest with a porch and a hearse at the door', height: 0.52, ops: [
        slab(1, 1, 'gravel'),
        ['box', 0.66, 0.3, 0.42, -0.04, 0.02, -0.2, 'stone', true, { name: 'rest', facade: { storeys: 1, bays: 4, sideBays: 2, ground: 'door' } }],
        ['roof', 0.72, 0.18, 0.48, -0.04, 0.32, -0.2, 'slate'],
        ['porch', 'rest', 'front', 1, 2, 'slate', 'white'],
        ...signBoard(0.33, 0.36, 0.26, 0x1b1c22, 'gold'),
        ['box', 0.12, 0.07, 0.3, 0.39, 0.02, -0.02, 0x15161b], ['box', 0.1, 0.04, 0.2, 0.39, 0.09, -0.06, 'glassDark'],
        ['box', 0.1, 0.015, 0.06, 0.39, 0.092, -0.12, 0xf3f0e6],
        ['box', 0.34, 0.05, 0.05, -0.36, 0.012, 0.4, 'hedge'],
        ...tree(-0.42, -0.42, 0.6),
      ] },
    ],
  }],
};

// ================================================================= resting places (the park family, group 'remembrance')

const REST = {
  code: 10, family: 'leisure' as const, flags: { civic: true, leisureReady: true }, windows: 'civic' as const, group: 'remembrance',
};
/** A quiet place: open by day, little appeal but to retirees, nothing for children, no ticket. */
const QUIET = { venueType: 'park', openHours: [8, 20] as [number, number], ticket: 0, stay: [0.4, 1] as [number, number], dayAppeal: 0.3, eveningAppeal: 0.04, retireeAppeal: 1.1, childAppeal: 0.05, trees: 0, benches: 0, rest: 'burial' };

// ---- churchyard (2×2) ----
const CY_A = [-0.18, -0.66, 0.78, 0.74, 5, 5, -0.92, 0.2, -0.6, 0.76, 2, 2];
const CY_B = [-0.92, -0.86, -0.62, 0.22, 2, 5, -0.32, -0.22, 0.82, 0.8, 6, 4];

export const churchyard: KindDef = {
  ...REST, id: 'churchyard', name: 'churchyard', kindId: 151, tier: 1,
  tool: { id: 'churchyard', key: '', label: 'Churchyard', color: '#6f8a5c' },
  blurb: 'A small chapel in a walled yard of graves under the yews: the cheapest place to bury your dead, with room for about thirty.',
  howTo: 'A 2×2 plot beside a road among homes. A funeral director brings its funerals here; when the plots are full, build a cemetery or a crematorium. Needs Remembrance.',
  footprint: { w: 2, h: 2, door: [0, 1] },
  attrs: { ...QUIET },
  levels: [{
    capacity: 0, wage: 0, cost: 700, upkeep: 6, work: 360, parking: { surface: 2, underground: 2 },
    attrs: { title: 'churchyard', visitorCapacity: 6, leisureValue: 1.5, radius: 8, fee: 120, plotCount: Math.min(plotCount(CY_A), plotCount(CY_B)) },
    designs: [
      { name: 'flint chapel with a bell-cote, a lych-gate and old yews', height: 0.76, attrs: { plots: CY_A }, ops: [
        lawn(2, 2, 'lawnDark'),
        wall(-0.77, 0.96, 0.38, true), wall(0.32, 0.96, 1.28, true), wall(0, -0.96, 1.92, true), wall(-0.96, 0, 1.92, false), wall(0.96, 0, 1.92, false),
        ...lychGate(-0.45, 0.9),
        gravel(0.13, 1.14, -0.45, 0.37),
        ...chapelZ('nave', -0.45, -0.56, 0.34, 0.64, 0.28, 0x8e8a80, 'slate'),
        ...yew(0.88, 0.86, 0.75), ...yew(-0.86, -0.1, 0.9), ...yew(-0.02, -0.86, 1.0), ...yew(0.84, -0.84, 0.8),
        ...bench(-0.29, 0.5, false),
        ...chestTomb(-0.75, -0.62),
      ] },
      { name: 'stone chapel with a squat tower and a gravel walk round the graves', height: 0.82, attrs: { plots: CY_B }, ops: [
        lawn(2, 2),
        wall(-0.79, 0.96, 0.34, true), wall(0.29, 0.96, 1.34, true), wall(0, -0.96, 1.92, true), wall(-0.96, 0, 1.92, false), wall(0.96, 0, 1.92, false),
        ...piers(-0.5, 0.93, 0.24, 0.12),
        gravel(0.13, 1.28, -0.5, 0.32), gravel(0.62, 0.12, -0.2, -0.36),
        ['box', 0.6, 0.26, 0.32, 0.42, 0.012, -0.62, 'stone', 'civic', { name: 'nave', facade: { storeys: 1, bays: 3, sideBays: 0 } }], ['roof', 0.66, 0.16, 0.38, 0.42, 0.272, -0.62, 'slate'],
        ['box', 0.2, 0.48, 0.2, 0.02, 0.012, -0.62, 'stone'],
        ...[[-0.07, -0.71], [0.11, -0.71], [-0.07, -0.53], [0.11, -0.53]].map(([bx, bz]): Op => ['box', 0.04, 0.05, 0.04, bx, 0.492, bz, 'stone']),
        ['box', 0.08, 0.14, 0.012, 0.02, 0.012, -0.516, 'door'],
        ...yew(-0.82, 0.78, 0.8), ...pine(0.86, -0.86, 0.9), ...tree(0.88, 0.88, 0.6),
        ...chestTomb(0.62, -0.36, true),
        ...bench(-0.36, 0.62, false),
      ] },
    ],
  }],
};

// ---- municipal cemetery (3×3) ----
const MC_A = [-1.35, -0.66, -0.3, 0.12, 6, 3, -1.35, 0.38, -0.3, 1.3, 6, 4, 0.3, -0.66, 1.35, 0.12, 6, 3, 0.3, 0.38, 1.35, 1.3, 6, 4];
const MC_B = [-1.35, -1.35, -0.15, -0.6, 7, 3, 0.15, -1.35, 1.35, -0.6, 7, 3, -1.35, -0.25, -0.15, 0.6, 7, 3, 0.15, -0.25, 1.35, 0.75, 7, 4];

export const municipalCemetery: KindDef = {
  ...REST, id: 'municipal-cemetery', name: 'municipal cemetery', kindId: 152, tier: 2,
  tool: { id: 'cemetery', key: '', label: 'Cemetery', color: '#5d7a52' },
  blurb: 'The town\'s cemetery: a chapel at the end of an avenue of limes and plot fields for nearly a hundred graves.',
  howTo: 'A 3×3 plot beside a road. Funerals come here from the funeral directors in reach; its lawns count as quiet green space for the homes round it. Needs Remembrance.',
  footprint: { w: 3, h: 3, door: [1, 2] },
  attrs: { ...QUIET },
  levels: [{
    capacity: 0, wage: 0, cost: 1400, upkeep: 12, work: 620, parking: { surface: 4, underground: 4 },
    attrs: { title: 'municipal cemetery', visitorCapacity: 10, leisureValue: 2, radius: 10, fee: 150, plotCount: Math.min(plotCount(MC_A), plotCount(MC_B)) },
    designs: [
      { name: 'twin Victorian chapels under a spire, an avenue of limes and a memorial cross', height: 1.0, attrs: { plots: MC_A }, ops: [
        lawn(3, 3),
        ...fence(-0.84, 1.46, 1.3, true, 'charcoal', 0.08), ...fence(0.84, 1.46, 1.3, true, 'charcoal', 0.08),
        ...fence(0, -1.46, 2.92, true, 'charcoal', 0.08), ...fence(-1.46, 0, 2.92, false, 'charcoal', 0.08), ...fence(1.46, 0, 2.92, false, 'charcoal', 0.08),
        ...piers(0, 1.43, 0.3),
        gravel(0.22, 2.3, 0, 0.3), gravel(2.8, 0.12, 0, 0.25),
        ...chapelZ('west', -0.42, -1.1, 0.36, 0.48, 0.32, 'stone', 'slate', false, 0), ...chapelZ('east', 0.42, -1.1, 0.36, 0.48, 0.32, 'stone', 'slate', false, 0),
        ['box', 0.48, 0.24, 0.16, 0, 0.012, -1.1, 'stone'], ['box', 0.2, 0.17, 0.17, 0, 0.012, -1.1, 'dark'],
        ['box', 0.16, 0.2, 0.16, 0, 0.252, -1.1, 'stone'], ['taper', 0.15, 0.15, 0, 0, 0.5, 0, 0.452, -1.1, 'slate'],
        ...treeLine(-0.2, 1.2, -0.2, -0.6, 5, 0.9), ...treeLine(0.2, 1.2, 0.2, -0.6, 5, 0.9),
        ...memorial(0, 0.25, 0.3),
        ...yew(-1.3, -1.3, 1), ...yew(1.3, -1.3, 1), ...pine(-1.32, 1.3, 1), ...pine(1.32, 1.3, 1),
        ...bench(-0.2, 0.52), ...bench(0.2, -0.04),
      ] },
      { name: 'modern brick chapel by the gate and hedged rooms of graves', height: 0.86, attrs: { plots: MC_B }, ops: [
        lawn(3, 3, 'lawnDark'),
        hedge(-0.84, 1.45, 1.3, true), hedge(0.84, 1.45, 1.3, true), hedge(0, -1.45, 2.92, true), hedge(-1.45, 0, 2.92, false), hedge(1.45, 0, 2.92, false),
        ['box', 0.9, 0.28, 0.42, -0.82, 0.012, 1.08, 'brick', 'civic', { name: 'chapel', facade: { storeys: 1, bays: 4, sideBays: 2, ground: 'door' } }], ['box', 0.94, 0.03, 0.46, -0.82, 0.292, 1.08, 'charcoal'],
        ['box', 0.1, 0.72, 0.1, -0.22, 0.012, 0.98, 'brick'], ['box', 0.12, 0.03, 0.12, -0.22, 0.732, 0.98, 'charcoal'],
        ['box', 0.86, 0.004, 0.42, 0.82, 0.012, 1.12, ASPHALT], ...car(0.6, 1.12, 'silver'), ...car(0.95, 1.12, 'navy'),
        gravel(0.2, 2.8, 0, 0), gravel(2.8, 0.16, 0, -0.42),
        hedge(-0.75, -0.08, 1.2, true, 0.05), hedge(0.75, -0.08, 1.2, true, 0.05),
        ...tree(-1.3, -0.42, 0.8), ...tree(1.3, -0.42, 0.8), ...pine(0.12, 1.32, 0.8),
        ...bench(-0.15, -0.6, false), ...bench(0.15, 0.4, false),
      ] },
    ],
  }],
};

// ---- garden cemetery (4×4) ----
const GC_A = [-1.86, -1.8, -1.18, -0.42, 3, 6, -0.92, -1.8, 0.9, -0.48, 8, 5, 1.12, -1.0, 1.86, 0.46, 3, 5, -1.86, 0.02, -1.18, 1.46, 3, 5, 0.2, 0.96, 1.86, 1.8, 7, 3, 0.26, -0.18, 0.92, 0.68, 3, 3];
const GC_B = [-1.86, -1.0, -0.8, -0.02, 5, 4, -0.2, -1.0, 1.86, -0.02, 9, 4, -1.86, 0.44, -0.8, 1.76, 5, 5, -0.2, 0.44, 1.86, 1.76, 9, 5];

export const gardenCemetery: KindDef = {
  ...REST, id: 'garden-cemetery', name: 'garden cemetery', kindId: 153, tier: 3,
  tool: { id: 'gardencemetery', key: '', label: 'Garden cemetery', color: '#4a6b45' },
  blurb: 'A great Victorian garden cemetery: winding paths, catacombs and monuments under old trees, with room for well over a hundred graves. The finest burial ground in town, and the dearest.',
  howTo: 'A 4×4 plot beside a road. A good walk for retirees and a quiet park for the streets round it. Needs Remembrance.',
  footprint: { w: 4, h: 4, door: [1, 3] },
  attrs: { ...QUIET, retireeAppeal: 1.3, dayAppeal: 0.4 },
  levels: [{
    capacity: 0, wage: 0, cost: 2600, upkeep: 22, work: 1150, parking: { surface: 4, underground: 4 },
    attrs: { title: 'garden cemetery', visitorCapacity: 16, leisureValue: 3, radius: 12, fee: 260, plotCount: Math.min(plotCount(GC_A), plotCount(GC_B)), plotJitter: 0.05 },
    designs: [
      { name: 'Egyptian avenue to a circle of catacombs under a cedar, winding paths and monuments', height: 0.7, attrs: { plots: GC_A }, ops: [
        lawn(4, 4, 'lawnDark'),
        wall(-1.3, 1.96, 1.32, true, 0.1, 0x8a5a44), wall(0.66, 1.96, 2.68, true, 0.1, 0x8a5a44), wall(0, -1.96, 3.92, true, 0.1, 0x8a5a44),
        wall(-1.96, 0, 3.92, false, 0.1, 0x8a5a44), wall(1.96, 0, 3.92, false, 0.1, 0x8a5a44),
        ['taper', 0.12, 0.1, 0.07, 0.06, 0.26, -0.72, 0, 1.88, 0xc8bea8], ['taper', 0.12, 0.1, 0.07, 0.06, 0.26, -0.28, 0, 1.88, 0xc8bea8],
        gravel(0.24, 1.1, -0.5, 1.4),
        ['box', 0.04, 0.15, 0.9, -0.68, 0.012, 1.36, 0xbdb39c], ['box', 0.04, 0.15, 0.9, -0.32, 0.012, 1.36, 0xbdb39c],
        ['cyl', 0.5, 0.5, 0.15, -0.5, 0.012, 0.3, 0xbdb39c, 24], ['cyl', 0.37, 0.37, 0.155, -0.5, 0.012, 0.3, 'lawnDark', 24],
        ['cyl', 0.62, 0.62, 0.004, -0.5, 0.012, 0.3, 'gravel', 24],
        ...cedar(-0.5, 0.3, 1.1),
        gravel(1.3, 0.12, 0.45, -0.3), gravel(0.12, 1.1, 1.0, 0.25), gravel(0.12, 1.2, -1.02, -0.9), gravel(1.0, 0.12, -1.45, -0.32),
        gravel(1.5, 0.12, 1.0, 0.82),
        ...obelisk(1.5, -1.5, 0.42), ...mausoleum(1.55, 0.7, 1.1), ...mausoleum(-1.55, 1.7, 1), ...chestTomb(0.05, 0.4), ...chestTomb(0.45, 0.8, true),
        ...memorial(-1.0, -0.3, 0.26),
        ...treeLine(-1.9, -1.9, 1.9, -1.9, 9, 1), ...tree(1.0, -0.4, 1.1), ...tree(-1.55, 0.6, 1), ...pine(-0.95, 1.7, 1.1), ...tree(1.55, 1.85, 0.9),
        ...yew(-1.05, -1.6, 0.9), ...yew(0.98, -1.6, 0.9), ...yew(1.0, 1.0, 0.8),
        ...bench(0.2, -0.3), ...bench(-1.45, -0.18),
      ] },
      { name: 'Doric chapel over the catacomb, colonnades and avenues to a monument', height: 0.86, attrs: { plots: GC_B }, ops: [
        lawn(4, 4),
        ...fence(-1.4, 1.96, 1.12, true, 'charcoal', 0.09), ...fence(0.65, 1.96, 2.62, true, 'charcoal', 0.09),
        ...fence(0, -1.96, 3.92, true, 'charcoal', 0.09), ...fence(-1.96, 0, 3.92, false, 'charcoal', 0.09), ...fence(1.96, 0, 3.92, false, 'charcoal', 0.09),
        ...piers(-0.5, 1.93, 0.34, 0.2),
        gravel(0.26, 3.0, -0.5, 0.45), gravel(3.8, 0.18, 0, 0.21),
        ['box', 0.66, 0.34, 0.4, -0.5, 0.012, -1.5, 'stone', 'civic', { name: 'chapel', facade: { storeys: 1, bays: 3, sideBays: 2, ground: 'door' } }], ['roof', 0.7, 0.14, 0.56, -0.5, 0.352, -1.42, 'stone', true],
        ...repeat(4, (i): Op => ['cyl', 0.025, 0.028, 0.32, -0.71 + i * 0.14, 0.032, -1.24, 'pale', 8]),
        ...repeat(6, (i): Op => ['cyl', 0.018, 0.02, 0.2, -1.75 + i * 0.13, 0.012, -1.62, 'pale', 6]), ['box', 0.8, 0.04, 0.1, -1.42, 0.212, -1.62, 'stone'],
        ...repeat(6, (i): Op => ['cyl', 0.018, 0.02, 0.2, 0.1 + i * 0.13, 0.012, -1.62, 'pale', 6]), ['box', 0.8, 0.04, 0.1, 0.42, 0.212, -1.62, 'stone'],
        ['cyl', 0.2, 0.2, 0.006, -0.5, 0.014, 0.21, 'gravel', 16], ...obelisk(-0.5, 0.21, 0.5),
        ...mausoleum(1.6, -1.6, 1.1, 0xb8b2a4), ...mausoleum(-1.6, 1.62, 1), ...chestTomb(1.2, 0.2, true), ...chestTomb(-1.3, 0.2, true),
        ...treeLine(-0.75, 1.6, -0.75, 0.5, 4, 0.9), ...treeLine(-0.25, 1.6, -0.25, 0.5, 4, 0.9),
        ...treeLine(-0.8, -0.2, -0.8, -1.0, 3, 0.8), ...treeLine(-0.2, -0.2, -0.2, -1.0, 3, 0.8),
        ...pine(1.85, 1.85, 1), ...tree(1.85, -1.85, 1), ...yew(-1.85, -1.85, 1),
        ...bench(0.4, 0.4), ...bench(-1.3, 0.4),
      ] },
    ],
  }],
};

// ---- crematorium (3×2) ----
const CR_A = [0.6, -0.22, 1.36, 0.76, 6, 4];
const CR_B = [0.42, -0.82, 1.4, 0.0, 6, 3, 0.42, 0.3, 1.4, 0.82, 6, 2];

export const crematorium: KindDef = {
  ...REST, id: 'crematorium', name: 'crematorium', kindId: 154, tier: 4,
  tool: { id: 'crematorium', key: '', label: 'Crematorium', color: '#8a5040' },
  blurb: 'Chapels, a chimney and a garden of remembrance with memorial plaques. A crematorium takes several funerals a day and never fills up, but it costs more to run.',
  howTo: 'A 3×2 plot beside a road, away from the busiest streets. The funeral directors\' own staff hold the services, so it hires nobody, but its upkeep is the highest of the four. Needs Remembrance.',
  footprint: { w: 3, h: 2, door: [1, 1] },
  attrs: { ...QUIET, rest: 'cremation', retireeAppeal: 0.8 },
  levels: [{
    capacity: 0, wage: 0, cost: 2200, upkeep: 30, work: 560, parking: { surface: 6, underground: 8 },
    attrs: { title: 'crematorium', visitorCapacity: 8, leisureValue: 1.5, radius: 12, fee: 180, cremations: 6, plotCount: Math.min(plotCount(CR_A), plotCount(CR_B)) },
    designs: [
      { name: 'red-brick Italianate chapels with a campanile chimney, a cloister and a garden of remembrance', height: 1.42, attrs: { plots: CR_A }, ops: [
        slab(3, 2, PAVING), ['box', 1.0, 0.012, 1.86, 0.97, 0.012, 0, 'lawn'],
        ['box', 1.0, 0.4, 0.5, -0.92, 0.02, -0.64, 0xa8553c, 'civic', { name: 'chapel', facade: { storeys: 1, bays: 4, sideBays: 2, ground: 'door' } }], ['roof', 1.06, 0.14, 0.56, -0.92, 0.42, -0.64, 'terracotta'],
        ['porch', 'chapel', 'front', 2, 2, 'terracotta', 'stone'],
        ['box', 0.22, 1.2, 0.22, -0.16, 0.02, -0.7, 0xa04e37], ['box', 0.24, 0.04, 0.24, -0.16, 1.0, -0.7, 'stone'],
        ['box', 0.14, 0.1, 0.012, -0.16, 1.06, -0.584, 'dark'], ['taper', 0.24, 0.24, 0.02, 0.02, 0.16, -0.16, 1.22, -0.7, 'terracotta'],
        ['box', 0.06, 0.08, 0.06, -0.1, 1.22, -0.76, 'charcoal'],
        ...repeat(6, (i): Op => ['cyl', 0.016, 0.018, 0.2, 0.34, 0.02, -0.5 + i * 0.2, 'stone', 6]), ['box', 0.12, 0.03, 1.12, 0.34, 0.22, 0.0, 'terracotta'],
        ['box', 1.4, 0.004, 0.62, -0.72, 0.02, 0.6, ASPHALT], ...car(-1.2, 0.62, 'charcoal'), ...car(-0.9, 0.62, 'silver'), ...car(-0.3, 0.62, 'white'),
        ['box', 0.5, 0.02, 0.14, 0.97, 0.02, -0.55, 'pond'], ['box', 0.54, 0.025, 0.18, 0.97, 0.012, -0.55, 'stone'],
        ...roses(0.75, -0.8, 0.07), ...roses(1.2, -0.8, 0.07, 0xe7c13e), ...roses(0.75, -0.32, 0.06), ...roses(1.22, -0.32, 0.06, 0xb64d8a),
        ...yew(1.4, 0.88, 0.7), ...tree(0.55, 0.9, 0.7),
        ...bench(0.97, -0.38),
      ] },
      { name: 'pale stone hall with a slim steel chimney, a reflecting pool and a walled garden', height: 1.5, attrs: { plots: CR_B }, ops: [
        slab(3, 2, PAVING), ['box', 1.08, 0.012, 1.86, 0.92, 0.012, 0, 'lawnDark'],
        ['box', 1.2, 0.32, 0.6, -0.72, 0.02, -0.5, 'pale', 'civic'], ['box', 1.36, 0.035, 0.76, -0.72, 0.34, -0.48, 'white'],
        ['box', 0.9, 0.24, 0.02, -0.72, 0.02, -0.19, 'glass'],
        ['cyl', 0.035, 0.045, 1.3, -1.4, 0.02, -0.88, 'steel', 10], ['cyl', 0.05, 0.05, 0.05, -1.4, 1.32, -0.88, 'charcoal', 10],
        ['box', 0.95, 0.02, 0.26, -0.62, 0.02, 0.32, 'pond'], ['box', 0.99, 0.024, 0.3, -0.62, 0.012, 0.32, 'stone'],
        wall(0.38, 0, 1.88, false, 0.12, 'pale'), wall(0.92, -0.95, 1.08, true, 0.12, 'pale'),
        ...roses(0.92, 0.15, 0.08), ...roses(0.62, 0.15, 0.06, 0xe7c13e), ...roses(1.22, 0.15, 0.06, 0xb64d8a),
        ...pine(1.42, -0.9, 0.9), ...tree(-1.3, 0.75, 0.8), ...tree(0.1, 0.8, 0.7),
        ...car(-1.1, 0.75, 'charcoal', true), ...car(-0.65, 0.75, 'silver', true),
        ...bench(-0.62, 0.55),
      ] },
    ],
  }],
};

export const REMEMBRANCE: KindDef[] = [funeralDirector, churchyard, municipalCemetery, gardenCemetery, crematorium];
