import { LocalGame, type LocalState } from './client';
import type { SaveMeta } from './host';
import './local.css';

/**
 * Local mode's interface (docs/local-mode.md, phase D): the "Play offline" button on the online join form, the local join form
 * (continue the autosaved city, new game, saves), the pause / speed bar in the top bar with its keys, the saves dialog (named
 * saves, rename, export, import, new game, storage) and the service worker's registration (phase F). Everything the player
 * does here goes through LocalGame's control channel (local/client.ts).
 */
type Toast = (kind: 'info' | 'error', msg: string) => void;

const AUTO = /^auto-/;
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
/** a tiny element builder: text goes in as text, never as HTML */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') e.className = String(v);
    else if (k in e && typeof v !== 'string') (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}

/** A seed field's text as the world's seed: digits are the number, anything else is hashed to one (empty: random). */
export function seedOf(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (/^\d{1,9}$/.test(t)) return Number(t);
  let x = 2166136261;
  for (let i = 0; i < t.length; i++) x = Math.imul(x ^ t.charCodeAt(i), 16777619);
  return (x >>> 0) & 0x7fffffff;
}

/** The slot a named save goes to: the one that already has that name, else a fresh key. */
const slotFor = (label: string, saves: SaveMeta[]) =>
  saves.find((s) => !AUTO.test(s.slot) && s.label.toLowerCase() === label.toLowerCase())?.slot ?? `n-${Date.now().toString(36)}`;

// ---- the saves dialog ------------------------------------------------------------------------------------------

interface BeforeInstall extends Event { prompt(): Promise<void> }
let installEvent: BeforeInstall | null = null;
if (typeof window !== 'undefined') window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e as BeforeInstall; });

export class SavesDialog {
  private root = h('div', { id: 'savesDlg', class: 'hidden' });
  private card = h('div', { class: 'card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Saved cities' });
  private body = h('div', { class: 'body' });
  private msg = h('div', { class: 'msg' });
  private file = h('input', { type: 'file', accept: '.json,.gz,application/json,application/gzip', hidden: true });
  private busy = false;

  constructor(private game: LocalGame, private toast: Toast, private mayor: () => string) {
    this.card.append(h('header', {}, h('h2', {}, 'Your cities'), h('button', { class: 'x', title: 'Close (Esc)', onclick: () => this.close() }, '×')), this.msg, this.body, this.file);
    this.root.append(this.card);
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.isOpen) { e.preventDefault(); e.stopPropagation(); this.close(); } }, true);
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      this.file.value = '';
      if (f) void this.run(async () => {
        const label = f.name.replace(/\.(json\.gz|json|gz)$/i, '').slice(0, 40) || 'Imported city';
        await this.game.importFile(f, { slot: slotFor(label, await this.game.listSaves()), label });
        this.say(`Imported "${label}". Load it from the list.`);
      });
    });
    document.body.append(this.root);
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }
  async open() { this.root.classList.remove('hidden'); this.say(''); await this.render(); }
  close() { this.root.classList.add('hidden'); (document.activeElement as HTMLElement | null)?.blur?.(); }

  private say(text: string, bad = false) { this.msg.textContent = text; this.msg.className = `msg${bad ? ' bad' : ''}`; }
  /** one action at a time; a failure shows in the dialog, a success re-draws the list */
  private async run(fn: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true; this.card.classList.add('busy');
    try { await fn(); } catch (e) { this.say((e as Error).message, true); }
    finally { this.busy = false; this.card.classList.remove('busy'); }
    if (this.isOpen) await this.render().catch(() => {});
  }

  private async render() {
    const [info, saves] = await Promise.all([this.game.info(), this.game.listSaves()]);
    const named = saves.filter((s) => !AUTO.test(s.slot)), autos = saves.filter((s) => AUTO.test(s.slot));
    const nameInput = h('input', { class: 'txt', maxlength: 40, placeholder: 'Name this city', value: `${this.mayor()}, day ${info.day}`, 'aria-label': 'Save name' });
    const seedInput = h('input', { class: 'txt', maxlength: 20, placeholder: 'Seed (optional: a number or any word)', 'aria-label': 'Seed' });
    const sandbox = h('input', { type: 'checkbox' });
    const now = h('section', {},
      h('h3', {}, 'This city'),
      h('p', { class: 'dim' }, `Day ${info.day}, ${info.citizens.toLocaleString()} citizens${info.sandbox ? ', sandbox' : ''}. It also saves itself every 30 seconds.`),
      h('div', { class: 'row' }, nameInput,
        h('button', { class: 'btn pri', onclick: () => void this.run(async () => {
          const label = nameInput.value.trim();
          if (!label) throw new Error('Give the save a name');
          await this.game.save(slotFor(label, saves), label);
          this.say(`Saved as "${label}".`);
        }) }, 'Save'),
        h('button', { class: 'btn', title: 'Download this city as a file (.json.gz)', onclick: () => void this.run(async () => {
          const r = await this.game.exportSave({ mayor: this.mayor() });
          this.say(`Downloaded ${r.name} (${fmtBytes(r.bytes)}).`);
        }) }, 'Export file')));
    const list = h('section', {}, h('h3', {}, 'Saved cities'));
    if (!named.length) list.append(h('p', { class: 'dim' }, 'Nothing saved by name yet. Save this city above, or import a file.'));
    for (const s of named) list.append(this.row(s, info.day, info.citizens, saves));
    list.append(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => this.file.click(), title: 'Open a .json.gz exported from here or a server\'s world.json; it is kept as a saved city' }, 'Import a file…')));
    if (autos.length) {
      const d = h('details', { class: 'autos' }, h('summary', {}, 'Autosaves'));
      for (const s of autos) d.append(this.row(s, info.day, info.citizens, saves));
      list.append(d);
    }
    const fresh = h('details', { class: 'fresh' }, h('summary', {}, 'New game…'),
      h('p', { class: 'dim' }, 'Starts an empty city with the Commons. The map comes from the seed: the same seed is the same land.'),
      h('div', { class: 'row' }, seedInput),
      h('label', { class: 'chk' }, sandbox, ' Sandbox: every technology, unlimited funds, no goals'),
      h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: () => void this.newGame(seedOf(seedInput.value), sandbox.checked, info, saves) }, 'Start new game')));
    this.body.replaceChildren(now, list, fresh, await this.storage());
  }

  private row(s: SaveMeta, curDay: number, curCitizens: number, saves: SaveMeta[]) {
    const auto = AUTO.test(s.slot);
    const title = h('span', { class: 'ttl' }, s.label);
    const row = h('div', { class: 'srow' },
      h('div', { class: 'info' }, title, h('span', { class: 'sub' }, `day ${s.day} · ${s.citizens.toLocaleString()} citizens · ${fmtBytes(s.bytes)} · ${fmtDate(s.savedAt)}${s.sandbox ? ' · sandbox' : ''}`)));
    const acts = h('div', { class: 'acts' });
    acts.append(h('button', { class: 'btn', onclick: () => void this.replaceWith(`Load "${s.label}"?`, curDay, curCitizens, saves, () => this.game.load(s.slot)) }, 'Load'));
    if (!auto) acts.append(h('button', { class: 'btn', onclick: () => {
      const input = h('input', { class: 'txt', maxlength: 40, value: s.label, 'aria-label': 'New name' });
      const commit = () => void this.run(async () => { await this.game.rename(s.slot, input.value); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
      input.addEventListener('blur', commit);
      title.replaceChildren(input);
      input.focus(); input.select();
    } }, 'Rename'));
    acts.append(h('button', { class: 'btn', onclick: () => void this.run(async () => { const r = await this.game.exportSave({ slot: s.slot, mayor: s.label }); this.say(`Downloaded ${r.name}.`); }) }, 'Export'));
    const del = h('button', { class: 'btn danger' }, 'Delete');
    let armed = 0;
    del.addEventListener('click', () => {
      if (!armed) { del.textContent = 'Really delete?'; armed = window.setTimeout(() => { armed = 0; del.textContent = 'Delete'; }, 3000); return; }
      clearTimeout(armed);
      void this.run(async () => { await this.game.deleteSave(s.slot); });
    });
    acts.append(del);
    row.append(acts);
    return row;
  }

  /** replacing the running city (load, new game): offer to keep it as a named save first, since the autosaves move on */
  private replaceWith(question: string, day: number, citizens: number, saves: SaveMeta[], go: () => Promise<unknown>) {
    const keep = h('input', { type: 'checkbox', checked: day > 0 || citizens > 0 });
    const name = h('input', { class: 'txt', maxlength: 40, value: `${this.mayor()}, day ${day}`, 'aria-label': 'Save name' });
    const box = h('div', { class: 'confirm' },
      h('h3', {}, question),
      h('p', { class: 'dim' }, 'The city you are playing is replaced.'),
      h('label', { class: 'chk' }, keep, ' Keep it first, saved as'),
      name,
      h('div', { class: 'row' },
        h('button', { class: 'btn pri', onclick: () => void this.run(async () => {
          if (keep.checked) {
            const label = name.value.trim() || `${this.mayor()}, day ${day}`;
            await this.game.save(slotFor(label, saves), label);
          }
          await go(); // the page reloads into the new game
        }) }, 'Go ahead'),
        h('button', { class: 'btn', onclick: () => void this.render() }, 'Cancel')));
    this.body.replaceChildren(box);
  }

  private newGame(seed: number | undefined, sandbox: boolean, info: { day: number; citizens: number }, saves: SaveMeta[]) {
    this.replaceWith('Start a new game?', info.day, info.citizens, saves, () => this.game.newGame({ seed, sandbox }));
  }

  /** where the saves live: size, whether the browser promises to keep them, and the app install */
  private async storage() {
    const sec = h('section', { class: 'store' }, h('h3', {}, 'Storage'));
    const nav = navigator.storage;
    let text = 'Saves are kept in this browser.';
    try {
      const est = await nav?.estimate?.();
      if (est?.usage !== undefined) text = `Saves use ${fmtBytes(est.usage)}${est.quota ? ` of the ${fmtBytes(est.quota)} this browser allows the site` : ''}.`;
    } catch { /* no estimate */ }
    const persisted = await nav?.persisted?.().catch(() => false);
    sec.append(h('p', { class: 'dim' }, text),
      h('p', { class: persisted ? 'dim good' : 'dim' }, persisted
        ? 'Your browser has promised to keep these saves until you clear them yourself.'
        : 'Your browser may clear saves when the disk runs low, and Safari after a week without a visit. Export a file now and then.'));
    const row = h('div', { class: 'row' });
    if (!persisted && nav?.persist) row.append(h('button', { class: 'btn', onclick: () => void this.run(async () => {
      const ok = await nav.persist();
      this.say(ok ? 'Done: the browser will keep your saves.' : 'The browser said no. Installing Civitas as an app, or exporting files, keeps them safe.', !ok);
    }) }, 'Ask the browser to keep them'));
    if (installEvent) row.append(h('button', { class: 'btn', onclick: () => { const e = installEvent; installEvent = null; void e?.prompt().then(() => this.render()); } }, 'Install as an app'));
    if (row.childElementCount) sec.append(row);
    return sec;
  }
}

// ---- the top bar and the keys -----------------------------------------------------------------------------------

export interface LocalUi {
  dialog: SavesDialog;
  togglePause(): void;
  setSpeed(speed: 1 | 2 | 4): void;
  saveNow(): void;
}

/**
 * Pause, 1×/2×/4× and "saves" in the top bar after the clock, a "paused" badge, the saved-at note, and the keys: Space pauses,
 * + and - change speed, Ctrl/Cmd+S saves now. (No single letter is free; Space and the punctuation keys were unused.)
 */
export function mountLocalUi(game: LocalGame, toast: Toast, mayor: () => string): LocalUi {
  document.body.classList.add('local');
  const dialog = new SavesDialog(game, toast, mayor);
  const fail = (e: Error) => toast('error', e.message);
  const chip = (id: string, label: string, title: string, fn: () => void) => {
    const b = h('button', { id, class: 'chip', title, onmousedown: (e) => e.preventDefault() }, label); // no focus: Space stays the pause key
    b.addEventListener('click', fn);
    return b;
  };
  const pause = chip('localPause', '⏸ pause', 'Pause or resume the city (Space)', () => ui.togglePause());
  const speeds = ([1, 2, 4] as const).map((n) => chip(`localSpeed${n}`, `${n}×`, `Game speed ${n}× (${n === 1 ? '-' : '+'} changes it)`, () => ui.setSpeed(n)));
  const saves = chip('localSaves', 'saves', 'Save, load, export and import cities (Ctrl/Cmd+S saves now)', () => void dialog.open().catch(fail));
  const savedAt = h('span', { id: 'localSavedAt', class: 'stat' });
  const bar = h('span', { id: 'localBar' }, pause, h('span', { class: 'seg' }, ...speeds), saves, savedAt);
  document.getElementById('clock')?.after(bar);
  const badge = h('div', { id: 'pausedBadge', class: 'hidden' }, 'Paused', h('span', {}, ' · Space to resume'));
  document.getElementById('worldHud')?.append(badge);

  const show = (s: LocalState) => {
    pause.textContent = s.paused ? '▶ play' : '⏸ pause';
    pause.classList.toggle('on', s.paused);
    speeds.forEach((b, i) => b.classList.toggle('on', !s.paused && s.speed === [1, 2, 4][i]));
    badge.classList.toggle('hidden', !s.paused); // the join form covers it until the game starts
  };
  game.onState = show;
  show(game.state);
  let noted = false;
  game.onSaved = (meta) => {
    savedAt.textContent = `saved ${new Date(meta.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    savedAt.title = `${meta.label}: ${fmtBytes(meta.bytes)}`;
    if (!noted) { noted = true; void persistNote(toast); }
  };
  game.onError = (msg) => toast('error', msg);

  const ui: LocalUi = {
    dialog,
    togglePause: () => void game.pause(!game.state.paused).catch(fail),
    setSpeed: (n) => void game.setSpeed(n).catch(fail),
    saveNow: () => void game.save().then(() => toast('info', 'Saved')).catch(fail),
  };
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyS') { e.preventDefault(); ui.saveNow(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || dialog.isOpen || document.getElementById('login')?.classList.contains('hidden') === false) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) ui.togglePause(); return; }
    const faster = e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+', slower = e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-';
    if (!faster && !slower) return;
    e.preventDefault();
    const i = [1, 2, 4].indexOf(game.state.speed);
    ui.setSpeed([1, 2, 4][Math.max(0, Math.min(2, i + (faster ? 1 : -1)))] as 1 | 2 | 4);
  });
  return ui;
}

/** After the first save: ask the browser to keep the saves, and say so once if it will not. */
async function persistNote(toast: Toast) {
  try {
    if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
    if (await navigator.storage.persist()) return;
    if (localStorage.getItem('civitas.persistNote')) return;
    localStorage.setItem('civitas.persistNote', '1');
    toast('info', 'Your city is saved in this browser, which may clear it if the disk runs low. Export a file from "saves" now and then.');
  } catch { /* private window or no storage API: nothing to say */ }
}

// ---- the join form ------------------------------------------------------------------------------------------------

/** On the online join form: a way into local mode. It reloads into `?local` (the page picks its transport once, at load). */
export function addPlayOffline(form: HTMLElement) {
  const q = new URLSearchParams(location.search);
  const next = new URLSearchParams();
  next.set('local', '');
  if (q.has('dev')) next.set('dev', '');
  const b = h('button', { type: 'button', id: 'playOffline', class: 'alt', title: 'Play on this device, no server, no internet. Your city is saved in this browser.' }, 'Play offline');
  b.addEventListener('click', () => { location.search = next.toString().replace(/=(?=&|$)/g, ''); });
  form.append(b);
}

/**
 * The join form of a local game: the name, a button that continues the autosaved city (or starts one), New game and Saves.
 * Resolves once the worker has loaded the city (the buttons wait for that).
 */
export async function localLogin(game: LocalGame, form: HTMLElement, dialog: SavesDialog, online: boolean) {
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const lead = form.querySelector('p');
  if (lead) lead.textContent = 'Play on this device, no server needed. Buy land, zone it, lay roads. Your citizens go wherever the jobs are, and sit in whatever traffic you leave them. Your city is saved in this browser as you play.';
  document.getElementById('worlds')?.classList.add('hidden');
  form.querySelector('#playOffline')?.remove();
  const status = h('div', { id: 'localInfo', class: 'dim' }, 'Loading your city…');
  submit.before(status);
  submit.disabled = true;
  const links = h('div', { class: 'row2' },
    h('button', { type: 'button', id: 'loginNew', class: 'alt', onclick: () => void dialog.open().then(() => (document.querySelector('#savesDlg details.fresh') as HTMLDetailsElement | null)?.setAttribute('open', '')) }, 'New game…'),
    h('button', { type: 'button', id: 'loginSaves', class: 'alt', onclick: () => void dialog.open() }, 'Saves…'));
  submit.after(links);
  if (online) links.after(h('a', { id: 'playOnline', href: location.pathname, class: 'online' }, 'Play on the online server instead'));
  try {
    const info = await game.info();
    const saves = (await game.listSaves()).filter((s) => AUTO.test(s.slot)).sort((a, b) => b.savedAt - a.savedAt);
    const last = saves[0];
    if (last && (info.day > 0 || info.citizens > 0)) {
      status.textContent = `Your city: day ${info.day}, ${info.citizens.toLocaleString()} citizens, saved ${fmtDate(last.savedAt)}.`;
      submit.textContent = 'Continue';
    } else {
      status.textContent = 'No city yet: this starts a new one.';
      submit.textContent = 'Start a new city';
    }
  } catch (e) {
    status.textContent = (e as Error).message;
    status.classList.add('bad');
    submit.textContent = 'Play';
  }
  submit.disabled = false;
}

// ---- the service worker (phase F) ---------------------------------------------------------------------------------

/**
 * Offline cache for the static build: sw.js (written by the build, vite.config.ts) precaches every file, so the game opens with no
 * network after one visit. Only the `offline` build registers it (online play never gets a service worker), and browsers only
 * allow service workers on https and on localhost.
 */
export function registerServiceWorker(toast: Toast) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast('info', 'A new version of Civitas is ready. It starts the next time you open the game.');
        });
      });
    }).catch((e) => console.warn('service worker:', e));
  });
}
