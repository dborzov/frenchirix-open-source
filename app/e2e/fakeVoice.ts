// The fake microphone of the end-to-end tests: a WAV that Chromium plays in a loop as the microphone
// (--use-file-for-fake-audio-capture). Chromium's own fake device is a 35 ms beep twice a second, which
// the client's voice gate (web/src/speech/wav.ts) rightly takes for clicks, never a voice. This one
// sounds like speech to the gate: 1.2 s of syllables (a voice at 230 Hz with harmonics, 180 ms each),
// then 1 s of quiet, so a take of 1.6 s always holds a voice and a hands-free take ends on the pause.
// Generated at config load into the system temp directory; nothing binary is committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from '../web/src/speech/wav';

const RATE = 48000;

export function fakeVoiceSamples(): Float32Array {
  const out = new Float32Array(Math.round(RATE * 2.2));
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = ((seed / 2147483647) * 2 - 1) * 0.002; // room noise
  }
  const syl = Math.round(RATE * 0.18);
  for (let k = 0; k < 5; k++) {
    const at = Math.round(RATE * (0.05 + k * 0.24));
    const f0 = 230 + (k % 2) * 30;
    for (let i = 0; i < syl; i++) {
      const t = i / RATE;
      const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / syl);
      out[at + i] = out[at + i]! + 0.12 * env * (Math.sin(2 * Math.PI * f0 * t) + 0.7 * Math.sin(2 * Math.PI * 3 * f0 * t) + 0.4 * Math.sin(2 * Math.PI * 5 * f0 * t));
    }
  }
  return out;
}

/** Writes the WAV once (per process) and returns its path. */
export function fakeVoiceWav(): string {
  const dir = join(tmpdir(), 'frx-e2e');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'fake-voice.wav');
  writeFileSync(path, Buffer.from(encodeWav(fakeVoiceSamples(), RATE)));
  return path;
}
