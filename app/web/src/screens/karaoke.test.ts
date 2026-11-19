import { describe, expect, it } from 'vitest';
import type { Line } from '../../../shared/content';
import { rowIndexAt, songRows } from './KaraokePlayer';

const fr = "C'est un monde romain\nPas un monde gaulois";
const w = (word: string, startMs: number) => {
  const cs = fr.indexOf(word);
  return { fr: word, cs, ce: cs + word.length, startMs, endMs: startMs + 300 };
};
const line: Line = {
  id: 'x-1',
  speaker: null,
  fr,
  en: 'It is a Roman world\nNot a Gaulish world',
  startMs: 1000,
  endMs: 5000,
  units: [
    { id: 'x-1:1', kind: 'expression', fr: "C'est un monde romain", en: 'it is a Roman world', cs: 0, ce: 21, startMs: 1000, endMs: 2500, key: true, words: [w("C'est", 1000), w('romain', 2000)] },
    { id: 'x-1:2', kind: 'expression', fr: 'Pas un monde gaulois', en: 'not a Gaulish world', cs: 22, ce: 42, startMs: 3000, endMs: 5000, key: true, words: [w('Pas', 3000), w('gaulois', 4500)] },
  ],
};

describe('karaoke rows', () => {
  it('splits a lyric line at its line break, timed by its words', () => {
    const rows = songRows({ lines: [line] });
    expect(rows.map((r) => fr.slice(r.cs, r.ce))).toEqual(["C'est un monde romain", 'Pas un monde gaulois']);
    expect(rows[0]).toMatchObject({ startMs: 1000, endMs: 2300 });
    expect(rows[1]).toMatchObject({ startMs: 3000, endMs: 4800 });
  });

  it('shares an approximate line’s time by length', () => {
    const rows = songRows({ lines: [{ ...line, approxTimes: true }] });
    expect(rows[0]!.startMs).toBe(1000);
    expect(rows[1]!.startMs).toBeGreaterThan(2500);
    expect(rows[1]!.endMs).toBe(5000);
  });

  it('finds the row being sung', () => {
    const rows = songRows({ lines: [line] });
    expect(rowIndexAt(rows, 0)).toBe(-1);
    expect(rowIndexAt(rows, 1500)).toBe(0);
    expect(rowIndexAt(rows, 3100)).toBe(1);
  });
});
