/**
 * Environment knobs, safe to read from any module. In Node this is `process.env`; in a browser worker (local mode,
 * docs/local-mode.md) there is no `process` and every knob is undefined, so modules fall back to their defaults
 * instead of throwing at load.
 */
export const env = (k: string): string | undefined => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k];
