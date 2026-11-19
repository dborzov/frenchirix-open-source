"""Recognition against the subtitles for one episode. Prints counts and line numbers only.

.venv/bin/python scripts/eval/eval_recognition.py <db> <episode>
"""

import difflib
import sqlite3
import sys
import unicodedata

from frenchirix.text import split_words

db, ep = sys.argv[1:3]
conn = sqlite3.connect(db)


def norm(w):
    w = w.lower().replace("’", "'")
    w = "".join(c for c in unicodedata.normalize("NFKD", w) if not unicodedata.combining(c))
    return "".join(c for c in w if c.isalnum() or c == "'")


lines = conn.execute("SELECT idx, start_ms, end_ms, fr, is_song FROM lines WHERE episode_id = ? "
                     "ORDER BY idx", (ep,)).fetchall()
asr = conn.execute("SELECT start_ms, end_ms, text, prob FROM asr_words WHERE episode_id = ? "
                   "ORDER BY idx", (ep,)).fetchall()
sub_words = [norm(w) for _, _, _, fr, _ in lines for w, _, _ in split_words(fr)]
asr_words = [norm(w) for _, _, t, _ in asr for w, _, _ in split_words(t)]
sub_words = [w for w in sub_words if w]
asr_words = [w for w in asr_words if w]
sm = difflib.SequenceMatcher(None, sub_words, asr_words, autojunk=False)
matched = sum(b.size for b in sm.get_matching_blocks())
print(f"subtitle words {len(sub_words)}, recognised words {len(asr_words)} "
      f"(ratio {len(asr_words) / len(sub_words):.3f})")
print(f"similarity (difflib ratio over normalised word sequences): {sm.ratio():.3f}")
print(f"subtitle words found in order in the recognition: {matched} ({matched / len(sub_words):.1%})")
print(f"recognised words with no subtitle counterpart: {len(asr_words) - matched}")
probs = sorted(p for *_, p in asr)
print(f"word prob median {probs[len(probs) // 2]:.3f}, share < 0.5: "
      f"{sum(p < 0.5 for p in probs) / len(probs):.1%}")

# Per line: recognised words whose midpoint falls in the line's subtitle time.
rows = []
for idx, s, e, fr, song in lines:
    sw = [norm(w) for w, _, _ in split_words(fr)]
    aw = [norm(w) for a, b, t, _ in asr if s <= (a + b) / 2 <= e for w, _, _ in split_words(t)]
    if not sw:
        continue
    m = sum(b.size for b in difflib.SequenceMatcher(None, sw, aw, autojunk=False).get_matching_blocks())
    rows.append((idx, len(sw), len(aw), m, song))
covered = [r for r in rows if r[3] / r[1] >= 0.8]
print(f"lines where >= 80% of the subtitle's words are in the recognition: {len(covered)}/{len(rows)}")
more = sorted((r for r in covered if r[2] - r[1] >= 3 and not r[4]), key=lambda r: r[1] - r[2])
print("lines with clearly more recognised words (idx, subtitle words, recognised, matched):")
for r in more[:12]:
    print("  ", r[:4])
fewer = [r for r in rows if r[2] < r[1]]
print(f"lines with fewer recognised words than subtitle words: {len(fewer)}")
