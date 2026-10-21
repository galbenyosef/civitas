import { BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, MeshBasicMaterial, PlaneGeometry, Vector3, type PerspectiveCamera } from 'three';
import {
  KIND_NAMES, BRIDGE_STYLE_NAMES, hasFeature, techFor, isRoad, spendableMoney, planRoad, parallelGap, describeDemolition, ROAD_DRAG_MAX,
  type RoadPlan, type RoadEnv, type RoadShape, type RoadTileState,
} from '@msimcity/shared';
import type { ClientWorld } from './world';

/**
 * The road tool's preview (docs/roads.md "The road tool"): while a road is dragged, its tiles as a translucent ghost
 * coloured by what each will be (shared/src/roadtool.ts planRoad, the server's own rules on the loaded chunks), a chip
 * at the end with the running cost and the first reason anything is refused, the spacing guide (faint lines at the
 * depth of the block the new road makes with the nearest road alongside it, and the depth on the chip), and the
 * question asked on release when buildings are in the way.
 */
const COLOUR: Record<RoadTileState, number> = {
  new: 0x9ec9ff, have: 0xffffff, upgrade: 0x62d2a2, bridge: 0x5fb4ff, demolish: 0xffb020, refused: 0xff3b30,
};
/** new road on unclaimed land (the public premium) */
const UNCLAIMED = 0xc6b3ff;
const GUIDE = 0xfff1b8;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-GB')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the player answered when asked about the buildings in a drag's way. */
export type DemolishAnswer = 'demolish' | 'round' | 'cancel';

export class RoadTool {
  readonly group = new Group();
  private quads: InstancedMesh;
  private guide: LineSegments;
  private chip: HTMLDivElement;
  private dialog: HTMLDivElement;
  private memo: { key: string; at: number; v: RoadPlan } | null = null;
  private end = new Vector3();
  private tmp = new Vector3();
  /** the depth of the block the drag makes with the road alongside it, for the chip */
  private depth = 0;

  constructor(private world: ClientWorld, private dev: boolean) {
    this.quads = new InstancedMesh(new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), new MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), ROAD_DRAG_MAX);
    this.quads.count = 0;
    this.quads.frustumCulled = false;
    this.quads.renderOrder = 18;
    this.quads.setColorAt(0, new Color(0xffffff));
    this.guide = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: GUIDE, transparent: true, opacity: 0.55, depthWrite: false }));
    this.guide.frustumCulled = false;
    this.guide.renderOrder = 19;
    this.group.add(this.quads, this.guide);
    this.chip = document.createElement('div');
    this.chip.id = 'roadChip';
    this.chip.style.display = 'none';
    this.dialog = document.createElement('div');
    this.dialog.id = 'roadAsk';
    this.dialog.className = 'hidden';
    this.dialog.setAttribute('role', 'dialog');
    document.body.append(this.chip, this.dialog);
  }

  /** The rules the server lays a drag by, on the loaded chunks, for the player at this client. */
  private env(): RoadEnv {
    const w = this.world, me = w.myPlayer;
    const pub = this.dev || (!!me && hasFeature(me.tech, 'publicRoads'));
    const bridges = this.dev || (!!me && hasFeature(me.tech, 'bridges'));
    return {
      tile: (x, y) => w.getTile(x, y),
      aux: (x, y) => w.auxAt(x, y),
      kindId: (x, y) => w.kindIdAt(x, y),
      land: (x, y) => { const p = w.parcelAt(x, y); return p ? (w.mayEdit(p.owner) ? null : 'Not your land') : pub ? null : `${techFor('publicRoads')?.name ?? 'Public works'} is needed to lay roads outside your own land`; },
      claimed: (x, y) => !!w.parcelAt(x, y),
      structure: (x, y) => { const s = w.structureAt(x, y); return s ? KIND_NAMES[s.kind] : undefined; },
      bridgeLock: bridges ? null : techFor('bridges')?.name ?? 'Civil engineering',
    };
  }

  /** The plan for a drag as it would be laid with a yes to any demolition (so the ghost shows what is in the way), cached briefly. */
  plan(path: [number, number][], demolish = true): RoadPlan {
    const me = this.world.myPlayer;
    const key = `${path.length}|${path[0]}|${path[path.length - 1]}|${path[Math.floor(path.length / 2)]}|${demolish}`, now = performance.now();
    if (this.memo && this.memo.key === key && now - this.memo.at < 200) return this.memo.v;
    const v = planRoad(path, this.env(), { demolish, budget: me ? spendableMoney(me.money, me.devUnlimited) : 0 });
    this.memo = { key, at: now, v };
    return v;
  }

  /** The spacing guide for a drag: the block its straight stretch makes with the nearest road alongside, or null. */
  gap(path: [number, number][]) {
    const w = this.world;
    // the stretch from the drag's corner (or start) to its end: the leg being drawn now
    const n = path.length;
    if (n < 2) return null;
    const sx = path[n - 1][0] - path[n - 2][0], sy = path[n - 1][1] - path[n - 2][1];
    let i = n - 2;
    while (i > 0 && path[i][0] - path[i - 1][0] === sx && path[i][1] - path[i - 1][1] === sy) i--;
    const leg = path.slice(i);
    const mine = new Set(path.map(([x, y]) => `${x},${y}`));
    const isRoadAt = (x: number, y: number) => { if (mine.has(`${x},${y}`)) return false; const t = w.getTile(x, y); return t !== undefined && isRoad(t); };
    const g = parallelGap(leg, isRoadAt);
    return g ? { ...g, leg } : null;
  }

  /** Once per frame: the ghost, guide and chip for the drag in progress (null when there is none). */
  frame(path: [number, number][] | null, camera: PerspectiveCamera, vw: number, vh: number) {
    if (!path) { this.quads.count = 0; this.guide.visible = false; this.chip.style.display = 'none'; return; }
    const v = this.plan(path);
    const m = new Matrix4(), c = new Color();
    let n = 0;
    for (const t of v.tiles) {
      if (n >= ROAD_DRAG_MAX) break;
      m.makeTranslation(t.x + 0.5, t.state === 'have' ? 0.04 : 0.06, t.y + 0.5);
      this.quads.setMatrixAt(n, m);
      this.quads.setColorAt(n, c.setHex(t.state === 'new' && t.unclaimed ? UNCLAIMED : COLOUR[t.state]).multiplyScalar(t.state === 'have' ? 0.45 : 1));
      n++;
    }
    this.quads.count = n;
    this.quads.instanceMatrix.needsUpdate = true;
    if (this.quads.instanceColor) this.quads.instanceColor.needsUpdate = true;
    this.drawGuide(path);
    // the chip at the drag's end
    const [ex, ey] = path[path.length - 1];
    this.end.set(ex + 0.5, 0.1, ey + 0.5);
    this.tmp.copy(this.end).project(camera);
    const show = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
    this.chip.style.display = show ? '' : 'none';
    if (show) {
      this.chip.innerHTML = this.chipHtml(v);
      this.chip.style.transform = `translate(${((this.tmp.x + 1) / 2) * vw + 18}px, ${((1 - this.tmp.y) / 2) * vh - 10}px)`;
    }
  }

  /** Faint lines along the drag's straight stretch at the spacing of the road alongside: where the next road makes the same block. */
  private drawGuide(path: [number, number][]) {
    const g = this.gap(path);
    this.depth = g?.depth ?? 0;
    if (!g) { this.guide.visible = false; return; }
    const { leg, side, offset } = g;
    const alongX = leg[0][1] === leg[leg.length - 1][1];
    const a0 = Math.min(...leg.map((t) => (alongX ? t[0] : t[1]))), a1 = Math.max(...leg.map((t) => (alongX ? t[0] : t[1]))) + 1;
    const across = alongX ? leg[0][1] : leg[0][0];
    const pts: number[] = [];
    // the next road the same distance on the far side, and the one after it (a hint, not a snap)
    for (const k of [1, 2]) {
      const c = across - side * offset * k + 0.5;
      if (alongX) pts.push(a0 - 1, 0.07, c, a1 + 1, 0.07, c); else pts.push(c, 0.07, a0 - 1, c, 0.07, a1 + 1);
    }
    this.guide.geometry.dispose();
    this.guide.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3));
    this.guide.visible = true;
  }

  private chipHtml(v: RoadPlan): string {
    const parts: string[] = [];
    const laid = v.fresh || v.upgrade;
    parts.push(laid ? `<b>${money(v.cost)}</b> · ${plural(v.fresh, 'tile')}${v.unclaimed ? ` · ${v.unclaimed} on unclaimed land` : ''}` : v.have && !v.refused ? 'road already' : '');
    if (this.depth) parts.push(`<span class="guide">block ${this.depth} deep</span>`);
    let html = parts.filter(Boolean).join(' · ');
    if (v.demolish.n) html += `<div class="ask">${describeDemolition(v.demolish.kinds)} in the way: you'll be asked</div>`;
    if (v.refused) html += `<div class="bad">${plural(v.refused, 'tile')} refused: ${esc(v.reason ?? '')}</div>`;
    return html || 'road already';
  }

  /** Status-line text for the road tool: the drag's cost and refusals, or how to use it. */
  status(path: [number, number][] | null, shape: RoadShape): string {
    if (!path) return ' · drag to lay road: one corner like track, hold Shift while dragging for a loop; Ctrl/Cmd+Z undoes the last drag';
    const v = this.plan(path);
    let s = v.fresh || v.upgrade ? ` · ${money(v.cost)} · ${plural(v.fresh, 'tile')}${v.unclaimed ? ` · ${v.unclaimed} on unclaimed land` : ''}` : ' · road already';
    for (const b of v.bridges) if (b.plan.ok && b.plan.tiles?.length) s += ` · a ${BRIDGE_STYLE_NAMES[b.plan.style!]} of ${plural(b.plan.tiles.length / 3, 'tile')}, ${money(b.plan.cost!)}`;
    if (v.demolish.n) s += ` · ${describeDemolition(v.demolish.kinds)} in the way`;
    if (v.refused) s += ` · ${plural(v.refused, 'tile')} refused: ${v.reason}`;
    if (this.depth) s += ` · block ${this.depth} deep`;
    return s + (shape === 'loop' ? ' · loop (let go of Shift for a line)' : '') + ' · release to lay it, Esc to cancel';
  }

  /**
   * Ask about the buildings a drag would demolish, with the cost, near the screen point (cx, cy): demolish them and
   * build, build round them, or cancel. One answer covers the whole drag. Enter goes round, Esc cancels.
   */
  ask(v: RoadPlan, cx: number, cy: number): Promise<DemolishAnswer> {
    const d = this.dialog;
    const what = describeDemolition(v.demolish.kinds);
    const withYes = v.cost + v.demolish.cost;
    d.innerHTML = `<h3>Demolish ${esc(what)}?</h3>`
      + `<p>This road runs over ${esc(what)}. Demolishing ${v.demolish.n === 1 ? 'it' : 'them'} and laying the road costs <b>${money(withYes)}</b> in all `
      + `(${money(v.demolish.cost)} of it for the ${plural(v.demolish.n, 'tile')} in the way; nothing is refunded).</p>`
      + `<div class="row"><button data-a="demolish" class="danger">Demolish and build · ${money(withYes)}</button>`
      + `<button data-a="round">Build round ${v.demolish.n === 1 ? 'it' : 'them'} · ${money(v.cost)}</button>`
      + `<button data-a="cancel">Cancel</button></div>`;
    d.classList.remove('hidden');
    const r = d.getBoundingClientRect();
    d.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, cx - r.width / 2))}px`;
    d.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, cy + 16))}px`;
    (d.querySelector('[data-a="round"]') as HTMLButtonElement | null)?.focus();
    return new Promise((resolve) => {
      const done = (a: DemolishAnswer) => {
        d.classList.add('hidden');
        d.onclick = null;
        window.removeEventListener('keydown', key, true);
        window.removeEventListener('pointerdown', away, true);
        resolve(a);
      };
      const key = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done('cancel'); }
      };
      // a press anywhere else is a cancel, and does not start another drag
      const away = (e: PointerEvent) => { if (!d.contains(e.target as Node)) { e.stopPropagation(); e.preventDefault(); done('cancel'); } };
      d.onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]'); if (b) done(b.dataset.a as DemolishAnswer); };
      window.addEventListener('keydown', key, true);
      window.addEventListener('pointerdown', away, true);
    });
  }
  get asking() { return !this.dialog.classList.contains('hidden'); }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
