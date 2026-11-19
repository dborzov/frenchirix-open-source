import pytest

from frenchirix.db import connect
from frenchirix.importer import build, write
from frenchirix.selection import SelectionError, import_selection

from text_fixtures import FAKE_INFO, texts


@pytest.fixture
def conn(tmp_path):
    c = connect(tmp_path / "db.sqlite")
    # Lines 1-5; lines 2-3 form one translation group.
    write(c, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    return c


def scene(first, last, **kw):
    s = {"first": first, "last": last, "title": "A title", "kind": "dialogue",
         "tags": ["joke"], "score": 4, "why": "Because."}
    s.update(kw)
    return s


def sel(*scenes, selector="sonnet:select-v1", episode="s01e04"):
    return {"episode": episode, "selector": selector, "scenes": list(scenes)}


def test_insert_fills_ids_times_and_created_at(conn):
    res = import_selection(conn, "s01e04", sel(scene(1, 1), scene(4, 5)), now="2026-11-13T00:00:00+00:00")
    assert res.inserted == ["s01e04-0001-0001", "s01e04-0004-0005"] and not res.warnings
    row = conn.execute("SELECT * FROM scenes WHERE id = 's01e04-0004-0005'").fetchone()
    assert (row["core_start_ms"], row["core_end_ms"]) == (9000, 14800)
    assert row["tags"] == '["joke"]'
    assert row["created_at"] == "2026-11-13T00:00:00+00:00"
    assert row["selected_by"] == "sonnet:select-v1"


def test_range_splitting_a_group_is_extended(conn):
    res = import_selection(conn, "s01e04", sel(scene(1, 2), scene(3, 3)))
    assert res.inserted == ["s01e04-0001-0003", "s01e04-0002-0003"]
    assert len(res.warnings) == 2 and all("extended" in w for w in res.warnings)


def test_bad_ranges_and_fields_are_rejected_and_nothing_is_written(conn):
    with pytest.raises(SelectionError) as e:
        import_selection(conn, "s01e04", sel(
            scene(1, 1), scene(4, 9), scene(3, 2), scene(0, 1), scene("1", 2),
            scene(1, 1, kind="poem"), scene(1, 1, score=6)))
    msgs = "\n".join(e.value.errors)
    assert "no line 9" in msgs and "first is after last" in msgs and "no line 0" in msgs
    assert "must be integers" in msgs and "kind" in msgs and "score" in msgs
    assert conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0] == 0


def test_wrong_episode_is_rejected(conn):
    with pytest.raises(SelectionError):
        import_selection(conn, "s01e04", sel(scene(1, 1), episode="s01e05"))


def test_rerun_updates_selector_fields_but_keeps_created_at_and_render(conn):
    import_selection(conn, "s01e04", sel(scene(1, 1)), now="2026-01-01T00:00:00+00:00")
    conn.execute("UPDATE scenes SET clip_start_ms = 0, "
                 "audio_file = 'audio/s01e04-0001-0001.opus'")
    conn.commit()
    res = import_selection(conn, "s01e04", sel(scene(1, 1, title="New title", score=5),
                                               selector="sonnet:select-v2"),
                           now="2026-02-02T00:00:00+00:00")
    assert res.updated == ["s01e04-0001-0001"] and not res.inserted
    row = conn.execute("SELECT * FROM scenes").fetchone()
    assert (row["title"], row["score"], row["selected_by"]) == ("New title", 5, "sonnet:select-v2")
    assert (row["clip_start_ms"], row["audio_file"]) == (0, "audio/s01e04-0001-0001.opus")
    assert row["created_at"] == "2026-01-01T00:00:00+00:00"


def test_scenes_missing_from_a_rerun_are_left_alone(conn):
    import_selection(conn, "s01e04", sel(scene(1, 1), scene(5, 5)))
    res = import_selection(conn, "s01e04", sel(scene(1, 1)))
    assert res.untouched == ["s01e04-0005-0005"]
    assert conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0] == 2


def test_limits_warn(conn, monkeypatch):
    import frenchirix.selection as s
    monkeypatch.setattr(s, "MAX_LINES", 2)
    monkeypatch.setattr(s, "MAX_MS", 5000)
    res = import_selection(conn, "s01e04", sel(scene(1, 5, title="One two three four five six seven")))
    text = "\n".join(res.warnings)
    assert "5 lines" in text and "13.8 s" in text and "title" in text
    assert res.inserted == ["s01e04-0001-0005"]


def test_duplicate_range_keeps_first(conn):
    res = import_selection(conn, "s01e04", sel(scene(2, 3, title="First"), scene(2, 2, title="Second")))
    assert res.inserted == ["s01e04-0002-0003"]
    assert conn.execute("SELECT title FROM scenes").fetchone()[0] == "First"
