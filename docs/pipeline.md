# Text pipeline: import, corrections, selections, annotations

How an episode's subtitles become `lines`, `translations` and `scenes`, how French lines are paired with English, how translation corrections, selections and annotations are loaded, and what a re-import keeps. Read before importing an episode, re-importing one that has scenes, correcting a translation, loading a selection or annotations, or changing how French lines are paired with English. The order of the steps is in [runbook.md](runbook.md); media are in [media.md](media.md).

## Contents

- **Rules that matter most**: what never changes and what refuses.
- **Stream choice**: which audio and subtitle tracks are used, and why English track 7.
- **Cleaning and the SDH track**: subtitle text, sung lines, speakers.
- **Pairing French lines with English**: how translation groups are built.
- **Translation corrections**: fixing a wrong or missing subtitle English.
- **Loading a selection**: what `select-import` checks and keeps.
- **Annotation import**: validation, notes, warnings, what a re-import keeps.
- **Retiming scenes**: widening a scene to the speech found at its edges.
- **Ids and re-import**: why ids are stable and when `import` refuses.

## Rules that matter most

- `cues` holds the subtitle text byte for byte and is never edited. Corrections go in `corrections/<episode>.json` (translations) or through annotation (everything else).
- Line ids come from the order of cues in the plain French track, so re-importing the same file reproduces them. Scenes and annotations hang on line ids, so `import` refuses any change that would move, retime or reword a line they depend on.
- `select-import` and `annotate-import` write nothing if any record is invalid, and print every error at once (file, line number, dialogue line or scene). Warnings never block.
- Every scene in `scenes` is rendered, annotated and exported: the keep/reject curation that once excluded some is gone (schema 6).

## Stream choice

Streams are picked by language and title tag, never by index: French audio is the audio stream tagged `fre`; plain French is the untitled `fre` SubRip stream; SDH is the `fre` stream whose title contains `SDH`; English is the untitled `eng` stream. If any of the four is missing or ambiguous, `import` stops and names it. In S01E01–05 these are streams 3, 11, 12 and 7.

**Why English track 7**: the untitled English track translates the French subtitles and follows their timing and meaning. The titled tracks ("British…") transcribe the English dub, which rewrites jokes freely, so they are a poor gloss of the French and are not imported.

Subtitles are copied out with `ffmpeg -c:s copy`, which keeps the cue text byte for byte; `cues.raw_text` is that text with line ends normalised to `\n`. The extracted tracks are left in `work/<episode>/subs/` for debugging; nothing reads them back.

## Cleaning and the SDH track

- `lines.fr`: tags removed (`<i>` marks both songs and off-screen voices, so it means nothing), wrapped lines joined, a line break kept only between two speakers' parts (`- text`).
- Sung lines (`is_song = 1`, from `♪` in the matching SDH cue) keep the breaks between lyric lines as `\n`, copied from the SDH cue when the plain cue puts a couplet on one line; so does the English of a group made only of sung lines.
- `speaker` comes from SDH labels (`[Métadata]`, `[X enfant]`, a few generic ones such as `speaker` for the announcer); other brackets (`[César soupire]`, `[zozote]`) are descriptions. It is stored only when one SDH cue matches the line and labels every part, so it is sparse by design. The rules are in `frenchirix/subtitles.py`.

## Pairing French lines with English

`frenchirix/subtitle_align.py` builds translation groups from time overlaps between French lines and English cues:

1. English title cards (six or more letters, no lowercase) and the "Subtitle translation by" credit are dropped first.
2. **Strong link**: a line and an English cue overlap for at least half of the shorter of the two. This survives a few hundred ms of drift and pairs one English cue with two French lines, or the reverse.
3. **Boundary borrow**: a line with no strong link takes the English cue it overlaps most, if that overlap is at least a quarter of the line.
4. Lines linked to a common English cue form one group, and every line between a group's first and last is pulled in, so groups are contiguous. Group text is its English cues in track order, joined with a space.
5. A line with no link gets its own group with `text = ''`. A line is never attached to an English cue it does not overlap. English cues that link to no line are dropped.

A scene must not split a group. The English track sometimes mistranslates or skips a line by itself; corrections fix that.

## Translation corrections

`corrections/<episode>.json` is applied by `import` after pairing. The directory does not exist until you write the first one; keep it with your database (it is source data, like the annotations):

```json
{"episode": "s01e04", "translations": [
  {"lang": "en", "first": 22, "last": 22, "text": "…", "reason": "…"}
]}
```

- An entry replaces the text of the group whose range is exactly `first`..`last` and sets its `source` to `correction`. If no group has exactly that range (after a pairing change regrouped the lines), `import` fails, names the entry and writes nothing.
- A missing file means no corrections. `reason` is for people and is not stored. Keep `\n` between lyric lines in songs.
- Use it for gaps and errors that matter, not to polish acceptable translations. The app shows the literal English from annotation; the subtitle English is its fallback and what the content sheets show.

## Loading a selection

`select-import <episode> [path]` reads `selections/<episode>.json` (the format and what it validates: [content-steps.md](content-steps.md), "Selecting scenes").

- Warnings: a range widened to a translation group boundary, a scene over 12 lines or 40 s, a title over 6 words, a duplicate range (the earlier one is kept).
- It upserts by scene id: an existing scene gets the selector's fields (range, core times, title, kind, tags, score, why, `selected_by`) and keeps `created_at` and every render column. Scenes in the database but absent from the file are listed and left alone.
- It writes subtitle times into `core_start_ms`/`core_end_ms`, so run `retime` again on an aligned episode.

## Annotation import

`annotate-import <episode>` reads every `annotations/<episode>/*.jsonl` (`--dir` for another place; the format: [content-steps.md](content-steps.md), "Annotating"). `annotate-sheet` refuses to run before `transcribe`, and deletes old sheets first so a stale one cannot be handed out.

- Validation covers every line object (units must contain the words of `fr` exactly once, by `split_words`; the first word where they part is reported) and every scene object (a scene of the episode, given once, notes of kind `reference` or `wordplay` with a text, `line` and `phrase` together and inside the scene).
- **Locating a phrase**: a note's `phrase` is looked for as a run of words in the line's final French, ignoring case, accents and punctuation. When not found, the note is written with a NULL span and a warning.
- **Notes are replaced per scene**: every scene with a scene object in the files loses its notes and gets the ones in the files, so an empty list clears it. Scenes without a scene object keep theirs. When a line's words are rebuilt, the notes on it from other scenes are located again in the new French.
- **What a re-import keeps**: units are always replaced. A line whose `fr_final` is the same string as stored keeps its `words`, their timings and its audio times; otherwise its words are rebuilt untimed, so `align` must run again. Lines not in the files are left as they are.
- `annotated_by` is not in the files: it is `--by` (default `sonnet:annotate-v1`, the label of the owner's runs; pass your own).
- **Warnings**: scene lines without annotation; a line where at least two words, and more than a quarter of them, appear neither in the subtitle nor in the recognised words within 1.5 s (a sign of invented text); a scene with annotated lines but no scene object; an unlocated phrase; an `en` that uses an English subtitle name (Vitalstatistix, Caesar) where `fr` has the French one. The names come from the character table of [show-context.md](show-context.md); `scripts/fix_english_names.py` fixes them.

## Retiming scenes

Scene cores start as subtitle times. Annotation restores words spoken just before a subtitle appears or after it goes, and alignment finds them up to about 2 s outside it, inside the clip's fade. `frenchirix retime <episode>` (`frenchirix/retime.py`, settings `RetimeSettings`) widens each core to cover them:

- `core_start_ms` becomes the earlier of the first line's subtitle start and where its speech starts; `core_end_ms` the later of the last line's subtitle end and where its speech ends. A core is never narrower than its subtitles.
- Only trusted alignment counts: every word of the line timed and a mean score of at least 0.5; the edge is the first (last) word scoring at least 0.3. Lines the guard marked unreliable never count.
- An edge moves only when the speech reaches 200 ms or more past the subtitle, and never more than 2.5 s.
- The core is recomputed from subtitle times on every run, so running it twice changes nothing.
- A scene whose clip no longer matches its core gets `render_params = NULL`; `render --episode` re-renders exactly those, or `retime --render` does it at once.

## Ids and re-import

Line `idx` is the cue's position in the plain French track (file order, not the counter written in the SRT). `import` warns if that track is not in time order. A re-import compares everything it would write with what is stored:

- **Identical** (the `episodes` row included): nothing is written, so the database file does not change.
- **Different, no scenes**: cues and translations are rewritten and lines updated in place by id in one transaction, which keeps their annotation, audio times, `words` and `units` attached.
- **Different, with scenes, and line ids, times or French text would change**: `import` refuses and writes nothing, because scenes are defined by line numbers. A whitespace-only change to the French is allowed. Delete the episode's scenes by hand if the change is intended.
- **Different, with scenes, lines unchanged** (only speakers, song flags, translations or groups): the rewrite goes ahead and lists any scene that now splits a translation group.
- In every case a line carrying annotation must keep its id and its subtitle text up to whitespace, or `import` refuses and names the lines. A changed correction touches only `translations`.
