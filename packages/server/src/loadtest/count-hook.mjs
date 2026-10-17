// ESM loader hook for the load test (Node 20.2 has no module.register, so run.ts passes this with --loader).
// It appends wrappers to pathfinding.ts that count calls and time spent per search function. Exported function
// declarations are mutable bindings, so reassigning them here also changes what every importer calls.
const WRAP = ['findPath', 'findBest', 'findRoute'];
export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (!/\/server\/src\/pathfinding\.ts$/.test(url.split('?')[0])) return r;
  let src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8');
  src += '\n;globalThis.__pfCalls = globalThis.__pfCalls || {}; globalThis.__pfMs = globalThis.__pfMs || {};\n';
  for (const n of WRAP) {
    src += `globalThis.__pfCalls.${n} = 0; globalThis.__pfMs.${n} = 0;\n` +
      `{ const o = ${n}; ${n} = function (...a) { globalThis.__pfCalls.${n}++; const t = performance.now();` +
      ` try { return o.apply(this, a); } finally { globalThis.__pfMs.${n} += performance.now() - t; } }; }\n`;
  }
  return { ...r, source: src };
}
