# App export: the content bundle and the app's media

What `frenchirix export-app` produces from `assets/db.sqlite` and `content/`, the settings behind it, `app/data/release.json`, and the timing fallbacks (`approxTimes`). Read before running or changing the export, its audio or frame settings, the key-unit or difficulty rules, the songs, or the release list. The bundle's types are `app/shared/content.ts` and the "Content bundle" section of [app-architecture.md](app-architecture.md); the question voice clips are [app-tts.md](app-tts.md).

## Contents

- **Commands**: the export, its modes, verification.
- **What it writes**: the bundle, the media cache, hard links.
- **The release list**: `app/data/release.json` and how it is chosen.
- **Audio**: cut, loudness, codec.
- **Frames and thumbnails**.
- **JSON rules**: times, unit spans, loop windows, key units, difficulty, songs, questions, alternates, voices, bank, version.
- **Unreliable word timings (`approxTimes`)**: when a line's word times are replaced.
- **Songs and sound effects**.
- **Compatibility and tests**.

## Commands

From the repository root:

```
.venv/bin/frenchirix export-app                      # JSON + media into app/public
.venv/bin/frenchirix export-app --data-only          # JSON only: needs neither content/ nor ffmpeg
.venv/bin/frenchirix export-app --verify             # only check the bundle on disk (media included)
.venv/bin/frenchirix export-app --scenes ID[,ID] [--force]   # (re)build media for some scenes
.venv/bin/frenchirix export-app --verbose            # also list every line whose word times were replaced
.venv/bin/frenchirix release-list [--all] [--version V] [--dry-run]   # choose the release scenes, write app/data/release.json
```

- Every export ends with verification and exits 1 on any problem. `--data-only` verifies the JSON alone; hooks and checks call that. `app/tools/deploy.sh` runs `--data-only` then `--verify`.
- JSON is written for every released scene on every run; `--scenes` limits only media work.
- The database is opened read-only. `--out` changes the target directory, `--jobs` the number of media workers.
- Media are skipped when the file exists and its parameter hash in the media manifest (`work/app-media/.export-manifest.json`) matches. The hash covers the clip window, the source and the settings that affect that kind of file. A code change that is not a setting does not change a hash: bump `EXPORT_VERSION` or pass `--force`.
- Settings live in `AppSettings` in `frenchirix/app_export.py`.
- The three sound effects (`right.mp3`, `wrong.mp3`, `win.mp3`) are copied from `assets/sfx/` when they are there. The repository ships none: without them those three sounds are silent.

## What it writes

Under `app/public/` (git-ignored, never edited by hand):

| Path | What |
|---|---|
| `data/index.json`, `data/scenes/<id>.json`, `data/songs/<id>.json` | the JSON bundle |
| `media/a/<scene id>.m4a` | scene audio, AAC-LC stereo 48 kHz |
| `media/f/<scene id>/<n>.webp` | slideshow frames, 712×400 |
| `media/s/<song id>.m4a`, `media/sf/<song id>/<n>.webp` | songs |
| `media/q/<hash>.m4a` | question, answer and alternate clips ([app-tts.md](app-tts.md)) |
| `media/sfx/{right,wrong,win}.mp3` | the sound effects, unchanged |

**The media cache.** Every media file is made in `work/app-media/` (the TTS script writes its clips to `work/app-media/q/`), and the export hard-links into `app/public/media/` exactly the files the released documents name; anything else there is deleted. Vite copies `app/public/` into `dist/`, so the build and the deploy carry only the released scenes. `--verify` fails when a built media file is named by no document, and `npm run check` (`check:practices`) fails when the bundle's scenes differ from `release.json`.

Sources read by the export besides the database: `app/data/release.json`, `app/data/songs.json`, `app/data/questions/<episode>.json` and `.units.json`, `app/data/alternates/*.json` ([app-content.md](app-content.md)). This repository ships `songs.json`, `release.json` and one example questions file for season 1 of the show it was built on; for your own episodes, write your own (`release-list` writes `release.json`).

## The release list (`app/data/release.json`)

`{ "version": …, "scenes": [...] }`, written by `frenchirix release-list`. The owner's deployment released all 203 scenes of season 1 (`release-list --all --version 2.2.0`, decided 2026-11-14: [intent.md](intent.md)); a scene id in the list that is not in your database is an error of the export.

`version` names the release the scene list was made for. It is a label only: the export logs it and nothing else reads it. It is not the **content version**, the hash of the whole bundle (`content_version()` in `frenchirix/app_export.py`: the index, every scene and song, the media settings) that `index.json` carries, `?v=` URLs use and open practices store as `content_version`. That hash changes by itself whenever the export writes different data (new notes, units, questions…), so a change to scene data needs no edit here; rewrite the list only when the set of released scenes changes.

Without `--all`, `choose_release` (deterministic) picks the scenes as release 2.1 did, 50 of them:

1. every song scene, so both starter songs are whole;
2. every other score-5 scene;
3. score-4 scenes until 50, best fit for long practices first (`fit_rank`: no `approxTimes` line, then 3–8 lines, then lines with at least two key units); an episode with fewer than 6 scenes gets its best candidate first; ties go to the episode with fewer scenes, then the id.

With the file present the export writes only those scenes' JSON (stale scene files are deleted), recounts episodes' `sceneIds` and `order` among them, keeps only songs that have a released scene, and draws the bank and the question voices from the released scenes only. Difficulty is still bucketed over all 203 scenes. Without the file the export covers every scene. A released scene needs its line alternates and their clips.

## Audio

- **Cut**: exactly the render's (`render.audio_input_args`, `render.audio_filter` over the scene's stored window and fades), so downmix, gain, padding and fades match `assets/audio` ([media.md](media.md)).
- **Loudness**: −16 LUFS integrated, true peak at most −1.5 dBTP. One static gain per clip; where that would put the true peak above −2.0 dBTP, a lookahead limiter (`alimiter`, 5 ms attack, 80 ms release, at 4× the sample rate so it sees true peaks) takes off at most 6 dB; a clip needing more stays under the target. After encoding the peak is measured again and the clip re-encoded with a lower ceiling or gain if needed. Why a limiter: the renders are quiet and peaky (peak-to-loudness ratio 13–26 dB), so a static gain to −16 would clip almost every scene; the limited peaks are short hits and shouts.
- **Codec**: ffmpeg's native `aac` (no libfdk_aac in this ffmpeg), AAC-LC 160 kbps, stereo, 48 kHz, `.m4a` with `+faststart`. `-aac_pns 0 -aac_is 0`: with them on, the encoded peak overshot the limited input by up to 2.6 dB; off, within about 0.5 dB, same size.
- **Timing**: the encoder's 1024-sample priming is hidden by an MP4 edit list; decoded with ffmpeg the file lines up with the render at lag 0. A player that ignored the edit list would play 21 ms late (Safari: see the checklist in [app-status.md](app-status.md)).

## Frames and thumbnails

- Times from `render.frame_times` (first frame, the core start, every 2 s, just before the end), matching `scenes.frame_times_ms`. For each target the last frame at or before it.
- 400 px high, lanczos, BT.709 → BT.601 in the scaler, lossy WebP (`VP8 `) quality 55, compression level 6. Quality 45 and 65 looked the same at 712×400; 55 is a margin.
- `thumb` is the frame nearest the middle that is not near-black, near-white or near-uniform (`choose_thumb`, statistics cached in the media manifest so `--data-only` needs no decoding). Night scenes where every frame is dark keep their least-dark frame. `--verify` fails an excluded thumb when a good frame exists.

## JSON rules

- **Times** are ms from the start of the scene's audio file (episode ms minus `clip_start_ms`). A line's window is `audio_start_ms`…`audio_end_ms`, falling back to the subtitle times.
- **Unit spans** `cs`/`ce` are character offsets into the line's French; verification checks `line.fr.slice(cs, ce) === unit.fr`, order, no overlap, only punctuation and spaces between units, and that all text is in the Basic Multilingual Plane (so Python and JavaScript offsets agree).
- **Loop windows**: the unit's words widened by up to 80 ms on each side, only into silence: never past another word of the same scene, never outside the audio.
- **Key units** (`is_key`, `STOP_WORDS`): every single-word unit; an expression unless all its words (elisions split) are articles, bare pronouns, short interjections, bare conjunctions or auxiliary forms of être/avoir.
- **Difficulty**: the questions file's `difficulty` wins; otherwise z-scores of words per second, words per line and the share of rare words, summed and ranked into 10/25/30/25/10 % for 1–5.
- **Songs first** ([intent.md](intent.md), "Choosing new scenes"): every `song` scene exports with score 5 and difficulty at most 2; the database is not changed. A scene inside a song's line range gets `songId`; `"starter": true` in `songs.json` becomes `starter` on the index's song entry.
- **titleFr** is the questions file's `title_fr`, else the English title. **order** is the position in the episode by `core_start_ms`. Episodes are titled "Épisode N".
- **Notes** are the scene's notes; `unitIds` are the units overlapping the note's word span.
- **Questions**: ids `<scene id>:q<n>` in file order. Question, answer and alternate units come from the `.units.json` and alternates files, tiled onto the sentence by `tile_units`; an entry that does not tile becomes one unit over the whole sentence (the export prints the counts; `--verbose` lists failures). `audio` is set to `/media/q/<hash>.m4a` only when that clip exists and is not empty, so the export is safe to run during clip generation; the hash rule is in [app-tts.md](app-tts.md).
- **Voice**: the four presets (squeaky, deep, wobble, echo) in turn over the released questions in id order, so neighbours sound different. Adding a question shifts the voices after it.
- **Bank** (distractors): 150 lines of 2–8 words and 300 key units, de-duplicated, hash-ordered and taken round-robin across episodes.
- **version**: the first 12 hex digits of SHA-256 over the canonical JSON and the media parameters; `--data-only` and a full run agree. The client and the Worker use it to version media URLs ([app-release.md](app-release.md), "Updates").

## Unreliable word timings (`approxTimes`)

The app loops each unit's window, so a line whose aligned words sit away from where they are spoken makes every tap play the wrong sound. `line_timings` decides per line, for scenes and songs; the database is not changed.

A line is **suspect** when the aligner scored every word 0, or its first or last word drifts more than 1 s from the subtitle, or a word lies outside the clip or is untimed. A suspect line is compared with the speech recogniser's own words (`asr_words`), matched within 1.5 s; a match is confident when it covers at least 60 % of the words (all of them for one- or two-word lines). Then:

1. confident and within a median 400 ms of the alignment (and not an all-zero line): alignment kept;
2. confident but disagreeing: words placed on the recogniser's times, unmatched words spread in the gaps; `approxTimes: true`;
3. not confident, the line only drifted and the aligner's mean score is at least 0.45: alignment kept;
4. otherwise: words spread over the subtitle time by length; `approxTimes: true`.

`export-app --verbose` lists every suspect line with its reason and outcome. Fixing a line's timing (windowed re-alignment, recogniser confirmation) is a pipeline repair: [runbook.md](runbook.md) and [transcription.md](transcription.md). None of these lines has been checked by ear.

## Songs and sound effects

- `app/data/songs.json` defines the songs by line range; for season 1 of this show: `s01e03-madame-arbre` (s01e03-0019…0026), `s01e04-monde-romain` (s01e04-0010…0022), `s01e05-monde-romain-reprise` (s01e05-0156…0163). For another show, list its songs there (or none). The window follows the scene rule around the first and last line; lines carry units and word times like scenes, with the same `approxTimes` rule.
- The three sound effects of `assets/sfx/`, when present, are copied byte for byte.

## Compatibility and tests

- Checked with ffprobe: AAC-LC stereo 48 kHz in MP4 with `moov` before `mdat` and an edit list; frames are simple lossy WebP, yuv420p; drills are MP3 with a Xing header. Playback on real iOS devices is unverified: [app-status.md](app-status.md).
- `tests/test_app_export.py` covers unit spans, loop windows, the key rule, difficulty buckets, the gain plan, `line_timings`, the questions merge and unit tiling, voices, the bank, the thumb choice and the questions checker. No media needed.
