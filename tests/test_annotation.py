import json

import pytest

from frenchirix.annotation import (
    AnnotationError, import_annotations, render_sheet, split_sheets, write_sheets, _scenes,
    asr_words,
)
from frenchirix.db import connect
from frenchirix.importer import build, write
from frenchirix.selection import import_selection

from text_fixtures import FAKE_INFO, texts

# Lines: 1 "Bonjour, Astérix !"  2 "Il fait beau" (sung)  3 "aujourd'hui." (sung)
#        4 "- Tu viens ?\n- Non."  5 "Aïe !"  6 "Abraracourcix est là."


@pytest.fixture
def conn(tmp_path):
    c = connect(tmp_path / "db.sqlite")
    t = texts()
    t["fr"] += "\n6\n00:00:15,000 --> 00:00:17,000\nAbraracourcix est là.\n"
    t["en"] += "\n6\n00:00:15,000 --> 00:00:17,000\nVitalstatistix is here.\n"
    write(c, build("s01e04", FAKE_INFO, t, "content/x.mkv"))
    import_selection(c, "s01e04", {"episode": "s01e04", "selector": "t", "scenes": [
        {"first": 1, "last": 3, "title": "Hello", "kind": "dialogue", "tags": [], "score": 3, "why": "w"},
        {"first": 2, "last": 4, "title": "Weather", "kind": "song", "tags": [], "score": 3, "why": "w"},
        {"first": 6, "last": 6, "title": "Chief", "kind": "monologue", "tags": [], "score": 3, "why": "w"},
    ]})
    return c


def add_asr(conn, *words):
    """words: (start_ms, end_ms, text)"""
    conn.executemany(
        "INSERT INTO asr_words (episode_id, idx, start_ms, end_ms, text, prob) VALUES ('s01e04', ?, ?, ?, ?, 0.9)",
        [(i, a, b, t) for i, (a, b, t) in enumerate(words, start=1)])
    conn.commit()


ASR = [
    (1100, 1500, "Bonjour,"), (1600, 2900, "Astérix!"),
    (4100, 5000, "il"), (5000, 5500, "fait"), (5500, 5900, "beau"),
    (6200, 7900, "aujourd'hui"),
    (9100, 9500, "tu"), (9500, 10000, "viens"), (11000, 11500, "non"),
    (15100, 15600, "Abraracourcix"), (15600, 16000, "est"), (16000, 16500, "là"),
]


# --- sheet --------------------------------------------------------------------

def test_sheet_requires_asr(conn, tmp_path):
    with pytest.raises(AnnotationError, match="transcribe"):
        write_sheets(conn, "s01e04", tmp_path / "work")


def test_sheet_format(conn):
    add_asr(conn, *ASR)
    scenes = _scenes(conn, "s01e04")
    text = render_sheet(conn, "s01e04", scenes, asr_words(conn, "s01e04"))
    assert text.split("\n")[:13] == [
        "### s01e04-0001-0003 | dialogue | Hello",
        "heard: Bonjour, Astérix! il fait beau aujourd'hui tu viens",
        "0001 (Obélix) FR  Bonjour, Astérix !",
        "     EN  Hello, Asterix!",
        "     ASR Bonjour, Astérix!",
        "0002 ♪ FR  Il fait beau",
        "     EN  Nice weather today.",
        "     ASR il fait beau",
        "0003 ♪ FR  aujourd'hui.",
        "     EN  ^",
        "     ASR aujourd'hui",
        "",
        "### s01e04-0002-0004 | song | Weather",
    ]
    rest = text.split("\n")[14:]
    assert rest[:3] == [
        "0002 ♪ (annotated above) FR  Il fait beau",
        "0003 ♪ (annotated above) FR  aujourd'hui.",
        "0004 (Obélix / Astérix) FR  - Tu viens ? / - Non.",
    ]


def test_split_sheets_keeps_overlapping_scenes_together():
    def sc(a, b):
        return {"first_line_idx": a, "last_line_idx": b}
    scenes = [sc(i * 10, i * 10 + 2) for i in range(30)]
    sheets = split_sheets(scenes, per_sheet=12)
    assert [len(s) for s in sheets] == [10, 10, 10]
    # Scenes 9, 10, 11 overlap; they must share a sheet.
    scenes[10] = sc(92, 102)
    scenes[11] = sc(101, 112)
    sheets = split_sheets(scenes, per_sheet=12)
    where = {id(s): n for n, sheet in enumerate(sheets) for s in sheet}
    assert where[id(scenes[9])] == where[id(scenes[10])] == where[id(scenes[11])]
    assert sum(len(s) for s in sheets) == 30


def test_write_sheets_numbers_files(conn, tmp_path):
    add_asr(conn, *ASR)
    (tmp_path / "work").mkdir()
    (tmp_path / "work" / "annotate-07.txt").write_text("stale")
    written = write_sheets(conn, "s01e04", tmp_path / "work")
    assert [p.name for p, _ in written] == ["annotate-01.txt"]
    assert not (tmp_path / "work" / "annotate-07.txt").exists()


# --- import -------------------------------------------------------------------

def rec(line, fr, units, en="English."):
    return {"line": line, "fr": fr, "en": en,
            "units": [{"t": t, "k": k, "en": g, **({"note": n} if n else {})}
                      for t, k, g, n in units]}


GOOD = [
    rec(1, "Ben bonjour, Astérix !", [("Ben bonjour,", "expression", "well hello", None),
                                      ("Astérix", "word", "Astérix", None)]),
    rec(2, "Il fait beau", [("Il fait beau", "expression", "the weather is nice", "fixed")]),
    rec(3, "aujourd'hui.", [("aujourd'hui", "word", "today", None)]),
    rec(4, "- Tu viens ?\n- Non.", [("Tu viens", "expression", "you come", None),
                                    ("Non", "word", "no", None)]),
]


def write_jsonl(directory, name, records):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n")


def test_import_loads_lines_words_units(conn, tmp_path):
    add_asr(conn, *ASR)
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", GOOD + [{"scene": "s01e04-0001-0003", "notes": []},
                                       {"scene": "s01e04-0002-0004", "notes": []}])
    write_jsonl(d, "02.jsonl", [rec(6, "Abraracourcix est là.",
                                    [("Abraracourcix", "word", "Abraracourcix", None),
                                     ("est là", "expression", "is here", None)],
                                    en="Abraracourcix is here."),
                                {"scene": "s01e04-0006-0006", "notes": []}])
    res = import_annotations(conn, "s01e04", d)
    assert res.loaded == 5 and res.fr_changed == 1 and res.words_added == 1
    assert res.units_by_kind == {"expression": 4, "word": 4}
    assert res.warnings == []
    row = conn.execute("SELECT fr_final, en_literal, annotated_by FROM lines WHERE idx = 1").fetchone()
    assert tuple(row) == ("Ben bonjour, Astérix !", "English.", "sonnet:annotate-v1")
    words = [tuple(r) for r in conn.execute(
        "SELECT idx, text, char_start, char_end, start_ms FROM words WHERE line_id = 's01e04-0001' ORDER BY idx")]
    assert words == [(1, "Ben", 0, 3, None), (2, "bonjour", 4, 11, None), (3, "Astérix", 13, 20, None)]
    units = [tuple(r) for r in conn.execute(
        "SELECT idx, kind, first_word_idx, last_word_idx, text, en, note FROM units "
        "WHERE line_id = 's01e04-0001' ORDER BY idx")]
    assert units == [(1, "expression", 1, 2, "Ben bonjour", "well hello", None),
                     (2, "word", 3, 3, "Astérix", "Astérix", None)]
    u4 = [r[0] for r in conn.execute("SELECT text FROM units WHERE line_id = 's01e04-0004' ORDER BY idx")]
    assert u4 == ["Tu viens", "Non"]
    assert conn.execute("SELECT COUNT(*) FROM unit_times").fetchone()[0] == 8


def test_reimport_keeps_timings_when_french_is_unchanged(conn, tmp_path):
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", GOOD)
    import_annotations(conn, "s01e04", d)
    conn.execute("UPDATE words SET start_ms = 100, end_ms = 200, score = 0.9")
    conn.execute("UPDATE lines SET audio_start_ms = 100, audio_end_ms = 200 WHERE fr_final IS NOT NULL")
    conn.commit()
    changed = list(GOOD)
    changed[1] = rec(2, "Il fait très beau", [("Il fait très beau", "expression", "it is very nice", None)])
    changed[0] = dict(GOOD[0], en="New English.")
    write_jsonl(d, "01.jsonl", changed)
    res = import_annotations(conn, "s01e04", d, annotated_by="manual")
    assert res.kept_timings == 3
    l1 = conn.execute("SELECT en_literal, annotated_by, audio_start_ms FROM lines WHERE idx = 1").fetchone()
    assert tuple(l1) == ("New English.", "manual", 100)
    assert conn.execute("SELECT MIN(start_ms) FROM words WHERE line_id = 's01e04-0001'").fetchone()[0] == 100
    l2 = conn.execute("SELECT fr_final, audio_start_ms FROM lines WHERE idx = 2").fetchone()
    assert tuple(l2) == ("Il fait très beau", None)
    assert [tuple(r) for r in conn.execute(
        "SELECT text, start_ms FROM words WHERE line_id = 's01e04-0002' ORDER BY idx")] == \
        [("Il", None), ("fait", None), ("très", None), ("beau", None)]


def test_validation_reports_every_problem_and_writes_nothing(conn, tmp_path):
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", [
        GOOD[0],
        rec(99, "x", [("x", "word", "x", None)]),                               # no such line
        rec(2, "", [("Il", "word", "it", None)]),                               # empty fr
        rec(3, "aujourd'hui.", []),                                              # no units
        rec(4, "- Tu viens ?\n- Non.", [("Tu viens", "phrase", "", None),        # bad k, empty en
                                        ("Non", "word", "no", None)]),
    ])
    (d / "02.jsonl").write_text(
        json.dumps(GOOD[0]) + "\n"                                               # duplicate
        + "{not json\n"
        + json.dumps(rec(6, "Abraracourcix est là.", [("Abraracourcix", "word", "A", None),
                                                      ("est", "word", "is", None)])) + "\n"
        + json.dumps(rec(5, "Aïe !", [("Aïe", "word", "ouch", None), ("Aïe", "word", "ouch", None)])) + "\n")
    with pytest.raises(AnnotationError) as e:
        import_annotations(conn, "s01e04", d)
    errs = e.value.errors
    text = "\n".join(errs)
    assert "01.jsonl:2 (line 99): no such line" in text
    assert "01.jsonl:3 (line 2): \"fr\" must be a non-empty string" in text
    assert "01.jsonl:4 (line 3): \"units\" must be a non-empty list" in text
    assert "01.jsonl:5 (line 4): unit 1: \"k\" must be word or expression" in text
    assert "01.jsonl:5 (line 4): unit 1: \"en\" must be a non-empty string" in text
    assert "02.jsonl:1 (line 1): already annotated at" in text
    assert "02.jsonl:2: not valid JSON" in text
    assert "02.jsonl:3 (line 6): units do not cover fr: units stop at word 2; fr continues with 'là'" in text
    assert "02.jsonl:4 (line 5): units do not cover fr: units have extra words" in text
    assert conn.execute("SELECT COUNT(*) FROM words").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM lines WHERE fr_final IS NOT NULL").fetchone()[0] == 0


def test_partition_reports_where_words_differ(conn, tmp_path):
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", [rec(1, "Bonjour, Astérix !", [("Bonjour", "word", "hello", None),
                                                              ("Obélix", "word", "Obélix", None)])])
    with pytest.raises(AnnotationError, match=r"word 2: fr has 'Astérix', unit 2 has 'Obélix'"):
        import_annotations(conn, "s01e04", d)
    # Punctuation and spacing between units do not matter.
    write_jsonl(d, "01.jsonl", [rec(1, "Bonjour, Astérix !", [("Bonjour ,", "word", "hello", None),
                                                              ("Astérix !", "word", "Astérix", None)])])
    assert import_annotations(conn, "s01e04", d).loaded == 1


def test_warnings(conn, tmp_path):
    add_asr(conn, *ASR)
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", [
        rec(1, "Salut mon vieux copain Astérix", [("Salut mon vieux copain", "expression", "hi", None),
                                                  ("Astérix", "word", "Astérix", None)]),
        rec(5, "Aïe !", [("Aïe", "word", "ouch", None)]),
        rec(6, "Abraracourcix est là.", [("Abraracourcix", "word", "A", None),
                                         ("est là", "expression", "is here", None)],
            en="Vitalstatistix is here."),
    ])
    res = import_annotations(conn, "s01e04", d)
    text = "\n".join(res.warnings)
    assert "3 lines of scenes have no annotation: 2, 3, 4" in text
    assert "1 annotated lines are in no scene: 5" in text
    assert "(line 1): 4 of 5 words are in neither" in text and "Salut mon vieux copain" in text
    assert "'Vitalstatistix'; the French name is 'Abraracourcix'" in text


def test_import_needs_files(conn, tmp_path):
    with pytest.raises(AnnotationError, match="no annotation files"):
        import_annotations(conn, "s01e04", tmp_path / "none")


# --- notes ---------------------------------------------------------------------

def scene(sid, *exps):
    return {"scene": sid, "notes": [
        {"kind": k, "text": t, **({"line": ln, "phrase": p} if ln is not None else {})}
        for k, t, ln, p in exps]}


def notes(conn, sid=None):
    q = ("SELECT scene_id, idx, kind, text, phrase, line_id, first_word_idx, last_word_idx "
         "FROM notes" + (" WHERE scene_id = ?" if sid else "") + " ORDER BY scene_id, idx")
    return [tuple(r) for r in conn.execute(q, (sid,) if sid else ())]


S1, S2, S3 = "s01e04-0001-0003", "s01e04-0002-0004", "s01e04-0006-0006"


def test_scene_objects_load_notes(conn, tmp_path):
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", GOOD[:3] + [
        scene(S1, ("wordplay", "  A pun.  ", 1, "BONJOUR, asterix"), ("reference", "The scene.", None, None)),
        GOOD[3],
        scene(S2),
    ])
    res = import_annotations(conn, "s01e04", d)
    assert res.loaded == 4
    assert res.scenes_noted == 2 and res.notes_by_kind == {"wordplay": 1, "reference": 1}
    # Case, accents and punctuation do not matter; the phrase is stored as given.
    assert notes(conn) == [
        (S1, 1, "wordplay", "A pun.", "BONJOUR, asterix", "s01e04-0001", 2, 3),
        (S1, 2, "reference", "The scene.", None, None, None, None),
    ]


def test_scene_object_validation_writes_nothing(conn, tmp_path):
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", [
        GOOD[0],
        scene("s01e04-0009-0009"),                                               # no such scene
        {"scene": S1, "notes": "none"},                                   # not a list
        scene(S2, ("joke", "x", None, None),                                     # bad kind
              ("reference", " ", None, None),                                    # empty text
              ("wordplay", "x", 1, "Bonjour")),                                  # line 1 not in 2-4
        {"scene": S3, "notes": [{"kind": "reference", "text": "x", "line": 6}]},  # no phrase
        {"scene": S1, "line": 1, "notes": []},                            # both keys
    ])
    write_jsonl(d, "02.jsonl", [scene(S2), scene("s01e05-0001-0002")])           # duplicate; other episode
    with pytest.raises(AnnotationError) as e:
        import_annotations(conn, "s01e04", d)
    text = "\n".join(e.value.errors)
    assert "01.jsonl:2 (scene s01e04-0009-0009): no such scene in the episode" in text
    assert f"01.jsonl:3 (scene {S1}): \"notes\" must be a list" in text
    assert f"01.jsonl:4 (scene {S2}): note 1: \"kind\" must be reference or wordplay, got 'joke'" in text
    assert f"01.jsonl:4 (scene {S2}): note 2: \"text\" must be a non-empty string" in text
    assert f"01.jsonl:4 (scene {S2}): note 3: line 1 is not in the scene (lines 2-4)" in text
    assert f"01.jsonl:5 (scene {S3}): note 1: \"line\" and \"phrase\" must be given together" in text
    assert "01.jsonl:6: has both \"scene\" and \"line\"" in text
    assert f"02.jsonl:1 (scene {S2}): already given at" in text
    assert "02.jsonl:2 (scene s01e05-0001-0002): no such scene in the episode" in text
    assert notes(conn) == []
    assert conn.execute("SELECT COUNT(*) FROM lines WHERE fr_final IS NOT NULL").fetchone()[0] == 0


def test_phrase_not_found_is_kept_with_a_warning(conn, tmp_path):
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", GOOD)
    import_annotations(conn, "s01e04", d)
    # Line 4 is not in this import: its phrase is looked up in the stored fr_final.
    write_jsonl(d, "01.jsonl", [GOOD[0], scene(S1, ("wordplay", "x", 1, "Obélix")),
                                scene(S2, ("reference", "y", 4, "tu VIENS"),
                                      ("reference", "z", 3, "demain"))])
    res = import_annotations(conn, "s01e04", d)
    assert notes(conn) == [
        (S1, 1, "wordplay", "x", "Obélix", "s01e04-0001", None, None),
        (S2, 1, "reference", "y", "tu VIENS", "s01e04-0004", 1, 2),
        (S2, 2, "reference", "z", "demain", "s01e04-0003", None, None),
    ]
    text = "\n".join(res.warnings)
    assert f"01.jsonl:2 (scene {S1}): note 1: phrase 'Obélix' is not in line 1" in text
    assert f"(scene {S2}): note 2: phrase 'demain' is not in line 3 (\"aujourd'hui.\")" in text


def test_scene_object_replaces_and_empty_list_clears(conn, tmp_path):
    d = tmp_path / "ann"
    six = rec(6, "Abraracourcix est là.", [("Abraracourcix", "word", "A", None),
                                           ("est là", "expression", "is here", None)])
    write_jsonl(d, "01.jsonl", GOOD + [scene(S1, ("reference", "a", None, None), ("reference", "b", None, None)),
                                       scene(S2, ("wordplay", "c", None, None)),
                                       six, scene(S3, ("wordplay", "d", 6, "Abraracourcix"))])
    import_annotations(conn, "s01e04", d)
    assert len(notes(conn)) == 4
    write_jsonl(d, "01.jsonl", GOOD + [scene(S1, ("wordplay", "new", None, None)), scene(S2)])
    res = import_annotations(conn, "s01e04", d)
    assert notes(conn, S1) == [(S1, 1, "wordplay", "new", None, None, None, None)]
    assert notes(conn, S2) == []
    assert [r[3] for r in notes(conn, S3)] == ["d"]                       # no scene object: kept
    assert not any("no scene object" in w for w in res.warnings)
    # Lines of S1 and S2 annotated without their scene objects.
    write_jsonl(d, "01.jsonl", GOOD)
    res = import_annotations(conn, "s01e04", d)
    assert f"2 scenes have annotated lines but no scene object, so their notes were left " \
           f"as they are: {S1}, {S2}" in "\n".join(res.warnings)
    assert [r[3] for r in notes(conn, S1)] == ["new"]


def test_changed_french_relocates_notes(conn, tmp_path):
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", GOOD + [scene(S1, ("wordplay", "a", 1, "Astérix"), ("wordplay", "b", 1, "ben"),
                                             ("reference", "c", 2, "beau"))])
    import_annotations(conn, "s01e04", d)
    assert [r[6:] for r in notes(conn)] == [(3, 3), (1, 1), (3, 3)]
    changed = list(GOOD)
    changed[0] = rec(1, "Bonjour Astérix", [("Bonjour", "word", "hello", None), ("Astérix", "word", "A", None)])
    write_jsonl(d, "01.jsonl", changed)
    res = import_annotations(conn, "s01e04", d)
    assert [r[6:] for r in notes(conn)] == [(2, 2), (None, None), (3, 3)]
    assert [r[4] for r in notes(conn)] == ["Astérix", "ben", "beau"]
    assert f"{S1} note 2: phrase 'ben' is not in the new French of s01e04-0001 " \
           f"('Bonjour Astérix'); its word span was cleared" in res.warnings
    # Changing it back finds the phrase again.
    write_jsonl(d, "01.jsonl", GOOD)
    import_annotations(conn, "s01e04", d)
    assert [r[6:] for r in notes(conn)] == [(3, 3), (1, 1), (3, 3)]


def test_cli_summary_counts_notes(conn, tmp_path, monkeypatch, capsys):
    from frenchirix import cli
    monkeypatch.setattr(cli, "connect", lambda: conn)
    d = tmp_path / "ann"
    write_jsonl(d, "01.jsonl", GOOD + [scene(S1, ("wordplay", "a", 1, "Astérix"), ("wordplay", "b", None, None)),
                                       scene(S2, ("reference", "c", None, None))])
    assert cli.main(["annotate-import", "s01e04", "--dir", str(d)]) == 0
    assert "notes: reference 1, wordplay 2 in 2 scenes" in capsys.readouterr().out
