import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Vector3, type PerspectiveCamera, Group } from 'three';
import {
  STREET_RULE_DEFS, STREET_RULE_BY_ID, StreetRule, streetRuleTiles, streetRuleCost, streetAxisAt, busLaneOk, hasFeature, techFor, TRACK_NAMES, isRoad,
  type StreetRuleDef, type StreetRuleId,
} from '@msimcity/shared';
import type { ClientWorld } from './world';

/**
 * The Street rules tool (R5, docs/roads.md "Traffic control"): pick a rule in its picker (HGV ban, bus lane, double
 * yellows, 20 zone), then click a street to set it along the whole street, or drag along part of one. The ghost covers
 * the tiles the click would change, in the rule's colour (dim where the rule is already, red where it cannot go), and a
 * chip by the cursor gives the cost, the day's upkeep and, for an HGV ban, how much further a lorry must go round (the
 * server's router answers a 'ruleProbe'). A click on a street that has the rule everywhere takes it off. Ctrl+Z undoes.
 */
const STORE = 'msimcity.streetRule';
const MAX = 600;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString('en-GB')}`;

export interface StreetRuleHost {
  send(rule: StreetRuleId, tiles: [number, number][], on: boolean): void;
  probe(rule: StreetRuleId, tiles: [number, number][], seq: number): void;
  undo(): void;
}

export class StreetRuleTool {
  readonly group = new Group();
  private quads: InstancedMesh;
  private chip: HTMLDivElement;
  private tmp = new Vector3();
  rule: StreetRuleId = 'hgv';
  /** the last probe asked for and its answer (HGV ban: the sample lorry's route cost without and with) */
  private probeKey = ''; private probeSeq = 0; private probeAns: { seq: number; before: number; after: number } | null = null; private probeAt = 0;

  constructor(private world: ClientWorld, private dev: boolean, private host: StreetRuleHost) {
    this.quads = new InstancedMesh(new PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), new MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }), MAX);
    this.quads.count = 0; this.quads.frustumCulled = false; this.quads.renderOrder = 18;
    this.quads.setColorAt(0, new Color(0xffffff));
    this.group.add(this.quads);
    this.chip = document.createElement('div');
    this.chip.id = 'roadChip2';
    this.chip.className = 'ruleChip';
    this.chip.style.display = 'none';
    document.body.append(this.chip);
    try { const r = localStorage.getItem(STORE); if (r && STREET_RULE_BY_ID.has(r)) this.rule = r as StreetRuleId; } catch { /* storage blocked */ }
  }
  get def(): StreetRuleDef { return STREET_RULE_BY_ID.get(this.rule)!; }
  pick(r: StreetRuleId) { this.rule = r; try { localStorage.setItem(STORE, r); } catch { /* not remembered */ } }
  /** The technology a rule still needs here, or null. */
  lockOf(r: StreetRuleId): string | null {
    const me = this.world.myPlayer, f = STREET_RULE_BY_ID.get(r)!.feature;
    if (this.dev || !me) return null;
    return hasFeature(me.tech, f) ? null : techFor(f)?.name ?? 'a technology';
  }
  private env() {
    const w = this.world;
    return {
      road: (x: number, y: number) => { const t = w.getTile(x, y); return t !== undefined && isRoad(t); },
      aux: (x: number, y: number) => w.auxAt(x, y),
      bits: (x: number, y: number) => w.ruleAt(x, y)?.st ?? 0,
    };
  }
  /** The tiles a release would set: the whole street through `h` along `ns` (a click), or the drag. */
  tilesFor(h: [number, number] | null, drag: [number, number][] | null, ns: boolean): [number, number][] {
    if (drag && drag.length > 1) return drag.filter(([x, y]) => this.env().road(x, y));
    if (!h) return [];
    const env = this.env();
    // a one-way or an avenue's carriageway: its own way; a tile on one street only: that street, whatever the cursor's side
    return streetRuleTiles(env, h[0], h[1], streetAxisAt(env, h[0], h[1], ns), this.rule);
  }
  /** Is this tile one the player may set a rule on? */
  private mine(x: number, y: number): boolean {
    const p = this.world.parcelAt(x, y), me = this.world.myPlayer;
    if (p) return this.world.mayEdit(p.owner);
    return this.dev || this.world.sandbox || (!!me && hasFeature(me.tech, 'publicRoads'));
  }
  /** What a release would do: tiles changed, cost, upkeep, on or off, and why some or all are refused. */
  plan(tiles: [number, number][]) {
    const env = this.env(), bit = this.def.bit;
    const ok = tiles.filter(([x, y]) => this.mine(x, y));
    const c = streetRuleCost(env, ok, bit);
    let reason = ok.length < tiles.length ? 'not all of it is yours' : '';
    if (bit === StreetRule.BusLane && !ok.some(([x, y]) => busLaneOk(env.aux(x, y)))) reason = 'one lane each way: a bus lane needs a one-way street or an avenue';
    const lock = this.lockOf(this.rule);
    if (lock && c.on) reason = `needs ${lock}`;
    return { ...c, tiles: c.tiles, ok, reason };
  }

  /** Once per frame: the ghost and chip under the cursor (nothing when another tool is in use). */
  frame(active: boolean, h: [number, number] | null, drag: [number, number][] | null, ns: boolean, camera: PerspectiveCamera, vw: number, vh: number) {
    if (!active || !h) { this.quads.count = 0; this.chip.style.display = 'none'; return; }
    const tiles = this.tilesFor(h, drag, ns);
    const env = this.env(), bit = this.def.bit, p = this.plan(tiles);
    const m = new Matrix4(), c = new Color();
    let n = 0;
    for (const [x, y] of tiles) {
      if (n >= MAX) break;
      const has = (env.bits(x, y) & bit) !== 0, bad = !this.mine(x, y) || (bit === StreetRule.BusLane && !busLaneOk(env.aux(x, y)));
      m.makeTranslation(x + 0.5, 0.06, y + 0.5);
      this.quads.setMatrixAt(n, m);
      this.quads.setColorAt(n, c.setHex(bad ? 0xd04040 : this.def.colour).multiplyScalar(bad ? 0.7 : has && p.on ? 0.45 : !p.on ? 0.6 : 1));
      n++;
    }
    this.quads.count = n;
    this.quads.instanceMatrix.needsUpdate = true;
    if (this.quads.instanceColor) this.quads.instanceColor.needsUpdate = true;
    // an HGV ban: ask the server what it does to a lorry going past (at most every 400 ms, on a new street)
    if (this.rule === 'hgv' && p.on && tiles.length > 1) {
      const key = `${tiles[0]}|${tiles[tiles.length - 1]}|${tiles.length}`, now = performance.now();
      if (key !== this.probeKey && now - this.probeAt > 400) { this.probeKey = key; this.probeAt = now; this.probeAns = null; this.host.probe('hgv', tiles, ++this.probeSeq); }
    }
    this.tmp.set(h[0] + 0.5, 0.1, h[1] + 0.5).project(camera);
    const show = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
    this.chip.style.display = show ? '' : 'none';
    if (!show) return;
    this.chip.innerHTML = this.chipHtml(p, tiles.length);
    // above the cursor: the road tooltip opens below it
    this.chip.style.transform = `translate(${((this.tmp.x + 1) / 2) * vw + 18}px, ${((1 - this.tmp.y) / 2) * vh - 64}px)`;
  }
  /** The server's answer to the last probe. */
  probed(m: { seq: number; before: number; after: number }) { if (m.seq === this.probeSeq) this.probeAns = m; }
  private chipHtml(p: ReturnType<StreetRuleTool['plan']>, n: number): string {
    const d = this.def, parts: string[] = [`<span class="cls" style="color:${hex(d.colour)}">${esc(d.title)}</span>`];
    if (p.reason && (!p.tiles || /one lane|needs/.test(p.reason))) return `${parts[0]} · <span class="bad">${esc(p.reason)}</span>`;
    if (p.on) parts.push(`<b>${money(p.cost)}</b> · ${p.tiles} tile${p.tiles === 1 ? '' : 's'} · ${money(p.upkeep)} a day`);
    else parts.push(`click to take it off (${p.tiles} tile${p.tiles === 1 ? '' : 's'})`);
    let html = parts.join(' · ');
    if (this.rule === 'hgv' && p.on && n > 1) {
      const a = this.probeAns;
      html += `<div class="guide">${!a ? 'lorries: working out the way round…' : a.after < 0 ? 'lorries going past: no way round (deliveries here still come)' : a.after <= a.before ? 'lorries going past: no longer way round' : `lorries going past: ${a.after - a.before} tiles further round`}</div>`;
    }
    if (p.reason) html += `<div class="bad">${esc(p.reason)}</div>`;
    return html;
  }

  /** Status-line text for the tool. */
  status(h: [number, number] | null, drag: [number, number][] | null, ns: boolean): string {
    const d = this.def;
    if (!h) return ` · ${d.title}: click a street, or drag along part of one`;
    const tiles = this.tilesFor(h, drag, ns);
    if (!tiles.length) return ` · ${d.title}: click a street (Ctrl+Z undoes)`;
    const p = this.plan(tiles);
    if (p.reason && !p.tiles) return ` · ${p.reason}`;
    return p.on ? ` · ${d.title} on ${p.tiles} tile${p.tiles === 1 ? '' : 's'}: ${money(p.cost)}, ${money(p.upkeep)} a day` : ` · click to take the ${d.title.toLowerCase()} off`;
  }

  /** A release of the tool: send it (the server checks every tile again). */
  release(tiles: [number, number][]): string | null {
    if (!tiles.length) return null;
    const p = this.plan(tiles);
    if (p.reason && !p.tiles) return p.reason;
    if (!p.ok.length) return 'Not your street';
    this.host.send(this.rule, p.ok, p.on);
    return null;
  }
}

/** A rule's card picture: its sign or marking, drawn small. */
function sketch(d: StreetRuleDef): string {
  const W = 168, H = 120, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b3e45'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, W, 14); g.fillRect(0, H - 14, W, 14);
  const roundel = (cx: number, cy: number, r: number, fill = '#fff') => { g.fillStyle = '#d8423a'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, r * 0.74, 0, 7); g.fill(); };
  if (d.id === 'hgv') {
    roundel(84, 60, 38);
    g.fillStyle = '#222'; g.fillRect(56, 50, 34, 18); g.fillRect(92, 55, 16, 13); // a lorry
    g.beginPath(); g.arc(64, 70, 4, 0, 7); g.arc(100, 70, 4, 0, 7); g.fill();
  } else if (d.id === 'bus') {
    g.fillStyle = '#a8322c'; g.fillRect(0, 66, W, 40);
    g.fillStyle = '#f2f2ee'; g.fillRect(0, 62, W, 4);
    g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.fillText('BUS LANE', 84, 93);
    for (let x = 10; x < W; x += 34) g.fillRect(x, 36, 18, 3);
  } else if (d.id === 'yellow') {
    g.fillStyle = '#f2c230'; g.fillRect(0, 92, W, 4); g.fillRect(0, 99, W, 4);
    for (let x = 10; x < W; x += 34) { g.fillStyle = '#f2f2ee'; g.fillRect(x, 58, 18, 3); }
  } else {
    roundel(84, 52, 34);
    g.fillStyle = '#111'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('20', 84, 54);
    g.fillStyle = '#e8e4d8'; for (let x = 20; x < W - 10; x += 16) { g.fillRect(x, 96, 8, 6); } // a hump's chevrons
  }
  return c.toDataURL();
}
const sketches = new Map<string, string>();

export interface RulePickerHost { picked(): StreetRuleId; lockOf(r: StreetRuleId): string | null; pick(r: StreetRuleId): void; locked(msg: string): void }
/** The Street rules tool's picker, beside the tool bar like the road classes' (roadpicker.ts). */
export class StreetRulePicker {
  readonly el: HTMLDivElement;
  open = false;
  constructor(private host: RulePickerHost) {
    this.el = document.createElement('div');
    this.el.id = 'rulePicker';
    this.el.className = 'hidden';
    this.el.setAttribute('role', 'dialog');
    document.getElementById('ui')!.appendChild(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      const t = e.target as HTMLElement | null;
      if (t && (this.el.contains(t) || t.closest('button[data-tool="streetrule"]'))) return;
      this.close();
    });
  }
  show(anchor: HTMLElement) {
    if (!sketches.size) for (const d of STREET_RULE_DEFS) sketches.set(d.id, sketch(d));
    this.open = true;
    this.render();
    this.el.classList.remove('hidden');
    const bar = anchor.closest('#tools') as HTMLElement | null;
    const br = (bar ?? anchor).getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    this.el.style.left = `${Math.round(br.right + 8)}px`;
    const h = this.el.offsetHeight;
    this.el.style.top = `${Math.round(Math.max(52, Math.min(window.innerHeight - h - 12, ar.top - 12)))}px`;
  }
  close() { this.open = false; this.el.classList.add('hidden'); }
  refresh() { if (this.open) this.render(); }
  private render() {
    const on = this.host.picked();
    const cards = STREET_RULE_DEFS.map((d) => {
      const lock = this.host.lockOf(d.id), t = techFor(d.feature);
      return `<button class="card${lock ? ' locked' : ''}${d.id === on ? ' on' : ''}" data-rule="${d.id}" aria-pressed="${d.id === on}" aria-disabled="${!!lock}" title="${esc(d.blurb)}">
        <span class="thumb"><img alt="" src="${sketches.get(d.id) ?? ''}" /><span class="fp" style="color:${hex(d.colour)}">●</span></span>
        <span class="nm">${esc(d.title)}</span>
        <span class="ln"><b>$${d.cost}/tile</b> · $${d.upkeep}/day</span>
        <span class="tech">${lock ? `🔒 Needs ${esc(lock)}${t ? ` · ${esc(TRACK_NAMES[t.track])} ${t.tier}` : ''}` : t ? `✓ ${esc(t.name)}` : 'Available from the start'}</span>
      </button>`;
    }).join('');
    const cur = STREET_RULE_BY_ID.get(on)!;
    const about = (d: StreetRuleDef) => `<b>${esc(d.title)}</b> ${esc(d.blurb)}<br><span>Click a street to put it along the whole street, or drag along part of one; click a street that has it to take it off. Ctrl+Z undoes. Public road on unclaimed land needs Public works.</span>`;
    this.el.innerHTML = `<div class="ph"><b>Street rules</b><span>${STREET_RULE_DEFS.length} rules · per street, shown on the road</span><button class="x" aria-label="Close">×</button></div>
      <div class="cards">${cards}</div>
      <div class="about">${about(cur)}</div>`;
    this.el.querySelector<HTMLButtonElement>('.x')!.onclick = () => this.close();
    const ab = this.el.querySelector<HTMLDivElement>('.about')!;
    this.el.querySelectorAll<HTMLButtonElement>('button.card').forEach((b) => {
      const d = STREET_RULE_BY_ID.get(b.dataset.rule!)!;
      b.onmouseenter = () => { ab.innerHTML = about(d); };
      b.onclick = () => {
        const lock = this.host.lockOf(d.id);
        if (lock) { const t = techFor(d.feature); this.host.locked(`${d.title} needs ${lock}${t ? ` (${TRACK_NAMES[t.track]} tier ${t.tier}, $${t.cost})` : ''}: press T for the tech tree`); return; }
        this.host.pick(d.id);
        this.close();
      };
    });
  }
}
