"""Pure parts of frenchirix.app_export and scripts/check_questions.py (no media needed)."""

import importlib.util
from pathlib import Path

import pytest

from frenchirix import app_export as ax
from frenchirix.text import split_words

ROOT = Path(__file__).resolve().parent.parent


# --- unit spans -------------------------------------------------------------

def _words(text):
    return [{"idx": i, "text": w, "char_start": a, "char_end": b}
            for i, (w, a, b) in enumerate(split_words(text), start=1)]


def test_unit_char_span_reads_as_the_units_words():
    fr = "Et si tu n'aimes pas\nOn te l'imposera"
    ws = _words(fr)
    cs, ce = ax.unit_char_span(ws, 1, 5)
    assert fr[cs:ce] == "Et si tu n'aimes pas"
    cs, ce = ax.unit_char_span(ws, 6, 8)
    assert fr[cs:ce] == "On te l'imposera"


def test_unit_char_span_excludes_edge_punctuation():
    fr = "- Ah oui ? Bien sûr !"
    ws = _words(fr)
    assert fr[slice(*ax.unit_char_span(ws, 1, 2))] == "Ah oui"
    assert fr[slice(*ax.unit_char_span(ws, 3, 4))] == "Bien sûr"


# --- loop windows -----------------------------------------------------------

def test_loop_window_full_margin_in_silence():
    assert ax.loop_window(1000, 1500, 500, 2000, 10_000, 80) == (920, 1580)


def test_loop_window_stops_at_neighbouring_words():
    # 30 ms gap before, 0 ms after: widened only into the gap
    assert ax.loop_window(1000, 1500, 970, 1500, 10_000, 80) == (970, 1500)


def test_loop_window_never_shrinks_when_neighbour_overlaps():
    # a neighbour that ends after our start (overlapping speech) does not cut into us
    assert ax.loop_window(1000, 1500, 1100, 1400, 10_000, 80) == (1000, 1500)


def test_loop_window_clamped_to_audio():
    assert ax.loop_window(30, 9_980, None, None, 10_000, 80) == (0, 10_000)


def test_neighbours_ignore_own_words():
    spans = [(0, 100), (120, 300), (310, 400), (500, 600)]
    assert ax.neighbours(spans, 120, 400, {1, 2}) == (100, 500)
    assert ax.neighbours(spans, 0, 100, {0}) == (None, 120)


# --- key rule ----------------------------------------------------------------

@pytest.mark.parametrize("kind,text,key", [
    ("word", "le", True),                 # every word unit is key
    ("expression", "Mmh", False),
    ("expression", "Ah oui", False),
    ("expression", "C'est ça", False),
    ("expression", "je suis", False),
    ("expression", "Oh là là", False),
    ("expression", "Mais oui", False),
    ("expression", "C'est quoi", True),
    ("expression", "ça va", True),
    ("expression", "il mange", True),
    ("expression", "aux lions", True),
    ("expression", "Et si tu n’aimes pas", True),
])
def test_key_rule(kind, text, key):
    assert ax.is_key(kind, [w for w, _, _ in split_words(text)]) is key


def test_elisions_split_into_atoms():
    assert ax._word_atoms("C’est") == ["c'", "est"]
    assert ax._word_atoms("qu'on") == ["qu'", "on"]
    assert ax._word_atoms("aujourd'hui") == ["aujourd'hui"]


# --- difficulty buckets ---------------------------------------------------------

def test_difficulty_buckets_populate_all_values_by_rank():
    scores = {f"s{i:03d}": float(i) for i in range(200)}
    lv = ax.difficulty_buckets(scores)
    counts = [sum(v == k for v in lv.values()) for k in range(1, 6)]
    assert counts == [20, 50, 60, 50, 20]
    assert lv["s000"] == 1 and lv["s199"] == 5
    # monotonic in the score
    ordered = [lv[k] for k in sorted(scores, key=scores.get)]
    assert ordered == sorted(ordered)


def test_difficulty_buckets_deterministic_on_ties():
    lv = ax.difficulty_buckets({"b": 1.0, "a": 1.0, "c": 1.0, "d": 1.0, "e": 1.0})
    assert lv == ax.difficulty_buckets({"e": 1.0, "d": 1.0, "c": 1.0, "b": 1.0, "a": 1.0})


# --- gain plan -------------------------------------------------------------------

def test_plan_gain_static_when_peak_allows():
    assert ax.plan_gain(-28.0, -16.0) == (12.0, None)


def test_plan_gain_limits_only_the_excess():
    gain, limit = ax.plan_gain(-28.0, -12.0)  # gain 12 would put the peak at 0 dBTP
    assert gain == 12.0 and limit == -2.0


def test_plan_gain_caps_peak_reduction():
    gain, limit = ax.plan_gain(-30.0, -5.0)  # needs 14 dB, peak would be +9, 11 over
    assert limit == -2.0
    assert gain == pytest.approx(14.0 - (11.0 - 6.0))


# --- song fallback timings ----------------------------------------------------------

def test_spread_times_cover_the_window_in_order():
    t = ax.spread_times(["On", "est", "bien"], 1000, 2000)
    assert t[0][0] == 1000 and t[-1][1] == 2000
    assert all(a[1] == b[0] for a, b in zip(t, t[1:]))


def _w(spec, score=0.2):
    return [{"text": t, "start_ms": a, "end_ms": b, "score": score} for t, a, b in spec]


LINE = (("On", 1050, 1200), ("est", 1200, 1400), ("bien", 1400, 1900))


def test_line_timings_keeps_a_good_alignment():
    times, src, why = ax.line_timings(1000, 2000, _w(LINE), [])
    assert src == "aligned" and why is None and times[0] == (1050, 1200)


def test_line_timings_spreads_zero_scored_without_recogniser():
    times, src, why = ax.line_timings(1000, 2000, _w(LINE, 0.0), [])
    assert src == "spread" and why == "every word scored 0"
    assert times[0][0] == 1000 and times[-1][1] == 2000


def test_line_timings_drift_confirmed_by_recogniser_is_kept():
    # subtitle early by 1.5 s, recogniser agrees with the alignment
    late = [(t, a + 1500, b + 1500) for t, a, b in LINE]
    asr = [(a + 20, b, t.lower() + ",") for t, a, b in late]
    times, src, why = ax.line_timings(1000, 2000, _w(late), asr)
    assert src == "aligned" and "recogniser agrees" in why


def test_line_timings_drift_placed_on_recogniser_words():
    late = [(t, a + 3000, b + 3000) for t, a, b in LINE]
    asr = [(1060, 1190, "on"), (1210, 1390, "est"), (1410, 1880, "bien")]
    times, src, _ = ax.line_timings(1000, 2000, _w(late), asr)
    assert src == "asr" and times == [(1060, 1190), (1210, 1390), (1410, 1880)]


def test_line_timings_recogniser_fills_unmatched_words_in_gaps():
    words = _w((("On", 0, 1), ("est", 1, 2), ("bien", 2, 3), ("ici", 3, 4)), 0.0)
    asr = [(1000, 1100, "on"), (1500, 1700, "bien"), (1700, 1900, "ici")]
    times, src, _ = ax.line_timings(1000, 2000, words, asr)
    assert src == "asr" and times[1] == (1100, 1500)


def test_line_timings_recogniser_with_skipped_words_is_not_trusted():
    words = _w((("On", 0, 1), ("est", 1, 2), ("bien", 2, 3), ("ici", 3, 4)), 0.0)
    asr = [(1000, 1100, "on"), (1100, 1300, "bien"), (1300, 1500, "ici")]  # no room for "est"
    times, src, _ = ax.line_timings(1000, 2000, words, asr)
    assert src == "spread"


def test_line_timings_drift_with_confident_aligner_is_kept():
    late = [(t, a + 1500, b + 1500) for t, a, b in LINE]
    times, src, why = ax.line_timings(1000, 2000, _w(late, 0.8), [])
    assert src == "aligned" and "aligner confident" in why
    assert ax.line_timings(1000, 2000, _w(late, 0.2), [])[1] == "spread"


def test_line_timings_words_outside_the_clip_are_replaced():
    times, src, why = ax.line_timings(1000, 2000, _w(LINE, 0.9), [], clip=(1100, 5000))
    assert why == "words outside the clip" and src == "spread"


# --- questions merge -----------------------------------------------------------------

ENTRY = {
    "title_fr": "Aime-le… ou gare aux lions !", "difficulty": 3, "doubt": "unsure",
    "questions": [
        {"line": "s01e04-0017", "fr": "Que fait-on aux rebelles ?", "en": "What do they do to rebels?",
         "answers": [{"fr": "On les jette aux lions.", "en": "They throw them to the lions.", "correct": True},
                     {"fr": "On leur offre un gâteau.", "en": "They give them a cake.", "correct": False},
                     {"fr": "On les chatouille.", "en": "They tickle them.", "correct": False}]},
        {"line": None, "fr": "Qui chante cette chanson ?", "en": "Who sings this song?",
         "answers": [{"fr": "Les Romains", "en": "The Romans", "correct": True},
                     {"fr": "Les poissons", "en": "The fish", "correct": False},
                     {"fr": "Idéfix", "en": "Dogmatix", "correct": False}]},
    ],
}


def test_merge_questions_ids_title_difficulty():
    qs, title, difficulty = ax.merge_questions("s01e04-0016-0017", ENTRY)
    assert [q["id"] for q in qs] == ["s01e04-0016-0017:q1", "s01e04-0016-0017:q2"]
    assert qs[0]["lineId"] == "s01e04-0017" and "lineId" not in qs[1]
    assert title == "Aime-le… ou gare aux lions !" and difficulty == 3
    assert all("audio" not in q and "doubt" not in q for q in qs)


UNITS = {
    "Que fait-on aux rebelles ?": [["Que fait-on", "what do they do"], ["aux rebelles", "to the rebels"]],
    "On les jette aux lions.": [["On les jette", "they throw them"], ["aux lions", "to the lions"]],
    "On leur offre un gâteau.": [["On leur offre", "they give them"], ["un gâteau", "a cake"]],
    "On les chatouille.": [["On les chatouille", "they tickle them"], ["oops", "x"]],  # does not tile
}


def test_merge_questions_units_and_fallbacks():
    st = ax.QuestionStats()
    qs, _, _ = ax.merge_questions("s01e04-0016-0017", ENTRY, UNITS, st)
    q1 = qs[0]
    assert q1["units"] == [{"fr": "Que fait-on", "en": "what do they do", "cs": 0, "ce": 11},
                           {"fr": "aux rebelles", "en": "to the rebels", "cs": 12, "ce": 24}]
    assert q1["answers"][0]["units"][1] == {"fr": "aux lions", "en": "to the lions", "cs": 13, "ce": 22}
    # an entry that does not tile, and a sentence with no entry: one unit, edge punctuation left out
    assert q1["answers"][2]["units"] == [{"fr": "On les chatouille", "en": "They tickle them.", "cs": 0, "ce": 17}]
    assert qs[1]["answers"][2]["units"] == [{"fr": "Idéfix", "en": "Dogmatix", "cs": 0, "ce": 6}]
    assert len(st.sentences) == 8 and len(st.with_units) == 3 and len(st.fallbacks) == 5


@pytest.mark.parametrize("pieces,ok", [
    ([["Que fait-on", "a"], ["aux rebelles", "b"]], True),
    ([["Que fait-on aux rebelles", "a"]], True),
    ([["Que", "a"], ["aux rebelles", "b"]], False),           # "fait-on" skipped
    ([["aux rebelles", "b"], ["Que fait-on", "a"]], False),   # out of order
    ([["Que fait-on", "a"], ["aux rebelle", "b"]], False),    # last letter uncovered
    ([["Que fait-on", ""], ["aux rebelles", "b"]], False),    # no English
    ([], False),
])
def test_tile_units(pieces, ok):
    units, problems = ax.tile_units("Que fait-on aux rebelles ?", pieces)
    assert (units is not None) is ok and bool(problems) is not ok


def test_voices_spread_evenly_in_id_order():
    scenes = {f"s{i}": {"questions": [{"id": f"s{i}:q{n}"} for n in (1, 2)]} for i in range(6)}
    ax.assign_voices(scenes)
    voices = [q["voice"] for k in sorted(scenes) for q in scenes[k]["questions"]]
    assert voices[:4] == list(ax.VOICES) and sorted(voices.count(v) for v in ax.VOICES) == [3, 3, 3, 3]


def test_merge_questions_absent():
    assert ax.merge_questions("x", None) == ([], None, None)


# --- misc ---------------------------------------------------------------------------

def test_stratified_sample_is_deterministic_and_spread():
    items = [(f"e{g}", f"k{g}-{i}", {"g": g, "i": i}) for g in range(5) for i in range(20)]
    a = ax.stratified_sample(items, 10)
    assert a == ax.stratified_sample(list(reversed(items)), 10)
    assert sorted(x["g"] for x in a) == [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]


def test_thumb_is_the_frame_on_screen_at_mid_clip():
    assert ax.thumb_index([0, 1600, 3600, 5600, 7958], 8000) == 2


# --- scripts/check_questions.py ---------------------------------------------------------

def _checker():
    spec = importlib.util.spec_from_file_location("check_questions", ROOT / "scripts" / "check_questions.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SCENES = {"s01e04-0016-0017": {"s01e04-0016", "s01e04-0017"}}


def test_check_questions_accepts_a_good_file():
    cq = _checker()
    assert cq.check({"episode": "s01e04", "scenes": {"s01e04-0016-0017": ENTRY}}, SCENES) == []
    entry = dict(ENTRY, doubt=None)
    assert cq.check({"episode": "s01e04", "scenes": {"s01e04-0016-0017": entry}}, SCENES) == []


def test_check_questions_finds_problems():
    cq = _checker()
    bad_q = {"line": "s01e04-0099", "fr": "Pourquoi", "en": "",
             "answers": [{"fr": "Oui", "en": "Yes", "correct": True},
                         {"fr": "oui !", "en": "yes", "correct": True}]}
    entry = {"title_fr": "Ab", "difficulty": 7, "doubt": 3, "questions": [bad_q]}
    probs = cq.check({"episode": "s01e04", "scenes": {"s01e04-0016-0017": entry, "s01e04-9999-9999": entry}},
                     dict(SCENES, **{"s01e04-0001-0002": set()}))
    text = "\n".join(probs)
    for needle in ("s01e04-0001-0002: scene missing", "s01e04-9999-9999: not a scene",
                   "title_fr", "difficulty", "doubt", "is not a line of this scene",
                   "needs 3-14", "does not end with '?'", "en missing", "needs 3 or 4 answers"):
        assert needle in text, needle
    bad_q["answers"].append({"fr": "Non", "en": "No", "correct": False})
    probs = "\n".join(cq.check({"episode": "s01e04", "scenes": {"s01e04-0016-0017": entry}}, SCENES))
    assert "same as another answer" in probs and "2 correct answers" in probs


def test_check_units_file():
    cq = _checker()
    sents = ["Que fait-on aux rebelles ?", "Ave, César !", "On les jette aux lions maintenant."]
    good = {"On les jette aux lions maintenant.": [["On les jette", "they throw them"], ["aux lions", "to the lions"],
                                                    ["maintenant", "now"]],
            "Que fait-on aux rebelles ?": [["Que fait-on", "what do they do"], ["aux rebelles", "to the rebels"]],
            "Ave, César !": [["Ave", "hail"], ["César", "César"]]}
    assert cq.check_units(good, sents) == []
    assert cq.sentences_of({"scenes": {"x": ENTRY}})[:2] == ["Que fait-on aux rebelles ?", "On les jette aux lions."]
    bad = {"Que fait-on aux rebelles ?": [["Que fait-on aux rebelles ?", "x"]],
           "On les jette aux lions maintenant.": [["On les jette aux lions", "x"], ["maintenant", "now"]],
           "stray": [["stray", "x"]]}
    text = "\n".join(cq.check_units(bad, sents))
    for needle in ("'Ave, César !': no entry", "stray key", "has 5 words", "starts or ends with punctuation"):
        assert needle in text, needle
    six = {"On les jette aux lions maintenant.": good["On les jette aux lions maintenant."],
           "Ave, César !": [["Ave", "a"]] * 6, "Que fait-on aux rebelles ?": [["Que", ""], ["aux rebelles", "b"]]}
    text = "\n".join(cq.check_units(six, sents))
    for needle in ("6 units, at most 5", "not found", "has no English", "'fait-on' before"):
        assert needle in text, needle


# --- pre-generated question clips --------------------------------------------------------------

def test_clip_name_is_the_shared_rule():
    import hashlib
    s = "Que fait-on aux rebelles ?"
    assert ax.clip_name(s) == hashlib.sha1(s.encode("utf-8")).hexdigest()[:16] + ".m4a"


def test_merge_questions_audio_only_for_existing_nonempty_clips(tmp_path):
    media = tmp_path / "media"
    (media / "q").mkdir(parents=True)
    (media / "q" / ax.clip_name("Que fait-on aux rebelles ?")).write_bytes(b"x")
    (media / "q" / ax.clip_name("On les jette aux lions.")).write_bytes(b"")  # being written: ignored
    st = ax.QuestionStats()
    qs, _, _ = ax.merge_questions("s01e04-0016-0017", ENTRY, {}, st, media)
    assert qs[0]["audio"] == "/media/q/" + ax.clip_name("Que fait-on aux rebelles ?")
    assert all("audio" not in a for a in qs[0]["answers"])
    assert "audio" not in qs[1]
    assert st.audio == {"Que fait-on aux rebelles ?"}
    # no media directory at all: nothing set, nothing fails
    qs, _, _ = ax.merge_questions("s01e04-0016-0017", ENTRY, {}, ax.QuestionStats(), tmp_path / "none")
    assert all("audio" not in q for q in qs)


# --- songs first ------------------------------------------------------------------------------

def test_song_scenes_are_score_5_and_easy():
    assert ax.song_scene_values("song", 3, 4) == (5, 2)
    assert ax.song_scene_values("song", 4, 1) == (5, 1)
    assert ax.song_scene_values("dialogue", 3, 4) == (3, 4)


def test_song_of_needs_every_line_inside_the_range():
    ranges = [("s01e04-monde-romain", "s01e04", 10, 22), ("s01e03-madame-arbre", "s01e03", 19, 26)]
    assert ax.song_of("s01e04", 10, 11, ranges) == "s01e04-monde-romain"
    assert ax.song_of("s01e04", 20, 22, ranges) == "s01e04-monde-romain"
    assert ax.song_of("s01e04", 21, 23, ranges) is None   # runs past the song
    assert ax.song_of("s01e03", 10, 11, ranges) is None   # other episode


# --- thumbnails -------------------------------------------------------------------------------

DARK, GOOD, FLAT, WHITE = [5.0, 3.0, 2.0], [100.0, 45.0, 60.0], [120.0, 4.0, 10.0], [240.0, 20.0, 5.0]


def test_thumb_keeps_a_good_middle_frame():
    times = [0, 2000, 4000, 6000, 7958]
    assert ax.choose_thumb(times, 8000, [GOOD] * 5) == ax.thumb_index(times, 8000) == 2


def test_thumb_moves_off_a_black_middle_to_the_nearest_good_frame():
    times = [0, 2000, 4000, 6000, 8000, 9958]
    stats = [GOOD, DARK, DARK, DARK, GOOD, GOOD]
    assert ax.thumb_index(times, 10000) == 2
    assert ax.choose_thumb(times, 10000, stats) in (0, 4)
    assert ax.choose_thumb(times, 10000, [DARK, FLAT, DARK, WHITE, GOOD, DARK]) == 4


def test_thumb_all_poor_takes_the_least_bad_and_no_stats_falls_back():
    times = [0, 2000, 4000]
    assert ax.choose_thumb(times, 5000, [DARK, [28.0, 20.0, 15.0], DARK]) == 1
    assert ax.choose_thumb(times, 5000, None) == ax.thumb_index(times, 5000)
    assert ax.choose_thumb(times, 5000, [GOOD]) == ax.thumb_index(times, 5000)  # stale stats


def test_line_timings_zero_scored_never_kept_as_aligned():
    # the aligner's even spread happens to sit near the recogniser's words: still a guess
    asr = [(a + 100, b, t.lower()) for t, a, b in LINE]
    times, src, _ = ax.line_timings(1000, 2000, _w(LINE, 0.0), asr)
    assert src == "asr"


# --- line alternates ----------------------------------------------------------------------------

ALT = {"fr": "On est bien, il neige des frites", "en": "We feel good, it is snowing fries",
       "units": [["On est bien", "we feel good"], ["il neige des frites", "it is snowing fries"]]}


def test_line_alternate_units_audio_and_fallback(tmp_path):
    media = tmp_path / "media"
    (media / "q").mkdir(parents=True)
    (media / "q" / ax.clip_name(ALT["fr"])).write_bytes(b"x")
    st = ax.QuestionStats()
    doc = ax.line_alternate(ALT, media, st)
    assert doc["units"][1] == {"fr": "il neige des frites", "en": "it is snowing fries", "cs": 13, "ce": 32}
    assert doc["audio"] == "/media/q/" + ax.clip_name(ALT["fr"])
    bad = dict(ALT, units=[["On est bien", "x"]])  # leaves words uncovered
    doc = ax.line_alternate(bad, None, st)
    assert doc["units"] == [{"fr": "On est bien, il neige des frites", "en": ALT["en"], "cs": 0, "ce": 32}]
    assert "audio" not in doc and len(st.fallbacks) == 1


def test_check_alternates_file():
    cq = _checker()
    lines = {"s01e03-0024": "On est bien, il fait chaud\nIl fait beau"}
    other = {"fr": "On a faim, il fait froid", "en": "We are hungry, it is cold",
             "units": [["On a faim", "we are hungry"], ["il fait froid", "it is cold"]]}
    assert cq.check_alternates({"s01e03-0024": [ALT, other]}, lines) == []
    same = {"fr": "On est bien, il fait chaud Il fait beau", "en": "x",
            "units": [["On est bien", "a"], ["il fait chaud", "b"], ["Il fait beau", "c"]]}
    short = {"fr": "Oui", "en": "Yes", "units": [["Oui", "yes"]]}
    text = "\n".join(cq.check_alternates({"s01e03-0024": [same, short, ALT], "s01e03-9999": []}, lines))
    for needle in ("s01e03-9999: not a line", "exactly two", "same as the line", "has 1 words"):
        assert needle in text, needle
    untiled = dict(other, units=[["On a faim", "x"]], en="")
    text = "\n".join(cq.check_alternates({"s01e03-0024": [ALT, untiled]}, lines))
    assert "not covered" in text and "en missing" in text


# --- release ------------------------------------------------------------------------------------

def _doc(sid, ep, score, kind="dialogue", n_lines=4, approx=0, thin=0, song=None):
    lines = []
    for i in range(n_lines):
        keys = 1 if i < thin else 2
        lines.append({"id": f"{sid}:{i}", "approxTimes": i < approx,
                      "units": [{"key": k < keys} for k in range(3)]})
    d = {"id": sid, "episode": ep, "score": score, "kind": kind, "lines": lines}
    if song:
        d["songId"] = song
    return d


def test_choose_release_songs_then_fives_then_best_fours_with_episode_floor():
    docs = {}
    docs["e1-song"] = _doc("e1-song", "e1", 5, "song", song="s1")
    docs["e2-five"] = _doc("e2-five", "e2", 5)
    for i in range(4):
        docs[f"e1-four{i}"] = _doc(f"e1-four{i}", "e1", 4, approx=1)       # poor fit, but e1 is short
        docs[f"e2-four{i}"] = _doc(f"e2-four{i}", "e2", 4)                 # good fit
    docs["e2-three"] = _doc("e2-three", "e2", 3)
    chosen = ax.choose_release(docs, {"s1"}, size=6, min_per_episode=3)
    ids = [x for x, _ in chosen]
    assert ids[:2] == ["e1-song", "e2-five"]
    assert sum(x.startswith("e1") for x in ids) >= 3          # the floor beats the fit
    assert "e2-three" not in ids and len(ids) == 6
    assert chosen == ax.choose_release(docs, {"s1"}, size=6, min_per_episode=3)  # deterministic
    assert "starter song" in chosen[0][1]


def test_fit_rank_prefers_clean_scenes():
    good, approx, long_, thin = (_doc("a", "e", 4), _doc("b", "e", 4, approx=1),
                                 _doc("c", "e", 4, n_lines=12), _doc("d", "e", 4, thin=1))
    assert sorted([thin, long_, approx, good], key=ax.fit_rank) == [good, thin, long_, approx]


def test_publish_media_links_only_released(tmp_path):
    out = tmp_path / "public"
    cache = ax.media_cache_for(out)
    for sid in ("x1", "x2"):
        (cache / "a").mkdir(parents=True, exist_ok=True)
        (cache / "a" / f"{sid}.m4a").write_bytes(b"a")
        (cache / "f" / sid).mkdir(parents=True)
        (cache / "f" / sid / "0.webp").write_bytes(b"f")
    (out / "media" / "a").mkdir(parents=True)
    (out / "media" / "a" / "x2.m4a").write_bytes(b"old")       # an unreleased leftover
    plan = {"published": {"a": ["x1"], "f": ["x1"], "s": [], "sf": [], "q": []}}
    ax.publish_media(plan, out, log=lambda *a: None)
    files = sorted(p.relative_to(out / "media").as_posix() for p in (out / "media").rglob("*") if p.is_file())
    assert files == ["a/x1.m4a", "f/x1/0.webp"]
    assert (out / "media" / "a" / "x1.m4a").samefile(cache / "a" / "x1.m4a")  # a link, not a copy


def test_load_alternates_merges_parts_and_refuses_duplicates(tmp_path, monkeypatch):
    monkeypatch.setattr(ax, "ALTERNATES_DIR", tmp_path)
    (tmp_path / "s01e03.json").write_text('{"s01e03-0023": [1]}')
    (tmp_path / "s01e03.part2.json").write_text('{"s01e03-0042": [2]}')
    assert ax.load_alternates() == {"s01e03-0023": [1], "s01e03-0042": [2]}
    (tmp_path / "s01e03.part3.json").write_text('{"s01e03-0042": [3]}')
    with pytest.raises(ValueError):
        ax.load_alternates()
