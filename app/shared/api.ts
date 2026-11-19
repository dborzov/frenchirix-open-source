// Types of the HTTP API and of the player state (docs/app-server.md, "API").
// The backend implements these, the clients (web/src/api/client.ts and fixtureClient.ts) call them.
//
// Conventions
// - JSON in and out, except POST /gate (form or JSON) and POST /api/speech (WAV body).
// - Every response that can change the player's state carries `patch: StatePatch`: the changed parts
//   only. The client applies it with `applyPatch` below; never rebuild PlayerState by hand.
//   GET responses that show a part of the state (daily) carry a patch too, so the store stays fresh.
// - Errors: a non-2xx status with an `ApiError` body. 401 { error: 'gate' } without the gate cookie,
//   401 { error: 'no-session' } without a session.
// - Days are 'YYYY-MM-DD', the kid's day (it starts at DAY_START_HOUR in the account's time zone),
//   computed by the server (rules.ts, kidDay).

import type { Avatar, Reward, StatKey } from './catalog/types';
import type { PracticePlan, PuzzleOutcome } from './practice/types';
export type { PracticePlan } from './practice/types';
import type { ChestKind, Day, LeagueTier, Level, QuestReason, StreakDayKind } from './rules';

export type { Day, Level, ChestKind, QuestReason, StreakDayKind } from './rules';
export type Language = 'fr' | 'en';

// =============================================================================================
// Player state

export interface Profile {
  id: string;
  name: string; // the funny generated name until the kid picks one
  nameChosen: boolean; // false until the kid picks a name (asked when they make their avatar)
  pin: string; // three digits, shown in the profile; with the name it logs in elsewhere
  language: Language;
  avatar: Avatar;
  speak: boolean; // false = "can't talk right now": no speaking puzzles
  timeZone: string; // IANA zone the server uses for "today"; set when the account is made, changed only by PATCH /api/me
  createdDay: Day;
}

export interface Currencies {
  xp: number; // total, all time
  sesterces: number; // spent in the shop
  potions: number; // streak freezes; at most MAX_STREAK_FREEZES; can be gifted
}

export interface Streak {
  count: number; // days in a row with at least a light streak, as it should be displayed today (0 when broken)
  best: number;
  lastDay: Day | null; // the last light streak day (a practice finished)
  doneToday: boolean; // a practice finished today: today is a light streak day
  fullToday: boolean; // every one of the day's quests done too: a full streak day
  week: StreakDay[]; // the last STREAK_WEEK days, oldest first, today last
}

export interface StreakDay {
  day: Day;
  kind: StreakDayKind; // full, light, saved (a missed day a potion saved: counts as light), none
}

/** One scene the kid has unlocked. Locked scenes are absent from PlayerState.progress. */
export interface SceneProgress {
  level: Level; // 0 until the first pass
  dueDay: Day | null; // when the next level can be earned; null before bronze and at plutonium
  passes: number; // practices finished that contained the scene
  unlockedDay: Day;
  views: number; // full watches in view mode
  lastPassDay: Day | null;
}

export interface Chest {
  id: string;
  kind: ChestKind;
  source: 'quest' | 'achievement' | 'gift' | 'shop';
  earnedDay: Day;
}

export interface AchievementState {
  earnedDay: Day;
  seen: boolean; // false until the client acknowledged it (PATCH /api/me { seenAchievements })
}

export type QuestKind = 'choose' | 'practice';

/**
 * One of today's quests (docs/app-rules.md, "Daily quests"): choose new scenes, or pass a practice at
 * a level. The day's quests are built once, at the day's first visit; "Do more" adds extra ones. Each
 * gives a chest. Its `index` is its place in DailyState.quests and never changes during the day.
 */
export interface Quest {
  index: number;
  kind: QuestKind;
  round: number; // 0: one of the day's quests; 1, 2...: added by the 1st, 2nd... "Do more"
  extra: boolean; // round > 0: not needed for the full streak
  chest: ChestKind; // the chest it gives
  done: boolean;
  chestId: string | null; // the chest it gave, once done (it may already be opened)
  // A practice quest: pass the practice of `sceneId` at `level`. Start it with
  // POST /api/practices/start { kind: 'scene', sceneId }, which continues `practice` when started.
  sceneId: string | null; // null: a place for a scene not chosen yet (the choose quest of its round fills it)
  level: number; // the level to pass (1 bronze ... 6 plutonium); 0 for choose
  reason: QuestReason | null; // due: its level is due; continue: a bronze practice started on an earlier day; new: a scene chosen today
  practice: ScenePractice | null; // the started practice it continues, with its progress
  // A choose quest: unlock `target` of its round's candidates (DailyState.candidates while it is the current one).
  chosen: number; // scenes chosen so far from its draw
  target: number; // how many to choose (DAILY_UNLOCKS, fewer when fewer are offered); 0 for a practice
  locked: boolean; // the practice quests before it (`waitingFor`) must be done first; unlocking answers 409 choose-locked
  waitingFor: number[]; // indexes of those quests, not done yet
}

export interface Candidate {
  sceneId: string;
  unlocked: boolean; // chosen
}

export interface DailyState {
  day: Day;
  quests: Quest[]; // the day's quests, then the extra ones "Do more" added
  questsDone: boolean; // every one of the day's quests (round 0) is done: with a practice finished, a full streak day
  round: number; // the current draw: 0 the day's, n after the n-th "Do more"
  choose: number | null; // index of the current choose quest (the latest one); null when every scene is unlocked
  candidates: Candidate[]; // the current choose quest's draw (unchosen ones go back to the pool once it is done, and at the next day)
  unlocksLeft: number; // scenes still to choose from the current draw (0 when its choose quest is done)
  doMore: boolean; // POST /api/daily/more would answer 200: every quest done, extra ones too, and scenes left to unlock
  dueSceneIds: string[]; // unlocked scenes whose level can rise today, most overdue first
}

export interface LeagueSummary {
  week: Day; // Monday of the league week
  tier: LeagueTier;
  weekXp: number;
  rank: number; // 1-based, in the kid's group
  groupSize: number;
}

export interface PlayerState {
  profile: Profile;
  currencies: Currencies;
  streak: Streak;
  skillEstimate: number; // the app's estimate of the kid's French, SKILL_MIN..SKILL_MAX, may be fractional
  progress: Record<string, SceneProgress>; // by scene id; unlocked scenes only
  inventory: Record<string, number>; // item id -> count owned (>= 1)
  chests: Chest[]; // unopened only
  achievements: Record<string, AchievementState>; // earned only, by achievement id
  stats: Partial<Record<StatKey, number>>; // counters, for achievement progress bars
  daily: DailyState;
  league: LeagueSummary | null; // null until the kid has XP this week
  inboxUnread: number;
  today: Day; // the server's "today" for this kid (rules.ts, kidDay)
  practices: Record<string, ScenePractice>; // by scene id: the started practice that starting the scene continues
  recordings: Record<string, KaraokeRecording>; // by song id: the kid's saved singing of that song (docs/app-server.md, "Karaoke recordings")
}

/** A take that passed the check, kept on the server until the kid keeps it or throws it away. Its audio is not served. */
export interface KaraokeTake {
  id: string;
  songId: string;
  offsetMs: number; // where the first sample sits on the song
  durationMs: number;
}

/**
 * The kid's kept recording of a song (at most one per kid and song): a WAV, 16 kHz mono 16-bit, played
 * over the song with its first sample at `offsetMs` of the song. `url` is served only to this kid's
 * session (the browser keeps it and revalidates it); it changes whenever the recording does.
 */
export interface KaraokeRecording extends KaraokeTake {
  url: string; // GET /api/karaoke/audio/<id>.wav
}

/**
 * A scene's started practice: "Continue (12 / 40)", on the quest card, the scene page and the episode
 * timeline. `done` is never more than `total`.
 */
export interface ScenePractice {
  practiceId: string;
  level: number; // the level it is played at: the level it earns when passed; for a replay, the scene's level
  replay: boolean; // a replay: XP only
  done: number;
  total: number | null; // null until the client reported it (the first progress save)
}

// =============================================================================================
// StatePatch: the changed parts of PlayerState. Semantics are defined by applyPatch.

export interface StatePatch {
  profile?: Partial<Profile>; // merged field by field
  currencies?: Partial<Currencies>; // merged; values are new totals, not deltas
  streak?: Streak; // replaced
  skillEstimate?: number;
  progress?: Record<string, SceneProgress | null>; // per scene: replaced; null removes
  inventory?: Record<string, number>; // per item: new count; 0 removes
  chests?: { add?: Chest[]; remove?: string[] }; // remove by id, then add
  achievements?: Record<string, AchievementState>; // per achievement: replaced
  stats?: Partial<Record<StatKey, number>>; // merged; new totals
  daily?: DailyState; // replaced
  league?: LeagueSummary | null; // replaced
  inboxUnread?: number;
  today?: Day;
  practices?: Record<string, ScenePractice | null>; // per scene: replaced; null removes
  recordings?: Record<string, KaraokeRecording | null>; // per song: replaced; null removes
}

/** Pure: a new PlayerState with the patch applied. Shared by server and client so both agree. */
export function applyPatch(state: PlayerState, patch: StatePatch | undefined | null): PlayerState {
  if (!patch) return state;
  const next: PlayerState = { ...state };
  if (patch.profile) next.profile = { ...state.profile, ...patch.profile };
  if (patch.currencies) next.currencies = { ...state.currencies, ...patch.currencies };
  if (patch.streak) next.streak = patch.streak;
  if (patch.skillEstimate !== undefined) next.skillEstimate = patch.skillEstimate;
  if (patch.progress) {
    const progress = { ...state.progress };
    for (const [id, p] of Object.entries(patch.progress)) {
      if (p === null) delete progress[id];
      else progress[id] = p;
    }
    next.progress = progress;
  }
  if (patch.inventory) {
    const inventory = { ...state.inventory };
    for (const [id, n] of Object.entries(patch.inventory)) {
      if (n <= 0) delete inventory[id];
      else inventory[id] = n;
    }
    next.inventory = inventory;
  }
  if (patch.chests) {
    const remove = new Set(patch.chests.remove ?? []);
    const kept = state.chests.filter((c) => !remove.has(c.id));
    const added = (patch.chests.add ?? []).filter((c) => !kept.some((k) => k.id === c.id));
    next.chests = [...kept, ...added];
  }
  if (patch.achievements) next.achievements = { ...state.achievements, ...patch.achievements };
  if (patch.stats) next.stats = { ...state.stats, ...patch.stats };
  if (patch.daily) next.daily = patch.daily;
  if (patch.league !== undefined) next.league = patch.league;
  if (patch.inboxUnread !== undefined) next.inboxUnread = patch.inboxUnread;
  if (patch.today !== undefined) next.today = patch.today;
  if (patch.practices) {
    const practices = { ...(state.practices ?? {}) };
    for (const [id, p] of Object.entries(patch.practices)) {
      if (p === null) delete practices[id];
      else practices[id] = p;
    }
    next.practices = practices;
  }
  if (patch.recordings) {
    const recordings = { ...(state.recordings ?? {}) };
    for (const [id, r] of Object.entries(patch.recordings)) {
      if (r === null) delete recordings[id];
      else recordings[id] = r;
    }
    next.recordings = recordings;
  }
  return next;
}

/** Merge two patches into one that has the effect of applying a then b. */
export function mergePatches(a: StatePatch, b: StatePatch): StatePatch {
  const out: StatePatch = { ...a, ...b };
  if (a.profile && b.profile) out.profile = { ...a.profile, ...b.profile };
  if (a.currencies && b.currencies) out.currencies = { ...a.currencies, ...b.currencies };
  if (a.progress && b.progress) out.progress = { ...a.progress, ...b.progress };
  if (a.inventory && b.inventory) out.inventory = { ...a.inventory, ...b.inventory };
  if (a.achievements && b.achievements) out.achievements = { ...a.achievements, ...b.achievements };
  if (a.stats && b.stats) out.stats = { ...a.stats, ...b.stats };
  if (a.practices && b.practices) out.practices = { ...a.practices, ...b.practices };
  if (a.recordings && b.recordings) out.recordings = { ...a.recordings, ...b.recordings };
  if (a.chests && b.chests) {
    const removeB = new Set(b.chests.remove ?? []);
    out.chests = {
      remove: [...(a.chests.remove ?? []), ...(b.chests.remove ?? [])],
      add: [...(a.chests.add ?? []).filter((c) => !removeB.has(c.id)), ...(b.chests.add ?? [])],
    };
  }
  return out;
}

/** Every mutating response has this shape plus its own fields. */
export interface Patched {
  patch: StatePatch;
}

// =============================================================================================
// Public views of other kids (search, friends, league). Never the PIN.

export interface PublicProfile {
  id: string;
  name: string;
  avatar: Avatar;
  xpRank: number;
  streak: number;
  following: boolean; // the current kid follows them
  followsMe: boolean;
}

export interface Friend extends PublicProfile {
  friendStreak: number; // days in a row both practised
  practisedToday: boolean;
  weekXp: number;
}

export type FeedKind = 'level' | 'streak' | 'achievement' | 'rank' | 'unlock';

export interface FeedItem {
  id: string;
  user: Pick<PublicProfile, 'id' | 'name' | 'avatar'>;
  kind: FeedKind;
  day: Day;
  // what happened: a level on a scene, a streak count, an achievement, a level
  sceneId?: string;
  level?: Level;
  count?: number;
  achievementId?: string;
  cheeredByMe: boolean; // a cheer was already sent for this item
}

export type Gift =
  | { kind: 'cheer'; cheerId: string; feedItemId?: string }
  | { kind: 'item'; itemId: string } // moves one owned item to the friend
  | { kind: 'potion' }; // moves one potion to the friend

export interface InboxEntry {
  id: string;
  from: Pick<PublicProfile, 'id' | 'name' | 'avatar'>;
  gift: Gift;
  day: Day;
  seen: boolean;
}

export interface LeagueRow {
  userId: string;
  name: string;
  avatar: Avatar;
  weekXp: number;
  rank: number; // 1-based
  me: boolean;
}

// =============================================================================================
// Errors

export type ApiErrorCode =
  | 'gate' // no gate cookie
  | 'no-session'
  | 'bad-request'
  | 'not-found'
  | 'bad-password' // POST /gate
  | 'bad-credentials' // POST /api/login
  | 'rate-limited'
  | 'name-invalid' // length or characters (NAME_RE)
  | 'name-taken'
  | 'name-rude'
  | 'avatar-invalid'
  | 'not-offered' // unlocking a scene that is not in the current draw of candidates
  | 'already-unlocked'
  | 'no-unlocks-left' // the current choose quest is done
  | 'choose-locked' // 409: the choose quest waits for the practice quests before it
  | 'more-unavailable' // 409: "Do more" while a quest is not done, or nothing is left to unlock
  | 'scene-locked' // a scene practice or view on a locked scene
  | 'practice-closed' // completing a practice twice, or one of another kid
  | 'not-enough-sesterces'
  | 'already-owned' // buying an item the kid already has
  | 'not-owned' // gifting or wearing something not owned
  | 'potions-full'
  | 'speech-unavailable' // Workers AI failed
  | 'too-big' // 413: an upload over its size or length limit (a karaoke take)
  | 'no-take' // 409: saving a karaoke take the server does not hold (dropped, replaced by another, or too old)
  | 'client-outdated' // 409: the client build is older than MIN_CLIENT_BUILD (shared/build.ts); it reloads
  | 'internal';

export interface ApiError {
  error: ApiErrorCode;
  message?: string; // English, for logs; the UI shows t(`common.error.${error}`)
  retryAfterS?: number; // with rate-limited
}

// =============================================================================================
// Endpoints. One request and one response type each, named after the route.

// POST /gate (form field or JSON). 204 and a cookie, or 401 { error: 'bad-password' }.
export interface GateRequest {
  password: string;
}

// POST /api/session. Without a session cookie: creates a kid and sets the cookie (created: true), with
// this time zone. With one: returns the existing kid (created: false); the time zone is not changed
// (only PATCH /api/me changes it: a phone on UTC and an iPad in Toronto must not split the kid's days).
export interface SessionRequest {
  timeZone: string;
  language?: Language; // the browser's preference for a new kid; ignored for an existing one
}
export interface SessionResponse {
  state: PlayerState;
  created: boolean;
}

// POST /api/login. Replaces the session cookie with one for that kid (whose time zone stays as it is).
export interface LoginRequest {
  name: string; // the kid's name
  pin: string;
  timeZone?: string; // ignored: the account keeps its zone
}
export interface LoginResponse {
  state: PlayerState;
  /** The account this browser was on before held nothing and was deleted (the device forgets it). */
  previousDeleted?: boolean;
}

// POST /api/logout ("New player" on the player selection). No body. The browser's session is deleted and
// its cookie expired; the account too when it holds nothing (`deleted`: the device forgets it). The next
// POST /api/session makes a new kid.
export interface LogoutResponse {
  deleted: boolean;
}

// GET /api/me
export interface MeResponse {
  state: PlayerState;
}

// PATCH /api/me. Any subset.
export interface MePatchRequest {
  name?: string;
  language?: Language;
  avatar?: Avatar;
  speak?: boolean;
  timeZone?: string;
  seenAchievements?: string[]; // mark these earned achievements as seen
}
export type MePatchResponse = Patched;

// GET /api/daily. Today's quests, the current candidates and unlocks left (also in the patch as `daily`).
export interface DailyResponse extends Patched {
  daily: DailyState;
}

// POST /api/daily/unlock: choose one of the current candidates. It fills the first place of its round
// still waiting for a scene (a bronze practice quest); the choice that reaches the choose quest's
// target does that quest (its chest in `quest` and in the patch). Errors: 400 not-offered (not in the
// current draw), 400 already-unlocked, 400 no-unlocks-left (the current choose quest is done),
// 409 choose-locked (the practice quests before it are not done yet).
export interface UnlockRequest {
  sceneId: string;
}
export interface UnlockResponse extends Patched {
  quest: { index: number; chest: Chest } | null; // the choose quest this unlock did
}

// POST /api/daily/more ("Do more"), no body: once every quest of today is done (the extra ones too),
// a fresh draw of DAILY_CANDIDATES candidates (none offered earlier today, when enough are left) and
// extra quests: one choose quest and a place for the bronze practice of each scene to choose. It never
// touches tomorrow. 409 more-unavailable otherwise.
export type MoreResponse = DailyResponse;

// POST /api/practices/start: a practice on one scene. The answer is a PracticePlan.
// - scene { sceneId }: that scene's started practice for its next level; else, when its next level is
//   due (always for a scene without bronze), a new practice for it; else its started replay; else a new
//   replay (the practice at the scene's level, XP only). A quest card starts its scene this way, so a
//   quest continues the scene's started practice. A locked scene: 403 scene-locked.
// - resume { practiceId }: that practice (the practice screen opened from a link, history or a
//   reload); 409 practice-closed once it is finished.
export type PracticeStartRequest = ({ kind: 'scene'; sceneId: string } | { kind: 'resume'; practiceId: string }) & {
  composerVersion?: number; // the client's composer version (COMPOSER_VERSION), stored with a new plan
};
export interface PracticeStartResponse extends Patched {
  plan: PracticePlan;
}

// POST /api/practices/:id/progress: saved after every finished puzzle. Idempotent and monotonic: `done`
// never goes back; outcomes are merged by puzzle id. Each newly finished puzzle's XP and statistics are
// credited now. Send `total` (the composed length) with every call.
export interface PracticeProgressRequest {
  done: number; // puzzles finished so far
  total?: number; // puzzles in the practice as composed
  outcomes: PuzzleOutcome[]; // at least the newly finished ones; earlier ones may be repeated
}
export interface PracticeProgressResponse extends Patched {
  done: number; // as stored (never less than before)
  xp: number; // XP credited by this call
}

// POST /api/practices/:id/complete
export interface PracticeCompleteRequest {
  outcomes: PuzzleOutcome[];
  ms: number; // total time in the practice
}
export interface LevelChange {
  sceneId: string;
  from: Level;
  to: Level;
  dueDay: Day | null; // when the next one can be earned
}
export interface PracticeCompleteResponse extends Patched {
  level: number; // the level it was played at
  replay: boolean; // a replay: XP only
  stars: 1 | 2 | 3;
  rewards: Reward; // what completing gave (XP, sesterces), not counting XP already credited by progress saves
  creditedXp?: number; // XP the practice's puzzles earned earlier, through POST /api/practices/:id/progress
  quest: { index: number; chest: Chest } | null; // the quest of today this practice did
  chest: Chest | null; // that quest's chest, unopened (the same as quest.chest)
  levels: LevelChange[]; // scenes whose level rose
  replayed: string[]; // scenes passed without a rise (before their due day, or at plutonium)
  achievements: string[]; // achievement ids newly earned
  achievementRewards: Reward; // everything those achievements gave, already in the patch
  streak: StreakChange;
  rankUp: number | null; // the new rank, when it went up
}

/** What a request did to the streak. */
export interface StreakChange {
  count: number;
  extended: boolean; // the count went up: today became a light streak day
  freezesUsed: number; // potions used to save missed days (shown as saved days)
  reset: boolean; // the streak was broken and starts again at 1
  full: boolean; // today became a full streak day with this request
}

// POST /api/scenes/:id/view — a full watch in view mode.
export type SceneViewResponse = Patched;

// POST /api/events — batched counters from the client.
export type ClientStat = Extract<StatKey, 'loopsHeard' | 'songsSung'>;
export interface EventsRequest {
  events: { stat: ClientStat; n: number; ref?: string }[]; // ref: the unit, line or song id
}
export type EventsResponse = Patched;

// POST /api/speech?scene=<scene id>&line=<line id>  or  ?scene=<scene id>&unit=<unit id>
// Body: WAV, 16 kHz mono (Content-Type: audio/wav).
export interface SpeechQuery {
  scene: string;
  // Exactly one target:
  line?: string; // a line id
  unit?: string; // a unit id
  alt?: string; // '<line id>:<k>': alternate k (0-based) of that line
  choice?: string; // a line id: the candidates are the line itself and all its alternates
  // Options:
  hint?: 'expected' | 'names'; // default 'expected': the show's names plus the expected text(s); 'names': names only
  attempt?: number; // 1-based try at this target (informational; logged, echoed in debug)
  type?: string; // the puzzle type asking (informational; in the activity log)
  debug?: boolean; // sent as debug=1; honoured only locally or with the admin cookie
}
/** Who decided `pass`: the sound-alike scorer, the judge model, the lenient rule when the judge failed,
 *  or nobody (nothing was heard, or a third try, which the client accepts anyway). */
export type SpeechDecider = 'scorer' | 'judge' | 'fallback' | 'none';
export interface SpeechDebug {
  hint: string; // the initial_prompt sent to Whisper
  ms: number; // Whisper's round trip
  raw: string; // Whisper's raw text, before trimming
  attempt: number;
  by?: SpeechDecider; // always set by the server (optional for the fixture client)
  totalMs?: number; // Whisper plus the judge, as the server measured it
  judge?: {
    model: string;
    ms: number; // the judge's round trip (or until the time-box)
    promptChars: number; // system + user prompt length
    raw: string; // the model's raw answer ('' on error)
    verdict: { attempt: boolean; candidate: number } | null; // null: malformed, failed or timed out
    error?: string; // 'timeout' or the error message
  };
}
export interface SpeechResponse extends Patched {
  transcript: string;
  score: number; // 0..1
  pass: boolean;
  matched: { word: string; ok: boolean }[]; // the expected French words, in order, and whether each was heard
  expectedWords: string[]; // the target's words as written (the best candidate for `choice`)
  heardWords: string[]; // the transcript's words after normalisation
  choice?: { index: number; scores: number[] }; // for `choice`: 0 = the line, 1.. = its alternates in order (index: the judge's pick when it decided)
  by?: SpeechDecider; // always set by the server
  debug?: SpeechDebug;
}

// Karaoke recordings (docs/app-server.md, "Karaoke recordings"). A take is checked, then heard, then saved
// or dropped; the saved recording plays over the song wherever the kid hears it.
//
// POST /api/karaoke/:songId/take?offset=<ms>   body: WAV, 16 kHz mono 16-bit (Content-Type: audio/wav)
//   Whisper transcribes it and the transcript is checked for rude words only (shared/karaoke.ts,
//   checkTake). `ok`: stored as the song's unsaved take (replacing an earlier one) and returned;
//   `refused`: nothing is kept. Errors: 404 not-found (no such song), 400 bad-request (not such a WAV,
//   too short, a bad offset), 413 too-big (over KARAOKE_MAX_BYTES, or longer than the song), 429
//   rate-limited (KARAOKE_TAKES_PER_DAY checked today), 503 speech-unavailable (Whisper failed: the
//   kid keeps the take and may send it again).
export interface KaraokeTakeResponse extends Patched {
  verdict: 'ok' | 'refused';
  take: KaraokeTake | null; // the checked take (not kept yet; no URL); null when refused
  debug?: { transcript: string; ms: number; words: string[] }; // with debug=1, locally or for the admin
}
// POST /api/karaoke/:songId/save { takeId }: the checked take becomes the song's recording, replacing
// an older one. Saving a take already kept answers it again (a retried tap). 409 no-take when the song
// holds no such take (thrown away, replaced by another, or purged).
export interface KaraokeSaveRequest {
  takeId: string;
}
export interface KaraokeSaveResponse extends Patched {
  recording: KaraokeRecording;
}
// DELETE /api/karaoke/:songId/take: drops the unsaved take (204, also when there is none).
// DELETE /api/karaoke/:songId/recording: removes the saved recording (also when there is none).
export type KaraokeRemoveResponse = Patched;
// GET /api/karaoke/audio/<id>.wav: a saved recording's WAV, for its kid's session only (404 otherwise).

// POST /api/chests/:id/open
export interface ChestOpenResponse extends Patched {
  chest: Chest;
  loot: Reward;
}

// GET /api/shop
export interface ShopOffer {
  itemId: string;
  price: number;
  owned: number;
  featured: boolean; // today's special
}
export interface ShopResponse {
  offers: ShopOffer[];
  potionPrice: number | null; // null when potions are full
  refreshesDay: Day; // when the featured offers change
}

// POST /api/shop/buy
export type ShopBuyRequest = { itemId: string } | { potion: true };
export type ShopBuyResponse = Patched;

// GET /api/social/search?q=
export interface SocialSearchResponse {
  users: PublicProfile[];
}

// POST /api/social/follow and DELETE /api/social/follow
export interface FollowRequest {
  userId: string;
}
export interface FollowResponse extends Patched {
  user: PublicProfile;
}

// GET /api/social/friends — the kids the current kid follows, and their milestones.
export interface FriendsResponse {
  friends: Friend[];
  feed: FeedItem[]; // newest first
}

// POST /api/social/gift
export interface GiftRequest {
  toUserId: string;
  gift: Gift;
}
export type GiftResponse = Patched;

// GET /api/social/inbox — gifts received, newest first. Marks them seen (inboxUnread 0 in the patch).
// Items and potions are added to the receiver when sent; the inbox only tells them.
export interface InboxResponse extends Patched {
  entries: InboxEntry[];
}

// GET /api/league
export interface LeagueResponse {
  week: Day;
  endsDay: Day; // the Sunday the week ends
  tier: LeagueTier;
  rows: LeagueRow[]; // the kid's group, by rank
  promote: number; // the top this many go up (0 in the top tier)
  demote: number; // the bottom this many go down (0 in the bottom tier)
}
