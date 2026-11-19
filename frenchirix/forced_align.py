"""Forced alignment of the final French text against the audio: timings for `words`.

Steps 10 and 11 of docs/runbook.md; the method and measured results are in
docs/transcription.md. (Pairing French subtitle lines with English ones is a different job, done in
`frenchirix/subtitle_align.py`.) Alignment runs region by region, with the same speech regions as transcription.
The text of a region is the `fr_final` of its annotated lines, in order, spelled in
the aligner's alphabet. Wildcard tokens (`*`, which matches any audio) stand for
everything the text does not cover: the start and end of the region, the boundary
between two lines, and lines that have no `fr_final` (lines in no scene). A word the
alphabet cannot spell ("49.3") becomes a wildcard of its own, so it still gets a time
span, with a NULL score.

The acoustic model is torchaudio's MMS_FA bundle (wav2vec2, trained by Meta for
forced alignment over 1,100+ languages; alphabet a-z and apostrophe). torch and
torchaudio come from the `asr` dependency group and are imported lazily; the text
handling and the mapping of aligner output back to words need nothing beyond the
standard library.
"""

from __future__ import annotations

import json
import sqlite3
import time
import unicodedata
from collections.abc import Callable
from dataclasses import asdict, dataclass

from frenchirix.text import split_words

STAR = "*"
# The MMS_FA dictionary without blank and star; checked against the bundle at load time.
ALPHABET = frozenset("abcdefghijklmnopqrstuvwxyz'")
GPU_NEED_MIB = 2500
CHECKPOINT_NAME = "mms_fa_ctc_alignment_mling_uroman.pt"  # in $TORCH_HOME/hub/checkpoints
_LIGATURES = {"œ": "oe", "æ": "ae", "ß": "ss", "’": "'", "ʼ": "'", "‘": "'"}


def spell(word: str, alphabet: frozenset[str] = ALPHABET) -> str | None:
    """`word` in the aligner's alphabet, or None when it cannot be spelled.

    Accents are dropped (é -> e, ç -> c), ligatures expanded, apostrophes kept,
    hyphens and other joiners removed. A word with a digit, or with nothing left
    after normalisation, cannot be spelled: digits are read aloud as words the
    text does not contain.
    """
    if any(c.isdigit() for c in word):
        return None
    text = "".join(_LIGATURES.get(c, c) for c in word.lower())
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    out = []
    for c in text:
        if c in alphabet:
            out.append(c)
        elif c.isalpha():
            return None  # a letter the aligner has no token for
    return "".join(out) or None


@dataclass
class LineText:
    """A line taking part in a region's alignment."""

    idx: int  # lines.idx
    words: list[str] | None  # words.text in order; None for a line with no final text


@dataclass
class Targets:
    tokens: list[str]  # characters of the alphabet and STAR
    ranges: dict[tuple[int, int], tuple[int, int]]  # (line idx, word idx) -> token [a, b)
    unspellable: set[tuple[int, int]]


def build_targets(lines: list[LineText], alphabet: frozenset[str] = ALPHABET) -> Targets:
    """The token sequence of a region and which tokens belong to which word.

    Word indices are 1-based, as in `words.idx`. Consecutive filler wildcards (region
    edges, line boundaries, lines without text) are merged into one; a wildcard that
    stands for an unspellable word is never merged, so the word keeps its own span.
    """
    tokens: list[str] = []
    ranges: dict[tuple[int, int], tuple[int, int]] = {}
    unspellable: set[tuple[int, int]] = set()
    filler_last = False

    def filler() -> None:
        nonlocal filler_last
        if not filler_last:
            tokens.append(STAR)
            filler_last = True

    filler()
    for line in lines:
        if line.words is None:
            filler()
            continue
        for n, word in enumerate(line.words, 1):
            spelled = spell(word, alphabet)
            a = len(tokens)
            if spelled is None:
                tokens.append(STAR)
                unspellable.add((line.idx, n))
            else:
                tokens.extend(spelled)
            ranges[(line.idx, n)] = (a, len(tokens))
            filler_last = False
        filler()
    return Targets(tokens, ranges, unspellable)


def min_frames(tokens: list[str]) -> int:
    """Frames a CTC alignment of `tokens` needs: one per token, one more per repeat."""
    return len(tokens) + sum(1 for a, b in zip(tokens, tokens[1:]) if a == b)


@dataclass
class WordTime:
    start_ms: int
    end_ms: int
    score: float | None


def word_times(targets: Targets, spans: list[tuple[int, int, float]], *, frame_ms: float,
               offset_ms: int) -> dict[tuple[int, int], WordTime]:
    """Map aligner output back to words.

    `spans[k]` is (start frame, end frame exclusive, mean probability) of target token
    k, as from torchaudio's `merge_tokens`. A word runs from the start of its first
    token to the end of its last; its score is the frame-weighted mean probability of
    its tokens, or None for an unspellable word. Times are on the episode timeline.
    Consecutive words never overlap and never go backwards.
    """
    if len(spans) != len(targets.tokens):
        raise ValueError(f"{len(spans)} token spans for {len(targets.tokens)} tokens")
    out: dict[tuple[int, int], WordTime] = {}
    last_end = None
    for key in sorted(targets.ranges, key=lambda k: targets.ranges[k][0]):
        a, b = targets.ranges[key]
        part = spans[a:b]
        start = offset_ms + round(part[0][0] * frame_ms)
        end = offset_ms + round(part[-1][1] * frame_ms)
        if last_end is not None and start < last_end:
            start = last_end
        end = max(end, start)
        if key in targets.unspellable:
            score = None
        else:
            frames = sum(e - s for s, e, _ in part)
            score = round(sum((e - s) * p for s, e, p in part) / frames, 4) if frames else None
        out[key] = WordTime(start, end, score)
        last_end = end
    return out


# --- the model ---------------------------------------------------------------------------


class Aligner:
    """MMS_FA with the wildcard token, on the GPU when there is room."""

    def __init__(self, device: str | None = None):
        import torch
        import torchaudio

        from frenchirix.asr_audio import SAMPLE_RATE, check_gpu

        self.torch = torch
        self.F = torchaudio.functional
        bundle = torchaudio.pipelines.MMS_FA
        if bundle.sample_rate != SAMPLE_RATE:
            raise RuntimeError(f"MMS_FA expects {bundle.sample_rate} Hz")
        self.device = device or check_gpu(GPU_NEED_MIB)
        # torch.hub would cache the weights as a bare "model.pt"; give them a telling name.
        self.model = bundle.get_model(with_star=True, dl_kwargs={"file_name": CHECKPOINT_NAME})
        self.model = self.model.to(self.device).eval()
        self.dictionary = bundle.get_dict(star=STAR)
        alphabet = frozenset(k for k in self.dictionary if k not in ("-", STAR))
        if not ALPHABET <= alphabet:
            raise RuntimeError(f"MMS_FA alphabet changed: {sorted(alphabet)}")
        self.blank = self.dictionary["-"]

    def emission(self, samples):
        """Log-probabilities per frame and the length of a frame in ms."""
        torch = self.torch
        with torch.inference_mode():
            wave = torch.from_numpy(samples).unsqueeze(0).to(self.device)
            emission, _ = self.model(wave)
        frame_ms = len(samples) / emission.shape[1] / 16  # 16 samples per ms
        return emission, frame_ms

    def align(self, emission, tokens: list[str]) -> list[tuple[int, int, float]]:
        torch = self.torch
        ids = torch.tensor([[self.dictionary[t] for t in tokens]], dtype=torch.int32,
                           device=emission.device)
        labels, scores = self.F.forced_align(emission, ids, blank=self.blank)
        spans = self.F.merge_tokens(labels[0], scores[0].exp())
        return [(s.start, s.end, float(s.score)) for s in spans]

    def close(self) -> None:
        from frenchirix.asr_audio import release_gpu

        del self.model
        release_gpu()


# --- the guard: a line is spoken near its subtitle ------------------------------------------


@dataclass(frozen=True)
class GuardSettings:
    """How far from its subtitle a line may be placed, and when a placement is trusted.

    A line's window is its subtitle time widened by `slack_ms` on each side: annotators
    restore words spoken up to about 2 s before the subtitle appears or after it goes.
    """

    slack_ms: int = 2500
    retry_below: float = 0.3  # a line in its window but with a lower mean score is re-aligned alone
    unreliable_below: float = 0.15  # a re-aligned line still below this is marked unreliable
    min_cut_ms: int = 200  # shortest audio worth re-aligning a line on


GUARD = GuardSettings()
UNRELIABLE_SCORE = 0.0  # every word of a line whose placement is only a guess


def line_window(start_ms: int, end_ms: int, slack_ms: int, duration_ms: int) -> tuple[int, int]:
    return max(0, start_ms - slack_ms), min(duration_ms, end_ms + slack_ms)


def mean_score(times: list[WordTime]) -> float | None:
    scores = [t.score for t in times if t.score is not None]
    return sum(scores) / len(scores) if scores else None


def inside(times: list[WordTime], lo: int, hi: int) -> bool:
    return bool(times) and lo <= times[0].start_ms and times[-1].end_ms <= hi


def even_times(n: int, lo: int, hi: int) -> list[WordTime]:
    """`n` words spread evenly over [lo, hi], all marked unreliable."""
    hi = max(hi, lo)
    edges = [lo + (hi - lo) * k // n for k in range(n + 1)]
    return [WordTime(edges[k], edges[k + 1], UNRELIABLE_SCORE) for k in range(n)]


def _rank(m: float | None) -> float:
    return 0.5 if m is None else m  # a line of only unspellable words has no score


def apply_guard(placed: dict[int, list[WordTime] | None], n_words: dict[int, int],
                windows: dict[int, tuple[int, int]], subtitles: dict[int, tuple[int, int]],
                todo: set[int],
                realign: Callable[[int, int, int], list[WordTime] | None],
                settings: GuardSettings = GUARD,
                confirm: Callable[[int, list[WordTime]], bool] | None = None,
                ) -> tuple[dict[int, list[WordTime]], dict[int, str]]:
    """Keep every line of `todo` inside its window; return final times and a status per line.

    `placed` holds each line's times from the region alignment (None when it has none);
    lines outside `todo` are fixed and only bound the others. A line of `todo` is
    accepted as placed when it lies in its window with a mean score of at least
    `retry_below`. Every other line is re-aligned alone, by `realign(line, lo, hi)`, on
    the part of its window between the accepted lines before and after it, and the
    better of the two placements that fit is kept. A line that still scores below
    `unreliable_below`, or could not be aligned at all, has no acoustic evidence: its
    words are spread evenly over its subtitle time (clipped to the free part of its
    window), every word scored UNRELIABLE_SCORE.

    `confirm(line, times)`, when given, can rescue a placement that scores below
    `unreliable_below`: it returns True when independent evidence (the recogniser's word
    times, see `recogniser_agrees`) puts every word where the aligner did.

    Statuses: "ok" (placed by the region alignment), "realigned" (placed alone),
    "kept" (re-aligned alone, but the region placement was better), "confirmed" (scored
    low, accepted because the recogniser agrees), "unreliable".
    """
    accepted: dict[int, list[WordTime]] = {}
    for i, t in placed.items():
        if not t:
            continue
        m = mean_score(t)
        if i not in todo or (inside(t, *windows[i]) and (m is None or m >= settings.retry_below)):
            accepted[i] = t
    status = {i: "ok" for i in accepted if i in todo}

    for i in sorted(todo - set(accepted)):
        win_lo, win_hi = windows[i]
        before = [accepted[j][-1].end_ms for j in accepted if j < i]
        after = [accepted[j][0].start_ms for j in accepted if j > i]
        lo = max(win_lo, max(before)) if before else win_lo
        hi = min(win_hi, min(after)) if after else win_hi
        candidates: list[tuple[str, list[WordTime]]] = []
        old = placed.get(i)
        if old and inside(old, lo, hi):
            candidates.append(("kept", old))
        if hi - lo >= settings.min_cut_ms:
            new = realign(i, lo, hi)
            if new and inside(new, lo, hi):
                candidates.append(("realigned", new))
        if candidates:
            label, best = max(candidates, key=lambda c: _rank(mean_score(c[1])))
            m = mean_score(best)
            if m is not None and m < settings.unreliable_below:
                label = "confirmed" if confirm is not None and confirm(i, best) else "unreliable"
        else:
            label = "unreliable"
        if label == "unreliable":
            free_lo, free_hi = (lo, hi) if lo < hi else (win_lo, win_hi)
            a = min(max(subtitles[i][0], free_lo), free_hi)
            b = min(max(subtitles[i][1], a), free_hi)
            best = even_times(n_words[i], a, b)
        accepted[i] = best
        status[i] = label
    return {i: accepted[i] for i in todo if i in accepted}, status


# The recogniser confirms a placement when it hears every word of the line, in order, each
# with probability >= CONFIRM_MIN_PROB, and the word starts agree: median difference at most
# CONFIRM_MEDIAN_MS, at least CONFIRM_SHARE of the words within CONFIRM_TOLERANCE_MS, none
# beyond CONFIRM_MAX_MS. Not "every word within 100 ms": Whisper's timestamp for the first
# word after a pause is often early by up to a second (S01E03 line 24: "On" +986 ms while
# the other words agree within 50-130 ms), and a short function word can be off by ~300 ms.
CONFIRM_TOLERANCE_MS = 150
CONFIRM_MEDIAN_MS = 100
CONFIRM_SHARE = 0.75
CONFIRM_MAX_MS = 1000
CONFIRM_MIN_PROB = 0.5


def _norm(word: str) -> str:
    return spell(word.strip(" .,;:!?…\"«»()-")) or word.lower()


def recogniser_agrees(words: list[str], times: list[WordTime],
                      heard: list[tuple[int, int, str, float]],
                      tolerance_ms: int = CONFIRM_TOLERANCE_MS,
                      min_prob: float = CONFIRM_MIN_PROB) -> tuple[bool, str]:
    """Do the recogniser's words (start, end, text, prob), heard with the line's own text
    as prompt, confirm an aligned placement? Every word of the line must be heard as a
    contiguous run, in order, each with probability at least `min_prob`, and the starts
    must agree (see the CONFIRM_* constants). Returns (verdict, detail)."""
    lo = times[0].start_ms - 1000
    hi = times[-1].end_ms + 1000
    cand = [h for h in heard if lo <= h[0] <= hi]
    a = [_norm(w) for w in words]
    b = [_norm(h[2]) for h in cand]
    k = 0
    for j, h in enumerate(b):  # the line's words must be a contiguous run of what was heard
        if b[j:j + len(a)] == a:
            k = j
            break
    else:
        return False, f"heard {' '.join(b)!r}, not the line's words in order"
    deltas = [abs(t.start_ms - cand[k + n][0]) for n, t in enumerate(times)]
    probs = [cand[k + n][3] for n in range(len(a))]
    deltas_sorted = sorted(deltas)
    median = deltas_sorted[len(deltas) // 2] if len(deltas) % 2 else \
        (deltas_sorted[len(deltas) // 2 - 1] + deltas_sorted[len(deltas) // 2]) / 2
    share = sum(d <= tolerance_ms for d in deltas) / len(deltas)
    detail = (f"median |Δstart| {median:.0f} ms, {share:.0%} within {tolerance_ms} ms, "
              f"max {max(deltas)} ms, min prob {min(probs):.2f}; "
              + " ".join(f"{w}{d:+d}" for w, d in zip(a, (t.start_ms - cand[k + n][0] for n, t in enumerate(times)))))
    ok = (median <= CONFIRM_MEDIAN_MS and share >= CONFIRM_SHARE and max(deltas) <= CONFIRM_MAX_MS
          and min(probs) >= min_prob)
    return ok, detail


def _final_lines(conn: sqlite3.Connection, episode_id: str) -> dict[int, tuple[str, list[sqlite3.Row], int, int]]:
    """Lines with final text and words: idx -> (line id, word rows, subtitle start, end).

    Word rows are (idx, text, start_ms, end_ms, score), in order.
    """
    out = {}
    rows = conn.execute(
        "SELECT l.idx, l.id, l.fr_final, l.start_ms, l.end_ms FROM lines l WHERE l.episode_id = ? "
        "AND l.fr_final IS NOT NULL AND EXISTS (SELECT 1 FROM words w WHERE w.line_id = l.id) "
        "ORDER BY l.idx", (episode_id,)).fetchall()
    for idx, line_id, fr_final, start_ms, end_ms in rows:
        words = conn.execute("SELECT idx, text, start_ms, end_ms, score FROM words "
                             "WHERE line_id = ? ORDER BY idx", (line_id,)).fetchall()
        expected = [w for w, _, _ in split_words(fr_final)]
        if [w[1] for w in words] != expected or [w[0] for w in words] != list(range(1, len(words) + 1)):
            print(f"warning: {line_id}: words rows do not match split_words(fr_final); skipped")
            continue
        out[idx] = (line_id, words, start_ms, end_ms)
    return out


def align_episode(conn: sqlite3.Connection, episode_id: str, *, force: bool = False,
                  guard: GuardSettings = GUARD, lines: set[int] | None = None,
                  dry_run: bool = False, confirm: bool = False,
                  ) -> dict[int, tuple[str, list[WordTime]]] | None:
    """Time the words of every annotated line of an episode by forced alignment.

    Lines whose words all have times are skipped unless `force`. Sets `words.start_ms`,
    `end_ms`, `score` and `lines.audio_start_ms`, `audio_end_ms`. Every line ends up
    inside its subtitle window (see `apply_guard`).

    `lines` (lines.idx) re-aligns exactly those lines, timed or not; every other line
    keeps its stored times and bounds them. With a guard of small `slack_ms` this keeps a
    line from sliding to another occurrence of the same words (a song's refrain).
    `dry_run` returns {idx: (status, times)} and writes nothing.

    `confirm` lets the recogniser rescue a low-scoring placement: Whisper listens to the
    line's whole region with the line's own text as prompt, and the placement is kept
    ("confirmed") when `recogniser_agrees`. Each verdict is recorded in `meta`.
    """
    from frenchirix.asr_audio import CHANNEL_FILTER, cut, episode_source, load_centre_channel
    from frenchirix.transcribe import MAX_REGION_MS, MERGE_GAP_MS, PAD_MS, episode_regions

    only = set(lines) if lines is not None else None  # `lines` is reused below for region text
    final = _final_lines(conn, episode_id)
    if only is not None:
        missing = sorted(only - set(final))
        if missing:
            raise ValueError(f"{episode_id}: lines without final text or words: {missing}")
        todo = set(only)
    else:
        todo = {i for i, (_, words, _, _) in final.items()
                if force or any(w[2] is None for w in words)}
    if not todo:
        print(f"{episode_id}: {len(final)} annotated lines, none to align")
        return
    source, stream, duration_ms = episode_source(conn, episode_id)
    regions = [r for r in episode_regions(conn, episode_id, duration_ms)
               if any(i in todo for i in r.lines)]
    windows = {i: line_window(f[2], f[3], guard.slack_ms, duration_ms) for i, f in final.items()}
    texts = {i: [w[1] for w in f[1]] for i, f in final.items()}

    # Lines not to touch keep their stored times; they bound the others.
    placed: dict[int, list[WordTime] | None] = {}
    for i, (_, words, _, _) in final.items():
        if i not in todo and all(w[2] is not None for w in words):
            placed[i] = [WordTime(w[2], w[3], w[4]) for w in words]

    t0 = time.monotonic()
    audio = load_centre_channel(source, stream)
    aligner = Aligner()
    t1 = time.monotonic()
    failed: list[str] = []

    def align_alone(i: int, lo: int, hi: int) -> list[WordTime] | None:
        targets = build_targets([LineText(i, texts[i])])
        emission, frame_ms = aligner.emission(cut(audio, lo, hi))
        if emission.shape[1] < min_frames(targets.tokens):
            return None
        times = word_times(targets, aligner.align(emission, targets.tokens),
                           frame_ms=frame_ms, offset_ms=lo)
        return [WordTime(min(t.start_ms, hi), min(t.end_ms, hi), t.score)
                for t in (times[(i, n)] for n in range(1, len(texts[i]) + 1))]

    whisper = None
    confirmations: dict[int, str] = {}

    def confirm_line(i: int, times: list[WordTime]) -> bool:
        nonlocal whisper
        from frenchirix.transcribe import load_model, recognise

        if whisper is None:
            whisper = load_model()[0]
        region = next(r for r in regions if i in r.lines)
        fr = conn.execute("SELECT fr_final FROM lines WHERE id = ?", (final[i][0],)).fetchone()[0]
        prompt = " ".join(fr.split())
        heard = recognise(whisper, cut(audio, region.start_ms, region.end_ms), region.start_ms,
                          prompt=prompt)
        ok, detail = recogniser_agrees(texts[i], times, heard)
        confirmations[i] = ("accepted: " if ok else "rejected: ") + detail
        return ok

    try:
        for region in regions:
            lines = [LineText(i, texts.get(i)) for i in region.lines]
            targets = build_targets(lines)
            emission, frame_ms = aligner.emission(cut(audio, region.start_ms, region.end_ms))
            if emission.shape[1] < min_frames(targets.tokens):
                failed.append(f"{region.start_ms}-{region.end_ms} ms: text too long for the audio")
                continue
            spans = aligner.align(emission, targets.tokens)
            times = word_times(targets, spans, frame_ms=frame_ms, offset_ms=region.start_ms)
            for i in region.lines:
                if i in todo:
                    placed[i] = [times[(i, n)] for n in range(1, len(texts[i]) + 1)]
        results, status = apply_guard(placed, {i: len(t) for i, t in texts.items()}, windows,
                                      {i: (f[2], f[3]) for i, f in final.items()}, todo,
                                      align_alone, guard, confirm_line if confirm else None)
    finally:
        aligner.close()
        if whisper is not None:
            whisper = None
            from frenchirix.asr_audio import release_gpu
            release_gpu()
    t_align = time.monotonic() - t1

    by_status: dict[str, list[int]] = {}
    for i, st in sorted(status.items()):
        by_status.setdefault(st, []).append(i)
    for i, d in sorted(confirmations.items()):
        print(f"  confirm line {i}: {d}")
    if dry_run:
        return {i: (status[i], results[i]) for i in results}
    meta_key = f"align:{episode_id}"
    old_meta = conn.execute("SELECT value FROM meta WHERE key = ?", (meta_key,)).fetchone()
    with conn:
        for line_idx, times in results.items():
            line_id = final[line_idx][0]
            conn.executemany(
                "UPDATE words SET start_ms = ?, end_ms = ?, score = ? WHERE line_id = ? AND idx = ?",
                [(t.start_ms, t.end_ms, t.score, line_id, n) for n, t in enumerate(times, 1)])
            conn.execute("UPDATE lines SET audio_start_ms = ?, audio_end_ms = ? WHERE id = ?",
                         (times[0].start_ms, times[-1].end_ms, line_id))
        run = {
            "model": "torchaudio MMS_FA (with star)",
            "torchaudio": _version("torchaudio"), "torch": _version("torch"),
            "device": aligner.device,
            "audio": {"stream": stream, "filter": CHANNEL_FILTER},
            "regions": {"merge_gap_ms": MERGE_GAP_MS, "pad_ms": PAD_MS, "max_ms": MAX_REGION_MS},
            "wildcards": "region edges, line boundaries, lines without fr_final, unspellable words",
            "guard": {**asdict(guard), "unreliable_score": UNRELIABLE_SCORE,
                      "lines": {k: v for k, v in by_status.items() if k != "ok"}},
            "lines_aligned": len(results),
            **({"confirm": {"rule": "recogniser_agrees", "tolerance_ms": CONFIRM_TOLERANCE_MS,
                            "median_ms": CONFIRM_MEDIAN_MS, "share": CONFIRM_SHARE,
                            "max_ms": CONFIRM_MAX_MS, "min_prob": CONFIRM_MIN_PROB,
                            "lines": {str(k): v for k, v in sorted(confirmations.items())}}}
               if confirm else {}),
            "seconds": {"decode_audio": round(t1 - t0, 1), "align": round(t_align, 1)},
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        if only is not None and old_meta:
            # a partial run: the episode's full run stays the record, this one is added to it
            meta = json.loads(old_meta[0])
            meta.setdefault("line_runs", []).append({**run, "lines": sorted(only)})
        else:
            meta = run
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (meta_key, json.dumps(meta)))
    for f in failed:
        print(f"warning: region {f}; its lines were aligned alone")
    summary = ", ".join(f"{k} {len(v)}" for k, v in sorted(by_status.items()))
    print(f"{episode_id}: aligned {len(results)} lines in {len(regions)} regions "
          f"in {t_align:.1f} s ({aligner.device}): {summary}")
    for k in ("realigned", "kept", "confirmed", "unreliable"):
        if by_status.get(k):
            print(f"  {k}: lines {', '.join(map(str, by_status[k]))}")


def _version(pkg: str) -> str | None:
    from importlib.metadata import PackageNotFoundError, version

    try:
        return version(pkg)
    except PackageNotFoundError:
        return None
