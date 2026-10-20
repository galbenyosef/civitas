# Media: TV studios, the news, news helicopters, live TV and citizen memories

**Built: N1+N2 (2026-10-20).** This covers the broadcaster ladder, the techs, coverage, the news story log, the News panel and ticker, and the news overlay. N3–N6 are designed below and not built yet.

Rich, 2026-10-20: *"a new building, a media / TV centre. At later levels it has its own helicopters that fly to scenes
around the city and broadcast live to people watching the TV (in FPV mode). We also need to keep track of short-term
and long-term events each citizen has experienced, so they can use them in conversations with others."*

Rich's answers (UTD card 90cd3857):

1. The media centre **is** adverts' TV studio (docs/adverts.md section 9).
2. **a.** Coverage: tier 1 covers its own town and tier 3 the whole map. Rival players' channels compete where they overlap.
3. **a.** Live pictures are a real render from the helicopter camera: low resolution, a few frames a second, FPV only.
4. **a.** Conversations show in the citizen panel and as FPV speech lines, with occasional bubbles at close zoom.
5. **a.** Each citizen has 4 short-term memories (fading over about 3 days) and 4 long-term ones (kept by salience).
6. **Yes.** Bad news changes opinions once motivation lands.
7. **a.** One news helicopter at tier 3, and two at a later national HQ.

## 1. The building (N1, built)

`packages/shared/src/buildings/media.ts`. The `media` ladder (groups.ts, the **Media** button in the Services section of the tool bar) is three placed, civic sub-kinds of the office family (code 4), like the London towers. They employ office-track graduates (`skill: [degree, share]`), pay upkeep, and never grow or burn.

| Tier | Kind (id) | Tool | Size | Staff | Cost / upkeep | Reach (`newsRadius`) | Tech |
|---|---|---|---|---|---|---|---|
| 1 | local TV studio (130) | `tvstudio` | 1×1 | 14 (40% graduates) | $900 / $35 | 24 tiles, about a town | med1 Local television |
| 2 | broadcast centre (131) | `broadcast` | 2×2 | 40 (50%) | $3,000 / $90 | 48 tiles, a district | med2 Broadcasting |
| 3 | media centre (132) | `mediacentre` | 3×2 | 90 (60%) | $7,500 / $200 | 0: the whole map | med3 Media centres |

**Designs.** There are two per tier:
- **TV studio:** a brick newsroom with a sound stage and a lattice mast, or a white studio with a roof dish farm.
- **Broadcast centre:** a glass studio block with a dish yard and outside-broadcast vans, or a stone broadcasting house with a round studio drum.
- **Media centre:** a glass tower with the news helipad on its roof, a big screen and a dish array, or a stepped centre whose glass newsroom drum carries the helipad.

**Dishes.** The `dish()` helper takes a radius and a direction: up, front, right or back. Each design has its own field of them.

**Per-instance variation.** Each tile picks its design and its facade tints by hash. There are two new light classes (palette.ts `WINDOW_CLASSES`, render/materials.ts `Win`):
- **`beacon` (8):** a red aviation light on a mast or roof corner. It flashes on a period of 1.1–2 s and a phase of its own per building and per light, so no two masts blink together.
- **`sign` (9):** a lit logo or screen. It comes on at a dusk time of its own per building and breathes slowly on a phase of its own per part.

**Attributes** (read by shared/src/news.ts into `NEWS_RADIUS_OF`, `NEWS_TIER_OF`, `NEWS_HELIS_OF`):
- `newsRadius`: square tiles from the door; 0 is the whole map.
- `newsTier`: decides who wins a story that two channels reach.
- `newsHelicopters`: 1 on the media centre.

**The pad.** The media centre's helipad is found like any other (helipads.ts). `padKindOf` gives it the new PadKind **`'news'`**. Its routine timetable in helicopters.ts is empty, so the helicopter waits on the roof until N3 sends it out. The showcase feature `heli-news` is a `todo` until then. `HELI_OPERATORS.news` holds two stand-in liveries.

**The techs** are on the culture track, after Advertising, because the media centre is also adverts' TV studio:

| Tech | Tier | Needs | Condition | Cost |
|---|---|---|---|---|
| med1 Local television | 3 | cul2, adv1 | 120 residents | $900 |
| med2 Broadcasting | 4 | med1 | 340 residents | $2,000 |
| med3 Media centres | 5 | med2, con2 | 560 residents | $4,500 |

The card wanted a Village rank gate on tier 2 and a Town gate on tier 3. Tech conditions are counters, so these gates are the residents those ranks need (ranks.ts: Village 340, Town 560). A real rank gate is a later change if Rich wants one.

**Showcase.** The `media` section puts the broadcast centre (14, -7), the TV studio (17, -7) and the media centre (20, -7) on the north row of district B3. The tour stops after the museum. The feature registry's `news` entry needs the media centre and the fire drill, so the showcase always has stories.

## 2. Coverage (N1, built)

`shared/src/news.ts`:
- `reaches(channel, x, y)`: whether a staffed centre reaches a tile (square, from its door; radius 0 is everywhere).
- `coverStory(x, y, centres)`: picks the covering channel. Each player's best centre at the spot counts: its highest tier, then its nearest. Across players, the highest tier wins, then the nearest, then the lower player id, so list order never matters. The other players are the story's **rivals** (`rv`).

**Staffed** means `occupants > 0` and not mothballed. Uncovered stories are still logged (N5's witnesses will want them), but the client never shows them.

Where the channels show:
- **The building panel** (`MediaInfo`, net.ts `info.media`): the channel's name ("Ada TV", from `channelName`), its reach, whether it is on air, rival channels in reach, stories run, the newest three headlines and its helicopters.
- **The news overlay** (`Overlay.News`, the H cycle and the overlays menu): each land tile shows no channel, one, or two or more competing (`News.channelsOver`). The bytes are shared by every client, so the overlay counts channels rather than colouring "yours".

**Airtime** (adverts A6) is not built. Its hooks are the channel of a centre (`News.describe`) and `centresNow()`, the staffed centres by owner, which A6's spot auction can read.

## 3. The news story log (N2, built)

`server/src/sim/news.ts`, the `News` class (`game.news`). It does nothing per tick: game.ts wires hooks, and each event makes or updates a story.

| Source | Hook | Story |
|---|---|---|
| a fire lit / put out | `Fires.onStory` (`FireStoryEvent`, phase `lit` / `out`) | `fire`, live until out. The headline changes with the outcome: saved, the bucket chain, floors lost, burnt down. The showcase's drill is one story a game day per drill home |
| fire spread, explosions | the same hook, phases `spread` / `explosion` | `fire` ("Fire spreads to …") and `explosion`. **Fires v2 calls these where it spreads and explodes.** Until it lands, nothing sends them |
| a rank reached | `Ranks.onStory` (`RankStoryEvent`, kind `rank`) | `rank` at the celebration spot ("The Commons becomes a Hamlet") |
| a milestone | the same hook, kind `milestone` (residents and jobs marks, firsts, research) | `milestone` ("Ada's town: 500 residents") |
| a notable opening | `World.onSiteCompleted` | `opening`: a civic building costing $1,200 or more, or a landmark. A broadcaster finishing goes "on air" |
| a new line | Net's line save (a line with no id yet) | `line` ("Bus route 3 opens in …", "The Central line opens …") |

**A story** (`StoryDTO`) has these fields:

| Field | What it is |
|---|---|
| `id` | rising and unique; a story updated later keeps its id |
| `t` | the tick it broke |
| `k` | its kind |
| `x`, `y` | the place |
| `h` | the headline |
| `s` | salience, 0–100 |
| `end` | when it stops being live. Absent while a fire burns; every other kind gets `t + NEWS.liveHours` |
| `who` | the player it is about |
| `pc` | the parcel |
| `b` | the building's kind |
| `ch` | the covering channel |
| `rv` | its rivals |

**Headlines** come from `HEADLINES` in shared/news.ts. The template is picked by `storyPick(id, salt)`, so the same story reads the same everywhere. They are filled with real names:
- businesses by their sign (`signSource`, the same name as on the building)
- homes as "a house" or "a block of flats"
- placed buildings by kind
- places by the parcel's own name, or "Ada's town" while the parcel still has its default name

Nothing in a headline is typed by a player.

**The ring.** It keeps the newest `NEWS.keep` (200) stories, none older than `NEWS.keepDays` (7 game days). A fire still burning is never dropped for age.

**Wire.** The `news` message (`{ t: 'news', s, all? }`) is additive:
- On joining, `all` brings the newest `NEWS.helloSend` (60).
- After each frame, the stories new or changed since the last.

The client keeps stories by id.

**Snapshot.** `news?: NewsSave` holds the ring, each story's `ref` (the fire it follows), and `nextId`. VERSION stays 8. A save without the field loads with an empty log, and an empty log saves no field. A fire burning at a save still gets its end after loading, because the fire's id is in the story's `ref`.

**Determinism.** Ids come from a counter and headline picks from hashes. Coverage reads the staffed centres, looked up again every quarter game hour and sorted by tile. With the same world and the same events, the same stories come out. The probe checks this on two runs.

**The client** (client/src/news.ts):
- `NewsStore`, with the exported singleton `news`.
- The **news** chip in the top bar. It appears once a channel has reported something and glows red for unseen stories.
- The **News panel**: newest first, each story with its channel's colour, the time, a LIVE mark while it goes on, its rival channels and "show me". The "my channel" filter appears when you own a channel.
- The **ticker** above the help line: the channel bug and the headline of each story that just broke, about 7 seconds each.
- `mediaHtml` for the building panel.

## 4. Hooks for what comes next

- **N3, news helicopters.** Write `newsFlights(pads, stories, tick)` in shared/helicopters.ts as a pure function. It picks covered stories (`ch`) above a salience whose channel owns a `'news'` pad (the pad's `bx, by` lies on that owner's parcel), using `storyLive(s, tick)` and `x, y`. The nearest free news helicopter takes off at `t` plus a hashed delay, orbits while live and comes home. Every client has the same stories, so every viewer sees the same flight. Give `SERVICE.news` rush-hour traffic flights for days with no stories. The outside-broadcast vans of tier 2 can follow the same choice by road.
- **N4, live TV in FPV.** A home's TV shows the stories of the channel covering the home: `coverStory(home)` over the centres in loaded chunks, or simply `story.ch`. When a story has a helicopter over it (N3), the TV shows that camera. Otherwise it shows a studio card with `h` over the station's look. adverts' ad break plays between items.
- **N5, memories.** A memory's subject is a story `id`:
  - **Witnessed:** a citizen whose daily path passes within N tiles of `x, y` between `t` and `end` (uncovered stories count too).
  - **Watched:** at home in the evening with a TV, on a story whose `ch` reaches the home.
  - Salience `s` is the memory's starting strength. `who`, `pc` and `b` give the people involved: the residents of the building at the door tile.
- **N6, conversations.** Lines come from templates keyed by `k` and fill from `h`'s words. The client keeps the stories, so nothing new goes on the wire.
- **The Piccadilly Lights' news turn** (merged). Every 'news' turn on a big screen samples `AdvertsView.setNewsFeed(tex)` (render/adverts.ts). NewsUI's `drawCard` feeds it a 512×300 canvas card of the newest covered story: the channel's bug in its colour, LIVE while it goes on, the headline wrapped to four lines, and the time. The card is redrawn only when that story or its headline changes, and null puts the placeholder back while nothing has been reported. N4 swaps the card for the helicopter's render target. `news.latest(n, ch)` gives one channel's stories.
- **Fires v2** (branch fires-2). Whichever branch merges second wires two calls to `Fires.onStory`:
  - In `ignite()`, the 'lit' call sends phase `'spread'` when `opts.from` is set (1 caught from next door, 2 lit by a blast).
  - In the private `blast()` that every `Fires.explode()` ends in, one `'explosion'` call goes after the neighbours are lit: `{ phase: 'explosion', id: f.id, x: f.x, y: f.y, owner: f.owner, kind: b.id }`.

  A blast that levels a building is folded into `burnt`, so its 'out' story reads "burns down".

## 5. Measured

- **Tick cost:** −1% (noise; the target was under 2%). On a 2×2 test city (seedCity, built 3, seed 1, 4,988 citizens) filled for 1.1 game days, 3,000 `Game.step`s, five alternating runs of the same script (scratchpad `bench.mts`) on main ee47163 and on this branch:
  - main: 2.003, 2.010, 1.860, 1.870, 1.811 ms (mean 1.911)
  - branch: 1.993, 1.853, 1.885, 1.863, 1.832 ms (mean 1.885)

  The same game on both: the same citizens and the same ticks. News runs only at events.
- **The probe:** `npx tsx packages/server/src/loadtest/media.ts` passes 29 of 29. It checks coverage and overlap between two players, a tier-3 centre winning, the overlay counts, the building panel, a fire story and its end, a rank-up through `Ranks.check`, the ring bound, two runs giving the same stories, and old saves.

## 6. The rest of the design (N3–N6, not built)

**News helicopters (N3).** These run on the client, deterministic like the other helicopters, and fly from a new pad kind `'news'`. Each has a light airframe and the station's livery (a colour per instance). The schedule stays a pure function of the pads and the story list, which every client already has. For each covered story above a salience, the nearest free news helicopter:
1. takes off at the story's start plus a hashed delay;
2. flies to the scene;
3. orbits it at about 120–200 m for the story's length;
4. returns.

On days with no stories it flies routine traffic flights over the busiest junctions in the 08:00 and 17:00 rush. It is selectable, with a tooltip like "News 1: live over the fire at …".

**Live TV in FPV (N4).** The FPV is inside a home, the TV is on, and a story with a helicopter over it is live. Then the TV shows the helicopter's view:
- a second camera renders to about 320×180 at 5–8 fps, only while that room exists;
- the picture has a lower-third headline, a LIVE bug and the station logo.

Otherwise the TV shows a studio card. At 21:00 adverts' ad break plays between items. This costs nothing unless the FPV is in such a room.

**Citizen memories (N5).** Each citizen has two bounded stores:
- **4 short-term entries**, fading over about 3 game days: saw a fire, watched the match, a long jam, saw the news, a friend's news.
- **4 long-term entries**, kept by salience: moved here, first job, graduated, partner, child, lost a home to fire, the day the town became a City.

Each entry is a kind, a subject, a tick and a strength: about 8 bytes, so about 64 bytes a citizen. Memories come from:
- personal events
- witnessing (the daily cached-commute pass)
- watching (the `eveningHome` bit from adverts)
- being told by a friend

They are written at events and in the daily `lifeStep`, never per tick, and saved as optional fields.

**Conversations (N6).** Once a game day in `lifeStep`, each citizen picks a hashed friend and shares their strongest short-term memory, or a long-term one with a close friend. The listener gains a "heard" memory at reduced strength. Once motivation M4 lands, bad news about a place lowers opinion of it. Conversations show:
- in the citizen panel ("Remembers…", "Recently talked with Ada about the fire at …");
- as FPV speech lines from templates by memory kind;
- as occasional bubbles over pairs of friends at close zoom.

| # | Subtask | Depends on | State |
|---|---|---|---|
| N1 | Media centre kinds (3 tiers), techs, coverage, Showcase stops | – | **built** |
| N2 | News story log, coverage of stories, News panel and ticker, overlay, snapshot | N1 | **built** |
| N3 | News helicopters: `newsFlights`, orbit, livery, rush-hour flights | N1, N2 | designed |
| N4 | Live TV in FPV: helicopter render-to-texture, lower third, LIVE bug, studio card, ad break | N3 | designed |
| N5 | Citizen memories: short and long term, personal, witnessed and watched | N2 | designed |
| N6 | Conversations: the daily exchange, heard memories, FPV lines, bubbles, M4 belief hooks | N5 | designed |
