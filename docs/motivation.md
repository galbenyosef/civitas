# Motivation: what citizens want, what they believe, and how players sway them

Rich, 2026-10-19: "How might I be able to influence and persuade the citizens of a city directly? I.e. hint to them to
get a better job, better education, move areas etc." and, on the hidden motivator: "The motivator can be multi variate
though? Say some are 100% money but some might be 30% money 70% family etc." Design 2026-10-19. **Nothing is built.**
The advertising that uses it is `docs/adverts.md`.

Code this touches: `shared/src/motivation.ts` (new: values, archetypes, tunables, the words), `server/src/sim/motivation.ts`
(new: seeding, inheritance, life-adjusted weights, scoring, the daily self-moves; later beliefs and word of mouth),
`server/src/pathfinding.ts` (`findPaths`, a few goals from one search), thin hooks in `server/src/sim/simulation.ts`
(`findJob`, `lifeStep`, `lifeFamily`, `pickLeisure`, `makeCitizen`, `spawnChild`, `describeLife`), `sim/life.ts`
(`happinessParts`), `sim/families.ts` (children who arrive with a family), `sim/schools.ts` (staying on, the track),
`server/src/world.ts` (`Citizen.vals`), `server/src/snapshot.ts` (old saves), `server/src/net.ts` (the Focus groups
section of a home's tooltip), `shared/src/protocol.ts` (`CitizenLife.values`, `BuildingInfo.focus`), `shared/src/tech.ts`
(the Focus groups feature) and `client/src/ui.ts`.

## 1. Today (main 38272ae)

Citizens already decide things, but every decision reads the same few numbers for everyone:

- **Jobs.** `Simulation.findJob` (`simulation.ts` 1210) takes the **first** vacancy the road search reaches (`findPath`
  with a goal test), after Education E4's skill gate (`Skills.placeFor`, `sim/skills.ts`: a skilled place the
  citizen qualifies for, or an unskilled one). A search that finds nothing is remembered per home and level
  (`jobMisses`, `docs/search-perf.md`) until a workplace or road edit could change it. Wage (`wageOf` x `wageMul` by
  education, `shared/src/education.ts`), tier and occupation play no part in the choice. Adults out of work search
  every `JOB_SEARCH_EVERY` (60 game minutes). Nobody in work ever looks for a better job; they only quit under high
  income tax (`payWage` 3070: `rate > 0.2`), or a camp settler leaves a far-off job for the starter yard
  (`sim/firstfive.ts` `starterYard`). Learning gives promotions in place (`Skills.promote`).
- **Staying on in education.** `sim/schools.ts` decides by fixed shares on a hash: `hash2(c.id, 245) < EDU.uniShare`
  (402) goes to university, `hash2(c.id, 246) < EDU.postgradTake` (403) to a postgrad course. The sixth-form track is
  `hash2(c.id, 233) < 0.5` (390). Drop-out is attendance driven (359: `EDU.dropOutBelow`, `dropOutPerDay`). Adult
  further education and evening classes (`sim/learning.ts` 214, 218) are flat take-up chances.
- **Moving.** Grown children move out (`lifeFamily` 1725, `LIFE.moveOutPerDay`) to the best home `bestBuiltNear` finds,
  scored `6 * Math.random() - d`: near and random. Couples move in together (`cohabit`). Camp settlers move into a
  finished home nearby (`FirstFive.campStep`, the same near-and-random scorer). A fire that burns out a home sends its
  people away (`sim/fires.ts`). Nobody else ever moves house.
- **Leisure.** `pickLeisure` (1417) scores each open place by appeal at the hour, life stage, a hash-seeded taste per
  venue type (`hash2(c.id, 301 + type)`), events, value and need, over `1 + d / 12`, against a bar yardstick.
- **Leaving town.** People living alone leave at `LIFE.leaveBasePerDay` plus more when `happy` is below
  `leaveUnhappyBelow`, times brain drain (`Skills.drainMul`) and tuition fees (`Schools.drainMul`). Anyone leaves when
  home tax is over their tolerance (`payHomeTax` 3089) or they can't pay it.
- **Happiness** (`sim/life.ts` 183 `happinessParts`) is a sum of labelled parts: commute, money, health, services,
  leisure, parks, work, education, schools, friends, traffic. It is the same sum for everyone: a long commute hurts a
  Grafter as much as a parent.

Other systems since the first draft, and how they meet this one:

- **First five** (`sim/firstfive.ts`, `docs/first-five.md`): the pioneer camp, the instant crew and the first settlers
  use `findJob` and `moveHome` through `FirstFiveDeps`; the scored job choice reaches them with no change there.
- **Ranks** (`shared/src/ranks.ts`, `docs/ranks.md`): needs are residents, jobs, shops, leisure, cover, school, a bus
  line, level 2 (with lower frontier targets). None reads happiness or values, but residents and jobs filled do, so the
  first-hours guard is the ranks probe and bot F (`loadtest/ranks.ts`, `loadtest/botf.ts`) within 15% of today.
- **Fires v2** (`sim/fires.ts`): burnt-out homes empty; later, a household that lost a home is a long-term memory (N5)
  and a Roots shock.
- **Adverts** (`sim/adverts.ts`, `docs/adverts.md`): campaigns have a `theme` that is one of the six values
  (`AD_THEMES`, the same order as `Value` here). Reach (A4) is deferred to motivation M4: it plants beliefs.
- **Media centre** (`shared/src/news.ts`, `sim/news.ts`, `docs/media.md`): the story log; N5 memories and N6
  conversations will feed M4's beliefs (bad news about a place lowers opinion of it).

So citizens differ in their circumstances but not in what they care about. Two people in the same flat with the same job
make the same choices with the same odds.

## 2. The idea

Split what drives a citizen into two parts:

- **Values**: what they care about, as weights that add up to 1. Some are 100% Money; some are 30% Money and 70%
  Family. Values change slowly: with life stage, life events, and a little with friends and long campaigns.
- **Beliefs**: what they think a job, a place or a course would give them, on each value. Beliefs change quickly: from
  experience, from friends, and from adverts (`docs/adverts.md`).

A decision scores a handful of options by the citizen's values applied to their beliefs about each option, and picks
with some noise. A player cannot reach into a citizen's values to change them. A player can **tell** them things, and
whether that works depends on whether the message speaks to what that person cares about.

## 3. Values

### The six values

| Value | What it scores on an option | Read from |
| --- | --- | --- |
| **Money** | wage, tax, rent, cost of living | `wageOf`, `parcel.taxRate`, `HOME_TAX_BASE`, `c.money`, `in7`/`out7` |
| **Family** | schools near home, room for children, being near a partner and parents | school catchment, capacity, `hh`, `partner`, `par` |
| **Status** | job tier, qualification, the address | workplace and home building level, `EDU` level (there is no land value yet) |
| **Roots** | friends nearby, time lived here, staying put | `friends` homes, days at this home (new: `homeDay`, set by `moveHome`), current parcel |
| **Time** | commute, shift length, transit at the door | `commuteTicks`, `shiftLen`, stop coverage |
| **Adventure** | something new: another district, another track, another city | distance from current home, a change of occupation |

Six is enough to give people character and few enough to show in one line of a panel. A seventh (**Comfort**: health,
quiet, parks) folds into Time and Family for now; see question 1.

### Archetypes, blended

Uniform random weights give everyone about 17% of everything, and nobody is anybody. Instead each citizen is a blend
of one or two **archetypes**:

| Archetype | Money | Family | Status | Roots | Time | Adventure |
| --- | --- | --- | --- | --- | --- | --- |
| Grafter | 0.70 | 0.10 | 0.10 | 0.00 | 0.10 | 0.00 |
| Homemaker | 0.15 | 0.60 | 0.00 | 0.15 | 0.10 | 0.00 |
| Climber | 0.25 | 0.00 | 0.55 | 0.00 | 0.05 | 0.15 |
| Local | 0.10 | 0.20 | 0.00 | 0.60 | 0.10 | 0.00 |
| Easygoing | 0.15 | 0.10 | 0.00 | 0.15 | 0.60 | 0.00 |
| Free spirit | 0.10 | 0.00 | 0.10 | 0.00 | 0.15 | 0.65 |

`archetypeOf(id)` picks a primary from `hash2(id, 301)` by the city's mix (`MOTIVE.mix`), a secondary from
`hash2(id, 302)`, and a blend share from `hash2(id, 303)`: 35% of people are pure (share 1), the rest a blend from 0.5
to 0.9. A pure Grafter is the "100% money" person in all but name (0.70 is pure enough that no other value wins a
decision on its own); a 0.5 Homemaker / 0.5 Grafter is "about 40% money, 35% family".

### Stored as six small numbers (M1 as built)

The first draft computed the blend from the id at every decision. As built, the blend is worked out **once** and stored
as six small integers 0-15 packed into one number, `Citizen.vals` (4 bits a value, `packValues` / `valuesOf` in
`shared/src/motivation.ts`; a weight is its number over the sum). That is what lets values be inherited and drawn by
area, which a pure function of the id cannot be:

- **Incomers** (`Motivation.seed`): the archetype blend from hashes 1601-1604, then pulled `MOTIVE.areaPull` (35%)
  toward the mean values of the people already living on the parcel of their new home (when it has at least
  `MOTIVE.areaMin` residents; the means are re-counted once a game day), then a hashed jitter per value
  (`MOTIVE.jitter`). So a district of Homemakers draws more of them, and a new parcel takes the city's mix.
- **Children** (`Motivation.inherit`): see below.
- **Old saves** carry no `vals`: the load (`snapshot.ts`) seeds them from the id alone, the same for everyone on every
  load. No version bump; `vals` is an optional number in the snapshot.

### Life reshapes values (computed, not stored)

`valuesOf(c, tick)` = the archetype blend, then multipliers from facts the sim already has, then renormalised:

| Fact | Effect |
| --- | --- |
| has a child at home (household `ids`, `LifeStage.Child`) | Family ×2.2, Adventure ×0.5 |
| has a partner | Family ×1.4, Roots ×1.2 |
| out of work, or `money < 60` | Money ×1.8 (the pinch, while it lasts) |
| graduated in the last 7 game days (`eduLog`) | Status ×1.5, Adventure ×1.4 |
| age 18-24 | Adventure ×1.5, Roots ×0.7 |
| age 50+ | Roots ×1.5, Time ×1.3, Adventure ×0.4 |
| retired | Money ×0.4, Status ×0.3, Roots ×1.6 |
| lived at this home over 4 game weeks | Roots ×1.3 |

So a Climber mellows when the baby comes, and a Homemaker counts the pennies after losing a job, with no saved state
for any of it. `valuesOf` is cheap (six multiplies per fact) and is only called at a decision.

### Drift (the only stored part of values)

`Citizen.vdrift`: six signed bytes, added to the computed weights before renormalising (each step 1/256, clamped to
±0.25). Drift comes from:

- **word of mouth** (section 6): a slow pull toward the friends' average values;
- **long campaigns** (`docs/adverts.md`): a citizen who has seen one theme many times drifts a little toward it;
- **regret** (section 7): a decision that went badly pushes away from the value that drove it.

Drift decays toward 0 lazily: store `vdriftDay` and halve per `MOTIVE.driftHalfLife` game days when read.

### Children inherit values

`spawnChild` (and a family arriving together, `Families.join`) gives a child no archetype roll of its own. Its base is the
mean of its parents' stored values (or the one parent's), blended with its own hashed archetype at share
`MOTIVE.childOwn` (0.3), plus the jitter. Values then pass down: a district of Locals raises Locals,
and over a few generations neighbourhoods take on a character. A child who grows up and moves away carries it.

## 4. Beliefs

A belief is what a citizen thinks a **target** offers on **one value**, as a signed number (-1 bad, 0 don't know or
average, +1 great):

```ts
interface Belief { t: number; v: number; b: number; day: number } // target id, value index, belief, last touched
```

**Targets** are things a decision can choose between and a player can talk about:

- a **parcel** (by parcel id): "Northgate has good schools", "Northgate is cheap";
- an **estate** (`Parcel.group`, `docs/world-map.md`), for campaigns about a whole development;
- a **workplace building** (by tile key): "Smith & Co pays well";
- an **education stage** (`Study`): "university is worth it".

Each citizen holds at most `MOTIVE.maxBeliefs` (6) beliefs, the most recently touched kept. Beliefs decay toward 0
with `MOTIVE.beliefHalfLife` (5 game days), lazily from `day`. A citizen with no belief about a target uses the
**truth** for it (section 5) with a penalty for the unknown, so beliefs only matter where they differ from the truth or
make someone notice a place they would never have looked at.

Where beliefs come from:

1. **Experience.** Living in a parcel or working at a building sets beliefs to the truth there, strongly. People know
   their own street.
2. **Friends** (section 6).
3. **Adverts** (`docs/adverts.md`): a nudge toward the advert's claim, scaled by section 8's reach formula.

## 5. Decisions: score a few options

Every hooked decision follows one pattern:

```ts
score(option) = Σ_v values[v] × perceived(c, option, v) + MOTIVE.noise × (hash or random - 0.5)
perceived(c, option, v) = belief about the option on v, if any, else truth(option, v) - MOTIVE.unknownPenalty
```

`truth(option, v)` is a normalised -1..1 reading of real facts (the "Read from" column in section 3). It is computed
once per decision for each of a few options, not stored. The noise keeps people surprising: the best option wins
most of the time, not every time.

### The hooks

| Decision | Today | With motivation | Where |
| --- | --- | --- | --- |
| **Take a job** | first vacancy the search reaches | the search collects up to `MOTIVE.jobOptions` (5) vacancies within `MOTIVE.jobSlack` (12) extra steps of the first, then scores them | `findJob` |
| **Look for a better job** | never | once a game day in `lifeStep`, with chance `0.05 × (Money + Status + Time)`, an employed adult scores their current job against a fresh search; switches if a rival beats it by `MOTIVE.switchMargin` | `lifeStep` → `findJob` |
| **Stay on in education** | `hash2(id, 245) < EDU.uniShare` | the same hash against `EDU.uniShare × lift`, `lift = 0.6 + 0.8 × (Status + Adventure + 0.5 × Family-if-parent-graduated)` clamped 0.6-1.6; same for postgrad | `schools.ts` 399-400 |
| **Which track** | `hash2(id, 233) < 0.5` | Status and Money favour STEM, Adventure the arts, Time the trades | `schools.ts` 387 |
| **Drop out** | attendance only | `dropOutPerDay × (1.4 - Status - 0.5 × Family-if-parent-graduated)` | `schools.ts` 357 |
| **Move house** (new) | grown children only | once a game day, with chance `MOTIVE.moveLook × (1 - Roots)`, an adult household scores its home against `bestBuiltNear` options; moves if one wins by `MOTIVE.moveMargin` | `lifeFamily` |
| **Where to move** | `6 * random - d` | the weighted score as the `bestBuiltNear` scorer | `lifeFamily` move-out, the new move |
| **Leave town** | base + unhappy | multiplied by `0.5 + Adventure + 0.5 × (1 - Roots)`, and when the best home in reach scores below `MOTIVE.elsewhere` | `lifeFamily` |
| **Tax tolerance** | the same for all | income: quit chance × `(0.5 + Money)`; home: tolerance `+ 0.1 × (Roots - Money)` | `payWage`, `payHomeTax` |

**Households decide together.** A move is the household's decision, scored with the mean of its adults' values (a
child at home already raised their Family weight). The adult with the lowest id rolls, once a day, as `lifeFamily`
already does for babies.

**Values bend happiness, too.** `happinessParts` keeps its labels, and each part's delta is multiplied by
`0.5 + 1.5 × values[v]` for the value it belongs to (commute → Time, money → Money, services → Family, friends →
Roots, leisure → Adventure). A Grafter barely minds the long commute to a well-paid job; an Easygoing citizen hates
it. The panel's reasons then read true to the person.

### Coordination with E4 (built)

E4 is merged (`sim/skills.ts`): the skill gate stays a hard filter before scoring (a candidate is only a place
`placeFor` allows), and the wage a candidate offers is `wageOf(kind, level) x wageMul` for the place the citizen would
take. Brain drain (`Skills.drainMul`) is untouched in M2; M3 makes it a high-Adventure, high-Status leaver.

### Search cost (as built)

`findJob` keeps one road search. `findPaths` (`pathfinding.ts`) is `findPath` that, once the first goal is found at
depth `d`, keeps expanding until it has `MOTIVE.jobOptions` (4) goals, passes depth `d + MOTIVE.jobSlack` (10) or has
expanded `MOTIVE.jobExtraNodes` (300) more nodes, whichever comes first. A search that finds nothing is the same search
as before, so the `jobMisses` cache is unchanged. Home choice reuses `bestBuiltNear`'s cell grid; leisure reuses
`pickLeisure`'s `eachBuiltNear` walk. There are no new full-map searches.

## 6. Word of mouth

Citizens already have up to `LIFE.maxFriends` (5) friends from work, venues and home. Once a game day, in `lifeStep`:

- **Beliefs spread.** Pick one friend (`hash2(c.id, day)`). Copy one of their beliefs at 50% strength, scaled by the
  listener's susceptibility (section 8), if it is stronger than the listener's own about that target and value.
- **Values drift.** Move `vdrift` one step toward the friend's values, scaled by `MOTIVE.conform`.

That is one friend, one belief and six bytes per citizen per day. The effect is that ideas travel through real social
graphs: an advert near a big office reaches its staff, and they tell their friends at the pub. A campaign can catch on
in one crowd and die in another. Contrarians (section 8) pass beliefs on inverted.

## 7. Regret and satisfaction

A decision driven by a belief is remembered: `Citizen.lastCall = { kind, value, target, day, happyBefore }` (one
record). About `MOTIVE.regretAfter` (4) game days later, `lifeStep` compares `happy` with `happyBefore`:

- **Better:** the belief is confirmed at full strength (now experience), and the citizen tells friends with double
  weight for a few days: the satisfied customer.
- **Worse:** the belief flips to the truth, Susceptibility drops by `MOTIVE.cynicism` (stored as a byte, recovering
  slowly), and `vdrift` moves away from the value that drove the call. The citizen passes on the bad news.

This is what makes honest advertising win: a "great schools" campaign for a parcel with no school moves some families
in, they find out, and they tell everyone. Over-advertised cities slowly grow cynical, a shared cost of spam between
players.

## 8. Susceptibility and temperament

Fixed per citizen from hashes, so nothing is stored except the cynicism above:

- **Susceptibility**: `0.3 + 0.7 × hash2(id, 311)`, times `(1 - cynicism)`. How far adverts and friends move this
  person.
- **Contrarian**: `hash2(id, 312) < MOTIVE.contrarian` (6%). Adverts and friends move their beliefs the other way.
- **Talkative**: `hash2(id, 313)`, how likely they are to pass a belief on (section 6 picks the friend; this scales
  whether anything is said).

## 9. What the player sees

Character, not numbers (question 3: words in the panel, percentages only per parcel through Focus groups):

- **The citizen panel** (`CitizenInfo.life`, `describeLife`) gains one line, "Cares about: family, then time", and a
  **thought** picked from the strongest belief or pending decision: "Thinking about university", "Heard Northgate's
  schools are good", "Fed up with the commute", "Wouldn't move for anything". Thoughts come from a table keyed by
  value and decision.
- **The timeline** gets reasons: "Moved to Northgate (heard the schools are good)", "Took a job at Smith & Co for the
  pay", "Regrets moving: the commute".
- **Focus groups** (question 4: Culture tier 2, the `focusgroups` feature of Cinemas and sports halls, `cul2`) first
  adds a section to a home's tooltip: the value mix of the people living on its parcel, as percentages. M6 adds
  a parcel overlay of value mix and the
  strongest beliefs about each parcel: who lives here, what they care about, what they think of the place next door.
  This is what tells a player which message to run where.
- **Charts** (`shared/src/history.ts`): city value mix, moves per day by reason, regrets per day.

## 10. Balance and performance

- **Tick cost.** Nothing per tick. Values are computed at a decision; beliefs decay lazily; word of mouth and the
  better-job and move checks run in `lifeStep`, which already visits every citizen once a game day. The job search
  collects a few more vacancies on a search it already does. Target: under 3% more sim ms per tick on the 6×6
  district test (`docs/feature-gaps.md`: 12.7 ms against 50). Measure with `loadtest/ab.ts --set motive=0` (a
  `MOTIVE=0` switch that makes every decision behave as today) and a new `loadtest/motivation.ts` probe: the value mix,
  moves and job switches per day by reason, regrets, belief counts, and the job fill rate.
- **Memory.** Per citizen: `vdrift` 6 bytes, `vdriftDay`, `homeDay`, cynicism 1 byte, up to 6 beliefs, one `lastCall`. About 100
  bytes; 3.4 MB at 34k citizens.
- **Churn.** Job switching and moving add traffic and empty homes. `switchMargin` and `moveMargin` start high so that
  M2 and M3 change little until tuned; the probe must show moves per day under 0.5% of households and job switches
  under 1% of workers.
- **Determinism.** Values and temperament come from `hash2`, so a citizen is the same person on every run. Rolls use the
  sim's existing randomness, as the decisions they replace do.
- **Tunables in one place:** `MOTIVE` in `shared/src/motivation.ts` (archetypes, mix, life multipliers, half-lives,
  margins, noise, conform, contrarian, cynicism).
- **Old worlds** need nothing: values are computed from ids, beliefs start empty, and every new field is optional in the
  snapshot. No format bump.

## 11. Phased plan

| # | Subtask | Files | Depends on | Size |
| --- | --- | --- | --- | --- |
| M1 | **Values** (this branch). `shared/src/motivation.ts` (values, archetypes, `MOTIVE`); `valuesOf`, temperament; `vdrift` fields; the panel line "Cares about"; values bend `happinessParts`; inheritance in `spawnChild`; `loadtest/motivation.ts` | motivation.ts (both), world.ts, life.ts, snapshot.ts, protocol.ts, simulation.ts (`describeLife`, `spawnChild`) | none | M |
| M2 | **Scored decisions** (this branch, with the self-moves of M3 at a slow rate). `truth`, `score`; the candidate list in `findJob`; the better-job check; the scored move-out and the household move check; leisure by values; staying on and track lifts; the `MOTIVE=0` switch | simulation.ts (`findJob`, `lifeStep`, `lifeFamily`, `pickLeisure`), schools.ts, pathfinding.ts | M1, education E4 (built) | M |
| M3 | **Moving house.** The household move check, the scored `bestBuiltNear`, leaving town by values | simulation.ts (`lifeFamily`), world.ts | M2 | M |
| M4 | **Beliefs and word of mouth.** `Belief`, experience, spreading, value drift, thoughts in the panel, reasons on the timeline | sim/motivation.ts, simulation.ts (`lifeStep`, `describeLife`) | M2 | M |
| M5 | **Regret.** `lastCall`, the check, cynicism | sim/motivation.ts | M4 | S |
| M6 | **Views.** The parcel overlay of value mix and beliefs, chart series (the Focus groups section of a home's tooltip lands with M1) | tech.ts, history.ts, charts.ts, chunkView.ts | M4 | M |
| A1-A5 | **Adverts**: `docs/adverts.md` | | M4 | |

**Showcase** (`docs/demo.md`): M1-M5 add no kinds, so `demo:check` asks for nothing, but add `SHOWCASE_FEATURES`
entries so the tour can show it: `job-switch` (within `FEATURE_DAYS` a showcase worker changes job for the pay),
`moved-for-schools` (a household moves to the parcel with the primary) and `regret` (a run report line).

## 12. Questions for Rich

1. **How many values?**
   - **A. Six: Money, Family, Status, Roots, Time, Adventure** (recommended). Comfort folds into Time and Family.
   - B. Seven, with Comfort (health, quiet, parks) on its own. Richer, but harder to read in one panel line.
2. **Should people change job and move house on their own?**
   - **A. Yes, slowly** (recommended): the better-job check and the household move check, both tuned to under 1% a
     day. Without them, persuasion only acts on newcomers, school leavers and the unemployed.
   - B. No: values only shape decisions people already make today.
3. **Should the player ever see the numbers?**
   - **A. Words in the panel; percentages only through Focus groups, per parcel, never per person** (recommended).
   - B. Show each citizen's percentages in the panel from the start.
4. **Where does Focus groups sit?**
   - **A. Culture track, tier 2 (after Libraries and halls)** (recommended), so it arrives about when adverts do.
   - B. A civic node, beside emergency services.
5. **Do children inherit values?**
   - **A. Yes, the parents' blend plus their own secondary** (recommended): neighbourhoods get a character over time.
   - B. No, everyone rolls their own.

## 13. Hooks for later

- **Advert reach** (`docs/adverts.md` section 4, A4): the nudge lands in M4's beliefs, scaled by susceptibility; until
  then a campaign's `theme` can already be read against `valuesOf(c.vals)[theme]` to say who it speaks to. A4's
  daily pass belongs in `Motivation.daily` (one call from `lifeStep`), which already visits every citizen.
- **N5 memories and N6 opinions** (`docs/media.md` section 6): a memory of a story about a parcel (a fire, a closure)
  becomes a belief about that parcel on the value it touches (a fire: Family and Roots; a closure: Money); a
  conversation passes it on as section 6 here does, and bad news lowers opinion. The scorers read a belief through
  one function, `perceived`, so N6 needs no change to the decisions.
- **The deceased archive** (the death agent's `sim/death.ts`): a family with someone in the town's archive (buried or
  remembered here) holds stronger Roots: a Roots multiplier in `weightsOf` alongside the other life facts, and
  "Wouldn't leave: family is buried here" as a thought.
