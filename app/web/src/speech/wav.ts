// Pure audio helpers for the recorder: resampling to 16 kHz mono, a 16-bit PCM WAV encoder, and the
// voice gate (is there a voice in this take at all? too little?) that decides whether it is sent. No DOM, no Web Audio, so
// they are unit-tested on plain arrays.

export const SPEECH_RATE = 16000;

/**
 * Resamples mono float samples from `from` Hz to `to` Hz. Downsampling averages the input over each
 * output sample's span (a box low-pass, enough for speech at 16 kHz); upsampling interpolates.
 */
export function resample(input: Float32Array, from: number, to: number = SPEECH_RATE): Float32Array {
  if (!input.length || from <= 0 || to <= 0) return new Float32Array(0);
  if (from === to) return input.slice();
  const ratio = from / to;
  const n = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  if (ratio > 1) {
    for (let i = 0; i < n; i++) {
      const a = i * ratio;
      const b = Math.min(input.length, a + ratio);
      let sum = 0;
      let w = 0;
      let k = Math.floor(a);
      while (k < b) {
        const lo = Math.max(a, k);
        const hi = Math.min(b, k + 1);
        const f = hi - lo;
        if (f > 0) {
          sum += input[k]! * f;
          w += f;
        }
        k++;
      }
      out[i] = w > 0 ? sum / w : 0;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const x = i * ratio;
      const k = Math.floor(x);
      const f = x - k;
      const a = input[k] ?? 0;
      const b = input[k + 1] ?? a;
      out[i] = a + (b - a) * f;
    }
  }
  return out;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, rate: number = SPEECH_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buf;
}

/**
 * Samples [from, to) of a WAV of encodeWav's layout (44-byte header, 16-bit mono), as a WAV: a karaoke
 * take loses what it caught before its song began and after it ended (shared/karaoke.ts, alignTake).
 */
export function sliceWav(wav: ArrayBuffer, from: number, to = Number.POSITIVE_INFINITY): ArrayBuffer {
  const total = Math.max(0, (wav.byteLength - 44) >> 1);
  const a = Math.max(0, Math.min(total, Math.round(from)));
  const b = Math.max(a, Math.min(total, Math.round(to)));
  if (a === 0 && b === total) return wav;
  const n = b - a;
  const out = new ArrayBuffer(44 + n * 2);
  new Uint8Array(out, 0, 44).set(new Uint8Array(wav, 0, 44));
  new Uint8Array(out, 44).set(new Uint8Array(wav, 44 + a * 2, n * 2));
  const v = new DataView(out);
  v.setUint32(4, 36 + n * 2, true);
  v.setUint32(40, n * 2, true);
  return out;
}

export function rms(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  let sum = 0;
  const n = Math.max(0, end - start);
  for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
  return n ? Math.sqrt(sum / n) : 0;
}

// ---- Is there a voice? -------------------------------------------------------------------------
// The client decides whether a take holds a voice before anything is sent (the user: no pointless
// Whisper requests); the server's VAD filter and its "nothing heard" rule stay as the second line of
// defence. Tuned to send when in doubt: a quiet child's voice must never be dropped as silence.
// The rule, on 20 ms frames of the 16 kHz take (docs/app-games.md, "The voice gate"):
//   floor     = the room: the lowest of the take's 10th-percentile frame level, the median of its first
//               300 ms, and FLOOR_CAP (so a take that is all voice, or a loud room, cannot hide a voice)
//   voiced    = a frame louder than max(ABS_MIN_RMS, FLOOR_RATIO x floor) whose zero-crossing rate is at
//               least ZCR_MIN (mains hum, rumble and thumps cross zero too rarely to be a voice)
//   no voice  = no run of voiced frames of MIN_SYLLABLE_MS (one-frame gaps bridged): taps and clicks
//               are shorter than a syllable; steady hum or a fan never rises FLOOR_RATIO above itself
//   too short = the take under MIN_TAKE_MS, or under MIN_VOICE_MS of voiced frames in all
// A take with a voice is trimmed to its voice, with TRIM_BEFORE_MS before and TRIM_AFTER_MS after.

export const VOICE = {
  FRAME_MS: 20,
  ABS_MIN_RMS: 0.008, // -42 dBFS: below this nothing counts as a voice, however quiet the room
  FLOOR_RATIO: 2.5, // +8 dB above the room
  FLOOR_CAP: 0.04, // -28 dBFS
  ZCR_MIN: 0.008, // crossings per sample, about a 64 Hz tone: 50/60 Hz hum and rumble are below; a deep adult voice (100 Hz) is above
  MIN_SYLLABLE_MS: 80,
  MIN_VOICE_MS: 120,
  MIN_TAKE_MS: 400,
  TRIM_BEFORE_MS: 300,
  TRIM_AFTER_MS: 400,
} as const;

export interface RecordingLook {
  durationMs: number;
  peak: number;
  /** Time in voiced frames (VOICE rule). */
  voicedMs: number;
  /** The longest run of voiced frames, one-frame gaps bridged. */
  longestRunMs: number;
  /** Where the first voiced frame starts and the last one ends (ms), or null without any. */
  firstVoiceMs: number | null;
  lastVoiceMs: number | null;
  floor: number;
  threshold: number;
}

/**
 * RMS and zero-crossing rate (crossings per sample) of one frame, its mean removed. A crossing counts
 * only from below -h to above +h or back (h = a fifth of the frame's RMS), so room noise riding on a
 * low rumble does not add crossings.
 */
function frameStats(x: Float32Array, a: number, b: number): { rms: number; zcr: number } {
  let mean = 0;
  for (let i = a; i < b; i++) mean += x[i]!;
  mean /= Math.max(1, b - a);
  let sum = 0;
  for (let i = a; i < b; i++) sum += (x[i]! - mean) ** 2;
  const rms = Math.sqrt(sum / Math.max(1, b - a));
  const h = rms * 0.2;
  let side = 0;
  let cross = 0;
  for (let i = a; i < b; i++) {
    const v = x[i]! - mean;
    if (v > h && side <= 0) {
      if (side < 0) cross++;
      side = 1;
    } else if (v < -h && side >= 0) {
      if (side > 0) cross++;
      side = -1;
    }
  }
  return { rms, zcr: cross / Math.max(1, b - a - 1) };
}

export function lookAt(samples: Float32Array, rate: number): RecordingLook {
  const frame = Math.max(1, Math.round((rate * VOICE.FRAME_MS) / 1000));
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  const stats: { rms: number; zcr: number }[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) stats.push(frameStats(samples, i, i + frame));
  const levels = stats.map((f) => f.rms);
  const sorted = [...levels].sort((x, y) => x - y);
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const lead = levels.slice(0, Math.round(300 / VOICE.FRAME_MS)).sort((x, y) => x - y);
  const leadMedian = lead[Math.floor(lead.length / 2)] ?? p10;
  const floor = Math.min(p10, leadMedian, VOICE.FLOOR_CAP);
  const threshold = Math.max(VOICE.ABS_MIN_RMS, floor * VOICE.FLOOR_RATIO);
  const voiced = stats.map((f) => f.rms > threshold && f.zcr >= VOICE.ZCR_MIN);
  let count = 0;
  let first = -1;
  let last = -1;
  let run = 0;
  let longest = 0;
  let gap = 0;
  voiced.forEach((v, i) => {
    if (v) {
      count++;
      if (first < 0) first = i;
      last = i;
      run += 1 + (run > 0 ? gap : 0); // a one-frame gap inside a run counts with it
      gap = 0;
      longest = Math.max(longest, run);
    } else if (run > 0 && gap === 0) gap = 1;
    else {
      run = 0;
      gap = 0;
    }
  });
  return {
    durationMs: Math.round((samples.length / rate) * 1000),
    peak,
    voicedMs: count * VOICE.FRAME_MS,
    longestRunMs: longest * VOICE.FRAME_MS,
    firstVoiceMs: first < 0 ? null : first * VOICE.FRAME_MS,
    lastVoiceMs: last < 0 ? null : (last + 1) * VOICE.FRAME_MS,
    floor,
    threshold,
  };
}

export type RecordingProblem = 'silent' | 'short' | null;

/** Silent: no voice (no syllable-long run of voiced frames); short: a voice, but too little. Neither is sent. */
export function judgeRecording(look: RecordingLook): RecordingProblem {
  if (look.longestRunMs < VOICE.MIN_SYLLABLE_MS) return 'silent';
  if (look.durationMs < VOICE.MIN_TAKE_MS || look.voicedMs < VOICE.MIN_VOICE_MS) return 'short';
  return null;
}

/** The take cut to its voice, with a margin before and after (smaller uploads; Whisper gets the same words). */
export function trimToVoice(samples: Float32Array, rate: number, look: RecordingLook): Float32Array {
  if (look.firstVoiceMs === null || look.lastVoiceMs === null) return samples;
  const a = Math.max(0, Math.floor(((look.firstVoiceMs - VOICE.TRIM_BEFORE_MS) * rate) / 1000));
  const b = Math.min(samples.length, Math.ceil(((look.lastVoiceMs + VOICE.TRIM_AFTER_MS) * rate) / 1000));
  return a === 0 && b === samples.length ? samples : samples.slice(a, b);
}

/**
 * The live version, block by block while recording (the meter's "voice" colour and the end of speech):
 * a block is a voice when louder than max(ABS_MIN_RMS, FLOOR_RATIO x the quietest block of the last
 * 1.5 s, at most FLOOR_CAP). Steady noise is its own floor, so it never reads as a voice for long;
 * speech always dips between words, so a kid who keeps talking is never cut off as silent.
 */
export class LiveVoice {
  private recent: number[] = [];
  constructor(private readonly windowBlocks = 36) {}
  push(level: number): boolean {
    this.recent.push(level);
    if (this.recent.length > this.windowBlocks) this.recent.shift();
    const floor = Math.min(VOICE.FLOOR_CAP, ...this.recent);
    return level > Math.max(VOICE.ABS_MIN_RMS, floor * VOICE.FLOOR_RATIO);
  }
}

/** Seconds of a 16-bit mono WAV, from its header (null when it is not one). For tests and dev checks. */
export function wavSeconds(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 44) return null;
  const v = new DataView(buf);
  const tag = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (tag !== 'RIFF') return null;
  const rate = v.getUint32(24, true);
  const bytes = v.getUint32(40, true);
  return rate ? bytes / 2 / rate : null;
}
