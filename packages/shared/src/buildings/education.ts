import type { KindDef, Op, OccupationDef, Attributes } from './schema';
import { repeat } from './helpers';
import { car, carRow, tree, pine, fence, signBoard, flags, plant, van, mast } from './tierkit';
import {
  ASPHALT, PAVING, jit, ground, patch, hopscotch, climbingFrame, goal, pitchLines, cupola, clockFace, bikeShed,
  lamp, lampRow, scatterTrees, benchRow, hedge, buggy, pickets,
} from './edukit';

/**
 * Education (docs/education.md section 3): eight institutions, kind ids 101-108, a ladder of stages from the nursery
 * to the research institute. They are sub-kinds of the library family (code 14): a school is not leisure
 * (`isLeisure` is by id and the family is civic) and not a service (no `service` flag), so coverage, happiness and tax
 * tolerance read them as they read nothing today. What a pupil's school does is data, read by the schools simulation
 * (E3) from the attributes: `stage` (the number a citizen's `study` field holds: 1 nursery, 2 primary, 3 secondary,
 * 4 sixth form, 5 FE college, 6 university, 7 research; 0 for halls), `pupilCapacity` (places), `eveningPlaces`,
 * `catchment` (tiles by road, 0 = the whole city), `ages` ([from, to]), `teachersShare` (the share of staff that must
 * be qualified; `postgradShare` of staff are postgraduates), `beds`. Staff are the kind's level capacity, as for any
 * civic kind, and teachers come from the educated population.
 *
 * Every kind is a draft until the Showcase places it (E8). Recipes bigger than 1×1 are authored in tiles for the
 * whole footprint: x -w/2..w/2, z -h/2..h/2, +z towards the road. Lamps, benches and trees on lawns and quads sit at
 * hashed offsets (edukit.ts), never on a grid.
 */

/** pupils walk in on weekdays; the school day is the shift, the weekend is the holidays */
const staff = (name: string, shifts: OccupationDef['shifts'], cycles: number[][] = [[1, 1, 1, 1, 1, 0, 0]]): OccupationDef => ({ name, rotate: false, shifts, cycles });

/** the common fields of every education kind */
const edu = (
  k: { id: string; name: string; kindId: number; tier: number; footprint?: KindDef['footprint']; tool: KindDef['tool']; blurb: string; howTo: string; occupation: OccupationDef; attrs: Attributes; windows?: KindDef['windows'] },
  l: { capacity: number; wage: number; cost: number; upkeep: number; parking: { surface: number; underground: number }; designs: KindDef['levels'][0]['designs'] },
): KindDef => {
  const area = (k.footprint?.w ?? 1) * (k.footprint?.h ?? 1);
  return {
    id: k.id, name: k.name, code: 14, kindId: k.kindId, family: 'civic', flags: { civic: true, workplace: true }, windows: k.windows ?? 'civic',
    group: 'education', tier: k.tier, draft: true, ...(k.footprint ? { footprint: k.footprint } : {}),
    tool: k.tool, blurb: k.blurb, howTo: k.howTo, occupation: k.occupation, lot: { wage: l.wage }, attrs: k.attrs,
    // build work grows with the footprint (buildings:check "groups and tiers")
    levels: [{ capacity: l.capacity, wage: l.wage, cost: l.cost, upkeep: l.upkeep, work: 150 * area + 150, parking: l.parking, designs: l.designs }],
  };
};

const STOCK = 0xcdb572, STOCK_DK = 0xb59a58; // yellow London stock brick, and its weathered darker courses

// ================================================================= 101 nursery

export const nursery: KindDef = edu({
  id: 'nursery', name: 'nursery', kindId: 101, tier: 1,
  tool: { id: 'nursery', key: '', label: 'Nursery', color: '#f0c85a' },
  blurb: 'Thirty places for three- and four-year-olds, a few nursery nurses and a fenced garden with a sandpit. A nursery year gives children a better chance at primary school.',
  howTo: 'One tile in a residential street, beside a road. Children from homes within eight tiles are admitted; families like one close by. Needs Schools.',
  occupation: staff('nursery nurse', [{ start: 7.5, hours: 8, weight: 0.6 }, { start: 8.5, hours: 8, weight: 0.4 }]),
  attrs: { stage: 1, pupilCapacity: 30, catchment: 8, ages: [3, 4], teachersShare: 0.5, title: 'nursery' },
}, {
  capacity: 6, wage: 24, cost: 300, upkeep: 10, parking: { surface: 2, underground: 4 },
  designs: [
    { name: 'single-storey nursery with coloured cladding pods, a fenced garden with a sandpit and a buggy shelter', height: 0.32, ops: [
      ground(1, 1, 'lawn'),
      patch(0.15, 0.2, -0.19, 0.4, PAVING),
      ['box', 0.52, 0.2, 0.28, -0.14, 0.02, 0.22, 'white', true, { name: 'hall', facade: { storeys: 1, bays: 4, sideBays: 0 } }],
      ['door', 'hall', 'front', 1, 'boxBlue'],
      ['box', 0.58, 0.022, 0.34, -0.14, 0.22, 0.22, 'boxGreen'],
      // two cladding pods, one a storey of its own
      ['box', 0.17, 0.2, 0.24, 0.215, 0.02, 0.22, 'yellow'], ['box', 0.19, 0.022, 0.26, 0.215, 0.22, 0.22, 'boxOrange'],
      ['box', 0.12, 0.28, 0.16, 0.22, 0.02, 0.2, 'boxBlue'],
      ['box', 0.14, 0.022, 0.18, 0.22, 0.3, 0.2, 'red'],
      // the buggy shelter by the gate
      ...[[0.28, 0.4], [0.46, 0.4], [0.28, 0.48], [0.46, 0.48]].map(([x, z]): Op => ['cyl', 0.006, 0.006, 0.07, x, 0.02, z, 'steel', 4]),
      ['box', 0.2, 0.01, 0.1, 0.37, 0.09, 0.44, 'boxGreen'],
      ...buggy(0.33, 0.44, 0.02, 'navy'), ...buggy(0.38, 0.44, 0.02, 'red'), ...buggy(0.43, 0.44, 0.02, 'boxGreen'),
      // the garden behind: fence, sandpit, a play house, a trike track
      ...pickets(0, -0.46, 0.9, true), ...pickets(-0.46, -0.2, 0.52, false), ...pickets(0.46, -0.2, 0.52, false),
      ['box', 0.18, 0.02, 0.18, -0.26, 0.02, -0.26, 'timber'], ['box', 0.15, 0.018, 0.15, -0.26, 0.024, -0.26, 'sand'],
      ['box', 0.1, 0.07, 0.1, 0.2, 0.02, -0.28, 'boxOrange'], ['cone', 0.085, 0.06, 0.2, 0.09, -0.28, 'boxBlue', 4],
      ['cyl', 0.13, 0.13, 0.006, 0.0, 0.02, -0.14, 'gravel', 14],
      ...tree(-0.38, -0.4, 0.9), ...tree(0.38, -0.42, 0.8), ...pine(0.05, -0.4, 0.8),
      ['box', 0.07, 0.04, 0.06, -0.1, 0.02, -0.04, 'boxBlue'], ['box', 0.07, 0.04, 0.06, 0.02, 0.02, -0.02, 'red'], // toy boxes
    ] },
    { name: 'converted Victorian villa with a canopy, a bay window, a painted picket fence and a trike track', height: 0.69, ops: [
      ground(1, 1, 'lawn'),
      patch(0.12, 0.3, -0.12, 0.33, PAVING), ...hopscotch(-0.12, 0.38),
      ['box', 0.48, 0.4, 0.3, -0.06, 0.02, 0.0, STOCK, true, { name: 'villa', facade: { storeys: 2, bays: 3, sideBays: 0 } }],
      ['roof', 0.54, 0.2, 0.36, -0.06, 0.42, 0.0, 'slate', true, { name: 'ridge' }],
      ['door', 'villa', 'front', 1, 'boxGreen'],
      ['baywindow', 'villa', 'front', 0, 0, 'slate'],
      ['dormer', 'ridge', 1, 'white'],
      ['porch', 'villa', 'front', 1, 1, 'boxGreen', 'white'],
      ['cornice', 'villa', 1, 'stone'],
      ['chimneyStack', -0.24, 0.5, -0.06, 0.12, 0.03],
      // the play-room extension, flat-roofed, windowless side wall facing the garden
      ['box', 0.22, 0.2, 0.26, 0.37, 0.02, -0.02, 'cream', true, { name: 'ext', facade: { storeys: 1, bays: 2, sideBays: 0 } }],
      ['box', 0.26, 0.02, 0.3, 0.37, 0.22, -0.02, 'boxOrange'],
      ...pickets(0, 0.47, 0.9, true), ...pickets(-0.46, 0.2, 0.55, false), ...pickets(0.46, 0.2, 0.55, false),
      ['box', 0.03, 0.06, 0.012, -0.12, 0.02, 0.47, 'boxGreen'], // the gate, a coloured leaf in the fence
      ['cyl', 0.1, 0.1, 0.006, 0.12, 0.02, -0.33, 'gravel', 12],
      ['box', 0.12, 0.02, 0.12, -0.3, 0.02, -0.32, 'timber'], ['box', 0.1, 0.016, 0.1, -0.3, 0.024, -0.32, 'sand'],
      ...pickets(0, -0.47, 0.9, true),
      ...tree(0.36, -0.38, 1.0), ...tree(-0.4, -0.12, 0.9), ...pine(0.42, 0.34, 0.8),
      hedge(0.16, 0.05, 0.3, 0.42),
    ] },
  ],
});

// ================================================================= 102 primary school

export const primary: KindDef = edu({
  id: 'primary-school', name: 'primary school', kindId: 102, tier: 2, footprint: { w: 2, h: 2, door: [0, 1] },
  tool: { id: 'primary', key: '', label: 'Primary school (2×2)', color: '#e0a83a' },
  blurb: 'A hundred and twenty places for ages four to eleven, with ten staff and a playground. Children go to the nearest school with room, so a school near homes fills fast.',
  howTo: 'A 2×2 plot beside a road, the door on the frontage. Homes within twelve tiles can send children here. Under-eights are walked in, so keep it close to homes. Needs Schools.',
  occupation: staff('primary teacher', [{ start: 8, hours: 8, weight: 0.7 }, { start: 8.5, hours: 8, weight: 0.3 }]),
  attrs: { stage: 2, pupilCapacity: 120, catchment: 12, ages: [4, 11], teachersShare: 0.6, title: 'primary school' },
}, {
  capacity: 10, wage: 25, cost: 900, upkeep: 30, parking: { surface: 6, underground: 10 },
  designs: [
    { name: 'London board school in yellow stock brick with gables, a bell cupola and BOYS and GIRLS entrances on a tarmac playground', height: 0.92, ops: [
      ground(2, 2, 'gravel'),
      patch(1.84, 0.62, 0.0, -0.64, ASPHALT), patch(1.84, 0.3, 0.0, 0.72, PAVING),
      // the main range: two tall storeys, eight bays, the BOYS and GIRLS doors at either end
      ['box', 1.76, 0.46, 0.5, 0, 0.02, 0.28, STOCK, true, { name: 'school', facade: { storeys: 2, bays: 8, sideBays: 0, top: 0.02 } }],
      ['door', 'school', 'front', 0, 'door'], ['door', 'school', 'front', 7, 'door'],
      ['cornice', 'school', 1, 'stone'], ['cornice', 'school', 2, 'stone'],
      ['box', 0.15, 0.17, 0.08, -0.77, 0.02, 0.57, 'stone'], ['box', 0.15, 0.17, 0.08, 0.77, 0.02, 0.57, 'stone'], // the two porches
      ['box', 0.17, 0.02, 0.1, -0.77, 0.19, 0.57, 'slate'], ['box', 0.17, 0.02, 0.1, 0.77, 0.19, 0.57, 'slate'],
      ['box', 0.13, 0.03, 0.012, -0.77, 0.215, 0.6, 'charcoal'], ['box', 0.09, 0.012, 0.014, -0.77, 0.224, 0.6, 'white'], // BOYS
      ['box', 0.13, 0.03, 0.012, 0.77, 0.215, 0.6, 'charcoal'], ['box', 0.1, 0.012, 0.014, 0.77, 0.224, 0.6, 'white'],   // GIRLS
      ['roof', 1.84, 0.2, 0.56, 0, 0.48, 0.28, 'slate'],
      ...[-0.6, 0, 0.6].map((x): Op => ['roof', 0.46, 0.25, 0.6, x, 0.48, 0.3, 'slate', true]),
      ['box', 0.12, 0.03, 0.012, 0, 0.57, 0.604, 'stone'],
      ...cupola(0, 0.68, 0.12, 1.1),
      ['chimneyStack', -0.3, 0.6, 0.25, 0.18, 0.03, 'brick'], ['chimneyStack', 0.3, 0.6, 0.25, 0.18, 0.03, 'brick'],
      // the hall behind, with its own gable
      ['box', 0.9, 0.36, 0.46, -0.45, 0.02, -0.4, STOCK_DK, true, { name: 'hall', facade: { storeys: 1, bays: 4, sideBays: 2 } }],
      ['roof', 0.96, 0.2, 0.52, -0.45, 0.38, -0.4, 'slate'],
      // playground: hopscotch, a climbing frame, railings and the old toilet block
      ...hopscotch(0.35, -0.5), ...hopscotch(0.62, -0.35), ...climbingFrame(0.7, -0.75),
      ['box', 0.18, 0.12, 0.14, 0.82, 0.026, -0.4, 'brick'], ['roof', 0.22, 0.05, 0.18, 0.82, 0.146, -0.4, 'slate'],
      ...fence(0, -0.95, 1.9, true, 'charcoal', 0.09), ...fence(-0.98, -0.3, 1.3, false, 'charcoal', 0.09), ...fence(0.98, -0.3, 1.3, false, 'charcoal', 0.09),
      ...fence(-0.57, 0.95, 0.76, true, 'charcoal', 0.09), ...fence(0.5, 0.95, 0.9, true, 'charcoal', 0.09),
      ['box', 0.06, 0.13, 0.06, -0.12, 0.02, 0.95, 'stone'], ['box', 0.06, 0.13, 0.06, -0.88, 0.02, 0.95, 'stone'],
      ...lamp(-0.1, 0.84, 0.2), ...lamp(-0.9, 0.84, 0.2),
      ...tree(0.7, 0.85, 1.0), ...tree(0.9, 0.8, 0.85), ...pine(-0.9, -0.78, 0.9),
    ] },
    { name: 'flat-roofed 1960s school with strip windows, a covered way, a mobile classroom and a playing field', height: 0.35, ops: [
      ground(2, 2, 'lawn'),
      patch(0.8, 0.5, 0.55, 0.62, ASPHALT), patch(1.0, 0.34, -0.45, 0.82, ASPHALT),
      // the front range: strip windows, a canopy over the door at bay 2
      ['box', 1.5, 0.2, 0.34, -0.15, 0.02, 0.4, 0xc9a889, 'office', { name: 'front', facade: { storeys: 1, bays: 9, sideBays: 0 } }],
      ['door', 'front', 'front', 2, 'boxBlue'], ['awning', 'front', 'front', 1, 3, 'boxOrange'],
      ['box', 1.58, 0.022, 0.4, -0.15, 0.22, 0.4, 'white'],
      // the classroom wing running back on the left, windows both sides
      ['box', 0.34, 0.2, 1.0, -0.75, 0.02, -0.38, 0xc9a889, 'office', { name: 'wing', facade: { storeys: 1, bays: 2, sideBays: 6 } }],
      ['box', 0.4, 0.022, 1.06, -0.75, 0.22, -0.38, 'white'],
      // the hall, a little taller, with a pitched clerestory roof
      ['box', 0.64, 0.26, 0.5, 0.0, 0.02, -0.3, 0xc9a889, true, { name: 'hall', facade: { storeys: 1, bays: 4, sideBays: 3, top: 0.03 } }],
      ['box', 0.7, 0.02, 0.56, 0, 0.28, -0.3, 'white'],
      // the mobile classroom
      ['box', 0.34, 0.15, 0.2, 0.62, 0.02, -0.7, 'green', 'office', { name: 'hut', facade: { storeys: 1, bays: 3, sideBays: 0 } }],
      ['box', 0.38, 0.015, 0.24, 0.62, 0.17, -0.7, 'white'], ['box', 0.12, 0.012, 0.1, 0.62, 0.02, -0.55, 'timber'],
      // the playground and the field
      ...hopscotch(0.4, 0.78), ...climbingFrame(0.7, 0.6, 0.026, 'boxBlue', 'red'),
      ['box', 0.9, 0.006, 0.55, 0.52, 0.02, -0.15, 'lawnDark'], ...pitchLines(0.9, 0.55, 0.52, -0.15, 0.026), ...goal(0.52, -0.43, 0.026), ...goal(0.52, 0.13, 0.026),
      ...carRow(-0.85, 0.82, 4, 0.2, false, 0.026, 1),
      ...lampRow(-0.8, 0.93, 0.8, 0.93, 3, 11), ...scatterTrees(-0.5, -0.88, 0.1, -0.84, 3, 5), ...scatterTrees(0.6, 0.84, 0.84, 0.88, 1, 9),
    ] },
  ],
});

// ================================================================= 103 secondary school

const BR50 = 0xa8553d; // 1950s London brick
const staffCar = (x: number, z: number, i: number): Op[] => car(x, z, (['white', 'silver', 'navy', 'red', 0x2f6a4f, 'charcoal', 0x8a2b3a] as const)[i % 7], false, 0.026);
/** a floodlit pitch cage: low rails round a w×d rectangle and a mast with a lamp bank at each corner (the lamps light at night) */
const floodlitCage = (x: number, z: number, w: number, d: number, mastH: number): Op[] => [
  ...fence(x, z - d / 2, w, true, 'charcoal', 0.1), ...fence(x, z + d / 2, w, true, 'charcoal', 0.1),
  ...fence(x - w / 2, z, d, false, 'charcoal', 0.1), ...fence(x + w / 2, z, d, false, 'charcoal', 0.1),
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([sx, sz]): Op[] => [
    ['cyl', 0.01, 0.018, mastH, x + (sx * w) / 2, 0.02, z + (sz * d) / 2, 'steel', 5],
    ['box', 0.15, 0.09, 0.04, x + (sx * w) / 2, 0.02 + mastH, z + (sz * d) / 2, 'marquee', 'venue'], ['box', 0.16, 0.015, 0.05, x + (sx * w) / 2, 0.02 + mastH + 0.09, z + (sz * d) / 2, 'charcoal'],
  ]),
];

export const secondary: KindDef = edu({
  id: 'secondary-school', name: 'secondary school', kindId: 103, tier: 3, footprint: { w: 3, h: 3, door: [1, 2] },
  tool: { id: 'secondary', key: '', label: 'Secondary school (3×3)', color: '#d9962f' },
  blurb: 'Three hundred places for ages eleven to sixteen and twenty-four staff: GCSEs, a sports hall and a floodlit pitch. Big enough to draw from a whole district, and it runs a school bus.',
  howTo: 'A 3×3 plot with the door in the middle of the frontage. Homes within twenty tiles can send pupils; give it a road the buses can use. Needs Secondary education.',
  occupation: staff('secondary teacher', [{ start: 8, hours: 8, weight: 0.65 }, { start: 8.5, hours: 8, weight: 0.35 }]),
  attrs: { stage: 3, pupilCapacity: 300, catchment: 20, ages: [11, 16], teachersShare: 0.6, title: 'secondary school' },
}, {
  capacity: 24, wage: 26, cost: 2000, upkeep: 60, parking: { surface: 14, underground: 24 },
  designs: [
    { name: '2000s academy with a curved glazed atrium, coloured render and a floodlit 3G pitch', height: 0.73, ops: [
      ground(3, 3, 'lawn'),
      patch(2.9, 0.55, 0, 1.2, PAVING), patch(0.9, 0.5, -0.95, 1.18, ASPHALT),
      // the teaching blocks either side of the atrium: three storeys of white render, two of yellow
      ['box', 1.0, 0.62, 0.55, -0.9, 0.02, 0.1, 'white', 'office', { name: 'west', facade: { storeys: 3, bays: 5, sideBays: 2, margin: 0.2 } }],
      ['box', 1.0, 0.025, 0.59, -0.9, 0.64, 0.1, 'dark'],
      ['box', 1.0, 0.44, 0.55, 0.9, 0.02, 0.1, 0xe6b734, 'office', { name: 'east', facade: { storeys: 2, bays: 5, sideBays: 2, margin: 0.2 } }],
      ['box', 1.0, 0.025, 0.59, 0.9, 0.46, 0.1, 'dark'],
      ['box', 0.2, 0.7, 0.24, -1.3, 0.02, 0.3, 'boxOrange'], ['box', 0.2, 0.56, 0.24, 1.3, 0.02, 0.3, 'boxBlue'],
      // the curved glazed atrium, lying on the ground between them, and the canopy at the door
      ['lathe', 0, 0.34, 0.0, 'glass', [0.32, 0, 0.32, 0.95], { seg: 14, axis: 'z', win: 'office', stripe: 'steel', every: 2, width: 1 }],
      ...[[-0.4, 0.98], [0.4, 0.98], [-0.4, 1.22], [0.4, 1.22]].map(([x, z]): Op => ['cyl', 0.008, 0.008, 0.19, x, 0.02, z, 'steel', 4]),
      ['box', 0.9, 0.014, 0.3, 0, 0.21, 1.1, 'boxOrange'],
      // the hall and the sports hall behind
      ['box', 0.78, 0.5, 0.6, 0, 0.02, -0.38, 'white', 'office', { name: 'hall', facade: { storeys: 2, bays: 4, sideBays: 0 } }],
      ['box', 0.84, 0.025, 0.66, 0, 0.52, -0.38, 'dark'], ...plant(-0.2, 0.545, -0.5, 3),
      ['box', 1.2, 0.4, 0.7, -0.5, 0.02, -1.1, 'silver'], ['box', 1.22, 0.06, 0.72, -0.5, 0.3, -1.1, 'boxBlue'], ['roof', 1.26, 0.1, 0.76, -0.5, 0.42, -1.1, 'roofGrey'],
      ['box', 0.12, 0.17, 0.02, -0.9, 0.02, -0.74, 'door'],
      ...plant(-1.1, 0.665, 0.0, 2),
      // the 3G pitch: a caged green rectangle with markings, goals and four floodlight masts
      ['box', 0.7, 0.008, 0.85, 1.0, 0.02, -0.95, 'lawnDark'], ...pitchLines(0.7, 0.85, 1.0, -0.95, 0.028), ...goal(1.0, -1.32, 0.028), ...goal(1.0, -0.58, 0.028),
      ...floodlitCage(1.0, -0.95, 0.76, 0.93, 0.5),
      // the forecourt: cars, bike shelter, flags, benches and trees, none of them on a grid
      ...[0, 1, 2, 3].flatMap((i) => staffCar(-1.3 + i * 0.2 + jit(i + 20, 0.012), 1.2 + jit(i + 30, 0.01), i)),
      ...bikeShed(1.05, 1.22, 0.5, 0.026), ...flags(0.5, 1.4, 3, 0.1, ['navy', 'white', 'red'], 0.02),
      ...benchRow(0.5, 0.95, 1.4, 0.95, 2, 31, 0.026), ...lampRow(-1.4, 0.93, 1.4, 0.93, 5, 43), ...scatterTrees(1.15, 0.45, 1.4, 0.7, 2, 17), ...scatterTrees(-1.35, 0.8, -0.45, 0.8, 1, 51),
      ...scatterTrees(-1.35, -0.45, -0.45, -0.3, 2, 61), ...scatterTrees(0.55, -0.4, 1.35, -0.3, 2, 71),
    ] },
    { name: '1950s brick secondary modern with a four-storey teaching block, a stair tower, a boiler-house chimney and playing fields', height: 1.09, ops: [
      ground(3, 3, 'lawn'),
      patch(2.9, 0.4, 0, 1.28, PAVING),
      // the teaching block: four storeys of ribbon windows, the stair tower at the left end, the entrance at the middle bay
      ['box', 1.8, 0.92, 0.44, 0, 0.02, 0.85, BR50, 'office', { name: 'block', facade: { storeys: 4, bays: 9, sideBays: 0, top: 0.03 } }],
      ['door', 'block', 'front', 4, 'door'], ['porch', 'block', 'front', 3, 5, 'stone', 'white'],
      ['cornice', 'block', 1, 'stone'],
      ['box', 1.86, 0.03, 0.5, 0, 0.94, 0.85, 'stone'],
      ['box', 0.22, 1.0, 0.3, -1.01, 0.02, 0.85, 'stone', 'civic', { name: 'stair', facade: { storeys: 4, bays: 1, sideBays: 0, margin: 0.03 } }],
      ['box', 0.26, 0.03, 0.34, -1.01, 1.02, 0.85, 'dark'],
      ['cyl', 0.09, 0.09, 0.12, 0.45, 0.97, 0.8, 'steel', 8], ...plant(-0.5, 0.97, 0.8, 3),
      // the assembly hall to the right, in yellow stock brick with tall windows
      ['box', 0.44, 0.34, 0.7, 1.22, 0.02, 0.7, STOCK, true, { name: 'hall', facade: { storeys: 1, bays: 2, sideBays: 0, top: 0.02 } }],
      ['roof', 0.5, 0.14, 0.76, 1.22, 0.36, 0.7, 'roofGrey', true],
      // the gymnasium and the boiler house with its chimney
      ['box', 0.5, 0.34, 0.8, -1.2, 0.02, -0.1, 'stone'], ['box', 0.54, 0.05, 0.84, -1.2, 0.36, -0.1, 'dark'], ['box', 0.52, 0.03, 0.82, -1.2, 0.26, -0.1, 'boxBlue'],
      ['box', 0.3, 0.26, 0.3, -1.25, 0.02, 0.42, 'brick'], ['chimneyStack', -1.25, 0.28, 0.42, 0.62, 0.04, 'brick'],
      // the fields behind: a running track round a pitch, goals, a netball court
      ['box', 1.9, 0.006, 1.15, -0.2, 0.02, -0.82, 'court'], ['box', 1.5, 0.008, 0.8, -0.2, 0.02, -0.82, 'lawnDark'],
      ...pitchLines(1.5, 0.8, -0.2, -0.82, 0.028), ...goal(-0.95, -0.82, 0.028, true), ...goal(0.55, -0.82, 0.028, true),
      ['box', 0.55, 0.006, 0.8, 1.1, 0.02, -0.55, 'court'], ...fence(1.1, -0.95, 0.6, true, 'charcoal', 0.1), ...fence(1.1, -0.15, 0.6, true, 'charcoal', 0.1), ...fence(0.8, -0.55, 0.8, false, 'charcoal', 0.1), ...fence(1.4, -0.55, 0.8, false, 'charcoal', 0.1),
      ['box', 0.4, 0.004, 0.006, 1.1, 0.026, -0.55, 'white'],
      // the street side: railings with a gate, a bike shelter, lamps, a minibus and trees
      ...fence(-0.775, 1.46, 1.35, true, 'charcoal', 0.1), ...fence(0.85, 1.46, 1.1, true, 'charcoal', 0.1), ['box', 0.07, 0.15, 0.07, -0.1, 0.02, 1.45, 'stone'], ['box', 0.07, 0.15, 0.07, 0.3, 0.02, 1.45, 'stone'],
      ...bikeShed(-1.0, 1.2, 0.5, 0.026, 'charcoal'),
      ...van(0.9, 1.2, 'yellow', 'charcoal', true, 0.026),
      ...lampRow(-1.3, 1.3, 1.3, 1.3, 4, 7, 0.19), ...scatterTrees(-1.35, -1.35, 1.35, -1.3, 5, 3), ...scatterTrees(-0.5, 1.3, -0.2, 1.32, 1, 23),
    ] },
  ],
});

// ================================================================= 104 sixth-form college

const RED = 0xa84a3a; // Edwardian red brick

export const sixthForm: KindDef = edu({
  id: 'sixth-form', name: 'sixth-form college', kindId: 104, tier: 4, footprint: { w: 2, h: 2, door: [0, 1] },
  tool: { id: 'sixthform', key: '', label: 'Sixth-form college (2×2)', color: '#c4802a' },
  blurb: 'A hundred and twenty places for sixteen- to eighteen-year-olds studying for A-levels: seven tutors in ten are graduates. Leavers go on to university or straight into skilled jobs.',
  howTo: 'A 2×2 plot beside a road, door on the frontage. Students come from homes within twenty-four tiles and travel as adults, so a bus stop or station nearby helps. Needs Further education.',
  occupation: staff('sixth-form tutor', [{ start: 8.5, hours: 8, weight: 0.6 }, { start: 9, hours: 8, weight: 0.4 }]),
  attrs: { stage: 4, pupilCapacity: 120, catchment: 24, ages: [16, 18], teachersShare: 0.7, title: 'sixth-form college' },
}, {
  capacity: 10, wage: 26, cost: 1400, upkeep: 40, parking: { surface: 8, underground: 12 },
  designs: [
    { name: 'Edwardian grammar school in red brick with a clock gable, a cupola and a new glass wing', height: 0.93, ops: [
      ground(2, 2, 'lawn'),
      patch(1.9, 0.42, 0, 0.74, PAVING),
      // the old building: two storeys, five bays, bays at the ends, a stone porch under a clock gable
      ['box', 1.0, 0.5, 0.5, -0.45, 0.02, 0.2, RED, true, { name: 'main', facade: { storeys: 2, bays: 5, sideBays: 2, margin: 0.06, top: 0.02 } }],
      ['door', 'main', 'front', 2, 'door'], ['porch', 'main', 'front', 2, 2, 'stone', 'white'],
      ['baywindow', 'main', 'front', 0, 0, 'slate'], ['baywindow', 'main', 'front', 0, 4, 'slate'],
      ['cornice', 'main', 1, 'stone'], ['cornice', 'main', 2, 'stone'],
      ['roof', 1.04, 0.2, 0.54, -0.45, 0.52, 0.2, 'slate', false, { name: 'mainroof' }],
      ['roof', 0.34, 0.24, 0.56, -0.45, 0.52, 0.22, 'slate', true],
      ...clockFace(-0.45, 0.6, 0.5, 0.06),
      ['dormer', 'mainroof', 2, 'white'],
      ...cupola(-0.82, 0.72, 0.2, 0.9, 'green'),
      ['chimneyStack', -0.12, 0.66, 0.2, 0.2, 0.03, 'brick'],
      // the new wing: curtain-walled glass with a flat steel roof
      ['box', 0.78, 0.46, 0.4, 0.52, 0.02, 0.25, 'glass', 'office', { name: 'wing', facade: { storeys: 2, bays: 4, sideBays: 2 } }],
      ['box', 0.84, 0.025, 0.46, 0.52, 0.48, 0.25, 'steel'],
      // behind: a netball court in a cage, a bike shelter, planting
      ['box', 0.6, 0.006, 0.46, 0.45, 0.02, -0.6, 'court'], ['box', 0.4, 0.004, 0.006, 0.45, 0.026, -0.6, 'white'], ['box', 0.006, 0.004, 0.4, 0.45, 0.026, -0.6, 'white'],
      ...fence(0.45, -0.85, 0.66, true, 'charcoal', 0.1), ...fence(0.45, -0.35, 0.66, true, 'charcoal', 0.1), ...fence(0.12, -0.6, 0.5, false, 'charcoal', 0.1), ...fence(0.78, -0.6, 0.5, false, 'charcoal', 0.1),
      ...bikeShed(-0.55, -0.6, 0.5, 0.02, 'slate'),
      // the street: railings, a gate at the door tile, lamps and trees
      ...fence(-0.8, 0.96, 0.3, true, 'charcoal', 0.09), ...fence(0.3, 0.96, 1.3, true, 'charcoal', 0.09), ['box', 0.05, 0.12, 0.05, -0.62, 0.02, 0.96, 'stone'], ['box', 0.05, 0.12, 0.05, -0.38, 0.02, 0.96, 'stone'],
      ...lampRow(-0.9, 0.82, 0.9, 0.82, 3, 13, 0.19), ...scatterTrees(0.55, 0.62, 0.9, 0.78, 2, 29), ...scatterTrees(-0.85, -0.3, -0.75, -0.25, 1, 33), ...scatterTrees(-0.3, -0.9, 0.0, -0.8, 2, 47),
    ] },
    { name: 'modern three-storey sixth-form block with a café front, outdoor tables and a glass stair core', height: 0.85, ops: [
      ground(2, 2, 'lawn'),
      patch(1.9, 0.56, 0, 0.7, PAVING),
      // the block: brick above a glazed café and entrance floor
      ['box', 1.4, 0.66, 0.5, 0, 0.02, -0.25, BR50, 'office', { name: 'block', facade: { storeys: 3, bays: 7, sideBays: 0, ground: 'shopfront', top: 0.03 } }],
      ['door', 'block', 'front', 1, 'boxOrange'], ['awning', 'block', 'front', 3, 6, 'awning'],
      ['cornice', 'block', 1, 'white'],
      ['box', 1.4, 0.03, 0.56, 0, 0.68, -0.25, 'dark'],
      ...repeat(4, (i): Op => ['roof', 0.26, 0.05, 0.3, -0.45 + i * 0.3, 0.71, -0.2, 'navy']),
      ...plant(0.3, 0.71, -0.4, 2),
      ['box', 0.22, 0.8, 0.22, -0.82, 0.02, -0.25, 'glass', 'office', { name: 'core', facade: { storeys: 4, bays: 1, sideBays: 0 } }],
      ['box', 0.26, 0.03, 0.26, -0.82, 0.82, -0.25, 'steel'],
      // the timber-clad studio behind
      ['box', 0.7, 0.26, 0.36, 0.3, 0.02, -0.78, 'timber', 'office', { name: 'studio', facade: { storeys: 1, bays: 3, sideBays: 0 } }],
      ['box', 0.76, 0.02, 0.42, 0.3, 0.28, -0.78, 'dark'],
      // café tables with umbrellas, placed by hand rather than in a row
      ...[[0.12, 0.2], [0.3, 0.34], [0.5, 0.18], [0.62, 0.36], [0.4, 0.5]].flatMap(([x, z], i): Op[] => {
        const c = (['awning', 'boxBlue', 'yellow', 'boxGreen', 'awning'] as const)[i], dx = jit(i + 90, 0.02), dz = jit(i + 95, 0.02);
        return [
          ['cyl', 0.005, 0.005, 0.045, x + dx, 0.026, z + dz, 'steel', 4], ['cyl', 0.028, 0.028, 0.004, x + dx, 0.071, z + dz, 'white', 8],
          ['cone', 0.06, 0.03, x + dx, 0.075, z + dz, c, 8],
          ['box', 0.018, 0.02, 0.018, x + dx - 0.04, 0.026, z + dz, 'charcoal'], ['box', 0.018, 0.02, 0.018, x + dx + 0.04, 0.026, z + dz, 'charcoal'],
        ];
      }),
      ...bikeShed(-0.55, 0.45, 0.5, 0.026, 'steel'), ...signBoard(-0.35, 0.78, 0.5, 'navy', 'white', 0.026, 0.2),
      ...lampRow(-0.85, 0.9, 0.85, 0.9, 3, 19, 0.19), ...scatterTrees(0.7, 0.8, 0.9, 0.9, 1, 61), ...scatterTrees(-0.9, -0.85, -0.3, -0.7, 2, 67), ...scatterTrees(0.85, -0.2, 0.9, 0.1, 1, 71),
      ...car(-0.2, 0.73, 'silver', false, 0.026), ...car(-0.05, 0.75, 'navy', false, 0.026),
    ] },
  ],
});

// ================================================================= 105 further-education college

const CONC = 0xb7b4ab; // board-marked concrete

export const feCollege: KindDef = edu({
  id: 'fe-college', name: 'further-education college', kindId: 105, tier: 5, footprint: { w: 3, h: 2, door: [1, 1] },
  tool: { id: 'fecollege', key: '', label: 'FE college (3×2)', color: '#b87a2e' },
  blurb: 'A college for trades, A-levels and adult courses: a hundred and sixty day places and sixty evening ones, with workshops for builders, mechanics and electricians. Where the unemployed retrain.',
  howTo: 'A 3×2 plot beside a road, door in the middle of the frontage. Students from homes within thirty tiles come by bus or car. Needs Further education.',
  occupation: staff('FE lecturer', [{ start: 8, hours: 8, weight: 0.55 }, { start: 12, hours: 8, weight: 0.45 }], [[1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 0, 0, 1]]),
  attrs: { stage: 5, pupilCapacity: 160, eveningPlaces: 60, catchment: 30, ages: [16, 99], teachersShare: 0.5, title: 'further-education college' },
}, {
  capacity: 18, wage: 26, cost: 2400, upkeep: 70, parking: { surface: 14, underground: 20 },
  designs: [
    { name: '1970s concrete tower on a podium with workshop sheds, roller doors, a motor-vehicle bay and a bricklaying yard', height: 1.55, ops: [
      ground(3, 2, 'gravel'),
      patch(1.1, 0.46, 0.95, 0.76, ASPHALT), patch(1.1, 0.3, -0.55, 0.85, PAVING),
      // the podium and the tower
      ['box', 1.5, 0.3, 0.4, -0.45, 0.02, 0.5, CONC, 'office', { name: 'podium', facade: { storeys: 1, bays: 8, sideBays: 0, top: 0.03 } }],
      ['door', 'podium', 'front', 6, 'boxBlue'], ['porch', 'podium', 'front', 6, 6, 'boxBlue', 'steel'],
      ['box', 1.56, 0.03, 0.46, -0.45, 0.32, 0.5, 'dark'],
      ['box', 0.6, 1.25, 0.5, -0.9, 0.02, -0.1, CONC, 'office', { name: 'tower', facade: { storeys: 6, bays: 3, sideBays: 2, top: 0.03 } }],
      ['box', 0.66, 0.03, 0.56, -0.9, 1.27, -0.1, 'dark'], ['box', 0.3, 0.12, 0.3, -0.85, 1.3, -0.1, 'plant'], ...mast(-1.05, 1.3, -0.2, 0.22),
      // the workshops: a long shed with roller doors and a sawtooth roof
      ['box', 1.0, 0.28, 0.8, 0.95, 0.02, 0.1, 'brick', 'factory', { name: 'shed', facade: { storeys: 1, bays: 4, sideBays: 0, ground: 'garage' } }],
      ['door', 'shed', 'front', 0, 'door'],
      ...repeat(4, (i): Op => ['roof', 0.26, 0.12, 0.84, 0.51 + i * 0.285, 0.3, 0.1, 'corrugated', true]),
      // the motor-vehicle bay: an open canopy over two cars on lifts
      ...[[-0.5, -0.45], [0.3, -0.45], [-0.5, -0.9], [0.3, -0.9]].map(([x, z]): Op => ['cyl', 0.01, 0.01, 0.2, x, 0.02, z, 'steel', 4]),
      ['box', 0.9, 0.012, 0.58, -0.1, 0.22, -0.68, 'corrugated'],
      ...car(-0.3, -0.68, 'red', false, 0.02), ['box', 0.07, 0.01, 0.07, -0.3, 0.065, -0.58, 'charcoal'], ...car(0.1, -0.68, 'boxBlue', false, 0.02), ['box', 0.05, 0.03, 0.05, 0.1, 0.02, -0.8, 'steel'],
      // the bricklaying yard: stacks of bricks, a half-built practice wall, pallets and a mixer
      ['box', 0.95, 0.006, 0.55, 0.95, 0.02, -0.66, 'sand'],
      ...repeat(5, (i): Op => ['box', 0.09, 0.05 + 0.01 * (i % 3), 0.05, 0.6 + jit(i + 120, 0.04) + i * 0.1, 0.026, -0.45 + jit(i + 125, 0.04), 'brick']),
      ...repeat(4, (i): Op => ['box', 0.28 - i * 0.02, 0.02, 0.025, 1.05, 0.026 + i * 0.02, -0.82, 'brick']),
      ['box', 0.1, 0.015, 0.1, 0.78, 0.026, -0.84, 'timber'], ['box', 0.1, 0.015, 0.1, 0.9, 0.026, -0.84, 'timber'],
      ['cyl', 0.035, 0.035, 0.05, 1.3, 0.026, -0.5, 'boxOrange', 8], ['cone', 0.04, 0.03, 1.3, 0.076, -0.5, 'boxOrange', 8],
      // the street side: a van, lamps, trees
      ...van(0.7, 0.8, 'white', 'boxBlue', true, 0.026), ...van(1.0, 0.68, 'boxOrange', 'charcoal', true, 0.026),
      ...fence(-0.7, 0.97, 1.4, true, 'charcoal', 0.09), ...fence(0.75, 0.97, 1.4, true, 'charcoal', 0.09),
      ...lampRow(-1.35, 0.9, 1.35, 0.9, 4, 17, 0.19), ...scatterTrees(-1.4, -0.9, -1.1, -0.5, 2, 37),
    ] },
    { name: 'new glazed campus with a curtain-walled atrium, a drum entrance and an apprenticeship hall with roller doors', height: 0.55, ops: [
      ground(3, 2, 'lawn'),
      patch(2.9, 0.5, 0, 0.72, PAVING),
      // the atrium block: glass over two floors, a steel roof
      ['box', 1.2, 0.5, 0.55, -0.7, 0.02, 0.2, 'glass', 'office', { name: 'atrium', facade: { storeys: 2, bays: 6, sideBays: 0 } }],
      ['box', 1.26, 0.02, 0.61, -0.7, 0.52, 0.2, 'steel'], ['box', 0.8, 0.012, 0.05, -0.7, 0.54, 0.2, 'charcoal'],
      ['lathe', 0.16, 0.02, 0.38, 'glass', [0.22, 0, 0.22, 0.5, 0, 0.52], { seg: 14, win: 'office', stripe: 'steel', every: 2, width: 1 }],
      ['box', 0.46, 0.02, 0.46, 0.16, 0.52, 0.38, 'steel'], ['box', 0.12, 0.15, 0.02, 0.16, 0.02, 0.595, 'door'],
      // the apprenticeship hall: a tall shed with roller doors, a band of orange and a mono-pitch roof
      ['box', 1.3, 0.34, 0.8, 0.8, 0.02, -0.05, 'silver', 'factory', { name: 'hall', facade: { storeys: 1, bays: 4, sideBays: 0, ground: 'garage', top: 0.08 } }],
      ['door', 'hall', 'front', 0, 'door'],
      ['box', 1.32, 0.05, 0.82, 0.8, 0.31, -0.05, 'boxOrange'],
      ['roof', 1.36, 0.1, 0.86, 0.8, 0.36, -0.05, 'roofGrey', true],
      ...repeat(4, (i): Op => ['box', 0.28, 0.012, 0.5, 0.38 + i * 0.3, 0.46, -0.05, 'navy']),
      // vans and materials in the yard, benches and cycle stands on the plaza
      ['box', 1.25, 0.006, 0.4, 0.8, 0.02, 0.62, ASPHALT],
      ...van(0.5, 0.62, 'white', 'boxOrange', true, 0.026), ...van(0.95, 0.6, 'boxBlue', 'white', true, 0.026),
      ...repeat(4, (i): Op => ['box', 0.07, 0.04 + 0.01 * (i % 2), 0.05, 1.2 + jit(i + 140, 0.04), 0.026, 0.55 + jit(i + 145, 0.04) + (i % 2) * 0.09, 'brick']),
      ...bikeShed(-1.0, 0.82, 0.55, 0.026, 'boxBlue'), ...benchRow(-0.55, 0.78, -0.1, 0.78, 2, 53, 0.026),
      ['cyl', 0.1, 0.1, 0.006, -0.3, 0.02, -0.65, 'pond', 12], ['cyl', 0.13, 0.13, 0.004, -0.3, 0.02, -0.65, 'stone', 12], // a pond in the planting
      ...lampRow(-1.4, 0.95, 1.4, 0.95, 5, 21, 0.19), ...scatterTrees(-1.35, -0.8, -0.2, -0.3, 4, 77), ...scatterTrees(0.2, -0.86, 1.2, -0.82, 2, 83), ...scatterTrees(1.2, 0.84, 1.3, 0.86, 1, 89),
    ] },
  ],
});

// ================================================================= 106 university campus

const TERRACOTTA = 0xc9845a; // terracotta dressings on the red brick
const CONC2 = 0xc4c1b8;      // pale board-marked concrete
/** lake discs (x, z, r) with a stone rim */
const lakeDiscs = (parts: [number, number, number][]): Op[] => [
  ...parts.map(([x, z, r]): Op => ['cyl', r + 0.04, r + 0.05, 0.016, x, 0.02, z, 'stone', 18]),
  ...parts.map(([x, z, r]): Op => ['cyl', r, r, 0.02, x, 0.02, z, 'pond', 18]),
];

export const university: KindDef = edu({
  id: 'university', name: 'university campus', kindId: 106, tier: 6, footprint: { w: 6, h: 6, door: [3, 5] },
  tool: { id: 'university', key: '', label: 'University campus (6×6)', color: '#a8671f' },
  blurb: 'A whole campus on thirty-six tiles: lecture halls, a library and a quad, with six hundred places and sixty staff. It takes your own school leavers, draws students from far away, and turns out the graduates that fill offices and labs.',
  howTo: 'A 6×6 plot with the gate on the frontage, right of the middle. Students come from the whole city, so put it near a station or bus stop, and build halls of residence beside it. Needs Higher education.',
  occupation: staff('lecturer', [{ start: 9, hours: 8, weight: 0.55 }, { start: 10, hours: 8, weight: 0.3 }, { start: 13, hours: 8, weight: 0.15 }], [[1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 0, 0, 1]]),
  attrs: { stage: 6, pupilCapacity: 600, catchment: 0, ages: [18, 99], teachersShare: 0.6, postgradShare: 0.4, title: 'university campus' },
}, {
  capacity: 60, wage: 28, cost: 7000, upkeep: 180, parking: { surface: 60, underground: 120 },
  designs: [
    { name: 'redbrick Victorian Gothic quad with a clock tower, gabled ranges, a domed library and lamp-lit paths', height: 2.36, ops: [
      ground(6, 6, 'lawn'),
      patch(0.22, 5.0, 0.55, 0.45, 'gravel'), patch(4.3, 0.18, 0, 0.0, 'gravel'), patch(1.7, 0.6, 0.55, 2.55, PAVING),
      // the north range, split round the clock tower: three storeys of red brick, bays, cornices and a slate roof
      ['box', 3.15, 0.68, 0.7, -1.375, 0.02, -2.5, RED, true, { name: 'nl', facade: { storeys: 3, bays: 14, sideBays: 0, margin: 0.1, top: 0.03 } }],
      ['box', 2.05, 0.68, 0.7, 1.925, 0.02, -2.5, RED, true, { name: 'nr', facade: { storeys: 3, bays: 9, sideBays: 0, margin: 0.1, top: 0.03 } }],
      ['cornice', 'nl', 1, TERRACOTTA], ['cornice', 'nl', 2, TERRACOTTA], ['cornice', 'nl', 3, 'stone'], ['cornice', 'nr', 1, TERRACOTTA], ['cornice', 'nr', 2, TERRACOTTA], ['cornice', 'nr', 3, 'stone'],
      ['baywindow', 'nl', 'front', 0, 3, 'slate'], ['baywindow', 'nl', 'front', 0, 10, 'slate'], ['baywindow', 'nr', 'front', 0, 2, 'slate'], ['baywindow', 'nr', 'front', 0, 6, 'slate'],
      ['roof', 3.2, 0.28, 0.78, -1.375, 0.7, -2.5, 'slate', false, { name: 'rl' }], ['roof', 2.1, 0.28, 0.78, 1.925, 0.7, -2.5, 'slate', false, { name: 'rr' }],
      ...[-2.3, -0.75, 1.5, 2.45].map((x): Op => ['roof', 0.5, 0.3, 0.8, x, 0.7, -2.46, 'slate', true]),
      ...[-1.5, 0.05, 1.2, 2.7].map((x, i): Op => ['chimneyStack', x, 0.82, -2.7, 0.26 + 0.04 * (i % 2), 0.04, 'brick']),
      // the clock tower: six storeys, a plain band for the clock, a stone belfry and a slate spire with pinnacles
      ['box', 0.7, 1.5, 0.9, 0.55, 0.02, -2.4, RED, true, { name: 'tower', facade: { storeys: 5, bays: 3, sideBays: 0, margin: 0.05, top: 0.35 } }],
      ['cornice', 'tower', 2, TERRACOTTA], ['cornice', 'tower', 4, TERRACOTTA],
      ...clockFace(0.55, 1.34, -1.95, 0.11),
      ['box', 0.76, 0.05, 0.96, 0.55, 1.52, -2.4, 'stone'],
      ['taper', 0.7, 0.9, 0, 0, 0.7, 0.55, 1.57, -2.4, 'slate'],
      ...[[-0.3, -0.4], [0.3, -0.4], [-0.3, 0.4], [0.3, 0.4]].map(([dx, dz]): Op => ['cone', 0.045, 0.2, 0.55 + dx, 1.57, -2.4 + dz, 'stone', 6]),
      ['cyl', 0.006, 0.006, 0.1, 0.55, 2.26, -2.4, 'gold', 4],
      // the west range: a long two-storey wing with its ridge along z, dormers over the quad
      ['box', 0.7, 0.52, 3.9, -2.6, 0.02, -0.05, RED, true, { name: 'wr', facade: { storeys: 2, bays: 2, sideBays: 16, margin: 0.08, top: 0.03 } }],
      ['cornice', 'wr', 1, TERRACOTTA], ['cornice', 'wr', 2, 'stone'],
      ['roof', 0.76, 0.22, 3.96, -2.6, 0.54, -0.05, 'slate', true, { name: 'wrr' }], ['dormer', 'wrr', 6, 'white'],
      ...[-1.1, 0.5].map((z, i): Op => ['chimneyStack', -2.75, 0.62, z, 0.22, 0.035, i ? 'brick' : 'chimney']),
      // the great hall on the east: one tall storey, a steep roof and a spirelet
      ['box', 0.7, 0.46, 2.4, 2.6, 0.02, -0.7, RED, true, { name: 'hall', facade: { storeys: 1, bays: 2, sideBays: 9, margin: 0.08, top: 0.03 } }],
      ['cornice', 'hall', 1, 'stone'],
      ['roof', 0.78, 0.3, 2.46, 2.6, 0.48, -0.7, 'slate', true],
      ['cyl', 0.05, 0.05, 0.06, 2.6, 0.78, -0.7, 'stone', 6], ['cone', 0.06, 0.4, 2.6, 0.84, -0.7, 'slate', 6],
      // the domed library at the south-east corner of the quad
      ['lathe', 2.4, 0.02, 1.35, 'stone', [0.5, 0, 0.5, 0.5], { seg: 16, win: 'civic' }],
      ['cyl', 0.53, 0.53, 0.03, 2.4, 0.52, 1.35, 'white', 16],
      ['lathe', 2.4, 0.55, 1.35, 0x6fae98, [0.5, 0, 0.48, 0.06, 0.42, 0.14, 0.32, 0.22, 0.2, 0.28, 0.08, 0.31, 0, 0.32], { seg: 16 }],
      ['cyl', 0.05, 0.05, 0.06, 2.4, 0.87, 1.35, 'stone', 8], ['cone', 0.06, 0.08, 2.4, 0.93, 1.35, 0x6fae98, 8], ['cyl', 0.005, 0.005, 0.07, 2.4, 1.01, 1.35, 'gold', 4],
      ['box', 0.3, 0.2, 0.12, 1.85, 0.02, 1.35, 'stone', 'civic', { name: 'libporch', facade: { storeys: 1, bays: 1, sideBays: 0 } }], ['door', 'libporch', 'front', 0, 'door'],
      // two lodges at the gate, the gate piers and railings along the street
      ['box', 0.5, 0.28, 0.4, -0.45, 0.02, 2.6, RED, true, { name: 'lodgel', facade: { storeys: 1, bays: 2, sideBays: 0, margin: 0.05 } }], ['roof', 0.56, 0.18, 0.46, -0.45, 0.3, 2.6, 'slate'],
      ['box', 0.5, 0.28, 0.4, 1.55, 0.02, 2.6, RED, true, { name: 'lodger', facade: { storeys: 1, bays: 2, sideBays: 0, margin: 0.05 } }], ['roof', 0.56, 0.18, 0.46, 1.55, 0.3, 2.6, 'slate'],
      ['box', 0.12, 0.34, 0.12, 0.05, 0.02, 2.9, 'stone'], ['box', 0.12, 0.34, 0.12, 1.05, 0.02, 2.9, 'stone'], ['box', 0.14, 0.03, 0.14, 0.05, 0.36, 2.9, 'gold'], ['box', 0.14, 0.03, 0.14, 1.05, 0.36, 2.9, 'gold'],
      ...fence(-1.5, 2.9, 2.8, true, 'charcoal', 0.14), ...fence(2.0, 2.9, 1.8, true, 'charcoal', 0.14),
      // the quad: a fountain at the crossing, lamps along the paths, benches and trees at hashed spots
      ['cyl', 0.24, 0.26, 0.05, 0.55, 0.02, 0.0, 'stone', 14], ['cyl', 0.19, 0.19, 0.056, 0.55, 0.02, 0.0, 'pond', 14], ['cone', 0.02, 0.14, 0.55, 0.07, 0.0, 0xcfe8ff, 6],
      ...lampRow(0.3, 2.3, 0.3, -1.8, 6, 101, 0.17), ...lampRow(0.8, 2.3, 0.8, -1.8, 6, 107, 0.17), ...lampRow(-2.1, 0.0, 2.0, 0.0, 6, 113, 0.17),
      ...benchRow(-2.0, 0.22, 2.0, 0.22, 4, 119), ...benchRow(-2.0, -0.22, 0.0, -0.22, 2, 127),
      ...scatterTrees(-2.0, -1.7, -0.7, -0.4, 3, 131), ...scatterTrees(-2.0, 0.6, -0.8, 1.6, 4, 137), ...scatterTrees(1.1, 0.5, 1.9, 1.0, 2, 139), ...scatterTrees(-1.8, 2.2, -1.0, 2.7, 2, 149),
      ...bikeShed(-1.6, 2.3, 0.7, 0.02, 'slate'),
    ] },
    { name: 'plate-glass 1960s campus of concrete slabs on a podium with walkways, a lecture drum and a lake with a causeway', height: 2.11, ops: [
      ground(6, 6, 'lawn'),
      patch(5.8, 2.8, 0, 1.5, PAVING),
      // the lake in front of the podium, and the stone causeway to the gate at the door tile
      ...lakeDiscs([[-1.6, 1.8, 0.8], [-0.4, 2.0, 0.9], [1.5, 1.8, 0.85], [-2.2, 2.3, 0.45], [2.3, 2.2, 0.4]]),
      ['box', 0.6, 0.03, 1.3, 0.5, 0.02, 2.2, 'stone'], ['box', 0.04, 0.05, 1.3, 0.2, 0.05, 2.2, 'dark'], ['box', 0.04, 0.05, 1.3, 0.8, 0.05, 2.2, 'dark'],
      // the podium and its steps
      ['box', 5.0, 0.12, 2.8, 0, 0.02, -1.3, 'stone'],
      ['box', 1.2, 0.08, 0.14, 0.5, 0.02, 0.17, 'stone'], ['box', 1.2, 0.05, 0.14, 0.5, 0.02, 0.31, 'stone'],
      // the slab tower, the long teaching slab and the second tower: ribbon windows, blind ends
      ['box', 0.8, 1.6, 1.5, -1.9, 0.14, -1.8, CONC2, 'office', { name: 'tall', facade: { storeys: 8, bays: 3, sideBays: 0, top: 0.04 } }],
      ['box', 0.86, 0.04, 1.56, -1.9, 1.74, -1.8, 'dark'], ...plant(-2.1, 1.78, -1.8, 2), ...mast(-1.7, 1.78, -1.4, 0.3),
      ['box', 2.0, 0.78, 0.8, 0.1, 0.14, -2.2, CONC2, 'office', { name: 'mid', facade: { storeys: 4, bays: 10, sideBays: 0, top: 0.03 } }],
      ['box', 2.06, 0.04, 0.86, 0.1, 0.92, -2.2, 'dark'], ...plant(0.2, 0.96, -2.3, 3),
      ['box', 0.7, 1.2, 0.7, 1.8, 0.14, -1.5, CONC2, 'office', { name: 'second', facade: { storeys: 6, bays: 3, sideBays: 0, top: 0.04 } }],
      ['box', 0.76, 0.04, 0.76, 1.8, 1.34, -1.5, 'dark'],
      // the glass library with a flat roof, and the lecture drum
      ['box', 1.6, 0.5, 0.9, -0.4, 0.14, -0.5, 'glass', 'office', { name: 'lib', facade: { storeys: 2, bays: 8, sideBays: 0 } }],
      ['box', 1.7, 0.04, 1.0, -0.4, 0.64, -0.5, 'stone'],
      ['lathe', 1.65, 0.14, -0.4, CONC2, [0.5, 0, 0.5, 0.4], { seg: 18, win: 'office' }], ['cyl', 0.56, 0.56, 0.04, 1.65, 0.54, -0.4, 'dark', 18],
      // walkways at the second floor between the slabs (the ends are blank, so nothing covers a window)
      ['box', 0.6, 0.05, 0.16, -1.2, 0.5, -2.3, 'stone'], ['box', 0.44, 0.05, 0.16, 1.32, 0.5, -1.65, 'stone'],
      // the sculpture, lamps, benches and trees at hashed spots
      ['taper', 0.16, 0.16, 0.04, 0.04, 0.5, -0.8, 0.02, 0.6, 'rust'], ['taper', 0.12, 0.12, 0.03, 0.03, 0.34, -1.05, 0.02, 0.7, 'rust'],
      ...lampRow(-2.4, -0.4, 2.4, -0.4, 7, 201, 0.17, 0.14), ...lampRow(-2.8, 0.7, 2.8, 0.7, 6, 203, 0.17),
      ...benchRow(-2.7, 0.45, -0.3, 0.45, 3, 211), ...benchRow(1.1, 0.45, 2.7, 0.45, 2, 217),
      ...scatterTrees(-2.8, -2.8, -2.4, -0.2, 3, 221), ...scatterTrees(2.55, -2.8, 2.85, 0.4, 3, 227), ...scatterTrees(-2.8, 2.6, -2.5, 2.8, 1, 229), ...scatterTrees(2.55, 2.6, 2.85, 2.8, 1, 233),
      ...bikeShed(-2.0, 0.95, 0.7, 0.02, 'boxBlue'),
    ] },
  ],
});

// ================================================================= 107 research institute

export const research: KindDef = edu({
  id: 'research-institute', name: 'research institute', kindId: 107, tier: 7, footprint: { w: 3, h: 3, door: [1, 2] },
  tool: { id: 'research', key: '', label: 'Research institute (3×3)', color: '#8a8f9c' },
  blurb: 'Forty scientists in glass and steel laboratories: postgraduate research, the best-paid jobs in town, and a pull on high-end offices nearby. It takes graduates and gives back specialists.',
  howTo: 'A 3×3 plot with the entrance in the middle of the frontage, ideally near a university. It needs a steady supply of graduates and postgraduates to staff its labs. Needs Research.',
  occupation: staff('research scientist', [{ start: 9, hours: 8, weight: 0.5 }, { start: 10, hours: 8, weight: 0.3 }, { start: 12, hours: 8, weight: 0.2 }], [[1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 0, 0, 1], [0, 1, 1, 1, 1, 1, 0]]),
  attrs: { stage: 7, pupilCapacity: 0, catchment: 0, ages: [21, 99], teachersShare: 0.6, postgradShare: 0.6, title: 'research institute' },
}, {
  capacity: 40, wage: 32, cost: 5000, upkeep: 150, parking: { surface: 16, underground: 30 },
  designs: [
    { name: 'glass and zinc laboratory block with a saw-tooth roof, a glazed atrium tube, rooftop plant and fume stacks', height: 1.1, ops: [
      ground(3, 3, 'lawn'),
      patch(2.9, 0.8, 0, 1.05, PAVING),
      // the three-storey lab: curtain-walled glass under a plant deck at the back and zinc saw-teeth at the front
      ['box', 2.2, 0.62, 1.2, 0, 0.02, -0.2, 'glass', 'office', { name: 'lab', facade: { storeys: 3, bays: 11, sideBays: 5, top: 0.04 } }],
      ['cornice', 'lab', 1, 'steel'], ['cornice', 'lab', 2, 'steel'],
      ['box', 2.24, 0.03, 0.68, 0, 0.66, -0.54, 'dark'],
      ...repeat(4, (i): Op => ['roof', 0.55, 0.2, 0.56, -0.825 + i * 0.55, 0.66, 0.12, 'silver', true]),
      ...plant(-0.9, 0.69, -0.7, 3), ...plant(0.2, 0.69, -0.45, 3),
      ...repeat(6, (i): Op => ['cyl', 0.013, 0.013, 0.28 + 0.06 * (i % 3), -0.95 + i * 0.38, 0.69, -0.74 + jit(i + 300, 0.05), 'steel', 6]),
      ...repeat(6, (i): Op => ['cyl', 0.017, 0.017, 0.02, -0.95 + i * 0.38, 0.97 + 0.06 * (i % 3), -0.74 + jit(i + 300, 0.05), 'red', 6]),
      // the glazed atrium tube lying along the front, and its door
      ['lathe', -0.9, 0.28, 0.7, 'glass', [0.26, 0, 0.26, 1.8], { seg: 14, axis: 'x', win: 'office', stripe: 'steel', every: 2, width: 1 }],
      ['box', 0.2, 0.2, 0.02, 0, 0.02, 0.955, 'door'],
      // the compound at the back: two cryogenic tanks and a chiller, behind a fence
      ['cyl', 0.13, 0.13, 0.34, -0.95, 0.02, -1.2, 'silver', 12], ['cone', 0.13, 0.06, -0.95, 0.36, -1.2, 'silver', 12],
      ['cyl', 0.13, 0.13, 0.34, -0.62, 0.02, -1.2, 'silver', 12], ['cone', 0.13, 0.06, -0.62, 0.36, -1.2, 'silver', 12],
      ['box', 0.4, 0.14, 0.2, -0.1, 0.02, -1.2, 'plant'], ['box', 0.36, 0.01, 0.16, -0.1, 0.16, -1.2, 'steel'],
      ...fence(-0.6, -0.97, 1.5, true, 'charcoal', 0.09), ...fence(-0.6, -1.42, 1.5, true, 'charcoal', 0.09), ...fence(-1.35, -1.2, 0.45, false, 'charcoal', 0.09), ...fence(0.15, -1.2, 0.45, false, 'charcoal', 0.09),
      // a tanker at the loading apron, cars and a bike shelter at the front
      ...van(1.05, -1.15, 'white', 'boxBlue', true, 0.02), ['box', 0.2, 0.1, 0.12, 1.28, 0.02, -1.15, 'silver'],
      ...carRow(0.6, 1.1, 4, 0.2, false, 0.026, 2), ...bikeShed(-1.0, 1.2, 0.5, 0.026, 'charcoal'),
      ...lampRow(-1.4, 0.95, 1.4, 0.95, 5, 307, 0.19), ...benchRow(-1.3, 0.55, 1.3, 0.55, 2, 311, 0.02),
      ...scatterTrees(-1.4, -0.8, -1.25, 0.6, 3, 313), ...scatterTrees(1.3, -0.7, 1.35, 0.5, 3, 317), ...scatterTrees(-1.2, 1.3, -0.5, 1.4, 1, 331),
    ] },
    { name: 'science-park cluster of brick and pale pavilions round a pyramid-roofed glass atrium, with an observatory dome and a wind turbine', height: 0.84, ops: [
      ground(3, 3, 'lawn'),
      patch(2.9, 0.7, 0, 1.1, PAVING), patch(0.5, 0.9, 0, 0.0, PAVING),
      // the central glass atrium under a glass pyramid
      ['box', 0.8, 0.5, 0.8, 0, 0.02, 0.0, 'glass', 'office', { name: 'atr', facade: { storeys: 2, bays: 4, sideBays: 4 } }],
      ['door', 'atr', 'front', 1, 'door'],
      ['box', 0.84, 0.02, 0.84, 0, 0.52, 0.0, 'steel'], ['taper', 0.78, 0.78, 0.06, 0.06, 0.3, 0, 0.54, 0, 'glass'],
      // the left pavilion in brick with solar panels, the right in pale cladding under a living roof
      ['box', 0.9, 0.46, 0.9, -0.95, 0.02, -0.1, 'brick', 'office', { name: 'pl', facade: { storeys: 2, bays: 4, sideBays: 4, top: 0.03 } }],
      ['box', 0.94, 0.025, 0.94, -0.95, 0.48, -0.1, 'dark'], ...repeat(3, (i): Op => ['roof', 0.24, 0.045, 0.6, -1.17 + i * 0.22, 0.505, -0.1, 'navy']),
      ['box', 0.9, 0.46, 0.9, 0.95, 0.02, -0.1, 'pale', 'office', { name: 'pr', facade: { storeys: 2, bays: 4, sideBays: 4, top: 0.03 } }],
      ['box', 0.94, 0.03, 0.94, 0.95, 0.48, -0.1, 'lawn'], ['box', 0.2, 0.05, 0.2, 1.1, 0.51, -0.3, 'lawnDark'],
      // the rear block with the observatory dome and the wind turbine
      ['box', 0.9, 0.5, 0.8, 0, 0.02, -0.95, 'cream', 'office', { name: 'rear', facade: { storeys: 2, bays: 5, sideBays: 0, top: 0.03 } }],
      ['box', 0.9, 0.03, 0.84, 0, 0.52, -0.95, 'dark'],
      ['lathe', -0.2, 0.55, -0.95, 'white', [0.22, 0, 0.215, 0.05, 0.19, 0.11, 0.14, 0.17, 0.08, 0.21, 0, 0.23], { seg: 16 }], ['box', 0.05, 0.2, 0.012, -0.2, 0.57, -0.73, 'dark'],
      ...plant(0.18, 0.55, -1.0, 2),
      ['cyl', 0.012, 0.016, 0.6, 1.15, 0.02, -1.2, 'white', 6], ['box', 0.04, 0.04, 0.06, 1.15, 0.6, -1.2, 'white'],
      ['box', 0.016, 0.3, 0.006, 1.15, 0.47, -1.16, 'white'], ['box', 0.3, 0.016, 0.006, 1.15, 0.61, -1.16, 'white'],
      // a rain-garden pond, a bike shelter, lamps, benches and trees, none on a grid
      ['cyl', 0.2, 0.22, 0.016, -0.95, 0.02, 1.15, 'stone', 14], ['cyl', 0.16, 0.16, 0.02, -0.95, 0.02, 1.15, 'pond', 14],
      ['cyl', 0.1, 0.12, 0.016, 1.0, 0.02, 1.15, 'stone', 12], ['cyl', 0.07, 0.07, 0.02, 1.0, 0.02, 1.15, 'pond', 12],
      ...bikeShed(0.6, 0.95, 0.5, 0.026, 'steel'),
      ...lampRow(-1.4, 0.8, 1.4, 0.8, 6, 337, 0.19), ...benchRow(-1.4, 0.5, -0.5, 0.5, 2, 341), ...benchRow(0.5, 0.5, 1.4, 0.5, 2, 343),
      ...scatterTrees(-1.4, -1.4, -1.0, -0.8, 3, 347), ...scatterTrees(0.85, -1.35, 1.3, -0.9, 2, 349), ...scatterTrees(-1.4, 0.6, -1.3, 1.3, 2, 353), ...scatterTrees(1.3, 0.6, 1.35, 1.3, 2, 359),
    ] },
  ],
});

// ================================================================= 108 halls of residence

export const halls: KindDef = edu({
  id: 'halls', name: 'halls of residence', kindId: 108, tier: 8, footprint: { w: 2, h: 2, door: [1, 1] },
  windows: 'home',
  tool: { id: 'halls', key: '', label: 'Halls of residence (2×2)', color: '#9c6a2a' },
  blurb: 'Eighty beds for students, with two wardens. Students who come to study from far away live here rather than taking a home from a resident, and a student quarter next to a campus keeps the shops busy.',
  howTo: 'A 2×2 plot beside a road, close to a university or FE college. It houses only enrolled students and does nothing on its own. Needs Higher education.',
  occupation: staff('hall warden', [{ start: 7, hours: 8, weight: 0.4 }, { start: 15, hours: 8, weight: 0.4 }, { start: 23, hours: 8, weight: 0.2 }], [[1, 1, 1, 1, 1, 0, 0], [0, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 1, 1, 1]]),
  attrs: { stage: 0, pupilCapacity: 0, beds: 80, ages: [18, 99], title: 'halls of residence' },
}, {
  capacity: 2, wage: 18, cost: 1500, upkeep: 25, parking: { surface: 4, underground: 8 },
  designs: [
    { name: '1960s concrete slab of student rooms with access decks, a common room and a bike shed', height: 1.44, ops: [
      ground(2, 2, 'lawn'),
      patch(1.9, 0.4, 0, 0.78, PAVING),
      // the slab: five storeys of rooms on a long access deck
      ['box', 1.5, 1.15, 0.4, 0, 0.02, -0.3, 'stone', 'home', { name: 'slab', facade: { storeys: 5, bays: 8, sideBays: 0, top: 0.03 } }],
      ['balcony', 'slab', 'front', 2, 0, 7, 'steel', CONC2], ['balcony', 'slab', 'front', 4, 0, 7, 'steel', CONC2],
      ['cornice', 'slab', 1, 'white'], ['cornice', 'slab', 3, 'white'],
      ['box', 1.56, 0.04, 0.46, 0, 1.17, -0.3, 'dark'], ['box', 0.2, 0.12, 0.2, 0.3, 1.21, -0.3, 'plant'], ...mast(-0.45, 1.21, -0.3, 0.2),
      ['box', 0.16, 1.2, 0.12, 0.83, 0.02, -0.3, 'boxOrange'], ['box', 0.2, 0.03, 0.16, 0.83, 1.22, -0.3, 'dark'],
      // the common room in front, flat-roofed, with the entrance at the door tile
      ['box', 0.9, 0.22, 0.4, 0.3, 0.02, 0.35, 'brick', 'home', { name: 'common', facade: { storeys: 1, bays: 4, sideBays: 0 } }],
      ['door', 'common', 'front', 3, 'boxBlue'], ['porch', 'common', 'front', 3, 3, 'boxBlue', 'white'],
      ['box', 0.96, 0.025, 0.46, 0.3, 0.24, 0.35, 'white'],
      ...bikeShed(-0.6, 0.45, 0.55, 0.02, 'boxGreen'),
      ...lampRow(-0.85, 0.85, 0.85, 0.85, 3, 401, 0.19), ...benchRow(-0.9, 0.62, -0.2, 0.62, 2, 403), ...scatterTrees(-0.9, -0.82, 0.6, -0.76, 3, 409), ...scatterTrees(0.75, 0.62, 0.85, 0.7, 1, 413),
    ] },
    { name: 'modern cluster flats in cream and white cladding round a courtyard with balconies and a bike shed', height: 0.75, ops: [
      ground(2, 2, 'lawn'),
      patch(1.0, 0.8, 0, 0.0, PAVING), patch(1.9, 0.36, 0, 0.8, PAVING),
      // three blocks of three storeys round the courtyard, balconies facing in
      ['box', 1.5, 0.66, 0.4, 0, 0.02, -0.7, 'cream', 'home', { name: 'back', facade: { storeys: 3, bays: 7, sideBays: 0, top: 0.03 } }],
      ['cornice', 'back', 1, 'boxOrange'], ['cornice', 'back', 2, 'boxOrange'], ['door', 'back', 'front', 3, 'boxOrange'],
      ['box', 0.4, 0.5, 1.0, -0.7, 0.02, 0.15, 'cream', 'home', { name: 'left', facade: { storeys: 2, bays: 2, sideBays: 5, top: 0.03 } }],
      ['balcony', 'left', 'right', 1, 0, 4, 'white', 'stone'], ['cornice', 'left', 1, 'boxGreen'],
      ['box', 0.4, 0.5, 1.0, 0.7, 0.02, 0.15, 'white', 'home', { name: 'right', facade: { storeys: 2, bays: 2, sideBays: 5, top: 0.03 } }],
      ['balcony', 'right', 'left', 1, 0, 4, 'white', 'stone'], ['cornice', 'right', 1, 'boxBlue'],
      ['box', 1.56, 0.03, 0.46, 0, 0.68, -0.7, 'dark'], ['box', 0.46, 0.03, 1.06, -0.7, 0.52, 0.15, 'dark'], ['box', 0.46, 0.03, 1.06, 0.7, 0.52, 0.15, 'dark'],
      ...repeat(3, (i): Op => ['roof', 0.24, 0.04, 0.3, -0.45 + i * 0.3, 0.71, -0.7, 'navy']),
      // the courtyard: picnic benches, trees and a bike shed, all at hashed spots
      ...benchRow(-0.3, -0.1, 0.3, 0.3, 2, 421, 0.026), ...scatterTrees(-0.3, -0.25, 0.3, 0.2, 2, 423),
      ...bikeShed(0.55, 0.88, 0.55, 0.026, 'boxGreen'), ...fence(-0.6, 0.97, 0.7, true, 'charcoal', 0.08), ...fence(0.65, 0.97, 0.6, true, 'charcoal', 0.08),
      ...lampRow(-0.85, 0.76, 0.85, 0.76, 3, 431, 0.19), ...scatterTrees(-0.9, 0.82, -0.7, 0.9, 1, 433),
    ] },
  ],
});

export const EDUCATION: KindDef[] = [nursery, primary, secondary, sixthForm, feCollege, university, research, halls];
