import type { Op, Color } from './schema';
import { repeat } from './helpers';
import { slab, tree, lampPost, flags, PAVING, ASPHALT } from './tierkit';

/**
 * New York landmarks, the claude-fable-5-1 designs (a comparison set beside kimi's originals in
 * landmarks-new-york.ts). Same eight buildings, same plots and roles, same scale (about 33 m to a tile). Office
 * towers carry the engine's window grid by facade or by a `win` class on a taper or lathe; monuments are plain.
 * Drafts: they show in /compare.html and the viewer, and never change what the city places.
 *
 * The eye behind the set: the Empire State as a slab, narrow to Fifth Avenue and long down the block; the Chrysler
 * in pale brick with the dark bands of its crown; Liberty with a pedestal as tall as the figure on a star fort;
 * One World Trade Center as a square prism twisted a quarter turn (one lathe); the Brooklyn Bridge with its twin
 * Gothic arches, four cables and the fan of stays over water; the Flatiron as a true triangular prism; 30 Rock
 * behind the Channel Gardens and the sunken rink; Radio City's marquee and sign blades wrapping the corner.
 */

/** A sloping bar from (x0, y0, z0) to (x1, y1, z1), t thick: a horizontal box, or a taper leaning to its far end. */
const bar = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, c: Color): Op => {
  if (Math.abs(y1 - y0) < 0.012) return ['box', Math.abs(x1 - x0) + t, t, Math.abs(z1 - z0) + t, (x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2, c];
  const [xl, yl, zl, xh, yh, zh] = y0 < y1 ? [x0, y0, z0, x1, y1, z1] : [x1, y1, z1, x0, y0, z0];
  return ['taper', t, t, t, t, yh - yl, xl, yl, zl, c, { shift: [xh - xl, zh - zl] }];
};

// ================================================================= 121 the Empire State Building

const ESB_F = 0xd6c9a8, ESB_CROWN_F = 0xd9d6cf, ESB_TRIM_F = 0x8e949c;

export const fableEmpireStateOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the five-storey base filling the block, its door on Fifth Avenue
  ops.push(['box', 2.5, 0.45, 2.5, 0, 0.02, 0, ESB_F, 'office', { name: 'base', facade: { storeys: 2, bays: 7, sideBays: 7, margin: 0.1, ground: 'door', top: 0.05 } }]);
  ops.push(['porch', 'base', 'front', 2, 4, ESB_TRIM_F], ['cornice', 'base', 2, ESB_TRIM_F]);
  // the slab: narrow to the avenue, long down the block, rising in four setbacks that keep that shape
  ops.push(['box', 2.0, 1.3, 2.2, 0, 0.47, 0, ESB_F, 'office', { name: 'lower', facade: { storeys: 5, bays: 6, sideBays: 7, margin: 0.08 } }]);
  ops.push(['cornice', 'lower', 5, ESB_TRIM_F]);
  ops.push(['box', 1.3, 2.6, 1.7, 0, 1.77, 0, ESB_F, 'office', { name: 'shaft', facade: { storeys: 10, bays: 4, sideBays: 5, margin: 0.08 } }]);
  ops.push(['cornice', 'shaft', 10, ESB_TRIM_F]);
  ops.push(['box', 1.0, 0.55, 1.35, 0, 4.37, 0, ESB_F, 'office', { name: 'upper', facade: { storeys: 2, bays: 3, sideBays: 4, margin: 0.06 } }]);
  ops.push(['box', 0.76, 0.3, 1.0, 0, 4.92, 0, ESB_CROWN_F, 'office', { name: 'deck', facade: { storeys: 1, bays: 2, sideBays: 3, margin: 0.06 } }]);
  // the art-deco crown over the observation deck, the round mooring mast with its glass cab, the antenna and its light
  ops.push(['taper', 0.6, 0.6, 0.4, 0.4, 0.22, 0, 5.22, 0, ESB_CROWN_F]);
  ops.push(['cyl', 0.2, 0.22, 0.5, 0, 5.44, 0, 'silver', 10]);
  ops.push(['cyl', 0.14, 0.16, 0.16, 0, 5.94, 0, 'glass', 10]);
  ops.push(['cyl', 0.02, 0.04, 0.45, 0, 6.1, 0, 'steel', 6]);
  ops.push(['cyl', 0.035, 0.035, 0.05, 0, 6.55, 0, 'red', 6]);
  // the pavement on Fifth Avenue: flagpoles, lamps and street trees
  ops.push(...flags(-0.6, 1.4, 4, 0.4, ['navy', 'white', 'red'], 0.02));
  ops.push(...lampPost(-1.3, 1.42, 0.36, 'marquee', 0.02), ...lampPost(1.3, 1.42, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.35, -1.35, 0.6), ...tree(1.35, -1.35, 0.6));
  return ops;
};

// ================================================================= 122 the Chrysler Building

const CHRY_F = 0xcdc6b9, CHRY_DK_F = 0xb5aca0, CHROME_F = 0xdfe3e8, CROWN_BAND_F = 0x2f3540;

export const fableChryslerOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the pale glazed-brick shaft: a base, a mid block and the tower, each inset from the one below
  ops.push(['box', 2.4, 0.45, 2.4, 0, 0.02, 0, CHRY_DK_F, 'office', { name: 'base', facade: { storeys: 2, bays: 7, sideBays: 7, margin: 0.1, ground: 'door', top: 0.05 } }]);
  ops.push(['porch', 'base', 'front', 2, 4, CHROME_F], ['cornice', 'base', 2, CHRY_DK_F]);
  ops.push(['box', 2.0, 0.9, 2.0, 0, 0.47, 0, CHRY_F, 'office', { name: 'mid', facade: { storeys: 4, bays: 6, sideBays: 6, margin: 0.08 } }]);
  ops.push(['cornice', 'mid', 4, CHRY_DK_F]);
  ops.push(['box', 1.5, 2.0, 1.5, 0, 1.37, 0, CHRY_F, 'office', { name: 'shaft', facade: { storeys: 8, bays: 5, sideBays: 5, margin: 0.08 } }]);
  // the 61st-floor setback with the steel eagles jutting from its corners
  ops.push(['box', 1.3, 0.4, 1.3, 0, 3.37, 0, CHRY_F, 'office', { name: 'eagles', facade: { storeys: 2, bays: 4, sideBays: 4, margin: 0.08 } }]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ops.push(['box', 0.1, 0.05, 0.06, sx * 0.68, 3.71, sz * 0.6, CHROME_F], ['box', 0.06, 0.05, 0.1, sx * 0.6, 3.71, sz * 0.68, CHROME_F]);
  }
  // the crown: seven shrinking chrome tiers, each with the dark band of its triangular windows, then the needle
  const widths = [1.2, 1.0, 0.82, 0.66, 0.52, 0.4, 0.3, 0.2], heights = [0.2, 0.18, 0.16, 0.14, 0.12, 0.1, 0.09];
  let y = 3.77;
  for (let i = 0; i < 7; i++) {
    ops.push(['box', widths[i] + 0.004, heights[i] * 0.4, widths[i] + 0.004, 0, y, 0, CROWN_BAND_F]);
    ops.push(['taper', widths[i], widths[i], widths[i + 1], widths[i + 1], heights[i], 0, y, 0, CHROME_F]);
    y += heights[i];
  }
  ops.push(['cyl', 0.03, 0.06, 0.1, 0, y, 0, CHROME_F, 8]);
  ops.push(['cyl', 0.01, 0.025, 0.5, 0, y + 0.1, 0, 'steel', 6]);
  // the avenue: lamps and trees
  ops.push(...lampPost(-1.3, 1.42, 0.36, 'marquee', 0.02), ...lampPost(1.3, 1.42, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.35, -1.35, 0.6), ...tree(1.35, -1.35, 0.6), ...tree(-1.35, 1.3, 0.55));
  return ops;
};

// ================================================================= 123 the Statue of Liberty

const FORT_F = 0xc3b9a4, GRANITE_F = 0xb4a894, COPPER_F = 0x6fb09c, COPPER_DK_F = 0x5a9a86;

export const fableStatueOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'pond')];
  // Liberty Island: a stone quay round a lawn, the ferry landing at the front corner and a boat alongside
  ops.push(['box', 1.74, 0.05, 1.54, 0, 0, -0.05, 'stone']);
  ops.push(['box', 1.62, 0.012, 1.42, 0, 0.05, -0.05, 'lawn']);
  ops.push(['box', 0.5, 0.04, 0.24, 0.5, 0, 0.84, 'stone']);
  ops.push(['box', 0.1, 0.04, 0.26, 0.9, 0.02, 0.87, 'white'], ['box', 0.07, 0.04, 0.12, 0.9, 0.06, 0.85, 'glassDark']);
  // Fort Wood: two stepped stars, each a square crossed with a diamond (a four-sided lathe)
  ops.push(['box', 0.9, 0.1, 0.9, 0, 0.062, -0.05, FORT_F], ['lathe', 0, 0.062, -0.05, FORT_F, [0.6, 0, 0.6, 0.1], { seg: 4 }]);
  ops.push(['box', 0.7, 0.08, 0.7, 0, 0.162, -0.05, FORT_F], ['lathe', 0, 0.162, -0.05, FORT_F, [0.47, 0, 0.47, 0.08], { seg: 4 }]);
  // the pedestal, as tall as the figure: its plinth, the tapering granite shaft, the loggia and the balcony
  ops.push(['box', 0.5, 0.12, 0.5, 0, 0.242, -0.05, GRANITE_F]);
  ops.push(['taper', 0.44, 0.44, 0.36, 0.36, 0.5, 0, 0.362, -0.05, GRANITE_F]);
  ops.push(['box', 0.4, 0.1, 0.4, 0, 0.862, -0.05, FORT_F]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ops.push(['box', 0.06, 0.1, 0.012, sx * 0.1, 0.862, -0.05 + sz * 0.2, 0x4a4640]);
  ops.push(['box', 0.44, 0.03, 0.44, 0, 0.962, -0.05, GRANITE_F]);
  // the figure: the robe flaring to its hem, the head and crown of seven rays, the raised arm and torch, the tablet
  ops.push(['lathe', 0, 0.992, -0.05, COPPER_F, [0.16, 0, 0.17, 0.04, 0.15, 0.14, 0.12, 0.3, 0.1, 0.42, 0.08, 0.5, 0, 0.52], { seg: 14 }]);
  ops.push(['lathe', 0, 1.492, -0.05, COPPER_F, [0.05, 0, 0.055, 0.03, 0.045, 0.07, 0, 0.1], { seg: 10 }]);
  for (let i = 0; i < 7; i++) {
    const a = ((i + 0.5) / 7) * Math.PI * 2;
    ops.push(['cone', 0.01, 0.07, Math.sin(a) * 0.055, 1.552, -0.05 + Math.cos(a) * 0.055, COPPER_DK_F, 4]);
  }
  ops.push(['taper', 0.05, 0.05, 0.04, 0.04, 0.3, 0.1, 1.4, -0.05, COPPER_F, { shift: [0.12, 0] }]);
  ops.push(['cyl', 0.025, 0.025, 0.08, 0.22, 1.7, -0.05, 'gold', 8]);
  ops.push(['cone', 0.035, 0.08, 0.22, 1.78, -0.05, 'marquee', 8]);
  ops.push(['taper', 0.035, 0.035, 0.035, 0.035, 0.16, -0.12, 1.2, -0.03, COPPER_F, { shift: [-0.06, 0.06] }]);
  ops.push(['box', 0.1, 0.16, 0.03, -0.18, 1.3, 0.05, COPPER_DK_F]);
  // the island's trees and the colours over the fort
  ops.push(...tree(-0.7, 0.55, 0.6), ...tree(0.65, -0.65, 0.6), ...tree(-0.7, -0.6, 0.55));
  ops.push(...flags(-0.33, 0.28, 2, 0.66, ['navy', 'red'], 0.242));
  return ops;
};

// ================================================================= 124 One World Trade Center

const WTC_GLASS_F = 0xa7c0d2, WTC_PODIUM_F = 0xc4ccd3;

export const fableOneWorldOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the tall podium with its lobby on the plaza
  ops.push(['box', 2.6, 0.55, 2.6, 0, 0.02, 0, WTC_PODIUM_F, 'office', { name: 'podium', facade: { storeys: 2, bays: 8, sideBays: 8, margin: 0.1, ground: 'door', top: 0.08 } }]);
  // the shaft: one square prism turned a quarter turn between its foot and its crown, so each face splits into the
  // two long triangles of the real tower; a lathe of four facets, twisted 45 degrees over its height, lit as offices
  ops.push(['lathe', 0, 0.57, 0, WTC_GLASS_F, [1.3, 0, 0.95, 4.9], { seg: 4, twist: 45 / 4.9, win: 'office' }]);
  // the flat crown, its parapet and plant, then the spire with its beacon
  ops.push(['box', 1.36, 0.06, 1.36, 0, 5.47, 0, 'dark']);
  ops.push(['box', 1.0, 0.08, 1.0, 0, 5.53, 0, WTC_PODIUM_F]);
  ops.push(['cyl', 0.06, 0.1, 0.6, 0, 5.61, 0, 'steel', 8]);
  ops.push(['cyl', 0.015, 0.04, 0.75, 0, 6.21, 0, 'steel', 6]);
  ops.push(['cyl', 0.03, 0.03, 0.04, 0, 6.96, 0, 'red', 6]);
  // the memorial plaza's oaks and the lamps on the street
  ops.push(...tree(-1.38, 1.38, 0.55), ...tree(1.38, 1.38, 0.55), ...tree(-1.38, -1.38, 0.55), ...tree(1.38, -1.38, 0.55));
  ops.push(...lampPost(-0.6, 1.44, 0.36, 'marquee', 0.02), ...lampPost(0.6, 1.44, 0.36, 'marquee', 0.02));
  return ops;
};

// ================================================================= 125 the Brooklyn Bridge

const BB_GRANITE_F = 0xcfc3ab, BB_DK_F = 0xa89c84, CABLE_F = 0x7d838c, VOID_BB_F = 0x2b2a28, WALK_F = 0x9a7a52;

export const fableBrooklynOps = (): Op[] => {
  const D = 0.4; // the road deck's top
  const ops: Op[] = [slab(1, 4, 'pond')];
  // the anchorages on the two banks, the ramp down to the street at the door end, the road deck and the raised promenade
  ops.push(['box', 0.46, D, 0.3, 0, 0, -1.82, BB_DK_F], ['box', 0.46, D, 0.3, 0, 0, 1.58, BB_DK_F]);
  ops.push(['taper', 0.46, 0.28, 0.46, 0.04, D + 0.03, 0, 0, 1.86, ASPHALT, { shift: [0, -0.12] }]);
  ops.push(['box', 0.46, 0.03, 3.69, 0, D, -0.125, ASPHALT]);
  ops.push(['box', 0.14, 0.06, 3.69, 0, D + 0.03, -0.125, WALK_F]);
  for (const side of [-1, 1]) {
    const Z = side * 0.85;
    // the pier in the river, the three legs of the tower, the twin Gothic openings with their pointed heads, the block above
    ops.push(['box', 0.48, D, 0.44, 0, 0, Z, BB_DK_F]);
    ops.push(['box', 0.1, 1.35, 0.36, -0.2, D, Z, BB_GRANITE_F], ['box', 0.06, 1.35, 0.36, 0, D, Z, BB_GRANITE_F], ['box', 0.1, 1.35, 0.36, 0.2, D, Z, BB_GRANITE_F]);
    for (const sx of [-1, 1]) {
      ops.push(['box', 0.12, 0.5, 0.38, sx * 0.09, 0.8, Z, VOID_BB_F]);
      ops.push(['taper', 0.12, 0.38, 0, 0.38, 0.1, sx * 0.09, 1.3, Z, VOID_BB_F]);
    }
    ops.push(['box', 0.46, 0.45, 0.36, 0, 1.3, Z, BB_GRANITE_F]);
    ops.push(['box', 0.5, 0.04, 0.4, 0, 1.75, Z, BB_DK_F]);
    // the main cables over the saddles: the side span down to the anchorage, the main span sagging to mid-river
    for (const sx of [-1, 1]) {
      const x = sx * 0.2;
      const sidePts = [[Z, 1.79], [side * 1.1, 1.3], [side * 1.35, 0.8], [side * 1.6, D]];
      for (let i = 0; i < sidePts.length - 1; i++) ops.push(bar(x, sidePts[i][1], sidePts[i][0], x, sidePts[i + 1][1], sidePts[i + 1][0], 0.02, CABLE_F));
      const sag = (z: number) => 0.55 + 1.24 * (z / 0.85) ** 2;
      const n = 4;
      for (let i = 0; i < n; i++) {
        const z0 = side * (0.85 - (0.85 * i) / n), z1 = side * (0.85 - (0.85 * (i + 1)) / n);
        ops.push(bar(x, sag(z0), z0, x, sag(z1), z1, 0.02, CABLE_F));
      }
      // the hangers from the deck to the cable, and the fan of diagonal stays from the tower top
      for (const zz of [0.2, 0.42, 0.64]) ops.push(['box', 0.012, sag(zz) - D - 0.03, 0.012, x, D + 0.03, side * zz, CABLE_F]);
      for (const zz of [0.3, 0.55]) {
        ops.push(bar(x, 1.74, Z, x, D + 0.03, Z - side * zz, 0.012, CABLE_F));
        ops.push(bar(x, 1.74, Z, x, D + 0.03, Z + side * zz, 0.012, CABLE_F));
      }
    }
  }
  ops.push(['box', 0.012, 0.12, 0.012, -0.2, D + 0.03, 0, CABLE_F], ['box', 0.012, 0.12, 0.012, 0.2, D + 0.03, 0, CABLE_F]);
  return ops;
};

// ================================================================= 126 the Flatiron Building

const FLAT_F = 0xdfd3b8, FLAT_DK_F = 0xc9b998, FLAT_TERRA_F = 0xb8775a;

/** The wedge plan: a three-sided prism with its prow on the avenue and a block behind, as one `tri` call per course. */
const wedge = (r: number, y: number, h: number, c: Color, win?: 'office', facade?: { storeys: number; bays: number }): Op[] => {
  const w = r * Math.sqrt(3), back = -0.5 * r, d = 1.45 + back;
  return [
    ['lathe', 0, y, 0, c, [r, 0, r, h], win ? { seg: 3, win } : { seg: 3 }],
    facade
      ? ['box', w, h, d, 0, y, back - d / 2, c, 'office', { name: `b${y}`.replace('.', '_'), facade: { ...facade, sideBays: 3, margin: 0.07 } }]
      : ['box', w, h, d, 0, y, back - d / 2, c],
  ];
};

export const fableFlatironOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the rusticated base, the twenty-storey shaft in limestone with the office grid on every face, the cornice and attic
  ops.push(...wedge(0.8, 0.02, 0.45, FLAT_DK_F));
  ops.push(...wedge(0.76, 0.47, 1.6, FLAT_F, 'office', { storeys: 6, bays: 4 }));
  ops.push(...wedge(0.8, 2.07, 0.05, FLAT_DK_F));
  ops.push(...wedge(0.74, 2.12, 0.15, FLAT_F));
  ops.push(...wedge(0.76, 2.27, 0.03, FLAT_DK_F));
  ops.push(['box', 1.36, 0.012, 0.02, 0, 2.07, -1.46, FLAT_TERRA_F]);
  // the shopfronts round the base and the penthouse on the roof
  ops.push(...repeat(3, (i): Op => ['box', 0.14, 0.2, 0.012, -0.45 + i * 0.45, 0.04, -1.448, 0x3a352f]));
  ops.push(['box', 0.3, 0.08, 0.3, 0, 2.3, -0.9, FLAT_DK_F]);
  // the two avenues' kerbs: lamps and trees in the small park at the prow
  ops.push(...lampPost(-0.5, 1.4, 0.36, 'marquee', 0.02), ...lampPost(0.5, 1.4, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.3, 1.2, 0.6), ...tree(1.3, 1.2, 0.6), ...tree(-1.3, -1.3, 0.55), ...tree(1.3, -1.3, 0.55));
  return ops;
};

// ================================================================= 127 Rockefeller Center

const ROCK_F = 0xd9cfae, ROCK_DK_F = 0xc4b894;

export const fableRockefellerOps = (): Op[] => {
  const ops: Op[] = [slab(4, 4, PAVING)];
  // the Channel Gardens between two low blocks on Fifth Avenue: the pools and hedges down the middle
  for (const sx of [-1, 1]) {
    ops.push(['box', 1.0, 0.5, 0.9, sx * 0.9, 0.02, 1.45, ROCK_F, 'office', { name: sx < 0 ? 'maison' : 'british', facade: { storeys: 2, bays: 3, sideBays: 3, margin: 0.08, ground: 'plain' } }]);
    ops.push(['cornice', sx < 0 ? 'maison' : 'british', 2, ROCK_DK_F]);
  }
  ops.push(['box', 0.7, 0.01, 0.9, 0, 0.02, 1.45, 'lawn']);
  for (const z of [1.15, 1.45, 1.75]) ops.push(['box', 0.2, 0.014, 0.14, 0, 0.03, z, 'pond']);
  for (const sx of [-1, 1]) ops.push(['box', 0.06, 0.05, 0.86, sx * 0.3, 0.03, 1.45, 'hedge']);
  // the sunken plaza: a raised surround with the pale rink below it, Prometheus gilded at its head, flags on three sides
  ops.push(['box', 1.7, 0.06, 0.25, 0, 0.02, 0.125, ROCK_DK_F], ['box', 1.7, 0.06, 0.15, 0, 0.02, 0.925, ROCK_DK_F]);
  for (const sx of [-1, 1]) ops.push(['box', 0.3, 0.06, 1.0, sx * 0.7, 0.02, 0.5, ROCK_DK_F]);
  ops.push(['box', 1.1, 0.012, 0.6, 0, 0.02, 0.55, 'white']);
  ops.push(['taper', 0.06, 0.06, 0.02, 0.02, 0.12, 0, 0.032, 0.3, 'gold']);
  ops.push(...flags(-0.75, 0.05, 7, 0.25, ['navy', 'white', 'red', 'yellow', 'green'], 0.08));
  for (const sx of [-1, 1]) ops.push(...repeat(3, (i): Op => ['flag', sx * 0.8, 0.08, 0.3 + i * 0.25, (['red', 'navy', 'white'] as Color[])[i]]));
  // 30 Rock: a slab long along the street and thin across it, its blank ends stepped down in two wings a side
  ops.push(['box', 3.9, 0.5, 1.4, 0, 0.02, -0.8, ROCK_F, 'office', { name: 'base', facade: { storeys: 2, bays: 12, sideBays: 4, margin: 0.1, ground: 'door', top: 0.05 } }]);
  ops.push(['cornice', 'base', 2, ROCK_DK_F]);
  ops.push(['box', 2.0, 2.9, 0.8, 0, 0.52, -0.9, ROCK_F, 'office', { name: 'slab', facade: { storeys: 11, bays: 6, sideBays: 0, margin: 0.08 } }]);
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.5, 2.0, 0.8, sx * 1.25, 0.52, -0.9, ROCK_F, 'office', { name: sx < 0 ? 'wingW' : 'wingE', facade: { storeys: 8, bays: 2, sideBays: 0, margin: 0.05 } }]);
    ops.push(['box', 0.4, 1.1, 0.8, sx * 1.7, 0.52, -0.9, ROCK_F, 'office', { name: sx < 0 ? 'wingW2' : 'wingE2', facade: { storeys: 4, bays: 1, sideBays: 3, margin: 0.05 } }]);
  }
  ops.push(['box', 2.04, 0.05, 0.84, 0, 3.42, -0.9, ROCK_DK_F]);
  // the street trees behind and the lamps on the avenue
  ops.push(...tree(-1.6, -1.78, 0.55), ...tree(1.6, -1.78, 0.55));
  ops.push(...lampPost(-1.85, 1.9, 0.36, 'marquee', 0.02), ...lampPost(1.85, 1.9, 0.36, 'marquee', 0.02));
  return ops;
};

// ================================================================= 128 Radio City Music Hall

const RADIO_F = 0xe2d4b6, RADIO_DK_F = 0xcdbd9c, NEON_F = 0xd8463c;

export const fableRadioCityOps = (): Op[] => {
  const ops: Op[] = [slab(4, 3, PAVING)];
  // the limestone block of the hall, windowless above its marquee, and the stage house rising at the back
  ops.push(['box', 3.6, 0.7, 1.9, 0, 0.02, -0.3, RADIO_F]);
  ops.push(['box', 2.0, 1.0, 0.5, -0.5, 0.02, -1.1, RADIO_DK_F]);
  // the fluted pilasters over the marquee on the street front
  ops.push(...repeat(5, (i): Op => ['box', 0.06, 0.34, 0.02, -1.4 + i * 0.7, 0.36, 0.66, RADIO_DK_F]));
  // the marquee wrapping the corner: a dark canopy on both streets with a lit fascia (a sign, so it comes on at its own dusk)
  ops.push(['box', 3.4, 0.04, 0.3, 0.1, 0.3, 0.8, 'charcoal']);
  ops.push(['box', 3.42, 0.08, 0.02, 0.1, 0.34, 0.95, 'marquee', 'sign']);
  ops.push(['box', 0.18, 0.04, 1.2, 1.89, 0.3, 0.1, 'charcoal']);
  ops.push(['box', 0.02, 0.08, 1.2, 1.97, 0.34, 0.1, 'marquee', 'sign']);
  ops.push(...repeat(11, (i): Op => ['box', 0.05, 0.02, 0.012, -1.5 + i * 0.32, 0.42, 0.955, 'yellow']));
  // the two vertical neon blades at the corner, one to each street
  ops.push(['box', 0.06, 0.5, 0.16, 1.75, 0.38, 0.72, NEON_F, 'sign']);
  ops.push(['box', 0.16, 0.5, 0.06, 1.87, 0.38, 0.55, NEON_F, 'sign']);
  // the doors under the marquee on both streets, and the queue rail
  ops.push(...repeat(6, (i): Op => ['box', 0.14, 0.2, 0.012, -1.2 + i * 0.4, 0.04, 0.655, 0x3a352f]));
  ops.push(...repeat(3, (i): Op => ['box', 0.012, 0.2, 0.14, 1.805, 0.04, -0.2 + i * 0.35, 0x3a352f]));
  ops.push(...lampPost(-1.85, 1.35, 0.36, 'marquee', 0.02), ...lampPost(1.85, 1.35, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.85, -1.3, 0.5));
  return ops;
};
