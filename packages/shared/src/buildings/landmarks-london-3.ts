import type { KindDef, Op } from './schema';
import { repeat } from './helpers';
import { slab, tree, lampPost, fence, PAVING } from './tierkit';
import { clockFace, lampRow, benchRow, scatterTrees, patch, bikeShed } from './edukit';

/**
 * London's universities (docs/education.md section 9, docs/buildings.md "Landmarks"): UCL (111), Imperial College (112),
 * King's College London (113) and the London School of Economics (114), collection tiers 11-14 of the 'london' group.
 * Each is a landmark that works as a university (the rung of the education ladder at stage 6, kind 106's numbers scaled
 * to its footprint): it admits students from the whole city, employs lecturers and turns out graduates. They are
 * civic, family code 14 like the education kinds, and unlocked by the locked tech node `lnd2` (tech.ts).
 *
 * `schoolSpec` (shared/src/education.ts) reads them as it reads kinds 101-108, by their `stage` attribute.
 *
 * The designs, one each, in tiles (about 33 m to a tile; +z towards the road):
 *   UCL, 4×3: the Wilkins Building. A long Portland-stone front between two forward wings, a decastyle-style portico
 *     of Corinthian columns under a pediment on a flight of steps, and the low green dome on its drum behind.
 *   Imperial, 3×3: the Queen's Tower, a tall red-brick tower with a stone clock stage and belfry and a copper dome,
 *     between two brick ranges, on the Queen's Lawn.
 *   King's, 4×3: the Strand building, Smirke's stone front with a rusticated base, a pedimented centre and a balustrade,
 *     and the courtyard behind it with its fountain.
 *   LSE, 3×3: the Centre Building, a stepped stack of pale masonry and glass with cantilevered upper floors and a
 *     glazed corner atrium, on a plaza.
 */

const TAGS = ['london'];

const PORTLAND = 0xe8e3d4, PORTLAND_DK = 0xd3ccb8, LEAD = 0x7d8a86, COPPER = 0x6fae98;

// ================================================================= 111 UCL, the Wilkins Building

/**
 * The Wilkins Building along x, its door on the +z side. Facade boxes that touch must meet on whole window cells
 * (buildings:check refuses half-hidden windows): the wings run 1.68 deep from z = -1.2 in 8 cells of 0.2 (margin 0.04), the
 * range between them fills the first three cells of their inner walls, and the plain portico block covers the seven
 * middle bays of the range's 13 (cells of 0.2 from x = -1.3). The range has no `cornice` rings, which would run over
 * the wings' windows where the two meet.
 */
const uclOps = (): Op[] => {
  const ops: Op[] = [slab(4, 3, PAVING)];
  // the front quad: lawns either side of a gravel walk
  ops.push(['box', 1.1, 0.006, 1.4, -0.9, 0.02, 0.75, 'lawn'], ['box', 1.1, 0.006, 1.4, 0.9, 0.02, 0.75, 'lawn'], patch(0.6, 1.5, 0, 0.75, 'gravel'));
  // the main range between the wings: three storeys of Portland stone, 13 bays
  ops.push(['box', 2.7, 0.62, 0.64, 0, 0.02, -0.88, PORTLAND, 'civic', { name: 'main', facade: { storeys: 3, bays: 13, sideBays: 0, margin: 0.05, top: 0.04 } }]);
  ops.push(['box', 2.76, 0.03, 0.7, 0, 0.64, -0.88, PORTLAND_DK]);
  ops.push(['roof', 2.7, 0.1, 0.6, 0, 0.67, -0.88, LEAD]);
  // the plain block that carries the portico, in front of the middle seven bays
  ops.push(['box', 1.4, 0.62, 0.4, 0, 0.02, -0.36, PORTLAND]);
  // the two wings forward of it, two storeys over 8 bays along the court
  for (const sx of [-1, 1]) {
    const name = sx < 0 ? 'wl' : 'wr';
    ops.push(['box', 0.5, 0.46, 1.68, sx * 1.6, 0.02, -0.36, PORTLAND, 'civic', { name, facade: { storeys: 2, bays: 2, sideBays: 8, margin: 0.04, top: 0.04 } }]);
    ops.push(['cornice', name, 1, PORTLAND_DK], ['cornice', name, 2, PORTLAND_DK]);
    ops.push(['roof', 0.52, 0.12, 1.7, sx * 1.6, 0.5, -0.36, LEAD, true]);
  }
  // the portico: a stylobate and steps, eight Corinthian columns, the entablature and the pediment
  ops.push(['box', 1.62, 0.07, 0.62, 0, 0.02, 0.0, PORTLAND_DK], ['box', 1.5, 0.05, 0.5, 0, 0.09, 0.0, PORTLAND], ['box', 1.8, 0.04, 0.2, 0, 0.02, 0.4, PORTLAND_DK], ['box', 1.7, 0.04, 0.16, 0, 0.06, 0.32, PORTLAND_DK]);
  ops.push(...repeat(8, (i): Op => ['cyl', 0.026, 0.03, 0.45, -0.56 + i * 0.16, 0.14, 0.1, 'white', 8]));
  ops.push(...repeat(8, (i): Op => ['box', 0.07, 0.025, 0.07, -0.56 + i * 0.16, 0.59, 0.1, PORTLAND_DK]));
  ops.push(['box', 1.34, 0.07, 0.4, 0, 0.62, -0.1, PORTLAND], ['box', 1.4, 0.03, 0.46, 0, 0.69, -0.1, PORTLAND_DK]);
  ops.push(['roof', 1.34, 0.2, 0.44, 0, 0.72, -0.1, PORTLAND, true]);
  // the dome behind the portico: a drum of tall windows, a cornice, the copper dome and its lantern
  ops.push(['lathe', 0, 0.69, -0.9, PORTLAND, [0.36, 0, 0.36, 0.2, 0.3, 0.2, 0.3, 0.3], { seg: 16, win: 'civic' }]);
  ops.push(['cyl', 0.4, 0.4, 0.03, 0, 0.69, -0.9, PORTLAND_DK, 16], ['cyl', 0.38, 0.38, 0.03, 0, 0.99, -0.9, PORTLAND_DK, 16]);
  ops.push(['lathe', 0, 1.02, -0.9, COPPER, [0.33, 0, 0.32, 0.05, 0.29, 0.11, 0.23, 0.17, 0.15, 0.21, 0.07, 0.235, 0, 0.245], { seg: 16 }]);
  ops.push(['cyl', 0.035, 0.04, 0.09, 0, 1.26, -0.9, PORTLAND, 8], ['cone', 0.045, 0.1, 0, 1.35, -0.9, COPPER, 8], ['cyl', 0.005, 0.005, 0.09, 0, 1.45, -0.9, 'gold', 4]);
  // railings and gate piers along the street, lamps, benches, trees clear of the walls
  ops.push(...fence(-1.15, 1.42, 1.3, true, 'charcoal', 0.09), ...fence(1.15, 1.42, 1.3, true, 'charcoal', 0.09));
  ops.push(['box', 0.1, 0.18, 0.1, -0.42, 0.02, 1.42, PORTLAND], ['box', 0.1, 0.18, 0.1, 0.42, 0.02, 1.42, PORTLAND], ['box', 0.12, 0.02, 0.12, -0.42, 0.2, 1.42, 'gold'], ['box', 0.12, 0.02, 0.12, 0.42, 0.2, 1.42, 'gold']);
  ops.push(...lampRow(-0.38, 0.5, -0.38, 1.3, 3, 501, 0.18), ...lampRow(0.38, 0.5, 0.38, 1.3, 3, 503, 0.18));
  ops.push(...benchRow(-1.05, 0.2, -0.55, 0.2, 2, 509), ...benchRow(0.55, 0.2, 1.05, 0.2, 2, 511));
  ops.push(...scatterTrees(-1.1, 0.8, -0.65, 1.25, 3, 521), ...scatterTrees(0.65, 0.8, 1.1, 1.25, 3, 523));
  return ops;
};

// ================================================================= 112 Imperial College, the Queen's Tower

const BRICK = 0xb4533a, BRICK_DK = 0x9a432d, STONE = 0xdcd2b8;

/** The Queen's Tower at (TX, TZ): the stone base, the brick shaft, the clock stage and belfry, the copper dome. */
const TX = 0, TZ = -0.78;
const queensTower = (): Op[] => [
  // the base: a stone plinth with the arched door on its front
  ['box', 0.64, 0.34, 0.64, TX, 0.02, TZ, STONE, 'civic', { name: 'base', facade: { storeys: 1, bays: 3, sideBays: 3, margin: 0.04, ground: 'door', top: 0.03 } }],
  ['box', 0.7, 0.03, 0.7, TX, 0.36, TZ, 0xc9bf9f],
  // the shaft: brick with stone bands, windows in pairs up each face and stone quoins at the corners
  ['box', 0.5, 1.3, 0.5, TX, 0.39, TZ, BRICK, 'civic', { name: 'shaft', facade: { storeys: 6, bays: 2, sideBays: 2, margin: 0.06, top: 0.02 } }],
  ['cornice', 'shaft', 2, STONE], ['cornice', 'shaft', 4, STONE],
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Op => ['box', 0.05, 1.3, 0.05, TX + sx * 0.235, 0.39, TZ + sz * 0.235, STONE]),
  ['box', 0.58, 0.04, 0.58, TX, 1.69, TZ, STONE],
  // the clock stage: stone, a clock on every face
  ['box', 0.54, 0.34, 0.54, TX, 1.73, TZ, STONE],
  ...clockFace(TX, 1.9, TZ + 0.275, 0.1), ...clockFace(TX, 1.9, TZ - 0.275, 0.1),
  ['box', 0.62, 0.04, 0.62, TX, 2.07, TZ, 0xc9bf9f],
  // the belfry: open arches, corner pinnacles, a stone balcony
  ['box', 0.46, 0.3, 0.46, TX, 2.11, TZ, STONE, 'civic', { name: 'belfry', facade: { storeys: 1, bays: 2, sideBays: 2, margin: 0.03 } }],
  ['box', 0.54, 0.035, 0.54, TX, 2.41, TZ, STONE],
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Op => ['taper', 0.07, 0.07, 0, 0, 0.26, TX + sx * 0.235, 2.44, TZ + sz * 0.235, STONE]),
  // the copper dome with its lantern and spire
  ['lathe', TX, 2.44, TZ, COPPER, [0.22, 0, 0.21, 0.06, 0.18, 0.13, 0.12, 0.19, 0.06, 0.23, 0, 0.25], { seg: 14 }],
  ['cyl', 0.03, 0.035, 0.1, TX, 2.69, TZ, STONE, 8], ['cone', 0.04, 0.2, TX, 2.79, TZ, COPPER, 8], ['cyl', 0.005, 0.005, 0.1, TX, 2.99, TZ, 'gold', 4],
];

const imperialOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the Queen's Lawn, crossed by two paths, with a pond
  ops.push(['box', 1.4, 0.006, 1.7, 0, 0.02, 0.55, 'lawn'], patch(0.3, 1.75, 0, 0.55, 'gravel'), patch(1.4, 0.24, 0, 0.7, 'gravel'));
  ops.push(['cyl', 0.2, 0.22, 0.03, 0, 0.02, 0.7, 'stone', 16], ['cyl', 0.15, 0.15, 0.036, 0, 0.02, 0.7, 'pond', 16]);
  ops.push(...queensTower());
  // the stair and terrace in front of the tower
  ops.push(['box', 0.9, 0.05, 0.22, TX, 0.02, TZ + 0.5, STONE], ['box', 0.75, 0.05, 0.16, TX, 0.07, TZ + 0.46, STONE]);
  // two brick ranges either side of the lawn, three storeys under slate, their ends towards the street
  for (const sx of [-1, 1]) {
    const name = sx < 0 ? 'rl' : 'rr';
    ops.push(['box', 0.62, 0.62, 1.5, sx * 1.12, 0.02, -0.2, BRICK, 'civic', { name, facade: { storeys: 3, bays: 3, sideBays: 7, margin: 0.05, top: 0.04 } }]);
    ops.push(['cornice', name, 1, STONE], ['cornice', name, 2, STONE], ['cornice', name, 3, STONE]);
    ops.push(['roof', 0.66, 0.2, 1.54, sx * 1.12, 0.66, -0.2, 'slate', true]);
    ops.push(...[-0.55, 0.25].map((z, i): Op => ['chimneyStack', sx * 1.12 + 0.2, 0.74, z, 0.22 + 0.03 * i, 0.035, 'brick']));
  }
  // the link range behind the tower
  ops.push(['box', 1.8, 0.5, 0.26, 0, 0.02, -1.35, BRICK_DK, 'civic', { name: 'link', facade: { storeys: 2, bays: 8, sideBays: 0, margin: 0.05, top: 0.03 } }]);
  ops.push(['cornice', 'link', 2, STONE], ['roof', 1.86, 0.16, 0.3, 0, 0.54, -1.35, 'slate']);
  // lamps, benches, trees at hashed spots, a bike shed by the east range
  ops.push(...lampRow(-0.35, 1.25, 0.35, 1.25, 3, 601, 0.18), ...lampRow(-0.35, 0.05, -0.35, 1.2, 3, 603, 0.18), ...lampRow(0.35, 0.05, 0.35, 1.2, 3, 607, 0.18));
  ops.push(...benchRow(-0.65, 0.95, -0.45, 0.95, 1, 611), ...benchRow(0.45, 0.95, 0.65, 0.95, 1, 613));
  ops.push(...scatterTrees(-0.62, 0.0, -0.42, 1.2, 3, 617), ...scatterTrees(0.42, 0.0, 0.62, 1.2, 3, 619), ...scatterTrees(-1.3, 1.1, -0.95, 1.35, 2, 621), ...scatterTrees(0.95, 1.1, 1.3, 1.35, 2, 623));
  return ops;
};

// ================================================================= 113 King's College London, the Strand building

/**
 * The Strand front along x on the street (+z): a rusticated ground storey, three storeys above, a pedimented middle
 * and a balustrade along the roofline; side ranges run back from its ends round the courtyard. The front is 19 bays of
 * 0.2 (x from -1.95, margin 0.05), so the 0.65-wide side ranges cover exactly the first and last three of its back
 * wall's cells, and the portico is the facade's own door, porch and balcony ops on the middle five bays.
 */
const SMIRKE = 0xdad2bd, SMIRKE_DK = 0xc4bba2;
const kingsOps = (): Op[] => {
  const ops: Op[] = [slab(4, 3, PAVING)];
  // the courtyard behind the front: gravel, lawns, a fountain with jets, and the river terrace wall at the back
  ops.push(patch(2.5, 1.7, 0, -0.2, 'gravel'), ['box', 0.7, 0.006, 0.8, -0.8, 0.02, -0.4, 'lawn'], ['box', 0.7, 0.006, 0.8, 0.8, 0.02, -0.4, 'lawn']);
  ops.push(['cyl', 0.2, 0.22, 0.04, 0, 0.02, -0.4, 'stone', 18], ['cyl', 0.16, 0.16, 0.046, 0, 0.02, -0.4, 'pond', 18], ['cone', 0.02, 0.2, 0, 0.06, -0.4, 0xcfe8ff, 6]);
  ops.push(...repeat(6, (i): Op => ['cone', 0.012, 0.09, 0.1 * Math.sin(i * 1.05), 0.06, -0.4 + 0.1 * Math.cos(i * 1.05), 0xcfe8ff, 5]));
  ops.push(['box', 3.8, 0.1, 0.06, 0, 0.02, -1.42, SMIRKE_DK], ...repeat(14, (i): Op => ['box', 0.03, 0.06, 0.03, -1.76 + i * 0.27, 0.12, -1.42, SMIRKE]));
  // the front range: 19 bays, four storeys with a banded ground floor and a balustrade
  ops.push(['box', 3.9, 0.74, 0.5, 0, 0.02, 1.0, SMIRKE, 'civic', { name: 'front', facade: { storeys: 4, bays: 19, sideBays: 0, margin: 0.05, ground: 'plain', top: 0.05 } }]);
  ops.push(['box', 3.94, 0.03, 0.54, 0, 0.76, 1.0, SMIRKE_DK]);
  ops.push(...repeat(36, (i): Op => ['box', 0.022, 0.05, 0.022, -1.9 + i * 0.108, 0.79, 1.255, SMIRKE]), ['box', 3.9, 0.012, 0.03, 0, 0.84, 1.255, SMIRKE_DK]);
  ops.push(['roof', 3.8, 0.12, 0.42, 0, 0.8, 0.98, LEAD]);
  // the middle five bays: the door, a portico of four columns clear of the wall, and a pediment over them
  ops.push(['door', 'front', 'front', 9]);
  ops.push(...repeat(4, (i): Op => ['cyl', 0.022, 0.026, 0.4, -0.45 + i * 0.3, 0.06, 1.34, 'white', 8]), ['box', 1.1, 0.05, 0.14, 0, 0.46, 1.36, SMIRKE_DK], ['box', 1.2, 0.03, 0.26, 0, 0.02, 1.36, SMIRKE_DK]);
  ops.push(['roof', 1.1, 0.18, 0.1, 0, 0.8, 1.2, SMIRKE, true], ['box', 1.1, 0.03, 0.12, 0, 0.78, 1.2, SMIRKE_DK]);
  // the side ranges back from the front round the courtyard, three storeys
  for (const sx of [-1, 1]) {
    const name = sx < 0 ? 'sl' : 'sr';
    ops.push(['box', 0.65, 0.74, 1.85, sx * 1.625, 0.02, -0.175, SMIRKE, 'civic', { name, facade: { storeys: 4, bays: 3, sideBays: 9, margin: 0.05, top: 0.05 } }]);
    ops.push(['roof', 0.69, 0.14, 1.89, sx * 1.625, 0.78, -0.175, LEAD, true]);
  }
  // the gate lamps, trees in the court clear of the walls, benches
  ops.push(...lampPost(-1.0, 1.42, 0.2, 'marquee'), ...lampPost(1.0, 1.42, 0.2, 'marquee'));
  ops.push(...benchRow(-0.6, -0.9, 0.6, -0.9, 2, 701), ...scatterTrees(-1.0, -0.95, -0.7, 0.4, 2, 703), ...scatterTrees(0.7, -0.95, 1.0, 0.4, 2, 707));
  return ops;
};

// ================================================================= 114 LSE, the Centre Building

const CREAM = 0xdccfb2, SAND = 0xc9b88f;
/**
 * The stack, front (+z) to back: the two-storey podium, the four-storey middle block, the seven-storey slab at the
 * back, each a ground-up volume with a 0.06 slot between it and the next, so no wall hides another's windows.
 */
const lseOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the plaza in front: steps, planters, trees, lamps, benches and the school's red flags
  ops.push(['box', 2.7, 0.012, 0.9, 0, 0.02, 1.05, 'stone'], ['box', 1.4, 0.04, 0.14, -0.2, 0.02, 0.72, 'stone']);
  ops.push(...repeat(4, (i): Op => ['box', 0.2, 0.05, 0.12, 0.45 + i * 0.26, 0.02, 1.3, 'lawnDark']));
  ops.push(...lampRow(-1.2, 1.4, 1.2, 1.4, 5, 801, 0.19), ...benchRow(-1.2, 1.0, -0.4, 1.0, 2, 803));
  ops.push(...tree(1.25, 1.0, 0.8), ...tree(-1.3, 0.95, 0.7));
  ops.push(...repeat(3, (i): Op => ['flag', -1.0 + i * 0.14, 0.02, 1.15, 'red']));
  // the podium: two storeys of cream masonry with long glazed bands, a lawn terrace on its roof
  ops.push(['box', 2.5, 0.4, 0.8, 0.05, 0.02, 0.2, CREAM, 'office', { name: 'pod', facade: { storeys: 2, bays: 10, sideBays: 4, margin: 0.05, top: 0.03 } }]);
  ops.push(['cornice', 'pod', 1, 'white'], ['cornice', 'pod', 2, 'white']);
  ops.push(['box', 1.6, 0.012, 0.4, -0.3, 0.42, 0.25, 'lawn'], ['box', 1.6, 0.05, 0.03, -0.3, 0.42, 0.44, 'hedge']);
  // the canopy over the entrance on slim columns, clear of the front wall
  ops.push(['box', 1.1, 0.04, 0.36, -0.2, 0.3, 0.84, 'white'], ...repeat(3, (i): Op => ['cyl', 0.016, 0.016, 0.28, -0.7 + i * 0.5, 0.02, 1.0, 'steel', 6]));
  // the middle block steps up behind the podium: four storeys
  ops.push(['box', 1.9, 0.8, 0.62, -0.25, 0.02, -0.63, CREAM, 'office', { name: 'mid', facade: { storeys: 4, bays: 8, sideBays: 3, margin: 0.04, top: 0.03 } }]);
  ops.push(['cornice', 'mid', 2, 'white'], ['cornice', 'mid', 4, 'white']);
  // the glazed corner: a tall atrium of glass at the east end of the middle block
  ops.push(['box', 0.54, 0.8, 0.62, 1.03, 0.02, -0.63, 'glass', 'office', { name: 'atrium', facade: { storeys: 4, bays: 2, sideBays: 3, margin: 0.02 } }]);
  ops.push(['box', 0.6, 0.03, 0.68, 1.03, 0.82, -0.63, 'steel']);
  // the slab at the back: seven storeys of pale brick under a plant deck
  ops.push(['box', 1.4, 1.32, 0.4, -0.2, 0.02, -1.25, SAND, 'office', { name: 'tower', facade: { storeys: 7, bays: 6, sideBays: 2, margin: 0.05, top: 0.04 } }]);
  ops.push(['cornice', 'tower', 3, 'white'], ['cornice', 'tower', 6, 'white']);
  ops.push(['box', 1.46, 0.04, 0.46, -0.2, 1.34, -1.25, 'dark'], ['box', 0.4, 0.1, 0.26, -0.5, 1.38, -1.25, 'plant'], ['box', 0.3, 0.07, 0.22, 0.1, 1.38, -1.25, 'plant']);
  // the lower east wing behind the atrium
  ops.push(['box', 0.54, 0.6, 0.4, 1.03, 0.02, -1.25, CREAM, 'office', { name: 'east', facade: { storeys: 3, bays: 2, sideBays: 2, margin: 0.03, top: 0.03 } }]);
  return ops;
};

// ================================================================= the kinds

/** The university numbers of kind 106, scaled to a landmark's footprint: places, staff, cost, upkeep. */
const university = (k: {
  id: string; name: string; kindId: number; tier: number; w: number; h: number; door: [number, number]; tool: { id: string; label: string; color: string };
  blurb: string; howTo: string; places: number; staff: number; cost: number; upkeep: number; work: number; title: string;
  designName: string; height: number; ops: Op[]; windows?: KindDef['windows'];
}): KindDef => ({
  id: k.id, name: k.name, code: 14, kindId: k.kindId, family: 'civic', flags: { civic: true, workplace: true }, windows: k.windows ?? 'civic',
  landmark: true, tags: TAGS, group: 'london', tier: k.tier,
  footprint: { w: k.w, h: k.h, door: k.door },
  blurb: k.blurb, howTo: k.howTo,
  tool: { id: k.tool.id, key: '', label: k.tool.label, color: k.tool.color },
  occupation: {
    name: 'lecturer', rotate: false,
    shifts: [{ start: 9, hours: 8, weight: 0.55 }, { start: 10, hours: 8, weight: 0.3 }, { start: 13, hours: 8, weight: 0.15 }],
    cycles: [[1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 0, 0, 1]],
  },
  attrs: { stage: 6, pupilCapacity: k.places, catchment: 0, ages: [18, 99], teachersShare: 0.6, postgradShare: 0.4, title: k.title },
  lot: { wage: 28 },
  levels: [{
    capacity: k.staff, wage: 28, cost: k.cost, upkeep: k.upkeep, work: k.work, parking: { surface: 0, underground: 30 },
    designs: [{ name: k.designName, height: k.height, ops: k.ops }],
  }],
});

export const ucl = university({
  id: 'ucl', name: 'University College London', kindId: 111, tier: 11, w: 4, h: 3, door: [2, 2],
  tool: { id: 'ucl', label: 'UCL', color: '#500778' },
  blurb: 'University College London\'s Wilkins Building in Bloomsbury: a Portland-stone front between two wings, a portico of Corinthian columns on a flight of steps, and the low green dome behind. The first university in England to admit anyone, whatever their faith.',
  howTo: 'A 4×3 plot on a street in a district of homes and offices; students come from the whole city, so put it near a station or bus stop. It takes your sixth-form leavers, employs lecturers and turns out graduates. London landmark: unlock rule to be decided.',
  places: 360, staff: 36, cost: 9000, upkeep: 110, work: 3000, title: 'University College London',
  designName: 'Portland-stone front with a Corinthian portico, forward wings and a green dome', height: 1.45, ops: uclOps(),
});

export const imperial = university({
  id: 'imperial', name: 'Imperial College London', kindId: 112, tier: 12, w: 3, h: 3, door: [1, 2],
  tool: { id: 'imperial', label: 'Imperial College', color: '#003e74' },
  blurb: 'Imperial College in South Kensington: the Queen\'s Tower, the last of the Imperial Institute, rising out of red-brick ranges round the Queen\'s Lawn. Science, engineering and medicine.',
  howTo: 'A 3×3 plot with the lawn towards the street, near the museums or a station. Students come from the whole city; it takes your sixth-form leavers, employs lecturers and graduates scientists. London landmark: unlock rule to be decided.',
  places: 320, staff: 32, cost: 8500, upkeep: 105, work: 2800, title: 'Imperial College London',
  designName: 'red-brick Queen\'s Tower with a stone clock stage and copper dome, between brick ranges on a lawn', height: 3.05, ops: imperialOps(),
});

export const kings = university({
  id: 'kings', name: 'King\'s College London', kindId: 113, tier: 13, w: 4, h: 3, door: [2, 2],
  tool: { id: 'kings', label: 'King\'s College', color: '#c8102e' },
  blurb: 'King\'s College London\'s Strand building beside Somerset House: a long stone front of four storeys with a pedimented pavilion and a balustrade, and the courtyard and its fountain behind. Founded by the King and the Duke of Wellington in 1829.',
  howTo: 'A 4×3 plot on a main street, the front on the road and the courtyard behind. Students come from the whole city; it takes your sixth-form leavers, employs lecturers and graduates doctors, lawyers and historians. London landmark: unlock rule to be decided.',
  places: 300, staff: 30, cost: 8000, upkeep: 100, work: 2700, title: 'King\'s College London',
  designName: 'four-storey stone front on the Strand with a pedimented pavilion, a balustrade and a fountain court behind', height: 0.9, ops: kingsOps(),
});

export const lse = university({
  id: 'lse', name: 'London School of Economics', kindId: 114, tier: 14, w: 3, h: 3, door: [1, 2],
  tool: { id: 'lse', label: 'LSE', color: '#e4002b' },
  blurb: 'The London School of Economics on Houghton Street: the Centre Building, a stepped stack of cream masonry and glass with cantilevered floors and a glazed corner atrium over a plaza. Economists, lawyers and politicians.',
  howTo: 'A 3×3 plot with the plaza on the street, close to offices and the courts. Students come from the whole city; it takes your sixth-form leavers, employs lecturers and graduates the people offices and councils hire. London landmark: unlock rule to be decided.',
  places: 240, staff: 24, cost: 7500, upkeep: 95, work: 2500, title: 'London School of Economics',
  windows: 'office', designName: 'stepped stack of cream masonry and glass with a cantilever, a glazed corner atrium and a plaza', height: 2.75, ops: lseOps(),
});

/** The universities, in kind-id order (landmarks-london.ts appends them to LONDON_LANDMARKS). */
export const LONDON_LANDMARKS_C: KindDef[] = [ucl, imperial, kings, lse];
