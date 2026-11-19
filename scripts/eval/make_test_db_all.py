"""work/asr/test_all.sqlite: fr_final = fr and words for every scene line of s01e04 (a full-size alignment run)."""
import shutil, sqlite3
from pathlib import Path
from frenchirix.text import split_words
ROOT = Path(__file__).resolve().parents[2]
dst = ROOT / "work/asr/test_all.sqlite"
shutil.copy(ROOT / "assets/db.sqlite", dst)
conn = sqlite3.connect(dst)
rows = conn.execute("SELECT DISTINCT line_id, fr FROM scene_lines WHERE scene_id LIKE 's01e04-%'").fetchall()
for lid, fr in rows:
    conn.execute("UPDATE lines SET fr_final = fr WHERE id = ?", (lid,))
    conn.executemany("INSERT INTO words (line_id, idx, text, char_start, char_end) VALUES (?,?,?,?,?)",
                     [(lid, i, w, a, b) for i, (w, a, b) in enumerate(split_words(fr), 1)])
conn.commit()
print(dst, len(rows), "lines")
