/**
 * `npm run warm:check` (docs/demo.md, "Warming and rebuilding"): the warm run and the scenario hash, against a real server.
 *
 *   npx tsx packages/server/src/loadtest/warm.ts [--port 9061]
 *
 * Starts the server on a spare port with a temp data dir and three runs, asserting after each:
 *  1. WARM_DEMOS=showcase,civic KEEP_DEMOS=showcase: showcase builds first (queue 0, civic 1), never two children building at once,
 *     both end with a current save and a meta file whose hash is the one on /api/demos, civic is stopped and the showcase still running.
 *  2. The same with SCENARIO_VERSION=2 (WARM_DEMOS=showcase): the showcase's save is set aside as `.stale-<old hash>` and it seeds again
 *     under a new hash.
 *  3. Once more unchanged: the showcase resumes (no re-seed, no new stale file, the same meta).
 * About three minutes (the showcase fills in about a minute and a half, the civic demo faster).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, '../..'); // packages/server
const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1] || 9061);
const CHILD_BASE = PORT + 500; // children on CHILD_BASE + 90 …
const [major, minor] = process.versions.node.split('.').map(Number);
const TSX = major > 20 || (major === 20 && minor >= 6) ? ['--import', 'tsx'] : ['--loader', 'tsx', '--no-warnings'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { failed++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };

interface DemoRow { id: string; status: string; saved: boolean; scenarioHash: string; saveCurrent: boolean; warming: boolean; queue: number; kept?: boolean }
const api = async (): Promise<DemoRow[] | null> => {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/api/demos`, { signal: AbortSignal.timeout(2000) }); return ((await r.json()) as { demos: DemoRow[] }).demos; } catch { return null; }
};

const tmp = mkdtempSync(join(tmpdir(), 'warm-check-'));
const dataDir = join(tmp, 'data');
mkdirSync(dataDir, { recursive: true });
const demoDir = join(dataDir, 'demos');
const meta = (id: string) => { try { return JSON.parse(readFileSync(join(demoDir, `demo-${id}.meta.json`), 'utf8')) as { scenarioHash: string }; } catch { return null; } };
const stale = (id: string) => (existsSync(demoDir) ? readdirSync(demoDir).filter((f) => f.startsWith(`demo-${id}.json.stale-`)) : []);

let srv: ChildProcess | null = null;
let logFile = '';
const log = () => { try { return readFileSync(logFile, 'utf8'); } catch { return ''; } };

async function start(env: Record<string, string>, tag: string) {
  const { openSync } = await import('node:fs');
  logFile = join(tmp, `server-${tag}.log`);
  const out = openSync(logFile, 'w');
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of ['WARM_DEMOS', 'KEEP_DEMOS', 'DEFAULT_DEMO', 'SPECTATE', 'SCENARIO_VERSION', 'CITY_DISTRICTS', 'DEMO']) delete clean[k];
  srv = spawn(process.execPath, [...TSX, 'src/index.ts'], {
    cwd: server, stdio: ['ignore', out, out],
    env: { ...clean, PORT: String(PORT), HOST: '127.0.0.1', TEST_CITY_BASE_PORT: String(CHILD_BASE), WORLD_FILE: join(dataDir, 'world.json'), STATIC_DIR: join(tmp, 'none'), NODE_ENV: 'production', ...env },
  });
  for (let i = 0; i < 60; i++) { if (await api()) return; if (srv.exitCode !== null) break; await sleep(500); }
  throw new Error(`the server did not come up; log:\n${log().slice(-1500)}`);
}

/** SIGINT: the server saves and stops its children; by pid only, with a kill of the server pid as the last resort */
async function stop() {
  if (!srv?.pid) return;
  const pid = srv.pid;
  try { process.kill(pid, 'SIGINT'); } catch { srv = null; return; } // already gone
  for (let i = 0; i < 160 && srv.exitCode === null && srv.signalCode === null; i++) await sleep(250);
  if (srv.exitCode === null && srv.signalCode === null) { console.log('  server did not stop on SIGINT; killing it'); try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  srv = null;
}

async function untilDone(maxMs: number, sample: (rows: DemoRow[]) => void) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const rows = await api();
    if (rows) sample(rows);
    if (log().includes('warm run done')) return true;
    await sleep(1000);
  }
  return false;
}

async function main() {
  if (await api()) throw new Error(`port ${PORT} is already serving /api/demos; pass --port`);
  const t0 = Date.now();
  try {
    // ---- 1. build in order, keep one
    console.log('run 1: WARM_DEMOS=showcase,civic KEEP_DEMOS=showcase');
    await start({ WARM_DEMOS: 'showcase,civic', KEEP_DEMOS: 'showcase' }, '1');
    const first = await api();
    check(!!first && first.length === DEMO_COUNT, `/api/demos lists the demos (${first?.length})`);
    const order: string[] = [];
    let maxBuilding = 0, sawQueue0 = '', sawQueue1 = '';
    const done1 = await untilDone(8 * 60_000, (rows) => {
      maxBuilding = Math.max(maxBuilding, rows.filter((r) => r.status === 'starting').length);
      for (const r of rows) { if (r.queue === 0 && r.warming) sawQueue0 ||= r.id; if (r.queue === 1) sawQueue1 ||= r.id; }
    });
    check(done1, 'the warm run finished');
    for (const m of log().matchAll(/^demo (\w+): ready after/gm)) order.push(m[1]); // the civic demo is stopped within a second of being ready, too fast to catch on a poll
    check(order.join(',') === 'showcase,civic', `ready in order showcase, civic (log says ${order.join(', ')})`);
    check(sawQueue0 === 'showcase' && sawQueue1 === 'civic', `queue 0 was the showcase and queue 1 the civic demo (saw ${sawQueue0}, ${sawQueue1})`);
    check(maxBuilding <= 1, `never more than one child building at once (max ${maxBuilding})`);
    await sleep(3000);
    const rows1 = (await api()) ?? [];
    const row = (id: string) => rows1.find((r) => r.id === id);
    check(row('showcase')?.status === 'running', `the showcase is still running (${row('showcase')?.status})`);
    check(row('civic')?.status === 'stopped', `the civic demo is stopped (${row('civic')?.status})`);
    for (const id of ['showcase', 'civic']) {
      const r = row(id);
      check(!!r && /^[0-9a-f]{8}$/.test(r.scenarioHash) && r.saved && r.saveCurrent === true && r.warming === false && r.queue === -1, `${id}: saved, current, not warming, queue -1, hash ${r?.scenarioHash}`);
      check(meta(id)?.scenarioHash === r?.scenarioHash, `${id}: demo-${id}.meta.json carries the hash /api/demos reports`);
    }
    check(row('showcase')?.kept === true && row('civic')?.kept === false, 'kept is true for the showcase only');
    const h1 = meta('showcase')!.scenarioHash;
    await stop();

    // ---- 2. a bumped SCENARIO_VERSION rebuilds
    console.log('run 2: SCENARIO_VERSION=2');
    await start({ WARM_DEMOS: 'showcase', KEEP_DEMOS: 'showcase', SCENARIO_VERSION: '2' }, '2');
    check(/demo showcase: re-seeding \(SCENARIO_VERSION 1 → 2\)/.test(log()), 'the log says the showcase is re-seeding because of SCENARIO_VERSION');
    check(stale('showcase').includes(`demo-showcase.json.stale-${h1}`), `the old save is set aside as demo-showcase.json.stale-${h1}`);
    check(await untilDone(8 * 60_000, () => undefined), 'the warm run finished');
    const h2 = meta('showcase')?.scenarioHash;
    check(!!h2 && h2 !== h1, `the meta hash changed (${h1} → ${h2})`);
    check((await api())?.find((r) => r.id === 'showcase')?.scenarioHash === h2, '/api/demos reports the new hash');
    check(existsSync(join(demoDir, 'demo-civic.json')), 'the civic demo (not in this warm list) was left alone');
    check(/seeded the town/.test(readFileSync(join(demoDir, 'demo-showcase.log'), 'utf8')), 'the showcase child seeded the town again');
    await stop();

    // ---- 3. unchanged resumes
    console.log('run 3: unchanged');
    const staleBefore = stale('showcase').join(',');
    await start({ WARM_DEMOS: 'showcase', KEEP_DEMOS: 'showcase', SCENARIO_VERSION: '2' }, '3');
    check(/demo showcase: resumed/.test(log()) && !/re-seeding/.test(log()), 'the log says the showcase resumed, no re-seed');
    check(await untilDone(3 * 60_000, () => undefined), 'the warm run finished');
    check(meta('showcase')?.scenarioHash === h2, 'the meta is unchanged');
    check(stale('showcase').join(',') === staleBefore, 'no new stale file');
    const childLog = readFileSync(join(demoDir, 'demo-showcase.log'), 'utf8');
    check(/loaded world from/.test(childLog) && !/seeded the town/.test(childLog), 'the showcase child loaded its save instead of seeding');
    await stop();
  } finally {
    await stop();
    console.log(`(${Math.round((Date.now() - t0) / 1000)} s; server logs and data in ${tmp})`);
  }
  if (failed) { console.log(`warm check: ${failed} FAILED`); process.exit(1); }
  console.log('warm check: all passed');
  rmSync(tmp, { recursive: true, force: true });
}
const DEMO_COUNT = (await import('@msimcity/shared')).DEMOS.length;
main().catch(async (e) => { console.error(e); await stop(); process.exit(1); });
