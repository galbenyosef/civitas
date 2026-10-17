import type { DemoRect, DemoXY, DemoSection, DemoPlacement, DemoBlock, TourStop } from './showcase';
import { KIND_ID } from '../buildings/compiled';
import { footprintOf, placedFromAnchor } from '../structures';

/**
 * London (docs/demo.md "London"): a sample city on the shape of the real one. The Thames runs through it as water
 * tiles with its recognisable meander (the Barnes loop, the Westminster bend, the loop round the Isle of Dogs, the
 * Greenwich peninsula) and widens east to the estuary. Around it the town is zoned roughly as London is: the City and
 * Canary Wharf dense offices, the West End shops and theatres, Westminster civic, rings of homes, industry down the
 * docks and the Thames Gateway, the big parks, Heathrow in the far west, the rail termini with their lines.
 *
 * This file is the map as data: the river, docks, places (each a name and a character that zones the blocks nearest
 * it), parks and the reserved land. The server's seeder (server/src/demo/london.ts) paints it into a World; the
 * scenario part (placements, track, lines, tour) is ordinary demo sections in showcase.ts.
 *
 * Coordinates: real latitude and longitude go through `geo`, 6 tiles a kilometre, Charing Cross at (-20, 0), x east,
 * y south. Roads are the usual grid, every 5th row and column, so a block is the 4×4 of lots between roads.
 */

/** tiles per kilometre */
const SCALE = 6;
/** Charing Cross, the traditional centre of London */
const CX_LAT = 51.5074, CX_LON = -0.1278;
/** Game coordinates (fractional) of a latitude and longitude. */
export const geoF = (lat: number, lon: number): [number, number] =>
  [(lon - CX_LON) * 69.4 * SCALE - 20, -(lat - CX_LAT) * 111.2 * SCALE];
/** Game tile of a latitude and longitude. */
export const geo = (lat: number, lon: number): DemoXY => { const [x, y] = geoF(lat, lon); return [Math.round(x), Math.round(y)]; };

/** The map: x, y, width, height. Everything inside is the town's land. */
export const LONDON_MAP: DemoRect = [-112, -56, 224, 112];

/** A point on the Thames' centre line: latitude, longitude, width in tiles, and the bridge there if any. */
export type ThamesPoint = readonly [lat: number, lon: number, width: number, bridge?: string];
/** Upstream (Teddington, off the south-west corner) to the estuary (off the east edge). */
export const THAMES: ThamesPoint[] = [
  [51.3900, -0.3400, 3.5],
  [51.4180, -0.3330, 3.5],
  [51.4450, -0.3250, 3.5],
  [51.4575, -0.3075, 3.5, 'Richmond Bridge'],
  [51.4705, -0.3215, 3.5],
  [51.4815, -0.3050, 3.5],
  [51.4875, -0.2870, 3.5, 'Kew Bridge'],
  [51.4725, -0.2700, 3.5, 'Chiswick Bridge'],
  [51.4720, -0.2530, 3.5],
  [51.4870, -0.2450, 3.5],
  [51.4880, -0.2300, 3.5, 'Hammersmith Bridge'],
  [51.4750, -0.2220, 3.5],
  [51.4665, -0.2130, 3.5, 'Putney Bridge'],
  [51.4650, -0.1880, 3.5, 'Wandsworth Bridge'],
  [51.4810, -0.1730, 4, 'Battersea Bridge'],
  [51.4845, -0.1500, 4, 'Chelsea Bridge'],
  [51.4880, -0.1270, 4, 'Vauxhall Bridge'],
  [51.4945, -0.1230, 4],
  [51.5008, -0.1218, 4, 'Westminster Bridge'],
  [51.5085, -0.1165, 4, 'Waterloo Bridge'],
  [51.5095, -0.1040, 4, 'Blackfriars Bridge'],
  [51.5079, -0.0877, 4, 'London Bridge'],
  [51.5055, -0.0754, 4, 'Tower Bridge'],
  [51.5040, -0.0560, 4.5],
  // from here the loops are drawn a little larger than life, so the Isle of Dogs and the Greenwich peninsula hold blocks
  [51.5074, -0.0413, 4.5],
  [51.5029, -0.0329, 4.5],
  [51.4894, -0.0329, 4.5],
  [51.4782, -0.0269, 4.5],
  [51.4759, -0.0113, 4.5],
  [51.4834, 0.0055, 4.5],
  [51.4969, 0.0091, 5],
  [51.5067, 0.0115, 5, 'Blackwall Tunnel'],
  [51.5104, 0.0199, 5],
  [51.5074, 0.0295, 5],
  [51.4969, 0.0319, 5.5],
  [51.4894, 0.0403, 6],
  [51.4960, 0.0620, 7, 'Woolwich Ferry'],
  [51.5030, 0.0850, 9],
  [51.5100, 0.0980, 9],
  [51.5130, 0.1250, 11],
  [51.5080, 0.1600, 13],
  [51.4900, 0.1900, 13],
  [51.4800, 0.2200, 16],
  [51.4700, 0.2700, 18],
];

/** A box of latitude and longitude: north, west, south, east. */
export type GeoBox = readonly [n: number, w: number, s: number, e: number];

/** Dock basins: water inside the land (game rects; the gaps are the roads across them). */
export const DOCKS: { name: string; rect: DemoRect }[] = [
  { name: 'West India Docks', rect: [21, 5, 4, 1] },
  { name: 'West India Docks', rect: [26, 5, 4, 1] },
  { name: 'West India Docks', rect: [21, 10, 4, 1] },
  { name: 'West India Docks', rect: [26, 10, 4, 1] },
  { name: 'Royal Victoria Dock', rect: [46, -3, 9, 2] },
  { name: 'Royal Albert Dock', rect: [56, -3, 14, 2] },
];

/**
 * What a place zones its blocks as. city: offices and merged towers; westend: shops, offices and venues; civic:
 * offices and government; inner: dense homes with shops; outer: homes with high streets; suburb: low homes with
 * gardens; industry: works and depots.
 */
export type Character = 'city' | 'westend' | 'civic' | 'inner' | 'outer' | 'suburb' | 'industry';
/** A named place: latitude, longitude, character and reach (a bigger reach claims more blocks). */
export type Place = readonly [name: string, lat: number, lon: number, character: Character, reach?: number];
export const PLACES: Place[] = [
  ['City of London', 51.5145, -0.0920, 'city', 1.1],
  ['Canary Wharf', 51.4964, -0.0198, 'city', 0.6],
  ['Isle of Dogs', 51.4850, -0.0190, 'inner', 0.6],
  ['West End', 51.5130, -0.1330, 'westend'],
  ['Mayfair', 51.5100, -0.1480, 'westend', 0.8],
  ['Holborn', 51.5175, -0.1150, 'westend', 0.7],
  ['Westminster', 51.4990, -0.1320, 'civic', 0.8],
  ['South Bank', 51.5050, -0.1100, 'westend', 0.7],
  ['Southwark', 51.5030, -0.0920, 'civic', 0.7],
  ['Pimlico', 51.4890, -0.1410, 'inner', 0.8],
  ['Marylebone', 51.5210, -0.1550, 'inner'],
  ['Paddington', 51.5170, -0.1800, 'inner', 0.8],
  ['Notting Hill', 51.5110, -0.2020, 'inner'],
  ['Kensington', 51.4990, -0.1930, 'inner'],
  ['Chelsea', 51.4870, -0.1700, 'inner', 0.9],
  ['Fulham', 51.4760, -0.2050, 'outer'],
  ['Hammersmith', 51.4940, -0.2250, 'outer'],
  ["Shepherd's Bush", 51.5070, -0.2250, 'outer'],
  ['Chiswick', 51.4930, -0.2600, 'suburb'],
  ['Acton', 51.5100, -0.2700, 'outer'],
  ['Ealing', 51.5130, -0.3050, 'suburb'],
  ['Brentford', 51.4870, -0.3100, 'industry', 0.8],
  ['Park Royal', 51.5320, -0.2650, 'industry'],
  ['Wembley', 51.5560, -0.2850, 'suburb'],
  ['Willesden', 51.5450, -0.2300, 'outer'],
  ['Kilburn', 51.5400, -0.1950, 'outer'],
  ["St John's Wood", 51.5330, -0.1740, 'inner', 0.8],
  ['Hampstead', 51.5560, -0.1780, 'suburb'],
  ['Camden Town', 51.5390, -0.1430, 'inner'],
  ['Kentish Town', 51.5520, -0.1400, 'outer'],
  ["King's Cross", 51.5320, -0.1220, 'inner', 0.8],
  ['Bloomsbury', 51.5220, -0.1270, 'inner', 0.8],
  ['Islington', 51.5380, -0.1030, 'inner'],
  ['Highbury', 51.5520, -0.0970, 'outer'],
  ['Finsbury Park', 51.5640, -0.1080, 'outer'],
  ['Stoke Newington', 51.5620, -0.0750, 'outer'],
  ['Shoreditch', 51.5260, -0.0780, 'inner', 0.8],
  ['Hackney', 51.5450, -0.0550, 'outer'],
  ['Bethnal Green', 51.5270, -0.0550, 'inner', 0.8],
  ['Whitechapel', 51.5165, -0.0600, 'inner', 0.8],
  ['Wapping', 51.5060, -0.0560, 'inner', 0.7],
  ['Limehouse', 51.5120, -0.0350, 'inner', 0.8],
  ['Bow', 51.5290, -0.0200, 'outer'],
  ['Hackney Wick', 51.5430, -0.0250, 'industry', 0.7],
  ['Stratford', 51.5410, -0.0030, 'outer'],
  ['Leyton', 51.5600, -0.0100, 'suburb'],
  ['Walthamstow', 51.5800, -0.0200, 'suburb'],
  ['Poplar', 51.5110, -0.0130, 'inner', 0.7],
  ['Canning Town', 51.5150, 0.0150, 'outer', 0.8],
  ['Royal Docks', 51.5070, 0.0450, 'industry'],
  ['West Ham', 51.5300, 0.0100, 'outer'],
  ['East Ham', 51.5350, 0.0550, 'outer'],
  ['Beckton', 51.5170, 0.0750, 'industry'],
  ['Barking', 51.5380, 0.0800, 'outer'],
  ['Ilford', 51.5590, 0.0700, 'suburb'],
  ['Dagenham', 51.5300, 0.1450, 'industry', 1.2],
  ['Thames Gateway', 51.5150, 0.1850, 'industry', 1.2],
  ['Bermondsey', 51.4980, -0.0700, 'inner'],
  ['Rotherhithe', 51.4960, -0.0480, 'inner', 0.8],
  ['Surrey Quays', 51.4900, -0.0400, 'outer', 0.8],
  ['Deptford', 51.4744, -0.0413, 'outer', 0.8],
  ['Greenwich', 51.4690, -0.0120, 'outer', 0.8],
  ['Greenwich Peninsula', 51.4999, 0.0211, 'westend', 0.5],
  ['Charlton', 51.4850, 0.0350, 'industry'],
  ['Woolwich', 51.4880, 0.0650, 'outer'],
  ['Thamesmead', 51.5000, 0.1150, 'suburb'],
  ['Erith', 51.4800, 0.1700, 'industry'],
  ['Plumstead', 51.4800, 0.0900, 'suburb'],
  ['Blackheath', 51.4650, 0.0080, 'suburb'],
  ['Lewisham', 51.4560, -0.0300, 'outer'],
  ['New Cross', 51.4750, -0.0400, 'outer'],
  ['Peckham', 51.4700, -0.0690, 'outer'],
  ['Camberwell', 51.4740, -0.0920, 'outer'],
  ['Dulwich', 51.4450, -0.0850, 'suburb'],
  ['Elephant and Castle', 51.4950, -0.1000, 'inner', 0.8],
  ['Kennington', 51.4850, -0.1100, 'inner', 0.8],
  ['Vauxhall', 51.4830, -0.1300, 'inner', 0.7],
  ['Battersea', 51.4720, -0.1600, 'outer'],
  ['Stockwell', 51.4720, -0.1230, 'outer'],
  ['Brixton', 51.4620, -0.1150, 'outer'],
  ['Clapham', 51.4600, -0.1400, 'outer'],
  ['Wandsworth', 51.4570, -0.1900, 'outer'],
  ['Putney', 51.4600, -0.2150, 'suburb'],
  ['Barnes', 51.4740, -0.2420, 'suburb', 0.8],
  ['Richmond', 51.4600, -0.3000, 'suburb'],
  ['Wimbledon', 51.4340, -0.2140, 'suburb'],
  ['Streatham', 51.4300, -0.1300, 'suburb'],
  ['Norwood', 51.4200, -0.0800, 'suburb'],
];

/**
 * Green land: park tiles over every block whose middle is inside the box, and the roads between those blocks (the
 * roads round the edge stay). A heath leaves more open grass.
 */
export interface LondonPark { name: string; box: GeoBox; heath?: boolean }
export const PARKS: LondonPark[] = [
  { name: 'Hyde Park', box: [51.5130, -0.1890, 51.5025, -0.1520] },
  { name: "Regent's Park", box: [51.5350, -0.1650, 51.5230, -0.1450] },
  { name: "St James's Park", box: [51.5060, -0.1450, 51.5010, -0.1300] },
  { name: 'Hampstead Heath', box: [51.5720, -0.1800, 51.5550, -0.1500], heath: true },
  { name: 'Battersea Park', box: [51.4825, -0.1650, 51.4755, -0.1490] },
  { name: 'Clapham Common', box: [51.4640, -0.1580, 51.4560, -0.1380], heath: true },
  { name: 'Greenwich Park', box: [51.4699, -0.0077, 51.4579, 0.0139] },
  { name: 'Blackheath', box: [51.4564, -0.0077, 51.4474, 0.0211], heath: true },
  { name: 'Victoria Park', box: [51.5400, -0.0480, 51.5330, -0.0280] },
  { name: 'Queen Elizabeth Olympic Park', box: [51.5480, -0.0200, 51.5360, -0.0080] },
  { name: 'Wormwood Scrubs', box: [51.5230, -0.2450, 51.5160, -0.2270], heath: true },
  { name: 'Kew Gardens', box: [51.4840, -0.3000, 51.4700, -0.2850] },
  { name: 'Richmond Park', box: [51.4550, -0.2900, 51.4300, -0.2400], heath: true },
  { name: 'Wimbledon Common', box: [51.4400, -0.2400, 51.4200, -0.2150], heath: true },
  { name: 'Wanstead Flats', box: [51.5580, 0.0150, 51.5480, 0.0400], heath: true },
  { name: 'Walthamstow Marshes', box: [51.5800, -0.0550, 51.5550, -0.0400], heath: true },
  { name: 'Rainham Marshes', box: [51.5150, 0.1800, 51.4950, 0.2200], heath: true },
  { name: 'Southwark Park', box: [51.4960, -0.0600, 51.4920, -0.0480] },
  { name: 'Brockwell Park', box: [51.4550, -0.1100, 51.4480, -0.1000] },
  { name: 'Finsbury Park', box: [51.5720, -0.1080, 51.5640, -0.0980] },
];

/** Land kept clear of roads and zones: the airfield and the railway corridors (track rows and columns). */
export const RESERVED: { name: string; rect: DemoRect; airfield?: boolean }[] = [
  { name: 'Heathrow', rect: [-112, -6, 17, 20], airfield: true },
  { name: 'Great Western main line', rect: [-95, -9, 57, 1] },
  { name: 'East Coast main line', rect: [-20, -19, 7, 1] },
  { name: 'East Coast main line', rect: [-14, -41, 1, 23] },
  { name: 'Great Eastern main line', rect: [-3, -9, 35, 1] },
  { name: 'Great Eastern main line', rect: [31, -25, 1, 17] },
  { name: 'South Western main line', rect: [-10, 9, 7, 1] },
  { name: 'South Western main line', rect: [-10, 9, 1, 18] },
  { name: 'South Western main line', rect: [-38, 26, 29, 1] },
  { name: 'Thames Gateway freight line', rect: [58, -24, 36, 1] },
];

// ---------------------------------------------------------------- the scenario: areas, landmarks, rail, buses

const SIDES = { S: 0, E: 1, N: 2, W: 3 } as const;
const K = KIND_ID as Record<string, number>;
/**
 * A placement in the block holding a real place, its door on the block's `side` road, as near the place as fits.
 * Blocks are the 4×4 lots between grid roads; every landmark below fits one.
 */
function fit(id: string, kind: string, lat: number, lon: number, side: keyof typeof SIDES): DemoPlacement {
  const [px, py] = geoF(lat, lon), r = SIDES[side];
  const x0 = Math.floor(px / 5) * 5 + 1, y0 = Math.floor(py / 5) * 5 + 1;
  const k = K[kind], fp = footprintOf(k);
  if (fp.w * fp.h === 1) {
    // a 1×1 on the frontage of that side, as near the place as the block allows
    const cx = Math.max(x0, Math.min(x0 + 3, Math.floor(px))), cy = Math.max(y0, Math.min(y0 + 3, Math.floor(py)));
    const door: DemoXY = r === 0 ? [cx, y0 + 3] : r === 1 ? [x0 + 3, cy] : r === 2 ? [cx, y0] : [x0, cy];
    return { id, kind, door };
  }
  let best: DemoPlacement | null = null, bd = Infinity;
  for (let ay = y0; ay < y0 + 4; ay++) for (let ax = x0; ax < x0 + 4; ax++) {
    const p = placedFromAnchor(k, ax, ay, r);
    if (p.ax + p.w > x0 + 4 || p.ay + p.h > y0 + 4) continue;
    const onRing = r === 0 ? p.frontY === y0 + 4 : r === 1 ? p.frontX === x0 + 4 : r === 2 ? p.frontY === y0 - 1 : p.frontX === x0 - 1;
    if (!onRing) continue;
    const d = Math.hypot(p.ax + p.w / 2 - px, p.ay + p.h / 2 - py);
    if (d < bd) { bd = d; best = { id, kind, door: [p.doorX, p.doorY], rot: r }; }
  }
  if (!best) throw new Error(`london: ${kind} does not fit a block facing ${side}`);
  return best;
}
/** A bus stop on the frontage of the block holding a real place, mid-block (never facing a junction), on the `side` road. */
function stop(id: string, lat: number, lon: number, side: keyof typeof SIDES): DemoPlacement {
  const [px, py] = geoF(lat, lon);
  const x0 = Math.floor(px / 5) * 5 + 1, y0 = Math.floor(py / 5) * 5 + 1;
  const mx = px - x0 < 2 ? x0 + 1 : x0 + 2, my = py - y0 < 2 ? y0 + 1 : y0 + 2;
  const door: DemoXY = side === 'S' ? [mx, y0 + 3] : side === 'N' ? [mx, y0] : side === 'E' ? [x0 + 3, my] : [x0, my];
  return { id, kind: 'bus-stop', door };
}

/** A named area on the tour: the 3×3 blocks round a real place. */
function area(id: string, name: string, lat: number, lon: number, kind: string, blurb: string): DemoBlock {
  const [px, py] = geoF(lat, lon);
  const bx = Math.floor(px / 5), by = Math.floor(py / 5);
  return { id, kind, name, blurb, rect: [5 * bx - 5, 5 * by - 5, 15, 15], inspect: [5 * bx + 1, 5 * by + 1] };
}

const AREAS: DemoBlock[] = [
  area('area-westminster', 'Westminster', 51.4995, -0.1300, 'office',
    'Government and the civic heart: offices round Whitehall, New Scotland Yard, the Thames bending north past Parliament to Westminster Bridge.'),
  area('area-west-end', 'The West End', 51.5120, -0.1330, 'commercial',
    "Shops, theatres and cinemas from Oxford Street to Covent Garden: department stores on merged lots, the theatres of Shaftesbury Avenue and the opera house. People come here for nights out from all over town."),
  area('area-city', 'The City of London', 51.5145, -0.0900, 'office',
    'The Square Mile: almost every block an office tower or a corporate headquarters on merged lots, up to the top level. Hundreds of thousands of jobs in the real one; here it is the biggest employer north of the river, so the morning commute pours in over London Bridge and from Liverpool Street.'),
  area('area-south-bank', 'South Bank and Southwark', 51.5040, -0.1000, 'commercial',
    'Across the river from the City: the arts along the bank, offices and homes behind. Blackfriars, London and Tower Bridge cross here.'),
  area('area-canary-wharf', 'Canary Wharf', 51.5045, -0.0200, 'office',
    "The second City, on the Isle of Dogs between the West India Docks: towers and headquarters inside the river's loop. The Thames runs south round the isle, east past Greenwich and north again round the O2."),
  area('area-isle-of-dogs', 'Isle of Dogs', 51.4910, -0.0140, 'residential',
    'Homes in the south of the loop, below the docks. Every road out leads north: the river is on three sides.'),
  area('area-greenwich', 'Greenwich', 51.4790, -0.0050, 'residential',
    'Homes round Greenwich Park on the south bank of the loop, the museum by the river, Blackheath above.'),
  area('area-royal-docks', 'Royal Docks', 51.5070, 0.0450, 'industrial',
    'Industry round the Royal Victoria and Royal Albert Docks: works, depots and the deliveries they send to shops all over the east.'),
  area('area-thames-gateway', 'Thames Gateway', 51.5280, 0.1450, 'industrial',
    'Dagenham and the Thames Gateway: heavy plant and factory complexes where the river widens into the estuary, with a freight yard sending containers by train to Barking.'),
  area('area-kensington', 'Kensington and Chelsea', 51.4990, -0.1900, 'residential',
    'Dense homes and mid-rise mansion blocks south of Hyde Park, the museums of South Kensington, Chelsea down to the river.'),
  area('area-camden', 'Camden', 51.5390, -0.1430, 'residential',
    "Homes and the market north of Regent's Park. The King's Cross line runs between Camden and Islington, and the streets cross it on level crossings: watch the barriers come down and the traffic queue as a train goes through."),
  area('area-islington', 'Islington', 51.5380, -0.1000, 'residential',
    "Terraces and high streets east of the King's Cross line."),
  area('area-hackney', 'Hackney', 51.5450, -0.0550, 'residential',
    'Homes with gardens behind them, high streets, Victoria Park, and the Lea valley industry to the east.'),
  area('area-brixton', 'Brixton', 51.4620, -0.1150, 'residential',
    'South London: homes and the high street at the end of the 159 from Oxford Circus over Westminster Bridge.'),
  area('area-clapham', 'Clapham and Battersea', 51.4640, -0.1500, 'residential',
    'Homes either side of Clapham Common and Battersea Park, with Clapham Junction on the line from Waterloo.'),
  area('area-hammersmith', 'Hammersmith and Fulham', 51.4900, -0.2200, 'residential',
    'West London where the Thames loops round Barnes: homes on both banks, Hammersmith and Putney bridges.'),
];

/** Every line's stations: door and rotation chosen so the platform's back row lies on the line's track. */
const STATIONS = {
  paddington: { door: [-42, -6], rot: 0 },
  ealing: { door: [-78, -6], rot: 0 },
  heathrowStation: { door: [-93, -6], rot: 0 },
  kingsCross: { door: [-18, -16], rot: 0 },
  finsburyPark: { door: [-11, -38], rot: 1 },
  liverpoolStreet: { door: [-1, -6], rot: 0 },
  stratford: { door: [34, -22], rot: 1 },
  waterloo: { door: [-6, 6], rot: 2 },
  claphamJunction: { door: [-36, 29], rot: 0 },
  barking: { door: [60, -21], rot: 0 },
  dagenham: { door: [90, -21], rot: 0 },
} as const satisfies Record<string, { door: DemoXY; rot: 0 | 1 | 2 | 3 }>;
const at = (s: keyof typeof STATIONS): DemoXY => STATIONS[s].door;

const ROUTE_25 = [
  stop('stop-25-marble-arch', 51.5160, -0.1590, 'S'), stop('stop-25-oxford-circus', 51.5160, -0.1410, 'S'),
  stop('stop-25-tottenham-ct', 51.5160, -0.1320, 'S'), stop('stop-25-holborn', 51.5160, -0.1098, 'S'),
  stop('stop-25-st-pauls', 51.5160, -0.0950, 'S'),
  stop('stop-25-aldgate', 51.5160, -0.0720, 'S'), stop('stop-25-whitechapel', 51.5160, -0.0600, 'S'),
];
// over Westminster Bridge, then south past the South Western line (over its level crossings or round its east end) to Brixton
const ROUTE_159 = [
  stop('stop-159-oxford-circus', 51.5140, -0.1410, 'S'), stop('stop-159-piccadilly', 51.5090, -0.1360, 'E'),
  stop('stop-159-whitehall', 51.5030, -0.1310, 'W'), stop('stop-159-lambeth-north', 51.5010, -0.1120, 'S'),
  stop('stop-159-kennington', 51.4879, -0.0990, 'E'), stop('stop-159-oval', 51.4760, -0.0990, 'E'),
  stop('stop-159-brixton', 51.4600, -0.1110, 'N'),
];
const ROUTE_D3 = [
  stop('stop-d3-poplar', 51.5110, -0.0170, 'N'), stop('stop-d3-canary-wharf', 51.4964, -0.0198, 'E'),
  stop('stop-d3-millwall', 51.4894, -0.0293, 'E'), stop('stop-d3-island-gardens', 51.4804, -0.0149, 'N'),
];

export const LONDON_SECTIONS: DemoSection[] = [
  {
    id: 'london-areas', name: 'Areas',
    blurb: 'The City, Canary Wharf, the West End, Westminster and the rings of homes and industry round them, zoned as London roughly is.',
    blocks: AREAS,
  },
  {
    id: 'london-landmarks', name: 'Landmarks',
    blurb: 'The hospitals, museums, theatres, parks, stadiums and the arena that the real ones stand for.',
    placements: [
      fit('new-scotland-yard', 'police-hq', 51.4990, -0.1350, 'N'),
      fit('st-thomas', 'teaching-hospital', 51.4986, -0.1110, 'W'),
      fit('royal-london', 'general-hospital', 51.5130, -0.0590, 'N'),
      fit('lambeth-fire', 'fire-hq', 51.4900, -0.1150, 'W'),
      fit('british-museum', 'museum', 51.5230, -0.1270, 'S'),
      fit('natural-history-museum', 'museum', 51.4967, -0.1764, 'N'),
      fit('maritime-museum', 'museum', 51.4699, -0.0101, 'N'),
      fit('british-library', 'central-library', 51.5300, -0.1350, 'S'),
      fit('royal-opera-house', 'opera-house', 51.5160, -0.1222, 'S'),
      fit('palladium', 'theatre', 51.5140, -0.1350, 'E'),
      fit('lyceum', 'theatre', 51.5110, -0.1200, 'N'),
      fit('donmar', 'studio-theatre', 51.5130, -0.1260, 'W'),
      fit('leicester-square', 'multiplex', 51.5150, -0.1300, 'W'),
      fit('barbican', 'theatre', 51.5200, -0.0940, 'S'),
      fit('serpentine', 'lakeside-park', 51.5050, -0.1700, 'S'),
      fit('regents-park-lake', 'lakeside-park', 51.5300, -0.1550, 'N'),
      fit('kew-gardens', 'botanical-garden', 51.4740, -0.2930, 'S'),
      fit('lords', 'sports', 51.5290, -0.1720, 'E'),
      fit('wembley', 'stadium', 51.5560, -0.2795, 'S'),
      fit('london-stadium', 'stadium', 51.5420, -0.0130, 'S'),
      fit('copper-box', 'leisure-centre', 51.5470, -0.0220, 'W'),
      fit('o2-arena', 'arena', 51.4999, 0.0211, 'W'),
    ],
  },
  {
    id: 'london-rail', name: 'Rail and Heathrow',
    blurb: 'Paddington, King\'s Cross, Liverpool Street and Waterloo with a line each, freight from Dagenham to Barking, and Heathrow at the western edge.',
    placements: [
      { id: 'paddington', kind: 'rail-station', ...STATIONS.paddington },
      { id: 'ealing-broadway', kind: 'rail-station', ...STATIONS.ealing },
      { id: 'heathrow-station', kind: 'rail-station', ...STATIONS.heathrowStation },
      { id: 'kings-cross', kind: 'rail-station', ...STATIONS.kingsCross },
      { id: 'finsbury-park', kind: 'rail-station', ...STATIONS.finsburyPark },
      { id: 'liverpool-street', kind: 'rail-station', ...STATIONS.liverpoolStreet },
      { id: 'stratford', kind: 'rail-station', ...STATIONS.stratford },
      { id: 'waterloo', kind: 'rail-station', ...STATIONS.waterloo },
      { id: 'clapham-junction', kind: 'rail-station', ...STATIONS.claphamJunction },
      { id: 'barking-yard', kind: 'freight-yard', ...STATIONS.barking },
      { id: 'dagenham-yard', kind: 'freight-yard', ...STATIONS.dagenham },
      { id: 'heathrow', kind: 'airport', door: [-96, 3], rot: 1 },
    ],
    runways: [{ id: 'heathrow-runway', from: [-107, -5], to: [-107, 10] }],
    tracks: [
      { id: 'track-great-western', name: 'Great Western main line', drags: [[[-95, -9], [-39, -9]]] },
      { id: 'track-east-coast', name: 'East Coast main line', drags: [[[-20, -19], [-14, -19]], [[-14, -19], [-14, -41]]] },
      { id: 'track-great-eastern', name: 'Great Eastern main line', drags: [[[-3, -9], [31, -9]], [[31, -9], [31, -25]]] },
      { id: 'track-south-western', name: 'South Western main line', drags: [[[-4, 9], [-10, 9]], [[-10, 9], [-10, 26]], [[-10, 26], [-38, 26]]] },
      { id: 'track-freight', name: 'Thames Gateway freight line', drags: [[[58, -24], [93, -24]]] },
    ],
    lines: [
      { id: 'line-heathrow', mode: 'rail', number: 1, colour: 0x6b3fa0, loop: false, vehicles: 1, stops: [at('paddington'), at('ealing'), at('heathrowStation')] },
      { id: 'line-east-coast', mode: 'rail', number: 2, colour: 0xd0312d, loop: false, vehicles: 1, stops: [at('kingsCross'), at('finsburyPark')] },
      { id: 'line-great-eastern', mode: 'rail', number: 3, colour: 0x1d70b8, loop: false, vehicles: 1, stops: [at('liverpoolStreet'), at('stratford')] },
      { id: 'line-south-western', mode: 'rail', number: 4, colour: 0xe05206, loop: false, vehicles: 1, stops: [at('waterloo'), at('claphamJunction')] },
      { id: 'line-freight', mode: 'rail', number: 9, colour: 0x6d6f73, loop: false, vehicles: 1, freight: true, stops: [at('dagenham'), at('barking')] },
    ],
  },
  {
    id: 'london-buses', name: 'Buses',
    blurb: 'The 25 along Oxford Street to Whitechapel, the 159 over Westminster Bridge to Brixton and the D3 round the Isle of Dogs, from three garages.',
    placements: [
      fit('victoria-garage', 'bus-depot', 51.4930, -0.1450, 'N'),
      fit('stockwell-garage', 'bus-depot', 51.4740, -0.1180, 'E'),
      fit('poplar-garage', 'bus-depot', 51.5110, -0.0050, 'N'),
      ...ROUTE_25, ...ROUTE_159, ...ROUTE_D3,
    ],
    lines: [
      { id: 'line-bus-25', mode: 'bus', number: 25, colour: 0xd32f2f, loop: false, vehicles: 4, stops: ROUTE_25.map((p) => p.door) },
      { id: 'line-bus-159', mode: 'bus', number: 159, colour: 0xc62828, loop: false, vehicles: 5, stops: ROUTE_159.map((p) => p.door) },
      { id: 'line-bus-d3', mode: 'bus', number: 3, colour: 0xb71c1c, loop: false, vehicles: 2, stops: ROUTE_D3.map((p) => p.door) },
    ],
  },
];

/** Tour order: west to east along the river, then the rings round it. */
export const LONDON_TOUR: string[] = [
  'welcome',
  'area-westminster', 'new-scotland-yard', 'st-thomas', 'lambeth-fire',
  'area-west-end', 'royal-opera-house', 'palladium', 'lyceum', 'donmar', 'leicester-square', 'line-bus-25', 'line-bus-159',
  'area-city', 'barbican', 'liverpool-street', 'track-great-eastern', 'line-great-eastern', 'stratford', 'london-stadium', 'copper-box',
  'area-south-bank', 'waterloo', 'line-south-western', 'clapham-junction', 'area-clapham', 'victoria-garage', 'stockwell-garage', 'area-brixton',
  'area-canary-wharf', 'area-isle-of-dogs', 'line-bus-d3', 'poplar-garage', 'area-greenwich', 'maritime-museum', 'o2-arena',
  'area-royal-docks', 'area-thames-gateway', 'dagenham-yard', 'track-freight', 'barking-yard', 'line-freight',
  'royal-london', 'area-hackney', 'area-islington', 'kings-cross', 'british-library', 'line-east-coast', 'finsbury-park', 'british-museum',
  'area-camden', 'regents-park-lake', 'lords', 'serpentine', 'area-kensington', 'natural-history-museum',
  'paddington', 'line-heathrow', 'ealing-broadway', 'track-great-western', 'wembley', 'area-hammersmith', 'kew-gardens',
  'heathrow', 'heathrow-runway', 'heathrow-station',
];
/** The welcome stop: the whole river from high over the City. */
export const LONDON_VIEW: Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'> = { focus: [8, 6], dist: 220, yaw: 0, pitch: 1.15 };
