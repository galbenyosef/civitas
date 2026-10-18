# Mobile jobs: taxis, delivery riders, bin lorries and couriers

Card "additional jobs" (UTD 6dc162e8): people who work on the move instead of at a desk. Taxi and private-hire
drivers, food delivery riders on bicycles and mopeds, refuse crews on weekly bin rounds, parcel couriers in vans,
street sweepers. Design 2026-10-18; what was built and measured is at the end.

Code: `shared/src/fleet.ts` (fleet kinds, wire bits, roles, tunables), `server/src/sim/mobile.ts` (the roaming-worker
framework and its units), `server/src/sim/taxis.ts`, `delivery.ts`, `refuse.ts`, `couriers.ts` (one service each),
hooks in `server/src/sim/simulation.ts`, the models in `client/src/render/fleet.ts`.

## 1. The framework: roaming workers

A mobile worker is an ordinary citizen with an ordinary job. Nothing about hiring, commuting, wages, tax or the shift
clock changes. Three things are added:

- **A role.** `mobileRole(kindId, wx, wy, id, car)` (shared, pure, hash-seeded like `isMechanic` for bus depot staff)
  says whether a worker at that workplace works on the road, and how. It is never stored: it follows from the
  workplace and the citizen's id, so old worlds and snapshots need nothing new.
- **A base.** Where the work starts and ends: the workplace (a cab office, a restaurant, a depot) or, for
  private-hire drivers, their own home.
- **A unit.** While a worker on shift has a task, the service puts a `Vehicle` on the road for them (in
  `w.vehicles`, `vkind` ≥ `FLEET_VKIND`, driven by the service like a bus, skipped by `moveVehicles`). The citizen
  stays in `Work` at the base, not drawn, as bus drivers do; the unit carries their id. A worker with nothing to do
  has no vehicle, so idle workers cost nothing.

A unit runs a list of **stops**. Each stop is a tile and a way of arriving:

- `kerb`: a plain road tile beside a building (no junction box, crossing, bridge or ring, as for a bus stop). The
  unit halts there in its lane (`Mover.halt`, `Traffic.atHalt`, as a bus does), dwells (`Mover.dwell` keeps its
  stuck clock still), and traffic behind it queues. A building with no plain road beside it is served at the door.
- `door`: into the building's forecourt (the path ends at the building, as a delivery truck's does); the vehicle is
  off the road while it dwells.

Routing is the bus router (`sim/busroute.ts` `busLegs`) with live congestion costs: heading-aware, so a unit comes
back down the same road the other way only by turning round where a bus may (round a block, a dead end, a junction
mouth). A path always covers the stop it is heading for and the one after (or the base door), so a halt always has a
next node. One search per stop, bounded to 6,000 states.

Shifts: a role may bring its own rota (taxis run nights, riders the meal times, bin crews early mornings), chosen in
`hire` in place of the workplace's. At the end of a shift a worker whose unit is out stays on (`endShift` waits) while
the unit finishes its task and drives back, at most 90 game minutes, then goes home as usual. A unit stuck past the
stuck limit plus ten ticks is withdrawn, as a stuck bus is: its passenger or parcel is set down, and the worker is
free again at the base.

## 2. Taxis and private hire

**Cab offices.** About one 1×1 commercial lot in eleven (`isCabOffice`: `hash2` of the tile under `MOBILE.cabShare`
0.09, the lot keeps its own model) is a cab office: its sign is a lit minicab board, "Ace Cars" or "Okafor Taxis"
(`names.ts`, `render/signs.ts`), and all its staff drive. Those who own a car and roll under `privateHireShare` (0.45)
are **private-hire drivers** working from an app: they log on at home (no commute; `Simulation.depart`), drive their
own car (its own paint and a small lit badge low on the windscreen) and, between fares, wait parked wherever the last
one ended. The rest drive the office's cabs (mostly taxi yellow, some charcoal, green or white, with a pale side
stripe), with a roof sign lit while for hire and dark with a fare aboard, and wait between fares at the **rank** of
the nearest station, airport or coach depot within 20 tiles of the office, or at the office. Rota: 06-14, 14-22,
18-02, 22-06, rotating days off.

**Mode choice** (`Simulation.plan`, after the bus check): a trip of at least `minTrip` (6) tiles with no car to hand,
or a night out (to a venue from 19:00, or home from one after 21:00, when the car stays at home), may be made by taxi.
The planner asks `Taxis.quote(from)` for the nearest free taxi within `reach` (22 tiles): a cab waiting at its rank or
office, a private-hire car at home or parked after a fare, or either on its way back empty. Its wait is the distance
at a congested town speed and the fare `$3 + $0.45` a tile (Manhattan × 1.2). Perceived cost:

```
taxi = fare × ticksPerDollar × priceTaste + waitWeight × wait + ride ticks       priceTaste 0.6-1.8, hash per citizen
walk = walkCost(walk) × (1.6 between 21:00 and 06:00)                              nobody likes walking home at night
car  = as now × (2.6 for a night out: a drink or two)
```

The cheapest wins (transit has already been weighed against walking and driving). Choosing a taxi books it at once.
The trip is one `hail` leg: the passenger waits at the kerb of their building (drawn standing, like a bus queue); the
taxi halts beside them, they get in (not drawn; their position follows the taxi) and are set down at the kerb of the
destination. A passenger whose taxi has not come within max(60, 3 × the quoted wait) ticks walks. They pay at the
end: a cab's fare 70% to the cab office's owner (`fees`), 30% to the driver; private hire 25% commission to the
office's owner, 75% to the driver. Newcomers arriving through a station, the airport or a coach depot who would take a
taxi (`Gateways.modeFor`), and leavers going to one, hail a real one when one is free in reach (`Simulation.migrate`),
waiting at the rank with their suitcase; otherwise they ride as before.

## 3. Food delivery: riders on bicycles and mopeds

**Restaurants.** Every commercial venue that serves food takes orders: 1×1 commercial lots that are not cab offices,
deep-plot shops, high-street parades and shopping centres (not department stores or hotels). A quarter of their staff
(hash per citizen) are riders, each with a bicycle (55%) or a moped. Rota: 11:00-15:00, 17:00-23:00, and a few
11:00-21:00.

**Orders.** Between 11:30 and 14:00 and 17:30 and 22:00 each home is rolled in the rotating dispatch slice (like
freight): `lunchRate` (0.035) and `dinnerRate` (0.1) orders per household per day, times the home's hash-seeded taste
(0.3-1.7), from a food venue within 12 tiles (nearer is likelier). The kitchen takes 8-18 game minutes. Riders work like
a delivery app's: they are on a venue's payroll and wait there, but eight minutes before an order is ready the nearest
free rider within 7 tiles of its kitchen (waiting at their own venue, or riding back empty) is sent to collect it,
with up to two more orders from that kitchen for homes within 5 tiles of the first. The rider waits at the kitchen for
anything not ready, rides to each kerb, stands at the door (the WORKING bit: the client shows the rider off the bike
at the door, box in hand) and rides back. On delivery a resident at home pays: the meal ($8 + level, sales tax to the
venue's parcel like a visit) and a $2.50 fee to its owner; the rider gets a $1.50 tip. While three orders per rider on
shift are waiting, the app says busy and takes no more; an order nobody has been sent for an hour after it was ready is
cancelled; a rider who gives up in a jam hands their orders back to the kitchen for the next one.

**On the road.** Two-wheelers are vehicles in the lane: they stop at lights, stop lines, crossings and the junction
box like a car, and follow each other. They are short (`VEHICLE_LEN[4]` 0.16, server class `BIKE_CLASS` 4, a sedan
on the wire) and a little slower in free flow (bicycles 0.75 of car speed, mopeds as fast as a car), and they **filter**: a two-wheeler rides
in the strip between a car's side and the pavement (`BIKE_SIDE` 0.125 out from a car's line, 0.05 wide, so it touches
neither cars nor walkers), takes none of a lane's car places, and in a lane cars follow cars and bikes follow bikes, so
bikes pass queues of cars. While either is turning their paths cross, and the body guard holds them as any two
vehicles (`Traffic.filtering`, `TRAFFIC_TUNING.bikeTurnGuard` 1; section 8 has what the alternatives cost).

## 4. Refuse collection

**Waste and recycling depots.** No new building kind: about one industrial building in twelve (`isWasteDepot`, a tile
hash, never a distribution centre) is a waste and recycling depot, signed "Okafor Waste & Recycling" or "Borough
Recycling Depot". Half its staff are bin crews and an eighth drive sweepers (the rest sort and bale). Rota 06:00-14:00
Monday to Friday; sweepers also on a late turn. A council depot kind was weighed (a placeable civic service with
coverage, like police) and left for later: it would need a catalogue entry, a model, a technology and a showcase
placement in files other agents were changing, and every town with industry already gets collections this way.

**Rounds.** The town is cut into 16×16-tile districts. Each district's collection day is a hash of the district
(Monday to Friday, shared `binDay`). On that day from 06:30 the waste depot nearest the district's homes, within 40
tiles, sends a bin lorry per three crew on shift (a driver and two loaders, `Unit.crew`). The round is every home's
kerb (the plain road tile it faces; a home that faces only a junction is emptied from a kerb stop within 3 tiles),
ordered nearest-neighbour from the depot, at most 40 stops a lorry. At each it halts five ticks and two more per extra home (the WORKING bit: the client tips a wheelie bin up the arms at the back while a loader stands behind),
marks those homes emptied and charges each home's parcel owner $0.60 for the depot's owner. A home's tooltip shows its
collection day and when its bins were last emptied; the depot's shows its crews, what is out, and the homes emptied
today and yesterday.

**Street sweepers.** Two weekdays after its bins, the depot sends a sweeper round each district: a slow vehicle (half
of car speed) through every fourth road tile of the district, at most 12 waypoints, in a nearest-neighbour walk
(`Stop.pass`: driven through, not stopped at), the beacon flashing and the brushes down (WORKING) the whole way.

## 5. Parcel couriers

**Depots.** Warehouses and freight yards in the industrial designs (`goodsType` storage or freight), every
distribution centre, and any other industrial building whose tile hash is under 0.18, waste depots excepted. About a
third of their staff are couriers. Rota 08:00-16:00 Monday to Saturday.

**Parcels.** Each household gets `parcelRate` (0.12) parcels a day, ordered through the day and assigned to the
nearest depot within 40 tiles. Vans go out in two waves, from 09:00 and 13:00, each van at its own minute within an
hour and a half, with up to 14 parcels, one stop per kerb in nearest-neighbour order from the depot, five ticks at
each kerb and one more per extra parcel there (the WORKING bit: the courier at the door), and come back. $1 a parcel to
the depot's owner. Parcels not delivered today wait for tomorrow's vans.

**Tradespeople vans**: not built (FleetKind 8 is reserved for them).

## 6. Employment and the job balance

Growth reads `rDemand = jobs − population + 6`. Every mobile role except the council depot is a share of an existing
workplace's staff, so `jobs` and `population` are unchanged and the balance the tuning relies on is untouched. Only who
those workers are and what they do on shift changes. The council depot adds 16 jobs a depot, like any civic building.
Riders, couriers and taxi drivers keep their workplace's wage. Fares, tips and fees are on top: fares are money moving
from passengers to drivers and owners, so they do not create money from nothing. Rotas differ from the base
occupation's, so fewer of a restaurant's staff are on shift between meals; nothing in the simulation reads commercial
staff on shift.

## 7. Wire encoding

Agent flags (protocol.ts `packCitizenFlags`) are full to bit 18. The new vehicles use free bits, OR'd in by net.ts
from the agent's `extra` bits:

| Bits | Meaning |
| --- | --- |
| 19-22 | `FleetKind`: 0 none, 1 taxi, 2 private hire, 3 bicycle, 4 moped, 5 courier van, 6 bin lorry, 7 street sweeper, 8 trades van; 9-15 free |
| 23 | `FLEET_LOADED`: a taxi with a fare (roof sign dark), a rider or van with something to deliver |
| 24 | `FLEET_WORKING`: at a stop doing the job (bins on the lift, a rider or courier at the door, brushes down) |

A fleet vehicle sends kind 0 in bits 4-7 (VehicleKind 10-15 stay as they are) and the nearest body in the class bits
(sedan for cars and two-wheelers, van, truck), so an old client draws something sensible. Bits 25-30 stay free.

`CitizenInfo.fleet` (inspect only): the worker's role, the vehicle id (the panel links to it, so it can be followed),
what the unit is doing now, and today's jobs and takings. A fleet vehicle's own panel lists its driver and passenger
in `occupants` (both clickable), and its `fleet` says what it is doing. Restaurants, cab offices, depots and homes add a
`mobile` section to their tooltip.

## 8. Tick cost and how it is measured

Per tick: one `Traffic.step` per unit on the road (a car's cost; units exist only while working), the services'
dispatch every 10 ticks (rotating slices of homes and bases, bounded), a role index refreshed every 25 ticks (one pass
over citizens, as `countDrivers` does) and one bounded search per stop.

Measured with `loadtest/ab.ts` (`--set mobile=0` turns the services off: the A/B control) on the Commons, six seeds at
08:00, 12:30, 17:00 and 19:00: sim ms per tick, speed, queued share and give-ups against the control, and HEAD for
reference. `loadtest/mobile.ts` runs a 2×2 test city with a council depot for a game day and prints taxi trips, fares
and waits, orders placed, delivered and cancelled with delivery times, bin rounds and homes collected, parcels, and ms
per tick. Target: under 10% more sim time per tick, give-ups within the seed noise.

## 9. What was built and measured (2026-10-18)

Built: the framework, taxis and private hire (with ranks and real taxis for newcomers and leavers at stations and the
airport), food delivery on bicycles and mopeds with filtering, refuse rounds and street sweepers from waste depots, and
parcel couriers. Not built: tradespeople vans (FleetKind 8 is reserved), a placeable council depot.

**A/B on the Commons** (`ab-matrix.ts --hours 8,17 --seeds 1-6 --ticks 1500 --row "control=mobile=0" --row "mobile
jobs="`; the control runs the same code with every mobile role off, so it isolates this card). Paired differences, mean
± standard error over six seeds:

| | give-ups | speed points | trip mean (ticks) | sim ms / tick | fleet vehicles on the road |
| --- | --- | --- | --- | --- | --- |
| 08:00 | 352.8 → 395.0 (+42 ± 18) | 27.9 → 26.6 (−1.3 ± 0.4) | 65.3 → 70.0 | 1.20 → 1.48 (+0.28 ± 0.02) | 15.1 |
| 17:00 | 214.5 → 234.8 (+20 ± 9) | 31.3 → 29.5 (−1.8 ± 0.8) | 62.3 → 68.0 | 0.71 → 0.74 (+0.03 ± 0.01) | 10.6 |

Bodies: car–car overlaps go from 0 to 0.012 a tick at 08:00 and 0.011 at 17:00 (0.009 and 0.008 as drawn), all of them
a two-wheeler and a car (`bike-car overlaps` in ab.ts, which measures a bike as 0.05 wide); car–pedestrian contacts
are slightly lower (5.48 → 5.24, 2.58 → 2.47; no fleet vehicle is in more than a handful, and riders in a taxi are
not counted as walkers). The Commons is saturated at both peaks (65% of vehicles queued) and HEAD already gives about
5 car–pedestrian contacts a tick there, so these runs measure the change, not an absolute standard.

What the bike rule costs (08:00, six seeds, give-ups / car–car a tick): the turn guard as shipped
(`bikeTurnGuard` 1, bicycles at 0.75 of car speed) 395 / 0.012; filtering through turns too (0) 350 / 0.13; only the
bike giving way (2) 384 / 0.09; the guard with slower bicycles (0.6) 398 / 0.024. Filtering through turns costs
nothing but leaves a bike drawn against a car's corner about once every eight ticks; the guard keeps bodies apart and
costs about 10% more give-ups at the morning peak, mostly cars behind a bike in a turn. Longer stops (five ticks at a
door, five plus two a home for bins) added about 20 give-ups over three-tick stops; they are kept so a stop is visible.

**Tick cost.** Direct cost on the Commons (a profile of 1,500 ticks from 08:00): 0.13 ms a tick of 1.19, of which
driving the fleet vehicles (one traffic step each) 0.11 ms and the bus-router searches 0.06 ms (671 searches, about
0.13 ms each); the services' dispatch 0.02 ms, taxi mode choice 0.014 ms. The rest of the A/B difference at 08:00 is
the extra congestion. On the 2×2 test city over whole days (`loadtest/mobile.ts --districts 2 --days 3`, twice each
way): 2.98 ms a tick with mobile jobs against 2.79 without (+7%).

**Service levels** (`loadtest/mobile.ts`, 2×2 test city, about 5,000 citizens, days 1 and 2):

| | day 1 | day 2 |
| --- | --- | --- |
| taxis | 48 booked, 37 delivered, 5 gave up waiting; wait 29 min, ride 56 min; $391 in fares | 64 booked, 56 delivered, 2 gave up; wait 20 min, ride 57 min; $597 |
| food | 373 orders, 319 delivered (86%), 49 cancelled; order to door median 39 min, p90 118 | 376 orders, 331 delivered (88%), 47 cancelled; median 45 min, p90 114 |
| bins | 4 rounds (68 homes), 1 completed, 35 homes emptied | 4 rounds (55 homes), 3 completed, 54 emptied |
| parcels | 326 ordered, 247 delivered by 31 vans | 353 ordered, 232 delivered by 27 vans |
| fleet on the road | 51 mean, 106 peak | 33 mean, 109 peak |

On the Commons (1,200 citizens, more congested): about 50 taxi bookings a day, 95 food orders with a median of
60-80 minutes order to door, one or two bin rounds a weekday. Two things are weak: deliveries in a jam take long and
about one rider trip in ten ends with the rider stuck (the order goes back to the kitchen), and a bin round started
late in a shift can run out of crew (the homes left wait for the district's next collection day).
