from frenchirix.db import connect
from frenchirix.importer import build, write
from frenchirix.sheet import sheet_for

from text_fixtures import FAKE_INFO, srt, texts


def test_sheet_format(tmp_path):
    conn = connect(tmp_path / "db.sqlite")
    fr = srt(
        (1000, 3000, "Bonjour, <i>Astérix</i> !"),
        (4000, 6000, "Il fait beau"),
        (6100, 8000, "aujourd'hui."),
        (65_000, 69_000, "- Tu viens ?\n- Non."),
        (70_000, 70_800, "Aïe !"),
    )
    sdh = srt(
        (0, 900, "[musique douce]"),
        (1000, 3000, "[Obélix] Bonjour, <i>Astérix</i> ! [rit]"),
        (4000, 6000, "♪ Il fait beau ♪"),
        (6100, 8000, "♪ aujourd'hui. ♪"),
        (30_000, 31_000, "- [cris]\n- [coups]"),
        (65_000, 69_000, "- [Obélix] Tu viens ?\n- [Astérix] Non."),
        (70_000, 70_800, "[César soupire] Aïe !"),
    )
    en = srt(
        (1000, 3000, "Hello, <i>Asterix</i>!"),
        (4050, 8000, "Nice weather\ntoday."),
        (65_000, 69_000, "- Are you coming?\n- No."),
    )
    write(conn, build("s01e04", FAKE_INFO, texts(fr=fr, sdh=sdh, en=en), "content/x.mkv"))
    assert sheet_for(conn, "s01e04") == (
        "     [musique douce]\n"
        "0001 00:01 (Obélix) Bonjour, Astérix ! | Hello, Asterix!\n"
        "     [rit]\n"
        "0002 00:04 ♪ Il fait beau | Nice weather / today.\n"
        "0003 00:06 ♪ aujourd'hui. | ^\n"
        "--- 57 s ---\n"
        "     [cris]\n"
        "     [coups]\n"
        "0004 01:05 (Obélix / Astérix) - Tu viens ? - Non. | - Are you coming? - No.\n"
        "0005 01:10 Aïe ! |\n"
        "     [César soupire]\n"
    )


def test_one_row_breaks():
    from frenchirix.sheet import _one_row
    assert _one_row("Tapez dans vos mains\nEt respectez nos lois") == \
        "Tapez dans vos mains / Et respectez nos lois"
    assert _one_row("- Tu viens ?\n- Non.") == "- Tu viens ? - Non."
    assert _one_row("- La la\nlère\n- Non.") == "- La la / lère - Non."
