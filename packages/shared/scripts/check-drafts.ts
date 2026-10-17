/**
 * Checks a file of draft designs (ExtraDesign[]) without registering it in the catalogue, so a designer can validate
 * work in a scratch file before it touches the live tree:
 *
 *   npx tsx packages/shared/scripts/check-drafts.ts <file.ts>
 *
 * Runs the catalogue validator with the designs appended, the window-collision rule (facade.ts), and two rules the
 * brief states that the validator does not: every part stays inside the tile, and nothing floats.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CATALOGUE, HELPER_MODELS } from '../src/buildings/catalogue';
import { validateCatalogue } from '../src/buildings/validate';
import { compileOps } from '../src/buildings/compile';
import { windowCollisions, isFeature } from '../src/buildings/facade';
import type { CompiledOp, KindDef, Op } from '../src/buildings/schema';
import type { ExtraDesign } from '../src/buildings/designs/index';

const file = process.argv[2];
if (!file) { console.error('usage: check-drafts.ts <file.ts>'); process.exit(2); }
const mod = await import(pathToFileURL(resolve(file)).href) as Record<string, unknown>;
const list = Object.values(mod).find((v) => Array.isArray(v)) as ExtraDesign[] | undefined;
if (!list) { console.error(`${file} exports no array of designs`); process.exit(2); }

const errors: string[] = [], warnings: string[] = [];
const cat = JSON.parse(JSON.stringify(CATALOGUE)) as KindDef[];
const names = new Set<string>();
list.forEach((e, i) => {
  const where = `#${i} ${e.kind}:${e.level} "${e.design?.name}"`;
  const k = cat.find((x) => x.id === e.kind);
  if (!k) { errors.push(`${where}: unknown kind "${e.kind}"`); return; }
  const lvl = k.levels[e.level - (k.minLevel ?? 1)];
  if (!lvl) { errors.push(`${where}: level ${e.level} does not exist`); return; }
  if (!e.design.draft) errors.push(`${where}: must be draft: true`);
  if (names.has(`${e.kind}:${e.level}:${e.design.name}`)) errors.push(`${where}: duplicate name`);
  names.add(`${e.kind}:${e.level}:${e.design.name}`);
  lvl.designs.push(e.design);

  let ops: CompiledOp[] = [];
  const src: number[] = [];
  try { ops = compileOps(e.design.ops, k.windows, src); } catch (err) { errors.push(`${where}: does not compile: ${(err as Error).message}`); return; }
  for (const h of windowCollisions(ops)) errors.push(`${where}: op ${src[h.part]} ${JSON.stringify(e.design.ops[src[h.part]]).slice(0, 70)} covers window(s) on the ${h.face} wall of op ${src[h.box]}: ${h.windows.slice(0, 3).join('; ')}`);

  // extents of each compiled part: [x0, x1, y0, y1, z0, z1]
  const ext = ops.map((o) => {
    if (o[0] === 'box' || o[0] === 'roof') return [o[4] - o[1] / 2, o[4] + o[1] / 2, o[5], o[5] + o[2], o[6] - o[3] / 2, o[6] + o[3] / 2];
    if (o[0] === 'cyl') { const r = Math.max(o[1], o[2]); return [o[4] - r, o[4] + r, o[5], o[5] + o[3], o[6] - r, o[6] + r]; }
    if (o[0] === 'cone') return [o[3] - o[1], o[3] + o[1], o[4], o[4] + o[2], o[5] - o[1], o[5] + o[1]];
    return null;
  });
  let top = 0;
  ext.forEach((a, j) => {
    if (!a) return;
    top = Math.max(top, a[3]);
    const op = e.design.ops[src[j]];
    const tag = `op ${src[j]} ${JSON.stringify(op).slice(0, 70)}`;
    if (a[0] < -0.5 - 1e-6 || a[1] > 0.5 + 1e-6 || a[4] < -0.5 - 1e-6 || a[5] > 0.5 + 1e-6) errors.push(`${where}: ${tag} leaves the tile (x ${a[0].toFixed(3)}..${a[1].toFixed(3)}, z ${a[4].toFixed(3)}..${a[5].toFixed(3)})`);
    if (a[2] < -1e-6) errors.push(`${where}: ${tag} goes below the ground (y ${a[2]})`);
    if (isFeature(op[0] as string) || op[0] === 'chimneyStack' || a[2] < 0.005) return;
    // supported when it stands on, or is attached to, another part it touches
    const touch = 0.02;
    const held = ext.some((b, m) => m !== j && b && b[0] - touch < a[1] && a[0] < b[1] + touch && b[4] - touch < a[5] && a[4] < b[5] + touch && b[2] - 0.01 <= a[2] && a[2] <= b[3] + 0.01);
    if (!held) errors.push(`${where}: ${tag} floats: nothing under or beside its base at y ${a[2].toFixed(3)}`);
  });
  if (Math.abs(top - e.design.height) > 0.03) warnings.push(`${where}: height ${e.design.height} but the tallest part reaches ${top.toFixed(3)}`);
});
errors.push(...validateCatalogue(cat, HELPER_MODELS).filter((x) => list.some((e) => x.includes(e.design.name))));

if (warnings.length) console.log(warnings.map((w) => 'warning: ' + w).join('\n'));
if (errors.length) { console.log(errors.join('\n')); console.log(`\n${errors.length} problem(s) in ${list.length} design(s)`); process.exit(1); }
console.log(`ok: ${list.length} design(s) pass`);
