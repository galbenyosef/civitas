import { hash2 } from './noise';

const FIRST = ['Ada', 'Amir', 'Anya', 'Arjun', 'Bea', 'Ben', 'Carla', 'Chen', 'Dara', 'Dev', 'Ellie', 'Emeka', 'Esme', 'Felix', 'Freya', 'Gus',
  'Hana', 'Hugo', 'Ines', 'Ivan', 'Jade', 'Jonah', 'Kai', 'Kira', 'Leo', 'Lina', 'Luca', 'Mae', 'Malik', 'Mira', 'Nadia', 'Noah',
  'Omar', 'Otis', 'Priya', 'Quinn', 'Rafa', 'Rosa', 'Sam', 'Sofia', 'Tariq', 'Tess', 'Uma', 'Viktor', 'Wren', 'Yara', 'Yusuf', 'Zoe'];
const LAST = ['Abara', 'Adler', 'Bianchi', 'Brooks', 'Castillo', 'Chen', 'Dubois', 'Fischer', 'Flores', 'Garcia', 'Haddad', 'Hansen',
  'Ibrahim', 'Jensen', 'Kaur', 'Kim', 'Kowalski', 'Laurent', 'Lindqvist', 'Mahmood', 'Marsh', 'Mendes', 'Moreau', 'Nakamura',
  'Novak', 'Okafor', 'Oliveira', 'Osei', 'Park', 'Patel', 'Petrov', 'Quist', 'Reyes', 'Rossi', 'Sato', 'Schmidt', 'Silva', 'Singh',
  'Tanaka', 'Torres', 'Varga', 'Walker', 'Weber', 'Whitfield', 'Yamada', 'Yilmaz', 'Zhang', 'Zulu'];

/** A surname from a seed (a citizen's own id, or the founder of the household they were born into). */
export function surnameFor(seed: number): string {
  return LAST[Math.floor(hash2(seed, 103) * LAST.length)];
}
/**
 * A stable name for a citizen id, the same on server and client. `surnameSeed` is the citizen's `sn`: their own id
 * for newcomers (so names never changed for anyone who existed before households), the household's seed for
 * children born here, who take the household surname.
 */
export function nameFor(id: number, surnameSeed = id): string {
  return `${FIRST[Math.floor(hash2(id, 101) * FIRST.length)]} ${surnameFor(surnameSeed)}`;
}

// ---------------------------------------------------------------- building names (shop fronts, company boards)

const TRADES = ['Bakery', 'Deli', 'Grocer', 'Florist', 'Books', 'Hardware', 'Pharmacy', 'Café', 'Barber', 'Tailor', 'Butcher',
  'Bistro', 'Diner', 'Wine Bar', 'Records', 'Toys', 'Cycles', 'Shoes', 'Optician', 'Laundry', 'Pizzeria', 'Noodle Bar', 'Bagels',
  'Hair Studio', 'Gallery', 'Sweet Shop', 'Kitchenware', 'Outfitters', 'Tea Room', 'Fishmonger', 'Cheese Shop', 'Stationers'];
const SHOP_ADJ = ['Golden', 'Corner', 'Little', 'Blue', 'Green', 'Red Door', 'Old Town', 'Lucky', 'Sunny', 'Copper', 'Velvet', 'Daily'];
const COMPANY = ['Associates', 'Partners', 'Group', 'Holdings', 'Consulting', '& Co', 'Capital', 'Insurance', 'Legal', 'Analytics', 'Media', 'Systems'];
const COMPANY_PRE = ['Apex', 'Meridian', 'Northgate', 'Bluestone', 'Crescent', 'Vertex', 'Harbour', 'Summit', 'Keystone', 'Lumen', 'Orbit', 'Atlas'];
const WORKS = ['Works', 'Engineering', 'Foundry', 'Fabrication', 'Metals', 'Plastics', 'Timber', 'Brewery', 'Print Works', 'Logistics', 'Textiles', 'Motors'];
const VENUE_NAMES: Record<string, string[]> = {
  cinema: ['The Roxy', 'Odeon', 'The Regal', 'Plaza', 'The Electric', 'Rio', 'The Lux', 'Picturehouse'],
  theatre: ['The Playhouse', 'Lyric Theatre', 'The Globe', 'Royal Theatre', 'The Empire', 'Little Theatre', 'The Alhambra', 'Grand Theatre'],
  sports: ['Sports Hall', 'Leisure Club', 'Fitness Centre', 'Athletics Club', 'Swim & Gym', 'Racquet Club', 'Boxing Club', 'Climbing Wall'],
  library: ['Public Library', 'Reading Room', 'Free Library', 'Library'],
};
const pickFrom = <T>(list: readonly T[], seed: number, salt: number) => list[Math.floor(hash2(seed, salt) * list.length)];
const cap = (s: string) => s.replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
/** The surname of the person a business is named after, from the pool's slot: the same list citizens' surnames come from. */
const surnameAt = (i: number, salt: number) => LAST[Math.floor(hash2(i, salt) * LAST.length)];

/**
 * Fixed pools of names that buildings take a slot from by position (so a renderer can draw each pool once into a
 * texture atlas). Pools are generated from the word lists above with a fixed seed, so they never change between
 * runs or between server and client.
 */
export const SIGN_POOLS: Record<string, string[]> = (() => {
  const gen = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
  return {
    shop: gen(96, (i) => {
      const t = pickFrom(TRADES, i, 211), r = hash2(i, 223);
      return r < 0.45 ? `${surnameAt(i, 227)}'s ${t}` : r < 0.75 ? `The ${pickFrom(SHOP_ADJ, i, 229)} ${t}` : `${FIRST[Math.floor(hash2(i, 233) * FIRST.length)]}'s ${t}`;
    }),
    store: gen(12, (i) => `${surnameAt(i, 241)} & ${surnameAt(i, 251)}`),
    mall: gen(12, (i) => `${surnameAt(i, 257)} ${pickFrom(['Arcade', 'Centre', 'Galleria', 'Shopping Centre'], i, 263)}`),
    hotel: gen(12, (i) => (hash2(i, 269) < 0.5 ? `Hotel ${surnameAt(i, 271)}` : `The ${surnameAt(i, 277)} Hotel`)),
    office: gen(48, (i) => (hash2(i, 281) < 0.5 ? `${pickFrom(COMPANY_PRE, i, 283)} ${pickFrom(COMPANY, i, 293)}` : `${surnameAt(i, 307)} ${pickFrom(COMPANY, i, 311)}`)),
    industry: gen(48, (i) => (hash2(i, 313) < 0.6 ? `${surnameAt(i, 317)} ${pickFrom(WORKS, i, 331)}` : `${pickFrom(COMPANY_PRE, i, 337)} ${pickFrom(WORKS, i, 347)}`)),
    ...Object.fromEntries(Object.entries(VENUE_NAMES).map(([k, v]) => [`venue:${k}`, v])),
  };
})();

/** Where a building's sign text comes from: a slot in one of the SIGN_POOLS, or a fixed text (the kind's own name). */
export type SignSource = { pool: string; index: number } | { text: string };

/**
 * The name on a building's front, stable for its anchor tile: shops, offices and works get a business name from the
 * pools, venues a house name, civic buildings and transport hubs their kind's name. `kind` is the manifest entry
 * (shared/src/buildings: family, commerceType, venueType, name). Homes have numbers instead (houseNumber).
 */
export function signSource(kind: { family: string; name: string; attrs: { commerceType?: string; venueType?: string; title?: string } }, x: number, y: number): SignSource {
  const pool = (p: string): SignSource => ({ pool: p, index: Math.floor(hash2(x * 31 + 7, y * 17 + 3) * SIGN_POOLS[p].length) });
  switch (kind.family) {
    case 'commercial': {
      const c = kind.attrs.commerceType;
      return pool(c === 'department store' ? 'store' : c === 'mall' ? 'mall' : c === 'hotel' ? 'hotel' : 'shop');
    }
    case 'office': return pool('office');
    case 'industrial': return pool('industry');
    case 'leisure': {
      const v = kind.attrs.venueType;
      if (kind.attrs.title) return { text: cap(kind.attrs.title) };
      return v && SIGN_POOLS[`venue:${v}`] ? pool(`venue:${v}`) : { text: cap(kind.name) };
    }
    default: return { text: cap(kind.name) };
  }
}
export function signText(s: SignSource): string { return 'text' in s ? s.text : SIGN_POOLS[s.pool][s.index]; }

/**
 * A plausible street number for a home: counted along the street it faces (the tile coordinate along the road),
 * odd on one side and even on the other. `r` is the quarter turn the front faces (0 +y, 1 +x, 2 -y, 3 -x).
 */
export function houseNumber(x: number, y: number, r: number): number {
  const along = r & 1 ? y : x;
  const n = ((along % 99) + 99) % 99;
  return 1 + n * 2 + (r < 2 ? 0 : 1);
}
