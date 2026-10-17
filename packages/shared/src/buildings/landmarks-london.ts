import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { office } from './office';
import { theatre } from './leisure';
import { slab, tree, lampPost, flags, PAVING } from './tierkit';
import { LONDON_LANDMARKS_B } from './landmarks-london-2';

/**
 * London landmarks (docs/buildings.md "Landmarks"): recognisable real buildings, tagged 'london', each a placed civic
 * kind that works as an existing role: the towers are offices (jobs, office visitors), the opera house a theatre-family
 * venue. They are rungs of the 'london' collection (groups.ts), so the tool bar shows one London button whose picker
 * lists them, and their tools are unlocked only by the locked tech node 'lnd1' (tech.ts): a live game cannot place
 * them until their unlock rule is decided; sandboxes (test cities, demos) and ?dev clients can.
 *
 * Kind ids 91-100:
 *   91 the Gherkin, 92 the Shard, 93 the Walkie Talkie, 94 One Canada Square, 95 the Royal Opera House (this file)
 *   reserved for the second five (tools already listed in 'lnd1'): 96 Big Ben and the Houses of Parliament ('bigben'),
 *   97 the London Eye ('londoneye'), 98 the Tower of London ('toweroflondon'), 99 Buckingham Palace ('buckingham'),
 *   100 Tower Bridge ('towerbridge'); collection tiers 6-10 in that order.
 *
 * Scale: about 33 m to a tile, so the Shard (310 m) is the tallest thing in London at 9.6 tiles, One Canada Square
 * 7.2, the Gherkin 5.5 and the Walkie Talkie 4.9 (the merged supertall, kind 81 level 7, is 8). Each landmark has one
 * design: it is one building, not a type; per-instance variation comes from the window lighting as everywhere else.
 */

const TAGS = ['london'];
const towerBase = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 }, landmark: true, tags: TAGS, group: 'london',
};

// ================================================================= the Gherkin (30 St Mary Axe)

/** The bullet: widest a third of the way up, closing to a glass lens; sampled every 0.3 tiles so the spirals wind smoothly. */
const GHERKIN_H = 5.4;
const gherkinProfile = (): number[] => {
  const out: number[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = t * GHERKIN_H;
    // a bulge at t ~ 0.3 over a base a little narrower, then an ogive to the tip
    const r = t < 0.3 ? 0.72 + 0.14 * Math.sin((t / 0.3) * Math.PI / 2) : 0.86 * Math.sqrt(Math.max(0, 1 - ((t - 0.3) / 0.7) ** 2.2));
    out.push(+r.toFixed(3), +y.toFixed(3));
  }
  return out;
};

export const gherkin: KindDef = {
  ...towerBase, id: 'gherkin', name: 'the Gherkin', kindId: 91, tier: 1,
  footprint: { w: 2, h: 2, door: [1, 1] },
  blurb: '30 St Mary Axe: the City\'s glass bullet with its dark spiral bands. A landmark office tower of 40 storeys.',
  howTo: 'A 2×2 plot in the City, among other offices; it draws commuters like any office tower. London landmark: unlock rule to be decided.',
  tool: { id: 'gherkin', key: '', label: 'The Gherkin', color: '#3f6f5a' },
  levels: [{
    capacity: 240, wage: 44, cost: 16000, upkeep: 90, work: 2600, parking: { surface: 0, underground: 60 },
    designs: [
      { name: 'tapered glass bullet with dark spiral glazing bands', height: GHERKIN_H + 0.02, ops: [
        slab(2, 2, PAVING),
        ['lathe', 0, 0.02, 0, 0x8fb2c4, gherkinProfile(), { seg: 36, twist: 38, stripe: 0x24343f, every: 6, width: 2, win: 'office' }],
        // the plaza: low granite benches and a few trees round the base
        ...repeat(4, (i): Op => ['box', 0.3, 0.05, 0.08, -0.6 + i * 0.4, 0.02, 0.92, 'stone']),
        ...tree(-0.85, -0.85, 0.7), ...tree(0.85, -0.85, 0.7),
      ] },
    ],
  }],
};

// ================================================================= the Shard

/**
 * Eight glass shards leaning on a darker core, two to a side and staggered, so the fissures between them read dark;
 * near the top they run past the core and splay apart into the broken crown.
 */
const SHARD_HALF = 0.95, SHARD_SLOPE = 0.094, SHARD_CORE = 8.5;
const shard = (): Op[] => {
  const ops: Op[] = [];
  const coreTop = 2 * (SHARD_HALF - SHARD_SLOPE * SHARD_CORE);
  // core: a square frustum in darker glass, so the fissures between the shards read dark
  ops.push(['taper', 2 * SHARD_HALF, 2 * SHARD_HALF, coreTop, coreTop, SHARD_CORE, 0, 0.02, 0, 0x4a5f72]);
  // each side [normal x, z] carries two shards, set out by different amounts and stopping at different heights
  const sides: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const bodyTop = [8.0, 8.45, 8.2, 8.6, 7.9, 8.35, 8.55, 8.1];
  const crown = [1.3, 1.05, 1.4, 1.0, 1.35, 1.25, 0.95, 1.5];
  sides.forEach(([nx, nz], s) => {
    const tx = -nz, tz = nx; // along the side
    for (let half = 0; half < 2; half++) {
      const k = s * 2 + half, sign = half ? 1 : -1, out = SHARD_HALF + (half ? 0.035 : 0.06);
      // the half spans from the side's middle (a fissure's width off it) to short of the corner, narrowing as the side does
      const span = (y: number) => { const hw = SHARD_HALF - SHARD_SLOPE * y; const a = 0.035, b = Math.max(a + 0.03, hw - 0.07); return [(a + b) / 2, b - a]; };
      const y1 = bodyTop[k], [c0, w0] = span(0), [c1, w1] = span(y1);
      const out1 = out - SHARD_SLOPE * y1, thick = 0.05;
      const dims = (w: number): [number, number] => (nz !== 0 ? [w, thick] : [thick, w]);
      const bx = nx * out + tx * sign * c0, bz = nz * out + tz * sign * c0;
      const tx1 = nx * out1 + tx * sign * c1, tz1 = nz * out1 + tz * sign * c1;
      const [bw, bd] = dims(w0), [tw, td] = dims(w1);
      ops.push(['taper', bw, bd, tw, td, y1, bx, 0.02, bz, 0xbcd0df, { win: 'office', shift: [tx1 - bx, tz1 - bz] }]);
      // the splinter above: it keeps rising past the core and leans out a little, narrowing to an edge
      const h2 = crown[k], lean = 0.025 + 0.015 * half;
      const cx = nx * (out1 + lean) + tx * sign * (c1 + 0.03), cz = nz * (out1 + lean) + tz * sign * (c1 + 0.03);
      const [ew, ed] = dims(0.07);
      ops.push(['taper', tw, td, ew, ed, h2, tx1, 0.02 + y1, tz1, 0xd2e0ea, { shift: [cx - tx1, cz - tz1] }]);
    }
  });
  return ops;
};

export const theShard: KindDef = {
  ...towerBase, id: 'shard', name: 'the Shard', kindId: 92, tier: 2,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'London Bridge\'s glass pyramid of eight leaning shards, the tallest building in the city: offices, a hotel and a viewing gallery under its broken crown.',
  howTo: 'A 3×3 plot by a station: it holds the most jobs of any building, so give it rail or buses. London landmark: unlock rule to be decided.',
  tool: { id: 'shard', key: '', label: 'The Shard', color: '#7fa3bf' },
  levels: [{
    capacity: 420, wage: 46, cost: 30000, upkeep: 150, work: 5200, parking: { surface: 0, underground: 80 },
    designs: [
      { name: 'faceted glass pyramid of eight shards with a splayed crown', height: 9.62, ops: [
        slab(3, 3, PAVING),
        ...shard(),
        // the station side: a low glass concourse canopy along the front
        ['box', 2.4, 0.18, 0.3, 0, 0.02, 1.25, 0xb9cddb], ['box', 2.44, 0.03, 0.34, 0, 0.2, 1.25, 'steel'],
        ...tree(-1.25, -1.25, 0.6), ...tree(1.25, -1.25, 0.6),
      ] },
    ],
  }],
};

// ================================================================= the Walkie Talkie (20 Fenchurch Street)

/** Top-heavy: the floors get deeper (along z) as it rises, so the front and back bow outwards; the sky garden sits under a sloping glass roof. */
const WT_H = 4.3;
const walkieTalkie = (): Op[] => {
  const ops: Op[] = [];
  const n = 10;
  const depth = (t: number) => 1.05 + 1.25 * t ** 1.8, width = (t: number) => 1.66 + 0.14 * t;
  // three columns per slice, the middle one deeper, so the front and back bow out in plan as well as in section
  const BOW = 0.86;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, y0 = 0.02 + t0 * WT_H, h = (t1 - t0) * WT_H;
    const w0 = width(t0) / 3, w1 = width(t1) / 3, d0 = depth(t0), d1 = depth(t1);
    ops.push(['taper', w0 + 0.002, d0, w1 + 0.002, d1, h, 0, y0, 0, 0x8fb0c6, { win: 'office' }]);
    for (const sx of [-1, 1]) ops.push(['taper', w0, d0 * BOW, w1, d1 * BOW, h, sx * w0, y0, 0, 0x87a8bf, { win: 'office', shift: [sx * (w1 - w0), 0] }]);
  }
  // sky garden: a band of planting at the top floor and the sloping glass roof over it, rising to the back, with its ribs
  const top = 0.02 + WT_H, d = depth(1), w = width(1), ridge = 0.35, rise = 0.62;
  ops.push(['box', w, 0.07, d * 0.97, 0, top, 0, 0x4f8a45]);
  ops.push(['taper', w, d * 0.97, w, ridge, rise, 0, top + 0.07, 0, 0xa6c8db, { shift: [0, -(d * 0.97 - ridge) / 2] }]);
  for (let r = 0; r < 5; r++) {
    const x = -w / 2 + 0.05 + r * ((w - 0.1) / 4);
    ops.push(['taper', 0.025, d * 0.97 + 0.01, 0.025, ridge + 0.01, rise + 0.012, x, top + 0.07, 0, 0x55646f, { shift: [0, -(d * 0.97 - ridge) / 2] }]);
  }
  return ops;
};

export const walkieTalkieKind: KindDef = {
  ...towerBase, id: 'walkie-talkie', name: 'the Walkie Talkie', kindId: 93, tier: 3,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: '20 Fenchurch Street: the top-heavy tower that bulges outwards as it rises, with a public sky garden under its glass roof.',
  howTo: 'A 3×3 plot in the City; its top floors overhang the plot, so leave the street in front clear. London landmark: unlock rule to be decided.',
  tool: { id: 'walkietalkie', key: '', label: 'The Walkie Talkie', color: '#5d86a6' },
  levels: [{
    capacity: 300, wage: 44, cost: 20000, upkeep: 110, work: 3600, parking: { surface: 0, underground: 70 },
    designs: [
      { name: 'curved slab widening to the top with a sky garden under a glass roof', height: 5.02, ops: [
        slab(3, 3, PAVING),
        ...walkieTalkie(),
        ...tree(-1.2, 1.2, 0.6), ...tree(1.2, 1.2, 0.6),
      ] },
    ],
  }],
};

// ================================================================= One Canada Square

/** Canary Wharf's stainless steel tower: a square shaft with recessed corners, a pyramid roof and the aircraft light. */
const OCS_H = 6.4;
const canadaSquare = (): Op[] => [
  slab(3, 3, PAVING),
  // Canada Square park in front: lawn, a round fountain pool and trees
  ['box', 2.3, 0.02, 0.9, 0, 0.02, 0.9, 'lawn'], ['cyl', 0.24, 0.26, 0.04, 0, 0.04, 0.9, 'stone', 20], ['cyl', 0.2, 0.2, 0.042, 0, 0.04, 0.9, 'pond', 20],
  ...tree(-0.9, 0.9, 0.8), ...tree(0.9, 0.9, 0.8), ...tree(-0.45, 1.2, 0.6), ...tree(0.45, 1.2, 0.6),
  // the shaft: a facade of 26 storeys, its corners plain and set back
  ['box', 1.36, OCS_H, 1.36, 0, 0.02, -0.4, 0xc9cfd6, true, { name: 'shaft', facade: { storeys: 26, bays: 8, margin: 0.1, ground: 'door' } }],
  ['awning', 'shaft', 'front', 3, 5, 'steel'],
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Op => ['box', 0.08, OCS_H, 0.08, sx * 0.66, 0.02, -0.4 + sz * 0.66, 0x9aa1aa]),
  ['box', 1.4, 0.06, 1.4, 0, 0.02 + OCS_H, -0.4, 0xb4bac2],
  // the pyramid, and the aircraft warning light at its tip
  ['taper', 1.36, 1.36, 0, 0, 0.72, 0, 0.08 + OCS_H, -0.4, 0xd4d9df],
  ['cyl', 0.03, 0.03, 0.06, 0, 0.08 + OCS_H + 0.62, -0.4, 'red', 6],
];

export const canadaSquareKind: KindDef = {
  ...towerBase, id: 'one-canada-square', name: 'One Canada Square', kindId: 94, tier: 4,
  footprint: { w: 3, h: 3, door: [1, 2] },
  blurb: 'Canary Wharf\'s stainless steel tower with its pyramid roof and blinking aircraft light: fifty storeys of banks and newspapers.',
  howTo: 'A 3×3 plot with its park in front; set it among offices at the heart of a business district. London landmark: unlock rule to be decided.',
  tool: { id: 'canadasquare', key: '', label: 'One Canada Square', color: '#a7afb8' },
  levels: [{
    capacity: 380, wage: 46, cost: 26000, upkeep: 130, work: 4600, parking: { surface: 0, underground: 90 },
    designs: [
      { name: 'stainless steel tower with a pyramid roof, an aircraft light and a park in front', height: 7.22, ops: canadaSquare() },
    ],
  }],
};

// ================================================================= the Royal Opera House

/**
 * Covent Garden: the stone house on Bow Street with its portico of six columns and pediment, the fly tower behind,
 * and beside it the Floral Hall, a glass and iron barrel vault whose arched end faces the street.
 */
const royalOpera = (): Op[] => [
  slab(4, 3, PAVING),
  // the house (windows down its sides and back) behind a plain stone front on Bow Street, and its fly tower
  ['box', 2.1, 0.9, 1.7, 0.75, 0.02, -0.5, 0xe9dcc0, true, { name: 'house', facade: { storeys: 3, bays: 9, sideBays: 7, margin: 0.06 } }],
  ['box', 2.1, 0.9, 0.2, 0.75, 0.02, 0.45, 0xe9dcc0],
  ['box', 2.14, 0.06, 1.94, 0.75, 0.92, -0.4, 0xd6c8a8],
  ['box', 1.3, 1.65, 1.0, 0.75, 0.02, -0.75, 0xd9cdb3], ['box', 1.32, 0.05, 1.02, 0.75, 1.67, -0.75, 'roofGrey'],
  // the portico: six columns standing on the rusticated ground storey with its three arched doors, entablature and pediment
  ['box', 1.36, 0.3, 0.4, 0.75, 0.02, 0.75, 0xd9cdb3],
  ...repeat(3, (i): Op => ['box', 0.16, 0.22, 0.02, 0.45 + i * 0.3, 0.02, 0.955, 'door']),
  ...repeat(3, (i): Op => ['lathe', 0.45 + i * 0.3, 0.24, 0.944, 'door', [0.08, 0, 0.08, 0.02], { seg: 12, axis: 'z' }]),
  ...repeat(6, (i): Op => ['cyl', 0.042, 0.048, 0.5, 0.2 + i * 0.22, 0.32, 0.84, 0xf3ecdc, 10]),
  ['box', 1.36, 0.08, 0.38, 0.75, 0.82, 0.76, 0xf3ecdc],
  ['roof', 1.36, 0.2, 0.38, 0.75, 0.9, 0.76, 0xf3ecdc, true],
  // the Floral Hall: glazed walls under a barrel vault, its arched end on the street
  ['box', 1.4, 0.7, 2.2, -1.2, 0.02, -0.3, 0x9cc0d2, 'venue', { name: 'floral', facade: { storeys: 2, bays: 4, sideBays: 6 } }],
  ['lathe', -1.2, 0.72, -1.41, 0x9cc2d6, [0.7, 0, 0.7, 2.22, 0, 2.22], { seg: 48, axis: 'z', stripe: 0x5d7684, every: 4, width: 1 }],
  // marquee lamps and flags along Bow Street
  ...lampPost(-0.3, 1.25, 0.36, 'marquee'), ...lampPost(1.8, 1.25, 0.36, 'marquee'),
  ...flags(0.25, 1.0, 3, 0.5, ['red', 'gold', 'red'], 0.12),
];

export const royalOperaHouse: KindDef = {
  id: 'royal-opera-house', name: 'the Royal Opera House', code: 12, kindId: 95, family: 'leisure',
  flags: { civic: true, workplace: true, leisureReady: true }, windows: 'venue',
  landmark: true, tags: TAGS, group: 'london', tier: 5,
  footprint: { w: 4, h: 3, door: [2, 2] },
  blurb: 'Covent Garden\'s opera and ballet house: a portico of six columns on Bow Street and the glass Floral Hall beside it. Gala nights draw the whole city.',
  howTo: 'A 4×3 plot facing a street, near restaurants and bars for the pre-theatre crowd. London landmark: unlock rule to be decided.',
  tool: { id: 'royalopera', key: '', label: 'Royal Opera House', color: '#8c1d2b' },
  occupation: { ...theatre.occupation!, name: 'opera house staff' },
  attrs: {
    ...theatre.attrs, visitorCapacity: 200, ticket: 28, leisureValue: 11, radius: 30, eventSize: 2, eventNights: [1, 2, 4, 5], stay: [2.8, 3.8],
    retireeAppeal: 1.7, title: 'Royal Opera House',
  },
  lot: { wage: 21 },
  levels: [{
    capacity: 40, wage: 21, cost: 9000, upkeep: 90, work: 2200, parking: { surface: 0, underground: 40 },
    designs: [
      { name: 'neoclassical portico beside the glass barrel vault of the Floral Hall', height: 1.72, ops: royalOpera() },
    ],
  }],
};

/** The landmarks of this file and of landmarks-london-2.ts (96-100), in kind-id order (catalogue.ts lists them). */
export const LONDON_LANDMARKS: KindDef[] = [gherkin, theShard, walkieTalkieKind, canadaSquareKind, royalOperaHouse, ...LONDON_LANDMARKS_B];
