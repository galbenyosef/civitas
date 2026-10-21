/**
 * Street names (docs/roads.md "Street names"). A street is a straight run of road: the longest unbroken line of road
 * tiles along one axis. A crossroads belongs to both streets through it, a bend ends one street and starts the next,
 * and a street runs on through junctions, as Station Road does in a real town. The server names each street the first
 * time anyone asks (a hover, a building's address) and keeps the name from then on, so it never changes under the
 * player as the town grows; the owner can rename it (server/src/streets.ts). Names are British and chosen by what the
 * street is like: a lane for a short residential street, a close for a short dead end, a road for a long through
 * route, a street or parade for shops, an avenue for an avenue (R3 classes: both its carriageways share the name), a
 * lane for a country lane and a walk or row for a pedestrian street. No two neighbouring streets share a name.
 */

/** A straight run of road: along x (`ns` false, `line` is y) or along y (`ns` true, `line` is x), tiles `from`..`to`. */
export interface StreetRun { ns: boolean; line: number; from: number; to: number }
/** The line a street lies on, for indexing ('h12' runs east-west along y = 12, 'v-3' north-south along x = -3). */
export const streetLine = (r: StreetRun) => `${r.ns ? 'v' : 'h'}${r.line}`;
export const streetLength = (r: StreetRun) => r.to - r.from + 1;
/** The tile `i` of a street (0 is its `from` end). */
export const streetTile = (r: StreetRun, i: number): [number, number] => (r.ns ? [r.line, r.from + i] : [r.from + i, r.line]);
/** Longest street the scan follows (a much longer straight road is named by the stretch round the tile asked about). */
export const STREET_SCAN_MAX = 512;

/** The straight run through road tile (x, y) along one axis. */
export function streetRun(x: number, y: number, ns: boolean, isRoadAt: (x: number, y: number) => boolean): StreetRun {
  const along = ns ? y : x, line = ns ? x : y;
  const at = (i: number) => (ns ? isRoadAt(line, i) : isRoadAt(i, line));
  let from = along, to = along;
  while (along - from < STREET_SCAN_MAX && at(from - 1)) from--;
  while (to - along < STREET_SCAN_MAX && at(to + 1)) to++;
  return { ns, line, from, to };
}

/**
 * The streets a road tile is part of: the run along each axis on which it has a road beside it (two at a crossroads
 * or a bend), the longer first; a tile with no road beside it is a street of its own, east-west.
 */
export function streetsThrough(x: number, y: number, isRoadAt: (x: number, y: number) => boolean): StreetRun[] {
  if (!isRoadAt(x, y)) return [];
  const out: StreetRun[] = [];
  if (isRoadAt(x - 1, y) || isRoadAt(x + 1, y)) out.push(streetRun(x, y, false, isRoadAt));
  if (isRoadAt(x, y - 1) || isRoadAt(x, y + 1)) out.push(streetRun(x, y, true, isRoadAt));
  if (!out.length) out.push({ ns: false, line: y, from: x, to: x });
  return out.sort((a, b) => streetLength(b) - streetLength(a));
}

/** What a street is like when it is named: it picks the suffix. */
export interface StreetCharacter {
  length: number;
  /** ends that meet other road (a junction or a bend) rather than stopping short */
  joined: 0 | 1 | 2;
  /** frontage on both sides, by zone: homes, shops, works (industry), offices */
  homes: number; shops: number; works: number; offices: number;
  /** R3: an avenue class names itself an Avenue */
  avenue?: boolean;
  /** R3: most of it is a country lane (a Lane) or a pedestrian street (a Walk or a Row) */
  lane?: boolean; pedestrian?: boolean;
}

const BASES = [
  'Station', 'Mill', 'Church', 'Victoria', 'Albert', 'King', 'Queen', 'Park', 'Manor', 'Chapel', 'School', 'Bridge', 'Castle',
  'Market', 'Orchard', 'Meadow', 'Elm', 'Oak', 'Ash', 'Beech', 'Willow', 'Cedar', 'Holly', 'Hawthorn', 'Chestnut', 'Lime',
  'Cherry', 'Rose', 'Grove', 'York', 'Windsor', 'Richmond', 'Clarence', 'Gloucester', 'Cambridge', 'Oxford', 'Regent',
  'Princes', 'Wellington', 'Nelson', 'Trafalgar', 'Waterloo', 'Grange', 'Rectory', 'Vicarage', 'Abbey', 'Priory', 'Well',
  'Spring', 'Brook', 'River', 'Mead', 'Field', 'Hill', 'Wood', 'Forest', 'Heath', 'Common', 'Farm', 'Barn', 'Cross', 'Tower',
  'Canal', 'Wharf', 'Foundry', 'Brewery', 'Granby', 'Belgrave', 'Cavendish', 'Grosvenor', 'Portland', 'Russell', 'Bedford',
  'Devonshire', 'Marlborough', 'Salisbury', 'Stanley', 'Gladstone', 'Palmerston', 'Peel', 'Cromwell', 'Milton', 'Chaucer',
  'Tennyson', 'Byron', 'Shelley', 'Darwin', 'Newton', 'Faraday', 'Brunel', 'Stephenson', 'Telford', 'Nightingale', 'Alma',
  'Inkerman', 'Jubilee', 'Coronation', 'Union', 'Providence', 'Hope', 'Pleasant', 'Mount', 'Fountain', 'Moor', 'Marsh',
  'Sandy', 'Stony', 'Long', 'Broad', 'New', 'West', 'East', 'North', 'South', 'Back', 'Silver', 'Lark', 'Linden', 'Hazel',
  'Rowan', 'Laurel', 'Primrose', 'Bluebell', 'Clifton', 'Hampton', 'Ashford', 'Melbourne', 'Sefton', 'Derwent', 'Severn',
  'Avon', 'Trent', 'Thames', 'Tyne', 'Mersey', 'Lancaster', 'Durham', 'Kent', 'Essex', 'Sussex', 'Dorset', 'Somerset',
  'Warwick', 'Stafford', 'Chester', 'Lincoln', 'Norfolk', 'Suffolk', 'Arundel', 'Howard', 'Percy', 'Neville', 'Spencer',
  'Hastings', 'Dudley', 'Carlton', 'Ellesmere', 'Kingsley', 'Tudor', 'Beaufort', 'Bishop', 'Garden', 'Pond', 'Pound', 'Copse',
] as const;

/** Suffixes by what the street is like; a hash picks within each list. */
const SUFFIX = {
  mews: ['Mews', 'Court', 'Yard'],
  close: ['Close', 'Close', 'Court', 'Gardens'],
  shopsLong: ['Street', 'Street', 'Parade'],
  shopsShort: ['Parade', 'Row', 'Street'],
  works: ['Road', 'Way', 'Lane'],
  offices: ['Street', 'Place', 'Row'],
  lane: ['Lane', 'Lane', 'Terrace', 'Grove', 'Row', 'Gardens', 'Walk'],
  through: ['Road', 'Road', 'Road', 'Way'],
  street: ['Street', 'Road', 'Terrace', 'Street'],
  avenue: ['Avenue'],
  country: ['Lane'],
  pedestrian: ['Walk', 'Row', 'Walk'],
} as const;

/** The suffix list for a street of this character. */
export function streetSuffixes(c: StreetCharacter): readonly string[] {
  if (c.avenue) return SUFFIX.avenue;
  if (c.lane) return SUFFIX.country;
  if (c.pedestrian) return SUFFIX.pedestrian;
  if (c.length <= 3 && c.joined <= 1) return SUFFIX.mews;
  const front = c.homes + c.shops + c.works + c.offices;
  if (c.joined <= 1 && c.length <= 10 && c.homes >= c.shops + c.works + c.offices) return SUFFIX.close;
  if (front && c.shops * 2 >= front) return c.length >= 12 ? SUFFIX.shopsLong : SUFFIX.shopsShort;
  if (front && c.works * 2 >= front) return SUFFIX.works;
  if (front && c.offices * 2 >= front) return SUFFIX.offices;
  if (c.length <= 8) return SUFFIX.lane;
  if (c.length >= 14 && c.joined === 2) return SUFFIX.through;
  return SUFFIX.street;
}

/** A 32-bit hash of the world seed, the street's line and its first tile, and a salt (tries 1, 2... after a clash). */
function streetHash(seed: number, r: StreetRun, salt: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  for (const v of [r.ns ? 1 : 2, r.line, r.from, salt]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** The part of a name a neighbour must not share ('Mill' of 'Mill Lane'). */
export const streetBase = (name: string) => name.replace(/\s+\S+$/, '');

/**
 * The name for a street: a base from the list and a suffix for its character, from a hash of the world seed and where
 * the street lies. `taken` holds the bases of the streets round it (crossing it and running alongside); the name is
 * re-rolled until its base is not one of them, so neighbours never share a name. Deterministic: the same street, its
 * character and its neighbours give the same name on every server.
 */
export function streetName(seed: number, r: StreetRun, c: StreetCharacter, taken?: ReadonlySet<string>): string {
  const suffixes = streetSuffixes(c);
  let first = '';
  for (let salt = 0; salt < 12; salt++) {
    const h = streetHash(seed, r, salt);
    const base = BASES[h % BASES.length];
    const name = `${base} ${suffixes[(h >>> 16) % suffixes.length]}`;
    if (!salt) first = name;
    if (!taken?.has(base)) return name;
  }
  return first;
}

/** Longest name a player may give a street. */
export const STREET_NAME_MAX = 32;
/** A player's name for a street, tidied: trimmed, inner spaces single, printable, at most STREET_NAME_MAX; '' if nothing is left. */
export function cleanStreetName(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, STREET_NAME_MAX).trim();
}

/**
 * How many pairs of streets share a base name while crossing or running alongside each other (lines within `near`
 * tiles whose stretches overlap): what "no two neighbouring streets alike" forbids. Streets on the same line do not
 * count (a street broken by a gap keeps its name on both sides).
 */
export function streetClashes(list: readonly (StreetRun & { name: string })[], near = 8): number {
  let n = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (streetBase(a.name) !== streetBase(b.name)) continue;
    if (a.ns === b.ns && a.name === b.name && Math.abs(a.line - b.line) === 1) continue; // a dual carriageway's two rows: one street
    const meet = a.ns === b.ns
      ? a.line !== b.line && Math.abs(a.line - b.line) <= near && a.from <= b.to && b.from <= a.to
      : b.line >= a.from - 1 && b.line <= a.to + 1 && a.line >= b.from - 1 && a.line <= b.to + 1;
    if (meet) n++;
  }
  return n;
}
