import type { CSSProperties, ReactNode } from 'react';
import { cx, isDarkColor, type BlockColor } from './colors';
import s from './Burst.module.css';

/** The polygon points of a jagged starburst in a 100 x 100 box (deterministic for a seed). */
export function burstPoints(points = 14, seed = 7, depth = 0.3): string {
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    return (a % 1000) / 1000;
  };
  const out: string[] = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + (rnd() - 0.5) * 0.12;
    const r = i % 2 === 0 ? 48 - rnd() * 6 : 48 * (1 - depth) - rnd() * 8;
    out.push(`${(50 + Math.cos(angle) * r).toFixed(1)},${(50 + Math.sin(angle) * r).toFixed(1)}`);
  }
  return out.join(' ');
}

export interface BurstProps {
  /** The word (a comic sound word through t(): PAF ! / POW!, BOUM ! / BOOM!, BRAVO !...) or any content. */
  children?: ReactNode;
  size?: number; // width in px
  color?: BlockColor; // fill; white by default, like the reference
  /** 'ink' (default on light fills) or 'white' lettering with an ink outline. */
  text?: 'ink' | 'white' | 'yellow';
  rotate?: number; // degrees
  points?: number;
  seed?: number;
  /** Width to height ratio of the shape (1 = round, 0.8 = a little wide). */
  ratio?: number;
  /** Size of the word relative to the burst (default 0.22). */
  scale?: number;
  /** Slam in when it mounts. */
  pop?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A jagged starburst with an ink outline and a hard shadow, holding a word. */
export function Burst({ children, size = 160, color = 'white', text, rotate = -6, points = 14, seed = 7, ratio = 0.8, scale = 0.22, pop = false, className, style }: BurstProps) {
  const lettering = text ?? (isDarkColor(color) ? 'white' : 'ink');
  // Long words get smaller lettering so they stay inside the burst.
  const len = typeof children === 'string' ? children.replace(/\s+/g, '').length : 4;
  const fit = Math.min(scale, 0.9 / Math.max(4.5, len));
  const accent = color.startsWith('accent') && !text;
  const vars = {
    '--size': `${size}px`,
    '--rot': `${rotate}deg`,
    '--ratio': ratio,
    '--scale': fit,
    '--sh': `${Math.max(3, Math.round(size / 36))}px`,
    '--burst-text': lettering === 'ink' ? 'var(--ink)' : lettering === 'yellow' ? 'var(--yellow)' : 'var(--white)',
    '--burst-stroke': lettering === 'ink' ? '0' : `${Math.max(1.5, size / 90)}px`,
    '--burst-shadow': lettering === 'ink' ? 'none' : `${Math.max(2, size / 70)}px ${Math.max(2, size / 70)}px 0 var(--ink)`,
    ...(accent
      ? {
          '--burst-text': `var(--section-${color}-ink)`,
          '--burst-stroke': `${Math.max(1.5, size / 90)}px`,
          '--burst-shadow': `${Math.max(2, size / 70)}px ${Math.max(2, size / 70)}px 0 var(--section-${color}-stroke)`,
        }
      : null),
  } as CSSProperties;
  return (
    <span className={cx(s.burst, pop && s.pop, className)} style={{ ...vars, ...style }}>
      <svg className={s.shape} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <polygon points={burstPoints(points, seed)} fill={`var(--${color})`} stroke="var(--ink)" strokeWidth={Math.max(2, 400 / size)} strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
      </svg>
      {children != null && <span className={s.word}>{children}</span>}
    </span>
  );
}
