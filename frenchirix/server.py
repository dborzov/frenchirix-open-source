"""The review UI: `.venv/bin/frenchirix serve`. See docs/review-ui.md.

Standard library only. Serves the static front end from web/, a JSON API read from the
database, the rendered media under assets/audio and assets/video (with HTTP Range
support, which Chromium needs to seek), and the review marks, which it also writes
(frenchirix/review.py).
"""

from __future__ import annotations

import difflib
import json
import mimetypes
import re
import sqlite3
import sys
from email.utils import formatdate
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import review
from .db import ASSETS_DIR, DB_PATH, REPO_ROOT, connect
from .text import split_words

WEB_DIR = REPO_ROOT / "web"
MEDIA_SUBDIRS = ("audio", "video")
# The strip on the episode timeline ends this long after the last subtitle line,
# so the credits (about 10 minutes of S01E04) do not take up most of it.
STORY_TAIL_MS = 15_000

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ico": "image/x-icon",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
}

SCENE_ID_RE = re.compile(r"^[a-z0-9]+-\d{4}-\d{4}$")
EPISODE_ID_RE = re.compile(r"^[a-z0-9]+$")
MARK_ID_RE = re.compile(r"^[1-9]\d{0,9}$")
MARK_ERRORS = {"invalid": HTTPStatus.BAD_REQUEST, "not_found": HTTPStatus.NOT_FOUND,
               "conflict": HTTPStatus.CONFLICT}


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------------------
# Database reads (the writes are the review marks, in review.py)


def open_db(path: Path) -> sqlite3.Connection:
    # One short-lived connection per request: sqlite3 connections are not shared across
    # the server's threads. The timeout covers the render step writing at the same time.
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _json_list(text: str | None) -> list:
    if not text:
        return []
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []


def list_episodes(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT e.id, e.show, e.season, e.episode, e.duration_ms,
               (SELECT MAX(end_ms) FROM lines l WHERE l.episode_id = e.id) AS last_line_end_ms,
               (SELECT COUNT(*) FROM scenes s WHERE s.episode_id = e.id) AS scenes,
               (SELECT COUNT(*) FROM scenes s WHERE s.episode_id = e.id
                  AND s.audio_file IS NOT NULL) AS rendered,
               (SELECT COUNT(*) FROM review_marks m JOIN scenes s ON s.id = m.scene_id
                  WHERE s.episode_id = e.id AND m.status = 'open') AS open_marks
        FROM episodes e ORDER BY e.season, e.episode, e.id
        """
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        last = d.pop("last_line_end_ms") or 0
        d["story_end_ms"] = min(d["duration_ms"], last + STORY_TAIL_MS) if last else d["duration_ms"]
        out.append(d)
    return out


def get_episode(conn: sqlite3.Connection, episode_id: str) -> dict:
    eps = [e for e in list_episodes(conn) if e["id"] == episode_id]
    if not eps:
        raise ApiError(HTTPStatus.NOT_FOUND, f"no episode {episode_id}")
    ep = eps[0]
    # Line spans are drawn faintly under the scenes on the episode timeline.
    ep["lines"] = [
        [r[0], r[1]] for r in conn.execute(
            "SELECT start_ms, end_ms FROM lines WHERE episode_id = ? ORDER BY idx", (episode_id,))
    ]
    return ep


def _scene_base(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "episode_id": r["episode_id"],
        "first_line_idx": r["first_line_idx"],
        "last_line_idx": r["last_line_idx"],
        "core_start_ms": r["core_start_ms"],
        "core_end_ms": r["core_end_ms"],
        "clip_start_ms": r["clip_start_ms"],
        "clip_end_ms": r["clip_end_ms"],
        "title": r["title"],
        "kind": r["kind"],
        "tags": _json_list(r["tags"]),
        "score": r["score"],
        "why": r["why"],
        "selected_by": r["selected_by"],
        "rendered": r["audio_file"] is not None and r["video_file"] is not None,
    }


def list_scenes(conn: sqlite3.Connection, episode_id: str) -> list[dict]:
    if not conn.execute("SELECT 1 FROM episodes WHERE id = ?", (episode_id,)).fetchone():
        raise ApiError(HTTPStatus.NOT_FOUND, f"no episode {episode_id}")
    scenes = [_scene_base(r) for r in conn.execute(
        "SELECT * FROM scenes WHERE episode_id = ? ORDER BY core_start_ms, core_end_ms, id",
        (episode_id,))]
    # French and English text per scene, for free-text search in the list.
    fr: dict[str, list[str]] = {}
    final: dict[str, list[str]] = {}  # spoken French and literal English, where annotated
    for r in conn.execute(
        "SELECT sl.scene_id, sl.fr, sl.fr_final, sl.en_literal FROM scene_lines sl "
        "JOIN scenes s ON s.id = sl.scene_id "
        "WHERE s.episode_id = ? ORDER BY sl.scene_id, sl.line_idx", (episode_id,)):
        fr.setdefault(r[0], []).append(r[1])
        final.setdefault(r[0], []).extend(t for t in (r[2], r[3]) if t)
    en: dict[str, list[str]] = {}
    for r in conn.execute(
        """
        SELECT s.id, t.text FROM scenes s
        JOIN translations t ON t.episode_id = s.episode_id AND t.lang = 'en'
         AND t.last_line_idx >= s.first_line_idx AND t.first_line_idx <= s.last_line_idx
        WHERE s.episode_id = ? ORDER BY s.id, t.group_idx
        """, (episode_id,)):
        if r[1]:
            en.setdefault(r[0], []).append(r[1])
    n_notes = dict(conn.execute(
        "SELECT x.scene_id, COUNT(*) FROM notes x JOIN scenes s ON s.id = x.scene_id "
        "WHERE s.episode_id = ? GROUP BY x.scene_id", (episode_id,)).fetchall())
    for s in scenes:
        s["notes"] = n_notes.get(s["id"], 0)
        s["fr"] = " ".join(fr.get(s["id"], []))
        s["en"] = " ".join(en.get(s["id"], []))
        s["final"] = " ".join(final.get(s["id"], []))
    return scenes


def _offset(ms: int | None, clip_start: int | None) -> int | None:
    return None if ms is None or clip_start is None else ms - clip_start


def _fold_word(word: str) -> str:
    # Case and apostrophe style do not make a different word; accents do (a / à).
    return word.lower().replace("’", "'")


def _subtitle_diff(fr: str, fr_final: str | None) -> dict:
    """How the spoken French differs from the subtitle, in words.

    `fr_differs`: the word sequences differ (punctuation and line breaks ignored).
    `fr_added`: [char_start, char_end] in fr_final of each word the subtitle does not
    have, by a longest-matching-blocks alignment of the two word sequences.
    """
    if fr_final is None:
        return {"fr_differs": False, "fr_added": []}
    sub = [_fold_word(w) for w, _, _ in split_words(fr)]
    final = split_words(fr_final)
    keys = [_fold_word(w) for w, _, _ in final]
    matched: set[int] = set()
    for block in difflib.SequenceMatcher(None, sub, keys, autojunk=False).get_matching_blocks():
        matched.update(range(block.b, block.b + block.size))
    return {
        "fr_differs": sub != keys,
        "fr_added": [[a, b] for i, (_, a, b) in enumerate(final) if i not in matched],
    }


def scene_units(conn: sqlite3.Connection, scene_id: str,
                clip_start: int | None) -> dict[str, list[dict]]:
    """The units of every line of a scene, by line id, with their spans and times.

    Read from `units` and `words` rather than the `unit_times` view: a unit counts as
    timed only when every one of its words is, and words aligned without a score
    (unspellable ones such as "49.3") are counted, which MIN(score) would hide.
    """
    out: dict[str, list[dict]] = {}
    for u in conn.execute(
        """
        SELECT u.line_id, u.idx, u.kind, u.first_word_idx, u.last_word_idx, u.text, u.en, u.note,
               MIN(w.char_start) AS char_start, MAX(w.char_end) AS char_end,
               MIN(w.start_ms) AS start_ms, MAX(w.end_ms) AS end_ms, MIN(w.score) AS score,
               COUNT(*) AS n_words, COUNT(w.start_ms) AS n_timed,
               SUM(w.start_ms IS NOT NULL AND w.score IS NULL) AS unscored
        FROM scene_lines sl
        JOIN units u ON u.line_id = sl.line_id
        JOIN words w ON w.line_id = u.line_id AND w.idx BETWEEN u.first_word_idx AND u.last_word_idx
        WHERE sl.scene_id = ?
        GROUP BY u.id
        ORDER BY sl.line_idx, u.idx
        """, (scene_id,)):
        timed = u["n_timed"] == u["n_words"] and u["end_ms"] is not None
        start = u["start_ms"] if timed else None
        end = u["end_ms"] if timed else None
        out.setdefault(u["line_id"], []).append({
            "idx": u["idx"],
            "kind": u["kind"],
            "text": u["text"],
            "en": u["en"],
            "note": u["note"],
            "first_word_idx": u["first_word_idx"],
            "last_word_idx": u["last_word_idx"],
            "char_start": u["char_start"],
            "char_end": u["char_end"],
            "start_ms": start,
            "end_ms": end,
            "offset_start_ms": _offset(start, clip_start),
            "offset_end_ms": _offset(end, clip_start),
            "score": u["score"] if timed else None,
            "unscored_words": u["unscored"] if timed else 0,
        })
    return out


def scene_notes(conn: sqlite3.Connection, scene_id: str,
                clip_start: int | None) -> list[dict]:
    """A scene's notes on references and wordplay, in order, with the span and
    times of their phrase where it was located. Timed like units: only when every word
    of the span is aligned."""
    out = []
    for x in conn.execute(
        """
        SELECT x.id, x.idx, x.kind, x.text, x.phrase, x.line_id, l.idx AS line_idx,
               x.first_word_idx, x.last_word_idx,
               MIN(w.char_start) AS char_start, MAX(w.char_end) AS char_end,
               MIN(w.start_ms) AS start_ms, MAX(w.end_ms) AS end_ms, MIN(w.score) AS score,
               COUNT(w.id) AS n_words, COUNT(w.start_ms) AS n_timed,
               SUM(w.start_ms IS NOT NULL AND w.score IS NULL) AS unscored
        FROM notes x
        LEFT JOIN lines l ON l.id = x.line_id
        LEFT JOIN words w ON w.line_id = x.line_id
             AND w.idx BETWEEN x.first_word_idx AND x.last_word_idx
        WHERE x.scene_id = ?
        GROUP BY x.id
        ORDER BY x.idx
        """, (scene_id,)):
        located = x["n_words"] > 0
        timed = located and x["n_timed"] == x["n_words"]
        start = x["start_ms"] if timed else None
        end = x["end_ms"] if timed else None
        out.append({
            "idx": x["idx"],
            "kind": x["kind"],
            "text": x["text"],
            "phrase": x["phrase"],
            "line_id": x["line_id"],
            "line_idx": x["line_idx"],
            "first_word_idx": x["first_word_idx"] if located else None,
            "last_word_idx": x["last_word_idx"] if located else None,
            "char_start": x["char_start"] if located else None,
            "char_end": x["char_end"] if located else None,
            "start_ms": start,
            "end_ms": end,
            "offset_start_ms": _offset(start, clip_start),
            "offset_end_ms": _offset(end, clip_start),
            "score": x["score"] if timed else None,
            "unscored_words": x["unscored"] if timed else 0,
        })
    return out


def get_scene(conn: sqlite3.Connection, scene_id: str, assets_dir: Path) -> dict:
    r = conn.execute("SELECT * FROM scenes WHERE id = ?", (scene_id,)).fetchone()
    if r is None:
        raise ApiError(HTTPStatus.NOT_FOUND, f"no scene {scene_id}")
    scene = _scene_base(r)
    scene["created_at"] = r["created_at"]

    if scene["rendered"]:
        audio_file, video_file = r["audio_file"], r["video_file"]
        scene["media"] = {
            "clip_start_ms": r["clip_start_ms"],
            "clip_end_ms": r["clip_end_ms"],
            "fade_in_ms": r["fade_in_ms"] or 0,
            "fade_out_ms": r["fade_out_ms"] or 0,
            "frame_times_ms": _json_list(r["frame_times_ms"]),
            "audio_lufs": r["audio_lufs"],
            "audio_peak_db": r["audio_peak_db"],
            "audio_url": "/assets/" + audio_file,
            "video_url": "/assets/" + video_file,
            # Media is git-ignored: the database can say "rendered" on a fresh clone.
            "audio_exists": (assets_dir / audio_file).is_file(),
            "video_exists": (assets_dir / video_file).is_file(),
        }
    else:
        scene["media"] = None

    clip_start = r["clip_start_ms"]
    units = scene_units(conn, scene_id, clip_start)
    lines = []
    for l in conn.execute(
        "SELECT sl.*, ln.annotated_by FROM scene_lines sl JOIN lines ln ON ln.id = sl.line_id "
        "WHERE sl.scene_id = ? ORDER BY sl.line_idx", (scene_id,)):
        fr_final = l["fr_final"]
        lines.append({
            "id": l["line_id"],
            "idx": l["line_idx"],
            "start_ms": l["start_ms"],
            "end_ms": l["end_ms"],
            "offset_start_ms": l["clip_start_offset_ms"],
            "offset_end_ms": l["clip_end_offset_ms"],
            "fr": l["fr"],
            "speaker": l["speaker"],
            "is_song": bool(l["is_song"]),
            "group_idx": l["group_idx"],
            # Annotation and alignment (docs/data-model.md, "True text, words and units").
            # NULL / empty until the line is annotated; times NULL until it is aligned.
            "fr_final": fr_final,
            "en_literal": l["en_literal"],
            "annotated_by": l["annotated_by"],
            "audio_start_ms": l["audio_start_ms"],
            "audio_end_ms": l["audio_end_ms"],
            "offset_audio_start_ms": _offset(l["audio_start_ms"], clip_start),
            "offset_audio_end_ms": _offset(l["audio_end_ms"], clip_start),
            **_subtitle_diff(l["fr"], fr_final),
            "units": units.get(l["line_id"], []),
        })
    scene["lines"] = lines
    scene["annotation"] = {
        "lines": len(lines),
        "annotated": sum(l["fr_final"] is not None for l in lines),
        "aligned": sum(l["audio_start_ms"] is not None for l in lines),
        "units": sum(len(l["units"]) for l in lines),
    }
    scene["notes"] = scene_notes(conn, scene_id, clip_start)
    # Marks are about lines, so a line shared with an overlapping scene shows them in both.
    scene["marks"] = review.list_marks(conn, line_ids=[l["id"] for l in lines])

    groups = []
    for t in conn.execute(
        """
        SELECT group_idx, first_line_idx, last_line_idx, text FROM translations
        WHERE episode_id = ? AND lang = 'en'
          AND last_line_idx >= ? AND first_line_idx <= ?
        ORDER BY group_idx
        """, (r["episode_id"], r["first_line_idx"], r["last_line_idx"])):
        groups.append({
            "group_idx": t["group_idx"],
            "first_line_idx": t["first_line_idx"],
            "last_line_idx": t["last_line_idx"],
            "en": t["text"],
            # A scene must not split a group; flag it if the data ever does.
            "partial": t["first_line_idx"] < r["first_line_idx"]
                       or t["last_line_idx"] > r["last_line_idx"],
        })
    scene["groups"] = groups
    return scene


# ---------------------------------------------------------------------------
# Static files and Range requests


def safe_path(root: Path, rel: str) -> Path | None:
    """`root / rel` if it is a file inside `root`, else None. `rel` is already URL-decoded."""
    if "\x00" in rel or "\\" in rel:
        return None
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if any(p == ".." or p.startswith(".") for p in parts):
        return None
    root = root.resolve()
    path = root.joinpath(*parts).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path


def parse_range(header: str, size: int) -> tuple[int, int] | None:
    """(first, last) byte positions for a single `bytes=` range, or None if unsatisfiable.

    Raises ValueError for a header this server does not understand (it then sends the
    whole file, as RFC 9110 allows).
    """
    m = re.fullmatch(r"\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*", header)
    if not m or (m.group(1) == "" and m.group(2) == ""):
        raise ValueError(header)
    if m.group(1) == "":  # suffix range: the last N bytes
        n = int(m.group(2))
        if n == 0 or size == 0:
            return None
        return max(0, size - n), size - 1
    first = int(m.group(1))
    last = int(m.group(2)) if m.group(2) else size - 1
    if first >= size or last < first:
        return None
    return first, min(last, size - 1)


# ---------------------------------------------------------------------------
# HTTP


class Handler(BaseHTTPRequestHandler):
    server_version = "frenchirix"
    protocol_version = "HTTP/1.1"
    # Set on the class created by make_server.
    db_path: Path = DB_PATH
    assets_dir: Path = ASSETS_DIR
    web_dir: Path = WEB_DIR
    quiet: bool = False

    def log_message(self, fmt: str, *args) -> None:  # noqa: D401
        if not self.quiet:
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    # -- responses

    def _send_json(self, value, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_error_json(self, status: HTTPStatus, message: str) -> None:
        self._send_json({"error": message}, status)

    def _send_file(self, path: Path) -> None:
        size = path.stat().st_size
        ctype = CONTENT_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] \
            or "application/octet-stream"
        first, last = 0, size - 1
        status = HTTPStatus.OK
        header = self.headers.get("Range")
        if header:
            try:
                rng = parse_range(header, size)
            except ValueError:
                rng = (0, size - 1)
            else:
                if rng is None:
                    self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = HTTPStatus.PARTIAL_CONTENT
            first, last = rng
        length = max(0, last - first + 1)
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", formatdate(path.stat().st_mtime, usegmt=True))
        # Files change when a scene is re-rendered or the front end is edited.
        self.send_header("Cache-Control", "no-cache")
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
        self.end_headers()
        if self.command == "HEAD" or length == 0:
            return
        with path.open("rb") as f:
            f.seek(first)
            remaining = length
            try:
                while remaining > 0:
                    chunk = f.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                # Media elements routinely abort a request once they have what they need.
                self.close_connection = True

    def _not_found(self) -> None:
        self._send_error_json(HTTPStatus.NOT_FOUND, "not found")

    # -- routing

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        path = unquote(urlsplit(self.path).path)
        try:
            if path.startswith("/api/"):
                self._api_get(path[len("/api/"):].strip("/"), urlsplit(self.path).query)
            elif path.startswith("/assets/"):
                rel = path[len("/assets/"):]
                top = rel.split("/", 1)[0]
                file = safe_path(self.assets_dir, rel) if top in MEDIA_SUBDIRS else None
                if file is None:
                    self._not_found()
                else:
                    self._send_file(file)
            else:
                rel = path.lstrip("/") or "index.html"
                file = safe_path(self.web_dir, rel)
                if file is None:
                    self._not_found()
                else:
                    self._send_file(file)
        except ApiError as e:
            self._send_error_json(e.status, e.message)

    def _api_get(self, route: str, query: str = "") -> None:
        parts = route.split("/") if route else []
        conn = open_db(self.db_path)
        try:
            if parts == ["episodes"]:
                return self._send_json(list_episodes(conn))
            if len(parts) == 2 and parts[0] == "episodes" and EPISODE_ID_RE.match(parts[1]):
                return self._send_json(get_episode(conn, parts[1]))
            if (len(parts) == 3 and parts[0] == "episodes" and parts[2] == "scenes"
                    and EPISODE_ID_RE.match(parts[1])):
                return self._send_json(list_scenes(conn, parts[1]))
            if len(parts) == 2 and parts[0] == "scenes" and SCENE_ID_RE.match(parts[1]):
                return self._send_json(get_scene(conn, parts[1], self.assets_dir))
            if parts == ["marks"]:
                q = {k: v[-1] for k, v in parse_qs(query).items()}
                status = q.get("status") or None
                if status is not None and status not in review.STATUSES:
                    raise ApiError(HTTPStatus.BAD_REQUEST,
                                   f"status must be one of {', '.join(review.STATUSES)}")
                return self._send_json(review.list_marks(conn, status, q.get("episode") or None))
        finally:
            conn.close()
        self._not_found()

    def _read_body(self) -> bytes:
        # Read before any reply: bytes left unread on a kept-alive connection would be
        # parsed as the next request.
        length = int(self.headers.get("Content-Length") or 0)
        if length > 64 * 1024:
            self.close_connection = True
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "body too large")
        return self.rfile.read(length)

    def _same_origin(self) -> None:
        """Writes come only from the review UI's own page. A web page open in the same browser
        can send a request to 127.0.0.1; without this it could create review marks, whose
        comments the review-fixer agent carries out as the user's instructions."""
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        origin = self.headers.get("Origin")
        if self.headers.get("Host") not in hosts or (
                origin is not None and origin not in {f"http://{h}" for h in hosts}):
            raise ApiError(HTTPStatus.FORBIDDEN, "writes are accepted only from the review UI's own page")

    @staticmethod
    def _json(raw: bytes):
        try:
            return json.loads(raw or b"null")
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ApiError(HTTPStatus.BAD_REQUEST, "body is not valid JSON")

    def _write(self) -> None:
        """POST /api/marks, PATCH and DELETE /api/marks/<id>: the only writes."""
        parts = unquote(urlsplit(self.path).path).strip("/").split("/")
        try:
            raw = self._read_body()
            self._same_origin()
            on_list = parts == ["api", "marks"]
            on_mark = len(parts) == 3 and parts[:2] == ["api", "marks"] and bool(MARK_ID_RE.match(parts[2]))
            if not (on_list or on_mark):
                raise ApiError(HTTPStatus.NOT_FOUND, "not found")
            if self.command not in (("POST",) if on_list else ("PATCH", "DELETE")):
                raise ApiError(HTTPStatus.METHOD_NOT_ALLOWED,
                               "use POST /api/marks, or PATCH or DELETE /api/marks/<id>")
            body = None if self.command == "DELETE" else self._json(raw)
            conn = open_db(self.db_path)
            try:
                if self.command == "POST":
                    result, status = review.create_mark(conn, body), HTTPStatus.CREATED
                elif self.command == "PATCH":
                    result, status = review.update_mark(conn, int(parts[2]), body), HTTPStatus.OK
                else:
                    review.delete_mark(conn, int(parts[2]))
                    result, status = {"deleted": int(parts[2])}, HTTPStatus.OK
            except review.MarkError as e:
                raise ApiError(MARK_ERRORS[e.kind], e.message)
            finally:
                conn.close()
            self._send_json(result, status)
        except ApiError as e:
            self._send_error_json(e.status, e.message)

    do_POST = do_PATCH = do_DELETE = do_PUT = _write


def make_server(port: int = 8765, db_path: Path = DB_PATH, assets_dir: Path = ASSETS_DIR,
                web_dir: Path = WEB_DIR, host: str = "127.0.0.1",
                quiet: bool = False) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {
        "db_path": Path(db_path), "assets_dir": Path(assets_dir), "web_dir": Path(web_dir),
        "quiet": quiet,
    })
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    return httpd


def serve(port: int, db_path: Path) -> int:
    if not db_path.is_file():
        print(f"error: database {db_path} not found", file=sys.stderr)
        return 1
    # Request handlers open the file with plain sqlite3, which never migrates: bring an
    # older file to the current schema (review marks need version 6) once, here.
    connect(db_path).close()
    try:
        httpd = make_server(port, db_path)
    except OSError as e:
        print(f"error: cannot listen on 127.0.0.1:{port}: {e}", file=sys.stderr)
        return 1
    print(f"serving {db_path} at http://127.0.0.1:{httpd.server_address[1]}/  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0
