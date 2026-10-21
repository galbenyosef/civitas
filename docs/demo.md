# Demo maps and the guided tour

A demo map is a planned, lived-in town where every large object in the game is placed once and running, with a
guided tour that flies the camera from object to object and explains each one. It is for showing the game and for
teaching it.

| Demo | Port | Sections | Tour stops |
| --- | --- | --- | --- |
| **Showcase** | 8190 | all ten | 113 |
| Transport demo | 8191 | Downtown, Buses and parking, Rail and freight, Airport, Industry | 36 |
| Leisure demo | 8192 | Downtown, Leisure | 27 |
| Civic demo | 8193 | Downtown, Civic services | 32 |
| **London** | 8194 | Areas, Landmarks, Schools, Rail and Heathrow, Buses, The Thames, The Underground (its own map, below) | 106 |

Code:

- `shared/src/demo/showcase.ts` holds the scenario as data, the tour (`demoTour`), the completeness rule (`showcaseProblems`) and the feature registry (`SHOWCASE_FEATURES`).
- `server/src/demo/seed.ts` is the seeder: `seedDemoTown`, `seedDemoNetwork`, `fillDemo` and `worldHash`.
- `server/src/demo/check.ts` is `npm run demo:check`.
- `server/src/testcities.ts` is the world launcher. Demos are its second kind of child world, beside test cities.
- `server/src/index.ts` has the `DEMO=<id>` branch.
- `client/src/tour.ts` holds the tour panel, the labels and the demo start, reset and revive helpers.
- `client/src/worlds.ts` is the picker on the join form.

## Opening a demo

The join form lists the demos under the live world. That is on every server, production included: demos are the tutorial. Test cities stay dev-only. Choosing a demo starts it, waits while the town is built, then loads the page with `?demo=<id>`. `?demo=showcase&name=Ana` skips the form.

- The first start of a demo seeds and fills its town, about 75 s for the showcase. Later starts load the saved world in a few seconds.
- A demo is a sandbox, like a test city. Whoever joins gets every technology and unlimited funds. The banner says it is not the live world.
- A demo with nobody connected for ten minutes saves and stops (`TEST_CITY_IDLE_MS`). The page asks for it again when its socket drops.

### One port

Each demo runs as its own process on `8100 + slot`, where the slot is 90 for the showcase. The page never connects to that port directly. It connects to `/demo-ws/<id>` on the server it was loaded from, and the main server pipes that socket to the demo's port (`TestCities.upgrade`). A deployment that publishes only 8080 therefore works, over `wss://` too. `?ws=host:8190` still connects directly on a LAN.

### HTTP API

| Request | Effect |
| --- | --- |
| `GET /api/demos` | every demo: status, fill progress, citizens, clients, `startHash` |
| `POST /api/demos/<id>/start` | starts the demo; a no-op when it is running |
| `POST /api/demos/<id>/stop` | stops it; it saves on the way out |
| `POST /api/demos/<id>/reset` | **Reset demo**, below |
| `GET /api/config` | how the deployment is run: `{ spectate?, defaultDemo?, defaultView? }` (below, "A public showcase") |

With `SPECTATE=1` stop and reset answer 403 with the reason; start still works.

### Reset demo

After its first fill, a demo child saves its world and copies it to `data/demos/demo-<id>.seed.json`. **Reset demo** in the tour panel does three things:

1. It stops the child.
2. It copies that snapshot back over `data/demos/demo-<id>.json`.
3. It starts the child again.

The town comes back exactly as first built, citizens included. The world save does not keep per-day counters, so after a reset, or any restart from a saved world, the tooltips' today and yesterday counts (visits, riders, flights, containers) start from zero and fill as the day runs. The people, vehicles, trains and planes are moving from the first tick. Only a first fill arrives with a whole day counted. Without a snapshot, for example after an interrupted first fill, reset removes the world so the demo seeds again.

The town is deterministic as well. The seeder uses fixed coordinates and a fixed terrain seed. While a demo is seeded and filled, `Math.random` is a seeded generator (`seededRandom`), so a fresh seeding gives the same town. The child reports a hash of every modified chunk's tile words, aux, sub and under bytes (tunnels and platforms), the station names and the transit lines (with their names) as `startHash` on `/healthz` and `/api/demos`.

### A public showcase

Two environment variables on the main server turn a deployment into a read-only showcase of one demo (the public one
is London at civitas.reneo.app, from the Dockerfile's image):

- `SPECTATE=1` makes everything read-only for every client: the live world and every demo child. The world launcher
  sets `SPECTATE=1` in each child's environment (`TestCities.start`), and a child left running by a server started
  the other way is stopped rather than adopted (`/healthz` reports `spectate`). The server is the authority:
  `net.ts` answers only the intents in `READ_ONLY` (hello and ping, chunk subscriptions, the inspects of buildings,
  roads, people and trains, a parcel's build list, the lines list and the charts) and refuses everything else
  (building, bulldozing, buying, parcel settings, build priority, lines, technology, dev actions, onboarding) with a
  toast, "Read-only showcase: you can look around, but nothing can be changed here". It is a whitelist, so a new
  intent is refused until it is listed. There are no onboarding goals, a sandbox's grant of every technology and
  endless funds is not made, and the player record a visitor's hello makes is removed when their last socket
  closes, so the save does not collect everyone who ever looked. On the HTTP API, demo stop and reset and test-city
  start and stop answer 403; starting a demo is allowed, since that is how a visitor gets in.
- `DEFAULT_DEMO=<id>` sends a page opened without `?demo=`, `?ws=` or `?city=` to that demo instead of the live world,
  and the main server starts that demo as it starts, so the town is filled before the first visitor arrives.
- `DEFAULT_VIEW="x,y,dist,yaw,pitch[,hour]"` is the camera's opening shot on such a bare page: the tile looked at,
  the distance, the orbit angle and the tilt in degrees (yaw 0 looks north from the south, 90 looks west from the east;
  pitch 90 is straight down, 10 is near the horizon) and, optionally, an hour that freezes the lighting (the light chip
  lets it run again). The page puts the camera there at once and again when it joins, after the tour has placed it on
  its welcome stop. It is sent in `/api/config`, so it is retuned on a running deployment by changing the env and
  restarting the container, without a rebuild. To frame a shot by hand, open the demo, set the time with `?hour=` (or
  the light chip), move the camera and run `msc.viewString()` in the browser console: it prints the view in this form.
  The same shot works as URL parameters, `?demo=london&at=x,y&dist=n&yaw=deg&pitch=deg&hour=h`.
  For London `DEFAULT_VIEW=-2,-1,45,35,28,10.5` looks north-west over the Thames at mid-morning: the Shard in front,
  the Gherkin and the City behind it, the Tower and Tower Bridge to the right, Parliament and the London Eye up river.

The page asks `GET /api/config` before it connects (`{ "spectate": true, "defaultDemo": "london", "defaultView": "…" }`) and each world
says `spectate: true` in its welcome. In a showcase the page skips the join form: it joins as a made-up "Visitor
1234", and while the demo starts the join card shows "Building London… 42%" instead of the name field (no world
picker, no Play offline). Once joined, the tool bar, the treasury, the tech tree chip, Reset demo and the context
menu's changes (demolish, buy, build sooner, later, pause) are hidden, tool keys do nothing, the parcel panel has no
tax slider or name field and the lines panel lists every line without edit buttons. The camera, hover tooltips, the
building, person and vehicle panels, follow, first-person view, the congestion and perf overlays, the underground view,
the charts and the guided tour all work. The banner reads "London: a read-only showcase" and, with `DEFAULT_DEMO`
set, offers no way back to the live world. With `DEFAULT_DEMO` set the showcase shows only that demo: `/api/demos` lists
just it, starting another answers 403 ("This showcase only shows its own demo"), `/demo-ws/<other>` is refused, and a
`?demo=<other>` link opens the default like a bare page (each demo is a child process of about a gigabyte). Without
`DEFAULT_DEMO` every demo stays reachable. Test cities stay dev-only (`NODE_ENV=production` has none).

The demo worlds live beside the world file: with the Dockerfile's `WORLD_FILE=/data/world.json` they are
`/data/demos/demo-<id>.json`, the first fill's snapshot `demo-<id>.seed.json` and the child's log `demo-<id>.log`;
`/data/test-cities/running.json` lists the children. The children's ports are 20 above `PORT` plus the slot (8194
for London with `PORT=8080`; `TEST_CITY_BASE_PORT` moves them), inside the container only.

Sizing, measured 2026-10-18 on the dev Mac (12 cores, shared with other agents, load average 13-33, so a dedicated
host does better): London's cold start, seeding and filling with nobody waiting, took 455 s from the server's start to
`running` (the fill itself 450 s, 31,200 citizens); a start from its saved world took 10 s. Running with one visitor the
London child holds about 1.1-1.2 GB resident and uses about half a core (the simulation runs whether anyone watches;
tick average 100-170 ms under that load); the main server with the live world about 150 MB. On disk London is a
42 MB world plus a 42 MB seed snapshot, so allow about 100 MB of `/data` for it.

## London

**Road classes in London (R3).** London's main roads are painted as doubled streets (two street tiles side by side, as
the test cities' edge roads are), not avenues: turning them into avenues needs each pair oriented into two one-way
carriageways with junction flags at every side street and turn, through `londonPlan`'s street layer, which was not cheap
for R3. A follow-up (the ARTERIALS as avenues, the M4 and A13 approaches as motorways from gateways).

London is a sample city rather than a teaching town: the Thames runs through it with its recognisable meander, and the
land round it is zoned roughly as London is. It is a `DEMOS` entry like the others (slot 94, port 8194, `?demo=london`),
with `town: 'london'`, its own tour order (`tour`) and welcome view (`view`). Its sections are ordinary demo sections, so
every station, landmark, track drag, bus stop and line goes through the same planners as the showcase's.

Code:

- `shared/src/demo/londonMap.ts` is the map as data and the street plan: the Thames as a centre line of real latitudes
  and longitudes with a width at each point and the bridges, the docks, about 90 named places, the parks, the land kept
  clear (Heathrow and the railway corridors), the main roads (`ARTERIALS`) and the boroughs (`BOROUGHS`), and
  `londonPlan`, which lays the streets.
- `shared/src/demo/london.ts` is the scenario: the landmarks, stations, stops, lines and tour. It is built on first
  use (`londonScenario`, through `demoSections('london')`), so a process that never opens London never plans it.
- `server/src/demo/london.ts` (`seedLondon`) paints the plan into the world in place of `seedCity`'s districts, and
  makes the boroughs and their parcels.
- The Landmarks section places the London landmarks (docs/buildings.md "Landmarks") where the real ones stand: each
  structure is fitted before any street is laid, as near its real place as the land allows, on the real one's bank of
  the river, off the water, the railways, the main roads and the bridges' landings, a tile clear of the others; the
  streets are then planned round them with a road along every front. Parliament stands on the river south of
  Westminster Bridge with Big Ben at the bridge end and its door on the bridge's approach, the London Eye faces it
  across the river, New Scotland Yard is on the Embankment north of the bridge, Buckingham Palace faces St James's Park,
  the Tower of London is on the river by Tower Bridge, the Shard by London Bridge, the Gherkin and the Walkie Talkie in
  the City, One Canada Square at Canary Wharf and the Royal Opera House in Covent Garden. `demo:check` fails a landmark
  that no city demo places. Tall placements are framed from further out on the tour.
- **Piccadilly Circus** (kind id 116, `landmarks-london-4.ts`; docs/adverts.md section 9) stands where Piccadilly ends
  at the West End: its 4×2 plot fills the block between Oxford Street and Piccadilly, its front on Piccadilly and Regent
  Street (a short main road in `ARTERIALS`, down from Oxford Circus) along its west side. Piccadilly's main road starts at
  the Charing Cross Road, so it runs past the circus's front as Coventry Street; the Charing Cross Road, a tile east of
  the circus, stands for Shaftesbury Avenue too at this scale, and a side street runs south from its door as Haymarket.
  The 159's Piccadilly stop is beside its east end. Its six big screens (the Piccadilly Lights) take turns showing two
  of the town's campaigns, house adverts and the news (server/src/demo/adverts.ts seeds the two). The tour stops there
  after the West End, at night (below, "The tour").
- **The universities** are landmarks too (kind ids 111-114, `landmarks-london-3.ts`, tech `lnd2`; docs/education.md
  section 14): UCL's Wilkins Building by Gower Street, King's College's Strand building and LSE's Centre Building in
  Aldwych and Covent Garden, and Imperial's Queen's Tower in South Kensington. They are fitted with the other landmarks
  (`STRUCTURES` in `shared/src/demo/london.ts`, in the Landmarks section) and each works as a university, so they take the
  sixth-form leavers of the boroughs' schools. UCL and Imperial land within 3 tiles of their real places; the West End
  is already full of landmarks and streets, so King's and LSE settle about 7 tiles (a kilometre) off, on the same bank.
- **Schools** (section `london-education`): six primary and four secondary schools among the homes of Islington,
  Hackney, Camden, Brixton, Clapham, Kensington and Hammersmith, fitted like the landmarks (within 3 tiles of the spot
  asked for). Families with children live round them (`seedDemoFamilies`, below).
- **Tower Bridge is a real crossing.** The Landmarks section lays it as a bridge (`bridges`, a `DemoBridge` with
  `style: 'Bascule'` and `landmark: 'tower-bridge'`, its ends taken from the plan's Tower Bridge) rather than placing
  the structure: a bascule span is drawn as the landmark's model with its lifting leaves, and the traffic drives over
  it, waiting at the barriers while it lifts. A bridge's `landmark` counts as placed for the landmark rule, and its tour
  stop frames the span.

How the map is made:

- **Scale.** `geo(lat, lon)` puts Charing Cross at (-20, 0), 6 tiles a kilometre, x east and y south. The map is
  224×112 tiles, x from -112 to 111 and y from -56 to 55, from Isleworth to the Thames Gateway and from Walthamstow to
  Wimbledon. The Isle of Dogs and Greenwich peninsula loops are drawn larger than life so the land inside them holds
  blocks. At this scale a tile is about 170 m, so the streets are London's main roads and the larger side streets.
- **River.** A Catmull-Rom curve through the points; a tile is water when its centre is within half the width of the
  curve. The width grows from 3.5 tiles upstream to 16 off the east edge. Every dry tile is on the north or the south
  bank (`londonBase().bank`), which the landmarks and the boroughs follow.
- **Bridges** (`londonBridges`). Each named crossing bridges the shortest run of water along a row or column near it
  (a little dearer the further it strays), with dry land that is not a park or a railway at both ends and a tile clear
  of the bridges already chosen; chosen from the river alone, before anything else, so the landmarks keep off the
  landings. Each is a real road bridge (shared/src/bridges.ts), laid through `planBridge` as the road tool lays it, in
  the style of the real one (`BRIDGE_STYLES`): stone and iron arches (Richmond, Kew, Chiswick, Putney, Battersea,
  Vauxhall, Lambeth, Westminster, Blackfriars, Southwark), girders (Wandsworth, Waterloo, London Bridge, Blackwall),
  suspension spans (Hammersmith, Chelsea, the 8-tile Woolwich crossing) and Tower Bridge's bascules. No road joins a
  deck from the side. Westminster Bridge sits a little north of the real one so Parliament fits between it and Lambeth
  Bridge.
- **Streets** (`londonPlan`). Not a grid: in order, (1) the main roads, real arterials drawn from latitude and
  longitude waypoints as L-shaped legs or staircases of legs at least two tiles long (Uxbridge Road, Bayswater Road,
  Oxford Street and Holborn to Cheapside, Whitechapel and Mile End; Marylebone and Euston Road to City Road and Old
  Street; the Highway and Commercial Road to the A13; the Edgware Road, Tottenham Court Road and Camden High Street,
  Upper Street and the Holloway Road, Bishopsgate and the Kingsland Road; Coventry Street, Piccadilly, Knightsbridge and
  Kensington High Street to Chiswick; Regent Street from Oxford Circus to Piccadilly Circus; the King's Road; Kennington and Brixton Road, Borough High Street and Walworth Road, the Old Kent
  Road, Jamaica Road to Woolwich, Clapham Road, Lavender Hill to Richmond, the South Circular; the loop round the Isle
  of Dogs over the gaps between the docks); a road along every placed structure's front; a road round every park; each
  bridge's approach on to the nearest road. (2) Each cell of land left between them is split by through roads until it
  is no bigger than its character allows (`STREETS.cell`: 14 tiles in the City, 22 in the suburbs), then filled with
  parallel streets (along the river where the cell meets it, else along the cell's long side) `depth` lots apart and
  cross streets between them at staggered places `len` lots apart, so neighbouring blocks never line up into a
  lattice: T junctions, offset streets and the odd cul-de-sac; a few cross streets run straight through every strip
  of the cell, so a trip across the grain does not zigzag. The grain follows the character: blocks 2-3 lots deep and
  2-4 long in the City, 3-4 by 3-6 for the inner rings, terraces 3-4 deep and 5-8 long in the suburbs (longer ones
  cost too much in detours: see the fill below). A side
  street is never laid where it would make a 2×2 of road or leave a sliver of lots one deep between two parallel
  streets; a street broken by a gap of one or two lots is joined up, and a spur of one or two tiles left where one
  was cut short goes back to lots. (3) A pocket of three or more
  lots no road reaches in a dense character gets a short cul-de-sac (the suburbs keep theirs as gardens), and every
  road joins one network: a link over land, through a park, or over a railway on a level crossing, or the road is
  dropped; each structure's front is joined to the network at both ends where a short link can (a station or
  landmark at the end of a cul-de-sac jams its own traffic). `plan.loop` marks the road tiles on a loop of the network (not on a dead-end branch, Tarjan's bridges), where
  a bus can carry on and come back round.
- **Railways.** Each line runs in a one-tile corridor that only crosses roads at right angles. Where a main road crosses
  one, or streets meet it from both sides (a street a tile or two short on the far side is carried on to it), the road
  crosses on a level crossing (docs/rail.md), a few tiles apart along the line, never at a corridor's end or beside a
  station, and a stretch of more than eight tiles without one gets one carried through to the streets either side:
  29 in all, three of them on the King's Cross line between Camden and Islington.
- **Zoning.** Each block (lots between roads) takes the character of the nearest place (distance over the place's
  reach): `city` (offices, merged towers and headquarters on 90% of blocks), `westend` (shops, offices, stores),
  `civic`, `inner` (dense homes, some mid-rise), `outer` (homes, high streets, gardens), `suburb` (low homes with
  gardens), `industry` (works, depots, heavy plant). The zone of each block and the lot levels come from hashes, so
  neighbouring blocks differ. Merged buildings stand anywhere in a dense block their footprint fits on its lots with
  the door on a road. The lots behind the frontage are settled as growth would settle them (sim/blocks.ts
  `settleInteriors`, level 2): communal gardens in rings of homes, else deep plots built from the frontage lot in front; behind
  suburban and outer homes they are back gardens, and a pocket no road reaches is a communal garden.
- **Boroughs and parcels.** The land belongs to the London boroughs, each a player (`sys:<borough>`, every technology
  and an endless treasury, its own colour) whose parcels follow the real outline: `BOROUGHS` are polygons of real
  latitudes and longitudes, a tile goes to the first one holding it on that borough's bank, and the rest (and the
  river, split down the middle) to the nearest borough. The map is cut into rectangles on 4×4 cells (2×2 where a cell
  holds land of both banks, so the river stays the boundary), at most 32 tiles a side: 194 parcels, each named after
  the place nearest it in its borough, so the overlay reads as a borough map (one outline per owner, see
  client/src/render/parcels.ts) and the tooltips name the neighbourhood. The lines belong to the town (`sys`, the demo
  owner); a demo is a sandbox, so its lines call at any owner's stops and stations and run from any owner's depot.
- **Services.** Police, fire, a 1×1 hospital, a builders' yard and four car parks on every 25×25 cell, each on the
  frontage lot nearest its spot, as in a `seedCity` district.
- **Jobs near every home.** Homes thin out towards the suburbs (levels 1-2, gardens behind, an eighth of suburban blocks
  left as commons) while shops, offices and works stay full size everywhere. A newcomer's job search is a bounded
  breadth-first search, and in a first draft with job-poor suburbs the searches that found nothing made fill ticks of
  several seconds. The town has about twice as many jobs as people.
- **Buses.** Each stop is on a frontage lot near the real one, beside a plain stretch of road (never facing a junction)
  on a loop of the network, preferably a main road, on the side the server boards it from (`boardDir`: south, east,
  west, north), three tiles or more from the route's other stops. The 25 and the 159 run out and back; the D3 runs one
  way round the Isle of Dogs loop.
- **The Underground** (section `london-tube`, docs/underground.md section 7). Three Tube lines run there and back with 8
  trains each: the **Central** (red, `0xdc241f`) from Shepherd's Bush under Notting Hill Gate, Marble Arch, Tottenham
  Court Road, St Paul's, Liverpool Street, Bethnal Green and Mile End to Stratford; the **Northern** (drawn dark grey,
  `0x3a3a3a`, as the real black would not show underground) from Camden Town by Euston, Tottenham Court Road, Charing
  Cross, Waterloo, Kennington, Stockwell and Clapham Common to Balham; the **Jubilee** (`0xa0a5a9`) from Baker Street by
  Green Park, Westminster, Waterloo, London Bridge, Canada Water, Canary Wharf, North Greenwich and West Ham to
  Stratford. Stations closer than 6 tiles along a line are left out (Oxford Circus, Bond Street, Bank). Each station
  is fitted where the real one is (`TUBE` in london.ts, latitude and longitude through `geoF`) by `fitEntrance`: the
  nearest frontage lot, spiralling out, on dry land beside a road, off the railways and the landmarks, with room
  underneath for its platform, which runs the way the line goes there (towards its neighbours) and may neither overlap
  nor touch another end to end. A station that changes with a rail terminus (Liverpool Street, Stratford, Waterloo)
  lands within the 4-tile change walk of that station's door, and a second line's entrance of the same name within
  the walk of the first (Tottenham Court Road, Waterloo, Stratford), so riders change on foot. The termini, Liverpool
  Street, London Bridge and Canary Wharf are halls (6-car platforms) where a two-lot frontage fits; the rest are kiosks,
  and where neither fits along the line (a cramped interchange) the platform turns across it. The stations go through
  the real planners on the boroughs' land (a sandbox, so the town's lines call there), are named with
  `World.setStopName`, and the lines are saved through `Transit.saveLine`, which bores them in order: about 290 tunnel
  tiles under the streets and the Thames, with three crossovers where the lines cross (the Central and the Northern
  by Tottenham Court Road, the Central and the Jubilee by Marble Arch, the Jubilee and the Northern by Waterloo). The
  tour stops at Tottenham Court Road, each line, under Waterloo (`tube-crossover`, with the underground view on) and
  Canary Wharf.
- **The Thames** (section `london-river`, docs/boats.md 8.1). Each pier and harbour is fitted as a landmark is, before
  the streets (so a road runs along its front), as near its real place as fits: its back rows over the Thames or a dock,
  its front on the real one's bank, open water behind it as deep as its boats need and at least three rows, with the
  second row out and a tile beyond each end of it water all round (so the river keeps a channel a river bus or a barge
  can pass), a tile clear of every bridge deck. A pier also needs a tile of open water beyond each end of its berth.
  - **River bus RB1** (`0x1d3e8a`, 5 boats) runs there and back under every bridge between five piers named with
    `World.setStopName`: Millbank (by Vauxhall Bridge; Westminster's banks are Parliament, New Scotland Yard and the
    Eye), Embankment (below Waterloo Bridge), Tower (below Tower Bridge: the Pool is four tiles long here, and from
    Waterloo to Tower Bridge the bridges are three tiles apart, which leaves no room for Bankside or London Bridge
    City), Canary Wharf and Greenwich. It changes with the Jubilee line at Canary Wharf, the 25 at Embankment and
    Tower, and the D3 at Greenwich.
  - **St Katharine Docks** is a new `DOCKS` basin (4×3) east of the Tower, opening on to the river where it bulges
    north, with a marina in it: motor cruisers and narrowboats, and yachts that sail up into the Pool of London through
    Tower Bridge's lifts (`demo:check`'s `tower-bridge-lift`). A jetty on Chelsea Reach (up river of Battersea the
    river is three and a half tiles wide, and a jetty there would leave the barges no channel to Teddington).
  - **Down river of every bridge** (Blackwall and Woolwich stay bridges): Dagenham Docks, a cargo port on the north
    bank with container ships, coasters and ro-ro ferries from the estuary, a tug, and barges all the way up to
    Teddington under every bridge; Thamesmead Fish Quay across the river, whose trawlers fish beyond the estuary.
  - **Sea gates** (`londonSeaGates`): "the estuary" where the Thames leaves the margin's east edge and "Teddington"
    (low) at the south-west, each the middle water tile of the river's run along that edge.
  - The tour stops at Embankment Pier, RB1 and Millbank Pier by Westminster, the Pool of London (`pool-of-london`, a
    spot) with St Katharine Docks and Tower Pier after Tower Bridge, the Chelsea jetty with Clapham, Canary Wharf's and
    Greenwich's piers, and the port and fish quay in the Thames Gateway.
- **Margin.** A 24-tile ring of plain grass round the map (`LONDON_MARGIN`), with the river running on out of it, so
  the noise terrain's lakes do not read as more river from above. It has no parcels; players can buy it.

What a fill gives (2026-10-17, machine shared with other agents, load average 12-26). With the 4×4 grid: about 29,000
citizens after 2.4 game days in 140 s, 62,500 jobs, 8 lines running. With the street plan: about 31,500 citizens in
190-200 s (the same scenario run side by side, so the same load), 77,000 jobs (the deep plots behind shop and office
frontage add jobs the empty middles did not), 8 lines running. The next 900 ticks from 09:30, timed in-process side by
side: 51-62 ms against 44-53 ms a tick, 1.59-1.89 against 1.46-1.77 ms per 1,000 citizens, so about 7-9% more per
citizen. The difference is routing: an irregular network makes longer searches and more congestion, so more drivers
reroute (`findRoute` from `maybeReroute`). Two things brought it down from 31% per citizen: the finer outer grain
above (the routes' detour over the Manhattan distance fell from 1.48 to 1.22 against the grid's 1.10) and joining
the stations' fronts at both ends. Without the fast fill (`demo:check --run`) London grows slowly on either map: a
newcomer arrives through a live gateway once there is one (sim/gateways.ts), and on the new map one station is staffed
early, which ends the start-up arrivals sooner (1,400 citizens after 2.4 days against 7,800).

The tour runs west to east along the river and then round the rings: Westminster, the West End, the City and the
Great Eastern line to Stratford, Waterloo and the line to Clapham Junction, Canary Wharf, the Isle of Dogs and Greenwich,
the docks and the Thames Gateway freight line, Hackney, Islington and King's Cross, Camden, Kensington, Paddington and the
Heathrow line, Wembley, Kew and Heathrow. Area stops are `blocks` with a `blurb` of their own.

## The scenario

The town under every demo is a 3×3 grid of Commons-style districts from `seedCity` (`DEMO_TOWN`).

- Each district is 22×22 tiles with roads every 5 tiles. Every zone is pre-built to level 3.
- The grid spans x and y from -35 to 34.
- Districts are named A1 (north-west) to C3 (south-east), rows A to C running north to south.
- Inside a district, a **block** is the 4×4 of lots between roads. `block(di, dj, bi, bj)` in the data file gives its rectangle.

Sections clear the blocks they use and place their objects there. Rail, freight, the airport and the riverside sit on extra land outside the perimeter road.

A section (`DemoSection`) lists:

| Field | What |
| --- | --- |
| `land` | extra parcels for the town's owner, such as the railway strips and the airfield |
| `clear` | blocks bulldozed to bare ground before anything is placed |
| `zones` | blocks rezoned and built to level 3: homes beside the airport, the industrial estate, shops by the east freight yard |
| `placements` | `{ kind, door, rot }`: the catalogue kind's string id, the tile a player would click, and the FRONT rotation (0 the door faces south, 1 east, 2 north, 3 west). `id` defaults to the kind and must be unique. Bus stops are placements too |
| `water` | rectangles painted as open water: a scenario's river (no tool makes water) |
| `roads` | straight road drags, laid as the road tool lays them on the owner's dry land. Track drawn later straight across one makes a level crossing |
| `classRoads` | `{ cls, from, to }`: road drags of a class (docs/roads.md "Classes"), planned and laid as the road tool does (`planRoad`: an avenue's or motorway's twin row on the drag's left, a drag across a one-way or divided road keeping it), in order after `roads`. The Road classes section lays one of each |
| `runways` | `{ from, to }`: a runway drag |
| `tracks` | drags as a player makes them; each runs along its longer axis first and turns once |
| `junctions` | a roundabout or flyover clicked on a junction (`deck` picks the road on top) |
| `bridges` | a road bridge over water from `from` to `to`, laid through `planBridge`, with a forced `style` (the road tool's choice otherwise); `landmark` draws a bascule span as that landmark |
| `lines` | bus, rail or metro lines: stops in calling order (bus stop tiles or station doors), loop or there and back, vehicles. `freight: true` for a line between yards; `name` for a line known by name (the Central) |
| `blocks` | grown land the tour stops at: zones nobody places, and block middles (deep plots, a communal garden) |
| `spots` | a tour stop on something that is neither a kind nor a drag, such as a level crossing, the river, the helipads or a Tube crossover. The caption is `SPOT_CAPTIONS[spot]`; `view: 'under'` turns the underground view on there |
| `seaGates` | where the scenario's water leaves the playable world (docs/boats.md 2.3): `{ x, y, name, low? }`, written to `World.seaGates`; every harbour derives its sea, fishing and river lanes to them |

A placement of a merged lot (a zone kind bigger than 1×1 that growth assembles, `GROW_FORMS` in shared/src/zones.ts) takes a `level`. Nobody places these. The seeder builds each on lots of its zone, as growth would: through `planStructure` with those lots seen as empty, before the block middles round it are settled.

`TOUR` lists the ids in tour order, plus `welcome`. A focused demo is a `DEMOS` entry naming the sections it seeds. Its tour is `TOUR` filtered to those sections.

Some choices make every system busy:

- **District B1 is a suburb.** Seven of its nine job blocks are homes. Its people commute out, which makes their trips long enough for a bus. Line 1 runs from the suburb east along y = -1 to downtown and the airport. Line 2 runs north and south through the suburb along x = -25, between the civic district and the industrial estate.
- **Districts A1 and A3 hold civic and leisure.** They replace job blocks, never homes, so the town keeps a few more jobs than people. All 10,000 people are employed, and every placed building is fully staffed, the airport and freight yards included.
- **The industrial estate's nearest shops are by the east yard.** The estate is in C1 beside the west yard. Every shop nearer to it is homes, so its deliveries qualify for rail.
- **The stadium faces the north road next to the rail station.** The halt sits among the homes of A2, 30 tiles away, inside the 40-tile limit on a night out.
- **The riverside quarter is reached only over its bridges.** A river four tiles wide runs east-west south of the freight line, on rows 44 to 47. The bascule's model, Tower Bridge, is drawn for a 4-tile span. Four streets run down from the south perimeter road over the railway land and cross the river: a steel girder bridge at x = -20, a stone arch at 5, a bascule at 15 and a suspension bridge at 25. The freight line's track crosses the first street on a level crossing. Beyond the river, ten 4×4 blocks lie between the river road (y = 49) and y = 54. Together they hold one of every merged lot: works to the west, then shops, offices and homes. The last block is a ring of homes round a communal garden. Bus line 3 runs there and back from the street down to the stone bridge, over it and along the river road. The road runs on past the quarter to a dead end at x = 33, where the buses turn round by themselves. Everyone who lives or works there crosses a bridge, so all four carry traffic. The traffic waits at the bascule's barriers while it lifts for a barge, and at the level crossing while a freight train passes.
- **The runway is 20 tiles,** long enough for the jumbo (`PLANE_TYPES.jumbo.minRunway`). Every plane type therefore lands at the showcase airport.
- **The harbour** (section `harbour`, docs/boats.md 8.1), on the land east of the town (`Harbour`, x 35-79, y 31-56).
  The river runs on past the riverside quarter into a basin (x 45-95, rows 39-55) that opens to the sea in the east:
  a declared sea gate, "the sea", at (95, 47). A quay road along y = 33 from the east perimeter road serves the cargo
  port, Eastport Docks (its quay the basin's north edge), and a bay (rows 36-38) with Eastport Fish Quay and Harbour
  Pier. Between the lifting bridge and the suspension bridge, a pool off the north bank, as wide as the marina, holds
  Lifting Bridge Marina, its door on a spur from the street down to the lifting bridge: its yachts, sailing barges and
  dinghies are too tall for a closed bascule, so they cruise out through its lifts (on day 4 of the first week).
  Past the suspension bridge the Quarter Jetty and Riverside Pier stand by the river road, the pier two tiles from
  bus line 3's stop at (32, 48): river bus line 1 runs there and back to Harbour Pier with 3 boats. Every boat type
  but the launches sails within the first week. The tour stops at the marina, the jetty, both piers and the line, the
  fish quay, the port and the sea gate.
- **One underground line, the Crosstown** (metro line 1, in the rail section, so the transport demo has it too): a kiosk, Station Road, 3 tiles from the rail station's door on the railway land at (17, -36); a kiosk by the arena, Arena, at (27, -19); a hall, Eastgate, at (27, -2), 2 tiles from bus line 1's stop at (25, -2). Every platform runs north-south (`rot: 1`), so the tunnel leaves Station Road southwards, turns once under the stadium's district and runs straight down x = 27 under the roads and blocks between: 39 tiles bored, 2 trains of 4 cars, there and back. Riders change to the passenger line or bus line 1 on foot. The tour stops at the kiosk, the line (with the underground view on) and the hall.

- **The schools and the university** (section `education`, docs/education.md section 14), in district A2 and on a new parcel east of the town. Four job blocks of A2 (among its homes, never replacing them) hold the primary school (2×2) with the nursery (1×1) beside it, the secondary school (3×3) in the middle, the sixth-form college (2×2) and the further-education college (3×2), each with its door on the street between blocks. The **University Quarter** (a 45×26 parcel, x 35-79, y -40 to -15, off the east road at x = 34) has one street, y = -26: the 6×6 campus with its gate on it, two halls of residence (one on each side of the street) and the research institute.

## How seeding uses the players' planners

Seeding has two phases, because stops, track and lines need the simulation's services. In `index.ts` the child calls `seedDemoTown` before creating the Simulation and `seedDemoNetwork` after rail is registered. Each phase goes through the same planner the matching player tool uses:

| Object | Planner | As the player's tool |
| --- | --- | --- |
| multi-tile kinds | `planStructure(kind, door, env, rot)`, then `World.placeStructure(…, { built: true })` | `Net.placeStructure` |
| 1×1 kinds | own land, dry, not a road, nothing built there, `hasRoadAccess` | `Net.build`, civic branch |
| water | painted into the terrain (scenario only) | none |
| roads | own dry land, not a structure; a road on track is a level crossing (`roadOverTrackProblem`) | `Net.road` |
| merged lots | `planStructure` with the lots of its zone seen as empty, then `World.placeStructure(…, { target: level })` | growth's `planMerge` |
| runway | `planRunway(line, env)`, applied tile by tile | `Net.runway` |
| roundabouts, flyovers | `planRoundabout`, `planFlyover`, then `World.placeJunction` | the junction tools |
| bridges | `planBridge` with the scenario's style, then `World.placeBridge` | `Net.road` over water |
| bus stops | bulldoze the lot, then `BusService.stopProblem` (no junction) | `Net.build`, `busstop` |
| track | `Rail.paint(owner, trackDragPath(a, b))` (planTrack) | `Net.track` |
| metro stations | the 1×1 or `planStructure` rules above, then `Metro.platformFor` with the placement's `rot` (the platform along x for an even turn) and `Metro.lay` | `Net.build` and `Net.placeStructure`, which lay the platform with the site |
| harbours and piers | `planStructure` like any multi-tile kind: its wet back rows over the scenario's water, a band of open water behind | `Net.placeStructure` |
| names | a placement's `name` goes to `World.setStopName` at its door: a station's, a pier's, a harbour's | the station and harbour panels |
| sea gates | `World.seaGates` from the sections' `seaGates` (scenario only) | none |
| lines | `Transit.saveLine` (a metro line bores its tunnel and is charged in `Metro.commit`; a ferry line finds its route on the water, `Ferry.route`) | the lines panel |

`saveLine` validates the stops, routes bus lines on the roads, rail lines through the track (`Rail.route`), metro lines through the tunnels it has just bored and ferry lines on the water between the piers (`routeWater`), and refuses shared track or tunnel and a second line at a pier. The seeder registers a `Metro` and a `Ferry` with the transit registry when the scenario has their lines and the caller has none (demo:check and the load tests build their own `Rail`); a demo child has them from `game.ts`. Every refusal is collected. The child exits with the list if there is any, so a broken scenario never seeds quietly. Everything is pre-built complete.

`fillDemo` then has two stages:

1. It runs the simulation until the population settles (`fillCity`).
2. It runs on through one more whole game day and stops at 09:30.

A visitor therefore arrives in the morning with yesterday's counters filled in: visits, riders, flights and containers.

## Schools in the demos

A school with no children is a still life. The families of E5 (children arriving with their parents, docs/education.md section 18) do not move in while a demo fast-fills, so its town starts with the workers its jobs were laid out for, and the couples who settle have no school-age children for years. So a demo with schools in its scenario seeds its own (`seedDemoFamilies` in `server/src/demo/seed.ts`, called at the end of `seedDemoNetwork`; a demo with no school placed gets nothing, so the transport, leisure and civic demos play as before):

- **Families.** Before the fill, every home within the catchment of a placed primary school (12 tiles, Manhattan) takes up to one family for every four beds, each by chance, to at most `DEMO_FAMILIES.max` (450) families: two adults and one to three children, 15% of them under three and the rest aged 3 to 17, the adults in work at once (`findJob`). The stream is seeded, so the same town gets the same families. The showcase starts with 310 children and young people (about 150 families, in the 56 homes round the primary school); London with 819 (450 families, in the homes round its six primaries). A home of the grid town is a level 3 house of 12 beds, so a home takes up to three families.
- **Students.** A university admits its first students on the Monday after a Saturday's results, a few game days after a fill, and a campus should not stand empty until then. After the fill `seedDemoStudents` enrols up to 60 (or a sixth of the places, for London's smaller landmarks) young adults aged 18 to 22 at each university through `Schools.enrolAt`, so no more than the university's staffing allows; each is a second or third year (`due` 0 to 13 of the 15 school days a degree takes), so a few graduate on the first Saturday and the rest week by week. The demo child (`index.ts`, and `check.ts --fill`) calls it right after `fillDemo` (60 at the showcase campus, 149 in London's four).
- **Staffing.** Teachers are whoever took the job until E4's skill gate lands, so a school hires about half the graduates it needs and admits only that share of its places (docs/education.md section 13): the showcase primary admits 40 of 120 with 2 of its 6 teachers, and a few of London's schools and King's College find no staff at all in the first game days. The tooltips say so ("teachers 2 of 6").
- **After the fill** (E5): about a fifth of the newcomers who replace leavers come as families when their home has the beds; each morning the university asks for students from outside town, who arrive through a gateway (or, during the fill, move straight in) to the halls first. `check.ts --run` prints both (`families moving in`, `learning`): the showcase after `--fill --run 1` has 80 students from outside in its two halls and 131 at the university.
- **Features** (the registry, below): `school-run` (a child of every school stage lives within reach of a school that takes them), `student-quarter` (halls within 12 tiles of the university), `london-school-run`, and `school-bus` as a todo for E6.

## Keeping it complete

`npm run demo:check` fails when the showcase is missing anything a player can build. These are the rules:

- Every placeable catalogue kind is placed in the showcase. Placeable means it has a tool and is neither a draft nor a growing zone. This covers every kind bigger than 1×1, every size-ladder rung, the bus depot and stop, the stations and the freight yard.
- Every zoning tool has a grown block on the tour. Grown kinds without a tool are exempt, such as merged lots.
- Every surface tool is painted (runway, track). `SURFACE_TOOLS` is typed against `Tool`, so a new surface tool fails the typecheck until it is listed.
- Every line mode runs (bus, rail, metro, ferry, freight). `LINE_MODES` is typed against `TransitMode`, so a new mode fails the typecheck too.
- Every placed kind has a tour stop, and tour ids and placement ids are unique and resolve.
- Each line's stops are placements of the right kind.
- Every feature in the registry is in its demo, with a tour stop. See "The feature registry" below.

The check then seeds every demo through the real planners. It fails on any refusal and on a rail line that does not run, and it seeds each demo twice to compare hashes. It then runs every feature's `seeded` test on what was built. With `--run <days>` it also runs the showcase, or `--demo <id>`, under the seeded random. `--fill` first grows the town with the live demo's fast fill (`fillDemo`, about 75 s for the showcase), so the run starts from the town a visitor finds. The run prints who uses what:

- staff per placement, venue visits and riders per line
- for the schools (docs/education.md): the children under 18 and those enrolled by stage, the citizens with a degree or a postgraduate degree, the university students, the `pupils` and `graduates` counters, each school's pupils against the places its staffing admits, its teachers against the teachers it needs, quality, waiting list and the last results, and the school events (enrolments, graduations, drop-outs, escorts for the under-8s, fetched)
- the planes scheduled by type and the helicopter flights by service
- the bascule's lifts for a barge and how long the level crossing's barriers were down
- gateway arrivals and freight containers
- for the underground: each metro line's trains and headway, the trips planned by metro, the changes between the metro and the other modes (`bus-metro`, `metro-rail`, `metro-metro`), the peak train load and what `Metro.tick` costs a tick. `--no-tube` runs London without its Underground, for the tick cost without the metro.
- for the boats (docs/boats.md): seeding prints each harbour's lanes (purpose, class, gate, length) and any refusal, and the sea gates; the run prints the harbours (staffed, lanes), the voyages by type and by kind over the days run, the passages booked through each bascule's lifts (a tall boat, or only the lift barge), the harbours' totals (`Harbours.totals`: catch landed and sold, port calls, containers in and out, ro-pax passengers, dues and berth fees) and today's figures, each river bus line's boats and headway, the trips planned by river bus with their changes, and what `Ferry.tick` and `Harbours.tick` cost a tick.

```sh
npm run demo:check
npx tsx packages/server/src/demo/check.ts --fill --run 1
```

### The feature registry

Catalogue kinds, surface tools and line modes are checked by kind. Everything else the showcase must show is an entry in `SHOWCASE_FEATURES` in `shared/src/demo/showcase.ts`: bridge styles, a level crossing, plane types, helicopter services and merged lots. Each entry (`ShowcaseFeature`) has these fields:

| Field | What |
| --- | --- |
| `id`, `caption` | its name and what the check's message calls it |
| `demo`, `rule` | the demo that must show it, the showcase unless `rule` says why it lives elsewhere |
| `tour` | the stop that shows it, which must be on that demo's tour |
| `scenario` | a test over the demo's sections, run by `showcaseProblems` (pure) |
| `seeded` | a test over the seeded demo (`SeededDemo`: kinds built, every tile, aux and under byte written, the helipads, the operational airports, the bus lines' turns, the saved lines' stops), run by demo:check |
| `todo` | not enforced yet: why, and what turns it on |

Some entries are typed against the union they come from, the way `SURFACE_TOOLS` and `LINE_MODES` are. A new bridge style, junction tool, plane type (`PlaneType`) or helicopter service (`PadKind`) therefore fails the typecheck until it has an entry. Merged lots are read from the catalogue (`GROW_FORMS`), so a new form is enforced as soon as it compiles.

| Feature | Test | Tour stop |
| --- | --- | --- |
| every bridge style (arch, girder, suspension, bascule) | a bridge of that style in the scenario and its deck in the world; every bascule span lifts for a barge within `FEATURE_DAYS` (7) | `bridge-<style>` |
| river | water painted, and water in the world | `river` |
| level crossing | a road tile on track in the world | `level-crossing` |
| roundabout, flyover | the junction in the scenario | `roundabout`, `flyover` |
| motorway gateway | a motorway connection placed and built | `motorway` |
| every plane type | scheduled at a showcase airport within 7 days (`timetable`); the jumbo needs the 20-tile runway | `runway` |
| every helicopter service | a pad of that service, and a flight of it within 7 days (`heliTimetable`) | `helipads`, `off-hq` |
| royal flight | the same, in **London**. Rule: only Buckingham Palace has a royal pad, and landmarks stand in their own city's demo | London's `buckingham-palace` |
| every merged lot | the non-deep ones placed and built; the deep plots built (they settle into block middles by themselves) | the kind's own stop, `block-deep` |
| communal garden | built | `block-garden` |
| bus turnaround | a saved bus line whose buses turn round at a dead end (`BusService.plan(line).turns` has a kind 0) | `line-bus-3` |
| metro line with an interchange | a metro line calls within the change walk (`TRANSIT.transferWalk`, 4 tiles) of a stop of a bus or rail line, in the scenario and among the saved lines | `line-metro-1` |
| mobile-job bases (docs/mobile-jobs.md): a cab office, a takeaway, a waste and recycling depot, a parcel depot | the lot at the tour spot's door holds that role (shared/src/fleet.ts `isCabOffice`, `isFoodVenue`, `isWasteDepot`, `isCourierDepot`, tile hashes): (5, 0), (6, 0), (16, 0), (14, 0) downtown | `cab-office`, `takeaway`, `waste-depot`, `parcel-depot` |
| world map | the scenario has a `world-map` spot with `view: 'map'` and an estate (`DemoSection.estates`: the South railway and Riverside lands, combined at seeding by `planCombine`); the seeded world has an estate of two or more parcels (`SeededDemo.parcels`). docs/world-map.md | `world-map` |
| metro crossover | in **London**: an under byte with all four sides (one line's tunnel straight across another's). Rule: the showcase runs one underground line; lines cross in London | London's `tube-crossover` |
| every harbour kind finds its lanes (`harbour-<role>`) | a harbour of that kind in the seeded showcase with no refusal and, but for a pier, lanes (`SeededDemo.harbours`: the server's `harbours` list, taken as staffed) | the kind's placement: `jetty`, `marina`, `fishing-harbour`, `ferry-pier`, `cargo-port` |
| every boat type (`boat-<type>`) | scheduled at a showcase harbour within 7 days (`boatTimetable` over the seeded harbours); the river bus by a saved ferry line. Typed as a `Record<BoatType, …>`. The police launch and fire boat are todos until a station by the water bases them | the harbour that bases or receives it, `line-ferry-1`, or `bridge-bascule` for the sailing barge |
| a tall boat through a lift (`boat-lift`) | a voyage that is not the bascule's own lift barge booked into a lift within 7 days (`boatLifts`) | `bridge-bascule` |
| a sea gate (`sea-gate`) | the scenario declares one, and a seeded harbour's lane ends at a gate | `sea-gate` |
| children within reach of every school stage (`school-run`) | a child of nursery, primary, secondary and sixth-form age lives within the catchment of a showcase school that takes that stage (`SeededDemo.schools` and `children`, from the seeded families) | `primary-school` |
| halls beside the university (`student-quarter`) | a halls of residence within 12 tiles of the university | `halls` |
| school buses (`school-bus`) | todo: E6 | `secondary-school` |
| London's school run (`london-school-run`) | in **London**: a child of primary and of secondary age lives within reach of a London school of that stage. Rule: London has its own schools and the four universities are landmarks | London's `primary-islington` |
| a river bus interchange (`ferry-interchange`) | a ferry line calls within the change walk of a bus, rail or metro stop, in the scenario and among the saved lines | `line-ferry-1` |
| St Katharine's tall boats through Tower Bridge (`tower-bridge-lift`) | in **London**: a tall boat booked into a lift within 7 days. Rule: Tower Bridge and St Katharine Docks are London's | London's `st-katharine` |

### Adding a feature to the showcase

Suppose the game gains canal locks, which are neither a catalogue kind nor a drag.

1. Add an entry to `SHOWCASE_FEATURES`, with a `seeded` test that finds a lock in the seeded world (`d.scan` over tiles and aux bytes) and `tour: 'canal-lock'`. If the feature comes from a union (a style, a type, a service), type its entries as a `Record` over that union.
2. Run `npm run demo:check`. It fails twice: the feature is not in the seeded showcase, and its tour stop is not on the tour.
3. Put one in a section, through the planner its tool uses. If the seeder has no field for it yet, add one to `DemoSection` and lay it in `seed.ts` as the tool does.
4. Give it a tour stop. A `spot` with a `SPOT_CAPTIONS` entry works for anything that is neither a kind nor a drag. Then add its id to `TOUR`.
5. Run `npm run demo:check` until it passes. Then run `npx tsx packages/server/src/demo/check.ts --fill --run 1` and confirm the feature is used. Add a line to the run's report in `check.ts` if nothing shows its use yet.
6. Reset the running demo, as for a new kind below.

A feature that cannot be in the showcase gets `demo` and a `rule` that says why. A feature that cannot be met yet gets a `todo`, which keeps it listed but switches it off.

Drafts are exempt on purpose. They can only be placed on a dev server, and the demos also run in production.

## The tour

The tour panel opens by itself in a demo, at the bottom right. The **tour** chip in the top bar reopens it after it is closed. The panel has these controls:

- **Next** and **Previous** fly the camera to the next or previous stop. A flight is smooth, about 1.7 s by the wall clock, and lifts on long hops.
- **Autoplay** advances every 14 seconds.
- The drop-down jumps to any stop.
- **Reset demo** asks for confirmation, then resets the town for everyone in it.

Each stop's card shows:

- **What it does.** The catalogue kind's `blurb`.
- **How to build it.** The kind's `howTo`.
- **Facts.** The tool and key, the footprint, which way the door faces here, the placement tile, the technology with its track and tier, the cost and upkeep, and the jobs.
- **The live tooltip.** The server's ordinary `inspect` answer for the object, refreshed every 1.5 s and rendered by `ui.buildingHtml`, exactly what hovering it shows. Line stops add the line's live status, vehicles in service and riders.

Captions come from the catalogue, so they stay in step with the game. Runways, track, junctions, bridges, lines and spots are not catalogue kinds, so their captions are in `showcase.ts` (`SURFACE_CAPTIONS`, `BRIDGE_CAPTION` with `STYLE_NOTES`, `LINE_CAPTIONS`, `SPOT_CAPTIONS`). Merged lots have no tool text in the catalogue, so their stops are captioned from their form (`mergedText`).

On the map, a structure's footprint outline and marks are drawn (`FootprintOverlay`): door, platform, apron, dock and gates. A block or a runway strip gets a yellow outline, a line's extent an outline in the line's colour, a track a blue one. A track gets a mark on every tile it lays. A line gets a square at each stop and its ribbon, the lap its vehicles run, drawn from the `lines` message. While the panel is open, every stop near the view has a floating label, nearest first and never overlapping. Clicking a label jumps to that stop.

**A stop at its own hour.** A placement may carry `hour` (and `aside`, how far round from its front the camera stands):
the client pins the light at that hour while the stop is up and gives the player's light back at the next stop without
one, and the card's facts say "Shown at 21:30, after dark". The Piccadilly Lights (London, 21:30, from the front-left
where the curve faces) and the showcase's big screens corner (21:00) use it.

`window.msc.tour` exposes `go(i)`, `stops`, `current` and `flying` for scripted checks.

## Adding an object to the showcase

Suppose the catalogue gains a 3×3 ice rink, kind `ice-rink`, in a new rung of the sports ladder.

1. Run `npm run demo:check`. It fails: `ice-rink (a rung of the sports ladder (tier 5)) is not placed in the showcase`.
2. Pick a free job block in the section it belongs to. Leisure lives in district A3 (`block(2, 0, …)`). Add the block to the section's `clear` list.
3. Add a placement to the section's `placements`: `{ kind: 'ice-rink', door: [x, y], rot: 0 }`. The door is the tile a player would click. Its outward neighbour must be a road (south for `rot: 0`). The rest of the footprint must lie in the cleared block.
4. Add `'ice-rink'` to `TOUR` next to its ladder.
5. Run `npm run demo:check` again. A refusal names the planner's reason, such as "The door must face a road". Move the door until the check passes.
6. Run `npx tsx packages/server/src/demo/check.ts --run 2` and check that the rink has staff and visitors.
7. Give the kind a `blurb` and `howTo` if it has none: the tour's caption is made from them.
8. Reset the running demo (`POST /api/demos/showcase/reset`) or delete `data/demos/demo-showcase*.json`. The next start seeds the new town.

A new surface tool or line mode works the same way: add a `runways`, `tracks` or `lines` entry to a section and its id to `TOUR`. A new zone kind with a zoning tool needs a `blocks` entry in Downtown. A new merged lot (a growable kind bigger than 1×1) needs a placement with a `level` in the riverside quarter, on lots of its zone.

## What a run shows

The showcase after `--run 2.3`, matching what the live tooltips showed in the running demo. The run had 10,693 citizens and 10,681 jobs: everyone who can work does.

| What | Numbers |
| --- | --- |
| staff | every placed building full: 90/90 at the teaching hospital, 40/40 at the stadium, 28/28 ground crew, 30/30 at the bus depot, 10/10 at each freight yard |
| venue visits yesterday | arena 117, botanical garden 118, opera house 94, stadium 92, museum 76, lakeside park 69, multiplex 56; a few for the smallest rungs |
| planes | the airport is operational, a flight an hour on its 20-tile runway, 7 to 8 flights a day; every type flies within the first week (the jumbo on day 2) |
| buses | line 1 about 30 riders a day, line 2 about 20, with some changing between them |
| trains | passenger line 1 runs one train (headway about 113 min) with 3 to 11 riders a day; freight line 9 runs one train |
| containers | 144 delivered by train in 2.3 days, and about 160 trucked into the west yard on a day |

The riverside, measured with `--fill --run 1` (2026-10-18, machine shared with other agents): 15,700 citizens and 16,842 jobs. Every merged lot is staffed or full but the heavy plant (39 of 420) and the factory complex (113 of 210). The bascule lifts twice on day 3. The level crossing's barriers are down 388 ticks of the day's 2,400. 47 helipads give 26 air ambulance, 4 police and 41 executive flights over days 2 and 3.

The harbour, measured with `--fill --run 1` (2026-10-18): every harbour fully staffed (the homes behind the quay road
work at the docks and the fish quay). Over days 2 and 3, 6 fishing trips landed 208 boxes, 15 port calls landed 286
containers and took 213, 673 ro-ro passengers came ashore, and the marina's 10 cruises and the bascule's lift barges
sailed; river bus line 1 ran 3 boats but carried nobody. London's Thames over the same run: 13 calls at Dagenham Docks,
183 boxes landed at Thamesmead, a St Katharine yacht out and back through Tower Bridge's lifts on day 3, and RB1's 5
boats with 12 trips planned, 6 changing to the Tube. docs/boats.md 8.1 has the rest.

The schools, measured with `--fill --run 1` (2026-10-18): the showcase fills to 16,407 citizens in 90 s with 301 children and young people under 18, 255 of them enrolled by the end of the day (nursery 4, primary 60, secondary 101, sixth form 37, degree 53, the last seeded) and 262 for the `pupils` counter; London fills to 30,804 in 223 s with 797 under 18, 438 enrolled and 149 university students in its four landmarks. Over a school week (`--run 5`) the showcase had 35 graduations, 19 fails, 3 nursery years and 3 school leavers going on to a degree. docs/education.md section 14 has the table.

Rail riders are few. Everyone takes the nearest job, so nobody commutes 30 tiles. The riders are the occasional night out at the stadium from the homes by the halt.

## UAT

A stable copy of the game runs apart from dev so dev reloads never restart it: `scripts/uat.sh promote [ref]` exports a
commit (default HEAD, so uncommitted work never ships) to `~/code/msimcity-uat`, checks it there (typecheck,
buildings:check; a failure leaves the running UAT alone), builds the client and restarts UAT on
**http://<lan-ip>:9080/** (or http://Xetatron.local:9080/; `scripts/uat.sh status` prints the current address) (game and client on one port; its test cities on 9100+n; its own world in
`~/code/msimcity-uat/data`, first seeded from dev's). `scripts/uat.sh status | restart | stop | log`. UAT runs with
`NODE_ENV=uat`, so `?dev` tools and the test-city picker work there too. Promote when cards land in Playtest.
