# Early-game audit: the first two hours of a new player (strict start)

Card bee18a73 (Gauntlet 1), parent f2ecbf10. Inputs for two follow-ups: "economy and tech pacing tune for hours 0-2" and
"onboarding goals and advisor hints". This document changes no game code.

## Method and caveats

- Fresh world each run (the Commons only), strict start (tech locks on, not `?dev`), 20,000 starting money, joined at
  about 04:00 game time. Isolated server on :8085 at `SIM_STEPS=10`, driven over the websocket by a bot that decides once
  per game hour (about 20 real seconds at normal speed, a plausible human cadence). Two hours of play is 15 game days
  (1 day = 8 real minutes). "min" below means real minutes at normal speed (game days x 8).
- The working tree was changing under the audit (other agents editing, no commits yet): the findings are for the tree as it
  stood on 2026-10-17 between 02:20 and 02:50, which already includes gateways (motorway connection) and the tr1 change that
  unlocks it.
- Four playthroughs, same opening (a 16x9 plot east of the Commons, roads on every third row, 96 residential lots, joined to
  the Commons' road at x=10):
  - **run2 (baseline A)**: never places a builders' yard of their own, i.e. relies on the Commons' yard. Stopped at day 9.
  - **run3 (main, "B")**: places their own yard at day 1.1 when the build queue is clearly stuck, buys every tier 1-3 tech
    as it becomes ready, one police + one fire + one library + one park, then expands cautiously. Played to day 15.
  - **run4 ("C")**: as B but spends harder (second yard, con3, cul3, civ3, tr2/3/5 late). Played to day 15.
  - A throwaway player ("Lost") and a second ("Moto") probed dead ends, the motorway and what zoning does to roads.
- Bot limitations to keep in mind: run3 stopped expanding after day 3.5 because its own throttle (build queue over 24 sites)
  never cleared, so its idle stretch after day 4 is partly an artefact (run4's throttle was looser and shows a player who
  is money-limited instead). In run4 the bot painted a zone over a road tile that was the only link to its service
  row and yards (day ~9): `built` froze at 19,980 and 70 jobs went unfilled for the rest of the run. That is the bot's
  mistake, but the game gave no feedback at all, see friction 6. Scripts and logs live in
  `/private/tmp/claude-501/-Users-rich-code-msimcity/a4b5ec58-dfb6-4628-98d5-1794f7190102/scratchpad/gauntlet/`
  (`play.mts`, `run{2,3,4}.log|.jsonl`, `shots/`).

## The rules that matter in the first two hours (from the code)

| Thing | Value |
| --- | --- |
| Start | $20,000, no tech. Free from the start: roads, residential zoning, builders' yard, parks, the handyman. Everything else is behind the tree. |
| Land / road / zone | $10 per tile; road $10 (own land) or $20 (unclaimed, needs Public works); zone $25 per tile; first parcel anywhere, later ones must share an edge |
| Yard | $300, $15/day, ten builders at $16 a shift paid from the owner's treasury; builders go to the most urgent site anywhere on the connected network and earn the yard's owner $0.165 per work unit from the site's owner (a no-op for your own sites) |
| `built` counter | credited to the owner of the **yard** the builder works from (`workSite`: `bump(yardOwner, 'built', rate)`), not the owner of the site |
| Services | police $400 / fire $400 / library $450, upkeep $20 / $20 / $10 a day **plus staff wages paid from your treasury** (police 12 x $20, fire 9 x $20, library 4 x $16 a shift; staff pay 10% of it back as income tax) |
| Income | property tax: $40 x tax rate (10%) = $4 per resident per day; income tax: 10% of wages ($1.5 a day per shop job at $15); sales tax on spending at your venues. Wage tax goes to the owner of the workplace, not of the home |
| Road upkeep | $0.5 per road tile per day |
| Demand | global and relative: homes grow while `jobs - population + 6 > 0`, workplaces while `population - jobs + 6 > 0`, over the whole world, the Commons included |
| Tech gates | counters for roads laid, units built, residents housed, jobs filled; cheap tier-1 nodes need 12-25 residents or 20 roads |

## Timeline (run3, the main playthrough)

Day 0.18 is when the bot joined. Money is at the start of the game day; "tax/day" is the previous day's tax collected on the
player's parcels; speed is the world's average driving speed.

| Day (min) | Money | Pop mine / world | Jobs mine (cap/filled) | Tax/day | built | Speed | Events |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.2 (1) | 15,640 | 0 / 66 | 0 | 0 | 0 | | Buy 16x9 ($1,440), 52 road tiles, zone 96 res lots ($2,400): $4,360 in the first hour. Cranes appear on every lot, nothing is being built. tr1 (Parking lots, $150) ready at once (20 roads) |
| 0.5 (4) | 13,400 | 2 / 130 | 0 | 0 | 0 | | First resident moves in at 13:00, nine game hours (3 min) after the first lot was zoned |
| 1.0 (8) | 13,405 | 11 / 271 | 0 | 0 | 0 | 73% | Housed 12 reached: zon1 ready (d1.03, 9 min). Bot buys it, zones a commercial row |
| 1.1 | 12,509 | | | | 0 | | Own builders' yard placed ($300) after day 1 with 86 sites waiting and no builders on them |
| 1.7 (13) | 9,845 | 38 / 358 | 31 / 31 | 0 | 0 | | civ1 ($400, ready at 20 residents) + police + fire ($800 buildings), cul1 ($400) + library ($450), zon2 ($400): $2.6k out in two game hours |
| 2.0 (16) | 9,754 | 41 / 360 | 31 / 31 | 115 | 0 | 59% | |
| 2.4 (19) | 9,232 | 45 / 370 | 52 / 43 | 115 | 665 | | con1 Masonry ready at 300 built, bought ($500) |
| 2.6 (21) | 4,721 | 67 / 407 | 71 / 80 | 115 | 2,545 | 47% | zon3 ($1,500, ready), cul2 ($1,000), con2 Steel frame ($2,000, ready at 2,000 built). Treasury $4.7k |
| 3.0 (24) | 4,670 | 71 / 410 | 71 / 81 | 277 | 2,814 | 47% | |
| 3.5 (28) | 2,632 | 83 / 426 | 86 / 91 | 277 | 3,853 | | civ2 ($1,200) and civ3 ($900). Treasury $2.6k, nothing left worth buying |
| 4.0 (32) | 2,545 | 123 / 477 | 95 / 104 | 360 | 5,327 | 28% | Net money for the day: -97 (tax in $536 against about $630 out) |
| 6.0 (48) | 2,649 | 224 / 645 | 156 / 156 | 657 | 10,000 | 20% | civ4 ready (250 housed) d6.6; not affordable |
| 8.0 (64) | 3,567 | 339 / 791 | 165 / 165 | 1,021 | 14,708 | 28% | |
| 9.0 (72) | 4,129 | 426 / 903 | 168 / 167 | 917 | 16,105 | 9% | Screen: 187 cars, 82% queued, speed 14% |
| 12.0 (96) | 6,139 | 496 / 1,058 | 162 / 174 | 1,078 | 18,834 | 30% | |
| 15.0 (120) | 8,687 | 561 / 1,220 | 185 / 180 | 1,304 | 22,325 | 22% | 11 of 25 techs bought. Counters: housed 562, jobs 181, built 22,325, roads 104 |

Same moments in the other runs:

| | run2 (Commons' yard only) | run3 (own yard d1.1) | run4 (own yard d1.0, spends harder) |
| --- | --- | --- | --- |
| First resident | day 0, 14:00 (5 min) | day 0, 13:00 (4 min) | day 0, 14:00 (5 min) |
| 12 / 50 / 100 / 250 housed (day) | 2.6 / 6.7 / not by day 9 / - (21 / 54 min) | 1.1 / 2.5 / 3.6 / 6.6 (9 / 20 / 29 / 53 min) | 2.0 / 3.4 / 4.7 / 6.7 (16 / 27 / 37 / 54 min) |
| Population of mine, day 9 | 90 | 426 | 393 |
| `built` counter, day 9 | **0** | 16,105 | 19,980 (then frozen, see caveats) |
| Own jobs, day 9 | 25 (the services) | 168 | 328 |
| Money: min / day 15 | 7,358 (d9) / - | 2,347 (d4) / 8,687 | 551 (d7) / 698 |
| Tax per day, d9 / d15 | 183 / - | 917 / 1,304 | 1,377 / 1,833 |
| Average speed from day 8 | 45% | 25% | 33% |

## Time to first unlock per tier

"Ready" = condition met and prerequisites bought; "bought" = when the bot could afford it (run3 unless marked). A tier is the
node's tier in `shared/src/tech.ts`. Times are game days from world start (min at normal speed).

| Tier | Node (cost): condition | Ready | Bought | Verdict |
| --- | --- | --- | --- | --- |
| 1 | zon1 Commercial ($200): 12 housed | d1.08 (9 min) | d1.12 | Reachable, early. Needs a plot with homes that fill |
| 1 | tr1 Parking lots ($150): 20 roads | d0.21 (2 min) | d0.25 | Trivial: the opening roads meet it. Now also unlocked the motorway (later made tech-free by Gateways 1) |
| 1 | civ1 Emergency ($400): 20 housed | d1.54 (12 min) | d1.58 | Reachable. Buying the stations is the trap (friction 3) |
| 1 | cul1 Libraries ($400): 25 housed | d1.58 (13 min) | d1.62 | Reachable |
| 1 | con1 Masonry ($500): 300 built | d2.38 (19 min) | d2.42 | **Only with your own yard** (run2: never, `built` 0 at day 9) |
| 2 | zon2 Industrial ($400): 30 housed + zon1 | d1.62 (13 min) | d1.67 | Reachable |
| 2 | cul2 Cinemas ($1,000): 60 housed + cul1 | d2.58 (21 min) | d2.62 | Reachable |
| 2 | con2 Steel frame ($2,000): 2,000 built | d2.58 (21 min) | d2.62 | Own yard only |
| 2 | tr2 Signals ($800): 60 roads | d0.25 (2 min) | d9.12 (run4) | Gate is trivial, cost is the barrier; signals only help crossroads inside your own parcels |
| 2 | civ2 Healthcare ($1,200): 80 housed | d3.38 (27 min) | d3.42 | Reachable |
| 3 | zon3 Office ($1,500): 60 jobs filled + con1 | d2.54 (20 min) | d2.58 | Reachable (the staff of your own police, fire and library count as jobs filled) |
| 3 | con3 Deep foundations ($2,500): 4,000 built | d3.50 (28 min) | d3.67 (run4) | Own yard only; money is the limit |
| 3 | civ3 Patrols ($900): 40 jobs filled | d3.42 (27 min) | d3.46 | Reachable |
| 3 | cul3 Theatre ($1,800): 80 jobs filled | d2.62 (21 min) | d13.0 (run4) | Money |
| 3 | tr3 Public works ($1,000): 100 roads + tr2 | d9.12 in run4 (the roads were there at once) | d10.75 | Gated behind buying tr2 first |
| 4 | civ4 Regional ($2,500): 250 housed | d6.58 (53 min) | not bought | Money |
| 4 | con4 Industrialised ($5,000): 12,000 built | d6.46 (52 min, run4) | no | Money |
| 4 | cul4 Big nights ($3,000): 300 housed | d13.0 (104 min, run4) | no | Money |
| 4 | tr4 Aviation ($6,000): 150 jobs + tr3 | d10.75 (86 min, run4) | no | Money |
| 5 | con5 High-rise ($6,000): 8,000 built + con3 | d4.62 (37 min, run4) | no | Ready this early; money only. Unlocks the level 4-7 merged towers |
| 5 | tr5 Public transport ($1,500): 80 roads + tr2 | d9.12 (73 min, run4) | d11.88 | Money / gated behind tr2 |
| 5 | civ5 Metropolitan: 600 housed | not reached (562) | - | Population |
| 5 | cul5 Landmarks: 500 jobs | not reached | - | Jobs |
| 6 | tr6 Rail ($4,000): 200 jobs + tr5 | d11.88 (95 min, run4) | no | Money |
| 6 | civ6 Medical school: 600 jobs | not reached | - | Jobs |

Reading it: **conditions are never the gate on tiers 1-3** (all ready by minute 30 with an own yard); from tier 3 on the gate
is money, and the whole tier 1-3 shopping list costs about $14,750 against a $20,000 start that also has to buy land, roads and
zoning ($4.4k for the opening plot). The `roads` conditions (20 / 60 / 100 / 80) are met by the opening road layout, so they
gate nothing and cost the player an unneeded decision. The `built` track is the odd one out: it advances only through the
player's own yard (friction 1).

## Ranked friction list

Most damaging first. Tags: [pacing] numbers and rules, [onboarding] goals and advisor hints, [ui] missing or misleading
feedback.

### 1. The Commons' single yard starves a new player, and `built` is silently unreachable without one's own [pacing] [onboarding]

- Evidence: run2 never placed a yard. At day 9 (72 min) the player had 90 residents against 426 in run3, `built` was 0 (the
  tech panel shows `0 / 300 units of construction work completed by your builders` for Masonry with no hint that it means
  *your own* yard's builders), the Commons held about 157 construction sites at once (about 120 at day 0.8), and the player's own 78-92 sites sat
  with `builders: 0` for two days (inspect of a lot: `construction {done 0, total 60, builders 0}`). The Commons has one yard of
  ten builders on two overlapping day shifts. In run3 the own yard went down at day 1.1 and `built` was 665 by day 2.4, Masonry
  at 19 min, Steel frame at 21 min, 22,325 by day 15.
- The only prompt is the toast "Nothing gets built without builders: place a builders' yard…", and it fires only when no yard
  exists anywhere in the world (`anyYard()` in `net.ts`), which is never true next to the Commons.
- The cranes on 96 lots with no workers (screenshot `run2-d0.png`) read as "broken" for the first game day.
- Fix [onboarding]: advisor hint when your sites exceed ~20 and none of your own builders is on them ("The Commons' builders
  serve their own city first. Place a builders' yard, $300 pays for itself"), and make "place a yard" an early goal.
- Fix [pacing]: credit `built` to the site's owner as well as the yard's, or hand every new player a starter yard; consider
  a second Commons yard or fewer Commons sites at world start (about 120 sites queue before the player's first).
- Fix [ui]: rename the counter to say whose builders ("your own builders' yard") and show the player's yard count.

### 2. The cash cliff after the opening, with no ledger to see it coming [pacing] [ui]

- Evidence (run3): $20,000 at the start, $9,754 at day 2 (16 min), $4,721 at day 2.6 (21 min), $2,545 at day 4 (32 min), and
  net -97 that day. In run4, $551 at day 7 with a stream of $400-$1,500 techs left unbought. After day 4 income is around
  $100-$500 a day, so every tier-3+ node ($1,500-$6,000) is 5-20 game days away: the money-wait is the whole mid-game.
- The first services are the trap. Police + fire + library cost $1,250 and then about $400 a day (staff wages are paid from
  the treasury: 12 + 9 + 4 workers, plus upkeep) against $115-$360 a day of tax in days 2-4. They are 2/3 of the running
  costs on day 4 (about $630 out, $536 in). The tech blurb sells them as "covered homes … grow faster" (growth x1.2 per
  service in reach), and the buildings' staff count as jobs filled, which is what zon3/civ3/cul3 ask for, so a sensible player
  buys them. Smaller kinds exist (police box $150 with 3 staff, fire post $220 with 4) but nothing steers a player to them.
- The top bar shows the treasury only. There is no income / expense / net per day anywhere (the parcel panel shows tax
  collected today and yesterday, never what was paid out), so the player cannot tell the -97 a day from the +$400 a day.
- Nothing stops a negative treasury either: by the code money just goes below zero and building fails with "Not enough money" (no run got there).
- Fix [ui]: a daily ledger in the money chip tooltip or panel (tax in, wages, upkeep, builders' fees, net, days of cash left)
  and a red chip when net is negative.
- Fix [pacing]: stage civ1 as posts first (cheap, 3-4 staff) and gate the full stations behind more housed; discount or
  subsidise the first police and fire; or pay civic wages from the first N residents' tax rather than all from cash.
  Re-balance the tier 1-3 list ($14.75k) against income: a mid-sized plot earns about $1,100 a day at 590 residents, so
  tiers 3+ cost 2-6 days of the whole income each.

### 3. The city jams before the player can do anything about it [pacing]

- Evidence: average speed 20-45% by day 5-6, 9-14% at day 9-10 in runs 2 and 3 ("187 cars, 82% queued, speed 14%" at day 10,
  run3 screenshot `run3-d9.png`), with only 561 of the 1,220 residents the player's. In run2 the jam appears at day 9 with the
  player holding just 90 residents, so it is the Commons' own grid (a 22x22 block with about 330 residents on day 3, 430 on day 9) that
  fills up. Sampled residents at day 16 (run3) show happiness 44 on average, with "long commute (68-176
  min)" as the biggest malus (-10 to -15) in 9 of 10, then "nothing to do" and "stuck in traffic".
- The top-bar `queued` and `speed` figures turn red from day 5 and stay red; the player's available tools (tr2 signals $800 for
  crossroads inside their parcels, tr5 buses $1,500, parking) are not suggested, and the only road in the Commons is public.
- Fix [pacing]: cap or slow Commons growth so the Commons does not outrun the player's tools (the Commons grows on its own from day 0), or ship its roads with signals; unlock tr2 on a congestion trigger rather than on 60
  road tiles.
- Fix [onboarding]: advisor hint when queued > 50% for a game day ("Traffic is jammed: signals (T), a bus line, or more jobs
  near the homes").
- The jobs / homes balance contributes: run3's housing plot holds 591 residents and 0 jobs, the jobs plot 185; every resident
  commutes into the Commons or across the plot. Plot A paid $1,124 a day in tax at the end, plot B $330.

### 4. Silent dead ends when land is bought away from the Commons [onboarding] [ui]

- The README says the first parcel can go anywhere. Probe ("Lost"): bought 8x8 at (60,60) for $640, zoned a row residential,
  waited 0.4 days: no toast, no sites (a zoned lot with no road next to it never grows, `growth()` ignores it), no way
  to tell. Laid a road inside the plot: sites appeared (7 of them) and stayed at `builders: 0` for 0.5 days with no message
  either. A road across unclaimed land to the Commons needs Public works (tr3), which needs signals first (tr2), $1,800 and 100
  road tiles ("Public works is needed to lay roads outside your own land"); a second plot must share an edge, so the player
  cannot even buy a bridge. That player is stranded at about $19,000 with no way forward that the game names.
- Fix [onboarding]: hint when the first parcel is not within a few tiles of the Commons or a road ("Buy next to the Commons'
  edge road to connect"); a warning in the buy preview for plots not touching any road.
- Fix [ui]: a persistent "no road / no builders can reach these lots" overlay on zoned lots that will never grow.

### 5. No goals, no next-step guidance anywhere [onboarding]

- The login card ("Buy land, zone it, lay roads. Your citizens will go wherever the jobs are…") and the bottom key list are
  the whole onboarding. After joining there is no prompt; the tech chip does not light when a node becomes ready (the tree is
  closed by default and a ready node is only a yellow border inside it: `ui.ts` `showTech`); toasts last four seconds.
- The "Newcomers are moving straight into your homes: a motorway connection (Transport) or a station…" notice repeats
  every game day from day 0.5 for the whole run in all runs (about 15 identical toasts). It names a motorway connection that
  is hidden behind Parking lots: building it without tr1 says "Parking lots is needed before you can build that", which is not
  a sentence anyone would connect with a motorway. With tr1, the motorway placed cleanly ($400, $6 a day, done in under a day).
  I did not measure what it changes for the player's growth.
- Tool lock tooltips do name the tier ("Needs Commercial zoning (press T…)") and the Unlock button says "Not enough money": those are good.
- Fix [onboarding]: see the goal chain below; at minimum a "next step" strip and a ping on the tech chip when a node becomes
  affordable.

### 6. Zoning silently erases roads and buildings [ui]

- Verified: dragging Residential over a 3x3 that included a road row turned the three road tiles into zone tiles ($25 each, no
  confirmation, no toast); zoning a row that held the player's own builders' yard replaced the yard (an aborted first attempt at run4:
  jobs 10/10 -> 0/0 the hour the row was zoned). Zoning across a connector road cut a service row and both yards off from the
  road network in run4: `built` froze and 70 jobs went unfilled for six days with no message.
- Fix [ui]: zone tools skip road tiles and non-zone buildings (or confirm), and a toast when a change disconnects a yard or a
  parcel from the network.

### 7. Income is thin and surprising: the model rewards housing, not jobs [pacing] [ui]

- Wage tax goes to the workplace's owner, so a player whose homes are full while the jobs are in the Commons collects only
  property tax: $4 per resident per day at 10% (observed $1.9 per resident because not everyone is counted every day). The
  jobs plot earned $330 a day on 185 jobs (about $1.8 a job), no better than a home. The Commons' own 400-odd workers' wage
  tax is the Commons', not the player's.
- Raising the tax rate is the biggest lever (slider in the parcel panel, "above ~20% people start leaving") but nothing says
  so, and I did not test it in a run.
- Fix [onboarding]: a hint on the first negative-net day naming the three levers (tax slider, more homes, cheaper services).
- Fix [pacing]: consider a small per-job income (sales tax share) so jobs in your parcels pay more than the wage tax alone.

### 8. The tech panel's conditions are mostly trivial or opaque [pacing] [ui]

- Roads laid (tr1-tr3, tr5) and residents housed 12-60 are met within the first game day by any plan that lays any roads at
  all: the tree opens by itself, which is good for pace and poor as guidance (what should I do next?). tr3 / tr5 are gated
  by a purchase (tr2, $800) that returns nothing at that stage.
- "units of construction work completed by your builders" (see 1), and "jobs filled in your parcels at once" counts the
  staff of your own civic buildings, which is how a player on $2k meets Office zoning (60 jobs): by building services.
- Fix [ui]: a one-line "why not yet" under each locked node that names the single next action ("place a builders' yard"
  rather than a counter), and a toast at the moment of becoming ready.

### 9. Idle stretches [pacing]

- First hour: nothing to do between the opening and the first residents (day 0.25 to 1.12, 7 min at normal speed in run3).
  Cranes with no workers (friction 1) make it worse.
- Mid game: run3 has no action after day 3.5 (artefact of its throttle, see caveats); run4 (the "spend everything" player) shows
  the real shape: 26 action-hours in 15 days, gaps of 2 days (d4.6 to 6.6, d6.8 to 8.7) with $600-$1,800 in hand and every next
  node costing $1,500+.
- Fix [pacing]: goal rewards in cash and an early cheap sink (parks $120 are free-tech and add leisure coverage: 5 of 10 sampled
  citizens carried "nothing to do" -6) so there is something to do on $700.

### 10. Joining at night is a black screen [ui]

- First-ever frame of the probe at 18:48 (`shots/test.png`): the Commons is a faint skyline on a black field, the player's
  plot invisible, with the "live light" chip as the only cue. About a third of joins land at night.
- Fix [ui]: start in fixed daylight for a new player's first minutes (chip already offers it).

### Smaller observations

- con5 High-rise ($6,000, ready at day 4.6 in run4) is the node that opens the level 4-7 merged buildings: ready early, but the
  money is gone by then. I did not check what height the player's lots reached.
- At day 15 the player has 11 of 25 techs; nothing in tiers 5-6 is reachable inside two hours except tr5/tr6/con5 on cash.

## Proposed goal chain for the first session (10 goals)

Targets use the run3 curve (minutes at normal speed). Rewards are cash grants or free unlocks sized to the cliff in friction 2.
Each goal is checkable server-side from the counters the tech tree already reads.

1. **Claim your plot** (min 0-2): buy at least 8x8 touching the Commons. *Reward: none; the hint names the Commons' edge road.*
2. **Link it and zone homes** (min 2-4): lay a road from the plot to the Commons and zone 24 residential lots beside it.
   *Reward: $300; Parking lots (tr1) ready.*
3. **Get builders** (min 5-8): place your own builders' yard ($300). *Reward: refund of the $300 and a note about Masonry.*
4. **First 12 residents** (min ~9): housed 12. *Reward: Commercial zoning free ($200 saved).*
5. **Open a shop** (min ~12): zone 8 commercial lots and fill 6 jobs. *Reward: $400.*
6. **Balance the books** (min ~20): finish a game day with net >= 0 and 40 residents. *Reward: $500; teaches the ledger.*
7. **Light cover** (min ~25): place a police box and a fire post (cheap, 7 staff) instead of full stations. *Reward: half the
   Emergency services price back.*
8. **Masonry** (min ~20-30): unlock it (300 units built) and watch the first level-2 home. *Reward: $500.*
9. **Fix the commute** (min ~45): bring the world's average speed above 40% or queued under 40% (signals, a park for leisure, a
   bus line or a second node of jobs near the homes). *Reward: Traffic signals free.*
10. **100 residents with jobs for half of them in your own parcels** (min ~30-60): *Reward: $600 and Industrial zoning ready.*
11. **250 residents**: Regional services ready, buy a second plot. *Reward: $1,000.* (optional, hour 2)

## Proposed advisor hints (for the onboarding card)

Triggered once, dismissible, shown as a strip rather than a four-second toast; each names the next action.

| Trigger | Hint |
| --- | --- |
| Own sites > 20 and none have builders from your yard | "Your lots are waiting: the Commons' builders serve the Commons first. Place a builders' yard." |
| `built` is 0 and Masonry would be next | "Masonry counts work done by your own builders; place a yard to start the count." |
| A tech became ready and affordable | Pulse the tech chip with the node's name. |
| Net money < 0 two days in a row | "You are spending more than you earn: wages for staff are paid from your treasury. Raise the tax slider, add homes, or hold off on services." |
| Treasury under $1,000 and a build refused | List what is draining it (top three lines of the ledger). |
| Zoned lots with no road access or no builders able to reach them | "These lots will never grow: no road reaches them." |
| Zone drag would cover a road or a building | Confirm, or skip them. |
| Queued > 50% for a game day | "Traffic is jammed: signals (T), a bus line, or more jobs near the homes." |
| Newcomers notice | Name Parking lots (T) for the motorway connection, once, with the tool highlighted. |
| First park, library or cinema unlocked and "nothing to do" is the top malus | "Residents are bored: a park costs $120." |

## Follow-up card inputs in one place

- **Economy and tech pacing (hours 0-2)**: friction 1 (builders / `built` ownership), 2 (service wages, tier 1-3 cost vs income),
  3 (Commons-driven jam before player tools), 7 (jobs pay little), 8 (trivial road gates). Numbers: $20,000 start,
  $4.4k opening, $14.75k tier 1-3 list, $4 per resident per day, $400 a day for a first service set, tax $115 (day 2) to
  $1,300 (day 15), Commons jams at about 430-500 residents.
- **Onboarding goals and advisor hints**: frictions 4, 5, 6, 9, 10, the goal chain and the hint table above.

## After Gauntlet 3

Card ae446084 (economy and tech pacing for hours 0-2). What changed, then the same playthrough before and after.

### Changes

| Area | Change | Why |
| --- | --- | --- |
| `built` counter | Work on a site now counts for the **site's owner** as well as the yard's owner (`sim/simulation.ts` workSite) | Friction 1: a player relying on the Commons' builders sat at `built` 0 for ever, Masonry unreachable with no hint why |
| Starter yard | A player's **first** builders' yard opens at once (`net.ts` build); later ones are still sites at urgent priority | The first yard had to wait for the Commons' saturated builders, then for its own crew's next shift: a full game day of cranes with nobody on them |
| Builder hint | Once a game hour, an owner with 8+ lots that no builder is on hears why, at most once a game day: no yard of their own (the Commons' yard works its own streets first), or a yard but nothing built on their land for a day (no road links it) (`net.ts` builderHints) | Friction 1 and 6: the only prompt fired when no yard existed anywhere, never true next to the Commons |
| Public payroll | `ECONOMY_TUNING.civicPayroll = 0.5` (`shared/src/tuning.ts`): the treasury pays half of public-service staff wages (police, fire, health, builders' yards), a regional grant the rest; libraries and other leisure venues still pay staff from their takings | Friction 2: police and fire stations and a yard cost about $400 a day of wages against $115-$360 of tax on days 2-4, the whole cash cliff. Now $140-$220 a day of wages in the after runs |
| Tech costs | zon2 400→300, zon3 1500→1000, con2 2000→1200, con3 2500→1500, con4 5000→3500, con5 6000→4000, tr2 800→500, tr3 1000→700, tr4 6000→4500, tr5 1500→1000, tr6 4000→3000, civ2 1200→800, civ3 900→700, civ4 2500→1800, civ5 5000→4000, cul2 1000→700, cul3 1800→1200, cul4 3000→2200, cul5 7000→5000 (tier 1 and civ6 unchanged) | Tiers 1-3 cost $14,750 against a $20,000 start that also buys the opening ($4.4k); now $10,350, so after the opening a node is about a day of tax away rather than five |
| Tech conditions | tr2 roads 60→**housed 100**, tr3 roads 100→**housed 150**, tr5 roads 80→**housed 200**; zon2 housed 30→40, zon3 jobs 60→80, con2 built 2000→2500, con3 4000→5000, con5 8000→10000, tr4 jobs 150→200, tr6 jobs 200→250, civ2 housed 80→100, civ3 jobs 40→60, civ4 housed 250→300, cul2 housed 60→70, cul3 jobs 80→100, cul4 housed 300→350. tr1 (Parking lots, roads 20) unchanged: it carries the motorway | Friction 8: the road counts were met by any opening layout and gated nothing; transport now opens as the traffic it fixes arrives, and the cheaper nodes ask a little more play so conditions, not cash, pace tiers 2-4 |
| Ledger | `World.credit` takes a category (tax, fees, wages, upkeep, builders, build, land, tech, other) and keeps today's and yesterday's totals per player (`Player.ledger`, saved, absent in old saves). `PlayerDTO.ledger` rides on the players message once a game hour (and in welcome). The treasury chip shows yesterday's net (red when negative) and, on click, the ledger by category with income, spending, net and, when running costs exceed taxes and fees, the days of cash left | Friction 2: nothing showed income against spending |
| Zoning | Zone tools and parking lots skip road tiles and anything built (buildings, sites, parking, bus stops, structure tiles), with one toast counting what was left; single-tile civic placement refuses road tiles and built lots. A toast names newly zoned lots with no road beside them | Friction 6: zoning silently paved over roads (in the audit's own bot layout too: its west connector) and replaced the player's yard |
| Dead ends | A first parcel with no road inside or touching it gets a toast saying lots grow only beside a reachable road and how to get one (extend the land to a road, or Public works); a non-adjacent later purchase already showed "New land must border land you already own" | Friction 4 |
| Night | Night hemisphere floor raised (sky 0x1a2340→0x34467a, ground 0x0d1018→0x1c2233, intensity 0.65→2.6 at full night, 1.05 by day as before) and moonlight 0.75→1.3 (`client/src/render/lighting.ts`); joining at night shows a one-time hint about the light chip. Toasts now stay up `max(4 s, 55 ms per character)` | Friction 10: empty land was black at night, so a new player could not see where to buy |

The ECON env var (`ECON=civicPayroll=0.6,...`) overrides ECONOMY_TUNING for offline runs (`server/src/index.ts`).

### Before and after

Same bot (`play.mts`, copied to `scratchpad/g3/` with a PORT variable, the ledger recorded per hour, and one behaviour
change: the bot places its yard when the builder hint tells it to, as a reader of the toast would; with no hint it still
waits a day). Fresh worlds, isolated servers at SIM_STEPS=10, all joined at about 09:00 on day 0. B = the sensible
player (run3's settings), C = spends everything (MORE_TECH=1 YARD2=1 SITES_CAP=80, run4's settings), A = never places a
yard (NOYARD, to day 9). beforeA/beforeB ran on the tree just before these changes; the C baseline is the audit's run4
(same bot, joined at 04:00, and its bot cut its own road at day 9, which froze `built`). One run each, so population
figures carry a lot of noise (world seed and join hour move the first resident by up to a game day). Minutes are at
normal speed from world start.

| | before B | after B | before C (run4) | after C | before A | after A |
|---|---|---|---|---|---|---|
| money d2 (16 min) | $13,054 | $10,118 | $13,013 | $12,890 | $13,430 | $13,496 |
| money d4 (32 min) | $7,167 | $7,903 | $2,021 | $6,727 | $13,329 | $12,860 |
| money d7 (56 min) | $2,414 | $6,009 | $625 | $714 | $10,149 | $10,206 |
| money d10 (80 min) | $3,346 | $7,296 | $1,134 | $1,876 | $8,803 | $8,407 |
| money d15 (120 min) | $6,459 | $11,363 | $698 | $2,619 | - | - |
| lowest money | $2,296 (d6.7) | $5,755 (d5.7) | $551 (d7.7) | $614 (d12.6) | $8,803 | $8,345 |
| pop (mine) at 10 / 30 / 60 / 120 min | 0 / 51 / 152 / 547 | 0 / 72 / 151 / 509 | 4 / 64 / 301 / 487 | 0 / 54 / 274 / 698 | 0 / 8 / 31 / - | 0 / 12 / 34 / - |
| 12 / 50 / 100 / 250 housed (min) | 21 / 30 / 45 / 69 | 13 / 20 / 45 / 70 | 16 / 27 / 37 / 54 | 21 / 29 / 37 / 52 | 52 / 69 / - / - | 22 / 70 / - / - |
| tier 1 ready / bought (min) | 4 / 4 | 3 / 4 | 2 / 2 | 3 / 3 | 4 / 4 | 3 / 3 |
| tier 2 ready / bought | 4 / 22 | 19 / 20 | 2 / 21 | 21 / 21 | 4 / 56 | 68 / 68 |
| tier 3 ready / bought | 36 / 37 | 28 / 37 | 29 / 29 | 29 / 29 | - | - |
| tier 4 ready / bought | 69 / - | 84 / - | 52 / - | 44 / 86 | - | - |
| tier 5 ready / bought | - | - | 37 / 95 | 43 / 71 | - | - |
| tier 6 ready / bought | - | - | 95 / - | 71 / - | - | - |
| Masonry (con1) ready | 20 min | 11 min | 19 min | 11 min | never | 45 min |
| techs bought by the end | 11 | 11 | 16 | 17 | 6 | 7 |
| `built` at the end | 22,023 | 23,943 | 19,980 | 35,820 | 0 | 2,953 |
| own jobs at the end (cap/filled) | 175/169 | 158/156 | 328/256 | 576/444 | 25/2 | 43/22 |
| tax a day at the end | $1,149 | $1,262 | $1,833 | $1,742 | $160 | $226 |
| longest gap between actions | 9 min | 10 min | 16 min | 15 min | 8 min | 23 min |

Tier 2 "ready" moved later on purpose: before, tr2 (signals) was ready at minute 4 because the opening roads met its
condition; now the first tier-2 node is ready when the residents are (zon2, con2 at about 20 min).

The ledger (after B, yesterday's figures): day 4 tax $303 against upkeep $120 and wages $136 (running net +$47; the audit's
run3 was -$97 that day); day 7 +$127, day 10 +$577, day 14 +$749 with nothing left that this bot buys. After C, which buys
every ready node down to its $700 floor, runs net positive on running costs from day 3 and spends the rest: tax $1,100-1,600 a
day from day 8 against $400-$430 of upkeep and wages, so a $1,000-$1,800 node is one to two game days (8-15 min) away; the
gaps over 10 min (d8.9-10.8, d10.8-12.6) are its tier 4-6 nodes ($1,800-$4,500) with $400 zoning steps a real player would
fill them with.

### What is still open

- The first game day: joining mid-morning, a starter yard's crew is hired at once but starts with the next day shift, so
  the first resident still arrives about 12 min in (before 13). Rewards and next-step goals for that stretch belong to
  the onboarding card, as do turning the builder hint and the night hint into persistent strips.
- A player who never places a yard (after A) still grows slowly (12 residents at 22 min, 34 at an hour): the Commons' yard is
  saturated by its own streets. They are told so every game day; whether to also give the Commons a second yard is open.
- For the gateways agent: the motorway connection is still behind Parking lots (tr1) with the "Parking lots is needed" lock
  message, and the "Newcomers are moving straight into your homes" notice still repeats every game day in every run.

## Onboarding

Card f8657f8b (Gauntlet 2): the goal chain and hint table above, built. Code in `shared/src/goals.ts` (definitions,
hint copy), `server/src/goals.ts` (measuring, rewards, server-side hints) and `client/src/onboarding.ts` (card, hint
strip, celebration, tech chip); hooks in `server/src/net.ts`, `client/src/main.ts` and `ui.ts` (night hint).

### What was built

- **13 goals**, one active with the next two previewed, measured server-side every quarter game hour from the player's
  parcels, buildings and the tech tree's counters; saved with the player (`Player.onboarding`, optional, so old saves load;
  a returning player's already-met goals are marked done without a reward). Changes from the proposal: "Link it and zone
  homes" is split into a street (12 road tiles) and homes (24 residential lots beside a road); the yard is goal 4, before
  any resident; "Fix the commute" was dropped (the jam is mostly the Commons', not something a player at minute 45 can
  fix) for "Somewhere to go" (a park, $120, no tech) and a closing "First bus line"; "100 residents with half the jobs at
  home" became "A real town" (250). Rewards: $100, $200, $300 (the yard back), Commercial zoning free, $300, $250, $300,
  $200, $150, $300, $500, $400: about $3,000 plus zon1 over two hours, against $10-15k of tax in the same time.
- **Card** beside the tool bar: goal n of 13, how, why, a progress bar per part, the reward, "show me" (picks the tool and
  flashes its button, opens the tech tree / ledger / lines panel, pans to the plot or the open land beside the Commons) and
  "skip the tutorial" (saved per player; the `goals` chip in the top bar hides the card or resumes after a skip). It steps
  aside while a citizen panel or the tech tree is open. Completion toasts pick their opener and closer per goal and day
  ("Done and dusted!", "That's the way!" … "Next up: …") with a slight per-toast tilt. Test cities and demos get no goals.
- **Hints** as a strip under the card ("show me", "got it" = never again, × = later; it also goes after 90 s): at most one
  per two game hours on the client; the server repeats an undismissed alert at most daily and a tip every three days.
  Alerts (shown even after a skip): builders (the Gauntlet 3 builder toasts, now hints), deficit (two days in a row of
  running costs over taxes and fees), jam (world queued share over 50% averaged over the last 24 game hours, player with
  30+ residents), broke (client: a build refused under $1,000, naming yesterday's three biggest costs). Tips: newcomers
  (the gateway notice, now naming Parking lots for the motorway), bored (60+ residents, no park or venue), night (the
  Gauntlet 3 night toast). A hint that says what the active goal says (builders while "Hire your own builders" is active,
  bored / "Somewhere to go", deficit / "Balance the books") stays quiet.
- **Tech chip** pulses with the node's name ("tech · Parking lots", or "3 ready") when a node becomes affordable and
  available; it stops when the tree is opened.
- Not built from the hint table: the "`built` is 0, Masonry next" hint (Gauntlet 3 credits site owners, so it no longer
  happens), the "lots with no road" and "zone drag over a road" rows (Gauntlet 3's zoning toasts already cover them).

### When each goal completes

Same bot as "After Gauntlet 3" (`scratchpad/onboarding/play.mts`), fresh worlds with the same seed, SIM_STEPS=10, joined at
about 05:00 on day 0. B = the sensible player (places the yard when the builder hint says so). F = the same player following
the goals: yard as soon as it is the goal, police box and fire post instead of stations, a park when it is the goal,
signals and Public transport bought. Minutes at normal speed after joining.

| goal | B | F |
|---|---|---|
| Claim your plot / Lay a street / Zone homes | 0.1 / 0.2 / 0.4 | 0.1 / 0.2 / 0.4 |
| Hire your own builders | 1.4 | 0.9 |
| First residents (12) | 10.9 | 11.2 |
| Open the shops | 18.1 | 18.1 |
| Masonry | 18.2 | 18.2 |
| A growing town (50) | 19.4 | 22.6 |
| Police and fire cover | 19.6 | 22.7 |
| Somewhere to go | 19.7 | 22.9 |
| Balance the books | 22.2 | 23.1 |
| A real town (250) | 53.1 | 77.9 |
| First bus line | - | - (see below) |

- The opening four goals fall in the first minute for anyone who follows them; then the card waits on residents for about
  ten minutes, which is the idle stretch friction 9 describes (the card at least says what is happening and why).
- Goals 7-11 bunch at minutes 18-23 because the bot had already done them by the time each became active; a player led
  by the card meets them one after another, so the bunching is the bot's.
- Money with the rewards: B $11,795 / $9,300 / $9,104 / $10,932 / $15,879 at days 2 / 4 / 7 / 10 / 15 (lowest $8,031 at
  day 4.7) against after-B's $10,118 / $7,903 / $6,009 / $7,296 / $11,363 (lowest $5,755): the rewards lift the floor by
  about $2,000 and leave the curve's shape alone. B ends with 11 techs and 657 residents (after-B: 11 and 509, within
  the run-to-run noise).
- F's bus line was never saved: on the bot's comb of dead-end streets every pair of stops gets "No way for a bus … without
  turning round in the road". The goal's own check (a line of yours with two or more stops) was verified offline instead
  (`scratchpad/onboarding/unit.mts`: completes once, pays $400, the chain then ends). Since fixed (2026-10-17, docs/transit.md "The lap"):
  buses turn round at dead ends and in junction mouths, and in a copy of F's world the three lines it tried save and the
  goal completes.
- Hints heard over 15 days: B builders 1, jam 9, newcomers 8; F jam 10, newcomers 9 (the bot never presses "got it"; tips
  now repeat every three days rather than daily, so newcomers would come about 5 times).

### Still open

- The jam alert fires daily from day 5 in both runs, and the jam is mostly the Commons' grid: a player can only add
  signals or buses on their own land. Worth a look with the gateways/junctions work.
- The newcomers notice still comes from `sim/simulation.ts` (gateways agent); net.ts recognises it by its first words to
  turn it into a hint. A notice id from the simulation would be sturdier.

## After Audit #1: the first five minutes

The open item above ("the first resident still arrives about 12 min in") is closed by docs/first-five.md: a pioneer
camp whose eight settlers come up the road within the game hour, a starter yard that hires them on the spot and sends
them out now, a first house at 20 units of work, a first-settlers camera moment, and a 14-goal chain. With the same bot
the first resident comes at 0.8 minutes at any join hour and twelve live in proper homes by minute 3-7; the measured
tables are there.
## After Audit #5

Card d7aaefba (`docs/audit-2026-10.md` section 8 card 5, `docs/start-from-zero.md` B3): money that can run out. Code in
`server/src/sim/finance.ts` (interest, the count of midnights, administration, the recovery plan, `adminRefusal`), hooks in
`world.ts` (`spendable`, `shortOf`, `payrollShare`, `mothballed`, `PlayerDTO.fin`), `net.ts` (the refusals, the `recover`
intent, the building panel's mothball flags), `game.ts` (one `finance.tick()` per tick), `snapshot.ts` (mothballed doors)
and two one-line checks in `sim/simulation.ts` (no upkeep, no hiring at a mothballed building); the client's chip and
panel in `client/src/finance.ts`, the ledger's interest line and note in `ui.ts`. `npm run finance:check` drives every rule
over a fake client (43 checks).

### The rules and the numbers (`ECONOMY_TUNING`)

| | value | what it does |
| --- | --- | --- |
| `overdraftLimit` | $5,000 | spending may take the treasury down to -$5,000; anything further is refused with the limit named ("Need $9,000 for that land: with the $5,000 overdraft limit you can spend $4,100"). Running costs and interest can still go past it |
| `overdraftInterestPerDay` | 2% | of the negative balance, charged at midnight through `World.credit(…, 'interest')`, the ledger's "Overdraft interest" line |
| `adminAfterDays` | 3 | midnights in a row below zero before administration (`Player.adminDays`, `Player.admin = { since }`, both optional and saved; no snapshot version bump) |
| `recoveryTaxRate` | 20% | "Raise tax": every parcel of the player's below it is set to it (above 20% workers start to quit) |
| `landBuyback` | 80% | "Sell land back": parcels holding no building, site, structure or civic kind go back at 80% of $10 a tile through the ledger's land line; their roads are taken up and the tiles unclaimed |

In administration every build, buy, zone, road, track, unlock, policy and line intent is refused ("In administration:
laying roads is stopped until a midnight finds the treasury at zero or above…"); bulldozing, parcel settings, build
priorities and the recovery plan still work. The regional grant is withdrawn: the owner pays all of the civic payroll
instead of `civicPayroll` (half). It ends at the first midnight with the treasury at zero or above. "Mothball services"
closes the player's police, fire and health services (staff let go, no hiring, no upkeep, no payroll, no cover: coverage
counts only staffed stations); a building's panel mothballs or reopens one, builders' yards included. Hints: the
`deficit` hint names the overdraft, `overdraft` at the first midnight below zero names the three levers, `admin` on entry.
The panel opens by itself when administration begins; in local mode it offers "Start again from the last autosave".
Sandboxes never enter administration and the Commons pays no interest. Client previews (the buy rectangle, the tech and
policy buttons) count the overdraft as money and say "In administration" while it lasts.

### Bot runs

Same bot as "Onboarding" (`scratchpad/onboarding/play.mts`), copied to `scratchpad/audit-money/` with: the recovery plan
(in administration it presses `tax`, `sell` and `mothball` once; it reopens mothballed services once the treasury is over
$3,000), `OD=1` (its spending rules count the $5,000 overdraft as money: a player who really spends everything),
`START=n` (the dev `money` action, now with an `amount`, sets the opening treasury on a non-production server), and the
yard also placed when the goal card's active goal is "Hire your own builders" (one C run without it never placed a yard:
the builder hint it waits for had gone out before it looked, and the Commons' builders had touched its land, so its
fallback rule never fired). Fresh worlds, seed 424242, SIM_STEPS=10, an isolated server on :8085 from the card's worktree,
15 game days, joined at about 01:40 on day 0. B = the sensible player, C = spends everything (MORE_TECH=1 YARD2=1
SITES_CAP=80).

| | B | C | C from $6,000 (`START=6000`) | C on the overdraft (`OD=1`) |
|---|---|---|---|---|
| money d2 / d4 / d7 / d10 / d15 | 9,344 / 7,954 / 8,842 / 11,047 / 15,508 | 13,332 / 10,198 / 641 / 1,610 / 2,113 | 1,838 / 1,786 / 695 / 1,084 / 750 | 11,341 / 6,240 / -3,946 / -968 / 6,372 |
| lowest money | $7,865 (d3.7) | $599 (d6.8) | $596 (d10.6) | -$3,946 (d7.0) |
| game hours below zero | 0 | 0 | 0 | 105 |
| administration | never | never | never | once: d9.00 to d11.00 (2 days) |
| overdraft interest paid | $0 | $0 | $0 | $221 (d7 $77, d8 $70, d9 $55, d10 $19) |
| residents at the end / techs | 542 / 11 | 597 / 18 | 262 / 9 | 675 / 18 |

- C as written never goes below zero, from $20,000 or from $6,000: its rules keep $500 to $1,500 in hand, so it floors at
  about $600 and only grows more slowly from the lower start. The meaningful test is `OD=1`.
- C on the overdraft: it spends the line on Technology (tier 3-5 nodes, $5,500 on day 4 and $2,200 on day 6), a third
  block of land and its zoning, goes below zero at d6 15:00 (-$3,557 at 18:00, -$3,946 after the d7 midnight's interest),
  hears the overdraft hint at d7.00 and enters administration at the third midnight (d9.00, -$2,813). It presses
  the plan: tax 10% to 20% on 3 parcels (yesterday's taxes $878 → $1,115 → $2,037 → $2,474 over the next three days, the
  rate and growth together), sell back (nothing: every parcel has something on it), mothball the police and fire stations
  (about $420 a day saved with the grant gone; wages $310 → $153 a day, upkeep $161 → $121). The treasury is above zero at
  d10.7 and administration ends at the d11 midnight ($1,357): **2 game days**. It reopens the services at d14.0 with $3,252
  and does not enter administration again (it dips below zero twice for a few hours, d11 01:00-05:00 and d12 18:00, buying a
  node and a block, with no midnight in between).
- B never goes below zero (lowest $7,865 at d3.7, after its tier-2 nodes; a second run before the yard rule above: $7,728).

Screenshots (`scratchpad/audit-money/shots/`): the administration panel before and after pressing the plan
(`01-admin-panel.png`, `02-admin-panel-crop.png`, `08-after-plan-crop.png`), the top-bar chip (`03-topbar.png`), the ledger
with the "Overdraft interest" line (`05-ledger-crop.png`), the refusal toast (`06-refusal-toast.png`) and the local-mode
panel with "Start again from the last autosave" (`11-local-panel.png`; pressing it reloaded into the autosave at $20,000).

### Still open

- "Start again from the last autosave" (local mode) loads the newer of the two rolling autosaves, which are at most 30 to
  60 s old: by the time administration comes they are overdrawn too. A save point kept from the last midnight in the black
  would make it a real way back.
- Selling land takes up its roads, including a road that is a through link for the player's other land. The C runs never
  had an empty parcel in administration, so the lever is exercised only by `finance:check`.
- Mothballing covers police, fire and health (and yards from their panel). Schools are civic and on the payroll too, but
  stopping admissions belongs to the education code (`sim/schools.ts`); a mothballed building's places still count as
  jobs in the demand figures (`recomputeStats`), which is small at these sizes.
- The gate does not close to prospects in administration (B3 suggests it); only the player's intents stop.
