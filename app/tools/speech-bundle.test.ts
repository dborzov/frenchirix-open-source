// scoreSpeech over every real line of the exported bundle (skipped in a clone without it).
// Lives in tools/ because it reads files (node types); the hand-written table is shared/speech.test.ts.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../shared/practice/rng';
import { scoreSpeech } from '../shared/speech';

const DATA = join(fileURLToPath(new URL('..', import.meta.url)), 'public/data');
const lines: string[] = existsSync(join(DATA, 'index.json'))
  ? (JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8')) as { scenes: { id: string }[] }).scenes.flatMap(
      (s) => (JSON.parse(readFileSync(join(DATA, 'scenes', `${s.id}.json`), 'utf8')) as { lines: { fr: string }[] }).lines.map((l) => l.fr),
    )
  : [];

// Thousands of alignments: slow under a full parallel test run, so a generous timeout.
describe.skipIf(lines.length === 0)('scoreSpeech over every line of the bundle', { timeout: 60_000 }, () => {
  it('passes each line read back perfectly, and without accents or punctuation', () => {
    const failed = lines.filter((l) => !scoreSpeech(l, l).pass || scoreSpeech(l, l).score < 0.99);
    expect(failed).toEqual([]);
    const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s']/gu, ' ').toLowerCase();
    const failedPlain = lines.filter((l) => !scoreSpeech(l, plain(l)).pass);
    expect(failedPlain).toEqual([]);
  });

  it('rarely passes a different line', () => {
    const rng = createRng(5);
    let passes = 0;
    const examples: string[] = [];
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const a = rng.pick(lines);
      const b = rng.pick(lines);
      if (a === b) continue;
      const r = scoreSpeech(a, b);
      if (r.pass) {
        passes++;
        if (examples.length < 10) examples.push(`${a} <= ${b}`);
      }
    }
    // Short lines that share their words ("Oui." vs "Oui, oui.") can pass; keep it under 1%.
    expect(passes / N, examples.join('\n')).toBeLessThan(0.01);
  });

  it('never throws and keeps its shape on noisy input', () => {
    const rng = createRng(9);
    const junk = ['', ' ', '!!!', '…', 'é', "'", '-', '123456789', 'ŒUF œuf', '🙂 bonjour', 'a'.repeat(300)];
    for (let i = 0; i < 300; i++) {
      const exp = rng.pick(lines);
      const heard = rng.next() < 0.5 ? rng.pick(junk) : rng.shuffle(rng.pick(lines).split(' ')).join(' ');
      const r = scoreSpeech(exp, heard, { kind: rng.next() < 0.5 ? 'unit' : 'line' });
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.matched.length).toBe(r.expectedWords.length);
    }
  });
});
