/**
 * npm run buildings:compile
 * Validates the building catalogue (packages/shared/src/buildings/*.ts) and
 * writes compiled.ts and recipes.ts next to it. Files are only rewritten when
 * their content changes, so watchers (tsx, Vite) only react to real edits.
 * `--check` exits 1 instead of writing when the output is stale.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOGUE, HELPER_MODELS } from '../src/buildings/catalogue';
import { compileCatalogue, emitCatalogue } from '../src/buildings/compile';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/buildings');
const checkOnly = process.argv.includes('--check');
let out;
try {
  out = emitCatalogue(compileCatalogue(CATALOGUE, HELPER_MODELS));
} catch (e) {
  console.error(`[buildings] ${(e as Error).message}`);
  process.exit(1);
}
let stale = 0;
for (const [name, text] of [['compiled.ts', out.compiled], ['recipes.ts', out.recipes]] as const) {
  const path = join(dir, name);
  const old = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (old === text) continue;
  stale++;
  if (!checkOnly) writeFileSync(path, text);
}
const designs = CATALOGUE.reduce((n, k) => n + k.levels.reduce((m, l) => m + l.designs.length, 0), 0);
const msg = `${CATALOGUE.length} kinds, ${designs} designs, catalogue ${out.hash}`;
if (checkOnly && stale) { console.error(`[buildings] compiled output is stale (${msg}); run npm run buildings:compile`); process.exit(1); }
console.log(`[buildings] ${stale ? (checkOnly ? 'stale' : 'compiled') : 'up to date'}: ${msg}`);
