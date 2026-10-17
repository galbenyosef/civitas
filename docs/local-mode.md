# Local mode: Civitas with no server

UTD card c5fe9155, "local mode, no internet server required". Status: phases **B** (Node-API shims) and **A** (transport seam)
are done (card f8c2a1d5), **E** (build) and **C** (worker host + persistence) are done (card 5ccde920), and **D** (UI) and **F**
(PWA) are done (card 5ff7785c), all 2026-10-17, see "Done so far" below. The online game is unchanged.

## Done so far (phases D and F)

Try it: online build, join form, **Play offline** (reloads into `?local`); or `npm run build:local` and serve `packages/client/dist-local/`
(`cd packages/client && npx vite preview --mode offline --host 0.0.0.0 --port 4174`; the PWA part needs https or `http://localhost`, see below).

* **Join form (`local/ui.ts`).** Online page: a **Play offline** button under Join world (not on `?ws=`, `?city=` or demo pages); it reloads into `?local`
  (the page picks its transport once at load; `?dev` is kept). In a local game the form shows the mayor name, "Your city: day N, M citizens, saved <date>" with
  **Continue** (or "No city yet" with **Start a new city**), **New game…**, **Saves…**, and a link back to the online server (not in the static build). The city
  is paused behind the form and unpaused on join. The world picker, test-city and demo code never runs in local mode (no `/api/*` fetches). The login overlay now
  scrolls (`#login` flex + `overflow-y: auto`, in `local/local.css`), since the online form with the picker plus the new button is taller than a laptop window.
* **Top bar.** After the clock: pause/play, a 1× 2× 4× segmented control, `saves`, and "saved HH:MM" (autosaves and manual ones). A "Paused · Space to resume" badge
  hangs under the bar. Keys (no single letter was free; `input.ts` ignores these): **Space** pause/resume, **+ / =** faster, **-** slower, **Ctrl/Cmd+S** save now.
  The chips do not take focus, so Space never double-fires. The online-only bits are hidden: "online N" in the world stats, the "connected" chip. Onboarding goals work
  (the server-side `Onboarding` runs in the worker; sandbox games turn it off as before). The client clock fix (`rate`) had already landed with phase C.
* **Saves dialog (`SavesDialog`).** *This city* (day, citizens; save under a name; export file), *Saved cities* (label, day, citizens, size, date; **Load**, **Rename**,
  **Export**, **Delete** with a second click; **Import a file…** keeps the file as a saved city; the two autosaves are listed under a fold, loadable and exportable),
  *New game…* (seed as a number or any word, hashed; sandbox checkbox) and *Storage* (usage and quota from `navigator.storage.estimate()`, whether the browser promised
  to keep the saves, a button to ask, and the install button when the browser offers one). Load and New game replace the running city, so they first offer to keep it as a
  named save (checked by default once the city has a day or citizens), because the rolling autosaves would overwrite it within a minute. After a load, import or new game the
  page reloads and joins straight back in (sessionStorage `civitas.autojoin` + the remembered mayor name), no form. New host control `rename {slot, label}`.
* **PWA (phase F).** Static build only (`vite build --mode offline`): `public-local/` holds `manifest.webmanifest` and the icons (made by `packages/client/scripts/make-icons.mjs`,
  plain PNG encoding, the favicon's towers: 192, 512, maskable 512, apple-touch 180); a Vite plugin (`offlinePwa` in vite.config.ts) injects the manifest, apple-touch-icon and
  theme-color links and, after the bundle is written, turns `sw.template.js` into `dist-local/sw.js` with the list of every emitted file (not the source maps) and a hash of
  them as the cache version. `sw.js`: precache everything on install, cache-first (ignoring the query string, so `?name=` and friends hit the same page), navigation fallback to
  `index.html`, old caches dropped on activate, no `skipWaiting` (a new version applies when the old one's tabs close; the page toasts "a new version is ready").
  `registerServiceWorker` registers it from `main.ts` only when `__LOCAL_ONLY__`: the online build, and `?local` on it, never get a service worker, so online play is untouched.
  Browsers only allow service workers on https and `localhost`: `http://192.168.x.x:4174` works as a game but not offline, `http://localhost:4174` and any https host do.
  `navigator.storage.persist()` is asked after each manual or auto save (cheap, remembered by the browser); if it is refused, a one-time toast says the browser may clear the
  saves and to export now and then, and the saves dialog repeats it with a button to ask again.
* Not done: dead-code removal of the WebSocket path from the static build, `file://`, an update toast with a reload button, auto-picking local when no server answers.
* Test: scratchpad `pw/local-ui-e2e.mjs` (online Play offline, join form, goals card, Space/+/-, saves dialog save/rename/export/import, new game keeping the old city, load,
  Ctrl+S, service worker, offline reload with `context.setOffline(true)`).

## Done so far (phases E and C)

Try it: `?local` on any build (`http://<host>:8080/?local`, or the Vite dev server), or `npm run build:local` and serve
`packages/client/dist-local/` from any static server bound to 0.0.0.0 (`cd packages/client && npx vite preview --mode offline --host 0.0.0.0 --port 4174`).
The join form starts a local game in this tab (the top-bar controls are described under phases D and F).

* **Build (E).** `client/src/local/worker.ts` is the worker entry; `local/client.ts` creates it with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`,
  which Vite emits as its own chunk (`worker: { format: 'es' }` in vite.config.ts; 466 KB minified, 135 KB gzip), fetched only when local mode starts.
  `npm run build:local` is `vite build --mode offline` (Vite reserves the mode name `local` for `.env.local`): `__LOCAL_ONLY__` true (declared in
  `client/src/globals.d.ts`), `base: './'`, output `dist-local/` (gitignored). `main.ts` starts local mode when `__LOCAL_ONLY__ || ?local`, skips the world picker
  and the test-city/demo connect there; `?dev` gives the local game dev tools. Not yet: dead-code removal of the WebSocket path, picker and `/api` fetches in the
  static build (it still carries them, unused), `file://` (needs a static server, section 5).
* **Guard (E).** `npm run local:check` now bundles `local/core.ts`, the client worker entry and `local/host.ts` for the browser (no Node module, no bare `process.`, no `ws`
  or `require`), then drives the core over a MessageChannel (as before) and the host with an in-memory store: hello held behind the boot, 5 ticks/s, 4× (20/s, stats
  with `rate: 4`), pause (`rate: 0`, clock stopped), two alternating autosaves plus a named one, gzip world.json that the server's reader opens, plain export,
  import (replaces, closes the old connection, `switched`), import into a slot, refusal of junk and of v999, new game, load, delete, and a second host resuming the
  newest autosave. It takes about 5 s and runs at the end of **`npm run typecheck`**.
* **Host (C), `client/src/local/host.ts`** (browser APIs only, no DOM; typechecked by both the client and the server tsconfigs). `LocalHost(endpoint, store, { devTools })`:
  * Boot: newest readable autosave (`auto-1`/`auto-2` by `savedAt`; an unreadable one is reported and the other tried), else `new World(random seed)` + `seedCommons`
    like index.ts. A `Gate` holds the client's `connect`/`hello` until the game is up. One game per browser profile: the worker takes the `civitas-local` Web Lock
    (4 s wait, then a fatal "already running in another tab").
  * Clock: fixed timestep, one `game.loop()` per TICK_MS of wall time with `game.steps` = speed (1, 2, 4), at most 3 catch-up loops, the rest of a backlog dropped.
    Switching to 2×/4× first steps the tick to a multiple of 4 so flush()'s every-5/every-10-tick messages (stats, lines, traffic) still land. Adaptive guard:
    after a minute at 2×/4× with a p95 loop over 150 ms it drops to 1× and toasts why.
  * Clock for the client: `Net.rate` (server/src/net.ts) goes into the stats message as `rate` only when it is not 1 (0 paused, 2, 4), so online stats are
    byte-identical; `Net.sendStats()` sends it at once on pause/speed. `main.ts` multiplies its interpolation (`liveHour`, `liveTick`, `liveTickF`, the train/plane
    clock) by it. Net's stationary-agent keep-alive now turns on flush count instead of `tick % 10`, so with several ticks a flush every agent still gets re-sent
    (at 2×/4× half the ids would have expired on clients after 6 s).
  * Saves (`SaveStore`; `client/src/local/idb.ts` is IndexedDB `civitas` with stores `meta` and `data`, one transaction per save): JSON.stringify of `snapshotOf`
    (synchronous, it stalls the sim), then `CompressionStream('gzip')` (plain JSON when absent). Autosave every 30 s on a tick boundary when the tick moved or a
    client sent anything, into the older of `auto-1`/`auto-2`; named slots by `save {slot}`. Quota errors toast "export the city". The hidden tab saves and pauses,
    and resumes when shown (local/client.ts).
  * Export: the running city or a slot as gzip world.json (`.json.gz`; `gzip: false` for plain). A server's `data/world.json` gunzipped is the same file.
    Import: gzip or plain, through `worldFromSnapshot` (old versions upgrade, junk and too-new versions are refused with a message and the game is kept);
    without a slot it replaces the game, with one it is a named save.
  * Load / import / new game swap the game in the worker: the old connections are closed (code 4001), the new game is autosaved at once, and the worker posts
    `{ctl:'switched'}`; `LocalGame.onSwitched` reloads the page into it by default.
  * Control channel: see the comment at the top of host.ts (`info`, `pause`, `speed`, `save`, `listSaves`, `load`, `deleteSave`, `export`, `import`, `newGame`;
    events `state`, `saved`, `error`, `switched`). `LocalGame` (local/client.ts) wraps it in promises for phase D (`listSaves`, `load`, `deleteSave`, `newGame`,
    `exportSave` to a download, `importFile`); `navigator.storage.persist()` is asked on the first save. `msc.local` in the console; `self.civitas` in the worker.
* **Measured** (2026-10-17, M2 Max shared with other agents). Node, same worlds: fresh Commons 0.2 ms a loop; test city 3x3 imported (9,654 citizens) 22 ms avg,
  33 ms p95. Headless Chrome worker alone (no rendering): fresh 23 ms avg; the 3x3 city 135 ms avg, 378 ms p95 (first tick after load 6.7 s), its save 11.7 MB of
  JSON in 116 ms + gzip and IndexedDB 228 ms = 1.6 MB stored; import of its 1.7 MB .gz plus the first autosave 15.7 s. Headless Chrome on this machine runs plain JS
  3-10× slower than Node (a bare loop: 167 ms Node, 509 ms in a worker), so treat the browser numbers as an upper bound; with the full client rendering in the same
  headless browser the fresh world's loop was 200-360 ms. A desktop browser in the foreground still needs measuring (phase D playtest).
* End to end (headless Chrome against `dist-local` on a static server, scratchpad `pw/local-e2e.mjs`): join, the city ticks, buy land and lay a road, pause stops
  the clock (rate 0), 4× (rate 4), save, reload, the road is still there, export downloads a `.json.gz`, bulldoze, import the file, the page reloads with the road back.
  `?local` on the server-served build (`:8080/?local`) starts a local game too, and the online join is unchanged.

## Done so far (phases B and A)

Server (`packages/server/src`):
* `env.ts`: `env(k)` reads `process.env` when there is one and is undefined in a worker. `sim/carpool.ts` (`CARPOOL`) and
  `sim/traffic.ts` (`CONFLICT_LAST_MARGIN`) use it; no module in the game graph reads `process` at load any more.
* `snapshot.ts`: the save format, pure: `snapshotOf(w)`, `worldFromSnapshot(snap)` (null for an unreadable version),
  `readableVersion`, `SNAPSHOT_VERSION`, `type Snapshot`. `store.ts` is now only the Node file wrappers `saveWorld`/`loadWorld`
  (tmp + rename, the `.vN.bak` move-aside) and re-exports the pure functions. A copy of the live world round-trips with the same hash.
* `fill.ts`: `fillCity` and `yieldNow` (setImmediate in Node, a zero timeout elsewhere). `demo/seed.ts` and `index.ts` import it from
  here; `testcities.ts` re-exports it for older importers (`loadtest/jobsearch.ts`).
* `transport.ts` (pure): `Conn`, `ConnSource`, `PortSource` (MessagePort or worker scope; `{ctl:'connect'}` opens a connection on the
  endpoint or on a port it carries and is answered `{ctl:'ready'}`; `{ctl:'close'}` either way; other `{ctl}` objects go to
  `PortSource.onControl` for the phase C host), `isControl`. `transport-ws.ts` (Node only): `WsSource(http)`.
* `net.ts`: `new Net(world, sim, source: ConnSource, cfg: GameConfig)`, `Client.conn` instead of `Client.ws`, no `ws`/`node:http`
  import. `GameConfig = { devTools, sandbox }` replaces the `DEV`/`TEST_CITY` constants (sandbox also turns off onboarding goals, as before).
* `game.ts` (pure): `createGame(world, source, cfg, steps)` does the post-load wiring (recount roads, Commons tech top-up, Simulation,
  Airports with the gateway `onArrival` hook, Rail as transit mode, freight and trucks, Net) and returns
  `{ world, sim, airports, rail, net, tickWin, steps, step(), loop() }`; `loop()` is the old `setInterval` body (ticks, flush,
  TickWindow, slow-tick warning). `tuneEconomy(spec)` is the `ECON` override.
* `index.ts` is the Node host: same env vars, ports and flows (RESET marker, test cities, demos with seeded `Math.random`, `/healthz`,
  static files, `/demo-ws` piping, signals, idle stop). It creates the http server, `createGame(world, new WsSource(http), { devTools:
  NODE_ENV !== 'production', sandbox: CITY_DISTRICTS || DEMO }, SIM_STEPS)` and runs `setInterval(game.loop, TICK_MS)`.
* `loadtest/harness.ts` builds `Net` with a no-op source; its fake clients are `Conn`s.
* `local/core.ts`: what a worker imports (World, seedCommons, createGame, PortSource, snapshot functions, fillCity, worldHash).
  `local/check.ts` (`npm run local:check`) bundles it with esbuild for `platform: 'browser'` (fails on any Node module, bare `process.`,
  `ws` or `require`; about 920 KB unminified), then imports that bundle in Node and drives a game over a `MessageChannel`: connect,
  ready, hello, welcome, sub, 20 loops with stats, close, reconnect, refusal while not accepting, snapshot round trip. This is the seed of
  the phase E guard; wire it into CI/typecheck there.

Client (`packages/client/src/net.ts`): `ClientSocket` (`open`, `retry`, `send`, `close`, `onopen`/`onmessage`/`onclose`), `WsSocket(url)`
(the old WebSocket code), `WorkerSocket(worker | port)` (posts `{ctl:'connect'}`, opens on `{ctl:'ready'}`, `oncontrol` for other control
messages). `NetClient` takes a URL (as before, so `main.ts` and `net.url = ...` for test cities are unchanged) or a `() => ClientSocket`
factory; it reconnects after 1.5 s only for sockets with `retry` (WebSockets). Nothing selects the worker yet (phase D/E).

Not done in these phases, as planned: the worker entry and Vite config (E), the IndexedDB store, worker loop, pause/speed (C), any UI (D).

Goal: single-player, fully offline Civitas. The authoritative simulation runs in a Web Worker, speaks the same
JSON protocol as today over an in-memory `MessagePort`, saves to IndexedDB, and ships as a static build that any
static host serves (later: PWA, then a desktop wrapper). The online game keeps working unchanged.

Numbers below were measured on the current tree on 2026-10-17 (grep of `packages/*/src`, an esbuild browser bundle
into the scratchpad, `data/*.json` sizes). Anything not measured is marked **unverified**.

## 1. What is pure TypeScript and what needs Node

`packages/shared/src` has **no Node imports at all** and no `process`/`Buffer` use (codec.ts base64 uses
`btoa`/`atob`, which exist in workers). Its only non-pure global is `Math.random` as a default argument
(occupations.ts:22). `packages/shared/scripts/*` and `packages/client/vite.config.ts` use `node:fs/path/url/child_process`
but are build-time tools and never bundled.

`packages/server/src` is pure TS except these files (the rest of `world.ts`, `pathfinding.ts`, `sim/*`, `seed.ts`,
`tickstats.ts`, `demo/london.ts`, `loadtest/cities.ts` are pure; a browser esbuild bundle of World + Simulation +
Airports + Rail + Net + store + seed built with only `fs`, `path`, `ws`, `http` marked external is 430 KB minified,
126 KB gzipped):

| File | Node API | Browser replacement |
| --- | --- | --- |
| `index.ts` | `node:http` `createServer`, `node:stream` `Duplex` (type), `node:fs/promises` `readFile`/`stat`, `node:fs` `existsSync`/`renameSync`/`unlinkSync`/`readFileSync`/`copyFileSync`, `node:os` `networkInterfaces`, `node:path`, `node:url` `fileURLToPath` + `import.meta.url`, `process.env.*` (PORT, HOST, WORLD_FILE, STATIC_DIR, SIM_STEPS, CITY_DISTRICTS, DEMO, DEMO_SNAPSHOT, SEED_BUILT, SEED), `process.pid`, `process.on(SIGINT/SIGTERM)`, `process.exit`, `setInterval`, `performance.now` | Not bundled. A new worker host (`local/host.ts`) replaces it. The world bootstrap (load or seed, `Simulation`, `Airports`, `Rail` wiring, main-loop body) moves into a shared `createGame()` that both hosts call. `setInterval`, `performance.now`, `console` exist in workers as is. |
| `net.ts` | `ws` (`WebSocketServer`, `WebSocket.OPEN`), `node:http` `Server` (type), `process.env.NODE_ENV` (the `DEV` flag, line 31), `process.env.CITY_DISTRICTS`/`DEMO` (`TEST_CITY`, line 33) | `Transport` seam (section 2). `DEV` and `TEST_CITY` become a `GameConfig` passed to the constructor. |
| `store.ts` | `node:fs` `readFileSync`/`writeFileSync`/`renameSync`/`existsSync`/`mkdirSync`, `node:path` `dirname` | Split into pure `snapshotOf(world)` / `worldFromSnapshot(snap)` plus thin Node file wrappers; the worker uses IndexedDB (section 3). |
| `testcities.ts` | `node:child_process` `spawn`, `node:fs` (many), `node:http` types, `node:net` `connect`, `node:stream`, `node:path`, `process.kill`/`execPath`/`versions`/`env` | Not bundled. But **`fillCity` lives here** and is imported by `index.ts` and `demo/seed.ts`; move it (and `fillDemo`'s helpers if they live here) to a pure `fill.ts` so the worker graph never reaches `child_process`. |
| `sim/carpool.ts:20` | `process.env.CARPOOL` | In a worker `process` is undefined, so this **throws at module load**. Add `env.ts`: `export const env = (k: string) => (globalThis as any).process?.env?.[k]` and use it. |
| `sim/traffic.ts:142` | `process.env.CONFLICT_LAST_MARGIN` | Same `env()` helper. |
| `demo/check.ts`, `loadtest/*` | `process.argv`, `fs`, `child_process`, `os`, `Buffer`, `process.memoryUsage` | Dev-only CLIs, unreachable from the worker entry. Keep out of the bundle (a CI check, phase E). |

Also relevant: `demo/seed.ts` temporarily replaces `Math.random` (seeded demos). It is only used by demo launches,
which local mode v1 does not offer.

Client-side Node-isms: none at runtime. `worlds.ts` and `tour.ts` `fetch('/api/test-cities')` and `/api/demos`;
those must be skipped in local mode (section 6, phase D). `main.ts:104` builds the WebSocket URL from `location`.

## 2. The transport seam

### Today

Server (`net.ts`): `new Net(world, sim, http)` creates `new WebSocketServer({ server: http })`. On `connection` it builds a
`Client { ws, player, subs, ... }`, parses each message as `ClientMsg` JSON, and calls `handle()`. All output goes through
`send()`/`broadcast()` plus three direct loops (`net.ts:641` the lines message, and the per-client `send` loops in
`flush()`); each checks `c.ws.readyState === WebSocket.OPEN` and calls `c.ws.send(JSON.stringify(m))`. `flush()` is called once per
tick by `index.ts`. `Net` also exposes `accepting`, `connections`, `tickStats`.

Client (`client/src/net.ts`, 48 lines): `NetClient(url)` wraps a `WebSocket`, sends `hello` on open, JSON-parses every
frame, dispatches by `m.t`, counts `rx` for the perf HUD, and reconnects after 1.5 s on close.

The protocol is already transport-neutral: `ClientMsg`/`ServerMsg` are typed in `shared/src/protocol.ts`, strings of JSON.

### Proposal

Server side, in `server/src/transport.ts`:

```ts
/** One connected client, whatever carries it. */
export interface Conn {
  readonly open: boolean;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(fn: (data: string) => void): void;
  onClose(fn: () => void): void;      // also fires on error
}
/** Where connections come from. Net subscribes once. */
export interface ConnSource { onConnection(fn: (c: Conn) => void): void }
```

* `WsSource(http)` wraps `WebSocketServer({ server: http })`; each `ws` is adapted to `Conn` (`open` = `readyState === OPEN`,
  `onMessage` does `data.toString()`, `onClose` is `close` + `error`).
* `PortSource(port: MessagePort | DedicatedWorkerGlobalScope)` yields exactly one `Conn` (or one per `port` handed over
  with a `{ctl:'connect'}` message, which also allows two tabs sharing a SharedWorker later). `send` is `port.postMessage(string)`,
  `onMessage` is `port.onmessage`, `open` is a boolean cleared on `close()`.
* `Net` changes: constructor takes `(world, sim, source: ConnSource, cfg: GameConfig)`; `Client.ws` becomes `Client.conn`;
  `readyState === OPEN` becomes `conn.open` (5 sites); `ws.close(1013, 'starting')` stays as `conn.close(...)`. No handler logic changes.
  `GameConfig = { devTools: boolean; sandbox: boolean }` replaces the two `process.env` constants (`DEV`, `TEST_CITY`).
  `index.ts` passes `devTools: process.env.NODE_ENV !== 'production'`, `sandbox` from `CITY_DISTRICTS`/`DEMO`, so Node behaviour is identical.

Client side, in `client/src/net.ts`:

```ts
export interface ClientSocket {
  readonly open: boolean;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null; onmessage: ((data: string) => void) | null; onclose: (() => void) | null;
}
```

* `WsSocket(url)` is the current `WebSocket` code. `WorkerSocket(worker)` posts strings to the worker and fires `onopen`
  once the worker reports `{ctl:'ready'}`.
* `NetClient` takes a factory `() => ClientSocket` instead of a URL (keep `url` as a convenience for the existing `?ws=` and test-city paths).
  Reconnect timer: only for `WsSocket` (a worker never drops; if it dies, show "the game crashed, reload from your last save").
* Frame format: keep **strings** over the port (identical to the wire, so `rx.bytes` and the perf HUD keep working and phase A
  is a pure refactor). A later optimisation can send objects and skip `JSON.stringify`/`parse`, but `Net.flush()` already
  stringifies once per frame and parse cost on the main thread was fine over a LAN.
* Control channel for things that are not the game protocol (save, load, export, pause, speed) is a separate envelope: the main thread posts
  `string` for game frames and `{ctl: ...}` objects for control; the worker host tells them apart with `typeof`.
  This keeps `ClientMsg`/`ServerMsg` untouched and unavailable to online clients.

Client picks the transport at boot (`main.ts:104`): `?local` (or the local-only build, section 5) creates the worker and a
`WorkerSocket`; otherwise `WsSocket` as now. `hello` carries the mayor name as today; the name is remembered in `localStorage`
and the join form submits automatically for a returning mayor.

## 3. Persistence

### What exists

`store.ts` is "one function pair behind a JSON snapshot", format `VERSION = 7` with in-place upgrades from 3 to 6, written
`path.tmp` then renamed (atomic), 30 s autosave from `index.ts`. Untouched chunks are not stored (regenerate from the seed);
a version it cannot read is renamed `.vN.bak` and a new world starts.

### Sizes (measured)

| World | Citizens | `world.json` | gzip |
| --- | --- | --- | --- |
| live `data/world.json` | 1,906 | 2.7 MB | 0.37 MB |
| test city 3x3 | 9,518 | 11.6 MB | 1.7 MB |
| test city 8x8 | ~60k+ | 95.6 MB | n/a |

Citizens dominate: the 3x3 file has 11.4 MB of citizens against 0.18 MB of chunks, about **1.2 KB per citizen**, because every
`Citizen` is written with its transient mover state (`pts`, `cross`, `node`, `xdir`, `leg`, `legs`, `in7`/`out7`, ...) that
`loadWorld` immediately resets (everyone resumes at home, `store.ts` near the end). Dropping the transient fields from the
snapshot should cut a world roughly 2-3x before compression (**unverified**: confirm `addCitizen` and the sim do not need `pts`/`cross`
restored, and bump `VERSION` to 8 only if the format changes; missing fields simply take defaults).

### Plan

1. **Pure snapshot functions.** `snapshotOf(w): Snapshot` and `worldFromSnapshot(snap): World | null` (the version check, upgrades, building
   re-index, citizen resume). Node `saveWorld`/`loadWorld` become 5-line wrappers. No behaviour change for the server.
2. **IndexedDB store in the worker** (IndexedDB is available in dedicated workers). Database `civitas`, object store `saves`:
   `{ slot, name, savedAt, day, citizens, version, bytes: ArrayBuffer }`, where `bytes` is `CompressionStream('gzip')` of the JSON
   snapshot (supported in workers in current Chrome, Firefox, Safari; fall back to uncompressed if absent). One IndexedDB `put` is a
   transaction, so it is atomic and replaces the tmp+rename dance. Keep the last 2 autosaves (`auto-1`, `auto-2`) plus named manual slots.
   OPFS is the alternative for very large saves (`createSyncAccessHandle` is worker-only and fast), but `move()` for atomic replace is not
   yet universal; start with IndexedDB and revisit only if saves above ~50 MB matter.
3. **Cadence.** Autosave every 30 s of wall time like the server, but only on a tick boundary and not while paused (nothing changed).
   `JSON.stringify` of 3 MB takes tens of ms and of 12 MB roughly a second (**unverified in a browser**); it runs in the worker so it stalls
   the sim, not rendering. Also save on `visibilitychange: hidden` (main thread posts `{ctl:'save'}`; a `pagehide` write cannot be awaited so
   it is best effort), and on explicit "Save now". Show "saved HH:MM" in the HUD and a toast on failure (quota).
4. **Export / import.** Export = the same gzip JSON, handed to the main thread as a Blob and downloaded as `civitas-<mayor>-day<N>.json.gz`
   (also offer plain `.json`). Import = `<input type=file>`, the main thread posts the `ArrayBuffer` to the worker, which gunzips, runs it
   through `worldFromSnapshot` (so old versions upgrade and bad files are rejected with a message instead of replacing the current game),
   and offers "Replace current game / save as new slot". Because the format is the server's `world.json`, **a server save can be opened offline and
   an offline save can be put on a server** with no converter.
5. **Storage hygiene.** Call `navigator.storage.persist()` on first save and show `navigator.storage.estimate()` in the saves dialog. Safari evicts
   script-writable storage of un-installed sites after 7 days without a visit; say so in the UI and nag toward export (the PWA install in phase F lifts the limit).
6. A new game asks for a mayor name and optional seed (`new World(seed)` + `seedCommons`), exactly what `index.ts` does when no file exists.

## 4. Tick loop, performance, what to turn off

**Loop.** `index.ts` runs `setInterval(..., TICK_MS = 200)`, each firing `SIM_STEPS` (default 1) x `sim.tick(); airports.tick()`, then `net.flush()`,
recording the elapsed time in a `TickWindow` (the numbers sent in `stats` for the perf HUD). In the worker, keep the same body but replace the bare
`setInterval` with a fixed-timestep accumulator: `acc += elapsed; while (acc >= TICK_MS/speed && steps < 5) { tick; acc -= ... }`
so a stalled worker catches up a few ticks instead of drifting, and drop the rest. `SIM_STEPS` becomes a runtime **speed** (pause, 1x, 2x, 4x), which
single-player wants anyway.

* **Pause when hidden.** Workers are timer-throttled in background tabs in some browsers (**unverified per browser**) and a hidden single-player game
  should not burn battery. Main thread posts `{ctl:'pause'}` on `visibilitychange`; resume on show.
* **Client clock.** `main.ts` interpolates `liveHour`/`liveTick` from the last `stats` message using `performance.now()` at a fixed rate. With pause and speed
  it needs a `rate` field: add `rate` (0, 1, 2, 4) to the `stats` message and multiply the interpolation by it, otherwise the day/night cycle and signal phases keep
  running while the sim is paused. Small client change, easy to miss.

**Cost.** From `docs/load-tests.md`: tick cost is roughly linear in citizens, about 2-6 ms per 1,000 citizens on a desktop. Budget at 5 Hz is an average
under 50 ms. 2x2 districts (3.8k citizens) is inside the budget on a desktop (the logged "slow tick" of 339 ms on test city 2 was on a heavily shared machine);
3x3 (8.5k) breaks it at rush hour (worst ticks 264-636 ms); 8x8 averages 76 ms. A laptop-class browser in a worker should be near Node speed (V8 is the same
engine; **unverified**), a phone 3-5x slower. Memory: heap stays under 120 MB at 34k citizens, far below worker limits.
Local mode therefore targets 1x1 to 2x2 cities comfortably; add an adaptive guard (if the p95 tick exceeds 150 ms for a minute, drop to 1x and toast
"your city is bigger than this device can run in real time").

The main thread no longer pays for a network, only for `JSON.parse` of frames (as today) and the worker's `postMessage` structured clone of strings (cheap).
Rendering is unchanged: the worker keeps the sim off the render thread, so frame time should improve versus a same-thread design.

**Disable or hide in local mode:**
* Test cities and demo maps: not started (`worldLauncherAvailable` irrelevant, `testcities.ts` not bundled). The `WorldPicker`, `reviveCity`, `reviveDemo`,
  `showCityBanner`, `/api/*` fetches are all skipped. Possible later feature: "Sandbox city" presets generated in the worker with `seedCity` + `fillCity` and a progress bar
  (the fill of a 2x2 city took the server about a minute of wall time on a shared machine, **unverified** for a browser); demo snapshots are 13-50 MB and are out of scope.
* Multiplayer-only features: the online player count, other players' ledgers in the `players` message, the `sys` Commons player stay (the Commons is the starting district,
  and land is bought from the map), but the "online" chip and chat-like UI go. Name collisions cannot happen with one client.
* Dev tools: `DEV` is process-env driven on the server, and the client sends `dev: true` only with `?dev` (`input.ts:7`). In local mode `GameConfig.devTools`
  defaults to **false**, `true` when the page is opened with `?dev` (single player has no one to cheat against, but draft buildings and free money should stay opt-in).
  Test-city sandbox behaviour (`TEST_CITY`: all tech, unlimited funds on join) maps to a "sandbox mode" checkbox on New game (`sandbox: true`).
* `process.on(SIGINT)`, `/healthz`, static serving, `watchIdle`, the RESET marker: server concerns, not ported. A "Reset world" button deletes the slot instead.

## 5. Build

The worker entry is `packages/server/src/local/worker.ts` (imports `createGame`, `Net`, `PortSource`, the IndexedDB store). The client creates it with
`new Worker(new URL('../../server/src/local/worker.ts', import.meta.url), { type: 'module' })` (or the same file re-exported from a client path), which Vite 5
bundles as its own chunk (`worker.format: 'es'`). Because it is loaded only when local mode starts, **online users do not download it**.

Two build outputs from the same source:

1. **Default build** (`npm run build`, served by the Node server): gains a "Play offline" button; the worker chunk is lazy. This is the first deliverable and needs no new build.
2. **Static build** (`npm run build:local` = `vite build --mode local`): `base: './'`, `define: { __LOCAL_ONLY__: true }` removes the WebSocket path, the world picker, the demo/test-city code
   and the `/api` fetches by dead-code elimination, drops `viewer.html` (or keeps it, it is 18 KB), and writes `dist-local/` that any static host serves
   (GitHub Pages, S3, `npx serve`, nginx). `process.env.NODE_ENV` is replaced by Vite; any leftover `process` use would throw, so the CI check below greps the worker chunk for `node:` and `process.`.

Size (from `packages/client/dist` today plus the measured sim bundle):

| Piece | Raw | Gzip |
| --- | --- | --- |
| client `main` + css | 263 KB | ~80 KB (**unverified**, estimate) |
| three.js chunk (`lighting`) | 1.25 MB | ~320 KB (**unverified**, estimate) |
| worker chunk (World, Simulation, Net, store, seed, catalogue) | ~430 KB | ~126 KB (measured) |
| **Total** | **~1.95 MB** | **~0.53 MB** |

The building catalogue (`compiled.ts` 395 KB source, `recipes.ts` 533 KB source) is in both the client and the worker bundles; de-duplicating it across the worker boundary
is not worth the effort at this size.

**`file://` caveat.** Chrome and Firefox refuse module scripts and module workers from `file://` (opaque origin), and IndexedDB on `file://` is per-file in Firefox
and flaky elsewhere. "Open `index.html` from disk" therefore does not work out of the box. Options: (a) require any static server (`python3 -m http.server`), documented;
(b) a single-file build (`vite-plugin-singlefile` plus the worker inlined with `?worker&inline` as a Blob URL, classic script instead of module) that runs from disk but with
unreliable saves; recommend (a) now and (b) only if asked. A packaged desktop app (Tauri/Electron) serves the same build from a custom protocol and sidesteps the issue.
**Unverified in all browsers.**

## 6. Phased plan

Order: B, A, E, C, D, F. Each phase leaves the online game working and shippable.

| Phase | Work | Size | Model |
| --- | --- | --- | --- |
| B. Node-API shims | `env.ts` helper for `process.env` in `carpool.ts`/`traffic.ts`; pure `snapshotOf`/`worldFromSnapshot` in `store.ts` with Node wrappers; extract `fillCity` to `fill.ts`; extract `createGame()` (bootstrap + loop body) from `index.ts`; `GameConfig` replaces the `DEV`/`TEST_CITY` constants. Acceptance: Node server and test-city/demo launches behave identically (`npm run demo:check`, a load-test run, a saved world reloads with the same hash). | M | opus (touches the live server's startup path) |
| A. Transport seam | `Conn`/`ConnSource` + `WsSource` + `PortSource` in the server; `Net` takes a source and config; client `ClientSocket`, `WsSocket`, `WorkerSocket`, `NetClient(factory)`. Acceptance: online game unchanged; a Node test drives `Net` over an in-memory `PortSource` pair through hello, sub, build and a few ticks. | M | opus (protocol, `net.ts` is 719 lines) |
| E. Build (done) | worker entry stub that boots a world and answers `hello`; Vite worker config; `build:local` mode with `__LOCAL_ONLY__`; CI/`typecheck` script that bundles the worker graph with esbuild `--platform=browser` and fails on any `node:` import or bare `process` use. Smoke: open `dist-local` via a static server, a town grows. | S-M | sonnet |
| C. Worker host + persistence (done) | Fixed-timestep loop with pause/speed and adaptive guard; IndexedDB store with gzip, autosave cadence, two rolling autosaves, named slots; control channel (`save`, `load`, `export`, `import`, `newGame`, `listSaves`, `deleteSave`, `pause`, `speed`); error and quota handling; slimmer citizen snapshot (optional, with a version bump). | L | opus |
| D. UI (done) | "Play offline" on the join form (and auto-pick local when no server answers, or in the `__LOCAL_ONLY__` build); New game dialog (name, seed, sandbox); Saves dialog (list, load, delete, export, import, storage estimate); pause/speed buttons; `rate` in `stats` and the client clock fix; hide online-only UI and `/api` fetches; "saved" indicator; hidden-tab pause. | M | sonnet |
| F. PWA / offline cache (done) | web manifest, icons, service worker precaching the build (versioned, update toast), `navigator.storage.persist()`, install prompt wiring; offline test (airplane mode). Desktop wrapper (Tauri) is a later, separate card. | S-M | sonnet |

Total: about 2 L-equivalents of work, mostly in B, A and C. Phase B alone is valuable regardless (it removes the `process.env` landmine and makes the server testable).

## 7. Risks and unknowns

* **Phase B is the real risk.** `index.ts` is a startup script with module-level side effects (RESET marker, demo seeding, signal handlers); extracting `createGame()` without changing the
  demo/test-city flows (which spawn it as a child with env vars and depend on `Math.random` being swapped during seeding) needs care. Mitigation: keep `index.ts` as the thin Node host and diff
  `worldHash` for a seeded demo before and after.
* **Hidden `process` use.** Any `process.env` read in a module executed in the worker throws at load. Found two (`carpool.ts`, `traffic.ts`); the CI bundle check keeps it that way as other agents add code.
* **Tuning knobs lost.** Env-var knobs (`CARPOOL`, `CONFLICT_LAST_MARGIN`) are dev-only; local mode just uses defaults.
* **Save size and speed in the browser** (unverified): `JSON.stringify` + gzip of a 10k-citizen city may stall the worker for about a second per autosave; slimmer snapshots and
  maybe `CompressionStream` off the critical path mitigate. Quota is usually hundreds of MB but is not guaranteed; Safari's 7-day eviction needs the export nudge or PWA install.
* **Background-tab throttling** of worker timers (unverified per browser); design assumes we pause explicitly, so it should not matter.
* **Mobile performance.** The sim is tuned against a 50 ms average on a desktop; phones may only manage 1x1 cities in real time. The adaptive guard degrades gracefully but the experience is unproven.
* **Client clock and lighting** assume a free-running 5 Hz server; pause/speed needs the `rate` field or the sky and signals desync (small but easy to miss).
* **`file://`** does not work for module workers (see section 5); set expectations.
* **Long-term drift.** Every server-only feature added by other agents (new env knobs, `fs` use, `http` endpoints, children) can silently break the worker graph; the phase E bundle check is the guard and should
  run in `npm run typecheck`.
* **Determinism.** The sim uses `Math.random` freely (simulation.ts, gateways.ts, rail.ts), so local saves are not replayable or seed-reproducible beyond the map. Not a problem, noted so nobody promises replays.
* **Protocol versioning.** Client and worker ship together in one bundle, so there is no skew online-to-local; but an imported save from a newer server than the bundle is refused by `VERSION` (message, no data loss).
* **Multi-tab.** Two tabs on the same origin would run two workers against one IndexedDB slot and overwrite each other's autosaves. Use the Web Locks API (`navigator.locks`) for a single "active game" lock per slot (unverified in the Safari versions we care about).
