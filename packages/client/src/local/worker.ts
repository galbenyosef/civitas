import { Gate, LocalHost, type SaveStore } from './host';
import { openSaves } from './idb';
import type { PortLike } from '../../../server/src/local/core';

/**
 * The local-mode worker (docs/local-mode.md): the whole game, off the render thread. local/client.ts starts it and posts
 * `{ctl:'init', devTools}` first; everything else waits behind the Gate until the last autosave is loaded (or a new city made).
 * One game per browser profile: a second tab waits a few seconds for the Web Lock, then says so instead of overwriting the saves.
 */
const scope = self as unknown as PortLike & { addEventListener(type: 'message', fn: (ev: MessageEvent) => void): void };
const gate = new Gate(scope);
let started = false;

scope.addEventListener('message', (ev) => {
  const d = ev.data as { ctl?: string; devTools?: boolean };
  if (started || !d || d.ctl !== 'init') return;
  started = true;
  void start(!!d.devTools);
});

async function start(devTools: boolean) {
  if (!(await lock())) {
    scope.postMessage({ ctl: 'error', fatal: true, msg: 'Civitas is already running in another tab of this browser. Close it, then reload this one.' });
    return;
  }
  let store: SaveStore | null = null;
  try { store = await openSaves(); }
  catch (e) { scope.postMessage({ ctl: 'error', msg: `Saves are off in this browser (${(e as Error).message}); export the city to keep it` }); }
  const host = new LocalHost(gate, store, { devTools });
  try { await host.boot(); }
  catch (e) { scope.postMessage({ ctl: 'error', fatal: true, msg: `The game did not start: ${(e as Error).message}` }); return; }
  (self as unknown as { civitas: LocalHost }).civitas = host; // for a devtools console attached to the worker
  gate.open();
}

/** Hold the 'civitas-local' Web Lock for the worker's life (released when the tab closes). True without the API. */
function lock(): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((ok) => {
    const signal = AbortSignal.timeout(4000);
    locks.request('civitas-local', { signal }, () => { ok(true); return new Promise<void>(() => {}); }).catch(() => ok(false));
  });
}
