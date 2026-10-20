# Media: TV studios, the news, news helicopters, live TV and citizen memories

**Built: N1+N2, N3+N4 and the TV filler (2026-10-20).** N1+N2 cover the broadcaster ladder, the techs, coverage, the news story log, the News panel and ticker, and the news overlay. N3 is the news helicopter (section 7), N4 live TV in the first-person rooms, and the filler is what TVs show between the news (section 8, UTD e857a19d). N5 and N6 are designed in section 6 and not built yet.

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

**The pad.** The media centre's helipad is found like any other (helipads.ts). `padKindOf` gives it the new PadKind **`'news'`**. Its routine timetable in helicopters.ts is empty: N3 (section 7) flies it to stories in its channel's livery, and the showcase feature `heli-news` checks that it does. `HELI_OPERATORS.news` holds two stand-in liveries for a flight without a channel.

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
| fire spread, explosions (Fires v2) | the same hook: `ignite()` sends `spread` when `opts.from` is set (caught from next door or from a blast); the private `blast()` that every `Fires.explode()` ends in sends `explosion` with its `cause`, the buildings it `lit` and whether it `levelled` the building | `fire` ("Fire spreads to …") and `explosion`, named for its cause ("Gas explosion at …", "… sets 3 buildings alight", "… destroyed by a gas explosion"). An explosion is one story: explode()'s fresh source sends `lit` as `quiet` and gets none of its own, and a burning building that blows up turns its fire story into the explosion. It is live until its fire is out. Drills make no spread or explosion stories |
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

- **N3, news helicopters** and **N4, live TV** are built: sections 7 and 8.
- **N5, memories.** A memory's subject is a story `id`:
  - **Witnessed:** a citizen whose daily path passes within N tiles of `x, y` between `t` and `end` (uncovered stories count too).
  - **Watched:** at home with the set on (shared tv.ts `tvOnAt(homeSeed, hour, retired)`), tuned to `homeChannel(homeSeed, tick, channels)`, whose `programmeAt` (or live news) is what they watched. These are pure, so the server can ask them for a household; the client's `TvGuide.onWatch` hook fires when a set's programme changes.
  - Salience `s` is the memory's starting strength. `who`, `pc` and `b` give the people involved: the residents of the building at the door tile.
  - **The dead** (docs/remembrance.md): a death story (`k: 'death'`) lists the deceased in `dead`, and `Death.memoriesOf(c)` (server sim/death.ts) gives a citizen's dead relatives and friends with how and when they died and the story of an incident, so a memory can name them ("my grandad died in the Brixton fire") and open the headstone.
- **N6, conversations.** Lines come from templates keyed by `k` and fill from `h`'s words. The client keeps the stories, so nothing new goes on the wire.
- **The Piccadilly Lights' news turn** (built). NewsUI's `toScreens` puts the newest covered headline on the big screens' news card with `AdvertsView.setNewsHeadline(text)` (render/adverts.ts, docs/adverts.md "Turns"), only when it changes. That redraws the card's cell of the ad atlas and uploads it again. Measured on this Mac in Chrome, a frame takes 4.6 ms with or without a new headline. A sub-rectangle patch of the cell (`copyTextureToTexture` from a 256×128 canvas, checked pixel-exact by reading the texture back) was tried and dropped, because it is slower: 5.4 ms, or 244 ms under SwiftShader, as reading the cell out of the canvas and regenerating the mipmaps costs more than Chrome's own upload of a GPU canvas. `setNewsFeed(tex)` takes N4's helicopter picture (section 8). `news.latest(n, ch)` gives one channel's stories.

## 5. Measured

- **Tick cost:** −1% (noise; the target was under 2%). On a 2×2 test city (seedCity, built 3, seed 1, 4,988 citizens) filled for 1.1 game days, 3,000 `Game.step`s, five alternating runs of the same script (scratchpad `bench.mts`) on main ee47163 and on this branch:
  - main: 2.003, 2.010, 1.860, 1.870, 1.811 ms (mean 1.911)
  - branch: 1.993, 1.853, 1.885, 1.863, 1.832 ms (mean 1.885)

  The same game on both: the same citizens and the same ticks. News runs only at events.
- **The probe:** `npx tsx packages/server/src/loadtest/media.ts` passes 34 of 34. It checks coverage and overlap between two players, a tier-3 centre winning, the overlay counts, the building panel, a fire story and its end, a rank-up through `Ranks.check`, the ring bound, two runs giving the same stories, a gas explosion and the fires it spreads, and old saves.

## 6. The rest of the design (N5–N6, not built)

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
| N3 | News helicopters: `newsHelisAt`, orbit, livery, rush-hour traffic watches | N1, N2 | **built** |
| N4 | Live TV in FPV: helicopter render-to-texture, lower third, LIVE bug, studio card, the ad break's hook; the TV filler | N3 | **built** |
| N5 | Citizen memories: short and long term, personal, witnessed and watched | N2 | designed |
| N6 | Conversations: the daily exchange, heard memories, FPV lines, bubbles, M4 belief hooks | N5 | designed |

## 7. News helicopters (N3, built)

`shared/src/newsHelis.ts`: `newsHelisAt(pads, stories, tick)`. Like the helicopter timetable (docs/helicopters.md), this is a pure function. Its inputs are the `'news'` pads and the story log every client already holds (client news.ts `news.all()`), so every viewer sees the same flight and nothing new goes on the wire.

- **Whose helicopter.** `newsPadsOf(pads, owner, channel)` gives each media centre's pad its channel. The channel belongs to the owner of the parcel at the pad's anchor (the story's `ch`). Its livery is the owner's colour, with a white stripe (`HeliFlight.op`, which `heliOperator` honours), and its callsign is "News 1". There is one helicopter per pad, and its flight id is minus the pad's id, so a selection follows it from sortie to sortie. Between sorties it is parked on the roof.
- **What it flies to.** A story is worth the flight when it is covered and `s` is at least `NEWS_HELI.minSalience` (10, so the showcase's drills count). Its kind must be a fire, an explosion, a rank, a milestone, an opening or a new line. When one channel has two centres, a story goes to the one nearest it.
  - **Timing.** It lifts off 5–14 game minutes after the story breaks (hashed per story).
  - **Duration.** It covers the story while it is live, and at least `onSceneMin` (1.5 game hours) once it is there.
  - **Priority.** The newest live story wins. If a newer story breaks while it is out, it goes there from wherever it is. If that story ends while an older one is still live, it goes back to the older one.
  - **Traffic watches.** When no story is live, it flies a traffic watch in the 08:00 and 17:00 rush (hashed ±20 minutes, 0.6–1.1 hours) over a point 7–16 tiles out.
- **Live again.** `StoryDTO.lit` (new, optional) is the tick a story went live again after it had ended. The showcase's drill home catches light again the same day and keeps its story (server sim/news.ts), and the helicopter goes back out from `lit`. Old saves have no `lit` and fly from `t`.
- **The plan.** For each pad there is a list of segments: parked, lifting off (spool, lift, turn), flying, over the scene, and landing (hover, settle, run-down). The plan is found by walking through the moments something changes and re-targeting from wherever the helicopter is then. It starts at the previous day's start, so a sortie under way at midnight carries on, and it is cached per pad, day and story set.
  - **Flight path.** A flight joins the orbit on a tangent, going its way round, so it never turns sharply. A long hop climbs to clear the skyline (`CRUISE_Y` at most), and a short hop with a big height change slows so it never climbs faster than 0.08 tiles a tick.
- **The orbit (organic rule).** Each sortie has its own radius (2.6–4.4 tiles), height (5.2–7.6), speed along the orbit (0.12–0.24 tiles a tick) and direction, all from the pad and story ids. The radius and height also wobble slowly. 22% of sorties hover and creep round instead, closer in. It banks into the turn by its speed.
- **Client.** `HelicoptersView.news` (main.ts) gives the owner at a tile, a channel's name and colour, and the stories. `frame` draws the news helicopters with the others. `newsStates` is what live TV's camera rides, and `stateOf(-padId)` is the selected one. Its tooltip and panel (vehicles.ts) say what it is doing, for example "live over the fire: Fire at a house in Riverside", "off on the rush-hour traffic watch" or "flying back to the media centre". The crew is a pilot and a camera operator. I or O rides in it.
- **Showcase.** The media section's tour stop `news-heli` frames the civic district's fire drill, and the feature `heli-news` is enforced (demo:check: a story at the drill on the pad's channel puts the helicopter over the scene within a couple of hours).

## 8. Television: live news (N4) and the programmes between (built)

`shared/src/tv.ts` holds the schedule, and `client/src/render/tv.ts` holds the guide and the live feed. In `client/src/render/interiors.ts`, `SCREEN_FRAG` draws the programmes, and a set's `Screen` asks the guide each frame.

**Channels.** Every set gets Civitas 1 and Civitas 2 (`CIVITAS_CHANNELS`). Each player whose channel has reported a story also has a channel (`playerChannel`: "Ada TV", in their colour). A home is tuned by its seed (`homeChannel`): it has a favourite, and in about three hours in ten it hops to another channel. A pub's set shows the match on a match night, and otherwise mostly Civitas 1.

**The schedule** is `programmeAt(channel, tick, matchNight)`. Each hour has a table of genres for each kind of channel, and `hash(channel, game hour)` picks one, so everyone watching a channel sees the same programme. The day runs like this:
- the news at breakfast, at noon, at 18:00 and late;
- the forecast in the last 12 minutes of each news hour;
- cooking, quizzes and nature by day;
- cartoons at 15:00–17:00;
- quizzes and films in the evening;
- on a stadium's or sports hall's event night (shared leisure.ts `eventOn` over the venues in loaded chunks), the match over the 20:00–22:00 block on the channels that carry it;
- teletext or the test card after 01:00.

Titles come from fictional tables: "Quiz Night", "Brain of the Borough", "Bake Street", "Hedgerow Diaries", "Toon Time", "The Six O'Clock News" and so on.

**Priority on a set:** live news, then the advert break, then the programme. The advert break is `TvGuide.adBreak`, a hook for adverts A6, and returns nothing yet.
- **Live news.** A player's channel goes live while its own helicopter is over a story. Civitas 1 takes the pool feed from any channel's helicopter. Civitas 2 never interrupts.

**Genres in the shader**, by `GENRE_CODE`:
- **The news:** a studio in the channel's colour, a video wall with the town's skyline, a presenter and a desk.
- **The weather:** cloud, rain and a front with its teeth, all moving over the channel layer's map. The map shows the town's real built tiles and roads (a player channel shows only its owner's land), with the three biggest places and their temperatures from the day's `forecast`.
- **A quiz:** three podiums with lit panels, sweeping spotlights and a question board that flashes.
- **The match:** a pitch in perspective with stripes and lines, 22 players in two colours and the ball. The channel layer carries the score bug: the home club is named for the stadium, the visitors from shared CITIES, and goals fall at hashed minutes.
- **Cooking:** a tiled studio, shelves of jars, a chef, and a pan with steam.
- **Nature:** sky, sun, three layers of hills panning, sometimes the sea, and a bird.
- **Cartoons:** three bouncing shapes with eyes.
- **A film:** letterboxed, with grain.
- **Teletext:** the channel layer is the page.
- **The test card:** bars, a grey ramp, a circle and the channel's name.
- **The live feed.**

Organic rule: every set has its own colour cast and brightness, and a little barrel warp (more on older sets). Every channel has its pacing, and every programme its colours.

**The channel's layer** is a 320×240 canvas per channel, not per set. All the sets on Civitas 1 share one texture. It is redrawn only when what it shows changes:
- the news lower third with the LIVE or NEWS bug and the channel's logo;
- a programme's title strap in its first six minutes, and the logo in the corner;
- the weather map;
- the match's score bug;
- the test card's name;
- the whole teletext page.

**Teletext** is Ceefax-style: 40 columns by 24 rows, double-height headings on a colour band, page numbers, the clock and the fastext row. A page turns every 40 ticks (about 8 s at 1x). The pages are built from what the client already holds:

| Page | Content | Source |
|---|---|---|
| 101 NEWS | the channel's headlines | the story log |
| 140 WEATHER | today's and tomorrow's forecast | `forecast(day)` |
| 430 TRAVEL | queues on the roads, by place, with "Slow traffic" and "Standstill" | the congestion bytes of the loaded chunks, clustered |
| 302 SPORT | each venue's last result and next fixture | its event nights |
| 200 PRICES | the bus fare, taxi, takeaway, each venue type's ticket and the mean council tax | the shared constants and the loaded venues |
| 500 YOUR TOWN | the rank's needs, have against target, or without a rank (demos) the town in figures | the `rank` message, read with `net.tap`; the parcels |

**Live TV (N4).** The live feed is `LiveFeed`: one 160×90 render target and one camera under the helicopter's nose, looking at the scene. Its long lens breathes in and out a little, and its far plane is 45 tiles.
- **When it runs.** Only while a set showing live news is in the room camera's view this frame (interiors.ts tests each set against the frustum), or while a big screen stands within 40 tiles of the camera (`AdvertsView.bigScreenNear`) outside the full FPV.
- **Limits.** It renders at 5 fps and carries one feed at a time: the first asker keeps it while it keeps asking. It is off on the low preset, which is the lighting's quality 0 (adaptive, or pinned with `?fx=0`), and with `?tvlive=0`.
- **The render.** It leaves out the overhead helpers and what is under a pixel at that size: people, parked cars and signal heads. It does not refresh the shadow map.
- **Culling.** The camera goes into the buildings' cull and detail tiers (render/buildings.ts `updateLod`), so the scene is there to film even when the player's camera is elsewhere. The buildings still have to be in loaded chunks.
- **The picture.** The set shows the texture with the channel layer's lower third: the headline, the LIVE bug and "from the news helicopter". While the feed runs, the same texture goes to the big screens' news turn (`AdvertsView.setNewsFeed`). During the feed's own render they get the card back, because a target cannot be read while it is written.
- **No feed.** A live story without the feed (low preset, or a set not on screen) shows the studio.

**Rooms.** The lounge's set is on most evenings. This is `tvOnAt`, now in shared, with the same formula as before. The room's line reads "in the lounge, watching Quiz Night on Civitas 1". The pub (`cafeOrBar`, bar) now has a set high on the wall the viewer faces.

**Where it shows.** The citizen panel has a "Watching" row ("Quiz Night on Civitas 1", "teletext on Civitas 2", "the live news on Ada TV") for someone at home in the lounge with the set on, or in the pub (ui.ts `watching`, `TvGuide.watching`).

**Showcase.** The tour stop `live-tv` (view `'tv'`, shown at 20:30) asks the homes of district B2 who is in. It then follows residents at home one by one in the FPV inset until one is in the lounge with the set on (main.ts `watchTv`); the next stop closes it. Features `live-tv` and `tv-programmes` are on it.

**Debug.**
- `msc.fpv.preview('lounge' | 'bar', seed, hour)` shows a room full-window with nobody selected; `msc.fpv.preview(null)` goes back.
- `msc.tvDebug.force` = 1 or 0 forces every set on or off.
- `msc.tv` is the guide: `stats()` reports the layers and their redraws, `feed.renders` and `feed.lastMs` the feed.

## 9. Measured (N3, N4, filler)

- **Server:** nothing new per tick. The only server change is `lit`, set when a drill relights.
- **`npx tsx packages/client/scripts/tv-check.ts`** (all ok):
  - the schedule is deterministic and runs the day as planned;
  - homes spread over the channels;
  - a lounge with its set on, not live, draws 124 calls, the same as with it off (+0, the budget is +2);
  - its CPU is +0.0003 ms a frame;
  - there is one layer per channel shown, and two sets on one channel share it;
  - an hour of teletext redraws its page 3 times in 6,000 frames;
  - there is no feed without a helicopter.
- **Chrome, headless with the Metal GPU, `?fx=2`, the showcase.** Timings are GPU timer queries over batches of 100 renders, medians of 7 rounds.
  - **The lounge, not live:** 0.086 ms with the set off and 0.075–0.104 ms with any genre on (+0.018 ms at most, the budget is 0.2). Every genre draws 83 calls, the same as off.
  - **One live feed render (160×90):** 160–270 draw calls, about 1.6–2 ms GPU and 5–8 ms CPU (submission). The CPU figure was taken on a machine loaded with other jobs. It runs 5 times a second, about 30–40 ms of CPU a second, and only while a set showing it is on screen or a big screen is near the camera. Leaving out the people saves about 30 calls.
- **The probe `loadtest/media.ts`** (43 of 43). Its section 8 is new:
  - Ada's helicopter is over her fire 0.43 h after it broke, 2.9 tiles out and 6.5 up;
  - Ben's stays on its roof;
  - the same stories in any order give the same flight, tick by tick;
  - there are no jumps (at most 0.4 tiles a half tick);
  - it leaves when the story ends;
  - a story live again is flown to again;
  - the schedule is the same for the same channel and hour;
  - `lit` survives a save.
