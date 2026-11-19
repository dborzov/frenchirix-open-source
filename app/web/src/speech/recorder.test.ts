// The real MicRecorder (the liveness check plays a fake one): a take cut off from outside (the page
// hidden, the audio context interrupted) ends like an automatic stop and keeps what was recorded, so
// useRecorder leaves 'recording' and the view gets its take; only cancel() drops a take. Web Audio and
// the microphone are stubbed: happy-dom has neither.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LISTEN_MAX_MS } from '../../../shared/puzzles/speak-core';
import { meterLevel, MicRecorder, takeLimitMs } from './recorder';

vi.mock('../audio', () => ({ audio: { stop: () => {}, setMicOpen: () => {} } }));

class Node0 {
  connect() {}
  disconnect() {}
}
class Processor extends Node0 {
  onaudioprocess: ((e: { inputBuffer: { getChannelData(i: number): Float32Array } }) => void) | null = null;
}
let ctx: Context;
let proc: Processor;
class Context {
  state: string = 'running';
  sampleRate = 48000;
  destination = new Node0();
  onstatechange: (() => void) | null = null;
  constructor() {
    ctx = this; // eslint-disable-line @typescript-eslint/no-this-alias
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createMediaStreamSource() {
    return new Node0();
  }
  createGain() {
    return Object.assign(new Node0(), { gain: { value: 1 } });
  }
  createScriptProcessor() {
    proc = new Processor();
    return proc;
  }
}

/** 4096 samples of a voice-loud tone at 48 kHz (about 85 ms: a take judged too short). */
const voice = () => Float32Array.from({ length: 4096 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 48000));
const hear = () => proc.onaudioprocess!({ inputBuffer: { getChannelData: () => voice() } });

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', Context);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [] }) }, configurable: true });
  setVisibility('visible');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setVisibility('visible');
});

describe('MicRecorder, cut off from outside', () => {
  it('the page hidden mid-take: an automatic stop with the take so far', async () => {
    const onAutoStop = vi.fn();
    const r = new MicRecorder();
    await r.start({ maxMs: 8000, onAutoStop });
    hear();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onAutoStop).toHaveBeenCalledOnce();
    expect(r.recording).toBe(false);
    const take = await r.stop();
    expect(take).not.toBeNull();
    expect(take!.problem).toBe('short');
  });

  it('an interrupted audio context: the same', async () => {
    const onAutoStop = vi.fn();
    const r = new MicRecorder();
    await r.start({ maxMs: 8000, onAutoStop });
    hear();
    ctx.state = 'interrupted';
    ctx.onstatechange!();
    expect(onAutoStop).toHaveBeenCalledOnce();
    expect(await r.stop()).not.toBeNull();
  });

  it('nothing recorded yet: an empty take judged silent, not nothing', async () => {
    const r = new MicRecorder();
    await r.start({ maxMs: 8000 });
    const take = await r.stop();
    expect(take?.problem).toBe('silent');
  });

  it('cancel() (unmount, reset) still drops the take, without onAutoStop', async () => {
    const onAutoStop = vi.fn();
    const r = new MicRecorder();
    await r.start({ maxMs: 8000, onAutoStop });
    hear();
    r.cancel();
    expect(onAutoStop).not.toHaveBeenCalled();
    expect(await r.stop()).toBeNull();
  });
});

describe('MicRecorder, the 10 s limit and the meter', () => {
  it('never listens longer than LISTEN_MAX_MS, whatever the take asked for', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] });
    try {
      const onAutoStop = vi.fn();
      const r = new MicRecorder();
      const started = r.start({ maxMs: 30_000, onAutoStop });
      await vi.advanceTimersByTimeAsync(0);
      await started;
      await vi.advanceTimersByTimeAsync(LISTEN_MAX_MS - 300);
      expect(onAutoStop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      expect(onAutoStop).toHaveBeenCalledOnce();
      expect(r.recording).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a karaoke take: another ceiling than 10 s, no end on silence, kept whole with when it began', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] });
    try {
      const onAutoStop = vi.fn();
      const r = new MicRecorder();
      const started = r.start({ maxMs: 30_000, capMs: 70_000, whole: true, silenceMs: Number.POSITIVE_INFINITY, onAutoStop });
      await vi.advanceTimersByTimeAsync(0);
      await started;
      (ctx as unknown as { currentTime: number }).currentTime = 5;
      const quiet = () => proc.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
      quiet(); // a moment of room before the voice: kept, since the take must keep its timing
      for (let i = 0; i < 12; i++) hear();
      quiet();
      await vi.advanceTimersByTimeAsync(LISTEN_MAX_MS + 5000); // past 10 s, and long past the silence
      expect(onAutoStop).not.toHaveBeenCalled();
      const take = (await r.stop())!;
      expect(take.problem).toBeNull();
      expect(take.durationMs).toBe(Math.round(((14 * 4096) / 48000) * 1000)); // all of it, untrimmed
      expect(Number.isFinite(take.capturedAt)).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps the limit and maps loudness to the meter', () => {
    expect(takeLimitMs(30_000)).toBe(LISTEN_MAX_MS);
    expect(takeLimitMs(30_000, 70_000)).toBe(30_000);
    expect(takeLimitMs(90_000, 70_000)).toBe(70_000);
    expect(takeLimitMs(4000)).toBe(4000);
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(0.003)).toBeCloseTo(0, 1); // -50 dB: room noise
    expect(meterLevel(0.03)).toBeGreaterThan(0.4); // a quiet voice still moves it
    expect(meterLevel(0.5)).toBe(1);
  });

  it('reports the level and whether it is a voice', async () => {
    const levels: [number, boolean][] = [];
    const r = new MicRecorder();
    await r.start({ maxMs: 8000, onLevel: (l, v) => levels.push([l, v]) });
    hear();
    proc.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
    expect(levels[0]![1]).toBe(true);
    expect(levels[0]![0]).toBeGreaterThan(0.5);
    expect(levels[1]).toEqual([0, false]);
    r.cancel();
  });
});
