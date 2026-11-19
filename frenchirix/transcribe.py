"""Speech recognition of an episode's French audio into `asr_words`.

Step 6 of docs/runbook.md; the method, the model choice and measured results are
in docs/transcription.md.

The recogniser only listens where the subtitles say someone speaks: speech regions
are built from the times of all the episode's lines, which keeps it away from long
music-only stretches where Whisper invents text. It is prompted with the character
names that recur in the episode's subtitles, never with subtitle sentences, so the
transcript stays an independent witness of what is said.

The heavy packages (faster-whisper, numpy) come from the `asr` dependency group and
are imported inside the functions that need them; region building and the name
prompt need nothing beyond the standard library.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from frenchirix.text import split_words

# Regions
MERGE_GAP_MS = 2000  # lines closer than this share a region
PAD_MS = 750  # added on each side of a region, never past half the gap to a neighbour
MAX_REGION_MS = 28_000  # longer regions are split at their largest internal gaps

# Recognition
# A CTranslate2 conversion of Whisper, as a Hugging Face repo id found in the local cache
# ($HF_HOME/hub) or a directory. Overridden by $FRENCHIRIX_ASR_MODEL. Never fetched: the
# shortcut names of faster-whisper ("large-v3", "turbo") would download other repos.
MODEL = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
GPU_NEED_MIB = 4000  # large-v3-turbo in float16 peaks well below this; see docs/transcription.md
PROMPT_MAX_NAMES = 40
PROMPT_MIN_COUNT = 2

TRANSCRIBE_OPTIONS = {
    "language": "fr",
    "task": "transcribe",
    "beam_size": 5,
    "best_of": 5,
    "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
    "word_timestamps": True,
    "condition_on_previous_text": False,
    "vad_filter": False,  # the regions already are the voice activity detection
    "compression_ratio_threshold": 2.4,
    "log_prob_threshold": -1.0,
    "no_speech_threshold": 0.6,
}


@dataclass
class Region:
    """A stretch of episode time to listen to, and the lines inside it."""

    start_ms: int
    end_ms: int
    lines: list[int] = field(default_factory=list)  # lines.idx, in order


def _gaps(spans: list[tuple[int, int, int]]) -> list[int]:
    """Gap before each span after the first: its start minus the furthest end so far."""
    gaps, reach = [], spans[0][2]
    for _, start, end in spans[1:]:
        gaps.append(start - reach)
        reach = max(reach, end)
    return gaps


def _split(spans: list[tuple[int, int, int]], max_ms: int, pad_ms: int) -> list[list[tuple[int, int, int]]]:
    """Split a group of spans at its largest gaps until each padded group fits `max_ms`."""
    length = max(e for _, _, e in spans) - spans[0][1] + 2 * pad_ms
    if len(spans) == 1 or length <= max_ms:
        return [spans]
    gaps = _gaps(spans)
    cut = max(range(len(gaps)), key=lambda i: (gaps[i], -abs(i - len(gaps) / 2)))
    if gaps[cut] < 0:
        return [spans]  # lines overlap all the way through: no place to cut
    cut += 1
    return _split(spans[:cut], max_ms, pad_ms) + _split(spans[cut:], max_ms, pad_ms)


def build_regions(lines: list[tuple[int, int, int]], duration_ms: int, *,
                  merge_gap_ms: int = MERGE_GAP_MS, pad_ms: int = PAD_MS,
                  max_ms: int = MAX_REGION_MS) -> list[Region]:
    """Speech regions from subtitle lines given as (idx, start_ms, end_ms).

    Lines whose gap is under `merge_gap_ms` are merged; a merged group longer than
    `max_ms` (padding included) is split at its largest internal gaps. Each region is
    padded by `pad_ms` on both sides, but never past the midpoint of the gap to the
    neighbouring region, so regions never overlap; and never outside the episode.
    A single line longer than `max_ms` stays one region.
    """
    spans = sorted(((i, s, e) for i, s, e in lines if e > s), key=lambda t: (t[1], t[0]))
    if not spans:
        return []
    groups: list[list[tuple[int, int, int]]] = [[spans[0]]]
    reach = spans[0][2]
    for span in spans[1:]:
        if span[1] - reach < merge_gap_ms:
            groups[-1].append(span)
        else:
            groups.append([span])
        reach = max(reach, span[2])
    pieces = [p for g in groups for p in _split(g, max_ms, pad_ms)]

    cores = [(p[0][1], max(e for _, _, e in p)) for p in pieces]
    regions = []
    for n, (piece, (start, end)) in enumerate(zip(pieces, cores)):
        lo = start - pad_ms
        hi = end + pad_ms
        if n > 0:
            prev_end = cores[n - 1][1]
            lo = max(lo, (prev_end + start) // 2) if start >= prev_end else max(lo, start)
        if n + 1 < len(cores):
            next_start = cores[n + 1][0]
            hi = min(hi, (end + next_start) // 2) if next_start >= end else min(hi, end)
        regions.append(Region(max(0, lo), min(duration_ms, hi), [i for i, _, _ in piece]))
    return regions


_SENTENCE_END = re.compile(r"[.!?…:]\s*$")


def name_prompt_words(texts: list[str], *, min_count: int = PROMPT_MIN_COUNT,
                      max_names: int = PROMPT_MAX_NAMES) -> list[str]:
    """Capitalised words that recur in the middle of subtitle sentences: the names.

    A word counts when it starts with a capital letter, has at least one lower-case
    letter, and is not the first word of a sentence or of a dialogue dash (where any
    word is capitalised). Words seen at least `min_count` times are kept, most frequent
    first.
    """
    counts: Counter[str] = Counter()
    for text in texts:
        for raw_line in text.split("\n"):
            line = raw_line.lstrip()
            words = split_words(line)
            for n, (word, start, _) in enumerate(words):
                before = line[:start]
                initial = n == 0 or bool(_SENTENCE_END.search(before))
                if initial or not word[0].isupper() or not any(c.islower() for c in word):
                    continue
                if len(word) < 3 or "'" in word or "’" in word:
                    continue
                counts[word] += 1
    names = [w for w, c in counts.most_common() if c >= min_count]
    return names[:max_names]


def name_prompt(names: list[str]) -> str | None:
    return ", ".join(names) + "." if names else None


def episode_lines(conn: sqlite3.Connection, episode_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT idx, start_ms, end_ms, fr, is_song, fr_final FROM lines "
        "WHERE episode_id = ? ORDER BY idx", (episode_id,)).fetchall()


def episode_regions(conn: sqlite3.Connection, episode_id: str, duration_ms: int) -> list[Region]:
    rows = episode_lines(conn, episode_id)
    return build_regions([(r[0], r[1], r[2]) for r in rows], duration_ms)


# --- the model ---------------------------------------------------------------------------


def resolve_model(name: str | None = None) -> tuple[str, Path]:
    """(model name, local directory) of the Whisper model, without touching the network.

    `name` is a directory or a Hugging Face repo id; a repo id is looked up in the hub
    cache at the revision its `refs/main` names (falling back to any complete snapshot).
    """
    name = name or os.environ.get("FRENCHIRIX_ASR_MODEL") or MODEL
    if Path(name).is_dir():
        return name, Path(name)
    hub = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub"
    repo = hub / ("models--" + name.replace("/", "--"))
    snapshots = []
    ref = repo / "refs" / "main"
    if ref.exists():
        snapshots.append(repo / "snapshots" / ref.read_text().strip())
    snapshots += sorted((repo / "snapshots").glob("*")) if (repo / "snapshots").is_dir() else []
    for snap in snapshots:
        if (snap / "model.bin").exists() and (snap / "config.json").exists():
            return name, snap
    raise FileNotFoundError(f"Whisper model {name!r} is not in {hub}; download it first "
                            "(docs/transcription.md)")


def load_model(device: str | None = None):
    """The Whisper model: float16 on the GPU, int8 on the CPU. Loaded from disk only."""
    from frenchirix.asr_audio import check_gpu, preload_cuda_libraries

    name, path = resolve_model()

    device = device or check_gpu(GPU_NEED_MIB)
    if device == "cuda":
        preload_cuda_libraries()
    from faster_whisper import WhisperModel

    compute_type = "float16" if device == "cuda" else "int8"
    model = WhisperModel(str(path), device=device, compute_type=compute_type, local_files_only=True)
    return model, {"model": f"faster-whisper {name}", "model_path": str(path),
                   "device": device, "compute_type": compute_type}


# Whisper was trained on subtitled video and sometimes "hears" the credits of French
# subtitlers in short or quiet stretches. A segment matching this is dropped (and listed
# in meta). Seen on S01E04: "Sous-titrage Société Radio-Canada", "Sous-titrage ST' 501".
CREDIT_PATTERN = re.compile(
    r"sous[- ]?titr|radio[- ]?canada|amara\.org|\bST' ?501\b|abonnez[- ]vous", re.IGNORECASE)


def join_tokens(words: list[tuple[int, int, str, float]]) -> list[tuple[int, int, str, float]]:
    """Undo two quirks of Whisper's word splitting for French.

    A token with no letter or digit ("!", "?" after a French space) is attached to the
    word before it, as punctuation. A token starting with an apostrophe ("'est" after
    "c") is joined to the word before it when that word ends in a letter, giving
    "c'est"; the joined word spans both and keeps the lower probability.
    """
    out: list[tuple[int, int, str, float]] = []
    for s, e, text, p in words:
        if out and not any(c.isalnum() for c in text):
            ps, pe, pt, pp = out[-1]
            out[-1] = (ps, pe, f"{pt} {text}", pp)
        elif out and text[0] in "'’" and out[-1][2][-1:].isalpha():
            ps, pe, pt, pp = out[-1]
            out[-1] = (ps, max(pe, e), pt + text, min(pp, p))
        elif any(c.isalnum() for c in text):
            out.append((s, e, text, p))
    return out


def recognise(model, samples, offset_ms: int, *, prompt: str | None = None,
              options: dict | None = None,
              dropped: list | None = None) -> list[tuple[int, int, str, float]]:
    """Recognised words in `samples` (16 kHz mono), as (start_ms, end_ms, text, prob).

    Times are on the episode timeline: `offset_ms` is the time of the first sample.
    They are clamped to the audio given and made non-decreasing. Segments that match
    CREDIT_PATTERN are left out and appended to `dropped` as (start_ms, text).
    """
    from frenchirix.asr_audio import SAMPLE_RATE

    opts = dict(TRANSCRIBE_OPTIONS if options is None else options)
    segments, _ = model.transcribe(samples, initial_prompt=prompt, **opts)
    length_ms = len(samples) * 1000 // SAMPLE_RATE
    words, last = [], 0
    for seg in segments:
        if CREDIT_PATTERN.search(seg.text):
            if dropped is not None:
                dropped.append((offset_ms + round(seg.start * 1000), seg.text.strip()))
            continue
        seg_words = []
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            s = min(max(round(w.start * 1000), last), length_ms)
            e = min(max(round(w.end * 1000), s), length_ms)
            last = s
            seg_words.append((offset_ms + s, offset_ms + e, text, float(w.probability)))
        words += join_tokens(seg_words)
    return words


def _versions() -> dict:
    from importlib.metadata import PackageNotFoundError, version

    out = {}
    for pkg in ("faster-whisper", "ctranslate2"):
        try:
            out[pkg] = version(pkg)
        except PackageNotFoundError:
            pass
    return out


def transcribe_episode(conn: sqlite3.Connection, episode_id: str, *, force: bool = False) -> None:
    """Fill `asr_words` for an episode. Skips an episode that has rows unless `force`."""
    from frenchirix.asr_audio import CHANNEL_FILTER, SAMPLE_RATE, cut, episode_source, \
        load_centre_channel, release_gpu

    have = conn.execute("SELECT COUNT(*) FROM asr_words WHERE episode_id = ?",
                        (episode_id,)).fetchone()[0]
    if have and not force:
        print(f"{episode_id}: {have} recognised words already; use --force to redo")
        return
    source, stream, duration_ms = episode_source(conn, episode_id)
    rows = episode_lines(conn, episode_id)
    if not rows:
        raise ValueError(f"{episode_id} has no lines; import it first")
    regions = build_regions([(r[0], r[1], r[2]) for r in rows], duration_ms)
    names = name_prompt_words([r[3] for r in rows])
    prompt = name_prompt(names)

    t0 = time.monotonic()
    audio = load_centre_channel(source, stream)
    t_audio = time.monotonic() - t0
    model, runtime = load_model()
    t1 = time.monotonic()
    words: list[tuple[int, int, str, float]] = []
    dropped: list[tuple[int, str]] = []
    try:
        for n, region in enumerate(regions, 1):
            words += recognise(model, cut(audio, region.start_ms, region.end_ms),
                               region.start_ms, prompt=prompt, dropped=dropped)
            if n % 25 == 0:
                print(f"  {n}/{len(regions)} regions, {len(words)} words")
    finally:
        del model
        release_gpu()
    t_asr = time.monotonic() - t1

    params = {
        **_versions(),
        **runtime,
        "options": TRANSCRIBE_OPTIONS,
        "initial_prompt": prompt,
        "prompt_names": {"min_count": PROMPT_MIN_COUNT, "max_names": PROMPT_MAX_NAMES},
        "audio": {"stream": stream, "filter": CHANNEL_FILTER, "sample_rate": SAMPLE_RATE},
        "regions": {"merge_gap_ms": MERGE_GAP_MS, "pad_ms": PAD_MS, "max_ms": MAX_REGION_MS,
                    "count": len(regions),
                    "total_ms": sum(r.end_ms - r.start_ms for r in regions)},
        "postprocess": {"credit_pattern": CREDIT_PATTERN.pattern,
                        "dropped_segments": dropped,
                        "join_tokens": "punctuation-only tokens attached to the previous word; "
                                       "apostrophe-initial tokens joined to the previous word"},
        "seconds": {"decode_audio": round(t_audio, 1), "recognise": round(t_asr, 1)},
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    with conn:
        conn.execute("DELETE FROM asr_words WHERE episode_id = ?", (episode_id,))
        conn.executemany(
            "INSERT INTO asr_words (episode_id, idx, start_ms, end_ms, text, prob) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [(episode_id, i, s, e, t, round(p, 4)) for i, (s, e, t, p) in enumerate(words, 1)])
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                     (f"asr:{episode_id}", json.dumps(params, ensure_ascii=False)))
    print(f"{episode_id}: {len(words)} words from {len(regions)} regions "
          f"in {t_asr:.0f} s ({runtime['device']})")
