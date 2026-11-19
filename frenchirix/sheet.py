"""`sheet`: the cue sheet a scene selector reads. Format: docs/content-steps.md."""

from __future__ import annotations

import sqlite3

from . import subtitle_align
from .subtitles import Cue, parse_sdh

PAUSE_MS = 5_000      # gaps between lines at least this long get a `--- N s ---` row
INDENT = " " * 5      # width of "0041 "


def _one_row(text: str) -> str:
    """One sheet row: a second speaker's part ("- …") follows after a space,
    any other break inside the line (a lyric line) is shown as " / "."""
    pieces = [p.strip() for p in text.split("\n") if p.strip()]
    out = pieces[0] if pieces else ""
    for p in pieces[1:]:
        out += (" " if p.startswith("- ") else " / ") + p
    return out


def _mmss(ms: int) -> str:
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def render_sheet(lines: list[dict], translations: list[dict], fr_cues: list[Cue],
                 sdh_cues: list[Cue]) -> str:
    """lines: dicts with idx, start_ms, end_ms, fr, speaker, is_song, group_idx.
    translations: dicts with group_idx, first_line_idx, text."""
    first_of_group = {t["group_idx"]: t for t in translations}
    sdh = [parse_sdh(c) for c in sdh_cues]
    matched = subtitle_align.match_sdh(fr_cues, sdh)
    matched_ids = {id(s) for ms in matched.values() for s in ms}

    # (time, order, text): order 0 = pause/sound before a line, 1 = line, 2 = its own sounds.
    events: list[tuple[int, int, int, str]] = []
    seq = 0

    def add(t: int, order: int, text: str) -> None:
        nonlocal seq
        events.append((t, order, seq, text))
        seq += 1

    prev_end = None
    for l in lines:
        if prev_end is not None and l["start_ms"] - prev_end >= PAUSE_MS:
            add(prev_end, 0, f"--- {round((l['start_ms'] - prev_end) / 1000)} s ---")
        prev_end = max(prev_end or 0, l["end_ms"])
        t = first_of_group.get(l["group_idx"])
        if t is not None and t["first_line_idx"] == l["idx"]:
            en = _one_row(t["text"])
        else:
            en = "^"
        fr = _one_row(l["fr"])
        prefix = ("♪ " if l["is_song"] else "") + (f"({l['speaker']}) " if l["speaker"] else "")
        add(l["start_ms"], 1, f"{l['idx']:04d} {_mmss(l['start_ms'])} {prefix}{fr} | {en}".rstrip())
        sounds = [x for s in matched.get(l["idx"], []) for x in s.sounds]
        if sounds:
            add(l["start_ms"], 2, INDENT + " ".join(f"[{x}]" for x in sounds))
    for s in sdh:
        if id(s) in matched_ids:
            continue
        for x in s.sounds:
            add(s.cue.start_ms, 0, f"{INDENT}[{x}]")
    events.sort()
    return "\n".join(e[3] for e in events) + "\n"


def sheet_for(conn: sqlite3.Connection, episode_id: str) -> str:
    lines = [dict(r) for r in conn.execute(
        "SELECT idx, start_ms, end_ms, fr, speaker, is_song, group_idx FROM lines "
        "WHERE episode_id = ? ORDER BY idx", (episode_id,))]
    if not lines:
        raise ValueError(f"{episode_id} has no lines; run `frenchirix import {episode_id}` first")
    translations = [dict(r) for r in conn.execute(
        "SELECT group_idx, first_line_idx, text FROM translations "
        "WHERE episode_id = ? AND lang = 'en'", (episode_id,))]

    def cues(track: str) -> list[Cue]:
        return [Cue(r[0], r[1], r[2], r[3]) for r in conn.execute(
            "SELECT idx, start_ms, end_ms, raw_text FROM cues WHERE episode_id = ? AND track = ? "
            "ORDER BY idx", (episode_id, track))]

    return render_sheet(lines, translations, cues("fr"), cues("fr_sdh"))
