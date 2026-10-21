# The aux layer and multi-tile structures

Every chunk carries a third per-tile array next to the tile words (`Uint16Array`) and the parcel ids (`Int32Array`): one byte per tile, the **aux layer**. It costs 1 KB per chunk. Its uses are multi-tile structures, airfield strips (runways, docs/airport.md), railway track (docs/rail.md), junction types on road tiles (roundabouts, flyovers, mini-roundabouts and big islands: docs/structures.md section 4, docs/roads.md "Junctions"), bridge decks over water (docs/structures.md section 3) and road classes (docs/roads.md "Classes"); `0xfd`–`0xff` are free. Graded height for road tiles, when it comes (E7), can live in the sub layer, which a road tile never uses. A fourth byte per tile, the **sub layer**, holds kind ids past the tile's 16 codes; it is stored and streamed the same way and is described in docs/sub-kinds.md. A fifth, the **under layer** (`Chunk.under`), holds metro tunnels and platforms below ground; nothing on the surface reads it, and it too is stored and streamed the same way (docs/underground.md).

Code: `packages/shared/src/structures.ts` (encoding, footprint geometry, placement rules), `packages/server/src/world.ts` (storage, mirroring, place and remove), `packages/server/src/store.ts` (snapshot), `packages/server/src/net.ts` (wire and the build tool), `packages/client/src/world.ts` and `render/chunkView.ts` (mirror and drawing).

## Encoding

| Byte | Meaning |
| --- | --- |
| `0x00` | nothing |
| `0x01`–`0x3d` | **road class** of a road tile: `cls \| dir << 3 \| junction << 5`. `cls` (bits 0-2) 1 country lane, 2 one-way street, 3 avenue, 4 motorway, 5 pedestrian street, and two no drag lays (R4, written by the junction tools, never in the picker): 6 a **5×5 roundabout's ring** tile (one way round in `dir`, a corner's the way out; `0x06`, `0x0e`, `0x16`, `0x1e`), 7 a **motorway under a street deck** (an interchange's bridge: a motorway carriageway going `dir`, the street crossing it on the other axis on route layer 1; `0x07`, `0x0f`, `0x17`, `0x1f`; never a junction tile). Classes 6 and 7 with the junction bit, and the junction bit and direction of the classes that have none (lane, pedestrian), are unused; `dir` (bits 3-4) the way a one-way, avenue or motorway tile's traffic goes, in DIRS order (E 0, W 1, S 2, N 3); `junction` (bit 5) an avenue's or motorway's tile where a road crosses or joins it, it turns a corner or ends (the server keeps it: `World.refreshRoadFlags`). The street, class 0, has no byte, so every road laid before classes is a street and old worlds read as they did. A road tile with any other byte (bridge deck, level crossing, ring, flyover) has no class: it is a street, and the classes either side carry on through it. See `shared/src/roadclass.ts` and docs/roads.md "Classes" |
| `0x40 \| r` | **anchor** of a structure. Bits 0-1 hold the orientation `r`; bits 2-5 are 0 (reserved, e.g. a design pick) |
| `0x80 \| dy << 3 \| dx` | **part** of a structure whose anchor is at `(x - dx, y - dy)`; `dx`, `dy` are 0-7 |
| `0xc0 \| row << 2 \| o` (`0xc0`–`0xd7`) | **airfield** tile: runway, shoulder or taxiway row `row` (0-5) of a strip behind an airport terminal facing `o` (FRONT order). The tile word is kind None. See docs/airport.md |
| `0xd8 \| style << 1 \| ns` (`0xd8`–`0xdf`) | **bridge deck**: a water tile with the road bit. `ns` 1 when the deck runs north-south; `style` 0 stone arch, 1 steel girder, 2 suspension, 3 bascule (Tower Bridge). No tile was water and road before bridges, so old worlds read as they did. See docs/structures.md "Built: road bridges" and `shared/src/bridges.ts` |
| `0xe0 \| mask` (`0xe0`–`0xef`) | **railway track**: the mask holds the sides the track leaves the tile by (N 1, E 2, S 4, W 8). The tile word is kind None, except on a **level crossing**: a road tile with a straight mask (`0xe5` track north-south, `0xea` east-west), the road straight across it. No tile had a road and a rail byte before crossings, so old worlds read as they did. See docs/rail.md "Level crossings" |
| `0xf0 \| p` (`0xf0`–`0xf7`) | **roundabout ring** road tile: `p` (0-7) is its place round the island in driving order (E, NE, N, NW, W, SW, S, SE: anticlockwise seen from above). The tile word is a plain road. See docs/structures.md "Roundabouts and flyovers" |
| `0xf8` | **roundabout island**: the old junction tile, kind None, planted by the client |
| `0xf9`, `0xfa` | **flyover**: a crossroads road tile whose east-west (`0xf9`) or north-south (`0xfa`) road is on the deck, route layer 1; the other road is layer 0 beneath it |
| `0xfb` | **mini-roundabout** (R4): the junction tile of a crossroads or T of streets or lanes, still a road, painted as a roundabout (no lights; one car in the box at a time with `miniOne`, else the box's rules, giving way to the left). See docs/roads.md "Junctions" and `shared/src/junctions.ts` |
| `0xfc` | **big island** (R4): one of the nine island tiles of a 5×5 two-lane roundabout, kind None, not a road; the one with island on all four sides is its centre, which the client plants. Its ring is road class 6 |
| `0xfd`–`0xff` | free |

The anchor is always the footprint's min-x, min-y corner, so part offsets are never negative and 3 bits per axis reach 8 tiles. That caps footprints at 8×8, which covers every structure in docs/structures.md (the largest is 6×8). The validator enforces it.

Orientation `r` is the direction the structure's front (the door side, model +z) faces: 0 = +y, 1 = +x, 2 = -y, 3 = -x. The model is turned by `r` quarter turns, the same yaw a 1×1 building uses for the same road side.

What a structure is comes from the tile word and the sub byte, not the aux byte: every tile of a structure carries the structure's family code and its sub byte (its kind id, 0 for a family's base kind), so zoning, ownership and "is something built here" checks see it. `structureAt(x, y, aux, tile, sub)` reads the aux byte, finds the anchor, takes the kind id from the anchor's tile word and sub byte and the footprint for that id from the catalogue (`FOOTPRINT_TABLE`), and returns the anchor, rotated size, door tile and the road tile in front of the door. `Placed.kind` is a kind id, so the 8×7 airport terminal and the 3×2 bus depot share family code 15 and still get their own footprints.

## One building per structure

The simulation sees exactly one `Building` per structure, registered at its **door tile**. Traffic, pathfinding, parking, capacity, hiring, `describe()` and the people panels therefore work unchanged, and `hasRoadAccess` for the structure is the door's.

- **The door owns the state.** Sites, construction progress, priority and levels are written to the door tile by the simulation as for any building. `World.setTile` mirrors that write (everything but the terrain and road bits) to every other tile of the structure, so all tiles always hold the same kind, level and construction bits. The renderer reads the anchor's own word, never a tile in another chunk.
- **Part tiles never reach the building index.** Writes to them go straight to the tile array. The store loads every chunk before indexing buildings and skips structure tiles that are not the door.
- **Clearing any tile clears the structure.** A write of an empty or road tile word to any structure tile first zeroes every aux and sub byte of the structure and then clears all its tiles. Bulldozing a part tile therefore removes the whole structure, its Building and its Site, and charges one bulldoze fee. A merged zone building (docs/buildings.md "Merged lots") is cleared back to empty lots of its zone instead, the bulldozed tile included; a road written over one still goes in.
- **Grown structures.** Merged lots are structures too, written by `World.mergeLots` over lots of one zone (the buildings there hand their people to the door first) with one Site at the door marked `merge`, built to the merged kind's level.

## Placement

Kinds with a footprint bigger than 1×1 are placed by one click; the clicked tile is the **door**. `planStructure()` (shared, so the client preview and the server agree) tries the road sides of the door in the order +y, +x, -x, -y. For the first side with a road it rotates the footprint so the front faces that road, then checks every tile:

- loaded and not water,
- not a road,
- no building, site or other structure (an empty zoned lot may be built over),
- land the player may use: their own parcel, or unclaimed land for a draft kind on a dev server.

If no road touches the door it refuses with "needs a road next to it". If every road side fails, the reason from the first one is shown.

The player can instead choose the orientation: Z and C turn the footprint a quarter anticlockwise or clockwise, and the client sends `rot` (0-3, the direction the front faces, in the orientation order above) with the `build` message. `planStructure(kind, doorX, doorY, env, rot?)` then tries only that orientation: the door's outward neighbour must be a road ("The door must face a road") and the tiles must pass the checks above. Without `rot` the automatic facing is unchanged, and the first Z or C press starts from whichever orientation the preview was showing. Runway drags and 1×1 tools ignore `rot`. The server then writes the aux bytes, puts the family code and the sub byte on every tile and opens one Site at the door with `CIVIC_WORK`, so builders raise it like any civic building. Road, zoning and placement tools on a structure tile are refused ("part of a …; bulldoze it first").

The client shows the planned footprint under the cursor, green when the server would accept it and red with the reason in the status line when not. The preview draws an outline for each tile, an arrow from the door towards the road (green with a road, red without) and the catalogue's footprint marks (docs/buildings.md): platform, apron, stands, vehicle gate. Over a structure that stands, the same outline and marks show faintly, with the label of the mark under the cursor. The status line gives the facing as S, E, N or W (+y is south) and whether it is automatic or chosen. Hovering or clicking any tile of a structure inspects its door, and the hover highlight covers the whole footprint.

## Storage and wire

- **Snapshot.** Format v5 added each modified chunk's aux as base64, only when it is not all zero; v6 adds the sub layer the same way, and v8 the under layer. Older worlds upgrade in place with zero aux, sub and under bytes.
- **Chunk message.** `ChunkDTO.aux` is base64 of the 1024 bytes, omitted when all zero; `sub` and `under` likewise.
- **Deltas.** Aux changes go out as their own flat stream, `{ t: 'aux', u: [x, y, aux, ...] }`, only for tiles whose aux byte changed, and always before the `tiles` quads of the same tick (sub bytes follow in `{ t: 'sub' }`, between the two; under bytes go in `{ t: 'under' }` ahead of all three). Tile quads are unchanged (`x, y, packed, parcelId`), so existing traffic costs nothing extra. Placing or removing a 2×2 sends one 12-number aux message once; construction progress sends tile quads only.

## Drawing

The anchor tile emits one placement of the kind id's model at the footprint centre, turned to face the road, unscaled: recipes for multi-tile kinds are authored in tiles for the whole footprint (docs/buildings.md). Part tiles emit no model. A site shows the rising shell plus the site fence scaled to the footprint. Every tile of a structure takes its ground tint and design pick from the anchor's hash, so the pad reads as one lot. A structure straddling a chunk edge draws from the anchor's chunk; the part chunk only draws ground.

## Draft kinds and the worked example

Draft kinds compile into every table but their tool only shows in the tool bar with `?dev` in the URL, and only a server whose `NODE_ENV` is not `production` accepts them; on a dev server a draft may also go on unclaimed land. The layer was first verified with a draft 2×2 test hall on kind code 15. That code now belongs to the airport terminal (`buildings/terminal.ts`, 8×7, key J), which is the worked example of a multi-tile structure; the test hall was retired, and no world held one.

## Not in the aux layer: road rules

Turn bans, no-entry arms and signal crossings (R4, docs/roads.md "Junctions") have no room left here. They are a small
typed record per junction anchor (`shared/src/roadrules.ts` RoadRule), kept by `World.roadRules`, saved as the optional
snapshot field `roadRules` (absent in older saves) and sent whole as `{ t: 'roadRules' }` on hello and on every change;
a signal crossing's walk grants go as `{ t: 'walks', u: [x, y, walkAt, ...] }`. R5's traffic control adds its own
fields to the same record. Junction groups (two or four tiles of an avenue crossing working as one) have no bytes either:
`shared/src/signals.ts` junctionGroup works them out from the tiles.
