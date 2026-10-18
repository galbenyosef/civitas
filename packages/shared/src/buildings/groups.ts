/**
 * Size ladders (docs/buildings.md "Groups and tiers"). A kind with `group` and `tier` is one rung of a ladder: the
 * tool bar shows one button per group and a size picker lists its tiers, smallest first. Every kind in a group
 * shares a family code, so the simulation treats them as one service (coverage, patrols, the building index) and
 * reads the per-tier numbers from the tables and attributes. Groups marked `reserved` belong to other cards and
 * have no kinds yet; their names are taken so nothing else claims them.
 */
export interface GroupDef {
  id: string;
  /** tool bar label */
  label: string;
  /** tool bar section the group's button sits in */
  section: 'Services' | 'Transport' | 'Leisure' | 'Landmarks';
  /** swatch colour of the group's button */
  color: string;
  /** what one tier holds, for the picker's capacity line: 'staff', 'builders', 'bays', 'visitors' */
  holds: string;
  reserved?: boolean;
  /**
   * A collection rather than a size ladder (the landmarks): its rungs are separate buildings of any family, in `tier`
   * order, so the one-family-code rule and the never-shrinks-up-the-ladder checks do not apply. The picker lists them the same way.
   */
  collection?: boolean;
  /** A ladder still in development: every rung may be a draft (validation otherwise calls that a mistake). Drop it when the first rung goes live. */
  draft?: boolean;
}

export const GROUPS: GroupDef[] = [
  { id: 'health', label: 'Health', section: 'Services', color: '#f4f4f4', holds: 'staff' },
  { id: 'police', label: 'Police', section: 'Services', color: '#3454a8', holds: 'officers' },
  { id: 'fire', label: 'Fire', section: 'Services', color: '#d6453a', holds: 'firefighters' },
  { id: 'builders', label: 'Builders', section: 'Services', color: '#a8713f', holds: 'builders' },
  { id: 'parking', label: 'Parking', section: 'Transport', color: '#5c6270', holds: 'bays' },
  { id: 'metro', label: 'Underground', section: 'Transport', color: '#dc241f', holds: 'staff', draft: true },
  { id: 'park', label: 'Parks', section: 'Leisure', color: '#4f9a5c', holds: 'visitors' },
  { id: 'cinema', label: 'Cinemas', section: 'Leisure', color: '#b8434f', holds: 'seats' },
  { id: 'theatre', label: 'Theatres', section: 'Leisure', color: '#7a3e8f', holds: 'seats' },
  { id: 'sports', label: 'Sport', section: 'Leisure', color: '#2f6fb5', holds: 'visitors' },
  { id: 'library', label: 'Libraries', section: 'Leisure', color: '#a8875a', holds: 'visitors' },
  // landmarks (docs/buildings.md "Landmarks"): real buildings, one picker per city; buildings/landmarks-london.ts
  { id: 'london', label: 'London', section: 'Landmarks', color: '#c8102e', holds: 'staff', collection: true },
  // reserved for other cards
  { id: 'bus', label: 'Buses', section: 'Transport', color: '#e0a92e', holds: 'staff', reserved: true },
  { id: 'rail', label: 'Rail', section: 'Transport', color: '#b0563d', holds: 'staff', reserved: true },
  { id: 'airport', label: 'Airports', section: 'Transport', color: '#2b2e33', holds: 'staff', reserved: true },
  { id: 'education', label: 'Education', section: 'Services', color: '#d8b25a', holds: 'pupils', reserved: true },
];
export const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));
