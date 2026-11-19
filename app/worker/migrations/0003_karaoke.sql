-- Karaoke recordings (docs/app-server.md, "Karaoke recordings"): a kid's singing over one of the songs.
-- A take that passed the check waits here unsaved (`saved` 0: one per kid and song, replaced by the
-- next, deleted by "drop" and by the daily job after a day); "save" turns it into the kid's recording
-- of the song (`saved` 1: one per kid and song, replacing the older one). Audio that did not pass the
-- check is never written.
--
-- One row per chunk of the WAV (16 kHz mono 16-bit PCM, up to about 1.8 MB for the longest song), as
-- base64 text: D1 caps a row at 2,000,000 bytes, and its binding moves values as JSON, where a BLOB
-- travels as an array of numbers (about 3.6 characters a byte) and base64 as 1.33.
CREATE TABLE recordings (
  id TEXT NOT NULL,                       -- the take's id, kept when it is saved (the audio URL carries it)
  user_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  saved INTEGER NOT NULL DEFAULT 0,
  part INTEGER NOT NULL,                  -- chunk index from 0
  parts INTEGER NOT NULL,
  offset_ms INTEGER NOT NULL,             -- where the first sample sits on the song
  duration_ms INTEGER NOT NULL,
  bytes INTEGER NOT NULL,                 -- of the whole WAV
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL                      -- this chunk of the WAV, base64
);
CREATE UNIQUE INDEX recordings_one ON recordings (user_id, song_id, saved, part);
CREATE INDEX recordings_id ON recordings (id, part);
CREATE INDEX recordings_unsaved ON recordings (saved, created_at);

-- Karaoke takes checked today (the cost guard, KARAOKE_TAKES_PER_DAY).
ALTER TABLE daily ADD COLUMN karaoke_n INTEGER NOT NULL DEFAULT 0;
