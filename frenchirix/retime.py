"""Widen scene cores to cover what is actually spoken.

Scenes are selected on subtitle times: `core_start_ms` is the start of the first
line's subtitle and `core_end_ms` the end of the last line's. Annotation restores
words spoken just before a subtitle appears or after it goes, and alignment
(docs/transcription.md) finds where they really are. When the first line is spoken
earlier than its subtitle, or the last line ends later, those words fall inside the
clip's fade (docs/media.md). This step moves the core out to cover them.

Rules:
- The core is recomputed from scratch on every run: the earlier of the first line's
  subtitle start and its `audio_start_ms`, and the later of the last line's subtitle
  end and its `audio_end_ms`. It never ends up inside the subtitle span, so a scene
  only ever widens relative to its subtitles, and running the step again changes
  nothing.
- Only a trusted line moves an edge: every word timed and a mean word score of at
  least `min_line_score`. The edge is the start of the line's first word (end of its
  last word) that scores at least `min_edge_word_score`, so one weak word at the edge
  does not move or block the scene. Lines the alignment guard marked unreliable (all
  scores 0) never qualify.
- An edge moves only when the speech reaches at least `min_shift_ms` beyond the
  subtitle (the render keeps 400 ms of full volume outside the core anyway), and at
  most `max_shift_ms`.
- A scene whose rendered clip window no longer matches its core loses its
  `render_params`, so `frenchirix render --episode <ep>` re-renders exactly those
  scenes. This also catches a core that `select-import` reset to subtitle times
  after a render: run `retime` after every `select-import` and every `align`.

Standard library only.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass


@dataclass(frozen=True)
class RetimeSettings:
    max_shift_ms: int = 2500
    min_shift_ms: int = 200
    min_line_score: float = 0.5
    min_edge_word_score: float = 0.3


SETTINGS = RetimeSettings()


@dataclass
class Change:
    scene_id: str
    old: tuple[int, int]
    new: tuple[int, int]

    @property
    def start_shift_ms(self) -> int:  # negative: the core now starts earlier
        return self.new[0] - self.old[0]

    @property
    def end_shift_ms(self) -> int:  # positive: the core now ends later
        return self.new[1] - self.old[1]


def edge_time(words: list[tuple[int, int, float | None]], side: int,
              settings: RetimeSettings = SETTINGS) -> int | None:
    """Where a line's speech starts (side 0) or ends (side -1), or None if not trusted.

    `words` are (start_ms, end_ms, score) in order, all timed.
    """
    known = [w[2] for w in words if w[2] is not None]
    if not words or not known or sum(known) / len(known) < settings.min_line_score:
        return None
    good = [w for w in words if w[2] is not None and w[2] >= settings.min_edge_word_score]
    if not good:
        return None
    return good[0][0] if side == 0 else good[-1][1]


def new_core(sub_start: int, sub_end: int, audio_start: int | None, audio_end: int | None,
             settings: RetimeSettings = SETTINGS) -> tuple[int, int]:
    """The widened core from subtitle times and trusted speech times (None: no evidence)."""
    start, end = sub_start, sub_end
    if audio_start is not None and sub_start - audio_start >= settings.min_shift_ms:
        start = max(sub_start - settings.max_shift_ms, audio_start)
    if audio_end is not None and audio_end - sub_end >= settings.min_shift_ms:
        end = min(sub_end + settings.max_shift_ms, audio_end)
    return start, end


def _line(conn: sqlite3.Connection, episode_id: str, idx: int):
    """(subtitle start, subtitle end, word times) of a line; word times empty if untimed."""
    line_id, start, end = conn.execute("SELECT id, start_ms, end_ms FROM lines "
                                       "WHERE episode_id = ? AND idx = ?", (episode_id, idx)).fetchone()
    words = conn.execute("SELECT start_ms, end_ms, score FROM words WHERE line_id = ? ORDER BY idx",
                         (line_id,)).fetchall()
    timed = bool(words) and all(w[0] is not None for w in words)
    return start, end, [tuple(w) for w in words] if timed else []


def _render_is_stale(conn: sqlite3.Connection, scene_id: str) -> bool:
    """True when the scene has rendered media whose clip window no longer fits its core."""
    from frenchirix import render

    row = conn.execute("SELECT render_params, clip_start_ms, clip_end_ms, fade_in_ms, fade_out_ms "
                       "FROM scenes WHERE id = ?", (scene_id,)).fetchone()
    if row[0] is None:
        return False  # not rendered (or already marked): render will do it
    job = render._job(conn, scene_id)  # ffprobe of the episode, cached per source
    w = render.clip_window(job.core_start_ms, job.core_end_ms, job.episode_duration_ms)
    return (w.clip_start_ms, w.clip_end_ms, w.fade_in_ms, w.fade_out_ms) != tuple(row[1:])


def retime_episode(conn: sqlite3.Connection, episode_id: str, *,
                   settings: RetimeSettings = SETTINGS,
                   check_media: bool = True) -> tuple[list[Change], list[str]]:
    """Widen the episode's scene cores; return (cores that changed, scenes to re-render).

    Scenes to re-render have had `render_params` cleared.
    """
    changes: list[Change] = []
    scenes = conn.execute("SELECT id, first_line_idx, last_line_idx, core_start_ms, core_end_ms "
                          "FROM scenes WHERE episode_id = ? ORDER BY first_line_idx, id",
                          (episode_id,)).fetchall()
    with conn:
        for sid, first, last, core_start, core_end in scenes:
            f_start, _, f_words = _line(conn, episode_id, first)
            _, l_end, l_words = _line(conn, episode_id, last)
            core = new_core(f_start, l_end, edge_time(f_words, 0, settings),
                            edge_time(l_words, -1, settings), settings)
            if core != (core_start, core_end):
                conn.execute("UPDATE scenes SET core_start_ms = ?, core_end_ms = ? WHERE id = ?",
                             (*core, sid))
                changes.append(Change(sid, (core_start, core_end), core))
        stale = [sid for sid, *_ in scenes if check_media and _render_is_stale(conn, sid)]
        for sid in stale:
            conn.execute("UPDATE scenes SET render_params = NULL WHERE id = ?", (sid,))
    return changes, stale
