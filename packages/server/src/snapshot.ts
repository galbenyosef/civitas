import { CHUNK_SIZE, u16ToB64, b64ToU16, i32ToB64, b64ToI32, u8ToB64, b64ToU8, chunkKey, tileKey, parseKey, zoneOf, levelOf, isRoad, kindIdOf, Zone, LifeStage, eduDefaults, isPolicyId, type TransitLine, type SeaGate } from '@msimcity/shared';
import { World, emptyProgress, lifeDefaults, type Citizen, type Parcel, type Player, type Site } from './world';
import { LIFE, seededAge, ageOf } from './sim/life';
import { rehire } from './sim/skills';
import { historyOf, type HistoryJSON } from './history';
import type { FireSave } from './sim/fires';

/**
 * v8: the per-chunk under layer (tunnels and platforms, docs/underground.md), stored only where it is not all zero,
 * and station names. v7 worlds upgrade in place: no under bytes (solid ground everywhere), no names.
 * v7: transit lines (bus lines, sim/transit.ts) and the next line id. v6 worlds upgrade in place: no lines.
 * v6: the per-chunk sub layer (kind ids of sub-kinds, docs/sub-kinds.md), stored only where it is not all zero.
 * v5: the per-chunk aux layer (multi-tile structures), stored only for chunks where it is not all zero.
 * v5, v4 (citizen lives) and v3 worlds upgrade in place: no sub or aux means zeros (every tile is its family's
 * base kind, which is what it meant before), lives get defaults.
 */
const VERSION = 8;
/** the format this build writes (store.ts reports it when a world file is too new or too old) */
export const SNAPSHOT_VERSION = VERSION;
const UPGRADES_FROM = [3, 4, 5, 6, 7];
export interface Snapshot {
  version: number;
  seed: number; nextId: number; day: number; tick: number;
  players: Player[];
  parcels: Parcel[];
  citizens: Citizen[];
  sites: Site[];
  chunks: { cx: number; cy: number; tiles: string; parcels: string; aux?: string; sub?: string; under?: string }[];
  /** v7: transit lines in the shared registry (buses) and the next id to give one */
  transitLines?: TransitLine[]; nextLineId?: number;
  /** v8: station names given to stops (World.stopNames), as [x, y, name] */
  stopNames?: [number, number, string][];
  /** city history for the charts (history.ts, docs/charts.md); optional, so saves without it still load and no version bump is needed */
  history?: HistoryJSON;
  /** a scenario's sea gates (World.seaGates, docs/boats.md 2.3); optional, absent in a procedural world */
  seaGates?: SeaGate[];
  /** a frontier start (World.start, home, charter; docs/first-five.md section 0); optional, absent means the Commons */
  start?: 'frontier'; home?: [number, number]; charter?: { x: number; y: number; w: number; h: number };
  /** mothballed services and yards (World.mothballed, sim/finance.ts) as [x, y] doors; optional, absent when there are none */
  mothballed?: [number, number][];
  /** fires burning or in their aftermath, young buildings' ages, each player's warning fire (sim/fires.ts); optional, absent in older saves */
  fires?: FireSave;
}

/**
 * Persistence is a plain JSON snapshot of everything a player has touched.
 * Untouched chunks are not stored: they regenerate identically from the seed.
 * This is deliberately behind one function pair so it can be swapped for
 * Postgres/Redis (or per-region shards) without touching the simulation.
 * These are pure (no Node APIs) so a local-mode worker can keep the same format in IndexedDB (docs/local-mode.md);
 * store.ts has the server's file wrappers, `saveWorld`/`loadWorld`.
 */
export function snapshotOf(w: World): Snapshot {
  return {
    version: VERSION, seed: w.seed, nextId: w.nextId, day: w.day, tick: w.tick,
    players: [...w.players.values()],
    parcels: [...w.parcels.values()],
    citizens: [...w.citizens.values()].map((c) => ({ ...c, path: [], trail: [] })),
    sites: [...w.sites.values()],
    chunks: [...w.chunks.values()].filter((c) => c.modified)
      .map((c) => ({
        cx: c.cx, cy: c.cy, tiles: u16ToB64(c.tiles), parcels: i32ToB64(c.parcel),
        aux: c.aux.some((v) => v !== 0) ? u8ToB64(c.aux) : undefined, sub: c.sub.some((v) => v !== 0) ? u8ToB64(c.sub) : undefined,
        under: c.under.some((v) => v !== 0) ? u8ToB64(c.under) : undefined,
      })),
    transitLines: [...w.transitLines.values()], nextLineId: w.nextLineId,
    stopNames: [...w.stopNames].map(([k, name]) => { const [x, y] = parseKey(k); return [x, y, name] as [number, number, string]; }),
    history: historyOf(w).toJSON(),
    ...(w.seaGates.length ? { seaGates: w.seaGates.map((g) => ({ ...g })) } : {}),
    ...(w.start === 'frontier' ? { start: 'frontier' as const, ...(w.home ? { home: w.home } : {}), ...(w.charter ? { charter: { ...w.charter } } : {}) } : {}),
    ...(w.mothballed.size ? { mothballed: [...w.mothballed].map((k) => parseKey(k) as [number, number]) } : {}),
    ...(w.firesSave ? { fires: w.firesSave() } : {}),
  };
}

/** Whether this build can read a snapshot of that format (the current one, or one it upgrades in place). */
export const readableVersion = (version: number | undefined) => version === VERSION || UPGRADES_FROM.includes(version as number);

/** A World from a parsed snapshot (upgraded in place from older formats), or null when the format is unreadable. */
export function worldFromSnapshot(snap: Snapshot): World | null {
  if (!readableVersion(snap.version)) return null;
  const w = new World(snap.seed);
  w.nextId = snap.nextId; w.day = snap.day; w.tick = snap.tick;
  for (const p of snap.players) w.players.set(p.id, { ...p, tech: p.tech ?? [], progress: { ...emptyProgress(), ...(p.progress ?? {}) }, policies: p.policies?.filter(isPolicyId) });
  for (const p of snap.parcels) w.parcels.set(p.id, p);
  const N = CHUNK_SIZE * CHUNK_SIZE;
  for (const c of snap.chunks) {
    const tiles = b64ToU16(c.tiles), parcel = b64ToI32(c.parcels);
    if (tiles.length !== N) continue;
    const saved = c.aux ? b64ToU8(c.aux) : null;
    const aux = saved && saved.length === N ? saved : new Uint8Array(N);
    const savedSub = c.sub ? b64ToU8(c.sub) : null;
    const sub = savedSub && savedSub.length === N ? savedSub : new Uint8Array(N);
    const savedUnder = c.under ? b64ToU8(c.under) : null;
    const under = savedUnder && savedUnder.length === N ? savedUnder : new Uint8Array(N);
    w.chunks.set(chunkKey(c.cx, c.cy), { cx: c.cx, cy: c.cy, tiles, parcel, aux, sub, under, modified: true });
  }
  // index buildings once every chunk is in, so a structure's door can be found from any of its tiles
  for (const ch of w.chunks.values()) {
    for (let i = 0; i < N; i++) {
      const t = ch.tiles[i];
      if (zoneOf(t) === Zone.None || isRoad(t)) continue;
      const x = ch.cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = ch.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      if (ch.aux[i]) { const [dx, dy] = w.doorOf(x, y); if (dx !== x || dy !== y) continue; } // part of a structure: only its door is a building
      w.putBuilding({ x, y, zone: zoneOf(t), id: kindIdOf(zoneOf(t), ch.sub[i]), level: levelOf(t), occupants: 0 });
    }
  }
  // transit lines (v7; older worlds have none): definitions only, routes are worked out again by the simulation
  for (const l of snap.transitLines ?? []) if (l && Number.isInteger(l.id) && Array.isArray(l.stops) && typeof l.owner === 'string') w.transitLines.set(l.id, { ...l, mode: l.mode ?? 'bus', loop: l.loop !== false });
  for (const n of snap.stopNames ?? []) if (Array.isArray(n) && Number.isInteger(n[0]) && Number.isInteger(n[1]) && typeof n[2] === 'string' && n[2]) w.stopNames.set(tileKey(n[0], n[1]), n[2]);
  historyOf(w).load(snap.history);
  for (const g of snap.seaGates ?? []) if (g && Number.isInteger(g.x) && Number.isInteger(g.y) && typeof g.name === 'string') w.seaGates.push({ x: g.x, y: g.y, name: g.name, ...(g.low ? { low: true } : {}) });
  w.nextLineId = Math.max(snap.nextLineId ?? 1, 1 + Math.max(0, ...w.transitLines.keys()));
  if (snap.start === 'frontier') {
    w.start = 'frontier';
    if (Array.isArray(snap.home) && Number.isInteger(snap.home[0]) && Number.isInteger(snap.home[1])) w.home = [snap.home[0], snap.home[1]];
    const ch = snap.charter;
    if (ch && [ch.x, ch.y, ch.w, ch.h].every(Number.isInteger)) w.charter = { x: ch.x, y: ch.y, w: ch.w, h: ch.h };
  }
  for (const m of snap.mothballed ?? []) if (Array.isArray(m) && w.buildings.has(tileKey(m[0], m[1]))) w.mothballed.add(tileKey(m[0], m[1]));
  if (snap.fires && typeof snap.fires === 'object') w.firesLoaded = snap.fires;
  for (const s of snap.sites ?? []) w.sites.set(tileKey(s.x, s.y), { ...s, priority: s.priority ?? 0, created: s.created ?? 0, assigned: 0 });
  for (const saved of snap.citizens) {
    // citizens saved before lives existed: hash-seeded adult ages, health 80, their own household, no links
    const c: Citizen = { ...lifeDefaults(saved.id, w.tick, seededAge(saved.id, LIFE.legacyMin, LIFE.legacyMax), 80), ...saved };
    // citizens saved before education (docs/education.md): levels seeded from the id and their age, studying nowhere
    if (c.edu === undefined) Object.assign(c, eduDefaults(c.id, ageOf(c, w.tick)));
    c.errand = 0;
    const home = w.buildings.get(tileKey(c.hx, c.hy));
    if (!home) continue;
    w.bedIn(home, 1); // a home's occupants, or a hall of residence's lodgers
    if (c.job) {
      const wb = w.buildings.get(tileKey(c.wx, c.wy));
      if (wb) { wb.occupants++; rehire(c, wb); } else { c.job = false; c.commute = null; }
    }
    // resume everyone at home with their car; mid-trip positions are not worth restoring
    c.state = 0; c.path = []; c.pi = 0; c.x = c.hx + 0.5; c.y = c.hy + 0.5;
    c.site = null; c.venue = null; c.preStop = false;
    // migrants (sim/gateways.ts): a newcomer is home now; a leaver sets off again for a gateway from home
    if (c.mig) { c.mig = c.mig === 1 ? 0 : 2; c.gx = undefined; c.gy = undefined; }
    c.legs = []; c.leg = null; c.parkedAt = null; c.parkKerb = false; c.lane = -1; c.wait = 0; c.stuck = 0; c.trail = [];
    c.car = c.stage !== LifeStage.Child && w.ownsCar(c.id, c.kind); // ownership is a stable function of the id, so tuning applies to old worlds too
    if (c.nextAt < w.tick) c.nextAt = w.tick + 1; // a shift missed while the server was down starts promptly
    w.addCitizen(c);
  }
  return w;
}
