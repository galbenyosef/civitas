// Television in the first-person rooms (docs/media.md sections 7-8, render/tv.ts, render/interiors.ts): the channel
// schedule is deterministic, a lounge's set adds no draw calls and almost no CPU when it is on and not live, the
// channel layer is drawn per channel only when it changes, and the live feed never runs without a helicopter over a story.
// Run: npx tsx packages/client/scripts/tv-check.ts
import { CIVITAS_CHANNELS, playerChannel, programmeAt, homeChannel, tvOnAt, TICKS_PER_DAY, TICKS_PER_HOUR, type CitizenInfo, type TvChannel } from '@msimcity/shared';
import { Mesh, InstancedMesh, Color, type Object3D } from 'three';

// a canvas that draws nothing: the layer's drawing calls are counted, not rendered
let drawCalls = 0;
const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 6 }) : typeof k === 'string' && /^(fill|clear|stroke)/.test(k) ? () => { drawCalls++; } : () => {}), set: () => true });
Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } });
const { Interior, setTvSource, tvDebug, homeSeedOf } = await import('../src/render/interiors');
const { TvGuide } = await import('../src/render/tv');
const { ClientWorld } = await import('../src/world');

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// ---- the schedule ------------------------------------------------------------------------------
const chans: TvChannel[] = [...CIVITAS_CHANNELS, playerChannel('p1', 'Ada', 0x3388cc)];
{
  let same = true;
  for (const c of chans) for (let h = 0; h < 24 * 14; h++) for (const night of [false, true]) {
    // two moments in the same hour, before the forecast that closes a news hour
    const a = programmeAt(c, h * TICKS_PER_HOUR + 7, night), b = programmeAt(c, h * TICKS_PER_HOUR + 71, night);
    if (a.genre !== b.genre || a.title !== b.title || a.seed !== b.seed) same = false;
    if (JSON.stringify(programmeAt(c, h * TICKS_PER_HOUR + 7, night)) !== JSON.stringify(a)) same = false;
  }
  ok(same, 'the schedule is a pure function of the channel and the hour (the same programme all hour, the same on every call)');
  const at = (c: TvChannel, h: number, night = false, day = 3) => programmeAt(c, day * TICKS_PER_DAY + h * TICKS_PER_HOUR + 5, night).genre;
  ok(at(chans[0], 18) === 'news' && at(chans[2], 18) === 'news', 'the news at 18:00 on Civitas 1 and on a player\'s channel');
  ok(programmeAt(chans[0], 3 * TICKS_PER_DAY + 18.9 * TICKS_PER_HOUR, false).genre === 'weather', 'the forecast closes the news hour');
  ok([0, 1, 2].every((i) => ['teletext', 'testcard'].includes(at(chans[i], 3))), 'teletext or the test card at 03:00 on every channel');
  ok(at(chans[0], 15) === 'cartoons' && at(chans[1], 16) === 'cartoons', 'cartoons in the afternoon');
  let match = 0, noMatch = 0;
  for (let d = 0; d < 20; d++) for (const c of chans) { if (at(c, 20, true, d) === 'match') match++; if (at(c, 20, false, d) === 'match') noMatch++; }
  ok(match > 10 && noMatch === 0, `the match on stadium event nights only (${match} of 60 channel-nights carry it, none on other nights)`);
  const seeds = Array.from({ length: 400 }, (_, i) => i * 7919);
  const counts = chans.map((c) => seeds.filter((s) => homeChannel(s, 3 * TICKS_PER_DAY + 19 * TICKS_PER_HOUR, chans).id === c.id).length);
  ok(counts.every((n) => n > 20), `homes spread over the channels at 19:00 (${counts.join(', ')})`);
  ok(seeds.every((s) => homeChannel(s, 12345, chans) === homeChannel(s, 12345, chans)), 'a home\'s channel is deterministic');
}

// ---- a lounge with the set on and off ---------------------------------------------------------------
const world = new ClientWorld();
const guide = new TvGuide({ world, helis: { newsStates: [] } as never, tick: () => tick, setNewsFeed: () => {}, lowPreset: () => false });
let tick = 3 * TICKS_PER_DAY + 19.25 * TICKS_PER_HOUR;
const info = (hh: number): CitizenInfo => ({ id: 9_900_001, name: 'Check', role: 'citizen', mode: 'none', activity: 'at home, retired', status: 'idle', waitTicks: 0, home: { x: 3, y: 5, label: 'home', parcel: '' }, life: { age: 70, stage: 'retired', household: { id: hh, members: [] } } } as unknown as CitizenInfo);
let hh = 1;
while (!tvOnAt(homeSeedOf(info(hh)), 19.25, true)) hh++;
const ci = info(hh);
const room = new Interior({ room: 'lounge', seed: homeSeedOf(ci), key: 'check' }, ci, 19.25);
/** draw calls the room's scene makes: one per visible mesh (an instanced crowd is one) */
const calls = (o: Object3D): number => (o.visible ? (o instanceof Mesh || o instanceof InstancedMesh ? 1 : 0) + o.children.reduce((a, c) => a + calls(c), 0) : 0);
const sky = new Color(0x1a2240);
const frames = (n: number) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { tick += 0.08; room.update(1000 + i * 16.7, 1 / 60, 19.25, sky); } return (performance.now() - t0) / n; };

setTvSource(null); tvDebug.force = 0;
frames(200);
const callsOff = calls(room.scene);
const msOff = Math.min(frames(1500), frames(1500));
setTvSource(guide); tvDebug.force = 1;
frames(200);
const callsOn = calls(room.scene);
drawCalls = 0;
const msOn = Math.min(frames(1500), frames(1500));
const tv = room.tvs[0];
ok(!!tv && tv.on === 1 && tv.mat.uniforms.uGenre.value > 0 && tv.mat.uniforms.uGenre.value !== 11, `the set shows its channel's programme, not live (genre ${tv?.mat.uniforms.uGenre.value}: ${tv?.label})`);
ok(callsOn - callsOff <= 2, `a lounge with the TV on draws ${callsOn} calls, ${callsOn - callsOff} more than with it off (at most 2)`);
ok(msOn - msOff < 0.2, `the set on costs ${(msOn - msOff).toFixed(4)} ms a frame of CPU over off (${msOn.toFixed(4)} vs ${msOff.toFixed(4)}; under 0.2)`);
ok(guide.feed.renders === 0 && guide.feed.heli === null, 'no live feed without a helicopter over a story');

// the channel layer: per channel, redrawn only when it changes (a teletext page every 40 ticks)
{
  // the set hops channel now and then (homeChannel): one layer per channel it showed, however many frames
  const shown = new Set<string>();
  for (let t = 3 * TICKS_PER_DAY + 19.25 * TICKS_PER_HOUR; t <= tick; t += 1) shown.add(guide.channelOf(homeSeedOf(ci), true, t).id);
  const st0 = guide.stats();
  ok(st0.length === shown.size, `one graphics layer per channel shown (${st0.map((s) => s.id).join(', ')} for ${[...shown].join(', ')}), not per set or frame`);
  // two sets on the same channel share one layer
  const room2 = new Interior({ room: 'lounge', seed: homeSeedOf(ci), key: 'check2' }, ci, 19.25);
  room2.update(1000, 1 / 60, 19.25, sky);
  ok(room2.tvs[0].mat.uniforms.uGfx.value === tv.mat.uniforms.uGfx.value, 'two sets on one channel share its layer\'s texture');
  room2.dispose();
  // an hour of teletext on Civitas 1: about one redraw a page
  const c1 = CIVITAS_CHANNELS[0];
  let t = 3 * TICKS_PER_DAY + 2 * TICKS_PER_HOUR;
  const before = guide.stats().find((s) => s.id === c1.id)?.draws ?? 0;
  for (let i = 0; i < 6000; i++, t += TICKS_PER_HOUR / 6000) (guide as unknown as { gfxOf: (c: TvChannel, s: unknown, t: number) => void }).gfxOf(c1, guide.show(c1, t), t);
  const draws = (guide.stats().find((s) => s.id === c1.id)?.draws ?? 0) - before;
  ok(programmeAt(c1, t - 1, false).genre === 'teletext' && draws >= 2 && draws <= 4, `an hour of teletext redraws its page ${draws} times (a page every 40 ticks), not every frame (6000 frames)`);
}
room.dispose();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
