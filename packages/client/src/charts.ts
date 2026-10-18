import { Rings, WORLD_SERIES, PLAYER_SERIES, WORLD_KEYS, PLAYER_KEYS, HIST_TIERS, TECH, EDU_LEVEL_NAMES, type ServerMsg, type HistUnit, type PlayerDTO } from '@msimcity/shared';
import type { NetClient } from './net';

/**
 * The charts panel (docs/charts.md): how the city grows over time. Opened by the top bar's charts chip, the ` key, or a click on a
 * top-bar figure. The server sends its history when the panel opens ('history') and one 'histSample' per game hour after that;
 * both feed the same Rings the server keeps (shared/src/history.ts), so the daily and weekly tiers agree on both sides.
 * Small-multiple line charts on canvas, one shared hover time across all of them.
 */

type Tab = 'city' | 'economy' | 'traffic' | 'education';
type Range = 'day' | 'week' | 'month' | 'all';
const TABS: { id: Tab; label: string }[] = [{ id: 'city', label: 'City' }, { id: 'economy', label: 'Economy' }, { id: 'traffic', label: 'Traffic & transport' }, { id: 'education', label: 'Education' }];
const RANGES: { id: Range; label: string; title: string }[] = [
  { id: 'day', label: 'Day', title: 'The last game day, hour by hour' },
  { id: 'week', label: 'Week', title: 'The last 7 game days, hour by hour' },
  { id: 'month', label: 'Month', title: 'The last 30 game days, day by day' },
  { id: 'all', label: 'All', title: 'Everything kept: daily, then weekly once the daily record is full' },
];

const C = { green: '#62d2a2', blue: '#5aa8ff', orange: '#ffa14a', violet: '#b48bff', red: '#ff7a7a', teal: '#4dd0e1' };
interface SeriesSpec {
  key: string; label: string; color: string; src?: 'w' | 'p';
  /** a series worked out from two others (net = income - spending) */
  calc?: { a: string; b: string; fn: (a: number, b: number) => number };
}
interface ChartSpec { id: string; tab: Tab; title: string; unit: HistUnit | '/h'; series: SeriesSpec[]; /** y axis from zero (default) or fitted to the data */ fit?: boolean; note?: string }
const W = (key: string, label: string, color: string): SeriesSpec => ({ key, label, color, src: 'w' });
const P = (key: string, label: string, color: string): SeriesSpec => ({ key, label, color, src: 'p' });
const CHARTS: ChartSpec[] = [
  { id: 'pop', tab: 'city', title: 'Population', unit: '', series: [W('pop', 'Citizens', C.green)] },
  { id: 'jobs', tab: 'city', title: 'Jobs', unit: '', series: [W('employed', 'Filled', C.blue), W('vacant', 'Open', C.orange)] },
  { id: 'buildings', tab: 'city', title: 'Buildings', unit: '', series: [W('buildings', 'Standing', C.green), W('sites', 'Under construction', C.orange)] },
  { id: 'migration', tab: 'city', title: 'Migration through the gates, per hour', unit: '/h', series: [W('migIn', 'Newcomers', C.blue), W('migOut', 'Leavers', C.orange)] },
  { id: 'money', tab: 'economy', title: 'Your treasury', unit: '$', fit: true, series: [P('money', 'Treasury', C.green)] },
  { id: 'flows', tab: 'economy', title: 'Income and spending per day', unit: '$', series: [P('income', 'Income', C.blue), P('expenses', 'Spending', C.orange)], note: 'The last 24 hours of your ledger' },
  { id: 'net', tab: 'economy', title: 'Net per day', unit: '$', fit: true, series: [{ key: 'net', label: 'Net', color: C.violet, src: 'p', calc: { a: 'income', b: 'expenses', fn: (a, b) => a - b } }] },
  { id: 'housed', tab: 'economy', title: 'Your population', unit: '', series: [P('housed', 'Housed on your land', C.green)] },
  { id: 'myjobs', tab: 'economy', title: 'Your jobs', unit: '', series: [P('staffed', 'Filled', C.blue), P('jobs', 'Capacity', C.orange)] },
  { id: 'speed', tab: 'traffic', title: 'Traffic speed and queues', unit: '%', series: [W('speedPct', 'Speed vs free flow', C.blue), W('queuedPct', 'Held up', C.orange)] },
  { id: 'vehicles', tab: 'traffic', title: 'Cars on the road', unit: '', series: [W('vehicles', 'Driving', C.blue), W('parked', 'Parked', C.orange)] },
  { id: 'moving', tab: 'traffic', title: 'Citizens on the move', unit: '', series: [W('moving', 'Travelling', C.green)] },
  { id: 'riders', tab: 'traffic', title: 'Transit boardings per hour', unit: '/h', series: [W('riders', 'Boardings', C.violet)], note: 'Buses and trains' },
  { id: 'eduIndex', tab: 'education', title: 'Education index', unit: '', fit: true, series: [W('eduIndex', 'Index', C.violet)], note: 'Residents aged 25-64: 20 \u00d7 their mean level (none 0 to postgraduate 5), so 0-100' },
  { id: 'enrolled', tab: 'education', title: 'Enrolled by stage', unit: '', series: [W('stNursery', 'Nursery', C.teal), W('stPrimary', 'Primary', C.green), W('stSecondary', 'Secondary', C.blue), W('stSixth', 'Sixth form and FE', C.violet), W('stHigher', 'University', C.orange), W('stAdult', 'Adult courses', C.red)] },
  { id: 'graduates', tab: 'education', title: 'Graduates in town', unit: '', series: [{ key: 'graduates', label: 'Degree or more', color: C.green, src: 'w', calc: { a: 'lvlDegree', b: 'lvlPostgrad', fn: (a, b) => a + b } }], note: 'Adults who hold a degree or a postgraduate degree' },
  { id: 'results', tab: 'education', title: 'Results in the last 24 hours', unit: '', series: [W('passDay', 'Passed', C.green), W('dropDay', 'Failed or dropped out', C.orange)], note: 'Results come on Saturdays, so the figures step up then and fade over a day' },
  { id: 'levels', tab: 'education', title: 'Adults by highest qualification', unit: '', series: [W('lvlNone', 'None', C.red), W('lvlPrimary', 'Primary', C.orange), W('lvlSecondary', 'GCSEs', C.teal), W('lvlFurther', 'Level 3', C.blue), W('lvlDegree', 'Degree', C.green), W('lvlPostgrad', 'Postgraduate', C.violet)] },
  { id: 'myschools', tab: 'education', title: 'Your schools', unit: '', series: [P('myPupils', 'Pupils', C.blue), P('myPlaces', 'Places', C.orange)], note: 'School places on your land, and how many are filled' },
  { id: 'mygrads', tab: 'education', title: 'Graduates on your land', unit: '', series: [P('myGrads', 'Graduates', C.green)], note: 'Residents of your parcels with a degree or more' },
  { id: 'tick', tab: 'traffic', title: 'Server tick time (ms)', unit: 'ms', series: [W('tickMs', 'Average', C.blue), W('tickP95', '95th percentile', C.orange)], note: 'Over the last minute at each sample' },
];
const TAB_OF = new Map(CHARTS.map((c) => [c.id, c.tab]));

// ---- numbers and time ------------------------------------------------------------------------

/** A tidy axis: a lower and upper bound on multiples of `step`, about `n` intervals. */
export function niceScale(min: number, max: number, n = 4): { lo: number; hi: number; step: number } {
  if (!(max > min)) { const b = Math.max(1, Math.abs(max)); min -= b * 0.5; max += b * 0.5; if (min < 0 && max - b * 0.5 >= 0) min = 0; }
  const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  return { lo: Math.floor(min / step + 1e-9) * step, hi: Math.ceil(max / step - 1e-9) * step, step };
}
const SUFFIX = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const;
/** compact figure for an axis or a header: 1.2k, 3.4M */
function compact(v: number, digits = 1): string {
  const a = Math.abs(v);
  for (const [d, s] of SUFFIX) if (a >= d) return `${trim(v / d, a / d >= 100 ? 0 : digits)}${s}`;
  return trim(v, a >= 100 ? 0 : a >= 10 ? 1 : 2);
}
const trim = (v: number, d: number) => String(+v.toFixed(d));
/** an axis label: enough digits that neighbouring ticks (`step` apart) read differently (16.66k, 16.68k), and no unit for ms or per hour (the title says it) */
function fmtAxis(v: number, unit: ChartSpec['unit'], step: number): string {
  if (unit === '%') return `${Math.round(v)}%`;
  const a = Math.abs(v), sign = v < 0 ? '\u2212' : '', pre = unit === '$' ? '$' : '';
  for (const [d, suf] of SUFFIX) if (Math.max(a, step) >= d) return `${sign}${pre}${trim(a / d, Math.min(3, Math.max(0, Math.ceil(-Math.log10(step / d) - 1e-9))))}${suf}`;
  return `${sign}${pre}${trim(a, Math.min(2, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))))}`;
}
function fmtVal(v: number, unit: ChartSpec['unit'], exact = false): string {
  if (!Number.isFinite(v)) return 'n/a';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  switch (unit) {
    case '$': return `${sign}$${exact && a < 1e6 ? Math.round(a).toLocaleString() : compact(a)}`;
    case '%': return `${sign}${Math.round(a)}%`;
    case 'ms': return `${sign}${a >= 10 ? a.toFixed(0) : a.toFixed(1)} ms`;
    case '/h': return `${sign}${exact ? Math.round(a).toLocaleString() : compact(a)}/h`;
    default: return `${sign}${exact && a < 1e6 ? Math.round(a).toLocaleString() : compact(a)}`;
  }
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const dayOf = (h: number) => Math.floor(h / 24);
const hourLabel = (h: number) => `${pad2(((h % 24) + 24) % 24)}:00`;
/** the time of a sample: an hour, a day's average or a week's average */
function whenLabel(h: number, span: number): string {
  if (span === 1) return `day ${dayOf(h)}, ${hourLabel(h)}`;
  if (span === 24) return `day ${dayOf(h)} (average)`;
  return `days ${dayOf(h)}–${dayOf(h) + 6} (average)`;
}
const X_STEPS = [1, 2, 3, 6, 12, 24, 48, 72, 120, 168, 336, 720, 1440, 2400, 4800, 8760, 17520, 43800];

// ---- the panel -------------------------------------------------------------------------------

const PAD = { l: 42, r: 10, t: 8, b: 20 };
const CH = 124; // canvas height in css px
interface Card {
  spec: ChartSpec; el: HTMLElement; canvas: HTMLCanvasElement; head: HTMLElement; legend: HTMLElement | null;
  /** what was last drawn, for hover */
  xs: number[]; starts: number[]; span: number; ys: number[][]; x0: number; x1: number;
}

export class ChartsPanel {
  private el: HTMLDivElement;
  private chip: HTMLButtonElement;
  private grid!: HTMLDivElement;
  private foot!: HTMLElement;
  private open = false;
  /** the history was asked for (it is asked again after a reconnect) */
  private asked = false;
  private tab: Tab = 'city';
  private range: Range = 'week';
  private world: Rings | null = null;
  private mine: Rings | null = null;
  private cards: Card[] = [];
  /** shared hover time (game hours) and the card under the pointer */
  private hoverT: number | null = null;
  private hoverCard: Card | null = null;
  private raf = 0;
  /** the signed-in player, for the milestones in the education funnel (main.ts sets it) */
  me: () => PlayerDTO | undefined = () => undefined;
  private funnel: HTMLElement | null = null;
  private sparks: { canvas: HTMLCanvasElement; key: string; src: 'w' | 'p' }[] = [];
  private colors = { fg: '#e6e9ef', muted: '#8a93a3', line: 'rgba(255,255,255,0.08)', panel: '#10141b' };

  constructor(private net: NetClient) {
    this.chip = document.createElement('button');
    this.chip.className = 'chip'; this.chip.id = 'chartsBtn'; this.chip.textContent = 'charts';
    this.chip.title = 'Charts: how your city grows over time (`)';
    document.getElementById('techBtn')!.before(this.chip);
    this.chip.onclick = () => this.toggle();
    this.el = document.createElement('div');
    this.el.id = 'charts'; this.el.className = 'hidden';
    document.getElementById('ui')!.appendChild(this.el);
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.buildShell();

    net.on('history', (m) => {
      this.world = Rings.fromDTO(WORLD_KEYS, m.world);
      this.mine = Rings.fromDTO(PLAYER_KEYS, m.mine);
      this.changed();
    });
    net.on('histSample', (m) => {
      if (!this.world || !this.mine) return;
      this.world.push(m.hour, m.w); this.mine.push(m.hour, m.p);
      this.changed();
    });
    // a server restart or a reconnect: ask again, the feed is per connection
    net.tap((m) => { if (m.t === 'welcome' && this.asked) this.net.send({ t: 'hist', open: true }); });

    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Backquote') { this.toggle(); e.preventDefault(); }
      else if (e.code === 'Escape' && this.open) this.toggle(false);
    });
    window.addEventListener('resize', () => { if (this.open) this.schedule(); });
    new ResizeObserver(() => { if (this.open) this.schedule(); }).observe(this.el);
  }

  get isOpen() { return this.open; }

  /** Open or close the panel; the first opening asks the server for the history. */
  toggle(open = !this.open) {
    this.open = open;
    this.el.classList.toggle('hidden', !open);
    this.chip.classList.toggle('on', open);
    if (open) {
      if (!this.asked) { this.asked = true; this.net.send({ t: 'hist', open: true }); } // once asked, the feed stays on for the session: it is one small sample an hour
      this.readColors();
      this.render();
    }
  }
  /** Open on the tab that holds a chart (a click on a top-bar figure) and flash it. */
  show(chartId: string) {
    const tab = TAB_OF.get(chartId);
    if (!tab) return this.toggle(true);
    this.tab = tab;
    this.toggle(true);
    this.render();
    const card = this.cards.find((c) => c.spec.id === chartId);
    card?.el.classList.add('flash');
    card?.el.scrollIntoView({ block: 'nearest' });
    setTimeout(() => card?.el.classList.remove('flash'), 1600);
  }

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    this.colors = { fg: get('--fg', this.colors.fg), muted: get('--muted', this.colors.muted), line: get('--line', this.colors.line), panel: '#10141b' };
  }

  private changed() {
    this.drawSparks();
    if (this.open) this.schedule();
  }
  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.drawAll(); });
  }

  // ---- DOM -----------------------------------------------------------------------------------

  private buildShell() {
    this.el.innerHTML = `<div class="chhead">
        <h2>Charts</h2>
        <div class="chtabs" role="tablist">${TABS.map((t) => `<button class="chtab" role="tab" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
        <div class="chranges" role="group" aria-label="Time range">${RANGES.map((r) => `<button class="chrange" data-range="${r.id}" title="${r.title}">${r.label}</button>`).join('')}</div>
        <button class="chclose" title="Close (Esc)" aria-label="Close">×</button>
      </div>
      <div class="chgrid"></div>
      <div class="chfoot"></div>`;
    this.grid = this.el.querySelector('.chgrid')!;
    this.foot = this.el.querySelector('.chfoot')!;
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      const range = t.closest<HTMLElement>('[data-range]')?.dataset.range as Range | undefined;
      if (tab) { this.tab = tab; this.render(); }
      else if (range) { this.range = range; this.render(); }
      else if (t.closest('.chclose')) this.toggle(false);
    });
    this.grid.addEventListener('pointerleave', () => this.setHover(null, null));
  }

  private render() {
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === this.tab); b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)); }
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-range]')) b.classList.toggle('on', b.dataset.range === this.range);
    this.grid.textContent = '';
    this.cards = [];
    this.funnel = null;
    if (this.tab === 'education') {
      this.funnel = document.createElement('div');
      this.funnel.className = 'chcard chfunnel';
      this.grid.appendChild(this.funnel);
    }
    for (const spec of CHARTS.filter((c) => c.tab === this.tab)) {
      const el = document.createElement('div');
      el.className = 'chcard'; el.dataset.chart = spec.id;
      el.innerHTML = `<div class="chtop"><span class="chtitle">${spec.title}</span><span class="chval"></span></div>
        <canvas height="${CH}" aria-label="${spec.title}"></canvas>
        ${spec.series.length > 1 ? `<div class="chlegend">${spec.series.map((s) => `<span data-s="${s.key}"><i style="background:${s.color}"></i>${s.label} <b></b></span>`).join('')}</div>` : (spec.note ? `<div class="chnote">${spec.note}</div>` : '')}`;
      const canvas = el.querySelector('canvas')!;
      const card: Card = { spec, el, canvas, head: el.querySelector('.chval')!, legend: el.querySelector('.chlegend'), xs: [], starts: [], span: 1, ys: [], x0: 0, x1: 1 };
      canvas.addEventListener('pointermove', (e) => this.pointer(card, e));
      canvas.addEventListener('pointerdown', (e) => this.pointer(card, e));
      canvas.addEventListener('pointercancel', () => this.setHover(null, null));
      canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') this.setHover(null, null); });
      this.grid.appendChild(el);
      this.cards.push(card);
    }
    this.drawAll();
  }

  // ---- data ----------------------------------------------------------------------------------

  /** Which tier and which span of hours the range shows (from the world rings' clock). */
  private plan(): { ti: number; from: number } | null {
    const w = this.world;
    if (!w || w.hour < 0) return null;
    const now = w.hour;
    switch (this.range) {
      case 'day': return { ti: 0, from: now - 23 };
      case 'week': return { ti: 0, from: now - 167 };
      case 'month': return { ti: 1, from: now - 30 * 24 + 1 };
      default: {
        const d = w.read(0, 1);
        const days = d ? d.v.length : 0;
        // the weekly record only helps once the daily one is full (a younger city shows all of it by the day)
        return days > HIST_TIERS[1].size ? { ti: 2, from: 0 } : days > 1 ? { ti: 1, from: 0 } : { ti: 0, from: 0 };
      }
    }
  }

  private load(card: Card, p: { ti: number; from: number }) {
    const { spec } = card;
    const span = HIST_TIERS[p.ti].hours;
    const src = (s: SeriesSpec) => (s.src === 'p' ? this.mine : this.world);
    // all series of a chart share the x grid of the first one that has data
    const reads = spec.series.map((s) => {
      const r = src(s);
      if (s.calc) { const a = r?.read(r.keys.indexOf(s.calc.a), p.ti), b = r?.read(r.keys.indexOf(s.calc.b), p.ti); return a && b ? { first: a.first, hours: a.hours, v: a.v.map((v, i) => s.calc!.fn(v, b.v[i])) } : null; }
      return r?.read(r.keys.indexOf(s.key), p.ti) ?? null;
    });
    const base = reads.find((r) => r);
    if (!base || !this.world) { card.xs = []; card.ys = spec.series.map(() => []); return; }
    const now = this.world.hour;
    const xs: number[] = [];
    for (let i = 0; i < base.v.length; i++) xs.push(Math.min((base.first + i) * span + (span - 1) / 2, now));
    const keep = xs.map((x) => x >= p.from - (span - 1) / 2);
    card.span = span;
    card.xs = xs.filter((_, i) => keep[i]);
    card.starts = xs.map((_, i) => (base.first + i) * span).filter((_, i) => keep[i]);
    card.ys = reads.map((r) => {
      const out: number[] = [];
      for (let i = 0; i < xs.length; i++) if (keep[i]) out.push(r && r.first === base.first && i < r.v.length ? r.v[i] : NaN);
      return out;
    });
    // a younger city: the chart starts at its first sample
    const lo = Math.max(p.from, card.xs[0] ?? p.from);
    card.x0 = card.xs.length > 1 ? lo : now - 5;
    card.x1 = Math.max(now, card.x0 + 1);
  }

  // ---- hover ---------------------------------------------------------------------------------

  private pointer(card: Card, e: PointerEvent) {
    const r = card.canvas.getBoundingClientRect();
    const plotW = r.width - PAD.l - PAD.r;
    if (plotW <= 0 || !card.xs.length) return;
    const t = card.x0 + ((e.clientX - r.left - PAD.l) / plotW) * (card.x1 - card.x0);
    let best = 0;
    for (let i = 1; i < card.xs.length; i++) if (Math.abs(card.xs[i] - t) < Math.abs(card.xs[best] - t)) best = i;
    this.setHover(card.xs[best], card);
  }
  private setHover(t: number | null, card: Card | null) {
    if (t === this.hoverT && card === this.hoverCard) return;
    this.hoverT = t; this.hoverCard = card;
    this.schedule();
  }

  // ---- drawing -------------------------------------------------------------------------------

  private drawAll() {
    if (!this.open) return;
    const p = this.plan();
    this.foot.textContent = p
      ? `One sample per game hour. Hourly for the last ${HIST_TIERS[0].size / 24} days, daily for ${HIST_TIERS[1].size} days, weekly beyond. Now: day ${dayOf(this.world!.hour)}, ${hourLabel(this.world!.hour)}.`
      : 'The city records one sample per game hour.';
    for (const card of this.cards) {
      if (p) this.load(card, p); else { card.xs = []; card.ys = card.spec.series.map(() => []); }
      this.drawCard(card);
    }
    if (this.funnel) this.drawFunnel(this.funnel);
  }

  /** The newest value of a world series (the latest hourly sample), or null before there is one. */
  private latest(key: string): number | null {
    const r = this.world?.read(this.world.keys.indexOf(key), 0);
    if (!r) return null;
    for (let i = r.v.length - 1; i >= 0; i--) if (Number.isFinite(r.v[i])) return r.v[i];
    return null;
  }

  /**
   * The attainment funnel: how many adults reached each level, who is enrolled where, this day's results and the
   * next education milestone of the tech tree (docs/education.md section 14). Built from the newest hourly sample.
   */
  private drawFunnel(el: HTMLElement) {
    const lv = ['lvlNone', 'lvlPrimary', 'lvlSecondary', 'lvlFurther', 'lvlDegree', 'lvlPostgrad'].map((k) => this.latest(k));
    if (lv.some((v) => v === null)) { el.innerHTML = `<div class="chtop"><span class="chtitle">Qualifications of adults</span></div><div class="chnote">${this.world ? 'The first sample lands next game hour.' : 'Loading the history\u2026'}</div>`; return; }
    const n = lv as number[];
    const total = n.reduce((a, b) => a + b, 0) || 1;
    const idx = this.latest('eduIndex') ?? 0;
    let above = total;
    const fun = n.map((count, l) => {
      const reached = above; above -= count;
      const share = reached / total;
      return `<div class="funrow"><span class="funlab">${l === 0 ? 'Adults (18+)' : EDU_LEVEL_NAMES[l].replace(/^./, (ch) => ch.toUpperCase())}</span>`
        + `<span class="funbar"><i style="width:${Math.max(1.5, 100 * share).toFixed(1)}%;opacity:${(0.95 - l * 0.11).toFixed(2)}"></i></span>`
        + `<span class="funnum"><b>${Math.round(100 * share)}%</b> <em>${count.toLocaleString()} ${l === 0 ? 'with none' : 'stop here'}</em></span></div>`;
    }).join('');
    const stages: [string, string][] = [['Nursery', 'stNursery'], ['Primary', 'stPrimary'], ['Secondary', 'stSecondary'], ['Sixth form and FE', 'stSixth'], ['University', 'stHigher'], ['Adult courses', 'stAdult']];
    const enrolled = stages.map(([label, k]) => `<div class="funst"><span>${label}</span><b>${Math.round(this.latest(k) ?? 0).toLocaleString()}</b></div>`).join('');
    const pass = Math.round(this.latest('passDay') ?? 0), drop = Math.round(this.latest('dropDay') ?? 0);
    el.innerHTML = `<div class="chtop"><span class="chtitle">How far adults got</span><span class="chval">education index <b>${idx.toFixed(0)}</b></span></div>
      <div class="funbody"><div class="funrows">${fun}</div>
      <div class="funside"><div class="funhead">Enrolled now</div>${enrolled}
        <div class="funhead">Last 24 hours</div><div class="funst"><span>Passed</span><b>${pass}</b></div><div class="funst"><span>Failed or dropped out</span><b class="${drop > pass ? 'bad' : ''}">${drop}</b></div>
        ${this.milestone()}</div></div>
      <div class="chnote">Each bar is the share of adults who reached that level or better; the figure after it is how many stopped there.</div>`;
  }

  /** The next education node you have not unlocked and how far its condition is (the progress counters of your parcels). */
  private milestone(): string {
    const me = this.me();
    if (!me) return '';
    const next = TECH.filter((t) => t.track === 'education' && !t.locked && !me.tech.includes(t.id)).sort((a, b) => a.tier - b.tier)[0];
    if (!next) return `<div class="funhead">Next milestone</div><div class="funms">Every education node is unlocked.</div>`;
    const what: Record<string, string> = { pupils: 'pupils at school', graduates: 'graduates', housed: 'residents', jobs: 'jobs filled' };
    const have = me.progress[next.condition.counter] ?? 0, need = next.condition.min;
    return `<div class="funhead">Next milestone</div><div class="funms"><b>${next.name}</b>: ${need} ${what[next.condition.counter] ?? next.condition.counter}<span class="funbar ms"><i style="width:${Math.min(100, (100 * have) / need).toFixed(0)}%"></i></span><em>${Math.min(have, need)} of ${need}</em></div>`;
  }

  private drawCard(card: Card) {
    const { canvas, spec } = card;
    const cssW = canvas.clientWidth;
    if (cssW < 40) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(CH * dpr)) { canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(CH * dpr); }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, CH);
    const { muted } = this.colors;
    const plot = { l: PAD.l, r: cssW - PAD.r, t: PAD.t, b: CH - PAD.b };
    const n = card.xs.length;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';

    // hovered sample: the one nearest the shared hover time
    let hi = -1;
    if (this.hoverT !== null && n) {
      hi = 0;
      for (let i = 1; i < n; i++) if (Math.abs(card.xs[i] - this.hoverT) < Math.abs(card.xs[hi] - this.hoverT)) hi = i;
      if (Math.abs(card.xs[hi] - this.hoverT) > Math.max(card.span, (card.x1 - card.x0) / 20)) hi = -1;
    }
    this.readout(card, hi);

    if (n < 2) {
      ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.world ? (n ? 'Collecting: the second sample lands next game hour' : 'No samples yet: one is taken every game hour') : 'Loading the history…', cssW / 2, CH / 2 - 4);
      return;
    }

    // y axis: from zero for counts, fitted for a treasury or a net
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) if (card.xs[i] >= card.x0) for (const ys of card.ys) { const v = ys[i]; if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } }
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    // counts start at zero, unless they stay in the top half of the range (then the axis is fitted so growth shows)
    if (!spec.fit && min > 0 && (spec.unit === '%' || min < max * 0.5)) min = 0;
    if (spec.unit === '%') max = Math.max(max, 100);
    let sc = niceScale(min, max, CH < 140 ? 3 : 4);
    // whole things (people, cars, dollars): never a fractional axis for a handful of them
    if (sc.step < 1 && spec.unit !== 'ms' && spec.unit !== '%') sc = { lo: Math.floor(min), hi: Math.max(Math.floor(min) + 3, Math.ceil(max)), step: 1 };
    const X = (t: number) => plot.l + ((t - card.x0) / (card.x1 - card.x0)) * (plot.r - plot.l);
    const Y = (v: number) => plot.b - ((v - sc.lo) / (sc.hi - sc.lo)) * (plot.b - plot.t);

    // grid and y labels
    ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = sc.lo; v <= sc.hi + sc.step * 1e-6; v += sc.step) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < sc.step * 1e-6 && sc.lo < 0 ? 'rgba(255,255,255,0.22)' : this.colors.line;
      ctx.beginPath(); ctx.moveTo(plot.l, y); ctx.lineTo(plot.r, y); ctx.stroke();
      ctx.fillStyle = muted; ctx.fillText(fmtAxis(v, spec.unit, sc.step), plot.l - 6, y);
    }
    // x ticks at tidy hours
    const pxPerHour = (plot.r - plot.l) / (card.x1 - card.x0);
    const step = X_STEPS.find((s) => s * pxPerHour >= 62) ?? X_STEPS[X_STEPS.length - 1];
    ctx.textBaseline = 'top';
    let lastRight = -Infinity;
    for (let t = Math.ceil(card.x0 / step) * step; t <= card.x1; t += step) {
      const x = X(t);
      const label = step < 24 && t % 24 !== 0 ? hourLabel(t) : `day ${dayOf(t)}`;
      const w = ctx.measureText(label).width;
      ctx.strokeStyle = this.colors.line; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, plot.b); ctx.lineTo(Math.round(x) + 0.5, plot.b + 3); ctx.stroke();
      if (x - w / 2 < lastRight + 6 || x + w / 2 > cssW) continue;
      ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.fillText(label, x, plot.b + 6);
      lastRight = x + w / 2;
    }

    // lines (2px, gaps break them); one series also gets a soft area under it
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    spec.series.forEach((s, k) => {
      const ys = card.ys[k];
      if (spec.series.length === 1) {
        const grad = ctx.createLinearGradient(0, plot.t, 0, plot.b);
        grad.addColorStop(0, hexA(s.color, 0.22)); grad.addColorStop(1, hexA(s.color, 0));
        ctx.fillStyle = grad;
        const base = Y(Math.max(sc.lo, Math.min(0, sc.hi)));
        let start = -1;
        const close = (end: number) => { if (start >= 0 && end > start) { ctx.lineTo(X(card.xs[end]), base); ctx.lineTo(X(card.xs[start]), base); ctx.closePath(); ctx.fill(); } start = -1; };
        for (let i = 0; i < n; i++) {
          if (!Number.isFinite(ys[i])) { if (start >= 0) close(i - 1); continue; }
          if (start < 0) { start = i; ctx.beginPath(); ctx.moveTo(X(card.xs[i]), Y(ys[i])); } else ctx.lineTo(X(card.xs[i]), Y(ys[i]));
        }
        close(n - 1);
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = 2;
      let pen = false;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = ys[i];
        if (!Number.isFinite(v)) { pen = false; continue; }
        if (pen) ctx.lineTo(X(card.xs[i]), Y(v)); else { ctx.moveTo(X(card.xs[i]), Y(v)); pen = true; }
      }
      ctx.stroke();
      // the newest point
      for (let i = n - 1; i >= 0; i--) if (Number.isFinite(ys[i])) { dot(ctx, X(card.xs[i]), Y(ys[i]), 3, s.color, this.colors.panel); break; }
    });

    // crosshair, markers and (on the card under the pointer) a tooltip with the values
    if (hi >= 0) {
      const x = X(card.xs[hi]);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, plot.t); ctx.lineTo(Math.round(x) + 0.5, plot.b); ctx.stroke();
      spec.series.forEach((s, k) => { const v = card.ys[k][hi]; if (Number.isFinite(v)) dot(ctx, x, Y(v), 4, s.color, this.colors.panel); });
      if (card === this.hoverCard) this.tooltip(ctx, card, hi, x, plot, cssW);
    }
  }

  private tooltip(ctx: CanvasRenderingContext2D, card: Card, hi: number, x: number, plot: { l: number; r: number; t: number; b: number }, cssW: number) {
    const { spec } = card;
    const lines = [{ text: whenLabel(tipHour(card, hi), card.span), color: '' }];
    for (let k = 0; k < spec.series.length; k++) lines.push({ text: `${spec.series[k].label}  ${fmtVal(card.ys[k][hi], spec.unit, true)}`, color: spec.series[k].color });
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    const w = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 26, h = lines.length * 15 + 8;
    let bx = x + 10;
    if (bx + w > cssW - 2) bx = x - 10 - w;
    bx = Math.max(plot.l, bx);
    const by = plot.t + 2;
    ctx.fillStyle = 'rgba(8,11,16,0.94)'; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
    roundRect(ctx, bx, by, w, h, 6); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      const y = by + 4 + i * 15 + 7.5;
      if (l.color) { ctx.fillStyle = l.color; ctx.fillRect(bx + 8, y - 4, 8, 8); }
      ctx.fillStyle = i === 0 ? this.colors.muted : this.colors.fg;
      ctx.fillText(l.text, bx + (l.color ? 21 : 8), y);
    });
  }

  /** The header's figure (and each legend entry's): the hovered sample, or the newest one with its change over the range. */
  private readout(card: Card, hi: number) {
    const { spec } = card;
    const n = card.xs.length;
    const at = (k: number) => { if (hi >= 0) return card.ys[k][hi]; for (let i = n - 1; i >= 0; i--) if (Number.isFinite(card.ys[k][i])) return card.ys[k][i]; return NaN; };
    if (card.legend) {
      spec.series.forEach((s, k) => { const b = card.legend!.querySelector(`[data-s="${s.key}"] b`); if (b) b.textContent = n ? fmtVal(at(k), spec.unit, true) : ''; });
      card.head.innerHTML = hi >= 0 ? `<span class="chwhen">${whenLabel(tipHour(card, hi), card.span)}</span>` : '';
      return;
    }
    if (!n) { card.head.textContent = ''; return; }
    const v = at(0);
    let delta = '';
    if (hi < 0) {
      const first = card.ys[0].find((x) => Number.isFinite(x));
      if (first !== undefined && Number.isFinite(v) && n > 1) {
        const d = v - first;
        const pct = first !== 0 && spec.unit !== '%' ? Math.round((100 * d) / Math.abs(first)) : null;
        const txt = pct !== null ? `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%` : `${d >= 0 ? '+' : '−'}${fmtVal(Math.abs(d), spec.unit)}`;
        delta = ` <i class="chdelta">${txt}</i>`;
      }
    }
    card.head.innerHTML = `${hi >= 0 ? `<span class="chwhen">${whenLabel(tipHour(card, hi), card.span)}</span> ` : ''}<b>${fmtVal(v, spec.unit, true)}</b>${delta}`;
  }

  // ---- sparklines in the top bar -------------------------------------------------------------

  /** A tiny trend line beside the treasury figure, once the history is here. Click opens the chart. */
  private drawSparks() {
    if (!this.world || !this.mine) return;
    if (!this.sparks.length) {
      const mk = (anchor: string, where: 'before' | 'after', key: string, src: 'w' | 'p', chart: string, title: string) => {
        const el = document.getElementById(anchor);
        if (!el) return;
        const canvas = document.createElement('canvas');
        canvas.className = 'spark'; canvas.width = 64; canvas.height = 22; canvas.title = title; canvas.dataset.chart = chart;
        canvas.onclick = () => this.show(chart);
        if (where === 'after') el.after(canvas); else el.before(canvas);
        this.sparks.push({ canvas, key, src });
      };
      mk('money', 'after', 'money', 'p', 'money', 'Your treasury over the last game day (click for the chart)');
    }
    for (const s of this.sparks) {
      const r = s.src === 'p' ? this.mine : this.world;
      const read = r.read(r.keys.indexOf(s.key), 0);
      const v = read ? read.v.slice(-24).filter(Number.isFinite) : [];
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const cw = 64, ch = 22;
      if (s.canvas.width !== cw * dpr) { s.canvas.width = cw * dpr; s.canvas.height = ch * dpr; s.canvas.style.width = `${cw}px`; s.canvas.style.height = `${ch}px`; }
      const ctx = s.canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
      if (v.length < 2) continue;
      const lo = Math.min(...v), hiV = Math.max(...v), rng = hiV - lo || 1;
      ctx.strokeStyle = this.colors.muted; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
      v.forEach((x, i) => { const px = 2 + (i / (v.length - 1)) * (cw - 4), py = ch - 3 - ((x - lo) / rng) * (ch - 6); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.stroke();
      const last = v[v.length - 1];
      dot(ctx, cw - 2, ch - 3 - ((last - lo) / rng) * (ch - 6), 2, C.green, 'transparent');
    }
  }
}

/** the first hour of the period a sample covers (hourly: the hour itself) */
const tipHour = (card: Card, hi: number) => card.starts[hi];
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, ring: string) {
  if (ring !== 'transparent') { ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const STYLE = `
#charts { position: absolute; right: 12px; top: 52px; width: min(1040px, calc(100vw - 244px)); max-height: calc(100vh - 70px); overflow-y: auto; padding: 12px 14px 10px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; backdrop-filter: blur(10px); font-size: 12px; z-index: 5; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent; }
#charts.hidden { display: none; }
#charts .chhead { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 10px; }
#charts h2 { margin: 0; font-size: 16px; }
#charts .chtabs, #charts .chranges { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,0.03); }
#charts .chranges { margin-left: auto; }
#charts .chtab, #charts .chrange { padding: 4px 11px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
#charts .chtab:hover, #charts .chrange:hover { color: var(--fg); }
#charts .chtab.on, #charts .chrange.on { background: rgba(98,210,162,0.18); color: var(--fg); box-shadow: 0 0 0 1px rgba(98,210,162,0.5) inset; }
#charts .chclose { width: 26px; height: 26px; border: 1px solid var(--line); border-radius: 50%; background: transparent; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
#charts .chclose:hover { color: var(--fg); background: rgba(255,255,255,0.08); }
#charts .chgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
#charts .chcard { min-width: 0; padding: 8px 10px 6px; border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,0.025); transition: box-shadow .3s, border-color .3s; }
#charts .chcard.flash { border-color: rgba(98,210,162,0.8); box-shadow: 0 0 0 2px rgba(98,210,162,0.3); }
#charts .chtop { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-height: 18px; }
#charts .chtitle { color: var(--fg); font-weight: 600; font-size: 12px; }
#charts .chval { color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#charts .chval b { color: var(--fg); font-size: 14px; }
#charts .chdelta { font-style: normal; font-size: 11px; margin-left: 4px; }
#charts .chwhen { font-size: 11px; }
#charts canvas { display: block; width: 100%; height: ${CH}px; margin-top: 2px; touch-action: pan-y; cursor: crosshair; }
#charts .chlegend { display: flex; flex-wrap: wrap; gap: 2px 14px; margin-top: 2px; color: var(--muted); font-variant-numeric: tabular-nums; }
#charts .chlegend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
#charts .chlegend b { color: var(--fg); font-weight: 600; margin-left: 2px; }
#charts .chnote { margin-top: 2px; color: var(--muted); font-size: 11px; }
#charts .chfunnel { grid-column: 1 / -1; }
#charts .funbody { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(190px, 1fr); gap: 4px 22px; margin: 6px 0 2px; }
#charts .funrow { display: grid; grid-template-columns: 112px 1fr 148px; align-items: center; gap: 8px; margin: 5px 0; }
#charts .funlab { color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#charts .funbar { display: block; height: 14px; border-radius: 3px; background: rgba(255,255,255,0.05); overflow: hidden; }
#charts .funbar i { display: block; height: 100%; border-radius: 3px; background: #5aa8ff; }
#charts .funbar.ms { height: 5px; margin: 4px 0 2px; } #charts .funbar.ms i { background: var(--accent); }
#charts .funnum { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
#charts .funnum b { color: var(--fg); font-size: 13px; } #charts .funnum em, #charts .funms em { font-style: normal; font-size: 11px; }
#charts .funhead { margin: 8px 0 3px; color: var(--muted); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
#charts .funhead:first-child { margin-top: 0; }
#charts .funst { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-variant-numeric: tabular-nums; }
#charts .funst b { color: var(--fg); font-weight: 600; }
#charts .funms { color: var(--muted); } #charts .funms b { color: var(--fg); }
#charts .chfoot { margin-top: 8px; color: var(--muted); font-size: 11px; }
.spark { display: inline-block; vertical-align: middle; margin-left: 6px; cursor: pointer; opacity: 0.85; }
.spark:hover { opacity: 1; }
.chartlink { cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
@media (max-width: 700px) {
  #charts { left: 8px; right: 8px; top: 48px; width: auto; max-height: calc(100vh - 56px); padding: 10px; }
  #charts .chgrid { grid-template-columns: 1fr; }
  #charts .funbody { grid-template-columns: 1fr; }
  #charts .funrow { grid-template-columns: 92px 1fr 118px; }
  #charts .chtabs { order: 3; width: 100%; overflow-x: auto; }
  #charts .chranges { margin-left: 0; }
  #charts h2 { margin-right: auto; }
}
`;
