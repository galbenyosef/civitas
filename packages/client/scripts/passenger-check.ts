// Riding as a passenger in the first-person view (docs/transit.md "Riding along", render/passenger.ts, render/passengerInterior.ts):
// the seat picker is a pure function of the rider, every seat's eye sits inside its vehicle's window band (so nothing of the body is
// in the view), a plane's manifest seat maps to a row along the window band with the wing rows over the wing, the hand-over fades
// street -> seat -> street on a sequence of inspects, and the interior paints its back layer once and its front layer only on change.
// Run: npx tsx packages/client/scripts/passenger-check.ts
import { ACROSS, SEATS, flightPassenger, PLANE_TYPES, type PlaneType, type Flight } from '@msimcity/shared';

// a canvas that draws nothing: the layers' drawing calls are counted, not rendered
let backCalls = 0, frontCalls = 0, current: 'b' | 'f' = 'b';
const ctx = (which: 'b' | 'f') => new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? () => ({ width: 6 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'createPattern' ? () => ({})
    : typeof k === 'string' && /^(fill|clear|stroke)/.test(k) ? () => { if (which === 'b') backCalls++; else frontCalls++; } : () => {}),
  set: () => true,
});
const el = () => { const e = { width: 0, height: 0, className: '', style: { display: '', opacity: '', cssText: '' }, getContext: () => ctx(current) }; return e; };
Object.assign(globalThis, { window: { devicePixelRatio: 1 }, document: { createElement: () => el() } });
const { pickSeat, cabinSeat, seat, handover, handOut, handStep, aboardKey, CABIN, RIDE_WAIT, LOST_WAIT, carriesRiders } = await import('../src/render/passenger');
const { PassengerInterior, passengerFeed } = await import('../src/render/passengerInterior');

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// ---- the seat picker ------------------------------------------------------------------------------
{
  const a = seat(), b = seat();
  let same = true, sides = new Set<number>(), rows = new Set<number>(), inBand = true;
  for (let r = 1; r < 400; r++) {
    pickSeat('bus', r, null, 1, a); pickSeat('bus', r, null, 1, b);
    if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
    sides.add(a.side); rows.add(a.row);
    // the bus's window band: x -0.27..0.23, y 0.135..0.21 (render/citizens.ts busBody); inside the body's width
    if (a.x < -0.27 || a.x > 0.23 || a.y < 0.135 || a.y > 0.21 || Math.abs(a.z) > 0.09 || a.yaw !== 0) inBand = false;
  }
  ok(same, 'the bus seat is a pure function of the rider');
  ok(sides.size === 2 && rows.size === 4, `riders sit on both sides (${sides.size}) and in four rows (${rows.size})`);
  ok(inBand, 'every bus seat\'s eye is inside the bus\'s window band, facing forward');
}
{
  const kinds = [0, 1, 1, 1, 2]; // a locomotive, three carriages and a driving trailer
  const s = seat();
  const cars = new Set<number>();
  let inBand = true, never0 = true, turned = true, flips = true;
  for (let r = 1; r < 400; r++) {
    pickSeat('rail', r, kinds, 1, s);
    cars.add(s.car); if (s.car === 0) never0 = false;
    // the carriage's middle window: x -0.135..0.135, y 0.15..0.215 over the rail head, W 0.21
    if (Math.abs(s.x) > 0.135 || s.y < 0.15 || s.y > 0.215 || Math.abs(s.z) > 0.105) inBand = false;
    if (Math.abs(Math.abs(s.yaw) - 0.62) > 1e-9 || Math.sign(s.yaw) !== s.side) turned = false;
    const yaw = s.yaw;
    pickSeat('rail', r, kinds, -1, s);
    // running the other way the seat faces back along the carriage, still turned to its window
    if (Math.abs(Math.cos(s.yaw) + Math.cos(yaw)) > 1e-9 || Math.abs(Math.sin(s.yaw) - Math.sin(yaw)) > 1e-9) flips = false;
  }
  ok(never0 && cars.size === 4, `riders sit in the four vehicles that carry them, never the locomotive (${[...cars].join(', ')})`);
  ok(inBand, 'every carriage seat\'s eye is inside the middle window\'s glass');
  ok(turned, 'a carriage seat faces the way the train runs, turned 35 degrees to its own window');
  ok(flips, 'when the train runs the other way the seat faces back along the carriage, turned to the same window');
  ok(carriesRiders(7) && carriesRiders(8) && !carriesRiders(0) && !carriesRiders(3), 'tube cars and carriages carry riders; locomotives and wagons do not');
}
{
  const s = seat();
  let inBand = true, across = true;
  for (let r = 1; r < 400; r++) {
    pickSeat('metro', r, [7, 8, 8, 7], 1, s);
    // a tube car's big windows: |x| 0.055..0.235, y 0.12..0.18 over the rail head (render/trains.ts tubeBody), the car 0.19 wide
    if (Math.abs(s.x) < 0.055 || Math.abs(s.x) > 0.235 || s.y < 0.12 || s.y > 0.18 || Math.abs(s.z) > 0.095) inBand = false;
    if (Math.abs(s.yaw + s.side * Math.PI / 2) > 1e-9 || Math.sign(s.z) !== s.side) across = false;
  }
  ok(inBand, 'every tube seat\'s eye is inside its window\'s glass');
  ok(across, 'a tube seat looks straight across the car, away from its own side');
}

// ---- plane seats --------------------------------------------------------------------------------------
{
  const s = seat();
  let allSeats = true, inBand = true, monotone = true, wingRows = true, sides = true, windows = true;
  for (const type of Object.keys(PLANE_TYPES) as PlaneType[]) {
    const c = CABIN[type], across = ACROSS[type], rows = Math.ceil(SEATS[type] / across);
    let lastX = Infinity, sawWing = false;
    for (let row = 1; row <= rows; row++) {
      for (let l = 0; l < across; l++) {
        const label = `${row}${String.fromCharCode(65 + l)}`;
        if (!cabinSeat(type, label, s)) { allSeats = false; continue; }
        if (s.x < c.x0 || s.x > c.x1 || Math.abs(s.y - c.y) > 1e-9 || Math.abs(s.z) >= c.r) inBand = false;
        if ((l < across / 2 ? -1 : 1) !== s.side || Math.sign(s.yaw) !== s.side) sides = false;
        if (s.window !== (l === 0 || l === across - 1)) windows = false;
        if (s.wing !== (s.x >= c.w0 - 0.02 && s.x <= c.w1 + 0.02)) wingRows = false;
        if (s.wing) sawWing = true;
      }
      cabinSeat(type, `${row}A`, s);
      if (s.x >= lastX) monotone = false;
      lastX = s.x;
    }
    if (!sawWing) wingRows = false;
  }
  ok(allSeats, 'every seat of every type maps to a cabin eye');
  ok(inBand, 'every cabin eye is inside the window band\'s glass and the fuselage');
  ok(monotone, 'row 1 is at the front and the rows run back along the band');
  ok(wingRows, 'the rows over the wing root see the wing (every type has some)');
  ok(sides && windows, 'A is the left window, the last letter the right; the eye looks out of its own side');
  ok(cabinSeat('narrowbody', '99Z', s) === null && cabinSeat('bizjet', '9A', s) === null && cabinSeat('narrowbody', 'x', s) === null, 'a seat the type does not have is refused');
  // the manifest's own labels (shared/src/crews.ts flightPassenger) all sit somewhere
  let manifest = true;
  for (const type of Object.keys(PLANE_TYPES) as PlaneType[]) {
    const f = { id: 4003, type, seed: 0.37, gate: 0 } as unknown as Flight;
    for (let i = 0; i < SEATS[type]; i++) if (!cabinSeat(type, flightPassenger(f, 'out', i).seat, s)) manifest = false;
  }
  ok(manifest, 'every manifest row of every type picks a seat');
  const w = cabinSeat('narrowbody', '14F', seat())!, n = cabinSeat('narrowbody', '2F', seat())!;
  ok(w.wing && !n.wing && Math.abs(w.yaw) > Math.abs(n.yaw), 'over the wing the eye looks further aft than at a front row');
}

// ---- the hand-over ------------------------------------------------------------------------------------
{
  const h = handover(), o = handOut();
  const trace: string[] = [];
  let level = 1;
  const step = (eye: boolean, aboard: string, found: boolean, dt = 0.1) => {
    handStep(h, { eye, aboard, found, foundShown: h.shown === 'seat' ? found || h.key !== aboard : eye, riding: aboard !== '', level, dt }, o);
    // the fade as fpv.ts runs it: down while held or changing, up otherwise
    level = Math.max(0, Math.min(1, level + (o.hold ? -1 : 1) * dt / 0.6));
    trace.push(`${o.draw}${o.hold ? '·hold' : ''}${o.switched ? '·switch' : ''}${o.end ? '·END' : ''}`);
    return o;
  };
  for (let i = 0; i < 5; i++) step(true, '', false);
  ok(trace.every((t) => t === 'street') && h.shown === 'street', 'on the street: the street follow, no fade');
  // boarding: the stream drops them; the inspect says nothing for a second
  let ended = false;
  for (let i = 0; i < 10; i++) if (step(false, '', false).end) ended = true;
  ok(!ended && o.hold && level < 0.8, 'gone from the street: the picture holds and fades, nothing ends inside a second');
  // the inspect sits them in bus 7
  let sw = 0;
  for (let i = 0; i < 20; i++) { step(false, 'c7', true); if (o.switched) sw++; }
  ok(h.shown === 'seat' && h.key === 'c7' && sw === 1 && o.draw === 'seat' && !o.hold && level > 0.9, 'aboard: one switch while dark, then the seat fades in');
  // off at their stop: the stream has them back a moment before the inspect clears
  step(true, 'c7', true);
  ok(o.draw === 'seat' && !o.hold, 'the street has them again but the inspect still says aboard: stay in the seat');
  sw = 0;
  let held = false;
  for (let i = 0; i < 20; i++) { step(true, '', false); if (o.switched) sw++; if (o.hold && o.draw === 'seat') held = true; }
  ok(held && sw === 1 && h.shown === 'street' && o.draw === 'street' && level > 0.9, 'off: the seat fades out, then the street follow fades in');
  // a transfer: off the bus, onto a train
  for (let i = 0; i < 3; i++) step(false, '', false);
  for (let i = 0; i < 20; i++) step(false, 't3:1', true);
  ok(h.shown === 'seat' && h.key === 't3:1', 'onto a train: the seat in the train');
  sw = 0;
  for (let i = 0; i < 20; i++) { step(false, 'c9', true); if (o.switched) sw++; }
  ok(h.shown === 'seat' && h.key === 'c9' && sw === 1, 'from one vehicle to another: fade out, change once while dark, fade in');
  // aboard a vehicle the client cannot pose (out of the loaded chunks): wait RIDE_WAIT, then end
  const h2 = handover(); let t = 0, end = false;
  while (!end && t < 10) { handStep(h2, { eye: false, aboard: 'c4', found: false, foundShown: false, riding: true, level: 1, dt: 0.1 }, o); t += 0.1; end = o.end; }
  ok(end && Math.abs(t - RIDE_WAIT) < 0.25, `aboard a vehicle not drawn here: the view waits ${RIDE_WAIT} s, then ends (${t.toFixed(1)} s)`);
  const h3 = handover(); t = 0; end = false;
  while (!end && t < 10) { handStep(h3, { eye: false, aboard: '', found: false, foundShown: false, riding: false, level: 1, dt: 0.1 }, o); t += 0.1; end = o.end; }
  ok(end && Math.abs(t - LOST_WAIT) < 0.25, `gone with no ride at all: ${LOST_WAIT} s as before (${t.toFixed(1)} s)`);
  ok(aboardKey({ mode: 'bus', vehicle: 12, line: 3 }) === 'c12' && aboardKey({ mode: 'metro', vehicle: 99, line: 6, train: 1 }) === 't6:1' && aboardKey(undefined) === '', 'a vehicle\'s key: c<bus> as the street sound names it, t<line>:<train> as a cab ride');
}

// ---- the interior's cost ------------------------------------------------------------------------------
{
  const parent = { insertBefore: () => {} } as unknown as HTMLElement;
  for (const kind of ['bus', 'rail', 'metro', 'plane'] as const) {
    const pi = new PassengerInterior(parent, null);
    const f = passengerFeed();
    f.kind = kind; f.vseed = 0.41; f.colour = 0x0098d4; f.fill = 0.5; f.next = 'Arena'; f.speed = 0.5;
    if (kind === 'plane') cabinSeat('narrowbody', '14F', f.seat); else pickSeat(kind, 77, kind === 'bus' ? null : [7, 8, 8, 7], 1, f.seat);
    f.phase = 'climb'; f.flown = 0.05; f.from = 'here'; f.to = 'Corran'; f.belts = true;
    backCalls = 0; frontCalls = 0;
    current = 'b';
    // the Layers make the back canvas first, then the front: route each context by the order they were asked for
    let first = true;
    (globalThis as unknown as { document: { createElement: () => unknown } }).document.createElement = () => { const e = el(); const which = first ? 'b' : 'f'; first = !first; e.getContext = () => ctx(which); return e; };
    const pj = new PassengerInterior(parent, null);
    pj.update(f, 1000, 0.016, 1280, 720, 1);
    const b1 = backCalls, f1 = frontCalls;
    // a steady ride for a second at 60 fps: the back is not painted again; the front only when something it shows changes
    for (let i = 1; i <= 60; i++) pj.update(f, 1000 + i * 16, 0.016, 1280, 720, 1);
    const b2 = backCalls - b1, f2 = frontCalls - f1;
    ok(b1 > 20 && b2 === 0, `${kind}: the back layer is painted once (${b1} calls) and not again while nothing changes (${b2})`);
    const bound = kind === 'metro' ? 60 * 40 : 6 * 40;
    ok(f2 < bound, `${kind}: the front layer redraws only on change (${f2} drawing calls in a second${kind === 'metro' ? ', the straps swing' : ''})`);
    // the load moves by a few riders: no repaint; by an eighth of the car: one
    f.fill = 0.52; pj.update(f, 3000, 0.016, 1280, 720, 1);
    const b3 = backCalls - b1 - b2;
    f.fill = 0.7; pj.update(f, 3016, 0.016, 1280, 720, 1);
    const b4 = backCalls - b1 - b2 - b3;
    ok(b3 === 0 && b4 > 20, `${kind}: a few more riders do not repaint the back (${b3}); an eighth of the car more does (${b4})`);
    void pi;
  }
}

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\npassenger-check: all passed');
