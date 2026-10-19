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

TABLE

Needs are measured on the player's own land: residents is `progress.housed`, jobs is `progress.jobs` (jobs filled in
your parcels), shops, parks and venues, police and fire buildings and two-storey buildings are counted on your parcels
(the camp's tents are not a house), days in the black are finished days in a row whose taxes and fees covered wages,
upkeep and interest (as the "Balance the books" goal reads them), and "pupils at school, or a bus line" is
`progress.pupils > 0` or a line of yours with two stops. One rank is reached per measurement (four a game hour), so
a town that meets two at once still gets two celebrations.

## 3. Measured

MEASURED

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

CHECKS

## 6. What I'd change next

NEXT
