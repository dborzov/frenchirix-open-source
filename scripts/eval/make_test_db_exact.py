"""work/asr/test_exact.sqlite: fr_final = fr only for lines whose subtitle equals the recognition
(normalised words of asr_words inside the line's time). Needs asr_words in work/asr/test.sqlite."""
import shutil, sqlite3, unicodedata
from pathlib import Path
from frenchirix.text import split_words
ROOT = Path(__file__).resolve().parents[2]
src, dst = ROOT / "work/asr/test.sqlite", ROOT / "work/asr/test_exact.sqlite"
shutil.copy(src, dst)
conn = sqlite3.connect(dst)
conn.execute("UPDATE lines SET fr_final = NULL, audio_start_ms = NULL, audio_end_ms = NULL")
conn.execute("DELETE FROM words")
def norm(w):
    w = "".join(c for c in unicodedata.normalize("NFKD", w.lower()) if not unicodedata.combining(c))
    return "".join(c for c in w if c.isalnum())
asr = conn.execute("SELECT start_ms, end_ms, text FROM asr_words WHERE episode_id='s01e04'").fetchall()
n = nw = songs = 0
for lid, s, e, fr, song in conn.execute("SELECT id, start_ms, end_ms, fr, is_song FROM lines WHERE episode_id='s01e04'").fetchall():
    sub = [norm(w) for w, _, _ in split_words(fr)]
    heard = "".join(norm(t) for a, b, t in asr if s - 300 <= (a + b) / 2 <= e + 300)
    if len(sub) >= 3 and "".join(sub) == heard:
        conn.execute("UPDATE lines SET fr_final = fr WHERE id = ?", (lid,))
        ws = split_words(fr)
        conn.executemany("INSERT INTO words (line_id, idx, text, char_start, char_end) VALUES (?,?,?,?,?)",
                         [(lid, i, w, a, b) for i, (w, a, b) in enumerate(ws, 1)])
        n += 1; nw += len(ws); songs += song
conn.commit()
print(f"{dst}: {n} lines ({songs} sung), {nw} words")
