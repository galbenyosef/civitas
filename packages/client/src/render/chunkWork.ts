/**
 * The chunk rebuild work and its accounting (docs/perf.md, "What the jitter is: chunk rebuilds"): every rebuild's
 * passes timed one by one, so `msc.perf.rebuilds()` can say how much of a rebuild is the ground and buildings
 * (`view`) and how much each renderer's scan.
 */
export const REBUILD_PASSES = ['roads', 'view', 'lights', 'parks', 'airfield', 'helis', 'boats', 'trains', 'junctions', 'bridges', 'landmarks', 'underground', 'power'] as const;
export type RebuildPass = (typeof REBUILD_PASSES)[number];

export interface RebuildRecord { at: number; key: string; ms: number; passes: number[]; items: number; dist: number }

const RING = 512;

export class RebuildStats {
  readonly ring: RebuildRecord[] = [];
  count = 0;
  push(r: RebuildRecord) {
    this.ring.push(r); this.count++;
    if (this.ring.length > RING) this.ring.shift();
  }
  /** rebuilds in the last `seconds`: how many a second, their cost, and the cost split by pass */
  summary(seconds = 30) {
    const from = performance.now() - seconds * 1000, rs = this.ring.filter((r) => r.at >= from);
    const sum = REBUILD_PASSES.map((_, i) => rs.reduce((s, r) => s + r.passes[i], 0));
    const tot = rs.reduce((s, r) => s + r.ms, 0) || 1;
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      rebuilds: rs.length, perSecond: r1(rs.length / seconds), totalMs: r1(tot), meanMs: r1(tot / (rs.length || 1)),
      p50: r1(ms[ms.length >> 1] ?? 0), max: r1(ms[ms.length - 1] ?? 0),
      passes: Object.fromEntries(REBUILD_PASSES.map((p, i) => [p, { ms: r1(sum[i] / (rs.length || 1)), share: Math.round((100 * sum[i]) / tot) }])),
      chunks: new Set(rs.map((r) => r.key)).size,
    };
  }
}
