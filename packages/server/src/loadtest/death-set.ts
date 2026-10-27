/**
 * loadtest/death.ts with TRAFFIC_TUNING overrides: SET="pedRetreatOnce=0,..." npx tsx packages/server/src/loadtest/death-set.ts
 * [--seed N] [--quiet]; TRACE=1 adds the hearse tracer (hearse-trace.ts).
 */
import { TRAFFIC_TUNING } from '@msimcity/shared';
for (const kv of (process.env.SET ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); (TRAFFIC_TUNING as unknown as Record<string, number>)[k] = Number(v); }
if (process.env.TRACE) await import('./hearse-trace');
await import('./death');
