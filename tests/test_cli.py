import sys
import types

import frenchirix
from frenchirix import cli
from frenchirix.db import connect
from frenchirix.importer import build, write
from frenchirix.selection import import_selection

from text_fixtures import FAKE_INFO, texts


def test_render_passes_scene_ids_and_force(tmp_path, monkeypatch):
    conn = connect(tmp_path / "db.sqlite")
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    scenes = [{"first": a, "last": b, "title": "t", "kind": "dialogue", "tags": [], "score": 3,
               "why": "w"} for a, b in ((1, 1), (2, 3), (4, 5))]
    import_selection(conn, "s01e04", {"episode": "s01e04", "selector": "x", "scenes": scenes})

    calls = []
    fake = types.ModuleType("frenchirix.render")
    fake.render_scenes = lambda c, ids, force=False: calls.append((ids, force))
    monkeypatch.setitem(sys.modules, "frenchirix.render", fake)
    monkeypatch.setattr(frenchirix, "render", fake, raising=False)
    monkeypatch.setattr(cli, "connect", lambda: conn)

    assert cli.main(["render", "--episode", "s01e04"]) == 0
    assert cli.main(["render", "--scene", "s01e04-0004-0005", "--force"]) == 0
    assert cli.main(["render", "--scene", "nope"]) == 1
    assert calls == [
        (["s01e04-0001-0001", "s01e04-0002-0003", "s01e04-0004-0005"], False),
        (["s01e04-0004-0005"], True),
    ]


def test_transcribe_and_align_wiring(tmp_path, monkeypatch):
    from frenchirix import forced_align

    conn = connect(tmp_path / "db.sqlite")
    calls = []
    fake = types.ModuleType("frenchirix.transcribe")
    fake.transcribe_episode = lambda c, ep, force=False: calls.append(("t", c is conn, ep, force))
    monkeypatch.setitem(sys.modules, "frenchirix.transcribe", fake)
    monkeypatch.setattr(frenchirix, "transcribe", fake, raising=False)
    monkeypatch.setattr(forced_align, "align_episode",
                        lambda c, ep, force=False, guard=None, lines=None, confirm=False: calls.append(
                            ("a", c is conn, ep, force, lines, guard.slack_ms, confirm)))
    monkeypatch.setattr(cli, "connect", lambda: conn)
    assert cli.main(["transcribe", "s01e04"]) == 0
    assert cli.main(["align", "s01e04", "--force"]) == 0
    assert cli.main(["align", "s01e03", "--lines", "19-21,24", "--slack-ms", "300", "--confirm"]) == 0
    assert calls == [("t", True, "s01e04", False),
                     ("a", True, "s01e04", True, None, forced_align.GUARD.slack_ms, False),
                     ("a", True, "s01e03", False, {19, 20, 21, 24}, 300, True)]


def test_annotate_commands_report_errors(tmp_path, monkeypatch, capsys):
    conn = connect(tmp_path / "db.sqlite")
    monkeypatch.setattr(cli, "connect", lambda: conn)
    assert cli.main(["annotate-sheet", "s01e04"]) == 1
    assert "transcribe" in capsys.readouterr().err
    assert cli.main(["annotate-import", "s01e04", "--dir", str(tmp_path / "none")]) == 1
    assert "nothing was written" in capsys.readouterr().err
