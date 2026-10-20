# Death and remembrance

Card a922eaec (UTD board civitas). Before this, a citizen who died was removed on the spot: no body, no funeral, no
record, and their money vanished. Fires and accidents never killed anyone.

Code:
- `shared/src/remembrance.ts`: the rules (`DEATH`), causes, the kinds' specs, plot layouts, headstone looks and the wire types.
- `shared/src/buildings/remembrance.ts`: the five kinds.
- `server/src/sim/death.ts`: the archive, bodies, the hearse, funerals, grief and estates.
- `client/src/render/graves.ts` (headstones and funerals) and `client/src/remembrance.ts` (the panels).
- Probe: `loadtest/death.ts`.

Rich's answers (2026-10-20):
- 1c: fires, explosions and accidents kill freely, except the warning fire and in a player's first hour.
- 2a: an archive with inspectable headstones and family trees, and a hook for N5's memories.
- 3a: a hearse and a small procession; close family take the day off.
- 4a: inheritance, with the fees paid out of the estate.
- 5a: faith-neutral places.
- 6a: no space means the hospital mortuary, a badge and a hint.

## 1. The places

| Kind (id) | Footprint | Family | Holds | Fee to the estate | Cost, upkeep |
| --- | --- | --- | --- | --- | --- |
| Funeral director (150) | 1×1 | office, placed civic | 6 staff, half of them hearse drivers | $220 (ledger "Funeral fees") | $600, $12 |
| Churchyard (151) | 2×2 | park | 29 or 34 plots (by design) | $120 (ledger "Burial and cremation fees") | $700, $6 |
| Municipal cemetery (152) | 3×3 | park | 84 or 91 plots | $150 | $1,400, $12 |
| Garden cemetery (153) | 4×4 | park | 118 or 126 plots | $260 | $2,600, $22 |
| Crematorium (154) | 3×2 | park | 6 funerals a day; 24 memorial plaques, the newest replacing the oldest | $180 | $2,200, $30 |

- Each kind has two designs:
  - funeral director: a Victorian brick undertaker's, or a stone chapel of rest;
  - churchyard: a flint chapel with a lych-gate and yews, or a stone chapel with a squat tower;
  - municipal cemetery: twin Victorian chapels on an avenue of limes, or a modern brick chapel by hedged rooms;
  - garden cemetery: Highgate-like, with an Egyptian avenue to a circle of catacombs under a cedar, or Kensal Green-like, with a Doric chapel and colonnades;
  - crematorium: a red-brick Italianate chapel with a campanile chimney, or a pale hall with a steel chimney and a reflecting pool.
- Each design's `plots` attribute lists rectangles in the model's frame. `plotSpots` turns them into footprint coordinates, front rows first, each plot nudged off its grid by a hash; a garden cemetery's are nudged further.
- The four resting places are a `stages` ladder in the group "Cemeteries". They are leisure places of low appeal, which makes them quiet green space: "park nearby" and a little leisure for the homes in their radius (8, 10, 12, 12), and the odd retiree's walk. They hire nobody (a park has no staff); the funeral directors' people hold the services.
- Technology `rem1`, **Remembrance**: civic track, tier 3, $900, after Healthcare, 300 residents. That is about the Village rank (340 on the Commons, 400 on a frontier).

## 2. A death

`Simulation.lifeStep` makes a single call, `death.lifeRoll(c, age)`:
- It rolls old age and illness as before: `deathChance` and the same `Math.random` draw, so the shared stream is unchanged.
- For someone at work in a works or on a building site, it adds a fatal accident: 0.05% a day (0.04% at a yard), halved in a hospital's cover, from a hash of the id and the day.

`Fires.onHarm` fires once a fire is out, or when a building blows up, before the damage is done. Each person in the building (at home, at work, visiting or building) dies with these odds, rolled from a hash of their id and the fire's:
- burnt down with no crew: 18%;
- put out by a crew: 12% × (share burnt when the crew came)², so about 0.2% when they come at once;
- a blast: 30%, or 55% when it flattens the building;
- the warning fire and the demos' drills: never.

**The first-hour rail.** Nobody in a player's town dies in their first real hour (18,000 ticks). That hour starts at the player's first sight, or `ranks.at[0]`, whichever is earlier. It does not apply on the Commons or in a sandbox.

`die` writes the record:
- the id and surname seed, the birth and death, the age and cause;
- the parent, partner and children;
- up to three friends;
- the home's owner, and where the body was left:
  - home, work, a site or a venue where they were;
  - a hospital (or home) when they died on the way somewhere;
  - the burning building in a fire.

The citizen then leaves the world as they always did.

The archive holds 1,500 records. Beyond that the oldest go first, but never a record whose headstone or plaque still stands or whose funeral is still to come. Old saves load with an empty archive (the snapshot's `death` field is optional; VERSION stays 8).

## 3. The funeral

1. **Collection.** The nearest staffed funeral director within 80 tiles sends its hearse (`FleetKind.Hearse`) when a driver is on shift (8:00 to 18:00). The hearse is a fleet unit in `sim/mobile.ts` with the death module as its service. It collects the body and brings it back. A body nobody collects within a day is taken in anyway, as if by a private ambulance.
2. **Booking.** At the funeral director's, the nearest resting place within 80 tiles with room is booked: a plot, or a crematorium's day. The service is set 2 to 4 days on, between 10:30 and 15:30 (both hashed per person). Close family (partner, children, parent) take that day off. The mourners are close family first, then friends, at most six.
3. **The service.**
   - The mourners set off an hour before (an errand trip, `ERRAND_FUNERAL`). They stay until the service ends, and at least 20 minutes if they come late.
   - The hearse leaves 45 minutes before and stands at the chapel through the service (1.25 hours).
   - A service waits up to 1.5 hours for a hearse held up in traffic, then goes ahead without it. So does a service with no driver to be had.
4. **Burial.** The plot holds the record from then on: a headstone stands on it, or the newest plaque in a crematorium's garden replaces the oldest.
   - The fees come out of the estate, in proportion. When the estate cannot cover them, the owners get what there is.
   - The rest goes to the partner, else the children in equal shares, else the parent.
   - The home stays with whoever still lives in it.
   - Children left with no grown-up go to relatives out of town, as before.

**No space in reach.** The body waits at the nearest staffed hospital within reach of the funeral director, or at the funeral director's when there is none. That building shows **No burial space** (`Issue.NoBurial`, code 8, a sage-green headstone glyph), and the owner gets the hint `burial`. Every two game hours the module tries to book again. Once a body is booked the badge goes, and on the day the hearse fetches the body from the mortuary. After 10 days the county takes it.

**No funeral director in reach** (or before Remembrance): the county takes the body out of town, and it is "laid to rest out of town" after 5 days for a $150 county fee.

**Grief.**
- The partner, children and parent grieve for 5 days (life.ts `MOODS`):
  - "grieving" is −8 happiness;
  - "waiting to bury a loved one" is −12 while the body is at the mortuary or away;
  - on a working day a grieving worker stays home one time in four, and that counts as a sick day.
- A funeral on time ends the grief 2 days after the service.
- Every check that finds the body still waiting adds a day, up to 16 days from the death.

## 4. What the player sees

- **Headstones.**
  - Each chunk's stones are one instanced mesh. Six shapes are merged into one geometry (a rounded tablet, a square one, a cross, an obelisk, a ledger slab and a plaque), and the vertex shader keeps only the instance's own.
  - Every stone is its own, hashed from the deceased's id: shape, height, width and stone colour; a lean and a tilt that grow with the years since the burial; weathering darker and greener.
  - Flowers lie on a grave for 10 days and wilt until day 24. They come back on some anniversaries (45%) and after an occasional visit.
- **A funeral under way.** The open grave and its mound, with the mourners round it in dark coats, each with their own height, place and bowed head or not. For a cremation they stand inside the gate.
- **The headstone panel.** Click a stone, or a name in a list:
  - the inscription, with the years (a game week is a year, and day 0 is 2026);
  - how and where they died, where they rest and the funeral;
  - the estate and who had it, and the news story;
  - the family tree: parent, partner, children, grandchildren, siblings and friends. Living relatives select the citizen; the dead open their own panel.
- **The building panel.**
  - A resting place: its plots, fee, the funerals planned and recent burials.
  - A funeral director: the bodies in its care, the funerals planned and those held.
  - A mortuary: the dead waiting there.
- **The citizen panel** gains "In memory" (the dead they mourn, openable), and the grief shows in happiness.
- **The hearse** (`FleetKind.Hearse`, 11): a long black estate with a chrome rail, each its own sheen, with a coffin and its wreath behind the glass when loaded. The funeral director stands by the back door at the chapel.
- **The news.** An incident's dead are one story (`StoryKind 'death'`): "2 die in fire at a block of flats in Riverside", "Worker killed in accident at Vertex Fabrication". The story carries `dead`, the deceased's ids.
- **The first death in a town** brings the advisor's `death` line, saying who died, where, and what happens next. It also brings in the event goal **Lay them to rest**: unlock Remembrance and place a funeral director and a resting place, for $300. The goal comes in once the technology could be bought, ahead of the chain's next goal.

## 5. Hooks

- **N5, memories** (docs/media.md): `Death.memoriesOf(c)` lists a citizen's dead (relation, cause, when, and the story of an incident), and `StoryDTO.dead` names an incident's dead. That is enough to say "my grandad died in the Brixton fire" and open his headstone.
- **Motivation** (docs/motivation.md, Roots): `Death.mourningOf(c)` gives the dead a citizen was close to.

## 6. Showcase and London

- **Showcase:** the section "Cemeteries" on district C3's north row: a garden cemetery (70% full), the municipal cemetery (50%), the funeral director, a churchyard (55%) and a crematorium (60% of its plaques). The seeded dead died up to 90 years before the town began, mostly of old age, with couples side by side under one surname (`seedDemoGraves`).
  - The funeral drill (`demoFunerals`, sim/death.ts `drills`) runs a pretend funeral to the churchyard every 2.2 game hours: the hearse, a few neighbours as mourners, an open grave.
  - Tour stops: funeral director, A funeral, churchyard, municipal cemetery, garden cemetery, crematorium.
  - Features `funeral` and `headstones` in `SHOWCASE_FEATURES`. The section is also in the Civic demo.
- **London:** Highgate, Kensal Green and Brompton cemeteries (garden cemeteries) and Golders Green Crematorium, named and placed where the real ones are, their dead going back 180 years.

## 7. Checks and measurements

`npx tsx packages/server/src/loadtest/death.ts [--seed 1] [--quiet]` runs on a 1×1 Commons with a funeral director beside a churchyard. Since motivation (M2) nobody is out of work in that town, so a new service hires only job-switchers; the probe moves five neighbours with ordinary jobs to the funeral director when it has not hired in half a day. It has 40 checks in eight sections:
1. A death archives with its record and family.
2. A hearse collects the body; the service is booked 2 to 4 days on; mourners go; the partner takes the day off; the burial fills a plot that the graves message carries; grief ends soon after.
3. The fees go to the owner under 'funeral' and 'burial', and the rest of the estate to the partner.
4. With the churchyard full, the dead wait at the hospital under the badge. A crematorium placed in reach takes them (plaques), and the badge clears.
5. Hand-lit fires at night: unattended ones kill (24 of 140 people at home); with the post staffed, 1. Gas explosions kill; each incident is one news story naming its dead. Accidents happen at a raised rate.
6. In a player's first hour, 27 deaths are spared; after it they happen. The first death brings the advisor line. The warning fire harms nobody.
7. The same seed gives the same archive and graves.
8. A save carries the archive; a save without the field loads with an empty archive.

In the probe's dense test town only 1 of 5 services had the hearse at the chapel: its streets jam at midday, and the hearse cannot turn out of the driveway. The service goes ahead without it, and in the showcase the hearse comes.

Tick cost: on a 2×2 test city (seedCity built 3, seed 1, 4,936 citizens), 1.1 game days' fill then 2,400 `Game.step`s, four interleaved pairs at nice 15 against main 7e7ea28 (scratchpad `bench.mts`): 1.956 ms on this branch against 1.957 ms on main, the medians of each side, **0.0%** (pairs +4.9, −1.0, −2.8, −0.4%: noise). Nothing runs per tick but a look at the bodies in hand every 10 ticks; the daily roll is the old one plus a hash for workers at a works.
