import { MANIFEST, CATALOGUE_KIND_ID_COUNT } from './buildings/compiled';
import { GROUPS, type GroupDef } from './buildings/groups';
import type { KindManifest } from './buildings/schema';
import { SERVICE_RADIUS } from './constants';

/**
 * Size ladders as the game reads them (docs/buildings.md "Groups and tiers"). The catalogue gives some kinds a
 * `group` and a `tier`; this module turns their attributes into flat per-kind-id arrays for the simulation's hot
 * paths, and lists each ladder's rungs for the tool bar, the size picker and the viewer. Every array defaults to the
 * behaviour from before tiers (a full service within SERVICE_RADIUS, one patrol rate, one builder's pace), so kinds
 * without tier attributes behave exactly as they did.
 */

/** Tiles (square, from the door) within which a staffed service covers a home, by kind id. */
export const SERVICE_RADIUS_OF = new Uint8Array(256);
/** Weight of a staffed service in a home's coverage (the strongest station per family counts), by kind id. */
export const SERVICE_STRENGTH_OF = new Float64Array(256);
/** Patrols or call-outs a station sends, relative to a police or fire station, by kind id. */
export const PATROL_RATE_OF = new Float64Array(256);
/** Work per builder per tick, relative to a builders' yard crew, by the builder's workplace kind id. */
export const WORK_RATE_OF = new Float64Array(256);

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
for (let id = 0; id < 256; id++) { SERVICE_RADIUS_OF[id] = SERVICE_RADIUS; SERVICE_STRENGTH_OF[id] = 1; PATROL_RATE_OF[id] = 1; WORK_RATE_OF[id] = 1; }
for (const k of MANIFEST) {
  const a = k.levels[0]?.attrs ?? k.attrs;
  SERVICE_RADIUS_OF[k.kindId] = num(a.serviceRadius, SERVICE_RADIUS);
  SERVICE_STRENGTH_OF[k.kindId] = num(a.serviceStrength, 1);
  PATROL_RATE_OF[k.kindId] = num(a.patrolRate, 1);
  WORK_RATE_OF[k.kindId] = num(a.workRate, 1);
}
/** The widest service radius of any kind, for spatial searches. */
export const MAX_SERVICE_RADIUS = Math.max(SERVICE_RADIUS, ...MANIFEST.filter((k) => k.flags.service).map((k) => SERVICE_RADIUS_OF[k.kindId]));

export interface Ladder { group: GroupDef; tiers: KindManifest[] }
/** Every ladder with at least one rung, in groups.ts order; rungs smallest first. Drafts are included (the client filters). */
export const LADDERS: Ladder[] = GROUPS
  .map((group) => ({ group, tiers: MANIFEST.filter((k) => k.group === group.id).sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0)) }))
  .filter((l) => l.tiers.length > 0);
const LADDER_OF: (Ladder | undefined)[] = new Array(Math.max(256, CATALOGUE_KIND_ID_COUNT));
for (const l of LADDERS) for (const k of l.tiers) LADDER_OF[k.kindId] = l;
/** The ladder a kind id is a rung of, if any. */
export const ladderOf = (kindId: number): Ladder | undefined => LADDER_OF[kindId];

/** '2×2' for a kind's footprint (1×1 when it has none). */
export const footprintLabel = (k: KindManifest) => `${k.footprint?.w ?? 1}×${k.footprint?.h ?? 1}`;

/** What a rung offers, for the picker card and the viewer's ladder table. */
export interface TierSummary {
  kindId: number; tier: number; name: string; label: string; footprint: string;
  /** staff, builders, bays (surface), visitors or pupils (school places, the `pupilCapacity` attribute) at once, by the group's `holds` */
  holds: number; holdsWhat: string;
  cost: number; upkeep: number; work: number;
  /** services: coverage radius and strength; builders: work rate; police, fire and health: patrol rate; venues: event size */
  radius?: number; strength?: number; workRate?: number; patrolRate?: number; eventSize?: number; leisureValue?: number;
}
export function tierSummary(k: KindManifest): TierSummary {
  const l = k.levels[0], top = k.levels[k.levels.length - 1];
  const g = GROUPS.find((x) => x.id === k.group);
  const a = l.attrs;
  const holdsWhat = g?.holds ?? 'staff';
  // a park that grows shows what it grows into; venues hold visitors, lots hold cars, workplaces hold staff
  const holds = holdsWhat === 'bays' ? l.parking.surface : (holdsWhat === 'visitors' || holdsWhat === 'seats') ? num(top.attrs.visitorCapacity, 0) : holdsWhat === 'pupils' ? num(a.pupilCapacity, 0) : l.capacity;
  const s: TierSummary = {
    kindId: k.kindId, tier: k.tier ?? 1, name: k.name, label: k.tool?.label ?? k.name, footprint: footprintLabel(k),
    holds, holdsWhat, cost: l.cost, upkeep: l.upkeep, work: l.work,
  };
  if (k.flags.service) { s.radius = SERVICE_RADIUS_OF[k.kindId]; s.strength = SERVICE_STRENGTH_OF[k.kindId]; s.patrolRate = PATROL_RATE_OF[k.kindId]; }
  if (k.group === 'builders') s.workRate = WORK_RATE_OF[k.kindId];
  if (k.family === 'leisure') { s.radius = num(top.attrs.radius, 0); s.leisureValue = num(top.attrs.leisureValue, 0); s.eventSize = num(a.eventSize, 1); }
  return s;
}
