# Education: schools, qualifications and the education tree

Card "we need an education tree etc" (UTD 851126b0). Rich: "do we have the notion of age and school etc? We also need
schools, high schools, sixth form, colleges, universities etc." and "lets consider the education of the population and
an education tree / progress for them". Design 2026-10-18. **E1 (the citizen model and the wire) is built**: see
section 12 for what it provides. The rest is design. Rich has not answered section 11 yet, so the build follows the
recommended answers (A to every question). **E2 (the institutions catalogue, section 3 "Built in E2" and the tech track in section 6) is built** too,
and so is **E3 (the schools simulation, section 13)**: children are admitted, walk (or are taken) to school, attend, sit
results and move up a stage. **E8 (the Showcase and London, section 14)** is built too: every kind stands in the Showcase
and the four London universities are landmarks. **E7 (the city views, section 15)** is built: history series, the Charts panel's Education tab, parcel
attainment, the education overlay, the citizen's timeline, the school tooltip and the student look. **E6 (policies, the Policies panel and school buses, section 16)** is built too. **E4 (jobs, wages and migration, section 17)** is built:
workplaces have skilled places, wages follow education, newcomers come for open skilled jobs and graduates with no
matching work leave. **E5 (higher and adult education, section 18)** is built, so every phase is: families move in with
children, students come from outside town for the university and live in halls, adults take FE courses and evening
classes, young workers train as apprentices, and a research institute lifts the offices near it.

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

`shared/src/buildings/education.ts` (kinds) and `edukit.ts` (shared recipe parts) hold the eight kinds, ids 101-108, each with **two UK designs** (`buildings:check` and `demo:check` pass; the kinds were drafts until E8 placed them in the Showcase, section 14, so the tools show in every game now that their tech is earned):

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
- **Tech and counters**: tech track `education` with nodes `edu1`-`edu5` as in section 6 (`shared/src/tech.ts`) and the counters `pupils` and `graduates`, which start at 0 in `emptyProgress` (`server/src/world.ts`). E3's census bumps them (section 13), so `edu4` (150 pupils) and `edu5` (200 graduates) can be earned once schools stand. `edu1` requires `civ1`. The policy features (free school meals, school buses, adult learning, apprenticeships, tuition fees) are E6's.
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

Built in E4: section 17 lists what was built and how it differs from this design.

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
  the other landmarks. `lnd2` is `locked`, as `lnd1` is. Built in E8: section 14.

## 10. Phased plan

| # | Subtask | Model | Files | Depends on | Size |
| --- | --- | --- | --- | --- | --- |
| E1 | **Built.** **Citizen model and wire.** `shared/src/education.ts` (levels, tracks, stages, `EDU`, base mix, `eduDefaults`, year group, birthday); `Citizen` fields; snapshot defaults; `CitizenInfo.life.education`, `PersonRow.edu`, `CITIZEN_STUDY`; newcomer seeding (no tilt yet); `loadtest/education.ts` | opus | world.ts, snapshot.ts, protocol.ts, life.ts, simulation.ts (`makeCitizen`, `describeLife`) | none | M |
| E2 | **Built.** **Institutions catalogue.** `buildings/education.ts` kinds 101-108 with two UK designs each; un-reserve the `education` group; the edu1-edu5 tech track and counters; `SHORT` label by kind; viewer | sonnet | buildings/*, groups.ts, tech.ts, compiled.ts (regenerate, never hand-merge), ui.ts | none (attribute names from this doc) | L |
| E3 | **Built.** **Schools sim.** `sim/schools.ts`: admissions batches, the pupil timetable on the commute machinery, attendance, weekly rollover, graduation and drop-out, escorts via carpool, the `school` inspect block, `lifeEvents` | opus | sim/schools.ts, simulation.ts (Home branch, `endShift`, `newDay`, describe), carpool.ts | E1, E2 | L |
| E4 | **Built.** **Jobs, wages, migration.** Skill gate in `findJob`, `jobMisses` by level, `Building.qualified`, wage multipliers, `EDU.match` tilt, brain drain, happiness parts; tuning runs | opus | simulation.ts (`findJob`, `hire`, `payWage`, `lifeFamily`), life.ts, gateways.ts | E1 (runs beside E3) | M |
| E5 | **Built.** **Higher and adult education.** University intake via gateways, halls of residence, families moving in, FE courses, evening classes (`errand` 2), apprenticeships, research ambition | opus | gateways.ts, simulation.ts (`spawn`, `arriveVia`, `ambition`), sim/schools.ts | E3, E4 | L |
| E6 | **Built.** **Policies and the tree UI.** `policies.ts`, `Player.policies`, `setPolicy` intent, Policies panel, Education track in the tech panel; school buses as FleetKind 9 (the server part goes to opus) | sonnet (+ opus for `mobile.ts`) | policies.ts, net.ts, ui.ts, fleet.ts, sim/mobile.ts | E2; the effects need E3 | M |
| E7 | **Built.** **City views.** History series and the Education tab funnel; `ParcelStats` fields; heat overlay; citizen timeline; school tooltip; student look in people.ts | sonnet | history.ts, charts.ts, main.ts, chunkView.ts, ui.ts, render/people.ts | E3 | M |
| E8 | **Built.** **Showcase and London.** Placements and tour stops, registry entries, London universities 111-114 and `lnd2` | sonnet | demo/showcase.ts, demo/london.ts, landmarks-london-3.ts, tech.ts | E2 (E3 for the seeded tests) | M |

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
  student look are E7 (built, section 15).

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

## 14. Built: E8, the Showcase and London

Built 2026-10-18 on branch `edu-e8`. The education kinds are no longer drafts (`draft` is gone from kinds 101-108; the
`education` group keeps no `draft` flag), so `demo:check` enforces them: every kind is placed in the Showcase and has a
tour stop. London gets four university landmarks and ten schools. Details of the demos are in `docs/demo.md` ("Schools in
the demos", "London").

### The Showcase (section `education`, `shared/src/demo/showcase.ts`)

- **In district A2**, on four of its job blocks (the homes stay): the primary school (2×2) with the nursery (1×1)
  beside it, the secondary school (3×3), the sixth-form college (2×2) and the FE college (3×2), each with its door on
  the street between blocks. This puts the schools in the middle of the homes the families are seeded in.
- **The University Quarter**, a new 45×26 parcel east of the town's east road, with one street (y = -26): the 6×6
  campus (gate on the street), two halls of residence (`halls`, `halls-2`: one on each side of the street) and the
  research institute. The tour runs after the library group: nursery, primary, secondary, sixth form, FE college,
  university, halls, research institute.
- **Registry** (`SHOWCASE_FEATURES`): `school-run` (children of nursery, primary, secondary and sixth-form age live within
  the catchment of a school that takes them: `SeededDemo.schools` and `children`), `student-quarter` (halls within 12
  tiles of the university), `school-bus` (todo: E6) and, in London, `london-school-run`. Section 9's `school-run` over
  "a pupil attends a showcase primary" became a seeded test, since no pupil is enrolled before the first admission batch;
  `graduation` is a line of the run report (below), not a feature.

### Families and students for the demos (`server/src/demo/seed.ts`)

- `seedDemoFamilies(w, sim, sections)` runs at the end of `seedDemoNetwork` for a demo that places a school: homes within
  the catchment of a placed primary take up to one family per four beds (two adults, one to three children aged 3 to 17,
  15% under three), at most `DEMO_FAMILIES.max` = 450, from a seeded stream; the adults find work at once. Showcase: 310
  children (about 150 families); London: 819 (450 families). It builds citizens through `Simulation.makeCitizen` and
  `findJob` by a cast (the probe's way), so `simulation.ts` is untouched.
- `seedDemoStudents(w, sim, id)` runs after the fill (in `index.ts` and `check.ts --fill`): each university enrols up
  to 60 (or a sixth of its places) young adults aged 18-22 who are home, through `Schools.enrolAt`, as second and third
  years (`due` 0-13), so a campus is not empty for the first game days. Showcase 60, London 149.

### London (`shared/src/buildings/landmarks-london-3.ts`, `demo/london.ts`)

- **Kinds 111-114**, collection tiers 11-14 of the `london` group, `landmark: true`, civic, family code 14, unlocked by
  the new locked node `lnd2` "London universities" (culture tier 6; requires `edu4` and `cul5`; unlocks `ucl`,
  `imperial`, `kings`, `lse`). Each carries the university attributes (`stage: 6`, `catchment: 0`, `ages [18, 99]`,
  `teachersShare` 0.6, `postgradShare` 0.4), and `SCHOOL_SPECS` now reads a landmark with a numeric `stage` as it reads
  the education group, so the schools simulation takes them with no other change:

| Id | Kind | Footprint | Places / staff | Cost / upkeep | Design |
| --- | --- | --- | --- | --- | --- |
| 111 | UCL (`ucl`) | 4×3 | 360 / 36 | 9,000 / 110 | the Wilkins Building: Portland-stone front between two forward wings, eight Corinthian columns and a pediment on a flight of steps, the green dome on its drum behind, railings and gate piers |
| 112 | Imperial College (`imperial`) | 3×3 | 320 / 32 | 8,500 / 105 | the Queen's Tower (about 3 tiles tall): stone base, brick shaft, stone clock stage and belfry with pinnacles, copper dome and spire, between two brick ranges on the Queen's Lawn |
| 113 | King's College (`kings`) | 4×3 | 300 / 30 | 8,000 / 100 | the Strand building: four-storey stone front with a banded ground floor, a four-column portico, a pediment, a balustrade and lead roofs, side ranges round a courtyard with a fountain |
| 114 | LSE (`lse`) | 3×3 | 240 / 24 | 7,500 / 95 | the Centre Building: a stepped stack of cream masonry (two, four and seven storeys), a glazed corner atrium, a canopy on slim columns over a plaza with red flags |

  Each is one design. Windows follow `buildings:check`'s rule: facade boxes that meet do so on whole cells or with a slot,
  and no `cornice` ring runs over a neighbour's windows. Group tiers may now run to 16 (`validate.ts`).
- **Placement**: `STRUCTURES` entries at the real latitude and longitude, fitted before the streets like the other
  landmarks. UCL lands 1.5 tiles from its place and Imperial 2.6; the West End is saturated with landmarks and
  arterials (the Opera House is 2.4 off), so King's and LSE settle 6.6 and 6.9 tiles (about 1.1 km) from theirs, on the
  same bank, and the tour shows them by their names.
- **Schools** (`london-education` section): six primaries (Islington, Hackney, Camden, Brixton, Clapham, Kensington)
  and four secondaries (Islington, Hackney, Brixton, Hammersmith), each within 2.5 tiles of its spot. London's tour
  gains 14 stops (106 in all).

### Measured (2026-10-18, machine shared with other agents)

`check.ts --fill --run 1`:

| | Showcase | London |
| --- | --- | --- |
| citizens after the fill | 16,407 (90 s) | 30,804 (223 s) |
| children and young people under 18 | 301 | 797 |
| enrolled after the day | 255: nursery 4, primary 60, secondary 101, sixth form 37, degree 53 | 438: primary 209, secondary 111, degree 118 |
| university students seeded | 60 | 149 |
| citizens with a degree / postgraduate | 4,678 / 1,991 | 8,953 / 3,823 |
| `pupils` / `graduates` counters of the owner | 262 / 6,644 | 0 / 0 (London's land belongs to the boroughs, `sys:<borough>`, not to the demo owner the check reads) |
| tick, last game day | 22.5 ms avg, 33.5 p95 | 51.6 ms avg, 85.4 p95 |

Showcase over a school week (`--fill --run 5`, Thursday to the next Wednesday): 35 graduations (8 primary leavers, 13 with GCSEs, 12 with
Level 3, 1 FE course and 1 degree), 19 failed, 3 nursery years, 3 school
leavers going on to a degree, 1 drop-out, 966 days attended; escorts for the under-8s: 28 lifts in a household car, 22
with an older brother or sister, 39 walked in by a grown-up, 40 dropped off on a parent's way to work, 54 missed days;
`life.graduations` 35. The primary school admits 60 of 120 places with 3 of its 6 teachers (E4's skill gate would
change that: section 13), the university runs at 25 of 36 teachers, quality 0.6.

Teachers are whoever took the job until E4, so some London schools and King's College London find no staff in the first
game days (staff 0, "waiting" lists of 21 to 53): the demo is honest about it, and E4 fixes it.


## 15. Built: E7, the city views

Built 2026-10-18 on branch `edu-e7`. Everything here reads what E1 and E3 already keep; nothing new runs per tick. The server side is
one hourly census (`Schools.census`) and one hourly history sample; the rest is client.

### The census feeds the views

`Schools.census()` (hourly, at midnight and before each admissions batch) already walks the citizens once. It now also fills
`Schools.attain` (`attainment()` counts first if no census has run, as for a world just loaded): residents aged 18+ by highest
level (`adults`), residents aged 25-64 by level (`core`, whose mean gives `index`, the education index of section 6) and everyone
enrolled by `Study` (`study`). Citizens moving in or out (`mig`) are left out. It also writes each parcel's figures into
`ParcelStats` and adds the parcel to `dirtyParcels` only when one changed, so a quiet district costs the wire nothing.

- **`ParcelStats`** (all optional, absent from older servers and saves): `pupils` (enrolled at the schools standing on the parcel),
  `places` (their day places), `grads` (residents with a degree or more), `eduIndex` (0-100, the index of the parcel's residents
  aged 25-64, rounded) and `eduN` (how many residents that is, the weight when an estate or the map sums parcels).
- **History** (`docs/charts.md`): 15 new `WORLD_SERIES` in a new `HistGroup` `'education'`: `eduIndex`; `lvlNone` ... `lvlPostgrad`
  (adults by highest level, which is the funnel); `stNursery`, `stPrimary`, `stSecondary`, `stSixth`, `stHigher` (degree and
  postgraduate), `stAdult` (FE courses and evening classes); `passDay` and `dropDay` (passes including nursery years, and fails plus
  drop-outs, over the last 24 hours, from the hourly difference of `Schools.events` so they restart with the process like the transit
  boardings). 3 new `PLAYER_SERIES`: `myPupils`, `myPlaces`, `myGrads`, summed over the player's parcels. Saves need no bump: series
  load by key, so an older save keeps its history and the new series start empty (`history:check` covers it). The wire grows by
  18 numbers per hourly sample, and the full history, with every tier full, is about 37 KB as JSON (the history check prints it).

### Client

- **Charts, Education tab** (`client/src/charts.ts`): a full-width **funnel** card on top, then charts. The funnel is built from the newest
  hourly sample and has no message of its own: one bar per level showing the share of adults who reached it or better, with how many
  stopped there; beside it the enrolment by stage, the last 24 hours' passes and fails, and the **next milestone** (the first
  education node of the tech tree you have not unlocked, with its counter from your `progress`; `ChartsPanel.me` is set by
  `main.ts`). Charts: education index (fitted axis), enrolled by stage, graduates in town (degree plus postgraduate), results in
  the last 24 hours, adults by highest qualification, your schools (pupils against places) and graduates on your land.
- **Parcels:** the parcel panel (`ui.ts`) gets an Education row (index and a word for it, graduates, pupils against places) that hides
  itself on land with nothing to say; the world map's panel (`mapmode.ts`) has Education index, Graduates and Pupils / places rows
  for the parcel and its estate (the map's ground is not tinted by index: the overlay is a 3D-view feature) (the index of an estate is weighted by `eduN`). Both use `eduTotals` in `client/src/eduView.ts`.
- **Overlay:** an **education** chip beside the traffic heat (`main.ts`, `render/eduHeat.ts` `EduHeat`). It tints every parcel with
  residents aged 25-64 by `eduIndex` on a diverging ramp centred on the base mix: red at 40 and below, soft yellow at 62, blue at 84 and above. It is one merged mesh
  rebuilt when the parcels change; a parcel with a school gets a white edge, and a school with nobody living round it is grey. It is per parcel, not per tile:
  the index needs no extra message, and the unit a player decides about is the parcel. (A per-tile byte stream like the traffic heat is
  the follow-up if parcels turn out too coarse.) `msc.setEduHeat(on)` drives it from a console.
- **Citizen panel:** `educationHtml` (`eduView.ts`) replaces the two rows of E1 with the level and track, and under "School and
  college" a timeline: one step per entry of `life.education.history` (stage, place, how it ended, the game week) in green for a pass,
  red for a fail or drop-out and grey for leaving, then the stage they are in now, with the year group, attendance and a progress bar.
- **School tooltip and panel:** `schoolHtml` for `BuildingInfo.school`, in the hover tooltip, the building panel and the demo tour's
  card: pupils or students against places, in class now, places the staffing lets it take, teachers with a degree against needed (and
  postgraduates), catchment, the school day, quality, this year's results and the waiting list.
- **Student look** (`render/people.ts`, `render/citizens.ts`): `CITIZEN_STUDY` (bit 25) is read into `Agent.study`. A grown-up on a
  school trip (sixth form, college, university, an adult course) is dressed in casual clothes with a rucksack (85%) and a lanyard with a
  card (70%; a new near-detail feature bit `G.lanyard`), never a tie or a briefcase. Child pupils keep the school jumper and bag
  that `dressFor` gave them. `Look.student` records it, so the figure is re-dressed when the flag flips.

### Checks

`npm run history:check` gained a section: adults by level add up to the adult residents, the index is in range, nothing is enrolled
while nothing is built, a hand-enrolled student shows in the university series, their parcel's `grads` and the owner's `myGrads`
count a graduate, and a save from before the series loads with the new ones empty and filling on the next hours.


## 16. Built: E6, policies, the Policies panel and school buses

Built 2026-10-18 on branch `edu-e6`. Five switches a player turns on for the schools on their own parcels, a panel for them, and
the school bus (`FleetKind` 9). Verified by `npx tsx packages/server/src/loadtest/policies.ts` (34 of 34 checks, about 80 s).

### The policies (`shared/src/policies.ts`, exported from `@msimcity/shared`)

- `POLICIES` (`PolicyDef`: id, name, blurb, `feature`, `setup`, `runs`, `effects`, `live`), `POLICY_BY_ID`, `isPolicyId`,
  `hasPolicy(list, id)`, and the tunables `POLICY` (costs and effect sizes, all dollars per game day). Ids: `meals`, `buses`,
  `learning`, `apprentice`, `fees`.
- **Opened by tech.** The `unlocks` of `edu2` gained `policy-meals` and `policy-buses`, `edu3` `policy-learning` and
  `policy-apprentice`, `edu4` `policy-fees` (`hasFeature(tech, def.feature)`). The tech panel lists the policies a node opens.
- **State.** `Player.policies?: string[]` (`server/src/world.ts`; saved with the player, optional, unknown ids dropped on load in
  `snapshot.ts`, so old saves load and the format stays 8) and `PlayerDTO.policies?: string[]`. `World.ownerHasPolicy(x, y, id)`
  asks whether the owner of the parcel at a tile has one on: this is how any sim code reads a policy.
- **The intent.** `{ t: 'setPolicy', id, on }` (`protocol.ts`, handled in `net.ts` by `setPolicy` in `server/src/policies.ts`).
  Refused with a toast for an unknown id, for a technology not unlocked, and (to enact) for a treasury under the one-off fee
  (`setup`: meals 120, buses 150, learning 200, apprentice 200, fees 300, ledger `other`). Turning one on twice charges nothing,
  turning one off is free, a read-only showcase refuses it with every other change.
- **Running costs** are charged where the effect happens, to the owner of the school's parcel (`upkeep` in the ledger, fees in
  `fees`).

### What each one does now

| Policy | Live in E6 | Left to a later phase |
| --- | --- | --- |
| Free school meals | `Schools.result`: `+EDU.mealsBonus` pass chance for pupils of the owner's schools. `Schools.midnight`: each school day $0.4 per pupil at school (nursery to sixth form), and each pupil's health +0.3 | the parents' "free school meals" mood (+2), **built in E5** (section 18): **E4** calls `schools.onMeals(pupil)` from `happinessParts` and adds `POLICY.mealsMood` |
| School buses | `sim/schoolbus.ts` (below); $15 per bus that runs | primary schools and the afternoon round |
| Adult learning | the switch, its fee, `live: false` (the panel says "Effect still to come"; a `?dev` client can enact it) | **Built in E5** (section 18): FE courses and evening classes read `w.ownerHasPolicy(school.x, school.y, 'learning')`, charge `POLICY.learnerPerDay` per learner to the school's owner, and flip `live` to true in `policies.ts` |
| Apprenticeships | the switch, its fee, `live: false` | **Built in E5** (section 18): `w.ownerHasPolicy(workplace.x, workplace.y, 'apprentice')`, up to `POLICY.apprenticeShare` of the staff train, the owner pays `POLICY.apprenticeWageShare` of the wage, then `live: true` |
| Tuition fees | university parcel owner: +$2 per student a day with it on, a $1 grant paid per student with it off (`fees` in the ledger, daily, Degree and Postgrad); with it on a stable `POLICY.feeDeter` (30%, by citizen id hash) of would-be students are turned away in `goOn` and `enrolAt` | "more graduates leave town", **built in E5** (section 18): **E4** multiplies the brain-drain leaving chance by `schools.drainMul(c)` (`POLICY.feeDrainMul` 1.5 with fees on at the owner of c's home, else 1) |

`Schools` keeps `owner`, `meals` and `fees` on each school record, refreshed by the census (hourly). Hooks for E4: `schools.onMeals(c)`
and `schools.drainMul(c)`. Hooks for E5: `World.ownerHasPolicy` and the constants in `POLICY`.

### School buses (`FleetKind.SchoolBus` 9)

- **Role.** `mobileRole` (`shared/src/fleet.ts`) makes `MOBILE.schoolBusShare` (8%) of a secondary school's staff its bus drivers
  (hash 441): two or three of 24, working a fixed Monday to Friday from 04:30 (`FLEET_ROTA`). They are drivers whether or not
  the policy is on; with it off they wait at the school and nothing is charged. `FLEET_LABEL` 'school bus', `FLEET_JOB` 'school bus
  driver', `SCHOOLBUS` holds the tunables. The vehicle class is `VehicleClass.Bus`.
- **Service.** `server/src/sim/schoolbus.ts` (`SchoolBuses implements FleetService`), registered by the `Mobile` constructor
  (`mobile.schoolBuses`) so `simulation.ts` needed no change; `mobile.ts` otherwise gained only the bus class and gap. Between
  04:45 and 06:30 on a school day a free driver of a school whose owner has School buses on takes the school's one bus out:
  the secondary pupils still at home who live more than 12 tiles away are grouped by the kerb in front of their home, out to
  the farthest stop that a 30-tile round (`SCHOOLBUS.maxTour`: measured in the probe a bus covers about a tenth of a tile a tick on its
  stops, so a round of 30 tiles takes some three hours and is back before the bell; it is one neighbourhood) allows, the nearest stops on from there, at most 40 seats and 12 stops, the school last.
  The owner pays $15 when it leaves.
- **Boarding is a state change, not a ride.** A pupil who gets on is put in the Work state with the bell as the end of their day
  (as if they had arrived early; their citizen is not drawn on the road and their own panel says they are at school), and is set
  down at the school door when the bus arrives, is taken off the road, or comes back. The bus's panel lists them as riders
  (`aboard`), and `u.loaded` is on while there is someone aboard. A pupil whose day has already ended when the bus gets in is
  counted in `stats.late`.
- **Not built** (a hook each): the afternoon round (call `board` for a school's pupils at the bell and `deliver` at their homes),
  and the under-8s of a primary school, which `Schools.setOff` still counts as `missed` when nobody can take them.
- **Probe result** (`policies.ts`, seed 1, 8 days): 6 drivers among the staff of 4 secondary schools, 6 rounds carrying 11
  pupils (the 30-tile budget keeps a round to one neighbourhood, so few live far enough out and near enough together), all 11 set down at
  school before the bell, $90 charged, one bus out at a time.
- **Client** (`client/src/render/fleet.ts`): a chrome-yellow bus with a black rail, a lit front sign after dark and a hint of
  per-instance paint wear, amber hazard beacons while pupils get on (`working`); `FleetMeshes.body` 'bus' (beams and blinkers as
  a service bus), eye height 0.24; the vehicle panel icon is the bus emoji.

### The panel (`client/src/policies.ts`)

A card for each policy (name, state, blurb, what it costs to run, its effects, a switch) in the tech tree's look. The chip
"policies" (no key: every letter is taken by a tool, the camera or a panel) appears with the first technology that opens one, shows how many are in force, and opening it closes the tech
tree. A card is locked with "needs ..." until its node is bought, disabled with "Need $X" when the treasury is short, and shows
"Effect still to come" for a policy whose `live` is false (a `?dev` client may enact it anyway). The tech panel already listed
every track, so the Education track appears there from E2; E6 widened its grid to six columns (140 px) so the track sits in the
first row, and each node lists the policies it opens.

### The probe (`npx tsx packages/server/src/loadtest/policies.ts`)

Part A drives `setPolicy` through `createGame` with a fake connection: no technology, an unknown id, a missing `on`, short of the
fee, the wrong node, a first enactment, `PlayerDTO.policies`, switching on twice, two on and one off, a sandbox player (all five),
a spectator (refused), one education node per policy, and saves (policies round-trip, junk ids dropped, an old save without them
loads and runs). Part B runs the 2×2 test city of the schools probe for `--days` with meals, buses and fees on: buses ran and
every rider was set down, the owner paid $15 a bus, meals were billed exactly pupils fed × $0.4, fees paid and (after switching
off at day 5) a grant was charged, the hashed 30% were turned away from the university, the E4 hooks answer, and with buses off
no round is sent. `--save FILE --until 2.2` writes a Wednesday 05:00 world with the policies on, for a live look.

## 17. Built: E4, jobs, wages and migration

Built on branch `edu-e4` (2026-10-18), rebased on E3. This section follows section 7, with these differences: skilled
places come in a single tier, "over-qualified" has the narrow meaning below, and a job seeker never passes a near
unskilled place to reach a skilled one (see "Tuning"). All of it sits behind `SKILLS.on`. `ab.ts --set edu=0` turns
off only this. `EDU=0` in the environment turns it off together with E3's schools (`SCHOOLS.on`). The control plays
exactly as main did before E4 (same seeded results on `ab.ts`).

### `shared/src/education.ts`

- `SKILLS = { on }`: the switch.
- `skillDefault(kind, family, level, attrs)` gives `[level, share]` for a workplace. A level's `skill` attribute
  `[level, share]` overrides it. Section 7's table becomes a single tier at the lower level, with two-tier rows added up:
  - shops L1-3: secondary 20/30/40%
  - department store, shopping centre and hotel (L4+): further 30%
  - industry L1-3: further 30/40/50%, L4 50%, L5+ 60%
  - offices L1: further 40%; L2: degree 40%; L3: degree 60%; L4+: degree 70%. London's office towers are level-1
    landmarks and count as the top tier.
  - health: GP 40% to teaching hospital 80% degree
  - police, fire and builders: further 30%
  - the airport: further 40%
  - education kinds (from their `stage` attribute): degree 60%; the university postgraduate 40%; the research
    institute postgraduate 60%
  - everything else: none
- The tables are built once from `MANIFEST`:
  - `skillNeed(kind, level)`: the level the skilled places need.
  - `skilledPlaces(kind, level)`: `ceil(capacity × share)`.
  - `workTrack(kind)`: trades for industry and builders, STEM for health, the university and research, arts and
    business for offices.
- `overQualified({ job, edu, skill })`: a graduate (degree or more) in a place that needs two or more levels less
  (an unskilled place counts as needing none). A degree holder in a further-level industrial place is not
  over-qualified.
- `wageMul(c, kind)`: `EDU.wage[edu]` in a skilled place, × `EDU.trackMatch` when the track fits the workplace; 1 in
  an unskilled place.
- `trackFor(id, edu)`: the hash-seeded track, shared with `eduDefaults`.
- New `EDU` tunables: `gradLeave` 0.5 and `healthBonus` 2.

### `server/src/sim/skills.ts` (`Simulation.skills`)

- **`placeFor(b, edu)` → `Place.None | Unskilled | Skilled`**. A skilled place goes to someone with
  `edu >= skillNeed` while `qualified < skilledPlaces`. An unskilled place is free while
  `occupants - qualified < capacity - skilledPlaces`.
  - `findJob` takes the nearest building that has a place for the seeker's level.
  - `jobMisses` is keyed `tkey(home) * 8 + edu`, and a miss stands while none of the workplaces it passed has a place
    for that level.
- **`hired(c, b)`** (first line of `hire`): takes the skilled place if there is one, else an unskilled one. It sets
  `Citizen.skill` (the level the place needs, 0 for unskilled) and `Building.qualified`.
- **Giving the place back:** `World.quitJob` decrements `qualified` and clears `skill`. `World.mergeLots` re-counts
  `qualified` at the new door.
- **Loading a save:** `snapshot.ts` rebuilds `qualified` via `rehire(c, b)`. A worker saved before E4 (no `skill`)
  gets a skilled place on load when qualified and one is free.
- **`newcomer(id, age)`** (`spawnCitizen`, `arriveVia`): the `EDU.match` tilt.
  - With chance 0.6 (hash-seeded, so it draws no random numbers) the level is drawn from the open skilled places by
    the level they need, weighted by count. These are re-counted at most every 25 ticks, and each draw holds its place
    until the next count.
  - Someone drawn for a degree place at 18-21 arrives aged 22-29 instead.
  - `makeCitizen` takes the result as an optional `EduFields`.
- **Wages:** `payWage` multiplies by `wageMul`. Civic payroll pays the higher wage too.
- **Brain drain:**
  - `day(c)` (`newDay`) counts `Citizen.drain`, the days a graduate who is not studying has been out of work or
    over-qualified.
  - `drainMul(c)` (×3 from `drainDays` 2) multiplies the living-alone leaving chance in `lifeFamily`.
  - `graduated(c)`, wired to E3's `Schools.onGraduated`, sets `Citizen.grad`. That gives "graduated" +5 for 2 days.
    Two days later, a graduate with no matching job leaves with chance 0.5.
  - Graduates who leave this way, or after `MAX_IDLE_DAYS` out of work, count in `stats.brainDrain`. The home's owner
    gets a notice at most once a game day: "Graduates are leaving…".
- **Happiness** (`sim/life.ts`):
  - "studying" +2 replaces "out of work" for an adult student.
  - "over-qualified" -2.
  - "graduated" +5.
  - The health target is +2 for a degree or more (`healthBonus`).
  - "Good school nearby" and "no school place" are left to the school-place work (built in E5, section 18).
- **`fill()`**: places filled and skilled places filled, by group (shops, industry, offices, other). `stats` holds
  `matched`, `newcomers`, `brainDrain`, `skilledHires`, `unskilledHires` and `overQualifiedHires`.

### Tuning

The first build let a qualified seeker pass the nearest unskilled place to reach a skilled one up to 10 tiles further.
On the 1×1 Commons that lengthened the mean commute from 4.51 to 5.37 tiles. It also left unskilled places empty when
jobs outnumber people. Builders' yards and the police stood short-staffed ("other" 74% filled against 95%),
construction slowed, and the town held 6% fewer people on five of five seeds, with peak cars up 30% and give-ups doubled
on a sample seed. That rule was dropped. The search is now the nearest place the seeker's level may take, and the
tilt alone keeps skilled places filling.

### Numbers

`loadtest/education.ts --districts 1 --days 3` (seed 1, on/off with `EDU=0`), where jobs outnumber adults about 2 to 1:

| | shops filled | industry | offices | other | unemployed | commute (tiles) |
| --- | --- | --- | --- | --- | --- | --- |
| on | 79.8% (skilled 81%) | 52.0% (59%) | 40.1% (35%) | 100% | 0 | 4.43 |
| off | 82.3% | 51.2% | 39.0% | 94.5% | 0 | 4.51 |

On, 59.8% of newcomers were drawn for open skilled places, 22.9% of workers are over-qualified, the mean wage multiplier
is 1.113, and 13 graduates left over 3 days. At `--built 1` and `--built 2` every fill rate is within 2 points of the
control. 30 of 30 checks pass:

- `qualified` matches the skilled holders.
- No workplace is over its skilled places.
- Every skilled holder is qualified.
- Wages follow the rule.
- The tilt is about `EDU.match`.
- `qualified` and `skill` round-trip a save.
- A pre-E4 save places its qualified workers.

E3's `loadtest/schools.ts` passes 19 of 19 with E4 on.

**Demos** (`demo:check --run 1 --fill`, on against `EDU=0`). Both still fill their offices:

| | offices filled | industry | shops | other | unemployed | brain drain | gateway out | tick (last day) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| showcase on | 97% (skilled 95%) | 97% | 97% | 99% | 86 of 16,722 | 198 | 852 | 26.9 ms |
| showcase off | 98% | 97% | 98% | 99% | 41 of 16,830 | 0 | 685 | 26.2 ms |
| London on | 51% (skilled 37%) | 24% | 74% | 82% | 128 of 32,531 | 256 | 1,197 | 66.1 ms |
| London off | 54% | 24% | 72% | 81% | 112 of 32,641 | 0 | 1,050 | 64.3 ms |

London has 76,726 jobs for 32,500 people, so it never fills. About 60% of newcomers were drawn for open skilled
places in both demos. The cost is more leavers: brain drain adds 15-25% to the people leaving through the gateways.

**Traffic A/B** (`ab-matrix.ts --hours 8,17 --seeds 1-6 --ticks 1500 --row on= --row off=edu=0`; medians of six seeds,
paired differences on minus off):

| | sim ms/tick | speed | queued | give-ups | commute mean (drivers) | cars mean / peak |
| --- | --- | --- | --- | --- | --- | --- |
| 08:00 off | 1.576 | 26.7% | 66.8% | 391.5 | 73.9 (97.9) | 135.2 / 186 |
| 08:00 on | 1.596 | 27.0% | 66.5% | 374.0 | 69.7 (91.5) | 136.7 / 193 |
| 17:00 off | 0.920 | 29.3% | 64.6% | 234.0 | 54.6 (93.9) | 82.4 / 168 |
| 17:00 on | 0.978 | 30.1% | 63.7% | 222.0 | 50.5 (73.0) | 84.3 / 178 |

- **Paired differences:** give-ups -8 (08:00) and -19.5 (17:00), queued -0.4 and +0.3 points, commutes -7 and -4
  ticks. Every one is within the seed noise (`docs/traffic-tuning.md`: about ±15 give-ups).
- **Tick cost:** the matrix ran four at a time on a machine at load 17. Its +0.04 and +0.08 ms per tick were checked
  sequentially, interleaved, at 17:00 on seeds 1 and 5, three runs each. The medians were the same: seed 1 on 0.791,
  off 0.796; seed 5 on 0.788, off 0.799. The cost is within noise, well under the 5% target.

## 18. Built: E5, higher and adult education, families moving in

Built 2026-10-19 on branch `edu-e5`. Two new files hold the logic, `server/src/sim/families.ts` (`Simulation.families`)
and `server/src/sim/learning.ts` (`Simulation.learning`); every enrolment still goes through `Schools.enrolAt` and
`Schools.leave`. `EDU=0` turns all of it off with E3 and E4; `FAMILIES=0` turns off the families alone. With families off
the branch plays exactly as main on the Commons (`ab.ts`: the same citizens, speeds, give-ups and trips on seed 1 at
08:00 and 17:00).

### Families moving in (`sim/families.ts`)

- **Who.** `Families.join(c, home, travelling)` runs once the first grown-up of an arrival is in town:
  `Simulation.arriveVia` (a gateway) and `spawnCitizen` (in place). With chance `EDU.familyShare` (0.2, by a hash of
  c's id, so no random numbers are drawn) c brings a partner and 1-3 children (`EDU.familyKids` 45/40/15%), as many as
  the home's free beds allow (newcomers already queued for it keep theirs). A home with no bed for a partner and a child
  gets c alone (`stats.noRoom`).
- **Ages.** The children are 0-15, evenly spread. The grown-ups are `EDU.familyParentGap` (21) to 27 years older than
  the eldest: c is made older to fit (a later birthday never lowers what their education allows) and the partner is
  within four years of c. The partner is a newcomer like c (`Skills.newcomer`: the open-skilled-places tilt).
- **The trip.** From a gateway the family comes with c: in c's own car (the inbound drive of `migrate` now carries a
  carpool token, so `takeLift` works as for any household lift, three seats), or walking beside c on the same path. With
  c in a taxi, or with no seat left, the others are at the door already. Children and students moving in no longer
  look for a job on arrival (`migrantHome`).
- **Not during a fast fill** (`World.filling`): the demos seed their families before the fill (`seedDemoFamilies`), and
  a town filled with families would start with a fifth fewer workers than its jobs were laid out for.
- **Demand.** Children take beds and no jobs, so residential demand counts the grown-ups:
  `jobs - (population - children) + 6` (`Simulation.growth`, `Simulation.children` from `recomputeStats`). Commercial
  demand still counts everyone.
- **Parents' moods** (`Families.homeParts`, an input of `happinessParts`): "good school nearby" +3 when every child at
  home aged 4-17 has a place, "no school place" -4 when one has none, and E6's "free school meals" +2
  (`POLICY.mealsMood`) when one of them is on free school meals (`Schools.onMeals`).

### Students from outside, halls of residence (`sim/learning.ts`)

- **The intake.** At 06:00 each university (any school with stage `Degree` and places, London's four landmarks
  included) asks for students for its free places: at most `EDU.intakePerDay` (6%) of its places a day, up to its
  staffed places (`admitting`), or `1 - POLICY.feeDeter` of them with tuition fees on. Each gets a bed first: the
  nearest hall of residence within `EDU.hallsReach` (30) with one free, else a home with room within
  `EDU.studentHomeReach` (25) of the campus. Then a newcomer is queued at a gateway with a tag
  (`Gateways.request(home, jitter, tag)`, released over the next twelve hours; `arriveVia` passes the tag to
  `Learning.student`). With no gateway, or during a fast fill, they move straight in.
- **On arrival** they are 18-20 with A-levels (`EDU.intakeAge`, `intakeSpan`) and enrol on a degree through `enrolAt`;
  a student turned away there (fees: E6's hashed 30%) does not come (`stats.turnedAway`). They travel in like any
  newcomer and look for no job.
- **Halls** (kind 108, `beds` 80) stay civic, family code 14, so the kind keeps its place in the education group: its
  `occupants` are its two staff and its residents are `Building.lodgers`. `World.bedIn(b, n)` counts a resident in or
  out of either (`removeCitizen`, `moveHome`, the snapshot loader, which rebuilds `lodgers` from the citizens).
  `spawn()` never fills a hall (it is not residential), a partner never moves in (`cohabit`), and a hall resident has
  no family life there (`lifeFamily`). A hall's residents count in its parcel's population and in its building panel.
  At 03:00 a resident at home who no longer studies (graduated, failed, dropped out), or whose hall has gone, moves to
  the nearest home with room within `LIFE.moveOutRadius`, or leaves town.

### Adult learning (the `learning` policy, now `live`)

Read at the owner of the FE college (`World.ownerHasPolicy(x, y, 'learning')`). The 03:00 batch:

- **FE courses** (`Study.FeCourse`): an adult out of work for `EDU.feIdleDays` (2) days below Level 3 enrols with chance
  `EDU.feTakeUp` (0.5) a day at the nearest college within its catchment with a day place (shared with its 16-18s).
- **Evening classes** (`Study.Evening`): a worker below GCSEs whose working day runs from 05:00 and ends by 17:15
  enrols with chance `EDU.eveningTakeUp` (0.2) a day on the college's evening places. `Schools` now counts them apart
  (`School.evening`, `admitting(s, Study.Evening)` = `eveningPlaces × staffing`; `schoolTakes` lets an FE college take
  `Evening`), and the inspect block gains `evening`, `eveningPlaces` and `eveningAdmitting`. At 17:30 on a school day
  each learner gets their own minute between 17:45 and 18:15 (`EDU.eveningGo`, `eveningSpread`, by hash per day); at
  home, well and not due at work within three hours, they make a venue trip to the college with `errand`
  `ERRAND_CLASS` (2), stay until 20:30 and a few minutes (`EDU.eveningEnd`), and the evening counts as attended when
  they leave (`att++`). Not home yet: they look again every ten minutes until 19:00, then it is missed. The panel says
  "on the way to an evening class", "at an evening class". A learner who loses their job leaves the class.
- **Finishing.** An adult course ends when `att` reaches its `days` (4 for FE, 6 evenings): `Schools.finish(c)` rolls
  the pass at the college (`pass × quality`). `Schools.result` now raises an adult course one level only, to the
  stage's cap (FE to Level 3, evening to GCSEs). The Saturday results also end a course whose days held reached its
  days. A worker who moved up takes a skilled place at their own workplace if one is free (`Skills.promote`).
- **Cost.** The college's owner pays `POLICY.learnerPerDay` ($1) a learner a day. With the policy off, the courses close
  at the next 03:00 (`Left`).

### Apprenticeships (the `apprentice` policy, now `live`)

Read at the owner of the workplace. At 03:00 a worker under `EDU.apprMaxAge` (25) below Level 3 at an industrial or yard
workplace whose owner has the policy starts with chance `EDU.apprTakeUp` (0.3) a day, while the workplace has fewer than
`ceil(capacity × POLICY.apprenticeShare)` (10%) apprentices. `Citizen.appr` counts the shifts (it is saved with the
citizen, absent for everyone else). `payWage` calls `Learning.shift`: the owner pays `POLICY.apprenticeWageShare` (20%)
of the wage, and after 8 shifts (`STAGES[Study.Apprentice]`) the apprentice holds Level 3 in the trades track, logged
as an `apprenticeship` (`Study.Apprentice` 9 is a log stage and a `STAGES` row only, never a `Citizen.study`), and may
take a skilled place where they work. Leaving the job, a workplace that does not train, or the policy off ends it
(`Left`). The citizen panel shows the apprenticeship as a step with a progress bar (`CitizenEducation.apprentice`).

### Research ambition and the E6 hooks

- A research institute (stage 7, no places) with staff lets merged offices within `EDU.researchReach` (20, Manhattan)
  grow one level above their neighbourhood's ambition (`Learning.lift(b)`, added in `growth` and `planMerge`; the
  institute list is refreshed hourly).
- Brain drain: in `lifeFamily` a graduate's leaving chance is multiplied by `Schools.drainMul(c)` (tuition fees on at
  the owner of their home: ×1.5) as well as `Skills.drainMul`.

### The probe

`npx tsx packages/server/src/loadtest/learning.ts [--districts 2] [--days 14] [--seed 1] [--policies learning,apprentice,meals] [--fees 1]`:
the schools probe's city with no one seeded, plus a motorway connection, so every child and student comes with the
newcomers. Jobs outnumber people there, so nobody stays out of work: once the FE college has staff the probe lays off
twenty workers below Level 3 (as if two days ago) for the FE courses. 30 of 30 checks with the policies on, 18 of 18
with `--policies none`, 30 of 30 with fees, 6 of 6 with `EDU=0` (beds, lodgers and staff match the citizens, no child
works, parents are 18+ years older, halls never over their beds, learners below their course's level, apprentices
within 10% of a workplace's places, research lifts exactly the offices in reach, saves keep lodgers and apprentices).
Seed 1, 14 days (2026-10-19):

| | policies on | `--policies none` | fees on |
| --- | --- | --- | --- |
| citizens | 5,494 | 5,514 | 5,558 |
| families moved in | 620 of 4,507 arrivals (13.8%; 230 more had no bed) | 624 (13.4%) | 620 (13.1%) |
| children now | 1,119 (20.4%): 0-4 344, 5-9 311, 10-14 319, 15-17 145 | 1,125 (20.4%) | 1,122 (20.2%) |
| from the gate | 1,072 rode in the family car, 569 at the door | 1,135 / 531 | 1,072 / 579 |
| students from outside | 115 asked, 89 came (80 to the halls, full) | 63 asked, 50 came | 135 asked, 86 came, 42 turned away |
| FE courses | 5 begun (of 20 laid off), 3 passed, 1 failed | 0 | 6 |
| evening classes | 34 enrolled; 102 trips, 86 evenings attended, 17 missed; up to 13 in class | 0 | 28 |
| apprentices | 30 begun, 1 finished Level 3, 25 training | 0 | 18 begun, 2 finished |
| owner paid | learners $206, apprentices' wages $555 | 0 | $123, $371 |
| parents' moods | good school 423, no place 632, free meals 562 | 502 / 591 / - | 453 / 624 / 602 |
| brain drain | 340 | 382 | 426 |

The family share lands at 13-14% of arrivals because a fifth are drawn and the small homes often lack the beds. An
apprenticeship takes 10-12 game days: industrial workers miss shifts (illness, late starts), so 8 paid shifts come at
about one a day and a half, the "1.5 game weeks" of section 5.

E3's `schools.ts` (19 of 19), E1/E4's `education.ts` (30 of 30), E6's `policies.ts` (34 of 34), `history:check`,
`buildings:check` and `demo:check` pass. With families the 1×1 Commons of `education.ts` has fewer workers for its jobs
(shops 76% filled, industry 39%, offices 36%, against E4's 80/52/40), as children take beds; nobody is unemployed.

### Demos (`demo:check --fill --run 1`, main 967d3e8 against `edu-e5`)

| | showcase main | showcase E5 | London main | London E5 |
| --- | --- | --- | --- | --- |
| citizens | 16,530 | 16,525 | 31,950 | 32,138 |
| under 18 | 301 | 356 | 797 | 1,202 |
| employed / jobs filled (offices) | 16,079 / 98% | 15,958 / 97% | 30,897 / 43% | 30,684 / 42% |
| university students | 52 | 131 (80 from outside, in the halls) | 88 | 111 (35 from outside, in homes near the campuses) |
| families moving in after the fill | | 35 (92 more had no bed) | | 286 (331 more had no bed) |
| tick, last game day (avg / p95) | 19.7 / 29.9 ms | 20.5 / 32.1 ms | 46.7 / 79.3 ms | 47.2 / 75.6 ms |

The demos' owners have no adult-learning or apprenticeship policy on, so those stay at zero there.

### Tick cost and traffic (`loadtest/ab.ts --ticks 3000`, the 1×1 Commons, no schools)

Serial and interleaved, main 967d3e8 against `edu-e5`, seed 1, median of 3 (of 5 for the second 17:00 set):

| | main | E5 | E5, `FAMILIES=0` |
| --- | --- | --- | --- |
| 08:00, sim ms per tick | 0.900 | 0.936 (+4%) | 0.881 |
| 17:00 | 0.889 | 1.002 (+13%) | 0.857 |
| 17:00, second set of five | 0.864 | 0.961 (+11%) | 0.817 |

E5's machinery costs nothing measurable: with families off the branch matches main, trip for trip. The cost is the
children (about 18% of the Commons' people with families on) living their lives with the existing child code: outings
with a parent, lifts, walks beside them. Timing each step of `Simulation.tick` puts the extra in `moveVehicles` and the
traffic step (+19%), not in the citizens' own updates (+2%) or anything E5 added. That is over the 5% target of section
8 at 17:00. Traffic gets lighter, because a home with children sends fewer commuters out:

| seed | 08:00 give-ups main / E5 | cars mean / peak | speed | 17:00 give-ups | cars mean / peak |
| --- | --- | --- | --- | --- | --- |
| 1 | 491 / 441 | 103.7/204 → 95.4/182 | 29.0 → 30.7% | 589 / 586 | 105.7/175 → 105.0/191 |
| 2 | 485 / 438 | 105.0/202 → 95.4/165 | 29.5 → 31.5% | 619 / 562 | 109.2/183 → 103.3/173 |
| 3 | 498 / 445 | 99.6/176 → 99.6/178 | 30.7 → 31.0% | 567 / 544 | 105.1/203 → 106.9/179 |
| 4 | 533 / 397 | 105.5/192 → 93.6/165 | 28.9 → 31.8% | 581 / 471 | 109.3/177 → 97.9/162 |

Trips in the window fall by 10-19% (fewer workers per home); the citizens are within 8% of main on every seed.

**On record for later tuning: what families cost.** Accepted for E5 (2026-10-19): with families on, the Commons runs
+4% sim ms per tick at 08:00 and +11-13% at 17:00, over section 8's 5% target. The cause is not E5's code (with
`FAMILIES=0` the branch matches main trip for trip) but the population it brings: about 18% children, who run the child
behaviour that already existed (going out with a parent, `bringCompany`; riding along in the family car, `rideToVenue`
and the carpool lifts; walking beside a grown-up). Timing each step of `Simulation.tick` puts the extra in
`moveVehicles` and the traffic step (+19%); the citizens' own updates rise 2%. The evening window costs most because that
is when parents take children out. Levers, if it needs tuning: `LIFE.childJoins` (setting it to 0 took about 5% off at
17:00 in one interleaved check), `EDU.familyShare`, `EDU.familyKids`, or the carpool's passenger handling.
