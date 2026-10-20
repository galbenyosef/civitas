import { Group, Mesh, MeshBasicMaterial, BufferGeometry, Float32BufferAttribute, DoubleSide } from 'three';
import {
  RANKS, TOP_RANK, NEED_HOW, TICKS_PER_DAY, TICKS_PER_HOUR, hash2, rankNeeds, rankRewardText,
  type RankDTO, type RankUp, type Milestone, type ServerMsg,
} from '@msimcity/shared';
import type { NetClient } from './net';
import type { ClientWorld } from './world';
import type { Fireworks } from './render/fireworks';

/**
 * Settlement ranks on the client (shared/src/ranks.ts, server/src/ranks.ts, docs/ranks.md): the rank chip in the top
 * bar with the next rank's progress, the rank card (the next rank's needs, what it brings, the milestone feed), the
 * ticker that brings each new milestone up under the top bar for a few seconds, the frontier's next ring drawn on the
 * ground, and the rank-up celebration: a banner, fireworks over the town and, when the charter grows, the camera
 * pulling up to show the new land. Nothing appears until the server sends a rank (test cities and demos never do).
 */
export interface RanksDeps {
  net: NetClient;
  world: ClientWorld;
  fireworks: Fireworks;
  /** the server's tick now */
  liveTick(): number;
  /** a camera moment (moment.ts), unless a tour or the map has the camera */
  moment?(x: number, y: number, caption: string, opts: { dist?: number; pitch?: number; hold?: number }): void;
}

type Rect = { x: number; y: number; w: number; h: number };
/** the rank card's own setting: open or closed by the player, or (absent) open whenever the goals card is not up */
const PREF = 'msimcity.rankCard';
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
/** Openers for a rank reached, picked per rank and tick. */
const HAILS = ['Hear ye', 'Huzzah', 'Bunting out', 'Bells ring', 'The town cheers', 'Ring the bells'];
const KIND_ICON: Record<Milestone['kind'], string> = { rank: '★', goal: '✓', need: '◆', people: '●', jobs: '■', first: '▲', tech: '✦', money: '$', land: '▣' };

export class RanksUI {
  readonly group = new Group();
  private dto: RankDTO | null = null;
  private chip: HTMLButtonElement;
  private card: HTMLDivElement;
  private ticker: HTMLDivElement;
  private pref: 'open' | 'closed' | '' = '';
  private queue: Milestone[] = [];
  private tickAt = 0;
  private ringKey = '';
  private cardHtml = '';

  constructor(private d: RanksDeps) {
    injectStyle();
    this.chip = document.createElement('button'); this.chip.id = 'rankBtn'; this.chip.className = 'chip hidden';
    document.getElementById('clock')!.before(this.chip);
    this.chip.onclick = () => { this.pref = this.cardShown() ? 'closed' : 'open'; this.save(); this.render(); };
    this.card = document.createElement('div'); this.card.id = 'rankCard'; this.card.className = 'hidden';
    const col = document.getElementById('onb'); // the goals column (onboarding.ts), else the ui root
    if (col) col.prepend(this.card); else document.getElementById('ui')!.append(this.card);
    this.ticker = document.createElement('div'); this.ticker.id = 'rankTicker';
    document.getElementById('ui')!.append(this.ticker);
    try { const v = localStorage.getItem(PREF); this.pref = v === 'open' || v === 'closed' ? v : ''; } catch { /* storage blocked */ }
    d.net.on('rank', (m) => this.onRank(m));
    // the goals card comes and goes (collapsed, skipped, the chain finished): the rank card takes its place
    setInterval(() => { this.render(); this.pump(); }, 1000);
  }

  private save() { try { localStorage.setItem(PREF, this.pref); } catch { /* not remembered */ } }

  private onRank(m: Extract<ServerMsg, { t: 'rank' }>) {
    const first = !this.dto;
    this.dto = m.rank;
    if (!first) for (const f of m.fresh ?? []) if (f.kind !== 'rank') this.queue.push(f);
    if (m.up) this.celebrate(m.up);
    this.rings(m.rank.ring, m.rank.next);
    this.render();
    this.pump();
  }

  /** the goals card (onboarding.ts) is up */
  private goalsUp() { const g = document.getElementById('goals'); return !!g && !g.classList.contains('hidden'); }
  private cardShown() { return this.pref === 'open' || (this.pref === '' && !this.goalsUp()); }

  private render() {
    const r = this.dto;
    if (!r) return;
    const def = RANKS[r.rank], next = r.rank < TOP_RANK ? RANKS[r.rank + 1] : null;
    const needs = rankNeeds(r.rank + 1, !!r.frontier);
    const met = needs.filter((q, i) => (r.have[i] ?? 0) >= q.target).length;
    this.chip.classList.remove('hidden');
    this.chip.classList.toggle('on', this.cardShown());
    const chipHtml = `<i class="rcrest r${r.rank}">${ROMAN[r.rank] || '·'}</i>${esc(def.name)}${next ? `<span class="rnext"> → ${esc(next.name)} ${met}/${needs.length}</span>` : r.mark ? `<span class="rnext"> · ${r.mark[0].toLocaleString('en-GB')}/${r.mark[1].toLocaleString('en-GB')} residents</span>` : ''}`;
    if (this.chip.innerHTML !== chipHtml) this.chip.innerHTML = chipHtml;
    this.chip.title = next ? `Settlement rank: ${def.name}. Next: ${next.name} (${needs.map((q) => q.label).join(', ')}). Click for the rank card and milestones` : `Settlement rank: ${def.name}, the top rank. Click for the milestones`;
    const show = this.cardShown();
    this.card.classList.toggle('hidden', !show);
    if (!show) { this.cardHtml = ''; return; }
    const frontier = !!r.ring;
    const bars = needs.map((q, i) => {
      const cur = Math.min(r.have[i] ?? 0, q.target), pct = Math.round((100 * cur) / q.target);
      return `<div class="gpart${cur >= q.target ? ' done' : ''}"><span>${esc(q.label)}</span><span>${cur.toLocaleString('en-GB')} / ${q.target.toLocaleString('en-GB')}</span></div><div class="gbar"><i style="width:${pct}%"></i></div>`;
    }).join('');
    const short = needs.find((q, i) => (r.have[i] ?? 0) < q.target);
    const feed = r.feed.slice(0, 6).map((f) => `<li class="k-${f.kind}"><span class="fi">${KIND_ICON[f.kind]}</span><span class="ft">${esc(f.text)}</span><span class="fw">${when(f.tick)}</span></li>`).join('');
    const html = `
      <div class="ghead"><span class="gnum">Settlement rank</span><button class="gx" id="rHide" title="Hide (the rank chip at the top brings it back)">–</button></div>
      <div class="rtitle"><i class="rcrest r${r.rank}">${ROMAN[r.rank] || '·'}</i>${esc(def.name)}</div>
      <div class="gwhy">${esc(def.blurb)}</div>
      ${next ? `<div class="rnexthead">To become a <b>${esc(next.name)}</b></div>${bars}${short ? `<div class="rstep">Next step: ${esc(NEED_HOW[short.id])}</div>` : ''}
      <div class="gfoot"><span class="greward">Charter grant: <b>${esc(rankRewardText(r.rank + 1, frontier))}</b></span></div>` : `<div class="rnexthead">The top rank: the land rules of the wide world are yours.</div>${r.mark ? `<div class="gpart"><span>next milestone: residents</span><span>${r.mark[0].toLocaleString('en-GB')} / ${r.mark[1].toLocaleString('en-GB')}</span></div><div class="gbar"><i style="width:${Math.round((100 * r.mark[0]) / r.mark[1])}%"></i></div>` : ''}`}
      ${feed ? `<div class="rfeedhead">Milestones</div><ul class="rfeed">${feed}</ul>` : ''}`;
    if (html === this.cardHtml) return; // the 1 s refresh: only when something changed
    this.cardHtml = html;
    this.card.innerHTML = html;
    this.card.querySelector<HTMLButtonElement>('#rHide')!.onclick = () => { this.pref = 'closed'; this.save(); this.render(); };
  }

  // ---- the milestone ticker -------------------------------------------------------------------

  /** One new milestone at a time under the top bar, a little over a second apart, each staying its own few seconds. */
  private pump() {
    if (!this.queue.length || performance.now() - this.tickAt < 1300 || this.ticker.childElementCount >= 3) return;
    const f = this.queue.shift()!;
    this.tickAt = performance.now();
    const el = document.createElement('div');
    const h = (k: number) => hash2(f.tick + k, f.text.length * 13 + k);
    el.className = `rtick k-${f.kind}`;
    el.style.setProperty('--tilt', `${((h(1) - 0.5) * 2).toFixed(2)}deg`);
    el.style.setProperty('--dx', `${Math.round((h(2) - 0.5) * 24)}px`);
    const stay = 5200 + h(3) * 2200;
    el.style.setProperty('--stay', `${Math.round(stay)}ms`);
    el.innerHTML = `<span class="fi">${KIND_ICON[f.kind]}</span>${esc(f.text)}`;
    this.ticker.append(el);
    setTimeout(() => el.remove(), stay + 600);
    this.chip.classList.remove('rping'); void this.chip.offsetWidth; this.chip.classList.add('rping');
  }

  // ---- the frontier's next ring, drawn on the ground ------------------------------------------

  private rings(ring?: Rect, next?: Rect) {
    const key = next ? `${next.x},${next.y},${next.w},${next.h}` : '';
    if (key === this.ringKey) return;
    this.ringKey = key;
    for (const c of [...this.group.children]) { this.group.remove(c); (c as Mesh).geometry.dispose(); }
    if (!next || !ring) return;
    // dashes round the next ring, each its own length a touch (the organic-effects rule), and corner posts
    const pos: number[] = [];
    const quad = (x0: number, z0: number, x1: number, z1: number) => { const y = 0.07; pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1); };
    const W = 0.22, edge = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let s = 0, i = 0; s < len; i++) {
        const dash = 1.1 + hash2(ax * 31 + i, az * 17 + bx) * 0.7, gap = 0.7 + hash2(i, ax + bz) * 0.4;
        const e = Math.min(len, s + dash);
        const x0 = ax + ux * s, z0 = az + uz * s, x1 = ax + ux * e, z1 = az + uz * e;
        quad(Math.min(x0, x1) - (uz ? W / 2 : 0), Math.min(z0, z1) - (ux ? W / 2 : 0), Math.max(x0, x1) + (uz ? W / 2 : 0), Math.max(z0, z1) + (ux ? W / 2 : 0));
        s = e + gap;
      }
    };
    const { x, y, w, h } = next;
    edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x, y + h, x + w, y + h); edge(x, y, x, y + h);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const mesh = new Mesh(geo, new MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide }));
    mesh.renderOrder = 20;
    this.group.add(mesh);
  }

  // ---- the celebration ------------------------------------------------------------------------

  /** A demo tour stop (tour.ts, view 'ranks'): the celebration a Town gets, over (x, y), without the camera moment. */
  preview(x: number, y: number) { this.celebrate({ rank: 3, grant: RANKS[3].grant, at: [Math.round(x), Math.round(y)] }, true); }

  private celebrate(up: RankUp, preview = false) {
    const def = RANKS[up.rank];
    if (!def) return;
    const seed = up.rank * 1009 + Math.floor(this.d.liveTick() / TICKS_PER_HOUR);
    const h = (k: number) => hash2(seed, k);
    // the banner: the rank's name rises letter by letter, each with its own small delay and lean
    const el = document.createElement('div');
    el.className = 'rankup';
    el.style.setProperty('--tilt', `${((h(1) - 0.5) * 3).toFixed(2)}deg`);
    const letters = [...def.name.toUpperCase()].map((c, i) => `<span style="animation-delay:${(0.25 + i * 0.07 + hash2(seed + i, 7) * 0.09).toFixed(2)}s;--lean:${((hash2(seed + i, 9) - 0.5) * 9).toFixed(1)}deg">${esc(c)}</span>`).join('');
    const hail = HAILS[Math.floor(h(2) * HAILS.length)];
    const land = up.land ? ` · the charter reaches ${up.land.w}×${up.land.h}` : '';
    el.innerHTML = `<div class="ruhail">${esc(hail)}! ${preview ? 'A town reaching the rank of' : `${esc(this.d.world.myPlayer?.name ?? 'Your')}'s town is now a`}</div><div class="runame">${letters}</div><div class="rugrant">charter grant $${up.grant.toLocaleString('en-GB')}${esc(land)}</div>`;
    document.getElementById('ui')!.append(el);
    setTimeout(() => el.classList.add('out'), 6200 + h(3) * 900);
    setTimeout(() => el.remove(), 7600 + h(3) * 900);
    // fireworks over the town, and the camera pulls up to show it (and the new land)
    this.d.fireworks.show(up.at[0], up.at[1], up.rank, seed);
    if (preview) return;
    const look = up.land ? [up.land.x + up.land.w / 2, up.land.y + up.land.h / 2] : up.at;
    this.d.moment?.(look[0], look[1], up.land ? `The charter grows: ${up.land.w}×${up.land.h} tiles of new land` : `${def.name}!`,
      { dist: up.land ? Math.max(38, up.land.w * 1.05) : 30, pitch: up.land ? 0.95 : 0.55, hold: 6.5 });
  }
}

/** A milestone's game time: "day 3, 14:05". */
function when(tick: number) {
  const day = Math.floor(tick / TICKS_PER_DAY), m = Math.floor(((tick % TICKS_PER_DAY) / TICKS_PER_HOUR) * 60);
  return `day ${day + 1}, ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function injectStyle() {
  const style = document.createElement('style');
  style.textContent = `
#rankBtn { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
#rankBtn.hidden, #rankCard.hidden { display: none; }
#rankBtn .rnext { color: var(--muted); }
#rankBtn.rping { animation: rping 1.1s ease-out; }
@keyframes rping { 0% { box-shadow: 0 0 0 0 rgba(255,212,121,0.55); } 100% { box-shadow: 0 0 0 9px rgba(255,212,121,0); } }
.rcrest { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50% 50% 45% 45%; font-style: normal; font-size: 9px; font-weight: 700;
  color: #1a1408; background: linear-gradient(160deg, #e9d7b0, #a8865a); box-shadow: inset 0 -1px 0 rgba(0,0,0,0.25); }
.rcrest.r1 { background: linear-gradient(160deg, #f0c48a, #b0763c); } .rcrest.r2 { background: linear-gradient(160deg, #e8edf2, #9aa6b2); }
.rcrest.r3 { background: linear-gradient(160deg, #ffe08a, #c9962a); } .rcrest.r4 { background: linear-gradient(160deg, #d9c2ff, #7b5ea7); color: #fff; }
#rankCard { padding: 10px 12px; background: var(--panel); border: 1px solid rgba(255,212,121,0.35); border-radius: 10px; backdrop-filter: blur(8px);
  font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
#rankCard .ghead { display: flex; align-items: center; color: var(--muted); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
#rankCard .gx { margin-left: auto; border: 0; background: transparent; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; padding: 0 4px; }
#rankCard .rtitle { display: flex; align-items: center; gap: 7px; margin: 4px 0 3px; font-size: 16px; font-weight: 600; color: #ffd479; }
#rankCard .rtitle .rcrest { width: 22px; height: 22px; font-size: 10px; }
#rankCard .gwhy { margin: 0 0 8px; color: var(--muted); line-height: 1.35; }
#rankCard .rnexthead { margin: 2px 0 5px; color: var(--fg); } #rankCard .rnexthead b { color: #ffd479; }
#rankCard .gpart { display: flex; justify-content: space-between; color: var(--muted); font-variant-numeric: tabular-nums; }
#rankCard .gpart span:last-child { color: var(--fg); } #rankCard .gpart.done span:first-child::after { content: ' ✓'; color: var(--accent); }
#rankCard .gbar { height: 6px; margin: 3px 0 7px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
#rankCard .gbar i { display: block; height: 100%; background: linear-gradient(90deg, #c9962a, #ffd479); transition: width 0.6s ease; }
#rankCard .rstep { margin: 0 0 6px; color: var(--fg); line-height: 1.35; }
#rankCard .greward { color: var(--muted); } #rankCard .greward b { color: #ffd479; font-weight: 600; }
#rankCard .rfeedhead { margin-top: 9px; padding-top: 6px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
#rankCard .rfeed { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
#rankCard .rfeed li { display: flex; gap: 6px; align-items: baseline; line-height: 1.3; }
#rankCard .rfeed .ft { flex: 1; } #rankCard .rfeed .fw { color: var(--muted); font-size: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fi { flex: none; width: 12px; text-align: center; color: var(--accent); font-size: 10px; }
.k-rank .fi { color: #ffd479; } .k-need .fi { color: #ffb86b; } .k-money .fi { color: #ffd479; } .k-tech .fi { color: #b388ff; } .k-goal .fi { color: var(--accent); }
#rankTicker { position: absolute; top: 48px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 5px; pointer-events: none; z-index: 6; }
.rtick { padding: 5px 12px 5px 9px; border-radius: 999px; background: var(--panel); border: 1px solid rgba(255,212,121,0.35); backdrop-filter: blur(8px); font-size: 12px;
  display: flex; gap: 6px; align-items: center; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,0.3);
  animation: rtickIn 0.45s cubic-bezier(.2,1.4,.4,1), rtickOut 0.6s ease-in var(--stay, 6000ms) forwards; transform: translateX(var(--dx, 0)) rotate(var(--tilt, 0deg)); }
@keyframes rtickIn { from { opacity: 0; transform: translate(var(--dx, 0), -10px) rotate(var(--tilt, 0deg)) scale(0.9); } }
@keyframes rtickOut { to { opacity: 0; transform: translate(var(--dx, 0), -6px) rotate(var(--tilt, 0deg)); } }
.rankup { position: absolute; top: 15%; left: 50%; transform: translateX(-50%) rotate(var(--tilt, 0deg)); z-index: 8; pointer-events: none; text-align: center;
  padding: 14px 34px 16px; border-radius: 16px; background: radial-gradient(ellipse at 50% 0%, rgba(70,56,24,0.94), rgba(16,20,27,0.9));
  border: 1px solid rgba(255,212,121,0.75); box-shadow: 0 16px 50px rgba(0,0,0,0.45), 0 0 40px rgba(255,212,121,0.18); animation: ruIn 0.6s cubic-bezier(.2,1.5,.4,1); }
.rankup.out { animation: ruOut 1.2s ease-in forwards; }
.rankup .ruhail { color: rgba(255,231,176,0.8); font-size: 13px; letter-spacing: 0.02em; }
.rankup .runame { margin: 2px 0 4px; font-size: 44px; font-weight: 800; letter-spacing: 0.12em; color: #ffd479; text-shadow: 0 2px 0 rgba(0,0,0,0.35), 0 0 22px rgba(255,212,121,0.45); }
.rankup .runame span { display: inline-block; opacity: 0; animation: ruLetter 0.55s cubic-bezier(.2,1.6,.4,1) forwards; }
.rankup .rugrant { color: var(--accent); font-size: 13px; font-weight: 600; }
@keyframes ruIn { from { opacity: 0; transform: translateX(-50%) rotate(var(--tilt, 0deg)) scale(0.7); } }
@keyframes ruOut { to { opacity: 0; transform: translate(-50%, -18px) rotate(var(--tilt, 0deg)); } }
@keyframes ruLetter { from { opacity: 0; transform: translateY(14px) rotate(var(--lean, 0deg)) scale(0.6); } 60% { opacity: 1; } to { opacity: 1; transform: rotate(calc(var(--lean, 0deg) * 0.25)); } }
@media (max-width: 900px) { #rankBtn .rnext { display: none; } .rankup .runame { font-size: 30px; } }
`;
  document.head.appendChild(style);
}
