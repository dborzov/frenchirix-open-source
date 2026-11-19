import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FIXTURE_SCENE } from '../../../shared/fixtures/scene';
import { msAtX, SceneBar, segmentsOf } from './SceneBar';

describe('the playback bar', () => {
  it('maps a pointer to a position in the audio, clamped', () => {
    expect(msAtX(150, 100, 200, 12000)).toBe(3000);
    expect(msAtX(200, 100, 200, 12000)).toBe(6000); // the middle is half the audio
    expect(msAtX(50, 100, 200, 12000)).toBe(0);
    expect(msAtX(999, 100, 200, 12000)).toBe(12000);
    expect(msAtX(150, 100, 0, 12000)).toBe(0);
  });

  it('divides the bar into the lines, in order, inside it', () => {
    const segs = segmentsOf(FIXTURE_SCENE.lines, FIXTURE_SCENE.audio.durationMs);
    expect(segs).toHaveLength(FIXTURE_SCENE.lines.length);
    for (const sg of segs) {
      expect(sg.from).toBeGreaterThanOrEqual(0);
      expect(sg.to).toBeLessThanOrEqual(1);
      expect(sg.to).toBeGreaterThan(sg.from);
    }
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.from).toBeGreaterThanOrEqual(segs[i - 1]!.from);
  });

  it('a tap seeks where it lands', () => {
    const seeks: number[] = [];
    const { container } = render(<SceneBar lines={FIXTURE_SCENE.lines} durationMs={10000} src="/x.m4a" onSeek={(ms) => seeks.push(ms)} />);
    const bar = container.querySelector('[role="slider"]') as HTMLElement;
    bar.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 44, right: 400, bottom: 44, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(bar, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 200, pointerId: 1 });
    expect(seeks).toEqual([5000]);
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 300, pointerId: 1 });
    expect(seeks).toEqual([5000, 2500, 7500]);
  });
});
