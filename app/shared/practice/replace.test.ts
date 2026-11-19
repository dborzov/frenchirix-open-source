import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentIndex, Scene } from '../content';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import '../puzzles/index';
import type { FillBlanksPuzzle } from '../puzzles/fill-blanks';
import type { RebuildPuzzle } from '../puzzles/rebuild';
import { sayHidden } from '../puzzles/say-hidden';
import { sayLine } from '../puzzles/say-line';
import { playPuzzle } from './bot';
import { VARIETY_SLACK, composePractice, speakingOffSteps, varietyBreaks } from './practice';
import { getPuzzleType } from './registry';
import { altCloseness, replaceMicPuzzle, replacementPlan } from './replace';
import { createRng } from './rng';
import type { BuildCtx } from './types';
import { validatePractice } from './validate';

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url));
const haveBundle = existsSync(`${dataDir}index.json`);
const bank: ContentIndex['bank'] = haveBundle ? (JSON.parse(readFileSync(`${dataDir}index.json`, 'utf8')) as ContentIndex).bank : FIXTURE_INDEX.bank;
const scenes: Scene[] = haveBundle ? readdirSync(`${dataDir}scenes`).map((f) => JSON.parse(readFileSync(`${dataDir}scenes/${f}`, 'utf8')) as Scene) : [FIXTURE_SCENE];

function ctxFor(scene: Scene, level: number, seed: number): BuildCtx {
  return { scene, level, rng: createRng(seed), focusUnitIds: new Set(), others: [], bank, usedLineIds: new Set(), usedUnitIds: new Set() };
}

describe('replaceMicPuzzle', () => {
  it('replaces every say-line and say-hidden puzzle of every scene with a playable tapping round, mostly on the same French', () => {
    const closeness = new Map<string, number>();
    let n = 0;
    for (const scene of scenes)
      for (const level of [1, 2, 4, 6])
        for (const logic of [sayLine, sayHidden]) {
          if (level < logic.meta.minLevel) continue;
          const puzzle = logic.build(ctxFor(scene, level, level));
          if (!puzzle) continue;
          const c = ctxFor(scene, level, 7);
          const usedBefore = [...c.usedLineIds];
          const r = replaceMicPuzzle(puzzle, scene, c)!;
          expect(r, `${scene.id} ${puzzle.id}`).not.toBeNull();
          expect([...c.usedLineIds]).toEqual(usedBefore); // the caller's sets are untouched
          const puzzleType = getPuzzleType(r.puzzle.type)!;
          expect(puzzleType.meta.needsMic).toBe(false);
          expect(puzzleType.validate(r.puzzle, scene)).toEqual([]);
          expect(playPuzzle(r.puzzle, puzzleType, { mode: 'perfect' }).problems).toEqual([]);
          expect(playPuzzle(r.puzzle, puzzleType, { mode: 'clumsy', seed: 3 }).problems).toEqual([]);
          if (r.closeness !== 'same-scene' && r.closeness !== 'watch') expect(r.puzzle.helpLineIds).toContain(puzzle.lineId);
          if (r.closeness === 'same-french' && puzzle.type === 'say-hidden') {
            expect((r.puzzle as FillBlanksPuzzle).blanks.map((b) => b.unitId)).toEqual([(puzzle as { unitId: string }).unitId]);
          }
          if (r.closeness === 'same-french' && puzzle.type === 'say-line' && !(puzzle as { unitId?: string }).unitId) {
            expect((r.puzzle as RebuildPuzzle).lineId).toBe(puzzle.lineId);
          }
          closeness.set(r.closeness, (closeness.get(r.closeness) ?? 0) + 1);
          n++;
        }
    expect(n).toBeGreaterThan(scenes.length * 6); // release 2.1 ships 50 scenes (was > 500 over 203)
    const close = (closeness.get('same-french') ?? 0) + (closeness.get('same-line') ?? 0);
    expect(close / n).toBeGreaterThan(0.99);
    expect((closeness.get('same-french') ?? 0) / n).toBeGreaterThan(0.75);
  });

  it('plans rebuild first for a line, fill-blanks first for a unit, and always ends on watch', () => {
    expect(replacementPlan({ id: 'x', type: 'say-line', sceneId: 's', helpLineIds: [], unitIds: [], lineId: 'l' } as never)[0]!.type).toBe('rebuild');
    const unit = replacementPlan({ id: 'x', type: 'say-hidden', sceneId: 's', helpLineIds: [], unitIds: [], lineId: 'l', unitId: 'l:2' } as never);
    expect(unit[0]).toMatchObject({ type: 'fill-blanks', targetUnitIds: ['l:2'] });
    expect(unit[unit.length - 1]!.type).toBe('watch');
  });

  it('a practice played with speaking turned off at any puzzle keeps the variety rule, and composes the same again', () => {
    let replaced = 0;
    for (const scene of scenes.slice(0, 40))
      for (const level of [1, 3, 5]) {
        const practice = composePractice({ id: 'l', seed: 5, scene, level, speak: true, bank });
        const lines = practice.plan.coverage.length;
        for (let k = 0; k < practice.puzzles.length; k++) {
          const steps = speakingOffSteps(practice, k);
          const where = `${scene.id} level ${level}, speaking off at ${k + 1}`;
          for (let i = Math.max(1, k); i < steps.length; i++) expect(steps[i]!.type, `${where}: ${i + 1}`).not.toBe(steps[i - 1]!.type);
          expect(varietyBreaks(steps, lines).length, where).toBeLessThanOrEqual(VARIETY_SLACK);
        }
        replaced += practice.puzzles.filter((t) => t.alt).length;
        // A continued practice is composed again from its seed: the same puzzles and the same replacements.
        const again = composePractice({ id: 'l', seed: 5, scene, level, speak: true, bank });
        expect(JSON.stringify(again.puzzles)).toBe(JSON.stringify(practice.puzzles));
      }
    expect(replaced).toBeGreaterThan(0);
  });

  it('the composer attaches a replacement to every microphone puzzle, and the checks validate it', () => {
    for (const scene of scenes.slice(0, 40))
      for (const level of [1, 3, 5]) {
        const practice = composePractice({ id: 'l', seed: 5, scene, level, speak: true, bank });
        for (const t of practice.puzzles) if (getPuzzleType(t.type)!.meta.needsMic) expect(altCloseness(t)).not.toBeNull();
        expect(validatePractice(practice, [scene])).toEqual([]);
        const broken = { ...practice, puzzles: practice.puzzles.map((t) => ({ ...t, alt: undefined })) };
        if (practice.puzzles.some((t) => t.alt)) expect(validatePractice(broken, [scene]).map((p) => p.message).join()).toMatch(/no tapping replacement/);
      }
  });
});
