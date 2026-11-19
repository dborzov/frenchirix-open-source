"""Put French proper names back into the literal English of annotation files.

    .venv/bin/python scripts/fix_english_names.py s01e04

`frenchirix annotate-import` warns when a line's literal English uses the name the
show's English subtitles gave a character where the French line has the French name
("Caesar" for "César"). This script runs the import, reads those warnings, rewrites
the name in the `en` of the flagged lines and in the glosses of their units, and
tells you to import again. Scene notes are left alone: they are prose for a child
and may name a historical figure in English on purpose.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WARNING = re.compile(
    r"warning: (?P<file>\S+?):\d+ \(line (?P<line>\d+)\): en uses the English subtitle name "
    r"'(?P<english>[^']+)'; the French name is '(?P<french>[^']+)'"
)


def main(episode: str) -> int:
    run = subprocess.run(
        [str(REPO / ".venv/bin/frenchirix"), "annotate-import", episode],
        capture_output=True, text=True, cwd=REPO,
    )
    fixes: dict[tuple[str, int], list[tuple[str, str]]] = {}
    for match in WARNING.finditer(run.stdout + run.stderr):
        key = (match["file"], int(match["line"]))
        fixes.setdefault(key, []).append((match["english"], match["french"]))
    if not fixes:
        print(f"{episode}: no renamed English names flagged")
        return 0
    for path in sorted({file for file, _ in fixes}):
        target = REPO / path
        rows = []
        for raw in target.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            obj = json.loads(raw)
            for english, french in fixes.get((path, obj.get("line", -1)), []):
                pattern = re.compile(rf"\b{re.escape(english)}\b")
                before = obj["en"]
                obj["en"] = pattern.sub(french, obj["en"])
                for unit in obj["units"]:
                    unit["en"] = pattern.sub(french, unit["en"])
                print(f"{path} line {obj['line']}: {before!r} -> {obj['en']!r}")
            rows.append(json.dumps(obj, ensure_ascii=False))
        target.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(f"{episode}: rewrote {len(fixes)} lines; run annotate-import again")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
