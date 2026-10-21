/**
 * City history (docs/charts.md): one sample per game hour of the series the charts panel draws, kept at three
 * resolutions so a long-lived city stays small: hourly for the last 8 days, daily for 120 days, weekly for 5 years.
 * `Rings` is pure and shared: the server fills it (server/src/history.ts), saves it with the world and sends it to a
 * client whose charts panel opens; the client keeps its copy current by pushing the same hourly samples through the same
 * code, so the coarser tiers agree on both sides. Fixed-size typed arrays, no allocation per push.
 */

/** one resolution: a period is `hours` game hours long, the newest `size` periods are kept */
export const HIST_TIERS = [
  { id: 'hour', hours: 1, size: 192 },
  { id: 'day', hours: 24, size: 120 },
  { id: 'week', hours: 168, size: 260 },
] as const;
export type HistTierId = (typeof HIST_TIERS)[number]['id'];

export type HistUnit = '' | '%' | '$' | 'ms';
export type HistGroup = 'city' | 'economy' | 'traffic' | 'education' | 'power';
export interface HistSeriesDef { key: string; label: string; unit: HistUnit; group: HistGroup }

/** The world series, in the order of a 'histSample' message's `w` (and of Rings built from them). */
export const WORLD_SERIES: readonly HistSeriesDef[] = [
  { key: 'pop', label: 'Population', unit: '', group: 'city' },
  { key: 'employed', label: 'Jobs filled', unit: '', group: 'city' },
  { key: 'vacant', label: 'Jobs open', unit: '', group: 'city' },
  { key: 'buildings', label: 'Buildings', unit: '', group: 'city' },
  { key: 'sites', label: 'Under construction', unit: '', group: 'city' },
  { key: 'migIn', label: 'Newcomers per hour', unit: '', group: 'city' },
  { key: 'migOut', label: 'Leavers per hour', unit: '', group: 'city' },
  { key: 'moving', label: 'On the move', unit: '', group: 'traffic' },
  { key: 'vehicles', label: 'Cars on the road', unit: '', group: 'traffic' },
  { key: 'speedPct', label: 'Average speed', unit: '%', group: 'traffic' },
  { key: 'queuedPct', label: 'Held up', unit: '%', group: 'traffic' },
  { key: 'parked', label: 'Cars parked', unit: '', group: 'traffic' },
  { key: 'riders', label: 'Transit boardings per hour', unit: '', group: 'traffic' },
  { key: 'tickMs', label: 'Server tick (average)', unit: 'ms', group: 'traffic' },
  { key: 'tickP95', label: 'Server tick (95th percentile)', unit: 'ms', group: 'traffic' },
  // education (docs/education.md section 14): adults 18+ by highest level, people enrolled by stage, results over the last 24 hours
  { key: 'eduIndex', label: 'Education index', unit: '', group: 'education' },
  { key: 'lvlNone', label: 'No qualifications', unit: '', group: 'education' },
  { key: 'lvlPrimary', label: 'Primary', unit: '', group: 'education' },
  { key: 'lvlSecondary', label: 'GCSEs', unit: '', group: 'education' },
  { key: 'lvlFurther', label: 'A-levels or Level 3', unit: '', group: 'education' },
  { key: 'lvlDegree', label: 'Degree', unit: '', group: 'education' },
  { key: 'lvlPostgrad', label: 'Postgraduate', unit: '', group: 'education' },
  { key: 'stNursery', label: 'Nursery', unit: '', group: 'education' },
  { key: 'stPrimary', label: 'Primary school', unit: '', group: 'education' },
  { key: 'stSecondary', label: 'Secondary school', unit: '', group: 'education' },
  { key: 'stSixth', label: 'Sixth form and FE', unit: '', group: 'education' },
  { key: 'stHigher', label: 'University', unit: '', group: 'education' },
  { key: 'stAdult', label: 'Adult courses', unit: '', group: 'education' },
  { key: 'passDay', label: 'Passed (last 24 hours)', unit: '', group: 'education' },
  { key: 'dropDay', label: 'Dropped out or failed (last 24 hours)', unit: '', group: 'education' },
  // power (docs/utilities.md, server sim/utilities.ts PowerHour): homes on a substation's streets that were in a cut,
  // brownout, fault or a network with no supply at the last hourly solve
  { key: 'pwrOutPct', label: 'Homes in a power cut or brownout', unit: '%', group: 'power' },
];
/** Your series, in the order of a 'histSample' message's `p`. Income and expenses are per game day (the last 24 hours). */
export const PLAYER_SERIES: readonly HistSeriesDef[] = [
  { key: 'money', label: 'Treasury', unit: '$', group: 'economy' },
  { key: 'income', label: 'Income per day', unit: '$', group: 'economy' },
  { key: 'expenses', label: 'Spending per day', unit: '$', group: 'economy' },
  { key: 'housed', label: 'Your population', unit: '', group: 'economy' },
  { key: 'jobs', label: 'Your job capacity', unit: '', group: 'economy' },
  { key: 'staffed', label: 'Your jobs filled', unit: '', group: 'economy' },
  { key: 'myPupils', label: 'Pupils at your schools', unit: '', group: 'education' },
  { key: 'myPlaces', label: 'School places on your land', unit: '', group: 'education' },
  { key: 'myGrads', label: 'Graduates living on your land', unit: '', group: 'education' },
  // power, units an hour at the last hourly solve (server sim/utilities.ts PowerHour): what your networks generated by
  // source and imported, what their streets wanted and got, and your homes left dark or dimmed
  { key: 'pwrThermal', label: 'Power from your power stations', unit: '', group: 'power' },
  { key: 'pwrWind', label: 'Power from wind', unit: '', group: 'power' },
  { key: 'pwrSolar', label: 'Power from solar', unit: '', group: 'power' },
  { key: 'pwrImport', label: 'Power from the grid', unit: '', group: 'power' },
  { key: 'pwrDemand', label: 'Power wanted', unit: '', group: 'power' },
  { key: 'pwrSupplied', label: 'Power supplied', unit: '', group: 'power' },
  { key: 'pwrDarkPct', label: 'Your homes without power', unit: '%', group: 'power' },
  { key: 'pwrBrownPct', label: 'Your homes in a brownout', unit: '%', group: 'power' },
];
export const WORLD_KEYS = WORLD_SERIES.map((s) => s.key);
export const PLAYER_KEYS = PLAYER_SERIES.map((s) => s.key);

/** One tier on the wire and in saves: per series the newest `data` periods oldest first (null: no sample), and the unfinished period. */
export interface RingTierDTO {
  /** index of the newest finished period (hours / tier hours, floored); -1: none yet */
  last: number;
  data: (number | null)[][];
  /** the period being averaged now: its index, how many hourly samples so far, their sums per series */
  period: number; cnt: number; sum: number[];
}
export interface RingsDTO { keys: string[]; hour: number; tiers: RingTierDTO[] }

/** One series read out of a tier for drawing: sample `i` covers period `first + i`; the last one may be unfinished. */
export interface RingRead { first: number; hours: number; v: number[] }

const round2 = (v: number) => Math.round(v * 100) / 100;

class Tier {
  readonly data: Float32Array;
  last = -1;
  period = -1; cnt = 0;
  readonly sum: Float64Array;
  constructor(readonly hours: number, readonly size: number, readonly n: number) {
    this.data = new Float32Array(n * size).fill(NaN);
    this.sum = new Float64Array(n);
  }
  /** the finished period `p` gets the mean of what was added; skipped periods in between are gaps */
  finish() {
    const { size, n } = this;
    if (this.last >= 0 && this.period > this.last + 1) {
      const to = Math.min(this.period - 1, this.last + size);
      for (let q = this.last + 1; q <= to; q++) for (let s = 0; s < n; s++) this.data[s * size + (q % size)] = NaN;
    }
    const slot = this.period % size;
    for (let s = 0; s < n; s++) this.data[s * size + slot] = this.sum[s] / this.cnt;
    this.last = this.period;
  }
}

export class Rings {
  readonly tiers: Tier[];
  /** hour index of the newest push; -1 before the first */
  hour = -1;
  constructor(readonly keys: readonly string[]) {
    this.tiers = HIST_TIERS.map((t) => new Tier(t.hours, t.size, keys.length));
  }

  /** Add one hourly sample (`vals` in the order of `keys`). Hours must not go backwards; a repeat of the same hour is ignored. */
  push(hour: number, vals: ArrayLike<number>) {
    if (hour <= this.hour) return;
    this.hour = hour;
    for (const t of this.tiers) {
      const p = Math.floor(hour / t.hours);
      if (p !== t.period) {
        if (t.cnt > 0) t.finish();
        t.period = p; t.cnt = 0; t.sum.fill(0);
      }
      for (let s = 0; s < t.n; s++) { const v = vals[s]; t.sum[s] += Number.isFinite(v) ? v : 0; }
      t.cnt++;
    }
  }

  /** Series `s` of tier `ti` for drawing: the finished periods and, if any, the one in progress as the last point. */
  read(s: number, ti: number): RingRead | null {
    const t = this.tiers[ti];
    const live = t.cnt > 0;
    const end = live ? t.period : t.last; // newest period shown
    if (end < 0) return null;
    const firstFinished = t.last < 0 ? end + 1 : Math.max(0, t.last - t.size + 1);
    const first = live && t.last < 0 ? t.period : firstFinished;
    const v: number[] = [];
    for (let q = first; q <= end; q++) {
      if (q === t.period && live) v.push(t.sum[s] / t.cnt);
      else if (q > t.last) v.push(NaN);
      else v.push(t.data[s * t.size + (q % t.size)]);
    }
    return { first, hours: t.hours, v };
  }

  toDTO(): RingsDTO {
    return {
      keys: [...this.keys], hour: this.hour,
      tiers: this.tiers.map((t) => {
        const k = t.last < 0 ? 0 : Math.min(t.last + 1, t.size);
        const data: (number | null)[][] = [];
        for (let s = 0; s < t.n; s++) {
          const row: (number | null)[] = new Array(k);
          for (let j = 0; j < k; j++) { const v = t.data[s * t.size + ((t.last - k + 1 + j) % t.size)]; row[j] = Number.isFinite(v) ? round2(v) : null; }
          data.push(row);
        }
        return { last: t.last, data, period: t.period, cnt: t.cnt, sum: Array.from(t.sum, round2) };
      }),
    };
  }

  /** Rings for `keys` from a saved or received DTO. Series are matched by key (a key it lacks stays empty), bad input gives empty rings. */
  static fromDTO(keys: readonly string[], dto: RingsDTO | null | undefined): Rings {
    const r = new Rings(keys);
    try {
      if (!dto || !Array.isArray(dto.keys) || !Array.isArray(dto.tiers) || dto.tiers.length !== HIST_TIERS.length) return r;
      const map = keys.map((k) => dto.keys.indexOf(k));
      dto.tiers.forEach((d, ti) => {
        const t = r.tiers[ti];
        if (!Number.isInteger(d.last) || !Number.isInteger(d.period) || !Array.isArray(d.data)) return;
        const rows = d.data.length ? d.data[0].length : 0;
        if (rows > t.size || d.last < rows - 1 && d.last >= 0) return;
        t.last = d.last; t.period = d.period; t.cnt = Math.max(0, d.cnt | 0);
        for (let s = 0; s < keys.length; s++) {
          const src = map[s];
          if (src < 0) continue;
          const row = d.data[src];
          if (Array.isArray(row) && row.length === rows) for (let j = 0; j < rows; j++) { const v = row[j]; t.data[s * t.size + ((d.last - rows + 1 + j) % t.size)] = typeof v === 'number' ? v : NaN; }
          const sum = d.sum?.[src];
          t.sum[s] = typeof sum === 'number' && Number.isFinite(sum) ? sum : 0;
        }
      });
      r.hour = Number.isInteger(dto.hour) ? dto.hour : -1;
    } catch { return new Rings(keys); }
    return r;
  }
}
