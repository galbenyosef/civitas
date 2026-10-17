# Railways

A railway is three things a player builds and one thing they define. **Track** is painted by dragging. **Halts**, **stations** and **freight yards** are catalogue structures with a platform or loading dock along their back. A **line** is the stations a train calls at, in order, run through the transit registry like a bus line. Trains run a timetable that is a pure function of the line and its route through the track, so the server and every client agree on every train without a message per train.

Code:

- `shared/src/rail.ts` holds the aux encoding, the track planner, station geometry, the route search, track geometry, the timetable, train poses, calls and rides.
- `shared/src/buildings/rail.ts` holds the two station kinds and their designs.
- `server/src/sim/rail.ts` is `Rail`, the 'rail' mode of the transit registry. It handles routes, timing, calls, the track tool and station tooltips.
- `server/src/net.ts` hosts the track tool, bulldozing and the 'railLines' message.
- `client/src/render/trains.ts` draws trains and the overhead line.
- `client/src/rail.ts` handles the track preview and the track and station tooltips.
- `client/src/render/atlas.ts` and `render/chunkView.ts` draw the track itself.

`packages/shared/scripts/rail-check.ts` checks routes, geometry, timetables and spacing.

## Track

Pick **Railway track** in the Transport group of the tool bar. Every letter is taken, so it has no key. Drag from a tile: the path runs along the longer axis first, then the other, so one drag can turn a corner (an L). Several drags make anything else. Start a drag on existing track to join it.

The preview is green when the server would accept the drag and red with the reason in the status line otherwise. `planTrack()` runs on both sides. A drag is accepted only when:

- the path runs tile to tile along x or y and never over itself, at most `RAIL_DRAG_MAX` (160) tiles;
- every new tile is loaded, dry, clear (an empty zoned lot is paved over) and the player's own land, or a road it may cross (below);
- existing track on the path is the player's too.

Track crosses no water yet (bridges are a later card).

New track costs `RAIL_COST` ($15) a tile. Joining existing track is free. Bulldozing a track tile lifts it for free and cuts its neighbours' joints to it, so they become ends. Zoning and placement tools on a track tile are refused with "That is railway track; bulldoze it first".

### Level crossings

Track crosses a road on a **level crossing**: drag the track straight over a straight road, or lay a road straight over straight track. It costs `CROSSING_COST` ($150) on top of the track or the road. `crossingProblem` (track tool) and `roadOverTrackProblem` (road tool, server `net.ts`) refuse:

- track that starts, ends or turns on the road (the crossing's track is straight, mask 5 or 10);
- a junction, a corner, a road end, a roundabout or a flyover: the road must run straight across, with road on both sides across the track and none along it, so two crossings never touch along a line (side by side along a road is fine: two tracks);
- a road joining a crossing from along its track, and extending a crossing's track into a curve or a junction.

A crossing may go over a public road on unclaimed land. Bulldozing a crossing lifts the track and leaves the road (bulldoze again for the road); lifting the track beside a crossing lifts the crossing's track too, so no crossing is left with a stub.

**Barriers.** `crossingState(svc, x, y, tick)` is a pure function of the timetable, like the trains. `crossingWindows` samples the cycle once per service and tile for when a train's body is within half a tile of the crossing's middle. The barriers count as down from `CROSSING_WARN` (7 game minutes, 12 ticks: a train at line speed is 7 tiles away) before that until the last vehicle has cleared. The warning leaves room for a walker who has just stepped out (a fifth of a tile a tick, retirees slower) or a car past the stop line to get across. The server's `Rail.barrierDown` answers traffic, and every client draws the same moment. Nothing goes over the wire.

**Traffic** (`sim/traffic.ts`):

- Drivers treat a closed crossing like a red light at the stop line, and queue.
- A car goes onto a crossing only when the car ahead is off it and there is room beyond (`offCrossing`). With a junction straight after the crossing, a car waiting at that junction's stop line stands clear of the train, but a longer vehicle (van, truck, bus) goes on only when it could drive straight through the junction now.
- Nobody waits in a junction box for a crossing's barriers.
- A vehicle still on a crossing when the barriers come down drives off whatever is ahead: it ignores lights, give-way and people waiting, and goes past stationary cars clear of its path.
- Walkers wait at the edge of the crossing tile (`Traffic.barrierAhead`, one line in `Simulation.walkOn`).
- No car is left at the kerb of a crossing. Trains never stop for anything.
- The router adds `CROSSING_DELAY` (1.5) to a crossing tile's cost.

**Drawing.**

- The ground cell is the road with the rails laid in concrete panels, stop lines at both edges and keep-clear hatching (atlas `Cell.Crossing`, turned by chunkView).
- `render/crossings.ts` (owned by `TrainsView`) puts a post on the right-hand kerb of each approach. Each post has a red and white half-barrier across the approach lane, a cross, an amber lamp and two red lamps facing the traffic.
- When the barriers close, the amber shows for 2 ticks. Then the reds flash alternately (wig-wag), each crossing at its own rate and phase, and the arm comes down over `BARRIER_MOVE` ticks. It rises the same way once the train has cleared.
- No overhead-line mast stands in the road.

**Checks.** `npx tsx packages/server/src/loadtest/crossings.ts` checks three things. The planners' rules. A bench: a road with a crossing and a signalled cross street right beside it, cars and buses from four ends, and the barriers from a shuttle's timetable; it reports closures, queues, throughput, give-ups and car-train overlaps, and passes only with none (`--open` drops the barriers and shows the overlaps it would have). London: the demo run for some game hours, with every vehicle and walker near a crossing checked against every train's vehicles each tick.

### Aux encoding

A track tile is kind None, neither a road nor a building (a level crossing is the exception: a road tile), and carries a **rail aux byte** `0xe0 | mask` (`0xe0`-`0xef`). The mask holds the sides the track leaves the tile by: N (-y) 1, E (+x) 2, S (+y) 4, W (-x) 8. Connections exist only where a drag ran between two tiles, so two tracks laid side by side stay apart. Pathfinding, growth and the building index never see track tiles. Structure placement refuses any tile with an aux byte.

The piece drawn and the moves a train may make follow from the mask:

| Sides | Piece | A train may run |
| --- | --- | --- |
| 0 | a short length on its own | nowhere |
| 1 | stub to a buffer stop | in and out of the end; it never reverses there |
| 2 | straight or quarter curve | through |
| 3 | junction: the straight plus a curve each way into the branch | any way but back |
| 4 | diamond crossing | straight on only |

Curves are quarter circles of radius ½ round the corner the two sides share. Straights are a tile long, curves π/4.

## Stations

Two Hub-family sub-kinds (docs/sub-kinds.md), placed by their door like any structure (docs/aux-layer.md):

| Kind | Id | Footprint | Platform | Cost, upkeep | Staff |
| --- | --- | --- | --- | --- | --- |
| rail halt | 18 | 4×2, door `[1, 1]` | 4 tiles | $1,500, $20 a day | 3 station staff |
| rail station | 19 | 6×3, door `[2, 2]` | 6 tiles | $5,000, $80 a day | 12 station staff |
| freight yard | 20 | 6×3, door `[2, 2]` | 6-tile loading dock | $4,000, $60 a day | 10 yard crew |

Station staff work an early turn from 05:00, a late turn from 13:00 and an evening turn from 17:00, on rotating rosters. Yard crews work 06:00, 14:00 and a light night turn from 22:00. The tools are Rail halt (`[`), Rail station (`]`) and Freight yard (`\`). Each kind has two designs:

- a timber country halt and a concrete halt with a glass shelter;
- a brick station with a clock tower and a glass concourse;
- a container terminal (gantry crane over the dock, stacks, a gatehouse) and a goods yard (brick shed, a siding, silos, a yard crane).

Footprint marks show the platform or dock along the back, and the yard's truck gate on the front.

The door faces a road. The **back row**, furthest from the road, is the platform. The track serves the station when it runs along the row just outside the footprint behind the platform, the station's whole width, joined tile to tile (`stationStop`, `stationTrackProblem`). A station may be placed before or after its track: the tooltip says whether the platform track is laid. Trains stop with their middle at the platform's middle. A train is as long as the shortest platform on its line allows.

## Lines

Lines are transit lines with mode `'rail'` (docs/transit.md). The registry keeps them in `World.transitLines`, saves them, plans riders over them and pays fares to the owner. `STOP_KINDS` maps kinds 18 and 19 to 'rail'. A line is the owner's stations in calling order, a number, a colour, loop or there and back, and the trains wanted (`vehicles`). The registry refuses stops on someone else's land.

`Rail.route()` answers the registry with `routeLine()`, a breadth-first search over (tile, exit side). It refuses a line when:

- a station is not on its track, or the same station appears twice;
- two consecutive stations are not joined by track a train can run along without reversing;
- a loop does not lead from the last station back into the first in the direction it left;
- the route would use a tile twice;
- the route would use track another rail line already runs on. v1 has no signals, so no shared track.

Each leg is the shortest way into either end of the next platform. When the rest of the line cannot follow, the other end is tried. The search is deterministic, so a client running it on the same tiles gets the same route; the check script compares the two.

Lines are re-derived from the tiles every 10 ticks, and at the next tick after any track edit. A broken route or a missing station grounds the line, with the reason as its status. Repairing the track brings it back. When two lines would share track, the line with the lower id keeps it.

### What goes over the wire

`{ t: 'railLines', lines: RailLineDTO[] }` goes to everyone on hello and whenever any line's status or route changes. A `RailLineDTO` carries:

- the definition: id, owner, number, colour, stations, trains, carriages, loop;
- the status;
- while it runs, the **route**: start tile, entry side, one exit-side digit per tile, and where each platform row starts in it.

That is about one byte per track tile. Clients therefore run trains on lines whose chunks they have not loaded.

## Freight

A line whose stops are all freight yards is a **freight line**. A line may not mix passenger stations and yards. A freight line carries containers and no passengers: `waitAt` answers null, so the planner never offers it.

A freight line may run through yards and stations it does not call at, as long as no other line uses the track.

**Trains.** A locomotive and 4 to 8 short wagons (`RAIL_VEHICLE_LEN` 0.58). A there-and-back freight train has a locomotive at each end, as it has nowhere to run round. The wagon count is the line's own: 4 to 8 by hash of the line id, as many as the shortest dock takes, so all its trains are one length. Which wagons each train has is seeded per train, in runs of a kind:

| Wagon | Carries |
| --- | --- |
| container flat | 2 containers |
| tank wagon | 1 |
| hopper wagon | 1 |
| covered van | 1 |

Freight trains dwell 36 to 60 ticks at a yard while they load and unload. The timetable is the same pure function as for passenger lines.

**The economy hook.** A delivery truck's trip from a factory to a shop (`Simulation.startTrip`) asks rail first (`Simulation.freight`, which is `Rail.consign`). The delivery goes by rail when all of these hold:

- a running freight line calls at a yard within `YARD_CATCHMENT` (12) tiles of the factory and at another within 12 tiles of the shop;
- the trip is at least 14 tiles;
- the two truck legs together are shorter than driving straight there.

Even then, `RAIL_FREIGHT_SHARE` (65%) of such deliveries go by rail and the rest drive.

The truck then drives to the first yard. On arrival (`truckArrived`) its container waits at the yard and the shop pays nothing yet. The next train of the line that calls there heading the right way loads it, up to the train's container count. When the train calls at the destination yard, the container comes off: the shipper (the factory's owner) pays the line's owner `RAIL_FREIGHT_FEE` ($4), and the yard sends the last-mile truck to the shop. That truck delivers like any delivery: the shop pays the factory's owner as before.

A train ending its day back at the first yard delivers what is bound there and leaves the rest waiting. Containers nobody collects within a day and a half are written off.

The simulation's part is three small edits: the `freight` hook, a short branch in `startTrip`, and one line in `startDwell`. There is also `spawnFreightTruck` for the last mile.

**Tooltips.**

- A yard shows containers in and out today and yesterday, those waiting for a train, and the next departures.
- Hovering a train asks the server (`inspectTrain` → `train`) for what it is doing and what is on board: riders, or containers by the yard they come off at. The client adds the consist from the timetable.

## Timetable

`railService(def, route)` is pure and cached. A train's **cycle** starts with its dwell at the first station.

- **Loop:** dwell, run to the next station, and so on round to the first again.
- **There and back:** out through every station to the last, back through every station to the first.

Runs accelerate at `TRAIN_ACCEL` (0.03 tiles/tick²) to `TRAIN_VMAX` (0.6 tiles/tick, against 0.5 for a car) and brake into the next platform. A run too short to reach line speed is a triangle. Dwell is 8 to 13 ticks per station, seeded by the station's door. The ends of a there-and-back line dwell 22 to 32 ticks.

| Rule | Value |
| --- | --- |
| Trains on a there-and-back line | 1 (one track, nowhere to pass) |
| Trains on a loop | as asked, up to 8, cut to as many as keep at least a train length plus `TRAIN_GAP` (1.5 tiles) apart at every half tick of the cycle |
| Headway | cycle ÷ trains |
| Train i of a day | starts its first cycle at 05:00 + i × headway |
| Last cycle | the last one starting by 01:00 and ending before 04:48 the next morning, so two days' services never overlap |
| Consist | a locomotive and 2 to 4 carriages (hash of the line id), as many as the shortest platform takes (`CAR_PITCH` 0.92, `CAR_LEN` 0.86) |

`trainsAt(svc, tick)` lists the trains in service, each with:

- its arclength, direction, speed and phase (dwell or run);
- its station;
- whether the doors are open.

`trainPoses()` places every vehicle by its two bogies on the centreline, so carriages follow curves. The locomotive leads outbound; a there-and-back train comes home driven from its trailer.

`callsBetween(svc, from, to)` lists every train calling at every station in an interval. `nextRide(svc, a, b, tick)` gives the next train from station a to station b: when it leaves and when it arrives.

## Passengers

Rail implements the registry's `ModeService`:

| Method | What it answers |
| --- | --- |
| `stopProblem` | is this a rail station whose platform is on the track? |
| `route` | the lap: there-and-back lines run out and back, and each call is at the platform's middle tile |
| `waitAt` | ticks until the next train calls at that call; 0 while one stands there with its doors open |
| `rideTicks` | timetable time from call a to call b |
| `headway` | ticks between trains |
| `inService` | trains running now |
| `problem` | status, outside service hours, or between trains |
| `positionOf` | where a train is, so its riders move with it |

Each tick, every call since the last tick goes to `Transit.serveCall`, so riders bound there get off and riders waiting there get on. While the doors stay open, latecomers are boarded every tick. A train takes 40 riders a carriage. When a train's day ends back at the first station, everyone left on board gets off there.

Train vehicle ids for the registry are `2^30 + lineId × 16 + train`. Fares go to the line's owner through the registry. The station tooltip has a Railway section with:

- whether the platform track is laid;
- every line calling there, with its headway and the next departure;
- today's calls, riders on and riders off.

The registry's stop section sits beside it.

## Selecting a train

Clicking a locomotive, carriage or wagon selects the train (hovering brightens it) and opens its panel in the citizen panel's place, with the same **FPV**, **full**, **follow** and close buttons (`client/src/vehicles.ts`).

- **The panel.** It shows the line, service (passenger or freight), what it is doing, the station it last called at and the next, speed (line speed reads as 120 km/h), the consist and the load. The selected train asks `inspectTrain` with `full` once a second. Only that answer carries the roster: `riders`, the citizens on board from the transit registry (`Transit.aboard`), each clickable to select them, or for freight `consignments`, each container with what it holds (seeded per consignment), the factory it left, the shop it goes to and the yard it comes off at. Hovers and tooltips never carry rosters. Lists stop at 200 rows.
- **Crew.** `trainCrew` in `shared/src/crews.ts` is computed on both sides and sent nowhere. A passenger train has a driver and a guard or conductor (lines differ), sometimes a trainee driver, and on longer trains often a ticket inspector. Freight has a driver, often a relief driver, sometimes a shunter. Each train has its own crew. The early turn hands over to the late turn at a per-train hour between 13:00 and 15:30.
- **Cab view.** With a train selected, I or O rides in the leading cab. That is the locomotive, or the driving trailer on the way home. The eye sits just ahead of the cab's windscreen and looks along the track. It is placed from the same `trainPoses` the renderer drew that frame (`TrainsView.cabOf`), on a vehicle tick that follows the server clock without stepping back. Only the orientation is filtered. At either end of a there-and-back line the driver changes ends halfway through the stand, and the view blinks across rather than swinging round. The cab sways with speed, per train.

## Drawing

- **Track.** The atlas has 16 track cells, `Cell.Rail + mask`, drawn in world orientation. Each holds a ballast bed over grass, sleepers every sixth of a tile, two rails 0.17 tiles apart, and a buffer stop on a stub. chunkView picks the cell from the aux byte.
- **Overhead line.** `TrainsView.scanChunk` reads each chunk's track. It puts a mast with a cantilever every other straight tile, on a side seeded per run, and one outside each curve. A contact wire runs over every piece, at the height the locomotive's pantograph reaches.
- **Trains.** Three instanced vehicle types (locomotive, carriage, driving trailer) of four parts each: shell, trim, fixed parts and glass. Each line colour has two liveries: the colour with white trim, or white with a band of the colour. The livery is picked per train by hash, with a little wear per train. Glass is blue-grey by day and lit at night, each vehicle with its own warmth and brightness, a few dim. Head lights show at the leading end in the direction of travel and red tail lights at the other, with a glow that comes up at dusk.
- **Debugging.** `window.msc.trains.debugTick` freezes trains at a tick, and `findTick(lineId, phase, from, stop)` finds one.

## Checks

- `npx tsx packages/shared/scripts/rail-check.ts [days]` builds track, four stations and two lines in a server World, plus a short S-bend line, the same loop run backwards, a freight loop that runs through a yard it does not call at, and a freight shuttle. It mirrors the chunks into a ClientWorld and checks:
  - both paths derive identical routes and timetables;
  - every route is connected track, and each stop is its platform's middle;
  - over whole days sampled every half tick: no two trains of a line closer than a train length plus the gap, every bogie on the line's own tiles, no train out before 05:00;
  - every train dwells at every station;
  - every call is a dwell, and `nextRide` gets there;
  - the refusals hold: unconnected stations, a loop that does not close, a station twice, one station, not a station, broken platform track;
  - freight consists are a locomotive (one at each end there and back) and 4 to 8 mixed wagons, fit the shortest dock, are one length per line, and dwell 36 ticks or more.
- `npm run buildings:check` covers the station kinds' footprints and designs.
