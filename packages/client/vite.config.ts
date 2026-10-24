import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, relative, join } from 'node:path';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const catalogueDir = resolve(root, 'packages/shared/src/buildings');
const GENERATED = new Set(['compiled.ts', 'recipes.ts']);

/**
 * Keeps the building catalogue compiled: runs `npm run buildings:compile`'s
 * script when Vite starts or builds, and again whenever a catalogue file
 * changes in dev. The compile only rewrites compiled.ts / recipes.ts when
 * their content changes; Vite's HMR then reloads whatever imports them (the
 * city and /viewer.html). A broken catalogue shows in the error overlay.
 */
function buildingCatalogue(): Plugin {
  const run = () => new Promise<string>((ok, fail) => {
    execFile(resolve(root, 'node_modules/.bin/tsx'), [resolve(root, 'packages/shared/scripts/compile-buildings.ts')], { cwd: root }, (err, stdout, stderr) => {
      if (err) fail(new Error((stderr || stdout || String(err)).trim())); else ok(stdout.trim());
    });
  });
  let server: ViteDevServer | undefined;
  let queued: Promise<void> = Promise.resolve();
  const recompile = (why: string) => {
    queued = queued.then(() => run()).then(
      (msg) => { server?.config.logger.info(`${msg} (${why})`, { timestamp: true }); },
      (e: Error) => {
        server?.config.logger.error(e.message, { timestamp: true });
        server?.ws.send({ type: 'error', err: { message: e.message, stack: '', plugin: 'civitas-buildings', id: catalogueDir } });
      },
    );
    return queued;
  };
  return {
    name: 'civitas-buildings',
    async buildStart() {
      if (server) { await recompile('start'); return; }
      this.info(await run()); // vite build: fail the build on an invalid catalogue
    },
    configureServer(s) {
      server = s;
      s.watcher.add(catalogueDir);
      const onFile = (file: string) => {
        if (!file.startsWith(catalogueDir) || !file.endsWith('.ts') || GENERATED.has(file.slice(catalogueDir.length + 1))) return;
        void recompile(file.slice(catalogueDir.length + 1));
      };
      s.watcher.on('change', onFile).on('add', onFile).on('unlink', onFile);
    },
  };
}

/**
 * The static local build's PWA (docs/local-mode.md, phase F): the manifest and icons come from public-local/, and once the bundle is
 * written this turns sw.template.js into dist-local/sw.js with every emitted file listed (hashed names make the list the version).
 * The online build gets none of it.
 */
function offlinePwa(outDir: string): Plugin {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  return {
    name: 'civitas-pwa',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (_html, ctx) => (ctx.path.endsWith('index.html') ? [
        { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './apple-touch-icon.png' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0e1116' }, injectTo: 'head' },
      ] : []),
    },
    closeBundle() {
      const dir = resolve(here, outDir);
      const files = walk(dir).map((f) => relative(dir, f).split('\\').join('/')).filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.endsWith('.opus')).sort(); // the recordings (src/audio/files, up to 8 MB) are cached when first played, by the worker's fetch handler, not at install
      const hash = createHash('sha1');
      for (const f of files) hash.update(f).update(readFileSync(join(dir, f)));
      const list = ['./', ...files.map((f) => `./${f}`)];
      const src = readFileSync(resolve(here, 'sw.template.js'), 'utf8').replace('__VERSION__', hash.digest('hex').slice(0, 10)).replace('__FILES__', JSON.stringify(list, null, 1));
      writeFileSync(join(dir, 'sw.js'), src);
    },
  };
}

/**
 * `vite build` is the online client (dist/, served by the game server). `vite build --mode offline` (npm run build:local; 'local' is reserved by Vite's .env.local) is the
 * static local-only build (dist-local/, relative paths, any static host): `__LOCAL_ONLY__` makes it start the game in a worker
 * (docs/local-mode.md). Either way the worker (src/local/worker.ts) is its own ES module chunk, fetched only when local mode starts.
 */
export default defineConfig(({ mode }) => ({
  plugins: [buildingCatalogue(), ...(mode === 'offline' ? [offlinePwa('dist-local')] : [])],
  publicDir: mode === 'offline' ? 'public-local' : false, // manifest and icons, for the static build only
  // every interface, under any host name or address (LAN IP, Xetatron.local, other clients): Vite's DNS-rebinding guard
  // would otherwise answer 403 to anything but localhost and raw IPs
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true as const },
  preview: { host: '0.0.0.0', allowedHosts: true as const },
  define: { __LOCAL_ONLY__: JSON.stringify(mode === 'offline') },
  base: mode === 'offline' ? './' : '/',
  worker: { format: 'es' as const },
  build: {
    target: 'es2022', sourcemap: true,
    outDir: mode === 'offline' ? 'dist-local' : 'dist',
    rollupOptions: { input: { main: resolve(here, 'index.html'), viewer: resolve(here, 'viewer.html'), compare: resolve(here, 'compare.html') } },
  },
}));
