// The line editor's watch on the world and the night-out FPV, offline, on fake clocks (docs/transit.md "Stops you can see" and
// "Errors that heal", README FPV row). Pure rules only: linewatch.ts (the preview gate: a stream of road changes is one request
// per window; the stop set: a change that leaves the stops alone rebuilds nothing; the stop scan), the world's change counters,
// the stop markers' build, and render/nightout.ts (activity string -> phase, the swim's strength through an evening).
// Run: npx tsx packages/client/scripts/lines-check.ts
import { CHUNK_SIZE, KIND_ID, familyOf, packTile, u16ToB64, i32ToB64, type ChunkDTO } from '@msimcity/shared';
import { ClientWorld } from '../src/world';
import { PreviewGate, LineWatcher, StopSet, collectStops, PREVIEW_GAP_MS } from '../src/linewatch';
import { StopMarks, type Mark } from '../src/render/stopmarks';
import { NightOut, phaseOf, swimShape, BAR_ACTIVITY, RAMP_HOURS, WALK_HOURS } from '../src/render/nightout';

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// ---- the preview gate ----------------------------------------------------------------------------------------------
{
  // a stream of changes every 20 ms for a second: one request per window, none closer than the gap, and one after the last change
  const g = new PreviewGate();
  const sent: number[] = [];
  let lastChange = 0;
  for (let t = 0; t <= 2000; t += 10) {
    if (t < 1000 && t % 20 === 0) { g.poke(t, 300); lastChange = t; }
    if (g.take(t)) sent.push(t);
  }
  ok(sent.length >= 3 && sent.length <= 4, `a second of road changes is ${sent.length} requests, not fifty`);
  ok(sent.every((t, i) => i === 0 || t - sent[i - 1] >= PREVIEW_GAP_MS), 'no two requests closer than 300 ms');
  ok(sent[sent.length - 1] >= lastChange, 'the last request is after the last change, so the route shown is the final one');
  ok(!g.pending, 'and nothing is owed once it went');
}
{
  const g = new PreviewGate();
  g.poke(1000, 300);
  ok(!g.take(1299) && g.take(1300), 'a single change under the draft asks for a route 300 ms on');
  g.poke(1400, 120);
  ok(!g.take(1599) && g.take(1600), 'an edit just after a request still waits out the 300 ms gap (due at 1600, not 1520)');
  const h = new PreviewGate();
  h.poke(0, 120);
  ok(!h.take(119) && h.take(120), 'a stop click asks in 120 ms');
  h.poke(150, 120); h.poke(200, 120); h.poke(260, 120);
  const at: number[] = [];
  for (let t = 260; t < 1000; t += 10) if (h.take(t)) at.push(t);
  ok(at.length === 1 && at[0] === 420, `three quick clicks go out as one request at the gap (${at.join(',')})`);
  h.poke(500, 120); h.drop();
  ok(!h.take(2000), 'a dropped draft owes nothing');
}

// ---- the watcher over the world's counters ---------------------------------------------------------------------------
{
  const v = { layoutVersion: 0, rulesVersion: 0, chunksVersion: 0 };
  const w = new LineWatcher(v);
  const ctx = { open: true, drafting: true, routable: true, listStale: false };
  let t = 0, previews = 0, stops = 0, lines = 0;
  const run = (ms: number, c = ctx) => { for (const end = t + ms; t < end; t += 10) { const a = w.step(t, c); previews += +a.preview; stops += +a.stops; lines += +a.lines; } };
  w.step(0, { ...ctx, open: false }); // the panel's frame runs while it is closed too, so the counters are already read when it opens
  run(500);
  ok(previews === 0 && stops === 0, 'nothing changed: no request, no rescan');
  // a road drawn tile by tile for 600 ms
  for (let i = 0; i < 30; i++) { v.layoutVersion++; run(20); }
  run(600);
  ok(previews >= 2 && previews <= 3, `a road laid over 600 ms re-routes the draft ${previews} times (once per window)`);
  ok(stops >= 2 && stops <= 3, `and looks for stops ${stops} times`);
  // a turn rule changes: a route, not a stop scan
  previews = stops = 0; v.rulesVersion++; run(800);
  ok(previews === 1 && stops === 0, 'a turn rule re-routes the draft and leaves the stops alone');
  // a chunk arriving as the view moves: stops, never a route
  previews = stops = 0; v.chunksVersion += 3; run(800);
  ok(previews === 0 && stops === 1, 'a chunk arriving rescans for stops and asks for no route');
  // a draft with one stop has nothing to route
  previews = stops = 0; v.layoutVersion++; run(800, { ...ctx, routable: false });
  ok(previews === 0 && stops === 1, 'a draft with one stop is not routed');
  // no draft, a line not running: the list is read again
  previews = stops = lines = 0; v.layoutVersion++; run(800, { open: true, drafting: false, routable: false, listStale: true });
  ok(lines === 1 && previews === 0, 'with no draft, a line that is not running has the list read again');
  lines = 0; v.layoutVersion++; run(800, { open: true, drafting: false, routable: false, listStale: false });
  ok(lines === 0, 'and when every line runs, nothing is asked');
  // closed: nothing
  previews = stops = lines = 0; v.layoutVersion++; run(800, { ...ctx, open: false });
  ok(previews + stops + lines === 0, 'a closed panel asks for nothing');
  // an edit and the world together stay inside the gap
  previews = 0; w.edited(t); v.layoutVersion++; run(50); v.layoutVersion++; run(50); w.edited(t); run(900);
  ok(previews <= 3, `edits and road changes mixed: ${previews} requests in a second`);
}

// ---- the world's counters ---------------------------------------------------------------------------------------------
const N = CHUNK_SIZE * CHUNK_SIZE;
const BUS = KIND_ID['bus-stop'];
const stopTile = (level = 1) => packTile(0, false, familyOf(BUS), level);
const roadTile = packTile(0, true, 0, 0);
const chunkDTO = (cx: number, cy: number, tiles: Uint16Array, sub: Uint8Array): ChunkDTO => ({ cx, cy, tiles: u16ToB64(tiles), parcels: i32ToB64(new Int32Array(N).fill(1)), sub: Buffer.from(sub).toString('base64') });
const world = new ClientWorld();
{
  world.me = 'me';
  world.parcels.set(1, { id: 1, owner: 'me' } as any);
  const tiles = new Uint16Array(N), sub = new Uint8Array(N);
  tiles[5 * CHUNK_SIZE + 5] = stopTile(); sub[5 * CHUNK_SIZE + 5] = BUS;
  tiles[9 * CHUNK_SIZE + 3] = stopTile(); sub[9 * CHUNK_SIZE + 3] = BUS;
  tiles[2 * CHUNK_SIZE + 2] = roadTile;
  const c0 = world.layoutVersion, k0 = world.chunksVersion;
  world.putChunk(chunkDTO(0, 0, tiles, sub));
  ok(world.chunksVersion === k0 + 1 && world.layoutVersion === c0, 'a chunk arriving bumps the chunk counter and not the layout counter');
  const l0 = world.layoutVersion;
  world.applyTiles([2, 2, roadTile, 1]);
  ok(world.layoutVersion === l0, 'a tile re-sent as it was bumps nothing');
  world.applyTiles([10, 10, roadTile, 1]);
  ok(world.layoutVersion === l0 + 1, 'a road laid bumps the layout counter');
  const l1 = world.layoutVersion;
  world.applyTiles([5, 5, stopTile(2), 1]);
  ok(world.layoutVersion === l1, 'a building growing a level does not');
  world.applyTiles([5, 5, packTile(0, false, 0, 0), 1]);
  ok(world.layoutVersion === l1 + 1, 'a stop knocked down does');
  world.applyTiles([5, 5, stopTile(), 1]);
  const l2 = world.layoutVersion;
  world.applyAux([7, 7, 3]);
  world.applyAux([7, 7, 3]);
  ok(world.layoutVersion === l2 + 1, 'an aux byte changing bumps once, the same byte again not at all');
  world.applySub([8, 8, 0]);
  ok(world.layoutVersion === l2 + 1, 'a sub byte unchanged bumps nothing');
}

// ---- the stop scan and the markers --------------------------------------------------------------------------------------
{
  const found = collectStops(world, ['bus']);
  ok(found.length === 2 && found[0].x === 5 && found[0].y === 5 && found[1].x === 3 && found[1].y === 9, `the scan finds the two bus stops (${found.map((s) => `${s.x},${s.y}`).join(' ')})`);
  ok(collectStops(world, ['rail', 'metro', 'ferry']).length === 0, 'and none of the other modes');
  ok(collectStops(world, ['rail', 'bus']).length === 2, 'a new line with no stop yet looks for every mode at once');
  world.parcels.set(1, { id: 1, owner: 'someone else' } as any);
  ok(collectStops(world, ['bus']).length === 0, 'stops on land you cannot use are not marked');
  world.parcels.set(1, { id: 1, owner: 'me' } as any);

  const set = new StopSet(), marks = new StopMarks();
  const build = (s: ReturnType<typeof collectStops>, draft: number[] = []) => marks.set(s.map((f, i): Mark => ({ x: f.x, y: f.y, mode: f.mode, radius: 0.5, top: 1, colour: draft.includes(i) ? 0xd94f4f : undefined })));
  let rebuilt = 0;
  const refresh = () => { if (set.update(collectStops(world, ['bus']))) { build(set.stops); rebuilt++; } };
  refresh();
  ok(rebuilt === 1 && marks.count === 2 && marks.group.visible, 'editing starts: the markers are built once, for both stops');
  world.applyTiles([12, 12, roadTile, 1]); refresh(); world.applyTiles([13, 12, roadTile, 1]); refresh();
  ok(rebuilt === 1, 'roads laid beside them rebuild nothing');
  const t2 = packTile(0, false, familyOf(BUS), 1);
  world.applyTiles([20, 20, t2, 1]); world.applySub([20, 20, BUS]);
  refresh(); refresh();
  ok(rebuilt === 2 && marks.count === 3, 'a stop built is picked up, and rebuilds the markers once');
  build(set.stops, [0, 2]);
  ok(marks.onDraft === 2 && marks.count === 3, 'stops on the draft are counted in the same pass');
  ok(marks.setHover(5, 5) && !marks.setHover(1, 1), 'the stop under the cursor is found by its door tile; other tiles are not');
  marks.clear();
  ok(marks.count === 0 && !marks.group.visible, 'no line being edited: nothing drawn');
}

// ---- the night out -----------------------------------------------------------------------------------------------------------
{
  const act: Record<string, string> = {
    'out at a bar': 'at', 'walking out for the evening': 'going', 'driving out for the evening': 'going', 'passenger in Ann Lee\'s car, going out': 'going',
    'walking home': 'home', 'driving home': 'home', 'stuck in traffic, driving home': 'home', 'bus 12 to the Market stop, going home': 'home',
    'at the cinema': 'sober', 'at the theatre': 'sober', 'watching a performance': 'sober', 'at a premiere': 'sober', 'at the quiz night': 'sober',
    'at a café': 'sober', 'at home': 'sober', 'at home, retired': 'sober', 'on shift': 'sober', 'walking to work': 'sober', 'moving to town: walking with a suitcase from the station to their new home': 'sober',
  };
  for (const [a, p] of Object.entries(act)) ok(phaseOf(a) === p, `"${a}" is ${p}`);
  ok(BAR_ACTIVITY === 'out at a bar', 'the bar string is the one the server and the rooms use');

  // an evening on a fake clock (game hours): out, the bar for two hours, the walk home, home
  const n = new NightOut(4242), s = n.shape;
  let h = 19, last = 0;
  const trace: number[] = [];
  n.update('walking out for the evening', h);
  ok(n.strength === 0, 'on the way out they are sober');
  h += 0.25;
  const arrive = n.update(BAR_ACTIVITY, h);
  ok(arrive === 0, 'sat down at the bar: nothing yet');
  let mono = true;
  for (let i = 0; i < 24; i++) { h += 0.1; const v = n.update(BAR_ACTIVITY, h); trace.push(v); if (v < last - 1e-9) mono = false; last = v; }
  ok(mono && trace[3] > 0 && trace[3] < trace[15], 'it builds as the evening goes on');
  ok(Math.abs(trace[trace.length - 1] - s.peak) < 1e-9, `and reaches this citizen's peak (${s.peak.toFixed(2)}) after ${RAMP_HOURS} hours`);
  ok(Math.abs(trace[Math.round(RAMP_HOURS / 0.1) / 2 - 1] - s.peak * 0.5) < s.peak * 0.12, 'half the ramp is about half the strength');
  const set = n.strength;
  const walk: number[] = [];
  mono = true; last = set;
  for (let i = 0; i <= 10; i++) { const v = n.update('walking home', h + (i * WALK_HOURS) / 10); walk.push(v); if (v > last + 1e-9) mono = false; last = v; }
  ok(mono && walk[0] <= set && walk[walk.length - 1] === 0, 'on the walk home it eases off and is gone at the end');
  ok(walk[5] > 0 && walk[5] < set, 'and is part way at the half of it');
  n.update('at home', h + 1);
  ok(n.strength === 0, 'at home they are sober');
  // the server's trip progress carries it too
  const m = new NightOut(7);
  m.update(BAR_ACTIVITY, 21); m.update(BAR_ACTIVITY, 23.5);
  const full = m.strength;
  const a1 = m.update('driving home', 23.51, 0.1), a2 = m.update('driving home', 23.52, 0.6), a3 = m.update('driving home', 23.53, 0.05);
  ok(a1 < full && a2 < a1 && a3 <= a2, 'the ease-off follows the trip when the server says, and never comes back up on a new leg');
  // sober venues never swim
  const c = new NightOut(99);
  c.update('walking to the cinema', 19); let top = 0;
  for (let i = 0; i < 30; i++) top = Math.max(top, c.update('at the cinema', 19.3 + i * 0.1));
  for (let i = 0; i < 8; i++) top = Math.max(top, c.update('walking home', 22.5 + i * 0.05));
  ok(top === 0, 'an evening at the cinema, and the walk home from it, stay clear');
  // someone first seen already at the bar has been there a while
  const j = new NightOut(31);
  ok(j.update(BAR_ACTIVITY, 22) > 0, 'a citizen first seen at the bar is already a little tipsy');
  // the shapes
  let pOk = true, varied = new Set<number>();
  for (let id = 1; id <= 200; id++) {
    const q = swimShape(id);
    if (q.period < 3 || q.period > 5 || q.amp < 2 || q.amp > 4.5 || q.peak < 0.7 || q.peak > 1 || q.blur > 2.5 || q.ghost > 6.5) pOk = false;
    varied.add(Math.round(q.period * 200));
  }
  ok(pOk, 'periods are 3 to 5 seconds and the sway a few pixels, for every citizen');
  ok(varied.size > 40, `and differ citizen to citizen (${varied.size} distinct periods in 200)`);
}

console.log(fails ? `${fails} FAILED` : 'lines-check: all ok');
process.exit(fails ? 1 : 0);
