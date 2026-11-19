"""Whisper on a few seconds of S01E04. Skips without the `asr` group, the weights or content/.
Slow: run with `-m slow`."""

from __future__ import annotations

import pytest

from frenchirix.db import REPO_ROOT

pytestmark = pytest.mark.slow
# The original show's episode: the expected numbers below hold for that file only.
SOURCE = REPO_ROOT / "content" / "Asterix.S01E04.mkv"
if not SOURCE.exists():
    pytest.skip("content/ is absent", allow_module_level=True)

from frenchirix import transcribe  # noqa: E402
from frenchirix.asr_audio import load_centre_channel  # noqa: E402

try:
    transcribe.resolve_model()
except FileNotFoundError:
    pytest.skip("Whisper weights are not in the local cache", allow_module_level=True)


def test_recognises_a_known_line():
    pytest.importorskip("faster_whisper")  # here, not at import: collecting stays fast
    pytest.importorskip("numpy")
    # Line 2 of S01E04 (18.6-21.8 s); its subtitle is "Métadata, on a marché toute la nuit. J'en peux plus !"
    audio = load_centre_channel(SOURCE, 3, 17_875, 22_600)
    model, runtime = transcribe.load_model()
    try:
        words = transcribe.recognise(model, audio, 17_875, prompt="Métadata, Astérix, Obélix.")
    finally:
        del model
    text = " ".join(w[2] for w in words).lower()
    assert "marché toute la nuit" in text
    assert all(17_875 <= s <= e <= 22_600 for s, e, _, _ in words)
    assert all(a[0] <= b[0] for a, b in zip(words, words[1:]))
    assert runtime["model"].startswith("faster-whisper ")
