"""`import`: probe an episode file, extract its subtitle tracks and fill
episodes, cues, lines and translations. Re-import rules are in docs/pipeline.md."""

from __future__ import annotations

import json
import re
import sqlite3
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from . import subtitle_align
from .db import REPO_ROOT
from .subtitles import Cue, clean_text, parse_sdh, parse_srt, transfer_breaks

CONTENT_DIR = REPO_ROOT / "content"
WORK_DIR = REPO_ROOT / "work"
CORRECTIONS_DIR = REPO_ROOT / "corrections"
EPISODE_RE = re.compile(r"^s(\d{2})e(\d{2})$")
FRENCH = {"fre", "fra", "fr"}
ENGLISH = {"eng", "en"}
TRACKS = ("fr", "fr_sdh", "en")


class ImportError_(RuntimeError):
    """A problem the user must resolve; the message says what."""


def parse_episode_id(episode_id: str) -> tuple[int, int]:
    m = EPISODE_RE.match(episode_id)
    if not m:
        raise ImportError_(f"episode id must look like s01e04, got {episode_id!r}")
    return int(m.group(1)), int(m.group(2))


def source_path(episode_id: str, directory: Path = CONTENT_DIR) -> Path:
    """The source of an episode: the one .mkv file in content/ whose name contains its
    SxxEyy (any case), e.g. `My.Show.S01E04.mkv` for s01e04."""
    parse_episode_id(episode_id)
    found = sorted(p for p in directory.glob("*") if p.is_file() and p.suffix.lower() == ".mkv"
                   and episode_id.lower() in p.name.lower())
    if len(found) != 1:
        names = ", ".join(p.name for p in found) or "none"
        raise ImportError_(
            f"expected one .mkv file in {directory} whose name contains {episode_id.upper()}, "
            f"found {names}; pass the file with --file")
    return found[0]


def show_name(conn: sqlite3.Connection, episode_id: str, show: str | None) -> str:
    """The show's title: `show` when given, else the one already stored (this episode's, or the
    single show of the database's episodes). The first import into a database needs it."""
    if show:
        return show
    row = conn.execute("SELECT show FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    if row:
        return row[0]
    shows = [r[0] for r in conn.execute("SELECT DISTINCT show FROM episodes")]
    if len(shows) == 1:
        return shows[0]
    raise ImportError_("the show's title is not known yet: pass it with --show "
                       "(stored with the episode; later imports reuse it)")


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def _tags(stream: dict) -> tuple[str, str]:
    tags = {k.lower(): v for k, v in stream.get("tags", {}).items()}
    return tags.get("language", "").lower(), tags.get("title", "").strip()


def choose_streams(info: dict) -> dict[str, int]:
    """Pick streams by language and title. The untitled English subtitle track is
    the translation of the French subtitles; titled ones ("British…") transcribe
    the English dub and are never used."""
    found: dict[str, list[int]] = {"audio": [], "fr": [], "fr_sdh": [], "en": []}
    for s in info["streams"]:
        lang, title = _tags(s)
        if s.get("codec_type") == "audio" and lang in FRENCH:
            found["audio"].append(s["index"])
        if s.get("codec_type") != "subtitle":
            continue
        if s.get("codec_name") != "subrip":
            continue
        if lang in FRENCH and not title:
            found["fr"].append(s["index"])
        elif lang in FRENCH and "sdh" in title.lower():
            found["fr_sdh"].append(s["index"])
        elif lang in ENGLISH and not title:
            found["en"].append(s["index"])
    for key, idx in found.items():
        if len(idx) != 1:
            raise ImportError_(
                f"expected exactly one {key} stream, found {idx or 'none'}; "
                "check the stream layout with ffprobe"
            )
    return {k: v[0] for k, v in found.items()}


def extract_tracks(path: Path, streams: dict[str, int], out_dir: Path) -> dict[str, str]:
    """Copy the three subtitle streams out in one ffmpeg pass; return their text."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(path)]
    for track in TRACKS:
        cmd += ["-map", f"0:{streams[track]}", "-c:s", "copy", str(out_dir / f"{track}.srt")]
    subprocess.run(cmd, check=True)
    return {t: (out_dir / f"{t}.srt").read_text(encoding="utf-8") for t in TRACKS}


@dataclass
class Imported:
    """Everything `import` writes for one episode, before it touches the DB."""
    episode: dict
    cues: dict[str, list[Cue]]
    streams: dict[str, int]
    lines: list[dict]          # without fr_cue_id
    translations: list[dict]


def build(episode_id: str, info: dict, texts: dict[str, str], source_file: str,
          show: str = "") -> Imported:
    season, episode = parse_episode_id(episode_id)
    streams = choose_streams(info)
    by_index = {s["index"]: s for s in info["streams"]}
    video = next(s for s in info["streams"] if s.get("codec_type") == "video")
    audio = by_index[streams["audio"]]
    if not audio.get("channel_layout", "").startswith("5.1"):
        raise ImportError_(
            f"the French audio stream {streams['audio']} is {audio.get('channel_layout') or 'of unknown layout'}; "
            "the pipeline needs 5.1: it hears the dialogue on the centre channel and downmixes 5.1 to stereo")
    ep = {
        "id": episode_id,
        "show": show,
        "season": season,
        "episode": episode,
        "source_file": source_file,
        "duration_ms": round(float(info["format"]["duration"]) * 1000),
        "video_width": int(video["width"]),
        "video_height": int(video["height"]),
        "video_fps": float(Fraction(video.get("avg_frame_rate") or video["r_frame_rate"])),
        "audio_stream": streams["audio"],
        "audio_layout": audio.get("channel_layout", ""),
    }
    cues = {t: parse_srt(texts[t]) for t in TRACKS}
    lines, translations = build_lines(episode_id, cues, f"subtitle:{streams['en']}")
    return Imported(ep, cues, streams, lines, translations)


def build_lines(episode_id: str, cues: dict[str, list[Cue]],
                source: str = "subtitle") -> tuple[list[dict], list[dict]]:
    fr, en = cues["fr"], cues["en"]
    sdh = [parse_sdh(c) for c in cues["fr_sdh"]]
    sdh_match = subtitle_align.match_sdh(fr, sdh)
    groups = subtitle_align.build_groups(fr, en)
    en_by_idx = {c.idx: c for c in en}
    lines = []
    for f in fr:
        matches = sdh_match.get(f.idx, [])
        is_song = any(m.is_song for m in matches)
        text = clean_text(f.text, keep_breaks=is_song)
        if is_song and len(matches) == 1:
            # The plain track sometimes writes a lyric couplet on one line.
            text = transfer_breaks(text, matches[0].speech_lines)
        lines.append({
            "id": f"{episode_id}-{f.idx:04d}",
            "idx": f.idx,
            "start_ms": f.start_ms,
            "end_ms": f.end_ms,
            "fr": text,
            "speaker": subtitle_align.speaker_for(matches),
            "is_song": int(is_song),
        })
    song = {l["idx"]: l["is_song"] for l in lines}
    translations = []
    for gi, g in enumerate(groups, start=1):
        for k in range(g.first, g.last + 1):
            lines[k - 1]["group_idx"] = gi
        translations.append({
            "lang": "en",
            "group_idx": gi,
            "first_line_idx": g.first,
            "last_line_idx": g.last,
            "text": g.text(en_by_idx, song=all(song[k] for k in range(g.first, g.last + 1))),
            "source": source,
        })
    return lines, translations


def load_corrections(episode_id: str, directory: Path = CORRECTIONS_DIR) -> dict | None:
    """The episode's corrections file, or None when there is none."""
    path = directory / f"{episode_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ImportError_(f"{path} is not valid JSON: {e}") from e


def apply_corrections(episode_id: str, translations: list[dict], data: dict | None,
                      name: str = "corrections") -> int:
    """Replace the text of translation groups named in `data` (in place).

    Each entry must name the exact line range of an existing group; otherwise
    the whole import fails. Returns the number of corrections applied."""
    if data is None:
        return 0
    if not isinstance(data, dict) or data.get("episode") != episode_id:
        raise ImportError_(f"{name}: \"episode\" must be {episode_id!r}")
    entries = data.get("translations", [])
    if not isinstance(entries, list):
        raise ImportError_(f"{name}: \"translations\" must be a list")
    by_range = {(t["lang"], t["first_line_idx"], t["last_line_idx"]): t for t in translations}
    for n, e in enumerate(entries, start=1):
        where = f"{name} entry {n}"
        if not isinstance(e, dict):
            raise ImportError_(f"{where}: must be an object")
        where += f" (lines {e.get('first')}-{e.get('last')})"
        lang, text = e.get("lang", "en"), e.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ImportError_(f"{where}: \"text\" must be a non-empty string")
        group = by_range.get((lang, e.get("first"), e.get("last")))
        if group is None:
            raise ImportError_(f"{where}: no {lang} translation group covers exactly these lines")
        group["text"] = text
        group["source"] = "correction"
    return len(entries)


# --- database -------------------------------------------------------------

def _stored_cues(conn: sqlite3.Connection, episode_id: str) -> list[tuple]:
    return [tuple(r) for r in conn.execute(
        "SELECT track, stream_index, idx, start_ms, end_ms, raw_text FROM cues "
        "WHERE episode_id = ? ORDER BY track, idx", (episode_id,))]


def _new_cues(imp: Imported) -> list[tuple]:
    return sorted(
        (t, imp.streams[t], c.idx, c.start_ms, c.end_ms, c.text)
        for t in TRACKS for c in imp.cues[t]
    )


LINE_COLS = ("id", "idx", "start_ms", "end_ms", "fr", "speaker", "is_song", "group_idx")
TR_COLS = ("lang", "group_idx", "first_line_idx", "last_line_idx", "text", "source")


def _stored(conn, table, cols, episode_id, order):
    return [tuple(r) for r in conn.execute(
        f"SELECT {', '.join(cols)} FROM {table} WHERE episode_id = ? ORDER BY {order}",
        (episode_id,))]


ANNOTATION_COLS = ("fr_final", "en_literal", "annotated_by", "audio_start_ms", "audio_end_ms")


def _ws(text: str) -> str:
    return " ".join(text.split())


def annotated_lines(conn: sqlite3.Connection, episode_id: str) -> dict[str, str]:
    """{line id: subtitle text} of lines carrying annotation or alignment: any of
    the annotation columns set, or `words` / `units` rows."""
    any_col = " OR ".join(f"l.{c} IS NOT NULL" for c in ANNOTATION_COLS)
    return {r[0]: r[1] for r in conn.execute(
        f"SELECT l.id, l.fr FROM lines l WHERE l.episode_id = ? AND ({any_col} "
        "OR EXISTS (SELECT 1 FROM words w WHERE w.line_id = l.id) "
        "OR EXISTS (SELECT 1 FROM units u WHERE u.line_id = l.id))", (episode_id,))}


def write(conn: sqlite3.Connection, imp: Imported) -> str:
    """Write an import to the database. Returns a one-line summary.

    - Nothing stored yet, or stored data identical: write / leave as is.
    - Different data and no scenes: replace cues, lines and translations.
    - Different line ids, times or text while scenes exist: refuse, because
      scenes are defined by line numbers. Different speakers, song flags or
      translation groups with scenes present: replace and warn about scenes
      that now split a group.
    - A line with annotation (fr_final, en_literal, words, units, alignment)
      must keep its id and its subtitle text up to whitespace, or the import
      is refused. Lines are updated in place, so annotation columns and the
      `words` / `units` rows stay attached.
    """
    eid = imp.episode["id"]
    new_cues = _new_cues(imp)
    new_lines = [tuple(l[c] for c in LINE_COLS) for l in imp.lines]
    new_tr = [tuple(t[c] for c in TR_COLS) for t in imp.translations]
    old_cues = _stored_cues(conn, eid)
    old_lines = _stored(conn, "lines", LINE_COLS, eid, "idx")
    old_tr = _stored(conn, "translations", TR_COLS, eid, "lang, group_idx")
    ep_cols = list(imp.episode)
    old_ep = conn.execute(f"SELECT {', '.join(ep_cols)} FROM episodes WHERE id = ?", (eid,)).fetchone()
    n_scenes = conn.execute("SELECT COUNT(*) FROM scenes WHERE episode_id = ?", (eid,)).fetchone()[0]

    if (old_ep is not None and tuple(old_ep) == tuple(imp.episode[c] for c in ep_cols)
            and old_cues == new_cues and old_lines == new_lines and old_tr == new_tr):
        return f"{eid}: unchanged ({len(new_lines)} lines, {len(new_tr)} groups)"
    if n_scenes:
        # id, idx, start, end, fr; a whitespace-only change to fr is allowed.
        core = lambda rows: [(*r[:4], _ws(r[4])) for r in rows]
        if core(old_lines) != core(new_lines):
            raise ImportError_(
                f"{eid} has {n_scenes} scenes and the new import changes line ids, times "
                "or text. Scenes are defined by line numbers, so nothing was written. "
                "Delete the episode's scenes first if the change is intended."
            )
    new_fr = {l["id"]: l["fr"] for l in imp.lines}
    lost = [lid for lid, fr in sorted(annotated_lines(conn, eid).items())
            if lid not in new_fr or _ws(new_fr[lid]) != _ws(fr)]
    if lost:
        raise ImportError_(
            f"{eid}: the new import would remove or change the subtitle text of "
            f"{len(lost)} annotated lines ({', '.join(lost[:10])}{' …' if len(lost) > 10 else ''}); "
            "nothing was written."
        )

    with conn:
        conn.execute(
            f"INSERT INTO episodes ({', '.join(ep_cols)}) VALUES ({', '.join('?' * len(ep_cols))}) "
            f"ON CONFLICT(id) DO UPDATE SET {', '.join(f'{c} = excluded.{c}' for c in ep_cols if c != 'id')}",
            [imp.episode[c] for c in ep_cols],
        )
        # lines.fr_cue_id points at cues that are about to be replaced; check the
        # foreign keys at commit, once both are rewritten.
        conn.execute("PRAGMA defer_foreign_keys = ON")
        conn.execute("DELETE FROM translations WHERE episode_id = ?", (eid,))
        conn.execute("DELETE FROM cues WHERE episode_id = ?", (eid,))
        fr_cue_ids: dict[int, int] = {}
        for track in TRACKS:
            for c in imp.cues[track]:
                cur = conn.execute(
                    "INSERT INTO cues (episode_id, track, stream_index, idx, start_ms, end_ms, raw_text) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (eid, track, imp.streams[track], c.idx, c.start_ms, c.end_ms, c.text),
                )
                if track == "fr":
                    fr_cue_ids[c.idx] = cur.lastrowid
        # Update lines in place: annotation columns and words/units rows stay.
        for l in imp.lines:
            conn.execute(
                "INSERT INTO lines (id, episode_id, idx, start_ms, end_ms, fr, speaker, is_song, "
                "group_idx, fr_cue_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET idx = excluded.idx, start_ms = excluded.start_ms, "
                "end_ms = excluded.end_ms, fr = excluded.fr, speaker = excluded.speaker, "
                "is_song = excluded.is_song, group_idx = excluded.group_idx, "
                "fr_cue_id = excluded.fr_cue_id",
                (l["id"], eid, l["idx"], l["start_ms"], l["end_ms"], l["fr"], l["speaker"],
                 l["is_song"], l["group_idx"], fr_cue_ids[l["idx"]]),
            )
        stale = [lid for (lid,) in conn.execute("SELECT id FROM lines WHERE episode_id = ?", (eid,))
                 if lid not in new_fr]
        conn.executemany("DELETE FROM lines WHERE id = ?", [(lid,) for lid in stale])
        for t in imp.translations:
            conn.execute(
                "INSERT INTO translations (episode_id, lang, group_idx, first_line_idx, "
                "last_line_idx, text, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (eid, t["lang"], t["group_idx"], t["first_line_idx"], t["last_line_idx"],
                 t["text"], t["source"]),
            )
    msg = f"{eid}: wrote {sum(len(v) for v in imp.cues.values())} cues, {len(new_lines)} lines, {len(new_tr)} groups"
    if n_scenes:
        from .selection import scenes_splitting_groups
        bad = scenes_splitting_groups(conn, eid)
        if bad:
            msg += f"\nwarning: these scenes now split a translation group: {', '.join(bad)}"
    return msg


def import_episode(conn: sqlite3.Connection, episode_id: str, path: Path | None = None,
                   show: str | None = None) -> tuple[str, Imported]:
    show = show_name(conn, episode_id, show)
    path = path or source_path(episode_id)
    if not path.exists():
        raise ImportError_(f"source file not found: {path}")
    info = probe(path)
    streams = choose_streams(info)
    texts = extract_tracks(path, streams, WORK_DIR / episode_id / "subs")
    try:
        rel = str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        rel = str(path)
    imp = build(episode_id, info, texts, rel, show)
    n_fixed = apply_corrections(episode_id, imp.translations, load_corrections(episode_id),
                                f"corrections/{episode_id}.json")
    order = [c.start_ms for c in imp.cues["fr"]]
    msg = write(conn, imp)
    if n_fixed:
        msg += f"\napplied {n_fixed} translation corrections from corrections/{episode_id}.json"
    if order != sorted(order):
        msg += "\nwarning: French cues are not in time order; line numbers follow file order"
    return msg, imp


def stats(imp: Imported) -> str:
    multi = sum(1 for t in imp.translations if t["last_line_idx"] > t["first_line_idx"])
    empty = [t for t in imp.translations if not t["text"]]
    untranslated = sum(t["last_line_idx"] - t["first_line_idx"] + 1 for t in empty)
    used = {e for g in subtitle_align.build_groups(imp.cues["fr"], imp.cues["en"]) for e in g.en_idx}
    unused = len(imp.cues["en"]) - len(used)
    counts = ", ".join(f"{t} {len(imp.cues[t])}" for t in TRACKS)
    return (
        f"cues: {counts}; lines {len(imp.lines)}; groups {len(imp.translations)} "
        f"({multi} multi-line); lines without English {untranslated}; "
        f"English cues not used {unused}; speakers {sum(1 for l in imp.lines if l['speaker'])}; "
        f"song lines {sum(l['is_song'] for l in imp.lines)}"
    )
