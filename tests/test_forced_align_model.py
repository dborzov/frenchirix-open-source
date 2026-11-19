"""MMS_FA on one line of S01E04. Skips without the `asr` group, the weights or content/.
Slow: run with `-m slow`."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from frenchirix.db import REPO_ROOT

pytestmark = pytest.mark.slow
# The original show's episode: the expected numbers below hold for that file only.
SOURCE = REPO_ROOT / "content" / "Asterix.S01E04.mkv"
if not SOURCE.exists():
    pytest.skip("content/ is absent", allow_module_level=True)

from frenchirix import forced_align  # noqa: E402
from frenchirix.asr_audio import load_centre_channel  # noqa: E402
from frenchirix.text import split_words  # noqa: E402

torch_home = Path(os.environ.get("TORCH_HOME", Path.home() / ".cache" / "torch"))
if not (torch_home / "hub" / "checkpoints" / forced_align.CHECKPOINT_NAME).exists():
    pytest.skip("MMS_FA weights are not in the local cache", allow_module_level=True)


def test_aligns_a_known_line():
    pytest.importorskip("torchaudio")  # here, not at import: collecting stays fast
    # Line 3 of S01E04, subtitle 21.9-24.8 s; the region also holds the end of line 2.
    text = "Allez ! Encore une attraction à vérifier."
    words = [w for w, _, _ in split_words(text)]
    start = 21_166
    audio = load_centre_channel(SOURCE, 3, start, 25_583)
    aligner = forced_align.Aligner()
    try:
        targets = forced_align.build_targets([forced_align.LineText(3, words)])
        emission, frame_ms = aligner.emission(audio)
        spans = aligner.align(emission, targets.tokens)
    finally:
        aligner.close()
    times = forced_align.word_times(targets, spans, frame_ms=frame_ms, offset_ms=start)
    ordered = [times[(3, n)] for n in range(1, len(words) + 1)]
    assert 21_166 <= ordered[0].start_ms and ordered[-1].end_ms <= 25_583
    assert all(a.end_ms <= b.start_ms for a, b in zip(ordered, ordered[1:]))
    assert sum(t.score > 0.5 for t in ordered) >= len(words) - 1
    assert 19.5 < frame_ms < 20.5
