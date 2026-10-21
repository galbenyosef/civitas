// Sound: the engine, its controls and its voices against a fake AudioContext (client/src/audio). Run: npx tsx packages/client/scripts/audio-check.ts
import { AudioEngine, AUDIO_KEY, MAX_VOICES, HELD_RESERVE, DEFAULT_VOLUME, clampVolume } from '../src/audio/engine';
import { bindMuteKey } from '../src/audio/controls';
import { VOICES, voiceFile } from '../src/audio/manifest';
import { fire, makeBed, makeRide, ringBell, type EventId, type RideKind } from '../src/audio/voices';
import { Ambience, mixFor, newScan, birdRate, owlRate, scanAround, type AmbSources } from '../src/audio/ambience';
import { FpvSound, type RideNow } from '../src/audio/fpv';

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
{
  const defs = Object.values(VOICES);
  ok(defs.every((d) => d.id in VOICES && ['ambience', 'vehicles', 'ui'].includes(d.bus) && Object.keys(d.params).length > 0 && d.made && d.driven), `all ${defs.length} manifest rows have an id, bus, recipe, driver and numbers`);
  ok(defs.every((d) => d.file === undefined), 'no recording ships: every voice is synthesised');
  ok(voiceFile('traffic') === 'audio/traffic.opus', 'the conventional recording path');
  VOICES.traffic.file = voiceFile('traffic'); VOICES.wind.file = voiceFile('wind');
  const asked: string[] = [];
  const e = new AudioEngine({ storage: mem(), create: fakeCtx, fetch: async (u) => { asked.push(u); if (u.includes('wind')) throw new Error('404'); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; } });
  e.start(); await tick();
  ok(asked.length === 2 && e.sample('traffic') !== null, 'a voice with a file is fetched and decoded');
  ok(e.sample('wind') === null && e.ready, 'a missing recording falls back to synthesis and does not block start');
  delete VOICES.traffic.file; delete VOICES.wind.file;
}

// ---- every voice builds against the fake context, and varies per instance ------------------------------------------
{
  const e = new AudioEngine({ storage: mem(), create: fakeCtx }); e.start(); await tick();
  const events: EventId[] = ['bird', 'owl', 'bell', 'bell-deep', 'horn', 'beep', 'ui-click', 'ui-place', 'ui-refuse', 'ui-undo', 'fx-hiss', 'fx-stopbell', 'fx-chime', 'fx-joint'];
  let threw = '';
  const record = (f: () => void) => { log.length = 0; try { f(); } catch (err) { threw += `${(err as Error).message} `; } return log.join('|'); };
  const sigs = new Map<string, string[]>();
  for (const id of events) {
    sigs.set(id, [1, 2, 3, 4].map((seed) => record(() => { if (id === 'bell' || id === 'bell-deep') ringBell(e, id === 'bell-deep', seed, 3); else fire(e, id, { seed }); })));
    e.active = 0;
  }
  ok(threw === '', `every event voice builds (${threw || 'no errors'})`);
  const same = events.filter((id) => new Set(sigs.get(id)).size < 4);
  ok(same.length === 0, `every event differs between instances (${same.join(', ') || 'all vary'})`);
  const beds = ['traffic', 'wind', 'crowd', 'industry', 'water'] as const;
  for (const id of beds) {
    const s = [1, 2, 3].map((seed) => record(() => { const b = makeBed(e, id, seed); b?.tune(0.5, 0.5, 1); }));
    ok(new Set(s).size === 3, `${id} bed: start point, rate and modulation differ per instance`);
    e.active = 0;
  }
  for (const k of ['car', 'truck', 'bus', 'train', 'metro', 'boat', 'plane', 'heli'] as RideKind[]) {
    const s = [1, 2].map((seed) => record(() => { const r = makeRide(e, k, seed); r?.set(0.6); }));
    ok(threw === '' && s[0].length > 50, `${k} ride builds and takes a speed`);
    e.active = 0;
  }
  ok(threw === '', `no voice threw (${threw || 'ok'})`);
  // a bus and a train must not be the same recipe
  const b2 = record(() => makeRide(e, 'bus', 5)), t2 = record(() => makeRide(e, 'train', 5));
  ok(/type=sawtooth/.test(b2) && !/type=sawtooth/.test(t2) && /type=triangle/.test(t2), 'a bus is saws (a diesel); a train is triangles (a whine)');
  e.muted = true; log.length = 0; fire(e, 'bird', { seed: 1 }); ok(log.length === 0, 'a muted engine builds nothing');
}

// ---- the mix follows the city ---------------------------------------------------------------------------------------
{
  const quiet = newScan(), busy = { ...newScan(), cars: 60, walkers: 40, com: 0.3, road: 0.3 };
  const a = mixFor(quiet, 40, 12, false), b = mixFor(busy, 40, 12, false);
  const q = a.traffic.level, bt = b.traffic.level;
  ok(bt > q + 0.2 && b.traffic.tone > a.traffic.tone, 'traffic gets louder and brighter with the cars drawn');
  const near = mixFor(busy, 30, 12, false).wind.level, far = mixFor(busy, 300, 12, false).wind.level;
  ok(far > near * 3, 'wind rises with the camera height');
  ok(mixFor(busy, 40, 3, false).crowd.level < mixFor(busy, 40, 12, false).crowd.level * 0.4, 'the crowd murmur falls at night');
  ok(mixFor(busy, 40, 12, true).crowd.level === 0 && mixFor(busy, 40, 12, true).wind.level <= 0.2, 'the map view keeps only a thin wind');
  const park = { ...newScan(), park: 0.4, res: 0.2 };
  ok(birdRate(park, 5.5, 40) > birdRate(park, 12, 40) * 2, 'the dawn chorus (04:30 to 07:00) is busier than midday');
  ok(birdRate(park, 12, 40) > birdRate(newScan(), 12, 40), 'birds follow parks and homes');
  ok(birdRate(park, 23, 40) === 0 && birdRate(park, 12, 400) === 0, 'no birds at night or from far away');
  ok(owlRate(park, 23, 40) > 0 && owlRate(park, 12, 40) === 0 && owlRate(newScan(), 23, 40) === 0, 'owls call at night in parks and homes only');
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

console.log(fails ? `\n${fails} FAILED` : '\naudio check passed');
process.exit(fails ? 1 : 0);
