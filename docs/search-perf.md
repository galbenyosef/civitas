# Route and job searches: what they cost, and whether to move them to Rust

The question (2026-10-19): would the route searches and job searches be worth moving to Rust? That would mean a
native Node module (napi-rs, with rayon threads) on the server and the same crate as WebAssembly in local mode,
with the TypeScript versions kept as the fallback and the reference. This doc measures what the searches cost in a
London tick, replays every search of a London day in TypeScript and in a Rust port, and projects the gain.

**Short answer: not now.** In a London tick of about 54 ms (native arm64, 31k citizens), the searches take about
8 ms (14.6%): A\* 7.4 ms, walks 0.3 ms, venue searches 0.2 ms, job searches 0.02 ms. The traffic step takes about
24 ms (42%). A faithful Rust port of the searches is 7.4 times faster than TypeScript on one thread, so the whole tick
gets about 13% faster (1.15×). Extra threads add about 1% on top of that. See [Recommendation](#recommendation).

**Update, later the same day:** steps 1 and 2 of the recommendation are done in TypeScript, with the same answers:
A\* in a London tick went from 5.9 to 2.1 ms, and the whole tick from 40.7 to 36.9 ms (−9%). See
[the TypeScript speed-ups](#2026-10-19-later-the-typescript-speed-ups).

**Update, the evening:** the traffic step and `moveVehicles` went from 17.9 to 8.8 ms a London tick, and the whole tick
from 36.5 to 20.9 ms, with the same game tick for tick. A world loaded from a save had run 3.8 times slower than the
same world before saving, because every loaded citizen had a V8 hidden class of its own. See
[the traffic step](#2026-10-19-evening-the-traffic-step).

**Rosetta is not the problem.** The x64 Node under Rosetta and a native arm64 Node run the whole London tick at the
same speed: 53.1 against 54.3 ms. Only tight kernels like the search loop show a gap (1.8×).

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
  through an atomic counter. The main thread waits until every worker has acknowledged the batch.
- **Rust** (`tools/search-rs`) is a step-for-step port: the same node keys, step rules, BFS order, binary heap,
  tie-breaking and float arithmetic. JS Maps and Sets become open-addressing tables in per-thread scratch. The same
  batches are spread over a rayon pool. Batches of fewer than 8 searches run on the calling thread, because waking
  the pool for them costs more than it saves.

**Match rate: 100%** in both, for London and for the 8×8 test city (384,604 searches). The first worker-thread
replay showed about one cost mismatch every ten passes. Its shared "workers done" counter let the main thread go on
while a worker was still searching, so one search read the next tick's costs. With a per-worker acknowledgement of each
batch there were no mismatches in 40 passes, and the worker figures below are from that version. London has 132,196
routes, 35,351 walks, 1,351 job searches and 9,440 venue searches. Every path, route cost (bit for bit), goal,
building, miss box, full-workplace list and node count matches the game's, on one thread and at every thread count. The TypeScript node counts come from a check run under the hook.

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
The worker rows are from the fixed hand-out (load 7.9 at the start, 14.0 at the end). The other rows are from the first
replay run (load 7.75 → 7.97); its worker figures were within 6% of these. The TS main thread measured 9,434 ms in the
second run, and under Rosetta 16,014 ms (the Rosetta worker rows are from that second run, load 4.5 → 3.9).

| run | native arm64 ms (per tick) | vs TS 1 thread | Rosetta x64 ms |
| --- | --- | --- | --- |
| TS, main thread | 9,127 (3.80) | 1.0× | 16,814 |
| TS, 1 worker | 9,400 | 0.97× | 15,902 |
| TS, 2 workers | 5,708 | 1.6× | 9,434 |
| TS, 4 workers | 4,297 | 2.1× | 7,134 |
| TS, 8 workers | 3,993 (1.66) | 2.3× | 6,753 |
| TS critical path | 3,570 | 2.6× (limit) | 6,003 |
| Rust, one thread | 1,228 (0.51) | 7.4× | – |
| Rust, rayon 2 | 811 | 11.3× | – |
| Rust, rayon 4 | 703 (0.29) | 13.0× | – |
| Rust, rayon 8 | 796 | 11.5× | – |
| Rust critical path | 478 | 19× (limit) | – |

The 8×8 test city (384,604 searches, native): TS main thread 4,803 ms, 2 / 4 / 8 workers 3,292 / 2,549 / 2,548 ms,
critical path 1,914 ms. Rust one thread 654 ms, rayon 2 / 4 / 8 at 483 / 446 / 523 ms (every batch split, without
`--min-par`), critical path 298 ms.
Rust is 7.3 times faster on one thread here too.

The *critical path* is each batch's slowest search, summed. No number of threads can finish a batch sooner than that,
so it is the floor for any per-tick batch. With 74 searches a tick (p95 145) and a heavy tail, one 4,000-node A\*
search holds up the whole batch. Threads beyond 2–4 add nothing, and rayon at 8 threads is slower than at 4 (pool
wake-ups, and 8 threads on a machine with other work running). With every batch split search by search, even ones of
one or two searches, rayon was worse still (2.9 s at 8 threads), hence `--min-par 8`.

**Rosetta against native.**

| measure | native arm64 | Rosetta x64 | Rosetta / native |
| --- | --- | --- | --- |
| TS replay of the searches, main thread | 9,127 ms | 16,814 ms | 1.84 |
| TS replay, 4 workers | 4,297 ms | 7,134 ms | 1.66 |
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
| **(b) measured**: 8×8 test city, ~80k (not London) | 55.8 ms | 3.9 ms (7.0%) | 52.4 ms | 1.06× | 52.2 ms | 1.08× |
| **(c) extrapolated**: London ~53k, share held at 14.6% | 124 ms (prod) | ~18 ms | ~107 ms | ~1.16× | ~107 ms | 1.17× |
| (c) if the share grows to 20% | 124 ms | ~25 ms | ~101 ms | ~1.23× | ~101 ms | 1.25× |

There is no London at 53k on this machine. The demo grows by about 1,000 citizens a game day, so reaching 53k would
take weeks of game time. The 53k London is prod's (swarm-108, native linux x64: 124 ms a tick on average), and it was
not touched. Row (b) is a different city: the 8×8 `seedCity` grid filled to 78k and ended the day at 80k. Its
searches are short (grid streets, A\* p50 11 nodes), so its share is half London's. Row (c) is arithmetic on the prod
tick time. Prod's tick grew 2.3 times for 1.7 times the citizens, so something grows faster than linearly; if that is
congestion, re-routes (the largest A\* caller) grow with it. The share at 53k is not measured. Recording a corpus from
a copy of prod's save would settle it.

TypeScript workers instead of Rust would need the same batching changes (below). At 8 workers the replay takes 44% of
its single-thread time, which would put the game's 7.9 ms at about 3.5 ms: a gain of about 1.09×.

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
and the network flush at 13%. The flush ran with no clients connected, so part of its 7.5 ms built agent lists that
nobody received.

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

## 2026-10-19 (later): the TypeScript speed-ups

Steps 1 and 2 of the recommendation, on branch `route-speedups` (from main at `badf4e7`). Same machine and method as
above: native arm64 Node, nice 0, each run started with the 1-minute load below 8 (loads 3.8–9.1 at the starts), one
run at a time, medians of three. Main has moved on since the study: today's London fill ends at 30,838 citizens (not
30,951) and its profiled tick is 43 ms (not 58), so the "before" figures below were measured again on main as it is now.

### Same answers, faster

- **`Traffic.cost`** keeps a dense array set per chunk (`CostChunk`): the congestion as first read in the current
  epoch (a new epoch each tick and after `endTick`, the only place congestion changes), flags for the parts that change
  only with the tiles (a junction of three or more, a level crossing, a bascule deck; cleared by `invalidate` together
  with the degree and crossing caches), and a kerb flag that `World.kerb` keeps up to date (`CountMap.onSet`). A cost is
  now one chunk lookup (usually the last one again) and a few typed-array reads, with the same additions in the same
  order. The congestion is still read through `congestionAt` the first time in an epoch, so its lazy tidying of decayed
  entries happens exactly as before.
- **`findRoute`** numbers its nodes by chunk slot (slot × 2,048 + layer × 1,024 + tile), and keeps the g-score,
  parent, direction in and two stamps (seen, closed) in typed arrays shared by every search; a search takes a new stamp,
  so nothing is cleared. The open set is the same binary heap in typed arrays (same comparisons, so the same tie-breaks).
  Neighbours read the tile and aux from the chunk the node is in, or the last one looked up.
- **`findPath`** (walks, venue and job searches) uses a stamp array for its visited set. `findBest` is unchanged (its
  goal set can hold tiles in chunks that are not loaded, and it costs 0.01 ms a tick).

Checks: every answer of both corpora is the same (path, cost bit for bit, goal, building, miss box and nodes expanded,
the node counts from a `--check-expanded` run): London 178,338 / 178,338, 8×8 384,604 / 384,604. A London day recorded
on the branch is byte-for-byte the corpus recorded on main (all ten files: 178,899 searches, 17,387,999 cost reads), so
`Traffic.cost` gave the same costs at the same ticks. `ab.ts` (defaults, and `--hour 17 --ticks 2400 --set bus=2`)
gives the same JSON as main apart from the timings, and every London run of this step ends the day at 31,990 citizens,
30,580 employed and 9,172 vehicles, as on main.

Replay (searches only, one thread, median of three):

| corpus | main | branch | speed-up | critical path main → branch |
| --- | --- | --- | --- | --- |
| London, all 178,338 searches | 9,121 ms | 3,506 ms | 2.6× | 3,440 → 1,229 ms |
| – routes (A\*) | 8,429 ms | 3,025 ms | 2.8× | |
| – walks | 538 ms | 387 ms | 1.4× | |
| – venue / job searches | 95 / 26 ms | 67 / 19 ms | 1.4× | |
| 8×8, all 384,604 searches | 4,843 ms | 1,919 ms | 2.5× | 1,966 → 643 ms |

Live London (`searchprof.ts --mode phases`, the day after the fill), before step 2:

| per tick, whole day | main | branch | |
| --- | --- | --- | --- |
| A\* (`findRoute`) mean / p95 | 5.92 / 13.31 ms | 2.58 / 5.30 ms | −56% |
| walks / venue searches | 0.277 / 0.137 ms | 0.203 / 0.125 ms | |
| all route searches | 6.35 ms | 2.92 ms | −54% |
| A\* per call: mean, p99, max | 0.107, 2.89, 13.8 ms | 0.047, 1.14, 3.0 ms | |
| A\* 08:00–09:00 / 17:00–18:00 | 8.14 / 9.45 ms | 3.38 / 4.12 ms | |
| profiled tick | 42.97 ms | 40.26 ms | |
| unprofiled tick (bare), median of 40.57–42.08 / 36.93–38.13 | 40.69 ms | 37.99 ms | −6.6% |

The live A\* time fell by more than the replay's because the replay already read a dense cost field. The A\* nodes
expanded are the same (117 a call, p99 3,326).

### Cheaper re-routes

`searchprof.ts --mode reroutes` (`reroute-probe.ts`) fills London as the other modes do, switches on `--set k=v,...`
only for the day after, and records A\* by caller, what each re-route search came to, and the traffic as the HUD shows
it. Every run starts that day from the same city. On main (same game as the branch above):

- Re-routes are the held-up drivers (`wait` ≥ 10 at the 25-tick cadence, at most 40 searches a tick, 50 ticks apart for
  one driver); `delayReroute` and the stuck re-route are off. 39,478 searches a day: **2,880 taken (7%), 36,519 not
  better by enough (93%), 79 found nothing**. Of the ones not taken, **29,645 (75% of all searches) found exactly the
  way the driver was already on.** Re-routes were 2.83 s of the day's 6.3 s of A\* (169 nodes a search).
- Failed searches: spawnVehicle 408, headBack 311, re-routes 79 a day, every one after the whole 4,000-node budget.
  None of their goals was unreachable (an unbounded search, live and over the whole corpus), so a road-component test
  would answer none of them early: they are long trips across London, not cut-off ones.

The change kept: **a re-route search stops once nothing it could still find would be taken.** A new way is taken only
if it costs less than 0.85 × the rest of the current route (or the AVOID price), so `findRoute` now takes a `maxCost`
and gives up when the cheapest open node's f reaches it: f never falls from one node taken to the next (the Manhattan
heuristic is consistent, every tile costs at least 1), and a route found from a node costs at least its f. So the
search ends with no route exactly where the full search would have found one that is then turned down. A margin of
1e-9 keeps rounding from stopping a search short of one that would be taken. Every re-route decision is the same.

| London, the day after the fill | A\* ms a tick | re-route A\* s a day | searches | taken | queued | speed | parked | trips | trip mean (ticks) | stuck (mean) | give-ups |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main rules | 2.62 | 2.83 | 39,478 | 2,880 | 72.2% | 21.7% | 2,741 | 60,738 | 121.2 | 14.3 | 52,078 |
| **bound (kept)** | **2.20** | **1.78** | 39,478 | 2,880 | 72.2% | 21.7% | 2,741 | 60,738 | 121.2 | 14.3 | 52,078 |
| cooldown 100 ticks | 2.42 | 2.29 | 32,660 | 2,254 | 72.1% | 21.8% | 2,727 | 60,944 | 120.6 | 14.5 | 51,964 |
| re-route budget 2,000 nodes | 2.46 | 2.44 | 39,230 | 2,938 | 72.1% | 21.8% | 2,746 | 60,694 | 121.9 | 14.4 | 52,185 |
| re-route budget 1,000 nodes | 2.18 | 1.81 | 39,160 | 2,767 | 72.1% | 21.8% | 2,748 | 60,851 | 120.3 | 13.8 | 52,214 |
| bound + cooldown 100 | 2.11 | 1.45 | 32,660 | 2,254 | (as cooldown 100) | | | | | | |
| bound + budget 1,000 | 2.02 | 1.34 | 39,160 | 2,767 | (as budget 1,000) | | | | | | |
| branch, final (bound from the start, so a slightly different fill) | 2.08 | 1.65 | 39,146 | 2,812 | 72.3% | 21.5% | 2,731 | 60,662 | 119.9 | 13.3 | 51,968 |

*Stuck* is drivers held past the stuck limit (60 ticks), sampled every 100 ticks; *give-ups* are the Traffic counters'
sent home, vehicles removed and garage give-ups; *parked* is `parkedCars`, the HUD's figure. With the bound
switched on for the day only, every figure and every Traffic counter is the same as without it, alone and on top of
the other options. It is not quite bit for bit over longer runs: a bounded search reads fewer congestion values, so
`congestionAt`'s lazy tidying drops a different set of decayed entries (below 0.004), and the tiny congestion
differences this leaves add up. With the bound on from the start, the fill ends at 30,840 citizens instead of 30,838,
and its day after (the row "branch, final") is within the day-to-day spread of the other rows. A run with congestion
reads made free of side effects (an `endTick` that treats a decayed entry as gone) changed one re-route in the day,
so that change was not kept either. The cooldown and the smaller budgets do
change the game: they take 4–22% fewer re-routes, and the traffic stays within about 1% either way, which is how much
one day moves when anything changes. They save 0.1–0.2 ms a tick on top of the bound, so they were not kept;
`rerouteCooldown` (50) and `rerouteNodes` (4,000) are now `TRAFFIC_TUNING` entries for anyone who wants to try them.

### Whole tick

London, the final branch (both steps) against main, median of three runs each (loads 4.5–6.2 at the starts; one run
ended at 37 when other work started):

| per tick | main | branch | |
| --- | --- | --- | --- |
| unprofiled tick (bare), whole day: mean / p95 | 40.69 / 65.2 ms | 36.92 / 59.4 ms | −9.3% |
| profiled tick, whole day | 42.97 ms | 39.08 ms | |
| profiled tick, 08:00–09:00 / 17:00–18:00 | 47.73 / 66.46 ms | 40.82 / 60.13 ms | |
| all route searches | 6.35 ms (14.8%) | 2.45 ms (6.3%) | −61% |
| A\* mean / p95 | 5.92 / 13.31 ms | 2.12 / 4.52 ms | −64% |
| A\* 08:00–09:00 / 17:00–18:00 | 8.14 / 9.45 ms | 2.71 / 3.58 ms | |
| A\* nodes a call: mean, p99 | 117, 3,326 | 95, 2,200 | |
| traffic step | 17.50 ms | 17.33 ms | |

The bare runs were 40.57, 40.69, 42.08 ms on main and 36.03, 36.92, 36.95 ms on the branch.

### Next

- The traffic step is now 42–45% of the tick. Profile `Traffic.guardSweep` (8% of CPU in the study) and the car grid
  that `beginTick` rebuilds from every lane each tick, before any data-layout change to `moveVehicles`.
- The 720 failed fleet searches a day (spawnVehicle, headBack) are now the most expensive A\* calls (1.0 s a day, 4,000
  nodes each). They are reachable, just far: a cheaper first guess at "too far for 4,000 nodes" would need its own
  check that it changes no answers.
- A Rust `findRoute` now has less to win: the A\* is 2.1 ms of a 39 ms profiled tick (5%).

## 2026-10-19 (evening): the traffic step

The traffic step and `moveVehicles`, on branch `traffic-speedups` (from main at `6d70504`). The method is the same as
above: native arm64 Node, nice 0, one run at a time, and every timed run started with the 1-minute load below 8. Other
agents shared the machine, so the before and after runs are interleaved. Every change keeps the game exactly as it was.

**Short answer:** in a London tick, the traffic step and `moveVehicles` went from 17.9 to 8.8 ms (−51%; −53% at
08:00–09:00 and −47% at 17:00–18:00). The whole tick went from 36.5 to 20.9 ms (−43%). The largest single gain is not in the
traffic code. Every citizen and vehicle now keeps one V8 hidden class. A world loaded from a save had given every
citizen a hidden class of its own, so a loaded London ran 3.8 times slower than the same London before saving (a 3×3
test city five times slower).

### The probe

`searchprof.ts` has three more modes (`loadtest/traffic-probe.ts`). Each fills London as the other modes do and then
runs the day after:

- `tcount` wraps 63 `Traffic` methods and `moveVehicles`, and gives calls and self time per window. It also gives what
  each body-guard sweep came to: nothing near, walkers or cars gathered, cut short. The wrappers cost far more than the
  small methods they time, so for those methods read the calls, not the times.
- `tprof` takes inspector CPU profiles of 08:00–09:00 and 17:00–18:00 (no wrappers) and gives the tick and flush times.
- `hash` takes a fingerprint of the game after the fill and after every tick. It covers every citizen's and vehicle's
  position, lane, progress, path node, wait, stuck clock, re-route tick and trail length, the citizens' states, jobs and
  money, the congestion map, the traffic counters and totals, and every player's money. Two builds that print the same
  2,401 fingerprints played the same game.
- `--client` connects one client after the fill: a `hello`, then a subscription to every chunk. `--client-at H` connects
  it at hour H instead. Every frame the client is sent is counted and hashed.
- `--reload` saves the filled world and loads it again (`snapshot.ts`) before the day, as a server restart does, and
  prints a hash of the snapshot's content with its keys sorted.

`loadtest/shapes.ts` counts the movers' hidden classes after a fill, after a save and load, and a day after that. It needs
`node --allow-natives-syntax --loader tsx`. `loadtest/hypot-check.ts` checks `hypot` against `Math.hypot`.

### Where the time went

`tcount`, London, the day after the fill, with calls and self ms a tick. These are wrapped self times, so the small
methods read high. Main is on the left of each arrow and the branch on the right. The calls are the same on both,
except for the caches the guard now asks less often:

| method | calls 08–09 | self ms 08–09 | calls 17–18 | self ms 17–18 |
| --- | --- | --- | --- | --- |
| `guardSweep` | 1,319 | 6.99 → 2.26 | 1,541 | 9.85 → 3.25 |
| `Traffic.step` | 3,012 | 5.08 → 2.56 | 3,902 | 6.67 → 3.29 |
| `enter` | 3,760 | 2.37 → 1.24 | 10,090 | 6.11 → 2.85 |
| `carBodyAt` (walkers) | 1,175 | 2.16 → 0.49 | 1,905 | 4.31 → 0.97 |
| `beginTick` (the car grid) | 1 | 2.29 → 0.58 | 1 | 3.00 → 0.82 |
| `junctionAux` | 16,284 → 8,275 | 2.26 → 0.58 | 29,976 → 14,378 | 3.72 → 0.95 |
| `isCrossingAt` / `degreeOf` | 6,605 / 5,220 | 1.59 / 1.22 → 0.41 / 0.33 | 11,125 / 8,794 | 2.43 / 2.03 → 0.69 / 0.54 |
| `congestionAt` | 5,077 | 1.95 → 0.89 | 5,824 | 2.45 → 1.12 |
| `headingOf` | 3,214 | 1.32 → 0.88 | 4,651 | 1.98 → 1.13 |
| `boxConflict` / `canEnter` | 1,353 / 2,742 | 1.26 / 1.21 → 0.67 / 1.03 | 2,372 / 4,753 | 2.23 / 2.12 → 1.21 / 1.68 |
| `moveVehicles` itself | 1 | 1.81 → 1.51 | 1 | 3.09 → 2.43 |
| all wrapped traffic methods | | 44.4 → 21.5 | | 69.7 → 33.0 |

The body guard ran 1,102 sweeps a tick over the day. 370 found nothing near, 689 gathered cars,
173 gathered walkers, and 134 were cut short. Most `enter` calls are cars waiting in a garage to pull out:
10,090 a tick at 17:00–18:00, each of them blocked and trying again every tick.

The CPU profile of the evening rush on main, by self time: `guardSweep` 8.3%, `Traffic.step` 6.7%, `inBox` 4.5%,
`enter` 2.8%, `carBodyAt` 2.4%, `beginTick` 2.3%, and `junctionAux`, `apart`, `isCrossingAt`, `congestionAt` and
`headingOf` at 1.3–2.0% each.

### What changed

Each change below was checked as it went in: a 2×2 test city gave the same fingerprint on every tick of half a day. The
London checks are in [Same game](#same-game).

1. **One hidden class per kind of mover.** Some citizens get `skill`, `drain`, `grad`, `appr`, `mig`, `gx` or `gy` later
   in life, and buses and fleet vehicles get `halt` and `dwell`. In V8, every object that gains a field takes a new hidden
   class, and London's movers had eleven. A property read that has met more than four classes is megamorphic: 3.6 ns
   against 0.4 ns in a micro-benchmark. The traffic step reads movers' fields hundreds of thousands of times a tick.
   `citizenLater()` (world.ts) makes those fields up front, as undefined, in `makeCitizen` and on load. The three vehicle
   literals (`spawnVehicle`, the buses' `spawn` and the fleet's `launch`) now all have `call`, `weave`, `fee`, `halt`
   and `dwell`. Every test of these fields compares with undefined or tests truthiness, and none uses `in`, so the game
   is the same. A save's JSON drops undefined fields, so a snapshot has the same content. Only the order of a few keys
   changes.
2. **Loaded citizens.** `worldFromSnapshot` built each citizen as `{ ...lifeDefaults(...), ...saved }`. An object
   literal that starts with a spread clones the hidden class of the object it spreads, so every loaded citizen got a
   class of its own: 10,728 classes for the 10,728 citizens of a 3×3 city. A third of them were in dictionary mode
   1,500 ticks later. The literal now starts with `id:`, and the loaded citizens share one class.
3. **`hypot`.** `Math.hypot` is a builtin call, about 27 ns in Node 20. `hypot()` in traffic.ts takes the same steps as
   V8's (builtins/math.tq: scale by the larger, then a Kahan sum, which for two numbers comes to this) in about 2 ns.
   It matches `Math.hypot` bit for bit on 20 million pairs and on the edge cases (`hypot-check.ts`). `Math.sqrt(x*x+y*y)`
   would not: it differs in the last bit for 38% of pairs. `walkOn`'s step uses it too.
4. **`%` on lane keys.** Lane keys (`tkey * 4 + dir`) are past 2^31, so `key % 4` is a float remainder: 18 ns against
   1 ns written with `Math.floor`. `laneDir`, `laneTile`, `tileX` and `tileY` give the same answers, and so does
   `untkey` in world.ts.
5. **Dense per-chunk arrays instead of Maps keyed by tile.** Tile keys are past 2^31 too, so every `Map.get` boxed a
   heap number. A `RoadChunk` per chunk now holds:
   - each lane's queue (the same arrays as `cells`, which stays for going through every lane in its order)
   - the degree, junction-aux and crossing caches, and the junction control
   - the congestion entries (the same objects as `cong`, which keeps their order for `sweep` and the dirty set)
   - the congestion's per-tile counts for `endTick`, in the order first driven on, which was the `present` Map's order
   - the pedestrians on each carriageway, in two slots by tick, instead of two Maps swapped each tick

   `inBox` and `boxBusyExcept` read a tile's eight lanes from one chunk when the tile is not on a chunk edge. `kerbAt`
   reads the cost chunk's copy of `World.kerb`, with its own last-chunk cache. `World.getChunk` keeps the last chunk
   found and keys `chunkByNum` by a small integer.
6. **The car grid and the walkers.** They are now per-chunk tile lists (`TileLists`): a new fill number empties them, and
   `near` returns the 3×3 lists round a tile, from one chunk away from its edges. The lists only ever answer "is any of
   these in the way", so the order inside them does not matter. Even so, the car grid is still filled from `cells` in
   the same order.
7. **Allocations.** `inBox` fills scratch arrays instead of yielding an object per car from a generator.
   `boxBusyExcept` stops at the first mover, as the generator did. `obbOverlap` builds no axis arrays. `guardSweep`
   gathers into scratch with counts (no `length = 0`, which is a runtime call), in three parts: `gatherPeds`,
   `gatherCars` and `sweepClear`. The cheap tests (distance, ahead) come before `apart`, `filtering` and `headingOf`,
   which have no side effects. `carBodyAt` checks distance before the flyover tests.
8. **The network flush.** The agents are bucketed by a numeric chunk key, not a key string. While nobody is subscribed to
   any chunk, they are not bucketed at all. `lastSent` is still kept up to date, so the first frame anyone is sent later
   is the same. A stamp on each `lastSent` entry replaces the `seen` Set.

Not done: anything that changes which car goes first, struct-of-arrays movers, and an incremental car grid (see
[Next](#next-1)). The flush's agent list (`Simulation.agents`, a generator that yields a new object per agent) is now
its largest cost, and the doc only reports it.

### Same game

- **London, tick for tick.** The `hash` fingerprints after the fill and after each of the day's 2,400 ticks are the
  same on main and the branch, checked at three points along the way (3f1eafe, 31e84ef, ecbfadb) and at the end
  (10bbbfb). Fill `a517a324`, end `8e0571f9`; both builds end with 31,905 citizens, 30,466 employed, 8,798 vehicles and
  the same traffic counters.
- **London saved and loaded again** (`--reload`). The snapshots are the same: 45,040,019 bytes each, with the same
  content hash when their keys are sorted (`3810d47d`). Only the order of a few citizen keys differs. The day after
  the load is the same tick for tick (`80ee1ed8` to `cc4f778f`).
- **The wire.** A client joined London at 12:00 (`--client-at 12`). Main and the branch sent it the same 13,160 frames,
  150,141,531 bytes in all, with the same hash (`a72a8293`). The 2×2 city gives the same result, both with the client
  there from the start and with it joining at 12:00.
- **Saves.** A save of the filled London has the same content on both builds: 45,040,019 bytes each, every value equal,
  and everything other than the citizens byte for byte the same. The files are not byte-identical, though. In 1,604 of
  the 30,840 citizens the late fields come in a different order (main writes them in the order that citizen happened to
  get them, for example `mig` before `skill`). A loaded world saved again also has the same content on both builds
  (44,312,174 bytes), but every citizen's keys start with `id` on the branch. Byte-identical files and one hidden class
  cannot both be had: main's key order records each citizen's history. If identical files matter, `snapshotOf` could
  write citizens' keys in a fixed order, which would change main's files once. On the 2×2 city the fresh saves happen
  to be byte-identical.
- **Old saves load.** Four saves written by main were loaded on both builds and played for a quarter of a day, with the
  same fingerprints on every tick: the dev world and the UAT world (format 8, about 1,880 citizens; 3.75 → 0.61 ms and
  4.75 → 0.92 ms a tick), the showcase demo (format 8, 17,283 citizens; 19.8 → 17.2 ms) and the civic demo (format 7,
  10,491 citizens; 8.7 → 7.6 ms). Main's London save loaded on the branch plays the same as on main (above).
- **ab.ts** on the Commons gives the same JSON on main and the branch, apart from the timings, for five setups: the
  defaults; `--hour 17 --ticks 2400 --set bus=2`; `ring=1,signalActuated=1`;
  `laneByLength=1,boxByCommit=0,crossingLag=0,pedBehind=1,boxClear=2`; and `old=1`.
- **`hypot-check.ts`**: 20,000,225 pairs, all the same as `Math.hypot`.

### Traffic step and whole tick

The **traffic phase** (`searchprof.ts --mode phases`: every `Traffic` step, enter, leave, beginTick, endTick and sweep,
plus `moveVehicles`' own time). Median of two runs each, interleaved, loads 5.2–7.3 at their starts:

| per tick | main mean / p95 | branch mean / p95 | |
| --- | --- | --- | --- |
| 08:00–09:00 | 18.60 / 23.01 ms | 8.78 / 11.34 ms | −53% |
| 17:00–18:00 | 29.03 / 33.56 ms | 15.42 / 17.87 ms | −47% |
| whole day | 17.86 / 28.98 ms | 8.83 / 15.13 ms | −51% |
| – of which `Traffic` methods, day | 16.76 ms | 7.85 ms | |
| – `moveVehicles` itself, day | 1.10 ms | 0.98 ms | |
| `moveCitizens` itself, day | 8.24 ms | 4.34 ms | the walkers, the same hidden classes |
| network flush (no clients), day | 5.90 ms | 3.60 ms | |
| route searches, day | 2.51 ms | 2.16 ms | |

The **whole tick** (`--mode bare`, no wrappers). Median of three runs each, interleaved base and branch from 20:14 to
20:38, loads 4.6–9.3:

| per tick | main mean / p95 | branch mean / p95 | |
| --- | --- | --- | --- |
| 08:00–09:00 | 38.52 / 49.27 ms | 21.83 / 30.36 ms | −43% |
| 17:00–18:00 | 55.73 / 70.02 ms | 32.83 / 41.53 ms | −41% |
| whole day | 36.51 / 59.45 ms | 20.88 / 35.67 ms | −43% |

The runs were 36.17, 36.58 and 36.51 ms on main and 20.88, 21.06 and 20.83 ms on the branch. A first main run at 18:40
took 50.0 ms while the machine was busier, and it is left out.

**A world loaded from a save** (`--mode hash --reload`, one run each; the fingerprinting adds a little to both):

| London, the day after a save and load | main | branch |
| --- | --- | --- |
| whole day mean / p95 | 139.09 / 210.90 ms | 20.62 / 34.09 ms |
| 08:00–09:00 / 17:00–18:00 | 145.58 / 165.26 ms | 23.60 / 28.55 ms |

**From one save** (`--load`): main wrote a save of the filled London. Each build then loaded that same file and played
a day from it (`--mode tprof --load`, no wrappers). Median of three runs each, interleaved from 21:11 to 21:28, loads
3.4–6.5 at their starts. This is the number that predicts prod, which always runs from a save:

| London loaded from main's save | main mean / p95 | branch mean / p95 | |
| --- | --- | --- | --- |
| 08:00–09:00 | 137.67 / 192.93 ms | 21.36 / 28.81 ms | 6.4× |
| 17:00–18:00 | 150.44 / 217.72 ms | 25.74 / 35.44 ms | 5.8× |
| whole day | 127.62 / 188.97 ms | 18.87 / 31.19 ms | 6.8× |
| network flush, day | 30.24 ms | 3.45 ms | |

The runs were 125.33, 127.62 and 132.25 ms on main and 18.87, 18.85 and 19.08 ms on the branch. A `hash` run of the
same day from the same file gives the same fingerprints on both builds (`80ee1ed8` to `1bff9c75`, 32,197 citizens at
the end).

On main, a London that has been saved and loaded runs 3.8 times slower than the same London before saving: 139 against
36.5 ms. That is about what prod shows, 124 ms with 53k citizens. It has not been measured on prod.

`shapes.ts`, on the 3×3 test city:

| | main | branch |
| --- | --- | --- |
| hidden classes after the fill | 4 (London: 11) | 2 |
| after a save and load | 10,728 for 10,728 citizens | 1 |
| 1,500 ticks later | 7,398, and 3,279 objects in dictionary mode | 3, none in dictionary mode |
| that day's tick | 24.9 ms (4.9 ms before saving) | 3.35 ms |

### The network flush with a client

| flush, ms a tick | main 08–09 / 17–18 / day | branch 08–09 / 17–18 / day |
| --- | --- | --- |
| no client (`tprof`) | 6.86 / 9.78 / 6.31 | 3.58 / 5.63 / 3.56 |
| one client on every chunk from 12:00 (`hash --client-at 12`) | 6.32 / 9.39 / 6.15 | 4.58 / 6.99 / 4.53 |

On main, the flush cost the same with a client or without one (the two runs differ by less than run-to-run noise). It
always built the agent buckets and `chunkKey` strings. On the branch, while nobody is subscribed, the buckets are not
built, and a client costs about 1 ms a tick for its buckets and the JSON. Most of what is left is `Simulation.agents`:
a generator that yields a new object for each of about 15,000 agents, followed by `lastSent`'s compare and update. That
part has to run with or without clients, or the first frame a later client gets would change.

### Next

- **Prod.** Check prod's tick after this branch. Main's loaded-world slowdown (above) suggests a large share of its
  124 ms is hidden classes, not the simulation. `shapes.ts` against a copy of prod's save would show it.
- **The flush's agent list** is now the largest single cost in the evening profile (`Simulation.agents` 7.6% self,
  flush 4.6%). The generator could yield one reused object, or take a visitor. Both consumers (`flush`, `subscribe`)
  read the fields at once, so the wire would be the same.
- **Garage pull-outs.** In the evening, 10,000 cars a tick ask `enter` whether they may pull out, and are told no. Only
  a rule change (try again every few ticks) would cut that much, and it would change the game.
- **An incremental car grid** (kept up to date on enter and leave) would save at most what `beginTick` costs now: 0.5–0.8
  ms a tick, wrapped. The grid holds where each car stood at the start of the tick, and most cars that are not queued
  move every tick, so they would be re-bucketed every tick anyway.
- **Struct-of-arrays movers: not now.** The traffic step is 8.8 ms of a 20.9 ms tick (−51%). Field reads on movers are
  now monomorphic, which was most of what typed arrays would have bought. What is left of the step is the rules
  themselves (`canEnter`, the guard's sweeps, path geometry). Movers in typed arrays would also touch every system that
  reads a citizen or a vehicle, and the step order (who enters a box first) would have to be kept exactly. Look at it
  again if traffic grows back past about 40% of the tick.

## Files

- `packages/server/src/loadtest/searchprof.ts`, `search-phases.ts`: the probe (phases, bare, record, CPU profile).
- `packages/server/src/loadtest/search-corpus.ts`: corpus format, recorder and reader.
- `packages/server/src/loadtest/search-replay.ts`: TS replay, check and worker-thread benchmark.
- `packages/server/src/loadtest/probe-city.ts`: the probes' city setup, shared with `jobsearch.ts`.
- `packages/server/src/loadtest/reroute-probe.ts`: `searchprof.ts --mode reroutes`, A\* by caller, re-route outcomes and traffic with `--set`.
- `packages/server/src/loadtest/count-hook.mjs`: also exposes the unwrapped search functions, and node counts with
  `SEARCH_HOOK_EXPANDED=1`.
- `tools/search-rs/`: the Rust spike (`cargo run --release -- CORPUS_DIR`).
- `packages/server/src/loadtest/traffic-probe.ts`: `searchprof.ts --mode tcount | tprof | hash`, with `--client`,
  `--client-at H`, `--reload`, `--save`, `--resave` and `--load` (the traffic step's methods, rush-hour CPU profiles,
  the per-tick fingerprint).
- `packages/server/src/loadtest/shapes.ts`: the movers' hidden classes after a fill, a save and load, and a day on.
- `packages/server/src/loadtest/hypot-check.ts`: traffic.ts `hypot` against `Math.hypot`.
