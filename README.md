# msimcity

A web-based, multiplayer, unbounded city builder platform. three.js on the client,
an authoritative TypeScript simulation server over WebSockets, and a shared
package so both sides agree on the world format.

The core idea: players buy and manage **land parcels**, but **citizens are not
theirs**. A citizen lives in whichever residential building spawned them, looks
for the nearest job anywhere on the connected road network, commutes there every
day, pays income tax to whoever owns the parcel they work in and property tax to
whoever owns the parcel they live in. Players compete and cooperate through
zoning, roads and tax rates, not through walls.

## Run it

```sh
npm install
npm run dev          # server on :8080 and Vite client on :5173, both bound to 0.0.0.0
```

Open `http://<your-lan-ip>:5173/` (the Vite banner lists the addresses), pick a
name, and you are in. Every browser that joins shares the same world.

Buildings are data: `packages/shared/src/buildings/` holds one file per kind family, and
`npm run buildings:compile` (run automatically by dev and build) turns it into the tables the
game reads. `/viewer.html` shows every kind, level and design on a turntable by day and night.
Format and a worked example: `docs/buildings.md`. `npm run buildings:check` is its snapshot test.

Production: `npm run build` then `npm start`. The server then serves the built
client and the WebSocket on one port (default 8080). A `Dockerfile` is included;
mount `/data` to keep the world across restarts.

Environment: `PORT`, `HOST`, `SEED` (new worlds only), `WORLD_FILE`, `STATIC_DIR`.
Dev knobs: `SIM_STEPS=10` fast-forwards (ten simulation ticks per interval),
`SEED_BUILT=3` starts a new world with the Commons already built to that level,
and a file named `RESET` next to the world file makes the next start discard it.
Client: `VITE_WS_URL` to point at a server on another host, or `?ws=host:port`. `TEST_CITY_BASE_PORT` (default 8100) moves the test-city ports.
A public showcase (`docs/demo.md`, "A public showcase"): `SPECTATE=1` makes the whole deployment read-only for every client, the
live world and every demo child alike (the children inherit it). The server refuses every intent that changes the world with a
"Read-only showcase" toast (a whitelist in `net.ts`, `READ_ONLY`: subscriptions, inspects, the lines list, the charts), and
the HTTP API refuses demo stop and reset and test-city start and stop (403); starting a demo still works, as that is how a
visitor gets in. The page hides the tool bar, the treasury, the tech tree, Reset demo and the context menu's changes, and joins
at once as a made-up "Visitor 1234" instead of showing the join form. `DEFAULT_DEMO=<id>` (e.g. `london`) sends a page opened
without `?demo=`, `?ws=` or `?city=` to that demo instead of the live world, and the server starts it as it starts; with
`SPECTATE` it is then the only demo the server lists, starts or joins (a `?demo=<other>` link opens it instead). The page
reads both from `GET /api/config`; each world also says `spectate` in its welcome. Without them nothing changes.
`DEFAULT_VIEW="x,y,dist,yaw,pitch[,hour]"` (yaw and pitch in degrees, the hour freezes the lighting) is the camera's opening
shot on a bare page (no camera parameters, no `?demo=` or `?city=`: the `DEFAULT_DEMO` or the live world), also through
`/api/config`, so it can be retuned on a running deployment by changing the env and restarting. `msc.viewString()` in the
browser console gives the current view in that form (with the hour when the lighting is frozen, `?hour=` or the light chip).
Test cities (dev servers only, not with `NODE_ENV=production`): the join form lists the live world and pre-built
1×1, 2×2, 3×3, 4×4, 6×6 and 8×8 district cities (about 950 people per district, level 3, every tech) so you can watch where
the simulation slows down. Choosing one starts it as a child server process (same entry, port 8100+n, world file
`data/test-cities/city-<n>x<n>.json`, `CITY_DISTRICTS=n`), fast-fills a new city before it takes clients, and reloads the
page onto it with `?ws=host:port&city=n` and a "not the live world" banner. `GET /api/test-cities` lists them,
`POST /api/test-cities/<n>/start` (or `/stop`) controls them. A city with no clients for ten minutes is stopped
(`TEST_CITY_IDLE_MS` changes that) and saves on the way out. They survive the dev server's restarts (`tsx watch` reloads on every
save): the main server adopts the ones still running, listed in `data/test-cities/running.json`. Ctrl-C on `npm run dev` (SIGINT), or
`TEST_CITY_STOP_ON_EXIT=1`, stops them; a reload (SIGTERM) does not. `?city=n` alone also starts and joins one.
Demo maps (every server, production included; `docs/demo.md`): the join form also lists the **Showcase**, a lived-in
3×3-district town where every placeable kind bigger than 1×1, every size-ladder rung, a runway, track, two bus lines, a
passenger line and a freight line are placed once and running, and three focused demos (Transport, Leisure, Civic). Each
runs as a child process like a test city (port 8190 for the showcase, world under `data/demos/`), reached through this
server at `/demo-ws/<id>` so one published port is enough; `?demo=<id>` opens one. A **guided tour** panel flies the camera
from object to object with a caption from the catalogue's `blurb` and `howTo` (what it does, how to build it, tool,
footprint, rotation, technology, costs) and the object's live tooltip, with its outline and marks and a floating label on
every stop. **Reset demo** puts the town back exactly as first built. The scenario is data in
`shared/src/demo/showcase.ts`; the seeder (`server/src/demo/seed.ts`) builds it through the players' planners.
`npm run demo:check` fails when a placeable kind, a ladder rung, a surface tool, a line mode or a registered feature
(`SHOWCASE_FEATURES`: every bridge style, a level crossing, every plane type, every helicopter service, every merged lot)
is missing from the showcase.
**London** (`?demo=london`, port 8194) is a sample city on London's shape: the Thames as water with its meander, causeway
bridges, the City and Canary Wharf as merged towers, the West End, rings of homes, docks and industry down river, the parks,
four termini with a line each, freight, buses and Heathrow, with a tour by area. The map is data in
`shared/src/demo/london.ts`, painted by `server/src/demo/london.ts` in place of the 3×3 districts.
The perf readout (top-bar **perf** chip or **M**, always on in a test city) shows the server tick average, p95 and max
for the last minute against the 200 ms budget (amber over 50 ms, red over 200 ms), agents and bytes per second received,
FPS and frame time, agents drawn, chunks loaded and draw calls; `window.msc.perf.readout` has the last second's figures.
Load tests: `nice -n 10 npx tsx packages/server/src/loadtest/run.ts --districts 2 --days 3`
builds an N×N-district test city and times a full game day; results and method in
`docs/load-tests.md`. Traffic A/B: `npx tsx packages/server/src/loadtest/ab.ts --hour 8 --set name=value,...`
runs the Commons through a rush hour with any traffic tunable changed (`docs/traffic-tuning.md`).

## Controls

| Action | Input |
| --- | --- |
| Pan | right drag, shift+drag, WASD / arrows |
| Context menu | right-**click** (press and release without dragging) a person, car, train, plane, building, road, track or land for the actions that exist for it: inspect, follow, first-person view, go to home or work, build priority, parcel settings, buy this tile, demolish (asks again to confirm, shows the cost). Greyed entries say why in a tooltip. Esc closes; also on the FPV inset. `client/src/contextmenu.ts` |
| Zoom | mouse wheel |
| Rotate / tilt | middle drag (or alt+drag) orbits around the point under the cursor; Q E / R F keys |
| Tools | 1 select · 2 buy land · 3 road (drag across water for a bridge) · 4 residential · 5 commercial · 6 industrial · 7 office · 8 police · 9 fire · 0 health · Y builders · P parking · G parks · L libraries · cinemas (tool bar only) · B sport · V theatres (each opens its size picker on the size last used; docs/buildings.md "Groups and tiers") · J airport terminal · U runway (drag) · [ rail halt · ] rail station · `\` freight yard · railway track (drag, tool bar only) · K bus depot · bus stop (tool bar only) · roundabout, flyover (click a junction, tool bar only; a flyover clicked again swaps the deck) · X bulldoze · Esc back to select |
| Turn a footprint | Z turns the footprint of a building bigger than 1×1 anticlockwise, C clockwise, in quarter turns, while its tool is active (airport terminal, bus depot, rail halt and station). The choice sticks for that tool until you change it; before the first press the footprint faces a road by itself. The preview shows each tile's outline, an arrow from the door towards the road (green with a road, red without) and the building's marked parts (platform, apron, stands, vehicle gate); hovering a placed structure shows them faintly |
| People and cars | hover anyone for who they are and what they are doing; click to select them in a side panel with a **follow** camera |
| Trains and planes | hover a train or plane to highlight it; click to select it: a panel with its line or flight, what it is doing, speed, its crew and everyone on board (a train's riders are clickable citizens; plane passengers are visitors), and **follow**. `client/src/vehicles.ts`, docs/rail.md and docs/airport.md |
| First person | with someone selected, **FPV** in the panel or I opens a 16:9 inset (bottom right) from their eyes, **full** or O fills the window (Esc leaves); the view follows their heading and leans into corners, walkers bob, drivers sway, and it ends when they go indoors or arrive. With a train selected it rides in the driver's cab, with a plane in the cockpit. `render/fpv.ts` |
| Overlays | H tints roads by congestion (green → red); T opens the technology tree; M shows the perf readout |
| Bus lines | the top-bar **lines** chip: make a line from your stops (click them in order), number, colour, loop or there and back, buses per line; ribbons show the lines while it is open. `client/src/lines.ts`, `docs/transit.md` |
| Debug | `?dev` shows draft kinds in the tool bar (a dev server accepts them, also on unclaimed land) and, on a dev server, skips technology locks, `?airport=x,y,dir[,gates[,fph]]` previews planes at a placeholder airfield on open land, `?name=…` skips the login form, `?at=x,y&dist=n&yaw=deg&pitch=deg` positions the camera (yaw 0 looks north, 90 west; pitch 90 straight down), `msc.viewString()` prints the view as a `DEFAULT_VIEW` string, `?hour=h` freezes lighting, `?fx=0..2` pins shadow quality, `window.msc` exposes client state |

Buy land by dragging a rectangle. Your first parcel can go anywhere; every
later purchase must share an edge with land you already own (touching at a
corner does not count, and public roads on unclaimed land do not count). You
also cannot island someone else: a purchase is refused if it would wall in
another owner's parcel (the Commons included) so that it can no longer reach
the open country around your holdings, or if it would enclose a pocket of
unclaimed land bigger than four tiles. Small notches are fine and water never
counts as an enclosure. The buy rectangle turns red and the status line says
why before you let go; the server makes the same check and is the authority.
Roads and zones are painted by dragging; zoning and parking lots go round road tiles and buildings
(bulldoze first to rebuild there), and the server says how many lots it left alone and which newly zoned
lots have no road beside them.
Roads can be laid on unclaimed land too (at a premium) so parcels can be joined
up; zoning needs land you own. Nothing gets built until builders can reach it:
connect to a road network that has a builders' yard, or place your own (your
first opens at once; later ones are built at urgent priority by whichever
builders can reach it). Once a game hour the server tells an owner with eight or
more lots waiting why: no yard of their own while the Commons' yard works its own
streets, or a yard that no road links to them. Select a parcel
for its population, jobs by kind, tax income, build list and tax rate.

## Architecture

```
packages/
  shared/   tile encoding, chunk coords, terrain noise, wire protocol (TS types)
  server/   World (chunks, parcels, players, buildings) · Simulation · Net · Store
  client/   three.js renderer, chunk streaming, input tools, DOM overlay UI
```

**World.** An unbounded grid of 32×32-tile chunks. Terrain is a pure function of
`(seed, x, y)`, so a chunk is generated the first time anything touches it and
never needs to exist before that. Each tile is one uint16 (terrain, road, kind family code,
building level); parcel ownership is a parallel int32 per tile, a third byte per
tile (the aux layer) marks the tiles of multi-tile structures (`docs/aux-layer.md`), and a fourth
(the sub layer) holds the catalogue kind id where a family has more kinds than the tile's 16 codes (`docs/sub-kinds.md`). Chunks a player
has changed are persisted; all others regenerate from the seed.

**Simulation** (`server/src/sim/simulation.ts`) runs at 5 ticks/s, 2400 ticks
(8 real minutes) per in-game day, 7 days a week. Every per-tick rate in the sim
is written relative to `TICKS_PER_HOUR`, so the day length can change without
changing behaviour in game time.

- *Growth.* Zoned lots next to a road want to grow when there is demand
  (residential demand follows job surplus and vice versa) and only upgrade when
  mostly occupied. Top-tier housing wants a staffed service nearby. A 1×1 lot
  tops out at level 3; from level 1 a building may instead **merge** with
  neighbouring lots of its zone and owner into a bigger kind (terrace row,
  department store, office tower, heavy plant and twelve more, up to 4×4) that
  climbs to level 7, keeping everyone who lived or worked there
  (`docs/buildings.md` "Merged lots"). Growth does not build anything by itself:
  it opens a **construction site**.
- *Block interiors.* The middle of a block has no road, so nothing grows there
  on its own. Zoning round a block zones its middle too, and a frontage building
  of the same zone and owner grows back into it as a **deep plot** (1×2, levels
  2-4), with its door still on the road; bigger merges reach in as well. When the
  twelve tiles round a 2×2 middle are all homes, the residents plant it as a
  **communal garden**: a small park only those homes count, free to its owner
  (`docs/buildings.md` "Block interiors").
- *Builders.* A builders' yard employs builders. On shift they pick a site by
  priority first and road distance second, travel there, and work it down;
  several builders finish a site faster. Placing a civic building opens a site
  too. If the yard belongs to someone else, the site's parcel owner pays the
  yard's owner a fee per unit of work. Owners can raise, lower or pause each
  site from the parcel panel; paused sites are abandoned by their crews.
- *Occupations and shifts* (`shared/src/occupations.ts`). The workplace kind
  decides the job: office workers are mostly 9–5 Monday to Friday, shops run
  early, day and late shifts with rotating days off, factories run three shifts
  round the clock, police do three 8-hour shifts, firefighters 24 on / 48 off,
  hospital staff 12-hour shifts. Each citizen has a fixed personal jitter and
  leaves home early enough for their own commute, so traffic is staggered.
- *Getting around.* About half of citizens own a car (office workers more) and
  drive anything beyond a short walk; everyone else walks. A trip is a list of
  legs: walk to the car, drive, park, walk the last stretch. Walkers use the
  sidewalk side; routes are re-planned if a road disappears.
- *Traffic* (`server/src/sim/traffic.ts`). Every road tile has one lane per
  direction holding two cars. The server works out real positions: right-hand
  lanes 0.19 from the centreline, tight arcs round right turns and wide arcs
  round left turns, so a car's corners stay where a car's corners would be.
  Drivers follow bumper to bumper plus a personal gap (never closer than the
  two vehicles' lengths allow), pull out of a building only when the last car
  to leave has cleared the start, and never overtake. At the edge of every
  tile a car decides once whether to go in: there must be room in the exit
  lane beyond the box, no movement already in the box that conflicts with its
  own (a precomputed conflict table of all approach/exit pairs, built from the
  lane geometry), no pedestrian on that tile's carriageway, and a green light
  where the owner has signals. Pedestrians walk the right-hand sidewalk,
  wait at the kerb for cars already in the box before crossing (at junctions,
  on left turns and when their door is on the far side), and cars hold at the
  stop line while someone is on the crossing. Each tile keeps a congestion
  average that drivers route around (A\* with turn and junction costs,
  re-routing after a long wait with hysteresis), that the heat overlay shows,
  and that road tooltips report. Behind all of these rules a body guard is the
  last resort: no car moves its body onto another car or a pedestrian, and no
  pedestrian steps into a car. A driver who has not reached a new tile for 60
  ticks gives up, so a jam can always clear. The rules and their values live in
  `TRAFFIC_TUNING` (`shared/src/tuning.ts`); `docs/traffic-tuning.md` has the
  measurements they were chosen from. With Junction design (Transport tier 3) a
  junction can be rebuilt as a **roundabout** (a 3×3 one-way ring round a planted
  island, anticlockwise since traffic drives on the right, give way to the ring on
  entry, no lights) or a **flyover** (one road lifted over the other on a deck, no
  conflicts and no turns): `shared/src/junctions.ts`, aux bytes 0xf0–0xfa.
  With Civil engineering (Transport tier 3) a road dragged straight across up to
  12 tiles of water, from a road on one bank to dry land on the other, becomes a
  **bridge** (stone arch, steel girder or suspension by span and hash; $120 a
  deck tile): plain straight road to the traffic, nothing joins it from the side,
  bulldozing any of it removes the whole bridge (`shared/src/bridges.ts`, aux
  bytes 0xd8–0xdf, drawn by `client/src/render/bridges.ts`).
  Besides commuters the roads carry delivery trucks (industry → commerce, a
  fee per drop), visitors driving in from the edge of the network at peak
  hours, and, with the Patrols technology, police patrols, fire engines and
  ambulances that ignore signals.
- *Parking.* Buildings have a few surface spaces, or many more underground
  once the owner has Deep foundations; an arriving car drives in and holds a
  slot until it leaves. When the destination is full the driver heads for the
  nearest parking lot within ten tiles (a buildable kind: twelve bays, a fee to
  the parcel owner, visible parked cars), parks and walks. With no lot in reach
  they park at the kerb, which costs that lane a slot and slows the street.
  Tooltips show spaces, turned-away counts and lot income.
- *Car sharing* (`server/src/sim/carpool.ts`). A driver leaving home may take
  household members due out within half an hour (same workplace, or dropped
  at the door on the way when the detour is small) and a neighbour working
  nearby (picked up from home), at most three passengers and two stops; a
  parent driving to an outing takes the children who come along. Going home,
  people without their car at work or a venue wait up to an hour for family,
  a colleague living near or a friend leaving by car. Passengers are not road
  users while aboard: they get out at their stop or where the car parks and
  walk the rest with the driver. How readily people share is per household and
  per pair (hash-seeded, rolled per trip or per day). The car's panel lists who
  is in it (names select them); a passenger's says whose car they are in.
  `CARPOOL=0` switches it off for before/after runs.
- *Technology* (`shared/src/tech.ts`). Four tracks of three tiers (zoning,
  construction, transport, civic). Each tier needs a counter the player's own
  city drives (construction work done on their land or by their builders, road
  tiles, residents housed, jobs filled) and a one-off price. Costs and conditions
  were tuned for the first two hours (docs/early-game-audit.md "After Gauntlet 3"). A new player starts with roads,
  residential zoning and a builders' yard; the Commons has everything, so it
  shows what the tree leads to. The server enforces the tree when building and
  when zones try to grow; the client greys out locked tools.
- *Sizes* (`shared/src/buildings/groups.ts`, `shared/src/tiers.ts`, docs/buildings.md "Groups and tiers"). Services and
  leisure come in size ladders, from a GP surgery or a police box on one tile to a 4×4 teaching hospital, a 3×3 police
  headquarters, a construction company, a multi-storey car park, an opera house or a floodlit stadium. The tool bar
  shows each ladder once; its size picker lists every rung with a snapshot, footprint, capacity, coverage, upkeep, cost
  and the technology it needs. Bigger rungs cover homes further and more strongly, send more patrols and ambulances,
  bring more and faster builders or hold bigger crowds; the larger ones open late in the Civic, Construction and
  Culture tracks.
- *Landmarks* (`shared/src/buildings/landmarks-london.ts`, docs/buildings.md "Landmarks"). Real London buildings (the
  Gherkin, the Shard, the Walkie Talkie, One Canada Square, the Royal Opera House, and five more to come), tagged
  `london`, each working as an office tower or a venue. The tool bar's Landmarks section has one London button whose
  picker lists them. Their tech node, London landmarks, is locked until its unlock rule is decided, so for now they are
  placed only in sandboxes (test cities and demos, where the London demo has them in their real places).
- *Buses* (`server/src/sim/transit.ts`, `docs/transit.md`). Public transport, a fifth transport tier, opens bus
  stops (a shelter beside a plain stretch of road), a 3×2 bus depot whose staff drive the buses (one bus out per
  driver on shift, 05:30–00:30) and the Lines panel. Buses are 0.6-tile vehicles in the ordinary traffic model: they
  pull in on the stop's road tile, dwell while people get off and on (40 aboard at most, $2 a ride to the line's
  owner, children free, retirees half), and hold briefly when they catch up with the bus ahead. A citizen whose car
  is at home weighs a line (a stop within 5 tiles of each end, one change allowed, a short walk between stops) against
  walking and driving, with a hash-seeded personal taste for each; riders wait in a small crowd at the stop, ride
  hidden in the bus and walk on from their stop. Lines are drawn as ribbons while the panel is open; stop and bus
  tooltips show lines, waiting, the next arrival, load and delay.
- *Airports* (`shared/src/airport.ts`, `docs/airport.md`). Aviation, a fourth
  transport tier, opens an 8×7 airport terminal (placed facing a road, staffed
  by ground crew on early and late shifts) and the runway tool: drag a straight
  line of 10 or more tiles five tiles behind the terminal and a six-row strip
  of runway, shoulders and taxiway is painted. A finished terminal with an
  intact strip is an airport. Planes fly a timetable that is a pure function of
  the tiles, so the server and every client agree without a wire message, and
  each landing pays the owner a fee. Bulldozing any strip tile grounds it.
- *Railways* (`shared/src/rail.ts`, `docs/rail.md`). Rail, the transport tier after Public transport, opens track
  (painted by dragging on your own land, one corner per drag, joined up where drags meet; it crosses a straight road at right
  angles on a level crossing, whose barriers close ahead of each train while cars, buses and walkers wait, and no water yet), a 4×2 halt and a 6×3 station whose platform runs along the back row, behind which the track
  must run. Rail lines are transit lines: pick stations in order in the lines panel, loop or there and back, and
  trains. Consecutive stations must be joined by track and no two lines may share track (no signals yet). A train
  is a locomotive and two to four carriages; where it is is a pure function of the line, its route and the tick,
  so only the lines and their routes go over the wire. Trains run 05:00–01:00 spaced by a headway, brake into every
  platform and dwell there, reverse at the ends of a there-and-back line (one train) or run round a loop (as many
  as fit), and riders board and alight through the transit registry. Bulldozing a track tile grounds the line.
  A line of freight yards (6×3, a loading dock on the track and a truck gate on the road) is a freight line: a
  locomotive and 4–8 mixed wagons (container flats, tankers, hoppers, vans) that stand longer to load. Industry
  within 12 tiles of a yard sends most deliveries by train when the line reaches a yard near the shop: a truck to
  the yard, the train, a last-mile truck from the far yard, and $4 a container to the line's owner.
- *Gateways* (`server/src/sim/gateways.ts`, `shared/src/gateways.ts`). Newcomers arrive and leavers go through the town's
  gateways: the **motorway connection** (a 2×3 dual carriageway end placed at a road end on the edge of town, no technology
  needed, tool bar only), rail halts and stations, the bus depot (intercity coaches) and the airport terminal (plus a share
  of every plane's passengers). Each gateway's `gateway`, `gatewayModes` and `arrivalsPerHour` are catalogue attributes.
  When a home has room, a newcomer queues at the best gate (nearest, weighted by capacity), is released at a jittered
  time within the gate's hourly capacity, appears there and travels home with a suitcase on foot, by taxi or driving
  their own car with a roof box (hash-seeded per person), moves in and looks for work. Leavers (idle too long, broke,
  taxed out, living alone and moving on) pack up, travel to the gate that suits them and are removed there; their bed
  frees when they have gone. With no gateway in town people spawn in place and leave at once as before (the home's owner
  gets a notice once a day). Visitors and inter-city freight (lorries in to shops, a quarter of factory deliveries out)
  enter and leave by the motorway connections instead of the farthest road tiles. The stats line shows today's net
  migration and who is waiting at the gates; a gateway's panel shows arrivals and departures today and yesterday.
  Fast fills (test cities, demos) bypass the gates. `npx tsx packages/server/src/loadtest/gateways.ts --days 2` probes it.
- *Lives* (`server/src/sim/life.ts`). Every citizen has a birthday (one game week is about a year), health and a
  household. Newcomers arrive as adults aged 18–45; children are born to couples living together once their home has
  a free bed (the home then holds its next free bed from newcomers), grow up at 18 and look for work, and people
  retire in their sixties and die of old age, more often past 75. Health drifts with age, factory and site work,
  time stuck in traffic and hospital coverage; flu comes in seasonal waves and spreads at home, factory and site
  workers get injured, chronic illness comes with age. The ill skip shifts, see a doctor at the nearest staffed
  hospital, and stay in when very ill. Singles pair up with colleagues or neighbours and move in together, grown-up
  children move out, people living alone leave town now and then (more when unhappy or crowded), and friendships
  (at most five) start at work and over a drink; friends and children come along on evenings out. Happiness
  (commute, money, health, services, nights out, company) and the last week's money in and out show in the
  citizen panel, where family and friends are clickable; homes list residents by household. A life step runs once
  per game day per citizen, staggered over the day. `npx tsx packages/server/src/loadtest/lives.ts --weeks 4`
  fast-forwards a test city and prints its population pyramid, households, births and deaths.
- *Cafés, bars and restaurants.* Commercial buildings double as venues: some
  people stop for a coffee before work, many go out after an evening shift, and
  people on their day off go out in the afternoon and evening. Visitors spend
  money and the venue's parcel collects sales tax.
- *Mobile jobs* (`server/src/sim/mobile.ts`, `shared/src/fleet.ts`, `docs/mobile-jobs.md`). Some workers work on the
  road: a hashed share of shops are cab offices whose staff drive cabs (roof sign lit for hire, waiting at a station or
  airport rank) or private hire from home in their own car; a quarter of café and restaurant staff deliver meals on
  bicycles and mopeds that filter past queues at the kerb edge; waste and recycling depots (a share of industry) send
  bin lorries round each district on its weekday, stopping at every home's kerb while a bin is tipped, and street
  sweepers two days later; warehouses and distribution centres send courier vans in a morning and an afternoon wave.
  A citizen without a car (or out for the night) weighs a taxi against walking, the bus and driving; homes order food
  at lunch and dinner and get parcels. The workers keep their ordinary jobs, so jobs and housing stay balanced; fares,
  meals, collection fees and parcel fees go to the owners. Tooltips show cab offices, takeaways and depots at work and
  a home's bin day; a worker's panel links to the vehicle they are out in. `loadtest/mobile.ts` probes it.
- *Parks and leisure venues* (`shared/src/buildings/leisure.ts`, `shared/src/leisure.ts`). Parks (no
  staff; a pocket park grows into a park and a large park with use), libraries and community halls, cinemas,
  sports halls and theatres (Culture tech track) are placed like civic buildings. Every citizen has a leisure
  need that drains over a few days; a visit restores it by the place's leisure value, and parks near home
  top it up a little each day. An outing (after a shift, a free afternoon or evening) scores the open places
  in reach by time of day, life stage, the citizen's hash-seeded taste for that kind of place, an event about
  to start and distance, against a bar: cinemas peak in the evening and on premiere nights, retirees and
  children favour parks and libraries by day, and children old enough go to a free park or library on their
  own. Friends and children still join. Tickets are spent like bar tabs (sales tax to the parcel) and staff
  are paid from the takings; visitors drive and park like anyone else. Homes count the leisure places in
  reach (their leisure coverage), which raises growth, the taxes residents will bear and happiness
  ("+5 park nearby", "−4 nothing to do"). Trees and benches in parks are instanced (`client/src/render/parks.ts`).
  `npx tsx packages/server/src/loadtest/leisure.ts --days 2 [--ages 6-90]` places a park, a cinema and a library
  in a test city and prints arrivals by venue type and hour, the mean leisure need and happiness reasons.
- *Money.* Wages, income tax (to the work parcel), property tax (to the home
  parcel), sales tax (to the venue parcel), road upkeep, civic upkeep and public
  payroll (police, fire, hospital and builders are paid by the parcel that
  hosts them; public services' wages are half grant-funded, `ECONOMY_TUNING.civicPayroll`
  in `shared/src/tuning.ts`). The treasury chip shows yesterday's net and, on
  click, the ledger: income and spending by category (taxes, fees, wages, upkeep,
  builders' fees, construction, land, technology) for yesterday and today, sent
  with the players message once a game hour (`PlayerDTO.ledger`). High taxes make workers quit and residents leave; nearby staffed
  services raise what people will put up with.
- *Onboarding* (`shared/src/goals.ts`, `server/src/goals.ts`, `client/src/onboarding.ts`). A chain of 13 goals for the
  first two hours (claim a plot, a street, homes, your own builders' yard, 12 residents, shops, Masonry, 50 residents,
  police and fire cover, a park, a day in the black, 250 residents, a bus line), measured server-side a few times a game
  hour from the player's parcels and progress counters, one active at a time with the next two previewed, each paying a
  modest reward (cash through the ledger, or Commercial zoning free). The card sits beside the tool bar with progress
  bars and a "show me" (picks the tool, flashes its button, opens the panel, looks at the plot); the `goals` chip in
  the top bar hides it, and "skip the tutorial" is saved with the player (`Player.onboarding`, absent in older saves;
  goals a returning player has already met are marked done without a reward). Advisor hints (`HINTS`) come as a strip
  under the card, at most one per two game hours, never again once "got it" is pressed: the server sends builders,
  deficit, jam, boredom and newcomers hints (messages `goals` and `hint`), the client raises night and empty-treasury
  ones. The tech chip pulses with the node's name when one becomes ready and affordable. Test cities and demos get none.

Hover any building for its live stats: residents and where they work,
staff on shift or commuting, shift patterns, customers, construction progress,
payroll, upkeep and parking. Hover a road for its congestion, cars, speed and
junction control. Hover a person or a car for their name, job, shift, where
they are going, whether they are held up and where their car is; click to pin
them in a panel and follow them.

**Networking** (`server/src/net.ts`). Clients subscribe to the chunks around their
camera and receive full chunk snapshots on subscribe, then only tile deltas and
moving citizens for those chunks. Agent frames carry only what changed since the
last tick (a quad in the Home state removes an agent), and a subscribe sends the
chunk's current agents. Congestion and lot occupancy go out as one byte per tile
per chunk every two seconds. Per-client bandwidth therefore depends on what they
look at, not on how big the world is. Parcels and players are small and
broadcast to everyone for now.

**Client rendering** (`client/src/render/`).

- *Ground.* One mesh per chunk, UV-mapped into a procedurally drawn atlas
  (`atlas.ts`): grass, water, sand, pavement, zone markers, dirt, and 16 road
  tiles auto-selected from each tile's N/E/S/W neighbours, with curbs, dashed
  centre lines and crosswalks at junctions. Chunk edges re-tile when a
  neighbour arrives.
- *Buildings.* Low-poly models built from boxes, prisms and cylinders with
  baked vertex colours (`kit.ts`, `models.ts`): four designs per kind and
  level, chosen per tile by hash, so a street mixes cottages, bungalows and
  L-shaped houses, cafés, diners and corner stores, silos, refineries and
  container yards, ziggurats, twin towers and glass slabs. A construction site
  raises the shell of the design that will stand there. Facades take a subtle
  per-kind tint on top. Every building in every loaded
  chunk is an instance in a single `BatchedMesh` (`buildings.ts`), so the whole
  city is one draw call. Buildings face the nearest road. Sites show the new
  building rising with progress under a crane tinted by priority.
- *Detail by distance.* Buildings draw in three tiers by distance from the camera (`buildings.ts`). Past about
  120 tiles (each building at its own hashed threshold, with hysteresis) a building swaps to a far model built
  from the same recipe without its small parts and with plain walls (`models.ts` `farOps`), roughly halving the
  city's building triangles in a zoomed-out view. Within about 37 tiles a chunk gets name boards (`signs.ts`):
  shops, offices, works, venues and civic buildings carry a name (`shared/src/names.ts`) on a fascia over the
  ground floor, homes a street number over the door, all drawn once into one canvas atlas; each board fades in
  by its own distance and shop and venue boards light up at night. `msc.buildings.setLod(false)` turns the
  tiers off for comparison.
- *Windows by day.* The same shader draws glazing at every hour on the lit-window grid: dark panes in a
  frame and sill a little lighter than the wall, reflecting the hour's sky with a Fresnel term, each window
  with its own curtains, blinds or open sash. The window class sets the layout: small sashes on homes, full
  height shopfronts under a signboard, curtain-wall bands with mullions and spandrels on glass offices,
  arched civic windows, tall venue windows and clerestory strips only on factories. Detail fades to the class
  average once a cell is a few pixels, and unlit panes at night stay dark glass (`materials.ts`; `Kit.add`
  gives every part an `aTop` height so a factory can find its eaves).
- *Lighting.* A sun that follows the in-game clock (click the clock chip to
  freeze it), filmic tone mapping, soft shadows from a camera-following shadow
  frustum, a blue hour between sunset and night, and a window shader in which
  every window keeps its own hours: homes light up as people get in and go dark
  at bedtime, shops close through the evening, offices empty early with a few
  cleaners left, hospitals and stations stay lit, factories run night shifts,
  TVs flicker, early risers switch on before dawn. Street lamps pool warm light
  along roads, each coming on at its own moment, a few dead or sputtering
  (`materials.ts`, `lighting.ts`). Shadow quality adapts to frame time; `?fx=0|1|2`
  pins it.

  **Standing rule: every effect gets an organic distribution.** Nothing in the
  city switches in lockstep. Seed per-instance offsets from a hash and vary
  onset, intensity and duration rather than using one global threshold.
- *People and vehicles.* Capsule-and-head pedestrians with a walking bob on
  the sidewalk side, sedans, emergency vans with light bars and builders'
  flatbeds in the right-hand lane, all instanced and interpolated between
  server ticks (`citizens.ts`).
- Chunk views are created and disposed as the subscription set changes while
  you pan, so you can scroll indefinitely in any direction.

## Why TypeScript on the server

At the scale of a few hundred players the bottleneck is the citizen simulation
and update fan-out, not player input. Sharing the protocol, tile codec and terrain
generator between client and server removes a whole class of desync bugs, and a
single Node process handles hundreds of connections and tens of thousands of
citizens at this tick rate. What gets the world to "unlimited" is the chunked
design: the next step is running regions of chunks in separate processes behind
a gateway. The simulation is isolated from networking and storage precisely so a
hot shard could later be rewritten in Go or Rust without the client noticing.

## Roadmap

- Real accounts (the name you type is your identity today; nothing is secured).
- Region sharding: one simulation process per block of chunks, a gateway that
  routes subscriptions, and citizen hand-off between shards.
- Database-backed store (Postgres for parcels/players, chunk blobs in object
  storage or Redis) replacing the JSON snapshot in `data/world.json`.
- Binary wire format (the protocol is already flat numeric arrays for the hot
  messages, so this is mechanical).
- Selling and subdividing parcels, land value, utilities, avenues and transit,
  and a proper economy loop for commercial/industrial income.
- Level-of-detail chunk rendering when zoomed far out; frustum-based
  subscriptions instead of a radius.
- Griefing controls: public roads can currently be bulldozed by anyone.
