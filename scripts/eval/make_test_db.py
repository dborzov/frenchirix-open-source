"""Copy assets/db.sqlite to work/asr/test.sqlite and annotate a few scenes with fr_final = fr.

.venv/bin/python scripts/eval/make_test_db.py
"""

import shutil
import sqlite3
from pathlib import Path

from frenchirix.text import split_words

ROOT = Path(__file__).resolve().parents[2]
dst = ROOT / "work/asr/test.sqlite"
shutil.copy(ROOT / "assets/db.sqlite", dst)
conn = sqlite3.connect(dst)
# Two sung scenes (the opening song), and dialogue spread over the episode.
scenes = ["s01e04-0010-0011", "s01e04-0018-0019", "s01e04-0020-0022", "s01e04-0039-0041",
          "s01e04-0049-0058", "s01e04-0096-0101", "s01e04-0138-0149", "s01e04-0221-0226", "s01e04-0266-0277",
          "s01e04-0321-0329", "s01e04-0410-0416"]
n_lines = n_words = 0
for sid in scenes:
    first, last = conn.execute("SELECT first_line_idx, last_line_idx FROM scenes WHERE id = ?",
                               (sid,)).fetchone()
    for line_id, fr in conn.execute(
            "SELECT id, fr FROM lines WHERE episode_id = 's01e04' AND idx BETWEEN ? AND ?",
            (first, last)).fetchall():
        conn.execute("UPDATE lines SET fr_final = fr WHERE id = ?", (line_id,))
        conn.execute("DELETE FROM words WHERE line_id = ?", (line_id,))
        words = split_words(fr)
        conn.executemany(
            "INSERT INTO words (line_id, idx, text, char_start, char_end) VALUES (?, ?, ?, ?, ?)",
            [(line_id, n, w, a, b) for n, (w, a, b) in enumerate(words, 1)])
        n_lines += 1
        n_words += len(words)
conn.commit()
print(f"{dst}: {len(scenes)} scenes, {n_lines} lines, {n_words} words")
