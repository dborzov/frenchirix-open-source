"""Review marks: lines, or units of lines, that the user marked in the review UI as needing a fix.

The review UI writes them (server.py); `frenchirix review` lists them, prints everything a
fixer needs for one, and resolves it. The fixer is the `review-fixer` agent
(docs/content-steps.md). See docs/review-ui.md, "Review marks".
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .annotation import _asr_text, asr_words
from .db import REPO_ROOT

CATEGORIES = ("translation", "french", "units", "timing", "notes", "other")
STATUSES = ("open", "done", "dismissed")
COMMENT_MAX = 10_000

_FIELDS = {"scene_id", "line_id", "unit_idx", "category", "comment"}
_EDITABLE = {"unit_idx", "category", "comment"}


class MarkError(Exception):
    """`kind` is 'invalid' (a bad request), 'not_found' (no such mark) or 'conflict'
    (the mark is no longer open)."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind
        self.message = message


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


_SELECT = """
    SELECT m.*, s.episode_id, s.title AS scene_title, l.idx AS line_idx,
           COALESCE(l.fr_final, l.fr) AS line_fr
    FROM review_marks m
    JOIN scenes s ON s.id = m.scene_id
    JOIN lines l ON l.id = m.line_id
"""


def get_mark(conn: sqlite3.Connection, mark_id: int) -> dict:
    r = conn.execute(_SELECT + " WHERE m.id = ?", (mark_id,)).fetchone()
    if r is None:
        raise MarkError("not_found", f"no review mark {mark_id}")
    return dict(r)


def list_marks(conn: sqlite3.Connection, status: str | None = None,
               episode: str | None = None, line_ids: list[str] | None = None) -> list[dict]:
    """Marks in timeline order (episode, line, unit, then id), optionally filtered."""
    where, params = [], []
    if status is not None:
        where.append("m.status = ?")
        params.append(status)
    if episode is not None:
        where.append("s.episode_id = ?")
        params.append(episode)
    if line_ids is not None:
        where.append(f"m.line_id IN ({', '.join('?' * len(line_ids))})")
        params.extend(line_ids)
    sql = _SELECT + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY s.episode_id, l.idx, COALESCE(m.unit_idx, 0), m.id"
    return [dict(r) for r in conn.execute(sql, params)]


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _category(v) -> str:
    if v not in CATEGORIES:
        raise MarkError("invalid", f"category must be one of {', '.join(CATEGORIES)}")
    return v


def _comment(v) -> str:
    if v is None:
        return ""
    if not isinstance(v, str):
        raise MarkError("invalid", "comment must be a string")
    if len(v) > COMMENT_MAX:
        raise MarkError("invalid", f"comment is longer than {COMMENT_MAX} characters")
    return v.strip()


def _unit(conn: sqlite3.Connection, line_id: str, v) -> tuple[int | None, str | None]:
    """(units.idx, units.text) of the marked unit, or (None, None) for the whole line."""
    if v is None:
        return None, None
    if not _is_int(v):
        raise MarkError("invalid", "unit_idx must be an integer or null")
    r = conn.execute("SELECT text FROM units WHERE line_id = ? AND idx = ?", (line_id, v)).fetchone()
    if r is None:
        raise MarkError("invalid", f"line {line_id} has no unit {v}")
    return v, r[0]


def _object(body, allowed: set[str]) -> dict:
    if not isinstance(body, dict):
        raise MarkError("invalid", "body must be a JSON object")
    unknown = set(body) - allowed
    if unknown:
        raise MarkError("invalid", f"unknown fields: {', '.join(sorted(unknown))}")
    return body


def create_mark(conn: sqlite3.Connection, body) -> dict:
    """Body: scene_id, line_id (a line of that scene), category, and optionally unit_idx
    (units.idx in the line) and comment."""
    body = _object(body, _FIELDS)
    scene_id, line_id = body.get("scene_id"), body.get("line_id")
    if not isinstance(scene_id, str) or not isinstance(line_id, str):
        raise MarkError("invalid", "scene_id and line_id must be strings")
    if not conn.execute("SELECT 1 FROM scenes WHERE id = ?", (scene_id,)).fetchone():
        raise MarkError("invalid", f"no scene {scene_id}")
    in_scene = conn.execute(
        "SELECT 1 FROM scenes s JOIN lines l ON l.episode_id = s.episode_id "
        "AND l.idx BETWEEN s.first_line_idx AND s.last_line_idx WHERE s.id = ? AND l.id = ?",
        (scene_id, line_id)).fetchone()
    if not in_scene:
        raise MarkError("invalid", f"{line_id} is not a line of scene {scene_id}")
    category = _category(body.get("category"))
    comment = _comment(body.get("comment"))
    unit_idx, unit_text = _unit(conn, line_id, body.get("unit_idx"))
    with conn:
        cur = conn.execute(
            "INSERT INTO review_marks (scene_id, line_id, unit_idx, unit_text, category, comment, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (scene_id, line_id, unit_idx, unit_text, category, comment, _now()))
    return get_mark(conn, cur.lastrowid)


def _open_mark(conn: sqlite3.Connection, mark_id: int) -> dict:
    mark = get_mark(conn, mark_id)
    if mark["status"] != "open":
        raise MarkError("conflict", f"review mark {mark_id} is {mark['status']}, not open")
    return mark


def update_mark(conn: sqlite3.Connection, mark_id: int, body) -> dict:
    """Changes the category, comment or marked unit of an open mark."""
    body = _object(body, _EDITABLE)
    if not body:
        raise MarkError("invalid", "nothing to update: send category, comment and/or unit_idx")
    mark = _open_mark(conn, mark_id)
    values: dict[str, object] = {}
    if "category" in body:
        values["category"] = _category(body["category"])
    if "comment" in body:
        values["comment"] = _comment(body["comment"])
    if "unit_idx" in body:
        values["unit_idx"], values["unit_text"] = _unit(conn, mark["line_id"], body["unit_idx"])
    with conn:
        conn.execute(f"UPDATE review_marks SET {', '.join(f'{k} = ?' for k in values)} WHERE id = ?",
                     (*values.values(), mark_id))
    return get_mark(conn, mark_id)


def delete_mark(conn: sqlite3.Connection, mark_id: int) -> None:
    """Deletes an open mark. A resolved one stays as the record of what was done."""
    _open_mark(conn, mark_id)
    with conn:
        conn.execute("DELETE FROM review_marks WHERE id = ?", (mark_id,))


def resolve_mark(conn: sqlite3.Connection, mark_id: int, status: str, resolution: str) -> dict:
    if status not in ("done", "dismissed"):
        raise MarkError("invalid", "status must be done or dismissed")
    if not isinstance(resolution, str) or not resolution.strip():
        raise MarkError("invalid", "the resolution must say what was done, or why the mark is dismissed")
    _open_mark(conn, mark_id)
    with conn:
        conn.execute("UPDATE review_marks SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?",
                     (status, resolution.strip(), _now(), mark_id))
    return get_mark(conn, mark_id)


# ---------------------------------------------------------------------------
# What a fixer needs for one mark, as Markdown


def _t(ms: int | None) -> str:
    if ms is None:
        return "–"
    return f"{ms // 60000}:{ms % 60000 / 1000:04.1f}"


def _inline(text: str | None) -> str:
    """A text on one line; ` / ` stands for a line break, as on the agents' sheets."""
    return "" if text is None else text.replace("\n", " / ")


def _q(text: str | None) -> str:
    return "–" if text is None else f"“{_inline(text)}”"


def _cell(text: str | None) -> str:
    return _inline(text).replace("|", "\\|") if text else ""


def _find_records(root: Path, episode: str, line_idx: int, scene_id: str) -> tuple:
    """(file, line number in it) of the line's annotation record and of the scene object."""
    line_at = scene_at = None
    for path in sorted((root / "annotations" / episode).glob("*.jsonl")):
        for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            rel = path.relative_to(root).as_posix()
            if obj.get("line") == line_idx and line_at is None:
                line_at = (rel, n)
            if obj.get("scene") == scene_id and scene_at is None:
                scene_at = (rel, n)
    return line_at, scene_at


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


CATEGORY_HELP = {
    "translation": (
        "The English the app shows is the literal English: `en` in the line's annotation record, "
        "and the gloss (`en`) of each of its units. Fix those. The subtitle English (labelled "
        "\"subtitle\" in the review UI, and shown on the agents' sheets) is only a fallback: "
        "correct it in `corrections/{ep}.json` only when the comment is about the subtitle itself."),
    "french": (
        "The French as said is `fr` in the line's annotation record. Rewrite `units` so that they "
        "cover the new French exactly, and `en` to match it. A line whose French changes loses its "
        "word timings: it must be aligned again (`align`, a GPU job the orchestrating session runs), "
        "and until then `check` reports `words.untimed` on it."),
    "units": (
        "`units` in the line's annotation record: the split, each unit's kind (`word` or "
        "`expression`), gloss (`en`) and short `note`. The rules are in "
        "docs/content-steps.md."),
    "timing": (
        "Word timings are not text: the fix is to re-align the line "
        "(`.venv/bin/frenchirix align {ep} --lines {idx} --slack-ms 300`, then with `--confirm` if "
        "the guard still finds nothing, then `retime {ep} --render`; docs/runbook.md, \"A unit loops "
        "the wrong sound\"). That is a GPU job for the orchestrating session: a fixer leaves the mark "
        "open and reports it."),
    "notes": (
        "The scene's notes are in the scene object of the annotation file (after the scene's last "
        "line); a unit's one-line `note` is in the line's record. The rules are in "
        "docs/content-steps.md."),
    "other": "Read the comment. The paths below cover every text of the line and the scene.",
}


def mark_context(conn: sqlite3.Connection, mark_id: int, root: Path | None = None) -> str:
    """Everything a fixer needs for one mark: the mark, the scene with all its lines, the
    units of the marked line, the scene's notes, the files a fix goes through, and the app
    content (questions, line alternates) built on the line. `root` is the repository."""
    root = root or REPO_ROOT
    m = get_mark(conn, mark_id)
    sc = conn.execute("SELECT * FROM scenes WHERE id = ?", (m["scene_id"],)).fetchone()
    ep = sc["episode_id"]
    out: list[str] = []
    w = out.append

    w(f"# Review mark {m['id']}: {m['category']} ({m['status']})")
    w("")
    target = (f"unit {m['unit_idx']} {_q(m['unit_text'])} of line {m['line_idx']}"
              if m["unit_idx"] is not None else f"the whole of line {m['line_idx']}")
    w(f"Marked {m['created_at']} in scene `{m['scene_id']}`, on {target} (`{m['line_id']}`).")
    if m["unit_idx"] is not None:
        now = conn.execute("SELECT text FROM units WHERE line_id = ? AND idx = ?",
                           (m["line_id"], m["unit_idx"])).fetchone()
        if now is None or now[0] != m["unit_text"]:
            w(f"The line was re-annotated since: its unit {m['unit_idx']} is now "
              f"{_q(now[0]) if now else 'gone'}. The mark is about {_q(m['unit_text'])}.")
    w("")
    if m["comment"]:
        w("The user's comment:")
        w("")
        w("\n".join("> " + s for s in m["comment"].splitlines()))
    else:
        w("The user wrote no comment: the category and the marked line or unit are all there is.")
    if m["status"] != "open":
        w("")
        w(f"Resolved {m['resolved_at']} as {m['status']}: {m['resolution']}")
    w("")

    # The scene, every line.
    w(f"## Scene `{sc['id']}`: {_q(sc['title'])}")
    w("")
    w(f"{sc['kind']}, lines {sc['first_line_idx']}–{sc['last_line_idx']}, core "
      f"{_t(sc['core_start_ms'])}–{_t(sc['core_end_ms'])} in the episode, score {sc['score']}. "
      f"Why it was chosen: {_inline(sc['why']) or '–'}")
    asr = asr_words(conn, ep)
    if asr:
        start = sc["clip_start_ms"] if sc["clip_start_ms"] is not None else sc["core_start_ms"] - 2000
        end = sc["clip_end_ms"] if sc["clip_end_ms"] is not None else sc["core_end_ms"] + 2000
        w("")
        w(f"Speech recognition heard, over the scene's clip: {_asr_text(asr, start, end) or '(nothing)'}")
    w("")
    w("Times are minutes:seconds on the episode. ` / ` in a text is a line break. \"Heard\" is the "
      "speech recognition output during the line's subtitle: literal, but it mangles names and "
      "confuses words that sound alike.")
    groups = {r["group_idx"]: r for r in conn.execute(
        "SELECT * FROM translations WHERE episode_id = ? AND lang = 'en'", (ep,))}
    lines = conn.execute(
        "SELECT * FROM lines WHERE episode_id = ? AND idx BETWEEN ? AND ? ORDER BY idx",
        (ep, sc["first_line_idx"], sc["last_line_idx"])).fetchall()
    for l in lines:
        marked = l["id"] == m["line_id"]
        w("")
        w(f"### Line {l['idx']} (`{l['id']}`)" + ("  ← the marked line" if marked else ""))
        facts = []
        if l["speaker"]:
            facts.append(f"speaker {l['speaker']}")
        if l["is_song"]:
            facts.append("sung")
        facts.append(f"subtitle {_t(l['start_ms'])}–{_t(l['end_ms'])}")
        facts.append(f"spoken {_t(l['audio_start_ms'])}–{_t(l['audio_end_ms'])}"
                     if l["audio_start_ms"] is not None else "not aligned")
        w("- " + ", ".join(facts))
        w(f"- Subtitle French: {_q(l['fr'])}")
        if asr:
            heard = _asr_text(asr, l["start_ms"], l["end_ms"])
            w(f"- Heard: {_q(heard) if heard else '(nothing)'}")
        g = groups.get(l["group_idx"])
        if g is None:
            w("- Subtitle English: no translation row")
        elif g["first_line_idx"] < l["idx"]:
            w(f"- Subtitle English: one subtitle with line {g['first_line_idx']} above")
        else:
            span = (f"lines {g['first_line_idx']}–{g['last_line_idx']}"
                    if g["last_line_idx"] > g["first_line_idx"] else f"line {g['first_line_idx']}")
            source = "corrections" if g["source"] == "correction" else g["source"]
            w(f"- Subtitle English: {_q(g['text']) if g['text'] else '(none)'} "
              f"(translation group {g['group_idx']}: {span}; from {source})")
        if l["fr_final"] is None:
            w("- Not annotated: no final French, literal English or units")
            continue
        w(f"- Final French: {_q(l['fr_final'])}")
        w(f"- Literal English: {_q(l['en_literal'])}")
        if marked:
            units = conn.execute("SELECT * FROM units WHERE line_id = ? ORDER BY idx", (l["id"],)).fetchall()
            w("")
            w("Units of the marked line:")
            w("")
            w("| # | kind | French | English | note | spoken |")
            w("|---|---|---|---|---|---|")
            times = {r[0]: (r[1], r[2]) for r in conn.execute(
                "SELECT unit_id, start_ms, end_ms FROM unit_times WHERE line_id = ?", (l["id"],))}
            for u in units:
                a, z = times.get(u["id"], (None, None))
                spoken = f"{_t(a)}–{_t(z)}" if a is not None else "not timed"
                flag = " ← marked" if u["idx"] == m["unit_idx"] else ""
                w(f"| {u['idx']}{flag} | {u['kind']} | {_cell(u['text'])} | {_cell(u['en'])} | "
                  f"{_cell(u['note'])} | {spoken} |")
            if not units:
                w("| – | | | | | |")

    w("")
    w("## Notes of the scene")
    w("")
    notes = conn.execute(
        "SELECT x.*, l.idx AS line_idx FROM notes x LEFT JOIN lines l ON l.id = x.line_id "
        "WHERE x.scene_id = ? ORDER BY x.idx", (sc["id"],)).fetchall()
    for x in notes:
        where = "about the whole scene" if x["line_id"] is None else (
            f"line {x['line_idx']}, phrase {_q(x['phrase'])}"
            + ("" if x["first_word_idx"] is not None else " (not located in the line)"))
        w(f"{x['idx']}. {x['kind']}, {where}: {_inline(x['text'])}")
    if not notes:
        w("None.")

    others = [o for o in list_marks(conn, status="open", episode=ep)
              if o["id"] != m["id"] and sc["first_line_idx"] <= o["line_idx"] <= sc["last_line_idx"]]
    if others:
        w("")
        w("## Other open marks on these lines")
        w("")
        for o in others:
            unit = f", unit {o['unit_idx']} {_q(o['unit_text'])}" if o["unit_idx"] is not None else ""
            w(f"- Mark {o['id']}: {o['category']}, line {o['line_idx']}{unit}: "
              f"{_inline(o['comment']) or '(no comment)'}")

    # Where the fix goes.
    line_at, scene_at = _find_records(root, ep, m["line_idx"], sc["id"])
    w("")
    w("## Where the fix goes")
    w("")
    w(f"Category `{m['category']}`: " + CATEGORY_HELP[m["category"]].format(ep=ep, idx=m["line_idx"]))
    w("")
    if line_at:
        w(f"- The line's annotation record: `{line_at[0]}`, line {line_at[1]} of the file "
          f"(`{{\"line\": {m['line_idx']}, …}}`): `fr`, `en`, `units`.")
    else:
        w(f"- No annotation record for line {m['line_idx']} in `annotations/{ep}/`: the line has "
          f"never been annotated. Report it rather than writing one.")
    if scene_at:
        w(f"- The scene's notes: `{scene_at[0]}`, line {scene_at[1]} of the file "
          f"(`{{\"scene\": \"{sc['id']}\", …}}`).")
    else:
        w(f"- The scene has no scene object in `annotations/{ep}/`: its notes are left as they are by "
          f"an import; add one after its last line to change them.")
    w(f"- After editing an annotation file: `.venv/bin/frenchirix annotate-import {ep}`.")
    g = groups.get(conn.execute("SELECT group_idx FROM lines WHERE id = ?", (m["line_id"],)).fetchone()[0])
    if g is not None:
        corr = _read_json(root / "corrections" / f"{ep}.json") or {}
        has = any(c.get("first") == g["first_line_idx"] and c.get("last") == g["last_line_idx"]
                  for c in corr.get("translations", []) if isinstance(c, dict))
        w(f"- The subtitle English: `corrections/{ep}.json`, an entry with `\"first\": {g['first_line_idx']}, "
          f"\"last\": {g['last_line_idx']}` (the translation group's exact range; "
          + ("the file has one already" if has else "none yet") + f"). Then `.venv/bin/frenchirix import {ep}`.")
    w("- Never edit `cues` or the database by hand. The steps after a fix: docs/runbook.md, "
      "\"Repairing a scene\".")

    # App content built on the line.
    w("")
    w("## App content that uses this line")
    w("")
    w("A change to the line's French or English can make these wrong: revise them by "
      "docs/content-steps.md. A revised question, answer or alternate needs its voice "
      "clip made again (docs/app-tts.md), which the orchestrating session does.")
    qpath = f"app/data/questions/{ep}.json"
    qdata = _read_json(root / qpath) or {}
    containing = [r[0] for r in conn.execute(
        "SELECT id FROM scenes WHERE episode_id = ? AND ? BETWEEN first_line_idx AND last_line_idx "
        "ORDER BY first_line_idx, last_line_idx", (ep, m["line_idx"]))]
    w("")
    w(f"### Questions (`{qpath}`)")
    any_q = False
    for sid in containing:
        entry = (qdata.get("scenes") or {}).get(sid)
        if not isinstance(entry, dict):
            continue
        qs = [q for q in entry.get("questions") or [] if isinstance(q, dict)]
        mine = [q for q in qs if q.get("line") in (m["line_id"], None)]
        w("")
        w(f"Scene `{sid}`, French title {_q(entry.get('title_fr'))}:")
        any_q = True
        for q in mine:
            about = "this line" if q.get("line") == m["line_id"] else "the whole scene"
            w(f"- About {about}: {_q(q.get('fr'))} ({_inline(q.get('en'))})")
            for a in q.get("answers") or []:
                mark = "right" if a.get("correct") else "wrong"
                w(f"  - {mark}: {_q(a.get('fr'))} ({_inline(a.get('en'))})")
        rest = len(qs) - len(mine)
        if not mine:
            w("- No question about this line or the whole scene.")
        if rest:
            w(f"- {rest} more question{'s' if rest > 1 else ''} about other lines of the scene.")
    if not any_q:
        w("")
        w("None.")
    else:
        w("")
        w(f"The units of every question and answer are in `app/data/questions/{ep}.units.json`, keyed "
          f"by the French sentence: a revised sentence needs its units there too.")
    w("")
    w("### Line alternates")
    found = False
    alt_dir = root / "app" / "data" / "alternates"
    for path in sorted([*alt_dir.glob(f"{ep}.json"), *alt_dir.glob(f"{ep}.part*.json")]):
        data = _read_json(path)
        if isinstance(data, dict) and isinstance(data.get(m["line_id"]), list):
            found = True
            w("")
            w(f"In `{path.relative_to(root).as_posix()}`:")
            for k, alt in enumerate(data[m["line_id"]], start=1):
                if isinstance(alt, dict):
                    w(f"{k}. {_q(alt.get('fr'))} ({_inline(alt.get('en'))})")
    if not found:
        w("")
        w("None.")
    w("")
    w(f"When done: `.venv/bin/frenchirix review resolve {m['id']} --status done --resolution \"…\"` "
      f"(or `--status dismissed` with the reason).")
    return "\n".join(out) + "\n"


def format_list(marks: list[dict]) -> str:
    """One row per mark, for `frenchirix review list`."""
    rows = []
    for m in marks:
        unit = f" unit {m['unit_idx']} {_q(m['unit_text'])}" if m["unit_idx"] is not None else ""
        comment = _inline(m["comment"]) or "(no comment)"
        if len(comment) > 100:
            comment = comment[:99] + "…"
        rows.append(f"{m['id']:>4}  {m['status']:<9} {m['category']:<11} {m['scene_id']}  "
                    f"line {m['line_idx']}{unit}: {comment}")
        if m["status"] != "open" and m["resolution"]:
            rows.append(f"      {m['resolved_at'][:10]}: {_inline(m['resolution'])}")
    return "\n".join(rows)
