import type { KindDef, HelperModel, Op, CompiledOp, CompiledRecipe, KindManifest, LevelManifest, LevelStats, Design, Color, Flags, Win, CompiledFacade, PartRef } from './schema';
import { compileFacade, featureOps, isFeature, partIndex, type FeatureTarget } from './facade';
import { PALETTE, WINDOW_CLASSES, type WindowClass } from './palette';
import { HELPERS } from './helpers';
import { LEVEL_SLOTS, MAX_KIND_CODE, KIND_FLAG } from './codes';
import { validateCatalogue, mergeAttrs } from './validate';
import { techFor } from '../tech';
import { ZONE_COST } from '../constants';

/**
 * Catalogue -> flat tables, a JSON-able manifest and primitive-only model
 * recipes. Pure: no file access, so the compile script, the snapshot check
 * and anything else can call it.
 */
export interface CompiledCatalogue {
  /** one more than the highest kind code (family code) */
  kindCount: number;
  /** one more than the highest kind id; every per-kind table has this many rows (at least 16) */
  kindIdCount: number;
  /** by kind id */
  kindNames: string[];
  tables: Record<'capacity' | 'wage' | 'upkeep' | 'cost' | 'work' | 'parkSurface' | 'parkUnderground' | 'designCount', number[]>;
  /** per kind id */
  kindFlags: number[];
  topLevel: number[];
  /** per kind id: the family code written into the tile word */
  family: number[];
  /** per family code 0-15: the base kind's id (what a tile with sub byte 0 is) */
  familyBase: number[];
  /** per kind id: w, h, door dx, door dy */
  footprint: number[];
  manifest: KindManifest[];
  recipes: CompiledRecipe[];
  helpers: CompiledRecipe[];
}

const colour = (c: Color) => (typeof c === 'number' ? c : PALETTE[c]);

/**
 * Expand helpers and features, and resolve colours and window classes. Facade boxes carry their compiled facade
 * (buildings/facade.ts) and feature ops (door, balcony, ...) expand into boxes and roofs placed by cell, adding cell
 * overrides to the box they name. `src`, when given, receives the authored op index of every compiled op.
 */
export function compileOps(ops: Op[], windows: WindowClass, src?: number[]): CompiledOp[] {
  const out: CompiledOp[] = [];
  const winOf = (w: Win | undefined) => { const c = w === true ? windows : w; return c ? WINDOW_CLASSES[c] : 0; };
  // facades first, so features may name a box before or after it in the list
  const facades = new Map<number, { facade: CompiledFacade; doorBay: number }>();
  ops.forEach((op, i) => {
    if (op[0] === 'box' && op[9]?.facade) facades.set(i, compileFacade(op[9].facade, winOf(op[8]), op[1], op[2], op[3]));
  });
  const parts = facades.size || ops.some((op) => isFeature(op[0])) ? partIndex(ops) : undefined;
  const featureColour = (c: Color | undefined, d: Color) => colour(c ?? d);
  let at = 0;
  const emit = (o: CompiledOp) => { out.push(o); src?.push(at); };
  const prim = (op: Op) => {
    const a = op as unknown as unknown[];
    switch (op[0]) {
      case 'box': emit(['box', op[1], op[2], op[3], op[4], op[5], op[6], colour(op[7]), winOf(op[8])]); break;
      case 'roof': emit(['roof', op[1], op[2], op[3], op[4], op[5], op[6], colour(op[7]), op[8] ?? false]); break;
      case 'cyl': emit(['cyl', op[1], op[2], op[3], op[4], op[5], op[6], colour(op[7]), op[8] ?? 8]); break;
      case 'cone': emit(['cone', op[1], op[2], op[3], op[4], op[5], colour(op[6]), op[7] ?? 8]); break;
      case 'wheel': emit(['wheel', op[1], op[2], op[3], op[4], op[5], colour(op[6])]); break;
      case 'taper': { const o = op[10] ?? {}; emit(['taper', op[1], op[2], op[3], op[4], op[5], op[6], op[7], op[8], colour(op[9]), winOf(o.win), o.shift?.[0] ?? 0, o.shift?.[1] ?? 0]); break; }
      case 'lathe': {
        const o = op[6] ?? {};
        emit(['lathe', op[1], op[2], op[3], colour(op[4]), o.seg ?? 16, colour(o.stripe ?? op[4]), o.stripe === undefined ? 0 : o.every ?? 4, o.width ?? 1, o.twist ?? 0, o.axis === 'x' ? 1 : o.axis === 'z' ? 2 : 0, winOf(o.win), [...op[5]]]);
        break;
      }
      default: {
        const h = HELPERS[op[0]];
        if (!h) throw new Error(`unknown op ${op[0]}`);
        for (const p of h.expand(a.slice(1) as (number | Color)[])) prim(p);
      }
    }
  };
  const feature = (op: Op) => {
    const ti = parts?.get((op as unknown as unknown[])[1] as PartRef);
    const target = ti === undefined ? undefined : ops[ti];
    if (!target || (target[0] !== 'box' && target[0] !== 'roof')) throw new Error(`${op[0]}: no box or roof '${(op as unknown as unknown[])[1]}'`);
    const box = [target[1], target[2], target[3], target[4], target[5], target[6]] as const;
    const t: FeatureTarget = target[0] === 'box'
      ? { box, hex: colour(target[7]), cls: winOf(target[8]), facade: facades.get(ti!)?.facade }
      : { box, hex: colour(target[7]), cls: WINDOW_CLASSES[windows], alongZ: !!target[8] };
    if (target[0] === 'box' && !t.facade) throw new Error(`${op[0]}: op ${ti} has no facade`);
    for (const o of featureOps(op, t, featureColour)) emit(o);
  };
  ops.forEach((op, i) => {
    at = i;
    if (isFeature(op[0])) return feature(op);
    const fac = op[0] === 'box' ? facades.get(i) : undefined;
    if (!fac || op[0] !== 'box') return prim(op);
    emit(['box', op[1], op[2], op[3], op[4], op[5], op[6], colour(op[7]), winOf(op[8]), fac.facade]);
    if (fac.doorBay >= 0) feature(['door', i, 'front', fac.doorBay]);
  });
  return out;
}

const flagsOf = (f: Flags): Required<Flags> => ({
  growable: !!f.growable, civic: !!f.civic, service: !!f.service, workplace: !!f.workplace, parking: !!f.parking, leisureReady: !!f.leisureReady,
});
const flagBits = (f: Required<Flags>) => Object.entries(f).reduce((b, [n, on]) => (on ? b | KIND_FLAG[n as keyof typeof KIND_FLAG] : b), 0);

function statsOf(k: KindDef, l: Partial<LevelStats>): LevelStats {
  return {
    capacity: l.capacity ?? k.capacity ?? 0,
    wage: l.wage ?? k.wage ?? 0,
    upkeep: l.upkeep ?? k.upkeep ?? 0,
    cost: l.cost ?? k.cost ?? 0,
    work: l.work ?? k.work ?? 0,
    parking: { surface: l.parking?.surface ?? k.parking?.surface ?? 0, underground: l.parking?.underground ?? k.parking?.underground ?? 0 },
  };
}

/** Live designs first (they keep indices 0..n-1, which tiles pick by hash), then drafts. */
const ordered = (ds: Design[]) => [...ds.filter((d) => !d.draft), ...ds.filter((d) => d.draft)];

export function compileCatalogue(kinds: KindDef[], helperModels: HelperModel[]): CompiledCatalogue {
  const errs = validateCatalogue(kinds, helperModels);
  if (errs.length) throw new Error(`building catalogue is invalid:\n  ${errs.join('\n  ')}`);
  const idOf = (k: KindDef) => k.kindId ?? k.code;
  const sorted = [...kinds].sort((a, b) => idOf(a) - idOf(b));
  const kindCount = Math.max(...sorted.map((k) => k.code)) + 1;
  // rows run to the highest kind id, and always cover every family code so code-indexed reads stay in bounds
  const kindIdCount = Math.max(MAX_KIND_CODE + 1, ...sorted.map((k) => idOf(k) + 1));
  const slots = kindIdCount * LEVEL_SLOTS;
  const t = {
    capacity: new Array(slots).fill(0), wage: new Array(slots).fill(0), upkeep: new Array(slots).fill(0), cost: new Array(slots).fill(0),
    work: new Array(slots).fill(0), parkSurface: new Array(slots).fill(0), parkUnderground: new Array(slots).fill(0), designCount: new Array(slots).fill(0),
  };
  const kindNames = new Array(Math.max(kindCount, ...sorted.map((k) => idOf(k) + 1))).fill('');
  const kindFlags = new Array(kindIdCount).fill(0);
  const topLevel = new Array(kindIdCount).fill(0);
  const family = new Array(kindIdCount).fill(0);
  const familyBase = new Array(MAX_KIND_CODE + 1).fill(0);
  const footprint: number[] = [];
  for (let id = 0; id < kindIdCount; id++) footprint.push(1, 1, 0, 0);
  const manifest: KindManifest[] = [];
  const recipes: CompiledRecipe[] = [];

  for (const k of sorted) {
    const id = idOf(k);
    const flags = flagsOf(k.flags);
    kindNames[id] = k.name;
    kindFlags[id] = flagBits(flags);
    // merged zone kinds start above level 1 (minLevel): their first entry is that level
    const minLevel = k.minLevel ?? 1;
    topLevel[id] = minLevel + k.levels.length - 1;
    family[id] = k.code;
    if (id === k.code) familyBase[k.code] = id;
    const fp = k.footprint && k.footprint.w * k.footprint.h > 1 ? k.footprint : undefined;
    if (fp) footprint.splice(id * 4, 4, fp.w, fp.h, fp.door[0], fp.door[1]);
    const put = (slot: number, s: LevelStats, designs: number) => {
      const i = id * LEVEL_SLOTS + slot;
      t.capacity[i] = s.capacity; t.wage[i] = s.wage; t.upkeep[i] = s.upkeep; t.cost[i] = s.cost; t.work[i] = s.work;
      t.parkSurface[i] = s.parking.surface; t.parkUnderground[i] = s.parking.underground; t.designCount[i] = designs;
    };
    // slot 0: an empty lot or a civic site; slots below minLevel repeat the first level (no designs), slots past the top level repeat the top level
    const lot = k.lot ?? {};
    put(0, { capacity: lot.capacity ?? 0, wage: lot.wage ?? 0, upkeep: lot.upkeep ?? 0, cost: lot.cost ?? 0, work: 0, parking: lot.parking ?? { surface: 0, underground: 0 } }, 0);
    const kindTech = k.tool ? techFor(k.tool.id) : undefined;
    const levels: LevelManifest[] = k.levels.map((l, li) => {
      const level = minLevel + li;
      const s = statsOf(k, l);
      const ds = ordered(l.designs);
      const live = ds.filter((d) => !d.draft).length;
      put(level, s, live);
      const lvTech = l.feature ? techFor(l.feature) : undefined;
      const tech = [...new Set([kindTech?.id, lvTech?.id].filter((x): x is string => !!x))];
      return {
        level, ...s, tech, feature: l.feature, attrs: mergeAttrs(k, l),
        designs: ds.map((d, index) => {
          const key = `${id}:${level}:${index}`;
          const ops = compileOps(d.ops, k.windows);
          recipes.push({ key, kind: id, level, index, height: d.height, draft: !!d.draft, ops });
          return { key, index, name: d.name, height: d.height, draft: !!d.draft, ops: ops.length, attrs: mergeAttrs(k, l, d), ...(d.author ? { author: d.author } : {}) };
        }),
      };
    });
    const top = levels[levels.length - 1];
    for (let slot = 1; slot < minLevel; slot++) put(slot, levels[0], 0);
    for (let slot = topLevel[id] + 1; slot < LEVEL_SLOTS; slot++) put(slot, top, 0);
    manifest.push({
      id: k.id, name: k.name, kindId: id, code: k.code, family: k.family, flags, windows: k.windows,
      tool: k.tool ? { ...k.tool, cost: flags.growable ? ZONE_COST : levels[0].cost } : undefined,
      tech: kindTech ? [kindTech.id] : [],
      occupation: k.occupation, attrs: { ...(k.attrs ?? {}) }, tints: k.tints, lotTint: k.lotTint, levels,
      footprint: fp ? { w: fp.w, h: fp.h, door: [fp.door[0], fp.door[1]], ...(fp.marks?.length ? { marks: JSON.parse(JSON.stringify(fp.marks)) } : {}) } : undefined, draft: k.draft || undefined,
      group: k.group, tier: k.tier, blurb: k.blurb, howTo: k.howTo,
      ...(k.landmark ? { landmark: true } : {}), ...(k.tags?.length ? { tags: [...k.tags] } : {}),
    });
  }
  const helpers = helperModels.map((h) => ({ key: h.key, kind: 0, level: 0, index: 0, height: h.height, draft: false, ops: compileOps(h.ops, 'none') }));
  return { kindCount, kindIdCount, kindNames, tables: t, kindFlags, topLevel, family, familyBase, footprint, manifest, recipes, helpers };
}

function fnv(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const HEADER = '// GENERATED by `npm run buildings:compile` from packages/shared/src/buildings/*.ts. Do not edit by hand.\n';
const rows = (a: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < a.length; i += LEVEL_SLOTS) out.push('  ' + a.slice(i, i + LEVEL_SLOTS).join(', ') + ',');
  return out.join('\n');
};
const strip = (v: unknown) => JSON.parse(JSON.stringify(v)); // drop undefined fields

/** Source text of compiled.ts (tables + manifest) and recipes.ts (model recipes). */
export function emitCatalogue(c: CompiledCatalogue): { compiled: string; recipes: string; hash: string } {
  const tools = c.manifest.filter((k) => k.tool);
  const toolMap = (pred: (k: KindManifest) => boolean) => `{ ${tools.filter(pred).map((k) => `${JSON.stringify(k.tool!.id)}: ${k.kindId}`).join(', ')} }`;
  const table = (name: string, type: string, a: number[], doc: string) => `/** ${doc} */\nexport const ${name} = new ${type}([\n${rows(a)}\n]);`;
  const body = [
    `import type { KindManifest } from './schema';`,
    ``,
    `/** One more than the highest kind code (family code) in the catalogue. */`,
    `export const CATALOGUE_KIND_COUNT = ${c.kindCount};`,
    `/** One more than the highest kind id; the per-kind tables have this many rows. */`,
    `export const CATALOGUE_KIND_ID_COUNT = ${c.kindIdCount};`,
    `/** Names by kind id (base kinds' ids equal their codes). */`,
    `export const CATALOGUE_KIND_NAMES: string[] = ${JSON.stringify(c.kindNames)};`,
    `/** Kind id by catalogue string id, for code that means one exact kind. */`,
    `export const KIND_ID = ${JSON.stringify(Object.fromEntries(c.manifest.map((k) => [k.id, k.kindId])))} as const;`,
    ``,
    `// Tables below are indexed by kind id * ${LEVEL_SLOTS} + level, one row per kind id 0-${c.kindIdCount - 1} (ids 0-${MAX_KIND_CODE} are the base kinds, id = code).`,
    `// Level 0 is an empty lot or a civic site; levels below a kind's first level repeat the first (merged zone kinds start higher), levels past its top level repeat the top level.`,
    table('CAPACITY_TABLE', 'Int16Array', c.tables.capacity, 'residents or jobs'),
    table('WAGE_TABLE', 'Float32Array', c.tables.wage, 'pay per standard 8-hour shift'),
    table('UPKEEP_TABLE', 'Float32Array', c.tables.upkeep, 'daily upkeep paid by the parcel owner'),
    table('COST_TABLE', 'Float32Array', c.tables.cost, 'one-off placement price (0 for growable zones: they pay ZONE_COST per tile)'),
    table('WORK_TABLE', 'Int16Array', c.tables.work, 'builder work units to build the level'),
    table('PARK_SURFACE_TABLE', 'Int16Array', c.tables.parkSurface, 'parking spaces without Deep foundations'),
    table('PARK_UNDERGROUND_TABLE', 'Int16Array', c.tables.parkUnderground, 'parking spaces with Deep foundations'),
    table('DESIGN_COUNT_TABLE', 'Uint8Array', c.tables.designCount, 'live (non-draft) designs a tile can pick from'),
    `/** KIND_FLAG bits per kind id. */`,
    `export const KIND_FLAGS_TABLE = new Uint8Array([${c.kindFlags.join(', ')}]);`,
    `/** Highest level per kind id. */`,
    `export const TOP_LEVEL_TABLE = new Uint8Array([${c.topLevel.join(', ')}]);`,
    `/** Family code (the 4-bit kind field written into the tile word) per kind id. */`,
    `export const KIND_FAMILY_TABLE = new Uint8Array([${c.family.join(', ')}]);`,
    `/** Base kind id per family code 0-${MAX_KIND_CODE}: what a tile of that code is when its sub byte is 0. */`,
    `export const FAMILY_BASE_TABLE = new Uint8Array([${c.familyBase.join(', ')}]);`,
    `/** Footprint per kind id, four bytes each: w, h, door dx, door dy (1, 1, 0, 0 for a single tile). See structures.ts. */`,
    `export const FOOTPRINT_TABLE = new Uint8Array([${c.footprint.join(', ')}]);`,
    ``,
    `export type KindToolId = ${tools.map((k) => JSON.stringify(k.tool!.id)).join(' | ')};`,
    `/** Tool id -> kind id, for every kind that has a tool. */`,
    `export const KIND_TOOLS: Record<KindToolId, number> = ${toolMap(() => true)};`,
    `/** Tools that zone land for a growable kind. */`,
    `export const ZONE_TOOLS: Record<string, number> = ${toolMap((k) => k.flags.growable)};`,
    `/** Tools that place a civic building (a site that builders raise). */`,
    `export const CIVIC_TOOLS: Record<string, number> = ${toolMap((k) => k.flags.civic)};`,
    ``,
    `/** Everything about every kind, for tooltips, tool lists and the building viewer. Not for hot paths. */`,
    `export const MANIFEST: KindManifest[] = ${JSON.stringify(strip(c.manifest), null, 2)};`,
    ``,
  ].join('\n');
  const recipeLines = (rs: CompiledRecipe[]) => rs.map((r) => '  ' + JSON.stringify(r) + ',').join('\n');
  const rbody = [
    `import type { CompiledRecipe } from './schema';`,
    ``,
    `/** Model recipes per design, keyed \`kind:level:design\`. Primitive ops only; colours and window classes are numbers. */`,
    `export const RECIPES: CompiledRecipe[] = [\n${recipeLines(c.recipes)}\n];`,
    ``,
    `/** Models placed by key: the crane over a site and the site fence. */`,
    `export const HELPER_RECIPES: CompiledRecipe[] = [\n${recipeLines(c.helpers)}\n];`,
    ``,
  ].join('\n');
  const hash = fnv(body + rbody);
  return {
    hash,
    compiled: `${HEADER}// catalogue ${hash}\n${body}\nexport const CATALOGUE_HASH = '${hash}';\n`,
    recipes: `${HEADER}// catalogue ${hash}\n${rbody}`,
  };
}
