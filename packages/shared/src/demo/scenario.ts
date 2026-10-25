import { CATALOGUE_HASH } from '../buildings/compiled';
import { DEMO_TOWN, demoSections, type DemoId } from './showcase';

/**
 * The scenario hash (docs/demo.md, "Warming and rebuilding"): what a demo's saved world was built from. A save whose
 * recorded hash differs from the current one is out of date (the scenario's data changed, a catalogue kind it uses
 * changed, or SCENARIO_VERSION was bumped) and the server sets it aside and seeds the demo again.
 *
 * A pure function of data: the sections' placements, lines and zones as JSON with sorted keys, the town they stand on,
 * the catalogue hash and SCENARIO_VERSION. No clock, no paths, so the same checkout gives the same hash anywhere.
 */

/**
 * Bump by hand to force every demo to seed again: the seeder (server/src/demo/seed.ts), the fill or the simulation
 * changed in a way the scenario data and the catalogue do not show.
 */
export const SCENARIO_VERSION = 1;

/** JSON with object keys sorted; undefined and functions left out, Maps and Sets as arrays, so equal data gives equal text */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return typeof v === 'function' || v === undefined ? 'null' : typeof v === 'number' && !Number.isFinite(v) ? 'null' : JSON.stringify(v);
  if (v instanceof Map) return stableStringify([...v.entries()]);
  if (v instanceof Set) return stableStringify([...v.values()]);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined && typeof o[k] !== 'function').sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** 32-bit FNV-1a as eight hex digits */
export function fnv32(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const cache = new Map<string, string>();
/** `version` is SCENARIO_VERSION unless a test overrides it (the server reads env SCENARIO_VERSION) */
export function scenarioHash(id: DemoId, version: number = SCENARIO_VERSION): string {
  const key = `${id}@${version}`;
  let h = cache.get(key);
  if (!h) { h = fnv32(`${version}|${CATALOGUE_HASH}|${stableStringify(DEMO_TOWN)}|${id}|${stableStringify(demoSections(id))}`); cache.set(key, h); }
  return h;
}
