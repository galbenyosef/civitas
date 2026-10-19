# Incidents v1: house fires

Card c46399ac (docs/audit-2026-10.md section 8, card 3). Code: `server/src/sim/fires.ts` (the rules), `shared/src/fires.ts`
(tuning `FIRE`, the wire format `FireDTO`), `client/src/render/fires.ts` (the drawing), `server/src/loadtest/fires.ts`
(the probe). It builds on the fire family's size ladder (fire post, station, large station, headquarters,
`shared/src/buildings/civic-tiers.ts`) and on the priority vehicles the call-outs already used.

## What happens

1. **A fire starts.** Every built home and works (residential, commercial, industrial, office; not a block's garden, not
   a lot with builders on it) is rolled once a game hour, a slice of the built-building lists each tick, as the
   dispatcher rolls freight. The roll is a hash of the tile, the hour and the world seed, not `Math.random`, so a run is
   the same for a given world. The chance is `FIRE.perDay / 24` times the building's weight:
   - **density**: its level (a 1×1 lot), or a merged building's places over six (about six a level per lot);
   - **age**: `youngRisk` (0.4) for a new building, rising in a straight line to 1 over `matureDays` (10). Ages are kept
     only for buildings younger than that (saved); one first seen in the first game hour of an older world is mature;
   - **cover**: `coveredRisk` (0.6) in reach of a staffed fire engine (smoke alarms, inspections).

   At most `maxPerOwner` (2) fires burn at once in one owner's parcels and `maxWorld` (12) in the world.
2. **The engine turns out.** The nearest staffed fire building (by road-free distance) whose reach covers the fire, with
   an engine at home, sends it: reach is `FIRE.reach` (14 tiles, square, as service cover) or the station's own cover when
   that is wider. A post keeps one engine, a station two, the bigger rungs more (twice their call-out rate). The engine is
   the existing priority vehicle (blue lights, through red signals and round a roundabout without giving way) and pulls
   up at the door rather than looking for a space. Two things are new for every vehicle on blue lights, call-outs
   included: it pulls out of its station into the forecourt and waits there for a gap instead of staying in the garage
   until the road has room (`sim/traffic.ts` enter), and **once traffic has stopped it for 8 ticks it drives on down the
   middle of the road** at 60% of a car's speed, out of the lanes, until it arrives (`Simulation.weave`). Without that,
   an engine in the 1×1 Commons at the evening peak waited up to four game hours to leave the garage. A fire next door
   (three tiles or less, too short a route to drive) gets the crew on foot five game minutes later. An engine lost on the
   way (despawned in a jam) is replaced from the next station in reach, three tries at most; a station that comes on
   shift later is asked every 25 ticks.
3. **The fire's course.** Unattended, the share burnt is `(t / burn) ^ growth`: slow while it smoulders, fast once it has
   spread (`growth` 2.5, `burn` a hashed 0.85-1.2 of `burnHours`, 4). When the engine parks the share is frozen (never
   under `minDamage`, 0.12: smoke and water) and the crew take `fightHours x (0.4 + share)` to put it out; the engine stays
   until then. Growth leaves a burning building alone (no upgrade, no merge into or out of it).
4. **Out.** Attended: the building loses `floor(level x share)` levels (a merged building never below its first level)
   and the owner pays `costShare` (0.5) of its book value (`parcelops.ts buildingValue`) times the share, filed as
   **Fire damage** (ledger category `fire`). Unattended: it burns out. A lot goes back to an empty lot of its zone, a
   merged building breaks back into lots (`World.removeStructure`), its people leave, and the owner pays `costShare` of
   the whole value. The lot regrows as any empty lot does.

Measured in the 1×1 Commons (probe, three seeds, 72 covered fires at all hours): engines arrive in 29-31 game minutes
on average, 57 at worst; every covered home kept its level (the bill is the 12% minimum), every uncovered one burnt out.

## Fairness in the first hour

The product goal is a fun entry-level city builder, and a fire must never punish a player who has not reached fire
services. Fire posts come with Emergency services (civ1: 20 housed, $400; the goal "Police and fire cover" asks for one).

- **The warning fire.** A player's first fire comes a hashed `warnMinHours` to `+ warnSpanHours` (3-9 game hours, a
  minute or three of real time per hour) after they first house `warnHoused` (12) people. It is always survivable: when no
  engine is in reach the neighbours' bucket chain has it under control at 15% burnt, and either way it loses no level;
  the bill is small. It comes with the advisor hint `fire` (an alert: dismissible, it still shows after the tutorial is
  skipped) that names the fire post and Emergency services and offers the fire post tool.
- **The grace day.** Ordinary fires start in a player's parcels `graceDays` (1) after the warning fire, and only once the
  player has met Emergency services' condition (20 housed), so they could have bought it. A player who never buys it gets
  fires then; they have been told.
- **The Commons** burns from the start (`FIRE.commons`): its stations answer, and in the live world its badges stay hidden
  as all its issue badges do.
- Fires never start during a test city's or demo's fast fill, so the towns fill as before.

## What the player sees

- **On the building**: flames over the roof (5-9 tongues), soot rising and drifting downwind, an orange glow that carries
  at night, and a scorch on the ground. Following the organic-effects rule each tongue has its own height, width, flicker
  rate and phase, sway and place on the roof; each puff its own clock, rise, size, heading off the town's wind and wobble;
  each fire its own count of each and its own scorch outline, all from hashes. Size follows the fire's own course: it
  grows as it takes hold; under the hoses the flames die back and the smoke turns to pale steam; afterwards the ruin
  smoulders for `aftermathHours` (6) and the scorch fades (darkest where it burnt down). `client/src/render/fires.ts`,
  four instanced passes, one draw call each.
- **The engine** on the road in fire red with its lights, weaving down the crown of the road past a stopped queue.
- **The badge and the problems list**: code 7, **On fire** (a flame glyph, `shared/src/issues.ts`), set the moment the
  fire starts and cleared when it is out, not on the issues' quarter-hour round; it outranks every other code and is the
  first group in the problems panel. It shows only while the fire burns (an hour or so), and a fire leaves no badge
  behind (a burnt-out lot is an empty zoned lot), so fires do not add to the badge flood.
- **The building's panel**: a Fire row ("On fire: the fire crew are on their way", "burnt out", "Fire damage: 1 level
  lost").
- **Toasts** for the owner when a fire starts (who is coming, or that nobody is) and when it is out (what was lost and
  the bill). The warning fire's start is the advisor hint instead.

## Wire and save

- `{ t: 'fires', f: FireDTO[] }`: every fire burning, being put out or in its aftermath, broadcast whenever the list
  changes and sent on join. A fire: door `x, y`, seed `s`, phase `ph` (0 burning, 1 being put out, 2 out), `t0` and `burn`
  (ticks), `d` (share burnt when help came), `ta` (tick help came), `t1` (out, or will be), `eng` (an engine on its
  way), `out` (0 saved, 1 partial, 2 burnt out), footprint `w, h`. The client works out how far it has got from the clock.
- `BuildingInfo.fire`: the panel's words.
- Snapshot `fires` (optional, no version bump): the fires burning or in their aftermath, young buildings' ages (only
  those under `matureDays`), each player's warning (`warnAt`, `warned`). Engines are not saved; a loaded fire sends
  another.
- `FIRES=0` (index.ts) switches fires off on a server (an A/B control). A sandbox opt-out per owner is not built yet.

## The demo

The showcase's civic district has a fire drill: the level-3 house at (-29, -31), five tiles from the fire post at
(-24, -29), catches light again `drillGapHours` (0.6) after each drill fire is out, and costs nothing. Tour stop
**House fire** (after the fire post); the feature `house-fire` in `SHOWCASE_FEATURES`, whose seeded test checks the drill
home stands with a fire building in reach. `demoFireDrills(id)` reads the scenario's `house-fire` spots; index.ts hands
them to the Fires module.

## Checks

`npx tsx packages/server/src/loadtest/fires.ts [--seed 1] [--n 24]`: a 1×1 Commons with its fire station swapped for a
fire post, filled for a day. Covered homes (within 14 tiles of the staffed post), one at a time: each loses under half
its level, an engine arrives for each, the badge shows and clears, the ledger carries the bill. Uncovered homes burn
out and nobody is left in them. A save with a fire burning loads with it burning and sends an engine. A player's district
gets its warning fire 3-9 h after the threshold, saved with nothing lost with the post mothballed and staffed, and no
other fire in the grace day. A 2×2 Commons over two days has a few fires, and the same ones from the same seed.

## Measurements

See the card's report: the probe's counts, bot B's first fire on a fresh world, and the tick A/B on the 2×2 test city
against main (section below).
