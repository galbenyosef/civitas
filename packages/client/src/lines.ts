import { Group, Mesh, MeshBasicMaterial, RingGeometry, PlaneGeometry, BufferGeometry, Float32BufferAttribute, DoubleSide, Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace } from 'three';
import { isFreightYardKind, stopName, stopModeOf, hasFeature, techFor, sailPoints, TRANSIT, METRO, FERRY, TICKS_PER_DAY, TICKS_PER_HOUR, type MetroLineDTO, type FerryLineDTO, type RailRoute, type LineInfo, type StopInfo, type BusInfo, type StopRef, type ServerMsg, type TransitMode, type LinePreview } from '@msimcity/shared';
import { Ribbon } from './render/route';
import { METRO_Y } from './render/underground';
import type { NetClient } from './net';
import type { ClientWorld } from './world';

/**
 * Transit lines (docs/transit.md): the top-bar **lines** chip opens a panel of your lines. A line is stops clicked in
 * order on the map (while a line is being edited, a click on a bus stop adds it; Backspace or a right-click takes the
 * last one off), a number, a colour, loop or there and back, and the buses you want on it. As stops are clicked the
 * server routes the draft (a 'linePreview': sim/transit.ts plan, sim/busroute.ts) and the editor draws the road the
 * bus will take, the stops numbered in order, where it turns round, the lap's length and round trip, and anything
 * that stops it running: the leg that fails in red, the land a road would join it over, a better tile for a stop.
 * Saved lines are drawn as ribbons in their colours while the panel is open. The 'lines' message also carries which
 * line each bus on the road runs, for its livery (render/citizens.ts).
 */

const PALETTE = [0xd94f4f, 0x2f8fd6, 0x3fa34d, 0xe6a23c, 0x8e5bd6, 0x1fb5a8, 0xd65bab, 0x5c6270];
const FAIL = 0xff3b30, WARN = 0xffb020, SUGGEST = 0x34c759;
const TURN_KIND = ['dead end', 'junction', 'depot'];
/** game minutes for a number of ticks */
const minutes = (t: number) => Math.max(1, Math.round((t * 60) / TICKS_PER_HOUR));
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
interface Draft { id?: number; number: number; colour: number; loop: boolean; vehicles: number; stops: StopRef[]; mode?: TransitMode; name?: string }
const VEHICLE: Record<TransitMode, [string, string]> = { bus: ['bus', 'buses'], rail: ['train', 'trains'], metro: ['train', 'trains'], ferry: ['boat', 'boats'] };
/** stations a line of each mode may call at, and vehicles it may ask for */
const STOPS_MAX = (m: TransitMode) => (m === 'metro' ? METRO.stationsMax : m === 'ferry' ? FERRY.stationsMax : TRANSIT.maxStops);
const VEHICLES_MAX = (m?: TransitMode) => (m === 'metro' ? METRO.trainsMax : m === 'ferry' ? FERRY.trainsMax : TRANSIT.maxVehicles);
const DIG = 0xffc233, CROSS = 0xff7a1f;

export class LinesPanel {
  readonly group = new Group();
  private lines: LineInfo[] = [];
  private open = false;
  private draft: Draft | null = null;
  private ribbons: Ribbon[] = [];
  private marks: Mesh[] = [];
  private editRibbon = new Ribbon(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide, toneMapped: false }), RIBBON_Y + 0.004);
  /** the failing leg of the draft, straight from stop to stop */
  private failRibbon = new Ribbon(new MeshBasicMaterial({ color: FAIL, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide, toneMapped: false }), RIBBON_Y + 0.006);
  /** numbered stop badges over the draft's stops */
  private badges: Sprite[] = [];
  /** the draft's change counter, and the server's route for the draft (it may be one change behind while it answers) */
  private seq = 0;
  private preview: LinePreview | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private el: HTMLDivElement;
  private chip: HTMLButtonElement;
  private dirty = true;
  /** called with the bus -> line pairs and line colours whenever a 'lines' message arrives */
  onLivery: (pairs: number[], colours: Map<number, number>) => void = () => {};
  /** called when editing starts, so the map is in select mode and a click on a stop reaches mapClick */
  onEdit: () => void = () => {};
  /** a metro line is being edited (true) or no longer is: main.ts turns the underground view on for the tunnels, and back off */
  onUnder: (on: boolean) => void = () => {};
  private underOn = false;
  /** station names by door tile, from 'metroLines' (a draft's stops are doors) */
  private metroNames = new Map<string, string>();
  /** pier names by door tile and each ferry line's route, from 'ferryLines' (saved ferry lines draw the line their boats sail) */
  private ferryNames = new Map<string, string>();
  private ferryRoutes = new Map<number, RailRoute>();
  /** the draft's overlay (rings, ribbons, badges) sits at tunnel depth while a metro line is edited */
  private yShift = 0;

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
    this.failRibbon.mesh.renderOrder = 7;
    this.group.add(this.failRibbon.mesh);
    this.net.on('linePreview', (m) => this.applyPreview(m.preview));
    // Backspace takes the last stop off the draft (unless typing in a field)
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace' || !this.open || !this.draft) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (this.undoStop()) e.preventDefault();
    });
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
    this.syncUnder();
  }

  /** A 'lines' message: every line, and which line each bus on the road runs. */
  apply(m: Extract<ServerMsg, { t: 'lines' }>) {
    this.lines = m.lines;
    const colours = new Map(m.lines.map((l) => [l.id, l.colour]));
    this.onLivery(m.buses, colours);
    if (m.saved && this.draft && (this.draft.id === undefined || this.draft.id === m.saved)) { this.draft = null; this.preview = null; } // saved: back to the list
    this.dirty = true;
    if (this.open && !this.draft) this.render();
  }
  /** The metro lines ('metroLines'): the stations' names, which the stop lists use. */
  setMetroNames(lines: MetroLineDTO[]) {
    this.metroNames.clear();
    for (const l of lines) l.stations.forEach(([x, y], i) => { if (l.names[i]) this.metroNames.set(`${x},${y}`, l.names[i]); });
    if (this.open) this.render();
  }
  /** The ferry lines ('ferryLines'): the piers' names, and the routes their ribbons follow. */
  setFerryLines(lines: FerryLineDTO[]) {
    this.ferryNames.clear(); this.ferryRoutes.clear();
    for (const l of lines) {
      l.stations.forEach(([x, y], i) => { if (l.names[i]) this.ferryNames.set(`${x},${y}`, l.names[i]); });
      if (l.route) this.ferryRoutes.set(l.id, l.route);
    }
    this.dirty = true;
    if (this.open) this.render();
  }
  private nameOf(x: number, y: number) { return this.metroNames.get(`${x},${y}`) ?? this.ferryNames.get(`${x},${y}`) ?? stopName(x, y); }
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
    if (!mode) { this.toast('error', 'Click bus stops, rail stations, underground stations or ferry piers to add them to the line'); return true; }
    if (this.draft.mode && this.draft.stops.length && mode !== this.draft.mode) { this.toast('error', this.draft.mode === 'rail' ? 'This is a rail line: click rail stations' : this.draft.mode === 'metro' ? 'This is an underground line: click underground stations' : this.draft.mode === 'ferry' ? 'This is a river bus line: click ferry piers' : 'This is a bus line: click bus stops'); return true; }
    const me = this.world.myPlayer;
    if (mode === 'ferry' && me && !hasFeature(me.tech, 'ferry') && !me.devUnlimited) { this.toast('error', `${techFor('ferry')?.name ?? 'River buses'} is needed before you can run ferry lines (T for the tech tree)`); return true; }
    if (mode === 'rail' || mode === 'metro' || mode === 'ferry') [x, y] = this.world.doorOf(x, y); // a station or pier is several tiles: the line knows it by its door
    const p = this.world.parcelAt(x, y);
    if (!p || !this.world.mayEdit(p.owner)) { this.toast('error', 'Lines can only use stops on your own land'); return true; }
    const st = this.draft.stops;
    if (st.length && st[st.length - 1].x === x && st[st.length - 1].y === y) return true;
    const most = STOPS_MAX(mode);
    if (st.length >= most) { this.toast('error', `A line has at most ${most} ${mode === 'metro' ? 'stations' : mode === 'ferry' ? 'piers' : 'stops'}`); return true; }
    st.push({ x, y });
    this.draft.mode = mode;
    this.changed();
    return true;
  }
  /** Take the last stop off the line being edited (Backspace, or a right-click on the map); false when there is none. */
  undoStop(): boolean {
    const d = this.draft;
    if (!this.open || !d || !d.stops.length) return false;
    d.stops.pop();
    if (!d.stops.length && !d.id) d.mode = undefined;
    this.changed();
    return true;
  }
  /** The draft's stops or shape changed: redraw, and ask the server to route it (shortly, so quick clicks ask once). */
  private changed() {
    this.seq++;
    this.render(); this.dirty = true;
    clearTimeout(this.previewTimer);
    const d = this.draft;
    if (!d || d.stops.length < 2) { this.preview = null; return; }
    const seq = this.seq;
    this.previewTimer = setTimeout(() => {
      if (this.draft === d && this.seq === seq) this.net.send({ t: 'line', op: 'preview', seq, line: { id: d.id, loop: d.loop, stops: d.stops } });
    }, 120);
  }
  /** The server's route for the draft: drawn on the map, summed up in the panel. */
  private applyPreview(p: LinePreview) {
    if (!this.draft || p.seq !== this.seq) return;
    this.preview = p;
    this.render(); this.dirty = true;
  }

  /** the lines this player may edit: their own, or every line in a sandbox */
  private mine() { return this.lines.filter((l) => this.world.mayEdit(l.owner)); }
  /** the lines the panel lists: the ones this player may edit, or every line, to look at, in a read-only showcase */
  private listed() { return this.world.spectate ? this.lines : this.mine(); }

  private startDraft(l?: LineInfo) {
    if (l) this.draft = { id: l.id, number: l.number, colour: l.colour, loop: l.loop, vehicles: l.vehicles, stops: l.stops.map((s) => ({ ...s })), mode: l.mode, name: l.name };
    else {
      const used = new Set(this.mine().map((x) => x.number));
      let n = 1; while (used.has(n)) n++;
      this.draft = { number: n, colour: PALETTE[(n - 1) % PALETTE.length], loop: true, vehicles: 2, stops: [] };
    }
    this.onEdit();
    this.preview = null;
    this.changed();
  }

  private click(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    const act = t.dataset.act!, id = Number(t.dataset.id);
    const d = this.draft;
    if (act === 'close') this.toggle(false);
    else if (this.world.spectate) return; // a read-only showcase: the panel only lists the lines
    else if (act === 'new') {
      const me = this.world.myPlayer;
      if (me && !hasFeature(me.tech, 'lines') && !me.devUnlimited) { this.toast('error', `${techFor('lines')?.name ?? 'Public transport'} is needed before you can run bus lines (T for the tech tree)`); return; }
      this.startDraft();
    } else if (act === 'edit') { const l = this.lines.find((x) => x.id === id); if (l) this.startDraft(l); }
    else if (act === 'delete') { if (confirm(`Delete line ${this.lines.find((x) => x.id === id)?.number}?`)) this.net.send({ t: 'line', op: 'delete', id }); }
    else if (act === 'cancel') { this.draft = null; this.preview = null; this.render(); this.dirty = true; }
    else if (act === 'save' && d) this.net.send({ t: 'line', op: 'save', line: { id: d.id, number: d.number, colour: d.colour, loop: d.loop, vehicles: d.vehicles, stops: d.stops, ...(d.mode === 'metro' || d.mode === 'ferry' ? { name: (d.name ?? '').trim() } : {}) } });
    else if (act === 'rm' && d) { d.stops.splice(id, 1); if (!d.stops.length && !d.id) d.mode = undefined; this.changed(); }
    else if (act === 'undo' && d) this.undoStop();
    else if (act === 'swatch' && d) { d.colour = Number(t.dataset.c); this.render(); this.dirty = true; }
    else if (act === 'mode' && d) { d.loop = t.dataset.v === 'loop'; this.changed(); }
  }
  private input(e: Event) {
    const t = e.target as HTMLInputElement, d = this.draft;
    if (!d) return;
    if (t.name === 'number') d.number = Math.max(1, Math.min(999, Math.floor(Number(t.value) || 1)));
    else if (t.name === 'vehicles') d.vehicles = Math.max(0, Math.min(VEHICLES_MAX(d.mode), Math.floor(Number(t.value) || 0)));
    else if (t.name === 'lname') d.name = t.value.slice(0, 24);
    else if (t.name === 'colour') { d.colour = parseInt(t.value.slice(1), 16); this.dirty = true; if (e.type === 'change') this.render(); }
  }

  private render() {
    if (!this.open) return;
    const d = this.draft;
    let html = `<div class="lhead"><h3>${d ? (d.id ? `Edit line ${d.number}` : 'New line') : 'Lines'}</h3><button class="chip" data-act="close" title="close">✕</button></div>`;
    if (!d) {
      const mine = this.listed(), ro = this.world.spectate;
      if (!mine.length && ro) html += `<div class="lempty">No lines run here.</div>`;
      else if (!mine.length) html += `<div class="lempty">No lines yet. Place bus stops beside plain stretches of road (Bus stop tool), a bus depot nearby (its staff drive the buses), then make a line here.</div>`;
      for (const l of mine) {
        const ok = l.status === 'running';
        html += `<div class="lrow"><div class="ltop">${lineBadge(l.number, l.colour)}<span class="lname">${l.mode === 'metro' ? `underground · ${l.name ? `${esc(l.name)} · ` : ''}` : l.mode === 'ferry' ? `river bus · ${l.name ? `${esc(l.name)} · ` : ''}` : l.mode === 'rail' ? (isFreightYardKind(this.world.kindIdAt(l.stops[0].x, l.stops[0].y)) ? 'freight · ' : 'rail · ') : ''}${l.loop ? 'loop' : 'there and back'} · ${l.stops.length} ${l.mode === 'bus' ? 'stops' : l.mode === 'ferry' ? 'piers' : 'stations'}</span>
          ${ro ? '' : `<button class="chip" data-act="edit" data-id="${l.id}">edit</button><button class="chip" data-act="delete" data-id="${l.id}" title="delete">✕</button>`}</div>
          <div class="lstat"><span class="${ok ? '' : 'bad'}">${esc(l.status)}</span> · ${VEHICLE[l.mode]?.[1] ?? 'vehicles'} ${l.inService}/${l.vehicles}</div>
          <div class="lstat">riders ${l.ridersToday} today, ${l.ridersYesterday} yesterday · fares $${Math.round(l.faresToday)}</div>
          <div class="lstops">${l.stops.map((s, i) => `<span title="${l.stopBoardings[i] ?? 0} boarded today">${esc(this.nameOf(s.x, s.y))}</span>`).join(' → ')}${l.loop ? ' ↺' : ' ⇄'}</div></div>`;
      }
      if (!ro) html += `<button class="chip lnew" data-act="new">+ new line</button>`;
      if (!ro) html += `<div class="lhint">Fares $${TRANSIT.fare} a ride (children free, retirees half) go to you. Buses run ${hm(TRANSIT.serviceStart * TICKS_PER_HOUR)}–${hm(TRANSIT.serviceEnd * TICKS_PER_HOUR)}, one per driver on shift at your depot. Trains run 05:00–01:00 on your track between your rail stations (click stations instead of stops); click freight yards for a freight line, which carries industry's containers instead of passengers. Underground lines run on tunnels the server bores between your underground stations (click those instead): the view drops below ground while you edit. River buses sail between your ferry piers (click those for a ferry line).</div>`;
    } else {
      html += `<div class="lform">
        <label>Number <input name="number" type="number" min="1" max="999" value="${d.number}"></label>
        <label>${d.mode === 'bus' || !d.mode ? 'Buses' : d.mode === 'ferry' ? 'Boats' : 'Trains'} <input name="vehicles" type="number" min="0" max="${VEHICLES_MAX(d.mode)}" value="${d.vehicles}"></label>
      </div>
      ${d.mode === 'metro' || d.mode === 'ferry' ? `<label class="lname-in">Name <input name="lname" type="text" maxlength="24" placeholder="${d.mode === 'ferry' ? 'RB1' : 'Central'}" value="${esc(d.name ?? '')}"></label>` : ''}
      <div class="lsw">${PALETTE.map((c) => `<button class="sw${c === d.colour ? ' on' : ''}" data-act="swatch" data-c="${c}" style="background:${hex(c)}" title="${hex(c)}"></button>`).join('')}<input name="colour" type="color" value="${hex(d.colour)}" title="any colour"></div>
      <div class="lmode"><button class="chip${d.loop ? ' on' : ''}" data-act="mode" data-v="loop">loop ↺</button><button class="chip${d.loop ? '' : ' on'}" data-act="mode" data-v="back">there and back ⇄</button></div>
      <div class="lsect">Stops in order <span>${d.stops.length}</span></div>
      ${d.stops.length ? `<ol class="lstoplist">${d.stops.map((s, i) => `<li>${esc(this.nameOf(s.x, s.y))} <span class="lxy">(${s.x}, ${s.y})</span><button class="lrm" data-act="rm" data-id="${i}" title="remove">✕</button></li>`).join('')}</ol>` : ''}
      ${this.routeHtml(d)}
      <div class="lhint">${d.mode === 'ferry' ? `Click your ferry piers in the order the river buses should call: they sail the water between them, under every bridge, on water at least three tiles wide. One line calls at a pier. ${d.loop ? 'The last pier runs back round to the first.' : 'Boats call everywhere on the way back, and pass each other on the river.'}` : d.mode === 'metro' ? `Click your underground stations in the order trains should call. The tunnel is bored when you save: new tunnel in amber, crossovers ringed, the cost on the button. Lines share no tunnel except at crossovers, and every station needs its own platform. ${d.loop ? 'The last station runs back round to the first, one way.' : 'Trains run out in one bore and home in the other.'}` : d.mode === 'rail' ? `Click your rail stations in the order trains should call; consecutive stations must be joined by track, and no other line may use it. ${d.loop ? 'The track must lead from the last station back round to the first; the loop takes as many trains as fit.' : 'Trains reverse at the ends and call everywhere on the way back; one track runs one train.'}` : `Click your bus stops (or rail stations, for a rail line) on the map in the order the bus should call: the road between them fills in, the shortest way a bus can drive. ${d.loop ? 'The last stop runs back to the first.' : 'Buses call at every stop on the way back.'} Where a bus has to turn round it goes round a block or a roundabout, or turns at a dead end or a junction. Backspace or right-click takes the last stop off.`}</div>
      <div class="lbtns"><button class="chip" data-act="undo" ${d.stops.length ? '' : 'disabled'}>undo stop</button><button class="chip" data-act="cancel">cancel</button><button class="chip on" data-act="save" ${d.stops.length >= 2 && !this.current()?.problem?.fatal ? '' : 'disabled'}>save line${d.mode === 'metro' && this.current()?.cost ? ` · $${this.current()!.cost!.toLocaleString('en-GB')}` : ''}</button></div>`;
    }
    this.el.innerHTML = html;
    this.syncUnder();
  }
  /** the underground view follows a metro line being edited (the tunnels are the thing being drawn) */
  private syncUnder() {
    const want = this.open && this.draft?.mode === 'metro';
    if (want !== this.underOn) { this.underOn = want; this.onUnder(want); }
  }

  /** The server's route for the draft as it is now, or null while it is still working it out. */
  private current(): LinePreview | null { return this.preview && this.preview.seq === this.seq ? this.preview : null; }
  /** The draft's route in the panel: lap length, round trip, where it turns round, or what is wrong and how to fix it. */
  private routeHtml(d: Draft): string {
    if (d.stops.length < 2) return '';
    const p = this.current();
    if (!p) return `<div class="lroute">routing…</div>`;
    let html = '';
    if (p.ok && d.mode === 'metro') {
      const bored = (p.bore?.length ?? 0) / 2, cross = (p.crossovers?.length ?? 0) / 2;
      html += `<div class="lroute">${p.length} tiles a lap${p.lapTicks ? ` · round trip ~${minutes(p.lapTicks)} min` : ''}</div>`;
      html += `<div class="lroute" style="color:#${DIG.toString(16)}">${bored ? `${bored} tile${bored === 1 ? '' : 's'} of new tunnel${cross ? ` with ${cross} crossover${cross === 1 ? '' : 's'}` : ''} · $${(p.cost ?? 0).toLocaleString('en-GB')}` : 'all the tunnel is there already · $0'}</div>`;
    } else if (p.ok) {
      const kinds: string[] = [];
      for (let i = 0; i < p.turns.length; i += 3) kinds.push(`${TURN_KIND[p.turns[i + 2]]} (${p.turns[i]}, ${p.turns[i + 1]})`);
      const turns = kinds.length ? ` · turns round ${kinds.length === 1 ? 'once' : `${kinds.length} times`}` : '';
      html += `<div class="lroute" title="${esc(kinds.length ? `turns round at: ${kinds.join(', ')}` : 'drives round without turning')}">${p.length} tiles a lap${p.lapTicks ? ` · round trip ~${minutes(p.lapTicks)} min` : ''}${turns}</div>`;
    }
    if (p.problem) html += `<div class="lprob ${p.problem.fatal ? 'bad' : 'warn'}">${esc(p.problem.message)}${p.problem.fix ? `<div class="lfix">${esc(p.problem.fix)}</div>` : ''}</div>`;
    return html;
  }

  /** Rebuild the ribbons when something changed; keep the edit preview joined to the stops. */
  frame() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const r of this.ribbons) { this.group.remove(r.mesh); r.mesh.geometry.dispose(); (r.mesh.material as MeshBasicMaterial).dispose(); }
    for (const m of this.marks) { this.group.remove(m); m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose(); }
    for (const b of this.badges) { this.group.remove(b); b.material.map?.dispose(); b.material.dispose(); }
    this.ribbons = []; this.marks = []; this.badges = [];
    this.editRibbon.hide(); this.failRibbon.hide();
    this.yShift = 0;
    if (!this.open) return;
    const mine = this.listed();
    mine.forEach((l, i) => {
      if (this.draft?.id === l.id) return;
      if (l.mode === 'metro') return; // its tunnel is drawn, in the line's colour, by the underground view
      const fr = l.mode === 'ferry' ? this.ferryRoutes.get(l.id) : undefined;
      const pts = fr ? sailPoints(fr) : lanePoints(l.path, true, l.mode === 'rail' || l.mode === 'ferry' ? 0 : 0.19); // trains run on the track's centre line, boats on their sailing line
      if (pts.length < 4) return;
      const r = new Ribbon(new MeshBasicMaterial({ color: l.colour, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide, toneMapped: false }), RIBBON_Y + 0.002 * i);
      r.mesh.renderOrder = 5;
      r.set(pts, new Array(pts.length / 2).fill(RIBBON_W));
      this.ribbons.push(r); this.group.add(r.mesh);
      for (const s of l.stops) this.mark(s, l.colour);
    });
    const d = this.draft;
    // a metro draft is drawn at tunnel depth, over the tunnels (depth test off), so it reads in the underground view
    const metro = d?.mode === 'metro';
    this.yShift = metro ? METRO_Y - RIBBON_Y + 0.1 : 0;
    for (const r of [this.editRibbon, this.failRibbon]) { r.mesh.position.y = this.yShift; (r.mesh.material as MeshBasicMaterial).depthTest = !metro; }
    if (d) {
      (this.editRibbon.mesh.material as MeshBasicMaterial).color.setHex(d.colour);
      // the road the bus will take, once the server has routed it (the last answer while it works on the next)
      const p = this.preview, rail = d.mode === 'rail' || d.mode === 'ferry' || metro;
      if (p && p.path.length >= 4 && d.stops.length >= 2) {
        const pts = p.sail && p.sail.length >= 4 ? p.sail : lanePoints(p.path, p.ok, rail ? 0 : 0.19); // a ferry's draft: the line its boats would sail
        if (pts.length >= 4) this.editRibbon.set(pts, new Array(pts.length / 2).fill(RIBBON_W));
      } else {
        const pts: number[] = [];
        for (const s of d.stops) pts.push(s.x + 0.5, s.y + 0.5);
        if (d.loop && d.stops.length > 2) pts.push(d.stops[0].x + 0.5, d.stops[0].y + 0.5);
        if (pts.length >= 4) this.editRibbon.set(pts, new Array(pts.length / 2).fill(EDIT_W));
      }
      const cur = this.current();
      if (cur) {
        for (let i = 0; i < cur.turns.length; i += 3) this.mark({ x: cur.turns[i], y: cur.turns[i + 1] }, 0xffffff, 0.1, 0.17);
        if (metro && cur.bore?.length) this.digMarks(cur.bore);
        if (metro && cur.crossovers) for (let i = 0; i < cur.crossovers.length; i += 2) this.mark({ x: cur.crossovers[i], y: cur.crossovers[i + 1] }, CROSS, 0.3, 0.42);
        const pr = cur.problem;
        if (pr) {
          const c = pr.fatal ? FAIL : WARN;
          (this.failRibbon.mesh.material as MeshBasicMaterial).color.setHex(c);
          if (pr.leg) this.failRibbon.set([pr.leg[0] + 0.5, pr.leg[1] + 0.5, pr.leg[2] + 0.5, pr.leg[3] + 0.5], [EDIT_W * 1.6, EDIT_W * 1.6]);
          for (let i = 0; i < pr.tiles.length; i += 2) this.square(pr.tiles[i], pr.tiles[i + 1], c);
          if (pr.suggest) this.mark({ x: pr.suggest[0], y: pr.suggest[1] }, SUGGEST);
        }
      }
      d.stops.forEach((s, i) => { this.mark(s, d.colour); this.badge(s, i + 1, d.colour); });
    }
  }
  /** A tile marked in a colour (land to lay a road over, a stop to move). */
  private square(x: number, y: number, colour: number) {
    const m = new Mesh(new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }));
    m.position.set(x + 0.5, RIBBON_Y + 0.008 + this.yShift, y + 0.5);
    (m.material as MeshBasicMaterial).depthTest = !this.yShift;
    m.renderOrder = 6;
    this.marks.push(m); this.group.add(m);
  }
  /** A numbered badge over a stop: the order the bus calls in. */
  private badge(s: StopRef, n: number, colour: number) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = hex(colour); g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fill();
    g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = `bold ${n > 9 ? 26 : 32}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 32, 34);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    const sp = new Sprite(new SpriteMaterial({ map: t, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, sizeAttenuation: false }));
    sp.scale.set(0.045, 0.045, 1);
    sp.position.set(s.x + 0.5, 0.9 + this.yShift, s.y + 0.5);
    sp.renderOrder = 9;
    this.badges.push(sp); this.group.add(sp);
  }
  private mark(s: StopRef, colour: number, r0 = 0.22, r1 = 0.32) {
    const m = new Mesh(new RingGeometry(r0, r1, 24).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    m.position.set(s.x + 0.5, RIBBON_Y + 0.01 + this.yShift, s.y + 0.5);
    (m.material as MeshBasicMaterial).depthTest = !this.yShift;
    m.renderOrder = 7;
    this.marks.push(m); this.group.add(m);
  }
  /** The tunnel a save would bore: a small amber square on every new tile, in one mesh. */
  private digMarks(bore: number[]) {
    const pos: number[] = [], idx: number[] = [], h = 0.17;
    for (let i = 0; i < bore.length; i += 2) {
      const x = bore[i] + 0.5, z = bore[i + 1] + 0.5, v = pos.length / 3;
      pos.push(x - h, 0, z - h, x + h, 0, z - h, x + h, 0, z + h, x - h, 0, z + h);
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new Mesh(g, new MeshBasicMaterial({ color: DIG, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, toneMapped: false }));
    m.position.y = RIBBON_Y + 0.006 + this.yShift;
    m.frustumCulled = false; m.renderOrder = 6;
    this.marks.push(m); this.group.add(m);
  }
}

/**
 * A line's lap as ribbon points in the lane the buses drive in: right-hand traffic, so each tile centre is pushed to the
 * right of the direction of travel by the lane offset; `closed` joins the end back to the start. Where the bus turns
 * round (it goes back to the tile it came from: server sim/busroute.ts) the ribbon draws a U across the road.
 */
function lanePoints(path: number[], closed: boolean, O = 0.19): number[] {
  const n = path.length / 2, out: number[] = [];
  if (n < 2) return out;
  const at = (i: number) => [path[((i + n) % n) * 2] + 0.5, path[((i + n) % n) * 2 + 1] + 0.5];
  for (let i = 0; i <= (closed ? n : n - 1); i++) {
    const [x, y] = at(i), [px, py] = at(i - 1), [nx, ny] = at(i + 1);
    if ((closed || (i > 0 && i < n - 1)) && O > 0 && px === nx && py === ny && (px !== x || py !== y)) {
      const dx = x - px, dy = y - py; // the way in; right of it is (-dy, dx)
      for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * Math.PI;
        out.push(x - dy * O * Math.cos(a) + dx * (0.12 + O * Math.sin(a)), y + dx * O * Math.cos(a) + dy * (0.12 + O * Math.sin(a)));
      }
      continue;
    }
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
#linesPanel .lname-in { display: block; margin-top: 8px; color: var(--muted); }
#linesPanel .lform input, #linesPanel .lname-in input { width: 100%; box-sizing: border-box; margin-top: 3px; padding: 4px 6px; background: rgba(255,255,255,0.06); border: 1px solid var(--line); border-radius: 6px; color: var(--fg); font: inherit; }
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
#linesPanel .lroute { margin: 8px 0 2px; color: var(--fg); }
#linesPanel .lprob { margin: 8px 0 2px; padding: 6px 8px; border-radius: 6px; line-height: 1.4; }
#linesPanel .lprob.bad { background: rgba(255, 59, 48, 0.14); border: 1px solid rgba(255, 59, 48, 0.45); }
#linesPanel .lprob.warn { background: rgba(255, 176, 32, 0.12); border: 1px solid rgba(255, 176, 32, 0.45); }
#linesPanel .lfix { margin-top: 3px; color: var(--muted); }
#linesPanel button:disabled { opacity: 0.4; cursor: default; }
.lbadge { display: inline-block; min-width: 18px; padding: 1px 5px; border-radius: 5px; color: #fff; font-weight: 700; font-size: 11px; text-align: center; text-shadow: 0 1px 1px rgba(0,0,0,0.35); }
body.fpv-full #linesPanel { display: none !important; }
`;
