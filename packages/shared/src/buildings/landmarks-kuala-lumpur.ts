import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { library } from './leisure';
import { office } from './office';
import { slab, tree, lampPost, flags, PAVING } from './tierkit';

/**
 * Kuala Lumpur landmarks (docs/buildings.md "Landmarks"): the buildings of the
 * capital between the jungle and the tin mines, tagged 'world' and 'kuala-lumpur',
 * rungs of the 'kuala-lumpur' collection (groups.ts), tiers 1-4, their tools
 * unlocked only by the locked tech node 'wld1' (tech.ts) like the other world
 * cities. Kind ids 201-204 (see landmarks-world.ts for the world allocation).
 * Scale: about 33 m to a tile, as for London.
 *
 * The set, in tier order:
 *   201 the Petronas Towers: an office tower, the twin steel spires joined by
 *       their double-decker skybridge
 *   202 the KL Tower: an office tower, the observatory needle above the forest
 *       hill in the middle of the city
 *   203-204 to follow, one building at a time.
 */

const TAGS = ['world', 'kuala-lumpur'];

// shared base for the office towers, as in landmarks-beijing.ts
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'kuala-lumpur',
};

// ================================================================= 201 the Petronas Towers

/**
 * The twin towers the prime minister willed into being: two faceted shafts of
 * stainless steel and glass rising out of a fountain court, joined at the
 * forty-first floor by the double-decker skybridge, each crowned with its
 * spire and aircraft light. Plain metal and glass only, so no window rule is
 * touched.
 */
const PETRONAS_STEEL = 0xc9d2d8, PETRONAS_GLASS = 0x9fb8cc;

const petronasOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, PAVING)];
  // the twin shafts with their spires
  for (const sx of [-1, 1] as const) {
    ops.push(['taper', 0.36, 0.36, 0.22, 0.22, 5.6, sx * 0.42, 0.02, -0.05, PETRONAS_STEEL]);
    ops.push(['cyl', 0.03, 0.045, 0.75, sx * 0.42, 5.62, -0.05, 'steel', 8]);
    ops.push(['cone', 0.035, 0.12, sx * 0.42, 6.37, -0.05, 'steel', 8]);
    ops.push(['cyl', 0.02, 0.02, 0.04, sx * 0.42, 6.49, -0.05, 'red', 6]);
  }
  // the double-decker skybridge at the forty-first floor
  ops.push(['box', 0.62, 0.1, 0.16, 0, 2.2, -0.05, PETRONAS_GLASS]);
  // the fountain court: a reflecting pool, lamps, trees
  ops.push(['cyl', 0.3, 0.32, 0.02, 0, 0.02, 0.6, 'pond', 16]);
  ops.push(...lampPost(-0.7, 0.88, 0.3, 'marquee', 0.02), ...lampPost(0.7, 0.88, 0.3, 'marquee', 0.02));
  ops.push(...tree(-0.8, -0.72, 0.5), ...tree(0.8, -0.72, 0.5));
  return ops;
};

export const petronasTowers: KindDef = {
  ...towerBase, id: 'petronas-towers', name: 'the Petronas Towers', kindId: 201, tier: 1,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The twin towers the prime minister willed into being: two faceted shafts of steel and glass rising out of the fountain court, joined at the forty-first floor by the double-decker skybridge, each crowned with its spire.',
  howTo: 'A 2×2 plot among offices on an avenue; a very big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'petronas', key: '', label: 'Petronas Towers', color: '#9fb8cc' },
  levels: [{
    capacity: 520, wage: 46, cost: 26000, upkeep: 150, work: 4800, parking: { surface: 0, underground: 90 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the twin steel spires joined by the double-decker skybridge over the fountain court', height: 6.55, ops: petronasOps() },
    ],
  }],
};

// ================================================================= 202 the KL Tower

/**
 * The needle above the forest hill in the middle of the city: the tower raised on
 * Bukit Nanas, the last patch of jungle in the centre, its concrete shaft swelling
 * into the great bulb of the observation deck, the upper deck and the mast under
 * the aircraft beacon. Plain concrete and glass only, so no window rule is touched.
 */
const KL_CONCRETE = 0xb0a89a, KL_DECK = 0x8a97a8;

const klTowerOps = (): Op[] => {
  const ops: Op[] = [slab(2, 2, 'lawn')];
  // the forest hill of Bukit Nanas with its trees
  ops.push(...tree(-0.78, -0.68, 0.55, 'green'), ...tree(0.78, -0.62, 0.5, 'green'), ...tree(-0.82, 0.55, 0.5, 'green'));
  // the shaft out of the hill, swelling into the bulb of the observation deck
  ops.push(['lathe', 0, 0.18, 0, KL_CONCRETE, [0.3, 0, 0.24, 2.2, 0.19, 3.9], { seg: 12 }]);
  ops.push(['lathe', 0, 4.08, 0, KL_DECK, [0.19, 0, 0.46, 0.2, 0.5, 0.5, 0.42, 0.68], { seg: 16, win: 'office' }]);
  // the upper deck, the mast and the aircraft beacon
  ops.push(['cyl', 0.32, 0.32, 0.06, 0, 4.76, 0, KL_CONCRETE, 12]);
  ops.push(['cyl', 0.008, 0.02, 0.55, 0, 4.82, 0, 'steel', 6]);
  ops.push(['cyl', 0.03, 0.03, 0.05, 0, 5.37, 0, 'red', 6]);
  // the flags at the foot of the hill
  ops.push(...flags(-0.5, 0.82, 3, 0.5, ['red', 'white', 'navy'], 0.02));
  ops.push(...lampPost(-0.7, 0.7, 0.3, 'marquee', 0.02), ...lampPost(0.7, 0.7, 0.3, 'marquee', 0.02));
  return ops;
};

export const klTower: KindDef = {
  ...towerBase, id: 'kl-tower', name: 'the KL Tower', kindId: 202, tier: 2,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: 'The needle above the forest hill: the tower raised on Bukit Nanas, the last patch of jungle in the centre of the city, its shaft swelling into the great bulb of the observation deck, the whole town spread out below.',
  howTo: 'A 2×2 plot among offices on an avenue; a big workplace, so give it buses or a station and leave the street clear. World landmark: unlock rule to be decided.',
  tool: { id: 'kltower', key: '', label: 'KL Tower', color: '#b0a89a' },
  levels: [{
    capacity: 300, wage: 44, cost: 18000, upkeep: 120, work: 4200, parking: { surface: 0, underground: 60 },
    designs: [
      { author: 'kimi-2.8-preview', name: 'the observatory needle above the forest hill, the bulb of the deck under the mast', height: 5.45, ops: klTowerOps() },
    ],
  }],
};

export const KUALA_LUMPUR_LANDMARKS: KindDef[] = [petronasTowers, klTower];
