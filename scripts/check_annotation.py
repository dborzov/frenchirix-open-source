"""Check an annotator's JSONL file before it is handed in.

    .venv/bin/python scripts/check_annotation.py annotations/s01e04/02.jsonl

Prints one line per problem and a final count. It needs no database: it checks what
can be checked from the file alone (the format is in docs/content-steps.md,
"Output"). The import (`frenchirix annotate-import`) checks the rest against the episode.
"""

from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from frenchirix.text import split_words  # noqa: E402


def fold(word: str) -> str:
    decomposed = unicodedata.normalize("NFD", word.casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def words(text: str) -> list[str]:
    return [w for w, _, _ in split_words(text)]


def check(path: Path) -> int:
    problems = 0

    def problem(where: str, what: str) -> None:
        nonlocal problems
        problems += 1
        print(f"{where}: {what}")

    fr_by_line: dict[int, str] = {}
    scenes = 0
    pending_lines = 0
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError as err:
            problem(f"file line {n}", f"not valid JSON ({err.msg})")
            continue
        if "line" in obj:
            where = f"file line {n}, dialogue line {obj['line']}"
            fr, en, units = obj.get("fr"), obj.get("en"), obj.get("units")
            if not isinstance(fr, str) or not fr.strip():
                problem(where, "`fr` is missing or empty")
                continue
            if obj["line"] in fr_by_line:
                problem(where, "this dialogue line appears twice")
            fr_by_line[obj["line"]] = fr
            pending_lines += 1
            if not isinstance(en, str) or not en.strip():
                problem(where, "`en` is missing or empty")
            if not isinstance(units, list) or not units:
                problem(where, "`units` is missing or empty")
                continue
            for unit in units:
                if unit.get("k") not in ("word", "expression"):
                    problem(where, f"unit {unit.get('t')!r}: `k` must be word or expression")
                if not unit.get("en"):
                    problem(where, f"unit {unit.get('t')!r}: `en` is missing")
            line_words = words(fr)
            unit_words = [w for unit in units for w in words(unit.get("t") or "")]
            if line_words != unit_words:
                i = next((k for k, (a, b) in enumerate(zip(line_words, unit_words)) if a != b),
                         min(len(line_words), len(unit_words)))
                problem(where, f"the units do not contain every word of `fr` once, in order; first difference at word {i + 1}: "
                               f"`fr` has {line_words[i:i + 3]}, the units have {unit_words[i:i + 3]}")
            else:
                # The units cover the line, so each unit is a run of the line's words:
                # a unit crosses a line break when one lies between its first and last word.
                spans = split_words(fr)
                at = 0
                for unit in units:
                    count = len(words(unit.get("t") or ""))
                    if count:
                        inside = fr[spans[at][1]:spans[at + count - 1][2]]
                        if "\n" in inside:
                            problem(where, f"unit {unit.get('t')!r} crosses a line break; a unit stays inside "
                                           "one speaker's part or one lyric line")
                    at += count
        elif "scene" in obj:
            scenes += 1
            pending_lines = 0
            where = f"file line {n}, scene {obj['scene']}"
            notes = obj.get("notes")
            if not isinstance(notes, list):
                problem(where, "`notes` must be a list (empty when there is nothing to explain)")
                continue
            for k, note in enumerate(notes, 1):
                tag = f"note {k}"
                if note.get("kind") not in ("reference", "wordplay"):
                    problem(where, f"{tag}: `kind` must be reference or wordplay")
                if not isinstance(note.get("text"), str) or not note["text"].strip():
                    problem(where, f"{tag}: `text` is missing or empty")
                if ("line" in note) != ("phrase" in note):
                    problem(where, f"{tag}: give `line` and `phrase` together, or neither")
                elif "line" in note:
                    fr = fr_by_line.get(note["line"])
                    if fr is None:
                        problem(where, f"{tag}: line {note['line']} is not annotated above")
                    else:
                        hay, needle = [fold(w) for w in words(fr)], [fold(w) for w in words(note["phrase"])]
                        found = needle and any(hay[i:i + len(needle)] == needle for i in range(len(hay) - len(needle) + 1))
                        if not found:
                            problem(where, f"{tag}: phrase {note['phrase']!r} is not in the `fr` of line {note['line']}")
        else:
            problem(f"file line {n}", "neither a line object nor a scene object")
    if pending_lines:
        problem("end of file", f"the last {pending_lines} line objects are not followed by their scene object")
    print(f"{len(fr_by_line)} line objects, {scenes} scene objects, {problems} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(check(Path(sys.argv[1])))
