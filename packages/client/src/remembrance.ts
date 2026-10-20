import { TICKS_PER_DAY, TICKS_PER_HOUR, CAUSE_NOUN, CAUSE_DIED, KIND_NAMES, yearOfDay, type DeceasedInfo, type RemembranceInfo, type FamilyRef } from '@msimcity/shared';

/**
 * Death and remembrance in the panels (docs/remembrance.md): a headstone's panel (a deceased person: their dates, how they
 * died, where they rest, the funeral, the estate and the family tree, living relatives selectable and the dead openable),
 * a resting place's, funeral director's or mortuary's section in the building panel, and the dead a citizen mourns in
 * theirs. Living names carry data-cid (select the citizen), the dead data-did (open their headstone).
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const DAY = TICKS_PER_DAY, TPH = TICKS_PER_HOUR;
const when = (tick: number) => `day ${Math.floor(tick / DAY)}, ${String(Math.floor((tick % DAY) / TPH)).padStart(2, '0')}:${String(Math.floor(((tick % TPH) / TPH) * 60)).padStart(2, '0')}`;
const money = (n: number) => '$' + Math.round(n).toLocaleString();

/** One relative or friend: living ones select the citizen, the dead open their own panel. */
export function familyRow(f: FamilyRef): string {
  const attr = f.living ? `data-cid="${f.id}" title="click to select ${esc(f.name)}"` : `data-did="${f.id}" title="click to open ${esc(f.name)}'s headstone"`;
  return `<div class="person${f.living ? '' : ' dead'}" ${attr}><span class="pname">${f.living ? '' : '† '}${esc(f.name)}${f.age !== undefined ? ` <span class="page">${f.age}</span>` : ''}</span><span class="prel">${esc(f.relation)}${f.living ? '' : ' · remembered'}</span></div>`;
}

/** A deceased person's panel body (the headstone's inscription first). */
export function deceasedHtml(d: DeceasedInfo): string {
  const row = (k: string, v: string | number) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
  const born = yearOfDay(d.born), died = yearOfDay(d.died / DAY);
  let html = `<div class="stone"><div class="sname">${esc(d.name)}</div><div class="syears">${born} – ${died}</div><div class="sline">${d.state === 'cremated' ? 'Remembered here' : 'At rest'}</div></div>`;
  html += `<div class="sub">${esc(d.name.split(' ')[0])} ${esc(CAUSE_DIED[d.cause] ?? 'died')} at ${d.age}, ${esc(d.where)}</div>`;
  html += row('Died', when(d.died));
  html += row('Cause', esc(CAUSE_NOUN[d.cause] ?? '—'));
  html += row('Now', esc(d.stateText));
  if (d.rest) html += row('Resting place', `<span class="plink" data-goto="${d.rest.x},${d.rest.y}" title="go there">${esc(d.rest.name.replace(/^the /, ''))}</span>${d.rest.slot !== undefined ? ` · ${d.rest.kind && KIND_NAMES[d.rest.kind] === 'crematorium' ? 'plaque' : 'plot'} ${d.rest.slot + 1}` : ''}`);
  if (d.funeral) html += row(d.funeral.held ? 'Funeral' : 'Funeral planned', `${when(d.funeral.at)}${d.funeral.mourners ? ` · ${d.funeral.mourners} mourner${d.funeral.mourners === 1 ? '' : 's'}` : ''}`);
  if (d.estate) html += row('Estate', `${money(d.estate.left)}${d.estate.fees ? ` · ${money(d.estate.fees)} in fees` : ''}${d.estate.to.length ? ` · to ${esc(d.estate.to.join(', '))}` : ''}`);
  if (d.story !== undefined) html += row('In the news', `<span class="plink" data-story="${d.story}">the story</span>`);
  const fam = d.family.filter((f) => f.relation !== 'friend'), friends = d.family.filter((f) => f.relation === 'friend');
  html += `<div class="sect">Family (${fam.length})</div>`;
  html += fam.length ? fam.map(familyRow).join('') : `<div class="pempty">no family remembered</div>`;
  if (friends.length) html += `<div class="sect">Friends</div>${friends.map(familyRow).join('')}`;
  return html;
}

/** The building panel's remembrance lines: a resting place's plots and recent burials, a funeral director's work, a mortuary's dead. */
export function remembranceHtml(r: RemembranceInfo, row: (k: string, v: string | number) => string): string {
  const title = r.role === 'funeral' ? 'Funeral director' : r.role === 'cremation' ? 'Crematorium' : r.role === 'mortuary' ? 'Mortuary' : 'Burial ground';
  let html = `<div class="sect">${title}</div>`;
  if (r.plots) html += row(r.role === 'cremation' ? 'Memorial plaques' : 'Plots', `${r.plots.used} filled · ${r.plots.free} free${r.plots.booked ? ` · ${r.plots.booked} booked` : ''}${r.role === 'burial' && r.plots.free === 0 ? ' · <span class="bad">full</span>' : ''}`);
  if (r.fee) html += row(r.role === 'funeral' ? 'Fee per funeral' : r.role === 'cremation' ? 'Fee per cremation' : 'Fee per burial', `${money(r.fee)} (from the estate)`);
  if (r.waiting) html += row(r.role === 'funeral' ? 'In their care' : 'Waiting here', `${r.waiting}${r.noSpace ? ' · <span class="bad">no burial space in reach</span>' : ''}`);
  if (r.held !== undefined) html += row(r.role === 'funeral' ? 'Funerals arranged' : 'Funerals held', r.held);
  if (r.funerals?.length) html += `<div class="sect">Funerals planned</div>${r.funerals.map((f) => `<div class="person dead" data-did="${f.id}" title="open ${esc(f.name)}'s panel"><span class="pname">${esc(f.name)}</span><span class="prel">${when(f.at)}${r.role === 'funeral' && f.place ? ` · ${esc(f.place.replace(/^the /, ''))}` : ''}</span></div>`).join('')}`;
  if (r.recent?.length) html += `<div class="sect">${r.role === 'cremation' ? 'Recently remembered' : 'Recent burials'}</div>${r.recent.map((d) => `<div class="person dead" data-did="${d.id}" title="open the headstone"><span class="pname">† ${esc(d.name)} <span class="page">${d.age}</span></span><span class="prel">died ${yearOfDay(d.died / DAY)}</span></div>`).join('')}`;
  return html;
}

/** The dead a citizen mourns, for their panel. */
export function mourningHtml(list: FamilyRef[], grieving?: string): string {
  if (!list.length && !grieving) return '';
  return `<div class="sect">In memory${grieving ? ` · <span class="bad">${esc(grieving)}</span>` : ''}</div>${list.map(familyRow).join('')}`;
}
