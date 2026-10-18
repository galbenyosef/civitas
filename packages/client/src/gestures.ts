/**
 * Wheel and trackpad conventions (docs: README "Controls"). The scheme follows city builders (Cities: Skylines, Anno)
 * for the mouse and map apps (Google Maps, Mapbox) for the trackpad, and never guesses the device from wheel events:
 * browsers cannot tell a smooth-scrolling Mac mouse from a trackpad, and every guess got one of them wrong.
 *
 *  - scroll (a wheel, a Magic Mouse, two fingers on a trackpad) zooms about the cursor;
 *  - pinch (ctrl+wheel in Chrome/Firefox, gesture events in Safari) zooms about the cursor;
 *  - Shift+scroll pans, Alt/Option+scroll rotates (sideways) and tilts (up and down);
 *  - one setting, "scroll: zoom | pan", lets a trackpad user make plain two-finger scroll pan (pinch still zooms).
 */
export type ScrollMode = 'zoom' | 'pan';

export const SCROLL_KEY = 'msimcity.scroll';
/** the old auto/trackpad/mouse setting (trackpad meant two-finger pan) */
const OLD_KEY = 'msimcity.padMode';

/** The stored scroll setting; zoom unless the player chose pan (or chose "trackpad" under the old setting). */
export function readScrollMode(): ScrollMode {
  try {
    const v = localStorage.getItem(SCROLL_KEY);
    if (v === 'zoom' || v === 'pan') return v;
    if (localStorage.getItem(OLD_KEY) === 'trackpad') return 'pan';
  } catch { /* storage blocked */ }
  return 'zoom';
}
export function writeScrollMode(m: ScrollMode) {
  try { localStorage.setItem(SCROLL_KEY, m); } catch { /* not remembered */ }
}

/** Wheel deltas in pixels, whatever unit the browser used (Firefox sends lines). */
export function wheelPixels(delta: number, deltaMode: number): number {
  return deltaMode === 1 ? delta * 16 : deltaMode === 2 ? delta * 400 : delta;
}

/** log of the distance multiplier for a scroll of `px` pixels: a mouse notch (~100 px) is about 16%; one event is capped. */
export function scrollZoom(px: number): number {
  return Math.max(-150, Math.min(150, px)) * 0.0015;
}

/** The zoom factor for a pinch (ctrl+wheel, fine deltas) or a Ctrl+wheel from a mouse (coarse steps), `dist` multiplier. */
export function pinchFactor(deltaY: number, deltaMode: number): number {
  const px = wheelPixels(deltaY, deltaMode);
  // a pinch sends small deltas often; a Ctrl+mouse-wheel step is ~100 once, so it gets the wheel's sensitivity
  const k = Math.abs(px) < 50 ? 0.012 : 0.0015;
  return Math.exp(Math.max(-60, Math.min(60, px)) * k);
}
