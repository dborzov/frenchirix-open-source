# Data model of assets/db.sqlite

What the tables of `assets/db.sqlite` mean, how ids and times work, and the schema versions. Read before changing the schema or querying the database. The database is not in this repository: `frenchirix import` creates it from your own episodes ([runbook.md](runbook.md)). The columns are in [`frenchirix/schema.sql`](../frenchirix/schema.sql) and are not repeated here.

## Rules that everything depends on

- **One time base.** Every `*_ms` column is integer milliseconds on the timeline of the source episode file. The one exception is `scenes.frame_times_ms`, the clip-relative time each slideshow frame appears. A position inside a scene's audio or video file is `t - scenes.clip_start_ms`; the audio and the video both start exactly at `clip_start_ms` and end at `clip_end_ms`. (The app's exported bundle uses milliseconds from the start of each scene's audio file instead: [app-export.md](app-export.md).)
- **Imported data is immutable.** `cues` and `asr_words` hold what the source file and the recogniser produced and are never edited. Translation corrections live in `corrections/<episode>.json` and are applied to `translations` at import, marked `source = 'correction'` ([pipeline.md](pipeline.md)). Everything else that improves on the sources goes in other columns or tables.
- **Ids are assigned once and never reused.** Line numbers come from the order of cues in the plain French track, so re-importing an episode reproduces them. Review mark ids are `AUTOINCREMENT`, so a deleted mark's id is not given to the next one.
- **Timings live only on `words`.** Units and lines derive theirs, so re-aligning the audio never requires re-annotating.
- **One definition of a word**: `split_words` in `frenchirix/text.py`. Nothing else may split text into words.

## Ids

| Thing | Format | Example |
|---|---|---|
| Episode | `sSSeEE` | `s01e04` |
| Line | episode + 4-digit line number | `s01e04-0041` |
| Scene | episode + first and last line number | `s01e04-0041-0058` |

A scene id names its media files, `assets/audio/<scene id>.opus` and `assets/video/<scene id>.mp4`. A scene is defined by its line range, so refining its times does not change its id.

## Tables

- **`meta`**: `schema_version`, and the record of each run: `asr:<episode>` (model, options, dropped segments) and `align:<episode>` (settings, `guard` outcomes, and `line_runs` for every `--lines` run with its `--confirm` verdicts).
- **`episodes`**: one row per source file, with the stream facts the pipeline needs.
- **`cues`**: raw subtitle cues from three tracks: plain French (`fr`), French for the hearing impaired (`fr_sdh`), and the English translation of the French subtitles (`en`).
- **`lines`**: the unit of dialogue, one row per cue of the plain French track, with cleaned text (`fr`), the speaker where the SDH track gives one, and the song flag. `start_ms`/`end_ms` are the subtitle's on-screen times.
- **`translations`**: English text per translation group, the smallest run of consecutive lines whose translation cannot be split; most groups are one line. A scene must not split a group.
- **`scenes`**: a contiguous range of lines, with the selector's title, kind, tags, score and reason, and the facts of its rendered media (`clip_*`, fades, files, `frame_times_ms`, measured loudness, `render_params`). Scenes may overlap. `core_start_ms`/`core_end_ms` start as the subtitle times of the first and last line; `retime` widens them to the aligned speech ([pipeline.md](pipeline.md#retiming-scenes)). Every scene counts as accepted: the retired keep/reject curation and its columns `status` and `note` were dropped in schema 6.
- **`scene_lines`** (view): the lines of each scene with their offsets inside its media.

A scene's text is not copied into `scenes`: it is the text of its lines, and its translation the text of their groups.

## True text, words, units and notes

How the data gets there: [runbook.md](runbook.md) (annotation) and [transcription.md](transcription.md) (recognition and alignment).

- **`asr_words`**: the recogniser's output for an episode, one row per word with its time and probability. Apart from a few mechanical clean-ups recorded in `meta` ([transcription.md](transcription.md)) it is the model's output.
- **`lines.fr_final`**: what is actually said, reconciled from the subtitle (`lines.fr`, which stays) and recognition. **`lines.en_literal`**: a literal English translation of `fr_final` that keeps the French proper names. Both are NULL for lines in no scene; anything displaying a line falls back to `fr` and the subtitle translation.
- **`lines.audio_start_ms`, `audio_end_ms`**: where the line is spoken, from its first and last aligned word.
- **`words`**: the words of `fr_final`, in order, each with its character span in the text and, once aligned, its episode time and alignment `score` (0 to 1). A NULL score with a time is an unspellable word ("49.3"); `score = 0.0` on every word of a line means the guard found no acoustic evidence and the times are a guess ([transcription.md](transcription.md#the-guard-a-line-stays-near-its-subtitle)).
- **`units`**: the breakdown of a line into runs of consecutive words, each a `word` or an `expression`, with a literal gloss (`en`) and an optional `note`. The units of a line cover all its words without overlap. A unit never crosses a line, so an expression split over two subtitle cues is two units.
- **`unit_times`** (view): each unit with its time span, set only when every word is timed; `untimed_words` and `unscored_words` count the exceptions. Nothing reads it at present; the review UI and the export compute the same from `words`.
- **`notes`**: what a ten-year-old needs explained to follow a scene: a cultural `reference` or a `wordplay`. Each row belongs to a scene; where it explains a particular phrase it also names the phrase, its line and its span of `words`, so it has a place in the text and, through the words, in the audio. Notes belong to scenes rather than lines because the joke is the scene's.

## Review marks

- **`review_marks`**: a line, or one unit of it, that the user marked in the review UI as needing a fix ([review-ui.md](review-ui.md), "Review marks"). `scene_id` is the scene it was marked in and `line_id` a line of that scene; `unit_idx` (`units.idx` in the line) and `unit_text` (that unit's text when marked) are both set for a unit or both NULL for the whole line. `category` is `translation`, `french`, `units`, `timing`, `notes` or `other`; `comment` is the user's text (`''` when none). `status` is `open` until `frenchirix review resolve` sets `done` or `dismissed` with `resolved_at` and `resolution`, what the fixer did or why the mark was dropped.
- The mark points at a line, not at a word or a time: re-annotating the line rebuilds its units, so `unit_idx` may then name another unit; `unit_text` keeps what the user saw. Resolved marks are kept as the record of what was fixed; only open ones can be edited or deleted.

## Schema versions

`meta.schema_version` holds the version; `SCHEMA_VERSION` in `frenchirix/db.py` is the current one. `frenchirix.db.connect` migrates an older file in place when it opens it, reusing the statements of `schema.sql` so a migrated database and a fresh one stay identical (a statement is cut at its first `;`, so a comment inside a CREATE statement must not contain one). Only the steps from versions 4 and 5 are kept (no older file exists); it refuses anything older. Tools that open the file with plain `sqlite3` never migrate it; `frenchirix serve` migrates once at start.

- 1: subtitles and scenes.
- 2: `asr_words`, `words`, `units`, the annotation and audio-time columns of `lines`.
- 3: the notes table (then named `explanations`).
- 4: `unit_times` counts untimed and unscored words instead of hiding them.
- 5: `explanations` renamed `notes`.
- 6: `review_marks`; `scenes.status` and `scenes.note`, the retired curation, dropped (`ALTER TABLE … DROP COLUMN`).
