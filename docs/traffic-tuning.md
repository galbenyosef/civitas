# Traffic tuning

Rush-hour traffic on the Commons, measured offline, and the rule changes and default values chosen from that
(2026-10-16). The goal: jams and queues that look real, no car ever drawn inside another car or a pedestrian, and
far fewer cars that silently vanish because the stuck rule gave up on them.

**Outcome.** Against the rules as they were, at the 08:00 and 17:00 rushes (12-seed means):

| | 08:00 old | 08:00 new | 17:00 old | 17:00 new |
| --- | --- | --- | --- | --- |
| give-ups (cars sent home or removed) | 804 | 163 | 464 | 97 |
| of those, removed from inside a junction box | 363 | 45 | 218 | 29 |
| mean speed | 23% | 36% | 26% | 39% |
| queued share | 71% | 57% | 69% | 55% |
| car–car body overlaps per tick | 0.145 | 0 | 0.071 | 0 |
| car–pedestrian contacts per tick, as the client draws them | 0.226 | 0.008 | 0.120 | 0.005 |

Give-ups drop 4.9× and 4.8× on the seeds the values were chosen on (1–12), and 4.2× on twelve held-out seeds
(13–24): just short of the 5× target. Turning off one option (`guardDrawn`, below) gives 5.4× / 5.2× over all
24 seeds, but leaves ten times more visible car–pedestrian contacts, so it stays on. Jams still happen: over half
the cars are queued at the peaks. On the live server at rush hour (probe-obb.mjs), car–car overlaps went from 0.08 to
0 per frame and car–pedestrian contacts from 0.38 to 0.000 (08:00) and 0.010 (17:00).

## Method

`packages/server/src/loadtest/ab.ts` builds a 1×1 test city (`seedCity`, the Commons layout, everything built to
level 3, about 950 citizens), runs it from midnight to the given hour of the second day (by then the population
has settled), then measures 1,500 ticks (15 game hours) every tick. `Math.random` is replaced with a seeded
generator, so a run is deterministic for its seed. Every traffic constant that matters is a field of
`TRAFFIC_TUNING` in `packages/shared/src/tuning.ts`, read where it is used, so `--set name=value,...` changes it for
the whole run; `old=1` first restores the rules as they were before this work. `ab-matrix.ts` runs a list of
settings over several seeds in parallel and prints the tables below; `ab-why.ts` is the diagnostic used to find
what each stuck car was waiting for.

```sh
npx tsx packages/server/src/loadtest/ab.ts --hour 8 --ticks 1500 --set stuckLimit=150,signalT=0
npx tsx packages/server/src/loadtest/ab-matrix.ts --hours 8,17 --seeds 1,2,3,4,5,6,7,8,9,10,11,12 --row "old=old=1" --row "new="
npx tsx packages/server/src/loadtest/ab-why.ts --hour 8 --ticks 1500 --stuckmap   # what held each car that gave up
```

What is measured:

- **Speed**: distance driven per tick as a share of each car's free speed, averaged over all cars on the road.
- **Queued**: share of car-ticks moving at under 30% of free speed (the same test as the congestion overlay).
- **Give-ups**: trips ended by the stuck rule (a citizen sent home, a truck, visitor or patrol removed), counted
  in `Traffic.counters` (read-only). "In a box" is the subset removed while inside a junction tile. Cars that never
  get out of their garage are not counted: they were never on the road.
- **Driver commute**: mean ticks from leaving home to arriving at work for commuters who drove, over completed
  commutes (a give-up is not a completed commute, so the old rules look faster here than they are).
- **Junction entries**: cars entering a lane out of a junction tile, per tick: throughput through junctions.
- **Overlaps**: every tick, every pair of car bodies (oriented rectangles `VEHICLE_LEN` × `VEHICLE_WIDTH`) and every
  car against every pedestrian (a 0.07-radius disc), as in probe-obb.mjs. "Path" orients a car along its lane
  geometry; "as drawn" orients it the way the client does, facing the direction it last moved. On a tight turn the
  two differ by up to about 35°, so as drawn is what a player sees and what the live probe measures.

Seeds 1–12 were used to choose values; the final defaults were then checked on seeds 13–24. Between two runs of
the same setting on different seed sets the mean give-up count moves by about ±15 at 08:00, so differences
smaller than that are noise. Another agent was optimising `dispatch()` while this ran; every table below comes
from one run of one code version.

## What was wrong

Following individual stuck cars (ab-why.ts) showed that most give-ups were not traffic at all:

1. **The stuck clock counted every stopped tick on a trip.** A commute through four or five red lights reached 75
   ticks without ever being in a jam. In a run with the deadlock fixes below but the old clock, the commonest thing
   a car was waiting for when it gave up was a red light. Counting ticks since the car last reached a new tile fixes that, but on its own it makes things worse,
   because the early give-ups had been hiding real deadlocks.
2. **Deadlocks in the entry rules.** With no stuck rule at all the Commons locked solid within the first game hour.
   - *Driveways*: a car turning into a building waited for an empty forecourt, while the car pulling out of the
     same building waited for the arriving car to clear the road. A driveway's in and out lanes are straight and a
     lane apart, so they never touch; the forecourt now uses the conflict table.
   - *Rounding at the stop line*: a car stopped at its stop line could sit a rounding error past it and count as
     "in the next box", so two cars facing each other each waited for the other for ever. A car is now in a box on
     the way in once it has committed to entering, which also closes a race where a committed car short of the line
     was invisible to conflicting movements.
   - *Whole-path conflicts*: a car waiting at the far edge of a box still blocked every movement its earlier turn
     had crossed. Only the part of its path from its rear bumper on now counts.
   - *Waiting in the forecourt*: a car waiting to pull out stood in the forecourt and blocked cars arriving from
     the building's other side. Cars now wait in the garage until the road would let them in.
   - *Same approach, other exit*: a follower turning left across a leader that had stopped straight ahead in the
     box. This now uses the same remaining-path test.
3. **Stop lines were in lane-progress units.** Progress is a fraction of a lane, and a right-turn arc is only half
   a tile long, so a car stopped at the old line on a right-hand bend had its nose in the next tile.
4. **Re-routes could U-turn.** The congestion re-route searched from the tile ahead and could go straight back
   through the tile behind, which the lane geometry draws as driving through the box. Re-routes now never use
   the tile behind (this fix is in the "old rules" rows too).
5. **Car–car overlaps** came almost entirely from cars appearing at progress 0 inside a busy box (pulling out of an
   entry tile or the kerb), and the rest from the arc geometry above.
6. **Car–pedestrian contacts** had four sources: driveways (cars crossing the sidewalk had no rule at all), the
   one-tick crossing lag, the bounded waits (a car nosing through after 15 ticks, a pedestrian stepping out after
   20), and on turns the difference between a car's path and the way the client draws it.

## Build-up: one change at a time

Each row adds to the one above (12 seeds).

**08:00**

| setting | speed % | queued % | queued % first hour | give-ups | of which in a box | kerb+walk / withdrawn | driver commute (ticks) | junction entries / tick | car–car / tick | car–ped / tick (path) | car–ped / tick (as drawn) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 old rules (today) | 23.2 | 71.0 | 67.5 | 804 | 363 | – | 51 | 3.6 | 0.145 | 0.229 | 0.226 |
| 1 stuck clock per tile | 15.0 | 80.9 | 70.4 | 638 | 201 | – | 72 | 3.0 | 0.136 | 0.302 | 0.301 |
| 2 forecourt by conflict, box by commitment | 19.4 | 75.9 | 60.5 | 439 | 124 | – | 68 | 4.0 | 0.098 | 0.300 | 0.301 |
| 3 remaining-path conflicts, arc-aware stop lines | 24.9 | 69.6 | 58.7 | 269 | 68 | – | 66 | 4.5 | 0.117 | 0.308 | 0.330 |
| 4 wait in the garage | 29.1 | 64.4 | 56.5 | 150 | 39 | – | 69 | 4.3 | 0.014 | 0.262 | 0.276 |
| 5 body guard, no walk-through, step back | 27.4 | 66.3 | 57.0 | 194 | 46 | – | 75 | 4.2 | 0.000 | 0.005 | 0.120 |
| 6 patient at lights, same approach by path, congestion 8 | 28.3 | 65.2 | 55.7 | 188 | 45 | – | 78 | 4.6 | 0.000 | 0.006 | 0.084 |
| 7 signal period 15, stuck limit 60 | 36.9 | 55.2 | 47.5 | 136 | 34 | – | 63 | 5.2 | 0.000 | 0.004 | 0.077 |
| 8 guard as drawn: the new defaults | 35.5 | 56.8 | 45.9 | 163 | 45 | – | 65 | 5.1 | 0.000 | 0.005 | 0.008 |

**17:00**

| setting | speed % | queued % | queued % first hour | give-ups | of which in a box | kerb+walk / withdrawn | driver commute (ticks) | junction entries / tick | car–car / tick | car–ped / tick (path) | car–ped / tick (as drawn) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 old rules (today) | 26.0 | 68.7 | 73.1 | 464 | 218 | – | 44 | 2.2 | 0.071 | 0.125 | 0.120 |
| 1 stuck clock per tile | 17.4 | 78.9 | 83.1 | 380 | 127 | – | 52 | 2.0 | 0.053 | 0.160 | 0.161 |
| 2 forecourt by conflict, box by commitment | 22.7 | 72.9 | 79.1 | 240 | 73 | – | 45 | 2.6 | 0.037 | 0.155 | 0.152 |
| 3 remaining-path conflicts, arc-aware stop lines | 27.2 | 67.9 | 74.1 | 166 | 49 | – | 44 | 2.8 | 0.050 | 0.182 | 0.199 |
| 4 wait in the garage | 32.4 | 61.7 | 67.6 | 80 | 23 | – | 72 | 2.8 | 0.009 | 0.156 | 0.165 |
| 5 body guard, no walk-through, step back | 30.7 | 63.6 | 71.0 | 110 | 28 | – | 73 | 2.7 | 0.000 | 0.002 | 0.086 |
| 6 patient at lights, same approach by path, congestion 8 | 31.1 | 63.1 | 70.3 | 113 | 29 | – | 67 | 3.0 | 0.000 | 0.003 | 0.045 |
| 7 signal period 15, stuck limit 60 | 39.6 | 53.3 | 60.0 | 82 | 22 | – | 62 | 3.2 | 0.000 | 0.003 | 0.052 |
| 8 guard as drawn: the new defaults | 38.6 | 54.5 | 63.1 | 97 | 29 | – | 70 | 3.1 | 0.000 | 0.002 | 0.005 |

The deadlock fixes (rows 2–4) take give-ups from 638 to 150 at 08:00 and nearly remove car–car overlaps. The
body guard (row 5) is what removes contacts. It is a last resort behind all the rules: a car never moves its body onto a pedestrian or
another car ahead of it, and a pedestrian never steps into a car. It costs some give-ups, because a pedestrian and
a car can now hold each other up. To break that tie without a contact, a pedestrian held on a crossing for 10 ticks
steps back to the kerb. Row 8 extends the guard to bodies as drawn, which buys a further tenfold drop in visible
contacts for about 20% more give-ups.

## The matrix around the new defaults

Each row changes one setting from the new defaults (12 seeds).

**08:00**

| setting | speed % | queued % | queued % first hour | give-ups | of which in a box | kerb+walk / withdrawn | driver commute (ticks) | junction entries / tick | car–car / tick | car–ped / tick (path) | car–ped / tick (as drawn) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| old rules (today) | 23.2 | 71.0 | 67.5 | 804 | 363 | – | 51 | 3.6 | 0.145 | 0.229 | 0.226 |
| **new defaults** | 35.5 | 56.8 | 45.9 | 163 | 45 | – | 65 | 5.1 | 0.000 | 0.005 | 0.008 |
| stuck limit 75 | 31.5 | 61.5 | 50.7 | 187 | 51 | – | 78 | 4.9 | 0.000 | 0.005 | 0.009 |
| stuck limit 150 | 18.7 | 76.7 | 53.9 | 207 | 56 | – | 108 | 4.0 | 0.000 | 0.006 | 0.007 |
| stuck limit 300 | 11.0 | 86.1 | 60.2 | 140 | 38 | – | 151 | 2.8 | 0.000 | 0.006 | 0.008 |
| old stuck clock (every stopped tick on the leg) | 41.1 | 50.1 | 47.8 | 279 | 70 | – | 52 | 5.1 | 0.000 | 0.005 | 0.008 |
| never give up, re-route instead | 0.8 | 98.9 | 97.2 | 0 | 0 | – | 41 | 0.5 | 0.000 | 0.000 | 0.000 |
| re-route, abandon after 300 more (kerb / withdraw) | 3.9 | 94.7 | 86.0 | 0 | 0 | 60 / 99 | 252 | 1.3 | 0.000 | 0.006 | 0.007 |
| give up only clear of a box (kerb + walk) | 14.0 | 81.4 | 64.7 | 8 | 0 | 110 / 253 | 84 | 1.8 | 0.000 | 0.006 | 0.009 |
| release first car clear of a box instead | 31.7 | 61.2 | 50.1 | 242 | 15 | – | 71 | 4.6 | 0.000 | 0.004 | 0.007 |
| no T-junction lights | 37.8 | 54.3 | 39.9 | 218 | 54 | – | 69 | 5.4 | 0.000 | 0.005 | 0.008 |
| signal period 20 | 33.5 | 59.1 | 51.1 | 193 | 55 | – | 68 | 4.9 | 0.000 | 0.005 | 0.009 |
| signal period 30 | 30.5 | 62.8 | 54.8 | 214 | 61 | – | 81 | 4.8 | 0.000 | 0.005 | 0.008 |
| signal period 45 | 28.1 | 65.4 | 59.2 | 260 | 68 | – | 82 | 4.5 | 0.000 | 0.006 | 0.008 |
| actuated lights | 34.6 | 57.8 | 49.8 | 195 | 53 | – | 69 | 5.0 | 0.000 | 0.004 | 0.007 |
| same approach: keep the conflict | 33.5 | 59.2 | 49.8 | 196 | 47 | – | 63 | 4.8 | 0.000 | 0.006 | 0.010 |
| same approach: allow past box centre | 34.7 | 57.7 | 49.8 | 181 | 45 | – | 67 | 5.2 | 0.000 | 0.004 | 0.010 |
| car yield max 0 (never nose in) | 34.2 | 58.4 | 47.3 | 205 | 58 | – | 66 | 4.9 | 0.000 | 0.005 | 0.007 |
| car yield max 30 | 34.5 | 57.9 | 48.1 | 179 | 51 | – | 72 | 5.0 | 0.000 | 0.006 | 0.008 |
| crossing wait max 0 (never step out) | 32.0 | 60.9 | 47.3 | 286 | 64 | – | 70 | 4.5 | 0.000 | 0.006 | 0.006 |
| crossing wait max 40 | 33.3 | 59.3 | 47.3 | 211 | 57 | – | 70 | 4.9 | 0.000 | 0.009 | 0.009 |
| no crossing lag | 35.1 | 57.3 | 48.8 | 170 | 47 | – | 66 | 5.0 | 0.000 | 0.004 | 0.008 |
| pedestrian priority (unsignalled) | 34.1 | 58.5 | 50.3 | 182 | 47 | – | 68 | 4.9 | 0.000 | 0.004 | 0.009 |
| lane by length, room 1.4 (3 sedans) | 33.6 | 58.9 | 48.5 | 199 | 49 | – | 67 | 5.1 | 0.000 | 0.006 | 0.010 |
| don't block the box (junctions) | 34.7 | 57.7 | 49.0 | 178 | 47 | – | 63 | 4.9 | 0.000 | 0.006 | 0.011 |
| pedestrians walk through after 40 | 35.4 | 56.9 | 49.6 | 159 | 44 | – | 69 | 5.1 | 0.000 | 0.041 | 0.083 |
| guard by path only (not as drawn) | 36.9 | 55.2 | 47.5 | 136 | 34 | – | 63 | 5.2 | 0.000 | 0.004 | 0.077 |
| car ownership 0.55 | 36.3 | 55.9 | 47.2 | 151 | 40 | – | 66 | 4.9 | 0.000 | 0.006 | 0.011 |

**17:00**

| setting | speed % | queued % | queued % first hour | give-ups | of which in a box | kerb+walk / withdrawn | driver commute (ticks) | junction entries / tick | car–car / tick | car–ped / tick (path) | car–ped / tick (as drawn) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| old rules (today) | 26.0 | 68.7 | 73.1 | 464 | 218 | – | 44 | 2.2 | 0.071 | 0.125 | 0.120 |
| **new defaults** | 38.6 | 54.5 | 63.1 | 97 | 29 | – | 70 | 3.1 | 0.000 | 0.002 | 0.005 |
| stuck limit 75 | 34.3 | 59.4 | 64.7 | 116 | 32 | – | 63 | 3.0 | 0.000 | 0.003 | 0.005 |
| stuck limit 150 | 20.6 | 75.2 | 79.6 | 154 | 41 | – | 73 | 2.5 | 0.000 | 0.005 | 0.006 |
| stuck limit 300 | 10.0 | 87.7 | 88.6 | 152 | 40 | – | 149 | 1.9 | 0.000 | 0.004 | 0.006 |
| old stuck clock (every stopped tick on the leg) | 44.1 | 48.0 | 55.9 | 160 | 39 | – | 64 | 3.1 | 0.000 | 0.003 | 0.005 |
| never give up, re-route instead | 0.3 | 99.6 | 99.1 | 0 | 0 | – | 21 | 0.2 | 0.000 | 0.000 | 0.000 |
| re-route, abandon after 300 more (kerb / withdraw) | 2.0 | 97.1 | 95.1 | 0 | 0 | 75 / 101 | 426 | 0.6 | 0.000 | 0.004 | 0.005 |
| give up only clear of a box (kerb + walk) | 8.0 | 89.4 | 83.5 | 6 | 0 | 76 / 170 | 121 | 0.7 | 0.000 | 0.004 | 0.006 |
| release first car clear of a box instead | 34.7 | 58.8 | 66.7 | 134 | 11 | – | 66 | 2.8 | 0.000 | 0.002 | 0.005 |
| no T-junction lights | 39.8 | 53.1 | 59.2 | 137 | 35 | – | 45 | 3.2 | 0.000 | 0.003 | 0.006 |
| signal period 20 | 37.0 | 56.3 | 63.6 | 109 | 30 | – | 66 | 3.2 | 0.000 | 0.003 | 0.006 |
| signal period 30 | 33.7 | 60.2 | 67.7 | 125 | 37 | – | 55 | 3.1 | 0.000 | 0.003 | 0.006 |
| signal period 45 | 30.5 | 63.7 | 68.2 | 151 | 42 | – | 60 | 2.9 | 0.000 | 0.003 | 0.004 |
| actuated lights | 37.0 | 56.3 | 62.9 | 121 | 34 | – | 49 | 3.2 | 0.000 | 0.002 | 0.006 |
| same approach: keep the conflict | 37.2 | 56.0 | 65.6 | 114 | 28 | – | 73 | 3.0 | 0.000 | 0.003 | 0.006 |
| same approach: allow past box centre | 37.5 | 55.6 | 61.7 | 106 | 24 | – | 66 | 3.2 | 0.000 | 0.003 | 0.006 |
| car yield max 0 (never nose in) | 36.5 | 56.8 | 66.7 | 128 | 36 | – | 59 | 3.0 | 0.000 | 0.003 | 0.004 |
| car yield max 30 | 37.4 | 55.8 | 65.2 | 108 | 32 | – | 58 | 3.1 | 0.000 | 0.003 | 0.005 |
| crossing wait max 0 (never step out) | 33.8 | 59.9 | 65.5 | 186 | 39 | – | 67 | 2.7 | 0.000 | 0.003 | 0.003 |
| crossing wait max 40 | 36.0 | 57.4 | 65.1 | 129 | 38 | – | 63 | 3.0 | 0.000 | 0.003 | 0.006 |
| no crossing lag | 37.9 | 55.3 | 62.5 | 104 | 29 | – | 62 | 3.1 | 0.000 | 0.002 | 0.004 |
| pedestrian priority (unsignalled) | 36.7 | 56.5 | 64.2 | 107 | 29 | – | 62 | 3.1 | 0.000 | 0.003 | 0.006 |
| lane by length, room 1.4 (3 sedans) | 36.1 | 57.3 | 64.2 | 127 | 32 | – | 71 | 3.2 | 0.000 | 0.003 | 0.006 |
| don't block the box (junctions) | 37.9 | 55.2 | 63.0 | 106 | 28 | – | 66 | 3.1 | 0.000 | 0.004 | 0.008 |
| pedestrians walk through after 40 | 39.1 | 53.8 | 59.9 | 79 | 23 | – | 60 | 3.2 | 0.000 | 0.022 | 0.057 |
| guard by path only (not as drawn) | 39.6 | 53.3 | 60.0 | 82 | 22 | – | 62 | 3.2 | 0.000 | 0.003 | 0.052 |
| car ownership 0.55 | 38.7 | 54.4 | 62.7 | 92 | 22 | – | 52 | 3.0 | 0.000 | 0.002 | 0.004 |

Reading the matrix:

- **Stuck limit.** A longer limit does not reduce give-ups until 300 ticks, and by then the city is close to
  gridlock (11% speed). Of the limits that keep traffic moving, 60 ticks (12 game minutes without reaching a new
  tile) gives the fewest give-ups and the best flow. "Never give up", with or without re-routing instead, locks
  the whole city within the hour, so some release valve is needed.
- **Visible-safe give-ups.** Every variant that avoids removing a car from inside a junction box makes things
  worse. Waiting until it is clear of the box, then parking at the kerb, leaves cars stuck in boxes and kerb-parked
  cars taking lane space: speed falls to 8–14%. Releasing the first car clear of a box along the chain holding it
  up instead does not unblock the junction: 49% / 38% more give-ups. The car stuck in the box is the one that has to
  go. What the new rules do instead is make it rare: 45 removals from inside a box at 08:00 against 363.
- **Signals.** A short phase is better on the Commons' short blocks: 15 ticks beats 20, 30 and 45 on speed,
  queues and give-ups. With no lights at T-junctions traffic moves a little faster but deadlocks more, giving a
  third to two-fifths more give-ups. Actuation (holding a green while nobody waits on red, up to twice the period)
  is worse than fixed timing at 15 ticks, with 20–25% more give-ups. It is also server-only, so the client's lamps
  would be wrong.
- **Crossings.** Never letting a pedestrian step into a busy box costs 75–90% more give-ups, and never letting a
  car nose in costs about 30% more: each lets a stream of one kind starve the other. With the guard on, the
  one-tick crossing lag no longer causes contacts, and removing it is within noise, so it stays. Pedestrian
  priority at unsignalled crossings is slightly worse. Letting a pedestrian walk through a car after 40 ticks cuts
  give-ups by 2% (08:00) to 18% (17:00) but makes visible contacts ten times more frequent.
- **Lane capacity.** Admitting a third sedan when lengths allow (`laneByLength`, room 1.4 tiles) is worse, with
  about 22% more give-ups at 08:00. "Don't block the box", which only enters a junction if the tile after it will
  take you, is slightly worse.
- **Demand.** Car ownership at 0.55 instead of 0.7 changes give-ups by under 10%. Two-thirds of the remaining
  give-ups are visitors and delivery trucks, not commuters (four-fifths under the old rules).

## Held-out check and live probes

On seeds 13–24, which played no part in choosing the values: old rules 786 / 456 give-ups at 08:00 / 17:00;
new defaults 186 / 110, a 4.2× cut at both. With `guardDrawn=0` the new rules give 160 / 94, a 4.9× cut, with
car–pedestrian contacts as drawn of 0.100 / 0.076 per tick.

Live dev server (ws :8080, the real Commons), probe-obb.mjs over 60 s after a 15 s warm-up:

| | cars at most | car–car / frame | car–ped / frame |
| --- | --- | --- | --- |
| before (previous agent's measurement) | | 0.08 | 0.38 |
| new defaults, 07:30 onwards | 159 | 0 | 0.000 |
| new defaults, 16:30 onwards | 233 | 0 | 0.010 |
| same with `guardDrawn=0`, 07:30 / 16:30 | 171 / 255 | 0 / 0 | 0.218 / 0.114 |

probe-stuck.mjs straight after each run showed 40–68% of cars queued.

## Chosen values

All in `TRAFFIC_TUNING`; each is documented where it is defined.

- `stuckClock: 1`, `stuckLimit: 60`, `stuckReroute: 0`: give up after 60 ticks without reaching a new tile.
- `boxByCommit`, `forecourtConflict`, `conflictRemaining`, `arcAware`: 1, the deadlock and geometry fixes.
- `sameApproachRelax: 2`: same approach, other exit, judged by the rest of the leader's path.
- `spawnClear: 2`: a car pulls out only when the box is empty and the road tile would let it in.
- `bodyGuard`, `carGuard`: 1; `guardWaitMax: 0`, so a pedestrian never walks through a car;
  `pedRetreatAfter: 10`; `guardDrawn: 7`, so the guard also protects bodies as drawn.
- `signalPeriod: 15`, shared with the client: lamps change about every 3 real seconds, ±20% per junction.
- `pedSignalPatient: 1`: at lights, never across a red or into a busy box.
- `congestionWeight: 8`: a fully congested tile costs 9 instead of 5 when routing, so drivers use alternatives
  sooner.
- Unchanged: `signalT: 1`, `carYieldMax: 15`, `crossingWaitMax: 20`, `crossingLag: 1`, `pedPriority: 0`,
  `laneCap: 2`, `boxClear: 0`, `signalActuated: 0`.

**Cost.** The simulation tick on the 1×1 city goes from 0.42 to 0.65 ms at 08:00 and from 0.26 to 0.43 ms at
17:00. About 0.16 ms of that is the guard (roughly 1.5 µs per car per tick); the rest is more cars staying on the
road. That is a few ms per tick at the 6×6 load-test city, inside the 50 ms budget.

**Known gaps.**
- Over a quarter of the remaining give-ups still remove a car from inside a junction box.
- Cars parked at the kerb (when a destination is full) are not drawn by the client.
- Most of the remaining as-drawn contacts are a pedestrian starting to walk from a door while a car is in the same
  forecourt, inside the building's footprint.

## What the player can do about jams

Measured with the same harness, new rules, 12 seeds:

**08:00**

| setting | speed % | queued % | queued % first hour | give-ups | of which in a box | driver commute (ticks) | junction entries / tick | car–ped / tick (as drawn) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| new defaults | 35.5 | 56.8 | 45.9 | 163 | 45 | 65 | 5.1 | 0.008 |
| no parking lots | 34.7 | 57.0 | 49.1 | 168 | 48 | 69 | 4.9 | 0.010 |
| no signals technology | 43.6 | 47.3 | 32.3 | 179 | 43 | 52 | 5.5 | 0.009 |
| ring road round the district | 34.3 | 58.8 | 49.0 | 234 | 57 | 62 | 6.2 | 0.008 |
| old rules | 23.2 | 71.0 | 67.5 | 804 | 363 | 52 | 3.6 | 0.226 |
| old rules, no signals | 31.3 | 61.4 | 44.7 | 690 | 241 | 42 | 4.5 | 0.234 |
| old rules, no lots | 23.4 | 70.4 | 66.3 | 762 | 348 | 50 | 3.5 | 0.216 |

**17:00**

| setting | speed % | queued % | queued % first hour | give-ups | of which in a box | driver commute (ticks) | junction entries / tick | car–ped / tick (as drawn) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| new defaults | 38.6 | 54.5 | 63.1 | 97 | 29 | 70 | 3.1 | 0.005 |
| no parking lots | 37.8 | 54.6 | 62.3 | 99 | 28 | 60 | 3.1 | 0.007 |
| no signals technology | 46.0 | 45.8 | 56.9 | 112 | 28 | 39 | 3.3 | 0.006 |
| ring road round the district | 36.3 | 57.6 | 63.4 | 158 | 37 | 45 | 3.9 | 0.005 |
| old rules | 26.0 | 68.7 | 73.1 | 464 | 218 | 44 | 2.2 | 0.120 |
| old rules, no signals | 34.2 | 59.1 | 68.5 | 413 | 165 | 33 | 2.6 | 0.128 |
| old rules, no lots | 26.4 | 67.9 | 72.8 | 454 | 215 | 39 | 2.2 | 0.120 |

- **Signals are not a cure on a dense grid.** Without the signals technology every junction is give-way, and
  traffic on the Commons moves faster: 44% against 36% at 08:00, with driver commutes 20% shorter. It deadlocks a
  little more, with 10–16% more give-ups. On blocks four tiles long the technology blurb's "roughly doubling what a
  busy junction can carry" does not hold. A busy crossroads between long roads, where lights might pay off, is not
  something this test city has.
- **Parking lots barely matter here.** Removing the Commons' four lots changes nothing measurable: most cars find
  a space at their destination. Lots matter where destinations are full, because those cars then park at the
  kerb, which takes a lane slot. The parking "turned away" counts in building tooltips show where that happens.
- **More road is not automatically more capacity.** A ring road two tiles outside the district, joined to every
  street, made things worse (40–60% more give-ups). It added a junction at the end of every street and moved the
  visitor entry points out to its corners. The give-ups cluster where routes funnel: the junctions along the second
  street from the north edge, and the four corner tiles every visitor enters and leaves by. A parallel road can
  only help if it gives those same trips another way in without adding many junctions.
- **The load is mostly visitors and freight.** Cutting car ownership from 0.7 to 0.55 changes little, and
  two-thirds of give-ups are trucks and visitors. Where commercial and industrial zones sit, and so where that
  traffic converges, likely matters more than how many residents drive. This test did not measure that.

## Re-route on cumulative delay

Drivers already re-route when held up: after 10 ticks at a standstill, at an id-staggered cadence (every 25 ticks), if
the alternative costs under 85% of the rest of the route, and never back through the tile behind. The card extended
this to react to **cumulative delay**: when a drive leg starts, the simulation records the leg's expected time
(route cost at departure divided by free-flow speed, `Simulation.startTrack`) and the start tick. A driver whose
elapsed time exceeds that by `delayFrac` (40%) and by at least `delayMinTicks` (20) is *running late*, and
`maybeReroute` then also considers it at the same cadence **even while creeping**, searching up to `delayNodes`
(12,000 instead of 4,000) A* nodes. Everything else is unchanged: the per-tick budget of 40 searches, the 50-tick gap
between tries, the hysteresis (`delayGain`, 0.85), no U-turn through the tile behind, the current lane stays the first
segment, and nothing happens once committed into the next box or past half the lane. After a successful re-route
the leg's expectation is rebased on the new route. At most `delayMax` (3) late re-routes per leg. Walkers are
skipped. It is behind `delayReroute` in `TRAFFIC_TUNING`.

Counts: per citizen per trip (shown in the citizen panel as "Re-routed N times this trip" when N > 0, from the
optional `CitizenInfo.reroutes`) and per citizen per game day (`Simulation.reroutesOf(m)`). The harness reads
`Simulation.rerouteLog` (held-up, late, forced, searches tried for lateness, and a total per game day).

**Result: it does not help on the Commons, so `delayReroute` stays 0 (off).** 24 seeds (1–24), 1,500 ticks, the same
test city and measures as above. Rows differ only in the re-route settings. "Drive commute" is the mean for completed
driver commutes, so cars that gave up are not in it.

**08:00**

| setting | speed % | queued % | give-ups | drive commute (ticks) | held-up re-routes | late re-routes (searches) | re-routes per car | most for one citizen in a day | car–car / tick (as drawn) | car–ped / tick (as drawn) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| off (default) | 34.1 | 58.5 | 197.5 | 67.4 | 116 | 0 | 0.081 | 3 | 0.000 | 0.0094 |
| on, 40% and 20 ticks | 33.5 | 59.3 | 209.2 | 67.8 | 40 | 136 (796) | 0.123 | 3 | 0.000 | 0.0081 |
| on, 80% and 30 ticks | 33.8 | 59.0 | 204.5 | 69.1 | 53 | 118 (645) | 0.120 | 3 | 0.000 | 0.0119 |
| on, 40% and 20 ticks, gain 0.95, max 4 | 33.7 | 59.1 | 209.6 | 67.0 | 41 | 277 (754) | 0.222 | 3 | 0.000 | 0.0086 |
| on, 20% and 10 ticks, gain 1, max 6 | 33.3 | 59.5 | 215.3 | 63.8 | 30 | 576 (916) | 0.420 | 4 | 0.000 | 0.0096 |

**17:00**

| setting | speed % | queued % | give-ups | drive commute (ticks) | held-up re-routes | late re-routes (searches) | re-routes per car | most for one citizen in a day | car–car / tick (as drawn) | car–ped / tick (as drawn) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| off (default) | 37.1 | 56.1 | 116.9 | 56.2 | 68 | 0 | 0.068 | 3 | 0.000 | 0.0058 |
| on, 40% and 20 ticks | 37.0 | 56.3 | 118.4 | 60.9 | 21 | 85 (458) | 0.106 | 3 | 0.000 | 0.0047 |
| on, 80% and 30 ticks | 36.9 | 56.4 | 121.5 | 61.9 | 29 | 78 (396) | 0.107 | 3 | 0.000 | 0.0080 |
| on, 40% and 20 ticks, gain 0.95, max 4 | 36.7 | 56.5 | 123.1 | 55.4 | 21 | 172 (458) | 0.194 | 3 | 0.000 | 0.0060 |
| on, 20% and 10 ticks, gain 1, max 6 | 36.6 | 56.6 | 122.3 | 59.1 | 16 | 340 (529) | 0.356 | 4 | 0.000 | 0.0053 |

Paired by seed (on minus off, mean ± standard error over 24 seeds):

| setting | 08:00 give-ups | 08:00 drive commute | 17:00 give-ups | 17:00 drive commute |
| --- | --- | --- | --- | --- |
| 40% and 20 ticks | +11.8 ± 8.8 | +0.4 ± 2.6 | +1.5 ± 8.1 | +4.7 ± 4.3 |
| 80% and 30 ticks | +7.0 ± 7.6 | +1.7 ± 2.4 | +4.7 ± 6.3 | +5.7 ± 3.5 |
| 40% and 20 ticks, gain 0.95, max 4 | +12.1 ± 9.1 | −0.5 ± 2.4 | +6.3 ± 7.1 | −0.7 ± 3.6 |
| 20% and 10 ticks, gain 1, max 6 | +17.9 ± 9.4 | −3.6 ± 2.0 | +5.4 ± 6.1 | +2.9 ± 3.1 |

Reading it:

- No setting reduces give-ups. Every one has slightly more (up to +9% at 08:00, within about two standard errors), and
  speed is 0.2–0.8 points lower. None improves trip time at both peaks: the most eager setting is 3.6 ticks shorter
  at 08:00 and 2.9 ticks longer at 17:00, and it is measured over completed commutes only.
- Car–car overlaps stay 0 as drawn and by path. Car–pedestrian contacts as drawn stay in the 0.005–0.012 range of the
  off rows (the changes are within the seed noise; none is a trend).
- The late test fires on a large share of ordinary legs: even with the feature off, 41% (08:00) and 38% (17:00) of
  driven legs end more than 40% and 20 ticks later than the free-flow expectation (median elapsed / expected 1.4, 90th
  percentile 4.6), because lights, turns and queues at junction boxes are the normal condition at the peaks. So
  lateness alone cannot separate a jam from a normal trip. What decides is whether a clearly cheaper route exists, and on
  a grid of short blocks the answer is almost always no: the same junctions sit on every alternative.
- The late re-routes mostly *replace* the held-up ones (116 → 40 held-up at 08:00), so the extra re-routes per car
  (0.08 → 0.12) are mostly the same cars being re-routed earlier or on a wider search.
- Cost: a late search is 4,000–12,000 nodes, 500–900 per 1,500 ticks across the whole city, well under one per tick;
  the tick time was not measurably different (noise of ±0.3 ms from other load on the machine).

The setting is kept in case a bigger city has long routes with real alternatives (not tested here): turn it on with `--set delayReroute=1` offline or `delayReroute: 1` in
`TRAFFIC_TUNING`. New tunables: `delayReroute: 0`, `delayFrac: 0.4`, `delayMinTicks: 20`, `delayNodes: 12000`,
`delayGain: 0.85`, `delayMax: 3`. The harness prints re-routes by kind, per car and the most for one citizen in a day,
and the elapsed / expected distribution of the driven legs (`legs` and `reroute` in the JSON).

Live dev server (feature off), probe-obb.mjs over 60 s after 15 s, late afternoon (229 cars at most): car–car 0, car–pedestrian 0.087 per frame.

## Buses

Buses (docs/transit.md) are 0.6-tile vehicles in this traffic model. They pull in on the stop's road tile in their lane,
so everything behind them waits. The harness lays the test network with `ab.ts --set bus=3`: a depot and twelve stops
on two lines over the Commons (a six-stop loop round the inner ring, a six-stop there-and-back line down the middle
street), three buses per line. The depot and stops replace 18 zoned tiles, so the city has about 73 fewer citizens.
**`busTiles=1` is the fair control**: the same tiles taken, no lines run. Six seeds (1–6), 1,500 ticks from 08:00 and
from 17:00. "Cars" counts vehicles on the road per tick excluding buses. "Trip" is every trip, door to door. Overlaps
are true body overlaps per tick; bus–car overlaps are included in car–car and also counted on their own.

**08:00**

| run | citizens | trips | by transit | transit trips | trip mean (ticks) | transit trip mean | cars mean | cars peak | buses | give-ups | speed % | car–car | bus–car | car–ped | car–ped as drawn | boarded / gave up waiting / buses withdrawn | calls / stops passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no buses (Commons as is) | 945 | 1664 | 0% | 0 | 47.9 | – | 94.5 | 142 | 0 | 199.0 | 34.0 | 0.000 | 0.000 | 0.0063 | 0.0094 | – | – |
| control: depot and stops, no lines | 873 | 1523 | 0% | 0 | 45.5 | – | 89.7 | 136 | 0 | 150.8 | 36.3 | 0.000 | 0.000 | 0.0057 | 0.0087 | – | – |
| buses, 3 per line | 872 | 1525 | 0.43% | 6.0 | 47.0 | 326 | 89.4 | 133 | 5.3 | 172.5 | 34.5 | 0.000 | 0.000 | 0.0036 | 0.0073 | 5.3 / 1.5 / 5.7 | 8 / 138 |

**17:00**

| run | citizens | trips | by transit | transit trips | trip mean (ticks) | transit trip mean | cars mean | cars peak | buses | give-ups | speed % | car–car | bus–car | car–ped | car–ped as drawn | boarded / gave up waiting / buses withdrawn | calls / stops passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no buses (Commons as is) | 946 | 1202 | 0% | 0 | 47.2 | – | 56.8 | 130 | 0 | 122.5 | 36.9 | 0.000 | 0.000 | 0.0039 | 0.0059 | – | – |
| control: depot and stops, no lines | 873 | 1120 | 0% | 0 | 44.7 | – | 54.1 | 129 | 0 | 90.7 | 38.7 | 0.000 | 0.000 | 0.0019 | 0.0032 | – | – |
| buses, 3 per line | 873 | 1133 | 0.16% | 3.0 | 45.9 | 404 | 53.3 | 124 | 3.1 | 85.2 | 39.0 | 0.000 | 0.000 | 0.0019 | 0.0030 | 1.8 / 0.2 / 2.0 | 4 / 88 |

Buses against the control, paired by seed (mean ± standard error over six seeds):

| | give-ups | speed points | trip mean (ticks) | cars on the road | car–ped per 1,000 ticks |
| --- | --- | --- | --- | --- | --- |
| 08:00 | +21.7 ± 9.2 | −1.8 ± 0.8 | +1.5 ± 0.9 | −0.2 ± 1.5 | −2.1 ± 0.8 |
| 17:00 | −5.5 ± 6.7 | +0.3 ± 0.6 | +1.2 ± 0.6 | −0.8 ± 1.4 | +0.0 ± 0.8 |

Reading it:

- **Bodies stay apart.** Car–car and bus–car overlaps are 0 in every run, by path and as drawn. Car–pedestrian contacts
  do not rise: lower at 08:00, unchanged within noise at 17:00. Riders waiting at a stop stand on the stop tile, off the
  carriageway, and riders on board are inside the bus, not counted as pedestrians.
- **Hardly anyone takes the bus in the Commons, and that is the model working as written, not a fault.** About 0.4% of
  trips at 08:00 and 0.16% at 17:00 go by transit, a handful of riders per run. Three things in the Commons work against
  buses. Commutes are to the nearest job (median 3 tiles, 90th percentile 8), and only trips of 7+ tiles are offered
  the bus. In this congestion a bus moves at about walking pace, junctions every five tiles. And the walk to a stop and
  the wait use up most of what a bus saves on trips this short. Transit trips take 330–400 ticks door to door, against
  about 46 for all trips: the people who choose the bus are on the long trips.
- **The buses cost the morning peak a little.** Against the control, give-ups are up by about 22 at 08:00 (two standard
  errors) and speed is down 1.8 points: five long vehicles on a saturated grid, each holding a lane when it stops. At
  17:00 there is no difference. At 08:00, against the control, the steps were:

  | version | give-ups vs control | buses withdrawn per run |
  | --- | --- | --- |
  | first version: a bus stops at every call, a stuck bus waits twice the stuck limit | +44.8 | 2.0 |
  | request stops (pull in only for someone getting off or waiting) | +48.7 | 1.5 |
  | the same with a car-length bus (0.34 instead of 0.6), sensitivity only | +29.9 | 1.0 |
  | request stops, a stuck bus withdrawn at the stuck limit with no re-route, sensitivity only | +17.9 | 8.3 |
  | request stops, one way round at the stuck limit, withdrawn ten ticks later | +35.3 | 5.5 |
  | **shipped**: the same, and drivers on their way in count at a shift change (no buses called in and sent out again) | **+21.7** | 5.7 |

  The standard errors are 9–19, so only the overall direction is firm. Request stops take the dwelling out (at
  Commons ridership a bus now passes about 95% of its calls) but do not measurably change give-ups. Treating a stuck
  bus like a stuck car does, and so does keeping the fleet steady through shift changes. Withdrawing a bus at the
  limit, with no re-route first, looked better still, but it also withdraws a bus about every three game hours and
  sets its riders down mid-route. The shipped rule tries the way round first. No anti-bunching hold happens while
  anything is queued behind the bus.
- **Cars on the road do not fall.** Ridership is too low to take cars off. The bus share is mostly people without a car
  on long trips, and car owners only consider the bus when the car is at home and the trip is long.

Where buses should earn their keep: bigger cities with longer trips, owners who put stops where homes are dense and
jobs are far, and roads that are not already saturated. The 4×4 load test with a depot and two lines in every district
(`run.ts --bus 3`, docs/load-tests.md) shows what 32 lines and about 70 buses cost the tick.

Live, in a standalone 1×1 test city (the Commons plus a player's 18×22 plot east of it, with a depot, eight stops and
two lines, about 1,380 people), `probe-obb.mjs` (bus length added: `LEN[3] = 0.6`) over 60 s after 15 s: car–car 0 with
up to 5 buses and 256 cars on the road. Car–pedestrian contacts were 0.11 and 0.36 per frame in two runs; a breakdown
of the second (`probe-obb-bus.mjs`) found none involving a bus and none involving anyone waiting at a stop. That city
had become very congested (68–81% of vehicles queued).

### Turning round (2026-10-17)

Bus laps may now turn round (docs/transit.md "The lap"): a three-point turn that has the whole box to itself, and a bus
held at its stop line before a junction instead of overshooting it on entering the lane. The first scenario run
(`loadtest/busroutes.ts`) gridlocked a stub with a turn at each end: a bus coming out of its three-point turn in a
junction mouth was held by the body guard against a bus waiting in the side road whose nose was 0.13 into the box
(a 0.6-tile bus enters a lane up to 0.3 in, past its 0.17 stop line), and that one waited for the box. With the cap,
no bus is withdrawn there.

A/B on the Commons, `ab.ts --ticks 1500 --set bus=3`, six seeds at 08:00 and at 17:00, the build before 49fd1fb against
this work (with `busTiles=1`, no lines, the two ran identically in a first, shorter A/B). A first version planned
the there-and-back line round a 2×2 square of road at its south end (4 tiles, 6 shorter than round the block), a turn
round squeezed through two junction boxes, and cost about 1.4 speed points; two turns the same way on neighbouring tiles
now cost a lap 20 more (`DOUBLE_TURN`, sim/busroute.ts), so it goes round the block again (110 tiles, as before).
No bus turns round in these runs. Paired differences, mean ± standard error over six seeds:

| | speed points | give-ups | trip mean (ticks) | buses withdrawn | ms/tick |
| --- | --- | --- | --- | --- | --- |
| 08:00 | +0.1 ± 0.4 (28.8 → 28.9%) | +6 ± 20 | −0.9 ± 1.3 | −0.7 ± 1.5 | +0.18 ± 0.17 |
| 17:00 | +0.9 ± 0.9 (32.6 → 33.4%) | −19 ± 15 | −3.5 ± 3.9 | +0.2 ± 0.9 | −0.09 ± 0.07 |

No loss against the build before: every difference is within its noise.

## Roundabouts and flyovers

Two junction types beyond give-way and lights (2026-10-17; design in docs/structures.md section 4, code in
`shared/src/junctions.ts`): a **roundabout**, a 3×3 one-way ring round an island (anticlockwise, traffic drives on the
right), and a **flyover**, a crossroads tile whose two roads are on different levels.

**Bench.** `packages/server/src/loadtest/junctions.ts` builds one crossroads (arms 10 tiles each way to a dead end) four
ways, runs the real traffic model on it with Poisson demand from the four ends, and measures 20 game hours after a
300-tick warm-up, 3 seeds. Demand is cars per game hour over all four approaches. "Straight" sends every car straight
over; "turns" 60% straight, 20% right, 20% left. Delay is game minutes per completed trip beyond free flow, counting
the wait to get on; give-ups are the stuck rule; overlaps are true car-car body overlaps per tick (oriented
rectangles; a car on the deck and one on the road beneath never count). There are no pedestrians in the bench.

```sh
npx tsx packages/server/src/loadtest/junctions.ts --rates 15,25,35,50 --seeds 1,2,3 --ticks 2000 --mix turns
npx tsx packages/server/src/loadtest/junctions.ts --rates 25 --kinds roundabout --set ringYield=0   # one knob
```

Straight over (demand / served throughput / mean delay in game minutes):

| demand / h | give-way | signals | roundabout | flyover |
| --- | --- | --- | --- | --- |
| 60 | 59 / 3.0 min | 59 / 11.8 min | 60 / 4.4 min | 59 / 1.2 min |
| 100 | 79 / 135 min | 67 / 221 min | **85** / 71 min | **96** / 2.1 min |
| 140 | 74 / 326 min | 62 / 407 min | 80 / 281 min | **137** / 7.2 min |
| 200 | 65 | 52 | 72 | **146** / 171 min |

With turns (the flyover serves only the straight 60%: nobody can turn there, so turning cars have no route through
it and drive round by the next junction in a real city):

| demand / h | give-way | signals | roundabout | flyover (straight share) |
| --- | --- | --- | --- | --- |
| 60 | 59 / 8.6 min, 1 give-up | 51 / 98 min, 10 | **60** / 4.6 min, 0 | 36 of 36 / 0.9 min |
| 100 | 62 / 252 min, 15 | 46 / 387 min, 15 | **81** / 99 min, 0 | 59 of 60 / 1.2 min |
| 140 | 55 / 430 min, 22 | 40 / 556 min, 14 | **76** / 310 min, 0 | 84 of 84 / 1.8 min |
| 200 | 48, 18 | 31, 11 | **67**, 0 | 117 of 120 / 3.4 min |

Car-car body overlaps were 0 in every run. Readings: a flyover carries straight traffic with almost no delay up to
about 140 cars an hour (the arms, not the crossing, are then the limit). A roundabout carries about 30% more than a
give-way crossroads with turning traffic and twice what fixed-time lights do, with no give-ups; with straight traffic
only it is about 8% ahead of give-way. Lights do worst here: symmetric flows and no pedestrians are the case where
fixed-time phases only add waiting, so this bench says nothing about what they do in a city.

**The roundabout knobs** (`TRAFFIC_TUNING`, turns, 3 seeds, at 100 and 140 cars an hour: throughput, give-ups):

| setting | 100 / h | 140 / h | note |
| --- | --- | --- | --- |
| defaults (`ringYield` 0.7, `ringMerge` 1, `ringSlow` 1, `ringSpare` 4) | 80, 0 | 75, 0 | |
| `ringYield=0` (first come, first served) | 0, 358 | 0, 375 | the ring fills with cars coming on and locks within the hour |
| `ringYield=0.4` | 75, 24 | 65, 43 | too short a gap: cars squeeze on and the ring stalls |
| `ringYield=1.2` | 72, 1 | 67, 1 | too cautious |
| `ringMerge=0` (plain junction box rules on the ring) | 62, 0 | 56, 3 | a car joining waits until the one ahead is out of the box |
| `ringSlow=0.8` (slow for the turns on and off) | 69, 0 | 63, 3 | |
| `ringSlow=0.6` (as at a plain junction) | 39, 93 | 31, 94 | slow joiners hold the merge box so long the ring jams |
| `ringSpare=0` / `2` | 80, 0 | 74, 2 | rare locks of a full ring |
| `ringSpare=8` | 68, 5 | 62, 6 | the ring kept half empty |

What had to change for the ring to work in a tile-box model, in the order it was found: give way only to a circulating
car that **stays on the ring past the entry** (cars leaving by that arm never cross the joiner; yielding to them too cut
throughput by half); treat joining the ring lane behind a car already out in it as **following** (`ringMerge`); never
let the ring **fill** (`ringSpare`: with every lane round it at capacity each car waits for room in the next and none
ever moves, a real gridlock the bench reproduced in a few minutes); the ring's corners are wide (radius 0.69 tile) and
cost no speed. Pedestrians cross the arms, not the ring: a car going round never drives over a crossing there, so
people on it hold only the cars coming on or leaving, and a walk round a corner follows the outer kerb instead of
counting as a diagonal crossing of the box.

**Live** (the showcase demo, standalone on port 8297, with the roundabout at (-20, -6) and the flyover at (-25, -1),
bus line 1 on the deck and line 2 under it): `probe-obb-junction.mjs` (probe-obb.mjs that skips deck-over-road pairs and
counts near each junction) over 90 s with about 11 cars around each junction per frame: car-car 0 everywhere, car-ped 0
near the flyover and 0-2 near the roundabout. A scan of the server sim (3,400 ticks of the showcase) found no car going
the wrong way round the ring and none turning on the flyover.
