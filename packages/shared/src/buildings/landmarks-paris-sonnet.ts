import type { Op } from './schema';
import { slab, tree, lampPost, PAVING } from './tierkit';

/**
 * Paris landmarks, the claude-sonnet-5-5 designs (a third set beside the kimi designs in landmarks-paris.ts and the
 * haiku designs in landmarks-paris-haiku.ts). Same six buildings, same 2×2 plots, same scale (about 33 m to a tile).
 * Drafts: they show in /compare.html and the viewer, and never change what the city places.
 */

// ================================================================= 133 the Eiffel Tower

const IRON_S = 0x6b5a49, IRON_LT_S = 0x85715a;

export const sonnetEiffelOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // four splayed legs, each leaning in towards the axis (the top face shifts inwards)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ops.push(['taper', 0.2, 0.2, 0.1, 0.1, 1.5, sx * 0.35, 0.02, sz * 0.35, IRON_S, { shift: [-sx * 0.17, -sz * 0.17] }]);
  }
  // the girder belts tying the legs together under the first gallery
  for (const sz of [-1, 1]) ops.push(['box', 0.5, 0.05, 0.05, 0, 0.7, sz * 0.27, IRON_LT_S]);
  for (const sx of [-1, 1]) ops.push(['box', 0.05, 0.05, 0.5, sx * 0.27, 0.7, 0, IRON_LT_S]);
  // the first gallery
  ops.push(['box', 0.74, 0.08, 0.74, 0, 1.5, 0, IRON_LT_S]);
  // the second stage: four slimmer legs closing in
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ops.push(['taper', 0.1, 0.1, 0.05, 0.05, 1.2, sx * 0.2, 1.58, sz * 0.2, IRON_S, { shift: [-sx * 0.1, -sz * 0.1] }]);
  }
  // the second gallery
  ops.push(['box', 0.34, 0.07, 0.34, 0, 2.78, 0, IRON_LT_S]);
  // the slender upper shaft, the summit cab, the antenna and its red light
  ops.push(['taper', 0.22, 0.22, 0.06, 0.06, 1.3, 0, 2.85, 0, IRON_S]);
  ops.push(['cyl', 0.07, 0.07, 0.15, 0, 4.15, 0, IRON_LT_S, 8]);
  ops.push(['cyl', 0.012, 0.012, 0.8, 0, 4.15, 0, 'steel', 6]);
  ops.push(['cyl', 0.025, 0.025, 0.04, 0, 4.9, 0, 'red', 6]);
  // the Champ de Mars: lamps and trees
  ops.push(...lampPost(-0.75, 0.8, 0.34, 'marquee', 0.02), ...lampPost(0.75, 0.8, 0.34, 'marquee', 0.02));
  ops.push(...tree(-0.85, -0.85, 0.6), ...tree(0.85, -0.85, 0.6), ...tree(-0.85, 0.2, 0.6), ...tree(0.85, 0.2, 0.6));
  return ops;
};

// ================================================================= 134 the Arc de Triomphe

const STONE_S = 0xd2c8b0, STONE_DK_S = 0xb8ad94, VOID_S = 0x2a2d35;

export const sonnetArcOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the Étoile roundabout
  ops.push(['cyl', 0.92, 0.95, 0.01, 0, 0.02, 0, 'gravel', 28]);
  // two massive piers and the great dark archway between them, a corbelled head above it
  ops.push(['box', 0.42, 0.8, 0.7, -0.45, 0.02, 0, STONE_S], ['box', 0.42, 0.8, 0.7, 0.45, 0.02, 0, STONE_S]);
  ops.push(['box', 0.48, 0.62, 0.72, 0, 0.02, 0, VOID_S]);
  ops.push(['taper', 0.48, 0.72, 0.3, 0.72, 0.1, 0, 0.64, 0, VOID_S]);
  // the four sculpture groups on the pier fronts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ops.push(['box', 0.26, 0.4, 0.04, sx * 0.45, 0.2, sz * 0.36, STONE_DK_S]);
  // the entablature, the attic with its frieze, the crowning cornice and the stepped top
  ops.push(['box', 1.32, 0.06, 0.74, 0, 0.82, 0, STONE_DK_S]);
  ops.push(['box', 1.3, 0.3, 0.7, 0, 0.88, 0, STONE_S]);
  for (const sz of [-1, 1]) ops.push(['box', 1.2, 0.08, 0.02, 0, 0.97, sz * 0.36, STONE_DK_S]);
  ops.push(['box', 1.38, 0.05, 0.78, 0, 1.18, 0, STONE_DK_S]);
  ops.push(['box', 1.2, 0.04, 0.6, 0, 1.23, 0, STONE_S]);
  // the eternal flame under the arch
  ops.push(['cyl', 0.05, 0.05, 0.02, 0, 0.02, 0.2, 'stone', 10]);
  ops.push(['cone', 0.025, 0.07, 0, 0.04, 0.2, 'marquee', 6]);
  // avenue lamps and plane trees
  ops.push(...lampPost(-0.6, 0.85, 0.32, 'marquee', 0.02), ...lampPost(0.6, 0.85, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.85, -0.85, 0.6), ...tree(0.85, -0.85, 0.6));
  return ops;
};

// ================================================================= 135 Notre-Dame

const LIME_S = 0xc6bca4, LEAD_S = 0x56626d, DARK_S = 0x38342f;

export const sonnetNotreDameOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the high nave with its lower aisles and their lean-to roofs
  ops.push(['box', 0.5, 0.45, 1.1, 0, 0.02, 0, LIME_S]);
  ops.push(['roof', 0.54, 0.2, 1.1, 0, 0.47, 0, 'slate', true]);
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.18, 0.26, 1.1, sx * 0.34, 0.02, 0, LIME_S]);
    ops.push(['roof', 0.2, 0.08, 1.1, sx * 0.34, 0.28, 0, 'slate', true]);
  }
  // the transept and the rounded apse with its conical roof
  ops.push(['box', 1.0, 0.4, 0.3, 0, 0.02, -0.2, LIME_S]);
  ops.push(['roof', 1.0, 0.16, 0.3, 0, 0.42, -0.2, 'slate', false]);
  ops.push(['cyl', 0.26, 0.26, 0.45, 0, 0.02, -0.55, LIME_S, 12]);
  ops.push(['cone', 0.28, 0.16, 0, 0.47, -0.55, 'slate', 12]);
  // the flying buttresses: piers out in the garden, each tied back to the clerestory by an arm
  for (const sx of [-1, 1]) for (const z of [0.3, 0.05, -0.5]) {
    ops.push(['box', 0.05, 0.3, 0.05, sx * 0.52, 0.02, z, LIME_S]);
    ops.push(['box', 0.12, 0.04, 0.04, sx * 0.46, 0.36, z, LIME_S]);
  }
  // the west front: the gallery of kings, rose window and the three portals
  ops.push(['box', 0.86, 0.7, 0.16, 0, 0.02, 0.5, LIME_S]);
  ops.push(['box', 0.86, 0.03, 0.18, 0, 0.6, 0.5, 0x9c9480]);
  ops.push(['box', 0.16, 0.16, 0.02, 0, 0.36, 0.585, 'navy']);
  ops.push(['box', 0.1, 0.16, 0.02, 0, 0.02, 0.585, DARK_S]);
  ops.push(['box', 0.08, 0.13, 0.02, -0.25, 0.02, 0.585, DARK_S], ['box', 0.08, 0.13, 0.02, 0.25, 0.02, 0.585, DARK_S]);
  // the two square flat-topped towers with their louvred belfries
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.28, 0.95, 0.28, sx * 0.29, 0.02, 0.46, LIME_S]);
    ops.push(['box', 0.3, 0.04, 0.3, sx * 0.29, 0.97, 0.46, 0x9c9480]);
    ops.push(['box', 0.1, 0.24, 0.02, sx * 0.29, 0.66, 0.605, DARK_S]);
  }
  // the slender lead flèche over the crossing, a gold cross at its tip
  ops.push(['taper', 0.1, 0.1, 0.02, 0.02, 0.5, 0, 0.6, -0.2, LEAD_S]);
  ops.push(['cone', 0.03, 0.15, 0, 1.1, -0.2, LEAD_S, 8]);
  ops.push(['cone', 0.012, 0.06, 0, 1.25, -0.2, 'gold', 5]);
  // the parvis
  ops.push(...lampPost(-0.55, 0.9, 0.32, 'marquee', 0.02), ...lampPost(0.55, 0.9, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.85, 0.8, 0.6), ...tree(0.85, 0.8, 0.6));
  return ops;
};

// ================================================================= 136 the Louvre

const LSTONE_S = 0xd4c9b0, GLASS_S = 0xbcd2c6;

export const sonnetLouvreOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the long side wings and the back wing round the Cour Napoléon, under mansard roofs
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.36, 0.42, 1.5, sx * 0.7, 0.02, 0, LSTONE_S]);
    ops.push(['taper', 0.38, 1.52, 0.28, 1.42, 0.14, sx * 0.7, 0.44, 0, 'slate']);
  }
  ops.push(['box', 1.4, 0.42, 0.3, 0, 0.02, -0.8, LSTONE_S]);
  ops.push(['taper', 1.42, 0.32, 1.3, 0.22, 0.14, 0, 0.44, -0.8, 'slate']);
  // the tall central pavilion at the back, and the end pavilions on the street side, each with its own roof
  ops.push(['box', 0.5, 0.55, 0.34, 0, 0.02, -0.8, LSTONE_S]);
  ops.push(['taper', 0.52, 0.36, 0.2, 0.1, 0.2, 0, 0.57, -0.8, 'slate']);
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.42, 0.52, 0.3, sx * 0.7, 0.02, 0.7, LSTONE_S]);
    ops.push(['taper', 0.44, 0.32, 0.18, 0.12, 0.18, sx * 0.7, 0.54, 0.7, 'slate']);
  }
  // Pei's glass pyramid with its three small satellites, and two fountain basins
  ops.push(['taper', 0.5, 0.5, 0, 0, 0.34, 0, 0.02, 0.0, GLASS_S]);
  for (const [x, z] of [[-0.38, 0.2], [0.38, 0.2], [0, 0.45]]) ops.push(['taper', 0.12, 0.12, 0, 0, 0.08, x, 0.02, z, GLASS_S]);
  ops.push(['cyl', 0.1, 0.1, 0.02, -0.3, 0.02, -0.4, 'pond', 14], ['cyl', 0.1, 0.1, 0.02, 0.3, 0.02, -0.4, 'pond', 14]);
  ops.push(...lampPost(-0.2, 0.9, 0.32, 'marquee', 0.02), ...lampPost(0.2, 0.9, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.9, 0.9, 0.6), ...tree(0.9, 0.9, 0.6));
  return ops;
};

// ================================================================= 137 the Opéra Garnier

const OPERA_S = 0xdacaa6, OPERA_DK_S = 0xc2b08a, VERD_S = 0x5d8d6d;

export const sonnetOperaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the broad front block between two pavilions, the grand steps before it
  ops.push(['box', 1.1, 0.62, 0.6, 0, 0.02, 0.3, OPERA_S]);
  ops.push(['box', 0.26, 0.7, 0.64, -0.68, 0.02, 0.3, OPERA_DK_S], ['box', 0.26, 0.7, 0.64, 0.68, 0.02, 0.3, OPERA_DK_S]);
  ops.push(['box', 1.5, 0.06, 0.3, 0, 0.02, 0.82, OPERA_DK_S]);
  // the arcade: tall columns, the entablature, then the loggia's short columns and the gold frieze
  for (let i = 0; i < 8; i++) ops.push(['cyl', 0.028, 0.03, 0.3, -0.49 + i * 0.14, 0.08, 0.78, OPERA_S, 8]);
  ops.push(['box', 1.1, 0.06, 0.2, 0, 0.38, 0.74, OPERA_S]);
  for (let i = 0; i < 8; i++) ops.push(['cyl', 0.022, 0.024, 0.16, -0.49 + i * 0.14, 0.44, 0.7, OPERA_S, 8]);
  ops.push(['box', 1.1, 0.04, 0.18, 0, 0.6, 0.7, 'gold']);
  ops.push(['box', 1.14, 0.08, 0.64, 0, 0.64, 0.3, OPERA_DK_S]);
  // the gilded groups on the pavilion tops
  for (const sx of [-1, 1]) ops.push(['cone', 0.04, 0.1, sx * 0.68, 0.72, 0.3, 'gold', 6]);
  // the great cupola: drum, verdigris dome, lantern and gold Apollo
  ops.push(['cyl', 0.34, 0.36, 0.14, 0, 0.72, 0.0, OPERA_S, 14]);
  ops.push(['lathe', 0, 0.8, 0, VERD_S, [0.34, 0, 0.32, 0.05, 0.26, 0.12, 0.14, 0.2, 0, 0.26], { seg: 14 }]);
  ops.push(['cyl', 0.03, 0.04, 0.08, 0, 1.06, 0, 'gold', 6]);
  ops.push(['cone', 0.018, 0.1, 0, 1.14, 0, 'gold', 5]);
  // the stage house behind, under its own pediment
  ops.push(['box', 0.9, 0.85, 0.6, 0, 0.02, -0.5, OPERA_DK_S]);
  ops.push(['roof', 0.94, 0.14, 0.64, 0, 0.87, -0.5, VERD_S, false]);
  ops.push(...lampPost(-0.5, 0.97, 0.32, 'marquee', 0.02), ...lampPost(0.5, 0.97, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.88, -0.85, 0.6), ...tree(0.88, -0.85, 0.6));
  return ops;
};

// ================================================================= 138 the Sacré-Cœur

const CHALK_S = 0xf3eee6, CHALK_DK_S = 0xe2dacb;

export const sonnetSacreCoeurOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the Montmartre terrace and the steps down
  ops.push(['box', 1.7, 0.14, 1.6, 0, 0.02, 0, 'stone']);
  ops.push(['box', 0.8, 0.1, 0.08, 0, 0.02, 0.84, 'stone'], ['box', 0.8, 0.07, 0.08, 0, 0.02, 0.9, 'stone'], ['box', 0.8, 0.04, 0.08, 0, 0.02, 0.95, 'stone']);
  // the body of the basilica and its three-arched portico under a pediment
  ops.push(['box', 0.9, 0.4, 0.8, 0, 0.16, -0.1, CHALK_S]);
  ops.push(['box', 0.8, 0.22, 0.14, 0, 0.16, 0.36, CHALK_S]);
  ops.push(['roof', 0.84, 0.12, 0.16, 0, 0.38, 0.36, CHALK_DK_S, false]);
  for (const x of [-0.26, 0, 0.26]) ops.push(['box', 0.1, 0.16, 0.02, x, 0.16, 0.435, 0x4a463f]);
  // the great ovoid dome on its drum, the lantern, the cap and the cross
  ops.push(['cyl', 0.2, 0.21, 0.18, 0, 0.56, -0.1, CHALK_S, 14]);
  ops.push(['lathe', 0, 0.74, -0.1, CHALK_S, [0.2, 0, 0.2, 0.03, 0.17, 0.12, 0.11, 0.22, 0.05, 0.31, 0, 0.35], { seg: 14 }]);
  ops.push(['cyl', 0.045, 0.05, 0.12, 0, 1.09, -0.1, CHALK_DK_S, 8]);
  ops.push(['cone', 0.045, 0.1, 0, 1.21, -0.1, CHALK_S, 8]);
  ops.push(['cone', 0.012, 0.06, 0, 1.31, -0.1, 'gold', 5]);
  // the four lesser domes round the crossing
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ops.push(['lathe', sx * 0.32, 0.56, -0.1 + sz * 0.3, CHALK_S, [0.09, 0, 0.09, 0.03, 0.06, 0.09, 0, 0.14], { seg: 8 }]);
  }
  // the square campanile behind, topped by a tapering cap
  ops.push(['box', 0.2, 0.55, 0.2, -0.32, 0.16, -0.6, CHALK_S]);
  ops.push(['taper', 0.22, 0.22, 0.08, 0.08, 0.14, -0.32, 0.71, -0.6, CHALK_DK_S]);
  ops.push(...lampPost(-0.55, 0.6, 0.3, 'marquee', 0.02), ...lampPost(0.55, 0.6, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.88, 0.88, 0.6), ...tree(0.88, 0.88, 0.6));
  return ops;
};
