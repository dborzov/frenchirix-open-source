"""Parsing SubRip subtitles and cleaning their text.

Plain tracks (`fr`, `en`) only carry formatting tags. The hearing-impaired
track (`fr_sdh`) also carries bracketed sound descriptions, speaker labels and
`♪` song marks; `parse_sdh` separates those from the speech.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

TIME_RE = re.compile(
    r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})"
)
TAG_RE = re.compile(r"<[^>]*>|\{\\[^}]*\}")
BRACKET_RE = re.compile(r"\[([^\]]*)\]")
DASH_RE = re.compile(r"^[-‐–—]\s*")
SONG_MARK = "♪"

# Lowercase SDH labels that name who speaks rather than describe a sound.
GENERIC_SPEAKERS = {
    "speaker", "groupe", "tous", "tribu", "public", "ensemble", "haut-parleur",
    "légionnaire", "foraine", "forain",
}


@dataclass
class Cue:
    idx: int          # 1-based position in the track
    start_ms: int
    end_ms: int
    text: str         # raw text, markup and line breaks kept


def _ms(h: str, m: str, s: str, frac: str) -> int:
    return ((int(h) * 60 + int(m)) * 60 + int(s)) * 1000 + int(frac.ljust(3, "0"))


def parse_srt(data: str) -> list[Cue]:
    """Parse SubRip text. Cues are numbered by their order in the file, not by the
    counter in the file, so a malformed counter cannot shift line ids."""
    data = data.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    cues: list[Cue] = []
    current: tuple[int, int] | None = None
    text_lines: list[str] = []

    def flush() -> None:
        if current is not None:
            # Drop a trailing counter line that belongs to the next cue.
            while text_lines and text_lines[-1].strip() == "":
                text_lines.pop()
            cues.append(Cue(len(cues) + 1, current[0], current[1], "\n".join(text_lines)))

    lines = data.split("\n")
    for i, line in enumerate(lines):
        m = TIME_RE.search(line)
        if m:
            # The line before a timing line is the cue counter, which belongs to
            # the new cue, not to the text of the previous one.
            if text_lines and text_lines[-1].strip().isdigit() and (
                len(text_lines) == 1 or text_lines[-2].strip() == ""
            ):
                text_lines.pop()
            flush()
            g = m.groups()
            current = (_ms(*g[0:4]), _ms(*g[4:8]))
            text_lines = []
        elif current is not None:
            text_lines.append(line.rstrip())
    flush()
    for cue in cues:
        cue.text = cue.text.strip("\n")
    return cues


def _split_parts(text: str, sep: str = " ") -> list[str]:
    """Split cue text into speaker parts. A new part starts at a line beginning
    with a dash; wrapped lines inside a part are joined with `sep` (a space, or
    a newline to keep lyric lines apart)."""
    parts: list[list[str]] = []
    for raw in text.split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            continue
        if DASH_RE.match(line) or not parts:
            parts.append([DASH_RE.sub("", line)])
        else:
            parts[-1].append(line)
    out = [sep.join(l for l in p if l).strip() for p in parts]
    return [p for p in out if p]


def _join_parts(parts: list[str]) -> str:
    if len(parts) <= 1:
        return parts[0] if parts else ""
    return "\n".join(f"- {p}" for p in parts)


def strip_tags(text: str) -> str:
    return TAG_RE.sub("", text)


def clean_text(text: str, keep_breaks: bool = False) -> str:
    """Clean text of a plain track: no tags, wrapped lines joined, one line per
    speaker. With `keep_breaks` (sung lines) the line breaks inside a part stay."""
    return _join_parts(_split_parts(strip_tags(text), "\n" if keep_breaks else " "))


def transfer_breaks(text: str, broken: str) -> str:
    """Put the line breaks of `broken` into `text`, which has the same words.

    Used when the plain track writes a lyric on one line and the SDH track
    splits it in two. Returns `text` unchanged when the words differ.
    """
    if "\n" in text or "\n" not in broken or comparable(text) != comparable(broken):
        return text
    # Number of word characters before each break in `broken`.
    marks, count = set(), 0
    for ch in broken:
        if ch == "\n":
            marks.add(count)
        elif comparable(ch):
            count += 1
    out, count = [], 0
    for ch in text:
        if count in marks and ch == " ":
            out.append("\n")
            marks.discard(count)
            continue
        out.append(ch)
        if comparable(ch):
            count += 1
    return "".join(out)


def comparable(text: str) -> str:
    """Text reduced for comparing two tracks: no punctuation, case or spacing."""
    return re.sub(r"[\W_]+", "", text.lower())


def is_speaker_label(label: str) -> bool:
    label = label.strip()
    if not label:
        return False
    words = label.split()
    first = words[0]
    if first[0].isupper():
        # "[Métadata]", "[Astérix enfant]"; not "[César soupire]".
        return len(words) == 1 or (len(words) == 2 and words[1] in {"enfant"})
    if first.lower() in GENERIC_SPEAKERS:
        # "[forain 2]"
        return len(words) == 1 or (len(words) == 2 and words[1].isdigit())
    return label.startswith("mère de ") or label.startswith("père de ")


@dataclass
class SdhPart:
    speaker: str | None
    speech: str                 # wrapped lines joined with a space
    sounds: list[str] = field(default_factory=list)
    speech_lines: str = ""      # same words, line breaks kept


@dataclass
class SdhCue:
    cue: Cue
    parts: list[SdhPart]
    is_song: bool

    @property
    def speech(self) -> str:
        return _join_parts([p.speech for p in self.parts if p.speech])

    @property
    def speech_lines(self) -> str:
        return _join_parts([p.speech_lines for p in self.parts if p.speech])

    @property
    def sounds(self) -> list[str]:
        return [s for p in self.parts for s in p.sounds]

    @property
    def speakers(self) -> list[str | None]:
        return [p.speaker for p in self.parts if p.speech]


def parse_sdh(cue: Cue) -> SdhCue:
    text = strip_tags(cue.text)
    is_song = SONG_MARK in text
    parts = []
    for part in _split_parts(text.replace(SONG_MARK, " "), "\n"):
        speaker = None
        m = re.match(r"\[([^\]]*)\]\s*(.*)$", part, re.S)
        if m and BRACKET_RE.sub("", m.group(2)).strip() and is_speaker_label(m.group(1)):
            speaker = m.group(1).strip()
            part = m.group(2)
        # A bracket may span two lines; it is removed whole before splitting lines.
        sounds = [" ".join(s.split()) for s in BRACKET_RE.findall(part) if s.strip()]
        lines = [" ".join(l.split()) for l in BRACKET_RE.sub(" ", part).split("\n")]
        lines = [l for l in lines if l]
        parts.append(SdhPart(speaker, " ".join(lines), sounds, "\n".join(lines)))
    return SdhCue(cue, parts, is_song)
