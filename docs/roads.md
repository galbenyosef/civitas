# Roads: the tool, street names and the Commons

The roads programme (UTD card 5c3e5cd0) rebuilds roads in phases: R1 the look (render/), R2 the tools (this page),
R3 classes, R4 junctions, R5 traffic control. This page is R2: what the road tool does, how streets are named, and
how the Commons is laid out. The code is `shared/src/roadtool.ts` (the plan both sides use), `shared/src/streets.ts`
(the name generator), `client/src/input.ts` and `client/src/roadtool.ts` (the drag and its preview),
`server/src/net.ts` (`road`, `undoRoad`, `renameStreet`), `server/src/streets.ts` (the street book) and
`server/src/seed.ts` (the Commons).

## The road tool

**One drag, sent on release.** Press with the road tool (3) and drag: the road is drawn as a ghost from the press to
the cursor, and nothing is built until the button comes up. Esc lets go of the drag and keeps the tool (a second Esc
goes back to select, as ever).

**Shapes.** A drag is straight, or turns one corner like railway track: it runs first along the way the drag first
left the start, then along the other axis, so drawing east then turning south gives that L. Holding **Shift during the
drag** makes it a loop: the four sides of the rectangle between the press and the cursor. Shift held at the press
still pans, as it does with every tool (the controls scheme is unchanged). A drag is at most 256 tiles.

**Snapping.** When a drag stops one tile short of a road (the next tile along is bare dry land and the one after is
road) it gains that tile and meets the road.

**The ghost** is planned by `planRoad` on the loaded chunks, the same function the server lays with. Each tile is
coloured by what it will be: new road (pale blue; lilac on unclaimed land, which costs the public premium), road
already there (faint), an upgrade to another class (green), a bridge deck (blue), a building in the way (amber) or
refused (red). A chip at the end of the drag gives the running cost, the tiles and how many are on unclaimed land
("$340 · 17 tiles · 3 on unclaimed land"), the block depth (below), the buildings in the way, and the first reason
anything is refused: another owner's land, water without Civil engineering or a bridge that cannot reach the far bank,
a runway, junction or multi-tile structure (bulldoze it first), a level crossing on curved track, a road joining a
bridge from the side, or not enough money (in drag order: once the money runs out, the rest is refused). The status
line says the same. Refused tiles are left out and the rest is built; the server toasts the first reason.

**Buildings in the way** (card a0902fd7). A building standing on a tile (homes, shops, works, civic buildings, parks,
car parks, bus stops: anything at level 1 or more) or a civic building still being built (the player paid for it)
is not paved over silently any more. On release the client asks, with the cost: **Demolish and build** (the road plus
the $5 demolition fee per built tile, nothing refunded), **Build round them** (those tiles are left out), or
**Cancel**. One answer covers the whole drag. The intent carries `demolish: true` only after a yes; without it the
server goes round, so no client can demolish by accident. An empty zoned lot and a growth site are paved over as
before; a multi-tile structure is refused as before (bulldoze it first).

**The spacing guide.** While dragging, the straight stretch being drawn looks sideways up to 12 tiles for a road
running alongside it (at least two tiles of it). When it finds one, the chip says the depth of the block between them
("block 4 deep") and two faint lines mark where the next roads would make blocks of the same depth on the other side.
It is a hint, not a snap: there is no default block size.

**Undo.** Ctrl+Z (Cmd+Z on a Mac) with the road tool takes back the player's last road drag within 30 seconds
(`ROAD_UNDO_MS`, real time) while it is still bare road: no tile bulldozed or given a junction since, its bridges
still standing, and nothing gone up beside it since (a site or a building on a tile next to it that was not there
when it was laid). The tiles go back to what they were (an empty lot stays zoned; a building the drag demolished
stays down) and the road and bridges are refunded; the demolition fee is not. The toast says what was undone
("Undone: 17 tiles of road, $170 back"). One level: the last drag only, kept in memory, not saved.

**Classes and upgrade in place.** The intent and the plan carry a class (`cls`); the road tool lays the class picked
in its class picker, and a drag over road of another class upgrades it in place (see "Classes" below).

## Classes

R3 (card 26c5cb9a). Six classes, Rich's choice (answer 3a on the programme card): **country lane, street, one-way
street, avenue, motorway, pedestrian street**. The code is `shared/src/roadclass.ts` (the table, the byte, the rules a
car follows, the junction flag, the twin row of a divided road), the plan in `shared/src/roadtool.ts`, laying and
upgrading in `server/src/net.ts` and `World.setRoadClass`, the routers in `server/src/pathfinding.ts` and
`sim/busroute.ts`, lanes and speed in `server/src/sim/traffic.ts`, the picker in `client/src/roadpicker.ts` and the
drawing in `client/src/render/roads.ts` and `roadGeo.ts`.

| Class | Lanes | Speed | Holds (cars a tile) | Access | Cost a tile | Upkeep a day | Technology |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Country lane | one each way, no centre line | 80% | 2 each way | all | $5 | $0.25 | none |
| Street | one each way | 100% | 2 each way | all | $10 | $0.50 | none |
| One-way street | two, one way | 100% | 4 | all | $12 | $0.50 | One-way streets (Transport 2, $350, 80 housed) |
| Avenue | two each way, 2 tiles wide | 100% | 4 each way | all | $25 (two tiles a length) | $1 | Avenues (Transport 3, $1,000, 160 housed) |
| Motorway | two each way, 2 tiles wide | 125% | 4 each way | no frontage; slip roads | $40 (two tiles a length) | $2 | Motorways (Transport 4, $2,500, 200 jobs) |
| Pedestrian street | none (paving) | 40% (service vehicles) | - | walkers, bikes, emergencies, deliveries before 10:00 and after 19:00 | $15 | $0.75 | Pedestrian streets (Culture 2, $500, 90 housed) |

Unclaimed land adds the public premium ($10 a tile) to any class. Upgrading charges the difference; a downgrade is free
and refunds nothing. Upkeep is charged with the parcel's roads each midnight at each tile's class (`World.roadUpkeepOf`;
a parcel of streets pays exactly what it did). The technology costs sit with their neighbours: One-way streets beside
Traffic signals (tier 2), Avenues beside Junction design and Public works (tier 3), Motorways beside Harbours (tier 4),
Pedestrian streets with the second culture tier. Bot F buys none of them, so its first hours are unchanged.

**The byte.** A class lives in the low range of the tile's aux byte, `cls | dir << 3 | junction << 5`
(docs/aux-layer.md). The street has no byte, so every road laid before R3 is a street, old saves load unchanged and the
snapshot version stays 8. A bridge deck, a level crossing, a roundabout ring and a flyover keep their own bytes and are
streets: a class drag over one leaves it as it is, and the classes on either side carry on through it (a one-way's
direction is held by the one-way tiles round a crossing). The byte travels in the chunk messages and aux deltas the aux
layer already sends.

**Why the avenue is two tiles.** A tile is about 13 m and a car 0.18 of a tile wide (the client draws it at exactly
that); a street's two lanes sit 0.19 either side of its centre. Four lanes and a reservation in one tile would need
about 0.74 of a tile of carriageway: lanes half as wide as a street's, cars almost touching side by side, no room for a
planted strip, and the walkers pushed to the tile's edge. A one-way tile with two lanes uses the street's own two lane
positions, so the avenue is a pair of one-way tiles, two lanes each, with the reservation on their shared edge
(SimCity 4's avenue, and docs/structures.md's original plan); the motorway is the same pair with no frontage. The one
multi-lane piece the traffic model needs is "a one-way tile with two lanes", which the one-way street needs anyway. The
cost: an avenue dragged along a street needs the row beside it (the tool asks before demolishing what stands there).

**Laying.** The drag's direction is the traffic's on a one-way street; dragging one the other way reverses it, for
nothing. A divided class (avenue, motorway) lays the drag's row going the drag's way and its twin one step to the
drag's left going the other way (traffic keeps right), round corners and loops too (`twinRow`); the two rows go in
together or not at all (a tile refused, or a building left standing, takes its partner with it). Across water or a
railway a divided class is refused (two-tile bridges are a follow-up): lay a street over the bridge or crossing. A
motorway is refused where a building stands beside it, except its motorway connection. Dragged across a one-way or
divided road, a drag keeps that road's tile (a crossing, not a downgrade); a pedestrian drag keeps any road crossing
it. A street crossing a one-way street, an avenue crossing a street, and an avenue crossing an avenue all make
junctions as you would expect.

**The junction flag.** An avenue or motorway tile is a junction tile where a road crosses or joins it from the side
(not its twin), where it turns a corner, and where it or its twin ends. A junction tile has no direction of its own:
cars cross the reservation and turn round only there. Streets meet a motorway by slips: a street beside a motorway does
not make it a junction, so there is no crossing; only another motorway does. The flag is a pure function of the 3×3
round the tile, kept by the server round every road change (`World.refreshRoadFlags`).

**Driving.** `carStepOk` is the rule every car router follows (A*, the bus router, a driver's re-route): never out of
or into a one-way tile against its direction, never across a divided road's reservation between two tiles that both
have a direction, never onto a pedestrian street unless the vehicle is an emergency on a call or a delivery lorry out
of shop hours (`pedestrianDeliveryOpen`), and no building's way on or off the road is a motorway but the motorway
connection's (`World.hasRoadAccess` ignores motorways, so lots beside one do not grow from it). Walkers never walk along
a motorway; they walk anywhere else, pedestrian streets included. A driver whose way ahead a class change breaks finds
another (`Simulation.recheckClasses`).

**Lanes.** A one-way tile (one-way street, avenue, motorway carriageway) has two lanes, at the street's two lane
positions; every other edge has one, the right-hand one, so a world of streets runs exactly as before. Each car crosses
each tile edge in one lane of it (a strand: `Mover.s0`, `s1`, `s2`): it takes the lane for its next turn within six
tiles (left turns the left lane, right turns the right), keeps the lane it is in going straight, and coming off a
single lane takes one by its own hash so traffic spreads. A car follows the car ahead in its own lane, a lane fills on
its own (`laneCap` each), and a lane change eases across a tile and goes through the box check at its stop line like a
turn; the conflict tables gained the strands (the all-zero entries are the old tables). Where an avenue is crossed, a
car going over the reservation may wait in the first carriageway for a gap in the second, but not while a car crossing
the other way is in that box heading for its own (`Traffic.overMedian`: without it the two would wait for each other
for ever). A car joining a motorway from a street gives way to motorway traffic within two tiles (`SLIP_GAP`), lights or
none, and there are no signals on motorway tiles. The class sets the speed of the tile a car is on and the route cost
(the avenue 0.9 of a street, the motorway 0.8, the lane 1.2); A* scales its distance estimate by the cheapest class in
the world (`World.minRouteCost`), so it stays exact. `Traffic.roadRank` is the class's rank (motorway 4, avenue 3,
street and one-way 2, lane 1, pedestrian 0): with `TRAFFIC_TUNING.mainRoad` on, a bigger road's arms are the main road.

**Showing it.** The road tool (3) opens the class picker beside the tool bar, a card per class with its cross-section,
lanes, speed, cost, upkeep and the technology it needs (a locked class greyed with the technology named); the last
class picked is remembered. The ghost is in the class's colour with an arrow on every one-way tile, the chip and the
status line name the class, and a drag over road of another class shows as an upgrade. The road tooltip and a
building's address name the class ("Mill Lane, one-way street, northbound"; "12 Kingsway, avenue"). Streets on
an avenue are Avenues, on a country lane Lanes, on a pedestrian street Walks or Rows, and an avenue's two carriageways
are one street (renaming one renames both).

**Footfall.** A pedestrian street's shops see the most passers-by; the bonus itself is left for the leisure and
commerce work: `isPedestrianAux` on the shop's road tile is the hook, and walkers already walk along pedestrian
streets.

**Showcase.** The "Road classes" section (west of district A1, `ROAD_CLASSES_LAND`): Cheapside, a pedestrian street of
shops that Market Street ends at; North and South Parade, a one-way pair round a block of homes; Kingsway, an avenue
through offices and homes crossed by Market Street; a motorway from a motorway connection of its own with Market Street
joining it by a slip road; Hedge Lane, a country lane out to the edge. A tour stop each, and five registered features
(`road-class-*`) that demo:check enforces.

## Street names

**What a street is.** The longest straight run of road tiles along one axis. A crossroads belongs to both streets
through it, a bend ends one street and starts the next, and a street runs on through junctions, as Station Road does
in a real town. This was picked over "a segment between junctions" because it reads like a town: on a grid, junction
segments would give every block side its own name.

**How it is named.** British: a base (Station, Mill, Victoria, Albert, Church...) and a suffix by what the street is
like when it is named: a mews, court or yard for a stub of three tiles or fewer; a close (court, gardens) for a short
dead end of homes; a street or parade where shops make up half its frontage; a road or way for industry; a street,
place or row for offices; a lane (terrace, grove, row, gardens, walk) for a short street of up to 8 tiles; a road or
way for a through route of 14 tiles or more joined at both ends; else a street, road or terrace. The avenue waits
for R3's avenue class. The choice is a hash of the world seed, the street's line and its first tile, re-rolled until
its base differs from every street crossing it or running alongside it within 8 tiles, so no two neighbours share a
name (`streetClashes` counts any that do; the Showcase must have none).

**When.** A street is named the first time anyone asks (a hover, a building's address) and keeps that name from then
on, in the server's street book (`server/src/streets.ts`): a list per owner of stretches of a line and their names,
not per tile. A longer street on the same line that overlaps a named stretch takes its name and widens it, so
extending a street keeps its name; two named streets joined end to end keep the one they overlap most. The book is
saved in the snapshot as the optional `streets` field (`{ owner: [["h12:-11:10", "Mill Lane"], ...] }`; the
snapshot version stays 8). An older save has no book: its streets are named as they are asked for, the same way on
every server (a pure function of the seed, the street and what is round it at the time).

**Owner and renaming.** A street's owner is whoever owns most of its tiles ('' for public road on unclaimed land).
Right-click a road: **Rename street** (or **Rename Mill Lane** and **Rename Station Road** at a crossroads), greyed for
a street the player does not own. An empty name gives back the generated one. Up to 32 characters.

**Where names show.** The road tooltip leads with the street's name (and "corner of" or "meets" the other street at
a bend or junction), above the traffic; the building panel has an address line, the number on the door (shared
`houseNumber`, the number the door plates show) and the street the front faces ("12 Mill Lane"); the right-click
menu's title. R1's sign plates are next (a follow-up: the server sends the names of the streets in subscribed chunks).

**Showcase.** The High Street is named by the scenario (`DemoSection.streets`), and the `street-names` feature checks
every seeded street has a name, the scenario's names stand, and no neighbours clash.

## Lots one back from a road (card 797ee40a)

Not a bug in road access, but nothing told the player. A lot builds only with a road on one of its four sides
(`World.hasRoadAccess`). A lot one tile behind the frontage has none, so it waits for the building in front to grow
back into it as a deep plot (sim/blocks.ts), which only a building of two storeys or more does, and two storeys need
Masonry and power. Measured on a fresh Commons world, a new player's homes zoned one, two, three and four rows behind a
road: after four game days only the front row was built (level 1, full); with Masonry and the power gate off, the
front row reached levels 2-3 and one lot of the second row had been taken in; rows three and four never build until a
road reaches them. Now: with a zoning tool, the hover turns amber over land with no road beside it and the status
line says why; the toast after zoning says the same, naming Masonry and power.

## The Commons

The Commons used to be a 22×22 grid of 4×4 blocks with roads every 5 tiles (plus a doubled edge road). It is now
four bands of blocks between full-width streets, 4, 3, 6 and 4 tiles deep, each cut by its own cross streets into
blocks 3, 4, 6 or 8 long, so the cross streets meet the long ones at staggered T-junctions (13 T-junctions to 1
crossroads inside it) instead of a grid (`COMMONS` in seed.ts). Its edge roads are where they were (x and y = -11
and 10), so a plot east of it still joins at x = 10. New worlds only: an old save keeps its Commons.

The zones were balanced so the town grows as before. Six seeds, three game days from a fresh world:

| | Road tiles | Lots | Frontage homes / shops / works / offices | Residents | Jobs | Employed |
| --- | --- | --- | --- | --- | --- | --- |
| Before (4×4 grid) | 228 | 256 | 79 / 47 / 34 / 24 | 341 | 316 | 305 |
| After (mixed blocks) | 185 | 299 | 90 / 50 / 33 / 8 | 348 | 320 | 308 |

Fewer office lots, because offices on the new layout grew far faster (a 3×4 block of offices made 140-160 jobs in
three days, against 40-64 from the old six blocks). The test cities (loadtest/cities.ts) keep the old grid, so load
test results stay comparable.
