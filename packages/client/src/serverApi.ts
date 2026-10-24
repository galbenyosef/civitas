import type { ServerConfig } from '@msimcity/shared';

/**
 * Where the game server's HTTP API is, and how the deployment is run. Kept apart from worlds.ts (which pulls in the demo and tour
 * code) so the home page (landing.ts) can use it without loading the game: this file imports types only.
 */

/** The game server's HTTP origin: the same place the websocket goes (the Vite dev server on :5173 talks to :8080; VITE_WS_URL overrides). */
export function apiBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL;
  if (env) return env.replace(/^ws/, 'http');
  const host = location.port === '5173' ? `${location.hostname}:8080` : location.host;
  return `${location.protocol}//${host}`;
}

/** How the deployment is run (`GET /api/config`: SPECTATE, DEFAULT_DEMO, /play/; docs/demo.md "A public showcase"); empty when the server has no answer. */
export async function serverConfig(): Promise<ServerConfig> {
  try {
    const r = await fetch(`${apiBase()}/api/config`, { cache: 'no-store', signal: AbortSignal.timeout(4000) }); // the page waits for this: never for long
    return r.ok ? ((await r.json()) as ServerConfig) : {};
  } catch { return {}; }
}
