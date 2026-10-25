import type { DemoRect, DemoXY } from './showcase';
import type { Placed } from '../structures';
import { hash2 } from '../noise';
import { BRIDGE_MAX_SPAN } from '../bridges';
import { twinRow } from '../roadclass';
import type { SeaGate } from '../waterways';
import { AVENUE_MIN, LT, RM, STREETS, staircase, type Character, type GeoBox } from './londonMap';

/**
 * The city-map kit (docs/demo.md "Sample cities and the city-map kit"): a sample city as data (`CityMap`) and the
 * pipeline that turns it into a street plan, generalised from London's (londonMap.ts) without touching London's own
 * code path. A city is its geography (where the tile grid sits on the globe, the water as river centre lines with
 * widths and as polygons, islands drawn back as land), its places with a character each, its parks, railways, main
 * roads, districts (the parcels' owners) and the scenario on top (landmarks, kinds, lines, tour: citydemo.ts). This
 * file is the map and the streets: `cityBase` (water, parks, railways, land masses), `cityBridges` (each named
 * crossing on the shortest run of water near the real one), `cityRoads` (the avenues' skeleton and the roundabouts'
 * boxes) and `cityPlan` (the streets round the fixed structures). Shared with London: the grain table (`STREETS`),
 * the arterial staircase, the tile legs, the plan's tile codes (`LT`) and marks (`RM`). Deterministic: hashes only.
 */

export type LatLon = readonly [lat: number, lon: number];

/**
 * Where the tile grid sits: (lat, lon) is tile `at` (default (0, 0)), `scale` tiles a kilometre, x east and y south.
 * `rotate`: the compass bearing (degrees) that points up the map, for a city whose street grid is not north-up
 * (Manhattan's avenues run about 29° east of north). `squeeze`: longitude bands drawn narrower than life (a bay too
 * wide to bridge at this scale), each distance east-west inside [lon0, lon1] times `factor`.
 */
export interface CityGeo { lat: number; lon: number; scale: number; at?: DemoXY; rotate?: number; squeeze?: readonly { lon0: number; lon1: number; factor: number }[] }

/** A point on a river's centre line: latitude, longitude, width in tiles. */
export type RiverPoint = readonly [lat: number, lon: number, width: number];
export interface CityRiver { name: string; pts: readonly RiverPoint[] }
/** A body of water (sea, bay, lake, harbour) or, in `lands`, dry land drawn back over the water (an island). */
export interface CityPoly { name: string; poly: readonly LatLon[] }

/**
 * A named crossing: a road bridge over the shortest run of water along a row or column near `at` (a little dearer the
 * further it strays), with dry land at both ends; `ns` forces the direction (a deck running north-south), `style` the
 * bridge's style, `landmark` the catalogue landmark its span is drawn as (Tower Bridge's way: the span counts as that
 * landmark placed).
 */
export interface CityBridge { name: string; at: LatLon; ns?: boolean; style: 'Arch' | 'Girder' | 'Suspension' | 'Bascule'; landmark?: string; /** the longest run of water it may span (default the road tool's longest) */ max?: number }

/** A named place: latitude, longitude, the character of the blocks nearest it and its reach (a bigger reach claims more). */
export interface CityPlace {
  name: string; at: LatLon; c: Character; reach?: number;
  /** lay a regular grid of streets here (Manhattan), not London's staggered blocks */ grid?: boolean;
  /** every block nearest it is homes, with no services (an island's own people: Alcatraz's guards' families) */ homes?: boolean;
}
export interface CityPark { name: string; box?: GeoBox; poly?: readonly LatLon[]; heath?: boolean }
/** A main road: `label` is the street name its avenue runs take (the tooltip's and the street panel's), where it has one name. */
export interface CityArterial { name: string; pts: readonly LatLon[]; side?: 1 | -1; street?: true; label?: string }
/** A district: the parcels' owner (a player `sys:<id>`), its outline in latitude and longitude. */
export interface CityDistrict { id: string; name: string; colour: number; poly?: readonly LatLon[]; /** the outline in map tiles instead (a rotated map: a Manhattan district between two streets) */ tiles?: readonly DemoXY[]; /** it holds only the land mass of this point (an island's districts, not the shore across the river) */ on?: LatLon;
  /** its owner has every technology but Steel frame and High-rise, so its lots grow no taller than level 2 (Paris's Haussmann blocks) */
  lowRise?: true }
export interface CityRoundabout { id: string; name: string; at: LatLon; blurb: string }

/** A railway: the corridor's waypoints (each leg on the tile grid along its longer axis first, then across). */
export interface CityRail { id: string; name: string; pts: readonly LatLon[] }

/**
 * The whole map: everything but the scenario. `rect` is the map in tiles (x, y, width, height), all of it the
 * districts' land; `margin` a ring of plain country round it, the water running on out of it to the sea gates.
 */
export interface CityMapData {
  geo: CityGeo;
  rect: DemoRect;
  margin: number;
  rivers?: readonly CityRiver[];
  waters?: readonly CityPoly[];
  lands?: readonly CityPoly[];
  bridges?: readonly CityBridge[];
  places: readonly CityPlace[];
  parks?: readonly CityPark[];
  rails?: readonly CityRail[];
  arterials?: readonly CityArterial[];
  roundabouts?: readonly CityRoundabout[];
  districts: readonly CityDistrict[];
  /** where the water leaves the margin, each the margin-edge water tile nearest `at`; `low` an upper river */
  seaGates?: readonly { name: string; at: LatLon; low?: boolean }[];
  /**
   * The tallest level a merged building is seeded at, per character (default the London tables': towers to level 7 in
   * the City): Paris keeps its towers to La Défense and its centre to Haussmann's six storeys
   */
  heights?: Partial<Record<Character, number>>;
  /**
   * The tallest level a 1×1 lot is seeded at, per zone, outside the 'city' character (a level-3 office is a tower):
   * Paris's offices at level 1 and its shops at 2 (the mansard shop with flats above), its homes at 3
   */
  lotLevels?: Partial<Record<'residential' | 'commercial' | 'office' | 'industrial', number>>;
  /** the zone shares of a character's blocks (residential, commercial, office, industrial), in place of London's */
  mix?: Partial<Record<Character, readonly [number, number, number, number]>>;
}

// ---------------------------------------------------------------- the kit's context for one map

const DIRS: readonly [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const pick = (r: readonly [number, number], h: number) => r[0] + Math.floor(h * (r[1] - r[0] + 1));
/** Is (px, py) inside the polygon (ray casting)? */
export function inPolygon(pts: readonly (readonly [number, number])[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The grid of one map: its rect, indexing and geography. */
export class CityGrid {
  readonly MX: number; readonly MY: number; readonly MW: number; readonly MH: number; readonly N: number;
  constructor(readonly map: CityMapData) {
    [this.MX, this.MY, this.MW, this.MH] = map.rect;
    this.N = this.MW * this.MH;
  }
  inMap = (x: number, y: number) => x >= this.MX && y >= this.MY && x < this.MX + this.MW && y < this.MY + this.MH;
  idx = (x: number, y: number) => (y - this.MY) * this.MW + (x - this.MX);
  tx = (i: number) => this.MX + (i % this.MW);
  ty = (i: number) => this.MY + Math.floor(i / this.MW);
  /** Game coordinates (fractional) of a latitude and longitude. */
  geoF = (lat: number, lon: number): [number, number] => {
    const g = this.map.geo;
    let d = lon - g.lon;
    for (const s of g.squeeze ?? []) {
      const lo = Math.min(g.lon, lon), hi = Math.max(g.lon, lon), over = Math.max(0, Math.min(hi, s.lon1) - Math.max(lo, s.lon0));
      d -= Math.sign(lon - g.lon) * over * (1 - s.factor);
    }
    let x = d * 111.32 * Math.cos((g.lat * Math.PI) / 180) * g.scale, y = -(lat - g.lat) * 111.2 * g.scale;
    if (g.rotate) { const a = (-g.rotate * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); [x, y] = [x * c - y * s, x * s + y * c]; }
    return [x + (g.at?.[0] ?? 0), y + (g.at?.[1] ?? 0)];
  };
  /** Game tile of a latitude and longitude. */
  geo = (lat: number, lon: number): DemoXY => { const [x, y] = this.geoF(lat, lon); return [Math.round(x), Math.round(y)]; };
  polyXY = (poly: readonly LatLon[]) => poly.map(([lat, lon]) => this.geoF(lat, lon));
}

// ---------------------------------------------------------------- water

/** A river's centre line, Catmull-Rom through its points, with a width at every vertex. */
function riverLine(g: CityGrid, r: CityRiver): { x: number; y: number; w: number }[] {
  const p = r.pts.map(([lat, lon, w]) => { const [x, y] = g.geoF(lat, lon); return { x, y, w }; });
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
  return out;
}

/**
 * Every tile inside [x0, x1) × [y0, y1) that is water: within half a river's width of its centre line, or inside a
 * water polygon, and not inside a land polygon (an island). `visit` once per wet tile.
 */
export function eachWaterTile(g: CityGrid, x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => void) {
  const W = x1 - x0, H = y1 - y0, wet = new Uint8Array(W * H);
  for (const r of g.map.rivers ?? []) {
    const line = riverLine(g, r);
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const rr = Math.max(a.w, b.w) / 2 + 1;
      const sx0 = Math.max(x0, Math.floor(Math.min(a.x, b.x) - rr)), sx1 = Math.min(x1 - 1, Math.ceil(Math.max(a.x, b.x) + rr));
      const sy0 = Math.max(y0, Math.floor(Math.min(a.y, b.y) - rr)), sy1 = Math.min(y1 - 1, Math.ceil(Math.max(a.y, b.y) + rr));
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
      for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
        if (Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t)) <= (a.w + (b.w - a.w) * t) / 2) wet[(y - y0) * W + x - x0] = 1;
      }
    }
  }
  const fill = (polys: readonly CityPoly[] | undefined, v: number) => {
    for (const p of polys ?? []) {
      const pts = g.polyXY(p.poly);
      const bx0 = Math.max(x0, Math.floor(Math.min(...pts.map((q) => q[0])))), bx1 = Math.min(x1 - 1, Math.ceil(Math.max(...pts.map((q) => q[0]))));
      const by0 = Math.max(y0, Math.floor(Math.min(...pts.map((q) => q[1])))), by1 = Math.min(y1 - 1, Math.ceil(Math.max(...pts.map((q) => q[1]))));
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (inPolygon(pts, x + 0.5, y + 0.5)) wet[(y - y0) * W + x - x0] = v;
    }
  };
  fill(g.map.waters, 1);
  fill(g.map.lands, 0);
  for (let i = 0; i < W * H; i++) if (wet[i]) visit(x0 + (i % W), y0 + Math.floor(i / W));
}

/** Where the water leaves the margin round the map: each gate the margin-edge water tile nearest its place. */
export function citySeaGates(g: CityGrid): SeaGate[] {
  const M = g.map.margin, x0 = g.MX - M, y0 = g.MY - M, x1 = g.MX + g.MW + M - 1, y1 = g.MY + g.MH + M - 1;
  const edge: [number, number][] = [];
  eachWaterTile(g, x0, y0, x1 + 1, y1 + 1, (x, y) => { if (x === x0 || x === x1 || y === y0 || y === y1) edge.push([x, y]); });
  return (g.map.seaGates ?? []).flatMap((s) => {
    const [px, py] = g.geoF(s.at[0], s.at[1]);
    let best: [number, number] | null = null, bd = Infinity;
    for (const [x, y] of edge) { const d = Math.hypot(x + 0.5 - px, y + 0.5 - py); if (d < bd) { bd = d; best = [x, y]; } }
    return best ? [{ x: best[0], y: best[1], name: s.name, ...(s.low ? { low: true } : {}) }] : [];
  });
}

// ---------------------------------------------------------------- the base: water, parks, railways, land masses

export interface CityBase {
  /** 1 on water */
  water: Uint8Array;
  /** parks index per tile, -1 for none */
  park: Int16Array;
  /** rails index per tile, -1 for none */
  rail: Int16Array;
  /** per rail tile: 1 the line runs along x here, 2 along y, 3 a corner or an end (no road may cross) */
  railAxis: Uint8Array;
  /** each railway's tiles in order */
  railPaths: [number, number][][];
  /** the land mass (4-connected dry land) per tile, 1 up; 0 on water */
  mass: Int32Array;
}

/** A railway's tiles: each leg along its longer axis first, then across (as the track tool drags). */
export function railPath(g: CityGrid, r: CityRail): [number, number][] {
  const pts = r.pts.map(([lat, lon]) => g.geo(lat, lon));
  const out: [number, number][] = [[pts[0][0], pts[0][1]]];
  for (let k = 1; k < pts.length; k++) {
    let [x, y] = out[out.length - 1];
    const [ex, ey] = pts[k], xFirst = Math.abs(ex - x) >= Math.abs(ey - y);
    while (x !== ex || y !== ey) {
      if (xFirst ? x !== ex : y === ey) x += Math.sign(ex - x); else y += Math.sign(ey - y);
      out.push([x, y]);
    }
  }
  return out;
}
/** The corners of a railway's path (its drags' ends): first, every turn, last. */
export function railCorners(path: readonly (readonly [number, number])[]): DemoXY[] {
  const out: DemoXY[] = [path[0]];
  for (let k = 1; k + 1 < path.length; k++) {
    const [ax, ay] = path[k - 1], [bx, by] = path[k], [cx, cy] = path[k + 1];
    if (bx - ax !== cx - bx || by - ay !== cy - by) out.push(path[k]);
  }
  out.push(path[path.length - 1]);
  return out;
}

export function cityBase(g: CityGrid): CityBase {
  const { N } = g;
  const water = new Uint8Array(N), park = new Int16Array(N).fill(-1), rail = new Int16Array(N).fill(-1), railAxis = new Uint8Array(N);
  eachWaterTile(g, g.MX, g.MY, g.MX + g.MW, g.MY + g.MH, (x, y) => { water[g.idx(x, y)] = 1; });
  const railPaths = (g.map.rails ?? []).map((r) => railPath(g, r));
  railPaths.forEach((path, n) => path.forEach(([x, y], k) => {
    if (!g.inMap(x, y)) return;
    const i = g.idx(x, y), p = path[k - 1], q = path[k + 1];
    rail[i] = n;
    railAxis[i] = !p || !q ? 3 : p[1] === y && q[1] === y ? 1 : p[0] === x && q[0] === x ? 2 : 3;
  }));
  (g.map.parks ?? []).forEach((p, n) => {
    const box = p.box, poly = p.poly ? g.polyXY(p.poly) : null;
    const [bx0, by0] = box ? g.geoF(box[0], box[1]) : [Math.min(...poly!.map((q) => q[0])), Math.min(...poly!.map((q) => q[1]))];
    const [bx1, by1] = box ? g.geoF(box[2], box[3]) : [Math.max(...poly!.map((q) => q[0])), Math.max(...poly!.map((q) => q[1]))];
    for (let y = Math.floor(Math.min(by0, by1)); y <= Math.ceil(Math.max(by0, by1)); y++) for (let x = Math.floor(Math.min(bx0, bx1)); x <= Math.ceil(Math.max(bx0, bx1)); x++) {
      if (!g.inMap(x, y)) continue;
      const cx = x + 0.5, cy = y + 0.5;
      if (poly ? !inPolygon(poly, cx, cy) : cx < Math.min(bx0, bx1) || cx > Math.max(bx0, bx1) || cy < Math.min(by0, by1) || cy > Math.max(by0, by1)) continue;
      const i = g.idx(x, y);
      if (!water[i] && rail[i] < 0) park[i] = n;
    }
  });
  // the land masses: 4-connected dry land (the banks of a river, an island)
  const mass = new Int32Array(N);
  let m = 0;
  for (let s = 0; s < N; s++) {
    if (water[s] || mass[s]) continue;
    mass[s] = ++m;
    const q = [s];
    for (let k = 0; k < q.length; k++) {
      const x = g.tx(q[k]), y = g.ty(q[k]);
      for (const [dx, dy] of DIRS) { if (!g.inMap(x + dx, y + dy)) continue; const j = g.idx(x + dx, y + dy); if (!water[j] && !mass[j]) { mass[j] = m; q.push(j); } }
    }
  }
  return { water, park, rail, railAxis, railPaths, mass };
}

/** The places as game coordinates, and the place nearest a point (distance over reach). */
export function cityPlaces(g: CityGrid) {
  const xy = g.map.places.map((p) => { const [x, y] = g.geoF(p.at[0], p.at[1]); return { name: p.name, x, y, c: p.c, reach: p.reach ?? 1, grid: !!p.grid, homes: !!p.homes }; });
  const placeAt = (x: number, y: number) => {
    let best = xy[0], bd = Infinity;
    for (const p of xy) { const d = Math.hypot(p.x - x, p.y - y) / p.reach; if (d < bd) { bd = d; best = p; } }
    return best;
  };
  return { xy, placeAt };
}

// ---------------------------------------------------------------- bridges

/** A bridge of the plan: its first deck tile and length, east along a row or south down a column (`ns`). */
export interface CityPlanBridge { name: string; x: number; y: number; len: number; ns: boolean; spec: CityBridge }

/**
 * The bridges: each named crossing on the shortest run of water along a row or column near the real one (a little
 * dearer the further it strays), with dry land at both ends that is not a park or a railway, and a tile clear of the
 * bridges already chosen. Chosen from the water alone, so the scenario can keep its structures off the landings.
 */
export function cityBridges(g: CityGrid, base: CityBase): { bridges: CityPlanBridge[]; problems: string[] } {
  const { water, park, rail } = base;
  const out: CityPlanBridge[] = [], problems: string[] = [];
  const near = new Uint8Array(g.N);
  const land = (x: number, y: number) => g.inMap(x, y) && !water[g.idx(x, y)] && park[g.idx(x, y)] < 0 && rail[g.idx(x, y)] < 0 && !near[g.idx(x, y)];
  for (const spec of g.map.bridges ?? []) {
    const [cx, cy] = g.geoF(spec.at[0], spec.at[1]), max = Math.min(BRIDGE_MAX_SPAN, spec.max ?? BRIDGE_MAX_SPAN);
    let best: CityPlanBridge | null = null, bestScore = Infinity;
    for (const ns of spec.ns === undefined ? [true, false] : [spec.ns]) for (let off = -4; off <= 4; off++) {
      const line = Math.round((ns ? cx : cy) - 0.5) + off, along = ns ? cy : cx;
      const wet = (s: number) => { const x = ns ? line : s, y = ns ? s : line; return g.inMap(x, y) && water[g.idx(x, y)] === 1 && !near[g.idx(x, y)]; };
      let s0 = NaN;
      for (let d = 0; d <= 6 && Number.isNaN(s0); d++) for (const s of [Math.floor(along) - d, Math.floor(along) + d]) if (wet(s)) { s0 = s; break; }
      if (Number.isNaN(s0)) continue;
      let a = s0, b = s0;
      while (b - a < 20 && wet(a - 1)) a--;
      while (b - a < 20 && wet(b + 1)) b++;
      const len = b - a + 1;
      if (len > max) continue;
      if (!(ns ? land(line, a - 1) && land(line, b + 1) : land(a - 1, line) && land(b + 1, line))) continue;
      const score = len + 1.2 * Math.abs(line + 0.5 - (ns ? cx : cy)) + 0.4 * Math.abs((a + b) / 2 + 0.5 - along);
      if (score < bestScore) { bestScore = score; best = { name: spec.name, x: ns ? line : a, y: ns ? a : line, len, ns, spec }; }
    }
    if (!best) { problems.push(`${spec.name}: no run of water of ${max} tiles or less to bridge near it`); continue; }
    out.push(best);
    const dx = best.ns ? 0 : 1, dy = best.ns ? 1 : 0;
    for (let k = -1; k <= best.len; k++) for (let s = -2; s <= 2; s++) for (let u = -1; u <= 1; u++) {
      const qx = best.x + dx * k + dy * s + dx * u, qy = best.y + dy * k + dx * s + dy * u;
      if (g.inMap(qx, qy)) near[g.idx(qx, qy)] = 1;
    }
  }
  return { bridges: out, problems };
}

// ---------------------------------------------------------------- the main roads' skeleton (R3, R4)

export interface CityRoundaboutPlan { id: string; name: string; blurb: string; /** the junction group's anchor (min corner) */ group: DemoXY; /** the 5×5 box */ box: DemoRect }
export interface CityRoads {
  /** each arterial's tiles in drag order (its twin row on the drag's left, twinRow) */
  drags: [number, number][][];
  roundabouts: CityRoundaboutPlan[];
  /** RM per tile, 0 for nothing */
  mark: Uint8Array;
  problems: string[];
}

/** The arterials' tiles (staircases through their waypoints), for the scenario to keep its structures off. */
export function cityArterialPaths(g: CityGrid): [number, number][][] {
  return (g.map.arterials ?? []).map((a) => staircase(a.pts.map(([lat, lon]) => g.geo(lat, lon))));
}

/**
 * The road classes' skeleton, worked out from the water, the railways and the fixed placements (the stations) before
 * any landmark is fitted: each arterial's drag, oriented so its twin row has the most room, the twin rows and outer
 * kerbs marked, and the roundabouts' boxes (London's londonRoads without the motorways).
 */
export function cityRoads(g: CityGrid, base: CityBase, bridges: readonly CityPlanBridge[], fixed: readonly Placed[]): CityRoads {
  const { water, park, rail } = base, { N } = g, arts = g.map.arterials ?? [];
  const problems: string[] = [];
  const mark = new Uint8Array(N);
  const hard = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (water[i] || rail[i] >= 0) hard[i] = 1;
  for (const k of fixed) for (let y = k.ay; y < k.ay + k.h; y++) for (let x = k.ax; x < k.ax + k.w; x++) if (g.inMap(x, y)) hard[g.idx(x, y)] = 1;
  for (const b of bridges) {
    const dx = b.ns ? 0 : 1, dy = b.ns ? 1 : 0;
    for (let k = -1; k <= b.len; k++) for (let s = -1; s <= 1; s++) {
      const x = b.x + dx * k + dy * s, y = b.y + dy * k + dx * s;
      if (g.inMap(x, y) && (s !== 0 || (k >= 0 && k < b.len))) hard[g.idx(x, y)] = 1;
    }
  }
  const free = (x: number, y: number) => g.inMap(x, y) && !hard[g.idx(x, y)];
  const drags = cityArterialPaths(g).map((path, n) => {
    if (arts[n].street) return path;
    const cost = (p: [number, number][]) => twinRow(p).reduce((s, t) => s + (!free(t.x, t.y) ? 1 : park[g.idx(t.x, t.y)] >= 0 ? 0.5 : 0), 0);
    const side = arts[n].side ?? (cost([...path].reverse()) < cost(path) ? -1 : 1);
    return side === 1 ? path : [...path].reverse();
  });
  const arterialTiles = new Set<number>();
  const twinsOf = (n: number) => (arts[n].street ? [] : twinRow(drags[n]));
  drags.forEach((d, n) => { for (const [x, y] of d) if (g.inMap(x, y)) arterialTiles.add(g.idx(x, y)); for (const t of twinsOf(n)) if (g.inMap(t.x, t.y)) arterialTiles.add(g.idx(t.x, t.y)); });
  drags.forEach((d, n) => { for (const t of twinsOf(n)) {
    if (!free(t.x, t.y)) continue;
    const i = g.idx(t.x, t.y);
    if (!mark[i]) mark[i] = RM.Twin;
    const [px, py] = d[t.from];
    for (const [ox, oy] of [[2 * t.x - px, 2 * t.y - py], [2 * px - t.x, 2 * py - t.y]]) {
      if (!g.inMap(ox, oy) || arterialTiles.has(g.idx(ox, oy))) continue;
      if (!mark[g.idx(ox, oy)]) mark[g.idx(ox, oy)] = RM.NoFront;
    }
  } });
  // the roundabouts: on the avenue junction nearest each place, its 5×5 box clear but for the avenues through it and
  // a frame round it with no road but their arms
  const dragsAt = new Map<number, Set<number>>();
  drags.forEach((d, n) => {
    for (const [x, y] of [...d, ...twinsOf(n).map((q): [number, number] => [q.x, q.y])]) {
      if (!g.inMap(x, y)) continue;
      const i = g.idx(x, y);
      if (!dragsAt.has(i)) dragsAt.set(i, new Set());
      dragsAt.get(i)!.add(n);
    }
  });
  const av = (x: number, y: number) => g.inMap(x, y) && dragsAt.has(g.idx(x, y));
  const bend = new Uint8Array(N);
  for (const d of drags) for (let k = 1; k + 1 < d.length; k++) {
    const [ax, ay] = d[k - 1], [bx, by] = d[k], [cx, cy] = d[k + 1];
    if ((bx - ax !== cx - bx || by - ay !== cy - by) && g.inMap(bx, by)) bend[g.idx(bx, by)] = 1;
  }
  const junction = (x: number, y: number) => {
    if (!av(x, y) || !av(x + 1, y) || !av(x, y + 1) || !av(x + 1, y + 1)) return false;
    const arms = [[[x, y - 1], [x + 1, y - 1]], [[x, y + 2], [x + 1, y + 2]], [[x - 1, y], [x - 1, y + 1]], [[x + 2, y], [x + 2, y + 1]]];
    return arms.filter((a) => a.every(([qx, qy]) => av(qx, qy))).length >= 3;
  };
  const roundabouts: CityRoundaboutPlan[] = [];
  for (const r of g.map.roundabouts ?? []) {
    const [px, py] = g.geoF(r.at[0], r.at[1]);
    let best: DemoXY | null = null, bd = Infinity;
    for (let y = Math.floor(py) - 12; y <= Math.floor(py) + 12; y++) for (let x = Math.floor(px) - 12; x <= Math.floor(px) + 12; x++) {
      if (!junction(x, y)) continue;
      const mine = new Set<number>();
      for (const [qx, qy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) for (const n of dragsAt.get(g.idx(qx, qy)) ?? []) mine.add(n);
      let ok = true;
      for (let qy = y - 3; qy <= y + 3 && ok; qy++) for (let qx = x - 3; qx <= x + 3 && ok; qx++) {
        if (!g.inMap(qx, qy)) { ok = false; break; }
        const i = g.idx(qx, qy);
        ok = free(qx, qy) && !bend[i] && mark[i] !== RM.Clear && mark[i] !== RM.Frame && [...(dragsAt.get(i) ?? [])].every((n) => mine.has(n));
      }
      if (!ok) continue;
      const d = Math.hypot(x + 1 - px, y + 1 - py);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) { problems.push(`${r.name}: no avenue crossing near it with room for a 5×5 roundabout`); continue; }
    const box: DemoRect = [best[0] - 2, best[1] - 2, 5, 5];
    for (let qy = box[1] - 1; qy <= box[1] + 5; qy++) for (let qx = box[0] - 1; qx <= box[0] + 5; qx++) {
      if (!g.inMap(qx, qy)) continue;
      const i = g.idx(qx, qy), inBox = qx >= box[0] && qy >= box[1] && qx < box[0] + 5 && qy < box[1] + 5;
      if (arterialTiles.has(i)) continue;
      mark[i] = inBox ? RM.Clear : RM.Frame;
    }
    roundabouts.push({ id: r.id, name: r.name, blurb: r.blurb, group: best, box });
  }
  return { drags, roundabouts, mark, problems };
}

// ---------------------------------------------------------------- the streets

export interface CityBlock { x0: number; y0: number; x1: number; y1: number; n: number; cx: number; cy: number }
export interface CityPlan {
  /** LT code per tile */
  t: Uint8Array;
  /** parks index per tile still green, -1 elsewhere */
  park: Int16Array;
  bridges: CityPlanBridge[];
  /** per land tile: 1 frontage, 2 deep (behind a frontage lot, in line with its road), 0 no road reaches */
  reach: Uint8Array;
  /** block index per land tile, -1 elsewhere */
  block: Int32Array;
  blocks: CityBlock[];
  /** 1 on the main roads (arterials, park rings, fronts, bridge approaches, links) */
  main: Uint8Array;
  /** 1 on a road tile on a loop of the network */
  loop: Uint8Array;
  crossings: number;
  /** the arterials' runs laid as avenues, with the street name each takes */
  avenues: { name: string; label?: string; path: [number, number][] }[];
  roundabouts: CityRoundaboutPlan[];
  /** per road tile: 3 an avenue's, 0 a street */
  cls: Uint8Array;
  /** per divided road tile on a straight: the tile across the reservation, -1 elsewhere */
  twin: Int32Array;
  problems: string[];
}

/**
 * Lay the city's streets round the structures the scenario places (`keeps`), as londonPlan lays London's: the
 * bridges and their landings; the main roads (arterials, a road along every structure's front, round every park,
 * each bridge's approach); the avenues' twin rows; then each cell of land left is split by through roads and filled
 * with streets of its place's grain (staggered blocks, or a regular grid where the place says `grid`); pockets get
 * cul-de-sacs, every road joins its land mass's network (an island keeps a network of its own), short spurs go.
 */
export function cityPlan(g: CityGrid, base: CityBase, bridges: CityPlanBridge[], keeps: readonly Placed[], roads: CityRoads): CityPlan {
  const { water, park: basePark, rail, railAxis, railPaths, mass } = base, { N, inMap, idx, tx, ty } = g;
  const { placeAt } = cityPlaces(g);
  const arts = g.map.arterials ?? [];
  const problems: string[] = [...roads.problems];
  const t = new Uint8Array(N), park = new Int16Array(basePark);
  for (let i = 0; i < N; i++) t[i] = water[i] ? LT.Water : rail[i] >= 0 ? LT.Rail : park[i] >= 0 ? LT.Park : LT.Land;
  for (const k of keeps) for (let y = k.ay; y < k.ay + k.h; y++) for (let x = k.ax; x < k.ax + k.w; x++) {
    if (!inMap(x, y)) { problems.push(`a placement at (${k.ax}, ${k.ay}) runs off the map`); continue; }
    const i = idx(x, y);
    if (t[i] !== LT.Land && t[i] !== LT.Park) problems.push(`a placement at (${k.ax}, ${k.ay}) covers ${t[i] === LT.Water ? 'water' : 'a railway'} at (${x}, ${y})`);
    t[i] = LT.Keep; park[i] = -1;
  }
  const noRoad = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const m = roads.mark[i];
    if (m === RM.Clear) { noRoad[i] = 1; if (t[i] === LT.Land || t[i] === LT.Park) { t[i] = LT.Keep; park[i] = -1; } }
    else if (m === RM.Frame) noRoad[i] = 1;
  }
  const free = (i: number) => (t[i] === LT.Land || t[i] === LT.Park) && !noRoad[i];
  const major = new Uint8Array(N);
  const put = (i: number) => { if (t[i] === LT.Land && !noRoad[i]) { t[i] = LT.Road; major[i] = 1; } return t[i] === LT.Road || t[i] === LT.Crossing; };
  const isRoadT = (v: number) => v === LT.Road || v === LT.Crossing || v === LT.Deck;
  const roadAt = (x: number, y: number) => inMap(x, y) && isRoadT(t[idx(x, y)]);
  const landAt = (x: number, y: number) => inMap(x, y) && t[idx(x, y)] === LT.Land;
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

  // 1. bridges: decks over the water, a road landing at each end, no road beside a deck
  for (const b of bridges) {
    const dx = b.ns ? 0 : 1, dy = b.ns ? 1 : 0;
    for (let k = -1; k <= b.len; k++) {
      const x = b.x + dx * k, y = b.y + dy * k, i = idx(x, y);
      if (k < 0 || k === b.len) {
        if (t[i] !== LT.Land && t[i] !== LT.Road) problems.push(`${b.name}: its landing at (${x}, ${y}) is taken`);
        else { t[i] = LT.Road; major[i] = 1; }
        continue;
      }
      t[i] = LT.Deck;
      for (const s of [-1, 1]) { const qx = x + dy * s, qy = y + dx * s; if (inMap(qx, qy) && t[idx(qx, qy)] !== LT.Water) noRoad[idx(qx, qy)] = 1; }
    }
  }

  // 2. the main roads: every structure's front, the arterials, the avenues' twin rows, round the parks, the approaches
  for (const k of keeps) {
    const [fx, fy] = DIRS[k.r];
    const span = fx ? k.h : k.w;
    for (let s = 0; s < span; s++) {
      const x = fx ? (fx > 0 ? k.ax + k.w : k.ax - 1) : k.ax + s, y = fy ? (fy > 0 ? k.ay + k.h : k.ay - 1) : k.ay + s;
      if (!inMap(x, y)) continue;
      const i = idx(x, y);
      if (t[i] === LT.Park) { t[i] = LT.Land; park[i] = -1; }
      put(i);
    }
    if (!roadAt(k.frontX, k.frontY)) problems.push(`no road can reach the front of the placement at (${k.doorX}, ${k.doorY})`);
  }
  let crossings = 0;
  /** a railway tile a road may cross at right angles going (dx, dy): a straight stretch, no structure or crossing beside it */
  const crossable = (x: number, y: number, dx: number, dy: number) => {
    if (!inMap(x, y) || t[idx(x, y)] !== LT.Rail) return false;
    const ax = railAxis[idx(x, y)];
    if (ax === 3 || (ax === 1 ? dx !== 0 : dy !== 0)) return false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!inMap(x + ox, y + oy)) return false;
      const v = t[idx(x + ox, y + oy)];
      if (v === LT.Keep || v === LT.Crossing) return false;
    }
    const bx = x + dx, by = y + dy, ax2 = x - dx, ay2 = y - dy;
    return inMap(ax2, ay2) && inMap(bx, by) && [idx(ax2, ay2), idx(bx, by)].every((j) => free(j) || t[j] === LT.Road);
  };
  const paintPath = (path: [number, number][]) => {
    for (let k = 0; k < path.length; k++) {
      const [x, y] = path[k];
      if (!inMap(x, y)) continue;
      const i = idx(x, y);
      if (t[i] === LT.Water) continue; // an arterial stops at the water: the bridges carry the traffic over
      if (t[i] === LT.Rail && k > 0 && k + 1 < path.length) {
        const [px, py] = path[k - 1], [nx, ny] = path[k + 1];
        if (x - px === nx - x && y - py === ny - y && crossable(x, y, x - px, y - py)) { t[i] = LT.Crossing; crossings++; }
        continue;
      }
      put(i);
    }
  };
  for (const path of cityArterialPaths(g)) paintPath(path);
  // the avenues: each arterial's twin row where both rows have room, in runs of AVENUE_MIN tiles or more
  const cls = new Uint8Array(N), twin = new Int32Array(N).fill(-1), axes = new Uint8Array(N);
  const avenues: { name: string; label?: string; path: [number, number][] }[] = [];
  const pave = (i: number) => { if (t[i] === LT.Park) { t[i] = LT.Land; park[i] = -1; } if (t[i] === LT.Land || t[i] === LT.Keep) t[i] = LT.Road; major[i] = 1; };
  const pairUp = (path: readonly (readonly [number, number])[], tw: { x: number; y: number; from: number }[]) => {
    const n = new Map<number, number>();
    for (const q of tw) n.set(q.from, (n.get(q.from) ?? 0) + 1);
    for (const q of tw) if (n.get(q.from) === 1) { const a = idx(path[q.from][0], path[q.from][1]), b = idx(q.x, q.y); twin[a] = b; twin[b] = a; }
  };
  roads.drags.forEach((d, n) => {
    if (arts[n].street) return;
    const axisAt = (k: number) => {
      const [x, y] = d[k], p = d[k - 1], q = d[k + 1];
      let a = 0;
      for (const o of [p, q]) if (o) a |= o[1] === y ? 1 : o[0] === x ? 2 : 0;
      return a;
    };
    const twinOk = (x: number, y: number, dir: number) => {
      if (!inMap(x, y)) return false;
      const i = idx(x, y);
      if (axes[i] & (dir < 2 ? 1 : 2)) return false;
      return t[i] === LT.Road || ((t[i] === LT.Land || t[i] === LT.Park) && !noRoad[i]);
    };
    const pathOk = (k: number) => {
      const [x, y] = d[k];
      if (!inMap(x, y)) return false;
      const i = idx(x, y);
      return t[i] === LT.Road && !(axes[i] & axisAt(k));
    };
    const bad = new Uint8Array(d.length);
    for (let k = 0; k < d.length; k++) if (!pathOk(k)) bad[k] = 1;
    for (const q of twinRow(d)) if (!twinOk(q.x, q.y, q.dir)) bad[q.from] = 1;
    for (let again = true; again;) {
      again = false;
      for (let a = 0; a < d.length; a++) {
        if (bad[a]) continue;
        let b = a;
        while (b + 1 < d.length && !bad[b + 1]) b++;
        if (b - a + 1 >= AVENUE_MIN) for (const q of twinRow(d.slice(a, b + 1))) if (!twinOk(q.x, q.y, q.dir)) { bad[a + q.from] = 1; again = true; }
        a = b;
      }
    }
    for (let a = 0; a < d.length; a++) {
      if (bad[a]) continue;
      let b = a;
      while (b + 1 < d.length && !bad[b + 1]) b++;
      if (b - a + 1 >= AVENUE_MIN) {
        const run = d.slice(a, b + 1), tw = twinRow(run);
        run.forEach(([x, y], k) => { const i = idx(x, y); cls[i] = 3; axes[i] |= axisAt(a + k); });
        for (const q of tw) { const i = idx(q.x, q.y); pave(i); cls[i] = 3; axes[i] |= q.dir < 2 ? 1 : 2; }
        pairUp(run, tw);
        avenues.push({ name: arts[n].name, label: arts[n].label, path: run });
      }
      a = b;
    }
  });
  for (const r of roads.roundabouts) {
    const [bx, by] = r.box;
    for (let y = by - 1; y <= by + 5; y++) for (let x = bx - 1; x <= bx + 5; x++) {
      if (!inMap(x, y)) continue;
      const i = idx(x, y), inBox = x >= bx && y >= by && x < bx + 5 && y < by + 5;
      if (t[i] === LT.Road) continue;
      noRoad[i] = 1;
      if (inBox && (t[i] === LT.Land || t[i] === LT.Park)) { t[i] = LT.Keep; park[i] = -1; }
    }
  }
  for (let i = 0; i < N; i++) {
    if (t[i] !== LT.Park) continue;
    const x = tx(i), y = ty(i);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (inMap(x + ox, y + oy)) put(idx(x + ox, y + oy));
  }
  for (const b of bridges) for (const end of [-1, b.len]) {
    const sx = b.ns ? 0 : end < 0 ? -1 : 1, sy = b.ns ? (end < 0 ? -1 : 1) : 0;
    let x = b.x + (b.ns ? 0 : end) + sx, y = b.y + (b.ns ? end : 0) + sy;
    for (let n = 0; n < 30 && inMap(x, y) && free(idx(x, y)) && t[idx(x, y)] === LT.Land; n++, x += sx, y += sy) put(idx(x, y));
  }

  // 3. streets in the cells left between the main roads
  const stamp = new Int32Array(N);
  let stampN = 0;
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
          if (!inMap(x + dx, y + dy)) continue;
          const k = idx(x + dx, y + dy);
          if (stamp[k] === id) { stamp[k] = -id; comp.push(k); }
        }
      }
      out.push(comp);
    }
    return out;
  };
  /** the direction the nearest river runs, for streets along the bank */
  const lines = (g.map.rivers ?? []).map((r) => riverLine(g, r));
  const riverTangent = (x: number, y: number): [number, number] => {
    let bl = lines[0], bi = 0, bd = Infinity;
    for (const line of lines) for (let i = 0; i < line.length; i++) { const d = (line[i].x - x) ** 2 + (line[i].y - y) ** 2; if (d < bd) { bd = d; bi = i; bl = line; } }
    if (!bl) return [1, 0];
    const a = bl[Math.max(0, bi - 2)], b = bl[Math.min(bl.length - 1, bi + 2)];
    return [b.x - a.x, b.y - a.y];
  };
  const all: number[] = [];
  for (let i = 0; i < N; i++) if (t[i] === LT.Land) all.push(i);
  const stack = components(all);
  while (stack.length) {
    const cell = stack.pop()!;
    if (cell.length < 4) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (const i of cell) { const x = tx(i), y = ty(i); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; sy += y; }
    const cx = sx / cell.length + 0.5, cy = sy / cell.length + 0.5, place = placeAt(cx, cy), sp = STREETS[place.c];
    const W = x1 - x0 + 1, H = y1 - y0 + 1, seed = Math.floor(hash2(x0 * 97 + y1, y0 * 89 + x1) * 1e6);
    const grid = new Int32Array(W * H).fill(-1);
    for (const i of cell) grid[(ty(i) - y0) * W + tx(i) - x0] = i;
    if (place.grid) {
      // a regular grid, anchored to the map so neighbouring cells line up: streets along the rows `depth` lots apart,
      // avenues down the columns `len` lots apart, every one straight through
      const dy = sp.depth[1] + 1, dx = sp.len[1] + 1;
      for (const i of cell) { const y = ty(i); if (((y % dy) + dy) % dy === 0) minor(i, true); }
      for (const i of cell) { const x = tx(i); if (((x % dx) + dx) % dx === 0) minor(i, false); }
      continue;
    }
    if (Math.max(W, H) > sp.cell) {
      const vertical = W >= H, lo = vertical ? x0 : y0, len = vertical ? W : H;
      const at = lo + Math.round(len * (0.36 + 0.28 * hash2(seed, 3)));
      let painted = 0;
      for (const i of cell) if ((vertical ? tx(i) : ty(i)) === at && minor(i, !vertical)) painted++;
      if (painted) { stack.push(...components(cell)); continue; }
    }
    let rows = W > H || (W === H && hash2(seed, 5) < 0.5);
    if (Math.max(W, H) < 1.5 * Math.min(W, H) && hash2(seed, 7) < 0.25) rows = !rows;
    if (lines.length && cell.some((i) => { const x = tx(i), y = ty(i); return DIRS.some(([dx, dy]) => inMap(x + dx, y + dy) && t[idx(x + dx, y + dy)] === LT.Water); })) {
      const [rx, ry] = riverTangent(cx, cy);
      rows = Math.abs(rx) >= Math.abs(ry);
    }
    const tileAt = (al: number, ac: number) => { const x = rows ? ac : al, y = rows ? al : ac; return x < x0 || x > x1 || y < y0 || y > y1 ? -1 : grid[(y - y0) * W + x - x0]; };
    const [plo, phi] = rows ? [y0, y1] : [x0, x1], [olo, ohi] = rows ? [x0, x1] : [y0, y1];
    const lns: number[] = [];
    for (let k = 0, pos = plo - 1; ; k++) {
      const next = pos + pick(sp.depth, hash2(seed + k * 31, 17)) + 1;
      if (next > phi - sp.depth[0]) break;
      lns.push(next);
      pos = next;
    }
    for (const L of lns) for (let ac = olo; ac <= ohi; ac++) { const i = tileAt(L, ac); if (i >= 0) minor(i, rows); }
    const through: number[] = [];
    for (let p = olo + pick(sp.len, hash2(seed, 23)) + 1, k = 0; p <= ohi - sp.len[0]; k++) {
      through.push(p);
      p += pick(sp.len, hash2(seed + k * 17, 29)) + pick(sp.len, hash2(seed + k * 17, 31)) + 2;
    }
    const bounds = [plo - 1, ...lns, phi + 1];
    for (let s = 0; s + 1 < bounds.length; s++) {
      const a = bounds[s] + 1, b = bounds[s + 1] - 1;
      if (a > b) continue;
      const cross = (p: number, h: number) => {
        const dead = b - a >= 3 && h < sp.dead, from = dead && h < sp.dead / 2 ? a + 1 : a, to = dead && h >= sp.dead / 2 ? b - 1 : b;
        for (let al = from; al <= to; al++) { const i = tileAt(al, p); if (i >= 0) minor(i, !rows); }
      };
      for (const p of through) cross(p, 1);
      let p = olo + 2 + Math.floor(hash2(seed + s * 131, 5) * (sp.len[1] - 1));
      for (let k = 0; p <= ohi - sp.len[0]; k++) {
        if (through.every((q) => Math.abs(q - p) >= sp.len[0])) cross(p, hash2(seed + s * 131 + k * 7, 11));
        p += pick(sp.len, hash2(seed + s * 131 + k * 7, 13)) + 1;
      }
    }
  }
  // a street broken by a gap of one or two lots is joined up
  for (let i = 0; i < N; i++) {
    if (t[i] !== LT.Land || noRoad[i]) continue;
    const x = tx(i), y = ty(i);
    for (const rows of [true, false]) {
      const dx = rows ? 1 : 0, dy = rows ? 0 : 1;
      if (!roadAt(x - dx, y - dy)) continue;
      const gap = roadAt(x + dx, y + dy) ? 1 : landAt(x + dx, y + dy) && roadAt(x + 2 * dx, y + 2 * dy) ? 2 : 0;
      if (!gap || !roadAt(x - 2 * dx, y - 2 * dy) || !roadAt(x + (gap + 1) * dx, y + (gap + 1) * dy)) continue;
      if (minor(i, rows) && gap === 2) minor(idx(x + dx, y + dy), rows);
      break;
    }
  }
  // railways: streets meeting a line from both sides cross it, a few tiles apart, and a long stretch with none gets one
  const crossAt = (x: number, y: number, dx: number, dy: number, both: boolean): boolean => {
    if (!crossable(x, y, dx, dy)) return false;
    const run = (s: number) => {
      for (let d = 1; d <= 6; d++) {
        const fx = x + dx * s * d, fy = y + dy * s * d;
        if (roadAt(fx, fy)) return d;
        if (!landAt(fx, fy) || noRoad[idx(fx, fy)]) return 0;
      }
      return 0;
    };
    const ra = run(-1), rb = run(1);
    if (!ra || !rb || (!both && ra > 1 && rb > 1)) return false;
    for (const [s, r] of [[-1, ra], [1, rb]]) for (let d = 1; d < r; d++) put(idx(x + dx * s * d, y + dy * s * d));
    if (!roadAt(x - dx, y - dy) || !roadAt(x + dx, y + dy)) return false;
    t[idx(x, y)] = LT.Crossing; crossings++;
    for (const [s, r] of [[-1, ra], [1, rb]]) for (let d = 1; d < r; d++) major[idx(x + dx * s * d, y + dy * s * d)] = 1;
    return true;
  };
  for (const path of railPaths) {
    const inside = path.filter(([x, y]) => inMap(x, y)), n = inside.length;
    const isX = (k: number) => t[idx(inside[k][0], inside[k][1])] === LT.Crossing;
    const dirAt = (k: number): [number, number] => (railAxis[idx(inside[k][0], inside[k][1])] === 1 ? [0, 1] : [1, 0]);
    let last = -99;
    for (let k = 1; k < n - 1; k++) {
      if (isX(k)) { last = k; continue; }
      if (k - last >= 4 && crossAt(inside[k][0], inside[k][1], ...dirAt(k), false)) last = k;
    }
    for (let k = 1, prev = 0; k < n; k++) {
      if (!isX(k) && k < n - 1) continue;
      if (k - prev > 8) for (let o = 0; o <= (k - prev) / 2 - 2; o++) {
        const m = Math.floor((prev + k) / 2);
        if ([m + o, m - o].some((j) => j > 0 && j < n - 1 && crossAt(inside[j][0], inside[j][1], ...dirAt(j), true))) break;
      }
      prev = k;
    }
  }

  // 4. reach, cul-de-sacs into pockets, and one network per land mass
  const reach = new Uint8Array(N);
  const computeReach = () => {
    reach.fill(0);
    for (let i = 0; i < N; i++) {
      if (t[i] !== LT.Land) continue;
      const x = tx(i), y = ty(i);
      if (DIRS.some(([dx, dy]) => inMap(x + dx, y + dy) && t[idx(x + dx, y + dy)] === LT.Road)) reach[i] = 1;
    }
    for (let i = 0; i < N; i++) {
      if (t[i] !== LT.Land || reach[i]) continue;
      const x = tx(i), y = ty(i);
      if (DIRS.some(([dx, dy]) => inMap(x + 2 * dx, y + 2 * dy) && t[idx(x + dx, y + dy)] === LT.Land && t[idx(x + 2 * dx, y + 2 * dy)] === LT.Road)) reach[i] = 2;
    }
  };
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
        if (!inMap(x + dx, y + dy)) continue;
        const j = idx(x + dx, y + dy);
        let step: number;
        if (isRoadT(t[j])) step = own(j) ? Infinity : 0.5;
        else if (t[j] === LT.Rail) step = crossable(x + dx, y + dy, dx, dy) && t[i] !== LT.Rail ? 4 : Infinity;
        else if (!free(j)) step = Infinity;
        else step = t[j] === LT.Park ? 4 : 1;
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
  {
    const seenP = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (t[i] !== LT.Land || reach[i] || seenP[i]) continue;
      const pocket = [i];
      seenP[i] = 1;
      for (let q = 0; q < pocket.length; q++) {
        const x = tx(pocket[q]), y = ty(pocket[q]);
        for (const [dx, dy] of DIRS) { if (!inMap(x + dx, y + dy)) continue; const j = idx(x + dx, y + dy); if (!seenP[j] && t[j] === LT.Land && !reach[j]) { seenP[j] = 1; pocket.push(j); } }
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
  // one network per land mass: join every road to its mass's largest network (bridges join the masses), or drop it;
  // the largest network of a mass no bridge reaches (an island) stands on its own
  /** the land mass a road component stands on: its first tile off a bridge deck */
  const massOf = (tiles: number[]) => { for (const j of tiles) if (t[j] !== LT.Deck && mass[j]) return mass[j]; return 0; };
  for (let round = 0; round < 8; round++) {
    const comp = new Int32Array(N).fill(-1), sizes: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!isRoadT(t[i]) || comp[i] >= 0) continue;
      const id = sizes.length, q = [i];
      comp[i] = id;
      for (let k = 0; k < q.length; k++) {
        const x = tx(q[k]), y = ty(q[k]);
        for (const [dx, dy] of DIRS) { if (!inMap(x + dx, y + dy)) continue; const j = idx(x + dx, y + dy); if (comp[j] < 0 && isRoadT(t[j])) { comp[j] = id; q.push(j); } }
      }
      sizes.push(q.length);
    }
    if (sizes.length <= 1) break;
    const members: number[][] = sizes.map(() => []);
    for (let i = 0; i < N; i++) if (comp[i] >= 0) members[comp[i]].push(i);
    // per land mass, the largest network on it (a network spanning masses over a bridge counts on each)
    const best = new Map<number, number>();
    members.forEach((ms, id) => {
      const masses = new Set<number>();
      for (const j of ms) if (t[j] !== LT.Deck && mass[j]) masses.add(mass[j]);
      for (const m of masses) { const b = best.get(m); if (b === undefined || sizes[id] > sizes[b]) best.set(m, id); }
    });
    let joined = 0;
    for (let id = 0; id < sizes.length; id++) {
      const m = massOf(members[id]);
      if (best.get(m) === id) continue;
      const path = link(members[id], (j) => comp[j] === id);
      if (path) { paintLink(path); joined++; continue; }
      if (round < 7) continue;
      for (const j of members[id]) if (t[j] === LT.Road) t[j] = LT.Land;
      problems.push(`a road at (${tx(members[id][0])}, ${ty(members[id][0])}) cannot join the network`);
    }
    if (!joined && round < 7) round = 6; // nothing left to join: the last round drops what cannot be
  }
  for (const k of keeps) {
    const [fx, fy] = DIRS[k.r], span = fx ? k.h : k.w;
    const front: number[] = [];
    for (let s = 0; s < span; s++) {
      const x = fx ? (fx > 0 ? k.ax + k.w : k.ax - 1) : k.ax + s, y = fy ? (fy > 0 ? k.ay + k.h : k.ay - 1) : k.ay + s;
      if (inMap(x, y) && roadAt(x, y)) front.push(idx(x, y));
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
  for (let i = 0; i < N; i++) if (t[i] === LT.Crossing) for (const [dx, dy] of DIRS) if (roadAt(tx(i) + dx, ty(i) + dy)) major[idx(tx(i) + dx, ty(i) + dy)] = 1;
  for (let again = true; again;) {
    again = false;
    const degree = (j: number) => { const x = tx(j), y = ty(j); let n = 0; for (const [dx, dy] of DIRS) if (roadAt(x + dx, y + dy)) n++; return n; };
    for (let i = 0; i < N; i++) {
      if (t[i] !== LT.Road || major[i] || degree(i) !== 1) continue;
      const chain = [i];
      for (let j = i; chain.length <= 3;) {
        const x = tx(j), y = ty(j);
        let next = -1;
        for (const [dx, dy] of DIRS) { if (!roadAt(x + dx, y + dy)) continue; const k = idx(x + dx, y + dy); if (!chain.includes(k)) next = k; }
        if (next < 0 || t[next] !== LT.Road || major[next] || degree(next) !== 2) break;
        chain.push(next);
        j = next;
      }
      if (chain.length > 2) continue;
      for (const j of chain) t[j] = LT.Land;
      again = true;
    }
  }
  for (let i = 0; i < N; i++) {
    if (t[i] !== LT.Crossing) continue;
    const x = tx(i), y = ty(i), ns = roadAt(x, y - 1) && roadAt(x, y + 1), ew = roadAt(x - 1, y) && roadAt(x + 1, y);
    if (!ns && !ew) { t[i] = LT.Rail; crossings--; }
  }
  computeReach();

  const block = new Int32Array(N).fill(-1), blocks: CityBlock[] = [];
  for (let i = 0; i < N; i++) {
    if (t[i] !== LT.Land || block[i] >= 0) continue;
    const id = blocks.length, q = [i];
    block[i] = id;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (let k = 0; k < q.length; k++) {
      const x = tx(q[k]), y = ty(q[k]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; sy += y;
      for (const [dx, dy] of DIRS) { if (!inMap(x + dx, y + dy)) continue; const j = idx(x + dx, y + dy); if (block[j] < 0 && t[j] === LT.Land) { block[j] = id; q.push(j); } }
    }
    blocks.push({ x0, y0, x1, y1, n: q.length, cx: sx / q.length + 0.5, cy: sy / q.length + 0.5 });
  }
  for (const a of avenues) for (const [x, y] of [...a.path, ...twinRow(a.path).map((q): [number, number] => [q.x, q.y])]) if (t[idx(x, y)] !== LT.Road) problems.push(`${a.name}: its avenue at (${x}, ${y}) is not a plain road`);
  return { t, park, bridges, reach, block, blocks, main: major, loop: loopsOf(g, t, isRoadT), crossings, avenues, roundabouts: roads.roundabouts, cls, twin, problems };
}

/** Road tiles on a loop of the network (Tarjan's bridges, iterative): a vehicle there can carry on and come back. */
function loopsOf(g: CityGrid, t: Uint8Array, isRoadT: (v: number) => boolean): Uint8Array {
  const { N } = g;
  const disc = new Int32Array(N).fill(-1), low = new Int32Array(N), parent = new Int32Array(N).fill(-1), next = new Uint8Array(N);
  const cut = new Uint8Array(N);
  const nb = (i: number, d: number) => { const x = g.tx(i) + DIRS[d][0], y = g.ty(i) + DIRS[d][1]; return g.inMap(x, y) && isRoadT(t[g.idx(x, y)]) ? g.idx(x, y) : -1; };
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
      if (p >= 0) { low[p] = Math.min(low[p], low[u]); if (low[u] > disc[p]) { cut[u]++; cut[p]++; } }
    }
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (isRoadT(t[i]) && cut[i] === 0) out[i] = 1;
  return out;
}

