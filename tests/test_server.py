"""The web UI server (frenchirix/server.py) against a temporary database and assets dir."""

import http.client
import json
import sqlite3
import threading

import pytest

from frenchirix.db import connect
from frenchirix.importer import build, write
from frenchirix.selection import import_selection
from frenchirix.server import make_server, parse_range

from text_fixtures import FAKE_INFO, texts

AUDIO_BYTES = bytes(range(256)) * 40  # 10240 bytes


@pytest.fixture
def site(tmp_path):
    db_path = tmp_path / "db.sqlite"
    conn = connect(db_path)
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    scenes = [{"first": a, "last": b, "title": f"t{a}", "kind": k, "tags": tags, "score": s,
               "why": "w"} for a, b, k, tags, s in (
                   (1, 1, "dialogue", ["joke"], 3),
                   (2, 3, "song", ["song", "plot"], 5),
                   (4, 5, "monologue", [], 4))]
    import_selection(conn, "s01e04", {"episode": "s01e04", "selector": "x", "scenes": scenes})
    # Scene 2-3 is rendered; the others are not.
    conn.execute(
        "UPDATE scenes SET clip_start_ms = 2000, clip_end_ms = 10000, fade_in_ms = 1600, "
        "fade_out_ms = 1600, audio_file = 'audio/s01e04-0002-0003.opus', "
        "video_file = 'video/s01e04-0002-0003.mp4', frame_times_ms = '[0, 2000, 4000, 7500]' "
        "WHERE id = 's01e04-0002-0003'")
    conn.commit()
    conn.close()

    assets = tmp_path / "assets"
    (assets / "audio").mkdir(parents=True)
    (assets / "video").mkdir()
    (assets / "audio" / "s01e04-0002-0003.opus").write_bytes(AUDIO_BYTES)
    (assets / "video" / "s01e04-0002-0003.mp4").write_bytes(b"\0" * 100)
    (tmp_path / "secret.txt").write_text("outside")
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>x</title>")

    httpd = make_server(0, db_path, assets_dir=assets, web_dir=web, quiet=True)
    thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    yield {"port": httpd.server_address[1], "db": db_path}
    httpd.shutdown()
    httpd.server_close()


def request(site, method, path, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", site["port"], timeout=5)
    data = json.dumps(body).encode() if body is not None else None
    c.request(method, path, body=data, headers=headers or {})
    r = c.getresponse()
    payload = r.read()
    c.close()
    return r, payload


def get_json(site, path):
    r, payload = request(site, "GET", path)
    assert r.status == 200, payload
    return json.loads(payload)


def test_episodes(site):
    eps = get_json(site, "/api/episodes")
    assert [e["id"] for e in eps] == ["s01e04"]
    assert eps[0]["scenes"] == 3 and eps[0]["rendered"] == 1
    # The strip ends shortly after the last line, never past the episode.
    assert eps[0]["story_end_ms"] == min(eps[0]["duration_ms"], 14800 + 15000)
    ep = get_json(site, "/api/episodes/s01e04")
    assert len(ep["lines"]) == 5 and ep["lines"][0] == [1000, 3000]


def test_scene_list(site):
    scenes = get_json(site, "/api/episodes/s01e04/scenes")
    assert [s["id"] for s in scenes] == ["s01e04-0001-0001", "s01e04-0002-0003", "s01e04-0004-0005"]
    s = scenes[1]
    assert s["kind"] == "song" and s["score"] == 5 and s["tags"] == ["song", "plot"]
    assert "status" not in s and s["rendered"] is True
    assert s["fr"] == "Il fait beau aujourd'hui."
    assert s["en"] == "Nice weather today."
    assert scenes[0]["rendered"] is False and scenes[0]["clip_start_ms"] is None


def test_scene_detail_multi_line_group(site):
    s = get_json(site, "/api/scenes/s01e04-0002-0003")
    assert [l["fr"] for l in s["lines"]] == ["Il fait beau", "aujourd'hui."]
    # Clip-relative offsets come from the scene_lines view: start_ms - clip_start_ms.
    assert [(l["offset_start_ms"], l["offset_end_ms"]) for l in s["lines"]] == [(2000, 4000), (4100, 6000)]
    assert all(l["is_song"] for l in s["lines"])
    assert s["lines"][0]["group_idx"] == s["lines"][1]["group_idx"]
    assert len(s["groups"]) == 1
    g = s["groups"][0]
    assert (g["first_line_idx"], g["last_line_idx"]) == (2, 3)
    assert g["en"] == "Nice weather today." and g["partial"] is False
    m = s["media"]
    assert m["audio_url"] == "/assets/audio/s01e04-0002-0003.opus"
    assert m["video_url"] == "/assets/video/s01e04-0002-0003.mp4"
    assert m["frame_times_ms"] == [0, 2000, 4000, 7500]
    assert m["fade_in_ms"] == 1600 and m["audio_exists"] and m["video_exists"]


def test_scene_detail_unrendered(site):
    s = get_json(site, "/api/scenes/s01e04-0001-0001")
    assert s["rendered"] is False and s["media"] is None
    assert s["lines"][0]["speaker"] == "Obélix"
    assert s["lines"][0]["offset_start_ms"] is None  # no clip yet
    assert s["groups"][0]["en"] == "Hello, Asterix!"


def test_unknown_ids(site):
    assert request(site, "GET", "/api/scenes/s01e04-0009-0009")[0].status == 404
    assert request(site, "GET", "/api/episodes/s09e09/scenes")[0].status == 404
    assert request(site, "GET", "/api/nothing")[0].status == 404


def test_media_full_and_range(site):
    path = "/assets/audio/s01e04-0002-0003.opus"
    r, body = request(site, "GET", path)
    assert r.status == 200 and body == AUDIO_BYTES
    assert r.getheader("Accept-Ranges") == "bytes"
    assert r.getheader("Content-Type") == "audio/ogg"

    r, body = request(site, "GET", path, headers={"Range": "bytes=100-199"})
    assert r.status == 206 and body == AUDIO_BYTES[100:200]
    assert r.getheader("Content-Range") == f"bytes 100-199/{len(AUDIO_BYTES)}"
    assert r.getheader("Content-Length") == "100"

    r, body = request(site, "GET", path, headers={"Range": "bytes=10000-"})
    assert r.status == 206 and body == AUDIO_BYTES[10000:]

    r, body = request(site, "GET", path, headers={"Range": "bytes=-40"})
    assert r.status == 206 and body == AUDIO_BYTES[-40:]

    r, body = request(site, "GET", path, headers={"Range": "bytes=10000-99999"})
    assert r.status == 206 and body == AUDIO_BYTES[10000:]

    r, body = request(site, "GET", path, headers={"Range": "bytes=20000-"})
    assert r.status == 416 and r.getheader("Content-Range") == f"bytes */{len(AUDIO_BYTES)}"

    r, body = request(site, "HEAD", "/assets/video/s01e04-0002-0003.mp4")
    assert r.status == 200 and body == b"" and r.getheader("Content-Length") == "100"
    assert r.getheader("Content-Type") == "video/mp4"


def test_parse_range():
    assert parse_range("bytes=0-0", 10) == (0, 0)
    assert parse_range("bytes=5-", 10) == (5, 9)
    assert parse_range("bytes=-3", 10) == (7, 9)
    assert parse_range("bytes=-30", 10) == (0, 9)
    assert parse_range("bytes=10-", 10) is None
    assert parse_range("bytes=5-2", 10) is None
    with pytest.raises(ValueError):
        parse_range("bytes=0-1,4-5", 10)


def test_static_and_path_safety(site):
    r, body = request(site, "GET", "/")
    assert r.status == 200 and b"<title>x</title>" in body
    for path in (
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/assets/../secret.txt",
        "/assets/audio/../../secret.txt",
        "/assets/audio/%2e%2e/%2e%2e/secret.txt",
        "/assets/audio/..%2f..%2fsecret.txt",
        "/assets/db.sqlite",            # only audio/ and video/ are served from assets
        "/assets/../db.sqlite",
        "/..%5csecret.txt",
        "/web/../secret.txt",
        "/assets/audio/missing.opus",
    ):
        r, body = request(site, "GET", path)
        assert r.status == 404, path
        assert b"outside" not in body and b"SQLite" not in body, path


def test_cli_serve(tmp_path, monkeypatch):
    from frenchirix import cli, server

    real_serve = server.serve
    calls = []
    monkeypatch.setattr(server, "serve", lambda port, db: calls.append((port, db)) or 0)
    assert cli.main(["serve", "--port", "9001", "--db", str(tmp_path / "x.sqlite")]) == 0
    assert calls == [(9001, tmp_path / "x.sqlite")]
    # The real function refuses a database that does not exist rather than creating one.
    assert real_serve(0, tmp_path / "missing.sqlite") == 1
    assert not (tmp_path / "missing.sqlite").exists()


# --- annotation, alignment and notes in the scene detail -------------------------

ANNOTATIONS = [
    {"line": 2, "fr": "Il fait très beau", "en": "It is very fine",
     "units": [{"t": "Il fait", "k": "expression", "en": "it is"},
               {"t": "très beau", "k": "expression", "en": "very fine", "note": "weather"}]},
    {"line": 3, "fr": "aujourd'hui.", "en": "today.",
     "units": [{"t": "aujourd'hui", "k": "word", "en": "today"}]},
    {"line": 4, "fr": "- Tu viens, toi ?\n- Non.", "en": "- Are you coming, you?\n- No.",
     "units": [{"t": "Tu viens, toi", "k": "expression", "en": "are you coming, you"},
               {"t": "Non", "k": "expression", "en": "no"}]},
]


@pytest.fixture
def annotated(site, tmp_path):
    """Lines 2 and 4 annotated and aligned, line 3 annotated only, lines 1 and 5 not."""
    from frenchirix.annotation import import_annotations

    d = tmp_path / "ann"
    d.mkdir()
    (d / "01.jsonl").write_text("\n".join(json.dumps(a, ensure_ascii=False) for a in ANNOTATIONS))
    conn = connect(site["db"])
    import_annotations(conn, "s01e04", d, "test")
    times = {  # line id -> [(start, end, score)] per word
        "s01e04-0002": [(4100, 4300, 0.9), (4300, 4600, 0.8), (4650, 5000, 0.95), (5000, 5600, 0.7)],
        "s01e04-0004": [(9100, 9400, 0.9), (9400, 9900, 0.2), (9900, 10200, None), (11100, 11500, 0.88)],
    }
    for line_id, ws in times.items():
        conn.executemany("UPDATE words SET start_ms = ?, end_ms = ?, score = ? WHERE line_id = ? AND idx = ?",
                         [(a, b, s, line_id, n) for n, (a, b, s) in enumerate(ws, start=1)])
        conn.execute("UPDATE lines SET audio_start_ms = ?, audio_end_ms = ? WHERE id = ?",
                     (ws[0][0], ws[-1][1], line_id))
    conn.executemany(
        "INSERT INTO notes (scene_id, idx, kind, text, phrase, line_id, first_word_idx, last_word_idx) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
            ("s01e04-0002-0003", 1, "wordplay", "w", "très beau", "s01e04-0002", 3, 4),
            ("s01e04-0002-0003", 2, "reference", "r", "aujourd'hui", "s01e04-0003", None, None),
            ("s01e04-0002-0003", 3, "reference", "whole", None, None, None, None),
            ("s01e04-0004-0005", 1, "reference", "x", "Non", "s01e04-0004", 4, 4),
        ])
    conn.commit()
    conn.close()
    return site


def test_scene_detail_line_not_annotated(annotated):
    s = get_json(annotated, "/api/scenes/s01e04-0001-0001")
    l = s["lines"][0]
    assert l["fr"] == "Bonjour, Astérix !"
    assert l["fr_final"] is None and l["en_literal"] is None and l["annotated_by"] is None
    assert l["audio_start_ms"] is None and l["offset_audio_start_ms"] is None
    assert l["fr_differs"] is False and l["fr_added"] == [] and l["units"] == []
    assert s["annotation"] == {"lines": 1, "annotated": 0, "aligned": 0, "units": 0}
    assert s["notes"] == []


def test_scene_detail_aligned_and_unaligned_lines(annotated):
    s = get_json(annotated, "/api/scenes/s01e04-0002-0003")
    assert s["annotation"] == {"lines": 2, "annotated": 2, "aligned": 1, "units": 3}
    aligned, untimed = s["lines"]
    # Aligned: texts next to the subtitle, audio times as episode ms and clip offsets.
    assert aligned["fr"] == "Il fait beau" and aligned["fr_final"] == "Il fait très beau"
    assert aligned["en_literal"] == "It is very fine" and aligned["annotated_by"] == "test"
    assert (aligned["audio_start_ms"], aligned["audio_end_ms"]) == (4100, 5600)
    assert (aligned["offset_audio_start_ms"], aligned["offset_audio_end_ms"]) == (2100, 3600)
    assert aligned["fr_differs"] is True
    assert [aligned["fr_final"][a:b] for a, b in aligned["fr_added"]] == ["très"]
    u1, u2 = aligned["units"]
    assert (u1["idx"], u1["kind"], u1["text"], u1["en"], u1["note"]) == (1, "expression", "Il fait", "it is", None)
    assert aligned["fr_final"][u2["char_start"]:u2["char_end"]] == "très beau"
    assert (u2["first_word_idx"], u2["last_word_idx"]) == (3, 4)
    assert (u2["start_ms"], u2["end_ms"]) == (4650, 5600)
    assert (u2["offset_start_ms"], u2["offset_end_ms"]) == (2650, 3600)  # minus clip_start_ms
    assert u2["score"] == 0.7 and u2["unscored_words"] == 0 and u2["note"] == "weather"
    # Annotated, not aligned: texts and units, every time NULL.
    assert untimed["fr_final"] == "aujourd'hui." and untimed["fr_differs"] is False
    assert untimed["audio_start_ms"] is None and untimed["offset_audio_start_ms"] is None
    (u,) = untimed["units"]
    assert u["kind"] == "word" and u["text"] == "aujourd'hui"
    assert u["start_ms"] is None and u["offset_start_ms"] is None and u["score"] is None
    # The subtitle versions are still there.
    assert s["groups"][0]["en"] == "Nice weather today."


def test_scene_detail_unrendered_aligned_and_unscored(annotated):
    s = get_json(annotated, "/api/scenes/s01e04-0004-0005")
    l4, l5 = s["lines"]
    assert l4["fr_final"].startswith("- Tu viens, toi") and l4["fr_differs"] is True
    assert l4["audio_start_ms"] == 9100 and l4["offset_audio_start_ms"] is None  # no clip yet
    u = l4["units"][0]
    assert (u["start_ms"], u["end_ms"]) == (9100, 10200) and u["offset_start_ms"] is None
    # MIN(score) ignores the unscored word; it is counted separately.
    assert u["score"] == 0.2 and u["unscored_words"] == 1
    assert l5["fr_final"] is None and l5["units"] == []


def test_scene_notes(annotated):
    xs = get_json(annotated, "/api/scenes/s01e04-0002-0003")["notes"]
    assert [(x["idx"], x["kind"], x["phrase"]) for x in xs] == [
        (1, "wordplay", "très beau"), (2, "reference", "aujourd'hui"), (3, "reference", None)]
    timed, unlocated, whole = xs
    assert timed["line_id"] == "s01e04-0002" and timed["line_idx"] == 2
    assert "Il fait très beau"[timed["char_start"]:timed["char_end"]] == "très beau"
    assert (timed["start_ms"], timed["end_ms"]) == (4650, 5600)
    assert (timed["offset_start_ms"], timed["offset_end_ms"]) == (2650, 3600)
    assert unlocated["line_idx"] == 3 and unlocated["first_word_idx"] is None
    assert unlocated["char_start"] is None and unlocated["offset_start_ms"] is None
    assert whole["line_id"] is None and whole["line_idx"] is None and whole["text"] == "whole"
    # Located in a line that is aligned, but the scene has no clip: episode times only.
    (x,) = get_json(annotated, "/api/scenes/s01e04-0004-0005")["notes"]
    assert x["start_ms"] == 11100 and x["offset_start_ms"] is None
    scenes = {s["id"]: s for s in get_json(annotated, "/api/episodes/s01e04/scenes")}
    assert [scenes[i]["notes"] for i in sorted(scenes)] == [0, 3, 1]
    assert "très" in scenes["s01e04-0002-0003"]["final"]


# --- review marks ----------------------------------------------------------------

def post_mark(site, **body):
    body = {"scene_id": "s01e04-0002-0003", "line_id": "s01e04-0002", "category": "translation",
            **body}
    r, payload = request(site, "POST", "/api/marks", body)
    return r.status, json.loads(payload)


def test_marks_create_edit_delete(annotated):
    status, unit_mark = post_mark(annotated, unit_idx=2, comment="  'very fine' is wrong here ")
    assert status == 201, unit_mark
    assert (unit_mark["unit_idx"], unit_mark["unit_text"]) == (2, "très beau")
    assert unit_mark["comment"] == "'very fine' is wrong here"  # trimmed
    assert unit_mark["status"] == "open" and unit_mark["created_at"] and unit_mark["resolved_at"] is None
    assert (unit_mark["line_idx"], unit_mark["episode_id"], unit_mark["line_fr"]) == (2, "s01e04", "Il fait très beau")
    status, line_mark = post_mark(annotated, line_id="s01e04-0003", category="timing")
    assert status == 201 and line_mark["unit_idx"] is None and line_mark["comment"] == ""

    # The scene shows the marks of its lines; the open list and the episode count them.
    s = get_json(annotated, "/api/scenes/s01e04-0002-0003")
    assert [(m["id"], m["line_id"]) for m in s["marks"]] == [(unit_mark["id"], "s01e04-0002"),
                                                             (line_mark["id"], "s01e04-0003")]
    assert get_json(annotated, "/api/scenes/s01e04-0001-0001")["marks"] == []
    assert len(get_json(annotated, "/api/marks?status=open")) == 2
    assert len(get_json(annotated, "/api/marks?episode=s01e05")) == 0
    assert get_json(annotated, "/api/episodes")[0]["open_marks"] == 2

    # Edit: category, comment, and the marked unit (null: back to the whole line).
    r, payload = request(annotated, "PATCH", f"/api/marks/{unit_mark['id']}",
                         {"category": "units", "comment": "split it", "unit_idx": 1})
    m = json.loads(payload)
    assert r.status == 200 and (m["category"], m["comment"], m["unit_idx"], m["unit_text"]) == \
        ("units", "split it", 1, "Il fait")
    r, payload = request(annotated, "PATCH", f"/api/marks/{unit_mark['id']}", {"unit_idx": None})
    assert json.loads(payload)["unit_text"] is None and json.loads(payload)["category"] == "units"

    r, payload = request(annotated, "DELETE", f"/api/marks/{line_mark['id']}")
    assert r.status == 200 and json.loads(payload) == {"deleted": line_mark["id"]}
    assert request(annotated, "DELETE", f"/api/marks/{line_mark['id']}")[0].status == 404
    assert [m["id"] for m in get_json(annotated, "/api/marks")] == [unit_mark["id"]]
    # Ids are never reused, even the newest one after a delete.
    assert post_mark(annotated)[1]["id"] == line_mark["id"] + 1


@pytest.mark.parametrize("body", [
    {"line_id": "s01e04-0004"},                 # not a line of the scene
    {"scene_id": "s01e04-0009-0009"},           # no such scene
    {"unit_idx": 7},                            # no such unit
    {"unit_idx": "2"}, {"unit_idx": True},
    {"category": "spelling"}, {"category": None},
    {"comment": 5}, {"comment": "x" * 10_001},
    {"status": "done"},                         # resolving is the CLI's
])
def test_marks_reject_invalid(annotated, body):
    status, payload = post_mark(annotated, **body)
    assert status == 400 and "error" in payload
    assert get_json(annotated, "/api/marks") == []


def test_marks_bad_requests(annotated):
    for body in ([1], None):
        r, _ = request(annotated, "POST", "/api/marks", body)
        assert r.status == 400
    c = http.client.HTTPConnection("127.0.0.1", annotated["port"], timeout=5)
    c.request("POST", "/api/marks", body=b"{not json")
    assert c.getresponse().status == 400
    c.close()
    _, m = post_mark(annotated)
    assert request(annotated, "PATCH", f"/api/marks/{m['id']}", {})[0].status == 400
    assert request(annotated, "PATCH", f"/api/marks/{m['id']}", {"line_id": "s01e04-0003"})[0].status == 400
    assert request(annotated, "PATCH", "/api/marks/999", {"comment": "x"})[0].status == 404
    assert request(annotated, "GET", "/api/marks?status=closed")[0].status == 400
    assert request(annotated, "PUT", "/api/marks", {})[0].status == 405
    assert request(annotated, "DELETE", "/api/marks")[0].status == 405
    assert request(annotated, "POST", f"/api/marks/{m['id']}", {})[0].status == 405
    # The retired curation write is gone.
    assert request(annotated, "PATCH", "/api/scenes/s01e04-0002-0003", {"status": "kept"})[0].status == 404


def test_marks_only_from_the_review_ui_page(annotated):
    """Another site open in the browser cannot write marks (their comments instruct an agent)."""
    port = annotated["port"]
    body = {"scene_id": "s01e04-0002-0003", "line_id": "s01e04-0002", "category": "translation"}
    for headers in ({"Origin": "https://evil.example"}, {"Origin": "null"},
                    {"Host": f"evil.example:{port}"}):
        assert request(annotated, "POST", "/api/marks", body, headers)[0].status == 403
    assert json.loads(request(annotated, "GET", "/api/marks")[1]) == []
    for origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}"):
        assert request(annotated, "POST", "/api/marks", body, {"Origin": origin})[0].status == 201


def test_resolved_marks_are_read_only(annotated):
    from frenchirix.review import resolve_mark

    _, m = post_mark(annotated, comment="c")
    conn = connect(annotated["db"])
    resolve_mark(conn, m["id"], "done", "fixed the English")
    conn.close()
    assert request(annotated, "PATCH", f"/api/marks/{m['id']}", {"comment": "x"})[0].status == 409
    assert request(annotated, "DELETE", f"/api/marks/{m['id']}")[0].status == 409
    (shown,) = get_json(annotated, "/api/scenes/s01e04-0002-0003")["marks"]
    assert (shown["status"], shown["resolution"]) == ("done", "fixed the English") and shown["resolved_at"]
    assert get_json(annotated, "/api/marks?status=open") == []
    assert get_json(annotated, "/api/episodes")[0]["open_marks"] == 0


def test_serve_migrates_an_older_database(tmp_path, monkeypatch):
    """Request handlers never migrate, so `serve` brings the file to the current schema first."""
    from frenchirix import server

    db_path = tmp_path / "db.sqlite"
    connect(db_path).close()
    from test_review import downgrade_to_v5
    downgrade_to_v5(db_path)

    class Stop(Exception):
        pass

    def fake_make_server(port, path):
        raise Stop
    monkeypatch.setattr(server, "make_server", fake_make_server)
    with pytest.raises(Stop):
        server.serve(0, db_path)
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0] == "6"
    assert conn.execute("SELECT COUNT(*) FROM review_marks").fetchone()[0] == 0
