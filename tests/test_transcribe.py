"""Speech regions, the name prompt, and skip/force behaviour of transcription.

None of these need the `asr` dependency group.
"""

from __future__ import annotations

import json

import pytest

from frenchirix import asr_audio, transcribe
from frenchirix.db import connect
from frenchirix.text import split_words
from frenchirix.transcribe import Region, build_regions, name_prompt_words


def make_db(path, lines, *, duration_ms=60_000, source="content/x.mkv"):
    """A database with one episode, s01e04, and `lines` as (idx, start, end, fr, fr_final).

    Lines with `fr_final` get their `words` rows from split_words. Shared with
    test_forced_align.py.
    """
    conn = connect(path)
    conn.execute(
        "INSERT INTO episodes VALUES ('s01e04', 'show', 1, 4, ?, ?, 1920, 1080, 24.0, 3, '5.1(side)')",
        (source, duration_ms))
    for idx, start, end, fr, fr_final in lines:
        cue = conn.execute(
            "INSERT INTO cues (episode_id, track, stream_index, idx, start_ms, end_ms, raw_text) "
            "VALUES ('s01e04', 'fr', 11, ?, ?, ?, ?)", (idx, start, end, fr)).lastrowid
        line_id = f"s01e04-{idx:04d}"
        conn.execute(
            "INSERT INTO lines (id, episode_id, idx, start_ms, end_ms, fr, group_idx, fr_cue_id, "
            "fr_final) VALUES (?, 's01e04', ?, ?, ?, ?, ?, ?, ?)",
            (line_id, idx, start, end, fr, idx, cue, fr_final))
        if fr_final is not None:
            conn.executemany(
                "INSERT INTO words (line_id, idx, text, char_start, char_end) VALUES (?, ?, ?, ?, ?)",
                [(line_id, n, w, a, b) for n, (w, a, b) in enumerate(split_words(fr_final), 1)])
    conn.commit()
    return conn


def test_lines_closer_than_two_seconds_merge():
    regions = build_regions([(1, 10_000, 12_000), (2, 13_500, 15_000), (3, 17_000, 18_000)], 60_000)
    # gap 1.5 s merges; gap 2.0 s does not
    assert [r.lines for r in regions] == [[1, 2], [3]]
    assert regions[0] == Region(9_250, 15_750, [1, 2])
    assert regions[1] == Region(16_250, 18_750, [3])


def test_padding_stops_at_half_the_gap():
    regions = build_regions([(1, 10_000, 11_000), (2, 12_000, 13_000)], 60_000, merge_gap_ms=500)
    assert [(r.start_ms, r.end_ms) for r in regions] == [(9_250, 11_500), (11_500, 13_750)]


def test_padding_is_clamped_to_the_episode():
    regions = build_regions([(1, 200, 1_000), (2, 59_500, 59_900)], 60_000)
    assert (regions[0].start_ms, regions[-1].end_ms) == (0, 60_000)


def test_regions_never_overlap_and_cover_their_lines():
    lines = [(i, i * 2_300, i * 2_300 + 1_900) for i in range(1, 60)]  # gaps of 0.4 s
    regions = build_regions(lines, 200_000)
    assert len(regions) > 1
    for a, b in zip(regions, regions[1:]):
        assert a.end_ms <= b.start_ms
    for r in regions:
        assert r.end_ms - r.start_ms <= 28_000
        for i in r.lines:
            _, s, e = lines[i - 1]
            assert r.start_ms <= s and e <= r.end_ms
    assert sorted(i for r in regions for i in r.lines) == list(range(1, 60))


def test_long_region_splits_at_its_largest_gap():
    lines = [(1, 0, 5_000), (2, 5_500, 12_000), (3, 13_900, 20_000), (4, 20_300, 30_000)]
    regions = build_regions(lines, 100_000, pad_ms=0)
    assert [r.lines for r in regions] == [[1, 2], [3, 4]]  # the 1.9 s gap


def test_overlapping_lines_and_a_single_long_line():
    regions = build_regions([(1, 0, 40_000), (2, 39_000, 41_000), (3, 50_000, 51_000)], 100_000)
    assert [r.lines for r in regions] == [[1, 2], [3]]  # cannot split inside one line
    assert regions[0].end_ms - regions[0].start_ms > 28_000


def test_names_come_from_recurring_mid_sentence_capitals():
    texts = [
        "Allez, Astérix, on y va !",
        "Bonjour Obélix. Tu viens ?",
        "Où est Obélix ?",
        "Dis à Astérix que Panoramix arrive.",
        "Panoramix ! Astérix !",  # sentence-initial words do not count
        "- Non.\n- Si, Métadata, on y va.",
        "Métadata, Rome !",
    ]
    names = name_prompt_words(texts)
    assert names[:2] == ["Astérix", "Obélix"]
    assert "Panoramix" not in names  # once mid-sentence, once initial
    assert "Tu" not in names and "Non" not in names
    assert "Métadata" not in names  # once mid-sentence (after a dash line)


def _fake_audio(monkeypatch, tmp_path):
    monkeypatch.setattr(asr_audio, "episode_source", lambda conn, ep: (tmp_path / "x.mkv", 3, 60_000))
    monkeypatch.setattr(asr_audio, "load_centre_channel", lambda *a, **k: [0.0] * (60 * 16_000))
    monkeypatch.setattr(asr_audio, "release_gpu", lambda: None)


def test_skip_without_force_and_replace_with_force(tmp_path, monkeypatch):
    conn = make_db(tmp_path / "db.sqlite", [
        (1, 10_000, 12_000, "Bonjour Astérix.", None),
        (2, 30_000, 32_000, "Salut Astérix !", None),
    ])
    conn.execute("INSERT INTO asr_words (episode_id, idx, start_ms, end_ms, text, prob) "
                 "VALUES ('s01e04', 1, 0, 10, 'vieux', 0.5)")
    conn.commit()
    _fake_audio(monkeypatch, tmp_path)

    def no_model(*a, **k):
        raise AssertionError("the model must not be loaded")

    monkeypatch.setattr(transcribe, "load_model", no_model)
    transcribe.transcribe_episode(conn, "s01e04")
    assert [r[0] for r in conn.execute("SELECT text FROM asr_words")] == ["vieux"]

    prompts = []

    def fake_recognise(model, samples, offset_ms, *, prompt=None, dropped=None):
        prompts.append(prompt)
        assert len(samples) == 3_500 * 16  # the region's cut of the episode, 3.5 s
        return [(offset_ms + 800, offset_ms + 1_100, "Bonjour", 0.9),
                (offset_ms + 1_100, offset_ms + 1_500, "Astérix.", 0.6)]

    monkeypatch.setattr(transcribe, "load_model", lambda: (object(), {"device": "cpu", "compute_type": "int8"}))
    monkeypatch.setattr(transcribe, "recognise", fake_recognise)
    transcribe.transcribe_episode(conn, "s01e04", force=True)
    rows = conn.execute("SELECT idx, start_ms, end_ms, text, prob FROM asr_words ORDER BY idx").fetchall()
    assert [tuple(r) for r in rows] == [
        (1, 10_050, 10_350, "Bonjour", 0.9), (2, 10_350, 10_750, "Astérix.", 0.6),
        (3, 30_050, 30_350, "Bonjour", 0.9), (4, 30_350, 30_750, "Astérix.", 0.6)]
    assert prompts == ["Astérix.", "Astérix."]  # names only, never the subtitle sentences
    meta = json.loads(conn.execute("SELECT value FROM meta WHERE key = 'asr:s01e04'").fetchone()[0])
    assert meta["options"]["language"] == "fr"
    assert meta["options"]["condition_on_previous_text"] is False
    assert meta["audio"]["filter"] == "pan=mono|c0=FC"
    assert meta["regions"]["count"] == 2


def test_join_tokens():
    words = [(0, 100, "Non", 0.9), (100, 120, "!", 0.8), (200, 260, "c", 0.99),
             (260, 400, "'est", 0.7), (400, 500, "lui", 0.9), (500, 510, "?", 0.5)]
    assert transcribe.join_tokens(words) == [
        (0, 100, "Non !", 0.9), (200, 400, "c'est", 0.7), (400, 500, "lui ?", 0.9)]
    assert transcribe.join_tokens([(0, 10, "…", 0.5), (10, 20, "'a", 0.5)]) == [(10, 20, "'a", 0.5)]


@pytest.mark.parametrize("text, credit", [
    (" Sous-titrage Société Radio-Canada", True), (" Sous-titrage ST' 501", True),
    (" Merci, Astérix !", False), (" Il est sous la table.", False),
])
def test_credit_pattern(text, credit):
    assert bool(transcribe.CREDIT_PATTERN.search(text)) is credit


def test_unknown_episode(tmp_path):
    conn = make_db(tmp_path / "db.sqlite", [])
    with pytest.raises(ValueError):
        transcribe.transcribe_episode(conn, "s09e09")
