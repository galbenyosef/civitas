# Public transport: lines, buses and riders

Code: `shared/src/transit.ts` (line and stop types, `TRANSIT` tunables, `walkCost`, stop names), `server/src/sim/transit.ts`
(`Transit`: the registry of lines, riders, fares and the planner; `BusService`: buses), trip planning in
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
   pick a number (1-999) and a colour, choose a loop or there and back, and set the buses you want. The server routes it
   (below) and refuses a line it cannot drive, naming the stops. While the panel is open each line is drawn as a ribbon
   in its colour on the lane the buses use, with rings at its stops; the list shows status (running, no depot, no drivers
   on shift, outside service hours), buses in service, riders and fares today, and each stop's boardings.

On the wire, every client gets a `lines` message with every line (routes included) when one changes, and between
those a light `lineStats` message: which line each bus on the road runs (for its livery) as soon as that changes,
and each line's status, buses in service and riders at most every 50 ticks (about 1 KB/s per client with 32 lines).

Lines are stored per player in the world snapshot (`transitLines`, `nextLineId`; store format v7, v6 worlds upgrade in
place with no lines). Buses and riders are not saved: buses leave the depot again, riders are at home after a restart.

## The lap

A line's **calls** are its stops in visiting order: a loop calls S0 … Sn-1; there and back calls S0 … Sn-1 … S1 (the
middle stops twice, once per direction). The **lap** is the road path through every call and back to the first, joined
from A\* segments (`findRoute` with the live congestion costs) between the road tiles of consecutive calls. Lanes have
no U-turns, so a segment never leaves a stop by the tile it arrived from: at the end of a there-and-back line the bus
goes round a block to turn. Where no such way exists the line is refused ("a bus cannot turn round at …"). Every 100
ticks lines are checked against the map; a lap whose roads or stops are gone is re-routed or suspended, and its waiting
riders walk on.

## Buses on the road

A bus is an ordinary `Vehicle` (`VehicleKind.Bus` 15, `VehicleClass.Bus` 3, 0.6 tiles long: `VEHICLE_LEN[3]`) driven by
the traffic model: lanes, following, the stop line and junction conflicts, signals, crossings and the body guard all
apply as to cars, at 0.8 of car speed like a truck. Its path is the lap, kept a lap ahead and trimmed behind as it runs.

- **Pulling in.** `Mover.halt` is the path node of the next call's road tile; `Traffic.step` never lets the bus's centre
  past just beyond that tile's centre, so it stops inside the tile, in its lane, clear of both neighbours (a stop never
  faces a junction). While it stands there `Mover.dwell` keeps the stuck clock still; cars behind queue as behind any
  stopped vehicle.
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
`inService`, `problem`, `tick`, `lineChanged`, `positionOf`, and optionally `lines()` when it keeps its own line store,
as rail does) and its stop kinds in `STOP_KINDS`; the planner then offers its lines alongside the buses, and its vehicles
hand riders over with `Transit.serveCall(vehicleId, lineId, call, room)`.

## Measurements

`ab.ts --set bus=N` lays a depot and twelve stops on two lines over the Commons (a six-stop loop round the inner ring of
streets, a six-stop there-and-back line down the middle street within a short walk of it at three places) with N buses
per line; docs/traffic-tuning.md "Buses" has the results. In short: about 0.4% of trips at 08:00 and 0.2% at 17:00 go
by bus. The Commons is small and its commutes short (the nearest job: median 3 tiles, 90th percentile 8), and in its
congestion a bus moves at about walking pace, so few trips are worth a bus there. Bodies never overlap (car–car and
bus–car 0). Against the same layout without lines, the buses cost about 22 extra give-ups in the morning peak and
none in the evening. Long trips without a car are where the buses earn their riders.
