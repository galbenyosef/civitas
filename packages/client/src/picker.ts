import { WebGLRenderer, Scene, PerspectiveCamera, Mesh, HemisphereLight, DirectionalLight, Color, Vector3, PlaneGeometry, MeshLambertMaterial, ACESFilmicToneMapping } from 'three';
import { LADDERS, TRACK_NAMES, hasFeature, techFor, tierSummary, type KindManifest, type Ladder, type GroupDef } from '@msimcity/shared';
import { buildModels, model } from './render/models';
import { buildingMaterial, sceneUniforms } from './render/materials';
import { DEV_TOOLS, TOOL_KINDS } from './input';

/**
 * Size picker (docs/buildings.md "Groups and tiers"): the tool bar shows each ladder once ('Health', 'Police', ...);
 * choosing it opens this popover beside the tool bar with one card per rung: a thumbnail, the footprint, what it
 * holds and covers, upkeep, cost, and the technology it needs (locked rungs are greyed with the tech's name). Picking
 * a card makes that rung's kind the active tool, so placement, Z/C rotation and the footprint preview work exactly
 * as for any other building. The last size used per ladder is remembered in localStorage.
 */

/** Ladders as the tool bar shows them: drafts only with ?dev, and only ladders with at least one placeable rung. */
export const TOOL_LADDERS: Ladder[] = LADDERS
  .map((l) => ({ group: l.group, tiers: l.tiers.filter((k) => k.tool && TOOL_KINDS.includes(k)) }))
  .filter((l) => l.tiers.length > 0);
const BY_TOOL = new Map<string, Ladder>();
for (const l of TOOL_LADDERS) for (const k of l.tiers) BY_TOOL.set(k.tool!.id, l);
/** The ladder a tool id is a rung of, if any. */
export const ladderOfTool = (tool: string): Ladder | undefined => BY_TOOL.get(tool);
export const ladderById = (group: string): Ladder | undefined => TOOL_LADDERS.find((l) => l.group.id === group);

const STORE = 'msimcity.ladderSizes';
let remembered: Record<string, string> = {};
try { remembered = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { /* storage blocked: start from the defaults */ }
/** The rung a ladder opens on: the last one used, else the original kind (the one with the shortcut key), else the smallest. */
export function rememberedTool(l: Ladder): string {
  const r = remembered[l.group.id];
  if (r && l.tiers.some((k) => k.tool!.id === r)) return r;
  return (l.tiers.find((k) => k.tool!.key) ?? l.tiers[0]).tool!.id;
}
export function rememberTool(tool: string) {
  const l = ladderOfTool(tool);
  if (!l) return;
  remembered[l.group.id] = tool;
  try { localStorage.setItem(STORE, JSON.stringify(remembered)); } catch { /* not remembered */ }
}

// ---------------------------------------------------------------- thumbnails (one offscreen renderer, used once and dropped)

const thumbs = new Map<number, string>();
/** Snapshots of each rung's first design by day, rendered on first use and kept for the session. */
function shootThumbs() {
  if (thumbs.size) return;
  buildModels();
  const W = 168, H = 120;
  const canvas = document.createElement('canvas');
  const r = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  r.setSize(W, H, false);
  r.toneMapping = ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  const scene = new Scene();
  scene.background = new Color(0x9fc4e8);
  scene.add(new HemisphereLight(0xbfd9ff, 0x5a6b45, 1.05));
  const sun = new DirectionalLight(0xfff3e0, 2.4);
  sun.position.set(6, 10, 5);
  scene.add(sun);
  const groundMat = new MeshLambertMaterial({ color: 0x5f8a4a });
  const ground = new Mesh(new PlaneGeometry(30, 30).rotateX(-Math.PI / 2), groundMat);
  ground.position.y = -0.002;
  scene.add(ground);
  const cam = new PerspectiveCamera(30, W / H, 0.05, 200);
  const mat = buildingMaterial();
  // the building shader reads the shared night uniform: shoot by day and put the city's value back after
  const night = sceneUniforms.uNight.value, hour = sceneUniforms.uHour.value;
  sceneUniforms.uNight.value = 0; sceneUniforms.uHour.value = 12;
  const look = new Vector3();
  try {
    for (const l of TOOL_LADDERS) for (const k of l.tiers) {
      const d = model(`${k.kindId}:1:0`);
      if (!d) continue;
      const m = new Mesh(d.geometry, mat);
      scene.add(m);
      const span = Math.max(k.footprint?.w ?? 1, k.footprint?.h ?? 1);
      const size = Math.max(span, d.height * 1.3);
      const dist = 1.25 + size * 1.55;
      look.set(0, Math.min(d.height * 0.35, 1.2), 0);
      cam.position.set(Math.sin(-0.62) * Math.cos(0.5) * dist, look.y + Math.sin(0.5) * dist, Math.cos(-0.62) * Math.cos(0.5) * dist);
      cam.lookAt(look);
      r.render(scene, cam);
      thumbs.set(k.kindId, canvas.toDataURL('image/png'));
      scene.remove(m);
    }
  } finally {
    sceneUniforms.uNight.value = night; sceneUniforms.uHour.value = hour;
    mat.dispose(); groundMat.dispose(); ground.geometry.dispose();
    r.dispose();
    r.forceContextLoss();
  }
}

// ---------------------------------------------------------------- the popover

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => '$' + Math.round(n).toLocaleString();

/** One line on what a rung holds and does, by what kind of ladder it is. */
function capacityLine(k: KindManifest, g: GroupDef): string {
  const s = tierSummary(k);
  const parts: string[] = [];
  if (g.holds === 'bays') parts.push(`${s.holds} bays${k.levels[0].parking.underground > s.holds ? ` (${k.levels[0].parking.underground} deep)` : ''}`);
  else parts.push(`${s.holds} ${s.holdsWhat}`);
  if (s.strength !== undefined && s.radius !== undefined) parts.push(`covers ${s.radius} tiles at ${Math.round(s.strength * 100)}%`);
  if (s.workRate !== undefined) parts.push(`${Math.round(s.workRate * 100)}% pace`);
  if (k.family === 'leisure' && s.radius) parts.push(`reach ${s.radius} tiles`);
  if (s.patrolRate !== undefined && k.flags.service) parts.push(s.patrolRate > 0 ? `${s.patrolRate}× ${g.id === 'health' ? 'ambulances' : g.id === 'fire' ? 'call-outs' : 'patrols'}` : 'no vehicles');
  return parts.join(' · ');
}

export interface PickerHost {
  /** the player's unlocked tech ids (null before the welcome) */
  tech(): readonly string[] | null;
  /** choose a rung's tool */
  choose(tool: string): void;
  /** a locked rung was clicked */
  locked(msg: string): void;
}

export class SizePicker {
  readonly el: HTMLDivElement;
  open: string | null = null;
  private active = '';
  constructor(private host: PickerHost) {
    this.el = document.createElement('div');
    this.el.id = 'picker';
    this.el.className = 'hidden';
    this.el.setAttribute('role', 'dialog');
    document.getElementById('ui')!.appendChild(this.el);
    // a click anywhere but the picker or a ladder button closes it
    document.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      const t = e.target as HTMLElement | null;
      if (t && (this.el.contains(t) || t.closest('button[data-ladder]'))) return;
      this.close();
    });
  }

  isLocked(tool: string) {
    const tech = this.host.tech();
    return !DEV_TOOLS && !!tech && !hasFeature(tech, tool);
  }
  /** Show the ladder's cards beside its tool bar button. */
  show(group: string, anchor: HTMLElement, activeTool: string) {
    const l = ladderById(group);
    if (!l) return;
    shootThumbs();
    this.open = group;
    this.active = activeTool;
    this.render(l);
    this.el.classList.remove('hidden');
    const bar = anchor.closest('#tools') as HTMLElement | null;
    const br = (bar ?? anchor).getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    this.el.style.left = `${Math.round(br.right + 8)}px`;
    const h = this.el.offsetHeight;
    this.el.style.top = `${Math.round(Math.max(52, Math.min(window.innerHeight - h - 12, ar.top - 12)))}px`;
  }
  close() {
    this.open = null;
    this.el.classList.add('hidden');
  }
  /** Re-render when the tool or the player's tech changes while open. */
  refresh(activeTool?: string) {
    if (activeTool !== undefined) this.active = activeTool;
    const l = this.open ? ladderById(this.open) : undefined;
    if (l) this.render(l);
  }

  private render(l: Ladder) {
    const g = l.group;
    const cards = l.tiers.map((k) => {
      const tool = k.tool!.id, locked = this.isLocked(tool), t = techFor(tool);
      const s = tierSummary(k);
      const need = t ? `${esc(t.name)} · ${esc(TRACK_NAMES[t.track])} ${t.tier}` : 'from the start';
      return `<button class="card${locked ? ' locked' : ''}${tool === this.active ? ' on' : ''}" data-pick="${esc(tool)}" aria-pressed="${tool === this.active}" aria-disabled="${locked}" title="${esc(k.blurb ?? '')}">
        <span class="thumb"><img alt="" src="${thumbs.get(k.kindId) ?? ''}" /><span class="fp">${esc(s.footprint)}</span><span class="tn">${s.tier}</span></span>
        <span class="nm">${esc(k.tool!.label)}</span>
        <span class="ln">${esc(capacityLine(k, g))}</span>
        <span class="ln"><b>${money(s.cost)}</b> · ${money(s.upkeep)}/day${s.work ? ` · ${s.work} work` : ' · instant'}</span>
        <span class="tech">${locked ? `🔒 Needs ${need}` : t ? `✓ ${esc(t.name)}` : 'Available from the start'}</span>
      </button>`;
    }).join('');
    const cur = l.tiers.find((k) => k.tool!.id === this.active) ?? l.tiers[0];
    this.el.innerHTML = `<div class="ph"><b>${esc(g.label)}</b><span>${l.tiers.length} sizes · smallest first</span><button class="x" aria-label="Close">×</button></div>
      <div class="cards">${cards}</div>
      <div class="about"><b>${esc(cur.tool!.label)}</b> ${esc(cur.blurb ?? '')}<br><span>${esc(cur.howTo ?? '')}</span></div>`;
    this.el.querySelector<HTMLButtonElement>('.x')!.onclick = () => this.close();
    const about = this.el.querySelector<HTMLDivElement>('.about')!;
    this.el.querySelectorAll<HTMLButtonElement>('button.card').forEach((b) => {
      const k = l.tiers.find((x) => x.tool!.id === b.dataset.pick)!;
      b.onmouseenter = () => { about.innerHTML = `<b>${esc(k.tool!.label)}</b> ${esc(k.blurb ?? '')}<br><span>${esc(k.howTo ?? '')}</span>`; };
      b.onclick = () => {
        const tool = b.dataset.pick!;
        if (this.isLocked(tool)) {
          const t = techFor(tool);
          this.host.locked(`${k.tool!.label} needs ${t?.name ?? 'a technology'} (${t ? `${TRACK_NAMES[t.track]} tier ${t.tier}, ${money(t.cost)}` : ''}): press T for the tech tree`);
          return;
        }
        rememberTool(tool);
        this.host.choose(tool);
        this.close();
      };
    });
  }
}
/** For headless checks: the snapshot data URLs by kind id. */
export const pickerThumbs = () => thumbs;
