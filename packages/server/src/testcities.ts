import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { join } from 'node:path';
import { DEMOS, DEMO_BY_ID, type DemoId } from '@msimcity/shared';
import type { World } from './world';

/**
 * Test cities in the browser (docs/load-tests.md, "Test cities in the browser").
 *
 * A dev server (NODE_ENV not production) lists pre-built N×N-district cities on `GET /api/test-cities` and starts
 * one on `POST /api/test-cities/<n>/start`. Each city is its own child process: this same server entry on port
 * 8100+n with its own world file under `data/test-cities/`, so a city can never touch the live world and a heavy one
 * cannot stall the live tick. A fresh city is seeded by `seedCity` (`CITY_DISTRICTS=n` in index.ts) and fast-filled
 * with citizens before it takes clients (`fillCity`, fill.ts). Idle cities (no clients for TEST_CITY_IDLE_MS, default
 * ten minutes) are stopped with SIGTERM, which saves the world, so starting one again is quick.
 *
 * Cities outlive the main server's restarts. `tsx watch` restarts the dev server on every save, and a test city can
 * take minutes to fill, so a child is detached (own process group, output in `data/test-cities/city-<n>.log`) and
 * listed in `data/test-cities/running.json`; the next server adopts it instead of spawning a second one. A child
 * never watches its parent. It has its own idle timer (`watchIdle`: no clients for TEST_CITY_IDLE_MS, save and exit),
 * so a city nobody returns to cleans itself up even with no main server around.
 * The parent stops its children only on an explicit stop request, on that same idle timeout, or on a real shutdown:
 * SIGINT (Ctrl-C on `npm run dev`) or TEST_CITY_STOP_ON_EXIT=1. SIGTERM is what tsx watch sends on a reload, so it
 * leaves them running (`stopsChildrenOn`).
 *
 * Demo maps (docs/demo.md) are a second kind of child world run the same way: the showcase and the focused demos of
 * shared/src/demo/showcase.ts, each in slot 90+ (port 8190 for the showcase), `DEMO=<id>` instead of CITY_DISTRICTS,
 * world files under `data/demos/`. Unlike test cities they are offered in production too (they are the tutorial), so the
 * launcher runs on every main server and only the test-city half is dev-only. Clients reach a demo through this server:
 * `/demo-ws/<id>` is proxied to the child's port (`upgrade`), so a deployment that publishes one port still works.
 * After its first fill a demo child saves a snapshot (`demo-<id>.seed.json`); Reset demo (`POST /api/demos/<id>/reset`)
 * stops the child, puts the snapshot back as its world and starts it again, so the town is exactly the one first seeded.
 */
export const TEST_CITY_SIZES = [1, 2, 3, 4, 6, 8] as const;
/** children listen 20 above this server's port (8080 → 8100+n), so a second stack (UAT on 9080) never meets the first */
export const TEST_CITY_BASE_PORT = Number(process.env.TEST_CITY_BASE_PORT ?? Number(process.env.PORT ?? 8080) + 20);
/** about what one fully grown district holds (docs/load-tests.md) */
const PER_DISTRICT = 950;
const IDLE_MS = Number(process.env.TEST_CITY_IDLE_MS ?? 10 * 60_000);
const POLL_MS = Number(process.env.TEST_CITY_POLL_MS ?? 2_000);

/** what a read-only showcase (SPECTATE) answers to a demo stop or reset, or a test-city start or stop */
const READ_ONLY_REFUSAL = 'Read-only showcase: demos cannot be stopped or reset here';
/** what a showcase pinned to its default demo (`onlyDemo`) answers to starting another */
const ONLY_DEMO_REFUSAL = 'This showcase only shows its own demo';

export type CityStatus = 'stopped' | 'starting' | 'running' | 'stopping';
/** what a test-city child reports on /healthz */
export interface ChildHealth {
  ok: boolean; pid?: number; districts?: number; demo?: string; startHash?: string; ready?: boolean; spectate?: boolean;
  chunks?: number; citizens?: number; clients?: number; day?: number; dayFrac?: number;
  fill?: { tick: number; of: number; pop: number };
  tickAvg?: number; tickP95?: number; tickMax?: number;
}
interface Entry {
  /** slot: districts for a test city (1-16), 90+ for a demo; the child listens on TEST_CITY_BASE_PORT + n */
  n: number; demo?: DemoId;
  proc: ChildProcess | null; pid: number | null; status: CityStatus; health: ChildHealth | null;
  idleSince: number | null; startedAt: number; failed?: string;
  /** a Reset demo is waiting for this child to stop */
  resetting?: Promise<void>;
}

export const testCitiesAvailable = () => process.env.NODE_ENV !== 'production' && !process.env.CITY_DISTRICTS && !process.env.DEMO;
/** The world launcher (demos everywhere, test cities on dev servers) runs on a main server, never inside a child world. */
export const worldLauncherAvailable = () => !process.env.CITY_DISTRICTS && !process.env.DEMO;

/** how to run a .ts entry with plain node: `--import tsx` needs Node 20.6+, older Node uses the loader flag */
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const TSX_FLAGS = nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 6) ? ['--import', 'tsx'] : ['--loader', 'tsx', '--no-warnings'];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const alive = (pid: number | null) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/** One line of `data/test-cities/running.json`: `{ "version": 1, "cities": RegistryEntry[] }` (`demo` set for a demo) */
export interface RegistryEntry { districts: number; port: number; pid: number; startedAt: number; demo?: string }

/**
 * Does this signal mean the dev stack is really going away (stop the cities) rather than reloading (leave them)?
 * tsx watch sends SIGTERM to the old server on every reload; Ctrl-C on `npm run dev` sends SIGINT.
 * TEST_CITY_STOP_ON_EXIT=1 makes any exit signal a real shutdown (a plain `npm start`, a service manager).
 */
export const stopsChildrenOn = (sig: NodeJS.Signals) => sig === 'SIGINT' || process.env.TEST_CITY_STOP_ON_EXIT === '1';

export class TestCities {
  private entries = new Map<number, Entry>();
  private timer: NodeJS.Timeout;
  /** resolves once the registry and the ports have been checked for children of an earlier server */
  private adopted: Promise<void>;
  /**
   * @param entry the server entry script to spawn, @param staticDir the built client the children serve,
   * @param cities offer test cities (dev servers), @param demoDir where demo worlds, snapshots and logs go,
   * @param spectate a read-only showcase (index.ts SPECTATE): demos may be started (that is how a visitor gets in), nothing else
   * @param onlyDemo a showcase's DEFAULT_DEMO: the only demo listed, started or joined (the others each cost a large child process)
   */
  constructor(private opts: { entry: string; staticDir: string; dataDir: string; cwd: string; cities: boolean; demoDir: string; spectate?: boolean; onlyDemo?: DemoId }) {
    if (opts.cities) for (const n of TEST_CITY_SIZES) this.entries.set(n, { n, proc: null, pid: null, status: 'stopped', health: null, idleSince: null, startedAt: 0 });
    for (const d of DEMOS) this.entries.set(d.slot, { n: d.slot, demo: d.id, proc: null, pid: null, status: 'stopped', health: null, idleSince: null, startedAt: 0 });
    this.timer = setInterval(() => { void this.poll(); }, POLL_MS);
    this.timer.unref();
    this.adopted = this.adopt();
  }

  private worldFile(n: number) { const d = this.entries.get(n)?.demo; return d ? join(this.opts.demoDir, `demo-${d}.json`) : join(this.opts.dataDir, `city-${n}x${n}.json`); }
  private logFile(n: number) { const d = this.entries.get(n)?.demo; return d ? join(this.opts.demoDir, `demo-${d}.log`) : join(this.opts.dataDir, `city-${n}.log`); }
  /** a demo's world as first seeded and filled: Reset demo starts from this */
  private snapshotFile(d: DemoId) { return join(this.opts.demoDir, `demo-${d}.seed.json`); }
  private registryFile() { return join(this.opts.dataDir, 'running.json'); }
  /** what a child of this entry reports on /healthz to prove it is that entry */
  private isOurs(e: Entry, h: ChildHealth | null) { return !!h && (e.demo ? h.demo === e.demo : h.districts === e.n); }
  private label(e: Entry) { return e.demo ? `demo ${e.demo}` : `test city ${e.n}×${e.n}`; }

  /** Rewrite running.json from the live entries (atomic rename; the file is removed content-wise by listing nothing). */
  private persist() {
    const cities: RegistryEntry[] = [...this.entries.values()]
      .filter((e) => e.status !== 'stopped' && e.pid)
      .map((e) => ({ districts: e.n, port: TEST_CITY_BASE_PORT + e.n, pid: e.pid!, startedAt: e.startedAt, ...(e.demo ? { demo: e.demo } : {}) }));
    try {
      mkdirSync(this.opts.dataDir, { recursive: true });
      const tmp = this.registryFile() + '.tmp';
      writeFileSync(tmp, JSON.stringify({ version: 1, cities }, null, 2) + '\n');
      renameSync(tmp, this.registryFile());
    } catch (err) { console.error('test cities: cannot write running.json', err); }
  }

  private readRegistry(): RegistryEntry[] {
    try {
      const j = JSON.parse(readFileSync(this.registryFile(), 'utf8')) as { cities?: RegistryEntry[] };
      return Array.isArray(j.cities) ? j.cities : [];
    } catch { return []; }
  }

  private lastLines(n: number, count = 3) {
    try { return readFileSync(this.logFile(n), 'utf8').split('\n').filter((l) => l.trim()).slice(-count).join(' | '); } catch { return ''; }
  }

  /**
   * Pick up children an earlier server left running. A registry entry is adopted when its pid is alive and /healthz on
   * its port answers as that pid for the same number of districts; anything else is dropped as stale. A city that
   * answers on its port without an entry (started by a server from before the registry) is adopted too.
   */
  private async adopt() {
    const listed = new Map(this.readRegistry().map((r) => [r.districts, r]));
    for (const e of this.entries.values()) {
      const r = listed.get(e.n);
      const h = await this.fetchHealth(e.n);
      const live = this.isOurs(e, h) && h!.pid && alive(h!.pid) && (!r || r.pid === h!.pid);
      if (live && !!h!.spectate !== !!this.opts.spectate) { // left by a server run the other way (SPECTATE on or off): it must not be adopted as it is
        console.log(`${this.label(e)}: running child (pid ${h!.pid}) is ${h!.spectate ? '' : 'not '}read-only, unlike this server; stopping it`);
        try { process.kill(h!.pid!, 'SIGTERM'); } catch { /* gone */ }
        const t0 = Date.now();
        while (alive(h!.pid!) && Date.now() - t0 < 60_000) await sleep(250);
      } else if (live) {
        Object.assign(e, { proc: null, pid: h!.pid!, status: h!.ready ? 'running' : 'starting', health: h, idleSince: null, startedAt: r?.startedAt ?? Date.now() });
        console.log(`${this.label(e)}: adopted running child (pid ${e.pid}, port ${TEST_CITY_BASE_PORT + e.n})`);
      } else if (r) console.log(`${this.label(e)}: dropped stale registry entry (pid ${r.pid})`);
    }
    this.persist();
  }

  private async fetchHealth(n: number): Promise<ChildHealth | null> {
    try {
      const r = await fetch(`http://127.0.0.1:${TEST_CITY_BASE_PORT + n}/healthz`, { signal: AbortSignal.timeout(1500) });
      return r.ok ? ((await r.json()) as ChildHealth) : null;
    } catch { return null; }
  }

  /** Refresh each live child's health, notice adopted children that went away, and stop the idle ones. */
  private async poll() {
    for (const e of this.entries.values()) {
      if (e.status === 'stopped') continue;
      const h = await this.fetchHealth(e.n);
      if (!e.proc && !(h && h.pid === e.pid) && !alive(e.pid)) { // an adopted child has no exit event to watch
        console.log(`${this.label(e)}: child ${e.pid} is gone`);
        Object.assign(e, { pid: null, status: 'stopped', health: null, idleSince: null });
        this.persist();
        continue;
      }
      if (h) {
        e.health = h;
        if (e.status === 'starting' && h.ready) e.status = 'running';
        if (e.status === 'running') {
          if ((h.clients ?? 0) > 0) e.idleSince = null;
          else if (e.idleSince === null) e.idleSince = Date.now();
          else if (Date.now() - e.idleSince > IDLE_MS) { console.log(`${this.label(e)}: idle for ${Math.round(IDLE_MS / 1000)} s, stopping`); this.stop(e); }
        }
      }
    }
  }

  /** Starts city n (a no-op if it is running or adopted); call after `adopted` so a surviving child is not fought over its port. */
  start(n: number): Entry | null {
    const e = this.entries.get(n);
    if (!e) return null;
    if (e.status !== 'stopped') return e;
    mkdirSync(this.opts.dataDir, { recursive: true });
    if (e.demo) mkdirSync(this.opts.demoDir, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of ['SIM_STEPS', 'SEED_BUILT', 'SEED', 'PARENT_PID', 'CITY_DISTRICTS', 'DEMO', 'DEMO_SNAPSHOT', 'SPECTATE']) delete env[k];
    Object.assign(env, {
      PORT: String(TEST_CITY_BASE_PORT + n), HOST: '0.0.0.0', WORLD_FILE: this.worldFile(n), STATIC_DIR: this.opts.staticDir,
      ...(e.demo ? { DEMO: e.demo, DEMO_SNAPSHOT: this.snapshotFile(e.demo) } : { CITY_DISTRICTS: String(n) }),
      ...(this.opts.spectate ? { SPECTATE: '1' } : {}), // a read-only showcase is read-only in every child world too
    });
    // Detached into its own process group (a Ctrl-C on the dev stack must not reach it; this server stops it on purpose)
    // and writing to a file, not a pipe, so it can outlive this process without hitting EPIPE.
    const out = openSync(this.logFile(n), 'w');
    const proc = spawn(process.execPath, [...TSX_FLAGS, this.opts.entry], { cwd: this.opts.cwd, env, stdio: ['ignore', out, out], detached: true });
    closeSync(out);
    proc.unref();
    Object.assign(e, { proc, pid: proc.pid ?? null, status: 'starting', health: null, idleSince: null, startedAt: Date.now(), failed: undefined });
    proc.on('exit', (code, sig) => {
      console.log(`${this.label(e)} exited (${sig ?? code})`);
      if (e.status === 'starting' && code) e.failed = this.lastLines(n);
      Object.assign(e, { proc: null, pid: null, status: 'stopped', health: null, idleSince: null });
      this.persist();
    });
    proc.on('error', (err) => { e.failed = String(err); Object.assign(e, { proc: null, pid: null, status: 'stopped' }); this.persist(); });
    this.persist();
    console.log(`${this.label(e)}: starting on port ${TEST_CITY_BASE_PORT + n} (pid ${proc.pid}, log ${this.logFile(n)})`);
    return e;
  }

  /** Start a demo by id once any surviving children have been adopted (index.ts: DEFAULT_DEMO is started with the server). */
  async startDemo(id: DemoId) {
    await this.adopted;
    const d = DEMO_BY_ID.get(id);
    if (d) this.start(d.slot);
  }

  /**
   * Reset demo: stop the child (it saves, and the save is then thrown away), put the snapshot of the first seeding back
   * as its world (or remove the world so it seeds again, when there is no snapshot yet) and start it again.
   */
  private reset(e: Entry): Promise<void> {
    if (!e.demo) return Promise.resolve();
    if (e.resetting) return e.resetting;
    const d = e.demo;
    e.resetting = (async () => {
      if (e.status === 'starting' && !existsSync(this.snapshotFile(d))) return; // a first fill is already under way: that is the reset
      this.stop(e);
      const t0 = Date.now();
      while (e.status !== 'stopped' && Date.now() - t0 < 70_000) { await sleep(250); if (!e.proc && !alive(e.pid)) Object.assign(e, { pid: null, status: 'stopped', health: null }); }
      try {
        if (existsSync(this.snapshotFile(d))) copyFileSync(this.snapshotFile(d), this.worldFile(e.n));
        else if (existsSync(this.worldFile(e.n))) unlinkSync(this.worldFile(e.n));
      } catch (err) { console.error(`${this.label(e)}: reset could not restore the snapshot`, err); }
      console.log(`${this.label(e)}: reset to ${existsSync(this.snapshotFile(d)) ? 'its first seeding' : 'a fresh seeding'}`);
      this.persist();
      this.start(e.n);
    })().finally(() => { e.resetting = undefined; });
    return e.resetting;
  }

  /**
   * WebSocket upgrades for `/demo-ws/<id>`: piped to the demo child's port, so clients only ever need this server's
   * origin (the same port in production). Returns false for any other path, leaving it to the game's own socket.
   */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const m = /^\/demo-ws\/([a-z]+)$/.exec((req.url ?? '').split('?')[0]);
    if (!m) return false;
    const d = DEMO_BY_ID.get(m[1] as DemoId);
    const e = d && (!this.opts.onlyDemo || d.id === this.opts.onlyDemo) ? this.entries.get(d.slot) : undefined;
    if (!e || e.status !== 'running') { socket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n'); return true; }
    const up = connect(TEST_CITY_BASE_PORT + e.n, '127.0.0.1');
    const close = () => { socket.destroy(); up.destroy(); };
    up.on('connect', () => {
      let lines = `${req.method} / HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      up.write(lines + '\r\n');
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', close); socket.on('error', close); up.on('close', close); socket.on('close', close);
    return true;
  }

  /** SIGTERM saves the world; if the child has not gone after 60 s it is killed (the save is an atomic rename). */
  private stop(e: Entry) {
    if (e.status === 'stopped' || e.status === 'stopping') return;
    e.status = 'stopping';
    const pid = e.pid;
    if (pid === null) return;
    try { process.kill(pid, 'SIGTERM'); } catch { Object.assign(e, { pid: null, proc: null, status: 'stopped' }); this.persist(); return; }
    const t = setTimeout(() => { if (e.pid === pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }, 60_000);
    t.unref();
    // the registry entry goes when the child does: its exit event, or for an adopted child the next poll that finds it dead
  }

  /** Stop every child and wait (up to `ms`) for them to save and go. Only for a real shutdown (`stopsChildrenOn`). */
  async stopAll(ms = 10_000) {
    await this.adopted;
    const live = [...this.entries.values()].filter((e) => e.status !== 'stopped');
    const pids = live.map((e) => e.pid);
    for (const e of live) this.stop(e);
    const t0 = Date.now();
    while (Date.now() - t0 < ms && pids.some((p) => alive(p))) await sleep(100);
    for (const e of live) if (!alive(e.pid)) Object.assign(e, { pid: null, proc: null, status: 'stopped' });
    this.persist();
  }

  private demoView(e: Entry) {
    const h = e.health, d = DEMO_BY_ID.get(e.demo!)!;
    const fill = h?.fill && !h.ready ? Math.min(1, h.fill.tick / h.fill.of) : undefined;
    return {
      id: d.id, name: d.name, blurb: d.blurb, sections: d.sections, port: TEST_CITY_BASE_PORT + e.n, status: e.resetting ? 'resetting' : e.status,
      saved: existsSync(this.worldFile(e.n)), snapshot: existsSync(this.snapshotFile(d.id)),
      citizens: h?.citizens, clients: h?.clients, dayFrac: h?.dayFrac, fill, fillPopulation: h?.fill?.pop, startHash: h?.startHash,
      startedAt: e.startedAt || undefined, error: e.status === 'stopped' ? e.failed : undefined,
    };
  }

  private view(e: Entry) {
    const h = e.health;
    const fill = h?.fill && !h.ready ? Math.min(1, h.fill.tick / h.fill.of) : undefined;
    return {
      districts: e.n, port: TEST_CITY_BASE_PORT + e.n, approxPopulation: PER_DISTRICT * e.n * e.n, status: e.status,
      saved: existsSync(this.worldFile(e.n)), savedBytes: existsSync(this.worldFile(e.n)) ? statSync(this.worldFile(e.n)).size : 0,
      citizens: h?.citizens, clients: h?.clients, dayFrac: h?.dayFrac, fill, fillPopulation: h?.fill?.pop,
      tickAvg: h?.ready ? h.tickAvg : undefined, tickP95: h?.ready ? h.tickP95 : undefined, tickMax: h?.ready ? h.tickMax : undefined,
      startedAt: e.startedAt || undefined, error: e.status === 'stopped' ? e.failed : undefined,
    };
  }

  /** Answers /api/test-cities and /api/demos requests; returns false for any other URL. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const path = (req.url ?? '').split('?')[0];
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const demos = path === '/api/demos' || path.startsWith('/api/demos/');
    if (!demos && path !== '/api/test-cities' && !path.startsWith('/api/test-cities/')) return false;
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': '*' }); res.end(); return true; }
    if (demos) {
      const list = [...this.entries.values()].filter((e) => e.demo && (!this.opts.onlyDemo || e.demo === this.opts.onlyDemo));
      if (path === '/api/demos') { send(200, { available: true, idleMinutes: IDLE_MS / 60_000, demos: list.map((e) => this.demoView(e)) }); return true; }
      const dm = /^\/api\/demos\/([a-z]+)\/(start|stop|reset)$/.exec(path);
      const e = dm ? list.find((x) => x.demo === dm[1]) : undefined;
      if (!dm || req.method !== 'POST') { send(404, { error: 'POST /api/demos/<id>/start, /stop or /reset' }); return true; }
      if (!e && this.opts.onlyDemo && DEMO_BY_ID.has(dm[1] as DemoId)) { send(403, { error: ONLY_DEMO_REFUSAL }); return true; }
      if (!e) { send(404, { error: `no demo called ${dm[1]}` }); return true; }
      if (this.opts.spectate && dm[2] !== 'start') { send(403, { error: READ_ONLY_REFUSAL }); return true; }
      void this.adopted.then(() => {
        if (dm[2] === 'stop') this.stop(e); else if (dm[2] === 'reset') void this.reset(e); else this.start(e.n);
        send(200, this.demoView(e));
      });
      return true;
    }
    if (!this.opts.cities) { send(200, { available: false }); return true; }
    if (path === '/api/test-cities') {
      send(200, { available: true, idleMinutes: IDLE_MS / 60_000, cities: [...this.entries.values()].filter((e) => !e.demo).map((e) => this.view(e)) });
      return true;
    }
    const m = /^\/api\/test-cities\/(\d+)\/(start|stop)$/.exec(path);
    if (!m || req.method !== 'POST') { send(404, { error: 'POST /api/test-cities/<n>/start' }); return true; }
    const e = this.entries.get(Number(m[1]));
    if (!e || e.demo) { send(404, { error: `no ${m[1]}×${m[1]} test city` }); return true; }
    if (this.opts.spectate) { send(403, { error: READ_ONLY_REFUSAL }); return true; }
    void this.adopted.then(() => { if (m[2] === 'stop') this.stop(e); else this.start(e.n); send(200, this.view(e)); });
    return true;
  }
}

/** Child side: the fast-fill moved to fill.ts (pure, for local mode); re-exported for older importers. */
export { fillCity } from './fill';

/**
 * Child side: call `onIdle` once nobody has been connected for `ms` (TEST_CITY_IDLE_MS, default ten minutes). Start it
 * when the city is ready to take clients. The child does not look at its parent: it keeps running across main-server
 * restarts, and this is what stops an orphan nobody comes back to.
 */
export function watchIdle(clients: () => number, onIdle: () => void, ms = IDLE_MS) {
  let since = Date.now();
  const t = setInterval(() => {
    if (clients() > 0) since = Date.now();
    else if (Date.now() - since >= ms) { clearInterval(t); onIdle(); }
  }, Math.min(5_000, Math.max(500, ms / 4)));
  t.unref();
}
