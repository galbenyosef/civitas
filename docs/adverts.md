# Adverts: hoardings, campaigns and the vandals

Rich, 2026-10-19: "How about if buildings / areas had allocated advertising areas (nothing extreme) that we would see our
marketing campaigns appear on, however, they are at risk of vandalism, graffiti etc. I am conscious of the refresh
performance loop though." Design 2026-10-19. **Nothing is built.** It stands on `docs/motivation.md` (values and
beliefs): an advert is a way to plant a belief.

Code this touches: `shared/src/adverts.ts` (new: slot sizes, themes, claims, templates, `AD` tunables),
`shared/src/buildings/` (the `adslot` op, `schema.ts`, `validate.ts`, `facade.ts`), `server/src/sim/adverts.ts` (new:
rentals, reach, wear events), `server/src/world.ts`, `server/src/snapshot.ts`, `server/src/net.ts` (intents),
`shared/src/protocol.ts`, `client/src/render/adverts.ts` (new, modelled on `render/signs.ts`), and a Campaigns panel.

## 1. The idea

Some buildings have **ad slots**: modest, believable places for a poster. A hoarding on a shop's side wall, a panel in
a bus shelter, a 48-sheet billboard above a corner shop, a banner on a stadium. Nothing extreme: no screens on every
wall, no Times Square.

A player runs a **campaign** (a message with a theme, a claim and a target) and rents slots to show it. Citizens who
pass a slot may take the message in, and it plants a belief (`docs/motivation.md` section 4). Whether it moves anyone
depends on whether the theme speaks to what they care about.

Posters **wear**: they fade, peel, get tagged, get torn. A worn poster works less, and a wrecked one works against the
message. Rival players can fly-post over yours. Keeping a campaign clean costs money, and it costs more in neglected
neighbourhoods.

Citizens belong to no one, and nor does an audience: an advert reaches whoever walks past, on anyone's land. Ads are
how players compete for the same people.

## 2. Slots

### In the catalogue

A new op in the building recipe (`docs/buildings.md`), placed by facade cell like a door:

```ts
['adslot', wall, bay, storey, size]   // size: 'panel' | 'poster' | 'hoarding' | 'billboard' | 'banner'
```

| Size | Where | Tiles (w × h) | Base rent per day |
| --- | --- | --- | --- |
| `panel` | bus shelters, station platforms (`busstop`, rail and metro stops) | 0.25 × 0.35 | 2 |
| `poster` | shop side walls, pub walls, the end of a terrace | 0.35 × 0.5 | 3 |
| `hoarding` | building sites (`Site`), long ground-floor walls | 0.9 × 0.4 | 6 |
| `billboard` | on a frame above a low shop or works, at a junction | 1.0 × 0.5 | 10 |
| `banner` | stadium, arena, college and civic fronts (landmarks excluded) | 0.3 × 1.2 | 8 |

`validate.ts` treats a slot like a signboard for the windows check: it may not cover a window, it must sit on a wall
with a facade, and it must face a road side. Designs get slots by hand where they belong; families can also take
default slots in `zonekit.ts`/`tierkit.ts` so most commercial designs have one without editing each.

**Not every building, not every wall.** About one commercial or leisure building in three, every bus shelter, every
building site's hoarding, and no homes (question 2). A city block has a handful of slots, not dozens.

### Slot identity

A slot is `(building tile key, slot index)`, derived from the design as sign slots are (`signSource`, `shapeExtent`).
Nothing about an empty slot is stored or sent. Only a **rented** slot has state.

## 3. Campaigns

```ts
interface Campaign {
  id: number; owner: string;            // player id
  theme: number;                        // a motivation value: Money, Family, Status, Roots, Time, Adventure
  claim: number;                        // what it says, from a table per theme (below)
  target: { kind: 'parcel' | 'estate' | 'building' | 'study'; id: number | string };
  look: number;                         // template, icon and palette (section 5)
  created: number;                      // game day
}
```

The **claim table** is per theme, with wording filled in from the target's name:

| Theme | Claims |
| --- | --- |
| Money | "Low rents in {parcel}", "Smith & Co pays well", "Keep more of your wage in {parcel}" |
| Family | "Great schools in {parcel}", "Room to grow in {parcel}", "Safe streets, happy kids" |
| Status | "Get your degree at {college}", "A career at {building}", "Live in {estate}" |
| Roots | "Local jobs for local people", "{parcel}: proud since day one" |
| Time | "Five minutes from work in {parcel}", "The 42 bus: every ten minutes" |
| Adventure | "Something new in {estate}", "Study abroad... well, across the river at {college}" |

A player has at most `AD.maxCampaigns` (8) live campaigns. Creating one costs `AD.campaignCost` (artwork and setup), and
each rented slot costs rent per game day. **Rent goes to the owner of the parcel the slot stands on** (question 1), so
high-street frontage earns its owner money even if that owner never advertises.

### Claims can be false

Nothing stops a player claiming "Great schools in Northgate" when Northgate has none. The claim plants a belief; the
truth comes later, through experience and regret (`docs/motivation.md` section 7). Families who move for the schools
find there are none, become cynical, and tell their friends. Honest campaigns compound and false ones backfire.

## 4. Reach: who sees an advert

Testing every walker and driver against every slot every tick is the thing to avoid. Instead, reach is worked out
**once per game day per rented slot**:

1. **The road index.** Each slot faces one road tile. `AdIndex` maps road tile → rented slots on it, updated on rent
   and expiry.
2. **Who passes.** Commuters' paths are already cached (`Citizen.commute` for walkers; drivers have routes in their
   `legs`). Once a day, at the citizen's `lifeStep` (which already runs once a day per citizen), walk their cached commute
   path against `AdIndex` and collect the slots they pass, at most `AD.seenPerDay` (4), nearest to home first. That's one
   pass over a path of a few dozen tiles, and only for citizens with a commute; the common case is "no slots on my
   path" and costs one map lookup per tile.
3. **Bus riders** see panels at the stops they use: the boarding and alighting stops of their transit legs.
4. **The nudge.** For each slot seen:

   ```
   effect = susceptibility × values[theme] × condition(wear) × freshness × AD.strength[size]
   ```

   It moves the citizen's belief about the target on the theme's value toward the claim's sign.
   - `condition` is section 6's wear curve: 1 when fresh, falling to 0, then **negative** past the backfire point.
   - `freshness` is saturation: `1 / (1 + seen)`, where `seen` counts days this citizen has seen this campaign (kept in
     a tiny per-citizen ring of the last 3 campaign ids and counts). Ten posters on one road are not ten times one.
   - Contrarians invert it (`docs/motivation.md` section 8).
   - After `AD.driftAfter` (6) days of exposure to one theme, the citizen's `vdrift` moves one step toward that theme.
     That is how a long campaign shifts values a little, not just beliefs.

So a Family message on a route full of parents does a lot, and the same poster on a route full of Grafters does
almost nothing. Choosing where, for whom and what to say is the game.

### What players learn

The Campaigns panel shows per campaign: slots, condition, **reached** (distinct citizens per day), **swayed** (beliefs
moved past a threshold), and **acted** (decisions where that belief tipped the score: moves, job changes, enrolments).
"Acted" comes from the `lastCall` record in `docs/motivation.md` section 7, which already names the belief that drove
a call. These are counters, so they cost nothing per tick.

## 5. Rendering

### One instanced mesh, like the name boards

`client/src/render/adverts.ts` copies the design of `render/signs.ts`:

- **One `InstancedMesh`** of quads for every visible rented slot, one draw call in total. Empty slots draw as a plain
  frame in the building model itself (part of the design), so the street looks right with no adverts at all.
- **The near tier only.** Instances exist only for chunks within `NEAR_IN` (`render/buildings.ts`), with the same
  per-slot fade as signs (`SIGN_FADE_START`, hashed jitter). Further out, the far model's frame shows the campaign's
  main colour as a flat tint (one per-instance colour, no texture), and past `FAR_AT` nothing.
- **The ad atlas.** One 2048² canvas texture. Each live campaign gets one cell, drawn once when the campaign is
  created or first seen: a template layout, the owner's colour, an icon from a fixed set and the claim's text. With
  at most 8 campaigns per player, a server with a dozen players needs about 100 cells; the atlas holds 128 at 256×128
  and reuses the cells of ended campaigns. **No canvas work after that.**
- **Wear and graffiti in the shader, not in the texture.** The same atlas has a fixed strip drawn at start-up: 16
  graffiti tags (four crews' styles, section 6), a peel and tear noise mask, and a "fly-posted" overlay. Each instance
  carries `aWear` (0-1), `aSeed` and `aFlags` (fly-posted, cleaned recently). The fragment shader:
  - fades and yellows the poster as `aWear` rises;
  - cuts tears where the noise mask is below `smoothstep` of `aWear`;
  - overlays tag `aSeed % 4 + crew × 4` once `aWear` passes a seeded point, and a second tag later;
  - lights up at night like the shop boards (`glow`), for billboards and panels only.

  So a poster visibly ages over days with no texture redraws at all.

### When the instance buffer changes

- **On a rental event** (rent, end, fly-post, clean, tear down), for that one slot: one instance's attributes.
- **On the LOD pass** (`LOD_STEP`, already run when the camera moves), when chunks enter or leave the near tier.
- **`aWear` is computed on the client**, from the rental's `placed` day, the slot's area rate and its seed (section 6).
  It's refreshed for visible instances once per game hour: a few hundred floats into one `InstancedBufferAttribute`
  with `DynamicDrawUsage`, a tiny upload. Never per frame.

Nothing about adverts runs per frame except the shader.

## 6. Wear and vandalism

### Wear is a formula

A rental stores `{ campaign, placed, seed, cleaned }`. Its wear at any moment is

```
wear = 1 - exp(-(now - max(placed, cleaned)) × rate(area) × (0.7 + 0.6 × hash(seed)))
```

The server and the client compute the same number from the same inputs, so wear never goes over the wire. The
`condition` used in reach (section 4) is `1 - wear / AD.backfireAt` clamped to `[-AD.backfire, 1]`: a poster loses
effect as it wears, and past `backfireAt` (0.8) it starts to put people off. A filthy "Move to Northgate" poster
makes people think less of Northgate.

### The area rate

`rate(area)` is per parcel, recomputed once per game day with the parcel's stats (`ParcelStats`), from things the sim
already knows:

- the share of adults out of work there;
- the share of 14-17s with no school place (the education census, `docs/education.md` section 15);
- services and leisure coverage (the same `coverage` and `leisureCoverage` used for tax tolerance), which lower it;
- the size of the slot (big billboards are harder to reach, so they wear slower; bus shelter panels faster).

A well-served neighbourhood keeps posters clean for weeks; a neglected one tags them within days. Adverts are cheap in
good areas and a money pit in bad ones, which is one more reason to look after a district.

### Crews

Each neighbourhood with a high rate has a **crew**: a hashed tag style (one of four looks in the atlas strip) chosen
from the parcel or estate id. You learn to recognise whose patch you're in. Crews aren't simulated as people (question
5); they're a look and a rate.

### Events (the only things sent)

| Event | Cause | Effect |
| --- | --- | --- |
| **Rented** | player intent | the rental record; the slot shows the campaign |
| **Ended** | rent stopped or unpaid | the slot goes empty |
| **Cleaned** | a crew visit (below) | `cleaned = now`: wear restarts |
| **Torn down** | `wear` passes `AD.tearAt` (0.95) and a daily roll | the slot is empty again; the renter is notified |
| **Fly-posted** | a rival's intent (section 7) | the rival's campaign over yours, flagged, its own `placed` |
| **Mural** | rare: a slot in a high-rate area at full wear, a daily roll of `AD.muralChance` | section 8 |

Each event is one small message on the chunk subscription (as building changes are), and they're rare: a few per
player per game day.

### Keeping clean

- **Cleaning contract** (a Campaigns panel toggle per campaign): `AD.contractCost` per slot per day halves the rate.
- **A one-off clean**: send a poster crew. A van (`FleetKind` 10, `PosterCrew`, using the fleet machinery like the
  sweepers) drives to each slot on real roads and works for a few minutes. When it gets there, the slot's `cleaned` is
  set. You can watch your crew go round, and so can your rivals.

## 7. Rivals

- **Fly-posting.** A player may post one of their campaigns over a slot rented by someone else, for
  `AD.flyPostCost`. The rival's campaign shows (with a rough, pasted-on look: `aFlags`) and gets the reach, for free,
  until the slot's renter reacts. A fly-post wears at twice the rate.
- **Taking it down.** The renter, or the owner of the parcel the slot stands on, can pay `AD.removeCost` to restore
  the slot (a crew visit, as above).
- **Limits so it never becomes griefing:** at most `AD.flyPostsPerDay` (3) per player; never over a campaign less than
  a game day old; never on a slot whose parcel owner has turned on "No fly-posting" (a parcel setting with a small
  daily cost, a steward's choice).
- **Spectate mode.** The new intents (`adCampaign`, `adRent`, `adEnd`, `adClean`, `adFlyPost`, `adRemove`) are not in
  `net.ts` `READ_ONLY`, so a showcase refuses them like any other change.

## 8. Murals

Now and then a heavily tagged wall in a neglected area becomes a **mural**: a local artist paints over the whole slot.
A mural is no one's campaign and can't be rented while it lasts (about 4 game weeks). It gives a small happiness part
to people living within 6 tiles ("a mural on the corner"), and a Roots belief bump about that parcel to people who pass
it. Neglect, now and then, gives something back. Murals are drawn from a small fixed set in the atlas strip (question
4).

## 9. Balance and performance

- **Tick cost.** Nothing per tick. Reach runs inside `lifeStep` over a cached path. Area rates run with the daily
  parcel stats. Events are rare. Target: under 2% more sim ms per tick on the 6×6 district test, measured with
  `loadtest/ab.ts --set ads=0` and a new `loadtest/adverts.ts` probe (rents campaigns from a scripted player, prints
  reach, swayed, acted, wear and events per day).
- **Client cost.** One instanced mesh and one draw call; one 2048² texture; a few hundred floats uploaded per game hour
  while the camera rests; attribute writes per event; nothing per frame but the shader. Measure with the existing
  render stats on the London demo at street level.
- **Wire.** Rentals ride with the chunk snapshot (only rented slots: a handful per chunk) and as events after that.
  Campaigns (the look and text, a few dozen bytes each) are sent once in the welcome and on create.
- **Text is from tables, not typed.** Claims are templates filled with real names, so there's nothing to moderate on a
  shared server and nothing unbounded to draw into the atlas.
- **Old worlds**: no rentals; empty slots come from the designs. New snapshot fields are optional. No format bump.

## 10. Phased plan

| # | Subtask | Files | Depends on | Size |
| --- | --- | --- | --- | --- |
| A1 | **Slots.** The `adslot` op, sizes, validation and the windows check, default slots in the kits, empty frames in the models, the viewer showing slots | buildings/schema.ts, validate.ts, facade.ts, zonekit.ts, tierkit.ts, compiled.ts (regenerate) | none | M |
| A2 | **Campaigns and rent.** `shared/src/adverts.ts`; `Campaign`, rentals on the world, intents, rent to the parcel owner in the ledger, the Campaigns panel, snapshot | adverts.ts (both), world.ts, net.ts, protocol.ts, snapshot.ts, ui.ts | A1 | M |
| A3 | **Rendering.** `render/adverts.ts`: instanced quads, the ad atlas, near-tier fade, far tint, the wear shader with tags and tears | client render/adverts.ts, render/buildings.ts (LOD hook), materials.ts | A1, A2 | M |
| A4 | **Reach.** `AdIndex`, the daily pass in `lifeStep`, bus stop panels, the nudge into beliefs, saturation, drift, the reached / swayed / acted counters | sim/adverts.ts, sim/motivation.ts, simulation.ts | A2, motivation M4 | M |
| A5 | **Wear and rivals.** Area rates, events, tearing down, contracts, the poster crew van (`FleetKind` 10), fly-posting and removal, murals | sim/adverts.ts, fleet.ts, sim/mobile.ts, render | A3, A4 | L |

A1 and the motivation work (M1-M4) can go in parallel. A3 can start as soon as A2's wire shape is fixed.

**Showcase** (`docs/demo.md`): A1 adds no kinds, but every slot size should stand in the Showcase on a placed design,
and the tour gets one stop: a high street with three rented slots at three wear levels and a fly-post. Add
`SHOWCASE_FEATURES` entries `advert-reach` (a seeded campaign reaches a showcase commuter within `FEATURE_DAYS`) and
`advert-wear` (a run report line: events by kind after `--run 2`).

## 11. Questions for Rich

1. **Who gets the rent for a slot?**
   - **A. The owner of the parcel it stands on** (recommended): frontage becomes valuable, and stewards who don't
     advertise still earn from those who do.
   - B. The city (no one), as a cost only.
2. **Can homes carry ads?**
   - **A. No: commercial, leisure, civic fronts, bus shelters and building sites only** (recommended). Keeps it
     modest.
   - B. Yes, gable ends of terraces as `poster` slots.
3. **Free text on posters?**
   - **A. No: claims from tables, filled with real names** (recommended). Nothing to moderate.
   - B. A short line of filtered free text per campaign.
4. **Murals?**
   - **A. Yes, rare, from a fixed set** (recommended).
   - B. Not now.
5. **Should vandals be people?**
   - **A. No: a rate and a look per area** (recommended). Cheap, and neglect still shows.
   - B. Yes: teenagers out of school sometimes go out tagging, as walkers you can follow. Lovely, but a new behaviour
     to simulate and a sensitive one to get right.
