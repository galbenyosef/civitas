import type { Op, Color } from './schema';
import { repeat } from './helpers';
import { slab, tree, pine, lampPost, PAVING, ASPHALT } from './tierkit';

/**
 * San Francisco landmarks, the claude-fable-5-1 designs (a comparison set beside kimi's originals in
 * landmarks-san-francisco.ts). Same five buildings, same plots and roles, same scale (about 33 m to a tile). The
 * Transamerica Pyramid carries the office grid on its taper; the rest are plain. Drafts: they show in /compare.html
 * and the viewer, and never change what the city places.
 *
 * The eye behind the set: the Golden Gate's towers tall over the strait between the two headlands, the cables
 * sagging to the deck and the hangers dropping from them; the Pyramid at its real slenderness with the wings
 * following its slope; Coit's column fluted (a striped lathe) and flared at the top on a higher hill; the Ferry
 * Building's long arcade under a Giralda-style stepped clock tower with the bay behind it; Alcatraz as an oval rock
 * with the cellhouse, lighthouse, water tower and the dock with its ferry.
 */

/** A sloping bar from (x0, y0, z0) to (x1, y1, z1), t thick: a horizontal box, or a taper leaning to its far end. */
const bar = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, c: Color): Op => {
  if (Math.abs(y1 - y0) < 0.012) return ['box', Math.abs(x1 - x0) + t, t, Math.abs(z1 - z0) + t, (x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2, c];
  const [xl, yl, zl, xh, yh, zh] = y0 < y1 ? [x0, y0, z0, x1, y1, z1] : [x1, y1, z1, x0, y0, z0];
  return ['taper', t, t, t, t, yh - yl, xl, yl, zl, c, { shift: [xh - xl, zh - zl] }];
};

/** A small boat on the water at (x, z), nose along z (or x): a white hull and a dark cabin. */
const boat = (x: number, z: number, alongX = false, y = 0.02): Op[] => {
  const [w, d] = alongX ? [0.26, 0.1] : [0.1, 0.26];
  return [['box', w, 0.04, d, x, y, z, 'white'], ['box', alongX ? 0.12 : 0.07, 0.04, alongX ? 0.07 : 0.12, x, y + 0.04, z, 'glassDark']];
};

// ================================================================= 192 the Golden Gate Bridge

const GG_ORANGE_F = 0xdc5020, GG_DK_F = 0xb8421a, PIER_F = 0xb7b2a6, HEADLAND_F = 0x6b7a4e;

export const fableGoldenGateOps = (): Op[] => {
  const DECK = 0.46; // the deck truss's underside
  const ops: Op[] = [slab(1, 4, 'pond')];
  // the Marin headland behind and the Presidio shore in front, each carrying an abutment the deck lands on
  ops.push(['taper', 1.0, 0.3, 0.84, 0.16, 0.3, 0, 0, -1.85, HEADLAND_F]);
  ops.push(['box', 0.7, DECK, 0.26, 0, 0, -1.87, PIER_F]);
  ops.push(['box', 1.0, 0.12, 0.26, 0, 0, 1.87, HEADLAND_F]);
  ops.push(['box', 0.7, DECK, 0.22, 0, 0, 1.89, PIER_F]);
  ops.push(['box', 0.14, 0.08, 0.1, -0.42, 0.12, 1.9, 'brick']);
  // the deck truss end to end, the road on it, and a ship passing under the span
  ops.push(['box', 0.56, 0.1, 3.5, 0, DECK, 0, GG_ORANGE_F]);
  ops.push(['box', 0.44, 0.012, 3.5, 0, DECK + 0.1, 0, ASPHALT]);
  ops.push(...boat(-0.22, 0.35));
  for (const side of [-1, 1]) {
    const Z = side * 1.0;
    // the pier in the strait, the two tapering legs, the four portal struts between them and the cap
    ops.push(['box', 0.84, DECK, 0.3, 0, 0.02, Z, PIER_F]);
    for (const sx of [-1, 1]) ops.push(['taper', 0.12, 0.16, 0.08, 0.12, 1.5, sx * 0.36, DECK, Z, GG_ORANGE_F, { shift: [-sx * 0.02, 0] }]);
    for (const y of [0.7, 1.1, 1.45, 1.8]) ops.push(['box', 0.62, 0.08, 0.13, 0, y, Z, GG_ORANGE_F]);
    ops.push(['box', 0.76, 0.04, 0.15, 0, DECK + 1.5, Z, GG_DK_F]);
    // the two main cables: the side span down to the anchorage, the main span sagging to mid-strait, the hangers
    for (const sx of [-1, 1]) {
      const x = sx * 0.27;
      ops.push(bar(x, 2.0, Z, x, 1.3, side * 1.45, 0.028, GG_ORANGE_F));
      ops.push(bar(x, 1.3, side * 1.45, x, DECK, side * 1.86, 0.028, GG_ORANGE_F));
      const sag = (z: number) => DECK + 0.18 + (2.0 - DECK - 0.18) * (z / 1.0) ** 2;
      const n = 5;
      for (let i = 0; i < n; i++) {
        const z0 = side * (1.0 - i / n), z1 = side * (1.0 - (i + 1) / n);
        ops.push(bar(x, sag(z0), z0, x, sag(z1), z1, 0.028, GG_ORANGE_F));
      }
      for (const zz of [0.2, 0.4, 0.6, 0.8]) ops.push(['box', 0.012, sag(zz) - DECK - 0.1, 0.012, x, DECK + 0.1, side * zz, GG_DK_F]);
    }
  }
  for (const sx of [-1, 1]) ops.push(['box', 0.012, 0.18, 0.012, sx * 0.27, DECK + 0.1, 0, GG_DK_F]);
  return ops;
};

// ================================================================= 193 the Transamerica Pyramid

const PYR_WHITE_F = 0xe9e6df, PYR_BASE_F = 0xcfcbc2;

export const fableTransamericaOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the open truss base: a pale podium with the dark band of its three open storeys
  ops.push(['box', 1.0, 0.22, 1.0, 0, 0.02, 0, PYR_BASE_F]);
  ops.push(['box', 1.01, 0.1, 1.01, 0, 0.1, 0, 0x3a3f46]);
  // the pyramid at its real slenderness, nearly four times taller than its base is wide, lit as offices
  ops.push(['taper', 0.86, 0.86, 0.05, 0.05, 2.9, 0, 0.24, 0, PYR_WHITE_F, { win: 'office' }]);
  // the two wings on its east and west faces, leaning in with the slope so they stay against it to the top
  for (const sx of [-1, 1]) ops.push(['taper', 0.06, 0.1, 0.05, 0.08, 1.0, sx * 0.24, 1.9, 0, PYR_WHITE_F, { shift: [-sx * 0.14, 0] }]);
  // the aluminium spire and its beacon
  ops.push(['cyl', 0.04, 0.05, 0.4, 0, 3.14, 0, 'silver', 8]);
  ops.push(['cyl', 0.02, 0.02, 0.04, 0, 3.54, 0, 'red', 6]);
  // the redwood grove on the east side, trees to the west, lamps on the street
  ops.push(...pine(0.78, -0.45, 0.8), ...pine(0.82, 0.05, 0.9), ...pine(0.72, 0.5, 0.75));
  ops.push(...tree(-0.8, -0.6, 0.5), ...tree(-0.8, 0.3, 0.5));
  ops.push(...lampPost(-0.5, 0.9, 0.3, 'marquee', 0.02), ...lampPost(0.5, 0.9, 0.3, 'marquee', 0.02));
  return ops;
};

// ================================================================= 194 Coit Tower

const COIT_F = 0xece8dd, COIT_FLUTE_F = 0xd9d4c7, HILL_F = 0x5f7a4a;

export const fableCoitOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // Telegraph Hill, higher than the plot is wide is tall, with the Filbert steps cut down its front
  ops.push(['lathe', 0, 0.02, 0, HILL_F, [0.95, 0, 0.9, 0.08, 0.8, 0.18, 0.66, 0.28, 0.5, 0.36, 0, 0.4], { seg: 24 }]);
  ops.push(...repeat(6, (i): Op => ['box', 0.16, 0.04, 0.08, 0, 0.36 - i * 0.06, 0.52 + i * 0.08, 'stone']));
  // the lobby with the murals, the fluted column (every second facet a shade darker), the arcaded top and the flared cap
  ops.push(['box', 0.36, 0.1, 0.36, 0, 0.42, 0, COIT_F]);
  ops.push(['lathe', 0, 0.52, 0, COIT_F, [0.15, 0, 0.13, 0.95], { seg: 24, stripe: COIT_FLUTE_F, every: 2, width: 1 }]);
  ops.push(['cyl', 0.135, 0.135, 0.1, 0, 1.47, 0, 0x4a4640, 16]);
  ops.push(...repeat(8, (i): Op => {
    const a = (i / 8) * Math.PI * 2;
    return ['cyl', 0.014, 0.014, 0.1, Math.sin(a) * 0.135, 1.47, Math.cos(a) * 0.135, COIT_F, 6];
  }));
  ops.push(['lathe', 0, 1.57, 0, COIT_F, [0.14, 0, 0.155, 0.04, 0.155, 0.06, 0.1, 0.07, 0, 0.07], { seg: 24 }]);
  // Columbus on his plinth before the door, and the trees the parrots live in
  ops.push(['box', 0.05, 0.05, 0.05, 0, 0.4, 0.34, 'stone'], ['cone', 0.018, 0.06, 0, 0.45, 0.34, 0x5a6a5a, 6]);
  ops.push(...tree(-0.5, 0.48, 0.5, 'hedge', 0.26), ...tree(0.52, -0.46, 0.5, 'hedge', 0.26), ...tree(-0.56, -0.4, 0.45, 'hedge', 0.24));
  ops.push(...lampPost(-0.3, 0.9, 0.26, 'marquee', 0.02), ...lampPost(0.3, 0.9, 0.26, 'marquee', 0.02));
  return ops;
};

// ================================================================= 195 the Ferry Building

const FERRY_F = 0xdcd0b4, FERRY_DK_F = 0xc6b893, FERRY_VOID_F = 0x3f3a33;

export const fableFerryOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the bay behind the building, a ferry at the slip
  ops.push(['box', 1.96, 0.012, 0.5, 0, 0.02, -0.73, 'pond']);
  ops.push(...boat(0.5, -0.75, true, 0.032));
  // the long hall on the Embarcadero: thirteen arches along the ground floor, thirteen windows above, the parapet
  ops.push(['box', 1.8, 0.32, 0.5, 0, 0.02, -0.2, FERRY_F]);
  ops.push(...repeat(13, (i): Op => ['box', 0.07, 0.14, 0.012, -0.78 + i * 0.13, 0.04, 0.05, FERRY_VOID_F]));
  ops.push(...repeat(13, (i): Op => ['box', 0.05, 0.08, 0.012, -0.78 + i * 0.13, 0.21, 0.05, FERRY_VOID_F]));
  ops.push(['box', 1.84, 0.03, 0.54, 0, 0.34, -0.2, FERRY_DK_F]);
  // the clock tower in three stepping stages after the Giralda: the shaft with its four dials, the belfry, the lantern, the cupola
  ops.push(['box', 0.3, 0.95, 0.3, 0, 0.02, -0.2, FERRY_F]);
  ops.push(['lathe', 0, 0.78, -0.05, 'white', [0.09, 0, 0.09, 0.012], { seg: 20, axis: 'z' }], ['box', 0.012, 0.07, 0.006, 0, 0.78, -0.035, 'charcoal']);
  ops.push(['lathe', 0, 0.78, -0.362, 'white', [0.09, 0, 0.09, 0.012], { seg: 20, axis: 'z' }], ['box', 0.012, 0.07, 0.006, 0, 0.78, -0.365, 'charcoal']);
  ops.push(['lathe', 0.15, 0.78, -0.2, 'white', [0.09, 0, 0.09, 0.012], { seg: 20, axis: 'x' }], ['box', 0.006, 0.07, 0.012, 0.165, 0.78, -0.2, 'charcoal']);
  ops.push(['lathe', -0.162, 0.78, -0.2, 'white', [0.09, 0, 0.09, 0.012], { seg: 20, axis: 'x' }], ['box', 0.006, 0.07, 0.012, -0.165, 0.78, -0.2, 'charcoal']);
  ops.push(['box', 0.24, 0.18, 0.24, 0, 0.97, -0.2, FERRY_F]);
  for (const sx of [-1, 1]) {
    ops.push(['box', 0.05, 0.12, 0.012, sx * 0.06, 1.0, -0.08, FERRY_VOID_F], ['box', 0.05, 0.12, 0.012, sx * 0.06, 1.0, -0.32, FERRY_VOID_F]);
    ops.push(['box', 0.012, 0.12, 0.05, 0.12, 1.0, -0.2 + sx * 0.06, FERRY_VOID_F], ['box', 0.012, 0.12, 0.05, -0.12, 1.0, -0.2 + sx * 0.06, FERRY_VOID_F]);
  }
  ops.push(['box', 0.16, 0.12, 0.16, 0, 1.15, -0.2, FERRY_F]);
  ops.push(['lathe', 0, 1.27, -0.2, FERRY_DK_F, [0.09, 0, 0.08, 0.04, 0.03, 0.1, 0, 0.12], { seg: 12 }]);
  ops.push(['flag', 0, 1.39, -0.2, 'white']);
  // the Embarcadero: palms and lamps
  ops.push(...tree(-0.85, 0.75, 0.5), ...tree(0.85, 0.75, 0.5), ...tree(-0.85, 0.25, 0.45), ...tree(0.85, 0.25, 0.45));
  ops.push(...lampPost(-0.4, 0.85, 0.28, 'marquee', 0.02), ...lampPost(0.4, 0.85, 0.28, 'marquee', 0.02));
  return ops;
};

// ================================================================= 196 Alcatraz

const ROCK_F = 0x7d7466, ROCK_DK_F = 0x6a6256, CELL_F = 0xdedad0, CELL_DK_F = 0xcfcabd;

export const fableAlcatrazOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'pond')];
  // the rock: two mounds side by side make the island's long oval, the cliffs steep and the top flat
  const rock = (x: number, r: number): Op => ['lathe', x, 0.02, 0, ROCK_F, [r, 0, r * 0.97, 0.04, r * 0.84, 0.1, r * 0.74, 0.13, r * 0.7, 0.16, 0, 0.16], { seg: 24 }];
  ops.push(rock(-0.3, 0.56), rock(0.05, 0.55), rock(0.4, 0.5));
  ops.push(['box', 0.9, 0.012, 0.5, 0.05, 0.18, 0, ROCK_DK_F]);
  // the cellhouse along the top with its clerestory, and the rows of window slits
  ops.push(['box', 0.9, 0.16, 0.26, 0, 0.18, -0.02, CELL_F]);
  ops.push(['box', 0.86, 0.05, 0.12, 0, 0.34, -0.02, CELL_DK_F]);
  for (const sz of [-1, 1]) ops.push(...repeat(7, (i): Op => ['box', 0.03, 0.06, 0.012, -0.36 + i * 0.12, 0.24, -0.02 + sz * 0.13, 0x3a3630]));
  // the lighthouse at the top of the rock, the burnt warden's house beside it
  ops.push(['cyl', 0.03, 0.035, 0.28, 0.35, 0.18, 0.12, 'white', 10]);
  ops.push(['cyl', 0.028, 0.028, 0.04, 0.35, 0.46, 0.12, 'marquee', 8]);
  ops.push(['cone', 0.032, 0.04, 0.35, 0.5, 0.12, 'charcoal', 8]);
  ops.push(['box', 0.14, 0.08, 0.12, 0.36, 0.18, -0.14, 0x9a948a]);
  // the water tower on its four legs at the west end
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ops.push(['box', 0.012, 0.12, 0.012, -0.4 + sx * 0.035, 0.18, -0.25 + sz * 0.035, 'steel']);
  ops.push(['cyl', 0.05, 0.05, 0.06, -0.4, 0.3, -0.25, 'grey', 10]);
  // the industries building low on the slope, the dock on the lee shore with the ferry alongside
  ops.push(['box', 0.3, 0.12, 0.14, -0.55, 0.1, 0.3, CELL_DK_F]);
  ops.push(['box', 0.3, 0.04, 0.3, 0.1, 0, 0.6, 'stone']);
  ops.push(...boat(0.36, 0.72));
  return ops;
};
