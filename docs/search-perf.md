# Route and job searches: what they cost, and whether to move them to Rust

The question (2026-10-19): would the route searches and job searches be worth moving to Rust? That would mean a
native Node module (napi-rs, with rayon threads) on the server and the same crate as WebAssembly in local mode,
with the TypeScript versions kept as the fallback and the reference. This doc measures what the searches cost in a
London tick, replays every search of a London day in TypeScript and in a Rust port, and projects the gain.

**Short answer: not now.** Searches are 14% of a London tick (A\* is 13%, job searches 0.04%). A faithful Rust port
of the searches is 7.4 times faster than TypeScript on one thread, but the whole tick only gets about 13% faster, and
extra threads add very little. The traffic step is three times the size of the searches. See
[Recommendation](#recommendation).

## Method

Everything ran on the machine in `docs/load-tests.md` (Apple M2 Max, 12 cores: 8 performance and 4 efficiency, 64 GB).
Other agents shared it. Every timed run waited for the 1-minute load to drop below 8, and the load at its start and end
is in the raw notes. Runs were at nice 0, one at a time, and the key timings are medians of three runs.

**Native Node.** The `node` on this Mac is the x86_64 build (v20.2.0) running under Rosetta. For a fair comparison
with native Rust, everything was also run on the official arm64 build of the same version
(`node-v20.2.0-darwin-arm64.tar.gz` from nodejs.org, sha256 checked against `SHASUMS256.txt`), unpacked in a scratch
directory and run by its absolute path. tsx runs the TypeScript there with `ESBUILD_BINARY_PATH` set to the installed
x64 esbuild, which only does the transforms. Unless a table says Rosetta, its figures are native arm64.

**The city.** `searchprof.ts` builds the London demo the way its child process does (`probe-city.ts probeGame`:
`createGame`, the demo network and `fillDemo` with the whole `game.step`, which includes metro, ferries, harbours,
finance, issues and the network flush with no clients connected, then the demo's students). `Math.random` stays seeded,
so every run plays the same game. Every mode ends the day with 31,975 citizens, 30,534 employed and 8,779 vehicles.
After the fill (2.4 game days, 30,951 citizens, 09:30) it runs one more game day, 2,400 ticks:

```sh
npx tsx packages/server/src/loadtest/searchprof.ts --demo london --mode phases --json out.json   # phase profile
npx tsx packages/server/src/loadtest/searchprof.ts --demo london --mode bare --cpu-prof day.cpuprofile
npx tsx packages/server/src/loadtest/searchprof.ts --demo london --mode record --out CORPUS_DIR  # search corpus
npx tsx packages/server/src/loadtest/search-replay.ts CORPUS_DIR --workers 1,2,4,8 --repeat 3      # TS replay
cargo run --release --manifest-path tools/search-rs/Cargo.toml -- CORPUS_DIR --min-par 8           # Rust replay
```

`searchprof.ts` re-launches itself under `count-hook.mjs` with the same node binary. The hook now also exposes the
unwrapped search functions, so the probe can install its own wrappers. Nothing in the simulation changed: the wrappers
exist only in the probe process and only after the fill. The diff against main touches only `loadtest/` and `tools/`.
`ab.ts` on this branch and on main gives identical counts.

**Phases** are self times. Each wrapped function's time goes to its bucket, less the time of any wrapped functions it
called. So a `findRoute` inside `moveVehicles` counts as a route search, and a `Traffic.step` inside `moveCitizens`
counts as the traffic step.

- *route*: `findRoute` (A\*), `pathBetween` (walks), `goToVenue`'s `findPath` (the nearest café or bar),
  `findBest` (builders' sites, parking) and `pathStillValid`.
- *job*: `findJob`, split into real searches (it ran a `findPath`) and cached ones (the miss cache answered).
- *traffic*: every `Traffic` step, enter, leave, beginTick, endTick and sweep, plus `moveVehicles`' own time.
- *rest*: everything else.

The wrappers cost about 80 ns each and there are about 15,000 a tick, about 1.2 ms. A profiled tick averages 57.9 ms,
against 54.3 ms with no wrappers.

**The corpus** (`search-corpus.ts`, format version 1, documented in the file header). It holds every route, walk, job
and venue search of the day, with its inputs and the game's answer: path, cost, goal, building, nodes expanded, and
for a missed job search the box and the full workplaces it passed. It also holds the world state the searches read:
the chunks' tile and aux arrays, every tile write during the day, and two fields.

- The *cost field* holds what `Traffic.cost` answered per road tile.
- The *job field* holds what the job test answered per tile and education level: a place, a full workplace, or
  neither, plus the building.

A field has a base value per cell that changes at tick starts, and an overlay for changes within a tick. The recorder
writes an overlay event only when a search reads a cell that an earlier search in the same tick already read, and the
value has changed since. So every replayed search reads exactly what the game's closure answered. The overlay count is
also the number of reads that a solve against the start-of-tick state would get wrong.

Two cases need special handling:

- A re-route prices the tile behind it at 1e4 so nobody U-turns. That price is kept per search.
- A venue search's goal test draws `Math.random`, so the corpus keeps the index of the test that said yes.

The London day comes to 178,338 searches, 156 MB, in the scratch directory and not in git.

**Replays** run the ticks in order. Per tick they apply the base events and lay out the overlay. Then they run the
tick's searches as one batch, split wherever a tile write falls inside the tick (1,248 writes in the day, 3,301
batches), and fold the overlay into the base. Only the batches are timed; the bookkeeping is reported separately and
is 1–2% of the search time.

- **TypeScript** runs the game's own `findRoute`, `pathBetween` and `findPath` over a `World` built from the corpus.
  On worker threads, the tiles and fields sit in SharedArrayBuffers and searches are handed out one at a time
  through an atomic counter. The main thread waits on an atomic.
- **Rust** (`tools/search-rs`) is a step-for-step port: the same node keys, step rules, BFS order, binary heap,
  tie-breaking and float arithmetic. JS Maps and Sets become open-addressing tables in per-thread scratch. The same
  batches are spread over a rayon pool. Batches of fewer than 8 searches run on the calling thread, because waking
  the pool for them costs more than it saves.

**Match rate: 100%** in both: 132,196 routes, 35,351 walks, 1,351 job searches and 9,440 venue searches. Every path,
route cost (bit for bit), goal, building, miss box, full-workplace list and node count matches the game's, on one
thread and at every thread count. The TypeScript node counts come from a check run under the hook.

## Phase profile

London, native arm64, median of three profiled runs. The ms are per tick, and the share is of the window's total tick
time.

| phase | 08:00–09:00 mean / p95 ms | share | 17:00–18:00 mean / p95 ms | share | whole day mean / p95 ms | share |
| --- | --- | --- | --- | --- | --- | --- |
| **route searches** | 10.00 / 17.80 | 15.8% | 11.56 / 22.11 | 13.6% | 7.90 / 17.34 | 13.7% |
| – A\* (`findRoute`) | 9.35 / 16.83 | 14.7% | 10.51 / 20.67 | 12.4% | 7.41 / 16.74 | 12.8% |
| – walks (`pathBetween`) | 0.43 / 1.46 | 0.7% | 0.54 / 1.47 | 0.6% | 0.30 / 0.93 | 0.5% |
| – venue `findPath` | 0.18 / 0.58 | 0.3% | 0.47 / 0.91 | 0.6% | 0.18 / 0.63 | 0.3% |
| – `findBest` | 0.02 / 0.09 | 0.0% | 0.01 / 0.05 | 0.0% | 0.01 / 0.06 | 0.0% |
| **job searches** (real; cached 0) | 0.01 / 0.04 | 0.0% | 0.05 / 0.21 | 0.1% | 0.02 / 0.13 | 0.0% |
| **traffic** | 24.98 / 31.28 | 40.1% | 37.77 / 41.20 | 44.6% | 24.25 / 38.42 | 41.9% |
| – `Traffic.step` and friends | 23.93 / 29.94 | 38.4% | 35.53 / 38.28 | 42.0% | 22.79 / 36.20 | 39.4% |
| – `moveVehicles` itself | 1.05 / 1.36 | 1.7% | 2.25 / 3.33 | 2.7% | 1.44 / 2.35 | 2.5% |
| **rest** | 27.69 / 39.52 | 44.1% | 35.31 / 48.61 | 41.7% | 25.70 / 42.10 | 44.3% |
| – `moveCitizens` itself | 13.72 | 22.0% | 17.28 | 20.6% | 11.16 | 19.2% |
| – network flush (no clients) | 7.71 | 12.0% | 10.38 | 12.1% | 7.49 | 13.1% |
| – issues, mobile jobs, stats, plan, re-route, … | | 10.1% | | 9.0% | | 12.0% |
| **tick** (profiled) | 62.24 / 78.57 | | 84.74 / 103.94 | | 57.88 / 89.64 | |

An unprofiled day averages 54.29 ms a tick (p95 82–85 ms; runs of 54.96, 53.52 and 54.29 ms).

Search calls (median of three; ms per call include the closures):

| search | window | calls a tick | ms/call mean | p50 | p90 | p99 | max | nodes mean | p50 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A\* | 08–09 | 117.9 | 0.079 | 0.016 | 0.074 | 2.12 | 6.70 | 67 | 13 | 1768 | 4000 |
| A\* | 17–18 | 102.7 | 0.102 | 0.019 | 0.165 | 2.15 | 6.56 | 86 | 18 | 1757 | 4000 |
| A\* | day | 55.1 | 0.135 | 0.021 | 0.156 | 3.47 | 15.1 | 111 | 18 | 3127 | 4000 |
| walk | day | 14.7 | 0.020 | 0.005 | 0.036 | 0.26 | 2.38 | 51 | 6 | 806 | 2500 |
| venue | day | 3.9 | 0.046 | 0.025 | 0.118 | 0.24 | 1.57 | 34 | 15 | 215 | 301 |
| job (real) | day | 0.6 | 0.044 | 0.032 | 0.095 | 0.16 | 1.37 | 49 | 30 | 219 | 309 |
| job (cached) | day | 0 | | | | | | | | | |
| `findBest` | day | 0.4 | 0.028 | 0.024 | 0.047 | 0.10 | 0.14 | 22 | 20 | 120 | 174 |

The A\* time is mostly in a few long searches. The median search expands 18 nodes and takes 21 µs, but the 1% that
expand thousands (781 of 132,196 in the day found nothing and used the whole 4,000-node budget) take most of the time.

By caller, over the day:

| caller | A\* calls | A\* time |
| --- | --- | --- |
| `maybeReroute` | 38,432 | 7.7 s |
| `spawnVehicle` (dispatch) | 51,604 | 4.2 s |
| `headBack` | 8,952 | 3.0 s |
| `plan` (a citizen's trip) | 27,294 | 2.0 s |
| `migrate` | 1,208 | 0.9 s |

In a settled London every job search finds a job, so the miss cache never answers. Job searches matter only while a
town fills (`docs/load-tests.md`), and even there they came to 0.09 ms a tick.

Top self time from the CPU profile of an unprofiled day (inspector, 200 µs sampling; `profile-summary.ts`):

| self % | function |
| --- | --- |
| 8.0 | `Traffic.guardSweep` |
| 6.7 | `findRoute` |
| 6.6 | `Simulation.tick` (inlined steps) |
| 6.1 | `Traffic.step` |
| 5.2 | `Net.flush` |
| 5.1 | `Simulation.agents` (the flush's agent list) |
| 3.9 | garbage collector |
| 3.8 | `moveCitizens` |
| 3.7 | `Traffic.inBox` |
| 2.8 | `moveVehicles` |
| 2.2 | `Traffic.enter` |
| 2.1 | `Traffic.beginTick` |
| 2.1 | `World.getChunk` |
| 2.1 | `Traffic.congestionAt` (route cost) |
| 2.0 | `advance` |
| 1.7 | `Traffic.isCrossingAt`, `carBodyAt`, `degreeOf`, `junctionAux` (each) |

## Replay benchmarks

London's 178,338 searches of one day. Times are the batches only, median of three. Per tick is the total over 2,400.

| run | native arm64 ms (per tick) | vs TS 1 thread | Rosetta x64 ms |
| --- | --- | --- | --- |
| TS, main thread | 9,127 (3.80) | 1.0× | 16,814 |
| TS, 1 worker | 9,698 | 0.94× | 16,343 |
| TS, 2 workers | 5,737 | 1.6× | 9,773 |
| TS, 4 workers | 4,410 | 2.1× | 7,529 |
| TS, 8 workers | 4,224 (1.76) | 2.2× | 9,595 |
| TS critical path | 3,570 | 2.6× (limit) | 6,023 |
| Rust, one thread | 1,228 (0.51) | 7.4× | – |
| Rust, rayon 2 | 811 | 11.3× | – |
| Rust, rayon 4 | 703 (0.29) | 13.0× | – |
| Rust, rayon 8 | 796 | 11.5× | – |
| Rust critical path | 478 | 19× (limit) | – |

The *critical path* is each batch's slowest search, summed. No number of threads can finish a batch sooner than that,
so it is the floor for any per-tick batch. With 74 searches a tick (p95 145) and a heavy tail, one 4,000-node A\*
search holds up the whole batch. Threads beyond 2–4 add nothing, and rayon at 8 threads is slower than at 4 (pool
wake-ups, and 8 threads on a machine with other work running). With every batch split search by search, even ones of
one or two searches, rayon was worse still (2.9 s at 8 threads), hence `--min-par 8`.

**Rosetta against native.**

| measure | native arm64 | Rosetta x64 | Rosetta / native |
| --- | --- | --- | --- |
| TS replay of the searches, main thread | 9,127 ms | 16,814 ms | 1.84 |
| TS replay, 4 workers | 4,410 ms | 7,529 ms | 1.71 |
| A\* in the game (profiled, per tick) | 7.41 ms | 8.74 ms | 1.18 |
| traffic step in the game (profiled, per tick) | 22.79 ms | 22.53 ms | 0.99 |
| whole London tick, unprofiled (median of 3) | 54.29 ms | 53.09 ms | 0.98 |
| London fill, wall | 228 s | 226–251 s | about 1.0 |

The gap depends on the code. The tight search loop runs 1.8 times slower under Rosetta, but the game as a whole runs
at the same speed: `moveCitizens` and the flush were even a little faster translated. So `docs/load-tests.md`'s
Rosetta figures hold for whole ticks, but a kernel benchmark under Rosetta flatters native code by up to 1.8 times.
Everything below compares native with native. Production runs x64 V8 natively, with no translation, so its
TypeScript will be at least as fast as the native column here. The Rust-over-TS ratio there could be somewhat
smaller than 7.4.

**Replay against the live game.** In the game the same searches take 7.9 ms a tick, and in the replay 3.8 ms. The
replay reads the cost from a dense array per chunk. The game calls `Traffic.cost`, which does four Map lookups and an
`exp` per tile, and the game's searches also run with colder caches between other work. The Rust figures are like
for like with the TS replay. A Rust module in the game would also need a dense cost field (below), so 0.5 ms a tick
is what it would cost in the game, plus the call overhead.

## Projected whole-tick gain

Amdahl's law with the measured search share: native arm64, unprofiled ticks (medians of three), search time from the
profile, which slightly overstates it because the wrappers are included. Rust's time in the game is taken as the
profiled TS search time times the replay ratio of Rust to TS replay to TS live: ×0.065 on one thread, ×0.037 on four.
The 0.3 ms a tick added for the calls and the cost field's upkeep is an estimate.

| London | tick now | searches now | with Rust, 1 thread (+0.3 ms calls and cost field) | gain | with Rust, 4 threads | if searches were free |
| --- | --- | --- | --- | --- | --- | --- |
| ~30k, whole day | 54.3 ms | 7.9 ms (14.6%) | 47.2 ms | 1.15× (−13%) | 47.0 ms (1.16×) | 1.17× |
| ~30k, 17:00–18:00 | 79.4 ms | 11.6 ms (14.6%) | 68.9 ms | 1.15× (−13%) | 68.6 ms (1.16×) | 1.17× |
| ~30k, 08:00–09:00 | 60.7 ms | 10.0 ms (16.5%) | 51.7 ms | 1.18× (−15%) | 51.4 ms (1.18×) | 1.20× |
| ~53k | D8_ROWS | | | | | |

TypeScript workers instead of Rust would need the same batching changes (below). At 8 workers the replay takes 46% of
its single-thread time, which would put the game's 7.9 ms at about 3.7 ms: a gain of about 1.08×.

## The call boundary

Per London tick there are 74 searches (p95 145, max 251). The inputs are about 40 bytes a search: start, goal, kind,
budget, start direction, education level and up to two avoided tiles, so about 3 KB a tick. The outputs are paths
averaging 15 tiles for a route and 8–11 for the rest: about 8 KB of int32 a tick. The tiles cost nothing, since the
chunks are typed arrays and can be lent to Rust without copying. The state the closures read is the expensive part:

- **route cost.** `Traffic.cost` reads congestion (a Map of value and tick, decayed with `exp`), the junction degree,
  cars at the kerb (a Map), level crossings and bascule barriers. Rust needs these as typed arrays per chunk:
  congestion value and tick (`endTick` already visits every occupied tile, about 3,200 changed cells a tick in
  London), a kerb count byte, a crossing byte, and the few bascule barrier states per tick. The degree it can work out
  from the tiles. `congestionAt` deletes decayed entries as it reads them, which changes later `endTick` values. It
  has to stop doing that, or the Rust and TS games drift apart, as `docs/load-tests.md` found for a smaller change.
  Rust's `exp` must also be bit-identical to V8's (both are fdlibm ports; this has to be checked).
- **job test.** This needs a per-tile building index (an `Int32Array` per chunk), and per workplace and education
  level a vacancy byte kept up to date on hire, quit, build, level change and mothballing (the logic of
  `Skills.placeFor`). The spike checks this against the field: 100% match on 1,351 searches, including the miss box
  and full list. The miss cache (`jobEditedSince`) can stay in TS.
- **venue test.** It draws `Math.random` inside the search, so its number of draws depends on the search order. It
  would need a hash of citizen, tick and tile instead, which changes the game once.

**A batch per tick** means two phases: collect the requests, solve them, then apply them in request order. The sim is
not built that way. Every caller uses its answer at once:

- `plan` walks to the car, then routes, then weighs the route's cost against transit and taxis, then perhaps walks
  instead. That is up to three dependent searches in one decision.
- `maybeReroute` (the biggest A\* caller) replaces the path of a car mid-step.
- `spawnVehicle` and `headBack` create or turn a fleet vehicle around.
- `findJob` hires straight away, and the hire draws `Math.random`.

A batch solved against the start-of-tick state would change almost nothing: only 12 cost reads and 5 job reads in the
whole day saw a change made earlier in the same tick. So *one step later* (request in tick T, apply at the start of
T+1 in request order) is sound for the sim's state. But every call site would have to become a request with a
continuation, and the dependent chains in `plan` would need speculative searches (all candidate legs in one batch).
The measured payoff for parallelism on top of that is 0.2 ms a tick.

**A synchronous drop-in** (TS calls Rust's `findRoute` in place, one call at a time) needs no restructuring, keeps the
order of RNG draws, and gets nearly all of the gain (0.51 ms against 0.29 ms a tick). The napi call overhead is about
1 µs at 55 calls a tick. That would be the shape to build if this is ever done.

## Recommendation

Do not move the searches to Rust now.

- The whole-tick gain for London is at most 13–17%, because searches are 14–16% of the tick.
- Parallel solving adds about 1% on top of that, at the price of restructuring every call site into batches.
- Job searches are 0.04% of the tick.

The bigger costs are elsewhere: the traffic step is 39–42% (`guardSweep` alone is 8% of CPU), `moveCitizens` 19–22%,
and the flush's agent list. The flush ran with no clients here, so it is a probe artefact only in part.

If route search cost does become a problem, do these first, cheapest first:

1. In TypeScript: give `Traffic.cost` a dense per-chunk array instead of four Maps and an `exp`, and give
   `findRoute` stamp arrays instead of Maps. The replay suggests this alone takes the live 7.9 ms down towards 3.8 ms,
   about half of what Rust would save. The corpus and `search-replay.ts` can measure it exactly, with every answer
   checked.
2. Look at re-routes, the largest A\* caller (38k a day, 7.7 s), and at the 4,000-node failures: re-route budgets,
   or a cheaper "is the goal reachable" test.
3. Only then a synchronous Rust `findRoute`, with the cost field above, as a napi module and a wasm build behind the
   TS fallback. The spike in `tools/search-rs` is the starting point: it already matches the game answer for answer.

**moveVehicles (pointer only).** The traffic step is the one worth a native or data-layout rethink. It is per-mover
work over JS objects (`Mover`), the lane occupancy Maps (`cells`, `carGrid`), junction state and the body guard's
sweeps. Moving it would mean struct-of-arrays movers (position, lane, progress, speed, wait) in typed arrays, the lanes
and the car grid as arrays per chunk, and the junction and signal tables as arrays. Step order also matters: it
decides who enters a box first, so a parallel version needs a deterministic conflict rule. Profile `guardSweep`,
`inBox` and `beginTick`'s car grid rebuild first; the TS gains there may be large and cheap.

## Files

- `packages/server/src/loadtest/searchprof.ts`, `search-phases.ts`: the probe (phases, bare, record, CPU profile).
- `packages/server/src/loadtest/search-corpus.ts`: corpus format, recorder and reader.
- `packages/server/src/loadtest/search-replay.ts`: TS replay, check and worker-thread benchmark.
- `packages/server/src/loadtest/probe-city.ts`: the probes' city setup, shared with `jobsearch.ts`.
- `packages/server/src/loadtest/count-hook.mjs`: also exposes the unwrapped search functions, and node counts with
  `SEARCH_HOOK_EXPANDED=1`.
- `tools/search-rs/`: the Rust spike (`cargo run --release -- CORPUS_DIR`).
