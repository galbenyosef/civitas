import type { Op } from './schema';
import { slab, tree, lampPost, PAVING } from './tierkit';

/**
 * Paris landmarks, the claude-haiku-5-5 designs (the comparison set for the kimi-2.8-preview designs in
 * landmarks-paris.ts). Same six buildings, same 2×2 plots, same scale (about 33 m to a tile), drawn from the
 * same ops. Drafts: they show in /compare.html and the viewer, and never change what the city places.
 */

// ================================================================= 133 the Eiffel Tower

const IRON_H = 0x6e5b48, IRON_LT_H = 0x7d6a55;

export const haikuEiffelOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // a stone plinth, then the tapering iron body rising to the summit
  ops.push(['box', 0.8, 0.04, 0.8, 0, 0.02, 0, 'stone']);
  ops.push(['taper', 0.7, 0.7, 0.18, 0.18, 3.6, 0, 0.06, 0, IRON_H]);
  // the two galleries, each a flat deck over the body
  ops.push(['box', 0.84, 0.1, 0.84, 0, 1.6, 0, IRON_LT_H]);
  ops.push(['box', 0.36, 0.08, 0.36, 0, 2.7, 0, IRON_LT_H]);
  // the upper shaft from the second gallery to the summit room
  ops.push(['taper', 0.32, 0.32, 0.1, 0.1, 1.0, 0, 2.74, 0, IRON_H]);
  ops.push(['cyl', 0.04, 0.06, 0.5, 0, 3.7, 0, IRON_LT_H, 8]);
  // the antenna and its red aircraft light
  ops.push(['cyl', 0.012, 0.012, 0.7, 0, 4.2, 0, 'steel', 6]);
  ops.push(['cyl', 0.03, 0.03, 0.05, 0, 4.9, 0, 'red', 6]);
  // the esplanade: lamps and two trees
  ops.push(...lampPost(-0.6, 0.8, 0.34, 'marquee', 0.02), ...lampPost(0.6, 0.8, 0.34, 'marquee', 0.02));
  ops.push(...tree(-0.82, -0.82, 0.6), ...tree(0.82, -0.82, 0.6));
  return ops;
};

// ================================================================= 134 the Arc de Triomphe

const STONE_H = 0xcfc5ae, STONE_DK_H = 0xbdb29a;

export const haikuArcOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the roundabout ring
  ops.push(['cyl', 0.8, 0.84, 0.01, 0, 0.02, 0, 'gravel', 24]);
  // two piers, the dark archway between them, and the attic on top
  ops.push(['box', 0.42, 0.77, 0.7, -0.44, 0.02, 0, STONE_H], ['box', 0.42, 0.77, 0.7, 0.44, 0.02, 0, STONE_H]);
  ops.push(['box', 0.46, 0.7, 0.5, 0, 0.02, 0, 0x2b2e36]);
  ops.push(['box', 1.3, 0.35, 0.7, 0, 0.79, 0, STONE_H]);
  // the cornice and the stepped roof
  ops.push(['box', 1.36, 0.06, 0.76, 0, 1.14, 0, STONE_DK_H]);
  ops.push(['box', 1.1, 0.06, 0.6, 0, 1.2, 0, STONE_H]);
  ops.push(['box', 0.7, 0.06, 0.4, 0, 1.26, 0, STONE_H]);
  // the eternal flame at the foot of the arch
  ops.push(['cyl', 0.03, 0.035, 0.02, 0, 0.02, 0.36, 'stone', 10]);
  ops.push(['cone', 0.025, 0.06, 0, 0.04, 0.36, 'marquee', 6]);
  // plane trees and lamps around the roundabout
  ops.push(...tree(-0.8, -0.8, 0.6), ...tree(0.8, -0.8, 0.6));
  ops.push(...lampPost(-0.55, 0.75, 0.32, 'marquee', 0.02), ...lampPost(0.55, 0.75, 0.32, 'marquee', 0.02));
  return ops;
};

// ================================================================= 135 Notre-Dame

const LIME_H = 0xc9c0a8, LEAD_H = 0x5a6570;

export const haikuNotreDameOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the nave under its pitched roof, the rounded apse behind
  ops.push(['box', 0.9, 0.5, 1.2, 0, 0.02, -0.1, LIME_H]);
  ops.push(['roof', 0.94, 0.2, 1.24, 0, 0.52, -0.1, 'slate', true]);
  ops.push(['cyl', 0.4, 0.4, 0.5, 0, 0.02, -0.55, LIME_H, 12]);
  // the west front with its two square towers and their spires
  ops.push(['box', 0.9, 0.6, 0.12, 0, 0.02, 0.56, LIME_H]);
  ops.push(['box', 0.26, 0.9, 0.26, -0.3, 0.02, 0.5, LIME_H], ['box', 0.26, 0.9, 0.26, 0.3, 0.02, 0.5, LIME_H]);
  ops.push(['cone', 0.17, 0.3, -0.3, 0.92, 0.5, 'slate', 8], ['cone', 0.17, 0.3, 0.3, 0.92, 0.5, 'slate', 8]);
  // the rose window and the three doors
  ops.push(['box', 0.2, 0.2, 0.02, 0, 0.3, 0.63, 'navy']);
  ops.push(['box', 0.12, 0.16, 0.02, 0, 0.02, 0.63, 0x3a3630]);
  ops.push(['box', 0.08, 0.14, 0.02, -0.2, 0.02, 0.63, 0x3a3630], ['box', 0.08, 0.14, 0.02, 0.2, 0.02, 0.63, 0x3a3630]);
  // the lead spire over the crossing, a gold cross at its tip
  ops.push(['taper', 0.14, 0.14, 0.02, 0.02, 0.6, 0, 0.6, -0.1, LEAD_H]);
  ops.push(['cone', 0.012, 0.04, 0, 1.2, -0.1, 'gold', 5]);
  // buttresses along the flanks
  for (const sx of [-1, 1]) {
    for (const z of [0.1, -0.3, -0.6]) {
      ops.push(['box', 0.06, 0.36, 0.06, sx * 0.5, 0.02, z, LIME_H]);
    }
  }
  // the parvis: lamps and two trees
  ops.push(...lampPost(-0.5, 0.9, 0.32, 'marquee', 0.02), ...lampPost(0.5, 0.9, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.82, 0.86, 0.6), ...tree(0.82, 0.86, 0.6));
  return ops;
};

// ================================================================= 136 the Louvre

const LSTONE_H = 0xd6cbb2, PYR_H = 0xbcd2c6;

export const haikuLouvreOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // three plain stone wings around the court, each under a slate roof
  ops.push(['box', 0.42, 0.5, 1.0, -0.7, 0.02, 0, LSTONE_H], ['box', 0.42, 0.5, 1.0, 0.7, 0.02, 0, LSTONE_H]);
  ops.push(['box', 1.0, 0.5, 0.4, 0, 0.02, -0.7, LSTONE_H]);
  ops.push(['roof', 0.46, 0.14, 1.02, -0.7, 0.52, 0, 'slate', true], ['roof', 0.46, 0.14, 1.02, 0.7, 0.52, 0, 'slate', true]);
  ops.push(['roof', 1.0, 0.14, 0.42, 0, 0.52, -0.7, 'slate', false]);
  // the glass pyramid in the court, with two fountain basins in front of it
  ops.push(['cone', 0.34, 0.4, 0, 0.02, -0.05, PYR_H, 4]);
  ops.push(['cyl', 0.1, 0.1, 0.02, -0.3, 0.02, 0.32, 'pond', 14], ['cyl', 0.1, 0.1, 0.02, 0.3, 0.02, 0.32, 'pond', 14]);
  // the street front: lamps and two trees
  ops.push(...lampPost(-0.4, 0.82, 0.32, 'marquee', 0.02), ...lampPost(0.4, 0.82, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.82, 0.82, 0.6), ...tree(0.82, 0.82, 0.6));
  return ops;
};

// ================================================================= 137 the Opéra Garnier

const OPERA_H = 0xd9c9a8, OPERA_DK_H = 0xc4b28e, VERDIGRIS_H = 0x5f8f6f;

export const haikuOperaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the auditorium block, its hipped roof and the stage house behind
  ops.push(['box', 1.4, 0.5, 0.7, 0, 0.02, 0.3, OPERA_H]);
  ops.push(['roof', 1.4, 0.14, 0.7, 0, 0.52, 0.3, OPERA_DK_H, false]);
  ops.push(['box', 1.0, 0.92, 0.9, 0, 0.02, -0.5, OPERA_DK_H]);
  ops.push(['box', 1.06, 0.05, 0.96, 0, 0.94, -0.5, OPERA_H]);
  // the colonnade on the street front, the gold entablature over it
  for (const x of [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]) {
    ops.push(['cyl', 0.03, 0.03, 0.4, x, 0.02, 0.72, OPERA_H, 8]);
  }
  ops.push(['box', 1.1, 0.05, 0.14, 0, 0.42, 0.72, 'gold']);
  ops.push(['box', 1.1, 0.06, 0.14, 0, 0.47, 0.72, OPERA_H]);
  // the green dome over the grand staircase at the corner, its gold finial
  ops.push(['cyl', 0.18, 0.19, 0.1, 0.45, 0.66, 0.35, OPERA_H, 10]);
  ops.push(['lathe', 0.45, 0.76, 0.35, VERDIGRIS_H, [0.2, 0, 0.19, 0.08, 0.13, 0.16, 0.06, 0.22, 0, 0.25], { seg: 12 }]);
  ops.push(['cyl', 0.006, 0.006, 0.08, 0.45, 1.01, 0.35, 'gold', 5]);
  // the square: lamps, flags and two trees
  ops.push(...lampPost(-0.55, 0.88, 0.32, 'marquee', 0.02), ...lampPost(0.55, 0.88, 0.32, 'marquee', 0.02));
  ops.push(...tree(-0.82, -0.82, 0.6), ...tree(0.82, -0.82, 0.6));
  return ops;
};

// ================================================================= 138 the Sacré-Cœur

const CHALK_H = 0xf2ede4, CHALK_DK_H = 0xe0d8c8;

export const haikuSacreCoeurOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the hilltop terrace and its three steps down towards the street
  ops.push(['box', 1.6, 0.14, 1.4, 0, 0.02, -0.1, 'stone']);
  ops.push(['box', 0.8, 0.04, 0.16, 0, 0.12, 0.68, 'stone'], ['box', 0.8, 0.04, 0.16, 0, 0.08, 0.76, 'stone'], ['box', 0.8, 0.04, 0.16, 0, 0.04, 0.84, 'stone']);
  // the basilica front and its gabled portico
  ops.push(['box', 0.9, 0.4, 0.7, 0, 0.16, -0.2, CHALK_H]);
  ops.push(['roof', 0.94, 0.16, 0.4, 0, 0.56, -0.05, CHALK_DK_H, false]);
  // the great dome on its drum over the crossing, the lantern and the cross
  ops.push(['cyl', 0.2, 0.22, 0.14, 0, 0.72, -0.2, CHALK_H, 12]);
  ops.push(['lathe', 0, 0.86, -0.2, CHALK_H, [0.22, 0, 0.22, 0.05, 0.18, 0.14, 0.1, 0.22, 0, 0.26], { seg: 12 }]);
  ops.push(['cyl', 0.05, 0.06, 0.08, 0, 1.12, -0.2, CHALK_H, 8]);
  ops.push(['cone', 0.02, 0.07, 0, 1.2, -0.2, 'gold', 6]);
  // the square bell tower with its own cap
  ops.push(['box', 0.2, 0.6, 0.2, 0.45, 0.16, 0, CHALK_H]);
  ops.push(['cone', 0.13, 0.2, 0.45, 0.76, 0, CHALK_DK_H, 8]);
  // the row of small domes along the choir
  for (const dx of [-0.3, 0, 0.3]) {
    ops.push(['lathe', dx, 0.16, -0.7, CHALK_H, [0.1, 0, 0.1, 0.02, 0.07, 0.06, 0.03, 0.09, 0, 0.11], { seg: 8 }]);
  }
  // the hilltop square: lamps and two trees
  ops.push(...lampPost(-0.5, 0.55, 0.3, 'marquee', 0.02), ...lampPost(0.5, 0.55, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.85, 0.85, 0.6), ...tree(0.85, 0.85, 0.6));
  return ops;
};
