import sqlite3, sys
a, b, ep = sys.argv[1:4]
def load(db):
    c = sqlite3.connect(db); c.execute("PRAGMA busy_timeout=20000")
    return {r[0]: r[1:] for r in c.execute("""SELECT l.idx, l.start_ms, l.end_ms, l.audio_start_ms, l.audio_end_ms,
      (SELECT AVG(score) FROM words w WHERE w.line_id=l.id) FROM lines l WHERE episode_id=? AND audio_start_ms IS NOT NULL""", (ep,))}
A, B = load(a), load(b)
worse = 0
for i in sorted(A):
    x, y = A[i], B[i]
    if (x[2], x[3]) != (y[2], y[3]):
        ex = max(abs(x[2]-x[0]), abs(x[3]-x[1])); ey = max(abs(y[2]-y[0]), abs(y[3]-y[1]))
        worse += ey > ex + 100
        print(f"{i}: worst-edge delta {ex} -> {ey} ms, mean score {x[4] and round(x[4],2)} -> {y[4] and round(y[4],2)}")
print("lines whose worst edge moved further from the subtitle by >100 ms:", worse)
