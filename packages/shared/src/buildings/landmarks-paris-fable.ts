import type { Op, Color } from './schema';
import { repeat } from './helpers';
import { slab, tree, lampPost, PAVING, ASPHALT } from './tierkit';

/**
 * Paris landmarks, the claude-fable-5-1 designs (a comparison set beside kimi's originals in landmarks-paris.ts and
 * the Haiku, Sonnet and Opus sets). Same six buildings, same 2×2 plots, same scale (about 33 m to a tile). Plain
 * walls only: no window grids, so the engine's lighting is never fought. Drafts: they show in /compare.html and the
 * viewer, and never change what the city places.
 *
 * The eye behind the set: each building is drawn from the one thing a far thumbnail must say (the arch under the
 * Eiffel Tower's legs, the round head of the Arc's opening, the fan of flyers round Notre-Dame's chevet, the tall
 * pavilion roofs of the Louvre, the twin rotundas of the Opéra, the ovoid domes of the Sacré-Cœur on its embankment),
 * with the real proportions between the parts kept and the metres compressed.
 */

/** A sloping bar from (x0, y0, z0) to (x1, y1, z1), t thick: a horizontal box, or a taper leaning to its far end. */
const bar = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, c: Color): Op => {
  if (Math.abs(y1 - y0) < 0.012) return ['box', Math.abs(x1 - x0) + t, t, Math.abs(z1 - z0) + t, (x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2, c];
  const [xl, yl, zl, xh, yh, zh] = y0 < y1 ? [x0, y0, z0, x1, y1, z1] : [x1, y1, z1, x0, y0, z0];
  return ['taper', t, t, t, t, yh - yl, xl, yl, zl, c, { shift: [xh - xl, zh - zl] }];
};

/** A flat round disc on a wall facing +z (or +x), r across, poking `t` out of the wall at (x, y, z). */
const disc = (x: number, y: number, z: number, r: number, t: number, c: Color, facing: 'z' | 'x' = 'z', seg = 20): Op =>
  ['lathe', x, y, z, c, [r, 0, r, t], { seg, axis: facing }];

// ================================================================= 133 the Eiffel Tower

// painted in three shades, darkest at the feet and lightest at the top, as the real tower is (so it reads evenly against the sky)
const IRON_LO = 0x5a4334, IRON_MID = 0x6c5342, IRON_HI = 0x7f6650, IRON_LACE = 0x8d7560;

export const fableEiffelOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the gravel cross of the Champ de Mars under the tower
  ops.push(['box', 1.9, 0.006, 0.56, 0, 0.02, 0, 'gravel'], ['box', 0.56, 0.006, 1.9, 0, 0.02, 0, 'gravel']);
  // four stone feet, and the legs in two bends so the outline curves: a steep splay at the foot easing to the first floor
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      ops.push(['box', 0.34, 0.08, 0.34, sx * 0.7, 0.02, sz * 0.7, 'stone']);
      ops.push(['taper', 0.26, 0.26, 0.2, 0.2, 0.5, sx * 0.7, 0.1, sz * 0.7, IRON_LO, { shift: [-sx * 0.14, -sz * 0.14] }]);
      ops.push(['taper', 0.2, 0.2, 0.15, 0.15, 0.4, sx * 0.56, 0.6, sz * 0.56, IRON_MID, { shift: [-sx * 0.11, -sz * 0.11] }]);
    }
  }
  // the great arches between the feet under the first floor, one on each face: six bars tracing a half-circle
  const arc = [180, 150, 120, 90, 60, 30, 0].map((a) => [0.5 * Math.cos((a * Math.PI) / 180), 0.48 + 0.5 * Math.sin((a * Math.PI) / 180)]);
  for (let i = 0; i < arc.length - 1; i++) {
    const [u0, y0] = arc[i], [u1, y1] = arc[i + 1];
    for (const s of [-1, 1]) {
      ops.push(bar(u0, y0, s * 0.56, u1, y1, s * 0.56, 0.035, IRON_LACE));
      ops.push(bar(s * 0.56, y0, u0, s * 0.56, y1, u1, 0.035, IRON_LACE));
    }
  }
  // the first floor and its lighter gallery rim
  ops.push(['box', 1.1, 0.1, 1.1, 0, 1.0, 0, IRON_MID]);
  ops.push(['box', 1.14, 0.03, 1.14, 0, 1.1, 0, IRON_LACE]);
  // the second stage: four slimmer legs still apart, a girder belt between them, closing to the second floor
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      ops.push(['taper', 0.15, 0.15, 0.1, 0.1, 0.77, sx * 0.45, 1.13, sz * 0.45, IRON_MID, { shift: [-sx * 0.21, -sz * 0.21] }]);
    }
  }
  for (const s of [-1, 1]) {
    ops.push(['box', 0.74, 0.03, 0.03, 0, 1.5, s * 0.35, IRON_LACE], ['box', 0.03, 0.03, 0.74, s * 0.35, 1.5, 0, IRON_LACE]);
  }
  ops.push(['box', 0.6, 0.08, 0.6, 0, 1.9, 0, IRON_HI]);
  // the single tapering shaft to the summit, the top floor, the cab, the antenna and its red light
  ops.push(['taper', 0.5, 0.5, 0.14, 0.14, 2.3, 0, 1.98, 0, IRON_HI]);
  ops.push(['box', 0.24, 0.1, 0.24, 0, 4.28, 0, IRON_LACE]);
  ops.push(['cyl', 0.08, 0.09, 0.14, 0, 4.38, 0, IRON_HI, 8]);
  ops.push(['cyl', 0.012, 0.02, 0.5, 0, 4.52, 0, 'steel', 6]);
  ops.push(['cyl', 0.025, 0.025, 0.04, 0, 5.02, 0, 'red', 6]);
  // the Champ de Mars: plane trees at the back corners, lamps at the front
  ops.push(...tree(-0.88, -0.88, 0.55), ...tree(0.88, -0.88, 0.55));
  ops.push(...lampPost(-0.85, 0.88, 0.3, 'marquee', 0.02), ...lampPost(0.85, 0.88, 0.3, 'marquee', 0.02));
  return ops;
};

// ================================================================= 134 the Arc de Triomphe

const ARC_F = 0xd9cdb3, ARC_CARVED_F = 0xbfb297, VOID_F = 0x2e2a27, AVENUE_F = 0xb8b1a3;

export const fableArcOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, ASPHALT)];
  // the paved Étoile with its twelve avenues drawn through the centre as six lines, a flat sheared bar for each diagonal
  ops.push(['cyl', 0.95, 0.95, 0.008, 0, 0.02, 0, PAVING, 32]);
  for (const deg of [0, 30, 60, 90, 120, 150]) {
    const a = (deg * Math.PI) / 180, dx = 1.86 * Math.cos(a), dz = 1.86 * Math.sin(a);
    if (deg === 0) ops.push(['box', 1.86, 0.004, 0.03, 0, 0.028, 0, AVENUE_F]);
    else if (deg === 90) ops.push(['box', 0.03, 0.004, 1.86, 0, 0.028, 0, AVENUE_F]);
    else ops.push(['taper', 0.03, 0.03, 0.03, 0.03, 0.004, -dx / 2, 0.028, -dz / 2, AVENUE_F, { shift: [dx, dz] }]);
  }
  // the true proportions: 45 wide, 22 deep, 50 tall; the opening 15 wide and 29 to its crown
  // the two piers, the dark opening between them and the round head of the vault, a cylinder laid through the depth
  ops.push(['box', 0.46, 0.66, 0.66, -0.45, 0.03, 0, ARC_F], ['box', 0.46, 0.66, 0.66, 0.45, 0.03, 0, ARC_F]);
  ops.push(['box', 0.44, 0.69, 0.68, 0, 0.03, 0, VOID_F]);
  ops.push(['lathe', 0, 0.69, -0.34, VOID_F, [0.22, 0, 0.22, 0.68], { seg: 20, axis: 'z' }]);
  // the lesser arches through the piers on the two sides
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.02, 0.5, 0.25, sx * 0.685, 0.03, 0, VOID_F]);
    ops.push(['lathe', sx > 0 ? 0.675 : -0.695, 0.53, 0, VOID_F, [0.125, 0, 0.125, 0.02], { seg: 12, axis: 'x' }]);
  }
  // the four sculpted groups on the pier faces
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ops.push(['box', 0.22, 0.3, 0.02, sx * 0.45, 0.2, sz * 0.335, ARC_CARVED_F]);
  // the block over the vault, the battle frieze, the cornice, the attic with its band of shields, the top
  ops.push(['box', 1.36, 0.33, 0.66, 0, 0.69, 0, ARC_F]);
  ops.push(['box', 1.37, 0.12, 0.67, 0, 1.02, 0, ARC_CARVED_F]);
  ops.push(['box', 1.44, 0.06, 0.74, 0, 1.14, 0, ARC_F]);
  ops.push(['box', 1.3, 0.26, 0.6, 0, 1.2, 0, ARC_F]);
  ops.push(['box', 1.31, 0.08, 0.61, 0, 1.34, 0, ARC_CARVED_F]);
  ops.push(['box', 1.36, 0.04, 0.66, 0, 1.46, 0, ARC_F]);
  // the tomb of the unknown soldier and its flame, under the vault towards the Champs-Élysées
  ops.push(['box', 0.1, 0.02, 0.14, 0, 0.03, 0.2, 'charcoal']);
  ops.push(['cone', 0.02, 0.05, 0, 0.05, 0.2, 'marquee', 6]);
  // the avenues' plane trees at the plot corners, lamps on the island
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ops.push(...tree(sx * 0.9, sz * 0.9, 0.5));
  ops.push(...lampPost(-0.62, 0.62, 0.3, 'marquee', 0.028), ...lampPost(0.62, 0.62, 0.3, 'marquee', 0.028));
  return ops;
};

// ================================================================= 135 Notre-Dame

const LIME_F = 0xcfc6ad, LIME_DK_F = 0xb6ab8f, LEAD_F = 0x5b6670, ROSE_F = 0x34457f, PORTAL_F = 0x33302b;

export const fableNotreDameOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the proportions of the real plan: 128 long, 48 wide, towers 69, spire 96, compressed to the plot as one piece
  // the high nave between its double aisles, the lead roof over the nave and the flat lead over the aisles
  ops.push(['box', 0.76, 0.3, 1.26, 0, 0.02, -0.03, LIME_DK_F]);
  ops.push(['box', 0.78, 0.02, 1.28, 0, 0.32, -0.03, LEAD_F]);
  ops.push(['box', 0.34, 0.5, 1.26, 0, 0.02, -0.03, LIME_F]);
  ops.push(['roof', 0.38, 0.2, 1.26, 0, 0.52, -0.03, LEAD_F, true]);
  // the transept across the crossing, its gables each with a rose
  ops.push(['box', 0.82, 0.5, 0.22, 0, 0.02, -0.15, LIME_F]);
  ops.push(['roof', 0.82, 0.2, 0.24, 0, 0.52, -0.15, LEAD_F, false]);
  ops.push(disc(0.41, 0.3, -0.15, 0.075, 0.012, ROSE_F, 'x', 16), disc(-0.422, 0.3, -0.15, 0.075, 0.012, ROSE_F, 'x', 16));
  // the chevet: the round ambulatory, the choir's apse rising from it under a lead cone
  ops.push(['cyl', 0.32, 0.32, 0.3, 0, 0.02, -0.66, LIME_DK_F, 16]);
  ops.push(['cyl', 0.15, 0.15, 0.5, 0, 0.02, -0.66, LIME_F, 12]);
  ops.push(['cone', 0.17, 0.22, 0, 0.52, -0.66, LEAD_F, 12]);
  // the flying buttresses: a fan of single flyers round the chevet, and three a side along the nave
  for (const deg of [200, 240, 270, 300, 340]) {
    const a = (deg * Math.PI) / 180, px = 0.29 * Math.cos(a), pz = -0.66 + 0.29 * Math.sin(a);
    ops.push(['box', 0.04, 0.22, 0.04, px, 0.32, pz, LIME_F]);
    ops.push(bar(px, 0.54, pz, 0.15 * Math.cos(a), 0.62, -0.66 + 0.15 * Math.sin(a), 0.03, LIME_F));
  }
  for (const sx of [-1, 1]) {
    for (const z of [0.3, -0.42]) {
      ops.push(['box', 0.04, 0.22, 0.05, sx * 0.37, 0.32, z, LIME_F]);
      ops.push(bar(sx * 0.37, 0.54, z, sx * 0.19, 0.62, z, 0.03, LIME_F));
    }
  }
  // the west front: the screen between the towers, the gallery of kings, the rose, the three portals
  ops.push(['box', 0.78, 0.72, 0.32, 0, 0.02, 0.76, LIME_F]);
  ops.push(['box', 0.78, 0.04, 0.015, 0, 0.3, 0.925, LIME_DK_F]);
  ops.push(disc(0, 0.46, 0.92, 0.105, 0.008, LIME_DK_F), disc(0, 0.46, 0.92, 0.085, 0.014, ROSE_F));
  ops.push(['box', 0.12, 0.24, 0.012, 0, 0.02, 0.92, PORTAL_F]);
  ops.push(['box', 0.09, 0.2, 0.012, -0.25, 0.02, 0.92, PORTAL_F], ['box', 0.09, 0.2, 0.012, 0.25, 0.02, 0.92, PORTAL_F]);
  // the twin flat-topped towers with their tall belfry openings, the open colonnade between them
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.28, 1.0, 0.32, sx * 0.25, 0.02, 0.76, LIME_F]);
    ops.push(['box', 0.3, 0.03, 0.34, sx * 0.25, 1.02, 0.76, LIME_DK_F]);
    ops.push(['box', 0.08, 0.2, 0.012, sx * 0.25, 0.78, 0.92, PORTAL_F]);
    ops.push(['box', 0.012, 0.2, 0.08, sx * 0.39, 0.78, 0.76, PORTAL_F]);
  }
  ops.push(...repeat(5, (i): Op => ['cyl', 0.012, 0.012, 0.12, -0.1 + i * 0.05, 0.74, 0.88, LIME_F, 6]));
  ops.push(['box', 0.22, 0.03, 0.1, 0, 0.86, 0.88, LIME_DK_F]);
  // the flèche over the crossing: lead, octagonal, drawn as tall as the real one against the towers
  ops.push(['lathe', 0, 0.72, -0.15, LEAD_F, [0.08, 0, 0.07, 0.1, 0.04, 0.25, 0.015, 0.6, 0, 0.72], { seg: 8 }]);
  ops.push(['cone', 0.01, 0.06, 0, 1.44, -0.15, 'gold', 5]);
  // the parvis and the garden along the south flank
  ops.push(...lampPost(-0.45, 0.92, 0.3, 'marquee', 0.02), ...lampPost(0.45, 0.92, 0.3, 'marquee', 0.02));
  ops.push(...tree(0.8, 0.3, 0.5), ...tree(0.8, -0.3, 0.5), ...tree(-0.8, 0.0, 0.5), ...tree(-0.82, 0.82, 0.55));
  return ops;
};

// ================================================================= 136 the Louvre

const LSTONE_F = 0xdbd0b8, LSTONE_DK_F = 0xc6b99c, SLATE_F = 0x4a5261, GLASS_F = 0xb7cfd6;

/** A Louvre pavilion: a square block a storey above the wing under a steep slate roof with a finial. */
const pavilion = (x: number, z: number, w: number, d: number, h: number, roofH: number): Op[] => [
  ['box', w, h, d, x, 0.02, z, LSTONE_F],
  ['taper', w + 0.02, d + 0.02, w * 0.32, d * 0.32, roofH, x, 0.02 + h, z, SLATE_F],
  ['cyl', 0.01, 0.014, 0.05, x, 0.02 + h + roofH, z, 'gold', 5],
];

export const fableLouvreOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the Sully wing closing the court at the back, the Richelieu and Denon wings down the sides, under mansards
  ops.push(['box', 1.9, 0.42, 0.36, 0, 0.02, -0.78, LSTONE_F]);
  ops.push(['taper', 1.9, 0.36, 1.78, 0.2, 0.14, 0, 0.44, -0.78, SLATE_F]);
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.36, 0.42, 1.5, sx * 0.76, 0.02, -0.03, LSTONE_F]);
    ops.push(['taper', 0.36, 1.5, 0.2, 1.38, 0.14, sx * 0.76, 0.44, -0.03, SLATE_F]);
    // the three pavilions of each side wing: by Sully, the taller one in the middle, and at the street end
    ops.push(...pavilion(sx * 0.76, -0.63, 0.4, 0.3, 0.5, 0.2));
    ops.push(...pavilion(sx * 0.76, -0.03, 0.42, 0.32, 0.56, 0.24));
    ops.push(...pavilion(sx * 0.76, 0.57, 0.4, 0.3, 0.5, 0.2));
  }
  // the Pavillon de l'Horloge in the middle of Sully under its square bulbous dome
  ops.push(['box', 0.42, 0.56, 0.42, 0, 0.02, -0.78, LSTONE_F]);
  ops.push(['taper', 0.44, 0.44, 0.34, 0.34, 0.1, 0, 0.58, -0.78, SLATE_F]);
  ops.push(['taper', 0.34, 0.34, 0.1, 0.1, 0.16, 0, 0.68, -0.78, SLATE_F]);
  ops.push(['cyl', 0.012, 0.016, 0.06, 0, 0.84, -0.78, 'gold', 5]);
  // the stone string courses on the wings (the ground floor is plain; the piano nobile band above it)
  ops.push(['box', 1.92, 0.02, 0.38, 0, 0.22, -0.78, LSTONE_DK_F]);
  for (const sx of [-1, 1]) ops.push(['box', 0.38, 0.02, 1.52, sx * 0.76, 0.22, -0.03, LSTONE_DK_F]);
  // the court: the glass pyramid in the real ratio (height 0.62 of the base), its three small sisters, the basins
  ops.push(['taper', 0.6, 0.6, 0, 0, 0.37, 0, 0.02, 0.1, GLASS_F]);
  for (const [x, z] of [[-0.42, 0.1], [0.42, 0.1], [0, 0.5]]) ops.push(['taper', 0.14, 0.14, 0, 0, 0.09, x, 0.02, z, GLASS_F]);
  for (const sx of [-1, 1]) for (const z of [-0.2, 0.4]) ops.push(['box', 0.24, 0.012, 0.2, sx * 0.42, 0.02, z, 'pond']);
  // the Arc du Carrousel at the open end of the court, a small triumphal arch with its gilt quadriga
  ops.push(['box', 0.08, 0.16, 0.08, -0.11, 0.02, 0.86, LSTONE_F], ['box', 0.08, 0.16, 0.08, 0.11, 0.02, 0.86, LSTONE_F]);
  ops.push(['box', 0.32, 0.06, 0.1, 0, 0.18, 0.86, LSTONE_F]);
  ops.push(['box', 0.1, 0.04, 0.06, 0, 0.24, 0.86, 'gold']);
  // the Carrousel garden's trees and the lamps of the court
  ops.push(...tree(-0.85, 0.88, 0.45), ...tree(0.85, 0.88, 0.45));
  ops.push(...lampPost(-0.4, 0.88, 0.26, 'marquee', 0.02), ...lampPost(0.4, 0.88, 0.26, 'marquee', 0.02));
  return ops;
};

// ================================================================= 137 the Opéra Garnier

const OPERA_F = 0xdccdad, OPERA_DK_F = 0xc3b08c, COPPER_F = 0x5e9178;

export const fableOperaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the loggia front on the square: the arcade of seven arches, the paired columns above, the gilt entablature, the attic
  ops.push(['box', 1.3, 0.52, 0.4, 0, 0.02, 0.7, OPERA_F]);
  ops.push(...repeat(7, (i): Op => ['box', 0.1, 0.17, 0.012, -0.45 + i * 0.15, 0.04, 0.9, 0x3a352f]));
  ops.push(...repeat(8, (i): Op => ['cyl', 0.02, 0.02, 0.22, -0.49 + i * 0.14, 0.24, 0.88, OPERA_F, 8]));
  ops.push(['box', 1.3, 0.04, 0.03, 0, 0.46, 0.905, 'gold']);
  ops.push(['box', 1.32, 0.1, 0.42, 0, 0.54, 0.7, OPERA_DK_F]);
  // the gilded groups, Harmony and Poetry, at the ends of the attic
  ops.push(['cone', 0.04, 0.1, -0.55, 0.64, 0.7, 'gold', 6], ['cone', 0.04, 0.1, 0.55, 0.64, 0.7, 'gold', 6]);
  // the two rotundas on the flanks: the Emperor's pavilion and the subscribers', each under a copper cap
  for (const sx of [-1, 1]) {
    ops.push(['cyl', 0.2, 0.2, 0.5, sx * 0.75, 0.02, 0.1, OPERA_F, 16]);
    ops.push(['lathe', sx * 0.75, 0.52, 0.1, COPPER_F, [0.22, 0, 0.18, 0.05, 0.08, 0.12, 0, 0.14], { seg: 16 }]);
  }
  // the auditorium block and the low wide copper dome on its drum, the gilt crown-lantern on top
  ops.push(['box', 1.3, 0.6, 0.9, 0, 0.02, 0.05, OPERA_F]);
  ops.push(['cyl', 0.32, 0.32, 0.08, 0, 0.62, -0.05, OPERA_DK_F, 20]);
  ops.push(['lathe', 0, 0.7, -0.05, COPPER_F, [0.34, 0, 0.33, 0.04, 0.27, 0.1, 0.16, 0.15, 0.06, 0.18, 0, 0.19], { seg: 20 }]);
  ops.push(['cyl', 0.03, 0.035, 0.05, 0, 0.89, -0.05, 'gold', 8]);
  ops.push(['cone', 0.018, 0.06, 0, 0.94, -0.05, 'gold', 6]);
  // the stage house behind, taller than the dome, its stone pediment facing the square and Apollo at the ridge's end
  ops.push(['box', 1.0, 0.95, 0.5, 0, 0.02, -0.65, OPERA_DK_F]);
  ops.push(['roof', 1.0, 0.22, 0.06, 0, 0.97, -0.43, OPERA_F, true]);
  ops.push(['roof', 1.0, 0.22, 0.44, 0, 0.97, -0.68, COPPER_F, true]);
  ops.push(['cone', 0.03, 0.1, 0, 1.19, -0.43, 'gold', 6]);
  // the square: the lamps and trees of the boulevard behind
  ops.push(...lampPost(-0.5, 0.94, 0.3, 'marquee', 0.02), ...lampPost(0.5, 0.94, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.86, -0.86, 0.5), ...tree(0.86, -0.86, 0.5));
  return ops;
};

// ================================================================= 138 the Sacré-Cœur

const CHALK_F = 0xf3f0e8, CHALK_DK_F = 0xdfd9cb, TERRACE_F = 0xd6d1c4;

/** A Romano-Byzantine ovoid dome with a finial, on the drum below it at (x, y, z); r is the drum's radius. */
const ovoid = (x: number, y: number, z: number, r: number, h: number): Op[] => [
  ['lathe', x, y, z, CHALK_F, [r, 0, r * 1.05, h * 0.2, r * 0.9, h * 0.48, r * 0.55, h * 0.72, r * 0.22, h * 0.9, 0, h], { seg: 14 }],
  ['cone', r * 0.14, h * 0.2, x, y + h, z, CHALK_DK_F, 5],
];

export const fableSacreCoeurOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the terrace of the butte, the grass embankment falling to the street and the stair cut down the middle of it
  ops.push(['box', 1.4, 0.16, 1.3, 0, 0.02, -0.3, TERRACE_F]);
  ops.push(['taper', 1.4, 0.5, 1.4, 0.2, 0.12, 0, 0.02, 0.6, 'lawnDark', { shift: [0, -0.15] }]);
  ops.push(...repeat(5, (i): Op => ['box', 0.4, 0.04, 0.12, 0, 0.14 - i * 0.035, 0.42 + i * 0.12, TERRACE_F]));
  // the nave on the terrace, the crossing block wider than it, the portico with its three arches and gable
  ops.push(['box', 0.5, 0.42, 0.9, 0, 0.18, -0.3, CHALK_F]);
  ops.push(['box', 0.8, 0.42, 0.5, 0, 0.18, -0.35, CHALK_F]);
  ops.push(['box', 0.6, 0.3, 0.14, 0, 0.18, 0.21, CHALK_F]);
  for (const x of [-0.18, 0, 0.18]) ops.push(['box', 0.1, 0.18, 0.012, x, 0.2, 0.28, 0x4a463f]);
  ops.push(['roof', 0.6, 0.1, 0.14, 0, 0.48, 0.21, CHALK_DK_F, true]);
  // the two equestrian bronzes on the portico's corners
  ops.push(['box', 0.04, 0.06, 0.08, -0.24, 0.48, 0.21, 0x4f5a4a], ['box', 0.04, 0.06, 0.08, 0.24, 0.48, 0.21, 0x4f5a4a]);
  // the four lesser domes at the corners of the crossing
  for (const sx of [-1, 1]) for (const z of [-0.15, -0.55]) {
    ops.push(['cyl', 0.09, 0.09, 0.08, sx * 0.28, 0.6, z, CHALK_F, 12]);
    ops.push(...ovoid(sx * 0.28, 0.68, z, 0.09, 0.21));
  }
  // the great dome: the arcaded drum (a dark ring behind twelve piers), the tall ovoid, the lantern and the cross
  ops.push(['cyl', 0.24, 0.24, 0.2, 0, 0.6, -0.35, CHALK_F, 20]);
  ops.push(['cyl', 0.245, 0.245, 0.08, 0, 0.68, -0.35, 0x5a564f, 20]);
  ops.push(...repeat(12, (i): Op => {
    const a = (i / 12) * Math.PI * 2;
    return ['cyl', 0.016, 0.016, 0.08, Math.sin(a) * 0.245, 0.68, -0.35 + Math.cos(a) * 0.245, CHALK_F, 6];
  }));
  ops.push(['cyl', 0.26, 0.26, 0.03, 0, 0.8, -0.35, CHALK_DK_F, 20]);
  ops.push(['lathe', 0, 0.83, -0.35, CHALK_F, [0.25, 0, 0.26, 0.06, 0.24, 0.14, 0.19, 0.24, 0.12, 0.32, 0.06, 0.37, 0, 0.39], { seg: 20 }]);
  ops.push(['cyl', 0.05, 0.05, 0.1, 0, 1.22, -0.35, CHALK_F, 8]);
  ops.push(['lathe', 0, 1.32, -0.35, CHALK_F, [0.06, 0, 0.045, 0.03, 0, 0.06], { seg: 8 }]);
  ops.push(['cyl', 0.008, 0.008, 0.08, 0, 1.38, -0.35, 'gold', 4]);
  // the campanile behind the apse, as tall as the dome, its belfry openings and its own small dome
  ops.push(['box', 0.2, 0.9, 0.2, 0, 0.18, -0.78, CHALK_F]);
  ops.push(['box', 0.08, 0.16, 0.012, 0, 0.86, -0.68, 0x4a463f], ['box', 0.08, 0.16, 0.012, 0, 0.86, -0.88, 0x4a463f]);
  ops.push(['box', 0.012, 0.16, 0.08, -0.1, 0.86, -0.78, 0x4a463f], ['box', 0.012, 0.16, 0.08, 0.1, 0.86, -0.78, 0x4a463f]);
  ops.push(...ovoid(0, 1.08, -0.78, 0.11, 0.2));
  // the Square Louise-Michel: trees on the slopes either side of the stair, lamps at the foot
  ops.push(...tree(-0.6, 0.72, 0.45), ...tree(0.6, 0.72, 0.45), ...tree(-0.85, 0.3, 0.45), ...tree(0.85, 0.3, 0.45));
  ops.push(...lampPost(-0.3, 0.92, 0.26, 'marquee', 0.02), ...lampPost(0.3, 0.92, 0.26, 'marquee', 0.02));
  return ops;
};
