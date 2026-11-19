#!/usr/bin/env python3
"""Check one app/data/questions/<episode>.json file, or its units file (standard library only).

Usage: python3 scripts/check_questions.py app/data/questions/s01e04.json [--db assets/db.sqlite]
       python3 scripts/check_questions.py --units app/data/questions/s01e04.units.json
       python3 scripts/check_questions.py --alternates app/data/alternates/s01e03.json
       python3 scripts/check_questions.py --alternates 3        (every part file of sheet 3)
       python3 scripts/check_questions.py --alternates app/data/alternates/s01e04.part3.json

The format and the rules are in docs/content-steps.md. Prints every problem with its
scene id and exits 1 if there is any. Reads the database read-only, for the episode's
scenes and their lines.
"""
import argparse
import json
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE_KEYS = {"title_fr", "difficulty", "questions", "doubt"}
QUESTION_KEYS = {"line", "fr", "en", "answers"}
ANSWER_KEYS = {"fr", "en", "correct"}


def words(s):
    return [t for t in s.split() if re.search(r"\w", t)]


def norm(s):
    s = s.casefold().replace("’", "'")
    return re.sub(r"[\W_]+", " ", s).strip()


def episode_scenes(db, episode):
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    out = {}
    for sid, first, last in conn.execute(
            "SELECT id, first_line_idx, last_line_idx FROM scenes WHERE episode_id = ?",
            (episode,)):
        out[sid] = {r[0] for r in conn.execute(
            "SELECT id FROM lines WHERE episode_id = ? AND idx BETWEEN ? AND ?",
            (episode, first, last))}
    return out


def is_text(v):
    return isinstance(v, str) and v.strip() != ""


def check(data, scenes):
    problems = []

    def p(where, msg):
        problems.append(f"{where}: {msg}")

    if not isinstance(data, dict) or not isinstance(data.get("scenes"), dict):
        return ["file: expected an object with \"episode\" and \"scenes\""]
    got = data["scenes"]
    for sid in sorted(set(scenes) - set(got)):
        p(sid, "scene missing")
    for sid in sorted(set(got) - set(scenes)):
        p(sid, "not a scene of this episode")
    for sid in sorted(set(got) & set(scenes)):
        sc = got[sid]
        if not isinstance(sc, dict):
            p(sid, "not an object")
            continue
        for k in sorted(set(sc) - SCENE_KEYS):
            p(sid, f"unknown key {k!r}")
        t = sc.get("title_fr")
        if not isinstance(t, str) or not 3 <= len(t.strip()) <= 40:
            p(sid, f"title_fr must be 3-40 characters, got {t!r}")
        d = sc.get("difficulty")
        if not isinstance(d, int) or isinstance(d, bool) or not 1 <= d <= 5:
            p(sid, f"difficulty must be an integer 1-5, got {d!r}")
        if "doubt" in sc and sc["doubt"] is not None and not isinstance(sc["doubt"], str):
            p(sid, "doubt must be a string or null")
        qs = sc.get("questions")
        if not isinstance(qs, list) or not 1 <= len(qs) <= 2:
            p(sid, "questions must be a list of 1 or 2")
            continue
        for n, q in enumerate(qs, 1):
            w = f"{sid} q{n}"
            if not isinstance(q, dict):
                p(w, "not an object")
                continue
            for k in sorted(set(q) - QUESTION_KEYS):
                p(w, f"unknown key {k!r}")
            line = q.get("line")
            if line is not None and line not in scenes[sid]:
                p(w, f"line {line!r} is not a line of this scene")
            fr = q.get("fr")
            if not is_text(fr):
                p(w, "fr missing")
            else:
                nw = len(words(fr))
                if not 3 <= nw <= 14:
                    p(w, f"question has {nw} words, needs 3-14: {fr!r}")
                if not fr.rstrip().endswith("?"):
                    p(w, f"question does not end with '?': {fr!r}")
            if not is_text(q.get("en")):
                p(w, "en missing or empty")
            ans = q.get("answers")
            if not isinstance(ans, list) or not 3 <= len(ans) <= 4:
                p(w, "needs 3 or 4 answers")
                continue
            correct = 0
            seen = set()
            for k, a in enumerate(ans, 1):
                wa = f"{w} answer {k}"
                if not isinstance(a, dict):
                    p(wa, "not an object")
                    continue
                for key in sorted(set(a) - ANSWER_KEYS):
                    p(wa, f"unknown key {key!r}")
                if not isinstance(a.get("correct"), bool):
                    p(wa, "correct must be true or false")
                elif a["correct"]:
                    correct += 1
                afr = a.get("fr")
                if not is_text(afr):
                    p(wa, "fr missing")
                    continue
                nw = len(words(afr))
                if not 1 <= nw <= 10:
                    p(wa, f"answer has {nw} words, needs 1-10: {afr!r}")
                if norm(afr) in seen:
                    p(wa, f"same as another answer: {afr!r}")
                seen.add(norm(afr))
                if not is_text(a.get("en")):
                    p(wa, "en missing or empty")
            if correct != 1:
                p(w, f"{correct} correct answers, needs exactly 1")
    return problems


def sentences_of(questions):
    """Every French sentence of a questions file, in file order."""
    out = []
    for sc in (questions.get("scenes") or {}).values():
        for q in (sc.get("questions") or []) if isinstance(sc, dict) else []:
            for item in [q, *(q.get("answers") or [])]:
                if isinstance(item, dict) and isinstance(item.get("fr"), str) and item["fr"] not in out:
                    out.append(item["fr"])
    return out


def check_pieces(s, pieces, *, max_units=5, max_words=4):
    """Problems of one sentence's units [[French piece, English], ...]: they must tile it.
    max_units / max_words None: no limit on the count of units or of words per piece."""
    problems = []

    def p(msg):
        problems.append(msg)

    if not isinstance(pieces, list) or not pieces:
        return ["units must be a non-empty list of [French, English] pairs"]
    if max_units and len(pieces) > max_units:
        p(f"{len(pieces)} units, at most {max_units}")
    pos = 0
    for item in pieces:
        if (not isinstance(item, list) or len(item) != 2
                or not all(isinstance(x, str) for x in item)):
            p(f"{item!r} is not a [French, English] pair")
            return problems
        fr, en = item
        nw = len(words(fr))
        if max_words and not 1 <= nw <= max_words:
            p(f"piece {fr!r} has {nw} words, needs 1-{max_words}")
        if not en.strip():
            p(f"piece {fr!r} has no English")
        i = s.find(fr, pos) if fr else -1
        if i < 0:
            p(f"piece {fr!r} not found at or after position {pos} (spelling, order or a repeat)")
            return problems
        if re.search(r"\w", s[pos:i]):
            p(f"{s[pos:i].strip()!r} before {fr!r} is not covered")
        if not (fr[0].isalnum() and fr[-1].isalnum()):
            p(f"piece {fr!r} starts or ends with punctuation or space (leave it out)")
        pos = i + len(fr)
    if re.search(r"\w", s[pos:]):
        p(f"{s[pos:].strip()!r} at the end is not covered")
    return problems


def check_units(units, sentences):
    """Problems of a units file: {sentence: [[French piece, English], ...]}."""
    problems = []
    if not isinstance(units, dict):
        return ["file: expected an object mapping each French sentence to its units"]
    for s in sentences:
        if s not in units:
            problems.append(f"{s!r}: no entry")
    for s in units:
        if s not in sentences:
            problems.append(f"{s!r}: not a sentence of this episode's questions (stray key)")
    for s in sentences:
        if s in units:
            problems += [f"{s!r}: {m}" for m in check_pieces(s, units[s])]
    return problems


def scene_lines_text(db, episode):
    """{line id: French as said} for the lines of an episode that belong to some scene."""
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    out = {}
    for first, last in conn.execute(
            "SELECT first_line_idx, last_line_idx FROM scenes WHERE episode_id = ?", (episode,)):
        for lid, fr_final, fr in conn.execute(
                "SELECT id, fr_final, fr FROM lines WHERE episode_id = ? AND idx BETWEEN ? AND ?",
                (episode, first, last)):
            out[lid] = fr_final or fr
    return out


def check_alternates(alts, lines):
    """Problems of an alternates file: {line id: [{fr, en, units}, {fr, en, units}]}.
    lines: {line id: its French} for the lines of the episode that are in some scene."""
    problems = []
    if not isinstance(alts, dict):
        return ["file: expected an object mapping line ids to their alternates"]
    for lid, items in alts.items():
        def p(msg, lid=lid):
            problems.append(f"{lid}: {msg}")
        if lid not in lines:
            p("not a line of this episode that belongs to a scene")
            continue
        if not isinstance(items, list) or len(items) != 2:
            p("needs exactly two alternates")
            if not isinstance(items, list):
                continue
        seen = {norm(lines[lid])}
        for k, alt in enumerate(items, 1):
            if not isinstance(alt, dict):
                p(f"alternate {k} is not an object")
                continue
            for key in sorted(set(alt) - {"fr", "en", "units"}):
                p(f"alternate {k}: unknown key {key!r}")
            fr, en = alt.get("fr"), alt.get("en")
            if not is_text(fr):
                p(f"alternate {k}: fr missing")
                continue
            if not is_text(en):
                p(f"alternate {k}: en missing or empty")
            nw = len(words(fr))
            if not 2 <= nw <= 14:
                p(f"alternate {k} has {nw} words, needs 2-14: {fr!r}")
            if norm(fr) in seen:
                p(f"alternate {k} is the same as the line or the other alternate: {fr!r}")
            seen.add(norm(fr))
            problems += [f"{lid}: alternate {k}: {m}"
                         for m in check_pieces(fr, alt.get("units"), max_units=None, max_words=None)]
    return problems


def _check_alt_file(path, db, expected=None):
    """Problems of one alternates file; `expected` (a list of line ids) also requires
    exactly those lines, as a sheet assigns them."""
    try:
        with open(path, encoding="utf-8") as fh:
            alts = json.load(fh)
    except FileNotFoundError:
        return [f"file: {path} not found"], 0, 0
    except (OSError, json.JSONDecodeError) as e:
        return [f"file: cannot read JSON: {e}"], 0, 0
    base = os.path.basename(path)
    problems = check_alternates(alts, scene_lines_text(db, base[:6]))
    if expected is not None and isinstance(alts, dict):
        problems += [f"{lid}: line of the sheet has no alternates" for lid in expected if lid not in alts]
        problems += [f"{lid}: not a line this sheet assigns" for lid in alts if lid not in expected]
    n = sum(len(v) for v in alts.values() if isinstance(v, list)) if isinstance(alts, dict) else 0
    return problems, (len(alts) if isinstance(alts, dict) else 0), n


def main_alternates(target, db):
    """target: a sheet number (checks every part file of that sheet against its lines),
    a part file app/data/alternates/<episode>.part<n>.json (its sheet's lines for that
    episode), or a plain app/data/alternates/<episode>.json."""
    sheets_path = os.path.join(ROOT, "work", "alternates", "sheets.json")
    alt_dir = os.path.join(ROOT, "app", "data", "alternates")
    m = re.fullmatch(r"(s\d\de\d\d)\.part(\d+)\.json", os.path.basename(target))
    if target.isdigit() or m:
        try:
            with open(sheets_path, encoding="utf-8") as fh:
                sheets = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            print(f"file: cannot read {sheets_path} (run frenchirix alternates-sheet): {e}")
            return 1
        n = target if target.isdigit() else m.group(2)
        if n not in sheets:
            print(f"file: there is no sheet {n}")
            return 1
        jobs = [(os.path.join(alt_dir, f"{ep}.part{n}.json"), ep, lines) for ep, lines in sheets[n].items()]
        if m:
            jobs = [(target, ep, lines) for _, ep, lines in jobs if ep == m.group(1)]
            if not jobs:
                print(f"file: sheet {n} has no lines of {m.group(1)}")
                return 1
    else:
        if not re.fullmatch(r"s\d\de\d\d\.json", os.path.basename(target)):
            print(f"file: expected a sheet number, <episode>.part<n>.json or <episode>.json, got {target}")
            return 1
        jobs = [(target, os.path.basename(target)[:6], None)]
    total = 0
    for path, ep, lines in jobs:
        problems, n_lines, n_alts = _check_alt_file(path, db, lines)
        for pr in problems:
            print(pr)
        total += len(problems)
        print(f"{os.path.basename(path)}: {n_lines} lines" + (f" of {len(lines)}" if lines is not None else "")
              + f", {n_alts} alternates, {len(problems)} problems")
    return 1 if total else 0


def main_units(path):
    try:
        with open(path, encoding="utf-8") as fh:
            units = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print(f"file: cannot read JSON: {e}")
        return 1
    base = os.path.basename(path)
    if not re.fullmatch(r"s\d\de\d\d\.units\.json", base):
        print(f"file: expected a name like s01e04.units.json, got {base}")
        return 1
    qpath = os.path.join(os.path.dirname(path), base[:6] + ".json")
    try:
        with open(qpath, encoding="utf-8") as fh:
            questions = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print(f"file: cannot read the questions file {qpath}: {e}")
        return 1
    sentences = sentences_of(questions)
    problems = check_units(units, sentences)
    for pr in problems:
        print(pr)
    n_units = sum(len(v) for v in units.values() if isinstance(v, list)) if isinstance(units, dict) else 0
    print(f"{base[:6]}: {len(sentences)} sentences, {len(units) if isinstance(units, dict) else 0} entries, "
          f"{n_units} units, {len(problems)} problems")
    return 1 if problems else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", nargs="?")
    ap.add_argument("--db", default=os.path.join(ROOT, "assets", "db.sqlite"))
    ap.add_argument("--units", metavar="UNITS_FILE", help="check a <episode>.units.json instead")
    ap.add_argument("--alternates", metavar="SHEET_OR_FILE",
                    help="check line alternates instead: a sheet number (all its part files), "
                         "a part file <episode>.part<n>.json, or <episode>.json")
    args = ap.parse_args()
    if args.units:
        return main_units(args.units)
    if args.alternates:
        return main_alternates(args.alternates, args.db)
    if not args.file:
        ap.error("give a questions file, or --units with a units file")
    try:
        with open(args.file, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print(f"file: cannot read JSON: {e}")
        return 1
    episode = data.get("episode") if isinstance(data, dict) else None
    if not isinstance(episode, str) or not re.fullmatch(r"s\d\de\d\d", episode):
        print(f"file: \"episode\" must be like \"s01e04\", got {episode!r}")
        return 1
    name = os.path.splitext(os.path.basename(args.file))[0]
    problems = []
    if name != episode:
        problems.append(f"file: named {name} but \"episode\" is {episode}")
    scenes = episode_scenes(args.db, episode)
    if not scenes:
        print(f"file: no scenes for episode {episode} in {args.db}")
        return 1
    problems += check(data, scenes)
    for pr in problems:
        print(pr)
    got = data.get("scenes") if isinstance(data.get("scenes"), dict) else {}
    n_q = sum(len(s.get("questions") or []) for s in got.values()
              if isinstance(s, dict) and isinstance(s.get("questions"), list))
    print(f"{episode}: {len(got)} of {len(scenes)} scenes, {n_q} questions, "
          f"{len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
