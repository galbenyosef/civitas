import { ISSUE_CODES, ISSUE_TEXT, KIND_NAMES, MOOD_REASONS, Issue, isRoad, levelOf, underConstruction } from '@msimcity/shared';
import type { ClientWorld } from './world';
import { issueGlyphUrl, ISSUE_COLOUR } from './render/issues';

/**
 * The problems list (docs/audit-2026-10.md section 4.4): a top-bar chip "problems N", red while there are any, opening
 * a panel of your own buildings and lots the server flags (message `problems`: x, y, code triples), grouped by what is
 * wrong, with a line on what fixes it and a "show me" per entry that flies there and makes the badge pulse. It needs no
 * chunk data: names come from the tiles when they are loaded and say "lot" when they are not. Very unhappy homes come with
 * why (message `problems` r, shared/src/issues.ts MOOD_REASONS) and are listed under each reason with what helps.
 */
export interface ProblemsDeps {
  world: ClientWorld;
  /** fly the camera to a tile */
  flyTo(x: number, y: number): void;
  /** pulse the badge and ring the tile (render/issues.ts flash) */
  flash(x: number, y: number): void;
  /** open the building panel, as a click on it does */
  select(x: number, y: number): void;
}

/** entries listed per group before "and N more" */
const PER_GROUP = 40;

export class ProblemsPanel {
  readonly chip: HTMLButtonElement;
  private el: HTMLDivElement;
  private open = false;
  private glyphs = new Map<number, string>();
  /** why each very unhappy home is, by "x,y" */
  private why = new Map<string, number>();

  constructor(private d: ProblemsDeps) {
    injectStyle();
    this.chip = document.createElement('button');
    this.chip.id = 'problemsBtn'; this.chip.className = 'chip';
    this.chip.title = 'Your buildings and lots that are stuck: no road, no builders, unstaffed, parking full, no customers, very unhappy';
    document.getElementById('heat')!.before(this.chip);
    this.chip.onclick = () => this.toggle();
    this.el = document.createElement('div');
    this.el.id = 'problems'; this.el.className = 'hidden';
    document.getElementById('ui')!.append(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      const x = Number(b.dataset.x), y = Number(b.dataset.y);
      if (b.dataset.act === 'close') this.toggle(false);
      else if (b.dataset.act === 'show') { this.d.flyTo(x, y); this.d.flash(x, y); }
      else if (b.dataset.act === 'open') { this.d.flyTo(x, y); this.d.flash(x, y); this.d.select(x, y); }
    });
    this.set([]);
  }

  glyph(code: number) {
    let u = this.glyphs.get(code);
    if (!u) this.glyphs.set(code, u = issueGlyphUrl(code));
    return u;
  }

  toggle(open = !this.open) {
    this.open = open;
    this.el.classList.toggle('hidden', !open);
    this.chip.classList.toggle('on', open);
    if (open) this.render();
  }

  /** A new list from the server (flat x, y, code; r why each very unhappy home is). */
  set(p: number[], r?: number[]) {
    this.d.world.problems = p;
    this.why.clear();
    if (r) for (let i = 0; i < r.length; i++) if (r[i]) this.why.set(`${p[i * 3]},${p[i * 3 + 1]}`, r[i]);
    const n = p.length / 3;
    this.chip.innerHTML = `problems <b>${n}</b>`;
    this.chip.classList.toggle('bad', n > 0);
    if (this.open) this.render();
  }

  /** why the very unhappy home at a tile of yours is (MOOD_REASONS id), 0 if not known */
  whyAt(x: number, y: number) { return this.why.get(`${x},${y}`) ?? 0; }

  private name(x: number, y: number) {
    const w = this.d.world, t = w.getTile(x, y);
    if (t === undefined || isRoad(t)) return 'Lot';
    const kind = w.kindIdAt(x, y), nm = KIND_NAMES[kind] ?? 'building';
    const what = levelOf(t) === 0 && !underConstruction(t) ? `${nm} lot` : underConstruction(t) ? `${nm} (site)` : nm;
    return what.charAt(0).toUpperCase() + what.slice(1);
  }

  private render() {
    const p = this.d.world.problems;
    const groups = new Map<number, [number, number][]>();
    for (let i = 0; i < p.length; i += 3) {
      let g = groups.get(p[i + 2]);
      if (!g) groups.set(p[i + 2], g = []);
      g.push([p[i], p[i + 1]]);
    }
    let html = `<div class="phead"><span>Problems</span><button class="gx" data-act="close" title="Close">×</button></div>`;
    if (!groups.size) html += `<div class="pnone">Nothing is stuck on your land. Badges float over any building or lot that gets stuck: on fire, no road, no builders, unstaffed, parking full, no customers, very unhappy.</div>`;
    for (const code of ISSUE_CODES) {
      const g = groups.get(code);
      if (!g) continue;
      const tx = ISSUE_TEXT[code];
      html += `<div class="pgroup" style="--pc:${ISSUE_COLOUR[code]}"><div class="ptitle"><img src="${this.glyph(code)}" alt=""><b>${tx.title}</b><span class="pn">${g.length}</span></div>`;
      html += `<div class="pexp">${tx.explain}</div>`;
      const row = ([x, y]: [number, number]) => `<div class="prow"><a data-act="open" data-x="${x}" data-y="${y}" title="Open its panel">${esc(this.name(x, y))}</a><span class="pxy">${x}, ${y}</span><button class="chip" data-act="show" data-x="${x}" data-y="${y}">show me</button></div>`;
      const more = (n: number) => (n > PER_GROUP ? `<div class="pmore">and ${n - PER_GROUP} more</div>` : '');
      if (code === Issue.Unhappy) {
        // under each reason, the most common first, with what helps
        const by = new Map<number, [number, number][]>();
        for (const e of g) { const r = this.whyAt(e[0], e[1]); let l = by.get(r); if (!l) by.set(r, l = []); l.push(e); }
        for (const [r, l] of [...by].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])) {
          const why = MOOD_REASONS.find((m) => m.id === r);
          html += `<div class="pwhy"><b>${why ? esc(why.title) : 'other reasons'}</b> ${l.length}${why ? `: ${esc(why.advice)}` : ': hover a resident to see why.'}</div>`;
          html += l.slice(0, PER_GROUP).map(row).join('') + more(l.length);
        }
      } else html += g.slice(0, PER_GROUP).map(row).join('') + more(g.length);
      html += `</div>`;
    }
    this.el.innerHTML = html;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function injectStyle() {
  const style = document.createElement('style');
  style.textContent = `
#problemsBtn, #heat { white-space: nowrap; }
#problemsBtn.bad { border-color: rgba(255,90,90,0.75); color: #ff8b8b; }
#problemsBtn.bad b { color: #ff6b6b; }
#problems { position: absolute; top: 52px; right: 12px; width: 330px; max-height: calc(100vh - 120px); overflow-y: auto; padding: 10px 12px 12px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px; backdrop-filter: blur(8px); font-size: 12px; z-index: 6;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
#problems.hidden { display: none; }
#problems .phead { display: flex; align-items: center; color: var(--muted); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px; }
#problems .gx { margin-left: auto; border: 0; background: transparent; color: var(--muted); font-size: 16px; cursor: pointer; }
#problems .pnone { color: var(--muted); line-height: 1.4; }
#problems .pgroup { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
#problems .ptitle { display: flex; align-items: center; gap: 7px; font-size: 13px; }
#problems .ptitle img { width: 26px; height: 26px; }
#problems .ptitle b { color: var(--pc); }
#problems .pn { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
#problems .pexp { margin: 3px 0 5px; color: var(--muted); line-height: 1.35; }
#problems .prow { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
#problems .prow a { color: var(--fg); cursor: pointer; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#problems .prow a:hover { text-decoration: underline; }
#problems .pxy { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
#problems .prow .chip { padding: 1px 8px; font-size: 11px; }
#problems .pmore { color: var(--muted); padding-top: 2px; }
#problems .pwhy { margin: 5px 0 2px; line-height: 1.35; color: var(--muted); }
#problems .pwhy b { color: var(--fg); font-weight: 600; }
#tip .issueline { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--line); line-height: 1.35; }
#tip .issueline img { width: 22px; height: 22px; flex: none; }
#tip .issueline b { color: var(--pc); }
@media (max-width: 900px) { #problems { width: calc(100vw - 24px); } }
`;
  document.head.appendChild(style);
}

/** The tooltip's problem line for a tile's code (main.ts appends it to the building tooltip); why, for a very unhappy home of yours. */
export function issueTipHtml(code: number, glyph: string, why = 0): string {
  const tx = ISSUE_TEXT[code];
  if (!tx) return '';
  const r = code === Issue.Unhappy ? MOOD_REASONS.find((m) => m.id === why) : undefined;
  const text = r ? `Most of all: ${esc(r.title)}. ${esc(r.advice)}` : tx.explain;
  return `<div class="issueline" style="--pc:${ISSUE_COLOUR[code]}"><img src="${glyph}" alt=""><span><b>${tx.title}.</b> ${text}</span></div>`;
}
