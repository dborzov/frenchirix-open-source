"""Snippet re-recognition for several word-boundary policies, on the same random spans.

uv run --no-sync python scripts/eval/tune_bounds.py <db> <episode> <n_spans> lead,tail [lead,tail ...]
Policy: start -= lead (not before previous word's end), end = min(next word start, end + tail)
applied to stored word times. Also a baseline from Whisper's own word times (asr_words).
"""

import random
import sqlite3
import sys
import unicodedata
from pathlib import Path

db, ep, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
policies = [tuple(int(x) for x in p.split(",")) for p in sys.argv[4:]]
margin = 80
conn = sqlite3.connect(db)


def letters(t):
    t = "".join(c for c in unicodedata.normalize("NFKD", t.lower()) if not unicodedata.combining(c))
    return "".join(c for c in t.replace("œ", "oe") if c.isalnum())


lines = {}
for li, song, wi, text, s, e in conn.execute(
        "SELECT l.idx, l.is_song, w.idx, w.text, w.start_ms, w.end_ms FROM words w JOIN lines l "
        "ON l.id = w.line_id WHERE l.episode_id = ? ORDER BY l.idx, w.idx", (ep,)):
    lines.setdefault(li, []).append([text, s, e, song])
flat = [w for li in sorted(lines) for w in lines[li]]
for i, w in enumerate(flat):
    w.append(flat[i - 1][2] if i else None)  # previous end
    w.append(flat[i + 1][1] if i + 1 < len(flat) else None)  # next start

rng = random.Random(4)
cands = [(li, i, k) for li, ws in lines.items() for k in (2, 3, 4) for i in range(len(ws) - k + 1)]
picked = rng.sample(cands, n)

# Baseline: spans of 2-4 consecutive recognised words inside the test lines' time.
asr = conn.execute("SELECT start_ms, end_ms, text FROM asr_words WHERE episode_id = ? ORDER BY idx",
                   (ep,)).fetchall()
windows = [(ws[0][1], ws[-1][2]) for ws in lines.values()]
inside = [i for i, (s, e, _) in enumerate(asr) if any(a <= s and e <= b for a, b in windows)]
base = []
for i in rng.sample(inside, len(inside)):
    k = rng.choice((2, 3, 4))
    if all(j in inside for j in range(i, i + k)):
        base.append((asr[i][0], asr[i + k - 1][1], " ".join(t for _, _, t in asr[i:i + k])))
    if len(base) == n:
        break

from frenchirix.asr_audio import cut, episode_source, load_centre_channel, release_gpu  # noqa
from frenchirix.db import connect  # noqa
from frenchirix.transcribe import TRANSCRIBE_OPTIONS, load_model  # noqa

source, stream, _ = episode_source(connect(Path(db)), ep)
audio = load_centre_channel(source, stream)
model, _ = load_model()
opts = dict(TRANSCRIBE_OPTIONS, word_timestamps=False)


def check(spans):
    exact = contains = 0
    for s, e, text in spans:
        segs, _ = model.transcribe(cut(audio, s - margin, e + margin), **opts)
        heard, want = letters(" ".join(x.text for x in segs)), letters(text)
        exact += heard == want
        contains += want in heard
    return exact, contains


ex, co = check(base)
print(f"baseline whisper word times: exact {ex}/{len(base)}, contains {co}/{len(base)}")
for lead, tail in policies:
    spans = []
    for li, i, k in picked:
        ws = lines[li][i:i + k]
        first, last = ws[0], ws[-1]
        s = first[1] - lead if first[4] is None else max(first[4], first[1] - lead)
        e = last[2] + tail if last[5] is None else min(last[5], last[2] + tail)
        e = max(e, last[2])
        spans.append((s, e, " ".join(w[0] for w in ws)))
    ex, co = check(spans)
    print(f"lead {lead} tail {tail}: exact {ex}/{n}, contains {co}/{n}")
del model
release_gpu()
