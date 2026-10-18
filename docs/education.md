# Education: schools, qualifications and the education tree

Card "we need an education tree etc" (UTD 851126b0). Rich: "do we have the notion of age and school etc? We also need
schools, high schools, sixth form, colleges, universities etc." and "lets consider the education of the population and
an education tree / progress for them". Design 2026-10-18. **E1 (the citizen model and the wire) is built**: see
section 12 for what it provides. The rest is design. Rich has not answered section 11 yet, so the build follows the
recommended answers (A to every question). **E2 (the institutions catalogue, section 3 "Built in E2" and the tech track in section 6) is built** too,
and so is **E3 (the schools simulation, section 13)**: children are admitted, walk (or are taken) to school, attend, sit
results and move up a stage.

Code this touches: `shared/src/education.ts` (new: levels, stages, tables), `shared/src/buildings/education.ts` (new:
the kinds), `server/src/sim/schools.ts` (new: admissions, attendance, graduation), hooks in
`server/src/sim/simulation.ts`, `server/src/sim/life.ts`, `server/src/world.ts`, `server/src/snapshot.ts`,
`shared/src/protocol.ts`, `shared/src/tech.ts`, `shared/src/history.ts`, and the client panels.

## 1. Today

**Age: yes. School: no.**

- **Age.** Every citizen has `born`, a fractional game day (`server/src/world.ts` `Citizen.born`). `ageOf` in
  `server/src/sim/life.ts` turns it into years at `LIFE.daysPerYear = 7`: one game week is one year of age. `stageFor`
  gives the `LifeStage` (`shared/src/protocol.ts`: Adult 0, Child 1, Retired 2): a child under `LIFE.adultAge` (18),
  retired from 62 to 68 (`retireAgeOf`, hash-seeded per id). The stage is refreshed once a game day by
  `Simulation.lifeStep`, rides in the agent wire flags (bits 12-13), and shows in `PersonRow.age/stage` and
  `CitizenInfo.life` (`describeLife`).
- **Births and deaths.** Couples living together aged 20-45 have babies (`lifeFamily`, `LIFE.birthPerDay` 0.03, at most
  3 children), born at age 0 by `spawnChild`. Children inherit the household and surname, and they leave town if no
  grown-up is left at home (`lifeStep`, `orphansLeft`). People die of old age from 65 on (`deathChance`).
- **Newcomers are always single adults aged 18-45** (`seededAge(id, LIFE.newcomerMin, newcomerMax)` in `spawnCitizen`
  and `arriveVia`). No family moves in with children.
- **So there are few children, and all of them are young.** `loadtest/lives.ts --districts 1 --weeks 4` (run for this
  doc): 1,497 people, 40 children (2.7%), all under 10. Nobody in town is 10-17, because a child born today turns 18
  after 126 game days (16.8 hours of wall time at 8 minutes a game day).
- **What children do all day.** They stay at home (`activityOf`: "at home"), come along on a parent's outing
  (`bringCompany`, `LIFE.childJoins`), and from age 8 (`CHILD_OUT_AGE`) go alone by day (09:30-17:30) to a free park
  or library within 14 tiles (`maybeChildOuting`, `CHILD_TRIP_MAX`). They pay no tax, ride transit free
  (`sim/transit.ts` fare), own no car, and their occupation reads "child".
- **Nothing resembling school exists.** The `education` group is reserved in `shared/src/buildings/groups.ts` (label
  Education, holds "pupils") with no kinds. Libraries are leisure venues (tech `cul1`). The only "school" in `tech.ts`
  is `civ6` Medical school, which unlocks the teaching hospital, a health building. `docs/feature-gaps.md` lists
  education as a gap ("Citizens have no skills"), and `docs/structures.md` sketches a 6×6 university campus.
- **The client is ready for pupils.** `client/src/render/people.ts` dresses 55% of children who are dressed for work in
  a school jumper with a backpack. No child is ever in a work state, so no one wears it today.
- **Jobs need no skill.** `Simulation.findJob` hires the nearest vacancy by road. `hire` takes the workplace's
  occupation and shift. `payWage` pays `wageOf(kind, level)` per 8-hour shift: offices 20/26/32 by level, industry
  14/19/24, shops 15/20/25. A building grows only when 70% occupied (`growth`), and residential demand is
  `jobs - population + 6`, where `population` counts children and retirees too.
- **Charts** (`shared/src/history.ts`) have no age or education series. Rings match series by key, so new keys need no
  save bump.

## 2. The citizen model

### Age and birthday

Keep `born` and `ageOf` as they are. A citizen's **birthday** is `mod(born, 7)`: a weekday and hour of the game week,
because a game week is a year. For newcomers it already comes from the id (`seededAge` hashes `id` with 211 and 213,
and the fraction lands anywhere in the week). For babies it is the real moment of birth. The panel shows
"9, turns 10 on Thursday". **Year group** (UK rule: aged 4 by the start of the school year is Reception) is
`floor(ageAt(weekStart)) - 4`, where `weekStart` is the Monday 00:00 of the current game week. It is a pure function,
so it is never stored.

### Education level

A small ladder, `EduLevel` in `shared/src/education.ts`:

| Value | Level | UK meaning | Earned at |
| --- | --- | --- | --- |
| 0 | none | no qualifications | |
| 1 | primary | left primary school | primary, age 11 |
| 2 | secondary | GCSEs | secondary school, age 16 |
| 3 | further | A-levels, or a vocational Level 3 (BTEC, T-level) | sixth form or FE college, age 18; adult courses |
| 4 | degree | bachelor's degree | university, 3 years |
| 5 | postgraduate | master's or PhD | university or research institute |

Attending nursery is not a level. It is one flag bit that raises the chance of passing primary.

**Track** (optional, `EduTrack`): 0 none, 1 STEM, 2 arts and business, 3 trades. It is chosen at 16: sixth form leads
to 1 or 2, FE college to 3. The choice is hash-seeded and leans toward the open skilled vacancies near home. A degree
keeps its track. The track adds gameplay only through the match bonus in section 7. It is stored from phase E1 so the
later phases need no migration, and has no effect until phase E4.

### Storage

New `Citizen` fields (`server/src/world.ts`), all plain numbers:

| Field | Meaning |
| --- | --- |
| `edu` | `EduLevel`, the highest completed |
| `track` | `EduTrack` |
| `study` | the stage enrolled in: 0 none, 1 nursery, 2 primary, 3 secondary, 4 sixth form, 5 FE course, 6 degree, 7 postgraduate, 8 evening class |
| `sx`, `sy` | the door tile of the place of study (meaningful while `study > 0`) |
| `att`, `due` | days attended, and school days held, in this stage so far |
| `eduBits` | bit 0 went to nursery, bit 1 dropped out (shown in the panel) |

A pupil has no job, so the timetable fields (`shiftStart`, `shiftLen`, `cycle`, `phase`, `nextAt`) are free for the
school day. Section 4 relies on this.

**Saves need no format bump.** `snapshotOf` writes citizens as plain objects, and `worldFromSnapshot` loads them as
`{ ...lifeDefaults(...), ...saved }` (`server/src/snapshot.ts`). Add `...eduDefaults(saved.id, age)` beside
`lifeDefaults`. It seeds a pre-education citizen from the id: adults from the base distribution below, and children
by age (a 13-year-old has `edu: 1`). Version 8 stays. Building counters (`pupils`, `qualified`) are rebuilt on load
from the citizens, as `occupants` is.

**Base distribution for adults** (newcomers and old saves; roughly England 25-64):

| Level | none | primary | secondary | further | degree | postgraduate |
| --- | --- | --- | --- | --- | --- | --- |
| Share | 6% | 2% | 22% | 27% | 30% | 13% |

Newcomers aged 18-21 never hold a degree. Section 7 explains how migration tilts this mix.

### On the wire

- **Agent frames:** bit 25, `CITIZEN_STUDY` (built in E1): on the way to, at, or on the way back from a place of study.
  Bits 26-30 stay free (`protocol.ts` comment, `docs/mobile-jobs.md` section 7). Pupils travel in `ToWork`, so `dressFor`
  already dresses them for school. The bit lets the client tell a pupil from library staff (both send family code
  14) and draw students with a backpack and no uniform. Older clients ignore the bit.
- **Inspect only:** `CitizenInfo.life.education = { level, track?, studying?: { place: {x, y, name}, stage, yearGroup?, attendance, progress }, history: { stage, place, year, result }[] }`
  and `PersonRow.edu`. `history` is rebuilt from the current fields plus a capped list of at most 6 entries
  (`eduLog`), saved like `friends`.
- **Buildings:** `inspect` gains `school: { stage, pupils, places, teachers, teachersNeeded, catchment, passRate, waiting }`.
- **Parcels:** `ParcelStats` gains optional `pupils`, `places`, `grads` (residents with a degree or more) and
  `eduIndex`, so the parcel panel and the world map show attainment by district.

## 3. Institutions

### The family code

All 16 family codes are taken (`shared/src/buildings/codes.ts`). Education kinds are **sub-kinds of the library
family, code 14**. Libraries are already where people go to learn, and the family already holds non-leisure kinds
(the Tower of London and Buckingham Palace are library-family attractions, `docs/buildings.md` "Landmarks"). Two
groups may share a code: harbours and metro both use 15. A school is not leisure (`isLeisure` is by id, from leisure
attributes, so it is false), and it is not flagged `service`, so `coverage()`, happiness and tax tolerance stay as
tuned. Schools get their own catchment (below). The `LEISURE_CODES` loops (`leisureCoverage`, `leisureGrowth`,
`pickLeisure`) will visit schools and drop them at `leisureAt` returning null. That costs little, but phase E2 should
check it. The client's `SHORT[14]` label "at the library" (`client/src/ui.ts`) needs the kind id, not the family
code, for school staff.

### Kind ids

Ids 29-39 are reserved (boats, transport cards), and the highest id in use is 100 (Tower Bridge). Education takes
**101-115**:

| Id | Kind | Rung | Footprint | Ages | Places | Staff (teachers share) | Cost / upkeep | Catchment | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 101 | nursery | 1 | 1×1 | 3-4 | 30 | 6 (0.5) | 300 / 10 | 8 | edu1 |
| 102 | primary school | 2 | 2×2 | 4-11 | 120 | 10 (0.6) | 900 / 30 | 12 | edu1 |
| 103 | secondary school (academy) | 3 | 3×3 | 11-16 | 300 | 24 (0.6) | 2,000 / 60 | 20 | edu2 |
| 104 | sixth-form college | 4 | 2×2 | 16-18 | 120 | 10 (0.7) | 1,400 / 40 | 24 | edu3 |
| 105 | further-education college | 5 | 3×2 | 16+ | 160 day + 60 evening | 18 (0.5) | 2,400 / 70 | 30 | edu3 |
| 106 | university campus | 6 | 6×6 | 18+ | 600 | 60 (0.6 degree, 0.4 postgraduate) | 7,000 / 180 | none (city-wide, and draws newcomers) | edu4 |
| 107 | research institute | 7 | 3×3 | | 0 | 40 (0.6 postgraduate) | 5,000 / 150 | | edu5 |
| 108 | halls of residence | | 2×2 | students | 80 beds | 2 | 1,500 / 25 | | edu4 |
| 109-110 | spare (special school, adult learning centre) | | | | | | | | |
| 111-114 | London universities (section 9) | | ≤4×4 | | | | | | lnd2 |

The 6×6 campus fits within `MAX_FOOTPRINT` (8). Places, catchment and stage are attributes (`pupilCapacity`, `catchment`,
`stage`, `ages`). Staff, wage, cost and upkeep are per level as for any civic kind (`docs/buildings.md`). Wages run
24-26 for schools, 28 at the university and 32 at the research institute, near a GP surgery's 24. Teachers come from
the educated population (section 7). An understaffed school admits pupils only in proportion: effective places =
`places × min(1, qualified / (staff × teachersShare))`. Few graduates means understaffed schools, which means fewer
graduates. This loop is the reason education matters, and section 7 explains how migration stops it locking up.

Halls of residence (108) are a **residential-family sub-kind (code 1)** that is placed, not grown. It houses only
enrolled students: `spawn()` skips it, and the university's student intake fills it (section 4). It is not growable,
so `growth()` leaves it alone.

### Built in E2

`shared/src/buildings/education.ts` (kinds) and `edukit.ts` (shared recipe parts) hold the eight kinds, ids 101-108, each with **two UK designs** (`buildings:check` and `demo:check` pass; the kinds are `draft: true`, so the tools show only with `?dev` until E8 places them in the Showcase):

| Id | Kind | Tool id | Designs |
| --- | --- | --- | --- |
| 101 | nursery (1×1) | `nursery` | single-storey pods with a fenced garden, sandpit and buggy shelter; converted Victorian villa with a canopy and picket fence |
| 102 | primary school (2×2) | `primary` | London board school in yellow stock brick with BOYS and GIRLS doors and a bell cupola; flat-roofed 1960s school with a mobile classroom and playing field |
| 103 | secondary school (3×3) | `secondary` | 2000s academy with a curved glazed atrium and a floodlit 3G cage; 1950s brick secondary modern with a boiler-house chimney and playing fields |
| 104 | sixth-form college (2×2) | `sixthform` | Edwardian red-brick grammar school with a clock gable and a glass wing; modern block with a café front |
| 105 | further-education college (3×2) | `fecollege` | 1970s concrete tower with sawtooth workshops, a motor-vehicle bay and a bricklaying yard; glazed campus with an apprenticeship hall |
| 106 | university campus (6×6, gate right of centre) | `university` | redbrick Victorian Gothic quad round a clock tower; plate-glass 1960s slabs on a podium beside a lake |
| 107 | research institute (3×3) | `research` | glass and zinc lab (the Crick) with rooftop plant and fume stacks; science-park pavilions round a pyramid-roofed atrium with an observatory dome |
| 108 | halls of residence (2×2) | `halls` | 1960s slab with access decks; modern cluster flats round a courtyard |

What the catalogue says, for E3 to read (all attributes, in `attrs`; staff, wage, cost and upkeep are the level's, as for any civic kind):

- `stage`: 1 nursery, 2 primary, 3 secondary, 4 sixth form, 5 FE college, 6 university, 7 research institute, 0 halls. It is the number `Citizen.study` holds (`Study` in `shared/src/education.ts`). The FE college keeps `stage: 5` (`Study.FeCourse`); E3 also admits 16-18 pupils there as `Study.SixthForm` and its `eveningPlaces` as `Study.Evening`, keyed on kind 105.
- `pupilCapacity` (30, 120, 300, 120, 160, 600, 0, 0), `eveningPlaces` (FE: 60), `catchment` in tiles by road (8, 12, 20, 24, 30; 0 for the university and research institute: the whole city), `ages` as `[from, to]`, `teachersShare` (0.5, 0.6, 0.6, 0.7, 0.5, 0.6, 0.6) and `postgradShare` (university 0.4, research 0.6), `beds` (halls: 80).
- Staff (the level `capacity`) 6, 10, 24, 10, 18, 60, 40, 2; wages 24, 25, 26, 26, 26, 28, 32, 18; cost and upkeep as the table above. Teachers work Monday to Friday (cycle `[1,1,1,1,1,0,0]`, not rotating); FE and the university also run later shifts, halls staff run a night shift.
- Build work is `150 × tiles + 150`, so it grows with the footprint.

Decisions made while building it, so the later phases need not rediscover them:

- **All eight kinds, halls included, are family code 14**, civic and not leisure, with no `service` flag. The design put the halls in the residential family (code 1), but a group must share one family code and a code-1 civic kind would meet the residential spawn and growth code before E5 exists. E5 may move them (a kind-id's code can change while the kinds are drafts; the tile would then need a re-placement). The `LEISURE_CODES` loops (`leisureCoverage`, `leisureGrowth`, `pickLeisure`, the child outing) visit code-14 buildings but `leisureAt` returns `undefined` for them (`isLeisure` is by kind id and the family is civic), and every one of those loops skips an `undefined` spec, so a school is invisible to them. The client's "at the library" label is by family code and unchanged; `ui.ts` `SHORT_EDU` names where each education kind's staff work.
- **The group is a ladder of stages** (`stages: true` on the group in `groups.ts`), so the "never shrinks up the ladder" checks of holds and cost are skipped for it; the picker's count is `pupilCapacity` (`tierSummary` with `holds: 'pupils'`).
- **Tech and counters**: tech track `education` with nodes `edu1`-`edu5` as in section 6 (`shared/src/tech.ts`) and the counters `pupils` and `graduates`, which start at 0 in `emptyProgress` (`server/src/world.ts`). E3's census bumps them (section 13), so `edu4` (150 pupils) and `edu5` (200 graduates) can be earned once schools stand; while the kinds are drafts only `?dev` places them. `edu1` requires `civ1`. The policy features (free school meals, school buses, adult learning, apprenticeships, tuition fees) are E6's.
- **The lamps, benches and trees** on lawns, quads and forecourts sit at hashed offsets (`lampRow`, `benchRow`, `scatterTrees` in `edukit.ts`), so no campus looks stamped. The windows light up at night per window and per building as for every civic kind; the floodlight heads and lamp heads use the `venue` window class.

### Catchment

Admissions run in **batches**, never per tick (`sim/schools.ts`):

- **Weekly at Monday 00:00** (the school year rolls over, in `newDay` when `day % 7 === 0`): every pupil moves up a
  year. Leavers graduate or not (section 5). Children who have just reached the starting age, and every child without
  a place, are sorted by distance and admitted to the nearest school of their stage with room within its catchment:
  the UK distance rule. The cost is one pass over children plus one `eachBuiltNear` per school with room.
- **Daily at 05:00**, the same for children who arrived or moved home that day and for places freed or opened.
  This is a short list.
- A child with no place in reach stays home, as today. Their parents' happiness takes "no school place" (section 7),
  and the school's tooltip counts them in `waiting`.

### The models (UK flavour, at least two designs per rung, `buildings:check`)

- **Nursery:** a single-storey building with coloured cladding panels, a fenced play area, a sandpit and a buggy
  shelter; or a converted Victorian villa with a canopy and a painted fence.
- **Primary:** a London board school in yellow stock brick with tall gabled windows, a bell cupola and separate
  "BOYS" and "GIRLS" entrances, on a tarmac playground with hopscotch; or a 1960s single-storey school with a flat
  roof, a playing field and a climbing frame.
- **Secondary:** a 2000s academy with a curved glazed atrium, coloured render panels and a floodlit 3G pitch; or a
  1950s brick secondary modern with a four-storey teaching block, a sports hall and playing fields.
- **Sixth form:** an Edwardian grammar school with a clock gable and a new glass wing; or a modern block with a café
  front.
- **FE college:** a 1970s concrete tower with workshop sheds, roller doors, a motor-vehicle bay and a bricklaying
  yard; or a new glazed campus with an apprenticeship hall.
- **University (6×6):** *redbrick*, Victorian Gothic in red brick and terracotta with a clock tower round a grassed
  quad (Birmingham, Manchester); or *plate-glass*, 1960s brutalist towers on podium walkways beside a lake (Essex,
  Sussex). The quad and the lake get lamp posts and benches with per-instance scatter (the organic-variation rule).
- **Research institute:** a glass and steel lab with rooftop plant and fume stacks (the Crick).
- **Halls:** a 1960s slab or modern cluster flats with a bike shed.

## 4. The day

**Calendar.** One game week is one year of age, so it is also **one school year**. Monday to Friday (`day % 7 < 5`,
0 = Monday as in `leisure.ts`) are school days, and the weekend is the holidays. Term structure is cosmetic: the panel
calls Monday-Tuesday the autumn term, Wednesday-Thursday the spring term and Friday the summer term. Saturday is
results day for leavers, and on Monday at 00:00 everyone moves up a year. Each school hashes its own start
(08:30-09:00) and finish (15:00-15:30), and each university its own lecture days. That gives organic variation, so
traffic does not spike at one tick.

**Pupils use the commuting machinery.** At admission a pupil gets the school's timetable in the free shift fields.
The `Home` branch of `moveCitizens` treats `c.job || c.study` alike for `nextAt`, and an adult student skips the job
search. `depart`, `ToWork`, `Work` and `endShift` run unchanged. `endShift` skips `payWage` for a pupil and calls
`schools.attended(c)` (`att++`): one increment per pupil per school day. Days missed through illness (`staysOffSick`)
count in `due` but not in `att`. Pupils are in `Work` during school hours, so `maybeChildOuting` naturally only
happens after school.

**Getting there.**

- **Under 8 (`CHILD_OUT_AGE`): escorted.** First choice: `sim/carpool.ts` already drops household members on the way
  to work (`CARPOOL.detour`, `window`). The school becomes one more drop-off for a parent leaving within the window.
  Otherwise a free adult or retiree in the household walks them: a venue trip to the school door with a zero-length
  stay, as `tripToVenue` does. Otherwise an older sibling going to the same school takes them. Failing all three,
  the child misses the day ("no one to take them"). The family's panel shows it, and the school bus fixes it.
- **8 and over:** walk if the school is within 15 tiles (45 game minutes at `WALK_TILES_PER_HOUR` 20). Otherwise
  take the bus (children already ride free), a lift, or the school bus.
- **School buses:** `FleetKind` 9, free in `shared/src/fleet.ts`, built on the roaming-worker framework
  (`docs/mobile-jobs.md` section 1). It is a role of a secondary school's staff (hash-seeded, like `isMechanic`). One
  unit per school runs a morning and an afternoon round of `kerb` stops near the homes of pupils living more than 12
  tiles away. It costs nothing while idle, and the policy turns it on (section 6).
- **Students** (FE, university) travel as adults: drive, walk or ride transit with ordinary mode choice. A university
  is a big transit destination, and its riders show in the line stats.

**University towns.** A university admits school leavers from town and, for the rest of its places, **newcomers aged
18-21** queued at the gateways as students (`Gateways.request` with a student tag). They go to halls when it has beds,
otherwise to any home. They study for 3 years (3 game weeks), then stay if a matching job is in reach, or leave
(brain drain, section 7). Halls next to a campus, cheap cafés and a rail station make a student quarter.

**Traffic.** School runs land on the 08:00-09:00 commuting peak and add a 15:00-16:00 one. That is realistic, but it
changes the traffic-tuning baselines (`docs/traffic-tuning.md`). E3 re-measures with `loadtest/ab.ts`.

## 5. Progress over time

**The clock** (`shared/src/constants.ts`): `TICK_MS` 200, `TICKS_PER_HOUR` 100 (20 s of wall time), `TICKS_PER_DAY`
2,400 (8 minutes), one year 7 game days (56 minutes). Local mode can fast-forward 2× and 4×.

**Proposed compression: keep the life clock, and make education matter on a session's scale through adults.** Changing
how fast children age would shift the population pyramid, household turnover and every saved age, and it would break
the tidy rule that a game week is a school year. The stages therefore follow real UK ages:

| Stage | Ages | Years (= game weeks) | School days | To pass | Wall time |
| --- | --- | --- | --- | --- | --- |
| nursery | 3-4 | 1 | 5 | none (a bonus) | 56 min |
| primary | 4-11 | 7 | 35 | ≥ 60% attended, then a pass roll | 6.5 h |
| secondary (GCSE) | 11-16 | 5 | 25 | ≥ 60%, then a pass roll | 4.7 h |
| sixth form or FE | 16-18 | 2 | 10 | ≥ 60%, then a pass roll | 1.9 h |
| degree | 18+ | 3 | 15 (lecture days only: ~10) | ≥ 60% of lecture days | 2.8 h |
| postgraduate | 21+ | 1 | 5 | ≥ 60% | 56 min |
| **adult courses** | | | | | |
| FE course (full time, for the unemployed) | 19+ | | 4 attended days | one level up, to `further` at most | ~35 min |
| evening class | 19+ | | 6 evenings | one level up, to `secondary` at most | about a game week |
| apprenticeship | 16-24 | | 8 shift days at the employer | `further` with `track` trades | ~1.5 game weeks |

A child born in town now leaves school after about 17 hours. That is fine in the persistent world, and two hours of
play will never show it. What makes education felt within a session is:

1. **Families move in** (E5). A share of newcomers (default 20%) arrive as a couple with 1-3 children aged 0-15, so
   schools have pupils from the first hour and parents choose homes near schools.
2. **Adult courses** turn the unemployed and the low-skilled into qualified workers within a game day or two.
3. **Students** arrive for a university and become graduates within three game weeks.
4. **Migration** (section 7) brings qualified people for qualified vacancies straight away.

**Graduation.** On results day, a leaver who attended at least 60% of the school days held passes with probability
`passBase[stage] × quality × bonuses`. `quality` is the school's teacher staffing over the year (0.5-1), and the
bonuses are nursery (+5%) and free school meals (+5%). A pass sets `edu`. A fail keeps the old level and sets
`eduBits` dropped-out. Nothing happens per tick: graduation is one pass over leavers once a game week. Events go into
`lifeEvents` (`graduations`, `dropOuts`, `brainDrain`) and the charts.

**Dropping out.** A sixth-former or student whose attendance falls below 40% at the end of a game day, or who is
offered a job while unhappy with money (`money < 15`), drops out with a small daily chance. A school pupil cannot drop
out before 16.

**Returning to education.** An adult who has been out of work for 2 or more days (`idleDays`) with an FE college in
reach enrols on a full-time FE course (policy "adult learning"). Low-qualified adults in work take evening classes
the way the doctor's visit works: `c.care` schedules a trip, and `c.errand = 2` marks it as a class at an FE college
or central library, for 2 hours from 18:30. Retirees can join evening classes for leisure, which feeds the leisure
need and gives no level.

## 6. The education tree

### Player-facing: an Education track in `tech.ts`, plus policies

Add `'education'` to `TechNode['track']` and `TRACK_NAMES`, and two counters to `Counter` and `COUNTER_LABELS`:
`pupils` (school places filled in your parcels at once) and `graduates` (residents of your parcels with a degree or
more). `recomputeStats` bumps them as it bumps `housed` and `jobs` (`World.bump`).

| Node | Name | Requires | Condition | Cost | Unlocks |
| --- | --- | --- | --- | --- | --- |
| edu1 | Schools | civ1 | housed 60 | 500 | nursery, primary |
| edu2 | Secondary education | edu1 | housed 200 | 1,200 | secondary, policies: free school meals, school buses |
| edu3 | Further education | edu2, zon2 | jobs 150 | 1,800 | sixth form, FE college, policies: adult learning, apprenticeships |
| edu4 | Higher education | edu3, con2 | pupils 150 | 4,500 | university, halls, policy: tuition fees |
| edu5 | Research | edu4, zon3 | graduates 200 | 7,000 | research institute (raises the office ambition cap near it) |
| lnd2 | London universities | edu4, cul5 | `locked`, like lnd1 | 10,000 | UCL, Imperial, King's, LSE |

Optional: add edu4 to `civ6` Medical school's `requires`. That changes an existing path, so it is a later call.

**Policies** (new `shared/src/policies.ts`): a short list, each opened by a tech feature id and toggled per player.
They are stored in `Player.policies: string[]` (saved with players, no bump) and sent in `PlayerDTO.policies`. A
`setPolicy` intent goes to `net.ts`, and a Policies panel opens beside the tech tree.

| Policy | Daily cost | Effect |
| --- | --- | --- |
| Free school meals | $0.4 per pupil | +5% pass chance, child health +0.3 a day, parents' happiness "free school meals" +2 |
| School buses | $15 per bus | school bus units for secondary schools (section 4) |
| Adult learning | $1 per learner | FE courses for the unemployed, and evening classes |
| Apprenticeships | 20% of an apprentice's wage | up to 10% of staff at industrial and yard workplaces train up to `further`, trades track |
| Tuition fees | income: $2 per student a day (ledger `fees`) | off: you pay a $1 grant per student; on: 30% fewer students enrol, and more graduates leave |

### Population progress: the people's tree

Rich asked for a tree or progress for the population itself. The ladder is shown as a **funnel in an Education tab of
the Charts panel** (`client/src/charts.ts`). It has one node per level with residents holding it, students enrolled
in each stage, this week's graduations and drop-outs, and the next milestone each node opens ("200 graduates: Research").
The **citizen panel** shows each person's own path as a timeline ("Nursery: Little Acorns, Year 4 at St Mary's
Primary, 96% attendance") from `life.education.history`.

**City-level measures:**

- **Education index**: 20 × the mean level points of residents aged 25-64 (none 0 … postgraduate 5), so 0-100. The
  base distribution gives about 62. It is maintained from per-level counters kept up to date on every change, never
  from a scan.
- **Charts:** new `WORLD_SERIES` in a new `HistGroup` `'education'`: `eduIndex`, `pupils`, `students`, `gradsDay`
  (graduations per day), `brainDrain` (graduates leaving per day). New `PLAYER_SERIES`: `myGrads`, `myPlaces`.
  Saves need no bump (`docs/charts.md`).
- **Attainment by district:** `ParcelStats.eduIndex`, `grads`, `pupils`, `places` in the parcel panel. The world map
  (`docs/world-map.md`) colours parcels and estates by `eduIndex`.
- **Map heatmap:** an "Education" overlay button beside the traffic heat (`client/src/main.ts` `setHeat`). The server
  sends a per-chunk byte array of each home's mean resident level only while the overlay is on, and
  `ChunkView` tints the ground as `tintRoads` does with congestion. School catchments draw as rings when a school is
  hovered.

## 7. Effects

**Jobs require education by tier, softly.** Each workplace kind and level gets a `skill` attribute `[level, share]`:
that share of its places needs that level. The rest are unskilled places (receptionists, cleaners, assistants). Kinds
without the attribute read a default by family and level from `shared/src/education.ts`:

| Workplace | Skilled share |
| --- | --- |
| shops L1-3, high street | secondary 20/30/40% |
| department store, shopping centre, hotel | further 30% |
| industry L1-3 | further (trades) 30/40/50% |
| factory complex, heavy plant | further 50% + degree 10% |
| offices L1 / L2 / L3 | further 40% / degree 40% / degree 60% |
| office tower, corporate HQ (merged L4-7) | degree 60-70% + postgraduate 10% |
| GP to teaching hospital | degree 40-60%; teaching hospital + postgraduate 20% |
| police, fire, builders | further 30% |
| schools / university / research | degree 60% / postgraduate 40% / postgraduate 60% |
| airport | degree 10% (pilots) + further 30% |

`findJob`'s predicate takes a vacancy when `b.occupants < cap` **and** either the citizen is qualified and
`b.qualified < ceil(cap × share)`, or there is an unskilled place left
(`b.occupants - b.qualified < cap - ceil(cap × share)`). An over-qualified worker may take any place, with a happiness
penalty "over-qualified" (-2). The negative-result cache `jobMisses` must be keyed by home and level
(`tkey(home) * 8 + edu`), because a miss for one level is not a miss for another. `hire` and `quitJob` keep
`Building.qualified` up to date.

**Growth follows the workforce.** Growth needs 70% occupancy (`growth()`). Unfilled skilled places therefore hold a
building back, and higher tiers arrive as the educated workforce grows. Nothing new gates growth. Phase E5 also
lets the research institute raise `ambition` for offices within 20 tiles by one level.

**Wages scale with education.** `payWage` multiplies by `EDU.wage[level]` for a worker in a skilled place, and by the
track-match bonus (+10%) when the track fits the workplace (trades in industry, STEM in a lab or hospital):

| none | primary | secondary | further | degree | postgraduate |
| --- | --- | --- | --- | --- | --- |
| 0.9 | 0.95 | 1.0 | 1.1 | 1.25 | 1.4 |

The income tax on wages goes to the parcel owner, so an educated city pays its owners more. That is the player's
return on spending on schools. Civic payroll (`w.payroll`) pays teachers from the treasury, so schools cost upkeep
plus wages.

**Happiness** (`happinessParts`): "good school nearby" +3 for a household with children whose children all have
places; "no school place" -4; "studying" +2 for students instead of "out of work"; "graduated" +5 for 2 days;
"over-qualified" -2. **Health:** `healthTarget` +2 for a degree or more (a small, real-world link). **Crime:** there
is no crime model (police coverage only), so there is no link until there is one.

**Migration.**

- **Matching newcomers (the balance guard).** A newcomer's level is drawn from the base distribution with probability
  `1 - EDU.match`, and otherwise from the levels the city's open skilled vacancies need, weighted by count
  (`EDU.match` 0.6). Until a city educates its own people, migration fills its offices, so the early game behaves as
  today.
- **Brain drain.** In `lifeFamily`'s leaving check, a resident with a degree or more who has been out of work, or
  over-qualified, for 2 or more days has the leaving chance × `EDU.drainMul` (3). A graduate with no matching job in
  reach 2 days after graduating leaves with chance 0.5. Brain drain is counted, charted, and noticed to the owner
  ("graduates are leaving: they find no work to match their degrees").

## 8. Balance and performance

- **Tick cost.** No per-tick work per child. Per school day each pupil costs a commute out and back, which is the
  ordinary cost of a trip. Attendance is one increment at `endShift`. Admissions run weekly plus a short daily list.
  Graduation is weekly. The education index uses counters. Hiring adds two comparisons per candidate building. The
  real cost is traffic from extra trips: at 15% children (with families moving in), about 10% more trips on school
  days. Target: under 5% more sim ms per tick at Commons scale. Measure with `loadtest/ab.ts --set edu=0` (an
  `EDU=0` environment switch, like `CARPOOL`) and a new `loadtest/education.ts` probe that prints the level mix,
  enrolment by stage, attendance, graduations, brain drain and the job fill rate by skill.
- **Job and resident balance.** Residential demand stays `jobs - population + 6`. Schools add jobs, as any civic
  building does. Pupils are not jobs. `EDU.match` keeps skilled vacancies fillable. Phase E4 must show with
  `loadtest/jobsearch.ts` that idle adults and open jobs stay within today's band on a 2×2 test city.
- **Tunables in one place:** `EDU` in `shared/src/education.ts` (pass rates, shares, wage multipliers, match, drain,
  family share, policy costs), with the life tunables beside `LIFE`.
- **Old worlds** get seeded levels, no pupils until the first admission batch, and no format bump.

## 9. Showcase and London

- **Showcase** (`docs/demo.md`): every rung is a catalogue kind, so `demo:check` already demands a placement and a
  `TOUR` stop. Put a nursery and a primary beside the A-district homes, a secondary with its pitch at the edge of
  downtown, a sixth form and FE college by the station, and the campus with halls in the riverside quarter. Add
  `SHOWCASE_FEATURES` entries: `school-run` (seeded: within `FEATURE_DAYS` a pupil attends a showcase primary, with
  `todo` until families move in, E5), `school-bus` (a FleetKind 9 unit on a round) and `graduation` (a run report line
  in `server/src/demo/check.ts`: graduations and the education index after `--run 2`).
- **London**: four real universities as London landmarks (`landmarks-london-3.ts`, kind ids 111-114, family 14,
  `tags: ['london']`, collection tiers 11-14, each within 4×4, one design each). Each works as a university rung (it
  admits students and employs academics):
  - UCL's Wilkins Building with the portico and dome, on Gower Street in Bloomsbury (51.5246, -0.1340)
  - Imperial's Queen's Tower, South Kensington (51.4988, -0.1749)
  - King's College's Strand building beside Somerset House (51.5115, -0.1160)
  - LSE's Centre Building on Houghton Street, Aldwych (51.5144, -0.1165)

  `londonMap.ts` already names Bloomsbury and Holborn. The London scenario fits them before the streets, as it does
  the other landmarks. `lnd2` is `locked`, as `lnd1` is.

## 10. Phased plan

| # | Subtask | Model | Files | Depends on | Size |
| --- | --- | --- | --- | --- | --- |
| E1 | **Built.** **Citizen model and wire.** `shared/src/education.ts` (levels, tracks, stages, `EDU`, base mix, `eduDefaults`, year group, birthday); `Citizen` fields; snapshot defaults; `CitizenInfo.life.education`, `PersonRow.edu`, `CITIZEN_STUDY`; newcomer seeding (no tilt yet); `loadtest/education.ts` | opus | world.ts, snapshot.ts, protocol.ts, life.ts, simulation.ts (`makeCitizen`, `describeLife`) | none | M |
| E2 | **Built.** **Institutions catalogue.** `buildings/education.ts` kinds 101-108 with two UK designs each; un-reserve the `education` group; the edu1-edu5 tech track and counters; `SHORT` label by kind; viewer | sonnet | buildings/*, groups.ts, tech.ts, compiled.ts (regenerate, never hand-merge), ui.ts | none (attribute names from this doc) | L |
| E3 | **Built.** **Schools sim.** `sim/schools.ts`: admissions batches, the pupil timetable on the commute machinery, attendance, weekly rollover, graduation and drop-out, escorts via carpool, the `school` inspect block, `lifeEvents` | opus | sim/schools.ts, simulation.ts (Home branch, `endShift`, `newDay`, describe), carpool.ts | E1, E2 | L |
| E4 | **Jobs, wages, migration.** Skill gate in `findJob`, `jobMisses` by level, `Building.qualified`, wage multipliers, `EDU.match` tilt, brain drain, happiness parts; tuning runs | opus | simulation.ts (`findJob`, `hire`, `payWage`, `lifeFamily`), life.ts, gateways.ts | E1 (runs beside E3) | M |
| E5 | **Higher and adult education.** University intake via gateways, halls of residence, families moving in, FE courses, evening classes (`errand` 2), apprenticeships, research ambition | opus | gateways.ts, simulation.ts (`spawn`, `arriveVia`, `ambition`), sim/schools.ts | E3, E4 | L |
| E6 | **Policies and the tree UI.** `policies.ts`, `Player.policies`, `setPolicy` intent, Policies panel, Education track in the tech panel; school buses as FleetKind 9 (the server part goes to opus) | sonnet (+ opus for `mobile.ts`) | policies.ts, net.ts, ui.ts, fleet.ts, sim/mobile.ts | E2; the effects need E3 | M |
| E7 | **City views.** History series and the Education tab funnel; `ParcelStats` fields; heat overlay; citizen timeline; school tooltip; student look in people.ts | sonnet | history.ts, charts.ts, main.ts, chunkView.ts, ui.ts, render/people.ts | E3 | M |
| E8 | **Showcase and London.** Placements and tour stops, registry entries, London universities 111-114 and `lnd2` | sonnet | demo/showcase.ts, demo/london.ts, landmarks-london-3.ts, tech.ts | E2 (E3 for the seeded tests) | M |

**In parallel:** E1 and E2 first. Then E3 and E4 together (both edit `simulation.ts`, in different functions; merge E4
after E3). E6's UI can start after E2. E7 and E8 follow E3. E5 comes last.

**Hot spots shared with other agents:** `server/src/sim/simulation.ts` (keep hooks thin and put the logic in
`sim/schools.ts`), `server/src/world.ts`, `shared/src/protocol.ts`, `shared/src/tech.ts`,
`shared/src/buildings/compiled.ts` (generated: rebase and rerun `buildings:compile`), `client/src/ui.ts`,
`shared/src/demo/showcase.ts`.

## 11. Questions for Rich

1. **How fast should children grow up?**
   - **A. Keep one game week per year of age** (recommended). A child born today leaves school about 17 hours later.
     Schools matter sooner through families moving in, adult courses and students.
   - B. Children age twice as fast until 18 (one year every 3.5 days). Old saves need their ages re-dated once.
2. **How strict should job requirements be?**
   - **A. Soft** (recommended). Each tier has a skilled share. Anyone can take the unskilled places, and migration
     brings qualified people for the skilled ones.
   - B. Hard. Office L2 and up hire graduates only. Offices may stand half-empty until you educate people.
3. **Should newcomers arrive as families with children?**
   - **A. Yes, about 20% of newcomers are a couple with 1-3 children aged 0-15** (recommended). Schools fill from the
     first hour.
   - B. No. Only children born in town go to school, so schools stay empty for a long time.
4. **What shape should the player's tree take?**
   - **A. A new Education track in the existing tech tree (5 nodes), with a Policies panel for free school meals,
     school buses, adult learning, apprenticeships and tuition fees** (recommended).
   - B. A separate civic or policy tree with its own currency.
5. **Should we use the real London universities?**
   - **A. Yes: UCL, Imperial, King's and LSE as London landmarks that work as universities, locked like the other
     landmarks** (recommended).
   - B. Generic redbrick and plate-glass campuses only.

## 12. Built: E1, the citizen model and the wire

Built 2026-10-18 on branch `edu-e1`. Nobody studies yet: E1 adds the fields, seeds them and sends them, and no stage
is ever entered until E3's admissions. The sim plays exactly as before. `loadtest/ab.ts --hour 8 --ticks 3000` gives
identical results on this branch and on main 1fffb1d (the same speeds, give-ups and re-routes), at the same sim ms
per tick within noise (0.82-0.88 against 0.82-1.03).

### `shared/src/education.ts` (exported from `@msimcity/shared`)

- `EduLevel` None 0 … Postgrad 5, `EDU_LEVEL_NAMES` (panel wording: "GCSEs", "A-levels or Level 3"), `EDU_LEVEL_SHORT`
  (charts: none, primary, secondary, further, degree, postgrad).
- `EduTrack` None 0, Stem 1, Arts 2, Trades 3, and `EDU_TRACK_NAMES`.
- `Study` None 0, Nursery 1, Primary 2, Secondary 3, SixthForm 4, FeCourse 5, Degree 6, Postgrad 7, Evening 8, and
  `STUDY_NAMES`. This is also the value of an education kind's `stage` attribute (E2). SixthForm covers every 16-18
  course, at a sixth-form college (104) or an FE college (105), and the track tells A-levels from vocational.
  FeCourse is the adult full-time course. Apprenticeships (E5) are not a Study value: an apprentice keeps their job and
  timetable.
- `STAGES[study]`: `{ ages: [from, to), years, days, earns, pass }`. `days` counts the school days held over the whole
  stage (5 a year), or the days attended to finish an adult course (years 0). `earns` is the level a pass gives, or
  the cap for adult courses (one level up). `pass` is the base pass chance (primary 0.97, GCSE 0.8, sixth form 0.85,
  degree 0.9, postgraduate 0.85, adult courses 0.9). E3 tunes them.
- `EduResult` Passed 0, Failed 1, DroppedOut 2, Left 3, and `EDU_RESULT_NAMES`. `EDU_NURSERY` (1) and `EDU_DROPPED` (2)
  are the `eduBits`.
- `EDU`: `baseMix`, `trackFurther` and `trackDegree` (STEM, arts and trades shares: 35/35/30 and 50/45/5), `degreeAge` 22,
  `minAttend` 0.6, `dropOutBelow` 0.4, `nurseryBonus` and `mealsBonus` 0.05, `wage` [0.9 … 1.4], `trackMatch` 1.1,
  `match` 0.6, `drainMul` 3, `drainDays` 2, `familyShare` 0.2, `logMax` 6. E3-E6 add their tunables here.
- `EduFields` (the citizen fields below), `EduLogEntry`, `eduDefaults(id, age)`, `maxLevelAt(age)`,
  `eduIndexOf(levelCounts)`, `yearGroup(born, day, daysPerYear = 7)`, `yearGroupName(yg)` ("Reception", "Year 7"),
  `birthdayOf(born)` → `{ weekday, hour }`, and `logEdu(c, entry)`, which appends and keeps the newest `EDU.logMax`.

### The citizen

`Citizen extends Mover, EduFields` (`server/src/world.ts`). The fields are `edu`, `track`, `study`, `sx`, `sy`, `att`,
`due`, `eduBits` and `eduLog`, all as in section 2. `eduLog` holds plain tuples
`[stage, door x, door y, kind id, game week it ended, EduResult]`, so a demolished school still has a name.

- **Seeding** (`eduDefaults`, hash salts 231 and 233). An adult draws from `EDU.baseMix`, capped by `maxLevelAt(age)`:
  nobody holds a degree before 22, so newcomers aged 18-21 hold `further` at most. A child is seeded by age: none under
  11, then at least primary, GCSEs from 16 and Level 3 from 18, capped by the same base draw. Further and degree holders
  get a track. `makeCitizen` spreads it, which covers `spawnCitizen`, `arriveVia` and `spawnChild` (a baby is 0, so it
  gets none). The E4 `EDU.match` tilt and the E5 families are not built: newcomers draw from the base mix.
- **Saves.** `worldFromSnapshot` assigns `eduDefaults(id, ageOf(c))` to a citizen saved without `edu`. The format
  stays at version 8, and a save round-trips the fields as they are. E3 must rebuild building counters such as
  `pupils` and `qualified` on load from `study`, `sx` and `sy`, as `occupants` is rebuilt.

### On the wire

- `CITIZEN_STUDY = 1 << 25` and `citizenStudy(f)` (`protocol.ts`). `Simulation.agents()` ORs it in through `extra`
  for a citizen with `study > 0` in `ToWork` or `ToHome`. E3 narrowed `ToHome` to the trip home from school
  (`EDU_HOMEWARD`, set at `endShift`, cleared on arrival), so a pupil coming home from the park does not carry it. The
  client does not read it yet: E7 draws the student look.
- `PersonRow.edu`: the EduLevel of every resident, worker and visitor row.
- `CitizenLife.birthday: { weekday, hour }` (`birthdayOf`, where weekday 0 is Monday) and
  `CitizenLife.education: CitizenEducation`. It holds `{ level, track?, studying?, history, nursery?, droppedOut? }`,
  and `studying` holds `{ place: { x, y, name }, stage, yearGroup?, attendance, progress }`. The `yearGroup` is
  sent for the primary, secondary and sixth-form stages. `attendance` is `att / due`, or 1 before the first school
  day. `progress` comes from the year group for school stages, so a child who joins mid-stage reads right. For a
  degree or postgraduate stage it is `due / days`, and for an adult course `att / days`. Each `history` row is
  `{ stage, place, week, result }`, where `week` is the game week (school year) the stage ended. `describeEducation`
  in `simulation.ts` builds it.
- **Citizen panel** (`client/src/ui.ts` `lifeHtml`): "Age 34 · adult · turns 35 on Thu", an "Education" row with the
  level and track, and a "Studying" row (stage, year group, attendance) once E3 enrols people. The timeline and the
  student look are E7.

### The probe

`npx tsx packages/server/src/loadtest/education.ts --districts 1 --days 3` (deterministic with `--seed`; it takes
about 11 s). First run:

- **The pure helpers.** 100,000 ids at age 40 match `baseMix` to within 0.26 points, with an index of 62.4. Nobody
  exceeds their age cap, nobody aged 18-21 holds a degree, and a 13-year-old has primary. The year group gives
  Reception at 4 by Monday 00:00 and holds all week. The birthday falls on Thursday at 12:00, and the log keeps the
  newest 6.
- **The city.** 1,293 citizens. The adult mix is none 6.7%, primary 1.5%, secondary 21.2%, further 28.3%, degree
  29.5% and postgraduate 12.9%, against base 6/2/22/27/30/13. The education index of residents aged 25-64 is 62.4.
  Tracks are 34/33/33 for further and 48/48/4 for degrees.
- **The panels.** `describeCitizen` returns `life.education` and `life.birthday`, and every residents' row carries
  `PersonRow.edu`. A pupil with stage, year group, attendance and progress reads right (the probe enrols one by hand).
- **The wire.** No agent carries `CITIZEN_STUDY` while nobody studies, and a commuter marked as a pupil does.
- **Saves.** A save round-trips the fields. The same save with the fields stripped loads at version 8 with every
  level equal to `eduDefaults(id, age)`, and it runs 600 ticks. Re-dated to ages 0-70, it seeds children by age:
  under 11 none, 11-15 primary, 16-17 mostly GCSEs. 24 of 24 checks pass.

E3-E7 extend the probe with enrolment by stage, attendance, graduations, brain drain and the job fill rate by skill.


## 13. Built: E3, the schools simulation

Built 2026-10-18 on branch `edu-e3`. `server/src/sim/schools.ts` (class `Schools`, `Simulation.schools`) runs
admissions, the school day, attendance, results and drop-outs. Nothing runs per pupil per tick: the batches are a
census and a pass over the citizens at midnight and at 03:30, and the census alone once a game hour.

### How a pupil's day works

- **The commute machinery, unchanged.** At admission a pupil gets the school's bell in the shift fields (`shiftStart`,
  `shiftLen`, `cycle` Monday-Friday `[1,1,1,1,1,0,0]`, `phase` 0) and **the school door mirrored into `wx`/`wy`**,
  while `job` stays false and `kind` 0. `depart`, `ToWork`, `Work`, `endShift`, `lead`, `commutePath` and the carpool
  all read `wx`/`wy`, so they run as for a worker. Anything new that reads `wx`/`wy` must keep checking `c.job`. Each
  school hashes its bell from its door (start 08:30-09:00, end 15:00-15:30, `EDU.startFrom/startSpan/endFrom/endSpan`),
  each pupil adds ±5 minutes (`pupilJitter`), and a university student hashes their own lectures (a start between
  09:00 and 11:00, 5 hours).
- **Hooks in `simulation.ts`** (all thin): the Home branch sends a pupil due out to `schools.setOff` and skips the job
  search (`c.study`); `depart` calls `schools.leaving` (breakfast club) and, with no way there, `dropCommute` gives up
  the place rather than a job; `endShift` asks `schools.pickUp` (an under-8 waits to be fetched), then `shiftDone`
  counts a day attended (`schools.attended`, `att++`) instead of a wage; the trip home sets `EDU_HOMEWARD` (bit 2 of
  `eduBits`, transient) and arriving home clears it, so `CITIZEN_STUDY` now marks only the trips to and from school;
  `arriveHome`/`teleportHome` reschedule for `c.job || c.study`; `scheduleNext` gives pupils no café stop; `newDay`
  does not count students as idle; full-time students pay no council tax (`arriveHome`); `shareToWork` takes household
  pupils on the school run (always, not by the household's habit) and drops them at the school door.
- **Escorts for the under-8s** (`EDU.escortAge`), in this order: a household driver leaving for work within 45 minutes
  (`liftWait`): the child waits and the carpool takes them; an older brother or sister at the same school due within 30
  minutes (`siblingWindow`); a grown-up at home who is free for 3 hours (`freeFor`) walks them in and goes home (or
  drives, and the child rides along); a parent due at work within 1.5 hours (`onTheWay`) drops them off on the way.
  From the other side, a parent leaving for work (on foot or by transit, `schools.leaving`; or by car, `shareToWork`
  with `schools.liftWindow`) takes an under-8 due within 1.5 hours (`breakfastClub`): the child waits at school for the
  bell. Younger brothers and sisters at the same school go along. Failing all of these the child misses the day ("no
  one to take them"; the school bus of E6 is the fix). The grown-up's trip is a venue trip with `errand` 3
  (`ERRAND_SCHOOL`): no bill, no stay at the gate, then home or on to work; the doctor stays `errand` 1. After school a
  free grown-up at home walks over to fetch an under-8 (`pickUp`): the child waits about as long as the walk takes;
  with nobody free they walk home alone.
- **The census** (`census()`, hourly and before each batch): which schools stand (any built kind with a `SCHOOL_SPECS`
  entry), their pupils and the pupils in class now, their staff, and the staff with a degree (teachers) and with a
  postgraduate degree. `needed = ceil(staff capacity × teachersShare)`, `needPg = ceil(capacity × postgradShare)`, and
  **staffing** = min(teachers / needed, postgrads / needPg, 1). A school **admits** `floor(pupilCapacity × staffing)`;
  pupils already there stay. **Quality** follows staffing over the year (`1 - qualityDrop × (1 - staffing)`, 0.5-1,
  smoothed by `qualityDays` a day) and multiplies the pass chance. Then the counters: `pupils` (pupils at schools on
  an owner's parcels) and `graduates` (residents of their parcels with a degree or more), as peaks via `World.bump`.
  Nothing is saved but the citizens' own fields: a loaded world recounts at the first census (run lazily if a pupil is
  due out before it).
- **Midnight, daily:** `due++` for every pupil after a school day; a sixth-former or student below
  `EDU.dropOutBelow` attendance after `dropOutAfter` days drops out with `dropOutPerDay`; a pupil whose school has gone
  leaves it (`EduResult.Left`) and is admitted elsewhere. **Saturday 00:00 is results day**: a leaver (a school stage:
  by their age at next Monday against the stage's leaving age; a degree or master's: `due >= STAGES[s].days`) who
  attended `EDU.minAttend` passes with `pass × quality × (1 + nursery bonus)`. A pass raises `edu` (nursery sets
  `EDU_NURSERY` instead), sets the track at 16-18 (sixth-form college STEM or arts by hash, FE college trades) and is
  logged; a fail sets `EDU_DROPPED` (section 5); a nursery year with low attendance is just `Left`. Offers on results
  day: `uniShare` (45%) of sixth-form passers take a place at the nearest university with room, and `postgradTake`
  (20%) of graduates a master's (`goOn`), so they never start looking for work. **Monday 00:00**: admissions for the
  new year.
- **Admissions** (Monday 00:00 and 03:30 daily): every child of school age by their age at the start of the school year
  the next school day belongs to (so after Saturday's results the leavers belong to next year's stage) and without a
  place, against every school of their stage with room within its catchment (Manhattan tiles from home; the university
  is city-wide), nearest pair first: the UK distance rule. A sixth-form college needs GCSEs, an FE college takes anyone
  16-17 (as `Study.SixthForm`). A drop-out is not re-admitted before 18. The school's tooltip counts the children whose
  nearest school is full (`waiting`); `events.noSchoolAtLast` counts those with no school of their stage in reach.

### The API for E5-E7

- `Simulation.schools: Schools`. `SCHOOLS.on` (`EDU=0` in the environment turns the whole thing off for A/B runs).
- `schools.enrolAt(c, building, study): boolean`: a place at that school if it takes the stage and has room its
  staffing allows; moves a pupil enrolled elsewhere. **E5** uses it for students arriving through a gateway (Degree at
  106; halls are E5's) and adult courses (`Study.FeCourse` at 105; `Study.Evening` needs E5 to count `eveningPlaces`).
  `schools.leave(c, EduResult)` ends a stage with a log entry. Adults enrolled this way are students: no job search, not
  idle, no council tax; an evening class keeps its job (`c.job` true: the timetable is not touched).
- `schools.describe(b)` → `BuildingInfo.school: SchoolInfo` (`shared/src/protocol.ts`): stage, pupils, present,
  places, admitting, teachers, teachersNeeded, postgrads and postgradsNeeded (university and research), catchment,
  hours, quality, passed/failed/droppedOut (the latest results day), waiting. **E7** draws the tooltip from it.
- `schools.onGraduated: (c) => void`: called when a pass raises `edu` (before the leaver goes on to a degree). **E4**
  sets it to `Skills.graduated` in the Simulation constructor (the "graduated" mood, and brain drain after
  `EDU.drainDays`). `EDU=0` turns off both E3 (`SCHOOLS.on`) and E4 (`SKILLS.on`).
- `schools.events` (probes, and E7's charts): enrolled, graduations, nurseryDone, failed, dropOuts, left, attended,
  escort `{ lift, sibling, adult, onTheWay, missed }`, fetched, walkedHomeAlone, admissions, waitingAtLast,
  noSchoolAtLast, wentOn. `Simulation.lifeEvents` gains `graduations` and `dropOuts`. `schools.list()` and
  `schools.census()` for probes.
- `shared/src/education.ts`: `SCHOOL_SPECS[kindId]` / `schoolSpec(kind)` (the catalogue attributes as numbers:
  stage, places, evening, catchment, ages, teachersShare, postgradShare, beds), `schoolTakes(spec, study)`,
  `studyForAge(age)`, `EDU_HOMEWARD`, and the E3 tunables in `EDU`.
- **E4** owns the skill gate: with it, schools hire degree holders for 60% of their places and fill up; without it they
  hire whoever is nearest, so the census sees roughly the base mix (about 43% degree or more) and most schools run at
  60-80% of their places. **E6**: free school meals add `EDU.mealsBonus` in `Schools.result`; school buses replace
  "missed". **E7**: `CITIZEN_STUDY` now means a school trip.

### The probe

`npx tsx packages/server/src/loadtest/schools.ts --districts 2 --days 8` (seed 1, deterministic; `--checks 0`,
`--quiet`, `--save FILE`): the 2×2 test city with a nursery, primary and secondary school in every district, a
sixth-form college, an FE college, and a university, halls and research institute on a parcel south of the city;
before the first tick 30% chances per four beds of a family (two adults and 1-3 children aged 0-17). Day 0 is a Monday.
First run (19 of 19 checks pass, about 45 s):

- **The city** after 8 game days: 5,192 citizens, 463 under 18 (8.9%). 243 enrolled at the end: nursery 8, primary 76,
  secondary 110, sixth form 41, degree 7, master's 1. Attendance this stage so far: nursery 63%, primary 91%,
  secondary 97%, sixth form 98% (illness and the under-8s nobody could take). In class at 11:00: 143 on the first
  Monday (staff still being hired), 173-218 through the week, 234 the next Monday.
- **Teacher shortfall**, with no skill gate yet (E4): teachers are whoever took the job, so most schools have 4-12 of
  the 6-15 degree holders they need and admit 60-80% of their places; a primary with 1 of 6 admitted 20 of 120 and had
  10 waiting; two schools in the far district hired no staff at all and admitted nobody (9 and 24 waiting). Firing
  half the qualified teachers of a primary drops it from 80 to 40 places (the check). The university ran at 22/36
  teachers and 5/24 postgraduates: quality 0.60.
- **Catchments**: 115 primary-age children had no primary within 12 tiles (the probe puts one primary per 22×22
  district); 9 more waited for a full school in reach.
- **Results day**: 50 graduations (of those still in town: primary 10, GCSEs 16, Level 3 14, degrees 6 of the 20 seeded second-years) and 10
  nursery years; 21 fails (mostly too few days attended in a first week); 0 drop-outs; 9 offers on results day, 7
  school leavers starting a degree on Monday and 1 graduate a master's.
- **Escorts for the under-8s**: 46 lifts in a household car, 30 with an older brother or sister, 103 walked in by a
  grown-up at home, 53 dropped off on a parent's way to work; 37 missed days with nobody to take them. After school 138
  were fetched and 161 walked home on their own.
- **The school run**: at most 201 pupils on the way at once (08:30); of 1,023 morning trips 81% walk, 14% ride in a
  household car, 5% drive (sixth-formers who turned 18). The tiles have no transit. `CITIZEN_STUDY` in 85,000 agent
  samples: never on a trip home that is not from school, always on a pupil going to school.
- **Counters**: `pupils` 248 (edu4 needs 150), `graduates` 1,942 (edu5 needs 200).
- **Saves**: a snapshot keeps every pupil's place, the loaded world runs and the census recounts all 243.

**Tick cost**, same seed, median of 3 (2026-10-18):

| Run | main 03fe71f | edu-e3 | edu-e3, `EDU=0` |
| --- | --- | --- | --- |
| this probe, 8 days, all ticks | 2.176 ms | 2.187 ms (+0.5%) | 2.089 ms |
| this probe, school hours on school days | 2.469 ms | 2.527 ms (+2.3%) | 2.423 ms |
| `loadtest/ab.ts --hour 8 --ticks 3000` (the Commons, no schools) | 0.832 ms | 0.837 ms (noise) | |

Main runs the probe's city and families without simulating schools (the children stay home). Within the 5% target. With
no school placed the branch plays exactly as main: `ab.ts` prints identical speeds, give-ups, re-routes and trips.
`EDU=0` came out 4% below main, which this change does not explain (with schools off nothing new runs and nothing new
draws a random number); main's own three runs spread 2.5%, so take main as the baseline and the rest as noise.

**Traffic**: school runs add their walkers to the 08:00-09:00 peak and a 15:00-16:00 one, and household cars make
drop-offs on the way to work; with no schools placed the `docs/traffic-tuning.md` baselines are unchanged (above).
The probe's `--save` writes a Tuesday-morning world for a live look: children in school jumpers with backpacks walking to
the secondary schools at 08:30-09:00 (screenshots in the E3 report).
