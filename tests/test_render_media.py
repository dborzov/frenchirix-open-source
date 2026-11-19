"""Rendering real scene media: the PCM acceptance check, fades, sample accuracy,
durations, the MP4 container, and the database columns.

Tests that need the source episode are slow (run with `-m slow`) and skip when content/
is absent. They never touch assets/db.sqlite: each builds a temporary database and
assets directory.
"""

from __future__ import annotations

import array
import json
import math
import sqlite3
import subprocess
import struct
from pathlib import Path

import pytest

from frenchirix import render as R
from frenchirix.db import REPO_ROOT

# The original show's episode: the expected numbers below hold for that file only.
SOURCE = REPO_ROOT / "content" / "Asterix.S01E04.mkv"
STREAM = 3
EP_DURATION = 2_195_264
SR = 48_000

_absent = pytest.mark.skipif(not SOURCE.is_file(), reason="content/ episode not present")


def needs_content(test):
    """Reads content/: slow, and skipped when the episode is absent."""
    return pytest.mark.slow(_absent(test))

# A dialogue (clip 00:18.617-00:37.912) and a busy song passage.
DIALOGUE = ("s01e04-0001-0003", 20_617, 35_912)
SONG = ("s01e04-0004-0009", 43_400, 76_000)


# ---------------------------------------------------------------------------
# helpers


def make_db(path: Path, scenes, duration_ms: int = EP_DURATION) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.executescript((REPO_ROOT / "frenchirix" / "schema.sql").read_text(encoding="utf-8"))
    conn.execute(
        "INSERT INTO episodes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ("s01e04", "Asterix", 1, 4, "content/Asterix.S01E04.mkv", duration_ms,
         1920, 1080, 24.0, STREAM, "5.1(side)"),
    )
    for sid, core_start, core_end in scenes:
        first, last = (int(x) for x in sid.split("-")[1:])
        conn.execute(
            """INSERT INTO scenes (id, episode_id, first_line_idx, last_line_idx,
                   core_start_ms, core_end_ms, title, kind, selected_by, created_at)
               VALUES (?, 's01e04', ?, ?, ?, ?, 't', 'dialogue', 'manual', 'now')""",
            (sid, first, last, core_start, core_end),
        )
    conn.commit()
    return conn


def floats(data: bytes) -> array.array:
    a = array.array("f")
    a.frombytes(data)
    return a


def decode_pcm(path: Path) -> array.array:
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
                          "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True)
    return floats(out.stdout)


def best_lag(ref, other, start: int, length: int, max_lag: int) -> tuple[int, float, float]:
    """Lag (in samples) minimising the squared error of `other[i+lag]` against `ref[i]`.

    Returns (lag, error at that lag, error at the next-best lag).
    """
    errs = []
    for lag in range(-max_lag, max_lag + 1):
        e = 0.0
        for i in range(start, start + length):
            d = ref[i] - other[i + lag]
            e += d * d
        errs.append((e, lag))
    errs.sort()
    return errs[0][1], errs[0][0], errs[1][0]


def ffprobe_json(path: Path, *args: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-of", "json", *args, str(path)],
                         capture_output=True, check=True, text=True)
    return json.loads(out.stdout)


def top_level_boxes(path: Path) -> list[str]:
    data = path.read_bytes()
    boxes, i = [], 0
    while i + 8 <= len(data):
        size, kind = struct.unpack(">I4s", data[i:i + 8])
        if size == 1:
            size = struct.unpack(">Q", data[i + 8:i + 16])[0]
        boxes.append(kind.decode("latin-1"))
        if size == 0:
            break
        i += size
    return boxes


# ---------------------------------------------------------------------------
# the PCM acceptance check and the fades


@pytest.fixture(scope="module")
def dialogue_pcm():
    _, core_start, core_end = DIALOGUE
    w = R.clip_window(core_start, core_end, EP_DURATION)
    faded = floats(R.render_pcm(SOURCE, STREAM, w, fades=True))
    plain = floats(R.render_pcm(SOURCE, STREAM, w, fades=False))
    return w, faded, plain


@needs_content
def test_acceptance_full_volume_region_is_sample_identical(dialogue_pcm):
    w, faded, plain = dialogue_pcm
    n = w.duration_ms * SR // 1000
    assert len(faded) == len(plain) == 2 * n
    lo = 2 * (w.fade_in_ms * SR // 1000)
    hi = 2 * (n - w.fade_out_ms * SR // 1000)
    assert lo > 0 and hi < 2 * n
    # The full-volume region (guard + dialogue + guard) is bit-for-bit the same.
    assert faded[lo:hi].tobytes() == plain[lo:hi].tobytes()
    # ...and the fades really changed something outside it.
    assert faded[:lo].tobytes() != plain[:lo].tobytes()
    assert faded[hi:].tobytes() != plain[hi:].tobytes()


def _gains(faded, plain, first: int, count: int) -> list[tuple[int, float]]:
    """Per-sample gain faded/plain over left-channel samples first..first+count."""
    out = []
    for k in range(count):
        i = 2 * (first + k)
        if abs(plain[i]) > 1e-3:
            out.append((k, faded[i] / plain[i]))
    return out


@needs_content
def test_fade_in_rises_monotonically_from_near_silence(dialogue_pcm):
    w, faded, plain = dialogue_pcm
    n_in = w.fade_in_ms * SR // 1000
    gains = _gains(faded, plain, 0, n_in)
    assert len(gains) > n_in // 4  # enough non-silent samples to judge
    for k, g in gains:  # follows the half-sine S-curve, (1 - cos(pi x)) / 2
        expected = (1 - math.cos(math.pi * k / n_in)) / 2
        assert abs(g - expected) < 1e-3, (k, g, expected)
    seq = [g for _, g in gains]
    assert all(b >= a - 1e-6 for a, b in zip(seq, seq[1:]))
    # near silence at the start: below -40 dB over the first 20 ms
    assert max(g for k, g in gains if k < SR // 50) < 0.01
    # level, block by block (10 ms RMS of the faded signal relative to the plain one)
    block = SR // 100
    ratios = []
    for b in range(n_in // block):
        num = sum(faded[2 * i] ** 2 for i in range(b * block, (b + 1) * block))
        den = sum(plain[2 * i] ** 2 for i in range(b * block, (b + 1) * block))
        ratios.append(math.sqrt(num / den) if den > 0 else None)
    ratios = [r for r in ratios if r is not None]
    assert ratios[0] < 0.01 and ratios[-1] > 0.99
    assert all(b >= a - 1e-6 for a, b in zip(ratios, ratios[1:]))


@needs_content
def test_fade_out_falls_monotonically_to_near_silence(dialogue_pcm):
    w, faded, plain = dialogue_pcm
    n = w.duration_ms * SR // 1000
    n_out = w.fade_out_ms * SR // 1000
    gains = _gains(faded, plain, n - n_out, n_out)
    assert len(gains) > n_out // 4
    seq = [g for _, g in gains]
    assert all(b <= a + 1e-6 for a, b in zip(seq, seq[1:]))
    assert seq[0] > 0.99 and max(g for k, g in gains if k > n_out - SR // 50) < 0.01


@needs_content
def test_cut_is_sample_accurate_against_full_decode(dialogue_pcm):
    """The clip PCM lines up exactly with a decode of the episode from its first sample."""
    w, _, plain = dialogue_pcm
    s = R.SETTINGS
    first = w.clip_start_ms * SR // 1000
    af = (f"pan=stereo|c0={s.downmix_left}|c1={s.downmix_right},aformat=sample_fmts=flt,"
          f"atrim=start_sample={first}:end_sample={first + len(plain) // 2},"
          f"volume={s.gain_db}dB:precision=float")
    ref = floats(subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(SOURCE), "-map", f"0:{STREAM}", "-af", af,
         "-f", "f32le", "-"], capture_output=True, check=True).stdout)
    assert len(ref) == len(plain)
    left_ref, left = ref[0::2], plain[0::2]
    # a chunk inside the dialogue, 5 s in
    lag, err, next_err = best_lag(left_ref, left, 5 * SR, 4800, 48)
    assert lag == 0
    # The E-AC3 decoder dithers zero-bit mantissas from a random state that depends on
    # where decoding started, so the two decodes differ by low-level noise only.
    energy = sum(x * x for x in left_ref[5 * SR:5 * SR + 4800])
    assert err < 1e-3 * energy < next_err


# ---------------------------------------------------------------------------
# full render of scenes into a temporary database


@pytest.fixture(scope="module")
def rendered(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("render")
    conn = make_db(tmp / "db.sqlite", [DIALOGUE, SONG])
    assets = tmp / "assets"
    R.render_scenes(conn, [DIALOGUE[0], SONG[0]], jobs=2, assets_dir=assets)
    return conn, assets


def scene_row(conn, sid):
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT * FROM scenes WHERE id = ?", (sid,)).fetchone()
    finally:
        conn.row_factory = None


@needs_content
def test_render_fills_columns(rendered):
    conn, assets = rendered
    row = scene_row(conn, DIALOGUE[0])
    assert (row["clip_start_ms"], row["clip_end_ms"]) == (18_617, 37_912)
    assert (row["fade_in_ms"], row["fade_out_ms"]) == (1600, 1600)
    assert row["audio_file"] == f"audio/{DIALOGUE[0]}.opus"
    assert row["video_file"] == f"video/{DIALOGUE[0]}.mp4"
    assert (assets / row["audio_file"]).is_file() and (assets / row["video_file"]).is_file()
    assert json.loads(row["frame_times_ms"])[:3] == [0, 2000, 4000]
    assert -40 < row["audio_lufs"] < -10
    assert -30 < row["audio_peak_db"] < 0
    params = json.loads(row["render_params"])
    assert params["gain_db"] == R.SETTINGS.gain_db
    assert params["audio_bitrate"] == "160k" and params["video_height"] == 400
    assert params["ffmpeg"].startswith("ffmpeg version")
    assert not list(assets.glob(".render-*"))  # temporary directories cleaned up


@needs_content
@pytest.mark.parametrize("scene", [DIALOGUE, SONG], ids=["dialogue", "song"])
def test_audio_and_video_durations_match_window(rendered, scene):
    conn, assets = rendered
    row = scene_row(conn, scene[0])
    expected = row["clip_end_ms"] - row["clip_start_ms"]
    pcm = decode_pcm(assets / row["audio_file"])
    assert len(pcm) == 2 * expected * SR // 1000  # exact to the sample
    video_ms = R.media_duration_ms(assets / row["video_file"])
    assert abs(video_ms - expected) <= 50


@needs_content
def test_audio_file_format_and_alignment(rendered):
    conn, assets = rendered
    row = scene_row(conn, DIALOGUE[0])
    path = assets / row["audio_file"]
    info = ffprobe_json(path, "-show_streams", "-show_format")
    (st,) = info["streams"]
    assert info["format"]["format_name"] == "ogg"
    assert (st["codec_name"], st["sample_rate"], st["channels"]) == ("opus", "48000", 2)
    br = int(info["format"]["bit_rate"])
    assert 120_000 < br < 200_000
    # Decoded Opus starts at the same sample as the PCM fed to the encoder.
    w = R.ClipWindow(row["clip_start_ms"], row["clip_end_ms"], row["fade_in_ms"], row["fade_out_ms"])
    ref = floats(R.render_pcm(SOURCE, STREAM, w))[0::2]
    dec = decode_pcm(path)[0::2]
    lag, _, _ = best_lag(ref, dec, 5 * SR, 2400, 400)
    assert lag == 0


@needs_content
def test_video_container(rendered):
    conn, assets = rendered
    row = scene_row(conn, DIALOGUE[0])
    path = assets / row["video_file"]
    info = ffprobe_json(path, "-show_streams", "-show_packets")
    assert len(info["streams"]) == 1  # no audio track
    st = info["streams"][0]
    assert st["codec_name"] == "av1" and st["profile"] == "Main"
    assert st["pix_fmt"] == "yuv420p"  # 10-bit renders black in Chromium; see docs/media.md
    assert (st["width"], st["height"]) == (712, 400)
    assert st.get("color_space") == "bt709"
    boxes = top_level_boxes(path)
    assert boxes.index("moov") < boxes.index("mdat")  # faststart
    # every slideshow frame starts exactly at its stored time
    pts = sorted(round(float(p["pts_time"]) * 1000) for p in info["packets"])
    assert pts == json.loads(row["frame_times_ms"])
    # decodes without a single error
    out = subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(path), "-f", "null", "-"],
                         capture_output=True, text=True)
    assert out.returncode == 0 and out.stderr == ""


@needs_content
def test_existing_files_are_skipped_unless_forced(rendered):
    conn, assets = rendered
    audio = assets / f"audio/{DIALOGUE[0]}.opus"
    before = audio.stat().st_mtime_ns
    R.render_scene(conn, DIALOGUE[0], assets_dir=assets)
    assert audio.stat().st_mtime_ns == before
    R.render_scene(conn, DIALOGUE[0], assets_dir=assets, force=True)
    assert audio.stat().st_mtime_ns != before


@needs_content
def test_scene_at_episode_end(tmp_path):
    """Clamped at the end of the episode, audio and video still cover the window.

    The episodes row claims a longer duration than the streams have (as the container
    of S01E05 does); the clip is clamped to the end of the media.
    """
    end = R.media_end_ms(SOURCE, STREAM)
    scene = ("s01e04-0900-0901", end - 3000, end - 200)
    conn = make_db(tmp_path / "db.sqlite", [scene], duration_ms=end + 5000)
    R.render_scene(conn, scene[0], assets_dir=tmp_path / "assets")
    row = scene_row(conn, scene[0])
    assert row["clip_end_ms"] == end
    assert row["fade_out_ms"] == 0
    expected = end - row["clip_start_ms"]
    assert len(decode_pcm(tmp_path / "assets" / row["audio_file"])) == 2 * expected * SR // 1000
    assert abs(R.media_duration_ms(tmp_path / "assets" / row["video_file"]) - expected) <= 50


# ---------------------------------------------------------------------------
# loudness measurement (synthetic input, no content needed)


def _synth(tmp: Path, name: str, lavfi: str) -> Path:
    path = tmp / name
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", lavfi, "-c:a", "libopus",
                    "-b:a", "160k", "-f", "ogg", str(path)], check=True)
    return path


def test_measure_short_clip_has_no_integrated_loudness(tmp_path):
    path = _synth(tmp_path, "short.opus", "sine=frequency=440:sample_rate=48000:duration=0.3")
    lufs, peak = R.measure_audio(path, 300)
    assert lufs is None
    assert peak is not None and -21 < peak < -15  # sine at 1/8 of full scale


def test_measure_silence_is_undefined(tmp_path):
    path = _synth(tmp_path, "silence.opus", "anullsrc=r=48000:cl=stereo:d=3")
    assert R.measure_audio(path, 3000) == (None, None)


def test_measure_tone(tmp_path):
    path = _synth(tmp_path, "tone.opus", "sine=frequency=1000:sample_rate=48000:duration=3")
    lufs, peak = R.measure_audio(path, 3000)
    # a full-scale/8 mono sine (ffmpeg's default amplitude): about -21 LUFS, -18 dBTP
    assert lufs is not None and -26 < lufs < -16
    assert peak is not None and -21 < peak < -15
