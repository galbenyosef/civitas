/**
 * traffic.ts `hypot` against Math.hypot, bit for bit (docs/search-perf.md, the traffic step): the edge cases and 20
 * million pairs at the scales the game uses and well beyond. Exits 1 on any difference.
 *
 *   npx tsx packages/server/src/loadtest/hypot-check.ts
 */
import { hypot } from '../sim/traffic';

const same = (a: number, b: number) => (a === b && (a !== 0 || 1 / a === 1 / b)) || (a !== a && b !== b);
let bad = 0, total = 0;
const check = (x: number, y: number) => {
  total++;
  const a = Math.hypot(x, y), b = hypot(x, y);
  if (!same(a, b) && bad++ < 10) console.log(`differ: hypot(${x}, ${y}) = ${a} (Math.hypot) against ${b}`);
};
const edge = [0, -0, 1, -1, Infinity, -Infinity, NaN, 1e-300, 1e300, 5e-324, Number.MAX_VALUE, 0.5, 0.1, 0.2, 0.3];
for (const x of edge) for (const y of edge) check(x, y);
let s = 12345;
const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
for (let i = 0; i < 20_000_000; i++) {
  const k = i % 4;
  if (k === 0) check(rnd() - 0.5, rnd() - 0.5);
  else if (k === 1) check((rnd() - 0.5) * 1e-3, (rnd() - 0.5) * 2);
  else if (k === 2) check((rnd() - 0.5) * 10 ** (rnd() * 40 - 20), (rnd() - 0.5) * 10 ** (rnd() * 40 - 20));
  else check(Math.round((rnd() - 0.5) * 2000) / 100, Math.round((rnd() - 0.5) * 2000) / 100);
}
console.log(`hypot: ${total} pairs, ${bad} different from Math.hypot`);
process.exit(bad ? 1 : 0);
