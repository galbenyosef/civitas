import {
  BOAT_TYPES, boatName, boatOwner, boatOperator, boatCrew, ferryCrew, fishingReg, catchOf, callCargo, hoursFished,
  type BoatState, type BoatHarbour, type BoatPhase, type CrewMember, type Voyage, type BoatInfo,
} from '@msimcity/shared';
import type { CabEye } from './render/fpv';
import type { HelmPose, FerryInfo } from './render/boats';

/**
 * The tooltip and panel of a boat (docs/boats.md section 7): what it is, who owns it, what it is doing and who is aboard.
 * Everything comes from the shared deterministic schedule (shared/src/boats.ts) and the names and crews that go with it, so
 * it needs no server round trip; a trawler's crew of real citizens will come from the server (`inspectBoat`) when that
 * exists and replaces the generated hands here.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const row = (k: string, v: string | number) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
const crewRows = (crew: CrewMember[]) => crew.map((c) => `<div class="person static"><span class="pname">${esc(c.name)}</span><span class="prel">${esc(c.role)}</span></div>`).join('');

/** 1 tile a tick reads as 63 knots (docs/boats.md section 4) */
export const boatKnots = (tilesPerTick: number) => Math.round(tilesPerTick * 63);
/** a tile is about 13 m */
const metres = (tiles: number) => Math.round(tiles * 13);

const PHASE_LABEL: Record<BoatPhase, string> = {
  moored: 'moored', unberthing: 'casting off', underway: 'under way', fishing: 'trawling', waiting: 'waiting for the lifting bridge', berthing: 'coming alongside', alongside: 'alongside',
};
/** what a boat is doing, in a line */
export function boatDoing(s: BoatState, h: BoatHarbour | undefined, tick: number, ferry?: FerryInfo): string {
  if (ferry) { const pier = ferry.line.names[ferry.stop] ?? 'the pier'; return ferry.phase === 'dwell' ? `alongside at ${pier}, boarding` : `sailing to ${pier}`; }
  const port = h?.name ?? 'the harbour', v = s.voyage;
  switch (s.phase) {
    case 'moored': return `moored at ${port}`;
    case 'unberthing': return `casting off from ${port}`;
    case 'berthing': return `coming alongside at ${port}`;
    case 'waiting': return 'waiting for the lifting bridge';
    case 'fishing': return 'trawling off the point';
    case 'alongside':
      if (s.type === 'trawler') return `alongside at ${port}, landing the catch`;
      return v?.kind === 'call' ? `alongside at ${port}, ${s.type === 'ropax' ? 'loading vehicles and passengers' : 'working cargo'}` : `alongside at ${port}`;
    default:
      if (!v) return 'under way';
      switch (v.kind) {
        case 'cruise': return s.type === 'sailboat' || s.type === 'dinghy' || s.type === 'sailingBarge' ? 'out for a sail' : 'out for a cruise';
        case 'fishing': return returning(v, tick) ? 'returning with the catch' : 'heading for the fishing grounds';
        case 'call': return returning(v, tick, 'alongside') ? 'leaving for the sea' : `arriving at ${port}`;
        case 'escort': return 'escorting a ship in';
        case 'lift': return 'passing through the lifting bridge';
      }
  }
  return PHASE_LABEL[s.phase];
}
/** the tick a voyage's work (fishing, or lying alongside) is done */
const fishedAt = (v: Voyage, phase: BoatPhase = 'fishing') => v.segs.reduce((a, sg) => (sg.phase === phase ? sg.t0 + sg.dur : a), -1);
/** has the voyage done its work (fishing, or lying alongside) by this tick */
function returning(v: Voyage, tick: number, phase: BoatPhase = 'fishing'): boolean {
  let at = -1;
  for (const sg of v.segs) if (sg.phase === phase) at = sg.t0 + sg.dur;
  return at >= 0 && tick >= at;
}

const operatorOf = (s: BoatState) => boatOperator(s.type, s.seed);
const lineName = (f: FerryInfo) => (f.line.name === `Line ${f.line.number}` ? `Line ${f.line.number}` : `${f.line.number} ${f.line.name}`);
export function boatTitle(s: BoatState, ferry?: FerryInfo) {
  if (ferry) return `<span class="sw" style="background:#${ferry.line.color.toString(16).padStart(6, '0')}"></span>${esc(lineName(ferry))} <span style="color:var(--muted);font-weight:400">river bus ${ferry.train + 1}</span>`;
  return `⛵ ${esc(boatName(s.type, s.seed))} <span style="color:var(--muted);font-weight:400">${esc(BOAT_TYPES[s.type].name)}</span>`;
}

/** What else is known about a boat: a river bus's line (render/boats.ts ferryOf), the server's answer to `inspectBoat`. */
export interface BoatCtx { ferry?: FerryInfo; info?: BoatInfo | null }

/** A boat's hover tooltip. */
export function boatTipHtml(s: BoatState, h: BoatHarbour | undefined, tick: number, ctx: BoatCtx = {}): string {
  let html = `<h3>${boatTitle(s, ctx.ferry)}</h3><div class="sub">${esc(boatDoing(s, h, tick, ctx.ferry))}</div>`;
  if (ctx.ferry) html += row('Line', esc(lineName(ctx.ferry))) + row('Calls at', esc(ctx.ferry.line.names.join(' · ')));
  else {
    html += row('Owner', esc(operatorOf(s)?.name ?? boatOwner(s.type, s.seed, h?.name)));
    if (s.type === 'trawler') html += row('Registration', esc(fishingReg(h?.name, h?.id ?? 0, s.seed)));
  }
  if (s.speed > 0.005) html += row('Speed', `${boatKnots(s.speed)} kt${s.astern ? ' astern' : ''}`);
  html += `<div class="clickhint">click for the crew and the wheelhouse view</div>`;
  return html;
}

/** A trawler's crew from the server: real citizens, clickable, with the generated roles (skipper, mate, deckhands) in order. */
const citizenRows = (people: { id: number; name: string }[], roles: CrewMember[]) =>
  people.map((p, i) => `<div class="person" data-cid="${p.id}" title="click to select ${esc(p.name)}"><span class="pname">${esc(p.name)}</span><span class="prel">${esc(roles[i]?.role ?? 'deckhand')}</span></div>`).join('');

/** The selected boat's panel. */
export function boatPanelHtml(s: BoatState, h: BoatHarbour | undefined, tick: number, knots: number, ctx: BoatCtx = {}): string {
  const spec = BOAT_TYPES[s.type], v = s.voyage, op = operatorOf(s), f = ctx.ferry;
  let html = `<h3>${boatTitle(s, f)}</h3><div class="sub">${esc(boatDoing(s, h, tick, f))}</div>`;
  html += row('Vessel', `${spec.name} · ${metres(spec.len)} m`);
  if (f) {
    html += row('Line', esc(lineName(f)));
    html += row('Calls at', esc(f.line.names.join(' · ')));
    html += row(f.phase === 'dwell' ? 'Alongside at' : 'Next pier', esc(f.line.names[f.stop] ?? '—'));
  } else {
    html += row(op ? 'Operator' : 'Owner', esc(op?.name ?? boatOwner(s.type, s.seed, h?.name)));
    if (s.type === 'trawler') html += row('Registration', esc(fishingReg(h?.name ?? ctx.info?.harbourName, h?.id ?? 0, s.seed)));
    html += row(v?.kind === 'call' ? 'Calling at' : 'Home port', esc(h?.name ?? ctx.info?.harbourName ?? 'the harbour'));
  }
  html += row('Speed', knots > 0 ? `${knots} kt${s.astern ? ' astern' : ''}` : s.phase === 'waiting' ? 'holding' : 'stopped');
  if (v) {
    if (v.kind === 'fishing') {
      html += row('Fishing', `${hoursFished(v).toFixed(1)} h at the grounds${tick < fishedAt(v) ? ' (planned)' : ''}`);
      html += row('Catch', returning(v, tick) || s.phase === 'alongside' ? `${catchOf(v)} boxes` : 'not yet landed');
      if (ctx.info?.landedToday) html += row('Landed today', `${ctx.info.landedToday} boxes`);
    } else if (v.kind === 'call') {
      const c = callCargo(v);
      if (c.imports) html += row('Cargo', `${c.imports} ${s.type === 'containerShip' ? 'containers to land' : 'boxes to land'}`);
      if (c.passengers) html += row('Passengers', `${c.passengers} · ${c.vehicles} vehicles`);
    }
  }
  if (s.lights.nav || s.lights.anchor) html += row('Lights', s.lights.trawling ? 'trawling: green over white' : s.lights.nav ? 'red to port, green to starboard' : 'anchor light');
  const crew = f ? ferryCrew(f.line.id, f.train, tick) : boatCrew(s.type, s.seed, v?.id ?? 0);
  html += `<div class="sect">Crew (${ctx.info?.crew?.length || crew.length})</div>`;
  html += ctx.info?.crew?.length ? citizenRows(ctx.info.crew, crew) : crewRows(crew);
  return html;
}

/** The selected boat's wheelhouse for the first-person view: the eye as the renderer drew it, with its HUD lines and console feed. */
export function boatCab(key: string, s: BoatState, h: BoatHarbour | undefined, tick: number, pose: HelmPose, hull: number, turn: number, ferry?: FerryInfo): CabEye {
  const spec = BOAT_TYPES[s.type], kn = boatKnots(s.speed);
  const bearing = (Math.atan2(Math.cos(s.h), -Math.sin(s.h)) * 180) / Math.PI;
  return {
    key, x: pose.x, y: pose.y, z: pose.z, q: pose.q,
    label: `${ferry ? lineName(ferry) : boatName(s.type, s.seed)} · ${pose.wheelhouse ? 'wheelhouse' : 'at the helm'}`,
    lines: [boatDoing(s, h, tick, ferry), `${kn} kt${s.astern ? ' astern' : ''}`],
    fogFar: 60, dip: 0.05, sway: 0.5 + 0.5 * (1 - Math.min(1, spec.len / 2)), seed: s.seed,
    helm: { kind: 'helm', wheelhouse: pose.wheelhouse, knots: kn, vmax: boatKnots(spec.speed), heading: (bearing + 360) % 360, turn: Math.max(-1, Math.min(1, turn / 0.3)), hull, seed: s.seed },
  };
}
