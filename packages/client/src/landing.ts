import './landing.css';
import { apiBase, serverConfig } from './serverApi';
import type { DemoInfo } from './tour'; // a type: nothing of the game is loaded for it
import type { ServerConfig } from '@msimcity/shared';
import reelManifest from './showreel/manifest.json'; // names and captions, written by scripts/showreel.mjs beside the files

/**
 * The home page (docs/demo.md, "The home page"): plain DOM, no WebGL, and nothing of the game loaded (entry.ts imports this OR main.ts).
 * Three ways in, read from the server it is served by:
 *   Explore  one card per demo city in GET /api/demos (so a city added to DEMOS appears with no change here), live status and fill
 *   Play     the offline build at /play/ (cfg.play), or ?local on a build that has none; "Continue" when this browser holds a save
 *   Showreel  a strip of pre-rendered building thumbnails, three short clips of the Showcase and three lines on how it plays (below, "Showreel")
 *   Multiplayer  GET /api/servers (packages/server/servers.json), and on a server that is not a read-only showcase its own live world
 * Server-supplied text is only ever set as text, never as markup.
 */

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string | boolean> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (v === true) e.setAttribute(k, ''); else if (v !== false) e.setAttribute(k, v); }
  for (const c of kids) if (c) e.append(c);
  return e;
}
const safeUrl = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
const API = apiBase();
const sameOrigin = new URL(API, location.href).origin === location.origin;

// ---- Explore --------------------------------------------------------------------------------------------------------------

/** pictures dropped into src/heroes/<demo id>.<ext> are found by the build; DemoDef.hero (through the demo list) wins */
const heroFiles = import.meta.glob('./heroes/*.{webp,jpg,jpeg,png,svg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
function heroUrl(d: DemoInfo): string {
  if (d.hero && (safeUrl(d.hero) || d.hero.startsWith('/') || d.hero.startsWith('data:image/'))) return d.hero;
  return Object.entries(heroFiles).find(([k]) => k.split('/').pop()!.replace(/\.[a-z]+$/, '') === d.id)?.[1] ?? '';
}

/** a placeholder picture: a sky and a skyline drawn from the id, so each city is its own colours and the same every visit */
function placeholder(id: string): SVGSVGElement {
  let x = 2166136261;
  for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619);
  const rnd = () => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hue = Math.floor(rnd() * 360);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 160 90'); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice'); svg.setAttribute('aria-hidden', 'true');
  let body = `<defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 40% 20%)"/><stop offset="1" stop-color="hsl(${(hue + 35) % 360} 55% 46%)"/></linearGradient></defs><rect width="160" height="90" fill="url(#g${id})"/>`;
  body += `<circle cx="${20 + rnd() * 120}" cy="${16 + rnd() * 18}" r="${5 + rnd() * 4}" fill="hsl(${(hue + 50) % 360} 80% 85%)" opacity=".8"/>`;
  for (const [layer, lum, lo, hi] of [[0, 16, 24, 52], [1, 9, 14, 40]] as const) {
    for (let px = -4; px < 164;) {
      const w = 6 + rnd() * 12, hgt = lo + rnd() * (hi - lo);
      body += `<rect x="${px.toFixed(1)}" y="${(90 - hgt).toFixed(1)}" width="${w.toFixed(1)}" height="${hgt.toFixed(1)}" fill="hsl(${hue} 28% ${lum}%)"/>`;
      if (layer === 1) for (let k = 0; k < 3; k++) if (rnd() < 0.5) body += `<rect x="${(px + 1.5 + rnd() * (w - 4)).toFixed(1)}" y="${(90 - hgt + 3 + rnd() * (hgt - 8)).toFixed(1)}" width="1.6" height="2" fill="hsl(48 90% 70%)" opacity=".75"/>`;
      px += w + (layer === 0 ? 0 : rnd() * 3);
    }
  }
  svg.innerHTML = body; // only numbers and the id's hash are in it
  return svg;
}

const statusOf = (d: DemoInfo, all: DemoInfo[]): { text: string; cls: string; pct?: number } => {
  if (d.status === 'running') return { text: `Open · ${(d.citizens ?? 0).toLocaleString()} people${d.clients ? ` · ${d.clients} here now` : ''}`, cls: 'ok' };
  if (d.status === 'starting') return d.fill !== undefined ? { text: `Building ${d.name}… ${Math.round(d.fill * 100)}%`, cls: 'busy', pct: d.fill } : { text: `${d.saved && d.saveCurrent !== false ? 'Starting' : 'Building'} ${d.name}…`, cls: 'busy' };
  if (d.status === 'resetting') return { text: 'Resetting…', cls: 'busy' };
  if (d.status === 'stopping') return { text: 'Stopping…', cls: 'busy' };
  if (d.error) return { text: 'Could not start', cls: 'bad' };
  if ((d.queue ?? -1) > 0) return { text: `Queued after ${all.find((o) => o.queue === d.queue! - 1)?.name ?? 'the others'}`, cls: 'busy' }; // the server is building its cities one at a time
  return { text: d.saved && d.saveCurrent !== false ? 'Open · wakes in a few seconds' : 'Not built yet · about a minute to build', cls: '' };
};

interface Card { root: HTMLElement; status: HTMLElement; bar: HTMLElement; fill: HTMLElement }
const cards = new Map<string, Card>();

function paint(d: DemoInfo, all: DemoInfo[]) {
  const c = cards.get(d.id);
  if (!c) return;
  const s = statusOf(d, all);
  c.status.textContent = s.text;
  c.status.className = `status ${s.cls}`;
  c.bar.hidden = s.pct === undefined;
  c.fill.style.width = `${Math.round((s.pct ?? 0) * 100)}%`;
  c.root.title = d.error ?? '';
}

function demoCard(d: DemoInfo, spectate: boolean, tag: string): HTMLElement {
  const url = heroUrl(d);
  const art = h('div', { class: 'art' }, url ? h('img', { src: url, alt: '', loading: 'lazy' }) : placeholder(d.id), h('span', { class: 'tag' }, tag));
  const status = h('div', { class: 'status' });
  const fill = h('i');
  const bar = h('div', { class: 'bar', hidden: true }, fill);
  const open = h('a', { class: 'btn pri', href: `?demo=${encodeURIComponent(d.id)}` }, 'Open');
  const root = h('article', { class: 'card', 'data-demo': d.id }, art,
    h('div', { class: 'body' },
      h('h3', {}, d.name),
      h('p', { class: 'blurb', title: d.blurb }, d.blurb),
      h('p', { class: 'dim' }, spectate ? 'Read-only: look around, ride along, take the tour.' : 'A sandbox with a guided tour. Reset puts it back as it was.'),
      status, bar, open));
  cards.set(d.id, { root, status, bar, fill });
  return root;
}

function demoRow(d: DemoInfo): HTMLElement {
  const status = h('span', { class: 'status' });
  const fill = h('i');
  const bar = h('span', { class: 'bar', hidden: true }, fill);
  const root = h('li', {}, h('a', { href: `?demo=${encodeURIComponent(d.id)}` }, d.name), h('span', { class: 'dim' }, ` ${d.blurb}`), status, bar);
  cards.set(d.id, { root, status, bar, fill });
  return root;
}

async function explore(root: HTMLElement, cfg: ServerConfig) {
  const grid = h('div', { class: 'cards' });
  const more = h('ul', { class: 'rows' });
  const moreBox = h('details', { class: 'fold', hidden: true }, h('summary', {}, 'Focused demos'), h('p', { class: 'dim' }, 'Small maps that show one thing at a time: rail, schools, power, fire.'), more);
  const note = h('p', { class: 'dim' }, 'Loading the cities…');
  root.append(note, grid, moreBox);
  let ok = false;
  const tick = async () => {
    let list: DemoInfo[] | null = null;
    try {
      const r = await fetch(`${API}/api/demos`, { cache: 'no-store' });
      const j = r.ok ? await r.json() as { available?: boolean; demos?: DemoInfo[] } : null;
      list = j?.available && j.demos ? j.demos : [];
    } catch { /* the server is away: say so below, keep trying */ }
    if (!list) { if (!ok) note.textContent = 'This page could not reach a game server, so there are no cities to list. The offline game below still works.'; return; }
    ok = true;
    note.textContent = list.length ? '' : 'This server runs no demo cities.';
    for (const d of list) {
      if (!cards.has(d.id)) {
        if (d.town) grid.append(demoCard(d, !!cfg.spectate, 'sample city'));
        else if (d.id === 'showcase') grid.append(demoCard(d, !!cfg.spectate, 'guided tour'));
        else { more.append(demoRow(d)); moreBox.hidden = false; }
      }
      paint(d, list);
    }
    // cities first, then the showcase: the grid keeps the server's order within each
    [...grid.children].sort((a, b) => Number(!(a as HTMLElement).querySelector('.tag')?.textContent?.startsWith('sample')) - Number(!(b as HTMLElement).querySelector('.tag')?.textContent?.startsWith('sample'))).forEach((c) => grid.append(c));
  };
  await tick();
  setInterval(() => { if (!document.hidden) void tick(); }, 2500);
}

// ---- Showreel -------------------------------------------------------------------------------------------------------------

/**
 * The strip between the intro and Explore (docs/demo.md, "Showreel"): ten building thumbnails, three clips of the Showcase and the three ways to play. All of it is
 * made ahead of time by scripts/showreel.mjs and lives in src/showreel/ as hashed assets, so the page stays free of WebGL. Thumbnails are lazy images; a clip gets
 * its src only when it scrolls into view and pauses when it leaves; with prefers-reduced-motion the clips stay as their poster.
 */
const reelFiles = import.meta.glob('./showreel/*.{webp,webm}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const reelUrl = (file: string) => reelFiles[`./showreel/${file}`] ?? '';

/** small line icons, constant markup (nothing from the server is in them) */
const ICONS: Record<string, string> = {
  zone: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/><path d="M5.5 9.5 7.5 7.5l2 2M14 20v-5h4v5M16 13l-3 2.5h6z" stroke-linejoin="round"/>',
  roads: '<path d="M4 21 11 3M20 21 13 3M3 12h18"/><path d="M7.5 21.5h9" stroke-dasharray="2 2"/>',
  watch: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
function icon(name: keyof typeof ICONS): HTMLElement {
  const wrap = h('span', { class: 'ico', 'aria-hidden': 'true' });
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">${ICONS[name]}</svg>`;
  return wrap;
}

const PLAYSTYLES: { icon: keyof typeof ICONS; title: string; text: string }[] = [
  { icon: 'zone', title: 'Buy and zone', text: 'Buy land, zone it for homes, shops, works and offices, and builders turn up to put them up.' },
  { icon: 'roads', title: 'Lay the city\'s bones', text: 'Roads of six classes, junctions, rail, tube, buses, river boats and power, all on the same map.' },
  { icon: 'watch', title: 'Watch it live and tune it', text: 'Follow a citizen, ride a bus in first person, read the overlays and the Traffic panel, set street rules, take the tour.' },
];

/** runs `fn` once the page has loaded and the browser is idle (at the latest two seconds after) */
function afterLoad(fn: () => void) {
  const go = () => { if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 2000 }); else setTimeout(fn, 500); };
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}

/** the heading now, the pictures after the page's first paint: the body holds its place (landing.css) so Explore does not jump, and nothing of the strip is built or fetched in the first frame's way */
function showreel(): HTMLElement {
  const body = h('div', { class: 'reel-body' });
  const sec = h('section', { id: 'showreel', class: 'reel' }, h('h2', {}, 'A small city builder with a big simulation'),
    h('p', { class: 'sub' }, 'Every picture here is the game itself: the models from the building viewer, and the Showcase running.'), body);
  requestAnimationFrame(() => setTimeout(() => fillShowreel(body), 0)); // the frame after this one is the first paint
  return sec;
}

function fillShowreel(sec: HTMLElement) {

  const thumbs = h('ul', { class: 'thumbs' });
  for (const t of reelManifest.thumbs) {
    const src = reelUrl(`t-${t.name}.webp`);
    if (src) thumbs.append(h('li', {}, h('figure', {}, h('img', { src, alt: t.caption, width: '160', height: '160', loading: 'lazy', decoding: 'async', fetchpriority: 'low' }), h('figcaption', {}, t.caption))));
  }
  if (thumbs.childElementCount) sec.append(thumbs);

  // a clip starts as its poster, a plain image: a <video> element is slow to create, so none exists until the card scrolls into view
  const clips = h('div', { class: 'clips' });
  const cards: { box: HTMLElement; src: string; poster: string; label: string }[] = [];
  for (const c of reelManifest.clips) {
    const src = reelUrl(`c-${c.name}.webm`), poster = reelUrl(`c-${c.name}.webp`);
    if (!src) continue;
    const box = h('div', { class: 'clip' }, poster ? h('img', { src: poster, alt: c.caption, width: '640', height: '360', loading: 'lazy', decoding: 'async', fetchpriority: 'low' }) : null);
    cards.push({ box, src, poster, label: c.caption });
    clips.append(h('figure', {}, box, h('figcaption', {}, c.caption)));
  }
  if (cards.length) {
    sec.append(clips);
    // a clip is fetched when its card comes into view, plays while it is in view and pauses when it leaves; reduced motion keeps the poster and never fetches it.
    // Nothing is watched until the page has loaded and gone idle, so the clips never compete with the page's own first paint
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) afterLoad(() => {
      const videos = new Map<Element, HTMLVideoElement>();
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          let v = videos.get(e.target);
          if (e.isIntersecting) {
            if (!v) {
              const card = cards.find((c) => c.box === e.target)!;
              v = h('video', { muted: true, loop: true, playsinline: true, preload: 'none', 'aria-label': card.label, width: '960', height: '540', ...(card.poster ? { poster: card.poster } : {}) });
              v.muted = true; // the attribute alone is not always enough for autoplay
              v.src = card.src;
              videos.set(e.target, v);
              card.box.append(v);
            }
            void v.play().catch(() => { /* autoplay refused: the poster stays */ });
          } else v?.pause();
        }
      }, { rootMargin: '120px', threshold: 0.25 });
      for (const c of cards) io.observe(c.box);
    });
  }

  const how = h('ul', { class: 'how' });
  for (const p of PLAYSTYLES) how.append(h('li', {}, icon(p.icon), h('div', {}, h('h3', {}, p.title), h('p', {}, p.text))));
  sec.append(how);
  sec.classList.add('filled');
}

// ---- Play -----------------------------------------------------------------------------------------------------------------

/** the newest autosave this browser holds (the Continue button), read without ever creating the database: opening a missing one would leave it without its stores */
async function lastSave(): Promise<{ day: number; citizens: number; savedAt: number } | null> {
  try {
    if (!indexedDB.databases || !(await indexedDB.databases()).some((d) => d.name === 'civitas')) return null;
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      const r = indexedDB.open('civitas');
      r.onupgradeneeded = () => r.transaction?.abort(); // it was deleted since we looked: do not create it
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); r.onblocked = () => fail(new Error('blocked'));
    });
    try {
      if (!db.objectStoreNames.contains('meta')) return null;
      const metas = await new Promise<{ slot: string; day: number; citizens: number; savedAt: number }[]>((ok, fail) => {
        const r = db.transaction('meta').objectStore('meta').getAll();
        r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
      });
      return metas.filter((m) => /^auto-/.test(m.slot) && (m.day > 0 || m.citizens > 0)).sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
    } finally { db.close(); }
  } catch { return null; }
}

async function play(root: HTMLElement, cfg: ServerConfig) {
  // /play/ when this server serves the offline build; any other build runs the same local game as ?local
  const base = cfg.play && sameOrigin ? '/play/' : '?local';
  const to = (q: string) => (base === '/play/' ? `/play/?${q}` : `?local&${q}`);
  const save = await lastSave();
  const cont = save ? h('a', { class: 'btn pri', href: base }, 'Continue', h('small', {}, `day ${save.day}, ${save.citizens.toLocaleString()} citizens`)) : null;
  root.append(
    h('p', {}, 'Your own city, running in this browser: no account, no server, nothing uploaded. Start from an empty valley with one road in and a free charter, or play a sandbox with every technology and unlimited funds.'),
    h('div', { class: 'actions' }, cont,
      h('a', { class: `btn${save ? '' : ' pri'}`, href: to('new=zero') }, 'New game from zero'),
      h('a', { class: 'btn', href: to('new=sandbox') }, 'Sandbox')),
    h('p', { class: 'dim' }, 'Saves live in this browser (export a file from the saves screen to move a city). Over https the game also works offline: use your browser\'s install option.'));
}

// ---- Multiplayer ----------------------------------------------------------------------------------------------------------

interface Listed { name?: string; url?: string; region?: string; status?: string; note?: string }
const PILL: Record<string, string> = { open: 'open', closed: 'closed', coming: 'coming soon' };

async function multiplayer(root: HTMLElement, cfg: ServerConfig) {
  let servers: Listed[] = [];
  try {
    const r = await fetch(`${API}/api/servers`, { cache: 'no-store' });
    const j = r.ok ? await r.json() as { servers?: Listed[] } : null;
    if (Array.isArray(j?.servers)) servers = j.servers.filter((s) => s && typeof s.name === 'string');
  } catch { /* listed below as empty */ }
  const anyOpen = servers.some((s) => s.status === 'open');
  root.append(h('p', {}, anyOpen ? 'Shared worlds, with other mayors in them.' : 'Shared worlds with other mayors are not open to the public yet: there is no sign-in, so the internet cannot play on ours until there is. The cities above and your own game are open to everyone.'));
  const list = h('ul', { class: 'servers' });
  for (const s of servers) {
    const st = s.status && PILL[s.status] ? s.status : 'closed';
    const href = safeUrl(s.url);
    list.append(h('li', {},
      h('div', {}, h('b', {}, s.name!), s.region ? h('span', { class: 'dim' }, ` · ${s.region}`) : null, h('span', { class: `pill ${st}` }, PILL[st]), s.note ? h('p', { class: 'dim' }, s.note) : null),
      st === 'open' && href ? h('a', { class: 'btn pri', href }, 'Join') : null));
  }
  // a server that is not a read-only showcase (a dev or UAT server) has a live world of its own: the join form, folded
  if (!cfg.spectate) {
    let remembered = '';
    try { remembered = localStorage.getItem('msimcity.name') ?? ''; } catch { /* private mode */ }
    const name = h('input', { maxlength: '20', placeholder: 'Mayor name', autocomplete: 'off', value: remembered, 'aria-label': 'Mayor name' });
    const join = h('form', { class: 'join' }, name, h('button', { class: 'btn pri', type: 'submit' }, 'Join the live world'),
      h('a', { href: '?go' }, 'World picker and test cities'));
    join.addEventListener('submit', (e) => { e.preventDefault(); const n = name.value.trim(); location.search = n ? `?name=${encodeURIComponent(n)}` : '?go'; });
    list.append(h('li', {}, h('div', {}, h('b', {}, 'This server\'s live world'), h('span', { class: 'pill open' }, 'dev'), h('p', { class: 'dim' }, 'One shared, unbounded world on the server serving this page.'),
      h('details', { class: 'fold' }, h('summary', {}, 'Join'), join))));
  }
  root.append(list.childElementCount ? list : h('p', { class: 'dim' }, 'No public servers are listed yet.'));
}

// ---- the page -------------------------------------------------------------------------------------------------------------

function section(id: string, title: string, sub: string): HTMLElement {
  const s = h('section', { id }, h('h2', {}, title), h('p', { class: 'sub' }, sub));
  return s;
}

async function main() {
  const root = document.getElementById('landing') ?? document.body.appendChild(h('main', { id: 'landing' }));
  const ex = section('explore', 'Explore a city', 'Read-only maps, built and running. Fly over them, ride the buses and trains, follow a citizen home, take the guided tour.');
  const pl = section('play', 'Play', 'The local game: runs in this browser only, saved on this device, nothing sent anywhere.');
  const mp = section('multiplayer', 'Multiplayer', 'Public servers: shared worlds, wiped and re-seeded often while the game is in development.');
  const foot = h('footer', {},
    h('span', {}, `civitas · build ${__BUILD__}`),
    h('a', { href: '/viewer.html' }, 'Building viewer'),
    h('a', { href: '/compare.html' }, 'Landmark comparison'),
    h('span', { class: 'dim' }, 'Recordings from Freesound, all CC0: '), h('a', { href: 'https://github.com/reneodlt/civitas/blob/main/packages/client/src/audio/CREDITS.md' }, 'credits'),
    h('a', { href: 'https://github.com/reneodlt/civitas/blob/main/CONTRIBUTING.md' }, 'Contributing'),
    h('a', { href: 'https://www.reddit.com/r/civitas_game/', rel: 'noopener' }, 'Reddit r/civitas_game'));
  root.replaceChildren(
    h('header', {}, h('a', { class: 'brand', href: '/' }, 'civitas')),
    h('div', { class: 'intro' }, h('h1', {}, 'Build a city. Watch it live.'),
      h('p', {}, 'Civitas is a city builder in your browser. Buy land, zone it, lay roads and rail, and your citizens go wherever the jobs are and sit in whatever traffic you leave them.')),
    showreel(), ex, pl, mp, foot);
  const cfg = await serverConfig();
  document.title = 'Civitas';
  await Promise.all([explore(ex, cfg), play(pl, cfg), multiplayer(mp, cfg)]);
}
void main();
