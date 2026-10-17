import type { BufferGeometry } from 'three';
import { PALETTE, TOP_LEVEL_TABLE, DESIGN_COUNT_TABLE, LEVEL_SLOTS, type CompiledRecipe, type CompiledOp } from '@msimcity/shared';
import { RECIPES, HELPER_RECIPES } from '@msimcity/shared/src/buildings/recipes';
import { Kit } from './kit';

/** The recipe palette, re-exported for other kit-built models (cars, people). */
export const P = PALETTE;

export interface Variant { key: string; geometry: BufferGeometry; height: number }
/** A built design with where it came from; drafts are built for the viewer but never placed in the city. */
export interface Design extends Variant { kind: number; level: number; index: number; draft: boolean }

const registry = new Map<string, Design>();
const live: Design[] = [];
const all: Design[] = [];
/** live designs per kind * LEVEL_SLOTS + level, in index order */
const bySlot: Design[][] = [];

/** Run a compiled recipe through the kit. Recipes are data (shared/src/buildings); this is the only interpreter. */
function make(r: Pick<CompiledRecipe, 'ops'>): BufferGeometry {
  const k = new Kit({ facades: true });
  for (const op of r.ops) {
    switch (op[0]) {
      case 'box': k.box(op[1], op[2], op[3], op[4], op[5], op[6], op[7], op[8], op[9]); break;
      case 'roof': k.roof(op[1], op[2], op[3], op[4], op[5], op[6], op[7], op[8]); break;
      case 'cyl': k.cyl(op[1], op[2], op[3], op[4], op[5], op[6], op[7], op[8]); break;
      case 'cone': k.cone(op[1], op[2], op[3], op[4], op[5], op[6], op[7]); break;
      case 'wheel': k.wheel(op[1], op[2], op[3], op[4], op[5], op[6]); break;
    }
  }
  return k.build();
}

/** Build every model once. Keys are `${kind}:${level}:${design}` plus 'crane' and 'site'. */
export function buildModels() {
  if (registry.size) return;
  for (const r of [...RECIPES, ...HELPER_RECIPES]) {
    const d: Design = { key: r.key, geometry: make(r), height: r.height, kind: r.kind, level: r.level, index: r.index, draft: r.draft };
    registry.set(d.key, d);
    all.push(d);
    if (d.draft) continue;
    live.push(d);
    if (r.level > 0) (bySlot[r.kind * LEVEL_SLOTS + r.level] ??= [])[r.index] = d;
  }
}

/** The design for a tile: `pick` in [0,1) chooses within the kind+level so neighbours differ. */
export function variant(kind: number, level: number, pick = 0): Variant | undefined {
  const top = TOP_LEVEL_TABLE[kind] ?? 0;
  let lv = Math.min(level, top);
  // merged zone kinds start above level 1 (shared/src/zones.ts): a site's rising shell (level 0 asks for 1) shows the first level
  while (lv < top && !DESIGN_COUNT_TABLE[kind * LEVEL_SLOTS + lv]) lv++;
  const s = kind * LEVEL_SLOTS + lv;
  const n = DESIGN_COUNT_TABLE[s];
  if (!n) return undefined;
  return bySlot[s][Math.min(n - 1, Math.floor(pick * n))];
}
export const model = (key: string) => registry.get(key);
/** Everything the city can place (live designs and helpers), for the shared BatchedMesh. */
export const allVariants = (): Variant[] => live;
/** Every compiled design including drafts, for the building viewer. */
export const allDesigns = (): Design[] => all;

/**
 * The far tier of a design (render/buildings.ts LOD): what still reads from a distance. Small parts (doors, awnings,
 * sills, chimney pots, dormers, wheels, lamp posts) are dropped, facade boxes keep their window class but lose the
 * per-cell split (the window shader's distance fade already shows only the class average there), and round parts
 * get fewer segments. Never empty: a design that would lose everything keeps its biggest part.
 */
export function farOps(ops: readonly CompiledOp[]): CompiledOp[] {
  const out: CompiledOp[] = [];
  let big: CompiledOp | undefined, bigV = -1;
  for (const op of ops) {
    let v = 0, keep: CompiledOp | null = null;
    switch (op[0]) {
      case 'box': {
        const [, w, h, d] = op;
        v = w * h * d;
        // long thin parts (cornices, balcony slabs and rails) go too, unless they are a slab you could stand on
        if (v >= FAR_MIN_VOLUME && Math.min(w, h, d) >= FAR_MIN_THICKNESS || v >= 4 * FAR_MIN_VOLUME) keep = op[9] ? [op[0], op[1], op[2], op[3], op[4], op[5], op[6], op[7], op[8]] : op;
        break;
      }
      case 'roof': v = (op[1] * op[2] * op[3]) / 2; if (v >= FAR_MIN_VOLUME) keep = op; break;
      case 'cyl': {
        const r = Math.max(op[1], op[2]);
        v = Math.PI * r * r * op[3];
        if (v >= FAR_MIN_VOLUME) keep = [op[0], op[1], op[2], op[3], op[4], op[5], op[6], op[7], Math.min(op[8], 6)];
        break;
      }
      case 'cone': v = (Math.PI * op[1] * op[1] * op[2]) / 3; if (v >= FAR_MIN_VOLUME) keep = [op[0], op[1], op[2], op[3], op[4], op[5], op[6], Math.min(op[7], 5)]; break;
      case 'wheel': break;
    }
    if (keep) out.push(keep);
    if (v > bigV) { bigV = v; big = op; }
  }
  if (!out.length && big) out.push(big);
  return out;
}
/** parts smaller than this (tile³) are left out of the far tier: doors, sills, chimney pots, dormers; a parked car body (0.0036) stays */
const FAR_MIN_VOLUME = 0.003;
/** and boxes thinner than this (tiles) unless they are big: a cornice band is 0.035 */
const FAR_MIN_THICKNESS = 0.04;
/** The far-tier geometry of every placeable design, by key (helpers like the crane keep their full model). */
export function buildFarModels(): Map<string, BufferGeometry> {
  const out = new Map<string, BufferGeometry>();
  for (const r of RECIPES) if (!r.draft) out.set(r.key, make({ ops: farOps(r.ops) }));
  return out;
}
