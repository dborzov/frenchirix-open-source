"""Command line: `.venv/bin/frenchirix <command>` or `uv run --no-sync frenchirix <command>`.
The order of the steps is in docs/runbook.md."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .db import DB_PATH, REPO_ROOT, connect


def cmd_import(args: argparse.Namespace) -> int:
    from .importer import ImportError_, import_episode, stats

    conn = connect()
    try:
        msg, imp = import_episode(conn, args.episode, Path(args.file) if args.file else None, args.show)
    except ImportError_ as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(msg)
    print(stats(imp))
    return 0


def cmd_sheet(args: argparse.Namespace) -> int:
    from .sheet import sheet_for

    conn = connect()
    try:
        text = sheet_for(conn, args.episode)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    out = REPO_ROOT / "work" / args.episode / "sheet.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out.relative_to(REPO_ROOT)} ({text.count(chr(10))} rows)")
    return 0


def cmd_select_import(args: argparse.Namespace) -> int:
    from .selection import SelectionError, import_selection

    path = Path(args.path) if args.path else REPO_ROOT / "selections" / f"{args.episode}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"error: {path} not found", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"error: {path} is not valid JSON: {e}", file=sys.stderr)
        return 1
    conn = connect()
    try:
        res = import_selection(conn, args.episode, data)
    except SelectionError as e:
        for err in e.errors:
            print(f"error: {err}", file=sys.stderr)
        print("nothing was written", file=sys.stderr)
        return 1
    for w in res.warnings:
        print(f"warning: {w}", file=sys.stderr)
    print(f"{args.episode}: {len(res.inserted)} new scenes, {len(res.updated)} updated")
    if res.untouched:
        print(f"{len(res.untouched)} scenes in the database are not in this file and were left "
              f"as they are: {', '.join(res.untouched)}")
    return 0


def cmd_render(args: argparse.Namespace) -> int:
    from . import render  # written separately; see docs/media.md

    conn = connect()
    if args.scene:
        scene_ids = list(args.scene)
        known = {r[0] for r in conn.execute(
            f"SELECT id FROM scenes WHERE id IN ({', '.join('?' * len(scene_ids))})", scene_ids)}
        unknown = [s for s in scene_ids if s not in known]
        if unknown:
            print(f"error: unknown scene ids: {', '.join(unknown)}", file=sys.stderr)
            return 1
    else:
        # Every scene, optionally limited to one episode.
        sql = "SELECT id FROM scenes"
        params: list[str] = []
        if args.episode:
            sql += " WHERE episode_id = ?"
            params.append(args.episode)
        scene_ids = [r[0] for r in conn.execute(sql + " ORDER BY id", params)]
    if not scene_ids:
        print("no scenes to render")
        return 0
    result = render.render_scenes(conn, scene_ids, force=args.force)
    if result is not None:
        print(result)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from .server import serve  # see docs/review-ui.md

    return serve(args.port, Path(args.db) if args.db else DB_PATH)


def cmd_annotate_sheet(args: argparse.Namespace) -> int:
    from .annotation import AnnotationError, write_sheets

    conn = connect()
    try:
        written = write_sheets(conn, args.episode, REPO_ROOT / "work" / args.episode)
    except AnnotationError as e:
        for err in e.errors:
            print(f"error: {err}", file=sys.stderr)
        return 1
    for path, n in written:
        print(f"wrote {path.relative_to(REPO_ROOT)} ({n} scenes)")
    return 0


def cmd_annotate_import(args: argparse.Namespace) -> int:
    from .annotation import AnnotationError, import_annotations

    directory = Path(args.dir) if args.dir else REPO_ROOT / "annotations" / args.episode
    conn = connect()
    try:
        res = import_annotations(conn, args.episode, directory, args.by)
    except AnnotationError as e:
        for err in e.errors:
            print(f"error: {err}", file=sys.stderr)
        print("nothing was written", file=sys.stderr)
        return 1
    for w in res.warnings:
        print(f"warning: {w}", file=sys.stderr)
    kinds = ", ".join(f"{k} {n}" for k, n in sorted(res.units_by_kind.items()))
    print(f"{args.episode}: {res.loaded} lines loaded ({res.kept_timings} with unchanged French "
          f"kept their word timings); French differs from the subtitle in {res.fr_changed}; "
          f"{res.words_added:+d} words relative to the subtitles; units: {kinds}; "
          f"notes: " + ", ".join(f"{k} {res.notes_by_kind.get(k, 0)}"
                                 for k in ("reference", "wordplay"))
          + f" in {res.scenes_noted} scenes")
    return 0


def cmd_transcribe(args: argparse.Namespace) -> int:
    from . import transcribe  # see docs/transcription.md

    result = transcribe.transcribe_episode(connect(), args.episode, force=args.force)
    if result is not None:
        print(result)
    return 0


def cmd_align(args: argparse.Namespace) -> int:
    from dataclasses import replace

    from . import forced_align  # see docs/transcription.md

    lines = None
    if args.lines:
        lines = set()
        for part in args.lines.split(","):
            a, _, b = part.partition("-")
            lines.update(range(int(a), int(b or a) + 1))
    guard = forced_align.GUARD
    if args.slack_ms is not None:
        guard = replace(guard, slack_ms=args.slack_ms)
    forced_align.align_episode(connect(), args.episode, force=args.force, guard=guard,
                               lines=lines, confirm=args.confirm)
    return 0


def cmd_retime(args: argparse.Namespace) -> int:
    from .retime import retime_episode  # see docs/pipeline.md

    conn = connect()
    changes, stale = retime_episode(conn, args.episode)
    for c in changes:
        print(f"{c.scene_id}: start {c.start_shift_ms:+d} ms, end {c.end_shift_ms:+d} ms")
    print(f"{args.episode}: {len(changes)} scene cores changed, {len(stale)} scenes need new media")
    if stale and args.render:
        from . import render

        render.render_scenes(conn, stale)
        print(f"re-rendered {len(stale)} scenes")
    elif stale:
        print(f"run: frenchirix render --episode {args.episode}")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    import time

    from .check import ERROR, Checker, connect_readonly, report  # see docs/checks.md

    db = Path(args.db) if args.db else DB_PATH
    try:
        conn = connect_readonly(db)
    except FileNotFoundError:
        print(f"error: {db} not found; the pipeline makes it (frenchirix import <episode>, then the "
              "steps of docs/runbook.md)", file=sys.stderr)
        return 1
    t0 = time.monotonic()
    checker = Checker(conn, Path(args.assets) if args.assets else db.parent, args.episode,
                      not args.no_media)
    findings = checker.run()
    if args.errors_only:
        findings = [f for f in findings if f.severity == ERROR]
    print(report(findings, args.limit))
    print(f"checked {checker.scenes_checked} scenes and {checker.lines_checked} lines of "
          f"{args.episode or 'all episodes'} in {time.monotonic() - t0:.1f} s"
          + (" (media files not checked)" if args.no_media else ""))
    return 1 if any(f.severity == ERROR for f in findings) else 0


def cmd_export_app(args: argparse.Namespace) -> int:
    from .app_export import DEFAULT_OUT, export  # see docs/app-export.md

    scenes = [x for s in (args.scenes or []) for x in s.replace(",", " ").split()]
    try:
        return export(Path(args.out) if args.out else DEFAULT_OUT, data_only=args.data_only,
                      scenes=scenes or None, force=args.force, verify_only=args.verify,
                      jobs=args.jobs, verbose=args.verbose)
    except (RuntimeError, ValueError) as e:  # missing source episodes or render step, data files of another show
        print(f"error: {e}", file=sys.stderr)
        return 1


def cmd_question_sheet(args: argparse.Namespace) -> int:
    from .app_export import connect_readonly, question_sheet  # see docs/app-export.md

    try:
        text = question_sheet(connect_readonly(DB_PATH), args.episode)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    out = REPO_ROOT / "work" / "questions" / f"{args.episode}.sheet.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out.relative_to(REPO_ROOT)} ({text.count(chr(10))} rows)")
    return 0


def cmd_question_sentences(args: argparse.Namespace) -> int:
    from .app_export import question_sentences  # see docs/app-export.md

    try:
        text = question_sentences(args.episode)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    out = REPO_ROOT / "work" / "questions" / f"{args.episode}.sentences.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out.relative_to(REPO_ROOT)} ({text.count(chr(10))} sentences)")
    return 0


def cmd_release_list(args: argparse.Namespace) -> int:
    from .app_export import release_list  # see docs/app-export.md

    return release_list(write=not args.dry_run, everything=args.all, version=args.version)


def cmd_review(args: argparse.Namespace) -> int:
    from .review import MarkError, format_list, list_marks, mark_context, resolve_mark  # docs/review-ui.md

    db = Path(args.db) if args.db else DB_PATH
    if not db.is_file():
        print(f"error: database {db} not found", file=sys.stderr)
        return 1
    conn = connect(db)
    try:
        if args.review_command == "list":
            marks = list_marks(conn, None if args.status == "all" else args.status, args.episode)
            if marks:
                print(format_list(marks))
            print(f"{len(marks)} {'' if args.status == 'all' else args.status + ' '}review "
                  f"mark{'' if len(marks) == 1 else 's'}" + (f" in {args.episode}" if args.episode else ""))
        elif args.review_command == "context":
            sys.stdout.write(mark_context(conn, args.mark_id))
        else:
            m = resolve_mark(conn, args.mark_id, args.status, args.resolution)
            print(f"review mark {m['id']} is {m['status']}")
    except MarkError as e:
        print(f"error: {e.message}", file=sys.stderr)
        return 1
    return 0


def cmd_alternates_sheet(args: argparse.Namespace) -> int:
    from .app_export import alternates_sheets  # see docs/app-content.md

    return alternates_sheets(scope=args.scenes, per_sheet=args.per_sheet)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="frenchirix", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("import", help="probe an episode and import its subtitle tracks")
    s.add_argument("episode", help="episode id, e.g. s01e04")
    s.add_argument("--file", help="source file (default: the one .mkv in content/ whose name contains SxxEyy)")
    s.add_argument("--show", help="the show's title; needed by the first import, later ones reuse it")
    s.set_defaults(func=cmd_import)

    s = sub.add_parser("sheet", help="write work/<episode>/sheet.txt for the scene selector")
    s.add_argument("episode")
    s.set_defaults(func=cmd_sheet)

    s = sub.add_parser("select-import", help="validate a selection JSON and load it into scenes")
    s.add_argument("episode")
    s.add_argument("path", nargs="?", help="default selections/<episode>.json")
    s.set_defaults(func=cmd_select_import)

    s = sub.add_parser("render", help="render scene audio and video")
    s.add_argument("--episode", help="only scenes of this episode")
    s.add_argument("--scene", action="append", help="scene id; may be repeated")
    s.add_argument("--force", action="store_true", help="re-render scenes that already have media")
    s.set_defaults(func=cmd_render)

    s = sub.add_parser("serve", help="the review UI: scenes, their annotation and media, and review "
                                     "marks (127.0.0.1 only)")
    s.add_argument("--port", type=int, default=8765, help="default 8765")
    s.add_argument("--db", help="database file (default assets/db.sqlite)")
    s.set_defaults(func=cmd_serve)

    db_opt = argparse.ArgumentParser(add_help=False)
    db_opt.add_argument("--db", help="database file (default assets/db.sqlite)")
    s = sub.add_parser("review", help="the lines marked for fixing in the review UI")
    rsub = s.add_subparsers(dest="review_command", required=True)
    r = rsub.add_parser("list", parents=[db_opt], help="list review marks")
    r.add_argument("--status", choices=["open", "done", "dismissed", "all"], default="open",
                   help="default open")
    r.add_argument("--episode", help="only marks in this episode's scenes")
    r = rsub.add_parser("context", parents=[db_opt],
                        help="print, as Markdown, everything a fixer needs for one mark")
    r.add_argument("mark_id", type=int)
    r = rsub.add_parser("resolve", parents=[db_opt], help="close a mark with what was done")
    r.add_argument("mark_id", type=int)
    r.add_argument("--status", choices=["done", "dismissed"], required=True)
    r.add_argument("--resolution", required=True, help="what was done, or why the mark is dismissed")
    s.set_defaults(func=cmd_review)

    s = sub.add_parser("transcribe", help="speech recognition on the French audio")
    s.add_argument("episode")
    s.add_argument("--force", action="store_true", help="transcribe again")
    s.set_defaults(func=cmd_transcribe)

    s = sub.add_parser("annotate-sheet", help="write work/<episode>/annotate-NN.txt for annotators")
    s.add_argument("episode")
    s.set_defaults(func=cmd_annotate_sheet)

    s = sub.add_parser("annotate-import", help="validate and load annotations/<episode>/*.jsonl")
    s.add_argument("episode")
    s.add_argument("--dir", help="default annotations/<episode>")
    s.add_argument("--by", default="sonnet:annotate-v1",
                   help="value for lines.annotated_by (default sonnet:annotate-v1)")
    s.set_defaults(func=cmd_annotate_import)

    s = sub.add_parser("align", help="align the final French against the audio")
    s.add_argument("episode")
    s.add_argument("--force", action="store_true", help="align again")
    s.add_argument("--lines", help="re-align only these lines (lines.idx), e.g. 19-26 or 20,24; "
                                   "all other lines keep their times")
    s.add_argument("--slack-ms", type=int, help="how far from its subtitle a line may be placed "
                                                "(default 2500); small values stop a line sliding to "
                                                "a repeat of its words")
    s.add_argument("--confirm", action="store_true",
                   help="accept a low-scoring placement when the recogniser, prompted with the "
                        "line, hears all its words in a row, each with probability at least 0.5, "
                        "and their starts agree with it: median difference at most 100 ms, at "
                        "least 75%% within 150 ms, none beyond 1000 ms (recorded in meta)")
    s.set_defaults(func=cmd_align)

    s = sub.add_parser("retime", help="widen scene cores to cover the aligned speech")
    s.add_argument("episode")
    s.add_argument("--render", action="store_true", help="re-render the scenes whose clip changed")
    s.set_defaults(func=cmd_retime)

    s = sub.add_parser("check", help="sanity-check the database and media; exit 1 on errors")
    s.add_argument("--episode", help="only this episode's scenes")
    s.add_argument("--no-media", action="store_true",
                   help="do not look for media files on disk (for a clone without media)")
    s.add_argument("--limit", type=int, help="print at most this many findings per check")
    s.add_argument("--errors-only", action="store_true", help="leave warnings out")
    s.add_argument("--db", help="database file (default assets/db.sqlite)")
    s.add_argument("--assets", help="directory holding audio/ and video/ (default: the database's directory)")
    s.set_defaults(func=cmd_check)

    s = sub.add_parser("export-app", help="write the app's content bundle (JSON and media)")
    s.add_argument("--out", help="output directory (default app/public)")
    s.add_argument("--data-only", action="store_true",
                   help="JSON only: needs neither content/ nor ffmpeg")
    s.add_argument("--scenes", action="append", help="limit media work to these scene ids")
    s.add_argument("--force", action="store_true", help="rebuild media even when up to date")
    s.add_argument("--verify", action="store_true", help="only check the bundle on disk")
    s.add_argument("--jobs", type=int, help="parallel media workers (default cpu_count / 2)")
    s.add_argument("--verbose", action="store_true", help="list every line whose word times were replaced")
    s.set_defaults(func=cmd_export_app)

    s = sub.add_parser("question-sheet", help="write work/questions/<episode>.sheet.md")
    s.add_argument("episode")
    s.set_defaults(func=cmd_question_sheet)

    s = sub.add_parser("release-list", help="choose the release scenes and write app/data/release.json")
    s.add_argument("--dry-run", action="store_true", help="print the choice, write nothing")
    s.add_argument("--all", action="store_true", help="release every scene instead of choosing")
    s.add_argument("--version", default="2.1.0", help="the app version written into release.json")
    s.set_defaults(func=cmd_release_list)

    s = sub.add_parser("alternates-sheet",
                       help="write work/alternates/sheet-<n>.md for lines that still need alternates")
    s.add_argument("--scenes", choices=["all", "release"], default="all",
                   help="which scenes to cover (default: all)")
    s.add_argument("--per-sheet", type=int, default=10, help="scenes per sheet (default: 10)")
    s.set_defaults(func=cmd_alternates_sheet)

    s = sub.add_parser("question-sentences",
                       help="write work/questions/<episode>.sentences.md for the unit writers")
    s.add_argument("episode")
    s.set_defaults(func=cmd_question_sentences)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
