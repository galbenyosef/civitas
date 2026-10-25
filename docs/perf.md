# Performance monitoring and profiling

How to see where the time goes, on the server and in the browser, before it becomes a problem, and how to point at the
cause of a stutter. Built 2026-10-25 (card c9914661). Everything here is in-memory and dependency-free: ring buffers,
a scrape endpoint, files the user downloads or the server writes under its data directory.

The measurement method is the house one from [search-perf.md](search-perf.md): paired runs on the same machine, the
difference with its standard error, and a plain `ab.ts` run identical before and after (the instrumentation changes no
result). The numbers in this file were measured on the shared Mac while other agents had it at a load average of 8 to
50; they are relative, not the showcase's.

## Server

### Tick phases (`packages/server/src/perf/phases.ts`)

`Simulation.tick()` and `Game.loop()` lap `performance.now()` between the subsystems. Every loop is split into twelve
phases, in the order they run:

| phase | what it covers |
| --- | --- |
| `plan` | newDay, schools, learning, the periodic stats, growth, spawn, the entries scan |
| `gateways` | arrivals through gateways and the first settlers |
| `traffic0` | the traffic sweep and `beginTick` (the car grid) |
| `citizens` | `moveCitizens`: every citizen's step, with the route and job searches inside it |
| `vehicles` | `moveVehicles`: buses, trucks, taxis and service vehicles |
| `transit` | the lines (buses, rail, metro, ferries) |
| `mobile` | mobile services (vans, hearses, repair crews) |
| `dispatch` | the dispatcher (freight, builders, deliveries) |
| `traffic1` | `endTick` (speeds, queues, the congestion field) |
| `systems` | airports, harbours, finance, issues, fires, adverts |
| `flush` | the network flush: agent buckets and the JSON to every client |
| `history` | the hourly history sample |

The stats keep a rolling minute (300 ticks) per phase: average, p95, max and share of the tick; the ten worst ticks since
start with their phase breakdown and game hour; and a ring of the last 50 **long ticks** (over `PERF_TRACE_MS`, default
twice `TICK_MS` = 400 ms) with the work of that tick: route searches and A\* nodes expanded (`pathfinding.ts SEARCH`),
messages and bytes sent (a counting `Conn` wrapper in `Net`), agents streamed, citizens moving and driving. Each long
tick is logged as one line (the first three, then every tenth):

```
long tick 529.2 ms at 21:31 (tick 51660): citizens 215.4, mobile 201.3, flush 44.0; 61 routes, 5215 nodes, 0 msgs, 0 KB, 0 agents
```

The module is pure (typed arrays and `performance.now()` only), so the local-mode worker carries it; `npm run local:check`
still passes. `PERF_PHASES=0` turns the laps off; the whole-tick time is kept as before. Determinism: the timers add no
state and no random draws; `ab.ts` gives the same counts with them on (checked, see Checks).

**Cost of the laps** (`npm run perf:check -- --cost`): one lap is 65 ns (a million of them, the minimum of five runs),
fourteen a tick are 0.9 µs: 0.023% of the 2×2's 4 ms tick and 0.0025% of a 36 ms London tick. The whole-game check
(25-tick blocks with the laps on and off, alternating, forty pairs, the same game) cannot see them: −0.055 ± 0.073 ms a
tick, noise on this loaded Mac. `PERF_PHASES=0` leaves one `performance.now()` a loop, as before.

### Endpoints (`packages/server/src/perf/monitor.ts`, Node only)

| | |
| --- | --- |
| `GET /healthz` | as before, plus `longTicks` (since start) and `heapUsed` |
| `GET /api/perf` | the full picture: `tick` (avg, p95, max, long, count over the last minute), `phases` (avg, p95, max, share per phase), `recent` (the last 300 tick times with their game ticks and wall-clock stamps), `worst` (ten, with phases, hour, counters), `traces` (the last 50 long ticks), `rates` (per second: routes, nodes, msgs, bytes, agents; per tick: moving, driving), `loop` (event-loop lag mean/p95/max since the last look, from `monitorEventLoopDelay`), `gc` (pauses since start and in the last minute, from a `PerformanceObserver` on `gc`), `mem` (rss, heap), `save` (the last and longest world save), `world`, `hour`, `pid`, `uptime` |
| `POST /api/perf/profile?ms=5000` | an inspector CPU profile of that process for the span (200 µs sampling), written to `data/perf/<world>-<time>.cpuprofile`, with the top 15 self-time functions in the response (`loadtest/profile-summary.ts summarizeProfile`). One at a time (409 while one runs); 60 s at most |
| `GET /metrics` | Prometheus text exposition, written by hand |

On a main server with children, `?demo=london` or `?city=2` on the two API routes proxies to that child, and `/metrics`
appends every running child's metrics to its own, so one scrape target covers the showcase and its London.

**Reading the event-loop lag.** The probe is a 20 ms timer; a 70 ms tick makes it 50 ms late, so the lag's p95 tracks
the tick time and says nothing new. What matters is lag *above* the tick max: then the host (another process, a page-out,
a save) held the loop, not the simulation.

### The profile recipe (where are the hits coming from?)

Two commands, during the stutter:

```sh
# 1. a five-second CPU profile of the London child, through the showcase's main server
curl -s -X POST 'http://10.8.1.108:8290/api/perf/profile?demo=london&ms=5000' | python3 -m json.tool | head -40
# 2. then the phase picture around it: the worst ticks and the long-tick traces
curl -s 'http://10.8.1.108:8290/api/perf?demo=london' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["tick"]); [print(w["total"], w["hour"], dict(zip(["plan","gateways","traffic0","citizens","vehicles","transit","mobile","dispatch","traffic1","systems","flush","history"], w["phases"]))) for w in d["worst"][:5]]'
```

The response's `summary.top` is the same table `profile-summary.ts` prints; the `.cpuprofile` file loads in Chrome's
Performance panel (Load profile) or `npx tsx packages/server/src/loadtest/profile-summary.ts <file> 25 --callers step`
for the callers of one function. On the dev stack the same two commands go to `localhost:8080`; a test city is
`?city=2`.

### Prometheus and Grafana

`/metrics` series, each with a `world` label (`live`, `demo:london`, `city:2`):

`civitas_up`, `civitas_tick_ms{stat=avg|p95|max}`, `civitas_tick_budget_ms`, `civitas_ticks_total`, `civitas_long_ticks_total`,
`civitas_phase_ms{phase,stat}`, `civitas_phase_share{phase}`, `civitas_citizens`, `civitas_vehicles`, `civitas_clients`,
`civitas_agents_moving`, `civitas_stream_per_second{what=agents|messages|bytes}`, `civitas_search_per_second{what=routes|nodes}`,
`civitas_event_loop_lag_ms{stat}`, `civitas_gc_pauses_total`, `civitas_gc_ms_total`, `civitas_gc_pause_max_ms`,
`civitas_memory_bytes{what=rss|heap_used|heap_total|external}`, `civitas_save_ms{stat=last|max}`, `civitas_saves_total`,
`civitas_game_day`, `civitas_game_hour`, `civitas_uptime_seconds`.

- **Scrape job:** [perf/prometheus-job-civitas.yml](perf/prometheus-job-civitas.yml), to merge into the monitor VM's
  `prometheus.yml` (10.8.1.104) as the ASB jobs were: target `10.8.1.108:8290`, 15 s. The lead applies it; the file
  says how.
- **Dashboard:** [perf/civitas-grafana.json](perf/civitas-grafana.json), uid `civitas-perf`, for
  `~/infrastructure/grafana/dashboards/` and `apply-dashboards.sh`. Three rows: *Is the tick inside its budget?* (avg,
  p95, max against the 200 ms line, long ticks a minute, clients, citizens), *Where the tick goes* (phases stacked in ms
  and as shares, phase p95 and max, searches a second), *The host and the clients* (memory, event-loop lag and GC,
  the stream, saves, the game clock, up). A `world` variable picks the process.

## Client

### The frame budget readout (`packages/client/src/render/perfhud.ts`)

Shift+M or the **perf** chip. Every frame is lapped in `main.ts` into ten phases: `input` (input, the camera flights,
the rig), `light` (quality, lighting, fog, the underground view), `chunks` (dirty chunks rebuilt), `world` (parcels,
traffic field, overlays, bubbles, fires, graves), `agents` (`citizens.frame`: interpolation and placement, lines, the
route view, signals), `vehicles` (planes, helicopters, boats, trains, tool previews, power, parks, landmarks, fireworks,
bridges, first person), `audio` (the 250 ms ambience tick and the ridden vehicle), `hover`, `lod` (building tiers and
culling, road geometry) and `render` (the TV feed, the first-person pass and `renderer.render`, CPU side). Two more
causes lie outside the frame function: `net`, the message handlers between frames (`net.ts` times `JSON.parse` and
each handler, by message type, and logs the last 2048 messages), and `outside`, what is left of the frame interval
once the phases and the handlers are taken off: the browser's compositing and layout, GC, other handlers, idle.

The readout shows, once a second: the server tick line and the stream as before; fps, ms/frame and the worst frame;
frames over 20 and 50 ms this second and the long tasks (`PerformanceObserver` on `longtask`, with the worst); **one row
per cause** with its ms per frame and share, largest first (a cause over 8 ms is amber); the JS heap when
`performance.memory` exists (Chrome); agents, chunks, draw calls and triangles; and the sound line with the ambience
tick's median and p95, the voices, and the last minute's decodes and bed changes. `msc.perf.readout` has the last
second, `msc.perf.seconds` the last sixty, `msc.perf.distribution(30)` the frame-time distribution (mean, p50, p95, p99,
max, frames over 20/33/50 ms, mean ms per cause) over the last 30 s.

### The trace

The **trace 10 s** button (or `msc.perf.trace(10)`) records ten seconds and downloads two files:

- `civitas-trace-<time>.json`: every frame (start, interval, ms per phase, net ms), every message handled (time, ms,
  type), the audio ticks and events (context start, decodes with their ms, beds, cross-fades, stops), the long tasks,
  the last minute's per-second summaries and the server's `/api/perf` snapshot (fetched through the parent for a demo).
- `civitas-trace-<time>.chrome.json`: the same in the Chrome trace-event format. Open it at `chrome://tracing` or
  [ui.perfetto.dev](https://ui.perfetto.dev): tracks for the frames, the phases, the messages, the audio, the long tasks
  and the server's ticks (from the snapshot's `recent`, on the same clock), so a slow frame can be read against what
  the server was doing.

While tracing, each phase is also a `performance.measure`, so a recording in Chrome's own Performance panel made at
the same time shows the phases in its Timings track.

### The jitter finder

`msc.perf.jitter(10)` (or the **jitter 10 s** button) watches ten seconds and reports: the frames over 33 ms; the **top
three causes** (for each slow frame, the cause with the largest excess over its own median across the window; the
causes ranked by the slow frames they take and the excess ms they add); whether the **server's ticks were late** (gaps
over 1.5 s between stats messages, which come once a second); whether the **audio coincided** (slow frames within an
ambience tick over 1 ms, or a decode, bed start, cross-fade or context start); and the long tasks. The verdict is one
paragraph, shown under the readout and returned with the figures. `msc.perf.jitterBetween(t0, t1)` runs it over frames
already recorded.

## Pre-emption: `npm run perf:check`

`packages/server/src/loadtest/perf-check.ts` builds the 2×2 test city as its child does (seeded, so the same game every
run), fills it, then runs 900 loops (three game hours from 02:00, through the morning rush) with the laps on, and compares
with the committed baseline `packages/server/perf-baseline.json`:

| check | threshold | why |
| --- | --- | --- |
| tick avg, relative to the calibration loop | +35% | a fixed arithmetic loop is timed in the same run (minimum of five); the ratio moves little with machine load |
| tick p95, relative | +50% | the tail is noisier |
| each phase's share of the tick | ±6 percentage points, for phases of 4% or more | shares barely move under CPU contention: a change here is a change in the game |
| the work counters (routes, A\* nodes, messages, bytes, population, world hash) | exact | a note when they differ (a failure with `--strict`): the game changed, so the timings are of a different game |

**Updating the baseline when a change is intended:** `npm run perf:check -- --update` rewrites the JSON; commit it with
the change and say in the commit why the figures moved. The baseline records the node version, the date and the load
average it was taken under. `--ticks N` and `--json FILE` for probes; `--cost` for the laps' own cost.

A client headless frame check was not added. `render-smooth.ts` measures the drawing's smoothness offline, not frame time;
the only frame measurement is a real browser, and headless Chrome (Playwright, Chrome 155, with and without the GPU) could not
run the client on this Mac at all (the page's main thread blocked for 90 s after load, then the target closed) while the
real Chrome ran it at 120 fps. In the real Chrome the frame times moved by more between two windows a minute apart than
any regression would (machine load, game hour, the tab hidden by other tabs), so a threshold would only hold against a
same-session control: `msc.perf.distribution()` before and after, in the same page, as the jitter study below did.

## Checks

Run on 2026-10-25 on the branch, all passing: `npm run typecheck` (includes `local:check`: the worker bundle carries the
phase timers), `npm run demo:check`, `npm run perf:check` (against the committed 900-tick baseline), `ab.ts` identical to
main in every field but the wall time, `gesture-check`, `tv-check`, `audio-check`, `npm run build`, and the laps' cost
measured at 0.0025% of a London tick.

## Findings, 2026-10-25

All on the shared Mac (Node v20.2.0 x64 under Rosetta, load average 8 to 50 from other agents), so relative figures only.

### Is the London jitter the audio? No.

Measured in the real Chrome on a 120 Hz display, London (32k citizens) through the main server's proxy, tour stop 2
(Battersea), the frame budget's own `distribution` and `jitterBetween`. The audio state was rotated inside the same page
in 12 s windows, so machine load and game hour are paired: sound on, muted, and the context suspended (the same as never
started: no audio thread). Eleven windows:

| state | windows | frames | mean ms | p50 | p95 | p99 | frames over 33 ms | of which a chunk rebuild | audio ms per frame | slow frames near an audio tick or decode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sound on | 3 | 2018 | 11.5 | 8.3 | 15.3 | 108 | 66 | 61 | 0.01 | 0 |
| muted | 4 | 1775 | 12.7 | 8.4 | 29.4 | 137 | 74 | 72 | 0 | 0 |
| suspended (never) | 4 | 3505 | 14.7 | 8.3 | 55 | 146 | 122 | 117 | 0 | 0 |

Earlier, in sequence (30 s each, not paired): never started, 03:00 game time, 4095 frames, mean 8.5, p95 10, p99 16.7,
one frame over 33 ms (a chunk rebuild); sound on, 3214 frames, mean 9.3, p95 17, p99 25, five over 33 (four `outside`,
one chunk rebuild); muted, at the morning rush, mean 14.5, p95 27, 78 over 33 (`outside` 55, `render` 17, chunks 4).

The ambience tick costs 0.1 ms median, 0.2 ms p95, once every 250 ms; the five beds' recordings decoded off-thread in
the first three seconds (48 to 65 ms each, including the fetch) and cross-faded once. No slow frame fell within an audio
tick over 1 ms or an audio event in any window. The sound-on windows were the best of the three; what moved between
states was the machine and the game hour (other agents' tabs in the same Chrome hid this one three times, for 2, 14 and
25 s, and the Mac's load moved the server's tick between 40 and 89 ms in the same half hour). Nothing in the audio to
fix: the cheap part (the tick) is already cheap, and decodes are off the main thread.

### What the jitter is: chunk rebuilds

Nearly every frame over 33 ms is one in which a dirty chunk was rebuilt: `chunkView.rebuild` plus the eleven
`scanChunk` passes (roads, lights, parks, airfield, helipads, trains, junctions, bridges, landmarks, underground, power),
50 to 250 ms each (mean 148 ms in one minute, worst 241), up to four a frame (`main.ts`, `budget = 4`). In one 60 s
stretch at game midday: 148 frames with a rebuild over 10 ms, 15.9 s of the 60 inside rebuilds, 147 of 156 slow frames
attributed to `chunks`. At 03:00 game time, when nothing changes, the same page ran 42 s with one slow frame. A chunk is
marked dirty by every `tiles`, `aux`, `sub` and `under` update (`client/src/world.ts`), so a growing London stutters in
the daytime and is smooth at night, which is what "a bit jittery" looks like. Fix candidates for the next card: one
rebuild a frame with a time box rather than four; find what marks a London chunk dirty two or three times a second at
midday (8 `tiles` messages a minute at 13:30 against 480 `traffic` and 298 `parcels`); and the rebuild's own cost
(profile the `chunks` phase with the Trace button and Chrome's Performance panel).

### The server: London by phase, this Mac under load

`/api/perf` on the London child, one-minute windows (300 ticks), sampled every 30 s through a game day:

| game hour | tick avg / p95 / max ms | citizens | vehicles | flush | mobile | systems | dispatch | plan | traffic0 | GC pauses a minute (worst) | routes/s, nodes/s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 08:00 | 35.7 / 52.9 / 79.6 | 17.9 (50%) | 5.7 (16%) | 5.0 (14%) | 1.0 (3%) | 1.9 (5%) | 1.3 (4%) | 1.1 (3%) | 1.0 (3%) | 141 (17 ms) | 217, 18.6k |
| 17:06 | 62.0 / 91.5 / 380 | 25.5 (41%) | 15.8 (26%) | 7.7 (12%) | 4.6 (7%) | 2.1 (3%) | 1.8 (3%) | 1.1 (2%) | 1.7 (3%) | 250 (92 ms) | 300, 37.8k |
| 18:23 | 61.8 / 82.0 / 123 | 27.8 (45%) | 15.1 (24%) | 7.5 (12%) | 3.6 (6%) | 1.7 (3%) | 1.7 (3%) | 1.2 (2%) | 1.8 (3%) | 249 (11 ms) | 325, 41.3k |
| 05:00 | 23.9 / 39.3 / 62 | 9.7 (41%) | 5.2 (22%) | 3.7 (16%) | 0.8 (3%) | 1.9 (8%) | | 1.3 (5%) | | 100 (17 ms) | 61, 6.3k |
| 23:03 | 103 / 195 / 529 | 46.2 (45%) | 23.1 (23%) | 11.7 (11%) | 13.2 (13%) | 2.4 (2%) | | | 2.5 (2%) | 228 (35 ms) | 212, 21.7k |

Citizens and vehicles are 65 to 70% of every tick, the flush 11 to 16% with no client connected, and the mobile services
grow to 13% in the evening (worth a `tprof` of the evening: the 529 ms tick at 21:31 was citizens 215 ms + mobile 201 ms).
The worst ticks of the day name the host, not the game: 2,080 ms at 10:56 (citizens 1,662 ms: the process was off the
CPU at load 50), 380 ms at 14:49 (vehicles 273 ms in the minute with a 92 ms GC pause). The quiet-machine reference for
the same London is 20.9 ms a tick ([search-perf.md](search-perf.md), 2026-10-19 evening). UAT's 79 / 129 / 251 is the
shape of this loaded Mac (the HUD shot on the card shows 83.5 / 127 / 217 from the same London), and a late server tick
reaches the client only as a late `stats` message (none in these windows) and a 200 ms hold on the agents' glide, not as
a frame stutter: the server is not the jitter either, on UAT or here.

### What the instrumentation costs

65 ns a lap, 0.9 µs a tick for the fourteen laps (0.0025% of a London tick); the paired whole-game comparison is
−0.055 ± 0.073 ms a tick (noise). The counters are a handful of adds; the counting `Conn` adds two adds per frame sent.
`ab.ts` on this branch and on main (aa5c4f1) gives identical results in all 46 fields but the wall time.

## Options memo: what next, and what we did not do

What we have now: phase timings and traces in the process, a profile on demand, `/metrics` for the estate's Prometheus
with a dashboard, a client frame budget with a trace and a jitter finder, and a baseline check in the suite. All of it
hand-rolled, in-memory, no new dependency on either side. The options considered, with what each costs:

| option | what it would add | cost | verdict |
| --- | --- | --- | --- |
| **Continuous server profiling** (Pyroscope or Parca agent, or `--cpu-prof` always on) | flame graphs over time, no need to be there when it stutters | a daemon or a 2 to 5% sampling overhead on every tick, a service to run, and the inspector cannot run two profilers at once | not now: the phase timings say *which* phase went long and `POST /api/perf/profile` says *why* within seconds; the long-tick traces catch what we were not there for |
| **OpenTelemetry** (metrics and traces through an SDK to a collector) | standard exporters, spans across parent and child | 20+ MB of dependencies on the server, a collector in the stack, and the hot path's spans cost more than our laps | not now: one hand-written `/metrics` is 150 lines and is scraped by the Prometheus we have |
| **Client RUM** (visitors' browsers posting their frame budgets to the server, anonymised, opt-in) | the showcase's real frame times by browser and GPU, which no local run gives | an endpoint, a store, a consent switch, and the privacy review; the figures are noisy (background tabs, throttling) | later, once the showcase has visitors worth the trouble: the readout already computes the per-second summary it would send |
| **Chrome's Performance panel and `--cpu-prof`** (deep dives) | the full picture of one slow frame or one slow tick, function by function | nothing to build; needs someone at the keyboard | keep: the Trace button's `performance.measure`s show in the panel, and the server's profile is the same `.cpuprofile` the panel loads |
| **Safari's Timelines** (Rich's own browser) | frame times and JS samples where there is no Long Tasks API | nothing to build | keep for Safari-only stutters; the readout works there too, with long tasks at 0 |
| **Flame graphs from `0x` or `clinic`** on a child | an offline flame graph of a London day | a dev dependency and a run of minutes | occasionally, for a phase the profile summary does not explain |

**Recommendation for the next month:** keep what is here, apply the scrape job and the dashboard so UAT and the showcase
are on `grafana.reneo`, and use the three tools in this order when something stutters: the Grafana tick panel (is it
the server, and which phase), the jitter finder in the browser (is it the client, and which cause), then
`POST /api/perf/profile` or the Trace button for the function. Spend the engineering on the two causes this work found
instead of on more monitoring: chunk rebuilds on the client and the evening `mobile` phase on the server. Revisit RUM
when the showcase has a steady audience, and continuous profiling only if a regression ever escapes the baseline check
and the dashboard both.
