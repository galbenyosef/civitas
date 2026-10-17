# Demo maps and the guided tour

A demo map is a planned, lived-in town where every large object in the game is placed once and running, with a
guided tour that flies the camera from object to object and explains each one. It is for showing the game and for
teaching it.

| Demo | Port | Sections | Tour stops |
| --- | --- | --- | --- |
| **Showcase** | 8190 | all seven | 60 |
| Transport demo | 8191 | Downtown, Buses and parking, Rail and freight, Airport, Industry | 24 |
| Leisure demo | 8192 | Downtown, Leisure | 21 |
| Civic demo | 8193 | Downtown, Civic services | 25 |
| **London** | 8194 | Areas, Landmarks, Rail and Heathrow, Buses (its own map, below) | 66 |

Code:

- `shared/src/demo/showcase.ts` holds the scenario as data, the tour (`demoTour`) and the completeness rule (`showcaseProblems`).
- `server/src/demo/seed.ts` is the seeder: `seedDemoTown`, `seedDemoNetwork`, `fillDemo` and `worldHash`.
- `server/src/demo/check.ts` is `npm run demo:check`.
- `server/src/testcities.ts` is the world launcher. Demos are its second kind of child world, beside test cities.
- `server/src/index.ts` has the `DEMO=<id>` branch.
- `client/src/tour.ts` holds the tour panel, the labels and the demo start, reset and revive helpers.
- `client/src/worlds.ts` is the picker on the join form.

## Opening a demo

The join form lists the demos under the live world. That is on every server, production included: demos are the tutorial. Test cities stay dev-only. Choosing a demo starts it, waits while the town is built, then loads the page with `?demo=<id>`. `?demo=showcase&name=Ana` skips the form.

- The first start of a demo seeds and fills its town, about 75 s for the showcase. Later starts load the saved world in a few seconds.
- A demo is a sandbox, like a test city. Whoever joins gets every technology and unlimited funds. The banner says it is not the live world.
- A demo with nobody connected for ten minutes saves and stops (`TEST_CITY_IDLE_MS`). The page asks for it again when its socket drops.

### One port

Each demo runs as its own process on `8100 + slot`, where the slot is 90 for the showcase. The page never connects to that port directly. It connects to `/demo-ws/<id>` on the server it was loaded from, and the main server pipes that socket to the demo's port (`TestCities.upgrade`). A deployment that publishes only 8080 therefore works, over `wss://` too. `?ws=host:8190` still connects directly on a LAN.

### HTTP API

| Request | Effect |
| --- | --- |
| `GET /api/demos` | every demo: status, fill progress, citizens, clients, `startHash` |
| `POST /api/demos/<id>/start` | starts the demo; a no-op when it is running |
| `POST /api/demos/<id>/stop` | stops it; it saves on the way out |
| `POST /api/demos/<id>/reset` | **Reset demo**, below |

### Reset demo

After its first fill, a demo child saves its world and copies it to `data/demos/demo-<id>.seed.json`. **Reset demo** in the tour panel does three things:

1. It stops the child.
2. It copies that snapshot back over `data/demos/demo-<id>.json`.
3. It starts the child again.

The town comes back exactly as first built, citizens included. The world save does not keep per-day counters, so after a reset, or any restart from a saved world, the tooltips' today and yesterday counts (visits, riders, flights, containers) start from zero and fill as the day runs. The people, vehicles, trains and planes are moving from the first tick. Only a first fill arrives with a whole day counted. Without a snapshot, for example after an interrupted first fill, reset removes the world so the demo seeds again.

The town is deterministic as well. The seeder uses fixed coordinates and a fixed terrain seed. While a demo is seeded and filled, `Math.random` is a seeded generator (`seededRandom`), so a fresh seeding gives the same town. The child reports a hash of every modified chunk's tile words, aux and sub bytes and the transit lines as `startHash` on `/healthz` and `/api/demos`.

## London

London is a sample city rather than a teaching town: the Thames runs through it with its recognisable meander, and the
land round it is zoned roughly as London is. It is a `DEMOS` entry like the others (slot 94, port 8194, `?demo=london`),
with `town: 'london'`, its own tour order (`tour`) and welcome view (`view`). Its sections are ordinary demo sections, so
every station, landmark, track drag, bus stop and line goes through the same planners as the showcase's.

Code:

- `shared/src/demo/london.ts` is the map as data, and the scenario: the Thames as a centre line of real latitudes and
  longitudes with a width at each point and the bridges, the docks, about 90 named places, the parks, the land kept
  clear (Heathrow and the railway corridors), the landmarks, stations, lines and tour.
- `server/src/demo/london.ts` (`seedLondon`) paints it into the world in place of `seedCity`'s districts.
- The Landmarks section places the London landmarks (docs/buildings.md "Landmarks") where the real ones stand, nudged
  onto the nearest block the map's land allows: the Gherkin between Liverpool Street and the river and the Walkie Talkie
  a few blocks north, the Shard south of it by London Bridge, One Canada Square at Canary Wharf and the Royal Opera House
  in Covent Garden; the Houses of Parliament on the river south of Westminster Bridge with Big Ben at the bridge end, the
  London Eye facing them across the river, Buckingham Palace at the end of the Mall past St James's Park, the Tower of
  London on the river in the City and Tower Bridge beside it. `demo:check` fails a landmark that no city demo places.
  Tall placements are framed from further out on the tour.
- **Tower Bridge is a real crossing.** The Landmarks section lays it as a bridge (`bridges`, a `DemoBridge` with
  `style: 'Bascule'` and `landmark: 'tower-bridge'`) rather than placing the structure: a bascule span is drawn as the
  landmark's model with its lifting leaves, and the traffic drives over it, waiting at the barriers while it lifts. A bridge's `landmark` counts as placed for
  the landmark rule, and its tour stop frames the span.

How the map is made:

- **Scale.** `geo(lat, lon)` puts Charing Cross at (-20, 0), 6 tiles a kilometre, x east and y south. The map is
  224×112 tiles, x from -112 to 111 and y from -56 to 55, from Isleworth to the Thames Gateway and from Walthamstow to
  Wimbledon. The Isle of Dogs and Greenwich peninsula loops are drawn larger than life so the land inside them holds
  blocks.
- **River.** A Catmull-Rom curve through the points; a tile is water when its centre is within half the width of the
  curve. The width grows from 3.5 tiles upstream to 16 off the east edge.
- **Bridges.** Each named crossing bridges the shortest run of water along a nearby grid line with a real road bridge
  (shared/src/bridges.ts), laid through `planBridge` as the road tool lays it, in the style of the real one
  (`BRIDGE_STYLES`): stone and iron arches (Richmond, Kew, Putney, Battersea, Vauxhall, Lambeth, Westminster,
  Blackfriars), girders (Wandsworth, Waterloo, London Bridge, Blackwall), suspension spans (Hammersmith, Chelsea, the
  7-tile Woolwich crossing) and Tower Bridge's bascules. No two bridges share a line, and a run must be about as long as
  the river is wide. A grid road meeting a deck from the side on a ragged bank stops short of it, as the tool requires.
  Southwark Bridge has no grid line of its own between Blackfriars and London Bridge, so it is left out. The 159 crosses
  at Lambeth Bridge, the nearest to its Whitehall and Lambeth North stops.
- **Roads.** The usual grid, every 5th row and column, except on water, inside parks, on the airfield and on the railway
  corridors. Each line runs in a one-tile corridor; where a grid road meets it at right angles with road on both sides
  (not at a corridor's end or corner, nor where a station or park stops the road) the road is kept and the track crosses
  it on a level crossing (docs/rail.md), 31 in all, so a line no longer cuts the districts either side of it apart
  (Camden and Islington either side of the King's Cross line).
- **Zoning.** Each block takes the character of the nearest place (distance over the place's reach): `city` (offices,
  merged towers and headquarters on 90% of blocks), `westend` (shops, offices, stores), `civic`, `inner` (dense homes,
  some mid-rise), `outer` (homes, high streets, gardens), `suburb` (low homes with gardens), `industry` (works, depots,
  heavy plant). Lot levels and the zone of each block come from hashes, so neighbouring blocks differ. Parcels are 16×16
  squares named after the nearest place, which is what the tooltips show.
- **Services.** Police, fire, a 1×1 hospital, a builders' yard and four car parks on every 25×25 cell, as in a
  `seedCity` district.
- **Jobs near every home.** Homes thin out towards the suburbs (levels 1-2, gardens behind, a quarter of suburban blocks
  left as commons) while shops, offices and works stay full size everywhere. A newcomer's job search is a bounded
  breadth-first search, and in a first draft with job-poor suburbs the searches that found nothing made fill ticks of
  several seconds. The town has about twice as many jobs as people.
- **Margin.** A 24-tile ring of plain grass round the map, with the river running on out of it, so the noise terrain's
  lakes do not read as more river from above. It has no parcels; players can buy it.

What a fill gives (2026-10-17, machine shared with other agents, load average 12-20): about 29,000 citizens after 2.4
game days in under four minutes, 8 lines running, and in the running child a server tick of about 54 ms average,
85 ms p95 over 09:30-14:00. Per citizen that is the showcase's cost (both about 3.4 ms per 1,000 citizens timed side by
side), so the London tick is the size of the town, nothing worse.

The tour runs west to east along the river and then round the rings: Westminster, the West End, the City and the
Great Eastern line to Stratford, Waterloo and the line to Clapham Junction, Canary Wharf, the Isle of Dogs and Greenwich,
the docks and the Thames Gateway freight line, Hackney, Islington and King's Cross, Camden, Kensington, Paddington and the
Heathrow line, Wembley, Kew and Heathrow. Area stops are `blocks` with a `blurb` of their own.

## The scenario

The town under every demo is a 3×3 grid of Commons-style districts from `seedCity` (`DEMO_TOWN`).

- Each district is 22×22 tiles with roads every 5 tiles. Every zone is pre-built to level 3.
- The grid spans x and y from -35 to 34.
- Districts are named A1 (north-west) to C3 (south-east), rows A to C running north to south.
- Inside a district, a **block** is the 4×4 of lots between roads. `block(di, dj, bi, bj)` in the data file gives its rectangle.

Sections clear the blocks they use and place their objects there. Rail, freight and the airport sit on extra land outside the perimeter road, where no road crosses the track or the runway.

A section (`DemoSection`) lists:

| Field | What |
| --- | --- |
| `land` | extra parcels for the town's owner, such as the railway strips and the airfield |
| `clear` | blocks bulldozed to bare ground before anything is placed |
| `zones` | blocks rezoned and built to level 3: homes beside the airport, the industrial estate, shops by the east freight yard |
| `placements` | `{ kind, door, rot }`: the catalogue kind's string id, the tile a player would click, and the FRONT rotation (0 the door faces south, 1 east, 2 north, 3 west). `id` defaults to the kind and must be unique. Bus stops are placements too |
| `runways` | `{ from, to }`: a runway drag |
| `tracks` | drags as a player makes them; each runs along its longer axis first and turns once |
| `lines` | bus or rail lines: stops in calling order (bus stop tiles or station doors), loop or there and back, vehicles. `freight: true` for a line between yards |
| `blocks` | grown land the tour stops at: zones nobody places |

`TOUR` lists the ids in tour order, plus `welcome`. A focused demo is a `DEMOS` entry naming the sections it seeds. Its tour is `TOUR` filtered to those sections.

Some choices make every system busy:

- **District B1 is a suburb.** Seven of its nine job blocks are homes. Its people commute out, which makes their trips long enough for a bus. Line 1 runs from the suburb east along y = -1 to downtown and the airport. Line 2 runs north and south through the suburb along x = -25, between the civic district and the industrial estate.
- **Districts A1 and A3 hold civic and leisure.** They replace job blocks, never homes, so the town keeps a few more jobs than people. All 10,000 people are employed, and every placed building is fully staffed, the airport and freight yards included.
- **The industrial estate's nearest shops are by the east yard.** The estate is in C1 beside the west yard. Every shop nearer to it is homes, so its deliveries qualify for rail.
- **The stadium faces the north road next to the rail station.** The halt sits among the homes of A2, 30 tiles away, inside the 40-tile limit on a night out.

## How seeding uses the players' planners

Seeding has two phases, because stops, track and lines need the simulation's services. In `index.ts` the child calls `seedDemoTown` before creating the Simulation and `seedDemoNetwork` after rail is registered. Each phase goes through the same planner the matching player tool uses:

| Object | Planner | As the player's tool |
| --- | --- | --- |
| multi-tile kinds | `planStructure(kind, door, env, rot)`, then `World.placeStructure(…, { built: true })` | `Net.placeStructure` |
| 1×1 kinds | own land, dry, not a road, nothing built there, `hasRoadAccess` | `Net.build`, civic branch |
| runway | `planRunway(line, env)`, applied tile by tile | `Net.runway` |
| bus stops | bulldoze the lot, then `BusService.stopProblem` (no junction) | `Net.build`, `busstop` |
| track | `Rail.paint(owner, trackDragPath(a, b))` (planTrack) | `Net.track` |
| lines | `Transit.saveLine` | the lines panel |

`saveLine` validates the stops, routes bus lines on the roads and rail lines through the track (`Rail.route`), and refuses shared track. Every refusal is collected. The child exits with the list if there is any, so a broken scenario never seeds quietly. Everything is pre-built complete.

`fillDemo` then has two stages:

1. It runs the simulation until the population settles (`fillCity`).
2. It runs on through one more whole game day and stops at 09:30.

A visitor therefore arrives in the morning with yesterday's counters filled in: visits, riders, flights and containers.

## Keeping it complete

`npm run demo:check` fails when the showcase is missing anything a player can build. These are the rules:

- Every placeable catalogue kind is placed in the showcase. Placeable means it has a tool and is neither a draft nor a growing zone. This covers every kind bigger than 1×1, every size-ladder rung, the bus depot and stop, the stations and the freight yard.
- Every zoning tool has a grown block on the tour. Grown kinds without a tool are exempt, such as merged lots.
- Every surface tool is painted (runway, track). `SURFACE_TOOLS` is typed against `Tool`, so a new surface tool fails the typecheck until it is listed.
- Every line mode runs (bus, rail, freight). `LINE_MODES` is typed against `TransitMode`, so a new mode fails the typecheck too.
- Every placed kind has a tour stop, and tour ids and placement ids are unique and resolve.
- Each line's stops are placements of the right kind.

The check then seeds every demo through the real planners, fails on any refusal and on a rail line that does not run, and seeds each one twice to compare hashes. With `--run <days>` it also runs the showcase, or `--demo <id>`, under the seeded random and prints who uses what: staff per placement, venue visits, riders per line, flights and containers.

```sh
npm run demo:check
npx tsx packages/server/src/demo/check.ts --run 2.3
```

Drafts are exempt on purpose. They can only be placed on a dev server, and the demos also run in production.

## The tour

The tour panel opens by itself in a demo, at the bottom right. The **tour** chip in the top bar reopens it after it is closed. The panel has these controls:

- **Next** and **Previous** fly the camera to the next or previous stop. A flight is smooth, about 1.7 s by the wall clock, and lifts on long hops.
- **Autoplay** advances every 14 seconds.
- The drop-down jumps to any stop.
- **Reset demo** asks for confirmation, then resets the town for everyone in it.

Each stop's card shows:

- **What it does.** The catalogue kind's `blurb`.
- **How to build it.** The kind's `howTo`.
- **Facts.** The tool and key, the footprint, which way the door faces here, the placement tile, the technology with its track and tier, the cost and upkeep, and the jobs.
- **The live tooltip.** The server's ordinary `inspect` answer for the object, refreshed every 1.5 s and rendered by `ui.buildingHtml`, exactly what hovering it shows. Line stops add the line's live status, vehicles in service and riders.

Captions come from the catalogue, so they stay in step with the game. Runways, track and lines are not catalogue kinds, so their captions are in `showcase.ts` (`SURFACE_CAPTIONS`, `LINE_CAPTIONS`).

On the map, a structure's footprint outline and marks are drawn (`FootprintOverlay`): door, platform, apron, dock and gates. A block or a runway strip gets a yellow outline, a line's extent an outline in the line's colour, a track a blue one. A track gets a mark on every tile it lays. A line gets a square at each stop and its ribbon, the lap its vehicles run, drawn from the `lines` message. While the panel is open, every stop near the view has a floating label, nearest first and never overlapping. Clicking a label jumps to that stop.

`window.msc.tour` exposes `go(i)`, `stops`, `current` and `flying` for scripted checks.

## Adding an object to the showcase

Suppose the catalogue gains a 3×3 ice rink, kind `ice-rink`, in a new rung of the sports ladder.

1. Run `npm run demo:check`. It fails: `ice-rink (a rung of the sports ladder (tier 5)) is not placed in the showcase`.
2. Pick a free job block in the section it belongs to. Leisure lives in district A3 (`block(2, 0, …)`). Add the block to the section's `clear` list.
3. Add a placement to the section's `placements`: `{ kind: 'ice-rink', door: [x, y], rot: 0 }`. The door is the tile a player would click. Its outward neighbour must be a road (south for `rot: 0`). The rest of the footprint must lie in the cleared block.
4. Add `'ice-rink'` to `TOUR` next to its ladder.
5. Run `npm run demo:check` again. A refusal names the planner's reason, such as "The door must face a road". Move the door until the check passes.
6. Run `npx tsx packages/server/src/demo/check.ts --run 2` and check that the rink has staff and visitors.
7. Give the kind a `blurb` and `howTo` if it has none: the tour's caption is made from them.
8. Reset the running demo (`POST /api/demos/showcase/reset`) or delete `data/demos/demo-showcase*.json`. The next start seeds the new town.

A new surface tool or line mode works the same way: add a `runways`, `tracks` or `lines` entry to a section and its id to `TOUR`. A new zone kind with a zoning tool needs a `blocks` entry in Downtown.

## What a run shows

The showcase after `--run 2.3`, matching what the live tooltips showed in the running demo. The run had 10,693 citizens and 10,681 jobs: everyone who can work does.

| What | Numbers |
| --- | --- |
| staff | every placed building full: 90/90 at the teaching hospital, 40/40 at the stadium, 28/28 ground crew, 30/30 at the bus depot, 10/10 at each freight yard |
| venue visits yesterday | arena 117, botanical garden 118, opera house 94, stadium 92, museum 76, lakeside park 69, multiplex 56; a few for the smallest rungs |
| planes | the airport is operational, a flight an hour on its 16-tile runway, 8 or 9 flights a day |
| buses | line 1 about 30 riders a day, line 2 about 20, with some changing between them |
| trains | passenger line 1 runs one train (headway about 113 min) with 3 to 11 riders a day; freight line 9 runs one train |
| containers | 144 delivered by train in 2.3 days, and about 160 trucked into the west yard on a day |

Rail riders are few. Everyone takes the nearest job, so nobody commutes 30 tiles. The riders are the occasional night out at the stadium from the homes by the halt.

## UAT

A stable copy of the game runs apart from dev so dev reloads never restart it: `scripts/uat.sh promote` checks the dev
tree (typecheck, buildings:check), copies it to `~/code/msimcity-uat`, builds the client and restarts UAT on
**http://<lan-ip>:9080/** (or http://Xetatron.local:9080/; `scripts/uat.sh status` prints the current address) (game and client on one port; its test cities on 9100+n; its own world in
`~/code/msimcity-uat/data`, first seeded from dev's). `scripts/uat.sh status | restart | stop | log`. UAT runs with
`NODE_ENV=uat`, so `?dev` tools and the test-city picker work there too. Promote when cards land in Playtest.
