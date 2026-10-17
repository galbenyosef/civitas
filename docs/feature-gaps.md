# Feature gaps: Civitas vs the city-builder field

Researched 2026-10-16. Code read: `README.md`, `docs/load-tests.md`, `shared/src/{tile,tech,constants,occupations}.ts`, `server/src/sim/simulation.ts`.
Reference-game claims cite the numbered sources at the end. A dagger (†) marks a claim from general knowledge of the game that I could not confirm on a fetched page (several official wikis returned 403 or did not resolve). Spot-check † cells before quoting them.

## What Civitas has now (accurate baseline)

- **World:** unbounded 32×32 chunks, terrain from `(seed,x,y)`, parcels as rectangles (max 48 edge) with an owner and a tax rate. No parcel sale or subdivision yet.
- **Tile:** one uint16. Terrain 2 bits (3 of 4 values used), road 1 bit, kind 4 bits (10 of 16 used), level 3 bits (0–3 used), then construction flag, priority and progress. Every bit is assigned, but kind, level and terrain have spare codes. Building data is `{x,y,zone,level,occupants}`, one per tile.
- **Zones and kinds:** residential, commercial, industrial, office (growable, levels 1–3), plus police, fire, hospital, builders' yard, parking lot (placed by the player).
- **Demand:** jobs minus population, no weighting by type. Growth opens a construction site that builders must finish. Buildings without road access decay.
- **Citizens:** free agents. They live in one building, take the nearest vacancy anywhere on the road network, follow shifts per occupation, make cafe/bar outings, and quit under high income tax.
- **Movement:** walk and drive legs, parking (surface, underground, lots, kerb), lane-accurate traffic, signals, A\* with congestion cost.
- **Services:** police, fire and hospital give a 14-tile coverage bonus to tax tolerance and growth. With the Patrols tech they send vehicles to random buildings. No incidents exist.
- **Money:** wages, income tax to the work parcel, property tax to the home parcel, sales tax to the venue parcel, upkeep, builder fees between players. No loans, budgets or land value.
- **Tech:** 12 nodes in 4 tracks, earned by counters from your own city and then bought.
- **Roads:** one bit. One lane per direction, one speed, 16 auto-tiled sprites. Water blocks both buildings and roads. No one-way, no hierarchy, no bridges.
- **Performance:** the 6×6 district test (34k citizens) averages 12.7 ms per tick against a 50 ms budget, so there is headroom for new systems.

## 1. Feature comparison

Gap: S/M/L. Value to Civitas players: L/M/H. Cost under our architecture: S (days), M (about a week), L (multi-week), XL (re-architecture).
Games: SC4 = SimCity 4, SC13 = SimCity (2013), CS1/CS2 = Cities: Skylines 1/2, TT = TheoTown, WR = Workers & Resources.

| Feature | What the references do | Civitas now | Gap | Value | Cost | Tier |
| --- | --- | --- | --- | --- | --- | --- |
| Zoning and RCI demand | SC4 zones R/C/I in densities plus agriculture [1]. CS2 adds office, low-rent and mixed-use zones; household spawning depends on happiness, homelessness, tax and open jobs [6][7]. | R/C/I/office, one scalar demand (jobs vs people). | M | H | M | soon |
| Land value | SC4, CS1 and CS2 use it to drive building level and rent. CS2 reworked it with Economy 2.0 [7]. † for mechanics. | None. | L | H | M (derived per-chunk byte field, no tile bits; ship it like congestion bytes) | **next** |
| Pollution and noise | SC4 power plants vary in pollution [1]. CS1 has a pollution concept page [11]; tree-lined avenues reduce noise [3]. | None. | L | M | M, once a field layer exists | soon |
| Utilities: power, water, sewage, waste | SC4 and CS1 require power, water, sewage [1][3]. SC4 neighbour deals sell water, power, garbage between cities [1]. TT links power and water between tiles [8]. | None. | L | M | M as coverage buildings with contracts between owners; XL as pipe networks | soon (coverage), not for this game (pipes) |
| Education | CS1 has education info views [11]. CS2 teens attend high school, schools matter for spawn [7]. WR advises building a regular school [12]. | None. Citizens have no skills. | L | M | M (needs a citizen attribute) | later |
| Health | WR has a Health page [9]. SC4 and TT have hospitals [1][8]. | Hospital is a workplace and coverage tick; nobody gets sick. | M | M | S–M with incidents | soon |
| Crime and fire as events | TT: missing services "may result in disasters such as riots, pandemics and fires" [8]. SC4/CS1 run fire and crime as incidents †. | Stations exist and send vehicles to random buildings. No incidents. | M | H (visible, uses existing vehicles) | M | **next** |
| Public transport (bus, tram, metro, rail) | CS1: buses, taxis, trams, trains, ferries, metro [3]. SC4 adds subway and bus [1]. CS2 unlocks transit through a tech tree [6]. | None. Legs are walk or drive only. | L | H | M for buses (new leg type, stops). L–XL for tram, metro, rail (own network, multi-tile stations) | soon (bus), later (rail, tied to gateways) |
| Road hierarchy | CS1: two, four, six-lane roads, avenues, highways with no roadside zoning; one-way [5]. | One road type. | L | H | M (needs a road side layer, per-class speed and lanes, traffic code changes) | **next** |
| Bridges and tunnels | CS1: roads above a height become bridges; tunnels cost more [5]. | Water blocks roads, so lakes split the map. | L | H | S–M for bridges (road bit on a water tile already encodes). L for tunnels (no elevation). | **next** (bridges), not for this game (tunnels) |
| Terrain and elevation | SC4 limits terraforming after founding [1]. CS1 has free-form terrain and a map editor [3]. TT has terrain tools [8]. | Noise heightfield used only to pick water, sand, grass. All tiles flat. | L | M | XL for real elevation (breaks one-height tiles and BatchedMesh assumptions). S for cosmetic relief. | later (cosmetic only) |
| Districts and policies | CS1: districts restrict development, set tax per class, free transit [3]. | Parcels carry a tax rate only. Parcel is the natural district. | M | M | S–M | later |
| Budgets and loans | CS1: service budgets 50–150%, three bank loans [4]. CS2: upkeep up, subsidies removed [7]. | Single treasury, fixed upkeep. | M | M | S | soon |
| Disasters | CS1 Natural Disasters DLC [3]. SC4 and TT trigger tornadoes, earthquakes [1][8]. | None. | L | L in a shared persistent world | M | not for this game as global events |
| Ordinances | SC4 still carries SC3000 ordinances in code, unused [13]. CS1 edicts unlock as the city grows [3]. | Tax rate per parcel. | M | M | S on top of districts | later |
| Citizen needs and happiness | WR: demands for food, shopping, culture, sport and religion; happiness, loyalty and productivity follow [9]. CS2 weighs route cost and comfort [6]. | Implicit: tax tolerance plus service coverage. Venues exist. | L | H | M (score from commute time, tax, services, leisure) | soon |
| Housing types and wealth | SC4 wealth levels and decay/gentrification [1]. TT levels by "Theons" [8]. CS2 wealth drives density demand [7]. | Level only. All households alike. | M | M | M, after catalogue and land value | soon |
| Multi-tile buildings | Standard in all references †. | One building per tile. | L | H | L (anchor and part encoding, site, parking, render changes) | **next** |
| Growth stages | CS1 and SC4 level up from local conditions [3]. | Levels 1–3, visible construction with cranes. Strong. | S | L | S | have |
| Day/night schedules | CS1 After Dark adds a day/night cycle [3]. SC13 simulates workers and shoppers [2]. | Per-person shifts, rosters, window lights. Best in class. | none | n/a | n/a | have |
| Regional and inter-city play | SC4 regions with neighbour deals [1]. SC13 regions, Great Works [2]. CS2 imports and exports to virtual cities [6]. | One shared world, no edges. Visitors spawn at four invented entries. | M | H | L (gateways) | **next** (gateways) |
| Multiplayer parcel trading | SC13 cities share or sell services [2]. TT online regions let players collaborate on tiles [8]. None sell land. | Buy unclaimed land. Roadmap says sell and subdivide. | L | H | S–M | **next** |
| Mods and custom assets | SC4 BAT and Lot Editor [1]. CS1 Steam Workshop, 200,000+ items [3]. CS2 Paradox Mods [6][10]. TT plugins [8]. | Hard-coded kinds in switch statements. | M | M | M, falls out of the data-driven catalogue | later |
| Construction logistics | WR: build with delivered resources or pay currency for fast auto-build [9]. | Builders travel to sites and work them down. Visible. | none | n/a | n/a | have |

## 2. What Civitas does that the references do not

- **Free agents across parcels.** SC13 citizens take the first home and job they find and critics called that unrealistic [2]. Civitas citizens do the same but pay tax to whichever parcel owner hosts the work, home or shop, so geography becomes player politics.
- **Visible per-person routing.** Every walker and driver is a real routed entity with a name, shift, destination and a follow camera. CS2 simulates citizens too [6], but none of the references let a player click one and watch the day.
- **Collision-free lane traffic.** Lane-accurate positions, a precomputed conflict table, pedestrians waiting at the kerb and cars stopping for crossings.
- **Parking as a mechanic.** Surface, underground (tech-gated), privately owned lots with fees, and kerb parking that costs a lane slot. No reference models it this concretely.
- **Earned tech.** Tiers unlock by what your own city does, then cost money. SC4/CS1 gate by population milestones [3]; CS2 spends development points [6].
- **Owned builders.** Construction crews are citizens with shifts. Owners pay each other for work and can pause sites.
- **One unbounded server-authoritative world** with per-person organic variation (jitter, lamps, windows) as a standing rule.

## 3. Proposed cards, in order

Dependencies first. Planned items (catalogue, leisure, gateways, multi-tile, road subtypes and bridges) are marked P.

1. **Modular building catalogue (P), opus.** Move kind-specific constants (`capacity`, `wageFor`, `CIVIC_COST`, parking tables, occupations, tech unlocks) into one data table keyed by a building type id. Keep `Zone` as the category. Store the type in a per-chunk side array, or in spare kind codes with a server map. Add per-type tags for emissions, attraction, venue, coverage radius. Everything below reads this table.
2. **Road side layer, hierarchy and bridges (P), opus.** Add a per-chunk byte for road class and bridge flag, so the tile stays untouched. Classes get lane count, speed and zoning rule. Allow road-on-water as a bridge, tech-gated. Update traffic lanes, autotile atlas, and pathfinding costs. Add one-way last.
3. **Parcel sale and subdivision, sonnet.** Owners list a parcel or a rectangle of it at a price. Buyers pay, parcel ownership and tax stream transfer. Start with flat prices, link to land value when card 5 lands. Needs the per-chunk parcel array only.
4. **Leisure places (P), sonnet.** Parks, cinemas, gyms as catalogue entries using the venue path already built for cafes. Citizens pick outings by time of day. Revenue goes to the parcel owner. This is the first citizen need beyond work.
5. **Derived field layer and land value v1, opus.** Server computes per-chunk byte fields from catalogue tags (service coverage, roads, industry) on dirty chunks only and ships them like the congestion bytes. Land value feeds property tax, growth level and a client overlay. Pollution and noise reuse the layer.
6. **Incidents: fire, crime, medical, sonnet to opus.** Random, density-weighted incidents at buildings, with a visible burning or alarm state. Dispatch the existing priority vehicles to the real target. Coverage stops being a flat bonus and starts mattering. Keep damage recoverable and owner-opt-out of grief.
7. **Multi-tile footprints (P), opus.** Catalogue entries get a w×h footprint. Anchor tile carries the building, other tiles carry a part flag, with parking, sites, rendering and zone growth updated. Required by stations, ports, airports, campuses.
8. **Gateways (P), opus.** Replace the four invented entry tiles. Phase one is a motorway gateway at the edge of the built area with real inbound commuters, shoppers and freight and real outbound residents. Later phases add rail station, port and airport using multi-tile footprints. Gateways give regional play without sharding.
9. **Citizen happiness and housing wealth, opus.** Derive a score from commute time, tax, coverage, leisure access, land value and pollution. Split housing into wealth bands by level and land value. Show it on the hover panel. Unhappy citizens leave, happy ones raise growth.
10. **Utilities as coverage buildings, opus.** Power and water plants with a radius, a capacity and a price per unit. Buildings outside coverage cannot grow, and owners sell service across parcel borders. No pipes, no tile bits. This is the SC4 neighbour deal made live.
11. **Bus lines, opus.** New transit leg (walk, wait, ride, walk), stops as catalogue entries, buses in traffic lanes, fares to the parcel owner. Citizens without cars become the market. Rail and metro come after gateways.
12. **Budgets and loans, sonnet.** Per-service funding slider scaling coverage and upkeep, plus a bank loan with interest. Keeps early players from stalling, adds a money sink later.
13. **Parcel policies, sonnet.** Per-parcel ordinances such as no heavy trucks, noise limit, parking fee cap, enabled by tech. Parcels act as districts.
14. **Education and skilled jobs, opus.** Schools as workplaces, a citizen education attribute, office jobs requiring it. Ties zoning to services and gives schools a role beyond a coverage bonus.
15. **Content packs, sonnet.** Load extra catalogue entries and models from JSON, with validation. Only worth doing after card 1 stabilises.

## Top picks and what to skip

Do first: 1, 2, 3, 5, 6. Gateways (8) wait for 7. Skip as global events: disasters. Skip pipes, tunnels and real elevation: they fight the uint16 tile and BatchedMesh model for little gameplay.

## Sources

1. SimCity 4, Wikipedia: https://en.wikipedia.org/wiki/SimCity_4
2. SimCity (2013), Wikipedia: https://en.wikipedia.org/wiki/SimCity_(2013_video_game)
3. Cities: Skylines, Wikipedia: https://en.wikipedia.org/wiki/Cities:_Skylines
4. Cities: Skylines wiki, Economy: https://skylines.paradoxwikis.com/Economy
5. Cities: Skylines wiki, Roads: https://skylines.paradoxwikis.com/Roads
6. Cities: Skylines II, Wikipedia: https://en.wikipedia.org/wiki/Cities:_Skylines_II
7. Paradox, Dev Diary Economy part one (CS2): https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one
8. TheoTown, Wikipedia: https://en.wikipedia.org/wiki/TheoTown
9. Workers & Resources wiki, Citizens and Health (read via search excerpts, page returned 403): https://wiki.hoodedhorse.com/Workers_Resources_Soviet_Republic/Citizens
10. Paradox forum, Behind the Scenes: Modding (CS2): https://admin-forum.paradoxplaza.com/forum/developer-diary/behind-the-scenes-1-modding.1602374/page-2
11. Cities: Skylines wiki index: https://skylines.paradoxwikis.com/Cities:_Skylines_Wiki
12. Steam discussion, W&R schooling advice (player opinion): https://steamcommunity.com/app/784150/discussions/0/3812911294779981025
13. The Cutting Room Floor, SimCity 4 (unused ordinances): https://www.tcrf.net/SimCity_4
