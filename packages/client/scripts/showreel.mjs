#!/usr/bin/env node
// The home page's showreel (docs/demo.md, "The home page", "Showreel"): ten building thumbnails from the viewer and three short looping clips of the
// Showcase alive, made ahead of time so the landing stays free of three.js. Run by hand, then commit what it writes to packages/client/src/showreel/:
//
//   node packages/client/scripts/showreel.mjs [--server http://localhost:9003] [--client <url>] [--only thumbs|clips] [--name <asset>]
//
//   --server  the game server whose Showcase is filmed (POST /api/demos/showcase/start; it starts the demo and waits). Default http://localhost:9003.
//   --client  where the pages come from: /viewer.html and the game. Default the server (a built client), or a Vite dev server such as
//             http://localhost:5999 started with VITE_WS_URL=ws://localhost:9003.
//   --only    thumbs | clips: only that half (the other half's files are kept). --name: only the asset with that name (t-shard -> shard).
//   --min-fps the least the page may draw while filming a clip (default 10); the capture is refused below it. 24 fps is what is encoded.
//
// Needs: playwright-core (already in node_modules; PLAYWRIGHT=<path> to use another copy), Google Chrome or Playwright's Chromium (CHROME_CHANNEL=chromium
// for the second), ffmpeg with libvpx-vp9, and cwebp (brew install webp). The script refuses to write a file over its budget (BUDGET below).
// Output, per asset: t-<name>.webp (thumbs), c-<name>.webm and c-<name>.webp (clips and their posters), and manifest.json (names and captions, read by landing.ts).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, statSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- what is shot ---------------------------------------------------------------------------------------------------------------

/**
 * Thumbnails: `key` is the viewer's design key (kind:level:design; `#d=` in /viewer.html), `hour` the light (11 by day, 21 so windows glow),
 * `yaw` and `pitch` the turntable's angle in radians (the viewer's own are -0.6 and 0.42; they differ here so the row is not ten identical cards),
 * `zoom` a multiplier on the viewer's framing distance (under 1 is closer). `caption` is the one word under it on the home page.
 */
export const SHOWREEL = {
  thumbs: [
    { name: 'shard',     caption: 'The Shard',    key: '92:1:0',  hour: 21, yaw: -0.9, pitch: 0.5, zoom: 0.92 },
    { name: 'parliament', caption: 'Big Ben',     key: '96:1:0',  hour: 11, yaw: -0.35, pitch: 0.5, zoom: 1.0 },
    { name: 'eye',       caption: 'London Eye',   key: '97:1:0',  hour: 11, yaw: 0.55, pitch: 0.5, zoom: 0.98 },
    { name: 'eiffel',    caption: 'Eiffel Tower', key: '133:1:0', hour: 11, yaw: -0.7, pitch: 0.5, zoom: 0.85 },
    { name: 'golden-gate', caption: 'Golden Gate', key: '192:1:1', hour: 11, yaw: -0.25, pitch: 0.5, zoom: 0.95 },
    { name: 'shop',      caption: 'Corner shop',  key: '2:1:4',   hour: 11, yaw: -0.8, pitch: 0.5, zoom: 0.75 },
    { name: 'terrace',   caption: 'Terrace',      key: '70:2:0',  hour: 11, yaw: 0.3, pitch: 0.52, zoom: 0.85 },
    { name: 'tube',      caption: 'Tube',         key: '22:1:0',  hour: 21, yaw: -0.5, pitch: 0.5, zoom: 0.78 },
    { name: 'depot',     caption: 'Bus depot',    key: '16:1:0',  hour: 11, yaw: 0.7, pitch: 0.5, zoom: 0.85 },
    { name: 'power',     caption: 'Power',        key: '164:1:0', hour: 11, yaw: -0.15, pitch: 0.5, zoom: 1.0 },
  ],
  /**
   * Clips: the Showcase seen from `at` (x,y tile) at `dist`, `yaw` and `pitch` in degrees and `hour` frozen, the same numbers as a ?demo=showcase&at=…&dist=…&yaw=…&pitch=…&hour=… link.
   * Each is filmed for `SECONDS` after a settle, with the last half second crossfaded into the first so it loops without a jump.
   */
  clips: [
    { name: 'avenue',  caption: 'Traffic at dusk, lights changing', at: '-49.5,-5', dist: 24, yaw: 26, pitch: 38, hour: 18.6 },
    { name: 'station', caption: 'A train in, riders on the platform', at: '21,-36.5', dist: 26, yaw: 26, pitch: 40, hour: 16 },
    { name: 'harbour', caption: 'River buses and boats', at: '40,44', dist: 52, yaw: 200, pitch: 42, hour: 15 },
  ],
};
const SECONDS = 9, XFADE = 0.5, FPS = 24, CLIP_W = 960, CLIP_H = 540;
export const BUDGET = { thumb: 25 * 1024, clip: 1024 * 1024, poster: 80 * 1024, total: 3.5 * 1024 * 1024 };

// ---- arguments, paths ------------------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SERVER = opt('server', 'http://localhost:9003').replace(/\/$/, '');
const CLIENT = opt('client', SERVER).replace(/\/$/, '');
const ONLY = opt('only', '');
const NAME = opt('name', '');
const MIN_FPS = Number(opt('min-fps', '10')); // frames a second the page must manage while filming (12 is fine, 24 is smooth); a slower capture is refused, not shipped as a slideshow
const OUT = fileURLToPath(new URL('../src/showreel/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), 'showreel-'));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const run = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] });
const sizeOf = (f) => statSync(f).size;

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright-core').catch((e) => {
  console.error(e.message);
  console.error('playwright-core is not installed: run `npm i --no-save playwright-core` at the repo root (it is not a dependency), or set PLAYWRIGHT to the path of its index.mjs');
  process.exit(1);
});
const chromium = pw.chromium ?? pw.default.chromium; // playwright-core is CommonJS: a path import gives the exports under default
const channel = (process.env.CHROME_CHANNEL ?? 'chrome') === 'chromium' ? undefined : (process.env.CHROME_CHANNEL ?? 'chrome');
const browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const report = [];
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|GL Driver|WebSocket|fonts\.g/.test(m.text())) errors.push(m.text().slice(0, 200)); });
};

/** a PNG to a webp of `w`×`h` under `limit` bytes: lanczos down from the 2x capture, then cwebp, quality 80 stepping down until it fits */
function toWebp(png, out, w, h, limit, q0 = 80) {
  const small = join(TMP, `${out.split('/').pop()}.png`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', `scale=${w}:${h}:flags=lanczos`, small]);
  for (let q = q0; q >= 40; q -= 5) {
    run('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', small, '-o', out]);
    if (sizeOf(out) <= limit) return { q, bytes: sizeOf(out) };
  }
  rmSync(out, { force: true });
  throw new Error(`${out} stays over its budget of ${kb(limit)} even at quality 40`);
}

// ---- thumbnails ------------------------------------------------------------------------------------------------------------------

async function thumbs() {
  const page = await browser.newPage({ viewport: { width: 1380, height: 744 }, deviceScaleFactor: 2 }); // the viewer's middle column is then 700x700 CSS px, 1400x1400 captured
  watch(page);
  await page.goto(`${CLIENT}/viewer.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.viewer?.entries, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#stage > :not(canvas) { display: none !important; }' });
  for (const t of SHOWREEL.thumbs) {
    if (NAME && NAME !== t.name) continue;
    const ok = await page.evaluate(({ key, hour, yaw, pitch, zoom }) => {
      const v = window.viewer;
      if (!v.entries().includes(key)) return false;
      v.setSpin(false); v.select(key); v.setHour(hour, false); v.setYaw(yaw); v.setPitch(pitch);
      if (zoom !== 1) v.zoom(zoom);
      return true;
    }, t);
    if (!ok) throw new Error(`thumbnail ${t.name}: no design ${t.key} in the catalogue`);
    await page.waitForTimeout(1500); // the model, the shadow map and the wheel's first turn
    const png = join(TMP, `t-${t.name}.png`);
    await page.locator('#view').screenshot({ path: png });
    const f = `${OUT}t-${t.name}.webp`;
    const r = toWebp(png, f, 320, 320, BUDGET.thumb);
    report.push({ file: `t-${t.name}.webp`, what: `viewer ${t.key} at ${t.hour}:00, yaw ${t.yaw}, pitch ${t.pitch}`, bytes: r.bytes, q: r.q });
  }
  await page.close();
}

// ---- clips -----------------------------------------------------------------------------------------------------------------------

async function showcaseReady() {
  await fetch(`${SERVER}/api/demos/showcase/start`, { method: 'POST' }).catch(() => {});
  for (let i = 0; i < 400; i++) {
    const j = await (await fetch(`${SERVER}/api/demos`, { cache: 'no-store' })).json();
    const d = j.demos?.find((x) => x.id === 'showcase');
    if (d?.status === 'running') return;
    if (i % 10 === 0) console.log(`  showcase ${d?.status ?? '?'} ${d?.fill !== undefined ? Math.round(d.fill * 100) + '%' : ''}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('the showcase did not start within 20 minutes');
}

/** film one view: CDP screencast frames with their timestamps, resampled to FPS, loop-blended and encoded to VP9 under budget */
async function film(c) {
  const page = await browser.newPage({ viewport: { width: CLIP_W, height: CLIP_H }, deviceScaleFactor: 1 });
  watch(page);
  const q = new URLSearchParams({ demo: 'showcase', name: 'Showreel', at: c.at, dist: String(c.dist), yaw: String(c.yaw), pitch: String(c.pitch), hour: String(c.hour), fx: '2' });
  await page.goto(`${CLIENT}/?${q}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.msc?.net?.connected && window.msc.world.me, null, { timeout: 180000, polling: 1000 });
  await page.addStyleTag({ content: '#ui > *, #perf, #banner, .toast { visibility: hidden !important; }' });
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => !window.msc.tour?.flying, null, { timeout: 60000, polling: 500 }).catch(() => {});
  const place = () => page.evaluate(({ at, dist, yaw, pitch, hour }) => {
    const m = window.msc, [x, y] = at.split(',').map(Number);
    m.rig.setShot({ x, y, dist, yaw, pitch });
    m.lighting.mode = 'fixed'; m.lighting.fixedHour = hour;
    m.streamChunks();
  }, c);
  await place();
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => { const m = window.msc; for (const ch of m.world.chunks.values()) if (ch.dirty) return false; return m.views.size >= m.subscribed.size && m.subscribed.size > 0; }, null, { timeout: 120000, polling: 500 }).catch(() => console.log('  chunks not all ready'));
  await place();
  await page.waitForTimeout(5000); // streaming, the vehicles and riders settle
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: CLIP_W, maxHeight: CLIP_H, everyNthFrame: 1 });
  await page.waitForTimeout(SECONDS * 1000 + 300);
  await cdp.send('Page.stopScreencast');
  await page.close();
  const got = (frames.length - 1) / ((frames.at(-1)?.t ?? 0) - (frames[0]?.t ?? 0) || 1);
  if (frames.length < 2 || got < MIN_FPS) throw new Error(`clip ${c.name}: the page drew ${got.toFixed(1)} frames a second, under --min-fps ${MIN_FPS} (a busy machine does this: the game's own frame takes 0.1-0.5 s then); try again when it is quiet`);
  // resample to a constant FPS: each output tick takes the latest frame at or before it
  const dir = join(TMP, `c-${c.name}`); mkdirSync(dir, { recursive: true });
  const t0 = frames[0].t, n = SECONDS * FPS;
  for (let k = 0, i = 0; k < n; k++) {
    while (i + 1 < frames.length && frames[i + 1].t - t0 <= k / FPS) i++;
    writeFileSync(join(dir, `${String(k + 1).padStart(4, '0')}.jpg`), Buffer.from(frames[i].data, 'base64'));
  }
  const fps = frames.length / (frames.at(-1).t - t0);
  // loop: the last XFADE seconds fade out under the first XFADE seconds, so the file ends one frame before where it begins
  const x = Math.round(XFADE * FPS), loopFrames = n - x;
  const graph = `[0:v]split=3[a][b][c];[a]trim=start_frame=0:end_frame=${x},setpts=PTS-STARTPTS[head];[b]trim=start_frame=${loopFrames}:end_frame=${n},setpts=PTS-STARTPTS[tail];`
    + `[c]trim=start_frame=${x}:end_frame=${loopFrames},setpts=PTS-STARTPTS[mid];[head][tail]blend=all_expr='A*(N/${x})+B*(1-N/${x})'[fade];[fade][mid]concat=n=2:v=1:a=0[v]`;
  const webm = `${OUT}c-${c.name}.webm`;
  let crf = 36, bytes = 0;
  for (; crf <= 46; crf += 2) {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%04d.jpg'), '-filter_complex', graph, '-map', '[v]', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', webm]);
    bytes = sizeOf(webm);
    if (bytes <= BUDGET.clip) break;
  }
  if (bytes > BUDGET.clip) { rmSync(webm, { force: true }); throw new Error(`clip ${c.name} stays over ${kb(BUDGET.clip)} (${kb(bytes)} at crf 46)`); }
  const first = join(TMP, `c-${c.name}-first.png`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-frames:v', '1', first]);
  const p = toWebp(first, `${OUT}c-${c.name}.webp`, CLIP_W, CLIP_H, BUDGET.poster, 75);
  report.push({ file: `c-${c.name}.webm`, what: `showcase at ${c.at} dist ${c.dist} yaw ${c.yaw} pitch ${c.pitch} ${c.hour}:00; ${frames.length} frames captured (${fps.toFixed(0)} fps), ${FPS} fps out, crf ${crf}`, bytes });
  report.push({ file: `c-${c.name}.webp`, what: 'poster', bytes: p.bytes, q: p.q });
}

async function clips() {
  console.log('starting the showcase');
  await showcaseReady();
  for (const c of SHOWREEL.clips) {
    if (NAME && NAME !== c.name) continue;
    console.log(`filming ${c.name}`);
    await film(c);
  }
}

// ---- go --------------------------------------------------------------------------------------------------------------------------

try {
  if (ONLY !== 'clips') await thumbs();
  if (ONLY !== 'thumbs') await clips();
  writeFileSync(`${OUT}manifest.json`, JSON.stringify({
    thumbs: SHOWREEL.thumbs.map(({ name, caption }) => ({ name, caption })),
    clips: SHOWREEL.clips.map(({ name, caption }) => ({ name, caption })),
  }, null, 1) + '\n');
  const files = readdirSync(OUT).filter((f) => /\.(webp|webm)$/.test(f));
  const total = files.reduce((a, f) => a + sizeOf(join(OUT, f)), 0);
  for (const r of report) console.log(`${r.file.padEnd(22)} ${kb(r.bytes).padStart(10)}  ${r.what}`);
  console.log(`strip total ${(total / 1048576).toFixed(2)} MB in ${files.length} files (budget ${(BUDGET.total / 1048576).toFixed(1)} MB)`);
  if (errors.length) console.log('page errors:', errors.slice(0, 8));
  if (total > BUDGET.total) { console.error('over the strip budget'); process.exitCode = 1; }
} finally {
  await browser.close();
  rmSync(TMP, { recursive: true, force: true });
}
