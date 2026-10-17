# Civitas structures: what makes a city look real, and what the engine must grow

Scope: design research only. Nothing here is built. Every claim about the engine was read from source on 2026-10-16.

## 1. The engine today, in the facts that matter

- **One tile, one building, one draw call.** `chunkView.ts` emits at most one building per tile into a single `BatchedMesh` (60,000-instance cap). Models are kit-built boxes, prisms and cylinders at tile scale (heights 0.3 to 3.0).
- **Scale.** A sedan is 0.34 tile long, so one tile is roughly 13 m. Skylines cells are 8 m, so Skylines footprints shrink by about 0.6 when ported.
- **Flat world.** `terrain.ts` returns water, sand or grass from noise. There is no elevation. Ground vertices are all at y=0, the camera picks against the plane y=0, and `net.ts` refuses roads and zones on water (since 2026-10-17 a straight road across water becomes a bridge, section 3).
- **Tile word is full.** Terrain uses 2 bits but only 3 of 4 values. Kind uses 4 bits with 10 of 16 values. Level uses 3 bits with 0 to 3 used by growables. Construction, priority and progress take bits 10 to 15, and `syncBuilding` deletes any site on a road tile, so those six bits are dead on roads.
- **Editing overwrites the word.** Every tool calls `packTile(terrain, road, kind, level)`, which rebuilds the whole value. Any extra bits stored inside the tile would be wiped by the next paint unless every call site changed.
- **Traffic is a per-tile box.** `traffic.ts` has one lane per direction per tile, arcs from `pathPoint`, a precomputed conflict table, and junctions detected by road degree of 3 or more. Pathfinding and the walker polylines are 2D tile graphs.
- **Kerb parking is server-only.** Counts live in `w.kerb` and reach clients only in a tooltip. The existing `parked` instanced mesh draws lot cars only.
- **Variation gap.** Civic kinds each have exactly one design. Residential, commercial, industrial and office have four per level.

## 2. Engine capabilities, named once

Entries below refer to these codes.

| Code | Capability |
| --- | --- |
| E1 | **Aux layer**: a third per-chunk array (Uint8 per tile) next to tiles and parcels, persisted, snapshotted and sent with the chunk |
| E2 | **Multi-tile structures**: anchor, occupied parts, door tile |
| E3 | **Road classes**: subtype, direction and flags in the aux byte; router and speed read them |
| E4 | **Roads on water**: bridge and pier pieces; digging water; derived quays |
| E5 | **Prop scatter**: derived trees, benches, stops, cars from tile data, in a second instanced pass |
| E6 | **Junction rules**: roundabout rings, grade-separated crossing tiles, no-signal flags |
| E7 | **Height field**: per-tile relief, graded platforms, skirts |
| E8 | **Roads on relief**: ramps, decks, tunnel portals |
| E9 | **Terrain generation**: rivers, cliffs, a rock terrain value |
| E10 | **Coverage networks**: power and water radii, like `SERVICE_RADIUS` |
| E11 | **Animation and schedules**: shader-driven spin and water, weekly or event schedules |
| E12 | **New mover and track classes**: cyclists, buses, boats, trains |

Size key for models: **S** under 20 kit parts, **M** 20 to 60, **L** over 60.

## 3. Water and crossings

| Structure | Footprint | Kit | Visual and hook | Needs |
| --- | --- | --- | --- | --- |
| Bridge | 1 x span | S | Deck, rails, piers into water; arch or truss chosen by span hash. Hook: the only way across water, priced per tile, upkeep to the owner. | E1, E3, E4 |
| Viaduct or elevated road | 1 x n | M | Raised deck on pillars over buildings or valleys. Hook: reach across built land without junctions. | E6, E8 |
| Tunnel portal | 1 x 1 pair | S | Arch in a hillside; the road vanishes. Hook: cross hills with no zoning loss. | E7, E8 |
| Canal | n x 1 dug water | S | Player-dug channel with quay walls. Hook: drainage, boats, waterfront land value. Dug water is just terrain=Water written into the tile, which already persists. | E4, E12 |
| Quay or seawall | derived | S | Stone edge and bollards wherever pavement meets water. No encoding needed: derive from neighbours like road masks. | E4 |
| Pier or boardwalk | 1 x n on water | S | Pedestrian-only deck. Hook: tourism visitors, fishing. | E3, E4 |
| Marina | 3 x 4 on shore | M | Pontoons with moored boats (instanced). Hook: berth fees like a parking lot, leisure trips. | E2, E4, E12 |

**Implications.** A bridge is a road tile on a water tile with a bridge flag in the aux byte. Routing, signals and lanes are unchanged because the graph is 2D. Only the placement rule (water allowed if flagged) and the renderer change. Boat clearance under bridges is a later concern. Dig and fill tools rewrite the terrain bits, so canals need no new encoding.

References: Skylines turns elevated roads into bridges [S1]; OpenTTD bridges span water with end-height rules [S10]; Millau Viaduct for the high-span extreme [S13].

> **Built (2026-10-17): road bridges (E4, bridges only; no piers, dig tool, quays or road classes).** `shared/src/bridges.ts`, the Road tool over water (Civil engineering, Transport tier 3, $120 a tile of deck), aux bytes in docs/aux-layer.md, rendering in `client/src/render/bridges.ts`, bench `server/src/loadtest/bridges.ts`. What shipped, and where it differs from the sketch above:
>
> - **A deck tile is a water tile with the road bit**, plus an aux byte `0xd8 | style << 1 | ns` (the deck's axis and its style). No tile was water and road before, so old worlds load unchanged; the terrain stays water, so a bulldozed deck is open water again.
> - **Placement**: drag a road from a road on one bank straight out over the water. Nothing is sent while the cursor is over the water (the status line and the hover outline show the bridge it would make, its style and price); once the drag reaches dry land in line on the far side, the whole run and both banks go in one message (`client/src/input.ts` Crossing). The server (`net.ts` bridge, `planBridge`) wants a straight run of 1 to 12 water tiles, a road on dry land at both ends (the drag lays the banks first), no junction on the water and no road meeting the deck from the side (`joinsBridgeSide` refuses that road later too), and the land rule of roads (own parcel, or unclaimed with Public works). Bulldozing any deck tile removes the whole bridge.
> - **Sim**: a deck is plain straight road to the traffic model, routers and walkers. Routers step on and off a deck only along it (`junctionStepOk`, `sideways` in pathfinding.ts), a deck is nobody's road access (`World.hasRoadAccess`), and nobody parks at its kerb. The bench shows it carries exactly what the same layout on land does, with no car-car overlaps.
> - **Styles** (`chooseBridgeStyle`, from span and a hash): up to 3 tiles mostly stone arches, 4 to 7 arches or girders (a few suspension), 8 or more mostly suspension; a scenario may force one, and the **bascule** style (Tower Bridge) is only ever a scenario's. Each bridge varies from its own hash: stone or paint colour, pier spacing, arch rise, solid parapet or balustrade, cutwaters and refuges, plate girders or a Warren truss, twin-column or wall piers, tower height and colour, cable sag, lamp design, spacing and switch-on darkness.
> - **Height is visual only** (the world is flat): decks stand 0.18 to 0.26 above the water by style; ramps rise on the landing road tiles, or on the end deck tile when the landing is a junction, so nobody turning there is lifted. `roadY` lifts cars and walkers onto the deck.
> - **Bascule lifts** (Tower Bridge): the lift schedule is a pure function of the clock and the span (`basculeLiftAt`, 0-3 lifts a day between 07:00 and 21:00, half an hour each), shared by the client's leaves and the server. To the traffic model a bascule deck tile is a level crossing whose barriers close `BASCULE_CLOSE_BEFORE` (0.25 h, long enough for a walker to get off) ahead of each lift and open `BASCULE_OPEN_AFTER` it: nobody goes on, anyone caught drives or walks off, and while it is up the span costs a router a detour (drivers held there past the stuck limit re-route). The client draws half barriers and flashing lights on the approaches on the same schedule. `loadtest/bridges.ts --bascule` runs across a lift: no car on the leaves while they are open, no car-car overlaps.
> - **Deferred**: piers and boardwalks, the dig and fill tools, quay edges, wider (two-tile) bridges, bridges for track, and boat clearance (a seaport's boats will need it; only the bascule span can open, and its lifts would then follow the boats rather than a schedule).

## 4. Road hierarchy

| Structure | Footprint | Kit | Visual and hook | Needs |
| --- | --- | --- | --- | --- |
| Avenue or boulevard | 2 to 3 wide | M | Median with trees and lamps. Hook: higher speed and capacity, land-value bonus. Note `signalArms` already treats a two-wide road as one street, so the traffic side half-exists. | E3, E5 |
| One-way street | 1 x n | S | Arrow paint in the atlas. Hook: calm streets, relief for bottlenecks. | E3 |
| Pedestrian street | 1 x n | S | Paving, benches, awnings. Hook: shop income bonus, no cars [S14]. | E3, E5 |
| Cycle lane | flag | S | Green lane strip in the road cell. Hook: cheap commuters, fewer cars. | E3, E12 |
| Roundabout | 3 x 3 ring, up to 5 x 5 | S | Ring road around an island that can hold a fountain or monument [S1][S11]. | E3, E6 |
| Flyover or overpass | 1 crossing tile plus 2 ramps | M | Two roads cross without a junction. | E6, E8 |
| Motorway and interchange | 2-wide one-way pair; 6 x 10 diamond, 8 x 8 trumpet | L | No frontage, fast, noisy; ramps join streets. Hook: freight and visitors reach the city, but neighbours pay in noise [S5][S12]. | E2, E3, E6, E8 |
| Level crossing | 1 tile | S | Barriers and lights; trains stop cars. | E6, E12 |

**Implications.**
- **Road classes** use the aux byte: 3 bits class (street, avenue, motorway, pedestrian, pier, bridge, ring), 2 bits direction for one-way, 3 bits flags (cycle lane, bus stop, no-frontage). `hasRoadAccess` must ignore no-frontage roads, otherwise buildings face motorways. Pathfinding drops edges against one-way direction and excludes pedestrian roads for cars. `DRIVE_SPEED` gets a per-class multiplier.
- **Roundabout** fits the tile-box model. Each ring tile is one-way with a "ring" flag. The conflict table already makes an entering car wait for a circulating one. Ring tiles with a side arm must not count as a signalled T, because `junction()` assigns lights at degree 3. Corners reuse the wide-left arc. The island is a non-road tile, so it takes any structure.
- **Overpass** is a tile where two straight roads cross on different layers: lane keys gain a layer bit, `degreeOf` returns 2 per axis, and the conflict table is skipped. Turns are impossible there, which is exactly right.
- **Interchanges** are E2 prefabs whose parts are aux-coded road tiles: one click to place, ordinary tiles to run.

> **Built (2026-10-17): roundabouts and flyovers (E6), without road classes.** `shared/src/junctions.ts`, tools Roundabout and Flyover (Junction design, Transport tier 3), aux bytes in docs/aux-layer.md, measurements in docs/traffic-tuning.md "Roundabouts and flyovers". What shipped, and where it differs from the sketch above:
>
> - **Roundabout = a 3×3 area.** Clicking a crossroads or T-junction turns the junction tile into the **island** (not a road, so it never routes; the client plants it) and the eight tiles round it into **ring** road (the four corners are paved from empty lots; built corners must be cleared first, and no outside road may meet a corner). Each ring byte stores the tile's place round the island instead of a one-way direction and a ring flag: the direction follows from it. Traffic drives on the right, so the ring runs **anticlockwise** seen from above (not the UK's clockwise). Arms join at the middle of each side.
> - **Lane geometry is the existing tile model**: the middles are straight, the corners are the wide left-turn arc (radius 0.69 tile round the island's corner), entries and exits the tight right turn, so the conflict tables stay exact and cars drive a smooth rounded ring. The ground cells (render/atlas.ts) paint the band along that path: island apron, give-way lines, a hatched splitter, arrows.
> - **Rules**: no signals on ring tiles; a car from an arm (or a driveway at a corner) gives way to a moving car on the ring within `ringYield` tiles that stays on the ring past it; merging into the ring lane behind a car already out in it is following, not a conflict (`ringMerge`); the ring never fills (`ringSpare` places stay free, or every lane round it full locks for good); pedestrians cross the arms on zebras (cars going round never drive over them) and walk the ring's outer kerb. Routers (A\* and the breadth-first searches) only go round forwards.
> - **Flyover = one tile**, not three. The crossing tile holds the deck byte (layer 1 for the road on top); the tiles either side are drawn as ramps but stay ordinary road in the sim, since the world is flat (E7 is not built). Placement asks for plain straight road either side. On the flyover tile `degreeOf` is 2 (no box, no lights), box conflicts and body guards ignore the other level, and routers keep the deck and the road beneath as separate nodes (`tile key + 2^32` for the lower one) and only go straight across. Cars and walkers along the deck are drawn on it and its ramps (render/junctions.ts `roadY`).
> - **Deferred**: road classes (E3) and their one-way flag; bigger roundabouts (5×5, two lanes); turning slip roads at a flyover (a true interchange); graded ramps with real height.

## 5. Landmarks and civic set pieces

| Structure | Footprint | Kit | Visual and hook | Needs |
| --- | --- | --- | --- | --- |
| Clock tower | 1 x 1 | S | Tall, lit face showing the game clock; chimes staggered per client. Hook: city identity, the cheapest landmark. | E1 |
| Fountain | 1 x 1 or 2 x 2 | S | Animated water, spray. Hook: land value, plaza anchor. | E11 |
| Plaza | paintable tile | S | Paving with scattered benches and trees. Hook: land value, venue footfall. | E5 |
| Market | 2 x 3 | M | Stalls with varied awnings, open on set weekdays only. Hook: weekly visitor spike, small-trader income. | E2, E11 |
| Town hall | 3 x 3 | M | Columns, clock, flag. Hook: tax tolerance in radius, needed before some tech tiers. | E2, E10 |
| Museum | 3 x 4 | M | Portico, glass wing. Hook: daytime tourists, office adjacency. | E2 |
| Cathedral or temple | 4 x 5 | L | Spire, nave, forecourt. Hook: happiness radius; visitors at weekends [S8]. | E2 |
| University campus | 6 x 6 | L | Quad with 3 to 4 halls. Hook: skilled jobs, raises office level cap [S3]. | E2 |
| Stadium | 6 x 8 | L | Bowl, floodlights, parked-car sea. Hook: event days spike traffic and parking demand, which our lot system already models [S3]. | E2, E11 |
| Monuments | 2 x 2 to 4 x 4 | M to L | Milestone rewards (Skylines monuments run 5x12 to 16x8 cells) [S2][S7]. | E2 |

**Implications.** Multi-tile entries need E2 (section 8). The sim must keep seeing one building: register it at a **door tile**, a part tile next to a road. Walker, driver, forecourt and `capacity()` logic then work unchanged. Civic kinds have one design each today, so the variation rule needs 2 to 3 designs per landmark class plus the existing tint.

## 6. Infrastructure

| Structure | Footprint | Kit | Visual and hook | Needs |
| --- | --- | --- | --- | --- |
| Power station | 4 x 4 | L | Stacks with smoke, cooling tower. Hook: city power, pollution radius. | E2, E10 |
| Substation | 1 x 1 | S | Fenced yard with pylons. Hook: extends power coverage. | E10 |
| Wind turbine | 1 x 1 | S | Tall mast, spinning rotor with a per-instance phase. Hook: small clean power, sited on hills. | E10, E11 |
| Water tower | 1 x 1 | S | Tank on legs. Hook: water coverage; skyline accent. | E10 |
| Water treatment | 3 x 3 | M | Round settling tanks. Hook: water supply and river pollution. | E2, E10 |
| Depot (bus or truck) | 2 x 3 | M | Shed and parked fleet. Hook: starts transit routes, cuts delivery costs. | E2, E12 |
| Rail yard | 2 x 8 | M | Sidings, wagons. Hook: freight bypasses roads. | E2, E12 |

**Implications.** Coverage reuses the `isService` pattern: a building whose radius flags nearby homes. One new Utility kind and a grid lookup, no network graph. Rotors spin through an `aSpin` vertex attribute and `uTime` in the building shader, phase from the instance colour hash, so the single draw call survives.

## 7. Public realm, terrain, and what they need

**Public realm detail**

| Structure | Visual and hook | Needs |
| --- | --- | --- |
| Street trees | Species, height and lean from tile hash; thin in cold zones. Hook: land value, shade. | E5 |
| Benches, bins | Cluster at plazas and stops. Hook: footfall for cafes. | E5 |
| Bus stops | Shelter on the sidewalk side. Hook: transit coverage. | E3 flag, E12 |
| Billboards | On commercial and office roofs; the owner picks the ad. Hook: ad revenue. | E5 |
| Scaffolding | Variant of the existing `site` model, plus on upgrades. Hook: shows work in progress. | none |
| Hedges and fences | Derived from the parcel layer along ownership boundaries. Hook: makes ownership visible. | E5 |
| Parked cars at kerbs | Draw the `w.kerb` counts. Hook: parking pressure is visible. | E5, protocol plane |

**Implications.** Trees alone would blow the 60,000-instance building budget, so props get their own `BatchedMesh` (one more draw call), filled only for chunks near the camera. Positions derive from tile hashes, so nothing is stored or sent. Kerb counts need two bits packed beside the congestion byte.

**Terrain**

| Feature | Visual and hook | Needs |
| --- | --- | --- |
| Hills | Rolling ground, terraced platforms for lots. Hook: views raise value, steep land costs more to build. | E7 |
| Cliffs | Rock faces where neighbouring tiles differ by 2 or more steps. Hook: natural barriers. | E7, E9 |
| Rivers | Ridged-noise channels that run to the sea. Hook: crossings matter. | E9, E4 |
| Beaches | Wider sand band on gentle slopes, with huts. Hook: tourism. | E7, E9 |
| Coastlines | Depth gradient from shallow cyan to deep blue, foam at the edge. | E7 |

**Implications.** See section 9.

## 8. Multi-tile structure design (E1 plus E2)

> **Built (2026-10-16).** E1 and E2 now exist; `docs/aux-layer.md` describes what shipped. It differs from this sketch in three ways. The anchor's aux byte holds the orientation, not a definition id, because the kind stays in the tile word. Part tiles keep the structure's own kind instead of a Part kind. Footprints stop at 8×8, since part offsets take 3 bits per axis. The design notes below are kept as written.

- **Aux byte.** On a structure's anchor it holds the structure definition id (256 types). On an occupied part it holds a nibble pair (dx, dy) back to the anchor, so footprints go up to 16 x 16 and span at most two chunks per axis.
- **Kinds.** Use spare kind values: Landmark, Utility, Park (plaza, fountain, market) and Part. `KIND_NAMES`, cost and upkeep tables grow to 16. The level field becomes a size or variant class.
- **Server.** `placeStructure(def, anchor, rotation)` checks every tile: dry land, inside one parcel owned by the placer, no road. It writes Part tiles, creates one Site at the door tile with work scaled by area, and indexes one `Building` at the door tile. Bulldozing any part finds the anchor and clears everything.
- **Client.** The anchor chunk emits one placement of the large model, facing the road. Part tiles emit none and draw paving. Progress reuses the quarter bits and scales y, as sites do now. A structure straddling an unsubscribed chunk pops in late; acceptable at 16 tiles maximum.
- **Why aux, not the tile word.** `packTile` overwrites everything, so a separate array survives paint calls. It costs 1 KB per chunk and matches how parcels already persist.

## 9. Height field design (E7 and E8)

1. `heightAt(seed, x, y)` in `shared/terrain.ts`, from the same fbm used for water. Still a pure function, so chunks regenerate from the seed.
2. Quantise to integer steps. Shared ground corners take the mean of adjacent tile heights. Tiles with a road or building **pin** their four corners to their own height, giving flat lots. A skirt quad closes any step between pinned neighbours. Cliffs are skirts of 2 or more steps, textured as rock (terrain value 3).
3. Record a built tile's graded height in the aux layer, so later noise changes never move ground under buildings.
4. **Existing worlds keep relief 0** through a world-version flag in the snapshot. New worlds opt in.
5. Touch points: building y in `chunkView.ts`, citizen and vehicle y in `citizens.ts`, ground normals, and picking in `camera.ts` (refine the plane hit over two or three iterations). Per-chunk meshes exist already, so no new draw calls [S15].
6. Roads on relief: one step of grade per tile, with ramp cells in the atlas. Bridges, viaducts and tunnels take deck height from the aux layer [S10]. Traffic stays 2D.

## 10. (a) Capability order

1. **E1 aux layer plus E2 multi-tile structures together.** One storage change and one placement model unlock about 20 of the structures above, and the sim barely changes because it still sees one door tile.
2. **E3 road classes.** Cheap in the renderer, high visual and gameplay return: one-way, pedestrian, avenue, speed. Also the substrate for motorways, piers and bridges.
3. **E4 roads on water, dig tool, derived quays.** The first thing players hit on the existing water map, and it needs no height field. Road bridges built on 2026-10-17 without E3 (the deck byte carries the axis and style; section 3).
4. **E5 prop scatter.** Trees, benches, stops, hedges and kerb cars change how the city feels more than any one landmark and cost no storage. Do the kerb protocol plane here.
5. **E6 junction rules.** Roundabouts and overpass tiles, built on the conflict table that already exists. Built on 2026-10-17 without E3 (the ring and deck bytes carry what E3 would have; section 4).
6. **E10 coverage networks.** Reuses `SERVICE_RADIUS`; makes the infrastructure group a real game system.
7. **E7 height field.** The largest cross-cutting change: ground, buildings, citizens, camera. Ship it gated by the world-version flag.
8. **E8 roads on relief.** Ramps, viaducts, tunnels. Only worth it once E7 exists.
9. **E9 terrain generation.** Rivers, cliffs and rock; rivers also increase the value of E4.
10. **E11 animation and schedules.** Spin, fountains, weekly markets, stadium events. Small and mostly shader-side.
11. **E12 new mover and track classes.** Cyclists, buses, boats, trains. Largest sim cost, so last.

## 11. (b) Proposed cards

1. **Aux layer in chunks** (opus). Add a Uint8 per tile to the world chunk, the snapshot, the wire message and the client chunk, with a version bump. Keep `packTile` untouched. Include the world-version flag.
2. **Multi-tile structure placement** (opus). Anchor and part kinds, door tile, server validation, bulldozing, one Site per structure, and the client emitting one large placement. Ship the clock tower, town hall and one plaza as proof.
3. **Civic landmark set** (sonnet). Kit models with 2 to 3 designs each for town hall, museum, cathedral, university and stadium, with gameplay hooks from section 5. Depends on card 2.
4. **Road classes** (opus). Subtype, direction and flags in the aux byte; router honours one-way and pedestrian; `hasRoadAccess` ignores no-frontage; speed multipliers; atlas cells for arrows and paving; avenue as a merged twin-lane.
5. **Bridges, piers and canals** (sonnet). Allow flagged road tiles on water, dig and fill tools, deck and pier kit models, and derived quay edges.
6. **Street furniture scatter** (sonnet). Second `BatchedMesh` with chunk-distance culling; trees, benches, bins, bus shelters and parcel fences derived from tile hashes; hash-driven variation in species, scale and lean.
7. **Kerb cars on screen** (sonnet). Pack kerb counts into the traffic plane and draw them in the existing `parked` mesh.
8. **Roundabouts and overpasses** (opus). Ring flag with no signals, layer bit in lane keys, conflict table skip for crossing tiles, tests in the load harness comparing junction throughput.
9. **Utilities and coverage** (sonnet). New Utility kind, power and water radius flags on homes, power station, substation, water tower and treatment models, tooltip lines.
10. **Height field behind a flag** (opus). `heightAt`, pinned platforms, skirts, citizen and vehicle y, camera picking, and the world-version gate.
11. **Rivers, beaches and coastline shading** (sonnet). Ridged-noise rivers, a beach band tied to slope, water colour by depth. Depends on card 10.
12. **Animated set pieces** (sonnet). `aSpin` for turbine rotors, fountain spray and weekly market schedule, with per-instance phase offsets so nothing runs in lockstep.

**Every card:** 2 to 4 designs per class, hash-driven tint, and per-instance timing offsets on anything animated or scheduled. Structure models register in `models.ts` before the batch is built.

## Sources

Opened directly: S1, S2, S9, S10 (bridges), S12, S13, S14. The rest come from search summaries only.

- [S1] Cities: Skylines wiki, Roads: https://skylines.paradoxwikis.com/Roads
- [S2] Cities: Skylines wiki, Monuments (footprints and prerequisites): https://skylines.paradoxwikis.com/Monuments
- [S3] Campus and stadium unlock guides: https://guidestrats.com/cities-skylines-university-campus/ and https://guidestrats.com/cities-skylines-stadium/
- [S4] Cities: Skylines II road design write-up: https://gamasutra.com/design/how-colossal-order-turned-roads-into-the-backbone-of-cities-skylines-ii
- [S5] SimCity 4 Network Addon Mod: https://www.moddb.com/mods/network-addon-mod
- [S6] NAM 32, draggable viaducts at two heights: https://www.moddb.com/mods/network-addon-mod/news/network-addon-mod-32-full-release-now-available
- [S7] SimCity 4 Landmarks add-on: https://www.mactech.com/2003/12/10/simcity-4-landmarks-add-on-released
- [S8] SimCity 4 House of Worship: https://simcity.fandom.com/wiki/House_of_Worship
- [S9] TheoTown plugin system: https://theotown.com/ with the Lua API at https://doc.theotown.com/topics/00-intro.md.html. The in-game plugin catalogue could not be opened from here, so no per-plugin links are cited.
- [S10] OpenTTD bridges: https://wiki.openttd.org/en/Manual/Bridges and landscape source: https://docs.openttd.org/source/d1/d01/landscape_8h.html
- [S11] Magic Roundabout, Swindon: https://en.wikipedia.org/wiki/Magic_Roundabout_(Swindon)
- [S12] Gravelly Hill Interchange, five levels: https://en.wikipedia.org/wiki/Gravelly_Hill_Interchange
- [S13] Millau Viaduct, about 343 m high: https://en.wikipedia.org/wiki/Millau_Viaduct
- [S14] Strøget, pedestrian shopping street: https://en.wikipedia.org/wiki/Str%C3%B8get
- [S15] three.js forum on height-mapped instanced terrain and per-chunk LOD: https://discourse.threejs.org/t/instanced-rendering-of-height-map-applied-terrain-mesh-geometry/40272 and https://discourse.threejs.org/t/lod-instancing/20524
