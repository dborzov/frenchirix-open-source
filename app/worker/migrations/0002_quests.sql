-- Daily quests replace the three stops, sittings and bonus sittings (docs/app-rules.md, "Daily quests").
-- Rows written by release 2.2 are moved over where it is cheap; the rest may stay inconsistent (only
-- test accounts existed), as long as nothing reads them wrongly.

-- Counters: sittings and daily quizzes are gone. practicesFinished counts the practices finished so
-- far; questsDone takes the daily quizzes; perfectPractices starts at 0. Achievement ids stay.
UPDATE users SET stats = json_remove(
  json_set(stats,
    '$.practicesFinished', (SELECT count(*) FROM practices p WHERE p.user_id = users.id AND p.status = 'done' AND p.bonus = 0),
    '$.questsDone', coalesce(json_extract(stats, '$.dailyQuizzesFinished'), 0),
    '$.perfectPractices', 0),
  '$.sittingsFinished', '$.perfectSittings', '$.dailyQuizzesFinished');

-- Bonus sittings are gone: drop the open ones (their XP was credited as they were played). A replay
-- is a practice at the scene's current level, `replay = 1`, earning XP only.
DELETE FROM practices WHERE bonus = 1 AND status = 'open';
DROP INDEX practices_scene_level;
ALTER TABLE practices RENAME COLUMN bonus TO replay;
CREATE UNIQUE INDEX practices_scene_level ON practices (user_id, scene_id, level) WHERE replay = 0 AND level IS NOT NULL;
ALTER TABLE practices DROP COLUMN kind;
ALTER TABLE practices DROP COLUMN slot;
ALTER TABLE practices DROP COLUMN sittings;
ALTER TABLE practices DROP COLUMN sittings_done;
ALTER TABLE practices DROP COLUMN sitting_mark;
ALTER TABLE practices DROP COLUMN sitting_flaws;

-- The day's quests, built once at the day's first visit (NULL until then): JSON StoredQuest[]
-- (worker/quests.ts). `candidates` now lists every scene offered today, over all draws.
ALTER TABLE daily ADD COLUMN quests TEXT;
ALTER TABLE daily DROP COLUMN quizzes;

-- How each day shows in the streak: 'light' (a practice finished), 'full' (every one of the day's
-- quests done too), 'saved' (a missed day a potion saved; no practice that day).
ALTER TABLE days ADD COLUMN kind TEXT NOT NULL DEFAULT 'light';

UPDATE chests SET source = 'quest' WHERE source = 'daily';
