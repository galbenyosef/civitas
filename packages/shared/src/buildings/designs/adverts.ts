import type { ExtraDesign } from './index';
import { lotOps } from '../transport';
import { billboard } from '../zonekit';

/**
 * Designs with an ad slot added to existing kinds (docs/adverts.md section 2): a surface car park with a roadside 48-sheet
 * billboard on tall legs over its back row, so about half of all lots carry one, by tile hash. Live, not drafts.
 */
export const AD_DESIGNS: ExtraDesign[] = [
  { kind: 'parking', level: 1, design: { name: 'the lot with a billboard over the back row', height: 0.5, author: 'claude-opus-5-5', ops: [...lotOps(0.02, 'office'), ...billboard(0, -0.4, 0.16)] } },
];
