# Underground railways (design)

UTD card 94a665f8. Rich: "we need stations and lines similar to buses but working underground". This started as a design. Built so far: subtask 1, the under layer, its persistence and wire; subtask 2, the shared metro logic; subtask 3, the kinds and tech; subtask 4, the `Metro` service on the server; subtask 5, the underground view; subtask 6, the trains, riders and Lines editor; subtask 8, the Showcase line, the London Tube and the checks (section 9 marks each subtask as it lands). Section 9 splits it into subtasks for one work window, and section 10 lists the open questions, each with a default so work need not wait.

In one paragraph: a fifth per-chunk byte layer, the **under layer**, holds tunnels and platforms. Nothing on the surface reads it. A **metro station** is a small surface entrance on the player's land with a 1×N platform straight underneath it. A **metro line** is made in the Lines panel like a bus line, by clicking entrances in order. On save the server bores whatever tunnel is missing, then routes the line through the layer with surface rail's own route search. Trains run surface rail's pure timetable, so they are drawn without a message per train, extended for twin bores. Citizens use the line through the existing transit registry. An underground view (key N) fades the surface and shows the network Tube-map style.

## 1. Data model

### The under layer

`Chunk.under: Uint8Array(1024)` sits beside `tiles`, `parcel`, `aux` and `sub` (`server/src/world.ts` `Chunk`, `client/src/world.ts` `ClientChunk`). The aux and sub layers cannot carry tunnels. Aux has only `0xfb`–`0xff` free, and a tunnel must share its tile with whatever is above it, which already owns that tile's aux and sub bytes: a road, a building, a structure part, track, a bridge deck or water. With a separate layer the surface never changes meaning. Pathfinding, growth, the building index and `planStructure` never see it.

| Byte | Meaning |
| --- | --- |
| `0x00` | solid ground |
| `0x10 \| m` | **tunnel**. `m` holds the sides it leaves the tile by, N 1, E 2, S 4, W 8, as rail's `RAIL_SIDES` and `railMask` |
| `0x30 \| m` | **platform tile**: a tunnel tile with a platform beside the track. `m` is always straight along the platform (5 or 10) |
| bit 6 (`0x40`) | reserved for a second depth level |
| `0x80`–`0xff` | reserved (vent shafts, a depot's sidings) |

The masks mean what they mean for track (docs/rail.md "Aux encoding"):

- 1 side: an overrun stub;
- 2 sides: straight or a quarter curve;
- 3 sides: a junction;
- 4 sides: a **crossover**, two straight bores where the north-south bore dips under the east-west one. A train goes straight on only; `legSearch` already treats a four-sided mask that way.

**One depth level** is enough to start. Lines may not share tunnel anyway (section 3), and crossovers let them cross. Bit 6 keeps room for deep lines later.

**Nobody owns a tunnel.** Tunnels go under any land on the map: roads, rivers, track, public land and other players' buildings. Only the entrance has to be on the player's land. A tunnel tile is in use while a routed metro line runs over it. Upkeep is charged on stations, so nothing needs a tunnel's owner. Bulldozing in the underground view fills tunnel tiles that no line uses and that are not under another player's parcel. It is free and refunds nothing. Removing a platform is described in section 2.

Code: the encoding and the rest of the pure metro logic go in a new `shared/src/metro.ts`, exported from `shared/src/index.ts`. Its pieces are `UNDER_TUNNEL`, `UNDER_PLATFORM`, `underMask`, `isTunnel`, `isPlatform`, the `METRO` tunables, `planPlatform`, `metroStationAt`, `underNet` and `planBore`.

**Built (U2).** `shared/src/metro.ts` has all of these, plus:

- `tunnelByte(mask)` and `platformByte(alongX)`. `isTunnel` is true for platforms too (any `0x10`-`0x3f` byte at the first depth); bit 6, `0x80` and up read as neither.
- The kinds: `METRO_ENTRANCE` (22), `METRO_STATION` (23), `isMetroStationKind` and `metroPlatformLen(kind)`.
- `MetroEnv`, which is `RailEnv` plus `under(x, y)`. The server builds it from `World.underAt` and the client from `ClientWorld.underAt`.
- Writers never touch a world. `planPlatform`, `planBore` and `orphanPlatform` return flat `[x, y, byte, …]` writes for the caller to apply with `setUnder`.

### Persistence

**Snapshot v8** (`server/src/snapshot.ts`):

- `chunks[].under` is stored as base64, only when the layer is not all zero.
- `stopNames?: [x, y, name][]` holds station names (below).
- v7 and older worlds upgrade in place, with zero under bytes and no names. `UPGRADES_FROM` gains 7.
- `World.setUnder(x, y, v)` marks the chunk modified, so it is saved, and records the tile in `World.dirtyUnder`.

**Built (subtask 1).** `World.underAt(x, y)` reads 0 where no chunk exists and never generates one. `setUnder` also bumps `World.underVersion` on every real change, so the metro service can re-derive its lines after an edit from any source (a bore, the bulldozer, the seeder) without a hook. The snapshot writes `stopNames` always (an empty array when there are none). The client mirror is `ClientChunk.under`, `ClientWorld.underAt` and `ClientWorld.applyUnder`; an under change marks its chunk dirty. `worldHash` (`server/src/demo/seed.ts`) hashes the under bytes, the station names and the lines' names too (U8), so a demo's reset and its determinism check cover the tunnels.

Local mode stores the same snapshot in IndexedDB (`client/src/local/host.ts`), so it needs no change. `npm run local:check` already exercises the readers. Deploy note: a v7 server moves a v8 `world.json` aside, so never roll back across this.

**Station names.** `World.stopNames: Map<string, string>` is keyed by `tileKey` of the entrance. `World.stopLabel(x, y)` returns the name from the map, or `stopName(x, y)` when there is none. `World.setStopName(x, y, name)` sets one; null or an empty name removes it (built). The demo seeder sets real names. A rename box in the station panel is a follow-up. `Transit.describeStop` and the metro DTOs use `stopLabel`.

### Wire

- **Chunks.** `ChunkDTO.under?: string` is base64, omitted when all zero, and always sent with the chunk. There is no separate subscription. Most chunks have no tunnels and cost nothing extra. The normal view needs the bytes too, for the grates, the placement preview and the entrance tooltips.
- **Deltas.** `{ t: 'under', u: [x, y, byte, …] }` carries `dirtyUnder`, flushed in `Net.flush` just ahead of the `aux` stream, so before `tiles` (built). Boring a 30-tile leg sends one 90-number message.
- **Lines.** `{ t: 'metroLines', lines: MetroLineDTO[] }` goes to everyone on hello and whenever a line changes, like `railLines`. `MetroLineDTO` is `RailLineDTO & { names: string[] }`, with `RailLineDef.metro` set. The route travels as surface rail's does, about one byte per tile, so trains are drawn on chunks the client has not loaded.
- **Loads.** `{ t: 'metroLoads', l: [lineId, trains, load0, …] }` goes out every 25 ticks with riders per train, for the carriage crowds. That is about 300 numbers for 30 lines.
- **Citizen flag bit 18, underground** (`CITIZEN_UNDER` and `citizenUnder(f)` in `protocol.ts`, built; the metro ORs `CITIZEN_UNDER` into `packCitizenFlags`' result, which keeps its parameters; bits 19 and up are free). It is set while a citizen waits on a metro platform or rides a metro train. The surface draw skips these citizens, and the underground view draws them at platform depth.
- **Line previews.** `LinePreview` gains `bore?: number[]` (the new tiles, flat x, y), `crossovers?: number[]` and `cost?: number`.
- **Station tooltips.** `BuildingInfo.metro?: MetroStationInfo`: the platform, the lines calling with their next trains, today's riders, and "change here for".
- **Bulldozing.** `build` gains `under?: true`, which applies bulldoze to the under layer.

### Cost and upkeep

| Item | Cost |
| --- | --- |
| new tunnel tile | $60 |
| new tunnel tile under water | $150 |
| crossover over another line's tunnel | +$250 |
| tunnel that already exists | free |
| overrun at each terminus of a there-and-back line | 2 tiles at the tunnel price |
| entrance kiosk (`metro-entrance`) | $3,000, $40 a day, 4 station staff |
| station hall (`metro-station`) | $8,000, $120 a day, 14 station staff |

Boring is paid when the line is saved. Save is refused, with the amount, when the owner is short of money. Station upkeep is above rail's because it covers the tunnels' ventilation and pumping. Staff work rail's three turns (05:00, 13:00, 17:00).

## 2. Stations

**Built (U3):** the two kinds, their four designs, the cost, upkeep and staffing below, and `tr9` are in `shared/src/buildings/metro.ts` and `shared/src/tech.ts`. U8 undrafted both kinds once the Showcase placed them. The platform logic below is U2 and U4.

The stations are two Hub-family sub-kinds (docs/sub-kinds.md) from the 21-39 transport range (21 is the motorway connection, so 22 and 23), in a new `shared/src/buildings/metro.ts`:

| Kind | Id | Footprint | Platform | Designs |
| --- | --- | --- | --- | --- |
| metro-entrance | 22 | 1×1 | 4 tiles | a stair kiosk with railings and a roundel on a post; a glass escalator canopy |
| metro-station | 23 | 2×1, door `[0, 0]` | 6 tiles | an oxblood terracotta hall with arched windows; a brick drum with a glazed roundel frieze |

**The platform** is a straight run of N tiles in the under layer. Its middle tile, index ⌊N/2⌋, lies directly under the entrance's door tile. By default it runs along the street the entrance faces, since real platforms run under streets. Z and C turn it a quarter (`rot & 1`; `structureTool` in `client/src/input.ts` admits the two metro tools). Because the platform sits under the door, it can be derived from the layers alone:

- `metroStationAt(x, y, env)` reads the kind from the tile word and sub byte (22 or 23) and the platform's axis from the under byte beneath the door. It scans along the axis for the run of platform tiles and returns a `StationStop` (`shared/src/rail.ts`): `row`, `a0`, `a1`, `alongX` and `len`, with `doorX` and `doorY`.
- From any platform tile, the scan finds the run and its middle, and so the door.
- **Built (U2).** `metroStop(x, y, env)` returns the `StationStop` or `{ reason, at }`: "no metro station", "has no platform under it", or "is broken" when the run is not the kind's length with its middle under the door. `metroStationAt` is the same, returning null in place of the reason. `platformRun` finds the run through a tile. `platformSpan(kind, doorX, doorY, alongX)` says where a platform would lie. `metroStationBuilt(stop, env)` follows rail's `stationBuilt`.

The client and the server derive the same answer from the same bytes.

**Placement** uses `planPlatform(kindId, doorX, doorY, axis, env)` in `shared/src/metro.ts`, run by both the client preview and the server.

- **The surface part follows today's rules.** A kiosk goes through `Net.build`'s 1×1 civic branch, with the bus stop's checks: own land, dry, nothing built, `hasRoadAccess`. A hall goes through `planStructure`. Both open a `CIVIC_WORK` site as usual.
- **Each platform tile must be loaded, and either solid ground or a plain tunnel running straight along the axis.** So a station can go onto an existing tunnel. It may not be a crossover, a junction or another platform.
- **The tile beyond each end may not be a platform.** Two platforms never touch end to end, so a scan always finds where one stops.
- **The server then writes `0x30 | straight mask`.** A platform is usable once its entrance is built: level 1 or more and no site, as in `stationBuilt`.
- **Built (U2).** `planPlatform(kindId, doorX, doorY, alongX, env)` returns `{ ok, reason?, at?, stop, writes }`. The `stop` is returned even when refused, for the ghost. Its rules are the ones above, with one addition: a tunnel end along the axis is also accepted, so a station can go on an overrun. The caller picks `alongX`. With `rot` as the tool's turn, the default is `(rot & 1) === 0`, since `FRONT[0]` faces south and the street then runs along x.

**Removal.** Bulldozing the entrance clears the surface tile only. At its next rebuild (every 10 ticks) `Metro` turns a platform with no entrance above its middle back into plain tunnel (`0x10 | m`). No world hook is needed. Built (U2): `orphanPlatform(x, y, env)` returns the writes that revert the run through (x, y), or none while its station stands. Lines calling there are grounded with "waiting for the station at …", as rail does.

**Interchange is a short walk, with nothing new.** `Transit.bestTransit` already changes lines at the stop a rider got off at, or at any routed stop within `TRANSIT.transferWalk` (4 tiles), for `transferPenalty`.

- **Metro to metro:** two entrances within 4 tiles. Their platforms may not overlap, so they cross on different axes or sit offset.
- **Metro to rail:** an entrance within 4 tiles of the rail station's door, which is the rail stop.
- **Metro to bus:** an entrance within 4 tiles of a bus stop.

The entrance tooltip lists "change here for" every routed stop within that walk, with its lines. Multi-platform complexes under one entrance and second entrances are follow-ups. A second entrance would be an alias tile in `Transit.stopGrid` mapped to the platform's stop (Q3).

## 3. Lines

**Decision: click the stations, and the server bores the tunnel.** The tunnel persists in the under layer.

- Rich liked the click-stops editor from the bus work, and the line panel, preview and problem reporting are already mode-agnostic (`client/src/lines.ts`, `Transit.previewLine`).
- Drawing tunnels by hand on the surface is awkward, since you cannot see them. Auto-routing is easy underground because there are almost no obstacles: only other platforms and other lines' tunnels.
- Keeping the bored tunnel in a layer gives stable routes and real cost. Tunnels are reused for free, drawn in both views and bulldozable. Since `planBore` prefers existing tunnel, a hand "tunnel" drag in the underground view can come later as a cheap way to shape routes.

**The mode.** `TransitMode` gains `'metro'`, and `STOP_KINDS` gains 22 and 23. Lines live in the shared registry (`World.transitLines`, the store format v7 lines array, unchanged), are saved through `Transit.saveLine` and are edited in the Lines panel; the first stop clicked picks the mode. `TransitLine` gains an optional `name` ("Central"), which old worlds simply lack. `RAIL_LIMITS`-style caps: 2-16 stations, at most 12 trains, at most 24 metro lines per owner.

**Routing has two steps.**

1. **The bore plan.** `planBore(def, env, inUse)` lives in `shared/src/metro.ts`. `Metro.plan` serves the editor's preview with it, and `Metro.commit` uses it on save. Each leg is an A\* search over (tile, heading), as in `server/src/sim/busroute.ts` `planLap`. It runs from the exit end of one platform to either end of the next, plus a closing leg for a loop. As in `routeLine`, both directions out of the first station are tried. The costs are fixed, so the preview is what gets saved:

   | Step | Cost |
   | --- | --- |
   | onto existing tunnel that no line uses | 1 |
   | a new tile (under water) | 3 (5) |
   | a turn | +3 |
   | a turn on the tile right after a turn | +6, so there are no staircases |
   | straight across another line's straight tunnel, perpendicular | +4 (a new crossover) |
   | another platform (except entering the target's end), another line's curve, junction or crossover, a tile this line already used, off the map | refused |

   The search has a budget of 40,000 nodes, in the stations' bounding box plus a 24-tile margin. A there-and-back line adds a 2-tile overrun beyond each terminus. The plan returns the `LinePreview` fields: path, calls, callNodes, `bore`, `crossovers`, `cost`, length and a lap time. Or it returns a `LineProblem` that names the failing stop pair, marks the platform in the way and suggests a tile to move the entrance to.
   **Built (U2).** `planBore(def, env, inUse)` returns `{ ok: true, route, tiles, writes, bore, crossovers, cost, score }` or `{ ok: false, problem: LineProblem }`.
   - `inUse(x, y)` gives the sides other metro lines run on at a tile. Build it with `lineSides(route, env)` over every other line, overruns included. Re-planning a bored line, with its own sides left out of `inUse`, costs $0 and writes nothing.
   - The search's state is (tile, exit side, turned here), and it is deterministic: the heap breaks ties by insertion order.
   - Some costs are pinned down further than the table above. A new crossover costs a new tile plus 4, so 7, or 9 under water. Going straight across a crossover's free bore costs 1. Passing over or joining unused tunnel costs 1, and a move that would leave an unused tile with four sides must go straight.
   - The money is $60 a new tile, $150 under water, and $250 more for a crossover over another line. Overruns of up to 2 tiles are bored only into solid ground no line uses, and stop short otherwise.
   - It also refuses a station whose platform another line already runs on ("Another line already calls at …"), since lines share no platform.
   - A failed leg's `LineProblem` has `from`, `to` and `leg`. Its `tiles` mark the platforms the search ran into near the two stations, or the two doors when there are none. `fix` says whether platforms or other lines' tunnels are in the way. `suggest` is left for `Metro`, which knows the surface.
   - `route` is the line as bored. `routeNet` over the written layer finds it again, or a shorter route. U4 builds the `LinePreview` from it with `lapOf` and `railService`.
2. **The route** is derived from the layer. Refactor `routeLine` and `legSearch` in `shared/src/rail.ts` to read a `TrackNet { mask(x, y), loaded(x, y), stop(x, y): StationStop | string }` in place of `RailEnv`. `surfaceNet(env)` keeps rail exactly as it is, and `rail-check` must still find byte-identical routes. `underNet(env)` reads under bytes and `metroStationAt`. Everything downstream is reused unchanged: `RailRoute`, `railGeometry`, `railService`, `trainsAt`, `trainPoses`, `callsBetween`, `nextRide`, the route's wire form and `TrainsView`'s maths.

   **Built (U2).** In `rail.ts`, `TrackNet` is `{ mask(x, y), stop(x, y): StationStop | { reason, at }, noun? }`. `loaded` was not needed, since `mask` answers -1 where nothing is loaded. `routeNet(def, net)` is the shared search. `routeLine(def, env)` keeps its signature and is `routeNet(def, surfaceNet(env))`. rail-check's output and the demos' rail routes are byte-identical. `underNet(env, taken?)` sets `noun: 'tunnel'`, and `taken(x, y)` removes other lines' sides. A crossover another line runs through one way is straight on along the free axis only. `lineSides(route, env?)` and `overrunTiles(route, env)` give a line's tiles with their sides and its terminus overruns, for `taken`, `inUse` and the conflict check (two lines conflict where their sides meet). `stopTile`, `alongSide` and `trackKey` are now exported from `rail.ts`.

**Save.** A new optional hook, `ModeService.commit?(line, owner): string | null`, runs in `Transit.saveLine` before `route()`. `Metro.commit` plans the bore, refuses if the owner is short of money, writes the bytes, charges the owner and sets `pending`. `route()` then derives the line from the layer. `Metro.rebuild` re-derives every 10 ticks, and at the next tick after any under edit, as `Rail.rebuild` does.

**Sharing.** Lines never share tunnel. Two lines may share a crossover tile only if one runs north-south straight through it and the other east-west. `Metro`'s conflict check allows exactly that, where `Rail`'s refuses any shared tile.

**Trains** run surface rail's deterministic timetable, extended in `shared/src/rail.ts` for `RailLineDef.metro`:

- **Consist.** All cars: a driving motor car at each end (`RailVehicle.TubeCab` 7) and trailers between (`TubeCar` 8). A train has as many cars as the shortest platform has tiles (`CAR_PITCH` as today), so 4 or 6. A car carries 60 riders (`METRO.carRiders`), so a train takes 240 or 360.
- **Twin bores.** A there-and-back metro line runs out in one bore and back in the other, so it takes many trains, unlike a surface shuttle. The spacing check unfolds the cycle onto a loop of length 2L: position u = s outbound and 2L − s inbound. It then applies the loop rule, a train length plus `TRAIN_GAP` apart at every half tick. A train changes bore during its terminus dwell: a scissors crossover, drawn as a slide across in the middle of the dwell.
  - **Built (U2):** `unfoldedS(svc, tau, arrival?)`. A train standing at a terminus counts as in **both** bores. In the spacing check the leader counts where it came in (`arrival`) and the follower where it leaves. Counting only one bore, as first designed, would let a follower's nose reach a terminus platform while the train before it still stood there, in the bore it arrived by, before its slide across. With both bores counted, the rule keeps an arriving train off a terminus platform until the one before it has gone.
  - `metroBore(svc, train)` gives the bore for drawing: +1 is left of the route's forward direction, -1 the other, and a loop is always +1. At a terminus it eases from one to the other between 35% and 65% of the dwell.
- **Loops** run one way (Q4).
- **Built (U2):** `RailVehicle.TubeCab` 7 ("driving motor car") and `TubeCar` 8 ("tube car"). The consist ignores `cars`. `trainPoses` flips the rear motor car. `RailService.metro` is set, and `railService` ignores `metro` on a freight line. The timing lives in `rail.ts` `METRO_TIMING`, which `METRO` spreads, so `rail.ts` never imports `metro.ts`. U6 needs new client entries: `PLURALS` in `client/src/rail.ts`, and the vehicle types in `render/trains.ts`, which index by kind.
- **Timing** (`METRO`): line speed 0.55 tiles a tick, acceleration 0.045, dwell 3-5 ticks (10-14 at a terminus), up to 12 trains, service 05:00-01:00 (rail's `SERVICE_START_HOUR` and `SERVICE_END_HOUR`). Headway is cycle ÷ trains. Train i starts its first cycle at 05:00 + i × headway, as on the surface.
- **Depots and sidings.** v1 has no depot building and no drivers to staff. Trains appear at the first station as surface trains do, and overnight they are drawn stabled in the terminus overruns. Running costs are folded into station upkeep. A staffed depot that limits trains, like the bus depot, is a follow-up.
- **Vehicle ids.** `trainVehicleId(lineId, train)` is shared with rail, since line ids are unique across modes and 12 trains fit in its 16 slots.

## 4. Citizens

- **Mode choice is unchanged.** `Transit.bestTransit` offers metro lines beside buses and trains. `Metro.waitAt` is exact from the timetable. `Metro.rideTicks` is timetable time plus `METRO.access` (3 ticks a ride, for the stairs and escalators). The fare is the same $2, so children ride free and retirees pay half. Metro wins long trips because it is never in traffic. If ridership is thin, the knob to turn is a per-mode catchment, not a fare.
- **The trip** is ordinary legs (`Transit.legsFor`): a walk to the entrance tile (the stop), a ride leg, and a walk on from the destination entrance.
- **The wait.** A new optional `ModeService.waitSpot?(stop, citizenId): [x, y]`, used by `Transit.standAt`, puts the rider at a hash-seeded spot along the platform, on either side, and sets flag bit 18.
- **Boarding and alighting** go through `Transit.serveCall`, from `Metro.tick`, exactly as `Rail.tick` does: arrivals, latecomers while the doors are open, and everyone off at the end of the day.
- **The ride.** Riders on board move with `positionOf` (the train's centre) and keep bit 18, so they never appear walking on the street above the tunnel.
- **Drawing.** The underground view draws waiting riders on the platform. Riders in carriages come from `metroLoads`: per car, min(8, load ÷ cars) silhouettes, each with a hash-seeded seat or standing spot and its own clothes.
- **The citizen panel** reads "waiting for the Central line at Marble Arch" and "riding the Central line to Bank", using the line's `name` when it has one, else "line N".

## 5. Rendering

**The underground view.** Key **N** (free: M is the perf HUD) and an **under** chip beside **heat** toggle it. `setUnder(on)` in `client/src/main.ts` follows `setHeat`: it calls `ChunkView.setUnder` and sets `sceneUniforms.uUnder`, eased from 0 to 1 over 0.4 s. The view turns on by itself while a metro tool is picked or a metro line is being edited, and goes back to how it was afterwards.

- **The surface fades.** Buildings are ghosted: `render/materials.ts` mixes alpha towards 0.12 and desaturates with `uUnder`, and the ghost pass skips depth writes. The ground is semi-transparent (chunkView's ground opacity goes to about 0.3). Roads keep a faint outline. Surface walkers and vehicles dim to 0.3 (`render/citizens.ts`).
- **The network shows, Tube-map style** (`render/underground.ts`, `UndergroundView`). `scanChunk(key, chunk)` reads the under bytes, like `TrainsView.scanChunk`, into instanced pieces:
  - twin bores, straight, curved, stub, junction and crossover; at a crossover the north-south bore dips 0.4;
  - tunnels a line runs in, drawn saturated in that line's colour with a soft glow (the tile-to-line map comes from the `metroLines` routes), and unused tunnels in grey;
  - platforms as lit boxes with cream tiles, an edge strip in the line colour, roundel sprites and a floating station name.
- **Depth.** Track at y = −0.9 (`METRO_Y`), bore radius 0.16, the bores 0.2 either side of the centreline. Trains keep left: a train runs in the bore on the left of its direction of travel.
- **Trains** use a second `TrainsView`, built with options `{ y: METRO_Y, overhead: false, crossings: false, bore: 0.2 }`, and a tube car model: a rounded roof profile, doors in the line colour and an interior lit day and night. Clicking picks a metro train only while the view is on.
- **The normal view** shows the entrances (their catalogue models) and grates. A grate sits on a road or plaza tile above a tunnel, about one tile in five by hash. As a train passes beneath, a grate puffs steam on cold nights and lets a lit flicker through after dark. Following the organic rule (memory: msimcity organic effects), every grate has its own size, turn, rust tone, steam rate and phase. Every tunnel lamp has its own warmth and flicker, and every platform its own light colour.
- **The cab ride** (FPV, I or O on a selected metro train). `TrainsView.cabOf` already returns the eye, now at metro depth. `render/fpv.ts` switches to tunnel mode while the eye is below ground:
  - the background and fog go near black, and the sky and sun go off;
  - a pooled tunnel interior is rebuilt from the route geometry within ±15 tiles of the cab: rings every 0.25 tiles, a lamp on every fourth ring (each with its own warmth and flicker), cable runs, and the other bore's wall at junctions;
  - lit platforms with roundels and waiting riders flash past;
  - at a crossover the dip pitches the cab.

  The cockpit agent's train cab overlay (`render/instruments.ts`) is used unchanged, through `InstrumentFeed`.

**Built (U5), in `client/src/render/underground.ts` (`UndergroundView`), with small hooks in `main.ts`, `render/materials.ts` and `index.html`.** What differs from the sketch above:

- **No `ChunkView.setUnder` and no `ui.ts` edit.** The ground and buildings fade in their own shaders: `sceneUniforms.uUnder` (`materials.ts`) drives a cool desaturate and an alpha drop, ground to about 0.24 (roads 0.4) and buildings to 0.07, both with `depthWrite` off while the view is up. Everything else opaque and Lambert or Basic (cars, people, trees, bridges, signs, helicopters ...) is ghosted to 0.2 by material opacity: `UndergroundView.surface` lists the groups, collected once when a fade starts and restored when it ends, so the view costs nothing while off. Flipping `transparent` recompiles the affected programs once, on the first fade of a session. The building mesh stops casting shadows while the view is up. Sky, sun, hemisphere light and exposure ease toward a dark slate (`look`, called after `Lighting.update`). The fade takes 0.3 s.
- **The chip and key.** `#under` in `index.html` sits beside heat; N and the chip call `setUnder` in `main.ts`. The view comes on by itself while a metro station tool is picked and goes back when the tool is dropped, unless the player pressed N meanwhile. (Editing a line should do the same: U6 calls `setUnder(true, true)`.)
- **Tunnels** are, per chunk, a merged vertex-coloured `MeshBasicMaterial` mesh for the platforms and shafts (opaque), one for the bore tubes (50% see-through, `depthWrite` off, so trains running inside show from above) and one for the platform vaults, built lazily, two chunks a frame, only while the view is on, and again after any under change or `setLines`. A tile is twin bores (radius 0.16, 0.2 either side) with a collar every tile; curves are two concentric arcs, a junction is the through pair plus an arm, a stub has capped ends, and at a crossover the north-south pair dips 0.4 by `sin²`. A platform tile is an island platform between the two tracks with lit edges in the line colour, low cavity walls, a lamp panel per tile (its own brightness), a translucent vault, and, at the middle tile under the door, a shaft up to the street, a roundel on the platform and a beacon post with a roundel above the street so the entrance reads through the ghosted buildings.
- **The normal view** keeps only the grates: a dark frame with four slats on a road tile above a tunnel, about one in five by hash, each with its own size, off-grid turn, rust tone, jitter inside the tile, glow phase and rate (slats flicker warm or cool after dark) and, for about half, two steam puffs on `uNight` (a `Points` shader, rising and drifting at their own pace). The plates dim with the street at night. The entrances are the ordinary catalogue buildings. Station names and sprites are not drawn yet (names reach the client with U6's `metroLines`).
- **The placement preview** is `setPreview(stop, ok)`: the platform under the door ghosted green or red, drawn with the same piece code. `main.ts` computes it with `planPlatform` from the hovered door and the Z/C turn (`(r & 1) === 0` runs along x). The reason also joins the status line and turns the footprint red, because `hoverArea` downgrades the surface verdict when the platform is refused (the server's own verdict is U4's).

**Hooks for U6.**

- `underground.setLines([{ colour, sides }])`, with `sides = lineSides(route, env)` from shared/src/metro.ts for each metro line (call it from the `metroLines` handler; `[]` goes back to neutral). Used tiles take the colour of the line whose sides meet the bore's, so a crossover shows two colours. Tiles no line runs on go grey. Every chunk rebuilds on the next frame the view is up.
- `METRO_Y` is exported for the trains, and `underground.level` (0 to 1, eased) tells other render code how far the view is up (show waiting riders and carriages when it is above 0.5).
- Testing without U4: `msc.world.applyUnder([x, y, byte, ...])` writes under bytes into the client mirror (`0x1a` is an east-west tunnel, `0x3a` an east-west platform tile, `0x1f` a crossover), then `msc.setUnder(true)`. `msc.underground` is the view.

## 6. Tools and tech

- **Tech `tr9`, "Underground railway"** (built, `shared/src/tech.ts`): transport tier 7, requires `tr6` Rail and `con3` Deep foundations, condition 600 jobs, $8,000. It unlocks `['metro', 'metroentrance', 'metrostation']`. The feature id is `metro` because `underground` is already taken by Deep foundations, for underground parking.
- **Tools.** A size ladder, "Underground station", in the Transport group: the kiosk and the hall, chosen in the picker. It has no key, since every letter is taken. Z and C turn the platform.
  - **Built (U3).** The ladder is group `metro`, labelled "Underground", in `shared/src/buildings/groups.ts`, with tools `metroentrance` and `metrostation`. Both kinds were `draft` (the tool showed only with `?dev`) and the group set `draft: true`, until U8 placed them in the Showcase and dropped all three flags. `structureTool` in `client/src/input.ts` admits both kinds (`PLATFORM_KINDS`), so Z and C turn the 1×1 kiosk as well as the hall. The kiosk's server side still goes through the plain civic branch and ignores `rot`; U4 reads it for the platform axis.
- **Lines** use the existing **lines** chip.
- **Bulldozing** in the underground view works on tunnels.
- **The view** is always available, on N.

## 7. London and the Showcase

**Built (U8)**, as below, with these changes: Tottenham Court Road and Northern's Waterloo are kiosks (a hall's long platform left no room for the other line's entrance within the walk), and where neither a hall nor a kiosk fits with its platform along the line, the platform turns across it (Charing Cross; Waterloo's two kiosks stand side by side, both platforms north-south). docs/demo.md "London" has what was built: about 290 tunnel tiles, 128 platform tiles and three crossovers.

**London: a new section, `london-tube` ("The Underground"),** after Rail and Heathrow. Every station targets its real place with `geo()` (`shared/src/demo/londonMap.ts`). `fitEntrance(target, axis)` in `shared/src/demo/london.ts` then takes the nearest tile, spiralling out, that meets all of these:

- on the town's land beside a road, dry;
- not a railway corridor;
- off the landmark tiles;
- with room for the platform along the line's axis.

A station that interchanges with a rail terminus targets that station's door instead, so the entrance lands within the 4-tile change walk.

The first three lines, with tiles from `geo()`. A fourth, the Circle, is a stretch goal.

| Line | Colour | Shape | Stations (tile) |
| --- | --- | --- | --- |
| Central | `0xdc241f` | there and back, 8 trains | Shepherd's Bush (-58, 2), Notting Hill Gate (-49, -1), Marble Arch (-33, -4), Tottenham Court Road (-21, -6), St Paul's (-7, -5), Liverpool Street (rail door), Bethnal Green (10, -13), Mile End (19, -12), Stratford (rail door) |
| Northern | `0x000000` (drawn as dark grey) | there and back, 8 trains | Camden Town (-26, -21), Euston (-22, -14), Tottenham Court Road (-20, -6), Charing Cross (-19, 0), Waterloo (rail door), Kennington (-11, 13), Stockwell (-18, 23), Clapham Common (-24, 30), Balham (-30, 43) |
| Jubilee | `0xa0a5a9` | there and back, 8 trains | Baker Street (-32, -10), Green Park (-26, 0), Westminster (-19, 4), Waterloo (rail door), London Bridge (-3, 1), Canada Water (12, 6), Canary Wharf (25, 3), North Greenwich (35, 5), West Ham (36, -14), Stratford (rail door) |
| Circle (stretch) | `0xffd329` | loop, one way | Paddington, Baker Street, King's Cross St Pancras, Farringdon, Liverpool Street, Tower Hill, Embankment, Westminster, Victoria, South Kensington, High Street Kensington, Notting Hill Gate |

Stations with fewer than 6 tiles between them along a line were left out, such as Oxford Circus beside Tottenham Court Road. Where they show:

- **Crossovers:** Central and Northern at Tottenham Court Road; Jubilee and Northern near Waterloo.
- **Under the Thames:** Northern and Jubilee.
- **Interchanges:** Central and Northern at Tottenham Court Road and Northern and Jubilee at Waterloo, by walk; with rail at Liverpool Street, Stratford and Waterloo.

The halls (6-tile platforms) go at the termini and the big interchanges. Kiosks go everywhere else. Names come from `stopNames`, and each line has its `name`. The section's tour stops are Tottenham Court Road, the Waterloo crossover (with the underground view on) and a Jubilee train at Canary Wharf.

**The Showcase.** One underground line in the `rail` section ("Rail and freight"):

- three stations, there and back, 2 trains;
- one kiosk within 4 tiles of the showcase's rail station door;
- a hall within 4 tiles of a bus stop;
- the tunnel passing under a road and a built block.

What `demo:check` enforces:

- The kinds are placed (the placeable-kind rule) and `LINE_MODES` gains `metro`, which the typecheck forces.
- `SHOWCASE_FEATURES` gains `metro-interchange`. Its `seeded` test looks for a metro entrance within `TRANSIT.transferWalk` of a routed stop of another mode, and its tour stop is `metro-interchange`.
- It also gains `metro-crossover`, with `demo: 'london'` and the rule "the showcase runs one underground line; lines cross in London". Its test is a mask-15 under byte in London.
- `DemoSpot` gains `view?: 'under'`, so `client/src/tour.ts` turns the underground view on for that stop.
- `DemoSection` gains nothing: metro lines are `lines` entries with `mode: 'metro'`. The seeder places entrances through the planner and saves lines through `Transit.saveLine` with `commit`, as a player does.
- **Built (U8).** The Showcase's line is the Crosstown, metro line 1 (docs/demo.md "The scenario"): kiosks at (17, -36), 3 tiles from the rail station's door, and (27, -19) by the arena, and a hall at (27, -2), 2 tiles from bus line 1's stop at (25, -2); 39 tiles bored under roads and blocks, 2 trains of 4 cars. The tour stops at the kiosk, the line and the hall. `DemoPlacement.name` names a station (`setStopName`) and titles its tour stop ("Metro entrance: Station Road"); `DemoLine.name` names the line. `metro-interchange`'s test is a metro line calling within the change walk of a bus or rail line's stop, over the scenario and over the saved lines (`SeededDemo.lines`); `metro-crossover`'s is an under byte with mask 15 in London (`SeededDemo.scan` passes the under byte), with the tour stop `tube-crossover`. `DemoSpot.view` and `TourStop.view` are `'under'`, set on every metro line's stop and the crossover spot, and `client/src/tour.ts` turns the underground view on there (through `setUnder`, passed in by `main.ts`) and off at the next stop. The seeder (`seedDemoNetwork`) lays each station's platform with `Metro.platformFor` on the placement's turn and `Metro.lay`, names it, then saves the lines with their names; it registers a `Metro` itself when the caller has none (demo:check and the load tests build their own `Rail`).
- **Staging (done):** the two kinds stayed `draft: true` until the showcase subtask landed, and `showcaseProblems` skips a line mode whose stop kinds are all drafts. That is a two-line change, landed with the metro service, and it keeps `demo:check` green in between.

## 8. Checks

- **Part one, built (U2):** `npx tsx packages/shared/scripts/metro-check.ts [days]` runs on a fake `MetroEnv` over plain maps, with no World. It checks:
  - the byte: all 256 values;
  - platforms: placed, and refused in 9 ways;
  - stations: found from the door, the footprint and every platform tile, broken and orphan platforms included;
  - three lines bored in turn: a there-and-back line under a river, a second crossing the first at a crossover, and a one-way loop. Each is bored twice, the same on a copy and under a cluttered surface. Its cost is checked tile by tile, and its derived route is checked against the bore, the other lines' sides and the platform middles. Overruns, re-planning for $0, and 6 refusals are checked too;
  - over whole days at every half tick: unfolded spacing, with terminus dwells in both bores; no tile shared by two trains of a bore; bogies on the line's tiles (overruns included); service hours, dwells, calls and `nextRide`.

  It passes about 519k checks in about 12 s.
- **Part two, built (U8)**, below, in the same script after part one.
- **`npx tsx packages/shared/scripts/metro-check.ts [days]`**, like rail-check. It builds a server World with entrances, bores three lines through `Metro.commit` (one crossing another, one under water), mirrors the chunks into a ClientWorld and checks:
  - `planBore` is deterministic, and preview equals save;
  - the route derived from the layer is the bored path or shorter, and uses no other line's tile except at crossovers;
  - `metroStationAt` agrees on both sides, from the door and from every platform tile;
  - over whole days at every half tick: trains in the same bore stay a train length plus the gap apart (the 2L unfolding), every bogie is on the line's tiles, no train runs before 05:00, every train dwells at every station, every call is a dwell, and `nextRide` gets there;
  - the refusals hold: platforms that overlap or touch end to end, a crossing at a junction or a platform, shared tunnel, short of money, a single station;
  - the snapshot round-trips: v7 loads with zero under bytes, and v8 saves and loads them byte-identical;
  - the bulldoze rules hold: a used tunnel cannot be filled, and an orphan platform reverts to tunnel.

  As built, it runs on a server World with a `Simulation` and the `Metro` service registered with its transit registry, the same stations as part one (the Central under a 4-tile river, the Northern crossing it, a 4-station loop): platforms laid by `platformFor` (and refused across and end to end with another), the lines saved through `Transit.saveLine` with the preview (`Metro.plan`, run twice) equal to what the save bored, charged and left in `lastBore`, a second save costing $0, and the cost checked tile by tile. The routes the service derives are checked against the layer and each other, `metroStationAt` against a ClientWorld fed the chunk DTOs (57 probes), and the server lines' timetables go through part one's whole-day checks (`trainChecks`). The refusals are one station, a platform another line calls at, another owner's stations, short of money and another line's tunnel; crossing at a junction or a platform is part one's. The snapshot round-trips byte-identical with the names, a v7 snapshot loads with an empty layer, the bulldozer refuses a used tunnel and a platform and fills an unused one, cutting its neighbours' joints, and a bulldozed kiosk's platform reverts and grounds its loop. Both parts pass 1,037,654 checks in about 8 s.
- **`rail-check.ts`** stays green and byte-identical after the `TrackNet` refactor.
- **`npx tsx packages/server/src/loadtest/metro.ts [--districts 3] [--hours 24] [--from 0] [--off] [--no-fill]`** (built, U4). It works on a `seedCity` test city (3×3 districts, about 10,500 citizens) with the bus network of `loadtest/ab.ts` in the middle district. Everything goes through `Net.handle` with a fake client:
  - the stations are placed with the metro tools: a hall at each end of line A, kiosks elsewhere;
  - the lines are previewed and saved with the Lines panel's messages;
  - an entrance and tunnels are bulldozed at the end.

  Line A, "Central", runs east-west: 6 stations, 40 tiles bored, $2,400. Line B, "Northern", runs north-south: 6 stations, 44 tiles with one crossover under A, $2,950. seedCity's commutes are a few tiles, and no train wins those. So after the fill, half the workers living in the district at one end of each line swap workplaces with workers of the same kind at the other end.

  It asserts:
  - the preview is what the save bores, routes and charges, and a second save costs $0;
  - B crosses A at exactly one crossover;
  - a station another line calls at is refused with a suggested tile, and a single station is refused;
  - every station gets exactly the timetable's calls in the window;
  - riders board and alight on both lines, trips go by metro, and some change between the metro and a bus;
  - only riders on a platform carry `CITIZEN_UNDER` on the wire;
  - nobody waits past their give-up time, and nobody is on board a vehicle that is not running;
  - a bulldozed entrance's platform turns back into tunnel and grounds its line;
  - a used tunnel cannot be filled, and an unused one can.

  On 2026-10-18 the 24 hours from 00:00 passed all 46 checks:
  - 158 metro rides (Central 57, Northern 101) and 1 metro-bus change. The bus depot had no drivers on shift that day, so the buses barely ran.
  - Peak platform crowd 8, peak train load 7, 1 give-up.
  - `Metro.tick` 0.12 ms a tick against 0.018 with `--off` (no lines). `bestTransit` 0.107 ms a tick against 0.022: with two more lines its 5,363 calls took 48 µs each against 10.
  - So the metro adds about 0.19 ms a tick, within the +0.3 ms budget. Whole-tick averages (58 against 34 ms) were taken while other agents' jobs shared the machine and are noise.
- **`npm run demo:check`**, then `npx tsx packages/server/src/demo/check.ts --fill --run 1`. The run report gains riders per metro line and peak train load. The London run must show every Tube line running. Built (U8): the seeding prints each metro line's status and the tunnel, platform and crossover tiles bored; the run prints each line's trains and headway, trips planned by metro, changes by mode pair, the peak train load and `Metro.tick`'s cost, and `--no-tube` runs London without the Underground for the tick cost. Numbers below, under U8 in section 9.
- **`npm run typecheck`**, which ends with `local:check`. The metro code is pure, so the worker bundle check covers it. Then `npm run buildings:check`.

## 9. Phased plan

"opus" is for the simulation, the protocol and shared logic. "sonnet" is for UI, rendering and demo data. Sizes: S about 30 minutes, M about 45-60, L about 75-90.

| # | Subtask | Model | Depends on | Parallel-safe with | Size |
| --- | --- | --- | --- | --- | --- |
| 1 | Under layer, persistence and wire | opus | none | 2, 3 | M |
| 2 | Shared metro logic: `TrackNet` refactor, `planBore`, platforms, twin timetable | opus | none | 1, 3 | L |
| 3 | Kinds, designs, tech, tool ladder | sonnet | none | 1, 2 | M |
| 4 | `Metro` mode service and server wiring | opus | 1, 2, 3 | 5 | L |
| 5 | Underground view: fade, tunnels, platforms, grates, placement preview | sonnet | 1, 2 | 4 | L |
| 6 | Metro trains, riders and the Lines editor | sonnet | 4, 5 | 8 | M-L |
| 7 | Cab ride through the tunnels | sonnet | 6, and the cockpit agent's `fpv.ts` work landed | 8 | M |
| 8 | Showcase, London Tube, demo:check, metro-check and loadtest | opus | 4 (and 3) | 6, 7 | L |

Order of play, about 4.5 hours: **1 ∥ 2 ∥ 3** → **4 ∥ 5** → **6 ∥ 8** → **7**.

1. **Under layer, persistence and wire.** Built.
   - World: `World.under*` (`underAt`, `setUnder`, `dirtyUnder`, `stopNames`, `stopLabel`).
   - Snapshot v8.
   - Protocol: `ChunkDTO.under`, the `'under'` delta and flag bit 18 helpers.
   - Net: the chunk DTO and the flush.
   - Client: `ClientWorld` mirror and `underAt`, plus the message case in `main.ts`.
   - Files: `server/src/world.ts`, `server/src/snapshot.ts`, `shared/src/protocol.ts`, `server/src/net.ts`, `client/src/world.ts`, `client/src/main.ts` (a few lines).
   - It only moves bytes and does not need the encoding's meaning. `protocol.ts`, `net.ts` and `main.ts` are being edited by other agents right now, so rebase onto them.
2. **Shared metro logic.** Built.
   - In `shared/src/rail.ts`: the `TrackNet` refactor of `routeLine`, `legSearch` and `stationTrackProblem`; `RailLineDef.metro`; the tube consist kinds; and the twin-bore spacing and `METRO` timing in `railService`.
   - New `shared/src/metro.ts`: the encoding, `planPlatform`, `metroStationAt`, `underNet` and `planBore`.
   - `shared/scripts/metro-check.ts` part one: a pure `RailEnv` fake, no World needed.
   - `rail-check` must stay byte-identical.
3. **Kinds, designs, tech, tool ladder.**
   - `shared/src/buildings/metro.ts` and its registration, with four designs, kinds marked `draft`.
   - The compiled tables (`buildings:compile`).
   - `tr9` in `shared/src/tech.ts`.
   - `STOP_KINDS` and `TransitMode` `'metro'` in `shared/src/transit.ts`, adding `metro: true` to `LINE_MODES` with the draft-skip in `showcaseProblems`. Coordinate with the showcase agent on `showcase.ts`: two lines.
   - The ladder in `client/src/picker.ts` / `shared/src/buildings/groups.ts`, and Z/C in `client/src/input.ts`.
   - Then run `buildings:check`.
4. **The `Metro` mode service.**
   - New `server/src/sim/metro.ts`, the `ModeService`: `stopProblem`, `plan`, `commit`, `route`, `waitAt`, `rideTicks`, `headway`, `inService`, `problem`, `tick`, `lineChanged`, `positionOf`, `waitSpot`, orphan-platform cleanup, `dtos`, `loads`, `describeStation`, `describeTrain`.
   - Extract the line-running half of `Rail` (`derive`, `rebuild`, `sync`, `serve`, `finish`, `withdraw`) into a base class, `server/src/sim/timetabled.ts`, that both extend, rather than copying 200 lines.
   - `Transit`: the `commit` and `waitSpot` hooks, an underground test for the flag, and `name` on lines.
   - Wiring in `server/src/game.ts`, which local mode gets for free.
   - `net.ts`: platform placement after the kiosk or hall, the `under` bulldoze, `metroLines`, `metroLoads`, routing `inspectTrain` by mode, and flag bit 18.

   **Built (U4).**
   - **`server/src/sim/timetabled.ts`, `Timetabled`**, is the line-running half of rail, which `Rail` and `Metro` both extend. It keeps each line's route, service and status, re-derives them (every 10 ticks, and at the next tick after `pending`), answers the timing questions, and serves calls, day ends and withdrawals. A mode supplies `def`, `network` (its route now, or why not), `unbuilt` and `capacity`. `trainVehicleId` lives there; `Rail` keeps the track, crossings, freight and its tooltips. Rail is unchanged: rail-check's output is the same, and so are the demo hashes. A seeded fill and day of the transport demo printed byte-identical transit and freight counters, line wire forms and station tooltips with this `Rail` and with HEAD's. A second run of HEAD's own `Rail` differed slightly, since a run is not exactly repeatable.
   - **`server/src/sim/metro.ts`, `Metro`** (mode `'metro'`, `under: true`):
     - **Routes.** `route` and `network` are `routeNet` over `underNet`, with every other routed line's sides taken (`lineSides`, overruns included). While re-deriving, earlier lines count as just derived and later ones as they were, so a line keeps its tunnel. When a line cannot be routed but could be with the other tunnels open, its status names the line whose tunnel it would run in. `rebuild` is skipped when nothing it reads has changed: `World.underVersion`, the metro lines and their stops, the station doors' tile words and the registry's verdicts.
     - **The editor.** `plan` is `planBore` as a `LinePreview`, with `bore`, `crossovers`, `cost` and `lapTicks` (the timetable's cycle). It is refused, with the amount, when the owner is short of money, and at `METRO.linesPerOwner` lines. `commit` plans again, writes the bytes, charges the owner (ledger `build`), sets `pending` and leaves `lastBore` for the save toast. A second save of a bored line costs $0.
     - **Problems.** Messages name stations by `World.stopLabel` and their number on the line. For a leg that cannot be bored, `suggest` is a tile within the change walk of either station where a kiosk's platform would let the leg through. Each candidate is tested with `planBore` on an overlay of the layer, with the old platform as plain tunnel; at most 4 are tried. "Another line already calls at" suggests a free tile within the walk for a second entrance. A broken platform's fix is to rebuild the entrance.
     - **Riders.** A train carries cars × `METRO.carRiders`, and `rideTicks` adds `METRO.access`. `waitSpot` puts a rider at a hash-seeded spot along the platform, 0.30 to 0.42 tiles to either side of the track.
     - **Platforms.** `platformFor(kind, doorX, doorY, rot?)` gives the writes or the reason, and `lay(writes)` applies them. With no turn a kiosk faces its road (`kioskTurn`, below). Every 10 ticks a platform whose entrance has gone is turned back into tunnel (`orphanPlatform`). The platform runs come from a full scan of the layer, made again after any under edit.
     - **Tunnels.** `fill(player, x, y, anyLand)` is the underground bulldozer. It refuses a platform, a tile any routed line runs on (overruns included) and, outside a sandbox, a tile under someone else's parcel. The neighbours' joints to the filled tile are cut, as `Rail.removeTrack` does.
     - **Wire.** `loads` is refreshed every 25 ticks, with `loadsChanged` set when it moved. `dtos()` is `MetroLineDTO[]`, rail's form with `names` from `stopLabel`; `def.name` is the line's name, or "Line N". `describeStation` and `describeTrain` answer the tooltips.
   - **`shared/src/metro.ts`** gained `kioskTurn(x, y, tile)` and `platformAlongX(rot)`, so the client's ghost platform matches the server. A kiosk with no turn faces the first road beside it: south, east, west, then north (FRONT 0, 1, 3, 2), as a 1×1 building is drawn. A hall takes the turn `planStructure` gives it. The platform runs along x when `(rot & 1) === 0`.
   - **`Transit`** (`sim/transit.ts`):
     - optional `ModeService.commit`, `waitSpot` and `under`;
     - `isUnder(c)`, and `stopsAround(x, y, r)` for "change here for";
     - `TransitLine.name`, set on save (trimmed to 24 characters) and kept when a re-save leaves it out;
     - stop names through `World.stopLabel` in `describeStop`, the citizen panel ("waiting for the Central line at …") and the draft errors.
   - **`Simulation.agents`** yields `under` for a rider standing on a platform: waiting, or still stepping aboard. Riders on board are not drawn, as on a bus. `Net` ORs `CITIZEN_UNDER` into the packed flags, in the chunk snapshot and in the stream.
   - **`net.ts`**:
     - The 1×1 civic branch (kiosk) and `placeStructure` (hall) refuse with `platformFor`'s reason, and lay the platform with the site.
     - `{ t: 'build', tool: 'bulldoze', under: true }` goes to `fillTunnels`.
     - `inspectTrain` falls through to `Metro.describeTrain`, and `BuildingInfo.metro` is filled for kinds 22 and 23.
     - `metroLines` is sent on hello and when `changed`; `metroLoads` on hello and when `loadsChanged`.
     - A metro save toasts the tunnel bored and its cost.
   - **The wire, as built:**
     - `MetroLineDTO extends RailLineDTO { names }`.
     - `MetroStationInfo extends RailStationInfo` adds `name`, `platform?: [x0, y0, x1, y1]` and `changes: { name, x, y, mode, lines: { id, number, name?, colour }[] }[]`. Its `track` reads "open", "opens when the entrance is built", or what is wrong with the platform.
     - `{ t: 'metroLoads', l: [lineId, trains, load0, …] }`, by train index.
     - `LinePreview.bore`, `crossovers` and `cost`, and `build.under`.
   - **Wiring.** `game.ts` registers `Metro` after `Rail` and sets its sandbox, so local mode has it. `demo/check.ts` and the demo seeder build their own `Rail`; since U8 the seeder registers a `Metro` beside it when the scenario has stations.
   - **Checks.** `npx tsx packages/server/src/loadtest/metro.ts [--districts 3] [--hours 24] [--from 0] [--off]`, below in section 8, as built.
5. **The underground view.** Built, see section 5. Files: `client/src/render/underground.ts` (new), `render/materials.ts` (`uUnder` and two shader snippets), `main.ts` (the view, N, the chip, the preview, the verdict) and `index.html` (the chip). `render/chunkView.ts` and `ui.ts` needed no change.
   - New `client/src/render/underground.ts`.
   - Edits to `render/materials.ts` (`uUnder`), `render/chunkView.ts` (`setUnder`, the ground fade), `client/src/ui.ts` (the chip) and `main.ts` (N, `setUnder`).
   - The placement preview: a ghost platform and the reason from `planPlatform` in the status line (`render/footprint.ts`).
   - It works from under bytes alone, before 4 lands, and can be tested by writing bytes from the console.
6. **Trains, riders, editor.** Built (U6).
   - **Trains.** One `TrainsView` runs both modes, because line ids are unique and selection, hover, `inspectTrain`, the panel and `cabOf` all go by line id. `setMetroLines` (from the `metroLines` handler) adds the metro services; `trains.under`, a group of its own beside `trains.group`, holds tube cars 7 and 8, their lamps and the carriage riders, so the underground view's ghosting (by material, on `surface`) leaves them alone. `main.ts` sets `trains.level = underground.level` each frame: the trains draw above 0.04, and are pickable and show their riders above 0.5. A train sits `metroBore(svc, st) * 0.2` to the left of the route's heading, at the rail head of the bores (`METRO_Y - 0.145`), and `cabOf` returns the eye there too (the hook for U7). Tube cars are a squat barrel-roofed model that fits the 0.16 bore, silver (or, one train in four, painted in the line colour) with the doors and stripe in the line colour; every car has its own grime and its own saloon lamp warmth, lit at every hour. `PLURALS` in `client/src/rail.ts` has the two new kinds; the tooltip and panel say "tube train" and use the line's name.
   - **Carriage riders** come from `metroLoads` (`trains.setLoads`): riders per train over its cars, up to eight head-and-shoulders silhouettes per car against the lit windows, each at its own window spot, seated or standing, in its own clothes.
   - **Platform riders.** `CitizensView` keeps CITIZEN_UNDER agents out of the surface draw. Above underground level 0.5 they are drawn from a `Crowd` of their own (`citizens.under`, with its own material, since the shared people material is ghosted with the surface) on the island platform at `METRO_Y - 0.07`: the server's 0.30 to 0.42 tile spread either side of the track is squeezed onto the island, each faces its track. `platformAlongX` (set by `main.ts` from the under byte) gives the axis. The ghost-free group needs `scene.add(citizens.under)`.
   - **The Lines editor** (`lines.ts`) has a metro mode: the first metro station clicked picks it, the underground view comes on by itself (`onUnder`, through `setUnder(true, true)`) and goes back when the editing ends, a name field is saved as `line.name`, and the station names come from `metroLines`. The draft is drawn at tunnel depth with the depth test off: the route, an amber square on every new tunnel tile (`preview.bore`), a ring on every new crossover, the cost and tile count in the panel and on the Save button, and, on a refusal, the red leg and platforms and the `problem.suggest` tile in green. Saved metro lines draw no ribbon (the tunnel, in the line's colour, is the drawing).
   - **The station tooltip and panel** (`metroStationHtml` in `client/src/rail.ts`, from `BuildingInfo.metro`): name, platform state, the lines with colour chips, their next trains, the crowd on the platform (counted client side from the citizens drawn there; the server does not send it), the day's calls and riders, and "change here for".
   - Files: `render/trains.ts`, `render/citizens.ts`, `render/people.ts` (`Crowd`'s `own` flag), `lines.ts`, `rail.ts`, `vehicles.ts`, `ui.ts`, `main.ts`.
   - Follow-ups for U7: `trains.cabOf` already returns the metro eye; the tunnel interior pool is U7's.
7. **Cab ride.**
   - Tunnel mode in `render/fpv.ts`.
   - The tunnel interior pool in `render/underground.ts`.
   - The feed into the existing instruments. Do not edit `instruments.ts`.
8. **Showcase and London.** Built; see section 7 and the U8 notes below.
   - `shared/src/demo/showcase.ts` (line, features, captions, tour, `DemoSpot.view`), after the showcase agent has landed.
   - `shared/src/demo/london.ts` (`london-tube`, `fitEntrance`), `server/src/demo/seed.ts` (placement, then `saveLine` with commit, then `stopNames`) and `server/src/demo/check.ts` (the report).
   - The `view` in `client/src/tour.ts`.
   - `metro-check` part two (World-based) and `server/src/loadtest/metro.ts`.
   - Undraft the kinds.
   - Reset the London and Showcase demos.
   - Update docs/demo.md, docs/sub-kinds.md (ids 22, 23), docs/aux-layer.md (point to the under layer) and docs/transit.md ("Other modes").

**Who touches what.**

- 1 owns the world, snapshot and wire files. 2 owns `rail.ts` and `metro.ts`. 3 owns the catalogue and tech. They never edit the same file.
- 4 and 5 share no file: 4 is server and shared, 5 is client render. Both read `metro.ts`, which neither changes; a missing helper is asked of whoever owns 2.
- 6 and 8 share only `client/src/tour.ts`, which 8 alone edits.
- 7 runs last because `fpv.ts` is in use by the cockpit agent.

## 10. Open questions for Rich

1. **May tunnels run under anyone's land?** Default: yes. Tunnels go anywhere on the map, nobody owns them, and only the entrance must be on your land. Filling unused tunnel is limited to tunnels not under another player's parcel.
2. **Shared tunnel and branches.** Default: no sharing in v1, and lines cross only at crossovers, as surface rail has no shared track until signals. A Northern-style branch means two lines from one interchange.
3. **Interchange.** Default: separate entrances within the 4-tile walk, at most one platform per entrance. Shared multi-platform stations and second entrances become a follow-up card.
4. **Loops run one way.** Default: yes, so the Circle runs clockwise only. Running both ways (a train set per bore) is a follow-up option on the line.
5. **Pricing and gate.** Default: `tr9` at $8,000 after Rail and Deep foundations with 600 jobs; tunnel $60 a tile ($150 under water); kiosk $3,000 with a 4-car platform and hall $8,000 with a 6-car platform; no staffed depot in v1, so trains are limited only by spacing (at most 12).
