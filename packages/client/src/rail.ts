import { Group, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Color } from 'three';
import {
  planTrack, isRailAux, railMask, isCrossing, routeTiles, railStationAt, stationTrackProblem, stationStop, TICKS_PER_DAY, TICKS_PER_HOUR,
  RAIL_VEHICLE_NAMES, RAIL_FREIGHT_FEE, KIND_NAMES, isFreightYardKind,
  type TrackPlan, type RailStationInfo, type MetroStationInfo, type RailLineDTO, type RailEnv, type TrainInfo,
} from '@msimcity/shared';
import type { ClientWorld } from './world';

/**
 * The client side of railways that is not drawing trains (shared/src/rail.ts, render/trains.ts): the track tool's
 * preview and verdict (the server's planTrack run on the loaded chunks), the status line while dragging, and the
 * tooltips of track tiles and rail stations. No three.js beyond the preview quads.
 */
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const when = (t: number) => { const h = (t % TICKS_PER_DAY) / TICKS_PER_HOUR; return `${WEEKDAYS[Math.floor(t / TICKS_PER_DAY) % 7]} ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };
/** a line's colour swatch and its name ('Line 3' unless the owner named it otherwise) */
const chip = (l: { number: number; color: number; name: string }) => `<span class="sw" style="background:${hex(l.color)}"></span>${l.name === `Line ${l.number}` ? `Line <b>${l.number}</b>` : `<b>${l.number}</b> ${esc(l.name)}`}`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** The rail section of a station's tooltip (server sim/rail.ts describeStation). */
export function railStationHtml(r: RailStationInfo, row: (k: string, v: string | number) => string): string {
  let html = `<div class="sect">Railway</div>`;
  html += row('Platform track', r.track === 'on the track' ? 'laid' : `<span class="bad">${esc(r.track)}</span>`);
  if (!r.lines.length) html += row('Lines', '<span class="bad">none call here yet</span>');
  for (const l of r.lines) {
    html += row(chip(l), l.status === 'running' ? `a train every ${l.headwayMin} min` : `<span class="bad">${esc(l.status)}</span>`);
    if (l.next) html += row('&nbsp;&nbsp;next departs', `${when(l.next.tick)}, ${esc(l.next.toward)}`);
  }
  if (r.freight) {
    html += row('Trains today', plural(r.callsToday, 'call'));
    html += row('Containers in', `${r.freight.inToday} today · ${r.freight.inYesterday} yesterday (by truck from industry)`);
    html += row('Containers out', `${r.freight.outToday} today · ${r.freight.outYesterday} yesterday (to shops by truck)`);
    html += row('Waiting for a train', String(r.freight.waiting));
    return html;
  }
  html += row('Trains today', `${plural(r.callsToday, 'call')} · ${r.boardedToday} on · ${r.alightedToday} off`);
  if (r.faresToday) html += row('Fares today', `$${Math.round(r.faresToday).toLocaleString()}`);
  return html;
}

/** riders waiting on the platform between two end tiles (set by main.ts from the citizens drawn there; the server does not count them) */
export let platformCrowd: (x0: number, y0: number, x1: number, y1: number) => number = () => 0;
export const setPlatformCrowd = (f: typeof platformCrowd) => { platformCrowd = f; };
/** The underground section of an entrance's or hall's tooltip (server sim/metro.ts describeStation): lines, next trains, the platform crowd, where to change. */
export function metroStationHtml(m: MetroStationInfo, row: (k: string, v: string | number) => string): string {
  let html = `<div class="sect">Underground: ${esc(m.name)}</div>`;
  html += row('Platform', m.track === 'open' ? 'open' : `<span class="bad">${esc(m.track)}</span>`);
  if (!m.lines.length) html += row('Lines', '<span class="bad">none call here yet</span>');
  for (const l of m.lines) {
    html += row(chip(l), l.status === 'running' ? `a train every ${l.headwayMin} min` : `<span class="bad">${esc(l.status)}</span>`);
    if (l.next) html += row('&nbsp;&nbsp;next train', `${when(l.next.tick)}, ${esc(l.next.toward)}`);
  }
  if (m.platform) {
    const n = platformCrowd(...m.platform);
    html += row('On the platform', n ? `${plural(n, 'person', 'people')} waiting` : 'empty');
  }
  html += row('Trains today', `${plural(m.callsToday, 'call')} · ${m.boardedToday} on · ${m.alightedToday} off`);
  if (m.changes.length) {
    html += `<div class="sect">Change here for</div>`;
    for (const c of m.changes) html += row(`${esc(c.name)} <span style="color:var(--muted)">${c.mode}</span>`, c.lines.map((l) => chip({ number: l.number, color: l.colour, name: l.name ?? `Line ${l.number}` })).join('<br>'));
  }
  return html;
}

const PLURALS = ['locomotives', 'carriages', 'driving trailers', 'container flats', 'tank wagons', 'hopper wagons', 'covered vans', 'driving motor cars', 'tube cars'];
/** "locomotive + 3 container flats + 2 tank wagons": how many of each kind */
export function consistText(kinds: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const name = (k: number, n: number) => (n === 1 ? RAIL_VEHICLE_NAMES[k] : `${n} ${PLURALS[k]}`);
  return [...counts].map(([k, n]) => name(k, n)).join(' + ');
}
/** A train's tooltip: the line, what it is doing, its consist (worked out here) and what is on board (from the server). */
export function trainHtml(t: TrainInfo, kinds: readonly number[] | null, name = `Line ${t.number}`): string {
  const row = (k: string, v: string) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
  let html = `<h3>${chip({ number: t.number, color: t.colour, name })} ${t.freight ? 'freight train' : kinds?.[0] === 7 ? 'tube train' : 'train'}</h3>`;
  html += row('Now', esc(t.state));
  if (kinds) html += row('Consist', esc(consistText(kinds)));
  html += row(t.freight ? 'Containers' : 'On board', `${t.load} / ${t.capacity}`);
  html += `<div class="bar"><i style="width:${Math.min(100, (100 * t.load) / Math.max(1, t.capacity))}%"></i></div>`;
  if (t.cargo?.length) for (const c of t.cargo) html += row('&nbsp;&nbsp;for', `${esc(c.yard)}: ${plural(c.containers, 'container')}`);
  if (t.freight) html += row('Haulage', `$${RAIL_FREIGHT_FEE} a container to the line's owner`);
  return html;
}

export class RailClient {
  /** green or red quads along the dragged path */
  group = new Group();
  private quads: InstancedMesh;
  private memo: { key: string; at: number; v: TrackPlan } | null = null;
  /** lines over each track tile, from the routes the server sent */
  private byTile = new Map<string, RailLineDTO[]>();
  readonly env: RailEnv;

  constructor(private world: ClientWorld) {
    this.env = { tile: (x, y) => world.getTile(x, y), aux: (x, y) => world.auxAt(x, y), sub: (x, y) => world.subAt(x, y) };
    this.quads = new InstancedMesh(new PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), new MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }), 256);
    this.quads.count = 0;
    this.quads.frustumCulled = false;
    this.quads.setColorAt(0, new Color(0xffffff));
    this.group.add(this.quads);
  }

  setLines(lines: RailLineDTO[]) {
    this.byTile.clear();
    for (const l of lines) if (l.route) for (const t of routeTiles(l.route)) {
      const k = `${t.x},${t.y}`;
      const list = this.byTile.get(k);
      if (list) list.push(l); else this.byTile.set(k, [l]);
    }
  }

  /** The server's verdict on a dragged path, worked out on the loaded chunks (cached briefly). */
  verdict(path: [number, number][]): TrackPlan {
    const key = path.length ? `${path[0]}|${path[path.length - 1]}|${path.length}` : '', now = performance.now();
    if (this.memo && this.memo.key === key && now - this.memo.at < 200) return this.memo.v;
    const v = planTrack(path, { ...this.env, land: (x, y) => { const p = this.world.parcelAt(x, y); return p ? (this.world.mayEdit(p.owner) ? null : 'Not your land') : 'Buy this land first: track goes on your own land'; } });
    this.memo = { key, at: now, v };
    return v;
  }

  /** Once per frame: the preview under a drag (or nothing). */
  frame(path: [number, number][] | null) {
    if (!path) { this.quads.count = 0; return; }
    const v = this.verdict(path);
    const m = new Matrix4(), c = new Color(v.ok ? 0x62d2a2 : 0xff3b30);
    let n = 0;
    for (const [x, y] of path) {
      if (n >= 256) break;
      m.makeTranslation(x + 0.5, 0.05, y + 0.5);
      this.quads.setMatrixAt(n, m);
      this.quads.setColorAt(n, c);
      n++;
    }
    this.quads.count = n;
    this.quads.instanceMatrix.needsUpdate = true;
    if (this.quads.instanceColor) this.quads.instanceColor.needsUpdate = true;
    (this.quads.material as MeshBasicMaterial).opacity = v.ok ? 0.45 : 0.6;
  }

  /** Status-line text for the track tool. */
  status(path: [number, number][] | null): string {
    if (!path) return ' · drag along your land to lay track (it can turn one corner; start on existing track to join it)';
    const v = this.verdict(path);
    if (!v.ok) return ` · ${v.reason}`;
    return v.fresh ? ` · ${v.fresh} tile${v.fresh === 1 ? '' : 's'} of track${v.crossings ? ` with ${v.crossings} level crossing${v.crossings === 1 ? '' : 's'}` : ''}, $${v.cost} · release to lay it` : ' · joins existing track · release to join it';
  }

  /** A track tile's tooltip, from the loaded tiles and the lines the server sent. */
  tileTip(x: number, y: number, owner: string): string | null {
    const a = this.world.auxAt(x, y);
    if (!isRailAux(a)) return null;
    const m = railMask(a), n = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    const xing = isCrossing(this.env.tile(x, y), a); // a level crossing: road and track
    const piece = xing ? 'level crossing: the barriers come down ahead of each train' : n === 0 ? 'a length of track on its own' : n === 1 ? 'end of the line (buffer stop)' : n === 2 ? ((m & 5) === 5 || (m & 10) === 10 ? 'straight' : 'curve') : n === 3 ? 'junction' : 'diamond crossing';
    const row = (k: string, v: string) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
    let html = `<h3><span class="sw" style="background:#7d776c"></span>${xing ? 'Level crossing' : 'Railway track'}</h3><div class="sub">${esc(owner)}</div>`;
    html += row('Piece', piece);
    const lines = this.byTile.get(`${x},${y}`) ?? [];
    html += row('Lines', lines.length ? lines.map((l) => `${chip(l)}${l.status === 'running' ? (l.headwayMin ? ` · every ${l.headwayMin} min` : '') : ` <span class="bad">${esc(l.status)}</span>`}`).join('<br>') : 'no line runs here');
    // a station platform beside this tile?
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const st = railStationAt(x + dx, y + dy, this.env);
      if (!st) continue;
      const s = stationStop(st);
      const onRow = s.alongX ? y === s.row && x >= s.a0 && x <= s.a1 : x === s.row && y >= s.a0 && y <= s.a1;
      if (!onRow) continue;
      const why = stationTrackProblem(st, this.env);
      html += row(isFreightYardKind(st.kind) ? 'Loading dock' : 'Platform', `${KIND_NAMES[st.kind] ?? 'station'} at (${st.doorX}, ${st.doorY})${why ? ` · <span class="bad">${esc(why)}</span>` : ''}`);
      break;
    }
    return html;
  }
}
