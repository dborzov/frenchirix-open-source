// Colours of the avatar's free choices. Art colours are literal on purpose: they are drawing
// pigments, not UI colours, and must look the same everywhere an avatar appears.
import type { AvatarBase } from '../../../shared/catalog';

export const INK = '#111111';

export const SKIN: Record<AvatarBase['skin'], string> = {
  s1: '#ffe3d0',
  s2: '#fdd2b4',
  s3: '#f7c19c',
  s4: '#eaa97c',
  s5: '#d99362',
  s6: '#c27a4a',
  s7: '#a5643a',
  s8: '#874c2b',
  s9: '#6a3920',
  s10: '#4e2a18',
};

export const HAIR: Record<AvatarBase['hairColor'], string> = {
  blond: '#f6c544',
  ginger: '#ee7b2f',
  auburn: '#a8432a',
  brown: '#8a5631',
  black: '#2e2433',
  grey: '#aaa3ae',
  white: '#f3efe6',
  red: '#e43d30',
  blue: '#3b82f6',
  pink: '#ff7eb6',
  green: '#3fbf5a',
  purple: '#9b5de5',
};

// Avatar backgrounds: flat printing-ink colours (docs/app-style.md), halftone added in the drawing.
export const BG: Record<AvatarBase['bgColor'], string> = {
  sky: '#1e88e5',
  mint: '#22b14c',
  sun: '#ffd21f',
  peach: '#ff7a1a',
  lilac: '#7a3ff2',
  rose: '#e8303a',
  lime: '#fff3d0',
  teal: '#2f7fa8',
};
function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Mix a #rrggbb colour toward black (amount > 0) or white (amount < 0). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = amount >= 0 ? 0 : 255;
  const a = Math.abs(amount);
  const mix = (c: number) => clamp(c + (t - c) * a);
  return `#${((1 << 24) | (mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).slice(1)}`;
}
