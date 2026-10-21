import type { Attributes } from './schema';
import { Zone } from './codes';
import { office } from './office';
import { library } from './leisure';

/** Role presets for draft landmarks (landmark-drafts.ts, docs/landmarks.md sections 1 and 11). Re-exported by landmark-drafts.ts. */

/** What every draft landmark shares. Spread it first and the kind is a draft landmark. */
export const DRAFT = { landmark: true, draft: true, tags: ['draft'] };

/**
 * Role presets: what the simulation treats your landmark as (docs/landmarks.md section 1). Spread one and override.
 * `asOffice`: a workplace for office staff, nine to five (a town hall, a headquarters, a tower).
 * `asAttraction`: a daytime visitor attraction of the library family with a ticket (a cathedral, a castle, a museum, a monument).
 */
export const asOffice = {
  code: Zone.Office, family: 'office' as const, flags: { civic: true, workplace: true }, windows: 'office' as const,
  occupation: office.occupation, lot: { wage: 14 },
};
export const asAttraction = {
  code: library.code, family: 'leisure' as const, flags: { civic: true, workplace: true, leisureReady: true }, windows: 'civic' as const,
  occupation: library.occupation, lot: { wage: 16 },
  attrs: { ...library.attrs, visitorCapacity: 40, ticket: 4, openHours: [9, 18], stay: [0.5, 1.5], leisureValue: 4, radius: 16, dayAppeal: 1.2, eveningAppeal: 0.1, retireeAppeal: 1.8, childAppeal: 1.2 } as Attributes,
};
