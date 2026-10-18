import { hash2 } from './noise';
import { mod } from './coords';
import { MANIFEST } from './buildings/compiled';

/**
 * Education (docs/education.md): qualification levels, study stages, the tunables, and the pure helpers both sides use.
 * One game week is one year of age and one school year (LIFE.daysPerYear 7 in server/src/sim/life.ts): Monday to
 * Friday are school days, Saturday is results day, and everyone moves up a year at Monday 00:00.
 */

/** The highest qualification completed. Values are ordered: a higher level includes the lower ones. */
export const EduLevel = { None: 0, Primary: 1, Secondary: 2, Further: 3, Degree: 4, Postgrad: 5 } as const;
export const EDU_LEVEL_NAMES = ['no qualifications', 'primary', 'GCSEs', 'A-levels or Level 3', 'degree', 'postgraduate'] as const;
/** Short names for charts and table cells. */
export const EDU_LEVEL_SHORT = ['none', 'primary', 'secondary', 'further', 'degree', 'postgrad'] as const;

/** Chosen at 16: sixth form leads to STEM or arts and business, FE college to trades. A degree keeps its track. */
export const EduTrack = { None: 0, Stem: 1, Arts: 2, Trades: 3 } as const;
export const EDU_TRACK_NAMES = ['', 'STEM', 'arts and business', 'trades'] as const;

/**
 * The stage a citizen is enrolled in (`Citizen.study`), and the `stage` attribute of an education kind.
 * Sixth form (4) covers every 16-18 course: at a sixth-form college (A-levels, tracks 1-2) or at an FE college
 * (vocational Level 3, track 3). FeCourse (5) is the full-time adult course for the unemployed.
 */
export const Study = { None: 0, Nursery: 1, Primary: 2, Secondary: 3, SixthForm: 4, FeCourse: 5, Degree: 6, Postgrad: 7, Evening: 8 } as const;
export const STUDY_NAMES = ['', 'nursery', 'primary school', 'secondary school', 'sixth form', 'FE course', 'degree', 'postgraduate', 'evening class'] as const;

/** How a stage ended, in the education log. */
export const EduResult = { Passed: 0, Failed: 1, DroppedOut: 2, Left: 3 } as const;
export const EDU_RESULT_NAMES = ['passed', 'failed', 'dropped out', 'left'] as const;

/** `Citizen.eduBits` */
export const EDU_NURSERY = 1;
export const EDU_DROPPED = 2;
/** transient (server/src/sim/schools.ts): on the way home from school, so CITIZEN_STUDY marks only school trips */
export const EDU_HOMEWARD = 4;

export interface StageSpec {
  /** usual ages [from, to): the starting age and the leaving age; adult courses have no upper age (99) */
  ages: [number, number];
  /** school years (= game weeks); 0 for adult courses, which run on attended days instead */
  years: number;
  /** school days held over the whole stage (5 a year); adult courses: days attended to finish */
  days: number;
  /** the level a pass gives; adult courses give one level up, capped here */
  earns: number;
  /** chance a leaver with enough attendance passes, before school quality and bonuses */
  pass: number;
}

/** Indexed by Study. Nursery earns no level: it sets EDU_NURSERY, which raises the primary pass chance. */
export const STAGES: readonly StageSpec[] = [
  { ages: [0, 0], years: 0, days: 0, earns: EduLevel.None, pass: 0 },
  { ages: [3, 4], years: 1, days: 5, earns: EduLevel.None, pass: 1 },
  { ages: [4, 11], years: 7, days: 35, earns: EduLevel.Primary, pass: 0.97 },
  { ages: [11, 16], years: 5, days: 25, earns: EduLevel.Secondary, pass: 0.8 },
  { ages: [16, 18], years: 2, days: 10, earns: EduLevel.Further, pass: 0.85 },
  { ages: [19, 99], years: 0, days: 4, earns: EduLevel.Further, pass: 0.9 },
  { ages: [18, 99], years: 3, days: 15, earns: EduLevel.Degree, pass: 0.9 },
  { ages: [21, 99], years: 1, days: 5, earns: EduLevel.Postgrad, pass: 0.85 },
  { ages: [19, 99], years: 0, days: 6, earns: EduLevel.Secondary, pass: 0.9 },
];

/** Education tunables, in one place (docs/education.md section 8). */
export const EDU = {
  /** adults' levels (newcomers, citizens of worlds saved before education), roughly England 25-64, indexed by EduLevel */
  baseMix: [0.06, 0.02, 0.22, 0.27, 0.30, 0.13],
  /** tracks of adults with `further`, and of graduates, indexed by EduTrack (None unused) */
  trackFurther: [0, 0.35, 0.35, 0.30],
  trackDegree: [0, 0.5, 0.45, 0.05],
  /** nobody holds a degree before this age (3 years from 18), so newcomers aged 18-21 have `further` at most */
  degreeAge: 22,
  /** a leaver must have attended this share of the school days held; below dropOutBelow at day's end, 16+ may drop out */
  minAttend: 0.6, dropOutBelow: 0.4,
  /** pass chance bonuses: went to nursery, free school meals */
  nurseryBonus: 0.05, mealsBonus: 0.05,
  /** wage multiplier for a worker in a skilled place, by EduLevel, and for a track that fits the workplace */
  wage: [0.9, 0.95, 1.0, 1.1, 1.25, 1.4], trackMatch: 1.1,
  /** a newcomer's level comes from the city's open skilled vacancies with this chance, else from baseMix (E4) */
  match: 0.6,
  /** leaving chance multiplier for a graduate out of work or over-qualified for drainDays (E4) */
  drainMul: 3, drainDays: 2,
  /** share of newcomers who arrive as a family with 1-3 children aged 0-15 (E5) */
  familyShare: 0.2,
  /** the education log keeps this many finished stages */
  logMax: 6,
  // ---- the schools simulation (E3, server/src/sim/schools.ts) ----
  /** each school hashes its day: the bell between these hours (organic, so the school run is not one tick) */
  startFrom: 8.5, startSpan: 0.5, endFrom: 15, endSpan: 0.5,
  /** university lectures: a start between these hours, then lectureHours (each student hashes their own) */
  lectureFrom: 9, lectureSpan: 2, lectureHours: 5,
  /** a pupil's own bell jitter, ± hours, so a family's children do not all leave on one tick */
  pupilJitter: 0.08,
  /** under this age a pupil is taken to school and collected (CHILD_OUT_AGE in simulation.ts) */
  escortAge: 8,
  /** a household driver leaving for work this soon after the child is due takes them (carpool drop-off) */
  liftWait: 0.75,
  /** an older sibling at the same school due within this many hours walks them in */
  siblingWindow: 0.5,
  /** a working parent due out within this many hours does the drop-off on the way to work */
  onTheWay: 1.5,
  /** an under-8 may go in with a parent leaving for work up to this many hours before the child's own time (breakfast club) */
  breakfastClub: 1.5,
  /** a grown-up is free to walk a child in if their own shift is at least this many hours off */
  freeFor: 3,
  /** a school's quality is 1 - qualityDrop × the share of the teachers it is short of (pass chance multiplier, 0.5-1) */
  qualityDrop: 0.5,
  /** smoothing of a school's staffing over the year: each day moves this share toward today's */
  qualityDays: 0.25,
  /** school leavers with A-levels or Level 3 who go on to a university in town, and graduates who stay on for a master's */
  uniShare: 0.45, postgradTake: 0.2,
  /** sixth-formers and students below EDU.dropOutBelow drop out with this chance a day, once a few days have been held */
  dropOutPerDay: 0.15, dropOutAfter: 3,
} as const;

/**
 * An education kind's school as the simulation reads it (the `attrs` of shared/src/buildings/education.ts, docs/education.md
 * "Built in E2"). `stage` is the Study a pupil there holds; the FE college (stage FeCourse) also takes 16-18s as SixthForm.
 */
export interface SchoolSpec {
  kind: number; stage: number;
  /** day places, and evening places (FE college) */
  places: number; evening: number;
  /** Manhattan tiles from home to the door within which children are admitted; 0 = the whole city */
  catchment: number;
  ages: [number, number];
  /** share of the staff who must hold a degree, and of those a postgraduate degree (university, research institute) */
  teachersShare: number; postgradShare: number;
  beds: number;
}
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** By kind id: every education kind (101-108 and any later rung) and every landmark that works as a school (London's universities, 111-114), undefined for everything else. */
export const SCHOOL_SPECS: (SchoolSpec | undefined)[] = [];
for (const k of MANIFEST) {
  const a = k.levels[0]?.attrs ?? k.attrs;
  if (k.group !== 'education' && !(k.landmark && typeof a.stage === 'number')) continue;
  const ages = Array.isArray(a.ages) && a.ages.length === 2 ? [num(a.ages[0], 0), num(a.ages[1], 99)] as [number, number] : [18, 99] as [number, number];
  SCHOOL_SPECS[k.kindId] = {
    kind: k.kindId, stage: num(a.stage, 0), places: num(a.pupilCapacity, 0), evening: num(a.eveningPlaces, 0), catchment: num(a.catchment, 0),
    ages, teachersShare: num(a.teachersShare, 0), postgradShare: num(a.postgradShare, 0), beds: num(a.beds, 0),
  };
}
export const schoolSpec = (kind: number): SchoolSpec | undefined => SCHOOL_SPECS[kind];
/** The Study a school stage admits a child of this age to (by age at the start of the school year), or None. */
export function studyForAge(age: number): number {
  return age < 3 ? Study.None : age < 4 ? Study.Nursery : age < 11 ? Study.Primary : age < 16 ? Study.Secondary : age < 18 ? Study.SixthForm : Study.None;
}
/** Whether a school of this spec takes a pupil for this stage (the FE college runs sixth-form courses too). */
export const schoolTakes = (s: SchoolSpec, study: number) => s.stage === study || (study === Study.SixthForm && s.stage === Study.FeCourse)
  || (study === Study.Postgrad && s.stage === Study.Degree);

/**
 * One finished stage in the education log (`Citizen.eduLog`), oldest first: [Study, door x, door y, kind id, the
 * game week it ended (floor(day / 7)), EduResult]. A plain tuple so saves and old worlds need no migration.
 */
export type EduLogEntry = [stage: number, x: number, y: number, kind: number, week: number, result: number];

/** The education fields of a citizen (server/src/world.ts Citizen), all plain numbers, saved as they are. */
export interface EduFields {
  /** EduLevel, the highest completed */
  edu: number;
  /** EduTrack */
  track: number;
  /** Study: the stage enrolled in, 0 none */
  study: number;
  /** door tile of the place of study (while study > 0) */
  sx: number; sy: number;
  /** days attended, and school days held, in this stage so far */
  att: number; due: number;
  /** EDU_NURSERY, EDU_DROPPED */
  eduBits: number;
  eduLog: EduLogEntry[];
}

/** Pick from shares summing to 1 with u in [0, 1). */
function pick(shares: readonly number[], u: number): number {
  for (let i = 0; i < shares.length; i++) { u -= shares[i]; if (u < 0) return i; }
  return shares.length - 1;
}

/** The highest level someone of this age can hold: primary at 11, GCSEs at 16, Level 3 at 18, a degree from EDU.degreeAge. */
export function maxLevelAt(age: number): number {
  return age < 11 ? EduLevel.None : age < 16 ? EduLevel.Primary : age < 18 ? EduLevel.Secondary
    : age < EDU.degreeAge ? EduLevel.Further : EduLevel.Postgrad;
}

/**
 * The education of a citizen who never went to school here: a newcomer, or a citizen of a world saved before
 * education. Hash-seeded from the id: adults from EDU.baseMix, capped by age; children by age (everyone 11 or over
 * has left primary). Not studying anywhere: admissions (E3) enrol children.
 */
export function eduDefaults(id: number, age: number): EduFields {
  const base = pick(EDU.baseMix, hash2(id, 231));
  const cap = maxLevelAt(age);
  const edu = age < 18 ? (age < 11 ? EduLevel.None : Math.min(cap, Math.max(EduLevel.Primary, base))) : Math.min(cap, base);
  const track = edu >= EduLevel.Degree ? pick(EDU.trackDegree, hash2(id, 233))
    : edu === EduLevel.Further ? pick(EDU.trackFurther, hash2(id, 233)) : EduTrack.None;
  return { edu, track, study: Study.None, sx: 0, sy: 0, att: 0, due: 0, eduBits: 0, eduLog: [] };
}

/** Points 0-5 per level; the education index is 20 x the mean over residents aged 25-64 (0-100; baseMix gives about 62). */
export const eduIndexOf = (levelCounts: readonly number[]) => {
  let n = 0, sum = 0;
  for (let l = 0; l < levelCounts.length; l++) { n += levelCounts[l]; sum += l * levelCounts[l]; }
  return n ? (20 * sum) / n : 0;
};

/**
 * School year group at game day `day` for someone born on (fractional) game day `born`: UK rule, aged 4 at the start
 * of the school year (Monday 00:00 of this game week) is Reception (0), then Year 1 to Year 13. Negative before school.
 */
export function yearGroup(born: number, day: number, daysPerYear = 7): number {
  const weekStart = Math.floor(day / daysPerYear) * daysPerYear;
  return Math.floor((weekStart - born) / daysPerYear) - 4;
}
export const yearGroupName = (yg: number) => (yg === 0 ? 'Reception' : `Year ${yg}`);

/** A birthday is a moment of the game week, because a game week is a year: weekday (0 = Monday) and hour. */
export function birthdayOf(born: number, daysPerYear = 7): { weekday: number; hour: number } {
  const t = mod(born, daysPerYear);
  return { weekday: Math.floor(t), hour: Math.floor((t % 1) * 24) };
}

/** Append a finished stage to the log, keeping the newest EDU.logMax. */
export function logEdu(c: EduFields, entry: EduLogEntry) {
  c.eduLog.push(entry);
  if (c.eduLog.length > EDU.logMax) c.eduLog.splice(0, c.eduLog.length - EDU.logMax);
}
