// The "watch the scene once" puzzle type: the scene plays with its dialogue strip; the kid finishes it by
// watching to the end. The reference puzzle type for the plug-in contract and the composer's intro.

import type { Scene } from '../content';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';

export interface WatchPuzzle extends PuzzleBase {
  type: 'watch';
}

export interface WatchState {
  done: boolean;
}

export type WatchAction = { kind: 'ended' };

export const watch: PuzzleType<WatchPuzzle, WatchState, WatchAction> = {
  type: 'watch',
  meta: {
    role: 'intro',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 25,
    weight: 1,
    name: 'Watch the scene',
    purpose:
      'The whole scene plays once with its slideshow and dialogue strip; the kid listens and follows the French and its meaning.',
    depth: 'intro',
    scope: 'scene',
  },
  build(ctx: BuildCtx): WatchPuzzle | null {
    const { scene } = ctx;
    if (scene.lines.length === 0) return null;
    return {
      id: `${scene.id}:watch`,
      type: 'watch',
      sceneId: scene.id,
      helpLineIds: scene.lines.map((l) => l.id),
      unitIds: [],
    };
  },
  init(): WatchState {
    return { done: false };
  },
  reduce(_puzzle, state, action): WatchState {
    if (action && action.kind === 'ended') return { done: true };
    return state;
  },
  isDone(_puzzle, state) {
    return state.done;
  },
  mistakes() {
    return 0;
  },
  missedUnitIds() {
    return [];
  },
  solve(): WatchAction {
    return { kind: 'ended' };
  },
  validate(puzzle: WatchPuzzle, scene: Scene): string[] {
    const problems: string[] = [];
    if (scene.lines.length === 0) problems.push('watch: the scene has no lines');
    if (scene.audio.durationMs <= 0) problems.push('watch: the scene audio has no duration');
    const ids = new Set(scene.lines.map((l) => l.id));
    if (puzzle.helpLineIds.length !== scene.lines.length || puzzle.helpLineIds.some((id) => !ids.has(id)))
      problems.push('watch: the dialogue strip must show every line of the scene');
    return problems;
  },
};
