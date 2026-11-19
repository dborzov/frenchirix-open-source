# Runbook: processing an episode and repairing scenes

The pipeline steps in order and who does each, how to repair a scene, and what changes for another show or your own video sources. Read before processing an episode, re-running a step, repairing a scene, or adapting the pipeline to another show. Each command's rules are in the doc linked from its step; this file holds the order.

The project was built on season 1 of one show (five episodes, 203 scenes). A fresh clone has no episodes and no database: `content/` holds your own source files, and `frenchirix import` creates `assets/db.sqlite` from them.

**Who does the content steps.** A few steps need judgement about the show's language (choosing scenes, annotation, notes, review fixes, and the app's own French). The owner ran them with LLM subagents whose prompt files are not included in this repository; you supply your own, any capable LLM or a person. What each of those steps is given, the exact file it must write and the rules of good output are in [content-steps.md](content-steps.md). Every other step is code.

## Contents

- **Rules for every run**: how to run commands, the GPU, downloads, and what follows any data change.
- **Repairing a scene**: re-align a line (windowed, then `--confirm`), correct a text or a note, re-render.
- **Fixing review marks**: the lines marked in the review UI, and who fixes them.
- **The steps for a new episode**: the table to follow, in order.
- **Order rules**: sequences that go wrong when changed.
- **Selecting scenes**: the cue sheet, the selection and checking it.
- **Annotating**: the pilot sheet, the annotators, loading and fixing names.
- **What to check after each step**: where a problem is cheap to catch.
- **Another show or your own video sources**: what the pipeline assumes about a source, and what is specific to this show.

## Rules for every run

- Run commands as `.venv/bin/frenchirix …` or `uv run --no-sync frenchirix …`. Never a plain `uv sync`: it removes the speech packages of the optional `asr` group ([transcription.md](transcription.md)).
- The speech models are downloaded once into your model cache and then used offline ([transcription.md](transcription.md), "Weights"). Check the cache before downloading anything again.
- One GPU job at a time (`transcribe`, `align`): each checks free GPU memory before loading its model and falls back to the CPU.
- `align` has no dry run and no `--db`: copy `assets/db.sqlite` (or commit it in your own repository) before a re-align, so a worse result can be undone by restoring the file.
- **After any data change**, in this order:
  1. `.venv/bin/frenchirix check`: errors must be fixed; warnings are the review list ([checks.md](checks.md)).
  2. `.venv/bin/frenchirix export-app`: rebuilds the app's JSON and the media whose window changed, then verifies the bundle ([app-export.md](app-export.md)).
  3. In `app/`: `npm run check:practices`, so every practice still composes and can be passed ([checks.md](checks.md)).

  The pre-commit hook repeats steps 1 and 3 when `assets/db.sqlite` is staged (in a repository where you choose to commit it; [checks.md](checks.md), "The pre-commit hook").

## Repairing a scene

Repairs come from review marks ("Fixing review marks" below), from `check` warnings, and from `export-app --verbose`, which lists every line whose word times the export had to replace. Fixing a text or a note is content work ([content-steps.md](content-steps.md), "Fixing review marks"), which can run the text steps below itself; GPU steps (`align`) and voice clips are run separately. End every repair with "After any data change".

**A unit loops the wrong sound** (the line's word times are off; `check` reports `timing.unreliable`, or the export marks the line approximate):

1. Re-align the line in a narrow window, so it cannot slide to a repeat of its own words: `.venv/bin/frenchirix align <ep> --lines 24 --slack-ms 300` (`--lines` takes ranges and commas, `19-26`, `20,24`; other lines keep their times). In season 1, 300 ms rescued most lines, 600 ms one more, 1000 ms none.
2. If the guard still finds no acoustic evidence (usual under music), repeat with `--confirm`: the low-scoring placement is kept when Whisper, prompted with the line's text, hears the same words at the same times ([transcription.md](transcription.md), "Confirming with the recogniser").
3. Check before keeping it: the words are in order, inside the line's window, each 20 to 1500 ms long; `check` no longer reports the line; `export-app --verbose` no longer lists it; its units sound right in the review UI. Otherwise restore the copy of the database you made before.
4. `.venv/bin/frenchirix retime <ep> --render`: widens a scene's core if the speech now starts earlier or ends later, and re-renders those scenes.

**The French, the literal English, a unit or a note is wrong**: fix the record in `annotations/<ep>/NN.jsonl` (find the file with `grep -l '"line": 24,' annotations/<ep>/*.jsonl`; a unit's note is in its line's record, a scene's notes in the scene object after its last line). Never edit `cues`. Then:

1. `.venv/bin/frenchirix annotate-import <ep>`. A line whose French is unchanged keeps its word timings; a line whose French changed loses them.
2. If the French changed: `.venv/bin/frenchirix align <ep>` (it times only lines without timings), then `retime <ep> --render`.
3. If the line has questions or line alternates (`app/data/questions/`, `app/data/alternates/`), make sure they still fit and regenerate changed voice clips ([app-content.md](app-content.md), [app-tts.md](app-tts.md)).

The English the app shows is the literal English (`lines.en_literal`). The subtitle English is only its fallback and what the content sheets show; a wrong one is fixed in `corrections/<ep>.json`, then `import <ep>` ([pipeline.md](pipeline.md), "Translation corrections").

**A clip is cut wrong or its media are missing**: `.venv/bin/frenchirix render --scene <id> --force` remakes the review UI's files; `export-app --scenes <id> --force` remakes the app's. Both cut from `content/`.

## Fixing review marks

The reviewer marks lines in the review UI ([review-ui.md](review-ui.md), "Review marks"); a fixer (an LLM or a person) carries them out, following [content-steps.md](content-steps.md), "Fixing review marks".

1. `.venv/bin/frenchirix review list` shows the open marks; `review context <id>` prints everything a fixer needs for one.
2. **Timing marks are not text fixes**: re-align as in "A unit loops the wrong sound" above (copy the database first), then `review resolve <id> --status done --resolution "…"`.
3. Give every other open mark to a fixer, naming the mark ids; with many marks, one fixer per episode, **one after another**: fixers in parallel would run `annotate-import`, `check` and `export-app` over each other. A brief for an LLM fixer carries the faithful-content rule ([content-steps.md](content-steps.md), "Rules for every content step").
4. Read the fixer's report. Lines whose French changed need `align <ep>` (it times only untimed lines), then `retime <ep> --render`; revised questions, answers and alternates need their voice clips ([app-tts.md](app-tts.md)). Sample a fix or two in the review UI, where each resolved mark shows what was done.
5. `review list` again: what is still open was left with a reason in the report; those need the reviewer's decision.
6. "After any data change", then keep `assets/db.sqlite`, `annotations/`, `corrections/` and `app/data/` together (commit them in your own repository, or back them up).

## The steps for a new episode

Commands are `frenchirix` subcommands, run as above. The content steps (3, 8 and the review's fixes) are done by an LLM or a person ([content-steps.md](content-steps.md)); everything else is code. Steps 5 and 6 do not depend on each other.

| # | Step | Who | Command | Produces |
|---|---|---|---|---|
| 1 | Import subtitles | code | `import <ep>` ([pipeline.md](pipeline.md)) | `cues`, `lines`, `translations` |
| 2 | Cue sheet | code | `sheet <ep>` | `work/<ep>/sheet.txt` |
| 3 | Select scenes | content step, one selector per episode | "Selecting scenes" below | `selections/<ep>.json` |
| 4 | Load the selection | code | `select-import <ep>` | `scenes` |
| 5 | Render media | code | `render --episode <ep>` ([media.md](media.md)) | `assets/audio/`, `assets/video/` |
| 6 | Recognise speech | code, GPU | `transcribe <ep>` ([transcription.md](transcription.md)) | `asr_words` |
| 7 | Annotation sheets | code | `annotate-sheet <ep>` | `work/<ep>/annotate-NN.txt` |
| 8 | Annotate | content step, one annotator per sheet | "Annotating" below | `annotations/<ep>/NN.jsonl` |
| 9 | Load annotations | code | `annotate-import <ep>`, then fix English names | final French, literal English, `words`, `units`, `notes` |
| 10 | Align to the audio | code, GPU | `align <ep>` | word timings, line audio times |
| 11 | Rescue misplaced lines | code, GPU | `align <ep> --lines … --slack-ms 300 [--confirm]` ("Repairing a scene") | better word timings |
| 12 | Retime and re-render | code | `retime <ep> --render` | wider scene cores, new media |
| 13 | Check and export | code | "After any data change" above | the app bundle |
| 14 | Review | a person | the review UI ([review-ui.md](review-ui.md)) | review marks: lines to fix ("Fixing review marks") |
| 15 | Keep | you | the database, `selections/`, `annotations/`, `corrections/`, `app/data/`: commit or back up | |

Putting new scenes into the app (questions, line alternates, voice clips, `app/data/release.json`) is app content: [app-content.md](app-content.md).

## Order rules

- **`retime` after `align`, and again after any `select-import` of an aligned episode**, which writes subtitle times back into the scene cores ([pipeline.md](pipeline.md#retiming-scenes)).
- **`render` after anything that moves a clip window.** `retime --render` does it itself. A scene with `render_params` NULL is waiting for it.
- **`annotate-import` only when every annotator has finished**: it reads every file in the directory. Re-running it is safe: a line whose final French is unchanged keeps its word timings.
- **`import` again is safe** when nothing changed, and refuses when it would alter a line that scenes or annotations depend on ([pipeline.md](pipeline.md), "Ids and re-import").
- **Media formats are settings.** Change them in `frenchirix/render.py`, re-render with `--force`, and test in a real browser window before trusting them ([media.md](media.md), "Why 8-bit").

## Selecting scenes

1. `.venv/bin/frenchirix sheet <ep>` writes the cue sheet, `work/<ep>/sheet.txt`.
2. One selector per episode writes `selections/<ep>.json` from it: the input, the format and what a good scene is are in [content-steps.md](content-steps.md), "Selecting scenes". The brief names the episode, the sheet, the output and the number of scenes (about 40 per episode in season 1).
3. `select-import <ep>` validates and loads the file ([pipeline.md](pipeline.md), "Loading a selection").
4. Check the spread of scores and of scenes over the episode, and sample a few scenes in the review UI. A selector left to itself uses mostly scores 3 to 5.

## Annotating

1. `.venv/bin/frenchirix annotate-sheet <ep>` (refuses until `transcribe` has run) writes about one sheet per twelve scenes; scenes that share a line go on the same sheet.
2. **Pilot first.** Annotate sheet 01 alone and read a few of its lines, units and notes; tighten the brief if a rule is missing and have the pilot revise (in season 1 the pilot exposed three gaps in the unit rules). Then do the other sheets, in parallel if you use LLMs, one annotator per sheet; the brief names the sheet and the output file. The format and rules: [content-steps.md](content-steps.md), "Annotating".
3. Each annotator runs `scripts/check_annotation.py` on its file before handing it in.
4. When every file is complete: `annotate-import <ep>`, and read its warnings ([pipeline.md](pipeline.md), "Annotation import").
5. `.venv/bin/python scripts/fix_english_names.py <ep>` runs the import itself, puts the French names back into the flagged `en` texts and unit glosses, and asks for `annotate-import <ep>` again.
6. Collect the readings the annotators could not settle in one file (season 1 used `annotations/uncertain.md`): the lines to check by ear first.
7. Recurring things get one agreed wording, in every scene that names them; keep those wordings in a file the annotators share. Season 1 did this as a separate notes pass afterwards; for a new episode the annotator does it while annotating, and a notes pass ([content-steps.md](content-steps.md), "The notes pass") is only worth it when the sample shows gaps.

## What to check after each step

- **`import`**: the stats line. Lines without English should be a few percent (12 to 29 per episode in season 1); a jump means the stream layout or the timing is not what the importer expects.
- **`transcribe`**: recognition should hear more words than the subtitles show (15 to 35% more in season 1).
- **`align` and step 11**: the `timing.unreliable` lines in `check`, and the suspect lines in `export-app --verbose`.
- **`retime`**: the `timing.fade` warnings, scenes whose first or last line still reaches into a fade.
- **`check`**: every error. Warnings are the review list.

## Another show or your own video sources

The pipeline is not tied to this show; what it assumes is listed here. Nothing below is needed to run the app on a bundle you already have.

- **What a source needs**: one Matroska (`.mkv`) file per episode with one French audio stream in 5.1 and three SubRip subtitle tracks: plain French, French for the hearing impaired (SDH), and English translating the French subtitles, all tagged by language ([pipeline.md](pipeline.md), "Stream choice"). Without an SDH track there are no speaker labels, song flags or sound descriptions; without English, lines have no fallback translation (annotation writes the literal English anyway). The importer stops and names a missing or ambiguous track; adapting it to another layout is a change in `frenchirix/importer.py`.
- **Episode ids** are `sSSeEE` (`s01e04`); every file and id derives from them ([data-model.md](data-model.md), "Ids").
- **Where the source file comes from**: by default the one `.mkv` file in `content/` whose name contains the episode as `SxxEyy`, in any case (`My.Show.S01E04.mkv` for `s01e04`; `source_path` in `frenchirix/importer.py`); none or several is an error that names them. `import <ep> --file <path>` names any file.
- **The show's title** recorded in the database is given once, `import <ep> --show "<title>"`; later imports reuse the title already in the database.
- **Stream choice** picks streams by language and title tag; this show's release had several English tracks, and the untitled one was the translation of the French subtitles. Find out which English track translates the French subtitles before importing.
- **Write the show's context file first**: [show-context.md](show-context.md) is the worked example for this show (what the show is, plot, episodes, the character table with French and English names, running jokes, how characters speak), grounded in the subtitle files, not the web. Code reads it at a fixed path, `docs/show-context.md`: `annotate-import` and `scripts/fix_english_names.py` take the English subtitle renames from its table (French name in the first column, the English subtitle name in the second, `same` when it does not change), so replace this show's file with yours, keep that table format, and add no other table. Every content brief points to it.
- **The content briefs** ([content-steps.md](content-steps.md)) are written for any show; the examples of notes (toga, legion, menhir) are this show's, so give your writers examples from yours.
- **Dialogue in the centre channel** was measured for this show's 5.1 mix and is what makes recognition clean ([transcription.md](transcription.md), "What the models hear"). Measure it again for your source; `import` refuses a French audio stream that is not 5.1, because the speech steps take the centre channel and `render` downmixes from the 5.1 channels; a stereo source needs another `CHANNEL_FILTER` in `frenchirix/asr_audio.py`, another downmix in `frenchirix/render.py`, and that check in the importer relaxed.
- **Language**: the pipeline and the app teach French to English speakers. The speech models are run in French, the sheets and the rules assume French and English, and the app's interface is in English and French.
- **Start with one episode and one sheet**: every stage of season 1 was set up on one episode before the others ran.
