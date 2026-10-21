/**
 * Landmark check (docs/landmarks.md section 13):
 *
 *   npm run landmarks:check                       every landmark kind in the catalogue, live and draft
 *   npm run landmarks:check -- <file.ts>          one scratch file of draft landmarks (an exported KindDef[]) before it joins
 *                                                 the tree; also what `check-drafts.ts <file>` does for such a file
 *
 * For every landmark design: the model stays inside its footprint in all four rotations, its height is within 10 tiles
 * (a warning over 8), its compiled op count is within budget (a warning over 400, a failure over 800, London's numbers
 * printed for reference), nothing floats, no part covers a window, colours are palette names or 0xRRGGBB (the catalogue
 * validator), tags are present, `blurb` and `howTo` are written, a draft landmark can never reach the city (no tool, all
 * designs drafts, kind id in the reserved range, nothing live in that range), and every live landmark stands in a city
 * demo (shared/src/demo/showcase.ts showcaseProblems, the rule `demo:check` enforces).
 *
 * Live landmarks (the London set) are the baseline: floating parts found in them are reported as notes, not failures;
 * in a draft or a file they fail. Placing every landmark in all four rotations through the civic tool is `buildings:check`.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CATALOGUE, HELPER_MODELS } from '../src/buildings/catalogue';
import { validateCatalogue } from '../src/buildings/validate';
import { compileOps } from '../src/buildings/compile';
import { windowCollisions, isFeature, shapeExtent } from '../src/buildings/facade';
import { LANDMARK_DRAFT_IDS } from '../src/buildings/codes';
import { showcaseProblems } from '../src/demo/showcase';
import type { CompiledOp, KindDef } from '../src/buildings/schema';

export const MAX_HEIGHT = 10, WARN_HEIGHT = 8, WARN_OPS = 400, MAX_OPS = 800;

interface Row { id: string; kindId: number; draft: boolean; w: number; h: number; design: string; height: number; top: number; ops: number; floating: number }
export interface LandmarkReport { errors: string[]; warnings: string[]; notes: string[]; rows: Row[] }

type Ext = [number, number, number, number, number, number]; // x0 x1 y0 y1 z0 z1

/** The extent of every compiled part (null for parts with no solid extent: wheels), in the model's own frame. */
export function partExtents(ops: CompiledOp[]): (Ext | null)[] {
  return ops.map((o): Ext | null => {
    if (o[0] === 'box' || o[0] === 'roof') return [o[4] - o[1] / 2, o[4] + o[1] / 2, o[5], o[5] + o[2], o[6] - o[3] / 2, o[6] + o[3] / 2];
    if (o[0] === 'cyl') { const r = Math.max(o[1], o[2]); return [o[4] - r, o[4] + r, o[5], o[5] + o[3], o[6] - r, o[6] + r]; }
    if (o[0] === 'cone') return [o[3] - o[1], o[3] + o[1], o[4], o[4] + o[2], o[5] - o[1], o[5] + o[1]];
    if (o[0] === 'taper' || o[0] === 'lathe') return shapeExtent(o);
    return null;
  });
}

/** Turn an x, z point a quarter turn r times about the centre (the renderer turns a footprint to face its road). */
const turn = (x: number, z: number, r: number): [number, number] => { for (let i = 0; i < r; i++) [x, z] = [-z, x]; return [x, z]; };

/** Checks of one design: bounds in every rotation, floating parts, window collisions, height, op count. Pure; pushes to `rep`. */
export function checkDesign(k: KindDef, design: KindDef['levels'][number]['designs'][number], where: string, live: boolean, rep: LandmarkReport) {
  const fp = k.footprint ?? { w: 1, h: 1, door: [0, 0] as [number, number] };
  const src: number[] = [];
  let ops: CompiledOp[] = [];
  try { ops = compileOps(design.ops, k.windows, src); } catch (err) { rep.errors.push(`${where}: does not compile: ${(err as Error).message}`); return; }
  const ext = partExtents(ops);
  const label = (j: number) => `op ${src[j]} ${JSON.stringify(design.ops[src[j]]).slice(0, 70)}`;
  let top = 0, floating = 0;
  ext.forEach((a, j) => {
    if (!a) return;
    top = Math.max(top, a[3]);
    // the footprint, turned to each of the four rotations the player can place it in: the whole model turns with it
    for (let r = 0; r < 4; r++) {
      const [hw, hd] = r % 2 ? [fp.h / 2, fp.w / 2] : [fp.w / 2, fp.h / 2];
      const corners = [[a[0], a[4]], [a[1], a[4]], [a[0], a[5]], [a[1], a[5]]].map(([x, z]) => turn(x, z, r));
      const xs = corners.map((c) => c[0]), zs = corners.map((c) => c[1]);
      if (Math.min(...xs) < -hw - 1e-6 || Math.max(...xs) > hw + 1e-6 || Math.min(...zs) < -hd - 1e-6 || Math.max(...zs) > hd + 1e-6) {
        rep.errors.push(`${where}: ${label(j)} leaves the ${fp.w}×${fp.h} footprint (x ${a[0].toFixed(3)}..${a[1].toFixed(3)}, z ${a[4].toFixed(3)}..${a[5].toFixed(3)}; the model runs x ±${fp.w / 2}, z ±${fp.h / 2}) at rotation ${r}`);
        break;
      }
    }
    if (a[2] < -1e-6) rep.errors.push(`${where}: ${label(j)} goes below the ground (y ${a[2]})`);
    const op = design.ops[src[j]];
    if (isFeature(op[0] as string) || op[0] === 'chimneyStack' || a[2] < 0.005) return;
    // supported when it stands on, or is attached to, another part it touches
    const touch = 0.02;
    const held = ext.some((b, m) => m !== j && b && b[0] - touch < a[1] && a[0] < b[1] + touch && b[4] - touch < a[5] && a[4] < b[5] + touch && b[2] - 0.01 <= a[2] && a[2] <= b[3] + 0.01);
    if (!held) { floating++; if (live) return; rep.errors.push(`${where}: ${label(j)} floats: nothing under or beside its base at y ${a[2].toFixed(3)}`); }
  });
  if (live && floating) rep.notes.push(`${where}: ${floating} part(s) with nothing under their base (the accepted set is the baseline)`);
  for (const h of windowCollisions(ops)) rep.errors.push(`${where}: ${label(h.part)} covers window(s) on the ${h.face} wall of ${label(h.box)}: ${h.windows.slice(0, 3).join('; ')}`);
  if (top > MAX_HEIGHT) rep.errors.push(`${where}: the tallest part reaches ${top.toFixed(2)} tiles; the limit is ${MAX_HEIGHT} (33 m a tile)`);
  else if (top > WARN_HEIGHT) rep.warnings.push(`${where}: ${top.toFixed(2)} tiles tall (over ${WARN_HEIGHT}); the Shard, the tallest in London, is 9.6`);
  if (Math.abs(top - design.height) > 0.03) rep.warnings.push(`${where}: height ${design.height} but the tallest part reaches ${top.toFixed(3)}`);
  if (ops.length > MAX_OPS) rep.errors.push(`${where}: ${ops.length} compiled ops; the limit is ${MAX_OPS} (warning over ${WARN_OPS})`);
  else if (ops.length > WARN_OPS) rep.warnings.push(`${where}: ${ops.length} compiled ops (over ${WARN_OPS}); use repeat() and the lathe and taper ops for repeated and curved parts`);
  if (!design.ops.some((o) => o[0] === 'door') && !live) rep.warnings.push(`${where}: no door op; the main door goes on the front (+z) wall (docs/landmarks.md section 4)`);
  rep.rows.push({ id: k.id, kindId: k.kindId ?? k.code, draft: !!k.draft, w: fp.w, h: fp.h, design: design.name, height: design.height, top: +top.toFixed(2), ops: ops.length, floating });
}

/**
 * Checks `kinds` (landmarks: from the catalogue, or from a file where they replace any kind of the same id). Returns the
 * report; the caller prints it.
 */
export function checkLandmarks(kinds: KindDef[], fromFile = false): LandmarkReport {
  const rep: LandmarkReport = { errors: [], warnings: [], notes: [], rows: [] };
  const cat = JSON.parse(JSON.stringify(CATALOGUE)) as KindDef[];
  for (const k of kinds) { const i = cat.findIndex((x) => x.id === k.id); if (i >= 0) cat[i] = k; else cat.push(k); }
  // the catalogue validator: ids, ops, palette colours, footprints, and the landmark rules (draft or live)
  const ids = new Set(kinds.map((k) => k.id));
  rep.errors.push(...validateCatalogue(cat, HELPER_MODELS).filter((e) => [...ids].some((id) => e.includes(`kind '${id}'`))));
  for (const k of kinds) {
    const w = `kind '${k.id}'`;
    if (!k.landmark) { rep.errors.push(`${w}: not a landmark (landmark: true)`); continue; }
    if (!k.tags?.length) rep.errors.push(`${w}: tags are empty (a draft carries ['draft']; add its city or era after it)`);
    if (typeof k.blurb !== 'string' || k.blurb.length < 20) rep.errors.push(`${w}: blurb missing or under 20 characters (one or two sentences, in the game's voice)`);
    else if (k.blurb.length > 400) rep.warnings.push(`${w}: blurb is ${k.blurb.length} characters; the picker card shows two or three lines`);
    if (typeof k.howTo !== 'string' || k.howTo.length < 20) rep.errors.push(`${w}: howTo missing or under 20 characters (how to place it well)`);
    if (k.id !== 'landmark-template') for (const [f, v] of [['name', k.name], ['blurb', k.blurb], ['howTo', k.howTo], ...k.levels.flatMap((l) => l.designs.flatMap((d) => [['design name', d.name], ['author', d.author]]))] as [string, string | undefined][]) if (v && /<[^>]+>/.test(v)) rep.warnings.push(`${w}: ${f} still has a <placeholder> from the template`);
    const designs = k.levels.flatMap((l, li) => l.designs.map((d) => ({ d, where: `${w} level ${(k.minLevel ?? 1) + li} "${d.name}"` })));
    if (!designs.length) rep.errors.push(`${w}: no design`);
    for (const { d, where } of designs) checkDesign(k, d, where, !k.draft && !fromFile, rep);
    if (k.draft) {
      // a draft can never reach the city: no tool, every design a draft, kind id in the reserved range
      if (k.tool) rep.errors.push(`${w}: a draft landmark has no tool`);
      if (designs.some(({ d }) => !d.draft)) rep.errors.push(`${w}: a draft landmark's designs all carry draft: true (a live design would reach the city batch)`);
      if (!k.tags?.includes('draft')) rep.errors.push(`${w}: a draft landmark carries the tag 'draft'`);
    } else {
      if (k.kindId !== undefined && k.kindId >= LANDMARK_DRAFT_IDS[0] && k.kindId <= LANDMARK_DRAFT_IDS[1]) rep.errors.push(`${w}: live kind id ${k.kindId} is inside the draft range ${LANDMARK_DRAFT_IDS.join('-')}`);
      if (designs.some(({ d }) => d.draft)) rep.warnings.push(`${w}: a live landmark with a draft design`);
    }
  }
  if (!fromFile) {
    // every live landmark stands in a city demo (the rule demo:check enforces)
    for (const p of showcaseProblems()) if (kinds.some((k) => !k.draft && p.startsWith(`${k.id} `))) rep.errors.push(`demo: ${p}`);
    // no catalogue kind outside the landmark drafts sits in the reserved range
    for (const k of CATALOGUE) if (!k.landmark && k.kindId !== undefined && k.kindId >= LANDMARK_DRAFT_IDS[0] && k.kindId <= LANDMARK_DRAFT_IDS[1]) rep.errors.push(`kind '${k.id}': kind id ${k.kindId} is in the reserved draft landmark range`);
  }
  return rep;
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Prints the report and returns the process exit code. */
export function printReport(rep: LandmarkReport, title: string): number {
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log(title);
  console.log(`  ${pad('kind', 26)}${pad('id', 5)}${pad('foot', 6)}${pad('height', 8)}${pad('ops', 6)}design`);
  for (const r of rep.rows) console.log(`  ${pad(r.id + (r.draft ? ' (draft)' : ''), 26)}${pad(r.kindId, 5)}${pad(`${r.w}×${r.h}`, 6)}${pad(r.top, 8)}${pad(r.ops, 6)}${r.design.slice(0, 60)}`);
  const live = rep.rows.filter((r) => !r.draft);
  if (live.length) console.log(`  reference, the ${live.length} live landmarks: ops ${Math.min(...live.map((r) => r.ops))}-${Math.max(...live.map((r) => r.ops))} (median ${median(live.map((r) => r.ops))}), height ${Math.min(...live.map((r) => r.top))}-${Math.max(...live.map((r) => r.top))} tiles; budget: warn over ${WARN_OPS} ops, fail over ${MAX_OPS}; height warn over ${WARN_HEIGHT}, fail over ${MAX_HEIGHT}`);
  for (const n of rep.notes) console.log('note: ' + n);
  for (const w of rep.warnings) console.log('warning: ' + w);
  if (rep.errors.length) { console.log(rep.errors.map((e) => 'FAIL ' + e).join('\n')); console.log(`\nlandmarks:check FAILED: ${rep.errors.length} problem(s) in ${rep.rows.length} design(s)`); return 1; }
  console.log(`\nlandmarks:check passed: ${rep.rows.length} design(s), ${rep.warnings.length} warning(s)`);
  return 0;
}

/** For a file: the exported array of KindDefs. */
export async function loadKindFile(file: string): Promise<KindDef[]> {
  const mod = await import(pathToFileURL(resolve(file)).href) as Record<string, unknown>;
  const list = Object.values(mod).find((v) => Array.isArray(v) && v.length && v.every((e) => e && typeof e === 'object' && 'levels' in e && 'id' in e)) as KindDef[] | undefined;
  if (!list) { console.error(`${file} exports no array of landmark kinds (KindDef[], like LANDMARK_DRAFTS in landmark-drafts.ts)`); process.exit(2); }
  return list;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (file) process.exit(printReport(checkLandmarks(await loadKindFile(file), true), `landmark kinds in ${file}`));
  const all = CATALOGUE.filter((k) => k.landmark);
  process.exit(printReport(checkLandmarks(all), `landmarks in the catalogue (${all.length} kinds)`));
}
