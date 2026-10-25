import type { TourStop } from './showcase';
import type { CityDemo } from './citydemo';

/**
 * Paris on the city-map kit (docs/demo.md "Sample cities and the city-map kit"): the Seine from Ivry past the islands
 * and round the Boulogne loop to Saint-Denis, Île de la Cité as an island in it with Notre-Dame, the Louvre by the
 * Tuileries, the Opéra on the Grands Boulevards, the Arc de Triomphe at the Étoile beside its roundabout, the Eiffel
 * Tower on the Champ de Mars facing the Trocadéro over the Pont d'Iéna, and the Sacré-Cœur on Montmartre; Gare du Nord
 * and Gare de Lyon with a line each, Métro lines 1 and 4, the Batobus on the Seine and the 69 bus.
 *
 * 7 tiles a kilometre (a tile about 140 m), the Louvre at the middle of a 144×105 map from La Défense to Vincennes and
 * from Saint-Denis to Montrouge. The Seine is drawn three to four times its width (four to five tiles; ten round the
 * Île de la Cité) so its banks hold the river bus's piers and the islands' arms the Batobus' channel.
 */

export const PARIS: CityDemo = {
  id: 'paris', name: 'Paris',
  blurb: 'A sample city on the shape of Paris: the Seine round the Île de la Cité and Notre-Dame, the Louvre and the Tuileries, the Opéra on the Grands Boulevards, the Arc de Triomphe at the Étoile, the Eiffel Tower over the river from the Trocadéro and the Sacré-Cœur on Montmartre; the Champs-Élysées and the boulevards as avenues, Gare du Nord and Gare de Lyon, Métro lines 1 and 4 underneath and the Batobus on the river.',
  geo: { lat: 48.8606, lon: 2.3376, scale: 7 },
  // Haussmann's city: mid-rise everywhere but La Défense (the 'city' character), whose towers are uncapped
  heights: { westend: 4, civic: 4, inner: 4, outer: 4, suburb: 3, industry: 5 },
  // and its lots: offices of a few storeys, shops with flats over them under mansard roofs, apartment blocks; fewer
  // offices in the centre than London's West End, more shops and homes
  lotLevels: { office: 2, commercial: 2, residential: 3, industrial: 3 },
  mix: { westend: [0.3, 0.55, 0.15, 0], civic: [0.35, 0.3, 0.35, 0], inner: [0.75, 0.2, 0.05, 0] },
  rect: [-72, -54, 144, 105],
  margin: 24,
  rivers: [{ name: 'the Seine', pts: [
    [48.760, 2.398, 4.5], [48.790, 2.396, 4.5], [48.815, 2.397, 4.5], [48.8275, 2.3880, 4.5], [48.8380, 2.3730, 4.5],
    // round the Île de la Cité: eleven tiles wide, three-tile arms either side of a five-tile island
    [48.8465, 2.3614, 5], [48.8503, 2.3571, 7], [48.8535, 2.3493, 11], [48.8548, 2.3415, 11], [48.8600, 2.3318, 5],
    [48.8619, 2.3181, 4.5], [48.8619, 2.3064, 4.5], [48.8600, 2.2935, 4.5], [48.8545, 2.2850, 4.5],
    [48.8460, 2.2755, 4.5], [48.8375, 2.2660, 4.5], [48.8285, 2.2560, 4.5], [48.8255, 2.2400, 4.5], [48.8340, 2.2245, 4.5],
    [48.8510, 2.2190, 4.5], [48.8700, 2.2300, 4.5], [48.8855, 2.2560, 4.5], [48.8990, 2.2720, 4.5], [48.9100, 2.2930, 4.5],
    [48.9180, 2.3160, 4.5], [48.9285, 2.3350, 4.5], [48.9500, 2.3420, 4.5], [48.9750, 2.3450, 4.5],
  ] }],
  // the Île de la Cité, drawn back as land in the Seine: Notre-Dame at its east end, the Pont Neuf over its west tip
  lands: [{ name: 'Île de la Cité', poly: [[48.8574, 2.3376], [48.8568, 2.3474], [48.8548, 2.3551], [48.8529, 2.3571], [48.8510, 2.3551], [48.8510, 2.3474], [48.8529, 2.3396], [48.8555, 2.3366]] }],
  bridges: [
    { name: 'Pont des Arts', at: [48.8592, 2.3333], ns: true, style: 'Girder' },
    { name: 'Pont Neuf', at: [48.8582, 2.3410], ns: true, style: 'Arch' },
    { name: 'Pont Neuf (south arm)', at: [48.8555, 2.3405], ns: true, style: 'Arch' },
    { name: 'Pont d\'Arcole', at: [48.8562, 2.3505], ns: true, style: 'Arch' },
    { name: 'Petit-Pont', at: [48.8518, 2.3475], ns: true, style: 'Arch' },
    { name: 'Pont de la Concorde', at: [48.8635, 2.3205], ns: true, style: 'Arch' },
    { name: 'Pont Alexandre III', at: [48.8639, 2.3135], ns: true, style: 'Arch' },
    { name: 'Pont d\'Iéna', at: [48.8601, 2.2932], ns: true, style: 'Arch' },
    { name: 'Pont Mirabeau', at: [48.8466, 2.2758], style: 'Arch' },
    { name: 'Pont du Garigliano', at: [48.8380, 2.2665], style: 'Girder' },
    { name: 'Pont de Sèvres', at: [48.8270, 2.2300], style: 'Girder' },
    { name: 'Pont de Saint-Cloud', at: [48.8470, 2.2200], style: 'Girder' },
    { name: 'Pont de Suresnes', at: [48.8700, 2.2300], style: 'Girder' },
    { name: 'Pont de Neuilly', at: [48.8855, 2.2585], style: 'Arch' },
    { name: 'Pont de Levallois', at: [48.8990, 2.2730], style: 'Girder' },
    { name: 'Pont de Clichy', at: [48.9110, 2.2950], style: 'Girder' },
    { name: 'Pont de Saint-Ouen', at: [48.9230, 2.3250], style: 'Girder' },
    { name: 'Pont de Bercy', at: [48.8380, 2.3760], style: 'Arch' },
    { name: 'Pont National', at: [48.8270, 2.3880], style: 'Arch' },
    { name: 'Pont d\'Ivry', at: [48.8100, 2.3970], style: 'Girder' },
  ],
  places: [
    { name: 'the Louvre', at: [48.8620, 2.3390], c: 'westend', reach: 0.8 },
    { name: 'the Opéra', at: [48.8710, 2.3320], c: 'westend' },
    { name: 'the Champs-Élysées', at: [48.8700, 2.3070], c: 'westend', reach: 0.9 },
    { name: 'the Faubourg Saint-Honoré', at: [48.8735, 2.3150], c: 'civic', reach: 0.7 },
    { name: 'Île de la Cité', at: [48.8545, 2.3460], c: 'civic', reach: 0.4 },
    { name: 'the Invalides', at: [48.8560, 2.3125], c: 'civic', reach: 0.8 },
    { name: 'the Marais', at: [48.8580, 2.3590], c: 'inner' },
    { name: 'Saint-Germain-des-Prés', at: [48.8540, 2.3330], c: 'inner', reach: 0.8 },
    { name: 'the Latin Quarter', at: [48.8480, 2.3450], c: 'inner', reach: 0.9 },
    { name: 'Montparnasse', at: [48.8420, 2.3220], c: 'inner' },
    { name: 'Grenelle', at: [48.8480, 2.2950], c: 'inner' },
    { name: 'Passy', at: [48.8580, 2.2800], c: 'inner' },
    { name: 'Auteuil', at: [48.8470, 2.2620], c: 'outer' },
    { name: 'the Batignolles', at: [48.8850, 2.3170], c: 'inner' },
    { name: 'Montmartre', at: [48.8870, 2.3400], c: 'inner' },
    { name: 'the Goutte d\'Or', at: [48.8870, 2.3540], c: 'inner', reach: 0.8 },
    { name: 'Gare du Nord', at: [48.8790, 2.3540], c: 'inner', reach: 0.7 },
    { name: 'Belleville', at: [48.8720, 2.3820], c: 'inner' },
    { name: 'the Bastille', at: [48.8540, 2.3720], c: 'inner' },
    { name: 'Nation', at: [48.8480, 2.3960], c: 'outer' },
    { name: 'Bercy', at: [48.8370, 2.3850], c: 'westend', reach: 0.6 },
    { name: 'the 13th', at: [48.8300, 2.3600], c: 'inner' },
    { name: 'Montrouge', at: [48.8180, 2.3200], c: 'outer' },
    { name: 'Vanves and Malakoff', at: [48.8210, 2.2900], c: 'outer' },
    { name: 'Issy-les-Moulineaux', at: [48.8250, 2.2650], c: 'industry', reach: 0.7 },
    { name: 'Boulogne-Billancourt', at: [48.8370, 2.2450], c: 'outer' },
    { name: 'Meudon', at: [48.8150, 2.2350], c: 'suburb' },
    { name: 'Saint-Cloud', at: [48.8450, 2.2050], c: 'suburb' },
    { name: 'Suresnes', at: [48.8700, 2.2150], c: 'suburb' },
    { name: 'La Défense', at: [48.8920, 2.2390], c: 'city', reach: 0.7 },
    { name: 'Courbevoie', at: [48.9000, 2.2550], c: 'outer' },
    { name: 'Neuilly-sur-Seine', at: [48.8840, 2.2690], c: 'suburb' },
    { name: 'Levallois-Perret', at: [48.8950, 2.2880], c: 'outer' },
    { name: 'Asnières', at: [48.9180, 2.2850], c: 'outer' },
    { name: 'Gennevilliers', at: [48.9230, 2.3050], c: 'industry' },
    { name: 'Clichy', at: [48.9040, 2.3080], c: 'outer' },
    { name: 'Saint-Ouen', at: [48.9100, 2.3350], c: 'industry' },
    { name: 'Saint-Denis', at: [48.9200, 2.3600], c: 'outer' },
    { name: 'La Plaine', at: [48.9100, 2.3700], c: 'industry' },
    { name: 'Aubervilliers', at: [48.9100, 2.3900], c: 'industry' },
    { name: 'Pantin', at: [48.8930, 2.4100], c: 'outer' },
    { name: 'La Villette', at: [48.8930, 2.3880], c: 'outer', reach: 0.7 },
    { name: 'Montreuil', at: [48.8620, 2.4400], c: 'outer' },
    { name: 'Bagnolet', at: [48.8700, 2.4200], c: 'outer' },
    { name: 'Vincennes', at: [48.8480, 2.4350], c: 'suburb' },
    { name: 'Charenton', at: [48.8220, 2.4150], c: 'suburb' },
    { name: 'Maisons-Alfort', at: [48.8050, 2.4300], c: 'suburb' },
    { name: 'Ivry-sur-Seine', at: [48.8100, 2.3800], c: 'industry' },
    { name: 'Gentilly', at: [48.8150, 2.3450], c: 'outer' },
  ],
  parks: [
    { name: 'the Tuileries', box: [48.8655, 2.3220, 48.8620, 2.3320] },
    { name: 'the Champ de Mars', box: [48.8575, 2.2950, 48.8525, 2.3040] },
    { name: 'the Luxembourg', box: [48.8490, 2.3330, 48.8445, 2.3405] },
    { name: 'the Bois de Boulogne', box: [48.8760, 2.2420, 48.8470, 2.2700], heath: true },
    { name: 'the Bois de Vincennes', box: [48.8440, 2.4250, 48.8280, 2.4700], heath: true },
    { name: 'the Buttes-Chaumont', box: [48.8825, 2.3790, 48.8780, 2.3870] },
    { name: 'the Parc de la Villette', box: [48.8950, 2.3880, 48.8890, 2.3960] },
    { name: 'the Jardin des Plantes', box: [48.8445, 2.3565, 48.8410, 2.3625] },
    { name: 'the Parc Montsouris', box: [48.8240, 2.3340, 48.8200, 2.3410] },
    { name: 'the Parc Monceau', box: [48.8805, 2.3060, 48.8780, 2.3110] },
    { name: 'the Parc de Saint-Cloud', box: [48.8450, 2.2050, 48.8300, 2.2200], heath: true },
  ],
  rails: [
    // north from Gare du Nord through La Chapelle and La Plaine to the Stade de France
    { id: 'nord', name: 'Ligne du Nord', pts: [[48.8800, 2.3555], [48.9200, 2.3555]] },
    // east from Gare de Lyon past Bercy, then south on the right bank to Maisons-Alfort
    { id: 'sud-est', name: 'Ligne Paris–Lyon', pts: [[48.8450, 2.3760], [48.8450, 2.4060], [48.7980, 2.4060]] },
  ],
  arterials: [
    // the historic axis: La Défense over the Pont de Neuilly, the Avenue de la Grande Armée to the Étoile, the
    // Champs-Élysées to the Concorde, the Rue de Rivoli past the Louvre and the Hôtel de Ville to the Bastille, and the
    // Faubourg Saint-Antoine to Nation and Vincennes
    { name: 'the Avenue de la Grande Armée', label: 'Avenue de la Grande Armée', side: 1, pts: [[48.8920, 2.2330], [48.8855, 2.2600], [48.8780, 2.2830], [48.8738, 2.2840], [48.8738, 2.2950]] },
    { name: 'the Champs-Élysées', label: 'Avenue des Champs-Élysées', side: 1, pts: [[48.8738, 2.2950], [48.8738, 2.3060], [48.8670, 2.3212]] },
    { name: 'the Rue de Rivoli', label: 'Rue de Rivoli', side: 1, pts: [[48.8670, 2.3212], [48.8650, 2.3376], [48.8630, 2.3522], [48.8590, 2.3600], [48.8590, 2.3691]] },
    { name: 'the Faubourg Saint-Antoine', label: 'Rue du Faubourg Saint-Antoine', side: 1, pts: [[48.8590, 2.3691], [48.8590, 2.3810], [48.8483, 2.3958], [48.8475, 2.4330]] },
    // the Grands Boulevards from the Madeleine past the Opéra to République, and on to the Bastille
    { name: 'the Grands Boulevards', label: 'Grands Boulevards', side: 1, pts: [
      [48.8700, 2.3245], [48.8712, 2.3320], [48.8705, 2.3480], [48.8695, 2.3540], [48.8675, 2.3637], [48.8675, 2.3691], [48.8590, 2.3691],
    ] },
    // north to south through the middle: the Boulevard de Strasbourg and Sébastopol to Châtelet, over the islands, the
    // Boulevard Saint-Michel past the Luxembourg, Denfert-Rochereau and the Porte d'Orléans
    { name: 'the Boulevard de Sébastopol and the Boulevard Saint-Michel', label: 'Boulevard de Sébastopol', pts: [
      [48.8990, 2.3600], [48.8760, 2.3590], [48.8640, 2.3520], [48.8590, 2.3470], [48.8530, 2.3440], [48.8460, 2.3400],
      [48.8340, 2.3325], [48.8230, 2.3255], [48.7900, 2.3255],
    ] },
    // the left bank's boulevard, from the Concorde's bridge past Saint-Germain to the Pont de Sully
    { name: 'the Boulevard Saint-Germain', label: 'Boulevard Saint-Germain', pts: [[48.8615, 2.3195], [48.8575, 2.3250], [48.8535, 2.3335], [48.8505, 2.3480], [48.8490, 2.3590]] },
    // from the Trocadéro up the Avenue Kléber to the Étoile and on as the Avenue de Wagram to the Place de Clichy
    { name: 'the Avenue Kléber and the Avenue de Wagram', label: 'Avenue Kléber', pts: [[48.8628, 2.2875], [48.8660, 2.2950], [48.8810, 2.2950], [48.8835, 2.3275], [48.8840, 2.3500]] },
    // the Périphérique, drawn as an avenue ring (a motorway would need an interchange at every one of its portes)
    { name: 'the Périphérique', label: 'Boulevard Périphérique', pts: [
      [48.8810, 2.2760], [48.8870, 2.2930], [48.8940, 2.3140], [48.8980, 2.3590], [48.8970, 2.3860], [48.8640, 2.4090], [48.8470, 2.4100],
      [48.8290, 2.3990], [48.8190, 2.3600], [48.8230, 2.3255], [48.8320, 2.2870], [48.8380, 2.2600], [48.8480, 2.2550],
      [48.8720, 2.2760], [48.8810, 2.2760],
    ] },
    // the left bank's long avenue from the Invalides to Montparnasse and the 13th
    { name: 'the Boulevard du Montparnasse', label: 'Boulevard du Montparnasse', pts: [[48.8560, 2.3125], [48.8460, 2.3150], [48.8420, 2.3245], [48.8380, 2.3500], [48.8330, 2.3700]] },
  ],
  roundabouts: [
    { id: 'etoile', name: 'The Étoile', at: [48.8738, 2.2950], blurb: 'The Étoile, where the Champs-Élysées comes up from the Concorde and goes on as the Avenue de la Grande Armée to La Défense, and the Avenue Kléber crosses on its way from the Trocadéro to the Avenue de Wagram: a 5×5 two-lane roundabout, the Arc de Triomphe beside it. (The real place is a ring of twelve avenues round the Arc itself; a roundabout\'s island here is planted, so the Arc stands at its edge, facing the Champs-Élysées.)' },
    { id: 'bastille', name: 'The Bastille', at: [48.8590, 2.3691], blurb: 'The Place de la Bastille: the Rue de Rivoli comes in from the Hôtel de Ville and leaves as the Faubourg Saint-Antoine, and the Grands Boulevards end here, round a two-lane roundabout (a few hundred metres north of the real one: the Seine is drawn wider than it is).' },
  ],
  districts: [
    // La Défense is its own district, the one part of the map that grows towers
    { id: 'la-defense', name: 'La Défense', colour: 0x4bacc6, poly: [[48.8990, 2.2250], [48.8990, 2.2560], [48.8850, 2.2560], [48.8850, 2.2250]] },
    { id: 'centre', name: 'Paris Centre (Rive Droite)', colour: 0xc0504d, lowRise: true, poly: [[48.8830, 2.2960], [48.8830, 2.3640], [48.8530, 2.3700], [48.8510, 2.3560], [48.8550, 2.3380], [48.8640, 2.3200], [48.8620, 2.2990], [48.8720, 2.2930]] },
    { id: 'rive-gauche', name: 'Rive Gauche', colour: 0x4f81bd, lowRise: true, poly: [[48.8640, 2.2700], [48.8640, 2.3200], [48.8520, 2.3500], [48.8410, 2.3780], [48.8150, 2.3900], [48.8000, 2.3300], [48.8150, 2.2600]] },
    { id: 'montmartre', name: 'Montmartre and the North', colour: 0x9bbb59, lowRise: true, poly: [[48.8830, 2.2900], [48.9400, 2.2900], [48.9400, 2.3800], [48.8830, 2.3800]] },
    { id: 'est', name: 'The East', colour: 0x8064a2, lowRise: true, poly: [[48.8830, 2.3640], [48.9400, 2.3800], [48.9400, 2.5000], [48.7800, 2.5000], [48.7800, 2.4000], [48.8410, 2.3780], [48.8530, 2.3700]] },
    { id: 'ouest', name: 'The West', colour: 0xf79646, lowRise: true, poly: [[48.9400, 2.1500], [48.9400, 2.2900], [48.8830, 2.2900], [48.8720, 2.2930], [48.8620, 2.2990], [48.8640, 2.2700], [48.8150, 2.2600], [48.7800, 2.2600], [48.7800, 2.1500]] },
  ],
  seaGates: [{ name: 'the lower Seine', at: [48.9500, 2.3420], low: true }, { name: 'the upper Seine', at: [48.7600, 2.3980], low: true }],
  structures: [
    // buildings/landmarks-paris.ts: Notre-Dame on the island, the Louvre by the Tuileries, the Opéra, the Arc at the
    // Étoile, the Tower on the Champ de Mars facing the Trocadéro, the Sacré-Cœur on Montmartre at dusk
    { id: 'notre-dame', kind: 'notre-dame', at: [48.8530, 2.3499], side: 'W', on: [48.8545, 2.3460] },
    { id: 'louvre', kind: 'louvre', at: [48.8608, 2.3360], side: 'S' },
    { id: 'opera-garnier', kind: 'opera-garnier', at: [48.8720, 2.3316], side: 'S' },
    { id: 'arc-de-triomphe', kind: 'arc-de-triomphe', at: [48.8738, 2.2950], side: 'E' },
    { id: 'eiffel-tower', kind: 'eiffel-tower', at: [48.8584, 2.2945], side: 'N', aside: 0.3 },
    { id: 'sacre-coeur', kind: 'sacre-coeur', at: [48.8867, 2.3431], side: 'S', hour: 19.6 },
    // the Stade de France at Saint-Denis, the Parc des Princes by the Bois de Boulogne
    { id: 'stade-de-france', kind: 'stadium', at: [48.9230, 2.3640], side: 'W', name: 'Stade de France' },
    { id: 'parc-des-princes', kind: 'stadium', at: [48.8414, 2.2530], side: 'E', name: 'Parc des Princes' },
    { id: 'pompidou', kind: 'museum', at: [48.8606, 2.3522], side: 'W', name: 'Centre Pompidou' },
    { id: 'pitie-salpetriere', kind: 'general-hospital', at: [48.8380, 2.3640], side: 'N', name: 'La Pitié-Salpêtrière' },
    { id: 'bus-depot-lagny', kind: 'bus-depot', at: [48.8470, 2.4080], side: 'N', name: 'Dépôt de Lagny' },
  ],
  venues: [
    { id: 'comedie-francaise', kind: 'theatre', at: [48.8634, 2.3363], side: 'S', name: 'Comédie-Française' },
  ],
  stations: [
    { id: 'gare-du-nord', name: 'Gare du Nord', rail: 'nord', at: [48.8809, 2.3553] },
    { id: 'stade-de-france-station', name: 'Stade de France–Saint-Denis', rail: 'nord', at: [48.9180, 2.3555] },
    { id: 'gare-de-lyon', name: 'Gare de Lyon', rail: 'sud-est', at: [48.8443, 2.3730] },
    { id: 'maisons-alfort', name: 'Maisons-Alfort', rail: 'sud-est', at: [48.8050, 2.4060] },
  ],
  railLines: [
    { id: 'line-nord', number: 1, colour: 0x8f2b8f, stations: ['gare-du-nord', 'stade-de-france-station'], vehicles: 1 },
    { id: 'line-sud-est', number: 2, colour: 0x2f6db5, stations: ['gare-de-lyon', 'maisons-alfort'], vehicles: 1 },
  ],
  metro: [
    { id: 'line-metro-1', name: 'Ligne 1', number: 1, colour: 0xffcd00, trains: 6, stops: [
      ['La Défense', [48.8919, 2.2380], 'hall'], ['Pont de Neuilly', [48.8855, 2.2584]], ['Porte Maillot', [48.8778, 2.2822]],
      ['Charles de Gaulle–Étoile', [48.8738, 2.2950]], ['Franklin D. Roosevelt', [48.8690, 2.3096]], ['Concorde', [48.8656, 2.3212]],
      ['Palais Royal–Musée du Louvre', [48.8625, 2.3364]], ['Châtelet', [48.8586, 2.3470], 'hall'], ['Bastille', [48.8531, 2.3691], 'hall'],
    ] },
    { id: 'line-metro-4', name: 'Ligne 4', number: 4, colour: 0xbe418d, trains: 6, stops: [
      ['Porte de Clignancourt', [48.8975, 2.3445], 'hall'], ['Barbès–Rochechouart', [48.8838, 2.3497]], ['Gare du Nord', 'gare-du-nord'],
      ['Strasbourg–Saint-Denis', [48.8696, 2.3536]], ['Châtelet', [48.8586, 2.3470], 'hall'], ['Saint-Germain-des-Prés', [48.8539, 2.3336]],
      ['Montparnasse–Bienvenüe', [48.8433, 2.3245], 'hall'], ['Denfert-Rochereau', [48.8336, 2.3324]], ['Porte d\'Orléans', [48.8233, 2.3254], 'hall'],
    ] },
  ],
  buses: [
    { id: 'line-bus-69', number: 69, colour: 0x3a7d44, loop: false, vehicles: 4, stops: [
      ['stop-69-champ-de-mars', 48.8560, 2.3010, 'N'], ['stop-69-invalides', 48.8580, 2.3130, 'N'], ['stop-69-solferino', 48.8585, 2.3230, 'N'],
      ['stop-69-louvre', 48.8620, 2.3420, 'S'], ['stop-69-hotel-de-ville', 48.8580, 2.3560, 'S'], ['stop-69-bastille', 48.8555, 2.3700, 'S'],
      ['stop-69-pere-lachaise', 48.8615, 2.3930, 'S'],
    ] },
  ],
  harbours: [
    { id: 'pier-tour-eiffel', kind: 'ferry-pier', at: [48.8605, 2.2920], name: 'Tour Eiffel' },
    { id: 'pier-champs-elysees', kind: 'ferry-pier', at: [48.8640, 2.3110], name: 'Champs-Élysées' },
    { id: 'pier-louvre', kind: 'ferry-pier', at: [48.8600, 2.3320], name: 'Louvre' },
    { id: 'pier-jardin-des-plantes', kind: 'ferry-pier', at: [48.8460, 2.3630], name: 'Jardin des Plantes' },
  ],
  ferries: [{ id: 'line-batobus', number: 1, name: 'Batobus', colour: 0x2b5f9e, vehicles: 3, piers: ['pier-tour-eiffel', 'pier-champs-elysees', 'pier-louvre', 'pier-jardin-des-plantes'] }],
  areas: [
    { id: 'area-ile-de-la-cite', name: 'Île de la Cité', at: [48.8545, 2.3460], kind: 'office', blurb: 'The island in the Seine where Paris began: Notre-Dame at its east end, the Pont Neuf over its western tip to both banks. Every road on to it is a bridge.' },
    { id: 'area-louvre', name: 'The Louvre and the Tuileries', at: [48.8620, 2.3330], kind: 'commercial', blurb: 'The right bank\'s grand centre: the Louvre on the Rue de Rivoli, the Tuileries gardens down to the Concorde, shops and the Comédie-Française round the Palais-Royal, the Pont des Arts over to the Institut.' },
    { id: 'area-opera', name: 'The Opéra and the Grands Boulevards', at: [48.8710, 2.3350], kind: 'commercial', blurb: 'The Opéra Garnier at the head of its avenue, the department stores behind it and the Grands Boulevards running east to République: avenues of shops and theatres, the busiest of the right bank.' },
    { id: 'area-marais', name: 'The Marais', at: [48.8580, 2.3600], kind: 'residential', blurb: 'Old streets of homes and shops between the Hôtel de Ville and the Bastille, on the finest grain of streets in town.' },
    { id: 'area-latin-quarter', name: 'The Latin Quarter and Saint-Germain', at: [48.8500, 2.3400], kind: 'residential', blurb: 'The left bank opposite the islands: the Boulevard Saint-Michel up past the Luxembourg, the Boulevard Saint-Germain, dense homes, cafés and bookshops.' },
    { id: 'area-la-defense', name: 'La Défense', at: [48.8910, 2.2400], kind: 'office', blurb: 'The business district beyond the Pont de Neuilly at the end of the historic axis from the Louvre: towers and headquarters on merged lots, the biggest employer west of the city, and the western end of Métro line 1.' },
    { id: 'area-montmartre', name: 'Montmartre', at: [48.8860, 2.3400], kind: 'residential', blurb: 'The village on the hill north of the boulevards, the Sacré-Cœur at its top: terraces of homes, the Goutte d\'Or to the east and Gare du Nord below. (The town has no hills: Montmartre is as flat as the rest.)' },
    { id: 'area-belleville', name: 'Belleville and the East', at: [48.8700, 2.3850], kind: 'residential', blurb: 'The east of the city: homes from Belleville to Nation, the Buttes-Chaumont and the Père-Lachaise, Montreuil and Vincennes beyond the Périphérique.' },
    { id: 'area-saint-denis', name: 'Saint-Denis and La Plaine', at: [48.9120, 2.3650], kind: 'industrial', blurb: 'North of the Périphérique: the works and depots of La Plaine and Aubervilliers, and the line from Gare du Nord to the Stade de France.' },
  ],
  spots: [
    { id: 'seine', spot: 'river', name: 'The Seine at the islands', at: [48.8550, 2.3450], size: 20, blurb: 'The Seine divides round the Île de la Cité: two arms of three tiles either side of the island, each crossed by its bridges, rejoining below the Pont Neuf. Drawn three or four times its real width, so it holds the Batobus\'s piers and keeps a channel for the boats past them.' },
  ],
  words: {
    areas: 'The Louvre, the Opéra and the Champs-Élysées shops and offices, the Île de la Cité, the Marais, the Latin Quarter and Saint-Germain dense homes, La Défense towers, Montmartre and the east homes, Saint-Denis and La Plaine works, each group of arrondissements its own owner, La Défense one of its own: the rest of Paris is held to mid-rise, as the real city is.',
    landmarks: 'Notre-Dame, the Louvre, the Opéra Garnier, the Arc de Triomphe, the Eiffel Tower and the Sacré-Cœur where the real ones stand, the Stade de France and the Parc des Princes, and the bridges of the Seine from the Pont Neuf to the Pont Alexandre III.',
    transit: 'Gare du Nord with a line to the Stade de France and Gare de Lyon with one to Maisons-Alfort, Métro line 1 from La Défense to the Bastille and line 4 from the Porte de Clignancourt to the Porte d\'Orléans, the 69 bus from the Champ de Mars to the Père-Lachaise and the Batobus on the Seine.',
    roads: 'The historic axis from La Défense up the Champs-Élysées and along the Rue de Rivoli, the Grands Boulevards, Sébastopol and Saint-Michel, Saint-Germain, Montparnasse and the Périphérique as avenues, with two-lane roundabouts at the Étoile and the Bastille.',
  },
};

/** Tour order: the islands, the right bank's grand centre west to the Étoile and the Tower, Montmartre at dusk, the river. */
export const PARIS_TOUR: string[] = [
  'welcome',
  'area-ile-de-la-cite', 'notre-dame', 'seine', 'bridge-pont-neuf',
  'area-louvre', 'louvre', 'comedie-francaise', 'bridge-pont-des-arts', 'line-metro-1', 'metro-line-metro-1-chatelet',
  'area-opera', 'opera-garnier', 'area-marais', 'pompidou', 'bastille', 'line-bus-69',
  'bridge-pont-de-la-concorde', 'bridge-pont-alexandre-iii', 'etoile', 'arc-de-triomphe', 'area-la-defense',
  'bridge-pont-d-iena', 'eiffel-tower', 'parc-des-princes',
  'area-latin-quarter', 'line-metro-4', 'pitie-salpetriere',
  'area-montmartre', 'sacre-coeur', 'gare-du-nord', 'track-nord', 'line-nord', 'stade-de-france', 'area-saint-denis',
  'area-belleville', 'bus-depot-lagny', 'gare-de-lyon', 'line-sud-est',
  'pier-tour-eiffel', 'line-batobus', 'pier-louvre', 'pier-jardin-des-plantes',
];
/** The welcome stop (and the hero image): from over Auteuil north-east past the Eiffel Tower and up the Seine to the islands, mid-morning. */
export const PARIS_VIEW: Pick<TourStop, 'focus' | 'dist' | 'yaw' | 'pitch'> = { focus: [-12, -2], dist: 60, yaw: -0.698, pitch: 0.524 };
