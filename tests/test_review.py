"""Review marks: the schema 6 migration, frenchirix/review.py and `frenchirix review`."""

import json
import sqlite3
from pathlib import Path

import pytest

from frenchirix import cli, review
from frenchirix.annotation import import_annotations
from frenchirix.db import SCHEMA_PATH, connect
from frenchirix.importer import build, write
from frenchirix.selection import import_selection

from text_fixtures import FAKE_INFO, texts


def downgrade_to_v5(path: Path) -> None:
    """Turn a current database back into schema 5: no review_marks, and the curation
    columns scenes.status and scenes.note."""
    conn = sqlite3.connect(path)
    conn.executescript("""
        DROP TABLE review_marks;
        ALTER TABLE scenes ADD COLUMN status TEXT NOT NULL DEFAULT 'candidate'
            CHECK (status IN ('candidate', 'kept', 'rejected'));
        ALTER TABLE scenes ADD COLUMN note TEXT;
        UPDATE meta SET value = '5' WHERE key = 'schema_version';
    """)
    conn.commit()
    conn.close()


def table_info(conn, table):
    return [tuple(r)[1:] for r in conn.execute(f"PRAGMA table_info({table})")]


def make_db(path: Path) -> sqlite3.Connection:
    conn = connect(path)
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    scenes = [{"first": a, "last": b, "title": f"t{a}", "kind": "dialogue", "tags": [], "score": 3,
               "why": "w"} for a, b in ((1, 1), (2, 3), (2, 5))]
    import_selection(conn, "s01e04", {"episode": "s01e04", "selector": "x", "scenes": scenes})
    return conn


def test_migration_5_to_6(tmp_path):
    db = tmp_path / "db.sqlite"
    make_db(db).close()
    downgrade_to_v5(db)
    conn = sqlite3.connect(db)
    conn.execute("UPDATE scenes SET status = 'kept', note = 'old' WHERE id = 's01e04-0001-0001'")
    conn.commit()
    conn.close()

    conn = connect(db)
    assert conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0] == "6"
    fresh = sqlite3.connect(":memory:")
    fresh.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    for table in ("scenes", "review_marks"):
        assert table_info(conn, table) == table_info(fresh, table), table
    assert "status" not in [c[0] for c in table_info(conn, "scenes")]
    assert conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0] == 3  # rows kept
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    # The table's constraints hold.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO review_marks (scene_id, line_id, category, created_at) "
                     "VALUES ('s01e04-0001-0001', 's01e04-0001', 'spelling', 'now')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO review_marks (scene_id, line_id, category, status, created_at) "
                     "VALUES ('s01e04-0001-0001', 's01e04-0001', 'other', 'done', 'now')")


# --- the CLI and the context a fixer gets --------------------------------------------------

ANNOTATIONS = [
    {"line": 2, "fr": "Il fait très beau", "en": "It is very fine",
     "units": [{"t": "Il fait", "k": "expression", "en": "it is"},
               {"t": "très beau", "k": "expression", "en": "very fine", "note": "weather"}]},
    {"line": 3, "fr": "aujourd'hui.", "en": "today.",
     "units": [{"t": "aujourd'hui", "k": "word", "en": "today"}]},
    {"scene": "s01e04-0002-0003", "notes": [
        {"kind": "wordplay", "line": 2, "phrase": "très beau", "text": "A pun on beau."}]},
]


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A database with lines 2-3 annotated, and the files a fixer works with."""
    root = tmp_path / "repo"
    ann = root / "annotations" / "s01e04"
    ann.mkdir(parents=True)
    (ann / "01.jsonl").write_text("\n".join(json.dumps(a, ensure_ascii=False) for a in ANNOTATIONS) + "\n")
    (root / "corrections").mkdir()
    (root / "corrections" / "s01e04.json").write_text(json.dumps({"episode": "s01e04", "translations": [
        {"lang": "en", "first": 2, "last": 3, "text": "Fine weather today.", "reason": "r"}]}))
    q = root / "app" / "data" / "questions"
    q.mkdir(parents=True)
    question = lambda line, fr: {"line": line, "fr": fr, "en": fr, "answers": [
        {"fr": "Oui.", "en": "Yes.", "correct": True}, {"fr": "Un poisson.", "en": "A fish.", "correct": False}]}
    (q / "s01e04.json").write_text(json.dumps({"episode": "s01e04", "scenes": {
        "s01e04-0002-0003": {"title_fr": "Beau temps", "difficulty": 1, "doubt": None, "questions": [
            question("s01e04-0002", "Quel temps fait-il ?"), question("s01e04-0003", "Quand ?")]},
        "s01e04-0002-0005": {"title_fr": "Long", "difficulty": 2, "doubt": None, "questions": [
            question(None, "De quoi parle-t-on ?")]}}}, ensure_ascii=False))
    alt = root / "app" / "data" / "alternates"
    alt.mkdir(parents=True)
    (alt / "s01e04.part3.json").write_text(json.dumps({"s01e04-0002": [
        {"fr": "Il fait très froid", "en": "It is very cold", "units": []},
        {"fr": "Il pleut des frites", "en": "It is raining fries", "units": []}]}, ensure_ascii=False))

    db = tmp_path / "db.sqlite"
    conn = make_db(db)
    # What recognition heard during line 2 (subtitle 4000-6000 ms).
    conn.executemany("INSERT INTO asr_words (episode_id, idx, start_ms, end_ms, text, prob) "
                     "VALUES ('s01e04', ?, ?, ?, ?, 0.9)",
                     [(1, 4100, 4300, "Il"), (2, 4300, 4600, "fait"), (3, 4650, 5000, "très"),
                      (4, 5000, 5600, "beau")])
    import_annotations(conn, "s01e04", ann, "test")
    conn.close()
    monkeypatch.setattr(review, "REPO_ROOT", root)
    return {"db": db, "root": root}


def run(capsys, *args):
    code = cli.main(list(args))
    out = capsys.readouterr()
    return code, out.out, out.err


def test_list_context_resolve(repo, capsys):
    db = str(repo["db"])
    conn = connect(repo["db"])
    unit_mark = review.create_mark(conn, {"scene_id": "s01e04-0002-0003", "line_id": "s01e04-0002",
                                          "unit_idx": 2, "category": "translation",
                                          "comment": "Should be 'very nice'.\nCheck the gloss too."})
    review.create_mark(conn, {"scene_id": "s01e04-0002-0005", "line_id": "s01e04-0004",
                              "category": "french"})
    conn.close()

    code, out, _ = run(capsys, "review", "list", "--db", db)
    assert code == 0
    assert "translation" in out and "line 2 unit 2 “très beau”: Should be 'very nice'. / Check" in out
    assert "line 4: (no comment)" in out and out.rstrip().endswith("2 open review marks")
    code, out, _ = run(capsys, "review", "list", "--db", db, "--episode", "s01e05")
    assert out.strip() == "0 open review marks in s01e05"

    code, md, _ = run(capsys, "review", "context", str(unit_mark["id"]), "--db", db)
    assert code == 0
    assert md.startswith(f"# Review mark {unit_mark['id']}: translation (open)")
    assert "on unit 2 “très beau” of line 2 (`s01e04-0002`)" in md
    assert "> Should be 'very nice'.\n> Check the gloss too." in md
    # Every line of the scene, with subtitle and final texts; the marked line's units.
    assert "### Line 2 (`s01e04-0002`)  ← the marked line" in md and "### Line 3 (`s01e04-0003`)" in md
    assert "- Subtitle French: “Il fait beau”" in md and "- Final French: “Il fait très beau”" in md
    assert "- Heard: “Il fait très beau”" in md and "- Heard: (nothing)" in md
    assert "Speech recognition heard, over the scene's clip: Il fait très beau" in md
    assert "- Literal English: “It is very fine”" in md
    assert "(translation group" in md and "lines 2–3; from subtitle:" in md
    assert "- Subtitle English: one subtitle with line 2 above" in md
    assert "| 2 ← marked | expression | très beau | very fine | weather | not timed |" in md
    assert "1. wordplay, line 2, phrase “très beau”: A pun on beau." in md
    # Where the fix goes, and the app content built on the line.
    assert "`annotations/s01e04/01.jsonl`, line 1 of the file" in md
    assert "The scene's notes: `annotations/s01e04/01.jsonl`, line 3 of the file" in md
    assert "`corrections/s01e04.json`, an entry with `\"first\": 2, \"last\": 3`" in md
    assert "the file has one already" in md
    assert "About this line: “Quel temps fait-il ?”" in md and "right: “Oui.”" in md
    assert "1 more question about other lines of the scene." in md
    assert "About the whole scene: “De quoi parle-t-on ?”" in md  # from the overlapping scene
    assert "In `app/data/alternates/s01e04.part3.json`:" in md and "1. “Il fait très froid”" in md
    assert "Mark 2: french, line 4" not in md  # line 4 is outside this mark's scene

    code, out, _ = run(capsys, "review", "resolve", str(unit_mark["id"]), "--db", db,
                       "--status", "done", "--resolution", "Literal English and gloss fixed.")
    assert code == 0 and out.strip() == f"review mark {unit_mark['id']} is done"
    code, out, err = run(capsys, "review", "resolve", str(unit_mark["id"]), "--db", db,
                         "--status", "dismissed", "--resolution", "again")
    assert code == 1 and "is done, not open" in err
    code, out, err = run(capsys, "review", "resolve", "99", "--db", db, "--status", "done",
                         "--resolution", "x")
    assert code == 1 and "no review mark 99" in err
    code, out, err = run(capsys, "review", "resolve", "2", "--db", db, "--status", "done",
                         "--resolution", "  ")
    assert code == 1 and "resolution" in err
    code, out, _ = run(capsys, "review", "list", "--db", db, "--status", "all")
    assert "Literal English and gloss fixed." in out and out.rstrip().endswith("2 review marks")
    code, out, _ = run(capsys, "review", "list", "--db", db)
    assert out.rstrip().endswith("1 open review mark")


def test_context_of_an_unannotated_line_and_a_reannotated_unit(repo, capsys):
    conn = connect(repo["db"])
    whole = review.create_mark(conn, {"scene_id": "s01e04-0002-0005", "line_id": "s01e04-0005",
                                      "category": "timing"})
    unit = review.create_mark(conn, {"scene_id": "s01e04-0002-0003", "line_id": "s01e04-0002",
                                     "unit_idx": 1, "category": "units", "comment": "c"})
    conn.execute("UPDATE units SET text = 'Il' WHERE line_id = 's01e04-0002' AND idx = 1")
    conn.commit()
    md = review.mark_context(conn, whole["id"])
    assert "the whole of line 5" in md and "The user wrote no comment" in md
    assert "- Not annotated: no final French, literal English or units" in md
    assert "No annotation record for line 5" in md and "align s01e04 --lines 5 --slack-ms 300" in md
    assert "The scene has no scene object" in md
    md = review.mark_context(conn, unit["id"])
    assert "its unit 1 is now “Il”. The mark is about “Il fait”." in md


def test_context_of_a_missing_mark(repo, capsys):
    code, _, err = run(capsys, "review", "context", "5", "--db", str(repo["db"]))
    assert code == 1 and "no review mark 5" in err
    code, _, err = run(capsys, "review", "list", "--db", str(repo["root"] / "none.sqlite"))
    assert code == 1 and "not found" in err
