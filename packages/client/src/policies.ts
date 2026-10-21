import { POLICIES, POLICY_BY_ID, hasFeature, hasPolicy, techFor, TECH_BY_ID, spendableMoney, type PlayerDTO, type PolicyDef, type PolicyId } from '@msimcity/shared';

/**
 * The Policies panel (docs/education.md section 16), laid out like the tech tree: a card for each policy (education's,
 * and since R5 transport's lorry curfew, docs/roads.md "Traffic control")
 * with its running cost, its effects and a switch. A policy is opened by a node of the Education track (shared
 * policies.ts names the feature, tech.ts the node), costs a one-off fee to enact, and is charged daily on the schools
 * in the player's parcels. The server validates the switch (server/src/policies.ts); this panel only shows the state and
 * sends `setPolicy`. Opened by the policies chip, which has no key: every letter is a tool, camera or panel key.
 */
const money = (n: number) => '$' + Math.round(n).toLocaleString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class PolicyPanel {
  private open = false;
  private me: PlayerDTO | undefined;
  /** `dev`: a ?dev client on a dev server may switch on policies whose effect is not built yet */
  constructor(private el: HTMLElement, private btn: HTMLElement, private send: (id: PolicyId, on: boolean) => void, private dev = false) {}

  get isOpen() { return this.open; }
  toggle(open?: boolean) {
    this.open = open ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    this.btn.classList.toggle('on', this.open);
    if (this.open) this.render();
  }

  /** The player changed (money, technology, switches): refresh the chip, and the panel when it is open. */
  show(me: PlayerDTO | undefined) {
    this.me = me;
    // the chip appears with the first technology that opens a policy (Secondary education)
    this.btn.style.display = me && POLICIES.some((p) => hasFeature(me.tech, p.feature)) ? '' : 'none';
    const on = me?.policies?.length ?? 0;
    this.btn.textContent = on ? `policies ${on}` : 'policies';
    if (this.open) this.render();
  }

  private card(p: PolicyDef, me: PlayerDTO): string {
    const unlocked = hasFeature(me.tech, p.feature), on = hasPolicy(me.policies, p.id);
    const blocked = !p.live && !this.dev; // its effect is built by a later phase: shown, but not for sale
    const need = unlocked ? '' : `needs ${esc(techFor(p.feature)?.name ?? TECH_BY_ID.get(p.feature)?.name ?? 'more technology')}`;
    const afford = spendableMoney(me.money, me.devUnlimited) >= p.setup, admin = me.fin?.admin !== undefined; // the overdraft counts (server sim/finance.ts)
    const state = on ? 'have' : unlocked && !blocked && afford && !admin ? 'ready' : 'locked';
    let action: string;
    if (on) action = `<button class="pswitch off" data-id="${p.id}" data-on="0">Switch off</button>`;
    else if (!unlocked) action = `<button class="pswitch" disabled>Locked</button>`;
    else if (blocked) action = `<button class="pswitch" disabled>Effect still to come</button>`;
    else if (admin) action = `<button class="pswitch" disabled>In administration</button>`;
    else if (!afford) action = `<button class="pswitch" disabled>Need ${money(p.setup)}</button>`;
    else action = `<button class="pswitch" data-id="${p.id}" data-on="1">Enact for ${money(p.setup)}</button>`;
    return `<div class="node ${state}" data-policy="${p.id}">
      <div class="nhead"><b>${esc(p.name)}</b><span class="cost">${on ? 'in force' : unlocked ? 'off' : 'locked'}</span></div>
      <div class="blurb">${esc(p.blurb)}</div>
      <div class="runs"><span>Runs at</span> ${esc(p.runs)}</div>
      <ul class="effects">${p.effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      ${need ? `<div class="cond">${need}</div>` : ''}
      ${action}
    </div>`;
  }

  private render() {
    const me = this.me;
    if (!me) { this.el.innerHTML = ''; return; }
    let html = `<div class="thead"><h2>Policies</h2><span class="sub">Each is opened by a technology, paid for once to enact and then charged every game day. Treasury ${money(me.money)}.</span><button class="chip" id="policiesClose">✕</button></div>`;
    // education (the schools on your land), then transport (R5: the lorry curfew on your streets)
    for (const [grp, title] of [['education', 'Education'], ['transport', 'Transport']] as const) {
      const list = POLICIES.filter((p) => (p.group ?? 'education') === grp);
      if (!list.length) continue;
      html += `<div class="sub" style="margin:8px 0 4px;font-weight:600">${title}</div><div class="tracks pols">`;
      for (const p of list) html += this.card(p, me);
      html += '</div>';
    }
    this.el.innerHTML = html;
    this.el.querySelectorAll<HTMLButtonElement>('button.pswitch[data-id]').forEach((b) => {
      b.onclick = () => { const def = POLICY_BY_ID.get(b.dataset.id!); if (def) this.send(def.id, b.dataset.on === '1'); };
    });
    document.getElementById('policiesClose')!.onclick = () => this.toggle(false);
  }
}
