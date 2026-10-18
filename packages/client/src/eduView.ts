import {
  EDU_LEVEL_NAMES, EDU_TRACK_NAMES, EDU_RESULT_NAMES, STUDY_NAMES, EduResult, Study, yearGroupName,
  type SchoolInfo, type CitizenEducation, type ParcelStats,
} from '@msimcity/shared';

/**
 * Education in the panels (docs/education.md section 14): the school's tooltip block, the citizen's timeline and the
 * parcel's attainment rows. Only builds HTML; ui.ts and mapmode.ts place it.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const row = (k: string, v: string | number, title = '') => `<div class="row"${title ? ` title="${esc(title)}"` : ''}><span>${k}</span><span>${v}</span></div>`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
/** a thin bar, `tone` good / fair / poor by the share filled (or a fixed one) */
const meter = (frac: number, tone: 'good' | 'fair' | 'poor' = frac >= 0.7 ? 'good' : frac >= 0.4 ? 'fair' : 'poor') =>
  `<div class="bar edu-meter ${tone}"><i style="width:${Math.round(100 * Math.max(0, Math.min(1, frac)))}%"></i></div>`;

/** The school block of a building's tooltip and panel (BuildingInfo.school). */
export function schoolHtml(s: SchoolInfo): string {
  const uni = s.stage >= Study.Degree, who = uni ? 'Students' : 'Pupils';
  const short = s.teachers < s.teachersNeeded;
  let h = `<div class="sect">${cap(STUDY_NAMES[s.stage] ?? 'school')}</div>`;
  h += row(who, `${s.pupils} / ${s.places}`) + meter(s.places ? s.pupils / s.places : 0, 'good');
  if (s.pupils) h += row('In class now', s.present);
  if (s.admitting < s.places) h += row('Taking', `<span class="${short ? 'bad' : ''}">${s.admitting} of ${s.places} places</span>`, 'A school admits in proportion to the teachers it has');
  h += row(uni ? 'Lecturers with a degree' : 'Teachers with a degree', `<span class="${short ? 'bad' : ''}">${s.teachers} / ${s.teachersNeeded}</span>`);
  if (s.postgradsNeeded) h += row('Postgraduate staff', `<span class="${(s.postgrads ?? 0) < s.postgradsNeeded ? 'bad' : ''}">${s.postgrads ?? 0} / ${s.postgradsNeeded}</span>`);
  h += row('Catchment', s.catchment > 0 ? `${s.catchment} tiles from home` : 'the whole city');
  h += row(uni ? 'Lectures' : 'School day', uni ? `from ${hm(s.hours[0])}` : `${hm(s.hours[0])}–${hm(s.hours[1])}`);
  h += row('Quality', `${Math.round(100 * s.quality)}%`, 'Pass chances are multiplied by this: it falls when the school is short of teachers') + meter((s.quality - 0.5) / 0.5);
  if (s.passed || s.failed || s.droppedOut) h += row('Results this year', `${s.passed} passed · ${s.failed} failed${s.droppedOut ? ` · ${s.droppedOut} left` : ''}`);
  if (s.waiting) h += row('Waiting for a place', `<span class="bad">${s.waiting}</span>`, 'Children of this stage whose nearest school is full, or who have none within reach');
  return h;
}

/** The citizen's education: level, then their path so far as a timeline, ending at the stage they are in now. */
export function educationHtml(ed: CitizenEducation): string {
  let h = row('Education', esc(`${EDU_LEVEL_NAMES[ed.level] ?? ''}${ed.track ? ` · ${EDU_TRACK_NAMES[ed.track]}` : ''}`));
  const st = ed.studying;
  const steps: string[] = [];
  if (ed.nursery && !ed.history.some((e) => e.stage === Study.Nursery)) steps.push(step('done', 'Nursery', '', 'attended'));
  for (const e of ed.history) {
    const tone = e.result === EduResult.Passed ? 'done' : e.result === EduResult.Left ? 'left' : 'failed';
    const when = `week ${e.week}`;
    steps.push(step(tone, cap(STUDY_NAMES[e.stage] ?? ''), e.place, `${EDU_RESULT_NAMES[e.result] ?? ''} · ${when}`));
  }
  if (st) {
    const what = `${cap(STUDY_NAMES[st.stage] ?? '')}${st.yearGroup !== undefined ? `, ${yearGroupName(st.yearGroup)}` : ''}`;
    steps.push(step('now', what, st.place.name, `${Math.round(100 * st.attendance)}% attendance`, st.progress));
  }
  if (ed.droppedOut && !st) steps.push(step('failed', 'Left education', '', 'dropped out'));
  if (steps.length) h += `<div class="sect">School and college</div><div class="edutl">${steps.join('')}</div>`;
  return h;
}
/** an unnamed school is called "nursery at (-12, -17)": the kind says nothing the step's heading has not, so keep the tile */
const placeName = (p: string) => p.replace(/^[^(]*?\bat\s+(?=\()/, '');
function step(tone: string, what: string, place: string, note: string, progress?: number): string {
  place = placeName(place);
  return `<div class="edustep ${tone}"><i class="dot"></i><div class="edubody"><div><b>${esc(what)}</b>${place ? ` <span>at ${esc(place)}</span>` : ''}</div>`
    + `<div class="edunote">${esc(note)}</div>${progress !== undefined ? meter(progress, 'good') : ''}</div></div>`;
}

/** What a parcel's education figures say: the index with a word for it. */
export function eduIndexLabel(index: number): string {
  return index >= 75 ? 'highly qualified' : index >= 60 ? 'well qualified' : index >= 45 ? 'mixed' : 'few qualifications';
}
/** Education rows for a set of parcels (the world map's panel sums an estate): pupils, places, graduates and the index weighted by residents aged 25-64. */
export function eduTotals(list: readonly { stats: ParcelStats }[]) {
  let pupils = 0, places = 0, grads = 0, n = 0, sum = 0;
  for (const { stats: s } of list) {
    pupils += s.pupils ?? 0; places += s.places ?? 0; grads += s.grads ?? 0;
    n += s.eduN ?? 0; sum += (s.eduIndex ?? 0) * (s.eduN ?? 0);
  }
  return { pupils, places, grads, n, index: n ? Math.round(sum / n) : 0 };
}
