import { act, fireEvent, render } from '@testing-library/react';
import { audio } from '../audio';
import { describe, expect, it } from 'vitest';
import type { Line } from '../../../shared/content';
import { FIXTURE_SCENE } from '../../../shared/fixtures/scene';
import type { Scene } from '../../../shared/content';
import { hint } from './hint';
import { DialogueStrip, initialMask, lastUnitOf } from './DialogueStrip';
import { lineWindow, loopWindowFor, tags, wordKeyAt } from './timing';

const line = FIXTURE_SCENE.lines[0]!;

describe('timing', () => {
  it('loops a unit, or the whole line when its times are estimated', () => {
    const u = line.units[0]!;
    expect(loopWindowFor(line, u)).toEqual({ startMs: u.startMs, endMs: u.endMs });
    const approx: Line = { ...line, approxTimes: true };
    expect(loopWindowFor(approx, u)).toEqual({ startMs: line.startMs, endMs: line.endMs });
    expect(lineWindow(approx)).toEqual({ startMs: line.startMs, endMs: line.endMs });
  });

  it('finds the spoken word, never on an approximate line', () => {
    const w = line.units[0]!.words[1]!;
    expect(wordKeyAt([line], (w.startMs + w.endMs) / 2)).toBe(`${line.units[0]!.id}#1`);
    expect(wordKeyAt([{ ...line, approxTimes: true }], (w.startMs + w.endMs) / 2)).toBeNull();
  });
});

describe('DialogueStrip', () => {
  it('masks words to first letters and dots', () => {
    expect(initialMask("Et si tu n'aimes pas")).toBe("E· s· t· n'····· p··");
  });

  it('draws one box per unit, masks, and counts taps as hints', () => {
    let hints = 0;
    const tapped: string[] = [];
    const masked = [line.units[1]!.id];
    const { container } = render(<DialogueStrip scene={FIXTURE_SCENE} lineIds={[line.id]} masked={masked} onHint={() => hints++} onUnitTap={(id) => tapped.push(id)} loopOnTap={false} />);
    const boxes = container.querySelectorAll('[data-unit]');
    expect(boxes).toHaveLength(line.units.length);
    expect(boxes[1]!.textContent).not.toContain(line.units[1]!.fr);
    fireEvent.click(boxes[0]!);
    expect(hints).toBe(1);
    expect(tapped).toEqual([line.units[0]!.id]);
    expect(document.querySelector('[data-bubble]')!.textContent).toContain(line.units[0]!.en);
  });

  it('linePanels: each line in its colour, no box in its line\'s colour, a tap on the panel loops the line', () => {
    const seeks: string[] = [];
    const ids = FIXTURE_SCENE.lines.map((l) => l.id);
    const { container } = render(<DialogueStrip scene={FIXTURE_SCENE} lineIds={ids} linePanels onLineSeek={(l) => seeks.push(l.id)} />);
    container.querySelectorAll<HTMLElement>('[data-line]').forEach((row) => {
      const lc = row.style.getPropertyValue('--lc');
      expect(lc).toMatch(/--unit-\d/);
      row.querySelectorAll<HTMLElement>('[data-unit]').forEach((box) => expect(box.style.getPropertyValue('--c')).not.toBe(lc));
    });
    const id = ids[ids.length - 1]!;
    act(() => void fireEvent.click(container.querySelector(`[data-line-loop="${id}"]`)!));
    expect(audio.getState().tag).toBe(tags.line(id));
    expect(audio.getState().loop).toBe(true);
    expect(container.querySelector(`[data-line="${id}"]`)!.hasAttribute('data-looping')).toBe(true);
    // Again: back to the scene from that line (the scene player's seek).
    act(() => void fireEvent.click(container.querySelector(`[data-line-loop="${id}"]`)!));
    expect(seeks).toEqual([id]);
    act(() => audio.stop());
  });

  it('opens the meaning of a box that is already looping because the puzzle loops that unit', () => {
    const { container } = render(<DialogueStrip scene={FIXTURE_SCENE} lineIds={[line.id]} />);
    const u = line.units[0]!;
    act(() => {
      audio.playRange(FIXTURE_SCENE.audio.src, u.startMs, u.endMs, { loop: true, tag: tags.unit(u.id) });
    });
    fireEvent.click(container.querySelectorAll('[data-unit]')[0]!);
    expect(document.querySelector('[data-bubble]')?.textContent).toContain(u.en);
    // A second tap on the open box stops it and closes the balloon.
    fireEvent.click(container.querySelectorAll('[data-unit]')[0]!);
    expect(document.querySelector('[data-hint-layer]')?.hasAttribute('hidden')).toBe(true);
  });

  it('one asterisk per note, on the last unit of its phrase; none on a hidden unit', () => {
    const l2 = FIXTURE_SCENE.lines[1]!;
    const [a, b, c] = l2.units;
    const scene: Scene = {
      ...FIXTURE_SCENE,
      notes: [
        { kind: 'reference', text: 'Over two boxes.', phrase: 'x', lineId: l2.id, unitIds: [b!.id, a!.id] },
        { kind: 'wordplay', text: 'On one box.', phrase: 'y', lineId: l2.id, unitIds: [c!.id] },
      ],
    };
    expect(lastUnitOf([b!.id, a!.id])).toBe(b!.id);
    expect(lastUnitOf(['s01e04-0016:9', 's01e04-0017:1'])).toBe('s01e04-0017:1');
    expect(lastUnitOf(['s01e04-0017:10', 's01e04-0017:9'])).toBe('s01e04-0017:10');
    const { container, rerender } = render(<DialogueStrip scene={scene} lineIds={[l2.id]} loopOnTap={false} />);
    const stars = () => [...container.querySelectorAll('[data-note-unit]')].map((e) => e.getAttribute('data-note-unit'));
    expect(stars()).toEqual([b!.id, c!.id]);
    // Hidden (a blank to fill): its note would name the hidden word.
    rerender(<DialogueStrip scene={scene} lineIds={[l2.id]} loopOnTap={false} masked={[b!.id]} maskStyle="blank" />);
    expect(stars()).toEqual([c!.id]);
    // Its word in place (fill-blanks fills a blank only with the right word): revealed, the asterisk is back.
    rerender(<DialogueStrip scene={scene} lineIds={[l2.id]} loopOnTap={false} masked={[b!.id]} maskStyle="blank" maskFill={{ [b!.id]: b!.fr }} />);
    expect(stars()).toEqual([b!.id, c!.id]);
  });

  it('the bubble draws each note on its own and scrolls a long one inside itself', () => {
    const l2 = FIXTURE_SCENE.lines[1]!;
    const u = l2.units[0]!;
    const long = 'A very long note. '.repeat(80).trim();
    const scene: Scene = {
      ...FIXTURE_SCENE,
      notes: [
        { kind: 'reference', text: 'First note.', phrase: 'x', lineId: l2.id, unitIds: [u.id] },
        { kind: 'wordplay', text: long, phrase: 'y', lineId: l2.id, unitIds: [u.id] },
      ],
    };
    const { container } = render(<DialogueStrip scene={scene} lineIds={[l2.id]} loopOnTap={false} />);
    fireEvent.click(container.querySelector(`[data-note-unit="${u.id}"]`)!);
    const notes = [...document.querySelectorAll('[data-bubble] [data-bubble-note]')].map((e) => e.textContent);
    expect(notes).toEqual(['First note.', long]);
    const max = parseFloat((document.querySelector('[data-bubble]') as HTMLElement).style.maxHeight);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(window.innerHeight);
    act(() => hint.hide());
  });
});
