/**
 * Telling a trackpad from a mouse wheel, from the wheel events alone (no DOM: input.ts feeds it, scripts/ tests it).
 *
 * A Mac trackpad two-finger scroll arrives as a stream of small, often fractional deltas, usually with both deltaX and
 * deltaY non-zero, in pixels (deltaMode 0), ending in a momentum tail. A mouse wheel is a few large discrete steps
 * (100 per notch on Windows/Linux Chrome, whole "lines" in Firefox), almost always deltaX 0. Neither signal is certain
 * for one event, so each event votes and the votes are averaged with hysteresis; until there is a verdict the event
 * is "unknown" and the caller treats it as a zoom, as a mouse wheel always has been.
 */
export type PadMode = 'auto' | 'trackpad' | 'mouse';
export type WheelKind = 'pinch' | 'scroll' | 'wheel';

export interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean; timeStamp: number }

const FLIP = 0.35; // |score| needed to change the verdict; between -FLIP and FLIP the previous verdict stands

export class WheelClassifier {
  /** -1 (mouse) .. +1 (trackpad): a running average of the per-event votes */
  score = 0;
  /** the current verdict, or null while undecided */
  verdict: 'trackpad' | 'mouse' | null = null;
  private last = -1e9;

  classify(e: WheelLike, mode: PadMode): WheelKind {
    // Chrome/Firefox report a trackpad pinch as ctrl+wheel (a real Ctrl+wheel looks the same); both zoom
    if (e.ctrlKey) { this.last = e.timeStamp; return 'pinch'; }
    if (mode === 'mouse') return 'wheel';
    if (mode === 'trackpad') return 'scroll';
    this.vote(e);
    return this.verdict === 'trackpad' ? 'scroll' : 'wheel';
  }

  private vote(e: WheelLike) {
    const dt = e.timeStamp - this.last;
    this.last = e.timeStamp;
    const ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
    const whole = (v: number) => Math.abs(v - Math.round(v)) < 0.01;
    let v = 0, definite = false;
    if (e.deltaMode !== 0) { v = -1; definite = true; } // lines/pages: a notched wheel
    else if (ax > 0 && !e.shiftKey && ay > 0) v = 1; // both axes at once: fingers drift, a wheel never does
    else if (!whole(ax) || !whole(ay)) v = 1; // fractional pixels: only a trackpad (or a smooth-scroll mouse, rare)
    else if ((ay >= 100 && dt > 80) || (ay >= 40 && dt > 150)) { v = -1; definite = true; } // a big discrete step on its own (not inside a swipe's stream)
    else if (dt < 50 && ay > 0 && ay < 30) v = 0.3; // a quick run of small steps: a stream; alone it stays under FLIP (a fast-spun Mac mouse looks the same)
    // lines/pages and an isolated big step are a wheel beyond doubt: no swipe's average should outvote them
    this.score = definite ? Math.min(this.score, -0.6) : this.score * 0.6 + v * 0.4;
    // a clear single vote (fractional / big step / lines) flips quickly; ambiguous ones only drift the average
    if (this.score > FLIP) this.verdict = 'trackpad';
    else if (this.score < -FLIP) this.verdict = 'mouse';
  }
}

/** The zoom factor for a pinch (ctrl+wheel, fine deltas) or a Ctrl+wheel from a mouse (coarse steps), `dist` multiplier. */
export function pinchFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 0 ? deltaY : deltaY * 16;
  // a pinch sends small deltas often; a Ctrl+mouse-wheel step is ~100 once, so it gets the wheel's sensitivity
  const k = Math.abs(px) < 50 ? 0.012 : 0.0015;
  return Math.exp(Math.max(-60, Math.min(60, px)) * k);
}
