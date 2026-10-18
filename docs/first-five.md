# The first five minutes

Audit #1 (docs/audit-2026-10.md roadmap card 1, UTD cfbb1d22). Rich's bar: "a comparable-level entry game which is
fun". The audit's finding: a newcomer online waits 10-12 real minutes for a first resident, watching cranes with nobody
on them, and the goals card has nothing to say until then. This note is the design first and the build second. The
numbers in section 6 were measured with the gauntlet bot (`scratchpad/firstfive/play.mts`) at 05:00, 12:00 and 20:00.

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
| 0:30-1:00 | Drag a street or two through it, joined to the Commons' road. | Road tiles paint as they drag; the card flips to **Pitch camp**, whose "show me" lights the *Pioneer camp* tool just under Residential. |
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
| 8-12 | **Masonry** is ready (300 units built) and bought; the first two-storey house goes up on a full lot. | Level-2 houses; the card's **A growing town (50)** completes; **Police and fire cover** asks for a police box and a fire post. |
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
  level-1 house is 20 instead of 60, so Masonry (300 units) needs fifteen houses rather than five, which the faster
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

MEASURED_TABLE

Bots B and F to day 15 (two hours), after against the onboarding section's figures:

BALANCE_TABLE

Tick cost: TICK_COST.

## 7. Still to do

- The trades van: the crew drives to far sites in a van from the yard (FleetKind 8).
- The camp as a campsite for visitors once the town has grown (start-from-zero B2's "visitors who stay").
- A level-up flash when the first house finishes, and a sound when the settlers arrive (audio v1).
- The moment's caption could name the street once streets have names.
