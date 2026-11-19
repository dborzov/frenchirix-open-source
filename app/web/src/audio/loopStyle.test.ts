import { describe, expect, it } from 'vitest';
import { envelopeAt, fadeCurve, planLoop, quietestPoint, type PcmLike } from './loopStyle';

/** 3 s of mono noise at 0.5, with a silent hole at 1.85-1.90 s and another at 2.62-2.66 s. */
function fake(): PcmLike {
  const sr = 8000;
  const d = new Float32Array(sr * 3);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const hole = (t > 1.85 && t < 1.9) || (t > 2.62 && t < 2.66);
    d[i] = hole ? 0 : (i % 2 ? 0.5 : -0.5);
  }
  return { sampleRate: sr, duration: 3, numberOfChannels: 1, getChannelData: () => d };
}

describe('loop styles', () => {
  const buf = fake();

  it('A is the original: the window, linear fades of 8 ms (at most a quarter of the window)', () => {
    const p = planLoop(buf, 2, 2.5, 'A');
    expect(p.playS).toEqual([2, 2.5]);
    expect(p.fadeIn).toEqual({ from: 2, to: 2.008, curve: 'linear' });
    expect(p.fadeOut.from).toBeCloseTo(2.492, 6);
    expect(p.gapS).toBeCloseTo(0.35);
    const short = planLoop(buf, 2, 2.02, 'A');
    expect(short.fadeIn.to - short.fadeIn.from).toBeCloseTo(0.005, 6);
  });

  it('C pads the window and keeps the unit at full volume', () => {
    const p = planLoop(buf, 2, 2.5, { id: 'C', preMs: 120, postMs: 200 });
    expect(p.playS[0]).toBeCloseTo(1.88);
    expect(p.playS[1]).toBeCloseTo(2.7);
    for (const t of [2, 2.1, 2.3, 2.5]) expect(envelopeAt(p, t)).toBeCloseTo(1, 3);
    expect(envelopeAt(p, p.playS[0])).toBe(0);
    expect(envelopeAt(p, p.playS[1])).toBe(0);
  });

  it('D moves the cuts into the quiet holes', () => {
    const p = planLoop(buf, 2, 2.5, { id: 'D', preMs: 200, postMs: 200 });
    expect(p.playS[0]).toBeGreaterThan(1.85);
    expect(p.playS[0]).toBeLessThan(1.9);
    expect(p.playS[1]).toBeGreaterThan(2.62);
    expect(p.playS[1]).toBeLessThan(2.66);
    expect(quietestPoint(buf, 1.8, 1.95, 1.8)).toBeGreaterThan(1.85);
  });

  it('E releases after the unit and clamps to the clip', () => {
    const p = planLoop(buf, 2.4, 2.9, 'E');
    expect(p.fadeOut.curve).toBe('exp');
    expect(p.playS[1]).toBeLessThanOrEqual(3);
    expect(p.gapS).toBeCloseTo(0.45);
  });

  it('fade curves start and end exactly at 0 and 1', () => {
    for (const c of ['linear', 'cosine', 'exp'] as const) {
      const up = fadeCurve(c, true);
      const down = fadeCurve(c, false);
      expect([up[0], up[up.length - 1], down[0], down[down.length - 1]]).toEqual([0, 1, 1, 0]);
    }
  });
});
