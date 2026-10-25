/**
 * Top self-time functions from a .cpuprofile (as written by run.ts --profile, node --cpu-prof, or POST /api/perf/profile).
 *
 *   npx tsx packages/server/src/loadtest/profile-summary.ts /path/to/run.cpuprofile [top=15] [--callers fnName]
 *
 * With --callers, also splits the inclusive time of every call to that function by the function that called it.
 * `summarizeProfile` is the same top list as a value, for the server's profile endpoint (perf/monitor.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ProfNode { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; children?: number[] }
export interface Profile { nodes: ProfNode[]; startTime: number; endTime: number; samples?: number[]; timeDeltas?: number[] }
export interface ProfileSummary { totalMs: number; top: { selfMs: number; pct: number; fn: string }[] }

const label = (n: ProfNode) => {
  const f = n.callFrame;
  const where = f.url ? `${f.url.replace(/^file:\/\//, '').replace(/.*\/packages\//, 'packages/').replace(/.*\/node_modules\//, 'node_modules/')}:${f.lineNumber + 1}` : '';
  return `${f.functionName || '(anonymous)'}${where ? '  ' + where : ''}`;
};

/** self time per node id, µs */
function selfTimes(p: Profile): Map<number, number> {
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
  return selfUs;
}

/** The `top` functions by self time, with the share of all samples. */
export function summarizeProfile(p: Profile, top = 15): ProfileSummary {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const agg = new Map<string, number>();
  let total = 0;
  for (const [id, us] of selfTimes(p)) {
    const key = label(byId.get(id)!);
    agg.set(key, (agg.get(key) ?? 0) + us);
    total += us;
  }
  const rows = [...agg].sort((a, b) => b[1] - a[1]).slice(0, top).map(([fn, us]) => ({ selfMs: Math.round(us / 1000), pct: Math.round((us / total) * 1000) / 10, fn }));
  return { totalMs: Math.round(total / 1000), top: rows };
}

/** The inclusive time of every outermost call to `fnName`, split by caller. */
export function callersOf(p: Profile, fnName: string): { totalMs: number; pct: number; byCaller: { ms: number; pct: number; fn: string }[] } {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const selfUs = selfTimes(p);
  let total = 0; for (const us of selfUs.values()) total += us;
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
  const isTarget = (id: number) => byId.get(id)!.callFrame.functionName === fnName;
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
  return { totalMs: Math.round(sum / 1000), pct: Math.round((sum / total) * 1000) / 10, byCaller: [...byCaller].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([fn, us]) => ({ ms: Math.round(us / 1000), pct: Math.round((us / total) * 1000) / 10, fn })) };
}

/** the top list as the CLI prints it */
export function formatSummary(s: ProfileSummary): string {
  return [`total sampled ${(s.totalMs / 1000).toFixed(2)} s`, 'self ms    self %  function', ...s.top.map((r) => `${String(r.selfMs).padStart(7)}  ${r.pct.toFixed(1).padStart(6)}%  ${r.fn}`)].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--callers');
  const fn = ci >= 0 ? args.splice(ci, 2)[1] : null;
  const [file, topArg] = args;
  if (!file) { console.error('usage: profile-summary.ts <file.cpuprofile> [top] [--callers fnName]'); process.exit(1); }
  const p: Profile = JSON.parse(readFileSync(file, 'utf8'));
  console.log(formatSummary(summarizeProfile(p, Number(topArg ?? 15))));
  if (fn) {
    const c = callersOf(p, fn);
    console.log(`\n${fn}: ${c.totalMs} ms inclusive (${c.pct}% of samples), by caller`);
    for (const r of c.byCaller) console.log(`${String(r.ms).padStart(7)}  ${r.pct.toFixed(1).padStart(6)}%  ${r.fn}`);
  }
}
