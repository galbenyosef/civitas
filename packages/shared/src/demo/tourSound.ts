import type { DemoId } from './showcase';

/**
 * Tour sound (docs/audio.md "Tour cues"): what a tour stop sounds like. A stop may carry a `sound`: some cues (one-shot sounds,
 * or a loop, named by manifest voice and played shortly after the camera arrives), a bias for the ambient beds while the stop is
 * shown, and how far the beds duck under a cue. `'ambience'` says the stop is left to the beds alone, on purpose.
 *
 * This file is the one table to edit: SCENES are the reusable sounds of a kind of place (the river, a rail terminus, a school),
 * LONDON_SOUND names the scene of every London stop by its id (with a touch of its own where the place has one), and
 * SHOWCASE_SOUND gives a few of the showcase's stops theirs. Pure data: the client (client/src/tour.ts, audio/tourcue.ts) plays
 * it, audio-check reads that every voice named exists, and demo:check that every London stop has an entry. Client only: nothing
 * here touches the simulation.
 */

/** the beds a stop may bias (the ambience mix's own: audio/ambience.ts) */
export type TourBed = 'traffic' | 'wind' | 'crowd' | 'industry' | 'water' | 'market' | 'pub' | 'playground' | 'stadium' | 'fountain' | 'zone-ind' | 'zone-com' | 'zone-off' | 'zone-res' | 'zone-civic';
/**
 * Each named bed is held at this share (0 to 1) of its own ceiling while the stop is shown, whatever the tiles round the camera
 * would say; a bed not named follows the scene as usual. 0 silences it (underground), 1 is as loud as that bed ever gets.
 */
export type AmbienceHint = Partial<Record<TourBed, number>>;

export interface TourCue {
  /** a manifest voice (client/src/audio/manifest.ts) with a recording */
  voice: string;
  /** seconds after the camera arrives; default 0.3 to 1.2, chosen per play. Every play also moves it a little (the organic rule) */
  at?: number;
  /** a multiplier on the voice's own level (default 1) */
  gain?: number;
  /** play the recording as a loop until the stop is left (a bed-class recording, cut to loop); default one-shot */
  loop?: boolean;
}
export interface TourSoundDef {
  cues: TourCue[];
  ambience?: AmbienceHint;
  /** how far the ambience bus dips while a cue sounds, dB (default 4) */
  duck?: number;
}
export type TourSound = TourSoundDef | 'ambience';

const c = (voice: string, at?: number, gain?: number): TourCue => ({ voice, ...(at !== undefined ? { at } : {}), ...(gain !== undefined ? { gain } : {}) });
const loop = (voice: string, gain?: number): TourCue => ({ voice, at: 0.2, loop: true, ...(gain !== undefined ? { gain } : {}) });
const s = (cues: TourCue[], ambience?: AmbienceHint, duck?: number): TourSoundDef => ({ cues, ...(ambience ? { ambience } : {}), ...(duck !== undefined ? { duck } : {}) });

/** The reusable sounds of a kind of place. A stop names one; LONDON_SOUND may add or replace parts. */
export const SCENES = {
  // ---- the river
  river: s([c('seagulls', 0.4, 0.9), c('boat-pass', 1.3, 0.8)], { water: 0.9, traffic: 0.15, crowd: 0.2, wind: 0.3 }),
  pier: s([c('seagulls', 0.5, 0.8), c('boat-horn', 1.8, 0.7), c('boat-pass', 3, 0.6)], { water: 0.9, traffic: 0.2, crowd: 0.25, wind: 0.2 }),
  ferry: s([c('boat-pass', 0.4, 0.9), c('seagulls', 1.6, 0.8)], { water: 1, traffic: 0.1, wind: 0.35 }),
  marina: s([c('rigging', 0.4, 1), c('seagulls', 1.5, 0.7), c('ducks', 3, 0.5)], { water: 0.8, crowd: 0.3, traffic: 0.1 }),
  pool: s([c('boat-horn', 0.6, 0.8), c('boat-pass', 1.2, 0.8), c('seagulls', 2.6, 0.8)], { water: 1, crowd: 0.3, traffic: 0.2, wind: 0.3 }),
  'fish-quay': s([c('seagulls', 0.4, 1), c('rigging', 1.4, 0.8), c('boat-pass', 2.6, 0.6)], { water: 0.8, wind: 0.3, traffic: 0.05 }),
  docks: s([c('port', 0.5, 0.9), c('boat-horn', 2, 0.9), c('seagulls', 1, 0.8), c('port', 5, 0.7)], { water: 0.6, industry: 0.45, traffic: 0.2, wind: 0.3 }),
  'tower-bridge': s([c('bridge-bell', 0.4, 0.9), c('boat-horn', 2.2, 0.8), c('seagulls', 1.2, 0.8), c('boat-pass', 3.2, 0.6)], { water: 0.8, traffic: 0.5, crowd: 0.4 }),
  // ---- Westminster and the royal city
  parliament: s([c('big-ben', 0.3, 1.1), c('pigeons', 3, 0.7), c('horn', 4, 0.5)], { traffic: 0.5, crowd: 0.4, water: 0.25 }, 5),
  'bank-wheel': s([c('big-ben', 0.8, 0.45), c('seagulls', 1.6, 0.8), c('boat-pass', 3, 0.6)], { crowd: 0.7, water: 0.6, traffic: 0.3 }),
  palace: s([c('bird', 0.4, 0.9), c('pigeons', 1.2, 0.7), c('horn', 2.6, 0.5)], { crowd: 0.4, traffic: 0.3, wind: 0.15 }),
  police: s([c('siren', 0.9, 0.7), c('horn', 2.6, 0.5)], { traffic: 0.5, crowd: 0.3 }),
  hospital: s([c('siren-ambulance', 0.7, 0.7), c('bird', 3, 0.5)], { traffic: 0.35, crowd: 0.25 }),
  fire: s([c('siren-fire', 0.6, 0.8), c('horn', 3, 0.5)], { traffic: 0.35, crowd: 0.2 }),
  // ---- the West End, the streets and the roads
  'west-end': s([c('horn', 0.5, 0.7), c('bike-bell', 1.8, 0.6), c('shop-bell', 2.8, 0.5)], { crowd: 0.8, traffic: 0.6, market: 0.15 }),
  'west-end-night': s([c('horn', 0.5, 0.8), c('siren', 2.2, 0.35), c('bike-bell', 3.2, 0.5)], { crowd: 1, pub: 0.55, traffic: 0.6 }),
  pedestrian: s([c('shop-bell', 0.4, 0.8), c('footsteps', 1, 0.8), c('bike-bell', 3, 0.5)], { crowd: 0.9, market: 0.4, traffic: 0.08 }),
  'bus-street': s([c('bus-pass', 0.4, 1), c('fx-hiss', 1.6, 0.8), c('fx-stopbell', 2.4, 0.8), c('horn', 3.4, 0.5)], { traffic: 0.8, crowd: 0.7 }),
  junction: s([c('horn', 0.4, 0.8), c('bus-pass', 1.2, 0.9), c('horn', 2.8, 0.6)], { traffic: 1, crowd: 0.35 }),
  motorway: s([c('horn', 0.5, 0.6), c('bus-pass', 1.1, 1.1)], { traffic: 1, wind: 0.35, crowd: 0 }),
  'traffic-panel': s([c('horn', 0.4, 0.8), c('horn', 1.7, 0.6), c('siren', 3.2, 0.4)], { traffic: 1, crowd: 0.5 }),
  zone20: s([c('bike-bell', 0.6, 0.7), c('bird', 1.4, 0.7), c('footsteps', 2.4, 0.6)], { traffic: 0.12, crowd: 0.3, playground: 0.3 }),
  yellow: s([c('horn', 0.4, 0.8), c('bike-bell', 1.6, 0.6), c('bell', 2.8, 0.4)], { traffic: 0.6, crowd: 0.5, industry: 0.1 }),
  // ---- buildings of the arts, learning and shopping
  theatre: s([c('applause', 0.7, 0.9), c('horn', 2.4, 0.4)], { crowd: 0.7, traffic: 0.25 }),
  concert: s([c('orchestra', 0.4, 1), c('applause', 6, 0.7)], { crowd: 0.45, traffic: 0.2 }),
  university: s([c('bike-bell', 0.5, 0.7), c('footsteps', 1.2, 0.7), c('bird', 2.4, 0.6)], { crowd: 0.5, traffic: 0.3 }),
  multiplex: s([c('horn', 0.5, 0.6), c('shop-bell', 1.6, 0.5), c('bike-bell', 2.8, 0.5)], { crowd: 1, traffic: 0.4, pub: 0.2 }),
  museum: s([c('footsteps', 0.5, 0.9), c('pigeons', 1.8, 0.7), c('bike-bell', 3.2, 0.5)], { crowd: 0.5, traffic: 0.3 }),
  'museum-kids': s([c('footsteps', 0.5, 0.9), c('school-bell', 1.8, 0.5), c('pigeons', 3, 0.6)], { crowd: 0.5, playground: 0.45, traffic: 0.3 }),
  'museum-river': s([c('seagulls', 0.5, 0.9), c('bell', 1.8, 0.4), c('boat-pass', 3, 0.5)], { crowd: 0.4, water: 0.5, traffic: 0.2 }),
  library: s([c('footsteps', 0.5, 0.8), c('pigeons', 1.8, 0.6), c('bike-bell', 3, 0.5)], { crowd: 0.35, traffic: 0.3 }),
  research: s([c('bird', 0.5, 0.7), c('bike-bell', 1.8, 0.5)], { traffic: 0.35, industry: 0.1, crowd: 0.25 }),
  broadcaster: s([c('heli-over', 0.5, 0.9), c('horn', 3.4, 0.4)], { traffic: 0.5, crowd: 0.3 }),
  skyscraper: s([c('gust', 0.4, 0.9), c('heli-over', 1.6, 0.5)], { wind: 0.65, traffic: 0.3, crowd: 0.35 }),
  'skyscraper-city': s([c('gust', 0.4, 0.8), c('bell', 1.8, 0.4)], { wind: 0.5, traffic: 0.35, crowd: 0.4, industry: 0.1 }),
  'skyscraper-docklands': s([c('gust', 0.4, 0.9), c('plane-over', 1.8, 0.5), c('seagulls', 3, 0.5)], { wind: 0.6, traffic: 0.25, crowd: 0.35, water: 0.25 }),
  fortress: s([c('crows', 0.4, 1), c('bell', 1.6, 0.6), c('seagulls', 3, 0.5), c('boat-pass', 4, 0.5)], { water: 0.4, crowd: 0.4, traffic: 0.3 }),
  // ---- homes, schools and the neighbourhood
  quiet: s([c('bird', 0.5, 0.9), c('dog', 1.8, 0.6), c('bike-bell', 3.2, 0.5)], { traffic: 0.3, crowd: 0.2 }),
  suburb: s([c('bird', 0.5, 0.9), c('lawnmower', 1.4, 0.5), c('dog', 3, 0.5)], { traffic: 0.25, crowd: 0.15 }),
  'market-quarter': s([c('horn', 0.5, 0.6), c('bike-bell', 1.8, 0.6), c('shop-bell', 2.8, 0.5)], { market: 0.85, crowd: 0.6, traffic: 0.35, pub: 0.2 }),
  'river-quarter': s([c('seagulls', 0.4, 0.9), c('boat-horn', 1.8, 0.6), c('bike-bell', 3.2, 0.4)], { water: 0.5, traffic: 0.25, crowd: 0.25 }),
  'city-streets': s([c('bell', 0.5, 0.6), c('pigeons', 1.6, 0.6), c('horn', 2.8, 0.5)], { crowd: 0.6, traffic: 0.5, industry: 0.12 }),
  primary: s([c('school-bell', 0.5, 0.9), c('bird', 2, 0.6)], { playground: 0.9, crowd: 0.2, traffic: 0.15 }),
  secondary: s([c('school-bell', 0.5, 0.9), c('bike-bell', 1.8, 0.5), c('footsteps', 2.6, 0.6)], { playground: 0.6, crowd: 0.35, traffic: 0.2 }),
  // ---- parks and the dead
  park: s([c('bird', 0.4, 1), c('ducks', 1.4, 0.6), c('pigeons', 2.8, 0.6)], { wind: 0.3, traffic: 0.12, crowd: 0.2 }),
  'park-corner': s([c('bird', 0.4, 0.9), c('pigeons', 1.4, 0.6), c('horn', 2.6, 0.5)], { wind: 0.25, traffic: 0.4, crowd: 0.25 }),
  'park-lake': s([c('ducks', 0.4, 1), c('bird', 1.4, 0.9), c('seagulls', 3, 0.4)], { wind: 0.3, water: 0.35, traffic: 0.05, crowd: 0.25 }),
  garden: s([c('parakeets', 0.4, 1), c('bird', 1.4, 0.9), c('plane-over', 3.4, 0.35)], { wind: 0.25, traffic: 0.05, crowd: 0.15 }),
  cemetery: s([c('crows', 0.5, 0.9), c('bird', 1.6, 0.8), c('bell', 3, 0.3)], { wind: 0.45, traffic: 0.05, crowd: 0.05 }),
  'cemetery-dusk': s([c('crows', 0.5, 0.8), c('owl', 2.4, 0.6), c('fox', 4.4, 0.6), c('bell', 6, 0.3)], { wind: 0.45, traffic: 0.05, crowd: 0.05 }),
  // ---- stadiums and sport
  stadium: s([c('whistle', 0.4, 0.9), c('crowd-roar', 1.5, 1), c('crowd-roar', 6.5, 0.6)], { stadium: 1, crowd: 0.5, traffic: 0.2 }, 6),
  'sports-hall': s([c('whistle', 0.4, 0.7), c('applause', 1.4, 0.8)], { crowd: 0.45, stadium: 0.25, traffic: 0.2 }),
  cricket: s([c('applause', 0.6, 0.8), c('pigeons', 2.2, 0.6), c('bird', 3.4, 0.6)], { crowd: 0.35, traffic: 0.25, wind: 0.15 }),
  arena: s([c('crowd-roar', 0.5, 0.6), c('seagulls', 2.2, 0.5), c('applause', 3.4, 0.5)], { crowd: 0.8, stadium: 0.4, water: 0.25, traffic: 0.2 }),
  // ---- industry and power
  coal: s([c('port', 1.4, 0.5), c('seagulls', 2.4, 0.6), c('gust', 3.4, 0.5)], { industry: 0.95, water: 0.3, traffic: 0.3 }),
  gas: s([loop('flare-roar', 0.9), c('port', 1.6, 0.5)], { industry: 0.8, traffic: 0.15 }),
  grid: s([c('seagulls', 0.8, 0.6), c('gust', 2, 0.5)], { industry: 0.7, water: 0.5, wind: 0.35 }),
  solar: s([c('bird', 0.5, 0.9), c('bird', 1.8, 0.8), c('gust', 3, 0.6)], { wind: 0.5, traffic: 0.05, crowd: 0 }),
  works: s([c('hammer', 0.5, 0.9), c('drill', 1.3, 0.8), c('hammer', 3, 0.7)], { industry: 0.3, traffic: 0.4 }),
  'freight-yard': s([c('port', 0.6, 0.8), c('fx-joint', 1.4, 0.8), c('train-pass', 2.4, 0.7)], { industry: 0.55, wind: 0.3, traffic: 0.2 }),
  // ---- rail, the buses and the Underground
  terminus: s([loop('station-hall', 0.9), c('station-chime', 0.8, 1), c('train-pass', 2.2, 0.8), c('fx-hiss', 4, 0.6)], { crowd: 0.7, traffic: 0.15 }),
  'rail-station': s([c('station-chime', 0.7, 0.9), c('train-pass', 1.8, 0.9), c('bird', 4, 0.5)], { crowd: 0.4, traffic: 0.2, wind: 0.2 }),
  'rail-track': s([c('train-pass', 0.6, 1), c('fx-joint', 1.6, 0.8), c('fx-joint', 1.9, 0.7), c('bird', 3.6, 0.5)], { wind: 0.4, traffic: 0.1 }),
  'rail-line': s([c('train-pass', 0.6, 1), c('fx-joint', 1.5, 0.8), c('station-chime', 3.2, 0.6)], { wind: 0.3, traffic: 0.2, crowd: 0.2 }),
  'bus-line': s([c('bus-pass', 0.4, 1), c('fx-hiss', 1.6, 0.8), c('fx-stopbell', 2.4, 0.8)], { traffic: 0.6, crowd: 0.4 }),
  'bus-depot': s([c('bus-pass', 0.4, 1), c('fx-hiss', 1.5, 0.7), c('horn', 2.8, 0.4)], { traffic: 0.4, industry: 0.25, crowd: 0.15 }),
  // the street over a tube station, with a train heard below
  'tube-entrance': s([c('tube-arrive', 0.9, 0.5), c('fx-chime', 5, 0.5), c('bike-bell', 3, 0.4)], { crowd: 0.6, traffic: 0.4 }),
  // underground: nothing of the street, the hall and the trains (the timings follow the arrival clip: tube-arrive, doors open, chime, the gap)
  'tube-line': s([loop('tube-hall', 0.8), c('tube-arrive', 0.5, 1), c('fx-hiss', 10, 0.8), c('fx-chime', 11, 0.8), c('tube-gap', 12.2, 0.7)], { traffic: 0, crowd: 0.05, wind: 0.1, water: 0, industry: 0 }, 3),
  'tube-crossover': s([loop('tube-hall', 0.8), c('tube-arrive', 0.5, 1), c('tube-arrive', 5.5, 0.8), c('fx-hiss', 11, 0.7), c('fx-chime', 12, 0.7)], { traffic: 0, crowd: 0.05, wind: 0.1, water: 0, industry: 0 }, 3),
  'tube-station': s([loop('tube-hall', 0.7), c('fx-chime', 0.8, 0.8), c('tube-arrive', 2, 0.9), c('tube-gap', 8, 0.6)], { traffic: 0.1, crowd: 0.4, wind: 0.1 }),
  // ---- the airport
  airport: s([c('station-chime', 0.4, 0.8), c('jet-takeoff', 1.2, 0.9), c('plane-over', 6, 0.7)], { traffic: 0.3, crowd: 0.45, wind: 0.25 }),
  runway: s([c('jet-takeoff', 0.5, 1), c('plane-over', 7, 0.8)], { wind: 0.4, traffic: 0.1, crowd: 0 }, 6),
} as const satisfies Record<string, TourSoundDef>;
export type SceneId = keyof typeof SCENES;

/** a London stop's sound: a scene, a scene with changes, a whole definition of its own, or the beds alone ('ambience') */
export type StopSound = SceneId | [SceneId, Partial<TourSoundDef>] | TourSoundDef | 'ambience';

/**
 * The London tour, stop by stop (by tour stop id: shared/src/demo/london.ts LONDON_TOUR, london-kinds.ts). Edit a row to change what a stop sounds like.
 * Every stop is listed: demo:check fails on a London stop with no row, and audio-check on a cue that names no voice.
 */
export const LONDON_SOUND: Record<string, StopSound> = {
  welcome: 'ambience', // the whole river from high over the City: the beds alone, thin wind and the far city
  // Westminster and the river
  'area-westminster': 'parliament',
  parliament: 'parliament',
  'london-eye': 'bank-wheel',
  'pier-embankment': 'pier',
  'line-ferry-rb1': 'ferry',
  'pier-millbank': 'pier',
  'buckingham-palace': 'palace',
  'new-scotland-yard': 'police',
  'st-thomas': ['hospital', { ambience: { water: 0.3, traffic: 0.35, crowd: 0.25 } }],
  'lambeth-fire': 'fire',
  // the West End
  'area-west-end': 'west-end',
  'piccadilly-circus': 'west-end-night',
  'carnaby-street': 'pedestrian',
  'bus-oxford-street': 'bus-street',
  'turn-oxford-circus': ['junction', { ambience: { traffic: 0.9, crowd: 0.75 } }],
  'marble-arch': ['junction', { cues: [{ voice: 'horn', at: 0.4, gain: 0.8 }, { voice: 'pigeons', at: 1.4, gain: 0.6 }, { voice: 'bus-pass', at: 2.4, gain: 0.9 }] }],
  'hyde-park-corner': 'park-corner',
  'london-traffic': 'traffic-panel',
  'royal-opera-house': 'concert',
  palladium: 'theatre',
  lyceum: 'theatre',
  donmar: ['theatre', { ambience: { crowd: 0.5, traffic: 0.2 } }],
  kings: 'university',
  lse: 'university',
  'leicester-square': 'multiplex',
  'broadcasting-house': 'broadcaster',
  'line-bus-25': 'bus-line',
  'line-bus-159': 'bus-line',
  'tube-central-tottenham-court-road': 'tube-entrance',
  'line-tube-central': 'tube-line',
  'line-tube-northern': 'tube-line',
  // the City
  'area-city': 'city-streets',
  'yellow-city': 'yellow',
  gherkin: 'skyscraper-city',
  'walkie-talkie': 'skyscraper-city',
  'tower-of-london': 'fortress',
  'tower-bridge': 'tower-bridge',
  'pool-of-london': 'pool',
  'st-katharine': 'marina',
  'pier-tower': 'pier',
  barbican: ['theatre', { cues: [{ voice: 'applause', at: 0.7, gain: 0.8 }, { voice: 'pigeons', at: 2.2, gain: 0.5 }], ambience: { crowd: 0.45, traffic: 0.15, fountain: 0.3 } }],
  'barbican-walks': { cues: [{ voice: 'footsteps', at: 0.5, gain: 0.8 }, { voice: 'pigeons', at: 1.6, gain: 0.7 }, { voice: 'bird', at: 3, gain: 0.7 }], ambience: { crowd: 0.45, traffic: 0.04, fountain: 0.35, wind: 0.2 } },
  'old-street': ['junction', { cues: [{ voice: 'horn', at: 0.4, gain: 0.8 }, { voice: 'bike-bell', at: 1.3, gain: 0.8 }, { voice: 'bus-pass', at: 2.4, gain: 0.8 }], ambience: { traffic: 0.8, crowd: 0.5 } }],
  'liverpool-street': 'terminus',
  'track-great-eastern': 'rail-track',
  'line-great-eastern': 'rail-line',
  stratford: 'terminus',
  'stratford-buildco': 'works',
  'london-stadium': 'stadium',
  'copper-box': 'sports-hall',
  // South Bank, Southwark and the south-west
  'area-south-bank': ['river-quarter', { ambience: { water: 0.6, crowd: 0.55, traffic: 0.3 } }],
  shard: 'skyscraper',
  'guys-hospital': 'hospital',
  'elephant-and-castle': ['junction', { cues: [{ voice: 'horn', at: 0.4, gain: 0.8 }, { voice: 'bus-pass', at: 1.2, gain: 1 }, { voice: 'siren', at: 2.8, gain: 0.4 }] }],
  waterloo: 'terminus',
  'tube-crossover': 'tube-crossover',
  'line-tube-jubilee': 'tube-line',
  'line-south-western': 'rail-line',
  'clapham-junction': 'rail-station',
  'area-clapham': ['suburb', { ambience: { traffic: 0.3, crowd: 0.2 } }],
  'primary-clapham': 'primary',
  'chelsea-jetty': 'marina',
  'victoria-garage': 'bus-depot',
  'stockwell-garage': 'bus-depot',
  'area-brixton': ['market-quarter', { cues: [{ voice: 'horn', at: 0.5, gain: 0.7 }, { voice: 'bike-bell', at: 1.6, gain: 0.6 }, { voice: 'siren', at: 3, gain: 0.35 }] }],
  'primary-brixton': 'primary',
  'secondary-brixton': 'secondary',
  'brixton-police': 'police',
  // Docklands and Greenwich
  'area-canary-wharf': 'skyscraper-docklands',
  'one-canada-square': 'skyscraper-docklands',
  'tube-jubilee-canary-wharf': 'tube-station',
  'pier-canary-wharf': 'pier',
  'area-isle-of-dogs': ['river-quarter', { cues: [{ voice: 'seagulls', at: 0.4, gain: 0.8 }, { voice: 'plane-over', at: 1.8, gain: 0.45 }, { voice: 'boat-horn', at: 3.2, gain: 0.5 }] }],
  'line-bus-d3': 'bus-line',
  'poplar-garage': 'bus-depot',
  'area-greenwich': ['river-quarter', { cues: [{ voice: 'seagulls', at: 0.4, gain: 0.9 }, { voice: 'bell', at: 1.6, gain: 0.5 }, { voice: 'pigeons', at: 3, gain: 0.6 }] }],
  'pier-greenwich': 'pier',
  'maritime-museum': 'museum-river',
  'o2-arena': 'arena',
  // the east: the Royal Docks and the Thames Gateway
  'area-royal-docks': 'docks',
  'barrier-grid': 'grid',
  'beckton-gas': 'gas',
  'area-thames-gateway': ['docks', { cues: [{ voice: 'port', at: 0.5, gain: 0.7 }, { voice: 'seagulls', at: 1.4, gain: 0.7 }, { voice: 'plane-over', at: 3, gain: 0.5 }], ambience: { industry: 0.35, water: 0.5, wind: 0.35 } }],
  'rainham-solar': 'solar',
  'a13-interchange': 'motorway',
  'london-port': 'docks',
  'thamesmead-quay': 'fish-quay',
  'dagenham-yard': 'freight-yard',
  'track-freight': ['rail-track', { cues: [{ voice: 'train-pass', at: 0.6, gain: 1 }, { voice: 'fx-joint', at: 1.8, gain: 0.8 }, { voice: 'fx-joint', at: 2.1, gain: 0.7 }, { voice: 'port', at: 3.4, gain: 0.4 }], ambience: { industry: 0.3, wind: 0.4 } }],
  'barking-yard': 'freight-yard',
  'line-freight': ['rail-line', { ambience: { industry: 0.3, wind: 0.3 } }],
  // the north-east and north
  'royal-london': 'hospital',
  'area-hackney': ['quiet', { cues: [{ voice: 'bin-lorry', at: 0.5, gain: 0.7 }, { voice: 'bike-bell', at: 2, gain: 0.7 }, { voice: 'bird', at: 3, gain: 0.7 }] }],
  'shoreditch-fire': 'fire',
  'primary-hackney': 'primary',
  'secondary-hackney': 'secondary',
  'area-islington': 'quiet',
  'primary-islington': 'primary',
  'zone20-islington': 'zone20',
  'secondary-islington': 'secondary',
  'kings-cross': 'terminus',
  'british-library': 'library',
  'line-east-coast': 'rail-line',
  'finsbury-park': 'rail-station',
  'british-museum': 'museum',
  ucl: 'university',
  'highgate-cemetery': 'cemetery',
  'golders-green-crematorium': ['cemetery', { cues: [{ voice: 'bird', at: 0.5, gain: 0.8 }, { voice: 'crows', at: 1.8, gain: 0.7 }, { voice: 'gust', at: 3, gain: 0.5 }], ambience: { wind: 0.4, traffic: 0.06 } }],
  'city-of-london-cemetery': 'cemetery-dusk',
  'kensal-green-cemetery': 'cemetery',
  'area-camden': 'market-quarter',
  'primary-camden': 'primary',
  'regents-park-lake': 'park-lake',
  lords: 'cricket',
  serpentine: 'park-lake',
  // the west
  'area-kensington': ['quiet', { cues: [{ voice: 'bird', at: 0.5, gain: 0.8 }, { voice: 'pigeons', at: 1.6, gain: 0.6 }, { voice: 'bike-bell', at: 2.8, gain: 0.5 }], ambience: { traffic: 0.35, crowd: 0.3 } }],
  'primary-kensington': 'primary',
  'natural-history-museum': 'museum-kids',
  imperial: 'university',
  'royal-albert-hall': 'concert',
  'imperial-research': 'research',
  'brompton-cemetery': 'cemetery',
  paddington: 'terminus',
  'line-heathrow': 'rail-line',
  'ealing-broadway': 'rail-station',
  'track-great-western': 'rail-track',
  wembley: 'stadium',
  'area-hammersmith': ['river-quarter', { cues: [{ voice: 'boat-pass', at: 0.5, gain: 0.7 }, { voice: 'horn', at: 1.8, gain: 0.7 }, { voice: 'bird', at: 3, gain: 0.6 }], ambience: { traffic: 0.55, water: 0.35 } }],
  'secondary-hammersmith': 'secondary',
  'kew-gardens': 'garden',
  'm4-interchange': 'motorway',
  heathrow: 'airport',
  'heathrow-runway': 'runway',
  'heathrow-station': ['terminus', { cues: [{ voice: 'station-chime', at: 0.6, gain: 0.9 }, { voice: 'jet-takeoff', at: 1.8, gain: 0.5 }, { voice: 'train-pass', at: 4, gain: 0.7 }] }],
  // the rest of London (london-kinds.ts)
  'battersea-power': 'coal',
};

/** a few of the showcase town's stops, where the sound is free (the Sound stop at least: it plays what it describes) */
export const SHOWCASE_SOUND: Record<string, StopSound> = {
  sound: s([c('bird', 0.4, 1), c('bird', 1.1, 0.8), c('gust', 2.4, 0.6), c('pigeons', 3.6, 0.6)], { traffic: 0.2, crowd: 0.2, wind: 0.2 }),
  river: 'river',
  'level-crossing': s([c('bridge-bell', 0.4, 0.9), c('train-pass', 2.4, 0.9)], { traffic: 0.3, wind: 0.2 }),
  'bridge-bascule': s([c('bridge-bell', 0.4, 0.9), c('boat-horn', 2, 0.7), c('seagulls', 1.2, 0.8)], { water: 0.8, traffic: 0.4 }),
};

/** a stop's table entry as a finished TourSound (a scene, with its changes laid over it) */
export function resolveStopSound(e: StopSound): TourSound {
  if (e === 'ambience') return 'ambience';
  if (typeof e === 'string') return structuredClone(SCENES[e]) as TourSoundDef;
  if (Array.isArray(e)) {
    const base = SCENES[e[0]] as TourSoundDef, o = e[1];
    return { cues: structuredClone(o.cues ?? base.cues), ...(o.ambience ?? base.ambience ? { ambience: { ...(base.ambience ?? {}), ...(o.ambience ?? {}) } } : {}), ...((o.duck ?? base.duck) !== undefined ? { duck: o.duck ?? base.duck } : {}) };
  }
  return structuredClone(e);
}

/** the table a demo's tour reads (only London and the showcase have one) */
const TABLES: Partial<Record<DemoId, Record<string, StopSound>>> = { london: LONDON_SOUND, showcase: SHOWCASE_SOUND };

/** demoTour's last step: lay each stop's sound on it from the demo's table. Stops with no row get none (the beds alone; the check names them). */
export function withTourSound<T extends { id: string; sound?: TourSound }>(demo: DemoId, stops: T[]): T[] {
  const table = TABLES[demo];
  if (!table) return stops;
  for (const st of stops) { const e = table[st.id]; if (e !== undefined) st.sound = resolveStopSound(e); }
  return stops;
}

/** Problems with a demo's tour sound that the data alone shows: a London stop with no row (the showcase's rows are optional), a row for no stop, an empty or malformed cue. Voice names are checked by audio-check (the manifest is the client's). */
export function tourSoundProblems(demo: DemoId, stops: readonly { id: string; sound?: TourSound }[]): string[] {
  const table = TABLES[demo];
  if (!table) return [];
  const out: string[] = [];
  const ids = new Set(stops.map((x) => x.id));
  for (const st of stops) {
    if (st.sound === undefined) { if (demo === 'london') out.push(`${demo} tour stop ${st.id} has no sound row (tourSound.ts): give it a scene or 'ambience'`); continue; }
    if (st.sound === 'ambience') continue;
    if (!st.sound.cues.length) out.push(`${demo} tour stop ${st.id} has a sound with no cue: use 'ambience' to leave it to the beds`);
    for (const q of st.sound.cues) {
      if (!q.voice) out.push(`${demo} tour stop ${st.id} has a cue with no voice`);
      if (q.at !== undefined && !(q.at >= 0 && q.at <= 30)) out.push(`${demo} tour stop ${st.id}: cue ${q.voice} starts at ${q.at} s (0 to 30)`);
      if (q.gain !== undefined && !(q.gain > 0 && q.gain <= 2)) out.push(`${demo} tour stop ${st.id}: cue ${q.voice} has gain ${q.gain} (over 0 to 2)`);
    }
    for (const [bed, v] of Object.entries(st.sound.ambience ?? {})) if (!(v >= 0 && v <= 1)) out.push(`${demo} tour stop ${st.id}: ambience ${bed} is ${v} (0 to 1)`);
  }
  for (const id of Object.keys(table)) if (!ids.has(id)) out.push(`${demo} sound row ${id} names no stop on its tour`);
  return out;
}
