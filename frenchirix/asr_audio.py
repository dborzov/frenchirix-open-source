"""Audio input and GPU housekeeping shared by transcription and forced alignment.

Both steps listen to the centre channel of the French audio stream only: dialogue
sits there about 11 dB above the front-left channel, so it is close to isolated
speech. See docs/transcription.md.

Runtime dependencies: numpy (installed with the `asr` group) and ffmpeg on PATH.
"""

from __future__ import annotations

import gc
import shutil
import sqlite3
import subprocess
from pathlib import Path

from frenchirix.db import REPO_ROOT

SAMPLE_RATE = 16_000  # what both Whisper and the wav2vec2 aligner expect
CHANNEL_FILTER = "pan=mono|c0=FC"


def episode_source(conn: sqlite3.Connection, episode_id: str) -> tuple[Path, int, int]:
    """(source file, ffmpeg index of the French audio stream, duration in ms)."""
    row = conn.execute(
        "SELECT source_file, audio_stream, duration_ms FROM episodes WHERE id = ?", (episode_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"unknown episode {episode_id!r}")
    path = Path(row[0])
    if not path.is_absolute():
        path = REPO_ROOT / path
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; the source episodes live in content/")
    return path, int(row[1]), int(row[2])


def ffmpeg_command(source: Path, stream: int, start_ms: int | None = None,
                   end_ms: int | None = None) -> list[str]:
    """ffmpeg arguments that write the centre channel as 16 kHz mono float32 to stdout."""
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error"]
    if start_ms is not None:
        cmd += ["-ss", f"{start_ms / 1000:.3f}"]
    cmd += ["-i", str(source)]
    if end_ms is not None:
        cmd += ["-t", f"{(end_ms - (start_ms or 0)) / 1000:.3f}"]
    cmd += ["-map", f"0:{stream}", "-af", f"{CHANNEL_FILTER},aresample={SAMPLE_RATE}",
            "-ac", "1", "-f", "f32le", "-"]
    return cmd


def load_centre_channel(source: Path, stream: int, start_ms: int | None = None,
                        end_ms: int | None = None):
    """The centre channel of `stream`, 16 kHz mono float32 numpy array.

    With no bounds, the whole episode (26 minutes is about 100 MB). Sample i is at
    `start_ms + i / 16` ms on the episode timeline.
    """
    import numpy as np

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is not on PATH")
    out = subprocess.run(ffmpeg_command(source, stream, start_ms, end_ms),
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def cut(audio, start_ms: int, end_ms: int):
    """Samples of a whole-episode array between two episode times."""
    a = max(0, start_ms * SAMPLE_RATE // 1000)
    b = max(a, end_ms * SAMPLE_RATE // 1000)
    return audio[a:b]


def preload_cuda_libraries() -> None:
    """Load the pip-installed cuBLAS 12 and cuDNN 9 so CTranslate2 can find them.

    CTranslate2 dlopens libcublas.so.12 and libcudnn*.so.9 by name and does not look
    inside site-packages/nvidia, so without this it fails with "Library libcublas.so.12
    is not found". Loading them first with RTLD_GLOBAL makes the names resolve. cuDNN
    comes from torch's cu13 wheel; cuBLAS 12 from nvidia-cublas-cu12. Does nothing
    when the packages are absent (CPU-only installs).
    """
    import ctypes
    import importlib.util

    spec = importlib.util.find_spec("nvidia")
    if spec is None or not spec.submodule_search_locations:
        return
    root = Path(next(iter(spec.submodule_search_locations)))
    names = ["cublas/lib/libcublasLt.so.12", "cublas/lib/libcublas.so.12",
             "cudnn/lib/libcudnn.so.9", "cudnn/lib/libcudnn_graph.so.9",
             "cudnn/lib/libcudnn_engines_precompiled.so.9",
             "cudnn/lib/libcudnn_engines_runtime_compiled.so.9",
             "cudnn/lib/libcudnn_heuristic.so.9", "cudnn/lib/libcudnn_ops.so.9",
             "cudnn/lib/libcudnn_cnn.so.9", "cudnn/lib/libcudnn_adv.so.9"]
    for name in names:
        path = root / name
        if path.exists():
            ctypes.CDLL(str(path), mode=ctypes.RTLD_GLOBAL)


def gpu_free_mib() -> int | None:
    """Free memory on GPU 0 according to nvidia-smi, or None when there is no GPU."""
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits", "-i", "0"],
            capture_output=True, text=True, check=True, timeout=10).stdout
        return int(out.strip().splitlines()[0])
    except (subprocess.SubprocessError, ValueError, IndexError):
        return None


def check_gpu(need_mib: int) -> str:
    """'cuda' when nvidia-smi reports at least `need_mib` free, otherwise 'cpu'.

    The GPU is shared with the desktop and a dictation daemon (about 4.8 GB in use at
    idle), so the check runs right before a model is loaded.
    """
    free = gpu_free_mib()
    if free is None:
        return "cpu"
    if free < need_mib:
        print(f"warning: only {free} MiB free on the GPU, {need_mib} MiB wanted; using the CPU")
        return "cpu"
    return "cuda"


def release_gpu() -> None:
    """Free cached GPU memory after a model has been dropped."""
    gc.collect()
    try:
        import torch
    except ImportError:
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
