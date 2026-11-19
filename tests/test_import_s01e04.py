"""Integration test against the real episode; skipped when content/ is absent.
Slow (it reads content/): run with `-m slow`."""

import pytest

from frenchirix.db import REPO_ROOT, connect
from frenchirix.importer import import_episode
from frenchirix.sheet import sheet_for

# The original show's episode: the expected numbers below hold for that file only.
SOURCE = REPO_ROOT / "content" / "Asterix.S01E04.mkv"
pytestmark = [pytest.mark.slow,
              pytest.mark.skipif(not SOURCE.exists(), reason="content/ not available")]


def test_import_s01e04(tmp_path):
    conn = connect(tmp_path / "db.sqlite")
    msg, imp = import_episode(conn, "s01e04", SOURCE, show="Astérix & Obélix : Le Combat des chefs")
    assert {t: len(c) for t, c in imp.cues.items()} == {"fr": 448, "fr_sdh": 588, "en": 430}
    assert imp.streams == {"audio": 3, "fr": 11, "fr_sdh": 12, "en": 7}
    lines = conn.execute("SELECT id, idx FROM lines ORDER BY idx").fetchall()
    assert len(lines) == 448 and lines[40]["id"] == "s01e04-0041"
    untranslated = conn.execute(
        "SELECT COUNT(*) FROM lines l JOIN translations t ON t.episode_id = l.episode_id "
        "AND t.group_idx = l.group_idx WHERE t.text = ''").fetchone()[0]
    assert untranslated == 17   # 18 from the subtitles, line 22 filled by corrections/
    assert conn.execute("SELECT COUNT(*) FROM translations WHERE source = 'correction'").fetchone()[0] == 2
    # Plain cue 10 is one line in the source; the lyric break comes from the SDH cue.
    assert conn.execute("SELECT fr FROM lines WHERE idx = 10").fetchone()[0] == \
        "C'est un monde romain\nPas un monde gaulois"
    # Groups tile the lines with no gap or overlap.
    spans = conn.execute(
        "SELECT first_line_idx, last_line_idx FROM translations ORDER BY group_idx").fetchall()
    assert spans[0][0] == 1 and spans[-1][1] == 448
    assert all(a[1] + 1 == b[0] for a, b in zip(spans, spans[1:]))
    # Re-import is a no-op.
    msg2, _ = import_episode(conn, "s01e04", SOURCE)
    assert "unchanged" in msg2
    sheet = sheet_for(conn, "s01e04")
    assert sum(1 for row in sheet.splitlines() if row[:4].isdigit()) == 448
