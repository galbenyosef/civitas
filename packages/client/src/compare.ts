/**
 * Model comparison matrix (/compare.html): the building designs down the rows,
 * the design authors (the models that wrote them) across the columns, so the
 * output of different models on the same brief can be compared side by side.
 * Each cell is a thumbnail shot exactly as the viewer shoots them (same bench,
 * same light); click a cell to open that design in the building viewer.
 * Reads only compiled output (MANIFEST + recipes via models.ts); the Vite
 * catalogue plugin recompiles on change and HMR reloads this page.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, Vector3, PlaneGeometry, GridHelper, MeshLambertMaterial,
  ACESFilmicToneMapping,
} from 'three';
import { MANIFEST, CATALOGUE_HASH, type KindManifest, type LevelManifest, type DesignManifest } from '@msimcity/shared';
import { buildModels, allDesigns, type Design } from './render/models';
import { buildingMaterial, nightUniform } from './render/materials';
import { Lighting } from './render/lighting';
import { parkScatterGroup } from './render/parks';
import { landmarkPreview } from './render/landmarks';

// ---------------------------------------------------------------- catalogue entries

interface Entry { kind: KindManifest; level: LevelManifest; design: DesignManifest; built: Design }
buildModels();
const built = new Map(allDesigns().map((d) => [d.key, d]));
const entries: Entry[] = MANIFEST.flatMap((kind) => kind.levels.flatMap((level) => level.designs.map((design) => ({ kind, level, design, built: built.get(design.key)! }))));
const authorOf = (e: { design: { author?: string } }) => e.design.author ?? 'original';
/** columns: the models first (alphabetical), the original catalogue last */
const authors = [...new Set(entries.map(authorOf))].sort((a, b) => (a === 'original' ? 1 : b === 'original' ? -1 : a.localeCompare(b)));
/** metadata tags on kinds ('london', 'world', the city tags), for the Tag filter */
const TAGS = [...new Set(MANIFEST.flatMap((k) => k.tags ?? []))].sort();
const MODEL_ROW = (r: Row) => r.designs.some((e) => authorOf(e) !== 'original');

// ---------------------------------------------------------------- state (kept in the hash)

const state = { hour: 11, tag: 'all', scope: 'models' as 'models' | 'all', drafts: true };
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const q = new URLSearchParams(location.search); // ?tag=… also works, for shareable links
  if (p.get('h')) state.hour = Math.max(0, Math.min(24, Number(p.get('h')) || 11));
  if (p.get('scope') === 'all') state.scope = 'all';
  if (p.get('drafts') === '0') state.drafts = false;
  if (p.get('tag') || q.get('tag')) state.tag = (p.get('tag') || q.get('tag'))!;
}
function writeHash() {
  const p = new URLSearchParams({ h: String(state.hour), scope: state.scope });
  if (!state.drafts) p.set('drafts', '0');
  if (state.tag !== 'all') p.set('tag', state.tag);
  history.replaceState(null, '', '#' + p.toString());
}
readHash();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hh = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const spanOf = (k: KindManifest) => Math.max(k.footprint?.w ?? 1, k.footprint?.h ?? 1);

// ---------------------------------------------------------------- rows: one per building (kind × level)

interface Row { kind: KindManifest; level: LevelManifest; designs: Entry[] }
const rowsAll: Row[] = [];
{
  const byGroup = new Map<string, Row>();
  for (const e of entries) {
    const g = `${e.kind.kindId}:${e.level.level}`;
    let row = byGroup.get(g);
    if (!row) { row = { kind: e.kind, level: e.level, designs: [] }; byGroup.set(g, row); rowsAll.push(row); }
    row.designs.push(e);
  }
}
const visibleRows = () => rowsAll.filter((r) =>
  r.designs.some((e) => state.drafts || !e.design.draft) &&
  (state.scope === 'all' || MODEL_ROW(r)) &&
  (state.tag === 'all' || !!r.kind.tags?.includes(state.tag)));

// ---------------------------------------------------------------- thumbnails (one small offscreen renderer, re-shot when the light changes)

const thumbCanvas = document.createElement('canvas');
let thumbRenderer: WebGLRenderer | null = null;
try {
  thumbRenderer = new WebGLRenderer({ canvas: thumbCanvas, antialias: true, preserveDrawingBuffer: true });
  thumbRenderer.setSize(192, 192, false);
  thumbRenderer.toneMapping = ACESFilmicToneMapping;
  thumbRenderer.toneMappingExposure = 1.05;
} catch {
  // no WebGL (a VM, a remote desktop): the matrix still lists every design, just without pictures
}
const thumbScene = new Scene();
const MAT_DAY = 0x23453b, MAT_NIGHT = 0x10201c;
const benchMat = new MeshLambertMaterial({ color: MAT_DAY });
{
  const mat = new Mesh(new PlaneGeometry(40, 40).rotateX(-Math.PI / 2), benchMat);
  const grid = new GridHelper(40, 40, 0x4d8371, 0x3a6858);
  grid.position.y = 0.001;
  thumbScene.add(mat, grid);
}
const thumbLight = new Lighting(thumbScene);
thumbLight.mode = 'fixed';
thumbLight.setQuality(0);
const thumbCam = new PerspectiveCamera(32, 1, 0.05, 100);
const thumbMaterial = buildingMaterial();
const thumbs = new Map<string, string>(); // `${designKey}@${hour}` → data URL
let thumbJob = 0, pending = 0;
const target = new Vector3();

function shoot(list: Entry[], hour: number) {
  const job = ++thumbJob;
  pending = thumbRenderer ? list.length : 0;
  if (!thumbRenderer) { updateCount(); return; }
  const queue = [...list];
  const night = hour < 6.5 || hour > 18.5;
  const step = () => {
    if (job !== thumbJob) return;
    for (let n = 0; n < 6 && queue.length; n++) {
      const e = queue.shift()!;
      const cacheKey = `${e.design.key}@${hour}`;
      let url = thumbs.get(cacheKey);
      if (!url) {
        const m = new Mesh(e.built.geometry, thumbMaterial);
        thumbScene.add(m);
        const trees = parkScatterGroup(e.design.attrs);
        if (trees) thumbScene.add(trees);
        const parts = landmarkPreview(e.kind.kindId);
        if (parts) { parts.update(hour, nightUniform.value); thumbScene.add(parts.object); }
        const hgt = e.design.height, y = Math.min(hgt * 0.42, 1.6), dist = 1.75 * Math.max(1.2, hgt * 1.1 + 0.45, spanOf(e.kind) * 1.05 + 0.2);
        thumbCam.position.set(Math.sin(-0.6) * Math.cos(0.45) * dist, y + Math.sin(0.45) * dist, Math.cos(-0.6) * Math.cos(0.45) * dist);
        target.set(0, y, 0);
        thumbCam.lookAt(target);
        thumbLight.fixedHour = hour;
        thumbLight.update(hour, target, dist);
        thumbScene.background = thumbLight.sky;
        benchMat.color.set(night ? MAT_NIGHT : MAT_DAY);
        thumbRenderer.render(thumbScene, thumbCam);
        url = thumbCanvas.toDataURL('image/png');
        if (thumbs.size > 400) thumbs.clear(); // scrubbing the hour fills the cache; start over rather than grow without bound
        thumbs.set(cacheKey, url);
        thumbScene.remove(m);
        if (parts) thumbScene.remove(parts.object);
        if (trees) { thumbScene.remove(trees); trees.traverse((o) => (o as Mesh).geometry?.dispose()); }
      }
      const img = document.querySelector<HTMLImageElement>(`img[data-key="${e.design.key}"]`);
      if (img) img.src = url;
      pending--;
    }
    if (queue.length) setTimeout(step, 0);
    else if (job === thumbJob) updateCount();
  };
  step();
}
const shootVisible = () => shoot(visibleRows().flatMap((r) => r.designs), state.hour);

// ---------------------------------------------------------------- matrix

function renderToolbar() {
  const sel = $<HTMLSelectElement>('tag');
  sel.innerHTML = `<option value="all">Any</option>` + TAGS.map((t) => `<option value="${esc(t)}">${esc(cap(t))}</option>`).join('');
  sel.value = TAGS.includes(state.tag) ? state.tag : 'all';
  state.tag = sel.value;
  sel.onchange = () => { state.tag = sel.value; writeHash(); renderMatrix(); };
  $<HTMLSelectElement>('scope').value = state.scope;
  $<HTMLSelectElement>('scope').onchange = (ev) => { state.scope = (ev.target as HTMLSelectElement).value as 'models' | 'all'; writeHash(); renderMatrix(); };
  $<HTMLInputElement>('drafts').checked = state.drafts;
  $<HTMLInputElement>('drafts').onchange = (ev) => { state.drafts = (ev.target as HTMLInputElement).checked; writeHash(); renderMatrix(); };
}

function updateCount() {
  const rows = visibleRows();
  const cells = rows.reduce((a, r) => a + r.designs.length, 0);
  $('count').textContent = pending
    ? `shooting ${pending} thumbnails…`
    : `${rows.length} buildings × ${authors.length} authors · ${cells} designs · catalogue ${CATALOGUE_HASH}${thumbRenderer ? '' : ' · no WebGL: pictures off'}`;
}

function renderMatrix() {
  const rows = visibleRows();
  const table = $('mx');
  if (!rows.length) {
    table.innerHTML = '<tbody><tr><td class="empty">No buildings match these filters. Widen the row scope or pick another tag.</td></tr></tbody>';
    updateCount();
    return;
  }
  table.innerHTML = `
    <thead><tr>
      <th class="rowhead" scope="col">Building</th>
      ${authors.map((a) => `<th scope="col"><span class="n">${esc(a === 'original' ? 'original catalogue' : a)}</span><span class="c">${entries.filter((e) => authorOf(e) === a).length} designs</span></th>`).join('')}
    </tr></thead>
    <tbody>${rows.map((r) => {
      const multi = r.kind.levels.length > 1 || r.level.level > 1;
      const byAuthor = new Map<string, Entry[]>();
      for (const e of r.designs) { const a = authorOf(e); (byAuthor.get(a) ?? byAuthor.set(a, []).get(a)!).push(e); }
      return `<tr>
        <th class="rowhead" scope="row"><span class="kind">${esc(cap(r.kind.name))}</span>
          <span class="meta">${multi ? `level ${r.level.level} · ` : ''}${r.designs.length} design${r.designs.length === 1 ? '' : 's'}</span>
          <span class="tags">${(r.kind.tags ?? []).map((t) => `<span class="pill">${esc(t)}</span>`).join('')}${r.kind.landmark ? '<span class="pill">landmark</span>' : ''}</span>
        </th>
        ${authors.map((a) => {
          const list = byAuthor.get(a);
          if (!list || (!state.drafts && list.every((e) => e.design.draft))) return '<td class="none">—</td>';
          const e = list[0];
          return `<td class="cell"><a href="/viewer.html?d=${encodeURIComponent(e.design.key)}" title="${esc(cap(r.kind.name))} — ${esc(e.design.name)} (${e.design.height} tiles, ${e.built.geometry.attributes.position.count} vertices)">
            <img data-key="${e.design.key}" alt="${esc(e.design.name)}" src="" />
            <span class="dname">${esc(e.design.name)}</span>
            ${list.length > 1 ? `<span class="multi">×${list.length}</span>` : ''}${e.design.draft ? '<span class="dr">draft</span>' : ''}
          </a></td>`;
        }).join('')}
      </tr>`;
    }).join('')}</tbody>`;
  shootVisible();
}

// ---------------------------------------------------------------- hour

function setHour(h: number) {
  state.hour = Math.max(0, Math.min(24, h));
  $<HTMLInputElement>('hour').value = String(state.hour);
  $('hourVal').textContent = hh(state.hour);
  const night = state.hour < 6.5 || state.hour > 18.5;
  $('dayBtn').setAttribute('aria-pressed', String(!night));
  $('nightBtn').setAttribute('aria-pressed', String(night));
  writeHash();
  debounceShoot();
}
let shootTimer: ReturnType<typeof setTimeout> | undefined;
function debounceShoot() {
  clearTimeout(shootTimer);
  shootTimer = setTimeout(shootVisible, 250); // the matrix is all thumbnails: reshoot at the chosen hour, batched
}
$('dayBtn').onclick = () => setHour(11);
$('nightBtn').onclick = () => setHour(20.5);
$<HTMLInputElement>('hour').oninput = (ev) => setHour(Number((ev.target as HTMLInputElement).value));

renderToolbar();
setHour(state.hour);
renderMatrix();

/** For headless checks and the console. */
(window as unknown as { compare: object }).compare = {
  rows: () => visibleRows().map((r) => `${r.kind.kindId}:${r.level.level}`),
  authors: () => authors,
  setHour,
  thumbsReady: () => pending === 0,
};
