import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentIndex, Scene } from '../content';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import { playPuzzle } from '../practice/bot';
import { createRng } from '../practice/rng';
import type { BuildCtx } from '../practice/types';
import { question, type QuestionPuzzle } from './question';

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url));
const haveBundle = existsSync(`${dataDir}index.json`);
/** Tests that need the real scenes of the exported bundle (`frenchirix export-app`); skipped without it. */
const bundleIt = haveBundle ? it : it.skip;
const bank: ContentIndex['bank'] = haveBundle ? (JSON.parse(readFileSync(`${dataDir}index.json`, 'utf8')) as ContentIndex).bank : FIXTURE_INDEX.bank;
const scenes: Scene[] = haveBundle ? readdirSync(`${dataDir}scenes`).map((f) => JSON.parse(readFileSync(`${dataDir}scenes/${f}`, 'utf8')) as Scene) : [FIXTURE_SCENE];

function ctxFor(scene: Scene, seed: number, extra: Partial<BuildCtx> = {}): BuildCtx {
  return { scene, level: 1, rng: createRng(seed), focusUnitIds: new Set(), others: [], bank, usedLineIds: new Set(), usedUnitIds: new Set(), ...extra };
}

describe('question', () => {
  bundleIt('builds valid puzzles for every scene with questions', () => {
    let built = 0;
    const firsts = new Map<number, number>();
    for (const scene of scenes.filter((s) => s.questions.length))
      for (const seed of [1, 2, 3]) {
        const puzzle = question.build(ctxFor(scene, seed)) as QuestionPuzzle;
        expect(puzzle).not.toBeNull();
        built++;
        expect(puzzle.questionId).toBeTruthy();
        expect(question.validate(puzzle, scene)).toEqual([]);
        const pos = puzzle.order.indexOf(puzzle.correct);
        firsts.set(pos, (firsts.get(pos) ?? 0) + 1);
        expect(playPuzzle(puzzle, question, { mode: 'perfect' }).problems).toEqual([]);
        expect(playPuzzle(puzzle, question, { mode: 'clumsy', seed }).problems).toEqual([]);
      }
    expect(built).toBeGreaterThan(0);
    // The right answer moves around.
    expect(firsts.size).toBeGreaterThanOrEqual(3);
  });

  bundleIt('honours allowedQuestionIds', () => {
    const scene = scenes.find((s) => s.questions.length >= 2)!;
    const only = scene.questions[1]!.id;
    expect(question.build(ctxFor(scene, 1, { allowedQuestionIds: new Set([only]) }))!.questionId).toBe(only);
    expect(question.build(ctxFor(scene, 1, { allowedQuestionIds: new Set() }))).toBeNull();
    expect(question.build(ctxFor({ ...scene, questions: [] }, 1))).toBeNull();
  });

  it('greys out wrong answers without finishing; validate catches broken puzzles', () => {
    const scene = scenes.find((s) => s.questions.length)!;
    const puzzle = question.build(ctxFor(scene, 4))!;
    const wrong = puzzle.order.find((i) => i !== puzzle.correct)!;
    let st = question.init(puzzle);
    st = question.reduce(puzzle, st, { kind: 'pick', answer: wrong });
    st = question.reduce(puzzle, st, { kind: 'pick', answer: wrong });
    expect(st.wrong).toEqual([wrong]);
    expect(question.isDone(puzzle, st)).toBe(false);
    st = question.reduce(puzzle, st, { kind: 'pick', answer: puzzle.correct });
    expect(question.isDone(puzzle, st)).toBe(true);
    expect(question.validate({ ...puzzle, correct: wrong }, scene).join()).toMatch(/correct/);
    expect(question.validate({ ...puzzle, order: puzzle.order.slice(1) }, scene).join()).toMatch(/permutation/);
    expect(question.validate({ ...puzzle, helpLineIds: [] }, scene).join()).toMatch(/help strip/);
    const q = scene.questions.find((x) => x.id === puzzle.questionId)!;
    const broken = { ...scene, questions: [{ ...q, answers: q.answers.map((a) => ({ ...a, correct: true })) }] };
    expect(question.validate(puzzle, broken).join()).toMatch(/correct answers/);
  });
});

describe('question, targeted', () => {
  bundleIt('prefers a question about the target line, and falls back to any allowed one', () => {
    const scene = scenes.find((s) => new Set(s.questions.map((q) => q.lineId)).size >= 2)!;
    for (const q of scene.questions) expect(question.build(ctxFor(scene, 1, { targetLineId: q.lineId! }))!.lineId).toBe(q.lineId);
    const other = scene.lines.find((l) => !scene.questions.some((q) => q.lineId === l.id));
    if (other) expect(question.build(ctxFor(scene, 1, { targetLineId: other.id }))).not.toBeNull();
  });
});
