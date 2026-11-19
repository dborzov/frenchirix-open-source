import pytest

from frenchirix.db import connect
from frenchirix.importer import ImportError_, build, choose_streams, write
from frenchirix.selection import import_selection

from text_fixtures import FAKE_INFO, FR, SDH, srt, texts


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "db.sqlite")


def test_choose_streams_by_language_and_title():
    assert choose_streams(FAKE_INFO) == {"audio": 3, "fr": 11, "fr_sdh": 12, "en": 7}


def test_choose_streams_refuses_ambiguous_layout():
    info = {"streams": FAKE_INFO["streams"] + [
        {"index": 20, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "eng"}}]}
    with pytest.raises(ImportError_):
        choose_streams(info)


def test_build_lines_and_translations():
    imp = build("s01e04", FAKE_INFO, texts(), "content/x.mkv")
    assert imp.episode["duration_ms"] == 120_500
    assert imp.episode["audio_stream"] == 3 and imp.episode["video_fps"] == 24.0
    ids = [l["id"] for l in imp.lines]
    assert ids == [f"s01e04-{i:04d}" for i in range(1, 6)]
    assert [l["fr"] for l in imp.lines] == [
        "Bonjour, Astérix !", "Il fait beau", "aujourd'hui.", "- Tu viens ?\n- Non.", "Aïe !"]
    assert [l["speaker"] for l in imp.lines] == ["Obélix", None, None, "Obélix / Astérix", None]
    assert [l["is_song"] for l in imp.lines] == [0, 1, 1, 0, 0]
    assert [l["group_idx"] for l in imp.lines] == [1, 2, 2, 3, 4]
    assert [(t["first_line_idx"], t["last_line_idx"], t["text"]) for t in imp.translations] == [
        (1, 1, "Hello, Asterix!"),
        (2, 3, "Nice weather today."),
        (4, 4, "Are you coming? No."),
        (5, 5, ""),
    ]


def _rows(conn, sql):
    return [tuple(r) for r in conn.execute(sql)]


def test_reimport_is_stable(conn):
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    before = _rows(conn, "SELECT * FROM lines ORDER BY idx"), _rows(conn, "SELECT * FROM cues ORDER BY id")
    msg = write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    assert "unchanged" in msg
    after = _rows(conn, "SELECT * FROM lines ORDER BY idx"), _rows(conn, "SELECT * FROM cues ORDER BY id")
    assert before == after
    assert conn.execute("SELECT raw_text FROM cues WHERE track='fr' AND idx=1").fetchone()[0] == \
        "Bonjour, <i>Astérix</i> !"


def _add_scene(conn):
    import_selection(conn, "s01e04", {"episode": "s01e04", "selector": "test", "scenes": [
        {"first": 2, "last": 3, "title": "Weather", "kind": "monologue", "tags": [], "score": 3,
         "why": "x"}]})


def test_reimport_refuses_to_change_lines_under_scenes(conn):
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    _add_scene(conn)
    changed = FR.replace("Il fait beau", "Il fait chaud")
    with pytest.raises(ImportError_):
        write(conn, build("s01e04", FAKE_INFO, texts(fr=changed), "content/x.mkv"))
    assert conn.execute("SELECT fr FROM lines WHERE idx = 2").fetchone()[0] == "Il fait beau"
    assert conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0] == 1


def test_reimport_with_scenes_allows_translation_changes_and_warns(conn):
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    _add_scene(conn)
    # English now pairs lines 2 and 3 separately: the scene still fits.
    en = srt((1000, 3000, "Hello!"), (4000, 6000, "Nice weather"), (6100, 8000, "today."),
             (9000, 13000, "Coming? No."))
    msg = write(conn, build("s01e04", FAKE_INFO, texts(en=en), "content/x.mkv"))
    assert "wrote" in msg and "warning" not in msg
    # English now merges lines 3 and 4: scene 2-3 splits a group.
    en = srt((1000, 3000, "Hello!"), (4000, 6000, "Nice weather"), (6100, 13000, "today. Coming? No."))
    msg = write(conn, build("s01e04", FAKE_INFO, texts(en=en), "content/x.mkv"))
    assert "s01e04-0002-0003" in msg


def test_reimport_without_scenes_replaces(conn):
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    changed = FR.replace("Il fait beau", "Il fait chaud")
    write(conn, build("s01e04", FAKE_INFO, texts(fr=changed), "content/x.mkv"))
    assert conn.execute("SELECT fr FROM lines WHERE idx = 2").fetchone()[0] == "Il fait chaud"
    assert conn.execute("SELECT COUNT(*) FROM cues").fetchone()[0] == 5 + 6 + 5
    # fr_cue_id points at the French cue with the same idx.
    assert _rows(conn, "SELECT l.idx, c.idx, c.track FROM lines l JOIN cues c ON c.id = l.fr_cue_id") == \
        [(i, i, "fr") for i in range(1, 6)]



# --- sung lines -------------------------------------------------------------

SONG_FR = srt(
    (1000, 3000, "<i>C'est un monde romain Pas un monde gaulois</i>"),
    (3100, 5000, "<i>Tapez dans vos mains</i>\n<i>Et respectez nos lois</i>"),
    (6000, 8000, "Ça va me rester\ndans la tête."),
)
SONG_SDH = srt(
    (1000, 3000, "[groupe] ♪ <i>C'est un monde romain</i>\n<i>Pas un monde gaulois </i>♪"),
    (3100, 5000, "♪ <i>Tapez dans vos mains</i>\n<i>Et respectez nos lois</i> ♪"),
    (6000, 8000, "Ça va me rester\ndans la tête."),
)
SONG_EN = srt(
    (1000, 3000, "<i>It's a Roman world</i>\n<i>Not a Gallic one</i>"),
    (3100, 5000, "Clap your hands\nAnd respect our laws"),
    (6000, 8000, "I'll never get this\nout of my head."),
)


def test_sung_lines_keep_lyric_breaks():
    imp = build("s01e04", FAKE_INFO, texts(fr=SONG_FR, sdh=SONG_SDH, en=SONG_EN), "content/x.mkv")
    assert [l["fr"] for l in imp.lines] == [
        "C'est un monde romain\nPas un monde gaulois",   # break taken from the SDH cue
        "Tapez dans vos mains\nEt respectez nos lois",
        "Ça va me rester dans la tête.",                 # spoken: joined
    ]
    assert [t["text"] for t in imp.translations] == [
        "It's a Roman world\nNot a Gallic one",
        "Clap your hands\nAnd respect our laws",
        "I'll never get this out of my head.",
    ]


def test_group_mixing_song_and_speech_is_joined():
    en = srt((1000, 8000, "It's a Roman world\nNot a Gallic one"))
    fr = srt((1000, 3000, "<i>C'est un monde romain</i>\n<i>Pas un monde gaulois</i>"),
             (3100, 8000, "Quoi ?"))
    sdh = srt((1000, 3000, "♪ C'est un monde romain\nPas un monde gaulois ♪"), (3100, 8000, "Quoi ?"))
    imp = build("s01e04", FAKE_INFO, texts(fr=fr, sdh=sdh, en=en), "content/x.mkv")
    assert [t["text"] for t in imp.translations] == ["It's a Roman world Not a Gallic one"]


def test_whitespace_only_change_is_allowed_under_scenes(conn):
    flat = SDH.replace("♪ Il fait beau ♪", "Il fait beau")   # line 2 spoken: one line
    write(conn, build("s01e04", FAKE_INFO, texts(fr=FR.replace("Il fait beau", "Il fait\nbeau"),
                                                 sdh=flat), "content/x.mkv"))
    _add_scene(conn)
    assert conn.execute("SELECT fr FROM lines WHERE idx = 2").fetchone()[0] == "Il fait beau"
    # Now sung: the same words keep their break.
    write(conn, build("s01e04", FAKE_INFO, texts(fr=FR.replace("Il fait beau", "Il fait\nbeau")),
                      "content/x.mkv"))
    assert conn.execute("SELECT fr FROM lines WHERE idx = 2").fetchone()[0] == "Il fait\nbeau"
    assert conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0] == 1


# --- corrections ------------------------------------------------------------

def _corr(*entries, episode="s01e04"):
    return {"episode": episode, "translations": list(entries)}


def test_corrections_replace_group_text(conn):
    from frenchirix.importer import apply_corrections
    imp = build("s01e04", FAKE_INFO, texts(), "content/x.mkv")
    n = apply_corrections("s01e04", imp.translations, _corr(
        {"lang": "en", "first": 5, "last": 5, "text": "Ouch!", "reason": "missing"},
        {"lang": "en", "first": 2, "last": 3, "text": "Lovely\nweather.", "reason": "x"}))
    assert n == 2
    write(conn, imp)
    rows = [tuple(r) for r in conn.execute(
        "SELECT first_line_idx, last_line_idx, text, source FROM translations ORDER BY group_idx")]
    assert rows == [
        (1, 1, "Hello, Asterix!", "subtitle:7"),
        (2, 3, "Lovely\nweather.", "correction"),
        (4, 4, "Are you coming? No.", "subtitle:7"),
        (5, 5, "Ouch!", "correction"),
    ]
    # cues keep the source text.
    assert conn.execute("SELECT raw_text FROM cues WHERE track = 'en' AND idx = 2").fetchone()[0] == \
        "Nice weather today."


def test_correction_must_match_a_group_exactly():
    from frenchirix.importer import apply_corrections
    imp = build("s01e04", FAKE_INFO, texts(), "content/x.mkv")
    with pytest.raises(ImportError_, match=r"entry 2 \(lines 2-2\)"):
        apply_corrections("s01e04", imp.translations, _corr(
            {"lang": "en", "first": 5, "last": 5, "text": "Ouch!"},
            {"lang": "en", "first": 2, "last": 2, "text": "Lovely"}))
    with pytest.raises(ImportError_):
        apply_corrections("s01e04", imp.translations, _corr(episode="s01e05"))
    with pytest.raises(ImportError_):
        apply_corrections("s01e04", imp.translations, _corr({"first": 1, "last": 1, "text": ""}))


def test_missing_corrections_file_means_none(tmp_path):
    from frenchirix.importer import apply_corrections, load_corrections
    assert load_corrections("s01e04", tmp_path) is None
    imp = build("s01e04", FAKE_INFO, texts(), "content/x.mkv")
    assert apply_corrections("s01e04", imp.translations, None) == 0
    (tmp_path / "s01e04.json").write_text('{"episode": "s01e04", "translations": []}')
    assert load_corrections("s01e04", tmp_path) == {"episode": "s01e04", "translations": []}


def test_reimport_with_corrections_is_stable(conn):
    from frenchirix.importer import apply_corrections
    for _ in range(2):
        imp = build("s01e04", FAKE_INFO, texts(), "content/x.mkv")
        apply_corrections("s01e04", imp.translations,
                          _corr({"lang": "en", "first": 5, "last": 5, "text": "Ouch!"}))
        msg = write(conn, imp)
    assert "unchanged" in msg


# --- annotation survives subtitle re-import -----------------------------------

def _annotate(conn, idx=2, fr_final="Il fait très beau"):
    lid = f"s01e04-{idx:04d}"
    conn.execute("UPDATE lines SET fr_final = ?, en_literal = 'x', annotated_by = 't', "
                 "audio_start_ms = 1, audio_end_ms = 2 WHERE id = ?", (fr_final, lid))
    conn.execute("INSERT INTO words (line_id, idx, text, char_start, char_end, start_ms) "
                 "VALUES (?, 1, 'Il', 0, 2, 5)", (lid,))
    conn.execute("INSERT INTO units (line_id, idx, kind, first_word_idx, last_word_idx, text, en) "
                 "VALUES (?, 1, 'word', 1, 1, 'Il', 'it')", (lid,))
    conn.commit()


def _annotation(conn):
    return ([tuple(r) for r in conn.execute(
                "SELECT id, fr_final, en_literal, annotated_by, audio_start_ms, audio_end_ms "
                "FROM lines WHERE fr_final IS NOT NULL")],
            [tuple(r) for r in conn.execute("SELECT * FROM words")],
            [tuple(r) for r in conn.execute("SELECT * FROM units")])


def test_unchanged_reimport_with_annotation_writes_nothing(conn):
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    _annotate(conn)
    before = conn.total_changes
    assert "unchanged" in write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    assert conn.total_changes == before


def test_rewrite_carries_annotation_across(conn):
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    _add_scene(conn)
    _annotate(conn)
    kept = _annotation(conn)
    # Speaker and translation change, and a whitespace-only change to line 2.
    en = srt((1000, 3000, "Hi!"), (4050, 8000, "Nice weather today."), (9000, 13000, "Coming? No."))
    sdh = SDH.replace("[Obélix] Bonjour", "Bonjour")
    fr = FR.replace("Il fait beau", "Il fait\nbeau")
    msg = write(conn, build("s01e04", FAKE_INFO, texts(fr=fr, sdh=sdh, en=en), "content/x.mkv"))
    assert "wrote" in msg
    assert _annotation(conn) == kept
    assert conn.execute("SELECT speaker FROM lines WHERE idx = 1").fetchone()[0] is None
    # fr_cue_id points at the new French cues.
    assert [tuple(r) for r in conn.execute(
        "SELECT l.idx, c.idx FROM lines l JOIN cues c ON c.id = l.fr_cue_id ORDER BY l.idx")] == \
        [(i, i) for i in range(1, 6)]


def test_rewrite_refuses_to_change_annotated_text(conn):
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    _annotate(conn)   # no scenes: only the annotation guard applies
    kept = _annotation(conn)
    with pytest.raises(ImportError_, match="annotated lines \\(s01e04-0002\\)"):
        write(conn, build("s01e04", FAKE_INFO, texts(fr=FR.replace("Il fait beau", "Il pleut")),
                          "content/x.mkv"))
    # Dropping the annotated line is refused too.
    short = srt((1000, 3000, "Bonjour, <i>Astérix</i> !"))
    with pytest.raises(ImportError_):
        write(conn, build("s01e04", FAKE_INFO, texts(fr=short), "content/x.mkv"))
    assert _annotation(conn) == kept
    assert conn.execute("SELECT fr FROM lines WHERE idx = 2").fetchone()[0] == "Il fait beau"


def test_unannotated_lines_can_be_dropped(conn):
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    _annotate(conn, idx=1, fr_final="Bonjour Astérix")
    shorter = FR[:FR.index("\n\n4\n")] + "\n"
    write(conn, build("s01e04", FAKE_INFO, texts(fr=shorter), "content/x.mkv"))
    assert [r[0] for r in conn.execute("SELECT idx FROM lines ORDER BY idx")] == [1, 2, 3]
    assert conn.execute("SELECT fr_final FROM lines WHERE idx = 1").fetchone()[0] == "Bonjour Astérix"


def test_corrections_rewrite_keeps_annotation(conn):
    from frenchirix.importer import apply_corrections
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv"))
    _add_scene(conn)
    _annotate(conn)
    kept = _annotation(conn)
    imp = build("s01e04", FAKE_INFO, texts(), "content/x.mkv")
    apply_corrections("s01e04", imp.translations,
                      {"episode": "s01e04", "translations": [{"first": 5, "last": 5, "text": "Ouch!"}]})
    assert "wrote" in write(conn, imp)
    assert _annotation(conn) == kept
    assert conn.execute("SELECT source FROM translations WHERE first_line_idx = 5").fetchone()[0] == "correction"


def test_source_path_finds_the_one_mkv_naming_the_episode(tmp_path):
    from frenchirix.importer import source_path
    (tmp_path / "My.Show.s01e04.MKV").write_bytes(b"")
    (tmp_path / "My.Show.S01E04.en.srt").write_text("")
    (tmp_path / "My.Show.S01E05.mkv").write_bytes(b"")
    assert source_path("s01e04", tmp_path).name == "My.Show.s01e04.MKV"
    with pytest.raises(ImportError_, match="found none"):
        source_path("s02e01", tmp_path)
    (tmp_path / "Other.S01E04.mkv").write_bytes(b"")
    with pytest.raises(ImportError_, match="--file"):
        source_path("s01e04", tmp_path)


def test_show_name_is_given_once_then_reused(conn):
    from frenchirix.importer import show_name
    with pytest.raises(ImportError_, match="--show"):
        show_name(conn, "s01e04", None)
    write(conn, build("s01e04", FAKE_INFO, texts(), "content/x.mkv", "My Show"))
    assert conn.execute("SELECT show FROM episodes").fetchone()[0] == "My Show"
    assert show_name(conn, "s01e04", None) == "My Show"
    assert show_name(conn, "s01e05", None) == "My Show"
    assert show_name(conn, "s01e05", "Another") == "Another"


def test_build_refuses_audio_without_a_centre_channel():
    import copy
    info = copy.deepcopy(FAKE_INFO)
    for s in info["streams"]:
        if s["codec_type"] == "audio":
            s["channel_layout"] = "stereo"
    with pytest.raises(ImportError_, match="needs 5.1"):
        build("s01e04", info, texts(), "content/x.mkv")
