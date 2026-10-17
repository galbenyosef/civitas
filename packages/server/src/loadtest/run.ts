/**
 * Load test entry point.
 *
 *   nice -n 10 npx tsx packages/server/src/loadtest/run.ts --districts 2 --days 3
 *
 * Re-launches itself under `node --loader tsx --loader ./count-hook.mjs` so pathfinding calls can be counted
 * (Node 20.2 has no module.register). `--no-count` runs in-process without the counters.
 * Options (see harness.ts): --districts N, --days D (max fill days, capped at 4), --built L, --seed S, --gap G,
 * --no-lots, --profile FILE (.cpuprofile of the measured day), --json FILE, --no-append, --doc FILE.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));

if (process.env.LOADTEST_CHILD || argv.includes('--no-count')) {
  const { main } = await import('./harness');
  await main(argv);
} else {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const hook = pathToFileURL(join(here, 'count-hook.mjs')).href;
  const flags = ['--no-warnings', '--expose-gc', '--loader', tsx, '--loader', hook];
  const child = spawn(process.execPath, [...flags, fileURLToPath(import.meta.url), ...argv], {
    stdio: 'inherit', env: { ...process.env, LOADTEST_CHILD: '1' },
  });
  child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
}
