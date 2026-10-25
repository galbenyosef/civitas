import type { TourStop } from './showcase';
import type { CityDemo } from './citydemo';

/**
 * New York on the city-map kit (docs/demo.md "Sample cities and the city-map kit"): Manhattan up the middle of the map
 * on its own street grid, the Hudson to the west with Jersey City and Hoboken beyond it, the East River to the east
 * with Brooklyn and Queens, the Harlem River and the Bronx in the north-east, and the Upper Bay to the south with the
 * Statue of Liberty on its island. The map is turned so Manhattan's avenues run straight up it ("Manhattan north",
 * 29° east of true north), 8 tiles a kilometre (a tile 125 m), 84×196 tiles from the Statue to Inwood.
 *
 * Manhattan above Houston Street is a regular grid (`grid` places: streets every four or five tiles, avenues every
 * five to seven), the Financial District, Tribeca and the Lower East Side the irregular streets below it. Broadway is
 * not the diagonal it is: on a tile grid it runs as one more avenue, straight up the West Side, with a jog at Madison
 * Square where the Flatiron stands between it and Fifth Avenue. JFK is twenty kilometres east, far off this map.
 */

/** a point on Manhattan: its districts keep to the island */
const MANHATTAN = [40.7540, -73.9840] as const;

export const NEW_YORK: CityDemo = {
  id: 'new-york', name: 'New York',
  blurb: 'A sample city on the shape of New York: Manhattan on its grid between the Hudson and the East River, the Statue of Liberty in the harbour, One World Trade Center downtown, the Brooklyn Bridge across to Brooklyn, the Flatiron, the Empire State, the Chrysler Building, Rockefeller Center and Radio City in midtown, Central Park, Grand Central and Penn Station, the 1 and the 7 underground and the ferry to Liberty Island.',
  geo: { lat: 40.7580, lon: -73.9855, scale: 8, rotate: 29, at: [0, 20] },
  rect: [-42, -98, 84, 196],
  margin: 24,
  // the harbour and the rivers are water; the land is drawn back over it
  waters: [{ name: 'the Upper Bay, the Hudson and the East River', poly: [[41.0, -74.4], [41.0, -73.6], [40.4, -73.6], [40.4, -74.4]] }],
  lands: [
    { name: 'Manhattan', poly: [
      [40.7003, -74.0153], [40.7040, -74.0185], [40.7110, -74.0170], [40.7180, -74.0150], [40.7270, -74.0115], [40.7380, -74.0100],
      [40.7480, -74.0085], [40.7570, -74.0040], [40.7680, -73.9960], [40.7790, -73.9890], [40.7900, -73.9810], [40.8030, -73.9720],
      [40.8170, -73.9610], [40.8300, -73.9530], [40.8450, -73.9480], [40.8530, -73.9450], [40.8650, -73.9330], [40.8770, -73.9260],
      [40.8760, -73.9175], [40.8680, -73.9185], [40.8530, -73.9270], [40.8380, -73.9345], [40.8250, -73.9355], [40.8140, -73.9355],
      [40.8030, -73.9320], [40.7960, -73.9330], [40.7860, -73.9380], [40.7760, -73.9430], [40.7660, -73.9490], [40.7570, -73.9580],
      [40.7480, -73.9680], [40.7380, -73.9720], [40.7280, -73.9710], [40.7180, -73.9750], [40.7110, -73.9800], [40.7080, -73.9930],
      [40.7065, -74.0005], [40.7030, -74.0080], [40.7010, -74.0120],
    ] },
    { name: 'New Jersey', poly: [
      [40.95, -74.30], [40.95, -73.9350], [40.8800, -73.9400], [40.8550, -73.9590], [40.8300, -73.9720], [40.8050, -73.9880],
      [40.7800, -74.0040], [40.7650, -74.0140], [40.7500, -74.0230], [40.7350, -74.0270], [40.7220, -74.0310], [40.7120, -74.0330],
      [40.7020, -74.0400], [40.6950, -74.0520], [40.6850, -74.0560], [40.6700, -74.0680], [40.6500, -74.0760], [40.6300, -74.0900],
      [40.50, -74.10], [40.50, -74.30],
    ] },
    { name: 'Brooklyn and Queens', poly: [
      [40.50, -74.05], [40.6100, -74.0380], [40.6400, -74.0370], [40.6550, -74.0230], [40.6680, -74.0200], [40.6750, -74.0180],
      [40.6830, -74.0140], [40.6920, -74.0030], [40.7000, -73.9960], [40.7040, -73.9890], [40.7030, -73.9760], [40.7090, -73.9690],
      [40.7160, -73.9650], [40.7240, -73.9610], [40.7320, -73.9620], [40.7380, -73.9600], [40.7450, -73.9580], [40.7520, -73.9500],
      [40.7600, -73.9420], [40.7700, -73.9360], [40.7780, -73.9250], [40.7800, -73.9120], [40.7850, -73.9000], [40.80, -73.85],
      [40.50, -73.70],
    ] },
    { name: 'the Bronx', poly: [
      [40.7950, -73.9150], [40.8030, -73.9240], [40.8150, -73.9280], [40.8280, -73.9285], [40.8400, -73.9255], [40.8540, -73.9170],
      [40.8670, -73.9090], [40.8780, -73.9100], [40.8820, -73.9200], [40.95, -73.9250], [40.95, -73.75], [40.80, -73.75], [40.7950, -73.88],
    ] },
    // drawn about twice its size, so the Statue, a road and the ferry's pier fit on it
    { name: 'Liberty Island', poly: [[40.6915, -74.0480], [40.6915, -74.0405], [40.6868, -74.0405], [40.6868, -74.0480]] },
  ],
  bridges: [
    { name: 'the Brooklyn Bridge', at: [40.7061, -73.9969], ns: false, style: 'Suspension', landmark: 'brooklyn-bridge' },
    { name: 'the Manhattan Bridge', at: [40.7075, -73.9908], ns: false, style: 'Suspension' },
    { name: 'the Williamsburg Bridge', at: [40.7137, -73.9722], ns: false, style: 'Suspension' },
    { name: 'the Queensboro Bridge', at: [40.7570, -73.9540], ns: false, style: 'Girder' },
    { name: 'the George Washington Bridge', at: [40.8517, -73.9527], ns: false, style: 'Suspension' },
    { name: 'the Third Avenue Bridge', at: [40.8070, -73.9310], ns: false, style: 'Girder' },
    { name: 'the Macombs Dam Bridge', at: [40.8280, -73.9320], ns: false, style: 'Arch' },
    { name: 'the Washington Bridge', at: [40.8460, -73.9270], ns: false, style: 'Arch' },
    { name: 'the Broadway Bridge', at: [40.8730, -73.9140], ns: false, style: 'Girder' },
    // the real island is reached only by ferry, and a building no road reaches is never staffed: a short service bridge
    // to Liberty State Park, beside the real one to Ellis Island, brings the Statue's staff and visitors over
    { name: 'the Liberty Island bridge', at: [40.6892, -74.0500], ns: false, style: 'Girder' },
  ],
  places: [
    { name: 'the Financial District', at: [40.7075, -74.0090], c: 'city', reach: 0.8 },
    { name: 'the World Trade Center', at: [40.7127, -74.0134], c: 'city', reach: 0.6 },
    { name: 'Tribeca', at: [40.7180, -74.0080], c: 'inner', reach: 0.7 },
    { name: 'Chinatown', at: [40.7160, -73.9970], c: 'inner', reach: 0.7 },
    { name: 'the Lower East Side', at: [40.7180, -73.9850], c: 'inner' },
    { name: 'Greenwich Village', at: [40.7330, -74.0030], c: 'inner', grid: true },
    { name: 'the East Village', at: [40.7270, -73.9830], c: 'inner', grid: true },
    { name: 'Union Square', at: [40.7359, -73.9911], c: 'westend', reach: 0.7, grid: true },
    { name: 'Chelsea', at: [40.7450, -74.0010], c: 'inner', grid: true },
    { name: 'the Flatiron District', at: [40.7411, -73.9897], c: 'westend', reach: 0.7, grid: true },
    { name: 'Gramercy and Murray Hill', at: [40.7450, -73.9780], c: 'inner', grid: true },
    { name: 'Midtown', at: [40.7540, -73.9840], c: 'city', reach: 1.3, grid: true },
    { name: 'Times Square', at: [40.7580, -73.9855], c: 'westend', reach: 0.6, grid: true },
    { name: 'Hell\'s Kitchen', at: [40.7640, -73.9930], c: 'inner', grid: true },
    { name: 'the Upper West Side', at: [40.7870, -73.9750], c: 'inner', reach: 1.2, grid: true },
    { name: 'the Upper East Side', at: [40.7740, -73.9560], c: 'inner', reach: 1.2, grid: true },
    { name: 'Morningside Heights', at: [40.8080, -73.9620], c: 'inner', grid: true },
    { name: 'Harlem', at: [40.8116, -73.9465], c: 'inner', reach: 1.1, grid: true },
    { name: 'East Harlem', at: [40.7960, -73.9380], c: 'outer', grid: true },
    { name: 'Washington Heights', at: [40.8417, -73.9394], c: 'outer', reach: 1.1, grid: true },
    { name: 'Inwood', at: [40.8677, -73.9212], c: 'outer', grid: true },
    { name: 'Jersey City', at: [40.7180, -74.0380], c: 'city', reach: 0.6 },
    { name: 'Hoboken', at: [40.7440, -74.0300], c: 'inner' },
    { name: 'Union City', at: [40.7700, -74.0300], c: 'suburb' },
    { name: 'Weehawken', at: [40.7700, -74.0170], c: 'inner', reach: 0.6 },
    { name: 'West New York', at: [40.7880, -74.0100], c: 'suburb' },
    { name: 'Fort Lee', at: [40.8510, -73.9700], c: 'suburb' },
    { name: 'Cliffside Park', at: [40.8200, -73.9900], c: 'suburb' },
    { name: 'Bayonne', at: [40.6700, -74.1000], c: 'industry' },
    { name: 'Greenville', at: [40.6950, -74.0800], c: 'suburb' },
    { name: 'Downtown Brooklyn', at: [40.6930, -73.9900], c: 'city', reach: 0.7 },
    { name: 'Brooklyn Heights', at: [40.6960, -73.9960], c: 'inner', reach: 0.6 },
    { name: 'DUMBO', at: [40.7030, -73.9880], c: 'inner', reach: 0.5 },
    { name: 'the Navy Yard', at: [40.7000, -73.9720], c: 'industry', reach: 0.6 },
    { name: 'Williamsburg', at: [40.7140, -73.9550], c: 'inner' },
    { name: 'Greenpoint', at: [40.7300, -73.9530], c: 'outer' },
    { name: 'Long Island City', at: [40.7450, -73.9450], c: 'westend', reach: 0.8 },
    { name: 'Astoria', at: [40.7700, -73.9200], c: 'outer' },
    { name: 'Sunnyside', at: [40.7430, -73.9200], c: 'suburb' },
    { name: 'Bushwick', at: [40.6950, -73.9200], c: 'suburb' },
    { name: 'Bedford-Stuyvesant', at: [40.6870, -73.9420], c: 'suburb' },
    { name: 'Fort Greene', at: [40.6890, -73.9740], c: 'inner' },
    { name: 'Park Slope', at: [40.6710, -73.9810], c: 'outer' },
    { name: 'Red Hook', at: [40.6760, -74.0080], c: 'industry' },
    { name: 'Gowanus', at: [40.6750, -73.9900], c: 'industry', reach: 0.6 },
    { name: 'Crown Heights', at: [40.6700, -73.9450], c: 'suburb' },
    { name: 'Sunset Park', at: [40.6550, -74.0050], c: 'industry' },
    { name: 'Mott Haven', at: [40.8090, -73.9230], c: 'outer' },
    { name: 'Port Morris', at: [40.8010, -73.9100], c: 'industry', reach: 0.6 },
    { name: 'the Concourse', at: [40.8300, -73.9200], c: 'outer' },
    { name: 'Highbridge', at: [40.8420, -73.9260], c: 'outer' },
  ],
  parks: [
    { name: 'Central Park', poly: [[40.7644, -73.9730], [40.7681, -73.9819], [40.8003, -73.9580], [40.7968, -73.9496]] },
    { name: 'Battery Park', poly: [[40.7055, -74.0180], [40.7040, -74.0145], [40.7010, -74.0140], [40.7008, -74.0170]] },
    { name: 'Prospect Park', poly: [[40.6720, -73.9700], [40.6620, -73.9800], [40.6530, -73.9720], [40.6600, -73.9620]] },
    { name: 'Riverside Park', poly: [[40.8000, -73.9730], [40.8010, -73.9705], [40.7810, -73.9840], [40.7800, -73.9865]] },
    { name: 'Inwood Hill Park', poly: [[40.8730, -73.9280], [40.8690, -73.9280], [40.8650, -73.9320], [40.8720, -73.9310]] },
    { name: 'Liberty State Park', poly: [[40.7040, -74.0500], [40.6990, -74.0540], [40.6960, -74.0600], [40.7030, -74.0580]] },
    { name: 'McCarren Park', poly: [[40.7220, -73.9530], [40.7210, -73.9490], [40.7180, -73.9500], [40.7190, -73.9540]] },
    { name: 'Washington Square', poly: [[40.7320, -73.9985], [40.7315, -73.9960], [40.7300, -73.9965], [40.7305, -73.9990]] },
  ],
  rails: [
    // Metro-North from Grand Central up Park Avenue to Harlem (the real line is in a tunnel, then on a viaduct)
    { id: 'park-avenue', name: 'the Park Avenue line', pts: [[40.7520, -73.9765], [40.8060, -73.9375]] },
    // from Penn Station west to the Hudson and up the West Side to Inwood (the Empire Connection, in the open here)
    { id: 'west-side', name: 'the West Side line', pts: [[40.7500, -73.9935], [40.7590, -74.0015], [40.8670, -73.9300]] },
  ],
  arterials: [
    { name: 'Fifth Avenue', label: 'Fifth Avenue', pts: [[40.7312, -73.9970], [40.8180, -73.9360]] },
    // Broadway: up from Bowling Green on the grid (not its real diagonal), jogging west at Madison Square past the
    // Flatiron, then straight up the West Side through Times Square and Columbus Circle to Inwood
    { name: 'Broadway', label: 'Broadway', pts: [[40.7050, -74.0135], [40.7400, -73.9915], [40.7420, -73.9950], [40.7580, -73.9855], [40.8670, -73.9220]] },
    { name: '42nd Street', label: '42nd Street', side: 1, pts: [[40.7620, -74.0010], [40.7480, -73.9690]] },
    { name: '34th Street', label: '34th Street', side: 1, pts: [[40.7570, -74.0040], [40.7430, -73.9720]] },
    { name: '23rd Street', label: '23rd Street', pts: [[40.7500, -74.0070], [40.7360, -73.9760]] },
    { name: '14th Street', label: '14th Street', pts: [[40.7430, -74.0080], [40.7300, -73.9750]] },
    { name: '57th Street', label: '57th Street', pts: [[40.7720, -73.9930], [40.7590, -73.9620]] },
    { name: '86th Street', label: '86th Street', pts: [[40.7900, -73.9800], [40.7770, -73.9480]] },
    { name: '125th Street', label: '125th Street', pts: [[40.8170, -73.9600], [40.8040, -73.9330]] },
    { name: 'Park Avenue', label: 'Park Avenue', pts: [[40.7450, -73.9810], [40.7510, -73.9775]] },
    { name: 'First Avenue', label: 'First Avenue', pts: [[40.7250, -73.9830], [40.7860, -73.9440]] },
    { name: 'Eighth Avenue', label: 'Eighth Avenue', pts: [[40.7400, -74.0040], [40.7681, -73.9819]] },
    { name: 'Canal Street and Houston Street', label: 'Houston Street', pts: [[40.7230, -74.0090], [40.7230, -73.9880], [40.7230, -73.9790]] },
    { name: 'Flatbush Avenue', label: 'Flatbush Avenue', pts: [[40.7000, -73.9890], [40.6720, -73.9700]] },
    { name: 'Atlantic Avenue', label: 'Atlantic Avenue', pts: [[40.6920, -73.9990], [40.6790, -73.9300]] },
    { name: 'Queens Boulevard', label: 'Queens Boulevard', pts: [[40.7500, -73.9480], [40.7420, -73.9100]] },
    { name: 'Kennedy Boulevard', label: 'Kennedy Boulevard', pts: [[40.6800, -74.0880], [40.7900, -74.0120]] },
    { name: 'the Grand Concourse', label: 'Grand Concourse', pts: [[40.8130, -73.9260], [40.8600, -73.9030]] },
  ],
  roundabouts: [
    { id: 'columbus-circle', name: 'Columbus Circle', at: [40.7681, -73.9819], blurb: 'Columbus Circle, at the south-west corner of Central Park, where Broadway meets Eighth Avenue: a two-lane roundabout round the column, the only real one in Manhattan.' },
  ],
  districts: [
    // map tiles: Manhattan between its streets, the boroughs and Jersey by their shores
    { id: 'downtown', name: 'Downtown', colour: 0xe0a030, on: MANHATTAN, tiles: [[-30, 52], [40, 52], [40, 110], [-30, 110]] },
    { id: 'midtown', name: 'Midtown', colour: 0xc0504d, on: MANHATTAN, tiles: [[-30, 11], [40, 11], [40, 52], [-30, 52]] },
    { id: 'upper-west', name: 'Upper West Side', colour: 0x4f81bd, on: MANHATTAN, tiles: [[-30, -22], [1, -22], [1, 11], [-30, 11]] },
    { id: 'upper-east', name: 'Upper East Side', colour: 0x9bbb59, on: MANHATTAN, tiles: [[1, -22], [40, -22], [40, 11], [1, 11]] },
    { id: 'harlem', name: 'Harlem and Upper Manhattan', colour: 0x8064a2, on: MANHATTAN, tiles: [[-40, -110], [40, -110], [40, -22], [-40, -22]] },
    { id: 'brooklyn', name: 'Brooklyn', colour: 0x4bacc6, on: [40.6930, -73.9900], poly: [[40.7370, -74.1], [40.7370, -73.6], [40.4, -73.6], [40.4, -74.1]] },
    { id: 'queens', name: 'Queens', colour: 0xf79646, on: [40.6930, -73.9900], poly: [[40.9, -74.1], [40.9, -73.6], [40.7370, -73.6], [40.7370, -74.1]] },
    { id: 'jersey', name: 'Jersey City and Hoboken', colour: 0x7f7fbf, on: [40.7300, -74.0450], poly: [[41.0, -74.4], [41.0, -73.6], [40.4, -73.6], [40.4, -74.4]] },
    { id: 'bronx', name: 'The Bronx', colour: 0xb5651d, on: [40.8300, -73.9200], poly: [[41.0, -74.4], [41.0, -73.6], [40.4, -73.6], [40.4, -74.4]] },
  ],
  structures: [
    // buildings/landmarks-new-york.ts, where the real ones stand
    { id: 'statue-of-liberty', kind: 'statue-of-liberty', at: [40.6892, -74.0445], side: 'S', on: [40.6892, -74.0445], zoom: 0.8 },
    { id: 'one-world-trade-center', kind: 'one-world-trade-center', at: [40.7127, -74.0134], side: 'E' },
    { id: 'flatiron', kind: 'flatiron', at: [40.7411, -73.9897], side: 'S' },
    { id: 'empire-state', kind: 'empire-state', at: [40.7484, -73.9857], side: 'S' },
    { id: 'chrysler', kind: 'chrysler', at: [40.7516, -73.9755], side: 'S' },
    { id: 'rockefeller-center', kind: 'rockefeller-center', at: [40.7587, -73.9787], side: 'E' },
    { id: 'radio-city', kind: 'radio-city', at: [40.7600, -73.9800], side: 'W', hour: 21 },
    // the kinds a city like it needs
    { id: 'madison-square-garden', kind: 'arena', at: [40.7505, -73.9934], side: 'E', name: 'Madison Square Garden' },
    { id: 'yankee-stadium', kind: 'stadium', at: [40.8296, -73.9262], side: 'W', name: 'Yankee Stadium' },
    { id: 'barclays-center', kind: 'arena', at: [40.6826, -73.9754], side: 'N', name: 'Barclays Center' },
    { id: 'the-met', kind: 'museum', at: [40.7794, -73.9632], side: 'E', name: 'The Metropolitan Museum of Art' },
    { id: 'nypl', kind: 'central-library', at: [40.7532, -73.9822], side: 'E', name: 'New York Public Library' },
    { id: 'bellevue', kind: 'general-hospital', at: [40.7393, -73.9750], side: 'W', name: 'Bellevue Hospital' },
    { id: 'central-park-lake', kind: 'lakeside-park', at: [40.7790, -73.9700], side: 'W', name: 'The Lake, Central Park' },
    { id: 'columbia', kind: 'university', at: [40.8075, -73.9626], side: 'E', name: 'Columbia University' },
    { id: 'depot-michael-quill', kind: 'bus-depot', at: [40.7590, -73.9990], side: 'N', name: 'Michael J. Quill Depot' },
  ],
  venues: [
    { id: 'broadway-majestic', kind: 'theatre', at: [40.7578, -73.9880], side: 'S', name: 'Majestic Theatre' },
    { id: 'broadway-lyceum', kind: 'theatre', at: [40.7573, -73.9840], side: 'S', name: 'Lyceum Theatre' },
    { id: 'joes-pub', kind: 'studio-theatre', at: [40.7290, -73.9920], side: 'E', name: 'The Public Theater' },
  ],
  stations: [
    { id: 'grand-central', name: 'Grand Central', rail: 'park-avenue', at: [40.7527, -73.9772] },
    { id: 'harlem-125th', name: 'Harlem–125th Street', rail: 'park-avenue', at: [40.8053, -73.9390] },
    { id: 'penn-station', name: 'Penn Station', rail: 'west-side', at: [40.7506, -73.9935] },
    { id: 'marble-hill', name: 'Inwood', rail: 'west-side', at: [40.8640, -73.9310] },
  ],
  railLines: [
    { id: 'line-park-avenue', number: 1, colour: 0x0039a6, stations: ['grand-central', 'harlem-125th'], vehicles: 1 },
    { id: 'line-west-side', number: 2, colour: 0x1d4e89, stations: ['penn-station', 'marble-hill'], vehicles: 1 },
  ],
  metro: [
    { id: 'line-metro-1', name: '1 train', number: 1, colour: 0xee352e, trains: 8, stops: [
      ['South Ferry', [40.7020, -74.0130], 'hall'], ['Chambers Street', [40.7155, -74.0093]], ['Christopher Street', [40.7334, -74.0029]],
      ['34th Street–Penn Station', 'penn-station'], ['Times Square–42nd Street', [40.7553, -73.9870], 'hall'], ['72nd Street', [40.7785, -73.9819]],
      ['96th Street', [40.7937, -73.9724]], ['116th Street–Columbia University', [40.8078, -73.9640]], ['137th Street–City College', [40.8221, -73.9537]],
      ['168th Street', [40.8406, -73.9400]], ['Dyckman Street', [40.8606, -73.9255], 'hall'],
    ] },
    { id: 'line-metro-7', name: '7 train', number: 7, colour: 0xb933ad, trains: 6, stops: [
      // from Grand Central: at this scale Times Square is four tiles from it and the 1's platforms leave no row to
      // cross under west of it; a stop by the UN at First Avenue (the real line passes under it) splits the tunnel
      // under the East River into two the boring search reaches
      ['Grand Central', 'grand-central', 'hall'], ['First Avenue–United Nations', [40.7494, -73.9700]],
      ['Vernon Boulevard–Jackson Avenue', [40.7426, -73.9536]], ['Queensboro Plaza', [40.7509, -73.9402]], ['33rd Street–Rawson Street', [40.7449, -73.9309], 'hall'],
    ] },
  ],
  buses: [
    { id: 'line-bus-m15', number: 15, colour: 0x2f6db5, loop: false, vehicles: 5, stops: [
      ['stop-m15-south-ferry', 40.7030, -74.0110, 'E'], ['stop-m15-chatham', 40.7130, -73.9980, 'E'], ['stop-m15-houston', 40.7230, -73.9870, 'E'],
      ['stop-m15-14th', 40.7320, -73.9810, 'E'], ['stop-m15-34th', 40.7450, -73.9720, 'E'], ['stop-m15-un', 40.7500, -73.9690, 'E'],
      ['stop-m15-59th', 40.7600, -73.9600, 'E'], ['stop-m15-86th', 40.7770, -73.9500, 'E'],
    ] },
  ],
  harbours: [
    { id: 'pier-battery', kind: 'ferry-pier', at: [40.7015, -74.0165], name: 'Battery Park' },
    { id: 'pier-liberty', kind: 'ferry-pier', at: [40.6905, -74.0430], name: 'Liberty Island', on: [40.6892, -74.0445] },
    { id: 'pier-liberty-state-park', kind: 'ferry-pier', at: [40.7010, -74.0420], name: 'Liberty State Park' },
    { id: 'red-hook-terminal', kind: 'cargo-port', at: [40.6810, -74.0150], name: 'Red Hook Container Terminal' },
    { id: 'pier-wall-street', kind: 'ferry-pier', at: [40.7034, -74.0066], name: 'Wall Street' },
    { id: 'pier-dumbo', kind: 'ferry-pier', at: [40.7036, -73.9910], name: 'DUMBO' },
    { id: 'pier-williamsburg', kind: 'ferry-pier', at: [40.7215, -73.9625], name: 'North Williamsburg' },
    { id: 'pier-hunters-point', kind: 'ferry-pier', at: [40.7430, -73.9590], name: 'Hunters Point South' },
  ],
  ferries: [
    { id: 'line-ferry-liberty', number: 1, name: 'Statue ferry', colour: 0x1d6f4a, vehicles: 2, piers: ['pier-battery', 'pier-liberty', 'pier-liberty-state-park'] },
    { id: 'line-ferry-east-river', number: 2, name: 'East River ferry', colour: 0x2b5f9e, vehicles: 2, piers: ['pier-wall-street', 'pier-dumbo', 'pier-williamsburg', 'pier-hunters-point'] },
  ],
  seaGates: [{ name: 'the Narrows', at: [40.6100, -74.0400] }],
  areas: [
    { id: 'area-downtown', name: 'Downtown and the Financial District', at: [40.7080, -74.0090], kind: 'office', blurb: 'The tip of Manhattan below the grid: Wall Street\'s old irregular streets, towers on merged lots, One World Trade Center over the river, Battery Park and the ferries. The morning commute pours in over the Brooklyn Bridge and up from the harbour.' },
    { id: 'area-midtown', name: 'Midtown', at: [40.7540, -73.9840], kind: 'office', blurb: 'The heart of the grid: towers and headquarters from 34th to 59th Street, Grand Central and Penn Station, the Empire State, the Chrysler Building and Rockefeller Center, and the theatres of Times Square on Broadway.' },
    { id: 'area-upper-west', name: 'The Upper West Side', at: [40.7870, -73.9760], kind: 'residential', blurb: 'Homes on the grid between Central Park and the Hudson, mid-rise and towers, the 1 train under Broadway and the West Side line along the river.' },
    { id: 'area-upper-east', name: 'The Upper East Side', at: [40.7740, -73.9560], kind: 'residential', blurb: 'Homes east of Central Park, the Met on Fifth Avenue, First Avenue\'s M15 buses down to South Ferry.' },
    { id: 'area-harlem', name: 'Harlem', at: [40.8116, -73.9465], kind: 'residential', blurb: 'North of Central Park: 125th Street, Harlem\'s homes and high streets, Columbia on Morningside Heights, and over the Harlem River the Bronx and Yankee Stadium.' },
    { id: 'area-brooklyn', name: 'Brooklyn', at: [40.6930, -73.9900], kind: 'residential', blurb: 'Across the East River: Downtown Brooklyn\'s offices at the end of the Brooklyn and Manhattan Bridges, Brooklyn Heights over the river, the Navy Yard, the Barclays Center and the brownstones of Fort Greene and Park Slope.' },
    { id: 'area-queens', name: 'Long Island City and Queens', at: [40.7450, -73.9450], kind: 'commercial', blurb: 'Over the Queensboro Bridge: Long Island City\'s new towers by the river, the 7 train out to Sunnyside, Astoria to the north.' },
    { id: 'area-jersey', name: 'Jersey City and Hoboken', at: [40.7300, -74.0350], kind: 'office', blurb: 'Across the Hudson, a state away: Jersey City\'s towers on the waterfront, Hoboken\'s grid behind, Liberty State Park and the ferry to the Statue. The George Washington Bridge is the only road over the river on the map.' },
  ],
  spots: [
    { id: 'upper-bay', spot: 'sea-gate', name: 'The Upper Bay', at: [40.6950, -74.0300], size: 26, blurb: 'The harbour: the Hudson and the East River meet off the Battery and open south through the Narrows to the sea. Container ships come up the bay to Red Hook, and the ferry runs from the Battery to Liberty Island.' },
  ],
  words: {
    areas: 'Downtown and Midtown offices, the Upper West and East Sides and Harlem homes on the grid, Brooklyn, Queens, the Bronx and Jersey City over the rivers, each district its own owner.',
    landmarks: 'The Statue of Liberty, One World Trade Center, the Brooklyn Bridge as a real crossing, the Flatiron, the Empire State, the Chrysler Building, Rockefeller Center and Radio City Music Hall where the real ones stand, with Madison Square Garden, the Met, the Public Library, Yankee Stadium, the Barclays Center and Columbia.',
    transit: 'Grand Central with the Park Avenue line to Harlem and Penn Station with the West Side line to Inwood, the 1 train from South Ferry up the West Side and the 7 from Grand Central under the East River to Queens, the M15 up First Avenue, the Statue ferry from the Battery and the East River ferry.',
    roads: 'Manhattan\'s grid with Fifth Avenue, Broadway, First and Eighth Avenues and the crosstown streets (14th, 23rd, 34th, 42nd, 57th, 86th and 125th) as avenues, Columbus Circle a two-lane roundabout, and the bridges over the rivers.',
  },
};

/** Tour order: the harbour and the Statue, downtown, the Brooklyn Bridge, up the grid through midtown to Central Park and Harlem. */
export const NEW_YORK_TOUR: string[] = [
  'welcome',
  'upper-bay', 'statue-of-liberty', 'pier-liberty', 'line-ferry-liberty', 'pier-battery', 'red-hook-terminal',
  'area-downtown', 'one-world-trade-center', 'metro-line-metro-1-south-ferry', 'bridge-the-brooklyn-bridge', 'area-brooklyn', 'barclays-center', 'line-ferry-east-river',
  'flatiron', 'empire-state', 'madison-square-garden', 'penn-station', 'area-midtown', 'grand-central', 'chrysler', 'nypl',
  'line-metro-7', 'broadway-majestic', 'radio-city', 'rockefeller-center', 'columbus-circle',
  'central-park-lake', 'the-met', 'area-upper-east', 'line-bus-m15', 'area-upper-west', 'line-metro-1',
  'area-harlem', 'columbia', 'line-park-avenue', 'yankee-stadium', 'bridge-the-george-washington-bridge', 'line-west-side',
  'area-queens', 'area-jersey', 'bellevue', 'depot-michael-quill', 'joes-pub', 'broadway-lyceum',
];
/** The welcome stop (and the hero image): up Manhattan from over the East River downtown, Central Park and Harlem beyond, late afternoon. */
export const NEW_YORK_VIEW: Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'> = { focus: [6, 30], dist: 80, yaw: -0.436, pitch: 0.559 };
