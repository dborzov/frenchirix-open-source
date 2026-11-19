# Scene media: audio and slideshow video

How `frenchirix render` cuts, fades and encodes the two files of each scene (`assets/audio/<id>.opus`, `assets/video/<id>.mp4`), with the reasons. Read before changing how scene audio or video is cut, faded or encoded. These files serve the review UI and `frenchirix check`; the app's own audio and frames are cut from the source by `export-app` with the same clip window ([app-export.md](app-export.md)).

## Rules that matter most

- **Test playback in a real browser window**, not only headless or with ffmpeg: a video can load without error and still show black ("Why 8-bit").
- Audio and video cover the same window, `clip_start_ms` to `clip_end_ms`, and start exactly at `clip_start_ms`. Durations agree to within 50 ms.
- Inside the full-volume region the audio is the source mix with one fixed gain: no compressor, limiter or loudness normaliser.
- Media are derived and can always be rebuilt from `content/` and the database, so formats are settings: all of them are in `RenderSettings` in `frenchirix/render.py` and copied into every scene's `render_params`. After changing one, re-render with `--force`.

## The clip window

A scene's **core** runs from the start of its first line to the end of its last (`core_start_ms`, `core_end_ms`): subtitle times at first, widened by `frenchirix retime` to the aligned speech ([pipeline.md](pipeline.md#retiming-scenes)). The clip adds padding on both sides:

```
clip_start        core_start                    core_end          clip_end
   |--- fade in ---|-guard-|===== dialogue =====|-guard-|--- fade out ---|
   0 ...... 1600 ms  400 ms                       400 ms   1600 ms
```

- **Padding**: 2000 ms before and after the core, clamped to the episode. The end bound is where both the French audio and the video still have packets, not the container duration (S01E05's container runs 11 s past its last packet).
- **Guard**: full volume from 400 ms before the core to 400 ms after it, because subtitle times only approximate where speech starts and stops.
- **Fades** take the rest of the padding (1600 ms each when nothing is clamped), on a half-sine S-curve. When clamping leaves less room than the guard, the fade shrinks first, down to zero.

The user asked for this shape: padding that fades in so loud music does not start abruptly, with the dialogue itself at full volume and undistorted.

## Audio

- **Source**: the French audio stream, E-AC3 5.1, 48 kHz. Dialogue sits almost entirely in the centre channel.
- **Downmix** to stereo with an explicit matrix, `L = FL + 0.7071·FC + 0.7071·SL`, `R = FR + 0.7071·FC + 0.7071·SR`, LFE dropped: what a viewer hears, music and effects included. Computed in 32-bit float, so source peaks above 0 dBFS are not clipped before the gain.
- **Gain**: one constant for the whole show, −2.0 dB (`gain_db`), so that no episode's downmix exceeds −1 dB true peak (the loudest, S01E02, peaks at +0.84 dBTP before the gain). One constant keeps the dialogue level consistent across scenes.
- **Cut**: sample-accurate. ffmpeg seeks 1000 ms before the clip (`audio_preroll_ms`, so the decoder has settled) and `atrim` keeps samples from exactly the clip start. Two renders of the same window are bit-identical.
- **Codec**: Opus, stereo, 48 kHz, 160 kbps VBR, in Ogg (`.opus`). The source is already lossy, so the aim is to add no audible loss (no listening test was run); 48 kHz is native to both source and Opus, so nothing is resampled; Ogg Opus starts decoding at exactly time zero, which word timings need, where MP3 adds an encoder delay players handle inconsistently.
- **Loudness**: each clip's integrated loudness and true peak are measured on the decoded file (`ebur128`) and stored in `scenes.audio_lufs`/`audio_peak_db`, not applied. `audio_lufs` is NULL for a clip under one 400 ms gating block or with nothing above the −70 LUFS gate. The app evens loudness itself ([app-export.md](app-export.md)).
- **Acceptance test** (`tests/test_render_media.py`): rendered with and without fades, the full-volume region is bit-identical, and the fade-in follows the half-sine curve.

## Slideshow video

- **Frames**: one at `clip_start_ms`, one at `core_start_ms` and every 2000 ms after it, and one at the end. Anchoring the grid on the core changes the picture to the scene's first shot as the dialogue starts.
- **The end frame** is the source frame on screen 42 ms before `clip_end_ms`; it is what a browser keeps showing once the video has ended. A grid frame less than 500 ms before it is dropped.
- **Timing**: each frame is shown from its own timestamp until the next, so the slideshow stays in step with the audio. The clip-relative times are stored in `scenes.frame_times_ms`.
- **Size**: 400 pixels high, width in proportion and even (712×400). Tagged BT.709, limited range: the source is untagged HD, and players tend to assume BT.601 for an untagged small frame.
- **Codec**: AV1 in MP4, no audio, `libaom-av1 -crf 40 -b:v 0 -cpu-used 3 -row-mt 1 -aom-params tune=ssim`, `yuv420p` (8-bit), variable frame durations (`-fps_mode passthrough`), `-movflags +faststart`. AV1 because frames 2 s apart are close to stills and it is the strongest widely playable codec for stills. libaom rather than SVT-AV1: in a bake-off on three S01E04 windows, SVT-AV1 at every CRF tried reproduced the earlier slide's mouths and eyes in the next slide of the same shot (it coded the change as near-static), even with its temporal filter off; libaom at crf 50 smeared faces in dark shots, crf 40 was clean.

## Why 8-bit

The bake-off picked 10-bit AV1 (`yuv420p10le`), about 10% smaller. In a desktop Chromium (Linux, Wayland, Nvidia GPU) every 10-bit file showed a solid black picture: the element reached `readyState` 4 with the right size and no error, but every decoded frame was black. The same slideshow as 8-bit AV1 displayed correctly at the same size, as did 8-bit H.264 and VP9. The automated check had passed because headless Chromium ran with the GPU disabled, where 10-bit decodes fine.

So the video is 8-bit. Do not go back to 10-bit, or to any other format, on the strength of a headless or ffmpeg check alone. The test that catches it: in a normal GPU-enabled browser window, seek the video, draw it to a canvas and confirm the pixels are not all zero.
