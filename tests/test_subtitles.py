from frenchirix.subtitles import clean_text, is_speaker_label, parse_sdh, parse_srt

from text_fixtures import srt


def test_parse_srt_basic():
    cues = parse_srt(srt((1000, 2500, "Bonjour"), (3_723_004, 3_725_000, "Deux\nlignes")))
    assert [(c.idx, c.start_ms, c.end_ms, c.text) for c in cues] == [
        (1, 1000, 2500, "Bonjour"),
        (2, 3_723_004, 3_725_000, "Deux\nlignes"),
    ]


def test_parse_srt_bom_crlf_and_odd_counters():
    data = "﻿7\r\n00:00:01,000 --> 00:00:02,000\r\nUn\r\n\r\n99\r\n00:00:03,000 --> 00:00:04,000\r\n<i>Deux</i>\r\ntrois\r\n"
    cues = parse_srt(data)
    assert [(c.idx, c.text) for c in cues] == [(1, "Un"), (2, "<i>Deux</i>\ntrois")]


def test_parse_srt_keeps_numeric_text():
    cues = parse_srt(srt((0, 1000, "49"), (2000, 3000, "Trois")))
    assert [c.text for c in cues] == ["49", "Trois"]


def test_clean_text_joins_wrapped_lines_and_strips_tags():
    assert clean_text("<i>C'est un monde romain</i>\n<i>Pas un monde gaulois </i>") == \
        "C'est un monde romain Pas un monde gaulois"
    assert clean_text("Moi, je préfère le chamboule-tout,\nla pêche aux canards…") == \
        "Moi, je préfère le chamboule-tout, la pêche aux canards…"


def test_clean_text_keeps_one_line_per_speaker():
    assert clean_text("- Article 49.3.\n-C'est en tout petit.") == "- Article 49.3.\n- C'est en tout petit."
    assert clean_text("- Une phrase qui\ncontinue.\n- Oui.") == "- Une phrase qui continue.\n- Oui."
    # A lone leading dash is not a second speaker.
    assert clean_text("- Seul.") == "Seul."


def test_speaker_labels():
    assert is_speaker_label("Métadata")
    assert is_speaker_label("speaker")
    assert is_speaker_label("forain 2")
    assert is_speaker_label("mère de César")
    assert is_speaker_label("Astérix enfant")
    assert not is_speaker_label("César soupire")
    assert not is_speaker_label("ricane")
    assert not is_speaker_label("accent du Sud")


def _sdh(text):
    return parse_sdh(parse_srt(srt((0, 1000, text)))[0])


def test_sdh_speaker_and_sounds():
    s = _sdh("[Métadata] On s'en fout.")
    assert s.speech == "On s'en fout."
    assert s.speakers == ["Métadata"]
    assert s.sounds == []
    s = _sdh("[César soupire] Bon.")
    assert s.speakers == [None] and s.sounds == ["César soupire"] and s.speech == "Bon."
    s = _sdh("Oh non, de la flotte. [souffle]")
    assert s.speech == "Oh non, de la flotte." and s.sounds == ["souffle"]


def test_sdh_sound_only_and_label_without_speech():
    s = _sdh("- [musique légère et enjouée]\n- [Potus soupire]")
    assert s.speech == "" and s.sounds == ["musique légère et enjouée", "Potus soupire"]
    # A capitalised bracket alone is a sound, not a speaker.
    s = _sdh("[Obélix]")
    assert s.speech == "" and s.speakers == []


def test_sdh_song_and_two_speakers():
    s = _sdh("[groupe] ♪ <i>C'est un monde romain</i>\n<i>Pas un monde gaulois </i>♪")
    assert s.is_song and s.speakers == ["groupe"]
    assert s.speech == "C'est un monde romain Pas un monde gaulois"
    s = _sdh("- [Obélix] Non.\n- [Abraracourcix] Quoi ?")
    assert not s.is_song
    assert s.speakers == ["Obélix", "Abraracourcix"]
    assert s.speech == "- Non.\n- Quoi ?"


def test_clean_text_keeps_lyric_breaks_on_request():
    raw = "<i>Tapez dans vos mains</i>\n<i>Et respectez nos lois </i>"
    assert clean_text(raw) == "Tapez dans vos mains Et respectez nos lois"
    assert clean_text(raw, keep_breaks=True) == "Tapez dans vos mains\nEt respectez nos lois"
    assert clean_text("- La la\nlère\n- Non.", keep_breaks=True) == "- La la\nlère\n- Non."


def test_transfer_breaks_from_sdh():
    from frenchirix.subtitles import transfer_breaks
    one = "C'est un monde romain Pas un monde gaulois"
    two = "C'est un monde romain\nPas un monde gaulois"
    assert transfer_breaks(one, two) == two
    # Punctuation and case may differ; the plain text's own characters are kept.
    assert transfer_breaks("Oh là là, que c'est bien !", "oh là là\nque c'est bien") == \
        "Oh là là,\nque c'est bien !"
    # Different words, or a text that already has a break: unchanged.
    assert transfer_breaks(one, "C'est un monde grec\nPas un monde gaulois") == one
    assert transfer_breaks(two, "C'est un monde\nromain Pas un monde gaulois") == two


def test_sdh_speech_lines_and_bracket_over_two_lines():
    s = _sdh("[groupe] ♪ <i>C'est un monde romain</i>\n<i>Pas un monde gaulois </i>♪")
    assert s.speech_lines == "C'est un monde romain\nPas un monde gaulois"
    s = _sdh("[musique du film :\n\"Titre\" de Quelqu'un]")
    assert s.sounds == ["musique du film : \"Titre\" de Quelqu'un"] and s.speech == ""
