import { WorkerSocket, type ClientSocket } from '../net';
import type { SaveMeta } from './host';

type Reply = { ctl: 'reply'; id: number; ok: boolean; error?: string; [k: string]: unknown };
/** set before the page reloads into another game (load, import, new game): the next boot joins without the form (main.ts) */
export const AUTOJOIN = 'civitas.autojoin';
export interface LocalState { paused: boolean; speed: number; sandbox: boolean }

/**
 * The main thread's side of a local-mode game (docs/local-mode.md): starts the worker (local/worker.ts, its own chunk, so online
 * players never download it), hands NetClient a WorkerSocket on it, and wraps the worker host's control channel (local/host.ts) in
 * promises. The Play-offline UI, the top-bar controls and the saves dialog (local/ui.ts) build on this.
 */
export class LocalGame {
  readonly worker: Worker;
  state: LocalState = { paused: false, speed: 1, sandbox: false };
  lastSaved: SaveMeta | null = null;
  onState: (s: LocalState) => void = () => {};
  onSaved: (meta: SaveMeta, ms: number) => void = () => {};
  onError: (msg: string, fatal: boolean) => void = (msg) => console.error(`local: ${msg}`);
  /** another game replaced the running one (load, import, new game): by default the page reloads into it */
  onSwitched: () => void = () => {
    try { sessionStorage.setItem(AUTOJOIN, '1'); } catch { /* the join form shows again */ }
    location.reload();
  };
  private seq = 0;
  private pending = new Map<number, { ok: (r: Reply) => void; fail: (e: Error) => void }>();
  /** paused because the tab was hidden (and not by the player): resume when it is shown */
  private autoPaused = false;

  constructor(opts: { devTools: boolean }) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'civitas-local' });
    this.worker.addEventListener('message', (ev) => this.receive(ev.data));
    this.worker.addEventListener('error', (ev) => this.onError(`The game crashed (${ev.message || 'worker error'}). Reload to continue from your last save.`, true));
    this.worker.postMessage({ ctl: 'init', devTools: opts.devTools });
    // a hidden tab saves and pauses (no battery spent on a city nobody watches); showing it again resumes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        void this.save().catch(() => {});
        if (!this.state.paused) { this.autoPaused = true; void this.pause(true); }
      } else if (this.autoPaused) { this.autoPaused = false; void this.pause(false); }
    });
  }

  /** for `new NetClient(() => local.socket())` */
  socket(): ClientSocket { return new WorkerSocket(this.worker); }

  private receive(d: { ctl?: string; [k: string]: unknown }) {
    if (!d || typeof d !== 'object' || typeof d.ctl !== 'string') return; // game frames are WorkerSocket's
    switch (d.ctl) {
      case 'reply': {
        const r = d as Reply, p = this.pending.get(r.id);
        if (!p) return;
        this.pending.delete(r.id);
        if (r.ok) p.ok(r); else p.fail(new Error(r.error ?? 'failed'));
        return;
      }
      case 'state': if (!this.inflight) this.applyState(d); return; // while our own pause/speed requests are out, an older event must not undo them
      case 'saved': this.lastSaved = d.meta as SaveMeta; this.onSaved(this.lastSaved, Number(d.ms) || 0); return;
      case 'error': this.onError(String(d.msg), !!d.fatal); return;
      case 'switched': this.onSwitched(); return;
    }
  }

  /** one control request to the worker host, answered by its reply */
  request(ctl: string, args: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<Reply> {
    const id = ++this.seq;
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      this.worker.postMessage({ ctl, id, ...args }, transfer);
    });
  }

  // pause and speed take effect in the state at once (a second click before the worker answers builds on the first); the worker's 'state' confirms
  pause(paused: boolean) { if (!paused) this.autoPaused = false; this.state = { ...this.state, paused }; return this.settle(this.request('pause', { paused })); }
  setSpeed(speed: 1 | 2 | 4) { this.state = { ...this.state, speed }; return this.settle(this.request('speed', { speed })); }
  /** pause/speed requests in flight; the last reply (replies come in order) carries the state the worker ended in */
  private inflight = 0;
  private settle(p: Promise<Reply>) {
    this.inflight++;
    const done = () => { this.inflight--; };
    return p.then((r) => { done(); if (!this.inflight) this.applyState(r); return r; }, (e) => { done(); throw e; });
  }
  private applyState(d: Record<string, unknown>) {
    this.state = { paused: !!d.paused, speed: Number(d.speed) || 1, sandbox: !!d.sandbox };
    this.onState(this.state);
  }
  /** no slot: an autosave now (into the older of the two rolling slots); a slot: a named save */
  async save(slot?: string, label?: string) {
    const r = await this.request('save', { slot, label });
    void navigator.storage?.persist?.().catch(() => false); // ask once the city is worth keeping; browsers remember the answer (local/ui.ts tells the player when they refuse)
    return r.meta as SaveMeta;
  }
  async listSaves() { return (await this.request('listSaves')).saves as SaveMeta[]; }
  load(slot: string) { return this.request('load', { slot }); }
  /** the administration panel's way out (client finance.ts): load the newest autosave; the page reloads into it */
  async restartFromAutosave() {
    const auto = (await this.listSaves()).filter((s) => /^auto-/.test(s.slot)).sort((a, b) => b.savedAt - a.savedAt);
    if (!auto.length) throw new Error('No autosave to start again from');
    await this.load(auto[0].slot);
  }
  deleteSave(slot: string) { return this.request('deleteSave', { slot }); }
  rename(slot: string, label: string) { return this.request('rename', { slot, label }); }
  /** the running city: day, citizens, pause/speed state (answered once the game is up) */
  async info() { return (await this.request('info')) as unknown as LocalState & { day: number; citizens: number; persistent: boolean }; }
  newGame(opts: { seed?: number; sandbox?: boolean } = {}) { return this.request('newGame', opts); }

  /** the running city (or a saved slot) as a file: world.json gzipped, which a server opens as its data/world.json once gunzipped */
  async exportSave(opts: { slot?: string; gzip?: boolean; mayor?: string } = {}) {
    const r = await this.request('export', { slot: opts.slot, gzip: opts.gzip });
    const gz = !!r.gzip, name = `civitas-${(opts.mayor ?? 'city').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-day${r.day}.json${gz ? '.gz' : ''}`;
    const blob = new Blob([r.bytes as ArrayBuffer], { type: gz ? 'application/gzip' : 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return { name, bytes: blob.size };
  }

  /** a world.json or .json.gz from disk: replaces the running game, or with a slot becomes a named save */
  async importFile(file: Blob, opts: { slot?: string; label?: string; sandbox?: boolean } = {}) {
    const bytes = await file.arrayBuffer();
    return this.request('import', { bytes, ...opts }, [bytes]);
  }
}
