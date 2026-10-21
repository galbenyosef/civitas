/**
 * The voice manifest (docs/audio.md): every sound the game makes, by id, with the numbers it is synthesised from.
 * voices.ts reads its ranges from here, so a voice is tuned by editing a row. A row with `file` set is replaced by a
 * recording: the engine fetches the Opus file when the sound starts, and plays it (looped for a bed, once for an event,
 * with the same per-instance variation) in place of the synthesis. No file ships; a missing or undecodable file falls
 * back to the synthesised voice, so a recording can be added one voice at a time.
 */
export type BusId = 'ambience' | 'vehicles' | 'ui';

export interface VoiceDef {
  id: string;
  bus: BusId;
  /** bed: runs all the time at a level the state sets; event: fired, once, at a moment */
  kind: 'bed' | 'event';
  /** what it is made of */
  made: string;
  /** what drives it */
  driven: string;
  /** synthesis numbers: frequencies in Hz, times in seconds, depths 0..1 */
  params: Record<string, number>;
  /** a recording to use instead, relative to the page: see voiceFile(id). Unset for every voice that ships */
  file?: string;
}

/** The conventional path of a recording for a voice: set `file: voiceFile('traffic')` and put the Opus file in packages/client/public/audio/. */
export const voiceFile = (id: string) => `audio/${id}.opus`;

const def = (d: VoiceDef): [string, VoiceDef] => [d.id, d];

export const VOICES: Record<string, VoiceDef> = Object.fromEntries([
  // ---- ambience beds
  def({ id: 'traffic', bus: 'ambience', kind: 'bed', made: 'brown noise through a low-pass, with a slow swell', driven: 'cars drawn round the camera (level, cutoff), zoom',
    params: { lpMin: 140, lpMax: 720, q: 0.7, swellHz: 0.17, swell: 0.25 } }),
  def({ id: 'wind', bus: 'ambience', kind: 'bed', made: 'pink noise through a band-pass whose centre drifts', driven: 'camera height (zoom distance)',
    params: { bpMin: 280, bpMax: 1100, q: 0.5, driftHz: 0.07, drift: 0.22 } }),
  def({ id: 'crowd', bus: 'ambience', kind: 'bed', made: 'pink noise through a band-pass, amplitude-modulated by two slow oscillators', driven: 'walkers drawn near the camera, shops and offices round it, the hour',
    params: { bpMin: 520, bpMax: 1150, q: 1.1, amHz: 0.4, amDepth: 0.35, amHz2: 1.7, amDepth2: 0.12 } }),
  def({ id: 'industry', bus: 'ambience', kind: 'bed', made: 'two detuned low saws and a harmonic through a resonant low-pass', driven: 'industrial and power tiles round the camera, the hour',
    params: { f0: 52, detune: 7, lpMin: 170, lpMax: 430, q: 7 } }),
  def({ id: 'water', bus: 'ambience', kind: 'bed', made: 'pink noise through a low-pass with a slow swell', driven: 'water tiles round the camera',
    params: { lpMin: 450, lpMax: 1800, swellHz: 0.12, swell: 0.4 } }),
  // ---- ambience events
  def({ id: 'bird', bus: 'ambience', kind: 'event', made: 'a frequency-modulated sine chirping two to five syllables, each syllable its own pitch and sweep', driven: 'a Poisson clock: the hour (dawn chorus 04:30 to 07:00), parks and homes round the camera',
    params: { fMin: 2200, fMax: 4800, sylMin: 2, sylMax: 5, fm: 0.12, gain: 0.05 } }),
  def({ id: 'owl', bus: 'ambience', kind: 'event', made: 'two low sine hoots with a little vibrato through a low-pass', driven: 'a Poisson clock: night, parks and homes round the camera',
    params: { f: 330, vib: 5, gain: 0.1 } }),
  def({ id: 'bell', bus: 'ambience', kind: 'event', made: 'a bell: five inharmonic sine partials with their own decays, struck once per hour (up to six times)', driven: 'the hour, when a churchyard is within the view',
    params: { f0: 330, decay: 3.4, gain: 0.07 } }),
  def({ id: 'bell-deep', bus: 'ambience', kind: 'event', made: 'the same bell an octave and a half lower with a long decay', driven: 'the hour, when the Houses of Parliament are within the view',
    params: { f0: 164, decay: 6.5, gain: 0.1 } }),
  def({ id: 'horn', bus: 'ambience', kind: 'event', made: 'two detuned square waves a major third apart through a low-pass', driven: 'a rare Poisson clock scaled by cars near the camera',
    params: { f: 410, ratio: 1.26, detune: 0.012, gain: 0.035 } }),
  def({ id: 'beep', bus: 'ambience', kind: 'event', made: 'short 2 kHz sine pulses', driven: 'a signal crossing near the camera while it shows the walkers green and holds the cars at red',
    params: { f: 2000, pulse: 0.09, gap: 0.09, gain: 0.05 } }),
  // ---- user interface
  def({ id: 'ui-click', bus: 'ui', kind: 'event', made: 'a 6 ms noise tick and a short sine', driven: 'picking a tool', params: { f: 1500, len: 0.04, gain: 0.1 } }),
  def({ id: 'ui-place', bus: 'ui', kind: 'event', made: 'a sine thud falling from 150 to 60 Hz with a noise tick', driven: 'placing a building, a road or a zone', params: { f: 150, len: 0.14, gain: 0.2 } }),
  def({ id: 'ui-refuse', bus: 'ui', kind: 'event', made: 'two falling triangle notes', driven: 'a refusal (an error toast)', params: { f: 230, len: 0.2, gain: 0.12 } }),
  def({ id: 'ui-undo', bus: 'ui', kind: 'event', made: 'a rising sine sweep', driven: 'undoing a road drag', params: { f: 520, len: 0.1, gain: 0.1 } }),
  // ---- first person: the ridden vehicle (bus 'vehicles')
  def({ id: 'veh-car', bus: 'vehicles', kind: 'bed', made: 'a saw and a sub triangle through a low-pass, pulsed by a firing tremor, over road rumble', driven: 'the car\'s speed (pitch, cutoff, tremor rate)',
    params: { f0: 56, f1: 150, lpMin: 330, lpMax: 1500, tremor: 24, depth: 0.25, rumble: 0.5 } }),
  def({ id: 'veh-truck', bus: 'vehicles', kind: 'bed', made: 'as the car, lower, with a slower tremor and more rumble', driven: 'speed',
    params: { f0: 42, f1: 112, lpMin: 260, lpMax: 1100, tremor: 14, depth: 0.4, rumble: 0.7 } }),
  def({ id: 'veh-bus', bus: 'vehicles', kind: 'bed', made: 'a diesel: a low saw and sub with a deep slow rattle tremor over a heavy rumble', driven: 'speed',
    params: { f0: 36, f1: 92, lpMin: 220, lpMax: 900, tremor: 10, depth: 0.6, rumble: 0.9 } }),
  def({ id: 'veh-train', bus: 'vehicles', kind: 'bed', made: 'a rising traction whine (two triangles a fifth apart) over a smooth rail rumble and wheel hiss', driven: 'speed',
    params: { whine0: 180, whine1: 900, rumble: 0.8, hiss: 0.08 } }),
  def({ id: 'veh-metro', bus: 'vehicles', kind: 'bed', made: 'a higher, louder whine over a tunnel boom (a resonant band-pass on brown noise)', driven: 'speed',
    params: { whine0: 320, whine1: 1250, rumble: 0.7, boom: 160 } }),
  def({ id: 'veh-boat', bus: 'vehicles', kind: 'bed', made: 'a low saw chugging at 4 to 10 Hz through a low-pass, over water lap', driven: 'speed',
    params: { f: 46, chug0: 4, chug1: 10, lap: 0.3 } }),
  def({ id: 'veh-plane', bus: 'vehicles', kind: 'bed', made: 'white noise through a band-pass that opens with speed, over a low saw', driven: 'speed',
    params: { bp0: 400, bp1: 2000, f0: 70, f1: 150 } }),
  def({ id: 'veh-heli', bus: 'vehicles', kind: 'bed', made: 'pink noise chopped at 14 to 20 Hz over a low saw', driven: 'speed',
    params: { chop0: 14, chop1: 20, f: 85 } }),
  def({ id: 'fx-hiss', bus: 'vehicles', kind: 'event', made: 'high-passed noise with a rise and a fall', driven: 'a bus or train opening its doors', params: { len: 0.7, gain: 0.12 } }),
  def({ id: 'fx-stopbell', bus: 'vehicles', kind: 'event', made: 'one short bell-like ding (two partials)', driven: 'a bus pulling away from a stop', params: { f: 1180, len: 0.5, gain: 0.08 } }),
  def({ id: 'fx-chime', bus: 'vehicles', kind: 'event', made: 'two sine notes, a fourth apart', driven: 'a train closing its doors', params: { f: 740, len: 0.45, gain: 0.07 } }),
  def({ id: 'fx-joint', bus: 'vehicles', kind: 'event', made: 'two band-passed noise clacks a bogie apart', driven: 'a train\'s speed (joints per second)', params: { f: 900, gap: 0.09, gain: 0.1 } }),
]);
