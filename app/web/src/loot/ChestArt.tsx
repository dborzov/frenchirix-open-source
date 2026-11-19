// A loot box drawn in SVG: wood, silver or gold. The lid is its own group so it can fly open.
import type { CSSProperties } from 'react';
import type { ChestKind } from '../../../shared/rules';
import { cx } from '../ui';
import s from './loot.module.css';

const LOOK: Record<ChestKind, { body: string; dark: string; band: string; bandDark: string; gem: string }> = {
  wood: { body: 'var(--level-1)', dark: 'var(--level-1-dark)', band: 'var(--locked)', bandDark: 'var(--locked-dark)', gem: 'var(--lime)' },
  silver: { body: 'var(--level-2)', dark: 'var(--level-2-dark)', band: 'var(--blue)', bandDark: 'var(--blue-dark)', gem: 'var(--cyan)' },
  gold: { body: 'var(--level-3)', dark: 'var(--level-3-dark)', band: 'var(--tomato)', bandDark: 'var(--tomato-dark)', gem: 'var(--purple)' },
};

export interface ChestArtProps {
  kind: ChestKind;
  size?: number;
  open?: boolean;
  /** Opened earlier: drawn open and faded. */
  empty?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function ChestArt({ kind, size = 80, open = false, empty = false, className, style }: ChestArtProps) {
  const c = LOOK[kind];
  return (
    <svg viewBox="0 0 100 92" width={size} height={(size * 92) / 100} className={cx(s.chestSvg, (open || empty) && s.chestOpen, empty && s.chestEmpty, className)} style={style} aria-hidden>
      {/* body */}
      <rect x="15" y="47" width="80" height="44" rx="2" fill="var(--ink)" />
      <rect x="10" y="42" width="80" height="42" rx="2" fill={c.body} stroke="var(--ink)" strokeWidth="4" />
      <path d="M14 56h72M14 70h72" stroke="var(--ink)" strokeWidth="2" opacity="0.55" />
      <rect x="18" y="42" width="9" height="42" fill={c.band} stroke="var(--ink)" strokeWidth="2.5" />
      <rect x="73" y="42" width="9" height="42" fill={c.band} stroke="var(--ink)" strokeWidth="2.5" />
      <rect x="18" y="80" width="9" height="4" fill={c.bandDark} />
      <rect x="73" y="80" width="9" height="4" fill={c.bandDark} />
      {/* inside glow, visible when open */}
      <ellipse className={s.chestGlow} cx="50" cy="44" rx="36" ry="7" fill="var(--yellow)" />
      {/* lid */}
      <g className={s.lid}>
        <path d="M15 47V33c0-14 12-22 40-22s40 8 40 22v14z" fill="var(--ink)" />
        <path d="M10 42V28c0-14 12-22 40-22s40 8 40 22v14z" fill={c.body} stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
        <path d="M18 42V14.5c3-2 6-3.4 9-4.3V42z" fill={c.band} />
        <path d="M82 42V14.5c-3-2-6-3.4-9-4.3V42z" fill={c.band} />
        <path d="M22 20c8-6 20-8 30-8" stroke="var(--white)" strokeWidth="3" strokeLinecap="round" opacity="0.45" fill="none" />
        {/* lock plate */}
        <rect x="41" y="34" width="18" height="20" rx="4" fill={c.bandDark} />
        <rect x="41" y="33" width="18" height="19" rx="1" fill={c.band} stroke="var(--ink)" strokeWidth="3" />
        <circle cx="50" cy="41" r="4" fill={c.gem} stroke={c.bandDark} strokeWidth="1.5" />
      </g>
    </svg>
  );
}
