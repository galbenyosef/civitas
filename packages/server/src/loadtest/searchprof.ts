/**
 * Search probe (docs/search-perf.md): fill the London demo (or a seedCity test city) as its child process does
 * (probe-city.ts probeGame: the whole game step, metro, harbours, finance, issues and the network flush included), then
 * run one more game day and look at the searches in it.
 *
 *   npx tsx packages/server/src/loadtest/searchprof.ts [--demo london | --districts 8] [--days 1] [--mode phases]
 *       [--json FILE] [--cpu-prof FILE] [--out DIR]
 *
 * Modes (the day after the fill; the fill itself is never instrumented, so every mode plays the same game):
 *  - `bare`: tick times only, no wrappers (the baseline; with --cpu-prof, an inspector CPU profile of the day)
 *  - `phases`: the tick split into phases by self time (route searches by kind, job searches cached and real, the traffic
 *    step and moveVehicles, and the rest by step), with every search's time and nodes expanded
 *  - `record`: the search corpus of the day (search-corpus.ts) written to --out DIR, for search-replay.ts and tools/search-rs
 *  - `reroutes`: A* by caller, re-route outcomes and the traffic, with `--set k=v,...` (TRAFFIC_TUNING) from the day on
 *    (reroute-probe.ts)
 *
 * Re-launches itself under `node --loader tsx --loader ./count-hook.mjs` (as run.ts does) with the same node binary, so
 * the probe can replace the exported search functions; the hook's own counters are taken off again.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'phases';

if (process.env.SEARCHPROF_CHILD) {
  const { main } = mode === 'reroutes' ? await import('./reroute-probe') : await import('./search-phases');
  await main(argv);
} else {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const hook = pathToFileURL(join(here, 'count-hook.mjs')).href;
  const flags = ['--no-warnings', '--expose-gc', '--max-old-space-size=8192', '--loader', tsx, '--loader', hook];
  const child = spawn(process.execPath, [...flags, fileURLToPath(import.meta.url), ...argv], {
    stdio: 'inherit', env: { ...process.env, SEARCHPROF_CHILD: '1', SEARCH_HOOK_EXPANDED: mode === 'bare' ? '0' : '1' },
  });
  child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
}
