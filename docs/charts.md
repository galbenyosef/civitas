# Charts: how the city grows

Players see their city's growth in a charts panel. The server samples the key figures once a game hour, keeps them at
three resolutions, saves them with the world and sends them when the panel opens.

## History (server)

`shared/src/history.ts` holds `Rings`, a fixed-size store of N series that is pure (server and client both use it), and the
series lists. `server/src/history.ts` fills it.

- **Cadence.** One sample per game hour (`TICKS_PER_HOUR` = 100 ticks), taken from `game.ts` after `net.flush()` (`step()` and
  `loop()`, so fast-fills and local mode record too). A sample reads counters the simulation already keeps and costs about
  20 microseconds; nothing is allocated per tick. Hours never go backwards; a skipped hour is a gap (shown as a break in the line).
- **Tiers.** hourly x 192 (8 days), daily x 120 (the mean of the day's hours), weekly x 260 (5 years). Each tier is a ring, so
  the whole history is bounded (about 573 points per series, 21 world series and 6 per player, a few tens of KB as JSON).
- **World series** (`WORLD_SERIES`): population, jobs filled and open, buildings, sites under construction, newcomers and
  leavers per hour (gateways), citizens on the move, cars driving and parked, average speed, share held up, transit boardings
  per hour (all modes), tick time (average and p95 over the last minute).
- **Per player** (`PLAYER_SERIES`): treasury, income and spending per day (a rolling 24 hours, worked out from the hourly
  change of the ledger in `World.credit`), and the population, job capacity and filled jobs of the parcels they own.
- **Adding a series.** Append it to `WORLD_SERIES` / `PLAYER_SERIES`, set it in `History.sample`, add a chart in `client/src/charts.ts`.
  Saves match series by key, so old saves load and the new series starts empty.

## Persistence

`Snapshot.history` (optional, `HistoryJSON`): `snapshot.ts` writes it and `worldFromSnapshot` restores it, through `historyOf(world)`
(a WeakMap, so `World` is untouched). No format bump: a save without `history` loads with empty history and starts recording;
an older build ignores the field. Unreadable history is dropped, never fatal. Local mode keeps it in the same snapshot.

## Wire

- `{ t: 'hist', open: true }` (client): the panel opened. The server answers `{ t: 'history', hour, world, mine }` (the rings as
  `RingsDTO`, `mine` being the asking player's) and from then on sends `{ t: 'histSample', hour, w, p }` each game hour
  (the series values in `WORLD_SERIES` / `PLAYER_SERIES` order). The client pushes them through its own `Rings`, so its daily
  and weekly tiers match the server's. After the first opening the feed stays on for the session (it is one small message an hour);
  `{ t: 'hist', open: false }` stops it.
- The client asks again after a reconnect (`welcome`).

## Panel (client)

`client/src/charts.ts`: the **charts** chip beside lines and tech, the **`** (backquote) key (every letter is a tool or camera
key; N is for the underground view), Esc closes. Tabs City, Economy (yours), Traffic and transport; a range switch Day (24 hours,
hourly), Week (7 days, hourly), Month (30 days, daily), All (daily; weekly once the daily record is full). Small-multiple line
charts on canvas: nice axis ticks, game day and hour labels, a crosshair shared by all the charts on the tab with the values in
each chart's header (and a tooltip on the chart under the pointer). Two measures are never on one axis scale: a chart with two
series holds like units (filled and open jobs; income and spending). Touch: a tap or drag on a chart shows the crosshair.

Clicking `pop` in the top bar opens the population chart; the treasury's ledger box links to the treasury and income charts.
Once the history is here, a sparkline of the last game day appears beside the treasury (click to open the chart).

## Checks

`npm run history:check` (`server/src/history-check.ts`): cadence, averaging and gaps, caps after a long run, the JSON round trip
of the rings, the charts messages over a fake client, the save round trip, a save without history, and the cost of a sample.
