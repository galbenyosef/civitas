import type { DemoRect, DemoXY, DemoSection, DemoPlacement, DemoBlock, DemoClassRoad, DemoJunction, DemoSpot, DemoBridge, DemoLine, DemoTrack, TourStop, SpotKind } from './showcase';
import { hash2 } from '../noise';
import { KIND_ID } from '../buildings/compiled';
import { FRONT, placedFromAnchor, placedFromDoor, isWetTile, fairwayTiles, fairwayDepth, WET_OF, type Placed } from '../structures';
import { HARBOUR_OF } from '../harbours';
import { TRANSIT } from '../transit';
import { platformSpan } from '../metro';
import { stationStop, stopTile } from '../rail';
import { LT, RM } from './londonMap';
import {
  CityGrid, cityBase, cityBridges, cityRoads, cityPlan, cityPlaces, cityArterialPaths, citySeaGates, railCorners,
  type CityMapData, type CityPlan, type LatLon,
} from './citymap';

/**
 * A sample city's scenario on the city-map kit (docs/demo.md "Sample cities and the city-map kit"): the landmarks and
 * kinds fitted where the real ones stand before the streets are laid (London's STRUCTURES way), the stations along
 * their railways, the harbours and piers on the water, the streets planned round them (citymap.ts cityPlan), then the
 * bus stops, the metro entrances and the 1×1 venues on the frontage the plan leaves, and the tour. A city is one
 * `CityDemo` value (city-paris.ts, city-new-york.ts, city-san-francisco.ts); `cityScenario` builds it on first use.
 */

const K = KIND_ID as Record<string, number>;
const SIDES = { S: 0, E: 1, N: 2, W: 3 } as const;
export type Side = keyof typeof SIDES;

/** A structure where a real one stands: the side its door faces and the tour's view of it. `on` names a place whose land mass it must stand on (an island). */
export interface CityStructure {
  id: string; kind: string; at: LatLon; side: Side;
  /** the land it stands on: the land mass of this point (default its own) */
  on?: LatLon;
  name?: string; hour?: number; aside?: number; zoom?: number; graves?: number;
}
/** A 1×1 kind on a frontage lot near its place, its door towards `side` where it can. */
export interface CityVenue { id: string; kind: string; at: LatLon; side: Side; name?: string }
/** A rail station fitted along its railway (citymap.ts CityRail) as near `at` as its platform fits. */
export interface CityStation { id: string; name: string; rail: string; at: LatLon; kind?: 'rail-station' | 'rail-halt' }
export interface CityRailLine { id: string; number: number; colour: number; stations: readonly string[]; vehicles: number }
/** A harbour or pier on the water near `at`, its front on dry land facing a road; `name` is what it goes by. */
export interface CityHarbour { id: string; kind: 'ferry-pier' | 'marina' | 'jetty' | 'fishing-harbour' | 'cargo-port'; at: LatLon; name: string; on?: LatLon }
export interface CityFerry { id: string; number: number; name: string; colour: number; vehicles: number; piers: readonly string[] }
/** A metro stop: its name, where (a place or a rail station id: the entrance then lands within the change walk), 'hall' for a station hall. */
export type CityMetroStop = readonly [name: string, at: LatLon | string, hall?: 'hall'];
export interface CityMetroLine { id: string; name: string; number: number; colour: number; trains: number; stops: readonly CityMetroStop[] }
export type CityBusStop = readonly [id: string, lat: number, lon: number, side: Side];
export interface CityBusLine { id: string; number: number; colour: number; loop: boolean; vehicles: number; stops: readonly CityBusStop[] }
/** A named area on the tour: the 15×15 tiles round a real place. */
export interface CityArea { id: string; name: string; at: LatLon; kind: 'residential' | 'commercial' | 'office' | 'industrial'; blurb: string }
/** A tour stop on something that is neither a kind nor a drag (the water, a crossing), in the city's own words. */
export interface CitySpot { id: string; spot: SpotKind; name: string; at: LatLon; size: number; blurb: string; hour?: number; view?: DemoSpot['view'] }

/** A sample city: its map (citymap.ts) and its scenario. */
export interface CityDemo extends CityMapData {
  /** the demo's id (`?demo=`) and the prefix of its owners */
  id: string;
  name: string;
  /** the welcome card's words and the landing page's (DemoDef.blurb) */
  blurb: string;
  structures: readonly CityStructure[];
  venues?: readonly CityVenue[];
  stations?: readonly CityStation[];
  railLines?: readonly CityRailLine[];
  harbours?: readonly CityHarbour[];
  ferries?: readonly CityFerry[];
  metro?: readonly CityMetroLine[];
  buses?: readonly CityBusLine[];
  areas: readonly CityArea[];
  spots?: readonly CitySpot[];
  /** the section blurbs, the welcome card's facts */
  words: { areas: string; landmarks: string; transit: string; roads: string };
}

export interface CityScenario { sections: DemoSection[]; plan: CityPlan; grid: CityGrid; problems: string[] }

/** Offsets within nine tiles, nearest first, with their length. */
const NEAR: [number, number, number][] = [];
for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) NEAR.push([dx, dy, Math.hypot(dx, dy)]);
NEAR.sort((a, b) => a[2] - b[2]);
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const bboxOf = (pts: readonly DemoXY[], pad: number): DemoRect => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return [x0, y0, Math.max(...xs) + pad - x0 + 1, Math.max(...ys) + pad - y0 + 1];
};
/** Share of the suburban and outer crossroads of side streets that are mini-roundabouts, by hash (the organic rule). */
const MINI_SHARE = 1 / 12;

const BUILT = new Map<string, CityScenario>();
/** The city's scenario: placements fitted, streets planned, stops and venues found (built once per city, on first use). */
export function cityScenario(city: CityDemo): CityScenario {
  const done = BUILT.get(city.id);
  if (done) return done;
  const g = new CityGrid(city), { MW, MH, inMap, idx } = g;
  const base = cityBase(g), { water, rail, mass } = base;
  const { placeAt } = cityPlaces(g);
  const problems: string[] = [];
  const { bridges, problems: bridgeProblems } = cityBridges(g, base);
  problems.push(...bridgeProblems);
  /** the land mass of a real place: its tile's, or the nearest dry tile's */
  const massOf = (px: number, py: number) => {
    for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.floor(px) + dx, y = Math.floor(py) + dy;
      if (inMap(x, y) && mass[idx(x, y)]) return mass[idx(x, y)];
    }
    return 0;
  };
  const taken = new Uint8Array(MW * MH);
  const claim = (p: Placed) => {
    for (let y = p.ay - 1; y <= p.ay + p.h; y++) for (let x = p.ax - 1; x <= p.ax + p.w; x++) {
      if (!inMap(x, y)) continue;
      const inside = x >= p.ax && y >= p.ay && x < p.ax + p.w && y < p.ay + p.h;
      taken[idx(x, y)] = Math.max(taken[idx(x, y)], inside ? 2 : 1);
    }
  };
  const keeps: Placed[] = [];

  // ---- the rail stations, along their railways: the platform's back row on straight track (or the line's end)
  const railIds = (city.rails ?? []).map((r) => r.id);
  const stationPlacements: DemoPlacement[] = [];
  const stationDoor = new Map<string, DemoXY>();
  for (const st of city.stations ?? []) {
    const n = railIds.indexOf(st.rail), path = base.railPaths[n];
    if (!path) { problems.push(`${st.id}: no railway ${st.rail}`); continue; }
    const ends = new Set([path[0], path[path.length - 1]].filter(([x, y]) => inMap(x, y)).map(([x, y]) => idx(x, y)));
    const kind = st.kind ?? 'rail-station', k = K[kind], [px, py] = g.geoF(st.at[0], st.at[1]);
    let best: Placed | null = null, bd = Infinity;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) for (let r = 0; r < 4; r++) {
      const p = placedFromDoor(k, Math.round(px) + dx, Math.round(py) + dy, r), d = Math.hypot(p.doorX - px, p.doorY - py);
      if (d >= bd) continue;
      const s = stationStop(p);
      let ok = true;
      for (let a = s.a0; a <= s.a1 && ok; a++) {
        const [x, y] = stopTile(s, a);
        ok = inMap(x, y) && rail[idx(x, y)] === n && (base.railAxis[idx(x, y)] === (s.alongX ? 1 : 2) || ends.has(idx(x, y)));
      }
      for (let y = p.ay; y < p.ay + p.h && ok; y++) for (let x = p.ax; x < p.ax + p.w && ok; x++) ok = inMap(x, y) && !water[idx(x, y)] && rail[idx(x, y)] < 0 && !taken[idx(x, y)];
      const [fx, fy] = FRONT[p.r];
      for (let s2 = 0; s2 < (fx ? p.h : p.w) && ok; s2++) {
        const x = fx ? (fx > 0 ? p.ax + p.w : p.ax - 1) : p.ax + s2, y = fy ? (fy > 0 ? p.ay + p.h : p.ay - 1) : p.ay + s2;
        ok = inMap(x, y) && !water[idx(x, y)] && rail[idx(x, y)] < 0 && taken[idx(x, y)] !== 2;
      }
      if (ok) { bd = d; best = p; }
    }
    if (!best) { problems.push(`${st.id}: no straight stretch of the ${st.rail} railway near it for the platform`); continue; }
    claim(best); keeps.push(best);
    stationPlacements.push({ id: st.id, kind, door: [best.doorX, best.doorY], rot: best.r as 0 | 1 | 2 | 3, name: st.name });
    stationDoor.set(st.id, [best.doorX, best.doorY]);
  }

  // ---- the road classes' skeleton round the stations
  const roads = cityRoads(g, base, bridges, keeps);
  const noFront = new Uint8Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) {
    const m = roads.mark[i];
    if (m === RM.Twin) taken[i] = Math.max(taken[i], 1);
    else if (m === RM.Clear || m === RM.Motorway) taken[i] = 2;
    else if (m === RM.NoFront || m === RM.Frame) noFront[i] = 1;
  }
  for (const path of cityArterialPaths(g)) for (const [x, y] of path) if (inMap(x, y)) taken[idx(x, y)] = Math.max(taken[idx(x, y)], 1);
  for (const b of bridges) {
    for (const end of [-1, b.len]) for (let k = 0; k < 3; k++) {
      const s = end < 0 ? end - k : end + k, x = b.x + (b.ns ? 0 : s), y = b.y + (b.ns ? s : 0);
      if (inMap(x, y)) taken[idx(x, y)] = Math.max(taken[idx(x, y)], 1);
    }
    // the land beside a deck takes no road (none may join a bridge from the side): nothing stands or faces there
    for (let k = 0; k < b.len; k++) for (const s of [-1, 1]) {
      const x = b.x + (b.ns ? s : k), y = b.y + (b.ns ? k : s);
      if (inMap(x, y) && !water[idx(x, y)]) { taken[idx(x, y)] = 2; noFront[idx(x, y)] = 1; }
    }
  }
  const fits = (p: Placed, m: number) => {
    for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) {
      if (!inMap(x, y)) return false;
      const i = idx(x, y);
      if (water[i] || rail[i] >= 0 || taken[i] || mass[i] !== m) return false;
    }
    const [fx, fy] = FRONT[p.r];
    for (let s = 0; s < (fx ? p.h : p.w); s++) {
      const x = fx ? (fx > 0 ? p.ax + p.w : p.ax - 1) : p.ax + s, y = fy ? (fy > 0 ? p.ay + p.h : p.ay - 1) : p.ay + s;
      if (!inMap(x, y)) return false;
      const i = idx(x, y);
      if (water[i] || rail[i] >= 0 || taken[i] === 2 || noFront[i]) return false;
    }
    return true;
  };
  const structures: DemoPlacement[] = [];
  for (const s of city.structures) {
    const k = K[s.kind];
    if (!k) { problems.push(`${s.id}: no catalogue kind ${s.kind}`); continue; }
    const [px, py] = g.geoF(s.at[0], s.at[1]), m = s.on ? massOf(...g.geoF(s.on[0], s.on[1])) : massOf(px, py);
    let best: Placed | null = null, bd = Infinity;
    for (let r = 0; r < 4; r++) {
      const p0 = placedFromAnchor(k, 0, 0, r), cost = r === SIDES[s.side] ? 0 : 2;
      const ax0 = Math.round(px - p0.w / 2), ay0 = Math.round(py - p0.h / 2);
      for (const [dx, dy, n] of NEAR) {
        if (n - 1 + cost >= bd) break;
        const p = placedFromAnchor(k, ax0 + dx, ay0 + dy, r), d = Math.hypot(p.ax + p.w / 2 - px, p.ay + p.h / 2 - py) + cost;
        if (d < bd && fits(p, m)) { bd = d; best = p; }
      }
    }
    if (!best) { problems.push(`${s.id}: no room near (${Math.round(px)}, ${Math.round(py)})`); continue; }
    claim(best); keeps.push(best);
    structures.push({
      id: s.id, kind: s.kind, door: [best.doorX, best.doorY], rot: best.r as 0 | 1 | 2 | 3,
      ...(s.name ? { name: s.name } : {}), ...(s.hour !== undefined ? { hour: s.hour } : {}), ...(s.aside !== undefined ? { aside: s.aside } : {}),
      ...(s.zoom !== undefined ? { zoom: s.zoom } : {}), ...(s.graves !== undefined ? { graves: s.graves } : {}),
    });
  }

  // ---- harbours and piers: the back rows over the water a tile clear of every bridge deck, the front on dry land
  // facing a road, open water behind as deep as the kind's boats need and at least three rows, the second row out and
  // a tile beyond each end of it water all round (a channel past it), a pier's berth with open water beyond each end
  const deck = new Uint8Array(MW * MH), wetTaken = new Uint8Array(MW * MH);
  for (const b of bridges) for (let k = 0; k < b.len; k++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const x = b.x + (b.ns ? 0 : k) + ox, y = b.y + (b.ns ? k : 0) + oy;
    if (inMap(x, y)) deck[idx(x, y)] = Math.max(deck[idx(x, y)], ox || oy ? 1 : 2);
  }
  const openAt = (x: number, y: number) => inMap(x, y) && !!water[idx(x, y)] && deck[idx(x, y)] < 2 && !wetTaken[idx(x, y)];
  const wetAt = (x: number, y: number) => inMap(x, y) && !!water[idx(x, y)];
  const alongRow = (row: [number, number][]): [number, number][] => {
    const [ax, ay] = row[0], [bx, by] = row[row.length - 1], dx = Math.sign(bx - ax), dy = Math.sign(by - ay);
    return [[ax - dx, ay - dy], ...row, [bx + dx, by + dy]];
  };
  const harbourWater = (p: Placed): [number, number][] => {
    const spec = WET_OF[p.kind]!, out: [number, number][] = [];
    for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) if (isWetTile(p, x, y)) out.push([x, y]);
    for (let row = 0; row < Math.max(3, fairwayDepth(spec.fairwayClearance)); row++) out.push(...fairwayTiles(p, row));
    if (HARBOUR_OF[p.kind]?.role === 'pier') { const ends = alongRow(fairwayTiles(p, 0)); out.push(ends[0], ends[ends.length - 1]); }
    return out;
  };
  const fitsHarbour = (p: Placed, m: number) => {
    for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) {
      if (!inMap(x, y)) return false;
      const i = idx(x, y);
      if (isWetTile(p, x, y)) { if (deck[i] || !water[i]) return false; continue; }
      if (water[i] || rail[i] >= 0 || taken[i] || mass[i] !== m) return false;
    }
    if (!harbourWater(p).every(([x, y]) => openAt(x, y))) return false;
    if (!alongRow(fairwayTiles(p, 1)).every(([x, y]) => FRONT.every(([dx, dy]) => wetAt(x + dx, y + dy)))) return false;
    const [fx, fy] = FRONT[p.r];
    for (let s = 0; s < (fx ? p.h : p.w); s++) {
      const x = fx ? (fx > 0 ? p.ax + p.w : p.ax - 1) : p.ax + s, y = fy ? (fy > 0 ? p.ay + p.h : p.ay - 1) : p.ay + s;
      if (!inMap(x, y)) return false;
      const i = idx(x, y);
      if (water[i] || rail[i] >= 0 || taken[i] === 2 || noFront[i]) return false;
    }
    return true;
  };
  const dryPart = (p: Placed): Placed => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) if (!isWetTile(p, x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { ...p, ax: x0, ay: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const harbours: DemoPlacement[] = [];
  for (const h of city.harbours ?? []) {
    const k = K[h.kind], [px, py] = g.geoF(h.at[0], h.at[1]), m = h.on ? massOf(...g.geoF(h.on[0], h.on[1])) : massOf(px, py);
    let best: Placed | null = null, bd = Infinity;
    for (let r = 0; r < 4; r++) {
      const p0 = placedFromAnchor(k, 0, 0, r), ax0 = Math.round(px - p0.w / 2), ay0 = Math.round(py - p0.h / 2);
      for (const [dx, dy, n] of NEAR) {
        if (n - 1 >= bd) break;
        const p = placedFromAnchor(k, ax0 + dx, ay0 + dy, r), d = Math.hypot(p.ax + p.w / 2 - px, p.ay + p.h / 2 - py);
        if (d < bd && fitsHarbour(p, m)) { bd = d; best = p; }
      }
    }
    if (!best) { problems.push(`${h.id}: no shore near (${Math.round(px)}, ${Math.round(py)}) with the water it needs`); continue; }
    const dry = dryPart(best);
    claim(dry);
    for (const [x, y] of harbourWater(best)) wetTaken[idx(x, y)] = 1;
    keeps.push(dry);
    harbours.push({ id: h.id, kind: h.kind, door: [best.doorX, best.doorY], rot: best.r as 0 | 1 | 2 | 3, name: h.name });
  }

  const plan = cityPlan(g, base, bridges, keeps, roads);
  problems.push(...plan.problems);
  const roadT = (v: number) => v === LT.Road || v === LT.Crossing || v === LT.Deck;
  const roadAt = (x: number, y: number) => inMap(x, y) && roadT(plan.t[idx(x, y)]);
  const used = new Set<number>();
  /** frontage lots near (lat, lon), nearest first, that `ok` accepts */
  const nearLot = (lat: number, lon: number, ok: (x: number, y: number) => boolean, radius = 8): DemoXY | null => {
    const [px, py] = g.geoF(lat, lon);
    let best: DemoXY | null = null, bd = Infinity;
    for (let y = Math.floor(py) - radius; y <= Math.floor(py) + radius; y++) for (let x = Math.floor(px) - radius; x <= Math.floor(px) + radius; x++) {
      if (!inMap(x, y) || plan.t[idx(x, y)] !== LT.Land || plan.reach[idx(x, y)] !== 1 || used.has(idx(x, y)) || !ok(x, y)) continue;
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) used.add(idx(best[0], best[1]));
    return best;
  };
  const venues: DemoPlacement[] = [];
  for (const v of city.venues ?? []) {
    const [fx, fy] = FRONT[SIDES[v.side]];
    const door = nearLot(v.at[0], v.at[1], (x, y) => roadAt(x + fx, y + fy)) ?? nearLot(v.at[0], v.at[1], () => true);
    if (door) venues.push({ id: v.id, kind: v.kind, door, ...(v.name ? { name: v.name } : {}) }); else problems.push(`${v.id}: no frontage lot near its place`);
  }

  // ---- the roads section: the avenues as drags of their class, the roundabouts, mini-roundabouts by hash
  const classRoads: DemoClassRoad[] = plan.avenues.map((a) => ({ cls: 3, from: a.path[0], to: a.path[a.path.length - 1], path: a.path }));
  // the avenues' names: each straight leg of three tiles or more named as its owner would rename it (seed.ts `streets`)
  const streets: { at: DemoXY; ns?: boolean; name: string }[] = [];
  for (const a of plan.avenues) {
    if (!a.label) continue;
    for (let k = 0; k < a.path.length;) {
      let e = k + 1;
      const ns = e < a.path.length && a.path[e][0] === a.path[k][0];
      while (e < a.path.length && (ns ? a.path[e][0] === a.path[k][0] : a.path[e][1] === a.path[k][1])) e++;
      if (e - k >= 3) streets.push({ at: a.path[Math.floor((k + e - 1) / 2)], ...(ns ? { ns: true } : {}), name: a.label });
      k = e - 1 > k ? e - 1 : e;
    }
  }
  const junctions: DemoJunction[] = plan.roundabouts.map((r) => ({
    id: r.id, tool: 'roundabout', at: r.group, big: true, name: r.name, blurb: r.blurb,
    rect: [r.box[0] - 2, r.box[1] - 2, 9, 9], inspect: [r.box[0] + 2, r.box[1]],
  }));
  const street = (x: number, y: number) => inMap(x, y) && plan.t[idx(x, y)] === LT.Road && !plan.cls[idx(x, y)];
  const minis: DemoXY[] = [];
  for (let i = 0; i < MW * MH; i++) {
    const x = g.tx(i), y = g.ty(i);
    if (!street(x, y) || hash2(x * 13 + 5, y * 7 + 11) >= MINI_SHARE) continue;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => street(x + dx, y + dy))) continue;
    const c = placeAt(x + 0.5, y + 0.5).c;
    if (c !== 'suburb' && c !== 'outer') continue;
    if (minis.some(([mx, my]) => Math.abs(mx - x) + Math.abs(my - y) < 4)) continue;
    minis.push([x, y]);
  }
  minis.forEach((at, n) => junctions.push({ id: `mini-${n + 1}`, tool: 'miniroundabout', at }));

  // ---- bus stops: a plain stretch (no junction at the board tile) on a loop of the network, preferably a main road,
  // on the side the server boards from; stops of a route three tiles apart (London's stopAt)
  const BOARD = [0, 1, 3, 2];
  let route: DemoXY[] = [];
  const stopAt = ([id, lat, lon, side]: CityBusStop, loopLine: boolean): DemoPlacement | null => {
    let avenue = loopLine;
    const plain = (x: number, y: number, want: number | null, main: boolean) => {
      if (route.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) < 3)) return false;
      const d = BOARD.find((r) => roadAt(x + FRONT[r][0], y + FRONT[r][1]));
      if (d === undefined || (want !== null && d !== want)) return false;
      const bx = x + FRONT[d][0], by = y + FRONT[d][1], b = idx(bx, by);
      if (plan.t[b] !== LT.Road || !plan.loop[b] || (main && !plan.main[b])) return false;
      if (plan.cls[b] === 3 && !avenue) return false;
      if (plan.cls[b] === 3) {
        const tw = plan.twin[b];
        if (tw < 0) return false;
        const qx = g.tx(tw), qy = g.ty(tw), [ax, ay] = qx === bx ? [1, 0] : [0, 1];
        return ([[bx, by, tw], [qx, qy, b]] as const).every(([cx, cy, other]) => FRONT.filter(([ox, oy]) => roadAt(cx + ox, cy + oy) && idx(cx + ox, cy + oy) !== other).length === 2
          && [-1, 1].every((s) => roadAt(cx + ax * s, cy + ay * s) && plan.twin[idx(cx + ax * s, cy + ay * s)] >= 0));
      }
      return FRONT.filter(([ox, oy]) => roadAt(bx + ox, by + oy)).length <= 2;
    };
    const find = () => nearLot(lat, lon, (x, y) => plain(x, y, SIDES[side], true), 4) ?? nearLot(lat, lon, (x, y) => plain(x, y, null, true), 6)
      ?? nearLot(lat, lon, (x, y) => plain(x, y, null, false));
    let door = find();
    if (!door && !avenue) { avenue = true; door = find(); }
    if (!door) { problems.push(`${id}: no plain stretch of road near its place`); return null; }
    route.push(door);
    return { id, kind: 'bus-stop', door };
  };
  const busStops: DemoPlacement[] = [];
  const busLines: DemoLine[] = (city.buses ?? []).map((l) => {
    route = [];
    const stops = l.stops.map((s) => stopAt(s, l.loop)).filter((p): p is DemoPlacement => !!p);
    busStops.push(...stops);
    return { id: l.id, mode: 'bus', number: l.number, colour: l.colour, loop: l.loop, vehicles: l.vehicles, stops: stops.map((p) => p.door) };
  });

  // ---- the metro: each entrance on a frontage lot as near its real place as fits, the platform along the line
  const platformTiles = new Set<number>(), platformEnds = new Set<number>();
  const entrances = new Map<string, DemoXY[]>();
  const walk = (a: DemoXY, b: DemoXY) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= TRANSIT.transferWalk;
  const lot = (x: number, y: number) => inMap(x, y) && plan.t[idx(x, y)] === LT.Land && !used.has(idx(x, y));
  const fitEntrance = (kind: 'metro-entrance' | 'metro-station', target: readonly [number, number], alongX: boolean, near: DemoXY[]): DemoPlacement | null => {
    const tx = Math.floor(target[0]), ty = Math.floor(target[1]);
    for (const [dx, dy] of NEAR) {
      const x = tx + dx, y = ty + dy;
      if (!near.every((p) => walk(p, [x, y])) || !lot(x, y) || plan.reach[idx(x, y)] !== 1) continue;
      const span = platformSpan(K[kind], x, y, alongX);
      const under: number[] = [];
      for (let a = span.a0; a <= span.a1; a++) { const [px, py] = stopTile(span, a); if (!inMap(px, py)) break; under.push(idx(px, py)); }
      const ends = [span.a0 - 1, span.a1 + 1].map((a) => stopTile(span, a)).filter(([px, py]) => inMap(px, py)).map(([px, py]) => idx(px, py));
      if (under.length !== span.len || under.some((i) => platformTiles.has(i) || platformEnds.has(i)) || ends.some((i) => platformTiles.has(i))) continue;
      let rot: 0 | 1 | 2 | 3 = alongX ? 0 : 1;
      if (kind === 'metro-station') {
        const r = ([alongX ? 0 : 1, alongX ? 2 : 3] as const).find((q) => {
          const p = placedFromDoor(K[kind], x, y, q), [fx, fy] = FRONT[q];
          for (let py = p.ay; py < p.ay + p.h; py++) for (let px = p.ax; px < p.ax + p.w; px++) if (!lot(px, py)) return false;
          return inMap(x + fx, y + fy) && plan.t[idx(x + fx, y + fy)] === LT.Road;
        });
        if (r === undefined) continue;
        rot = r;
        const p = placedFromDoor(K[kind], x, y, rot);
        for (let py = p.ay; py < p.ay + p.h; py++) for (let px = p.ax; px < p.ax + p.w; px++) used.add(idx(px, py));
      }
      used.add(idx(x, y));
      for (const i of under) platformTiles.add(i);
      for (const i of ends) platformEnds.add(i);
      return { kind, door: [x, y], rot };
    }
    return null;
  };
  const metroStations: DemoPlacement[] = [];
  const metroLines: DemoLine[] = (city.metro ?? []).map((line) => {
    const targets = line.stops.map(([, where]): [number, number] => {
      if (typeof where === 'string') { const d = stationDoor.get(where); return d ? [d[0], d[1]] : [0, 0]; }
      return g.geoF(where[0], where[1]);
    });
    const doors = line.stops.flatMap(([name, where, hall], i): DemoXY[] => {
      const [ax, ay] = targets[Math.max(0, i - 1)], [bx, by] = targets[Math.min(targets.length - 1, i + 1)];
      const alongX = Math.abs(bx - ax) >= Math.abs(by - ay);
      const changeAt = typeof where === 'string' ? stationDoor.get(where) : undefined;
      const near = [...(entrances.get(name) ?? []), ...(changeAt ? [changeAt] : [])];
      const id = `metro-${line.id}-${slug(name)}`;
      const p = [alongX, !alongX].reduce<DemoPlacement | null>((got, ax2) => got ?? ((hall && fitEntrance('metro-station', targets[i], ax2, near)) || fitEntrance('metro-entrance', targets[i], ax2, near)), null);
      if (!p) { problems.push(`${id}: no frontage lot near (${Math.round(targets[i][0])}, ${Math.round(targets[i][1])}) with room for the platform`); return []; }
      metroStations.push({ ...p, id, name });
      entrances.set(name, [...(entrances.get(name) ?? []), p.door]);
      return [p.door];
    });
    return { id: line.id, mode: 'metro', number: line.number, name: line.name, colour: line.colour, loop: false, vehicles: line.trains, stops: doors };
  });

  // ---- rail: the tracks (a drag per straight leg) and the lines between the stations
  const tracks: DemoTrack[] = (city.rails ?? []).map((r, n) => {
    const corners = railCorners(base.railPaths[n]);
    return { id: `track-${r.id}`, name: r.name, drags: corners.slice(1).map((c, k) => [corners[k], c] as const) };
  });
  const railLines: DemoLine[] = (city.railLines ?? []).map((l) => ({
    id: l.id, mode: 'rail', number: l.number, colour: l.colour, loop: false, vehicles: l.vehicles,
    stops: l.stations.map((s) => stationDoor.get(s) ?? [0, 0]),
  }));
  const harbourById = new Map(harbours.map((p) => [p.id, p]));
  const ferryLines: DemoLine[] = (city.ferries ?? []).map((f) => ({
    id: f.id, mode: 'ferry', number: f.number, name: f.name, colour: f.colour, loop: false, vehicles: f.vehicles,
    stops: f.piers.map((p) => harbourById.get(p)?.door).filter((d): d is DemoXY => !!d),
  }));

  // ---- the tour's areas, spots and bridges
  const areas: DemoBlock[] = city.areas.map((a) => {
    const [px, py] = g.geoF(a.at[0], a.at[1]);
    const inspect = nearLot(a.at[0], a.at[1], () => true) ?? [Math.round(px), Math.round(py)];
    used.delete(idx(inspect[0], inspect[1]));
    return { id: a.id, kind: a.kind, name: a.name, blurb: a.blurb, rect: [Math.round(px) - 7, Math.round(py) - 7, 15, 15] as DemoRect, inspect };
  });
  const spots: DemoSpot[] = (city.spots ?? []).map((s) => {
    const [px, py] = g.geoF(s.at[0], s.at[1]), h = Math.floor(s.size / 2);
    return { id: s.id, spot: s.spot, name: s.name, blurb: s.blurb, rect: [Math.round(px) - h, Math.round(py) - h, s.size, s.size] as DemoRect, inspect: [Math.round(px), Math.round(py)] as DemoXY, ...(s.hour !== undefined ? { hour: s.hour } : {}), ...(s.view ? { view: s.view } : {}) };
  });
  const demoBridges: DemoBridge[] = plan.bridges.map((b) => ({
    id: `bridge-${slug(b.name)}`, name: b.name, from: [b.x, b.y], to: [b.x + (b.ns ? 0 : b.len - 1), b.y + (b.ns ? b.len - 1 : 0)],
    style: b.spec.style, ...(b.spec.landmark ? { landmark: b.spec.landmark } : {}),
  }));
  const seen = new Set<string>();
  for (const b of demoBridges) { if (seen.has(b.id)) b.id = `${b.id}-${seen.size}`; seen.add(b.id); }

  const sections: DemoSection[] = [
    { id: 'city-areas', name: 'Areas', blurb: city.words.areas, blocks: areas, spots },
    { id: 'city-landmarks', name: 'Landmarks', blurb: city.words.landmarks, placements: [...structures, ...venues], bridges: demoBridges },
    {
      id: 'city-transit', name: 'Getting about', blurb: city.words.transit,
      placements: [...stationPlacements, ...metroStations, ...busStops, ...harbours],
      tracks, lines: [...railLines, ...metroLines, ...busLines, ...ferryLines],
      seaGates: citySeaGates(g),
    },
    { id: 'city-roads', name: 'Roads', blurb: city.words.roads, classRoads, junctions, streets },
  ];
  const out = { sections, plan, grid: g, problems };
  BUILT.set(city.id, out);
  return out;
}

/** The camera on the whole city from high up (the welcome stop), when a city names none of its own. */
export function cityView(city: CityDemo): Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'> {
  const [x, y, w, h] = city.rect;
  return { focus: [x + w / 2, y + h / 2], dist: Math.max(w, h) * 1.05, yaw: 0, pitch: 1.1 };
}
