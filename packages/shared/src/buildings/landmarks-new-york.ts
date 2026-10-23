import type { KindDef, Op, Color } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { office } from './office';
import { theatre, library } from './leisure';
import { slab, tree, treeLine, lampPost, flags, fence, PAVING, ASPHALT } from './tierkit';

/**
 * New York landmarks (docs/buildings.md "Landmarks"): recognisable real buildings of Manhattan and the harbour, tagged
 * 'world' and 'new-york', rungs of the 'new-york' collection (groups.ts), tiers 1-8, their tools unlocked only by the
 * locked tech node 'wld1' (tech.ts) like the London landmarks. Kind ids 121-128 (see landmarks-world.ts for the world
 * allocation). Scale: about 33 m to a tile, as for London.
 *
 * The set, in tier order (121 and 122 are already here; 123-128 are appended below):
 *   121 the Empire State Building: an office tower, the city's biggest workplace after the Shard — exists
 *   122 the Chrysler Building: an office tower with its silver arcaded crown — exists
 *   123 the Statue of Liberty: a library-family daytime attraction on its island
 *   124 One World Trade Center: an office tower, the glass shaft to the spire
 *   125 the Brooklyn Bridge: a library-family attraction, the stone towers and cable fans over the East River
 *   126 the Flatiron Building: an office in the wedge where Fifth crosses Broadway
 *   127 Rockefeller Center: an office slab over its sunken plaza
 *   128 Radio City Music Hall: a theatre-family venue under its long marquee
 */

const TAGS = ['world', 'new-york'];
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'new-york',
};

// ---------------------------------------------------------------- shared bits

/** Merlons along a wall top: n teeth along x (or z) centred on (x, z), the wall `thick` deep (as landmarks-london-2). */
const merlons = (n: number, len: number, x: number, y: number, z: number, alongX: boolean, thick: number, color: Color): Op[] =>
  repeat(n, (i): Op => {
    const t = -len / 2 + (len * (i + 0.5)) / n;
    return alongX ? ['box', (len / n) * 0.55, 0.035, thick, x + t, y, z, color] : ['box', thick, 0.035, (len / n) * 0.55, x, y, z + t, color];
  });

// ================================================================= 121 the Empire State Building

/**
 * Fifth Avenue's art-deco sentinel: a warm limestone shaft in five setbacks, each tier inset from the one below so no
 * wall ever half-hides another's windows, climbing to the windowless crown and the mooring-mast spire with its aircraft
 * light. The door and its gilt porch are on Fifth Avenue (+z); flagpoles and street lamps along the pavement.
 */
const LIME = 0xd3c5a4, LIME_DK = 0xc4b494, GILT = 0xb08d4f;

const empireStateOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the five setbacks: base and four climbing tiers, each inset so its walls clear the tier below's windows
  ops.push(['box', 2.3, 0.5, 2.3, 0, 0.02, 0, LIME, true, { name: 'base', facade: { storeys: 4, bays: 7, margin: 0.08, ground: 'door', top: 0.12 } }]);
  ops.push(['box', 2.0, 1.5, 2.0, 0, 0.52, 0, LIME, true, { name: 't1', facade: { storeys: 10, bays: 7, margin: 0.08 } }]);
  ops.push(['box', 1.7, 1.3, 1.7, 0, 2.02, 0, LIME, true, { name: 't2', facade: { storeys: 9, bays: 6, margin: 0.08 } }]);
  ops.push(['box', 1.4, 1.1, 1.4, 0, 3.32, 0, LIME, true, { name: 't3', facade: { storeys: 7, bays: 5, margin: 0.08 } }]);
  ops.push(['box', 1.1, 0.7, 1.1, 0, 4.42, 0, LIME_DK, true, { name: 'crown', facade: { storeys: 4, bays: 4, margin: 0.06 } }]);
  // gilt bands at each setback line, an art-deco crown cornice
  ops.push(['cornice', 'base', 4, GILT], ['cornice', 't1', 10, GILT], ['cornice', 't2', 9, GILT], ['cornice', 't3', 7, GILT]);
  // the entrance porch over the door bays, gilt (a facade feature, so it can never cover a window)
  ops.push(['porch', 'base', 'front', 2, 4, GILT]);
  // the mooring-mast spire: a windowless crown block, the silver mast stages and the aircraft light
  ops.push(['taper', 0.5, 0.5, 0.26, 0.26, 0.5, 0, 5.12, 0, 0x9aa4ae]);
  ops.push(['cyl', 0.1, 0.16, 1.1, 0, 5.62, 0, 'silver', 8]);
  ops.push(['cyl', 0.02, 0.05, 0.5, 0, 6.72, 0, 'steel', 6]);
  ops.push(['cyl', 0.035, 0.035, 0.06, 0, 7.22, 0, 'red', 6]);
  // the pavement: flagpoles along Fifth Avenue, street lamps and a pair of trees
  ops.push(...flags(-0.9, 1.42, 5, 0.45, ['navy', 'red', 'white'], 0.02));
  ops.push(...lampPost(-0.62, 1.44, 0.36, 'marquee', 0.02), ...lampPost(0.62, 1.44, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.28, 1.28, 0.7), ...tree(1.28, 1.28, 0.7));
  return ops;
};

export const empireState: KindDef = {
  ...towerBase, id: 'empire-state', name: 'the Empire State Building', kindId: 121, tier: 1,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'Fifth Avenue\'s art-deco sentinel: a limestone shaft of setbacks climbing to the mooring-mast spire that has crowned the Manhattan skyline since 1931.',
  howTo: 'A 3×3 plot on a main avenue among offices; it holds crowds of jobs, so give it a station or buses and leave the street in front clear. World landmark: unlock rule to be decided.',
  tool: { id: 'empirestate', key: '', label: 'Empire State', color: '#c9a35a' },
  levels: [{
    capacity: 400, wage: 46, cost: 28000, upkeep: 140, work: 5000, parking: { surface: 0, underground: 80 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'five limestone setbacks under a silver mooring-mast spire', height: 7.3, ops: empireStateOps() },
    ],
  }],
};

// ================================================================= 122 the Chrysler Building

/**
 * The silver crown of Midtown: a dark-brick shaft (windows by the facade grid) carrying four stacked, shrinking
 * chrome terraces - the seven arcaded crowns read as one stepped dome - and a dome and needle. Every tier is inset
 * from the one below, so no wall half-hides another's windows. The door and porch are on the avenue front.
 */
const BARK = 0x413c39, CHROME = 0xdfe3e8, CHROME_DK = 0xb8bfc9;

const chryslerOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the dark brick shaft on a storefront base, the door on the avenue front
  ops.push(['box', 2.2, 0.6, 2.2, 0, 0.02, 0, BARK, true, { name: 'base', facade: { storeys: 5, bays: 7, margin: 0.08, ground: 'door', top: 0.12 } }]);
  ops.push(['box', 1.9, 2.4, 1.9, 0, 0.62, 0, BARK, true, { name: 'shaft', facade: { storeys: 14, bays: 6, margin: 0.08, top: 0.06 } }]);
  // the crown: four shrinking chrome terraces, then the dome and the needle
  ops.push(['taper', 1.5, 1.5, 1.14, 1.14, 0.4, 0, 3.03, 0, CHROME]);
  ops.push(['taper', 1.14, 1.14, 0.82, 0.82, 0.34, 0, 3.43, 0, CHROME]);
  ops.push(['taper', 0.82, 0.82, 0.54, 0.54, 0.3, 0, 3.77, 0, CHROME]);
  ops.push(['taper', 0.54, 0.54, 0.3, 0.3, 0.26, 0, 4.07, 0, CHROME]);
  ops.push(['lathe', 0, 4.33, 0, CHROME, [0.3, 0, 0.32, 0.06, 0.26, 0.12, 0.16, 0.18, 0.07, 0.22, 0, 0.24], { seg: 16 }]);
  ops.push(['cyl', 0.012, 0.03, 0.5, 0, 4.57, 0, 'steel', 6]);
  ops.push(['cyl', 0.028, 0.028, 0.05, 0, 5.07, 0, 'red', 6]);
  // the entrance porch over the door bays, and a line of street trees
  ops.push(['porch', 'base', 'front', 2, 4, CHROME_DK]);
  ops.push(...treeLine(-1.2, 1.35, 1.2, 1.35, 3, 0.6));
  ops.push(...lampPost(-1.35, 1.42, 0.36, 'marquee', 0.02), ...lampPost(1.35, 1.42, 0.36, 'marquee', 0.02));
  return ops;
};

export const chrysler: KindDef = {
  ...towerBase, id: 'chrysler', name: 'the Chrysler Building', kindId: 122, tier: 2,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The silver crown of the Midtown skyline: William Van Alen\'s dark-brick shaft whose seven terraced chrome arches climb through a dome to a needle.',
  howTo: 'A 3×3 plot among offices on an avenue; a big workplace, so give it buses or a station. World landmark: unlock rule to be decided.',
  tool: { id: 'chrysler', key: '', label: 'Chrysler Building', color: '#9fb3c8' },
  levels: [{
    capacity: 320, wage: 44, cost: 22000, upkeep: 120, work: 4200, parking: { surface: 0, underground: 70 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'dark shaft under four shrinking chrome crown terraces, a dome and a needle', height: 5.14, ops: chryslerOps() },
    ],
  }],
};

// ================================================================= 123 the Statue of Liberty

/**
 * Liberty Island in the harbour: a star fort of stone curtain walls with four proud corner bastions, its roof terrace
 * carrying Bartholdi's green copper figure - the flaring robe, the crown, the tablet under the left arm and the right
 * arm raised with its gilded torch. The museum pavilion by the quay sells the tickets. Nothing stands against a
 * windowed wall, so the bastions, merlons and figure overlap only plain stone.
 */
const FORT = 0xbfb6a2, FORT_DK = 0xaca28c, COPPER = 0x77b5a2, COPPER_DK = 0x5f9e8a;

const statueOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the island quay, broken at the front for the museum's door
  ops.push(['box', 0.81, 0.03, 0.06, -0.595, 0, 0.97, 'stone'], ['box', 0.81, 0.03, 0.06, 0.595, 0, 0.97, 'stone']);
  ops.push(['box', 0.06, 0.03, 1.96, 0.97, 0, 0, 'stone'], ['box', 0.06, 0.03, 1.96, -0.97, 0, 0, 'stone']);
  ops.push(['box', 1.96, 0.03, 0.06, 0, 0, -0.97, 'stone']);
  // the star fort: curtain walls, corner bastions standing proud, a parapet of merlons, the roof terrace
  ops.push(['box', 1.0, 0.2, 0.08, 0, 0.02, 0.6, FORT], ['box', 1.0, 0.2, 0.08, 0, 0.02, -0.6, FORT]);
  ops.push(['box', 0.08, 0.2, 1.12, 0.6, 0.02, 0, FORT], ['box', 0.08, 0.2, 1.12, -0.6, 0.02, 0, FORT]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ops.push(['box', 0.24, 0.26, 0.24, sx * 0.52, 0.02, sz * 0.52, FORT_DK]);
  ops.push(...merlons(9, 1.0, 0, 0.22, 0.6, true, 0.08, FORT), ...merlons(9, 1.0, 0, 0.22, -0.6, true, 0.08, FORT));
  ops.push(...merlons(10, 1.12, 0.6, 0.22, 0, false, 0.08, FORT), ...merlons(10, 1.12, -0.6, 0.22, 0, false, 0.08, FORT));
  ops.push(['box', 1.04, 0.04, 1.04, 0, 0.22, 0, FORT_DK]);
  // Liberty on her plinth: the flaring robe, the crowned head with its seven rays, the tablet
  // at her left hip and the right arm raised with the golden torch - as tall above the fort as
  // the fort stands above the island, so she reads from across the harbour
  ops.push(['box', 0.4, 0.12, 0.4, 0, 0.26, -0.12, 'stone']);
  ops.push(['lathe', 0, 0.38, -0.12, COPPER, [0.19, 0, 0.2, 0.05, 0.17, 0.18, 0.135, 0.34, 0.125, 0.46, 0.1, 0.54, 0.07, 0.6, 0.045, 0.64, 0, 0.65], { seg: 16 }]);
  ops.push(['cyl', 0.055, 0.06, 0.06, 0, 1.02, -0.12, COPPER, 10]);
  ops.push(['lathe', 0, 1.06, -0.12, COPPER, [0.07, 0, 0.078, 0.04, 0.068, 0.09, 0.05, 0.13, 0.03, 0.15, 0, 0.17], { seg: 12 }]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ops.push(['cone', 0.009, 0.05, Math.cos(a) * 0.075, 1.17, -0.12 + Math.sin(a) * 0.075, COPPER, 5]);
  }
  // the right arm raised with the torch, the left arm low with the tablet
  ops.push(['taper', 0.055, 0.055, 0.04, 0.04, 0.42, 0.1, 0.98, -0.12, COPPER, { shift: [0.2, 0] }]);
  ops.push(['cyl', 0.022, 0.026, 0.1, 0.3, 1.38, -0.12, 'gold', 8]);
  ops.push(['cone', 0.035, 0.09, 0.3, 1.48, -0.12, 'marquee', 8]);
  ops.push(['taper', 0.036, 0.036, 0.05, 0.05, 0.22, -0.2, 0.72, -0.12, COPPER, { shift: [0.12, 0] }]);
  ops.push(['box', 0.13, 0.2, 0.03, -0.24, 0.62, -0.12, COPPER_DK]);
  // the museum pavilion at the quay: the ticket office, its door and awning towards the road
  ops.push(['box', 0.42, 0.15, 0.26, 0, 0.02, 0.79, 'stone', true, { name: 'museum', facade: { storeys: 1, bays: 3, sideBays: 0, ground: 'door', top: 0.04 } }]);
  ops.push(['awning', 'museum', 'front', 1, 1], ['cornice', 'museum', 1, FORT_DK]);
  // island trees and the colours flying over the two front bastions
  ops.push(...tree(-0.82, 0.72, 0.7), ...tree(0.82, 0.72, 0.7));
  ops.push(...flags(-0.52, 0.52, 2, 1.04, ['navy', 'red'], 0.28));
  return ops;
};

export const statueOfLiberty: KindDef = {
  id: 'statue-of-liberty', name: 'the Statue of Liberty', code: library.code, kindId: 123, family: 'leisure', tier: 3,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'new-york',
  occupation: { ...library.occupation!, name: 'monument guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 120, ticket: 24, openHours: [9, 17.5], stay: [1.2, 2.2], leisureValue: 8, radius: 30,
    dayAppeal: 1.5, eveningAppeal: 0.1, retireeAppeal: 2.2, childAppeal: 1.9, title: 'Statue of Liberty',
  },
  lot: { wage: 17 },
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'Liberty Island in the harbour: the star-fort pedestal Bartholdi\'s green copper lady has stood on since 1886, her torch raised over the bay for the ferries from Manhattan.',
  howTo: 'A 2×2 plot by the water, its door on the street side. A ticketed day out that draws families and retirees from across the city, so give it a bus or a station. World landmark: unlock rule to be decided.',
  tool: { id: 'liberty', key: '', label: 'Statue of Liberty', color: '#6fae94' },
  levels: [{
    capacity: 30, wage: 17, cost: 13000, upkeep: 60, work: 3000, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'star-fort pedestal on the island under the green copper figure and her raised torch', height: 1.6, ops: statueOps() },
    ],
  }],
};

// ================================================================= 124 One World Trade Center

/**
 * The glass shaft of the rebuilt World Trade Center: a tinted podium on the street, then the square shaft whose
 * long isosceles triangles taper gently to the flat crown, the spire climbing from it with its aircraft light. The
 * shaft is one taper lit by the office window grid, so there are no stacked walls to half-hide a window; everything
 * above sits on its top face.
 */
const GLASS1 = 0x9fb8cc, GLASS1_DK = 0x86a8bf;

const oneWorldOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the glass podium and the gently tapering square shaft
  ops.push(['box', 2.3, 0.5, 2.3, 0, 0.02, 0, GLASS1_DK, true, { name: 'podium', facade: { storeys: 4, bays: 7, margin: 0.08, ground: 'plain', top: 0.12 } }]);
  ops.push(['taper', 2.0, 2.0, 1.5, 1.5, 3.3, 0, 0.52, 0, GLASS1, { win: 'office' }]);
  // the flat crown: parapet, roof slab and the spire with its aircraft light
  ops.push(['box', 1.52, 0.06, 1.52, 0, 3.82, 0, 'dark']);
  ops.push(['box', 1.3, 0.05, 1.3, 0, 3.88, 0, GLASS1_DK]);
  ops.push(['cyl', 0.02, 0.05, 0.9, 0, 3.93, 0, 'steel', 8]);
  ops.push(['cyl', 0.028, 0.028, 0.05, 0, 4.83, 0, 'red', 6]);
  // the entrance porch over the door, street lamps and trees along the pavement
  ops.push(['door', 'podium', 'front', 3], ['porch', 'podium', 'front', 3, 5, GLASS1_DK]);
  ops.push(...lampPost(-0.9, 1.42, 0.36, 'marquee', 0.02), ...lampPost(0.9, 1.42, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.3, 1.3, 0.7), ...tree(1.3, 1.3, 0.7));
  return ops;
};

export const oneWorldTradeCenter: KindDef = {
  ...towerBase, id: 'one-world-trade-center', name: 'One World Trade Center', kindId: 124, tier: 4,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The glass shaft of the rebuilt World Trade Center: long triangles of glazing rising the full height to the flat crown, the spire climbing from it over the memorial pools.',
  howTo: 'A 3×3 plot downtown among offices; one of the city\'s biggest workplaces, so give it buses or a station and leave the street in front clear. World landmark: unlock rule to be decided.',
  tool: { id: 'onewtc', key: '', label: 'One World Trade Center', color: '#8fb4cc' },
  levels: [{
    capacity: 380, wage: 46, cost: 26000, upkeep: 140, work: 4800, parking: { surface: 0, underground: 75 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'glass podium under the gently tapering square shaft, the flat crown and the spire', height: 4.88, ops: oneWorldOps() },
    ],
  }],
};

// ================================================================= 125 the Brooklyn Bridge

/**
 * The 1883 crossing over the East River, drawn along z with the door on the +z end (as Tower Bridge): two stone
 * towers of twin legs with a shadowed arch between, a windowed upper stage under a cornice, and from each tower a
 * diagonal fan of cable stays running out over the side spans and in over the middle, the chains dropping to the
 * anchor piers on the banks. Only the small upper stages carry facades; the legs, arch bands and stays are plain,
 * so nothing can cover their windows.
 */
const BB_STONE = 0xcfc3ab, BB_DK = 0xb5a88c;

const brooklynOps = (): Op[] => {
  const D = 0.25; // the road deck's top
  const ops: Op[] = [];
  // a sloping bar from (z0, y0) to (z1, y1) at x
  const bar = (x: number, z0: number, y0: number, z1: number, y1: number, t: number, c: Color): Op => {
    if (Math.abs(y1 - y0) < 0.04) return ['box', t, t, Math.abs(z1 - z0), x, Math.min(y0, y1), (z0 + z1) / 2, c];
    const [zl, yl, zh, yh] = y0 < y1 ? [z0, y0, z1, y1] : [z1, y1, z0, y0];
    return ['taper', t, t, t, t, yh - yl, x, yl, zl, c, { shift: [0, zh - zl] }];
  };
  // the road deck end to end, its promenade rails and the anchor piers on the banks
  ops.push(['box', 0.5, 0.03, 4, 0, D - 0.03, 0, ASPHALT]);
  ops.push(...[-1, 1].flatMap((sx): Op[] => [
    ['box', 0.02, 0.05, 4, sx * 0.24, D - 0.05, 0, BB_STONE],
    ['box', 0.012, 0.012, 4, sx * 0.24, D + 0.02, 0, 'white'],
  ]));
  ops.push(['box', 0.44, 0.18, 0.24, 0, 0, 1.88, BB_DK], ['box', 0.44, 0.18, 0.24, 0, 0, -1.88, BB_DK]);
  for (const side of [-1, 1]) {
    const Z = side * 0.6;
    // the pier under the tower, the twin legs either side of the road and the shadowed arch between them
    ops.push(['box', 0.48, D - 0.03, 0.44, 0, 0, Z, BB_DK]);
    ops.push(...[-1, 1].map((sx): Op => ['box', 0.16, 1.05, 0.36, sx * 0.28, D, Z, BB_STONE]));
    ops.push(['box', 0.3, 0.55, 0.28, 0, D + 0.02, Z, 0x2b2e36]);
    // the arch band over the opening, the windowed upper stage, the cornice and two caps
    ops.push(['box', 0.72, 0.3, 0.4, 0, 1.12, Z, BB_STONE]);
    ops.push(['box', 0.76, 0.3, 0.34, 0, 1.42, Z, BB_STONE, 'civic', { name: side > 0 ? 'towerN' : 'towerS', facade: { storeys: 2, bays: 3, sideBays: 1, margin: 0.16 } }]);
    ops.push(['box', 0.78, 0.04, 0.42, 0, 1.72, Z, BB_DK]);
    ops.push(...[-1, 1].map((sx): Op => ['taper', 0.1, 0.1, 0, 0, 0.1, sx * 0.3, 1.76, Z, BB_DK]));
    // the fan of cable stays from each tower, out over the side spans and in over the middle, and the chain to the anchorage
    for (const sx of [-1, 1]) {
      const x = sx * 0.24;
      for (const zz of [0.98, 1.24, 1.5, 1.76]) ops.push(bar(x, Z + side * 0.14, 1.66, side * zz, D + 0.02, 0.016, 'steel'));
      for (const zz of [0.14, 0.3, 0.46]) ops.push(bar(x, Z - side * 0.14, 1.66, side * zz, D + 0.02, 0.016, 'steel'));
      ops.push(bar(x, Z + side * 0.2, 1.2, side * 1.86, 0.2, 0.018, 'steel'));
    }
  }
  // the toll house on the deck near the +z end, where the door is
  ops.push(['box', 0.22, 0.2, 0.16, 0, D, 1.6, BB_STONE, 'civic', { name: 'toll', facade: { storeys: 1, bays: 2, sideBays: 0, margin: 0.03, ground: 'door' } }]);
  ops.push(['roof', 0.26, 0.08, 0.2, 0, D + 0.2, 1.6, BB_DK]);
  ops.push(['awning', 'toll', 'front', 1, 1]);
  return ops;
};

export const brooklynBridge: KindDef = {
  id: 'brooklyn-bridge', name: 'the Brooklyn Bridge', code: library.code, kindId: 125, family: 'leisure', tier: 5,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic', landmark: true, tags: TAGS, group: 'new-york',
  occupation: { ...library.occupation!, name: 'bridge walk guide' },
  attrs: {
    ...library.attrs, visitorCapacity: 90, ticket: 12, openHours: [9.5, 18], stay: [0.8, 1.6], leisureValue: 7, radius: 26,
    dayAppeal: 1.3, eveningAppeal: 0.15, retireeAppeal: 1.5, childAppeal: 1.5, title: 'Brooklyn Bridge',
  },
  lot: { wage: 16 },
  footprint: { w: 1, h: 4, door: [0, 3] },
  blurb: 'The 1883 crossing over the East River: twin stone towers with tall arches, diagonal fans of cable stays and a promenade visitors walk for the harbour view.',
  howTo: 'Placed with its tool it is a 1×4 landmark on dry land, its door on the road at one end; in a real city it would span the river it crosses. World landmark: unlock rule to be decided.',
  tool: { id: 'brooklyn', key: '', label: 'Brooklyn Bridge', color: '#b8ab90' },
  levels: [{
    capacity: 16, wage: 16, cost: 15000, upkeep: 65, work: 3200, parking: { surface: 0, underground: 0 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'two stone towers with arched openings and diagonal cable fans over the road deck', height: 1.86, ops: brooklynOps() },
    ],
  }],
};

// ================================================================= 126 the Flatiron Building

/**
 * The narrow wedge where Fifth Avenue crosses Broadway: a rusticated base with the door on the avenue, then the
 * limestone and terracotta shaft as a single taper whose width shrinks to the knife-edge ridge along the top while
 * its near-vertical faces keep the office window grid; nothing is stacked over a window, and the terracotta crest
 * and penthouse stand on the taper's own top face.
 */
const LIME3 = 0xe3d7bc, LIME3_DK = 0xd0c2a2, TERRA = 0xb86a4a;

const flatironOps = (): Op[] => {
  const ops: Op[] = [slab(3, 3, PAVING)];
  // the rusticated base on the avenue, its door and the terracotta cornice
  ops.push(['box', 2.4, 0.4, 2.4, 0, 0.02, 0, LIME3_DK, true, { name: 'base', facade: { storeys: 3, bays: 7, margin: 0.08, ground: 'door', top: 0.1 } }]);
  ops.push(['cornice', 'base', 3, TERRA]);
  // the wedge: the shaft tapering along x to the knife-edge ridge, windows on its near-vertical faces
  ops.push(['taper', 2.1, 2.1, 0.06, 2.0, 1.7, 0, 0.42, 0, LIME3, { win: 'office' }]);
  ops.push(['box', 0.14, 0.05, 2.02, 0, 2.12, 0, TERRA]);
  ops.push(['box', 0.1, 0.08, 0.12, 0, 2.17, -0.25, LIME3_DK]);
  // the entrance porch, lamps and street trees at the kerb
  ops.push(['porch', 'base', 'front', 3, 5, TERRA]);
  ops.push(...lampPost(-0.7, 1.44, 0.36, 'marquee', 0.02), ...lampPost(0.7, 1.44, 0.36, 'marquee', 0.02));
  ops.push(...tree(-1.3, 1.28, 0.65), ...tree(1.3, 1.28, 0.65));
  return ops;
};

export const flatiron: KindDef = {
  ...towerBase, id: 'flatiron', name: 'the Flatiron Building', kindId: 126, tier: 6,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'The narrow wedge where Fifth Avenue meets Broadway: Burnham\'s limestone and terracotta flatiron rising twenty storeys to the knife edge over the pavement.',
  howTo: 'A 3×3 plot where two avenues fork, the wide face and door on the street. An office like any other, so give it transit and leave the front clear. World landmark: unlock rule to be decided.',
  tool: { id: 'flatiron', key: '', label: 'Flatiron Building', color: '#c8a37a' },
  levels: [{
    capacity: 240, wage: 44, cost: 15000, upkeep: 95, work: 3000, parking: { surface: 0, underground: 50 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'rusticated base under the limestone wedge that tapers along one axis to the knife edge', height: 2.25, ops: flatironOps() },
    ],
  }],
};

// ================================================================= 127 Rockefeller Center

/**
 * The GE slab behind its sunken plaza: three limestone stages, each inset 0.15 from the one below so no wall
 * half-hides another's windows, climbing to the flat top; in front the pale rink with Prometheus gilded above its
 * head, the avenue of flags along the plaza's edge and trees flanking the ice.
 */
const ROCK = 0xd9cfae, ROCK_DK = 0xc4b894;

const rockefellerOps = (): Op[] => {
  const ops: Op[] = [slab(4, 4, PAVING)];
  // the sunken plaza in front: a surround of paving and the pale rink, Prometheus gilded at its head
  ops.push(['box', 1.9, 0.016, 1.1, 0, 0.02, 1.05, ROCK_DK]);
  ops.push(['box', 1.8, 0.02, 1.0, 0, 0.024, 1.05, 'white']);
  ops.push(['cyl', 0.02, 0.03, 0.06, 0, 0.044, 0.62, 'gold', 8], ['cone', 0.03, 0.1, 0, 0.104, 0.62, 'gold', 8]);
  // the avenue of flags along the plaza front, trees flanking the rink
  ops.push(...flags(-1.05, 1.9, 6, 0.42, ['navy', 'white', 'red'], 0.02));
  ops.push(...tree(-1.6, 0.9, 0.7), ...tree(1.6, 0.9, 0.7), ...tree(-1.6, 1.45, 0.6), ...tree(1.6, 1.45, 0.6));
  // the GE slab: three limestone stages, each inset from the one below, the door on the plaza front
  ops.push(['box', 1.5, 0.55, 1.0, 0, 0.02, -1.0, ROCK, true, { name: 'g', facade: { storeys: 3, bays: 5, sideBays: 3, margin: 0.08, ground: 'door', top: 0.1 } }]);
  ops.push(['box', 1.2, 1.5, 0.8, 0, 0.57, -1.0, ROCK, true, { name: 'ge', facade: { storeys: 11, bays: 5, sideBays: 3, margin: 0.08 } }]);
  ops.push(['box', 0.9, 0.55, 0.6, 0, 2.07, -1.0, ROCK_DK, true, { name: 'top', facade: { storeys: 4, bays: 4, sideBays: 2, margin: 0.06 } }]);
  ops.push(['cornice', 'g', 3, ROCK_DK], ['cornice', 'ge', 11, ROCK_DK]);
  ops.push(['box', 0.92, 0.04, 0.62, 0, 2.62, -1.0, ROCK_DK]);
  ops.push(...lampPost(-0.95, 0.3, 0.36, 'marquee', 0.02), ...lampPost(0.95, 0.3, 0.36, 'marquee', 0.02));
  return ops;
};

export const rockefellerCenter: KindDef = {
  ...towerBase, id: 'rockefeller-center', name: 'Rockefeller Center', kindId: 127, tier: 7,
  footprint: { w: 4, h: 4, door: [1, 3] },
  blurb: 'The GE slab behind its sunken plaza: limestone setbacks climbing to the flat top, the pale rink below with Prometheus gilded over it and the avenue of flags.',
  howTo: 'A 4×4 plot on an avenue, the plaza and rink towards the street. One of the city\'s biggest workplaces, so give it a station or buses. World landmark: unlock rule to be decided.',
  tool: { id: 'rockefeller', key: '', label: 'Rockefeller Center', color: '#d0c49a' },
  levels: [{
    capacity: 320, wage: 46, cost: 24000, upkeep: 150, work: 4200, parking: { surface: 0, underground: 80 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'limestone setbacks behind the sunken plaza, the pale rink with its flags and gilded Prometheus', height: 2.66, ops: rockefellerOps() },
    ],
  }],
};

// ================================================================= 128 Radio City Music Hall

/**
 * The show palace of Sixth Avenue: the long limestone facade (windows on the front only, so the stage house behind
 * it can stand against its back wall) under an even longer marquee of bulbs, the long sign hanging from the
 * marquee's front between its posts, and the doors opening under the canopy. The marquee floats a row of bulbs
 * proud of the wall and stops below the upper windows, so nothing covers a window.
 */
const RADIO = 0xe4d6b8, RADIO_DK = 0xd0c09c, RADIO_RED = 0xb8434f;

const radioCityOps = (): Op[] => {
  const ops: Op[] = [slab(4, 3, PAVING)];
  // the auditorium and its long entrance front on the avenue, plain sides so nothing half-hides a window
  ops.push(['box', 3.6, 0.7, 1.35, 0, 0.02, -0.425, RADIO, true, { name: 'hall', facade: { storeys: 3, bays: 16, sideBays: 0, margin: 0.05 } }]);
  ops.push(['cornice', 'hall', 3, RADIO_DK]);
  ops.push(['box', 3.6, 0.62, 0.35, 0, 0.02, 0.475, RADIO_DK, true, { name: 'foyer', facade: { storeys: 2, bays: 18, sideBays: 0, margin: 0.05, ground: 'plain', top: 0.04 } }]);
  // the stage house rising behind, over the back row
  ops.push(['box', 2.2, 1.0, 0.32, -0.4, 0.02, -1.32, RADIO_DK]);
  // the doors under the marquee
  ops.push(['door', 'foyer', 'front', 5], ['door', 'foyer', 'front', 9], ['door', 'foyer', 'front', 13]);
  // the even longer marquee, its posts, the row of bulbs and the long sign under its front
  ops.push(['box', 3.9, 0.05, 0.55, 0, 0.26, 0.985, 'marquee']);
  ops.push(['box', 3.9, 0.02, 0.57, 0, 0.31, 0.985, RADIO_RED]);
  ops.push(...repeat(13, (i): Op => ['box', 0.06, 0.025, 0.01, -1.8 + i * 0.3, 0.26, 1.265, 'yellow']));
  ops.push(['box', 3.4, 0.12, 0.03, 0, 0.13, 1.2, 'marquee'], ['box', 3.44, 0.02, 0.032, 0, 0.25, 1.2, 'gold'], ['box', 3.44, 0.02, 0.032, 0, 0.11, 1.2, 'gold']);
  ops.push(...[-1, 1].map((sx): Op => ['cyl', 0.012, 0.012, 0.24, sx * 1.86, 0.02, 1.2, 'steel', 5]));
  // the queue rail under the marquee, and marquee lamps at the kerb
  ops.push(...fence(0, 0.9, 3.5, true, 'gold', 0.05));
  ops.push(...lampPost(-1.9, 1.35, 0.36, 'marquee', 0.02), ...lampPost(1.9, 1.35, 0.36, 'marquee', 0.02));
  return ops;
};

export const radioCity: KindDef = {
  id: 'radio-city', name: 'Radio City Music Hall', code: 12, kindId: 128, family: 'leisure', tier: 8,
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue', landmark: true, tags: TAGS, group: 'new-york',
  occupation: { ...theatre.occupation!, name: 'music hall staff' },
  attrs: {
    ...theatre.attrs, visitorCapacity: 220, ticket: 26, openHours: [12, 24], stay: [2, 3], leisureValue: 10, radius: 30,
    eventNights: [2, 4, 5, 6], eventStart: 19.5, eveningAppeal: 1.4, retireeAppeal: 1.6, title: 'Radio City Music Hall',
  },
  lot: { wage: 19 },
  footprint: { w: 4, h: 3, door: [2, 2] },
  blurb: 'The show palace of Sixth Avenue: the long limestone facade under an even longer marquee of bulbs, and the great auditorium behind it that fills for the Christmas Spectacular.',
  howTo: 'A 4×3 plot on a busy avenue, the marquee towards the street, near restaurants and bars for the pre-show crowd. World landmark: unlock rule to be decided.',
  tool: { id: 'radiocity', key: '', label: 'Radio City Music Hall', color: '#c9463c' },
  levels: [{
    capacity: 35, wage: 19, cost: 12000, upkeep: 95, work: 2600, parking: { surface: 0, underground: 40 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'long limestone facade under an even longer lit marquee, the stage house rising behind', height: 1.02, ops: radioCityOps() },
    ],
  }],
};

/** New York's landmarks, in kind-id order (landmarks-world.ts lists them in WORLD_LANDMARKS). */
export const NEW_YORK_LANDMARKS: KindDef[] = [empireState, chrysler, statueOfLiberty, oneWorldTradeCenter, brooklynBridge, flatiron, rockefellerCenter, radioCity];
