# Game rules as implemented

The rules of levels, due days, the day's flow, candidates, streaks, XP, rewards, leagues and social, as the code applies them. Read before changing levels, due days, daily quests, streaks, XP, rewards or leagues. What the user wants is [intent.md](intent.md); where the two differ, intent.md wins and the code is to change (the known gaps are named below).

## Contents

- **Where the rules live**: `shared/rules.ts` and the worker files that apply it.
- **Days**: the kid's day (from 03:00), the time zone set once, the week.
- **Levels and due days**: passing a practice, the waits, replays.
- **Daily quests**: how the day's quests are built, the lock on choosing, credit, "Do more", chests.
- **Candidates and unlocking**: the draws, songs first.
- **Skill, stars and weak spots**: what a finished practice changes besides the level.
- **Streaks and potions**.
- **XP, rank and sesterces**.
- **Chests, shop, items and achievements**.
- **Question spacing**: a joke must not get old.
- **Leagues and social**.

## Where the rules live

- `app/shared/rules.ts` holds the constants and pure functions. The server is the authority and changes state with them; the client uses them only to display (for example the days until the next level). Name a constant here rather than copying its value into a doc.
- The worker applies them: `worker/quests.ts` (building, reading and crediting the day's quests, "Do more"), `worker/daily.ts` (candidates, unlocking, the routes of the day), `worker/practice-pick.ts` (what starting a scene plays), `worker/practices.ts` (starting, saving and completing a practice: XP, levels, skill, the streak), `worker/rewards.ts` (chests, shop, views, client counters), `worker/tx.ts` (achievements, the potion cap, the kid's day), `worker/league.ts`, `worker/social.ts`. Constants that live there are named in the sections below.
- Only scenes of the release (`app/data/release.json`, the bundle's scenes) count. Progress on a scene outside it stays in D1 but is left out of the player state and every choice.

## Days

- **The kid's day** (`kidDay`) is `YYYY-MM-DD` and starts at `DAY_START_HOUR` (03:00) in the account's time zone, so a practice finished just after midnight counts for the evening it was played. It is the one boundary for everything: quests, candidates, due days, streaks, leagues, the shop's specials, the activity log (`tx.today`). The client shows the time until the next day with `minutesUntilNextDay`.
- **The time zone is set once**, when the account is made (the IANA zone the client sends; an invalid one falls back to `DEFAULT_TIME_ZONE`), and changes only through `PATCH /api/me`: `POST /api/session` and `POST /api/login` never change it, so a phone left on UTC and an iPad in Toronto do not split the kid's days.
- Weeks run Monday to Sunday (`weekOf` of the kid's day); leagues use them.

## Levels and due days

- `LEVELS`: none, bronze, silver, gold, titanium, diamond, plutonium (0 to `MAX_LEVEL`). A practice row's `level` is the level it earns when passed (1 to 6).
- **Passing** (`applyPass`): finishing a practice passes it. A scene without a level gets bronze. A scene with a level rises one step when today is on or after its `dueDay`. On a rise, `dueDay` becomes today plus `LEVEL_WAIT_DAYS[level − 1]` days (`dueDayAfter`); plutonium has no next level. Because every wait is at least a day, a scene rises at most one step a day. This matches intent.md.
- A practice for the next level can be started only when it is due (`isDue`). Before that, starting the scene plays a **replay**: the whole practice at the scene's current level (a plutonium scene always replays), XP only: puzzle XP and `XP.replay` (plus the perfect bonus), no sesterces, no level, no quest; it counts for the light streak and the counters. A started replay is continued like a practice; one left open is dropped when a new replay of the scene starts. A practice started for a level the scene has meanwhile passed only counts as a pass without a new level.
- What starting a scene plays (`scenePracticeRow`, `PlayerState.practices`): its started practice for the next level; else, when the next level is due, a new practice for it; else its started replay at the current level; else a new replay.
- `daysUntilNextLevel` gives the wait to show; `overdueDays` sorts due scenes.
- Practices never expire: a started one waits until the kid continues it, at the next unfinished puzzle, however long after; only the count is saved. A practice is played in one go with no breaks; the kid may leave after any puzzle.

## Daily quests

What Home asks for each day (intent.md, "Daily quests and streaks"). A quest is either choosing new scenes or passing a practice at a level.

- **Built once**, at the day's first visit (any request that reads the day: `ensureDaily`), stored in `daily.quests`, so they never reshuffle during the day (`planQuests` in `shared/rules.ts`, `buildQuests` in `worker/quests.ts`):
  1. up to `MAX_WAITING_QUESTS` practices that wait: levels due (silver and up), most overdue first; then bronze practices started on an earlier day and not finished, most recently played first (reason `continue`). A scene unlocked earlier and never started is not a quest; it waits in the Episodes tab. Being overdue costs nothing, and the others wait for later days;
  2. one **choose quest** (choose `DAILY_UNLOCKS` of `DAILY_CANDIDATES` candidates; fewer when fewer locked scenes are left; none when every scene is unlocked, and then the practices that wait take up to `MAX_QUESTS` places);
  3. places for the bronze practices of the scenes chosen, up to `MAX_QUESTS` quests in all. A place gets a scene when one is chosen (the first place the first scene); scenes chosen beyond the places wait in the Episodes tab.

  Examples: nothing due: choose and three bronze places (4); one due: 5; after a long absence: three due, choose, one bronze place (5).
- **The lock**: the choose quest is locked while any practice quest before it (the practices that wait) is not done; choosing then answers `409 choose-locked`, and the state names the quests it waits for (`waitingFor`). A kid with nothing waiting can choose at once (the user, 2026-11-14: "finish first the preceding higher-level repetition and practices"). A bronze practice started on an earlier day locks it too, like a due level.
- **Choosing**: the choose quest stays open, and reachable from Home, until its target is chosen; the kid may choose one scene, leave, and come back later the same day for the others. The choice that reaches the target does the quest; the candidates not chosen go back to the pool at once, and the next day draws afresh (the user, when 5 were offered: "after you chose the last third out of the five, then the rest would go back … we don't need to have a separate action for that").
- **A practice quest** is done when a practice on its scene at its level is completed (not a replay), on that day. A practice finished later counts for the day it is finished on.
- **Credit**: each quest once, inside the batch of the request that did it (`questDone`): the quest's chest, `XP.quest` and `SESTERCES.quest`, the `questsDone` counter. A completion or an unlock happens once (the `rev` guard), so a retried save, a lost answer or a second tab neither doubles nor loses credit.
- **Chests**: by position among the day's quests, the last gold, the one before silver, the others wood (`questChest`); every quest "Do more" adds gives a wood chest (`EXTRA_QUEST_CHEST`).
- **"Do more"** (`POST /api/daily/more`), as often as the kid likes, once every quest of the day is done, the extra ones too, and locked scenes are left: a fresh draw of candidates (none offered earlier that day while others are left) with an extra choose quest and a bronze place for each scene to choose, all marked extra (round 1, 2…). They give chests and XP but are not needed for the full streak and never touch the next day.
- What the client sees: `DailyState` in `shared/api.ts` and [app-server.md](app-server.md), "Daily quests: the contract".

## Candidates and unlocking

- Each draw is `DAILY_CANDIDATES` (10, the user, 2026-11-17; it was 5) scenes from the locked release scenes, seeded by kid, day and round: the day's draw when the day's quests are built, one more per "Do more". The choose quest keeps its draw; `daily.candidates` lists every scene offered that day. The kid unlocks up to the choose quest's target of the current draw (`POST /api/daily/unlock`; errors `not-offered`, `already-unlocked`, `no-unlocks-left`, `choose-locked`).
- Weight: the score squared, times `e^(−|difficulty − skill|)`, times a random factor; drawn without replacement (`worker/daily.ts`).
- **Songs first** (intent.md, "Choosing new scenes"): on day one (nothing unlocked) the draw takes one locked scene of each starter song (`ContentIndex.songs[].starter`, scenes by `songId`, earlier scenes weighted up), then easy, high-score, short scenes (difficulty ≤ 2, score ≥ 4, not more of those songs), then any. On later days, while any song scene is locked, one candidate is a song scene. The export gives song scenes score 5 ([app-export.md](app-export.md)).
- A candidate can be watched before choosing: a view of a locked scene answers `200` and counts nothing. Practices and speech on a locked scene answer `403 scene-locked`.
- Fewer than `DAILY_CANDIDATES` locked scenes give fewer candidates; on day one, fewer easy scenes than places are made up from any locked scene. A day's draw is stored in `daily.candidates` and the choose quest when the day's quests are built, so a day drawn before the change keeps its 5 until the next draw. Each unlock refreshes the counter of episodes whose every release scene is unlocked.

## Skill, stars and weak spots

- **Stars** (`practiceStars`): from mistakes plus half the hints per puzzle. Finishing is passing; stars only grade.
- **Skill** (`SKILL_MIN` to `SKILL_MAX`, starting at `SKILL_START`): after each completed practice it moves one fixed step (`SKILL_STEP` in `worker/practices.ts`) up for a clean practice and down for a messy one, by the same thresholds as the stars. It steers the candidate draw.
- **Weak spots**: per kid and unit, and per kid and puzzle type, D1 counts seen and missed (missed = in `missedUnitIds`, or the puzzle used a hint). They do not steer composition: the plan carries `focusUnitIds`, but the composer builds with an empty set.

## Streaks and potions

- **A light streak day**: the kid finished a practice that day, a replay included (`streakOnPractice`; a replay is a whole practice). **A full streak day**: it is a light day and every one of the day's quests (not the extra ones) is done (`markFullIfDone`); a day without any quest is never full. The `days` table keeps each day's kind (`light`, `full`, `saved`) and the practices and XP of the day; `Streak.week` shows the last `STREAK_WEEK` days.
- The streak counter counts consecutive days with at least a light streak. Each missed day since the last counted day uses one potion (a streak freeze), which saves it as a light day (kind `saved`, shown with its potion; friend streaks do not count it). Without enough potions the streak restarts at 1 and the potions are kept. A kid holds at most `MAX_STREAK_FREEZES`; potions beyond the cap turn into sesterces. The completion that uses potions says so (`streak.freezesUsed`).
- `displayedStreak` is what Home shows before today counts: 0 once the streak can no longer be saved. Milestones (`STREAK_MILESTONES` in `worker/practices.ts`) go to the friends' feed.

## XP, rank and sesterces

All amounts are in the `XP` and `SESTERCES` objects of `shared/rules.ts`.

- XP for each finished, unskipped puzzle, credited at the progress save that reports it, so leaving mid-practice keeps it.
- XP and sesterces for each quest done (`XP.quest`, `SESTERCES.quest`; they were per stop and per sitting before the quests).
- At the end of a practice: XP for a new level, or `XP.replay` for a replay or a pass without one; extra XP for a perfect practice (no mistakes, no hints); sesterces for a new level and for a perfect practice, never for a replay. The completion response's `rewards.xp` leaves out what progress saves already credited; `creditedXp` is that part, and the results show the sum: the XP of the whole practice.
- A full watch of an unlocked scene in view mode: XP per view, at most `CAPS.viewsPerDay` a day (`worker/rewards.ts`).
- Rank comes from total XP (`xpRank`, thresholds `xpForRank`); a new rank goes to the feed.

## Chests, shop, items and achievements

- **Chests** (`LOOT` in `worker/rewards.ts`): per kind, a range of sesterces and XP, a chance of a potion and of an item, and rarity weights. The item is drawn among catalog items whose sources include that chest kind. An item already owned becomes `DUPLICATE_SESTERCES` by rarity; a potion over the cap becomes `POTION_AS_SESTERCES`. Chests come from quests and from achievements.
- **Shop**: catalog items with a shop source and a price; `FEATURED` of them a day, the same for everyone, at `FEATURED_DISCOUNT`; a potion for `POTION_PRICE`, refused at the cap (`potions-full`). Duplicates may be bought, to give away.
- **Items** are data in `shared/catalog/items.ts`. Starter items are owned by everyone without inventory rows and cannot be given.
- **Achievements** are data in `shared/catalog/achievements.ts`: `{ id, names, condition: { stat, gte }, reward }` over the per-kid counters (`StatKey` in `shared/catalog/types.ts`). Adding one is adding data. They are checked on every commit after refreshing the derived counters (XP, streak, scenes unlocked, scenes at each level or better, items owned), granted once each, repeated until nothing new is earned. Achievement ids are stored per kid: never rename one. The practice achievements count `practicesFinished` (replays included), `perfectPractices` (no mistake, no hint) and `questsDone` (extra quests included); their ids (`first-lesson`, `lessons-*`, `quizzes-30`, `perfect-*`) are older names kept because they are stored.
- Sizes: `unlock-100` asks for 100 scenes and `unlock-all` for every scene of the release (203; a catalog test checks the number against `app/data/release.json`, so change it with the release). `perfect-10` and `perfect-50` ask for 5 and 15 perfect practices: a whole practice (24 to 50 puzzles) with no mistake and no hint is much rarer than the 10-puzzle sitting they were sized to, so the ladder follows `lessons-50` and `lessons-150` at roughly one perfect practice in ten.
- **Client counters**: `POST /api/events` accepts `loopsHeard` and `songsSung` within per-request and per-day caps (`CAPS` in `worker/rewards.ts`); other stats are ignored.

## Question spacing

A kid sees a given question at most `QUESTION_MAX_SHOWS` times in all, never twice on one day, and only after `QUESTION_GAP_DAYS` since the previous showing (`questionEligible`). Within one practice a question is asked at most once (the composer drops it from the allowed ids once used; a scene's practice then asks its other questions or covers the meaning with other puzzle types). Starting a practice sends the eligible ids of its scene as `allowedQuestionIds`; a continued practice keeps its list. Completing it records each distinct question its outcomes name, once per day. The data path through the composer is in [app-architecture.md](app-architecture.md), "Our own French".

## Leagues and social

- **Leagues** (`worker/league.ts`): weekly XP tables in `LEAGUE_TIERS`, groups of up to `LEAGUE_GROUP_SIZE`. A kid joins a group of their tier (the fullest one with room first) on their first XP of the week. The first time a member of last week's group is seen in a new week, the group is settled once: the top `LEAGUE_PROMOTE` go up (not from the top tier), the bottom `LEAGUE_DEMOTE` go down when the group has at least `DEMOTE_MIN_GROUP` members (not from the bottom tier).
- **Social** (`worker/social.ts`): search by name prefix (2 characters or more); follow up to `MAX_FOLLOWS`; friends are everyone the kid follows or who follows them; a friend streak (`friendStreak`) counts the days in a row on which both finished a practice. The feed shows the milestones of followed kids from the last `FEED_DAYS` days (levels from gold up, ranks, streak milestones, unlocks, achievements). Gifts go only to someone followed: `GIFTS_PER_DAY` in all, cheers included, of which `MOVES_PER_DAY` items or potions; one cheer per feed item; a given item comes off the giver's avatar when no longer owned; a potion is refused when the receiver is full. No free text anywhere: cheers are fixed stickers (`shared/catalog/cheers.ts`).
