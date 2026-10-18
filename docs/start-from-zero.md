# Start from zero: options

Card a6b169bd ("lets consider a 'start from zero' gameplay mechanic"). Rich: "literally, just a road in that can bring in
visitors and residents (if they so choose), and just enough money to build up a city from next to nothing. How could
this work? Options please." This document is options and a plan. It changes no game code.

## 1. Today

### How a new player starts

- **Cash.** `START_MONEY = 20000` (`shared/src/constants.ts`), given by `World.getOrCreatePlayer` from `net.ts` on the
  first `hello`. Land is a flat $10 a tile (`LAND_PRICE_PER_TILE`). Roads cost $10 on your own land and $20 on unclaimed
  land (that needs Public works, tr3). Zoning is $25 a lot. There is no land market: a tile costs the same everywhere.
- **The Commons.** Every fresh world, the server's (`index.ts`) and local mode's (`client/src/local/host.ts` `fresh`), runs
  `seedCommons` (`server/src/seed.ts`). It lays out a 22×22 district at the origin, owned by `sys`. The district has a 5-tile
  road grid, mixed zoning, residential lots **already built to level 1**, and a police station, fire station, hospital,
  builders' yard and four car parks, all complete. The Commons has every technology (`createGame` tops it up). It starts
  with about 66 residents and has 330 to 430 by day 3 to 9 (docs/early-game-audit.md).
- **Strict tech tree** (`shared/src/tech.ts`). A new player starts with roads, residential zoning, builders' yards, the
  handyman, parks and the motorway connection. The rest is behind counters (housed, jobs, built, roads) and prices. The
  cheapest nodes are zon1 at $200 and 12 housed, and tr1 at $150 and 20 roads. Tiers 1 to 3 cost about $10,350.
- **Onboarding** (`shared/src/goals.ts`, `server/src/goals.ts`, `client/src/onboarding.ts`). Thirteen goals run from
  "Claim your plot … beside the Commons' edge road" to "First bus line", paying about $3,000 in all. The goals and the
  hints assume the Commons: the "show me" for the plot goal focuses on `'commons'`.
- **Land** (`shared/src/landrules.ts` `checkPurchase`). Your first parcel can go anywhere. Later parcels must share an
  edge with land you own. A purchase may not wall in another owner or a pocket of unclaimed land bigger than 4 tiles.
  Sandboxes skip the check (`net.ts:362`).

### How citizens arrive

- **Demand is global and supply-led.** `Simulation.growth()` uses `rDemand = jobs - population + 6` and `cDemand` over
  the **whole world**, the Commons included. `spawn()` gives every level ≥ 1 home that has room a 25% chance of a
  newcomer each pass, mostly only while `vacantJobs > 0` anywhere. Nobody "chooses" a town. The only choice is
  leaving: being idle for 3 days (`MAX_IDLE_DAYS`), being unable to pay property tax, a tax rate above the person's
  tolerance (`payHomeTax`), or living alone and unhappy (`LIFE.leave*`, `sim/life.ts`).
- **Gateways** (`shared/src/gateways.ts`, `server/src/sim/gateways.ts`). Gateways are only where a newcomer appears. The
  motorway connection is kind 21: 2×3, $400, $6 a day upkeep, `arrivalsPerHour: 30`, and needs no technology
  (`shared/src/buildings/motorway.ts`). Rail halts and stations, the coach depot and the airport are gateways too. A home
  with room queues its newcomer at the nearest gate, weighted by capacity (`Gateways.request`). The gate releases them
  through a token bucket, and they travel home by car, taxi or on foot. With no gate anywhere, newcomers spawn in place.
  Gates are spatially local: a town's own motorway connection serves its own homes.
- **Visitors** (`Simulation.dispatch`). Visitors are vehicles, not people. There are `VISITORS_PER_100_PEAK_HOUR = 12`,
  scaled by **population**, so a town of zero gets none. They enter at the motorway connections (or the farthest road
  tiles), drive to a shop or office, and pay `VISITOR_SPEND ($5) × taxRate` (50 cents at 10%) to its owner. A visitor
  never becomes a resident.

### Where the money comes from

- **Income:** property tax `HOME_TAX_BASE ($40) × rate`, about $4 a resident a day at 10%. Income tax goes to the
  **workplace's** owner. There is sales tax on venue spending, plus fees for parking, freight, fares and landings.
- **Spending:** road upkeep ($0.5 a tile a day) and civic upkeep. Public-service staff are paid half by the treasury
  (`ECONOMY_TUNING.civicPayroll = 0.5`) and half by a "regional grant". Leisure venues pay their staff from takings.
- **Failure:** none. Money can go below zero through upkeep (`World.credit` has no floor), and building is refused with
  "Not enough money" (`net.ts:512`). There are no loans, no bankruptcy and no recovery path.

### What a "world" is

The **live world** is one per server process: shared, unbounded and seeded from `SEED`. **Test cities and demos** are
child processes on their own ports (`server/src/testcities.ts`), with `GameConfig.sandbox` set: all tech, an endless
treasury and no goals. **Local mode** (docs/local-mode.md) runs `createGame` in a Web Worker with IndexedDB saves. Its
"Start new game" form offers a seed and a sandbox tick-box, and always seeds the Commons. Snapshot fields for scenario
data are optional and need no format bump (`World.seaGates`, `stopNames`; docs/boats.md 2.3).

### Why today is not "from zero"

1. **The Commons is the engine.** Its prebuilt homes staff the only working yard. Its jobs make `vacantJobs > 0`, which
   lets your homes spawn people. Its population drives visitors. Its grid jams first (audit friction 3). A new player
   rents growth from it.
2. **$20,000 is plenty.** The audit's opening (a 16×9 plot, 52 roads, 96 lots) costs $4.4k, and the money never runs
   out with the current tuning. The low point after the Gauntlet 3 tune is about $5,700.
3. **A remote start is a dead end, even with its own road in.** Builders are citizens employed at a yard. Homes get
   newcomers only from level 1 (`spawn` skips `level === 0`). So a plot with no road link to someone else's population
   never gets a resident to staff its handyman, and its zoned lots never get built. A player can already buy a remote
   plot and place a motorway connection (no tech), and the town still never starts. The audit's "Lost" probe saw the
   start of this: "sites … stayed at `builders: 0`". **Every option below has to solve this bootstrap.**
4. **Nobody chooses.** Immigration fills beds wherever beds and jobs exist. Visitors never stay. Nothing measures
   whether a town is attractive.

## 2. Two building blocks that every option needs

These are listed once here. The options below say which variant they use.

**B1. A bootstrap: the first people who can build.** Three ways, from smallest to largest:
- *Pioneer camp.* A new 2×2 residential sub-kind ("camp": tents and caravans) that opens at once with no construction,
  as the first yard does today (`net.ts:468`). It holds about 8 people and arrives through the gate like any other
  newcomer. Its people take the handyman's 2 jobs and the first shop jobs, and later move into proper homes through the
  existing "move out" path. It is cheap because `spawn()` already serves any residential building at level ≥ 1. It
  later becomes a **campsite** for visitors (see B2). About 3 to 4 agent-hours.
- *Out-of-town contractors.* The starter yard's crew lives "outside" and drives in through the gate for each shift. This
  needs a citizen whose home is a gate: a new `Citizen.outOfTown` flag that every home-based path (property tax, the life
  step, carpooling, `findJob` from home) must honour. It is more general, because it also gives regional commuting both
  ways. It is also riskier. About 10 to 14 agent-hours.
- *Founding households.* The world starts with N households already in a camp. This is the cheapest option, but it
  works only for a private world.

**B2. Appeal: people choose to come.** Do not replace the bed-filler: put a choice in front of it.
- *Town appeal* (new `sim/appeal.ts`) is a 0 to 100 score per town, where a town is a road-connected component or, more
  simply, an owner's estate. It is recomputed every game hour from things that exist already:
  - free beds;
  - vacant jobs that the gate can reach;
  - service `coverage()` and `leisureCoverage()` over the homes;
  - the residents' mean `happy` (life.ts already gives commute, money, services, leisure, traffic and company);
  - the tax rate against tolerance;
  - the world's queued share near the town.
  Land and rent prices join later, when the roadmap's land market exists.
- *Prospects, not newcomers.* A gate generates **prospects** at `base × appeal`. A prospect looks at the best free home
  and the job in reach, and moves in if that beats a hash-seeded personal bar. Otherwise they leave, and the gate panel
  says why: "3 looked and left today: no work in reach".
- *Visitors who stay.* Give a frontier road a base flow of passing visitors that does **not** scale with population: a
  trunk road volume of, say, 4 cars an hour at the peak. Some of them stop if there is a reason to: a café, the campsite,
  a park with a view, later a landmark. A good visit (it parked, it spent money, it was not stuck) adds to
  **reputation**, a decaying daily sum that raises the prospect rate. A share of satisfied visitors become prospects
  themselves ("liked it, staying"). This is the word-of-mouth loop. It also needs visitors to be allowed to go to leisure
  places, which they do not do today (`startTrip` picks only Commercial or Office), and `VISITOR_SPEND` raised for
  passing trade (about $15 to $20).
- B2 is about 12 to 16 agent-hours for the core and 4 to 6 more for the panel and the gate UI.

**B3. A money loop with a floor.** A smaller starting purse, a credit line, and a defined failure.
- *Founder's loan.* An overdraft up to a limit, at daily interest, shown in the ledger as `interest`.
- *Administration.* After 3 game days over the limit:
  - building stops and the gate closes to prospects;
  - the regional grant (the other half of civic payroll) is withdrawn;
  - a "recovery plan" offers to raise the tax rate, sell back unused land at 80%, or mothball services.
  - In local mode the last option is "start again from the last autosave".
- About 5 to 7 agent-hours (`World.credit`, `net.ts` refusals, the ledger UI, one hint).

## 3. Options

### A. Frontier: a private empty map with one road in

**What the player sees.**
- *First 10 minutes:* a valley with no Commons. A country road runs in from beyond the map edge and ends at a turning
  circle with a blue "To the motorway" board: the gate, a single-carriageway "country road connection" with
  `arrivalsPerHour` of about 6. You have $5,000 and a 32×32 land charter round the road end, free.
  - Goal 1: place a pioneer camp ($150) and a handyman ($120).
  - The first two or three cars arrive with roof boxes within a game hour and pitch tents.
  - Lay a street ($10 a tile) and zone 8 homes ($200).
  - The handyman's two pioneers build a level-1 house (60 work) in a little over an hour each. That makes about 12 houses
    a game day: one game day is 8 real minutes.
  - A few passing visitors pull in at the turning circle and leave.
- *First hour (7 to 8 game days):*
  - About 60 to 150 residents.
  - A first shop row (commercial is free on the frontier: see option C).
  - A farm-shop café that visitors stop at.
  - The camp half empty and turning into a campsite.
  - The gate upgraded to a full motorway connection when the hamlet becomes a village.
  - The first decision that hurts: a police post now, or more homes.

**Economic loop.**
- Starting cash: $5,000, plus the free land charter, plus a $2,000 founder's loan line.
- First income: property tax from the camp and the first houses (about $4 a head a day), and visitor spending at the
  café.
- Growth pays for itself through homes, which pay back their $25 lot and street share in about 2 to 3 days.
- Failure: overdraft, then administration (B3). With no Commons there is no global demand to lean on, so it is a real
  failure. In local mode, recovery is a reload.

**Who comes, and why.** Full B2. Through-traffic on the country road is the only source of visitors at day 0. The first
prospects come from the gate's base rate and the camp's free pitches. From then on, appeal and reputation drive the rate.

**The road in.**
- A new kind, *country road connection* (1×2, a one-lane spur, about 6 arrivals an hour), or kind 21 with a lower
  `arrivalsPerHour` per level.
- It is placed by the seeder at the edge of the valley. The edge is soft: the terrain is still unbounded, but land
  outside the charter opens with milestones (option C).
- Freight imports and exports use it like a motorway (`motorwayEntries`). Upgrading it to the dual carriageway is a
  milestone reward.

**Multiplayer.** By default it is single-player: local mode, or a private child world on a server. A server-hosted
frontier could take friends: the second player gets a second road in on another side of the valley. Neighbours then
trade through the one shared demand pool, as on the live world.

**Exists vs new.**
- *Exists:* local mode, `createGame`, the snapshot, the handyman, gateways, goals, the ledger and the child-world
  launcher.
- *New:*
  - `seedFrontier` (no Commons; the road, gate and charter), about 4 h;
  - a frontier flag carried in `GameConfig` and the snapshot, about 2 h;
  - the "Start new game" choice in local mode and on the join form, about 3 h;
  - B1 camp, about 4 h;
  - B2, about 16 to 22 h;
  - B3, about 6 h;
  - frontier goals (C), about 6 h;
  - a bot audit and tuning, about 6 h.
- About **45 to 55 agent-hours** in all.

**Risks.**
- A town of 50 has too little going on. The idle stretch the audit found (friction 9) gets worse with less money and no
  Commons to watch.
- Global demand needs `jobs - population + 6`: in a world of zero, homes stall unless the camp's jobs and the shop row
  keep the balance. The +6 slack needs a look.
- It splits the player base away from the shared world.

### B. Founder's charter: a remote plot on the shared world

**What the player sees.**
- *First 10 minutes:* on the world map (Tab), the player picks a site at least about 150 tiles from anyone. They get a
  32×32 charter there and a road stub joining it to a regional trunk road. Then it plays like A, but the Commons'
  skyline is on the horizon and the trunk road carries other towns' traffic past the turning.
- *First hour:* as A. In addition:
  - Through-traffic between other towns is real passing trade.
  - Your gate also serves other players' towns that are nearer to it than to theirs.
  - The first neighbour may settle down the same road.

**Economic loop.** As A, but failure has to be gentler on a shared world. Administration freezes the charter and does
not delete it. Land outside the charter keeps today's $10 a tile and today's adjacency rule.

**Who comes, and why.**
- B2, but per town. There is a catch: `growth()`'s demand and `spawn()`'s `vacantJobs` are world totals today.
- A charter town needs **local** demand: jobs and homes counted per road component, or per gate catchment. That is a
  change to the core loop, with the Commons in the same pool.

**The road in.**
- Today the world has no roads between towns: the motorway connection's carriageway "runs off towards a ring road or
  another city, which is hand-waved" (motorway.ts).
- Option B needs a *regional trunk network*: a pure function of the seed, like terrain (for example a trunk every 256
  tiles that follows valleys), which nobody owns and nobody can bulldoze.
- Alternatively, each charter gets its own hand-waved gate, with no physical link, and the trunk is only drawn on the
  map. That is much cheaper, but the towns are then islands.

**Multiplayer.**
- This is the option where "neighbours" means something. Two charters on one trunk road share visitors and commuters.
  Later, roads join them (Public works).
- But every remote town adds chunks the simulation keeps hot. Region sharding (README roadmap) becomes pressing.
- The griefing roadmap item (anyone can bulldoze public roads) has to be closed before trunk roads exist.

**Exists vs new.**
- *Exists:* everything in A's list, plus world-map site picking (`client/src/mapmode.ts`).
- *New:*
  - A's pieces, about 40 h;
  - local demand per town, about 10 to 14 h (opus, the riskiest change in this document);
  - the trunk network and its rendering, about 16 to 24 h (or about 3 h for the hand-waved version);
  - charter rules in `checkPurchase`, about 3 h;
  - a remote-start onboarding path, about 4 h.
- About **75 to 90 agent-hours**.

**Risks.**
- Local demand changes the Commons' balance and every tuned number in the audit.
- Load: N remote towns cost about N small cities of tick time.
- With few players, the shared world becomes a scatter of ghost hamlets.

### C. Village growth: hamlet → village → town → city

This is not a start by itself. It is a progression layer that replaces the strict tech tree's opening on a from-zero
start (it suits A, and B later).

**What the player sees.** Instead of 13 tutorial goals and 25 tech nodes, the top bar shows a **settlement rank** with
the next charter's needs:

| Rank | Needs | Unlocks |
| --- | --- | --- |
| Camp | start | handyman, homes, the camp, a park |
| Hamlet | 25 residents, 1 shop | commercial; charter ring 1 (48×48); a café visitors stop at |
| Village | 100 residents, police post, a park | industrial, Masonry, parking lots; the gate becomes a motorway connection (30 an hour) |
| Town | 400 residents, 150 local jobs, 3 days in the black | offices, Steel frame, signals, bus lines; the coach station as a second gate; ring 2 |
| City | 1,200 residents, appeal over 60 | the rest of the tree on today's prices; rail; ring 3, or open land rules |

Each rank also pays a **charter grant**, sized to the cash cliff: about $1,000, $2,500 and $5,000. The 10-minute view is a
clear "do this to become a hamlet" card. The first-hour view is two rank-ups and a bigger map.

**Economic loop.** Same as A. The grants are the stepping stones, and ranks are lost after 7 game days below their
population, which is a gentle failure.

**Who comes, and why.** Rank is a reputation multiplier ("a village with a doctor"). The gate's capacity grows by rank:
country road → motorway, then the coach station and rail.

**Exists vs new.**
- *Exists:* `GOALS` and the measuring in `server/goals.ts`, `Progress` counters, tech `condition`s, `rewardText`, the
  card UI.
- *New:*
  - `RANKS` data and rank-gated tool unlocks: either a second unlock source beside `techFor`, or ranks that grant tech ids
    for free (simplest), about 6 h;
  - charter rings in `checkPurchase`, about 3 h;
  - a top-bar rank chip and the rank-up moment, about 4 h.
- About **13 to 16 agent-hours** on top of A.

**Risks.**
- Two progression systems (ranks and tech) on one screen. Recommendation: ranks *are* the tech gates on a frontier
  start, and the T panel shows them as the tree's first tiers.

### D. Economy-first: start as a developer

**What the player sees.** The player owns land, not a town. There are no zones to paint: you **build** houses and shops
yourself, $400 to $900 each, with the handyman. Each one lets to tenants who arrive through the road and pay **rent**
(weekly, by level and appeal). Services do not exist until a "parish" fund (a share of rents) can pay for them. The
first hour plays like a small business sim: 6 houses, a shop and a pub, and rents covering the loan.

**Economic loop.** A starting loan of about $5,000. Rent is income. Vacancy is the failure, and there is a sell-off path.
Growth pays for itself through yield.

**Who comes, and why.** Tenants weigh rent against wages in reach. That is B2's prospect model, with price as one more
input.

**Exists vs new.** It reuses construction sites (a player-placed residential site at level 1), `planStructure` and the
ledger. It needs:
- player-built zoned buildings, against today's "zones grow by themselves";
- a rent model in place of property tax;
- vacancy and tenant choice.

Rent touches the core money loop of the shared game. About **35 to 45 agent-hours** on top of A's bootstrap and B2.

**Risks.**
- It is a different game. It contradicts the README's core idea that zones grow and citizens are not yours.
- On a shared world it competes oddly with players who zone.
- It is better kept as a later idea for a scenario than as the main start.

### E. Scenarios: from-zero maps with goals

**What the player sees.** "New game → Scenario". Each scenario is a hand-made from-zero map with a story and three
medals:
- *Railhead* (a halt on a branch line and no road);
- *Fishing village* (a harbour gate and boats; Boats B5 and B6);
- *Crossroads* (two country roads meet, and two rival AI or human founders);
- *London 1666* (the Thames, an empty map, and London's landmarks as goals).

A scenario sets the start cash, the gate(s), the ranks and the goals.

**Economic loop.** Per scenario. Failure is "scenario lost, try again".

**Who comes, and why.** B2, with the scenario's gate kinds (rail or sea) as the road in.

**Exists vs new.**
- *Exists:* the demo pipeline. That is scenario data in `shared/src/demo/*.ts`, the seeder through the players' planners
  (`server/src/demo/seed.ts`), child worlds, the join-form picker, the tour panel (which suits story beats), sea gates
  declared per scenario, and `GOALS`.
- *New:*
  - a scenario schema (start, gates, goals, medals), about 4 h;
  - goals per scenario (today `GOALS` is one global chain), about 4 h;
  - each map, about 4 to 8 h.
- It sits on top of A (frontier seeding, B1, B2, B3). About **15 to 20 agent-hours** after A, plus maps.

**Risks.** Content cost. The scenarios only become good after A's loop is fun.

## 4. Recommendation

**Build A with C's ranks, in local mode first. Design B2 per town from day one, so that B (the shared world) and E
(scenarios) are later layers rather than rewrites.** The reasons:
- A frontier is the purest form of Rich's sentence.
- It avoids the Commons' global demand and jam.
- Local mode already has a "Start new game" form, a sandbox flag carried with the save, and a speed control (handy for
  the idle stretch).
- The bootstrap and appeal pieces it needs are exactly the ones the shared world will need.
- D is a different game. Keep it parked.

### Phased plan

| # | Subtask | Model | Depends on | Files (clash risk) |
| --- | --- | --- | --- | --- |
| 1 | **Frontier world.**<br>• `seedFrontier`: no Commons, a country road from the edge, the gate, a land charter.<br>• `World.start: 'commons' \| 'frontier'` as an optional snapshot field; `GameConfig.frontier`.<br>• A `FRONTIER=1` server branch and local mode's "Start new game → Start from zero".<br>• A country road connection kind (motorway kind 21 at level 1 with about 6 an hour, or a new 1×2 kind).<br>• Start cash per start. | opus | none | `server/src/seed.ts`, `server/src/index.ts`, `snapshot.ts`, `game.ts`, `client/src/local/{host,ui}.ts`, `shared/src/buildings/motorway.ts` (**gateways and freight-gate agents**) |
| 2 | **Bootstrap.**<br>• The pioneer camp kind (residential sub-kind, opens at once, about 8 beds).<br>• The handyman free on a frontier.<br>• Check that `spawn`, `findJob` and the move-out path take people from the camp into houses.<br>• Fix the +6 demand slack in a world of zero. | opus | 1 | `shared/src/buildings/residential.ts` (new kind), `net.ts` build, `sim/simulation.ts` spawn/growth (**hot file: boats B5, people, jobs agents**) |
| 3 | **Appeal and prospects (B2 core).**<br>• `sim/appeal.ts`, per town (road component; owner estate as the first cut).<br>• Prospects at gates with move-in or leave-with-a-reason.<br>• Visitors to leisure places and the campsite.<br>• A base passing-trade flow on frontier roads, the reputation sum, visitors who stay.<br>• A loadtest probe (`loadtest/appeal.ts`). | opus | 2 | new `sim/appeal.ts`, `sim/gateways.ts` request/tick, `sim/simulation.ts` dispatch/startTrip/newcomer (**gateways agent; same hot file**) |
| 4 | **Money floor (B3).**<br>• Founder's loan line, interest in the ledger, administration and the recovery plan.<br>• A deficit-to-administration hint. | sonnet | 1 | `world.ts` credit/ledger, `net.ts` refusals, `client/src/ui.ts` ledger, `shared/src/protocol.ts` |
| 5 | **Ranks (C).**<br>• `RANKS` in `shared/src/goals.ts`, measured in `server/goals.ts`.<br>• Ranks grant tech ids on a frontier start; charter rings in `checkPurchase`; charter grants.<br>• A frontier goal chain replacing the Commons-based one; the rank chip. | sonnet | 1, 2 | `shared/src/{goals,tech,landrules}.ts`, `server/goals.ts`, `client/src/onboarding.ts` (**onboarding agent**) |
| 6 | **Client.**<br>• Gate panel: prospects today (in, looked and left, why).<br>• Town appeal panel with its parts, like the happiness panel.<br>• The arrival moment: the first car with a roof box and a "your first settlers" camera shot.<br>• Join-form entry for a server-hosted frontier. | sonnet | 3, 5 | `client/src/ui.ts`, `client/src/worlds.ts`, `client/src/onboarding.ts` |
| 7 | **Bot audit and tuning.**<br>• Re-run the Gauntlet bot (`scratchpad/g3/play.mts`) on a frontier: minutes to 12/50/250 residents, the cash low point, the idle gaps.<br>• Tune start cash, the gate rate, the base visitor flow and the rank thresholds.<br>• Write the results here. | opus | 1–6 | `shared/src/tuning.ts` (`FRONTIER_TUNING`), this doc |

That is about 50 agent-hours. Subtasks 4 and 5 can run beside 3. Subtasks 2 and 3 should go one after the other, because
both change `simulation.ts` spawn and newcomer handling.

Later, not in this plan:
- B on the shared world, starting with local demand per town (opus, its own card), and trunk roads after the griefing
  controls.
- E's scenario schema on the demo pipeline once Boats B5 (ferries) and B6 have landed, for *Fishing village*.

## 5. Questions for Rich

1. **Where should "start from zero" live first?**
   - (a) Local mode (single player) and a private server world.
   - (b) The shared live world, as a remote charter.
   - (c) Both at once.
   - *Recommended: (a).*
2. **How do the very first people get there?**
   - (a) A pioneer camp: a few settlers arrive by road, pitch tents, and build the first houses.
   - (b) Contract builders who drive in from out of town each day.
   - (c) The map starts with 2 or 3 founding families already there.
   - *Recommended: (a).*
3. **How much money at the start, and what happens if it runs out?**
   - (a) $5,000 and a $2,000 founder's loan; overdraft leads to administration and a recovery plan.
   - (b) $10,000 and no loans; you just can't build.
   - (c) $2,000 and a bigger loan, with failure meaning game over.
   - *Recommended: (a).*
4. **What should unlock things on a frontier?**
   - (a) Settlement ranks (hamlet, village, town, city) that unlock tools and land, replacing the tech tree's opening.
   - (b) The existing tech tree, cheaper.
   - (c) Ranks for land and the gate only, with the tech tree as it is.
   - *Recommended: (a).*
5. **Can visitors who like the place stay for good?**
   - (a) Yes: passing visitors who have a good stop spread the word, and some move in when there is a home and a job.
   - (b) No: visitors only spend money, and residents come from the gate's own demand.
   - *Recommended: (a).*
