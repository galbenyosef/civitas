import type { DemoRect, DemoXY, DemoSection, DemoPlacement, DemoBlock, TourStop } from './showcase';
import { KIND_ID } from '../buildings/compiled';
import { FRONT, placedFromAnchor, placedFromDoor, type Placed } from '../structures';
import { LONDON_MAP, LT, arterialPaths, geoF, inLondon, lidx, londonBase, londonBridges, londonPlan, type LondonPlan } from './londonMap';

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
  ['leicester-square', 'multiplex', 51.5103, -0.1301, 'W'],
  ['serpentine', 'lakeside-park', 51.5050, -0.1700, 'S'],
  ['regents-park-lake', 'lakeside-park', 51.5270, -0.1600, 'N'],
  ['kew-gardens', 'botanical-garden', 51.4787, -0.2955, 'S'],
  ['wembley', 'stadium', 51.5560, -0.2795, 'S'],
  ['london-stadium', 'stadium', 51.5387, -0.0166, 'S'],
  ['copper-box', 'leisure-centre', 51.5448, -0.0215, 'W'],
  ['o2-arena', 'arena', 51.4999, 0.0211, 'W'],
  ['victoria-garage', 'bus-depot', 51.4930, -0.1450, 'N'],
  ['stockwell-garage', 'bus-depot', 51.4740, -0.1180, 'E'],
  ['poplar-garage', 'bus-depot', 51.5110, -0.0050, 'N'],
];
/** 1×1 venues, on a frontage lot near the real one once the streets are laid. */
const VENUES: Spot[] = [
  ['palladium', 'theatre', 51.5142, -0.1404, 'S'],
  ['lyceum', 'theatre', 51.5115, -0.1199, 'N'],
  ['donmar', 'studio-theatre', 51.5142, -0.1264, 'W'],
  ['barbican', 'theatre', 51.5200, -0.0938, 'S'],
  ['lords', 'sports', 51.5294, -0.1727, 'E'],
];
/** Bus routes: each stop near a real one, beside a plain stretch of road on its `side` (never facing a junction). */
const ROUTE_25: Spot[] = [
  ['stop-25-marble-arch', 'bus-stop', 51.5160, -0.1590, 'S'], ['stop-25-oxford-circus', 'bus-stop', 51.5160, -0.1410, 'S'],
  ['stop-25-tottenham-ct', 'bus-stop', 51.5160, -0.1320, 'S'], ['stop-25-holborn', 'bus-stop', 51.5160, -0.1098, 'S'],
  ['stop-25-st-pauls', 'bus-stop', 51.5160, -0.0950, 'S'],
  ['stop-25-aldgate', 'bus-stop', 51.5160, -0.0720, 'S'], ['stop-25-whitechapel', 'bus-stop', 51.5160, -0.0600, 'S'],
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
      if (water[i] || reserved[i] >= 0 || taken[i] === 2) return false;
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
    structures.push({ id, kind, door: [best.doorX, best.doorY], rot: best.r as 0 | 1 | 2 | 3 });
  }

  const plan = londonPlan(keeps);
  problems.push(...plan.problems);
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
  const stopAt = ([id, , lat, lon, side]: Spot): DemoPlacement => {
    // a plain stretch (no junction at the board tile) on a loop of the network (a bus carries on and comes back round
    // rather than turning in the road), preferably a main road, on `side`
    const plain = (x: number, y: number, want: number | null, main: boolean) => {
      if (route.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) < 3)) return false;
      const d = BOARD.find((r) => roadAt(x + FRONT[r][0], y + FRONT[r][1]));
      if (d === undefined || (want !== null && d !== want)) return false;
      const bx = x + FRONT[d][0], by = y + FRONT[d][1];
      if (plan.t[lidx(bx, by)] !== LT.Road || !plan.loop[lidx(bx, by)] || (main && !plan.main[lidx(bx, by)])) return false;
      return FRONT.filter(([ox, oy]) => roadAt(bx + ox, by + oy)).length <= 2;
    };
    const door = nearLot(lat, lon, (x, y) => plain(x, y, SIDES[side], true), 4) ?? nearLot(lat, lon, (x, y) => plain(x, y, null, true), 6)
      ?? nearLot(lat, lon, (x, y) => plain(x, y, null, false));
    if (!door) problems.push(`${id}: no plain stretch of road near its place`);
    else route.push(door);
    return { id, kind: 'bus-stop', door: door ?? [0, 0] };
  };
  const [route25, route159, routeD3] = [ROUTE_25, ROUTE_159, ROUTE_D3].map((r) => { route = []; return r.map(stopAt); });
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
  const pick = (...ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is DemoPlacement => !!p);

  const sections: DemoSection[] = [
    {
      id: 'london-areas', name: 'Areas',
      blurb: 'The City, Canary Wharf, the West End, Westminster and the rings of homes and industry round them, zoned as London roughly is, each borough its own owner.',
      blocks: areas,
    },
    {
      id: 'london-landmarks', name: 'Landmarks',
      blurb: 'The Gherkin, the Shard, the Walkie Talkie, One Canada Square, the Royal Opera House, Big Ben and the Houses of Parliament, the London Eye, Buckingham Palace, the Tower and Tower Bridge, and the hospitals, museums, theatres, parks, stadiums and the arena that the real ones stand for.',
      placements: [
        ...pick('new-scotland-yard', 'st-thomas', 'royal-london', 'lambeth-fire', 'british-museum', 'natural-history-museum', 'maritime-museum', 'british-library',
          'royal-opera-house', 'gherkin', 'walkie-talkie', 'shard', 'one-canada-square', 'parliament', 'london-eye', 'buckingham-palace', 'tower-of-london'),
        ...venues,
        ...pick('leicester-square', 'serpentine', 'regents-park-lake', 'kew-gardens', 'wembley', 'london-stadium', 'copper-box', 'o2-arena'),
      ],
      // the street plan bridges every named crossing (londonMap.ts); Tower Bridge is the landmark among them
      bridges: [{ id: 'tower-bridge', name: 'Tower Bridge', from: towerFrom, to: towerTo, style: 'Bascule', landmark: 'tower-bridge' }],
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
        { id: 'line-bus-25', mode: 'bus', number: 25, colour: 0xd32f2f, loop: false, vehicles: 4, stops: route25.map((p) => p.door) },
        { id: 'line-bus-159', mode: 'bus', number: 159, colour: 0xc62828, loop: false, vehicles: 5, stops: route159.map((p) => p.door) },
        { id: 'line-bus-d3', mode: 'bus', number: 3, colour: 0xb71c1c, loop: true, vehicles: 2, stops: routeD3.map((p) => p.door) },
      ],
    },
  ];
  return (BUILT = { sections, plan, problems });
}

/** Tour order: west to east along the river, then the rings round it. */
export const LONDON_TOUR: string[] = [
  'welcome',
  'area-westminster', 'parliament', 'london-eye', 'buckingham-palace', 'new-scotland-yard', 'st-thomas', 'lambeth-fire',
  'area-west-end', 'royal-opera-house', 'palladium', 'lyceum', 'donmar', 'leicester-square', 'line-bus-25', 'line-bus-159',
  'area-city', 'gherkin', 'walkie-talkie', 'tower-of-london', 'tower-bridge', 'barbican', 'liverpool-street', 'track-great-eastern', 'line-great-eastern', 'stratford', 'london-stadium', 'copper-box',
  'area-south-bank', 'shard', 'waterloo', 'line-south-western', 'clapham-junction', 'area-clapham', 'victoria-garage', 'stockwell-garage', 'area-brixton',
  'area-canary-wharf', 'one-canada-square', 'area-isle-of-dogs', 'line-bus-d3', 'poplar-garage', 'area-greenwich', 'maritime-museum', 'o2-arena',
  'area-royal-docks', 'area-thames-gateway', 'dagenham-yard', 'track-freight', 'barking-yard', 'line-freight',
  'royal-london', 'area-hackney', 'area-islington', 'kings-cross', 'british-library', 'line-east-coast', 'finsbury-park', 'british-museum',
  'area-camden', 'regents-park-lake', 'lords', 'serpentine', 'area-kensington', 'natural-history-museum',
  'paddington', 'line-heathrow', 'ealing-broadway', 'track-great-western', 'wembley', 'area-hammersmith', 'kew-gardens',
  'heathrow', 'heathrow-runway', 'heathrow-station',
];
/** The welcome stop: the whole river from high over the City. */
export const LONDON_VIEW: Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'> = { focus: [8, 6], dist: 220, yaw: 0, pitch: 1.15 };
/** The London sections (built on first use). */
export const londonSections = (): DemoSection[] => londonScenario().sections;
