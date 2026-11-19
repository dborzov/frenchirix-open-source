"""`frenchirix check`: a sanity check of the database and the scene media.

Finds what a program can find: missing, empty, inconsistent or impossible data
(errors) and things that are probably fine but worth a look (warnings). It reads
the database and the media directories and never writes. What each check means and
what to do about it is in docs/checks.md.

Standard library only; fast enough to run before every commit (no media decoding).
"""

from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, fields
from pathlib import Path

from .db import SCHEMA_VERSION
from .render import RENDER_VERSION, ClipWindow, RenderSettings, frame_times
from .text import split_words

ERROR = "error"
WARNING = "warning"

# Every check: name -> (severity, what it reports). Names are stable; docs/checks.md
# explains each one.
CHECKS: dict[str, tuple[str, str]] = {
    "db.integrity": (ERROR, "PRAGMA integrity_check reports a problem"),
    "db.foreign_keys": (ERROR, "a row points at a parent row that does not exist"),
    "db.schema_version": (ERROR, "the schema version is not the current one"),
    "db.dangling": (ERROR, "words, units or notes hang off a missing or unannotated line or scene"),
    "scene.id": (ERROR, "the scene id does not match its episode and line range"),
    "scene.lines": (ERROR, "a line of the scene's range does not exist"),
    "scene.core": (ERROR, "the core is empty or narrower than the subtitles of its first and last line"),
    "scene.core_wide": (WARNING, "the core reaches more than 2.5 s beyond the subtitles"),
    "scene.fields": (ERROR, "title, kind, score, why, selected_by or created_at missing or invalid"),
    "scene.tags": (ERROR, "tags is not a JSON list of non-empty strings"),
    "scene.group_split": (ERROR, "the scene splits a translation group"),
    "scene.kind_song": (WARNING, "kind and the lines' song flags disagree"),
    "media.window": (ERROR, "the clip window or fades are missing or do not contain the core"),
    "media.pending": (ERROR, "render_params is NULL: the media do not match the scene and must be re-rendered"),
    "media.stale": (ERROR, "the clip window is not what the render settings give for the current core"),
    "media.frames": (ERROR, "frame_times_ms does not parse, increase, fit the clip or match the settings"),
    "media.files": (ERROR, "an audio or video file is unset, missing or empty"),
    "media.file_name": (WARNING, "a media file is not named after its scene"),
    "media.render_version": (WARNING, "rendered by an older version of the render step"),
    "media.silent": (WARNING, "the audio clip measured as digital silence"),
    "media.orphan": (WARNING, "a file in assets/audio or assets/video belongs to no scene"),
    "text.missing": (ERROR, "a line has an empty subtitle, final French or literal English"),
    "text.translation": (ERROR, "a line's translation group has no English row covering it"),
    "text.same_as_fr": (WARNING, "the literal English of a line of 3 or more words is the same as the French"),
    "text.length": (WARNING, "the final French is much longer or shorter than the subtitle"),
    "text.shape": (WARNING, "the final French has a different number of line breaks than the subtitle"),
    "text.whitespace": (WARNING, "a text has leading, trailing or doubled spaces"),
    "text.annotated_by": (WARNING, "a line has final French but no annotated_by"),
    "text.unused": (WARNING, "an annotated line belongs to no scene"),
    "words.tokens": (ERROR, "the words rows are not exactly split_words(fr_final)"),
    "words.untimed": (ERROR, "a word has no start or end time"),
    "words.order": (ERROR, "a word ends before it starts, or overlaps or precedes the word before it"),
    "words.across_lines": (ERROR, "a line's words start before the previous line of the scene ends"),
    "words.outside_clip": (ERROR, "a word lies outside the scene's clip window"),
    "words.line_audio": (ERROR, "audio_start_ms/audio_end_ms disagree with the first and last word"),
    "words.score": (ERROR, "a word score is outside 0..1"),
    "units.cover": (ERROR, "the units do not cover the line's words exactly once, in order"),
    "units.kind": (ERROR, "a unit's kind is not word or expression"),
    "units.gloss": (ERROR, "a unit has an empty English gloss"),
    "units.text": (ERROR, "a unit's text is not its span of the final French"),
    "units.line_break": (ERROR, "a unit crosses a line break"),
    "units.note": (WARNING, "a unit's note is blank instead of NULL"),
    "note.kind": (ERROR, "a note's kind is not reference or wordplay"),
    "note.text": (ERROR, "a note's text is empty"),
    "note.phrase": (ERROR, "phrase, line and span are inconsistent, or the line is not in the scene"),
    "note.span": (ERROR, "a note's word span does not spell its phrase"),
    "note.order": (WARNING, "a scene's notes are not numbered 1..n"),
    "note.unlocated": (WARNING, "a note's phrase could not be located in its line"),
    "timing.unreliable": (WARNING, "the aligner marked the line unreliable (every word score 0.0)"),
    "timing.fade": (WARNING, "the first line starts inside the fade-in or the last line ends inside the fade-out"),
    "timing.far": (WARNING, "the line is spoken more than 2.5 s from its subtitle"),
}

SCENE_KINDS = ("dialogue", "monologue", "song")
UNIT_KINDS = ("word", "expression")
NOTE_KINDS = ("reference", "wordplay")
MAX_CORE_WIDENING_MS = 2500  # RetimeSettings.max_shift_ms
GUARD_SLACK_MS = 2500  # GuardSettings.slack_ms in forced_align.py
MEDIA_END_TAIL_MS = 60_000  # render.media_end_ms reads this much of the episode's end
# text.length: warn when the final French has fewer than LENGTH_MIN_RATIO times the
# subtitle's words, or more than LENGTH_MAX_RATIO times plus LENGTH_SLACK words.
LENGTH_MIN_RATIO = 0.5
LENGTH_MAX_RATIO = 2.0
LENGTH_SLACK = 3
# text.same_as_fr: shorter lines are mostly names and interjections, the same in both.
SAME_MIN_WORDS = 3


@dataclass
class Finding:
    severity: str
    check: str
    message: str
    episode: str | None = None
    scene: str | None = None
    line: int | None = None

    def format(self) -> str:
        line = f"{self.line:04d}" if self.line is not None else "-"
        return (f"{self.severity:<7} {self.check:<20} {self.episode or '-':<6} "
                f"{self.scene or '-':<16} {line:<4}  {self.message}")


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in text if not unicodedata.combining(ch)).replace("’", "'")


def _plain(text: str) -> str:
    """Lower case, punctuation removed, whitespace collapsed: for comparing two texts."""
    return " ".join(re.sub(r"[^\w']+", " ", _fold(text)).split())


def _blank(value) -> bool:
    return value is None or not str(value).strip()


def _render_settings(params: dict) -> RenderSettings:
    names = {f.name for f in fields(RenderSettings)}
    return RenderSettings(**{k: v for k, v in params.items() if k in names})


class Checker:
    def __init__(self, conn: sqlite3.Connection, assets_dir: Path, episode: str | None,
                 media: bool):
        self.conn = conn
        self.assets_dir = assets_dir
        self.episode = episode
        self.media = media
        self.findings: list[Finding] = []
        self.scenes_checked = 0
        self.lines_checked = 0

    def add(self, check: str, message: str, episode: str | None = None,
            scene: str | None = None, line: int | None = None) -> None:
        self.findings.append(Finding(CHECKS[check][0], check, message, episode, scene, line))

    def q(self, sql: str, params=()) -> list[sqlite3.Row]:
        return self.conn.execute(sql, params).fetchall()

    def ep_filter(self, column: str) -> tuple[str, tuple]:
        return (f" WHERE {column} = ?", (self.episode,)) if self.episode else ("", ())

    # ------------------------------------------------------------------ database

    def check_database(self) -> bool:
        """Database-level checks. False when the schema is too far off to go on."""
        rows = [r[0] for r in self.q("PRAGMA integrity_check")]
        if rows != ["ok"]:
            for r in rows[:20]:
                self.add("db.integrity", r)
        for table, rowid, parent, _ in self.q("PRAGMA foreign_key_check"):
            self.add("db.foreign_keys", f"{table} rowid {rowid} points at a missing {parent} row")
        has_meta = self.q("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
        version = None
        if has_meta:
            row = self.q("SELECT value FROM meta WHERE key = 'schema_version'")
            version = row[0][0] if row else None
        if version != SCHEMA_VERSION:
            self.add("db.schema_version", f"schema version is {version!r}, expected {SCHEMA_VERSION!r}; "
                     "open the database with frenchirix.db.connect() to migrate it")
            return False
        return True

    def check_dangling(self) -> None:
        f, p = self.ep_filter("l.episode_id")
        for table in ("words", "units"):
            for r in self.q(f"SELECT t.line_id, COUNT(*) FROM {table} t LEFT JOIN lines l ON l.id = t.line_id "
                            "WHERE l.id IS NULL GROUP BY t.line_id"):
                self.add("db.dangling", f"{r[1]} {table} rows for line {r[0]}, which does not exist")
            where = f.replace("WHERE", "AND") if f else ""
            for r in self.q(f"SELECT l.episode_id, l.idx, COUNT(*) FROM {table} t JOIN lines l ON l.id = t.line_id "
                            f"WHERE l.fr_final IS NULL {where} GROUP BY l.id", p):
                self.add("db.dangling", f"{r[2]} {table} rows for a line with no final French", r[0], None, r[1])
        for r in self.q("SELECT x.scene_id, COUNT(*) FROM notes x LEFT JOIN scenes s ON s.id = x.scene_id "
                        "WHERE s.id IS NULL GROUP BY x.scene_id"):
            self.add("db.dangling", f"{r[1]} notes for scene {r[0]}, which does not exist")
        for r in self.q("SELECT x.scene_id, x.idx, x.line_id FROM notes x LEFT JOIN lines l "
                        "ON l.id = x.line_id WHERE x.line_id IS NOT NULL AND l.id IS NULL"):
            self.add("db.dangling", f"note {r[1]} points at line {r[2]}, which does not exist",
                     None, r[0])

    # ------------------------------------------------------------------ loading

    def load(self) -> None:
        f, p = self.ep_filter("episode_id")
        self.episodes = {r["id"]: r for r in self.q(
            "SELECT * FROM episodes" + (" WHERE id = ?" if self.episode else ""), p)}
        self.scenes = self.q("SELECT * FROM scenes" + f + " ORDER BY episode_id, first_line_idx, id", p)
        self.lines = {(r["episode_id"], r["idx"]): r for r in self.q("SELECT * FROM lines" + f, p)}
        self.lines_by_id = {r["id"]: r for r in self.lines.values()}
        lf, lp = self.ep_filter("l.episode_id")
        self.words: dict[str, list] = defaultdict(list)
        for r in self.q("SELECT w.* FROM words w JOIN lines l ON l.id = w.line_id" + lf + " ORDER BY w.line_id, w.idx", lp):
            self.words[r["line_id"]].append(r)
        self.units: dict[str, list] = defaultdict(list)
        for r in self.q("SELECT u.* FROM units u JOIN lines l ON l.id = u.line_id" + lf + " ORDER BY u.line_id, u.idx", lp):
            self.units[r["line_id"]].append(r)
        sf, sp = self.ep_filter("s.episode_id")
        self.notes: dict[str, list] = defaultdict(list)
        for r in self.q("SELECT x.* FROM notes x JOIN scenes s ON s.id = x.scene_id" + sf
                        + " ORDER BY x.scene_id, x.idx", sp):
            self.notes[r["scene_id"]].append(r)
        self.translations: dict[tuple[str, int], sqlite3.Row] = {
            (r["episode_id"], r["group_idx"]): r
            for r in self.q("SELECT * FROM translations WHERE lang = 'en'"
                            + (" AND episode_id = ?" if self.episode else ""), p)}

    # ------------------------------------------------------------------ scenes

    def check_scene(self, s) -> list:
        """Scene-level checks; returns the scene's lines that exist, in order."""
        sid, ep, first, last = s["id"], s["episode_id"], s["first_line_idx"], s["last_line_idx"]
        if sid != f"{ep}-{first:04d}-{last:04d}":
            self.add("scene.id", f"id does not match episode {ep} lines {first}..{last}", ep, sid)
        lines = []
        for idx in range(first, last + 1):
            line = self.lines.get((ep, idx))
            if line is None:
                self.add("scene.lines", f"line {idx} of the range does not exist", ep, sid, idx)
            else:
                lines.append(line)
        cs, ce = s["core_start_ms"], s["core_end_ms"]
        if ce <= cs:
            self.add("scene.core", f"core {cs}..{ce} ms has no positive length", ep, sid)
        if lines and lines[0]["idx"] == first and lines[-1]["idx"] == last:
            sub_start, sub_end = lines[0]["start_ms"], lines[-1]["end_ms"]
            if cs > sub_start or ce < sub_end:
                self.add("scene.core", f"core {cs}..{ce} ms is narrower than the subtitles {sub_start}..{sub_end} ms",
                         ep, sid)
            elif sub_start - cs > MAX_CORE_WIDENING_MS or ce - sub_end > MAX_CORE_WIDENING_MS:
                self.add("scene.core_wide", f"core {cs}..{ce} ms reaches {sub_start - cs} ms before and "
                         f"{ce - sub_end} ms after the subtitles", ep, sid)
        problems = []
        if _blank(s["title"]):
            problems.append("empty title")
        if s["kind"] not in SCENE_KINDS:
            problems.append(f"kind {s['kind']!r}")
        if not isinstance(s["score"], int) or not 1 <= s["score"] <= 5:
            problems.append(f"score {s['score']!r}")
        if _blank(s["why"]):
            problems.append("empty why")
        if _blank(s["selected_by"]):
            problems.append("empty selected_by")
        if _blank(s["created_at"]):
            problems.append("empty created_at")
        if problems:
            self.add("scene.fields", ", ".join(problems), ep, sid)
        try:
            tags = json.loads(s["tags"])
            ok = isinstance(tags, list) and all(isinstance(t, str) and t.strip() for t in tags)
        except (TypeError, ValueError):
            ok = False
        if not ok:
            self.add("scene.tags", f"tags {s['tags']!r} is not a JSON list of non-empty strings", ep, sid)
        before, after = self.lines.get((ep, first - 1)), self.lines.get((ep, last + 1))
        if lines and before is not None and lines[0]["idx"] == first and before["group_idx"] == lines[0]["group_idx"]:
            self.add("scene.group_split", f"line {first} shares translation group {before['group_idx']} "
                     f"with line {first - 1}, outside the scene", ep, sid, first)
        if lines and after is not None and lines[-1]["idx"] == last and after["group_idx"] == lines[-1]["group_idx"]:
            self.add("scene.group_split", f"line {last} shares translation group {after['group_idx']} "
                     f"with line {last + 1}, outside the scene", ep, sid, last)
        if lines:
            songs = sum(1 for l in lines if l["is_song"])
            if s["kind"] == "song" and songs == 0:
                self.add("scene.kind_song", "kind is song but no line is sung", ep, sid)
            elif s["kind"] != "song" and songs == len(lines):
                self.add("scene.kind_song", f"every line is sung but kind is {s['kind']}", ep, sid)
        return lines

    # ------------------------------------------------------------------ media

    def check_media(self, s) -> bool:
        """Media checks. True when the clip window is usable for the timing checks."""
        sid, ep = s["id"], s["episode_id"]
        cs, ce = s["core_start_ms"], s["core_end_ms"]
        a, b, fi, fo = s["clip_start_ms"], s["clip_end_ms"], s["fade_in_ms"], s["fade_out_ms"]
        window_ok = False
        if a is None or b is None or fi is None or fo is None:
            missing = [n for n, v in (("clip_start_ms", a), ("clip_end_ms", b), ("fade_in_ms", fi),
                                      ("fade_out_ms", fo)) if v is None]
            self.add("media.window", f"{', '.join(missing)} not set: the scene has never been rendered", ep, sid)
        elif not (a <= cs and ce <= b):
            self.add("media.window", f"clip {a}..{b} ms does not contain the core {cs}..{ce} ms", ep, sid)
        elif fi < 0 or fo < 0 or fi + fo > b - a:
            self.add("media.window", f"fades {fi} and {fo} ms do not fit the {b - a} ms clip", ep, sid)
        else:
            window_ok = True
            if a < 0 or b > self.episodes[ep]["duration_ms"]:
                self.add("media.window", f"clip {a}..{b} ms runs outside the episode", ep, sid)

        params = None
        if s["render_params"] is None:
            self.add("media.pending", "render_params is NULL: re-render with "
                     f"`frenchirix render --episode {ep}`", ep, sid)
        else:
            try:
                params = json.loads(s["render_params"])
                if not isinstance(params, dict):
                    raise ValueError
            except ValueError:
                self.add("media.stale", "render_params is not a JSON object", ep, sid)
                params = None
            if params is not None and params.get("render_version") != RENDER_VERSION:
                self.add("media.render_version", f"render_version {params.get('render_version')!r}, "
                         f"current is {RENDER_VERSION}", ep, sid)
        settings = _render_settings(params) if params is not None else RenderSettings()

        if window_ok and params is not None:
            pad, guard = settings.padding_ms, settings.guard_ms
            want_a = max(0, cs - pad)
            duration = self.episodes[ep]["duration_ms"]
            if b < ce + pad and duration - MEDIA_END_TAIL_MS <= b <= duration:
                want_b = b  # clamped to where the episode's audio and video end
            else:
                want_b = min(duration, ce + pad)
            want = (want_a, want_b, max(0, cs - want_a - guard), max(0, want_b - ce - guard))
            if want != (a, b, fi, fo):
                self.add("media.stale", f"clip {a}..{b} ms with fades {fi}/{fo} ms, but the core "
                         f"{cs}..{ce} ms gives {want[0]}..{want[1]} with {want[2]}/{want[3]}; "
                         "render_params should be NULL (run retime)", ep, sid)

        if s["frame_times_ms"] is None:
            if a is not None:
                self.add("media.frames", "frame_times_ms is not set", ep, sid)
        else:
            try:
                times = json.loads(s["frame_times_ms"])
                if not isinstance(times, list) or not all(isinstance(t, int) for t in times):
                    raise ValueError
            except ValueError:
                self.add("media.frames", f"frame_times_ms {s['frame_times_ms'][:60]!r} is not a JSON list of integers",
                         ep, sid)
                times = None
            if times is not None:
                if not times or times[0] != 0:
                    self.add("media.frames", "the first frame is not at 0", ep, sid)
                elif any(y <= x for x, y in zip(times, times[1:])):
                    self.add("media.frames", "frame times do not increase", ep, sid)
                elif window_ok and times[-1] >= b - a:
                    self.add("media.frames", f"last frame at {times[-1]} ms is not inside the {b - a} ms clip",
                             ep, sid)
                elif window_ok and params is not None:
                    want = frame_times(ClipWindow(a, b, fi, fo), cs, settings)
                    if times != want:
                        self.add("media.frames", f"frame times {times} differ from {want}, what the render "
                                 "settings give for this clip and core", ep, sid)

        for kind, column, ext in (("audio", "audio_file", "opus"), ("video", "video_file", "mp4")):
            rel = s[column]
            if rel is None:
                self.add("media.files", f"{column} is not set", ep, sid)
                continue
            if rel != f"{kind}/{sid}.{ext}":
                self.add("media.file_name", f"{column} is {rel!r}, expected {kind}/{sid}.{ext}", ep, sid)
            if self.media:
                path = self.assets_dir / rel
                if not path.is_file():
                    self.add("media.files", f"{kind} file assets/{rel} does not exist", ep, sid)
                elif path.stat().st_size == 0:
                    self.add("media.files", f"{kind} file assets/{rel} is empty", ep, sid)
        if s["render_params"] is not None and s["audio_peak_db"] is None:
            self.add("media.silent", "audio_peak_db is NULL: the clip measured as digital silence", ep, sid)
        return window_ok

    def check_orphans(self) -> None:
        referenced = set()
        for s in self.scenes:
            referenced.update(x for x in (s["audio_file"], s["video_file"]) if x)
        if self.episode:  # scenes of other episodes are not loaded
            referenced.update(r[0] for r in self.q("SELECT audio_file FROM scenes WHERE audio_file IS NOT NULL"))
            referenced.update(r[0] for r in self.q("SELECT video_file FROM scenes WHERE video_file IS NOT NULL"))
        for sub in ("audio", "video"):
            d = self.assets_dir / sub
            if not d.is_dir():
                continue
            for path in sorted(d.iterdir()):
                if self.episode and not path.name.startswith(self.episode):
                    continue
                rel = f"{sub}/{path.name}"
                if rel not in referenced:
                    what = "directory" if path.is_dir() else "file"
                    self.add("media.orphan", f"{what} assets/{rel} belongs to no scene",
                             path.name[:6] if re.match(r"s\d\de\d\d", path.name) else None)
        for path in sorted(self.assets_dir.glob(".render-*")) if self.assets_dir.is_dir() else []:
            if not self.episode or path.name.startswith(f".render-{self.episode}"):
                self.add("media.orphan", f"leftover render directory assets/{path.name}")

    # ------------------------------------------------------------------ lines

    def check_line(self, line, sid: str) -> None:
        """Checks that depend only on the line, done once per line."""
        ep, idx = line["episode_id"], line["idx"]
        fr, final, en = line["fr"], line["fr_final"], line["en_literal"]
        empty = [n for n, v in (("subtitle text", fr), ("final French", final), ("literal English", en))
                 if _blank(v)]
        if empty:
            self.add("text.missing", f"empty {', '.join(empty)}", ep, sid, idx)
        tr = self.translations.get((ep, line["group_idx"]))
        if tr is None or not tr["first_line_idx"] <= idx <= tr["last_line_idx"]:
            self.add("text.translation", f"translation group {line['group_idx']} has no English row "
                     "covering this line", ep, sid, idx)
        if not _blank(final) and _blank(line["annotated_by"]):
            self.add("text.annotated_by", "final French is set but annotated_by is NULL", ep, sid, idx)
        for name, text in (("final French", final), ("literal English", en)):
            if not _blank(text) and any(t != t.strip() or "  " in t for t in text.split("\n")):
                self.add("text.whitespace", f"{name} {text!r} has leading, trailing or doubled spaces",
                         ep, sid, idx)
        if (not _blank(final) and not _blank(en) and _plain(final) == _plain(en)
                and len(split_words(final)) >= SAME_MIN_WORDS):
            self.add("text.same_as_fr", f"literal English {en!r} is the same as the French", ep, sid, idx)
        if not _blank(final) and not _blank(fr):
            n_sub, n_fin = len(split_words(fr)), len(split_words(final))
            if n_fin < LENGTH_MIN_RATIO * n_sub or n_fin > LENGTH_MAX_RATIO * n_sub + LENGTH_SLACK:
                self.add("text.length", f"final French has {n_fin} words, the subtitle {n_sub}: "
                         f"{final!r} for {fr!r}", ep, sid, idx)
            if final.count("\n") != fr.count("\n"):
                self.add("text.shape", f"final French has {final.count(chr(10))} line breaks, the subtitle "
                         f"{fr.count(chr(10))}", ep, sid, idx)
        if final is None:
            return
        self.check_words(line, sid)
        self.check_units(line, sid)

    def check_words(self, line, sid: str) -> None:
        ep, idx, final = line["episode_id"], line["idx"], line["fr_final"]
        rows = self.words.get(line["id"], [])
        want = split_words(final)
        got = [(w["text"], w["char_start"], w["char_end"]) for w in rows]
        if [w["idx"] for w in rows] != list(range(1, len(rows) + 1)):
            self.add("words.tokens", f"word numbers are {[w['idx'] for w in rows]}, not 1..{len(rows)}",
                     ep, sid, idx)
        elif got != want:
            n = next((i for i, (g, w) in enumerate(zip(got, want)) if g != w), min(len(got), len(want)))
            g = got[n] if n < len(got) else "nothing"
            w = want[n] if n < len(want) else "nothing"
            self.add("words.tokens", f"{len(got)} word rows, split_words gives {len(want)}; "
                     f"word {n + 1} is {g} but should be {w}", ep, sid, idx)
        if not want:
            self.add("words.tokens", f"final French {final!r} has no words", ep, sid, idx)
        if not rows:
            return
        untimed = [w["idx"] for w in rows if w["start_ms"] is None or w["end_ms"] is None]
        if untimed:
            self.add("words.untimed", f"{len(untimed)} of {len(rows)} words have no time "
                     f"(first: word {untimed[0]}); run `frenchirix align {ep}`", ep, sid, idx)
        timed = [w for w in rows if w["start_ms"] is not None and w["end_ms"] is not None]
        for w in timed:
            if w["end_ms"] <= w["start_ms"]:
                self.add("words.order", f"word {w['idx']} {w['text']!r} runs {w['start_ms']}..{w['end_ms']} ms",
                         ep, sid, idx)
                break
        for p, w in zip(timed, timed[1:]):
            if w["start_ms"] < p["end_ms"]:
                self.add("words.order", f"word {w['idx']} starts at {w['start_ms']} ms, before word "
                         f"{p['idx']} ends at {p['end_ms']} ms", ep, sid, idx)
                break
        bad = [w for w in rows if w["score"] is not None and not 0.0 <= w["score"] <= 1.0]
        if bad:
            self.add("words.score", f"word {bad[0]['idx']} has score {bad[0]['score']}", ep, sid, idx)
        if not untimed:
            first, last = rows[0]["start_ms"], rows[-1]["end_ms"]
            if (line["audio_start_ms"], line["audio_end_ms"]) != (first, last):
                self.add("words.line_audio", f"audio_start_ms/audio_end_ms are {line['audio_start_ms']}/"
                         f"{line['audio_end_ms']}, the words run {first}..{last}", ep, sid, idx)
            scores = [w["score"] for w in rows]
            if all(sc == 0.0 for sc in scores):
                self.add("timing.unreliable", "every word scores 0.0: the times are a guess at the subtitle",
                         ep, sid, idx)
            if first < line["start_ms"] - GUARD_SLACK_MS or last > line["end_ms"] + GUARD_SLACK_MS:
                self.add("timing.far", f"spoken {first}..{last} ms, subtitle {line['start_ms']}..{line['end_ms']} ms",
                         ep, sid, idx)
        elif line["audio_start_ms"] is not None or line["audio_end_ms"] is not None:
            self.add("words.line_audio", "line has audio times but some words are untimed", ep, sid, idx)

    def check_units(self, line, sid: str) -> None:
        ep, idx, final = line["episode_id"], line["idx"], line["fr_final"]
        rows = self.units.get(line["id"], [])
        words = self.words.get(line["id"], [])
        n_words = len(words)
        problem = None
        if [u["idx"] for u in rows] != list(range(1, len(rows) + 1)):
            problem = f"unit numbers are {[u['idx'] for u in rows]}, not 1..{len(rows)}"
        else:
            pos = 0
            for u in rows:
                if u["first_word_idx"] != pos + 1 or u["last_word_idx"] < u["first_word_idx"]:
                    what = "gap before" if u["first_word_idx"] > pos + 1 else "overlap at"
                    problem = (f"unit {u['idx']} covers words {u['first_word_idx']}..{u['last_word_idx']}: "
                               f"{what} word {pos + 1}")
                    break
                pos = u["last_word_idx"]
            else:
                if pos != n_words:
                    problem = (f"units cover words 1..{pos}, the line has {n_words}" if rows
                               else f"no units for {n_words} words")
        if problem:
            self.add("units.cover", problem, ep, sid, idx)
        by_idx = {w["idx"]: w for w in words}
        for u in rows:
            if u["kind"] not in UNIT_KINDS:
                self.add("units.kind", f"unit {u['idx']} has kind {u['kind']!r}", ep, sid, idx)
            if _blank(u["en"]):
                self.add("units.gloss", f"unit {u['idx']} {u['text']!r} has an empty gloss", ep, sid, idx)
            if u["note"] is not None and not u["note"].strip():
                self.add("units.note", f"unit {u['idx']} has a blank note", ep, sid, idx)
            a, b = by_idx.get(u["first_word_idx"]), by_idx.get(u["last_word_idx"])
            if a is not None and b is not None:
                span = final[a["char_start"]:b["char_end"]]
                if u["text"] != span:
                    self.add("units.text", f"unit {u['idx']} text {u['text']!r}, its words spell {span!r}",
                             ep, sid, idx)
                elif "\n" in span:
                    self.add("units.line_break", f"unit {u['idx']} {span!r} crosses a line break", ep, sid, idx)

    # ------------------------------------------------------------------ scene timing

    def check_scene_timing(self, s, lines: list, window_ok: bool) -> None:
        sid, ep = s["id"], s["episode_id"]
        prev = None
        for line in lines:
            ws = self.words.get(line["id"], [])
            if not ws or any(w["start_ms"] is None or w["end_ms"] is None for w in ws):
                prev = None
                continue
            start, end = ws[0]["start_ms"], ws[-1]["end_ms"]
            if prev is not None and start < prev[1]:
                self.add("words.across_lines", f"line starts at {start} ms, before line {prev[0]} ends at "
                         f"{prev[1]} ms", ep, sid, line["idx"])
            prev = (line["idx"], end)
            if window_ok:
                a, b = s["clip_start_ms"], s["clip_end_ms"]
                lo = min(w["start_ms"] for w in ws)
                hi = max(w["end_ms"] for w in ws)
                if lo < a or hi > b:
                    self.add("words.outside_clip", f"words run {lo}..{hi} ms, the clip is {a}..{b} ms",
                             ep, sid, line["idx"])
        if not window_ok or not lines:
            return
        a, b, fi, fo = s["clip_start_ms"], s["clip_end_ms"], s["fade_in_ms"], s["fade_out_ms"]
        first, last = lines[0], lines[-1]
        if first["audio_start_ms"] is not None and first["audio_start_ms"] < a + fi:
            self.add("timing.fade", f"first line starts {a + fi - first['audio_start_ms']} ms inside the fade-in",
                     ep, sid, first["idx"])
        if last["audio_end_ms"] is not None and last["audio_end_ms"] > b - fo:
            self.add("timing.fade", f"last line ends {last['audio_end_ms'] - (b - fo)} ms inside the fade-out",
                     ep, sid, last["idx"])

    # ------------------------------------------------------------------ notes

    def check_notes(self, s) -> None:
        sid, ep, first, last = s["id"], s["episode_id"], s["first_line_idx"], s["last_line_idx"]
        rows = self.notes.get(sid, [])
        if [x["idx"] for x in rows] != list(range(1, len(rows) + 1)):
            self.add("note.order", f"notes are numbered {[x['idx'] for x in rows]}", ep, sid)
        by_id = self.lines_by_id
        for x in rows:
            n = x["idx"]
            if x["kind"] not in NOTE_KINDS:
                self.add("note.kind", f"note {n} has kind {x['kind']!r}", ep, sid)
            if _blank(x["text"]):
                self.add("note.text", f"note {n} has empty text", ep, sid)
            phrase, lid = x["phrase"], x["line_id"]
            fw, lw = x["first_word_idx"], x["last_word_idx"]
            line = by_id.get(lid) if lid else None
            idx = line["idx"] if line is not None else None
            if (phrase is None) != (lid is None):
                self.add("note.phrase", f"note {n} has a phrase without a line or a line without a phrase",
                         ep, sid, idx)
                continue
            if (fw is None) != (lw is None) or (fw is not None and lid is None):
                self.add("note.phrase", f"note {n} has an incomplete word span {fw}..{lw}", ep, sid, idx)
                continue
            if lid is None:
                continue
            if _blank(phrase):
                self.add("note.phrase", f"note {n} has an empty phrase", ep, sid, idx)
                continue
            if line is None:
                continue  # db.dangling reports it
            if line["episode_id"] != ep or not first <= line["idx"] <= last:
                self.add("note.phrase", f"note {n} points at line {lid}, outside the scene", ep, sid, idx)
                continue
            if fw is None:
                self.add("note.unlocated", f"note {n}: phrase {phrase!r} was not located in the line",
                         ep, sid, idx)
                continue
            words = {w["idx"]: w["text"] for w in self.words.get(lid, [])}
            if not (1 <= fw <= lw and lw in words and fw in words):
                self.add("note.span", f"note {n} spans words {fw}..{lw}, the line has {len(words)}",
                         ep, sid, idx)
                continue
            span = [_fold(words[i]) for i in range(fw, lw + 1)]
            want = [_fold(w) for w, _, _ in split_words(phrase)]
            if span != want:
                self.add("note.span", f"note {n}: words {fw}..{lw} are {' '.join(span)!r}, the phrase is "
                         f"{phrase!r}", ep, sid, idx)

    # ------------------------------------------------------------------ run

    def run(self) -> list[Finding]:
        if not self.check_database():
            return self.findings
        self.check_dangling()
        self.load()
        seen_lines: set[str] = set()
        for s in self.scenes:
            self.scenes_checked += 1
            lines = self.check_scene(s)
            window_ok = self.check_media(s)
            self.lines_checked += sum(1 for l in lines if l["id"] not in seen_lines)
            for line in lines:
                if line["id"] not in seen_lines:
                    seen_lines.add(line["id"])
                    self.check_line(line, s["id"])
            self.check_scene_timing(s, lines, window_ok)
            self.check_notes(s)
        for line in self.lines.values():
            if line["fr_final"] is not None and line["id"] not in seen_lines:
                self.add("text.unused", "line is annotated but belongs to no scene",
                         line["episode_id"], None, line["idx"])
        if self.media:
            self.check_orphans()
        return self.findings


def connect_readonly(path: Path) -> sqlite3.Connection:
    """Open the database without the migration `db.connect` does, and without writing."""
    if not path.is_file():
        raise FileNotFoundError(path)
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _order(f: Finding) -> tuple:
    return (f.severity != ERROR, f.check, f.episode or "", f.scene or "", f.line or 0)


def report(findings: list[Finding], limit: int | None = None) -> str:
    """Findings, errors first and grouped by check, then a summary with counts per check."""
    out = []
    shown: Counter = Counter()
    totals = Counter(f.check for f in findings)
    for f in sorted(findings, key=_order):
        if limit is None or shown[f.check] < limit:
            out.append(f.format())
        shown[f.check] += 1
    errors = sum(1 for f in findings if f.severity == ERROR)
    warnings = len(findings) - errors
    out.append("")
    out.append(f"summary: {errors} errors, {warnings} warnings")
    for check, n in sorted(totals.items(), key=lambda kv: (CHECKS[kv[0]][0] != ERROR, kv[0])):
        hidden = f" ({n - limit} not shown)" if limit is not None and n > limit else ""
        out.append(f"  {CHECKS[check][0]:<7} {check:<20} {n}{hidden}")
    return "\n".join(out)
