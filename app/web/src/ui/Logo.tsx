import type { CSSProperties } from 'react';
import { cx } from './colors';
import s from './Logo.module.css';


/** The comic cover wordmark. `short` shows just "F". */
export function Logo({ size = 28, short = false, wiggle = false }: { size?: number; short?: boolean; wiggle?: boolean }) {
  const word = short ? 'F' : 'Frenchirix';
  return (
    <span className={cx(s.logo, wiggle && s.wiggle)} style={{ '--size': `${size}px` } as CSSProperties} aria-label="Frenchirix" role="img">
      {[...word].map((ch, i) => (
        <span key={i} className={s.letter} style={{ '--i': i } as CSSProperties} aria-hidden>
          {ch}
        </span>
      ))}
    </span>
  );
}
