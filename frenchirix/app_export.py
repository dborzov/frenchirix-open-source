"""`export-app`: the content bundle the Frenchirix 2.0 app reads, and the question sheets.

The output contract (paths and TypeScript types) is the "Content bundle" section of
docs/app-architecture.md; the choices and measured results are in docs/app-export.md.

The database is opened read-only: the export never writes to it. Scene audio reuses
the cut, downmix, gain and fades of frenchirix.render, then evens out loudness with one
static gain per clip (plus an oversampled lookahead limiter only where that gain would
push the true peak over the ceiling) and encodes AAC-LC in .m4a. Frames are WebP stills.

Runtime dependencies: the standard library, plus ffmpeg and ffprobe for media.
`--data-only` needs neither ffmpeg nor content/.
"""

from __future__ import annotations

import bisect
import difflib
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import statistics
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path

from frenchirix import render
from frenchirix.db import DB_PATH, REPO_ROOT
from frenchirix.text import split_words

EXPORT_VERSION = 1
APP_DIR = REPO_ROOT / "app"
DEFAULT_OUT = APP_DIR / "public"
QUESTIONS_DIR = APP_DIR / "data" / "questions"
SONGS_FILE = APP_DIR / "data" / "songs.json"
# The app's recorded sound effects (/media/sfx/<name>), copied from here when present. They are not
# part of the repository; without them the app plays no sound for a right or wrong answer or a win.
SFX_DIR = REPO_ROOT / "assets" / "sfx"
SFX_FILES = ("right.mp3", "wrong.mp3", "win.mp3")
MANIFEST_NAME = ".export-manifest.json"
RELEASE_FILE = APP_DIR / "data" / "release.json"
# Every media file is made here, outside app/public, and only what the release names is
# linked into app/public/media: the build (vite copies app/public into dist/) and the deploy
# then carry the released scenes only. work/ is git-ignored and on the same filesystem.
MEDIA_CACHE = REPO_ROOT / "work" / "app-media"
MEDIA_KINDS = ("a", "f", "s", "sf", "sfx", "q")


def media_cache_for(out_dir: Path) -> Path:
    if out_dir.resolve() == DEFAULT_OUT.resolve():
        return MEDIA_CACHE
    return out_dir.parent / f"{out_dir.name}-media-cache"


def load_release() -> dict | None:
    if not RELEASE_FILE.is_file():
        return None
    return json.loads(RELEASE_FILE.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class AppSettings:
    """Every tunable setting of the app export. See docs/app-export.md."""

    # Loudness
    target_lufs: float = -16.0         # integrated loudness of every clip
    ceiling_dbtp: float = -1.5         # true peak of the encoded file must stay at or below this
    limiter_margin_db: float = 0.5     # the limiter aims this far under the ceiling (AAC overshoot)
    max_limit_db: float = 6.0          # at most this much peak reduction; beyond it the clip stays quieter
    limiter_attack_ms: float = 5.0     # lookahead
    limiter_release_ms: float = 80.0
    limiter_oversample: int = 4        # the limiter runs at 4x the sample rate, so it sees true peaks
    max_encode_passes: int = 6

    # Scene and song audio
    audio_codec: str = "aac"           # ffmpeg's native AAC-LC encoder (libfdk_aac is not built in)
    audio_bitrate: str = "160k"
    # Perceptual noise substitution and intensity stereo replace parts of the signal with
    # synthesised noise and a shared channel; off, the encoded true peak stays within
    # about 0.5 dB of the input instead of overshooting by up to 2.6 dB, and nothing of
    # the source is swapped for an approximation. docs/app-export.md.
    audio_pns: int = 0
    audio_is: int = 0

    # Frames
    frame_height: int = 400
    webp_quality: int = 55
    webp_compression: int = 6

    # Units
    loop_margin_ms: int = 80           # a unit's loop window is widened by up to this on each side

    # Bank of distractors
    bank_lines: int = 150
    bank_units: int = 300
    bank_line_words: tuple[int, int] = (2, 8)


SETTINGS = AppSettings()


# ---------------------------------------------------------------------------
# Pure helpers (tested in tests/test_app_export.py)


def norm_text(s: str) -> str:
    """Lower case, typographic apostrophes straightened, spaces collapsed, edge punctuation off."""
    s = s.lower().replace("\u2019", "'").replace("\u2018", "'").replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip(" .,;:!?…\"'«»()[]-–—*")


# The key rule. An expression is key unless every word in it is one of these: articles,
# bare pronouns, short interjections and fillers, bare conjunctions, and auxiliary forms
# of être and avoir. Elided forms count as their parts ("c'est" = c' + est).
STOP_WORDS = frozenset("""
le la les l' un une des du de d' au aux
je j' tu il elle on nous vous ils elles me m' te t' se s' moi toi lui leur eux
ça ca ce c' cela ceci y en qui qu' que
oh ah eh hé he hein euh heu bah ben bon mmh mh hm hmm ouais oui non ouh aïe ha hi ho
pff tss ouf hop bof wouah waouh là la-la oh-oh
et ou mais donc alors
est es suis sont sommes êtes ai as a avons avez ont était étais avait avais été eu
""".split())


def _word_atoms(word: str) -> list[str]:
    """'c'est' -> ["c'", 'est']: elided words count as their parts."""
    w = norm_text(word)
    parts = []
    while True:
        m = re.match(r"^([a-zà-ÿ]{1,3}')(.+)$", w)
        if not m:
            break
        parts.append(m.group(1))
        w = m.group(2)
    if w:
        parts.append(w)
    return parts


def is_key(kind: str, words: list[str]) -> bool:
    """Does a unit carry meaning? Every 'word' unit does; an expression unless it is only stop words."""
    if kind == "word":
        return True
    atoms = [a for w in words for a in _word_atoms(w)]
    return not atoms or not all(a in STOP_WORDS for a in atoms)


def unit_char_span(words: list[dict], first_idx: int, last_idx: int) -> tuple[int, int]:
    """Character span in the line's French from a unit's first and last word (words.idx, 1-based)."""
    by_idx = {w["idx"]: w for w in words}
    return by_idx[first_idx]["char_start"], by_idx[last_idx]["char_end"]


def loop_window(start: int, end: int, prev_end: int | None, next_start: int | None,
                duration: int, margin: int) -> tuple[int, int]:
    """A unit's loop window: its words' span widened by up to `margin` on each side,
    never into a neighbouring word (only into the gap) and never outside the audio."""
    lo = start - margin
    if prev_end is not None:
        lo = max(lo, min(prev_end, start))
    hi = end + margin
    if next_start is not None:
        hi = min(hi, max(next_start, end))
    return max(0, lo), min(duration, hi)


def neighbours(spans: list[tuple[int, int]], start: int, end: int,
               own: set[int]) -> tuple[int | None, int | None]:
    """Nearest word end at or before `start` and nearest word start at or after `end`,
    among `spans` (index-addressed) not in `own`."""
    prev_end = max((e for i, (s, e) in enumerate(spans) if i not in own and e <= start),
                   default=None)
    next_start = min((s for i, (s, e) in enumerate(spans) if i not in own and s >= end),
                     default=None)
    return prev_end, next_start


def difficulty_buckets(scores: dict[str, float], cuts=(0.10, 0.35, 0.65, 0.90)) -> dict[str, int]:
    """Difficulty score per scene -> difficulty 1-5 by rank: 10/25/30/25/10 % of scenes."""
    ordered = sorted(scores, key=lambda k: (scores[k], k))
    n = len(ordered)
    out = {}
    for rank, sid in enumerate(ordered):
        q = (rank + 0.5) / n
        out[sid] = 1 + sum(q > c for c in cuts)
    return out


def plan_gain(lufs: float | None, peak: float | None,
              s: AppSettings = SETTINGS) -> tuple[float, float | None]:
    """(static gain in dB, limiter ceiling in dBTP or None) for a clip measured at
    `lufs` integrated and `peak` true peak. The limiter is used only where the gain
    alone would put the true peak above the ceiling, and it never takes off more
    than `max_limit_db`: past that, the clip stays below the target instead."""
    if lufs is None:
        return 0.0, None
    gain = s.target_lufs - lufs
    if peak is None:
        return gain, None
    aim = s.ceiling_dbtp - s.limiter_margin_db
    excess = peak + gain - aim
    if excess <= 0:
        return gain, None
    if excess > s.max_limit_db:
        gain -= excess - s.max_limit_db
    return gain, aim


def spread_times(words: list[str], start: int, end: int) -> list[tuple[int, int]]:
    """Fallback word timings: `start`..`end` shared out by word length (a syllable proxy)."""
    weights = [max(1, len(w)) for w in words]
    total = sum(weights)
    out, acc = [], 0
    for w in weights:
        a = start + round((end - start) * acc / total)
        acc += w
        b = start + round((end - start) * acc / total)
        out.append((a, b))
    return out


VOICES = ("squeaky", "deep", "wobble", "echo")


def assign_voices(scenes_json: dict[str, dict]) -> None:
    """The funny voice of each question: the four in turn over all questions in id order
    (scene id, then question number), so they are used equally and neighbouring
    questions sound different. Deterministic; adding a question shifts later ones."""
    i = 0
    for sid in sorted(scenes_json):
        for q in scenes_json[sid]["questions"]:
            q["voice"] = VOICES[i % len(VOICES)]
            i += 1


def tile_units(sentence: str, pieces) -> tuple[list[dict] | None, list[str]]:
    """GlossUnits for `sentence` from its [[French piece, English], ...], or None with the
    problems when the pieces do not tile it: each piece found at or after the end of the
    previous one, only spaces and punctuation between and around them, every letter and
    digit covered, every English non-empty. (Counts of units and words per piece are the
    checker's business, not a reason to drop the units.)"""
    problems: list[str] = []
    if not isinstance(pieces, list) or not pieces:
        return None, ["no units"]
    units, pos = [], 0
    for item in pieces:
        if (not isinstance(item, list) or len(item) != 2
                or not all(isinstance(x, str) for x in item)):
            return None, [f"unit {item!r} is not a [French, English] pair"]
        fr, en = item
        if not fr.strip():
            return None, ["empty French piece"]
        i = sentence.find(fr, pos)
        if i < 0:
            return None, [f"{fr!r} not found after position {pos}"]
        if re.search(r"\w", sentence[pos:i]):
            problems.append(f"{sentence[pos:i].strip()!r} before {fr!r} is not covered")
        if not en.strip():
            problems.append(f"{fr!r} has no English")
        units.append({"fr": fr, "en": en.strip(), "cs": i, "ce": i + len(fr)})
        pos = i + len(fr)
    if re.search(r"\w", sentence[pos:]):
        problems.append(f"{sentence[pos:].strip()!r} at the end is not covered")
    return (None if problems else units), problems


def clip_name(text: str) -> str:
    """Pre-generated question audio for a sentence: first 16 hex digits of the SHA-1 of the
    exact sentence (UTF-8). Fixed rule shared with the speech generator (docs/app-tts.md)."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16] + ".m4a"


def clip_path(text: str, media_root: Path | None) -> str | None:
    """'/media/q/<hash>.m4a' when that clip exists and is not empty under media_root."""
    if media_root is None:
        return None
    p = media_root / "q" / clip_name(text)
    try:
        return f"/media/q/{p.name}" if p.stat().st_size > 0 else None
    except OSError:
        return None


@dataclass
class QuestionStats:
    audio: set[str] = field(default_factory=set)            # sentences with a clip
    sentences: set[str] = field(default_factory=set)
    with_units: set[str] = field(default_factory=set)
    fallbacks: dict[str, str] = field(default_factory=dict)  # sentence -> why


def gloss(sentence: str, en: str, units_map: dict, st: QuestionStats) -> list[dict]:
    st.sentences.add(sentence)
    if sentence in units_map:
        units, problems = tile_units(sentence, units_map[sentence])
        if units:
            st.with_units.add(sentence)
            return units
        st.fallbacks[sentence] = "; ".join(problems)
    else:
        st.fallbacks[sentence] = "no units"
    m = list(re.finditer(r"\w", sentence))
    cs, ce = (m[0].start(), m[-1].end()) if m else (0, len(sentence))
    return [{"fr": sentence[cs:ce], "en": en, "cs": cs, "ce": ce}]


def merge_questions(scene_id: str, entry: dict | None, units_map: dict | None = None,
                    st: QuestionStats | None = None,
                    media_root: Path | None = None) -> tuple[list, str | None, int | None]:
    """Questions, French title and difficulty of one scene from its questions-file entry, with
    the units of every sentence from the episode's units file (one whole-sentence unit
    when a sentence has none or its units do not tile it)."""
    if not entry:
        return [], None, None
    units_map = units_map or {}
    st = st if st is not None else QuestionStats()
    qs = []
    for n, q in enumerate(entry.get("questions") or [], start=1):
        qid = f"{scene_id}:q{n}"
        out = {"id": qid}
        if q.get("line"):
            out["lineId"] = q["line"]
        out["fr"] = q["fr"]
        out["en"] = q["en"]
        out["units"] = gloss(q["fr"], q["en"], units_map, st)

        def with_audio(doc: dict, text: str) -> dict:
            clip = clip_path(text, media_root)
            if clip:
                doc["audio"] = clip
                st.audio.add(text)
            return doc

        with_audio(out, q["fr"])
        out["answers"] = [with_audio({"fr": a["fr"], "en": a["en"], "correct": bool(a["correct"]),
                                      "units": gloss(a["fr"], a["en"], units_map, st)}, a["fr"])
                          for a in q["answers"]]
        out["voice"] = VOICES[0]  # set over all scenes by assign_voices
        qs.append(out)
    difficulty = entry.get("difficulty")
    return qs, entry.get("title_fr") or None, int(difficulty) if difficulty else None


def stratified_sample(items: list[tuple[str, str, dict]], n: int) -> list[dict]:
    """Deterministic sample of `n` items spread across groups.
    items: (group, stable key, payload). Within a group, order is by hash of the key;
    groups are taken round-robin."""
    groups: dict[str, list] = {}
    for g, k, p in items:
        groups.setdefault(g, []).append((hashlib.sha1(k.encode()).hexdigest(), p))
    queues = [sorted(v, key=lambda x: x[0]) for _, v in sorted(groups.items())]
    out = []
    i = 0
    while len(out) < n and any(queues):
        q = queues[i % len(queues)]
        if q:
            out.append(q.pop(0)[1])
        i += 1
    return out


SONG_SCORE = 5           # "song scenes count as top-quality" (docs/intent.md, "Choosing new scenes")
SONG_MAX_DIFFICULTY = 2  # the user considers songs easier


def song_scene_values(kind: str, score: int, difficulty: int) -> tuple[int, int]:
    """(score, difficulty) as exported: every song scene is 5 and at most difficulty 2, whatever the
    database or the questions file says."""
    if kind == "song":
        return SONG_SCORE, min(difficulty, SONG_MAX_DIFFICULTY)
    return score, difficulty


def song_of(episode: str, first_idx: int, last_idx: int,
            ranges: list[tuple[str, str, int, int]]) -> str | None:
    """The song whose line range holds every line of a scene. ranges: (song id, episode,
    first line idx, last line idx)."""
    for sid, ep, a, b in ranges:
        if ep == episode and a <= first_idx and last_idx <= b:
            return sid
    return None


# Thumbnail choice. Frame statistics are (mean luma, luma standard deviation, mean chroma),
# each 0-255, measured on a 64x36 RGB decode of the WebP.
THUMB_MIN_LUMA = 32     # darker on average is a near-black frame (night, fade)
THUMB_MAX_LUMA = 225    # brighter is a near-white frame (flash, fade to white)
THUMB_MIN_STD = 14      # flatter is a near-uniform frame (title card, sky, fade)


def frame_ok(st: list[float]) -> bool:
    mean, std, _ = st
    return THUMB_MIN_LUMA <= mean <= THUMB_MAX_LUMA and std >= THUMB_MIN_STD


def frame_score(st: list[float]) -> float:
    """How recognisable a frame is: contrast and colour, with a penalty for extreme brightness."""
    mean, std, chroma = st
    return std + 0.5 * chroma + 0.25 * min(mean, 255 - mean)


def choose_thumb(times: list[int], duration: int, stats: list[list[float]] | None) -> int:
    """Index of the scene's thumbnail: among frames that are neither near-black, near-white
    nor near-uniform, the one closest to the middle of the clip (ties: the better scored);
    when none qualifies, the best scored; without statistics, the middle frame (the one on
    screen at mid-clip, as before)."""
    if not stats or len(stats) != len(times):
        return thumb_index(times, duration)
    mid = thumb_index(times, duration)
    good = [i for i, st in enumerate(stats) if frame_ok(st)]
    if good:
        return min(good, key=lambda i: (abs(i - mid), -frame_score(stats[i])))
    return max(range(len(times)), key=lambda i: frame_score(stats[i]))


def thumb_index(times: list[int], duration: int) -> int:
    """The frame on screen at the middle of the clip."""
    mid = duration / 2
    return max(i for i, t in enumerate(times) if t <= mid)


# ---------------------------------------------------------------------------
# Reading the database


def connect_readonly(path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


@dataclass
class Data:
    episodes: dict[str, dict]
    scenes: list[dict]
    lines: dict[str, dict]                 # line id -> row
    lines_by_ep: dict[str, dict[int, str]]  # episode -> idx -> line id
    words: dict[str, list[dict]]
    units: dict[str, list[dict]]
    translations: dict[tuple[str, int], str]
    notes: dict[str, list[dict]]
    asr: dict[str, list[tuple[int, int, str]]] = field(default_factory=dict)  # episode -> (start, end, text)


def load(conn: sqlite3.Connection) -> Data:
    eps = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM episodes ORDER BY id")}
    scenes = [dict(r) for r in conn.execute(
        "SELECT * FROM scenes ORDER BY id")]
    lines, by_ep = {}, {}
    for r in conn.execute("SELECT * FROM lines ORDER BY episode_id, idx"):
        lines[r["id"]] = dict(r)
        by_ep.setdefault(r["episode_id"], {})[r["idx"]] = r["id"]
    words: dict[str, list[dict]] = {}
    for r in conn.execute("SELECT * FROM words ORDER BY line_id, idx"):
        words.setdefault(r["line_id"], []).append(dict(r))
    units: dict[str, list[dict]] = {}
    for r in conn.execute("SELECT * FROM units ORDER BY line_id, idx"):
        units.setdefault(r["line_id"], []).append(dict(r))
    tr = {(r["episode_id"], r["group_idx"]): r["text"] for r in conn.execute(
        "SELECT episode_id, group_idx, text FROM translations WHERE lang = 'en'")}
    notes: dict[str, list[dict]] = {}
    for r in conn.execute("SELECT * FROM notes ORDER BY scene_id, idx"):
        notes.setdefault(r["scene_id"], []).append(dict(r))
    asr: dict[str, list[tuple[int, int, str]]] = {}
    for r in conn.execute("SELECT episode_id, start_ms, end_ms, text FROM asr_words ORDER BY episode_id, start_ms, idx"):
        asr.setdefault(r[0], []).append((r[1], r[2], r[3]))
    return Data(eps, scenes, lines, by_ep, words, units, tr, notes, asr)


def scene_line_ids(data: Data, episode: str, first: int, last: int) -> list[str]:
    m = data.lines_by_ep[episode]
    return [m[i] for i in range(first, last + 1) if i in m]


def line_en(data: Data, line: dict) -> str:
    if line["en_literal"]:
        return line["en_literal"]
    return data.translations.get((line["episode_id"], line["group_idx"]), "") or ""


# ---------------------------------------------------------------------------
# Building the JSON


@dataclass
class Report:
    warnings: list[str] = field(default_factory=list)
    timing: dict[str, tuple[str, str]] = field(default_factory=dict)  # line id -> (source, why)
    timing_scenes: dict[str, set[str]] = field(default_factory=dict)  # line id -> scenes/songs
    key_examples: dict[bool, list[str]] = field(default_factory=lambda: {True: [], False: []})
    key_count: int = 0
    unit_count: int = 0
    clamped: int = 0
    seen_units: set[str] = field(default_factory=set)
    questions: QuestionStats = field(default_factory=lambda: QuestionStats())
    alternates: QuestionStats = field(default_factory=lambda: QuestionStats())
    song_scenes: dict[str, list[str]] = field(default_factory=dict)
    thumbs: dict[str, int] = field(default_factory=lambda: {"with_stats": 0, "changed": 0, "dark_middle": 0})
    thumb_all_bad: list[str] = field(default_factory=list)
    orphan_song_scenes: list[str] = field(default_factory=list)


DRIFT_MS = 1000         # an aligned line this far from its subtitle at either end is suspect
ASR_PAD_MS = 1500       # recogniser words searched this far around the subtitle (or the alignment)
ASR_AGREE_MS = 400      # alignment confirmed when matched words start within this of the recogniser's
ASR_MIN_SHARE = 0.6     # a recogniser match is confident when it covers this share of the words
ALIGN_TRUST = 0.45      # a drifted line without recogniser evidence keeps its alignment when the
                        # aligner's mean word score is at least this


def _asr_match(texts: list[str], asr: list[tuple[int, int, str]], lo: int, hi: int):
    """Match a line's words against the recogniser's words between lo and hi (episode ms).
    Returns {word index: (start, end)} when the match is confident, else None."""
    i = bisect.bisect_left(asr, (lo,))
    cand = []
    while i < len(asr) and asr[i][0] <= hi:
        cand.append(asr[i])
        i += 1
    if not cand or not texts:
        return None
    a = [norm_text(t) for t in texts]
    b = [norm_text(t[2]) for t in cand]
    pairs = {}
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            pairs[blk.a + k] = (cand[blk.b + k][0], cand[blk.b + k][1])
    need = len(a) if len(a) <= 2 else max(2, math.ceil(ASR_MIN_SHARE * len(a)))
    return pairs if len(pairs) >= need else None


def _place_by_asr(texts: list[str], pairs: dict[int, tuple[int, int]], sub_start: int,
                  sub_end: int) -> list[tuple[int, int]] | None:
    """Matched words take the recogniser's times; the others are spread by length in the
    gap between their matched neighbours (or out to the subtitle edge, at the ends).
    None when the result is not in order or a gap leaves under 40 ms per unmatched word
    (the recogniser skipped words there, so its times cannot be trusted)."""
    n = len(texts)
    times: list[tuple[int, int] | None] = [pairs.get(i) for i in range(n)]
    i = 0
    while i < n:
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < n and times[j] is None:
            j += 1
        lo = times[i - 1][1] if i > 0 else min(sub_start, times[j][0] if j < n else sub_start)
        hi = times[j][0] if j < n else max(sub_end, lo)
        if hi - lo < 40 * (j - i):
            return None
        for k, t in zip(range(i, j), spread_times(texts[i:j], lo, hi)):
            times[k] = t
        i = j
    out = [t for t in times if t is not None]
    if any(a[1] > b[0] or a[0] > a[1] for a, b in zip(out, out[1:])):
        return None
    return out


def line_timings(sub_start: int, sub_end: int, words: list[dict],
                 asr: list[tuple[int, int, str]], clip: tuple[int, int] | None = None
                 ) -> tuple[list[tuple[int, int]], str, str | None]:
    """Word times (episode ms) for one line: (times, source, why).

    source is 'aligned' (the forced alignment, kept), 'asr' (placed on the speech
    recogniser's words) or 'spread' (spread over the subtitle time by word length).
    The alignment is suspect when a word is untimed, every word scored 0 (the aligner's
    own fallback), the aligned span is more than DRIFT_MS from the subtitle at either
    end, or a word lies outside `clip`. A suspect alignment that the recogniser confirms
    is kept (the subtitle was the one that was off), except an all-zero one: that is the
    aligner's even spread, a guess however close it lands. Otherwise the recogniser's times are
    used when it matches the line confidently. Failing that, a line that only drifted
    keeps its alignment when the aligner was confident (mean score >= ALIGN_TRUST);
    everything else is spread evenly."""
    texts = [w["text"] for w in words]
    if not words:
        return [], "spread", "no words"
    untimed = any(w["start_ms"] is None for w in words)
    why = None
    drift_only = False
    if untimed:
        why = "untimed words"
    else:
        a, b = words[0]["start_ms"], words[-1]["end_ms"]
        if all((w["score"] or 0) == 0 for w in words):
            why = "every word scored 0"
        elif abs(a - sub_start) > DRIFT_MS or abs(b - sub_end) > DRIFT_MS:
            why = f"aligned {a}-{b}, subtitle {sub_start}-{sub_end}"
            drift_only = not clip or (a >= clip[0] and b <= clip[1])
        elif clip and (a < clip[0] or b > clip[1]):
            why = "words outside the clip"
    if why is None:
        return [(w["start_ms"], w["end_ms"]) for w in words], "aligned", None
    pairs = _asr_match(texts, asr, sub_start - ASR_PAD_MS, sub_end + ASR_PAD_MS)
    if pairs is None and not untimed:
        pairs = _asr_match(texts, asr, words[0]["start_ms"] - ASR_PAD_MS,
                           words[-1]["end_ms"] + ASR_PAD_MS)
    if pairs is not None:
        if not untimed and why != "every word scored 0":  # an even spread is a guess, never "aligned"
            gaps = [abs(words[i]["start_ms"] - t[0]) for i, t in pairs.items()]
            ok = statistics.median(gaps) <= ASR_AGREE_MS
            inside = not clip or (words[0]["start_ms"] >= clip[0] and words[-1]["end_ms"] <= clip[1])
            if ok and inside:
                return [(w["start_ms"], w["end_ms"]) for w in words], "aligned", why + "; recogniser agrees"
        times = _place_by_asr(texts, pairs, sub_start, sub_end)
        if times and (not clip or (times[0][0] >= clip[0] and times[-1][1] <= clip[1])):
            return times, "asr", why
    if drift_only and statistics.mean(w["score"] or 0 for w in words) >= ALIGN_TRUST:
        return [(w["start_ms"], w["end_ms"]) for w in words], "aligned", why + "; aligner confident"
    return spread_times(texts, sub_start, sub_end), "spread", why


def build_lines(data: Data, line_ids: list[str], clip_start: int, duration: int,
                rep: Report, *, owner: str,
                count_units: bool = True, extras: dict | None = None) -> list[dict]:
    s = SETTINGS
    entries = []
    clip = (clip_start, clip_start + duration)
    # Episode-time word spans first, so loop windows can see neighbours across lines.
    for lid in line_ids:
        line = data.lines[lid]
        words = data.words.get(lid, []) if line["fr_final"] else []
        times, source, why = [], "spread", None
        if words:
            times, source, why = line_timings(line["start_ms"], line["end_ms"], words,
                                              data.asr.get(line["episode_id"], []), clip)
        if why:
            rep.timing[lid] = (source, why)
            rep.timing_scenes.setdefault(lid, set()).add(owner)
        entries.append((line, words, times, source))

    def rel(t: int) -> int:
        r = t - clip_start
        if r < 0 or r > duration:
            rep.clamped += 1
        return min(max(r, 0), duration)

    spans = [(rel(a), rel(b)) for _, _, times, _ in entries for a, b in times]
    out = []
    offset = 0
    for line, words, times, source in entries:
        lid = line["id"]
        if not line["fr_final"]:  # songs only: subtitle text, one unit-less line
            fr = line["fr"]
            sw = split_words(fr)
            tt = spread_times([w for w, _, _ in sw], line["start_ms"], line["end_ms"])
            wl = [{"fr": w, "cs": a, "ce": b, "startMs": rel(t0), "endMs": rel(t1)}
                  for (w, a, b), (t0, t1) in zip(sw, tt)]
            rep.timing[lid] = ("spread", "no fr_final")
            rep.timing_scenes.setdefault(lid, set()).add(owner)
            out.append({"id": lid, "speaker": line["speaker"], "fr": fr, "en": line_en(data, line),
                        "startMs": rel(line["start_ms"]), "endMs": rel(line["end_ms"]),
                        "approxTimes": True,
                        "units": [{"id": f"{lid}:1", "kind": "expression", "fr": fr,
                                   "en": line_en(data, line), "cs": wl[0]["cs"] if wl else 0,
                                   "ce": wl[-1]["ce"] if wl else len(fr),
                                   "startMs": wl[0]["startMs"] if wl else 0,
                                   "endMs": wl[-1]["endMs"] if wl else 0,
                                   "key": False, "words": wl}]})
            continue
        fr = line["fr_final"]
        wrel = [{"fr": w["text"], "cs": w["char_start"], "ce": w["char_end"],
                 "startMs": rel(t0), "endMs": rel(t1)} for w, (t0, t1) in zip(words, times)]
        units = []
        for u in data.units.get(lid, []):
            cs, ce = unit_char_span(words, u["first_word_idx"], u["last_word_idx"])
            uw = wrel[u["first_word_idx"] - 1:u["last_word_idx"]]
            own = set(range(offset + u["first_word_idx"] - 1, offset + u["last_word_idx"]))
            st, en = uw[0]["startMs"], uw[-1]["endMs"]
            pe, ns = neighbours(spans, st, en, own)
            lo, hi = loop_window(st, en, pe, ns, duration, s.loop_margin_ms)
            key = is_key(u["kind"], [w["fr"] for w in uw])
            uid = f"{lid}:{u['idx']}"
            unit = {"id": uid, "kind": u["kind"], "fr": u["text"], "en": u["en"]}
            if u["note"]:
                unit["note"] = u["note"]
            unit.update(cs=cs, ce=ce, startMs=lo, endMs=hi, key=key, words=uw)
            units.append(unit)
            if count_units and uid not in rep.seen_units:
                rep.seen_units.add(uid)
                rep.unit_count += 1
                rep.key_count += key
                ex = rep.key_examples[key]
                if len(ex) < 400:
                    ex.append(f"{u['kind']}: {u['text']}")
        a = line["audio_start_ms"] if line["audio_start_ms"] is not None else line["start_ms"]
        b = line["audio_end_ms"] if line["audio_end_ms"] is not None else line["end_ms"]
        if source != "aligned":
            a, b = times[0][0], times[-1][1]
        doc = {"id": lid, "speaker": line["speaker"], "fr": fr, "en": line_en(data, line),
               "startMs": rel(a), "endMs": rel(b)}
        if source != "aligned":
            doc["approxTimes"] = True
        doc["units"] = units
        alts = (extras or {}).get("alternates", {}).get(lid)
        if alts:
            doc["alternates"] = [line_alternate(a, (extras or {}).get("media_root"), rep.alternates)
                                 for a in alts]
        out.append(doc)
        offset += len(words)
    return out


def word_frequencies(data: Data) -> dict[str, int]:
    freq: dict[str, int] = {}
    for ws in data.words.values():
        for w in ws:
            k = norm_text(w["text"])
            freq[k] = freq.get(k, 0) + 1
    return freq


def difficulty_features(data: Data, scene: dict, freq: dict[str, int], rare_max: int = 2) -> float:
    """Raw features of how hard a scene's French is: (words/s, words per line, rare share)."""
    lids = scene_line_ids(data, scene["episode_id"], scene["first_line_idx"], scene["last_line_idx"])
    n_words = rare = n_content = 0
    spoken = 0
    for lid in lids:
        line = data.lines[lid]
        ws = data.words.get(lid, [])
        n_words += len(ws)
        if line["audio_start_ms"] is not None:
            spoken += max(1, line["audio_end_ms"] - line["audio_start_ms"])
        for i, w in enumerate(ws):
            if w["text"][:1].isupper() and i > 0:
                continue  # proper names are rare in the data but not hard to hear
            n_content += 1
            rare += freq.get(norm_text(w["text"]), 0) <= rare_max
    rate = n_words / max(spoken / 1000, 0.5)
    per_line = n_words / max(1, len(lids))
    return rate, per_line, rare / max(1, n_content)


def computed_difficulties(data: Data) -> dict[str, int]:
    freq = word_frequencies(data)
    feats = {s["id"]: difficulty_features(data, s, freq) for s in data.scenes}
    cols = list(zip(*feats.values()))
    mu = [statistics.mean(c) for c in cols]
    sd = [statistics.pstdev(c) or 1 for c in cols]
    score = {k: sum((v - m) / d for v, m, d in zip(f, mu, sd)) for k, f in feats.items()}
    return difficulty_buckets(score)


def load_questions() -> tuple[dict[str, dict], dict[str, dict]]:
    """(scene id -> questions-file entry, episode -> units map) from app/data/questions."""
    out, units = {}, {}
    if QUESTIONS_DIR.is_dir():
        for p in sorted(QUESTIONS_DIR.glob("s??e??.json")):
            d = json.loads(p.read_text(encoding="utf-8"))
            for sid, entry in (d.get("scenes") or {}).items():
                out[sid] = entry
        for p in sorted(QUESTIONS_DIR.glob("s??e??.units.json")):
            units[p.name[:6]] = json.loads(p.read_text(encoding="utf-8"))
    return out, units


ALTERNATES_DIR = APP_DIR / "data" / "alternates"


def load_alternates() -> dict[str, list[dict]]:
    """line id -> its alternates, from app/data/alternates/<episode>.json and every
    <episode>.part<n>.json (one per sheet that touches the episode). A line in two files
    is an error."""
    out: dict[str, list[dict]] = {}
    where: dict[str, str] = {}
    if ALTERNATES_DIR.is_dir():
        files = sorted(ALTERNATES_DIR.glob("s??e??.json")) + sorted(ALTERNATES_DIR.glob("s??e??.part*.json"))
        for p in files:
            for lid, alts in json.loads(p.read_text(encoding="utf-8")).items():
                if lid in out:
                    raise ValueError(f"{lid} has alternates in both {where[lid]} and {p.name}")
                out[lid], where[lid] = alts, p.name
    return out


def line_alternate(alt: dict, media_root: Path | None, st: QuestionStats) -> dict:
    """One Line.alternates entry: units tiled like a question's (one whole-sentence unit
    when they do not tile), audio when the clip exists (same hash rule as the questions)."""
    units_map = {alt["fr"]: alt.get("units")} if alt.get("units") else {}
    doc = {"fr": alt["fr"], "en": alt["en"], "units": gloss(alt["fr"], alt["en"], units_map, st)}
    clip = clip_path(alt["fr"], media_root)
    if clip:
        doc["audio"] = clip
        st.audio.add(alt["fr"])
    return doc


def load_songs() -> list[dict]:
    if not SONGS_FILE.is_file():
        return []
    return json.loads(SONGS_FILE.read_text(encoding="utf-8"))


def frame_paths(kind_dir: str, item_id: str, times: list[int]) -> list[dict]:
    return [{"t": t, "src": f"/media/{kind_dir}/{item_id}/{n}.webp"} for n, t in enumerate(times)]


def song_window(data: Data, song: dict) -> tuple[render.ClipWindow, int, list[str]]:
    """Clip window of a song: the scene rule (padding, guard, fades) over its line range,
    from the subtitle start of the first line to the end of the last line's speech."""
    ep = data.episodes[song["episode"]]
    first = data.lines[song["first_line"]]
    last = data.lines[song["last_line"]]
    lids = scene_line_ids(data, song["episode"], first["idx"], last["idx"])
    starts = [first["start_ms"]] + ([first["audio_start_ms"]] if first["audio_start_ms"] else [])
    ends = [last["end_ms"]] + ([last["audio_end_ms"]] if last["audio_end_ms"] else [])
    core_start, core_end = min(starts), max(ends)
    w = render.clip_window(core_start, core_end, ep["duration_ms"])
    return w, core_start, lids


def build(data: Data, out_dir: Path, rep: Report, release: dict | None = None,
          cache: Path | None = None) -> tuple[dict, dict[str, dict], dict[str, dict], dict]:
    """All JSON documents: (index, scenes by id, songs by id, media plan).

    With a release ({"version", "scenes": [...]}) the documents cover only those scenes
    (plus every song that has a released scene); the plan still covers every scene, so
    the media cache stays complete and a new release list costs no encoding."""
    cache = cache or media_cache_for(out_dir)
    questions, units_maps = load_questions()
    extras = {"alternates": load_alternates(), "media_root": cache}
    difficulties = computed_difficulties(data)
    plan = {"scenes": {}, "songs": {}}
    mpath = cache / MANIFEST_NAME
    try:
        manifest = json.loads(mpath.read_text())
    except (OSError, ValueError):
        manifest = {}

    def pick_thumb(key: str, times: list[int], dur: int) -> int:
        stats = (manifest.get(key) or {}).get("stats")
        i = choose_thumb(times, dur, stats)
        mid = thumb_index(times, dur)
        if stats and len(stats) == len(times):
            rep.thumbs["with_stats"] += 1
            rep.thumbs["changed"] += i != mid
            rep.thumbs["dark_middle"] += stats[mid][0] < THUMB_MIN_LUMA
            if not any(frame_ok(x) for x in stats):
                rep.thumb_all_bad.append(key)
        return i

    by_ep: dict[str, list[dict]] = {}
    for sc in data.scenes:
        by_ep.setdefault(sc["episode_id"], []).append(sc)
    order = {}
    for ep, scs in by_ep.items():
        for i, sc in enumerate(sorted(scs, key=lambda x: (x["core_start_ms"], x["id"]))):
            order[sc["id"]] = i

    songs = load_songs()
    for x in songs:
        for k in ("first_line", "last_line"):
            if x[k] not in data.lines:
                raise ValueError(f"app/data/songs.json: song {x['id']} names line {x[k]}, which the "
                                 "database does not have (the file is written for one show's lines)")
    ranges = [(x["id"], x["episode"], data.lines[x["first_line"]]["idx"], data.lines[x["last_line"]]["idx"])
              for x in songs]
    scenes_json, summaries = {}, []
    for sc in data.scenes:
        sid = sc["id"]
        if sc["clip_start_ms"] is None:
            raise ValueError(f"{sid} has no clip window; run frenchirix render first")
        window = render.ClipWindow(sc["clip_start_ms"], sc["clip_end_ms"],
                                   sc["fade_in_ms"], sc["fade_out_ms"])
        dur = window.duration_ms
        times = render.frame_times(window, sc["core_start_ms"])
        lids = scene_line_ids(data, sc["episode_id"], sc["first_line_idx"], sc["last_line_idx"])
        lines = build_lines(data, lids, window.clip_start_ms, dur, rep, owner=sid,
                            extras=extras)
        qs, title_fr, qdifficulty = merge_questions(sid, questions.get(sid),
                                                    units_maps.get(sc["episode_id"]), rep.questions,
                                                    cache)
        frames = frame_paths("f", sid, times)
        score, difficulty = song_scene_values(sc["kind"], sc["score"] or 3,
                                              qdifficulty or difficulties[sid])
        song_id = song_of(sc["episode_id"], sc["first_line_idx"], sc["last_line_idx"], ranges)
        if song_id:
            rep.song_scenes.setdefault(song_id, []).append(sid)
        elif sc["kind"] == "song":
            rep.orphan_song_scenes.append(sid)
        summary = {
            "id": sid, "episode": sc["episode_id"], "order": order[sid],
            "startMs": sc["core_start_ms"], "durationMs": dur, "kind": sc["kind"],
            "titleFr": title_fr or sc["title"], "titleEn": sc["title"],
            "score": score, "difficulty": difficulty,
            "thumb": frames[pick_thumb(f"f/{sid}", times, dur)]["src"],
            "lineCount": len(lines), "wordCount": sum(len(u["words"]) for l in lines for u in l["units"]),
        }
        if song_id:
            summary["songId"] = song_id
        notes = []
        for e in data.notes.get(sid, []):
            n = {"kind": e["kind"], "text": e["text"]}
            if e["phrase"]:
                n["phrase"] = e["phrase"]
            if e["line_id"]:
                n["lineId"] = e["line_id"]
                if e["first_word_idx"] is not None:
                    n["unitIds"] = [f"{e['line_id']}:{u['idx']}" for u in data.units.get(e["line_id"], [])
                                    if u["first_word_idx"] <= e["last_word_idx"]
                                    and u["last_word_idx"] >= e["first_word_idx"]]
            notes.append(n)
        scenes_json[sid] = {**summary, "audio": {"src": f"/media/a/{sid}.m4a", "durationMs": dur},
                            "frames": frames, "lines": lines, "notes": notes, "questions": qs}
        summaries.append(summary)
        ep = data.episodes[sc["episode_id"]]
        plan["scenes"][sid] = {"window": window, "times": times, "source": ep["source_file"],
                               "stream": ep["audio_stream"], "fps": ep["video_fps"]}

    assign_voices(scenes_json)
    songs_json, song_summaries = {}, []
    for song in songs:
        window, core_start, lids = song_window(data, song)
        dur = window.duration_ms
        times = render.frame_times(window, core_start)
        lines = build_lines(data, lids, window.clip_start_ms, dur, rep, owner=song["id"],
                            extras=extras,
                            count_units=False)
        frames = frame_paths("sf", song["id"], times)
        songs_json[song["id"]] = {
            "id": song["id"], "episode": song["episode"], "titleFr": song["title_fr"],
            "titleEn": song["title_en"], "audio": {"src": f"/media/s/{song['id']}.m4a", "durationMs": dur},
            "frames": frames, "lines": lines}
        song_summaries.append({"id": song["id"], "episode": song["episode"], "titleFr": song["title_fr"],
                               "titleEn": song["title_en"], "durationMs": dur,
                               "thumb": frames[pick_thumb(f"sf/{song['id']}", times, dur)]["src"],
                               **({"starter": True} if song.get("starter") else {})})
        ep = data.episodes[song["episode"]]
        plan["songs"][song["id"]] = {"window": window, "times": times, "source": ep["source_file"],
                                     "stream": ep["audio_stream"], "fps": ep["video_fps"]}

    if release is not None:
        keep = list(dict.fromkeys(release["scenes"]))
        unknown = [x for x in keep if x not in scenes_json]
        if unknown:
            raise ValueError(f"app/data/release.json names {len(unknown)} unknown scenes "
                             f"({', '.join(unknown[:5])}{' …' if len(unknown) > 5 else ''}); write it for "
                             "this database with `frenchirix release-list`, or delete it to release every scene")
        keep_set = set(keep)
        scenes_json = {k: v for k, v in scenes_json.items() if k in keep_set}
        summaries = [x for x in summaries if x["id"] in keep_set]
        by_ep = {}
        for sc in data.scenes:
            if sc["id"] in keep_set:
                by_ep.setdefault(sc["episode_id"], []).append(sc)
        for ep, scs in by_ep.items():  # positions among the released scenes
            for i, sc in enumerate(sorted(scs, key=lambda x: (x["core_start_ms"], x["id"]))):
                scenes_json[sc["id"]]["order"] = i
        for x in summaries:
            x["order"] = scenes_json[x["id"]]["order"]
        song_keep = {x.get("songId") for x in summaries if x.get("songId")}
        songs_json = {k: v for k, v in songs_json.items() if k in song_keep}
        song_summaries = [x for x in song_summaries if x["id"] in song_keep]
        assign_voices(scenes_json)
    plan["published"] = {
        "a": sorted(scenes_json), "f": sorted(scenes_json),
        "s": sorted(songs_json), "sf": sorted(songs_json),
        "q": sorted({c.rsplit("/", 1)[1] for d in [*scenes_json.values(), *songs_json.values()] for c in _clips_of(d)}),
    }

    episodes = []
    for eid, ep in data.episodes.items():
        scs = sorted(by_ep.get(eid, []), key=lambda x: (x["core_start_ms"], x["id"]))
        episodes.append({"id": eid, "number": ep["episode"], "titleFr": f"Épisode {ep['episode']}",
                         "titleEn": f"Episode {ep['episode']}", "durationMs": ep["duration_ms"],
                         "sceneIds": [x["id"] for x in scs]})

    index = {"version": "", "episodes": episodes,
             "scenes": sorted(summaries, key=lambda x: (x["episode"], x["order"])),
             "songs": song_summaries, "bank": build_bank(data, scenes_json)}
    index["version"] = content_version(index, scenes_json, songs_json)
    return index, scenes_json, songs_json, plan


RELEASE_SIZE = 50
RELEASE_MIN_PER_EPISODE = 6


def practice_fit(doc: dict) -> dict:
    """How well a scene suits the long practices: the release rule's tie-breakers."""
    lines = doc["lines"]
    keys = [sum(u["key"] for u in l["units"]) for l in lines]
    return {"approx": sum(bool(l.get("approxTimes")) for l in lines),
            "lines": len(lines),
            "lines_ok": 3 <= len(lines) <= 8,
            "thin": sum(k < 2 for k in keys)}


def fit_rank(doc: dict) -> tuple:
    """Sort key: best practice fit first."""
    f = practice_fit(doc)
    return (f["approx"] > 0, not f["lines_ok"], f["thin"] > 0, f["thin"], f["approx"])


def choose_release(docs: dict[str, dict], starter_songs: set[str], size: int = RELEASE_SIZE,
                   min_per_episode: int = RELEASE_MIN_PER_EPISODE) -> list[tuple[str, str]]:
    """The release: [(scene id, why)], deterministic.

    1. every song scene (they score 5), so the starter songs are whole;
    2. every other score-5 scene;
    3. score-4 scenes until `size`, best practice fit first: no line with approxTimes,
       3 to 8 lines, no line with fewer than two key units, then fewer such lines; while
       an episode has fewer than `min_per_episode`, its best candidate goes first; ties
       go to the episode with fewer scenes so far, then to the id."""
    chosen: list[tuple[str, str]] = []
    for sid in sorted(docs):
        d = docs[sid]
        if d["kind"] == "song":
            whole = " (starter song)" if d.get("songId") in starter_songs else ""
            chosen.append((sid, f"song scene{whole}"))
    for sid in sorted(docs):
        d = docs[sid]
        if d["kind"] != "song" and d["score"] == 5:
            chosen.append((sid, "score 5"))
    count: dict[str, int] = {}
    for sid, _ in chosen:
        ep = docs[sid]["episode"]
        count[ep] = count.get(ep, 0) + 1
    episodes = sorted({d["episode"] for d in docs.values()})

    def quality(sid):
        return fit_rank(docs[sid])

    pool = sorted((sid for sid, d in docs.items() if d["kind"] != "song" and d["score"] == 4), key=quality)
    while len(chosen) < size and pool:
        short = [e for e in episodes if count.get(e, 0) < min_per_episode
                 and any(docs[x]["episode"] == e for x in pool)]
        cands = [x for x in pool if docs[x]["episode"] in short] if short else pool
        pick = min(cands, key=lambda x: (quality(x), count.get(docs[x]["episode"], 0), x))
        pool.remove(pick)
        ep = docs[pick]["episode"]
        why = f"score 4, {ep} had {count.get(ep, 0)} (< {min_per_episode})" if short else "score 4, best practice fit"
        chosen.append((pick, why))
        count[ep] = count.get(ep, 0) + 1
    return chosen[:size]


def _clips_of(doc: dict) -> list[str]:
    """Every /media/q clip a scene document names (questions, answers, line alternates)."""
    out = []
    for q in doc.get("questions") or []:
        out += [x["audio"] for x in [q, *q["answers"]] if x.get("audio")]
    for l in doc["lines"]:
        out += [a["audio"] for a in l.get("alternates") or [] if a.get("audio")]
    return out


def build_bank(data: Data, scenes_json: dict[str, dict]) -> dict:
    s = SETTINGS
    lo, hi = s.bank_line_words
    line_items, unit_items = [], []
    seen_l, seen_u = set(), set()
    for sid in sorted(scenes_json):
        for line in scenes_json[sid]["lines"]:
            fr = re.sub(r"\s*\n\s*", " ", line["fr"]).strip()
            n = sum(len(u["words"]) for u in line["units"])
            k = norm_text(fr)
            if lo <= n <= hi and line["en"] and not fr.startswith("-") and k not in seen_l:
                seen_l.add(k)
                line_items.append((scenes_json[sid]["episode"], line["id"],
                                   {"fr": fr, "en": re.sub(r"\s*\n\s*", " ", line["en"]).strip()}))
            for u in line["units"]:
                k = norm_text(u["fr"])
                if u["key"] and u["en"] and k not in seen_u:
                    seen_u.add(k)
                    unit_items.append((scenes_json[sid]["episode"], u["id"],
                                       {"fr": u["fr"].strip(), "en": u["en"]}))
    return {"lines": stratified_sample(line_items, s.bank_lines),
            "units": stratified_sample(unit_items, s.bank_units)}


def media_params() -> dict:
    r = render.SETTINGS
    return {"export_version": EXPORT_VERSION, "app": asdict(SETTINGS),
            "render": {k: getattr(r, k) for k in (
                "guard_ms", "fade_curve", "sample_rate", "audio_preroll_ms", "downmix_left",
                "downmix_right", "gain_db", "padding_ms", "frame_interval_ms",
                "end_frame_offset_ms", "min_frame_gap_ms", "scale_flags")}}


def _canon(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def content_version(index: dict, scenes: dict, songs: dict) -> str:
    h = hashlib.sha256()
    h.update(_canon({**index, "version": ""}))
    for k in sorted(scenes):
        h.update(_canon(scenes[k]))
    for k in sorted(songs):
        h.update(_canon(songs[k]))
    h.update(_canon(media_params()))
    return h.hexdigest()[:12]


def write_json(out_dir: Path, index: dict, scenes: dict, songs: dict) -> int:
    data_dir = out_dir / "data"
    written = 0
    for sub, docs in (("scenes", scenes), ("songs", songs)):
        d = data_dir / sub
        d.mkdir(parents=True, exist_ok=True)
        keep = {f"{k}.json" for k in docs}
        for p in d.glob("*.json"):
            if p.name not in keep:
                p.unlink()
        for k, doc in docs.items():
            written += _write_if_changed(d / f"{k}.json", doc)
    written += _write_if_changed(data_dir / "index.json", index)
    return written


def _write_if_changed(path: Path, doc) -> int:
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    if path.is_file() and path.read_text(encoding="utf-8") == text:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    return 1


# ---------------------------------------------------------------------------
# Media


_LOUD_I = re.compile(r"Integrated loudness:\s*I:\s*(-?[\d.]+|-?inf|nan) LUFS", re.S)
_TRUE_PEAK = re.compile(r"True peak:\s*Peak:\s*(-?[\d.]+|-?inf|nan) dBFS", re.S)


def measure(path: Path, *, dualmono: bool = False) -> tuple[float | None, float | None]:
    """Integrated loudness (LUFS) and true peak (dBTP) with ffmpeg's ebur128."""
    af = "ebur128=peak=true:framelog=quiet" + (":dualmono=true" if dualmono else "")
    err = render._run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path),
                       "-af", af, "-f", "null", "-"]).stderr.decode("utf-8", "replace")
    summary = err[err.rfind("Summary:"):]
    vals = []
    for rx in (_LOUD_I, _TRUE_PEAK):
        m = rx.search(summary)
        v = float(m.group(1)) if m else float("nan")
        vals.append(v if math.isfinite(v) and v > -70 else None)
    return vals[0], vals[1]


def gain_filter(gain_db: float, limit_dbtp: float | None, sample_rate: int) -> str:
    """Static gain, then (only if asked) a lookahead limiter run at 4x the sample rate so
    it acts on true peaks. `latency=1` removes the lookahead delay: timing is unchanged."""
    s = SETTINGS
    chain = [f"volume={gain_db:.3f}dB:precision=float"]
    if limit_dbtp is not None:
        up = sample_rate * s.limiter_oversample
        lin = 10 ** (limit_dbtp / 20)
        chain += [f"aresample={up}:resampler=soxr:precision=28",
                  f"alimiter=limit={lin:.6f}:attack={s.limiter_attack_ms}:release={s.limiter_release_ms}"
                  ":level=0:latency=1:asc=0",
                  f"aresample={sample_rate}:resampler=soxr:precision=28"]
    return ",".join(chain)


def even_out(src_wav: Path, out: Path, encode_args: list[str], sample_rate: int,
             *, dualmono: bool = False) -> dict:
    """Measure `src_wav`, apply the planned gain (and limiter), encode, re-measure; if the
    encoded true peak is over the ceiling, lower the limiter (twice at most), then the
    gain, and encode again."""
    s = SETTINGS
    lufs_in, tp_in = measure(src_wav, dualmono=dualmono)
    gain, limit = plan_gain(lufs_in, tp_in)
    passes = 0
    while True:
        passes += 1
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(src_wav),
               "-af", gain_filter(gain, limit, sample_rate), *encode_args, str(out)]
        render._run(cmd)
        lufs_out, tp_out = measure(out, dualmono=dualmono)
        if tp_out is None or tp_out <= s.ceiling_dbtp or passes >= s.max_encode_passes:
            break
        over = tp_out - s.ceiling_dbtp + 0.2
        if passes < 3:  # the encoder overshot the limiter: limit lower
            limit = (limit if limit is not None else s.ceiling_dbtp - s.limiter_margin_db) - over
        else:  # the overshoot is not where the limiter acts (an AAC artefact): turn it all down
            gain -= over
    return {"lufs_in": lufs_in, "tp_in": tp_in, "gain_db": round(gain, 2),
            "limit_dbtp": None if limit is None else round(limit, 2),
            "limit_db": None if limit is None or tp_in is None else round(tp_in + gain - limit, 2),
            "lufs_out": lufs_out, "tp_out": tp_out, "passes": passes,
            "bytes": out.stat().st_size}


def encode_clip_audio(source: Path, stream: int, window: render.ClipWindow, out: Path,
                      tmpdir: Path) -> dict:
    """Scene or song audio: the render's exact PCM (cut, downmix, gain, fades), evened out."""
    rs = render.SETTINGS
    wav = tmpdir / "clip.wav"
    inp, seek_ms = render.audio_input_args(source, stream, window, rs)
    af = render.audio_filter(window, seek_ms, fades=True, settings=rs)
    render._run(["ffmpeg", "-nostdin", "-v", "error", "-y", *inp, "-af", af,
                 "-c:a", "pcm_f32le", "-f", "wav", str(wav)])
    enc = ["-c:a", SETTINGS.audio_codec, "-b:a", SETTINGS.audio_bitrate,
           "-aac_pns", str(SETTINGS.audio_pns), "-aac_is", str(SETTINGS.audio_is), "-ac", "2",
           "-ar", str(rs.sample_rate), "-map_metadata", "-1", "-movflags", "+faststart",
           "-f", "mp4"]
    tmp_out = tmpdir / "clip.m4a"
    m = even_out(wav, tmp_out, enc, rs.sample_rate)
    m["duration_ms"] = round(render.media_duration_ms(tmp_out), 1)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(tmp_out), out)
    return m


_SHOWINFO = re.compile(r"Parsed_showinfo.*?\bpts_time:\s*(-?[\d.]+)")


def extract_frames(source: Path, fps: float, window: render.ClipWindow, times: list[int],
                   out_dir: Path, tmpdir: Path) -> dict:
    """All slideshow frames of a clip in one ffmpeg run, as `<n>.webp`.

    Frame n is the source frame on screen at clip time times[n], as in render.grab_frame.
    ffmpeg keeps every frame within 1.5 frame periods before each target; the last one at
    or before the target is kept (frame timestamps are rounded to the millisecond, so a
    fixed one-period window could hold zero or two)."""
    s = SETTINGS
    fd = 1000.0 / fps
    abs_t = [window.clip_start_ms + t for t in times]
    seek = max(0, window.clip_start_ms - 1000)
    expr = "+".join(f"between(t\\,{(a - 1.5 * fd) / 1000:.4f}\\,{(a + 0.5) / 1000:.4f})" for a in abs_t)
    vf = (f"select='{expr}',showinfo,"
          f"scale=-2:{s.frame_height}:flags={render.SETTINGS.scale_flags}"
          ":in_color_matrix=bt709:out_color_matrix=bt601:in_range=tv:out_range=tv,"
          "setsar=1,format=yuv420p")
    raw = tmpdir / "frames"
    raw.mkdir()
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-v", "info", "-y",
           "-ss", render._s(seek), "-t", render._s(window.clip_end_ms - seek + 200), "-copyts",
           "-i", str(source), "-map", "0:v:0", "-vf", vf, "-fps_mode", "passthrough",
           "-c:v", "libwebp", "-quality", str(s.webp_quality),
           "-compression_level", str(s.webp_compression), "-preset", "picture",
           "-map_metadata", "-1", "-f", "image2", str(raw / "%04d.webp")]
    err = render._run(cmd).stderr.decode("utf-8", "replace")
    pts = [float(m.group(1)) * 1000 for m in _SHOWINFO.finditer(err)]
    files = sorted(raw.glob("*.webp"))
    if len(files) != len(pts):
        raise RuntimeError(f"{len(files)} frames written, {len(pts)} logged")
    chosen: list[Path] = []
    for a in abs_t:
        cands = [f for f, p in zip(files, pts) if a - 1.5 * fd - 0.5 <= p <= a + 0.5]
        if cands:
            chosen.append(cands[-1])
        elif chosen:
            chosen.append(chosen[-1])  # past the last frame of the episode
        else:
            raise RuntimeError(f"no video frame at {a} ms")
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in out_dir.glob("*.webp"):
        p.unlink()
    total = 0
    for n, f in enumerate(chosen):
        shutil.copyfile(f, out_dir / f"{n}.webp")
        total += f.stat().st_size
    return {"frames": len(chosen), "bytes": total}


def frame_stats(frame_dir: Path, count: int) -> list[list[float]]:
    """(mean luma, luma std, mean chroma) of <frame_dir>/0..count-1.webp, decoded in one
    ffmpeg run at 64x36. Standard library only."""
    w, h = 64, 36
    raw = render._run(["ffmpeg", "-nostdin", "-v", "error", "-f", "image2", "-start_number", "0",
                       "-i", str(frame_dir / "%d.webp"), "-frames:v", str(count),
                       "-vf", f"scale={w}:{h}:flags=area,format=rgb24", "-f", "rawvideo", "-"]).stdout
    size = w * h * 3
    if len(raw) != size * count:
        raise RuntimeError(f"{frame_dir}: decoded {len(raw)} bytes for {count} frames")
    out = []
    for k in range(count):
        px = raw[k * size:(k + 1) * size]
        lum, chroma = [], 0
        for i in range(0, size, 3):
            r, g, b = px[i], px[i + 1], px[i + 2]
            lum.append(0.299 * r + 0.587 * g + 0.114 * b)
            chroma += max(r, g, b) - min(r, g, b)
        mean = sum(lum) / len(lum)
        std = (sum((y - mean) ** 2 for y in lum) / len(lum)) ** 0.5
        out.append([round(mean, 1), round(std, 1), round(chroma / len(lum), 1)])
    return out


def ensure_frame_stats(manifest: dict, media: Path, jobs: int) -> int:
    """Add frame statistics to every frame entry of the manifest that lacks them."""
    todo = [k for k, v in manifest.items()
            if (k.startswith("f/") or k.startswith("sf/")) and "frames" in v
            and len(v.get("stats") or []) != v["frames"] and (media / k / "0.webp").is_file()]
    if not todo:
        return 0
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for k, st in zip(todo, pool.map(lambda k: frame_stats(media / k, manifest[k]["frames"]), todo)):
            manifest[k]["stats"] = st
    return len(todo)


LOUDNESS_KEYS = ("target_lufs", "ceiling_dbtp", "limiter_margin_db", "max_limit_db",
                 "limiter_attack_ms", "limiter_release_ms", "limiter_oversample", "max_encode_passes")
AUDIO_KEYS = LOUDNESS_KEYS + ("audio_codec", "audio_bitrate", "audio_pns", "audio_is")
FRAME_KEYS = ("frame_height", "webp_quality", "webp_compression")


def _sub(params: dict, keys: tuple[str, ...]) -> dict:
    return {"export_version": params["export_version"], "render": params["render"],
            **{k: params["app"][k] for k in keys}}


def _phash(obj) -> str:
    return hashlib.sha256(_canon(obj)).hexdigest()[:16]


def _abs_source(p: str) -> Path:
    path = Path(p)
    return path if path.is_absolute() else REPO_ROOT / path


def build_media(plan: dict, out_dir: Path, *, only: set[str] | None, force: bool,
                jobs: int, log=print) -> dict:
    """Produce every media file that is missing or was made with other parameters, in the
    media cache (see MEDIA_CACHE); `publish_media` then links the released ones into place."""
    media = media_cache_for(out_dir)
    media.mkdir(parents=True, exist_ok=True)
    mpath = media / MANIFEST_NAME
    manifest = json.loads(mpath.read_text()) if mpath.is_file() else {}
    params = media_params()
    tasks = []  # (key, param hash, output paths that must exist, function)

    def add(key, ph, outputs, fn):
        old = manifest.get(key)
        if (not force and old and old.get("hash") == ph
                and all(p.exists() for p in outputs)):
            return
        tasks.append((key, ph, fn))

    missing: set[str] = set()  # source episodes that media still to be made need
    for group, adir, fdir in (("scenes", "a", "f"), ("songs", "s", "sf")):
        for item_id, it in plan[group].items():
            if only is not None and item_id not in only and group == "scenes":
                continue
            src = _abs_source(it["source"])
            n_tasks = len(tasks)
            w = it["window"]
            aph = _phash({"kind": "audio", "src": it["source"], "stream": it["stream"],
                          "window": asdict(w), "p": _sub(params, AUDIO_KEYS)})
            aout = media / adir / f"{item_id}.m4a"
            add(f"{adir}/{item_id}", aph, [aout],
                lambda tmp, src=src, it=it, w=w, aout=aout:
                    encode_clip_audio(src, it["stream"], w, aout, tmp))
            fph = _phash({"kind": "frames", "src": it["source"], "times": it["times"],
                          "start": w.clip_start_ms, "fps": it["fps"],
                          "p": _sub(params, FRAME_KEYS)})
            fout = media / fdir / item_id
            add(f"{fdir}/{item_id}", fph, [fout / f"{n}.webp" for n in range(len(it["times"]))],
                lambda tmp, src=src, it=it, w=w, fout=fout:
                    extract_frames(src, it["fps"], w, it["times"], fout, tmp))
            if len(tasks) > n_tasks and not src.is_file():
                missing.add(it["source"])
    if missing:
        raise RuntimeError(f"{len(missing)} source episode files not found ({', '.join(sorted(missing))}): "
                           "the media are cut from them; --data-only builds the JSON without them")

    if only is None:
        for name in SFX_FILES:
            src = SFX_DIR / name
            if not src.is_file():
                continue
            out = media / "sfx" / name
            ph = _phash({"kind": "sfx", "src": str(src), "size": src.stat().st_size})

            def copy(tmp, src=src, out=out):
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, out)
                return {"bytes": out.stat().st_size}
            add(f"sfx/{name}", ph, [out], copy)

    def stats_pass():
        n = ensure_frame_stats(manifest, media, jobs)
        if n:
            mpath.write_text(json.dumps(manifest, indent=1, sort_keys=True))
            log(f"media: frame statistics for {n} clips")

    if not tasks:
        log("media: everything up to date")
        stats_pass()
        return manifest
    log(f"media: {len(tasks)} items to build with {jobs} workers")
    t0 = time.monotonic()
    errors = []

    def run(task):
        key, ph, fn = task
        t = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="export-", dir=media) as tmp:
            res = fn(Path(tmp))
        res["seconds"] = round(time.monotonic() - t, 2)
        return key, ph, res

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futs = [pool.submit(run, t) for t in tasks]
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                key, ph, res = fut.result()
            except Exception as exc:
                errors.append(str(exc)[:2000])
                continue
            manifest[key] = {"hash": ph, **res}
            if i % 25 == 0 or i == len(tasks):
                log(f"  {i}/{len(tasks)} done ({time.monotonic() - t0:.0f} s)")
                mpath.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    mpath.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    if errors:
        raise RuntimeError(f"{len(errors)} media item(s) failed:\n" + "\n".join(errors))
    log(f"media: built in {time.monotonic() - t0:.1f} s")
    stats_pass()
    return manifest


def adopt_public_media(out_dir: Path, log=print) -> None:
    """One-time move of media made before the cache existed from app/public/media into it."""
    cache, pub = media_cache_for(out_dir), out_dir / "media"
    moved = []
    for name in (*MEDIA_KINDS, MANIFEST_NAME):
        src, dst = pub / name, cache / name
        if src.exists() and not dst.exists():
            cache.mkdir(parents=True, exist_ok=True)
            os.rename(src, dst)
            moved.append(name)
    if moved:
        log(f"media: moved {', '.join(moved)} from {pub} into the cache {cache}")


def _link(src: Path, dst: Path) -> bool:
    """Hard-link (copy across filesystems) src to dst unless dst is already that file."""
    try:
        if dst.exists() and os.path.samefile(src, dst):
            return False
    except OSError:
        pass
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".tmp-link")
    try:
        os.link(src, tmp)
    except OSError:
        shutil.copyfile(src, tmp)
    os.replace(tmp, dst)
    return True


def publish_media(plan: dict, out_dir: Path, log=print) -> dict:
    """Make app/public/media hold exactly the released media: link what the documents name
    from the cache, delete everything else in the media kinds. Returns bytes per kind."""
    cache, pub = media_cache_for(out_dir), out_dir / "media"
    if not cache.is_dir():
        return {}
    want: dict[str, set[str]] = {k: set() for k in MEDIA_KINDS}
    pubd = plan["published"]
    for sid in pubd["a"]:
        want["a"].add(f"{sid}.m4a")
    for kind in ("f", "sf"):
        for item in pubd[kind]:
            d = cache / kind / item
            want[kind] |= {f"{item}/{p.name}" for p in d.glob("*.webp")} if d.is_dir() else set()
    for sid in pubd["s"]:
        want["s"].add(f"{sid}.m4a")
    want["q"] = set(pubd["q"])
    want["sfx"] = {p.name for p in (cache / "sfx").glob("*")} if (cache / "sfx").is_dir() else set()
    linked = removed = 0
    sizes = {}
    for kind, names in want.items():
        for rel in names:
            src = cache / kind / rel
            if src.is_file():
                linked += _link(src, pub / kind / rel)
        root = pub / kind
        if root.is_dir():
            for p in sorted(root.rglob("*"), reverse=True):
                rel = p.relative_to(root).as_posix()
                if p.is_file() and rel not in names:
                    p.unlink()
                    removed += 1
                elif p.is_dir() and not any(p.iterdir()):
                    p.rmdir()
        sizes[kind] = sum(p.stat().st_size for p in root.rglob("*") if p.is_file()) if root.is_dir() else 0
    log(f"media published: {linked} linked, {removed} removed; in the build "
        f"{sum(sizes.values()) / 1e6:.1f} MB (" + ", ".join(f"{k} {v / 1e6:.1f}" for k, v in sizes.items()) + ")")
    return sizes


# ---------------------------------------------------------------------------
# Verification


def _probe_duration_ms(path: Path) -> float:
    return render.media_duration_ms(path)


def verify(out_dir: Path, *, media: bool = True, only: set[str] | None = None) -> list[str]:
    """Check the bundle on disk against the contract. Returns the problems found."""
    problems: list[str] = []
    data_dir = out_dir / "data"
    try:
        index = json.loads((data_dir / "index.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return [f"{data_dir / 'index.json'} missing"]

    try:
        manifest = json.loads((media_cache_for(out_dir) / MANIFEST_NAME).read_text())
    except (OSError, ValueError):
        manifest = {}

    def need(cond, msg):
        if not cond:
            problems.append(msg)

    def file_ok(rel: str, ctx: str):
        if media:
            need((out_dir / rel.lstrip("/")).is_file(), f"{ctx}: {rel} missing")

    ids = [s["id"] for s in index["scenes"]]
    need(len(ids) == len(set(ids)), "duplicate scene ids in index")
    song_ids = [s["id"] for s in index["songs"]]
    need(len(song_ids) == len(set(song_ids)), "duplicate song ids in index")
    ep_scene_ids = [i for e in index["episodes"] for i in e["sceneIds"]]
    need(sorted(ep_scene_ids) == sorted(ids), "episodes' sceneIds do not match the scenes")
    for key in ("lines", "units"):
        b = index["bank"][key]
        need(all(x["fr"] and x["en"] for x in b), f"bank {key}: empty fr or en")
    durations: dict[str, float] = {}

    def real_duration(rel: str, declared: int) -> float:
        path = out_dir / rel.lstrip("/")
        if not media or not path.is_file():
            return declared
        if rel not in durations:
            durations[rel] = _probe_duration_ms(path)
        return durations[rel]

    def check_doc(doc: dict, kind: str, check_media: bool):
        did = doc["id"]
        a = doc["audio"]
        if check_media:
            file_ok(a["src"], did)
        dur = a["durationMs"]
        real = real_duration(a["src"], dur) if check_media else dur
        need(abs(real - dur) <= 50, f"{did}: audio is {real:.0f} ms, JSON says {dur}")
        limit = min(real, dur)
        frames = doc["frames"]
        need(bool(frames), f"{did}: no frames")
        need(frames and frames[0]["t"] == 0, f"{did}: first frame not at 0")
        need(all(x["t"] < y["t"] for x, y in zip(frames, frames[1:])), f"{did}: frame times not increasing")
        need(all(f["t"] < dur for f in frames), f"{did}: frame after the end")
        if check_media:
            for f in frames:
                file_ok(f["src"], did)
        if kind == "scene":
            need(doc["thumb"] in {f["src"] for f in frames}, f"{did}: thumb is not one of its frames")
            st = (manifest.get(f"f/{did}") or {}).get("stats")
            if st and len(st) == len(frames) and any(frame_ok(x) for x in st):
                k = [f["src"] for f in frames].index(doc["thumb"]) if doc["thumb"] in [f["src"] for f in frames] else 0
                need(frame_ok(st[k]), f"{did}: thumb is near-black, near-white or flat while a better frame exists")
            need(1 <= doc["difficulty"] <= 5 and 1 <= doc["score"] <= 5, f"{did}: difficulty or score out of range")
            if doc["kind"] == "song":
                need(doc["score"] == SONG_SCORE and doc["difficulty"] <= SONG_MAX_DIFFICULTY,
                     f"{did}: song scene with score {doc['score']}, difficulty {doc['difficulty']}")
            if doc.get("songId"):
                need(doc["songId"] in song_ids, f"{did}: songId {doc['songId']} is not a song")
        line_ids = [l["id"] for l in doc["lines"]]
        need(len(line_ids) == len(set(line_ids)), f"{did}: duplicate line ids")
        uids = []
        for line in doc["lines"]:
            lid, fr = line["id"], line["fr"]
            need(all(ord(c) <= 0xFFFF for c in fr), f"{lid}: character outside the BMP (JS offsets differ)")
            need(0 <= line["startMs"] <= line["endMs"] <= limit, f"{did} {lid}: line window outside the audio")
            prev_ce = 0
            covered = []
            for u in line["units"]:
                uids.append(u["id"])
                need(u["id"].startswith(lid + ":"), f"{u['id']}: id not under its line")
                need(prev_ce <= u["cs"] < u["ce"] <= len(fr), f"{u['id']}: span out of order or overlapping")
                need(not re.search(r"\w", fr[prev_ce:u["cs"]]), f"{u['id']}: text skipped before the unit")
                need(fr[u["cs"]:u["ce"]] == u["fr"] or kind == "song",
                     f"{u['id']}: line.fr[cs:ce] = {fr[u['cs']:u['ce']]!r}, unit says {u['fr']!r}")
                prev_ce = u["ce"]
                need(0 <= u["startMs"] < u["endMs"] <= limit, f"{did} {u['id']}: loop window outside the audio")
                for w in u["words"]:
                    need(fr[w["cs"]:w["ce"]] == w["fr"], f"{u['id']}: word span {w['fr']!r} wrong")
                    need(u["startMs"] <= w["startMs"] <= w["endMs"] <= u["endMs"],
                         f"{u['id']}: word {w['fr']!r} outside the loop window")
                    covered.append(w["fr"])
            need(not re.search(r"\w", fr[prev_ce:]), f"{lid}: text after the last unit")
            need(covered == [w for w, _, _ in split_words(fr)], f"{lid}: units do not cover every word")
        need(len(uids) == len(set(uids)), f"{did}: duplicate unit ids")
        for line in doc["lines"]:
            for alt in line.get("alternates") or []:
                units = alt.get("units")
                got = tile_units(alt["fr"], [[u["fr"], u["en"]] for u in units or []])[0]
                need(bool(units) and got is not None
                     and [(u["cs"], u["ce"]) for u in got] == [(u["cs"], u["ce"]) for u in units],
                     f"{line['id']}: alternate units do not tile {alt['fr']!r}")
                need(bool(alt.get("en", "").strip()), f"{line['id']}: alternate without English")
                if alt.get("audio"):
                    need(alt["audio"] == f"/media/q/{clip_name(alt['fr'])}",
                         f"{line['id']}: alternate audio is not the clip of {alt['fr']!r}")
                    if media:
                        file_ok(alt["audio"], line["id"])
        if kind == "scene":
            qids = [q["id"] for q in doc["questions"]]
            need(len(qids) == len(set(qids)), f"{did}: duplicate question ids")
            for q in doc["questions"]:
                need(sum(a["correct"] for a in q["answers"]) == 1, f"{q['id']}: not exactly one correct answer")
                need(3 <= len(q["answers"]) <= 4, f"{q['id']}: not 3 or 4 answers")
                if "lineId" in q:
                    need(q["lineId"] in line_ids, f"{q['id']}: lineId not in the scene")
                need(q.get("voice") in VOICES, f"{q['id']}: voice {q.get('voice')!r}")
                for item in [q, *q["answers"]]:
                    if item.get("audio"):
                        need(item["audio"] == f"/media/q/{clip_name(item['fr'])}",
                             f"{q['id']}: audio {item['audio']} is not the clip of {item['fr']!r}")
                        if media:  # clips are checked even under --scenes: they are not scene media
                            file_ok(item["audio"], q["id"])
                for text, units in [(q["fr"], q.get("units")), *((a["fr"], a.get("units")) for a in q["answers"])]:
                    got = tile_units(text, [[u["fr"], u["en"]] for u in units or []])[0]
                    need(bool(units) and got is not None
                         and [(u["cs"], u["ce"]) for u in got] == [(u["cs"], u["ce"]) for u in units],
                         f"{q['id']}: units do not tile {text!r}")

    summaries = {s["id"]: s for s in index["scenes"]}
    for sid in ids:
        p = data_dir / "scenes" / f"{sid}.json"
        if not p.is_file():
            problems.append(f"{sid}: {p.name} missing")
            continue
        doc = json.loads(p.read_text(encoding="utf-8"))
        for k, v in summaries[sid].items():
            need(doc.get(k) == v, f"{sid}: {k} differs between index and scene file")
        check_doc(doc, "scene", media and (only is None or sid in only))
        if media and (only is None or sid in only):
            file_ok(summaries[sid]["thumb"], sid)
    for s in index["songs"]:
        p = data_dir / "songs" / f"{s['id']}.json"
        if not p.is_file():
            problems.append(f"song {s['id']}: file missing")
            continue
        doc = json.loads(p.read_text(encoding="utf-8"))
        check_doc(doc, "song", media and only is None)
        if media and only is None:
            file_ok(s["thumb"], s["id"])
    if media and only is None:
        for name in SFX_FILES:
            if (SFX_DIR / name).is_file():
                file_ok(f"/media/sfx/{name}", "sfx")
        # the build carries exactly what the documents name: nothing of unreleased scenes
        named: set[str] = set()
        docs = [json.loads((data_dir / "scenes" / f"{i}.json").read_text(encoding="utf-8"))
                for i in ids if (data_dir / "scenes" / f"{i}.json").is_file()]
        docs += [json.loads((data_dir / "songs" / f"{x['id']}.json").read_text(encoding="utf-8"))
                 for x in index["songs"] if (data_dir / "songs" / f"{x['id']}.json").is_file()]
        for d in docs:
            named.add(d["audio"]["src"])
            named |= {f["src"] for f in d["frames"]}
            named |= set(_clips_of(d)) if "questions" in d else {
                a["audio"] for l in d["lines"] for a in l.get("alternates") or [] if a.get("audio")}
        extra = []
        for kind in ("a", "f", "s", "sf", "q"):
            root = out_dir / "media" / kind
            if root.is_dir():
                extra += [f"/media/{kind}/{p.relative_to(root).as_posix()}" for p in root.rglob("*")
                          if p.is_file() and f"/media/{kind}/{p.relative_to(root).as_posix()}" not in named]
        need(not extra, f"{len(extra)} media files in the build that no released document names, "
                        f"e.g. {extra[:3]}")
    return problems


# ---------------------------------------------------------------------------
# Summary of the media manifest (for docs/app-export.md)


def summarize(manifest: dict) -> str:
    def stats(vals):
        vals = [v for v in vals if v is not None]
        if not vals:
            return "n/a"
        return f"mean {statistics.mean(vals):.1f}, min {min(vals):.1f}, max {max(vals):.1f}"

    out = []
    for prefix, label in (("a/", "scene audio"), ("s/", "song audio")):
        items = [v for k, v in manifest.items() if k.startswith(prefix)]
        if not items:
            continue
        lim = [v for v in items if v.get("limit_dbtp") is not None]
        size = sum(v["bytes"] for v in items)
        out.append(f"{label}: {len(items)} files, {size / 1e6:.1f} MB (avg {size / len(items) / 1e3:.0f} KB)")
        out.append(f"  loudness in  (LUFS): {stats(v['lufs_in'] for v in items)}")
        out.append(f"  loudness out (LUFS): {stats(v['lufs_out'] for v in items)}")
        out.append(f"  true peak in  (dBTP): {stats(v['tp_in'] for v in items)}")
        out.append(f"  true peak out (dBTP): {stats(v['tp_out'] for v in items)}")
        out.append(f"  gain (dB): {stats(v['gain_db'] for v in items)}")
        out.append(f"  limiter on {len(lim)}; peak reduction (dB): {stats(v['limit_db'] for v in lim)}")
        short = [SETTINGS.target_lufs - v["lufs_out"] for v in items
                 if v["lufs_out"] is not None and v["lufs_out"] < SETTINGS.target_lufs - 1]
        out.append(f"  more than 1 LU under target: {len(short)}" +
                   (f" (by {stats(short)})" if short else ""))
        out.append(f"  encode passes > 1: {sum(v['passes'] > 1 for v in items)}")
        if "duration_ms" in items[0]:
            secs = sum(v["duration_ms"] for v in items) / 1000
            out.append(f"  duration {secs:.0f} s, average bitrate {size * 8 / secs / 1000:.0f} kbps")
    for prefix, label in (("f/", "scene frames"), ("sf/", "song frames")):
        items = [v for k, v in manifest.items() if k.startswith(prefix)]
        if items:
            n = sum(v["frames"] for v in items)
            size = sum(v["bytes"] for v in items)
            out.append(f"{label}: {n} frames in {len(items)} clips, {size / 1e6:.1f} MB "
                       f"(avg {size / n / 1e3:.1f} KB per frame)")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Entry point


def export(out_dir: Path = DEFAULT_OUT, *, data_only: bool = False, scenes: list[str] | None = None,
           force: bool = False, verify_only: bool = False, jobs: int | None = None,
           db: Path = DB_PATH, log=print, verbose: bool = False) -> int:
    t0 = time.monotonic()
    only = set(scenes) if scenes else None
    if not verify_only:
        if not db.is_file():
            log(f"error: {db} not found; the pipeline makes it (frenchirix import <episode>, then the "
                "steps of docs/runbook.md)")
            return 1
        conn = connect_readonly(db)
        data = load(conn)
        conn.close()
        if only:
            unknown = only - {s["id"] for s in data.scenes}
            if unknown:
                log(f"error: unknown scene ids: {', '.join(sorted(unknown))}")
                return 1
        release = load_release()
        adopt_public_media(out_dir, log)
        rep = Report()
        index, scenes_json, songs_json, plan = build(data, out_dir, rep, release)
        n = write_json(out_dir, index, scenes_json, songs_json)
        if release is not None:
            log(f"release {release.get('version')}: {len(scenes_json)} of {len(data.scenes)} scenes")
        log(f"data: {len(scenes_json)} scenes, {len(songs_json)} songs, {n} files changed, "
            f"version {index['version']} ({time.monotonic() - t0:.1f} s)")
        log(f"units: {rep.unit_count} distinct in scenes, {rep.key_count} key "
            f"({100 * rep.key_count / max(1, rep.unit_count):.0f}%)")
        qst = rep.questions
        log(f"questions: {len(qst.sentences)} sentences, {len(qst.with_units)} with units, "
            f"{len(qst.fallbacks)} fallbacks")
        log("song scenes: " + ", ".join(f"{k} {len(v)}" for k, v in sorted(rep.song_scenes.items()))
            + f"; kind 'song' in no song: {', '.join(rep.orphan_song_scenes) or 'none'}")
        log(f"question audio: {len(qst.audio)} of {len(qst.sentences)} sentences have a clip")
        ast = rep.alternates
        log(f"alternates: {len(ast.sentences)} sentences, {len(ast.with_units)} with units, "
            f"{len(ast.fallbacks)} fallbacks, {len(ast.audio)} with a clip")
        if verbose:
            for sent, why in sorted(qst.fallbacks.items()):
                if why != "no units":
                    log(f"  fallback {sent!r}: {why}")
        by_src: dict[str, list[str]] = {}
        for lid, (src, why) in sorted(rep.timing.items()):
            by_src.setdefault(src, []).append(lid)
        for src in ("aligned", "asr", "spread"):
            ids = by_src.get(src, [])
            if ids:
                owners = sorted({o for l in ids for o in rep.timing_scenes[l]})
                label = {"aligned": "suspect but kept (recogniser agrees or aligner confident)",
                         "asr": "placed on recogniser words", "spread": "spread over subtitle"}[src]
                log(f"timing: {len(ids)} lines {label}, in {len(owners)} scenes/songs")
                if verbose:
                    for l in ids:
                        log(f"  {l}: {rep.timing[l][1]}  [{', '.join(sorted(rep.timing_scenes[l]))}]")
        if rep.clamped:
            log(f"warning: {rep.clamped} times clamped into the clip")
        if not data_only:
            jobs = jobs or max(1, (os.cpu_count() or 4) // 2)
            manifest = build_media(plan, out_dir, only=only, force=force, jobs=jobs, log=log)
            log(summarize(manifest))
            # thumbnails depend on the frame statistics just measured: build the JSON again
            rep = Report()
            index, scenes_json, songs_json, plan = build(data, out_dir, rep, release)
            n = write_json(out_dir, index, scenes_json, songs_json)
            log(f"data (with frame statistics): {n} files changed, version {index['version']}")
        publish_media(plan, out_dir, log)
        t = rep.thumbs
        log(f"thumbnails: {t['changed']} of {t['with_stats']} moved off the middle frame; "
            f"{t['dark_middle']} middle frames were near-black; every frame poor in: "
            f"{', '.join(rep.thumb_all_bad) or 'none'}")
    problems = verify(out_dir, media=not data_only, only=only)
    for p in problems[:200]:
        log(f"problem: {p}")
    log(f"verify: {len(problems)} problems ({time.monotonic() - t0:.1f} s total)")
    return 1 if problems else 0


# ---------------------------------------------------------------------------
# Question sheets


def _one_row(text: str) -> str:
    pieces = [p.strip() for p in (text or "").split("\n") if p.strip()]
    out = pieces[0] if pieces else ""
    for p in pieces[1:]:
        out += (" " if p.startswith("- ") else " / ") + p
    return out


def question_sheet(conn: sqlite3.Connection, episode: str) -> str:
    """The compact sheet a question writer reads: one block per scene."""
    data = load(conn)
    scs = sorted((s for s in data.scenes if s["episode_id"] == episode),
                 key=lambda x: (x["core_start_ms"], x["id"]))
    if not scs:
        raise ValueError(f"no scenes for episode {episode!r}")
    out = [f"# Questions sheet: {episode}", "",
           f"{len(scs)} scenes, in timeline order. Lines: `line id | speaker | French | literal English`.",
           ""]
    for sc in scs:
        out.append(f"## {sc['id']}")
        out.append(f"title: {sc['title']}")
        out.append(f"kind: {sc['kind']}")
        if sc["why"]:
            out.append(f"why: {_one_row(sc['why'])}")
        out.append("lines:")
        for lid in scene_line_ids(data, episode, sc["first_line_idx"], sc["last_line_idx"]):
            line = data.lines[lid]
            out.append(f"{lid} | {line['speaker'] or '-'} | {_one_row(line['fr_final'] or line['fr'])} | "
                       f"{_one_row(line_en(data, line))}")
        ex = data.notes.get(sc["id"], [])
        if ex:
            out.append("notes:")
            for e in ex:
                ph = f" \"{e['phrase']}\"" if e["phrase"] else ""
                out.append(f"- {e['kind']}{ph}: {_one_row(e['text'])}")
        out.append("")
    return "\n".join(out)


def question_sentences(episode: str) -> str:
    """Every distinct French sentence of an episode's questions and answers, in file
    order, one per line as `French | English`, for the agents who write the units."""
    path = QUESTIONS_DIR / f"{episode}.json"
    if not path.is_file():
        raise ValueError(f"{path} not found")
    d = json.loads(path.read_text(encoding="utf-8"))
    seen: dict[str, str] = {}
    for entry in (d.get("scenes") or {}).values():
        for q in entry.get("questions") or []:
            for item in [q, *q.get("answers", [])]:
                fr = " ".join(item["fr"].split())
                if fr != item["fr"]:
                    raise ValueError(f"{episode}: sentence with a line break or double space: {item['fr']!r}")
                seen.setdefault(fr, " ".join(item["en"].split()))
    return "".join(f"{fr} | {en}\n" for fr, en in seen.items())


def release_list(write: bool = True, everything: bool = False, version: str = "2.1.0", log=print) -> int:
    """Choose the release scenes (choose_release, or every scene with `everything`), print why,
    write app/data/release.json with `version`."""
    data = load(connect_readonly())
    index, docs, songs, _ = build(data, DEFAULT_OUT, Report(), None)
    starters = {x["id"] for x in index["songs"] if x.get("starter")}
    chosen = [(sid, "all scenes") for sid in sorted(docs)] if everything else choose_release(docs, starters)
    ids = [x for x, _ in chosen]
    log(f"{'scene':18} sc kind      lines approx thin  why")
    for sid, why in chosen:
        d, f = docs[sid], practice_fit(docs[sid])
        log(f"{sid:18} {d['score']}  {d['kind']:9} {f['lines']:5} {f['approx']:6} {f['thin']:4}  {why}")
    per = {}
    for sid in ids:
        per[docs[sid]["episode"]] = per.get(docs[sid]["episode"], 0) + 1
    log("per episode: " + ", ".join(f"{k} {v}" for k, v in sorted(per.items())))
    rest = sorted((x for x in docs if x not in ids and docs[x]["score"] >= 4),
                  key=lambda x: (-docs[x]["score"], fit_rank(docs[x]), x))
    log("first ten left out:")
    for sid in rest[:10]:
        d, f = docs[sid], practice_fit(docs[sid])
        log(f"  {sid:18} {d['score']}  {d['kind']:9} lines {f['lines']} approx {f['approx']} thin {f['thin']}")
    if write:
        RELEASE_FILE.write_text(json.dumps({"version": version, "scenes": ids}, indent=2) + "\n",
                                encoding="utf-8")
        log(f"wrote {RELEASE_FILE.relative_to(REPO_ROOT)} ({len(ids)} scenes)")
    return 0


ALT_SHEETS_DIR = REPO_ROOT / "work" / "alternates"
ALT_SCENES_PER_SHEET = 10


def alternates_sheets(scope: str = "all", per_sheet: int = ALT_SCENES_PER_SHEET, log=print) -> int:
    """Write work/alternates/sheet-<n>.md for the content-writer agents who write line
    alternates, and merge into work/alternates/sheets.json which lines each sheet assigns
    (for check_questions.py --alternates <n>).

    `scope` is "all" (every scene) or "release" (app/data/release.json). Only scenes with at
    least one line still without alternates get a sheet, `per_sheet` scenes per sheet, in
    episode and timeline order. Sheets are numbered after the highest existing
    app/data/alternates/<episode>.part<n>.json, so new part files never collide with old ones.
    A line shared by two scenes is assigned to the first sheet that lists it; elsewhere it is
    marked SKIP, so no line ends up in two files."""
    data = load(connect_readonly())
    if scope == "release":
        release = load_release()
        if release is None:
            log("error: no app/data/release.json")
            return 1
        wanted = set(release["scenes"])
        pool = [sc for sc in data.scenes if sc["id"] in wanted]
    elif scope == "all":
        pool = list(data.scenes)
    else:
        log(f"error: unknown scope {scope!r}")
        return 1
    have = load_alternates()
    assigned: set[str] = set()

    def open_lines(sc) -> list[str]:
        return [lid for lid in scene_line_ids(data, sc["episode_id"], sc["first_line_idx"], sc["last_line_idx"])
                if lid not in have]

    scs = sorted((sc for sc in pool if open_lines(sc)),
                 key=lambda x: (x["episode_id"], x["core_start_ms"], x["id"]))
    if not scs:
        log("nothing to do: every line of these scenes has alternates")
        return 0
    taken = [int(m.group(1)) for f in ALTERNATES_DIR.glob("*.part*.json")
             if (m := re.search(r"\.part(\d+)\.json$", f.name))]
    first = max(taken, default=0) + 1
    ALT_SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    index_path = ALT_SHEETS_DIR / "sheets.json"
    index: dict[str, dict[str, list[str]]] = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    for k in range(0, len(scs), per_sheet):
        n = first + k // per_sheet
        part = scs[k:k + per_sheet]
        eps = sorted({sc["episode_id"] for sc in part})
        todo: dict[str, list[str]] = {e: [] for e in eps}
        out = [f"# Alternates sheet {n}", "",
               f"{len(part)} scenes. Write two alternates for every line not marked SKIP, into "
               + " and ".join(f"`app/data/alternates/{e}.part{n}.json`" for e in eps)
               + " (one file per episode; the format is in your brief, docs/content-steps.md). "
               "Lines: `line id | speaker | French | literal English`.", ""]
        for sc in part:
            out += [f"## {sc['id']}", f"title: {sc['title']}", f"kind: {sc['kind']}"]
            if sc["why"]:
                out.append(f"context: {_one_row(sc['why'])}")
            out.append("lines:")
            for lid in scene_line_ids(data, sc["episode_id"], sc["first_line_idx"], sc["last_line_idx"]):
                line = data.lines[lid]
                skip = ("SKIP (has alternates) | " if lid in have
                        else "SKIP (written on another sheet) | " if lid in assigned else "")
                out.append(f"{skip}{lid} | {line['speaker'] or '-'} | {_one_row(line['fr_final'] or line['fr'])} | "
                           f"{_one_row(line_en(data, line))}")
                if not skip:
                    todo[sc["episode_id"]].append(lid)
                    assigned.add(lid)
            out.append("")
        todo = {e: v for e, v in todo.items() if v}
        path = ALT_SHEETS_DIR / f"sheet-{n}.md"
        path.write_text("\n".join(out), encoding="utf-8")
        index[str(n)] = todo
        log(f"wrote {path.relative_to(REPO_ROOT)}: {len(part)} scenes, "
            + ", ".join(f"{e} {len(v)} lines" for e, v in todo.items()))
    index_path.write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    return 0
