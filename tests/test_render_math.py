"""Clip window, fade and frame-time arithmetic of frenchirix.render (no media needed)."""

from dataclasses import replace

import pytest

from frenchirix.render import SETTINGS, ClipWindow, audio_filter, clip_window, frame_times

EP = 2_195_264  # episode duration, ms


def test_window_unclamped():
    w = clip_window(20_617, 35_912, EP)
    assert w == ClipWindow(18_617, 37_912, 1600, 1600)
    assert w.duration_ms == 19_295


def test_window_clamped_at_episode_start():
    # 1000 ms of room before the core: 400 guard + 600 fade
    assert clip_window(1000, 5000, EP) == ClipWindow(0, 7000, 600, 1600)
    # core at the very start: no padding, no fade
    assert clip_window(0, 5000, EP) == ClipWindow(0, 7000, 0, 1600)


def test_window_clamped_at_episode_end():
    w = clip_window(EP - 6000, EP - 1500, EP)
    assert w == ClipWindow(EP - 8000, EP, 1600, 1100)
    w = clip_window(EP - 6000, EP, EP)
    assert w.clip_end_ms == EP and w.fade_out_ms == 0


def test_padding_shorter_than_guard_gives_no_fade():
    # 250 ms of room at each end, less than the 400 ms guard: the fade shrinks to zero
    w = clip_window(250, EP - 250, EP)
    assert (w.clip_start_ms, w.clip_end_ms, w.fade_in_ms, w.fade_out_ms) == (0, EP, 0, 0)
    # exactly the guard: still no fade
    w = clip_window(400, 3000, EP)
    assert w.fade_in_ms == 0
    # one ms more than the guard: a 1 ms fade
    w = clip_window(401, 3000, EP)
    assert w.fade_in_ms == 1


def test_window_follows_settings():
    s = replace(SETTINGS, padding_ms=1000, guard_ms=200)
    assert clip_window(10_000, 12_000, EP, s) == ClipWindow(9000, 13_000, 800, 800)


def test_window_rejects_bad_core():
    with pytest.raises(ValueError):
        clip_window(5000, 4000, EP)


def test_frame_times_grid_anchored_on_core():
    w = clip_window(20_617, 35_912, EP)  # duration 19 295
    times = frame_times(w, 20_617)
    assert times[0] == 0
    assert times[1] == 2000  # core start, clip-relative
    assert times[1:-1] == list(range(2000, 18_001, 2000))
    assert times[-1] == 19_295 - SETTINGS.end_frame_offset_ms
    assert times == sorted(set(times))


def test_frame_times_grid_not_on_clip_start():
    # core starts 1 s into the episode: clip starts at 0, grid at 1000, 3000, ...
    w = clip_window(1000, 6000, EP)
    times = frame_times(w, 1000)
    assert times == [0, 1000, 3000, 5000, 7000, 8000 - 42]


def test_frame_times_drop_grid_frame_next_to_end_frame():
    # duration 8000, end frame at 7958; grid 2000, 4000, 6000 (7958-6000 >= 500: kept)
    w = ClipWindow(0, 8000, 1600, 1600)
    assert frame_times(w, 2000) == [0, 2000, 4000, 6000, 7958]
    # duration 8300: grid frame at 8000 would sit 258 ms before the end frame: dropped
    w = ClipWindow(0, 8300, 1600, 1600)
    assert frame_times(w, 2000) == [0, 2000, 4000, 6000, 8258]


def test_frame_times_core_at_clip_start():
    w = clip_window(0, 3000, EP)  # clip 0..5000
    assert frame_times(w, 0) == [0, 2000, 4000, 4958]


def test_frame_times_tiny_clip():
    assert frame_times(ClipWindow(0, 30, 0, 0), 0) == [0]


def test_audio_filter_cuts_on_samples():
    w = clip_window(20_617, 35_912, EP)
    seek = w.clip_start_ms - SETTINGS.audio_preroll_ms
    af = audio_filter(w, seek)
    assert "atrim=start_sample=48000:end_sample=974160" in af  # 48 000 + 19 295 * 48
    assert "afade=t=in:start_sample=0:nb_samples=76800:curve=hsin" in af
    assert "afade=t=out:start_sample=849360:nb_samples=76800:curve=hsin" in af
    assert f"volume={SETTINGS.gain_db}dB" in af
    for banned in ("loudnorm", "dynaudnorm", "acompressor", "alimiter", "compand"):
        assert banned not in af
    assert "afade" not in audio_filter(w, seek, fades=False)


def test_audio_filter_no_fade_when_none_fits():
    w = clip_window(300, 5000, EP)
    af = audio_filter(w, 0)
    assert "t=in" not in af and "t=out" in af
