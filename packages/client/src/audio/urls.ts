/**
 * Where the recordings are served from, in every build (docs/audio.md, "Recordings"). The Opus files live in audio/files/ beside the
 * code, and Vite's `?url` glob turns each into a URL: a served file in dev, a hashed asset under /assets/ in the online build
 * (dist/, so the UAT stack and the production image carry them) and in the offline build (dist-local/, where the service worker
 * caches each the first time it is played, not at install). Only the URLs are in the bundle, never the audio. Client only: the
 * engine takes this as its `url` option, and audio-check (run by node, where there is no glob) uses the engine's default.
 */
const found = import.meta.glob('./files/*.opus', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
export const clipUrl = (file: string): string | undefined => found[`./files/${file}`];
