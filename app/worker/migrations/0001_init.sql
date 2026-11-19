-- Frenchirix: the whole per-kid state. See docs/app-server.md for what each table means.
-- Days are 'YYYY-MM-DD' in the kid's time zone; instants are integer milliseconds since the epoch.
-- Levels: 0 none, 1 bronze, 2 silver, 3 gold, 4 titanium, 5 diamond, 6 plutonium.

-- One row per kid. Counters the achievements read live in `stats` (a JSON object of StatKey -> number).
-- `rev` is bumped by every write so a request can detect that another one changed the row meanwhile.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,          -- lower case, no accents: uniqueness and login
  name_chosen INTEGER NOT NULL DEFAULT 0,
  pin TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  avatar TEXT NOT NULL,                   -- JSON Avatar
  speak INTEGER NOT NULL DEFAULT 1,
  time_zone TEXT NOT NULL,
  created_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  sesterces INTEGER NOT NULL DEFAULT 0,
  potions INTEGER NOT NULL DEFAULT 0,
  streak_count INTEGER NOT NULL DEFAULT 0,
  streak_best INTEGER NOT NULL DEFAULT 0,
  streak_last_day TEXT,
  skill_estimate REAL NOT NULL DEFAULT 1.5, -- the app's estimate of the kid's French, 1-5
  stats TEXT NOT NULL DEFAULT '{}',
  inbox_unread INTEGER NOT NULL DEFAULT 0,
  league_tier INTEGER NOT NULL DEFAULT 0,
  league_seen_week TEXT,                  -- last league week this kid was seen in (lazy settling)
  rev INTEGER NOT NULL DEFAULT 0
);

-- The session cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Failed gate and login attempts, for rate limiting. key: 'g:<ip>', 'ip:<ip>', 'a:<name key>'.
CREATE TABLE login_attempts (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_attempts_key ON login_attempts (key, at);

-- Unlocked scenes only. `level`: the highest level passed (0 = none yet).
CREATE TABLE scene_progress (
  user_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  due_day TEXT,
  passes INTEGER NOT NULL DEFAULT 0,
  unlocked_day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  last_pass_day TEXT,
  PRIMARY KEY (user_id, scene_id)
) WITHOUT ROWID;

-- Weak spots: per kid and unit, and per kid and puzzle type.
CREATE TABLE unit_stats (
  user_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  missed INTEGER NOT NULL DEFAULT 0,
  last_day TEXT,
  PRIMARY KEY (user_id, unit_id)
) WITHOUT ROWID;

CREATE TABLE puzzle_type_stats (
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  missed INTEGER NOT NULL DEFAULT 0,
  mistakes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, type)
) WITHOUT ROWID;

-- A practice on one scene at one level (or a bonus sitting), played in sittings that can be left and
-- continued: progress is saved after every finished puzzle. status 'open' until completed once ('done').
CREATE TABLE practices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- 'daily' (started from a stop) or 'scene'
  slot INTEGER,                           -- the stop it was started from (kind 'daily')
  day TEXT NOT NULL,
  seed INTEGER NOT NULL,
  plan TEXT NOT NULL,                     -- JSON { entries, focusUnitIds, speak, allowedQuestionIds }
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  stars INTEGER,
  scene_id TEXT,
  level INTEGER,                          -- the level the practice earns when passed (1-6)
  bonus INTEGER NOT NULL DEFAULT 0,       -- 1: one sitting for XP only
  done INTEGER NOT NULL DEFAULT 0,        -- puzzles finished so far (never goes back)
  total INTEGER,                          -- puzzles in the practice, as the client composed it
  outcomes TEXT NOT NULL DEFAULT '[]',    -- JSON PuzzleOutcome[] saved so far, by puzzle id
  credited_xp INTEGER NOT NULL DEFAULT 0, -- XP already given for finished puzzles
  content_version TEXT,
  composer_version INTEGER,
  sittings TEXT,                          -- JSON [{ index, from, to }]: the composer's boundaries
  sittings_done INTEGER NOT NULL DEFAULT 0,
  sitting_mark INTEGER NOT NULL DEFAULT 0,  -- `done` when the last sitting was counted
  sitting_flaws INTEGER NOT NULL DEFAULT 0, -- mistakes + hints since then (perfect sittings)
  updated_at INTEGER,
  played_at INTEGER                       -- last start or progress (the most recently played)
);
CREATE INDEX practices_user ON practices (user_id, day);
CREATE INDEX practices_open ON practices (user_id, status, created_at);
CREATE INDEX practices_played ON practices (user_id, status, played_at);
CREATE UNIQUE INDEX practices_scene_level ON practices (user_id, scene_id, level) WHERE bonus = 0 AND level IS NOT NULL;

-- Per kid and day: the candidates, what was unlocked, the three stops, and per-day usage caps.
CREATE TABLE daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  candidates TEXT NOT NULL DEFAULT '[]',  -- JSON scene ids
  unlocked TEXT NOT NULL DEFAULT '[]',    -- JSON scene ids unlocked today
  quizzes TEXT NOT NULL DEFAULT '[{},{},{}]', -- JSON [{ l: practice id, c: chest id, s: [scene id] }] by stop
  speech_n INTEGER NOT NULL DEFAULT 0,
  loops_n INTEGER NOT NULL DEFAULT 0,
  songs_n INTEGER NOT NULL DEFAULT 0,
  views_n INTEGER NOT NULL DEFAULT 0,
  gifts_n INTEGER NOT NULL DEFAULT 0,
  moves_n INTEGER NOT NULL DEFAULT 0,     -- items and potions given today
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

-- Days on which a kid finished at least one sitting (streaks, friend streaks); `practices` counts the sittings.
CREATE TABLE days (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  practices INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

CREATE TABLE chests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  earned_day TEXT NOT NULL,
  opened_at INTEGER,
  loot TEXT                               -- JSON Reward once opened
);
CREATE INDEX chests_user ON chests (user_id) WHERE opened_at IS NULL;

CREATE TABLE inventory (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
) WITHOUT ROWID;

CREATE TABLE achievements (
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  earned_day TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, achievement_id)
) WITHOUT ROWID;

CREATE TABLE follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
) WITHOUT ROWID;
CREATE INDEX follows_followee ON follows (followee_id);

-- Gifts: kind 'cheer' (ref = cheer id), 'item' (ref = item id), 'potion'.
CREATE TABLE gifts (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  feed_item_id TEXT,
  day TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX gifts_to ON gifts (to_id, created_at);
CREATE INDEX gifts_from ON gifts (from_id, feed_item_id);

-- Milestones friends see in their feed. kind 'level' (a scene's new level), 'rank', 'streak', 'unlock', 'achievement'.
CREATE TABLE feed (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  scene_id TEXT,
  level INTEGER,
  count INTEGER,
  achievement_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX feed_user ON feed (user_id, created_at);

-- Leagues: one group per (week, tier, n), up to LEAGUE_GROUP_SIZE members, settled lazily.
CREATE TABLE league_groups (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,
  tier INTEGER NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX league_groups_week ON league_groups (week, tier, size);

CREATE TABLE league_members (
  week TEXT NOT NULL,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  tier INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week)
) WITHOUT ROWID;
CREATE INDEX league_members_group ON league_members (group_id);

-- Questions a kid was shown (rules.questionEligible: at most 3 times, 5 then 14 days apart).
CREATE TABLE question_seen (
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  shows INTEGER NOT NULL DEFAULT 0,
  last_day TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
) WITHOUT ROWID;

-- The activity log (docs/app-server.md, "Activity log and reports"): what kids did and what went wrong,
-- for statistics. `kind` is one of shared/activity.ts; `data` is JSON per kind. `user_id` is null
-- before a session; `session_id` is the client's per-tab id; `build` the client's build. Rows older than
-- ACTIVITY_KEEP_DAYS (180) are deleted by the daily scheduled job (worker/activity.ts).
CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,                      -- the kid's day (their time zone; DEFAULT_TIME_ZONE without a session)
  build TEXT,
  session_id TEXT,
  kind TEXT NOT NULL,
  route TEXT,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX activity_at ON activity (at);
CREATE INDEX activity_user ON activity (user_id, at);

-- "Quelque chose ne va pas ?": what a kid typed, with the context of where it happened. Kept for good;
-- ids are never reused (the triage ledger app/triage/reports.json is keyed by them).
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  at INTEGER NOT NULL,
  build TEXT,
  route TEXT,
  text TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',     -- JSON, see web/src/report/context.ts
  user_agent TEXT
);
CREATE INDEX reports_at ON reports (at);
