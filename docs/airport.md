# Airports

An airport is two things a player builds: an **airport terminal** (a catalogue structure) and a **runway** behind it (painted airfield tiles). Planes fly from every airport that is operational, on a timetable both the server and the clients compute from the tiles alone.

Code: `shared/src/airport.ts` (encoding, runway planning, derivation), `shared/src/buildings/terminal.ts` (the kind and its two designs), `shared/src/flights.ts` (the schedule and plane poses), `server/src/sim/airports.ts` (landing fees, tooltip, the arrivals hook), `server/src/net.ts` (the runway tool), `client/src/airports.ts` and `client/src/render/airfield.ts` (the client's airports and runway lights), `client/src/render/chunkView.ts` and `render/atlas.ts` (runway markings), `client/src/render/planes.ts` (planes).

## Why two parts

A runway must be about 12 tiles long and the aux layer caps a structure at 8×8, so the runway cannot be part of the terminal's footprint. It is a painted surface instead, like a road, but it is not a road: the tile word is kind None and the aux byte carries the airfield class. Nothing else in the engine changes. Pathfinding, growth and the building index never see runway tiles. Structure placement already refuses any tile with an aux byte, and the zoning, road and civic tools refuse airfield tiles with "That is part of a runway; bulldoze it first".

## Layout

The flight schedule's layout constants fix the geometry, so everything is measured from the runway centre row (`v` = tiles across, towards the terminal):

| Rows | What | Flight geometry |
| --- | --- | --- |
| -1 | far shoulder (aux row 0) | runway edge at v = -0.8 |
| 0 | runway centre (row 1), the dragged line | planes land and take off at v = 0, `RUNWAY_WIDTH` 1.6 |
| 1 | near shoulder (row 2) | runway edge at v = 0.8 |
| 2 | taxiway inner (row 3), grass between runway and taxiway | |
| 3 | taxiway centre (row 4) | taxiway centreline at `TAXI_OFFSET` 3.4 |
| 4 | taxiway outer (row 5) | |
| 5-8 | terminal apron (the terminal's back four rows) | stands at `STAND_OFFSET` 6.6, gates at ±`GATE_PITCH`/2 from the terminal centre |
| 9-10 | terminal hall and tower | building face at `TERMINAL_OFFSET` 8.6 |
| 11 | car park, door | road in front |

The runway centre row is therefore always `TERMINAL_ROW` = 5 tiles behind the terminal's back row, and the runway must run the full width of the terminal. The runway may be longer than the terminal and off-centre; the descriptor's `apronU` says where the gates sit along it.

## Aux encoding

Airfield tiles use `0xc0 | row << 2 | o` (`0xc0`-`0xd7`), where `o` is the terminal's orientation (the direction from the runway to the terminal, FRONT order: 0 +y, 1 +x, 2 -y, 3 -x) and `row` is 0-5 across the strip from the far shoulder. Runway ends and the touchdown zone are not stored: the renderer finds them by looking along the runway for the same byte. `0xd8`-`0xdf` and `0xf0`-`0xff` stay free; `0xe0`-`0xef` is railway track (docs/rail.md).

## Painting a runway

Pick **Runway** (key U) and drag a straight line. The preview shows the six-row strip, green when the server would accept it, red with the reason in the status line otherwise. `planRunway()` runs on both sides:

- the line must be straight along x or y and unbroken, 10 to 32 tiles long;
- a terminal must stand with its back row 5 tiles from the line; a line dragged up to 3 rows off snaps onto that row;
- the runway must cover the terminal's whole width;
- every strip tile must be loaded, dry, not a road, clear (an empty zoned lot is paved over) and the player's own land.

It costs `RUNWAY_COST` ($20) per strip tile, so $120 per tile of length. Tiles that already carry the right byte are free, so dragging over a gap repairs it. Bulldozing a strip tile lifts the paint for free.

## Operational airports and the descriptor

`airportFor(terminal, env)` reads only tile words, aux bytes and sub bytes. Family code 15 holds every transport hub (docs/sub-kinds.md), so the derivation, the server's terminal list and the client's `chunkTerminals` check the kind id (`Zone.Airport`, 15) and never take a bus depot for a terminal. An airport is **operational** when the terminal is finished (level 1, no site) and the whole strip behind it is intact along a contiguous centre row of at least 10 tiles that spans the terminal. A second terminal on the same strip does not share it: the one whose span starts lower owns the runway. The descriptor is:

| Field | From |
| --- | --- |
| `id` | hash of the terminal anchor |
| `x`, `y` | runway centre (a half-integer along the runway for an even length) |
| `dir` | runway heading with the apron on its right: 0 E for a terminal at +y, 3 N at +x, 1 W at -y, 2 S at -x |
| `gates` | `TERMINAL_GATES` (2) |
| `runwayLen` | length of the centre row |
| `flightsPerHour` | 0.6 below 13 tiles, 0.8 below 16, 1.0 from 16 (a single runway tops out near one an hour) |
| `apronU` | terminal centre minus runway centre, along the heading |

The server derives its list from the finished terminals in the building index every 10 ticks. Each client derives its list from the terminals anchored in its loaded chunks whenever one of those chunks is redrawn, and only flies an airport whose whole strip is loaded. Both call the same `deriveAirports()`. `npx tsx packages/shared/scripts/flights-check.ts` builds airports in a server World, mirrors the chunks into a ClientWorld as the wire would, and checks that both paths give identical descriptors and timetables. Traffic does not follow population yet; that would need a small per-airport rate in an existing broadcast.

## Economy

- **Tech.** Aviation (`tr4`, transport tier 4) needs Public works, 150 jobs filled and $6,000.
- **Terminal.** It costs $6,000 and $140 a day in upkeep, and employs 28 ground crew at $22 a shift. Their early (05:00) and late (13:00) shifts and day check-in rotate.
- **Landing fees.** Each touchdown credits the terminal's owner `LANDING_FEE` by plane type: turboprop $24, narrow-body $40, business jet $16.
- **Passengers.** `flightPassengers()` gives every flight its arriving and departing passengers from its seed. `Airports.onArrival` fires once per landing with them. Migration is the gateways card's job, marked `TODO(gateways)` in `server/src/sim/airports.ts`.

## Tooltips

The terminal tooltip adds an Airport section, answered by the server: runway length, status (or why not operational), flights today with how many landed and departed, the next arrival and departure, gates in use, passengers today and landing fees today. Staff come from the usual workplace rows. A runway or taxiway tile's tooltip is worked out on the client from the same derivation: the terminal it belongs to, its length and its status.

## Selecting a plane

Clicking a plane selects it (hovering brightens it and shows a short tooltip), on the approach, on the ground or climbing out, and opens its panel (`client/src/vehicles.ts`). Nothing in it comes from the server. Everything follows from the flight, through `shared/src/crews.ts`.

- **Who flies it.** The airline goes with the tail colour: `AIRLINES[liveryIndex(seed)]`, the same index `render/planes.ts` paints with. A business jet is a private charter with a registration instead. Every flight has an inbound number from its origin and an outbound one (the next number) to its destination. Origin and destination are fictional cities seeded per flight, usually the same city, sometimes another. Flight ids repeat between airports, so names are seeded from the id and the flight's variation seed together.
- **The panel.** It shows the aircraft and seats, the two flights, the phase (on approach, landing, landing roll, taxiing, at the gate, pushing back, taking off, climbing out), altitude (the top of the glide path reads as 2,500 ft), speed in knots (each type's approach speed reads as 115-140 kt), the gate and the load.
- **Crew.** A captain and a first officer, then cabin crew sized to the type: a narrow-body has 4 or 5 led by a purser, a turboprop 2, a business jet 0 or 1. Now and then there is a trainee. All of it is seeded per flight, and the crew stays with the plane through the turnaround.
- **Passengers.** The count is `flightPassengers`, the arriving visitors until the gate, then the departing travellers. During the turnaround the cabin empties over its first third and boards over its second half. Names and seats (`flightPassenger`) are generated, filling the seat map in a per-flight shuffled order. They are visitors and travellers, not citizens: no citizen flies yet (the arrivals hook in `sim/airports.ts` is still unused). When the gateways card brings real travellers, they belong in this roster as clickable rows, like a train's riders.
- **Cockpit view.** I or O puts the eye just ahead of the nose (`PlanesView.cockpitOf`). It takes the plane's full orientation, so the approach pitches nose-down onto the runway and the climb-out banks away. It looks a little down and sees further than the street view. The flight ends at the edge of the map, and the view fades out with it.

## Previews and testing

`?airport=x,y,dir[,gates[,fph]]` still draws a placeholder airfield with planes on open land. `?dev` on a dev server skips technology locks, so the terminal and runway can be tried without Aviation. `npm run buildings:check` covers the encoding, the planner's refusals in all four orientations, gate placement on the apron and strip breaks.
