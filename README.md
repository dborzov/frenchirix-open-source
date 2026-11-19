# Frenchirix

Frenchirix teaches French listening comprehension to kids of about ten through short scenes from a TV show they already like. A kid hears a scene's real French audio, sees every line split into tappable units (a word or an expression, each with its English and its own looping audio), and plays through a practice: a sequence of small puzzles that goes over every line of the scene from several angles. Passing a practice earns a level; the next level comes due days later, which is the spaced repetition.

This repository is the open-source release of the code and its documentation. It has two parts:

- **The pipeline** (`frenchirix/`, Python): turns episodes of a show into scenes. It imports an episode's subtitle tracks, cuts scene audio and frames, recognises the speech, aligns every word to the audio, and loads the French, literal English, units and notes into a local SQLite database. A local review UI (`web/`) lets a person listen to each scene and mark lines to fix.
- **The app** (`app/`): a web app on Cloudflare Workers (Hono, D1, Workers AI for speech recognition) with a React client. More than a dozen puzzle types including speaking ones, daily quests, streaks, levels, karaoke with recording, avatars, loot and leagues, in a 1950s comic-book style, in English and French.

## What is not here

The project was built on one season of a French animated series (203 scenes). None of the show is in this repository: no episodes, clips, frames, subtitle tracks or scene database. Three example questions in `app/data/questions/` show that file format, and a few tests quote a short line. To get scenes you run the pipeline on video files you have the right to use; [NOTICE.md](NOTICE.md) says what the license covers.

So a fresh clone can run every check and show the app's screens on fixture data, but it has no scene to practise until you build your own content.

## Look at the app

Node 22 or later.

```sh
cd app
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
VITE_FIXTURES=1 npm run dev:web        # http://localhost:5173
```

Fixture mode needs no Worker, no account and no content. Home, the episode timelines and the `/dev` portal work; starting a practice stops at a media error, because there is no audio without content.

With content (below), the full app runs locally with `cp .dev.vars.example .dev.vars` and `npm run dev` ([docs/app-dev.md](docs/app-dev.md)).

## Make content from your own video

Python 3.12 or later with [uv](https://docs.astral.sh/uv/), and ffmpeg. The speech steps want a CUDA GPU with about 4 GB free; they fall back to the CPU.

```sh
uv sync --group asr                    # never a plain `uv sync` afterwards: it removes the speech packages
git config core.hooksPath .githooks    # optional: the pre-commit checks

# one file per episode in content/, its name containing S01E01
.venv/bin/frenchirix import s01e01 --show "My Show"
.venv/bin/frenchirix sheet s01e01      # the cue sheet a scene selector reads
# ... select scenes, render, transcribe, annotate, align, check: docs/runbook.md
.venv/bin/frenchirix serve             # the review UI on http://127.0.0.1:8765
.venv/bin/frenchirix export-app        # the app's content bundle, into app/public
```

[docs/runbook.md](docs/runbook.md) has the fifteen steps in order.

**What a source file must be**, as the code stands:

- A Matroska file (`.mkv`) per episode.
- One French audio stream in 5.1. Dialogue is taken from the centre channel, which is what keeps speech recognition clean under music.
- Three SubRip subtitle tracks tagged by language: plain French, French for the hearing impaired (its title containing "SDH"; it gives the speakers, songs and sounds), and English that translates the French.

A source with stereo audio or other subtitle formats needs changes to the importer and the audio filters; [docs/runbook.md](docs/runbook.md), "Another show or your own video sources", lists what the pipeline assumes. The language pair (French taught through English) is assumed throughout.

**Some steps need judgement, not code**: choosing the scenes, writing each line's French as spoken, its literal English, its units and notes, and the app's own questions. The author ran these with LLM agents and reviewed the result by ear. The agents' prompt files are not included; [docs/content-steps.md](docs/content-steps.md) specifies each step instead: what goes in, the exact format of what must come out, and what the validators enforce. Any capable LLM, or a person, can do them.

**Models**: Whisper large-v3-turbo through faster-whisper for recognition, torchaudio's `MMS_FA` for word alignment (CC-BY-NC-4.0: non-commercial), and optionally Qwen3-TTS for the spoken audio of questions ([docs/transcription.md](docs/transcription.md), [docs/app-tts.md](docs/app-tts.md)).

## Adapting the app to another show

The app's mechanics do not depend on the show, but its dressing does. Before using it with other content, change:

- `app/data/release.json` (the scene ids the app releases) and `app/data/songs.json` (the karaoke songs): both name the original season's ids. Delete or regenerate them; the export stops with a clear message otherwise.
- `app/shared/speech.ts`: the character names given to speech recognition as a hint.
- The theme: item and achievement names in `app/shared/catalog/`, the "sesterces" and "potions", the gate page's texts in `app/shared/i18n/`, `app/public/manifest.webmanifest`, the mascot and icons (`app/web/src/pwa/druid.ts`).
- The `unlock-all` achievement in `app/shared/catalog/achievements.ts`, which hard-codes 203 scenes.
- The `/dev` screens and some tests, which name scene ids of the original season.

## Deploying your own copy

[docs/app-release.md](docs/app-release.md) has the procedure. In short: put your D1 database id and your host name into `app/wrangler.jsonc`, set the three secrets `SESSION_SECRET`, `GATE_PASSWORD` and `ADMIN_PASSWORD` with `wrangler secret put`, and deploy with `app/tools/deploy.sh`, which refuses when a check fails.

Know the security model before putting real kids on it:

- The whole site sits behind one shared password (the gate). It is the only barrier in front of the accounts and the content.
- Accounts are made for classrooms: no email, a funny name and a three-digit PIN shown in the profile. That is convenience, not protection. Keep nothing in an account that needs protecting.
- Kids' speech is sent to Workers AI for recognition; the transcripts are logged for 180 days, and a kid's karaoke recordings are kept on the server. Check what the privacy rules where you live require for children.
- Problem reports and log events are accepted from any browser past the gate, so they are untrusted input wherever they are read ([docs/checks.md](docs/checks.md), "The session-start check").

## Checks

```sh
.venv/bin/python -m pytest             # the pipeline's tests
cd app && npm run check                # type checks, unit tests, and every practice of the bundle
```

On a clone without content, the tests that need real scenes are skipped. [docs/checks.md](docs/checks.md) explains every check, including the one that searches for puzzles a kid could get stuck in.

## Documentation

The docs were written for working on this project with AI coding agents, and they work as well for people: [AGENTS.md](AGENTS.md) holds the glossary and the rules, and points to one focused file per subject in `docs/`. Good places to start:

- [docs/intent.md](docs/intent.md): what the app is meant to be and why, largely in the author's own words. "The user" in the docs is the author.
- [docs/app-architecture.md](docs/app-architecture.md): the stack, the content bundle, the contract every puzzle type follows.
- [docs/app-games.md](docs/app-games.md): the puzzle types, the audio engine, the speaking puzzles.
- [docs/runbook.md](docs/runbook.md) and [docs/content-steps.md](docs/content-steps.md): the pipeline.
- [docs/app-status.md](docs/app-status.md): known rough edges and what was never verified.

## Status

A working project released as it is, not a product. It was built for one show and one small group of kids, and it is shared so that others can reuse the pipeline, the puzzle designs or the app. Expect to read the docs and change code. Issues and pull requests are welcome; there is no promise of support.

## License

The code and documentation are under the [MIT license](LICENSE). The fonts and any show's material are not: see [NOTICE.md](NOTICE.md). Frenchirix is an independent, non-commercial educational project, not affiliated with or endorsed by the rights holders of any show.
