# Sound

The city is heard as well as seen. Everything lives in `packages/client/src/audio/` and is client only: nothing here touches the simulation or the protocol. Checks: `npx tsx packages/client/scripts/audio-check.ts`.

## The engine (v1)

- `engine.ts`: one `AudioContext`, made on the first pointer, key or touch event and never before (browsers refuse it). Three buses (ambience, vehicles, ui) into a master gain and a limiter. Volume (squared, so the slider feels even) and mute are kept in `localStorage` (`msimcity.audio`). A voice budget of 24 (`take`/`give`); one-shots leave the last 4 for beds and the ridden vehicle.
- `manifest.ts`: every voice by id, with its bus, whether it is a bed or an event, what it is made of, what drives it and the numbers it is synthesised from. Tuning a voice is editing a row.
- `voices.ts`: the synthesised voices (oscillators and shaped noise), the recordings playing in their place, `fire` for events, `ringBell`, `makeBed`, `makeRide`.
- `ambience.ts`: every 250 ms (never per frame) reads the tiles round the camera, the cars and walkers drawn, the hour and the zoom, and glides each bed to its target level and tone; draws the events on Poisson clocks.
- `fpv.ts`: the ridden vehicle's sound (speed from position) and the doors, stop bell and rail joints; the ambience drops 6 dB under it.
- `controls.ts`: M mutes (Shift+M is the perf readout), the sound switch and slider in the help line, the top-bar chip, the first-time note.

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

8 MB for the whole set, 400 KB for any file (audio-check enforces both). Beds, rides and loops are mono 48 kHz Opus at 48 kbps, 14 to 18 s long; events are 0.3 to 14 s. The set is about 3.4 MB. If it grows: drop `--kbps 32` on the build, or shorten a bed.

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
