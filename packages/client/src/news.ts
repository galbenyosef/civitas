import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { NEWS, TICKS_PER_DAY, TICKS_PER_HOUR, channelName, storyLive, type StoryDTO, type MediaInfo, type ServerMsg } from '@msimcity/shared';
import type { NetClient } from './net';
import type { ClientWorld } from './world';

/**
 * The news on the client (shared/src/news.ts, server/src/sim/news.ts, docs/media.md N2): the stories as the server
 * sends them, the news chip in the top bar, the News panel (newest first, each with its channel, a LIVE mark while it
 * goes on and "show me"), the ticker that brings each new covered story up above the help line for a few seconds, and the
 * media centre's lines in the building panel. Nothing shows until a channel has reported something: uncovered stories
 * are kept (N5's witnesses will want them) but never shown.
 */

/** The stories this client holds, by id: what the panel and ticker read, and later the Lights' news turn and the FPV TV. */
export class NewsStore {
  private byId = new Map<number, StoryDTO>();
  /** Take a `news` message: `all` replaces what was held (joining), otherwise each story is added or updated by id. */
  apply(list: readonly StoryDTO[], all = false) {
    if (all) this.byId.clear();
    for (const s of list) this.byId.set(s.id, s);
    if (this.byId.size > NEWS.keep) {
      const ids = [...this.byId.keys()].sort((a, b) => a - b);
      for (const id of ids.slice(0, ids.length - NEWS.keep)) this.byId.delete(id);
    }
  }
  /** The newest `n` covered stories, newest first; with `ch`, only that channel's (a player id). */
  latest(n = 10, ch?: string): StoryDTO[] {
    const out: StoryDTO[] = [];
    const ids = [...this.byId.keys()].sort((a, b) => b - a);
    for (const id of ids) {
      const s = this.byId.get(id)!;
      if (!s.ch || (ch !== undefined && s.ch !== ch)) continue;
      out.push(s);
      if (out.length >= n) break;
    }
    return out;
  }
  get(id: number) { return this.byId.get(id); }
  /** every story held, covered or not, oldest first */
  all(): StoryDTO[] { return [...this.byId.values()].sort((a, b) => a.id - b.id); }
}
/** The one store (the Piccadilly Lights' news turn reads `news.latest(1)[0]?.h`). */
export const news = new NewsStore();

export interface NewsDeps {
  net: NetClient;
  world: ClientWorld;
  /** the server's tick now */
  liveTick(): number;
  /** a short camera flight to a tile ("show me") */
  flyTo(x: number, y: number): void;
  /** the big screens' news turn (render/adverts.ts AdvertsView.setNewsFeed): the newest headline as a card, null for the placeholder */
  feed?(tex: Texture | null): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
/** "day 3, 14:05" for a tick */
function when(t: number, now: number): string {
  const day = Math.floor(t / TICKS_PER_DAY), h = (t % TICKS_PER_DAY) / TICKS_PER_HOUR;
  const hm = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  return day === Math.floor(now / TICKS_PER_DAY) ? hm : `day ${day}, ${hm}`; // numbered as the top bar's clock numbers them
}
/** The ticker holds each story this long (ms), and shows at most this many queued. */
const TICKER_MS = 7000, TICKER_QUEUE = 4;

export class NewsUI {
  private chip: HTMLButtonElement;
  private panel: HTMLDivElement;
  private ticker: HTMLDivElement;
  private open = false;
  /** 'all' channels, or only the viewer's own */
  private filter: 'all' | 'mine' = 'all';
  private seen = 0;
  private queue: StoryDTO[] = [];
  private tickerUntil = 0;
  private html = '';
  /** the card on the big screens' news turn, and the story it shows */
  private card: { tex: CanvasTexture; g: CanvasRenderingContext2D; id: number; h: string } | null = null;

  constructor(private d: NewsDeps) {
    injectStyle();
    this.chip = document.createElement('button'); this.chip.id = 'newsBtn'; this.chip.className = 'chip hidden';
    this.chip.textContent = 'news';
    (document.getElementById('perfBtn') ?? document.getElementById('light'))!.before(this.chip);
    this.chip.onclick = () => this.toggle();
    this.panel = document.createElement('div'); this.panel.id = 'newsPanel'; this.panel.className = 'hidden';
    this.ticker = document.createElement('div'); this.ticker.id = 'newsTicker';
    const ui = document.getElementById('ui')!;
    ui.append(this.panel, this.ticker);
    this.panel.onclick = (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el) return;
      if (el.dataset.act === 'close') this.toggle(false);
      else if (el.dataset.act === 'show') d.flyTo(Number(el.dataset.x), Number(el.dataset.y));
      else if (el.dataset.act === 'filter') { this.filter = this.filter === 'all' ? 'mine' : 'all'; this.render(); }
    };
    d.net.on('news', (m) => this.onNews(m));
    setInterval(() => { if (this.open) this.render(); this.pump(); }, 1000);
  }

  toggle(on = !this.open) {
    this.open = on;
    this.panel.classList.toggle('hidden', !on);
    this.chip.classList.toggle('on', on);
    if (on) { this.seen = news.latest(1)[0]?.id ?? this.seen; this.render(); }
    this.renderChip();
  }

  private onNews(m: Extract<ServerMsg, { t: 'news' }>) {
    news.apply(m.s, m.all);
    if (m.all) this.seen = news.latest(1)[0]?.id ?? 0; // what was on before we joined is not breaking news
    else {
      // only stories that just broke go on the ticker (an update, a fire put out, keeps its id and is not news again)
      for (const s of m.s) if (s.ch && s.id > this.seen && !this.queue.some((q) => q.id === s.id) && this.d.liveTick() - s.t < TICKS_PER_HOUR) this.queue.push(s);
      if (this.queue.length > TICKER_QUEUE) this.queue.splice(0, this.queue.length - TICKER_QUEUE);
    }
    this.renderChip();
    if (this.open) this.render();
    this.pump();
    this.drawCard();
  }

  /**
   * The newest covered headline as a 1.7:1 card for the big screens' news turn (the Piccadilly Lights, a big screens
   * corner): the channel's bug, LIVE while it goes on, and the headline. Drawn only when the newest story or its headline
   * changes; N4's helicopter picture replaces it.
   */
  private drawCard() {
    if (!this.d.feed) return;
    const s = news.latest(1)[0];
    if (!s) { if (this.card) { this.card = null; this.d.feed(null); } return; }
    if (this.card && this.card.id === s.id && this.card.h === s.h) return;
    if (!this.card) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 300;
      const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
      this.card = { tex, g: c.getContext('2d')!, id: 0, h: '' };
    }
    const { g, tex } = this.card, W = 512, H = 300, ch = this.channel(s.ch!);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0c1a33'); bg.addColorStop(1, '#173a6b');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = ch.color; g.fillRect(0, 0, W, 54);
    g.font = 'bold 30px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#fff';
    g.fillText(ch.name.toUpperCase(), 20, 28);
    const live = s.k === 'fire' ? s.end === undefined : storyLive(s, Math.max(this.d.liveTick(), s.t));
    if (live) { g.fillStyle = '#d42a20'; g.fillRect(W - 112, 10, 96, 34); g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText('LIVE', W - 64, 28); }
    // the headline, wrapped to at most four lines
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = 'bold 34px system-ui, sans-serif';
    const lines: string[] = [];
    let line = '';
    for (const word of s.h.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > W - 40 && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length > 4) { lines.length = 4; lines[3] = `${lines[3].replace(/\s+\S*$/, '')}…`; }
    const y0 = 54 + (H - 54 - 40 - lines.length * 42) / 2 + 21;
    lines.forEach((l, i) => g.fillText(l, 20, y0 + i * 42));
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, H - 40, W, 40);
    g.fillStyle = '#cfe0ff'; g.font = '22px system-ui, sans-serif'; g.fillText(`NEWS · ${when(s.t, this.d.liveTick())}`, 20, H - 20);
    tex.needsUpdate = true;
    this.card.id = s.id; this.card.h = s.h;
    this.d.feed(tex);
  }

  private channel(id: string) {
    const p = this.d.world.players.get(id);
    return { name: channelName(p?.name ?? id), color: p ? hex(p.color) : '#888' };
  }

  private renderChip() {
    const any = news.latest(1)[0];
    this.chip.classList.toggle('hidden', !any);
    const fresh = any && any.id > this.seen && !this.open;
    this.chip.classList.toggle('nfresh', !!fresh);
    this.chip.title = any ? `News: ${any.h}. Click for the News panel` : 'News';
  }

  /** the ticker: the next queued story for TICKER_MS, under the top bar */
  private pump() {
    const now = performance.now();
    if (now < this.tickerUntil) return;
    const s = this.queue.shift();
    if (!s) { this.ticker.classList.remove('on'); return; }
    const c = this.channel(s.ch!);
    this.ticker.innerHTML = `<span class="nbug" style="background:${c.color}">${esc(c.name)}</span><span class="nhl">${esc(s.h)}</span>`;
    this.ticker.classList.remove('on'); void this.ticker.offsetWidth; this.ticker.classList.add('on');
    this.tickerUntil = now + TICKER_MS;
  }

  private render() {
    const me = this.d.world.me, now = this.d.liveTick();
    const mine = me ? news.latest(1, me).length > 0 : false;
    const list = news.latest(40, this.filter === 'mine' && mine ? me : undefined);
    let html = `<div class="nhead"><h2>News</h2><span class="nsub">${list.length ? `${list.length} stor${list.length === 1 ? 'y' : 'ies'}` : ''}</span>`;
    if (mine) html += `<button class="nfilter" data-act="filter">${this.filter === 'mine' ? 'all channels' : 'my channel'}</button>`;
    html += `<button class="nclose" data-act="close" title="Close">×</button></div>`;
    if (!list.length) html += `<div class="nempty">No news yet. A staffed TV studio, broadcast centre or media centre reports the fires, openings and big days in its reach.</div>`;
    for (const s of list) {
      const c = this.channel(s.ch!);
      // a fire with its end is out, whatever this client's clock says; the rest are live until the end they broke with
      const live = s.k === 'fire' ? s.end === undefined : storyLive(s, Math.max(now, s.t));
      const rivals = s.rv?.length ? ` · also on ${s.rv.map((r) => esc(this.channel(r).name)).join(', ')}` : '';
      html += `<div class="nstory${s.ch === me ? ' nmine' : ''}">
        <div class="nmeta"><span class="ndot" style="background:${c.color}"></span>${esc(c.name)} · ${when(s.t, now)}${live ? ' <span class="nlive">LIVE</span>' : ''}${rivals}</div>
        <div class="nhl">${esc(s.h)}</div>
        <button class="nshow" data-act="show" data-x="${s.x}" data-y="${s.y}">show me</button>
      </div>`;
    }
    if (html !== this.html) { this.html = html; this.panel.innerHTML = html; }
  }
}

/** The building panel's lines for a media centre (ui.ts buildingHtml). */
export function mediaHtml(m: MediaInfo, row: (k: string, v: string | number) => string): string {
  let html = `<div class="sect">${esc(m.channel)}</div>`;
  html += row('Reaches', m.radius === 0 ? 'the whole map' : `${m.radius} tiles round it`);
  if (!m.staffed) html += row('On air', '<span class="bad">not yet: no staff</span>');
  html += row('Rival channels here', m.rivals.length ? esc(m.rivals.join(', ')) : 'none');
  if (m.helicopters) html += row('News helicopter', `${m.helicopters} on the roof pad`);
  html += row('Stories run', m.stories);
  for (const h of m.latest) html += `<div class="row nrow"><span>${esc(h)}</span></div>`;
  return html;
}

function injectStyle() {
  const style = document.createElement('style');
  style.textContent = `
#newsBtn.nfresh { border-color: rgba(220,70,60,0.8); box-shadow: 0 0 0 1px rgba(220,70,60,0.35) inset; }
#newsPanel { position: absolute; z-index: 6; right: 12px; top: 56px; width: 352px; max-height: calc(100vh - 80px); overflow-y: auto; padding: 12px 14px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; backdrop-filter: blur(10px); font-size: 12px; }
#newsPanel.hidden { display: none; }
#newsPanel .nhead { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
#newsPanel .nhead h2 { margin: 0; font-size: 16px; }
#newsPanel .nsub { color: var(--muted); flex: 1; }
#newsPanel button { font: inherit; color: var(--fg); background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; padding: 2px 8px; }
#newsPanel .nclose { padding: 0 7px; font-size: 14px; }
#newsPanel .nempty { color: var(--muted); line-height: 1.4; }
#newsPanel .nstory { position: relative; padding: 7px 0 7px; border-top: 1px solid var(--line); }
#newsPanel .nstory.nmine .nhl { color: #fff; }
#newsPanel .nmeta { color: var(--muted); font-size: 11px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; padding-right: 64px; }
#newsPanel .ndot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
#newsPanel .nlive { color: #fff; background: #c8463c; border-radius: 3px; padding: 0 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; }
#newsPanel .nhl { margin-top: 2px; line-height: 1.35; font-weight: 600; }
#newsPanel .nshow { position: absolute; right: 0; top: 6px; font-size: 11px; }
#newsTicker { position: absolute; bottom: 44px; left: 50%; transform: translate(-50%, 6px); max-width: min(620px, calc(100vw - 24px)); display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px 5px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px; backdrop-filter: blur(8px); font-size: 12px; pointer-events: none; z-index: 6;
  opacity: 0; transition: opacity 0.4s, transform 0.4s; }
#newsTicker.on { opacity: 1; transform: translate(-50%, 0); }
#newsTicker .nbug { color: #fff; font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
#newsTicker .nhl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#panel .nrow span, #tip .nrow span { color: var(--fg); font-style: italic; }
body.fpv-full #newsPanel, body.fpv-full #newsTicker { display: none !important; }
`;
  document.head.append(style);
}
