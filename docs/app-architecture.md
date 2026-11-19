# App architecture

How the app in `app/` is built and the contract its parts share: the stack and layout, the content bundle and its types, the puzzle-type contract, how a practice is composed, and our own French (questions, answers, alternates) as the app reads it. Read before changing anything in `app/` or the export. Where this file and `app/shared/` disagree about a type, the code wins and this file gets fixed.

## Contents

- **Stack and layout**: one Worker, the directories, who composes what.
- **Client basics**: layouts, language, fonts, caching.
- **Errors**: one way to fail a request, the kinds, the error panel, back to the last working state.
- **Home and the daily quests**: the quest cards, the candidates screen, the scene page's practice button, first open.
- **Activity log and reports**: the client's logger, the "Quelque chose ne va pas ?" button and what a report carries.
- **Content bundle**: what the export writes and the types the app reads.
- **The puzzle-type contract**: logic plus view, what each part must guarantee, the 18 types by angle.
- **How a practice is composed**: angles, demand per level, length, order, targeting, resuming.
- **Our own French**: questions, answers and alternates, their units, audio and spacing.

Elsewhere: the game rules in [app-rules.md](app-rules.md); the Worker, API and speech in [app-server.md](app-server.md); writing a puzzle type and the practice screen in [app-games.md](app-games.md); running and testing in [app-dev.md](app-dev.md); every check in [checks.md](checks.md).

## Stack and layout

One Cloudflare Worker serves everything: the React client as static assets, a JSON API, and the scene media. User data is in D1. Workers AI does speech recognition (Whisper) and judges near misses (a small text model). Question and alternate audio is generated ahead of time on the local GPU and shipped as static files ([app-tts.md](app-tts.md)).

- TypeScript everywhere in `app/`: React and Vite for the client, Hono for the Worker, Vitest for unit tests, Playwright with the system Chromium for end-to-end tests.
- The export of scenes into the app is Python (`frenchirix export-app`), because it reads `assets/db.sqlite` and cuts media from `content/` ([app-export.md](app-export.md)).
- **The server chooses, the client composes.** For a practice the server picks the scene, the level and a seed and sends a `PracticePlan`; the client fetches that scene's JSON (static, cached) and runs `composePractice` to get the puzzles. The same composer runs in the checks, so what the checks prove is what kids play. The server needs only `index.json`, and reads a scene's JSON through `ASSETS` when it must know a line's text (speech, question spacing).

```
app/
  shared/          pure TypeScript, no DOM and no Workers APIs; used by the client, the Worker and the checks
    content.ts       types of the content bundle
    api.ts           types of the HTTP API and the player state
    rules.ts         constants and pure functions of the game rules (app-rules.md)
    activity.ts      the activity log's kinds and caps, the log and report request types
    build.ts         the build id and MIN_CLIENT_BUILD (app-release.md)
    practice/        the contract (types.ts), the composer (practice.ts), replace.ts, validate.ts, bot.ts, registry.ts, rng.ts, version.ts
    puzzles/<type>.ts  the logic of one puzzle type; shared helpers in arcade.ts and speak-core.ts
    speech.ts        transcript scoring, the judge's prompt and parser (app-server.md)
    karaoke.ts       karaoke recordings: the rude-word check, the shared limits, the timing arithmetic
    catalog/         items, achievements, cheers, generated names, bad words
    fixtures/        fixture content and player for UI work and tests
    i18n/            fr.ts, en.ts
  worker/          the Hono Worker; worker/migrations/ holds the D1 schema (app-server.md)
  web/src/         the client
    ui/ fx/ audio/   design system, effects kit, audio engine
    media/           fetching media with progress and a stall timeout, the media gate, fetching ahead (app-games.md, "Loading media")
    scene/           ScenePlayer, SceneBar, Slideshow, DialogueStrip, GlossText, hint (the hint bubble)
    practice/        the practice screen (the shell): help strip, progress saves, results
    puzzles/<type>/  the view of one puzzle type, plus registry.ts
    speech/          recorder, SpeakPanel, TargetStrip
    karaoke/         the karaoke studio: recording a take over a song, hearing it, keeping it (app-games.md)
    screens/         one file per route; screens/dev/ is the /dev portal
    home/ loot/ onboarding/ pwa/ state/ avatar/ api/
    log/ report/     the activity log; "Quelque chose ne va pas ?" (its button, form, tip and context)
  data/            sources the export reads: release.json, questions/ (one example here), alternates/ (yours), songs.json, versions.json
  public/          static files; public/data/ and public/media/ are generated and git-ignored
  tools/           check-practices.ts, deploy.sh, dev.mjs, icons.ts
  e2e/             Playwright tests
```

## Client basics

- **Two layouts, not one stretched.** `useLayout()` returns `phone` (under 768 px wide: one column, bottom tab bar, media above the puzzle) or `tablet` (side rail; in a practice, scene and help strip on one side, the puzzle on the other, or above it when the tablet is upright: [app-games.md](app-games.md), "The practice screen"). Every screen is designed for both.
- **Language**: every interface string goes through `t()` (`shared/i18n`). A new account starts in English on every device (the client asks for it; the server's fallback and the schema default are English too), with a switch to French in the profile; never the browser's language. In `TEST_MODE`, the header `x-test-language: fr` starts a new account in French; the e2e helpers send it because the specs read the French interface. Content glosses are always English.
- **Fonts** are self-hosted; a kid's device makes no third-party requests.
- **Caching**: scene data and media URLs carry the content version, so they are cached hard; the Worker sets the headers ([app-server.md](app-server.md), "Request pipeline"). Updates reach open and installed copies by a build check ([app-release.md](app-release.md)).
- **Loading media**: the practice screen, the scene page and the karaoke screen wait behind the media gate for their audio and first frames (a progress bar, a slow line at 8 s, the error panel when a file fails or stalls 25 s); play buttons are busy while their clip loads; a practice fetches its clips ahead. No service worker. Details: [app-games.md](app-games.md), "Loading media".
- The look is in [app-style.md](app-style.md); the audio engine, effects and mute in [app-games.md](app-games.md).
- **Karaoke recordings**: `PlayerState.recordings` (by song) is the kid's kept singing; whatever plays a song plays it over the song. The studio: [app-games.md](app-games.md), "Karaoke: singing along with the microphone"; the routes, the check and the storage: [app-server.md](app-server.md), "Karaoke recordings".

## Errors

What the user asked for (intent.md, "When something goes wrong"): a failed call shows a plain message for the kid and a short copyable line for the admin, then the app goes back to its last working state so the kid can try again. No offline mode, no silent background retries, no automatic skip.

- **One way to fail a request.** Every call goes through `request()` in `web/src/api/client.ts` (the content files of `api/content.ts` too) with a time limit (`REQUEST_TIMEOUT_MS`, 15 s, an `AbortController`; speech has its own, and `speech/send.ts` gives up earlier). A failure is one `ApiRequestError` (`web/src/api/errors.ts`) with a `kind`:

  | kind | when | what happens |
  |---|---|---|
  | `offline` | `fetch` threw | the kid's message; « Réessayer » |
  | `timeout` | no answer in time | the same |
  | `server` | a 5xx, or an answer that is not JSON | the same |
  | `session` | 401 `no-session` | the app boots again (`state/player.ts`): a new session, or a new kid and the "Tu as déjà joué ?" question |
  | `gate` | 401 `gate` | `location.reload()`, so the gate page shows (once per two minutes; then the error shows) |
  | `outdated` | 409 `client-outdated` | reloads into the new build at once ([app-release.md](app-release.md)); the promise never settles |
  | `stale` | the screen showed something the server no longer agrees with: `practice-closed`, `not-found`, `already-unlocked`, `no-unlocks-left`, `not-offered`, `choose-locked`, `more-unavailable`, `scene-locked`, `not-enough-sesterces`, `already-owned`, `not-owned`, `potions-full` | `GET /api/me` replaces the state, and the fresh screen shows with a short "this changed" note |
  | `client` | any other refusal (a taken name, a wrong PIN, too many tries) | its own message (`common.error.<code>`), usually next to the field |

  Each kind has one message in both languages (`common.fail.<kind>` in `shared/i18n`). Every error also has a one-line detail for the admin, `errorDetail(e)`: `FRX-ERR server 500 POST /api/practices/p_x/progress code=internal msg="…" build=20261114T… at=2026-11-14T20:31:05Z`; a crash in the code gives `FRX-ERR crash <screen> "<error>" build=… at=…`.
- **Media files** fail the same way for the kid without being requests: a `MediaLoadError` (`web/src/media/fetchMedia.ts`; a stall of 25 s is a `timeout`) has a kind (`timeout`, `offline`, else `server`), the kid's message, and the detail line `FRX-ERR media timeout 0 GET /media/a/<scene>.m4a?v=… msg="no data for 25 s" build=… at=…` ([app-games.md](app-games.md), "Loading media").
- **One error panel**, `ErrorPanel` (`web/src/ui/`): an « OUPS ! » burst on a paper panel, the kid's message, « Réessayer », an optional second way out (Home), and, small and out of the way, the detail line with a copy button (`ErrorDetail`). The variant `bar` is one compact row over the practice's continue bar. `ErrorReportSlot` inside it holds the "Quelque chose ne va pas ?" button on every panel (filled once from `App.tsx` with `setErrorReportSlot(ErrorPanelReport)`, so `ui/` does not import `report/`; `report={false}` leaves it out). A toast can carry the same detail line (`toast(text, { detail })`).
- **Back to the last working state, everywhere** (`web/src/state/recover.ts`). A failed load shows the panel in place, and « Réessayer » loads again (`useAsync` and `LoadError` in `home/`, the scene page, the practice screen). A failed action (unlock, start a practice, open a chest, buy, follow, gift, rename, settings) calls `actionFailed(e)`: the screen stays as it was before the action, its control works again (the caller resets its busy state), and a toast says what happened with the detail line; a stale view refreshes first. The practice's saves are in [app-games.md](app-games.md), "The practice screen".
- **Error boundaries** (`ui/ErrorBoundary.tsx`): one around the routes in `App.tsx` (« Oups », the detail line, back to Home; cleared when the path changes) and one around the running puzzle (« Réessayer » remounts it). Both log `console.error('[frx] crash FRX-ERR …', error)` and a `crash` event to the activity log.
- **Stale state.** Home fetches `GET /api/me` on every mount (`useRefreshState`), and when the app comes back to the foreground with a copy older than ten minutes it fetches it too (`installStaleWatch`). A practice screen opened from history or a reload asks the server first (`{ kind: 'resume' }`): a practice finished meanwhile says so and goes Home.
- Unit tests: `api/client.test.ts` (time limit, kinds, messages, detail line), `ui/ErrorPanel.test.tsx` (the panel and the boundary), `practice/PracticeRunner.test.tsx` (save, then continue). End to end: `e2e/errors.worker.spec.ts`.

## Home and the daily quests

The client side of the daily quests (the rules: [app-rules.md](app-rules.md), "Daily quests"; the contract: [app-server.md](app-server.md), "Daily quests: the contract"). The client only displays `PlayerState.daily`; every choice and credit is the server's. Files: `web/src/home/quests.tsx` (the cards, the streak's week), `home/logic.ts` (`questCards`), `screens/Home.tsx`, `screens/Unlock.tsx`, `screens/Scene.tsx`.

- **Home** shows, in order: the header (rank, the streak flame, "n quests left", and the week of `Streak.week`: one box per day, a hollow flame for a light day, a full one for a full day, a potion for a saved day, today last); the day's quests as a stack of panels, then the extra ones "Do more" added under their own heading (the day's finished quests fold to one line each while an extra one is open); then the chests not tied to a quest, the scenes to come back to (started practices first, with their progress), the karaoke, friends. On arrival, once the scene titles are in, Home scrolls the `next` quest into view above the phone's tab bar when it is below the fold (after "Do more", or on a small phone), once per visit, so the list never moves under a finger. With every quest done, the card with "Do more" is brought into view the same way.
- **A quest card** (`questCards`): its number (its place in the list, from 1; `Quest.index` may skip a quest the server left out), what to do, the chest it gives (a button: "Open!" once done with its chest unopened), and a state: `next` (the first quest that can be done now, in order: the one obvious thing to do, the loudest panel), `open` (another that can be done now), `locked` (the choose quest waiting for `waitingFor`, named by their numbers: "Finish quests 1, 2 and 3 first"; a tap says so in a toast), `waiting` (a bronze place whose scene is not chosen yet: a tap opens the choice, or the same toast while it is locked), `done` (compact, checked). A practice quest shows the scene, the level to pass, why it is here (`reason`) or, once started, its progress bar; a tap starts `{ kind: 'scene', sceneId }`, which continues the started practice. The choose quest shows `chosen / target` and opens `/unlock` until its target is chosen.
- **Every quest done**: a burst, and "Do more" (`api.more()`, `useDoMore`) while `daily.doMore`; it opens the candidates screen on the fresh draw. Without "Do more" (every scene unlocked): watch scenes or sing. With no quests at all (every scene unlocked, nothing waiting), Home says everything is unlocked and points to the Episodes tab.
- **The candidates screen** (`/unlock`): the current choose quest's draw. A chosen candidate (from its cover, or from its preview page, which comes back with `{ chose }` in the navigation state) flies off to its quest and leaves the selection; the others stay. The choice that reaches the target sends the rest into the cauldron by themselves, then the screen goes Home, where the new scenes sit in their quests: the kid sees the day's plan and its next quest rather than being dropped into one practice. A locked choose quest says which quests come first; its candidates can still be watched, not chosen (`409 choose-locked` is a stale answer: the state refreshes). Arriving with the quest done: "Do more" when it can be pressed, else what comes next; on a tablet, with no candidate left on it, a big cauldron and those buttons sit in the middle of the screen. Every state has "To my quests".
- **The scene page's practice button** (`[data-practice-start]`, `data-action`): `continue` the scene's started practice (`PlayerState.practices`, a level practice or a replay, with its progress bar), `start` when the next level is due, `replay` (XP only) when it is not, with the days until it is (`[data-next-level]`). `data-worth` is `level` or `replay`. A candidate's preview offers "choose this scene" instead, or the same "finish these first" while choosing is locked. The action is a sticky bar at the bottom of the screen at every size, so it is on screen on arrival even when the strip runs under the pictures (an upright iPad) or starts at the fold (landscape). On a tablet the bar holds everything (the button, the progress, "to win", the ladder of levels) in two rows at most. On a phone only the button stays in the bar, above the tab bar, with "to win" beside it when the button is short (`start`); the progress, the ladder and the rest are in the page under it (`[data-scene-details]`): a taller bar left one row of the strip in view on a 375×667 phone.
- **The scene page never moves by itself on arrival** (`follow` in `scene/ScenePlayer.tsx`). The page follows the playing line only once the kid has touched or scrolled it since arriving, and only by a small step: from a line on screen to the next line of the strip when that one is not on screen whole. It never jumps (the loop's restart, a seek), so a kid who scrolled down to "Show English", the notes or the next scene is never pulled back up; and it waits 4 s after a scroll by hand and 700 ms after a seek (a tap on the playback bar must not land on a line panel). The strip's own scroll box (a landscape tablet) follows by itself, without moving the page. The line comes into view above the bars by the `scroll-margin-bottom` on the strip's lines in `Scene.module.css`. The same rules hold for the `watch` puzzle type, which uses the same player.
- **First open**: "Played before?" (`pwa/Overlay.tsx`, its own React root) comes first; the welcome waits until it is answered or is not going to be asked (`useWelcomeAfterWelcomeBack`, a short grace period while the other root mounts), so the two never stack. A kid who answers "Who's playing?" by tapping their name is logged in under the same Home and gets no welcome (Home asks `needsWelcome` again of the state it then holds). The welcome scrolls when it is taller than the screen (a 375×667 phone).
- **Test ids**: `[data-testid="quest"]` with `data-index`, `data-kind`, `data-state`, `data-scene`, `data-level`, `data-reason`, `data-extra`, `data-chosen` (`n/target`), `[data-waiting-for]`, `[data-quest-chest]` (`ready`, `opened`, `waiting`), `[data-practice-progress]`; `[data-testid="quests-done"]`, `[data-do-more-button]`, `[data-streak-week]` with `[data-day][data-kind]`; on `/unlock` `[data-testid="unlock"]` with `data-phase` (`pick`, `cauldron`, `chosen`), `data-left`, `data-locked`, `[data-unlock-locked]`, `[data-unlock-home]`, and the covers' `data-state`.

## Activity log and reports

What the user asked for (intent.md, "When something goes wrong"): activity and errors logged for statistics, and a button where a kid says what went wrong, stored with its context. The server side (tables, endpoints, what the Worker logs, retention): [app-server.md](app-server.md), "Activity log and reports".

- **The logger** (`web/src/log/`): `log(kind, data)`, one line where the event happens, kinds from the closed list in `shared/activity.ts`. It keeps the last 100 events in memory (a report sends the last 50) and, once `installLogging()` has run (`main.tsx`), sends them to `POST /api/log` every 30 s, every 20 events, and with `navigator.sendBeacon` when the page is hidden or left. A failed send is dropped quietly: the one place where a silent failure is right, because logging must never bother a kid; nothing in it throws. Before `installLogging()` (unit tests, the liveness check) and in fixture mode nothing is sent. It also catches uncaught errors and unhandled rejections, keeps the last console errors, and sends a per-tab id (`x-frx-tab`, `frx.log.tab` in sessionStorage) with every API call. Who logs what: `request()` every failed call (`api-fail`), the media gate and a failed play (`media-fail`), the error boundaries (`crash`), `App.tsx` routes, `PracticePlayer` and `PracticeRunner` the practice (`practice-open`, `puzzle-show`, `puzzle-done`, `practice-results`), `CantSpeak` and the header's speak switch (`cant-speak`), `useRecorder` (`mic`).
- **Which puzzle is on screen**: `PuzzleHost` sets `setPuzzleWhere` (practice, index, puzzle id and type, speaking, a getter of its reducer state); a report and the speech request (`type`) read it.
- **The button** (`web/src/report/`, `ReportButton`): a small flag labelled « Quelque chose ne va pas ? », in the practice header next to mute, on every error panel (with words on a page panel, the flag alone on the compact bar) and in the profile. Pressed, it takes the context at once (`captureContext`, before the form covers the screen), then opens a modal: one text area (« Raconte ce qui ne marche pas »), Envoyer, Annuler. Sent (`api.report`, `POST /api/reports`), a « Merci ! » toast and the kid is back where they were. A failed send shows the error panel in the form (without its own report button), the text kept, and « Réessayer » sends again.
- **What a report carries** (`report/context.ts`): the route and practice id; the puzzle on screen (index, count, type, id) and its reducer state as JSON cut to 6,000 characters; the state attributes visible in the puzzle pane (`data-step`, `data-phase`, `data-speak`… as `step=back speak=idle`), its enabled controls, and the marks around it (continue bar, save failed, completing, error panels and their kind); the error's detail line when sent from an error panel; the last 50 events and the last console errors; the build, the content version, the layout and viewport, installed or not, speaking on or off, muted, the language, `navigator.onLine`, the kid's id and name (the server adds the user agent). `fitContext` keeps it under 48,000 characters (the state shortened, then fewer events, then their data).
- **The tip** (`ReportTip`, the onboarding `Tip` with id `report`, remembered per device like the others): « Si quelque chose ne marche pas, touche ici et raconte-nous ! », in the flow under the flag (it never covers a control) the first time a practice opens (not on `/dev`), or under the button of the first page error panel, whichever comes first, until the kid taps it.
- Tests: `log/log.test.ts` (the ring, batches under the caps, never a throw), `report/report.test.tsx` (the context and its truncation, the form, the panels, the tip); end to end `e2e/reports.worker.spec.ts`. The session-start check that brings reports to the user: [checks.md](checks.md).

## Content bundle

`frenchirix export-app` writes the bundle under `app/public/` for the scenes of `app/data/release.json`. It is derived data: regenerate it, never edit it. **Times in the bundle are milliseconds from the start of that scene's audio file**, unlike the database.

```
public/data/index.json              ContentIndex
public/data/scenes/<scene id>.json  Scene
public/data/songs/<song id>.json    Song
public/media/a/<scene id>.m4a       scene audio
public/media/f/<scene id>/<n>.webp  slideshow frames
public/media/s/, sf/                song audio and frames
public/media/q/<hash>.m4a           generated speech: questions, answers, line alternates
public/media/sfx/                   sound effects
```

The types are in `app/shared/content.ts`, the source of truth. What matters when using them:

- `ContentIndex`: the content `version` (cache busting), episodes with their `sceneIds` in timeline order, scene summaries, songs (`starter` marks the songs put among the first candidates), and a `bank` of lines and units used as distractors for small scenes.
- `SceneSummary`: `order` on the episode timeline, `startMs` in the episode, `kind` (dialogue, monologue, song), French and English titles, `score` (1–5, how funny or interesting), `difficulty` (1–5), `songId` when every line lies inside a song.
- `Scene` adds the audio, the frames (`t` in ms), the lines, the notes and the questions.
- `Line`: `id` (`s01e04-0016`), speaker, `fr` (what is said) and `en` (its literal English), times, `units`, optional `alternates` (two funny alterations, for `say-choice`), and `approxTimes` when its word times are estimates ([app-export.md](app-export.md)).
- `Unit`: `id` is `<line id>:<index>`, stable across exports and the key of per-kid statistics. Units tile the line's words in order without overlap; `cs`/`ce` are the character span in `line.fr`; `startMs`/`endMs` is the loop window (use `loopWindowFor`, which handles `approxTimes`); `key` marks units that carry meaning (eligible for blanks, matching, saying); `words` have their own times; `note` is an optional gloss note; `drill` names an optional word drill ([app-export.md](app-export.md), "Songs, word drills and sound effects").
- `Note`: `reference` or `wordplay`, in English for a ten-year-old, optionally tied to a phrase, a line and units.
- A line can belong to several scenes, so a unit id can appear in two scenes. That is intended: what a kid learns about a unit counts everywhere.
- **Word drills** (a unit's optional `drill`; the app plays one when a bundle has it, the export no longer writes any) are generated recordings of one word or phrase repeated several times with little interjections: ready-made loops. Play one through; never loop it in the player.
- Questions, French titles and difficulty come from `app/data/questions/<episode>.json`, alternates from `app/data/alternates/` ([app-content.md](app-content.md)). A scene without them still exports, with no questions, the English title as `titleFr` and a computed difficulty.

## The puzzle-type contract

Every puzzle type is a plug-in with two halves: pure logic in `shared/puzzles/<type>.ts` and a view in `web/src/puzzles/<type>/`, registered side by side. The same logic drives the screen, the bots and the checks, which is what makes "every practice can be finished" provable. The types are in `shared/practice/types.ts`; how to write one is in [app-games.md](app-games.md).

- `PuzzleBase`: `id`, `type`, `sceneId`; `helpLineIds` (the lines of the help strip, which must hold every piece of French the puzzle uses); `unitIds` (the units it exercises, for statistics); `questionId` (the scene question it shows, if any); `alt` (for a microphone puzzle, the tapping puzzle that replaces it).
- `PuzzleTypeMeta`: `role` (`intro`, `recognise`, `recall`, `produce`, `fun`), `scope` (`unit`, `line`, `long-line`, `multi-line`, `scene`), `minLevel`/`maxLevel` (the levels it suits), `needsMic`, `weight` (how often the composer picks it), `name` and `purpose` (shown on the `/dev` page of puzzle types, unique), `depth` (`intro`, `core`, `advanced`), and `seconds` (a rough estimate shown on `/dev`, not from timing kids; the composer ignores it).
- `PuzzleType<T, S, A>`: `build(ctx)` returns a puzzle or `null` when the scene cannot support one; `init`; `reduce` is pure, and a wrong action counts a mistake but never ends the puzzle in failure; `isDone`; `mistakes`; `missedUnitIds`; `solve` gives the next move of a perfect player; `validate(puzzle, scene)` lists problems.
- `BuildCtx`: the scene, the level, a seeded `rng`, `focusUnitIds` (always empty today), other scenes and the bank for distractors, the lines and units already used in this practice, `allowedQuestionIds`, and `targetLineId`/`targetUnitIds` (build on this line, these units, or return `null`).
- `PuzzleOutcome`: what the shell reports per finished puzzle: `puzzleId`, type, scene, units exercised and missed, mistakes, hints, `skipped`, time, `questionId`.
- Optional bot hook `wrongAction` (`BotHooks` in `shared/practice/bot.ts`): a wrong move a kid could make now, used by the clumsy bot.

**The 18 types**, by the angle they serve (`angleOf`):

| angle | types |
|---|---|
| scene (the opener) | `place-words` (the whole scene; the kid places up to five pieces in the lines), `watch` (fallback opener and last-resort replacement) |
| meaning | `listen-pick` (hear a line, choose among 5 English translations), `question` (a funny French question read aloud) |
| rebuild | `rebuild` (tap the line's pieces in the order heard), `fill-blanks` (key words blanked, tap from a word bank) |
| say (speaking on only) | `say-line`, `act-line` (say a long line as the character, in context), `say-choice` (say one of three lines: the original and its two alternates), `say-chain` (4 to 6 units in a row, hands-free), `say-hidden` (English plus a frame, French masked to first letters) |
| units | `match`, `catapult`, `vrai-faux`, `memory` |
| context (3+ lines) | `comic-order`, `next-line`, `line-meaning` |

## How a practice is composed

`composePractice({ id, seed, scene, level, speak, bank, allowedQuestionIds?, others? })` in `shared/practice/practice.ts` returns the practice (its puzzles), `composerVersion`, `level`, any `problems`, and a report: each puzzle's type, angle, the line asked for, the lines it covered and why it was chosen, plus coverage per line and angle (`practiceReport()` returns only the report, for the `/dev` pages). A practice is played from start to end with no breaks; the kid can leave after any puzzle and continue later. A replay is the same composer at the scene's current level. Every number named below is a constant at the top of that file.

- **Angles.** Every line is practised from five angles: meaning, rebuild, say, units, context. A puzzle type's angle comes from its meta (`angleOf`: scope `scene` or role `intro` is the opener, then microphone, then scope, then role).
- **Demand per level.** `LEVEL_ANGLES` gives, for each level, how many puzzles of each angle every line gets, with an extra units puzzle for every so many key units. Say counts only with speaking on; context only for scenes of three lines or more. The bronze practice leans on recognising meaning; later levels move to rebuilding and saying, and `PRACTICE_ROLE_WEIGHTS` shifts the same way. Every level is comprehensive, and later levels are as long as bronze (intent.md). Two puzzles of one angle on one line are of different types. A line should reach `MIN_ANGLES_PER_LINE` angles unless no puzzle type can serve it.
- **Length is set by coverage**: the opener, every demand, and one cross-line puzzle per three lines, within `PRACTICE_MIN` and `PRACTICE_MAX`. The practice ends when every demand is met or nothing more can be built, so a small scene ends shorter rather than repeating. Gap: intent.md asks for 28 to 50 puzzles; small scenes come out shorter today.
- **Order.** The first puzzle is the opener (`PRACTICE_OPENERS`: `place-words`, else `watch`). Then, position by position, a puzzle type is drawn, weighted by the level's role weights and the type's `weight`, a penalty for earlier uses, a stronger one for each use in the last `VARIETY_WINDOW` puzzles, a boost when it serves an angle still open on some line (most of all an angle a line has not had yet), a boost for each microphone type not yet used, and a boost for something fun in the last three of every `FUN_EVERY` positions. No type takes more than `PRACTICE_MAX_TYPE_SHARE` of the practice.
- **Variety, in type and in content** (the user, 2026-11-14: no puzzles "that feel identical come near each other", in "the type of the puzzle and what part of content they cover"; every line still covered). A gap counts positions (a gap of 3: at least two other puzzles in between):
  - one puzzle type: at least `TYPE_GAP` (3) apart, `TYPE_GAP_PREFERRED` (4) when possible;
  - one line: two puzzles about it (puzzles whose content is that line alone, or units of it only) at least `LINE_GAP` (3) apart, but never more than the scene's number of lines: a scene of two lines alternates, a scene of one line has no line rule. Puzzles across several lines (context, a match over three lines) do not count;
  - one unit: two unit puzzles (scope `unit`: `match`, `catapult`, `vrai-faux`, `memory`, `say-chain`, `say-hidden`) sharing a unit at least `UNIT_GAP` (4) apart.

  The rule is applied while choosing: single-line types skip lines practised just before, free-choosing types are aimed at a line not practised just before, and a built puzzle that breaks a content gap is set aside for that position. At each position the composer tries, in order: a puzzle serving an open demand within the preferred gaps, else a filler (variety only) within them; then the same within the rule; last, a puzzle serving an open demand with the gaps dropped (never the same type twice in a row, never for a filler; the step's reason ends with "spacing dropped"). That last case happens in scenes with few lines, units or types that fit; `checkPracticePolicy` allows at most `VARIETY_SLACK` (3) puzzles of a practice to come too soon after a similar one (`varietyBreaks`). The filler comes before the rule's gap because, late in a long scene, the open demand is often left to three types (meaning only by `listen-pick` once `question` has run out, rebuild by `rebuild` and `fill-blanks`; the multi-line and unit types met theirs early): within the rule they took turns for twenty puzzles (s01e02-0372-0383 at bronze); now a filler on its lines breaks the turn. Measured over the release (every scene and level, speaking on and off, two seeds; before = composer 2, after = 3 with the filler first): the same type within 3 puzzles 6.9 % → 0.2 % (within 4: 13.8 % → 2.2 %); six puzzles in a row of at most three types 5.9 % (composer 3 without the filler first) → 0.2 %; a one-line puzzle on the line of one of the two before 13.5 % → 1.9 % (0.4 % in scenes of three lines or more); a unit puzzle sharing a unit with one of the two before 19.4 % → 0.0 %; unmet demand 12.1 % → 12.5 %; median length 25 → 25 (24 without the filler first).
- **Targeting.** Each drawn type is asked for the least-covered line that needs its angle (`BuildCtx.targetLineId`): single-line types build that line, unit types include its units, cross-line types include the line. Types that ignore the target are steered by marking the other lines as used, and are credited with what they built. `question` follows its question's line.
- **Weak spots do not steer a practice**: the plan carries `focusUnitIds`, but the composer builds with an empty set.
- **Microphone puzzles** carry their tapping replacement in `alt` (`replaceMicPuzzle` in `shared/practice/replace.ts`), which the shell plays when the kid turns speaking off mid-practice (the header's switch, « Je ne peux pas parler »): the practice keeps its composition. With speaking off from the start there are none. **The replacement keeps the variety rule**: the composer chooses it once the whole practice is composed, so it knows the puzzles on both sides. It tries, in order, the tapping types that serve the same French or line (`replacementPlan`: `rebuild` of the line, or `fill-blanks` with the unit for `say-hidden`, `match` for `say-chain`; then `fill-blanks`, `listen-pick`, `match`, `catapult`, `vrai-faux`, `line-meaning` on that line), then any tapping type on the scene, and takes the first that keeps the variety rule with the two puzzles before and the two after (in either of their forms, a microphone puzzle or its replacement) and keeps its type within `PRACTICE_MAX_TYPE_SHARE`; else the first on the same line that is at least not the type of the puzzle just before or after; else the first that builds. What the puzzles around it are about counts as used for its build (their lines, their units), so a `match` fills its board with other units. Deterministic from the seed like the rest: a continued practice gets the same replacements. `check:practices` plays every practice composed with speaking on with speaking off from each puzzle on, under the same variety rule ([checks.md](checks.md)). Measured over the release (every level, speaking on, two seeds, speaking off from the first puzzle): the same type twice in a row 3,847 → 0 puzzles, practices over `VARIETY_SLACK` 966 → 0 of 2,436, puzzles too soon 7,928 → 296 of about 70,000; the replacement is on the same French 79 % → 45 %, on the same line 20 % → 52 %, elsewhere in the scene 2 % → 4 %. **The spacing rule** (it replaced the per-sitting limit): at most `MIC_PER_WINDOW` (2) microphone puzzles in any `MIC_WINDOW` (10) consecutive puzzles, and never two in a row (`micSpacingProblems`).
- **Determinism and continuing.** Composition is deterministic for (scene, level, seed, speak, content) and `COMPOSER_VERSION` (`shared/practice/version.ts`). The server stores the seed, the client's composer version and the content version, and saves progress as a count of finished puzzles; continuing composes the practice again and starts at `resumeIndex(done, length, same)`: puzzle `done`, but when the composer or the content differ from the plan's (`same` false) no later than the last puzzle, so a practice never finishes without a puzzle played. **Bump `COMPOSER_VERSION` whenever a change to the composer or to any `build` would give other puzzles for the same input.**
- `npm run check:practices` composes every release scene at every level, with speaking on and off, and plays it to the end ([checks.md](checks.md)).

## Our own French: questions, answers and alternates

Any French the app shows that does not come from a scene follows three rules from the user (intent.md, "Puzzles").

**Every piece of it is tappable for its meaning.** A question, each of its answers and each line alternate carry `units` (`GlossUnit`: `fr`, `en`, and the character span `cs`/`ce`) that tile the sentence. `GlossText` draws such a sentence as coloured boxes, and a tapped box opens the hint bubble with its English ([app-games.md](app-games.md)). The units are written (a content step, [content-steps.md](content-steps.md)) into `app/data/questions/<episode>.units.json` (a map from the exact French sentence to its units) and into the alternates files, and merged by the export. A sentence without units exports as one unit covering the whole sentence.

**Its audio is generated ahead of time and loops at once.** A `Question` has `id`, an optional `lineId`, `fr`, `en`, `units`, 3 to 4 `answers` (each `fr`, `en`, `correct`, `units`, optional `audio`; exactly one correct), a `voice` preset (`squeaky`, `deep`, `wobble`, `echo`, fixed per question at export), and an optional `audio` path. The clips come from `scripts/tts_questions.py` ([app-tts.md](app-tts.md), which owns the clip hash rule); the export sets `audio` only when the clip exists. A question without a clip is shown silently while the related line of the scene loops. The question's audio starts looping as soon as the puzzle appears; tapping an answer plays that answer.

**A joke must not get old.** The rule is in [app-rules.md](app-rules.md), "Question spacing". The data path: the server sends the eligible question ids of the practice's scene in `PracticePlan.allowedQuestionIds`; the composer passes them as `BuildCtx.allowedQuestionIds`, minus the questions already asked in this practice (none is asked twice in one practice); a puzzle that shows a question sets `PuzzleBase.questionId`; the shell copies it into `PuzzleOutcome.questionId`; the server records it when the practice is completed. With no eligible question, `question` returns `null` and the composer picks another type.
