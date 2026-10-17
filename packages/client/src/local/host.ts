import { TICK_MS } from '@msimcity/shared';
import {
  World, seedCommons, createGame, PortSource, snapshotOf, worldFromSnapshot, readableVersion, SNAPSHOT_VERSION,
  type Game, type Conn, type ConnSource, type Control, type PortLike, type Snapshot,
} from '../../../server/src/local/core';

/**
 * The local-mode game host (docs/local-mode.md, phase C): what server/src/index.ts is to the online game, for a game in a
 * browser worker. It runs `createGame()` over a `PortSource` on a fixed-timestep clock with pause and 1×/2×/4× speed, and keeps
 * the city in a `SaveStore` (IndexedDB in the worker, local/idb.ts): an autosave every 30 s into two rolling slots, named slots,
 * export and import. A save is the server's world.json (snapshot.ts) gzipped, so a server world opens here and back.
 * Browser APIs only (no DOM): local/check.ts drives it in Node over a MessageChannel with an in-memory store.
 *
 * Control messages from the client (`{ ctl, id?, ... }`, answered `{ ctl: 'reply', id, ok, ... }` or `{ ..., ok: false, error }`):
 *   info · pause {paused} · speed {speed} · save {slot?, label?} (no slot: an autosave now) · listSaves · load {slot} ·
 *   deleteSave {slot} · rename {slot, label} · export {slot?, gzip?} → {bytes, day, gzip} · import {bytes, slot?, label?} (no slot: replace the game) ·
 *   newGame {seed?, sandbox?}
 * Events to the client: `{ctl:'state', paused, speed, sandbox}`, `{ctl:'saved', meta, ms}`, `{ctl:'error', msg}`, and
 * `{ctl:'switched'}` once another game replaced this one (its connections were closed; the page reloads or reconnects).
 */

/** One save in the store. `slot` is its key: 'auto-1' / 'auto-2' for the rolling autosaves, anything else is a named save. */
export interface SaveMeta {
  slot: string; label: string; savedAt: number;
  day: number; tick: number; citizens: number; seed: number;
  /** snapshot format (snapshot.ts SNAPSHOT_VERSION) */
  version: number;
  /** stored size (gzip when the browser has CompressionStream) */
  bytes: number;
  /** a sandbox game (all tech, unlimited funds, no onboarding): kept with the save so a reload resumes it the same way */
  sandbox: boolean;
}

/** Where saves live. local/idb.ts is the browser's; local/check.ts uses a Map. One `put` is atomic (meta and data together). */
export interface SaveStore {
  put(meta: SaveMeta, data: Uint8Array): Promise<void>;
  get(slot: string): Promise<Uint8Array | null>;
  list(): Promise<SaveMeta[]>;
  remove(slot: string): Promise<void>;
}

export const AUTO_SLOTS = ['auto-1', 'auto-2'] as const;
export const SPEEDS = [1, 2, 4] as const;
const AUTOSAVE_MS = 30_000;
/** loops run back to back when the worker fell behind (a GC pause, a slow save); the rest of a backlog is dropped */
const MAX_CATCHUP = 3;
/** the adaptive guard: over the last minute at 2× or 4×, a p95 loop above this drops the game to 1× */
const SLOW_P95_MS = TICK_MS * 0.75;

// ---- the save bytes: JSON of the snapshot, gzipped when the browser can ---------------------------------------

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
async function pipe(data: Uint8Array, through: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([data as unknown as ArrayBuffer]).stream().pipeThrough(through)).arrayBuffer());
}
export const gzip = (data: Uint8Array) => (typeof CompressionStream === 'function' ? pipe(data, new CompressionStream('gzip')) : Promise.resolve(data));
export async function gunzip(data: Uint8Array) {
  if (!isGzip(data)) return data;
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open gzipped saves');
  return pipe(data, new DecompressionStream('gzip'));
}
/** a view's own ArrayBuffer, to post */
const bufferOf = (b: Uint8Array) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer);
/** the world as a world.json, encoded now (the snapshot shares the live objects, so it must not wait for a tick) */
export const encodeWorld = (w: World) => new TextEncoder().encode(JSON.stringify(snapshotOf(w)));

/** A World from save or file bytes (gzipped or plain world.json), or a message saying why not. */
export async function decodeWorld(data: Uint8Array): Promise<{ world: World } | { error: string }> {
  let snap: Snapshot;
  try { snap = JSON.parse(new TextDecoder().decode(await gunzip(data))) as Snapshot; }
  catch { return { error: 'That is not a Civitas save (not gzip or JSON)' }; }
  if (!snap || typeof snap !== 'object' || !Array.isArray(snap.chunks)) return { error: 'That is not a Civitas save (no world in it)' };
  if (!readableVersion(snap.version)) return { error: `That save is format v${snap.version ?? '?'}; this version of Civitas reads v${SNAPSHOT_VERSION}` };
  try { const world = worldFromSnapshot(snap); return world ? { world } : { error: 'That save could not be read' }; }
  catch (e) { return { error: `That save could not be read: ${(e as Error).message}` }; }
}

/**
 * Holds messages back until the game is up: the client's `connect` and `hello` can arrive while the worker is still opening
 * IndexedDB and decoding the last save. PortSource listens here; `open()` replays the queue in order.
 */
export class Gate implements PortLike {
  private fns: ((ev: MessageEvent) => void)[] = [];
  private queue: MessageEvent[] | null = [];
  constructor(private endpoint: PortLike) {
    endpoint.addEventListener('message', (ev) => { if (this.queue) this.queue.push(ev as MessageEvent); else for (const fn of this.fns) fn(ev as MessageEvent); });
  }
  postMessage(m: unknown, transfer?: unknown[]) { this.endpoint.postMessage(m, transfer); }
  addEventListener(_type: 'message', fn: (ev: MessageEvent) => void) { this.fns.push(fn); }
  open() {
    const q = this.queue ?? [];
    this.queue = null;
    for (const ev of q) for (const fn of this.fns) fn(ev);
  }
}

export interface HostOptions {
  devTools: boolean;
  /** autosave period in ms (30 s); 0 turns autosave off */
  autosaveMs?: number;
}

export class LocalHost {
  game!: Game;
  paused = false;
  speed = 1;
  sandbox = false;
  /** the last save's timing: stringify (sync, stalls the sim) and the whole save */
  lastSave: { ms: number; totalMs: number; bytes: number; raw: number } | null = null;
  private source: PortSource;
  private conns = new Set<Conn>();
  /** the source Net sees: PortSource, plus the open connections (closed when another game replaces this one) */
  private tracked: ConnSource;
  private acc = 0;
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSaveAt = 0;
  private saving: Promise<unknown> = Promise.resolve();
  private busy = false;
  /** world.tick at the last save, and whether a client sent anything since (a paused game can still be built on) */
  private savedTick = -1;
  private touched = false;
  /** which autosave slot the next autosave overwrites: the older one */
  private nextAuto = 0;
  private loopsAtSpeed = 0;

  constructor(private endpoint: PortLike, private store: SaveStore | null, private opts: HostOptions) {
    this.source = new PortSource(endpoint);
    this.source.onControl = (m, reply) => void this.control(m, reply);
    this.tracked = {
      onConnection: (fn) => this.source.onConnection((c) => {
        this.conns.add(c);
        c.onClose(() => this.conns.delete(c));
        c.onMessage(() => { this.touched = true; });
        fn(c);
      }),
    };
  }

  /** Resume the newest readable autosave, or start a new game seeded like the server's (the Commons). Then run the clock. */
  async boot() {
    let resumed = false;
    if (this.store) {
      const autos = (await this.store.list().catch(() => [])).filter((m) => (AUTO_SLOTS as readonly string[]).includes(m.slot)).sort((a, b) => b.savedAt - a.savedAt);
      for (const meta of autos) {
        const data = await this.store.get(meta.slot).catch(() => null);
        const r = data ? await decodeWorld(data) : { error: 'missing' };
        if ('world' in r) {
          this.use(r.world, meta.sandbox);
          this.nextAuto = AUTO_SLOTS.indexOf(meta.slot as typeof AUTO_SLOTS[number]) ^ 1;
          this.savedTick = r.world.tick;
          console.log(`local: resumed ${meta.slot} (day ${meta.day}, ${meta.citizens} citizens, ${(meta.bytes / 1024).toFixed(0)} KB)`);
          resumed = true;
          break;
        }
        this.event({ ctl: 'error', msg: `The autosave from ${new Date(meta.savedAt).toLocaleString()} could not be read (${r.error}); trying the one before` });
      }
    }
    if (!resumed) this.fresh(undefined, false);
    this.lastSaveAt = performance.now();
    this.last = performance.now();
    this.schedule();
  }

  /** a new world like the server's first start: the seed and the Commons (index.ts) */
  private fresh(seed: number | undefined, sandbox: boolean) {
    const s = seed ?? Math.floor(Math.random() * 2 ** 31);
    const world = new World(s);
    seedCommons(world, 0);
    this.use(world, sandbox);
    console.log(`local: new world with seed ${s}${sandbox ? ' (sandbox)' : ''}`);
  }

  /** run this world from now on; any game before it is dropped and its clients told to reconnect */
  private use(world: World, sandbox: boolean) {
    for (const c of [...this.conns]) c.close(4001, 'switched');
    this.sandbox = sandbox;
    this.game = createGame(world, this.tracked, { devTools: this.opts.devTools, sandbox }, 1);
    this.savedTick = -1;
    this.applySpeed();
  }

  // ---- the clock ------------------------------------------------------------------------------------------------

  private schedule() { this.timer = setTimeout(() => this.run(), Math.max(0, TICK_MS - this.acc)); }

  private run() {
    const now = performance.now();
    if (!this.paused) {
      this.acc += now - this.last;
      for (let n = 0; this.acc >= TICK_MS && n < MAX_CATCHUP; n++) { this.game.loop(); this.acc -= TICK_MS; this.loopsAtSpeed++; }
      if (this.acc >= TICK_MS) this.acc = 0;
      this.guard();
    }
    this.last = now;
    const autosave = this.opts.autosaveMs ?? AUTOSAVE_MS;
    if (autosave > 0 && this.store && now - this.lastSaveAt >= autosave && !this.busy) {
      this.lastSaveAt = now;
      if (this.game.world.tick !== this.savedTick || this.touched) void this.save().catch(() => {});
    }
    this.schedule();
  }

  /** a city too big for this device at 2× or 4× drops to 1× after a minute of slow loops */
  private guard() {
    if (this.speed === 1 || this.loopsAtSpeed < 300 || this.loopsAtSpeed % 25) return;
    const s = this.game.tickWin.summary();
    if (!s || s.p95 <= SLOW_P95_MS) return;
    this.setSpeed(1);
    this.toast('info', `Your city is too big to run at that speed on this device (p95 ${Math.round(s.p95)} ms a step); back to 1×`);
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    this.acc = 0;
    this.last = performance.now();
    this.applySpeed();
  }

  setSpeed(speed: number) {
    if (!(SPEEDS as readonly number[]).includes(speed)) return;
    // flush()'s every-5 and every-10 tick messages (stats, lines, traffic) must still land with several ticks a loop: line the tick up first
    while (speed > 1 && this.game.world.tick % 4) this.game.step();
    this.speed = speed;
    this.loopsAtSpeed = 0;
    this.applySpeed();
  }

  private applySpeed() {
    this.game.steps = this.speed;
    this.game.net.rate = this.paused ? 0 : this.speed;
    this.game.net.sendStats(); // the client's clock (day/night, signals) follows at once
    this.event(this.state());
  }

  private state() { return { ctl: 'state', paused: this.paused, speed: this.speed, sandbox: this.sandbox }; }

  // ---- saves ----------------------------------------------------------------------------------------------------

  /** Save the running game: into the older autosave slot, or a named slot. Saves run one at a time. */
  save(slot?: string, label?: string): Promise<SaveMeta> {
    const run = this.saving.then(() => this.write(slot, label));
    this.saving = run.catch(() => {});
    return run;
  }

  private async write(slot?: string, label?: string): Promise<SaveMeta> {
    if (!this.store) throw new Error('This browser is not keeping saves (no IndexedDB); export the city to keep it');
    this.busy = true;
    try {
      const w = this.game.world, t0 = performance.now();
      const raw = encodeWorld(w);
      const ms = performance.now() - t0;
      const auto = !slot;
      const meta: SaveMeta = {
        slot: slot ?? AUTO_SLOTS[this.nextAuto], label: label ?? (auto ? 'Autosave' : slot!), savedAt: Date.now(),
        day: w.day, tick: w.tick, citizens: w.citizens.size, seed: w.seed, version: SNAPSHOT_VERSION, bytes: 0, sandbox: this.sandbox,
      };
      const touched = this.touched;
      this.touched = false;
      const data = await gzip(raw);
      meta.bytes = data.length;
      try { await this.store.put(meta, data); }
      catch (e) {
        this.touched ||= touched;
        const quota = (e as Error).name === 'QuotaExceededError';
        const msg = quota ? 'Saving failed: the browser is out of storage space for this site. Export the city to keep it.' : `Saving failed: ${(e as Error).message}`;
        this.toast('error', msg);
        this.event({ ctl: 'error', msg });
        throw e;
      }
      if (auto) { this.nextAuto ^= 1; this.savedTick = meta.tick; }
      this.lastSave = { ms, totalMs: performance.now() - t0, bytes: data.length, raw: raw.length };
      this.event({ ctl: 'saved', meta, ms: Math.round(ms), totalMs: Math.round(this.lastSave.totalMs) });
      return meta;
    } finally { this.busy = false; }
  }

  private async control(m: Control, reply: (m: unknown) => void) {
    const id = m.id;
    const ok = (data: object = {}) => reply({ ...data, ctl: 'reply', id, ok: true });
    const fail = (error: string) => reply({ ctl: 'reply', id, ok: false, error });
    try {
      switch (m.ctl) {
        case 'init': return; // the worker's own boot message (local/worker.ts)
        case 'info': return ok({ ...this.state(), day: this.game.world.day, citizens: this.game.world.citizens.size, persistent: !!this.store, lastSave: this.lastSave });
        case 'pause': this.setPaused(!!m.paused); return ok(this.state());
        case 'speed': this.setSpeed(Number(m.speed)); return ok(this.state());
        case 'save': {
          const slot = typeof m.slot === 'string' && m.slot ? m.slot : undefined;
          if (slot && (AUTO_SLOTS as readonly string[]).includes(slot)) return fail('That slot is for autosaves');
          return ok({ meta: await this.save(slot, typeof m.label === 'string' ? m.label : undefined) });
        }
        case 'listSaves': return ok({ saves: this.store ? (await this.store.list()).sort((a, b) => b.savedAt - a.savedAt) : [], persistent: !!this.store });
        case 'deleteSave': if (this.store) await this.store.remove(String(m.slot)); return ok();
        case 'rename': {
          const slot = String(m.slot), label = String(m.label ?? '').trim().slice(0, 60);
          if (!this.store || !label) return fail('Give the save a name');
          if ((AUTO_SLOTS as readonly string[]).includes(slot)) return fail('Autosaves keep their name');
          const meta = (await this.store.list()).find((s) => s.slot === slot), data = await this.store.get(slot);
          if (!meta || !data) return fail('That save is gone');
          await this.store.put({ ...meta, label }, data);
          return ok();
        }
        case 'load': {
          if (!this.store) return fail('No saves in this browser');
          const slot = String(m.slot);
          const meta = (await this.store.list()).find((s) => s.slot === slot);
          const data = await this.store.get(slot);
          if (!meta || !data) return fail('That save is gone');
          const r = await decodeWorld(data);
          if ('error' in r) return fail(r.error);
          await this.switchTo(() => this.use(r.world, meta.sandbox));
          return ok();
        }
        case 'export': {
          const plain = m.gzip === false;
          if (typeof m.slot === 'string' && m.slot) {
            const data = await this.store?.get(m.slot);
            if (!data) return fail('That save is gone');
            const bytes = plain ? await gunzip(data) : isGzip(data) ? data : await gzip(data);
            const meta = (await this.store!.list()).find((s) => s.slot === m.slot);
            return ok({ bytes: bufferOf(bytes), day: meta?.day ?? 0, gzip: !plain });
          }
          const raw = encodeWorld(this.game.world);
          const bytes = plain ? raw : await gzip(raw);
          return ok({ bytes: bufferOf(bytes), day: this.game.world.day, gzip: !plain && isGzip(bytes) });
        }
        case 'import': {
          const buf = m.bytes;
          if (!(buf instanceof ArrayBuffer)) return fail('No file');
          const data = new Uint8Array(buf);
          const r = await decodeWorld(data);
          if ('error' in r) return fail(r.error);
          const slot = typeof m.slot === 'string' && m.slot ? m.slot : undefined;
          if (slot) { // keep it as a named save, without touching the running game
            if (!this.store) return fail('No saves in this browser');
            const w = r.world, stored = isGzip(data) ? data : await gzip(data);
            const meta: SaveMeta = { slot, label: typeof m.label === 'string' ? m.label : slot, savedAt: Date.now(), day: w.day, tick: w.tick,
              citizens: w.citizens.size, seed: w.seed, version: SNAPSHOT_VERSION, bytes: stored.length, sandbox: !!m.sandbox };
            await this.store.put(meta, stored);
            return ok({ meta });
          }
          await this.switchTo(() => this.use(r.world, !!m.sandbox));
          return ok({ day: r.world.day, citizens: r.world.citizens.size });
        }
        case 'newGame':
          await this.switchTo(() => this.fresh(typeof m.seed === 'number' ? m.seed : undefined, !!m.sandbox));
          return ok({ seed: this.game.world.seed });
        default: return fail(`unknown control ${m.ctl}`);
      }
    } catch (e) { fail((e as Error).message ?? String(e)); }
  }

  /** replace the running game, autosave it at once (a reload resumes it), then tell the client */
  private async switchTo(swap: () => void) {
    await this.saving;
    swap();
    if (this.store) await this.save().catch(() => {});
    this.lastSaveAt = performance.now();
    this.event({ ctl: 'switched' });
  }

  /** a toast in the game's own UI (the protocol's toast message), to every connected client */
  private toast(kind: 'info' | 'error', msg: string) {
    const frame = JSON.stringify({ t: 'toast', kind, msg });
    for (const c of this.conns) c.send(frame);
  }

  private event(m: Control) { try { this.endpoint.postMessage(m); } catch { /* endpoint gone */ } }

  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
