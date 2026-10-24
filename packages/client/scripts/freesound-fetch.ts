// Audio v2: find CC0 recordings on Freesound.org for every voice in audio-voices.ts, score them, and download the best previews.
//   source ~/.config/civitas/freesound.env     (FREESOUND_API_KEY; never printed, never written to a file)
//   npx tsx packages/client/scripts/freesound-fetch.ts [--only id,id] [--dry] [--out dir] [--pool n]
// It reads the key from the environment, sends it as an Authorization header (so it is in no URL, log or cache file), searches with the
// CC0 licence filter, paces itself under 60 calls a minute, caches every response as JSON in <out>/search/, downloads the top takes' hq Ogg
// previews to <out>/<voice>/<freesound id>.ogg (the originals need OAuth2 and are not used), and writes <out>/candidates.json and
// <out>/candidates.md. audio-build.ts turns the picks into the shipped Opus files. --dry searches and scores but downloads nothing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { VOICE_QUERIES, type VoiceQuery } from './audio-voices';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = resolve(opt('out', process.env.AUDIO_DL || 'freesound-downloads'));
const ONLY = new Set(opt('only').split(',').filter(Boolean));
const DRY = flag('dry');
const POOL = Number(opt('pool', '40'));
const KEY = process.env.FREESOUND_API_KEY || '';
/** hand picks beat the score: { "veh-boat": [135472, 99], ... } in scripts/audio-picks.json (a voice listed there ships exactly those ids, in that order) */
const PICKS: Record<string, number[]> = existsSync(join(new URL('.', import.meta.url).pathname, 'audio-picks.json')) ? JSON.parse(readFileSync(join(new URL('.', import.meta.url).pathname, 'audio-picks.json'), 'utf8')) : {};
const FIELDS = 'id,name,username,license,duration,avg_rating,num_ratings,num_downloads,samplerate,channels,previews,tags,description';
const GAP_MS = 1300; // about 46 calls a minute

export interface Candidate {
  id: number; name: string; username: string; license: string; duration: number; rating: number; ratings: number; downloads: number;
  samplerate: number; channels: number; tags: string[]; description: string; preview: string; url: string; score: number; why: string; query: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let lastCall = 0, calls = 0;

async function api(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const cache = join(OUT, 'search', `${createHash('sha1').update(path + qs).digest('hex').slice(0, 16)}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  if (!KEY) throw new Error('FREESOUND_API_KEY is not set (source ~/.config/civitas/freesound.env)');
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now(); calls++;
    const res = await fetch(`https://freesound.org/apiv2/${path}?${qs}`, { headers: { Authorization: `Token ${KEY}` } });
    if (res.status === 429) { const s = 30 * (attempt + 1); console.log(`429 from Freesound: backing off ${s} s`); await sleep(s * 1000); continue; }
    if (res.status === 401) throw new Error('401 from Freesound: the token was refused; stopping');
    if (!res.ok) throw new Error(`Freesound ${res.status} for ${path} ${qs.slice(0, 80)}`);
    const j = await res.json();
    writeFileSync(cache, JSON.stringify(j));
    return j;
  }
  throw new Error('Freesound kept answering 429; stopping');
}

const words = (c: { name: string; tags: string[]; description: string }) => `${c.name} ${c.tags.join(' ')} ${c.description}`.toLowerCase();
const has = (text: string, w: string) => text.includes(w.toLowerCase());

/** Score one candidate for a voice: higher is better; `why` says what moved it. */
export function score(v: VoiceQuery, c: Omit<Candidate, 'score' | 'why' | 'url' | 'query' | 'preview'>, rank: number, hits: number): { score: number; why: string } {
  const why: string[] = [];
  let s = 0;
  const rating = c.ratings >= 3 ? c.rating / 5 : c.ratings > 0 ? 0.55 * (c.rating / 5) + 0.15 : 0.35;
  s += 2 * rating; why.push(`rating ${c.rating.toFixed(1)}x${c.ratings}`);
  s += 0.7 * Math.log10(1 + c.downloads); why.push(`${c.downloads} dl`);
  const [lo, hi] = v.dur, d = c.duration;
  const fit = d < lo ? Math.max(0, 1 - (lo - d) / lo) : d > hi ? Math.max(0, 1 - (d - hi) / (hi * 2)) : 1;
  s += 1.5 * fit; if (fit < 1) why.push(`length ${d.toFixed(1)}s off ${lo}-${hi}`);
  if (c.samplerate >= 44100) s += 0.5; else { s -= 1; why.push(`${c.samplerate} Hz`); }
  const text = words(c);
  for (const w of v.avoid ?? []) if (has(text, w)) { s -= 1.2; why.push(`avoid "${w}"`); }
  for (const w of v.want ?? []) if (has(text, w)) s += 0.5;
  if (v.must?.length) {
    const nt = `${c.name} ${c.tags.join(' ')}`.toLowerCase();
    if (v.must.some((w) => has(nt, w))) s += 1; else { s -= 3.5; why.push('name/tags do not say what it is'); }
  }
  if (/\b(processed|synthesi[sz]ed|synth|effect|reverb|pitch(ed)?|layered|edited|remix|plugin|vst|granular|generated)\b/.test(text)) { s -= 1.5; why.push('processed/synth'); }
  const isLoop = /\bloop(ed|able)?\b|seamless/.test(text);
  const wantLoop = v.loop ?? v.cls !== 'event';
  if (isLoop) { s += wantLoop ? 0.5 : -1.5; why.push(wantLoop ? 'loop' : 'loop (unwanted)'); }
  if (c.channels > 2) s -= 0.5;
  s += 0.4 * Math.max(0, 1 - rank / POOL) + 0.3 * (hits - 1); // found near the top, found by more than one query
  return { score: Math.round(s * 100) / 100, why: why.join('; ') };
}

async function search(v: VoiceQuery): Promise<Candidate[]> {
  const found = new Map<number, { c: any; rank: number; hits: number; query: string }>();
  for (const q of v.queries) {
    const j = await api('search/text/', {
      query: q,
      filter: `license:"Creative Commons 0" duration:[${v.dur[0]} TO ${v.dur[1]}]`,
      fields: FIELDS, page_size: String(POOL),
    });
    (j.results ?? []).forEach((c: any, i: number) => {
      if (c.license && !String(c.license).includes('zero/1.0')) return; // belt and braces: the filter should already have done this
      const h = found.get(c.id);
      if (h) { h.hits++; h.rank = Math.min(h.rank, i); } else found.set(c.id, { c, rank: i, hits: 1, query: q });
    });
  }
  const out: Candidate[] = [];
  for (const { c, rank, hits, query } of found.values()) {
    const preview = c.previews?.['preview-hq-ogg'] as string | undefined;
    if (!preview) continue;
    const base = {
      id: c.id, name: String(c.name), username: String(c.username), license: String(c.license), duration: Number(c.duration), rating: Number(c.avg_rating ?? 0), ratings: Number(c.num_ratings ?? 0),
      downloads: Number(c.num_downloads ?? 0), samplerate: Number(c.samplerate ?? 0), channels: Number(c.channels ?? 1), tags: (c.tags ?? []) as string[], description: String(c.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400),
    };
    const sc = score(v, base, rank, hits);
    out.push({ ...base, preview, url: `https://freesound.org/s/${c.id}/`, score: sc.score, why: sc.why, query });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function download(url: string, to: string) {
  if (existsSync(to)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`preview ${res.status}: ${url}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  await sleep(250);
}

async function main() {
  mkdirSync(join(OUT, 'search'), { recursive: true });
  const file = join(OUT, 'candidates.json');
  const all: Record<string, { cls: string; picks: Candidate[]; runnersUp: Candidate[]; margin: number; shortlist?: Candidate[] }> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const voices = VOICE_QUERIES.filter((v) => !ONLY.size || ONLY.has(v.id));
  console.log(`${voices.length} voice(s), pool ${POOL}, ${DRY ? 'dry run' : 'downloading'} into ${OUT}`);
  for (const v of voices) {
    const list = await search(v);
    const forced = PICKS[v.id]?.map((id) => list.find((c) => c.id === id)).filter(Boolean) as Candidate[] | undefined;
    const picks = forced?.length ? forced : list.slice(0, v.takes), runnersUp = list.filter((c) => !picks.includes(c)).slice(0, 3);
    const margin = runnersUp.length && picks.length ? Math.round((picks[picks.length - 1].score - runnersUp[0].score) * 100) / 100 : 9;
    all[v.id] = { cls: v.cls, picks, runnersUp, margin, shortlist: list.slice(0, 10) };
    console.log(`${v.id.padEnd(13)} ${String(list.length).padStart(3)} found, picked ${picks.map((p) => `${p.id}(${p.score})`).join(' ') || 'NONE'}  [${calls} calls]`);
    if (!DRY) {
      mkdirSync(join(OUT, v.id), { recursive: true });
      for (const p of [...picks, ...runnersUp.slice(0, 1)]) {
        try { await download(p.preview, join(OUT, v.id, `${p.id}.ogg`)); } catch (e) { console.log(`  download failed for ${p.id}: ${(e as Error).message}`); }
      }
    }
    writeFileSync(file, JSON.stringify(all, null, 1));
  }
  // the Markdown table: voice, chosen id, title, author, duration, rating, why
  const rows = ['| voice | chosen | title | author | s | rating | score | margin | why |', '|---|---|---|---|---|---|---|---|---|'];
  for (const [id, e] of Object.entries(all)) {
    if (!e.picks.length) { rows.push(`| ${id} | none | | | | | | | nothing found |`); continue; }
    e.picks.forEach((p, i) => rows.push(`| ${i ? '' : id} | [${p.id}](${p.url}) | ${p.name.replace(/\|/g, '/').slice(0, 48)} | ${p.username} | ${p.duration.toFixed(1)} | ${p.rating.toFixed(1)} (${p.ratings}) | ${p.score} | ${i ? '' : e.margin} | ${p.why.replace(/\|/g, '/')} |`));
  }
  writeFileSync(join(OUT, 'candidates.md'), rows.join('\n') + '\n');
  console.log(`wrote ${file} and candidates.md; ${calls} API calls this run`);
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
