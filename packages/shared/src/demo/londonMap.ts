import type { DemoRect, DemoXY } from './showcase';
import type { Placed } from '../structures';
import { hash2 } from '../noise';
import { BRIDGE_MAX_SPAN } from '../bridges';
import type { SeaGate } from '../waterways';

/**
 * London's map (docs/demo.md "London"): the river, docks, places, parks, reserved land, main roads and boroughs as
 * data from real latitudes and longitudes, and `londonPlan`, which lays the streets over it. The scenario
 * (london.ts) places the landmarks and stations first, plans the streets round them and then finds bus stops and
 * the 1×1 venues on the frontage the plan leaves; the server's seeder (server/src/demo/london.ts) paints the plan into
 * a World. Shared so the client's tour and the server agree on every coordinate; deterministic (hashes only).
 *
 * Coordinates: real latitude and longitude go through `geo`, 6 tiles a kilometre, Charing Cross at (-20, 0), x east,
 * y south.
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
/** The plain country round the map (server/src/demo/london.ts), the river running on out of it to the sea gates. */
export const LONDON_MARGIN = 24;

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
  [51.4945, -0.1230, 4, 'Lambeth Bridge'],
  [51.5018, -0.1218, 4, 'Westminster Bridge'], // a little north of the real one, so Parliament fits between it and Lambeth Bridge
  [51.5085, -0.1165, 4, 'Waterloo Bridge'],
  [51.5095, -0.1040, 4, 'Blackfriars Bridge'],
  [51.5088, -0.0945, 4, 'Southwark Bridge'],
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
  // east of the Tower, opening on to the river where it bulges north (rows -2 to -1): as wide as the marina in it
  // (london.ts HARBOURS), whose back two rows stand in it, so its boats' cruises find no dead ends
  { name: 'St Katharine Docks', rect: [14, -5, 4, 3] },
];

/**
 * What a place zones its blocks as. city: offices and merged towers; westend: shops, offices and venues; civic:
 * offices and government; inner: dense homes with shops; outer: homes with high streets; suburb: low homes with
 * gardens; industry: works and depots. It also sets the grain of the streets (STREETS).
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

/** Green land: park tiles over every tile whose middle is inside the box, ringed by road. A heath leaves more open grass. */
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

/**
 * The main roads, laid first: real arterials as latitude and longitude waypoints, each leg drawn on the tile grid as
 * an L or, when long and slanting, a staircase of legs at least two tiles long. They cross a railway corridor at
 * right angles as a level crossing, stop at water (the bridges carry them over) and run round the parks.
 */
export interface Arterial { name: string; pts: readonly (readonly [lat: number, lon: number])[] }
export const ARTERIALS: Arterial[] = [
  // north of the river, east-west
  { name: 'Uxbridge Road, Bayswater Road, Oxford Street, Holborn and Cheapside to Aldgate, Whitechapel and Mile End', pts: [
    [51.5150, -0.3500], [51.5150, -0.3000], [51.5075, -0.2700], [51.5050, -0.2250], [51.5090, -0.2000], [51.5150, -0.1900],
    [51.5150, -0.0600], [51.5250, -0.0600], [51.5250, -0.0150], [51.5350, -0.0150], [51.5350, 0.0050],
  ] },
  // round the Isle of Dogs, over the West India Docks at the gaps between the basins
  { name: 'Westferry Road and Manchester Road', pts: [[51.5104, -0.0197], [51.4849, -0.0197], [51.4849, -0.0077], [51.5104, -0.0077]] },
  // over the gap between the Royal Victoria and Royal Albert Docks, and along the river south of them
  { name: 'Connaught Bridge', pts: [[51.5149, 0.0523], [51.5059, 0.0523]] },
  { name: 'North Woolwich Road', pts: [[51.5074, 0.0230], [51.5074, 0.0890]] },
  { name: 'Romford Road', pts: [[51.5350, 0.0050], [51.5470, 0.0400], [51.5590, 0.0700], [51.5650, 0.1900]] },
  { name: 'Marylebone Road, Euston Road, Pentonville Road, City Road, Old Street and Bethnal Green Road', pts: [
    [51.5225, -0.1750], [51.5225, -0.1330], [51.5300, -0.1330], [51.5300, -0.1060], [51.5250, -0.0900], [51.5250, -0.0600],
  ] },
  { name: 'The Highway, Commercial Road, East India Dock Road, Barking Road and the A13', pts: [
    [51.5100, -0.0700], [51.5120, -0.0400], [51.5100, -0.0150], [51.5120, 0.0060], [51.5300, 0.0550], [51.5300, 0.0900],
    [51.5250, 0.1500], [51.5200, 0.1900],
  ] },
  { name: 'Harrow Road', pts: [[51.5225, -0.1750], [51.5300, -0.2250], [51.5370, -0.2500], [51.5520, -0.2900], [51.5560, -0.3500]] },
  // north of the river, north-south
  { name: 'Edgware Road', pts: [[51.5150, -0.1600], [51.5225, -0.1700], [51.5300, -0.1850], [51.5470, -0.1940], [51.5580, -0.2130], [51.5920, -0.2300]] },
  { name: 'Charing Cross Road, Tottenham Court Road, Camden High Street and Highgate Road', pts: [
    [51.5075, -0.1290], [51.5300, -0.1310], [51.5390, -0.1420], [51.5500, -0.1410], [51.5920, -0.1450],
  ] },
  { name: 'St John Street, Upper Street and Holloway Road', pts: [
    [51.5150, -0.1040], [51.5320, -0.1060], [51.5460, -0.1040], [51.5650, -0.1350], [51.5920, -0.1500],
  ] },
  { name: 'Bishopsgate, Kingsland Road and Stoke Newington High Street', pts: [
    [51.5090, -0.0890], [51.5260, -0.0890], [51.5260, -0.0780], [51.5480, -0.0750], [51.5620, -0.0730], [51.5920, -0.0710],
  ] },
  { name: 'Cambridge Heath Road and Mare Street', pts: [[51.5250, -0.0600], [51.5450, -0.0560], [51.5620, -0.0560], [51.5920, -0.0600]] },
  { name: 'The North Circular', pts: [
    [51.4890, -0.2870], [51.5100, -0.2880], [51.5300, -0.2930], [51.5550, -0.2500], [51.5760, -0.2230], [51.5920, -0.2100],
  ] },
  // west and south-west
  // from the Charing Cross Road along Coventry Street, past Piccadilly Circus (london.ts), then Piccadilly proper
  { name: 'Coventry Street, Piccadilly, Knightsbridge, Kensington High Street, Hammersmith Road and Chiswick High Road', pts: [
    [51.5100, -0.1290], [51.5100, -0.1340], [51.5100, -0.1515], [51.5030, -0.1515], [51.5030, -0.1890], [51.5010, -0.1930], [51.4925, -0.2235],
    [51.4925, -0.2570], [51.4890, -0.2870], [51.4870, -0.3050],
  ] },
  // Piccadilly Circus (london.ts places the Lights there, its front on Piccadilly): Regent Street comes down from Oxford
  // Circus to its west corner. Piccadilly runs on east past its front as Coventry Street to the Charing Cross Road, a
  // tile from its east corner, which stands for Shaftesbury Avenue too at this scale; Haymarket is a side street south
  { name: 'Regent Street', pts: [[51.5150, -0.1422], [51.5104, -0.1422]] },
  { name: "Shepherd's Bush Road and Fulham Palace Road", pts: [[51.5050, -0.2250], [51.4925, -0.2235], [51.4680, -0.2120]] },
  { name: "Victoria Street, Sloane Square, the King's Road and Fulham Road", pts: [
    [51.4985, -0.1395], [51.4965, -0.1440], [51.4925, -0.1565], [51.4860, -0.1750], [51.4800, -0.1950], [51.4700, -0.2100],
  ] },
  // south of the river
  { name: 'Kennington Park Road, Brixton Road and Streatham High Road', pts: [
    [51.4985, -0.1050], [51.4920, -0.1080], [51.4820, -0.1130], [51.4620, -0.1140], [51.4400, -0.1250], [51.4200, -0.1310],
  ] },
  { name: 'Borough High Street, Walworth Road, Camberwell and Denmark Hill to Norwood', pts: [
    [51.5040, -0.0890], [51.5000, -0.0920], [51.4920, -0.0960], [51.4740, -0.0930], [51.4680, -0.0890], [51.4530, -0.1020], [51.4200, -0.0950],
  ] },
  { name: 'Old Kent Road, New Cross Road and Shooters Hill', pts: [
    [51.4940, -0.0850], [51.4760, -0.0400], [51.4680, 0.0050], [51.4700, 0.0500], [51.4680, 0.1100], [51.4620, 0.1900],
  ] },
  { name: 'Jamaica Road, Lower Road, Evelyn Street and Woolwich Road', pts: [
    [51.4990, -0.0650], [51.4950, -0.0500], [51.4900, -0.0450], [51.4800, -0.0300], [51.4800, -0.0100], [51.4850, 0.0300],
    [51.4900, 0.0700], [51.4900, 0.1200],
  ] },
  { name: 'Clapham Road and Balham High Road', pts: [[51.4860, -0.1230], [51.4720, -0.1230], [51.4620, -0.1380], [51.4430, -0.1520], [51.4280, -0.1680]] },
  { name: "Wandsworth Road, Lavender Hill, Wandsworth High Street and the Upper Richmond Road", pts: [
    [51.4860, -0.1230], [51.4720, -0.1400], [51.4625, -0.1600], [51.4625, -0.1700], [51.4570, -0.1920], [51.4610, -0.2160],
    [51.4650, -0.2650], [51.4610, -0.3030], [51.4610, -0.3500],
  ] },
  { name: 'Peckham Road and Queens Road', pts: [[51.4740, -0.0930], [51.4740, -0.0690], [51.4760, -0.0400]] },
  { name: 'The South Circular', pts: [
    [51.4620, -0.1380], [51.4530, -0.1170], [51.4450, -0.0850], [51.4450, -0.0200], [51.4500, 0.0500], [51.4500, 0.1200],
  ] },
  { name: 'Lewisham High Street', pts: [[51.4760, -0.0400], [51.4560, -0.0300], [51.4450, -0.0200], [51.4200, -0.0150]] },
  { name: 'Kew Road and the road to Wimbledon', pts: [[51.4890, -0.2870], [51.4610, -0.3030]] },
  { name: 'Wimbledon Park Road', pts: [[51.4570, -0.1920], [51.4340, -0.2140], [51.4200, -0.2140]] },
];

/**
 * The London boroughs, the parcels' owners: each a polygon of real latitudes and longitudes (roughly the real
 * boundary) on one bank of the river, which is the boundary between them. A tile goes to the first borough whose
 * polygon holds it on its own bank, and a tile none holds (or the river) to the nearest borough over land. A borough
 * on both banks (Richmond) is two entries with one id.
 */
export interface Borough { id: string; name: string; colour: number; bank: 'N' | 'S'; polys: readonly (readonly (readonly [number, number])[])[] }
export const BOROUGHS: Borough[] = [
  { id: 'city', name: 'City of London', colour: 0xe0a030, bank: 'N', polys: [[[51.5220, -0.1120], [51.5230, -0.0980], [51.5210, -0.0780], [51.5130, -0.0720], [51.5060, -0.0760], [51.5060, -0.1110]]] },
  { id: 'westminster', name: 'Westminster', colour: 0xc0504d, bank: 'N', polys: [[
    [51.5340, -0.2070], [51.5400, -0.1850], [51.5370, -0.1650], [51.5350, -0.1470], [51.5240, -0.1420], [51.5180, -0.1370], [51.5160, -0.1280],
    [51.5150, -0.1180], [51.5110, -0.1110], [51.5060, -0.1110], [51.4800, -0.1500], [51.4940, -0.1570], [51.5015, -0.1630], [51.5015, -0.1830],
    [51.5100, -0.1880], [51.5300, -0.1920],
  ]] },
  { id: 'camden', name: 'Camden', colour: 0x4f81bd, bank: 'N', polys: [[
    [51.5750, -0.2150], [51.5720, -0.1450], [51.5600, -0.1380], [51.5450, -0.1250], [51.5300, -0.1200], [51.5220, -0.1120], [51.5150, -0.1120],
    [51.5150, -0.1180], [51.5160, -0.1280], [51.5180, -0.1370], [51.5240, -0.1420], [51.5350, -0.1470], [51.5370, -0.1650], [51.5400, -0.1850],
    [51.5340, -0.2070], [51.5550, -0.1930],
  ]] },
  { id: 'islington', name: 'Islington', colour: 0x9bbb59, bank: 'N', polys: [[
    [51.5720, -0.1450], [51.5750, -0.1200], [51.5650, -0.1000], [51.5550, -0.0900], [51.5300, -0.0850], [51.5230, -0.0800], [51.5230, -0.0980],
    [51.5220, -0.1120], [51.5300, -0.1200], [51.5450, -0.1250], [51.5600, -0.1380],
  ]] },
  { id: 'hackney', name: 'Hackney', colour: 0x8064a2, bank: 'N', polys: [[
    [51.5750, -0.1000], [51.5750, -0.0400], [51.5550, -0.0350], [51.5450, -0.0200], [51.5350, -0.0200], [51.5350, -0.0500], [51.5270, -0.0650],
    [51.5220, -0.0750], [51.5230, -0.0800], [51.5300, -0.0850], [51.5550, -0.0900], [51.5650, -0.1000],
  ]] },
  { id: 'haringey', name: 'Haringey', colour: 0x4bacc6, bank: 'N', polys: [[[51.6000, -0.2150], [51.6000, -0.0550], [51.5750, -0.0550], [51.5750, -0.2150]]] },
  { id: 'waltham-forest', name: 'Waltham Forest', colour: 0xf79646, bank: 'N', polys: [[[51.6000, -0.0550], [51.6000, 0.0200], [51.5550, 0.0200], [51.5450, -0.0100], [51.5450, -0.0200], [51.5550, -0.0350], [51.5750, -0.0400]]] },
  { id: 'tower-hamlets', name: 'Tower Hamlets', colour: 0xd16b8f, bank: 'N', polys: [[
    [51.5450, -0.0200], [51.5400, -0.0120], [51.5250, -0.0050], [51.5120, 0.0070], [51.4950, 0.0070], [51.4750, -0.0300], [51.5050, -0.0760],
    [51.5130, -0.0720], [51.5210, -0.0780], [51.5220, -0.0750], [51.5270, -0.0650], [51.5350, -0.0500], [51.5350, -0.0200],
  ]] },
  { id: 'newham', name: 'Newham', colour: 0x5b9b74, bank: 'N', polys: [[
    [51.5550, 0.0200], [51.5600, 0.0600], [51.5450, 0.0850], [51.5300, 0.0900], [51.5100, 0.0900], [51.4950, 0.0600], [51.4950, 0.0070],
    [51.5120, 0.0070], [51.5250, -0.0050], [51.5400, -0.0120], [51.5450, -0.0100],
  ]] },
  { id: 'redbridge', name: 'Redbridge', colour: 0xc9a227, bank: 'N', polys: [[[51.6000, 0.0200], [51.6000, 0.2000], [51.5700, 0.2000], [51.5550, 0.1100], [51.5520, 0.0750], [51.5600, 0.0600], [51.5550, 0.0200]]] },
  { id: 'barking-dagenham', name: 'Barking and Dagenham', colour: 0x7f7fbf, bank: 'N', polys: [[[51.5520, 0.0750], [51.5550, 0.1100], [51.5700, 0.1650], [51.5000, 0.1650], [51.5000, 0.0900], [51.5300, 0.0900], [51.5450, 0.0850]]] },
  { id: 'havering', name: 'Havering', colour: 0xb5651d, bank: 'N', polys: [[[51.5700, 0.1650], [51.6000, 0.2000], [51.6000, 0.2600], [51.5000, 0.2600], [51.5000, 0.1650]]] },
  { id: 'kensington-chelsea', name: 'Kensington and Chelsea', colour: 0xe46c0a, bank: 'N', polys: [[
    [51.5330, -0.2120], [51.5300, -0.1920], [51.5100, -0.1880], [51.5015, -0.1830], [51.5015, -0.1630], [51.4940, -0.1570], [51.4800, -0.1500],
    [51.4700, -0.1800], [51.4880, -0.1950], [51.5000, -0.1980], [51.5100, -0.2050], [51.5200, -0.2050],
  ]] },
  { id: 'hammersmith-fulham', name: 'Hammersmith and Fulham', colour: 0x4f6228, bank: 'N', polys: [[
    [51.5350, -0.2550], [51.5330, -0.2120], [51.5200, -0.2050], [51.5100, -0.2050], [51.5000, -0.1980], [51.4880, -0.1950], [51.4700, -0.1800],
    [51.4550, -0.2200], [51.4800, -0.2450], [51.5200, -0.2450],
  ]] },
  { id: 'brent', name: 'Brent', colour: 0x8db3e2, bank: 'N', polys: [[
    [51.6000, -0.3600], [51.6000, -0.2150], [51.5550, -0.1930], [51.5340, -0.2070], [51.5330, -0.2120], [51.5350, -0.2550], [51.5600, -0.2700], [51.5600, -0.3600],
  ]] },
  { id: 'ealing', name: 'Ealing', colour: 0xa5a5a5, bank: 'N', polys: [[[51.5600, -0.3600], [51.5600, -0.2700], [51.5350, -0.2550], [51.5200, -0.2450], [51.5020, -0.2450], [51.5020, -0.3600]]] },
  { id: 'hounslow', name: 'Hounslow', colour: 0xcc99cc, bank: 'N', polys: [[[51.5020, -0.3600], [51.5020, -0.2450], [51.4800, -0.2450], [51.4620, -0.3000], [51.4620, -0.3600]]] },
  { id: 'richmond', name: 'Richmond upon Thames', colour: 0x77933c, bank: 'S', polys: [
    [[51.4950, -0.3600], [51.4950, -0.2350], [51.4450, -0.2350], [51.4200, -0.2600], [51.4200, -0.3600]],
  ] },
  { id: 'richmond', name: 'Richmond upon Thames', colour: 0x77933c, bank: 'N', polys: [[[51.4620, -0.3600], [51.4620, -0.3000], [51.4000, -0.3000], [51.4000, -0.3600]]] },
  { id: 'wandsworth', name: 'Wandsworth', colour: 0x31859c, bank: 'S', polys: [[
    [51.4950, -0.2350], [51.4950, -0.1250], [51.4760, -0.1250], [51.4650, -0.1380], [51.4500, -0.1400], [51.4300, -0.1450], [51.4300, -0.2350],
  ]] },
  { id: 'merton', name: 'Merton', colour: 0xd99694, bank: 'S', polys: [[[51.4300, -0.2600], [51.4300, -0.1450], [51.4000, -0.1450], [51.4000, -0.2600]]] },
  { id: 'lambeth', name: 'Lambeth', colour: 0x60497a, bank: 'S', polys: [[
    [51.5100, -0.1200], [51.5060, -0.1100], [51.4980, -0.1060], [51.4850, -0.1050], [51.4700, -0.0980], [51.4530, -0.1000], [51.4300, -0.0950],
    [51.4000, -0.1000], [51.4000, -0.1450], [51.4300, -0.1450], [51.4500, -0.1400], [51.4650, -0.1380], [51.4760, -0.1250], [51.4950, -0.1250],
  ]] },
  { id: 'southwark', name: 'Southwark', colour: 0x9e480e, bank: 'S', polys: [[
    [51.5100, -0.1120], [51.5100, -0.0700], [51.5060, -0.0350], [51.4900, -0.0350], [51.4760, -0.0450], [51.4600, -0.0550], [51.4400, -0.0650],
    [51.4200, -0.0800], [51.4000, -0.1000], [51.4300, -0.0950], [51.4530, -0.1000], [51.4700, -0.0980], [51.4850, -0.1050], [51.4980, -0.1060],
    [51.5060, -0.1100],
  ]] },
  { id: 'lewisham', name: 'Lewisham', colour: 0x46b39d, bank: 'S', polys: [[
    [51.4950, -0.0350], [51.4880, -0.0200], [51.4700, -0.0200], [51.4650, 0.0000], [51.4500, 0.0200], [51.4000, 0.0200], [51.4000, -0.0900],
    [51.4400, -0.0650], [51.4600, -0.0550], [51.4760, -0.0450], [51.4900, -0.0350],
  ]] },
  { id: 'greenwich', name: 'Greenwich', colour: 0xb5475f, bank: 'S', polys: [[
    [51.4880, -0.0200], [51.5150, 0.0000], [51.5150, 0.1200], [51.4000, 0.1200], [51.4000, 0.0200], [51.4500, 0.0200], [51.4650, 0.0000], [51.4700, -0.0200],
  ]] },
  { id: 'bexley', name: 'Bexley', colour: 0xa0a03c, bank: 'S', polys: [[[51.5150, 0.1200], [51.5150, 0.2600], [51.4000, 0.2600], [51.4000, 0.1200]]] },
];

// ---------------------------------------------------------------- the map's tiles

const [MX, MY, MW, MH] = LONDON_MAP;
const N = MW * MH;
export const inLondon = (x: number, y: number) => x >= MX && y >= MY && x < MX + MW && y < MY + MH;
/** Index of a map tile in the plan's arrays. */
export const lidx = (x: number, y: number) => (y - MY) * MW + (x - MX);
const tx = (i: number) => MX + (i % MW), ty = (i: number) => MY + Math.floor(i / MW);
const inRect = (r: DemoRect, x: number, y: number) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
const DIRS: readonly [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Catmull-Rom through the Thames points: a smooth centre line with a width at every vertex. */
let LINE: { x: number; y: number; w: number }[] | null = null;
export function thamesLine(): { x: number; y: number; w: number }[] {
  if (LINE) return LINE;
  const p = THAMES.map(([lat, lon, w]) => { const [x, y] = geoF(lat, lon); return { x, y, w }; });
  const out: { x: number; y: number; w: number }[] = [];
  const at = (i: number) => p[Math.max(0, Math.min(p.length - 1, i))];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 1.5));
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * t });
    }
  }
  out.push(p[p.length - 1]);
  return (LINE = out);
}

/** Every tile inside [x0, x1) × [y0, y1) whose centre is within half the Thames' width of its centre line. */
export function eachThamesTile(x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => void) {
  const line = thamesLine();
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const r = Math.max(a.w, b.w) / 2 + 1;
    const sx0 = Math.max(x0, Math.floor(Math.min(a.x, b.x) - r)), sx1 = Math.min(x1 - 1, Math.ceil(Math.max(a.x, b.x) + r));
    const sy0 = Math.max(y0, Math.floor(Math.min(a.y, b.y) - r)), sy1 = Math.min(y1 - 1, Math.ceil(Math.max(a.y, b.y) + r));
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
      const d = Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
      if (d <= (a.w + (b.w - a.w) * t) / 2) visit(x, y);
    }
  }
}

/**
 * The sea gates (docs/boats.md 2.3): where the Thames runs out of the margin round the map, "the estuary" at the east
 * edge and "Teddington" at the south-west, upstream (`low`: only boats low enough for the upper river come from there).
 * Each is the middle water tile of the river's run along that edge.
 */
export function londonSeaGates(): SeaGate[] {
  const x0 = MX - LONDON_MARGIN, y0 = MY - LONDON_MARGIN, x1 = MX + MW + LONDON_MARGIN - 1, y1 = MY + MH + LONDON_MARGIN - 1;
  const east: number[] = [], south: number[] = [];
  eachThamesTile(x0, y0, x1 + 1, y1 + 1, (x, y) => { if (x === x1) east.push(y); else if (y === y1) south.push(x); });
  const mid = (a: number[]) => [...new Set(a)].sort((p, q) => p - q)[Math.floor(new Set(a).size / 2)];
  const out: SeaGate[] = [];
  if (east.length) out.push({ x: x1, y: mid(east), name: 'the estuary' });
  if (south.length) out.push({ x: mid(south), y: y1, name: 'Teddington', low: true });
  return out;
}

/** The direction the river runs nearest (x, y), as a vector. */
function riverTangent(x: number, y: number): [number, number] {
  const line = thamesLine();
  let bi = 0, bd = Infinity;
  for (let i = 0; i < line.length; i++) { const d = (line[i].x - x) ** 2 + (line[i].y - y) ** 2; if (d < bd) { bd = d; bi = i; } }
  const a = line[Math.max(0, bi - 2)], b = line[Math.min(line.length - 1, bi + 2)];
  return [b.x - a.x, b.y - a.y];
}

/** Water, parks and reserved land: the map before any street. */
export interface LondonBase {
  /** 1 on the Thames and the docks */
  water: Uint8Array;
  /** PARKS index per tile, -1 for none */
  park: Int16Array;
  /** RESERVED index per tile (the last that covers it), -1 for none */
  reserved: Int8Array;
  /** 1 north of the river (and west of it upstream of Richmond), 2 south, 0 water */
  bank: Uint8Array;
}
let BASE: LondonBase | null = null;
export function londonBase(): LondonBase {
  if (BASE) return BASE;
  const water = new Uint8Array(N), park = new Int16Array(N).fill(-1), reserved = new Int8Array(N).fill(-1);
  eachThamesTile(MX, MY, MX + MW, MY + MH, (x, y) => { water[lidx(x, y)] = 1; });
  for (const d of DOCKS) { const r = d.rect; for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (inLondon(x, y)) water[lidx(x, y)] = 1; }
  RESERVED.forEach((q, n) => { const r = q.rect; for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (inLondon(x, y)) reserved[lidx(x, y)] = n; });
  PARKS.forEach((p, n) => {
    const [x0, y0] = geoF(p.box[0], p.box[1]), [x1, y1] = geoF(p.box[2], p.box[3]);
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      if (!inLondon(x, y) || x + 0.5 < x0 || x + 0.5 > x1 || y + 0.5 < y0 || y + 0.5 > y1) continue;
      const i = lidx(x, y);
      if (!water[i] && reserved[i] < 0) park[i] = n;
    }
  });
  // the banks: the land the top edge reaches without crossing water is the north bank
  const bank = new Uint8Array(N);
  const q: number[] = [];
  for (let x = MX; x < MX + MW; x++) if (!water[lidx(x, MY)]) { bank[lidx(x, MY)] = 1; q.push(lidx(x, MY)); }
  for (let k = 0; k < q.length; k++) {
    const x = tx(q[k]), y = ty(q[k]);
    for (const [dx, dy] of DIRS) { if (!inLondon(x + dx, y + dy)) continue; const j = lidx(x + dx, y + dy); if (!water[j] && !bank[j]) { bank[j] = 1; q.push(j); } }
  }
  for (let i = 0; i < N; i++) if (!water[i] && !bank[i]) bank[i] = 2;
  return (BASE = { water, park, reserved, bank });
}

const PLACE_XY = PLACES.map(([name, lat, lon, c, reach]) => { const [x, y] = geoF(lat, lon); return { name, x, y, c, reach: reach ?? 1 }; });
/** The place nearest (x, y), each place's distance divided by its reach. */
export function placeAt(x: number, y: number) {
  let best = PLACE_XY[0], bd = Infinity;
  for (const p of PLACE_XY) { const d = Math.hypot(p.x - x, p.y - y) / p.reach; if (d < bd) { bd = d; best = p; } }
  return best;
}

// ---------------------------------------------------------------- the streets

/** What a tile of the plan is. */
export const LT = { Land: 0, Water: 1, Rail: 2, Airfield: 3, Park: 4, Keep: 5, Road: 6, Crossing: 7, Deck: 8 } as const;

/**
 * The grain of the streets per character, in lots: `depth` between parallel streets, `len` between the cross streets
 * that join them, the largest `cell` (tiles) left before a through road splits it, and the share of cross streets
 * that stop short as cul-de-sacs. Fine in the City and the West End, long terraces in the suburbs.
 */
const STREETS: Record<Character, { depth: [number, number]; len: [number, number]; cell: number; dead: number }> = {
  city: { depth: [2, 3], len: [2, 4], cell: 14, dead: 0 },
  westend: { depth: [2, 3], len: [3, 5], cell: 16, dead: 0 },
  civic: { depth: [3, 3], len: [3, 5], cell: 16, dead: 0 },
  inner: { depth: [3, 4], len: [3, 6], cell: 18, dead: 0.05 },
  outer: { depth: [3, 4], len: [4, 7], cell: 20, dead: 0.1 },
  suburb: { depth: [3, 4], len: [5, 8], cell: 22, dead: 0.15 },
  industry: { depth: [3, 4], len: [4, 7], cell: 22, dead: 0.1 },
};

/** A bridge of the plan: its first deck tile and length, east along a row or south down a column (`ns`). */
export interface LondonBridge { name: string; x: number; y: number; len: number; ns: boolean }
export interface LondonBlock { x0: number; y0: number; x1: number; y1: number; n: number; cx: number; cy: number }
export interface LondonPlan {
  /** LT code per tile */
  t: Uint8Array;
  /** PARKS index per tile still green (not a road or a placement), -1 elsewhere */
  park: Int16Array;
  bridges: LondonBridge[];
  /** per land tile: 1 frontage (a road beside it), 2 deep (one behind a frontage lot, in line with its road), 0 no road reaches */
  reach: Uint8Array;
  /** block (lots between roads) index per land tile, -1 elsewhere */
  block: Int32Array;
  blocks: LondonBlock[];
  /** 1 on the main roads (arterials, park rings, structures' fronts, bridge approaches, links) */
  main: Uint8Array;
  /** 1 on a road tile that lies on a loop of the network (not on a dead-end branch): a bus can drive on and come back round */
  loop: Uint8Array;
  /** level crossings laid */
  crossings: number;
  problems: string[];
}

const pick = (r: readonly [number, number], h: number) => r[0] + Math.floor(h * (r[1] - r[0] + 1));

let BRIDGES: LondonBridge[] | null = null;
/**
 * The bridges: each named crossing on the shortest run of water along a row or column near the real one (a little
 * dearer the further it strays), with dry land at both ends that is not a park or a railway, and a tile clear of the
 * bridges already chosen. Chosen from the river alone, so the scenario can keep its structures off the landings.
 */
export function londonBridges(): LondonBridge[] {
  if (BRIDGES) return BRIDGES;
  const { water, park, reserved } = londonBase();
  const out: LondonBridge[] = [];
  const near = new Uint8Array(N);
  const land = (x: number, y: number) => inLondon(x, y) && !water[lidx(x, y)] && park[lidx(x, y)] < 0 && reserved[lidx(x, y)] < 0 && !near[lidx(x, y)];
  for (const [lat, lon, w, name] of THAMES) {
    if (!name) continue;
    const [cx, cy] = geoF(lat, lon);
    let best: LondonBridge | null = null, bestScore = Infinity;
    for (const ns of [true, false]) for (let off = -4; off <= 4; off++) {
      const line = Math.round((ns ? cx : cy) - 0.5) + off, along = ns ? cy : cx;
      const wet = (s: number) => { const x = ns ? line : s, y = ns ? s : line; return inLondon(x, y) && water[lidx(x, y)] === 1 && !near[lidx(x, y)]; };
      // the water run on this line nearest the crossing
      let s0 = NaN;
      for (let d = 0; d <= 6 && Number.isNaN(s0); d++) for (const s of [Math.floor(along) - d, Math.floor(along) + d]) if (wet(s)) { s0 = s; break; }
      if (Number.isNaN(s0)) continue;
      let a = s0, b = s0;
      while (b - a < 20 && wet(a - 1)) a--;
      while (b - a < 20 && wet(b + 1)) b++;
      const len = b - a + 1;
      if (len > BRIDGE_MAX_SPAN || len + 1 < w) continue;
      if (!(ns ? land(line, a - 1) && land(line, b + 1) : land(a - 1, line) && land(b + 1, line))) continue;
      const score = len + 1.2 * Math.abs(line + 0.5 - (ns ? cx : cy)) + 0.4 * Math.abs((a + b) / 2 + 0.5 - along);
      if (score < bestScore) { bestScore = score; best = { name, x: ns ? line : a, y: ns ? a : line, len, ns }; }
    }
    if (!best) continue;
    out.push(best);
    const dx = best.ns ? 0 : 1, dy = best.ns ? 1 : 0;
    // keep the next bridge off this one's line and its banks
    for (let k = -1; k <= best.len; k++) for (let s = -2; s <= 2; s++) for (let u = -1; u <= 1; u++) {
      const qx = best.x + dx * k + dy * s + dx * u, qy = best.y + dy * k + dx * s + dy * u;
      if (inLondon(qx, qy)) near[lidx(qx, qy)] = 1;
    }
  }
  return (BRIDGES = out);
}

/**
 * Lay London's streets round the structures the scenario places (`keeps`: each keeps its footprint and gets a road
 * along its front). In order:
 *
 * 1. The bridges: each named crossing on the shortest run of water near the real one, with a road landing at each end.
 * 2. The main roads (ARTERIALS), a road along every structure's front, a road round every park, and each bridge's
 *    approach on to the nearest road.
 * 3. Streets in what is left: each cell of land between roads is split by through roads until it is no bigger than its
 *    character's `cell`, then filled with parallel streets (along the river near it, else along the cell's long side)
 *    and cross streets between them at staggered places, so neighbouring blocks never line up into a lattice: T
 *    junctions, offset streets, the odd cul-de-sac.
 * 4. Pockets no road reaches get a cul-de-sac in the dense characters; every road joins the network (a link over land,
 *    through a park or over a railway on a level crossing; a road that cannot be joined is dropped).
 */
export function londonPlan(keeps: readonly Placed[]): LondonPlan {
  const { water, park: basePark, reserved } = londonBase();
  const problems: string[] = [];
  const t = new Uint8Array(N), park = new Int16Array(basePark);
  for (let i = 0; i < N; i++) {
    t[i] = water[i] ? LT.Water : reserved[i] >= 0 ? (RESERVED[reserved[i]].airfield ? LT.Airfield : LT.Rail) : park[i] >= 0 ? LT.Park : LT.Land;
  }
  for (const k of keeps) for (let y = k.ay; y < k.ay + k.h; y++) for (let x = k.ax; x < k.ax + k.w; x++) {
    if (!inLondon(x, y)) { problems.push(`a placement at (${k.ax}, ${k.ay}) runs off the map`); continue; }
    const i = lidx(x, y);
    if (t[i] !== LT.Land && t[i] !== LT.Park && t[i] !== LT.Airfield) problems.push(`a placement at (${k.ax}, ${k.ay}) covers ${t[i] === LT.Water ? 'water' : 'reserved land'} at (${x}, ${y})`);
    t[i] = LT.Keep; park[i] = -1;
  }
  /** land beside a bridge deck: no road may join a deck from the side */
  const noRoad = new Uint8Array(N);
  const free = (i: number) => (t[i] === LT.Land || t[i] === LT.Park) && !noRoad[i];
  /** main roads (arterials, fronts, park rings, approaches, links): never pruned */
  const major = new Uint8Array(N);
  const put = (i: number) => { if (t[i] === LT.Land && !noRoad[i]) { t[i] = LT.Road; major[i] = 1; } return t[i] === LT.Road || t[i] === LT.Crossing; };
  const isRoadT = (v: number) => v === LT.Road || v === LT.Crossing || v === LT.Deck;
  const roadAt = (x: number, y: number) => inLondon(x, y) && isRoadT(t[lidx(x, y)]);
  const landAt = (x: number, y: number) => inLondon(x, y) && t[lidx(x, y)] === LT.Land;
  /**
   * A side street along a row (`rows`) or a column: not where it would make a 2×2 of road, nor one lot away from a
   * road beside it (a sliver of lots one deep between two parallel streets).
   */
  const minor = (i: number, rows: boolean) => {
    if (t[i] !== LT.Land || noRoad[i]) return false;
    const x = tx(i), y = ty(i);
    for (let q = 0; q < 4; q++) {
      const ox = (q & 1) - 1, oy = (q >> 1) - 1;
      let n = 0;
      for (let k = 0; k < 4; k++) { const qx = x + ox + (k & 1), qy = y + oy + (k >> 1); if ((qx !== x || qy !== y) && roadAt(qx, qy)) n++; }
      if (n === 3) return false;
    }
    for (let s = -1; s <= 1; s += 2) {
      const nx = rows ? x : x + s, ny = rows ? y + s : y, fx = rows ? x : x + 2 * s, fy = rows ? y + 2 * s : y;
      if (landAt(nx, ny) && roadAt(fx, fy)) return false;
    }
    t[i] = LT.Road;
    return true;
  };

  // 1. bridges (londonBridges): decks over the water, a road landing at each end, no road beside a deck
  const bridges = londonBridges();
  for (const [, , , name] of THAMES) if (name && !bridges.some((b) => b.name === name)) problems.push(`${name}: no run of water to bridge near it`);
  for (const b of bridges) {
    const dx = b.ns ? 0 : 1, dy = b.ns ? 1 : 0;
    for (let k = -1; k <= b.len; k++) {
      const x = b.x + dx * k, y = b.y + dy * k, i = lidx(x, y);
      if (k < 0 || k === b.len) {
        if (t[i] !== LT.Land) problems.push(`${b.name}: its landing at (${x}, ${y}) is taken`);
        else { t[i] = LT.Road; major[i] = 1; }
        continue;
      }
      t[i] = LT.Deck;
      for (const s of [-1, 1]) { const qx = x + dy * s, qy = y + dx * s; if (inLondon(qx, qy) && t[lidx(qx, qy)] !== LT.Water) noRoad[lidx(qx, qy)] = 1; }
    }
  }

  // 2. the main roads: every structure's front, the arterials, round the parks, and the bridges' approaches
  for (const k of keeps) {
    const [fx, fy] = DIRS[k.r];
    const span = fx ? k.h : k.w;
    for (let s = 0; s < span; s++) {
      const x = fx ? (fx > 0 ? k.ax + k.w : k.ax - 1) : k.ax + s, y = fy ? (fy > 0 ? k.ay + k.h : k.ay - 1) : k.ay + s;
      if (!inLondon(x, y)) continue;
      const i = lidx(x, y);
      if (t[i] === LT.Park) { t[i] = LT.Land; park[i] = -1; }
      put(i);
    }
    if (!roadAt(k.frontX, k.frontY)) problems.push(`no road can reach the front of the placement at (${k.doorX}, ${k.doorY})`);
  }
  let crossings = 0;
  /** a railway tile a road may cross at right angles going (dx, dy): one corridor, not its end, no structure or crossing beside it */
  const crossable = (x: number, y: number, dx: number, dy: number) => {
    if (!inLondon(x, y) || t[lidx(x, y)] !== LT.Rail) return false;
    const on = RESERVED.filter((q) => !q.airfield && inRect(q.rect, x, y));
    if (on.length !== 1) return false;
    const [rx, ry, rw, rh] = on[0].rect, alongX = rw > 1;
    if (alongX ? dx !== 0 || x === rx || x === rx + rw - 1 : dy !== 0 || y === ry || y === ry + rh - 1) return false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!inLondon(x + ox, y + oy)) return false;
      const v = t[lidx(x + ox, y + oy)];
      if (v === LT.Keep || v === LT.Crossing) return false;
    }
    const bx = x + dx, by = y + dy, ax = x - dx, ay = y - dy;
    return inLondon(ax, ay) && inLondon(bx, by) && [lidx(ax, ay), lidx(bx, by)].every((j) => free(j) || t[j] === LT.Road);
  };
  const paintPath = (path: [number, number][]) => {
    for (let k = 0; k < path.length; k++) {
      const [x, y] = path[k];
      if (!inLondon(x, y)) continue;
      const i = lidx(x, y);
      if (t[i] === LT.Rail && k > 0 && k + 1 < path.length) {
        const [px, py] = path[k - 1], [nx, ny] = path[k + 1];
        if (x - px === nx - x && y - py === ny - y && crossable(x, y, x - px, y - py)) { t[i] = LT.Crossing; crossings++; }
        continue;
      }
      put(i);
    }
  };
  for (const path of arterialPaths()) paintPath(path);
  for (let i = 0; i < N; i++) {
    if (t[i] !== LT.Park) continue;
    const x = tx(i), y = ty(i);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (inLondon(x + ox, y + oy)) put(lidx(x + ox, y + oy));
  }
  for (const b of bridges) for (const end of [-1, b.len]) {
    const sx = b.ns ? 0 : end < 0 ? -1 : 1, sy = b.ns ? (end < 0 ? -1 : 1) : 0;
    let x = b.x + (b.ns ? 0 : end) + sx, y = b.y + (b.ns ? end : 0) + sy;
    for (let n = 0; n < 30 && inLondon(x, y) && free(lidx(x, y)) && t[lidx(x, y)] === LT.Land; n++, x += sx, y += sy) put(lidx(x, y));
  }

  // 3. streets in the cells left between the main roads
  const stamp = new Int32Array(N);
  let stampN = 0;
  /** components (4-connected) of land among `tiles` */
  const components = (tiles: number[]): number[][] => {
    const id = ++stampN;
    for (const i of tiles) if (t[i] === LT.Land) stamp[i] = id;
    const out: number[][] = [];
    for (const i of tiles) {
      if (stamp[i] !== id) continue;
      const comp = [i];
      stamp[i] = -id;
      for (let q = 0; q < comp.length; q++) {
        const j = comp[q], x = tx(j), y = ty(j);
        for (const [dx, dy] of DIRS) {
          if (!inLondon(x + dx, y + dy)) continue;
          const k = lidx(x + dx, y + dy);
          if (stamp[k] === id) { stamp[k] = -id; comp.push(k); }
        }
      }
      out.push(comp);
    }
    return out;
  };
  const all: number[] = [];
  for (let i = 0; i < N; i++) if (t[i] === LT.Land) all.push(i);
  const stack = components(all);
  while (stack.length) {
    const cell = stack.pop()!;
    if (cell.length < 4) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (const i of cell) { const x = tx(i), y = ty(i); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; sy += y; }
    const cx = sx / cell.length + 0.5, cy = sy / cell.length + 0.5, ch = placeAt(cx, cy).c, sp = STREETS[ch];
    const W = x1 - x0 + 1, H = y1 - y0 + 1, seed = Math.floor(hash2(x0 * 97 + y1, y0 * 89 + x1) * 1e6);
    if (Math.max(W, H) > sp.cell) {
      // a through road across the cell's long side, a little off the middle
      const vertical = W >= H, lo = vertical ? x0 : y0, len = vertical ? W : H;
      const at = lo + Math.round(len * (0.36 + 0.28 * hash2(seed, 3)));
      let painted = 0;
      for (const i of cell) if ((vertical ? tx(i) : ty(i)) === at && minor(i, !vertical)) painted++;
      if (painted) { stack.push(...components(cell)); continue; }
    }
    // parallel streets: along the river where the cell meets it, else along the cell's long side
    let rows = W > H || (W === H && hash2(seed, 5) < 0.5);
    if (Math.max(W, H) < 1.5 * Math.min(W, H) && hash2(seed, 7) < 0.25) rows = !rows;
    if (cell.some((i) => { const x = tx(i), y = ty(i); return DIRS.some(([dx, dy]) => inLondon(x + dx, y + dy) && t[lidx(x + dx, y + dy)] === LT.Water); })) {
      const [rx, ry] = riverTangent(cx, cy);
      rows = Math.abs(rx) >= Math.abs(ry);
    }
    // the cell's tiles by (along, across): -1 off the cell
    const grid = new Int32Array(W * H).fill(-1);
    for (const i of cell) grid[(ty(i) - y0) * W + tx(i) - x0] = i;
    const tileAt = (al: number, ac: number) => { const x = rows ? ac : al, y = rows ? al : ac; return x < x0 || x > x1 || y < y0 || y > y1 ? -1 : grid[(y - y0) * W + x - x0]; };
    const [plo, phi] = rows ? [y0, y1] : [x0, x1], [olo, ohi] = rows ? [x0, x1] : [y0, y1];
    const lines: number[] = [];
    for (let k = 0, pos = plo - 1; ; k++) {
      const next = pos + pick(sp.depth, hash2(seed + k * 31, 17)) + 1;
      if (next > phi - sp.depth[0]) break;
      lines.push(next);
      pos = next;
    }
    for (const L of lines) for (let ac = olo; ac <= ohi; ac++) { const i = tileAt(L, ac); if (i >= 0) minor(i, rows); }
    // through streets: a few cross streets run straight across every strip of the cell, so a trip across the grain
    // does not zigzag from one staggered street to the next
    const through: number[] = [];
    for (let p = olo + pick(sp.len, hash2(seed, 23)) + 1, k = 0; p <= ohi - sp.len[0]; k++) {
      through.push(p);
      p += pick(sp.len, hash2(seed + k * 17, 29)) + pick(sp.len, hash2(seed + k * 17, 31)) + 2;
    }
    const bounds = [plo - 1, ...lines, phi + 1];
    for (let s = 0; s + 1 < bounds.length; s++) {
      const a = bounds[s] + 1, b = bounds[s + 1] - 1;
      if (a > b) continue;
      const cross = (p: number, h: number) => {
        // a cul-de-sac stops a tile short of the far street
        const dead = b - a >= 3 && h < sp.dead, from = dead && h < sp.dead / 2 ? a + 1 : a, to = dead && h >= sp.dead / 2 ? b - 1 : b;
        for (let al = from; al <= to; al++) { const i = tileAt(al, p); if (i >= 0) minor(i, !rows); }
      };
      for (const p of through) cross(p, 1);
      // the others at staggered places, so this strip's never line up with the next one's
      let p = olo + 2 + Math.floor(hash2(seed + s * 131, 5) * (sp.len[1] - 1));
      for (let k = 0; p <= ohi - sp.len[0]; k++) {
        if (through.every((q) => Math.abs(q - p) >= sp.len[0])) cross(p, hash2(seed + s * 131 + k * 7, 11));
        p += pick(sp.len, hash2(seed + s * 131 + k * 7, 13)) + 1;
      }
    }
  }

  // a street broken by a gap of one or two lots (where its line crossed into the next cell, or met a rule above) is
  // joined up, so long streets run through and a trip along one does not detour round the block
  for (let i = 0; i < N; i++) {
    if (t[i] !== LT.Land || noRoad[i]) continue;
    const x = tx(i), y = ty(i);
    for (const rows of [true, false]) {
      const dx = rows ? 1 : 0, dy = rows ? 0 : 1;
      if (!roadAt(x - dx, y - dy)) continue;
      const gap = roadAt(x + dx, y + dy) ? 1 : landAt(x + dx, y + dy) && roadAt(x + 2 * dx, y + 2 * dy) ? 2 : 0;
      if (!gap || !roadAt(x - 2 * dx, y - 2 * dy) || !roadAt(x + (gap + 1) * dx, y + (gap + 1) * dy)) continue;
      if (minor(i, rows) && gap === 2) minor(lidx(x + dx, y + dy), rows);
      break;
    }
  }

  // railways: streets meeting a line from both sides cross it (a street up to six tiles short of it on the far side is
  // carried on to it), a few tiles apart along the line, and a stretch of more than eight tiles with no crossing gets
  // one carried through to the streets either side, so a line does not cut the districts either side of it apart
  const crossAt = (x: number, y: number, dx: number, dy: number, both: boolean): boolean => {
    if (!crossable(x, y, dx, dy)) return false;
    /** tiles from the line to the first road on the side `s`, or 0 when none is in reach over land */
    const run = (s: number) => {
      for (let d = 1; d <= 6; d++) {
        const fx = x + dx * s * d, fy = y + dy * s * d;
        if (roadAt(fx, fy)) return d;
        if (!landAt(fx, fy) || noRoad[lidx(fx, fy)]) return 0;
      }
      return 0;
    };
    const ra = run(-1), rb = run(1);
    if (!ra || !rb || (!both && ra > 1 && rb > 1)) return false;
    for (const [s, r] of [[-1, ra], [1, rb]]) for (let d = 1; d < r; d++) put(lidx(x + dx * s * d, y + dy * s * d));
    if (!roadAt(x - dx, y - dy) || !roadAt(x + dx, y + dy)) return false;
    t[lidx(x, y)] = LT.Crossing; crossings++;
    for (const [s, r] of [[-1, ra], [1, rb]]) for (let d = 1; d < r; d++) major[lidx(x + dx * s * d, y + dy * s * d)] = 1;
    return true;
  };
  for (const q of RESERVED) {
    if (q.airfield) continue;
    const [rx, ry, rw, rh] = q.rect, alongX = rw > 1, n = alongX ? rw : rh;
    const at = (k: number): [number, number] => (alongX ? [rx + k, ry] : [rx, ry + k]);
    const dx = alongX ? 0 : 1, dy = alongX ? 1 : 0;
    const isX = (k: number) => { const [x, y] = at(k); return inLondon(x, y) && t[lidx(x, y)] === LT.Crossing; };
    let last = -99;
    for (let k = 1; k < n - 1; k++) {
      if (isX(k)) { last = k; continue; }
      const [x, y] = at(k);
      if (k - last >= 4 && crossAt(x, y, dx, dy, false)) last = k;
    }
    // long stretches with none: one in the middle, carried through to the streets either side
    for (let k = 1, prev = 0; k < n; k++) {
      if (!isX(k) && k < n - 1) continue;
      if (k - prev > 8) for (let o = 0; o <= (k - prev) / 2 - 2; o++) {
        const m = Math.floor((prev + k) / 2);
        if ([m + o, m - o].some((j) => j > 0 && j < n - 1 && crossAt(...at(j), dx, dy, true))) break;
      }
      prev = k;
    }
  }

  // 4. reach, cul-de-sacs into pockets, and one network
  const reach = new Uint8Array(N);
  const computeReach = () => {
    reach.fill(0);
    for (let i = 0; i < N; i++) {
      if (t[i] !== LT.Land) continue;
      const x = tx(i), y = ty(i);
      if (DIRS.some(([dx, dy]) => inLondon(x + dx, y + dy) && t[lidx(x + dx, y + dy)] === LT.Road)) reach[i] = 1;
    }
    for (let i = 0; i < N; i++) {
      if (t[i] !== LT.Land || reach[i]) continue;
      const x = tx(i), y = ty(i);
      if (DIRS.some(([dx, dy]) => inLondon(x + 2 * dx, y + 2 * dy) && t[lidx(x + dx, y + dy)] === LT.Land && t[lidx(x + 2 * dx, y + 2 * dy)] === LT.Road)) reach[i] = 2;
    }
  };
  /** cheapest link from `from` (tiles) to a road not in `own`: over land, dearer through a park, over a railway at right angles */
  const cost = new Float64Array(N), prev = new Int32Array(N), seen = new Int32Array(N);
  let gen = 0;
  const link = (from: number[], own: (i: number) => boolean): number[] | null => {
    gen++;
    const costOf = (i: number) => (seen[i] === gen ? cost[i] : Infinity);
    const set = (i: number, c: number, p: number) => { seen[i] = gen; cost[i] = c; prev[i] = p; };
    const heap: [number, number][] = [];
    const push = (c: number, i: number) => { heap.push([c, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    for (const i of from) { set(i, 0, -1); push(0, i); }
    while (heap.length) {
      const [c, i] = pop();
      if (c > costOf(i)) continue;
      if (c > 0 && isRoadT(t[i]) && !own(i)) {
        const path: number[] = [];
        for (let j = prev[i]; j >= 0 && cost[j] > 0; j = prev[j]) path.push(j);
        return path;
      }
      if (c > 0 && !free(i) && t[i] !== LT.Rail) continue;
      const x = tx(i), y = ty(i);
      for (const [dx, dy] of DIRS) {
        if (!inLondon(x + dx, y + dy)) continue;
        const j = lidx(x + dx, y + dy);
        let step: number;
        if (isRoadT(t[j])) step = own(j) ? Infinity : 0.5;
        else if (t[j] === LT.Rail) step = crossable(x + dx, y + dy, dx, dy) && t[i] !== LT.Rail ? 4 : Infinity;
        else if (!free(j)) step = Infinity;
        else step = t[j] === LT.Park ? 4 : 1;
        // over a railway only straight on
        if (t[i] === LT.Rail && (prev[i] < 0 || j - i !== i - prev[i])) step = Infinity;
        if (c + step < costOf(j)) { set(j, c + step, i); push(c + step, j); }
      }
    }
    return null;
  };
  const paintLink = (path: number[]) => {
    for (const j of path) {
      if (t[j] === LT.Rail) { t[j] = LT.Crossing; crossings++; continue; }
      if (t[j] === LT.Park) { t[j] = LT.Land; park[j] = -1; }
      put(j);
    }
  };
  computeReach();
  // pockets no road reaches in the dense characters: a cul-de-sac to the middle (the suburbs keep theirs as gardens)
  {
    const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (t[i] !== LT.Land || reach[i] || seen[i]) continue;
      const pocket = [i];
      seen[i] = 1;
      for (let q = 0; q < pocket.length; q++) {
        const x = tx(pocket[q]), y = ty(pocket[q]);
        for (const [dx, dy] of DIRS) { if (!inLondon(x + dx, y + dy)) continue; const j = lidx(x + dx, y + dy); if (!seen[j] && t[j] === LT.Land && !reach[j]) { seen[j] = 1; pocket.push(j); } }
      }
      if (pocket.length < 3) continue;
      let sx = 0, sy = 0;
      for (const j of pocket) { sx += tx(j); sy += ty(j); }
      const c = placeAt(sx / pocket.length + 0.5, sy / pocket.length + 0.5).c;
      if (c === 'suburb' || c === 'outer') continue;
      let mid = pocket[0], md = Infinity;
      for (const j of pocket) { const d = (tx(j) - sx / pocket.length) ** 2 + (ty(j) - sy / pocket.length) ** 2; if (d < md && !noRoad[j]) { md = d; mid = j; } }
      if (noRoad[mid]) continue;
      const path = link([mid], (j) => j === mid);
      if (path && path.length <= 4) { paintLink(path); put(mid); }
    }
  }
  // one network: join every road to the largest, or drop it
  for (let round = 0; round < 8; round++) {
    const comp = new Int32Array(N).fill(-1), sizes: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!isRoadT(t[i]) || comp[i] >= 0) continue;
      const id = sizes.length, q = [i];
      comp[i] = id;
      for (let k = 0; k < q.length; k++) {
        const x = tx(q[k]), y = ty(q[k]);
        for (const [dx, dy] of DIRS) { if (!inLondon(x + dx, y + dy)) continue; const j = lidx(x + dx, y + dy); if (comp[j] < 0 && isRoadT(t[j])) { comp[j] = id; q.push(j); } }
      }
      sizes.push(q.length);
    }
    if (sizes.length <= 1) break;
    const main = sizes.indexOf(Math.max(...sizes));
    const members: number[][] = sizes.map(() => []);
    for (let i = 0; i < N; i++) if (comp[i] >= 0) members[comp[i]].push(i);
    for (let id = 0; id < sizes.length; id++) {
      if (id === main) continue;
      const path = link(members[id], (j) => comp[j] === id);
      if (path) { paintLink(path); continue; }
      if (round < 7) continue;
      for (const j of members[id]) if (t[j] === LT.Road) t[j] = LT.Land;
      problems.push(`a road at (${tx(members[id][0])}, ${ty(members[id][0])}) cannot join the network`);
    }
  }
  // a structure's front joins the network at both ends where it can (a short link over land or through a park), so a
  // station's or a landmark's traffic does not queue in and out of a cul-de-sac
  for (const k of keeps) {
    const [fx, fy] = DIRS[k.r], span = fx ? k.h : k.w;
    const front: number[] = [];
    for (let s = 0; s < span; s++) {
      const x = fx ? (fx > 0 ? k.ax + k.w : k.ax - 1) : k.ax + s, y = fy ? (fy > 0 ? k.ay + k.h : k.ay - 1) : k.ay + s;
      if (inLondon(x, y) && roadAt(x, y)) front.push(lidx(x, y));
    }
    if (front.length !== span) continue;
    const own = new Set(front), ax = fx ? 0 : 1, ay = fx ? 1 : 0;
    for (const [end, s] of [[front[0], -1], [front[front.length - 1], 1]] as const) {
      const x = tx(end) + ax * s, y = ty(end) + ay * s;
      if (roadAt(x, y)) continue;
      const path = link([end], (j) => own.has(j));
      if (path && path.length <= 6) paintLink(path);
    }
  }
  // short spurs left where a side street was cut off (a cul-de-sac is three tiles or more) go back to lots; not the
  // road either side of a level crossing
  for (let i = 0; i < N; i++) if (t[i] === LT.Crossing) for (const [dx, dy] of DIRS) if (roadAt(tx(i) + dx, ty(i) + dy)) major[lidx(tx(i) + dx, ty(i) + dy)] = 1;
  for (let again = true; again;) {
    again = false;
    const degree = (j: number) => { const x = tx(j), y = ty(j); let n = 0; for (const [dx, dy] of DIRS) if (roadAt(x + dx, y + dy)) n++; return n; };
    for (let i = 0; i < N; i++) {
      if (t[i] !== LT.Road || major[i] || degree(i) !== 1) continue;
      const chain = [i];
      for (let j = i; chain.length <= 3;) {
        const x = tx(j), y = ty(j);
        let next = -1;
        for (const [dx, dy] of DIRS) { if (!roadAt(x + dx, y + dy)) continue; const k = lidx(x + dx, y + dy); if (!chain.includes(k)) next = k; }
        if (next < 0 || t[next] !== LT.Road || major[next] || degree(next) !== 2) break;
        chain.push(next);
        j = next;
      }
      if (chain.length > 2) continue;
      for (const j of chain) t[j] = LT.Land;
      again = true;
    }
  }
  // a level crossing needs road on both sides of the track
  for (let i = 0; i < N; i++) {
    if (t[i] !== LT.Crossing) continue;
    const x = tx(i), y = ty(i), ns = roadAt(x, y - 1) && roadAt(x, y + 1), ew = roadAt(x - 1, y) && roadAt(x + 1, y);
    if (!ns && !ew) { t[i] = LT.Rail; crossings--; }
  }
  computeReach();

  // blocks: the lots between roads
  const block = new Int32Array(N).fill(-1), blocks: LondonBlock[] = [];
  for (let i = 0; i < N; i++) {
    if (t[i] !== LT.Land || block[i] >= 0) continue;
    const id = blocks.length, q = [i];
    block[i] = id;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (let k = 0; k < q.length; k++) {
      const x = tx(q[k]), y = ty(q[k]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; sy += y;
      for (const [dx, dy] of DIRS) { if (!inLondon(x + dx, y + dy)) continue; const j = lidx(x + dx, y + dy); if (block[j] < 0 && t[j] === LT.Land) { block[j] = id; q.push(j); } }
    }
    blocks.push({ x0, y0, x1, y1, n: q.length, cx: sx / q.length + 0.5, cy: sy / q.length + 0.5 });
  }
  return { t, park, bridges, reach, block, blocks, main: major, loop: loops(t, isRoadT), crossings, problems };
}

/**
 * Road tiles on a loop: every tile with at most one edge that is a bridge of the road graph (Tarjan's bridges, an
 * iterative depth-first search), so a vehicle there can carry on and come back without turning round.
 */
function loops(t: Uint8Array, isRoadT: (v: number) => boolean): Uint8Array {
  const disc = new Int32Array(N).fill(-1), low = new Int32Array(N), parent = new Int32Array(N).fill(-1), next = new Uint8Array(N);
  const cut = new Uint8Array(N);
  const nb = (i: number, d: number) => { const x = tx(i) + DIRS[d][0], y = ty(i) + DIRS[d][1]; return inLondon(x, y) && isRoadT(t[lidx(x, y)]) ? lidx(x, y) : -1; };
  let time = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!isRoadT(t[s0]) || disc[s0] >= 0) continue;
    const stack = [s0];
    disc[s0] = low[s0] = time++;
    while (stack.length) {
      const u = stack[stack.length - 1];
      if (next[u] < 4) {
        const v = nb(u, next[u]++);
        if (v < 0 || v === parent[u]) continue;
        if (disc[v] < 0) { parent[v] = u; disc[v] = low[v] = time++; stack.push(v); }
        else low[u] = Math.min(low[u], disc[v]);
        continue;
      }
      stack.pop();
      const p = parent[u];
      if (p >= 0) {
        low[p] = Math.min(low[p], low[u]);
        if (low[u] > disc[p]) { cut[u]++; cut[p]++; } // the edge p-u is a bridge
      }
    }
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (isRoadT(t[i]) && cut[i] === 0) out[i] = 1;
  return out;
}

let PATHS: [number, number][][] | null = null;
/** The main roads' tiles (ARTERIALS through `staircase`), for the scenario to keep its structures off. */
export function arterialPaths(): [number, number][][] {
  return (PATHS ??= ARTERIALS.map((a) => staircase(a.pts.map(([lat, lon]) => geo(lat, lon)))));
}

/**
 * Tiles along waypoints, 4-connected: each leg an L (the longer side first), or a staircase of steps no shorter than
 * two tiles when it is long and slanting; a sideways offset of one tile is not worth a step and carries on to the next leg.
 */
export function staircase(pts: readonly DemoXY[]): [number, number][] {
  const out: [number, number][] = [];
  let [x, y] = pts[0];
  out.push([x, y]);
  const go = (dx: number, dy: number, n: number) => { for (let k = 0; k < n; k++) { x += dx; y += dy; out.push([x, y]); } };
  for (let p = 1; p < pts.length; p++) {
    const [ex, ey] = pts[p], dx = ex - x, dy = ey - y, horiz = Math.abs(dx) >= Math.abs(dy);
    const major = horiz ? dx : dy, minorD = horiz ? dy : dx;
    if (Math.abs(minorD) < 2) { go(horiz ? Math.sign(dx) : 0, horiz ? 0 : Math.sign(dy), Math.abs(major)); continue; }
    const steps = Math.max(1, Math.min(Math.round(Math.abs(major) / 6), Math.floor(Math.abs(minorD) / 2)));
    for (let s = 0; s < steps; s++) {
      const m = Math.round(((s + 1) * major) / steps) - Math.round((s * major) / steps);
      const n = Math.round(((s + 1) * minorD) / steps) - Math.round((s * minorD) / steps);
      if (horiz) { go(Math.sign(m), 0, Math.abs(m)); go(0, Math.sign(n), Math.abs(n)); }
      else { go(0, Math.sign(m), Math.abs(m)); go(Math.sign(n), 0, Math.abs(n)); }
    }
  }
  return out;
}
