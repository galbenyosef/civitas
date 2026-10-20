import { hash2 } from './noise';

/**
 * Motivation (docs/motivation.md): what citizens care about. Six values, stored per citizen as six small integers
 * 0-15 packed four bits each into one number (`Citizen.vals` on the server); a value's weight is its number over the
 * sum. Incomers are a blend of one or two archetypes pulled toward the people already living where they move in,
 * children inherit their parents' values, and decisions (a job, a home, a night out) score their options by them.
 * The player sees words in the citizen panel and, with Focus groups (Culture tier 2), percentages per parcel.
 *
 * Shared so the client can name values and the Focus groups section; the seeding and scoring live in
 * server/src/sim/motivation.ts.
 */

/** The six values, in the order of the adverts' themes (shared/src/adverts.ts AD_THEMES). */
export const Value = { Money: 0, Family: 1, Status: 2, Roots: 3, Time: 4, Adventure: 5 } as const;
export const VALUE_COUNT = 6;
export const VALUE_NAMES = ['Money', 'Family', 'Status', 'Roots', 'Time', 'Adventure'] as const;
/** "Cares most about …" in the citizen panel */
export const VALUE_WORDS = ['money', 'family', 'getting on', 'staying put', 'free time', 'something new'] as const;

/**
 * The archetypes a citizen is blended from (docs/motivation.md section 3), weights in Value order. A pure Grafter is
 * the "100% money" person in all but name: 0.70 is enough that no other value wins a decision on its own.
 */
export const ARCHETYPES: { name: string; w: readonly number[] }[] = [
  { name: 'Grafter', w: [0.70, 0.10, 0.10, 0.00, 0.10, 0.00] },
  { name: 'Homemaker', w: [0.15, 0.60, 0.00, 0.15, 0.10, 0.00] },
  { name: 'Climber', w: [0.25, 0.00, 0.55, 0.00, 0.05, 0.15] },
  { name: 'Local', w: [0.10, 0.20, 0.00, 0.60, 0.10, 0.00] },
  { name: 'Easygoing', w: [0.15, 0.10, 0.00, 0.15, 0.60, 0.00] },
  { name: 'Free spirit', w: [0.10, 0.00, 0.10, 0.00, 0.15, 0.65] },
];

export const MOTIVE = {
  /** the city's archetype mix (shares in ARCHETYPES order) */
  mix: [0.2, 0.2, 0.15, 0.15, 0.17, 0.13] as readonly number[],
  /** share of people who are one archetype only; the rest blend a primary at blendLo..blendHi with a secondary */
  pure: 0.35, blendLo: 0.5, blendHi: 0.9,
  /** each value is jittered by this much either way (times its weight), so no two Grafters are quite alike */
  jitter: 0.35,
  /** incomers: pulled this far toward the mean values of the parcel they move into, when it has areaMin residents */
  areaPull: 0.35, areaMin: 4,
  /** children: their own hashed archetype at this share, their parents' mean the rest */
  childOwn: 0.3,
  // ---- decisions (M2) ----
  /** job search: up to jobOptions vacancies, within jobSlack road steps of the first, at most jobExtraNodes more nodes */
  jobOptions: 5, jobSlack: 12, jobExtraNodes: 400,
  /** what every extra jobSlack road steps costs a job's score, whatever the citizen's values (so choice adds little traffic) */
  commuteCost: 0.5,
  /** score noise either way (the best option wins most of the time, not every time) */
  noise: 0.12,
  /**
   * self-initiated changes once a game day (Rich's 2a: slow, under 1% a day): an employed adult looks for a better job
   * with chance lookJob x (0.5 + 1.5 x (Money + Status + Time)) and moves if a rival beats their job by switchMargin; a
   * household looks at homes with chance lookHome x (1.2 - Roots) and moves if one beats theirs by moveMargin. Nobody
   * looks again within settleDays of a move or a new job.
   */
  lookJob: 0.012, switchMargin: 0.22, lookHome: 0.01, moveMargin: 0.12, settleDays: 7,
  /** how far a household looks for a new home (tiles), and how many candidates it compares at most */
  moveRadius: 30, homeOptions: 12,
  /** happiness: each part's delta times 1 + bend x (6 x weight - 1), clamped to bendLo..bendHi (a weight of 1/6 is neutral) */
  bend: 0.35, bendLo: 0.6, bendHi: 1.6,
};

/** Pack six 0-15 integers. */
export function packValues(n: readonly number[]): number {
  let v = 0;
  for (let i = VALUE_COUNT - 1; i >= 0; i--) v = v * 16 + Math.max(0, Math.min(15, Math.round(n[i])));
  return v;
}
/** The six 0-15 integers of a packed value. */
export function valueInts(v: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < VALUE_COUNT; i++) { out.push(v % 16); v = Math.floor(v / 16); }
  return out;
}
/** Weights summing to 1 from a packed value (0 or all zero: an even mix). */
export function valuesOf(v: number, out: number[] = new Array(VALUE_COUNT)): number[] {
  let sum = 0;
  for (let i = 0; i < VALUE_COUNT; i++) { out[i] = v % 16; sum += out[i]; v = Math.floor(v / 16); }
  for (let i = 0; i < VALUE_COUNT; i++) out[i] = sum > 0 ? out[i] / sum : 1 / VALUE_COUNT;
  return out;
}
/** Weights (any scale) to the packed form: the largest becomes 15, the rest in proportion. */
export function packWeights(w: readonly number[]): number {
  let max = 0;
  for (const x of w) if (x > max) max = x;
  if (max <= 0) return packValues([1, 1, 1, 1, 1, 1]);
  return packValues(w.map((x) => (15 * x) / max));
}

const pickShare = (u: number, shares: readonly number[]) => {
  let i = 0, total = 0;
  for (const s of shares) total += s;
  u *= total;
  for (; i < shares.length - 1; i++) { u -= shares[i]; if (u < 0) break; }
  return i;
};
/** An archetype blend from hashes of the id (salts 1601-1604), as weights. */
export function archetypeBlend(id: number): number[] {
  const a = pickShare(hash2(id, 1601), MOTIVE.mix);
  let b = pickShare(hash2(id, 1602), MOTIVE.mix);
  if (b === a) b = (a + 1 + Math.floor(hash2(id, 1605) * (ARCHETYPES.length - 1))) % ARCHETYPES.length;
  const share = hash2(id, 1603) < MOTIVE.pure ? 1 : MOTIVE.blendLo + (MOTIVE.blendHi - MOTIVE.blendLo) * hash2(id, 1604);
  return ARCHETYPES[a].w.map((x, i) => share * x + (1 - share) * ARCHETYPES[b].w[i]);
}
/** The hashed jitter (salts 1610-1615), applied in place: each weight times 1 ± jitter, plus a small floor. */
export function jitterValues(id: number, w: number[]): number[] {
  for (let i = 0; i < VALUE_COUNT; i++) w[i] = Math.max(0, (w[i] + 0.02) * (1 + MOTIVE.jitter * (2 * hash2(id, 1610 + i) - 1)));
  return w;
}
/** Values for someone with nothing else to go on: the archetype blend and the jitter, packed (old saves, sandboxes). */
export const seededValues = (id: number) => packWeights(jitterValues(id, archetypeBlend(id)));

/** The value with the largest weight, and the runner-up. */
export function topValues(w: readonly number[]): [number, number] {
  let a = 0, b = 1;
  if (w[b] > w[a]) { a = 1; b = 0; }
  for (let i = 2; i < w.length; i++) {
    if (w[i] > w[a]) { b = a; a = i; } else if (w[i] > w[b]) b = i;
  }
  return [a, b];
}
/**
 * The citizen panel's line (docs/motivation.md section 9), from life-adjusted weights: "Cares most about family;
 * restless". The second clause is a temperament: restless (Adventure), settled (Roots), ambitious (Status), or the
 * runner-up value when it is close.
 */
export function describeValues(w: readonly number[]): string {
  const [a, b] = topValues(w);
  let s = `Cares most about ${VALUE_WORDS[a]}`;
  const trait = a !== Value.Adventure && w[Value.Adventure] >= 0.22 ? 'restless'
    : a !== Value.Roots && w[Value.Roots] >= 0.25 ? 'settled'
    : a !== Value.Status && w[Value.Status] >= 0.22 ? 'ambitious'
    : a !== Value.Time && w[Value.Time] >= 0.25 ? 'easygoing'
    : w[b] >= 0.7 * w[a] ? `then ${VALUE_WORDS[b]}` : w[a] >= 0.5 ? 'above all' : '';
  if (trait) s += trait.startsWith('then') ? `, ${trait}` : `; ${trait}`;
  return s;
}

