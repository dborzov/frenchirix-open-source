# Voice clips for the questions, answers and line alternates

How the spoken clips of the app's own French are generated on a local GPU and checked, the reference voice they all clone, and which clips are known to be bad or doubtful. Read before generating or regenerating clips, changing the voice, or trusting a clip.

## Rules

- **`assets/tts-voice/` is the voice and is committed** (it is in this repository). It holds `ref.flac` (the 10.5 s reference clip) and `voice.json` (its transcript, the models and revisions, the design description and seed). It cannot be regenerated: the voice-design model samples, so designing again, even with the same description and seed, gives a different voice, and every new clip would sound like someone else. It is the one exception to "never commit media". The script stops if it is missing.
- **One clip per distinct sentence, named by its hash**: `<hash>` = the first 16 hex digits of the SHA-1 of the exact UTF-8 sentence (`h` in `scripts/tts_questions.py`, `clip_name` in `frenchirix/app_export.py`). An edited sentence gets a new clip; the old file stays behind, harmless.
- **`work/app-media/q/` only ever holds complete clips and `manifest.json`.** Attempts and the manifest being written live in `work/tts-q/` (same filesystem) and reach `q/` by one atomic rename, because the export may run during generation and links whatever is there. Keep it that way when changing the script.
- **Run nothing else heavy on the GPU** while it runs (about 6 GB of GPU memory).
- **Nothing is downloaded at run time.** The script sets `HF_HUB_OFFLINE=1` and loads the weights from the Hugging Face cache (`$HF_HOME/hub`); download `Qwen/Qwen3-TTS-12Hz-1.7B-Base` at the revision `voice.json` names once beforehand.

## What is produced

- One clip per distinct French sentence of `app/data/questions/<episode>.json` (questions and answers) and `app/data/alternates/<episode>*.json` (part files included): `work/app-media/q/<hash>.m4a`. The export links the released ones into `app/public/media/q/` and sets `audio` on them ([app-export.md](app-export.md)).
- AAC-LC mono 48 kHz 160 kbps `.m4a`, `+faststart`. Lower bitrates made ffmpeg's AAC encoder overshoot by up to 4.7 dB on limited speech. Silence trimmed to 80 ms each side. About −16 LUFS (measured on the clip looped to 4 s; `loudnorm` fails on clips this short), true peak at most −1.6 dBTP via gain and `alimiter`, corrected over up to 6 encodings. No effects: the app's player adds the funny voices.
- `work/app-media/q/manifest.json`: per hash the text, `kind` (`question`, `answer` or `alternate`), duration, what the recogniser heard, `cer`, `cer_strict`, `wer`, rate, longest pause, loudness, peak, attempts with their numbers, `doubtful`.

## Model and voice

**Qwen3-TTS 12Hz 1.7B Base** in voice-clone mode, cloning the reference clip in `assets/tts-voice/`, which **Qwen3-TTS 12Hz 1.7B VoiceDesign** made (seed 0, `language="French"`) from a description of a cheerful young Parisian woman presenting to children (the full text is in `voice.json`). The voice is synthetic: no recording of a real person was used. One voice speaks everything; delivery comes from the reference clip, since Base takes no style instruction.

Why: in a comparison on 25 sentences from the questions (hard names, elisions, numbers), each clip transcribed by two recognisers, the designed-then-cloned voice was recognised best. The preset voices of Qwen3-TTS CustomVoice are not French and mangle names and numbers; `facebook/mms-tts-fra` drops numbers; VoiceDesign alone re-invents the voice for every sentence.

## How to run

The script needs a Python environment with torch (CUDA), `qwen-tts`, `huggingface_hub`, `numpy` and `soundfile`; this repository's `.venv` does not hold them, so keep them in a separate uv project and run the script with it. From the repository root, with `<tts project>` that project's directory:

```sh
uv run --project <tts project> --frozen --no-sync python scripts/tts_questions.py              # only missing clips
uv run --project <tts project> --frozen --no-sync python scripts/tts_questions.py --limit 20   # at most 20
uv run --project <tts project> --frozen --no-sync python scripts/tts_questions.py --only HASH [HASH…] [--attempts 9]   # redo these
uv run --project <tts project> --frozen --no-sync python scripts/tts_questions.py --force      # everything
```

- `--only` regenerates existing clips and keeps the best new attempt (the old file is not a candidate).
- Needs `ffmpeg`, `ffprobe` and the `voxtype` CLI with its Parakeet v3 model in `~/.local/share/voxtype/models/` (`PARAKEET` in the script), for the check below.
- The manifest is saved every 25 clips; an interrupted run loses little, and a re-run skips existing clips. The SoX and flash-attn warnings at start-up are harmless.
- Afterwards run `.venv/bin/frenchirix export-app` so the bundle points at the new clips.

## How each clip is checked

Nobody listens. Each encoded clip is transcribed back with Voxtype's Parakeet TDT 0.6B v3 and compared with the text:

- Both sides normalised: lower case, no accents or punctuation, digits spelled out in French. `cer` is computed on "sound keys" that drop usually silent endings (the recogniser cannot hear "ils chantent" from "il chante"); `cer_strict` without them; `wer` plain.
- Accepted at once at `cer` ≤ 0.10 with no internal pause over 0.7 s and, for 3 words or more, at most 0.8 s per word. Otherwise regenerated with other seeds (42, 7, 1234), up to 3 attempts, best kept.
- `doubtful`: still `cer` > 0.20, a pause over 0.7 s, or too slow.
- Not caught: accent, intonation, expressiveness, a wrong vowel the recogniser corrects from context. Parakeet also writes English for some French words ("Miaou" → "Meow"); read `heard` before blaming the voice.

## Known bad or doubtful clips

These are clips of season 1's sentences; your own content gets its own list from the manifest. Nobody had listened to any clip when this was written ([app-status.md](app-status.md), checklist). For season 1, the order to listen in was: `b1c87e21db188b70` (Je suis très content !: Parakeet hears "contente", possibly a feminine ending from the female voice), `589e127d45c0330c` (Coin-coin.), `2b52a796051df6f8` (Atchoum !, heard as "Achoum" in all 9 attempts), `c93e84ac1a7bbe23` (Beaucoup de canards.), `a83f98ea30487971` (Fouille.), then `7134729b63244544` and `cf25a017cbf32fd7` (typical questions) and a random handful, for accent and cheerfulness.

The model's weak spot is **very short isolated words and onomatopoeia**: it sometimes drops a nasal vowel or adds a syllable. "Coin-coin.", "Fouille.", "Beaucoup de canards." and "Dimilliondepizzix." were regenerated with 6–9 attempts until both recognisers heard them right.

The other doubtful clips (`doubtful: true` in the manifest; list them from it) are almost all the recogniser, not the voice:

- homophones and one-word answers spelled otherwise (Quittes → "Kit", Au zoo → "Ozo", Graisse → "Grèce", Cent Gaulois → "Sang Gaulois");
- the show's invented names split into French words (Idéfix → "idée fixe", Chatopizzus → "Château …", Continsta → "Compte Insta");
- among the alternates, onomatopoeia and interjections ("Miam, miam.", "Cocorico, cocorico.", "Meuh, meuh.", "Hop… Hop…"); "Euh… Euh…" was heard as nothing, though the clip is not silent.
