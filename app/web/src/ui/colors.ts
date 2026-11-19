import type { CSSProperties } from 'react';

/** The block colours of the design system (tokens.css). */
export type BlockColor =
  | 'blue'
  | 'yellow'
  | 'lime'
  | 'cyan'
  | 'tomato'
  | 'purple'
  | 'pink'
  | 'green'
  | 'white'
  | 'orange'
  | 'teal'
  | 'red'
  | 'coral'
  | 'paper'
  // The current section's accents (tokens --section-accent*): fills that always stand out on the page.
  | 'accent'
  | 'accent-2'
  | 'accent-3';
export const BLOCK_COLORS: readonly BlockColor[] = ['blue', 'yellow', 'lime', 'cyan', 'tomato', 'purple', 'pink', 'green', 'white', 'orange', 'teal', 'red', 'coral', 'paper'];

/** The sections of the app; each owns a page colour (--section-<name>). */
export type Section =
  | 'home'
  | 'unlock'
  | 'episodes'
  | 'karaoke'
  | 'friends'
  | 'league'
  | 'shop'
  | 'profile'
  | 'achievements'
  | 'avatar'
  | 'practice'
  | 'chest'
  | 'login'
  | 'version';
export const SECTIONS: readonly Section[] = ['home', 'unlock', 'episodes', 'karaoke', 'friends', 'league', 'shop', 'profile', 'achievements', 'avatar', 'practice', 'chest', 'login', 'version'];

/** Colours dark enough that lettering on them is white with an ink outline (comic cover style). */
const DARK: ReadonlySet<BlockColor> = new Set(['blue', 'tomato', 'purple', 'green', 'teal', 'red']);

/** The accents of the current section, in order of loudness: accent-3 is ink with yellow lettering. */
export const ACCENT_COLORS: readonly BlockColor[] = ['accent', 'accent-2', 'accent-3'];

const ACCENT_TOKENS: Partial<Record<BlockColor, string>> = { accent: 'section-accent', 'accent-2': 'section-accent-2', 'accent-3': 'section-accent-3' };

/** CSS variables for a block colour: --c (fill), --c-dark (second tone), --c-text (lettering on it). */
export function colorVars(color: BlockColor): CSSProperties {
  const acc = ACCENT_TOKENS[color];
  if (acc) return { '--c': `var(--${acc})`, '--c-dark': 'var(--ink)', '--c-text': `var(--${acc}-ink)`, '--c-stroke': `var(--${acc}-stroke)` } as CSSProperties;
  return {
    '--c': `var(--${color})`,
    '--c-dark': `var(--${color}-dark)`,
    '--c-text': DARK.has(color) ? 'var(--white)' : 'var(--ink)',
    '--c-stroke': DARK.has(color) ? 'var(--ink)' : 'transparent',
  } as CSSProperties;
}

/** True when lettering on this colour should be white with an ink outline. */
export function isDarkColor(color: BlockColor): boolean {
  if (ACCENT_TOKENS[color]) return false; // unknown here: use colorVars, which follows the section
  return DARK.has(color);
}

/** The colour of the n-th unit of a line in the dialogue strip (cycles --unit-1..6). */
export function unitColorVars(index: number): CSSProperties {
  const k = (((index % 6) + 6) % 6) + 1;
  return { '--c': `var(--unit-${k})`, '--c-dark': `var(--unit-${k}-dark)`, '--c-text': 'var(--ink)', '--c-stroke': 'transparent' } as CSSProperties;
}

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
