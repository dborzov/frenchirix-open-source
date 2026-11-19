// The registry of puzzle type logic by type. Pure: used by the composer, the checks and the client.
// Each puzzle type registers itself from its own module (shared/puzzles/<type>.ts calls registerPuzzleType), and
// shared/puzzles/index.ts (written by the puzzle types step) imports every puzzle type module once.
// The client pairs each logic with its view in web/src/puzzles/registry.ts.

import type { AnyPuzzleType } from './types';

const puzzleTypes = new Map<string, AnyPuzzleType>();

export function registerPuzzleType(logic: AnyPuzzleType): void {
  const existing = puzzleTypes.get(logic.type);
  if (existing && existing !== logic) throw new Error(`puzzle type registered twice: ${logic.type}`);
  puzzleTypes.set(logic.type, logic);
}

export function getPuzzleType(type: string): AnyPuzzleType | undefined {
  return puzzleTypes.get(type);
}

/** Like getPuzzleType, but throws for an unknown type. */
export function requirePuzzleType(type: string): AnyPuzzleType {
  const g = puzzleTypes.get(type);
  if (!g) throw new Error(`unknown puzzle type: ${type}`);
  return g;
}

export function allPuzzleTypes(): AnyPuzzleType[] {
  return [...puzzleTypes.values()];
}
