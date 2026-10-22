import type { DemoRect, DemoXY, DemoSection, DemoPlacement, DemoBlock, DemoClassRoad, DemoJunction, DemoStreetRule, DemoSpot, TourStop } from './showcase';
import { hash2 } from '../noise';
import { KIND_ID } from '../buildings/compiled';
import { FRONT, placedFromAnchor, placedFromDoor, isWetTile, fairwayTiles, fairwayDepth, WET_OF, type Placed } from '../structures';
import { HARBOUR_OF } from '../harbours';
import { TRANSIT } from '../transit';
import { platformSpan } from '../metro';
import { stopTile } from '../rail';
import { LONDON_MAP, LT, DOCKS, RM, ARTERIALS, BOROUGHS, arterialPaths, geoF, inLondon, lidx, londonBase, londonBridges, londonPlan, londonRoads, londonSeaGates, motorwayConnections, placeAt, type LondonPlan } from './londonMap';

/**
 * London (docs/demo.md "London"): a sample city on the shape of the real one. The Thames runs through it as water
 * tiles with its recognisable meander (the Barnes loop, the Westminster bend, the loop round the Isle of Dogs, the
 * Greenwich peninsula) and widens east to the estuary. Around it the town is zoned roughly as London is: the City and
 * Canary Wharf dense offices, the West End shops and theatres, Westminster civic, rings of homes, industry down the
 * docks and the Thames Gateway, the big parks, Heathrow in the far west, the rail termini with their lines.
 *
 * The map is data in londonMap.ts (the river, docks, places, parks, main roads and boroughs) and the streets are
 * planned there round this file's structures: the landmarks and stations stand where the real ones do (nudged off
 * water and railways), the streets are laid round them with a road along every front, and the bus stops and the 1×1
 * venues then take frontage lots near their real places. Built on first use (`londonScenario`), so a server or client
 * that never opens London never plans it. The server's seeder (server/src/demo/london.ts) paints the plan into a World.
 */

const SIDES = { S: 0, E: 1, N: 2, W: 3 } as const;
type Side = keyof typeof SIDES;
const K = KIND_ID as Record<string, number>;
const [MX, MY, MW, MH] = LONDON_MAP;

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
const STATION_KIND: Record<keyof typeof STATIONS, string> = {
  paddington: 'rail-station', ealing: 'rail-station', heathrowStation: 'rail-station', kingsCross: 'rail-station', finsburyPark: 'rail-station',
  liverpoolStreet: 'rail-station', stratford: 'rail-station', waterloo: 'rail-station', claphamJunction: 'rail-station', barking: 'freight-yard', dagenham: 'freight-yard',
};
const HEATHROW: DemoPlacement = { id: 'heathrow', kind: 'airport', door: [-96, 3], rot: 1 };

/** A structure where a real one stands: id, kind, latitude, longitude, the side its door faces and (where the map's river strays from the real one) its bank. */
type Spot = readonly [id: string, kind: string, lat: number, lon: number, side: Side, bank?: 'N' | 'S'];
/**
 * The landmarks and other multi-tile placements, in the order they claim their land (the London landmarks first).
 * Each stands as near its real place as the land allows: off the water and the railways, a tile clear of the others.
 */
const STRUCTURES: Spot[] = [
  // buildings/landmarks-london.ts and landmarks-london-2.ts. Parliament on the river by Westminster Bridge, Big Ben at
  // its north end; the Eye across the river on the South Bank; the Palace at the end of the Mall past St James's Park;
  // the Tower by the river east of the City, Tower Bridge (below, `bridges`) beside it as a real road bridge
  ['parliament', 'parliament', 51.4995, -0.1255, 'N'],
  ['london-eye', 'london-eye', 51.5033, -0.1180, 'S'],
  ['buckingham-palace', 'buckingham-palace', 51.5014, -0.1419, 'E'],
  ['tower-of-london', 'tower-of-london', 51.5085, -0.0765, 'N'],
  ['shard', 'shard', 51.5045, -0.0865, 'W'],
  ['gherkin', 'gherkin', 51.5145, -0.0803, 'S'],
  ['walkie-talkie', 'walkie-talkie', 51.5113, -0.0836, 'N'],
  ['one-canada-square', 'one-canada-square', 51.5049, -0.0195, 'W'],
  ['royal-opera-house', 'royal-opera-house', 51.5129, -0.1222, 'S'],
  ['new-scotland-yard', 'police-hq', 51.5025, -0.1245, 'W'], // on the Embankment north of Westminster Bridge, as the real one is now
  ['st-thomas', 'teaching-hospital', 51.4986, -0.1182, 'E'],
  ['royal-london', 'general-hospital', 51.5183, -0.0590, 'N'],
  ['lambeth-fire', 'fire-hq', 51.4915, -0.1185, 'W'],
  ['british-museum', 'museum', 51.5194, -0.1270, 'S'],
  ['natural-history-museum', 'museum', 51.4967, -0.1764, 'N'],
  ['maritime-museum', 'museum', 51.4810, -0.0054, 'N', 'S'], // Greenwich, across the river from the tip of the Isle of Dogs
  ['british-library', 'central-library', 51.5300, -0.1276, 'S'],
  // the universities (buildings/landmarks-london-3.ts): UCL's Wilkins Building on Gower Street, King's Strand building
  // beside Somerset House, LSE on Houghton Street, Imperial's Queen's Tower in South Kensington
  ['ucl', 'ucl', 51.5246, -0.1340, 'S'],
  ['kings', 'kings', 51.5115, -0.1160, 'N', 'N'],
  ['lse', 'lse', 51.5144, -0.1165, 'W', 'N'],
  ['imperial', 'imperial', 51.4988, -0.1749, 'S'],
  // Piccadilly Circus (buildings/landmarks-london-4.ts): the Lights on the circus at the east end of Piccadilly, its
  // front on Piccadilly where Regent Street, Shaftesbury Avenue, Coventry Street and Haymarket meet it
  ['piccadilly-circus', 'piccadilly-circus', 51.5100, -0.1347, 'S'],
  ['leicester-square', 'multiplex', 51.5103, -0.1301, 'W'],
  ['serpentine', 'lakeside-park', 51.5050, -0.1700, 'S'],
  ['regents-park-lake', 'lakeside-park', 51.5270, -0.1600, 'N'],
  ['kew-gardens', 'botanical-garden', 51.4787, -0.2955, 'S'],
  ['wembley', 'stadium', 51.5560, -0.2795, 'S'],
  ['london-stadium', 'stadium', 51.5387, -0.0166, 'S'],
  ['copper-box', 'leisure-centre', 51.5448, -0.0215, 'W'],
  ['o2-arena', 'arena', 51.4999, 0.0211, 'W'],
  // the schools of the boroughs, among their homes (docs/education.md section 9): primaries and secondaries
  ['primary-islington', 'primary-school', 51.5400, -0.1050, 'S'],
  ['primary-hackney', 'primary-school', 51.5470, -0.0600, 'S'],
  ['primary-camden', 'primary-school', 51.5420, -0.1500, 'S'],
  ['primary-brixton', 'primary-school', 51.4640, -0.1100, 'N'],
  ['primary-clapham', 'primary-school', 51.4640, -0.1520, 'N'],
  ['primary-kensington', 'primary-school', 51.4930, -0.1950, 'S'],
  ['secondary-islington', 'secondary-school', 51.5330, -0.1100, 'S'],
  ['secondary-hackney', 'secondary-school', 51.5520, -0.0500, 'S'],
  ['secondary-brixton', 'secondary-school', 51.4560, -0.1180, 'N'],
  ['secondary-hammersmith', 'secondary-school', 51.4950, -0.2200, 'S'],
  // the Magnificent Seven's grandest (docs/remembrance.md): Highgate on its hill, Kensal Green on the Harrow Road, Brompton off the
  // Old Brompton Road; and Golders Green Crematorium on Hoop Lane, all with their dead (STRUCTURE_EXTRA)
  ['highgate-cemetery', 'garden-cemetery', 51.5670, -0.1470, 'S'],
  ['kensal-green-cemetery', 'garden-cemetery', 51.5280, -0.2230, 'N'],
  ['brompton-cemetery', 'garden-cemetery', 51.4847, -0.1897, 'N'],
  ['golders-green-crematorium', 'crematorium', 51.5780, -0.1940, 'S'],
  ['victoria-garage', 'bus-depot', 51.4930, -0.1450, 'N'],
  ['stockwell-garage', 'bus-depot', 51.4740, -0.1180, 'E'],
  ['poplar-garage', 'bus-depot', 51.5110, -0.0050, 'N'],
];
/** Landmarks the tour shows at an hour and from an angle of their own: the Piccadilly Lights after dark, from the front-left where the curve faces. */
const TOUR_VIEWS: Record<string, Pick<DemoPlacement, 'hour' | 'aside' | 'zoom'>> = { 'piccadilly-circus': { hour: 21.5, aside: -0.6, zoom: 0.7 } };
/** Structures with a name of their own (World.setStopName at the door) and resting places with their dead seeded (a share of the plots). */
const STRUCTURE_EXTRA: Record<string, Pick<DemoPlacement, 'name' | 'graves'>> = {
  'highgate-cemetery': { name: 'Highgate Cemetery', graves: 0.85 },
  'kensal-green-cemetery': { name: 'Kensal Green Cemetery', graves: 0.8 },
  'brompton-cemetery': { name: 'Brompton Cemetery', graves: 0.8 },
  'golders-green-crematorium': { name: 'Golders Green Crematorium', graves: 0.9 },
};
/** 1×1 venues, on a frontage lot near the real one once the streets are laid. */
const VENUES: Spot[] = [
  ['palladium', 'theatre', 51.5142, -0.1404, 'S'],
  ['lyceum', 'theatre', 51.5115, -0.1199, 'N'],
  ['donmar', 'studio-theatre', 51.5142, -0.1264, 'W'],
  ['barbican', 'theatre', 51.5200, -0.0938, 'S'],
  ['lords', 'sports', 51.5294, -0.1727, 'E'],
];
/** Bus routes: each stop near a real one, beside a plain stretch of road on its `side` (never facing a junction). */
const STOPS_25: [string, number, number][] = [
  ['marble-arch', 51.5160, -0.1590], ['oxford-circus', 51.5160, -0.1410], ['tottenham-ct', 51.5160, -0.1320], ['holborn', 51.5160, -0.1098],
  ['st-pauls', 51.5160, -0.0950], ['aldgate', 51.5160, -0.0720], ['whitechapel', 51.5160, -0.0600],
];
// a loop: east along Oxford Street's south kerb (stops on the side facing north, its eastbound carriageway) to
// Whitechapel and back along the north kerb, so its buses use both bus lanes and never turn in the road
const ROUTE_25: Spot[] = [
  ...STOPS_25.map(([n, lat, lon]): Spot => [`stop-25-${n}`, 'bus-stop', lat, lon, 'N']),
  ...STOPS_25.slice().reverse().map(([n, lat, lon]): Spot => [`stop-25-${n}-west`, 'bus-stop', lat, lon, 'S']),
];
// over Westminster Bridge, then south past the South Western line (over its level crossings) to Brixton
const ROUTE_159: Spot[] = [
  ['stop-159-oxford-circus', 'bus-stop', 51.5140, -0.1410, 'S'], ['stop-159-piccadilly', 'bus-stop', 51.5090, -0.1360, 'E'],
  ['stop-159-whitehall', 'bus-stop', 51.5030, -0.1270, 'W'], ['stop-159-lambeth-north', 'bus-stop', 51.4990, -0.1110, 'S'],
  ['stop-159-kennington', 'bus-stop', 51.4879, -0.1060, 'E'], ['stop-159-oval', 'bus-stop', 51.4800, -0.1130, 'E'],
  ['stop-159-brixton', 'bus-stop', 51.4620, -0.1140, 'N'],
];
const ROUTE_D3: Spot[] = [
  ['stop-d3-poplar', 'bus-stop', 51.5110, -0.0170, 'N'], ['stop-d3-canary-wharf', 'bus-stop', 51.4980, -0.0198, 'E'],
  ['stop-d3-millwall', 'bus-stop', 51.4894, -0.0293, 'E'], ['stop-d3-island-gardens', 'bus-stop', 51.4830, -0.0149, 'N'],
];

/**
 * The river (docs/boats.md section 8): the river bus piers on RB1 where the real ones are, in calling order up river to
 * down, and the harbours. Each is fitted as a landmark is, before the streets (a road along its front), with its back
 * rows over the Thames or a dock: id, kind, latitude, longitude, the name it goes by (World.setStopName at its door).
 */
type HarbourSpot = readonly [id: string, kind: string, lat: number, lon: number, name: string];
const PIERS: HarbourSpot[] = [
  // Westminster's banks are Parliament, New Scotland Yard and the Eye on the map, and from Waterloo to Tower Bridge the
  // bridges are three tiles apart (no room for Bankside, Blackfriars or London Bridge City): RB1 calls at Millbank, by
  // Vauxhall Bridge, and at Embankment, below Waterloo Bridge, for Westminster
  ['pier-millbank', 'ferry-pier', 51.4917, -0.1265, 'Millbank Pier'],
  ['pier-embankment', 'ferry-pier', 51.5075, -0.1217, 'Embankment Pier'],
  // the real Tower Pier is in the Pool, which is four tiles long here: this one stands below Tower Bridge
  ['pier-tower', 'ferry-pier', 51.5074, -0.0796, 'Tower Pier'],
  ['pier-canary-wharf', 'ferry-pier', 51.5048, -0.0275, 'Canary Wharf Pier'],
  ['pier-greenwich', 'ferry-pier', 51.4835, -0.0092, 'Greenwich Pier'],
];
const HARBOURS: HarbourSpot[] = [
  // the marina in St Katharine Docks (londonMap.ts DOCKS), east of the Tower (at the map's basin, a few tiles east of
  // the real one: the Tower's ground runs down to the Highway): its yachts and sailing barges are too tall for any
  // bridge but Tower Bridge lifted, so they sail up into the Pool of London through its lifts
  ['st-katharine', 'marina', 51.5164, -0.0462, 'St Katharine Docks'],
  // on Chelsea Reach, where the river is four tiles wide (up river of Battersea it is three and a half, and a jetty
  // there would leave the barges no channel to Teddington)
  ['chelsea-jetty', 'jetty', 51.4860, -0.1640, 'Chelsea Boathouse'],
  // down river of every bridge, where the Thames is 9 to 13 tiles wide: container ships from the estuary
  ['london-port', 'cargo-port', 51.5180, 0.1350, 'Dagenham Docks'],
  ['thamesmead-quay', 'fishing-harbour', 51.5044, 0.1172, 'Thamesmead Fish Quay'],
];

/**
 * The Underground (docs/underground.md section 7): a station's name, where the real one is (latitude, longitude) or the
 * rail terminus it changes with (its entrance then lands within the change walk of that station's door), and 'hall'
 * for a station hall (a 6-car platform) in place of a kiosk. Stations fewer than 6 tiles apart along a line are left out.
 */
type TubeStop = readonly [name: string, at: readonly [lat: number, lon: number] | keyof typeof STATIONS, hall?: 'hall'];
interface TubeLine { id: string; name: string; number: number; colour: number; trains: number; stops: TubeStop[] }
const TUBE: TubeLine[] = [
  { id: 'central', name: 'Central', number: 1, colour: 0xdc241f, trains: 8, stops: [
    ["Shepherd's Bush", [51.5046, -0.2187], 'hall'], ['Notting Hill Gate', [51.5094, -0.1967]], ['Marble Arch', [51.5136, -0.1586]],
    ['Tottenham Court Road', [51.5165, -0.1310]], ["St Paul's", [51.5146, -0.0973]], ['Liverpool Street', 'liverpoolStreet', 'hall'],
    ['Bethnal Green', [51.5270, -0.0549]], ['Mile End', [51.5249, -0.0332]], ['Stratford', 'stratford', 'hall'],
  ] },
  // drawn dark grey: the real line's black would not show underground
  { id: 'northern', name: 'Northern', number: 2, colour: 0x3a3a3a, trains: 8, stops: [
    ['Camden Town', [51.5392, -0.1426], 'hall'], ['Euston', [51.5282, -0.1337]], ['Tottenham Court Road', [51.5165, -0.1310]],
    ['Charing Cross', [51.5080, -0.1247]], ['Waterloo', 'waterloo'], ['Kennington', [51.4884, -0.1053]],
    ['Stockwell', [51.4723, -0.1229]], ['Clapham Common', [51.4618, -0.1384]], ['Balham', [51.4431, -0.1525], 'hall'],
  ] },
  { id: 'jubilee', name: 'Jubilee', number: 3, colour: 0xa0a5a9, trains: 8, stops: [
    ['Baker Street', [51.5226, -0.1571], 'hall'], ['Green Park', [51.5067, -0.1428]], ['Westminster', [51.5010, -0.1254]],
    ['Waterloo', 'waterloo'], ['London Bridge', [51.5052, -0.0864], 'hall'], ['Canada Water', [51.4982, -0.0502]],
    ['Canary Wharf', [51.5036, -0.0187], 'hall'], ['North Greenwich', [51.5005, 0.0039]], ['West Ham', [51.5285, 0.0056]],
    ['Stratford', 'stratford', 'hall'],
  ] },
];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
/** The rectangle round some tiles, `pad` tiles bigger each way. */
const bboxOf = (pts: readonly DemoXY[], pad: number): DemoRect => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return [x0, y0, Math.max(...xs) + pad - x0 + 1, Math.max(...ys) + pad - y0 + 1];
};

type AreaSpec = readonly [id: string, name: string, lat: number, lon: number, kind: string, blurb: string];
const AREAS: AreaSpec[] = [
  ['area-westminster', 'Westminster', 51.4995, -0.1300, 'office',
    'Government and the civic heart: offices round Whitehall, New Scotland Yard, the Thames bending north past Parliament to Westminster Bridge.'],
  ['area-west-end', 'The West End', 51.5120, -0.1330, 'commercial',
    "Shops, theatres and cinemas from Oxford Street to Covent Garden: department stores on merged lots, the theatres of Shaftesbury Avenue and the opera house, on the finest grain of streets in town. People come here for nights out from all over town."],
  ['area-city', 'The City of London', 51.5145, -0.0900, 'office',
    'The Square Mile: small blocks between old streets, almost every one an office tower or a corporate headquarters on merged lots, up to the top level. Hundreds of thousands of jobs in the real one; here it is the biggest employer north of the river, so the morning commute pours in over London Bridge and from Liverpool Street.'],
  ['area-south-bank', 'South Bank and Southwark', 51.5040, -0.1000, 'commercial',
    'Across the river from the City: the arts along the bank, offices and homes behind. Blackfriars, Southwark, London and Tower Bridge cross here.'],
  ['area-canary-wharf', 'Canary Wharf', 51.5045, -0.0200, 'office',
    "The second City, on the Isle of Dogs between the West India Docks: towers and headquarters inside the river's loop. The Thames runs south round the isle, east past Greenwich and north again round the O2."],
  ['area-isle-of-dogs', 'Isle of Dogs', 51.4910, -0.0140, 'residential',
    'Homes in the south of the loop, below the docks. Every road out leads north: the river is on three sides.'],
  ['area-greenwich', 'Greenwich', 51.4790, -0.0050, 'residential',
    'Homes round Greenwich Park on the south bank of the loop, the museum by the river, Blackheath above.'],
  ['area-royal-docks', 'Royal Docks', 51.5070, 0.0450, 'industrial',
    'Industry round the Royal Victoria and Royal Albert Docks: works, depots and the deliveries they send to shops all over the east.'],
  ['area-thames-gateway', 'Thames Gateway', 51.5280, 0.1450, 'industrial',
    'Dagenham and the Thames Gateway: heavy plant and factory complexes on big blocks where the river widens into the estuary, with a freight yard sending containers by train to Barking.'],
  ['area-kensington', 'Kensington and Chelsea', 51.4990, -0.1900, 'residential',
    'Dense homes and mid-rise mansion blocks south of Hyde Park, the museums of South Kensington, Chelsea down to the river.'],
  ['area-camden', 'Camden', 51.5390, -0.1430, 'residential',
    "Homes and the market north of Regent's Park. The King's Cross line runs between Camden and Islington, and the main roads cross it on level crossings: watch the barriers come down and the traffic queue as a train goes through."],
  ['area-islington', 'Islington', 51.5380, -0.1000, 'residential',
    "Terraces and high streets east of the King's Cross line, along Upper Street and the Holloway Road."],
  ['area-hackney', 'Hackney', 51.5450, -0.0550, 'residential',
    'Homes with gardens behind them, high streets, Victoria Park, and the Lea valley industry to the east.'],
  ['area-brixton', 'Brixton', 51.4620, -0.1150, 'residential',
    'South London: long terraces and the high street at the end of the 159 from Oxford Circus over Westminster Bridge.'],
  ['area-clapham', 'Clapham and Battersea', 51.4640, -0.1500, 'residential',
    'Homes either side of Clapham Common and Battersea Park, with Clapham Junction on the line from Waterloo.'],
  ['area-hammersmith', 'Hammersmith and Fulham', 51.4900, -0.2200, 'residential',
    'West London where the Thames loops round Barnes: homes on both banks, Hammersmith and Putney bridges.'],
];

/** Offsets within nine tiles, nearest first, with their length. */
const NEAR: [number, number, number][] = [];
for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) NEAR.push([dx, dy, Math.hypot(dx, dy)]);
NEAR.sort((a, b) => a[2] - b[2]);

// ---------------------------------------------------------------- the roads (R3–R5)

/** The schools whose streets are 20 zones (docs/demo.md "London", "Roads"): the boroughs with the schools. */
const ZONE20_SCHOOLS = ['primary-islington', 'secondary-islington', 'primary-hackney', 'secondary-hackney', 'primary-camden', 'primary-brixton', 'secondary-brixton', 'primary-clapham'];
/** How far from a school's footprint its side streets are a 20 zone (tiles, either way). */
const ZONE20_REACH = 6;
/** Share of the suburban and outer crossroads of side streets that are mini-roundabouts, by hash (the organic rule). */
const MINI_SHARE = 1 / 12;
/** The pedestrian streets: the plan's side streets nearest each place (London's West End keeps none of its own at this scale). */
const PEDESTRIAN: { id: string; name: string; at: readonly [lat: number, lon: number]; reach: number; runs: number }[] = [
  // the shopping street between Park Lane and Piccadilly, a few tiles west of Regent Street: the side street nearest
  // the real Carnaby Street (the Circus fills the block east of Regent Street)
  { id: 'carnaby-street', name: 'Carnaby Street', at: [51.5133, -0.1389], reach: 6, runs: 1 },
  // no side street is left near the Covent Garden piazza (the Opera House faces Oxford Street at this scale): the
  // nearest are the two by the Barbican, which is a pedestrian estate in the real city
  { id: 'barbican-walks', name: 'The Barbican', at: [51.5200, -0.0938], reach: 5, runs: 2 },
];

/** Is (px, py) inside the polygon (ray casting)? */
function inPolygon(pts: readonly (readonly [number, number])[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The Roads section: London on R3–R5's roads, everything laid as the tools lay it (seed.ts: classRoads through planRoad,
 * junctions through the junction planners, street rules as the Street rules tool sets them). Each arterial run the plan
 * has room for is an avenue (`plan.avenues`, its twin row already road in the plan), the M4 and the A13 come in as
 * motorways from connections at the map's edge with a diamond interchange each, Hyde Park Corner, Marble Arch,
 * Elephant and Castle and Old Street are 5×5 roundabouts, and the street rules follow the brief: bus lanes on Oxford
 * Street and the Euston Road, 20 zones round the borough schools, double yellows in the City, turn bans at Oxford and
 * Piccadilly Circus.
 */
function londonRoadsSection(plan: LondonPlan, byId: Map<string, DemoPlacement>): { section: DemoSection; problems: string[]; /** road tiles a bus stop may not face: pedestrian and one-way */ noBus: Set<number> } {
  const problems: string[] = [];
  const tileOf = (i: number): DemoXY => [MX + (i % MW), MY + Math.floor(i / MW)];
  const road = (x: number, y: number) => inLondon(x, y) && plan.t[lidx(x, y)] === LT.Road;
  const street = (x: number, y: number) => road(x, y) && !plan.cls[lidx(x, y)];
  const side = (x: number, y: number) => street(x, y) && !plan.main[lidx(x, y)];
  /** straight runs of the tiles in `set` (each along x, then along y; a tile alone is a run of one), in tile order */
  const runsOf = (set: Set<number>): [DemoXY, DemoXY][] => {
    const has = (x: number, y: number) => inLondon(x, y) && set.has(lidx(x, y));
    const out: [DemoXY, DemoXY][] = [];
    /** tiles a run already covers: a run along y whose every tile lies on runs along x adds nothing */
    const covered = new Set<number>();
    for (const i of [...set].sort((a, b) => a - b)) {
      const [x, y] = tileOf(i);
      const ew = has(x - 1, y) || has(x + 1, y), ns = has(x, y - 1) || has(x, y + 1);
      if (!ew && !ns) { out.push([[x, y], [x, y]]); continue; }
      for (const [dx, dy, on] of [[1, 0, ew], [0, 1, ns]] as const) {
        if (!on || has(x - dx, y - dy)) continue;
        let n = 0;
        while (has(x + dx * (n + 1), y + dy * (n + 1))) n++;
        const tiles = Array.from({ length: n + 1 }, (_, k) => lidx(x + dx * k, y + dy * k));
        if (tiles.every((t) => covered.has(t))) continue;
        for (const t of tiles) covered.add(t);
        out.push([[x, y], [x + dx * n, y + dy * n]]);
      }
    }
    return out;
  };
  const bbox = (pts: readonly DemoXY[], pad: number): DemoRect => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    return [x0, y0, Math.max(...xs) + pad - x0 + 1, Math.max(...ys) + pad - y0 + 1];
  };
  const arterial = (prefix: string) => arterialPaths()[ARTERIALS.findIndex((a) => a.name.startsWith(prefix))] ?? [];

  // ---- the motorways and their connections
  const placements: DemoPlacement[] = plan.motorways.map((m) => ({ id: `${m.spec.id}-connection`, kind: 'motorway', door: m.spec.door, rot: m.spec.rot }));
  const classRoads: DemoClassRoad[] = plan.motorways.map((m) => ({ cls: 4, from: m.path[0], to: m.path[m.path.length - 1], path: m.path }));
  // ---- the avenues
  for (const a of plan.avenues) classRoads.push({ cls: 3, from: a.path[0], to: a.path[a.path.length - 1], path: a.path });
  // ---- Regent Street, one way south from Oxford Circus to Piccadilly Circus (its two tiles between the avenues)
  const regent = arterial('Regent Street').filter(([x, y]) => inLondon(x, y));
  const regentTop = regent[0], regentFoot = regent[regent.length - 1];
  const regentOk = regent.length >= 4 && street(regentTop[0], regentTop[1] + 1) && street(regentFoot[0], regentFoot[1] - 1);
  if (regentOk) classRoads.push({ cls: 2, from: [regentTop[0], regentTop[1] + 1], to: [regentFoot[0], regentFoot[1] - 1] });
  else problems.push('Regent Street: not a street between Oxford Street and Piccadilly');

  // ---- pedestrian streets: the side streets nearest each place, with a signal crossing where one meets a street mid-block
  const ped = new Set<number>(), pedestrian: { id: string; name: string; tiles: DemoXY[] }[] = [];
  for (const p of PEDESTRIAN) {
    const [px, py] = geoF(p.at[0], p.at[1]);
    const near = new Set<number>();
    for (let y = Math.floor(py) - p.reach; y <= Math.floor(py) + p.reach; y++) for (let x = Math.floor(px) - p.reach; x <= Math.floor(px) + p.reach; x++) if (side(x, y)) near.add(lidx(x, y));
    // whole runs of side street (not cut at the reach), nearest first
    const whole = runsOf(near).map(([a, b]) => {
      const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      let [x0, y0] = a, [x1, y1] = b;
      if (dx || dy) { while (side(x0 - dx, y0 - dy)) { x0 -= dx; y0 -= dy; } while (side(x1 + dx, y1 + dy)) { x1 += dx; y1 += dy; } }
      const tiles: DemoXY[] = [];
      for (let k = 0, x = x0, y = y0; k < 64; k++, x += dx, y += dy) { tiles.push([x, y]); if (x === x1 && y === y1) break; }
      return { tiles, d: Math.min(...tiles.map(([x, y]) => Math.hypot(x + 0.5 - px, y + 0.5 - py))) };
    }).filter((r) => r.tiles.length >= 2).sort((a, b) => a.d - b.d || a.tiles[0][1] - b.tiles[0][1] || a.tiles[0][0] - b.tiles[0][0]);
    const chosen = whole.slice(0, p.runs);
    if (!chosen.length) { problems.push(`${p.name}: no side street near it`); continue; }
    const tiles = chosen.flatMap((r) => r.tiles);
    for (const [x, y] of tiles) ped.add(lidx(x, y));
    pedestrian.push({ id: p.id, name: p.name, tiles });
    for (const r of chosen) classRoads.push({ cls: 5, from: r.tiles[0], to: r.tiles[r.tiles.length - 1] });
  }
  /** a car street tile that is a plain straight stretch, a tile or more from any junction (junctions.ts pelicanProblem, on the plan) */
  const carLinks = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => road(x + dx, y + dy) && !ped.has(lidx(x + dx, y + dy)));
  const pelicans: DemoXY[] = [];
  for (const p of pedestrian) for (const [x, y] of p.tiles) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cx = x + dx, cy = y + dy;
    if (!street(cx, cy) || ped.has(lidx(cx, cy)) || plan.main[lidx(cx, cy)]) continue;
    const links = carLinks(cx, cy);
    if (links.length !== 2 || links[0][0] !== -links[1][0] || links[0][1] !== -links[1][1]) continue;
    if (links.some(([lx, ly]) => !street(cx + lx, cy + ly) || carLinks(cx + lx, cy + ly).length >= 3)) continue;
    if (!pelicans.some(([qx, qy]) => qx === cx && qy === cy)) pelicans.push([cx, cy]);
  }

  // ---- junctions: the roundabouts, the interchanges, mini-roundabouts on suburban crossroads, turn bans, pelicans
  const ROUNDABOUT_WORDS: Record<string, string> = {
    'hyde-park-corner': 'Hyde Park Corner: Park Lane comes down the east side of Hyde Park and goes on to Victoria as Grosvenor Place, Piccadilly comes in from the east and leaves west as Knightsbridge, and every one of them is an avenue meeting at a 5×5 two-lane roundabout. Cars going past the second exit take the inner lane and move out before they leave; the rest keep to the outer. A car coming on gives way to traffic already going round, and the ring never fills, so it never locks.',
    'marble-arch': 'Marble Arch, at the north-east corner of Hyde Park: Oxford Street and the Bayswater Road meet Park Lane and the Edgware Road at a two-lane roundabout, the busiest of the West End\'s. Bus line 25 turns here.',
    'elephant-and-castle': 'Elephant and Castle, south of the river: the Walworth Road runs through from Borough High Street, Kennington Park Road leaves to the west and the Old Kent Road to the east, round a two-lane roundabout just south of the line out of Waterloo.',
    'old-street': 'Old Street, where Shoreditch High Street meets it: a two-lane roundabout on the City\'s northern edge. (The real roundabout is a few hundred metres west, where City Road comes in; here City Road turns into Old Street at a corner, which no roundabout can take.)',
  };
  const junctions: DemoJunction[] = plan.roundabouts.map((r) => ({
    id: r.id, tool: 'roundabout', at: r.group, big: true, name: r.name, blurb: ROUNDABOUT_WORDS[r.id],
    rect: [r.box[0] - 2, r.box[1] - 2, 9, 9], inspect: [r.box[0] + 2, r.box[1]],
  }));
  const INTERCHANGE_WORDS: Record<string, string> = {
    m4: 'The M4 comes in from the west past the end of Heathrow\'s runway: a motorway from its own connection at the edge of the map, two carriageways and no frontage. Hayes Road crosses it on a bridge, and slip roads leave each carriageway before the bridge and join after it, meeting the street where they give way. Further on the motorway turns north through the gap between the airfield and the river at Brentford and runs on into the Great West Road, an avenue to Chiswick.',
    a13: 'The A13 comes in from the Thames Gateway as a motorway, from its own connection at the east edge of the map, and runs on into Barking Road as an avenue at Dagenham Docks. Goresbrook Road crosses it at a diamond interchange: a bridge over both carriageways, slip roads off before it and on after it, giving way at the street.',
  };
  for (const m of plan.motorways) {
    const [bx, by, bw, bh] = m.box;
    junctions.push({ id: `${m.spec.id}-interchange`, tool: 'interchange', at: m.spec.interchange, name: `The ${m.spec.name}: ${m.spec.street}`, blurb: INTERCHANGE_WORDS[m.spec.id], rect: [bx - 3, by - 1, bw + 6, bh + 2], inspect: m.spec.interchange });
  }
  // mini-roundabouts: crossroads of side streets in the suburbs and outer ring, about one in twelve by hash, a few tiles apart
  const minis: DemoXY[] = [];
  for (let i = 0; i < MW * MH; i++) {
    const [x, y] = tileOf(i);
    if (!street(x, y) || ped.has(i) || hash2(x * 13 + 5, y * 7 + 11) >= MINI_SHARE) continue;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => street(x + dx, y + dy) && !ped.has(lidx(x + dx, y + dy)))) continue;
    const c = placeAt(x + 0.5, y + 0.5).c;
    if (c !== 'suburb' && c !== 'outer') continue;
    if (minis.some(([mx, my]) => Math.abs(mx - x) + Math.abs(my - y) < 4)) continue;
    minis.push([x, y]);
  }
  minis.forEach((at, n) => junctions.push({ id: `mini-${n + 1}`, tool: 'miniroundabout', at }));
  // turn bans where Regent Street (one way south) meets Oxford Street and Piccadilly, and at Tottenham Court Road
  const charing = arterial('Charing Cross Road');
  if (regentOk) {
    junctions.push({ id: 'turn-oxford-circus', tool: 'turnrule', at: [regentTop[0] + 1, regentTop[1] - 1], rule: 'noLeft', name: 'Oxford Circus: no left turn',
      blurb: 'Regent Street runs one way south from Oxford Circus to Piccadilly Circus. Oxford Street\'s westbound traffic may not turn left into it here (the sign stands on the arm), so it does not have to cross the eastbound carriageway in the lights\' short gap; the routers send it round.', rect: [regentTop[0] - 4, regentTop[1] - 4, 9, 8], inspect: [regentTop[0] + 1, regentTop[1] - 1] });
    junctions.push({ id: 'turn-piccadilly-circus', tool: 'turnrule', at: [regentFoot[0], regentFoot[1] - 1], rule: 'noLeft' });
  }
  // Tottenham Court Road's two carriageways where they cross Oxford Street's row
  const tcr = charing.filter(([, y]) => y === regentTop[1]).flatMap(([x, y]) => { const tw = plan.twin[lidx(x, y)]; return tw >= 0 ? [x, tileOf(tw)[0]] : [x]; });
  if (tcr.length) junctions.push({ id: 'turn-tottenham-court-road', tool: 'turnrule', at: [Math.min(...tcr) - 1, regentTop[1]], rule: 'noRight' });
  pelicans.forEach((at, n) => junctions.push({ id: `pelican-${n + 1}`, tool: 'pelican', at }));

  // ---- street rules
  const streetRules: DemoStreetRule[] = [];
  const rule = (id: string, r: DemoStreetRule['rule'], name: string, a: DemoXY, b: DemoXY, extra: Partial<DemoStreetRule> = {}) =>
    streetRules.push({ id, rule: r, name, at: a, to: b, rect: bbox([a, b], 2), inspect: a, ...extra });
  // bus lanes on both carriageways of Oxford Street, Marble Arch to Tottenham Court Road, and of the Euston Road
  const ma = plan.roundabouts.find((r) => r.id === 'marble-arch');
  if (ma && tcr.length) {
    const x0 = ma.box[0] + 6, x1 = Math.min(...tcr) - 1, [, gy] = ma.group;
    rule('bus-oxford-street', 'bus', 'Oxford Street\'s bus lanes', [x0, gy + 1], [x1, gy + 1], {
      rect: [x0 - 3, gy - 3, x1 - x0 + 8, 7], inspect: [Math.min(...tcr), gy],
      blurb: 'Oxford Street is an avenue, two lanes each way either side of a planted reservation, and both kerb lanes from Marble Arch to Tottenham Court Road are bus lanes: red, BUS LANE every few tiles. Bus line 25 runs east along one and back along the other, passing the queues. At Tottenham Court Road another avenue crosses: the four tiles work as one junction with one set of lights, and the left turns have a phase of their own (protected lefts), so nobody turns across oncoming traffic.',
    });
    rule('bus-oxford-street-west', 'bus', 'Oxford Street\'s bus lanes (westbound)', [x1, gy], [x0, gy]);
  } else problems.push('Oxford Street: no Marble Arch or Tottenham Court Road for its bus lanes');
  const euston = arterial('Marylebone Road');
  const eustonRow = euston.length ? euston[0][1] : 0, eustonXs = euston.filter(([, y]) => y === eustonRow).map(([x]) => x);
  if (eustonXs.length > 4) {
    const x0 = Math.min(...eustonXs), x1 = Math.max(...eustonXs), tw = plan.twin[lidx(x0 + 1, eustonRow)], twRow = tw >= 0 ? tileOf(tw)[1] : eustonRow - 1;
    rule('bus-euston-road', 'bus', 'The Euston Road\'s bus lanes', [x0, eustonRow], [x1, eustonRow]);
    rule('bus-euston-road-west', 'bus', 'The Euston Road\'s bus lanes (westbound)', [x1, twRow], [x0, twRow]);
  }
  // 20 zones on the side streets round the borough schools
  const zone = new Set<number>();
  for (const id of ZONE20_SCHOOLS) {
    const p = byId.get(id);
    if (!p) { problems.push(`20 zone: no ${id}`); continue; }
    const q = placedFromDoor(K[p.kind], p.door[0], p.door[1], p.rot ?? 0);
    for (let y = q.ay - ZONE20_REACH; y < q.ay + q.h + ZONE20_REACH; y++) for (let x = q.ax - ZONE20_REACH; x < q.ax + q.w + ZONE20_REACH; x++) {
      if (!side(x, y) || ped.has(lidx(x, y))) continue;
      const c = placeAt(x + 0.5, y + 0.5).c;
      if (c === 'inner' || c === 'outer' || c === 'suburb') zone.add(lidx(x, y));
    }
  }
  const islington = byId.get('primary-islington');
  let shown = false;
  runsOf(zone).forEach(([a, b], n) => {
    // the stop: the first run near the Islington primary school long enough for a hump
    const show = !shown && !!islington && Math.abs(a[0] - islington.door[0]) + Math.abs(a[1] - islington.door[1]) <= 10 && Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) >= 4;
    if (show) shown = true;
    rule(show ? 'zone20-islington' : `zone20-${n + 1}`, 'zone20', show ? 'A 20 zone in Islington' : '20 zone', a, b, show ? {
      blurb: 'The side streets round the schools of Islington, Hackney, Camden, Brixton and Clapham are 20 zones: the roundel at each way in, painted on the road too, and speed humps every four to six tiles (where each run\'s hash puts them) slow every vehicle to 60%. Routes avoid them where there is another way, so the school run walks along quiet streets; the main roads round them carry the through traffic.',
    } : {});
  });
  if (!shown) problems.push('20 zone: no run near the Islington primary school to show');
  // double yellows on every street of the City of London (the borough's outline)
  const cityPoly = BOROUGHS.find((b) => b.id === 'city')!.polys[0].map(([lat, lon]) => geoF(lat, lon));
  const { bank } = londonBase();
  const yellow = new Set<number>();
  for (let i = 0; i < MW * MH; i++) { const [x, y] = tileOf(i); if (road(x, y) && plan.cls[i] !== 4 && !ped.has(i) && bank[i] === 1 && inPolygon(cityPoly, x + 0.5, y + 0.5)) yellow.add(i); }
  const cityArea = byId.get('gherkin');
  let yShown = false;
  runsOf(yellow).forEach(([a, b], n) => {
    const show = !yShown && Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) >= 3 && !!cityArea && Math.abs(a[0] - cityArea.door[0]) + Math.abs(a[1] - cityArea.door[1]) <= 8;
    if (show) yShown = true;
    rule(show ? 'yellow-city' : `yellow-${n + 1}`, 'yellow', show ? 'Double yellows in the City' : 'Double yellows', a, b, show ? {
      blurb: 'Every street in the City of London has double yellow lines: nobody parks at a kerb in the Square Mile, so no lane is lost to a parked car on the way into the offices. A driver who finds the car parks full parks on a street outside the City, or in a lot, and walks in.',
    } : {});
  });

  // ---- spots on the tour
  const spots: DemoSpot[] = [];
  for (const p of pedestrian) {
    const box = bbox(p.tiles, 3), mid = p.tiles[Math.floor(p.tiles.length / 2)];
    spots.push({ id: p.id, spot: 'road-pedestrian', name: p.name, rect: box, inspect: mid, hour: 13,
      blurb: p.id === 'carnaby-street'
        ? 'Carnaby Street, a pedestrian street of shops between Park Lane and Piccadilly: paving and bollards, walkers and bikes only, with emergency vehicles, and deliveries before 10:00 and after 19:00. Its shops see the most passers-by. (The real one is a few streets east, behind Regent Street; at this scale the Circus fills that block.)'
        : 'The Barbican\'s walks: the streets by the Barbican Centre are pedestrian, as the real estate is built on raised walkways with no traffic. Walkers and bikes only, deliveries before 10:00 and after 19:00. (Covent Garden\'s piazza has no street of its own at this scale: the Royal Opera House faces Oxford Street.)' });
  }
  if (ma) spots.push({ id: 'london-traffic', spot: 'traffic-panel', name: 'The Traffic panel over the West End', rect: [ma.box[0], ma.box[1] - 4, 18, 14], inspect: [ma.box[0] + 7, ma.box[1] + 3], view: 'traffic' });

  const noBus = new Set<number>(ped);
  if (regentOk) for (let y = regentTop[1] + 1; y < regentFoot[1]; y++) noBus.add(lidx(regentTop[0], y));
  return {
    problems, noBus,
    section: {
      id: 'london-roads', name: 'Roads',
      blurb: 'The main roads are avenues, two lanes each way round a planted reservation, with their crossings working as one junction and protected left turns where two avenues cross; the M4 and the A13 come in as motorways with a diamond interchange each; Hyde Park Corner, Marble Arch, Elephant and Castle and Old Street are two-lane roundabouts; Carnaby Street and the Barbican are pedestrian; Oxford Street and the Euston Road have bus lanes, the streets round the borough schools are 20 zones and the City has double yellows.',
      placements, classRoads, junctions, streetRules, spots,
    },
  };
}

export interface LondonScenario {
  sections: DemoSection[];
  plan: LondonPlan;
  problems: string[];
}

let BUILT: LondonScenario | null = null;
/** The London scenario: placements fitted, streets planned, stops and venues found (built once, on first use). */
export function londonScenario(): LondonScenario {
  if (BUILT) return BUILT;
  const { water, reserved, bank } = londonBase();
  /** the bank of the river a real place is on: its tile's, or the nearest dry tile's */
  const bankOf = (px: number, py: number) => {
    for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.floor(px) + dx, y = Math.floor(py) + dy;
      if (inLondon(x, y) && bank[lidx(x, y)]) return bank[lidx(x, y)];
    }
    return 0;
  };
  const problems: string[] = [];
  // 2 under a structure, 1 on its margin and along its front: the next one keeps a tile clear and off its frontage
  const taken = new Uint8Array(MW * MH);
  const claim = (p: Placed) => {
    for (let y = p.ay - 1; y <= p.ay + p.h; y++) for (let x = p.ax - 1; x <= p.ax + p.w; x++) {
      if (!inLondon(x, y)) continue;
      const inside = x >= p.ax && y >= p.ay && x < p.ax + p.w && y < p.ay + p.h;
      taken[lidx(x, y)] = Math.max(taken[lidx(x, y)], inside ? 2 : 1);
    }
  };
  const placedOf = (p: DemoPlacement) => placedFromDoor(K[p.kind], p.door[0], p.door[1], p.rot ?? 0);
  const keeps: Placed[] = [];
  for (const [id, s] of Object.entries(STATIONS)) { const p = placedOf({ id, kind: STATION_KIND[id as keyof typeof STATIONS], ...s }); keeps.push(p); claim(p); }
  { const p = placedOf(HEATHROW); keeps.push(p); claim(p); }
  for (const p of motorwayConnections()) { keeps.push(p); claim(p); }
  // the road classes' skeleton (londonMap.ts londonRoads): the avenues' twin rows, the motorways with their verges and
  // interchanges, the roundabouts' boxes; worked out round the fixed placements before any landmark is fitted
  const roads = londonRoads(keeps);
  /** 1 where no structure may face: beside an avenue's outer kerb (a road there would run alongside it), a roundabout's frame */
  const noFront = new Uint8Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) {
    const m = roads.mark[i];
    if (m === RM.Twin) taken[i] = Math.max(taken[i], 1);
    else if (m === RM.Clear || m === RM.Motorway) taken[i] = 2;
    else if (m === RM.NoFront || m === RM.Frame) noFront[i] = 1;
  }
  // the main roads and the bridges' landings and approaches stay road (a structure may face them)
  for (const path of arterialPaths()) for (const [x, y] of path) if (inLondon(x, y)) taken[lidx(x, y)] = Math.max(taken[lidx(x, y)], 1);
  for (const b of londonBridges()) for (const end of [-1, b.len]) for (let k = 0; k < 3; k++) {
    const s = end < 0 ? end - k : end + k, x = b.x + (b.ns ? 0 : s), y = b.y + (b.ns ? s : 0);
    if (inLondon(x, y)) taken[lidx(x, y)] = Math.max(taken[lidx(x, y)], 1);
  }
  /** a structure's footprint is dry, on its place's bank, off the railways and clear of the others; its front is dry land a road can take */
  const fits = (p: Placed, side: number) => {
    for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) {
      if (!inLondon(x, y)) return false;
      const i = lidx(x, y);
      if (water[i] || reserved[i] >= 0 || taken[i] || bank[i] !== side) return false;
    }
    const [fx, fy] = FRONT[p.r];
    for (let s = 0; s < (fx ? p.h : p.w); s++) {
      const x = fx ? (fx > 0 ? p.ax + p.w : p.ax - 1) : p.ax + s, y = fy ? (fy > 0 ? p.ay + p.h : p.ay - 1) : p.ay + s;
      if (!inLondon(x, y)) return false;
      const i = lidx(x, y);
      if (water[i] || reserved[i] >= 0 || taken[i] === 2 || noFront[i]) return false;
    }
    return true;
  };
  const structures: DemoPlacement[] = [];
  for (const [id, kind, lat, lon, side, onBank] of STRUCTURES) {
    const k = K[kind], [px, py] = geoF(lat, lon), side0 = onBank ? (onBank === 'N' ? 1 : 2) : bankOf(px, py);
    let best: Placed | null = null, bd = Infinity;
    // as near the real place as fits, facing the given side if it can (another side costs as much as two tiles)
    for (let r = 0; r < 4; r++) {
      const p0 = placedFromAnchor(k, 0, 0, r), cost = r === SIDES[side] ? 0 : 2;
      const ax0 = Math.round(px - p0.w / 2), ay0 = Math.round(py - p0.h / 2);
      for (const [dx, dy, n] of NEAR) {
        if (n - 1 + cost >= bd) break;
        const p = placedFromAnchor(k, ax0 + dx, ay0 + dy, r), d = Math.hypot(p.ax + p.w / 2 - px, p.ay + p.h / 2 - py) + cost;
        if (d < bd && fits(p, side0)) { bd = d; best = p; }
      }
    }
    if (!best) { problems.push(`${id}: no room near (${Math.round(px)}, ${Math.round(py)})`); continue; }
    claim(best);
    keeps.push(best);
    structures.push({ id, kind, door: [best.doorX, best.doorY], rot: best.r as 0 | 1 | 2 | 3, ...TOUR_VIEWS[id], ...STRUCTURE_EXTRA[id] });
  }

  // ---- the river's harbours and piers: the back rows over the water a tile clear of every bridge deck, the front on
  // the real one's bank facing a road, open water off the decks behind as deep as the kind's boats need and at least
  // three rows (so the river keeps a channel a river bus can pass); a pier's berth with open water beyond each end
  /** 2 on a bridge deck, 1 beside one */
  const deck = new Uint8Array(MW * MH), wetTaken = new Uint8Array(MW * MH);
  for (const b of londonBridges()) for (let k = 0; k < b.len; k++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const x = b.x + (b.ns ? 0 : k) + ox, y = b.y + (b.ns ? k : 0) + oy;
    if (inLondon(x, y)) deck[lidx(x, y)] = Math.max(deck[lidx(x, y)], ox || oy ? 1 : 2);
  }
  const openAt = (x: number, y: number) => inLondon(x, y) && !!water[lidx(x, y)] && deck[lidx(x, y)] < 2 && !wetTaken[lidx(x, y)];
  const wetAt = (x: number, y: number) => inLondon(x, y) && !!water[lidx(x, y)];
  const inDock = (x: number, y: number) => DOCKS.some(({ rect: [rx, ry, rw, rh] }) => x >= rx && y >= ry && x < rx + rw && y < ry + rh);
  /** a row of tiles with one more beyond each end */
  const alongRow = (row: [number, number][]): [number, number][] => {
    const [ax, ay] = row[0], [bx, by] = row[row.length - 1], dx = Math.sign(bx - ax), dy = Math.sign(by - ay);
    return [[ax - dx, ay - dy], ...row, [bx + dx, by + dy]];
  };
  /** the water a harbour stands in and keeps clear: its wet tiles, the rows behind it and a pier's berth ends */
  const harbourWater = (p: Placed): [number, number][] => {
    const spec = WET_OF[p.kind]!, out: [number, number][] = [];
    for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) if (isWetTile(p, x, y)) out.push([x, y]);
    for (let row = 0; row < Math.max(3, fairwayDepth(spec.fairwayClearance)); row++) out.push(...fairwayTiles(p, row));
    if (HARBOUR_OF[p.kind]?.role === 'pier') { const ends = alongRow(fairwayTiles(p, 0)); out.push(ends[0], ends[ends.length - 1]); }
    return out;
  };
  const fitsHarbour = (p: Placed, side: number) => {
    for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) {
      if (!inLondon(x, y)) return false;
      const i = lidx(x, y);
      if (isWetTile(p, x, y)) { if (deck[i]) return false; continue; }
      if (water[i] || reserved[i] >= 0 || taken[i] || bank[i] !== side) return false;
    }
    if (!harbourWater(p).every(([x, y]) => openAt(x, y))) return false;
    // on the river (not in a dock), the second row out and a tile beyond each end of it have water all round: the
    // river keeps a channel three tiles wide past the harbour (clearance 2, waterways.ts) for river buses and barges
    if (!fairwayTiles(p, 0).some(([x, y]) => inDock(x, y)) && !alongRow(fairwayTiles(p, 1)).every(([x, y]) => FRONT.every(([dx, dy]) => wetAt(x + dx, y + dy)))) return false;
    const [fx, fy] = FRONT[p.r];
    for (let s = 0; s < (fx ? p.h : p.w); s++) {
      const x = fx ? (fx > 0 ? p.ax + p.w : p.ax - 1) : p.ax + s, y = fy ? (fy > 0 ? p.ay + p.h : p.ay - 1) : p.ay + s;
      if (!inLondon(x, y)) return false;
      const i = lidx(x, y);
      if (water[i] || reserved[i] >= 0 || taken[i] === 2 || noFront[i]) return false;
    }
    return true;
  };
  /** the dry rows of a harbour: what the street plan keeps clear and fronts with a road (its wet rows are river) */
  const dryPart = (p: Placed): Placed => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) if (!isWetTile(p, x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { ...p, ax: x0, ay: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const harbours: DemoPlacement[] = [];
  for (const [id, kind, lat, lon, name] of [...PIERS, ...HARBOURS]) {
    const k = K[kind], [px, py] = geoF(lat, lon), side0 = bankOf(px, py);
    let best: Placed | null = null, bd = Infinity;
    // on the real one's bank, else the other
    for (const side of [side0, 3 - side0]) for (let r = 0; r < 4 && !(best && side !== side0); r++) {
      const p0 = placedFromAnchor(k, 0, 0, r), ax0 = Math.round(px - p0.w / 2), ay0 = Math.round(py - p0.h / 2);
      for (const [dx, dy, n] of NEAR) {
        if (n - 1 >= bd) break;
        const p = placedFromAnchor(k, ax0 + dx, ay0 + dy, r), d = Math.hypot(p.ax + p.w / 2 - px, p.ay + p.h / 2 - py);
        if (d < bd && fitsHarbour(p, side)) { bd = d; best = p; }
      }
    }
    if (!best) { problems.push(`${id}: no bank near (${Math.round(px)}, ${Math.round(py)}) with the water it needs`); continue; }
    const dry = dryPart(best);
    claim(dry);
    for (const [x, y] of harbourWater(best)) wetTaken[lidx(x, y)] = 1;
    keeps.push(dry);
    harbours.push({ id, kind, door: [best.doorX, best.doorY], rot: best.r as 0 | 1 | 2 | 3, name });
  }

  const plan = londonPlan(keeps, roads);
  problems.push(...plan.problems);
  // the roads (R3–R5): before the stops, which keep off the pedestrian and one-way streets
  const roadsSec = londonRoadsSection(plan, new Map(structures.map((p) => [p.id!, p])));
  problems.push(...roadsSec.problems);
  const used = new Set<number>();
  const roadAt = (x: number, y: number) => inLondon(x, y) && (plan.t[lidx(x, y)] === LT.Road || plan.t[lidx(x, y)] === LT.Crossing || plan.t[lidx(x, y)] === LT.Deck);
  /** frontage lots near (lat, lon), nearest first, that `ok` accepts */
  const nearLot = (lat: number, lon: number, ok: (x: number, y: number) => boolean, radius = 8): DemoXY | null => {
    const [px, py] = geoF(lat, lon);
    let best: DemoXY | null = null, bd = Infinity;
    for (let y = Math.floor(py) - radius; y <= Math.floor(py) + radius; y++) for (let x = Math.floor(px) - radius; x <= Math.floor(px) + radius; x++) {
      if (!inLondon(x, y) || plan.t[lidx(x, y)] !== LT.Land || plan.reach[lidx(x, y)] !== 1 || used.has(lidx(x, y)) || !ok(x, y)) continue;
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) used.add(lidx(best[0], best[1]));
    return best;
  };
  const venues: DemoPlacement[] = [];
  for (const [id, kind, lat, lon, side] of VENUES) {
    const [fx, fy] = FRONT[SIDES[side]];
    const door = nearLot(lat, lon, (x, y) => roadAt(x + fx, y + fy)) ?? nearLot(lat, lon, () => true);
    if (door) venues.push({ id, kind, door }); else problems.push(`${id}: no frontage lot near its place`);
  }
  /** the side a bus boards a stop from (server sim/transit.ts boardDir: the first road of south, east, west, north) */
  const BOARD = [0, 1, 3, 2];
  /** stops of the same route keep three tiles apart */
  let route: DemoXY[] = [];
  /**
   * `avenue`: the stop may stand beside an avenue's carriageway (a loop line calling on the kerb its buses come along);
   * a line that runs there and back keeps to two-way streets, or half its buses would turn in the road to call
   */
  const stopAt = ([id, , lat, lon, side]: Spot, loopLine: boolean): DemoPlacement => {
    // a plain stretch (no junction at the board tile) on a loop of the network (a bus carries on and comes back round
    // rather than turning in the road), preferably a main road, on `side`
    let avenue = loopLine;
    const plain = (x: number, y: number, want: number | null, main: boolean) => {
      if (route.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) < 3)) return false;
      const d = BOARD.find((r) => roadAt(x + FRONT[r][0], y + FRONT[r][1]));
      if (d === undefined || (want !== null && d !== want)) return false;
      const bx = x + FRONT[d][0], by = y + FRONT[d][1], b = lidx(bx, by);
      if (plan.t[b] !== LT.Road || !plan.loop[b] || (main && !plan.main[b]) || roadsSec.noBus.has(b)) return false;
      if (plan.cls[b] === 4 || (plan.cls[b] === 3 && !avenue)) return false;
      if (plan.cls[b] === 3) {
        // a plain carriageway tile (no junction tile, divJunction): it and its twin straight, no side road at either
        const tw = plan.twin[b];
        if (tw < 0) return false;
        const tx = MX + (tw % MW), ty = MY + Math.floor(tw / MW), [ax, ay] = tx === bx ? [1, 0] : [0, 1];
        return ([[bx, by, tw], [tx, ty, b]] as const).every(([cx, cy, other]) => FRONT.filter(([ox, oy]) => roadAt(cx + ox, cy + oy) && lidx(cx + ox, cy + oy) !== other).length === 2
          && [-1, 1].every((s) => roadAt(cx + ax * s, cy + ay * s) && plan.twin[lidx(cx + ax * s, cy + ay * s)] >= 0));
      }
      return FRONT.filter(([ox, oy]) => roadAt(bx + ox, by + oy)).length <= 2;
    };
    // a loop's stop keeps to its side (the kerb its buses come along); the others may take either side further out
    const find = () => nearLot(lat, lon, (x, y) => plain(x, y, SIDES[side], true), 4) ?? nearLot(lat, lon, (x, y) => plain(x, y, loopLine ? SIDES[side] : null, true), 6)
      ?? nearLot(lat, lon, (x, y) => plain(x, y, loopLine ? SIDES[side] : null, false));
    // a there-and-back line's stop goes beside an avenue only where no street is near
    let door = find();
    if (!door && !loopLine) { avenue = true; door = find(); }
    if (!door) problems.push(`${id}: no plain stretch of road near its place`);
    else route.push(door);
    return { id, kind: 'bus-stop', door: door ?? [0, 0] };
  };
  const [route25, route159, routeD3] = ([[ROUTE_25, true], [ROUTE_159, false], [ROUTE_D3, false]] as const).map(([r, avenue]) => { route = []; return r.map((s) => stopAt(s, avenue)); });

  // ---- the Underground: each entrance on a frontage lot as near its real place as fits (fitEntrance), the platform
  // along the line there (the way to its neighbours), clear of every other platform underneath
  /** platform tiles claimed, and the tiles just past each platform's ends (planPlatform: platforms never touch end to end) */
  const platformTiles = new Set<number>(), platformEnds = new Set<number>();
  /** entrances by station name: an interchange's second entrance stays within the change walk of the first */
  const entrances = new Map<string, DemoXY[]>();
  const walk = (a: DemoXY, b: DemoXY) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= TRANSIT.transferWalk;
  const lot = (x: number, y: number) => inLondon(x, y) && plan.t[lidx(x, y)] === LT.Land && !used.has(lidx(x, y));
  /**
   * The nearest door (spiralling out from `target`) for a kiosk or hall whose platform runs along x (`alongX`): on the
   * town's dry land beside a road (a frontage lot, off the railways and the landmarks; a hall's two lots with its door
   * facing the road), within the change walk of every tile in `near`, with room for the platform underneath.
   */
  const fitEntrance = (kind: 'metro-entrance' | 'metro-station', target: readonly [number, number], alongX: boolean, near: DemoXY[]): DemoPlacement | null => {
    const tx = Math.floor(target[0]), ty = Math.floor(target[1]);
    for (const [dx, dy] of NEAR) {
      const x = tx + dx, y = ty + dy;
      if (!near.every((p) => walk(p, [x, y])) || !lot(x, y) || plan.reach[lidx(x, y)] !== 1) continue;
      const span = platformSpan(K[kind], x, y, alongX);
      const under: number[] = [];
      for (let a = span.a0; a <= span.a1; a++) { const [px, py] = stopTile(span, a); if (!inLondon(px, py)) break; under.push(lidx(px, py)); }
      const ends = [span.a0 - 1, span.a1 + 1].map((a) => stopTile(span, a)).filter(([px, py]) => inLondon(px, py)).map(([px, py]) => lidx(px, py));
      if (under.length !== span.len || under.some((i) => platformTiles.has(i) || platformEnds.has(i)) || ends.some((i) => platformTiles.has(i))) continue;
      let rot: 0 | 1 | 2 | 3 = alongX ? 0 : 1;
      if (kind === 'metro-station') {
        const r = ([alongX ? 0 : 1, alongX ? 2 : 3] as const).find((q) => {
          const p = placedFromDoor(K[kind], x, y, q), [fx, fy] = FRONT[q];
          for (let py = p.ay; py < p.ay + p.h; py++) for (let px = p.ax; px < p.ax + p.w; px++) if (!lot(px, py)) return false;
          return inLondon(x + fx, y + fy) && plan.t[lidx(x + fx, y + fy)] === LT.Road;
        });
        if (r === undefined) continue;
        rot = r;
        const p = placedFromDoor(K[kind], x, y, rot);
        for (let py = p.ay; py < p.ay + p.h; py++) for (let px = p.ax; px < p.ax + p.w; px++) used.add(lidx(px, py));
      }
      used.add(lidx(x, y));
      for (const i of under) platformTiles.add(i);
      for (const i of ends) platformEnds.add(i);
      return { kind, door: [x, y], rot };
    }
    return null;
  };
  const tubeStations: DemoPlacement[] = [];
  const tubeLines = TUBE.map((line) => {
    const targets = line.stops.map(([, where]): [number, number] => (typeof where === 'string' ? [STATIONS[where].door[0], STATIONS[where].door[1]] : geoF(where[0], where[1])));
    const doors = line.stops.map(([name, where, hall], i): DemoXY => {
      // the platform runs the way the line goes here: from the station before to the one after
      const [ax, ay] = targets[Math.max(0, i - 1)], [bx, by] = targets[Math.min(targets.length - 1, i + 1)];
      const alongX = Math.abs(bx - ax) >= Math.abs(by - ay);
      const near = [...(entrances.get(name) ?? []), ...(typeof where === 'string' ? [STATIONS[where].door] : [])];
      const id = `tube-${line.id}-${slug(name)}`;
      // a hall where one fits, else a kiosk; the platform across the line only where neither fits along it (a cramped interchange)
      const p = [alongX, !alongX].reduce<DemoPlacement | null>((got, ax) => got ?? ((hall && fitEntrance('metro-station', targets[i], ax, near)) || fitEntrance('metro-entrance', targets[i], ax, near)), null);
      if (!p) { problems.push(`${id}: no frontage lot near (${Math.round(targets[i][0])}, ${Math.round(targets[i][1])}) with room for the platform`); return [0, 0]; }
      tubeStations.push({ ...p, id, name });
      entrances.set(name, [...(entrances.get(name) ?? []), p.door]);
      return p.door;
    });
    return { id: `line-tube-${line.id}`, mode: 'metro' as const, number: line.number, name: line.name, colour: line.colour, loop: false, vehicles: line.trains, stops: doors };
  });
  // where the Northern and the Jubilee lines meet at Waterloo, under the underground view
  const waterlooTube = [STATIONS.waterloo.door, ...(entrances.get('Waterloo') ?? [])];
  const tubeSpot = bboxOf(waterlooTube, 3);
  /** a named area on the tour: the 15×15 tiles round a real place, inspected at the frontage lot nearest it */
  const areas: DemoBlock[] = AREAS.map(([id, name, lat, lon, kind, blurb]) => {
    const [px, py] = geoF(lat, lon);
    const inspect = nearLot(lat, lon, () => true) ?? [Math.round(px), Math.round(py)];
    used.delete(lidx(inspect[0], inspect[1]));
    return { id, kind, name, blurb, rect: [Math.round(px) - 7, Math.round(py) - 7, 15, 15] as DemoRect, inspect };
  });
  const tower = plan.bridges.find((b) => b.name === 'Tower Bridge');
  if (!tower) problems.push('Tower Bridge: not bridged');
  const towerFrom: DemoXY = tower ? [tower.x, tower.y] : [0, 0];
  const towerTo: DemoXY = tower ? [tower.x + (tower.ns ? 0 : tower.len - 1), tower.y + (tower.ns ? tower.len - 1 : 0)] : [0, 0];
  const byId = new Map(structures.map((p) => [p.id, p]));
  const harbourById = new Map(harbours.map((p) => [p.id, p]));
  const piers = PIERS.map(([id]) => harbourById.get(id)).filter((p): p is DemoPlacement => !!p);
  // the Pool of London: the reach between London Bridge and Tower Bridge, where St Katharine's tall boats come up
  const london = plan.bridges.find((b) => b.name === 'London Bridge');
  const pool: DemoRect = tower && london ? [london.x, Math.min(london.y, tower.y) - 1, tower.x - london.x + 1, Math.max(london.len, tower.len) + 2] : [0, 0, 1, 1];
  const pick = (...ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is DemoPlacement => !!p);

  const sections: DemoSection[] = [
    {
      id: 'london-areas', name: 'Areas',
      blurb: 'The City, Canary Wharf, the West End, Westminster and the rings of homes and industry round them, zoned as London roughly is, each borough its own owner.',
      blocks: areas,
    },
    {
      id: 'london-landmarks', name: 'Landmarks',
      blurb: 'The Gherkin, the Shard, the Walkie Talkie, One Canada Square, the Royal Opera House, Piccadilly Circus and its Lights, Big Ben and the Houses of Parliament, the London Eye, Buckingham Palace, the Tower and Tower Bridge, UCL, King\'s College, LSE and Imperial College as universities, and the hospitals, museums, theatres, parks, stadiums, the arena, the great cemeteries and Golders Green Crematorium that the real ones stand for.',
      placements: [
        ...pick('new-scotland-yard', 'st-thomas', 'royal-london', 'lambeth-fire', 'british-museum', 'natural-history-museum', 'maritime-museum', 'british-library',
          'royal-opera-house', 'piccadilly-circus', 'gherkin', 'walkie-talkie', 'shard', 'one-canada-square', 'parliament', 'london-eye', 'buckingham-palace', 'tower-of-london',
          'ucl', 'kings', 'lse', 'imperial'),
        ...venues,
        ...pick('leicester-square', 'serpentine', 'regents-park-lake', 'kew-gardens', 'wembley', 'london-stadium', 'copper-box', 'o2-arena'),
        // the cemeteries and the crematorium (docs/remembrance.md), their plots seeded with London's long dead
        ...pick('highgate-cemetery', 'kensal-green-cemetery', 'brompton-cemetery', 'golders-green-crematorium'),
      ],
      // the street plan bridges every named crossing (londonMap.ts); Tower Bridge is the landmark among them
      bridges: [{ id: 'tower-bridge', name: 'Tower Bridge', from: towerFrom, to: towerTo, style: 'Bascule', landmark: 'tower-bridge' }],
    },
    {
      id: 'london-education', name: 'Schools',
      blurb: 'Primary and secondary schools among the homes of Islington, Hackney, Camden, Brixton, Clapham, Kensington and Hammersmith: families live round them, so on a school day the children walk to class. The four universities in the Landmarks section take the sixth-form leavers.',
      placements: pick(...STRUCTURES.filter(([, kind]) => kind === 'primary-school' || kind === 'secondary-school').map(([id]) => id)),
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
        HEATHROW,
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
      blurb: 'The 25 along Oxford Street to Whitechapel, the 159 over Westminster Bridge to Brixton and the D3 on a loop round the Isle of Dogs, from three garages.',
      placements: [...pick('victoria-garage', 'stockwell-garage', 'poplar-garage'), ...route25, ...route159, ...routeD3],
      lines: [
        { id: 'line-bus-25', mode: 'bus', number: 25, colour: 0xd32f2f, loop: true, vehicles: 6, stops: route25.map((p) => p.door) },
        { id: 'line-bus-159', mode: 'bus', number: 159, colour: 0xc62828, loop: false, vehicles: 5, stops: route159.map((p) => p.door) },
        { id: 'line-bus-d3', mode: 'bus', number: 3, colour: 0xb71c1c, loop: true, vehicles: 2, stops: routeD3.map((p) => p.door) },
      ],
    },
    {
      id: 'london-river', name: 'The Thames',
      blurb: 'River bus RB1 from Westminster to Greenwich under every bridge, St Katharine Docks\' yachts and sailing barges up into the Pool of London through Tower Bridge\'s lifts, a jetty at Putney, and down river of every bridge Dagenham\'s container port and a fish quay, with ships from the estuary and barges up the river to Teddington.',
      placements: harbours,
      // there and back down the river under every bridge, changing with the Jubilee line at Canary Wharf and the
      // buses at Embankment and Tower (the 25) and Greenwich (the D3 from Island Gardens, across the river)
      lines: piers.length > 1 ? [{ id: 'line-ferry-rb1', mode: 'ferry', number: 1, name: 'RB1', colour: 0x1d3e8a, loop: false, vehicles: 5, stops: piers.map((p) => p.door) }] : [],
      seaGates: londonSeaGates(),
      spots: [{ id: 'pool-of-london', spot: 'pool-of-london', name: 'The Pool of London', rect: pool, inspect: harbourById.get('st-katharine')?.door }],
    },
    roadsSec.section,
    {
      id: 'london-tube', name: 'The Underground',
      blurb: 'The Central line from Shepherd\'s Bush under Oxford Street and the City to Stratford, the Northern from Camden Town under the river to Balham, and the Jubilee from Baker Street by Westminster, Waterloo and Canary Wharf to Stratford: their tunnels cross at right angles, under the Thames and every street, and they change with each other, the rail termini and the buses.',
      placements: tubeStations,
      lines: tubeLines,
      spots: [{ id: 'tube-crossover', spot: 'tube-crossover', name: 'Under Waterloo', rect: tubeSpot, view: 'under', inspect: entrances.get('Waterloo')?.[0] }],
    },
  ];
  return (BUILT = { sections, plan, problems });
}

/** Tour order: west to east along the river, then the rings round it. */
export const LONDON_TOUR: string[] = [
  'welcome',
  'area-westminster', 'parliament', 'london-eye', 'pier-embankment', 'line-ferry-rb1', 'pier-millbank', 'buckingham-palace', 'new-scotland-yard', 'st-thomas', 'lambeth-fire',
  'area-west-end', 'piccadilly-circus', 'carnaby-street', 'bus-oxford-street', 'turn-oxford-circus', 'marble-arch', 'hyde-park-corner', 'london-traffic',
  'royal-opera-house', 'palladium', 'lyceum', 'donmar', 'kings', 'lse', 'leicester-square', 'line-bus-25', 'line-bus-159',
  'tube-central-tottenham-court-road', 'line-tube-central', 'line-tube-northern',
  'area-city', 'yellow-city', 'gherkin', 'walkie-talkie', 'tower-of-london', 'tower-bridge', 'pool-of-london', 'st-katharine', 'pier-tower', 'barbican', 'barbican-walks', 'old-street', 'liverpool-street', 'track-great-eastern', 'line-great-eastern', 'stratford', 'london-stadium', 'copper-box',
  'area-south-bank', 'shard', 'elephant-and-castle', 'waterloo', 'tube-crossover', 'line-tube-jubilee', 'line-south-western', 'clapham-junction', 'area-clapham', 'primary-clapham', 'chelsea-jetty', 'victoria-garage', 'stockwell-garage', 'area-brixton', 'primary-brixton', 'secondary-brixton',
  'area-canary-wharf', 'one-canada-square', 'tube-jubilee-canary-wharf', 'pier-canary-wharf', 'area-isle-of-dogs', 'line-bus-d3', 'poplar-garage', 'area-greenwich', 'pier-greenwich', 'maritime-museum', 'o2-arena',
  'area-royal-docks', 'area-thames-gateway', 'a13-interchange', 'london-port', 'thamesmead-quay', 'dagenham-yard', 'track-freight', 'barking-yard', 'line-freight',
  'royal-london', 'area-hackney', 'primary-hackney', 'secondary-hackney', 'area-islington', 'primary-islington', 'zone20-islington', 'secondary-islington', 'kings-cross', 'british-library', 'line-east-coast', 'finsbury-park', 'british-museum', 'ucl',
  'highgate-cemetery', 'golders-green-crematorium', 'kensal-green-cemetery',
  'area-camden', 'primary-camden', 'regents-park-lake', 'lords', 'serpentine', 'area-kensington', 'primary-kensington', 'natural-history-museum', 'imperial', 'brompton-cemetery',
  'paddington', 'line-heathrow', 'ealing-broadway', 'track-great-western', 'wembley', 'area-hammersmith', 'secondary-hammersmith', 'kew-gardens', 'm4-interchange',
  'heathrow', 'heathrow-runway', 'heathrow-station',
];
/** The welcome stop: the whole river from high over the City. */
export const LONDON_VIEW: Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'> = { focus: [8, 6], dist: 220, yaw: 0, pitch: 1.15 };
/** The London sections (built on first use). */
export const londonSections = (): DemoSection[] => londonScenario().sections;
