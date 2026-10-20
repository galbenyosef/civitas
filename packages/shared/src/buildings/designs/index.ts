import type { Design } from '../schema';
import { HAIKU_SAMPLE, HAIKU_RAW } from './haiku-sample';
import { FACADE_EXAMPLES } from './examples';
import { HAIKU_RESIDENTIAL_1 } from './haiku-residential-1';
import { HAIKU_RESIDENTIAL_2 } from './haiku-residential-2';
import { HAIKU_RESIDENTIAL_3 } from './haiku-residential-3';
import { HAIKU_COMMERCIAL_1 } from './haiku-commercial-1';
import { HAIKU_COMMERCIAL_2 } from './haiku-commercial-2';
import { HAIKU_COMMERCIAL_3 } from './haiku-commercial-3';
import { HAIKU_INDUSTRIAL_1 } from './haiku-industrial-1';
import { HAIKU_INDUSTRIAL_2 } from './haiku-industrial-2';
import { HAIKU_INDUSTRIAL_3 } from './haiku-industrial-3';
import { AD_DESIGNS } from './adverts';

/**
 * Extra designs contributed outside the family files (trials, contributors,
 * AI-model samples). Each entry adds one design to an existing kind+level.
 * Mark them `draft: true` until reviewed: drafts are compiled and shown in the
 * viewer only, so they never change what the city places. Set `author` so the
 * viewer can show and filter who designed it.
 */
export interface ExtraDesign { kind: string; level: number; design: Design }

export const EXTRA_DESIGNS: ExtraDesign[] = [...HAIKU_SAMPLE, ...HAIKU_RAW, ...FACADE_EXAMPLES,
  ...HAIKU_RESIDENTIAL_1, ...HAIKU_RESIDENTIAL_2, ...HAIKU_RESIDENTIAL_3, ...HAIKU_COMMERCIAL_1, ...HAIKU_COMMERCIAL_2, ...HAIKU_COMMERCIAL_3, ...HAIKU_INDUSTRIAL_1, ...HAIKU_INDUSTRIAL_2, ...HAIKU_INDUSTRIAL_3,
  ...AD_DESIGNS];
