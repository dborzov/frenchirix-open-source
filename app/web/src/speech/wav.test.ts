import { describe, expect, it } from 'vitest';
import { createRng } from '../../../shared/practice/rng';
import { encodeWav, judgeRecording, LiveVoice, lookAt, resample, sliceWav, SPEECH_RATE, trimToVoice, VOICE, wavSeconds } from './wav';

const tone = (rate: number, secs: number, hz = 220, amp = 0.3) => Float32Array.from({ length: Math.round(rate * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

describe('wav helpers', () => {
  it('resamples 48 kHz and 44.1 kHz to 16 kHz with the right length and level', () => {
    for (const rate of [48000, 44100]) {
      const out = resample(tone(rate, 1), rate, SPEECH_RATE);
      expect(Math.abs(out.length - SPEECH_RATE)).toBeLessThanOrEqual(1);
      const peak = Math.max(...out.map(Math.abs));
      expect(peak).toBeGreaterThan(0.25);
      expect(peak).toBeLessThanOrEqual(0.31);
    }
    expect(resample(new Float32Array(0), 48000)).toHaveLength(0);
  });

  it('encodes a 16-bit mono WAV header', () => {
    const buf = encodeWav(tone(SPEECH_RATE, 0.5), SPEECH_RATE);
    const v = new DataView(buf);
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...new Uint8Array(buf, 8, 4))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(wavSeconds(buf)).toBeCloseTo(0.5, 3);
    expect(buf.byteLength).toBe(44 + 8000 * 2);
  });

  it('slices a WAV (a karaoke take loses what it caught before and after its song) and keeps a valid header', () => {
    const pcm = Float32Array.from({ length: 16000 }, (_, i) => (i % 100) / 200);
    const buf = encodeWav(pcm, SPEECH_RATE);
    const cut = sliceWav(buf, 4000);
    expect(cut.byteLength).toBe(44 + 12000 * 2);
    expect(wavSeconds(cut)).toBeCloseTo(0.75, 4);
    const v = new DataView(cut);
    expect(v.getUint32(4, true)).toBe(36 + 24000);
    expect(v.getUint32(24, true)).toBe(16000);
    // The first sample kept is sample 4000 of the original.
    expect(v.getInt16(44, true)).toBe(new DataView(buf).getInt16(44 + 4000 * 2, true));
    const mid = sliceWav(buf, 100, 8100);
    expect(wavSeconds(mid)).toBeCloseTo(0.5, 4);
    expect(new DataView(mid).getInt16(44 + 7999 * 2, true)).toBe(new DataView(buf).getInt16(44 + 8099 * 2, true));
    expect(sliceWav(buf, 0)).toBe(buf);
    expect(sliceWav(buf, 0, 1e9)).toBe(buf);
    expect(sliceWav(buf, 99_999).byteLength).toBe(44);
  });

  it('rejects silence and very short takes, accepts a voice', () => {
    expect(judgeRecording(lookAt(new Float32Array(SPEECH_RATE * 2), SPEECH_RATE))).toBe('silent');
    const noise = Float32Array.from({ length: SPEECH_RATE * 2 }, () => (Math.random() - 0.5) * 0.004);
    expect(judgeRecording(lookAt(noise, SPEECH_RATE))).toBe('silent');
    expect(judgeRecording(lookAt(tone(SPEECH_RATE, 0.25), SPEECH_RATE))).toBe('short');
    const take = new Float32Array(SPEECH_RATE * 2);
    take.set(tone(SPEECH_RATE, 0.8), SPEECH_RATE / 2);
    expect(judgeRecording(lookAt(take, SPEECH_RATE))).toBeNull();
  });
});

// ---- The voice gate on synthetic takes (16 kHz) ------------------------------------------------------
const R = SPEECH_RATE;
const rng = createRng(7);
/** Room noise: white noise at this RMS. */
const room = (secs: number, level = 0.002) => Float32Array.from({ length: Math.round(R * secs) }, () => (rng.next() * 2 - 1) * level * Math.sqrt(3));
/** A voiced syllable: a 230 Hz voice with formant-like harmonics, a raised-cosine envelope, at this RMS. */
function syllable(ms: number, level: number, f0 = 230): Float32Array {
  const n = Math.round((R * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / R;
    const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    out[i] = env * (Math.sin(2 * Math.PI * f0 * t) + 0.7 * Math.sin(2 * Math.PI * 3 * f0 * t) + 0.4 * Math.sin(2 * Math.PI * 5 * f0 * t));
  }
  // Scale to the wanted RMS (of the whole syllable).
  let sum = 0;
  for (const v of out) sum += v * v;
  const k = level / Math.sqrt(sum / n);
  return out.map((v) => v * k);
}
/** Adds `part` into `into` at `atSecs`. */
function mix(into: Float32Array, part: Float32Array, atSecs: number): Float32Array {
  const o = Math.round(atSecs * R);
  for (let i = 0; i < part.length && o + i < into.length; i++) into[o + i] = into[o + i]! + part[i]!;
  return into;
}
/** Words: syllables of 160 ms with 60 ms between them, starting at `atSecs`. */
function words(into: Float32Array, atSecs: number, syllables: number, level: number): Float32Array {
  for (let k = 0; k < syllables; k++) mix(into, syllable(160, level), atSecs + k * 0.22);
  return into;
}
const judge = (x: Float32Array) => judgeRecording(lookAt(x, R));

describe('the voice gate', () => {
  it('finds no voice in silence, room noise, mains hum or a steady fan', () => {
    expect(judge(new Float32Array(R * 3))).toBe('silent');
    expect(judge(room(3))).toBe('silent');
    const hum = Float32Array.from({ length: R * 3 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 50 * i) / R));
    expect(judge(hum)).toBe('silent'); // loud, but it crosses zero too rarely (and never rises above itself)
    const hum120 = Float32Array.from({ length: R * 3 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 120 * i) / R));
    expect(judge(hum120)).toBe('silent'); // above ZCR_MIN, but steady: never FLOOR_RATIO above itself
    expect(judge(room(3, 0.03))).toBe('silent'); // a loud steady fan: its own floor
  });

  it('finds no voice in taps and clicks, nor in a thump', () => {
    const taps = room(3);
    for (const at of [0.4, 0.9, 1.3, 1.8, 2.2, 2.6]) {
      const click = Float32Array.from({ length: Math.round(R * 0.03) }, (_, i) => 0.6 * Math.exp(-i / 60) * (rng.next() * 2 - 1));
      mix(taps, click, at);
    }
    expect(judge(taps)).toBe('silent');
    // A knock on the table: a low rumble (a thump with more energy above 64 Hz may be sent; the server's VAD drops it).
    const thump = Float32Array.from({ length: Math.round(R * 0.25) }, (_, i) => 0.4 * Math.exp(-i / 1500) * Math.sin((2 * Math.PI * 45 * i) / R));
    expect(judge(mix(room(2), thump, 0.8))).toBe('silent');
  });

  it('hears speech-like bursts: a normal voice, a quiet child, a voice over hum or a fan', () => {
    expect(judge(words(room(3), 0.8, 4, 0.08))).toBeNull();
    expect(judge(words(room(3, 0.001), 0.8, 3, 0.012))).toBeNull(); // -38 dBFS: a quiet child far from the mic
    const hum = Float32Array.from({ length: R * 3 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 50 * i) / R));
    expect(judge(words(hum, 1, 4, 0.08))).toBeNull();
    expect(judge(words(room(3, 0.02), 1, 4, 0.1))).toBeNull();
    // A take that is all voice (stopped by a tap the moment the kid finished): still a voice.
    expect(judge(words(new Float32Array(Math.round(R * 1.1)), 0, 5, 0.1))).toBeNull();
    // One short word ("oui"): one syllable of 180 ms is enough.
    expect(judge(mix(room(2), syllable(180, 0.05), 0.7))).toBeNull();
    // A deep adult voice (the user testing on /dev/speaking) and a high child's voice alike.
    for (const f0 of [95, 120, 320]) {
      const take = room(3);
      for (let k = 0; k < 3; k++) mix(take, syllable(160, 0.05, f0), 0.8 + k * 0.22);
      expect(judge(take), `f0 ${f0}`).toBeNull();
    }
  });

  it('calls a voice too short when there is too little of it, or the take itself is', () => {
    expect(judge(mix(room(2), syllable(110, 0.08), 0.7))).toBe('short');
    expect(judge(words(new Float32Array(Math.round(R * 0.3)), 0, 1, 0.08))).toBe('short');
  });

  it('trims a take to its voice, with a margin', () => {
    const take = words(room(6), 2, 4, 0.08); // voice from 2.0 to about 2.82 s
    const look = lookAt(take, R);
    expect(look.firstVoiceMs).toBeGreaterThanOrEqual(1980);
    expect(look.lastVoiceMs).toBeLessThanOrEqual(2900);
    const cut = trimToVoice(take, R, look);
    const secs = cut.length / R;
    expect(secs).toBeGreaterThan(0.8 + (VOICE.TRIM_BEFORE_MS + VOICE.TRIM_AFTER_MS) / 1000 - 0.15);
    expect(secs).toBeLessThan(2);
    expect(judge(cut)).toBeNull(); // still a voice once cut
    const silent = room(2);
    expect(trimToVoice(silent, R, lookAt(silent, R))).toBe(silent);
  });

  it('live: a voice over the room, never steady noise for long, and a kid who keeps talking stays heard', () => {
    const block = (x: Float32Array, a: number) => {
      let sum = 0;
      for (let i = a; i < a + 2048 && i < x.length; i++) sum += x[i]! * x[i]!;
      return Math.sqrt(sum / 2048);
    };
    const run = (x: Float32Array) => {
      const live = new LiveVoice();
      const out: boolean[] = [];
      for (let a = 0; a + 2048 <= x.length; a += 2048) out.push(live.push(block(x, a)));
      return out;
    };
    expect(run(room(3)).some(Boolean)).toBe(false);
    const fan = run(room(4, 0.03));
    expect(fan.slice(10).some(Boolean)).toBe(false); // steady noise is its own floor
    const talk = run(words(room(4), 0.5, 14, 0.08)); // three seconds of talking, no long pause
    const during = talk.slice(Math.ceil((0.6 * R) / 2048), Math.floor((3.3 * R) / 2048));
    // Heard at least every 1.5 s all along (the end-of-speech stop needs 1.5 s without a voice).
    let quiet = 0;
    let longestQuiet = 0;
    for (const v of during) {
      quiet = v ? 0 : quiet + 1;
      longestQuiet = Math.max(longestQuiet, quiet);
    }
    expect((longestQuiet * 2048) / R).toBeLessThan(0.5);
  });
});
