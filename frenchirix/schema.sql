-- Schema of assets/db.sqlite. Concepts, id formats and rules: docs/data-model.md.
-- Every *_ms column is integer milliseconds on the timeline of the source episode file.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE episodes (
  id            TEXT PRIMARY KEY,              -- 's01e04'
  show          TEXT NOT NULL,
  season        INTEGER NOT NULL,
  episode       INTEGER NOT NULL,
  source_file   TEXT NOT NULL,                 -- relative to the repo root
  duration_ms   INTEGER NOT NULL,
  video_width   INTEGER NOT NULL,
  video_height  INTEGER NOT NULL,
  video_fps     REAL NOT NULL,
  audio_stream  INTEGER NOT NULL,              -- ffmpeg stream index of the French audio
  audio_layout  TEXT NOT NULL                  -- e.g. '5.1(side)'
);

-- Subtitle cues exactly as found in the source file. Imported once, never edited.
CREATE TABLE cues (
  id            INTEGER PRIMARY KEY,
  episode_id    TEXT NOT NULL REFERENCES episodes(id),
  track         TEXT NOT NULL CHECK (track IN ('fr', 'fr_sdh', 'en')),
  stream_index  INTEGER NOT NULL,
  idx           INTEGER NOT NULL,              -- 1-based order within the track
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL,
  raw_text      TEXT NOT NULL,                 -- with markup and line breaks
  UNIQUE (episode_id, track, idx)
);

-- The unit of dialogue: one row per cue of the plain French track.
CREATE TABLE lines (
  id            TEXT PRIMARY KEY,              -- 's01e04-0041'
  episode_id    TEXT NOT NULL REFERENCES episodes(id),
  idx           INTEGER NOT NULL,              -- 1-based, timeline order
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL,
  fr            TEXT NOT NULL,                 -- cleaned French subtitle text
  speaker       TEXT,                          -- from hearing-impaired labels, where present
  is_song       INTEGER NOT NULL DEFAULT 0,
  group_idx     INTEGER NOT NULL,              -- translation group, see translations
  fr_cue_id     INTEGER NOT NULL REFERENCES cues(id),

  -- Filled by annotation and alignment; NULL until then. See docs/runbook.md.
  fr_final        TEXT,                        -- what is actually said (subtitle reconciled with speech recognition)
  en_literal      TEXT,                        -- literal English that keeps the French proper names
  annotated_by    TEXT,                        -- e.g. 'sonnet:annotate-v1'
  audio_start_ms  INTEGER,                     -- where the line is spoken: start of its first aligned word
  audio_end_ms    INTEGER,                     -- end of its last aligned word

  UNIQUE (episode_id, idx)
);

-- One row per translation group and language. A group is the smallest run of
-- consecutive lines whose translation cannot be split further.
CREATE TABLE translations (
  id              INTEGER PRIMARY KEY,
  episode_id      TEXT NOT NULL REFERENCES episodes(id),
  lang            TEXT NOT NULL,               -- 'en'
  group_idx       INTEGER NOT NULL,
  first_line_idx  INTEGER NOT NULL,
  last_line_idx   INTEGER NOT NULL,
  text            TEXT NOT NULL,               -- '' when the source has no translation
  source          TEXT NOT NULL,               -- e.g. 'subtitle:7'
  UNIQUE (episode_id, lang, group_idx)
);

CREATE TABLE scenes (
  id              TEXT PRIMARY KEY,            -- 's01e04-0041-0058'
  episode_id      TEXT NOT NULL REFERENCES episodes(id),
  first_line_idx  INTEGER NOT NULL,
  last_line_idx   INTEGER NOT NULL,
  core_start_ms   INTEGER NOT NULL,            -- start of the first line
  core_end_ms     INTEGER NOT NULL,            -- end of the last line
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('dialogue', 'monologue', 'song')),
  tags            TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  score           INTEGER CHECK (score BETWEEN 1 AND 5),
  why             TEXT,                        -- what makes the scene worth learning from
  selected_by     TEXT NOT NULL,               -- e.g. 'sonnet:select-v1' or 'manual'
  created_at      TEXT NOT NULL,

  -- Filled by the render step; NULL until the scene has media.
  clip_start_ms   INTEGER,                     -- media window, padding included
  clip_end_ms     INTEGER,
  fade_in_ms      INTEGER,                     -- length of the fade at the start of the clip
  fade_out_ms     INTEGER,                     -- length of the fade at the end of the clip
  audio_file      TEXT,                        -- relative to assets/
  video_file      TEXT,                        -- relative to assets/
  frame_times_ms  TEXT,                        -- JSON array: clip-relative time each slideshow frame appears
  audio_lufs      REAL,                        -- measured, not applied
  audio_peak_db   REAL,                        -- measured true peak
  render_params   TEXT,                        -- JSON: every setting used to produce the files

  UNIQUE (episode_id, first_line_idx, last_line_idx),
  CHECK (first_line_idx <= last_line_idx)
);

-- Speech recognition output, as the model produced it apart from the mechanical
-- clean-ups listed in docs/transcription.md. Written once per transcription run of
-- an episode, never edited afterwards.
CREATE TABLE asr_words (
  id          INTEGER PRIMARY KEY,
  episode_id  TEXT NOT NULL REFERENCES episodes(id),
  idx         INTEGER NOT NULL,                -- 1-based, timeline order
  start_ms    INTEGER NOT NULL,
  end_ms      INTEGER NOT NULL,
  text        TEXT NOT NULL,                   -- one word, with any punctuation the model attached
  prob        REAL,                            -- the model's confidence, 0 to 1
  UNIQUE (episode_id, idx)
);

-- The words of lines.fr_final, in order. Created when a line is annotated;
-- timings are filled by forced alignment against the audio.
CREATE TABLE words (
  id          INTEGER PRIMARY KEY,
  line_id     TEXT NOT NULL REFERENCES lines(id),
  idx         INTEGER NOT NULL,                -- 1-based position in the line
  text        TEXT NOT NULL,                   -- the word without surrounding punctuation
  char_start  INTEGER NOT NULL,                -- span of the word in lines.fr_final
  char_end    INTEGER NOT NULL,
  start_ms    INTEGER,                         -- NULL until aligned
  end_ms      INTEGER,
  score       REAL,                            -- alignment confidence, 0 to 1
  UNIQUE (line_id, idx)
);

-- The breakdown of a line into smaller units of language. The units of a line
-- cover all of its words, in order, without overlap.
CREATE TABLE units (
  id              INTEGER PRIMARY KEY,
  line_id         TEXT NOT NULL REFERENCES lines(id),
  idx             INTEGER NOT NULL,            -- 1-based order in the line
  kind            TEXT NOT NULL CHECK (kind IN ('word', 'expression')),
  first_word_idx  INTEGER NOT NULL,            -- words.idx of the unit's first and last word
  last_word_idx   INTEGER NOT NULL,
  text            TEXT NOT NULL,               -- the unit as written in lines.fr_final
  en              TEXT NOT NULL,               -- literal English gloss
  note            TEXT,                        -- what a learner needs beyond the gloss: idiom, pun, slang
  UNIQUE (line_id, idx),
  CHECK (first_word_idx <= last_word_idx)
);

-- Notes on a scene's cultural references and wordplay, written so that a
-- child can follow them. A scene has zero or more. See docs/content-steps.md.
CREATE TABLE notes (
  id              INTEGER PRIMARY KEY,
  scene_id        TEXT NOT NULL REFERENCES scenes(id),
  idx             INTEGER NOT NULL,            -- 1-based order in the scene
  kind            TEXT NOT NULL CHECK (kind IN ('reference', 'wordplay')),
  text            TEXT NOT NULL,               -- the note
  phrase          TEXT,                        -- the word or phrase it explains, as written in the French. NULL when it is about the scene as a whole
  line_id         TEXT REFERENCES lines(id),   -- the line that holds the phrase
  first_word_idx  INTEGER,                     -- words.idx span of the phrase in that line. NULL when the phrase could not be located
  last_word_idx   INTEGER,
  UNIQUE (scene_id, idx)
);

-- Lines (or one unit of a line) that the user marked in the review UI as needing a
-- fix, for the review-fixer agent. See docs/review-ui.md, "Review marks".
CREATE TABLE review_marks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,  -- never reused, even after a delete
  scene_id     TEXT NOT NULL REFERENCES scenes(id),  -- the scene it was marked in
  line_id      TEXT NOT NULL REFERENCES lines(id),   -- a line of that scene
  unit_idx     INTEGER,                      -- units.idx of the marked unit, NULL for the whole line
  unit_text    TEXT,                         -- that unit's text when marked (re-annotation renumbers units)
  category     TEXT NOT NULL
               CHECK (category IN ('translation', 'french', 'units', 'timing', 'notes', 'other')),
  comment      TEXT NOT NULL DEFAULT '',     -- the user's words: what is wrong, what it should be
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  created_at   TEXT NOT NULL,                -- ISO 8601, UTC
  resolved_at  TEXT,                         -- set with status done or dismissed
  resolution   TEXT,                         -- what the fixer did, or why the mark was dismissed
  CHECK ((unit_idx IS NULL) = (unit_text IS NULL)),
  CHECK ((status = 'open') = (resolved_at IS NULL))
);

CREATE VIEW scene_lines AS
SELECT s.id AS scene_id,
       l.id AS line_id,
       l.idx AS line_idx,
       l.start_ms,
       l.end_ms,
       l.start_ms - s.clip_start_ms AS clip_start_offset_ms,
       l.end_ms - s.clip_start_ms   AS clip_end_offset_ms,
       l.fr,
       l.speaker,
       l.is_song,
       l.group_idx,
       l.fr_final,
       l.en_literal,
       l.audio_start_ms,
       l.audio_end_ms
FROM scenes s
JOIN lines l
  ON l.episode_id = s.episode_id
 AND l.idx BETWEEN s.first_line_idx AND s.last_line_idx;

-- Each unit with the time span of its words. A unit has a time span only when
-- every one of its words is aligned. min_score ignores words aligned without a
-- score (numbers and other tokens the aligner cannot spell) and unscored_words counts them.
CREATE VIEW unit_times AS
SELECT u.id AS unit_id,
       u.line_id,
       u.idx,
       u.kind,
       u.first_word_idx,
       u.last_word_idx,
       u.text,
       u.en,
       u.note,
       CASE WHEN SUM(w.start_ms IS NULL) = 0 THEN MIN(w.start_ms) END AS start_ms,
       CASE WHEN SUM(w.start_ms IS NULL) = 0 THEN MAX(w.end_ms) END   AS end_ms,
       MIN(w.score) AS min_score,
       SUM(w.start_ms IS NULL) AS untimed_words,
       SUM(w.start_ms IS NOT NULL AND w.score IS NULL) AS unscored_words
FROM units u
JOIN words w
  ON w.line_id = u.line_id
 AND w.idx BETWEEN u.first_word_idx AND u.last_word_idx
GROUP BY u.id;
