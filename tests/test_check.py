"""The data sanity check: a clean scene passes, and each check fires on its defect."""

from __future__ import annotations

import json
from dataclasses import asdict

import pytest

from frenchirix import cli, render
from frenchirix.check import CHECKS, ERROR, WARNING, Checker, Finding, report

from test_transcribe import make_db

SID = "s01e04-0001-0002"
L1, L2, L3 = "s01e04-0001", "s01e04-0002", "s01e04-0003"
# line -> [(start, end, score)] per word of its final French
TIMES = {
    1: [(10_000, 10_200, 0.9), (10_300, 10_700, 0.8), (10_800, 11_500, 0.9)],  # Euh, bonjour Astérix.
    2: [(12_600, 12_800, 0.9), (12_900, 13_200, 0.7), (13_300, 13_500, 0.9), (13_500, 13_800, None)],
}
UNITS = {  # line -> (kind, first word, last word, text, en)
    1: [("expression", 1, 1, "Euh", "uh"), ("expression", 2, 3, "bonjour Astérix", "hello Astérix")],
    2: [("expression", 1, 2, "Tu viens", "you come"), ("expression", 3, 4, "avec moi", "with me")],
}


@pytest.fixture
def env(tmp_path):
    """A database with one clean, rendered and annotated scene, and its media files."""
    conn = make_db(tmp_path / "db.sqlite", [
        (1, 10_000, 12_000, "Bonjour Astérix.", "Euh, bonjour Astérix."),
        (2, 12_500, 14_000, "Tu viens ?", "Tu viens avec moi ?"),
        (3, 30_000, 31_000, "Non.", None),  # in no scene, not annotated
    ])
    for idx, en in ((1, "Uh, hello Astérix."), (2, "Are you coming with me?")):
        conn.execute("UPDATE lines SET en_literal = ?, annotated_by = 'test' WHERE idx = ?", (en, idx))
    for idx in (1, 2, 3):
        conn.execute("INSERT INTO translations (episode_id, lang, group_idx, first_line_idx, last_line_idx, "
                     "text, source) VALUES ('s01e04', 'en', ?, ?, ?, 'x', 'subtitle:7')", (idx, idx, idx))
    for line, ws in TIMES.items():
        for n, (a, b, sc) in enumerate(ws, 1):
            conn.execute("UPDATE words SET start_ms = ?, end_ms = ?, score = ? WHERE line_id = ? AND idx = ?",
                         (a, b, sc, f"s01e04-{line:04d}", n))
        conn.execute("UPDATE lines SET audio_start_ms = ?, audio_end_ms = ? WHERE idx = ?",
                     (ws[0][0], ws[-1][1], line))
    for line, us in UNITS.items():
        for n, (k, a, b, t, en) in enumerate(us, 1):
            conn.execute("INSERT INTO units (line_id, idx, kind, first_word_idx, last_word_idx, text, en) "
                         "VALUES (?, ?, ?, ?, ?, ?, ?)", (f"s01e04-{line:04d}", n, k, a, b, t, en))
    w = render.clip_window(10_000, 14_000, 60_000)
    params = json.dumps({"render_version": render.RENDER_VERSION, **asdict(render.SETTINGS)})
    conn.execute(
        "INSERT INTO scenes (id, episode_id, first_line_idx, last_line_idx, core_start_ms, core_end_ms, title, "
        "kind, tags, score, why, selected_by, created_at, clip_start_ms, clip_end_ms, fade_in_ms, fade_out_ms, "
        "audio_file, video_file, frame_times_ms, audio_lufs, audio_peak_db, render_params) VALUES "
        "(?, 's01e04', 1, 2, 10000, 14000, 'Greeting', 'dialogue', '[\"joke\"]', 3, 'why', 'test', 'now', "
        "?, ?, ?, ?, ?, ?, ?, -25.0, -9.0, ?)",
        (SID, w.clip_start_ms, w.clip_end_ms, w.fade_in_ms, w.fade_out_ms, f"audio/{SID}.opus",
         f"video/{SID}.mp4", json.dumps(render.frame_times(w, 10_000)), params))
    conn.execute("INSERT INTO notes (scene_id, idx, kind, text, phrase, line_id, first_word_idx, "
                 "last_word_idx) VALUES (?, 1, 'wordplay', 'A name.', 'Astérix', ?, 3, 3)", (SID, L1))
    conn.commit()
    assets = tmp_path / "assets"
    for sub, ext in (("audio", "opus"), ("video", "mp4")):
        (assets / sub).mkdir(parents=True)
        (assets / sub / f"{SID}.{ext}").write_bytes(b"x")
    return conn, assets


def run_checks(conn, assets, episode=None, media=True):
    return Checker(conn, assets, episode, media).run()


def checks(env, **kw) -> set[str]:
    conn, assets = env
    return {f.check for f in run_checks(conn, assets, **kw)}


def test_clean_scene_passes(env):
    assert run_checks(*env) == []


def sql(*statements):
    def mutate(conn, assets):
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("PRAGMA ignore_check_constraints = ON")
        for s in statements:
            conn.execute(s)
    return mutate


def files(fn):
    return lambda conn, assets: fn(assets)


DEFECTS = [
    ("db.schema_version", sql("UPDATE meta SET value = '3' WHERE key = 'schema_version'")),
    ("db.foreign_keys", sql("INSERT INTO units (line_id, idx, kind, first_word_idx, last_word_idx, text, en) "
                            "VALUES ('nope', 1, 'word', 1, 1, 'x', 'x')")),
    ("db.dangling", sql("INSERT INTO units (line_id, idx, kind, first_word_idx, last_word_idx, text, en) "
                        "VALUES ('nope', 1, 'word', 1, 1, 'x', 'x')")),
    ("db.dangling", sql(f"INSERT INTO words (line_id, idx, text, char_start, char_end) VALUES ('{L3}', 1, 'Non', 0, 3)")),
    ("db.dangling", sql("INSERT INTO notes (scene_id, idx, kind, text) VALUES ('gone', 1, 'reference', 'x')")),
    ("scene.id", sql(f"UPDATE scenes SET id = 's01e04-0001-0003' WHERE id = '{SID}'")),
    ("scene.lines", sql("UPDATE scenes SET last_line_idx = 4")),
    ("scene.core", sql("UPDATE scenes SET core_end_ms = core_start_ms")),
    ("scene.core", sql("UPDATE scenes SET core_start_ms = 10500")),
    ("scene.core_wide", sql("UPDATE scenes SET core_start_ms = 7000")),
    ("scene.fields", sql("UPDATE scenes SET title = '  '")),
    ("scene.fields", sql("UPDATE scenes SET score = NULL")),
    ("scene.fields", sql("UPDATE scenes SET why = ''")),
    ("scene.fields", sql("UPDATE scenes SET kind = 'drama'")),
    ("scene.tags", sql("UPDATE scenes SET tags = '\"joke\"'")),
    ("scene.tags", sql("UPDATE scenes SET tags = '[1]'")),
    ("scene.tags", sql("UPDATE scenes SET tags = 'not json'")),
    ("scene.group_split", sql("UPDATE lines SET group_idx = 2 WHERE idx = 3")),
    ("scene.kind_song", sql("UPDATE scenes SET kind = 'song'")),
    ("media.window", sql("UPDATE scenes SET clip_start_ms = NULL")),
    ("media.window", sql("UPDATE scenes SET clip_start_ms = 10500")),
    ("media.window", sql("UPDATE scenes SET fade_in_ms = 7000")),
    ("media.pending", sql("UPDATE scenes SET render_params = NULL")),
    ("media.stale", sql("UPDATE scenes SET core_start_ms = 9000")),
    ("media.frames", sql("UPDATE scenes SET frame_times_ms = '[0, 3000, 2000]'")),
    ("media.frames", sql("UPDATE scenes SET frame_times_ms = '[5, 100]'")),
    ("media.frames", sql("UPDATE scenes SET frame_times_ms = '[0, 99999]'")),
    ("media.frames", sql("UPDATE scenes SET frame_times_ms = 'oops'")),
    ("media.frames", sql("UPDATE scenes SET frame_times_ms = '[0, 2000, 7958]'")),  # not what the settings give
    ("media.files", files(lambda a: (a / "audio" / f"{SID}.opus").unlink())),
    ("media.files", files(lambda a: (a / "video" / f"{SID}.mp4").write_bytes(b""))),
    ("media.files", sql("UPDATE scenes SET video_file = NULL")),
    ("media.file_name", sql("UPDATE scenes SET audio_file = 'audio/other.opus'")),
    ("media.render_version", sql("UPDATE scenes SET render_params = '{\"render_version\": 1}'")),
    ("media.silent", sql("UPDATE scenes SET audio_peak_db = NULL")),
    ("media.orphan", files(lambda a: (a / "audio" / "s01e04-0009-0009.opus").write_bytes(b"x"))),
    ("media.orphan", files(lambda a: (a / ".render-s01e04-0001-0002-abc").mkdir())),
    ("text.missing", sql("UPDATE lines SET en_literal = NULL WHERE idx = 2")),
    ("text.missing", sql("UPDATE lines SET fr_final = ' ' WHERE idx = 2")),
    ("text.missing", sql("UPDATE lines SET fr = '' WHERE idx = 1")),
    ("text.translation", sql("DELETE FROM translations WHERE group_idx = 1")),
    ("text.same_as_fr", sql("UPDATE lines SET en_literal = 'Euh, bonjour Astérix!' WHERE idx = 1")),
    ("text.length", sql("UPDATE lines SET fr = 'Bonjour Astérix, comment vas-tu aujourd''hui mon ami ?' "
                        "WHERE idx = 1")),
    ("text.shape", sql("UPDATE lines SET fr = '- Bonjour\n- Astérix.' WHERE idx = 1")),
    ("text.whitespace", sql("UPDATE lines SET en_literal = 'Uh,  hello Astérix.' WHERE idx = 1")),
    ("text.annotated_by", sql("UPDATE lines SET annotated_by = NULL WHERE idx = 1")),
    ("text.unused", sql("UPDATE lines SET fr_final = 'Non.' WHERE idx = 3")),
    ("words.tokens", sql(f"UPDATE words SET text = 'bonjur' WHERE line_id = '{L1}' AND idx = 2")),
    ("words.tokens", sql(f"DELETE FROM words WHERE line_id = '{L1}' AND idx = 3")),
    ("words.tokens", sql(f"UPDATE words SET idx = 7 WHERE line_id = '{L1}' AND idx = 3")),
    ("words.untimed", sql(f"UPDATE words SET start_ms = NULL WHERE line_id = '{L2}' AND idx = 2")),
    ("words.order", sql(f"UPDATE words SET end_ms = start_ms WHERE line_id = '{L2}' AND idx = 2")),
    ("words.order", sql(f"UPDATE words SET start_ms = 12700 WHERE line_id = '{L2}' AND idx = 2")),
    ("words.across_lines", sql(f"UPDATE words SET start_ms = 11000 WHERE line_id = '{L2}' AND idx = 1",
                               "UPDATE lines SET audio_start_ms = 11000 WHERE idx = 2")),
    ("words.outside_clip", sql(f"UPDATE words SET start_ms = 7000 WHERE line_id = '{L1}' AND idx = 1",
                               "UPDATE lines SET audio_start_ms = 7000 WHERE idx = 1")),
    ("words.line_audio", sql("UPDATE lines SET audio_end_ms = audio_end_ms + 1 WHERE idx = 1")),
    ("words.line_audio", sql(f"UPDATE words SET end_ms = NULL WHERE line_id = '{L1}' AND idx = 2")),
    ("words.score", sql(f"UPDATE words SET score = 1.5 WHERE line_id = '{L1}' AND idx = 2")),
    ("units.cover", sql(f"DELETE FROM units WHERE line_id = '{L1}' AND idx = 2")),
    ("units.cover", sql(f"DELETE FROM units WHERE line_id = '{L1}' AND idx = 1")),
    ("units.cover", sql(f"UPDATE units SET first_word_idx = 1 WHERE line_id = '{L1}' AND idx = 2")),
    ("units.cover", sql(f"DELETE FROM units WHERE line_id = '{L2}'")),
    ("units.kind", sql(f"UPDATE units SET kind = 'phrase' WHERE line_id = '{L1}' AND idx = 1")),
    ("units.gloss", sql(f"UPDATE units SET en = ' ' WHERE line_id = '{L1}' AND idx = 1")),
    ("units.text", sql(f"UPDATE units SET text = 'bonjour' WHERE line_id = '{L1}' AND idx = 2")),
    ("units.line_break", sql("UPDATE lines SET fr_final = 'Tu viens' || char(10) || 'avec moi ?' WHERE idx = 2",
                             f"DELETE FROM units WHERE line_id = '{L2}' AND idx = 2",
                             f"UPDATE units SET last_word_idx = 4, text = 'Tu viens' || char(10) || 'avec moi' "
                             f"WHERE line_id = '{L2}'")),
    ("units.note", sql(f"UPDATE units SET note = '' WHERE line_id = '{L1}' AND idx = 1")),
    ("note.kind", sql("UPDATE notes SET kind = 'joke'")),
    ("note.text", sql("UPDATE notes SET text = ''")),
    ("note.phrase", sql("UPDATE notes SET line_id = NULL")),
    ("note.phrase", sql(f"UPDATE notes SET line_id = '{L3}'")),
    ("note.phrase", sql("UPDATE notes SET last_word_idx = NULL")),
    ("note.span", sql("UPDATE notes SET first_word_idx = 2, last_word_idx = 2")),
    ("note.span", sql("UPDATE notes SET first_word_idx = 9, last_word_idx = 9")),
    ("note.order", sql("UPDATE notes SET idx = 2")),
    ("note.unlocated", sql("UPDATE notes SET first_word_idx = NULL, last_word_idx = NULL")),
    ("timing.unreliable", sql(f"UPDATE words SET score = 0.0 WHERE line_id = '{L2}'")),
    ("timing.fade", sql(f"UPDATE words SET start_ms = 8500 WHERE line_id = '{L1}' AND idx = 1",
                        "UPDATE lines SET audio_start_ms = 8500 WHERE idx = 1")),
    ("timing.fade", sql(f"UPDATE words SET end_ms = 14900 WHERE line_id = '{L2}' AND idx = 4",
                        "UPDATE lines SET audio_end_ms = 14900 WHERE idx = 2")),
    ("timing.far", sql(f"UPDATE words SET end_ms = 16600 WHERE line_id = '{L2}' AND idx = 4",
                       "UPDATE lines SET audio_end_ms = 16600 WHERE idx = 2")),
]


@pytest.mark.parametrize("check, mutate", DEFECTS, ids=[f"{c}-{i}" for i, (c, _) in enumerate(DEFECTS)])
def test_each_check_fires_on_its_defect(env, check, mutate):
    mutate(*env)
    assert check in checks(env)


def test_every_check_is_tested():
    untested = set(CHECKS) - {c for c, _ in DEFECTS} - {"db.integrity"}  # cannot corrupt a file portably
    assert not untested


def test_a_defect_fires_only_its_own_check(env):
    sql(f"UPDATE units SET en = '' WHERE line_id = '{L1}' AND idx = 1")(*env)
    found = run_checks(*env)
    assert [(f.severity, f.check, f.episode, f.scene, f.line) for f in found] == \
        [(ERROR, "units.gloss", "s01e04", SID, 1)]


def test_no_media_skips_only_file_existence(env):
    conn, assets = env
    (assets / "audio" / f"{SID}.opus").unlink()
    (assets / "audio" / "stray.opus").write_bytes(b"x")
    assert checks(env, media=False) == set()
    sql("UPDATE scenes SET render_params = NULL")(*env)
    assert checks(env, media=False) == {"media.pending"}


def test_episode_filter(env):
    sql("UPDATE scenes SET title = ''")(*env)
    assert checks(env, episode="s01e05") == set()
    assert checks(env, episode="s01e04") == {"scene.fields"}


def test_report_groups_errors_first_limits_and_summarises():
    found = [Finding(WARNING, "timing.unreliable", "x", "s01e04", "s01e04-0001-0002", n) for n in range(1, 6)]
    found.append(Finding(ERROR, "units.gloss", "empty", "s01e04", "s01e04-0001-0002", 3))
    text = report(found, limit=2)
    lines = text.splitlines()
    assert lines[0].split()[:5] == ["error", "units.gloss", "s01e04", "s01e04-0001-0002", "0003"]
    assert sum(1 for l in lines if l.startswith("warning")) == 2
    assert "summary: 1 errors, 5 warnings" in text
    assert lines[-2].split() == ["error", "units.gloss", "1"]
    assert lines[-1].split() == ["warning", "timing.unreliable", "5", "(3", "not", "shown)"]


def test_cli_exit_code_and_read_only(env, tmp_path, capsys):
    conn, assets = env
    db = tmp_path / "db.sqlite"
    args = ["check", "--db", str(db), "--assets", str(assets)]
    assert cli.main(args) == 0
    sql("UPDATE scenes SET render_params = NULL")(conn, assets)
    conn.commit()
    before = db.read_bytes()
    assert cli.main(args) == 1
    assert cli.main(args + ["--no-media", "--limit", "1"]) == 1
    assert db.read_bytes() == before
    out = capsys.readouterr().out
    assert "media.pending" in out and "summary: 1 errors, 0 warnings" in out
    assert cli.main(["check", "--db", str(tmp_path / "missing.sqlite")]) == 1
