import type { Op } from './schema';
import { slab, tree, lampPost, PAVING, ASPHALT } from './tierkit';

/**
 * Paris landmarks, the claude-opus-5-5 designs (the comparison set for the kimi-2.8-preview designs in
 * landmarks-paris.ts). Same six buildings, same 2×2 plots, same scale (about 33 m to a tile), drawn from the
 * same ops. Plain walls only (no window grids). Drafts: they show in /compare.html and the viewer, and never
 * change what the city places.
 */

// ================================================================= 133 the Eiffel Tower

const IRON_O = 0x5f4d3c, IRON_LT_O = 0x75614c;

export const opusEiffelOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the gravel esplanade under the legs
  ops.push(['box', 1.7, 0.01, 1.7, 0, 0.02, 0, 'gravel']);
  // four splayed legs leaning in from the corners to the first floor
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      ops.push(['taper', 0.28, 0.28, 0.16, 0.16, 0.88, sx * 0.66, 0.03, sz * 0.66, IRON_O, { shift: [-sx * 0.3, -sz * 0.3] }]);
    }
  }
  // the lattice belts that join the legs halfway up, one on each face
  ops.push(['box', 0.9, 0.05, 0.04, 0, 0.6, 0.46, IRON_LT_O], ['box', 0.9, 0.05, 0.04, 0, 0.6, -0.46, IRON_LT_O]);
  ops.push(['box', 0.04, 0.05, 0.9, 0.46, 0.6, 0, IRON_LT_O], ['box', 0.04, 0.05, 0.9, -0.46, 0.6, 0, IRON_LT_O]);
  // the first floor
  ops.push(['box', 0.96, 0.1, 0.96, 0, 0.91, 0, IRON_LT_O]);
  // the second stage: four slimmer legs drawing together to the second floor
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      ops.push(['taper', 0.16, 0.16, 0.1, 0.1, 0.72, sx * 0.3, 1.01, sz * 0.3, IRON_O, { shift: [-sx * 0.14, -sz * 0.14] }]);
    }
  }
  ops.push(['box', 0.46, 0.06, 0.46, 0, 1.73, 0, IRON_LT_O]);
  // the long upper shaft, the summit room, the antenna and its red light
  ops.push(['taper', 0.34, 0.34, 0.07, 0.07, 2.6, 0, 1.79, 0, IRON_O]);
  ops.push(['box', 0.1, 0.1, 0.1, 0, 4.39, 0, IRON_LT_O]);
  ops.push(['cyl', 0.012, 0.016, 0.5, 0, 4.49, 0, 'steel', 6]);
  ops.push(['cyl', 0.02, 0.02, 0.03, 0, 4.99, 0, 'red', 6]);
  // the Champ de Mars: two plane trees
  ops.push(...tree(-0.88, 0.9, 0.6), ...tree(0.88, 0.9, 0.6));
  return ops;
};

// ================================================================= 134 the Arc de Triomphe

const ARC_O = 0xd2c8b0, ARC_DK_O = 0xb9ad93;

export const opusArcOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, ASPHALT)];
  // the paved island of the Étoile
  ops.push(['cyl', 0.94, 0.94, 0.01, 0, 0.02, 0, PAVING, 24]);
  // the two great piers, the vault spanning the arch between them
  ops.push(['box', 0.46, 1.0, 0.66, -0.45, 0.03, 0, ARC_O], ['box', 0.46, 1.0, 0.66, 0.45, 0.03, 0, ARC_O]);
  ops.push(['box', 0.44, 0.3, 0.66, 0, 0.73, 0, ARC_O]);
  // the small transverse arches through the piers, seen on the side faces
  ops.push(['box', 0.02, 0.4, 0.22, -0.69, 0.03, 0, 'charcoal'], ['box', 0.02, 0.4, 0.22, 0.69, 0.03, 0, 'charcoal']);
  // the sculpted groups on the pier faces, front and back
  for (const x of [-0.45, 0.45]) {
    for (const z of [0.34, -0.34]) {
      ops.push(['box', 0.24, 0.32, 0.02, x, 0.16, z, ARC_DK_O]);
    }
  }
  // the entablature, the attic and the crowning cornice
  ops.push(['box', 1.42, 0.04, 0.72, 0, 1.03, 0, ARC_DK_O]);
  ops.push(['box', 1.34, 0.28, 0.64, 0, 1.07, 0, ARC_O]);
  ops.push(['box', 1.4, 0.04, 0.7, 0, 1.35, 0, ARC_DK_O]);
  ops.push(['box', 1.3, 0.05, 0.6, 0, 1.39, 0, ARC_O]);
  // the flame of the unknown soldier under the vault
  ops.push(['box', 0.1, 0.02, 0.16, 0, 0.03, 0, ARC_DK_O]);
  ops.push(['cone', 0.02, 0.05, 0, 0.05, 0, 'marquee', 6]);
  // lamps round the island
  ops.push(...lampPost(-0.7, 0.55, 0.3, 'marquee', 0.03), ...lampPost(0.7, 0.55, 0.3, 'marquee', 0.03));
  ops.push(...lampPost(-0.7, -0.55, 0.3, 'marquee', 0.03), ...lampPost(0.7, -0.55, 0.3, 'marquee', 0.03));
  return ops;
};

// ================================================================= 135 Notre-Dame

const LIME_O = 0xcbc2aa, LIME_DK_O = 0xb3a98f, LEAD_O = 0x56616c;

export const opusNotreDameOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the low aisles, then the tall nave above them under its steep lead roof
  ops.push(['box', 0.86, 0.32, 1.0, 0, 0.02, -0.06, LIME_DK_O]);
  ops.push(['box', 0.5, 0.6, 1.12, 0, 0.02, -0.06, LIME_O]);
  ops.push(['roof', 0.54, 0.3, 1.12, 0, 0.62, -0.06, LEAD_O, true]);
  // the transept across the crossing, its own roof
  ops.push(['box', 0.9, 0.6, 0.22, 0, 0.02, -0.1, LIME_O]);
  ops.push(['roof', 0.9, 0.3, 0.24, 0, 0.62, -0.1, LEAD_O, false]);
  // the rounded apse at the east end with its conical roof
  ops.push(['cyl', 0.25, 0.25, 0.6, 0, 0.02, -0.62, LIME_O, 12]);
  ops.push(['cone', 0.27, 0.3, 0, 0.62, -0.62, LEAD_O, 12]);
  // flying buttresses: piers standing off the aisles
  for (const sx of [-1, 1]) {
    for (const z of [0.28, 0.0, -0.28, -0.5]) {
      ops.push(['box', 0.05, 0.44, 0.06, sx * 0.455, 0.02, z, LIME_DK_O]);
    }
  }
  // the west front: the screen, the twin flat-topped towers, the rose and the three portals
  ops.push(['box', 0.9, 0.72, 0.2, 0, 0.02, 0.6, LIME_O]);
  ops.push(['box', 0.28, 1.18, 0.24, -0.31, 0.02, 0.6, LIME_O], ['box', 0.28, 1.18, 0.24, 0.31, 0.02, 0.6, LIME_O]);
  ops.push(['box', 0.3, 0.03, 0.26, -0.31, 1.2, 0.6, LIME_DK_O], ['box', 0.3, 0.03, 0.26, 0.31, 1.2, 0.6, LIME_DK_O]);
  ops.push(['box', 0.92, 0.04, 0.22, 0, 0.74, 0.6, LIME_DK_O]);
  ops.push(['box', 0.2, 0.2, 0.02, 0, 0.4, 0.71, 'navy']);
  ops.push(['box', 0.12, 0.2, 0.02, 0, 0.02, 0.71, 'charcoal']);
  ops.push(['box', 0.1, 0.17, 0.02, -0.31, 0.02, 0.73, 'charcoal'], ['box', 0.1, 0.17, 0.02, 0.31, 0.02, 0.73, 'charcoal']);
  // the flèche over the crossing: its drum, the needle and the cross
  ops.push(['cyl', 0.07, 0.07, 0.1, 0, 0.92, -0.1, LEAD_O, 8]);
  ops.push(['cone', 0.06, 0.6, 0, 1.02, -0.1, LEAD_O, 8]);
  ops.push(['cyl', 0.006, 0.006, 0.05, 0, 1.62, -0.1, 'gold', 4]);
  // the parvis: two trees
  ops.push(...tree(-0.84, 0.84, 0.6), ...tree(0.84, 0.84, 0.6));
  return ops;
};

// ================================================================= 136 the Louvre

const LSTONE_O = 0xd8cdb4, MANSARD_O = 0x4e5666, PYR_O = 0x9fc3cf;

export const opusLouvreOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the back wing and the two side wings of the Cour Napoléon, each under a mansard
  ops.push(['box', 1.92, 0.4, 0.3, 0, 0.02, -0.81, LSTONE_O]);
  ops.push(['taper', 1.92, 0.3, 1.8, 0.14, 0.14, 0, 0.42, -0.81, MANSARD_O]);
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.3, 0.4, 1.56, sx * 0.81, 0.02, 0.12, LSTONE_O]);
    ops.push(['taper', 0.3, 1.56, 0.14, 1.44, 0.14, sx * 0.81, 0.42, 0.12, MANSARD_O]);
  }
  // the corner pavilions, a storey higher under steep square roofs
  for (const sx of [-1, 1]) {
    for (const z of [-0.77, 0.75]) {
      ops.push(['box', 0.38, 0.48, 0.38, sx * 0.77, 0.02, z, LSTONE_O]);
      ops.push(['taper', 0.38, 0.38, 0.16, 0.16, 0.2, sx * 0.77, 0.5, z, MANSARD_O]);
    }
  }
  // the Pavillon de l'Horloge in the middle of the back wing, its tall domed roof
  ops.push(['box', 0.34, 0.6, 0.36, 0, 0.02, -0.79, LSTONE_O]);
  ops.push(['taper', 0.34, 0.36, 0.12, 0.12, 0.24, 0, 0.62, -0.79, MANSARD_O]);
  // the glass pyramid, its three small sisters and the basins round it
  ops.push(['box', 0.9, 0.01, 0.5, 0, 0.02, 0.12, 'pond']);
  ops.push(['taper', 0.42, 0.42, 0, 0, 0.27, 0, 0.03, 0.12, PYR_O]);
  ops.push(['taper', 0.1, 0.1, 0, 0, 0.07, -0.38, 0.02, 0.5, PYR_O], ['taper', 0.1, 0.1, 0, 0, 0.07, 0.38, 0.02, 0.5, PYR_O]);
  ops.push(['taper', 0.1, 0.1, 0, 0, 0.07, 0, 0.02, -0.38, PYR_O]);
  // the open side towards the Carrousel: lamps
  ops.push(...lampPost(-0.3, 0.82, 0.3, 'marquee', 0.02), ...lampPost(0.3, 0.82, 0.3, 'marquee', 0.02));
  return ops;
};

// ================================================================= 137 the Opéra Garnier

const GARNIER_O = 0xdcccab, GARNIER_DK_O = 0xc2af8c, COPPER_O = 0x5c9178;

export const opusOperaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the back administration block, the stage house and its gable with Apollo on the ridge's end
  ops.push(['box', 1.3, 0.5, 0.16, 0, 0.02, -0.88, GARNIER_DK_O]);
  ops.push(['box', 1.0, 0.86, 0.5, 0, 0.02, -0.55, GARNIER_DK_O]);
  ops.push(['roof', 1.0, 0.3, 0.5, 0, 0.88, -0.55, COPPER_O, true]);
  ops.push(['cone', 0.03, 0.1, 0, 1.18, -0.32, 'gold', 6]);
  // the auditorium under its low crowned copper dome
  ops.push(['box', 1.2, 0.62, 0.76, 0, 0.02, 0.1, GARNIER_O]);
  ops.push(['cyl', 0.36, 0.36, 0.08, 0, 0.64, 0.06, GARNIER_DK_O, 16]);
  ops.push(['lathe', 0, 0.72, 0.06, COPPER_O, [0.36, 0, 0.34, 0.06, 0.26, 0.13, 0.12, 0.18, 0, 0.2], { seg: 16 }]);
  ops.push(['cyl', 0.03, 0.04, 0.06, 0, 0.92, 0.06, 'gold', 8]);
  // the grand foyer front between its two end pavilions, each with a small green dome
  ops.push(['box', 1.4, 0.5, 0.5, 0, 0.02, 0.6, GARNIER_O]);
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.26, 0.6, 0.52, sx * 0.6, 0.02, 0.6, GARNIER_O]);
    ops.push(['lathe', sx * 0.6, 0.62, 0.6, COPPER_O, [0.1, 0, 0.09, 0.05, 0.05, 0.1, 0, 0.12], { seg: 10 }]);
    ops.push(['cone', 0.02, 0.06, sx * 0.6, 0.74, 0.6, 'gold', 5]);
  }
  // the loggia: the steps, the paired columns, the gilded entablature and attic
  ops.push(['box', 1.4, 0.12, 0.1, 0, 0.02, 0.9, GARNIER_DK_O]);
  for (let i = 0; i < 8; i++) {
    ops.push(['cyl', 0.025, 0.025, 0.28, -0.4 + i * (0.8 / 7), 0.14, 0.9, GARNIER_O, 8]);
  }
  ops.push(['box', 0.94, 0.06, 0.1, 0, 0.42, 0.9, 'gold']);
  ops.push(['box', 0.94, 0.06, 0.1, 0, 0.48, 0.9, GARNIER_O]);
  // the square: lamps
  ops.push(...lampPost(-0.82, 0.88, 0.3, 'marquee', 0.02), ...lampPost(0.82, 0.88, 0.3, 'marquee', 0.02));
  return ops;
};

// ================================================================= 138 the Sacré-Cœur

const CHALK_O = 0xf4f0e6, CHALK_DK_O = 0xe2dacb;

export const opusSacreCoeurOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the hilltop terrace and the flight of steps down to the square
  ops.push(['box', 1.7, 0.16, 1.3, 0, 0.02, -0.3, 'stone']);
  ops.push(['box', 0.9, 0.12, 0.1, 0, 0.02, 0.4, 'stone'], ['box', 0.9, 0.08, 0.1, 0, 0.02, 0.5, 'stone'], ['box', 0.9, 0.04, 0.1, 0, 0.02, 0.6, 'stone']);
  // the body of the basilica and the arched portico with its pediment
  ops.push(['box', 0.9, 0.42, 0.9, 0, 0.18, -0.35, CHALK_O]);
  ops.push(['box', 0.56, 0.36, 0.16, 0, 0.18, 0.18, CHALK_O]);
  ops.push(['box', 0.36, 0.2, 0.02, 0, 0.18, 0.27, CHALK_DK_O]);
  ops.push(['roof', 0.56, 0.12, 0.16, 0, 0.54, 0.18, CHALK_DK_O, true]);
  // the four lesser domes at the corners, each an ovoid on a drum
  for (const sx of [-1, 1]) {
    for (const z of [0.0, -0.66]) {
      ops.push(['cyl', 0.09, 0.09, 0.1, sx * 0.32, 0.6, z, CHALK_O, 10]);
      ops.push(['lathe', sx * 0.32, 0.7, z, CHALK_O, [0.09, 0, 0.09, 0.05, 0.06, 0.12, 0, 0.16], { seg: 10 }]);
      ops.push(['cone', 0.015, 0.05, sx * 0.32, 0.86, z, CHALK_DK_O, 5]);
    }
  }
  // the great dome: the colonnaded drum, its cornice, the tall ovoid, the lantern and the cross
  ops.push(['cyl', 0.24, 0.24, 0.22, 0, 0.6, -0.32, CHALK_O, 16]);
  ops.push(['cyl', 0.26, 0.26, 0.03, 0, 0.82, -0.32, CHALK_DK_O, 16]);
  ops.push(['lathe', 0, 0.85, -0.32, CHALK_O, [0.24, 0, 0.245, 0.08, 0.22, 0.18, 0.16, 0.28, 0.08, 0.34, 0, 0.36], { seg: 16 }]);
  ops.push(['cyl', 0.05, 0.05, 0.12, 0, 1.21, -0.32, CHALK_O, 8]);
  ops.push(['lathe', 0, 1.33, -0.32, CHALK_O, [0.06, 0, 0.04, 0.04, 0, 0.07], { seg: 8 }]);
  ops.push(['cyl', 0.008, 0.008, 0.08, 0, 1.4, -0.32, 'gold', 4]);
  // the campanile behind the choir with its domed belfry
  ops.push(['box', 0.2, 0.8, 0.2, 0, 0.18, -0.86, CHALK_O]);
  ops.push(['lathe', 0, 0.98, -0.86, CHALK_O, [0.1, 0, 0.1, 0.04, 0.08, 0.1, 0.03, 0.16, 0, 0.18], { seg: 10 }]);
  ops.push(['cone', 0.015, 0.06, 0, 1.16, -0.86, CHALK_DK_O, 5]);
  // the Square Louise-Michel: trees on the slopes either side of the steps
  ops.push(...tree(-0.75, 0.75, 0.6), ...tree(0.75, 0.75, 0.6));
  return ops;
};
