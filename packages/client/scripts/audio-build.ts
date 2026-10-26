// Audio v2: turn the downloaded Freesound previews into the shipped Opus files, CREDITS.ts and CREDITS.md.
//   npx tsx packages/client/scripts/audio-build.ts --dl <downloads dir> [--only id,id] [--kbps 48] [--picks file.json]
// Reads <dl>/candidates.json (freesound-fetch.ts), or the ids in scripts/audio-picks.json when a voice is listed there (a hand pick wins:
// { "wind": [361053], "bird": [350593, 507264] }), and for each pick: trims leading and trailing silence, cuts a bed or ride to a loop of
// 8 to 18 s whose tail is cross-faded into its head (so the file loops with no seam), caps an event at its length, normalises loudness
// in two passes (linear, no pumping: beds -23 LUFS, rides -21, events -18), fades the ends of an event, makes it mono 48 kHz and encodes
// Opus into src/audio/files/<voice>[-n].opus. Then it writes src/audio/credits.ts (the table the manifest and audio-check read) and
// src/audio/CREDITS.md (one row a clip: voice, Freesound id and link, title, author, licence, length, the query, what was done).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { VOICE_QUERIES } from './audio-voices';
import type { Candidate } from './freesound-fetch';

const args = process.argv.slice(2);
const opt = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DL = resolve(opt('dl', process.env.AUDIO_DL || 'freesound-downloads'));
const ONLY = new Set(opt('only').split(',').filter(Boolean));
const KBPS_ALL = Number(opt('kbps', '48'));
const here = new URL('.', import.meta.url).pathname;
const AUDIO = resolve(here, '../src/audio');
const FILES = join(AUDIO, 'files');
const PICKS: Record<string, number[]> = existsSync(opt('picks', join(here, 'audio-picks.json'))) ? JSON.parse(readFileSync(opt('picks', join(here, 'audio-picks.json')), 'utf8')) : {};
const LOOP_X = 1.5; // seconds of tail cross-faded into the head
const TARGET = { bed: -23, ride: -21, event: -18 } as const;
const SIL = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02:detection=peak';

const run = (bin: string, a: string[]) => execFileSync(bin, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
const probeDur = (f: string) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim());
/** ffmpeg writes loudnorm's measurement to stderr; execFileSync throws on non-zero only, so read it from a spawn */
function measure(input: string, filter: string, target: number): Record<string, string> {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-af', `${filter}loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /\{[\s\S]*?\}/.exec(String(r.stderr).split('Parsed_loudnorm').pop() ?? '') ?? /\{[\s\S]*\}/.exec(String(r.stderr));
  if (!m) throw new Error(`no loudnorm measurement for ${input}`);
  return JSON.parse(m[0]);
}

/** the highest sample level in dBFS after a filter, from ffmpeg's volumedetect */
function peakDb(input: string, filter: string): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-af', `${filter}volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume: (-?[\d.]+) dB/.exec(String(r.stderr));
  return m ? Number(m[1]) : 0;
}

interface Out { voice: string; file: string; c: Candidate; cls: string; level: number; shipped: number; bytes: number; norm: string }

/** the time of the loudest 50 ms in a file, seconds (a pass-by's moment of passing) */
function loudestAt(input: string): number {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4)), w = 400;
  let best = 0, at = 0;
  for (let i = 0; i + w <= x.length; i += w) { let e = 0; for (let k = i; k < i + w; k++) e += x[k] * x[k]; if (e > best) { best = e; at = i; } }
  return (at + w / 2) / 8000;
}

function encode(voiceCls: 'bed' | 'ride' | 'event', src: string, out: string, maxSec: number, extra = '', o: { kbps?: number; period?: number; peak?: number } = {}): { shipped: number; norm: string } {
  const srcDur = probeDur(src), KBPS = o.kbps ?? KBPS_ALL;
  const target = TARGET[voiceCls];
  let pre: string, note: string;
  if (voiceCls === 'event') {
    // silence off both ends, then at most maxSec
    const trimmed = join(tmpdir(), `civitas-audio-${process.pid}-trim.wav`);
    run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-af', `${SIL},areverse,${SIL},areverse,aformat=channel_layouts=mono,aresample=48000,highpass=f=40${extra ? `,${extra}` : ''}`, trimmed]);
    const td = probeDur(trimmed), len = Math.min(td, maxSec), capped = td > maxSec + 0.01;
    // a pass-by: the window round its loudest moment, faded in as well as out (it is cut from the middle of a sound)
    const from = o.peak !== undefined && capped ? Math.max(0, Math.min(td - len, loudestAt(trimmed) - o.peak * len)) : 0;
    const fadeOut = capped ? Math.min(0.35, len * 0.2) : Math.min(0.06, len * 0.2), fadeIn = from > 0 ? Math.min(0.35, len * 0.2) : 0.01;
    pre = `atrim=${from.toFixed(3)}:${(from + len).toFixed(3)},asetpts=PTS-STARTPTS,`;
    const post = `afade=t=in:d=${fadeIn.toFixed(3)},afade=t=out:st=${(len - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`;
    const m = measure(trimmed, pre, target);
    // a clip under about 0.4 s is too short for a loudness reading (-inf): set its peak to -3 dBFS instead
    const ln = Number.isFinite(Number(m.input_i)) && Number(m.input_i) > -60
      ? `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
      : `volume=${(-3 - peakDb(trimmed, pre)).toFixed(2)}dB`;
    run('ffmpeg', ['-y', '-v', 'error', '-i', trimmed, '-af', `${pre}${ln},aresample=48000,${post}`, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', `${KBPS}k`, '-application', 'audio', out]);
    rmSync(trimmed, { force: true });
    note = `silence trimmed${extra ? `, ${extra}` : ''}${capped ? `, cut to ${len.toFixed(1)} s${from > 0 ? ` from ${from.toFixed(1)} s (round its loudest moment: the pass)` : ''}` : ''}, ${target} LUFS, fades ${Math.round(fadeIn * 1000)} ms in / ${Math.round(fadeOut * 1000)} ms out`;
  } else {
    // a loop: L seconds from the middle of the source, its tail (LOOP_X s past L) cross-faded into its head
    // a source that repeats (a siren) is cut to whole cycles with a short cross-fade: the tail past L is the same moment of the cycle as the head
    const x = o.period ? 0.3 : Math.min(LOOP_X, Math.max(0.5, srcDur / 8));
    const L = o.period ? o.period * Math.max(1, Math.floor(Math.min(maxSec, srcDur - x - 0.2) / o.period)) : Math.max(4, Math.min(maxSec, srcDur - x - 0.2));
    const off = Math.max(0, (srcDur - (L + x)) / 2);
    const g = `atrim=${off.toFixed(3)}:${(off + L + x).toFixed(3)},asetpts=PTS-STARTPTS,aformat=channel_layouts=mono,aresample=48000,highpass=f=30,${o.period ? 'dynaudnorm=f=250:g=15:p=0.9,' : ''}asplit[a][b];[a]atrim=0:${L.toFixed(3)},asetpts=PTS-STARTPTS[h];[b]atrim=${L.toFixed(3)}:${(L + x).toFixed(3)},asetpts=PTS-STARTPTS[t];[t][h]acrossfade=d=${x.toFixed(3)}:c1=qsin:c2=qsin`;
    const looped = join(tmpdir(), `civitas-audio-${process.pid}-loop.wav`);
    run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-filter_complex', g, looped]);
    const m = measure(looped, '', target);
    const ln = `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    run('ffmpeg', ['-y', '-v', 'error', '-i', looped, '-af', `${ln},aresample=48000`, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', `${KBPS}k`, '-application', 'audio', out]);
    rmSync(looped, { force: true });
    note = `a ${L.toFixed(1)} s loop${o.period ? ` (${Math.round(L / o.period)} cycle${Math.round(L / o.period) > 1 ? 's' : ''} of ${o.period} s, the level evened out so the recording's approach does not swell at each turn)` : ''} from ${off.toFixed(0)} s in, ${x.toFixed(1)} s tail cross-faded into the head, ${target} LUFS`;
  }
  return { shipped: probeDur(out), norm: `${note}; mono 48 kHz Opus ${KBPS} kbps` };
}

function main() {
  mkdirSync(FILES, { recursive: true });
  const cands = JSON.parse(readFileSync(join(DL, 'candidates.json'), 'utf8')) as Record<string, { picks: Candidate[]; runnersUp: Candidate[] }>;
  const prior: Out[] = existsSync(join(AUDIO, 'credits.json')) ? JSON.parse(readFileSync(join(AUDIO, 'credits.json'), 'utf8')) : [];
  const keep = prior.filter((o) => ONLY.size && !ONLY.has(o.voice));
  const outs: Out[] = [...keep];
  for (const v of VOICE_QUERIES) {
    if (ONLY.size && !ONLY.has(v.id)) continue;
    const e = cands[v.id];
    if (!e) { console.log(`${v.id}: no candidates`); continue; }
    const pool = [...e.picks, ...e.runnersUp];
    const chosen = (PICKS[v.id] ? PICKS[v.id].map((id) => pool.find((c) => c.id === id)).filter(Boolean) : e.picks.slice(0, v.takes)) as Candidate[];
    for (const f of readdirSync(FILES)) if (f === `${v.id}.opus` || new RegExp(`^${v.id}-\\d+\\.opus$`).test(f)) rmSync(join(FILES, f));
    chosen.forEach((c, i) => {
      const src = join(DL, v.id, `${c.id}.ogg`), file = `${v.id}${i ? `-${i + 1}` : ''}.opus`;
      if (!existsSync(src)) { console.log(`${v.id}: ${src} missing`); return; }
      try {
        const r = encode(v.cls, src, join(FILES, file), v.maxSec, v.post, { kbps: v.kbps, period: v.period, peak: v.peak });
        const bytes = statSync(join(FILES, file)).size;
        outs.push({ voice: v.id, file, c, cls: v.cls, level: v.level, shipped: Math.round(r.shipped * 10) / 10, bytes, norm: r.norm });
        console.log(`${file.padEnd(18)} ${r.shipped.toFixed(1).padStart(5)} s ${(bytes / 1024).toFixed(0).padStart(4)} KB  ${c.id} ${c.name.slice(0, 40)}`);
      } catch (err) { console.log(`${file}: ${(err as Error).message.split('\n')[0]}`); }
    });
  }
  const take = (f: string) => Number(/-(\d+)\.opus$/.exec(f)?.[1] ?? 1);
  const order = new Map(VOICE_QUERIES.map((v, i) => [v.id, i] as const));
  outs.sort((a, b) => (order.get(a.voice)! - order.get(b.voice)!) || take(a.file) - take(b.file));
  writeFileSync(join(AUDIO, 'credits.json'), JSON.stringify(outs, null, 1));
  // credits.ts: what the manifest and audio-check read
  const rows = outs.map((o) => `  { voice: '${o.voice}', file: '${o.file}', freesound: ${o.c.id}, title: ${JSON.stringify(o.c.name)}, author: ${JSON.stringify(o.c.username)}, licence: 'CC0', seconds: ${o.shipped}, bytes: ${o.bytes}, level: ${o.level}, query: ${JSON.stringify(o.c.query)} },`);
  writeFileSync(join(AUDIO, 'credits.ts'), `// Generated by scripts/audio-build.ts from scripts/audio-voices.ts and the Freesound previews: do not edit by hand (docs/audio.md, "Recordings").
export interface Clip { voice: string; file: string; freesound: number; title: string; author: string; licence: 'CC0'; seconds: number; bytes: number; level: number; query: string }
export const CLIPS: readonly Clip[] = [
${rows.join('\n')}
];
`);
  const total = outs.reduce((s, o) => s + o.bytes, 0);
  const md = [
    '# Recordings: credits', '',
    'Every clip is from [Freesound.org](https://freesound.org), licensed **Creative Commons 0** (public domain dedication): no attribution is required, and it is given here as good manners. Each row is one shipped file in `files/`.',
    'Regenerated by `scripts/audio-build.ts`; see docs/audio.md ("Recordings") to swap a clip.', '',
    `${outs.length} clips, ${(total / 1048576).toFixed(2)} MB in all.`, '',
    '| voice | file | Freesound | title | author | licence | s | query | score | what was done |', '|---|---|---|---|---|---|---|---|---|---|',
    ...outs.map((o) => `| ${o.voice} | ${o.file} | [${o.c.id}](${o.c.url}) | ${o.c.name.replace(/\|/g, '/')} | [${o.c.username}](https://freesound.org/people/${encodeURIComponent(o.c.username)}/) | CC0 | ${o.shipped} | ${o.c.query} | ${o.c.score} | ${o.norm} |`),
    '',
  ];
  writeFileSync(join(AUDIO, 'CREDITS.md'), md.join('\n'));
  console.log(`${outs.length} clips, ${(total / 1048576).toFixed(2)} MB`);
}
main();
