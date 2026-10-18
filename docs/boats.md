# Boats, harbours and ports

Card "boats and ports etc" (UTD 496c6b9c). It absorbs "Gateways 2: seaport" (f1b42657) and the open note "boat clearance
under bridges" (docs/structures.md section 3). Rich: "commercial boats for industry, fishing, for transport etc and also
domestic pleasure boats just cruising around. will also need harbours of varying size etc."

This began as a design, and every subtask is now built (B1-B8): each section's "Built" note says what was built and
how it differs. Every claim about the engine was read from source on 2026-10-18. Section 10 splits the work into
subtasks, and section 11 lists the questions for Rich.

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

### 3.1 Built: B1, waterways (2026-10-18)

Sections 2 and 3 are built in `shared/src/waterways.ts`, with `BRIDGE_CLEARANCE`, `bridgeClearance`, `bridgeChannel` and
`waterStepOk` in `bridges.ts`. Nothing calls them yet: B3, B4 and B5 do. Checked by `packages/shared/scripts/boats-check.ts`.

- **The grid.**
  - `navigableTile`/`navigable` and `clearanceAt(env, x, y)` are uncached, for one-off checks such as a fairway.
  - `WaterGrid(env)` caches clearance per chunk. A two-pass distance transform runs over the chunk plus a 4-tile
    margin, so the result is exact; the check compares it with `clearanceAt` on every tile.
  - The owner calls `grid.invalidate(x, y)` for every terrain or aux change. `grid.channel(x, y)` reports a deck
    tile on its channel.
  - `grid.room(x, y)` is clearance that also treats decks as obstacles (section 2.2 explains why).
- **Pass signatures.**
  - `passSig(airDraft, lifts = true)` sets bit `s` for each style the boat clears closed. It adds `PASS_LIFT` (16)
    when the boat does not clear a closed bascule and may have one lifted.
  - `passUnder(sig, style)` returns `true`, `'lift'` or `false`. Measured: a narrowboat at 0.07 gives 15, a trawler
    at 0.17 gives 12 (suspension and bascule), and every tall boat gives 16.
- **Lanes.** `waterLane(grid, from, to | to[], { cls, sig, entry?, notIn?, maxNodes? })` is A\* over (tile, entry
  side).
  - It never reverses, crosses a deck only straight across and only on its channel, and uses the section 2.2 costs
    (`LANE_COST`) and `LANE_MAX_NODES` (20,000).
  - A refusal has `why` ('bridge' | 'narrow' | 'unconnected' | 'far') and a `reason`, such as "the steel girder bridge
    at (85, 21) is too low" or "the water is too narrow at (70, 39)". The harbour prefixes it ("no sea route for
    trawlers: ..."). To find what is in the way, it searches again with every bridge passable, then on any width.
- **The route carries more than a rail route.** A `WaterRoute` is `{ x, y, entry, sides, room, loop, bridges,
  stops? }`.
  - `room` is one digit a tile (`grid.room`). With the route's tiles, it is all `waterGeometry` needs to know which
    off-route tiles are clear: room r on a route tile means room r − d at L1 distance d. So the sailing line needs no
    chunk.
  - `bridges` lists each deck passed under as `{ k, style, x0, y0 }` (the span's first deck tile, for `basculeSeed`).
  - The wire cost is about 2 bytes a tile.
- **Sea gates.**
  - `SeaGate { x, y, name, low? }`, `gateServes(gate, airDraft)` (`SEA_GATE_LOW_AIR` 0.11) and `SEA_GATE_FADE` (4).
  - `seaGateGoals(grid, gate, cls)` returns the tiles within 4 (L1) of a gate that have the class's clearance and no
    deck, nearest first. A lane to a gate ends at the nearest of them, because the gate tile at the world's edge has
    little room itself.
  - `openWater(grid, x, y)` is the `OPEN_SEA_TILES` fill. Its offing prefers a tile 30 or more out, then the most room
    up to 3, then the farthest.
- **The other lanes.**
  - `fishingGrounds(grid, from, cls, sig)` returns the tile with the most room within 60 by water.
  - `cruiseWaypoints(grid, from, seed, cls, sig)` returns 1-3 hashed tiles with clearance 2 or more, 6 or more apart,
    visited nearest first.
  - `cruiseLane(grid, from, waypoints, opts)` returns a loop route whose first tile is `from`. Each leg starts the way
    the last one arrived, and the final leg may not arrive the way the tour left (`notIn`), so no tile turns back on
    itself.
  - `waterReach` is the breadth-first search under the last two.
- **The sailing line.** `waterGeometry(route, minC)`, `waterPoint(g, S)` (`x`, `z`, `h` and `c`, the least
  clearance of that piece, for the keep-to-starboard offset), `g.tileS`, `g.decks` and `g.stopS`.
  - **String-pulling** joins two tile centres when four conditions hold:
    - the straight touches only route tiles, or tiles whose room bound is the class's clearance;
    - the steps between the two centres never go both ways along an axis;
    - the straight turns no more than square from the way in;
    - the next step does not turn back against it.

    The first rule keeps the line on clear water. The other three stop a shortcut from cutting off a detour or a
    turn-round, and stop it from making a hairpin.
  - **Fixed points.** Decks, the tiles either side of them, and stop rows stay as vertices. So a deck is crossed
    straight across, and `g.decks[i].s0`/`s1` (the arclengths where the line enters and leaves the deck tile) are
    exact. `seed` is the bascule's lift seed.
  - **Corners** are rounded with radius `min(0.45 × room, 1.5)`. The radius is capped so the arc fits in half of
    each straight, and halved until the arc stays on clear water. A loop's seam, at its first tile, is left
    unrounded.
- **For B5.** A ferry route needs `room` and `bridges` too. `railGeometry` can hand a `water` route to
  `waterGeometry(route, 2)`. `stops` rows are kept straight, and `stopS` is each row's middle.
- **Measured.**
  - **London.** The whole Thames, from the south-west margin to the estuary: 456 tiles under 18 bridges for a
    narrowboat, in 22 ms with a cold grid. The river bus takes 13 ms and clears every bridge. A trawler is refused
    at the first stone arch.
  - **The check world.** Its 12 lanes take 22 ms cold, and one lane takes 1-15 ms.
- **`boats-check.ts` (the B1 sections).**
  - **Clearance:** the cache equals the counted values, 1, 2, 2, 1 across the river, and the same under a deck.
  - **Bridges:** the channels and the step rules for boats (across) and cars (along).
  - **Signatures:** air drafts against the table.
  - **Lanes:** 12 cases, each checked on its tiles, joints, room digits, decks (channel, across, cleared) and bascule
    lift count. Each must be the same lane from a fresh grid and from the client's mirrored tiles, and each refusal
    must name the right bridge or narrows.
  - **Sailing lines,** sampled every 0.05 tiles: continuous, on route tiles or clear water of the class, straight
    across each deck inside its arclengths, no sharp turn except at a loop's seam, and ending on the last centre.
  - **The rest:** open water against a 300-tile lake, the lake's fishing grounds, and four cruise tours. A girder
    built across the river cuts the trawler lane after `invalidate`, the same as a fresh grid, and taking it away
    gives back the identical lane. A tiny node budget gives `why: 'far'`.

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

### 4.1 Built: B3, boat types and the schedule (2026-10-18)

Section 4 and section 6.1 are built in `shared/src/boats.ts` (pure, shared), with `basculeLifts(seed, day)` added to
`bridges.ts` (`basculeLiftAt` now reads it; the lifts are unchanged). Nothing calls it yet: B4 (server), B6 (render) and
B8 (scenarios) do. Checked by the B3 sections of `packages/shared/scripts/boats-check.ts`.

- **What the schedule reads.** A list of `BoatHarbour`s, which the `harbours` message carries:
  - `{ id, kind, x, y, name?, active, berths: Berth[], lanes: BoatLane[] }`.
  - A `Berth` is in world space: `{ x, z, h, maxLen, alongside, tug? }`. `harbourBerths(p)` builds the list from a
    placed harbour, using B2's `placedBerths`. A slot labelled `'tug'` is the port's tug berth. B2's cargo port has no
    such slot yet, so until it gets one, real ports have no tug and no escorts.
  - A `BoatLane` is B1's `WaterLane` plus `gate?`, the name of the sea gate its far end leaves by. Every lane of a
    harbour starts at one fairway tile (B4 picks it from `fairwayTiles`, the middle one, say). The manoeuvres run from
    each berth to that tile.
  - The kinds' roles come from B2's `HARBOUR_OF[kind].role`, and `HARBOUR_BOATS` is keyed by role.
  - The caches are keyed by object (`WeakMap`), so treat a list as immutable: a change makes a new array, and a changed
    harbour is a new object.
- **Lanes (for B4).**
  - `harbourLaneSpecs(kind)` lists the lanes a kind wants: one per purpose, class and signature of its types. A marina
    wants 3 cruises, a jetty 2, a fishing harbour 1 grounds lane. A port wants 5: `sea` for open/16, river/16, river/15
    and river/14, and `river` for river/15.
  - `deriveHarbourLanes(grid, { kind, fairway, entry?, seed, gates })` derives them and refuses with a reason ("no sea
    route for container ships and ro-ro ferries: the steel girder bridge at (85, 21) is too low").
  - `sea` and `grounds` lanes run to the nearest gate that is not low, and `river` lanes to a low gate. A procedural
    world passes its offing as a gate.
  - Grounds that cannot reach a gate fall back to `fishingGrounds`.
- **Fleets.** `harbourFleet(h)` returns `BasedBoat { id, harbour, berth, type, seed }`, from the harbour's id, berths
  and lanes:
  - a jetty: 1-2 dinghies or a motor cruiser;
  - a marina: 6-10 boats, by weight cruisers 36, sailboats 30, narrowboats 20 (only where the narrow cruise's median
    room is 2 or less), dinghies 9 and sailing barges 5;
  - a fishing harbour: a trawler per berth that fits;
  - a cargo port: its tug, on the berth flagged `tug`.

  A type is based only where it has a lane and a berth long enough. The ids are stable and under 2^31.
- **`boatTimetable(hs, day)`** returns `{ voyages, byBoat }`, cached by `harboursKey` and day. A `Voyage` has:
  - `{ id, day, kind, boat, type, seed, harbour, berth, lane, v, segs, tStart, tEnd, lifts, escorts? }`;
  - `kind`: `'cruise' | 'fishing' | 'call' | 'escort' | 'lift'`;
  - `segs`: curve, lane, hold, pivot and trawl pieces end to end.
- **The voyages.**
  - **Pleasure.** 0-2 trips a day, more at the weekend, leaving between 08:00 and 18:30.
    - Durations by type are those of section 6.1. Speed is ±8% per trip, and a sailboat motors on 30% of its trips.
    - A trip is whole laps of the cruise loop when they come within half of the wanted time. Otherwise it is out and
      back: it pivots on the lane, and the starboard offset swings it through a half circle.
  - **Fishing.**
    - A trawler leaves between 04:06 and 06:00, Monday to Saturday.
    - It fishes 4-8 h, aiming to be home between 12:00 and 17:00. It trawls a racetrack sized to the grounds' room,
      at 0.06 tiles a tick, then pivots.
    - Grounds beyond a gate are out of sight: `boatsAt` leaves the trawler out, and `boatVoyageAt` still finds it.
    - It lies an hour `alongside` at its own berth to land the catch.
  - **Port calls.** Per day: container ships 1-3 (berthing 07:00-15:00, alongside 4-10 h), coasters 0-2, ro-pax 1-2
    (1 h alongside), barges 1-3.
    - A call takes the first of its type's lanes that gets it in and out within the day. A barge tries the `river` lane
      first, then `sea`.
    - It berths at a free berth of the smallest size that takes it, so the small fry never block the big berth.
  - **Escorts.** The port's tug meets each container ship `TUG_MEET` (8) lane tiles out. It turns, waits, leads the
    ship in at the ship's speed, and goes back to its berth. An escort is skipped when the tug is busy or it would have
    to leave before 04:00.
  - **Lift barges.** A lift that no tall boat is booked into gets a `sailingBarge` passage on a lane through the span.
    The barge fades in `LIFT_BARGE_RUN` (8) tiles short of the span and out as far beyond it, with its middle over the
    deck at the middle of the open window.
- **Booking.** Candidates are booked in time order, and a clash pushes a voyage back in `BOAT_SLOT` (10-tick) slots, up
  to 36 times.
  - **The day.** A voyage of day d runs within 04:00 on day d to 04:00 on day d + 1 (`BOAT_DAY_FROM`/`BOAT_DAY_TO`).
    Days never share a berth or a lift, so each day is generated alone.
  - **Berths.** A visitor reserves its berth from `BERTH_MARGIN` (10) ticks before its berthing curve to 10 after its
    last unberthing curve. A based boat's berth is its own.
  - **Bascules.**
    - A tall boat (air draft of 0.20 or more) passes only while `basculeOpen` is 1. One boat is in the span at a time,
      with `LIFT_GAP` (3 ticks) between boats.
    - Each lane run checks a lift at speed first. Otherwise the boat holds `WAIT_GAP` (1 tile) short, in phase
      `waiting`, then starts from rest to meet the earliest lift that fits within 4 h.
    - When the first lift a voyage meets makes it wait, the departure is pushed back by the whole slots of that wait,
      so the boat waits at its berth instead.
    - After planning, the passages are measured again from the segments (`liftPasses`). A voyage whose hull is over a
      deck outside a fully open lift is cancelled, never sailed.
    - A tall pleasure boat that gets no lift turns short of the first bascule instead; any other voyage does not sail.
- **Motion.**
  - **Berthing.** Manoeuvres are Dubins paths (two turns and a straight) of radius `0.3 + 0.35 × length` (0.3 to 1.5),
    so the heading never jumps. A bow-in berth is left straight astern, and so is an alongside berth with the lane
    behind it; the boat then goes ahead. Berthing is always bow first.
  - **Speeds.** A boat leaves at `0.4 × v` and speeds up to 0.7 v on a long way out to the fairway. On the lane it ramps
    over 1.2 tiles.
  - **Keeping to starboard** is in the schedule, not only the render: `boatsAt` positions include it, so the renderer
    must not add it again. `laneOffset(g, S)` averages each piece's `starboardOffset(c)` over a tile of line, so the
    offset has no step where the clearance changes, and fades it to 0 over 1.5 tiles at the lane ends, where the
    curves join.
- **`boatsAt(hs, tick, out?)`** returns every boat on the water: voyages of days d − 1 and d, and every based boat lying
  at home (`mooredState`). A `BoatState` is:
  - `{ id, voyage, type, seed, harbour, berth, phase, x, z, h, speed, astern, fade, lane, s, dir, lights }`;
  - `phase`: moored, unberthing, underway, fishing, waiting, berthing or alongside;
  - `lights`: `nav`, `anchor` (30% of moored boats), `trawling`, `deck` and `accommodation`.

  Heave amplitude is `BOAT_TYPES[type].heave`; roll and pitch phases come from `seed`. One call takes about 5 µs
  on the check world.
- **Events (for B4).**
  - `voyageEvents(v)` and `boatEvents(hs, day)` give `castOff`, `gateOut`, `gateIn`, `fishing`, `fished`, `berthed`,
    `alongside` (calls only) and `lift`. Walk days d − 1 and d, because a day's events run on to 04:00.
  - `catchOf(v)` gives 20-60 boxes, from `hoursFished` and the seed. It is landed at a fishing voyage's `berthed`.
  - `callCargo(v)` gives `{ imports, exportRoom, passengers, vehicles }`. A ro-pax call has 80-300 passengers for
    `shipBerthed`.
  - `boatLifts(hs, day)` gives the passages booked per span seed.
- **Names (fictional).**
  - `boatName(type, seed)`: "Kittiwake", "Morning Star", "Sea Breeze II"; "Pride of Saltmere" for a ro-pax, "Meridian
    Endeavour" for a container ship, "Riverway 12" for a barge, "Samson II" for a tug.
  - `boatOperator` and `BOAT_OPERATORS`: container lines (navy, red, green, grey), ferry, coaster, lighterage and towage
    firms, each with hull and funnel colours.
  - `boatOwner(type, seed, harbourName?)`: a private owner, "X Boat Hire", "Surname & Sons" or "Fishbourne Fishing
    Co.", or a sailing barge trust.
  - `fishingReg(name, id, seed)`: "FS 127".
  - `boatCrew(type, seed, voyage?)`: a skipper or master and the hands the type needs, guests on pleasure boats, and a
    pier hand on a river bus.
- **Not done here.**
  - River buses are B5's ferry lines.
  - Police and fire launches have specs but are not scheduled.
  - There are no visiting yachts at marinas, and `through` lanes are not used yet.
  - Hull corners over water in a real footprint are checked once B2's harbours exist (B4/B8).
- **For B6.**
  - Draw `boatsAt` as it is (offset included). Use `astern` for the wake.
  - Hide the landmark's decorative barge on any span that `boatLifts` lists that day: such a span gets a voyage in
    every lift.
  - Paint ships by `boatOperator(...).hull`/`funnel`.
- **For B8.** Every `BoatType` but `riverBus` (B5), `policeLaunch` and `fireBoat` is scheduled by a harbour of its kind.
  "A tall boat through a lift" is a `boatLifts` entry whose voyage `kind` is not `'lift'`.
- **Measured (the check world, 7 days from a Wednesday).**
  - **Voyages.** 48 cruises, 30 fishing trips, 25 port calls, 8 tug escorts and 7 lift barges.
  - **Bascule.** 17 passages in 15 lifts; 13 voyages waited at the bridge.
  - **Cost.** About 10 ms a day to generate; the harbours' 12 lanes derive in 35 ms cold.
- **`boats-check.ts` (the B3 sections).**
  - **Harbours.** Five: a marina between the suspension bridge and the bascule, a cargo port on the basin, a fishing
    harbour on the basin and one on the lake, and a jetty on the lake.
    - Their lanes are derived on the server's tiles and on the client's, and must be identical. Each lane passes B1's
      lane checks.
  - **Fleets.** Each boat has its own berth and a lane, and the fleets agree on the wire's copy.
    - `harbourBerths` equals `placedBerths` for every kind in all four turns.
    - Fleets on B2's own slots: the jetty has a dinghy, the marina 7 boats on its ten 0.65 bow-in slots, and the
      fishing harbour 3 trawlers.
  - **A week of timetables.** The same on a second derivation, from the wire's JSON copy, and from the client's
    harbours. Every voyage runs within 04:00 to 04:00, and its segments are end to end.
    - Every lift passage lies inside a scheduled lift's hold, with the leaves at 1. Two boats never use one span at
      once.
    - No trawler sails on a Sunday, and the catches and cargo are in range.
  - **Every half tick of the week.**
    - No two boats are in one berth.
    - No boat's hull is over a deck it cannot clear, unless the deck is a bascule standing fully open.
    - No boat steps further than 1.6 × its speed, or swings more than 0.5 rad.
    - `boatsAt` cold (caches cleared, harbours from JSON) equals stepping, at 40 ticks.

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
| **cargo port** (28) | 8×6, 1, `[3, 5]` | 5-tile big berth, 2.4-tile small berth and a tug berth on row 0; 2 gantry cranes on the quay; truck gate in front | open, and the body reaches a sea gate | Seaport | $14,000, $200 | 70: dockers and crane drivers (06:00, 14:00, 22:00) | the `'sea'` gateway: `gateway: 'sea'`, `gatewayModes: ['foot', 'taxi']`, `arrivalsPerHour: 6`, `needsWater: true`; ship calls; imports and exports (6.4) |

**Tech**, in `tech.ts`:

| Node | Tier | Requires | Condition | Cost | Unlocks |
| --- | --- | --- | --- | --- | --- |
| `tr10` Harbours | 4 | `tr8` Civil engineering | 250 housed | $1,800 | jetty, marina, fishing harbour |
| `tr11` River buses | 6 | `tr5` and `tr10` | 250 jobs | $2,500 | the ferry pier and `'ferry'` lines |
| `tr12` Seaport | 7 | `tr10` and `zon2` | 500 jobs | $9,000 | the cargo port |

Kinds stay `draft: true` until the scenario subtask places them, because `demo:check` fails any placeable kind that the
showcase does not place.

### Built: B2, harbour kinds and wet footprints (2026-10-18)

- **Kinds.** `shared/src/buildings/harbour.ts` holds the five kinds, ids 24-28, all `draft: true`, with the footprints,
  staff, numbers and attributes of the table above and one placeholder design each. They form a draft size ladder,
  **Harbours** (`group: 'harbour'`, `draft: true` in `groups.ts`): jetty 1, ferry pier 2, marina 3, fishing harbour 4,
  cargo port 5. So the tool bar shows one Harbours button with a picker (with `?dev`), and `buildings:check` holds the
  numbers to the ladder rules: staff, cost and build work never shrink up it. Tool ids are `jetty`, `marina`,
  `fishharbour`, `ferrypier` and `cargoport`, with no shortcut keys.
- **Attributes.** Each kind has `harbour` (`jetty`, `marina`, `fishing`, `pier` or `port`), and the marina has
  `berthFee: 4`. The cargo port carries `gateway: 'sea'`, `gatewayModes`, `arrivalsPerHour: 6` and `needsWater`, so
  `GATEWAY_OF[28]` exists now. The server opens it like any staffed gate until B4 adds the sea-route condition.
- **Footprints.** `Footprint.wet` (1 to h - 1) and `Footprint.fairwayClearance` (1 narrow, 2 river, 3 open) are in
  `schema.ts`. They are validated, copied into the manifest's footprint, and read through `WET_OF[kindId]` in
  `structures.ts`.
- **Placement.** `checkPlaced` hands wet kinds to `checkWet`:
  - the wet rows must be water with no road and no aux byte;
  - the other rows must be dry and clear, as before;
  - every footprint tile must be on land the player may use.
  - The quay then has water behind every tile.
  - **The fairway.** Read literally, "clearance c along its whole width" can never hold for a row touching the
    harbour, because the harbour's own wet tiles become land. So placement asks for a band of
    `fairwayDepth(c) = 2c - 1` rows of open water (`isOpenWaterTile`: water with no aux byte, or a bridge deck) behind
    the whole back edge: 1 row for narrow water, 3 for river, 5 for open. The band's row c - 1 then has clearance c or
    more once the harbour stands. The fairway is public water, so there is no land rule.
  - Automatic facing needs no change: only a side with water behind passes. The refusals read "A marina's back 2 rows
    must stand on open water, the front on the bank", "... must stand on dry land ..." and "A fishing harbour needs
    river water behind it: 3 rows of open water along its whole back edge".
- **Geometry helpers** (`structures.ts`):
  - `footprintTile(p, lx, ly)` and its inverse `footprintLocal(p, x, y)`: ly 0 is the back row, and ly -1 is the row
    behind it;
  - `footprintPoint(p, px, py)`, in mark and berth units (`placedMarks` now uses it);
  - `isWetTile`, `quayTiles` and `fairwayTiles(p, row)`.
- **Berths.** `BerthSlot` and `HARBOUR_BERTHS` are in `harbour.ts`, in footprint units (x 0..w, y 0..h, y = h the front):
  - the jetty has 2 slots, either side of the planks;
  - the marina has 10 bow-in slots, A1-A5 and B1-B5, either side of the spine;
  - the fishing harbour has 3 trawler slots along the quay;
  - the ferry pier has one 2-tile slot at y = -0.5, the row outside;
  - the cargo port has a big berth (5 tiles) and a small one (3).

  `shared/src/harbours.ts` (exported from the index) gives `HARBOUR_OF[kindId]` (`role`, `wet`, `fairwayClearance`,
  `berths`), `HARBOUR_KIND[role]`, `isHarbourId` and `placedBerths(p)`. `placedBerths` returns the world centre, the
  bow's `dir` (FRONT index) and `angle`, `len` and `mode` of each berth, and its `fairway` tile: the tile just behind
  the back edge at the berth's column.
- **Marks.** `MarkKind` gains `'quay'` (pale stone) and `'berth'` (blue). The preview shows each kind's berths as a band
  over the wet rows, its quay tiles, and the pier's berth line on its back edge.
- **Water stays water.** These parts already kept the terrain bits:
  - `World.placeStructure`;
  - the mirroring in `structureWrite`;
  - `removeStructure`.

  `net.ts` now lets the bulldozer reach a wet structure tile, which used to be skipped as water, so bulldozing a harbour
  by any tile leaves open water. `chunkView` draws water, not paving or dirt, under a structure tile whose terrain is
  water, and `mapByte` reads such a tile as water.
- **Tech.** `tr10` Harbours, `tr11` River buses and `tr12` Seaport are as tabled. `tr11` also unlocks the feature
  `'ferry'`, for B5's lines.
- **Checks.** `buildings:check` has a "harbours" section. For every kind and rotation it checks:
  - the refusals: a dry back row, a deck or another structure on a wet row, a wet quay, a narrow fairway, a pontoon in
    the fairway, and a wet tile on someone else's land;
  - what is allowed: a bridge deck in the fairway, and the fairway on public water;
  - that automatic facing turns the harbour's back to the water;
  - that the tile helpers round-trip;
  - the quay and fairway geometry;
  - that every berth lies on the water within the footprint's width;
  - the map byte.

  The footprint and ladder sections paint each kind's water before they test it.
- **Live test.** The worktree server and Vite placed all five by the build message, on seed 4242's shore near
  (124, -93), facing automatically. The wet tiles kept their water; the sites, then the finished models, drew over it.
  Bulldozing the marina and the jetty by a wet tile gave open water back, with no aux or sub bytes.
- **For B7.** Only `harbour.ts` designs change. Recipe z runs from -h/2 at the back, so the wet rows are z < -h/2 + wet.
  The water surface is y = 0. Keep the berths clear of the models. The viewer's turntable shows no water under the wet
  rows.
- **For B8.** Drop `draft` on the five kinds and on the `harbour` group.

### Built: B7, harbour models (2026-10-18)

Two designs per kind in `buildings/harbour.ts` (the kinds stay drafts), and channel-aware piers in `render/bridges.ts`.
No kind data, berth or footprint changed.

- **The designs.** A tile picks one of a kind's two by hash.

| Kind | Design 1 | Design 2 |
| --- | --- | --- |
| jetty | timber jetty on piles: boathouse, slipway, ladder, cleats, lifebuoy, lamp | floating hire pontoon on a hinged gangway: tackle hut with an awning, racked dinghies, flagstaff |
| marina | harbourmaster's office with lookout and balcony, café with tables, car park, fuel dock | sailing club with a verandah over the water, rigged dinghy park, boat hoist over a yacht, timber pontoons |
| fishing harbour | open auction canopy, market hall, ice plant and pipe, derrick, nets, floats, gulls | harbour arms with a striped lighthouse, tarred net lofts, smokehouse, café, stalls, a boat hauled out |
| ferry pier | covered floating pontoon with a folded-plate canopy, kiosk and two roundel signs | timber pier head on piles with a cast-iron pavilion and lantern, trestle bridge, clock-turret office |
| cargo port | two gantry cranes with stays, stacks, straddle carriers, lorries, control tower, transit shed | two slewing harbour cranes, grain silos and gallery, sawtooth warehouses, log piles, rail siding |

- **What stays clear.**
  - Wet rows hold only what a berth allows: pontoon and jetty decks inside |x| < 0.12, quay walls and fenders, mooring
    piles in the gaps between berths, the fishing harbour's two arms outside the trawler slots, and the marina's
    fingers and fuel dock outside the ten bow-in slots.
  - The ferry pier's geometry ends at z = -1.0, so its berth row stays open.
  - Crane booms, trolleys and jibs stay above 1.1, over any ship.
  - A check (`buildings:check` "footprints") already keeps every part inside the footprint.
  - The cargo port's small berth is 2.4 tiles (the 2-tile coaster and 1.6-tile ro-pax fit), with a 0.5-tile `'tug'` berth in
    the freed end (x 7.45-7.95) for the container ships' escorts.
- **Helpers.** `gull`, `lifebuoy`, `lamp`, `car`, `bench`, `dinghy`, `fenders`, `roundel`, `stack`, `lorry`, `straddle`
  and `gantry` are local to the file. A `taper` with `shift` draws the leaning stays and jibs.
- **Night.** Lamp heads, the cranes' warning lights and the lighthouse lantern use window classes, so they light after
  dark; windowed boxes carry facades and pass the window-collision check.
- **Bridges.** `bridges.ts` has `channelOf(L)` (the deck stretch boats pass under, matching `bridgeChannel`) and
  `clearOfChannel`:
  - arches and girders never put a pier in the channel: a pier that falls in it moves to the channel's edge on its own
    side, so the channel is one clear span, and a pier that would crowd another goes;
  - an arch's widest span is then over the channel, its crown at 0.12 or more;
  - a girder's plates are capped so their underside stays above `BRIDGE_CLEARANCE`;
  - a suspension span's towers and caissons keep out of the channel, and on a span too short for that the caisson is
    only two footings.
  Checked on spans of 1 to 9 tiles with a channel marker drawn under each deck.

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

### Built: B5, ferries (2026-10-18)

- **Mode and stops.** `TransitMode` has `'ferry'` and `STOP_KINDS[27] = 'ferry'` (`shared/src/transit.ts`). A line names
  its piers by their doors, as rail names stations.
- **The stop** (`shared/src/ferry.ts` `pierStop`, `ferryStop`, `pierAt`, `pierBuilt`). The stop row is the 2-tile berth
  (`fairwayTiles(p, 0)`) plus one tile of open water beyond each end, so it is 4 tiles long, as a `StationStop` with
  `len` 4. Every tile must be open water with no deck, or the pier says why ("needs open water beyond each end of its
  berth for the boats to come alongside"). The end tiles matter: a boat that came in across the row's end would lie on
  the rounded corner, and with them the hull of a boat at either berth position lies on the straight.
- **The route** (`routeWater(def, grid, env)`). Both ways through the first pier are tried, and the cheaper is kept.
  - Each leg is a `waterLane` for `cls: 'river'` and `FERRY_SIG` (`passSig(0.10, false)`, every style closed). It runs
    from the end of one stop row to either end of the next.
  - A loop's closing leg goes back into the first row's first tile.
  - The lane search runs on a `BerthGrid` wrapper of the grid, which counts every stop row's end tiles as wide enough
    (they lie beside the bank, clearance 1) and its berth tiles as land. So a leg reaches a row only at an end, from
    outside, and never through a berth.
  - A refusal names the two piers and the lane's reason: "the piers at (x, y) and (x, y) are not joined by water a river
    bus can sail: the water is too narrow at (x, y)".
  - Water is shared, so a route may cross itself and other lines.
  - The result is a `RailRoute` with `water: true`, `room` and `bridges` (new optional fields on `RailRoute`).
- **Timing** (`rail.ts`).
  - `RailLineDef.ferry` is set, with `FERRY_TIMING` as designed.
  - `RailVehicle.RiverBus` (9) is a "river bus", 0.95 long. `consistKinds` gives one.
  - `RailService.ferry` is set. `stationDwell` takes `ferry`.
  - A there-and-back line spaces its boats on the unfolded ring, as the metro does. The `railService` cache key gains
    `f`.
  - Each call stands at `stopS ± FERRY_BERTH_OFF` (0.5) in the way the boat is going. At the ends of a there-and-back
    line it is where it came in: -0.5 at the first pier and +0.5 at the last. So the dwell and run pieces join up.
  - `railGeometry` hands a `water` route to `waterGeometry(route, 2)`. `RailGeometry.water` keeps it, and `railPoint`
    follows `waterPoint`. `geom.s` holds approximate tile-entry arclengths.
  - **A correction to waterGeometry's `stopS`.** It is computed from the row's first tile. That tile is a rounded corner
    when a boat comes in across the row's end, so its `tileS` is the arc's middle and not the tile's centre, which
    put the stop 0.11 off. `railGeometry` takes each stop row's middle from its second tile instead, which is always a
    straight vertex. Lanes without stops are unaffected.
  - Non-ferry lines are unchanged: rail-check and metro-check print byte-identical output before and after.
- **`server/src/sim/ferry.ts`, `Ferry extends Timetabled`** (mode `'ferry'`). It is registered in `game.ts` after the metro,
  with `sandbox`, so local mode has it too.
  - **Routes** are cached per line shape with a hash of the water they were found on. The hash covers every route tile
    with its 4 neighbours (tile word and aux byte) and the piers' doors.
    - Re-deriving every 10 ticks costs a few thousand tile reads.
    - A changed hash, or a new game day, reads the water into a fresh `WaterGrid` and searches again.
    - A refusal is retried after 50 ticks.
  - **The grid's terrain fallback.** It reads `World.peekTile` and falls back to the terrain sampler, so water in a
    chunk nobody has generated is still water.
  - **`route`** refuses a pier that is not the owner's (outside a sandbox), and a pier another ferry line calls at: "The
    pier at (x, y) already serves line 1; build another pier for this line".
  - **`plan`** is the editor's preview: the lap, `lapTicks` and `LinePreview.sail`, the sailing line sampled every
    0.25 tiles (`sailPoints`).
  - **`commit`** applies the cap of 24 lines an owner, and requires the `'ferry'` feature (River buses), except in a
    sandbox or with dev funds.
  - **Riders.** `capacity` is 120 places a boat. `rideTicks` adds `FERRY.access` (2 ticks for the gangway).
    `waitSpot` is `pontoonSpot`: a hashed spot of each rider's own on the pier's wet row.
  - **`describeStation`** answers `BuildingInfo.ferry`, in the `MetroStationInfo` shape. `track` is the berth's state,
    `platform` is the stop row's end tiles, and it lists the lines with their next boat and where to change.
  - **`describeTrain`** answers `inspectTrain`: "alongside at …", "sailing to …", and the riders.
- **Wire.**
  - `{ t: 'ferryLines', lines: FerryLineDTO[] }` (`RailLineDTO` plus `names`) is sent on hello and when `changed`, as
    `metroLines` is.
  - `net.ts` routes `inspectTrain` to the ferry after rail and the metro, fills `BuildingInfo.ferry` for kind 27, and
    toasts a ferry save ("… saved: 2 piers, 4 boats asked for").
- **Client.**
  - The Lines panel has a ferry mode: the first pier clicked picks it, and the tool asks for River buses.
  - The panel has a name field, up to 8 boats and 12 piers, and its own hint.
  - The draft is drawn along `preview.sail`, and saved ferry lines along `sailPoints` of their routes (from
    `ferryLines`, `LinesPanel.setFerryLines`).
  - The pier tooltip is `metroStationHtml(info, row, true)`, which reads "River bus", "Berth" and "a boat every N min".
  - `main.ts` keeps the DTOs in `ferryMeta` (also `window.msc.ferryMeta`).
- **Crews.** `shared/src/crews.ts` `ferryCrew(lineId, boat, tick)` gives a master, a mate and one or two deckhands
  (sometimes a trainee mate), on a train crew's turns.
- **Showcase.** `LINE_MODES.ferry` is `true`. The existing draft skip in `showcaseProblems` passes over it while the pier
  is a draft, so the type did not need to widen. `LINE_CAPTIONS.ferry` is a first draft. A ferry `DemoLine`'s stops
  must be `ferry-pier` placements.
- **Load test.** `npx tsx packages/server/src/loadtest/ferry.ts [--districts 3] [--hours 24] [--off] [--no-fill]
  [--save path]`.
  - **The city.** A 3×3 seedCity whose middle row of districts is a lake 24 tiles across. Only a causeway at the west
    edge joins the two shores by land, because a commute needs a walk to work.
  - **The piers** stand on the bank between the lake and the first street. They are placed with the tool, and the lines
    are previewed and saved through `Net.handle`.
  - **The lines.** Line 1 is a loop of 4 piers (158 tiles, 8 boats every 36 min). Line 2 runs there and back across
    the middle (58 tiles, 4 boats every 30 min).
  - **The feeders.** Buses in the two middle districts end at stops on the bank, 4 tiles from line 2's piers.
  - **The commuters.** Half the workers of each shore district then work across the water.
  - **Measured over a day** (46 checks pass):
    - `Ferry.tick` costs 0.06 to 0.07 ms a tick;
    - every pier has exactly the timetable's calls;
    - riders board and alight on both lines;
    - 39 trips went by river bus, 36 of them changing to or from a bus;
    - every ferry rider waiting stood on a pontoon;
    - nobody overstayed a wait or rode a boat that was not running;
    - a bulldozed pier grounds its line.
  - **Ridership** is small because the test city's commutes mostly drive, as in the metro test.
  - **`--save path`** writes the city once line 1 is saved and stops. That is a test city for a server
    (`CITY_DISTRICTS=3 WORLD_FILE=path`), which gave the Lines editor screenshot of line 2's draft.
- **For B6.**
  - Run each `FerryLineDTO` with `railService(dto, dto.route)` and `trainsAt(svc, tick)`.
  - `trainPoses` gives the one hull, kind 9, between bogie points 0.3 either side, so it follows the sailing line.
  - `svc.geom.water` is the `WaterGeometry`: `decks` for the bridges, and `waterPoint(...).c` for the keep-to-starboard
    offset.
  - Vehicle ids are `trainVehicleId(line, boat)`, and the panel comes from `inspectTrain`.
  - Add `boats.setFerryLines(m.lines)` in `main.ts`'s `ferryLines` handler.
  - No loads message exists yet, unlike `metroLoads`.
- **For B8.**
  - Place piers whose berth row and one tile beyond each end are open water, on river-class water (a 4-wide river
    leaves clearance 2 in the row beyond the berth).
  - Save ferry lines (`mode: 'ferry'`, pier doors as stops).
  - Register a `Ferry` in the demo seeder and `demo/check.ts` where they build their own services, as for the metro.
  - Refine `LINE_CAPTIONS.ferry`.

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

### 6.6 Built: B4, server harbours (2026-10-18)

Sections 2.2 (derivation), 2.3 (sea gates) and 6.3-6.5 are built in `server/src/sim/harbours.ts` (`Harbours`, owned by
`game.ts` beside `Airports`). Checked by the B4 section of `boats-check.ts` and by `server/src/loadtest/boats.ts`.

- **The list.** Every finished harbour kind (ids 24-28, level 1 or more) is a `HarbourDTO` (`protocol.ts`): B3's
  `BoatHarbour` plus `r`, `door`, `owner`, `fairway` and `refused?`.
  - `id` is `harbourId(ax, ay)`, stable and under 2^31. `x, y` is the anchor. `active` is "has staff on the books".
  - `name` is the stop name given to the door (`World.stopNames`, so B8 can name London's), else a generated
    "Okafor Marina", "Chen Harbour", "Zhang Docks", "Mahmood Jetty" or "Flores Pier".
  - `berths` is `harbourBerths(p)`.
  - Ferry piers are listed too, with no lanes and no boats: their river buses are B5's.
- **The fairway.** Every lane starts at one tile: behind the middle column, on row `c - 1` out, where `c` is the widest
  class any of the kind's lanes needs (a marina's sailboats need river water, so row 1; a port's ships row 2). If that
  tile is too narrow, a nearer row is used, down to row 0, and the wider lanes are refused with the reason. `entry` is
  the side facing the harbour, so a boat leaving heads out.
- **When lanes are derived.**
  - A scan every 10 ticks reads the built harbours. It re-derives when a harbour is built or removed, or its staffing,
    owner or name changes (the lanes are cached per kind, anchor and rotation, so a staffing change derives nothing).
  - It also re-derives when a water tile's navigability changes. `World.onTileChanged` is chained: a water tile that
    reads differently to boats (open, a deck of some style, or blocked) invalidates the `WaterGrid` there and marks
    every derivation stale. A harbour's wet tiles changing as it is built or levels up are not edits. The first change
    seen at a tile counts as one, because the harbours did not watch it being placed.
  - A daily sweep clears the grid and marks every derivation stale.
  - Stale harbours are re-derived for 8 ms a scan (`DERIVE_BUDGET_MS`), and the rest keep their lanes for one more
    scan. A new harbour is always derived at once.
  - Water turned into land is not reported by the hook (no tool does it yet); a fill tool calls
    `harbours.waterFilled(x, y)`.
- **A new list only on change.** Each derivation builds new objects. If the JSON is the same as the last list, the old
  list is kept, so B3's caches stay warm. Otherwise `list` is a new array and `changed` is set.
- **Sea gates.**
  - `World.seaGates: SeaGate[]` is new. It is persisted as an optional snapshot field `seaGates` (no format bump) and
    is empty in a procedural world. B8's seeder writes it.
  - With declared gates, every harbour derives against them.
  - Without any, each harbour fills from its fairway (`openWater`). Open water (1,500 tiles or more) gives an offing,
    passed as a gate named `the open sea` (`OFFING_NAME`). Each harbour's fill starts at its own fairway, so two
    harbours on one lake may have different offings with the same name.
  - A smaller lake has no gate. Trawlers then fish its roomiest water, and a port there has no sea lanes.
- **The cargo port as a gateway.**
  - `Gateways.seaRoute(x, y)` (set by `Harbours`) is checked in `refresh`. A `'sea'` gate opens only while the port is
    staffed and has a `sea` lane to a gate.
  - `Gateways.shipBerthed(x, y, passengers)` is `planeLanded`'s twin. A ro-pax `alongside` event calls it with 80-300
    passengers, and 8% of them are newcomers.
  - The gateway tooltip says "closed: no staff yet, or no sea route".
- **The port is refused on a small lake.** `net.ts` `placeStructure` asks `harbours.placeProblem(placed)`. In a world
  with no declared gates, a port whose fairway water is not open is refused: "A cargo port needs open water that
  reaches the sea: this lake is 300 tiles". A port in a declared-gate world is never refused there; its panel shows
  the lane refusal instead.
- **Events.** Each tick walks `boatEvents` of days d - 1 and d, between the last tick and this one. The clock is
  `w.day * TICKS_PER_DAY + tick % TICKS_PER_DAY`, the same as `Airports.flightTick` and the clients. The events are
  cached per `harboursKey` and day. They are walked from start-up on; events before a restart are not replayed.
  - `berthed` of a fishing voyage lands `catchOf(v)` boxes on the harbour's quay.
  - `alongside` of a call lands `callCargo(v).imports` containers in the port's import queue (at most 240), with port
    dues of $5 a box to the owner from outside. A ro-pax call also brings passengers (`shipBerthed`).
  - `castOff` of a call takes up to `exportRoom` boxes from the export stack, oldest first, at $5 a box in dues.
- **Lorries** (`Simulation.harbourFreight(b, to, fee)`, a new optional `to` and `fee` on the dispatch job, and
  `Vehicle.fee`).
  - **Fish.** From 05:00 to 20:00, every 20 ticks, each staffed harbour with 10 boxes or more sends a lorry of 10. 75%
    go to the best food venue within 60 tiles (`isFoodVenue`) and the rest to a staffed works. The buyer pays $30 on
    delivery.
  - **Containers.** From 06:00 to 20:00, every 8 ticks, each staffed port sends one container to a shop anywhere in
    town, chosen as a motorway lorry's shop is. The shop pays the port's owner $3.
  - Rail freight's `consign` is asked first for both, as for any works. A consignment that goes by train pays the last
    mile's usual `FREIGHT_FEE`.
  - **Exports.** `Simulation.ports` gives the road in front of each open port as an export point beside the motorway
    entries, and the export roll (`EXPORT_SHARE`) takes the nearest. A truck arriving there puts its box in the port's
    export stack (at most 400; boxes are written off after 1.5 days), and the exporter is paid `FREIGHT_FEE` from
    outside, as at a motorway. Without a motorway, open ports alone are export points.
- **Marina berth fees.** At each day's start, every staffed harbour whose kind has `berthFee` (the marina) pays its
  owner the fee for each boat in `harbourFleet`.
- **Fishing crews** (section 6.3).
  - `crewBoat(citizenId, trawlers)` hash-seeds 20 in 26 of the payroll as crew, each on one trawler; the rest are
    market porters.
  - `inspectBoat` lists a trawler's crew as citizens.
  - `inspectCitizen` adds `atSea: { boat, name }` while the citizen is at `Work` and their trawler is on a fishing
    voyage.
- **Nothing is saved.** Stocks, queues and stacks start empty after a restart, as the gateways' queues do.

**Wire API (for B6 and B8).**

- `{ t: 'harbours', list: HarbourDTO[], gates: SeaGate[] }` is sent on hello and in `flush` whenever `changed`. Each
  message is a new list. Clients call `boatsAt(list, tick)` with `tick = day * TICKS_PER_DAY + dayFrac *
  TICKS_PER_DAY`. `gates` holds the declared gates plus the offings the lanes use.
- `{ t: 'inspectBoat', id }` (read-only, allowed in spectate) is answered by `{ t: 'boat', id, info: BoatInfo | null }`.
  `BoatInfo` is `{ id, harbour, harbourName?, crew?: { id, name }[], landedToday?, cargo?: { imports, exports,
  passengers } }`. It is null for a boat that is neither based nor on a voyage now.
- `BuildingInfo.harbour: HarbourInfo` drives the harbour tooltip (`ui.ts` `harbourHtml`):
  - status, boats based and out, the sea gate or the lake's size, the lanes and refusals;
  - fishing: landed, sold and the stock on the quay;
  - port: calls, containers in and out, the queues, passengers and dues;
  - marina: berth fees.
- `CitizenInfo.atSea` is `{ boat, name }`.
- For B8:
  - write `World.seaGates` in the seeder;
  - name harbours through `stopNames` at the door;
  - `demo:check --run` can read `game.harbours.totals` (landed, sold, calls, imports, importLorries, exports,
    passengers, dues, berthFees, derivations, deriveMs) and `today()`.

**Measured.**

- **`boats-check.ts` (the B4 section).** It places a real jetty, marina, fishing harbour and cargo port on the
  basin's south shore and runs `Harbours` on the server World.
  - All the lanes are derived and pass B1's lane checks, from the fairway and entered from the harbour. The sea and
    grounds lanes leave by the open sea.
  - Re-levelling a wet tile derives nothing and keeps the same list object.
  - Losing staff gives a new list with the harbour inactive; it sails nothing and nothing is derived.
  - A port on the 300-tile lake is refused.
  - The wire's JSON copy gives the same timetable.
  - Two days walked tick by tick match the schedule's own events: 200 boxes landed, 9 calls landing 133 containers,
    94 taken on from a stack of 400, $1,135 in dues and $56 in berth fees, all credited to the owner.
  - After a girder is built over the river and gates are declared, the lanes equal a fresh derivation. The barges then
    come down from the upper river under the new deck, and the estuary replaces the offing.
  - Bulldozing the jetty gives three harbours with fresh-equal lanes.
  - The sea gates survive a save.
  - A derivation takes about 6 ms a harbour.
- **`loadtest/boats.ts --days 2`.**
  - **The city.** 2×2 districts fully built (about 5,000 people), a motorway connection, and a lake of about
    11,000 tiles. On the shore: a jetty, a ferry pier, a marina, 2 fishing harbours and a cargo port, all staffed.
  - **The harbours' own cost.** `harbours.tick` averages 26-29 µs a tick, 0.6-0.7% of the tick. Its worst tick is
    18-26 ms: a scan re-deriving after the daily sweep (at most about 15 ms), or a new day's timetable and events (at
    most about 12 ms). A derivation takes 6-8 ms a harbour. The message is 5 KB.
  - **Whole tick.** With the module disconnected (`--off`), 3.20-3.38 ms a tick. With harbours, 3.61-3.82 ms. With
    harbours but no lorries (`--no-lorries`), 3.67 ms. The runs diverge by their random streams; with the harbours
    the city ends about 100 people bigger (ferry newcomers), and runs on a shared machine vary by about ±5%. So beyond
    the 0.7% the module measures, the difference is mostly a different city, not harbour work.
  - **A day.** 15 voyages: 6 fishing trips, 5 cruises, and a container ship, a coaster, a ro-pax and 1-3 barges.
  - **Two days.** 318 boxes landed and 330 sent to market (33 lorries); 8 ship calls landing 121 containers (121
    lorries to shops); 155 containers taken on from trucks; 245 ro-pax passengers; $1,380 in dues and $48 in berth
    fees. 63 of the 536 newcomers came through the cargo port, the motorway taking the rest. Without the motorway,
    all 294 came through the port.

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

### 7.1 Built: B6, boat rendering (2026-10-18)

Section 7 is built in `client/src/render/boats.ts` (`BoatsView`), `render/boatModels.ts` (the geometry), `boatPanel.ts`
(tooltip, panel and the wheelhouse's `CabEye`) and `render/boatsMock.ts` (dev only). `main.ts` owns the view beside
`helis`. Checked by eye on a scratch lake city, not by a script.

- **Models.** Every `BoatType` has one, built from lofted hulls (`stations`, `hullBand`, `deckFace`) and `Kit` boxes
  and cylinders; the part under the waterline is drawn too, since the ground hides it. Per type there is one
  `InstancedMesh` for each of: `hull` and `accent` (white, tinted per boat), `works` (own colours), `glass` (lit at
  night), each `sails` piece (tinted, with its own pivot), an optional `opt` part (a flybridge, deck cranes) and the
  load variants (`cargo`: the barge's heaps and boxes, the coaster's deck containers, four laden-ness variants of the
  container ship, each box coloured by hash). The sailing barge keeps the landmark's look. `BoatModel` also has the nav
  light positions, the wheelhouse eye and the deck height (`free`, for fenders).
  - 14 types: dinghy, motor cruiser (flybridge on 40%), sailboat (main and jib), narrowboat (lined panels, name board,
    chimney), trawler (wheelhouse, gantry, nets, fish boxes), river bus (catamaran), ro-ro ferry, barge, sailing barge
    (main, topsail, staysail, mizzen), coaster (two deck cranes on 55%), container ship (deckhouse, funnel, mast), tug
    (tyre fenders), police launch and fire boat (unscheduled, but drawn if they appear).
- **Liveries.** Ships, coasters, barges and tugs are painted by `boatOperator(type, seed)` (`hull`, `funnel`); the
  rest by tables per type (dinghy hulls and sails, boot stripes, yacht hulls, narrowboat cabins, trawler hulls). Every
  colour gets hue, saturation and lightness jitter and weathering (`paint`), as the helicopters' do.
- **Organic variation, per boat from its seed:** paint and wear, sail tone, heave period and amplitude, roll and pitch
  phase, where it lies at its berth (lateral and along, and yaw), 2-4 fenders a side in a hashed colour, cabin light
  (warm or pale, and lit at all on only half the small boats), whether a sailboat motors this trip (30%, per voyage),
  a flybridge or cranes, and which load a ship carries.
- **Motion.**
  - Heave is `heave × (sin + 0.35 sin 1.73)` from `BOAT_TYPES[type].heave`; pitch and roll amplitude follow from it and
    the hull's size, a third as much when moored. Underway the bow lifts with speed (`TRIM`), and a motor boat banks into
    a turn (`BANK`, from the smoothed rate of turn, which `BoatsView` keeps per boat).
  - **Sails.** The day's wind is a hash of the day (`windOf`: direction, strength). A sailing boat heels to leeward by
    `HEEL × strength × sin(wind relative to the bow)`, its sails swing out by the same angle (the jib three quarters as far),
    and they hoist and furl over a couple of seconds as the boat leaves and reaches its berth.
  - `boatsAt` already has the keep-to-starboard offset, so the view adds none. A boat at a gate scales to `fade` and
    sinks a little.
- **Wakes.** One instanced canvas-textured V quad per moving boat behind its stern (astern it swaps ends with the bow
  wave), 1.6 to 4.8 boat lengths long by speed, capped at 9 tiles, and a bow-wave quad. Both fade by speed through a
  per-instance `aFade` attribute (a small `onBeforeCompile` on a `MeshBasicMaterial`). Moored boats have none.
- **Lights.** Instanced glow points as in `helicopters.ts`: red to port (`-z`), green to starboard, white masthead and
  stern while `lights.nav`; one white all-round light for an anchored boat; green over white and deck floods while
  trawling; warm floods at work; a flashing blue on the launches. Windows light at night per boat. The glow is faint by
  day and swells at night.
- **Picking.** `pick` projects each boat's middle and bow and takes the nearest within its own on-screen half length
  (13 px at least). Hover (`boatTipHtml`), click (panel, `VehicleSel` `{ kind: 'boat', id }`) and right-click (the
  context menu's Inspect, Follow, Wheelhouse view) are wired in `main.ts` and `contextmenu.ts`, after helicopters.
- **Panel** (`boatPanelHtml`). Name, type and length, owner or operator (`boatOwner`, `boatOperator`), a trawler's
  `fishingReg`, home port or the port it calls at, speed in knots (1 tile a tick is 63), what it is doing
  (`boatDoing`: "heading for the fishing grounds", "alongside at X, working cargo", "waiting for the lifting bridge"), the
  catch or cargo of the voyage, its lights, and the crew. `inspectBoat` is sent once a second for the selected boat;
  the answer replaces a trawler's generated hands with its real citizens (clickable rows) and adds what it landed today.
  Not seen live: that answer (the scratch world has no staffed harbour, so no trawler has a payroll crew).
- **Wheelhouse view.** `BoatsView.helmPose()` is the eye as drawn this frame (the model's `eye` through the boat's own
  heave, pitch and roll), turned into a `CabEye` by `boatCab` with `helm: HelmFeed`. `vehicleInterior.ts` `HelmCab` paints
  window frames with mullions and a console (compass card turning with the heading, a radar sweep, a speed readout, twin
  throttle levers and a wheel that turns with the rate of turn); open boats (dinghy, sailboat, narrowboat) get a
  tiller and a readout only. The boat's own windows and lights are left out of its own view.
- **Ferries.** `BoatsView.setFerryLines(lines)` (called from the `ferryLines` handler) runs each running line's
  `railService` and draws its boats as river buses in the line's colour: `trainsAt` and `trainPoses`, the bow turned
  to the way the boat goes, alongside while dwelling and under way while running. Their ids start at `FERRY_ID_BASE`
  (2e9) plus line × 64 + boat, `ferryOf(id)` says which line and stop, and their panel shows the line, its piers, the
  next call and `ferryCrew`. Not drawn: the riders (they come with `inspectTrain`, which the panel does not ask).
  `BoatsView.sources` takes any other `(tick, out) => void` that appends `BoatState`s.
- **The barge hand-off.** `LandmarkMotion.bargeHidden(seed, day)` is set to `BoatsView.liftBooked`, which asks
  `boatLifts(harbours, day)` (cached per list and day); a span with a real boat booked in its lifts that day shows no
  decorative barge. Not seen live yet: the scratch world has no bascule bridge (B8's London and showcase do).
- **The harbour list.** `net.on('harbours')` calls `setHarbours(list, true)`, which also stops the dev mock. The
  mock (`HarbourMock`, `?dev` only) finds the harbours in the loaded chunks (built or still sites), takes each one's
  fairway row (two rows out for a marina or a jetty, so sailboats have river water), declares a made-up gate where a
  lake is not open water, and derives the lanes on this client's own tiles with `deriveHarbourLanes`. It waits for a
  quiet 2.5 s of loaded chunks before it works, and the server's list wins as soon as it has any harbour in it.
- **Debugging.** `msc.boats`: `debugTick`, `at(tick)`, `findPhase(phase, from, type)`, `states`, `counts()`, `sources`,
  `helmPose()`, `stateOf(id)`; `msc.boatMock` (`gates`, `notes`).
- **Measured** (62 boats at once: 50 synthetic on a ring of the lake, in every type, and the 12 the mock marina and
  fishing harbours hold; Chrome on Metal, 1400 × 900).
  - `BoatsView.frame` (schedule, matrices, colours, lights): 0.31 ms a frame.
  - Draw cost: 66 more draw calls (85 against 19) and 94,000 more triangles; a render took 0.84 ms with the boats and
    0.67 ms without (`gl.finish` after each, 70 renders). The page held 55 fps with them and 60 without (the display's
    cap); the worst frame in the 4 s was a first-sight shader compile.
- **Left for later.** Boats in the minimap and the world map; a spray or foam line down the hull; the police and fire
  launches' scheduling (B3 leaves them out); riders on a river bus's panel; a bascule's leaves tilted for a passing tall
  boat (B8 checks the lift passages).

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

### 8.1 Built: B8, the showcase harbour and London's Thames (2026-10-18)

The scenarios above, built in `shared/src/demo/showcase.ts`, `london.ts` and `londonMap.ts`, with the seeder
(`server/src/demo/seed.ts`) and `demo:check` (`server/src/demo/check.ts`). docs/demo.md has what each looks like. The
harbour kinds (24-28) and the Harbours group are no longer drafts, so `demo:check` enforces them.

- **The showcase's `harbour` section** (land `Harbour`, x 35-79, y 31-56).
  - The river runs on past the riverside quarter (repainted where the land dried it) into a basin, x 45-95, rows
    39-55, which opens to the sea gate "the sea" at (95, 47).
  - A quay road on y = 33 from the east perimeter road serves Eastport Docks (the cargo port, its quay the basin's
    north edge) and a bay (rows 36-38) with Eastport Fish Quay and Harbour Pier (whose pontoon row is a one-tile notch).
  - Between the bascule (x = 15) and the suspension bridge (x = 25), a pool off the north bank, exactly as wide as the
    marina (a wider one left clearance-2 pockets the cruises could not turn in), holds Lifting Bridge Marina, its door
    on a spur from the bascule's street. Row 48 could not take a marina (the river road is row 49), so the design's
    river-road placement went to the pool.
  - Past the suspension bridge, the Quarter Jetty and Riverside Pier stand by the river road (row 47 wet, row 48 dry).
    The pier is two tiles from bus line 3's stop at (32, 48). A jetty or a pier between the two bridges narrowed the
    river to one clearance-2 row, which trapped the yachts' cruises.
  - River bus line 1, there and back between the two piers, 3 boats.
  - The marina's position (x = 19) was chosen among the six the pool allows: its fleet then has every pleasure type
    (narrowboats included) and a yacht books the bascule's two lifts on day 4. The schedule is pure, so this holds until
    the schedule or the place changes; `demo:check` says so when it does.
- **London's `london-river` section.**
  - Piers and harbours are fitted before the streets, like the landmarks (`fitsHarbour`): wet rows on the Thames or a
    dock and a tile clear of every deck, dry rows on the real one's bank, a road-able front, and behind them open water
    off the decks, as deep as the kind's boats need and at least three rows. On the river, the second row out and a
    tile beyond each end of it must have water all round, so a clearance-2 channel stays open past every harbour (the
    first fits without that rule cut the barges off from Teddington). A pier also needs open water beyond each berth
    end.
  - Only the dry rows go to `londonPlan` as keeps, so the street plan fronts them with a road and leaves the wet rows
    river.
  - RB1 (5 boats) calls at Millbank, Embankment, Tower, Canary Wharf and Greenwich. The map's banks at Westminster are
    Parliament, New Scotland Yard and the Eye, and its bridges from Waterloo to Tower Bridge are three tiles apart, so
    Westminster, Bankside and London Bridge City have no room; Tower Pier stands below Tower Bridge.
  - St Katharine Docks is a `DOCKS` basin (4×3 at (14, -5)) where the river bulges north east of the Tower; the
    marina in it bases yachts, narrowboats and motor cruisers. A jetty on Chelsea Reach (the design's Putney jetty sat
    on 3.5-tile water and blocked the barges). Dagenham Docks (cargo port, north bank) and Thamesmead Fish Quay (south
    bank), both down river of every bridge. Blackwall and Woolwich stay bridges; the bascule stays on its clock.
  - Sea gates `londonSeaGates()`: the estuary (135, 22) and Teddington (-109, 79, low). `LONDON_MARGIN` (24) is
    shared with the server's margin.
- **A change to B1's `cruiseWaypoints`.** A cruise whose signature has `PASS_LIFT` picks first the best-hashed tile it
  reaches only through a lift, when one is within `CRUISE_RANGE`. Without it St Katharine's yachts cruised down river
  and never met Tower Bridge (the Pool is a few tiles against forty down river). boats-check passes unchanged.
- **Seeder.** `DemoSection.seaGates` goes to `World.seaGates`; every named placement (`DemoPlacement.name`) gets
  `setStopName` at its door (stations, piers, harbours); a `Ferry` is registered when the scenario has ferry lines and
  the caller has none. `worldHash` covers the sea gates only when there are any, so the other demos keep their hashes.
- **Registry** (docs/demo.md table): `harbour-<role>` for each kind (lanes with no refusal), `boat-<type>` for every
  `BoatType` (the launches as todos), `boat-lift`, `sea-gate`, `ferry-interchange`, and in London `tower-bridge-lift`.
  `SeededDemo` gained `harbours` (the server's list, taken as staffed) and `seaGates`. Spots `sea-gate` and
  `pool-of-london`; `LINE_CAPTIONS.ferry` rewritten; a ferry line's tour title is "River bus N" or its name.
- **demo:check.** Seeding prints each harbour's lanes and refusals and the gates; `--run` registers `Harbours` as
  game.ts does, ticks it in the fill and the run, and prints the boats (docs/demo.md).
- **Homes for the harbour's staff.** The town has more jobs than people, and the docks and fish quay are its farthest
  jobs, so after the first fill they had no staff (and an unstaffed harbour sails nothing). A street on y = 28 and a
  strip of homes (x 44-79, rows 29-32) behind the quay road fix that: every harbour is fully staffed after the fill.
- **Measured** (`--fill --run 1`, 2026-10-18, machine shared with other agents, load average 4-7).
  - **Showcase.** 16,831 citizens, 16,670 jobs, 16,789 employed; tick 17.6 ms average over the last day. Every harbour
    staffed (docks 70/70, fish quay 26/26, piers 3/3). Days 2-3: 6 fishing trips, 9 port calls with 3 tug escorts,
    10 cruises and 2 lift barges; 208 boxes landed, 200 sold; 15 calls landing 286 containers (253 lorries to shops),
    213 exports; 673 ro-pax passengers; $2,495 in dues, $72 in berth fees. River bus line 1 runs 3 boats every 64 min
    but carried nobody that day. `Harbours.tick` 0.009 ms and `Ferry.tick` 0.016 ms a tick. The yacht's lift passages
    are on day 4, outside the run; `demo:check` holds them.
  - **London.** 32,641 citizens; tick 41.0 ms average over the last day against 38.0 ms before B8 (32,505 citizens,
    the same fill run back to back; the two runs' random streams differ, and the river's own cost is 0.05 ms).
    9 harbours (8 staffed: Embankment Pier was not), 11 lanes, no refusal; the barges' lane to Teddington is 411 tiles
    under 18 bridges. Days 2-3: 6 fishing trips, 8 calls, 2 escorts, 15 cruises (6 yachts), 3 lift barges; on day 3
    two of Tower Bridge's three lifts carry a St Katharine yacht out and back. Totals: 183 boxes landed, 180 sold; 13
    calls, 221 containers in, 207 out; 483 ro-pax passengers; $2,140 in dues; $96 in berth fees. RB1 runs 5 boats
    every 78 min: 12 trips planned by river bus, 6 of them changing to the Tube. `Harbours.tick` 0.025 ms and
    `Ferry.tick` 0.027 ms a tick.
- **Screenshots** (own server and Vite, the demos as their children), with `msc.boats.debugTick` and
  `msc.landmarks.fixedHours` set together from the schedule: river buses at Tower Pier and Embankment, St Katharine
  Docks, a yacht under Tower Bridge's raised leaves, Dagenham Docks with a container ship alongside, the fish quay,
  the showcase's basin, port, pool marina, jetty and pier, and its bascule lifted for the yacht. (Pinning the leaves'
  time leaves the live traffic on its own clock, so a car can be seen on a raised leaf.)
- **Left.** The police launch and fire boat are registry todos. No visiting yachts or `through` lanes (B3 left them
  out). A lift's tall boat is booked into the clock's lifts only, so on days with fewer than two lifts within a
  cruise none passes. The showcase's river bus carries few riders: its piers join a corner of the quarter to the
  harbour's homes, which work at the docks.

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
| B2 | Harbour kinds (ids 24-28, drafts, one placeholder design each), wet footprints, placement, tech. **Built** (section 5) | opus | — | B1 | M (35 min) | new `buildings/harbour.ts`; `schema.ts`; catalogue registration; `structures.ts` `checkPlaced`; `tech.ts`; `chunkView.ts` (water under wet tiles); `worldmap.ts` (`mapClassOf`) | `compiled.ts` (generated: re-run `buildings:compile` on merge); `chunkView.ts` |
| B3 | Boat types and the schedule: `BOAT_TYPES`, `boatTimetable`, berth and bascule booking, `boatsAt`, names and crews | opus | B1 (B2's ids by `KIND_ID`) | B5, B7 | L (45 min) | new `shared/src/boats.ts`; `boats-check.ts` (schedule sections) | `boats-check.ts` (append sections) |
| B4 | Server harbours: lanes on change, sea gates, `harbours` message, fishing and port economy, `shipBerthed`, `inspectBoat`, tooltips, load test. **Built** (section 6.6) | opus | B1, B2, B3 | B6 | L (50 min) | new `server/src/sim/harbours.ts`; `simulation.ts` (`dispatch` `to`, export point); `gateways.ts`; `world.ts`, `snapshot.ts` (`seaGates`); `game.ts`; `net.ts`; `protocol.ts`; new `loadtest/boats.ts` | `net.ts`, `protocol.ts`, `game.ts` (also B5); `simulation.ts` |
| B5 | Ferries: the `'ferry'` mode, `Ferry extends Timetabled`, `routeWater`, `FERRY_TIMING`, berth offsets, `ferryLines`, the lines editor. **Built** (section 6.2) | opus | B1, B2 | B3, B7 | M (35 min) | `shared/src/transit.ts`; `rail.ts` (`ferry`, `RiverBus`, geometry dispatch); new `server/src/sim/ferry.ts`; `game.ts`; `net.ts`; `protocol.ts`; `client/src/lines.ts`; `showcase.ts` (`LINE_MODES` todo) | `rail.ts`; `net.ts`, `protocol.ts`, `game.ts` (also B4: append-only hunks); `showcase.ts` (also B8) |
| B6 | Boat rendering: models, liveries, motion, sails, wakes, lights, moored boats, picking, panels, helm FPV, barge hand-off. **Built** (section 7.1) | sonnet | B3 (B5 for ferries; mock until merged) | B4 | L (50 min) | new `client/src/render/boats.ts`; `vehicles.ts`; `main.ts`; `vehicleInterior.ts`; `fpv.ts` (`CabEye.helm`); `landmarks.ts` | `main.ts`; `vehicles.ts` |
| B7 | Harbour models: two designs per kind (pontoons, jetty, market hall, pier, cranes and stacks); channel-aware arches and piers in `render/bridges.ts`. **Built** (section 5) | sonnet | B2 | B3, B5 | S (25 min) | `buildings/harbour.ts` (designs only); `render/bridges.ts` (`bridgeChannel`) | `compiled.ts` (re-run compile) |
| B8 | Scenarios and checks: showcase `harbour` section, registry, tour, London (gates, piers, RB1, St Katharine, port), seeder `seaGates`, `demo:check` report, drafts off, `LINE_MODES.ferry = true`. **Built** (section 8.1) | opus | all | — | L (45 min) | `showcase.ts`; `london.ts`; `londonMap.ts` (`DOCKS`); `server/src/demo/seed.ts`; `demo/check.ts`; `harbour.ts` (draft flags) | `showcase.ts`; London's `startHash` changes (reset the demos) |

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
