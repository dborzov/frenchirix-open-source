"""Lines vs subtitle times and scene edges vs fades, for one episode. Numbers and line ids only.
.venv/bin/python scripts/eval/line_report.py <db> <episode>"""
import sqlite3, sys
db, ep = sys.argv[1:3]
c = sqlite3.connect(db)
c.execute("PRAGMA busy_timeout = 20000")
rows = c.execute("""SELECT l.idx, l.start_ms, l.end_ms, l.audio_start_ms, l.audio_end_ms,
    (SELECT AVG(score) FROM words w WHERE w.line_id = l.id), (SELECT MIN(score) FROM words w WHERE w.line_id = l.id),
    (SELECT COUNT(*) FROM words w WHERE w.line_id = l.id)
    FROM lines l WHERE l.episode_id = ? AND l.audio_start_ms IS NOT NULL ORDER BY l.idx""", (ep,)).fetchall()
def within(r, x): return abs(r[3] - r[1]) <= x and abs(r[4] - r[2]) <= x
print(f"aligned lines {len(rows)}; within 0.5 s at both ends {sum(within(r,500) for r in rows)}; within 1.5 s {sum(within(r,1500) for r in rows)}")
print("lines beyond 1.5 s (idx, start delta, end delta, mean score, words):")
for r in rows:
    if not within(r, 1500) or r[0] in (39, 129, 182, 183, 266, 391):
        print(f"   {r[0]} {r[3]-r[1]:+d} {r[4]-r[2]:+d} {r[5] if r[5] is None else round(r[5],3)} {r[7]}")
unrel = [r[0] for r in rows if r[6] == 0.0 and r[5] == 0.0]
print(f"lines with every word scored 0 (unreliable): {unrel}")
early = late = 0
for sid, cs, ce, cls, cle, fi, fo, first, last in c.execute(
        "SELECT id, core_start_ms, core_end_ms, clip_start_ms, clip_end_ms, fade_in_ms, fade_out_ms, first_line_idx, last_line_idx FROM scenes WHERE episode_id = ?", (ep,)):
    a = c.execute("SELECT audio_start_ms FROM lines WHERE episode_id=? AND idx=?", (ep, first)).fetchone()[0]
    b = c.execute("SELECT audio_end_ms FROM lines WHERE episode_id=? AND idx=?", (ep, last)).fetchone()[0]
    # full volume runs from clip_start + fade_in to clip_end - fade_out
    if a is not None and cls is not None and a < cls + fi:
        early += 1; print(f"   {sid}: first line starts {cls + fi - a} ms inside the fade-in")
    if b is not None and cle is not None and b > cle - fo:
        late += 1; print(f"   {sid}: last line ends {b - (cle - fo)} ms inside the fade-out")
n = c.execute("SELECT COUNT(*) FROM scenes WHERE episode_id=?", (ep,)).fetchone()[0]
print(f"scenes {n}: first line inside fade-in {early}, last line inside fade-out {late}")
