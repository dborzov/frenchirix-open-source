// The colour of a line in a whole-scene view: its segment in the playback bar (SceneBar) and its panel
// in the dialogue (place-words, the scene player's strip) share it, so the kid can match the two.
// The n-th line takes --unit-(n mod 6 + 1). The boxes of a line drawn on its colour cycle through the
// five other colours, so no box ever has the fill of its panel (docs/app-style.md, "Colour").
import type { CSSProperties } from 'react';
import { unitColorVars } from '../ui';

/** The palette slot (0..5) of the n-th line. */
export function lineSlot(lineIndex: number): number {
  return ((lineIndex % 6) + 6) % 6;
}

/** `--lc` (the line's colour) and `--lc-dark` for the n-th line of a whole-scene view. */
export function lineColorVars(lineIndex: number): CSSProperties {
  const k = lineSlot(lineIndex) + 1;
  return { '--lc': `var(--unit-${k})`, '--lc-dark': `var(--unit-${k}-dark)` } as CSSProperties;
}

/** The colour of the n-th unit of a line drawn on its line's colour: never the line's own colour. */
export function unitOnLineColorVars(unitIndex: number, lineIndex: number): CSSProperties {
  return unitColorVars(lineSlot(lineIndex) + 1 + (((unitIndex % 5) + 5) % 5));
}
