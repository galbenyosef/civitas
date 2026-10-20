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
  /**
   * A ladder of stages rather than sizes (education): tiers run in the order a pupil moves up, so what a rung holds and
   * what it costs need not grow with the tier. Build work still grows with the footprint.
   */
  stages?: boolean;
  /** A ladder still in development: every rung may be a draft (validation otherwise calls that a mistake). Drop it when the first rung goes live. */
  draft?: boolean;
}

export const GROUPS: GroupDef[] = [
  { id: 'health', label: 'Health', section: 'Services', color: '#f4f4f4', holds: 'staff' },
  { id: 'police', label: 'Police', section: 'Services', color: '#3454a8', holds: 'officers' },
  { id: 'fire', label: 'Fire', section: 'Services', color: '#d6453a', holds: 'firefighters' },
  { id: 'builders', label: 'Builders', section: 'Services', color: '#a8713f', holds: 'builders' },
  { id: 'parking', label: 'Parking', section: 'Transport', color: '#5c6270', holds: 'bays' },
  { id: 'metro', label: 'Underground', section: 'Transport', color: '#dc241f', holds: 'staff' },
  // harbours (docs/boats.md section 5): a jetty up to a cargo port
  { id: 'harbour', label: 'Harbours', section: 'Transport', color: '#2f7fb0', holds: 'staff' },
  { id: 'park', label: 'Parks', section: 'Leisure', color: '#4f9a5c', holds: 'visitors' },
  { id: 'cinema', label: 'Cinemas', section: 'Leisure', color: '#b8434f', holds: 'seats' },
  { id: 'theatre', label: 'Theatres', section: 'Leisure', color: '#7a3e8f', holds: 'seats' },
  { id: 'sports', label: 'Sport', section: 'Leisure', color: '#2f6fb5', holds: 'visitors' },
  { id: 'library', label: 'Libraries', section: 'Leisure', color: '#a8875a', holds: 'visitors' },
  // education (docs/education.md section 3): nursery to research institute, sub-kinds of the library family (code 14)
  { id: 'education', label: 'Education', section: 'Services', color: '#d8b25a', holds: 'pupils', stages: true },
  // broadcasters (docs/media.md): a local TV studio, a broadcast centre and a media centre with a news helipad (buildings/media.ts)
  { id: 'media', label: 'Media', section: 'Services', color: '#c8463c', holds: 'staff' },
  // death and remembrance (docs/remembrance.md): churchyard, municipal and garden cemetery, crematorium (buildings/remembrance.ts);
  // `stages`: the crematorium, last, is smaller and cheaper than the garden cemetery and takes in more
  { id: 'remembrance', label: 'Cemeteries', section: 'Services', color: '#5d7a52', holds: 'plots', stages: true },
  // utilities (docs/utilities.md): the power network's nodes and depot, and its plants (buildings/utilities.ts)
  { id: 'grid', label: 'Power grid', section: 'Services', color: '#d9a43a', holds: 'staff', stages: true },
  { id: 'power', label: 'Power stations', section: 'Services', color: '#8f9aa6', holds: 'staff' },
  // landmarks (docs/buildings.md "Landmarks"): real buildings, one picker per city; buildings/landmarks-london.ts
  { id: 'london', label: 'London', section: 'Landmarks', color: '#c8102e', holds: 'staff', collection: true },
  // reserved for other cards
  { id: 'bus', label: 'Buses', section: 'Transport', color: '#e0a92e', holds: 'staff', reserved: true },
  { id: 'rail', label: 'Rail', section: 'Transport', color: '#b0563d', holds: 'staff', reserved: true },
  { id: 'airport', label: 'Airports', section: 'Transport', color: '#2b2e33', holds: 'staff', reserved: true },
];
export const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));
