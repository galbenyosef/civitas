// Sound: the engine, its controls and its voices against a fake AudioContext (client/src/audio). Run: npx tsx packages/client/scripts/audio-check.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { AudioEngine, AUDIO_KEY, MAX_VOICES, HELD_RESERVE, DEFAULT_VOLUME, clampVolume } from '../src/audio/engine';
import { bindMuteKey } from '../src/audio/controls';
import { VOICES, voiceFile } from '../src/audio/manifest';
import { CLIPS } from '../src/audio/credits';
import { fire, makeBed, makeRide, ringBell, BEDS, type EventId, type RideKind } from '../src/audio/voices';
import { Ambience, mixFor, newMix, newScan, birdRate, owlRate, scanAround, zonesOf, zoneText, worksOf, peopleNear, greenOf, ZONES, ZONE_BED, carKnee, activityAt, HINT_CEIL as CEILS, type AmbSources, type Zn } from '../src/audio/ambience';
import { StreetLife, PassPicker, STREET, passRadius, passKindOf, sirenKindOf, sirenGain, panOf, approach, SIREN_VOICE, type StreetAgent } from '../src/audio/street';
import { VehicleKind, VehicleClass, FleetKind } from '@msimcity/shared';
import { packTile, withConstruction } from '@msimcity/shared';
import { FpvSound, type RideNow } from '../src/audio/fpv';
import { TourCues, DEFAULT_DUCK_DB } from '../src/audio/tourcue';
import { applyHint, HINT_CEIL, bedWhy } from '../src/audio/ambience';
import { rowsOf, rowText, rowHtml, headerText, headerHtml, journalText, journalHtml, stateText, type AudioState, type VoiceRow } from '../src/audio/readout';
import { JOURNAL, toDb } from '../src/audio/engine';
import { bindReadoutKey } from '../src/audio/controls';
import { demoTour, tourSoundProblems, LONDON_SOUND, SCENES, resolveStopSound, type TourSound } from '@msimcity/shared';

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// ---- a fake AudioContext that records what is asked of it -----------------------------------------------------------
let made = 0;
const log: string[] = [];
function fake(path: string, store: Record<string, unknown> = {}): any {
  const kids = new Map<string, any>();
  return new Proxy(function () { /* callable */ }, {
    get(_t, k: string | symbol) {
      if (typeof k === 'symbol' || k === 'then') return undefined;
      if (k in store) return store[k];
      if (!kids.has(k)) kids.set(k, fake(`${path}.${k}`));
      return kids.get(k);
    },
    set(_t, k: string, v) { store[k] = v; log.push(`${path}.${k}=${typeof v === 'number' ? v.toFixed(4) : String(v)}`); return true; },
    apply(_t, _this, args) {
      log.push(`${path}(${args.map((a) => (typeof a === 'number' ? a.toFixed(4) : typeof a)).join(',')})`);
      return fake(`${path}()`);
    },
  });
}
function fakeCtx(): any {
  made++;
  const store: Record<string, unknown> = {
    currentTime: 10, sampleRate: 48000, state: 'suspended',
    resume() { store.state = 'running'; return Promise.resolve(); }, suspend() { store.state = 'suspended'; return Promise.resolve(); },
    createBuffer: (_c: number, n: number, rate: number) => ({ duration: n / rate, length: n, getChannelData: () => new Float32Array(n) }),
    decodeAudioData: async () => ({ duration: 2, length: 96000, getChannelData: () => new Float32Array(10) }),
    destination: fake('dest'),
  };
  return fake('ctx', store);
}
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const handlers = () => {
  const h = new Map<string, ((e: any) => void)[]>();
  return { h, addEventListener: (t: string, f: any) => { (h.get(t) ?? h.set(t, []).get(t)!).push(f); }, removeEventListener: (t: string, f: any) => { h.set(t, (h.get(t) ?? []).filter((x) => x !== f)); },
    emit: (t: string, e: any = {}) => { for (const f of [...(h.get(t) ?? [])]) f(e); } };
};
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

// ---- no context before a gesture; one after -------------------------------------------------------------------------
{
  const st = mem(), win = handlers();
  const eng = new AudioEngine({ storage: st, create: fakeCtx });
  eng.arm(win);
  ok(made === 0 && !eng.started, 'no AudioContext before a gesture');
  eng.setVolume(0.3); eng.setMuted(true);
  ok(made === 0, 'changing the volume or mute does not make a context');
  win.emit('pointerdown');
  ok(made === 1 && eng.started, 'the first pointer event makes the context');
  win.emit('keydown'); win.emit('pointerdown');
  ok(made === 1, 'later gestures do not make another');
  await tick();
  ok(eng.ready, 'ready once the context is up and any recordings tried');
}

// ---- mute and volume persist ----------------------------------------------------------------------------------------
{
  const st = mem();
  const a = new AudioEngine({ storage: st, create: fakeCtx });
  ok(a.volume === DEFAULT_VOLUME && !a.muted, 'defaults: sound on at the default volume');
  a.setMuted(true); a.setVolume(0.35);
  const b = new AudioEngine({ storage: st, create: fakeCtx });
  ok(b.muted && Math.abs(b.volume - 0.35) < 1e-9, 'mute and volume come back after a reload');
  ok(JSON.parse(st.m.get(AUDIO_KEY)!).muted === true, `stored under ${AUDIO_KEY} as JSON`);
  ok(b.gainFor() === 0 && Math.abs(b.gainFor(0.5, false) - 0.25) < 1e-9, 'muted master gain is 0; the gain follows the square of the volume');
  b.toggleMute();
  const c = new AudioEngine({ storage: st, create: fakeCtx });
  ok(!c.muted, 'unmuting is remembered too');
  st.m.set(AUDIO_KEY, '{nope'); ok(!new AudioEngine({ storage: st, create: fakeCtx }).muted, 'garbled storage falls back to the defaults');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const d = new AudioEngine({ storage: blocked, create: fakeCtx });
  d.setMuted(true);
  ok(d.muted, 'blocked storage: still works, just not remembered');
}

// ---- the volume clamps ----------------------------------------------------------------------------------------------
{
  const e = new AudioEngine({ storage: mem(), create: fakeCtx });
  e.setVolume(7); const hi = e.volume; e.setVolume(-3); const lo = e.volume; e.setVolume(0.5); e.setVolume(NaN);
  ok(hi === 1 && lo === 0 && e.volume === 0.5, 'volume clamps to 0..1 and ignores NaN');
  ok(clampVolume(Infinity, 0.2) === 0.2, 'a non-finite volume is rejected');
}

// ---- M toggles; Shift+M, typing and key repeat do not ---------------------------------------------------------------
{
  const e = new AudioEngine({ storage: mem(), create: fakeCtx }), win = handlers();
  const seen: boolean[] = [];
  bindMuteKey({ addEventListener: (t, f) => win.addEventListener(t, f) }, e, (m) => seen.push(m));
  win.emit('keydown', { code: 'KeyM', target: { tagName: 'DIV' } });
  ok(e.muted && seen[0] === true, 'M mutes');
  win.emit('keydown', { code: 'KeyM', target: { tagName: 'CANVAS' } });
  ok(!e.muted && seen[1] === false, 'M again unmutes');
  win.emit('keydown', { code: 'KeyM', shiftKey: true }); win.emit('keydown', { code: 'KeyM', ctrlKey: true }); win.emit('keydown', { code: 'KeyM', metaKey: true });
  win.emit('keydown', { code: 'KeyM', target: { tagName: 'INPUT' } }); win.emit('keydown', { code: 'KeyM', repeat: true }); win.emit('keydown', { code: 'KeyN' });
  ok(!e.muted && seen.length === 2, 'Shift+M (the perf readout), Ctrl/Cmd+M, typing, repeat and other keys leave it alone');
}

// ---- the voice budget -----------------------------------------------------------------------------------------------
{
  const e = new AudioEngine({ storage: mem(), create: fakeCtx });
  let n = 0; while (e.take(60)) n++;
  ok(n === MAX_VOICES - HELD_RESERVE && !e.take(60), `one-shots stop at ${MAX_VOICES - HELD_RESERVE} voices`);
  ok(e.take() && e.take() && e.take() && e.take() && !e.take(), `beds and the ridden vehicle may use the last ${HELD_RESERVE}, up to ${MAX_VOICES}`);
  e.give(); ok(e.take(), 'a freed voice can be taken again');
}

// ---- the manifest, and a recording replacing a voice ----------------------------------------------------------------
const okFetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
{
  const defs = Object.values(VOICES);
  ok(defs.every((d) => d.id in VOICES && ['ambience', 'vehicles', 'ui'].includes(d.bus) && Object.keys(d.params).length > 0 && d.made && d.driven), `all ${defs.length} manifest rows have an id, bus, recipe, driver and numbers`);
  ok(voiceFile('traffic') === 'traffic.opus' && voiceFile('bird', 2) === 'bird-2.opus', 'the conventional recording file names');
  ok(['ui-click', 'ui-place', 'ui-refuse', 'ui-undo'].every((id) => !VOICES[id].takes), 'the interface clicks stay synthesised');
  ok(defs.filter((d) => d.synth === false).every((d) => d.takes?.length), 'every recording-only voice has its recording');
  // a recording is fetched the first time its voice is wanted, decoded off the tick, and a 404 leaves the synthesis
  const saved = { t: VOICES.traffic.takes, w: VOICES.wind.takes, tf: VOICES.traffic.file, wf: VOICES.wind.file };
  VOICES.traffic.takes = ['traffic.opus', 'traffic-2.opus']; VOICES.wind.takes = ['wind.opus'];
  const asked: string[] = [];
  const e = new AudioEngine({ storage: mem(), create: fakeCtx, url: (f) => `u/${f}`, fetch: async (u) => { asked.push(u); if (u.includes('wind')) throw new Error('404'); if (u.includes('traffic-2')) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) }; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; } });
  e.start();
  ok(asked.length === 0 && e.ready, 'starting the engine fetches no recording: they load lazily');
  ok(e.sample('traffic') === null && asked.length === 2, 'the first wish for a voice starts fetching its takes and gets nothing yet');
  e.sample('traffic'); ok(asked.length === 2, 'a voice is asked for once');
  await tick();
  ok(e.sample('traffic') !== null && e.loaded('traffic') === 1, 'a recording is decoded in the background and then served (a 404 take is skipped)');
  ok(e.sample('wind') === null && e.sample('wind') === null && e.ready, 'a missing recording falls back to synthesis and does not block anything');
  // a bed made before its recording has decoded plays synthesis, then cross-fades to the recording
  const e2 = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: okFetch }); e2.start();
  log.length = 0; const bed = makeBed(e2, 'traffic', 3); bed?.tune(0.5, 0.5, 1);
  ok(/sawtooth|lowpass|type=/.test(log.join('|')) && e2.active === 1, 'a bed with a recording that has not decoded yet starts as synthesis');
  await tick(); log.length = 0; bed?.tune(0.6, 0.5, 1);
  ok(e2.active === 2 && e2.loaded('traffic') >= 1, 'when the recording arrives it cross-fades in (both sound for a moment)');
  await new Promise<void>((r) => setTimeout(r, 1700));
  ok(e2.active === 1, 'and the synthesis then lets go of its voice (one voice again)');
  bed?.stop();
  VOICES.traffic.takes = saved.t; VOICES.wind.takes = saved.w;
  // a recording-only voice is silent without its file and plays with it
  const e3 = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: okFetch }); e3.start();
  const only = Object.values(VOICES).find((d) => d.synth === false && d.kind === 'event')!;
  const wasTakes = only.takes; only.takes = undefined;
  log.length = 0; fire(e3, only.id as EventId, { seed: 1 }); ok(log.length === 0 && e3.active === 0, `${only.id} (recording only) makes no sound when it has no file`);
  only.takes = wasTakes; fire(e3, only.id as EventId, { seed: 1 }); await tick(); log.length = 0; fire(e3, only.id as EventId, { seed: 1 }); ok(log.length > 3, `${only.id} plays once its file has decoded`);
}

// ---- the recording files: present, Opus, small, credited, CC0 --------------------------------------------------------
{
  const dir = new URL('../src/audio/files/', import.meta.url), md = readFileSync(new URL('../src/audio/CREDITS.md', import.meta.url), 'utf8');
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.opus')) : [];
  const wired = Object.values(VOICES).flatMap((d) => d.takes ?? []);
  ok(wired.length > 0 && wired.every((f) => onDisk.includes(f)), `every manifest take exists (${wired.length} files)`);
  ok(onDisk.every((f) => wired.includes(f)), 'every file on disk is a take of a voice');
  const bad: string[] = [], big: string[] = [], uncredited: string[] = [];
  let total = 0;
  for (const f of onDisk) {
    const b = readFileSync(new URL(f, dir)); total += b.length;
    if (b.length > 400 * 1024) big.push(`${f} ${(b.length / 1024).toFixed(0)} KB`);
    if (b.subarray(0, 4).toString() !== 'OggS' || !b.subarray(0, 120).toString('latin1').includes('OpusHead')) bad.push(f);
    const c = CLIPS.find((x) => x.file === f);
    if (!c || c.licence !== 'CC0' || !md.includes(`[${c.freesound}](https://freesound.org/s/${c.freesound}/)`) || !md.includes(f)) uncredited.push(f);
    else if (statSync(new URL(f, dir)).size !== c.bytes) uncredited.push(`${f} (size differs from credits.ts: rebuild)`);
  }
  ok(bad.length === 0, `every file is Ogg Opus (${bad.join(', ') || 'all'})`);
  ok(big.length === 0, `every file is under 400 KB (${big.join(', ') || 'all'})`);
  ok(uncredited.length === 0, `every file has a CC0 row in credits.ts and CREDITS.md with its Freesound link (${uncredited.join(', ') || 'all'})`);
  ok(total < 8 * 1048576, `the set is under 8 MB (${(total / 1048576).toFixed(2)} MB in ${onDisk.length} files)`);
  ok(CLIPS.every((c) => VOICES[c.voice]?.source?.[c.file]?.freesound === c.freesound), 'every manifest row carries the source (Freesound id, title, author) of each take');
  const beds = Object.values(VOICES).filter((d) => d.kind === 'bed' && d.takes).length;
  console.log(`     (${beds} beds with recordings; ${Object.values(VOICES).filter((d) => !d.takes).map((d) => d.id).join(', ')} stay synthesised)`);
}

// ---- every voice builds against the fake context, and varies per instance ------------------------------------------
for (const mode of ['synthesised', 'recorded'] as const) {
  const e = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: mode === 'recorded' ? okFetch : async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }) });
  e.start();
  const synthOnly = (id: string) => mode === 'recorded' || VOICES[id].synth !== false;
  for (const id of Object.keys(VOICES)) e.sample(id); // ask for everything; the recordings decode in the background
  await tick();
  const events = (Object.values(VOICES).filter((d) => d.kind === 'event').map((d) => d.id) as EventId[]).filter(synthOnly);
  let threw = '';
  const record = (f: () => void) => { log.length = 0; try { f(); } catch (err) { threw += `${(err as Error).message} `; } return log.join('|'); };
  const sigs = new Map<string, string[]>();
  for (const id of events) {
    sigs.set(id, [1, 2, 3, 4].map((seed) => record(() => { if (id === 'bell' || id === 'bell-deep') ringBell(e, id === 'bell-deep', seed, 3); else fire(e, id, { seed }); })));
    e.active = 0;
  }
  ok(threw === '', `${mode}: every event voice builds (${threw || 'no errors'})`);
  const same = events.filter((id) => new Set(sigs.get(id)).size < 4);
  ok(same.length === 0, `${mode}: every event differs between instances (${same.join(', ') || 'all vary'})`);
  const silent = events.filter((id) => (sigs.get(id)![0] ?? '').length < 20);
  ok(silent.length === 0, `${mode}: every event makes a sound (${silent.join(', ') || 'all do'})`);
  const beds = BEDS.filter(synthOnly);
  for (const id of beds) {
    const s = [1, 2, 3].map((seed) => record(() => { const b = makeBed(e, id, seed); b?.tune(0.5, 0.5, 1); }));
    ok(new Set(s).size === 3, `${mode}: ${id} bed: start point, rate and modulation differ per instance`);
    e.active = 0;
  }
  for (const k of ['car', 'truck', 'bus', 'train', 'metro', 'boat', 'plane', 'heli'] as RideKind[]) {
    const s = [1, 2].map((seed) => record(() => { const r = makeRide(e, k, seed); r?.set(0.6); }));
    ok(threw === '' && s[0].length > 50, `${mode}: ${k} ride builds and takes a speed`);
    e.active = 0;
  }
  ok(threw === '', `${mode}: no voice threw (${threw || 'ok'})`);
  if (mode === 'synthesised') {
    // a bus and a train must not be the same recipe
    const b2 = record(() => makeRide(e, 'bus', 5)), t2 = record(() => makeRide(e, 'train', 5));
    ok(/type=sawtooth/.test(b2) && !/type=sawtooth/.test(t2) && /type=triangle/.test(t2), 'a bus is saws (a diesel); a train is triangles (a whine)');
  }
  e.muted = true; log.length = 0; fire(e, 'bird', { seed: 1 }); ok(log.length === 0, `${mode}: a muted engine builds nothing`);
}

// ---- the mix follows the city ---------------------------------------------------------------------------------------
{
  const quiet = newScan(), busy = { ...newScan(), cars: 60, walkers: 40, com: 0.3, road: 0.3 };
  const a = mixFor(quiet, 40, 12, false), b = mixFor(busy, 40, 12, false);
  const q = a.traffic.level, bt = b.traffic.level;
  ok(bt > q + 0.2 && b.traffic.tone > a.traffic.tone, 'traffic gets louder and brighter with the cars drawn');
  const near = mixFor(busy, 30, 12, false).wind.level, far = mixFor(busy, 300, 12, false).wind.level;
  ok(far > near * 3, 'wind rises with the camera height');
  // the night floor rose from 0.25 to 0.4 (street life): the murmur at 03:00 is now 0.4 of noon's, so the bound moved from 0.4 to 0.45
  ok(mixFor(busy, 40, 3, false).crowd.level < mixFor(busy, 40, 12, false).crowd.level * 0.45, 'the crowd murmur falls at night (to the 0.4 floor)');
  ok(mixFor(busy, 40, 12, true).crowd.level === 0 && mixFor(busy, 40, 12, true).wind.level <= 0.2, 'the map view keeps only a thin wind');
  const park = { ...newScan(), park: 0.4, res: 0.2 };
  ok(birdRate(park, 5.5, 40) > birdRate(park, 12, 40) * 2, 'the dawn chorus (04:30 to 07:00) is busier than midday');
  ok(birdRate(park, 12, 40) > birdRate(newScan(), 12, 40), 'birds follow parks and homes');
  ok(birdRate(park, 23, 40) === 0 && birdRate(park, 12, 400) === 0, 'no birds at night or from far away');
  const m0 = newMix();
  const lv = (sc: ReturnType<typeof newScan>, h: number, d = 40, rain = 0) => mixFor(sc, d, h, false, m0, rain);
  ok(lv({ ...newScan(), stadium: 2 }, 15).stadium.level > 0.3 && lv({ ...newScan(), stadium: 2 }, 3).stadium.level === 0 && lv({ ...newScan(), stadium: 2 }, 15, 400).stadium.level === 0, 'the stadium crowd is heard in the afternoon, close to a stadium, and not at night or from far off');
  ok(lv({ ...newScan(), school: 1 }, 10).playground.level > 0.3 && lv({ ...newScan(), school: 1 }, 20).playground.level === 0, 'the playground is heard in school hours, near a school');
  ok(lv({ ...newScan(), com: 0.4, walkers: 20 }, 11).market.level > 0.2 && lv({ ...newScan(), com: 0.4 }, 20).pub.level > 0.2 && lv({ ...newScan(), com: 0.4 }, 10).pub.level === 0, 'a market by day and a pub murmur in the evening, by the shops');
  ok(lv(newScan(), 12, 40, 0)['rain-light'].level === 0 && lv(newScan(), 12, 40, 0.3)['rain-light'].level > 0.05 && lv(newScan(), 12, 40, 0.3)['rain-heavy'].level === 0 && lv(newScan(), 12, 40, 1)['rain-heavy'].level > 0.2 && lv(newScan(), 12, 40, 1)['rain-light'].level === 0, 'light rain then heavy rain follow the weather hook, and it is dry by default');
  ok(lv({ ...newScan(), fountain: 1 }, 12).fountain.level > 0.2 && lv({ ...newScan(), fountain: 1 }, 12, 300).fountain.level === 0, 'a fountain is heard close in');
  ok(owlRate(park, 23, 40) > 0 && owlRate(park, 12, 40) === 0 && owlRate(newScan(), 23, 40) === 0, 'owls call at night in parks and homes only');
}

// ---- the districts (docs/audio.md "Districts"): a soft-max over the zone shares gives a street one bed, the others duck ----
{
  type Sc = ReturnType<typeof newScan>;
  const street = (o: Partial<Sc>): Sc => ({ ...newScan(), road: 0.3, cars: 60, walkers: 60, ...o });
  const zb = ZONES.map((z) => ZONE_BED[z]);
  const m = newMix();
  const beds = (sc: Sc, hour = 12, dist = 24, lead: Zn | null = null) => { mixFor(sc, dist, hour, false, m, 0, lead); return Object.fromEntries(zb.map((b) => [b, m[b].level])) as Record<string, number>; };
  const wins = (v: Record<string, number>, w: string, k = 2) => zb.filter((b) => b !== w).every((b) => v[w] >= k * v[b]) && v[w] > 0.2;
  // a street that is 90% one thing: that bed at least twice any other, near its ceiling
  const ind90 = beds(street({ ind: 0.18, res: 0.01, com: 0.01 })), res90 = beds(street({ res: 0.18, ind: 0.01, com: 0.01 }));
  ok(wins(ind90, 'zone-ind'), `a street 90% industrial drives the industrial bed at least 2x any other (${zb.map((b) => `${b.slice(5)} ${ind90[b].toFixed(2)}`).join(', ')})`);
  ok(wins(res90, 'zone-res'), `a street 90% residential drives the residential bed at least 2x any other (${zb.map((b) => `${b.slice(5)} ${res90[b].toFixed(2)}`).join(', ')})`);
  ok(wins(beds(street({ com: 0.18, off: 0, res: 0.01, ind: 0.01 })), 'zone-com') && wins(beds(street({ com: 0.18, off: 0.18, res: 0.01 })), 'zone-off') && wins(beds(street({ civic: 0.18, res: 0.01, ind: 0.01 })), 'zone-civic'), 'shops, offices and civic streets each drive their own bed');
  // a 50/50 street still has one clear winner (a 54/46 one, and a dead heat settled by whoever led last)
  const mixed = beds(street({ com: 0.135, res: 0.115 }));
  ok(wins(mixed, 'zone-com', 2), `a 54/46 street of shops and homes has one clear winner (shops ${mixed['zone-com'].toFixed(2)}, homes ${mixed['zone-res'].toFixed(2)})`);
  const tie = street({ com: 0.12, res: 0.12 });
  ok(wins(beds(tie, 12, 24, 'res'), 'zone-res', 2) && wins(beds(tie, 12, 24, 'com'), 'zone-com', 2), 'a dead heat is held by the zone that led at the last tick (no flipping on a border)');
  // the weights are a soft-max over shares: they sum to 1, and nothing built is no district
  const z = zonesOf(street({ com: 0.1, off: 0.04, ind: 0.05, civic: 0.03, res: 0.2 }));
  ok(Math.abs(ZONES.reduce((a, k) => a + z.w[k], 0) - 1) < 1e-9 && Math.abs(ZONES.reduce((a, k) => a + z.share[k], 0) - 1) < 1e-9 && z.win === 'res', `shares and weights each sum to 1 (${zoneText(z)})`);
  const open = beds(street({}));
  ok(zb.every((b) => open[b] === 0) && zonesOf(street({})).win === null, 'open country with nothing built has no district bed');
  ok(zb.every((b) => beds(street({ ind: 0.18 }), 12, 24)[b] >= 0) && zb.every((b) => { mixFor(street({ ind: 0.18 }), 24, 12, true, m); return m[b].level === 0; }), 'the map view silences the district beds');
  ok(beds(street({ ind: 0.18 }), 12, 300)['zone-ind'] === 0, 'a district bed is a street-zoom sound: nothing from high above');
  // the hour: a night office is quieter than its day, a quarter of it after 19:00 and less
  const off = street({ com: 0.18, off: 0.18, res: 0.01 });
  const offDay = beds(off, 12)['zone-off'], offNight = beds(off, 23)['zone-off'], offEve = beds(off, 20.5)['zone-off'];
  ok(offNight < offDay * 0.3 && offEve < offDay * 0.4 && beds(off, 10)['zone-off'] > offDay * 0.95, `a night office scan is quieter than its day one (day ${offDay.toFixed(2)}, 20:30 ${offEve.toFixed(2)}, 23:00 ${offNight.toFixed(2)})`);
  ok(beds(street({ res: 0.18 }), 3)['zone-res'] < beds(street({ res: 0.18 }), 12)['zone-res'] * 0.5 && beds(street({ ind: 0.18 }), 3)['zone-ind'] < beds(street({ ind: 0.18 }), 12)['zone-ind'], 'homes are quiet at night and the works run down');
  // the beds that were everywhere now follow the district: crowd by the walkers drawn and the street they are in, traffic by the street
  const crowd = (sc: Sc) => mixFor(sc, 24, 12, false, newMix()).crowd.level;
  ok(crowd(street({ com: 0.18 })) > crowd(street({ ind: 0.18 })) * 4 && crowd(street({ com: 0.18, walkers: 0 })) < 0.02, 'the crowd murmur is the shops and squares and the walkers drawn: a yard with the same walkers is far quieter, no walkers is no murmur');
  // the crowd knee moved from 6..90 to 3..25 walkers per circle (street life): 60 walkers at zoom 80 are 8.4 a circle, 0.43 of a crowd, so the bound moved from 3x to 2x
  ok(peopleNear(street({ walkers: 60 }), 24) > peopleNear(street({ walkers: 60 }), 80) * 2, 'walkers count as a density: the same count over a wider circle is a thinner crowd');
  const trafficOf = (sc: Sc) => mixFor(sc, 24, 12, false, newMix()).traffic.level;
  ok(trafficOf(street({ res: 0.18 })) < trafficOf(street({ ind: 0.18 })) * 0.7, 'a terrace is quieter than a lorry yard for the same cars');
  // birds: only with green, by day, with a dawn chorus; none in a yard, a shopping street or an office quarter, none at 02:00
  const homes = street({ res: 0.2, park: 0.05 }), parkland = street({ park: 0.3, res: 0.05 });
  ok(birdRate(homes, 2, 24) === 0 && birdRate(parkland, 2, 24) === 0 && birdRate(homes, 23.5, 24) === 0, 'birds at 02:00 are silent (and at 23:30)');
  ok(birdRate(street({ ind: 0.2, res: 0.02 }), 12, 24) === 0 && birdRate(street({ com: 0.2, off: 0.1 }), 12, 24) === 0 && birdRate(street({ com: 0.2, off: 0.2, res: 0.03 }), 12, 24) === 0, 'no birds in an industrial yard, a shopping street or an office quarter');
  ok(birdRate(homes, 12, 24) > 0 && birdRate(parkland, 12, 24) > birdRate(homes, 12, 24) && birdRate(homes, 5.5, 24) > birdRate(homes, 12, 24) * 4, 'birds follow homes and parks by day, louder in parks, with a dawn chorus');
  ok(birdRate(homes, 12, 24) < 0.1 && birdRate(homes, 20.8, 24) === 0, 'a daytime bird is not a constant (under one a ten seconds) and the song is over after dusk');
  ok(greenOf(street({ res: 0.2, ind: 0.002 }), null) > 0.1 && greenOf(street({ res: 0.03, com: 0.2 }), null) < 0.07, 'homes make green only where the street is homes');
  // digging: only with a site under construction, by working hours, close in, and rarely
  const site = street({ sites: 5, ind: 0.1 }), depot = street({ builders: 1, ind: 0.1 }), none = street({ ind: 0.1 });
  ok(worksOf(site, 11, 24) > 0.8 && worksOf(none, 11, 24) === 0 && worksOf(depot, 11, 24) < worksOf(site, 11, 24) * 0.1, 'builders dig only where a site is under construction: a depot alone is a quiet yard, nothing at all is silence');
  ok(worksOf(site, 22, 24) === 0 && worksOf(site, 11, 120) === 0, 'no digging at night or from far above');
  // the scan: homes, shops, offices, industry, civic and sites from a fake city (kind ids 1 to 15 are the family bases)
  const fam = (f: number, site = false) => { const t = packTile(0, false, f, 1); return site ? withConstruction(t, true) : t; };
  const tiles = [fam(3), fam(4), fam(7), fam(2), fam(1), fam(12), fam(3, true)];
  const city: AmbSources = { hour: () => 12, camera: () => ({ x: 0, z: 0, dist: 14, map: false, rightX: 1, rightZ: 0 }), tileAt: (x, y) => tiles[(Math.abs(x) + Math.abs(y)) % tiles.length], kindIdAt: (x, y) => { const t = tiles[(Math.abs(x) + Math.abs(y)) % tiles.length]; return (t >> 3) & 15; }, agents: () => [] };
  const sc = scanAround(city, 0, 0, 14, newScan());
  ok(sc.off > 0.1 && sc.civic > 0.2 && sc.ind > 0.2 && sc.com > sc.off && sc.res > 0.1 && sc.sites > 10, `the scan counts offices apart from shops, civic tiles and sites under construction (off ${sc.off.toFixed(2)}, civic ${sc.civic.toFixed(2)}, shops+offices ${sc.com.toFixed(2)}, sites ${sc.sites})`);
  const slow = Math.max(...[1, 2, 3, 4, 5].map(() => { const t0 = performance.now(); for (let i = 0; i < 200; i++) { zonesOf(sc, 'ind'); mixFor(sc, 14, 12, false, m, 0, 'ind'); } return (performance.now() - t0) / 200; }));
  ok(slow < 0.05, `the district model and the mix cost ${slow.toFixed(4)} ms a tick (under 0.05)`);
  // the readout's words for the district bed, and for a bed that follows it
  const why = (id: string) => bedWhy(id, street({ com: 0.14, ind: 0.04, res: 0.03 }), 24, 12, 0.2, null, false, 0, null);
  ok(/commercial 0\.\d\d wins, industrial 0\.\d\d, residential 0\.\d\d; ducked/.test(why('zone-com')) && /commercial weight \d\.\d\d/.test(why('zone-com')) && /district: commercial/.test(why('crowd')) && /district: commercial/.test(why('traffic')), `bedWhy names the soft-max winner and the ducked zones (${why('zone-com').slice(0, 120)})`);
  ok(/nothing built/.test(bedWhy('zone-res', street({}), 24, 12, 0, null, false)), 'bedWhy says when nothing is built');
  // every district bed and event is a voice with a recording, wired to a manifest row
  const events = ['metal-clank', 'reverse-beep', 'steam-vent', 'till', 'busker', 'music-door', 'revolving-door', 'lift-ding', 'radio-window', 'front-door', 'kids-yard', 'camera-shutter'];
  ok(zb.every((b) => VOICES[b]?.kind === 'bed' && (VOICES[b].takes?.length ?? 0) >= 1) && events.every((e) => VOICES[e]?.kind === 'event' && (VOICES[e].takes?.length ?? 0) >= 1), 'the five district beds and twelve district events are manifest voices with recordings');
  const hint = applyHint(newMix(), { 'zone-off': 1, 'zone-ind': 0 }, 0, 3);
  ok(hint['zone-off'].level > 0.4 && hint['zone-ind'].level === 0, 'a tour stop can hold or silence a district bed');
}

// ---- the 250 ms tick, with no allocation hot spots: scan and tick against a fake city ---------------------------------
{
  const e = new AudioEngine({ storage: mem(), create: fakeCtx }); e.start(); await tick();
  const agents = Array.from({ length: 4000 }, (_, i) => ({ rx: (i % 80) - 40, rz: Math.floor(i / 80) - 25, car: i % 3 === 0, trav: i % 3 !== 0 }));
  let hour = 5.5;
  const src: AmbSources = {
    hour: () => hour, camera: () => ({ x: 0, z: 0, dist: 40, map: false, rightX: 1, rightZ: 0 }),
    tileAt: (x, y) => ((x + y) & 7) === 0 ? 4 : 0, kindIdAt: () => 0, agents: () => agents,
    pelican: () => ({ x: 3, z: 2 }),
  };
  const sc = scanAround(src, 0, 0, 40, newScan());
  ok(sc.cars > 0 && sc.walkers > 0, 'the scan counts cars and walkers near the camera');
  const amb = new Ambience(e, src, 7);
  log.length = 0;
  for (let t = 1000; t < 9000; t += 250) amb.frame(t);
  ok(amb.stats.ticks >= 30, 'the ambience ticks every 250 ms and not more often');
  ok(/pan=|buffer/.test(log.join('|')) || log.length > 100, 'the beds were built and tuned');
  ok(e.active <= MAX_VOICES, `voices stay within the budget (${e.active} of ${MAX_VOICES})`);
  const before = amb.stats.ticks; amb.frame(8800); ok(amb.stats.ticks === before, 'a frame inside the 250 ms window does nothing');
  hour = 11.9; amb.frame(10000); hour = 12.1; log.length = 0; amb.frame(10300);
  ok(true, 'the hour roll does not throw');
  e.muted = true; const t2 = amb.stats.ticks; amb.frame(20000); ok(amb.stats.ticks === t2, 'a muted engine skips the tick');
  e.muted = false;
  // the ridden vehicle: duck under it, restore after
  let ride: RideNow | null = { key: 'c1', kind: 'bus', x: 0, z: 0 };
  const f = new FpvSound(e, { riding: () => ride }, 3);
  for (let t = 30000, x = 0; t < 31500; t += 100, x += 0.25) { if (ride) ride.x = x; f.frame(t); }
  ok(f.riding && f.speed > 0.2, 'riding a bus: the engine runs with its speed');
  ride = null; f.frame(32000);
  ok(!f.riding, 'leaving the vehicle ends its sound');
}

// ---- tour cues (docs/audio.md "Tour cues"): the table is complete and names real voices; the cues play, bias and duck, and let go ----
{
  const london = demoTour('london');
  ok(london.length >= 130, `the London tour has ${london.length} stops`);
  const none = london.filter((t) => t.sound === undefined).map((t) => t.id);
  ok(none.length === 0, `every London stop has a sound or says 'ambience' (${none.join(', ') || 'all do'})`);
  const probs = [...tourSoundProblems('london', london), ...tourSoundProblems('showcase', demoTour('showcase'))];
  ok(probs.length === 0, `the tour sound table is well formed (${probs.slice(0, 3).join('; ') || 'no problems'})`);
  const cues = [...london, ...demoTour('showcase')].flatMap((t) => (t.sound && t.sound !== 'ambience' ? t.sound.cues.map((c) => ({ stop: t.id, ...c })) : []));
  const unknown = cues.filter((c) => !VOICES[c.voice]).map((c) => `${c.stop}:${c.voice}`);
  ok(unknown.length === 0, `every cue names a manifest voice (${unknown.join(', ') || `${cues.length} cues`})`);
  const silent = cues.filter((c) => VOICES[c.voice] && !VOICES[c.voice].takes?.length).map((c) => `${c.stop}:${c.voice}`);
  ok(silent.length === 0, `every cue's voice has a recording (${silent.join(', ') || 'all do'})`);
  const loops = cues.filter((c) => c.loop);
  const shortLoops = loops.filter((c) => (CLIPS.find((k) => k.voice === c.voice)?.seconds ?? 0) < 8).map((c) => c.voice);
  ok(loops.length > 0 && shortLoops.length === 0, `a looped cue names a bed-length recording (${[...new Set(loops.map((c) => c.voice))].join(', ')})`);
  const noAt = cues.filter((c) => c.at !== undefined && (c.at < 0 || c.at > 30)).length + cues.filter((c) => c.gain !== undefined && (c.gain <= 0 || c.gain > 2)).length;
  ok(noAt === 0, 'cue times are 0 to 30 s and gains 0 to 2');
  ok(Object.values(LONDON_SOUND).every((e) => typeof e !== 'string' || e === 'ambience' || e in SCENES), 'every scene a London row names exists');
  ok(london.filter((t) => t.sound === 'ambience').length >= 1 && london.filter((t) => t.sound && t.sound !== 'ambience').length > 120, 'most stops have cues; a few say so when they are left to the beds');
  // a scene with changes laid over it keeps the rest of the scene
  const merged = resolveStopSound(['hospital', { ambience: { water: 0.3 } }]) as Exclude<TourSound, 'ambience'>;
  ok(merged.cues.length === (SCENES.hospital.cues.length) && merged.ambience?.water === 0.3 && merged.ambience?.traffic === SCENES.hospital.ambience.traffic, 'a scene with changes keeps its cues and the beds it did not change');
  ok(Object.values(VOICES).filter((d) => d.kind === 'event' && d.synth === false).length >= 40, 'the tour voices are recording-only events');

  // the bias: named beds are held at their share of the ceiling; the rest follow the scene
  const base = mixFor(newScan(), 40, 12, false);
  const held = applyHint(structuredClone(base), { water: 1, traffic: 0 }, 5000, 3);
  ok(held.water.level > HINT_CEIL.water * 0.9 && held.water.level < HINT_CEIL.water * 1.1 && held.traffic.level === 0 && held.crowd.level === base.crowd.level, 'a tour bias holds the beds it names (with a little breath) and leaves the rest');
  ok(applyHint(structuredClone(base), null, 0).water.level === base.water.level, 'no bias leaves the mix alone');

  // the cues against a fake engine: they play after the settle, bias, duck, and everything is given back
  const mkSrc = (): AmbSources => ({ hour: () => 12, camera: () => ({ x: 0, z: 0, dist: 40, map: false, rightX: 1, rightZ: 0 }), tileAt: () => 0, kindIdAt: () => 0, agents: () => [] });
  const e = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: okFetch });
  const amb = new Ambience(e, mkSrc(), 5);
  const tc = new TourCues(e, amb);
  tc.show('early', { cues: [{ voice: 'seagulls', at: 0 }] });
  ok(tc.log.length === 0 || tc.log.every((l) => l.kind !== 'cue'), 'before any gesture a cue is not played');
  await new Promise((r) => setTimeout(r, 450));
  ok(tc.log.some((l) => /no gesture/.test(l.result)), 'and the log says why (no gesture yet)');
  e.start(); await tick();
  const dbg: string[] = []; const was = console.log; console.log = (...a: unknown[]) => { dbg.push(a.join(' ')); };
  tc.debug = true;
  log.length = 0;
  tc.show('river', { cues: [{ voice: 'seagulls', at: 0.01 }, { voice: 'tube-hall', at: 0.01, loop: true }, { voice: 'nothing-here', at: 0.01 }], ambience: { water: 0.9, traffic: 0 }, duck: 6 }, 0);
  ok(amb.hinted?.water === 0.9, 'the stop biases the beds at once');
  await new Promise((r) => setTimeout(r, 600));
  console.log = was; tc.debug = false;
  ok(tc.log.some((l) => l.voice === 'seagulls' && /^played/.test(l.result)), 'the cue plays once its recording is there');
  ok(tc.log.some((l) => l.voice === 'tube-hall' && /looping/.test(l.result)) && tc.state.loops === 1, 'a looped cue runs until the stop is left');
  ok(tc.log.some((l) => l.voice === 'nothing-here' && /NO SUCH VOICE/.test(l.result)), 'a cue naming no voice is reported, not thrown');
  ok(dbg.some((l) => /\[tour-cue\] river \| cue seagulls/.test(l)), 'the debug flag prints each cue as it starts');
  ok(log.some((l) => /ambience.*setTargetAtTime|setTargetAtTime/.test(l)), 'the beds duck while a cue sounds');
  const active = e.active;
  tc.show('next', 'ambience');
  ok(amb.hinted === null && tc.state.loops === 0, 'leaving a stop gives the beds back and stops its loops');
  ok(e.active <= active, 'and frees the voice a loop held');
  tc.show('quiet', { cues: [{ voice: 'seagulls', at: 0.01 }] }, 0); e.muted = true;
  await new Promise((r) => setTimeout(r, 400));
  ok(tc.log.some((l) => l.stop === 'quiet' && /muted/.test(l.result)), 'a muted engine plays no cue (the log says so)');
  e.muted = false;
  tc.show('late', { cues: [{ voice: 'seagulls', at: 5 }], ambience: { wind: 0.5 } }); tc.clear();
  await new Promise((r) => setTimeout(r, 100));
  ok(amb.hinted === null && !tc.log.some((l) => l.stop === 'late' && l.kind === 'cue'), 'closing the tour cancels the cues not yet played');
  // the duck is a layer of its own: the tour's dip and the ridden vehicle's add and release separately
  log.length = 0; e.duckAmbience(-6, 0.4); e.duckAmbience(-4, 0.2, 'tour'); const both = log.filter((l) => /setTargetAtTime/.test(l)).length; e.duckAmbience(0, 0.2, 'tour'); e.duckAmbience(0, 0.6);
  ok(both >= 2 && DEFAULT_DUCK_DB === 4, `the duck layers add (the tour's ${DEFAULT_DUCK_DB} dB beside the vehicle's 6 dB)`);
}

// ---- the audio readout (docs/audio.md "Readout"): rows built from a snapshot, the journal, and the engine's own state feeding it ----
{
  // a fake snapshot: a traffic bed with its inputs, a tour cue with its stop, a ride, a ui click, a quiet bed
  const sc = newScan(); sc.cars = 212; sc.road = 0.18; sc.walkers = 86; sc.com = 0.3;
  const trafficWhy = bedWhy('traffic', sc, 24, 8, 0.252, null, false);
  const rows: VoiceRow[] = [
    { id: 'click', cls: 'ui', bus: 'ui', db: -20, cents: 12, take: 'synth', age: 100, left: 0.2, why: 'ui: place' },
    { id: 'wind', cls: 'bed', bus: 'ambience', db: -52, cents: null, take: 'wind.opus', age: 9000, why: bedWhy('wind', sc, 24, 8, 0.1, null, false) },
    { id: 'traffic', cls: 'bed', bus: 'ambience', db: -18.4, cents: 21, take: 'traffic.opus', age: 62000, why: trafficWhy },
    { id: 'big-ben', cls: 'cue', bus: 'ambience', db: -14, cents: -30, take: 'big-ben.opus', age: 800, left: 11.2, why: 'tour stop parliament, cue 1 of 2, at +0.8 s, gain x1.30' },
    { id: 'veh-bus', cls: 'ride', bus: 'vehicles', db: -16, cents: 0, take: 'veh-bus.opus', age: 4000, why: 'riding c12: a bus at 60% of its top speed' },
  ];
  const journal = [
    { t: 1000, ev: 'start' as const, cls: 'bed' as const, id: 'traffic', why: 'always on: the ambience started' },
    { t: 5000, ev: 'start' as const, cls: 'cue' as const, id: 'big-ben', why: 'tour stop parliament, cue 1 of 2', n: 3 },
    { t: 7000, ev: 'skip' as const, cls: 'cue' as const, id: 'bridge-bell', why: 'tower-bridge: silent: muted' },
  ];
  const st: AudioState = { at: 70000, context: 'suspended', muted: true, volume: 0.6, masterDb: -Infinity, voices: 5, cap: 24, loading: 2, ducks: [['tour', -4], ['ride', -6]], hour: 8.25, hourSource: 'clock', stop: 'parliament', rows, journal };
  const sorted = rowsOf(st);
  ok(sorted.map((r) => r.id).join() === 'traffic,wind,big-ben,veh-bus,click' || sorted.map((r) => r.id).join() === 'big-ben,traffic,wind,veh-bus,click', `rows sort by bus then loudest first (${sorted.map((r) => r.id).join(' ')})`);
  ok(sorted[0].bus === 'ambience' && sorted[sorted.length - 1].bus === 'ui' && sorted.findIndex((r) => r.bus === 'vehicles') > sorted.findIndex((r) => r.id === 'wind'), 'ambience first, then vehicles, then ui');
  const bed = sorted.find((r) => r.id === 'traffic')!;
  ok(/cars near 212/.test(bed.why) && /zoom 24/.test(bed.why) && /hour 08:00/.test(bed.why) && /of its ceiling/.test(bed.why), `a bed row carries its inputs: ${bed.why}`);
  ok(rowText(bed).includes('212') && rowHtml(bed).includes('cars near 212') && rowHtml(bed).includes('-18.4 dB') && rowHtml(bed).includes('traffic.opus'), 'the bed row shows its level, take and inputs in the text and the HTML');
  const cue = sorted.find((r) => r.id === 'big-ben')!;
  ok(cue.cls === 'cue' && /stop parliament, cue 1 of 2, at \+0\.8 s/.test(cue.why) && rowHtml(cue).includes('11.2 s left'), 'a cue row carries its stop, its index and its moment');
  ok(/riding c12: a bus/.test(sorted.find((r) => r.cls === 'ride')!.why) && /ui: place/.test(rowHtml(sorted.find((r) => r.cls === 'ui')!)), 'a ride row names the vehicle, a ui row its name');
  const head = headerText(st);
  ok(/context suspended/.test(head) && /MUTED/.test(head) && /voices 5\/24/.test(head) && /decodes in flight 2/.test(head) && /tour -4 dB, ride -6 dB/.test(head) && /hour 08:15 from the clock/.test(head) && /tour stop parliament/.test(head), `the header says the context, mute, voices, decodes, ducks and the hour: ${head}`);
  ok(/suspended/.test(headerHtml(st)) && /muted/.test(headerHtml(st)) && /class="aro-head warn"/.test(headerHtml(st)), 'a suspended or muted context is flagged in the header');
  ok(/class="aro-head "/.test(headerHtml({ ...st, context: 'running', muted: false })), 'a running, unmuted context is not');
  const txt = stateText(st);
  ok(txt.includes('cars near 212') && txt.includes('stop parliament') && txt.includes('skip cue bridge-bell') && txt.includes('big-ben ×3') && txt.includes('+5.0 s'), 'Copy text has the header, every voice with its why and the log with times and counts');
  ok(journalHtml(journal, 70000).split('aro-log ').length - 1 === 3 && journalText(journal[1], 70000).startsWith('-65.0 s'), 'the log lists every row, newest first, as "-65.0 s" ago');
  ok(rowText({ ...bed, db: -Infinity }).includes('-∞ dB'), 'silence reads -∞ dB');

  // the engine side: one-shots list themselves, the journal is a ring of JOURNAL rows with repeats counted
  const e = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: okFetch });
  e.start(); await tick();
  const tag = { id: 'bird', cls: 'event' as const, bus: 'ambience' as const, why: 'dawn chorus 05:10', db: -30, cents: 14, take: 'synth' };
  ok(e.take(0.2, tag) && e.shots.length === 1 && e.shots[0].why === 'dawn chorus 05:10' && e.shots[0].until > e.shots[0].at, 'a tagged one-shot is listed with its why while it sounds');
  ok(e.journal.length === 1 && e.journal[0].ev === 'start' && e.journal[0].id === 'bird', 'and starting it is a journal row');
  e.take(0.2, tag); e.take(0.2, tag);
  ok(e.journal.length === 1 && e.journal[0].n === 3, 'the same start repeated inside two seconds is one row with a count');
  ok(e.take(0) && e.shots.length === 3 && e.active === 4, 'a held voice (no seconds) is not a one-shot row');
  for (let i = 0; i < 60; i++) e.log('start', 'bed', `b${i}`, 'x');
  ok(e.journal.length === JOURNAL && e.journal[JOURNAL - 1].id === 'b59', `the journal keeps the last ${JOURNAL} rows`);
  ok(toDb(0.5) > -6.1 && toDb(0.5) < -5.9 && toDb(0) === -Infinity, 'gain to dB');

  // the real engine feeding it: fire tags the one-shot, a bed's inputs are in words, a cue carries its stop
  const e2 = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: okFetch });
  e2.start(); await tick();
  fire(e2, 'beep', { seed: 3, gain: 0.8, why: 'crossing red at 12,40, 6 tiles off' });
  ok(e2.shots.some((x) => x.id === 'beep' && x.why === 'crossing red at 12,40, 6 tiles off' && x.cls === 'event' && x.bus === 'ambience' && typeof x.db === 'number'), 'fire() hands the trigger to the readout');
  fire(e2, 'ui-place', { seed: 4, why: 'ui: place' });
  ok(e2.shots.some((x) => x.id === 'ui-place' && x.cls === 'ui' && x.why === 'ui: place'), 'an interface click is class ui');
  const src2: AmbSources = { hour: () => 8, hourSource: () => 'pinned light (a tour stop sets the hour)', camera: () => ({ x: 20, z: 20, dist: 24, map: false, rightX: 1, rightZ: 0 }), tileAt: () => 0, kindIdAt: () => 0, agents: () => Array.from({ length: 30 }, (_, i) => ({ rx: 20 + i * 0.3, rz: 20, car: true, trav: false })) };
  const amb2 = new Ambience(e2, src2, 9);
  amb2.frame(1000); amb2.frame(1300);
  const beds = amb2.bedList();
  ok(beds.length >= 5 && beds.every((b) => b.born > 0), `the ambience lists its beds (${beds.map((b) => b.id).join(' ')})`);
  const tr = beds.find((b) => b.id === 'traffic')!;
  ok(/cars near 30/.test(tr.why) && /zoom 24/.test(tr.why) && /hour 08:00/.test(tr.why), `the traffic bed's why is the tick's own numbers (${tr.why})`);
  ok(amb2.hourInfo().source === 'pinned light (a tour stop sets the hour)' && amb2.hourInfo().hour === 8, 'the hour source comes through');
  ok(e2.journal.some((j) => j.ev === 'start' && j.cls === 'bed' && j.id === 'traffic'), 'a bed starting is a journal row');
  const tc2 = new TourCues(e2, amb2);
  tc2.show('parliament', { cues: [{ voice: 'big-ben', at: 0.01 }, { voice: 'tube-hall', at: 0.01, loop: true }], ambience: { water: 0.5 } }, 0);
  await new Promise((r) => setTimeout(r, 600));
  ok(e2.shots.some((x) => x.id === 'big-ben' && x.cls === 'cue' && /tour stop parliament, cue 1 of 2/.test(x.why)), 'a one-shot cue carries its stop and index');
  const loops = tc2.loopList();
  ok(loops.length === 1 && loops[0].voice === 'tube-hall' && loops[0].stop === 'parliament' && loops[0].index === 2 && tc2.shown === 'parliament', 'a looping cue is listed with its stop and index');
  ok(e2.journal.some((j) => j.cls === 'engine' && j.id === 'tour parliament') && e2.journal.some((j) => j.cls === 'cue' && j.id === 'tube-hall' && /loop/.test(j.why)), 'the stop and the loop are journal rows');
  tc2.show('next', 'ambience');
  ok(e2.journal.some((j) => j.ev === 'stop' && j.id === 'tube-hall' && /stop was left/.test(j.why)), 'leaving the stop journals the loop ending');
  tc2.clear();
  // the Shift+S key: a capture-phase listener that swallows the press, ignores typing and repeat
  const hs: { f: (e: any) => void; capture?: boolean }[] = []; let toggled = 0;
  bindReadoutKey({ addEventListener: (_t: 'keydown', f: (e: any) => void, c?: boolean) => void hs.push({ f, capture: c }) }, () => toggled++);
  const press = (o: Record<string, unknown>) => { let stopped = false; hs[0].f({ code: 'KeyS', shiftKey: true, metaKey: false, ctrlKey: false, altKey: false, repeat: false, target: null, stopPropagation() { stopped = true; }, ...o }); return stopped; };
  ok(hs[0].capture === true && press({}) === true && toggled === 1, 'Shift+S toggles, in the capture phase, and the camera never sees it');
  ok(!press({ shiftKey: false }) && !press({ ctrlKey: true }) && !press({ metaKey: true }) && !press({ target: { tagName: 'INPUT' } }) && !press({ code: 'KeyM' }) && toggled === 1, 'S alone, Ctrl or Cmd+S, typing and other keys do not');
  press({ repeat: true }); ok(toggled === 1, 'key repeat does not flicker it');
}

// ---- street life (docs/audio.md "Street life"): pass-bys, walkers, sirens that follow their vehicles, the new knees ----------------------
{
  // the classes the ear tells apart
  const car = (o: Partial<StreetAgent> = {}): StreetAgent => ({ rx: 0, rz: 0, car: true, trav: true, kind: 3, cls: VehicleClass.Sedan, fleet: 0, ...o });
  ok(passKindOf(car()) === 'car' && passKindOf(car({ cls: VehicleClass.Bus })) === 'bus' && passKindOf(car({ cls: VehicleClass.Truck })) === 'lorry' && passKindOf(car({ cls: VehicleClass.Van })) === 'van'
    && passKindOf(car({ fleet: FleetKind.Bicycle })) === 'bike' && passKindOf(car({ fleet: FleetKind.Moped })) === 'moped' && passKindOf(car({ fleet: FleetKind.Taxi })) === 'taxi' && passKindOf(car({ fleet: FleetKind.BinLorry })) === 'lorry' && passKindOf(car({ fleet: FleetKind.SchoolBus })) === 'bus',
    'a vehicle is heard by its class: car, taxi, van, lorry, bus, moped, bicycle (the fleet kind first)');
  ok(sirenKindOf(car({ emergency: true, kind: VehicleKind.Ambulance })) === 'ambulance' && sirenKindOf(car({ emergency: true, kind: VehicleKind.FireEngine })) === 'fire' && sirenKindOf(car({ emergency: true, kind: VehicleKind.Patrol })) === 'police' && sirenKindOf(car({ kind: VehicleKind.Ambulance })) === null,
    'an emergency vehicle on a call has its siren; off a call it has none');
  ok(passRadius(24) === 12 && passRadius(48) === 24 && passRadius(91) === 0 && passRadius(6) === STREET.passMinR, 'the pass-by radius: 12 tiles at street zoom, growing with the zoom, none above 90');
  // the picker: nearest first, one start per crossing, one a second, six at once, re-armed past 2R
  const pk = new PassPicker(), R = 12;
  pk.begin(); pk.visit(1, 9, R, 2); pk.visit(2, 4, R, 2); pk.visit(3, 20, R, 2); pk.visit(4, 3, R, 0.1);
  const first = pk.pick(1000);
  ok(first === 2, `the nearest moving vehicle inside R fires first, a standing one not at all (picked ${first})`);
  pk.fired(2, 1000, 3);
  pk.begin(); pk.visit(1, 8, R, 2); pk.visit(2, 3, R, 2);
  ok(pk.pick(1500) === null, 'no second start inside a second');
  pk.begin(); pk.visit(1, 8, R, 2); pk.visit(2, 2, R, 2);
  ok(pk.pick(2100) === 1, 'a vehicle that has fired does not fire again on the same crossing (the next nearest does)');
  pk.fired(1, 2100, 3);
  pk.begin(); pk.visit(2, 30, R, 2); pk.visit(1, 8, R, 2); pk.pick(3200);
  pk.begin(); pk.visit(2, 5, R, 2); pk.visit(1, 8, R, 2);
  ok(pk.pick(4300) === 2, 'leaving 2R re-arms it: the next crossing fires again');
  const six = new PassPicker(); let t = 0, n = 0;
  for (let i = 0; i < 12; i++) { six.begin(); for (let k = 0; k < 12; k++) six.visit(100 + k, 1 + k, R, 2); const p = six.pick(t); if (p !== null) { six.fired(p, t, 30); n++; } t += 1100; }
  ok(n === STREET.passMax && six.sounding(t) === STREET.passMax, `at most ${STREET.passMax} pass-bys sound at once (${n} started over 12 s with 12 cars waiting)`);
  const rate = new PassPicker(); let starts = 0;
  for (let ms = 0; ms < 60000; ms += 250) { rate.begin(); for (let k = 0; k < 40; k++) rate.visit((ms / 250) * 40 + k, 3, R, 2); const p = rate.pick(ms); if (p !== null) { rate.fired(p, ms, 0.5); starts++; } }
  ok(starts <= 60 && starts >= 55, `the budget holds a stream of cars to one start a second (${starts} in a minute)`);
  // the geometry: closest approach, pan across, siren gain
  const ap = approach(-10, 3, 2, 0);
  ok(Math.abs(ap.t - 5) < 1e-9 && Math.abs(ap.d - 3) < 1e-9 && approach(5, 0, 2, 0).t === 0, 'closest approach: when and how near, and a vehicle going away is nearest now');
  ok(panOf(-8, 0, 1, 0) < -0.5 && panOf(8, 0, 1, 0) > 0.5 && Math.abs(panOf(0, 8, 1, 0)) < 1e-9, 'the pan follows the side of the camera a vehicle is on');
  ok(sirenGain(5) === 1 && sirenGain(10) === 1 && Math.abs(sirenGain(40) - 0.25) < 1e-9, 'a siren is full inside 10 tiles and falls as 1/d past it');

  // the real layer against a fake engine with recordings: a street of cars, a ridden car, an ambulance on a call
  const e = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: okFetch }); e.start(); await tick();
  for (const id of ['pass-car', 'pass-lorry', 'pass-bike', 'pass-moped', 'bus-pass', 'footsteps', 'talk', 'bike-bell', 'siren-ambulance-loop', 'siren-fire-loop', 'siren-loop', 'horn']) e.sample(id);
  await tick();
  const st = new StreetLife(e, 5);
  const cam = { x: 0, z: 0, dist: 24, map: false, rightX: 1, rightZ: 0 };
  const agents = new Map<number, StreetAgent>();
  for (let k = 0; k < 8; k++) agents.set(10 + k, { rx: -6 + k * 0.3, rz: 2 + k, car: true, trav: true, kind: 3, cls: 0, fleet: 0, vx: 0.002, vy: 0 });
  agents.set(99, { rx: 0.5, rz: 0.5, car: true, trav: true, kind: 3, cls: 0, fleet: 0, vx: 0.002, vy: 0 }); // the ridden car, nearest of all
  const amb = { rx: 41, rz: 0, car: true, trav: true, kind: VehicleKind.Ambulance, cls: VehicleClass.Van, fleet: 0, emergency: true, vx: -0.004, vy: 0 } as StreetAgent;
  agents.set(77, amb);
  const step = (now: number, ridden = 99) => { st.begin(cam, ridden, 0.25); agents.forEach((a, id) => { const dx = a.rx - cam.x, dz = a.rz - cam.z; st.visit(a, id, dx, dz, dx * dx + dz * dz); }); st.end(now, 0.25, 1, 5); };
  step(1000);
  const p1 = e.shots.find((x) => x.why.startsWith('pass-by'));
  ok(!!p1 && !/#c99/.test(p1.why) && /#c10 /.test(p1.why), `the nearest car fires, never the ridden one (${p1?.why})`);
  ok(!!p1 && /pass-by: car #c10 at \d+ tiles in [\d.]+ s, [\d.]+ tiles\/s, left to right/.test(p1.why), 'a pass-by says what, which vehicle, how near, how fast and which way');
  ok(e.journal.some((j) => j.ev === 'start' && j.id === 'siren-ambulance-loop' && /siren: ambulance #c77 at 41 tiles/.test(j.why)) && st.following === 1, 'an ambulance on a call within 70 tiles starts its siren, and the journal says so');
  let rows = st.sirenRows(2000);
  ok(rows.length === 1 && /nearing/.test(rows[0].why) === false && rows[0].key === 'siren:77', 'the siren is a voice row of its own');
  amb.rx = 20; step(1250); rows = st.sirenRows(2000);
  ok(/siren: ambulance #c77 at 20 tiles, nearing/.test(rows[0].why) && rows[0].cents > 0, `nearing: louder and pitched up (${rows[0].why.slice(0, 80)}, ${rows[0].cents.toFixed(0)} cents)`);
  const near = rows[0].db;
  amb.rx = 5; amb.rz = -2; step(1500); rows = st.sirenRows(2000);
  ok(rows[0].db > near && /pan -?0\.\d\d/.test(rows[0].why), 'nearer is louder, panned from its side');
  amb.rx = 15; step(1750); rows = st.sirenRows(2000);
  ok(/going away/.test(rows[0].why) && rows[0].cents < 0, 'going away: pitched down');
  amb.emergency = false; step(2000);
  ok(st.following === 0 && e.journal.some((j) => j.ev === 'stop' && j.id === 'siren-ambulance-loop' && /flag dropped/.test(j.why)), 'the flag dropping stops the siren with a fade, and says why');
  amb.emergency = true; amb.rx = 50; step(6100); amb.rx = 60; step(6350);
  ok(st.following === 1, 'a siren starts again when its vehicle is back on a call (no sooner than 4 s after the last siren started)');
  amb.rx = 80; step(6600);
  ok(st.following === 0 && e.journal.some((j) => j.ev === 'stop' && /left the 70-tile circle/.test(j.why)), 'a siren that leaves the circle stops');
  amb.rx = 30; amb.vx = 0; step(11000); step(11250);
  ok(st.following === 1, 'an ambulance on a call, standing, still sounds at first');
  for (let ms = 11500; ms < 15000; ms += 250) step(ms);
  ok(st.following === 0 && e.journal.some((j) => j.ev === 'stop' && /it arrived \(standing still 3 s/.test(j.why)), 'standing still 3 s it has arrived: the siren stops (the flag stays on)');
  amb.rx = 25; amb.vx = -0.003; step(19500);
  ok(st.following === 1, 'and moving off again it sounds again');
  agents.delete(77);
  for (let k = 0; k < 4; k++) agents.set(200 + k, { rx: 10 + k * 10, rz: 0, car: true, trav: true, kind: VehicleKind.FireEngine, cls: VehicleClass.Truck, fleet: 0, emergency: true });
  let first3 = 0;
  for (let ms = 24000; ms < 40000; ms += 250) { step(ms); if (ms === 24250) first3 = st.following; }
  ok(first3 === 1 && st.following === STREET.sirenMax, `at most ${STREET.sirenMax} sirens at once, the nearest, one new one every 4 s at most (${first3} at first)`);
  step(40250, -1); // no ride: car 99 may now fire
  st.begin({ ...cam, map: true }, -1, 0.25); agents.forEach((a, id) => st.visit(a, id, a.rx, a.rz, a.rx * a.rx + a.rz * a.rz)); st.end(40500, 0.25, 1, 5);
  ok(st.following === 0, 'the map view stops the sirens');
  ok(/pass-bys \d+ in the last minute \(radius 0 tiles: zoomed out, none\), sirens following 0, walkers close 0/.test(st.text(40600)), `the readout's street line (${st.text(40600)})`);
  // walkers: footsteps from the count close in, one voice a side (a fresh engine: the one above holds voices on real-time timers)
  const ew = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: okFetch }); ew.start(); await tick(); ew.sample('footsteps'); ew.sample('talk'); await tick();
  const w = new StreetLife(ew, 9);
  const walkers = Array.from({ length: 6 }, (_, k) => ({ rx: -3 + k * 0.2, rz: 1, car: false, trav: true } as StreetAgent));
  let steps = 0;
  for (let ms = 10000; ms < 70000; ms += 250) {
    w.begin(cam, -1, 0.25); walkers.forEach((a, k) => w.visit(a, 500 + k, a.rx, a.rz, a.rx * a.rx + a.rz * a.rz)); const before = ew.journal.length + (ew.journal.at(-1)?.n ?? 1); ew.active = 0; w.end(ms, 0.25, 1, 6); if (ew.journal.length + (ew.journal.at(-1)?.n ?? 1) !== before && ew.journal.at(-1)?.id === 'footsteps') steps++;
  }
  ok(steps >= 8 && steps <= 22 && w.walkersClose === 6, `six walkers on one side: footsteps steady, one voice at a time (${steps} in a minute)`);
  const one = new StreetLife(ew, 11); let odd = 0;
  for (let ms = 100000; ms < 400000; ms += 250) { one.begin(cam, -1, 0.25); one.visit({ rx: 2, rz: 1, car: false, trav: true }, 900, 2, 1, 5); ew.active = 0; const n0 = ew.shots.length, l0 = ew.shots.at(-1); one.end(ms, 0.25, 1, 1); if (ew.shots.length !== n0 || ew.shots.at(-1) !== l0) odd++; }
  ok(odd >= 5 && odd < 40, `one walker: the odd step (${odd} in five minutes)`);
  e.muted = true; const ms0 = e.shots.length, j0 = e.journal.length; step(400000, -1); ok(e.shots.length === ms0 && e.journal.length === j0, 'a muted engine starts nothing on the street');
  e.muted = false;
  // the cost: the street's visits and its end with 2,000 agents round the camera
  const many = new Map<number, StreetAgent>();
  for (let i = 0; i < 2000; i++) many.set(i, { rx: (i % 50) - 25 + 0.3, rz: Math.floor(i / 50) - 20 + 0.6, car: i % 3 === 0, trav: true, kind: 3, cls: i % 4, fleet: i % 7 === 0 ? FleetKind.Bicycle : 0, vx: 0.002, vy: 0.001, emergency: i === 600 });
  const cityS: AmbSources = { hour: () => 12, camera: () => cam, tileAt: () => 0, kindIdAt: () => 0, agents: () => many.values(), eachAgent: (f) => many.forEach(f) };
  const big = new StreetLife(e, 13), scn = newScan();
  const vis = (a: StreetAgent, id: number, dx: number, dz: number, d2: number) => big.visit(a, id, dx, dz, d2);
  const median = (f: () => void) => { const xs: number[] = []; for (let i = 0; i < 400; i++) { const t0 = performance.now(); f(); xs.push(performance.now() - t0); } return xs.sort((a, b) => a - b)[200]; };
  let clock = 500000;
  for (let i = 0; i < 50; i++) { big.begin(cam, -1, 0.25); scanAround(cityS, 0, 0, 24, scn, vis); big.end(clock += 250, 0.25, 1, 10); } // warm
  // the street's own work: every agent handed to visit (the scan's walk does this in the real tick) and the end of the tick
  const streetOnly = median(() => { big.begin(cam, -1, 0.25); many.forEach((a, id) => { const dx = a.rx - cam.x, dz = a.rz - cam.z; big.visit(a, id, dx, dz, dx * dx + dz * dz); }); big.end(clock += 250, 0.25, 1, 10); });
  const withSt = median(() => { big.begin(cam, -1, 0.25); scanAround(cityS, 0, 0, 24, scn, vis); big.end(clock += 250, 0.25, 1, 10); });
  const without = median(() => scanAround(cityS, 0, 0, 24, scn));
  ok(streetOnly < 0.1, `the street costs ${streetOnly.toFixed(3)} ms a tick with 2,000 agents, walk included (under 0.1)`);
  console.log(`     (street cost, medians of 400: the street alone with its own walk ${streetOnly.toFixed(4)} ms; the scan alone ${without.toFixed(4)} ms, the scan with the street ${withSt.toFixed(4)} ms)`);
  // the knees
  type Sc = ReturnType<typeof newScan>;
  const stt = (o: Partial<Sc>): Sc => ({ ...newScan(), road: 0.3, ...o });
  const tr = (sc: Sc, d = 24) => mixFor(sc, d, 12, false, newMix()).traffic.level / CEILS.traffic;
  ok(tr(stt({ res: 0.18, cars: 10 })) >= 0.25 && tr(stt({ com: 0.18, cars: 10 })) >= 0.25, `10 cars on a street give the traffic bed a quarter of its ceiling or more (homes ${tr(stt({ res: 0.18, cars: 10 })).toFixed(2)}, shops ${tr(stt({ com: 0.18, cars: 10 })).toFixed(2)})`);
  ok(carKnee(24) === 15 && carKnee(200) === 45, 'the traffic knee: 15 cars in the street-zoom circle, the old 45 from far off (so the far view is as it was)');
  const cr = (sc: Sc) => mixFor(sc, 24, 12, false, newMix()).crowd.level / CEILS.crowd;
  const shop20 = cr(stt({ com: 0.18, walkers: 20 })), terr5 = cr(stt({ res: 0.18, walkers: 5 }));
  ok(shop20 > 0.4 && shop20 < 0.6 && terr5 > 0.05 && terr5 < 0.15, `the crowd knee: 20 walkers in a shopping street are about half the bed (${shop20.toFixed(2)}), 5 on a terrace about a tenth (${terr5.toFixed(2)})`);
  ok(activityAt(2) === 0.4 && activityAt(12) === 1 && activityAt(6.5) > 0.4 && activityAt(6.5) < 1, 'the night floor is 0.4, the day 1, the shape between kept');
  ok(VOICES['pass-car'].takes!.length === 3 && ['pass-lorry', 'pass-moped', 'pass-bike', 'talk', ...Object.values(SIREN_VOICE)].every((v) => (VOICES[v]?.takes?.length ?? 0) >= 1), 'every street-life voice has its recordings (three car takes)');
}

console.log(fails ? `\n${fails} FAILED` : '\naudio check passed');
process.exit(fails ? 1 : 0);
