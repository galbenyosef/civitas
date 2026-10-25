// The recording table for Audio v2 (docs/audio.md, "Recordings"): for every voice, what to search Freesound for and how to cut what is found.
// Read by freesound-fetch.ts (search, score, download previews) and audio-build.ts (trim, loop, normalise, encode). Edit a row, re-run.

export type Cls = 'bed' | 'event' | 'ride';

export interface VoiceQuery {
  /** the manifest id (a second-pass voice gets a new row in audio/manifest.ts) */
  id: string;
  cls: Cls;
  /** two to four search strings, best first */
  queries: string[];
  /** acceptable source length in seconds [min, max] */
  dur: [number, number];
  /** words that count against a candidate when they appear in its tags, name or description */
  avoid?: string[];
  /** words that count for a candidate */
  want?: string[];
  /** at least one of these should be in the sound's name or tags, or it is probably something else (a Chihuahua is not a blackbird) */
  must?: string[];
  /** a loop is welcome (a bed) or unwanted (an event); default: welcome for beds and rides, unwanted for events */
  loop?: boolean;
  /** how many takes to ship (events vary between them; a bed ships one unless noted) */
  takes: number;
  /** the longest clip to keep, seconds: a bed is cut to this and made to loop, an event is cut and faded */
  maxSec: number;
  /** playback level of the recording (the bus gains do the rest); the loudness target is per class */
  level: number;
}

const NOISE = ['speech', 'voice', 'talking', 'music', 'song', 'vocal'];
const bed = (id: string, queries: string[], o: Partial<VoiceQuery> = {}): VoiceQuery =>
  ({ id, cls: 'bed', queries, dur: [8, 300], avoid: [...NOISE, 'sfx', 'synth', 'processed'], loop: true, takes: 1, maxSec: 16, level: 0.5, ...o });
const ev = (id: string, queries: string[], o: Partial<VoiceQuery> = {}): VoiceQuery =>
  ({ id, cls: 'event', queries, dur: [0.4, 12], avoid: ['loop', 'music', 'synth', 'processed', 'sfx'], loop: false, takes: 2, maxSec: 6, level: 0.4, ...o });
const ride = (id: string, queries: string[], o: Partial<VoiceQuery> = {}): VoiceQuery =>
  ({ id, cls: 'ride', queries, dur: [10, 300], avoid: [...NOISE, 'sfx', 'synth', 'exterior', 'passing', 'outside', 'horn'], loop: true, takes: 1, maxSec: 14, level: 0.55, ...o });

/** UI clicks (ui-click, ui-place, ui-refuse, ui-undo) are not here: they stay synthesised (docs/audio.md). */
export const VOICE_QUERIES: VoiceQuery[] = [
  // ---- the five ambience beds
  bed('traffic', ['traffic', 'city traffic', 'road traffic', 'street traffic ambience'], { must: ['traffic', 'road', 'street', 'city'], avoid: [...NOISE, 'horn', 'siren', 'rain', 'sfx'] }),
  bed('wind', ['wind', 'wind ambience', 'wind howl', 'wind blowing'], { must: ['wind', 'breeze', 'gust'], avoid: [...NOISE, 'chimes', 'door', 'rain', 'sfx'] }),
  bed('crowd', ['crowd', 'crowd murmur', 'crowd ambience', 'people chatter'], { must: ['crowd', 'people', 'chatter', 'murmur', 'walla'], avoid: ['music', 'song', 'laugh', 'scream', 'sfx', 'synth'] }),
  bed('industry', ['factory', 'machinery hum', 'industrial ambience', 'machine room'], { must: ['factory', 'machin', 'industr', 'hum', 'drone', 'plant', 'engine room'], avoid: ['voice', 'speech', 'music', 'alarm', 'sfx'] }),
  bed('water', ['water flowing', 'river', 'water lapping', 'canal'], { must: ['water', 'river', 'stream', 'canal', 'lap', 'brook'], avoid: ['voice', 'speech', 'music', 'bird', 'sfx', 'rain'] }),
  // ---- the six ambience events
  ev('bird', ['blackbird', 'robin', 'birdsong', 'bird song'], { must: ['bird', 'robin', 'thrush', 'sparrow', 'wren', 'chirp', 'tweet', 'tit'], takes: 3, maxSec: 5, dur: [1, 10] }),
  ev('owl', ['owl', 'tawny owl', 'owl hoot'], { must: ['owl'], takes: 3, maxSec: 5, dur: [1, 12] }),
  ev('bell', ['church bell', 'bell strike', 'bell toll'], { must: ['bell'], takes: 2, maxSec: 6, dur: [1.5, 15] }),
  ev('bell-deep', ['big ben', 'bell toll', 'large bell', 'cathedral bell'], { must: ['bell', 'big ben'], takes: 2, maxSec: 9, dur: [2, 20], level: 0.5 }),
  ev('horn', ['car horn', 'horn beep', 'taxi horn'], { must: ['horn', 'hooter'], takes: 3, maxSec: 1.6, dur: [0.2, 4] }),
  ev('beep', ['pedestrian crossing', 'crossing beep', 'pelican crossing', 'traffic light beep'], { must: ['beep', 'crossing', 'pelican', 'signal', 'tone'], takes: 2, maxSec: 1.6, dur: [0.3, 6], level: 0.35 }),
  // ---- the ridden vehicle
  ride('veh-car', ['car interior', 'car driving', 'car engine interior', 'driving ambience'], { must: ['car', 'drive', 'driving', 'vehicle'] }),
  ride('veh-truck', ['truck interior', 'lorry cab', 'truck driving', 'van interior'], { must: ['truck', 'lorry', 'van', 'diesel'] }),
  ride('veh-bus', ['bus interior', 'bus ride', 'bus engine', 'double decker'], { must: ['bus'] }),
  ride('veh-train', ['train interior', 'train ride', 'train carriage', 'train inside'], { must: ['train', 'railway', 'rail', 'carriage'] }),
  ride('veh-metro', ['subway train', 'underground train', 'tube train', 'metro train'], { must: ['subway', 'metro', 'underground', 'tube', 'train'] }),
  ride('veh-boat', ['boat engine', 'motorboat', 'boat motor', 'diesel boat'], { must: ['boat', 'ship', 'marine', 'motor', 'outboard', 'engine'] }),
  ride('veh-plane', ['airplane cabin', 'aircraft cabin', 'plane interior', 'jet cabin'], { must: ['plane', 'aircraft', 'airplane', 'jet', 'cabin', 'flight'] }),
  ride('veh-heli', ['helicopter interior', 'helicopter cabin', 'helicopter inside', 'helicopter flight'], { must: ['heli'] }),
  // ---- the vehicle events
  ev('fx-hiss', ['bus door', 'air brake', 'pneumatic hiss', 'air release'], { must: ['hiss', 'pneumatic', 'brake', 'air', 'door'], takes: 2, maxSec: 2.2, dur: [0.5, 5] }),
  ev('fx-stopbell', ['bus bell', 'stop bell', 'bus stop', 'bell ding'], { must: ['bell', 'ding', 'chime'], takes: 2, maxSec: 1.8, dur: [0.3, 4] }),
  ev('fx-chime', ['train door', 'door chime', 'door closing chime', 'tube door'], { must: ['chime', 'door', 'beep', 'tone', 'ding'], takes: 2, maxSec: 2.5, dur: [0.5, 6] }),
  ev('fx-joint', ['train clack', 'railway', 'train track', 'rail joint'], { must: ['clack', 'click', 'rail', 'train', 'track', 'wheel'], takes: 1, maxSec: 0.45, dur: [0.3, 6] }),
  // ---- the second pass: weather
  bed('rain-light', ['light rain', 'rain', 'drizzle', 'gentle rain'], { must: ['rain', 'drizzle', 'shower'], avoid: [...NOISE, 'thunder', 'storm', 'heavy', 'sfx'] }),
  bed('rain-heavy', ['heavy rain', 'downpour', 'rain storm', 'rain'], { must: ['rain', 'downpour', 'shower'], avoid: [...NOISE, 'thunder', 'sfx'] }),
  ev('gust', ['wind gust', 'gust', 'wind whoosh'], { must: ['gust', 'wind', 'whoosh'], takes: 2, maxSec: 5, dur: [1.5, 15] }),
  ev('thunder', ['thunder', 'thunderclap', 'thunder rumble', 'rolling thunder'], { must: ['thunder'], takes: 3, maxSec: 9, dur: [2, 30], level: 0.5, avoid: ['loop', 'rain', 'music', 'synth', 'sfx'] }),
  // ---- the second pass: the city
  ev('footsteps', ['footsteps', 'footsteps pavement', 'footsteps concrete', 'walking'], { must: ['step', 'walk', 'foot'], takes: 3, maxSec: 3.5, dur: [1.5, 12], level: 0.3, avoid: ['loop', 'gravel', 'snow', 'grass', 'stairs', 'run', 'music', 'sfx'] }),
  ev('siren', ['police siren', 'uk siren', 'police car siren', 'siren'], { must: ['siren', 'police'], takes: 2, maxSec: 8, dur: [3, 40], level: 0.35, avoid: ['loop', 'ambulance', 'american', 'us ', 'music', 'sfx'] }),
  ev('siren-fire', ['fire engine', 'fire truck siren', 'fire brigade', 'fire siren'], { must: ['siren', 'fire', 'engine', 'truck'], takes: 2, maxSec: 8, dur: [3, 40], level: 0.35 }),
  ev('seagulls', ['seagull', 'seagulls', 'gull', 'gulls'], { must: ['gull'], takes: 3, maxSec: 6, dur: [1.5, 20], level: 0.35 }),
  ev('pigeons', ['pigeon', 'pigeons', 'wood pigeon', 'dove coo'], { must: ['pigeon', 'dove', 'coo'], takes: 2, maxSec: 5, dur: [1.5, 20], level: 0.3 }),
  ev('dog', ['dog bark', 'dog barking', 'dog', 'bark'], { must: ['dog', 'bark'], takes: 3, maxSec: 3, dur: [0.4, 8], level: 0.35 }),
  ev('bell-peal', ['church bells', 'bells ringing', 'bell peal', 'wedding bells'], { must: ['bell', 'peal', 'ring', 'chime'], takes: 2, maxSec: 14, dur: [6, 90], level: 0.45, avoid: ['music', 'synth', 'sfx'] }),
  ev('bike-bell', ['bicycle bell', 'bike bell', 'cycle bell'], { must: ['bell', 'bicycle', 'bike', 'cycle'], takes: 2, maxSec: 1.8, dur: [0.3, 5], level: 0.35 }),
  ev('bin-lorry', ['bin lorry', 'garbage truck', 'refuse truck', 'dustcart'], { must: ['bin', 'lorry', 'garbage', 'refuse', 'trash', 'dustcart'], takes: 2, maxSec: 8, dur: [3, 40], level: 0.35 }),
  ev('station-chime', ['announcement chime', 'station chime', 'airport chime', 'announcement jingle'], { must: ['chime', 'announce', 'station', 'ding', 'jingle'], takes: 2, maxSec: 3, dur: [0.8, 6], level: 0.3 }),
  ev('heli-over', ['helicopter flyover', 'helicopter overhead', 'helicopter passing', 'helicopter'], { must: ['heli'], takes: 2, maxSec: 12, dur: [6, 60], level: 0.4, avoid: ['loop', 'interior', 'cabin', 'music', 'sfx'] }),
  ev('plane-over', ['plane flyover', 'jet flyover', 'airplane overhead', 'aeroplane passing'], { must: ['plane', 'jet', 'aircraft', 'airplane', 'aeroplane', 'fly'], takes: 2, maxSec: 12, dur: [6, 60], level: 0.4, avoid: ['loop', 'interior', 'cabin', 'music', 'sfx'] }),
  ev('boat-horn', ['ship horn', 'boat horn', 'ferry horn', 'tugboat horn'], { must: ['horn', 'ship', 'boat', 'ferry', 'tug', 'foghorn'], takes: 2, maxSec: 4, dur: [1, 10], level: 0.4 }),
  ev('fireworks', ['fireworks', 'firework', 'firework explosion', 'fireworks display'], { must: ['firework'], takes: 3, maxSec: 8, dur: [2, 30], level: 0.45, avoid: ['loop', 'music', 'crowd', 'synth', 'sfx'] }),
  ev('hammer', ['hammering', 'hammer', 'construction hammering', 'nailing'], { must: ['hammer', 'nail', 'construction'], takes: 3, maxSec: 3.5, dur: [1, 12], level: 0.35 }),
  ev('drill', ['power drill', 'drill', 'jackhammer', 'electric drill'], { must: ['drill', 'jackhammer', 'pneumatic'], takes: 2, maxSec: 4, dur: [1, 15], level: 0.35 }),
  ev('lawnmower', ['lawnmower', 'lawn mower', 'mower', 'petrol mower'], { must: ['mower', 'lawn'], takes: 2, maxSec: 12, dur: [6, 60], level: 0.3, loop: true }),
  // ---- the second pass: places that have a bed of their own
  bed('market', ['market', 'street market', 'market stalls', 'market ambience'], { must: ['market', 'stall', 'vendor'], avoid: ['music', 'song', 'scream', 'sfx', 'synth', 'church'] }),
  bed('pub', ['pub', 'pub ambience', 'bar ambience', 'bar chatter'], { must: ['pub', 'bar', 'tavern'], avoid: ['music', 'song', 'scream', 'sfx', 'synth'] }),
  bed('playground', ['playground', 'children playing', 'kids playing', 'school playground'], { must: ['playground', 'children', 'kids', 'school', 'play'], avoid: ['music', 'song', 'sfx', 'synth'] }),
  bed('stadium', ['stadium', 'stadium crowd', 'football crowd', 'crowd cheer'], { must: ['stadium', 'crowd', 'football', 'soccer', 'arena', 'cheer'], avoid: ['music', 'song', 'sfx', 'synth'], maxSec: 18 }),
  bed('fountain', ['fountain', 'water fountain', 'fountain ambience', 'fountain splash'], { must: ['fountain'], avoid: ['voice', 'speech', 'music', 'sfx', 'rain', 'toilet'] }),
  // ---- the tour cues (docs/audio.md "Tour cues"): sounds only the London tour asks for, by name, at a stop. They have no place in the ambient mix.
  ev('big-ben', ['westminster chimes', 'big ben chimes', 'big ben', 'clock tower chime'], { must: ['chime', 'big ben', 'westminster', 'bell', 'clock'], takes: 2, maxSec: 16, dur: [4, 45], level: 0.5, avoid: ['loop', 'synth', 'processed', 'sfx', 'phone', 'ringtone'] }),
  ev('bus-pass', ['double decker bus passing', 'bus passing', 'bus pass by', 'london bus'], { must: ['bus'], takes: 2, maxSec: 8, dur: [3, 30], level: 0.4, avoid: ['loop', 'interior', 'inside', 'horn', 'music', 'sfx', 'synth'] }),
  ev('tube-arrive', ['tube train arriving', 'underground train arriving', 'subway train arrives station', 'metro train arriving platform'], { must: ['train', 'tube', 'subway', 'metro', 'underground'], takes: 2, maxSec: 14, dur: [5, 45], level: 0.45, avoid: ['loop', 'interior', 'inside', 'music', 'sfx', 'synth'] }),
  ev('tube-gap', ['mind the gap', 'mind the gap please', 'tube announcement', 'underground announcement'], { must: ['gap', 'mind', 'tube', 'underground'], takes: 1, maxSec: 4, dur: [0.5, 10], level: 0.35, avoid: ['loop', 'music', 'sfx', 'synth'] }),
  ev('train-pass', ['train passing', 'train pass by', 'train passing by station', 'train fly by'], { must: ['train'], takes: 2, maxSec: 12, dur: [5, 45], level: 0.4, avoid: ['loop', 'interior', 'inside', 'cabin', 'horn', 'music', 'sfx', 'synth'] }),
  ev('boat-pass', ['boat passing', 'motorboat passing', 'river boat passing', 'barge engine'], { must: ['boat', 'barge', 'ferry', 'motor', 'ship'], takes: 2, maxSec: 12, dur: [5, 45], level: 0.4, avoid: ['loop', 'interior', 'inside', 'music', 'sfx', 'synth'] }),
  ev('port', ['shipyard', 'dock crane', 'harbor machinery', 'port ambience', 'metal clang chain'], { must: ['crane', 'port', 'dock', 'harbor', 'harbour', 'container', 'clang', 'chain', 'shipyard', 'yard', 'metal', 'machinery'], takes: 2, maxSec: 8, dur: [3, 60], level: 0.4, avoid: ['loop', 'music', 'synth', 'processed', 'sfx', 'drum', 'beat'] }),
  ev('crowd-roar', ['football crowd roar', 'crowd cheer goal', 'stadium roar', 'crowd cheering'], { must: ['crowd', 'cheer', 'roar', 'stadium', 'football', 'goal'], takes: 2, maxSec: 9, dur: [3, 30], level: 0.4, avoid: ['loop', 'music', 'song', 'speech', 'sfx', 'synth'] }),
  ev('whistle', ['referee whistle', 'football whistle', 'whistle blow', 'sports whistle'], { must: ['whistle'], takes: 2, maxSec: 1.8, dur: [0.3, 6], level: 0.35, avoid: ['loop', 'music', 'sfx', 'synth', 'train', 'kettle', 'bird'] }),
  ev('jet-takeoff', ['jet takeoff', 'airplane take off', 'airliner takeoff', 'jet engine takeoff'], { must: ['jet', 'plane', 'airplane', 'airliner', 'aircraft', 'takeoff', 'take off', 'take-off'], takes: 2, maxSec: 14, dur: [8, 60], level: 0.4, avoid: ['loop', 'interior', 'cabin', 'inside', 'music', 'sfx', 'synth'] }),
  ev('shop-bell', ['shop door bell', 'shop bell', 'shop entry bell', 'store door chime'], { must: ['bell', 'door', 'shop', 'chime', 'store'], takes: 2, maxSec: 2.5, dur: [0.5, 6], level: 0.35 }),
  ev('ducks', ['ducks quacking', 'duck quack', 'mallard', 'ducks pond'], { must: ['duck', 'mallard', 'quack'], takes: 2, maxSec: 5, dur: [1, 20], level: 0.35 }),
  ev('applause', ['applause', 'audience applause', 'theatre applause', 'clapping audience'], { must: ['applause', 'clap', 'audience'], takes: 2, maxSec: 8, dur: [3, 30], level: 0.35, avoid: ['loop', 'music', 'song', 'speech', 'sfx', 'synth', 'whistle'] }),
  ev('orchestra', ['orchestra tuning', 'orchestra tune up', 'orchestra warming up', 'orchestra pit'], { must: ['orchestra', 'tuning', 'tune', 'warm'], takes: 2, maxSec: 10, dur: [4, 40], level: 0.35, avoid: ['loop', 'synth', 'sfx', 'processed', 'midi'] }),
  ev('siren-ambulance', ['ambulance siren', 'uk ambulance siren', 'ambulance'], { must: ['ambulance', 'siren'], takes: 2, maxSec: 8, dur: [3, 40], level: 0.35, avoid: ['loop', 'american', 'us ', 'music', 'sfx'] }),
  ev('school-bell', ['school bell', 'school bell ringing', 'lesson bell', 'electric bell ring'], { must: ['bell'], takes: 2, maxSec: 4, dur: [1, 12], level: 0.35 }),
  ev('crows', ['crow caw', 'crows', 'rook', 'raven'], { must: ['crow', 'rook', 'raven', 'caw'], takes: 2, maxSec: 5, dur: [1, 20], level: 0.35 }),
  ev('fox', ['fox scream', 'fox screech', 'vixen scream', 'urban fox'], { must: ['fox', 'vixen'], takes: 1, maxSec: 5, dur: [1, 20], level: 0.35 }),
  bed('station-hall', ['train station ambience', 'railway station ambience', 'station concourse', 'train station'], { must: ['station', 'concourse', 'terminal', 'railway'], avoid: [...NOISE, 'announcement', 'announce', 'sfx', 'synth'], level: 0.45 }),
  bed('tube-hall', ['underground station ambience', 'subway station ambience', 'metro station ambience', 'tunnel ambience'], { must: ['station', 'subway', 'metro', 'underground', 'tunnel', 'tube'], avoid: [...NOISE, 'announcement', 'announce', 'sfx', 'synth'], level: 0.45 }),
  ev('rigging', ['boat rigging', 'halyard clink', 'sailboat marina', 'masts clinking'], { must: ['rigging', 'halyard', 'mast', 'marina', 'clink', 'boat', 'sail'], takes: 2, maxSec: 8, dur: [3, 40], level: 0.3, avoid: ['loop', 'music', 'sfx', 'synth', 'storm'] }),
  ev('bridge-bell', ['bridge warning bell', 'bridge bell', 'level crossing bell', 'railway crossing bell'], { must: ['bell', 'bridge', 'crossing', 'warning'], takes: 2, maxSec: 5, dur: [2, 30], level: 0.35 }),
  ev('parakeets', ['parakeet', 'parakeets', 'ring necked parakeet', 'parrot squawk'], { must: ['parakeet', 'parrot'], takes: 2, maxSec: 4, dur: [1, 20], level: 0.3 }),
  bed('flare-roar', ['furnace roar', 'industrial burner', 'blowtorch', 'steam roar', 'boiler room'], { must: ['burner', 'flare', 'furnace', 'roar', 'boiler', 'blowtorch', 'flame', 'steam'], avoid: [...NOISE, 'alarm', 'kitchen', 'stove', 'cooking', 'sfx', 'synth'], level: 0.4 }),
];
