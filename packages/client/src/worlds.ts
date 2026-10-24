import './worlds.css';
import type { NetClient } from './net';
import { DEMO_BY_ID, type DemoId } from '@msimcity/shared';
import { demoList, startDemo, type DemoInfo } from './tour';
import { apiBase, serverConfig } from './serverApi';

/**
 * Which world to join: the live one, a demo map (docs/demo.md: the showcase and focused demos, offered by every
 * server, production included; tour.ts), or a test city (a dev-only, pre-built N×N-district city that the server runs as
 * its own process, see server/src/testcities.ts). The picker on the join form lists them with their status; choosing
 * one starts it, waits until it is filled, then reloads the page with `?ws=host:port&city=n`, so the connection uses
 * the same `?ws=` override as everything else and the URL can be shared.
 */
/** The server's children listen 20 above its port (server testcities.ts): 8100+n for dev (Vite :5173 → :8080), 9100+n for UAT on :9080. */
export const TEST_CITY_BASE_PORT = (location.port === '5173' ? 8080 : Number(location.port || (location.protocol === 'https:' ? 443 : 80))) + 20;

export interface CityInfo {
  districts: number; port: number; approxPopulation: number; status: 'stopped' | 'starting' | 'running' | 'stopping';
  saved: boolean; citizens?: number; clients?: number; fill?: number; fillPopulation?: number;
  tickAvg?: number; tickP95?: number; tickMax?: number; error?: string;
}
interface CityList { available: boolean; idleMinutes?: number; cities?: CityInfo[] }

export { apiBase, serverConfig };

/** The test city this page is connected to (`?city=n`, or inferred from a `?ws=host:8100+n`), or 0 for the live world. */
export function testCityOf(params: URLSearchParams): number {
  const c = Number(params.get('city'));
  if (c >= 1 && c <= 16) return c | 0;
  const m = /:(\d+)$/.exec(params.get('ws') ?? '');
  const n = m ? Number(m[1]) - TEST_CITY_BASE_PORT : 0;
  return n >= 1 && n <= 16 ? n : 0;
}

export const cityWsHost = (n: number) => `${location.hostname}:${TEST_CITY_BASE_PORT + n}`;

async function getList(): Promise<CityList | null> {
  try {
    const r = await fetch(`${apiBase()}/api/test-cities`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as CityList) : null;
  } catch { return null; }
}
async function postStart(n: number): Promise<CityInfo | null> {
  try {
    const r = await fetch(`${apiBase()}/api/test-cities/${n}/start`, { method: 'POST' });
    return r.ok ? ((await r.json()) as CityInfo) : null;
  } catch { return null; }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const label = (n: number) => `${n}×${n}`;
const fmtMs = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

/** Block until a test city is running (starting it first), reporting progress. Resolves false if it stops or fails. */
export async function startCity(n: number, progress: (c: CityInfo | null) => void = () => {}): Promise<boolean> {
  let c = await postStart(n);
  progress(c);
  const t0 = Date.now();
  while (Date.now() - t0 < 45 * 60_000) {
    if (c?.status === 'running') return true;
    if (c?.status === 'stopped' && c.error) return false;
    await sleep(1000);
    const list = await getList();
    c = list?.cities?.find((x) => x.districts === n) ?? c;
    if (c?.status === 'stopped') c = await postStart(n); // the child exited while we waited: try once more, the error stops us
    progress(c);
  }
  return false;
}

/** The world list on the join form. Hidden unless the server offers demos or test cities. */
export class WorldPicker {
  /** 0 = live world, n = the n×n test city, 'demo:<id>' = a demo map */
  selected: number | string = 0;
  private root: HTMLElement;
  private rows = new Map<number | string, HTMLElement>();
  private timer = 0;
  private list: CityInfo[] = [];
  private demos: DemoInfo[] = [];
  private busy = false;

  constructor(root: HTMLElement, preselect: number | string) {
    this.root = root;
    this.selected = preselect;
    void this.refresh();
    this.timer = window.setInterval(() => { if (!this.busy) void this.refresh(); }, 2000);
  }

  stopPolling() { clearInterval(this.timer); }

  private async refresh() {
    const [l, demos] = await Promise.all([getList(), demoList()]);
    const cities = l?.available && l.cities ? l.cities : [];
    if (!cities.length && !demos?.length) { this.root.classList.add('hidden'); return; }
    this.list = cities;
    this.demos = demos ?? [];
    this.root.classList.remove('hidden');
    if (!this.rows.size) this.build();
    for (const c of this.list) this.paint(c);
    for (const d of this.demos) this.paintDemo(d);
  }

  private build() {
    this.root.innerHTML = '<div class="wtitle">World</div>';
    const add = (n: number | string, name: string, extra: string, cls = '') => {
      const row = document.createElement('label');
      row.className = `wrow ${cls}`;
      row.innerHTML = `<input type="radio" name="world" value="${n}"${n === this.selected ? ' checked' : ''}><span class="wname">${name}</span><span class="wpop">${extra}</span><span class="wstat"></span>`;
      row.querySelector('input')!.addEventListener('change', () => { this.selected = n; try { localStorage.setItem('msimcity.world', String(n)); } catch { /* private mode */ } });
      this.root.appendChild(row);
      this.rows.set(n, row);
    };
    add(0, 'Live world', 'shared');
    for (const d of this.demos) {
      // the showcase heads its focused demos; a sample city on its own map (London) stands on its own
      const own = d.id === 'showcase' || !!DEMO_BY_ID.get(d.id)?.town;
      add(`demo:${d.id}`, d.name, d.id === 'showcase' ? 'guided tour' : own ? 'sample city, tour' : 'tour', own ? 'wdemo' : 'wdemo wsub');
    }
    for (const c of this.list) add(c.districts, `Test city ${label(c.districts)}`, `≈${c.approxPopulation.toLocaleString()}`);
    if (!this.rows.has(this.selected)) { this.selected = 0; (this.rows.get(0)!.querySelector('input') as HTMLInputElement).checked = true; }
    const hint = document.createElement('div');
    hint.className = 'whint';
    hint.textContent = (this.demos.length ? 'Demos are sandboxes with every building in use and a guided tour; Reset puts them back as they were. ' : '')
      + (this.list.length ? 'Test cities are throwaway, pre-built to level 3 and full of people, to see where the simulation slows down. ' : '')
      + 'Each runs as its own process and stops after ten idle minutes.';
    this.root.appendChild(hint);
  }

  private paintDemo(d: DemoInfo) {
    const row = this.rows.get(`demo:${d.id}`);
    if (!row) return;
    const stat = row.querySelector('.wstat') as HTMLElement;
    let text = '', cls = '';
    if (d.status === 'running') { text = `running · ${(d.citizens ?? 0).toLocaleString()} people${d.clients ? ` · ${d.clients} here` : ''}`; cls = 'ok'; }
    else if (d.status === 'starting') text = d.fill !== undefined ? `building the town · ${Math.round(d.fill * 100)}%` : 'starting…';
    else if (d.status === 'resetting') text = 'resetting…';
    else if (d.status === 'stopping') text = 'stopping…';
    else text = d.error ? 'failed to start' : d.saved ? 'asleep · starts in a few seconds' : 'not built yet · about a minute to build';
    stat.textContent = text;
    stat.className = `wstat ${cls}`;
    row.title = d.error ?? d.blurb;
  }

  private paint(c: CityInfo) {
    const row = this.rows.get(c.districts);
    if (!row) return;
    const stat = row.querySelector('.wstat') as HTMLElement;
    let text = '', cls = '';
    if (c.status === 'running') {
      text = `running · ${(c.citizens ?? 0).toLocaleString()} people${c.tickAvg !== undefined ? ` · avg ${fmtMs(c.tickAvg)} ms` : ''}`;
      cls = c.tickAvg !== undefined && c.tickAvg > 200 ? 'bad' : c.tickAvg !== undefined && c.tickAvg > 50 ? 'warn' : 'ok';
    } else if (c.status === 'starting') text = c.fill !== undefined ? `starting · filling ${Math.round(c.fill * 100)}%${c.fillPopulation ? ` · ${c.fillPopulation.toLocaleString()}` : ''}` : 'starting…';
    else if (c.status === 'stopping') text = 'stopping…';
    else text = c.error ? 'failed to start' : c.saved ? 'stopped · saved' : 'stopped';
    stat.textContent = text;
    stat.className = `wstat ${cls}`;
    if (c.error) row.title = c.error;
  }

  /** Show progress on the form's button while a chosen city starts. */
  async join(name: string, button: HTMLButtonElement): Promise<void> {
    const params = new URLSearchParams(location.search);
    params.delete('ws'); params.delete('city'); params.delete('demo');
    params.set('name', name);
    if (typeof this.selected === 'string') {
      const id = this.selected.slice(5) as DemoId;
      const dname = this.demos.find((d) => d.id === id)?.name ?? id;
      this.busy = true;
      button.disabled = true;
      const ok = await startDemo(id, (d) => {
        if (d) this.paintDemo(d);
        button.textContent = d?.status === 'starting' && d.fill !== undefined ? `Building the ${dname.toLowerCase()}… ${Math.round(d.fill * 100)}%` : `Starting the ${dname.toLowerCase()}…`;
      });
      this.busy = false;
      if (!ok) { button.disabled = false; button.textContent = 'Failed. Try again'; return; }
      params.set('demo', id);
      location.search = params.toString();
      return;
    }
    const n = this.selected;
    if (n) { params.set('ws', cityWsHost(n)); params.set('city', String(n)); }
    if (n) {
      this.busy = true;
      button.disabled = true;
      const ok = await startCity(n, (c) => {
        if (c) this.paint(c);
        button.textContent = c?.status === 'starting' && c.fill !== undefined ? `Filling ${label(n)}… ${Math.round(c.fill * 100)}%` : `Starting ${label(n)}…`;
      });
      this.busy = false;
      if (!ok) { button.disabled = false; button.textContent = 'Failed. Try again'; return; }
    }
    location.search = params.toString();
  }
}

/** Banner for a test city page, and the way back to the live world. */
export function showCityBanner(n: number, params: URLSearchParams, mount: HTMLElement) {
  const back = new URLSearchParams(params);
  back.delete('ws'); back.delete('city');
  const el = document.createElement('div');
  el.id = 'cityBanner';
  el.innerHTML = `Test city ${label(n)} — not the live world · <a href="${location.pathname}?${back.toString()}">back to the live world</a>`;
  mount.appendChild(el);
}

/**
 * In a test city, a dropped connection usually means its process was stopped (idle, or the dev server restarted).
 * Starting it again is cheap (the world was saved), so ask for that, at most every few seconds.
 */
export function reviveCity(n: number, net: NetClient) {
  let lastTry = 0;
  const prev = net.onStatus;
  net.onStatus = (ok) => {
    prev(ok);
    if (ok || Date.now() - lastTry < 5000) return;
    lastTry = Date.now();
    void postStart(n);
  };
}

export const remembered = (): number | string => {
  try { const v = localStorage.getItem('msimcity.world') ?? ''; return v.startsWith('demo:') ? v : Number(v) || 0; } catch { return 0; }
};
