/**
 * Dev aid for the city-map kit: prints a sample city's plan as text (one character a tile) with its placements and
 * the scenario's problems. `npx tsx packages/server/src/demo/citymap-ascii.ts paris [x0 y0 x1 y1]`
 */
import { DEMO_BY_ID, cityScenario, LT, KIND_ID, placedFromDoor, isMultiTile, type DemoId } from '@msimcity/shared';

const [id, ...box] = process.argv.slice(2);
const d = DEMO_BY_ID.get(id as DemoId);
if (!d?.city) { console.error(`not a sample city: ${id}`); process.exit(1); }
const { plan, grid: g, problems, sections } = cityScenario(d.city);
const [x0, y0, x1, y1] = box.length === 4 ? box.map(Number) : [g.MX, g.MY, g.MX + g.MW - 1, g.MY + g.MH - 1];
const ch = new Map<number, string>();
const K = KIND_ID as Record<string, number>;
for (const s of sections) for (const p of s.placements ?? []) {
  const k = K[p.kind];
  const mark = p.kind === 'bus-stop' ? 'b' : p.kind.startsWith('metro') ? 'm' : p.kind.startsWith('rail') ? 'S' : p.kind === 'ferry-pier' ? 'P' : 'L';
  if (k && isMultiTile(k)) { const q = placedFromDoor(k, p.door[0], p.door[1], p.rot ?? 0); for (let y = q.ay; y < q.ay + q.h; y++) for (let x = q.ax; x < q.ax + q.w; x++) ch.set(g.idx(x, y), mark); }
  ch.set(g.idx(p.door[0], p.door[1]), mark === 'L' ? 'D' : mark);
}
const T = ['.', '~', '#', 'A', '"', 'K', '+', 'x', '='];
for (let y = y0; y <= y1; y++) {
  let row = `${String(y).padStart(4)} `;
  for (let x = x0; x <= x1; x++) {
    if (!g.inMap(x, y)) { row += ' '; continue; }
    const i = g.idx(x, y);
    row += ch.get(i) ?? (plan.t[i] === LT.Road && plan.cls[i] === 3 ? '*' : T[plan.t[i]]);
  }
  console.log(row);
}
console.log(`x from ${x0}; problems (${problems.length}):\n  ${problems.join('\n  ')}`);
console.log(`blocks ${plan.blocks.length}, avenues ${plan.avenues.length}, bridges ${plan.bridges.map((b) => `${b.name} (${b.x},${b.y}) ${b.len}${b.ns ? 'ns' : 'ew'}`).join('; ')}`);
