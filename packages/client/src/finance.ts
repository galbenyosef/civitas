import { ECONOMY_TUNING, type PlayerDTO, type RecoverAction } from '@msimcity/shared';

/**
 * Money that can run out (docs/start-from-zero.md B3; the rules are the server's, server/src/sim/finance.ts): a chip in the
 * top bar beside the treasury while the player is overdrawn, in administration or has services mothballed, and the panel
 * it opens with the balance, the overdraft limit, the count of midnights below zero and the recovery plan, one button per
 * action (the `recover` message). In local mode the panel also offers to start again from the last autosave.
 * The panel opens by itself when administration begins.
 */
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export interface FinanceDeps {
  el: HTMLElement;
  btn: HTMLElement;
  send: (action: RecoverAction) => void;
  /** today's game day (the stats message), for days in administration */
  day: () => number;
  /** local mode only: load the newest autosave (the page reloads into it) */
  restart?: () => Promise<void>;
}

export class FinancePanel {
  private open = false;
  private me: PlayerDTO | undefined;
  private wasAdmin = false;
  /** the restart button asks once before replacing the city */
  private armed = false;
  /** the panel's four parts as last drawn */
  private drawn: string[] = [];

  constructor(private d: FinanceDeps) {
    d.btn.addEventListener('click', () => this.toggle());
    // one listener for the panel's buttons: the parts are redrawn as the figures change (render), the listener stays
    d.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      if (b.dataset.act) this.d.send(b.dataset.act as RecoverAction);
      else if (b.id === 'adminClose') this.toggle(false);
      else if (b.id === 'adminRestart') {
        if (!this.armed) { this.armed = true; this.render(); return; }
        this.armed = false;
        void this.d.restart?.();
      }
    });
  }

  get isOpen() { return this.open; }
  toggle(open?: boolean) {
    this.open = open ?? !this.open;
    this.armed = false;
    this.d.el.classList.toggle('hidden', !this.open);
    this.d.btn.classList.toggle('on', this.open);
    if (this.open) this.render();
  }

  /** The player changed (money, the players message): the chip, and the panel when it is open. */
  show(me: PlayerDTO | undefined) {
    this.me = me;
    const f = me?.fin;
    const btn = this.d.btn;
    btn.style.display = f ? '' : 'none';
    btn.classList.toggle('admin', f?.admin !== undefined);
    btn.classList.toggle('od', !!f && f.admin === undefined && me!.money < 0);
    if (f) {
      if (f.admin !== undefined) btn.textContent = 'in administration · the plan';
      else if (me!.money < 0) btn.textContent = `overdraft · ${f.days}/${f.after}`;
      else btn.textContent = `mothballed ${f.plan.mothballed}`;
      btn.title = f.admin !== undefined ? 'Your city is in administration: the recovery plan' : me!.money < 0 ? `On the overdraft: ${f.days} of ${f.after} midnights below zero before administration` : 'Services you mothballed';
    }
    const admin = f?.admin !== undefined;
    if (admin && !this.wasAdmin && !this.open) this.toggle(true); // administration has just begun: the plan comes up
    this.wasAdmin = admin;
    if (!f && this.open) this.toggle(false);
    else if (this.open) this.render();
  }

  private render() {
    const me = this.me, f = me?.fin;
    if (!me || !f) { this.d.el.innerHTML = ''; return; }
    const p = f.plan, admin = f.admin !== undefined;
    const days = admin ? Math.max(0, this.d.day() - f.admin!) : 0;
    const spend = Math.max(0, me.money + f.limit);
    const title = admin ? 'In administration' : me.money < 0 ? 'On the overdraft' : 'Mothballed services';
    const lead = admin
      ? 'Building, buying land, zoning, roads, research and new lines are stopped, and the regional grant is withdrawn: you pay all of your services\' staff wages. Administration ends at the first midnight the treasury is at zero or above.'
      : me.money < 0
        ? `You can keep spending down to ${money(-f.limit)}. At ${plural(f.after, 'midnight')} in a row below zero the city goes into administration: building stops and the regional grant is withdrawn.`
        : 'These services have no staff, cost no upkeep and give no cover until you reopen them.';
    const stat = (k: string, v: string, cls = '') => `<div class="fst ${cls}"><span>${k}</span><b>${v}</b></div>`;
    const head = `<div class="thead"><h2 class="${admin ? 'bad' : ''}">${title}</h2><span class="sub">${lead}</span><button class="chip" id="adminClose">✕</button></div>`;
    const stats = '<div class="fstats">'
      + stat('Treasury', money(me.money), me.money < 0 ? 'neg' : '')
      + stat('Overdraft limit', `${money(f.limit)}<small> · ${admin ? 'spending stopped' : `${money(spend)} left to spend`}</small>`)
      + stat('Interest', f.interest ? `${money(f.interest)}<small> a day</small>` : '<small>none above zero</small>', f.interest ? 'neg' : '')
      + (admin ? stat('In administration', `${plural(days, 'day')}<small> · since day ${f.admin}</small>`, 'neg') : stat('Midnights below zero', `${f.days}<small> of ${f.after}</small>`, f.days ? 'neg' : ''))
      + (me.money < 0 ? stat('Back to zero', money(-me.money)) : '')
      + '</div>';
    const card = (id: RecoverAction, name: string, body: string, gain: string, label: string, ok: boolean, extra = '') =>
      `<div class="fact ${ok ? '' : 'none'}"><div class="nhead"><b>${name}</b><span class="gain">${gain}</span></div><div class="blurb">${body}</div>${extra}
        <button class="pswitch" data-act="${id}" ${ok ? '' : 'disabled'}>${label}</button></div>`;
    let acts = '<div class="facts">';
    const rate = Math.round(p.taxRate * 100);
    acts += card('tax', 'Raise tax', p.taxParcels
      ? `Every parcel of yours below ${rate}% goes to ${rate}% (${plural(p.taxParcels, 'parcel')}). Residents and workers pay more; above ${rate}% workers start to look elsewhere.`
      : `Every parcel of yours is taxed at ${rate}% or more already.`,
    p.taxPerDay ? `about +${money(p.taxPerDay)} a day` : '', `Raise tax to ${rate}%`, p.taxParcels > 0);
    acts += card('sell', 'Sell land back', p.sellParcels
      ? `${plural(p.sellParcels, 'parcel')} with nothing built on ${p.sellParcels === 1 ? 'it' : 'them'} (${p.sellTiles} tiles) go back to the region at ${Math.round(ECONOMY_TUNING.landBuyback * 100)}% of the land price. Roads on them are taken up.`
      : 'Every parcel of yours has something built or being built on it.',
    p.sellCash ? `+${money(p.sellCash)} now` : '', p.sellCash ? `Sell for ${money(p.sellCash)}` : 'Nothing to sell', p.sellParcels > 0);
    acts += card('mothball', 'Mothball services', p.mothball
      ? `${plural(p.mothball, 'police, fire or health service', 'police, fire and health services')} close: staff let go, no upkeep, no cover for the homes round ${p.mothball === 1 ? 'it' : 'them'}. A builders' yard can be mothballed from its own panel.`
      : 'No open police, fire or health service of yours.',
    p.mothballPerDay ? `about ${money(p.mothballPerDay)} a day saved` : '', p.mothball ? `Mothball ${plural(p.mothball, 'service')}` : 'Nothing to mothball', p.mothball > 0,
    p.mothballed ? `<button class="pswitch alt" data-act="unmothball">Reopen ${plural(p.mothballed, 'mothballed building')}</button>` : '');
    acts += '</div>';
    let rest = '';
    if (this.d.restart && (admin || me.money < 0)) {
      rest = `<div class="frestart"><span>Or start again from the last autosave (this city is replaced; the autosaves are at most a minute old, so it may be overdrawn too).</span>
        <button class="pswitch alt" id="adminRestart">${this.armed ? 'Replace this city?' : 'Start again from the last autosave'}</button></div>`;
    }
    // each part is redrawn only when its own text changed, so the buttons stay put while the figures tick over
    if (!this.d.el.querySelector(':scope > .fpart')) { this.d.el.innerHTML = '<div class="fpart"></div>'.repeat(4); this.drawn = []; }
    const parts = this.d.el.querySelectorAll<HTMLElement>(':scope > .fpart');
    [head, stats, acts, rest].forEach((h, i) => { if (this.drawn[i] !== h) { this.drawn[i] = h; parts[i].innerHTML = h; } });
  }
}
