"""Objective checks of forced alignment on the test database. Prints numbers only.

uv run --group asr python scripts/eval/eval_alignment.py <db> <episode> [n_spans] [margin_ms]
"""

import difflib
import random
import sqlite3
import statistics
import sys
import unicodedata
from pathlib import Path

db, ep = sys.argv[1:3]
n_spans = int(sys.argv[3]) if len(sys.argv) > 3 else 30
margin = int(sys.argv[4]) if len(sys.argv) > 4 else 80
conn = sqlite3.connect(db)


def letters(text):
    text = text.lower()
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return "".join(c for c in text.replace("œ", "oe") if c.isalnum())


rows = conn.execute(
    "SELECT l.idx, l.is_song, w.idx, w.text, w.start_ms, w.end_ms, w.score FROM words w "
    "JOIN lines l ON l.id = w.line_id WHERE l.episode_id = ? ORDER BY l.idx, w.idx", (ep,)).fetchall()
lines = {}
for li, song, wi, text, s, e, sc in rows:
    lines.setdefault(li, {"song": song, "words": []})["words"].append((wi, text, s, e, sc))
untimed = sum(1 for r in rows if r[4] is None)
print(f"{len(lines)} lines, {len(rows)} words, {untimed} untimed")

# Order and overlap, within and across lines.
flat = [(li, w) for li in sorted(lines) for w in lines[li]["words"] if w[2] is not None]
bad_len = sum(1 for _, w in flat if w[3] < w[2])
zero = sum(1 for _, w in flat if w[3] == w[2])
overlap = sum(1 for (_, a), (_, b) in zip(flat, flat[1:]) if b[2] < a[3])
backwards = sum(1 for (_, a), (_, b) in zip(flat, flat[1:]) if b[2] < a[2])
print(f"end before start: {bad_len}; zero-length words: {zero}; "
      f"next word starts before previous ends: {overlap}; start goes backwards: {backwards}")
durs = sorted(w[3] - w[2] for _, w in flat)
print(f"word duration ms: median {durs[len(durs) // 2]}, p10 {durs[len(durs) // 10]}, "
      f"p90 {durs[9 * len(durs) // 10]}, max {durs[-1]}")

# Line timing against subtitle timing.
sub = dict(conn.execute("SELECT idx, start_ms FROM lines WHERE episode_id = ?", (ep,)).fetchall())
off = sorted(lines[li]["words"][0][2] - sub[li] for li in lines if lines[li]["words"][0][2] is not None)
print(f"audio_start - subtitle start, ms: median {off[len(off) // 2]}, p10 {off[len(off) // 10]}, "
      f"p90 {off[9 * len(off) // 10]}")


def dist(scores, label):
    if not scores:
        return
    q = statistics.quantiles(scores, n=10)
    print(f"scores {label}: n={len(scores)} mean {statistics.mean(scores):.3f} p10 {q[0]:.3f} "
          f"median {statistics.median(scores):.3f} p90 {q[-1]:.3f} share<0.3 "
          f"{sum(s < 0.3 for s in scores) / len(scores):.1%}")


for song in (0, 1):
    dist([w[4] for li in lines if lines[li]["song"] == song for w in lines[li]["words"]
          if w[4] is not None], "sung" if song else "spoken")
print(f"NULL scores (unspellable): {sum(1 for r in rows if r[4] is not None and r[6] is None)}")

# Random spans of 2-4 consecutive words, re-recognised from the aligned audio alone.
rng = random.Random(4)
cands = []
for li, d in lines.items():
    ws = d["words"]
    for k in (2, 3, 4):
        for i in range(len(ws) - k + 1):
            cands.append((li, i, k))
picked = []
used = set()
while len(picked) < n_spans:
    li, i, k = rng.choice(cands)
    if (li, i) in used:
        continue
    used.add((li, i))
    picked.append((li, i, k))

from frenchirix.asr_audio import cut, episode_source, load_centre_channel, release_gpu  # noqa: E402
from frenchirix.db import connect  # noqa: E402
from frenchirix.transcribe import TRANSCRIBE_OPTIONS, load_model  # noqa: E402

source, stream, _ = episode_source(connect(Path(db)), ep)
audio = load_centre_channel(source, stream)
model, _ = load_model()
opts = dict(TRANSCRIBE_OPTIONS, word_timestamps=False)
exact = contains = close = 0
by_song = {0: [0, 0], 1: [0, 0]}
results = []
for li, i, k in picked:
    ws = lines[li]["words"][i:i + k]
    s, e = ws[0][2] - margin, ws[-1][3] + margin
    segs, _ = model.transcribe(cut(audio, s, e), **opts)
    heard = letters(" ".join(seg.text for seg in segs))
    want = letters(" ".join(w[1] for w in ws))
    ok = heard == want
    exact += ok
    contains += want in heard
    r = difflib.SequenceMatcher(None, want, heard).ratio()
    close += r >= 0.8
    by_song[lines[li]["song"]][0] += 1
    by_song[lines[li]["song"]][1] += ok
    results.append((li, i + 1, k, e - s, ok, round(r, 2)))
    if not ok and "--show" in sys.argv:
        print("   SHOW", li, repr(want), repr(heard))
del model
release_gpu()
print(f"spans: {len(picked)}, margin {margin} ms")
print(f"exact match after normalisation: {exact}/{len(picked)}; transcript contains the span: "
      f"{contains}/{len(picked)}; letter similarity >= 0.8: {close}/{len(picked)}")
print(f"exact by kind: spoken {by_song[0][1]}/{by_song[0][0]}, sung {by_song[1][1]}/{by_song[1][0]}")
print("misses (line, first word, n words, snippet ms, similarity):")
for li, wi, k, ms, ok, r in results:
    if not ok:
        print(f"   {li} {wi} {k} {ms} {r}")
