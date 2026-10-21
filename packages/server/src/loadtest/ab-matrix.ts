/**
 * Run a matrix of traffic A/B configurations (ab.ts) over several seeds in parallel and print a markdown table
 * of the means.
 *
 *   npx tsx packages/server/src/loadtest/ab-matrix.ts --hours 8,17 --seeds 1,2,3 --jobs 6 \
 *     --row "baseline=" --row "no T lights=signalT=0" ...
 *
 * Each --row is "label=set" where set is the ab.ts --set string (may be empty). Rows run in the order given;
 * a row whose set starts with "+" adds to the previous row's set. --json FILE appends every run's raw result.
 * --table smooth prints the smoothness columns (stops per 10 tiles, jerk, standing in the stream, ms per tick).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AbResult } from './ab';

const argv = process.argv.slice(2);
const all = (n: string) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const get = (n: string) => all(n)[0];
const hours = (get('hours') ?? '8').split(',').map(Number);
const seeds = (get('seeds') ?? '1,2,3').split(',').map(Number);
const ticks = Number(get('ticks') ?? 1500);
const jobs = Number(get('jobs') ?? 6);
const rows: { label: string; set: string }[] = [];
for (const r of all('row')) {
  const i = r.indexOf('=');
  const label = r.slice(0, i), set0 = r.slice(i + 1);
  const set = set0.startsWith('+') ? [rows[rows.length - 1]?.set, set0.slice(1)].filter(Boolean).join(',') : set0;
  rows.push({ label, set });
}
const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ab-'));

interface Job { row: number; hour: number; seed: number; out: string }
const queue: Job[] = [];
rows.forEach((_, row) => hours.forEach((hour) => seeds.forEach((seed) => queue.push({ row, hour, seed, out: join(tmp, `${row}-${hour}-${seed}.json`) }))));
const results = new Map<string, AbResult>();

async function runOne(j: Job) {
  await new Promise<void>((res, rej) => {
    const args = ['tsx', join(here, 'ab.ts'), '--quiet', '--hour', String(j.hour), '--ticks', String(ticks), '--seed', String(j.seed), '--json', j.out, '--label', rows[j.row].label];
    if (rows[j.row].set) args.push('--set', rows[j.row].set);
    const p = spawn('nice', ['-n', '10', 'npx', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${rows[j.row].label} h${j.hour} s${j.seed} exited ${code}`))));
  });
  results.set(`${j.row}-${j.hour}-${j.seed}`, JSON.parse(readFileSync(j.out, 'utf8').trim().split('\n').pop()!));
}
const t0 = Date.now();
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => { while (next < queue.length) await runOne(queue[next++]); }));
process.stderr.write(`[matrix] ${queue.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f1 = (v: number) => v.toFixed(1), f3 = (v: number) => v.toFixed(3);
const json = get('json');
// --table smooth: the smoothness columns (docs/traffic-tuning.md "Smooth flow") instead of the give-up breakdown
if (get('table') === 'smooth') {
  for (const hour of hours) {
    console.log(`\n**${String(hour).padStart(2, '0')}:00, ${ticks} ticks, mean of seeds ${seeds.join(', ')}**\n`);
    console.log('| setting | stops / 10 tiles | dead stops / 10 tiles | jerk (tiles/tick²) | harsh % | standing in the stream % | speed % | queued % | give-ups | of which in a box | driver commute (ticks) | junction entries / tick | car–car / tick (path / drawn) | car–ped / tick (drawn) | ms / tick |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    rows.forEach((r, row) => {
      const rs = seeds.map((s) => results.get(`${row}-${hour}-${s}`)!);
      if (json) for (const x of rs) appendFileSync(json, JSON.stringify(x) + '\n');
      const m = (f: (x: AbResult) => number) => mean(rs.map(f));
      const f2 = (v: number) => v.toFixed(2);
      console.log(`| ${r.label} | ${f2(m((x) => x.smooth.stopsPer10))} | ${f2(m((x) => (10 * x.smooth.deadStops) / (x.smooth.tiles || 1)))} | ${f3(m((x) => x.smooth.jerk))} | ${f1(m((x) => x.smooth.harshPct))} | ${f1(m((x) => x.smooth.standStreamPct))} | ${f1(m((x) => x.speedPct))} | ${f1(m((x) => x.queuedPct))} | ${f1(m((x) => x.giveUps))} | ${f1(m((x) => x.counters.stuckInBox ?? 0))} | ${f1(m((x) => x.driveCommuteMean))} | ${f1(m((x) => x.junctionEntriesPerTick))} | ${f3(m((x) => x.ccPerTick))} / ${f3(m((x) => x.ccDrawnPerTick))} | ${f3(m((x) => x.cpDrawnPerTick))} | ${f2(m((x) => x.simMsPerTick))} |`);
    });
  }
  console.log('\nSettings:\n');
  rows.forEach((r) => console.log(`- **${r.label}**: \`${r.set || '(defaults)'}\``));
  process.exit(0);
}
for (const hour of hours) {
  console.log(`\n**${String(hour).padStart(2, '0')}:00, ${ticks} ticks, mean of seeds ${seeds.join(', ')}**\n`);
  console.log('| setting | speed % | queued % | first-hour queued % | give-ups (sent home + removed) | of which inside a box | kerb+walk / withdrawn | commute mean (drivers) ticks | commutes | junction entries / tick | car–car / tick | car–ped / tick | as drawn: car–car / car–ped |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  rows.forEach((r, row) => {
    const rs = seeds.map((s) => results.get(`${row}-${hour}-${s}`)!);
    if (json) for (const x of rs) appendFileSync(json, JSON.stringify(x) + '\n');
    const m = (f: (x: AbResult) => number) => mean(rs.map(f));
    console.log(`| ${r.label} | ${f1(m((x) => x.speedPct))} | ${f1(m((x) => x.queuedPct))} | ${f1(m((x) => x.firstHourQueuedPct))} | ${f1(m((x) => x.counters.stuckHome + x.counters.stuckDespawn))} | ${f1(m((x) => x.counters.stuckInBox ?? 0))} | ${f1(m((x) => x.counters.abandonKerb))} / ${f1(m((x) => x.counters.abandonDespawn))} | ${f1(m((x) => x.commuteMean))} (${f1(m((x) => x.driveCommuteMean))}) | ${f1(m((x) => x.commutes))} | ${f1(m((x) => x.junctionEntriesPerTick))} | ${f3(m((x) => x.ccPerTick))} | ${f3(m((x) => x.cpPerTick))} | ${f3(m((x) => x.ccDrawnPerTick ?? 0))} / ${f3(m((x) => x.cpDrawnPerTick ?? 0))} |`);
  });
}
console.log('\nSettings:\n');
rows.forEach((r) => console.log(`- **${r.label}**: \`${r.set || '(defaults)'}\``));
