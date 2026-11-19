# Checks and hooks

Every check and hook in one place: `frenchirix check` (the scene data), `npm run check` (the app's gate: type-checking, unit tests and `check:practices`), `check:liveness` (stuck puzzles) with its ledger, the session-start check for the kids' problem reports with its ledger, the end-to-end tests, and the pre-commit hook with its bypasses; what each finding means and what to do about it. Read before relying on a check, adding one, or bypassing a hook.

## Contents

- **Which check when**: the commands, and the rules for findings.
- **The pre-commit hook**: when each part runs, what it reads, how to bypass it.
- **`frenchirix check`**: running it, its output, every check of the scene data, what is not checked, adding a check.
- **`check:practices`**: running it, what it proves, what to do about a finding, covering a new puzzle type.
- **`check:liveness`**: stuck puzzles: how it plays them, the kinds of finding, the ledger, replaying, running it automatically.
- **The session-start check**: the kids' "Quelque chose ne va pas ?" reports not yet handled, its ledger, running it at the start of a session.
- **Type-checking, unit tests and end-to-end tests**.

## Which check when

| You changed | Run | Notes |
|---|---|---|
| scene data (`assets/db.sqlite`, `annotations/`, `selections/`, `corrections/`) | `.venv/bin/frenchirix check` (repo root) | The hook runs it on the staged database. |
| the pipeline's Python (`frenchirix/`, `scripts/`, `tests/`) or the review UI (`web/`) | `.venv/bin/python -m pytest -q` (repo root) | Fast tests only; add `-m slow` after changing transcription, alignment, rendering or the import. Not in the hook. |
| the export, the release list, questions or alternates | `.venv/bin/frenchirix export-app --data-only`, then `npm run check:practices` (in `app/`) | The checks read the bundle in `app/public/data`, not the database. |
| anything in `app/` | `npm run check` (in `app/`) | The app's gate: `typecheck`, `npm test`, `check:practices`. `tools/deploy.sh` runs it and refuses to deploy when it fails. |
| a puzzle type, the practice screen, speech, audio or the scene components | `npm run check:liveness` (in `app/`) | About 30 s. The pre-commit hook runs it. |
| a screen, a puzzle type, audio or speech in the client | `npm run e2e` (in `app/`) | Not in `npm run check` and not in `deploy.sh`; run it before deploying. How: [app-dev.md](app-dev.md). |

Rules for findings:

- Do not weaken a check to get a commit through. Bypass the hook for a deliberate exception and say why in the commit message.
- Do not change right data to silence a warning; warnings are "worth a look", not "wrong".
- A failing check after a change is the point of the check: find out why before touching the check.

## The pre-commit hook

`.githooks/pre-commit`; enable it once per clone with `git config core.hooksPath .githooks`. It runs three parts, each only when the staged files touch what it checks, and stops the commit if any fails.

**1. Scene data**, when the commit touches `assets/db.sqlite`, `annotations/`, `selections/` or `corrections/`. This repository ships none of them (they are built from your own episodes); the part matters in a repository where you commit your data:

- It checks the database **as staged** (`git show :assets/db.sqlite` copied to a temporary file), which is what the commit contains. Media files are looked up in the working tree's `assets/`; without `assets/audio` and `assets/video` it runs with `--no-media`.
- It runs `.venv/bin/python -m frenchirix.cli check` when the project environment exists, else `uv run --no-sync frenchirix check`, else `python3 -m frenchirix.cli check` (the check is standard library only).
- Clean or warnings only: it prints the summary line and lets the commit through. Errors: it prints the findings (`--limit 5`) and stops the commit.

**2. Practices**, when the commit touches `app/shared`, `app/data`, `app/tools`, `assets/db.sqlite` or `frenchirix/app_export.py`:

- It exports the JSON bundle into a temporary directory (`frenchirix export-app --data-only --out <tmp>`) and runs `tools/check-practices.ts --data <tmp>/data --no-media`.
- It checks the **working tree**, not the index: the exporter reads `assets/db.sqlite` from disk and the code is the checked-out code. Stage what you tested.
- Without `app/node_modules` it prints one line and skips.

**3. Liveness**, when the commit touches `app/web/src/puzzles`, `practice`, `speech`, `audio`, `scene` or `testing`, `app/shared/puzzles` or `app/tools/liveness`:

- It runs `tools/liveness/run.ts` on `app/public/data` (on a temporary export when there is none), on the **working tree**, and stops the commit on a finding the ledger does not cover (exit 1). A crash of the check itself (exit 2) is printed and does not stop the commit.

**Bypass**, for a deliberate exception, saying why in the commit message:

```
FRENCHIRIX_SKIP_CHECK=1 git commit …     # skips the scene-data part only
FRENCHIRIX_SKIP_PRACTICES=1 git commit … # skips the practices part only
FRENCHIRIX_SKIP_LIVENESS=1 git commit …  # skips the liveness part only
git commit --no-verify …                 # skips every hook
```

To test the hook without staging: `FRENCHIRIX_HOOK_FILES="app/shared/x.ts" .githooks/pre-commit` stands in for the staged file list (the scene-data part still reads the staged database).

## `frenchirix check`

The sanity check of `assets/db.sqlite` and the scene media. It finds what a program can find (a line nobody annotated, a unit that skips a word, media that no longer match a retimed scene) so that human review goes to what only a person can judge. It makes no judgement about the French, the translations or the jokes.

```
.venv/bin/frenchirix check                    # everything; exit 1 if there is any error
.venv/bin/frenchirix check --episode s01e05   # one episode's scenes and lines
.venv/bin/frenchirix check --no-media         # a clone without assets/audio and assets/video
.venv/bin/frenchirix check --limit 5          # at most 5 findings printed per check
.venv/bin/frenchirix check --errors-only      # leave warnings out
.venv/bin/frenchirix check --db other.sqlite --assets other/assets
```

- It opens the database read-only and never writes. It does not migrate an old schema the way `frenchirix.db.connect()` does: it reports `db.schema_version` and stops.
- It reads only the database and file sizes; no media is decoded. `--no-media` skips only what needs the files on disk (`media.files` existence and size, `media.orphan`).
- Database-level checks always cover the whole file, even with `--episode`.
- Standard library only, so it runs with any Python 3.12.

**Output**: one finding per line, errors first, grouped by check, then a summary with a count per check. The columns are severity, check name, episode, scene id, line number (4 digits), message; `-` where a column does not apply. The first five columns never contain spaces, so `line.split(maxsplit=5)` parses a finding.

```
error   media.pending        s01e04 s01e04-0010-0011 -     render_params is NULL: re-render with `frenchirix render --episode s01e04`
```

**Exit status**: 1 when there is at least one error; warnings do not count. An **error** is wrong by definition (missing, empty, inconsistent, impossible); a **warning** is probably fine but worth a look. Each check has one fixed severity and a stable name; the list is `CHECKS` in `frenchirix/check.py`.

### Database

| Check | Severity | Fires when | What to do |
|---|---|---|---|
| `db.integrity` | error | `PRAGMA integrity_check` is not `ok` | The file is damaged. Restore it from git. |
| `db.foreign_keys` | error | a row whose parent is missing | Find who deleted the parent; usually a hand edit. |
| `db.schema_version` | error | `meta.schema_version` is not the current `SCHEMA_VERSION` | Run any pipeline command once (it migrates through `frenchirix.db.connect()`). Nothing else is checked until then. |
| `db.dangling` | error | words or units for a missing or unannotated line; notes for a missing scene or line | Re-run `annotate-import` for the episode, or delete the leftover rows. |

### Scenes

| Check | Severity | Fires when | What to do |
|---|---|---|---|
| `scene.id` | error | the id is not `<episode>-<first:04d>-<last:04d>` | The range was edited by hand without the id. Re-import the selection. |
| `scene.lines` | error | a line number in the range has no `lines` row | The range or the episode import is wrong. |
| `scene.core` | error | `core_end_ms <= core_start_ms`, or the core is narrower than the first line's subtitle start to the last line's subtitle end | `select-import` and `retime` never produce this; re-run them. |
| `scene.core_wide` | warning | the core reaches more than 2.5 s (retime's maximum) beyond those subtitles | Check whether the core was set by hand. |
| `scene.fields` | error | empty title or `why`, invalid kind, score not 1–5, empty `selected_by` or `created_at` | Fix the selection file and re-import it. |
| `scene.tags` | error | `tags` is not a JSON list of non-empty strings | As above. |
| `scene.group_split` | error | the line before the first or after the last shares a translation group with it | A scene must not split a group ([data-model.md](data-model.md)); the groups changed after selection. |
| `scene.kind_song` | warning | kind `song` with no sung line, or every line sung and kind not `song` | Check the kind. |

### Media

The render columns of `scenes` and the files they name ([media.md](media.md)).

| Check | Severity | Fires when | What to do |
|---|---|---|---|
| `media.window` | error | clip or fade columns NULL, the clip does not contain the core, the fades do not fit, or the clip runs outside the episode | `frenchirix render --episode <ep>`. |
| `media.pending` | error | `render_params` is NULL: `retime` found the media no longer match the core, or never rendered | `frenchirix render --episode <ep>` re-renders exactly these. |
| `media.stale` | error | the stored clip and fades are not what `render_params` give for the current core | The core changed without `retime`. Run `frenchirix retime <ep> --render`. |
| `media.frames` | error | `frame_times_ms` does not parse, start at 0, increase, fit the clip, or match the render settings | `render --scene <id> --force`. |
| `media.files` | error | `audio_file` or `video_file` NULL, missing or empty under `assets/` | Re-render; with `--no-media` only NULL is checked. |
| `media.file_name` | warning | a file is not `audio/<scene id>.opus` or `video/<scene id>.mp4` | Media of another scene, or a hand edit. Re-render. |
| `media.render_version` | warning | rendered by an older `RENDER_VERSION` | Re-render with `--force` when convenient. |
| `media.silent` | warning | rendered, but `audio_peak_db` is NULL (digital silence) | Listen; the audio stream or window is likely wrong. |
| `media.orphan` | warning | a file in `assets/audio/` or `assets/video/` no scene names, or a leftover `assets/.render-*` | Usually media of a scene whose range changed. Delete once sure. |

The clip window is checked without probing the episode: the start must be `max(0, core_start − padding)`; the end `core_end + padding`, or less when the clip ends in the episode's last 60 s (renders clamp to where the packets end).

### Texts

For every line of every scene.

| Check | Severity | Fires when | What to do |
|---|---|---|---|
| `text.missing` | error | the subtitle text, the final French or the literal English is NULL or blank | Annotate the line ([runbook.md](runbook.md), "Repairing a scene") and run `annotate-import`. |
| `text.translation` | error | the line's `group_idx` has no English `translations` row covering it | Re-import the episode. |
| `text.same_as_fr` | warning | literal English equals the French (ignoring case, accents, punctuation) on a line of 3+ words | Untranslated, or a song or chant the same in both. |
| `text.length` | warning | the final French has under half the subtitle's words, or over twice plus 3 | Usually speech the subtitle dropped (correct); sometimes a merged or cut line. Check by ear. |
| `text.shape` | warning | a different number of line breaks than the subtitle | Annotation keeps the subtitle's shape (two speakers, lyric lines). |
| `text.whitespace` | warning | leading, trailing or doubled spaces | Tidy the annotation file and re-import. |
| `text.annotated_by` | warning | `fr_final` set and `annotated_by` NULL | Text written outside `annotate-import`. |
| `text.unused` | warning | an annotated line in no scene | Harmless. |

### Words

Words are the tokens of `fr_final` with their times ([transcription.md](transcription.md)). A NULL score with a time is a word the aligner could not spell (a number, a symbol): valid, not reported.

| Check | Severity | Fires when | What to do |
|---|---|---|---|
| `words.tokens` | error | the `words` rows are not exactly `split_words(fr_final)`, or no words | `fr_final` changed without rebuilding the words. `annotate-import`, then `align` and `retime`. |
| `words.untimed` | error | a word has no start or end | `frenchirix align <ep>`, then `retime`. |
| `words.order` | error | a word ends at or before its start, or starts before the previous word ends | Re-align with `--force`. |
| `words.across_lines` | error | a line's first word starts before the previous line of the scene ends | Re-align. |
| `words.outside_clip` | error | a word lies outside the scene's clip window | `retime --render`; if still outside, the alignment is wrong. |
| `words.line_audio` | error | `audio_start_ms`/`audio_end_ms` disagree with the first and last word, or are set while words are untimed | Re-align. |
| `words.score` | error | a score outside 0..1 | Re-align. |

### Units

| Check | Severity | Fires when | What to do |
|---|---|---|---|
| `units.cover` | error | unit numbers not 1..n, or the units do not cover the line's words exactly once, in order | Fix the annotation file and re-import. |
| `units.kind` | error | kind is not `word` or `expression` | As above. |
| `units.gloss` | error | blank English gloss | As above. |
| `units.text` | error | the stored text is not `fr_final` from the first word's start to the last word's end | The units are from an older `fr_final`. Re-import. |
| `units.line_break` | error | a unit's text contains a line break | A unit never crosses a break. Split it. |
| `units.note` | warning | a note is an empty string instead of NULL | Harmless; tidy at the next import. |

### Notes

The `note.*` checks cover the scene notes (cultural references and wordplay).

| Check | Severity | Fires when | What to do |
|---|---|---|---|
| `note.kind` | error | kind is not `reference` or `wordplay` | Fix the scene object in the annotation file and re-import. |
| `note.text` | error | blank text | As above. |
| `note.phrase` | error | a phrase without a line or a line without a phrase, a half-set word span, a blank phrase, or a line not in the scene | As above. |
| `note.span` | error | the word span is outside the line, or its words are not the phrase's | The line's French changed after the phrase was located. Re-import the annotation. |
| `note.order` | warning | the scene's notes are not numbered 1..n | A hand edit. |
| `note.unlocated` | warning | the phrase has a line but could not be found in it | Correct the phrase or the line, and re-import. |

### Timing quality

Warnings only: the data is consistent, but the timing may be wrong.

| Check | Severity | Fires when | What to do |
|---|---|---|---|
| `timing.unreliable` | warning | every word of the line scores 0.0: the guard found no acoustic evidence and spread the words over the subtitle time | Listen to the line. |
| `timing.fade` | warning | the first line starts inside the fade-in, or the last line ends inside the fade-out | `retime` moves an edge only on trusted alignment. Listen; widen by hand if a syllable is faded. |
| `timing.far` | warning | the words start more than 2.5 s before the subtitle or end more than 2.5 s after it | Misplaced alignment; listen. |

### Not checked

- Media durations and contents (that the files really span the clip, that frames really are at `frame_times_ms`): too slow for a hook. `tests/test_render_media.py` checks the render on sample windows.
- That a clamped clip end equals the episode's real media end (needs probing the source).
- That `annotations/` agrees with the database: `annotate-import` is the only way the files reach it, and it validates them.
- Whether text is right: transcription, translation, unit split and notes need a person.

### Adding a check

Add it to `CHECKS` in `frenchirix/check.py` with its severity, implement it in `Checker`, add a defect to `DEFECTS` in `tests/test_check.py` (a test fails when a check has none), and add a row here. Keep it cheap and mechanical: if deciding needs a judgement about the French, it is not a check. Python tests: `.venv/bin/pytest`.

## `check:practices`

Proves that every practice composed from the real bundle can be finished and has what a kid needs on the page, by driving the real composer, validator and reducers. Code: `app/tools/check-practices.ts`, with `shared/practice/practice.ts` (`composePractice`, `checkPracticePolicy`, `varietyBreaks`, `micSpacingProblems`), `validate.ts` and `bot.ts`. A replay is the practice at the scene's level, so the levels cover replays too.

```
cd app
npm run check:practices                          # the bundle in public/data, media included
npx tsx tools/check-practices.ts --no-media      # a clone without media
npx tsx tools/check-practices.ts --data <dir>    # another bundle (what the hook does)
npx tsx tools/check-practices.ts --practice s01e03-0023-0026 --level 3 --seed 1 [--speak off]   # compose one practice again
```

- Regenerate the bundle first when the database, the release list or the exporter changed: `.venv/bin/frenchirix export-app --data-only` from the repository root (`--out <dir>` writes `<dir>/data`). Without media in `public/media` (a fresh clone), run with `--no-media` or export the media first.
- Options: `--seeds n` (per level, default 2), `--all-scenes` (every scene of the bundle, not only `app/data/release.json`), `--limit n` (problems listed), `--no-panono` (skip the printed plan of the Panono scene).
- Exit code 1 on any problem; warnings never fail. The output also reports practice lengths and microphone puzzles per level, the variety numbers (puzzles that came too soon after a similar one, in how many practices, the most in one; also for practices played with speaking turned off at their first puzzle), puzzle types by use and how often each `build` returned null, which tapping puzzles replace the microphone ones, types that ignored a target line, and lines under the minimum of angles with the reason. Each problem comes with the command line that replays it.

### What it proves

**Content, independent of the puzzles** (replay line `content <scene>`):

every media file a scene names exists under `public/` (with `--no-media`, paths must still start with `/media/`); every time window lies inside the scene's audio; each line's units tile it in order with English; every question has 3 to 4 answers with exactly one correct and a known voice; the units of every question, answer and alternate tile their sentence; an alternate is never the line itself; every release scene is in the bundle.

**Puzzle-type descriptions**: every registered type has a non-empty `name` and `purpose`, a valid `depth` and `scope`, and a name no other type has.

**Practices**: every release scene at every level, speaking on and off, seeds 1 and 2:

- the **composer** reports a type that threw in `build`, or a microphone puzzle without a tapping replacement;
- the **validator** (`validate.ts`) runs each puzzle's own `validate`, then checks ids, scenes, registered types that suit the level, a bronze practice opening with the scene-wide opener, no microphone puzzle with speaking off, a valid `alt` on every microphone puzzle, and above all that **every unit a puzzle uses belongs to a line in its `helpLineIds`**;
- the **perfect bot** plays each puzzle and each `alt` through the real reducer (`solve` then `reduce` until `isDone`, at most 300 steps); a puzzle fails when it does not finish, throws, mutates its input state, is finished before any move, or ends with mistakes for a perfect player;
- the **clumsy bot** adds wrong moves and must still finish: a wrong move counts a mistake and never finishes the puzzle;
- the **policy** (`checkPracticePolicy`): length, the opener, no type twice in a row and none over its share, the **variety rule** (one type `TYPE_GAP`, one line `LINE_GAP` or the scene's number of lines, one unit between unit puzzles `UNIT_GAP` positions apart; at most `VARIETY_SLACK` puzzles of a practice may come too soon, [app-architecture.md](app-architecture.md), "How a practice is composed"), the **microphone spacing rule** (at most `MIC_PER_WINDOW` in any `MIC_WINDOW` consecutive puzzles, never two in a row), and every line reaching `MIN_ANGLES_PER_LINE` angles unless the types returned null for it;
- **speaking turned off mid-practice**: a practice composed with speaking on, played with speaking off from each puzzle on (its microphone puzzles from there are their `alt`, `speakingOffSteps`), has no type twice in a row and keeps the same variety rule (at most `VARIETY_SLACK` puzzles too soon); the problem names the puzzle where speaking was turned off;
- composing the same input twice gives the same puzzles.

**Wrong moves need the type's help**: the contract gives no way to enumerate wrong actions, so a type opts in with `wrongAction` (`BotHooks`). Without it the clumsy bot plays like the perfect one and the run warns, naming the type (today only `watch`, which has no wrong move).

**What it does not prove**: that the screen shows what `solve` uses, or that a view can reach every state (`check:liveness` plays the views). The help-strip guarantee is only as good as each type's `helpLineIds` and `validate`.

### What to do about a finding

- *Content* problems come from the bundle: fix the data (database, `frenchirix/app_export.py`, the questions or alternates files), re-export, re-run. Never hand-edit `public/data`.
- *A line under the minimum of angles*: the reason names the types that returned null for it. Usually the line is one interjection with no key unit, or has `approxTimes`. Make a type accept it, fix the data, or accept it (the line is still heard in the opener and the cross-line puzzles).
- *Validator* and *bot* problems name the type: run the replay line (it prints the practice's plan and each problem with its puzzle id and type) and fix that type's `build`, `solve`, `reduce` or `validate`.
- A *mutating reducer* breaks React rendering in the app too; return new objects.

### Covering a new puzzle type

Register it ([app-games.md](app-games.md)); the composer, the validator, the bots and the command use whatever is registered. Give it an honest `meta`, honour `targetLineId`, a `validate` that checks what only it knows (and its choices by the rule in [app-games.md](app-games.md), "Choices"), and a `wrongAction`. Then run `npm run check:practices` and read its null rate and warnings.

## `check:liveness`

Finds puzzles a kid can get stuck in: no button or action that moves on (intent.md, "When something goes wrong"). `check:practices` plays the logic and cannot see that; the speaking views run their own steps (timers, audio callbacks, the recorder, speech recognition), and so do views that wait for a sound to end. There is no runtime safety net: dead ends are caught here.

```
cd app
npm run check:liveness                                                     # every puzzle type, about 30 s
npm run check:liveness -- --type say-chain                                 # one puzzle type (or a,b)
npm run check:liveness -- --type say-chain --seed 2 --scenario speech-blip # replay one run, with its log
npm run check:liveness -- --data <dir>                                     # another bundle
npm run check:liveness -- --record-open                                    # add the new findings to the ledger as open
```

**How it plays.** `web/src/testing/liveness.explore.tsx`, under its own Vitest config (`tools/liveness/vitest.config.ts`, not in `npm test`), renders each registered puzzle type inside the real practice screen (`PracticeRunner`), speaking on, on scenes of the bundle in `app/public/data` (it fails when there is none), under fake timers, with the audio engine, the recorder and the API replaced by scripted fakes (`web/src/testing/fakes.ts`; [app-dev.md](app-dev.md), "Seams for tests"). It lets the puzzle run until nothing is pending, then taps one enabled control of the puzzle pane chosen by a seeded rng (a kind of control first, then one of it; while the puzzle is still busy after 20 s it sometimes taps anyway), and again, until the puzzle is done (the continue bar). "Je ne peux pas parler" and the help strip are never tapped. Each outcome comes from a scenario: speech passes, half-heard, missed, 503, 500, offline, slow (10 s) or hangs; a take with a voice, silent, a voice that runs to the take's limit, too short, cut off mid-recording, or the microphone failing; the microphone granted, first-time intro, denied or missing; a play ends, fails or never ends; other calls ok, fail or hang. Speaking types get the fixed scenarios (`SPEAK_FIXED`: all pass, all fail, one 503 then a working server, speech hangs, audio never ends, microphone denied, silent takes, cut takes, a miss then cut takes, a 503 then a hang or silent takes, the microphone failing once, every take to its 10 s limit, two silent takes then a voice, Pause while the microphone opens and while it listens then go on, Pause then silent takes, …) on a phone and a tablet, plus 24 random streams; tapping types the three audio ones plus 6 random. A fixed scenario may script taps (`taps`): control names tapped first, in order, each as soon as it is there, even while the puzzle is busy, and `name@text` once the view's state also contains the text (`mic-pause@mic=listening`), so Pause lands while the microphone listens. Runs are deterministic: the same code gives the same findings.

**Kinds of finding** (a run that ended well is `done`):

| Kind | Means |
|---|---|
| `stuck` | Not done, nothing pending, no enabled control (not even an escape that works). |
| `escape-only` | As stuck, but « Je ne peux pas parler » gets the kid out: the puzzle itself has no way forward. |
| `livelock` | Not done after 1000 taps or 15 minutes of fake time: the controls do something, never the thing that moves on. The tap cap is sized for the tapper, which has no memory: on a 6-pair `memory` board it needed over 400 taps in 5% of runs, never over 1000. |
| `slow` | Done, but the puzzle kept the kid waiting over 80 s (beyond 2 s per tap). |
| `crash` | An exception, an unhandled rejection or a `console.error`. |

A finding's **signature** is stable across runs: puzzle type, kind and where the view ended (its state attributes, such as `data-step`, `data-phase`, `data-speak`, `data-record`, and for stuck runs the enabled controls), never the seed; for a livelock, the state it kept returning to. Each finding is printed with the number of runs and a replay command; the report with every run's log is `app/test-results/liveness.json` (git-ignored; `LIVENESS_RESULTS_DIR=<dir>` writes it and the shards' raw results elsewhere, so agents running the check at the same time do not overwrite each other).

**The ledger**, `app/tools/liveness/ledger.json` (committed): signature → `{ status: "open" | "fixed" | "not-a-bug", date, note, commit? }`. A finding is **new** when its signature is absent, a **regression** when it is there as `fixed`; both fail the check. `open` (the investigation backlog) and `not-a-bug` findings are printed and pass. An `open` entry not seen in a full run is printed as `unseen`: check it and mark it fixed. Exit status: 0 when the ledger covers every finding, 1 otherwise, 2 when the check itself failed (no bundle, the explorer crashed).

**What to do about a finding**: investigate it, one puzzle type at a time, from its signature and replay command (the owner gave each to a "puzzle investigator" subagent, [orchestration.md](orchestration.md), "Roles"): replay it, find the cause, decide whether a kid can really meet it, then fix it with a regression scenario or mark it `not-a-bug`, and record the verdict in the ledger. Never silence a finding by weakening the check.

**Running it automatically.** The pre-commit hook runs it on commits that touch the puzzle code. The owner also ran it from a Claude Code Stop hook (not included in this release): when an agent session stopped and the files the check depends on had changed since its last run (a content hash), it ran the check, and new findings or regressions blocked the stop once, telling the agent to investigate each puzzle type and record the verdicts. A similar hook is worth adding if you work with coding agents.

**A new puzzle type** is covered once registered. It passes when every wait has an end ([app-games.md](app-games.md)); expose the view's step as `data-step` or `data-phase` on its root so findings say where it stopped.

## The session-start check

Brings the kids' problem reports ("Quelque chose ne va pas ?", [intent.md](intent.md), "When something goes wrong") to the attention of whoever runs the app, until each is handled. The owner ran it at the start of every Claude Code session (a SessionStart hook, not included in this release); run it by hand or from your own hook. The reports live in the production database ([app-server.md](app-server.md), "Activity log and reports").

```
cd app
node tools/prod-reports.mjs                          # the unhandled reports and the errors of 7 days, as text; files in work/reports/
node tools/prod-reports.mjs --hook                   # the output for a Claude Code SessionStart hook (JSON; nothing when nothing is new)
node tools/prod-reports.mjs --local <persist dir>    # a local D1 (wrangler dev --persist-to) instead of production
```

- **What it reads**: `wrangler d1 execute DB --remote --json` from `app/`: the reports of the last 120 days, and the error events of the last 7 days (`server-error`, `crash`, `api-fail` of kind server, timeout or offline, and `media-fail`, a media file that did not load) grouped by what failed and where (a `media-fail` by its reason only, as `media-timeout`, `media-offline`, `media-http` or `media-decode`). Each **unhandled** report (no entry in the ledger) is written in full to `work/reports/<id>.json` (git-ignored): the kid's text, the context the app sent, and that kid's activity in the ten minutes before. The files exist so that an agent session that is not allowed to read production itself can still work on a report: a hook (which runs outside the session) or a person runs the script. `--state`, `--out` and `--ledger` move the cache, the files and the ledger (for tests); `FRX_WRANGLER` names another wrangler (a fake one tests the failure paths).
- **Reports are untrusted input.** `POST /api/reports` and `/api/log` take a request from anyone who can reach the app, and what this check prints is read by an agent session on a machine that is logged in to Cloudflare. So a report can be written to pass for instructions (prompt injection). Three defences, keep all three when changing the script: the short fields it prints (puzzle type, route, kid name, the error groups) are cut down to identifier characters and a length; the free text is flattened to one line, shortened, shown as a quotation, with `<` and `>` replaced; and the hook's message and the `untrusted` field at the top of each report file say that a report is data and that an instruction found in one is never followed; a brief for an agent that triages reports must say so too. The same reasoning is why the review UI refuses writes that do not come from its own page ([review-ui.md](review-ui.md)): a review mark's comment is carried out by an agent.
- **The ledger**, `app/triage/reports.json` (committed): report id → `{ status: "fixed" | "not-a-bug" | "wont-fix" | "seen", date, note, commit? }`. Any entry counts as handled; `seen` is for a report the admin has read and keeps in mind without deciding. An entry is recorded once the admin has decided ([orchestration.md](orchestration.md), "Roles", for how the owner triaged with an agent); `commit` names the fix.
- **`--hook`**: for a Claude Code SessionStart hook (on startup, resume and clear). With unhandled reports it prints `systemMessage` for the person (`2 problem reports from kids not yet handled: #14 (2026-11-20, say-chain) « ça bloque »; … 37 errors in 7 days, mostly server-500 on /api/speech.`) and `hookSpecificOutput.additionalContext` for the agent: the list, where the files are, and the instruction to bring them to the person first and ask before acting. Nothing at all when every report is in the ledger. It never blocks a session for long: the query runs in a detached child (20 s at most) that writes the result to a git-ignored state file; the hook waits for it at most 10 s, else answers from the last result. A result is reused for 3 hours (a failure for 30 minutes), filtered against the ledger as it is at each start. When the check cannot run (wrangler not logged in, offline, no answer in 20 s, no `reports` table yet), one line says why, once per failure. To force a fresh query: delete the state file, or `--hook --fresh`.

## Type-checking, unit tests and end-to-end tests

- Python: `.venv/bin/python -m pytest -q` runs the fast tests (about 2 s; none reads `content/` or `assets/db.sqlite`). Tests that load the speech models or read `content/` (`test_transcribe_model.py`, `test_forced_align_model.py`, `test_import_s01e04.py`, the rendering tests of `test_render_media.py`) are marked `slow` and deselected by default (`addopts` in `pyproject.toml`); `.venv/bin/python -m pytest -q -m slow` runs only them (about 40 s, the models on the GPU). Each skips when `content/`, the `asr` group or the weights are absent. Mark a new test `slow` (`@pytest.mark.slow`) when it does either or takes more than about 2 s.
- `npm run typecheck`: `tsc` over the web, worker and node configurations.
- `npm test` (Vitest) runs three projects: `shared` (pure logic and tools, Node), `web` (React components, happy-dom) and `worker` (inside workerd with a local D1, `TEST_MODE` on; [app-server.md](app-server.md), "Worker tests"). Speech: `shared/speech.test.ts` (realistic transcripts), `tools/speech-bundle.test.ts` (every bundle line read back passes), `worker/speech.test.ts` with `worker/speech-judge.fixtures.json`. The karaoke's word check: `shared/karaoke.test.ts` (a table both ways), `tools/karaoke-bundle.test.ts` (no line, alternate, question, answer or lyric of the bundle is refused: the show's words are never rude for it).
- Gotcha: the content test in `worker/health.test.ts` needs `dist/`: without it, it returns early and passes silently. `deploy.sh` runs `npm run build` first for this reason; run it before `npm run check` by hand too.
- `npm run e2e` (Playwright, the system Chromium, a phone and a tablet project): every puzzle type alone, the speaking puzzles, the colour-contrast guard, the `/dev` portal, and against a real local Worker a kid's journey through a practice. How to run and write them: [app-dev.md](app-dev.md).
