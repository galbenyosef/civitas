# Boats, harbours and ports

Card "boats and ports etc" (UTD 496c6b9c). It absorbs "Gateways 2: seaport" (f1b42657) and the open note "boat clearance
under bridges" (docs/structures.md section 3). Rich: "commercial boats for industry, fishing, for transport etc and also
domestic pleasure boats just cruising around. will also need harbours of varying size etc."

This is a design: nothing here is built yet. Every claim about the engine was read from source on 2026-10-18. Section 10
splits the work into subtasks, and section 11 lists the questions for Rich.

## 0. The short version

- **Where boats come from.** Boats travel on **lanes**: tile paths over navigable water that the server derives per
  harbour. Each lane is encoded like a rail route, and the server sends the lanes with the harbour list in one `harbours`
  message, re-sent only when they change. Clients run every boat from that message, so they need no chunk loaded.
- **Bridges.** Each bridge style has a clearance, and each boat type has an air draft. A lane only passes under a bridge
  its boats clear. Tall boats pass a bascule only while it is lifted.
- **Schedules.** Every boat except a ferry runs a **pure schedule**: a function of the harbour list and the day, like
  `heliTimetable`. Nothing per boat goes over the wire.
- **Ferries.** Ferries are a transit mode, `'ferry'`. They run rail's timetable through `Timetabled`, with piers as their
  stations.
- **Harbours.** There are five new Hub sub-kinds, ids 24 to 28: jetty, marina, fishing harbour, ferry pier and cargo port.
  Each footprint's back rows stand over water.
- **The cargo port.** It is the `'sea'` gateway, and it is also a freight source and sink. It works through the hooks that
  the motorway connection and rail freight already use.

## 1. What exists and what it means for boats

- **Water.**
  - Terrain is `Terrain.Water` in the tile word. `makeTerrainSampler(seed)` makes it from fbm noise and nothing else.
  - Scenarios paint water: the showcase river on rows 44-47 (`DemoSection.water`), and the Thames and docks in London
    (`londonMap.ts` `eachThamesTile`, `DOCKS`).
  - The world is flat and unbounded (`CHUNK_SIZE` 32, no edge).
- **Procedural worlds have lakes, not a sea.** I sampled 800×800 tiles at four seeds:
  - About 23% of tiles are water, in about 500 separate bodies.
  - The largest body is about 4,400 tiles, roughly 66 tiles across. Nothing in the noise reaches anything bigger.
  - Most lake tiles are wide: half have a clearance (section 2) of 4 or more.
  - So in the live world, "where boats come from" has to be decided (section 2.3, question 1).
- **London.**
  - The Thames is 3.5 tiles wide upstream, 4 through the centre and 9 to 18 east of Woolwich.
  - It runs out of the 24-tile margin at both ends: east beyond x = 135, and south-west beyond y = 79.
  - The dock basins are separate rectangles, cut off from the river by the roads across their gaps.
  - Every named crossing is a real road bridge. Blackwall (a girder) and Woolwich (an 8-tile suspension span) are bridges
    in the game, although in reality they are a tunnel and a ferry. So no tall ship from the estuary can reach Tower
    Bridge (question 4).
- **Bridges** (`shared/src/bridges.ts`).
  - A deck tile is a water tile with the road bit and an aux byte `0xd8 | style << 1 | ns`.
  - Deck heights come from `BRIDGE_DECK_H`: arch 0.18, girder 0.22, suspension 0.26, bascule 0.25. The world is flat, so
    heights are visual only.
  - `basculeLiftAt(seed, hours)` lifts a bascule 0 to 3 times a day between 07:00 and 21:00. The `BASCULE_HOLD` window is
    0.3 h.
  - Traffic sees a bascule as a level crossing (`basculeBarrierAt`).
  - The only boat in the game is a client-only sailing barge in `render/landmarks.ts` (`updateBridge`). It slides 6 tiles
    through the span during each lift. It is 0.5 long, 0.13 wide, and its mast is about 0.6 high.
- **Schedules with no wire cost.**
  - `flights.ts` `timetable(ap, day)` and `helicopters.ts` `heliTimetable(pads, day)` are pure and cached by key and day.
  - `heliTimetable` books its pads in time order, from 24 ticks before touchdown to 14 after lift-off. Overlapping flights
    are pushed back in 10-tick slots, and a flight that cannot finish inside its day is cancelled.
  - Rail sends each route once (`railLines`, about 1 byte per tile). Clients then run `railService`/`trainsAt` on lines
    whose chunks they never loaded.
- **Transit.**
  - `Transit` is mode-agnostic: a mode registers a `ModeService`.
  - `Timetabled` (`sim/timetabled.ts`) runs any `RailService` and hands each call to `Transit.serveCall`.
  - The metro reuses all of this with its own `TrackNet` (`underNet`) and a `RailLineDef.metro` flag with `METRO_TIMING`.
- **Gateways.**
  - `GATEWAY_OF[kindId]` is built from the catalogue attributes `gateway` (`'sea'` already exists in `GatewayType`),
    `gatewayModes`, `arrivalsPerHour` and `needsWater`.
  - `Gateways.planeLanded` tops up a gate's token bucket.
  - Freight goes in and out through `Simulation.dispatch`/`startTrip`, using the motorway `entries` and `EXPORT_SHARE`,
    and through `Simulation.freight` (rail `consign`).
- **Kind ids** (docs/sub-kinds.md).
  - In use: 16-23 (21 is the motorway connection; 22 and 23 the metro) and 40-100.
  - 24-39 are reserved for transport, and nothing in any branch or worktree claims them. Mobile jobs and the world map
    added no kinds.
- **Aux bytes.** Structure part bytes already cover any tile of a footprint. The free values are only `0x01`-`0x3f`,
  which are reserved, and `0xfb`-`0xff`. This design needs no new aux values.

## 2. Water navigation

Code: a new `shared/src/waterways.ts` (pure, shared). The server's `WaterEnv` reads `World.peekTile`, so it never
generates chunks just to look at them. Where a chunk was never generated, it falls back to the terrain sampler.

### 2.1 The water grid

- **Navigable.** `navigable(x, y)` is true for a water tile with no aux byte, or with a bridge deck byte. Harbour
  footprints over water carry part bytes, so other boats treat them as land. Only a harbour's own boats move inside it,
  and only to berth (section 4).
- **Clearance.** `clearance(x, y)` is the 4-neighbour chamfer distance to the nearest tile that is not navigable, capped
  at 4. On the server it is cached per chunk as a `Uint8Array(1024)`. The cache entry is dropped when any terrain or aux
  byte within 4 tiles changes: a bridge, a harbour, or a scenario painting water.
- **Width classes.** A boat type has a minimum clearance:

| Class | Clearance | Water | Boats |
| --- | --- | --- | --- |
| narrow | 1 or more | any channel | dinghy, narrowboat, motor cruiser |
| river | 2 or more | 3 or more tiles wide | sailboat, trawler, river bus, barges, tug, coaster |
| open | 3 or more | 5 or more tiles wide | ro-pax ferry, container ship |

  A 4-wide river has clearances 1, 2, 2, 1 across it. A 5-wide river has 1, 2, 3, 2, 1.
- **Crossing a bridge.**
  - A boat may step onto a deck tile only across the deck. `waterStepOk` is the inverse of `bridgeStepOk`.
  - It may only use the deck's **channel**: `bridgeChannel(span)` returns the middle deck tile of an odd span, or the
    middle two of an even one.
  - `render/bridges.ts` must put an arch's crown, or the clear span between girder or suspension piers, over the channel,
    so a passing boat never meets a pier.

### 2.2 Lanes

A **lane** is a 4-connected tile path with an A\* cost per step:

- 1 per step;
- `0.6 × (3 − min(c, 3)) / 3` to keep to mid-channel;
- 0.3 per turn;
- 4 for a bascule passage (a lift may mean a wait).

Tiles below the lane's clearance class are refused, and so are bridges the class cannot pass (section 3). Each search
stops at 20,000 nodes.

A lane is stored as a `WaterRoute`: `{ x, y, entry, sides }`, the same encoding as `RailRoute`, about one byte per tile.
`waterGeometry(route, minC)` turns it into the line a boat actually sails:

- it string-pulls the tile centres, joining two points directly when the supercover line between them stays on tiles of
  at least `minC`;
- it rounds each corner with radius `min(0.45 × c, 1.5)`;
- it parametrises the result by arclength.

The function is pure, so the server and every client get the same line. `waterways.ts` imports only types from `rail.ts`.
It expands routes itself, so there is no import cycle.

Lanes are keyed by a **pass signature**: the 4-bit set of bridge styles the boat clears when closed, plus a bit for
"lifts the bascule". There are only a few signatures in use (section 3). Each harbour gets these lanes:

| Lane | From → to | Used by |
| --- | --- | --- |
| `sea` | the harbour's fairway → its nearest sea gate (section 2.3) | trawlers, cargo, visiting boats |
| `cruise` | a closed tour from the fairway through 1-3 waypoints and back | pleasure boats |
| `grounds` | the fairway → the fishing grounds | trawlers |
| `river` | the fairway → the river end upstream (a sea gate with `low: true`) | barges, narrowboats |
| `through` | sea gate → sea gate on one body (scenario worlds only) | visiting cruisers, barges |

- **Cruise waypoints** are tiles with clearance 2 or more. They are hashed from the harbour, chosen within 40 tiles by
  water, and kept 6 or more tiles apart.
- **The fishing grounds** are the sea gate when the harbour has one. Otherwise they are the tile of highest clearance
  within 60 tiles by water.

**Derivation** is on the server only (`sim/harbours.ts`). Lanes are derived:

- when a harbour is built or removed, or its staffing starts or stops (`active`);
- on any bridge or water edit within the body. `World.placeBridge`/`removeBridge` set `Harbours.pending`;
- in a sweep once a game day.

A London lane runs to about 200 tiles, so a derivation costs a few milliseconds. When a lane cannot be found, the harbour
shows why, for example "no sea route for container ships: the girder bridge at (12, 44) is too low".

### 2.3 Where boats come from: sea gates

A **sea gate** is a water tile where a body of water leaves the playable world. Boats fade in and out there over 4 tiles,
as helicopters do at `EDGE_DIST`.

- **Scenario worlds** declare their gates.
  - `World.seaGates: { x, y, name, low? }[]` is an optional snapshot field, so no format bump is needed (as with
    `stopNames`).
  - The seeder writes the gates from `DemoSection.seaGates`.
  - London's gates are the Thames at the margin's outer edge: "the estuary" east, and "Teddington" south-west with
    `low: true`. Low means only boats with an air draft of 0.11 or less come from it: the narrowboats and cruisers of the
    upper river.
  - The showcase's gate is the east end of its river (section 8).
- **Procedural worlds** (question 1, default).
  - A body is **open water** when a flood fill from the harbour over navigable tiles reaches `OPEN_SEA_TILES` (1,500)
    before it runs out. The fill stops there, so it never costs more than that.
  - Open water has a derived offing: the tile the fill reached last, at least 30 tiles out. The offing acts as the
    body's sea gate: ships come "over the horizon" there.
  - A smaller lake, or a dock basin cut off from the river, gets local traffic only: pleasure cruising, fishing on the
    lake, and ferries between its own piers. A cargo port there is refused: "A cargo port needs open water that reaches
    the sea: this lake is 640 tiles".

Determinism comes from four rules: the fill and A\* run in a fixed order, they read only tiles, the server is the only
place that derives, and clients take the lanes from the wire.

## 3. Bridge clearance

These are new constants in `waterways.ts`, in tiles. A tile is about 13 m, since a sedan is 0.34 tiles; boats are
compressed like planes (question 5).

| Style | Deck height | **Clearance** | Note |
| --- | --- | --- | --- |
| stone arch | 0.18 | 0.12 | at the arch over the channel; the renderer keeps that crown at 0.12 or more |
| steel girder | 0.22 | 0.13 | under the plate girders (`gd` up to 0.09) |
| suspension | 0.26 | 0.21 | |
| bascule, closed | 0.25 | 0.20 | |
| bascule, open | — | unlimited | only during the `BASCULE_HOLD` part of a lift |

A boat passes under a deck when its air draft is less than the clearance.

- **Low boats** (0.11 or less) pass under every bridge: narrowboats, cruisers, river buses, barges and police launches.
- **Mid boats**, such as trawlers at 0.17, pass under suspension spans and a closed bascule.
- **Tall boats** pass only open water, or a bascule while it is lifted.

Bascule passages:

- **The lifts stay a pure clock schedule.** `basculeLiftAt` is unchanged, so the barriers and traffic already in London
  and the showcase do not change (question 3).
- **Tall voyages fit into the lifts.** The voyage planner computes when the boat's bow reaches the channel tile and when
  its stern leaves it. If that interval does not sit inside a lift's hold window, the departure is pushed back in 10-tick
  slots until it does. If no lift that day fits, the voyage uses a lane that avoids the bascule, or it does not sail.
- **A lift with no booked tall boat keeps its sailing barge.** The landmark's decorative barge becomes a real
  `sailingBarge` voyage, from the nearest sea gate, or from St Katharine's marina in London. So every lift still has a
  boat, and the barge is selectable like any other boat.

Rail and causeways:

- **Rail.** Track never crosses water: `planTrack` wants dry land, and rail bridges are deferred. Level crossings are road
  over rail on land, so boats never meet one. Rail bridges, when they come, take a `BRIDGE_CLEARANCE` entry per style and
  nothing else.
- **Causeways.** None exist, because the fill tool is deferred. A future fill tool cuts a body in two; the lanes are then
  re-derived on the terrain edit, and a harbour that loses its sea gate shows why.
- **Building a bridge that cuts a route** is allowed. The road tool's status line warns, for example "this girder bridge
  is lower than the trawlers of Fishbourne harbour use: they will lose their way to sea".

## 4. Boat types

`BOAT_TYPES: Record<BoatType, BoatSpec>` in a new `shared/src/boats.ts`. Lengths and widths are in tiles; speed is in
tiles a tick. A car is 0.5 tiles a tick, and 1 tile a tick reads as 63 knots (`KMH_PER_TPS`).

| Type | L × W | Draft class | Air draft | Speed | Based at | Livery (all with per-boat jitter and weathering) |
| --- | --- | --- | --- | --- | --- | --- |
| dinghy | 0.22 × 0.09 | narrow | 0.20 | 0.10 | jetty, marina | white or bright hull; sail white, red, blue or tan |
| motorCruiser | 0.42 × 0.14 | narrow | 0.09 | 0.22 | jetty, marina | white hull with a navy, teal or burgundy boot stripe; some with a flybridge |
| sailboat | 0.50 × 0.15 | river | 0.38 | 0.14 under sail, 0.12 under motor | marina | white, navy, green or red hull; cream or white sails; heels with the wind |
| narrowboat | 0.62 × 0.07 | narrow | 0.07 | 0.06 | jetty, marina on narrow or river water only | black hull; green, red or blue cabin with lined panels; a name board |
| trawler | 0.55 × 0.16 | river | 0.17 | 0.18 | fishing harbour | blue, red, green, black or orange hull; white wheelhouse; gantry, nets and a registration |
| riverBus | 0.95 × 0.22 | river | 0.10 | 0.40 | ferry lines | catamaran; the line's colour (two liveries, as for trains) |
| ropax | 1.60 × 0.35 | open | 0.30 | 0.30 | cargo port (small berth) | white upper works; operator-coloured hull and funnel |
| barge | 0.90 × 0.20 | river | 0.08 | 0.12 | cargo port | black or rust; aggregates or a few containers |
| sailingBarge | 0.50 × 0.13 | river | 0.55 | 0.10 | lift voyages, marina | black hull; red-brown sails (the existing model) |
| coaster | 2.00 × 0.35 | river | 0.24 | 0.22 | cargo port (small berth) | dark hull; cream bridge aft; hatch covers or deck containers |
| containerShip | 4.40 × 0.62 | open | 0.48 | 0.25 | cargo port (big berth) | fictional lines (navy, red, green, grey); containers coloured by box hash |
| tug | 0.40 × 0.15 | river | 0.12 | 0.20 | escorts container ships | black hull; red or orange upper works |
| policeLaunch *(optional)* | 0.45 × 0.13 | narrow | 0.09 | 0.30 | police HQ by water (later) | blue and yellow battenburg band |
| fireBoat *(optional)* | 0.60 × 0.18 | river | 0.14 | 0.24 | fire HQ by water (later) | red; monitors on the roof |

These fields come from the boat's seed, as for planes (`AIRLINES`, `liveryIndex`), helicopters (`HELI_OPERATORS`) and
`trainCrew`:

- **Name.** `boatName(seed)` gives names like "Morning Star", "Kittiwake" or "Sea Breeze II".
- **Registration or port number.** For trawlers, the harbour's two letters and a number.
- **Owner or operator.** Fictional names only; nothing impersonates a real operator.
- **Crew.** `boatCrew(type, seed)` gives a skipper, a mate and hands. A ferry also has a pier hand. A fishing boat's crew
  are real citizens instead (section 6.3).

## 5. Harbours

These are Hub-family sub-kinds (`Zone.Hub`, code 15), so they share one scan, `builtOf(Zone.Hub)`, with gateways. The
catalogue file is `shared/src/buildings/harbour.ts`. Ids 29-31 are reserved: a sea lock (if question 1 goes that way), a
boatyard and a lifeboat station.

**Footprint over water.**

- `Footprint.wet` (new, in `schema.ts`) is the number of back rows that must be water. The door is on the front row, on
  land, facing a road.
- `checkPlaced` in `structures.ts` changes in four ways:
  - wet rows must be navigable water with no aux byte, on the player's land;
  - the other rows must be dry;
  - the **quay**, the last dry row, must have water behind every tile of it;
  - the **fairway**, the row beyond the back edge, must be navigable water with the kind's `fairwayClearance` along its
    whole width.
- `planStructure`'s automatic facing then works unchanged: only the side whose back is water passes.
- `MarkKind` gains `'quay'` and `'berth'`, so the preview shows the berths.

Several checks are needed after placing a footprint over water:

- `World.placeStructure` and the clearing paths keep the terrain bits (`packTile(terrainOf(...))`), and mirroring skips
  terrain. So a bulldozed pontoon is open water again; a check script asserts it.
- `chunkView` draws water, not paving, under a structure tile whose terrain is water.
- The world map's `mapClassOf` reads such a tile as water.
- `planBridge` already refuses tiles that carry an aux byte, so nobody can bridge over a pontoon.

**Berths.** Each kind lists berth slots in footprint coordinates, the way an airport has `GATE_PITCH`. A slot has:

- a centre and a heading;
- the longest boat it takes;
- whether boats lie alongside or bow-in.

A boat berths by leaving its lane at the fairway tile behind the slot and following a scripted curve of at most 1.5
tiles. Sidling alongside a quay takes about 20 ticks, with a tug for a container ship. The curve is part of the pure
schedule.

| Kind (id) | Footprint, wet rows, door | Berths | Fairway | Tech | Cost, upkeep | Staff (shifts) | What it does |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **jetty** (24) | 1×2, 1, `[0, 1]` | 2 small slots either side of the planks | narrow | Harbours | $600, $8 | 2 boat hirers (09:00, 13:00) | a slipway and boathouse; 1-2 dinghies or a cruiser based here; a leisure outing (it is `leisureReady`) |
| **marina** (25) | 4×4, 2, `[1, 3]` | 10 on a pontoon spine with fingers | narrow | Harbours | $4,000, $60 | 8 (harbourmaster, dock hands, café) | 6-10 boats based, by hash, sized to the water (narrowboats on narrow or river bodies, sailboats only with clearance 2+); berth fees $4 a boat a day to the owner; a leisure venue |
| **fishing harbour** (26) | 4×3, 1, `[1, 2]` | 3 trawler slots along the quay | river | Harbours | $5,000, $80 | 26: 20 crew (04:00-16:00, Mon-Sat) and 6 market porters (05:00-13:00) | 3 trawlers; the catch is landed at the fish market and sold to food venues and industry (6.3) |
| **ferry pier** (27) | 2×2, 1 (the pontoon), `[0, 1]` | the 2-tile row **outside**, behind the pontoon (`pierStop`, like rail's `stationStop`) | narrow, with a river lane | River buses | $1,500, $20 | 3 pier staff | a stop for a ferry line (6.2); one line a pier (question 2) |
| **cargo port** (28) | 8×6, 1, `[3, 5]` | 5-tile big berth and 3-tile small berth on row 0; 2 gantry cranes on the quay; truck gate in front | open, and the body reaches a sea gate | Seaport | $14,000, $200 | 70: dockers and crane drivers (06:00, 14:00, 22:00) | the `'sea'` gateway: `gateway: 'sea'`, `gatewayModes: ['foot', 'taxi']`, `arrivalsPerHour: 6`, `needsWater: true`; ship calls; imports and exports (6.4) |

**Tech**, in `tech.ts`:

| Node | Tier | Requires | Condition | Cost | Unlocks |
| --- | --- | --- | --- | --- | --- |
| `tr10` Harbours | 4 | `tr8` Civil engineering | 250 housed | $1,800 | jetty, marina, fishing harbour |
| `tr11` River buses | 6 | `tr5` and `tr10` | 250 jobs | $2,500 | the ferry pier and `'ferry'` lines |
| `tr12` Seaport | 7 | `tr10` and `zon2` | 500 jobs | $9,000 | the cargo port |

Kinds stay `draft: true` until the scenario subtask places them, because `demo:check` fails any placeable kind that the
showcase does not place.

## 6. The simulation

### 6.1 What is scheduled and what is simulated

| Boats | How | Server's part |
| --- | --- | --- |
| pleasure, trawlers, cargo ships, barges, tugs, sailing barges, visitors | `boatTimetable(harbours, gates, day)`: pure, cached by `harboursKey` and day | walk the day's events each tick: landings, calls, fees |
| river buses | a `'ferry'` transit line: `railService` through `Timetabled` | riders (`Transit.serveCall`) |
| (later) police and fire launches | the same timetable, from their stations | none |

No boat is moved by a per-tick simulation, and boats do not avoid each other. Boats sailing in opposite directions keep to
starboard of the lane, offset by `min(0.3, 0.3 × (c − 0.5))` (render only). Close passes at crossings are counted by the
check, not prevented. Berths are the one hard rule.

**`boatTimetable`** follows the `heliTimetable` pattern:

- every harbour's based boats and visiting calls make candidate voyages from hashed times;
- the candidates are booked in time order;
- a berth slot is reserved from berthing start minus 10 ticks to unberthing end plus 10;
- a based boat holds its home slot whenever it is home;
- a conflict pushes the voyage back in 10-tick slots;
- bascule passages are booked as in section 3;
- a voyage may run on until 04:00 the next day (`boatsAt` reads day − 1 and day, as `trainsAt` does), otherwise it is
  cancelled.

**`boatsAt(tick)`** gives each boat:

- its position and heading;
- speed, with heave, pitch and roll seeds;
- its phase: moored, unberthing, underway, fishing, waiting, berthing or alongside;
- its lights;
- what it carries.

Pleasure boats sail 0-2 trips a day, more at weekends. A motor cruiser's trip lasts 1-4 h, a dinghy's 30-90 min, and a
narrowboat potters 2-6 h at walking pace. All three follow their `cruise` lane, at a per-boat speed factor of ±8%.

Pleasure boats and the marina:

- Their owners are fictional (question 2).
- The marina is a leisure venue, so citizens visit it as an outing, as they visit the lakeside park.
- The berth fees come from the boats based there.

### 6.2 Ferries: a transit mode

- **Mode and stops.** `TransitMode` gains `'ferry'`, and `STOP_KINDS[27] = 'ferry'`.
- **The service.** `server/src/sim/ferry.ts` `Ferry extends Timetabled`.
  - `network()` is `routeWater(def, env)`: legs from pier to pier on river-class water. This is not `routeNet`, because
    open water has 4-sided tiles, which `legSearch` treats as straight-only crossings.
  - The route comes back as a `RailRoute` with `water: true` and the piers' berth rows as stops.
  - `stopProblem` is `pierStop`: a built pier whose berth row is navigable.
- **Timing** (`rail.ts`).
  - `RailLineDef.ferry` is a flag, with `FERRY_TIMING = { vmax: 0.40, accel: 0.02, dwell: [4, 6], terminusDwell: [12, 18], trainsMax: 8 }`.
  - A ferry is one vehicle, `RailVehicle.RiverBus` (9), with 120 places.
  - `railGeometry` hands a `water` route to `waterGeometry`, and `railPoint` hands it to `waterPoint`.
  - A there-and-back line spaces its boats like the metro (`unfoldedS`), because the river is two-way.
  - At a call, a boat stops `0.5 × dir` off the berth row's middle, so an outbound and an inbound boat lie nose to tail
    on the 2-tile row instead of on top of each other.
- **Lines are not exclusive.** Unlike rail, water is shared. The one exclusive rule is one line per pier, and the editor
  refuses a second line: "the pier at (x, y) already serves line 1; build another pier for line 2". Riders change on foot
  within `transferWalk`.
- **Riders.** The planner offers ferry lines as it offers trains (`waitAt`, `rideTicks`, `nextRide`). Fares are paid to
  the line's owner. `waitSpot` puts riders on the pontoon.
- **Wire.** `{ t: 'ferryLines', lines: FerryLineDTO[] }`, where a `FerryLineDTO` is a `RailLineDTO` plus pier names. It
  goes to everyone on hello and on change, as `metroLines` does. Nothing goes per boat.
- **Selection.** The ferry's panel reuses `inspectTrain`: vehicle ids are `trainVehicleId`, and line ids are unique
  across modes. `trainCrew` gets a ferry variant: a master, a mate and deckhands.

### 6.3 Fishing

- **Crew.** The crew are real citizens on the harbour's payroll. `boatRole(kindId, wx, wy, citizenId)` hash-seeds crew
  against porters, like `mobileRole`, and assigns each crew member to a trawler. A crew member stays in `Work` at the
  harbour and is not drawn, as bus drivers are. While their trawler's voyage is out, the citizen panel says "at sea on
  the Kittiwake".
- **Staffing.** A harbour with no staff is not `active`. Its trawlers stay moored, and the `harbours` message says so, so
  the schedule agrees on both sides.
- **The voyage.** A trawler leaves between 04:00 and 06:00 and runs its `grounds` lane. It fishes for 4 to 8 hours:
  - **The trawl.** A slow wander, a pure function of the seed: racetrack legs at 0.06 tiles a tick.
  - **Lights.** It shows green over white (the real trawling lights) and deck floodlights.
  - **Return.** It comes back between 12:00 and 17:00 and lies at the quay for an hour to land its catch.
  - **Days off.** It does not sail on Sundays.
- **The catch.** `catchOf(voyage)` gives 20 to 60 boxes, from the hours fished and the seed. The server credits the
  harbour at the landing event. A harbour's catch today is a buffer.
- **Selling the catch.**
  - `Harbours.tick` queues one freight job per 10 boxes: 75% to food venues (`isFoodVenue`) and 25% to the nearest
    industrial building (processing).
  - Each job goes through `Simulation.dispatch` using `{ vkind: Freight, b: harbour, to }`, a new optional `to` that
    skips the commercial pick.
  - The buyer pays $3 a box to the harbour's owner, the `FREIGHT_FEE` path.
  - Rail `consign` applies, as for any factory.

### 6.4 The cargo port: freight and gateway

- **Calls.** Calls are per day by port: 1 to 3 container ships, 0 to 2 coasters, 1 to 2 ro-pax ferries and 2 to 4 barges.
  - Ships come from the `sea` gate on hashed hours. A container ship is met by a tug 8 tiles out.
  - Barges come from the `river` gate, or from the body's far end.
  - Ships are alongside for 4 to 10 hours, coasters and barges for 2 to 4, ro-pax for 1.
- **Imports.** At the `alongside` event, a container ship lands 30 to 60 boxes, a coaster 6 to 12 and a barge 4 to 8.
  - The boxes join a port queue. Lorries take them to shops through `startTrip` with `b = port`, so the port behaves as a
    factory origin.
  - Rail freight applies untouched: a freight line from a yard within `YARD_CATCHMENT` of the port takes deliveries
    longer than 14 tiles.
  - Port dues are $5 a box to the port's owner.
- **Exports.** `EXPORT_SHARE` picks the nearest export point: a motorway entry, or the port door, whichever is nearer.
  - A truck to the port leaves its box in the port's export stack.
  - Each departing ship takes up to its size from the stack. Boxes are written off after a day and a half, as rail
    containers are.
- **Gateway.**
  - The port is a gate through `GATEWAY_OF`, so `Gateways.refresh` finds it through its catalogue attributes.
  - It is open while it is staffed and has a sea route.
  - A ro-pax call tops up its tokens with `Gateways.shipBerthed(x, y, passengers)`. That is `planeLanded`'s twin, with
    80-300 passengers, 8% of them moving here.
  - Newcomers walk or take a taxi from the gate (`modeFor`).
- **No per-boat state.** Containers and passengers are counts on the call. Nothing is stored per box beyond the
  queues, as for rail `consign`.

### 6.5 Wire and tick cost

- **Messages.** There are two new messages, and both go on hello and on change only:
  - `{ t: 'harbours', list: HarbourDTO[], gates: SeaGateDTO[] }`. A `HarbourDTO` is: id, kind, anchor, rotation, door,
    owner, `active`, and its lanes as `{ purpose, sig, route: WaterRoute }`.
  - `ferryLines`.
- **Size.** London's message is about 6 KB, sent once.
- **Nothing else is new on the wire.** Boats are not in the agent stream, and tooltips are ordinary inspect answers.
- **Tick cost.** `Harbours.tick` advances a pointer through the day's sorted events, and the ferries cost what a metro
  line costs. Lane derivation happens on change only. The target is under 3% more sim time on the boats load test
  (section 9).

## 7. Rendering

The view is a new `client/src/render/boats.ts`, `BoatsView`. It is owned by `main.ts`, beside `TrainsView` and
`HelicoptersView`.

- **Hulls.**
  - There is one `InstancedMesh` per type and part: hull, boot-top, upper works, glass, sails, deck cargo and fittings,
    following the instanced pattern in `trains.ts`.
  - Containers are instanced boxes, coloured by box hash.
  - The sailing barge keeps `bargeGeometry`, moved into `boats.ts`.
- **Organic variation** is the standing rule, and every boat varies:
  - hull hue, saturation and lightness jitter, and weathering;
  - sail tone and patching;
  - name and number;
  - heave amplitude and period;
  - roll and pitch phase;
  - mooring offset and yaw at the berth;
  - fender count;
  - cabin light warmth, with a few dark;
  - whether a sailboat sails or motors in a given stretch, by per-boat preference.
- **Motion.**
  - **Heave and pitch.** Heave is `A × sin(ωt + φ)`, with A from the type: a dinghy 0.012, a container ship 0.003.
    Underway, the bow lifts with speed, and pitch follows the heave.
  - **Roll.** In a turn, a motor boat banks into it. A sailboat heels away from the day's wind (`windOf`-style hash per
    day and body) by its heading.
  - **Moored boats** bob at a third of that.
- **Wakes.** An `InstancedMesh` of canvas-textured V quads behind each moving boat, plus a bow-wave ring. They are scaled
  and faded by speed, and drawn just above the water. Moored boats have none.
- **Lights.**
  - Navigation lights under way: red to port, green to starboard, a white masthead and a white stern light.
  - An anchor light on some moored boats.
  - Trawling lights: green over white, with deck floods.
  - A container ship has its accommodation lit.
  - A police launch flashes blue.
  - Drawn as instanced glow points, as in `headlights.ts`; they come up at dusk.
- **Under bridges.** The renderer asserts that boat y plus air draft stays below the deck's clearance. The bascule
  leaves follow `basculeOpen`, and the landmark's barge hands over to the real sailing barge voyage.
- **Selection.**
  - `BoatsView.pick` works like `HelicoptersView.pick`. Hovering gives a tooltip from `vehicles.ts` `boatTipHtml`: name,
    type, what it is doing ("trawling off the point", "alongside at Fishbourne quay, unloading", "waiting for the lifting
    bridge"), and speed in knots.
  - The panel, `boatPanelHtml`, adds the route, the crew and the load. A fishing crew comes from the server's new
    `inspectBoat` as clickable citizens. A ferry's riders come from `inspectTrain`.
- **First-person view.** I or O rides at the helm.
  - `BoatsView.helmOf(state)` returns a `CabEye`: the wheelhouse eye, with the boat's pitch and roll in `q`, `sway`,
    `fogFar` 60, and a small `dip`.
  - `vehicleInterior.ts` gets a `HelmFeed`: wheelhouse window frames, a wheel, throttle levers, a compass and a radar
    sweep for wheelhouse boats. A dinghy shows only its bow and the tiller.
- **Harbour models.** Two designs per kind, from `kit.ts` boxes and cylinders:
  - pontoons with fingers;
  - a timber jetty on piles;
  - a fish market hall with an ice plant;
  - a pier canopy and gangway;
  - container stacks, a gatehouse, and gantry cranes on quay rails.
- **Debugging.** `window.msc.boats` has `debugTick`, `at(tick)` and `findPhase(phase, from, type)`, as in helicopters.

## 8. London and the showcase

**London** (`shared/src/demo/london.ts` and `londonMap.ts`):

- **Sea gates.** "the estuary" where the Thames leaves the margin's east edge, and "Teddington" (`low`) at the
  south-west. They are computed from `thamesLine` clipped to the margin rectangle.
- **Piers.** Fitted like `fitEntrance`, before the streets, so a road runs along each front (as for the landmarks). Each
  goes on the real bank, on the nearest frontage with the river behind it, a tile clear of bridge landings. The real
  piers:

| Pier | Bank | Latitude, longitude |
| --- | --- | --- |
| Westminster | N | 51.5017, -0.1235 |
| Embankment | N | 51.5075, -0.1217 |
| Bankside | S | 51.5076, -0.0990 |
| London Bridge City | S | 51.5058, -0.0839 |
| Tower | N | 51.5074, -0.0796 |
| Canary Wharf | N | 51.5048, -0.0275 |
| Greenwich | S | 51.4835, -0.0092 |

- **River bus RB1.** There and back, 5 boats, named "RB1". Every bridge on the way is an arch, a girder or Tower Bridge
  closed, and the river bus at 0.10 clears them all, as the real Clippers do. Riders change to the Tube at Westminster,
  Embankment, London Bridge and Canary Wharf.
- **St Katharine Docks.** A new `DOCKS` entry for a 3×2 basin joined to the river just east of the Tower, with a marina in
  it.
  - It is home to cruisers, sailboats and a sailing barge.
  - Their tall boats go up into the Pool of London through Tower Bridge's lifts, as the real ones do. London Bridge (a
    girder) stops them going further.
- **Other boats.**
  - A jetty with dinghies at Putney.
  - A cargo port on the north bank by the Thames Gateway, east of Woolwich, at about x 74-95, where the river is 9-13
    wide: open water, with a sea route from the estuary gate that passes no bridge. It gets container ships, coasters,
    ro-pax and tugs, plus barges up to Teddington under every bridge.
  - Through traffic between the gates: cruisers and narrowboats from Teddington, which are low.
- **Tour stops.** `pier-westminster`, `line-ferry-rb1`, `st-katharine`, `london-port` and `pool-of-london` (a spot). The
  existing Tower Bridge stop keeps its place.

**Showcase.**

- **The new section.** `'harbour'` (SectionId) goes on the land east of the riverside quarter: `land` [35, 30, 40, 31].
  - The river is painted on from x = 70 to 75 and widened into a basin, for example `water` [45, 38, 30, 18], which gives
    open water.
  - It declares `seaGates: [[74, 46]]`, the east edge.
  - These coordinates are indicative. The noise lake round (16-40, 34-48) and the airfield at (35-49, -12-11) are close,
    so `demo:check` decides.
- **Placements.** Each with its own tour stop:
  - a jetty and a marina between the bascule (x = 15) and the suspension bridge (x = 25) on the river road side, if row
    48 fits; otherwise on the basin;
  - a fishing harbour and a cargo port on the basin;
  - two ferry piers, one on the river and one on the basin, with ferry line 1 between them.
  - A marina between those two bridges means its tall sailboats meet the bascule within one tile of setting out, so the
    showcase shows a lift for a real tall boat.
- **New `DemoSection` field.** `seaGates`, which `seed.ts` writes to `World.seaGates`.
- **Registry entries** (`SHOWCASE_FEATURES`):
  - Every `BoatType`, typed as a `Record<BoatType, …>` like plane types, is scheduled at a showcase harbour within
    `FEATURE_DAYS`. The tour stops are the type's harbour (`marina`, `fishing-harbour`, `cargo-port`) or `line-ferry-1`.
  - "A tall boat through a lift" is checked by a voyage booked into a bascule lift (tour stop `bridge-bascule`).
  - "A sea gate" is a spot (`sea-gate`, `SPOT_CAPTIONS`).
  - The optional launches carry a `todo` until they exist.
- **Line modes.** `LINE_MODES` gains `ferry`.
  - Its type widens to `true | string`: a string is a todo, listed and not enforced, as a feature's `todo` is.
  - The ferry subtask lands it as a todo, and the scenario subtask sets it to `true`.
- **Captions.** `SURFACE_CAPTIONS`-style text for the gates and lanes. The kinds' `blurb` and `howTo` text comes from the
  catalogue.

## 9. Checks

- **`packages/shared/scripts/boats-check.ts [days]`**, modelled on `heli-check.ts` and `rail-check.ts`. It builds a server
  World with:
  - a 4-wide river under all four bridge styles;
  - a basin with a sea gate;
  - a small lake;
  - every harbour kind.

  It mirrors the chunks into a ClientWorld as the wire would, and checks:
  - **Placement.** The planners' refusals: dry back, wet front, narrow fairway, a port on a small lake, a bridge over a
    pontoon. A bulldozed pontoon is water again.
  - **Lanes.**
    - Every lane tile is navigable with its class clearance.
    - A deck is crossed only on its channel and only across it.
    - No lane of a signature passes a bridge its air draft cannot clear.
    - A lane re-derived from the same tiles is identical.
  - **Determinism.**
    - The same `HarbourDTO` list gives identical timetables on the server, the client, and a second run.
    - `boatsAt(t)` computed cold equals the value reached by stepping.
  - **Sampled every half tick over whole days.**
    - No two boats are in one berth slot.
    - No boat's hull corners are off navigable water, except in its own harbour's footprint while berthing.
    - Every tall boat over a bascule channel tile has `basculeOpen` of 0.99 or more.
    - Voyages end by 04:00 next day.
  - **Ferries.**
    - Routes connect.
    - The two directions' berth offsets never overlap.
    - Boats of a line keep a boat length plus `TRAIN_GAP` apart.
    - `nextRide` gets there.
    - A second line at a pier is refused.
- **`npm run demo:check`.** The kinds, the ferry mode and the registry entries above. `--run` reports:
  - voyages by type;
  - tall boats through each bascule lift;
  - ferry riders;
  - catch landed and sold;
  - containers by sea in and out;
  - sea arrivals.
- **`packages/server/src/loadtest/boats.ts --days 2`.** A 2×2 test city with a river and a basin with a sea gate: 4
  marinas, 2 jetties, 2 fishing harbours, a cargo port, 8 piers on 2 ferry lines and a freight yard by the port. It
  prints:
  - ms a tick, against the same city with harbours off (`--set harbours=0`);
  - lane derivation time;
  - voyages;
  - catch;
  - containers, including by rail;
  - ferry riders;
  - sea migrants.

  The target is under 3% more sim time, and under 20 ms for a whole lane derivation.

## 10. Phased plan

There are eight subtasks, about 5 hours of agent time, in four waves. Each runs in its own worktree.

- **Merge order.** B1 and B2, then B3, B5 and B7, then B4 and B6, then B8.
- **What must pass at each merge.**
  - Every merge: typecheck and `buildings:check`.
  - From B1 on: `boats-check.ts`.
  - Every merge: `demo:check` must stay green, because the kinds are drafts and the ferry mode is a todo until B8.
- **This document.** Each subtask adds its own "Built" note under its own section, never in a shared paragraph.

| # | Title | Model | Depends on | Parallel-safe with | Size | Files | Hot spots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Waterways: nav grid, clearance, lanes, `waterGeometry`, bridge clearance | opus | — | B2 | M (30 min) | new `shared/src/waterways.ts`; `bridges.ts` (`BRIDGE_CLEARANCE`, `bridgeChannel`); new `shared/scripts/boats-check.ts` (lanes) | `shared/src/index.ts` (one export line) |
| B2 | Harbour kinds (ids 24-28, drafts, one placeholder design each), wet footprints, placement, tech | opus | — | B1 | M (35 min) | new `buildings/harbour.ts`; `schema.ts`; catalogue registration; `structures.ts` `checkPlaced`; `tech.ts`; `chunkView.ts` (water under wet tiles); `worldmap.ts` (`mapClassOf`) | `compiled.ts` (generated: re-run `buildings:compile` on merge); `chunkView.ts` |
| B3 | Boat types and the schedule: `BOAT_TYPES`, `boatTimetable`, berth and bascule booking, `boatsAt`, names and crews | opus | B1 (B2's ids by `KIND_ID`) | B5, B7 | L (45 min) | new `shared/src/boats.ts`; `boats-check.ts` (schedule sections) | `boats-check.ts` (append sections) |
| B4 | Server harbours: lanes on change, sea gates, `harbours` message, fishing and port economy, `shipBerthed`, `inspectBoat`, tooltips, load test | opus | B1, B2, B3 | B6 | L (50 min) | new `server/src/sim/harbours.ts`; `simulation.ts` (`dispatch` `to`, export point); `gateways.ts`; `world.ts`, `snapshot.ts` (`seaGates`); `game.ts`; `net.ts`; `protocol.ts`; new `loadtest/boats.ts` | `net.ts`, `protocol.ts`, `game.ts` (also B5); `simulation.ts` |
| B5 | Ferries: the `'ferry'` mode, `Ferry extends Timetabled`, `routeWater`, `FERRY_TIMING`, berth offsets, `ferryLines`, the lines editor | opus | B1, B2 | B3, B7 | M (35 min) | `shared/src/transit.ts`; `rail.ts` (`ferry`, `RiverBus`, geometry dispatch); new `server/src/sim/ferry.ts`; `game.ts`; `net.ts`; `protocol.ts`; `client/src/lines.ts`; `showcase.ts` (`LINE_MODES` todo) | `rail.ts`; `net.ts`, `protocol.ts`, `game.ts` (also B4: append-only hunks); `showcase.ts` (also B8) |
| B6 | Boat rendering: models, liveries, motion, sails, wakes, lights, moored boats, picking, panels, helm FPV, barge hand-off | sonnet | B3 (B5 for ferries; mock until merged) | B4 | L (50 min) | new `client/src/render/boats.ts`; `vehicles.ts`; `main.ts`; `vehicleInterior.ts`; `fpv.ts` (`CabEye.helm`); `landmarks.ts` | `main.ts`; `vehicles.ts` |
| B7 | Harbour models: two designs per kind (pontoons, jetty, market hall, pier, cranes and stacks); channel-aware arches and piers in `render/bridges.ts` | sonnet | B2 | B3, B5 | S (25 min) | `buildings/harbour.ts` (designs only); `render/bridges.ts` (`bridgeChannel`) | `compiled.ts` (re-run compile) |
| B8 | Scenarios and checks: showcase `harbour` section, registry, tour, London (gates, piers, RB1, St Katharine, port), seeder `seaGates`, `demo:check` report, drafts off, `LINE_MODES.ferry = true` | opus | all | — | L (45 min) | `showcase.ts`; `london.ts`; `londonMap.ts` (`DOCKS`); `server/src/demo/seed.ts`; `demo/check.ts`; `harbour.ts` (draft flags) | `showcase.ts`; London's `startHash` changes (reset the demos) |

Shared hot spots, in order of risk:

- **`protocol.ts`, `net.ts` and `game.ts`** (B4 and B5). Keep each change to an appended union member, message case or
  wiring block.
- **`compiled.ts`** (B2 and B7). Never hand-merge it: re-run `npm run buildings:compile`.
- **`showcase.ts`** (B5 and B8).
- **`shared/src/index.ts`.** One export line from each subtask.

## 11. Questions for Rich

1. **Is there a sea in procedural worlds?** Measured: no; the largest lake is about 4,400 tiles.
   - *Default:* a body of 1,500 navigable tiles or more counts as open water reaching the sea, and ships appear over its
     far horizon. Smaller lakes get local boats only and no cargo port.
   - *Alternative:* a placeable **sea lock** (id 29), "the canal to the sea", on any lake's shore, like the motorway
     connection is the road's off-map link.
2. **Who owns pleasure boats, and how many ferry lines can share a pier?**
   - *Default:* fictional owners, with marina berth fees to the marina's owner, and one ferry line a pier.
   - *Alternative:* boats as real households' possessions, with trips as their leisure outings, and piers with several
     berths for shared lines. Both are larger changes.
3. **Should Tower Bridge lift on demand?**
   - *Default:* the existing pure clock schedule of 0-3 lifts a day, with tall boats booked into those lifts. Road traffic
     in London and the showcase is unchanged.
   - *Alternative:* a lift for every tall boat. That is more realistic, but there are more lifts and more queues on the
     road.
4. **London's Blackwall and Woolwich crossings.** In the game they are a girder and a suspension bridge; in reality they
   are a tunnel and a ferry. They keep tall ships from the estuary away from Tower Bridge.
   - *Default:* keep them. Tall boats are based at St Katharine Docks, and the cargo port sits east of Woolwich.
   - *Alternative:* make the Woolwich crossing a short ferry line (the real Woolwich Ferry). That takes road capacity away
     from the east.
5. **Boat scale.**
   - *Default:* compressed like planes. A container ship is 4.4 tiles, about 57 m against a real 300 m; a river bus is
     0.95 tiles.
   - *Alternative:* true scale. A container ship would then be about 23 tiles long and no showcase basin would hold it.
