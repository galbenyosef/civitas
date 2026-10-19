import { Zone, TICKS_PER_HOUR } from '@msimcity/shared';
/**
 * Local-mode seam check (docs/local-mode.md, phases A and B): bundles local/core.ts for the browser (esbuild, platform
 * browser) and fails on any Node import or bare `process` use, then imports that bundle and drives a game over a
 * MessageChannel: connect, hello, welcome, a subscription, a few ticks of stats, a disconnect and a reconnect, and a
 * save round trip through the snapshot functions. No `ws`, no `fs` in the game.
 *
 *   npx tsx packages/server/src/local/check.ts
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as Core from './core';
import type * as Host from '../../../client/src/local/host';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };

// ---- 1. the worker graph bundles for a browser -------------------------------------------
const client = join(here, '../../../client/src/local');
/** bundle for a browser and check it: no Node module, no bare process.*, no ws or require */
async function browserBundle(what: string, opts: Parameters<typeof build>[0]) {
  const out = await build({ bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent', minify: false, ...opts })
    .catch((e: { errors?: { text: string }[] }) => { console.log((e.errors ?? []).map((x) => `  ${x.text}`).join('\n')); return null; });
  ok(out, `${what} bundles for the browser with no Node modules`);
  if (!out) process.exit(1);
  const code = out.outputFiles![0].text;
  const bare = [...code.matchAll(/(?<![\w$?.])process\.(\w+)/g)].map((m) => m[0]);
  ok(bare.length === 0, `no bare process.* in ${what}${bare.length ? `: ${[...new Set(bare)].join(', ')}` : ''}`);
  ok(!/from ["'](ws|node:[\w/]+)["']|require\(/.test(code), `no ws, node: or require in ${what}`);
  console.log(`     ${what}: ${(code.length / 1024).toFixed(0)} KB unminified`);
  return code;
}
const code = await browserBundle('local/core.ts', { entryPoints: [join(here, 'core.ts')] });
// the worker as Vite ships it (client/src/local/worker.ts: the host, IndexedDB saves and this core)
await browserBundle('the local-mode worker', { entryPoints: [join(client, 'worker.ts')] });
// the host and the core in one bundle (one World class), driven below with an in-memory store
const hostCode = await browserBundle('local/host.ts', {
  stdin: { contents: `export * from './host'; export { worldHash, worldFromSnapshot, snapshotOf } from '../../../server/src/local/core';`, resolveDir: client, loader: 'ts' },
});

// ---- 2. drive the bundled game over a MessageChannel --------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'civitas-local-'));
const file = join(dir, 'core.mjs');
writeFileSync(file, code);
const core = (await import(pathToFileURL(file).href)) as typeof Core;
writeFileSync(join(dir, 'host.mjs'), hostCode);
const hostMod = (await import(pathToFileURL(join(dir, 'host.mjs')).href)) as typeof Host & Pick<typeof Core, 'worldHash' | 'worldFromSnapshot' | 'snapshotOf'>;
rmSync(dir, { recursive: true, force: true });

const world = new core.World(4242);
core.seedCommons(world, 0);
const { port1, port2 } = new MessageChannel();
const game = core.createGame(world, new core.PortSource(port1 as unknown as Core.PortLike), { devTools: false, sandbox: false });

const got: Record<string, number> = {};
const ctl: string[] = [];
let welcome: { you?: string } | null = null;
port2.addEventListener('message', (ev) => {
  const d = (ev as MessageEvent).data;
  if (typeof d === 'string') { const m = JSON.parse(d); got[m.t] = (got[m.t] ?? 0) + 1; if (m.t === 'welcome') welcome = m; }
  else ctl.push(d.ctl);
});
port2.start();
const settle = () => new Promise<void>((r) => setTimeout(r, 20));
const send = (m: object) => port2.postMessage(JSON.stringify(m));

port2.postMessage({ ctl: 'connect' });
await settle();
ok(ctl[0] === 'ready', 'connect is answered with ready');
ok(game.net.connections === 1, 'Net has the connection');
send({ t: 'hello', name: 'local' });
await settle();
ok(welcome && (welcome as { you?: string }).you === 'local', 'hello gets a welcome for the mayor');
send({ t: 'sub', chunks: [[0, 0], [-1, 0], [0, -1], [-1, -1]] });
await settle();
ok((got.chunk ?? 0) > 0, `sub sends chunks (${got.chunk ?? 0})`);
const day0 = world.tick;
for (let i = 0; i < 20; i++) { game.loop(); await settle(); }
ok(world.tick - day0 === 20, `20 loops ran 20 ticks (${world.tick - day0})`);
ok((got.stats ?? 0) >= 3, `stats arrive every 5 ticks (${got.stats ?? 0})`);
console.log(`     messages ${JSON.stringify(got)}`);

port2.postMessage({ ctl: 'close' });
await settle();
ok(game.net.connections === 0, 'close from the client drops the connection');
port2.postMessage({ ctl: 'connect' });
await settle();
ok(ctl.filter((c) => c === 'ready').length === 2 && game.net.connections === 1, 'a second connect reconnects');
game.net.accepting = false;
port2.postMessage({ ctl: 'connect' });
await settle();
ok(ctl.at(-1) === 'close' && game.net.connections === 0, 'a connect while not accepting is closed (the 1013 "starting" path)');

// ---- 3. a save round trip through the pure snapshot functions -----------------------------
const snap = JSON.parse(JSON.stringify(core.snapshotOf(world)));
const back = core.worldFromSnapshot(snap);
ok(back && core.worldHash(back) === core.worldHash(world) && back.citizens.size === world.citizens.size && back.parcels.size === world.parcels.size,
  `snapshot round trip keeps the world (hash ${core.worldHash(world)}, ${world.citizens.size} citizens, ${world.parcels.size} parcels)`);
ok(core.worldFromSnapshot({ ...snap, version: 999 }) === null, 'an unreadable version is refused, not loaded');

port1.close(); port2.close();

// ---- 4. the worker host (client/src/local/host.ts): clock, pause, speed, saves, export, import, new game ---------------------
{
  const H = hostMod;
  const saves = new Map<string, { meta: Host.SaveMeta; data: Uint8Array }>();
  const store: Host.SaveStore = {
    put: async (meta, data) => { saves.set(meta.slot, { meta: { ...meta }, data: data.slice() }); },
    get: async (slot) => saves.get(slot)?.data.slice() ?? null,
    list: async () => [...saves.values()].map((s) => ({ ...s.meta })),
    remove: async (slot) => { saves.delete(slot); },
  };
  const { port1: hp, port2: cp } = new MessageChannel();
  const frames: { t: string; rate?: number; you?: string; msg?: string }[] = [];
  const events: { ctl: string; [k: string]: unknown }[] = [];
  const waiting = new Map<number, (r: { ok: boolean; error?: string; [k: string]: unknown }) => void>();
  cp.addEventListener('message', (ev) => {
    const d = (ev as MessageEvent).data;
    if (typeof d === 'string') { frames.push(JSON.parse(d)); return; }
    if (d.ctl === 'reply') { waiting.get(d.id)?.(d); waiting.delete(d.id); } else events.push(d);
  });
  cp.start();
  let seq = 0;
  const ask = (ctl: string, args: Record<string, unknown> = {}) => new Promise<{ ok: boolean; error?: string; [k: string]: unknown }>((r) => {
    const id = ++seq; waiting.set(id, r); cp.postMessage({ ctl, id, ...args });
  });
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const hello = async () => { cp.postMessage({ ctl: 'connect' }); cp.postMessage(JSON.stringify({ t: 'hello', name: 'local' })); await wait(30); };

  // connect and hello before the game is up: the Gate holds them
  const gate = new H.Gate(hp as unknown as Core.PortLike);
  const host = new H.LocalHost(gate, store, { devTools: false, autosaveMs: 0 });
  cp.postMessage({ ctl: 'init' });
  await hello();
  await host.boot();
  gate.open();
  await wait(30);
  ok(frames.some((f) => f.t === 'welcome' && f.you === 'local'), 'host: a hello sent before boot is welcomed once the game is up');
  const w0 = host.game.world.tick;
  await wait(1050);
  const ran = host.game.world.tick - w0;
  ok(ran >= 4 && ran <= 6, `host: the clock runs 5 ticks a second at 1× (${ran} in 1.05 s)`);
  console.log(`     fresh world: tick avg ${host.game.tickWin.summary()?.avg.toFixed(2)} ms`);

  await ask('speed', { speed: 4 });
  ok(host.game.world.tick % 4 === 0 && frames.at(-1)?.t === 'stats' && frames.at(-1)?.rate === 4, 'host: 4× lines the tick up and sends stats with rate 4 at once');
  const w1 = host.game.world.tick;
  await wait(1050);
  const fast = host.game.world.tick - w1;
  ok(fast >= 16 && fast <= 24, `host: 4× runs 20 ticks a second (${fast})`);
  const statsAt4 = frames.filter((f) => f.t === 'stats').length;
  await wait(1050);
  ok(frames.filter((f) => f.t === 'stats').length - statsAt4 >= 1, 'host: stats still arrive at 4×, once a second as at 1× (every-5-tick messages line up)');
  await ask('speed', { speed: 1 });

  await ask('pause', { paused: true });
  const statsP = frames.filter((f) => f.t === 'stats').at(-1);
  const w2 = host.game.world.tick;
  await wait(500);
  ok(statsP?.rate === 0 && host.game.world.tick === w2, 'host: pause stops the clock and tells the client (rate 0)');
  await ask('pause', { paused: false });
  ok(frames.filter((f) => f.t === 'stats').at(-1)?.rate === undefined, 'host: resume sends rate-less stats (1×, as online)');

  const s1 = await ask('save'), s2 = await ask('save'), s3 = await ask('save', { slot: 'mine', label: 'Mine' });
  const metas = (await ask('listSaves')).saves as Host.SaveMeta[];
  ok(s1.ok && s2.ok && s3.ok && metas.map((m) => m.slot).sort().join() === 'auto-1,auto-2,mine', `host: autosaves alternate between two slots, plus a named one (${metas.map((m) => m.slot)})`);
  const mineHash = H.worldHash(H.worldFromSnapshot(JSON.parse(new TextDecoder().decode(await H.gunzip(saves.get('mine')!.data))))!);
  ok(mineHash === H.worldHash(host.game.world) && saves.get('mine')!.data[0] === 0x1f, `host: a save is gzipped world.json (${(saves.get('mine')!.data.length / 1024).toFixed(0)} KB) and holds the world`);

  const ex = await ask('export');
  const exBytes = new Uint8Array(ex.bytes as ArrayBuffer);
  const exSnap = JSON.parse(new TextDecoder().decode(await H.gunzip(exBytes)));
  ok(ex.ok && exBytes[0] === 0x1f && core.worldHash(core.worldFromSnapshot(exSnap)!) === H.worldHash(host.game.world), 'host: export is world.json gzipped (opens with the server\'s snapshot reader)');
  const plain = await ask('export', { gzip: false });
  ok(new TextDecoder().decode(new Uint8Array(plain.bytes as ArrayBuffer)).startsWith('{"version":'), 'host: export can be plain world.json');

  for (let i = 0; i < 10; i++) host.game.step(); // move on, so importing the export goes back
  const beforeImport = events.length;
  const imp = await ask('import', { bytes: ex.bytes });
  await wait(30);
  ok(imp.ok && H.worldHash(host.game.world) === core.worldHash(core.worldFromSnapshot(exSnap)!) && events.slice(beforeImport).some((e) => e.ctl === 'switched'),
    'host: import replaces the game and says so (switched)');
  ok(frames.length > 0 && host.game.net.connections === 0, 'host: the old game\'s connection was closed (the client reconnects or reloads)');
  await hello();
  ok(host.game.net.connections === 1 && frames.at(-1) !== undefined, 'host: the client reconnects to the imported game');
  const kept = await ask('import', { bytes: plain.bytes, slot: 'plain', label: 'Plain' });
  ok(kept.ok && saves.has('plain') && saves.get('plain')!.data[0] === 0x1f, 'host: importing into a slot keeps it as a named (gzipped) save');
  const bad = await ask('import', { bytes: new TextEncoder().encode('not a save').buffer });
  const newer = await ask('import', { bytes: new TextEncoder().encode(JSON.stringify({ ...exSnap, version: 999 })).buffer });
  ok(!bad.ok && !newer.ok && /v999/.test(newer.error ?? ''), `host: a bad or too-new file is refused, the game kept ("${newer.error}")`);

  const seedBefore = host.game.world.seed;
  const ng = await ask('newGame', { seed: 777 });
  const fw = host.game.world;
  ok(ng.ok && fw.seed === 777 && fw.seed !== seedBefore && fw.start === 'frontier' && !fw.players.has('sys') && !!fw.charter && fw.builtOf(Zone.Hub).length === 1 && fw.tick === 6 * TICKS_PER_HOUR,
    'host: new game is a frontier by default (no Commons, a gate, a charter to give, dawn)');
  const ngc = await ask('newGame', { seed: 778, start: 'commons' });
  ok(ngc.ok && host.game.world.seed === 778 && host.game.world.players.has('sys') && host.game.world.start === 'commons', 'host: new game beside the Commons on request');
  const ld = await ask('load', { slot: 'mine' });
  ok(ld.ok && H.worldHash(host.game.world) === mineHash, 'host: load brings a named save back');
  const ren = await ask('rename', { slot: 'mine', label: 'Mine, renamed' }), renAuto = await ask('rename', { slot: 'auto-1', label: 'x' });
  ok(ren.ok && saves.get('mine')!.meta.label === 'Mine, renamed' && saves.get('mine')!.meta.day === (s3.meta as Host.SaveMeta).day && saves.get('mine')!.data[0] === 0x1f && !renAuto.ok, 'host: rename changes a named save\'s label only, not an autosave\'s');
  const del = await ask('deleteSave', { slot: 'plain' });
  ok(del.ok && !saves.has('plain'), 'host: delete removes a save');
  const lastHash = H.worldHash(host.game.world);
  host.stop();

  // a reload: a new host on the same store resumes the newest autosave (load autosaved the loaded game)
  const { port1: hp2 } = new MessageChannel();
  const gate2 = new H.Gate(hp2 as unknown as Core.PortLike);
  const host2 = new H.LocalHost(gate2, store, { devTools: false, autosaveMs: 0 });
  await host2.boot();
  ok(H.worldHash(host2.game.world) === lastHash, 'host: a reload resumes the newest autosave');
  host2.stop();
  hp2.close(); hp.close(); cp.close();
}

console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
