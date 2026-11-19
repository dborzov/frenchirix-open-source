# Transcription and forced alignment

How the French audio becomes recognised words (`asr_words`) and how the final French gets word timings (`words`, line audio times): the local models, the GPU rule, the options, the guard and the recogniser confirmation. Read before running `transcribe` or `align`, touching the speech models or the `asr` dependency group, or relying on word timings.

## Contents

- **Rules**: the `uv` trap, downloads, one GPU job at a time.
- **Running it**: the commands and every option of `align`.
- **Weights**: which models, where they are looked up, getting them once.
- **What the models hear**: the centre channel and the speech regions.
- **Recognition**: Whisper settings, the name prompt, clean-ups.
- **Forced alignment**: how the final text gets word timings.
- **The guard: a line stays near its subtitle**: what happens to a line that cannot be placed.
- **Confirming with the recogniser**: the `--confirm` rule and its audit trail.
- **Environment gotchas**: CUDA library clashes.
- **Measured results**: the figures behind the current choices.

## Rules

- **Never a plain `uv sync`.** The models are in the optional `asr` dependency group and `uv sync` syncs exactly, so a plain one uninstalls them. Run `.venv/bin/frenchirix …` or `uv run --no-sync frenchirix …`. If they were removed, `uv sync --group asr` reinstalls them. A plain `uv run` does not remove them (uv 0.13) but still resolves and waits on any running sync.
- **Models are loaded from disk only.** Get them once ("Weights"); after that nothing is fetched at run time. Check the cache before downloading a model again: the files are large.
- **One GPU job at a time.** Each step checks free GPU memory before loading its model (4 GB for Whisper, 2.5 GB for the aligner) and falls back to the CPU, which is much slower.

## Running it

```bash
.venv/bin/frenchirix transcribe s01e04 [--force]
.venv/bin/frenchirix align s01e04 [--force] [--lines 19-26] [--slack-ms 300] [--confirm]
```

Only `frenchirix/transcribe.py`, `forced_align.py` and `asr_audio.py` import the models, inside functions, so the rest of the project works without the `asr` group.

- `transcribe` skips an episode that already has `asr_words` unless `--force`, which replaces all its rows. Its settings and dropped segments go in `meta` `asr:<episode>`.
- `align` times every line that has `fr_final` and `words`; lines whose words are all timed are skipped unless `--force`. It records its settings and the guard's outcomes in `meta` `align:<episode>`. Run `retime` afterwards ([pipeline.md](pipeline.md#retiming-scenes)).
- `--lines 19-26` (`lines.idx`, ranges and commas) re-aligns exactly those lines, timed or not; every other line keeps its times and bounds them. Each such run is added to `meta` `align:<episode>` under `line_runs`; the full run's record, including its `guard` lists, is not updated, so a line's current state is in its word scores or the latest `line_runs` entry that names it.
- `--slack-ms N` sets the guard's window (default 2500). A small window (300) stops a line sliding to a repeat of its own words, as in a song's refrain.
- `--confirm` keeps a low-scoring placement when the recogniser agrees with it ("Confirming with the recogniser").
- On a GPU architecture newer than the CUDA build's kernels (an RTX 50-series card, sm_120), the first GPU call takes about 15 s while CUDA compiles CTranslate2's kernels.

## Weights

The models live in the standard caches, `HF_HOME` (default `~/.cache/huggingface`) and `TORCH_HOME` (default `~/.cache/torch`); set either to keep them elsewhere.

- **Whisper**: `MODEL` in `transcribe.py`, `mobiuslabsgmbh/faster-whisper-large-v3-turbo` (CTranslate2), overridable with `$FRENCHIRIX_ASR_MODEL` (a repo id in `$HF_HOME/hub`, or a directory). `transcribe` never downloads it: when it is missing, it stops and says so. Get it once with the Hugging Face CLI from `huggingface_hub` (installed with the `asr` group), for example `uv run --no-sync hf download mobiuslabsgmbh/faster-whisper-large-v3-turbo`. `resolve_model()` reads the cache directory itself, because `snapshot_download(local_files_only=True)` refuses this snapshot, which lacks `.gitattributes` and `README.md`.
- **Why turbo**: it is the complete CTranslate2 Whisper the project was built and measured with. A model in transformers format (such as `openai/whisper-large-v3-turbo`) cannot be loaded by faster-whisper.
- **faster-whisper's shortcut names** (`large-v3`, `turbo`, `large-v3-turbo`) resolve to other repos and would download them. Use the repo id or a path.
- **MMS_FA**: `$TORCH_HOME/hub/checkpoints/mms_fa_ctc_alignment_mling_uroman.pt` (1,262,047,414 bytes; `CHECKPOINT_NAME` in `forced_align.py`). torchaudio downloads it on the first `align` when it is missing; an interrupted download resumes with `curl -C -`.

## What the models hear

- **Centre channel only**: `pan=mono|c0=FC` on the French audio stream, resampled to 16 kHz. Dialogue sits in the centre channel about 11 dB above the front left, so this is close to isolated speech. This was measured for this show's 5.1 mix.
- **Speech regions from the subtitles** (`build_regions` in `transcribe.py`), from all lines of the episode: lines less than 2 s apart are merged, each region is padded by 0.75 s but never past the midpoint of the gap to its neighbour, and regions over 28 s are split at their largest internal gaps. Whisper invents text over long music-only stretches; listening only near subtitles avoids most of it. Speech with no subtitle at all is not transcribed.
- Alignment uses the same regions.

## Recognition

- `faster-whisper` 1.2.1, float16, beam 5, language `fr`, word timestamps (`TRANSCRIBE_OPTIONS`). **No conditioning on previous text**, so one hallucination cannot propagate, and no VAD, because the regions do that job. Each region is recognised alone.
- **Name prompt**: the `initial_prompt` is only a list of names: capitalised words that occur at least twice mid-sentence in the episode's French subtitles, most frequent first, at most 40. The subtitle text itself is never given to the model, so the transcript stays an independent witness of what is said.
- **Clean-ups** (`join_tokens`, `CREDIT_PATTERN`), recorded in `meta`: a token starting with an apostrophe is joined to the previous word (`c` + `'est` → `c'est`); a token with no letter or digit (the `!` and `?` after a space) is attached to the previous word; whole segments that look like subtitler credits ("Sous-titrage Société Radio-Canada") are dropped. Whisper produces these credits in quiet stretches and on very short clips too.
- `asr_words.text` is the word with any punctuation the model attached; `prob` is its word probability (the lower of the two for a joined word).

## Forced alignment

- torchaudio's `MMS_FA` bundle (Meta's multilingual wav2vec2 aligner) with its wildcard token `*`, CTC Viterbi via `torchaudio.functional.forced_align`. Per region, the target is the `fr_final` of its annotated lines, spelled by `spell()` into `a`–`z` and the apostrophe.
- **Wildcards** cover what the text does not: the region's edges, every boundary between lines, and every line with no `fr_final`. `*` costs nothing, so lines are placed by the audio, not by subtitle times.
- **Unspellable words** (a digit, as in "49.3", or a letter outside the alphabet) become a wildcard of their own: they get the span between their neighbours and a NULL `score`.
- `score` is the frame-weighted mean probability of a word's characters, 0 to 1 (frames are 20 ms). Word times never go backwards or overlap.
- **Word spans are tight**, from the spike of the first sound to the spike of the last (median 140–200 ms). Pad when cutting audio for a word or unit (the review UI uses 120 ms before, 200 ms after); the stored spans stay the aligner's.
- **Sung lines align poorly**: the model is trained on speech, and the subtitle text of songs is often not what is sung. Treat sung-line scores as unreliable.
- Lines whose `words` rows do not match `split_words(fr_final)` are skipped with a warning.

## The guard: a line stays near its subtitle

The wildcards between lines let a short line slide to wherever its words occur again (S01E04 line 266 once landed 6.4 s early with a score of 1.0). So `apply_guard` in `forced_align.py` keeps every line inside its **window**: its subtitle time widened by `slack_ms` on each side (2.5 s by default, because annotators restore words spoken up to about 2 s early or late).

1. A line placed by the region alignment inside its window with a mean word score of at least `retry_below` (0.3) is accepted and never touched.
2. Every other line is aligned again alone, on the audio of its window between the accepted lines before and after it; lines are processed in order, so they never overlap. The better-scoring of the placements that fit is kept.
3. A line still below `unreliable_below` (0.15), or that could not be aligned, has no acoustic evidence: unless `--confirm` accepts it, its words are spread evenly over its subtitle time, clipped to the free part of its window, and **every word gets score 0.0** (`UNRELIABLE_SCORE`).

An unreliable line therefore has `score = 0.0` on every word; `frenchirix check` reports it as `timing.unreliable` and the export replaces its times ([app-export.md](app-export.md)). NULL still means only "unspellable word, real span". Settings: `GuardSettings` (`GUARD`); the outcome of every line (`realigned`, `kept`, `unreliable`, `confirmed`) is in `meta` `align:<episode>` under `guard`.

## Confirming with the recogniser

With `--confirm`, a placement scoring under `unreliable_below` is kept, with status `confirmed`, when the recogniser agrees with it (`recogniser_agrees` in `forced_align.py`, constants `CONFIRM_*`): Whisper listens to the line's whole region with the line's own text as `initial_prompt`, and must hear every word of the line as a contiguous run, each with probability at least 0.5, with word starts agreeing with the placement: median difference at most 100 ms, at least 75% of the words within 150 ms, none beyond 1000 ms.

- Not "every word within 150 ms": Whisper's timestamp for the first word after a pause is often early by up to a second (S01E03 line 24, "On", 446–986 ms off in two runs while the other words agreed).
- Music lowers the aligner's scores for every text in a song, which is why a second, independent source is used rather than a lower threshold.
- Prompted recognition is not fully deterministic, so each verdict (accepted or rejected, with every word's difference) is stored in `meta` `align:<episode>` under `line_runs[].confirm`: that is the audit trail.

## Environment gotchas

- **cuDNN clash.** CTranslate2 is built for CUDA 12; torch 2.14 from PyPI is CUDA 13. `nvidia-cudnn-cu12` and torch's `nvidia-cudnn-cu13` install the same paths, so whichever installs last overwrites the other. Only cu13 cuDNN is installed and CTranslate2 works with it: do not add `nvidia-cudnn-cu12`. If it was installed: `uv sync --group asr --reinstall-package nvidia-cudnn-cu13`.
- **cuBLAS 12.** CTranslate2 dlopens `libcublas.so.12` by name and does not search `site-packages/nvidia`. `nvidia-cublas-cu12` provides it, and `asr_audio.preload_cuda_libraries()` loads it (and cuDNN) with `RTLD_GLOBAL` before faster-whisper is imported.
- **torchaudio 2.11.1 is the last release** (torchaudio is in maintenance). It works next to torch 2.14.1 (pinned in `uv.lock`), and still provides `forced_align` and the `MMS_FA` bundle.

## Measured results

Measured 2026-11-13 on one desktop GPU (an RTX 5080, 16 GB). The one-off scripts are in `scripts/eval/`; they wrote under `work/asr/`, which is gone, so expect to fix paths before reusing them.

- **Recognition** hears 15–35% more words than the subtitles show (fillers, repetitions, clauses the subtitles drop) and finds 82–84% of the subtitle words in order. Median word probability 0.99.
- **Alignment**: median word score 0.93 on lines whose text matches the audio exactly, 0.06–0.29 on sung words. Short spans cut at the aligned times were recognised alone as well as spans cut at Whisper's own word times, or better, so the aligner's boundaries are kept as they are.
- **Speed**: `transcribe` 25–36 s per episode (peak 2.5 GB of GPU memory); `align` about 7 s per episode (peak 3.8 GB).
