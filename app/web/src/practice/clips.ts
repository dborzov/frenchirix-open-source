// The clips a practice's puzzles play besides the scene's audio, in puzzle order: a question's clip and
// its answers' (the puzzle names its question by id), and any media path a puzzle carries (line
// alternates, v1 word drills; a microphone puzzle's tapping replacement too). The practice screen fetches
// them ahead once the first puzzle is on screen (media/loadMedia.ts, fetchAhead).
import type { Scene } from '../../../shared/content';
import type { PuzzleBase } from '../../../shared/practice/types';

const MEDIA = /^\/media\//;

/** Every media path in a value (strings under /media/), depth first. */
function mediaIn(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (MEDIA.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) mediaIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) mediaIn(v, out);
  }
}

/** The clips of `puzzles` (from `from` on), in order, without repeats and without the scene's own audio. */
export function practiceClips(puzzles: readonly PuzzleBase[], scene: Scene, from = 0): string[] {
  const out: string[] = [];
  for (const p of puzzles.slice(from)) {
    const q = p.questionId ? scene.questions.find((x) => x.id === p.questionId) : undefined;
    if (q) mediaIn([q.audio, q.answers.map((a) => a.audio)], out);
    mediaIn(p, out);
  }
  return [...new Set(out)].filter((src) => src !== scene.audio.src && !scene.frames.some((f) => f.src === src));
}
