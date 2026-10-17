# Underground railways (design)

UTD card 94a665f8. Rich: "we need stations and lines similar to buses but working underground". This is a design; nothing is built yet. Section 9 splits it into subtasks for one work window, and section 10 lists the open questions, each with a default so work need not wait.

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

### Persistence

**Snapshot v8** (`server/src/snapshot.ts`):

- `chunks[].under` is stored as base64, only when the layer is not all zero.
- `stopNames?: [x, y, name][]` holds station names (below).
- v7 and older worlds upgrade in place, with zero under bytes and no names. `UPGRADES_FROM` gains 7.
- `World.setUnder(x, y, v)` marks the chunk modified, so it is saved, and records the tile in `World.dirtyUnder`.

Local mode stores the same snapshot in IndexedDB (`client/src/local/host.ts`), so it needs no change. `npm run local:check` already exercises the readers. Deploy note: a v7 server moves a v8 `world.json` aside, so never roll back across this.

**Station names.** `World.stopNames: Map<string, string>` is keyed by `tileKey` of the entrance. `World.stopLabel(x, y)` returns the name from the map, or `stopName(x, y)` when there is none. The demo seeder sets real names. A rename box in the station panel is a follow-up. `Transit.describeStop` and the metro DTOs use `stopLabel`.

### Wire

- **Chunks.** `ChunkDTO.under?: string` is base64, omitted when all zero, and always sent with the chunk. There is no separate subscription. Most chunks have no tunnels and cost nothing extra. The normal view needs the bytes too, for the grates, the placement preview and the entrance tooltips.
- **Deltas.** `{ t: 'under', u: [x, y, byte, …] }` carries `dirtyUnder`, flushed in `Net.flush` next to the `aux` stream, before `tiles`. Boring a 30-tile leg sends one 90-number message.
- **Lines.** `{ t: 'metroLines', lines: MetroLineDTO[] }` goes to everyone on hello and whenever a line changes, like `railLines`. `MetroLineDTO` is `RailLineDTO & { names: string[] }`, with `RailLineDef.metro` set. The route travels as surface rail's does, about one byte per tile, so trains are drawn on chunks the client has not loaded.
- **Loads.** `{ t: 'metroLoads', l: [lineId, trains, load0, …] }` goes out every 25 ticks with riders per train, for the carriage crowds. That is about 300 numbers for 30 lines.
- **Citizen flag bit 18, underground** (`citizenUnder(f)` in `protocol.ts`; bits 18 and up are free). It is set while a citizen waits on a metro platform or rides a metro train. The surface draw skips these citizens, and the underground view draws them at platform depth.
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

The stations are two Hub-family sub-kinds (docs/sub-kinds.md) from the 21-39 transport range (21 is the motorway connection, so 22 and 23), in a new `shared/src/buildings/metro.ts`:

| Kind | Id | Footprint | Platform | Designs |
| --- | --- | --- | --- | --- |
| metro-entrance | 22 | 1×1 | 4 tiles | a stair kiosk with railings and a roundel on a post; a glass escalator canopy |
| metro-station | 23 | 2×1, door `[0, 0]` | 6 tiles | an oxblood terracotta hall with arched windows; a brick drum with a glazed roundel frieze |

**The platform** is a straight run of N tiles in the under layer. Its middle tile, index ⌊N/2⌋, lies directly under the entrance's door tile. By default it runs along the street the entrance faces, since real platforms run under streets. Z and C turn it a quarter (`rot & 1`; `structureTool` in `client/src/input.ts` admits the two metro tools). Because the platform sits under the door, it can be derived from the layers alone:

- `metroStationAt(x, y, env)` reads the kind from the tile word and sub byte (22 or 23) and the platform's axis from the under byte beneath the door. It scans along the axis for the run of platform tiles and returns a `StationStop` (`shared/src/rail.ts`): `row`, `a0`, `a1`, `alongX` and `len`, with `doorX` and `doorY`.
- From any platform tile, the scan finds the run and its middle, and so the door.

The client and the server derive the same answer from the same bytes.

**Placement** uses `planPlatform(kindId, doorX, doorY, axis, env)` in `shared/src/metro.ts`, run by both the client preview and the server.

- **The surface part follows today's rules.** A kiosk goes through `Net.build`'s 1×1 civic branch, with the bus stop's checks: own land, dry, nothing built, `hasRoadAccess`. A hall goes through `planStructure`. Both open a `CIVIC_WORK` site as usual.
- **Each platform tile must be loaded, and either solid ground or a plain tunnel running straight along the axis.** So a station can go onto an existing tunnel. It may not be a crossover, a junction or another platform.
- **The tile beyond each end may not be a platform.** Two platforms never touch end to end, so a scan always finds where one stops.
- **The server then writes `0x30 | straight mask`.** A platform is usable once its entrance is built: level 1 or more and no site, as in `stationBuilt`.

**Removal.** Bulldozing the entrance clears the surface tile only. At its next rebuild (every 10 ticks) `Metro` turns a platform with no entrance above its middle back into plain tunnel (`0x10 | m`). No world hook is needed. Lines calling there are grounded with "waiting for the station at …", as rail does.

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
2. **The route** is derived from the layer. Refactor `routeLine` and `legSearch` in `shared/src/rail.ts` to read a `TrackNet { mask(x, y), loaded(x, y), stop(x, y): StationStop | string }` in place of `RailEnv`. `surfaceNet(env)` keeps rail exactly as it is, and `rail-check` must still find byte-identical routes. `underNet(env)` reads under bytes and `metroStationAt`. Everything downstream is reused unchanged: `RailRoute`, `railGeometry`, `railService`, `trainsAt`, `trainPoses`, `callsBetween`, `nextRide`, the route's wire form and `TrainsView`'s maths.

**Save.** A new optional hook, `ModeService.commit?(line, owner): string | null`, runs in `Transit.saveLine` before `route()`. `Metro.commit` plans the bore, refuses if the owner is short of money, writes the bytes, charges the owner and sets `pending`. `route()` then derives the line from the layer. `Metro.rebuild` re-derives every 10 ticks, and at the next tick after any under edit, as `Rail.rebuild` does.

**Sharing.** Lines never share tunnel. Two lines may share a crossover tile only if one runs north-south straight through it and the other east-west. `Metro`'s conflict check allows exactly that, where `Rail`'s refuses any shared tile.

**Trains** run surface rail's deterministic timetable, extended in `shared/src/rail.ts` for `RailLineDef.metro`:

- **Consist.** All cars: a driving motor car at each end (`RailVehicle.TubeCab` 7) and trailers between (`TubeCar` 8). A train has as many cars as the shortest platform has tiles (`CAR_PITCH` as today), so 4 or 6. A car carries 60 riders (`METRO.carRiders`), so a train takes 240 or 360.
- **Twin bores.** A there-and-back metro line runs out in one bore and back in the other, so it takes many trains, unlike a surface shuttle. The spacing check unfolds the cycle onto a loop of length 2L: position u = s outbound and 2L − s inbound. It then applies the loop rule, a train length plus `TRAIN_GAP` apart at every half tick. That rule also keeps an arriving train off a terminus platform while the last one is still standing there. A train changes bore during its terminus dwell: a scissors crossover, drawn as a slide across in the middle of the dwell.
- **Loops** run one way (Q4).
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

## 6. Tools and tech

- **Tech `tr9`, "Underground railway"**: transport tier 7, requires `tr6` Rail and `con3` Deep foundations, condition 600 jobs, $8,000. It unlocks `['metro', 'metroentrance', 'metrostation']`. The feature id is `metro` because `underground` is already taken by Deep foundations, for underground parking.
- **Tools.** A size ladder, "Underground station", in the Transport group: the kiosk and the hall, chosen in the picker. It has no key, since every letter is taken. Z and C turn the platform.
- **Lines** use the existing **lines** chip.
- **Bulldozing** in the underground view works on tunnels.
- **The view** is always available, on N.

## 7. London and the Showcase

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
- **Staging:** the two kinds stay `draft: true` until the showcase subtask lands, and `showcaseProblems` skips a line mode whose stop kinds are all drafts. That is a two-line change, landed with the metro service, and it keeps `demo:check` green in between.

## 8. Checks

- **`npx tsx packages/shared/scripts/metro-check.ts [days]`**, like rail-check. It builds a server World with entrances, bores three lines through `Metro.commit` (one crossing another, one under water), mirrors the chunks into a ClientWorld and checks:
  - `planBore` is deterministic, and preview equals save;
  - the route derived from the layer is the bored path or shorter, and uses no other line's tile except at crossovers;
  - `metroStationAt` agrees on both sides, from the door and from every platform tile;
  - over whole days at every half tick: trains in the same bore stay a train length plus the gap apart (the 2L unfolding), every bogie is on the line's tiles, no train runs before 05:00, every train dwells at every station, every call is a dwell, and `nextRide` gets there;
  - the refusals hold: platforms that overlap or touch end to end, a crossing at a junction or a platform, shared tunnel, short of money, a single station;
  - the snapshot round-trips: v7 loads with zero under bytes, and v8 saves and loads them byte-identical;
  - the bulldoze rules hold: a used tunnel cannot be filled, and an orphan platform reverts to tunnel.
- **`rail-check.ts`** stays green and byte-identical after the `TrackNet` refactor.
- **`npx tsx packages/server/src/loadtest/metro.ts [--hours 24] [--off]`**, on the harness (`loadtest/harness.ts`). It takes a test city (`loadtest/cities.ts`, about 10k citizens), adds two crossing metro lines and a bus feeder, and reports:
  - riders a day per line, and the share of trips by metro, bus, car and foot;
  - median wait, peak platform crowd, peak train load and give-ups;
  - the tick cost of `Metro.tick` and of `bestTransit` with metro against `--off`.

  It passes with riders on every line, no rider left waiting past `waitMax`, and at most +0.3 ms a tick.
- **`npm run demo:check`**, then `npx tsx packages/server/src/demo/check.ts --fill --run 1`. The run report gains riders per metro line and peak train load. The London run must show every Tube line running.
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

1. **Under layer, persistence and wire.**
   - World: `World.under*` (`underAt`, `setUnder`, `dirtyUnder`, `stopNames`, `stopLabel`).
   - Snapshot v8.
   - Protocol: `ChunkDTO.under`, the `'under'` delta and flag bit 18 helpers.
   - Net: the chunk DTO and the flush.
   - Client: `ClientWorld` mirror and `underAt`, plus the message case in `main.ts`.
   - Files: `server/src/world.ts`, `server/src/snapshot.ts`, `shared/src/protocol.ts`, `server/src/net.ts`, `client/src/world.ts`, `client/src/main.ts` (a few lines).
   - It only moves bytes and does not need the encoding's meaning. `protocol.ts`, `net.ts` and `main.ts` are being edited by other agents right now, so rebase onto them.
2. **Shared metro logic.**
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
5. **The underground view.**
   - New `client/src/render/underground.ts`.
   - Edits to `render/materials.ts` (`uUnder`), `render/chunkView.ts` (`setUnder`, the ground fade), `client/src/ui.ts` (the chip) and `main.ts` (N, `setUnder`).
   - The placement preview: a ghost platform and the reason from `planPlatform` in the status line (`render/footprint.ts`).
   - It works from under bytes alone, before 4 lands, and can be tested by writing bytes from the console.
6. **Trains, riders, editor.**
   - `render/trains.ts` options and the tube car model, and a second instance in `main.ts`.
   - Platform and carriage riders: `render/citizens.ts`, after the headlights agent has landed.
   - `client/src/vehicles.ts` selection.
   - `client/src/lines.ts`: metro mode, the bore preview (new tiles dashed, crossovers ringed, cost on the Save button), the underground view on while editing, and the line name field.
   - The station tooltip in `client/src/ui.ts` `buildingHtml`.
7. **Cab ride.**
   - Tunnel mode in `render/fpv.ts`.
   - The tunnel interior pool in `render/underground.ts`.
   - The feed into the existing instruments. Do not edit `instruments.ts`.
8. **Showcase and London.**
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
