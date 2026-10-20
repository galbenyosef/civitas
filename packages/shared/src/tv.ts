import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { hash2 } from './noise';
import { channelName } from './news';

/**
 * What is on television (UTD e857a19d, docs/media.md section 7): the channels and their schedules. Pure functions of
 * the channel and the clock, so everyone watching a channel sees the same programme with nothing on the wire, and the
 * citizen panel can say what someone is watching. The client draws the programmes (render/tv.ts, interiors.ts
 * SCREEN_FRAG): shader-drawn genres, teletext pages from the city's own data, and live news from the helicopter.
 *
 * Every channel has its own schedule from `hash(channel, game hour)` within each hour's genres: news at about 18:00,
 * cartoons in the afternoon, quizzes and films in the evening, the match on a stadium's event night, teletext or the
 * test card after 01:00. Priority on a set: live news (a helicopter over a story), then the advert break (adverts A6,
 * not built: a hook), then the scheduled programme, then the test card.
 */

export type Genre = 'news' | 'weather' | 'quiz' | 'match' | 'cooking' | 'nature' | 'cartoons' | 'film' | 'teletext' | 'testcard';
/** The genre's number in the screen shader (interiors.ts SCREEN_FRAG uGenre); 0 is the old generic picture. */
export const GENRE_CODE: Record<Genre, number> = { news: 1, weather: 2, quiz: 3, match: 4, cooking: 5, nature: 6, cartoons: 7, film: 8, teletext: 9, testcard: 10 };

export interface TvChannel {
  /** 'c1', 'c2', or 'p:<owner>' for a player's media channel */
  id: string;
  name: string;
  /** schedule and look */
  seed: number;
  /** the channel's colour: its logo, its news graphics */
  color: number;
  /** a player's channel: who owns it (stories with `ch` this) */
  owner?: string;
}

/** The two national channels every set gets. */
export const CIVITAS_CHANNELS: readonly TvChannel[] = [
  { id: 'c1', name: 'Civitas 1', seed: 1101, color: 0xc8463c },
  { id: 'c2', name: 'Civitas 2', seed: 2203, color: 0x2d6cdf },
];

/** A small string hash (FNV-1a), for a player channel's seed. */
export function strSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000003;
}
/** A player's media channel (docs/media.md N1): named for the owner, in their colour. */
export function playerChannel(owner: string, ownerName: string, color: number): TvChannel {
  return { id: `p:${owner}`, name: channelName(ownerName), seed: strSeed(owner), color, owner };
}

export interface Programme {
  genre: Genre;
  title: string;
  /** the hour it fills (absolute game hour: day * 24 + hour) and its ticks */
  hour: number;
  start: number; end: number;
  /** per programme: the shader's seed and pacing, the episode */
  seed: number;
}

type Slot = readonly Genre[];
/** Each hour's genres per kind of channel; 'match' is in the evening only on a match night (else skipped). */
const SCHEDULES: Record<'c1' | 'c2' | 'player', readonly Slot[]> = {
  c1: [
    ['film'], ['teletext'], ['teletext'], ['teletext'], ['teletext'], ['teletext'],
    ['news'], ['news'], ['news'], ['cooking', 'quiz', 'nature'], ['cooking', 'nature'], ['quiz', 'cooking'],
    ['news'], ['film', 'nature', 'cooking'], ['film', 'nature'], ['cartoons'], ['cartoons'], ['quiz', 'nature'],
    ['news'], ['quiz', 'nature', 'cooking'], ['match', 'film', 'quiz'], ['match', 'film', 'nature'], ['news'], ['film', 'quiz'],
  ],
  c2: [
    ['film'], ['teletext'], ['testcard'], ['testcard'], ['testcard'], ['testcard'],
    ['cartoons'], ['cartoons'], ['cartoons', 'nature'], ['nature', 'cooking'], ['nature', 'cooking'], ['quiz', 'cooking'],
    ['quiz', 'cooking'], ['nature', 'film'], ['nature', 'film'], ['cartoons'], ['cartoons'], ['cartoons', 'quiz'],
    ['quiz', 'cooking'], ['news'], ['match', 'nature', 'film'], ['match', 'film', 'quiz'], ['nature', 'film'], ['teletext'],
  ],
  player: [
    ['teletext'], ['teletext', 'testcard'], ['teletext', 'testcard'], ['testcard'], ['testcard'], ['teletext'],
    ['news', 'weather'], ['news'], ['news', 'weather'], ['cooking', 'quiz'], ['cooking', 'nature'], ['quiz', 'nature'],
    ['news'], ['nature', 'cooking'], ['film', 'nature'], ['cartoons'], ['cartoons'], ['quiz', 'cartoons'],
    ['news'], ['quiz', 'match', 'cooking'], ['match', 'film', 'quiz'], ['match', 'film', 'nature'], ['news'], ['teletext', 'film'],
  ],
};

const TITLES: Record<Genre, readonly string[]> = {
  news: ['The News'],
  weather: ['The Weather', 'Weather Watch'],
  quiz: ['Quiz Night', 'Brain of the Borough', 'Fifteen to Win', 'Spin the Wheel', 'Pub Quiz Live'],
  match: ['The Big Match', 'Matchday Live', 'Football Tonight'],
  cooking: ['Kitchen Table', 'Bake Street', 'Cook It Quick', 'Sunday Roast'],
  nature: ['Wild Shores', 'Hedgerow Diaries', 'The Living River', 'Birds of the Marsh'],
  cartoons: ['Toon Time', 'Shapes and Friends', 'The Bouncy Bunch', 'Saturday Scramble'],
  film: ['The Afternoon Film', 'Film Night', 'The Late Film', 'Midnight Movie'],
  teletext: ['Pages from Civitext'],
  testcard: ['Test Card'],
};
/** The news by the hour it is on. */
const NEWS_TITLE = (h: number) => (h < 10 ? 'Breakfast News' : h < 14 ? 'Lunchtime News' : h < 20 ? 'The Six O\'Clock News' : 'The Late News');

/** Minutes at the end of a news hour given to the weather forecast. */
export const WEATHER_MINUTES = 12;

/**
 * The scheduled programme on a channel at a tick. `matchNight` says whether a stadium or sports hall has an event on
 * the game day (shared leisure.ts eventOn); without one, the evening's 'match' slots go to the other genres.
 */
export function programmeAt(ch: TvChannel, tick: number, matchNight: boolean): Programme {
  const abs = Math.floor(tick / TICKS_PER_HOUR), h = ((abs % 24) + 24) % 24;
  const kind = ch.id === 'c1' || ch.id === 'c2' ? ch.id : 'player';
  // the match runs as one block over both evening hours that offer it, on the channels that carry it that night
  const day = Math.floor(abs / 24);
  const carries = matchNight && hash2(ch.seed, day * 7 + 911) < (kind === 'c1' ? 0.7 : 0.45);
  let slot = SCHEDULES[kind][h].filter((g) => g !== 'match' || carries);
  if (carries && SCHEDULES[kind][h].includes('match')) slot = ['match'];
  if (!slot.length) slot = ['film'];
  const seed = hash2(ch.seed, abs * 3 + 17);
  const genre = slot[Math.floor(hash2(ch.seed, abs * 3 + 5) * slot.length)];
  const start = abs * TICKS_PER_HOUR, end = start + TICKS_PER_HOUR;
  // the forecast closes every news hour
  if (genre === 'news' && tick - start >= (60 - WEATHER_MINUTES) * (TICKS_PER_HOUR / 60)) {
    return { genre: 'weather', title: 'The Weather', hour: abs, start: start + (60 - WEATHER_MINUTES) * (TICKS_PER_HOUR / 60), end, seed };
  }
  const titles = TITLES[genre];
  let title = genre === 'news' ? NEWS_TITLE(h) : titles[Math.floor(hash2(ch.seed, abs * 3 + 9) * titles.length)];
  if (genre === 'film' && h >= 23) title = 'Midnight Movie';
  return { genre, title, hour: abs, start, end, seed };
}

/** "Quiz Night on Civitas 1" */
export const watchingLine = (p: Pick<Programme, 'title' | 'genre'>, ch: Pick<TvChannel, 'name'>) =>
  p.genre === 'testcard' ? `the test card on ${ch.name}` : p.genre === 'teletext' ? `teletext on ${ch.name}` : `${p.title} on ${ch.name}`;

// ---- the sets in homes ---------------------------------------------------------------------------

/**
 * Whether a home's TV is on at an hour (interiors.ts draws it on; the citizen panel says what is on): most evenings,
 * each home its own hours, and some days for a retiree at home. Pure, so the server's memories (N5) can ask too.
 */
export function tvOnAt(homeSeed: number, hour: number, retired: boolean): boolean {
  return hash2(homeSeed, Math.floor(hour)) < (hour >= 17.5 || hour < 2 ? 0.85 : retired ? 0.5 : 0.15);
}

/**
 * Which channel a home is watching at a tick: its favourite (by the home's seed), except in hours it hops to another.
 * `channels` should be in a stable order (CIVITAS_CHANNELS first, then player channels by owner id).
 */
export function homeChannel(homeSeed: number, tick: number, channels: readonly TvChannel[]): TvChannel {
  const n = channels.length;
  const fav = Math.floor(hash2(homeSeed, 601) * Math.min(n, 3 + Math.floor(hash2(homeSeed, 603) * n)));
  const abs = Math.floor(tick / TICKS_PER_HOUR);
  if (n > 1 && hash2(homeSeed, 602 + abs * 7) < 0.3) return channels[(fav + 1 + Math.floor(hash2(homeSeed, 604 + abs) * (n - 1))) % n];
  return channels[Math.min(n - 1, fav)];
}

/** A day number from a tick (the schedule's match nights are per game day). */
export const tvDay = (tick: number) => Math.floor(tick / TICKS_PER_DAY);
