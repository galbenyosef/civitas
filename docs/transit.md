# Public transport: lines, buses and riders

Code: `shared/src/transit.ts` (line and stop types, `TRANSIT` tunables, `walkCost`, stop names, `LinePreview`), `server/src/sim/transit.ts`
(`Transit`: the registry of lines, riders, fares and the planner; `BusService`: buses), `server/src/sim/busroute.ts` (the bus
router: laps, turning round, what to fix), trip planning in
`server/src/sim/simulation.ts` (`plan`, `transitChoice`, `startLeg`, `advance`), the halt at a stop in
`server/src/sim/traffic.ts` (`Mover.halt`, `Mover.dwell`), the panel and ribbons in `client/src/lines.ts`, the bus model
in `client/src/render/citizens.ts`. Kinds: `bus-stop` (id 17) and `bus-depot` (id 16), both sub-kinds of the transport-hub
family 15 (`shared/src/buildings/transport.ts`, docs/sub-kinds.md). Technology: **Public transport** (transport tier 5,
`tr5`: needs Traffic signals, 80 road tiles, $1,500) opens the stop, the depot and the Lines panel.

## Building a network

1. **Bus stops** (tool bar, no key: every letter is taken). A 1×1 shelter put up at once, like a parking lot, on your land
   beside a road. It faces the first road it touches (south, east, west, north, as the renderer turns it), and buses pull
   in on that road tile, so that tile must be a plain stretch of road: a stop facing a junction is refused (a dwelling bus
   would block the box).
2. **A bus depot** (K, 3×2, built by builders like other civic buildings). Its 30 staff work four overlapping shifts
   (05:00, 09:00, 13:00, 17:00, rotating days off); about a fifth are mechanics (hash-seeded), the rest drive. **One bus is
   out per driver on shift**, so a depot carries roughly six buses at the morning peak and three late in the evening.
   Each line runs from its owner's built depot nearest its first stop.
3. **Lines** (top-bar **lines** chip). *New line*, then click your stops on the map in the order the bus should call,
   pick a number (1-999) and a colour, choose a loop or there and back, and set the buses you want. **Backspace** or a
   **right-click** on the map takes the last stop off (the *undo stop* button too). As you click, the server routes the
   draft exactly as a save would (a `line` `preview` request, answered with `linePreview`, at most one per 100 ms per
   client) and the editor draws it: the lap in the line's colour on the lanes the bus will use (a U where it turns
   round, with a small white ring), each stop under a numbered badge, and in the panel the lap's length in tiles, a
   rough round trip in game minutes (the first timing estimate under "Buses on the road", a dwell at every call) and how
   many times it turns round (hover for where). When it cannot be driven the panel says which stop pair failed and why,
   with a fix, and the map shows it: the failing leg as a straight red line between the two stops, the land a road
   would join them over in red squares, a free tile to move a stop to in a green ring. Save is greyed out until it is
   fixed. A depot that cannot reach the line is a warning in amber (the line saves; its status says *no road from the
   bus depot to the line* until it can). The server refuses a line it cannot drive with the same message and fix. While
   the panel is open each line is drawn as a ribbon in its colour on the lane the buses use, with rings at its stops;
   the list shows status (running, no depot, no road from the depot, no drivers on shift, outside service hours), buses
   in service, riders and fares today, and each stop's boardings.

On the wire, every client gets a `lines` message with every line (routes included) when one changes, and between
those a light `lineStats` message: which line each bus on the road runs (for its livery) as soon as that changes,
and each line's status, buses in service and riders at most every 50 ticks (about 1 KB/s per client with 32 lines).

Lines are stored per player in the world snapshot (`transitLines`, `nextLineId`; store format v7, v6 worlds upgrade in
place with no lines). Buses and riders are not saved: buses leave the depot again, riders are at home after a restart.

## The lap

A line's **calls** are its stops in visiting order: a loop calls S0 … Sn-1; there and back calls S0 … Sn-1 … S1 (the
middle stops twice, once per direction). The **lap** is the road path through every call and back to the first
(`sim/busroute.ts` `planLap`). Its legs are A\* searches over *(road tile, heading)*, not tiles alone, so a lap may run
back over the same road the other way, and the bus never reverses except where it can **turn round**. In order of
preference, by what each costs a route in tiles of driving (`TURN_COST`):

1. **driving on**: round a block, or round a roundabout (forward moves only, the ring's own step rules), at the cost of
   the tiles;
2. **at a dead end** (14): a road tile with one neighbour, the turning head of a cul-de-sac or the end of a stub;
3. **in a junction mouth** (22): a plain junction of three or four roads, no ring, flyover, bridge or level crossing;
4. **via the depot** (60): in at the line's depot door and out again, where the depot is beside the road.

So a loop round a block up to about 14-22 tiles longer beats a three-point turn, and the depot is the last resort.
Two turns the same way on neighbouring tiles cost 20 more (`DOUBLE_TURN`): that is going round a corner with no block
inside it, a 2×2 square of road, which squeezes a turn round through two junction boxes; round a block is preferred
(round a roundabout's ring it is free).
For each heading the bus could arrive at the first call in, the planner searches from every call and arrival heading
to the next call (each search going on past its first arrival for the other headings), picks the cheapest way round
over them, and requires the lap to arrive back at the first call in the heading it left in, so lap after lap joins up.
Laps use fixed costs (a tile 1, a junction 1.6, a level crossing 2.5), never the day's congestion, so a line routes
the same way every time it is routed and the editor's preview is what gets saved.

When a lap cannot be made the line is refused with the stop pair that failed (stop numbers as the panel shows them)
and a fix: *no road joins A to B* (with the shortest strip of open land, or failing that any land, that a road would
join the two streets over, within 40 tiles: "connect the roads: lay road over the 3 tiles marked, (81, 8) to (83, 8)"),
*a stop has no road beside it* or *faces a junction* (with the nearest free tile of yours within 4 beside a plain
stretch of road: "move the stop to (225, 4)"), *two stops are served from the same road tile*, *too far by road* (the
search ran out), or *nowhere on the way to turn round*. Every 100 ticks lines are checked against the map
(`BusService.lapValid`): a lap whose roads or stops are gone, or that turns round where it no longer can (a dead end
extended into a through road, a junction made a roundabout), is re-routed or suspended, and its waiting riders walk on.

## Buses on the road

A bus is an ordinary `Vehicle` (`VehicleKind.Bus` 15, `VehicleClass.Bus` 3, 0.6 tiles long: `VEHICLE_LEN[3]`) driven by
the traffic model: lanes, following, the stop line and junction conflicts, signals, crossings and the body guard all
apply as to cars, at 0.8 of car speed like a truck. Its path is the lap, kept a lap ahead and trimmed behind as it runs.

- **Turning round.** Where the lap goes back to the tile it came from, the traffic model drives a **three-point turn**
  inside the turning tile (`sim/traffic.ts` `KTURN`): forward and left from its lane across to the far kerb, back a
  little while still turning, forward and left again into the other lane and out the way it came, at half the speed of
  a turn at a junction (about 8 ticks). It has the whole box to itself: every other movement through that tile waits
  for it, and it waits for them. While it backs up the agent stream sets bit 15 of its flags (`citizenReversing`) and
  the client draws it facing against its motion. Via the depot, the bus drives into the depot door and straight out.
  A bus never comes into a lane already past its stop line before a junction (its 0.6-tile body would poke into the
  box, in the way of a bus turning round there).
- **Finding its way.** A bus leaving the depot for its first call, re-joining its lap after the line changed or when
  stuck, and heading home at the end of service uses the same router with the live congestion costs, arriving at the
  call in the lap's own heading.

- **Pulling in.** `Mover.halt` is the path node of the next call's road tile; `Traffic.step` never lets the bus's centre
  past just beyond that tile's centre, so it stops inside the tile, in its lane, clear of both neighbours (a stop never
  faces a junction). Where it turns round on that tile (a stop at a dead end) it halts once it has turned instead, on
  the last straight of the three-point turn in the other lane (`HALT_TURNED`), and the call starts only then
  (`Traffic.atHalt`): it never stands across the road. While it stands there `Mover.dwell` keeps the stuck clock still;
  cars behind queue as behind any stopped vehicle.
- **Timing.** Before a line's buses have driven it, a segment is expected to take its route cost (`Traffic.cost`: 1 a
  tile, more at junctions, crossings and where congested) at a bus's cruising speed, plus 6 ticks for each turn round,
  with no margin; the editor's round trip adds a dwell of 6 ticks at every call. On the free-flowing streets of
  `loadtest/busroutes.ts` that comes within 0-14% of the laps the buses drive (until 2026-10-17 it carried a ×1.4
  margin and read about 40% long). Lights and jams make real laps longer; each line then learns its own segment times.
- **Dwell.** People bound for this stop get off, people waiting here for this line in this direction get on (up to 40 on
  board), each paying the fare to the line's owner. They step aboard one a tick, so the crowd at the stop thins while
  the bus stands there. The bus dwells `dwellBase` (4) ticks plus `dwellPerRider` (0.34) per rider on or off, at least
  long enough for everyone to board, and takes late-comers before it leaves.
- **Anti-bunching.** A bus closer to the bus ahead on the lap than half the even headway (`bunchShare`) holds at the stop
  for up to `holdMax` (12) ticks.
- **Service.** Buses leave the depot from 05:30, a headway apart (none in the last half hour), and are called in when
  the line has more than its owner wants, when the depot has had fewer drivers than buses out for 60 ticks (drivers on
  shift or on their way in for one, so a shift change hands over without calling buses in), or at 00:30: a bus called
  in stops taking passengers, sets everyone down and drives back to the depot.
- **Request stops.** A bus pulls in only when someone on board wants this stop or someone is waiting there for this
  line in this direction (decided while it is in the lane leading to the stop's road tile); otherwise it drives past.
  It never holds for spacing while traffic is queued behind it.
- **Stuck.** At the stuck limit a bus looks once for a way round the tile after the next one (re-joining its lap at the
  call it was heading for); ten ticks later, still held, it leaves service where it is, as a stuck car gives up, and its
  riders walk on from there. A new bus leaves the depot when a driver is free.

Tooltips: a bus shows its line, next stop, load and how late it is against the running time the line has learnt; a
stop shows the lines calling, how many wait for each, the next arrival (an estimate from where the buses are and the
learnt segment times) and boardings today and yesterday.

## Riders and mode choice

When a citizen plans a trip with the car at home (or no car) and the trip is at least `minTrip` (7) tiles, the planner
(`Transit.bestTransit`) looks for stops within `catchment` (5) tiles of each end: one line from a stop near the origin to a
stop near the destination, or one change onto a second line at the stop they get off at or one within `transferWalk` (4)
tiles. Each option is priced in perceived ticks:

```
walkCost(walk to the stop) + waitWeight × wait + ride (+ walkCost(walk between stops) + waitWeight × second wait + ride + transferPenalty) + walkCost(walk from the stop)
walkCost(t) = walkWeight × t × (1 + t / walkFatigue)        walkWeight 1.3, walkFatigue 60 ticks, waitWeight 1.5
```

The wait is when the next bus of that line is due at that call (from the buses on the road); a change expects half a
headway. Rides use segment times each line learns from its buses. The citizen then compares (organic rule, every taste
hash-seeded from the citizen's id, so a person is consistent from day to day):

- **by transit**: perceived ticks × taste (0.7 to 1.45: how much they mind the bus; retirees, who walk slower, × 0.9) +
  fares × `ticksPerDollar` (10). Fares: $2 a ride, children free, retirees half;
- **on foot**: `walkCost` of the whole walk;
- **by car** (only when it is at home and the trip is worth driving): the A\* route cost at 0.6 of free-flow speed, the walk
  to the car, half a parking fee, × car taste (0.85 to 1.45).

The cheapest wins. A transit trip is ordinary legs: walk to the stop, a ride leg per line (`Leg.ride`: line, from and to
call, the stop tiles), a walk between stops for a change, a walk from the last stop. During a ride leg the rider first
**waits** at the stop (drawn standing in a small crowd on the kerb side of the stop tile, off the road), then **rides**
(not drawn; counted in the bus's load, carried along with it), and the leg ends when the bus calls at their stop. A rider
who waits longer than max(60 ticks, 3 × the expected wait), or whose line stops running, walks the rest of the way.
The citizen panel says "waiting for the 7 at Reyes Corner" or "riding the 7 to Lindqvist Parade", and the route ribbon
shows the ride legs as drive-width strips along the bus's road.

## Other modes

`Transit` is mode-agnostic. A mode registers a `ModeService` (`stopProblem`, `route`, `waitAt`, `rideTicks`, `headway`,
`inService`, `problem`, `tick`, `lineChanged`, `positionOf`, and optionally `lines()` when it keeps its own line store)
and its stop kinds in `STOP_KINDS`; the planner then offers its lines alongside the buses, and its vehicles hand riders
over with `Transit.serveCall(vehicleId, lineId, call, room)`. The optional hooks:

- `plan(line)`: the editor's preview, when the mode routes drafts itself (buses, the metro). Its stops' own problems
  are then left to the plan, which says how to fix them.
- `commit(line)`: make and pay for what the line needs before `route()` runs on save. The metro bores its tunnel here
  and refuses the save, with the amount, when the owner is short.
- `waitSpot(stop, citizenId)`: where a rider stands while waiting, seeded per rider (the metro: along the platform),
  in place of the kerb crowd.
- `under`: the mode's riders wait and ride below ground. `Transit.isUnder(c)` is true for them; the agent stream ORs
  `CITIZEN_UNDER` (flag bit 18) into their flags and the surface does not draw them.

Rail and the metro both run rail's pure timetable through one base class, `sim/timetabled.ts` (`Timetabled`): routes
re-derived every 10 ticks and after a network edit, the timing answers, and every call at a station handed to
`serveCall`. Rail is docs/rail.md; the metro is docs/underground.md.

A line may have a `name` (`TransitLine.name`, up to 24 characters, kept when a save leaves it out): metro lines use
it ("the Central line") in the citizen panel and tooltips. Stops are named by `World.stopLabel`: a name given to the
station (`World.stopNames`), else the generated `stopName`. `Transit.stopsAround(x, y, r)` lists the routed stops near a
tile with their lines, for a station's "change here for".

## Measurements

`npx tsx packages/server/src/loadtest/busroutes.ts [--hours 10]` builds small networks where a bus has to turn round (a
street with dead ends at both ends and no junction at all; a ring with a one-tile and a two-tile stub; a comb of dead-end
streets, the onboarding bot's layout, with two stops next to each other on one tooth; a street with a roundabout at one
end), saves nine lines over them, and drives two buses per line under the real traffic model with every stop served.
It asserts the laps are continuous and turn only where they may, the editor's preview has no problem, every bus runs
at least two whole laps and none is withdrawn, no bus ever stands at a stop in the middle of turning round, the
round-trip estimate is within -20%/+25% of the laps measured, and (`--hours 23`) every bus is back in the depot after
service; and that a line between two unjoined streets and one with a stop facing a junction are refused with a fix and
tiles to mark. On 2026-10-17: all nine lines run (6 to 36 laps per bus in 23 hours), 710 calls, none withdrawn, all 18
buses home, estimates 0.99-1.14 of the measured laps, about 0.2 ms a tick for the 18 buses. The three lines the onboarding bot could not save on its comb of dead ends
(docs/early-game-audit.md) save in a copy of its world, and its "First bus line" goal completes.

`ab.ts --set bus=N` lays a depot and twelve stops on two lines over the Commons (a six-stop loop round the inner ring of
streets, a six-stop there-and-back line down the middle street within a short walk of it at three places) with N buses
per line; docs/traffic-tuning.md "Buses" has the results. In short: about 0.4% of trips at 08:00 and 0.2% at 17:00 go
by bus. The Commons is small and its commutes short (the nearest job: median 3 tiles, 90th percentile 8), and in its
congestion a bus moves at about walking pace, so few trips are worth a bus there. Bodies never overlap (car–car and
bus–car 0). Against the same layout without lines, the buses cost about 22 extra give-ups in the morning peak and
none in the evening. Long trips without a car are where the buses earn their riders.
