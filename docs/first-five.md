# The first five minutes

Audit #1 (docs/audit-2026-10.md roadmap card 1, UTD cfbb1d22). Rich's bar: "a comparable-level entry game which is
fun". The audit's finding: a newcomer online waits 10-12 real minutes for a first resident, watching cranes with nobody
on them, and the goals card has nothing to say until then. This note is the design first and the build second. The
numbers in section 6 were measured with the gauntlet bot (`scratchpad/firstfive/play.mts`) at 05:00, 12:00 and 20:00.

## 0. From a blank sheet: the Frontier start

Rich's redirect (2026-10-19): judge the first five minutes from a blank sheet, the almost empty world of
docs/start-from-zero.md option A, not beside the Commons. This section is that review; sections 1-7 are the shared-world
path as first built and measured, which stays as it is.

### What the player sees and does, from nothing

A valley from the seed's terrain, no town anywhere. One country road comes in from the west edge and stops in the
middle of a free 32×32 land charter that is already theirs. At the road's far end stands the gate, the motorway
connection the rest of the world arrives through. $18,000 in the treasury ($5,000 when this review was written; raised
with the cash floor of docs/ranks.md section 3). The clock reads 06:00, dawn: a frontier
always starts at dawn, so nobody meets the overnight lull in their first half hour. Times are real time at 1×; local
mode's 4× makes every number a quarter and pause holds any of them.

| When | What they do | What they see within seconds |
| --- | --- | --- |
| 0:00 | The join card; the camera at the road end, the gate on the horizon. | **Goal 2 of 14, Lay a street** (the charter has done "Claim your plot"): "Road (3): drag a street on from the end of the country road into your land." (Claim your plot is gone: the charter is theirs.) |
| 0:15-0:40 | Drag a street east from the road end, a side street or two. | The road shows as a ghost with its cost and is built on release; "Nicely done! Lay a street"; the card flips to **Pitch camp**, "show me" lights the camp tool. |
| 0:40 | Click a tile beside the street. | The camp stands at once: tents, a caravan, a fire pit, festoon lights. Toast: *"Camp pitched: eight settlers are on their way through the gate and arrive within the hour."* The card flips to **Zone homes**. |
| 0:50-1:30 | (meanwhile) | Headlights at the gate: the first car with a roof box turns off the motorway and comes the whole length of the country road, then two people with suitcases, then another car. The camera leaves the player's hands for seven seconds to meet the first of them at the camp: **"Your first settlers are here: Ada Walker and 7 more are pitching camp."** |
| 1:00-1:20 | Paint a dozen lots of Residential along the street. | Each lot opens a site within 8 seconds: fences and cranes. The card flips to **Hire your own builders**: "Handyman's workshop (Builders, the first size, $120)". |
| 1:30 | Place the handyman beside the street, by the camp. | It opens at once: *"Your first builders' yard opens at once: 2 of your settlers take up tools and set off for your nearest lots now."* Two figures walk out of the camp with tools. |
| 1:45-3:00 | Watch, or zone a few more lots. | The first house stands at about 2:15 (20 units of work, two builders); a car with a roof box leaves the gate for it. Then a house a minute. "residents in homes 4 / 12 …" |
| 3:00-5:00 | Hover a builder; follow a settler; open the tech tree the chip is pulsing about (Parking lots). | 12 in homes by about 4:00: **First homes** done, *Commercial zoning, free*. The card flips to **Open the shops**. Twenty-odd people live on the land. |
| 5-8 | Zone six shops. | Shop sites open, the two builders move on to them; the first shop opens at about 7; its staff come through the gate. |
| 8-12 | A second builders' yard, or a park ($120). | Thirty to fifty residents; Masonry ready; the first two-storey house. |
| 12-20 | Police box and fire post (civ1), a park, more homes and shops. | Patrol cars on the country road; the first visitors' cars turning in at the gate (visitor flow scales with population); the ledger's first day in the black. |
| 20-30 | Industrial zoning ready; a second street. The camp's settlers move into finished homes; newcomers fill the tents behind them. | 100-150 residents; the hamlet reads as a village: lights at night, the gate's count of arrivals today. |

### What the branch already gives that start, and what has to change

What is already there and carries over unchanged: the camp and its settlers' wave through a gate (`Gateways.wave`), the
instant crew (the handyman is a yard tier; `starterYard` hires the settlers and sends them out now), the first house
at 20 work, the moment, the 14-goal chain's shape, the followers rule for the first two dozen beds, the transit camp.

What the blank sheet breaks, and the fix in this pass:

| Problem on an empty map | Why | Fix (this branch) |
| --- | --- | --- |
| No world, no road, no gate, no land | `seedCommons` is the only seeder; a player buys land | `seedFrontier`: the gate (kind 21) on a country road from the west edge to the middle of a 32×32 charter; `World.start = 'frontier'` in the snapshot; the first player to join gets the charter and `FRONTIER_MONEY` ($5,000 then, $18,000 since the cash floor of docs/ranks.md section 3); `START=frontier` on the server, "Start from zero" in local mode's new-game form (the default) |
| **The stuck remote start**: nothing grows because residential demand is `jobs − population + 6` over the world, and with eight settlers and two handyman jobs that is 0 | growth() is world-wide, and here the town is the world | a young town's floor: while fewer than 24 people live on an owner's land, their lots grow as if demand were 12 (`FirstFive.youngTown`, one line in growth()); with the followers rule (spawn) the first two dozen beds fill behind the handyman's wages; after that the ordinary loop runs, and on a one-town world it is per town by construction |
| Nobody to staff the handyman | builders are residents; homes take newcomers only once built | the camp's eight settlers, through the gate, at once (built already) |
| Joining at night; the lull after the first shift | a shared clock | the frontier starts at 06:00; the starter crew's rest rule (built already) covers evening joins on a server |
| The goals talk about the Commons | copy and the "show me" focus | frontier copy for the street and yard goals, the charter pre-completes Claim your plot, focus falls on the road end (`welcome.home`) |
| $20,000 makes every choice free | START_MONEY | $5,000 on a frontier; the money floor is Audit #5's card, and this budget leaves it room (the opening below costs about $1,200). Since raised to $18,000, with bigger rank targets on a frontier, so the treasury stays above $5,000 (docs/ranks.md section 3) |

What this pass leaves as hooks: appeal and prospects (B2: a per-town score and "looked and left"), visitors who stay,
settlement ranks (Audit #4), the overdraft and administration (Audit #5), a country-road gate kind with a lower rate
than the motorway's 30 an hour (the motorway connection stands in), and a second player's charter on a shared
frontier (a later player buys land as today).

### Measured on the frontier

The frontier bot (`scratchpad/firstfive/play.mts` with `FRONTIER=1`: no land to buy, its first blocks hang off the road
end, the handyman instead of a yard) on a fresh frontier (`START=frontier`, seed 424242), SIM_STEPS=10, following the
card, joining at the dawn start (06:00) and, on a server left running, at 12:00 and 20:00. Minutes are real minutes at 1×
after joining; at 4× in local mode every figure is a quarter.

| | dawn start (06:00) | dawn start, after the merge of main (E5) | 12:00 | 20:00 |
|---|---|---|---|---|
| first resident (min) | 0.5 | 0.5 | 0.4 | 0.4 |
| 12 residents (min) | 2.5 | 2.2 | 2.1 | 2.4 |
| 12 in homes, the goal (min) | 2.7 | 2.5 | - | - |
| longest stretch with nothing new in the first 30 (min) | 2.3 | 2.7 | 2.9 | 1.3 |
| shops open (goal, min) | 6.8 | 8.2 | | |
| 50 residents (min) | 10.2 | about 8 (53 at 7.9) | | |
| Masonry ready (min) | 2.8 (300 units) | 13.2 (1,500 units) | 2.8 (300) | 12.4 (1,500) |
| treasury low point in 30 min | about $750 | $750 (day 1) | | |

The acceptance test passes at every hour on the blank sheet, and the overnight lull never shows: the frontier starts at
dawn, and a server join at 20:00 has the crew's first-day rest rule. What the runs showed and this pass changed: the
first handyman opened unreachable until the bot joined its own blocks (a layout bug of the bot, but the same thing a
player can do; the issue bubbles of Audit #2 now flag it); Masonry at 300 units came at minute 3, so the construction
thresholds are 1,500 / 4,000 / 7,000; and with "A growing town" behind the Masonry purchase, a $5,000 player at $900
in hand waited twenty minutes for the chain to move, so the two goals swapped. What the runs show that is not this
card's: on $5,000 the treasury sits at $750-$1,300 from minute 2 to minute 20 while tax climbs from $30 to $250 a day;
the rank grants of Audit #4 are the designed answer, and the money floor of Audit #5 now stands behind it. Two small
things to tidy: the country road inside the charter already counts 11 of the street goal's 12 tiles, and the card
reads "Goal 2 of 14" because the charter completes "Claim your plot" before it is seen.

## 1. The idea in one paragraph

People first, then builders, then houses. A new player's third act is to **pitch a pioneer camp** ($150, 2×2, opens
the moment it is placed): eight settlers come up the road within the game hour with suitcases and roof boxes, and the
camera goes to meet them. Their fourth and fifth acts are to zone homes (cranes appear within seconds) and to place a
builders' yard, which **opens at once and sends the settlers to the nearest sites now**, not with tomorrow's shift. A
first house is **20 units of work** (a third of before), so the first family moves in within three minutes of joining
and twelve people live in proper homes by minute four. Nothing here is a cheat: the settlers are ordinary citizens who
fill a level-1 home, the yard is an ordinary yard, and from the first house on the simulation runs exactly as before.

## 2. What a new player sees, second by second

Times are real time at 1× (a game day is 8 minutes, a game hour 20 seconds), from pressing Play. A game-time clock
shared with everyone else online cannot be sped up for one player, so the start itself has to be quick; at 4× in local
mode everything below happens four times sooner.

| When | What they do | What they see within seconds |
| --- | --- | --- |
| 0:00 | The join card; the world appears beside the Commons. | The goals card: **Goal 1 of 14, Claim your plot**, with "show me" looking at the open land beside the Commons' edge road. |
| 0:10-0:30 | Drag out a plot. | The parcel outline in their colour; "Nicely done! Claim your plot"; the card flips to **Lay a street**. |
| 0:30-1:00 | Drag a street or two through it, joined to the Commons' road. | The road shows as a ghost with its cost and is built on release; the card flips to **Pitch camp**, whose "show me" lights the *Pioneer camp* tool just under Residential. |
| 1:00 | Click a tile beside the street. | The camp stands at once: three ridge tents and a caravan round a fire pit, festoon lights on a wire, a washing line. The toast: *"Camp pitched: eight settlers are coming up the road and arrive within the hour."* The card flips to **Zone homes**. |
| 1:05-1:20 | Paint a row or two of Residential. | Each lot opens a site at the next growth pass (every 8 seconds): fences and cranes. The card flips to **Hire your own builders**. |
| 1:10-1:25 | (meanwhile) | The first settlers turn into the street: a car with a roof box, then two people with suitcases, then another car. The camera leaves the player's hands for seven seconds, flies down to the camp and turns slowly: **"Your first settlers are here: Priya Shah and 7 more are pitching camp"**. Any click or key hands the camera straight back. The rest trickle in over the next 20 seconds. |
| 1:30 | Place the builders' yard beside the street, near the camp. | It opens at once. Toast: *"Your first builders' yard opens at once: 8 settlers take up tools and set off for your nearest lots now."* Eight little figures leave the camp, walk to the yard and fan out to the nearest sites. |
| 1:45-2:30 | Watch. | Site progress steps up every few seconds (the tile shows 0/4 … 3/4); the first house stands at about 2:10 and the crane goes. A newcomer walks in with a suitcase. The next three houses follow within the minute. |
| 2:30-4:00 | Maybe paint more homes; hover a builder; follow a settler home. | "residents in homes 4 / 12 … 8 / 12 … 12 / 12": **First homes** done, *Commercial zoning, free*. The tech chip pulses "Parking lots". The card flips to **Open the shops**. |
| 4:00-5:00 | Zone a few shops. | Sites open on them, the crew moves on, the camp's fire glows as the clock reaches dusk. |

## 3. Minute by minute to thirty

| Minute | What happens | What is new on screen |
| --- | --- | --- |
| 5-8 | Shops rise; settlers and newcomers take the first shop jobs; 25-50 residents. | Shops' lights by night, the first visitor cars, a tech chip pulse (Emergency services, Libraries). |
| 8-12 | **Masonry** is ready (1,500 units built; it was 300, which the faster crew met at minute 3) and bought; the first two-storey house goes up on a full lot. | Level-2 houses; the card's **A growing town (50)** completes; **Police and fire cover** asks for a police box and a fire post. |
| 12-16 | A park, a police box, a fire post. 60-100 residents. | Patrol cars; the park's first visitors; the ledger's first day in the black (**Balance the books**). |
| 16-24 | Industrial zoning ready; a second block of homes. The camp's settlers begin to move into finished homes (a third of them a day); newcomers fill the camp behind them. | A new block of cranes; the camp's population turning over; the bored hint if there is nothing to do yet. |
| 24-30 | 150-250 residents; traffic on the Commons' grid starts to thicken; Public transport opens at 200. | The queued share in the top bar; the jam hint; **A real town (250)** near. |

The quiet stretches of the audit (friction 9: 7 minutes between the opening and the first residents) are gone. The
measured longest stretch with nothing new on screen in the first 30 minutes is 2-3 minutes for a player who follows the
card (section 6), and it falls in minutes 24-30, which is the shape a good start should have: dense at the beginning,
breathing by the half-hour.

## 4. What changes, and why it is fun rather than just fast

| Change | Where | Why it is fun |
| --- | --- | --- |
| **The pioneer camp**: kind id 120, a 2×2 residential sub-kind placed like a civic structure by its door on a road; $150, $4 a day; eight beds; two designs (ridge tents and a caravan; a bell tent, a dome tent and two caravans); fire pit, lanterns and festoon bulbs on a new `fire` window class that glows from dusk and flickers on a phase of its own per camp and per part. Never grows or merges; one per player at a time. | `shared/src/buildings/camp.ts`, `palette.ts` (`fire`), `client/src/render/materials.ts` (Win.Fire) | A town starts with people, not paperwork. The camp is a *place* the player made that is alive within a minute: a fire, washing, caravans. At night it is the warmest thing on the map. It is also the first building whose residents the player can click on and follow. |
| **Settlers at once**: pitching a camp queues a newcomer for every free bed, due over the next 45 game minutes, past the gate's hourly bucket (`Gateways.wave`) when a gate exists; with none (every fresh world) they come up the road from the nearest road end at least 10 tiles away (`FirstFive.roadEnd`, a pseudo-gate through `Simulation.arriveVia`): their own car with a roof box, or on foot with a suitcase, exactly as a gateway arrival is drawn; with no road end at all they appear in place. `spawn()`'s 25% roll and its vacant-jobs test are bypassed once, for these eight. | `server/src/sim/firstfive.ts` `campPitched`, `roadEnd`, `tick`, `roadGate`; `sim/gateways.ts` `wave`, `reserve`/`release`, `totals.roadIn` | The player *sees them arrive*: a line of people coming down the street they just laid is the oldest pleasure in the genre, and it is honest (they are the same newcomers the gate brings, drawn the same way). |
| **The first-settlers camera moment**: the first newcomer to move in on the land of an owner with nobody housed yet queues a `settlers` hint with the camp's tile and the arrival's name; the client flies the camera there (1.8 s), holds for 4.5 s with a caption while turning slowly, and flies back. Once per player ever, never after "skip the tutorial", never during a demo tour or on the map, and any input ends it at once. | `firstfive.ts` `settled`, `server/goals.ts` `settlers`, `net.ts` flush, `client/src/moment.ts`, `onboarding.ts` | Someone turning up to live in a place you made deserves a look. Seven seconds, cancellable, once: a moment, not a cutscene. |
| **The instant crew**: a player's first yard already opened at once (Gauntlet 3); now it also hires adults out of work within 64 tiles on the spot, nearest first (the camp is next door), camp settlers leave a job more than 12 tiles away for it, and for its first game day whoever it hires sets out for a shift *now* rather than at 07:00 tomorrow. From day two it is a yard like any other. | `firstfive.ts` `starterYard`, `hired`; `net.ts` build | The old "its builders start with their next shift" was the dead ten minutes. Now the player's own settlers walk out of the camp with tools, which is the cause-and-effect a new player needs to see once to understand the whole game. |
| **A first house at 20 work** (residential level 1; levels 2 and 3 stay at 120 and 180, every other kind unchanged); `growth()` takes the catalogue's work for every kind instead of `WORK_PER_LEVEL × level`. | `shared/src/buildings/residential.ts`, `scripts/check-buildings.ts` (the rule), `sim/simulation.ts` growth | A builder builds a cottage in 24 game minutes instead of 72. Four builders on a site: a house every minute of real time. The crane-to-house moment comes while the player is still looking. |
| **The goal chain** is 14: plot, street, **camp**, homes, yard, **first homes** (12 residents in houses, the camp aside), shops, Masonry, 50, cover, park, books, 250, bus line. Copy rewritten for the new order. A player who never pitches a camp passes "Pitch camp" once eight people live on their land another way, so the chain never blocks. Old saves past the camp are marked done without a reward. | `shared/src/goals.ts`, `server/src/goals.ts` | Five goals fall in the first 90 seconds, each answered on screen within seconds of the click; the sixth is the one worth waiting a minute for. |
| **Followers**: while fewer than 24 people live on a new player's land and someone there has a job, its homes take newcomers without waiting for a vacant job anywhere in the world (`spawn()` otherwise rolls 5% when `vacantJobs` is 0). | `firstfive.ts` `followers`, `simulation.ts` spawn, `START_TUNING.followerBeds` | A settler's family follows a wage. Without it a noon join, when the Commons' jobs are all taken, left six finished houses empty for three minutes; the rule is bounded to the first two dozen beds and leaves the jobs-lead-growth loop alone after that. |
| **The camp is a transit camp**: a settler at home moves into a finished home with room nearby with a 35% chance a day (a partner living with them comes along, the household kept); newcomers fill the tents behind them; the life step's own move-out never picks the tents; bulldozing the camp rehomes its people nearby first. | `firstfive.ts` `campStep`, `campCleared`, `bedNear`; `simulation.ts` lifeStep, lifeFamily | Tents beside apartment blocks for ever would read as a bug. People moving out of the tents into the houses they built is the story closing on its own, and the camp keeps earning its $150 as the cheapest beds in town. |

Toasts and copy: "Camp pitched: eight settlers are coming up the road and arrive within the hour" (or "through the
gate", or "move in"), "Your first builders' yard opens at once: N settlers take up tools and set off for your nearest
lots now", and the moment's caption. The goal card's "show me" for Pitch camp lights the camp tool and looks at the plot.

What was considered and not done: a trades van driving the crew to sites (FleetKind 8 is reserved; it would be the
right next touch), smoke over the fire (no particle pass exists), out-of-town contractors (start-from-zero B1's second
option: more general, riskier, not needed once the camp exists), and a "strike camp" goal (the transit camp makes it
unnecessary; the player may still bulldoze it).

## 5. How it fits the goals, the economy and both modes

- **The thirteen goals become fourteen** with one inserted and one re-measured. Rewards: the camp pays its own price
  back ($150). Everything after "First homes" is as it was; the bots reach "A growing town" and "Balance the books"
  about 8 and 10 minutes sooner than before (section 6) because the first houses come sooner, and nothing later moves.
- **Jobs and residents.** The camp adds eight residents with no jobs of its own; `rDemand = jobs − population + 6` on
  the whole world barely notices eight people beside the Commons' 60-120. The settlers take the yard's ten places,
  which is where the first game day's `jobs` on the player's land comes from in either case. The bypass of `spawn()`
  is once, for the camp's beds; every later bed fills by the usual rules.
- **Money.** The opening costs $150 more and pays $150 back. The first houses pay tax sooner, so the cash curve lifts
  a little and keeps its shape (section 6). The yard's wages run from the moment it opens instead of from 07:00, which
  is a few dollars.
- **Later balance.** Level 2 and 3 work is unchanged, so growth after Masonry runs at the old pace; `built` per
  level-1 house is 20 instead of 60, so Masonry needs more houses than before; its threshold is raised to 1,500 (Steel frame 4,000, Deep foundations 7,000) so that it stays a minute-8 reward, which the faster
  crew covers (ready at about 3 minutes against 9-11). Bot B and bot F to day 15 are in section 6.
- **Online and local.** Nothing here touches the clock: it is all per-player events on the shared tick, so it works
  identically on the live world (no per-player time control) and in local mode (pause and 4× make it four times
  quicker). The settlers' wave and the moment ride the existing messages (`hint` gained an optional `at`), so an older
  client just sees a toast.
- **Saves.** The camp is a catalogue kind in the sub layer (no format bump); `GoalState.settlers` and `done: ['camp']`
  are optional; a world saved before this loads with its chain intact.
- **Showcase.** The camp is placed beside the motorway junction with a tour stop (`demo:check` passes).
- **Education E4** (job skill gates) merges before this: `FirstFiveDeps.canTake` is the one place the starter yard
  asks whether a settler may take a place, to be pointed at `Skills.placeFor` on rebase; everything else goes through
  `hire` and `findJob` as before.

## 6. Measured

The gauntlet bot (`scratchpad/firstfive/play.mts`, the onboarding card's bot with a camp step and an event log) on a
fresh world, SIM_STEPS=10, joining at 05:00, 12:00 and 20:00 on day 0. F follows the card; B reads the first goals,
pitches the camp, but places its yard only when the builders hint tells it to (the audit's "sensible" player). "Before"
is the tree at d90f05f (the previous agent's runs with the same bot); minutes are real minutes at 1× after joining.
Residents counts everyone on the player's land, the camp included; "in homes" is the First homes goal.

| | before F 05:00 | before F 12:00 | before F 20:00 | **after F 05:00** | **after F 12:00** | **after F 20:00** | before B 05:00 | after B 05:00 |
|---|---|---|---|---|---|---|---|---|
| first resident (min) | 2.8 | 7.8 | 4.8 | **0.8** | **0.8** | **0.8** | 3.1 | 0.8 |
| 12 residents (min) | 10.5 | 9.1 | 6.5 | **2.4** | **6.8*** | **5.5** | - (run ended at 30) | 10.5 |
| 12 in homes, the goal (min) | 10.3 | 9.1 | 6.6 | 3.6 | 6.8* | 5.9 | - | 10.6 |
| longest stretch with nothing new in the first 30 (min) | 4.7 | 5.7 | 3.3 | **2.0** | **1.7*** | **1.7** | 1.7 | 7.3 |
| Masonry ready (min) | 9.1 | 7.1 | 4.1 | 2.1 | 3.1* | 2.1 | 3.1 | 9.4 |
| yard placed (min) | 0.9 | 0.9 | 0.9 | 1.3 | 1.3 | 1.3 | - | 8.3 |
| A growing town (50) (min) | 18.3 | 17.1 | 21.6 | 7.9 | 11.4* | 8.8 | - | 14.6 |
| Balance the books (min) | 22.1 | 19.8 | 25.1 | 14.1 | 19.8* | 17.1 | - | 22.1 |
| the settlers moment | - | - | - | yes | yes | yes | - | yes |

The acceptance test (first resident within 3, 12 within 8, no stretch over 4 in the first 30) passes at all three hours
for the player who follows the card. The noon join is the slowest because the Commons' jobs are all taken by midday,
which is what the followers rule answers (* the noon column was measured before that rule; the 05:00 column after it; the frontier runs in section 0 include it). B pitches the camp
(its first eight arrive at 0.8) but places no yard until its one-day fallback at 8.3, because the builders hint stays
quiet while "Hire your own builders" is the active goal: B is a player who has the card up and does not read it, and
its 7.3-minute stretch is the wait for its own yard. Before, B's first resident took 3.1 minutes and F's up to 7.8.

Bots B and F to day 15 (two hours), after against the onboarding section's figures:

| F to day 15 (two hours), joined 05:00 | before (d90f05f, same bot) | after |
|---|---|---|
| money at day 2 / 4 / 7 / 10 / 15 | $13,487 / $10,665 / $7,654 / $10,392 / $15,718 | $8,246 / $9,721 / $10,780 / $12,810 / $17,326 |
| lowest money | $7,582 (day 6.8) | $8,246 (day 2.0) |
| residents at 10 / 30 / 60 / 120 min | 2 / 49 / 250 / 485 | 97 / 217 / 324 / 477 |
| own jobs at the end (cap / filled) | 154 / 144 | 147 / 136 |
| techs bought; `built` | 13; 24,663 | 13; 20,224 |
| tax a day at the end | $1,245 | $1,015 |
| goals: shops / Masonry / 50 / books / 250 / bus line (min) | 18 / 18 / 18 / 22 / 53 / - (onboarding section, F) | 7.4 / 7.6 / 7.8 / 14.1 / 42.6 / 46.6 |

The after curve spends earlier (every tier-1 node is affordable by minute 8) and ends higher; the low point is
$700 higher and comes at day 2 instead of day 7; two-hour population is the same within noise. B (the sensible player
who waits for the builders hint) was run to 30 minutes only: see the table above.

Tick cost: `loadtest/ab.ts --hour 8 --ticks 3000 --seed 1` on the same seeded city gives identical counts on main (389df42) and on this branch, at 1.015 and 0.994 ms a tick: unchanged.

## 7. Still to do

- The trades van: the crew drives to far sites in a van from the yard (FleetKind 8).
- The camp as a campsite for visitors once the town has grown (start-from-zero B2's "visitors who stay").
- A level-up flash when the first house finishes, and a sound when the settlers arrive (audio v1).
- The moment's caption could name the street once streets have names.
