"""Rendering the media of a scene: one Opus audio clip and one AV1 slideshow video.

The specification, with the reasons behind every number, is docs/media.md. Every
tunable setting lives in `RenderSettings` below; the values actually used are
written into `scenes.render_params` as JSON.

Runtime dependencies: the standard library, plus ffmpeg and ffprobe on PATH.
"""

from __future__ import annotations

import functools
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

from frenchirix.db import ASSETS_DIR, REPO_ROOT

RENDER_VERSION = 2


@dataclass(frozen=True)
class RenderSettings:
    """Every tunable setting of the render step. See docs/media.md."""

    # The clip window
    padding_ms: int = 2000  # added before the core and after it, clamped to the episode
    guard_ms: int = 400  # full volume this long before the core starts and after it ends
    fade_curve: str = "hsin"  # ffmpeg afade curve; hsin = half-sine S-curve, (1 - cos(pi x)) / 2

    # Audio: cut, downmix, gain
    sample_rate: int = 48000
    # Decoding starts this long before the clip and is discarded, so the decoder has
    # settled (E-AC3 blocks overlap) before the first sample that is kept.
    audio_preroll_ms: int = 1000
    downmix_left: str = "FL+0.7071*FC+0.7071*SL"  # LFE dropped
    downmix_right: str = "FR+0.7071*FC+0.7071*SR"
    # Show-wide constant. Highest true peak of the downmix over S01E01-E05 is +0.84 dBTP
    # (S01E02); -2.0 dB keeps every episode at or below -1.16 dBTP. docs/media.md.
    gain_db: float = -2.0

    # Audio: codec
    audio_codec: str = "libopus"
    audio_bitrate: str = "160k"
    audio_vbr: str = "on"
    audio_application: str = "audio"
    audio_frame_duration_ms: int = 20
    # Integrated loudness needs at least one 400 ms gating block (ITU-R BS.1770);
    # shorter clips get NULL.
    loudness_min_ms: int = 400

    # Slideshow video: frames
    frame_interval_ms: int = 2000
    # The last frame is the one on screen this long before the clip ends (one source
    # frame at 24 fps), so it is displayed from its own timestamp to the end of the clip.
    end_frame_offset_ms: int = 42
    # A grid frame closer than this to the end frame is dropped as near-duplicate.
    min_frame_gap_ms: int = 500
    video_height: int = 400
    scale_flags: str = "lanczos"

    # Slideshow video: codec (chosen by a bake-off; its conclusion is in docs/media.md)
    video_codec: str = "libaom-av1"
    video_crf: int = 40
    video_preset: int = 3  # -cpu-used for libaom-av1, -preset for libsvtav1
    # 8-bit on purpose: 10-bit AV1 decodes to solid black in GPU-accelerated Chromium on
    # this machine while reporting no error. See "Why 8-bit" in docs/media.md.
    video_pix_fmt: str = "yuv420p"
    video_codec_params: str = "tune=ssim"  # passed as -aom-params / -svtav1-params
    # The source is untagged HD, i.e. BT.709. Tagged explicitly so that players do not
    # guess BT.601 from the small frame size.
    video_colorspace: str = "bt709"
    video_time_base: str = "1/1000"  # millisecond timestamps, so frames start exactly on time


SETTINGS = RenderSettings()


# ---------------------------------------------------------------------------
# Arithmetic: window, fades, frame times


@dataclass(frozen=True)
class ClipWindow:
    clip_start_ms: int
    clip_end_ms: int
    fade_in_ms: int
    fade_out_ms: int

    @property
    def duration_ms(self) -> int:
        return self.clip_end_ms - self.clip_start_ms


def clip_window(
    core_start_ms: int,
    core_end_ms: int,
    episode_duration_ms: int,
    settings: RenderSettings = SETTINGS,
) -> ClipWindow:
    """The padded clip window and its fade lengths.

    Padding is clamped to the episode's bounds. The guard next to the core stays at
    full volume; the fade takes whatever padding remains, down to zero.
    """
    if not 0 <= core_start_ms <= core_end_ms:
        raise ValueError(f"bad core {core_start_ms}..{core_end_ms}")
    core_end_ms = min(core_end_ms, episode_duration_ms)
    core_start_ms = min(core_start_ms, core_end_ms)
    clip_start = max(0, core_start_ms - settings.padding_ms)
    clip_end = min(episode_duration_ms, core_end_ms + settings.padding_ms)
    fade_in = max(0, (core_start_ms - clip_start) - settings.guard_ms)
    fade_out = max(0, (clip_end - core_end_ms) - settings.guard_ms)
    return ClipWindow(clip_start, clip_end, fade_in, fade_out)


def frame_times(
    window: ClipWindow, core_start_ms: int, settings: RenderSettings = SETTINGS
) -> list[int]:
    """Clip-relative times (ms) at which slideshow frames appear.

    One at 0, one at the core start and every `frame_interval_ms` after it, and one
    showing the end of the clip. Each frame is displayed until the next one.
    """
    duration = window.duration_ms
    end_t = duration - settings.end_frame_offset_ms
    if end_t <= 0:
        return [0]
    times = {0, end_t}
    t = core_start_ms - window.clip_start_ms
    while t < end_t:
        if t > 0 and end_t - t >= settings.min_frame_gap_ms:
            times.add(t)
        t += settings.frame_interval_ms
    return sorted(times)


# ---------------------------------------------------------------------------
# ffmpeg plumbing


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    env = dict(os.environ, SVT_LOG="1")  # SVT-AV1 logs errors only
    proc = subprocess.run(cmd, capture_output=True, env=env, **kwargs)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace")[-2000:]
        raise RuntimeError(f"command failed ({proc.returncode}): {' '.join(cmd)}\n{err}")
    return proc


def _s(ms: float) -> str:
    """Milliseconds as an ffmpeg seconds argument."""
    return f"{ms / 1000:.6f}"


# ---------------------------------------------------------------------------
# Audio


def audio_filter(window: ClipWindow, seek_ms: int, *, fades: bool = True,
                 settings: RenderSettings = SETTINGS) -> str:
    """The filter chain from the decoded 5.1 stream to the final stereo PCM.

    Decoding starts at `seek_ms`; the cut is made on sample numbers counted from
    there, so the first kept sample is exactly the one at `clip_start_ms`.
    """
    sr = settings.sample_rate
    if (window.clip_start_ms - seek_ms) * sr % 1000 or window.duration_ms * sr % 1000:
        raise ValueError("window is not on a whole sample")
    first = (window.clip_start_ms - seek_ms) * sr // 1000
    count = window.duration_ms * sr // 1000
    chain = [
        f"pan=stereo|c0={settings.downmix_left}|c1={settings.downmix_right}",
        "aformat=sample_fmts=flt",
        f"atrim=start_sample={first}:end_sample={first + count}",
        "asetpts=PTS-STARTPTS",
        f"volume={settings.gain_db}dB:precision=float",
    ]
    if fades and window.fade_in_ms > 0:
        n = window.fade_in_ms * sr // 1000
        chain.append(f"afade=t=in:start_sample=0:nb_samples={n}:curve={settings.fade_curve}")
    if fades and window.fade_out_ms > 0:
        n = window.fade_out_ms * sr // 1000
        chain.append(
            f"afade=t=out:start_sample={count - n}:nb_samples={n}:curve={settings.fade_curve}"
        )
    return ",".join(chain)


def audio_input_args(source: Path, stream: int, window: ClipWindow,
                     settings: RenderSettings = SETTINGS) -> tuple[list[str], int]:
    seek_ms = max(0, window.clip_start_ms - settings.audio_preroll_ms)
    args = ["-ss", _s(seek_ms), "-i", str(source), "-map", f"0:{stream}"]
    return args, seek_ms


def render_pcm(source: Path, stream: int, window: ClipWindow, *, fades: bool = True,
               settings: RenderSettings = SETTINGS) -> bytes:
    """The clip's final PCM (interleaved float32 stereo) before encoding.

    This is the exact signal fed to the Opus encoder; used by the acceptance test.
    """
    inp, seek_ms = audio_input_args(source, stream, window, settings)
    af = audio_filter(window, seek_ms, fades=fades, settings=settings)
    cmd = ["ffmpeg", "-nostdin", "-v", "error", *inp, "-af", af, "-f", "f32le", "-"]
    return _run(cmd).stdout


def encode_audio(source: Path, stream: int, window: ClipWindow, out: Path,
                 settings: RenderSettings = SETTINGS) -> None:
    inp, seek_ms = audio_input_args(source, stream, window, settings)
    af = audio_filter(window, seek_ms, fades=True, settings=settings)
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error", "-y", *inp, "-af", af,
        "-c:a", settings.audio_codec, "-b:a", settings.audio_bitrate,
        "-vbr", settings.audio_vbr, "-application", settings.audio_application,
        "-frame_duration", str(settings.audio_frame_duration_ms),
        "-ac", "2", "-ar", str(settings.sample_rate),
        "-map_metadata", "-1", "-f", "ogg", str(out),
    ]
    _run(cmd)


_LOUD_I = re.compile(r"Integrated loudness:\s*I:\s*(-?[\d.]+|-?inf|nan) LUFS", re.S)
_TRUE_PEAK = re.compile(r"True peak:\s*Peak:\s*(-?[\d.]+|-?inf|nan) dBFS", re.S)


def measure_audio(path: Path, duration_ms: int,
                  settings: RenderSettings = SETTINGS) -> tuple[float | None, float | None]:
    """Integrated loudness (LUFS) and true peak (dBTP) of an encoded clip.

    Returns None for a value that is undefined: loudness of a clip shorter than one
    gating block or with every block below the absolute gate, peak of pure silence.
    """
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path),
           "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"]
    err = _run(cmd).stderr.decode("utf-8", "replace")
    summary = err[err.rfind("Summary:"):]

    def value(rx: re.Pattern) -> float | None:
        m = rx.search(summary)
        if not m:
            return None
        v = float(m.group(1))
        return v if math.isfinite(v) else None

    lufs = value(_LOUD_I)
    peak = value(_TRUE_PEAK)
    # ffmpeg reports -70.0 when no block passes the absolute gate: undefined, not a level.
    if duration_ms < settings.loudness_min_ms or lufs is None or lufs <= -70.0:
        lufs = None
    if peak is not None and peak <= -140:
        peak = None
    return lufs, peak


# ---------------------------------------------------------------------------
# Video


def grab_frame(source: Path, t_ms: int, out: Path, fps: float,
               settings: RenderSettings = SETTINGS) -> bool:
    """Write the source frame on screen at episode time `t_ms`, scaled, as a 1-frame NUT.

    An input seek returns the first frame whose timestamp is at or after the seek
    point, so seeking to just under one frame period earlier yields the frame that
    is displayed at `t_ms`. Returns False when there is no frame there.
    """
    frame_ms = 1000.0 / fps
    seek = max(0.0, t_ms - frame_ms + 0.5)
    vf = f"scale=-2:{settings.video_height}:flags={settings.scale_flags},setsar=1"
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", _s(seek), "-i", str(source),
           "-map", "0:v:0", "-frames:v", "1", "-vf", vf, "-pix_fmt", "yuv420p",
           "-f", "nut", str(out)]
    _run(cmd)
    return out.exists() and out.stat().st_size > 0 and _has_video_frame(out)


def _has_video_frame(path: Path) -> bool:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return proc.stdout.strip() not in ("", "0", "N/A")


def video_codec_args(settings: RenderSettings = SETTINGS) -> list[str]:
    args = ["-c:v", settings.video_codec, "-pix_fmt", settings.video_pix_fmt]
    if settings.video_codec == "libsvtav1":
        args += ["-crf", str(settings.video_crf), "-preset", str(settings.video_preset)]
        if settings.video_codec_params:
            args += ["-svtav1-params", settings.video_codec_params]
    elif settings.video_codec == "libaom-av1":
        args += ["-crf", str(settings.video_crf), "-b:v", "0",
                 "-cpu-used", str(settings.video_preset), "-row-mt", "1"]
        if settings.video_codec_params:
            args += ["-aom-params", settings.video_codec_params]
    else:
        raise ValueError(f"unsupported video codec {settings.video_codec}")
    return args


def encode_slideshow(frames: list[Path], times_ms: list[int], duration_ms: int,
                     out: Path, workdir: Path, settings: RenderSettings = SETTINGS,
                     extra_vf: str | None = None) -> None:
    """Encode still frames into an MP4 where frame i is shown from times_ms[i]."""
    lines = ["ffconcat version 1.0"]
    bounds = times_ms[1:] + [duration_ms]
    for path, start, end in zip(frames, times_ms, bounds):
        lines.append(f"file '{path.resolve()}'")
        lines.append(f"duration {_s(end - start)}")
    listing = workdir / "frames.ffconcat"
    listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0",
           "-i", str(listing), "-map", "0:v:0"]
    c = settings.video_colorspace
    vf = f"setparams=color_primaries={c}:color_trc={c}:colorspace={c}:range=tv"
    if extra_vf:  # bake-off only: constant frame rate with duplicated frames
        cmd += ["-vf", f"{vf},{extra_vf}", "-fps_mode", "cfr"]
    else:
        cmd += ["-vf", vf, "-fps_mode", "passthrough", "-enc_time_base", settings.video_time_base]
    cmd += [*video_codec_args(settings), "-an", "-map_metadata", "-1",
            "-video_track_timescale", "1000", "-movflags", "+faststart", "-f", "mp4",
            str(out)]
    _run(cmd)


def render_video(source: Path, fps: float, window: ClipWindow, times_ms: list[int],
                 out: Path, workdir: Path, settings: RenderSettings = SETTINGS,
                 extra_vf: str | None = None) -> None:
    frames: list[Path] = []
    for i, t in enumerate(times_ms):
        path = workdir / f"frame{i:03d}.nut"
        if not grab_frame(source, window.clip_start_ms + t, path, fps, settings):
            if not frames:
                raise RuntimeError(f"no video frame at {window.clip_start_ms + t} ms")
            shutil.copyfile(frames[-1], path)  # past the last frame of the episode
        frames.append(path)
    encode_slideshow(frames, times_ms, window.duration_ms, out, workdir, settings, extra_vf)


# ---------------------------------------------------------------------------
# Probing results


def _packets_end_s(path: Path, select: str, interval: str | None = None) -> float:
    """Latest pts + duration (s) over the packets of one stream."""
    cmd = ["ffprobe", "-v", "error", "-select_streams", select]
    if interval:
        cmd += ["-read_intervals", interval]
    cmd += ["-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", str(path)]
    end = 0.0
    for line in _run(cmd).stdout.decode().split():
        pts, dur = line.split(",")[:2]
        if pts not in ("", "N/A") and dur not in ("", "N/A"):
            end = max(end, float(pts) + float(dur))
    return end


def media_duration_ms(path: Path) -> float:
    """Duration of the first stream in ms, from its packets (not the container header)."""
    return _packets_end_s(path, "0") * 1000


@functools.lru_cache(maxsize=None)
def media_end_ms(source: Path, audio_stream: int, tail_s: int = 60) -> int:
    """End (ms) of the shorter of the French audio stream and the first video stream.

    Reads only the last `tail_s` seconds of packets.
    """
    proc = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(source)])
    start = max(0.0, float(proc.stdout.decode().strip()) - tail_s)
    ends = [_packets_end_s(source, sel, f"{start:.3f}%") for sel in (str(audio_stream), "v:0")]
    return int(min(ends) * 1000)


def ffmpeg_version() -> str:
    out = _run(["ffmpeg", "-version"]).stdout.decode().splitlines()[0]
    return out.split(" Copyright")[0]


# ---------------------------------------------------------------------------
# Scenes


@dataclass(frozen=True)
class RenderJob:
    scene_id: str
    source: Path
    audio_stream: int
    episode_duration_ms: int
    video_fps: float
    core_start_ms: int
    core_end_ms: int


def _job(conn: sqlite3.Connection, scene_id: str) -> RenderJob:
    row = conn.execute(
        """SELECT s.id, s.core_start_ms, s.core_end_ms, e.source_file, e.audio_stream,
                  e.duration_ms, e.video_fps
           FROM scenes s JOIN episodes e ON e.id = s.episode_id WHERE s.id = ?""",
        (scene_id,),
    ).fetchone()
    if row is None:
        raise KeyError(f"no scene {scene_id!r}")
    source = Path(row[3])
    if not source.is_absolute():
        source = REPO_ROOT / source
    # The container duration can run past the last audio or video packet (S01E05 by
    # 11 s), so clips are clamped to where both streams still have data.
    duration = min(row[5], media_end_ms(source, row[4]))
    return RenderJob(row[0], source, row[4], duration, row[6], row[1], row[2])


def _is_rendered(conn: sqlite3.Connection, scene_id: str, assets_dir: Path) -> bool:
    row = conn.execute(
        "SELECT audio_file, video_file, render_params FROM scenes WHERE id = ?", (scene_id,)
    ).fetchone()
    if row is None or row[0] is None or row[1] is None or row[2] is None:
        return False
    return (assets_dir / row[0]).is_file() and (assets_dir / row[1]).is_file()


def _render_job(job: RenderJob, assets_dir: Path, settings: RenderSettings,
                ffmpeg: str) -> dict:
    """Produce both files for one scene and return the column values. No DB access."""
    window = clip_window(job.core_start_ms, job.core_end_ms, job.episode_duration_ms, settings)
    times = frame_times(window, job.core_start_ms, settings)
    audio_rel = f"audio/{job.scene_id}.opus"
    video_rel = f"video/{job.scene_id}.mp4"
    audio_path = assets_dir / audio_rel
    video_path = assets_dir / video_rel
    assets_dir.mkdir(parents=True, exist_ok=True)
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.parent.mkdir(parents=True, exist_ok=True)

    # Work inside assets_dir so the finished files can be renamed into place atomically.
    with tempfile.TemporaryDirectory(prefix=f".render-{job.scene_id}-", dir=assets_dir) as tmp:
        tmpdir = Path(tmp)
        audio_tmp = tmpdir / "audio.opus"
        video_tmp = tmpdir / "video.mp4"
        encode_audio(job.source, job.audio_stream, window, audio_tmp, settings)
        render_video(job.source, job.video_fps, window, times, video_tmp, tmpdir, settings)
        lufs, peak = measure_audio(audio_tmp, window.duration_ms, settings)
        os.replace(audio_tmp, audio_path)  # same filesystem: atomic
        os.replace(video_tmp, video_path)

    params = {"render_version": RENDER_VERSION, **asdict(settings), "ffmpeg": ffmpeg}
    return {
        "clip_start_ms": window.clip_start_ms,
        "clip_end_ms": window.clip_end_ms,
        "fade_in_ms": window.fade_in_ms,
        "fade_out_ms": window.fade_out_ms,
        "audio_file": audio_rel,
        "video_file": video_rel,
        "frame_times_ms": json.dumps(times),
        "audio_lufs": None if lufs is None else round(lufs, 1),
        "audio_peak_db": None if peak is None else round(peak, 1),
        "render_params": json.dumps(params, sort_keys=True),
    }


def _write(conn: sqlite3.Connection, scene_id: str, values: dict) -> None:
    cols = ", ".join(f"{k} = ?" for k in values)
    conn.execute(f"UPDATE scenes SET {cols} WHERE id = ?", (*values.values(), scene_id))
    conn.commit()


def render_scene(conn: sqlite3.Connection, scene_id: str, *, force: bool = False,
                 assets_dir: Path = ASSETS_DIR, settings: RenderSettings = SETTINGS) -> None:
    """Render one scene's audio and video and fill its render columns."""
    if not force and _is_rendered(conn, scene_id, assets_dir):
        return
    job = _job(conn, scene_id)
    _write(conn, scene_id, _render_job(job, assets_dir, settings, ffmpeg_version()))


def render_scenes(conn: sqlite3.Connection, scene_ids, *, force: bool = False,
                  jobs: int | None = None, assets_dir: Path = ASSETS_DIR,
                  settings: RenderSettings = SETTINGS) -> None:
    """Render several scenes in parallel. Database access stays on the calling thread.

    Scenes that fail are reported together at the end, after the others are written.
    """
    ids = list(dict.fromkeys(scene_ids))  # a scene twice would race on its own files
    todo = [sid for sid in ids if force or not _is_rendered(conn, sid, assets_dir)]
    if not todo:
        return
    work = [_job(conn, sid) for sid in todo]
    jobs = jobs or max(1, min(len(work), (os.cpu_count() or 4) // 2))
    ffmpeg = ffmpeg_version()
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(_render_job, job, assets_dir, settings, ffmpeg): job
                   for job in work}
        for fut in as_completed(futures):
            job = futures[fut]
            try:
                values = fut.result()
            except Exception as exc:  # keep rendering the others
                errors.append(f"{job.scene_id}: {exc}")
                continue
            _write(conn, job.scene_id, values)
    if errors:
        raise RuntimeError(f"{len(errors)} scene(s) failed:\n" + "\n".join(errors))


__all__ = [
    "ASSETS_DIR", "SETTINGS", "RenderSettings", "ClipWindow", "clip_window", "frame_times",
    "render_scene", "render_scenes", "render_pcm", "measure_audio", "media_duration_ms",
]
