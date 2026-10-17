import { MANIFEST, TOP_LEVEL_TABLE } from './buildings/compiled';
import { MAX_KIND_ID } from './buildings/codes';
import { VENUE_CAPACITY_PER_LEVEL, isGrowableId } from './tile';
import { isMultiTile } from './structures';
import type { Attributes } from './buildings/schema';

/**
 * Merged lots (docs/buildings.md "Merged lots"). A zone family (residential, commercial, industrial, office) has its
 * 1×1 base kind, which zoning paints and which grows to level 3 on its own tile, and merged kinds: growable sub-kinds
 * with a footprint bigger than 1×1 and levels from `minLevel` up to 7. Growth assembles adjacent lots of one zone and
 * owner into one of them (server/src/sim/simulation.ts `planMerge`). This module turns the catalogue into the flat
 * lists the growth step and the tooltips read.
 */

/** One shape a zone family can grow into. */
export interface GrowForm {
  kindId: number;
  /** family code (Zone.Residential ...) */
  family: number;
  name: string;
  /** unrotated footprint */
  w: number; h: number; area: number;
  /** first and last level of the kind */
  minLevel: number; topLevel: number;
  /** narrower than it is deep (a deep plot, 1×2): it grows back from the road into the block's landlocked middle */
  deep: boolean;
}

const FIRST_LEVEL = new Uint8Array(MAX_KIND_ID + 1);
/** Per family code: every live growable kind bigger than 1×1, smallest footprint first. */
export const GROW_FORMS: GrowForm[][] = Array.from({ length: 16 }, () => []);
const LEVEL_ATTRS: (Attributes | undefined)[] = [];
for (const k of MANIFEST) {
  FIRST_LEVEL[k.kindId] = k.levels[0]?.level ?? 1;
  for (const l of k.levels) LEVEL_ATTRS[k.kindId * 8 + l.level] = l.attrs;
  if (!k.flags.growable || k.draft || !k.footprint) continue;
  const { w, h } = k.footprint;
  GROW_FORMS[k.code].push({ kindId: k.kindId, family: k.code, name: k.name, w, h, area: w * h, minLevel: k.levels[0].level, topLevel: k.levels[k.levels.length - 1].level, deep: w < h });
}
for (const list of GROW_FORMS) list.sort((a, b) => a.area - b.area || a.minLevel - b.minLevel || a.kindId - b.kindId);

/** First level a kind stands at (1 for everything but merged zone kinds). */
export const firstLevelOf = (id: number) => FIRST_LEVEL[id] || 1;
/** Highest level of a kind. */
export const topLevelOf = (id: number) => TOP_LEVEL_TABLE[id] ?? 0;
/** A growable kind bigger than one tile: lots merged into one building. */
export const isMergedKind = (id: number) => isGrowableId(id) && isMultiTile(id);

/** Level attributes (kind, then level; not per design) of a kind id and level, clamped into the kind's levels. */
export function levelAttrs(id: number, level: number): Attributes | undefined {
  const lv = Math.max(firstLevelOf(id), Math.min(level, topLevelOf(id)));
  return LEVEL_ATTRS[id * 8 + lv];
}
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/**
 * Visitors a commercial venue can host at once: the level's `visitorCapacity` (a department store or a shopping centre
 * holds far more than a corner shop), falling back to level × VENUE_CAPACITY_PER_LEVEL. The 1×1 commercial kind's
 * attributes equal that product, so it behaves as before.
 */
export const venueCapacityOf = (id: number, level: number) => (level <= 0 ? 0 : num(levelAttrs(id, level)?.visitorCapacity, level * VENUE_CAPACITY_PER_LEVEL));
/** Pollution of an industrial kind and level (attribute `pollution`, 0 when unset), for the derived-fields card. */
export const pollutionOf = (id: number, level: number) => (level <= 0 ? 0 : num(levelAttrs(id, level)?.pollution, 0));
