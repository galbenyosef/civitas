/** Rolling window of the last N tick times (ms), for the stats message, /healthz and the client's perf readout. */
export class TickWindow {
  private buf: Float64Array;
  private n = 0;
  private i = 0;
  /** `size` samples: 300 is one minute at the 5 Hz tick */
  constructor(size = 300) { this.buf = new Float64Array(size); }
  push(ms: number) {
    this.buf[this.i] = ms;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }
  /** average, 95th percentile and maximum over the window, in ms rounded to 0.01 */
  summary(): { avg: number; p95: number; max: number } {
    if (!this.n) return { avg: 0, p95: 0, max: 0 };
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    let sum = 0;
    for (const v of a) sum += v;
    const r = (v: number) => Math.round(v * 100) / 100;
    return { avg: r(sum / a.length), p95: r(a[Math.min(a.length - 1, Math.floor(0.95 * a.length))]), max: r(a[a.length - 1]) };
  }
}
