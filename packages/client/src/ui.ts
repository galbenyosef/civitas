import { ROAD_COST, ZONE_COST, LAND_PRICE_PER_TILE, MAX_TAX, CIVIC_COST, Zone, KIND_NAMES, PRIORITY_NAMES, DAYS_PER_WEEK, isCivicId, familyOf, hasFeature, techFor, TECH, TECH_BY_ID, TRACK_NAMES, describeCondition, type ParcelDTO, type PlayerDTO, type BuildingInfo, type PersonRow, type PersonRef, type RoadInfo, type CitizenInfo, type SiteDTO, type FocusInfo, VALUE_NAMES } from '@msimcity/shared';
import { TOOL_KINDS, DEV_TOOLS, type ToolId } from './input';
import { ROUNDABOUT_COST, FLYOVER_COST, RUNWAY_COST, RAIL_COST, TICKS_PER_DAY, TICKS_PER_HOUR, type AirportLink, type AirportInfo, type GatewayInfo, type HarbourInfo } from '@msimcity/shared';
import { railStationHtml, metroStationHtml } from './rail';
import { stopHtml, busHtml } from './lines';
import { MANIFEST, LEDGER_LABELS, ECONOMY_TUNING, spendableMoney, type KindToolId, type LedgerDTO, type LedgerCat, type FinanceDTO } from '@msimcity/shared';
import { FLEET_LABEL } from '@msimcity/shared';
import { WEEKDAY_NAMES } from '@msimcity/shared';
import { schoolHtml, educationHtml, eduTotals, eduIndexLabel } from './eduView';
import { mediaHtml } from './news';
import { POLICIES } from '@msimcity/shared';
import { SizePicker, ladderOfTool, ladderById, rememberedTool, TOOL_LADDERS } from './picker';
/** Panel icons of the vehicles of mobile workers (shared FLEET_LABEL, docs/mobile-jobs.md). */
const FLEET_ICON: Record<string, string> = { taxi: '🚕', 'private hire car': '🚘', 'delivery bicycle': '🚲', 'delivery moped': '🛵', 'courier van': '🚐', 'bin lorry': '🚛', 'street sweeper': '🧹', 'trades van': '🚐', 'school bus': '🚌' };

/** Tool bar groups: land and roads first, then the catalogue kinds by what they are, bulldoze last. */
const toolGroup = (k: (typeof TOOL_KINDS)[number]) => (k.landmark ? 'Landmarks' : k.family === 'leisure' ? 'Leisure' : k.flags.growable || k.family === 'residential' ? 'Zones' : k.family === 'transport' ? 'Transport' : 'Services');
const GROUP_ORDER = ['Zones', 'Services', 'Transport', 'Leisure', 'Landmarks'];
export const TOOLS: { id: ToolId; label: string; key: string; cost?: string; color?: string; group?: string }[] = [
  { id: 'select', label: 'Select / inspect', key: '1' },
  { id: 'buy', label: 'Buy land', key: '2', cost: `$${LAND_PRICE_PER_TILE}/tile`, color: '#62d2a2' },
  { id: 'road', label: 'Road', key: '3', cost: `$${ROAD_COST}`, color: '#6b6f7a' },
  // one tool per catalogue kind (shared/src/buildings), in kind-code order, with its cost from the compiled manifest
  ...TOOL_KINDS.map((k) => ({ id: k.tool!.id as KindToolId, label: k.tool!.label, key: k.tool!.key, cost: `$${k.tool!.cost}`, color: k.tool!.color, group: toolGroup(k) }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)),
  { id: 'bulldoze', label: 'Bulldoze', key: 'X', color: '#ff6b6b' },
];
// the runway is painted, not a catalogue kind: it sits right after the airport terminal (shared/src/airport.ts)
{
  const i = TOOLS.findIndex((t) => t.id === 'airport');
  if (i >= 0) TOOLS.splice(i + 1, 0, { id: 'runway', label: 'Runway (drag behind a terminal)', key: 'U', cost: `$${RUNWAY_COST * 6}/tile`, color: '#2b2e33', group: TOOLS[i].group });
}
// roundabouts and flyovers rebuild a junction (shared/src/junctions.ts): right after the road tool
{
  const i = TOOLS.findIndex((t) => t.id === 'road');
  TOOLS.splice(i + 1, 0, { id: 'roundabout', label: 'Roundabout (click a junction)', key: '', cost: `$${ROUNDABOUT_COST}`, color: '#7fa24d' },
    { id: 'flyover', label: 'Flyover (click a crossroads)', key: '', cost: `$${FLYOVER_COST}`, color: '#a9a59c' });
}
// the pioneer camp (docs/first-five.md, shared buildings/camp.ts) sits right after Residential; every letter is taken, so no key
{
  const i = TOOLS.findIndex((t) => t.id === 'camp'), r = TOOLS.findIndex((t) => t.id === 'res');
  if (i > r && r >= 0) TOOLS.splice(r + 1, 0, ...TOOLS.splice(i, 1));
}
// railway track is painted too (shared/src/rail.ts): it sits right after the rail stations; every letter is taken, so no key
{
  const i = TOOLS.findIndex((t) => t.id === 'railstation');
  if (i >= 0) TOOLS.splice(i + 1, 0, { id: 'rail', label: 'Railway track (drag)', key: '', cost: `$${RAIL_COST}/tile`, color: '#7d776c', group: TOOLS[i].group });
}
/** tool id -> kind code, for the swatch colour of a building's tooltip (every catalogue kind with a tool) */
/** tool id -> kind id (BuildingInfo.kind and SiteDTO.kind are kind ids, docs/sub-kinds.md) */
const TOOL_KIND: Record<string, number> = Object.fromEntries(MANIFEST.filter((k) => k.tool).map((k) => [k.tool!.id, k.kindId]));
/** The airport section of a terminal's tooltip (shared/src/airport.ts, server sim/airports.ts). */
/** A gateway's arrivals and departures (server sim/gateways.ts). */
function gatewayHtml(g: GatewayInfo, row: (k: string, v: string | number) => string): string {
  const net = (i: number, o: number) => { const n = i - o; return `<b class="${n < 0 ? 'bad' : ''}">${n > 0 ? '+' : ''}${n}</b>`; };
  const how: Record<string, string> = { car: 'by car', foot: 'on foot', taxi: 'by taxi' };
  let html = `<div class="sect">Gateway</div>`;
  html += row('Status', g.open ? `taking arrivals · up to ${g.perHour} an hour${g.type === 'air' ? ' plus some of every plane' : g.type === 'sea' ? ' plus some off every ferry' : ''}` : `<span class="bad">${g.type === 'motorway' ? 'not built yet' : g.type === 'sea' ? 'closed: no staff yet, or no sea route' : 'closed: no staff yet'}</span>`);
  html += row('Newcomers come in', g.modes.map((m) => how[m] ?? m).join(' or '));
  html += row('Today', `${g.arrivalsToday} in · ${g.departuresToday} out · net ${net(g.arrivalsToday, g.departuresToday)}`);
  html += row('Yesterday', `${g.arrivalsYesterday} in · ${g.departuresYesterday} out · net ${net(g.arrivalsYesterday, g.departuresYesterday)}`);
  html += row('Waiting at the gate', g.waiting ? `${g.waiting} newcomer${g.waiting === 1 ? '' : 's'}` : 'nobody');
  html += row('On their way', `${g.enRoute}`);
  return html;
}

const LANE_WORDS: Record<string, string> = { sea: 'out to sea', cruise: 'a cruise', grounds: 'to the fishing grounds', river: 'up the river', through: 'through' };
/** A harbour's tooltip (server sim/harbours.ts, docs/boats.md). */
function harbourHtml(h: HarbourInfo, row: (k: string, v: string | number) => string): string {
  let html = `<div class="sect">Harbour</div>`;
  html += row('Status', h.active ? `in service · ${h.boats} boat${h.boats === 1 ? '' : 's'} based, ${h.away} out` : '<span class="bad">no staff: its boats stay moored</span>');
  if (h.sea) html += row('Sea route', `out by ${esc(h.sea)}`);
  else if (h.waterTiles !== undefined) html += row('Water', `a lake of ${h.waterTiles} tiles: local boats only`);
  if (h.lanes.length) html += row('Lanes', h.lanes.map((l) => `${LANE_WORDS[l.purpose] ?? l.purpose} (${l.cls}, ${l.tiles} tiles${l.gate ? `, to ${esc(l.gate)}` : ''})`).join('<br>'));
  for (const r of h.refused) html += row('No way', `<span class="bad">${esc(r)}</span>`);
  if (h.landed !== undefined) html += row('Catch today', `${h.landed} boxes landed · ${h.sold} to market · ${h.stock} on the quay`);
  if (h.calls !== undefined) {
    html += row('Ships today', `${h.calls}`);
    html += row('Containers today', `${h.imports} landed · ${h.exports} taken on`);
    html += row('Waiting', `${h.importQueue} for lorries · ${h.exportStack} to ship`);
    if (h.passengers) html += row('Ferry passengers today', `${h.passengers}`);
  }
  if (h.fees !== undefined) html += row(h.calls !== undefined ? 'Port dues today' : 'Berth fees today', fmt(h.fees));
  return html;
}

function airportHtml(a: AirportInfo, row: (k: string, v: string | number) => string): string {
  const when = (t: number) => `${WEEKDAYS[Math.floor(t / TICKS_PER_DAY) % 7]} ${hm((t % TICKS_PER_DAY) / TICKS_PER_HOUR)}`;
  let html = `<div class="sect">Airport</div>`;
  html += row('Runway', a.runwayLen ? `${a.runwayLen} tiles` : '<span class="bad">none yet</span>');
  html += row('Status', a.status === 'operational' ? 'operational' : `<span class="bad">${esc(a.status)}</span>`);
  if (a.flightsToday === undefined) return html;
  html += row('Flights today', `${a.flightsToday} · ${a.landedToday} landed · ${a.departedToday} departed`);
  if (a.nextArrival) html += row('Next arrival', `${when(a.nextArrival.tick)} · ${a.nextArrival.type}`);
  if (a.nextDeparture) html += row('Next departure', `${when(a.nextDeparture.tick)} · ${a.nextDeparture.type}`);
  html += row('Gates in use', `${a.gatesInUse} / ${a.gates}`);
  html += row('Passengers today', `${a.passengersToday ?? 0}`);
  html += row('Landing fees today', fmt(a.feesToday ?? 0));
  return html;
}
/** 18.5 -> '18:30' */
const hm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => '$' + Math.round(n).toLocaleString();

export interface UICallbacks {
  onTool(t: ToolId): void;
  onTax(parcelId: number, rate: number): void;
  onRename(parcelId: number, name: string): void;
  onPriority(x: number, y: number, priority: number): void;
  onFocus(x: number, y: number): void;
  onUnlock(id: string): void;
  onFollow(id: number, on: boolean): void;
  onDeselectCitizen(): void;
  onSelectCitizen(id: number): void;
  /** the FPV buttons in the citizen panel: the inset or the whole window */
  onFpv(mode: 'inset' | 'full'): void;
  onCloseBuilding(): void;
}

/** Plain-DOM overlay. Keeps three.js code free of UI concerns. */
export class UI {
  private panelFor = 0;
  /** The name a building shows on its front (render/signs.ts) by the tile it is known by, for the tooltip and panel titles. */
  nameOf: (x: number, y: number) => string | null = () => null;
  constructor(private cb: UICallbacks) {
    const tools = $('tools');
    // a small heading per group; the Leisure group folds away (remembered per browser) so the bar stays short
    let folded: string[] = [];
    try { folded = JSON.parse(localStorage.getItem('msimcity.toolsFolded') ?? '[]'); } catch { /* storage blocked: all open */ }
    let group = '';
    for (const t of TOOLS) {
      if (t.group && t.group !== group) {
        group = t.group;
        const g = group;
        const h = document.createElement('div');
        h.className = 'tgroup' + (folded.includes(g) ? ' folded' : '');
        h.dataset.group = g;
        h.textContent = g;
        if (g === 'Leisure') {
          h.classList.add('foldable');
          h.title = 'show or hide these tools';
          h.onclick = () => {
            const on = h.classList.toggle('folded');
            for (const b of tools.querySelectorAll<HTMLElement>(`button[data-group="${g}"]`)) b.classList.toggle('hiddenTool', on);
            folded = on ? [...new Set([...folded, g])] : folded.filter((x) => x !== g);
            try { localStorage.setItem('msimcity.toolsFolded', JSON.stringify(folded)); } catch { /* not remembered */ }
          };
        }
        tools.appendChild(h);
      }
      const b = document.createElement('button');
      if (t.group) { b.dataset.group = t.group; if (t.group === 'Leisure' && folded.includes(t.group)) b.classList.add('hiddenTool'); }
      // a size ladder (shared/src/buildings/groups.ts) shows once, where its first rung would be; its sizes are in the picker
      const ladder = ladderOfTool(t.id);
      if (ladder) {
        if (tools.querySelector(`button[data-ladder="${ladder.group.id}"]`)) continue;
        const g = ladder.group, key = ladder.tiers.find((k) => k.tool!.key)?.tool!.key ?? '';
        b.dataset.ladder = g.id;
        b.innerHTML = `<span class="sw" style="background:${g.color}"></span><span>${esc(g.label)} <em class="tier"></em></span><span class="cost">${ladder.tiers.length} ${g.collection ? 'landmarks' : 'sizes'}</span><span class="key">${key}</span>`;
        b.onclick = () => this.ladderClick(g.id);
        tools.appendChild(b);
        continue;
      }
      b.dataset.tool = t.id;
      b.innerHTML = `<span class="sw" style="background:${t.color ?? 'var(--muted)'}"></span><span>${t.label}</span>${t.cost ? `<span class="cost">${t.cost}</span>` : ''}<span class="key">${t.key}</span>`;
      b.onclick = () => cb.onTool(t.id);
      tools.appendChild(b);
    }
    this.picker = new SizePicker({
      tech: () => this.tech,
      choose: (tool) => cb.onTool(tool as ToolId),
      locked: (msg) => this.toast('error', msg),
    });
    this.setTool('select');
  }

  // ---- size ladders: one tool bar button per group, a picker of sizes (client/src/picker.ts) ----
  private picker: SizePicker;
  private tool: ToolId = 'select';
  private tech: readonly string[] | null = null;
  private ladderButton(group: string) { return $('tools').querySelector<HTMLButtonElement>(`button[data-ladder="${group}"]`); }
  /** The tool bar button of a ladder: open its picker on the size last used (selecting that size), or close it again. */
  private ladderClick(group: string) {
    if (this.picker.open === group) { this.picker.close(); return; }
    const l = ladderById(group);
    if (!l) return;
    const inGroup = ladderOfTool(this.tool)?.group.id === group;
    const tool = inGroup ? this.tool : rememberedTool(l);
    if (!inGroup && !this.picker.isLocked(tool)) this.cb.onTool(tool as ToolId);
    this.picker.show(group, this.ladderButton(group)!, tool);
  }
  /**
   * A shortcut key of a ladder (0 health, 8 police, ...): the size last used, with the picker open. Returns the tool to
   * select, or undefined when the key is not a ladder's.
   */
  ladderKey(tool: string): ToolId | undefined {
    const l = ladderOfTool(tool);
    if (!l) return undefined;
    const pick = ladderOfTool(this.tool)?.group.id === l.group.id ? this.tool : (rememberedTool(l) as ToolId);
    const b = this.ladderButton(l.group.id);
    queueMicrotask(() => { if (b) this.picker.show(l.group.id, b, pick); });
    return pick;
  }

  login(): Promise<string> {
    const form = $<HTMLFormElement>('loginForm');
    const input = $<HTMLInputElement>('nameInput');
    input.value = localStorage.getItem('msimcity.name') ?? '';
    input.focus();
    return new Promise((resolve) => {
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        localStorage.setItem('msimcity.name', name);
        resolve(name);
      };
    });
  }
  hideLogin() { $('login').classList.add('hidden'); }

  setTool(t: ToolId) {
    this.tool = t;
    const lad = ladderOfTool(t);
    for (const b of $('tools').querySelectorAll<HTMLButtonElement>('button')) {
      const g = b.dataset.ladder;
      if (!g) { b.classList.toggle('active', b.dataset.tool === t); continue; }
      const on = lad?.group.id === g;
      b.classList.toggle('active', on);
      // the size in use (or the one the ladder opens on) beside the ladder's name
      const l = ladderById(g)!, k = l.tiers.find((x) => x.tool!.id === (on ? t : rememberedTool(l)));
      const em = b.querySelector('em.tier');
      if (em) em.textContent = k ? `· ${k.tool!.label}` : '';
    }
    if (this.picker.open && lad?.group.id !== this.picker.open) this.picker.close();
    else this.picker.refresh(t);
  }
  /** Grey out tools the player has not unlocked yet, naming the tier that opens them. */
  setLocks(tech: readonly string[]) {
    this.tech = tech;
    for (const l of TOOL_LADDERS) {
      const b = this.ladderButton(l.group.id);
      if (!b) continue;
      const open = l.tiers.filter((k) => DEV_TOOLS || hasFeature(tech, k.tool!.id));
      b.classList.toggle('locked', open.length === 0);
      b.title = open.length ? `${l.group.label}: ${open.length} of ${l.tiers.length} ${l.group.collection ? 'landmarks' : 'sizes'} unlocked` : `Needs ${techFor(l.tiers[0].tool!.id)?.name ?? ''} (press T for the tech tree)`;
    }
    this.picker.refresh();
    for (const b of $('tools').querySelectorAll<HTMLButtonElement>('button[data-tool]')) {
      const id = b.dataset.tool!;
      const locked = !DEV_TOOLS && !hasFeature(tech, id); // ?dev: a dev server skips technology locks
      b.classList.toggle('locked', locked);
      b.title = locked ? `Needs ${techFor(id)?.name ?? ''} (press T for the tech tree)` : TOOLS.find((t) => t.id === id)?.label ?? ''; // the full name when a long label is cut short
    }
  }
  setWho(name: string, color: number) { $('who').innerHTML = `<b style="color:#${color.toString(16).padStart(6, '0')}">${esc(name)}</b>`; }
  /** last ledger the server sent (it comes once a game hour, PlayerDTO.ledger) and whether its box is open */
  private ledger: LedgerDTO | null = null;
  private ledgerOpen = false;
  private money = 0;
  /** the overdraft and administration (PlayerDTO.fin), for the ledger's note */
  private fin: FinanceDTO | undefined;
  /** The treasury chip: money, yesterday's net (red when spending more than earning) and, on click, the day's ledger. */
  setMoney(n: number, ledger?: LedgerDTO, fin?: FinanceDTO) {
    this.money = n;
    if (ledger) this.ledger = ledger;
    if (arguments.length >= 3) this.fin = fin;
    const el = $('money');
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => { this.ledgerOpen = !this.ledgerOpen; this.setMoney(this.money); });
    }
    const L = this.ledger;
    const net = (r: LedgerDTO['today']) => Object.values(r).reduce((a: number, v) => a + (v ?? 0), 0);
    const y = L ? net(L.yesterday) : 0, hasY = !!L && Object.keys(L.yesterday).length > 0;
    el.innerHTML = `treasury <b class="${n < 0 ? 'bad' : ''}">${n < 0 ? '−' : ''}${fmt(Math.abs(n))}</b>${hasY ? ` <b class="${y < 0 ? 'bad' : ''}">${y >= 0 ? '+' : '−'}${fmt(Math.abs(y))}</b>/day` : ''}`;
    el.title = L ? `${this.ledgerText(L)}\n(click for the ledger)` : 'Your treasury (the ledger arrives on the next game hour)';
    let box = document.getElementById('ledgerBox');
    if (!this.ledgerOpen || !L) { box?.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'ledgerBox'; $('ui').appendChild(box); box.addEventListener('click', (e) => { this.ledgerOpen = false; this.setMoney(this.money); if ((e.target as HTMLElement).closest('[data-chart]')) this.onOpenChart?.('money'); }); }
    const r = el.getBoundingClientRect();
    box.style.left = `${Math.round(r.left)}px`;
    box.innerHTML = this.ledgerHtml(L, n);
  }
  private ledgerRows(L: LedgerDTO) {
    const cats = (Object.keys(LEDGER_LABELS) as LedgerCat[]).filter((k) => L.today[k] || L.yesterday[k]);
    const sum = (r: LedgerDTO['today'], sign: number) => Object.values(r).reduce((a: number, v) => a + (Math.sign(v ?? 0) === sign ? v! : 0), 0);
    return { cats, inY: sum(L.yesterday, 1), outY: sum(L.yesterday, -1), inT: sum(L.today, 1), outT: sum(L.today, -1) };
  }
  private ledgerText(L: LedgerDTO) {
    const { inY, outY, inT, outT } = this.ledgerRows(L);
    return `Yesterday: in ${fmt(inY)}, out ${fmt(-outY)}, net ${inY + outY >= 0 ? '+' : '−'}${fmt(Math.abs(inY + outY))}\nToday so far: in ${fmt(inT)}, out ${fmt(-outT)}`;
  }
  private ledgerHtml(L: LedgerDTO, money: number) {
    const { cats, inY, outY, inT, outT } = this.ledgerRows(L);
    const cell = (v: number | undefined) => (v ? `<td class="${v < 0 ? 'bad' : ''}">${v < 0 ? '−' : '+'}${fmt(Math.abs(v))}</td>` : '<td class="z">·</td>');
    const netY = inY + outY;
    // days of cash left at yesterday's rate, counting only the running costs (building and buying are choices)
    const running = (['wages', 'upkeep', 'interest'] as LedgerCat[]).reduce((a, k) => a + (L.yesterday[k] ?? 0), 0) + (L.yesterday.tax ?? 0) + (L.yesterday.fees ?? 0);
    // the overdraft (server sim/finance.ts) is spendable too: days until the limit
    const limit = ECONOMY_TUNING.overdraftLimit;
    const left = running < 0 ? Math.max(0, Math.floor((money + limit) / -running)) : -1;
    return `<table><tr><th></th><th>yesterday</th><th>today</th></tr>${cats.map((k) => `<tr><th>${LEDGER_LABELS[k]}</th>${cell(L.yesterday[k])}${cell(L.today[k])}</tr>`).join('')}
      <tr class="sum"><th>Income</th>${cell(inY)}${cell(inT)}</tr><tr class="sum"><th>Spending</th>${cell(outY)}${cell(outT)}</tr>
      <tr class="sum"><th>Net</th>${cell(netY || undefined)}${cell(inT + outT || undefined)}</tr></table>
      <div class="note"><span class="chartlink" data-chart="money">Treasury and income charts ›</span></div>
      ${money < 0 ? `<div class="note bad">Overdrawn: ${fmt(-money)} of the ${fmt(limit)} overdraft used, interest ${Math.round(ECONOMY_TUNING.overdraftInterestPerDay * 100)}% a day at midnight. ${this.fin?.admin !== undefined ? 'In administration until a midnight finds the treasury at zero or above.' : `${ECONOMY_TUNING.adminAfterDays} midnights below zero and the city goes into administration.`}</div>` : ''}
      <div class="note">${left < 0 ? 'Taxes and fees cover the running costs (wages, upkeep).'
        : `<span class="${left < 30 ? 'bad' : ''}">Running costs exceed taxes and fees${left < 30 ? `: about ${left} day${left === 1 ? '' : 's'} to the end of the ${fmt(limit)} overdraft at this rate` : ''}.</span> Raise the tax rate in a parcel, add homes, or hold off on services.`}</div>`;
  }
  /** main.ts: mothball or reopen the building at (x, y) (the `recover` message with its door) */
  onMothball: ((x: number, y: number, on: boolean) => void) | null = null;
  /** onboarding.ts takes advisor hints (shared/src/goals.ts HINTS) and returns true; false: toast them as before */
  onHint: ((id: 'night') => boolean) | null = null;
  /** charts.ts: open the charts panel on a chart (population and treasury figures link to theirs) */
  onOpenChart: ((id: string) => void) | null = null;
  /** the light chip's mode, and whether the clock has been shown yet (the first one may say it is night) */
  private lightMode: 'live' | 'fixed' = 'live';
  private clockSeen = false;
  setClock(day: number, frac: number) {
    const h = Math.floor(frac * 24), m = Math.floor((frac * 24 - h) * 60);
    if (!this.clockSeen) {
      this.clockSeen = true;
      if (this.lightMode === 'live' && (h >= 20 || h < 6) && !this.onHint?.('night')) this.toast('info', "It's night in the city. The light chip at the top right holds the view at mid-afternoon; click it again to follow the clock");
    }
    $('clock').innerHTML = `<b>${WEEKDAYS[day % DAYS_PER_WEEK]}</b> ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} <span style="opacity:.6">day ${day}</span>`;
  }
  setWorldStats(s: { population: number; jobs: number; employed: number; moving: number; driving: number; outAndAbout: number; sites: number; chunks: number; vehicles: number; queued: number; speedPct: number; parked: number; migIn?: number; migOut?: number; migWaiting?: number }, players: number) {
    // players < 0: a local game, nobody else online
    const jam = s.vehicles ? Math.round((100 * s.queued) / s.vehicles) : 0;
    const ws = $('worldstats');
    if (!ws.dataset.wired) { ws.dataset.wired = '1'; ws.addEventListener('click', (e) => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-chart]')?.dataset.chart; if (id) this.onOpenChart?.(id); }); }
    ws.innerHTML = `<span class="chartlink" data-chart="pop" title="Population chart">pop <b>${s.population}</b></span> · jobs <b>${s.employed}/${s.jobs}</b> · on the move <b>${s.moving}</b> · <span title="vehicles on the road · share held up · average speed">traffic <b>${s.vehicles}</b> cars, <b class="${jam > 30 ? 'bad' : ''}">${jam}%</b> queued, speed <b>${s.speedPct}%</b></span> · parked <b>${s.parked}</b> · out <b>${s.outAndAbout}</b> · building <b>${s.sites}</b>${s.migIn !== undefined ? ` · <span title="newcomers in · leavers out through the gateways today · waiting at the gates">migration <b class="${s.migIn - (s.migOut ?? 0) < 0 ? 'bad' : ''}">${s.migIn - (s.migOut ?? 0) >= 0 ? '+' : ''}${s.migIn - (s.migOut ?? 0)}</b> (${s.migIn} in, ${s.migOut ?? 0} out${s.migWaiting ? `, ${s.migWaiting} at the gate` : ''})</span>` : ''}${players >= 0 ? ` · online <b>${players}</b>` : ''}`;
  }
  setHeat(on: boolean) {
    const b = $('heat');
    b.classList.toggle('on', on);
    b.innerHTML = on ? 'traffic heat <i class="legend"></i>' : 'traffic heat';
  }
  setLightMode(mode: 'live' | 'fixed', hour: number) {
    this.lightMode = mode;
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    $('light').textContent = mode === 'live' ? '🕒 live light' : `☀ fixed ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    $('light').title = mode === 'live' ? 'Lighting follows the in-game clock. Click to freeze it.' : 'Lighting frozen. Click to follow the clock.';
  }
  setConn(ok: boolean) { const c = $('conn'); c.textContent = ok ? 'connected' : 'reconnecting…'; c.className = 'stat ' + (ok ? 'ok' : 'bad'); }
  setStatus(text: string) { $('status').textContent = text; }
  toast(kind: 'info' | 'error', msg: string) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`; el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), Math.max(4000, msg.length * 55)); // long advice stays up long enough to read
  }

  showParcel(p: ParcelDTO, owner: PlayerDTO | undefined, mine: boolean) {
    const panel = $('panel');
    if (this.buildingPanelOpen) { this.buildingPanelOpen = false; panel.onclick = null; }
    panel.classList.remove('hidden');
    const s = p.stats;
    if (this.panelFor !== p.id) {
      this.panelFor = p.id;
      panel.innerHTML = `
        <h2><span class="sw" style="background:#${(owner?.color ?? 0xffffff).toString(16).padStart(6, '0')}"></span><span id="pName"></span></h2>
        <div class="sub" id="pSub"></div>
        <table>
          <tr><td>Population</td><td id="pPop"></td></tr>
          <tr><td>Jobs filled</td><td id="pJobs"></td></tr>
          <tr><td>Under construction</td><td id="pSites"></td></tr>
          <tr><td>Roads</td><td id="pRoads"></td></tr>
          <tr id="pEduRow"><td title="Residents aged 25-64: 20 x their mean level, 0-100">Education</td><td id="pEdu"></td></tr>
          <tr><td colspan="2" id="pKinds" style="padding-top:6px"></td></tr>
          <tr><td colspan="2" id="pBuild" style="padding-top:6px"></td></tr>
          <tr><td>Tax collected today</td><td id="pTax"></td></tr>
          <tr><td>Yesterday</td><td id="pTaxY"></td></tr>
        </table>
        ${mine ? `
          <label>Tax rate <b id="pRate"></b></label>
          <input type="range" id="pRateInput" min="0" max="${MAX_TAX * 100}" step="1" />
          <label>Name<input type="text" id="pNameInput" maxlength="24" /></label>
          <div class="hint">Income tax is paid by everyone who works here, wherever they live; property tax by everyone who lives here; sales tax by everyone who drinks or eats here. Above ~20% people start leaving. Services and builders are paid from your treasury.</div>
        ` : `<div class="hint">Citizens from anywhere can work here; their income tax goes to ${esc(owner?.name ?? 'the owner')}.</div>`}`;
      if (mine) {
        const r = $<HTMLInputElement>('pRateInput');
        r.oninput = () => { $('pRate').textContent = r.value + '%'; };
        r.onchange = () => this.cb.onTax(p.id, Number(r.value) / 100);
        const n = $<HTMLInputElement>('pNameInput');
        n.onchange = () => this.cb.onRename(p.id, n.value);
      }
    }
    $('pName').textContent = p.name;
    $('pSub').textContent = `${owner?.name ?? p.owner} · ${p.w}×${p.h} tiles at (${p.x}, ${p.y})` + (mine ? '' : ` · tax ${Math.round(p.taxRate * 100)}%`);
    $('pPop').textContent = String(s.population);
    $('pJobs').textContent = `${s.employed} / ${s.jobs}`;
    $('pRoads').textContent = String(s.roads);
    $('pSites').textContent = String(s.sites);
    const edu = eduTotals([p]);
    $('pEduRow').style.display = edu.n || edu.places || edu.grads ? '' : 'none';
    $('pEdu').textContent = [edu.n ? `index ${edu.index} (${eduIndexLabel(edu.index)})` : '', edu.grads ? `${edu.grads} graduates` : '', edu.places ? `${edu.pupils}/${edu.places} pupils` : ''].filter(Boolean).join(' · ');
    $('pKinds').innerHTML = s.jobsByKind.map((cap, k) => cap > 0 ? `<div style="display:flex;justify-content:space-between"><span>${esc(KIND_NAMES[k])}</span><span style="color:var(--fg)">${s.staffedByKind[k]} / ${cap}</span></div>` : '').join('');
    $('pTax').textContent = fmt(s.taxToday);
    $('pTaxY').textContent = fmt(s.taxYesterday);
    if (mine) {
      const r = $<HTMLInputElement>('pRateInput');
      if (document.activeElement !== r) { r.value = String(Math.round(p.taxRate * 100)); $('pRate').textContent = r.value + '%'; }
      const n = $<HTMLInputElement>('pNameInput');
      if (document.activeElement !== n) n.value = p.name;
    }
  }
  hideParcel() { $('panel').classList.add('hidden'); this.panelFor = 0; }

  /** Build list for the selected parcel; controls only when it is the viewer's. */
  showSites(parcelId: number, sites: SiteDTO[], mine: boolean) {
    if (this.panelFor !== parcelId) return;
    const el = document.getElementById('pBuild');
    if (!el) return;
    if (!sites.length) { el.innerHTML = ''; return; }
    const rows = sites.slice(0, 25).map((s) => {
      const pct = Math.round((100 * s.done) / s.total);
      const what = isCivicId(s.kind) ? KIND_NAMES[s.kind] : `${KIND_NAMES[s.kind]} → L${s.target}`;
      const ctl = mine ? `
        <button data-p="${s.priority + 1}" ${s.priority >= 2 ? 'disabled' : ''} title="raise priority">▲</button>
        <button data-p="${s.priority - 1}" ${s.priority <= -1 ? 'disabled' : ''} title="lower priority">▼</button>
        <button data-p="${s.priority <= -2 ? 0 : -2}" title="${s.priority <= -2 ? 'resume' : 'pause'}">${s.priority <= -2 ? '▶' : '⏸'}</button>` : '';
      return `<div class="site p${s.priority}" data-x="${s.x}" data-y="${s.y}">
        <span class="what" title="click to jump to it">${esc(what)}</span>
        <span class="pri">${PRIORITY_NAMES[s.priority]}</span>
        <span class="prog"><i style="width:${pct}%"></i></span>
        <span class="n">${s.builders ? `${s.builders}👷` : ''}</span>
        <span class="ctl">${ctl}</span></div>`;
    }).join('');
    el.innerHTML = `<div class="buildhead">Build list <span>${sites.length}${sites.length > 25 ? ', showing 25' : ''}</span></div>${rows}`;
    el.querySelectorAll<HTMLButtonElement>('button[data-p]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const row = b.closest<HTMLElement>('.site')!;
        this.cb.onPriority(Number(row.dataset.x), Number(row.dataset.y), Number(b.dataset.p));
      };
    });
    el.querySelectorAll<HTMLElement>('.site .what').forEach((w) => {
      w.onclick = () => { const row = w.closest<HTMLElement>('.site')!; this.cb.onFocus(Number(row.dataset.x), Number(row.dataset.y)); };
    });
  }

  // ---- building tooltip ------------------------------------------------------

  moveTip(px: number, py: number) {
    const tip = $('tip');
    const w = tip.offsetWidth + 24, h = tip.offsetHeight + 24;
    tip.style.left = Math.min(px, innerWidth - w) + 'px';
    tip.style.top = Math.min(py, innerHeight - h) + 'px';
  }
  hideTip() { $('tip').classList.add('hidden'); }
  showTip(info: BuildingInfo) {
    const tip = $('tip');
    let html = this.buildingHtml(info, 'h3');
    if (info.residents?.total || info.workers?.total || info.visitors || info.venue?.visitors) html += `<div class="clickhint">click for everyone here</div>`;
    tip.innerHTML = html;
    tip.classList.remove('hidden');
  }
  /** Summary rows shared by the hover tooltip, the building panel and the demo tour's card (tour.ts). */
  buildingHtml(info: BuildingInfo, h: 'h2' | 'h3'): string {
    const color = TOOLS.find((t) => TOOL_KIND[t.id] === info.kind)?.color ?? 'var(--muted)';
    const row = (k: string, v: string | number) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
    const name = KIND_NAMES[info.kind];
    const fam = familyOf(info.kind); // family checks (parking, yard, commercial) cover a family's sub-kinds too
    const title = info.venue ? info.venue.title.charAt(0).toUpperCase() + info.venue.title.slice(1) : name.charAt(0).toUpperCase() + name.slice(1);
    const lv = info.level && !isCivicId(info.kind) && fam !== Zone.Parking && !info.transit ? `level ${info.level}` : '';
    // a business, venue or home leads with the name on its front and the kind after it (a civic board is just its kind)
    const named = info.level ? this.nameOf(info.x, info.y) : null;
    const own = named && named.toLowerCase() !== title.toLowerCase() ? named : null;
    const sub = own ? [title, lv].filter(Boolean).join(' · ') : lv;
    let html = `<${h}><span class="sw" style="background:${color}"></span>${own ? esc(own) : title}${sub ? ` <span style="color:var(--muted);font-weight:400">${sub}</span>` : ''}</${h}>`;
    html += `<div class="sub">${info.parcel ? `${esc(info.parcel.name)} · ${esc(info.parcel.owner)} · tax ${Math.round(info.parcel.taxRate * 100)}%` : 'unclaimed land'}</div>`;
    if (info.construction) {
      const c = info.construction;
      html += `<div class="row"><span>${info.level ? `Upgrading to level ${info.level + 1}` : 'Under construction'}</span><span>${Math.round((100 * c.done) / c.total)}%</span></div>`;
      html += `<div class="bar"><i style="width:${(100 * c.done) / c.total}%"></i></div>`;
      html += row('Builders on site', c.builders || '<span style="color:var(--danger)">none yet</span>');
      html += row('Priority', PRIORITY_NAMES[c.priority]);
    } else if (info.level === 0 && fam !== Zone.Parking) {
      html += `<div class="row"><span>Empty lot, waiting for demand</span></div>`;
    }
    if (info.residents) {
      const r = info.residents;
      html += `<div class="sect">Residents</div>`;
      html += row('Living here', `${r.total} / ${info.capacity}`);
      html += row('Employed', `${r.employed}${r.total ? ` (${Math.round((100 * r.employed) / r.total)}%)` : ''}`);
      html += row('Right now', `${r.atHome} home · ${r.working} at work · ${r.out} out`);
      if (r.employed) html += row('Drive to work', `${r.drivers}`);
      const jobs = r.jobsByKind.map((n, k) => (n ? `${n} ${shortKind(k)}` : '')).filter(Boolean).join(', ');
      if (jobs) html += row('Work as', jobs);
      if (info.leisure) {
        const l = info.leisure, what = [l.parks ? `${l.parks} park${l.parks === 1 ? '' : 's'}` : '', l.venues ? `${l.venues} venue${l.venues === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
        html += row('Leisure coverage', `${esc(l.label)}${what ? ` (${what})` : ''}`);
      }
    }
    if (info.focus) html += focusHtml(info.focus);
    if (info.workers && !((info.venue || info.gateway) && info.capacity === 0)) { // a park or a motorway connection has no staff
      const w = info.workers;
      html += `<div class="sect">${fam === Zone.Yard ? 'Builders' : 'Staff'}</div>`;
      html += row('Jobs filled', `${w.total} / ${info.capacity}`);
      html += row('Right now', `${w.onShift} on shift · ${w.commuting} commuting · ${w.offDuty} off`);
      if (w.total) html += row('Drive in', `${w.drivers}`);
      for (const [label, n] of w.shifts) html += row(`Shift ${label}`, n);
      if (info.wage) html += row('Wage per 8h shift', `$${info.wage}${info.venue ? ' (paid from takings)' : isCivicId(info.kind) ? ' (paid by owner)' : ''}`);
      if (info.upkeep) html += row('Daily upkeep', `$${info.upkeep}`);
      if (info.visitorCapacity !== undefined) html += row('Customers in now', `${info.visitors} / ${info.visitorCapacity}`);
      if (info.activeSites !== undefined) html += row('Sites being worked', info.activeSites);
    }
    if (info.mothballed) html += row('Mothballed', '<span class="bad">no staff, no upkeep, no cover</span>');
    if (info.fire) html += row('Fire', `<span class="bad">${info.fire}</span>`);
    if (info.media) html += mediaHtml(info.media, row);
    if (info.airport) html += airportHtml(info.airport, row);
    if (info.rail) html += railStationHtml(info.rail, row);
    if (info.metro) html += metroStationHtml(info.metro, row);
    if (info.ferry) html += metroStationHtml(info.ferry, row, true);
    if (info.harbour) html += harbourHtml(info.harbour, row);
    if (info.gateway) html += gatewayHtml(info.gateway, row);
    if (info.transit) html += stopHtml(info.transit, row);
    if (info.school) html += schoolHtml(info.school);
    if (info.venue) {
      const v = info.venue;
      html += `<div class="sect">${v.block ? 'Communal garden' : v.type === 'park' ? 'Park' : 'Venue'}</div>`;
      if (v.block) html += row('Shared by', `${v.block.residents} residents of ${v.block.homes} home${v.block.homes === 1 ? '' : 's'} round this block`);
    }
    if (info.venue && !info.venue.block) {
      const v = info.venue;
      html += row('Visitors now', `${v.visitors} / ${v.capacity}`);
      html += row('Open', `${hm(v.open[0])}–${hm(v.open[1])} · ${v.openNow ? 'open now' : v.staffed ? 'closed now' : '<span class="bad">no staff yet</span>'}`);
      if (v.nextEvent) html += row('Next event', `${esc(v.nextEvent.name)}, ${v.nextEvent.tonight ? 'today' : v.nextEvent.weekday} ${hm(v.nextEvent.hour)}`);
      html += row('Ticket', v.ticket ? `$${v.ticket}${v.nextEvent ? `, $${Math.round(v.ticket * 1.5)} on event nights` : ''}` : 'free');
      html += row('Visits', `${v.visitsToday} today · ${v.visitsYesterday} yesterday`);
      if (v.upgradeVisits && !info.construction) html += row('Grows at', `${v.upgradeVisits} visits a day`);
      html += row('Leisure value', `${v.leisureValue}, homes within ${v.radius} tiles`);
      if (info.capacity === 0 && info.upkeep) html += row('Daily upkeep', `$${info.upkeep}`);
    }
    if (info.venue?.block) html += row('Leisure value', `${info.venue.leisureValue}, for the homes round it only`);
    // road work based here or serving here: a cab office, a takeaway's riders, a depot's rounds (docs/mobile-jobs.md)
    for (const m of info.mobile ?? []) {
      html += `<div class="sect">${esc(m.role.charAt(0).toUpperCase() + m.role.slice(1))}</div>`;
      for (const [k, v] of m.rows) html += row(esc(k), esc(v));
    }
    if (info.parking) {
      const p = info.parking;
      html += `<div class="sect">Parking</div>`;
      html += row(fam === Zone.Parking ? 'Bays in use' : p.underground ? 'Underground spaces' : 'Spaces', `${p.used} / ${p.capacity}`);
      if (p.turnedAway) html += row('Turned away today', `<span style="color:var(--danger)">${p.turnedAway}</span>`);
      if (p.fee !== undefined) html += row('Fee per stay', `$${p.fee}`);
      if (p.incomeToday !== undefined) html += row('Income today', fmt(p.incomeToday));
      if (fam === Zone.Parking && info.upkeep) html += row('Daily upkeep', `$${info.upkeep}`);
    }
    return html;
  }

  // ---- building panel: summary plus everyone who lives, works, visits or builds here ----------

  private buildingPanelOpen = false;
  showBuilding(info: BuildingInfo, selectedCitizen: number) {
    const panel = $('panel');
    const scroll = this.buildingPanelOpen ? panel.scrollTop : 0;
    const p = info.people;
    const person = (r: PersonRow) => `<div class="person${r.here ? ' here' : ''}${r.id === selectedCitizen ? ' sel' : ''}" data-cid="${r.id}" title="click to select ${esc(r.name)}"><i class="dot"></i><span class="pname">${esc(r.name)}${r.age !== undefined ? ` <span class="page">${r.age}</span>` : ''}</span><span class="pact">${esc(r.activity)}</span></div>`;
    /** residents come grouped by household: families together, the households with someone home first */
    const grouped = (rows: PersonRow[]) => {
      const groups = new Map<number, PersonRow[]>();
      for (const r of rows) { const k = r.household ?? -r.id; const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); }
      const list = [...groups.values()].sort((a, b) => Number(b.length > 1) - Number(a.length > 1) || Number(b.some((r) => r.here)) - Number(a.some((r) => r.here)) || b.length - a.length);
      return list.map((g) => g.length > 1
        ? `<div class="hhold"><div class="hhead">The ${esc(g[0].householdName ?? '')} household<span>${g.length}</span></div>${g.sort((a, b) => (b.age ?? 0) - (a.age ?? 0)).map(person).join('')}</div>`
        : person(g[0])).join('');
    };
    const section = (title: string, rows: PersonRow[], empty: string, byHousehold = false) => {
      const here = rows.filter((r) => r.here).length;
      const body = rows.length ? (byHousehold ? grouped(rows) : rows.map(person).join('')) : `<div class="pempty">${empty}</div>`;
      return `<div class="sect people-sect">${title}${rows.length ? `<span class="here-n">${here} here</span>` : ''}</div>${body}`;
    };
    let html = `<div class="chead"><button class="chip" id="bClose" title="close (Esc)">✕</button></div>` + this.buildingHtml(info, 'h2');
    // a service or yard of yours can be mothballed (server sim/finance.ts): no staff, no upkeep, no cover until reopened
    if (info.mothballable && this.onMothball) html += `<button class="chip moth" id="bMoth" title="${info.mothballed ? 'Hire staff again; the upkeep comes back' : 'Let the staff go: no upkeep and no cover until you reopen it'}">${info.mothballed ? 'Reopen' : 'Mothball'}</button>`;
    const fam = familyOf(info.kind);
    if (p) {
      if (info.residents) {
        const hh = new Set(p.residents.map((r) => r.household ?? -r.id)).size;
        html += section(`Residents (${p.residents.length}/${info.capacity}) · ${hh} household${hh === 1 ? '' : 's'}`, p.residents, 'nobody lives here yet', true);
      }
      if (info.workers && !((info.venue || info.gateway) && info.capacity === 0)) html += section(`${fam === Zone.Yard ? 'Builders' : 'Staff'} (${p.workers.length}/${info.capacity})`, p.workers, 'nobody works here yet');
      if (fam === Zone.Commercial || info.venue || p.visitors.length) html += section(`Visitors (${p.visitors.length})`, p.visitors, 'nobody here at the moment');
      if (p.builders?.length) html += section(`Builders on site (${p.builders.length})`, p.builders, '');
      if (p.truncated) html += `<div class="pempty">Long lists are cut at 80 rows.</div>`;
    } else html += `<div class="pempty">loading…</div>`;
    panel.classList.remove('hidden');
    panel.innerHTML = html;
    panel.scrollTop = scroll;
    this.buildingPanelOpen = true;
    this.panelFor = -1;
    $('bClose').onclick = () => this.cb.onCloseBuilding();
    const moth = document.getElementById('bMoth');
    if (moth) moth.onclick = () => this.onMothball?.(info.x, info.y, !info.mothballed);
    panel.onclick = (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-cid]');
      if (row) this.cb.onSelectCitizen(Number(row.dataset.cid));
    };
  }
  /** Highlight the row of the selected citizen without waiting for the next refresh. */
  markPerson(id: number) {
    for (const r of $('panel').querySelectorAll<HTMLElement>('.person')) r.classList.toggle('sel', Number(r.dataset.cid) === id);
  }
  hideBuilding() {
    if (!this.buildingPanelOpen) return;
    this.buildingPanelOpen = false; this.panelFor = 0;
    $('panel').classList.add('hidden');
    $('panel').onclick = null;
  }

  /** A runway or taxiway tile: which airport it belongs to and whether planes are flying (worked out on the client). */
  /** A tooltip worked out on the client (railway track, render/trains.ts and client/src/rail.ts). */
  showHtmlTip(html: string) {
    const tip = $('tip');
    tip.innerHTML = html;
    tip.classList.remove('hidden');
  }
  showRunwayTip(link: AirportLink | null, owner: string) {
    const tip = $('tip');
    const row = (k: string, v: string | number) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
    let html = `<h3><span class="sw" style="background:#2b2e33"></span>Runway</h3>`;
    if (!link) {
      html += `<div class="sub">${esc(owner)}</div>` + row('Airport', '<span class="bad">no terminal behind it</span>');
    } else {
      const t = link.terminal, r = link.runway;
      html += `<div class="sub">${esc(owner)} · terminal at (${t.doorX}, ${t.doorY})</div>`;
      if (r) html += row('Length', `${r.len} tiles`);
      html += row('Status', link.status === 'operational' ? 'operational' : `<span class="bad">${esc(link.status)}</span>`);
      if (link.airport) html += row('Traffic', `${link.airport.flightsPerHour} arrivals an hour at midday, peaks morning and evening`);
    }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
  }

  showRoadTip(info: RoadInfo) {
    const tip = $('tip');
    const row = (k: string, v: string | number) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
    const pct = Math.round(info.congestion * 100);
    const grade = pct < 15 ? 'flowing' : pct < 40 ? 'busy' : pct < 70 ? 'congested' : 'jammed';
    let html = `<h3><span class="sw" style="background:#6b6f7a"></span>${info.bridge ? 'Bridge' : 'Road'} <span style="color:var(--muted);font-weight:400">${info.bridge ? `${info.bridge.style}, ${info.bridge.span} tile${info.bridge.span === 1 ? '' : 's'} over the water` : info.junction === 'none' ? '' : info.junction === 'signal' ? 'signalled junction' : info.junction === 'roundabout' ? 'roundabout' : info.junction === 'flyover' ? 'flyover' : 'junction'}</span></h3>`;
    html += `<div class="sub">${info.parcel ? `${esc(info.parcel.name)} · ${esc(info.parcel.owner)}` : 'public road'}</div>`;
    html += `<div class="row"><span>Traffic</span><span class="${pct >= 40 ? 'bad' : ''}">${grade} (${pct}%)</span></div>`;
    html += `<div class="bar heat"><i style="width:${pct}%"></i></div>`;
    html += row('Cars on this tile', `${info.vehiclesNow}${info.queuedNow ? ` · ${info.queuedNow} queued` : ''}`);
    html += row('Speed', `${Math.round(info.speedPct * 100)}% of free flow`);
    if (info.junction === 'signal') html += row('Signal', `${info.amber ? 'amber' : 'green'} ${info.green === 'ns' ? 'north–south' : 'east–west'}`);
    else if (info.junction === 'yield') html += row('Control', 'give way');
    else if (info.junction === 'roundabout') html += row('Control', 'give way to traffic on the ring (it goes round anticlockwise)');
    else if (info.junction === 'flyover') html += row('Control', 'none needed: one road passes over the other, no turns');
    if (info.kerbParked) html += row('Parked at the kerb', `${info.kerbParked} (slows traffic)`);
    tip.innerHTML = html;
    tip.classList.remove('hidden');
  }

  private citizenHtml(info: CitizenInfo, full: boolean): string {
    const row = (k: string, v: string | number) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
    const where = (d: { x: number; y: number; label: string }) => `${esc(d.label)} <span style="color:var(--muted)">(${d.x}, ${d.y})</span>`;
    const icon = info.role === 'citizen' ? (info.taxi ? '🚕' : info.mode === 'drive' ? '🚗' : info.mode === 'ride' ? '🚌' : '🚶') : FLEET_ICON[info.role] ?? (info.role === 'delivery truck' ? '🚚' : info.role === 'visitor' ? '🚘' : info.role === 'police patrol' ? '🚓' : info.role === 'fire engine' ? '🚒' : info.role === 'bus' ? '🚌' : '🚑');
    let html = `<h3>${icon} ${esc(info.name)}${info.role !== 'citizen' ? ` <span style="color:var(--muted);font-weight:400">${esc(info.role)}</span>` : ''}</h3>`;
    html += `<div class="sub">${esc(info.activity)}${info.status === 'queued' ? ` · <span class="bad">held up ${Math.round(info.waitTicks * 0.6)} min</span>` : ''}</div>`;
    if (info.bus) html += busHtml(info.bus, row);
    if (info.occupation) html += row('Works as', `${esc(info.occupation)}${info.fleet?.base ? `, ${esc(info.fleet.base)}` : info.employer ? ` at the ${esc(KIND_NAMES[info.employer.kind])}` : ''}`);
    if (info.employer?.parcel) html += row('Employer', esc(info.employer.parcel));
    if (info.shift) html += row('Shift', `${info.shift.label}${info.shift.workingToday ? '' : ' (day off)'}`);
    if (info.home) html += row('Lives', `${info.home.parcel ? esc(info.home.parcel) : 'unclaimed land'} <span style="color:var(--muted)">(${info.home.x}, ${info.home.y})</span>`);
    if (info.destination) html += row('Heading to', where(info.destination));
    // a mobile worker (docs/mobile-jobs.md): what the job is doing and the vehicle they are out in (select it to follow)
    if (info.fleet && info.role === 'citizen') html += row('On the road', `${esc(info.fleet.task)}${info.fleet.vehicle ? ` · <span class="plink" data-cid="${info.fleet.vehicle}" title="select the vehicle (follow it from its panel)">${esc(FLEET_LABEL[info.fleet.kind] ?? 'vehicle')}</span>` : ''}`);
    if (info.fleet?.today && (info.fleet.today.jobs || info.role !== 'citizen')) html += row('Today', `${info.fleet.today.jobs} job${info.fleet.today.jobs === 1 ? '' : 's'} · ${fmt(info.fleet.today.money)}`);
    if (info.fleet?.stops && info.role !== 'citizen') html += row('Stops to make', info.fleet.stops);
    if (info.taxi) html += row('Taxi', `<span class="plink" data-cid="${info.taxi.vehicle}" title="select the taxi">${esc(info.taxi.label)}</span>`);
    if (info.liftWith) html += row('Lift with', `<span class="plink" data-cid="${info.liftWith.id}" title="click to select ${esc(info.liftWith.name)}">${esc(info.liftWith.name)}</span> <span style="color:var(--muted)">${esc(info.liftWith.relation)}</span>`);
    if (info.occupants && !full) html += row('In the car', esc(info.occupants.map((o) => o.name.split(' ')[0]).join(', ')));
    if (info.reroutes) html += row('Re-routed', `${info.reroutes} time${info.reroutes === 1 ? '' : 's'} this trip`);
    if (info.tripTotal) html += `<div class="bar"><i style="width:${Math.min(100, (100 * (info.tripDone ?? 0)) / info.tripTotal)}%"></i></div>`;
    if (info.ownsCar !== undefined) html += row('Car', info.ownsCar ? (info.parked ? `${esc(info.parked.where)} <span style="color:var(--muted)">(${info.parked.x}, ${info.parked.y})</span>` : 'driving it now') : 'none, walks everywhere');
    else if (info.parked) html += row('Parked', `${esc(info.parked.where)} (${info.parked.x}, ${info.parked.y})`);
    if (full && (info.trail || info.route)) {
      const done = Math.max(0, (info.trail?.length ?? 0) / 2 - 1), togo = (info.route?.length ?? 0) / 2;
      html += row('Route', `${done} tile${done === 1 ? '' : 's'} done · ${togo} to go`);
    }
    if (info.money !== undefined && full) html += row('Money', `$${info.money}`);
    if (info.occupants && full) {
      // car sharing: driver and passengers, each clickable
      html += `<div class="sect">In the car (${info.occupants.length})</div>`;
      html += info.occupants.map((r) => `<div class="person" data-cid="${r.id}" title="click to select ${esc(r.name)}"><span class="pname">${esc(r.name)} <span class="page">${r.age}</span></span><span class="prel">${esc(r.relation)}</span></div>`).join('');
    }
    const life = info.life;
    if (life && !full) {
      html += row('Age', `${life.age}${life.stage !== 'adult' ? ` · ${life.stage}` : ''}`);
      html += row('Health', `${life.health}${life.conditions.length ? ` · ${esc(life.conditions.join(', '))}` : ''}`);
      html += row('Happiness', `${life.happiness}`);
      if (life.leisureNeed !== undefined) html += row('Leisure need', `${life.leisureNeed}%`);
      if (life.values) html += `<div class="row"><span class="values">${esc(life.values)}</span></div>`;
    }
    if (life && full) html += this.lifeHtml(life);
    return html;
  }
  /** Age, health, family, friends, happiness and money for the selected citizen; names are clickable (data-cid). */
  private lifeHtml(life: NonNullable<CitizenInfo['life']>): string {
    const row = (k: string, v: string | number) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
    const meter = (v: number, cls: string) => `<div class="bar meter ${cls}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
    const person = (r: PersonRef) => `<div class="person" data-cid="${r.id}" title="click to select ${esc(r.name)}"><span class="pname">${esc(r.name)} <span class="page">${r.age}</span></span><span class="prel">${esc(r.relation === 'friend' ? r.activity : `${r.relation} · ${r.activity}`)}</span></div>`;
    let html = `<div class="sect">Life</div>`;
    if (life.values) html += `<div class="row"><span class="values">${esc(life.values)}</span></div>`; // docs/motivation.md: words, never numbers
    if (life.lately) html += row('Lately', esc(life.lately));
    html += row('Age', `${life.age} · ${life.stage}${life.birthday ? ` · turns ${life.age + 1} on ${WEEKDAY_NAMES[life.birthday.weekday]}` : ''}`);
    const ed = life.education;
    if (ed) html += educationHtml(ed);
    html += row('Health', `<span class="${life.health < 45 ? 'bad' : ''}">${life.health}</span>${life.conditions.length ? ` · ${esc(life.conditions.join(', '))}` : ''}`);
    html += meter(life.health, life.health < 45 ? 'poor' : life.health < 70 ? 'fair' : 'good');
    if (life.care) html += row('Right now', esc(life.care));
    if (life.sickDays) html += row('Sick days taken', life.sickDays);
    html += row('Happiness', `${life.happiness}`);
    html += meter(life.happiness, life.happiness < 40 ? 'poor' : life.happiness < 60 ? 'fair' : 'good');
    if (life.reasons.length) html += `<div class="reasons">${life.reasons.map((r) => `<span class="${r.delta >= 0 ? 'up' : 'down'}">${r.delta >= 0 ? '+' : '−'}${Math.abs(r.delta)} ${esc(r.label)}</span>`).join('')}</div>`;
    if (life.leisureNeed !== undefined) {
      html += row('Leisure need', `${life.leisureNeed}%${life.leisureNeed >= 65 ? ' · bored' : life.leisureNeed <= 25 ? ' · had a good time' : ''}`);
      html += meter(100 - life.leisureNeed, life.leisureNeed >= 65 ? 'poor' : life.leisureNeed >= 35 ? 'fair' : 'good');
    }
    html += row('Last 7 days', `${fmt(life.income7)} in · ${fmt(life.spend7)} out`);
    html += row('Today', `${life.tripsToday} trip${life.tripsToday === 1 ? '' : 's'} · ${life.trafficMinToday} min in traffic`);
    if (life.colleagues || life.stage === 'adult') html += row('Colleagues', life.colleagues);
    const others = life.household.members;
    html += `<div class="sect">${others.length ? `The ${esc(life.household.name)} household (${others.length + 1})` : 'Household'}</div>`;
    html += others.length ? others.map(person).join('') : `<div class="pempty">lives alone</div>`;
    html += `<div class="sect">Friends (${life.friends.length})</div>`;
    html += life.friends.length ? life.friends.map(person).join('') : `<div class="pempty">no friends yet</div>`;
    return html;
  }
  showCitizenTip(info: CitizenInfo) {
    const tip = $('tip');
    tip.innerHTML = this.citizenHtml(info, false);
    tip.classList.remove('hidden');
  }

  // ---- selected citizen panel -------------------------------------------------

  private citizenPanelFor = 0;
  showCitizen(info: CitizenInfo, following: boolean, fpv: 'off' | 'inset' | 'full' = 'off') {
    const panel = $('cpanel');
    const scroll = this.citizenPanelFor === info.id ? panel.scrollTop : 0;
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="chead"><button class="chip ${fpv === 'inset' ? 'on' : ''}" id="cFpv" title="First-person view in a corner inset (I)">FPV</button><button class="chip ${fpv === 'full' ? 'on' : ''}" id="cFpvFull" title="First-person view filling the window (O; Esc leaves)">full</button><button class="chip ${following ? 'on' : ''}" id="cFollow">${following ? '● following' : 'follow'}</button><button class="chip" id="cClose">✕</button></div>` + this.citizenHtml(info, true);
    $('cFollow').onclick = () => this.cb.onFollow(info.id, !following);
    $('cClose').onclick = () => this.cb.onDeselectCitizen();
    $('cFpv').onclick = () => this.cb.onFpv('inset');
    $('cFpvFull').onclick = () => this.cb.onFpv('full');
    panel.scrollTop = scroll;
    // household members and friends are clickable: select that person instead
    panel.onpointerdown = null;
    panel.onclick = (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-cid]');
      if (row) this.cb.onSelectCitizen(Number(row.dataset.cid));
    };
    this.citizenPanelFor = info.id;
    this.vehiclePanelFor = '';
  }
  /** The selected train's or plane's panel (vehicles.ts builds the body); same buttons as the citizen panel, roster names select that citizen. */
  private vehiclePanelFor = '';
  private vehiclePanelHtml = '';
  showVehicle(key: string, body: string, following: boolean, fpv: 'off' | 'inset' | 'full' = 'off') {
    const panel = $('cpanel');
    const scroll = this.vehiclePanelFor === key ? panel.scrollTop : 0;
    const tag = `${following}|${fpv}|${body}`;
    if (this.vehiclePanelFor === key && tag === this.vehiclePanelHtml && !panel.classList.contains('hidden')) return; // nothing changed: keep the rows under the cursor
    this.vehiclePanelHtml = tag;
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="chead"><button class="chip ${fpv === 'inset' ? 'on' : ''}" id="cFpv" title="Cab view in a corner inset (I)">FPV</button><button class="chip ${fpv === 'full' ? 'on' : ''}" id="cFpvFull" title="Cab view filling the window (O; Esc leaves)">full</button><button class="chip ${following ? 'on' : ''}" id="cFollow">${following ? '● following' : 'follow'}</button><button class="chip" id="cClose">✕</button></div>` + body;
    $('cFollow').onclick = () => this.cb.onFollow(0, !following);
    $('cClose').onclick = () => this.cb.onDeselectCitizen();
    $('cFpv').onclick = () => this.cb.onFpv('inset');
    $('cFpvFull').onclick = () => this.cb.onFpv('full');
    panel.scrollTop = scroll;
    // the roster is rebuilt every second while the train runs, so a rider is picked on press, not on a click a rebuild could swallow
    panel.onclick = null;
    panel.onpointerdown = (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-cid]');
      if (row && e.button === 0) this.cb.onSelectCitizen(Number(row.dataset.cid));
    };
    this.vehiclePanelFor = key;
    this.citizenPanelFor = 0;
  }
  /** Light the FPV buttons of the open citizen panel without waiting for the next refresh. */
  markFpv(mode: 'off' | 'inset' | 'full') {
    document.getElementById('cFpv')?.classList.toggle('on', mode === 'inset');
    document.getElementById('cFpvFull')?.classList.toggle('on', mode === 'full');
  }
  hideCitizen() { $('cpanel').classList.add('hidden'); this.citizenPanelFor = 0; this.vehiclePanelFor = ''; }

  // ---- technology tree -------------------------------------------------------

  private techOpen = false;
  toggleTech(open?: boolean) {
    this.techOpen = open ?? !this.techOpen;
    $('tech').classList.toggle('hidden', !this.techOpen);
    $('techBtn').classList.toggle('on', this.techOpen);
  }
  get techIsOpen() { return this.techOpen; }
  showTech(me: PlayerDTO | undefined) {
    if (!this.techOpen) return;
    const el = $('tech');
    if (!me) { el.innerHTML = ''; return; }
    const tracks = [...new Set(TECH.map((t) => t.track))];
    let html = `<div class="thead"><h2>Technology</h2><span class="sub">Tiers are earned by what your city does, then bought. Treasury ${fmt(me.money)}.</span><button class="chip" id="techClose">✕</button></div><div class="tracks">`;
    for (const track of tracks) {
      html += `<div class="track"><h3>${TRACK_NAMES[track]}</h3>`;
      for (const t of TECH.filter((n) => n.track === track)) {
        const have = me.tech.includes(t.id);
        const prereqOk = t.requires.every((r) => me.tech.includes(r));
        const cur = me.progress[t.condition.counter] ?? 0;
        const pct = Math.min(100, Math.round((100 * cur) / t.condition.min));
        const earned = cur >= t.condition.min && !t.locked; // a locked node's unlock rule is still to be decided (tech.ts)
        const afford = spendableMoney(me.money, me.devUnlimited) >= t.cost, admin = me.fin?.admin !== undefined; // the overdraft counts (server sim/finance.ts)
        const canBuy = !have && prereqOk && earned && afford && !admin;
        const state = have ? 'have' : canBuy ? 'ready' : 'locked';
        html += `<div class="node ${state}">
          <div class="nhead"><b>${esc(t.name)}</b><span class="cost">${have ? 'unlocked' : `$${t.cost}`}</span></div>
          <div class="blurb">${esc(t.blurb)}</div>
          ${policiesOf(t)}
          ${have ? '' : t.locked ? `<div class="cond">${esc(t.locked)}</div>` : `<div class="cond">${esc(describeCondition(t))}<span>${cur} / ${t.condition.min}</span></div><div class="bar"><i style="width:${pct}%"></i></div>`}
          ${!have && !prereqOk ? `<div class="cond">needs ${t.requires.filter((r) => !me.tech.includes(r)).map((r) => esc(TECH_BY_ID.get(r)?.name ?? r)).join(', ')}</div>` : ''}
          ${!have ? `<button class="unlock" data-id="${t.id}" ${canBuy ? '' : 'disabled'}>${t.locked ? 'Locked' : earned && prereqOk ? (admin ? 'In administration' : afford ? 'Unlock' : 'Not enough money') : 'Not yet'}</button>` : ''}
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
    el.querySelectorAll<HTMLButtonElement>('button.unlock').forEach((b) => { b.onclick = () => this.cb.onUnlock(b.dataset.id!); });
    $('techClose').onclick = () => this.toggleTech(false);
  }
}

const SHORT = ['', 'at home', 'in shops', 'in factories', 'in offices', 'police', 'firefighters', 'medics', 'builders', 'parking', 'parks', 'at the cinema', 'at the theatre', 'at the sports hall', 'at the library'];
/** where the staff of the education kinds (kind ids 101-108, family code 14 like the library) work, by kind id: the library's "at the library" would be wrong for a teacher */
const SHORT_EDU: Record<number, string> = {
  101: 'at the nursery', 102: 'at primary schools', 103: 'at secondary schools', 104: 'at sixth-form colleges', 105: 'at FE colleges',
  106: 'at the university', 107: 'at the research institute', 108: 'in halls of residence',
};
const shortKind = (k: number) => SHORT[k] ?? SHORT_EDU[k] ?? KIND_NAMES[k];
/** the education policies a tech node opens, for its card in the tech tree (shared/src/policies.ts) */
/** Focus groups (docs/motivation.md, Culture tier 2): the value mix of a home's parcel, a bar per value, largest first. */
function focusHtml(f: FocusInfo): string {
  let html = `<div class="sect">Focus group · ${esc(f.parcel)}</div>`;
  if (!f.people) return html + `<div class="row"><span>Nobody here to ask yet</span></div>`;
  html += `<div class="row"><span>Asked</span><span>${f.people} resident${f.people === 1 ? '' : 's'}</span></div>`;
  const order = f.pct.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  for (const [p, i] of order) html += `<div class="row focus"><span>${VALUE_NAMES[i]}</span><span><span class="bar meter good"><i style="width:${Math.min(100, p * 2)}%"></i></span>${p}%</span></div>`;
  return html;
}

const policiesOf = (t: { unlocks: string[] }) => {
  const names = POLICIES.filter((p) => t.unlocks.includes(p.feature)).map((p) => p.name);
  return names.length ? `<div class="pol">Policies: ${names.join(', ')}</div>` : '';
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
