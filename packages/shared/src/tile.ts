import { Zone, KIND_FLAG, LEVEL_SLOTS } from './buildings/codes';
import {
  CATALOGUE_KIND_COUNT, CATALOGUE_KIND_ID_COUNT, CATALOGUE_KIND_NAMES, KIND_FLAGS_TABLE, CAPACITY_TABLE, WAGE_TABLE, UPKEEP_TABLE, COST_TABLE, WORK_TABLE,
  PARK_SURFACE_TABLE, PARK_UNDERGROUND_TABLE, KIND_FAMILY_TABLE, FAMILY_BASE_TABLE, MANIFEST,
} from './buildings/compiled';
import type { KindManifest } from './buildings/schema';

/**
 * A tile is packed into one uint16:
 *   bits 0-1  terrain   (grass / water / sand)
 *   bit  2    road
 *   bits 3-6  kind      family code (none / residential / commercial / ... / airport terminal family); see below for kind ids
 *   bits 7-9  building level (0 = empty lot; civic buildings are always 1)
 *   bit  10   under construction (a Site exists on the server for this tile)
 *   bits 11-13 build priority + 2 (only meaningful while under construction)
 *   bits 14-15 construction progress in quarters (0-3), for the client to show buildings rising
 * Parcel ownership is stored in a parallel int32 array per chunk, and the aux layer (one byte per tile,
 * structures.ts) marks the anchor and parts of multi-tile structures, so packTile never has to know about them.
 *
 * Sub-kinds (docs/sub-kinds.md): the 4 kind bits are a coarse **family code**. A building's identity is its
 * catalogue **kind id** (0-255), kept in a fourth per-chunk byte layer, the sub layer: kindIdOf(code, sub) is the
 * sub byte when it names a kind of that family, else the family's base kind (sub 0). Base kinds' ids equal their
 * codes, so every tile written before sub-kinds existed (sub 0) means exactly what it meant.
 */
export const Terrain = { Grass: 0, Water: 1, Sand: 2 } as const;
export { Zone, KIND_FLAG, LEVEL_SLOTS } from './buildings/codes';
/** One more than the highest kind code (family code); kinds, names, numbers and models all come from the building catalogue (buildings/). */
export const KIND_COUNT = CATALOGUE_KIND_COUNT;
/** One more than the highest kind id: the length of per-kind arrays such as ParcelStats.jobsByKind. */
export const KIND_ID_COUNT = CATALOGUE_KIND_ID_COUNT;
/** Names by kind id. A family code reads as its base kind's name (base ids equal codes). */
export const KIND_NAMES = CATALOGUE_KIND_NAMES;

// ---- kind ids and family codes (docs/sub-kinds.md) ------------------------------------------------
/** The kind id of a tile: its sub byte when that is a kind of the tile's family code, else the family's base kind. */
export const kindIdOf = (code: number, sub: number) => (sub !== 0 && KIND_FAMILY_TABLE[sub] === code ? sub : FAMILY_BASE_TABLE[code & 15]);
/** Family code (the tile's 4 kind bits) of a kind id. */
export const familyOf = (id: number) => KIND_FAMILY_TABLE[id] ?? 0;
/** What a placement writes into the sub layer for a kind id: 0 for a family's base kind (so old and base tiles agree), else the id. */
export const subFor = (id: number) => (FAMILY_BASE_TABLE[familyOf(id)] === id ? 0 : id);
/** Resolve the old kind-code arguments: a family code means its base kind (sub 0); a kind id passes through. */
const asId = (kind: number) => (kind <= 15 ? FAMILY_BASE_TABLE[kind] : kind);
const BY_ID: (KindManifest | undefined)[] = [];
for (const k of MANIFEST) BY_ID[k.kindId] = k;
/** The catalogue entry for a kind id (tooltips, tools, drafts; not for hot paths). */
export const kindManifest = (id: number): KindManifest | undefined => BY_ID[id];

const hasFlag = (id: number, bit: number) => ((KIND_FLAGS_TABLE[id] ?? 0) & bit) !== 0;
/** Zones grow by themselves (via construction sites); civic buildings are placed by the player. By kind id. */
export const isGrowableId = (id: number) => hasFlag(id, KIND_FLAG.growable);
/** Staffed civic buildings (placed by the player, built by builders, paid upkeep). By kind id. */
export const isCivicId = (id: number) => hasFlag(id, KIND_FLAG.civic);
/** Civic services that provide coverage to nearby homes (the yard does not). By kind id. */
export const isServiceId = (id: number) => hasFlag(id, KIND_FLAG.service);
export const isWorkplaceId = (id: number) => hasFlag(id, KIND_FLAG.workplace);
/** A parking lot (holds parked cars as its main purpose). By kind id. */
export const isParkingId = (id: number) => hasFlag(id, KIND_FLAG.parking);
/** Kind-code wrappers: a family code means its base kind (sub 0). New code passes kind ids to the *Id variants. */
export const isGrowable = (kind: number) => isGrowableId(asId(kind));
export const isCivic = (kind: number) => isCivicId(asId(kind));
export const isService = (kind: number) => isServiceId(asId(kind));
export const isWorkplace = (kind: number) => isWorkplaceId(asId(kind));
const CONSTRUCTION_BIT = 1 << 10;

export function packTile(terrain: number, road: boolean, kind: number, level: number): number {
  return (terrain & 3) | ((road ? 1 : 0) << 2) | ((kind & 15) << 3) | ((level & 7) << 7);
}
export const terrainOf = (p: number) => p & 3;
export const isRoad = (p: number) => ((p >> 2) & 1) === 1;
export const zoneOf = (p: number) => (p >> 3) & 15;
export const levelOf = (p: number) => (p >> 7) & 7;
export const underConstruction = (p: number) => (p & CONSTRUCTION_BIT) !== 0;
export const withRoad = (p: number, r: boolean) => (p & ~4) | (r ? 4 : 0);
export const withZone = (p: number, z: number) => (p & ~(15 << 3)) | ((z & 15) << 3);
export const withLevel = (p: number, l: number) => (p & ~(7 << 7)) | ((l & 7) << 7);
export const withConstruction = (p: number, on: boolean) => (p & ~CONSTRUCTION_BIT) | (on ? CONSTRUCTION_BIT : 0);
/** Build priority: 2 urgent, 1 high, 0 normal, -1 low, -2 paused. */
export const Priority = { Paused: -2, Low: -1, Normal: 0, High: 1, Urgent: 2 } as const;
export const PRIORITY_NAMES: Record<number, string> = { [-2]: 'paused', [-1]: 'low', 0: 'normal', 1: 'high', 2: 'urgent' };
export const priorityOf = (p: number) => (underConstruction(p) ? ((p >> 11) & 7) - 2 : 0);
export const progressOf = (p: number) => (p >> 14) & 3;
export const withProgress = (p: number, q: number) => (p & ~(3 << 14)) | ((Math.max(0, Math.min(3, q)) & 3) << 14);
export const withPriority = (p: number, pr: number) => (p & ~(7 << 11)) | (((Math.max(-2, Math.min(2, pr)) + 2) & 7) << 11);
export const isBuildable = (p: number) => terrainOf(p) !== Terrain.Water;

/** Index into the compiled per kind id + level tables. Levels are 0-7 (the tile's 3-bit field). */
const slot = (id: number, level: number) => id * LEVEL_SLOTS + (level > 7 ? 7 : level);

/** Residents (R) or jobs (everything else) a building of this kind id + level holds. */
export function capacityOf(id: number, level: number): number {
  if (level <= 0) return 0;
  return CAPACITY_TABLE[slot(id, level)] ?? 0;
}
/** Wage for a standard 8-hour shift at a workplace of this kind id + level. */
export function wageOf(id: number, level: number): number {
  if (level < 0) return 0;
  return WAGE_TABLE[slot(id, level)] ?? 0;
}
/** Daily upkeep a building of this kind id + level costs its parcel owner. */
export const upkeepOf = (id: number, level: number) => (level < 0 ? 0 : UPKEEP_TABLE[slot(id, level)] ?? 0);
/** Builder work units needed to build this kind id to this level. */
export const workOf = (id: number, level: number) => (level < 0 ? 0 : WORK_TABLE[slot(id, level)] ?? 0);
/**
 * Cars a building of this kind id can take off the street. Without the underground-parking
 * technology only a few surface spaces exist; with it, the basement levels open.
 */
export function parkingOf(id: number, level: number, underground: boolean): number {
  if (level < 0) return 0;
  return (underground ? PARK_UNDERGROUND_TABLE : PARK_SURFACE_TABLE)[slot(id, level)] ?? 0;
}
/** Kind-code wrappers of the above: a family code means its base kind (sub 0). */
export const capacity = (kind: number, level: number) => capacityOf(asId(kind), level);
export const wageFor = (kind: number, level: number) => wageOf(asId(kind), level);
export const upkeepFor = (kind: number, level: number) => upkeepOf(asId(kind), level);
export const constructionWork = (kind: number, level: number) => workOf(asId(kind), level);
export const parkingCapacity = (kind: number, level: number, underground: boolean) => parkingOf(asId(kind), level, underground);
/** One-off placement cost and daily upkeep for civic buildings and parking lots (placed kinds), keyed by kind id. */
const placed = MANIFEST.filter((k) => !k.flags.growable && k.levels[0].cost > 0);
export const CIVIC_COST: Record<number, number> = Object.fromEntries(placed.map((k) => [k.kindId, COST_TABLE[slot(k.kindId, 1)]]));
export const CIVIC_UPKEEP: Record<number, number> = Object.fromEntries(
  MANIFEST.filter((k) => k.flags.civic || k.flags.parking).map((k) => [k.kindId, UPKEEP_TABLE[slot(k.kindId, 1)]]),
);
/** Bays in a parking lot. */
export const LOT_CAPACITY = PARK_SURFACE_TABLE[slot(Zone.Parking, 1)];
/** Builder work units (one builder, one tick) needed per level of a growing zone, and for a civic building. */
export const WORK_PER_LEVEL = 60;
export const CIVIC_WORK = 300;
/** Paid per work unit by the site's parcel owner to the yard's owner when they differ. */
export const CONSTRUCTION_FEE = 0.33;
export const MAX_BUILDERS_PER_SITE = 4;
/** Visitors a commercial venue (café by day, bar or restaurant by night) can host per level. */
export const VENUE_CAPACITY_PER_LEVEL = 6;
