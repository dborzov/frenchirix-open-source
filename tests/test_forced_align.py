"""Spelling for the aligner, token targets, mapping aligner output back to words, and
skip/force behaviour of alignment. None of these need the `asr` dependency group."""

from __future__ import annotations

import pytest

from frenchirix import asr_audio, forced_align
from frenchirix.forced_align import STAR, LineText, build_targets, min_frames, spell, word_times

from test_transcribe import make_db


@pytest.mark.parametrize("word, spelled", [
    ("Été", "ete"), ("peut-être", "peutetre"), ("J'en", "j'en"), ("J’en", "j'en"),
    ("cœur", "coeur"), ("Ça", "ca"), ("Obélix", "obelix"), ("aujourd'hui", "aujourd'hui"),
    ("49.3", None), ("2e", None), ("λ", None),
])
def test_spell(word, spelled):
    assert spell(word) == spelled


def test_targets_with_fillers_and_unspellable_words():
    t = build_targets([
        LineText(5, ["Oui", "49.3"]),
        LineText(6, None),
        LineText(7, None),
        LineText(8, ["Ah"]),
    ])
    assert t.tokens == [STAR, "o", "u", "i", STAR, STAR, "a", "h", STAR]
    assert t.ranges == {(5, 1): (1, 4), (5, 2): (4, 5), (8, 1): (6, 8)}
    assert t.unspellable == {(5, 2)}
    assert min_frames(t.tokens) == len(t.tokens) + 1  # the repeated star needs a blank


def test_line_boundaries_get_a_wildcard():
    t = build_targets([LineText(1, ["a"]), LineText(2, ["b"])])
    assert t.tokens == [STAR, "a", STAR, "b", STAR]


def test_word_times_from_token_spans():
    t = build_targets([LineText(5, ["Oui", "49.3", "non"])])
    # tokens: * o u i * n o n *
    spans = [(0, 10, 1.0), (10, 12, 0.8), (13, 14, 0.6), (14, 15, 1.0),
             (15, 30, 1.0), (30, 31, 0.5), (32, 33, 0.5), (34, 35, 0.5), (35, 50, 1.0)]
    times = word_times(t, spans, frame_ms=20.0, offset_ms=1_000)
    assert times[(5, 1)] == forced_align.WordTime(1_200, 1_300, 0.8)  # (2*0.8+0.6+1)/4
    assert times[(5, 2)] == forced_align.WordTime(1_300, 1_600, None)  # unspellable: no score
    assert times[(5, 3)] == forced_align.WordTime(1_600, 1_700, 0.5)
    ordered = [times[k] for k in sorted(times)]
    for a, b in zip(ordered, ordered[1:]):
        assert a.start_ms <= a.end_ms <= b.start_ms <= b.end_ms


def test_word_times_rejects_a_length_mismatch():
    t = build_targets([LineText(1, ["ab"])])
    with pytest.raises(ValueError):
        word_times(t, [(0, 1, 1.0)], frame_ms=20.0, offset_ms=0)


class FakeEmission:
    def __init__(self, frames):
        self.shape = (1, frames, 29)


class FakeAligner:
    """Gives token k the frames [2k, 2k+1) with probability 0.9."""

    instances = 0
    device = "cpu"

    def __init__(self):
        FakeAligner.instances += 1
        self.calls = []

    def emission(self, samples):
        return FakeEmission(len(samples) // 320), 20.0

    def align(self, emission, tokens):
        return [(2 * k, 2 * k + 1, 0.9) for k in range(len(tokens))]

    def close(self):
        pass


@pytest.fixture
def db(tmp_path, monkeypatch):
    conn = make_db(tmp_path / "db.sqlite", [
        (1, 10_000, 12_000, "Bonjour.", "Bonjour, Astérix !"),
        (2, 12_500, 14_000, "Oui.", None),  # in no scene: a wildcard
        (3, 14_200, 16_000, "Il a 49.3 ans.", "Il a 49.3 ans."),
        (4, 40_000, 42_000, "Plus tard.", "Plus tard."),
    ])
    monkeypatch.setattr(asr_audio, "episode_source", lambda conn, ep: (tmp_path / "x.mkv", 3, 60_000))
    monkeypatch.setattr(asr_audio, "load_centre_channel", lambda *a, **k: [0.0] * (60 * 16_000))
    FakeAligner.instances = 0
    monkeypatch.setattr(forced_align, "Aligner", FakeAligner)
    return conn


def _times(conn, line_id):
    return [tuple(r) for r in conn.execute(
        "SELECT idx, start_ms, end_ms, score FROM words WHERE line_id = ? ORDER BY idx", (line_id,))]


def test_align_fills_words_and_lines(db):
    forced_align.align_episode(db, "s01e04")
    # Region 1 holds lines 1-3 and starts at 9250 ms. Its tokens start * b o n j o u r a s t e r i x *;
    # the fake aligner puts token k at frames [2k, 2k+1) of 20 ms.
    l1 = _times(db, "s01e04-0001")
    assert l1 == [(1, 9_250 + 2 * 20, 9_250 + 15 * 20, 0.9), (2, 9_250 + 16 * 20, 9_250 + 29 * 20, 0.9)]
    l3 = _times(db, "s01e04-0003")
    assert [r[3] for r in l3] == [0.9, 0.9, None, 0.9]  # 49.3 has a span but no score
    assert all(r[1] is not None and r[1] <= r[2] for r in l3)
    starts = db.execute("SELECT idx, audio_start_ms, audio_end_ms FROM lines ORDER BY idx").fetchall()
    assert starts[0][1:] == (l1[0][1], l1[-1][2])
    assert starts[1][1:] == (None, None)
    assert starts[2][1:] == (l3[0][1], l3[-1][2])
    assert starts[3][1] is not None
    assert FakeAligner.instances == 1


def test_align_skips_timed_lines_unless_forced(db):
    forced_align.align_episode(db, "s01e04")
    db.execute("UPDATE words SET start_ms = 1, end_ms = 2 WHERE line_id = 's01e04-0004'")
    db.commit()
    FakeAligner.instances = 0
    forced_align.align_episode(db, "s01e04")
    assert FakeAligner.instances == 0  # everything timed: no model loaded
    assert _times(db, "s01e04-0004")[0][1:3] == (1, 2)

    db.execute("UPDATE words SET start_ms = NULL WHERE line_id = 's01e04-0001' AND idx = 2")
    db.commit()
    forced_align.align_episode(db, "s01e04")
    assert FakeAligner.instances == 1
    assert _times(db, "s01e04-0004")[0][1:3] == (1, 2)  # other region untouched

    forced_align.align_episode(db, "s01e04", force=True)
    assert _times(db, "s01e04-0004")[0][1:3] != (1, 2)


def test_mismatched_words_rows_are_skipped(db):
    db.execute("UPDATE words SET text = 'Bonsoir' WHERE line_id = 's01e04-0001' AND idx = 1")
    db.commit()
    forced_align.align_episode(db, "s01e04")
    assert _times(db, "s01e04-0001")[0][1] is None
    assert _times(db, "s01e04-0003")[0][1] is not None


# --- the guard -------------------------------------------------------------------------------

from frenchirix.forced_align import GuardSettings, WordTime, apply_guard, even_times, line_window  # noqa: E402

W = WordTime


def _guard(placed, windows, todo, realign, n_words=None):
    """Subtitle times are the windows shrunk by the 2.5 s slack."""
    n_words = n_words or {i: len(t) if t else 2 for i, t in placed.items()}
    subs = {i: (lo + 2_500, hi - 2_500) for i, (lo, hi) in windows.items()}
    return apply_guard(placed, n_words, windows, subs, todo, realign, GuardSettings(slack_ms=2500))


def test_line_window_is_clamped():
    assert line_window(1_000, 3_000, 2_500, 4_000) == (0, 4_000)
    assert line_window(10_000, 12_000, 2_500, 60_000) == (7_500, 14_500)


def test_well_placed_lines_are_left_alone():
    placed = {1: [W(1_000, 1_200, 0.9), W(1_200, 1_500, 0.8)], 2: [W(5_000, 5_400, 0.7)]}
    windows = {1: (0, 4_000), 2: (3_000, 8_000)}

    def no_realign(*a):
        raise AssertionError("must not re-align")

    times, status = _guard(placed, windows, {1, 2}, no_realign)
    assert times == placed and status == {1: "ok", 2: "ok"}


def test_misplaced_line_is_realigned_between_its_neighbours():
    placed = {1: [W(1_000, 1_500, 0.9)],
              2: [W(2_000, 2_300, 1.0), W(2_300, 2_600, 1.0)],  # 6 s before its subtitle
              3: [W(9_800, 10_500, 0.9)]}
    windows = {1: (0, 4_000), 2: (5_500, 11_000), 3: (7_000, 13_000)}
    calls = []

    def realign(i, lo, hi):
        calls.append((i, lo, hi))
        return [W(lo + 100, lo + 300, 0.8), W(lo + 300, lo + 500, 0.6)]

    times, status = _guard(placed, windows, {1, 2, 3}, realign)
    assert calls == [(2, 5_500, 9_800)]  # window start, up to the next line's start
    assert times[2] == [W(5_600, 5_800, 0.8), W(5_800, 6_000, 0.6)]
    assert status == {1: "ok", 2: "realigned", 3: "ok"}


def test_low_score_line_keeps_the_better_placement():
    placed = {1: [W(5_000, 5_500, 0.2)]}  # in its window but weak
    windows = {1: (3_000, 9_000)}
    times, status = _guard(placed, windows, {1}, lambda i, lo, hi: [W(4_000, 4_300, 0.1)])
    assert times[1] == placed[1] and status[1] == "kept"
    times, status = _guard(placed, windows, {1}, lambda i, lo, hi: [W(4_000, 4_300, 0.6)])
    assert times[1] == [W(4_000, 4_300, 0.6)] and status[1] == "realigned"


def test_line_that_cannot_be_placed_falls_back_to_its_subtitle_time():
    placed = {1: [W(100, 300, 0.9), W(300, 500, 0.9)]}  # far outside
    windows = {1: (6_000, 12_000)}  # subtitle 8.5-9.5 s
    times, status = _guard(placed, windows, {1}, lambda i, lo, hi: [W(6_500, 6_700, 0.05), W(6_700, 7_000, 0.1)])
    assert status[1] == "unreliable"
    assert times[1] == even_times(2, 8_500, 9_500) == [W(8_500, 9_000, 0.0), W(9_000, 9_500, 0.0)]

    times, status = _guard(placed, windows, {1}, lambda i, lo, hi: None)  # aligner gave up
    assert status[1] == "unreliable" and times[1] == even_times(2, 8_500, 9_500)


def test_unreliable_line_is_clipped_to_the_space_its_neighbours_leave():
    placed = {1: [W(8_000, 9_200, 0.9)], 2: None}
    windows = {1: (5_000, 11_000), 2: (6_000, 12_000)}  # subtitle of 2: 8.5-9.5 s
    times, status = _guard(placed, windows, {1, 2}, lambda i, lo, hi: None, n_words={1: 1, 2: 2})
    assert status[2] == "unreliable"
    assert times[2] == even_times(2, 9_200, 9_500)


def test_fixed_lines_bound_but_are_never_changed():
    placed = {1: [W(5_000, 6_000, 0.9)],  # not to align: stays even though "outside"
              2: None}  # region alignment failed for this line
    windows = {1: (0, 3_000), 2: (4_000, 9_000)}
    calls = []

    def realign(i, lo, hi):
        calls.append((lo, hi))
        return [W(lo, lo + 200, 0.9), W(lo + 200, lo + 400, 0.9)]

    times, status = _guard(placed, windows, {2}, realign, n_words={1: 1, 2: 2})
    assert calls == [(6_000, 9_000)]
    assert set(times) == {2} and status == {2: "realigned"}


def test_align_records_the_guard_in_meta(db):
    import json

    forced_align.align_episode(db, "s01e04")
    meta = json.loads(db.execute("SELECT value FROM meta WHERE key = 'align:s01e04'").fetchone()[0])
    assert meta["guard"]["slack_ms"] == 2500
    assert meta["guard"]["unreliable_score"] == 0.0


# --- confirmation by the recogniser ------------------------------------------------------------

from frenchirix.forced_align import WordTime as _WT, apply_guard as _apply_guard_c, recogniser_agrees


def _ctimes(starts):
    return [_WT(s, s + 90, 0.05) for s in starts]


WORDS = ["On", "est", "bien", "il", "fait", "beau"]


def test_recogniser_agrees_when_starts_match():
    times = _ctimes([1000, 1100, 1200, 1400, 1500, 1600])
    heard = [(s + 40, s + 90, w + ",", 0.9) for s, w in zip([1000, 1100, 1200, 1400, 1500, 1600], WORDS)]
    ok, detail = recogniser_agrees(WORDS, times, heard)
    assert ok, detail


def test_recogniser_tolerates_an_early_first_word_but_not_a_shifted_line():
    starts = [1000, 1100, 1200, 1400, 1500, 1600]
    heard = [(s, s + 90, w, 0.9) for s, w in zip(starts, WORDS)]
    heard[0] = (400, 1090, "On", 0.9)  # Whisper's first word after a pause starts early
    assert recogniser_agrees(WORDS, _ctimes(starts), heard)[0]
    late = [(s + 400, s + 490, w, 0.9) for s, w in zip(starts, WORDS)]
    assert not recogniser_agrees(WORDS, _ctimes(starts), late)[0]


def test_recogniser_must_hear_every_word_sure_enough():
    starts = [1000, 1100, 1200, 1400, 1500, 1600]
    missing = [(s, s + 90, w, 0.9) for s, w in zip(starts, WORDS) if w != "fait"]
    assert not recogniser_agrees(WORDS, _ctimes(starts), missing)[0]
    unsure = [(s, s + 90, w, 0.2) for s, w in zip(starts, WORDS)]
    assert not recogniser_agrees(WORDS, _ctimes(starts), unsure)[0]


def test_guard_keeps_a_confirmed_low_score_placement():
    low = _ctimes([1000, 1100])
    placed = {1: low}
    args = (placed, {1: 2}, {1: (0, 5000)}, {1: (900, 1500)}, {1}, lambda i, lo, hi: low)
    times, status = _apply_guard_c(*args)
    assert status[1] == "unreliable" and times[1][0].score == 0.0
    times, status = _apply_guard_c(*args, confirm=lambda i, t: True)
    assert status[1] == "confirmed" and times[1] == low
