import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_SCENE } from '../../../shared/fixtures/scene';
import { DialogueStrip } from './DialogueStrip';
import { hint, MARGIN, placeBubble, TAIL } from './hint';

const layer = () => document.querySelector('[data-hint-layer]')!;
const isOpen = () => !!layer() && !layer().hasAttribute('hidden');
const line = FIXTURE_SCENE.lines[0]!;

afterEach(() => hint.hide());

describe('the hint bubble', () => {
  it('rule 1: shows the English and the note, never the French', () => {
    const { container } = render(<DialogueStrip scene={FIXTURE_SCENE} lineIds={[line.id]} loopOnTap={false} />);
    for (const [i, u] of line.units.entries()) {
      fireEvent.click(container.querySelectorAll('[data-unit]')[i]!);
      const text = document.querySelector('[data-bubble]')!.textContent ?? '';
      expect(text).toContain(u.en);
      for (const w of u.words) if (!u.en.toLowerCase().includes(w.fr.toLowerCase())) expect(text).not.toContain(w.fr);
      expect(text).not.toContain(' = ');
    }
  });

  it('rule 2: the tail tip touches the box, the bubble beside it, inside the screen', () => {
    const vp = { width: 390, height: 844 };
    for (const anchor of [
      { left: 40, top: 100, width: 120, height: 48 }, // room below
      { left: 300, top: 760, width: 80, height: 48 }, // near the bottom right: goes above, clamped
      { left: 2, top: 400, width: 60, height: 48 }, // at the left edge
    ]) {
      const size = { width: 260, height: 70 };
      const p = placeBubble(anchor, size, vp);
      const edge = p.side === 'below' ? anchor.top + anchor.height : anchor.top;
      expect(Math.abs(p.tailY - edge)).toBeLessThanOrEqual(2); // the tip is on the box's edge
      expect(p.tailX).toBeGreaterThanOrEqual(anchor.left - 2);
      expect(p.tailX).toBeLessThanOrEqual(anchor.left + anchor.width + 2);
      // Never over the box.
      if (p.side === 'below') expect(p.top).toBeGreaterThanOrEqual(anchor.top + anchor.height + TAIL - 1);
      else expect(p.top + p.height).toBeLessThanOrEqual(anchor.top - TAIL + 1);
      // Never off screen.
      expect(p.left).toBeGreaterThanOrEqual(MARGIN);
      expect(p.left + p.width).toBeLessThanOrEqual(vp.width - MARGIN);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.top + p.height).toBeLessThanOrEqual(vp.height);
    }
    expect(placeBubble({ left: 300, top: 760, width: 80, height: 48 }, { width: 260, height: 70 }, vp).side).toBe('above');
  });

  it('takes a preferred side when it fits there (place-words: above the tray), and the other when not', () => {
    const vp = { width: 390, height: 844 };
    const mid = { left: 150, top: 500, width: 80, height: 48 };
    expect(placeBubble(mid, { width: 260, height: 70 }, vp).side).toBe('below');
    expect(placeBubble(mid, { width: 260, height: 70 }, vp, 'above').side).toBe('above');
    expect(placeBubble({ left: 150, top: 30, width: 80, height: 48 }, { width: 260, height: 70 }, vp, 'above').side).toBe('below');
  });

  it('rule 3: tapping the bubble hides it', () => {
    const { container } = render(<DialogueStrip scene={FIXTURE_SCENE} lineIds={[line.id]} loopOnTap={false} />);
    fireEvent.click(container.querySelector('[data-unit]')!);
    expect(isOpen()).toBe(true);
    fireEvent.click(document.querySelector('[data-bubble]')!);
    expect(isOpen()).toBe(false);
  });

  it('rule 3: the bubble catches its own tap, which goes no further', () => {
    const { container } = render(<DialogueStrip scene={FIXTURE_SCENE} lineIds={[line.id]} loopOnTap={false} />);
    fireEvent.click(container.querySelector('[data-unit]')!);
    const bubble = document.querySelector('[data-bubble]') as HTMLElement;
    // It is hit-testable (a tap on it lands on it, not on what lies under it).
    expect(getComputedStyle(bubble).pointerEvents).not.toBe('none');
    let reached = 0;
    const count = () => reached++;
    document.addEventListener('click', count);
    try {
      fireEvent.pointerDown(bubble);
      expect(isOpen()).toBe(true); // closed by the tap itself, not before it
      fireEvent.click(bubble);
      expect(isOpen()).toBe(false);
      expect(reached).toBe(0);
    } finally {
      document.removeEventListener('click', count);
    }
  });

  it('rule 4: a tap or a key anywhere else hides it, and that tap still works', () => {
    let clicked = 0;
    const { container } = render(
      <div>
        <DialogueStrip scene={FIXTURE_SCENE} lineIds={[line.id]} loopOnTap={false} />
        <button type="button" data-other onClick={() => clicked++}>
          other
        </button>
      </div>,
    );
    fireEvent.click(container.querySelector('[data-unit]')!);
    expect(isOpen()).toBe(true);
    const other = container.querySelector('[data-other]')!;
    fireEvent.pointerDown(other);
    fireEvent.click(other);
    expect(isOpen()).toBe(false);
    expect(clicked).toBe(1);
    fireEvent.click(container.querySelector('[data-unit]')!);
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });

  it('one bubble at a time: another box moves it', () => {
    const { container } = render(<DialogueStrip scene={FIXTURE_SCENE} lineIds={[line.id]} loopOnTap={false} />);
    const boxes = container.querySelectorAll('[data-unit]');
    fireEvent.click(boxes[0]!);
    fireEvent.pointerDown(boxes[1]!);
    fireEvent.click(boxes[1]!);
    expect(document.querySelectorAll('[data-bubble]')).toHaveLength(1);
    expect(hint.isOpenFor(boxes[1]!)).toBe(true);
  });
});
