# Load tests

How big a city gets before the 5 Hz simulation tick runs out of time.

## Method

`packages/server/src/loadtest/run.ts` builds a test city with `seedCity` (an N×N grid of Commons-style
22×22 districts on one connected road grid, all owned by the Commons player, every zone pre-built to level 3),
fast-forwards the real `Simulation` and `Net.flush()` in a tight loop until the population stops growing
(under 0.5% an hour for three hours, at most `--days` game days), then times one full game day
(2400 ticks) tick by tick. Tick time is `sim.tick()` plus `net.flush()`, as in the server main loop.
Three fake clients receive the real flush output: one subscribed to every chunk of the city, one to the
chunks the central district overlaps, and one to the window the real client keeps zoomed in (4×4 chunks,
128×128 tiles, around the origin; 5×5 chunks in the runs before "After dispatch indexing", when the client
never streamed less). Their sockets count bytes, so ws framing and syscalls are not included.
Agent bytes are the `citizens` frames only. Chunks are 32 tiles and districts are not chunk-aligned, so the
central district overlaps 4 chunks (64×64 tiles).
Pathfinding calls are counted by a loader hook (`count-hook.mjs`) that wraps the exported search functions.
Runs use `nice -n 10` beside the live dev servers, so absolute numbers are a little pessimistic.

Budget at 5 Hz: average tick ≤ 50 ms and worst tick ≤ 200 ms (one tick interval).

Machine: Apple M2 Max, 12 cores, 64 GB, Node v20.2.0, darwin.

```sh
nice -n 10 npx tsx packages/server/src/loadtest/run.ts --districts 2 --days 3
```

## Findings (2026-10-16, before any optimisation)

- **The budget breaks at 3×3 districts (about 8.5k citizens).** The average there is 28 ms, but the 08:00 and
  16:00–18:00 hours average 55–69 ms, and 120 ticks a day take over 200 ms (worst 636 ms). The average itself
  passes 50 ms at 4×4 (15k citizens, 59 ms). 2×2 (3.8k) is the largest size inside the budget, with a 133 ms worst tick.
- **The spikes are the dispatch tick.** Every 10th tick `dispatch()` starts freight, visitors and patrols.
  Each of them runs a `findBest` search that never stops early: it expands its whole node budget (1,500 for freight,
  2,500 for visitors, 1,200 for patrols). The number of searches grows with the city: at 4×4 there are 736
  industrial lots, which gives about 95 freight trips per dispatch, plus about 180 visitors per dispatch at peak
  hours (12 per 100 residents per hour). Once the road network is bigger than the node budget (from 3×3), each
  search costs a fixed ~4 ms. Below that the cost per search also grows, so tick time is super-linear up to 3×3
  and linear after that.
- **A\* is not the problem yet.** `findRoute` is 3–5% of CPU even at 6×6, with up to 635 calls in one
  shift-change tick. Network flush averages under 3.5 ms a tick. Hovering a building (`describe()`) costs 0.6 ms at 34k
  citizens. The heap stays under 120 MB.
- **Every client receives the whole city.** The client never streams fewer than 5×5 chunks (160×160 tiles),
  so up to 6×6 districts each player gets every moving agent. That is 55 KB/s of agent frames at 4×4 and
  101 KB/s at 6×6, with bursts of 290 KB/s at 08:00. A view of one district's chunks would need only ~5 KB/s.

CPU profile of the measured day at 4×4 (sampled self time):

| function | self % |
| --- | --- |
| `findBest` (pathfinding.ts) | 79.2% |
| score callbacks passed to `findBest` (simulation.ts) | 4.0% |
| `findRoute` (pathfinding.ts) | 3.3% |
| `World.getChunk` (via `peekTile` in the searches) | 2.7% |
| `consider` closure inside `findBest` | 1.2% |
| garbage collector | 1.0% |
| `Simulation.recomputeStats` | 0.9% |
| `Simulation.agents` | 0.8% |

By caller, `findBest` takes 86.7% of samples. Calls from `dispatch` account for 78.1% and calls from `seekSite`
(builders looking for work) for 8.3%.

Recommendations, by expected gain:

1. **Stop dispatch from running hundreds of full-radius searches.** Visitors all start from the same four
   entry tiles, so one search per entry per game hour can list the candidate destinations with their paths, and
   each visitor then samples from that list. Freight can cache its commercial candidates per industrial building
   and refresh when tiles change. This removes most of the 78%. Spreading dispatch over all 10 ticks instead of
   one is a quick first step: it cuts the worst tick several times over but leaves the average unchanged.
2. **Make the BFS cheaper and skip pointless searches.** `findPath` and `findBest` key their visited sets on
   `"x,y"` strings and `key + 'g'`. Numeric `tkey` keys in a generation-stamped typed array would make every
   search several times cheaper. `seekSite` should return at once when no site is open, which is the normal case
   in a grown city.
3. **Shrink the agent stream.** Binary agent frames (u32 id, i16 x/y in hundredths, u16 flags, 10 bytes
   against ~25 bytes of JSON per agent) would cut bandwidth about 2.5×. Sending full detail only for nearby
   chunks would make per-client bandwidth independent of city size again. This is bandwidth, not tick time.

## Runs

| date (UTC) | districts | citizens | jobs | peak cars | queued at peak | avg ms | p95 ms | max ms | sim / flush avg ms | heap MB | RSS MB | agent B/tick city | agent B/tick central district (chunks) | agent B/tick min client view | A*/tick | BFS/tick | hover ms | budget | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-16 11:10 | 1×1 | 948 | 1666 | 157 | 78% | 0.67 | 2.93 | 9.6 | 0.56 / 0.10 | 11.4 | 188.5 | 1020 | 1020 (4) | 1020 | 2.12 | 1.54 | 0.06 | ok | fill 1.33 d |
| 2026-10-16 11:11 | 2×2 | 3792 | 6664 | 369 | 69% | 6.64 | 43.96 | 133.3 | 6.32 / 0.33 | 27.3 | 193.0 | 3217 | 614 (1) | 3217 | 6.63 | 6.12 | 0.17 | ok | fill 1.25 d |
| 2026-10-16 11:13 | 3×3 | 8536 | 14994 | 782 | 69% | 28.08 | 221.22 | 636.3 | 27.33 / 0.75 | 38.8 | 217.3 | 6531 | 5285 (4) | 6531 | 13.94 | 13.98 | 0.30 | **over** | fill 1.17 d |
| 2026-10-16 11:17 | 4×4 | 15168 | 26656 | 1345 | 71% | 58.99 | 505.87 | 1246.9 | 57.63 / 1.36 | 39.0 | 236.8 | 11195 | 1090 (1) | 11195 | 24.03 | 24.35 | 0.49 | **over** | fill 1.17 d |
| 2026-10-16 11:26 | 6×6 | 34128 | 59976 | 2827 | 70% | 132.66 | 1140.43 | 3008.7 | 129.34 / 3.33 | 86.0 | 294.9 | 24314 | 1097 (1) | 20748 | 52.71 | 54.91 | 0.57 | **over** | fill 1.17 d |

## After dispatch indexing (2026-10-16)

What changed:

- **Building index on `World`.** `syncBuilding` and the world loader keep, per zone, a list of built buildings
  (level > 0) and a grid of 16×16-tile cells, so "candidates near (x, y)" is a few map lookups
  (`eachBuiltNear`, `bestBuiltNear`). Bulldozing, rezoning, upgrades and finished sites all go through
  `setTile`, so the index follows them.
- **Dispatch picks from the index and routes once.** Freight picks a shop within 40 tiles, visitors pick a shop
  or office anywhere, and patrols and call-outs pick a building in the station's service square. Each uses the
  old weighting, with Manhattan distance in place of BFS depth. The trip is then routed once with A\*, and
  only if that fails (close by but not by road) does it fall back to a road search, which now stops early.
  Dispatch runs every tick on a rotating tenth of the industrial buildings and stations. The roll chance is
  unchanged, so each building is still rolled once per 10 ticks. Trips go through a queue that starts at most
  60 a tick. Per-day trip rates are unchanged: at 3×3 over one day, old and new code gave 3,912 and 3,826
  freight trips and 9,671 and 9,664 visitors, with the same mean distance to the destination.
- **`findBest` stops early.** Callers can pass an upper bound on the score and on score minus distance. The
  search ends once the best so far cannot be beaten at the next BFS depth. Builders compute both bounds from
  the open sites and return at once when there are none. `findLot` returns at once when no lot with a free
  bay is within `PARK_RADIUS`. Both BFS searches key their visited sets on numeric tile keys.
- **Client streaming follows the view.** The client subscribes to the ground footprint of the view (corner rays
  cut off where the fog is opaque) plus a chunk of margin, two when tilted low. That is clamped to at least 1
  and at most the old radius (never more than 6) either side of the target's chunk. Zoomed in on a district it
  keeps 4×4 chunks instead of 5×5. The fog is unchanged.

Before/after (before = the 11:10–11:26 runs above, after = the rows below; the traffic code was also being tuned
between the two, so car counts differ a little):

| districts | citizens | avg ms before → after | p95 ms before → after | max ms before → after | budget before → after |
| --- | --- | --- | --- | --- | --- |
| 2×2 | 3.8k | 6.64 → 1.41 | 43.96 → 3.27 | 133.3 → 23.3 | ok → ok |
| 3×3 | 8.5k | 28.08 → 3.59 | 221.22 → 8.77 | 636.3 → 51.9 | **over** → ok |
| 4×4 | 15.2k | 58.99 → 6.40 | 505.87 → 16.13 | 1246.9 → 38.6 | **over** → ok |
| 6×6 | 34.1k | 132.66 → 12.65 | 1140.43 → 27.09 | 3008.7 → 60.8 | **over** → ok |

No tick over 200 ms at any size. 6×6 peaks at 20–23 ms an hour on average during the 08:00 and 17:00 rush.
The 4×4 zoomed-in view still holds every chunk of cities up to 4×4 (94×94 tiles), so its agent bytes only fall
at 6×6: 20,748 → 19,380 B/tick there. Making per-player bandwidth independent of city size needs smaller
frames or per-chunk detail levels (recommendation 3 above).

CPU profile of the measured day at 4×4 after the change (sampled self time, 19.6 s):

| function | self % |
| --- | --- |
| `findRoute` (pathfinding.ts) | 23.2% |
| `Simulation.agents` | 7.4% |
| `Simulation.recomputeStats` | 6.6% |
| `Net.flush` | 5.5% |
| `Traffic.step` | 5.2% |
| `Simulation.moveCitizens` | 5.2% |
| `Net.send` | 3.2% |
| `findPath` (pathfinding.ts) | 2.9% |
| garbage collector | 2.7% |
| `Traffic.congestionAt` | 2.5% |

`findBest` is down from 79.2% to 0.1%, and `dispatch` plus the index lookups to under 0.5%. By caller, A\*
(31.3% inclusive) is `headBack` (vehicles driving home, 12.2%), `maybeReroute` (11.3%), `spawnVehicle` (5.3%)
and `plan` (2.5%). The next gains are cheaper return trips (reuse the outbound route reversed) and fewer
re-routes.

| date (UTC) | districts | citizens | jobs | peak cars | queued at peak | avg ms | p95 ms | max ms | sim / flush avg ms | heap MB | RSS MB | agent B/tick city | agent B/tick central district (chunks) | agent B/tick min client view | A*/tick | BFS/tick | hover ms | budget | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-16 11:53 | 2×2 | 3792 | 6664 | 386 | 76% | 1.41 | 3.27 | 23.3 | 1.12 / 0.28 | 39.0 | 203.9 | 3286 | 601 (1) | 3286 | 6.30 | 3.36 | 0.17 | ok | fill 1.17 d; view client 4×4 chunks |
| 2026-10-16 11:53 | 3×3 | 8532 | 14994 | 761 | 71% | 3.59 | 8.77 | 51.9 | 2.86 / 0.73 | 35.7 | 220.9 | 6678 | 5376 (4) | 6678 | 13.35 | 7.27 | 0.31 | ok | fill 1.17 d; view client 4×4 chunks |
| 2026-10-16 11:53 | 4×4 | 15168 | 26659 | 1420 | 75% | 6.40 | 16.13 | 38.6 | 5.24 / 1.16 | 63.7 | 250.8 | 11618 | 1100 (1) | 11618 | 23.32 | 13.00 | 0.47 | ok | fill 1.17 d; view client 4×4 chunks |
| 2026-10-16 11:54 | 6×6 | 34128 | 59984 | 2829 | 73% | 12.65 | 27.09 | 60.8 | 9.89 / 2.75 | 152.6 | 367.3 | 25199 | 1107 (1) | 19380 | 50.68 | 29.22 | 0.53 | ok | fill 1.17 d; view client 4×4 chunks |

## After citizen lives (2026-10-16)

What changed: every citizen has an age, life stage, health with conditions, a household, a partner, up to five
friends and daily happiness (`server/src/sim/life.ts`). The life step runs once per game day per citizen, staggered
by id, so about one citizen in 2,400 takes it each tick. Driving trips also bump two per-citizen counters while held
up in traffic. Once a game day, the first life step rebuilds a who-works-where and who-lives-where index for partners
and work friends: about 3–5 ms in that one tick at 4×4 (15k citizens). The life step itself averages 24 µs a call,
about 0.15 ms a tick at 4×4. People also do a little more: children and friends join outings, retirees go out more,
the ill see a doctor, and people living alone leave town now and then. That adds about 2% to the agents out and about.

Method: the machine was shared with other agents (load average 7–13), and the tree had moved on since the rows above
(traffic tuning and other work), so the 6.40 ms 4×4 figure no longer reproduces even without lives. Each row with
lives is therefore paired with a baseline run straight after it on the same tree. The baseline is a scratch copy
with `simulation.ts`, `world.ts` and `store.ts` restored to how they were before lives. Columns are a subset of the
table above. `--days 3`, seed 1, built 3.

| date (UTC) | districts | citizens | jobs | peak cars | queued at peak | avg ms | p95 ms | max ms | sim / flush avg ms | heap MB | ticks > 200 ms | budget | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-16 14:27 | 2×2 | 3781 | 6664 | 383 | 53% | 2.43 | 5.02 | 20.9 | 2.08 / 0.35 | 46.5 | 0 | ok | with lives |
| 2026-10-16 14:28 | 2×2 | 3792 | 6664 | 356 | 63% | 2.25 | 4.57 | 37.5 | 1.91 / 0.34 | 30.3 | 0 | ok | baseline: same tree, lives removed |
| 2026-10-16 14:23 | 2×2 | 3781 | 6664 | 362 | 58% | 2.77 | 6.08 | 68.3 | 2.33 / 0.44 | 33.8 | 0 | ok | with lives (before the social-index cache) |
| 2026-10-16 14:23 | 2×2 | 3792 | 6664 | 364 | 57% | 2.38 | 4.94 | 27.5 | 2.01 / 0.36 | 28.7 | 0 | ok | baseline |
| 2026-10-16 14:28 | 4×4 | 15136 | 26656 | 1244 | 59% | 11.50 | 23.84 | 66.1 | 9.99 / 1.51 | 73.9 | 0 | ok | with lives |
| 2026-10-16 14:29 | 4×4 | 15168 | 26656 | 1215 | 57% | 10.29 | 22.45 | 46.3 | 8.89 / 1.39 | 53.6 | 0 | ok | baseline: same tree, lives removed |
| 2026-10-16 14:23 | 4×4 | 15116 | 26656 | 1227 | 54% | 12.11 | 24.72 | 50.3 | 10.46 / 1.65 | 89.2 | 0 | ok | with lives (before the social-index cache) |
| 2026-10-16 14:22 | 4×4 | 15168 | 26656 | 1250 | 55% | 11.75 | 27.08 | 80.2 | 10.03 / 1.73 | 54.9 | 0 | ok | baseline |

The cost is under the run-to-run noise at 2×2. At 4×4 it is +0.4 to +1.2 ms average (3–12%) in two pairs. Worst
ticks go both ways between runs (46–80 ms baseline, 50–66 ms with lives). No tick is over 200 ms, and every size
stays well inside the budget.

## Test cities in the browser (2026-10-16)

The join form lists the live world and six test cities, 1×1, 2×2, 3×3, 4×4, 6×6 and 8×8 districts, so the slowdown
can be watched in the real client instead of read from a table. They are the same `seedCity` cities as above (every
district built to level 3, all technology), about 950 people a district.

How it works (dev servers only, never with `NODE_ENV=production`):

- **One process per city.** `packages/server/src/testcities.ts`, started by the main server, spawns the same server
  entry as a child with `PORT=8100+n`, `WORLD_FILE=data/test-cities/city-<n>x<n>.json` (git-ignored, never the live
  world's file), `CITY_DISTRICTS=n` and the built client as `STATIC_DIR`. A new world is seeded with
  `seedCity(…, { districts: n, built: 3 })` and fast-filled before the socket accepts anyone: the simulation runs in a
  tight loop, a game hour at a time, until the population grows under 0.5% an hour for three hours (at most 1.5 game days),
  then it saves. Starting a saved 1×1 city again took 0.7 s; bigger worlds take longer to load.
- **Endpoints on the main server.** `GET /api/test-cities` lists the cities with status (stopped, starting with fill
  progress, running with population, clients and the server tick average, stopping) and `POST /api/test-cities/<n>/start`
  (or `/stop`) controls one. The status comes from the child's `/healthz`, polled every two seconds.
- **Lifecycle.** A city with no clients for ten minutes (`TEST_CITY_IDLE_MS`) saves its world and exits. The child
  watches this itself (`watchIdle`) and the main server also stops an idle city with SIGTERM, whichever notices first.
  A child never watches its parent.
- **Survives main-server restarts.** `tsx watch` restarts the dev server on every save under `packages/server/src` or
  `packages/shared`, which used to take every test city down mid-measurement. Now a child is spawned detached (its own
  process group, so a Ctrl-C does not reach it) with stdout and stderr in `data/test-cities/city-<n>.log`, and the main
  server records it in `data/test-cities/running.json` (git-ignored with the rest of `data/`):
  `{ "version": 1, "cities": [ { "districts": 1, "port": 8101, "pid": 12345, "startedAt": 1760000000000 } ] }`.
  The entry is written when the child is spawned and removed when it exits or is stopped. On startup the main server
  reads the file and adopts every entry whose pid is alive and whose `/healthz` answers with that pid and the same
  number of districts (a city answering on its port with no entry is adopted too); other entries are dropped as stale.
  An adopted city shows in `GET /api/test-cities` exactly as one the server started, with live tick averages, and
  `start` waits for adoption so no duplicate is spawned.
- **When the main server stops the cities.** Only on an explicit `/stop`, on the idle timeout, and on a real shutdown.
  The server tells a reload from a shutdown by signal: `tsx watch` sends SIGTERM to the old process on a reload, so SIGTERM
  leaves the cities running (the server saves its own world and exits); SIGINT, which is Ctrl-C on `npm run dev`, stops
  them all and waits up to ten seconds for their saves. `TEST_CITY_STOP_ON_EXIT=1` makes SIGTERM a real shutdown too, for
  a server that is not under `tsx watch`. Closing the terminal (SIGHUP) or killing the stack with SIGKILL leaves
  the cities running; they exit on their own idle timer. Checked with a throwaway second server (port 8099, cities from
  8150, a scratch world file) and a 15 s idle time: SIGTERM of the server left the city running and the next server
  adopted the same pid, SIGINT stopped it and emptied `running.json`, a stale entry was dropped, and an orphan whose server
  was gone saved and exited 14 s after its last client left.
- **Client.** Joining a city reloads the page with `?ws=<host>:<8100+n>&city=n`, which is the existing `?ws=` override, and
  shows a banner "Test city 4×4 — not the live world" with a link back. `?city=n` alone starts the city and joins it.
  If the city's process disappears (idle stop, Ctrl-C of the dev stack), the client asks the main server to start it again.
- **Perf readout.** The top-bar **perf** chip or **Shift+M** (always on in a test city): server tick average, p95 and max over the
  last minute (300 ticks, simulation plus flush, from the optional `tickAvg`, `tickP95` and `tickMax` fields of the `stats`
  message) against the 200 ms budget, amber past 50 ms and red past 200 ms; agents and KB per second received by this client;
  FPS and frame time; agents drawn, chunks loaded and draw calls. The same server figures are in `/healthz`.

Measured in headless Chrome on the Metal GPU (Apple M2 Max, 1440×900), one client joined through the picker on a freshly
deleted world file, camera 40 tiles out over the city centre, lighting pinned to 08:00, read at 10:00 game time so the
server window covers the 07:00–10:00 rush (the 300-tick window is three game hours). Run on a busy machine: load average
15–20 on 12 cores with other agents building and testing, and the city process is not niced. Server numbers are therefore
pessimistic against the harness runs above (4×4 averaged 6.4 ms there, 10–12 ms in the later pairs).

| districts | citizens | picker click to joined, s | server avg ms | p95 ms | max ms | agents/s | KB/s | client fps | frame ms | agents drawn | draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1×1 | 946 | 17.1 | 1.71 | 2.89 | 20.7 | 298 | 10.9 | 58.5 | 17.2 | 97 | 28 |
| 2×2 | 3,799 | 15.5 | 6.07 | 8.50 | 442 | 867 | 25.0 | 58.9 | 17.0 | 256 | 29 |
| 3×3 | 8,535 | 60.9 | 11.83 | 20.75 | 75.1 | 2,036 | 58.9 | 59.3 | 16.9 | 636 | 30 |
| 4×4 | 15,160 | 44.4 | 28.62 | 67.03 | 227 | 3,381 | 92.9 | 59.1 | 16.9 | 919 | 30 |
| 6×6 | 34,066 | 75.8 | 35.22 | 59.81 | 94.0 | 6,296 | 168.6 | 58.7 | 17.1 | 1,699 | 30 |
| 8×8 | 60,667 | 93.5 | 75.57 | 143.67 | 310 | 7,222 | 193.3 | 55.7 | 18.4 | 1,902 | 30 |

Reading it:

- **Server tick is the first thing to go.** Past 4×4 the average is over 25 ms; at 8×8 it is 76 ms, over the 50 ms average
  budget, with the p95 at 144 ms and a worst tick of 310 ms. A single worst tick over 200 ms also showed at 2×2 (442 ms) and
  4×4 (227 ms); with the machine this loaded these look like scheduling stalls, not the simulation, but they are not ruled out.
- **The client stays at 55–59 fps up to 8×8**, because it draws about 30 instanced draw calls and a view of about 25 chunks
  whatever the city size. Agents drawn grows with the city (97 to 1,902) but is capped by what is streamed around the view.
- **Bandwidth keeps growing**: 11 KB/s at 1×1 to 193 KB/s at 8×8 for one client, with the camera on the centre. Agents per
  second is roughly linear in citizens up to 6×6 and flattens as the view window saturates.
- Fill plus start takes 15–20 s up to 2×2 and 45–95 s from 3×3 to 8×8, including opening the page and the picker's polling.
- The live world was unaffected throughout: about 1,020–1,030 citizens, server tick average 3–7 ms, and its clock
  kept advancing while each city ran.
- The client FPS figures need a real GPU: with software rendering (SwiftShader) the same 1×1 view runs at 3 fps.

| 2026-10-16 18:57 | 4×4 | 13977 | 25120 | 1199 | 62% | 13.06 | 27.53 | 79.1 | 11.21 / 1.85 | 59.1 | 316.2 | 14447 | 1410 (1) | 14447 | 20.20 | 12.01 | 0.56 | ok | fill 1.17 d; bus=3: a depot and two bus lines (twelve stops) per district, 3 buses per line |
| 2026-10-16 18:59 | 4×4 | 15115 | 26656 | 1229 | 66% | 12.67 | 26.17 | 81.7 | 10.95 / 1.72 | 111.6 | 312.1 | 14222 | 1384 (1) | 14222 | 21.61 | 13.23 | 0.58 | ok | fill 1.17 d; baseline for the bus=3 row above: same code, no buses |
| 2026-10-16 19:46 | 4×4 | 13983 | 25120 | 1189 | 68% | 12.15 | 26.05 | 72.9 | 10.50 / 1.66 | 94.5 | 334.7 | 14630 | 1366 (1) | 14630 | 20.23 | 12.05 | 0.51 | ok | fill 1.17 d; bus=3, final transit code: a depot and two bus lines (twelve stops) per district, 3 buses per line |

## After merged lots (2026-10-16)

What changed: zoned lots merge into bigger buildings (docs/buildings.md "Merged lots"). The growth pass now runs a
bounded merge search for buildings that win the demand roll (at most 24 searches and 8 merges a pass, at most two merges
being built at once per parcel), and one pass over the citizens moves everyone in the merged lots to the new door.
Merged homes take newcomers one chance per dozen beds, and a merged works sends freight by its jobs.

Method: `--districts 4 --days 3`, seed 1, built 3, run back to back on the same tree. The baseline is a scratch copy
of the tree from before the change. The fill stops when the population settles, after 1.25 days in both runs. Merges
are throttled per parcel, so the measured day of the merged run is still mid-growth: 15.2k citizens at its start,
16.6k at its end (`day range` in the log), against 15.1k flat in the baseline.

| date (UTC) | districts | citizens | jobs | peak cars | queued at peak | avg ms | p95 ms | max ms | sim / flush avg ms | heap MB | RSS MB | agent B/tick city | agent B/tick central district (chunks) | agent B/tick min client view | A*/tick | BFS/tick | hover ms | budget | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-16 21:21 | 4×4 | 16628 | 26656 | 1234 | 63% | 14.51 | 29.36 | 70.8 | 12.37 / 2.15 | 90.2 | 294.4 | 14913 | 1523 (1) | 14913 | 22.52 | 14.52 | 0.70 | ok | fill 1.25 d; merged lots |
| 2026-10-16 21:22 | 4×4 | 15126 | 26656 | 1193 | 61% | 12.81 | 27.32 | 51.1 | 10.98 / 1.82 | 69.3 | 289.3 | 14284 | 1371 (1) | 14284 | 22.02 | 13.20 | 0.56 | ok | fill 1.25 d; baseline: same tree without merged lots |

The average rises by 1.7 ms (13%) with 10% more citizens, which is about what the extra people cost. No tick is
over 200 ms. The growth pass itself (2×2 probe, 4 days): 1.98 ms average and 5.7 ms worst with merges, against
1.32 ms and 12.5 ms before. It runs once every 40 ticks.

A heavier check on a city that has merged for a week: a copy of test city 4's saved world, fast-forwarded 7 game days
(15.1k to 21.9k citizens, 215 merges, 0 evicted), then one day timed (`sim.tick` only, no network). It ran beside a
baseline that timed the unmerged copy on the tree from before the change. The machine was heavily shared at the time
(load average 28-55 on 12 cores), so only the ratio means anything:

| world | citizens | avg ms | p95 ms | max ms | ms per 1,000 citizens |
| --- | --- | --- | --- | --- | --- |
| test city 4 copy, baseline code | 15,096 | 97.9 | 223.5 | 673.6 | 6.5 |
| test city 4 copy after 7 merged days | 23,369 | 129.1 | 271.9 | 677.8 | 5.5 |

Tick cost follows the number of citizens, and merged buildings do not make each citizen dearer. The absolute numbers
here are over budget for the baseline too because of the shared machine; the harness rows above are the budget figures.

## Failed job searches and slow tile reads (2026-10-17)

The London demo (about 62k jobs for 30k residents, few of them in the suburbs) was reported filling with single ticks of
7 s and more, blamed on newcomers' job searches that find nothing and so walk their whole road-search budget. That run
did not reproduce on the current tree: the worst tick of a seeded London fill was 422 ms. Taking the slow ticks apart
found three causes, and the fix for each applies to every city:

- **`localIndex` was slow for negative coordinates.** It used `mod`, and in this Node (20.2, arm64) `a % n` with a
  negative `a` and a divisor that is not a literal costs about 150 ns, against 2 ns for a positive `a` (a V8 slow path,
  measured in isolation). Every tile read west or north of the origin went through it twice, so a 2,500-node road search
  took 5.6 ms on London. `localIndex` now uses `Math.floor` (the same result for every integer; no call passes anything
  else) and the same search takes 1.0 ms; an A\* search 6.2 → 1.8 ms. `World.getChunk` also keeps chunks by a numeric
  key, so a tile read builds no key string.
- **Searches for a goal no road reaches.** Parks seeded in London have doors with no road beside them, so every outing
  that picked one ran a 4,000-node A\* and then a 2,500-node walk search before giving up: 561 such trips in two
  evening hours, 20 ms each, and the 230–420 ms ticks at shift end. `pathBetween` and `findRoute` now return null at
  once when the goal has no road beside it and is not next door to the start. The searches could never have found it,
  so results are unchanged.
- **Repeated failed job searches.** `findJob` remembers a search that found nothing per home: the box of tiles it
  looked at and the full workplaces it passed. Until one of those workplaces has room again, or a workplace, road,
  junction byte or chunk changes in that box (`World.jobEditedSince`, kept per 16×16 cell), the same home gets the same
  answer without searching. The goal test also reads the tile word before the building map, so most tiles cost no
  string key. Misses are dropped at midnight.

Method: `nice -n 10 npx tsx packages/server/src/loadtest/jobsearch.ts --demo london` (or `--districts 8`) seeds the
city under a seeded `Math.random`, fills it as the demo and test-city children do, times every tick of the fill, then
runs one more game day. Ticks are `sim.tick()` plus `airports.tick()`, without the network flush. Selected simulation
steps are wrapped so each slow tick is pinned on what it did. Before and after ran on the same machine, which was
shared with other agents.

| city | phase | avg ms before → after | p95 ms | p99 ms | max ms | ticks > 200 ms |
| --- | --- | --- | --- | --- | --- | --- |
| London, 29k | fill (2.4 days) | 40.7 → 21.0 | 92.1 → 45.6 | 161.5 → 57.5 | 422 → 113 | 26 → 0 |
| London, 29–30k | next day | 55.0 → 27.6 | 104.1 → 48.8 | 167.9 → 56.4 | 387 → 103 | 14 → 0 |
| 8×8, 60k | fill (1.25 days) | 31.6 → 14.8 | 67.7 → 31.4 | 95.0 → 43.0 | 213 → 174 | 1 → 0 |
| 8×8, 60–66k | next day | 50.2 → 29.3 | 89.7 → 52.4 | 111.5 → 64.1 | 168 → 105 | 0 → 0 |

Fill wall time: London 234 → 121 s, 8×8 95 → 44 s. As a check against the harness rows above, `run.ts --districts 4
--days 3` after the change gives 15.2k citizens with an average of 8.75 ms, a p95 of 16.30 ms and a worst tick of 49.6 ms
(sim 7.26 ms, flush 1.49 ms). The last 4×4 rows above (merged lots) were 12.8–14.5 ms average and a p95 of 27–29 ms.

Behaviour is unchanged. The 8×8 run makes exactly the same calls with the same outcomes before and after (136,814 job
searches in the fill, 76,089 finding nothing; 65,706 of 65,706 adults employed at the end). London was identical
through 1,400 ticks of its fill and then drifts. The goal-without-a-road shortcut skips calls to `Traffic.cost`, which
tidies decayed congestion entries as it reads them, so congestion differs by under 0.004 and later routes differ
chaotically. The searches return the same answers. Employment in London is the same either way: 30,007 of 30,007
adults employed before and 30,086 of 30,086 after, with 0–28 adults between jobs at any 3-hour sample in both runs.

Left as they are: `moveVehicles` (7–9 ms a tick) is now the largest cost in both cities, and the 8×8 worst fill tick
(174 ms) has no slow simulation step under it (likely garbage collection). London parks with no road at the door are
never visited. That is a seeding issue for the London map, not a performance one.
