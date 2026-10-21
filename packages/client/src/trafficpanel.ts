import type { TrafficPanelInfo } from '@msimcity/shared';

/**
 * The Traffic panel (R5, docs/roads.md "Traffic control"): what is on the roads and why, so a jam is the player's to
 * shape. Opened from the overlays menu (and the congestion overlay's legend). While it is open it asks the server every
 * few seconds ('trafficPanel'; nothing is sent while it is closed) and shows: cars on the road now by who drives them
 * (residents, visitors, freight, buses, services), visitors and lorries set off in the last hour, today's give-ups by
 * kind, arrivals by gateway (with the visitor limit's switch on a motorway connection of the player's), the five
 * junctions with the most give-ups since yesterday and the three streets with the most cars queued now. A junction or
 * a street is a link: the camera goes there.
 */
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const POLL_MS = 3000;
const KIND_COLOUR: Record<string, string> = { residents: '#62d2a2', visitors: '#f2c230', freight: '#d8423a', buses: '#2f8fd6', services: '#b08cf0' };
const KIND_WORDS: Record<string, string> = { residents: 'residents', visitors: 'visitors', freight: 'lorries', buses: 'buses', services: 'services and fleet' };

export interface TrafficPanelHost {
  ask(): void;
  jump(x: number, y: number): void;
  limit(x: number, y: number, on: boolean): void;
}

export class TrafficPanel {
  readonly el: HTMLDivElement;
  open = false;
  private timer = 0;
  private info: TrafficPanelInfo | null = null;
  constructor(private host: TrafficPanelHost) {
    injectStyle();
    this.el = document.createElement('div');
    this.el.id = 'trafficPanel';
    this.el.className = 'hidden';
    this.el.setAttribute('role', 'dialog');
    document.getElementById('ui')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.x')) { this.toggle(false); return; }
      const go = t.closest<HTMLElement>('[data-jx]');
      if (go) { this.host.jump(Number(go.dataset.jx), Number(go.dataset.jy)); return; }
      const lim = t.closest<HTMLElement>('[data-lim]');
      if (lim) { this.host.limit(Number(lim.dataset.gx), Number(lim.dataset.gy), lim.dataset.lim === '1'); setTimeout(() => this.host.ask(), 250); }
    });
  }
  toggle(open = !this.open) {
    this.open = open;
    this.el.classList.toggle('hidden', !open);
    clearInterval(this.timer);
    if (open) { this.host.ask(); this.timer = window.setInterval(() => this.host.ask(), POLL_MS); this.render(); }
  }
  show(info: TrafficPanelInfo) { this.info = info; if (this.open) this.render(); }

  private render() {
    const i = this.info;
    if (!i) { this.el.innerHTML = `<div class="ph"><b>Traffic</b><button class="x" aria-label="Close">×</button></div><div class="tp-empty">loading…</div>`; return; }
    const total = Object.values(i.onRoad).reduce((a, b) => a + b, 0);
    const bar = Object.entries(i.onRoad).map(([k, n]) => (n ? `<i style="width:${(100 * n) / Math.max(1, total)}%;background:${KIND_COLOUR[k]}" title="${KIND_WORDS[k]}: ${n}"></i>` : '')).join('');
    const legend = Object.entries(i.onRoad).map(([k, n]) => `<span><em style="background:${KIND_COLOUR[k]}"></em>${KIND_WORDS[k]} <b>${n}</b></span>`).join('');
    const out = i.onRoad.visitors + i.onRoad.freight;
    const g = i.giveUps, gTotal = g.residents + g.visitors + g.freight + g.other;
    let html = `<div class="ph"><b>Traffic</b><span>${total} on the road now${total ? ` · ${Math.round((100 * out) / total)}% visitors and lorries` : ''}</span><button class="x" aria-label="Close">×</button></div>`;
    html += `<div class="tp-bar">${bar}</div><div class="tp-legend">${legend}</div>`;
    html += `<div class="tp-row"><span>In the last hour</span><span>${i.lastHour.visitors} visitors came in · ${i.lastHour.freight} lorries set off</span></div>`;
    html += `<div class="tp-row"><span>Gave up today</span><span>${gTotal ? `${g.residents} residents · ${g.visitors} visitors · ${g.freight} lorries${g.other ? ` · ${g.other} other` : ''}` : 'nobody'}</span></div>`;
    html += `<div class="tp-sect">Gateways <span>arrivals an hour, and visitors by road</span></div>`;
    html += i.gateways.length ? i.gateways.map((w) => `<div class="tp-gw">
        <span class="tp-name" data-jx="${w.x}" data-jy="${w.y}" title="go there">${esc(w.name.charAt(0).toUpperCase() + w.name.slice(1))}</span>
        <span>up to ${w.perHour}/h · ${w.arrivalsToday} moved in today${w.type === 'motorway' ? ` · ${w.visitorsToday} visitors today (${w.visitorsYesterday} yesterday)` : ''}</span>
        ${w.type === 'motorway' && w.mine ? `<button class="tp-lim${w.limit ? ' on' : ''}" data-lim="${w.limit ? 0 : 1}" data-gx="${w.x}" data-gy="${w.y}" title="${w.limit ? 'every visitor comes in again' : 'half the visitors come in here'}">${w.limit ? 'Visitor limit on · lift it' : `Limit visitors · about $${w.limitCost.toFixed(2)}/day`}</button>` : w.type === 'motorway' && w.limit ? '<span class="tp-on">visitor limit on</span>' : ''}
      </div>`).join('') : `<div class="tp-empty">No gateway yet: visitors come in at the town's farthest roads.</div>`;
    html += `<div class="tp-sect">Worst junctions <span>cars that gave up, since yesterday</span></div>`;
    html += i.junctions.length ? i.junctions.map((j, n) => `<div class="tp-link" data-jx="${j.x}" data-jy="${j.y}" title="go there"><b>${n + 1}</b> ${esc(j.name)} <span>${j.giveUps}</span></div>`).join('') : `<div class="tp-empty">Nobody has given up at a junction.</div>`;
    html += `<div class="tp-sect">Longest queues <span>cars held up now</span></div>`;
    html += i.streets.length ? i.streets.map((s, n) => `<div class="tp-link" data-jx="${s.x}" data-jy="${s.y}" title="go there"><b>${n + 1}</b> ${esc(s.name)} <span>${s.queued} queued${s.freightOrVisitors ? ` · ${s.freightOrVisitors} visitors or lorries` : ''}</span></div>`).join('') : `<div class="tp-empty">No queues right now.</div>`;
    html += `<div class="tp-foot">Street rules (HGV bans, 20 zones, bus lanes) and the visitor limit shape this load. With the congestion overlay on, hover a red road to see why it is slow.</div>`;
    this.el.innerHTML = html;
  }
}

function injectStyle() {
  const st = document.createElement('style');
  st.textContent = `
#trafficPanel { position: absolute; right: 12px; top: 56px; z-index: 6; width: min(360px, calc(100vw - 24px)); max-height: calc(100vh - 80px); overflow-y: auto; padding: 10px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px; backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); font-size: 12px; }
#trafficPanel.hidden { display: none; }
#trafficPanel .ph { display: flex; align-items: baseline; gap: 10px; margin: 0 2px 8px; }
#trafficPanel .ph b { font-size: 14px; } #trafficPanel .ph span { color: var(--muted); font-size: 11px; }
#trafficPanel .ph .x { margin-left: auto; border: 0; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }
#trafficPanel .tp-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: rgba(255,255,255,0.06); }
#trafficPanel .tp-bar i { display: block; height: 100%; }
#trafficPanel .tp-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 5px 0 6px; color: var(--muted); font-size: 11px; }
#trafficPanel .tp-legend em { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
#trafficPanel .tp-legend b { color: var(--fg); font-weight: 600; }
#trafficPanel .tp-row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
#trafficPanel .tp-row span:first-child { color: var(--muted); }
#trafficPanel .tp-sect { margin: 9px 0 3px; padding-top: 7px; border-top: 1px solid var(--line); font-weight: 600; }
#trafficPanel .tp-sect span { color: var(--muted); font-weight: 400; font-size: 11px; margin-left: 6px; }
#trafficPanel .tp-gw { display: grid; gap: 2px; padding: 4px 0; }
#trafficPanel .tp-gw span { color: var(--muted); }
#trafficPanel .tp-name, #trafficPanel .tp-link { cursor: pointer; }
#trafficPanel .tp-gw .tp-name { color: var(--fg); font-weight: 600; }
#trafficPanel .tp-link { display: flex; gap: 6px; padding: 3px 4px; border-radius: 6px; }
#trafficPanel .tp-link:hover, #trafficPanel .tp-name:hover { background: rgba(255,255,255,0.07); }
#trafficPanel .tp-link span { margin-left: auto; color: var(--muted); }
#trafficPanel .tp-lim { justify-self: start; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--line); background: rgba(255,255,255,0.05); color: var(--fg); font: inherit; cursor: pointer; }
#trafficPanel .tp-lim.on { border-color: rgba(242,194,48,0.6); background: rgba(242,194,48,0.12); }
#trafficPanel .tp-on { color: #f2c230 !important; }
#trafficPanel .tp-empty, #trafficPanel .tp-foot { color: var(--muted); padding: 2px 0; line-height: 1.35; }
#trafficPanel .tp-foot { margin-top: 8px; font-size: 11px; }
`;
  document.head.appendChild(st);
}
