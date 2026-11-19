"""`annotate-sheet` and `annotate-import`: steps 7 and 9 of docs/runbook.md.

The annotators' file format is in docs/content-steps.md; the import's rules and
choices are in docs/pipeline.md.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from .db import REPO_ROOT
from .text import split_words

SCENES_PER_SHEET = 12
DEFAULT_ANNOTATOR = "sonnet:annotate-v1"
KINDS = ("word", "expression")
NOTE_KINDS = ("reference", "wordplay")
# Used when a scene has no rendered clip yet: the same padding as docs/media.md.
CLIP_PAD_MS = 2000
# A line's French is suspicious when two or more of its words, and more than
# 1 - this share of them, occur in neither the subtitle nor the recognised words
# around the line.
SUPPORTED_SHARE = 0.75
# Recognised words this far outside a line's subtitle time still count as support.
SUPPORT_SLACK_MS = 1500
SHOW_CONTEXT = REPO_ROOT / "docs" / "show-context.md"


class AnnotationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("\n".join(errors))
        self.errors = errors


# --- the sheet ----------------------------------------------------------------

def _inline(text: str) -> str:
    return " / ".join(p.strip() for p in text.split("\n") if p.strip())


def _asr_text(asr: list[tuple[int, int, str]], start: int, end: int) -> str:
    """Recognised words whose midpoint falls in [start, end)."""
    return " ".join(t for a, b, t in asr if start <= (a + b) // 2 < end)


def _scenes(conn: sqlite3.Connection, episode_id: str) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT id, first_line_idx, last_line_idx, core_start_ms, core_end_ms, clip_start_ms, "
        "clip_end_ms, kind, title FROM scenes WHERE episode_id = ? "
        "ORDER BY core_start_ms, first_line_idx, last_line_idx", (episode_id,))]


def split_sheets(scenes: list[dict], per_sheet: int = SCENES_PER_SHEET) -> list[list[dict]]:
    """Split scenes (in timeline order) into sheets of about `per_sheet` scenes.

    Scenes that share a line always go on the same sheet, so a shared line is
    annotated once, on the sheet that shows it "(annotated above)" later.
    """
    clusters: list[list[dict]] = []
    reach = -1
    for s in scenes:
        if clusters and s["first_line_idx"] <= reach:
            clusters[-1].append(s)
        else:
            clusters.append([s])
        reach = max(reach, s["last_line_idx"])
    if not clusters:
        return []
    n_sheets = math.ceil(len(scenes) / per_sheet)
    target = len(scenes) / n_sheets
    sheets: list[list[dict]] = [[]]
    for c in clusters:
        # Close a sheet once adding the next cluster would overshoot its share.
        if sheets[-1] and len(sheets) < n_sheets and len(sheets[-1]) + len(c) / 2 > target:
            sheets.append([])
        sheets[-1].extend(c)
    return sheets


def render_sheet(conn: sqlite3.Connection, episode_id: str, scenes: list[dict],
                 asr: list[tuple[int, int, str]]) -> str:
    lines = {r["idx"]: dict(r) for r in conn.execute(
        "SELECT idx, start_ms, end_ms, fr, speaker, is_song, group_idx FROM lines "
        "WHERE episode_id = ?", (episode_id,))}
    first_of_group = {r[0]: r[1] for r in conn.execute(
        "SELECT first_line_idx, text FROM translations WHERE episode_id = ? AND lang = 'en'",
        (episode_id,))}
    seen: set[int] = set()
    out: list[str] = []
    for s in scenes:
        if out:
            out.append("")
        out.append(f"### {s['id']} | {s['kind']} | {s['title']}")
        start = s["clip_start_ms"] if s["clip_start_ms"] is not None else s["core_start_ms"] - CLIP_PAD_MS
        end = s["clip_end_ms"] if s["clip_end_ms"] is not None else s["core_end_ms"] + CLIP_PAD_MS
        out.append(f"heard: {_asr_text(asr, start, end)}".rstrip())
        for idx in range(s["first_line_idx"], s["last_line_idx"] + 1):
            l = lines[idx]
            prefix = f"{idx:04d} " + (f"({l['speaker']}) " if l["speaker"] else "") + \
                ("♪ " if l["is_song"] else "")
            if idx in seen:
                out.append(f"{prefix}(annotated above) FR  {_inline(l['fr'])}")
                continue
            seen.add(idx)
            en = _inline(first_of_group[idx]) if idx in first_of_group else "^"
            out.append(f"{prefix}FR  {_inline(l['fr'])}")
            out.append(f"     EN  {en}".rstrip())
            out.append(f"     ASR {_asr_text(asr, l['start_ms'], l['end_ms'])}".rstrip())
    return "\n".join(out) + "\n"


def asr_words(conn: sqlite3.Connection, episode_id: str) -> list[tuple[int, int, str]]:
    return [tuple(r) for r in conn.execute(
        "SELECT start_ms, end_ms, text FROM asr_words WHERE episode_id = ? ORDER BY idx",
        (episode_id,))]


def write_sheets(conn: sqlite3.Connection, episode_id: str, out_dir: Path) -> list[tuple[Path, int]]:
    """Write work/<episode>/annotate-NN.txt; returns (path, number of scenes) per sheet."""
    asr = asr_words(conn, episode_id)
    if not asr:
        raise AnnotationError([f"{episode_id} has no recognised words; run "
                               f"`frenchirix transcribe {episode_id}` first"])
    scenes = _scenes(conn, episode_id)
    if not scenes:
        raise AnnotationError([f"{episode_id} has no scenes to annotate"])
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("annotate-*.txt"):
        old.unlink()
    written = []
    for n, sheet in enumerate(split_sheets(scenes), start=1):
        path = out_dir / f"annotate-{n:02d}.txt"
        path.write_text(render_sheet(conn, episode_id, sheet, asr), encoding="utf-8")
        written.append((path, len(sheet)))
    return written


# --- the import ---------------------------------------------------------------

@dataclass
class Record:
    where: str               # "annotations/s01e04/01.jsonl:3"
    line: int
    fr: str
    en: str
    units: list[dict]


@dataclass
class SceneRecord:
    where: str               # "annotations/s01e04/01.jsonl:5"
    scene: str
    notes: list[dict]


@dataclass
class ImportResult:
    loaded: int = 0
    kept_timings: int = 0
    fr_changed: int = 0
    words_added: int = 0
    units_by_kind: dict[str, int] = field(default_factory=dict)
    scenes_noted: int = 0
    notes_by_kind: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _words(text: str) -> list[str]:
    return [w for w, _, _ in split_words(text)]


def _check_units(fr: str, units: list[dict]) -> str | None:
    """None when the units' words, read in order, are exactly the words of `fr`."""
    want = _words(fr)
    got: list[tuple[str, int]] = []           # (word, unit number)
    for n, u in enumerate(units, start=1):
        ws = _words(u["t"])
        if not ws:
            return f"unit {n} ({u['t']!r}) has no words"
        got.extend((w, n) for w in ws)
    for i, (w, (g, n)) in enumerate(zip(want, got), start=1):
        if w != g:
            return f"word {i}: fr has {w!r}, unit {n} has {g!r}"
    if len(got) > len(want):
        w, n = got[len(want)]
        return f"units have extra words after the end of fr, from {w!r} in unit {n}"
    if len(got) < len(want):
        return f"units stop at word {len(got)}; fr continues with {' '.join(want[len(got):])!r}"
    return None


def _check_scene(obj: dict, where: str, rng: tuple[int, int]) -> list[str]:
    """Problems with a scene object whose scene exists and spans lines `rng`."""
    exps = obj.get("notes")
    if not isinstance(exps, list):
        return [f"{where}: \"notes\" must be a list"]
    errors = []
    for n, x in enumerate(exps, start=1):
        if not isinstance(x, dict):
            errors.append(f"{where}: note {n} must be an object")
            continue
        if x.get("kind") not in NOTE_KINDS:
            errors.append(f"{where}: note {n}: \"kind\" must be reference or wordplay, "
                          f"got {x.get('kind')!r}")
        if not isinstance(x.get("text"), str) or not x["text"].strip():
            errors.append(f"{where}: note {n}: \"text\" must be a non-empty string")
        has_line, has_phrase = "line" in x, "phrase" in x
        if has_line != has_phrase:
            errors.append(f"{where}: note {n}: \"line\" and \"phrase\" must be given together")
        if has_phrase and (not isinstance(x["phrase"], str) or not x["phrase"].strip()):
            errors.append(f"{where}: note {n}: \"phrase\" must be a non-empty string")
        if has_line:
            line = x["line"]
            if not isinstance(line, int) or isinstance(line, bool):
                errors.append(f"{where}: note {n}: \"line\" must be an integer")
            elif not rng[0] <= line <= rng[1]:
                errors.append(f"{where}: note {n}: line {line} is not in the scene "
                              f"(lines {rng[0]}-{rng[1]})")
    return errors


def read_records(paths: list[Path], valid_lines: set[int],
                 scenes: dict[str, tuple[int, int]] | None = None,
                 ) -> tuple[list[Record], list[SceneRecord], list[str]]:
    """Line objects and scene objects from the files, and every problem found.

    `scenes` maps each scene id of the episode to its (first, last) line.
    """
    scenes = scenes or {}
    records, scene_records, errors = [], [], []
    first_seen: dict[int, str] = {}
    scene_seen: dict[str, str] = {}
    for path in paths:
        try:
            rel = path.relative_to(REPO_ROOT)
        except ValueError:
            rel = path
        for no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            where = f"{rel}:{no}"
            if not raw.strip():
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError as e:
                errors.append(f"{where}: not valid JSON: {e}")
                continue
            if not isinstance(obj, dict):
                errors.append(f"{where}: must be a JSON object")
                continue
            if "scene" in obj:
                sid = obj["scene"]
                if "line" in obj:
                    errors.append(f"{where}: has both \"scene\" and \"line\"; a line object "
                                  f"has \"line\", a scene object \"scene\"")
                    continue
                if not isinstance(sid, str):
                    errors.append(f"{where}: \"scene\" must be a scene id string")
                    continue
                where = f"{where} (scene {sid})"
                if sid not in scenes:
                    errors.append(f"{where}: no such scene in the episode")
                    continue
                bad = len(errors)
                if sid in scene_seen:
                    errors.append(f"{where}: already given at {scene_seen[sid]}")
                else:
                    scene_seen[sid] = f"{rel}:{no}"
                errors.extend(_check_scene(obj, where, scenes[sid]))
                if len(errors) == bad:
                    scene_records.append(SceneRecord(where, sid, obj["notes"]))
                continue
            line = obj.get("line")
            if not isinstance(line, int) or isinstance(line, bool):
                errors.append(f"{where}: \"line\" must be an integer")
                continue
            where = f"{where} (line {line})"
            bad = len(errors)
            if line not in valid_lines:
                errors.append(f"{where}: no such line in the episode")
            elif line in first_seen:
                errors.append(f"{where}: already annotated at {first_seen[line]}")
            else:
                first_seen[line] = f"{rel}:{no}"
            fr, en, units = obj.get("fr"), obj.get("en"), obj.get("units")
            for key, val in (("fr", fr), ("en", en)):
                if not isinstance(val, str) or not val.strip():
                    errors.append(f"{where}: \"{key}\" must be a non-empty string")
            if not isinstance(units, list) or not units:
                errors.append(f"{where}: \"units\" must be a non-empty list")
                continue
            ok_units = True
            for n, u in enumerate(units, start=1):
                if not isinstance(u, dict):
                    errors.append(f"{where}: unit {n} must be an object")
                    ok_units = False
                    continue
                if not isinstance(u.get("t"), str) or not u["t"].strip():
                    errors.append(f"{where}: unit {n}: \"t\" must be a non-empty string")
                    ok_units = False
                if u.get("k") not in KINDS:
                    errors.append(f"{where}: unit {n}: \"k\" must be word or expression, got {u.get('k')!r}")
                if not isinstance(u.get("en"), str) or not u["en"].strip():
                    errors.append(f"{where}: unit {n}: \"en\" must be a non-empty string")
                note = u.get("note")
                if note is not None and not isinstance(note, str):
                    errors.append(f"{where}: unit {n}: \"note\" must be a string")
            if ok_units and isinstance(fr, str) and fr.strip():
                problem = _check_units(fr, units)
                if problem:
                    errors.append(f"{where}: units do not cover fr: {problem}")
            if len(errors) == bad:
                records.append(Record(where, line, fr, en, units))
    return records, scene_records, errors


def _fold(word: str) -> str:
    word = unicodedata.normalize("NFD", word.lower())
    return "".join(ch for ch in word if not unicodedata.combining(ch)).replace("’", "'")


def locate_phrase(fr: str, phrase: str) -> tuple[int, int] | None:
    """(first, last) 1-based word positions of the first run of words of `fr` that
    equals the words of `phrase`, ignoring case and accents; None when absent."""
    want = [_fold(w) for w in _words(phrase)]
    have = [_fold(w) for w in _words(fr)]
    if not want:
        return None
    for i in range(len(have) - len(want) + 1):
        if have[i:i + len(want)] == want:
            return i + 1, i + len(want)
    return None


def renamed_names(conn: sqlite3.Connection, episode_id: str,
                  context: Path = SHOW_CONTEXT) -> list[tuple[str, str]]:
    """(French, English) name pairs from the table in show-context.md where the
    English subtitles rename the character, kept only when the English name
    occurs in this episode's English subtitle track."""
    if not context.exists():
        return []
    en_text = " ".join(r[0] for r in conn.execute(
        "SELECT raw_text FROM cues WHERE episode_id = ? AND track = 'en'", (episode_id,)))
    pairs = []
    for row in context.read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if len(cells) < 2 or not row.startswith("|") or cells[0] in ("French", "") or set(cells[0]) <= {"-"}:
            continue
        if cells[1].lower() == "same":
            continue
        frs = [re.sub(r"\(.*?\)|\*", "", x).strip() for x in re.split(r"[/,]", cells[0])]
        ens = [re.sub(r"\(.*?\)|\*", "", x).strip() for x in re.split(r"[/,]", cells[1])]
        for fr_name, en_name in zip(frs, ens):
            if not fr_name or not en_name or _fold(fr_name) == _fold(en_name):
                continue
            if re.search(rf"\b{re.escape(en_name)}\b", en_text):
                pairs.append((fr_name, en_name))
    return pairs


def import_annotations(conn: sqlite3.Connection, episode_id: str, directory: Path,
                       annotated_by: str = DEFAULT_ANNOTATOR) -> ImportResult:
    """Validate every directory/*.jsonl and load it. All or nothing."""
    lines = {r["idx"]: dict(r) for r in conn.execute(
        "SELECT id, idx, start_ms, end_ms, fr, fr_final FROM lines WHERE episode_id = ?",
        (episode_id,))}
    if not lines:
        raise AnnotationError([f"{episode_id} has no lines; run `frenchirix import {episode_id}` first"])
    paths = sorted(directory.glob("*.jsonl"))
    if not paths:
        raise AnnotationError([f"no annotation files in {directory}"])
    scenes = {r["id"]: dict(r) for r in conn.execute(
        "SELECT id, first_line_idx, last_line_idx FROM scenes WHERE episode_id = ?",
        (episode_id,))}
    records, scene_records, errors = read_records(
        paths, set(lines), {k: (v["first_line_idx"], v["last_line_idx"]) for k, v in scenes.items()})
    if errors:
        raise AnnotationError(errors)

    res = ImportResult()
    # Warnings: missing lines, unsupported words, English renames.
    in_scenes: set[int] = set()
    for sc in scenes.values():
        in_scenes.update(range(sc["first_line_idx"], sc["last_line_idx"] + 1))
    done = {r.line for r in records}
    missing = sorted(in_scenes - done)
    if missing:
        res.warnings.append(f"{len(missing)} lines of scenes have no annotation: "
                            + ", ".join(map(str, missing)))
    outside = sorted(done - in_scenes)
    if outside:
        res.warnings.append(f"{len(outside)} annotated lines are in no scene: "
                            + ", ".join(map(str, outside)))
    noted = {sr.scene for sr in scene_records}
    not_noted = [sid for sid, sc in scenes.items()
                 if sid not in noted
                 and any(sc["first_line_idx"] <= ln <= sc["last_line_idx"] for ln in done)]
    if not_noted:
        res.warnings.append(f"{len(not_noted)} scenes have annotated lines but no scene object, "
                            f"so their notes were left as they are: " + ", ".join(sorted(not_noted)))
    asr = asr_words(conn, episode_id)
    names = renamed_names(conn, episode_id)
    for r in records:
        l = lines[r.line]
        support = {_fold(w) for w in _words(l["fr"])}
        support |= {_fold(w) for a, b, t in asr
                    if l["start_ms"] - SUPPORT_SLACK_MS <= (a + b) // 2 < l["end_ms"] + SUPPORT_SLACK_MS
                    for w in _words(t)}
        ws = _words(r.fr)
        unsupported = [w for w in ws if _fold(w) not in support]
        if len(unsupported) >= 2 and len(unsupported) > (1 - SUPPORTED_SHARE) * len(ws):
            res.warnings.append(f"{r.where}: {len(unsupported)} of {len(ws)} words are in neither "
                                f"the subtitle nor the recognised text: {' '.join(unsupported)}")
        for fr_name, en_name in names:
            if re.search(rf"\b{re.escape(en_name)}\b", r.en) and \
                    re.search(rf"\b{re.escape(fr_name)}\b", r.fr, re.IGNORECASE):
                res.warnings.append(f"{r.where}: en uses the English subtitle name "
                                    f"{en_name!r}; the French name is {fr_name!r}")

    # Note rows to insert, with phrases located in the line's final French:
    # the one in these files, otherwise the stored one.
    final_fr = {idx: l["fr_final"] for idx, l in lines.items()}
    final_fr.update({r.line: r.fr for r in records})
    new_notes: list[tuple] = []
    for sr in scene_records:
        for n, x in enumerate(sr.notes, start=1):
            phrase = x["phrase"].strip() if "phrase" in x else None
            line_id, span = None, (None, None)
            if phrase is not None:
                line_id = lines[x["line"]]["id"]
                fr = final_fr[x["line"]]
                found = locate_phrase(fr, phrase) if fr is not None else None
                if found:
                    span = found
                elif fr is None:
                    res.warnings.append(f"{sr.where}: note {n}: line {x['line']} has no final "
                                        f"French yet; phrase {phrase!r} kept without a word span")
                else:
                    res.warnings.append(f"{sr.where}: note {n}: phrase {phrase!r} is not in "
                                        f"line {x['line']} ({_inline(fr)!r}); kept without a word span")
            new_notes.append((sr.scene, n, x["kind"], x["text"].strip(), phrase, line_id, *span))
            res.notes_by_kind[x["kind"]] = res.notes_by_kind.get(x["kind"], 0) + 1
    res.scenes_noted = len(scene_records)

    with conn:
        for r in records:
            l = lines[r.line]
            lid = l["id"]
            words = split_words(r.fr)
            unchanged = l["fr_final"] == r.fr and conn.execute(
                "SELECT COUNT(*) FROM words WHERE line_id = ?", (lid,)).fetchone()[0] == len(words)
            conn.execute("DELETE FROM units WHERE line_id = ?", (lid,))
            if unchanged:
                conn.execute("UPDATE lines SET en_literal = ?, annotated_by = ? WHERE id = ?",
                             (r.en, annotated_by, lid))
                res.kept_timings += 1
            else:
                conn.execute("DELETE FROM words WHERE line_id = ?", (lid,))
                conn.executemany(
                    "INSERT INTO words (line_id, idx, text, char_start, char_end) VALUES (?, ?, ?, ?, ?)",
                    [(lid, i, w, a, b) for i, (w, a, b) in enumerate(words, start=1)])
                conn.execute(
                    "UPDATE lines SET fr_final = ?, en_literal = ?, annotated_by = ?, "
                    "audio_start_ms = NULL, audio_end_ms = NULL WHERE id = ?",
                    (r.fr, r.en, annotated_by, lid))
                _relocate(conn, lid, r.fr, noted, res.warnings)
            pos = 0
            for n, u in enumerate(r.units, start=1):
                k = len(_words(u["t"]))
                first, last = pos + 1, pos + k
                pos = last
                text = r.fr[words[first - 1][1]:words[last - 1][2]]
                conn.execute(
                    "INSERT INTO units (line_id, idx, kind, first_word_idx, last_word_idx, text, en, note) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (lid, n, u["k"], first, last, text, u["en"].strip(), (u.get("note") or None)))
                res.units_by_kind[u["k"]] = res.units_by_kind.get(u["k"], 0) + 1
            res.loaded += 1
            if " ".join(r.fr.split()) != " ".join(l["fr"].split()):
                res.fr_changed += 1
            res.words_added += len(words) - len(_words(l["fr"]))
        for sid in noted:
            conn.execute("DELETE FROM notes WHERE scene_id = ?", (sid,))
        conn.executemany(
            "INSERT INTO notes (scene_id, idx, kind, text, phrase, line_id, "
            "first_word_idx, last_word_idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", new_notes)
    return res


def _relocate(conn: sqlite3.Connection, line_id: str, fr: str, skip_scenes: set[str],
              warnings: list[str]) -> None:
    """Point the stored notes on a line whose words were rebuilt at the
    phrase's new position, or at no words when it is gone. Scenes in
    `skip_scenes` are about to be replaced and are left alone."""
    for eid, sid, idx, phrase, first in conn.execute(
            "SELECT id, scene_id, idx, phrase, first_word_idx FROM notes "
            "WHERE line_id = ? AND phrase IS NOT NULL ORDER BY scene_id, idx", (line_id,)).fetchall():
        if sid in skip_scenes:
            continue
        span = locate_phrase(fr, phrase) or (None, None)
        conn.execute("UPDATE notes SET first_word_idx = ?, last_word_idx = ? WHERE id = ?",
                     (*span, eid))
        if span[0] is None:
            was = "its word span was cleared" if first is not None else "it still has no word span"
            warnings.append(f"{sid} note {idx}: phrase {phrase!r} is not in the new French "
                            f"of {line_id} ({_inline(fr)!r}); {was}")
