from frenchirix.subtitle_align import build_groups, is_not_dialogue, match_sdh, speaker_for
from frenchirix.subtitles import Cue, parse_sdh, parse_srt

from text_fixtures import srt


def cues(*spans):
    return [Cue(i, a, b, t) for i, (a, b, t) in enumerate(spans, start=1)]


def shape(groups):
    return [(g.first, g.last, g.en_idx) for g in groups]


def test_one_to_one():
    fr = cues((0, 1000, "a"), (1100, 2000, "b"))
    en = cues((0, 1000, "A"), (1100, 2000, "B"))
    assert shape(build_groups(fr, en)) == [(1, 1, [1]), (2, 2, [2])]


def test_merged_english_cue_makes_a_two_line_group():
    fr = cues((0, 1000, "a"), (1100, 2000, "b"), (2100, 3000, "c"))
    en = cues((0, 2000, "A B"), (2100, 3000, "C"))
    groups = build_groups(fr, en)
    assert shape(groups) == [(1, 2, [1]), (3, 3, [2])]
    assert groups[0].text({e.idx: e for e in en}) == "A B"


def test_split_english_cues_stay_in_one_line():
    fr = cues((0, 4000, "a b"), (4100, 5000, "c"))
    en = cues((0, 2000, "A"), (2050, 4000, "B"), (4100, 5000, "C"))
    groups = build_groups(fr, en)
    assert shape(groups) == [(1, 1, [1, 2]), (2, 2, [3])]
    assert groups[0].text({e.idx: e for e in en}) == "A B"


def test_drifted_cue_still_pairs_and_does_not_merge_neighbours():
    fr = cues((10_000, 12_000, "a"), (12_100, 14_000, "b"))
    en = cues((10_300, 12_300, "A"), (12_400, 14_300, "B"))
    assert shape(build_groups(fr, en)) == [(1, 1, [1]), (2, 2, [2])]


def test_line_with_only_a_boundary_overlap_borrows_the_neighbours_cue():
    # "Non." ends 500 ms into an English cue that translates it and the next line.
    fr = cues((10_000, 11_500, "Non."), (11_600, 14_000, "On est fichus."))
    en = cues((5_000, 9_900, "Earlier."), (11_000, 14_000, "No. We're done for."))
    assert shape(build_groups(fr, en)) == [(1, 2, [2])]


def test_interjection_without_overlap_stays_untranslated():
    # An English cue starting 80 ms after the line belongs to the next line.
    fr = cues((0, 900, "Mmh ?"), (1000, 3000, "Je te renomme chef."))
    en = cues((980, 3000, "I reappoint you chief."))
    assert shape(build_groups(fr, en)) == [(1, 1, []), (2, 2, [1])]


def test_small_overlap_with_a_neighbours_cue_is_ignored():
    fr = cues((0, 2000, "Ah !"), (2100, 5000, "Suite."))
    en = cues((1800, 5000, "Next."))   # 200 ms of a 2000 ms line: 10 %
    assert shape(build_groups(fr, en)) == [(1, 1, []), (2, 2, [1])]


def test_groups_are_contiguous_when_links_cross():
    # English cue 1 spans lines 1 and 3; line 2 must join the same group.
    fr = cues((0, 1000, "a"), (1000, 1200, "b"), (1200, 2000, "c"))
    en = cues((0, 2000, "A C"), (1000, 1200, "B"))
    assert shape(build_groups(fr, en)) == [(1, 3, [1, 2])]


def test_title_cards_and_credits_are_not_dialogue():
    assert is_not_dialogue(Cue(1, 0, 1, "ASTERIX & OBELIX:\nTHE BIG FIGHT"))
    assert is_not_dialogue(Cue(1, 0, 1, "Subtitle translation by: Someone"))
    assert not is_not_dialogue(Cue(1, 0, 1, "OK!"))
    assert not is_not_dialogue(Cue(1, 0, 1, "Hello, Obelix."))
    fr = cues((0, 2000, "Chanson"))
    en = cues((500, 2000, "ASTERIX & OBELIX: THE BIG FIGHT"))
    assert shape(build_groups(fr, en)) == [(1, 1, [])]


def test_match_sdh_exact_and_by_overlap():
    fr = parse_srt(srt((0, 1000, "On s'en fout."), (2000, 3000, "Bon, d'accord.")))
    sdh = [parse_sdh(c) for c in parse_srt(srt(
        (0, 1000, "[Métadata] On s'en fout."),
        (1900, 3000, "- [musique douce]\n- Bon, d'accord."),
    ))]
    m = match_sdh(fr, sdh)
    assert speaker_for(m[1]) == "Métadata"
    assert m[2][0].cue.idx == 2 and speaker_for(m[2]) is None
