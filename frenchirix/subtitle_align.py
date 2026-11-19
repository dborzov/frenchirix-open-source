"""Matching French lines with the hearing-impaired track and with the English track.

The method and its measured results are in docs/pipeline.md.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .subtitles import Cue, SdhCue, clean_text, comparable

# A link between a French line and an English cue is "strong" when they overlap
# for at least this share of the shorter of the two.
STRONG_SHARE = 0.5
# A French line without any strong link may borrow an English cue that it
# overlaps for at least this share of its own duration (drift at a cue boundary).
WEAK_LINE_SHARE = 0.25
# An SDH cue without an exact match covers a French line when it overlaps at
# least this share of the line.
SDH_SHARE = 0.5

CREDIT_RE = re.compile(r"subtitle|subtitles|translation by|sous-titr", re.IGNORECASE)


def overlap(a: Cue, b: Cue) -> int:
    return max(0, min(a.end_ms, b.end_ms) - max(a.start_ms, b.start_ms))


def duration(c: Cue) -> int:
    return max(1, c.end_ms - c.start_ms)


def is_not_dialogue(cue: Cue) -> bool:
    """Title cards ("ASTERIX & OBELIX: THE BIG FIGHT") and subtitle credits."""
    text = clean_text(cue.text)
    letters = [ch for ch in text if ch.isalpha()]
    if len(letters) >= 6 and not any(ch.islower() for ch in letters):
        return True
    return bool(CREDIT_RE.search(text))


@dataclass
class Group:
    first: int                 # first line idx (1-based)
    last: int                  # last line idx
    en_idx: list[int]          # English cue idx, in track order

    def text(self, en_by_idx: dict[int, Cue], song: bool = False) -> str:
        """English text of the group. For a group of sung lines (`song`) each
        lyric line stays on its own line; otherwise wrapped lines are joined."""
        parts = [clean_text(en_by_idx[i].text, keep_breaks=song) for i in self.en_idx]
        out = ""
        for p in parts:
            if not out:
                out = p
            else:
                out += ("\n" if song or "\n" in out or "\n" in p else " ") + p
        return out


def link_english(fr: list[Cue], en: list[Cue]) -> dict[int, set[int]]:
    """Return {French cue idx: set of English cue idx} for the alignment."""
    dialogue = [e for e in en if not is_not_dialogue(e)]
    strong: dict[int, set[int]] = {}
    for f in fr:
        for e in dialogue:
            o = overlap(f, e)
            if o and o >= STRONG_SHARE * min(duration(f), duration(e)):
                strong.setdefault(f.idx, set()).add(e.idx)
    links = {k: set(v) for k, v in strong.items()}
    for f in fr:
        if f.idx in strong:
            continue
        best = max(dialogue, key=lambda e: overlap(f, e), default=None)
        if best is not None and overlap(f, best) >= WEAK_LINE_SHARE * duration(f):
            links[f.idx] = {best.idx}
    return links


def build_groups(fr: list[Cue], en: list[Cue]) -> list[Group]:
    """Split the French lines into contiguous translation groups.

    Lines that share an English cue end up in one group; a group covers every
    line between its first and last linked line, so groups stay contiguous.
    """
    links = link_english(fr, en)
    n = len(fr)
    # reach[i] = furthest line idx that must be in the same group as line i.
    lines_of_en: dict[int, list[int]] = {}
    for line, es in links.items():
        for e in es:
            lines_of_en.setdefault(e, []).append(line)
    reach = {f.idx: f.idx for f in fr}
    for ls in lines_of_en.values():
        lo, hi = min(ls), max(ls)
        reach[lo] = max(reach[lo], hi)
    groups: list[Group] = []
    i = 1
    while i <= n:
        end = reach[i]
        j = i
        while j <= end:
            end = max(end, reach[j])
            j += 1
        es = sorted({e for k in range(i, end + 1) for e in links.get(k, ())})
        groups.append(Group(i, end, es))
        i = end + 1
    return groups


def match_sdh(fr: list[Cue], sdh: list[SdhCue]) -> dict[int, list[SdhCue]]:
    """Return {French cue idx: SDH cues that carry the same speech}.

    An SDH cue with the same start and the same words is the match. Otherwise
    any SDH cue with speech that covers most of the line is taken.
    """
    by_start: dict[int, list[SdhCue]] = {}
    for s in sdh:
        by_start.setdefault(s.cue.start_ms, []).append(s)
    out: dict[int, list[SdhCue]] = {}
    for f in fr:
        target = comparable(clean_text(f.text))
        exact = [s for s in by_start.get(f.start_ms, []) if comparable(s.speech) == target]
        if exact:
            out[f.idx] = exact[:1]
            continue
        near = [
            s for s in sdh
            if s.speech and overlap(f, s.cue) >= SDH_SHARE * duration(f)
        ]
        if near:
            out[f.idx] = near
    return out


def speaker_for(matches: list[SdhCue]) -> str | None:
    """Speaker label(s) when one SDH cue matches and every speech part is labelled."""
    if len(matches) != 1:
        return None
    labels = matches[0].speakers
    if not labels or any(label is None for label in labels):
        return None
    unique = list(dict.fromkeys(labels))
    return " / ".join(unique) if len(labels) > 1 else unique[0]
