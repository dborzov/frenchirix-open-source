# AGENTS.md

Frenchirix teaches French listening comprehension to ten-year-olds in French immersion through short scenes from a French cartoon series. Two parts: the app (`app/`, on Cloudflare Workers), which comes first; and a Python pipeline (`frenchirix/`) that cuts the scenes out of the episodes into `assets/db.sqlite`, and can be run on other video sources ([docs/runbook.md](docs/runbook.md), "Another show or your own video sources").

In these docs "the user" is the project's original owner, whose decisions are recorded in [docs/intent.md](docs/intent.md); where a doc says to ask the user, ask the person you work for.

## Glossary

Use these words, and only these, in code, docs, interface text and replies. When the user uses another word for one of these concepts, say which term we use.

- **scene**: a short stretch of an episode (usually a few lines, at most about a dozen); the content a practice is built on.
- **line**: one line of dialogue in a scene.
- **unit**: a piece of a line (a word or an expression) with its own meaning and audio window. The app draws each unit as a coloured box; tapping it shows its English and loops its audio.
- **note**: a short explanation in simple English of a cultural reference, a word a ten-year-old may not know, or wordplay; attached to a scene, a line or a unit.
- **practice**: the exercise on one scene: a sequence of puzzles that covers every line of the scene from several angles, with repetition. A kid can leave a practice at any point and continue later; only the number of finished puzzles is saved.
- **puzzle**: one round inside a practice.
- **puzzle type**: one of the kinds of puzzle (`match`, `say-chain`, …). `question` is one puzzle type (a funny question in French), not a word for puzzles in general.
- **level**: bronze, silver, gold, titanium, diamond, plutonium. A kid *passes a practice at a level*; a scene's level is the highest one passed (or none).
- **due**: after a level is passed, the practice at the next level becomes due on a later day, by the spaced-repetition schedule.
- **replay**: playing the practice of a scene whose next level is not due yet; it earns XP only.
- **daily quests** (**quests**): the 3 to 5 things to do today, on Home. A quest is either choosing new scenes or passing a practice at a level.
- **candidates**: the 10 scenes offered when a kid chooses new scenes. **Unlocking** a scene is choosing it.
- **light streak / full streak**: a day on which the kid passed at least one practice / a day on which all of that day's quests were done.
- **difficulty**: how hard a scene's French is, 1 to 5.
- **skill**: the app's estimate of a kid's French, 1 to 5, matched against difficulty when choosing candidates.
- **rank**: the kid's rank from total XP.
- **song**: one of the karaoke songs, sung along on the karaoke screen.
- **take**: what the microphone just captured of a kid singing a song, checked but not kept yet. A word for code and docs; the interface does not use it.
- **recording**: a kid's kept singing of one song (at most one per kid and song); it plays with the song whenever that kid hears it. In code, the part of the karaoke screen that records is the *studio*.
- **annotation**: the pipeline step that writes a line's final French, literal English, units and notes.
- In the interface, the same terms in French and English: pratique / practice, défi / puzzle, niveau / level (bronze, argent, or, titane, diamant, plutonium), rang / rank, quêtes du jour / daily quests, scènes au choix / scenes to choose from, débloquer / unlock, rejouer / replay, série / streak, série légère / light streak, série complète / full streak, note / note, réplique / line, chanson / song, enregistrement / recording, garder / keep, effacer / erase. Other words the interface uses one way only (touche / tap, appareil / device, the comic sound words...) are listed at the top of `app/shared/i18n/fr.ts`.
- **review UI**: the local tool (`frenchirix serve`) where the user reviews scenes and marks lines that need fixing.
- **review mark**: a line, or one unit of it, that the user marked in the review UI as needing a fix, with a category and a **comment** (the user's text; a note is only the explanation for a child); a fixer (an agent or a person) carries it out ([docs/content-steps.md](docs/content-steps.md), "Fixing review marks").

Retired words: lesson, task, game (for a puzzle type), medal, stage, sitting, stop, quiz, offer, explanation. Sittings, stops, quizzes and bonus sittings are gone (daily quests and replays replaced them). Achievement ids such as `first-lesson` and `quizzes-30` are stored per kid and keep their names.

## Rules

- Do not overengineer. Prefer the simplest design that does the job; add machinery only when its value clearly outweighs the work and the complexity. The user set this for the whole project.
- The show's content is reflected faithfully. Never soften, skip or replace it on your own idea of what suits children: the source is a show made and rated for children, and any question of appropriateness belongs to the person who runs the project ([docs/intent.md](docs/intent.md), "Principles"). This holds for every agent or person that writes or selects content, and every brief for one carries it.
- Reading or writing the show's content (choosing scenes, annotation, notes, questions, alternates, review fixes) is a content step: its inputs, output formats and rules are in [docs/content-steps.md](docs/content-steps.md). The owner ran these steps with subagents whose definitions are not part of this repository; brief your own from that file. An orchestrating session does not read whole subtitle files, cue sheets or annotation sheets; sampling a few scenes of a pilot's output is fine. This keeps token cost down across many scenes.
- `content/` holds your own source episodes (not in the repository): read it, never modify, move or commit anything in it.
- `assets/db.sqlite` is not in the repository: `frenchirix import` creates it from your episodes, and the pipeline's steps create `selections/`, `annotations/` and `corrections/` as you work. They are source data that cannot be rebuilt without redoing the content steps: keep them (commit them in your own repository, or back them up). Generated media (`assets/audio/`, `assets/video/`, `work/`, `app/public/data/`, `app/public/media/`) are git-ignored and never edited or committed by hand. `assets/tts-voice/` (the reference voice of the generated question audio) cannot be regenerated and is committed.
- Times in `assets/db.sqlite` are integer milliseconds on the source episode's timeline. The one exception is `scenes.frame_times_ms`, relative to the scene's clip. The app's exported bundle uses milliseconds from the start of each scene's audio file.
- Subtitle text imported into `cues` is never edited. A wrong subtitle translation is fixed in `corrections/<episode>.json`, which `import` applies. The French and English the app shows (`fr_final`, `en_literal`), units and notes are fixed through annotation ([docs/runbook.md](docs/runbook.md), "Repairing a scene").
- Python: run `.venv/bin/frenchirix …` or `uv run --no-sync …`. Never run a plain `uv sync`: it removes the speech packages of the optional `asr` group. No `pip`.
- Download nothing before checking what is on the machine: model weights, PyTorch and wheels may already be cached ([docs/transcription.md](docs/transcription.md), "Weights"). A subagent once started a large download of weights that were already on disk.
- After changing scene data, run `.venv/bin/frenchirix check`. After changing anything in `app/`, run `npm run check` in `app/`. The pre-commit hook runs the checks that apply; enable it in a new clone with `git config core.hooksPath .githooks`. What each check means: [docs/checks.md](docs/checks.md).
- A change to how media are encoded or played is tested in a real browser window, not only headless: a video can load without error and still show black ([docs/media.md](docs/media.md)).
- A new account starts with the app's interface in English, with a switch to French in the profile (the user's decision: French first was too intimidating). Do not follow the browser's language.
- When an API call fails, the app shows the kid a plain message, a short copyable technical detail for the admin, and returns to the last working state so the kid can retry. No offline mode and no silent background retries.
- Kids' accounts have no email. A kid who loses their login asks the admin, who looks it up in the database ([docs/app-release.md](docs/app-release.md), "Reading the log and the reports").
- `TEST_MODE` is never set in production. Deploy only with `app/tools/deploy.sh`, which refuses when a check fails ([docs/app-release.md](docs/app-release.md)). Passwords and the session secret are Worker secrets, never in `wrangler.jsonc`.
- Subagents run no git command that changes state; the orchestrating session commits, at every finished phase of work.

## Reference files

Read a file only when its trigger applies.

Product
- [docs/intent.md](docs/intent.md): read before any product, game-design, UX or content decision. What the user wants, in their words, and the open questions.

App
- [docs/app-status.md](docs/app-status.md): read first when picking up work on the app. What was never verified on a real device or by ear, known rough edges, open items in the code.
- [docs/app-architecture.md](docs/app-architecture.md): read before changing anything in `app/` or the export. The stack, the content bundle, the puzzle-type contract, how a practice is composed.
- [docs/app-rules.md](docs/app-rules.md): read before changing levels, due days, daily quests, streaks, XP, rewards or leagues. The game rules as implemented.
- [docs/app-server.md](docs/app-server.md): read before changing the Worker, the D1 schema or migrations, the API, accounts, or speech recognition and its judge.
- [docs/app-games.md](docs/app-games.md): read before adding or changing a puzzle type, the practice screen, the audio engine, the help strip, the hint bubble, the playback bar or the speaking puzzles.
- [docs/app-dev.md](docs/app-dev.md): read before running, testing or adding to `app/`. Scripts, ports, the `/dev` portal, end-to-end tests.
- [docs/app-content.md](docs/app-content.md): read before writing or revising questions, French titles, difficulty, line alternates or their units.
- [docs/app-export.md](docs/app-export.md): read before running or changing `frenchirix export-app`, the app's audio and frames, or the timing fallbacks.
- [docs/app-tts.md](docs/app-tts.md): read before generating or regenerating the spoken audio of questions, answers and line alternates, or trusting a clip.
- [docs/app-release.md](docs/app-release.md): read before deploying your own copy, applying migrations to production, touching the domain, the manifest, icons or installing, or changing how a running app updates itself.
- [docs/app-style.md](docs/app-style.md): read before styling any screen, puzzle or avatar, and before judging a screenshot. The 1950s comic-book art direction.

Content pipeline
- [docs/runbook.md](docs/runbook.md): read before processing an episode, re-running a step, repairing a scene, or adapting the pipeline to another show or your own video sources. The steps in order and who does each.
- [docs/content-steps.md](docs/content-steps.md): read before doing a content step (choosing scenes, annotation, notes, review fixes, questions, alternates) or briefing an LLM to do one. What each step gets, the exact output format, the rules of good output, the checks.
- [docs/pipeline.md](docs/pipeline.md): read before importing an episode, re-importing one that has scenes, correcting a translation, loading annotations or a selection.
- [docs/data-model.md](docs/data-model.md): read before changing the schema of `assets/db.sqlite` or querying it.
- [docs/transcription.md](docs/transcription.md): read before running `transcribe` or `align`, touching the speech models or the `asr` group, or relying on word timings.
- [docs/media.md](docs/media.md): read before changing how scene audio or video is cut, faded or encoded.
- [docs/review-ui.md](docs/review-ui.md): read before changing the review UI (`frenchirix serve`, `web/`) or its API, or working with review marks.
- [docs/show-context.md](docs/show-context.md): read before selecting, transcribing, annotating or writing content for scenes, and give it to whoever does it. The show's facts, French-to-English names, running gags; the worked example of the context file for another show. Code parses its tables: keep its path and table format.

Process
- [docs/checks.md](docs/checks.md): read before relying on a check, adding one, or bypassing a hook. Every check and hook, what a finding means and what to do.
- [docs/orchestration.md](docs/orchestration.md): read before briefing a subagent or fanning work out to many. The roles the owner's subagents had, briefing rules, lessons for running agents.

## Maintaining these docs

This file holds only what every task needs. Details go in a focused file in `docs/`, linked directly from this file; each file over about 100 lines starts with a table of contents. Docs record current rules, decisions with their reasons, and notes that matter for future work; not history (git keeps it) and not numbers a command reproduces. Do not describe the architecture or the file layout here. When the user clarifies an intent or makes a decision, record it in [docs/intent.md](docs/intent.md) in their words, so they never have to repeat it. When a task teaches something a later agent would get wrong, add it to the right file and mention the edit in your final report.

These docs were written by agents. When a claim looks dubious, check it against the code; when it claims a user decision that `docs/intent.md` does not hold, ask the user before relying on it.
