# The Worker: server, API, D1 and speech

What the Cloudflare Worker in `app/worker/` does: the request pipeline, the gate and the `/dev` admin, sessions and accounts, the API, the D1 schema and migrations, `TEST_MODE`, speech recognition with its judge (and why it is built that way), karaoke recordings, and the activity log and the kids' problem reports. Read before changing the Worker, the D1 schema or migrations, the API, accounts, speech recognition and its judge, or what is logged. The contract it honours is `app/shared/api.ts`; the game rules it applies are in [app-rules.md](app-rules.md).

## Contents

- **Rules**: the few that must always hold.
- **Files**: what each worker file does.
- **Request pipeline**: the order of middleware, cache headers.
- **Gate and `/dev` admin**: passwords, cookies, public files, the gate page's language and layout.
- **Sessions and accounts**: creating a kid, login, logout, switching player on a shared device, names.
- **API**: every route.
- **Daily quests: the contract**: the quest state, the endpoints of the day, practices, what the client builds on.
- **Concurrency**: one batch per request, the `rev` guard.
- **D1 schema and migrations**: the tables and the conventions.
- **TEST_MODE, LOCAL_DEV and the clock**.
- **Speech recognition and the judge**: `POST /api/speech`, the decision, the scorer.
- **Why this speech design**: what was measured and decided.
- **Karaoke recordings**: a take checked for rude words, kept, removed; storage in D1; what Whisper did.
- **Activity log and reports**: `POST /api/log`, `POST /api/reports`, the two tables, what the Worker logs itself, the daily purge.
- **Worker tests**.

## Rules

- The server is the authority on every rule and every reward; the client only displays. Every mutating response carries the changed parts of the player state as `patch`.
- Errors go through `fail(status, code, message?)` (`worker/util.ts`) and answer `{ error, message?, retryAfterS? }`; codes are `ApiErrorCode` in `shared/api.ts`. The client sorts them into a few kinds and shows one message per kind, or the code's own `common.error.<code>` for a plain refusal ([app-architecture.md](app-architecture.md), "Errors"). An answer that says "the screen was out of date" (`practice-closed`, `already-unlocked`, `already-owned`…) makes the client refresh its state, so such codes are worth returning rather than succeeding silently or failing with a 500.
- `TEST_MODE` is `""` in `wrangler.jsonc` and never set in production; `LOCAL_DEV` is never in `wrangler.jsonc`. `tools/deploy.sh` refuses either.
- Never edit a migration that production has applied; add the next number.
- Kids' accounts have no email (intent.md, "Accounts").

## Files

| File | What |
|---|---|
| `worker/index.ts` | The Hono app: error handler, the request pipeline, API routers, static assets with cache headers. |
| `worker/gate.ts` | The password page, the gate cookie, `POST /gate`, the rate-limit helpers. |
| `worker/admin.ts` | `LOCAL_DEV` on localhost, the `/dev` sign-in page and cookie. (`requireAdmin` is defined but unused.) |
| `worker/pwa.ts` | The build id on every response, `GET /api/build`, `MIN_CLIENT_BUILD`, the public install files. |
| `worker/session.ts` | `POST /api/session`, `POST /api/login`, `POST /api/logout`, `requireSession`, `runTx`. |
| `worker/tx.ts` | `UserTx`: one request's view of one kid, achievements, the batch commit, the patch. |
| `worker/state.ts`, `me.ts` | The full `PlayerState`; `GET/PATCH /api/me`. |
| `worker/daily.ts` | Candidates, unlocking, "Do more", the routes of the day. |
| `worker/quests.ts` | The day's quests: building them, the state the client sees, the lock, crediting them, "Do more". |
| `worker/practice-pick.ts` | Reading practice rows; what starting a scene plays; per-scene practices. |
| `worker/practices.ts` | The practice routes: start, progress, complete (levels, rewards, the streak, the quest). |
| `worker/rewards.ts` | Chests, the shop, scene views, client counters. |
| `worker/social.ts`, `league.ts` | Social; weekly leagues. |
| `worker/speech.ts` | `POST /api/speech`: Whisper, the decision, the judge. |
| `worker/karaoke.ts` | Karaoke recordings: a take checked, kept, dropped, removed; the audio for its kid; the daily purge of unsaved takes. |
| `worker/activity.ts` | `POST /api/log`, `POST /api/reports`, `logTx`/`logNow` (the Worker's own events), `purgeActivity` (the daily cron). |
| `worker/content.ts` | `index.json` and scene JSON through `env.ASSETS`, cached per isolate. |
| `worker/testing.ts` | Test helpers (see "Worker tests"). |

## Request pipeline

The Worker runs first on every request (`run_worker_first`), in this order (`worker/index.ts`):

1. Every response gets `x-frx-build` (the deployed build; [app-release.md](app-release.md) explains how clients use it).
2. Outside the gate: `GET /api/health`, `POST /gate`, the gate page's own files (`GATE_PUBLIC_FILES`: the cover art and two comic fonts, exact paths, GET and HEAD only), the install files (`APP_PUBLIC_FILES`: manifest, icons, favicon, because browsers fetch the manifest without cookies), and `POST /dev/login`.
3. `/dev` and `/dev/…` need the admin cookie (or `LOCAL_DEV` on localhost): a navigation gets the admin sign-in page, anything else `401`.
4. The gate: without a valid gate cookie (or the admin cookie, or `LOCAL_DEV` on localhost), a navigation (`Sec-Fetch-Mode: navigate`, or `Accept: text/html` on GET) gets the gate page, anything else `401 { error: 'gate' }`.
5. `GET /api/build` (`{ build, minClient, content }`, no session); then every other API call from a client older than `MIN_CLIENT_BUILD` answers `409 client-outdated`.
6. The API, behind `requireSession` except `POST /api/session` and `POST /api/login`.
7. Static assets from `ASSETS` with cache headers: `/assets/*` (hashed by Vite) immutable, and a missing one is a `404`, not the app shell; `/data/*` and `/media/*` with `?v=` equal to the deployed content version immutable, another `v` is `no-store`; `/data/index.json` and HTML `no-cache`; other `/data` and `/media` a week. There is no speech-generation endpoint: question audio is static ([app-tts.md](app-tts.md)).

## Gate and `/dev` admin

- **Variable** (`wrangler.jsonc` vars): `TEST_MODE` (`""`). **Secrets** (`wrangler secret put`; `.dev.vars` locally): `GATE_PASSWORD` (the shared password of the gate, intent.md "Accounts"), `ADMIN_PASSWORD` (the `/dev` portal), `SESSION_SECRET` ([app-release.md](app-release.md), "Variables and secrets"). Bindings: `DB`, `AI`, `ASSETS`.
- **The gate page** is the front cover of a comic, always in English like a new account's interface (`gate.*` strings; the browser's language is not followed, [intent.md](intent.md), "Look and platform"): the cover art (`app/public/gate/`), a balloon asking for "the magic word", a text field and one button. It works as a plain form post without script; an inline script posts JSON and plays `OOPS!` or `POW!`. Nothing on it gives the password or its length away.
- **Its layout** fills the screen without scrolling at the iPad and phone sizes tested first (iPad 768×1024, 820×1180, 1024×1366 and the same in landscape; phones 375×667, 390×844, 430×932, and 844×390 in landscape). Portrait is a column (masthead, picture, answer, footer) where the picture takes the height left over, between 16:9 and a little taller than wide; landscape (wider than 5:4) puts the picture beside the answer, sized from the height, with a compact masthead and no footer under 521 px of height (a phone on its side). Heights use `100dvh` minus the safe-area insets. The on-screen keyboard covers the page without resizing it on iOS and Android Chrome: the browser scrolls the focused field into view, and the page's script scrolls it to the middle only when it is still hidden once the keyboard is up (`visualViewport`), so nothing jumps on a desktop or an iPad with a hardware keyboard.
- **`POST /gate`**: form (answers `303` to `next`, same-site paths only) or JSON (`204`). The password is trimmed and compared case-insensitively in constant time. A wrong one waits 400 ms (not in `TEST_MODE`); `GATE_FAIL_LIMIT` (200) failures per address in 15 minutes give `429` with `retryAfterS`. The limit is high on purpose: a whole classroom shares one address, and the password is a word the teacher says out loud (it was 10, and one class could lock itself out).
- **`POST /dev/login`**: the same shape against `ADMIN_PASSWORD` (form `303` to a `/dev` path, JSON `204`), the same delay, and its own limit of 10 failures per address (only the admin signs in there). The admin cookie also counts as the gate.
- **Cookies**, all `HttpOnly; SameSite=Lax; Path=/`, `Secure` on https, 400 days:
  - `fx_gate`: `v1.<issued ms>.<HMAC-SHA256(SESSION_SECRET, "gate|<password lower case>|<issued>")>`. Changing `GATE_PASSWORD` or `SESSION_SECRET` sends everyone back to the gate.
  - `fx_admin`: the same over `"admin|<password>|<issued>"`.
  - `fx_sid`: the session token (32 random bytes, base64url); D1 keeps its SHA-256. Refreshed with `seen_at` at most once a day.

## Sessions and accounts

- **`POST /api/session`** without a valid session cookie creates a kid: a random funny French name (`shared/catalog/names.ts`: nouns and adjectives agreed in gender, at most 20 characters, retried on collision, a two-digit suffix after 8 collisions), a random three-digit PIN, the time zone sent (invalid falls back to `DEFAULT_TIME_ZONE`). With a cookie it returns the same kid; the zone is set only at creation (and by `PATCH /api/me`): neither this call nor `POST /api/login` changes it.
- **`POST /api/login`** (name and PIN; the player selection sends a remembered account's stored ones): 5 failures per account (`LOGIN_FAILS_PER_ACCOUNT`) and 200 per address (`LOGIN_FAILS_PER_ADDRESS`, a classroom behind one address) in 15 minutes, then `429` with `retryAfterS` (the login screen shows it in minutes). Spaces in the typed name become `-` (names have none: « hibou farceur » is « hibou-farceur »), and the name is compared by `name_key`. On success the browser's previous session is deleted, and its account too when it holds nothing (no XP, no chosen name, no unlocked scene, follows, items or gifts); `previousDeleted: true` in the answer says so, and the device forgets that account. A kid who lost their login asks the admin, who reads the name and `pin` in D1 ([app-release.md](app-release.md), "Reading the log and the reports").
- **`POST /api/logout`** ("New player" on the player selection): deletes this browser's session row and expires `fx_sid` (`Max-Age=0`); the account is deleted too when it holds nothing, as at login. Answers `{ deleted }` (`LogoutResponse`), also without a session (`deleted: false`). The client then clears what the device kept for that kid (`forgetKid` in `web/src/pwa/stored.ts`, the onboarding flags), marks "Played before?" answered for the new kid, and boots, which makes a new kid.
- **Switching player on a shared device** ([intent.md](intent.md), "Accounts": several kids share one iPad and one browser). The device remembers every account loaded on it in `localStorage` `frx.accounts` (`web/src/state/accounts.ts`: id, name, PIN, avatar, last used; at most 30, the one used longest ago goes first), refreshed whenever the state loads or the profile changes (`state/player.ts`), so the current account is always in it. The profile's "Switch player" (« Changer de joueur ») opens the player selection, `/players` (`screens/Players.tsx`): the remembered accounts as avatar tiles (tap one: `POST /api/login` with its stored name and PIN, nothing typed), "New player" (`POST /api/logout`, as above; for an account that holds nothing it only goes Home), "I have an account" (`/login`, name and PIN typed), and a remove button on every tile but the current one (a dialog shows the name and PIN to write down first; it only forgets the account on this device). An account the server deleted (it held nothing when the kid switched away) leaves the list. A stored name that no longer works (renamed on another device, `bad-credentials`) opens `/login?name=…&stale=1`: the name prefilled and a plain message; logging in updates the entry (same id). Other failures follow the app's rule: a toast with the kid's message and the admin's line, the screen as it was. The "Played before?" welcome on an empty account offers the remembered accounts the same way when there are any ("Who's playing?", `pwa/Overlay.tsx`). Switching keeps the device's onboarding flags (tips, the welcome); "New player" clears them. A practice is never interrupted by it: the practice screen has no tab bar, so the profile is out of reach there. Tests: `worker/session.test.ts` (the answers, switching back and forth), `web/src/state/accounts.test.ts`, `account.test.ts`, and end to end `e2e/errors.worker.spec.ts`.
- **`PATCH /api/me`**: name (`NAME_RE`, not rude, unique by `name_key`; errors `name-invalid`, `name-rude`, `name-taken`), language, speak, time zone (validated), avatar (`validateAvatar` against owned items, JSON under 2 kB), `seenAchievements`.
- **Names**: `name_key` is lower case without accents and unique. The bad-word filter (`shared/catalog/badwords.ts`, `checkName`) normalises (lower case, no accents, `0 1 3 4 5 7 8 @ $ ! € |` mapped to letters, separators dropped, repeated letters collapsed); unambiguous words match anywhere, short ones (`con`, `cul`, `ass`…) only as a whole word, the whole name or spelled out letter by letter. Its tests cover both directions (`assassin`, `Scunthorpe`, `calcul` pass).

## API

Types in `shared/api.ts`. All under `/api` and behind the gate and a session unless noted.

```
GET  /api/health                       outside the gate: { ok, testMode }
GET  /api/build                        gate, no session: { build, minClient, content }
POST /api/session    POST /api/login   POST /api/logout   GET /api/me    PATCH /api/me
GET  /api/daily                        today's quests, the current candidates, unlocks left  ->  { daily }
POST /api/daily/unlock                 { sceneId }  ->  { quest }   (400 not-offered, already-unlocked, no-unlocks-left; 409 choose-locked)
POST /api/daily/more                   "Do more", no body  ->  { daily }   (409 more-unavailable)
POST /api/practices/start              { kind: 'scene', sceneId } | { kind: 'resume', practiceId }, plus composerVersion  ->  { plan: PracticePlan }
POST /api/practices/:id/progress       { done, total?, outcomes }  ->  { done, xp }
POST /api/practices/:id/complete       { outcomes, ms }  ->  level, replay, rewards, level changes, stars, quest, chest, streak, achievements, creditedXp
POST /api/scenes/:id/view              a full watch in view mode
POST /api/events                       batched client counters (loops heard, songs sung)
POST /api/speech?scene=&line=|unit=|alt=|choice=&attempt=&type=   body: WAV, 16 kHz mono
POST /api/karaoke/:song/take?offset=   body: WAV  ->  { verdict, take }   (400, 404, 413 too-big, 429, 503)
POST /api/karaoke/:song/save { takeId }  ->  { recording }   (409 no-take)
DELETE /api/karaoke/:song/take   DELETE /api/karaoke/:song/recording   GET /api/karaoke/audio/<id>.wav
POST /api/log                          a batch of client events (with or without a session): 204
POST /api/reports                      "Quelque chose ne va pas ?" (with or without a session): { id }
POST /api/chests/:id/open    GET /api/shop    POST /api/shop/buy   (409 already-owned, not-enough-sesterces, potions-full)
GET  /api/social/search?q=   POST|DELETE /api/social/follow   GET /api/social/friends   POST /api/social/gift   GET /api/social/inbox
GET  /api/league
```

- **Start**: `scene` continues that scene's started practice for its next level, else starts its next level when due, else continues its started replay, else starts a replay (the practice at the scene's level, XP only; [app-rules.md](app-rules.md), "Levels and due days"); a locked scene answers `403 scene-locked`. `resume` reopens an open row and answers `409 practice-closed` for a finished one (the practice screen sends it whenever it is opened from history or a reload, [app-architecture.md](app-architecture.md), "Errors"). Any other `kind` (the old `daily` and `practice`) answers `400 bad-request`. Every start carries the client's `COMPOSER_VERSION`, stored with a new plan and returned as `plan.composerVersion`. The plan also carries the seed, the scene, `level`, `replay`, `done`, `total`, the saved outcomes and `allowedQuestionIds`.
- **Progress**: only the kid's own open row (`practice-closed` otherwise). The client sends each save once and lets the kid move on only when it is answered; sending the same save again is harmless (`done` is a maximum, outcomes merge by puzzle id and are credited once). `done` is the larger of stored and sent; outcomes are cleaned (the practice's scene, its units, clamped numbers) and merged by `puzzleId`. New outcomes are credited at once. Every call carries `total`, the composed length (a practice composed again by a newer composer reports its new length; the state never shows `done` above it).
- **Complete** (once): credits the remaining outcomes, applies the pass rule (not for a replay), the rewards, skill, the light streak and the potions, the quest it does, the full streak, achievements and question spacing. A second call answers `409 practice-closed`; the client shows that as "already saved", never as a failure (its first answer may have been lost on the way).
- **The shop** never sells an item twice: buying one already owned (bought, from a chest, or a starter item) answers `409 already-owned` and charges nothing.
- The start, progress and complete responses patch `practices` (per scene, its started practice, or null) and `daily` (the quests show their practice's progress); unlock and "Do more" patch `daily`.

## Daily quests: the contract

The types are in `shared/api.ts` (`DailyState`, `Quest`, `ScenePractice`, `Streak`, the request and response types); the rules in [app-rules.md](app-rules.md), "Daily quests". What the client builds Home, the candidates screen and the practice screen on:

**`PlayerState.daily: DailyState`**, in every state answer (`session`, `login`, `GET /api/me`, `GET /api/daily`) and in the patch of every unlock, "Do more" and practice call; `PlayerState.today` is the kid's day. The client refetches `GET /api/me` when it becomes visible again, so a Home left open overnight shows the new day.

| field | what |
|---|---|
| `day` | the day these quests are for |
| `quests` | `Quest[]`: the day's quests in order, then the extra ones "Do more" added (`round` 1, 2…) |
| `questsDone` | every one of the day's quests (round 0) is done |
| `round` | the current draw: 0 the day's, n after the n-th "Do more" |
| `choose` | index of the current choose quest (the latest), or null when every scene is unlocked |
| `candidates` | the current choose quest's draw: `{ sceneId, unlocked }` (unlocked = chosen) |
| `unlocksLeft` | scenes still to choose from it (0 once its choose quest is done) |
| `doMore` | "Do more" can be pressed: every quest done, extra ones too, and scenes left to unlock |
| `dueSceneIds` | unlocked scenes whose level can rise today, most overdue first (all of them, not only the quests) |

**`Quest`**: `index` (its place in `quests`, stable all day; quests on a scene no longer in the release are left out, the others keep their index), `kind` (`choose` or `practice`), `round`, `extra` (round > 0: not needed for the full streak), `chest` (the kind it gives), `done`, `chestId` (the chest it gave, maybe opened already). A **practice quest**: `sceneId` (null for a place waiting for a scene chosen in its round), `level` (the level to pass, 1–6), `reason` (`due` a level due, `continue` a bronze practice started on an earlier day, `new` a scene chosen today), `practice` (its started practice: `{ practiceId, level, replay: false, done, total }`, or null). Start it with `POST /api/practices/start { kind: 'scene', sceneId }`, which continues `practice`. A **choose quest**: `chosen`, `target`, `locked` (true while `waitingFor`, the indexes of the practice quests before it, are not done), `waitingFor`. Show a locked one with "finish these first", naming the `waitingFor` quests; choosing then answers `409 choose-locked`.

**Progress of a started practice** (the quest card, the scene page, the episode timeline): `PlayerState.practices[sceneId]: ScenePractice` = `{ practiceId, level, replay, done, total }`, what starting that scene continues (a level practice, or a replay); absent when there is none. The same object is the practice quest's `practice`.

**Replays**: a scene whose next level is not due (`daysUntilNextLevel(...) > 0`, or plutonium) starts a replay: `plan.replay` true, `plan.level` the scene's level; it earns XP only and does no quest (`complete.quest` null), but counts for the light streak.

**The practice screen**: `PracticePlan` has `level` (the level it is for, or for a replay the scene's level), `replay`, `done` (puzzles finished), `total` (null until the first save) and `composerVersion`, `contentVersion`. The client composes with `composePractice` and starts at `resumeIndex(done, length, same)` (`shared/practice/practice.ts`), so it shows "puzzle `index + 1` of `length`" at once; there are no sittings and no breaks; leaving at any puzzle keeps the count.

**Choosing**: `POST /api/daily/unlock { sceneId }` → `{ quest: { index, chest } | null, patch }`: `quest` when this choice did the choose quest (the third, or fewer when fewer were offered); its chest is in `patch.chests`. The first places of the round get the chosen scenes in order. Errors: `400 not-offered` (not in the current draw: an old screen, or yesterday's candidates), `400 already-unlocked`, `400 no-unlocks-left` (the choose quest is done), `409 choose-locked`. There is no "done choosing" call: the remaining candidates go back to the pool when the target is reached, and at the next day.

**"Do more"**: `POST /api/daily/more` (no body) → `{ daily, patch }` with `round` + 1, a new choose quest (`extra`, wood chest) and as many bronze places as it asks to choose, and fresh `candidates`; `409 more-unavailable` while any quest is not done or every scene is unlocked. The client needs to add `more()` to its API client (`web/src/api/client.ts`).

**Completion**: `PracticeCompleteResponse` has `level`, `replay`, `quest: { index, chest } | null` (the quest it did) and `chest` (that quest's chest), `streak: StreakChange` (`count`, `extended` (today became a light day), `freezesUsed` (missed days potions saved), `reset`, `full` (today became a full day now)).

**`Streak`** (`PlayerState.streak`, in the patch when it changes): `count`, `best`, `lastDay`, `doneToday` (a light day), `fullToday`, `week` (the last 7 days, oldest first, today last: `{ day, kind: 'full' | 'light' | 'saved' | 'none' }`; `saved` is a missed day a potion saved, counted as light).

**Counters** (`PlayerState.stats`): `practicesFinished` (replays included), `perfectPractices`, `questsDone` replace the sitting and quiz counters. Chests from quests have `source: 'quest'`.

**Removed**: `PlayerState.stops`, `nextStop`, `unfinished`; `DailyState.quizzes`; `PracticePlan.kind`, `slot`, `bonus`, `sitting`, `sittings`, `sittingsDone`; the progress fields `sittings`, `sittingEnded` and the answers `streak`, `sitting`, `stop`; the start kinds `daily` and `practice`; `composeBonus`, `splitSittings` and the `SITTING_*` constants; the error `quiz-unavailable`.

## Concurrency

A request reads the kid's row, changes things in memory (`UserTx`), and commits one `DB.batch`. The batch starts with `UPDATE users SET rev = rev + 1 … WHERE id = ? AND (CASE WHEN rev = ? THEN 1 ELSE json('stale') END)`: if another request committed meanwhile, `json('stale')` raises, D1 rolls the batch back, and `runTx` replays the handler on a fresh read (up to 5 tries). This serialises a kid's requests: a practice completes once even when the button is tapped three times. A request writes only the user columns and `stats` keys it changed (`json_set`). Writes to another kid (follower counts, gifts) are deltas that also bump that kid's `rev`; a condition on the other kid (the potion cap) is written the same way, so a failure aborts the batch.

## D1 schema and migrations

The schema is in `worker/migrations/`: `0001_init.sql` (release 2.2, applied in production), `0002_quests.sql` (daily quests: `daily.quests`, `days.kind`, `practices.replay` for `bonus`, the sitting columns dropped, the counters and chest sources renamed; open bonus sittings deleted), `0003_karaoke.sql` (karaoke recordings: the `recordings` table and `daily.karaoke_n`).

- `users`: one row per kid: profile, currencies, streak, `skill_estimate`, `stats` (JSON of `StatKey` counters), `league_tier`, `rev`; `name_key` unique.
- `sessions` (SHA-256 of the token, user, `seen_at`); `login_attempts` (failed gate, admin and login tries by address and account key; rows older than a day are deleted on each failure).
- `scene_progress`: unlocked scenes only: `level`, due day, passes, views.
- `unit_stats`, `puzzle_type_stats`: seen and missed per unit and per puzzle type.
- `practices`: one row per (kid, scene, level) for a practice (unique among `replay = 0`), and replays (`replay = 1`, at the scene's level; at most one open per scene): the seed, `plan` (JSON: focus units, speak, allowed questions), `status` (`open`, `done`), `done`, `total`, `outcomes` (JSON, merged by puzzle id), `credited_xp`, `content_version`, `composer_version`, `played_at`.
- `daily`: per kid and day: `quests` (JSON `StoredQuest[]`, `worker/tx.ts`; NULL until the day's first visit builds them), `candidates` (every scene offered that day, over all draws; each choose quest keeps its own draw), `unlocked` (scenes chosen that day, in order), per-day usage counters (speech, loops, songs, views, gifts, item and potion moves, karaoke takes checked).
- `days`: the streak's days: `kind` (`light` a practice finished, `full` every one of the day's quests done too, `saved` a missed day a potion saved), the practices finished and XP of the day (streaks, friend streaks, which skip saved days).
- `question_seen`: per kid and question, times shown and the last day.
- `chests`, `inventory`, `achievements`, `follows`, `gifts`, `feed`, `league_groups`, `league_members`.
- `recordings`: karaoke takes and recordings, one row per chunk of the WAV ("Karaoke recordings" below).
- `activity` (the activity log, kept 180 days) and `reports` (the kids' problem reports, kept): "Activity log and reports" below.

Conventions: name a migration `NNNN_what.sql`; they apply in name order (`npm run db:migrate` locally); never edit one that production has applied; add every new one to the list in `worker/testing.ts` too, or the worker tests run without it. Applying migrations to production: [app-release.md](app-release.md).

## TEST_MODE, LOCAL_DEV and the clock

- Today is `kidDay(now, profile time zone)`: the calendar day of 03:00 earlier ([app-rules.md](app-rules.md), "Days").
- **`TEST_MODE`** (non-empty) enables three request headers: `x-test-now: <ISO instant>` replaces the clock; `x-test-transcript: <percent-encoded text>` replaces Whisper; `x-test-judge` gives the judge's raw answer, or `fail` (the judge failed), or `real` (ask the real model). With a test transcript and no `x-test-judge`, the judge counts as failed. `TEST_MODE=1` comes from `app/.dev.vars` (git-ignored, copied from `.dev.vars.example`, so `npm run dev:worker` and `dev:worker:ai` have it) and from the Vitest config; `npm run dev` turns it off. `GET /api/health` reports it.
- **`LOCAL_DEV`**: `tools/dev.mjs` (`npm run dev`) passes `--var LOCAL_DEV:1` on the command line. Requests to `localhost`, `127.0.0.1` or `[::1]` then skip the gate and the admin check; on any other host it does nothing. A test checks that the gate holds with it unset.

## Speech recognition and the judge

**`POST /api/speech?scene=<id>`** with exactly one target: `line=<line id>`, `unit=<unit id>`, `alt=<line id>:<k>` (alternate k, 0-based) or `choice=<line id>` (candidates: the line, then its alternates). The kid must have the scene unlocked (`403 scene-locked`). WAV only (RIFF header checked), at most `SPEECH_MAX_BYTES` and `SPEECH_MAX_S`, `SPEECH_PER_DAY` a day (constants in `worker/speech.ts`).

1. **Whisper** (`WHISPER`, `@cf/openai/whisper-large-v3-turbo`): `language: 'fr'`, `task: 'transcribe'`, `vad_filter: true`, `condition_on_previous_text: false`, and `initial_prompt` = the show's names (`SPEECH_HINT`) plus the expected text, or plus every candidate's text for `choice`. `hint=names` sends the names alone (for comparison on `/dev/speaking`). Never use the decoder `prefix`. If Whisper fails, the answer is `503 speech-unavailable` and the client turns the round into a listen-back.
2. **The scorer** (`scoreSpeech`) scores each candidate; a pass answers at once (`by: 'scorer'`).
3. If nothing was heard (empty, fillers or stock hallucinations only), or `attempt` is past `JUDGE_LAST_ATTEMPT` (the client accepts the third try anyway), the try fails without a model call (`by: 'none'`).
4. Otherwise **the judge** (`JUDGE`, `@cf/google/gemma-4-26b-a4b-it`) gets `judgeMessages(candidates, transcript)`: instructions about French homophones, the candidates numbered with a rough sound spelling (`soundSpelling`), and what was heard. JSON schema `{ attempt, candidate }`, temperature 0, 40 tokens, thinking off, time-boxed at `JUDGE_TIMEOUT_MS`. A parsed yes passes, and for `choice` its candidate is the answer (`by: 'judge'`).
5. If the judge errors, times out or answers unparseably, `lenientPass` decides: a content word of a candidate heard by sound, and not English (`by: 'fallback'`).

The response describes the chosen candidate (`transcript`, `score`, `pass`, `matched` per expected word, `expectedWords`, `heardWords`, `by`), plus `choice: { index, scores }` for `choice` (index 0 = the line). A pass bumps `linesSpoken`. Each request logs one JSON line (scene, target, attempt, hint mode, score, pass, `by`, Whisper and judge times, judge error, total time) and writes a `speech` row to the activity log with the transcript and what was expected ("Activity log and reports"); the audio is never stored. `type` (the puzzle type asking, sent by the client) only goes to the log. `debug=1` adds the prompt, the raw transcript and the judge's raw answer, honoured only locally or with the admin cookie. The client-side behaviour (third try accepted, listen-back, "Je ne peux pas parler", the voice gate that never sends a take without a voice, so steps 1 and 3 are the second line of defence against silence) is in [app-games.md](app-games.md).

**The scorer** (`shared/speech.ts`, pure, also used by the fixture client): normalises (lower case, no punctuation, elisions split, hyphens split, digits written as French words, hesitations dropped unless the line has them, over-repeated tokens collapsed); aligns heard words to expected words in order, where a word matches exactly, without accents, by a rough French sound key (silent endings, `eau/au/o`, `é/er/ez/et`, nasal spellings…), or by a small edit distance for long words, with joins and splits and generous matching of the show's names; scores the weighted share of expected words heard (little words and interjections weigh less); scores zero for no content word, one syllable for a long target, mostly English, or Whisper's stock hallucinations ("Sous-titrage ST' 501", "Merci d'avoir regardé cette vidéo"…). Pass thresholds depend on the target's length and kind (constants in the file). Known soft spots, intended: saying only the content words of a long line passes; a short line can be passed by a longer sentence containing it. Tests: `shared/speech.test.ts` (a table of realistic transcripts), `tools/speech-bundle.test.ts` (every bundle line read back passes; random other lines almost never do), `worker/speech.test.ts` with the regression set `worker/speech-judge.fixtures.json` (replayed cases with gemma's recorded answer, the frozen decision, and known leaks flagged).

## Why this speech design

Measured on 2026-11-14 with real Workers AI calls. The check must answer "did the kid try to say this?", not "what exactly did they say" (intent.md, "Speaking"). No child was recorded, samples were small (a difference of 2–3 clips is noise), and thresholds were tuned on the same data.

- **Test set**: 42 targets from the bundle (homophone traps such as tout vert, du pain, ces Romains; verb endings; names; one-syllable words; long lines). 147 should-pass clips: actors' lines cut from the scenes, the app's TTS voice, and TTS "learner" voices reading hesitantly with an accent, pitch raised, some with room noise. 129 must-fail pairs: silence, room tone, noise, humming, a cough, "la la la", another line, the English translation read aloud, random words, the first word only.
- **Whisper with the names only**: 86 % of should-pass accepted by the scorer, 1 of 129 must-fail. It returns stock hallucinations on silence and noise, and sometimes on actors' speech over music.
- **Names plus the expected text** (production): 97 % accepted, actors' lines 100 %, the exact spelling of homophone traps up from 58 % to 83 %. The cost: 10 of 129 must-fail accepted, mostly because Whisper translates English read aloud into the expected French, or echoes the whole line from one word or from noise. The expected text without the names is worse.
- **`prefix`** forces the output to start with the expected text: 27 of 29 must-fail echoed. Never use it.
- **`vad_filter: true`** emptied every silence, room-tone, noise and cough clip and kept almost every noisy learner clip, at no cost. It is on every call.
- `no_speech_prob`, `avg_logprob` and `compression_ratio` do not separate echoes from real speech. Deepgram nova-3 on Workers AI refuses French keyterms, is no more accurate than Whisper with names only, and costs about 9 times the neurons.
- **The user's decision** (intent.md, "Speaking"): Whisper hinted with the expected text, then a small Workers AI text model judging whether the kid attempted something similar in French.
- **Choosing the judge**: the recorded transcripts were replayed through 8 Workers AI text models. Scorer plus `gemma-4-26b-a4b-it` accepted the most honest attempts (141 of 147 even on transcripts made with names only, and every half-line), no random words and no humming, at a quarter of Mistral Small's cost and a median under 1 s. `glm-4.7-flash` accepted a lone first word as an attempt; the others refused more honest attempts. The sound spelling in the prompt helped slightly and was kept. Asking the judge which words were heard was left out: the partial-credit boxes use the scorer's deterministic `matched`.
- **What still gets through**: English read aloud (Whisper itself translates it under the hint, before any judge), another line that sounds alike ("de la mer" for "à sa mère"), a line echoed from its first word. Accepted: a gameable speaking puzzle is better than a frustrating one.
- **Live** (66 requests through the Worker): actors' lines 22 of 22, must-fail 1 of 22 (a hum Whisper turned into the line); 4 of 21 judge calls hit the time-box, and the lenient rule refused all four correctly.
- **Not built, for later if real kids get rejected**: a real pronunciation scorer constrained to the expected text (Azure pronunciation assessment supports fr-FR and fr-CA; or the open French phoneme model `Cnam-LMSSC/wav2vec2-french-phonemizer`, MIT, in a Cloudflare Container). The browser's Web Speech API is not available in iOS home-screen web apps (WebKit bug 225298), so it is ruled out for the installed app.
- If storing kids' audio ever comes up: the amended COPPA rule (in force 2026-04-22) counts voiceprints as children's personal information; Workers AI keeps no inputs.

## Karaoke recordings

What the user asked for: on a song's karaoke screen a kid records their singing along; if there is a voice it goes to Whisper and is checked for profanity only ("singing something different is fine"); if all is good they hear it over the song, and keep it or drop it; a kept recording plays with the song every time it plays for that kid. Words: a **song** is one of the karaoke songs, a **take** what the microphone just captured, a **recording** the kid's kept singing of one song (at most one per kid and song). The client side is in [app-games.md](app-games.md), "Karaoke: singing along with the microphone"; types in `shared/api.ts`; the check, the shared limits and the timing arithmetic in `shared/karaoke.ts`.

- **`POST /api/karaoke/:song/take?offset=<ms>`**, body a WAV, 16 kHz mono 16-bit (what the recorder makes). `offset` is where the take's first sample sits on the song. Refusals, in this order: `404 not-found` (no such song); `413 too-big` (a `content-length` over `KARAOKE_MAX_BYTES`, 2.4 MB); `400 bad-request` (a bad offset); `429 rate-limited` (`KARAOKE_TAKES_PER_DAY`, 20 takes checked today, checked before Whisper is asked); `413 too-big` (the body read over the cap, for a body sent without a `content-length`); `400 bad-request` (not such a WAV, or under `KARAOKE_MIN_MS`); `413 too-big` (offset plus length past the song's end plus `KARAOKE_SLACK_MS`). Then Whisper (the model and settings of `/api/speech`, `transcribe()`, hinted with the show's names only: a hint of the lyrics would pull what was heard towards them), outside the request's transaction so a replayed batch never asks twice, and time-boxed at `KARAOKE_WHISPER_TIMEOUT_MS` (25 s, under the client's 45 s); Whisper failing or late is `503 speech-unavailable`, not counted, nothing kept (the page still holds the singing and sends it again on « Réessayer »). The answer is `{ verdict: 'ok' | 'refused', take }`: `ok` stores the take unsaved, replacing the song's earlier unsaved take, and returns it without a URL (its audio is served only once kept); `refused` keeps nothing and never says which word. `debug=1` (locally or for the admin) adds the transcript and the words that counted.
- **The check** (`checkTake`, pure; the table of cases is `shared/karaoke.test.ts`): the transcript's tokens (`plainTokens` of `shared/speech.ts`: lower case, no accents, elisions and hyphens split, nothing dropped, Whisper's stock phrases neither, so « Sous-titrage merde » counts). A token counts when it holds an unambiguous stem (« connerie », "fuckin", « nazisme »), is a short listed word (« con », « cul », "ass", with a final s or x), or is a context word in its context (« bite » after a French determiner, never the English "bite"; « gueule » after « ta », « vos », « ferme »; « baiser » after « faire »), and is not part of an innocent phrase: the halves of hyphenated words (« pique-nique », « cul-de-sac », « cul-de-jatte ») and words rude in one language or place and innocent in another ("the pros and the cons", "chili con carne", « faire la nique », « pain bâtard », "Moby Dick"). Whisper's own censoring ("f*ck", "f***") counts. The words of the song's lyrics never count. It refuses every word the account-name filter refuses but those innocent in a sentence (« en retard », a bicycle's « pédale », "hoe", "butt", the Mongols, « sexe ») and the mild insults the show says (« idiot », « crétin »). The show's words are never refused: `tools/karaoke-bundle.test.ts` runs it over every line, alternate, question, answer and lyric of the bundle.
- **`POST /api/karaoke/:song/save { takeId }`**: the unsaved take with that id becomes the song's recording, in one batch that first checks the take is still there (the daily purge may have removed it since it was read: the batch then fails and the request is read again), deletes the older recording and promotes the take. A take already kept answers 200 with the recording again (a retried tap whose first answer was lost). `409 no-take` when the song holds no such take (thrown away, replaced by a take from another device, or purged). The answer and its patch carry the recording.
- **`DELETE /api/karaoke/:song/take`** drops the unsaved take (204, also when there is none); the client sends it when the kid throws the take away, and when they leave the listening state without choosing (another song, another screen), best effort. **`DELETE /api/karaoke/:song/recording`** removes the recording (its patch sets `recordings[song]` to null).
- **`GET /api/karaoke/audio/<id>.wav`**: a kept recording's WAV, only to the session of its kid (anyone else, an unsaved take, a removed recording: 404). `private, no-cache` with the id as `ETag`: the browser keeps the file and asks every time, so the owner is checked on every load (a removed recording, or another kid on a shared device, gets a 404 even with the file in the cache) and an unchanged one costs a `304` and no audio read. A new take gets a new id, so the URL changes whenever the recording does.
- **The state**: `PlayerState.recordings` (by song: `{ id, songId, offsetMs, durationMs, url }`), in every state answer; save and remove patch it.
- **Storage: D1** (`recordings`, migration 0003), so the app needs nothing beyond D1 (no R2 bucket). One row per chunk of the WAV, `KARAOKE_CHUNK_BYTES` (675,000 bytes, 900,000 characters of base64) each, so the longest song's take (54 s, 1.73 MB) is three rows: D1 caps a row at 2,000,000 bytes, and its binding moves values as JSON, where a BLOB travels as an array of numbers (about 3.6 characters a byte) and base64 as 1.33. The audio route reads one chunk per query, so no answer from D1 is over a megabyte. `saved` 0 is the unsaved take (one per kid and song), 1 the recording (one per kid and song; a unique index on `(user_id, song_id, saved, part)`). Never verified on production D1: that a 900,000-character bound value is accepted (its 100 KB limit is on the SQL text) and how long such writes take ([app-status.md](app-status.md)).
- **Why a WAV**: 16 kHz mono 16-bit PCM is what the recorder already makes for Whisper and what every browser's `decodeAudioData` reads, iPad and iPhone Safari included, so a take recorded on one device plays on any other. Opus or AAC would be a tenth of the size, but MediaRecorder's formats differ between browsers (WebM in Chrome, MP4 in Safari), and what one browser records another may not decode. The browser keeps the file (revalidated, above), so a kid downloads a recording once per device.
- **Accounts**: an account with a recording is not "empty" when its kid switches player (`isEmptyAccount`); deleting an account (`deleteUser`) deletes its recordings and takes with it.
- **Logging**: every checked take writes one `karaoke-take` row (the song, the verdict, the words that counted, what Whisper heard up to 1,000 characters, offset, length, size, the take's id, Whisper's and the total time), for refused takes too.
- **What is kept of a kid's singing**, so the interface tells the truth: the audio of a refused take, or of one that never reached the check, is kept nowhere (it lives in the request, then in the page until the kid records again or leaves). A checked take stays unsaved on the server until it is kept, thrown away, replaced by the next take of that song, or purged: the daily job deletes takes older than `TAKE_KEEP_MS` (24 h) and runs once a day, so a forgotten take can last up to about 48 h. A recording stays until the kid removes it or the account is deleted; both delete every row of its audio. What stays after that: the `karaoke-take` activity rows with what Whisper heard, 180 days like the rest of the log (refused takes included, and after the account is gone: activity rows are not deleted with an account), and D1's Time Travel, which can restore the database to any minute of the last 30 days (Workers Paid). How long transcripts are kept is the user's decision, pending. Deleting one kid's recordings or transcripts by hand: [app-release.md](app-release.md), "What it needs on Cloudflare".
- **Measured with Whisper** (2026-11-15, 4 calls through the local Worker): a 54 s, 1.72 MB WAV is accepted as one request, 5 to 8 s for Whisper. French speech over the music at a fifth of its level came back word for word (names included); the song at full level (a microphone hearing the speaker, the kid silent) came back as its lyrics, slightly mangled (« tapé dans vos mains », « au lion »); the song alone at an echo's level came back as the stock « Sous-titrage Société Radio-Canada », which passes. No child's singing was tried, nor rude words over music.
- **Children's voices**: the user asked for recordings to be kept; [intent.md](intent.md) has no other rule on storing audio, and "Why this speech design" above notes that the amended COPPA rule counts voiceprints as children's personal information. Only the kid's own session can fetch a recording, and the kid can remove it.

## Activity log and reports

What the user asked for (intent.md, "When something goes wrong"): user activity, errors included, logged for statistics, with what speech recognition heard; a button where a kid says what went wrong, stored in production with its context; one D1 table each, plain endpoints. Code: `worker/activity.ts`, the kinds and caps in `shared/activity.ts`, the client side in [app-architecture.md](app-architecture.md), "Activity log and reports".

**`activity`**: `id`, `user_id` (null without a session), `at` (ms), `day` (the kid's day; `DEFAULT_TIME_ZONE` without a session), `build` (the client's), `session_id` (the client's per-tab id, header `x-frx-tab`), `kind`, `route` (the client's path, or the API path for the Worker's own events), `data` (JSON per kind, at most 2,000 characters, else `{ truncated, chars }`). Indexed by `at` and by `(user_id, at)`.

The kinds are a closed list, `CLIENT_LOG_KINDS` and `SERVER_LOG_KINDS` in `shared/activity.ts` (each with what its `data` holds):

| Kind | Written by | When, and `data` |
|---|---|---|
| `app-open` | client | the app started: standalone, viewport, online |
| `route` | client | the path changed |
| `practice-open`, `puzzle-show`, `puzzle-done`, `practice-results` | client | the practice screen: practice, scene, level, puzzle index, id and type; per finished puzzle mistakes, hints, ms, skipped |
| `api-fail` | client | a failed API call: kind, code, status, method, path, ms (message for server and offline) |
| `media-fail` | client | a media file that did not load: reason (`timeout`, `offline`, `http`, `decode`), status, src, where (`gate` or `play`) |
| `crash` | client | an uncaught error, an unhandled rejection, an error boundary: source, message, first stack lines |
| `cant-speak`, `mic` | client | « Je ne peux pas parler » (from the puzzle or the header); a microphone denied, missing or failing |
| `speech` | Worker | every `POST /api/speech` with a transcript: puzzle type, scene, target, attempt, the expected text(s), the transcript, score, pass, `by`, best candidate, Whisper, judge and total ms, judge error |
| `server-error` | Worker | every 5xx it answers: status, code, message, method, path |
| `practice-start`, `practice-progress`, `practice-complete` | Worker | the practice routes: practice, kind, scene, level, replay; done, total, new outcomes, XP; stars, ms, the quest it did |
| `quests-built`, `quest-done`, `quest-more`, `streak` | Worker | the day's quests built (each quest's kind, scene, level, reason; how many practices waited); a quest done (index, kind, round, scene, level, chest); "Do more" (round, candidates); today became a light or full streak day (count, potions used, reset) |
| `karaoke-take` | Worker | every karaoke take checked: song, verdict, the words that counted, the transcript, offset, length, bytes, take id, Whisper and total ms |

- **`POST /api/log`** `{ tab, build, sentAt, events: [{ kind, at, route, data }] }` (`LogRequest`), behind the gate, with or without a session: at most 50 events (the rest dropped) and 64 kB (`413`); unknown kinds are skipped, not refused (an older or newer client). Times move by the difference between the server's clock and `sentAt`, then stay within the last week. `204`. The client never shows its failures.
- **The Worker's own events** go through `logTx(tx, c, kind, data)`, which queues the row in the request's batch: written when the request commits, not at all when it fails or is replayed (one line where the event happens: `speech.ts`, `practices.ts`). The error handler uses `logNow` (a write of its own that never throws) for every 5xx.
- **`reports`**: `id` (autoincrement, never reused: the triage ledger is keyed by it), `user_id` (null without a session), `at`, `build`, `route`, `text` (at most 2,000 characters), `context` (JSON, at most 64,000 characters, else `{ truncated, chars, partial }`), `user_agent`. **`POST /api/reports`** `{ text, route, context }` (`ReportRequest`) answers `{ id }`; with or without a session (a report from the boot error panel still arrives); a kid may send 10 an hour (`429 rate-limited`). What `context` holds: [app-architecture.md](app-architecture.md), "Activity log and reports".
- **Retention**: the cron trigger in `wrangler.jsonc` (`17 4 * * *`, once a day) runs the `scheduled` handler in `worker/index.ts`, which deletes `activity` rows older than `ACTIVITY_KEEP_DAYS` (180) and karaoke takes left unsaved for over 24 h (so up to about 48 h), and logs `{ purge: { activity: n, takes: n } }`. Reports are kept. Reading both in production: [app-release.md](app-release.md), "Reading the log and the reports". The session-start check that brings new reports to the user: [checks.md](checks.md).
- Tests: `worker/activity.test.ts` (the endpoints and their caps, the speech, 5xx and practice events, the purge through the scheduled handler); `worker/karaoke.test.ts` (the karaoke routes, their refusals, the `karaoke-take` row, the purge of unsaved takes); `e2e/reports.worker.spec.ts` end to end.

## Worker tests

`npx vitest run --project worker` runs them inside workerd with a real local D1 (bindings from `wrangler.jsonc`, `TEST_MODE` on, the AI binding unavailable: mock it). Each test starts with `freshWorld()` (reset plus the migrations listed in `worker/testing.ts`), uses `FIXTURE_INDEX` and `fixtureSceneFor` instead of the bundle, and drives the app through `exports.default.fetch` (a `Browser` with a cookie jar) with `x-test-now`. The content test in `worker/health.test.ts` needs `dist/` and silently passes without it ([checks.md](checks.md)). Running servers locally: [app-dev.md](app-dev.md).
