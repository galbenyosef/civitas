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

**Cost of the laps** (`npm run perf:check -- --cost`: the same 2×2 game, 100-tick blocks with the laps on and off,
alternating, six pairs): see Checks below. About fourteen `performance.now()` calls a tick.

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

A client headless frame check was not added: the only headless frame measurement is a real browser (Playwright against
the built client, as in the jitter study below), and on this shared machine its frame times moved by more between two
identical runs than any regression would. `render-smooth.ts` measures the drawing's smoothness offline, not frame time.
The route is `msc.perf.distribution()` in a Playwright run against a same-session control; the script that does it is in
the card's notes.

## Checks

The suite, with the results from the card: `npm run typecheck` (includes `local:check`), `npm run demo:check`,
`npm run perf:check`, `npx tsx packages/server/src/loadtest/ab.ts` identical to main, the client checks
(`gesture-check`, `tv-check`, `audio-check`), `npm run build`, and the laps' cost under 1% of the tick.

## Findings, 2026-10-25

See the section below, written from the measurements on the card (c9914661).
