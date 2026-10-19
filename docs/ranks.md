# Settlement ranks

Audit #4 (docs/audit-2026-10.md section 8, card 4; UTD 4d8038ef), built on start-from-zero option C
(docs/start-from-zero.md) and the Frontier start of the first five minutes (docs/first-five.md section 0). The goal
chain teaches the first hour; ranks are what the town works towards for the next three, pay the grants the Frontier's
cash trough asked for, and on a frontier grow the charter by rings of land.

## 1. What the player sees

- **The rank chip** in the top bar, beside the treasury: a crest with the rank's numeral, its name and the next rank's
  progress ("Camp → Hamlet 2/3"). Its tooltip names the needs. It glows briefly whenever a new milestone lands.
- **The rank card**, in the goals column: the rank and what it means, the next rank's needs as bars, its charter grant
  and (on a frontier) the land it brings, and the last six milestones with their game time. While the goals card is up
  the rank card stays closed (the chip opens it); once the chain is done, skipped or the goals card is hidden, the rank
  card takes its place by itself, so there is always a next step on screen. Opening or closing it by hand is
  remembered (`msimcity.rankCard`).
- **The milestone ticker**: each new milestone comes up under the top bar for five to seven seconds (each its own
  stay, a slight lean and offset of its own), at most three at once, a little over a second apart.
- **The milestone feed** (`RankDTO.feed`, newest first, 40 kept, 12 sent): ranks reached, each need met, residents
  marks (10, 25, 50, 75, 100, 125, 150, 200 … 5,000), jobs filled on your land (5 … 2,000), building work done (500 …
  100,000 units), a day's taxes passing $25 … $5,000, firsts (house, shop, works, office, two- and three-storey
  building, police, fire, park or venue, a second yard, pupils, a bus line, a day and a week in the black), every
  technology unlocked and every goal done.
- **The celebration** on a rank-up: a banner whose letters rise each with its own delay and lean, the opener and the
  banner's tilt picked per rank and hour; fireworks over the middle of the town (render/fireworks.ts), 10 to 23 shells
  by rank, each with its own launch time, spot, apex, palette pair, break (peony, willow, ring, crackle), spark count,
  speed and life, and each spark its own speed, life and twinkle; and the camera pulling up for six and a half seconds
  to show the town, or on a frontier the charter's new ring, with a caption. Any key or click hands the camera back;
  never over a demo tour or on the world map.
- **The next ring** on a frontier: a dashed gold outline on the ground round the land the next rank brings, each dash
  its own length.

## 2. The ladder

| Rank | Needs (all on your own land) | Charter grant | Frontier charter | Bot F, frontier (r10) | Bot F, Commons (c1) |
| --- | --- | --- | --- | --- | --- |
| Camp | the start | - | 32×32 (seeded) | 0 | 0 |
| Hamlet | 90 residents, 2 shops open, a park or venue | $2,500 | 48×48 | 18.0 min | 8.3 min |
| Village | 340 residents, 270 jobs filled, police and fire cover | $4,000 | 64×64 | 43.0 min | 84.3 min |
| Town | 560 residents, 460 jobs filled, 30 two-storey buildings, 3 days in the black in a row | $6,000 | 80×80 | 98.0 min | 106.6 min |
| City | 880 residents, 740 jobs filled, pupils at school or a bus line | $10,000 | 96×96, then open land | 146.3 min | 141.6 min |

The target was about 20, 45, 90 and 150 real minutes at 1× for bot F.

Needs are measured on the player's own land: residents is `progress.housed`, jobs is `progress.jobs` (jobs filled in
your parcels), shops, parks and venues, police and fire buildings and two-storey buildings are counted on your parcels
(the camp's tents are not a house), days in the black are finished days in a row whose taxes and fees covered wages,
upkeep and interest (as the "Balance the books" goal reads them), and "pupils at school, or a bus line" is
`progress.pupils > 0` or a line of yours with two stops. One rank is reached per measurement (four a game hour), so
a town that meets two at once still gets two celebrations.

## 3. Measured

**How "real minutes" were got.** The bots ran against a headless server at `SIM_STEPS=10` (ten simulation ticks a
loop), so three hours of play took about 18 real minutes. Every time is game time after the bot joined, converted at
the game's own rate (a game day is 8 real minutes at 1×), so it is what a player at 1× would see; at 4× in local mode
every figure is a quarter. The bot is `scratchpad/ranks/play.mts`, a copy of the first-five bot with these changes,
all things a player following the cards would do: it reads the `rank` message; it places another builders' yard when
more than 20 lots wait and it has $700 (one a game day, up to eight; the builders hint and the issue bubbles say the
same); it places police and fire first when the goal or the rank card asks for cover; on a frontier it waits for the
ring rather than buying land; it has a second and third column of blocks and one to the west; and it keeps each
column's first tile unzoned, because a house there cut a later block's connector off (run r6, a bot layout bug the
`buildersRoad` hint flagged).

**Tuning runs** (frontier, seed 424242, joined at the dawn start, three hours each):

| Run | What changed | Hamlet | Village | Town | City | Longest stretch without news |
| --- | --- | --- | --- | --- | --- | --- |
| r1 | first ladder; the bot as copied (one handyman) | 23.2 | 67.2 | - | - | 20.3 (a town of 2 builders stalls at 190) |
| r2 | the bot adds yards | 17.3 | 33.6 | 41.9 | 90.3 | 17.4 (after City) |
| r3 | needs raised; residents mark past City | 13.3 | 48.6 | 74.3 | 131.3 | 21.7 |
| r4-r6 | needs, grants and bot fixes (see NOTES) | 17-34 | 52-65 | 105-130 | 164-172 | 8.0-14.3 |
| r9 | the bot's yards at $700 | 18.3 | 32.9 | 84.9 | 148.6 | 7.7 |
| **r10** | **final: Village 340/270, growth-pause nudges** | **18.0** | **43.0** | **98.0** | **146.3** | **5.3** |

Run to run the same ladder moves by several minutes, most of it in the first half hour (whether the town affords a
second yard before the trough), so read the ranks as "about" their targets.

**News on screen** (r10, first three hours). A next step is on screen all the time: the goals card until the chain
is done, then the rank card's needs with a "Next step" line under the first one short, and past City the next
residents mark. The longest stretch with nothing new (a goal, a rank, a need met, a milestone, a technology ready
to buy or an advisor hint) was 5.3 minutes (from minute 75.0); counting only the goals card and the feed it was 5.7;
counting anything at all (a resident, a building finished) 4.0. The Commons run: 4.6, 8.0 and 3.6. What made it hold
in plateaus is the growth-pause nudge: residents not rising for half a game day (four real minutes) puts a line in
the feed saying why and what to do ("Growth has paused at 849 residents with 46 lots waiting for builders: another
builders' yard (Y) puts more crews on them"), at most three times a plateau.

**Money.** On the Commons ($20,000 start) the treasury's low point over three hours was **$10,429** (minute 77) and
it never went under $5,000: the acceptance test holds as written. On a frontier it cannot: the start is $5,000 and the
opening a card-follower plays spends about $4,000 of it in the first two minutes (the street, six rows of homes at
$400, the camp, the handyman, Parking lots), before any rank is reachable, so a $5,000 floor would mean handing the
money straight back (a $10,000 start in disguise). The proposed frontier test: **never into the overdraft, and above
$5,000 from Town on**. r10: low $300 at minute 8.6 (the opening and the first yard), $793 after Village, **$10,315
from Town (minute 98) to the end**, $25,059 after City. The grants land where the trough was: before ranks the
frontier bot sat at $750-1,300 from minute 2 to 20 waiting for Masonry and the second yard; with them the Hamlet's
$2,500 at minute 18 pays for Masonry, cover and a yard within the game hour. A bot that spends down to a few hundred
dollars whenever it can will always show a low point near that floor; minutes under $1,500 (51 of 180 in r10) is the
better reading of the trough, and it ends at the Village grant.

## 4. How it fits

- **The goal chain** (shared/goals.ts, server/goals.ts) is untouched in shape: no need repeats a goal's target, the
  goals' completions go into the feed, and the rank card stays out of the goals card's way until the chain is done.
  Two small fixes from docs/first-five.md's list ride along: "Lay a street" counts only road tiles laid after the
  record began (`GoalState.roadBase`; the country road's 11 tiles inside the charter no longer nearly meet it), and
  a frontier's card reads "Goal 1 of 13" (the charter claims the plot before the card is seen).
- **Technology** is unchanged: ranks pay money and land, not tech. Start-from-zero C's "ranks are the tech gates on a
  frontier" is left for later (section 6).
- **Money** (sim/finance.ts, Audit #5): grants go through the ledger's "Other" line like goal rewards, so "Balance the
  books" and the rank's days in the black are not flattered by them. A rank reached while overdrawn or in
  administration still pays: the grant lands in the overdraft and shortens the way out. Ranks are never lost.
- **Land on a frontier** (shared/ranks.ts `charterRing`, server/ranks.ts `grantRing`, `landRefusal`): the charter is
  32×32 at Camp, 48 at Hamlet, 64 at Village, 80 at Town and 96 at City, grown evenly north and south and never more
  than 10 tiles towards the gate (the rest of the growth goes east). On a rank-up every unclaimed tile between the land
  held and the new ring becomes the holder's, as parcels of at most 48 a side combined into the charter's estate (one
  name, colour and tax rate). Before City the holder cannot buy land beyond the charter (the toast names the next
  ring); from City on the ordinary land rules apply. Anyone else on a frontier may not buy inside the City ring.
- **The Commons** (the live world): the same ranks, needs and grants; no rings, no land rule.
- **Saves**: `Player.ranks` is saved with the player. A save from before ranks has none: the first measurement after
  loading derives the rank from the town as it stands (the books taken as balanced, since a streak cannot be read
  back), pays no grant, celebrates nothing, marks every milestone already true as history, and on a frontier gives
  the charter the land its rank holds. The feed starts "<rank>: the record begins".
- **Local mode** runs the same Net (game.ts), so ranks, grants, rings and the feed work there unchanged, four times
  sooner at 4×.
- **Sandboxes** (test cities, demos) have no ranks, like the goals. The showcase's tour has a "Settlement ranks" stop
  that plays the celebration over the town (feature `settlement-ranks`, `view: 'ranks'`).
- **Several tabs**: one measurement per player per tick is shared by all of that player's connections, so each tab
  gets the rank-up and the milestones.

## 5. Checks

- `npx tsx packages/server/src/loadtest/ranks.ts`: 38 passed, 0 failed. A frontier Camp with its charter and land
  rule, the street goal counting the player's own roads, each rank-up with its grant through the ledger, the ring as
  parcels of at most 48 in one estate, the feed, no second grant, one rank a measurement to City, City's open land, the
  save round trip, an older save deriving its rank without a grant (and a snapshot with no rank records loading),
  the Commons (ranks, no ring), a sandbox (none), a rank reached in administration, the growth-pause nudges.
- `npm run typecheck` (with `local:check`), `buildings:check`, `demo:check` (the showcase's `ranks` stop and feature
  `settlement-ranks`) and `finance:check` pass after merging main (Audit #3 fires).
- Tick cost: `loadtest/ab.ts --hour 8 --ticks 3000 --seed 1` gives identical counts on main (aad4c0e) and this branch,
  0.869 and 0.885 ms a tick (ranks live in Net, so the simulation is untouched). A measurement (`Ranks.check`, four a
  game hour per online player) costs 0.22 ms on the three-hour frontier town of r10 (1,359 residents).
- Screenshots: the rank chip, the next ring's outline, the milestone ticker, the Hamlet and Village celebrations (banner,
  fireworks, the camera on the new ring), the charter after it grew, the rank card with its feed.

## 6. What I'd change next

- Ranks as the tech gates on a frontier (start-from-zero C's recommendation): today the goals and the tree still
  gate tools, and the T panel does not show ranks.
- The gate's capacity by rank (country road, motorway, coach station), and appeal as a City need once B2 exists.
- Losing a rank after a week below its residents (start-from-zero C's gentle failure); ranks are one-way for now.
- A "Charter grants" ledger line instead of "Other", and a sound for the rank-up (audio v1).
- The second player on a shared frontier: they may not buy inside the first charter's City ring, and have no
  charter of their own; a second gate and charter would be the real answer.
- The frontier's first twenty minutes still swing by ten minutes run to run on whether a second yard is affordable;
  a cheaper first builders' yard or a Hamlet grant that comes with one would steady it.
