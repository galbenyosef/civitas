import type { KindDef } from './schema';
import { Zone } from './codes';

/** Staffed civic buildings: placed by a player, built by builders, paid for daily. One level each. */
export const police: KindDef = {
  id: 'police', name: 'police station', code: Zone.Police, family: 'civic',
  flags: { civic: true, service: true, workplace: true },
  windows: 'civic',
  tool: { id: 'police', key: '8', label: 'Police station', color: '#3454a8' },
  group: 'police', tier: 3,
  blurb: 'The town police station: a dozen officers on rotating shifts, a front counter and patrol cars. A full police service for the homes around it.',
  howTo: 'One tile beside a road. Smaller posts and boxes fill gaps; a divisional station or headquarters covers more.',
  occupation: {
    name: 'police officer', rotate: true,
    shifts: [{ start: 7, hours: 8, weight: 1 }, { start: 15, hours: 8, weight: 1 }, { start: 23, hours: 8, weight: 1 }],
    cycles: [[1, 1, 1, 1, 0, 0, 1], [1, 1, 1, 1, 1, 0, 0]],
  },
  lot: { wage: 20 },
  levels: [{
    capacity: 12, wage: 20, cost: 400, upkeep: 20, work: 300, parking: { surface: 4, underground: 10 },
    designs: [{ name: 'station with a navy band and radio mast', height: 0.63, ops: [
      ['box', 0.84, 0.6, 0.76, 0, 0, 0, 0xe1e5ec, true],
      ['box', 0.86, 0.1, 0.78, 0, 0.44, 0, 'navy'],
      ['box', 0.3, 0.12, 0.03, 0, 0.2, 0.39, 'navy'],
      ['box', 0.86, 0.03, 0.78, 0, 0.6, 0, 'dark'],
      ['cyl', 0.015, 0.015, 0.5, 0.36, 0.6, -0.32, 0xdddddd, 5],
    ] }],
  }],
};

export const fire: KindDef = {
  id: 'fire', name: 'fire station', code: Zone.Fire, family: 'civic',
  flags: { civic: true, service: true, workplace: true },
  windows: 'civic',
  tool: { id: 'fire', key: '9', label: 'Fire station', color: '#d6453a' },
  group: 'fire', tier: 2,
  blurb: 'Two appliance bays, a drill tower and a watch on 24-hour shifts. A full fire service for the homes around it.',
  howTo: 'One tile beside a road. Fire posts fill gaps cheaply; a large station covers more.',
  occupation: {
    name: 'firefighter', rotate: true,
    shifts: [{ start: 8, hours: 24, weight: 1 }],
    cycles: [[1, 0, 0]],
  },
  lot: { wage: 20 },
  levels: [{
    capacity: 9, wage: 20, cost: 400, upkeep: 20, work: 300, parking: { surface: 3, underground: 6 },
    designs: [{ name: 'red station with two bay doors and a drill tower', height: 1.0, ops: [
      ['box', 0.86, 0.6, 0.82, 0, 0, 0, 'red', true],
      ['box', 0.26, 0.34, 0.03, -0.2, 0, 0.42, 0xd8d8d8], ['box', 0.26, 0.34, 0.03, 0.14, 0, 0.42, 0xd8d8d8],
      ['box', 0.22, 1.0, 0.22, 0.3, 0, -0.28, 'red', true],
      ['box', 0.86, 0.03, 0.82, 0, 0.6, 0, 'dark'],
    ] }],
  }],
};

export const hospital: KindDef = {
  id: 'hospital', name: 'hospital', code: Zone.Hospital, family: 'civic',
  flags: { civic: true, service: true, workplace: true },
  windows: 'civic',
  tool: { id: 'hospital', key: '0', label: 'Hospital', color: '#f4f4f4' },
  group: 'health', tier: 4,
  blurb: 'A compact city hospital stacked on one plot: wards, a casualty door and a helipad, with ambulances out. A full health service for the homes around it.',
  howTo: 'One tile beside a road. Space-efficient but cramped; the community and general hospitals reach further.',
  occupation: {
    name: 'hospital staff', rotate: true,
    shifts: [{ start: 7, hours: 12, weight: 1 }, { start: 19, hours: 12, weight: 0.8 }],
    cycles: [[1, 1, 1, 0, 0, 0, 0], [1, 1, 0, 0, 1, 1, 0]],
  },
  lot: { wage: 26 },
  levels: [{
    capacity: 24, wage: 26, cost: 900, upkeep: 50, work: 300, parking: { surface: 6, underground: 20 },
    designs: [{ name: 'white block with a roof cross and helipad', height: 1.15, ops: [
      ['box', 0.88, 1.1, 0.56, 0, 0, -0.14, 'white', true],
      ['box', 0.46, 0.6, 0.34, -0.2, 0, 0.26, 'white', true],
      ['box', 0.3, 0.05, 0.08, 0, 1.1, -0.14, 'crossRed'], ['box', 0.08, 0.05, 0.3, 0, 1.1, -0.14, 'crossRed'],
      ['cyl', 0.14, 0.14, 0.02, 0.27, 1.1, -0.14, 0x4a4f58, 12],
      ['box', 0.3, 0.03, 0.14, -0.2, 0.28, 0.45, 'crossRed'],
    ] }],
  }],
};

/** The builders' yard is civic (placed, staffed, upkeep) but covers no homes. */
export const yard: KindDef = {
  id: 'yard', name: "builders' yard", code: Zone.Yard, family: 'civic',
  flags: { civic: true, workplace: true },
  windows: 'none',
  tool: { id: 'yard', key: 'Y', label: "Builders' yard", color: '#a8713f' },
  group: 'builders', tier: 2,
  blurb: 'Ten builders, a shed and a tower crane. Builders go to the most urgent site anywhere on the road network and earn the yard\'s owner a fee.',
  howTo: 'One tile beside a road. Nothing gets built without builders; place one early.',
  occupation: {
    name: 'builder', rotate: true,
    shifts: [{ start: 7, hours: 8, weight: 0.6 }, { start: 8, hours: 8, weight: 0.4 }],
    cycles: [[1, 1, 1, 1, 1, 1, 0], [1, 1, 1, 1, 1, 0, 0]],
  },
  lot: { wage: 16 },
  levels: [{
    capacity: 10, wage: 16, cost: 300, upkeep: 15, work: 300, parking: { surface: 6, underground: 10 },
    designs: [{ name: 'shed, material heaps and a tower crane', height: 1.0, ops: [
      ['box', 0.4, 0.28, 0.3, -0.22, 0, -0.22, 'brown'], ['roof', 0.44, 0.1, 0.34, -0.22, 0.28, -0.22, 0x6d4524],
      ['box', 0.14, 0.14, 0.14, 0.2, 0, -0.25, 'sand'], ['box', 0.14, 0.1, 0.14, 0.2, 0, -0.08, 0x9a9ea6], ['box', 0.12, 0.12, 0.12, 0.34, 0, -0.2, 'brick'],
      ['cone', 0.12, 0.1, -0.25, 0, 0.25, 'sand', 7],
      ['crane', 0.22, 0, 0.2, 1.0],
    ] }],
  }],
};
