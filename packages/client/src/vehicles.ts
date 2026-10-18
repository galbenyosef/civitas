import {
  TRAIN_VMAX, PLANE_TYPES, APPROACH_ALT, flightAboard, flightPassenger, CATALOGUE_KIND_NAMES, heliOperator, heliCrew, heliPassengers, heliTowns,
  type HeliState, type TrainInfo, type RailLineDTO, type TrainState, type FlightState, type FlightManifest, type FlightPhase, type PlaneType, type CrewMember, type PersonRow,
} from '@msimcity/shared';
import { consistText } from './rail';

/**
 * The panels of a selected train, plane or helicopter (docs/rail.md, docs/airport.md, docs/helicopters.md). Where each
 * is, what it is doing and its crew come from the shared deterministic schedules and crews.ts; a train's riders and
 * containers come from the server (an `inspectTrain` with `full`, only for the selected train); a plane's passengers are
 * generated from its flight.
 */
export type VehicleSel = { kind: 'train'; line: number; train: number } | { kind: 'plane'; airport: number; flight: number } | { kind: 'heli'; flight: number };
export const vehicleKey = (v: VehicleSel) => (v.kind === 'train' ? `t${v.line}:${v.train}` : v.kind === 'plane' ? `p${v.airport}:${v.flight}` : `h${v.flight}`);

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const row = (k: string, v: string | number) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
const bar = (n: number, of: number) => `<div class="bar"><i style="width:${Math.min(100, (100 * n) / Math.max(1, of))}%"></i></div>`;
const crewRows = (crew: CrewMember[]) => crew.map((c) => `<div class="person static"><span class="pname">${esc(c.name)}</span><span class="prel">${esc(c.role)}</span></div>`).join('');

// ---- trains -----------------------------------------------------------------------------------------

/** km/h shown for a train: line speed reads as 120 */
export const trainKmh = (v: number) => Math.round((v / TRAIN_VMAX) * 120);

export function trainTitle(dto: RailLineDTO, freight: boolean) {
  const name = dto.name === `Line ${dto.number}` ? `Line ${dto.number}` : `${dto.number} ${dto.name}`;
  return `<span class="sw" style="background:${hex(dto.color)}"></span>${esc(name)} <span style="color:var(--muted);font-weight:400">${freight ? 'freight train' : dto.metro ? 'tube train' : 'passenger train'}</span>`;
}

/** The selected train's panel. `info` is the server's last answer (null until it comes). */
export function trainPanelHtml(dto: RailLineDTO, st: TrainState, kinds: readonly number[] | null, info: TrainInfo | null, crew: CrewMember[], selectedCitizen: number): string {
  const freight = info?.freight ?? !!dto.freight;
  let html = `<h3>${trainTitle(dto, freight)}</h3>`;
  html += `<div class="sub">${esc(info?.state ?? (st.phase === 'dwell' ? 'standing at a station' : 'running'))}</div>`;
  html += row('Service', `${freight ? 'freight' : 'passenger'} · train ${st.train + 1}${dto.running > 1 ? ` of ${dto.running}` : ''}`);
  if (info?.prev) html += row(st.phase === 'dwell' ? 'Standing at' : 'Last called', esc(info.prev));
  if (info?.next && st.phase !== 'dwell') html += row('Next stop', esc(info.next));
  html += row('Speed', st.phase === 'dwell' ? (st.doors ? 'stopped · doors open' : 'stopped') : `${trainKmh(st.v)} km/h`);
  if (kinds) html += row('Consist', esc(consistText(kinds)));
  if (info) {
    html += row(freight ? 'Containers' : 'On board', `${info.load} / ${info.capacity}`) + bar(info.load, info.capacity);
  }
  html += `<div class="sect">Crew (${crew.length})</div>${crewRows(crew)}`;
  if (freight) {
    const rows = info?.consignments;
    html += `<div class="sect">Containers aboard (${info?.load ?? '…'})</div>`;
    if (!rows) html += `<div class="pempty">loading…</div>`;
    else if (!rows.length) html += `<div class="pempty">running empty</div>`;
    else html += rows.map((c) => `<div class="person static" title="from ${esc(c.from)} to ${esc(c.to)}"><span class="pname">${esc(c.what)}</span><span class="prel">off at ${esc(c.yard)} · for ${esc(c.to)}</span></div>`).join('');
  } else {
    const rows = info?.riders;
    html += `<div class="sect">Passengers (${info?.load ?? '…'})</div>`;
    if (!rows) html += `<div class="pempty">loading…</div>`;
    else if (!rows.length) html += `<div class="pempty">nobody on board</div>`;
    else html += rows.map((r: PersonRow) => `<div class="person${r.id === selectedCitizen ? ' sel' : ''}" data-cid="${r.id}" title="click to select ${esc(r.name)}"><span class="pname">${esc(r.name)}${r.age !== undefined ? ` <span class="page">${r.age}</span>` : ''}</span><span class="prel">${esc(r.activity)}</span></div>`).join('');
  }
  if (info?.truncated) html += `<div class="pempty">Long lists are cut at 200 rows.</div>`;
  return html;
}

// ---- planes -----------------------------------------------------------------------------------------

export const PHASE_LABEL: Record<FlightPhase, string> = {
  approach: 'on approach', flare: 'landing', rollout: 'landing roll', taxiIn: 'taxiing to the gate', dwell: 'at the gate',
  pushback: 'pushing back', taxiOut: 'taxiing to the runway', takeoff: 'taking off', rotate: 'lifting off', climb: 'climbing out',
};
const TYPE_LABEL: Record<PlaneType, string> = { turboprop: 'turboprop', regional: 'regional jet', narrowbody: 'narrow-body jet', widebody: 'wide-body jet', jumbo: 'four-engined jumbo jet', bizjet: 'business jet' };
/** approach speed in knots by type: the sim's tiles per tick are scaled so the approach reads as this */
const APPROACH_KT: Record<PlaneType, number> = { turboprop: 115, regional: 135, narrowbody: 140, widebody: 145, jumbo: 150, bizjet: 125 };
export const planeKnots = (type: PlaneType, tilesPerTick: number) => Math.round((tilesPerTick / PLANE_TYPES[type].vApproach) * APPROACH_KT[type]);
/** feet shown for an altitude in tiles: the top of the glide path reads as 2,500 ft */
export const planeFeet = (y: number) => Math.max(0, Math.round((y / APPROACH_ALT) * 2500 / 50) * 50);

const inbound = (p: FlightPhase) => p === 'approach' || p === 'flare' || p === 'rollout' || p === 'taxiIn' || p === 'dwell';
/** What a flight is doing, in a line: 'on approach from Marlow', 'at the gate · boarding for Corran'. */
export function planeDoing(s: FlightState, m: FlightManifest): string {
  if (s.phase === 'dwell') {
    const a = flightAboard(m, s.phase, s.progress);
    return a.leg === 'in' ? (a.count ? 'at the gate · passengers getting off' : 'at the gate · being turned round') : `at the gate · boarding for ${m.destination}`;
  }
  return `${PHASE_LABEL[s.phase]} ${inbound(s.phase) ? `from ${m.origin}` : `to ${m.destination}`}`;
}
export function planeTitle(s: FlightState, m: FlightManifest) {
  const no = inbound(s.phase) && !(s.phase === 'dwell' && s.progress >= 0.5) ? m.inbound : m.outbound;
  return `✈ ${esc(no)} <span style="color:var(--muted);font-weight:400">${esc(m.airline)}</span>`;
}

/** A plane's hover tooltip. */
export function planeTipHtml(s: FlightState, m: FlightManifest): string {
  const a = flightAboard(m, s.phase, s.progress);
  let html = `<h3>${planeTitle(s, m)}</h3><div class="sub">${esc(planeDoing(s, m))}</div>`;
  html += row('Aircraft', TYPE_LABEL[s.type]);
  html += row('Route', `${esc(m.origin)} → here → ${esc(m.destination)}`);
  html += row('On board', `${a.count} passengers · ${m.crew.length} crew`);
  html += `<div class="clickhint">click for the passenger list and the cockpit view</div>`;
  return html;
}

/** The selected plane's panel: what it is doing and everyone on board. */
export function planePanelHtml(s: FlightState, m: FlightManifest, gate: number, knots: number): string {
  const a = flightAboard(m, s.phase, s.progress);
  let html = `<h3>${planeTitle(s, m)}</h3><div class="sub">${esc(planeDoing(s, m))}</div>`;
  html += row('Aircraft', `${TYPE_LABEL[s.type]} · ${m.seats} seats`);
  html += row('Flights', m.inbound === m.outbound ? `${esc(m.origin)} → here → ${esc(m.destination)}` : `${esc(m.inbound)} from ${esc(m.origin)} · ${esc(m.outbound)} to ${esc(m.destination)}`);
  html += row('Phase', PHASE_LABEL[s.phase]);
  if (s.y > 0.05) html += row('Altitude', `${planeFeet(s.y).toLocaleString()} ft`);
  html += row('Speed', knots > 0 ? `${knots} kt` : 'stopped');
  html += row('Gate', String(gate + 1));
  html += row(a.leg === 'in' ? 'Passengers in' : 'Passengers out', `${a.count} / ${m.seats}`) + bar(a.count, m.seats);
  html += `<div class="sect">Crew (${m.crew.length})</div>${crewRows(m.crew)}`;
  html += `<div class="sect">Passengers (${a.count}) · ${a.leg === 'in' ? 'visitors arriving' : 'travellers leaving'}</div>`;
  if (!a.count) html += `<div class="pempty">${s.phase === 'dwell' ? 'cabin empty while the plane is turned round' : 'nobody on board'}</div>`;
  else {
    const f = s.flight;
    const rows: string[] = [];
    for (let i = 0; i < a.count; i++) {
      const p = flightPassenger(f, a.leg, i);
      rows.push(`<div class="person static"><span class="pname">${esc(p.name)}</span><span class="prel">seat ${p.seat}</span></div>`);
    }
    html += rows.join('');
  }
  return html;
}

// ---- helicopters --------------------------------------------------------------------------------------

const HELI_LABEL = { light: 'light twin helicopter', medium: 'medium twin helicopter' } as const;
/** cruise speed reads as about 120 knots, on the planes' scale */
export const heliKnots = (tilesPerTick: number) => Math.round(tilesPerTick * 226);
/** the building a pad is on, in a sentence: 'the general hospital', 'Buckingham Palace' */
const padPlace = (s: HeliState) => {
  const n = s.pad ? CATALOGUE_KIND_NAMES[s.pad.building] ?? 'a helipad' : 'a helipad';
  return /^[A-Z]|^the /.test(n) ? n : `the ${n}`;
};
/** What a helicopter is doing, in a line. */
export function heliDoing(s: HeliState): string {
  const f = s.flight, towns = heliTowns(f), last = s.stop >= f.stops.length - 1;
  const med = s.kind === 'medical', pol = s.kind === 'police', roy = s.kind === 'royal';
  switch (s.phase) {
    case 'inbound': case 'approach':
      if (s.stop > 0) return med ? `transferring a patient to ${padPlace(s)}` : `flying across to ${padPlace(s)}`;
      return pol ? `returning from patrol to ${padPlace(s)}` : med ? `flying a patient in from ${towns.from}` : roy ? `royal flight from ${towns.from}` : `flying in from ${towns.from}`;
    case 'landing': return `landing at ${padPlace(s)}`;
    case 'onPad': return s.rotor > 0.05 ? `on the pad at ${padPlace(s)} · rotors turning` : `parked on the pad at ${padPlace(s)}`;
    case 'liftoff': return `lifting off from ${padPlace(s)}`;
    default:
      if (!last && s.pad) return `on to ${padPlace(s)}`;
      return pol ? 'out on patrol' : med ? `heading back to base at ${towns.to}` : `leaving for ${towns.to}`;
  }
}
export function heliTitle(s: HeliState) {
  const op = heliOperator(s.flight);
  return `🚁 ${esc(op.flightNo)} <span style="color:var(--muted);font-weight:400">${esc(op.name)}</span>`;
}
/** A helicopter's hover tooltip. */
export function heliTipHtml(s: HeliState): string {
  const op = heliOperator(s.flight);
  let html = `<h3>${heliTitle(s)}</h3><div class="sub">${esc(heliDoing(s))}</div>`;
  html += row('Aircraft', `${HELI_LABEL[s.type]} · ${op.reg}`);
  if (s.y - (s.pad?.y ?? 0) > 0.05 && s.phase !== 'onPad') html += row('Altitude', `${planeFeet(s.y).toLocaleString()} ft`);
  html += `<div class="clickhint">click for the crew and the cockpit view</div>`;
  return html;
}
/** The selected helicopter's panel. */
export function heliPanelHtml(s: HeliState, knots: number): string {
  const f = s.flight, op = heliOperator(f), towns = heliTowns(f), crew = heliCrew(f), pax = heliPassengers(f);
  let html = `<h3>${heliTitle(s)}</h3><div class="sub">${esc(heliDoing(s))}</div>`;
  html += row('Aircraft', `${HELI_LABEL[s.type]} · ${op.reg}`);
  const stops = f.stops.map((st) => CATALOGUE_KIND_NAMES[st.pad.building] ?? 'helipad').join(' → ');
  html += row('Route', `${esc(towns.from)} → ${esc(stops)} → ${esc(towns.to)}`);
  if (s.phase !== 'onPad') html += row('Altitude', `${planeFeet(s.y).toLocaleString()} ft`);
  html += row('Speed', knots > 0 ? `${knots} kt` : s.rotor > 0.05 ? 'hovering' : 'stopped');
  if (pax) html += row(s.kind === 'medical' ? 'Patient' : 'Passengers', s.kind === 'medical' ? '1 on a stretcher' : String(pax));
  html += `<div class="sect">Crew (${crew.length})</div>${crewRows(crew)}`;
  return html;
}
