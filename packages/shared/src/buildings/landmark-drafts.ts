import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { office } from './office';
import { library } from './leisure';
import { slab, tree, fence, lampPost, PAVING } from './tierkit';

/**
 * Draft landmarks: the path for a first contribution (docs/landmarks.md, CONTRIBUTING.md "Add a landmark in about an hour").
 *
 * A draft landmark is a whole kind with `draft: true`. It is compiled into the catalogue so /viewer.html shows it
 * (/viewer.html?tag=draft, or the Tag row), and it never reaches the city: its designs are drafts, it has no tool, and
 * `buildings:check` fails if one leaks into the city batch. Until it is accepted it needs NO tool, collection rung or
 * tech node. Validation (validate.ts landmarkErrors) asks of a draft only what the model needs to be shown:
 *   - `landmark: true`, `draft: true`, the civic flag and tags that include 'draft';
 *   - a kind id from the reserved range 230-249 (codes.ts LANDMARK_DRAFT_IDS), unique;
 *   - no tool (a draft is never placed);
 *   - the same recipe, footprint and numbers rules as any kind.
 * When a landmark is accepted, a maintainer drops `draft`, gives it a permanent kind id outside this range, a tool, a
 * rung of a `collection` group and a `locked` tech node, and moves it into its city's landmarks file.
 *
 * Add yours at the bottom of LANDMARK_DRAFTS: copy TEMPLATE, rename it, give it the next free id, and fill the
 * placeholders. Check it with `npm run landmarks:check`. Free ids: 230 template, 231 town hall clock tower, 232 and up.
 */

/** What every draft landmark shares. Spread it first and the kind is a draft landmark. */
const DRAFT = { landmark: true, draft: true, tags: ['draft'] };

/**
 * Role presets: what the simulation treats your landmark as (docs/landmarks.md section 1). Spread one and override.
 * `asOffice`: a workplace for office staff, nine to five (a town hall, a headquarters, a tower).
 * `asAttraction`: a daytime visitor attraction of the library family with a ticket (a cathedral, a castle, a museum, a monument).
 */
export const asOffice = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 },
};
export const asAttraction = {
  code: library.code, family: 'leisure' as const, flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic' as const,
  occupation: library.occupation, lot: { wage: 16 },
  attrs: { ...library.attrs, visitorCapacity: 40, ticket: 4, openHours: [9, 18], stay: [0.5, 1.5], leisureValue: 4, radius: 16, dayAppeal: 1.2, eveningAppeal: 0.1, retireeAppeal: 1.8, childAppeal: 1.2 },
};

// ================================================================= TEMPLATE (kind id 230)

/**
 * The template. Every field of a landmark kind is here with a one-line comment; placeholders are in <angle brackets>.
 * It is a real draft, so it compiles and shows in the viewer as "landmark template": a paved 2×2 plot with a windowed
 * block, a door on the front, a roof and a finial. That is the minimum a landmark needs; replace the ops with yours.
 */
const TEMPLATE: KindDef = {
  ...DRAFT,                                             // landmark, draft, tags ['draft']; add your own tags after it: tags: ['draft', '<city>']
  ...asOffice,                                          // the role: code, family, flags, windows class, occupation, lot (or asAttraction)
  id: 'landmark-template',                              // <your-landmark-id>: lower-case words and dashes, unique
  name: 'landmark template',                            // <the Name of the Building>: lower case as used in sentences, 'the' allowed
  kindId: 230,                                          // <free id in 230-249>: unique, never reused for a different building
  footprint: { w: 2, h: 2, door: [0, 1] },              // <w×h up to 4×4>; door is [dx, h - 1] on the front row, the tile the road must touch
  blurb: 'A starting point for a landmark: a paved plot, a windowed block with its door on the front, a roof and a finial.', // <one or two sentences: what it is and what it is known for, in the game's voice>
  howTo: 'A 2×2 plot with its door on the street. Staffed like any office. Draft: not placed in the city.',                 // <how to place it well: facing, what it needs nearby>
  levels: [{
    capacity: 20, wage: 20, cost: 3000, upkeep: 30, work: 800, parking: { surface: 2, underground: 6 }, // <jobs, wage per shift, price, upkeep per day, builder work, parking>
    designs: [{
      name: '<short description of the model>',         // shown in the viewer
      height: 0.9,                                      // <top of the tallest part in tiles, +-0.03>: 33 m per tile
      draft: true,                                      // viewer only; a draft landmark's designs are all drafts
      author: '<your name or model id>',                // shown and filterable in the viewer (Designer)
      ops: [
        slab(2, 2, PAVING),                             // the plot: 1.96 × 1.96 × 0.02, at ground level
        ['box', 1.2, 0.6, 0.8, 0, 0.02, 0, 'cream', true, { name: 'main', facade: { storeys: 2, bays: 4 } }], // the building: base at y 0.02 on the slab, windows by storey and bay
        ['door', 'main', 'front', 1],                   // the door, on the front (+z) wall, by cell: never a box on a windowed wall
        ['roof', 1.24, 0.22, 0.84, 0, 0.62, 0, 'slate'], // the roof sits exactly on the box top (0.02 + 0.6)
        ['cyl', 0.01, 0.02, 0.06, 0, 0.84, 0, 'gold', 6], // a finial on the roof ridge (0.62 + 0.22)
      ],
    }],
  }],
};

// ================================================================= 231 Victorian town hall clock tower (worked example)

/**
 * The clock tower's dials, in the shape Big Ben's `BIG_BEN` has (landmarks-london-2.ts): the middle of its clock stage
 * (`x`, `z`, `y` in the model's own frame, tiles) and `face`, the distance from that axis to the face of a dial, and the
 * dial's radius `r`. The recipe draws four white dials flat on the stage; render/landmarks.ts lays a lit face over
 * each at dusk with hands at the game's time, following the same constant so the two stay in step.
 */
export const CLOCK_TOWER = { x: -0.3, z: 0.35, y: 1.21, face: 0.3, r: 0.2 };
const CT = CLOCK_TOWER;

/** Four flat dials, one on each face of the clock stage: a dark bezel under a white face. */
const dials = (): Op[] => ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const).flatMap(([dx, dz]): Op[] => {
  const at = (inset: number) => dz !== 0 ? [CT.x, CT.y, CT.z + dz * (CT.face - inset)] as const : [CT.x + dx * (CT.face - inset), CT.y, CT.z] as const;
  const axis = dz !== 0 ? 'z' : 'x';
  return [
    ['lathe', ...at(0.006), 'charcoal', [0, 0, CT.r + 0.025, 0, CT.r + 0.025, 0.006], { seg: 24, axis }],
    ['lathe', ...at(0.004), 0xf3eee0, [0, 0, CT.r, 0, CT.r, 0.006], { seg: 24, axis }],
  ];
});

const TX = CLOCK_TOWER.x; // the tower stands on the hall's bays 1 and 2 (x -0.6..0), over the door tile [0, 1] (x -1..0)

/** Hall (back, 1.8 × 0.8), tower (front, 0.6 square, on whole cells of the hall's front wall), clock stage, belfry, spire. */
const clockTowerOps = (): Op[] => [
  slab(2, 2, PAVING),
  // the town hall: sandstone, two storeys of 0.3 and six bays of 0.3, so the tower (0.6 wide, standing on its front wall)
  // covers bays 2 and 3 whole, and its two window storeys sit exactly over the hall's two
  ['box', 1.8, 0.6, 0.8, 0, 0.02, -0.35, 'tan', true, { name: 'hall', facade: { storeys: 2, bays: 6, sideBays: 3 } }],
  ['roof', 1.84, 0.22, 0.8, 0, 0.62, -0.35, 'slate'],
  ['cornice', 'hall', 2, 'stone'],
  // the tower base: two storeys of windows over a door, then a plain band (the hall's roof ridge rises against it)
  ['box', 0.6, 0.9, 0.6, TX, 0.02, 0.35, 'sand', true, { name: 'tower', facade: { storeys: 2, bays: 3, sideBays: 3, margin: 0.04, top: 0.3 } }],
  ['door', 'tower', 'front', 1],
  ['cornice', 'tower', 2, 'stone'],
  ['box', 0.7, 0.04, 0.7, TX, 0.92, 0.35, 'stone'],
  // the clock stage: plain walls with a dial on each face
  ['box', 0.6, 0.5, 0.6, TX, 0.96, 0.35, 'sand'],
  ...dials(),
  ['box', 0.68, 0.04, 0.68, TX, 1.46, 0.35, 'stone'],
  // the belfry: lancet windows under a cap, a pinnacle at each corner
  ['box', 0.5, 0.26, 0.5, TX, 1.5, 0.35, 'sand', 'civic', { name: 'belfry', facade: { storeys: 1, bays: 2, sideBays: 2, margin: 0.04 } }],
  ['box', 0.6, 0.04, 0.6, TX, 1.76, 0.35, 'stone'],
  ...([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz]): Op => ['taper', 0.06, 0.06, 0, 0, 0.18, TX + sx * 0.25, 1.8, 0.35 + sz * 0.25, 'sand']),
  // the spire: an eight-sided slate cone with every second facet picked out, and a gilt finial
  ['lathe', TX, 1.8, 0.35, 'slate', [0.26, 0, 0.24, 0.12, 0.16, 0.34, 0.08, 0.52, 0.025, 0.6, 0, 0.6], { seg: 8, stripe: 'roofGrey', every: 2, width: 1 }],
  ['cyl', 0.006, 0.016, 0.1, TX, 2.4, 0.35, 'gold', 6],
  // a flagpole on the hall roof, lamps either side of the door, railings and two trees
  ['flag', 0.72, 0.84, -0.35, 'red'],
  ...lampPost(TX - 0.42, 0.78, 0.2, 'yellow'), ...lampPost(TX + 0.42, 0.78, 0.2, 'yellow'),
  ...fence(0, 0.94, 1.5, true, 'charcoal'),
  ...tree(-0.78, 0.7, 0.95), ...tree(0.8, 0.74, 0.85),
  // two stone steps up to the door
  ...repeat(2, (i): Op => ['box', 0.34 - i * 0.06, 0.02, 0.1, TX, 0.02 + i * 0.02, 0.7 - i * 0.04, 'stone']),
];

const clockTower: KindDef = {
  ...DRAFT, ...asOffice,
  id: 'town-clock-tower', name: 'the town hall clock tower', kindId: 231,
  tags: ['draft', 'victorian'],
  footprint: { w: 2, h: 2, door: [0, 1] },
  blurb: 'A Victorian town hall in sandstone with a clock tower on its front: four dials that light at dusk and keep the city\'s time under a slate spire.',
  howTo: 'A 2×2 plot in the middle of town, the door on the main street. The town\'s offices work here, and the clock is the square\'s meeting place.',
  occupation: { ...office.occupation!, name: 'town clerk\'s staff' },
  levels: [{
    capacity: 24, wage: 22, cost: 4000, upkeep: 40, work: 1000, parking: { surface: 2, underground: 6 },
    designs: [{
      name: 'sandstone town hall with a clock tower, four dials and a slate spire', height: 2.5, draft: true, author: 'docs example',
      ops: clockTowerOps(),
    }],
  }],
};

/** The draft landmarks the catalogue includes (catalogue.ts). Add yours at the end. */
export const LANDMARK_DRAFTS: KindDef[] = [TEMPLATE, clockTower];
