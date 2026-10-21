# Landmarks: a brief for designers

A **landmark** is a recognisable real building (or a generic famous type, such as a Victorian town hall with a clock tower) drawn as a short TypeScript recipe of simple shapes. This page is complete on its own: paste it into the prompt of a model, or read it as a person, and you can add a landmark that passes review without reading the London files first. The worked examples are in `packages/shared/src/buildings/landmark-drafts.ts`: `town-clock-tower` (a 2×2 office landmark with lit clock dials) and `war-memorial` (a 1×1 monument of 20 ops, an attraction); the template is `landmark-template` in the same file.

The short route: copy the template, give it the next free id in 230-249, draw the building, run `npm run landmarks:check`, look at it in `/viewer.html?tag=draft`, open a pull request with a screenshot. About an hour.

Contents: 1 what a landmark is, 2 scale, 3 footprint and coordinates, 4 the door, marks and rotation, 5 parts, 6 windows and facades, 7 palette, 8 reading at far zoom, 9 moving parts, 10 ids, tags, collections and the tech lock, 11 the draft path, 12 the viewer, 13 the checks, 14 pull-request checklist, 15 review rubric, 16 likeness and taste.

## 1. What a landmark is

A landmark is an ordinary **placed civic kind**: a player places it, builders build it, citizens staff it, it pays upkeep. It **works as an existing role**, so the simulation needs nothing new. The model is what makes it special. Pick the role first:

| Role | Family code | What it does | Copy from |
| --- | --- | --- | --- |
| Offices (a town hall, a headquarters, a tower) | `Zone.Office` (4), family `office` | Office jobs, nine to five, the office car-ownership rate | `asOffice` (`landmark-roles.ts`, also exported by `landmark-drafts.ts`); the Gherkin in `landmarks-london.ts` |
| Daytime attraction (a cathedral, castle, museum, monument) | `library.code` (14), family `leisure` | Visitors pay a ticket, stay one to three hours; retirees and children love it | `asAttraction`; the Tower of London in `landmarks-london-2.ts` |
| Venue with event nights (an opera house, theatre) | theatre family (12), family `leisure` | Evening shows on event nights | the Royal Opera House in `landmarks-london.ts` |
| Leisure venue (a wheel, a stadium) | sports family (13) | Day and evening rides or matches | the London Eye |
| University | library family (14), `education` attributes | Students; see docs/education.md section 14 | UCL in `landmarks-london-3.ts` |

A landmark is **one building, not a type**: it has one level and **one design**. `buildings:check` waives the two-designs rule for landmarks. The metadata that makes a kind a landmark:

| Field | Meaning |
| --- | --- |
| `landmark: true` | Validation then requires the civic flag, at least one tag, and (for a live landmark) a tool, a rung of a `collection` group and a tool unlocked only by a `locked` tech node |
| `draft: true` | A draft landmark (section 11): viewer only. Waives the tool, collection rung, locked tech node and the "one live design" rule; needs the `draft` tag and an id in 230-249 |
| `tags: ['draft', 'victorian']` | Lower-case words. The viewer filters by them (`?tag=draft`). A live landmark carries its city (`london`) |
| `group`, `tier` | The collection picker a live landmark is a rung of (`london`), in tier order. Not for drafts |
| `blurb`, `howTo` | The picker card and the viewer: what it is and what it is known for, then how to place it well. Both in the game's voice: plain, warm, a sentence or two, no brand names |
| `footprint` | `{ w, h, door: [dx, h - 1] }`, up to 4×4 for a landmark (section 3) |
| `levels` | One level with its numbers: `capacity` (jobs), `wage` (per eight-hour shift), `cost`, `upkeep` (per day), `work` (builder work units), `parking`, and one design |

**`capacity` and `visitorCapacity`, once.** `capacity` is **jobs: the staff who work there**, on every landmark. `visitorCapacity` (in `attrs`) is **how many visitors it holds at once** and exists only for the attraction and venue roles (an office landmark has none). A draft also needs `wage` (per eight-hour shift), `upkeep` (per day), `cost`, `work` (builder work units that grow with the size) and `parking`, like any civic kind; the presets in `landmark-roles.ts` supply the `occupation`. Suggested numbers, scaled from London:

| Size | Role | `capacity` | `visitorCapacity` | `wage` | `upkeep` | `cost` | `work` | `parking` (surface, underground) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Monument, 1×1 | attraction | 2 | 12 | 16 | 8 | 800 | 300 | 0, 0 |
| Small building, 2×1 or 2×2 | office | 20-24 | none | 20-22 | 30-40 | 3000-4000 | 800-1000 | 2, 6 |
| Small building, 2×1 or 2×2 | attraction | 10-20 | 40 | 16-18 | 20-30 | 3000-5000 | 800-1200 | 2, 6 |
| Large, 3×3 or 4×4 | office | 240-420 | none | 30-46 | 90-150 | 16000-30000 | 2600-5200 | 0, 40-80 |
| Large, 3×3 or 4×4 | attraction | 40 | 180 | 17 | 70 | 12000 | 3000 | 0, 20 |

## 2. Scale

**About 33 m to a tile.** A person is a speck; a street is one tile; a block is about three. Heights in tiles, from the London set:

| Building | Real height | Drawn |
| --- | --- | --- |
| Shard | 310 m | 9.6 (the tallest; never exceed 10) |
| One Canada Square | 235 m | 7.2 |
| Gherkin | 180 m | 5.4 |
| Walkie Talkie | 160 m | 5.0 |
| London Eye | 135 m | 4.1 (wheel drawn by the client) |
| Victoria Tower | 98 m | 3.0 |
| Elizabeth Tower (Big Ben) | 96 m | 2.9 |
| Tower Bridge towers | 65 m | 2.0 |
| Buckingham Palace, Tower of London, Royal Opera House | 25-35 m | 1.2-1.7 |

A Victorian town hall tower of 80 m is about 2.5 tiles. A parish church spire is 1 to 1.5. Wide buildings are drawn **shorter and tighter than life** when needed so they fit their footprint (the Palace of Westminster is drawn smaller than the real one); keep the silhouette and the proportions between the parts, not the metres. Never taller than 10 tiles (`landmarks:check` fails over 10, warns over 8).

## 3. Footprint and coordinates

A landmark covers `w × h` tiles, **up to 4×4**; **leave `footprint` out for a 1×1** (its door is then the only tile, as for any one-tile civic kind) (the London demo's streets are laid round them; London's are 1×4 to 4×4). `w` runs along x and `h` along z, before rotation.

The model is authored **in tiles for the whole footprint**, centred on the footprint's middle:

| Footprint | x runs from … to | z runs from … to |
| --- | --- | --- |
| 1×1 | -0.5 to 0.5 | -0.5 to 0.5 |
| 2×2 | -1 to 1 | -1 to 1 |
| 3×2 (w 3, h 2) | -1.5 to 1.5 | -1 to 1 |
| 4×3 | -2 to 2 | -1.5 to 1.5 |
| w×h | -w/2 to w/2 | -h/2 to h/2 |

Ground is y = 0. **+z is the front, the side towards the road.** The renderer places the model unscaled at the footprint's centre and turns it to face the road, so every part must stay inside the rectangle: `landmarks:check` and `buildings:check` fail a part that reaches outside. Keep walls 0.02 inside the edge. A paved plot is `slab(w, h, PAVING)` (section 11): 0.04 smaller than the footprint and 0.02 tall, so **the first building box sits at y = 0.02**; every later part is stacked from that, and `height` counts from the ground.

**Plans that are not rectangles.** A `cyl` or `lathe` is round and a `box` is square-cornered; there is no oval. An octagon is a `lathe` with `seg: 8` (a dome or a bandstand roof); an oval or a long curved front is a round part whose diameter fits within the **shorter** side of the footprint, or two overlapping cylinders side by side along the longer one. A round part's extent is its radius in every direction, so on a 2×1 footprint a drum can be at most 0.5 in radius.

## 4. The door, marks and rotation

A 1×1 has nothing to say here: the model stands on the one tile with its front on +z. For a bigger footprint `footprint.door` is `[dx, dy]` from the back-left corner and **must be on the front row**: `dy = h - 1`. It is the tile the simulation knows the building by, and **a road must touch it**. In x its tile spans `dx - w/2` to `dx + 1 - w/2`. **Put the main door of the model on the front (+z) wall within that span** (the clock tower on a 2×2, door `[0, 1]`: the door is at x = -0.3, inside -1 to 0). Draw it with the `door` helper by cell (section 6), never as a box on a windowed wall. A monument with no windowed facade (an obelisk, a statue, a bridge) needs no door op.

Until the player presses Z or C the footprint turns to face the road beside it; then it keeps the orientation they chose (Z anticlockwise, C clockwise). A w×h footprint becomes h×w on odd rotations, and the whole model turns with it, so a model inside its footprint fits in all four rotations. `landmarks:check` turns every part through all four; `buildings:check` places every landmark in all four rotations on clear land beside a road.

`footprint.marks` lists significant parts drawn in the placement preview (`apron`, `quay`, `platform` ...; docs/buildings.md "Footprint marks"). A landmark rarely needs any: the door mark is added from `door`.

## 5. Parts

A design is a list of ops. Each op is a tuple of its name and arguments. Colours are a palette name or a `0xRRGGBB` number. Positions and sizes are tiles. **Every part rests on the ground or on the part below it: its `y` is exactly the top (`y + h`) of what it stands on.** Nothing floats, nothing is buried. The check accepts a part as supported when **another part is under it or beside it**: some other part whose height range contains this part's base `y` (within 0.01) and whose plan comes within 0.02 of this part's plan. So a finial on a roof ridge, a flag on a hedge and a tower standing against a hall all pass, and a part hanging in the air does not (`landmarks:check` names it).

| Op | Arguments | Notes |
| --- | --- | --- |
| `box` | `w h d x y z colour [window] [{ name, facade }]` | w along x, h up, d along z; centred on x, z; **base at y**. The window class is a class name or `true` (the kind's `windows`) |
| `roof` | `w h d x y z colour [alongZ] [{ name }]` | A pitched prism, base at y, ridge along x (along z with `true`) |
| `cyl` | `rTop rBot h x y z colour [segments=8]` | Round columns, drums, finials. No windows |
| `cone` | `r h x y z colour [segments=8]` | Spires, turret caps |
| `taper` | `wBot dBot wTop dTop h x y z colour [{ win, shift }]` | A box whose top is another rectangle: 0×0 for a pyramid, wider than the base for a slab that widens upwards. `shift: [dx, dz]` leans the top; `win` lights its near-vertical faces with the legacy window grid. Towers that narrow, spires, pinnacles, leaning shards, hipped roofs |
| `lathe` | `x y z colour profile [{ seg, twist, stripe, every, width, axis, win }]` | A solid of revolution. `profile` is `[r, dy, r, dy, ...]` from the base up, **starting at dy 0**, dy never going down; r 0 is a point; an open top is capped flat. Radii and heights in tiles from x, y, z |
| `wheel` | `r w x y z colour` | A cylinder lying along x. Wheels, rolls, a barrel on its side. Dropped from the far model |
| `crane` | `x y z mastHeight` | Helper: a tower crane |
| `flag` | `x y z colour` | Helper: a pole with a flag, 0.2 tall |
| `chimneyStack` | `x y z h r [body]` | Helper: a tapered stack with a red cap; adds 0.07 above `h` |
| `screens` | `x y z r from to cols rows h [bezel]` | A bank of big screens round a curve (docs/adverts.md section 9). Piccadilly Circus only; ask before using |
| `adslot` | `part face bay storey size [at]` | A rentable ad frame (docs/adverts.md). Not for a first landmark |
| `door` `garage` `balcony` `baywindow` `porch` `awning` `cornice` `dormer` | features placed by cell | Section 6 |

**`lathe` in detail.** `seg` (3 to 64, default 16) is the number of facets: 8 reads as an octagonal spire, 24 as a round dome or dial. `twist` turns each ring that many degrees per tile of height. `stripe`, `every` and `width` pick a facet colour: every `every`-th group of `width` facets (width less than every, `every` at least 2, default 4) takes the `stripe` colour, so an untwisted lathe has alternate facets picked out and a twisted one has spiral bands. `axis: 'x'` or `'z'` lays it on its side: the profile then runs along +x or +z from x, y, z, which makes a barrel vault, a drum on its side or a flat round dial. `win` gives the faces windows from the legacy grid (a cylindrical tower).

```ts
// an eight-sided slate spire with every second facet picked out, base 0.52 across, 0.6 tall
['lathe', 0, 1.8, 0.35, 'slate', [0.26, 0, 0.24, 0.12, 0.16, 0.34, 0.08, 0.52, 0.025, 0.6, 0, 0.6], { seg: 8, stripe: 'roofGrey', every: 2, width: 1 }],
// a flat white round dial on a wall facing +z: a disc 0.006 thick
['lathe', 0, 1.2, 0.65, 0xf3eee0, [0, 0, 0.2, 0, 0.2, 0.006], { seg: 24, axis: 'z' }],
```

**Helpers and repetition.** The data files are TypeScript. `repeat(n, (i) => op)` builds a row: **the callback returns ONE op** (a single tuple), and the result is an array of ops that **you must spread with `...`** into `ops`. Use `.flatMap` when each step makes several ops. Forgetting the spread nests an array inside `ops` and fails with `op 7: an op must be an array starting with its name` and `does not compile: unknown op box,0.1,0.1,...`. `landmark-drafts.ts` imports `slab`, `tree`, `fence`, `lampPost` and `PAVING` from `tierkit.ts`; the same file also has `pine`, `treeLine`, `mast`, `signBoard`, `flags`, `block`, `helipad`. Each returns plain ops.

**Budget.** The London landmarks run 12 to 283 compiled ops (the median is 104). `landmarks:check` warns over 400 and fails over 800. Use `taper` and `lathe` for curved and faceted forms and `repeat` for rows instead of hundreds of boxes.

**Heights add up.** `height` on the design is the top of the tallest part, within 0.03. A `chimneyStack` adds about 0.07 above its `h`, a `cornice` at `storey = storeys` about 0.03.

## 6. Windows and facades

Only boxes carry windows, and only window faces light up at night. Pass a **window class** as the box's 8th element:

| Class | Draws |
| --- | --- |
| `true` | The kind's own class (`windows` on the kind: `office` for offices, `civic` for attractions) |
| `office`, `civic`, `home`, `shop`, `factory`, `venue` | That class's windows: office glass bands, civic sashes, a shopfront ground floor ... |
| `none` | A plain solid box |
| `fire` | Not a window: the whole box glows, faintly by day and fully from dusk, flickering on a phase of its own per building and per part (lanterns, braziers) |
| `beacon` | A red aviation light that blinks on a period and phase of its own per building and per light. A small box on a mast or a roof corner of a tall tower |
| `sign` | A lit logo or screen that comes on at a dusk time of its own per building. Use plain `sign` boxes: no brand names or logos |

**Window lighting varies per instance by hash everywhere**, so two copies of one landmark never light the same windows.

**Facades.** Give every box with windows a **facade** and a name so windows sit by storey and bay and doors, balconies and bands are placed by cell and never cover a window: `['box', w, h, d, x, y, z, colour, true, { name: 'hall', facade: { storeys: 2, bays: 6 } }]`. Choose `storeys` so a storey is 0.2 to 0.3 tiles tall and `bays` so a cell is 0.12 to 0.2 wide (a landmark may use wider cells, 0.3, for a stately front). Optional: `sideBays` (columns on the side walls; 0 blanks them), `ground` (`windows`, `door`, `shopfront`, `garage`, `plain`), `margin` (plain wall at each end of every wall), `top` (a plain band at the top: an attic, or a wall the roof of a neighbour rises against). Walls are `front` (+z), `right` (+x), `back` (-z), `left` (-x); bays count from 0 at the left **as seen from outside that wall**; storeys from 0 at the ground.

| Feature op | Arguments | Does |
| --- | --- | --- |
| `door` | `part face bay [colour]` | A door and step in that ground-floor cell |
| `garage` | `part face bay` | A roller door drawn in that cell |
| `balcony` | `part face storey fromBay toBay [rail] [slab]` | A slab on the floor line under `storey` (1 or more), with a rail |
| `baywindow` | `part face storey bay [roof]` | A glazed bay projecting from that cell |
| `porch` | `part face fromBay toBay [roof] [posts]` | A canopy on posts over ground-floor bays |
| `awning` | `part face fromBay toBay [colour]` | A canopy without posts |
| `cornice` | `part storey [colour]` | A band round the box on that storey's floor line (`storey = storeys`: the top) |
| `dormer` | `roofPart n [body]` | n dormers on a roof's front slope; the roof needs a `{ name }` |

`part` is a box's `name` or its index in the design's ops. The **windows check** fails any part that covers part of a window. The rules that matter on a landmark:

1. A part built against a windowed wall (a tower on a hall's front, a wing) must **cover whole cells**: line up widths with the cell width and heights with the storey height. The clock tower's hall has 0.3-wide bays and 0.3-tall storeys, and the 0.6-wide tower covers bays 1 and 2 exactly.
2. Where a roof or a neighbour meets a tall wall at a height that is not a whole storey, give that wall a plain `top` band (the clock tower's `top: 0.3`).
3. A box with a window class in front of a wall within 0.03 collides: stand props 0.04 clear.
4. `cyl` towers have no windows; wrap them in windowed boxes or give a `lathe` a `win` class.
5. Part names are single words.

## 7. Palette

`cream white pale stone brick grey dark slate terracotta glass glassDark corrugated rust chimney yellow navy red crossRed brown sand signBlue awning door steel plant roofGrey tan green silver charcoal timber mint boxBlue boxOrange boxGreen flare lawn lawnDark gravel pond hedge court gold marquee plum`, or any `0xRRGGBB` number. Landmarks use their own stone and metal tones as constants (London: `LIME = 0xd8c398`, `LEAD = 0x56606d`), which is fine; **nothing else** (no strings that are not palette names; the validator refuses them). Taste: `brick` for brick walls and `slate` for dark roofs; `red`, `terracotta`, `navy` and `glassDark` read as saturated crimson or cobalt on large walls; keep the sky-facing parts lighter than the base.

## 8. Reading at far zoom

From far away the game draws a simplified model. **What the far model keeps:** boxes of at least 0.003 tile³ (and at least 0.04 thick unless large), roofs, cylinders (at most 6 facets), cones (at most 5), tapers, and **lathes whole** (a landmark's body is what makes it recognisable). It drops doors, sills, bands, cornices, balcony slabs, small props, wheels and the facade cell detail (windows blur to the class average). A design that would lose everything keeps its biggest part.

So build the **silhouette from big solid parts**: the Gherkin is one lathe, the Shard one taper, the clock tower a box stack under a lathe spire. Test by squinting: zoom the viewer out and check the shape alone says what it is. Details are for near zoom.

## 9. Moving parts

**A recipe stands still.** What moves or lights up is drawn by the client in `packages/client/src/render/landmarks.ts` from **constants the recipe file exports**, placed as the structure is placed (centred on its footprint, turned to its door), and driven by the **game clock**, so every client sees the same. Every motion is **per-instance phased by hash** (the organic rule: nothing is a uniform switch): each Eye starts turning at its own time and picks its own rim colours; each clock dial lights at its own darkness and brightness.

| Motion today | Constant | What moves |
| --- | --- | --- |
| London Eye | `LONDON_EYE` | Wheel and 32 capsules turn (one turn in 3 game hours, only while open); rim lights by night |
| **Clock dials** | `BIG_BEN`, `CLOCK_TOWER` | Four faces light at dusk and show the game's time (hour and minute hands) |
| Tower Bridge | `TOWER_BRIDGE` | Bascules lift a few times a day for a barge |

**A clock tower needs no client work beyond one table row.** Draw four static dials in the recipe (see `dials()` in `landmark-drafts.ts`), export a constant `{ x, z, y, face, r }` (the middle of the clock stage in the model's frame, the distance from its axis to the face of a dial, the dial's radius), and ask a maintainer to add one row to `CLOCKS` in `render/landmarks.ts` (kind id to constant). Until the row exists the dials are static. Do not edit the client in a landmark pull request except that row.

**A new kind of motion** (a windmill, a rotating beacon, a flag) is a client change, reviewed separately. Propose it in the pull request: the exported constant, what moves, and how it follows the game clock (`hours` since day 0, `night` 0 to 1) with a per-instance phase from `hash2(seed, n)`. Keep it clock-driven and cheap; it must never be needed to read the building, because the far tier, thumbnails and the viewer's stills show the recipe alone.

## 10. Kind ids, tags, collections and the tech lock

- **Draft ids: 230-249**, reserved in `codes.ts` (`LANDMARK_DRAFT_IDS`). 230 is the template, 231 the clock tower; take the next free one. Never reuse an id for a different building. Other ranges are taken (16-28 the first sub-kinds and harbours, 40-117 ladders, merged lots, London and education, 120-132, 150-154, 160-209 utilities), so a live landmark's permanent id is **assigned by a maintainer** when the draft is accepted.
- **A live landmark** takes a permanent kind id from 16 to 255 outside 230-249 and 160-209, a **tool** (`{ id, key: '', label, color }`), a `group` that is a `collection: true` rung (`groups.ts`: `london`; a new city is a new group), a `tier` (1, 2, 3 ... in order), and its tool id listed in a **`locked` tech node** (`tech.ts`: `lnd1` "London landmarks", `lnd2` for universities). Every landmark tool is unlocked only by a locked node, so **a live game cannot place a landmark yet**: the unlock rule is to be decided. Sandboxes, demos, the Commons, the dev "unlock everything" action and a `?dev` client place them.
- **It stands in a city demo.** A live landmark must be placed in its city's demo scenario (London: `shared/src/demo/london.ts`, docs/demo.md "London"); `demo:check` fails one that is not (`showcaseProblems`). Landmarks belong in their city, not the Showcase. Drafts are viewer-only and need no placement.
- **Accepting a draft** is a maintainer step: drop `draft` and the `draft` tag, give it the permanent id, tool, collection rung, tech lock and demo placement, and move it into its city's landmarks file.

## 11. The draft path

Everything is in `packages/shared/src/buildings/landmark-drafts.ts`, which exports `LANDMARK_DRAFTS: KindDef[]`.

1. Run `npm install` and `npm run dev` (the viewer is at `http://localhost:5173/viewer.html`).
2. Copy the `TEMPLATE` constant (it is the first thing in the file after the imports: from `export const TEMPLATE` to its closing `};`, about 25 lines, every essential field in it, including `levels`), paste it below the last kind, and rename: `id` (lower-case words and dashes), `name` (lower case, as used in sentences), `kindId` (the next free one in 230-249: **`npm run landmarks:check` prints every landmark's id, drafts included**, and validation refuses a duplicate), `tags` (`['draft', '<city or era>']`).
3. Choose the role by spreading a preset: `...asOffice` (the template's default) or `...asAttraction`; override `family`, `code`, `flags` and `attrs` for another role (copy a London kind from the table in section 1). To change one attribute of a preset write the whole object: `attrs: { ...asAttraction.attrs, ticket: 0, visitorCapacity: 12 }` (a bare `attrs` key replaces the preset's). `capacity` is staff and `visitorCapacity` how many visitors it holds (section 1).
4. Set `footprint` (section 4), `blurb` and `howTo`, and the level numbers. Replace the ops. Keep `draft: true` and an `author` on the design.
5. Add the kind to the `LANDMARK_DRAFTS` array at the bottom of the file.
6. Save: the Vite plugin recompiles, the viewer reloads. Without the dev server run `npm run buildings:compile` (and commit the regenerated `compiled.ts` and `recipes.ts`; never edit them by hand).

The template as written:

```ts
const TEMPLATE: KindDef = {
  ...DRAFT,                          // landmark, draft, tags ['draft']
  ...asOffice,                       // the role: code, family, flags, windows class, occupation, lot
  id: 'landmark-template',           // <your-landmark-id>
  name: 'landmark template',         // <the Name of the Building>
  kindId: 230,                       // <free id in 230-249>
  footprint: { w: 2, h: 2, door: [0, 1] }, // <w×h up to 4×4>; door [dx, h - 1]
  blurb: '...', howTo: '...',        // <the game's voice>
  levels: [{
    capacity: 20, wage: 20, cost: 3000, upkeep: 30, work: 800, parking: { surface: 2, underground: 6 },
    designs: [{
      name: '<short description of the model>', height: 0.9, draft: true, author: '<your name or model id>',
      ops: [
        slab(2, 2, PAVING),
        ['box', 1.2, 0.6, 0.8, 0, 0.02, 0, 'cream', true, { name: 'main', facade: { storeys: 2, bays: 4 } }],
        ['door', 'main', 'front', 1],
        ['roof', 1.24, 0.22, 0.84, 0, 0.62, 0, 'slate'],
        ['cyl', 0.01, 0.02, 0.06, 0, 0.84, 0, 'gold', 6],
      ],
    }],
  }],
};
```

**Checking a scratch file** before it joins the tree. Save it beside the other recipes as `packages/shared/src/buildings/scratch-landmark.ts` (delete it before you commit; elsewhere, write the full path in the imports) with this header and shape, then run `npx tsx packages/shared/scripts/check-landmarks.ts packages/shared/src/buildings/scratch-landmark.ts` (or `check-drafts.ts <file>`, which hands a kind file to the same check). The file must export one array of kinds; a kind whose id is already in the catalogue replaces it, so use your own id.

```ts
import type { KindDef, Op } from './schema';
import { repeat } from './helpers';
import { slab, PAVING } from './tierkit';
import { TEMPLATE, asOffice, asAttraction } from './landmark-drafts';

export const MINE: KindDef[] = [{
  ...TEMPLATE,                  // the draft flags, the office role, a 2×2 footprint and the template's level
  ...asAttraction,              // optional: a different role replaces code, family, flags, windows, occupation, lot and attrs
  id: 'my-landmark', name: 'my landmark', kindId: 233,   // the next free id in 230-249
  tags: ['draft', 'my-era'],
  blurb: 'What it is and what it is known for, in a sentence or two.',  // the game's voice, 20 characters or more
  howTo: 'How to place it: the plot and the street it faces.',
  levels: [{
    capacity: 20, wage: 20, cost: 3000, upkeep: 30, work: 800, parking: { surface: 2, underground: 6 },
    designs: [{ name: 'what it looks like', height: 0.72, draft: true, author: 'me', ops: [
      slab(2, 2, PAVING),
      ['box', 1.2, 0.6, 0.8, 0, 0.02, 0, 'cream', true, { name: 'main', facade: { storeys: 2, bays: 4 } }],
      ['door', 'main', 'front', 1],
      ...repeat(3, (i): Op => ['box', 0.1, 0.1, 0.1, -0.3 + i * 0.3, 0.62, 0, 'stone']),   // one op each, spread with ...
    ] }],
  }],
}];
```

To move it into the tree, delete the header's unused imports, paste the object into `landmark-drafts.ts` (which already has them) and add it to `LANDMARK_DRAFTS`.

## 12. The viewer

`http://localhost:5173/viewer.html?tag=draft` shows every draft landmark on a turntable, by day and night (the Day and Night switch, or the Hour slider), with its attributes. The **Tag** row filters by tag (`Draft`, `London`, `Victorian` ...) and **Designer** by `author`. `viewer.html#d=231:1:0` opens one design: `#d=<kind id>:<level>:<design index>`. Moving parts the client draws (Eye, clock dials, bascules) show on the turntable too. Attach screenshots to your pull request: the model by day, at night, and from far.

## 13. The checks

Run them in this order before opening a pull request:

| Command | What it checks |
| --- | --- |
| `npm run buildings:compile` | Validates the catalogue and regenerates `compiled.ts` and `recipes.ts` (commit them) |
| `npm run landmarks:check` | Every landmark (live and draft), or one file: the model within its footprint in all four rotations; height at most 10 tiles (warning over 8); compiled ops at most 800 (warning over 400, London for reference); no floating parts (live London parts are the baseline); no part covering a window; palette names or `0xRRGGBB` only; `tags`, `blurb`, `howTo` present; a draft has no tool, only draft designs and an id in 230-249; every live landmark stands in a city demo |
| `npm run buildings:check` | The whole catalogue snapshot: places every landmark in all four rotations, the window collision rule, and that no draft leaks into the city batch |
| `npm run demo:check` | Every live landmark is in its city demo |
| `npm run typecheck` | Types |

`npx tsx packages/shared/scripts/check-drafts.ts packages/shared/src/buildings/landmark-drafts.ts` runs the landmark check on the drafts file.

## 14. Pull-request checklist

- [ ] One landmark per pull request; a draft in `landmark-drafts.ts`, `draft: true` on kind and design, `author` set
- [ ] `kindId` from the reserved 230-249 range, unused; tags `['draft', ...]`
- [ ] Footprint up to 4×4, door `[dx, h - 1]`, the model's door on the front inside the door tile
- [ ] Heights from the 33 m rule; silhouette reads at far zoom (screenshot from far)
- [ ] Palette names or `0xRRGGBB`; windows by class and facade; nothing drawn on a windowed wall by hand
- [ ] `blurb` and `howTo` written in the game's voice; no brand names, logos or signage text
- [ ] Moving parts, if any, only as an exported constant plus a described, separately reviewed client change
- [ ] `npm run buildings:compile` committed; `landmarks:check`, `buildings:check`, `demo:check` and `typecheck` pass
- [ ] Viewer screenshots attached: by day, at night, far

## 15. Review rubric (for a reviewing agent)

Score each 0 (fails), 1 (needs work) or 2 (good). Ship at 18 or more with no zero.

1. **Silhouette:** at far zoom the shape alone says what the building is; big solid parts carry it.
2. **Footprint:** the model fits its footprint in all four rotations; the door tile is on the front row; the model's door is on the front inside it.
3. **Palette:** palette names or `0xRRGGBB` only; no saturated `red`, `navy` or `terracotta` walls.
4. **Windows:** boxes with windows have a facade and a name; doors and bands are placed by cell; nothing covers a window; `beacon`, `sign` and `fire` used only as lights.
5. **Scale:** heights agree with the 33 m rule and the London table; within 10 tiles.
6. **Organic rule:** nothing visual is a uniform switch; lights and motion phases hash per instance.
7. **Moving parts:** none in the recipe; any motion is an exported constant, clock-driven, per-instance phased, and a separate client change.
8. **No trademarks:** no brand names, logos, or signage text; public buildings depicted by form.
9. **Budget:** within 400 ops, repeated parts built with `repeat`, curves with `taper` and `lathe`.
10. **Checks green:** `landmarks:check`, `buildings:check`, `demo:check`, `typecheck`; compiled output committed.
11. **Words:** `blurb` and `howTo` are in the game's voice, accurate, one or two sentences each, with what the building is known for and how to place it.

## 16. Likeness and taste

- **Depict public buildings by their form**: massing, proportions, roof and tower shapes, the materials' colour. Avoid trademarked logos and signage text; use `sign` boxes without brand names. A generic type (a Victorian town hall) is as welcome as a named building.
- Give the front (+z) the main facade and the door; spend the detail there, and keep a recognisable back.
- Keep **per-instance variation** in anything visual: window lighting varies by hash already; for lights, flicker and motion take a per-instance phase and never a uniform switch.
- A landmark is **one design**. Do not pad it with props: a few trees, lamps and railings give scale; hundreds of boxes do not.
- Draw it **shorter than life** if the real building does not fit 4×4; keep proportions between the parts.
