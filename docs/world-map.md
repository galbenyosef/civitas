# World map and parcel management (design)

UTD card 666cb653. Rich: "world map where we can really zoom out and manage the parcels, combine, separate etc".

In one paragraph: a **map mode** (Tab, the top-bar **map** chip, or zooming out past the normal limit) swaps the 3D
city for a flat, north-up map of the whole world. The ground is drawn from a compact **per-chunk land-use summary**
(one byte per tile, run-length coded) that the server caches per sector of 8×8 chunks and sends only for sectors whose
version the client does not have. Chunks nobody has changed are not sent at all: the client draws them from the seed,
as the server generates them. Parcels are drawn from the parcel list every client already has, as owner-coloured
union outlines with names. On your own land the map manages parcels: **combine** adjacent parcels, **split** one along
a line you drag, **rename** and **colour** it, and read its stats (area, buildings, population, jobs, book value).

## 1. Map mode

| | |
| --- | --- |
| Toggle | **Tab**, the **map** chip, or wheel/pinch past the 3D limit (`DIST_MAX` 220). Zooming back in below 150 returns to 3D at the tilt you left. Every letter key was taken (tools, camera, H N T M I O); Tab is free and is what many games use for a map. Esc leaves the map too. |
| Camera | the ordinary `CameraRig`, eased to north-up (yaw 0) and straight down (`MAP_PITCH` 1.565), with the zoom range widened to `MAP_DIST_MAX` 6000 (about 9000 tiles across on a 16:10 window). Near and far planes follow the distance. |
| Rendering | a separate `Scene` (`render/worldmap.ts` `MapView`): the main scene is not rendered at all, so no buildings, agents, shadows or fog cost anything. Everything is `MeshBasicMaterial`, unlit, not tone mapped. |
| Streaming | the chunk subscription set becomes empty: no chunk geometry, agents or traffic bytes arrive while the map is up. Leaving the map subscribes again as usual. |
| Navigation | left drag pans (a click without a drag selects), right drag and trackpad two-finger scroll pan, pinch and the wheel zoom about the cursor, WASD pans. Rotation is off: the map stays north-up. |

### Ground: sectors and levels of detail

The world is cut into **sectors** of 8×8 chunks (256×256 tiles). Each sector is one textured quad. Its texture is built
on the CPU at one of three resolutions, picked from the zoom: a texel per tile (L0, 256²), per 4×4 tiles (L1, 64²) or
per 16×16 tiles (L2, 16²). L0 is used while a tile is at least about two thirds of a pixel. Building a texture costs
the terrain samples it needs (13 ms for a whole L0 sector of untouched land, 1 ms for L1) plus a copy of the summary
bytes, so the map builds a few sectors a frame within a 6 ms budget, nearest the view centre first, and shows a coarser
texture of the same sector until the finer one is ready. Textures are kept in an LRU of 400.

Colours: grass, sand and water as the 3D ground; roads dark grey; track brown; runways grey; zones in their tool
colours (homes green, shops blue, industry amber, offices violet), civic red, transport slate, leisure deep green. A
building's level shades its zone colour darker, so towers read as dark cores; an empty zoned lot is the pale zone
colour; a site under construction is hatched.

### The summary (shared/src/worldmap.ts)

One byte per tile: bits 0-3 the class (`MapClass`), bits 4-6 the level (0-7), bit 7 under construction. Classes:
grass, sand, water, road, track, airfield, residential, commercial, industrial, office, civic, transport, leisure.
`mapByte(tile, aux, kindId)` is the one function both sides use. A chunk's 1024 bytes are run-length coded as
(run-1, byte) pairs and base64'd: a district chunk is typically 300-600 bytes on the wire, a field of grass 8.

### Wire

```
client  { t: 'map', s: [sx, sy, ver, sx, sy, ver, …] }        visible sectors and the version held (0: none), at most 512
server  { t: 'mapSector', sx, sy, v, c: [[cx, cy, rle], …] }   only for sectors whose version differs; c lists modified chunks
```

The client asks for the visible sectors when the view settles and every 3 s while the map is up. The server keeps a
version per sector (`server/src/worldmap.ts` `MapSummaries`), bumped by `Net.flush` for every tile, aux and sub change
it sends, and a cache of the encoded message per sector, rebuilt on the first request after a change. A request for
unchanged sectors costs a version compare each. Nothing is pushed, so the server holds no per-client map state. Chunks
not listed are untouched: the client samples `makeTerrainSampler(seed)`, the server's own generator, for them.

### Overlays

- **Parcels**: a faint fill in the parcel's colour (its own if set, else the owner's), a ribbon of constant screen
  width round each owner's land (`unionOutline` per owner, as in 3D) and a thinner one between that owner's estates
  and lone parcels. The ribbons are rebuilt when the zoom changes by more than 15%.
- **Labels** (HTML, never overlapping, biggest first): owner names over each owner's land when zoomed far out, estate
  and parcel names nearer, and line names (bus, rail, metro) at the middle of each route.
- **Lines**: bus paths, rail and metro routes as ribbons in the line colour.

## 2. Parcel management

The parcel model stays **rectangles**: every parcel is `x, y, w, h` and the per-tile parcel id says which one owns a
tile. Purchases, adjacency, islanding, `recountRoads` and every reader of `parcelAt` keep working unchanged.

- **Combine** (select a parcel, shift-click the others, then Combine). All parcels must be yours (anyone's in a
  sandbox, but all one owner's), and joined edge to edge. Pairs whose union is a rectangle no longer than
  `MAX_PARCEL_EDGE` (48) on either side are **merged** into one parcel: the lower id keeps its name and settings, the
  other's tiles take its id and it is removed. Whatever is left as more than one parcel becomes an **estate**: a
  named group (`Parcel.group`, a fresh id). Members of an estate share name, colour and tax rate: setting one sets
  all. The map and the 3D outline draw an estate as one shape. Combining a parcel with an estate member joins the
  whole estate.
- **Split** (Split, then drag across the parcel). The cut is straight along a tile boundary, horizontal when the drag
  is mostly horizontal, at the drag's mean position. Both parts must keep at least one dry tile, and the cut may not
  pass through a building (any structure with tiles on both sides). The part on the west or north keeps the id; the
  other part is a new parcel named "<name> (east)" and so on, with the same owner, colour and tax rate, outside any
  estate. **Leave estate** takes one parcel out of its estate (an estate of one is dissolved).
- **Rename**, **colour** (eight swatches plus the owner's colour), **tax rate** as in the parcel panel.
- **Stats**: area, buildings, population, jobs filled, road tiles, book value and tax yesterday, for the parcel and
  for its estate.

Why an estate instead of non-rectangular parcels: a polygon parcel would change `ParcelDTO`, the purchase rules'
`owned` rectangles, the 3D outline, `recountRoads` and every save. A group keeps storage and rules as they are,
needs two optional fields, and still lets a player treat an L-shaped holding as one place.

**Book value** = land at `LAND_PRICE_PER_TILE`, roads at `ROAD_COST`, each placed building at its cost
(`CIVIC_COST`), each grown building at its zoning (`ZONE_COST` a tile) plus its builder work to its level at
`CONSTRUCTION_FEE`. It is what the parcel cost to make, not a market price (there is no market yet).

### Validation

`shared/src/parcelops.ts` holds `planCombine` and `planSplit`, pure functions over the parcel list and a
`ParcelEnv` (water, structure doors). The server runs them with the world's tiles and is the authority. The client
runs them for the preview with what it has: map summaries for water, and no structure check (the server refuses a
cut through a building and says which). A preview is green or red with the reason in the status line.

### Wire and persistence

```
client  { t: 'parcelOp', op: 'combine', ids: number[] }
        { t: 'parcelOp', op: 'split', id, axis: 'x' | 'y', at }     cut at x = at (or y = at)
        { t: 'parcelOp', op: 'ungroup', id }
        { t: 'parcel', id, name?, taxRate?, color? }                 color -1 clears it
```

`Parcel` and `ParcelDTO` gain `group?` and `color?`; `ParcelStats` gains `buildings` and `value`. Snapshots store
parcels whole, so no version bump: older saves load with neither field. Local mode runs the same `Net`, so it works
there unchanged; `npm run local:check` covers the seam. The tile changes of a combine or split go out as ordinary
tile deltas and the parcels message carries the changed and removed parcels.

## 3. Showcase

The showcase's South railway and Riverside lands are combined into the **Riverside estate** at seeding, through
`planCombine` (their union is 70×26, past the 48-tile limit, so it is an estate, not a merge). The tour has a
**World map** stop that opens the map over the whole town (`view: 'map'`), and `SHOWCASE_FEATURES` has `world-map`:
the stop in the scenario and an estate of two or more parcels in the seeded world.

## 4. Costs

Measured in section 5 of the card's report: summary bytes per sector, server encode time, map frame time zoomed right
out over a large world. The map draws one quad per visible sector, two meshes of ribbons and fills, and the line
ribbons: a handful of draw calls plus one per sector.

## 5. Follow-ups

- Selling or transferring parcels between players, on the map.
- A minimap inset in 3D mode, from the same sector textures.
- Splitting an estate along a line through several members at once.
- A push of sector changes while the map is up (now a 3 s poll).
