import {
  GOALS, GOAL_BY_ID, GOAL_PREVIEW, HINTS, TECH, TECH_BY_ID, LEDGER_LABELS, TICKS_PER_HOUR, hash2, rewardText, isHintId,
  type GoalDef, type GoalsDTO, type HintId, type LedgerCat, type PlayerDTO, type ServerMsg,
} from '@msimcity/shared';
import type { NetClient } from './net';
import type { ClientWorld } from './world';
import { ladderOfTool } from './picker';

/**
 * Onboarding on the client (shared/src/goals.ts, server/src/goals.ts): the goals card under the tool bar's corner with
 * a "show me" for the active goal, the celebration when one is done, the advisor's hint strip, and the tech chip that
 * pulses when a node becomes ready to buy. The server decides what is done and what to hint; this only shows it.
 * Nothing appears until the server sends goals (test cities and demos never do), except the tech chip.
 */
export interface OnboardingDeps {
  net: NetClient;
  world: ClientWorld;
  /** pick a build tool, as its key would */
  tool(t: string): void;
  /** look at a tile from a comfortable height */
  focus(x: number, y: number): void;
  /** open the tech tree */
  openTech(): void;
  /** the server's tick now (main.ts liveTick) */
  liveTick(): number;
  /** fall back to a plain toast (no goals from this server) */
  toast(kind: 'info' | 'error', msg: string): void;
  /** a camera moment at a tile with a caption (moment.ts): the first settlers arriving */
  moment?(x: number, y: number, caption: string): void;
}

/** At most one hint per this many ticks (two game hours), and how long an undismissed one stays up (real ms). */
const HINT_GAP = TICKS_PER_HOUR * 2;
const HINT_STAYS = 90_000;
/** Open land beside the Commons' east edge road (server seed.ts: the Commons is 22×22 from -11, -11). */
const COMMONS_EDGE: [number, number] = [16, 0];

/** Openers for a completed goal, picked per goal and day so two in a row rarely match. */
const CHEERS = ['Goal complete', 'Nicely done', 'Well played, Mayor', 'The town takes notice', 'Done and dusted', 'That\'s the way', 'Splendid', 'Onwards'];
const CLOSERS = ['Next up', 'Now for', 'On to', 'Your next goal'];

export class Onboarding {
  private goals: GoalsDTO | null = null;
  private card: HTMLDivElement;
  private chip: HTMLButtonElement;
  private strip: HTMLDivElement;
  private collapsed = false;
  /** hints waiting their turn (id -> wording), the one on screen and when the last one went up */
  private queue = new Map<HintId, string>();
  private showing: HintId | null = null;
  private shownAt = -Infinity;
  private hideTimer = 0;
  /** tech nodes ready to buy at the last players message */
  private ready = new Set<string>();

  constructor(private d: OnboardingDeps) {
    injectStyle();
    const ui = document.getElementById('ui')!;
    this.card = document.createElement('div'); this.card.id = 'goals'; this.card.className = 'hidden';
    this.strip = document.createElement('div'); this.strip.id = 'hintStrip'; this.strip.className = 'hidden';
    const col = document.createElement('div'); col.id = 'onb'; // the card with the hint strip under it, beside the tool bar
    col.append(this.card, this.strip);
    ui.append(col);
    this.chip = document.createElement('button'); this.chip.className = 'chip hidden'; this.chip.id = 'goalsBtn';
    document.getElementById('techBtn')!.before(this.chip);
    this.chip.onclick = () => {
      if (this.goals?.skipped) { d.net.send({ t: 'goals', op: 'resume' }); this.collapsed = false; }
      else this.collapsed = !this.collapsed;
      try { localStorage.setItem('msimcity.goalsCollapsed', this.collapsed ? '1' : ''); } catch { /* not remembered */ }
      this.render();
    };
    try { this.collapsed = localStorage.getItem('msimcity.goalsCollapsed') === '1'; } catch { /* storage blocked */ }
    d.net.on('goals', (m) => this.onGoals(m));
    d.net.on('hint', (m) => {
      // the first settlers (docs/first-five.md): the camera flies to them for a few seconds instead of a strip (once per player)
      if (m.id === 'settlers') { if (m.at && d.moment) d.moment(m.at[0], m.at[1], m.msg ?? HINTS.settlers.msg); return; }
      if (isHintId(m.id)) this.raise(m.id, m.msg);
    });
    d.net.tap((m) => this.tap(m));
    setInterval(() => this.pump(), 1000);
  }

  // ---- goals ---------------------------------------------------------------------------------

  private onGoals(m: Extract<ServerMsg, { t: 'goals' }>) {
    this.goals = m.goals;
    for (const id of m.goals.dismissed) if (isHintId(id)) this.queue.delete(id);
    if (this.showing && (m.goals.dismissed.includes(this.showing) || (m.goals.skipped && HINTS[this.showing].kind === 'tip'))) this.hideHint();
    if (m.completed) this.celebrate(m.completed.id, m.completed.reward);
    this.render();
  }

  private render() {
    const g = this.goals;
    if (!g) return;
    const def = g.active ? GOAL_BY_ID.get(g.active) : undefined;
    const n = g.done.length, total = GOALS.length;
    this.chip.classList.remove('hidden');
    this.chip.classList.toggle('on', !g.skipped && !this.collapsed && !!def);
    this.chip.textContent = g.skipped ? 'goals' : def ? `goals ${n}/${total}` : 'goals ✓';
    this.chip.title = g.skipped ? 'Resume the goals' : this.collapsed ? 'Show the goals card' : 'Hide the goals card';
    const show = !g.skipped && !this.collapsed && !!def;
    this.card.classList.toggle('hidden', !show);
    if (!show || !def) return;
    const next = GOALS.slice(GOALS.indexOf(def) + 1, GOALS.indexOf(def) + 1 + GOAL_PREVIEW);
    const bars = def.parts.map((p, i) => {
      const cur = Math.min(g.parts[i] ?? 0, p.target), pct = Math.round((100 * cur) / p.target);
      return `<div class="gpart"><span>${esc(p.label)}</span><span>${cur} / ${p.target}</span></div><div class="gbar"><i style="width:${pct}%"></i></div>`;
    }).join('');
    const reward = rewardText(def, techName);
    const fr = this.d.world.start === 'frontier' ? def.frontier : undefined; // a frontier's words (docs/first-five.md section 0)
    this.card.innerHTML = `
      <div class="ghead"><span class="gnum">Goal ${n + 1} of ${total}</span><button class="gx" id="gHide" title="Hide (the goals chip at the top brings it back)">–</button></div>
      <div class="gtitle">${esc(def.title)}</div>
      <div class="ghow">${esc(fr?.how ?? def.how)}</div>
      <div class="gwhy">${esc(fr?.why ?? def.why)}</div>
      ${bars}
      <div class="gfoot">${reward ? `<span class="greward">Reward: <b>${esc(reward)}</b></span>` : '<span></span>'}<button class="chip on" id="gShow">show me</button></div>
      ${next.length ? `<div class="gnext">Then: ${next.map((x) => esc(x.title)).join(' · ')}</div>` : ''}
      <div class="gskip"><a href="#" id="gSkip">skip the tutorial</a></div>`;
    this.card.querySelector<HTMLButtonElement>('#gShow')!.onclick = () => this.showMe(def);
    this.card.querySelector<HTMLButtonElement>('#gHide')!.onclick = () => this.chip.click();
    this.card.querySelector<HTMLAnchorElement>('#gSkip')!.onclick = (e) => {
      e.preventDefault();
      if (confirm('Skip the tutorial? Goals and tips stop (warnings about problems still come). The goals chip at the top brings them back.')) this.d.net.send({ t: 'goals', op: 'skip' });
    };
  }

  /** Pick the goal's tool (flashing its button), open its panel, and look somewhere sensible. */
  private showMe(def: Pick<GoalDef, 'show' | 'frontier'>) {
    const s = def.show, w = this.d.world;
    const tool = (w.start === 'frontier' && def.frontier?.tool) || s.tool;
    if (tool) { this.d.tool(tool); this.flash(tool); }
    if (s.panel) this.openPanel(s.panel);
    if (s.focus) {
      const plot = s.focus === 'plot' ? this.myPlot() : null;
      const home = w.home ?? COMMONS_EDGE; // a frontier's road end, or the open land beside the Commons
      if (w.start === 'frontier' && w.home) this.d.focus(w.home[0], w.home[1]); // the road end is where it all starts
      else if (plot) this.d.focus(plot[0], plot[1]); else this.d.focus(home[0], home[1]);
    }
  }
  private openPanel(p: 'tech' | 'ledger' | 'lines') {
    if (p === 'tech') this.d.openTech();
    else if (p === 'ledger') { if (!document.getElementById('ledgerBox')) document.getElementById('money')?.click(); }
    else document.getElementById('linesBtn')?.click();
  }
  /** The middle of the player's biggest parcel. */
  private myPlot(): [number, number] | null {
    let best: [number, number] | null = null, area = 0;
    for (const p of this.d.world.parcels.values()) {
      if (p.owner !== this.d.world.me || p.w * p.h <= area) continue;
      area = p.w * p.h; best = [Math.floor(p.x + p.w / 2), Math.floor(p.y + p.h / 2)];
    }
    return best;
  }
  /** Make a tool's button (or its size ladder's) glow for a few seconds. */
  private flash(tool: string) {
    const lad = ladderOfTool(tool);
    const b = document.querySelector<HTMLElement>(lad ? `#tools button[data-ladder="${lad.group.id}"]` : `#tools button[data-tool="${tool}"]`);
    if (!b) return;
    b.classList.remove('gflash'); void b.offsetWidth; b.classList.add('gflash');
    b.scrollIntoView({ block: 'nearest' });
    setTimeout(() => b.classList.remove('gflash'), 4200);
  }

  /** A completed goal: a toast with varied words, the reward and what comes next. */
  private celebrate(id: string, reward: string) {
    const def = GOAL_BY_ID.get(id as GoalDef['id']);
    if (!def) return;
    const i = GOALS.indexOf(def), day = Math.floor(this.d.liveTick() / (TICKS_PER_HOUR * 24));
    const cheer = CHEERS[Math.floor(hash2(i * 7 + 3, day) * CHEERS.length)];
    const next = GOALS[i + 1];
    const el = document.createElement('div');
    el.className = 'toast goaldone';
    el.style.setProperty('--tilt', `${((hash2(i, day + 5) - 0.5) * 2.4).toFixed(2)}deg`);
    el.innerHTML = `<b>${esc(cheer)}!</b> ${esc(def.title)}${reward ? ` <span class="gr">+ ${esc(reward)}</span>` : ''}${next && !this.goals?.skipped ? `<div class="gn">${esc(CLOSERS[Math.floor(hash2(day, i * 5 + 1) * CLOSERS.length)])}: ${esc(next.title)}</div>` : ''}`;
    document.getElementById('toasts')!.appendChild(el);
    setTimeout(() => el.remove(), 7000);
  }

  // ---- hints ---------------------------------------------------------------------------------

  /**
   * A hint from the client side (ui.ts asks before toasting the night notice). Returns false when this server sends no
   * goals, so the caller toasts it as before.
   */
  hint(id: HintId, msg?: string): boolean {
    if (!this.goals) return false;
    this.raise(id, msg);
    return true;
  }
  private raise(id: HintId, msg?: string) {
    const g = this.goals;
    if (!g) { this.d.toast('info', msg ?? HINTS[id].msg); return; }
    if (g.dismissed.includes(id) || (g.skipped && HINTS[id].kind === 'tip') || this.showing === id) return;
    this.queue.set(id, msg ?? HINTS[id].msg);
    this.pump();
  }
  /** Put the next hint up once the last one is gone and two game hours have passed (night goes first: it is about now). */
  private pump() {
    if (this.showing || !this.queue.size) return;
    const now = this.d.liveTick();
    const first = this.queue.has('night') ? 'night' : this.queue.keys().next().value!;
    if (first !== 'night' && now - this.shownAt < HINT_GAP) return;
    const msg = this.queue.get(first)!;
    this.queue.delete(first);
    this.showing = first; this.shownAt = now;
    const h = HINTS[first];
    this.strip.className = `hint-${h.kind}`;
    this.strip.innerHTML = `<div class="hrow"><span class="hicon">${h.kind === 'alert' ? '!' : 'i'}</span><span class="htext">${esc(msg)}</span></div>
      <span class="hbtns">${h.tool || h.panel ? '<button class="chip" id="hShow">show me</button>' : ''}<button class="chip" id="hOk" title="Don't show this again">got it</button><button class="gx" id="hLater" title="Later">×</button></span>`;
    this.strip.querySelector<HTMLButtonElement>('#hShow')?.addEventListener('click', () => this.showMe({ show: { tool: h.tool, panel: h.panel, focus: h.tool ? 'plot' : undefined } }));
    this.strip.querySelector<HTMLButtonElement>('#hOk')!.onclick = () => { this.d.net.send({ t: 'hint', id: first }); this.goals?.dismissed.push(first); this.hideHint(); };
    this.strip.querySelector<HTMLButtonElement>('#hLater')!.onclick = () => this.hideHint();
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hideHint(), HINT_STAYS);
  }
  private hideHint() {
    this.showing = null;
    this.strip.className = 'hidden';
    clearTimeout(this.hideTimer);
  }

  // ---- watching the stream: refused builds on an empty treasury, and the tech chip ---------

  private tap(m: ServerMsg) {
    if (m.t === 'toast' && m.kind === 'error' && /^(Not enough money|Need \$)/.test(m.msg)) this.broke();
    if (m.t === 'players' || m.t === 'welcome') {
      const me = m.players.find((p) => p.id === this.d.world.me) ?? (m.t === 'welcome' ? m.players.find((p) => p.id === m.you) : undefined);
      if (me) this.techChip(me);
    }
  }
  /** Under $1,000 and a build was refused: what is draining the treasury, from yesterday's ledger. */
  private broke() {
    const me = this.d.world.myPlayer;
    if (!me || me.devUnlimited || me.money >= 1000) return;
    const y = me.ledger?.yesterday ?? {};
    const costs = (Object.keys(y) as LedgerCat[]).filter((k) => (y[k] ?? 0) < 0).sort((a, b) => y[a]! - y[b]!).slice(0, 3);
    const lines = costs.map((k) => `${LEDGER_LABELS[k].toLowerCase()} $${Math.round(-y[k]!).toLocaleString()}`).join(', ');
    this.raise('broke', `The treasury is nearly empty ($${Math.round(me.money).toLocaleString()}).${lines ? ` Yesterday's biggest costs: ${lines}.` : ''} Taxes come in through the day; the ledger (click the treasury) shows where it goes.`);
  }
  /** Pulse the tech chip, naming the node, when one becomes affordable and available; it stops once the tree is opened. */
  private techChip(me: PlayerDTO) {
    const btn = document.getElementById('techBtn');
    if (!btn) return;
    const now = new Set(TECH.filter((t) => !t.locked && !me.tech.includes(t.id) && t.requires.every((r) => me.tech.includes(r))
      && (me.progress[t.condition.counter] ?? 0) >= t.condition.min && me.money >= t.cost).map((t) => t.id));
    const fresh = [...now].filter((id) => !this.ready.has(id));
    this.ready = now;
    if (fresh.length && !btn.classList.contains('on')) {
      btn.classList.add('techpulse');
      btn.dataset.ready = fresh.length === 1 ? techName(fresh[0]) : `${fresh.length} ready`;
      btn.title = `Ready to unlock: ${[...now].map(techName).join(', ')} (T)`;
    }
    if (!now.size || btn.classList.contains('on')) { btn.classList.remove('techpulse'); delete btn.dataset.ready; btn.title = 'Technology tree (T)'; }
  }
}

const techName = (id: string) => TECH_BY_ID.get(id)?.name ?? id;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function injectStyle() {
  const style = document.createElement('style');
  style.textContent = `
#onb { position: absolute; top: 52px; left: 232px; width: 290px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
#onb > * { pointer-events: auto; }
#cpanel:not(.hidden) ~ #onb, #tech:not(.hidden) ~ #onb { display: none; } /* a citizen's panel or the tech tree has the space */
#goals { padding: 10px 12px; background: var(--panel); border: 1px solid rgba(98,210,162,0.35);
  border-radius: 10px; backdrop-filter: blur(8px); font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
#goals.hidden, #hintStrip.hidden, #goalsBtn.hidden { display: none; }
#goals .ghead { display: flex; align-items: center; color: var(--muted); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
#goals .gx, #hintStrip .gx { margin-left: auto; border: 0; background: transparent; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; padding: 0 4px; }
#goals .gx:hover, #hintStrip .gx:hover { color: var(--fg); }
#goals .gtitle { margin: 3px 0 4px; font-size: 15px; font-weight: 600; color: var(--accent); }
#goals .ghow { color: var(--fg); line-height: 1.35; }
#goals .gwhy { margin: 4px 0 8px; color: var(--muted); line-height: 1.35; }
#goals .gpart { display: flex; justify-content: space-between; color: var(--muted); font-variant-numeric: tabular-nums; }
#goals .gpart span:last-child { color: var(--fg); }
#goals .gbar { height: 6px; margin: 3px 0 7px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
#goals .gbar i { display: block; height: 100%; background: var(--accent); transition: width 0.6s ease; }
#goals .gfoot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px; }
#goals .greward { color: var(--muted); } #goals .greward b { color: #ffd479; font-weight: 600; }
#goals .gnext { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
#goals .gskip { margin-top: 4px; text-align: right; font-size: 10px; } #goals .gskip a { color: var(--muted); }
#hintStrip { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px 8px 12px; background: var(--panel); border: 1px solid rgba(255,212,121,0.45);
  border-radius: 10px; backdrop-filter: blur(8px); font-size: 12.5px; line-height: 1.4; box-shadow: 0 8px 24px rgba(0,0,0,0.3); animation: hintIn 0.35s ease-out; }
#hintStrip.hint-alert { border-color: rgba(255,140,105,0.6); }
#hintStrip .hicon { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 12px;
  background: rgba(255,212,121,0.18); color: #ffd479; }
#hintStrip.hint-alert .hicon { background: rgba(255,140,105,0.2); color: #ff9c7a; }
#hintStrip .hrow { display: flex; gap: 9px; align-items: flex-start; }
#hintStrip .htext { flex: 1; }
#hintStrip .hbtns { display: flex; gap: 6px; align-items: center; justify-content: flex-end; }
#hintStrip .hbtns .gx { margin-left: 0; }
@keyframes hintIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
#tools button.gflash { animation: gflash 0.9s ease-in-out 4; }
@keyframes gflash { 0%, 100% { box-shadow: none; } 50% { box-shadow: 0 0 0 2px #ffd479, 0 0 14px rgba(255,212,121,0.7); background: rgba(255,212,121,0.14); } }
.toast.goaldone { border-color: rgba(255,212,121,0.7); background: linear-gradient(120deg, rgba(40,36,22,0.92), rgba(16,20,27,0.9)); padding: 9px 14px;
  transform: rotate(var(--tilt, 0deg)); animation: goalIn 0.5s cubic-bezier(.2,1.6,.4,1), fade 7s forwards; font-size: 13px; }
.toast.goaldone b { color: #ffd479; } .toast.goaldone .gr { color: var(--accent); font-weight: 600; } .toast.goaldone .gn { margin-top: 2px; color: var(--muted); font-size: 11px; }
@keyframes goalIn { from { transform: scale(0.7) rotate(var(--tilt, 0deg)); opacity: 0; } to { transform: scale(1) rotate(var(--tilt, 0deg)); opacity: 1; } }
#goalsBtn, #techBtn.techpulse { white-space: nowrap; }
#techBtn.techpulse { animation: techPulse 1.6s ease-in-out infinite; border-color: rgba(255,212,121,0.8); }
#techBtn.techpulse::after { content: ' · ' attr(data-ready); color: #ffd479; }
@keyframes techPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,212,121,0.0); } 50% { box-shadow: 0 0 0 4px rgba(255,212,121,0.25), 0 0 12px rgba(255,212,121,0.5); } }
@media (max-width: 900px) { #onb { left: auto; right: 12px; top: auto; bottom: 60px; width: min(290px, calc(100vw - 24px)); } }
`;
  document.head.appendChild(style);
}
