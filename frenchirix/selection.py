"""`select-import`: validate a selector's JSON (format: docs/content-steps.md)
and load it into `scenes`. The procedure is in docs/runbook.md."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone

KINDS = {"dialogue", "monologue", "song"}
MAX_LINES = 12
MAX_MS = 40_000
MAX_TITLE_WORDS = 6
SELECTOR_FIELDS = (
    "first_line_idx", "last_line_idx", "core_start_ms", "core_end_ms",
    "title", "kind", "tags", "score", "why", "selected_by",
)


class SelectionError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("\n".join(errors))
        self.errors = errors


@dataclass
class Result:
    inserted: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    untouched: list[str] = field(default_factory=list)   # in the DB, not in this file


def scene_id(episode_id: str, first: int, last: int) -> str:
    return f"{episode_id}-{first:04d}-{last:04d}"


def _groups(conn: sqlite3.Connection, episode_id: str) -> dict[int, tuple[int, int]]:
    """{line idx: (first, last) of its translation group}."""
    out = {}
    for first, last in conn.execute(
        "SELECT first_line_idx, last_line_idx FROM translations "
        "WHERE episode_id = ? AND lang = 'en'", (episode_id,)):
        for k in range(first, last + 1):
            out[k] = (first, last)
    return out


def scenes_splitting_groups(conn: sqlite3.Connection, episode_id: str) -> list[str]:
    groups = _groups(conn, episode_id)
    bad = []
    for sid, first, last in conn.execute(
        "SELECT id, first_line_idx, last_line_idx FROM scenes WHERE episode_id = ? ORDER BY id",
        (episode_id,)):
        if groups.get(first, (first, first))[0] != first or groups.get(last, (last, last))[1] != last:
            bad.append(sid)
    return bad


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def import_selection(conn: sqlite3.Connection, episode_id: str, data: object,
                     now: str | None = None) -> Result:
    """Validate `data` and upsert its scenes. Writes nothing if any scene is invalid.

    On an existing scene id only the selector's fields are updated; `created_at` and
    the render columns are kept.
    """
    lines = {r[0]: (r[1], r[2]) for r in conn.execute(
        "SELECT idx, start_ms, end_ms FROM lines WHERE episode_id = ?", (episode_id,))}
    if not lines:
        raise SelectionError([f"{episode_id} has no lines; run `frenchirix import {episode_id}` first"])
    groups = _groups(conn, episode_id)
    errors: list[str] = []
    res = Result()

    if not isinstance(data, dict):
        raise SelectionError(["top level must be a JSON object"])
    if data.get("episode") != episode_id:
        errors.append(f"\"episode\" is {data.get('episode')!r}, expected {episode_id!r}")
    selector = data.get("selector")
    if not isinstance(selector, str) or not selector.strip():
        errors.append("\"selector\" must be a non-empty string")
    scenes = data.get("scenes")
    if not isinstance(scenes, list):
        raise SelectionError(errors + ["\"scenes\" must be a list"])

    rows: dict[str, dict] = {}
    for n, s in enumerate(scenes, start=1):
        where = f"scene {n}"
        if not isinstance(s, dict):
            errors.append(f"{where}: must be an object")
            continue
        first, last = s.get("first"), s.get("last")
        if _is_int(first) and _is_int(last):
            where = f"scene {n} ({first}-{last})"
        if not (_is_int(first) and _is_int(last)):
            errors.append(f"{where}: \"first\" and \"last\" must be integers")
            continue
        if first > last:
            errors.append(f"{where}: first is after last")
            continue
        missing = [k for k in (first, last) if k not in lines]
        if missing:
            errors.append(f"{where}: no line {', '.join(map(str, missing))} "
                          f"(lines are 1-{max(lines)})")
            continue
        title, kind, tags, score, why = (s.get(k) for k in ("title", "kind", "tags", "score", "why"))
        if not isinstance(title, str) or not title.strip():
            errors.append(f"{where}: \"title\" must be a non-empty string")
        if kind not in KINDS:
            errors.append(f"{where}: \"kind\" must be one of {sorted(KINDS)}, got {kind!r}")
        if tags is None:
            tags = []
        if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
            errors.append(f"{where}: \"tags\" must be a list of strings")
        if score is not None and not (_is_int(score) and 1 <= score <= 5):
            errors.append(f"{where}: \"score\" must be an integer from 1 to 5")
        if why is not None and not isinstance(why, str):
            errors.append(f"{where}: \"why\" must be a string")

        g_first = groups.get(first, (first, first))[0]
        g_last = groups.get(last, (last, last))[1]
        if (g_first, g_last) != (first, last):
            res.warnings.append(
                f"{where}: splits a translation group; extended to {g_first}-{g_last}")
            first, last = g_first, g_last
        sid = scene_id(episode_id, first, last)
        start, end = lines[first][0], lines[last][1]
        if last - first + 1 > MAX_LINES:
            res.warnings.append(f"{where}: {last - first + 1} lines (limit {MAX_LINES})")
        if end - start > MAX_MS:
            res.warnings.append(f"{where}: {(end - start) / 1000:.1f} s (limit {MAX_MS // 1000} s)")
        if isinstance(title, str) and len(title.split()) > MAX_TITLE_WORDS:
            res.warnings.append(f"{where}: title has more than {MAX_TITLE_WORDS} words")
        if sid in rows:
            res.warnings.append(f"{where}: same range as an earlier scene ({sid}); kept the earlier one")
            continue
        rows[sid] = {
            "first_line_idx": first, "last_line_idx": last,
            "core_start_ms": start, "core_end_ms": end,
            "title": title.strip() if isinstance(title, str) else title,
            "kind": kind,
            "tags": json.dumps(tags, ensure_ascii=False) if isinstance(tags, list) else tags,
            "score": score, "why": why, "selected_by": selector,
        }

    if errors:
        raise SelectionError(errors)

    now = now or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    existing = {r[0] for r in conn.execute("SELECT id FROM scenes WHERE episode_id = ?", (episode_id,))}
    with conn:
        for sid, r in rows.items():
            if sid in existing:
                conn.execute(
                    f"UPDATE scenes SET {', '.join(f'{c} = ?' for c in SELECTOR_FIELDS)} WHERE id = ?",
                    [r[c] for c in SELECTOR_FIELDS] + [sid],
                )
                res.updated.append(sid)
            else:
                cols = ("id", "episode_id", *SELECTOR_FIELDS, "created_at")
                conn.execute(
                    f"INSERT INTO scenes ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [sid, episode_id, *(r[c] for c in SELECTOR_FIELDS), now],
                )
                res.inserted.append(sid)
    res.untouched = sorted(existing - set(rows))
    return res
