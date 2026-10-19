import {
  AD, AD_THEMES, AD_CLAIMS, AD_PALETTES, AD_ICONS, AD_LAYOUTS, AD_STRIDE, AD_SIZES, AD_SIZE, THEME_ICON,
  packLook, unpackLook, claimText, adHostAt, adSlotOpen, adSlotWorld, adWear, adAge, adSeed, wearWords, hasFeature, techFor, zoneOf, levelOf, Zone,
  type AdEnv, type AdSize, type AdTarget, type CampaignDTO, type PlayerDTO,
} from '@msimcity/shared';
import type { NetClient } from './net';
import type { ClientWorld } from './world';
import type { AdvertsView } from './render/adverts';

/**
 * The Campaigns panel (docs/adverts.md sections 3 and 4): the **ads** chip opens it once Advertising is unlocked. Make a
 * campaign (a theme, a claim from the table filled with one of your parcels' or workplaces' names, and a look), then put
 * it up: "pick frames" makes every free frame in view glow and a click on a building rents its free frame; "rent the 3
 * nearest" takes the free frames nearest the middle of the view. Each campaign shows its frames, what they cost a day and
 * the state of its posters. The server checks and charges everything (server sim/adverts.ts); this only shows and asks.
 */

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ICON_CHARS: Record<string, string> = { house: '⌂', coin: '$', star: '★', tree: '♣', clock: '◷', compass: '✦', heart: '♥', cap: '▲' };

export interface AdPanelDeps {
  net: NetClient;
  world: ClientWorld;
  view: AdvertsView;
  /** the name on a building's front (render/signs.ts), for workplace claims */
  nameAt(x: number, y: number): string | null;
  /** the ground point in the middle of the view */
  centre(): [number, number];
  /** fly the camera to look at a poster on a wall: its point, height and the way it faces */
  lookAt(x: number, y: number, height: number, dir: [number, number]): void;
  openTech(): void;
  toast(kind: 'info' | 'error', msg: string): void;
  liveTick(): number;
}

export class AdPanel {
  private open = false;
  private me: PlayerDTO | undefined;
  private draft = { theme: 1, claim: AD_CLAIMS.findIndex((c) => c.theme === 1), palette: 2, layout: 0, icon: THEME_ICON[1], target: 0, workplace: '' };
  /** the campaign whose frames clicks rent, while picking */
  private picking: number | null = null;
  private showForm = true;
  readonly env: AdEnv;

  constructor(private el: HTMLElement, private btn: HTMLElement, private d: AdPanelDeps) {
    this.env = { tile: (x, y) => d.world.getTile(x, y), aux: (x, y) => d.world.auxAt(x, y), sub: (x, y) => d.world.subAt(x, y) };
    d.view.open = (door, i) => { const h = adHostAt(this.env, door[0], door[1]); return !!h && adSlotOpen(this.env, h, i, door[0], door[1]); };
  }

  get isOpen() { return this.open; }
  get isPicking() { return this.picking !== null; }
  toggle(open?: boolean) {
    this.open = open ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    this.btn.classList.toggle('on', this.open);
    if (!this.open) this.pick(null);
    if (this.open) this.render();
  }

  /** The player changed (money, technology): the chip shows once Advertising is unlocked, or while its goal is up. */
  show(me: PlayerDTO | undefined, goalUp = false) {
    this.me = me;
    const unlocked = !!me && hasFeature(me.tech, 'adverts');
    this.btn.style.display = unlocked || goalUp ? '' : 'none';
    const mine = this.mine().length;
    this.btn.textContent = mine ? `ads ${mine}` : 'ads';
    if (this.open) this.render();
  }
  /** The campaigns or rentals changed (the `ads` message). */
  changed() {
    this.show(this.me, this.btn.style.display !== 'none');
    if (this.picking !== null && !this.d.view.campaign(this.picking)) this.pick(null);
  }

  private mine(): CampaignDTO[] {
    const out: CampaignDTO[] = [];
    for (const c of this.campaignsAll()) if (c.owner === this.d.world.me) out.push(c);
    return out;
  }
  private campaignsAll(): CampaignDTO[] { return this.d.view.campaignList(); }

  /** Start or stop picking frames for a campaign: free frames in view glow, and a click on a building rents one. */
  private pick(id: number | null) {
    this.picking = id;
    this.d.view.setPicking(id !== null);
    document.body.classList.toggle('adpick', id !== null);
    if (this.open) this.render();
  }

  /** A click on the map while picking: rent the building's first free frame there. Returns true when it took the click. */
  mapClick(x: number, y: number): boolean {
    if (this.picking === null) return false;
    const [dx, dy] = this.d.world.doorOf(x, y);
    const h = adHostAt(this.env, dx, dy);
    if (!h) { this.d.toast('info', 'No frame on that building: the glowing ones are free to rent'); return true; }
    for (let i = 0; i * AD_STRIDE < h.slots.length; i++) {
      if (this.d.view.rental(dx, dy, i) || !adSlotOpen(this.env, h, i, dx, dy)) continue;
      this.d.net.send({ t: 'adRent', campaign: this.picking, slots: [[dx, dy, i]] });
      return true;
    }
    this.d.toast('info', 'That frame is taken: pick a glowing one');
    return true;
  }

  /** The free frame nearest a point among the loaded chunks, or null. */
  nearestFree(px: number, py: number): { x: number; y: number; height: number; dir: [number, number] } | null {
    let best: { d: number; x: number; y: number; height: number; dir: [number, number] } | null = null;
    for (const items of this.d.view.allHosts()) for (const it of items) {
      const h = adHostAt(this.env, it.door[0], it.door[1]);
      if (!h || h.key !== it.key) continue;
      for (let i = 0; i * AD_STRIDE < h.slots.length; i++) {
        if (this.d.view.rental(it.door[0], it.door[1], i) || !adSlotOpen(this.env, h, i, it.door[0], it.door[1])) continue;
        const w = adSlotWorld(h, i), dd = Math.hypot(w.x - px, w.y - py);
        if (!best || dd < best.d) best = { d: dd, x: w.x, y: w.y, height: w.height, dir: w.dir };
      }
    }
    return best;
  }

  /** The goal's "show me": the tech tree while Advertising is locked, else this panel, and the camera on the nearest free frame. */
  showMe(near: [number, number] | null) {
    const me = this.d.world.myPlayer;
    if (me && !hasFeature(me.tech, 'adverts')) { this.d.openTech(); return; }
    this.toggle(true);
    const [cx, cy] = near ?? this.d.centre();
    const f = this.nearestFree(cx, cy) ?? this.nearestFree(...this.d.centre());
    if (f) this.d.lookAt(f.x, f.y, f.height, f.dir);
    if (this.mine().length) this.pick(this.mine()[0].id);
  }

  // ---- drawing --------------------------------------------------------------------------------------

  private myParcels() {
    return [...this.d.world.parcels.values()].filter((p) => p.owner === this.d.world.me || this.d.world.sandbox).slice(0, 40);
  }
  /** Workplaces on the player's land with a name on their front, for the "{building}" claims. */
  private myWorkplaces(): { name: string; x: number; y: number }[] {
    const out: { name: string; x: number; y: number }[] = [], seen = new Set<string>();
    for (const p of this.myParcels()) {
      for (let y = p.y; y < p.y + p.h && out.length < 16; y++) for (let x = p.x; x < p.x + p.w && out.length < 16; x++) {
        const t = this.d.world.getTile(x, y);
        if (t === undefined || levelOf(t) === 0) continue;
        const z = zoneOf(t);
        if (z !== Zone.Commercial && z !== Zone.Industrial && z !== Zone.Office) continue;
        const [dx, dy] = this.d.world.doorOf(x, y);
        const name = this.d.nameAt(dx, dy);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({ name, x: dx, y: dy });
      }
    }
    return out;
  }

  private draftText(): { text: string | null; target?: AdTarget } {
    const claim = AD_CLAIMS[this.draft.claim];
    if (claim.needs === 'place') {
      const p = this.myParcels()[this.draft.target];
      return p ? { text: claimText(this.draft.claim, { place: p.name }), target: { kind: 'parcel', id: p.id } } : { text: null };
    }
    if (claim.needs === 'building') {
      const w = this.myWorkplaces().find((b) => `${b.x},${b.y}` === this.draft.workplace) ?? this.myWorkplaces()[0];
      return w ? { text: claimText(this.draft.claim, { building: w.name }), target: { kind: 'building', id: 0, x: w.x, y: w.y } } : { text: null };
    }
    return { text: claimText(this.draft.claim, {}) };
  }

  private posterPreview(text: string, look: number, w: number, h: number): string {
    const { layout, icon, palette } = unpackLook(look), pal = AD_PALETTES[palette];
    const deco = layout === 1 ? `<i class="adband" style="background:${pal.accent}"></i>` : layout === 2 ? `<i class="adframe" style="border-color:${pal.accent}"></i>` : `<i class="adfoot" style="background:${pal.accent}"></i>`;
    return `<div class="adposter l${layout}" style="width:${w}px;height:${h}px;background:${pal.bg};color:${pal.ink}">${deco}<b class="adicon" style="color:${pal.accent}">${ICON_CHARS[AD_ICONS[icon]]}</b><span>${esc(text)}</span></div>`;
  }

  private render() {
    const me = this.me, d = this.d;
    if (!me) { this.el.innerHTML = ''; return; }
    const unlocked = hasFeature(me.tech, 'adverts');
    let html = `<div class="ahead"><h2>Campaigns</h2><button class="chip" id="adClose">✕</button></div>`;
    if (!unlocked) {
      html += `<p class="amuted">${esc(techFor('adverts')?.name ?? 'Advertising')} (tech tree, T) opens the empty frames on shops, bus shelters and building sites: rent them and put your own posters up.</p><button class="abtn" id="adTech">Open the tech tree</button>`;
      this.el.innerHTML = html;
      this.el.querySelector<HTMLButtonElement>('#adTech')!.onclick = () => d.openTech();
      this.el.querySelector<HTMLButtonElement>('#adClose')!.onclick = () => this.toggle(false);
      return;
    }
    const mine = this.mine();
    // ---- the new-campaign form
    const dr = this.draft;
    const { text } = this.draftText();
    const look = packLook(dr.layout, dr.icon, dr.palette);
    html += `<div class="aform${this.showForm ? '' : ' shut'}"><div class="asect" id="adFormToggle">${this.showForm ? '▾' : '▸'} New campaign <span class="amuted">${money(AD.campaignCost)} for the artwork</span></div>`;
    if (this.showForm) {
      html += `<div class="arow"><span class="alab">Theme</span>${AD_THEMES.map((t, i) => `<button class="achip${i === dr.theme ? ' on' : ''}" data-theme="${i}">${t}</button>`).join('')}</div>`;
      html += `<div class="arow col"><span class="alab">Says</span>${AD_CLAIMS.map((c, i) => c.theme === dr.theme ? `<label class="aclaim"><input type="radio" name="adclaim" value="${i}"${i === dr.claim ? ' checked' : ''}> ${esc(c.text)}</label>` : '').join('')}</div>`;
      const claim = AD_CLAIMS[dr.claim];
      if (claim.needs === 'place') {
        const ps = this.myParcels();
        html += `<div class="arow"><span class="alab">About</span>${ps.length ? `<select id="adTarget">${ps.map((p, i) => `<option value="${i}"${i === dr.target ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : '<span class="amuted">buy a parcel first</span>'}</div>`;
      } else if (claim.needs === 'building') {
        const ws = this.myWorkplaces();
        html += `<div class="arow"><span class="alab">About</span>${ws.length ? `<select id="adWork">${ws.map((b) => `<option value="${b.x},${b.y}"${`${b.x},${b.y}` === dr.workplace ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : '<span class="amuted">no named workplace on your land yet</span>'}</div>`;
      }
      html += `<div class="arow"><span class="alab">Colours</span>${AD_PALETTES.map((p, i) => `<button class="aswatch${i === dr.palette ? ' on' : ''}" data-pal="${i}" title="${p.name}" style="background:${p.bg};border-color:${p.accent}"></button>`).join('')}</div>`;
      html += `<div class="arow"><span class="alab">Layout</span>${AD_LAYOUTS.map((l, i) => `<button class="achip${i === dr.layout ? ' on' : ''}" data-layout="${i}">${l}</button>`).join('')}<span class="alab" style="margin-left:6px">Icon</span>${AD_ICONS.map((ic, i) => `<button class="achip ic${i === dr.icon ? ' on' : ''}" data-icon="${i}" title="${ic}">${ICON_CHARS[ic]}</button>`).join('')}</div>`;
      html += `<div class="aprev">${this.posterPreview(text ?? '…', look, 176, 88)}${this.posterPreview(text ?? '…', look, 66, 88)}</div>`;
      html += `<button class="abtn" id="adCreate"${text && mine.length < AD.maxCampaigns ? '' : ' disabled'}>${mine.length >= AD.maxCampaigns ? `${AD.maxCampaigns} campaigns at most` : `Create campaign (${money(AD.campaignCost)})`}</button>`;
    }
    html += '</div>';
    // ---- the player's campaigns
    const tick = d.liveTick();
    if (!mine.length) html += `<p class="amuted">No campaigns yet. Make one above, then rent frames for it: the glowing frames on shops, shelters and hoardings.</p>`;
    for (const c of mine) {
      const slots = this.slotsOf(c.id);
      const cost = slots.reduce((a, s) => a + AD_SIZE[s.size].rent, 0);
      const wears = slots.map((s) => s.wear);
      const worst = wears.length ? Math.max(...wears) : 0, mean = wears.length ? wears.reduce((a, b) => a + b, 0) / wears.length : 0;
      const picking = this.picking === c.id;
      html += `<div class="acamp${picking ? ' picking' : ''}">
        <div class="acrow">${this.posterPreview(c.text, c.look, 72, 36)}<div class="actext"><b>${esc(c.text)}</b><span class="amuted">${AD_THEMES[c.theme]} · since day ${c.created + 1}</span></div></div>
        <div class="acstats"><span><b>${slots.length}</b> frame${slots.length === 1 ? '' : 's'}</span><span><b>${money(cost)}</b> a day</span><span>${slots.length ? `posters <b>${wearWords(mean)}</b>${worst >= AD.wreckedAt ? ' <i class="bad">one needs replacing</i>' : ''}` : 'nothing up yet'}</span></div>
        ${slots.length ? `<div class="awear">${slots.slice(0, 24).map((s) => `<i title="${s.size}: ${wearWords(s.wear)}" style="--w:${Math.round(100 - s.wear * 100)}%"></i>`).join('')}</div>` : ''}
        <div class="abtns"><button class="achip${picking ? ' on' : ''}" data-pick="${c.id}">${picking ? 'Done picking' : 'Pick frames'}</button><button class="achip" data-near="${c.id}">Rent 3 nearest</button>${slots.length ? `<button class="achip" data-down="${c.id}">Take all down</button>` : ''}<button class="achip warn" data-drop="${c.id}">End</button></div>
        ${picking ? '<div class="ahint">Click a building with a glowing frame to rent it. Frames on your own frontage cost you nothing: the rent comes back to you.</div>' : ''}
      </div>`;
      void tick;
    }
    // ---- reach, honestly
    html += `<p class="areach"><b>Who's noticing?</b> Townsfolk walk past without taking much in for now: people will start to notice posters, and change their minds about where to live and work, in a coming update. Until then a campaign puts your name on the street, and frontage owners collect the rent.</p>`;
    this.el.innerHTML = html;
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelectorAll<T>(sel);
    this.el.querySelector<HTMLButtonElement>('#adClose')!.onclick = () => this.toggle(false);
    this.el.querySelector<HTMLElement>('#adFormToggle')!.onclick = () => { this.showForm = !this.showForm; this.render(); };
    q<HTMLButtonElement>('[data-theme]').forEach((b) => b.onclick = () => {
      dr.theme = Number(b.dataset.theme); dr.claim = AD_CLAIMS.findIndex((c) => c.theme === dr.theme); dr.icon = THEME_ICON[dr.theme]; this.render();
    });
    q<HTMLInputElement>('input[name=adclaim]').forEach((r) => r.onchange = () => { dr.claim = Number(r.value); this.render(); });
    q<HTMLButtonElement>('[data-pal]').forEach((b) => b.onclick = () => { dr.palette = Number(b.dataset.pal); this.render(); });
    q<HTMLButtonElement>('[data-layout]').forEach((b) => b.onclick = () => { dr.layout = Number(b.dataset.layout); this.render(); });
    q<HTMLButtonElement>('[data-icon]').forEach((b) => b.onclick = () => { dr.icon = Number(b.dataset.icon); this.render(); });
    const tsel = this.el.querySelector<HTMLSelectElement>('#adTarget');
    if (tsel) tsel.onchange = () => { dr.target = Number(tsel.value); this.render(); };
    const wsel = this.el.querySelector<HTMLSelectElement>('#adWork');
    if (wsel) wsel.onchange = () => { dr.workplace = wsel.value; this.render(); };
    const create = this.el.querySelector<HTMLButtonElement>('#adCreate');
    if (create) create.onclick = () => {
      const t = this.draftText();
      if (!t.text) return;
      d.net.send({ t: 'adCampaign', theme: dr.theme, claim: dr.claim, look: packLook(dr.layout, dr.icon, dr.palette), ...(t.target ? { target: t.target } : {}) });
      this.showForm = false;
    };
    q<HTMLButtonElement>('[data-pick]').forEach((b) => b.onclick = () => { const id = Number(b.dataset.pick); this.pick(this.picking === id ? null : id); });
    q<HTMLButtonElement>('[data-near]').forEach((b) => b.onclick = () => { const [x, y] = d.centre(); d.net.send({ t: 'adRent', campaign: Number(b.dataset.near), near: { x, y, n: 3 } }); });
    q<HTMLButtonElement>('[data-down]').forEach((b) => b.onclick = () => d.net.send({ t: 'adEnd', campaign: Number(b.dataset.down) }));
    q<HTMLButtonElement>('[data-drop]').forEach((b) => b.onclick = () => { if (confirm('End this campaign? Its posters come down.')) d.net.send({ t: 'adEnd', campaign: Number(b.dataset.drop), drop: true }); });
  }

  /** A campaign's rented frames with their size and wear now. */
  private slotsOf(id: number): { size: AdSize; wear: number }[] {
    const out: { size: AdSize; wear: number }[] = [];
    const tick = this.d.liveTick();
    for (const [k, r] of this.d.view.rentalEntries()) {
      if (r.campaign !== id) continue;
      const m = /^(-?\d+),(-?\d+)#(\d+)$/.exec(k)!;
      const x = Number(m[1]), y = Number(m[2]), i = Number(m[3]);
      out.push({ size: AD_SIZES[r.size] ?? 'poster', wear: adWear(adAge(r.age, r.rate, r.at, tick), adSeed(x, y, i, id)) });
    }
    return out;
  }
}
