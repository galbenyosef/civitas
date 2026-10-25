# Sound

The city is heard as well as seen. Everything lives in `packages/client/src/audio/` and is client only: nothing here touches the simulation or the protocol. Checks: `npx tsx packages/client/scripts/audio-check.ts`.

## The engine (v1)

- `engine.ts`: one `AudioContext`, made on the first pointer, key or touch event and never before (browsers refuse it). Three buses (ambience, vehicles, ui) into a master gain and a limiter. Volume (squared, so the slider feels even) and mute are kept in `localStorage` (`msimcity.audio`). A voice budget of 24 (`take`/`give`); one-shots leave the last 4 for beds and the ridden vehicle.
- `manifest.ts`: every voice by id, with its bus, whether it is a bed or an event, what it is made of, what drives it and the numbers it is synthesised from. Tuning a voice is editing a row.
- `voices.ts`: the synthesised voices (oscillators and shaped noise), the recordings playing in their place, `fire` for events, `ringBell`, `makeBed`, `makeRide`.
- `ambience.ts`: every 250 ms (never per frame) reads the tiles round the camera, the cars and walkers drawn, the hour and the zoom, and glides each bed to its target level and tone; draws the events on Poisson clocks.
- `fpv.ts`: the ridden vehicle's sound (speed from position) and the doors, stop bell and rail joints; the ambience drops 6 dB under it.
- `controls.ts`: M mutes (Shift+M is the perf readout, Shift+S the audio readout), the sound switch and slider in the help line, the top-bar chip, the first-time note.
- `readout.ts`: the audio readout, below.

Organic rule: nothing plays the same way twice. A bed starts at its own point at its own rate (±3%); an event varies its pitch (±5%), gain (±10%), pan and, when it has several, which take it plays.

## Recordings (v2)

Every voice with a recipe also has a real recording, and a second pass of voices has only a recording. All are **Creative Commons 0** clips from [Freesound.org](https://freesound.org). `src/audio/CREDITS.md` lists every clip (voice, Freesound id and link, title, author, licence, length, the query that found it, its score, what was done to it). CC0 asks for no credit; it is given as good manners, and the Showcase Sound stop says where the sound comes from.

Which voices are recorded, and which are not:

| | |
|---|---|
| Beds | traffic, wind, crowd, industry, water; rain (light, heavy), market, pub, playground, stadium, fountain |
| Rides (first person) | car, truck, bus, train, tube, boat, plane, helicopter |
| Events | bird, owl, bell, deep bell, horn, crossing beep; door hiss, bus stop bell, door chime, rail joint |
| Second pass | gust, thunder, footsteps, police siren, fire engine siren, seagulls, pigeons, dog, bell peal, bicycle bell, bin lorry, station chime, helicopter and plane overhead, boat horn, fireworks, hammer, drill, lawnmower |
| Still synthesised | the four interface clicks (pick, place, refuse, undo): short and tonal, and a synthesised tick is the right sound for them |

What drives the second pass is in `manifest.ts` (the `driven` text of each row) and `ambience.ts` (`places`, and the `mixFor` windows). Two have no source in the game yet and wait on a hook: rain and thunder follow `Ambience.setWeather(rain)` (there is no weather system); a siren is a rare call from a police or fire station in the view until a response vehicle can report itself. Fireworks follow the fireworks system: `render/fireworks.ts` calls `onShell` for every shell and `Audio.firework` times the bang by distance.

### How a recording is played

1. The context is made on the first gesture; **no recording is fetched at start**.
2. The first time a voice is wanted (`engine.sample(id)`) its takes are fetched and decoded in the background; `decodeAudioData` runs off the main thread, so the 250 ms tick never stalls on a decode.
3. Until the buffer is there a bed or ride plays its synthesis (a recording-only voice stays silent), and **cross-fades to the recording over about two seconds** when it arrives; an event plays its synthesis that once. A 404 or an undecodable file leaves the synthesis for good (a recording-only voice stays silent) and is not asked for again.
4. Beds loop from a random point at a rate within ±3%; the files are cut so the tail is cross-faded into the head (below). Events pick one of their takes at random and vary pitch, gain and pan.
5. Optional beds (market, pub, playground, stadium, fountain, rain) start when their level is wanted and stop after eight quiet seconds, freeing the voice.

### Where the files live and how they are served

`packages/client/src/audio/files/<voice>[-<n>].opus`, committed. `publicDir` is off in the normal Vite build, so a `public/` folder would not be served; instead `urls.ts` globs the folder with Vite's `?url` and the engine asks it for each file's URL:

| Build | What serves the files |
|---|---|
| dev (Vite) | the dev server, from `src/audio/files/` |
| online build, UAT and the Docker image | `vite build` emits them as hashed files under `dist/assets/`, and the game server serves `dist/` (`.opus` has its MIME type in `server/src/index.ts`) |
| offline build (`build:local`) | emitted into `dist-local/assets/`. The service worker does **not** precache them (that would add up to 8 MB to the install); its fetch handler caches each the first time it is played, so a clip heard once works offline afterwards, and one not yet heard falls back to synthesis (or silence) offline |

Files under 4 KB (a dog bark, a rail clack) are inlined by Vite as `data:` URLs in the bundle; `fetch` handles them the same way.

### Budget

8 MB for the whole set, 400 KB for any file (audio-check enforces both). Beds, rides and loops are mono 48 kHz Opus at 48 kbps, 14 to 18 s long; events are 0.3 to 14 s. The set is about 5.4 MB (3.4 MB before the tour cues). If it grows: drop `--kbps 32` on the build, or shorten a bed.

### Re-running the fetch, and swapping a clip

Everything is reproducible from `scripts/audio-voices.ts` (what to search for, per voice) and `scripts/audio-picks.json` (hand picks that beat the score).

```
source ~/.config/civitas/freesound.env        # FREESOUND_API_KEY; never printed, never committed
DL=/some/scratch/folder                        # the previews are untrusted downloads: keep them outside the repo
npx tsx packages/client/scripts/freesound-fetch.ts --out $DL [--only id,id] [--dry]
npx tsx packages/client/scripts/audio-build.ts --dl $DL [--only id,id] [--kbps 48]
npx tsx packages/client/scripts/audio-check.ts
```

`freesound-fetch.ts` searches Freesound with `license:"Creative Commons 0"` and a duration range (the key goes in an `Authorization` header, never in a URL or a file; calls are paced under 60 a minute and every response is cached as JSON under `$DL/search/`), scores each hit (rating, downloads, length fit, sample rate, a must-word in the name or tags, penalties for speech, music, processing and loops where a loop is unwanted), downloads the top takes' high-quality Ogg previews (the originals need OAuth2 and are not used), and writes `$DL/candidates.json` and `candidates.md` (voice, chosen id, title, author, length, rating, score, the margin over the runner-up, why). `audio-build.ts` then, for each pick, trims silence at both ends, cuts a bed to a loop whose tail is cross-faded into its head (1.5 s, equal power), normalises loudness in two linear passes (beds -23 LUFS, rides -21, events -18), fades the ends of an event, makes it mono 48 kHz and encodes Opus; it rewrites `credits.ts` (which `manifest.ts` wires onto the rows), `credits.json` and `CREDITS.md`.

To swap a clip: find a better one on Freesound (CC0 only), put its id in `audio-picks.json` under the voice (the first id is take 1), run the two scripts with `--only <voice>`, run audio-check, listen. To change how loud a voice is, edit its `level` in `audio-voices.ts` and rebuild.

### The loop rule

A bed or ride is a loop: the file is cut so that the last moment flows into the first with no seam. `audio-build.ts` takes the loop from the middle of the source and cross-fades the extra tail into the head, so the join is continuous. When swapping a bed, prefer a steady recording (no one-off event in it: a car horn in a traffic bed repeats every 16 s and is heard at once).

### Listening

Nothing here was judged by ear. The clips picked by score alone with the narrowest margin over the runner-up, and the ones whose titles are the least certain, are listed in the notes for the pull request; start your listening pass there, and swap what is wrong.

## Tour cues

The London tour has its sound: as the camera arrives at a stop, the stop sounds like the place (Big Ben striking at Parliament, gulls and a boat horn on the river, a train arriving under Waterloo, a crowd at Wembley, quiet birds and ravens in a cemetery). Client only: nothing here touches the simulation or the protocol.

### The model

`TourStop.sound?: TourSound` (shared/src/demo/tourSound.ts, set by `demoTour`):

```ts
type TourSound = 'ambience' | {
  cues: { voice: string; at?: number; gain?: number; loop?: boolean }[];
  ambience?: { traffic?, wind?, crowd?, industry?, water?, market?, pub?, playground?, stadium?, fountain?: number }; // 0..1
  duck?: number; // dB the beds dip while a cue sounds, default 4
}
```

- **cues**: `voice` is a manifest voice with a recording. A cue is a one-shot, varied like any event (take, pitch, level, pan). `at` is seconds after the camera has arrived (the 1.7 s flight is allowed for), default 0.3 to 1.2 chosen per play; an explicit `at` also moves a little per play, so no two plays are the same. `gain` multiplies the voice's level (the player adds 1.3: a cue is the point of the stop). `loop: true` runs a bed-class recording until the stop is left (the station hall, the tube hall, the gas burner).
- **ambience**: each bed named is held at that share (0 to 1) of its own ceiling (`HINT_CEIL` in ambience.ts) while the stop is shown, whatever the tiles round the camera say, with a slow breath of its own; a bed not named follows the scene. 0 silences a bed (the underground stops silence the street). It starts as the flight starts, so the beds have glided to the place by the time the camera arrives.
- **duck**: the ambience bus dips by this many dB while a cue sounds (the full amount for a one-shot, half while only a loop runs). The engine keeps ducks in layers (`duckAmbience(db, tc, layer)`), so the tour's dip and a ridden vehicle's 6 dB add and release apart.
- **`'ambience'`**: no cue, the beds alone, on purpose (the Welcome stop, high over the City).

The client's tour (`tour.ts`) hands the stop to `audio.tourStop` on every stop change (Next, Previous, Autoplay, the stop chips, the jump menu); closing the tour, leaving the stop or muting ends the cues, the loops, the bias and the duck. Nothing plays before the first gesture (the engine's own rule) and a muted engine plays nothing. A recording not yet decoded when its moment comes is waited for (up to 6 s, then dropped, so a slow file never sounds over the next stop). The ambience hour follows a pinned light (a stop with `hour`), so the birds and owls match the sky.

`msc.audio.debug = true` (or `?audiodebug` on the URL) prints every cue as it starts, or why it did not (`silent: muted`, `silent: no recording`, `dropped: the recording came too late`); `msc.audio.tour.log` holds the rows. `msc.audio.tour.state` shows the bias and the loops running.

### The table: where to edit

One file: shared/src/demo/tourSound.ts.

- `SCENES`: the sound of a kind of place (`river`, `pier`, `parliament`, `terminus`, `tube-line`, `school`, `cemetery`, `stadium`, ...), each a `{ cues, ambience, duck }`.
- `LONDON_SOUND`: every London stop by id: a scene name, `[scene, { changes }]` (the scene with its cues or beds replaced), a full definition of its own, or `'ambience'`.
- `SHOWCASE_SOUND`: the showcase's few (the Sound stop, the river, the level crossing, the bascule bridge).

To give a stop a cue: add its id to `LONDON_SOUND` with a scene (or write one). To add a voice: a row in `scripts/audio-voices.ts`, the fetch and build (below), a `clip(...)` row in manifest.ts (and the id in `TourVoice` in voices.ts), then name it in a scene. A new London stop with no row fails demo:check; a cue naming no voice, or a voice with no recording, fails audio-check.

### What the audit found (137 London stops)

| Group | Stops | Sounds |
|---|---|---|
| The river | piers, RB1, Pool of London, marinas, the fish quay, Tower Bridge | gulls, a boat passing, a boat horn, rigging, ducks; Tower Bridge adds a warning bell; water held high |
| Westminster | Westminster, Parliament, the Eye | Big Ben's chimes (faint from the Eye), pigeons, traffic |
| West End and roads | Piccadilly (night), Carnaby, Oxford Street, junctions, the Traffic panel, 20 zones, yellows | horns, bus passing, bus doors and bell, bike bells, shop bell, the crowd and the pub at night; the 20 zone and the pedestrian streets hold traffic low |
| The City | the City, Gherkin, Walkie Talkie, Tower of London | bells, pigeons, gusts at height, ravens and a boat for the Tower, office hum |
| Rail | termini, stations, tracks, lines, freight yards | the Euston station-hall loop, the station chime, a train passing, rail joints, dock clank at the yards |
| The Underground | Tube lines, crossover, entrances, Canary Wharf | the tube-hall loop, a train arriving, doors hiss and chime, Mind the Gap; street beds silenced; from the street, a train faintly below |
| Theatres and learning | opera house, theatres, Albert Hall, universities, museums, library | applause, an orchestra tuning, footsteps, bike bells, a school bell at the Natural History Museum |
| Schools | 11 schools | the school bell, the playground bed |
| Parks, gardens, the dead | Hyde Park Corner, Regent's Park, Serpentine, Kew, six cemeteries | birds, ducks, parakeets at Kew with a plane over; crows, a distant bell, an owl and a fox at dusk |
| Sport | Wembley, London Stadium, Copper Box, the O2, Lord's | the stadium bed, a whistle, a crowd roar; applause at Lord's |
| Industry and power | Battersea, Beckton, the grid point, solar, Stratford construction | industry hum, the gas burner loop, hammer and drill, wind and birds at the solar farm |
| Docks | Royal Docks, Dagenham Docks, Thames Gateway | dock machinery, ship horn, gulls, a plane over |
| Emergency | police, hospitals, fire stations | a siren, an ambulance siren, a fire siren, once |
| Broadcast and air | Broadcasting House, Heathrow | a helicopter overhead; a jet taking off |
| Neighbourhoods | areas such as Brixton, Camden, Hackney, Islington | birds, a dog, a bin lorry, the market bed, bike bells |

The weakest matches (listen first): the Tower Bridge bell (a railway-crossing bell), the ambulance siren (pattern not verified as UK), the dock machinery (a marina pile driver and a steel chain), the gas burner (a boiler-room recording), the Mind the Gap announcement (the Circle line one, CC0).

### The new clips

24 voices, 43 files, about 2 MB: `big-ben`, `bus-pass`, `tube-arrive`, `tube-gap`, `train-pass`, `boat-pass`, `port`, `crowd-roar`, `whistle`, `jet-takeoff`, `shop-bell`, `ducks`, `applause`, `orchestra`, `siren-ambulance`, `school-bell`, `crows`, `fox`, `rigging`, `bridge-bell`, `parakeets` (events) and `station-hall`, `tube-hall`, `flare-roar` (loops). They are recording-only voices fetched and built the same way as the rest ("Re-running the fetch" above); the set is now about 5.4 MB of the 8 MB budget, with a credits row for each in `CREDITS.md`.

## Readout

What is sounding now and why, in the style of the Shift+M perf readout (`src/audio/readout.ts`). It only reads: the engine's output is exactly what it was without it (a recording of every call made to a fake AudioContext, for all events, bells, beds, rides and 400 ambience ticks, is identical with and without the change).

- **Open it** with the **audio** chip beside the sound chip in the top bar, or **Shift+S**. The key listens in the capture phase and swallows the press, because plain S pans the camera back; Shift+S never moves the view. It is ignored while typing and on key repeat. The panel sits under the perf readout in the world HUD and wraps at phone width (the voice list and the log scroll). `msc.audioReadout` is the panel (`msc.audioReadout.cost` is what its refreshes cost).
- **Closed it costs nothing**: no timer, no snapshot. The engine keeps only what it already needed plus two small things that are always on: a ring of the last 40 starts and stops (the journal) and, for each one-shot, a row kept until its voice is given back.
- **Open**, it takes a snapshot twice a second (`Audio.state()`) and redraws.

### What it shows

| | |
|---|---|
| Header | the context (running, suspended when the tab is hidden, not started before the first gesture), the volume and the master gain it makes, MUTED, voices in use of the 24, recordings being fetched or decoded, the ducking layers (the tour's, the ridden vehicle's) with their dB, the hour the ambience uses and where it comes from (the clock, or the light a tour stop pinned), the tour stop shown |
| A voice | its class (bed, event, ride, cue, ui), name, bus, level in dB after its bus (a one-shot: at its start), pitch offset in cents, which recording it plays (or `synth`), how long it has been up or how long it has left |
| **Why** | a **bed**: the numbers the 250 ms tick read, the share of its ceiling it aims at, and the tour stop's hold on it if any ("cars near 212, roads 18% of tiles, zoom 24, hour 08:00 → 0.42 of its ceiling"). A **tour cue**: the stop, the cue's index and its moment ("tour stop parliament, cue 1 of 2, at +0.8 s"); a loop says it runs until the stop is left. A **ride**: the vehicle and its speed. An **event**: the trigger ("crossing red at 12,40, 6 tiles off", "horn: 31 cars near", "bus stop bell: pulling away after 4.1 s at a stop", "fireworks shell at x,z", "ui: place", the rate and inputs of the second pass's Poisson clocks) |
| Log | the last 40 starts, stops and skipped starts (a cue silenced by a mute, a hidden tab or a full voice budget, with the reason), newest first, with the time ago; the same row repeated inside two seconds (rail joints, footsteps) is one row with a count. Each tour stop shown is a row. **Copy** puts the header, the voices and the log on the clipboard as text |

Rows are sorted by bus (ambience, vehicles, ui), then the loudest first.

### Where the code is

- `engine.ts`: `journal` (the ring), `log()`, `shots` (one-shots still sounding, filled by `take(seconds, tag)`), `loading` (files in flight), `fileOf()` (which recording a decoded take is), `duckLayers`, `busGain()`.
- `voices.ts`: `Shot.why` and `Shot.cls`; `fire`, `startSample` and `ringBell` tag their voice; a bed's and a ride's `info()` names its recording and pitch.
- The `why` strings: `ambience.ts` (`bedWhy` for beds, `placeWhy` for the second pass's events, and at the call sites of the bird, owl, horn, bell, peal, crossing beep and fireworks), `fpv.ts` (bus stop bell and doors, train doors, rail joints), `tourcue.ts` (cues and loops), `index.ts` (`ui`).
- `index.ts` `Audio.state()` assembles the snapshot from the ambience's beds, the tour's loops, the ride and the engine's one-shots.
- `msc.audio.tour.log` and the `audiodebug` console output are unchanged; the tour's cue rows also go to the journal.

### Cost

Measured in Chrome on the Showcase and London:

| | |
|---|---|
| Closed | no timer and no snapshot; each start costs the engine about 0.2 µs for a journal row and 0.04 µs for a one-shot row |
| Open, one refresh (snapshot, text, DOM) | about 0.01 ms with the page warm, about 0.14 ms when it runs cold after half a second idle (Chrome's timer resolution is 0.1 ms) |
| Open, a second | two refreshes: 0.02 ms warm, about 0.3 ms cold |

The panel reuses a row's elements while its voice sounds and sets only the text that changed, so a refresh does not parse HTML. `msc.audioReadout.cost` has the last refresh and the running mean.
