/**
 * Progressive disclosure (docs/first-five.md "What a new player is shown"): a Camp-rank town sees only the tools it can use
 * and the chips the first hour needs; the rest comes into view as it is unlocked, each arrival with a short glow and a toast,
 * the way the leaders' milestone unlocks do. Client only: nothing here changes what the server allows.
 *
 * Stages: 'camp' (the Camp rank, nothing else) hides locked tools and ladders instead of greying them, the underground, map,
 * charts, lines, education, news, audio and perf chips, the world-stats line and the key help (a "? controls" button shows
 * it); 'hamlet' (Hamlet rank) shows locked tools greyed as before and every chip but the two readouts; 'all' is everything
 * (Village and up, a sandbox, a read-only showcase, ?dev, or the player's own "show everything" setting, remembered per
 * browser in localStorage `msimcity.reveal`).
 */
export type Stage = 'camp' | 'hamlet' | 'all';

export interface RevealEnv {
  /** the player's rank (shared/src/ranks.ts index: 0 Camp, 1 Hamlet, 2 Village ...), or null before the first rank message */
  rank: number | null;
  sandbox: boolean;
  spectate: boolean;
  dev: boolean;
  /** the player's own choice to see everything */
  everything: boolean;
}

/** The stage for a player. Pure. Before the first rank message a new player is treated as Camp (the chips settle within a second). */
export function stageFor(e: RevealEnv): Stage {
  if (e.sandbox || e.spectate || e.dev || e.everything) return 'all';
  const r = e.rank ?? 0;
  return r <= 0 ? 'camp' : r === 1 ? 'hamlet' : 'all';
}

/** the top-bar chips a stage keeps out of view, by element id */
export const CHIPS_HIDDEN: Record<Stage, readonly string[]> = {
  camp: ['under', 'mapBtn', 'chartsBtn', 'linesBtn', 'eduHeat', 'newsBtn', 'audioBtn', 'perfBtn'],
  hamlet: ['audioBtn', 'perfBtn'],
  all: [],
};

export const PREF_KEY = 'msimcity.reveal';
export const readPref = (): boolean => { try { return localStorage.getItem(PREF_KEY) === 'all'; } catch { return false; } };
export const writePref = (all: boolean) => { try { if (all) localStorage.setItem(PREF_KEY, 'all'); else localStorage.removeItem(PREF_KEY); } catch { /* not remembered */ } };

export interface RevealDeps {
  env: () => RevealEnv;
  /** hide (true) or show locked tools; `keep` names tool ids never hidden (the goals card's own tool) */
  veilTools: (on: boolean, keep: ReadonlySet<string>) => string[];
  /** the ids of the tool buttons visible now (after veilTools), with their labels */
  visibleTools: () => { id: string; label: string }[];
  /** the tool the goals card is on, if any */
  goalTool: () => string | null;
  toast: (kind: 'info' | 'error', msg: string) => void;
  /** glow a tool button that has just come into view */
  fresh: (id: string) => void;
}

/** Applies the stage to the page; call after the welcome, after every players update (tech) and after every rank message. */
export class Reveal {
  private stage: Stage | null = null;
  private seen: Set<string> | null = null;
  private helpBtn: HTMLButtonElement | null = null;
  private helpOpen = false;
  constructor(private d: RevealDeps) {}
  get current(): Stage { return this.stage ?? 'camp'; }

  apply() {
    const stage = stageFor(this.d.env());
    const first = this.stage === null, changed = stage !== this.stage;
    this.stage = stage;
    const keep = new Set<string>(); const gt = this.d.goalTool(); if (gt) keep.add(gt);
    this.d.veilTools(stage === 'camp', keep);
    // chips, the stats line and the help line
    const hidden = new Set(CHIPS_HIDDEN[stage]);
    for (const id of CHIPS_HIDDEN.camp) document.getElementById(id)?.classList.toggle('veiled', hidden.has(id));
    document.getElementById('worldstats')?.classList.toggle('veiled', stage === 'camp');
    this.helpLine(stage === 'camp');
    // what came into view since the last apply: a glow and a word, never on the first draw
    const now = this.d.visibleTools();
    if (this.seen) {
      const fresh = now.filter((t) => !this.seen!.has(t.id));
      if (fresh.length && !first) {
        for (const t of fresh) this.d.fresh(t.id);
        if (fresh.length <= 3) this.d.toast('info', `${fresh.length === 1 ? 'New tool' : 'New tools'}: ${fresh.map((t) => t.label).join(', ')}`);
        else this.d.toast('info', `${fresh.length} tools have come into view in the tool bar`);
      }
    }
    this.seen = new Set(now.map((t) => t.id));
    if (changed && !first && stage === 'hamlet') this.d.toast('info', 'Hamlet: the map, charts, lines and the rest of the tool bar are open to you now');
    if (changed && !first && stage === 'all' && !this.d.env().everything && !this.d.env().dev) this.d.toast('info', 'Village: every tool, chip and readout is yours');
    document.body.dataset.reveal = stage;
  }

  /** the key help: a "? controls" button at Camp, the full line otherwise */
  private helpLine(veil: boolean) {
    const help = document.getElementById('help');
    if (!help) return;
    if (!this.helpBtn) {
      const b = document.createElement('button'); b.id = 'helpBtn'; b.className = 'chip'; b.textContent = '? controls'; b.title = 'The keys and the mouse';
      b.onclick = () => { this.helpOpen = !this.helpOpen; help.classList.toggle('veiled', !this.helpOpen); b.classList.toggle('on', this.helpOpen); };
      help.after(b); this.helpBtn = b;
    }
    this.helpBtn.classList.toggle('veiled', !veil);
    help.classList.toggle('veiled', veil && !this.helpOpen);
  }
}
