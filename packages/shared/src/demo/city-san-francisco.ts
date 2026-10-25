import type { TourStop } from './showcase';
import type { CityDemo } from './citydemo';

/**
 * San Francisco on the city-map kit (docs/demo.md "Sample cities and the city-map kit"): the peninsula with the
 * Pacific to the west and the Bay to the east, the Golden Gate strait to the north with the bridge to the Marin
 * headlands, Alcatraz in the bay, Yerba Buena and Treasure Island in the middle of it with the Bay Bridge's two spans
 * from the Embarcadero to Oakland, the Ferry Building at the foot of Market Street, Coit Tower on Telegraph Hill, the
 * Transamerica Pyramid downtown, Golden Gate Park and the Presidio, the fish quay at Fisherman's Wharf.
 *
 * 6 tiles a kilometre (a tile about 170 m), Union Square at the middle of a 150×150 map from Ocean Beach to Oakland and
 * from Sausalito to Daly City. The bay east of Yerba Buena Island is drawn at a third of its width (`squeeze`), so the
 * Bay Bridge's east span is a bridge the road tool can lay (twelve tiles at most); Alcatraz and the islands are drawn
 * a little larger than life so a landmark, a road and a pier fit on them.
 */

export const SAN_FRANCISCO: CityDemo = {
  id: 'san-francisco', name: 'San Francisco',
  blurb: 'A sample city on the shape of San Francisco: the Golden Gate Bridge over the strait to the Marin headlands, Alcatraz in the bay, the Bay Bridge by Yerba Buena Island to Oakland, the Ferry Building at the foot of Market Street, Coit Tower on Telegraph Hill and the Transamerica Pyramid downtown, Fisherman\'s Wharf, Golden Gate Park and the Presidio, BART under Market Street and the Bay, Caltrain at 4th and King, a cable car up Nob Hill and the ferries to Sausalito, Oakland and Alcatraz.',
  geo: { lat: 37.7880, lon: -122.4075, scale: 6, squeeze: [{ lon0: -122.358, lon1: -122.305, factor: 0.35 }] },
  rect: [-75, -75, 150, 150],
  margin: 24,
  waters: [{ name: 'the Pacific, the Golden Gate and the Bay', poly: [[38.0, -122.8], [38.0, -122.0], [37.5, -122.0], [37.5, -122.8]] }],
  lands: [
    { name: 'San Francisco', poly: [
      [37.60, -122.5050], [37.60, -122.3800], [37.7080, -122.3850], [37.7160, -122.3720], [37.7250, -122.3600], [37.7330, -122.3700],
      [37.7400, -122.3800], [37.7520, -122.3840], [37.7620, -122.3850], [37.7680, -122.3810], [37.7800, -122.3800], [37.7880, -122.3870],
      [37.7955, -122.3920], [37.8020, -122.3965], [37.8075, -122.4040], [37.8100, -122.4140], [37.8085, -122.4230], [37.8080, -122.4320],
      [37.8065, -122.4420], [37.8050, -122.4560], [37.8080, -122.4680], [37.8106, -122.4770], [37.8000, -122.4810], [37.7900, -122.4880],
      [37.7870, -122.5050], [37.7800, -122.5130], [37.7600, -122.5110], [37.7350, -122.5070], [37.7000, -122.5020],
    ] },
    { name: 'the Marin headlands', poly: [
      [38.0, -122.70], [38.0, -122.4300], [37.8700, -122.4500], [37.8600, -122.4740], [37.8460, -122.4700], [37.8350, -122.4720],
      [37.8270, -122.4730], [37.8235, -122.4780], [37.8220, -122.4880], [37.8200, -122.5000], [37.8160, -122.5300], [37.8200, -122.70],
    ] },
    { name: 'Oakland and the East Bay', poly: [
      [38.0, -122.3200], [37.8700, -122.3120], [37.8400, -122.3000], [37.8280, -122.3030], [37.8200, -122.3150], [37.8080, -122.3240],
      [37.7980, -122.3200], [37.7930, -122.3000], [37.7850, -122.2850], [37.7700, -122.2750], [37.70, -122.2000], [38.0, -122.2000],
    ] },
    // drawn a little south and west of life, so the Bay Bridge's west span is one the road tool can lay
    { name: 'Yerba Buena and Treasure Island', poly: [
      [37.8300, -122.3760], [37.8300, -122.3630], [37.8180, -122.3590], [37.8130, -122.3580], [37.8000, -122.3600], [37.7990, -122.3790],
      [37.8140, -122.3790],
    ] },
    // drawn larger than life: the prison, a road, the ferry's pier and the homes of the guards' families, who run it
    // (no road reaches an island, and the game's jobs and visits go by road)
    { name: 'Alcatraz', poly: [[37.8305, -122.4290], [37.8305, -122.4170], [37.8235, -122.4170], [37.8235, -122.4290]] },
  ],
  bridges: [
    { name: 'the Golden Gate Bridge', at: [37.8180, -122.4783], ns: true, style: 'Suspension', landmark: 'golden-gate' },
    // on the grid the west span runs along a row, from the Embarcadero north of the Ferry Building rather than Rincon Hill
    { name: 'the Bay Bridge (west span)', at: [37.8020, -122.3880], ns: false, style: 'Suspension' },
    { name: 'the Bay Bridge (east span)', at: [37.8220, -122.3400], ns: false, style: 'Suspension' },
  ],
  places: [
    { name: 'the Financial District', at: [37.7940, -122.4000], c: 'city', reach: 0.8 },
    { name: 'Union Square', at: [37.7880, -122.4075], c: 'westend', reach: 0.7 },
    { name: 'Chinatown', at: [37.7941, -122.4078], c: 'inner', reach: 0.6 },
    { name: 'North Beach', at: [37.8005, -122.4100], c: 'inner', reach: 0.7 },
    { name: 'Telegraph Hill', at: [37.8020, -122.4050], c: 'inner', reach: 0.5 },
    { name: 'Fisherman\'s Wharf', at: [37.8080, -122.4160], c: 'westend', reach: 0.6 },
    { name: 'Russian Hill', at: [37.8010, -122.4190], c: 'inner', reach: 0.7 },
    { name: 'Nob Hill', at: [37.7930, -122.4160], c: 'inner', reach: 0.7 },
    { name: 'the Tenderloin', at: [37.7840, -122.4140], c: 'inner', reach: 0.6 },
    { name: 'Civic Center', at: [37.7790, -122.4180], c: 'civic', reach: 0.6 },
    { name: 'SoMa', at: [37.7780, -122.4000], c: 'westend', reach: 1.0 },
    { name: 'Mission Bay', at: [37.7700, -122.3920], c: 'city', reach: 0.7 },
    { name: 'the Marina', at: [37.8020, -122.4370], c: 'inner' },
    { name: 'Pacific Heights', at: [37.7925, -122.4350], c: 'inner' },
    { name: 'the Western Addition', at: [37.7810, -122.4330], c: 'inner' },
    { name: 'the Haight', at: [37.7700, -122.4460], c: 'inner' },
    { name: 'the Castro', at: [37.7610, -122.4350], c: 'inner' },
    { name: 'the Mission', at: [37.7600, -122.4150], c: 'inner', reach: 1.1 },
    { name: 'Potrero Hill', at: [37.7600, -122.4000], c: 'outer' },
    { name: 'Dogpatch', at: [37.7580, -122.3880], c: 'industry', reach: 0.6 },
    { name: 'Bayview', at: [37.7300, -122.3900], c: 'industry' },
    { name: 'Bernal Heights', at: [37.7400, -122.4150], c: 'outer' },
    { name: 'Noe Valley', at: [37.7500, -122.4330], c: 'outer' },
    { name: 'the Richmond', at: [37.7800, -122.4750], c: 'outer', reach: 1.2 },
    { name: 'the Sunset', at: [37.7520, -122.4900], c: 'outer', reach: 1.3 },
    { name: 'Twin Peaks', at: [37.7520, -122.4470], c: 'suburb' },
    { name: 'the Excelsior', at: [37.7240, -122.4300], c: 'outer' },
    { name: 'Visitacion Valley', at: [37.7150, -122.4050], c: 'outer' },
    { name: 'Daly City', at: [37.6950, -122.4700], c: 'suburb' },
    { name: 'the Presidio', at: [37.7980, -122.4650], c: 'suburb', reach: 0.6 },
    { name: 'Sausalito', at: [37.8590, -122.4840], c: 'suburb' },
    { name: 'Treasure Island', at: [37.8230, -122.3700], c: 'outer', reach: 0.5 },
    { name: 'Alcatraz', at: [37.8270, -122.4230], c: 'inner', reach: 0.3, homes: true },
    { name: 'Downtown Oakland', at: [37.8044, -122.2712], c: 'city', reach: 0.7 },
    { name: 'West Oakland', at: [37.8100, -122.2950], c: 'industry' },
    { name: 'Emeryville', at: [37.8390, -122.2900], c: 'westend', reach: 0.6 },
    { name: 'Berkeley', at: [37.8700, -122.2700], c: 'outer' },
    { name: 'Lake Merritt', at: [37.8000, -122.2580], c: 'inner' },
    { name: 'Alameda', at: [37.7700, -122.2600], c: 'suburb' },
    { name: 'Piedmont', at: [37.8240, -122.2400], c: 'suburb' },
  ],
  parks: [
    { name: 'Golden Gate Park', box: [37.7740, -122.5100, 37.7660, -122.4540] },
    { name: 'the Presidio', box: [37.8040, -122.4850, 37.7890, -122.4480], heath: true },
    { name: 'Lands End', box: [37.7870, -122.5050, 37.7800, -122.4900], heath: true },
    { name: 'Twin Peaks', box: [37.7570, -122.4520, 37.7480, -122.4420], heath: true },
    { name: 'Dolores Park', box: [37.7615, -122.4285, 37.7580, -122.4255] },
    { name: 'McLaren Park', box: [37.7230, -122.4290, 37.7120, -122.4120], heath: true },
    { name: 'Telegraph Hill', box: [37.8035, -122.4075, 37.8015, -122.4045] },
    { name: 'the Marin headlands', box: [37.8700, -122.5400, 37.8270, -122.4850], heath: true },
    { name: 'Lake Merritt', box: [37.8080, -122.2620, 37.7980, -122.2500] },
  ],
  rails: [
    // Caltrain from 4th and King south past Mission Bay and Dogpatch to Bayshore
    { id: 'caltrain', name: 'Caltrain', pts: [[37.7775, -122.3945], [37.7300, -122.3945], [37.7300, -122.4010], [37.6900, -122.4010]] },
  ],
  arterials: [
    // Market Street, the diagonal from the Ferry Building to the Castro: on the tile grid a staircase of avenue legs
    { name: 'Market Street', label: 'Market Street', side: 1, pts: [[37.7945, -122.3955], [37.7840, -122.4080], [37.7760, -122.4180], [37.7680, -122.4270], [37.7620, -122.4350]] },
    { name: 'the Embarcadero', label: 'The Embarcadero', pts: [[37.8075, -122.4060], [37.7800, -122.3885]] },
    { name: 'Van Ness Avenue', label: 'Van Ness Avenue', pts: [[37.8040, -122.4245], [37.7750, -122.4190]] },
    { name: 'Geary Boulevard', label: 'Geary Boulevard', pts: [[37.7870, -122.4040], [37.7810, -122.4400], [37.7800, -122.5000]] },
    { name: 'Lombard Street and the approach to the bridge', label: 'Lombard Street', pts: [[37.8000, -122.4245], [37.7995, -122.4480], [37.8040, -122.4620], [37.8075, -122.4765]] },
    { name: 'Nineteenth Avenue and Park Presidio', label: '19th Avenue', pts: [[37.7900, -122.4720], [37.7150, -122.4720]] },
    { name: 'Mission Street', label: 'Mission Street', pts: [[37.7870, -122.4000], [37.7690, -122.4200], [37.7100, -122.4380]] },
    { name: 'Third Street', label: 'Third Street', pts: [[37.7860, -122.4010], [37.7700, -122.3890], [37.7200, -122.3920]] },
    { name: 'Broadway, Oakland', label: 'Broadway', pts: [[37.7960, -122.2770], [37.8350, -122.2600]] },
    { name: 'Grand Avenue', label: 'Grand Avenue', pts: [[37.8080, -122.2900], [37.8100, -122.2450]] },
  ],
  districts: [
    { id: 'downtown', name: 'Downtown and the Financial District', colour: 0xe0a030, poly: [[37.8110, -122.4200], [37.8110, -122.3800], [37.7880, -122.3800], [37.7860, -122.4000], [37.7840, -122.4200]] },
    { id: 'soma', name: 'SoMa', colour: 0xc0504d, poly: [[37.7880, -122.3800], [37.7860, -122.4000], [37.7740, -122.4200], [37.7640, -122.4050], [37.7640, -122.3800]] },
    { id: 'mission', name: 'The Mission', colour: 0x9bbb59, poly: [[37.7740, -122.4200], [37.7640, -122.4050], [37.7640, -122.3700], [37.6800, -122.3700], [37.6800, -122.4450], [37.7700, -122.4450]] },
    { id: 'marina', name: 'The Marina and the Presidio', colour: 0x4f81bd, poly: [[37.9000, -122.5600], [37.9000, -122.4200], [37.7840, -122.4200], [37.7800, -122.4500], [37.7850, -122.5600]] },
    { id: 'richmond-sunset', name: 'The Richmond and the Sunset', colour: 0x8064a2, poly: [[37.7850, -122.5600], [37.7800, -122.4500], [37.7700, -122.4450], [37.6800, -122.4450], [37.6800, -122.5600]] },
    { id: 'oakland', name: 'Oakland', colour: 0xf79646, on: [37.8044, -122.2712], poly: [[38.0, -122.36], [38.0, -122.1], [37.6, -122.1], [37.6, -122.36]] },
  ],
  structures: [
    // buildings/landmarks-san-francisco.ts (the Golden Gate is the bridge's span, `bridges` above)
    { id: 'transamerica-pyramid', kind: 'transamerica-pyramid', at: [37.7952, -122.4028], side: 'E' },
    { id: 'coit-tower', kind: 'coit-tower', at: [37.8024, -122.4058], side: 'W' },
    { id: 'ferry-building', kind: 'ferry-building', at: [37.7955, -122.3937], side: 'W' },
    { id: 'alcatraz', kind: 'alcatraz', at: [37.8267, -122.4230], side: 'S', on: [37.8267, -122.4230] },
    // the kinds a city like it needs
    { id: 'oracle-park', kind: 'stadium', at: [37.7786, -122.3893], side: 'W', name: 'Oracle Park' },
    { id: 'chase-center', kind: 'arena', at: [37.7680, -122.3877], side: 'W', name: 'Chase Center' },
    { id: 'de-young', kind: 'museum', at: [37.7715, -122.4687], side: 'N', name: 'de Young Museum' },
    { id: 'stow-lake', kind: 'lakeside-park', at: [37.7690, -122.4760], side: 'N', name: 'Stow Lake' },
    { id: 'ucsf', kind: 'general-hospital', at: [37.7631, -122.4580], side: 'N', name: 'UCSF Medical Center' },
    { id: 'muni-woods', kind: 'bus-depot', at: [37.7480, -122.3900], side: 'W', name: 'Muni Woods Division' },
    { id: 'sf-city-hall', kind: 'central-library', at: [37.7793, -122.4160], side: 'E', name: 'San Francisco Public Library' },
  ],
  stations: [
    { id: 'fourth-and-king', name: '4th and King', rail: 'caltrain', at: [37.7766, -122.3947] },
    { id: 'bayshore', name: 'Bayshore', rail: 'caltrain', at: [37.7096, -122.4013] },
  ],
  railLines: [{ id: 'line-caltrain', number: 1, colour: 0xe31837, stations: ['fourth-and-king', 'bayshore'], vehicles: 1 }],
  metro: [
    // BART: under the Bay by the Transbay Tube from West Oakland to the Embarcadero, then under Market and Mission
    { id: 'line-bart', name: 'BART', number: 1, colour: 0x0099d8, trains: 6, stops: [
      ['West Oakland', [37.8048, -122.2951], 'hall'], ['Embarcadero', [37.7929, -122.3971], 'hall'], ['Powell Street', [37.7844, -122.4079]],
      ['16th Street Mission', [37.7650, -122.4196]], ['24th Street Mission', [37.7522, -122.4184]], ['Glen Park', [37.7329, -122.4339]],
      ['Balboa Park', [37.7217, -122.4474], 'hall'],
    ] },
  ],
  buses: [
    // the cable car: there is no cable-car kind, so the Powell–Hyde line runs as a bus line up Nob Hill to the Wharf
    { id: 'line-cable-car', number: 60, colour: 0xb5651d, loop: false, vehicles: 3, stops: [
      ['stop-cable-powell-market', 37.7848, -122.4078, 'W'], ['stop-cable-nob-hill', 37.7920, -122.4090, 'W'],
      ['stop-cable-russian-hill', 37.8000, -122.4190, 'W'], ['stop-cable-hyde-beach', 37.8065, -122.4207, 'W'],
    ] },
    { id: 'line-bus-38', number: 38, colour: 0xa6192e, loop: false, vehicles: 4, stops: [
      ['stop-38-transbay', 37.7890, -122.3970, 'S'], ['stop-38-union-square', 37.7870, -122.4060, 'S'], ['stop-38-van-ness', 37.7850, -122.4220, 'S'],
      ['stop-38-fillmore', 37.7840, -122.4330, 'S'], ['stop-38-masonic', 37.7820, -122.4460, 'S'], ['stop-38-park-presidio', 37.7810, -122.4720, 'S'],
    ] },
  ],
  harbours: [
    { id: 'pier-ferry-building', kind: 'ferry-pier', at: [37.7965, -122.3920], name: 'Ferry Building' },
    { id: 'pier-sausalito', kind: 'ferry-pier', at: [37.8560, -122.4775], name: 'Sausalito' },
    { id: 'pier-oakland', kind: 'ferry-pier', at: [37.7940, -122.2900], name: 'Oakland (Jack London Square)' },
    { id: 'pier-33', kind: 'ferry-pier', at: [37.8090, -122.4060], name: 'Pier 33' },
    { id: 'pier-alcatraz', kind: 'ferry-pier', at: [37.8280, -122.4220], name: 'Alcatraz', on: [37.8267, -122.4230] },
    { id: 'fishermans-wharf', kind: 'fishing-harbour', at: [37.8095, -122.4160], name: 'Fisherman\'s Wharf' },
  ],
  ferries: [
    { id: 'line-ferry-bay', number: 1, name: 'Bay ferry', colour: 0x2b5f9e, vehicles: 3, piers: ['pier-sausalito', 'pier-ferry-building', 'pier-oakland'] },
    { id: 'line-ferry-alcatraz', number: 2, name: 'Alcatraz ferry', colour: 0x5a5a5a, vehicles: 2, piers: ['pier-33', 'pier-alcatraz'] },
  ],
  seaGates: [{ name: 'the Golden Gate', at: [37.8100, -122.6500] }],
  areas: [
    { id: 'area-financial-district', name: 'The Financial District', at: [37.7940, -122.4000], kind: 'office', blurb: 'Downtown between Market Street and the Embarcadero: towers on merged lots, the Transamerica Pyramid over them, Chinatown and North Beach up the hill behind.' },
    { id: 'area-market-street', name: 'Market Street', at: [37.7840, -122.4080], kind: 'commercial', blurb: 'The city\'s main street, from the Ferry Building south-west to the Castro. The real one is a diagonal across the grid; on tiles it is a staircase of avenue legs, BART and the buses underneath and along it.' },
    { id: 'area-soma', name: 'SoMa and Mission Bay', at: [37.7760, -122.3980], kind: 'commercial', blurb: 'South of Market: shops and offices, Oracle Park and the Chase Center by the water, Caltrain\'s terminus at 4th and King.' },
    { id: 'area-mission', name: 'The Mission', at: [37.7600, -122.4150], kind: 'residential', blurb: 'Homes and high streets either side of Mission Street, BART underneath, Dolores Park at its western edge.' },
    { id: 'area-marina', name: 'The Marina and Pacific Heights', at: [37.7980, -122.4370], kind: 'residential', blurb: 'Homes along the bay west of Fort Mason, Lombard Street out past the Presidio to the Golden Gate Bridge.' },
    { id: 'area-richmond-sunset', name: 'The Richmond and the Sunset', at: [37.7650, -122.4850], kind: 'residential', blurb: 'The avenues either side of Golden Gate Park, rows of homes out to Ocean Beach.' },
    { id: 'area-oakland', name: 'Oakland', at: [37.8044, -122.2712], kind: 'office', blurb: 'Across the Bay Bridge: Downtown Oakland\'s offices, West Oakland\'s works by the bridge\'s landing, Lake Merritt, and BART back under the bay to the city. (The bay east of Yerba Buena Island is drawn a third of its width.)' },
  ],
  spots: [
    { id: 'the-bay', spot: 'river', name: 'The Bay', at: [37.8150, -122.3900], size: 30, blurb: 'San Francisco Bay from the Embarcadero: the Bay Bridge out to Yerba Buena Island and on to Oakland, Alcatraz to the north, the ferries criss-crossing between them. East of the island the bay is drawn at a third of its width so the bridge\'s east span is one the road tool can lay.' },
  ],
  words: {
    areas: 'The Financial District and SoMa offices and shops, Market Street, the Mission, the Marina, the Richmond and the Sunset homes, Oakland across the bay, each district its own owner.',
    landmarks: 'The Golden Gate Bridge as a real crossing to the Marin headlands, Alcatraz on its island, Coit Tower on Telegraph Hill, the Transamerica Pyramid downtown and the Ferry Building on the Embarcadero, with Oracle Park, the Chase Center, the de Young and Stow Lake in Golden Gate Park.',
    transit: 'BART from West Oakland under the Bay and Market Street to Balboa Park, Caltrain from 4th and King to Bayshore, the Powell–Hyde cable car up Nob Hill (a bus line here), the 38 out Geary, the Bay ferry from Sausalito by the Ferry Building to Oakland, the Alcatraz ferry from Pier 33, and the trawlers of Fisherman\'s Wharf out through the Golden Gate.',
    roads: 'Market Street, the Embarcadero, Van Ness, Geary, Lombard, Nineteenth Avenue, Mission and Third Streets and Oakland\'s Broadway and Grand Avenue as avenues, and the Golden Gate and Bay Bridges.',
  },
};

/** Tour order: the Golden Gate from the headland, Alcatraz from the water, the Wharf, Coit Tower, downtown, Market Street, the Ferry Building and the Bay, out to Golden Gate Park. */
export const SAN_FRANCISCO_TOUR: string[] = [
  'welcome',
  'bridge-the-golden-gate-bridge', 'area-marina', 'alcatraz', 'pier-alcatraz', 'line-ferry-alcatraz', 'pier-33', 'fishermans-wharf',
  'line-cable-car', 'coit-tower', 'area-financial-district', 'transamerica-pyramid', 'area-market-street', 'ferry-building', 'pier-ferry-building',
  'line-ferry-bay', 'the-bay', 'bridge-the-bay-bridge-west-span', 'bridge-the-bay-bridge-east-span', 'area-oakland', 'line-bart',
  'area-soma', 'oracle-park', 'chase-center', 'fourth-and-king', 'line-caltrain', 'area-mission', 'muni-woods', 'sf-city-hall', 'line-bus-38',
  'area-richmond-sunset', 'de-young', 'stow-lake', 'ucsf', 'pier-sausalito',
];
/** The welcome stop (and the hero image): from over the bay south-east of the city, the Golden Gate and Marin beyond, Alcatraz and the Bay Bridge to the right, late morning. */
export const SAN_FRANCISCO_VIEW: Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'> = { focus: [-20, -6], dist: 90, yaw: 1.047, pitch: 0.559 };
