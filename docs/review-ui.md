# Review UI

The local tool where a person reviews scenes (`frenchirix serve`: `frenchirix/server.py` and `web/`): starting it, what it shows, review marks and the `frenchirix review` command, its API, how audio and video stay in sync, the shortcuts and the gotchas. Read before changing the review UI or its API, or working with review marks.

Its purpose is human review: the reviewer goes through scenes one by one and marks lines, or one unit of a line, that need fixing, with a comment, for a fixer (an LLM agent or a person) to carry out later ([intent.md](intent.md), "The review UI"). Each such mark is a **review mark**; how marks are fixed: [runbook.md](runbook.md), "Fixing review marks", and [content-steps.md](content-steps.md), "Fixing review marks". Keep/reject curation is retired and gone from the code and the database (schema 6): every scene counts as accepted.

## Contents

- **Starting it**: the command, which database it writes, missing media.
- **What it shows**: the timeline, the scene list, the scene view and its timing flags.
- **Review marks**: marking a line or a unit, the open-marks list, `frenchirix review` (list, context, resolve).
- **API**: the endpoints, times, units, notes and marks in the scene payload.
- **How audio and video stay in sync**: audio as the clock, drift correction, throttled frames.
- **Keyboard shortcuts**.
- **Gotchas**: black video, headless testing, migrations, tests.

## Starting it

```
.venv/bin/frenchirix serve                                   # http://127.0.0.1:8765/, assets/db.sqlite
.venv/bin/frenchirix serve --port 9000 --db work/review.sqlite
```

- Bound to 127.0.0.1, no authentication: a single-user tool. Writes (the review marks) are accepted only from the UI's own page: a request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, or whose `Origin` is another site, gets 403. Without it any web page open in the same browser could create marks, and a mark's comment is an instruction to whoever fixes it, possibly an agent. Python standard library only; the front end is plain HTML, CSS and JavaScript in `web/`, with no build step and no network dependency.
- **Writes go straight into the database it serves**, by default `assets/db.sqlite`. The only writes are review marks. To experiment, copy it into `work/` and pass `--db`, which must name an existing file. `--db` changes only the database: media always come from the repository's `assets/audio/` and `assets/video/`.
- On start, `serve` migrates an older database file to the current schema (review marks need version 6); the request handlers never do.
- Media are git-ignored, so in a fresh clone the database says "rendered" and the files are absent; the UI shows "media files missing". `frenchirix render` rebuilds them from `content/`.

## What it shows

- **Episode timeline**: scenes drawn over their core span, overlapping ones on extra lanes; colour is kind, bar height is score; a dot above a scene means it has open review marks. It ends 15 s after the last subtitle line (`STORY_TAIL_MS`), so the credits do not take most of it. The selected scene's clip window is shaded and a playhead follows playback.
- **Scene list**: filters, sort, and a free-text search over the subtitle and final texts that ignores accents and case (`eleve` finds `élève`). `※` marks scenes with notes, `⚑n` scenes with n open review marks; "Only scenes with open marks" filters to them.
- **Clip timeline**, under the video: fades, guards and core in different shades with the gain curve, a tick at every slideshow frame, a clickable bar per line; click or drag to seek.
- **Lines**: an annotated line shows its final French as its units, underlined blue for a `word` and grey for an `expression`. A dotted underline means the unit is not timed and cannot be played. An amber `?` after a unit means its timing is worth checking by ear: its lowest word score is under `LOW_SCORE` (0.5 in `web/app.js`, never tuned against the measured scores) or a word in it has no score.
- **Clicking a unit** plays its span from 120 ms before its first word to 200 ms after its last (`UNIT_LEAD_MS`, `UNIT_TAIL_MS`; aligned word ends fall early, so the tail is longer) and shows its gloss, note, kind, times and score. During playback the unit being spoken is highlighted.
- **English**: each line's literal English where its translation group is fully annotated; otherwise the subtitle English, labelled "subtitle". `≠` in the gutter marks a line whose words differ from the subtitle and opens its subtitle French and English; T opens them for every line, with the words the subtitle lacks tinted green.
- **Notes** ("Explained for a child"): one card per note with its kind, its phrase and where it is. A located phrase is tinted in the French with a numbered badge; badge and card link to each other; a timed phrase plays from its card.
- **Breakdown**: every unit of the scene with time, gloss and note. The selector's `why` is shown as written.
- **Hide English** (E) masks every English text; clicking a masked piece reveals it and every piece with the same key.

## Review marks

A review mark says that a line, or one unit of it, needs fixing. It is stored in `review_marks` ([data-model.md](data-model.md)) with its scene, line, optional unit, a category, the user's comment, a status and, once resolved, what was done.

| Category | Means |
|---|---|
| `translation` | the English is wrong: the literal English, a unit's gloss, or the subtitle English |
| `french` | the final French is not what is said |
| `units` | the split into units, a unit's kind, gloss or note |
| `timing` | a unit or the line plays the wrong sound |
| `notes` | a note for a child is wrong or missing |
| `other` | anything else, said in the comment |

**In the UI.** ⚑ in a line's gutter (faint until the line has open marks, then `⚑n`) opens the mark form under the line; so does M, on the selected unit if there is one, else on the line being played (or the first line). The form preselects the unit when there is one ("the whole line" otherwise; a select changes it), the last category used, and the comment. Keys in the form: 1–6 pick the category and move to the comment, typing on a category starts the comment, ← and → move between categories, Enter saves, Shift+Enter is a new line, Esc cancels. The selected unit's detail box has a "⚑ Mark" button too.

- A line's marks are shown under it: category, the unit (or "whole line"), the comment; an open mark has *edit* and *delete*; a resolved one is greyed with its status, date and resolution, and is read-only. A marked unit has a dashed outline.
- Marks belong to lines, so a line shared by overlapping scenes shows its marks in both ("marked in <scene>" when made in the other).
- **Open marks** in the sidebar (Shift+M toggles it) lists the open marks of every episode, filtered by episode; clicking one opens its scene and flashes the mark. The tab shows the count; the header shows the episode's count.
- Saves go to the database at once; a failed save shows a message and keeps the form open.

**From the command line** (`--db` on each for another database file):

```
.venv/bin/frenchirix review list [--status open|done|dismissed|all] [--episode s01e04]   # default: open
.venv/bin/frenchirix review context <mark id>
.venv/bin/frenchirix review resolve <mark id> --status done|dismissed --resolution "what was done"
```

- `review context` prints, as Markdown, everything a fixer needs: the mark and the comment (and, if the line was re-annotated since, what its unit was); the scene with every line (speaker, subtitle and spoken times, subtitle French, what speech recognition heard, subtitle English with its translation group and source, final French, literal English); the units of the marked line with glosses, notes and times; the scene's notes; other open marks on the scene's lines; the category's fix path and the exact files: the line's annotation record and the scene object (file and line number), and the `corrections/<episode>.json` entry for the translation group; the questions (`app/data/questions/<episode>.json`) of every scene containing the line that are about the line or the whole scene, and the line's alternates (`app/data/alternates/`). Code is `frenchirix/review.py`.
- `review resolve` refuses a mark that is not open and an empty resolution. Only the command line resolves; the UI can only edit or delete an open mark.

## API

All JSON. `*_ms` fields are episode milliseconds ([data-model.md](data-model.md)); `offset_*` fields are `ms - clip_start_ms`, NULL while the scene has no clip.

| Method and path | Returns |
|---|---|
| `GET /api/episodes` | every episode with its scene, rendered and `open_marks` counts, and `story_end_ms` |
| `GET /api/episodes/<id>` | the same for one episode, plus `lines`: `[start_ms, end_ms]` of every line |
| `GET /api/episodes/<id>/scenes` | scene summaries in timeline order: `rendered`, the clip window, the subtitle French and English (`fr`, `en`), the final texts (`final`), the number of notes |
| `GET /api/scenes/<id>` | one scene: its fields, `media` (null until rendered; `audio_exists`, `video_exists` say whether the files are on disk), `lines` with their annotation and units, `annotation` counts, `notes`, `marks` (every review mark on its lines, any status), and `groups`, the translation groups touching the scene (`partial` when one reaches outside it) |
| `GET /api/marks?status=&episode=` | review marks in timeline order, optionally of one status and one episode |
| `POST /api/marks` | a new mark: `{"scene_id", "line_id", "category", "comment"?, "unit_idx"?}`; the line must be in the scene, `unit_idx` (a unit's `idx` in the line) must exist; 201 with the mark |
| `PATCH /api/marks/<id>` | changes `category`, `comment` or `unit_idx` (null: the whole line) of an open mark; 409 when it is resolved |
| `DELETE /api/marks/<id>` | deletes an open mark; 409 when it is resolved |
| `GET /assets/audio/…`, `/assets/video/…` | media files, with Range support |
| `GET /…` | static files from `web/` |

- Per line: `fr_final`, `en_literal`, `annotated_by`, the audio times, `fr_differs` (the words of `fr_final` and `fr` differ, ignoring case, apostrophe style and punctuation), `fr_added` (character spans in `fr_final` of the words the subtitle lacks) and `units`.
- A unit's times are set only when **every** word of it is timed; `score` is its lowest word score and `unscored_words` counts words timed without a score. The server reads `units` and `words` itself, not the `unit_times` view.
- A note: `kind`, `text`, `phrase`, `line_id`, its word and character spans, and times by the same rule. `line_id` NULL: about the whole scene. `line_id` set and span NULL: the phrase was not located.
- A mark: its columns ([data-model.md](data-model.md)) plus `episode_id`, `scene_title`, `line_idx` and `line_fr` (the final French, else the subtitle). The comment is trimmed; anything invalid is a 400 and writes nothing. A request body is read before any reply, so an error leaves no bytes on a kept-alive connection.
- Only `audio/` and `video/` under `assets/` are served, so `db.sqlite` cannot be downloaded; a path with `..`, a dot-file segment or a backslash, or that resolves outside its root, is a 404.
- **Range requests**: Chromium needs `206 Partial Content` to seek in `<audio>` and `<video>`. One range per request; 416 when it starts past the end; a multi-range header gets the whole file. Responses carry `Cache-Control: no-cache`, because a re-render replaces a file under the same name.

## How audio and video stay in sync

- The audio element is the clock and the muted video follows it; both files start at `clip_start_ms`, so the same `currentTime` is valid in both. Play, pause and seek act on the audio and are mirrored onto the video.
- While playing, drift over 30 ms is corrected by running the video 8% faster or slower; drift over 120 ms by setting its `currentTime`.
- **Animation frames are not enough.** Chromium can slow `requestAnimationFrame` to once a second (an occluded window, or headless after a minute) while timers keep running, so a 30 ms timer runs the sync and the unit stop whenever no frame has run for 60 ms.
- Chromium pauses a video-only player in a hidden tab while the audio plays on; a `visibilitychange` handler resyncs the video.
- Clicking a line, or →, ← and R, starts 250 ms before its subtitle start, or 120 ms before `audio_start_ms` for an aligned line, whose highlight then lasts until 300 ms after `audio_end_ms`.

## Keyboard shortcuts

Ignored while typing in a text field, except Esc, which leaves the field. `?` shows the list.

| Key | Action |
|---|---|
| Space | Play / pause |
| J or ↓, K or ↑ | Next / previous scene in the list's order and filters |
| → / ← | Play from the next line / restart the current line (the previous one within 1 s of its start) |
| R | Replay the current line |
| 0 or Home | Back to the start of the clip |
| , / . | Play the previous / next unit |
| E | Hide or show all English |
| G | Glosses under the units |
| T | Subtitle French and English under every annotated line |
| S | 0.75× speed |
| M | Mark the selected unit, or else the current line (the form's own keys: "Review marks") |
| Shift+M | The open-marks list / back to the scene list |
| / | Focus the search |

## Gotchas

- **A video that loads is not a video that shows.** Test playback in a normal GPU-enabled browser window and read pixels back (draw the video to a canvas after a seek; not all zero). Why: [media.md](media.md), "Why 8-bit".
- **Headless Chromium**: a page opened over the DevTools protocol may report `visibilityState === "hidden"` and Chromium then pauses the video. Send `Page.bringToFront` and `Emulation.setFocusEmulationEnabled` first, and pass `--mute-audio` and `--autoplay-policy=no-user-gesture-required`.
- **Request handlers never migrate the database** (they open it with plain `sqlite3`); `serve` migrates it once at start, through `frenchirix.db.connect`.
- Re-annotating a line rebuilds its units, so a mark keeps `unit_text` as well as `unit_idx`; `review context` says when they no longer agree.
- The list and the timeline load once per episode; reload to refresh them. The open marks are fetched again after every mark change. Per-viewer preferences live in `localStorage`; the open scene is in the URL hash, so a reload or a shared link reopens it.
- Tests: `.venv/bin/pytest tests/test_server.py` builds a temporary database and assets directory and runs the server on a free port; `tests/test_review.py` covers the migration, `frenchirix review` and the context.
- Driving it in a browser: Playwright from `app/node_modules/playwright` with `/usr/bin/chromium`, against `serve --port <free port> --db <copy>`; the delete button asks `confirm()`, so accept dialogs.
- To try annotations without touching `assets/db.sqlite`: copy it into `work/`, open the copy with `frenchirix.db.connect`, load a directory with `frenchirix.annotation.import_annotations(conn, episode, directory)` (`annotate-import` has no `--db`), and serve the copy with `--db`.
