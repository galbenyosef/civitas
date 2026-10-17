import { Group, Mesh, MeshBasicMaterial, RingGeometry, DoubleSide } from 'three';
import { isFreightYardKind, stopName, stopModeOf, hasFeature, techFor, TRANSIT, TICKS_PER_DAY, TICKS_PER_HOUR, type LineInfo, type StopInfo, type BusInfo, type StopRef, type ServerMsg, type TransitMode } from '@msimcity/shared';
import { Ribbon } from './render/route';
import type { NetClient } from './net';
import type { ClientWorld } from './world';

/**
 * Transit lines (docs/transit.md): the top-bar **lines** chip opens a panel of your lines. A line is stops clicked in
 * order on the map (while a line is being edited, a click on a bus stop adds it), a number, a colour, loop or there
 * and back, and the buses you want on it; the server routes it over the roads (sim/transit.ts) and answers with the
 * road path, drawn here as a ribbon in the line's colour while the panel is open. The same 'lines' message carries
 * which line each bus on the road runs, for its livery (render/citizens.ts).
 */

const PALETTE = [0xd94f4f, 0x2f8fd6, 0x3fa34d, 0xe6a23c, 0x8e5bd6, 0x1fb5a8, 0xd65bab, 0x5c6270];
const RIBBON_Y = 0.075, RIBBON_W = 0.12, EDIT_W = 0.07;
const hex = (c: number) => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const hm = (t: number) => { const h = (t % TICKS_PER_DAY) / TICKS_PER_HOUR; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };
/** The server tick now (set by LinesPanel from the game clock), for arrival estimates in tooltips. */
let clock: () => number = () => 0;
/** A number badge in the line's colour. */
export const lineBadge = (n: number, colour: number) => `<span class="lbadge" style="background:${hex(colour)}">${n}</span>`;

/** The stop section of a bus stop's tooltip and panel (BuildingInfo.transit). */
export function stopHtml(s: StopInfo, row: (k: string, v: string | number) => string): string {
  const tick = clock();
  let html = `<div class="sect">${esc(s.name)}</div>`;
  if (s.problem) html += row('Buses', `<span class="bad">${esc(s.problem)}</span>`);
  if (!s.lines.length) html += row('Lines', '<span style="color:var(--muted)">none call here yet (open the lines panel)</span>');
  for (const l of s.lines) {
    const next = l.nextArrival === undefined ? (l.inService ? '' : 'not running now') : l.nextArrival <= tick + 1 ? 'at the stop now' : `next ~${hm(l.nextArrival)} (${Math.max(1, Math.round(((l.nextArrival - tick) * 60) / TICKS_PER_HOUR))} min)`;
    html += row(`${lineBadge(l.number, l.colour)} line ${l.number}`, `${l.waiting} waiting${next ? ` · ${next}` : ''}`);
  }
  html += row('Waiting now', s.waiting);
  html += row('Boardings', `${s.boardingsToday} today · ${s.boardingsYesterday} yesterday`);
  return html;
}
/** The bus section of a bus's tooltip and panel (CitizenInfo.bus). */
export function busHtml(b: BusInfo, row: (k: string, v: string | number) => string): string {
  let html = row('Line', `${lineBadge(b.number, b.colour)} ${esc(b.state)}`);
  if (b.nextStop) html += row('Next stop', esc(b.nextStop));
  html += row('On board', `${b.load} / ${b.capacity}`);
  html += `<div class="bar"><i style="width:${Math.min(100, (100 * b.load) / b.capacity)}%"></i></div>`;
  html += row('Running', b.delayMin > 1 ? `<span class="bad">${b.delayMin} min late</span>` : 'on time');
  return html;
}

/** `mode` comes from the first stop clicked: bus stops make a bus line, rail stations a rail line (docs/rail.md) */
interface Draft { id?: number; number: number; colour: number; loop: boolean; vehicles: number; stops: StopRef[]; mode?: TransitMode }
const VEHICLE: Record<TransitMode, [string, string]> = { bus: ['bus', 'buses'], rail: ['train', 'trains'] };

export class LinesPanel {
  readonly group = new Group();
  private lines: LineInfo[] = [];
  private open = false;
  private draft: Draft | null = null;
  private ribbons: Ribbon[] = [];
  private marks: Mesh[] = [];
  private editRibbon = new Ribbon(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide, toneMapped: false }), RIBBON_Y + 0.004);
  private el: HTMLDivElement;
  private chip: HTMLButtonElement;
  private dirty = true;
  /** called with the bus -> line pairs and line colours whenever a 'lines' message arrives */
  onLivery: (pairs: number[], colours: Map<number, number>) => void = () => {};
  /** called when editing starts, so the map is in select mode and a click on a stop reaches mapClick */
  onEdit: () => void = () => {};

  constructor(private net: NetClient, private world: ClientWorld, private toast: (kind: 'info' | 'error', msg: string) => void, tick: () => number) {
    clock = tick;
    this.chip = document.createElement('button');
    this.chip.className = 'chip'; this.chip.id = 'linesBtn'; this.chip.textContent = 'lines';
    this.chip.title = 'Bus lines: make a route from your stops, pick a number, colour and buses';
    document.getElementById('techBtn')!.before(this.chip);
    this.chip.onclick = () => this.toggle();
    this.el = document.createElement('div');
    this.el.id = 'linesPanel'; this.el.className = 'hidden';
    document.getElementById('ui')!.appendChild(this.el);
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.editRibbon.mesh.renderOrder = 6;
    this.group.add(this.editRibbon.mesh);
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('input', (e) => this.input(e));
    this.el.addEventListener('change', (e) => this.input(e));
  }

  get isOpen() { return this.open; }
  get editing() { return !!this.draft; }

  toggle(open = !this.open) {
    this.open = open;
    this.el.classList.toggle('hidden', !open);
    this.chip.classList.toggle('on', open);
    if (open) this.net.send({ t: 'lines' });
    else this.draft = null;
    this.render(); this.dirty = true;
  }

  /** A 'lines' message: every line, and which line each bus on the road runs. */
  apply(m: Extract<ServerMsg, { t: 'lines' }>) {
    this.lines = m.lines;
    const colours = new Map(m.lines.map((l) => [l.id, l.colour]));
    this.onLivery(m.buses, colours);
    if (m.saved && this.draft && (this.draft.id === undefined || this.draft.id === m.saved)) this.draft = null; // saved: back to the list
    this.dirty = true;
    if (this.open && !this.draft) this.render();
  }
  /** A 'lineStats' message: buses in service, riders and status since the last full list, and the livery map. */
  applyStats(m: Extract<ServerMsg, { t: 'lineStats' }>) {
    const byId = new Map(m.lines.map((s) => [s.id, s]));
    this.lines = this.lines.map((l) => { const st = byId.get(l.id); return st ? { ...l, ...st } : l; });
    this.onLivery(m.buses, new Map(this.lines.map((l) => [l.id, l.colour])));
    if (this.open && !this.draft) this.render(); // the list only; ribbons are unchanged
  }

  /** A click on the map while a line is being edited: a bus stop adds itself (true: the click was used). */
  mapClick(x: number, y: number): boolean {
    if (!this.open || !this.draft) return false;
    const kind = this.world.kindIdAt(x, y);
    const mode = stopModeOf(kind);
    if (!mode) { this.toast('error', 'Click bus stops or rail stations to add them to the line'); return true; }
    if (this.draft.mode && this.draft.stops.length && mode !== this.draft.mode) { this.toast('error', this.draft.mode === 'rail' ? 'This is a rail line: click rail stations' : 'This is a bus line: click bus stops'); return true; }
    if (mode === 'rail') [x, y] = this.world.doorOf(x, y); // a station is several tiles: the line knows it by its door
    const p = this.world.parcelAt(x, y);
    if (!p || !this.world.mayEdit(p.owner)) { this.toast('error', 'Lines can only use stops on your own land'); return true; }
    const st = this.draft.stops;
    if (st.length && st[st.length - 1].x === x && st[st.length - 1].y === y) return true;
    if (st.length >= TRANSIT.maxStops) { this.toast('error', `A line has at most ${TRANSIT.maxStops} stops`); return true; }
    st.push({ x, y });
    this.draft.mode = mode;
    this.render(); this.dirty = true;
    return true;
  }

  /** the lines this player may edit: their own, or every line in a sandbox */
  private mine() { return this.lines.filter((l) => this.world.mayEdit(l.owner)); }

  private startDraft(l?: LineInfo) {
    if (l) this.draft = { id: l.id, number: l.number, colour: l.colour, loop: l.loop, vehicles: l.vehicles, stops: l.stops.map((s) => ({ ...s })), mode: l.mode };
    else {
      const used = new Set(this.mine().map((x) => x.number));
      let n = 1; while (used.has(n)) n++;
      this.draft = { number: n, colour: PALETTE[(n - 1) % PALETTE.length], loop: true, vehicles: 2, stops: [] };
    }
    this.onEdit();
    this.render(); this.dirty = true;
  }

  private click(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    const act = t.dataset.act!, id = Number(t.dataset.id);
    const d = this.draft;
    if (act === 'close') this.toggle(false);
    else if (act === 'new') {
      const me = this.world.myPlayer;
      if (me && !hasFeature(me.tech, 'lines') && !me.devUnlimited) { this.toast('error', `${techFor('lines')?.name ?? 'Public transport'} is needed before you can run bus lines (T for the tech tree)`); return; }
      this.startDraft();
    } else if (act === 'edit') { const l = this.lines.find((x) => x.id === id); if (l) this.startDraft(l); }
    else if (act === 'delete') { if (confirm(`Delete line ${this.lines.find((x) => x.id === id)?.number}?`)) this.net.send({ t: 'line', op: 'delete', id }); }
    else if (act === 'cancel') { this.draft = null; this.render(); this.dirty = true; }
    else if (act === 'save' && d) this.net.send({ t: 'line', op: 'save', line: { id: d.id, number: d.number, colour: d.colour, loop: d.loop, vehicles: d.vehicles, stops: d.stops } });
    else if (act === 'rm' && d) { d.stops.splice(id, 1); if (!d.stops.length && !d.id) d.mode = undefined; this.render(); this.dirty = true; }
    else if (act === 'undo' && d) { d.stops.pop(); if (!d.stops.length && !d.id) d.mode = undefined; this.render(); this.dirty = true; }
    else if (act === 'swatch' && d) { d.colour = Number(t.dataset.c); this.render(); this.dirty = true; }
    else if (act === 'mode' && d) { d.loop = t.dataset.v === 'loop'; this.render(); this.dirty = true; }
  }
  private input(e: Event) {
    const t = e.target as HTMLInputElement, d = this.draft;
    if (!d) return;
    if (t.name === 'number') d.number = Math.max(1, Math.min(999, Math.floor(Number(t.value) || 1)));
    else if (t.name === 'vehicles') d.vehicles = Math.max(0, Math.min(TRANSIT.maxVehicles, Math.floor(Number(t.value) || 0)));
    else if (t.name === 'colour') { d.colour = parseInt(t.value.slice(1), 16); this.dirty = true; if (e.type === 'change') this.render(); }
  }

  private render() {
    if (!this.open) return;
    const d = this.draft;
    let html = `<div class="lhead"><h3>${d ? (d.id ? `Edit line ${d.number}` : 'New line') : 'Lines'}</h3><button class="chip" data-act="close" title="close">✕</button></div>`;
    if (!d) {
      const mine = this.mine();
      if (!mine.length) html += `<div class="lempty">No lines yet. Place bus stops beside plain stretches of road (Bus stop tool), a bus depot nearby (its staff drive the buses), then make a line here.</div>`;
      for (const l of mine) {
        const ok = l.status === 'running';
        html += `<div class="lrow"><div class="ltop">${lineBadge(l.number, l.colour)}<span class="lname">${l.mode === 'rail' ? (isFreightYardKind(this.world.kindIdAt(l.stops[0].x, l.stops[0].y)) ? 'freight · ' : 'rail · ') : ''}${l.loop ? 'loop' : 'there and back'} · ${l.stops.length} ${l.mode === 'rail' ? 'stations' : 'stops'}</span>
          <button class="chip" data-act="edit" data-id="${l.id}">edit</button><button class="chip" data-act="delete" data-id="${l.id}" title="delete">✕</button></div>
          <div class="lstat"><span class="${ok ? '' : 'bad'}">${esc(l.status)}</span> · ${VEHICLE[l.mode]?.[1] ?? 'vehicles'} ${l.inService}/${l.vehicles}</div>
          <div class="lstat">riders ${l.ridersToday} today, ${l.ridersYesterday} yesterday · fares $${Math.round(l.faresToday)}</div>
          <div class="lstops">${l.stops.map((s, i) => `<span title="${l.stopBoardings[i] ?? 0} boarded today">${esc(stopName(s.x, s.y))}</span>`).join(' → ')}${l.loop ? ' ↺' : ' ⇄'}</div></div>`;
      }
      html += `<button class="chip lnew" data-act="new">+ new line</button>`;
      html += `<div class="lhint">Fares $${TRANSIT.fare} a ride (children free, retirees half) go to you. Buses run ${hm(TRANSIT.serviceStart * TICKS_PER_HOUR)}–${hm(TRANSIT.serviceEnd * TICKS_PER_HOUR)}, one per driver on shift at your depot. Trains run 05:00–01:00 on your track between your rail stations (click stations instead of stops); click freight yards for a freight line, which carries industry's containers instead of passengers.</div>`;
    } else {
      html += `<div class="lform">
        <label>Number <input name="number" type="number" min="1" max="999" value="${d.number}"></label>
        <label>${d.mode === 'rail' ? 'Trains' : 'Buses'} <input name="vehicles" type="number" min="0" max="${TRANSIT.maxVehicles}" value="${d.vehicles}"></label>
      </div>
      <div class="lsw">${PALETTE.map((c) => `<button class="sw${c === d.colour ? ' on' : ''}" data-act="swatch" data-c="${c}" style="background:${hex(c)}" title="${hex(c)}"></button>`).join('')}<input name="colour" type="color" value="${hex(d.colour)}" title="any colour"></div>
      <div class="lmode"><button class="chip${d.loop ? ' on' : ''}" data-act="mode" data-v="loop">loop ↺</button><button class="chip${d.loop ? '' : ' on'}" data-act="mode" data-v="back">there and back ⇄</button></div>
      <div class="lsect">Stops in order <span>${d.stops.length}</span></div>
      ${d.stops.length ? `<ol class="lstoplist">${d.stops.map((s, i) => `<li>${esc(stopName(s.x, s.y))} <span class="lxy">(${s.x}, ${s.y})</span><button class="lrm" data-act="rm" data-id="${i}" title="remove">✕</button></li>`).join('')}</ol>` : ''}
      <div class="lhint">${d.mode === 'rail' ? `Click your rail stations in the order trains should call; consecutive stations must be joined by track, and no other line may use it. ${d.loop ? 'The track must lead from the last station back round to the first; the loop takes as many trains as fit.' : 'Trains reverse at the ends and call everywhere on the way back; one track runs one train.'}` : `Click your bus stops (or rail stations, for a rail line) on the map in the order the bus should call. ${d.loop ? 'The last stop runs back to the first.' : 'Buses turn round at the last stop and call at every stop on the way back.'}`}</div>
      <div class="lbtns"><button class="chip" data-act="undo" ${d.stops.length ? '' : 'disabled'}>undo stop</button><button class="chip" data-act="cancel">cancel</button><button class="chip on" data-act="save" ${d.stops.length >= 2 ? '' : 'disabled'}>save line</button></div>`;
    }
    this.el.innerHTML = html;
  }

  /** Rebuild the ribbons when something changed; keep the edit preview joined to the stops. */
  frame() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const r of this.ribbons) { this.group.remove(r.mesh); r.mesh.geometry.dispose(); (r.mesh.material as MeshBasicMaterial).dispose(); }
    for (const m of this.marks) { this.group.remove(m); m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose(); }
    this.ribbons = []; this.marks = [];
    this.editRibbon.hide();
    if (!this.open) return;
    const mine = this.mine();
    mine.forEach((l, i) => {
      if (this.draft?.id === l.id) return;
      const pts = lanePoints(l.path, true, l.mode === 'rail' ? 0 : 0.19); // trains run on the track's centre line
      if (pts.length < 4) return;
      const r = new Ribbon(new MeshBasicMaterial({ color: l.colour, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide, toneMapped: false }), RIBBON_Y + 0.002 * i);
      r.mesh.renderOrder = 5;
      r.set(pts, new Array(pts.length / 2).fill(RIBBON_W));
      this.ribbons.push(r); this.group.add(r.mesh);
      for (const s of l.stops) this.mark(s, l.colour);
    });
    const d = this.draft;
    if (d) {
      const pts: number[] = [];
      for (const s of d.stops) pts.push(s.x + 0.5, s.y + 0.5);
      if (d.loop && d.stops.length > 2) pts.push(d.stops[0].x + 0.5, d.stops[0].y + 0.5);
      (this.editRibbon.mesh.material as MeshBasicMaterial).color.setHex(d.colour);
      if (pts.length >= 4) this.editRibbon.set(pts, new Array(pts.length / 2).fill(EDIT_W));
      for (const s of d.stops) this.mark(s, d.colour);
    }
  }
  private mark(s: StopRef, colour: number) {
    const m = new Mesh(new RingGeometry(0.22, 0.32, 24).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    m.position.set(s.x + 0.5, RIBBON_Y + 0.01, s.y + 0.5);
    m.renderOrder = 7;
    this.marks.push(m); this.group.add(m);
  }
}

/**
 * A line's lap as ribbon points in the lane the buses drive in: right-hand traffic, so each tile centre is pushed to the
 * right of the direction of travel by the lane offset; `closed` joins the end back to the start.
 */
function lanePoints(path: number[], closed: boolean, O = 0.19): number[] {
  const n = path.length / 2, out: number[] = [];
  if (n < 2) return out;
  const at = (i: number) => [path[((i + n) % n) * 2] + 0.5, path[((i + n) % n) * 2 + 1] + 0.5];
  for (let i = 0; i <= (closed ? n : n - 1); i++) {
    const [x, y] = at(i), [px, py] = at(i - 1), [nx, ny] = at(i + 1);
    let dx = (closed || i < n - 1 ? nx : x) - (closed || i > 0 ? px : x), dy = (closed || i < n - 1 ? ny : y) - (closed || i > 0 ? py : y);
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    out.push(x - dy * O, y + dx * O); // right of travel in x-east, y-south
  }
  return out;
}

const STYLE = `
#linesPanel { position: absolute; top: 52px; right: 324px; width: 300px; max-height: calc(100vh - 80px); overflow-y: auto; padding: 10px 12px 12px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px; backdrop-filter: blur(8px); font-size: 12px; }
#linesPanel.hidden { display: none; }
#linesPanel .lhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
#linesPanel h3 { margin: 0; font-size: 14px; }
#linesPanel .lempty, #linesPanel .lhint { color: var(--muted); line-height: 1.4; margin: 6px 0; }
#linesPanel .lrow { padding: 7px 0; border-top: 1px solid var(--line); }
#linesPanel .ltop { display: flex; align-items: center; gap: 6px; }
#linesPanel .lname { flex: 1; color: var(--fg); }
#linesPanel .lstat { color: var(--muted); margin-top: 2px; }
#linesPanel .lstops { color: var(--muted); margin-top: 3px; font-size: 11px; line-height: 1.4; }
#linesPanel .lnew { margin-top: 8px; }
#linesPanel .lform { display: flex; gap: 10px; }
#linesPanel .lform label { flex: 1; color: var(--muted); }
#linesPanel .lform input { width: 100%; box-sizing: border-box; margin-top: 3px; padding: 4px 6px; background: rgba(255,255,255,0.06); border: 1px solid var(--line); border-radius: 6px; color: var(--fg); font: inherit; }
#linesPanel .lsw { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin: 9px 0; }
#linesPanel .lsw .sw { width: 20px; height: 20px; border-radius: 5px; border: 2px solid transparent; cursor: pointer; padding: 0; }
#linesPanel .lsw .sw.on { border-color: #fff; }
#linesPanel .lsw input[type=color] { width: 28px; height: 22px; padding: 0; border: 0; background: none; cursor: pointer; }
#linesPanel .lmode { display: flex; gap: 6px; }
#linesPanel .lsect { margin: 10px 0 4px; color: var(--muted); text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; display: flex; justify-content: space-between; }
#linesPanel .lstoplist { margin: 0; padding-left: 20px; }
#linesPanel .lstoplist li { padding: 2px 0; }
#linesPanel .lxy { color: var(--muted); font-size: 11px; }
#linesPanel .lrm { margin-left: 4px; background: none; border: 0; color: var(--muted); cursor: pointer; font: inherit; }
#linesPanel .lrm:hover { color: var(--danger); }
#linesPanel .lbtns { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
#linesPanel button:disabled { opacity: 0.4; cursor: default; }
.lbadge { display: inline-block; min-width: 18px; padding: 1px 5px; border-radius: 5px; color: #fff; font-weight: 700; font-size: 11px; text-align: center; text-shadow: 0 1px 1px rgba(0,0,0,0.35); }
body.fpv-full #linesPanel { display: none !important; }
`;
