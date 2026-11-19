// The karaoke's word check (shared/karaoke.ts) over every piece of French the app shows: no line,
// line alternate, question, answer or song lyric of the exported bundle may be refused, because the
// show's own words are never rude for this check (a kid singing a line must never be told off for it).
// Skipped in a clone without the bundle. The hand-written table is shared/karaoke.test.ts.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTake } from '../shared/karaoke';

const DATA = join(fileURLToPath(new URL('..', import.meta.url)), 'public/data');
const read = <T>(path: string): T => JSON.parse(readFileSync(join(DATA, path), 'utf8')) as T;

interface SceneText {
  lines: { id: string; fr: string; alternates?: { fr: string }[] }[];
  questions?: { id: string; fr: string; answers: { fr: string }[] }[];
}

const texts: { where: string; fr: string }[] = [];
if (existsSync(join(DATA, 'index.json'))) {
  const index = read<{ scenes: { id: string }[]; songs: { id: string }[] }>('index.json');
  for (const s of index.scenes) {
    const scene = read<SceneText>(`scenes/${s.id}.json`);
    for (const l of scene.lines) {
      texts.push({ where: l.id, fr: l.fr });
      (l.alternates ?? []).forEach((a, k) => texts.push({ where: `${l.id} alternate ${k}`, fr: a.fr }));
    }
    for (const q of scene.questions ?? []) {
      texts.push({ where: q.id, fr: q.fr });
      q.answers.forEach((a, k) => texts.push({ where: `${q.id} answer ${k}`, fr: a.fr }));
    }
  }
  for (const song of index.songs) for (const l of read<SceneText>(`songs/${song.id}.json`).lines) texts.push({ where: `${song.id} ${l.id}`, fr: l.fr });
}

describe.skipIf(texts.length === 0)('the karaoke check over the bundle', () => {
  it('refuses none of the show’s lines, alternates, questions, answers and lyrics', () => {
    expect(texts.length).toBeGreaterThan(3000); // 4,865 on 2026-11-15
    const refused = texts.map((x) => ({ ...x, words: checkTake(x.fr, []).words })).filter((x) => x.words.length);
    expect(refused).toEqual([]);
  });
});
