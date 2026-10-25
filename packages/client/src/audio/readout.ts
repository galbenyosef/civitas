import type { BusId } from './manifest';
import type { JournalRow, VoiceClass } from './engine';
import { JOURNAL } from './engine';

/**
 * The audio readout (docs/audio.md "Readout"): what is sounding now and why, in the style of the Shift+M perf readout. A plain DOM
 * panel toggled by the "audio" chip beside the sound chip and by Shift+S (controls.ts bindReadoutKey). Reads a snapshot
 * (`Audio.state()`, index.ts) twice a second while open; builds nothing and runs no timer while closed. This file holds the snapshot's
 * shape, the pure row and text builders (checked in audio-check) and the panel. It only reads: nothing here changes what is heard.
 */
export type { JournalRow, VoiceClass };

/** one voice sounding now */
export interface VoiceRow {
  id: string;
  /** a name for this voice that holds while it sounds (the panel reuses its row); defaults to class and id */
  key?: string;
  cls: VoiceClass;
  bus: BusId;
  /** the level now, dB after its bus (a one-shot: at its start); -Infinity is silent */
  db: number;
  /** the pitch offset in cents, null when the voice has none (a synthesised bed, a ride whose pitch follows its speed) */
  cents: number | null;
  /** the recording's file name, or "synth" */
  take: string;
  /** ms since it started */
  age: number;
  /** a one-shot: seconds until its voice is given back */
  left?: number;
  /** why it sounds, in words: a bed's inputs, a cue's stop, a ride's vehicle, an event's trigger */
  why: string;
}

/** everything the readout shows, at one moment */
export interface AudioState {
  /** performance.now ms */
  at: number;
  context: 'running' | 'suspended' | 'closed' | 'interrupted' | 'not started';
  muted: boolean;
  /** the slider, 0..1, and the master gain it gives (dB) */
  volume: number;
  masterDb: number;
  voices: number;
  cap: number;
  /** recording files being fetched or decoded */
  loading: number;
  /** the ambience bus's dips by layer, dB */
  ducks: [string, number][];
  /** the game hour the beds and events use and where it comes from ("clock", "pinned light (tour stop)") */
  hour: number;
  hourSource: string;
  /** the tour stop shown now, '' when the tour is closed */
  stop: string;
  rows: VoiceRow[];
  journal: JournalRow[];
}

const BUS_ORDER: Record<BusId, number> = { ambience: 0, vehicles: 1, ui: 2 };
/** the rows as the panel lists them: by bus, then the loudest first, then by name */
export function rowsOf(s: AudioState): VoiceRow[] {
  return s.rows.slice().sort((a, b) => BUS_ORDER[a.bus] - BUS_ORDER[b.bus] || (b.db === a.db ? 0 : (b.db === -Infinity ? -1 : a.db === -Infinity ? 1 : b.db - a.db)) || (a.id < b.id ? -1 : 1));
}

export const fmtDb = (db: number) => (db === -Infinity || db < -90 ? '-∞ dB' : `${db.toFixed(1)} dB`);
const fmtCents = (c: number | null) => (c === null ? '' : `${c >= 0 ? '+' : '−'}${Math.abs(Math.round(c))}¢`);
const fmtAge = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const hhmm = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));

/** the header's facts as plain text: context, volume, mute, voices, decodes, ducks, hour */
export function headerText(s: AudioState): string {
  const ducks = s.ducks.length ? s.ducks.map(([l, d]) => `${l} ${d.toFixed(0)} dB`).join(', ') : 'none';
  return `context ${s.context} · volume ${Math.round(s.volume * 100)}% (master ${fmtDb(s.masterDb)})${s.muted ? ' · MUTED' : ''} · voices ${s.voices}/${s.cap} · decodes in flight ${s.loading} · ducks ${ducks} · hour ${hhmm(s.hour)} from the ${s.hourSource}${s.stop ? ` · tour stop ${s.stop}` : ''}`;
}
/** one voice as a line of text */
export function rowText(r: VoiceRow): string {
  return `${r.cls.padEnd(5)} ${r.id} · ${r.bus} · ${fmtDb(r.db)}${r.cents === null ? '' : ` · ${fmtCents(r.cents)}`} · ${r.take} · ${r.left !== undefined ? `${r.left.toFixed(1)} s left` : `up ${fmtAge(r.age)}`} · ${r.why}`;
}
/** one journal row as a line of text; `now` makes it "-12.3 s", otherwise the time since the page loaded "+123.4 s" */
export function journalText(j: JournalRow, now?: number): string {
  const t = now === undefined ? `+${(j.t / 1000).toFixed(1)} s` : `-${((now - j.t) / 1000).toFixed(1)} s`;
  return `${t} ${j.ev} ${j.cls} ${j.id}${j.n && j.n > 1 ? ` ×${j.n}` : ''}${j.why ? ` · ${j.why}` : ''}`;
}
/** the whole snapshot and the log as text, for the Copy button */
export function stateText(s: AudioState): string {
  const rows = rowsOf(s);
  return [`Civitas audio readout, page time ${(s.at / 1000).toFixed(1)} s`, headerText(s), '', `Voices (${rows.length}):`, ...(rows.length ? rows.map(rowText) : ['none']), '', `Log, the last ${JOURNAL} starts and stops:`, ...(s.journal.length ? s.journal.map((j) => journalText(j)) : ['none'])].join('\n');
}

/** one voice as the panel's HTML: a line of facts, the reason under it */
export function rowHtml(r: VoiceRow): string {
  return `<div class="aro-row ${r.cls}${r.db < -50 ? ' quiet' : ''}"><div class="aro-top"><span class="aro-cls">${r.cls}</span> <b>${esc(r.id)}</b> <i>${r.bus}</i> <span class="aro-db">${fmtDb(r.db)}</span> <span class="aro-cents">${r.cents === null ? '' : fmtCents(r.cents)}</span> <i class="aro-take">${esc(r.take)}</i> <span class="aro-age">${ageText(r)}</span></div><div class="aro-why">${esc(r.why)}</div></div>`;
}
const ageText = (r: VoiceRow) => (r.left !== undefined ? `${r.left.toFixed(1)} s left` : fmtAge(r.age));
export function headerHtml(s: AudioState): string {
  const ok = s.context === 'running' && !s.muted;
  const ducks = s.ducks.length ? s.ducks.map(([l, d]) => `${esc(l)} <b>${d.toFixed(0)}</b>`).join(', ') + ' dB' : 'none';
  return `<div class="aro-head ${ok ? '' : 'warn'}"><span><i>context</i> <b>${s.context}</b></span><span><i>volume</i> <b>${Math.round(s.volume * 100)}%</b> <i>${fmtDb(s.masterDb)}</i>${s.muted ? ' <b class="aro-muted">muted</b>' : ''}</span><span><i>voices</i> <b>${s.voices}</b>/${s.cap}</span><span><i>decodes</i> <b>${s.loading}</b></span><span><i>ducks</i> ${ducks}</span><span><i>hour</i> <b>${hhmm(s.hour)}</b> <i>${esc(s.hourSource)}</i></span>${s.stop ? `<span><i>tour stop</i> <b>${esc(s.stop)}</b></span>` : ''}</div>`;
}
const ago = (ms: number) => `-${ms < 10000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)} s`;
export function journalHtml(js: JournalRow[], now: number): string {
  return js.slice().reverse().map((j) => `<div class="aro-log ${j.ev}" title="${(j.t / 1000).toFixed(1)} s since the page loaded"><span class="aro-t">${ago(now - j.t)}</span> <span class="aro-ev">${j.ev}</span> <b>${esc(j.id)}</b> <i>${j.cls}</i>${j.n && j.n > 1 ? ` ×${j.n}` : ''}${j.why ? ` <span class="aro-lw">${esc(j.why)}</span>` : ''}</div>`).join('');
}

/** the panel: shown by the chip or Shift+S, rebuilt twice a second while open, no timer while closed */
export class AudioReadout {
  readonly el: HTMLElement;
  private head: HTMLElement; private list: HTMLElement; private logEl: HTMLElement; private note: HTMLElement;
  private on = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastJournal = '';
  private lastHead = '';
  private lastOrder = '\0';
  /** the voice rows on screen, reused while a voice sounds so a refresh sets a few text nodes instead of parsing HTML */
  private rowEls = new Map<string, { el: HTMLElement; db: HTMLElement; cents: HTMLElement; take: HTMLElement; age: HTMLElement; why: HTMLElement; v: { db: string; cents: string; take: string; age: string; why: string; quiet: boolean } }>();
  private logTimes: { el: HTMLElement; j: JournalRow; text: string }[] = [];
  /** the cost of a refresh (state, text, DOM), ms: the last, the running total and how many; for the check and the docs (msc.audio.readout.cost) */
  readonly cost = { last: 0, total: 0, n: 0 };
  /** the snapshot of the last refresh */
  last: AudioState | null = null;

  constructor(private src: { state(): AudioState }, mount: HTMLElement, private chip: HTMLElement | null) {
    this.el = document.createElement('div');
    this.el.id = 'audioRo';
    this.el.className = 'hidden';
    this.head = document.createElement('div'); this.list = document.createElement('div'); this.list.className = 'aro-list';
    const title = document.createElement('div'); title.className = 'aro-title'; title.textContent = `log: the last ${JOURNAL} starts and stops`;
    this.logEl = document.createElement('div'); this.logEl.className = 'aro-logs';
    const bar = document.createElement('div'); bar.className = 'pbar';
    const btn = (label: string, tip: string, f: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = tip; b.addEventListener('click', f); bar.appendChild(b); return b; };
    const copy = btn('copy', 'Copy the snapshot and the log as text', () => void this.copy(copy));
    btn('close', 'Close the readout (Shift+S)', () => this.set(false));
    this.note = document.createElement('div'); this.note.className = 'pnote';
    this.note.textContent = 'one row per voice sounding now: what it is, its bus, level after the bus, pitch offset, which recording, and why. A bed shows the numbers its level is made of.';
    this.el.append(this.head, this.list, title, this.logEl, bar, this.note);
    mount.appendChild(this.el);
    chip?.addEventListener('click', () => this.set(!this.on));
  }

  get visible() { return this.on; }
  toggle() { this.set(!this.on); }
  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle('hidden', !on);
    this.chip?.classList.toggle('on', on);
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (on) { this.refresh(); this.timer = setInterval(() => this.refresh(), 500); }
  }

  /** build the snapshot and redraw (twice a second while open) */
  refresh() {
    const t0 = performance.now();
    const s = this.src.state();
    this.last = s;
    const hh = headerHtml(s);
    if (hh !== this.lastHead) { this.lastHead = hh; this.head.innerHTML = hh; }
    this.syncRows(rowsOf(s), s);
    const key = s.journal.length + ':' + (s.journal[s.journal.length - 1]?.t ?? 0) + ':' + (s.journal[s.journal.length - 1]?.n ?? 0);
    if (key !== this.lastJournal) {
      this.lastJournal = key;
      this.logEl.innerHTML = journalHtml(s.journal, s.at) || '<div class="aro-none">nothing yet</div>';
      const els = this.logEl.querySelectorAll<HTMLElement>('.aro-log'), rev = s.journal.slice().reverse();
      this.logTimes = Array.from(els, (el, i) => ({ el: el.querySelector('.aro-t') as HTMLElement, j: rev[i], text: '' }));
    }
    for (const t of this.logTimes) { const v = ago(s.at - t.j.t); if (v !== t.text) { t.text = v; t.el.textContent = v; } }
    const c = this.cost, ms = performance.now() - t0;
    c.last = ms; c.total += ms; c.n++;
  }

  private syncRows(rows: VoiceRow[], s: AudioState) {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = r.key ?? `${r.cls}:${r.id}`;
      seen.add(k);
      let e = this.rowEls.get(k);
      if (!e) {
        const host = document.createElement('div'); host.innerHTML = rowHtml(r);
        const el = host.firstElementChild as HTMLElement, q = (c: string) => el.querySelector(c) as HTMLElement;
        e = { el, db: q('.aro-db'), cents: q('.aro-cents'), take: q('.aro-take'), age: q('.aro-age'), why: q('.aro-why'), v: { db: fmtDb(r.db), cents: r.cents === null ? '' : fmtCents(r.cents), take: r.take, age: ageText(r), why: r.why, quiet: r.db < -50 } };
        this.rowEls.set(k, e);
        this.lastOrder = '';
        continue;
      }
      const v = e.v, db = fmtDb(r.db), cents = r.cents === null ? '' : fmtCents(r.cents), age = ageText(r), quiet = r.db < -50;
      if (db !== v.db) { v.db = db; e.db.textContent = db; }
      if (cents !== v.cents) { v.cents = cents; e.cents.textContent = cents; }
      if (r.take !== v.take) { v.take = r.take; e.take.textContent = r.take; }
      if (age !== v.age) { v.age = age; e.age.textContent = age; }
      if (r.why !== v.why) { v.why = r.why; e.why.textContent = r.why; }
      if (quiet !== v.quiet) { v.quiet = quiet; e.el.classList.toggle('quiet', quiet); }
    }
    for (const [k, e] of this.rowEls) if (!seen.has(k)) { e.el.remove(); this.rowEls.delete(k); this.lastOrder = ''; }
    const order = rows.map((r) => r.key ?? `${r.cls}:${r.id}`).join('|');
    if (order !== this.lastOrder) {
      this.lastOrder = order;
      this.list.querySelector('.aro-none')?.remove();
      for (const r of rows) this.list.appendChild(this.rowEls.get(r.key ?? `${r.cls}:${r.id}`)!.el);
      if (!rows.length) { const n = document.createElement('div'); n.className = 'aro-none'; n.textContent = s.context === 'not started' ? 'sound starts on your first click or key press' : s.muted ? 'muted: nothing plays' : 'nothing is sounding'; this.list.appendChild(n); }
    }
  }

  /** the text a Copy puts on the clipboard (the last refresh, or a fresh one) */
  text() { return stateText(this.src.state()); }
  private async copy(b: HTMLButtonElement) {
    const text = this.text();
    try { await navigator.clipboard.writeText(text); b.textContent = 'copied'; }
    catch { // no clipboard permission (an insecure origin): the old way
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); b.textContent = 'copied'; } catch { b.textContent = 'copy failed'; }
      ta.remove();
    }
    setTimeout(() => { b.textContent = 'copy'; }, 1500);
  }
}
