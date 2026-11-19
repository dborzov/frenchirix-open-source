"""Widening scene cores from aligned speech. No models, no media."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from frenchirix import render, retime
from frenchirix.retime import RetimeSettings, edge_time, new_core

from test_transcribe import make_db

S = RetimeSettings(max_shift_ms=2500, min_shift_ms=200, min_line_score=0.5, min_edge_word_score=0.3)


def test_edge_time():
    good = [(1_000, 1_200, 0.9), (1_300, 1_500, 0.8), (1_600, 1_900, 0.7)]
    assert edge_time(good, 0, S) == 1_000 and edge_time(good, -1, S) == 1_900
    weak_edges = [(1_000, 1_200, 0.0), (1_300, 1_500, 1.0), (1_600, 1_900, 1.0), (2_000, 2_100, 0.1)]  # mean 0.525
    assert edge_time(weak_edges, 0, S) == 1_300 and edge_time(weak_edges, -1, S) == 1_900
    assert edge_time([(1_000, 1_200, 0.0), (1_300, 1_500, 0.0)], 0, S) is None  # guard: unreliable
    assert edge_time([(1_000, 1_200, 0.2), (1_300, 1_500, 0.7)], 0, S) is None  # mean 0.45
    assert edge_time([], 0, S) is None  # untimed
    assert edge_time([(1_000, 1_200, None), (1_300, 1_500, 0.9)], 0, S) == 1_300


def test_new_core_only_widens_is_capped_and_ignores_small_shifts():
    assert new_core(10_000, 20_000, 8_200, 21_000, S) == (8_200, 21_000)
    assert new_core(10_000, 20_000, 10_500, 19_000, S) == (10_000, 20_000)  # no shrink
    assert new_core(10_000, 20_000, 6_000, 25_000, S) == (7_500, 22_500)  # cap
    assert new_core(10_000, 20_000, 9_850, 20_150, S) == (10_000, 20_000)  # under 200 ms
    assert new_core(10_000, 20_000, None, None, S) == (10_000, 20_000)


@pytest.fixture
def db(tmp_path, monkeypatch):
    conn = make_db(tmp_path / "db.sqlite", [
        (1, 10_000, 12_000, "Bonjour.", "Euh, bonjour."),
        (2, 12_500, 14_000, "Oui.", "Oui."),
        (3, 30_000, 32_000, "Non.", "Non, non."),
    ])
    for sid, first, last, a, b in (("s01e04-0001-0002", 1, 2, 10_000, 14_000),
                                   ("s01e04-0003-0003", 3, 3, 30_000, 32_000)):
        conn.execute("INSERT INTO scenes (id, episode_id, first_line_idx, last_line_idx, core_start_ms, "
                     "core_end_ms, title, kind, selected_by, created_at) VALUES "
                     "(?, 's01e04', ?, ?, ?, ?, 't', 'dialogue', 'test', 'now')", (sid, first, last, a, b))
    times = {  # line -> [(start, end, score)] per word
        1: [(8_400, 8_700, 0.9), (8_800, 9_300, 0.8)],  # "Euh" restored, spoken 1.6 s early
        2: [(12_600, 13_000, 0.9)],
        3: [(29_000, 29_300, 0.1), (29_400, 29_800, 0.3)],  # mean 0.2: not trusted
    }
    for line, ws in times.items():
        for n, (a, b, sc) in enumerate(ws, 1):
            conn.execute("UPDATE words SET start_ms = ?, end_ms = ?, score = ? WHERE line_id = ? AND idx = ?",
                         (a, b, sc, f"s01e04-{line:04d}", n))
        conn.execute("UPDATE lines SET audio_start_ms = ?, audio_end_ms = ? WHERE idx = ?",
                     (ws[0][0], ws[-1][1], line))
    conn.commit()

    def fake_job(conn, sid):
        a, b = conn.execute("SELECT core_start_ms, core_end_ms FROM scenes WHERE id = ?", (sid,)).fetchone()
        return SimpleNamespace(core_start_ms=a, core_end_ms=b, episode_duration_ms=60_000)

    monkeypatch.setattr(render, "_job", fake_job)
    return conn


def _render_as_now(conn, sid):
    """Pretend the scene was rendered for its current core."""
    a, b = conn.execute("SELECT core_start_ms, core_end_ms FROM scenes WHERE id = ?", (sid,)).fetchone()
    w = render.clip_window(a, b, 60_000)
    conn.execute("UPDATE scenes SET render_params = '{}', audio_file = 'a', video_file = 'v', clip_start_ms = ?, "
                 "clip_end_ms = ?, fade_in_ms = ?, fade_out_ms = ? WHERE id = ?",
                 (w.clip_start_ms, w.clip_end_ms, w.fade_in_ms, w.fade_out_ms, sid))
    conn.commit()


def test_retime_widens_marks_media_and_is_repeatable(db):
    _render_as_now(db, "s01e04-0001-0002")
    _render_as_now(db, "s01e04-0003-0003")
    changes, stale = retime.retime_episode(db, "s01e04", settings=S)
    assert [(c.scene_id, c.start_shift_ms, c.end_shift_ms) for c in changes] == [
        ("s01e04-0001-0002", -1_600, 0)]  # end stays: line 2 ends before its subtitle
    assert stale == ["s01e04-0001-0002"]
    params = dict(db.execute("SELECT id, render_params FROM scenes").fetchall())
    assert params == {"s01e04-0001-0002": None, "s01e04-0003-0003": "{}"}

    # Again, before rendering: nothing moves, the scene stays queued for render.
    assert retime.retime_episode(db, "s01e04", settings=S) == ([], [])
    assert not render._is_rendered(db, "s01e04-0001-0002", render.ASSETS_DIR)

    # After rendering it is current.
    _render_as_now(db, "s01e04-0001-0002")
    assert retime.retime_episode(db, "s01e04", settings=S) == ([], [])


def test_select_import_reset_is_undone_without_new_media(db):
    retime.retime_episode(db, "s01e04", settings=S)
    _render_as_now(db, "s01e04-0001-0002")
    # select-import writes subtitle times back into the core
    db.execute("UPDATE scenes SET core_start_ms = 10000 WHERE id = 's01e04-0001-0002'")
    db.commit()
    changes, stale = retime.retime_episode(db, "s01e04", settings=S)
    assert [c.new for c in changes] == [(8_400, 14_000)]
    assert stale == []  # the media already match the widened core


def test_media_rendered_on_a_reset_core_is_marked(db):
    _render_as_now(db, "s01e04-0001-0002")  # rendered on subtitle times
    changes, stale = retime.retime_episode(db, "s01e04", settings=S)
    assert stale == ["s01e04-0001-0002"]
