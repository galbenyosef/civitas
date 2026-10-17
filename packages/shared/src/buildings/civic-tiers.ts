import type { KindDef, Op } from './schema';
import { Zone } from './codes';
import { repeat } from './helpers';
import { police, fire, hospital, yard } from './civic';
import { slab, car, carRow, bayLines, van, engine, tree, pine, treeLine, helipad, mast, lampPost, signBoard, fence, block, plant, flags, ASPHALT, PAVING } from './tierkit';

/**
 * Size ladders for the staffed services (groups.ts): health, police, fire and rescue, builders. Each rung is a
 * sub-kind of its family's code (docs/sub-kinds.md, kind ids 40-55), so the simulation treats a GP surgery as part of
 * the hospital family (doctor's visits, coverage, ambulances) and a police box as a police station, with its own
 * staff, cost, upkeep, build work and the tier attributes `serviceRadius`, `serviceStrength`, `patrolRate` and, for
 * builders, `workRate` (shared/src/tiers.ts reads them). The original station, hospital and yard stay rungs of
 * their ladders unchanged. Recipes for footprints bigger than 1×1 are authored in tiles for the whole footprint.
 */

const cross = (x: number, y: number, z: number, s: number, color: 'crossRed' | 'green' = 'crossRed'): Op[] => [
  ['box', s, s * 0.32, 0.02, x, y, z, color], ['box', s * 0.32, s, 0.02, x, y - s * 0.34, z, color],
];
const roofCross = (x: number, y: number, z: number, s: number): Op[] => [
  ['box', s, 0.03, s * 0.3, x, y, z, 'crossRed'], ['box', s * 0.3, 0.03, s, x, y, z, 'crossRed'],
];
const ambulance = (x: number, z: number, alongX = false) => van(x, z, 'white', 'crossRed', alongX);
const policeCar = (x: number, z: number, alongX = false): Op[] => [...car(x, z, 'white', alongX), ['box', alongX ? 0.2 : 0.1, 0.012, alongX ? 0.1 : 0.2, x, 0.045, z, 'signBlue'], ['box', 0.03, 0.015, 0.03, x, 0.1, z, 'boxBlue']];

// ================================================================= health

export const gpSurgery: KindDef = {
  id: 'gp-surgery', name: 'GP surgery', code: Zone.Hospital, kindId: 40, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'health', tier: 1,
  blurb: 'A family doctor, a nurse and a receptionist on one plot. People nearby see a doctor without crossing town, but there is no ward and no ambulance.',
  howTo: 'Put one in each neighbourhood, beside a road. It counts as half a health service for the homes around it; grow into a health centre where the queue gets long.',
  tool: { id: 'gp', key: '', label: 'GP surgery', color: '#e9f4ec' },
  occupation: { ...hospital.occupation!, name: 'GP practice staff', shifts: [{ start: 8, hours: 9, weight: 1 }], cycles: [[1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 0, 0, 1]] },
  lot: { wage: 24 },
  attrs: { serviceRadius: 9, serviceStrength: 0.5, patrolRate: 0 },
  levels: [{
    capacity: 6, wage: 24, cost: 350, upkeep: 14, work: 180, parking: { surface: 3, underground: 6 },
    designs: [
      { name: 'brick surgery with a pitched roof, a porch and a green cross', height: 0.56, ops: [
        slab(1, 1, PAVING),
        ['box', 0.7, 0.32, 0.46, 0, 0.02, -0.14, 'brick', true], ['roof', 0.76, 0.2, 0.52, 0, 0.34, -0.14, 'terracotta'],
        ['box', 0.26, 0.2, 0.14, -0.14, 0.02, 0.16, 'cream'], ['roof', 0.3, 0.08, 0.18, -0.14, 0.22, 0.16, 'terracotta', true],
        ['box', 0.1, 0.16, 0.02, -0.14, 0.02, 0.235, 'door'],
        ...cross(0.18, 0.28, 0.095, 0.1, 'green'),
        ['box', 0.2, 0.07, 0.02, 0.18, 0.06, 0.095, 'glass'],
        ...car(0.33, 0.36, 'silver'), ...tree(-0.38, 0.34, 0.8),
        ['box', 0.12, 0.05, 0.06, 0.06, 0.02, 0.38, 'hedge'],
      ] },
      { name: 'rendered villa practice with a bay window and a sign on posts', height: 0.6, ops: [
        slab(1, 1, 'gravel'),
        ['box', 0.5, 0.4, 0.44, -0.14, 0.02, -0.16, 'cream', true], ['roof', 0.56, 0.18, 0.5, -0.14, 0.42, -0.16, 'slate', true],
        ['box', 0.22, 0.24, 0.1, -0.14, 0.02, 0.1, 'cream', true], ['box', 0.24, 0.03, 0.12, -0.14, 0.26, 0.1, 'slate'],
        ['box', 0.3, 0.24, 0.32, 0.27, 0.02, -0.2, 'white', true], ['box', 0.32, 0.03, 0.34, 0.27, 0.26, -0.2, 'dark'],
        ...signBoard(0.28, 0.36, 0.3, 'green'), ...cross(0.28, 0.21, 0.37, 0.05, 'green'),
        ...car(0.27, 0.12, 'navy'), ...tree(-0.4, 0.38, 0.7), ...pine(0.44, -0.42, 0.7),
      ] },
      { name: 'single-storey timber practice with a long canopy and a pharmacy hatch', height: 0.4, ops: [
        slab(1, 1, PAVING),
        ['box', 0.84, 0.26, 0.4, 0, 0.02, -0.18, 'tan', true], ['box', 0.88, 0.03, 0.46, 0, 0.28, -0.16, 'charcoal'],
        ['box', 0.84, 0.02, 0.18, 0, 0.24, 0.12, 'white'], ...repeat(3, (i): Op => ['cyl', 0.01, 0.01, 0.22, -0.36 + i * 0.36, 0.02, 0.2, 'steel', 4]),
        ['box', 0.24, 0.16, 0.02, -0.18, 0.02, 0.025, 'glass'], ['box', 0.12, 0.08, 0.02, 0.24, 0.1, 0.025, 'mint'],
        ...cross(0.24, 0.36, 0.03, 0.08, 'green'), ...plant(-0.3, 0.3, -0.24, 2),
        ...car(-0.34, 0.38, 'red', true), ...tree(0.4, 0.38, 0.65),
      ] },
    ],
  }],
};

export const healthCentre: KindDef = {
  id: 'health-centre', name: 'health centre', code: Zone.Hospital, kindId: 41, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'health', tier: 2,
  footprint: { w: 2, h: 1, door: [1, 0] },
  blurb: 'Several GP practices, a dentist and a pharmacy under one long roof. Covers a wider patch than a surgery and sends the odd ambulance.',
  howTo: 'Two tiles wide along a road (Z and C turn it). Good for a district centre where several neighbourhoods meet.',
  tool: { id: 'healthcentre', key: '', label: 'Health centre', color: '#d9efe0' },
  occupation: { ...hospital.occupation!, name: 'health centre staff', shifts: [{ start: 8, hours: 9, weight: 1 }, { start: 12, hours: 9, weight: 0.5 }], cycles: [[1, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 1, 1, 0]] },
  lot: { wage: 25 },
  attrs: { serviceRadius: 11, serviceStrength: 0.75, patrolRate: 0.25 },
  levels: [{
    capacity: 12, wage: 25, cost: 600, upkeep: 26, work: 400, parking: { surface: 6, underground: 12 },
    designs: [
      { name: 'two-storey health centre with a glass drum entrance and a green band', height: 0.66, ops: [
        slab(2, 1, PAVING),
        ...block(1.5, 0.56, 0.44, -0.2, -0.18, 'white', 'green'),
        ['cyl', 0.18, 0.18, 0.4, 0.55, 0.0, -0.06, 'glass', 14], ['cyl', 0.2, 0.2, 0.03, 0.55, 0.4, -0.06, 'silver', 14],
        ...cross(0.55, 0.62, 0.13, 0.12, 'green'),
        ...bayLines(-0.9, 0.3, 5, 0.17, 0.3), ...carRow(-0.82, 0.3, 5, 0.17, false, 0.02, 1),
        ...tree(0.88, 0.32, 0.8), ...tree(0.22, 0.36, 0.7),
      ] },
      { name: 'brick and timber wings round a glass link, with a planted roof', height: 0.58, ops: [
        slab(2, 1, 'gravel'),
        ['box', 0.76, 0.48, 0.5, -0.56, 0.02, -0.16, 'brick', true], ['box', 0.78, 0.04, 0.52, -0.56, 0.5, -0.16, 'lawnDark'],
        ['box', 0.32, 0.36, 0.34, -0.02, 0.02, -0.08, 'glass', true], ['box', 0.34, 0.03, 0.36, -0.02, 0.38, -0.08, 'silver'],
        ['box', 0.68, 0.4, 0.44, 0.56, 0.02, -0.18, 'timber', true], ['box', 0.7, 0.04, 0.46, 0.56, 0.42, -0.18, 'lawnDark'],
        ['box', 0.36, 0.12, 0.02, 0.56, 0.24, 0.045, 'mint'], ...cross(-0.02, 0.32, 0.095, 0.08, 'green'),
        ...signBoard(-0.6, 0.34, 0.34, 'green'), ...car(0.3, 0.34, 'white', true), ...car(0.7, 0.34, 'red', true),
        ...tree(-0.9, 0.36, 0.7), ...pine(0.94, 0.36, 0.7),
      ] },
    ],
  }],
};

export const walkInCentre: KindDef = {
  id: 'walk-in-centre', name: 'walk-in centre', code: Zone.Hospital, kindId: 42, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'health', tier: 3,
  footprint: { w: 2, h: 2, door: [1, 1], marks: [{ kind: 'gate', at: { edge: 'front', from: 0, to: 0 }, label: 'ambulance bay' }] },
  blurb: 'Minor injuries seen without an appointment, day and evening, with an X-ray room and its own ambulances. Nearly a full health service for a whole district.',
  howTo: 'A 2×2 lot with the door on a busy road; the ambulance bay is the left of the frontage. Pairs well with GP surgeries further out.',
  tool: { id: 'walkin', key: '', label: 'Walk-in centre', color: '#cfe8d6' },
  occupation: { ...hospital.occupation!, name: 'walk-in centre staff', shifts: [{ start: 7, hours: 8, weight: 1 }, { start: 14, hours: 8, weight: 0.9 }, { start: 22, hours: 8, weight: 0.3 }] },
  lot: { wage: 25 },
  attrs: { serviceRadius: 13, serviceStrength: 0.9, patrolRate: 0.5 },
  levels: [{
    capacity: 18, wage: 25, cost: 800, upkeep: 36, work: 600, parking: { surface: 10, underground: 20 },
    designs: [
      { name: 'three-storey clinic with a drop-off canopy and an ambulance bay', height: 0.98, ops: [
        slab(2, 2, PAVING),
        ...block(1.5, 0.84, 0.9, 0.18, -0.46, 'white', 'crossRed'), ...roofCross(0.18, 0.865, -0.46, 0.3), ...plant(0.6, 0.865, -0.8, 2),
        ['box', 1.1, 0.03, 0.4, 0.3, 0.32, 0.18, 'silver'], ...repeat(3, (i): Op => ['cyl', 0.012, 0.012, 0.3, -0.12 + i * 0.4, 0.02, 0.36, 'steel', 4]),
        ['box', 0.5, 0.26, 0.02, 0.3, 0.02, 0.0, 'glass'],
        ['box', 0.46, 0.006, 0.6, -0.72, 0.02, 0.5, 'yellow'], ...ambulance(-0.8, 0.5), ...ambulance(-0.62, 0.62),
        ...bayLines(0.0, 0.72, 5, 0.18, 0.28), ...carRow(0.09, 0.72, 5, 0.18, false, 0.02, 2),
        ...tree(-0.88, -0.86, 0.9), ...tree(-0.88, -0.3, 0.8),
      ] },
      { name: 'two pavilions round a garden atrium, with a green cross tower', height: 1.1, ops: [
        slab(2, 2, 'gravel'),
        ...block(0.7, 0.6, 1.3, -0.58, -0.25, 'cream', 'green'), ...block(0.7, 0.6, 1.3, 0.58, -0.25, 'cream', 'green'),
        ['box', 0.46, 0.5, 1.0, 0, 0.02, -0.25, 'glass', true], ['box', 0.48, 0.03, 1.02, 0, 0.52, -0.25, 'silver'],
        ['box', 0.2, 1.06, 0.2, 0.84, 0, 0.6, 'white', true], ...cross(0.84, 1.0, 0.71, 0.14, 'green'),
        ['box', 0.4, 0.004, 0.36, -0.1, 0.02, 0.62, 'lawn'], ...tree(-0.1, 0.62, 0.8),
        ...ambulance(-0.72, 0.68, true), ...car(0.36, 0.72, 'silver'), ...car(0.54, 0.72, 'navy'),
        ...treeLine(-0.88, -0.9, 0.88, -0.9, 5, 0.75),
      ] },
    ],
  }],
};

/** Hospital (the original 1×1, tier 4): its kind lives in civic.ts unchanged; civic.ts sets its group and tier. */

export const communityHospital: KindDef = {
  id: 'community-hospital', name: 'community hospital', code: Zone.Hospital, kindId: 43, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'health', tier: 5,
  footprint: { w: 3, h: 2, door: [1, 1], marks: [{ kind: 'gate', at: { edge: 'front', from: 0, to: 0 }, label: 'ambulance bay' }] },
  blurb: 'Wards, an outpatients wing and a round-the-clock minor injuries unit. A stronger service than the city hospital that reaches further, with more ambulances out.',
  howTo: 'Three tiles across and two deep, door in the middle of the frontage, ambulances out of the left tile. Needs Regional services.',
  tool: { id: 'commhospital', key: '', label: 'Community hospital', color: '#e4eef0' },
  occupation: { ...hospital.occupation!, name: 'hospital staff' },
  lot: { wage: 27 },
  attrs: { serviceRadius: 17, serviceStrength: 1.2, patrolRate: 1.3 },
  levels: [{
    capacity: 36, wage: 27, cost: 1800, upkeep: 75, work: 900, parking: { surface: 14, underground: 30 },
    designs: [
      { name: 'ward block across the back, an outpatients wing and an ambulance bay', height: 1.08, ops: [
        slab(3, 2, PAVING),
        ...block(2.7, 0.92, 0.7, 0, -0.6, 'white', 'navy'), ...roofCross(0.8, 0.945, -0.6, 0.32), ...plant(-1.0, 0.945, -0.72, 3), ...helipad(-0.15, 0.945, -0.6, 0.27),
        ...block(1.0, 0.44, 0.6, 0.2, 0.05, 'pale', null),
        ['box', 0.6, 0.03, 0.34, 0.2, 0.3, 0.52, 'silver'], ['box', 0.36, 0.26, 0.02, 0.2, 0.02, 0.36, 'glass'],
        ['box', 0.6, 0.006, 0.64, -1.1, 0.02, 0.5, 'yellow'], ...ambulance(-1.22, 0.48), ...ambulance(-0.98, 0.56),
        ...bayLines(0.82, 0.48, 3, 0.18, 0.4), ...carRow(0.91, 0.48, 3, 0.18, false, 0.02, 1),
        ...treeLine(-1.38, -0.1, -1.38, 0.2, 2, 0.8), ...tree(1.36, -0.12, 0.85),
      ] },
      { name: 'brick cottage hospital ranges round a garden, with a clock tower', height: 1.22, ops: [
        slab(3, 2, 'gravel'),
        ['box', 2.6, 0.5, 0.5, 0, 0.02, -0.68, 'brick', true], ['roof', 2.66, 0.26, 0.56, 0, 0.52, -0.68, 'slate'],
        ['box', 0.5, 0.5, 1.0, -1.1, 0.02, 0.0, 'brick', true], ['roof', 0.56, 0.24, 1.06, -1.1, 0.52, 0.0, 'slate', true],
        ['box', 0.5, 0.44, 0.9, 1.1, 0.02, -0.05, 'brick', true], ['roof', 0.56, 0.22, 0.96, 1.1, 0.46, -0.05, 'slate', true],
        ['box', 0.3, 0.84, 0.3, 0, 0.02, -0.3, 'stone', true], ['roof', 0.34, 0.3, 0.34, 0, 0.86, -0.3, 'slate', true], ['cyl', 0.07, 0.07, 0.02, 0, 0.66, -0.145, 'white', 12],
        ['box', 1.4, 0.004, 0.66, 0, 0.02, 0.18, 'lawn'], ['box', 0.12, 0.006, 0.66, 0, 0.024, 0.18, 'gravel'], ...tree(-0.5, 0.18, 0.9), ...tree(0.5, 0.2, 0.8),
        ...cross(0, 0.4, -0.425, 0.12), ...ambulance(-1.18, 0.7), ...car(1.0, 0.72, 'silver'), ...car(1.2, 0.72, 'red'),
      ] },
    ],
  }],
};

export const generalHospital: KindDef = {
  id: 'general-hospital', name: 'general hospital', code: Zone.Hospital, kindId: 44, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'health', tier: 6,
  footprint: { w: 3, h: 4, door: [1, 3], marks: [{ kind: 'gate', at: { edge: 'front', from: 0, to: 0 }, label: 'A&E ambulances' }, { kind: 'stand', at: [2, 0], label: 'helipad' }] },
  blurb: 'A district general hospital: accident and emergency, theatres, maternity and a helipad on the roof. Covers a large part of town and keeps ambulances moving all day.',
  howTo: 'Three tiles across and four deep; the A&E entrance is the left of the frontage. Leave road access all round for ambulances. Needs Metropolitan services.',
  tool: { id: 'genhospital', key: '', label: 'General hospital', color: '#dfe7ef' },
  occupation: { ...hospital.occupation!, name: 'hospital staff' },
  lot: { wage: 28 },
  attrs: { serviceRadius: 20, serviceStrength: 1.4, patrolRate: 2 },
  levels: [{
    capacity: 60, wage: 28, cost: 3200, upkeep: 120, work: 1500, parking: { surface: 24, underground: 50 },
    designs: [
      { name: 'ward tower with a rooftop helipad over a podium and an A&E canopy', height: 2.02, ops: [
        slab(3, 4, PAVING),
        ...block(2.6, 0.5, 2.0, 0, -0.85, 'pale', 'navy'),
        ...block(1.5, 1.4, 1.1, -0.3, -1.2, 'white', null, 0.52), ...roofCross(-0.6, 1.945, -1.2, 0.3), ...helipad(0.15, 1.945, -1.2, 0.3),
        ...block(0.8, 0.9, 1.0, 0.9, -1.25, 'white', 'navy', 0.52),
        ['box', 0.9, 0.03, 0.5, -0.9, 0.32, 0.45, 'crossRed'], ...repeat(2, (i): Op => ['cyl', 0.014, 0.014, 0.3, -1.25 + i * 0.7, 0.02, 0.62, 'steel', 4]),
        ['box', 0.6, 0.006, 0.9, -1.0, 0.02, 1.2, 'yellow'], ...ambulance(-1.15, 1.1), ...ambulance(-0.85, 1.25), ...ambulance(-1.15, 0.6),
        ...bayLines(0.0, 0.6, 7, 0.18, 0.34), ...carRow(0.09, 0.6, 7, 0.18, false, 0.02, 3),
        ...bayLines(0.0, 1.3, 7, 0.18, 0.34), ...carRow(0.09, 1.3, 7, 0.18, false, 0.02, 1),
        ...cross(-0.3, 1.7, -0.645, 0.2), ...treeLine(-1.4, 1.85, 1.4, 1.85, 7, 0.75),
      ] },
      { name: 'cruciform ward blocks, a boiler chimney and a helipad on the lawn', height: 1.72, ops: [
        slab(3, 4, 'gravel'),
        ...block(0.7, 1.1, 2.6, 0, -0.55, 'cream', 'green'), ...block(2.6, 0.9, 0.62, 0, -0.9, 'cream', 'green'),
        ...block(1.2, 0.5, 0.6, -0.5, 0.86, 'white', null), ['box', 1.0, 0.03, 0.34, -0.6, 0.3, 1.33, 'silver'],
        ...roofCross(0, 1.125, -0.55, 0.3),
        ['chimneyStack', 1.2, 0, -1.7, 1.7, 0.07, 'brick'], ['box', 0.46, 0.36, 0.4, 1.2, 0.02, -1.4, 'brick'],
        ['box', 0.84, 0.004, 0.84, 0.95, 0.02, 0.15, 'lawn'], ...helipad(0.95, 0.024, 0.15, 0.32),
        ['box', 0.5, 0.006, 0.6, -1.15, 0.02, 1.3, 'yellow'], ...ambulance(-1.2, 1.3), ...ambulance(-1.0, 1.4),
        ...bayLines(0.3, 1.5, 6, 0.18, 0.4), ...carRow(0.39, 1.5, 6, 0.18, false, 0.02, 2),
        ...tree(-1.2, -1.6, 0.9), ...tree(-1.2, -0.2, 0.9), ...tree(0.6, -1.6, 0.8), ...pine(-1.3, 0.3, 0.9),
      ] },
    ],
  }],
};

export const teachingHospital: KindDef = {
  id: 'teaching-hospital', name: 'teaching hospital', code: Zone.Hospital, kindId: 45, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'health', tier: 7,
  footprint: { w: 4, h: 4, door: [2, 3], marks: [{ kind: 'gate', at: { edge: 'front', from: 0, to: 0 }, label: 'A&E ambulances' }, { kind: 'stand', at: [3, 0], label: 'helipad' }] },
  blurb: 'A university hospital campus: specialist wards, a research wing and a medical school. The strongest health service there is, reaching across much of a city.',
  howTo: 'A whole 4×4 block; the main entrance is right of centre and A&E is on the left corner. Late game: needs the Medical school technology.',
  tool: { id: 'teachhospital', key: '', label: 'Teaching hospital', color: '#d6e2ee' },
  occupation: { ...hospital.occupation!, name: 'hospital staff', shifts: [{ start: 7, hours: 12, weight: 1 }, { start: 9, hours: 8, weight: 0.6 }, { start: 19, hours: 12, weight: 0.8 }] },
  lot: { wage: 30 },
  attrs: { serviceRadius: 24, serviceStrength: 1.6, patrolRate: 2.5 },
  levels: [{
    capacity: 90, wage: 30, cost: 5500, upkeep: 180, work: 2200, parking: { surface: 30, underground: 70 },
    designs: [
      { name: 'campus: ward tower, glass research wing, lecture drum and a quad', height: 2.42, ops: [
        slab(4, 4, PAVING),
        ...block(1.6, 0.6, 1.4, -1.0, -1.15, 'pale', 'navy'), ...block(1.1, 1.75, 0.95, -1.1, -1.3, 'white', null, 0.62), ...helipad(-1.1, 2.395, -1.3, 0.3),
        ['box', 1.3, 1.1, 0.9, 1.15, 0.02, -1.4, 'glass', true], ['box', 1.32, 0.04, 0.92, 1.15, 1.12, -1.4, 'silver'], ...plant(0.7, 1.16, -1.7, 4),
        ['box', 0.5, 0.06, 0.12, 0.05, 0.9, -1.4, 'glassDark'], // a bridge between the tower and the research wing
        ['cyl', 0.42, 0.44, 0.5, 1.2, 0.02, 0.15, 'stone', 18], ['cyl', 0.36, 0.42, 0.08, 1.2, 0.52, 0.15, 'roofGrey', 18],
        ['box', 1.5, 0.004, 1.1, -0.4, 0.02, 0.2, 'lawn'], ['box', 0.12, 0.006, 1.1, -0.4, 0.024, 0.2, 'gravel'], ['box', 1.5, 0.006, 0.12, -0.4, 0.024, 0.2, 'gravel'],
        ...tree(-0.9, -0.1, 0.9), ...tree(0.1, -0.1, 0.8), ...tree(-0.9, 0.55, 0.85), ...tree(0.1, 0.55, 0.9),
        ...block(1.1, 0.5, 0.5, 0.4, 1.15, 'white', 'navy'), ['box', 0.6, 0.03, 0.3, 0.6, 0.3, 1.55, 'silver'],
        ['box', 0.7, 0.006, 0.9, -1.55, 0.02, 1.4, 'yellow'], ...ambulance(-1.7, 1.45), ...ambulance(-1.45, 1.55), ...ambulance(-1.7, 0.95),
        ...cross(-1.1, 2.1, -0.82, 0.22), ...bayLines(1.15, 1.45, 4, 0.18, 0.5), ...carRow(1.24, 1.45, 4, 0.18, false, 0.02, 2),
      ] },
      { name: 'domed stone main hall, a research tower and glass link bridges', height: 2.62, ops: [
        slab(4, 4, 'gravel'),
        ['box', 2.6, 0.7, 0.9, -0.3, 0.02, -0.2, 'stone', true], ['box', 2.62, 0.05, 0.92, -0.3, 0.72, -0.2, 'cream'],
        ['cyl', 0.36, 0.36, 0.2, -0.3, 0.77, -0.2, 'stone', 16], ['cyl', 0.08, 0.36, 0.34, -0.3, 0.97, -0.2, 'roofGrey', 16], ['cyl', 0.04, 0.04, 0.12, -0.3, 1.31, -0.2, 'gold', 6],
        ...repeat(6, (i): Op => ['cyl', 0.035, 0.04, 0.5, -1.0 + i * 0.28, 0.06, 0.29, 'white', 8]), ['box', 1.6, 0.06, 0.16, -0.3, 0.56, 0.3, 'white'],
        ['box', 1.8, 0.04, 0.3, -0.3, 0.02, 0.45, 'white'],
        ...block(0.9, 2.3, 0.9, 1.35, -1.35, 'glassDark', null), ...helipad(1.35, 2.325, -1.35, 0.3),
        ...block(1.3, 1.1, 0.8, -1.2, -1.45, 'white', 'crossRed'), ...roofCross(-1.2, 1.125, -1.45, 0.3),
        ['box', 0.5, 0.08, 0.14, 0.65, 1.0, -1.35, 'glass'], ['box', 0.14, 0.08, 0.6, -1.2, 0.6, -0.9, 'glass'],
        ['box', 0.7, 0.006, 0.8, -1.55, 0.02, 1.45, 'yellow'], ...ambulance(-1.7, 1.5), ...ambulance(-1.45, 1.6),
        ...bayLines(0.3, 1.3, 8, 0.18, 0.4), ...carRow(0.39, 1.3, 8, 0.18, false, 0.02, 4),
        ...treeLine(-1.85, -0.4, -1.85, 0.8, 4, 0.8), ...treeLine(1.85, -0.5, 1.85, 0.8, 4, 0.8),
      ] },
    ],
  }],
};

// ================================================================= police

export const policeBox: KindDef = {
  id: 'police-box', name: 'police box', code: Zone.Police, kindId: 46, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'police', tier: 1,
  blurb: 'A blue box on a street corner with a telephone, a desk and a couple of beat officers. A light police presence for a few streets around it.',
  howTo: 'One tile beside any road. Cheap enough to dot about; counts as under half a police service for the homes nearby.',
  tool: { id: 'policebox', key: '', label: 'Police box', color: '#3d5fb8' },
  occupation: { ...police.occupation!, name: 'beat officer' },
  lot: { wage: 20 },
  attrs: { serviceRadius: 8, serviceStrength: 0.4, patrolRate: 0.4 },
  levels: [{
    capacity: 3, wage: 20, cost: 150, upkeep: 6, work: 120, parking: { surface: 0, underground: 2 },
    designs: [
      { name: 'blue police box on a paved corner with a lamp and a bench', height: 0.46, ops: [
        slab(1, 1, PAVING),
        ['box', 0.18, 0.32, 0.18, 0, 0.02, 0, 'navy'], ['box', 0.2, 0.03, 0.2, 0, 0.34, 0, 'navy'], ['box', 0.12, 0.06, 0.12, 0, 0.37, 0, 'navy'],
        ['box', 0.16, 0.03, 0.185, 0, 0.3, 0, 'white'], ['box', 0.12, 0.1, 0.185, 0, 0.16, 0, 'glass'], ['box', 0.03, 0.04, 0.03, 0, 0.43, 0, 'white', 'civic'],
        ['box', 0.26, 0.03, 0.08, -0.28, 0.06, 0.2, 'timber'], ['box', 0.03, 0.06, 0.06, -0.38, 0.02, 0.2, 'charcoal'], ['box', 0.03, 0.06, 0.06, -0.18, 0.02, 0.2, 'charcoal'],
        ...lampPost(0.3, 0.32, 0.36, 'white'), ...tree(0.32, -0.3, 0.8), ...tree(-0.3, -0.32, 0.7),
        ...repeat(3, (i): Op => ['cyl', 0.012, 0.014, 0.06, -0.12 + i * 0.12, 0.02, 0.42, 'charcoal', 5]),
      ] },
      { name: 'glass police point kiosk with a blue band and two patrol bikes', height: 0.42, ops: [
        slab(1, 1, 'gravel'),
        ['box', 0.42, 0.28, 0.3, -0.06, 0.02, -0.08, 'glass', true], ['box', 0.44, 0.06, 0.32, -0.06, 0.24, -0.08, 'navy'],
        ['box', 0.46, 0.02, 0.34, -0.06, 0.3, -0.08, 'charcoal'], ['box', 0.16, 0.025, 0.325, -0.06, 0.26, -0.08, 'white'],
        ...lampPost(0.28, 0.2, 0.34, 'signBlue'),
        ['wheel', 0.04, 0.01, 0.2, 0.06, 0.3, 'charcoal'], ['wheel', 0.04, 0.01, 0.2, 0.06, 0.44, 'charcoal'], ['box', 0.03, 0.04, 0.16, 0.2, 0.06, 0.37, 'white'],
        ['wheel', 0.04, 0.01, 0.32, 0.06, 0.3, 'charcoal'], ['wheel', 0.04, 0.01, 0.32, 0.06, 0.44, 'charcoal'], ['box', 0.03, 0.04, 0.16, 0.32, 0.06, 0.37, 'yellow'],
        ...tree(-0.36, 0.3, 0.75), ['box', 0.2, 0.05, 0.1, -0.06, 0.02, 0.3, 'hedge'],
      ] },
    ],
  }],
};

export const policePost: KindDef = {
  id: 'police-post', name: 'neighbourhood police post', code: Zone.Police, kindId: 47, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'police', tier: 2,
  blurb: 'A front counter, an interview room and a neighbourhood team with a car. Most of a police station for a neighbourhood, at a little over half the running cost.',
  howTo: 'One tile on a high street. Put a full station or a divisional station further out to cover the gaps.',
  tool: { id: 'policepost', key: '', label: 'Neighbourhood police post', color: '#3a58ac' },
  occupation: police.occupation,
  lot: { wage: 20 },
  attrs: { serviceRadius: 11, serviceStrength: 0.7, patrolRate: 0.7 },
  levels: [{
    capacity: 6, wage: 20, cost: 250, upkeep: 11, work: 200, parking: { surface: 2, underground: 5 },
    designs: [
      { name: 'two-storey shopfront post with a navy fascia, a blue lamp and a car', height: 0.66, ops: [
        slab(1, 1, PAVING),
        ['box', 0.8, 0.56, 0.6, 0, 0.02, -0.14, 0xdfe2e8, true], ['box', 0.82, 0.03, 0.62, 0, 0.58, -0.14, 'dark'],
        ['box', 0.82, 0.08, 0.04, 0, 0.26, 0.17, 'navy'], ['box', 0.4, 0.04, 0.045, 0, 0.28, 0.17, 'white'],
        ['box', 0.5, 0.2, 0.02, -0.08, 0.02, 0.165, 'glass'],
        ...lampPost(0.34, 0.24, 0.3, 'signBlue'), ...policeCar(-0.22, 0.34, true), ...plant(-0.2, 0.61, -0.3, 2),
      ] },
      { name: 'single-storey post with a chequered band and a radio mast', height: 0.84, ops: [
        slab(1, 1, 'gravel'),
        ['box', 0.66, 0.3, 0.46, -0.08, 0.02, -0.16, 'white', true],
        ...repeat(8, (i): Op => ['box', 0.08, 0.04, 0.465, -0.36 + i * 0.08, 0.22, -0.16, i % 2 ? 'navy' : 'white']),
        ['box', 0.7, 0.03, 0.5, -0.08, 0.32, -0.16, 'charcoal'], ...mast(0.18, 0.35, -0.3, 0.48),
        ['box', 0.14, 0.18, 0.02, -0.08, 0.02, 0.075, 'door'], ...lampPost(-0.3, 0.14, 0.26, 'signBlue'),
        ...policeCar(0.3, 0.3), ...fence(0.08, 0.46, 0.8, true, 'grey', 0.05),
      ] },
    ],
  }],
};

export const divisionalStation: KindDef = {
  id: 'divisional-station', name: 'divisional police station', code: Zone.Police, kindId: 48, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'police', tier: 4,
  footprint: { w: 2, h: 2, door: [0, 1], marks: [{ kind: 'gate', at: { edge: 'front', from: 1, to: 1 }, label: 'car pound gate' }] },
  blurb: 'Custody cells, detectives and a fenced car pound for towed and seized cars. Covers a whole division and keeps twice the patrols of a station on the road.',
  howTo: 'A 2×2 lot with the front counter on the left and the pound gate on the right of the frontage. Needs Regional services.',
  tool: { id: 'divstation', key: '', label: 'Divisional police station', color: '#2f4e9e' },
  occupation: police.occupation,
  lot: { wage: 21 },
  attrs: { serviceRadius: 18, serviceStrength: 1.25, patrolRate: 1.8 },
  levels: [{
    capacity: 24, wage: 21, cost: 1100, upkeep: 42, work: 700, parking: { surface: 12, underground: 24 },
    designs: [
      { name: 'three-storey station with a radio mast beside a fenced car pound', height: 1.4, ops: [
        slab(2, 2, PAVING),
        ...block(0.92, 0.86, 1.6, -0.5, -0.12, 0xe1e5ec, 'navy'), ...mast(-0.7, 0.885, -0.7, 0.5), ...plant(-0.5, 0.885, 0.3, 2),
        ['box', 0.5, 0.06, 0.04, -0.5, 0.44, 0.69, 'navy'], ['box', 0.36, 0.26, 0.02, -0.5, 0.02, 0.685, 'glass'],
        ...lampPost(-0.12, 0.8, 0.32, 'signBlue'),
        ['box', 0.92, 0.006, 1.7, 0.5, 0.02, 0.05, ASPHALT],
        ...fence(0.5, -0.8, 0.9, true, 'grey', 0.12), ...fence(0.96, 0.05, 1.7, false, 'grey', 0.12), ...fence(0.04, -0.3, 1.0, false, 'grey', 0.12),
        ...carRow(0.18, -0.55, 4, 0.2, false, 0.02, 4), ...carRow(0.18, -0.12, 4, 0.2, false, 0.02, 2), ...carRow(0.18, 0.3, 4, 0.2, false, 0.02, 1),
        ...policeCar(-0.85, 0.82, true), ...policeCar(-0.85, 0.6, true),
      ] },
      { name: 'red-brick station with gables, a custody block and a pound at the front', height: 1.08, ops: [
        slab(2, 2, 'gravel'),
        ['box', 1.7, 0.62, 0.62, 0, 0.02, -0.62, 'brick', true], ['roof', 1.76, 0.3, 0.68, 0, 0.64, -0.62, 'slate'],
        ['box', 0.4, 0.74, 0.3, -0.5, 0.02, -0.18, 'brick', true], ['roof', 0.44, 0.26, 0.34, -0.5, 0.76, -0.18, 'slate', true],
        ['box', 0.42, 0.06, 0.04, -0.5, 0.48, -0.02, 'navy'], ['box', 0.12, 0.2, 0.02, -0.5, 0.02, -0.025, 'door'],
        ...block(0.6, 0.42, 0.5, -0.6, 0.38, 'pale', null), ...lampPost(-0.2, 0.3, 0.3, 'signBlue'),
        ['box', 0.86, 0.006, 0.9, 0.5, 0.02, 0.45, ASPHALT], ...fence(0.5, 0.0, 0.86, true, 'grey', 0.12), ...fence(0.07, 0.45, 0.9, false, 'grey', 0.12), ...fence(0.93, 0.45, 0.9, false, 'grey', 0.12),
        ...carRow(0.2, 0.22, 4, 0.2, false, 0.02, 3), ...carRow(0.2, 0.68, 3, 0.2, false, 0.02, 1),
        ...mast(0.8, 0.94, -0.85, 0.4), ...policeCar(-0.86, 0.82, true),
      ] },
    ],
  }],
};

export const policeHq: KindDef = {
  id: 'police-hq', name: 'police headquarters', code: Zone.Police, kindId: 49, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'police', tier: 5,
  footprint: { w: 3, h: 3, door: [1, 2], marks: [{ kind: 'apron', at: { edge: 'back', from: 1, to: 2, depth: 1 }, label: 'training yard' }] },
  blurb: 'The force headquarters: a control room, specialist squads, a training yard and a tall radio mast. The strongest police cover in town and patrols in every direction.',
  howTo: 'A 3×3 block with the door in the middle of the frontage; the training yard takes the back right. Late game: needs Metropolitan services.',
  tool: { id: 'policehq', key: '', label: 'Police headquarters', color: '#243f86' },
  occupation: police.occupation,
  lot: { wage: 22 },
  attrs: { serviceRadius: 22, serviceStrength: 1.5, patrolRate: 2.6 },
  levels: [{
    capacity: 40, wage: 22, cost: 2600, upkeep: 80, work: 1300, parking: { surface: 20, underground: 40 },
    designs: [
      { name: 'glass headquarters tower with a lattice radio mast and a training yard', height: 2.5, ops: [
        slab(3, 3, PAVING),
        ...block(1.3, 1.5, 1.1, -0.6, -0.4, 'glassDark', 'navy'), ...helipad(-0.6, 1.525, -0.4, 0.26),
        ...block(2.4, 0.46, 0.7, -0.2, 0.62, 0xe1e5ec, 'navy'), ['box', 0.6, 0.06, 0.05, 0, 0.3, 0.98, 'navy'],
        ['cyl', 0.02, 0.06, 2.4, 1.1, 0.02, 1.1, 'steel', 4], ['box', 0.3, 0.02, 0.02, 1.1, 1.6, 1.1, 'steel'], ['box', 0.22, 0.02, 0.02, 1.1, 2.0, 1.1, 'steel'], ['cyl', 0.02, 0.02, 0.06, 1.1, 2.42, 1.1, 'red', 5],
        ['box', 1.36, 0.006, 1.3, 0.75, 0.02, -0.75, ASPHALT], ...repeat(5, (i): Op => ['cone', 0.025, 0.06, 0.3 + i * 0.22, 0.026, -0.6, 'boxOrange', 6]),
        ...repeat(4, (i): Op => ['box', 0.2, 0.006, 0.012, 0.35 + i * 0.27, 0.027, -1.0, 'white']), ...policeCar(0.5, -1.15, true), ...policeCar(0.95, -0.3, true),
        ...lampPost(-0.1, 1.3, 0.34, 'signBlue'), ...lampPost(0.1, 1.3, 0.34, 'signBlue'),
        ...bayLines(-1.4, 1.22, 5, 0.2, 0.36), ...carRow(-1.3, 1.22, 5, 0.2, false, 0.02, 2),
        ...flags(0.4, 1.2, 3, 0.18, ['navy', 'white', 'navy'], 0.02),
      ] },
      { name: 'stone headquarters round a parade ground, with a mast on the roof', height: 1.9, ops: [
        slab(3, 3, 'gravel'),
        ['box', 2.8, 0.8, 0.6, 0, 0.02, -1.15, 'stone', true], ['box', 2.82, 0.05, 0.62, 0, 0.82, -1.15, 'dark'],
        ['box', 0.6, 0.66, 1.6, -1.15, 0.02, 0.0, 'stone', true], ['box', 0.62, 0.05, 1.62, -1.15, 0.68, 0.0, 'dark'],
        ['box', 0.6, 0.66, 1.0, 1.15, 0.02, -0.3, 'stone', true], ['box', 0.62, 0.05, 1.02, 1.15, 0.68, -0.3, 'dark'],
        ['box', 1.1, 0.95, 0.5, 0, 0.02, 1.1, 'stone', true], ['box', 1.12, 0.06, 0.52, 0, 0.97, 1.1, 'navy'], ['box', 0.3, 0.3, 0.02, 0, 0.02, 1.355, 'door'],
        ['box', 1.6, 0.006, 1.5, 0.15, 0.02, -0.05, ASPHALT], ...repeat(3, (i): Op => ['box', 1.4, 0.006, 0.014, 0.15, 0.027, -0.5 + i * 0.4, 'white']),
        ...repeat(4, (i): Op => ['cone', 0.025, 0.06, -0.4 + i * 0.3, 0.026, 0.3, 'boxOrange', 6]), ...policeCar(0.7, 0.4), ...policeCar(0.5, 0.4),
        ...mast(0.9, 0.84, -1.2, 1.0), ...flags(-1.3, 1.3, 2, 0.2, ['navy', 'white'], 0.02), ...policeCar(1.15, 1.15, true),
        ...tree(1.3, 0.6, 0.85), ...tree(-1.3, 1.1, 0.85),
      ] },
    ],
  }],
};

// ================================================================= fire and rescue

export const firePost: KindDef = {
  id: 'fire-post', name: 'fire post', code: Zone.Fire, kindId: 50, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'fire', tier: 1,
  blurb: 'One engine and a retained crew in a single-bay garage. Covers the streets around it and turns out now and then; a full station covers more.',
  howTo: 'One tile beside a road, bay door to the road. Use them to fill gaps between stations.',
  tool: { id: 'firepost', key: '', label: 'Fire post', color: '#e0584c' },
  occupation: fire.occupation,
  lot: { wage: 20 },
  attrs: { serviceRadius: 9, serviceStrength: 0.6, patrolRate: 0.5 },
  levels: [{
    capacity: 4, wage: 20, cost: 220, upkeep: 9, work: 180, parking: { surface: 1, underground: 3 },
    designs: [
      { name: 'single-bay brick fire post with an engine out front and a hose tower', height: 0.86, ops: [
        slab(1, 1, PAVING),
        ['box', 0.5, 0.42, 0.56, -0.12, 0.02, -0.16, 'red', true], ['box', 0.52, 0.03, 0.58, -0.12, 0.44, -0.16, 'dark'],
        ['box', 0.34, 0.3, 0.02, -0.12, 0.02, 0.125, 0xd8d8d8],
        ['box', 0.26, 0.3, 0.3, 0.3, 0.02, -0.26, 'brick', true], ['box', 0.16, 0.84, 0.16, 0.3, 0.02, -0.34, 'red', true], ['box', 0.18, 0.03, 0.18, 0.3, 0.86, -0.34, 'dark'],
        ...engine(-0.12, 0.3), ...lampPost(0.36, 0.3, 0.3, 'red'),
      ] },
      { name: 'corrugated retained-crew shed with a roller door and a siren pole', height: 0.72, ops: [
        slab(1, 1, 'gravel'),
        ['box', 0.62, 0.36, 0.54, 0, 0.02, -0.16, 'corrugated'], ['roof', 0.66, 0.14, 0.58, 0, 0.38, -0.16, 'red', true],
        ['box', 0.38, 0.3, 0.02, -0.06, 0.02, 0.115, 'red'], ...repeat(5, (i): Op => ['box', 0.38, 0.006, 0.022, -0.06, 0.06 + i * 0.05, 0.115, 'dark']),
        ['box', 0.14, 0.2, 0.02, 0.22, 0.02, 0.115, 'door'],
        ['cyl', 0.012, 0.016, 0.68, 0.38, 0.02, 0.32, 'steel', 5], ['cyl', 0.04, 0.03, 0.05, 0.38, 0.68, 0.32, 'red', 8],
        ...engine(-0.3, 0.32, true), ...tree(-0.4, -0.38, 0.7),
      ] },
    ],
  }],
};

export const largeFireStation: KindDef = {
  id: 'large-fire-station', name: 'large fire station', code: Zone.Fire, kindId: 51, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'fire', tier: 3,
  footprint: { w: 2, h: 2, door: [1, 1], marks: [{ kind: 'gate', at: { edge: 'front' }, label: 'appliance bays' }, { kind: 'stand', at: [0, 0], label: 'training tower' }] },
  blurb: 'Four appliance bays, a rescue tender and a drill tower for training. Wider cover than a station and nearly twice the call-outs.',
  howTo: 'A 2×2 lot with every bay facing the road; the drill tower stands at the back left. Needs Regional services.',
  tool: { id: 'bigfire', key: '', label: 'Large fire station', color: '#c83c31' },
  occupation: fire.occupation,
  lot: { wage: 21 },
  attrs: { serviceRadius: 18, serviceStrength: 1.25, patrolRate: 1.7 },
  levels: [{
    capacity: 16, wage: 21, cost: 1000, upkeep: 36, work: 650, parking: { surface: 6, underground: 12 },
    designs: [
      { name: 'four-bay brick station with a drill tower and engines on the apron', height: 1.52, ops: [
        slab(2, 2, PAVING),
        ['box', 1.7, 0.6, 0.8, 0.1, 0.02, -0.22, 'brick', true], ['box', 1.72, 0.06, 0.82, 0.1, 0.44, -0.22, 'red'], ['box', 1.72, 0.03, 0.82, 0.1, 0.62, -0.22, 'dark'],
        ...repeat(4, (i): Op => ['box', 0.32, 0.36, 0.02, -0.53 + i * 0.42, 0.02, 0.185, 0xd8d8d8]),
        ['box', 0.3, 1.5, 0.3, -0.78, 0.02, -0.76, 'red', true], ['box', 0.32, 0.03, 0.32, -0.78, 1.52, -0.76, 'dark'], ...repeat(4, (i): Op => ['box', 0.31, 0.012, 0.012, -0.78, 0.3 + i * 0.3, -0.6, 'white']),
        ['box', 1.7, 0.006, 0.6, 0.1, 0.02, 0.62, ASPHALT], ...engine(-0.53, 0.55), ...engine(-0.11, 0.62), ...van(0.31, 0.55, 'red', 'yellow'),
        ...plant(0.3, 0.65, -0.4, 3), ...lampPost(0.9, 0.85, 0.3, 'red'),
      ] },
      { name: 'steel and glass station with a curved roof and a lattice drill tower', height: 1.6, ops: [
        slab(2, 2, 'gravel'),
        ['box', 1.5, 0.5, 0.84, 0.2, 0.02, -0.2, 'charcoal', true], ['cyl', 0.44, 0.44, 1.52, 0.2, 0.3, -0.2, 'red', 12],
        ...repeat(3, (i): Op => ['box', 0.36, 0.36, 0.02, -0.25 + i * 0.45, 0.02, 0.225, 'glass']),
        ...repeat(4, (i): Op => ['cyl', 0.014, 0.014, 1.5, -0.95 + (i % 2) * 0.3, 0.02, -0.95 + Math.floor(i / 2) * 0.3, 'steel', 4]),
        ...repeat(5, (i): Op => ['box', 0.32, 0.02, 0.32, -0.8, 0.3 + i * 0.3, -0.8, 'red']),
        ...repeat(3, (i): Op => ['box', 0.006, 0.4, 0.04, -0.3 + i * 0.12, 0.02, -0.92, i % 2 ? 'yellow' : 'red']),
        ['box', 1.6, 0.006, 0.64, 0.15, 0.02, 0.62, ASPHALT], ...engine(-0.25, 0.6), ...engine(0.2, 0.6), ...engine(0.65, 0.66),
        ...tree(-0.88, 0.72, 0.8),
      ] },
    ],
  }],
};

export const fireHq: KindDef = {
  id: 'fire-hq', name: 'fire and rescue headquarters', code: Zone.Fire, kindId: 52, family: 'civic',
  flags: { civic: true, service: true, workplace: true }, windows: 'civic',
  group: 'fire', tier: 4,
  footprint: { w: 3, h: 3, door: [1, 2], marks: [{ kind: 'gate', at: { edge: 'front' }, label: 'appliance bays' }, { kind: 'apron', at: { edge: 'back', depth: 1 }, label: 'training ground' }] },
  blurb: 'The brigade headquarters: a six-bay appliance hall, the control room, a training tower and a smoke house. The strongest fire cover there is, with engines out across a large area.',
  howTo: 'A 3×3 block, bays along the front; the training ground fills the back row. Late game: needs Metropolitan services.',
  tool: { id: 'firehq', key: '', label: 'Fire and rescue HQ', color: '#b0342a' },
  occupation: fire.occupation,
  lot: { wage: 22 },
  attrs: { serviceRadius: 22, serviceStrength: 1.5, patrolRate: 2.5 },
  levels: [{
    capacity: 28, wage: 22, cost: 2400, upkeep: 70, work: 1200, parking: { surface: 12, underground: 24 },
    designs: [
      { name: 'six-bay appliance hall, control block with a mast, drill tower and smoke house', height: 2.0, ops: [
        slab(3, 3, PAVING),
        ['box', 2.6, 0.62, 0.9, 0, 0.02, 0.3, 'red', true], ['box', 2.62, 0.03, 0.92, 0, 0.64, 0.3, 'dark'],
        ...repeat(6, (i): Op => ['box', 0.32, 0.4, 0.02, -1.05 + i * 0.42, 0.02, 0.755, 0xd8d8d8]),
        ...block(1.1, 1.0, 0.6, -0.6, -0.35, 'white', 'red'), ...mast(-0.9, 1.025, -0.4, 0.9),
        ['box', 0.34, 1.9, 0.34, 1.05, 0.02, -0.4, 'brick', true], ['box', 0.36, 0.04, 0.36, 1.05, 1.92, -0.4, 'dark'],
        ['box', 2.8, 0.006, 0.86, 0, 0.02, -1.05, ASPHALT], ['box', 0.44, 0.34, 0.4, 0.5, 0.02, -1.1, 'charcoal'], ['box', 0.46, 0.04, 0.42, 0.5, 0.36, -1.1, 'dark'],
        ['box', 0.2, 0.08, 0.1, -0.2, 0.02, -1.1, 'rust'], ['box', 0.12, 0.05, 0.08, -0.2, 0.1, -1.1, 'glassDark'], // a wrecked car for rescue drills
        ...repeat(3, (i): Op => ['cyl', 0.03, 0.03, 0.08, -1.1 + i * 0.12, 0.02, -1.1, 'red', 8]),
        ...engine(-1.05, 1.15), ...engine(-0.21, 1.2), ...engine(0.63, 1.15),
        ...plant(0.2, 0.67, 0.2, 4), ...lampPost(1.35, 1.3, 0.3, 'red'),
      ] },
      { name: 'modern headquarters with a glass control room over a bay hall and a steel tower', height: 2.1, ops: [
        slab(3, 3, 'gravel'),
        ['box', 2.0, 0.55, 1.0, -0.3, 0.02, 0.25, 'charcoal', true], ...repeat(4, (i): Op => ['box', 0.36, 0.4, 0.02, -1.0 + i * 0.47, 0.02, 0.755, 'glass']),
        ['box', 1.6, 0.5, 0.9, -0.3, 0.57, 0.15, 'glass', true], ['box', 1.62, 0.04, 0.92, -0.3, 1.07, 0.15, 'red'], ...mast(-0.8, 1.11, 0.1, 0.8),
        ['box', 0.7, 0.62, 1.0, 1.05, 0.02, 0.25, 'red', true], ['box', 0.72, 0.03, 1.02, 1.05, 0.64, 0.25, 'dark'],
        ...repeat(4, (i): Op => ['cyl', 0.016, 0.016, 2.0, 0.85 + (i % 2) * 0.36, 0.02, -0.95 + Math.floor(i / 2) * 0.36, 'steel', 4]),
        ...repeat(6, (i): Op => ['box', 0.38, 0.02, 0.38, 1.03, 0.3 + i * 0.32, -0.77, 'red']),
        ['box', 1.6, 0.006, 0.8, -0.5, 0.02, -1.05, ASPHALT], ['box', 0.36, 0.3, 0.3, -1.0, 0.02, -1.05, 'brick'], ['box', 0.38, 0.03, 0.32, -1.0, 0.32, -1.05, 'charcoal'],
        ...engine(-1.0, 1.15), ...engine(-0.53, 1.2), ...engine(-0.06, 1.15), ...van(0.6, 1.2, 'red', 'yellow'),
        ...tree(1.3, 1.3, 0.8), ...tree(-1.35, -0.4, 0.85),
      ] },
    ],
  }],
};

// ================================================================= builders

export const handyman: KindDef = {
  id: 'handyman', name: "handyman's workshop", code: Zone.Yard, kindId: 53, family: 'civic',
  flags: { civic: true, workplace: true }, windows: 'none',
  group: 'builders', tier: 1,
  blurb: 'Two builders and a van. Enough to put up the first houses and keep a village going, at a fraction of a yard\'s upkeep.',
  howTo: 'One tile beside a road, anywhere on the network. Builders go wherever there is a site, so a handyman helps any part of town.',
  tool: { id: 'handyman', key: '', label: "Handyman's workshop", color: '#b98352' },
  occupation: yard.occupation,
  lot: { wage: 15 },
  attrs: { workRate: 0.9 },
  levels: [{
    capacity: 2, wage: 15, cost: 120, upkeep: 5, work: 150, parking: { surface: 2, underground: 2 },
    designs: [
      { name: 'timber workshop with a van, a ladder rack and a stack of planks', height: 0.44, ops: [
        slab(1, 1, 'gravel'),
        ['box', 0.5, 0.3, 0.4, -0.16, 0.02, -0.2, 'timber'], ['roof', 0.54, 0.12, 0.44, -0.16, 0.32, -0.2, 'corrugated'],
        ['box', 0.26, 0.22, 0.02, -0.16, 0.02, 0.005, 'door'],
        ...van(0.28, 0.2, 'white', 'boxOrange'), ['box', 0.03, 0.02, 0.24, 0.24, 0.13, 0.2, 'silver'], ['box', 0.03, 0.02, 0.24, 0.32, 0.13, 0.2, 'silver'],
        ...repeat(4, (i): Op => ['box', 0.3, 0.02, 0.05, -0.2, 0.02 + i * 0.02, 0.32, i % 2 ? 'tan' : 'sand']),
        ['box', 0.12, 0.1, 0.12, 0.34, 0.02, -0.34, 'sand'],
      ] },
      { name: 'brick garage with a roller door, a cement mixer and a skip', height: 0.4, ops: [
        slab(1, 1, PAVING),
        ['box', 0.56, 0.32, 0.46, 0.1, 0.02, -0.18, 'brick'], ['box', 0.58, 0.03, 0.48, 0.1, 0.34, -0.18, 'dark'],
        ['box', 0.4, 0.26, 0.02, 0.1, 0.02, 0.055, 'silver'], ...repeat(5, (i): Op => ['box', 0.4, 0.004, 0.022, 0.1, 0.06 + i * 0.04, 0.055, 'grey']),
        ['box', 0.28, 0.1, 0.16, -0.28, 0.02, 0.28, 'yellow'], ['box', 0.24, 0.02, 0.12, -0.28, 0.1, 0.28, 'rust'],
        ['cyl', 0.06, 0.04, 0.12, 0.3, 0.06, 0.3, 'boxOrange', 8], ['box', 0.04, 0.06, 0.04, 0.3, 0.02, 0.3, 'dark'],
        ['cone', 0.08, 0.07, -0.34, 0.02, -0.3, 'sand', 7],
      ] },
    ],
  }],
};

export const buildersDepot: KindDef = {
  id: 'builders-depot', name: "builders' depot", code: Zone.Yard, kindId: 54, family: 'civic',
  flags: { civic: true, workplace: true }, windows: 'none',
  group: 'builders', tier: 3,
  footprint: { w: 2, h: 2, door: [1, 1], marks: [{ kind: 'gate', at: { edge: 'front', from: 1, to: 1 }, label: 'lorry gate' }] },
  blurb: 'A tower crane, flatbed lorries and a covered materials store. Nearly twice a yard\'s crews, each a quarter faster at their work.',
  howTo: 'A 2×2 lot with the lorry gate on the right of the frontage. Needs Steel frame.',
  tool: { id: 'depot', key: '', label: "Builders' depot", color: '#9a6232' },
  occupation: yard.occupation,
  lot: { wage: 17 },
  attrs: { workRate: 1.25 },
  levels: [{
    capacity: 18, wage: 17, cost: 900, upkeep: 30, work: 600, parking: { surface: 8, underground: 14 },
    designs: [
      { name: 'materials shed, aggregate bays, two lorries and a tower crane', height: 1.6, ops: [
        slab(2, 2, 'gravel'),
        ['box', 1.1, 0.44, 0.7, -0.4, 0.02, -0.55, 'corrugated'], ['roof', 1.14, 0.18, 0.74, -0.4, 0.46, -0.55, 'rust'],
        ['box', 0.8, 0.36, 0.02, -0.4, 0.02, -0.195, 'dark'],
        ...repeat(3, (i): Op => ['box', 0.02, 0.16, 0.5, 0.36 + i * 0.26, 0.02, -0.6, 'stone']),
        ['cone', 0.12, 0.14, 0.49, 0.02, -0.6, 'sand', 8], ['cone', 0.12, 0.12, 0.75, 0.02, -0.62, 0x9a9ea6, 8],
        ['box', 0.4, 0.3, 0.26, -0.7, 0.02, 0.5, 'white', 'civic'], ['box', 0.42, 0.03, 0.28, -0.7, 0.32, 0.5, 'boxOrange'],
        ...van(0.2, 0.4, 'boxOrange', 'charcoal'), ...van(0.55, 0.45, 'boxOrange', 'charcoal'),
        ['box', 0.2, 0.06, 0.4, 0.2, 0.12, 0.4, 'timber'],
        ['crane', -0.2, 0, 0.1, 1.55],
      ] },
      { name: 'open yard with pipe stacks, scaffold racks and a mobile crane', height: 1.3, ops: [
        slab(2, 2, ASPHALT),
        ['box', 0.9, 0.36, 0.5, 0.45, 0.02, -0.68, 'boxBlue'], ['box', 0.92, 0.03, 0.52, 0.45, 0.38, -0.68, 'dark'],
        ...repeat(3, (i): Op => ['wheel', 0.05, 0.6, -0.5, 0.07 + i * 0.09, -0.6 + (i % 2) * 0.05, 'grey']),
        ...repeat(3, (i): Op => ['wheel', 0.05, 0.6, -0.5, 0.07, -0.4 + i * 0.1, 'grey']),
        ...repeat(4, (i): Op => ['box', 0.02, 0.5, 0.5, -0.85 + i * 0.12, 0.02, 0.0, 'yellow']), ...repeat(5, (i): Op => ['box', 0.36, 0.02, 0.02, -0.67, 0.08 + i * 0.1, 0.0, 'steel']),
        ['box', 0.5, 0.12, 0.2, 0.4, 0.02, 0.2, 'yellow'], ['box', 0.16, 0.12, 0.16, 0.55, 0.14, 0.2, 'glassDark'],
        ['cyl', 0.03, 0.04, 1.2, 0.3, 0.14, 0.2, 'yellow', 6], ['box', 0.03, 0.03, 0.4, 0.3, 1.3, 0.0, 'yellow'],
        ...van(0.65, 0.65, 'white', 'boxOrange'), ...fence(0, 0.96, 1.2, true, 'grey', 0.1),
        ['box', 0.36, 0.26, 0.24, -0.7, 0.02, 0.62, 'white', 'civic'],
      ] },
    ],
  }],
};

export const constructionCompany: KindDef = {
  id: 'construction-company', name: 'construction company', code: Zone.Yard, kindId: 55, family: 'civic',
  flags: { civic: true, workplace: true }, windows: 'office',
  group: 'builders', tier: 4,
  footprint: { w: 3, h: 2, door: [0, 1], marks: [{ kind: 'gate', at: { edge: 'front', from: 1, to: 2 }, label: 'mixer trucks' }] },
  blurb: 'Head office, a concrete batching plant and a fleet of mixer trucks. Three times a yard\'s crews, each working sixty per cent faster: towers go up in days.',
  howTo: 'Three tiles across and two deep, offices on the left of the frontage, trucks out of the right. Late game: needs Industrialised building.',
  tool: { id: 'buildco', key: '', label: 'Construction company', color: '#8a5326' },
  occupation: { ...yard.occupation!, name: 'builder' },
  lot: { wage: 18 },
  attrs: { workRate: 1.6 },
  levels: [{
    capacity: 30, wage: 18, cost: 2200, upkeep: 55, work: 900, parking: { surface: 12, underground: 20 },
    designs: [
      { name: 'office block, batching plant silos with a conveyor, mixer trucks and a crane', height: 1.9, ops: [
        slab(3, 2, 'gravel'),
        ...block(0.8, 0.7, 0.7, -1.05, 0.5, 'white', 'boxOrange'),
        ...repeat(3, (i): Op => ['cyl', 0.13, 0.13, 0.9, 0.2 + i * 0.32, 0.3, -0.62, 'silver', 12]),
        ...repeat(3, (i): Op => ['cone', 0.13, 0.12, 0.2 + i * 0.32, 0.18, -0.62, 'silver', 12]),
        ...repeat(6, (i): Op => ['cyl', 0.012, 0.012, 0.3, 0.08 + (i % 3) * 0.32, 0.02, -0.62 + (i < 3 ? -0.1 : 0.1), 'steel', 4]),
        ['box', 0.9, 0.24, 0.3, 0.52, 0.02, -0.3, 'boxOrange'], ['box', 0.08, 0.06, 0.9, 1.1, 0.5, -0.4, 'steel'], ['box', 0.06, 0.5, 0.06, 1.1, 0.02, 0.0, 'steel'],
        ...[0.25, 0.75, 1.2].flatMap((x): Op[] => [['box', 0.14, 0.08, 0.32, x, 0.02, 0.55, 'white'], ['cyl', 0.06, 0.05, 0.16, x, 0.1, 0.5, 'boxOrange', 8], ['box', 0.13, 0.06, 0.08, x, 0.1, 0.68, 'glassDark']]),
        ['box', 0.5, 0.3, 0.4, -0.6, 0.02, -0.6, 'corrugated'], ['crane', -0.95, 0, -0.55, 1.85],
      ] },
      { name: 'precast panel works with a gantry crane, stacked panels and silos', height: 1.36, ops: [
        slab(3, 2, ASPHALT),
        ['box', 1.6, 0.6, 0.8, 0.5, 0.02, -0.5, 'corrugated'], ['roof', 1.64, 0.2, 0.84, 0.5, 0.62, -0.5, 'roofGrey'],
        ...block(0.9, 0.56, 0.6, -0.95, 0.55, 'cream', 'boxBlue'),
        ...repeat(2, (i): Op => ['box', 0.06, 0.7, 0.06, -0.55 + i * 1.0, 0.02, 0.35, 'yellow']), ['box', 1.1, 0.07, 0.08, -0.05, 0.72, 0.35, 'yellow'],
        ...repeat(4, (i): Op => ['box', 0.3, 0.3, 0.03, 0.0 + i * 0.32, 0.02, 0.3, 'stone']), ...repeat(3, (i): Op => ['box', 0.3, 0.03, 0.3, 0.1 + i * 0.36, 0.02 + 0.03 * i, 0.7, 'stone']),
        ['cyl', 0.12, 0.12, 1.0, -1.1, 0.3, -0.6, 'silver', 12], ['cyl', 0.12, 0.12, 1.0, -0.8, 0.3, -0.6, 'silver', 12], ['cone', 0.12, 0.12, -1.1, 0.18, -0.6, 'silver', 12], ['cone', 0.12, 0.12, -0.8, 0.18, -0.6, 'silver', 12],
        ...repeat(4, (i): Op => ['cyl', 0.012, 0.012, 0.28, -1.15 + i * 0.12, 0.02, -0.6, 'steel', 4]),
        ...van(1.2, 0.6, 'boxBlue', 'white'), ['box', 0.24, 0.02, 0.5, 1.2, 0.12, 0.25, 'stone'],
      ] },
    ],
  }],
};

export const CIVIC_TIERS: KindDef[] = [
  gpSurgery, healthCentre, walkInCentre, communityHospital, generalHospital, teachingHospital,
  policeBox, policePost, divisionalStation, policeHq,
  firePost, largeFireStation, fireHq,
  handyman, buildersDepot, constructionCompany,
];
