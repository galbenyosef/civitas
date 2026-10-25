/** true in the static local-only build (`npm run build:local`, vite.config.ts): no server, the game runs in a worker (docs/local-mode.md) */
declare const __LOCAL_ONLY__: boolean;
/** the build's git short sha, for the home page's footer (vite.config.ts) */
declare const __BUILD__: string;
