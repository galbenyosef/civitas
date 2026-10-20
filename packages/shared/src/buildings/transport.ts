import type { KindDef, Op, Win } from './schema';
import { Zone } from './codes';

/** The surface lot: kerbs, bay lines, a booth and a sign; `y` lifts the booth onto the paving and `win` is its windows (the original sits in the paving with a shop's, low enough that the kerb meets them). */
export const lotOps = (y = 0, win: Win = true): Op[] => [
  ['box', 0.96, 0.02, 0.96, 0, 0, 0, 0x3a3d44], ['box', 0.96, 0.03, 0.04, 0, 0, -0.46, 'grey'], ['box', 0.04, 0.03, 0.96, -0.46, 0, 0, 'grey'], ['box', 0.04, 0.03, 0.96, 0.46, 0, 0, 'grey'],
  ...[0, 1, 2, 3, 4, 5, 6].flatMap((i): Op[] => { const x = -0.42 + i * 0.14; return [['box', 0.015, 0.005, 0.3, x, 0.02, -0.27, 'white'], ['box', 0.015, 0.005, 0.3, x, 0.02, 0.27, 'white']]; }),
  ['box', 0.14, 0.18, 0.12, 0.36, y, 0.4, 'white', win], ['box', 0.16, 0.02, 0.14, 0.36, 0.18 + y, 0.4, 'dark'],
  ['cyl', 0.012, 0.012, 0.3, -0.4, 0, 0.42, 'steel', 5], ['box', 0.12, 0.08, 0.02, -0.34, 0.26, 0.42, 'signBlue'], ['box', 0.04, 0.04, 0.01, -0.34, 0.28, 0.432, 'white'],
];

/** A surface lot: painted and paved at once (no construction), a dozen bays, a fee per stay. */
export const parking: KindDef = {
  id: 'parking', name: 'parking lot', code: Zone.Parking, family: 'transport',
  flags: { parking: true },
  windows: 'shop',
  tool: { id: 'park', key: 'P', label: 'Parking lot', color: '#5c6270' },
  group: 'parking', tier: 2, // the parking ladder (parking.ts): kerbside bays, this lot, multi-storey, park and ride
  blurb: 'A surface lot with a dozen bays, painted and paved at once. Drivers who find no space at their destination park here, walk on and pay you a fee.',
  howTo: 'One tile beside a road near shops and offices that fill up. No builders needed.',
  lot: { parking: { surface: 12, underground: 12 } },
  levels: [{
    capacity: 0, cost: 150, upkeep: 2, work: 0, parking: { surface: 12, underground: 12 },
    designs: [{ name: 'kerb, bay lines, a booth and a sign (the cars come from live occupancy)', height: 0.3, ops: lotOps() }],
  }],
};

/**
 * A bus depot (Public transport tier): the first sub-kind (docs/sub-kinds.md). It shares family code 15 (transport
 * hubs) with the airport terminal and is told apart by its kind id 16 in the tile's sub byte. A 3×2 civic structure
 * with the door on the middle of the front row; the recipe is authored in tiles for the footprint (x -1.5..1.5,
 * z -1..1, +z the road). Its staff drive the buses of its owner's lines (one bus out per driver on shift, server
 * sim/transit.ts) and about a fifth are mechanics; shifts cover the 05:30-00:30 service.
 */
const DEPOT_ASPHALT = 0x3a3d44;
const bus = (x: number): Op[] => [
  ['box', 0.24, 0.2, 0.8, x, 0.06, 0.45, 'yellow'],                 // body, nose to the road
  ['box', 0.25, 0.06, 0.78, x, 0.17, 0.45, 'glassDark'],            // window band
  ['box', 0.24, 0.02, 0.8, x, 0.26, 0.45, 'white'],                 // roof
  ['wheel', 0.055, 0.26, x, 0.055, 0.2, 'charcoal'], ['wheel', 0.055, 0.26, x, 0.055, 0.7, 'charcoal'],
];
export const busDepot: KindDef = {
  id: 'bus-depot', name: 'bus depot', code: Zone.Hub, kindId: 16, family: 'transport',
  flags: { civic: true, workplace: true },
  windows: 'civic',
  footprint: { w: 3, h: 2, door: [1, 1], marks: [{ kind: 'gate', at: { edge: 'front', from: 1, to: 2 }, label: 'vehicle gate' }] },
  tool: { id: 'busdepot', key: 'K', label: 'Bus depot (3×2)', color: '#e0a92e' },
  blurb: 'Where the buses live. Its staff are mostly drivers (the rest are mechanics), and every driver on shift takes a bus out onto a line between 05:30 and 00:30.',
  howTo: 'Three tiles across and two deep, the door facing a road (Z and C turn it). Put it near the lines it serves: buses drive from the depot to their first stop. Make lines in the lines panel; needs Public transport.',
  occupation: {
    name: 'bus driver', rotate: true,
    // an early shift takes the buses out at 05:30, a day and a late shift overlap it, an evening one brings them in after 00:30
    shifts: [{ start: 5, hours: 8, weight: 0.35 }, { start: 9, hours: 8, weight: 0.15 }, { start: 13, hours: 8, weight: 0.25 }, { start: 17, hours: 8, weight: 0.25 }],
    cycles: [[1, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 1, 1, 0], [1, 1, 0, 0, 1, 1, 1]],
  },
  lot: { wage: 19 },
  attrs: { gateway: 'bus', gatewayModes: ['foot', 'taxi'], arrivalsPerHour: 10 }, // intercity coaches pull in here (server sim/gateways.ts)
  levels: [{
    capacity: 30, wage: 19, cost: 1200, upkeep: 30, work: 300, parking: { surface: 6, underground: 12 },
    designs: [{ name: 'three-bay bus shed with an office and buses on the forecourt', height: 0.76, ops: [
      ['box', 2.96, 0.02, 1.96, 0, 0, 0, DEPOT_ASPHALT],                 // yard slab
      ['box', 2.7, 0.55, 0.8, 0, 0.02, -0.55, 'cream', true],            // the shed across the back row
      ['roof', 2.76, 0.18, 0.86, 0, 0.57, -0.55, 'roofGrey'],
      ...[-0.9, 0, 0.9].map((x): Op => ['box', 0.6, 0.38, 0.02, x, 0.02, -0.14, 'charcoal']), // bay doors facing the yard
      ['box', 2.72, 0.05, 0.82, 0, 0.42, -0.55, 'yellow'],               // livery band
      ['box', 0.6, 0.42, 0.5, -1.1, 0.02, 0.6, 'white', true],           // office by the gate
      ['box', 0.62, 0.05, 0.52, -1.1, 0.44, 0.6, 'navy'],
      ...bus(0.05), ...bus(0.5),
      ['box', 0.12, 0.16, 0.1, 1.2, 0.02, 0.25, 'red'],                 // fuel pump
      ['cyl', 0.012, 0.012, 0.35, 1.35, 0.02, 0.85, 'steel', 5],         // depot sign
      ['box', 0.22, 0.12, 0.02, 1.35, 0.3, 0.86, 'signBlue'],
      ...[0.9, 1.05].map((x): Op => ['box', 0.015, 0.005, 0.7, x, 0.02, 0.5, 'white']), // bay lines
    ] }],
  }],
};

/**
 * A bus stop: a 1×1 shelter on a tile beside a plain stretch of road (not a junction), facing it. Put up at once like
 * a parking lot (no builders); buses of the lines that list it pull in on the road tile in front. Stops have no
 * staff; the shelter, bench, timetable post and flag sign are scenery, the waiting crowd is drawn from live riders.
 */
export const busStop: KindDef = {
  id: 'bus-stop', name: 'bus stop', code: Zone.Hub, kindId: 17, family: 'transport',
  flags: {},
  windows: 'none',
  tool: { id: 'busstop', key: '', label: 'Bus stop', color: '#f0c419' },
  blurb: 'A shelter where riders wait. A citizen whose car is at home weighs a bus ride against walking and driving when a stop of one line is within 5 tiles of both ends of the trip.',
  howTo: 'Place it on your land beside a plain stretch of road, not facing a junction: the bus pulls in on that road tile. One a block along a line covers a street; then add it to a line in the lines panel.',
  levels: [{
    capacity: 0, cost: 120, upkeep: 1, work: 0, parking: { surface: 0, underground: 0 },
    designs: [{ name: 'glass shelter with a bench, a timetable post and a flag sign at the kerb', height: 0.5, ops: [
      ['box', 0.96, 0.015, 0.96, 0, 0, 0, 'gravel'],                       // paving
      ['box', 0.96, 0.02, 0.34, 0, 0, 0.31, 'stone'],                      // the kerb-side pad people stand on
      ['box', 0.62, 0.3, 0.02, -0.06, 0.02, -0.02, 'glass'],              // back pane
      ['box', 0.02, 0.3, 0.22, -0.37, 0.02, 0.08, 'glass'], ['box', 0.02, 0.3, 0.22, 0.25, 0.02, 0.08, 'glass'], // side panes
      ...[-0.37, 0.25].flatMap((x): Op[] => [['cyl', 0.012, 0.012, 0.32, x, 0.02, -0.02, 'steel', 5], ['cyl', 0.012, 0.012, 0.32, x, 0.02, 0.19, 'steel', 5]]),
      ['box', 0.7, 0.025, 0.3, -0.06, 0.34, 0.08, 'charcoal'],            // roof
      ['box', 0.7, 0.04, 0.02, -0.06, 0.3, 0.23, 'yellow'],               // fascia
      ['box', 0.46, 0.035, 0.1, -0.06, 0.1, 0.04, 'timber'], ['box', 0.04, 0.1, 0.08, -0.25, 0.02, 0.04, 'charcoal'], ['box', 0.04, 0.1, 0.08, 0.13, 0.02, 0.04, 'charcoal'], // bench
      ['box', 0.1, 0.16, 0.025, 0.36, 0.1, -0.02, 'white'],               // timetable panel
      ['cyl', 0.014, 0.014, 0.46, 0.36, 0.02, 0.4, 'steel', 6],           // flag post at the kerb
      ['box', 0.12, 0.12, 0.02, 0.36, 0.36, 0.41, 'yellow'], ['box', 0.07, 0.035, 0.022, 0.36, 0.41, 0.41, 'charcoal'],
      ['box', 0.1, 0.1, 0.1, -0.42, 0.02, 0.38, 'hedge'],                 // a planter
      ['adslot', 4, 'right', 0, 0, 'panel'],                               // the advertising panel in the end pane (docs/adverts.md)
    ] }],
  }],
};
