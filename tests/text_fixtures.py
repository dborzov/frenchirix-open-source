"""Synthetic subtitle tracks and ffprobe output shared by the text-pipeline tests."""

from __future__ import annotations


def ts(ms: int) -> str:
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def srt(*cues: tuple[int, int, str]) -> str:
    """SRT text from (start_ms, end_ms, text) tuples."""
    blocks = [f"{i}\n{ts(a)} --> {ts(b)}\n{t}\n" for i, (a, b, t) in enumerate(cues, start=1)]
    return "\n".join(blocks)


FAKE_INFO = {
    "format": {"duration": "120.500"},
    "streams": [
        {"index": 0, "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
         "r_frame_rate": "24/1", "avg_frame_rate": "24/1"},
        {"index": 1, "codec_type": "audio", "codec_name": "eac3", "channel_layout": "5.1(side)",
         "tags": {"language": "rus"}},
        {"index": 3, "codec_type": "audio", "codec_name": "eac3", "channel_layout": "5.1(side)",
         "tags": {"language": "fre"}},
        {"index": 7, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "eng"}},
        {"index": 8, "codec_type": "subtitle", "codec_name": "subrip",
         "tags": {"language": "eng", "title": "British"}},
        {"index": 10, "codec_type": "subtitle", "codec_name": "subrip",
         "tags": {"language": "eng", "title": "British (SDH)"}},
        {"index": 11, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "fre"}},
        {"index": 12, "codec_type": "subtitle", "codec_name": "subrip",
         "tags": {"language": "fre", "title": "SDH"}},
    ],
}

# Five French lines; line 2-3 share one English cue, line 4 has two English
# cues, line 5 has no English at all. Lines 2-3 are sung; their English is one
# line on purpose, so other tests can compare it with a plain string.
FR = srt(
    (1000, 3000, "Bonjour, <i>Astérix</i> !"),
    (4000, 6000, "Il fait beau"),
    (6100, 8000, "aujourd'hui."),
    (9000, 13000, "- Tu viens ?\n- Non."),
    (14000, 14800, "Aïe !"),
)
SDH = srt(
    (0, 900, "[musique douce]"),
    (1000, 3000, "[Obélix] Bonjour, <i>Astérix</i> !"),
    (4000, 6000, "♪ Il fait beau ♪"),
    (6100, 8000, "♪ aujourd'hui. ♪"),
    (9000, 13000, "- [Obélix] Tu viens ?\n- [Astérix] Non."),
    (14000, 14800, "[César soupire] Aïe !"),
)
EN = srt(
    (1000, 3000, "Hello, <i>Asterix</i>!"),
    (4050, 8000, "Nice weather today."),
    (9000, 11000, "Are you coming?"),
    (11050, 13000, "No."),
    (20000, 22000, "ASTERIX & OBELIX: THE BIG FIGHT"),
)


def texts(fr: str = FR, sdh: str = SDH, en: str = EN) -> dict[str, str]:
    return {"fr": fr, "fr_sdh": sdh, "en": en}
