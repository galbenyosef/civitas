/**
 * Top self-time functions from a .cpuprofile (as written by run.ts --profile or node --cpu-prof).
 *
 *   npx tsx packages/server/src/loadtest/profile-summary.ts /path/to/run.cpuprofile [top=15] [--callers fnName]
 *
 * With --callers, also splits the inclusive time of every call to that function by the function that called it.
 */
import { readFileSync } from 'node:fs';

interface ProfNode { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; children?: number[] }
interface Profile { nodes: ProfNode[]; startTime: number; endTime: number; samples?: number[]; timeDeltas?: number[] }

const args = process.argv.slice(2);
const ci = args.indexOf('--callers');
const callersOf = ci >= 0 ? args.splice(ci, 2)[1] : null;
const [file, topArg] = args;
if (!file) { console.error('usage: profile-summary.ts <file.cpuprofile> [top]'); process.exit(1); }
const p: Profile = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const selfUs = new Map<number, number>();
if (p.samples && p.timeDeltas) {
  // time of a sample is the delta to the next one
  for (let i = 0; i < p.samples.length; i++) {
    const dt = p.timeDeltas[i + 1] ?? 0;
    selfUs.set(p.samples[i], (selfUs.get(p.samples[i]) ?? 0) + dt);
  }
} else {
  const total = p.endTime - p.startTime, hits = p.nodes.reduce((s, n) => s + (n.hitCount ?? 0), 0) || 1;
  for (const n of p.nodes) selfUs.set(n.id, ((n.hitCount ?? 0) / hits) * total);
}
const label = (n: ProfNode) => {
  const f = n.callFrame;
  const where = f.url ? `${f.url.replace(/^file:\/\//, '').replace(/.*\/packages\//, 'packages/').replace(/.*\/node_modules\//, 'node_modules/')}:${f.lineNumber + 1}` : '';
  return `${f.functionName || '(anonymous)'}${where ? '  ' + where : ''}`;
};
const agg = new Map<string, number>();
let total = 0;
for (const [id, us] of selfUs) {
  const key = label(byId.get(id)!);
  agg.set(key, (agg.get(key) ?? 0) + us);
  total += us;
}
const top = [...agg].sort((a, b) => b[1] - a[1]).slice(0, Number(topArg ?? 15));
console.log(`total sampled ${(total / 1e6).toFixed(2)} s`);
console.log('self ms    self %  function');
for (const [k, us] of top) console.log(`${(us / 1000).toFixed(0).padStart(7)}  ${((us / total) * 100).toFixed(1).padStart(6)}%  ${k}`);

if (callersOf) {
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const inclusive = new Map<number, number>();
  const incl = (id: number): number => {
    const cached = inclusive.get(id);
    if (cached !== undefined) return cached;
    let t = selfUs.get(id) ?? 0;
    for (const c of byId.get(id)!.children ?? []) t += incl(c);
    inclusive.set(id, t);
    return t;
  };
  // the outermost frame of the target on each stack, so recursion and wrappers are not counted twice
  const isTarget = (id: number) => byId.get(id)!.callFrame.functionName === callersOf;
  const byCaller = new Map<string, number>();
  let sum = 0;
  for (const n of p.nodes) {
    if (!isTarget(n.id)) continue;
    let up = parent.get(n.id), outer = true;
    for (let a = up; a !== undefined; a = parent.get(a)) if (isTarget(a)) { outer = false; break; }
    if (!outer) continue;
    // skip wrapper frames (the counting hook's anonymous function) to name the real caller
    while (up !== undefined && !byId.get(up)!.callFrame.functionName) up = parent.get(up);
    const key = up !== undefined ? label(byId.get(up)!) : '(root)';
    const t = incl(n.id);
    byCaller.set(key, (byCaller.get(key) ?? 0) + t);
    sum += t;
  }
  console.log(`\n${callersOf}: ${(sum / 1000).toFixed(0)} ms inclusive (${((sum / total) * 100).toFixed(1)}% of samples), by caller`);
  for (const [k, us] of [...byCaller].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${(us / 1000).toFixed(0).padStart(7)}  ${((us / total) * 100).toFixed(1).padStart(6)}%  ${k}`);
}
