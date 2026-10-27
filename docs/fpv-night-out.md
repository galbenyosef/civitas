# The night out in first person

Playtest card f425e885: "civs who have been out to dinner and/or drinking should have blurred FPV", then "make it a lot
blurrier please - depending on how long they were out for". Built 2026-10-27. Rules in `client/src/render/nightout.ts`
(pure, checked by `client/scripts/nightout-check.ts`), the picture in `client/src/render/fpv.ts`, the hours from the server.

## Where the hours come from

The server records the tick a citizen sat down at an ordinary venue (`Citizen.venueSince`, set in `arriveVenue`; not saved,
a loaded world has everyone at home) and says on the citizen inspect (`CitizenInfo.night`, additive, protocol VERSION 8):

```ts
night?: { hours: number; drinks: boolean }
```

`hours` is game hours at the venue so far, 0 on the way there. `drinks` is a café, bar or restaurant visit begun between
16:00 and 04:00 that is not a coffee before a shift; a cinema, theatre, park, sports hall or library is not a drink, and the
doctor, school gate, class and funeral send no `night` at all. Nothing is added to the agent stream. The client stamps each
inspect with the game hour it arrived at and carries the hours on with the clock until the next one (once a second).
An older server sends no `night`: the client then reads the evening from the activity line as before (arrival guessed, an
hour or so for someone first seen already at the bar), on the same curve.

Cafés and bars are one kind of building in the sim (the activity line says "out at a bar" from 16:00), so `drinks` is by the
hour of arrival, which also keeps a citizen swimming past midnight, when the line would say "at a café".

## The curve

Effective hours are the hours out times the citizen's weight (`peak`, hashed 0.7 to 1.3: a lightweight is where an average
person is at 70% of the time). Strength 0..1 is a cubic through the targets and is capped from three hours.

| hours out | strength | blur px at 720p | double image px | sway px | HUD |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.22 | 2 | 3 to 5 | 1.5 to 2.5 | a little tipsy |
| 2 | 0.55 | 5 | 8 to 12 | 4 to 6 | tipsy |
| 3 and more | 1.0 | 8 to 10 | 14 to 22 | 7 to 11, plus a lurch | very drunk |

Blur, double image and sway are hashed per citizen (organic rule) and multiplied by the strength. The HUD words follow the
strength, not the raw hours: "a little tipsy" under 0.37 (an hour and a half), "tipsy" to 0.76 (two and a half), "very drunk"
above, easing back down the same words on the walk home. The sway slows as they get drunker (the period is up to 1.8 times
longer at full strength) and its phase is accumulated on the CPU, so it never jumps when the strength moves. Above 0.55 the
picture now and then lurches to one side and comes back.

## The walk home

The view eases off over `walkHoursFor(strength)`: 0.5 game hours for a light evening up to 1.5 for a heavy one, or by how
far along the leg is when the server says (`tripDone` over `tripTotal`, only for a last leg: a bus or lift leg's end is not
the door). Someone who left at three hours or more is held back from clearing before the door.

## The picture

The blur is two small passes, so a 10 px blur does not cost dozens of taps for every pixel of the window: the scene target is
boxed down to half its size across for a light blur (below strength 0.3) and a quarter for a heavy one, then a disc of up to
twelve taps (at least a texel wide, so the box's steps go) softens that small picture; the blit mixes the sharp and soft pictures by strength and reads the soft one with a tap or two (the second
image too). The small inset skips the second pass and takes the disc in the blit. The full window's target is drawn at 0.85 of
the window's pixels while the swim is light, 0.7 from strength 0.12 and 0.55 from 0.4 (back down 0.04 under those), which makes
the scene cheaper as well.

Measured with timer queries on the in-game frame (a Mac whose GPU other work was sharing, window 1381x707 at pixel ratio 2, a
citizen forced to full strength with `msc.fpv.swimDebug = 1`, frames alternated with the blur on and off in blocks of 24 so the
drift cancels, median of each block): the blur's own GPU cost over the same frame with the blur off.

| | before (main's 6-tap shader) | after (two small passes) |
| --- | --- | --- |
| full window, heaviest | +0.08 ms (three runs, 0.04 to 0.14) | +0.04 ms (four runs, -0.18 to +0.23) |
| inset, heaviest | about 0 (-0.24 to +0.05) | +0.13 ms (three runs, 0.07 to 0.17) |
| sober | nothing (one tap, the `uSwim > 0.002` branch) | nothing |

Both are far under the 0.4 ms budget; run to run the noise is of the same size as the cost. The full window also gets cheaper as
a whole when drunk, since its scene target is drawn at 0.55 of the window instead of 0.85. A scene that has a few NaN pixels
(some material's lighting) is why the first pass skips non-numbers: a plain box would have spread each into a black patch.

`npx tsx packages/client/scripts/nightout-check.ts` is the rule check; `npx tsx packages/server/src/loadtest/nightout.ts`
runs a test city for two days and checks the server side.
