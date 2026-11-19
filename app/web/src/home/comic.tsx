// Thin adapters from the screens' call sites to the comic components of the design system
// (ui/Comic.tsx, ui/Burst.tsx). Only `Star` is drawn here, as ui/ has no star.
import type { CSSProperties, ReactNode } from 'react';
import { Balloon as UiBalloon, Burst as UiBurst, Caption as UiCaption, Stamp, cx, type BlockColor } from '../ui';
import s from './comic.module.css';

type Color = BlockColor;

/** A caption box (ui Caption) inside an optional heading element for semantics. */
export function Caption({ children, color = 'accent', tilt = -1.5, className, as, size }: { children: ReactNode; color?: Color; tilt?: number; className?: string; as?: 'h1' | 'h2' | 'h3'; size?: 'md' | 'lg' }) {
  const cap = (
    <UiCaption color={color} tilt={tilt} size={size ?? (as === 'h1' ? 'lg' : 'md')} className={as ? undefined : className}>
      {children}
    </UiCaption>
  );
  if (!as) return cap;
  const Tag = as;
  return <Tag className={cx(s.heading, className)}>{cap}</Tag>;
}

/** A jagged burst holding a sound word (ui Burst). */
export function Burst({ word, size = 160, color = 'yellow', textColor, seed = 3, tilt = -6, className, animate = true, style }: { word: ReactNode; size?: number; color?: Color; textColor?: 'ink' | 'white' | 'yellow'; seed?: number; tilt?: number; className?: string; animate?: boolean; style?: CSSProperties }) {
  return (
    <span aria-hidden className={className} style={{ display: 'inline-flex', ...style }}>
      <UiBurst size={size} color={color} text={textColor} seed={seed} rotate={tilt} pop={animate}>
        {word}
      </UiBurst>
    </span>
  );
}

/** A speech balloon (ui Balloon); the corner names map to an edge and a position on it. */
export function Balloon({ children, tail = 'bottom-left', className, style }: { children: ReactNode; tail?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'; className?: string; style?: CSSProperties }) {
  const [edge, side] = tail.split('-') as ['bottom' | 'top', 'left' | 'right'];
  return (
    <UiBalloon tail={edge} tailAt={side === 'left' ? '18%' : '78%'} flip={side === 'right'} boxy className={className} style={style}>
      {children}
    </UiBalloon>
  );
}

/** A cover detail: "N° 3", a price, a level (ui Stamp). */
export function CoverTag({ children, color = 'white', tilt = 4, className, style }: { children: ReactNode; color?: Color; tilt?: number; className?: string; style?: CSSProperties }) {
  return (
    <Stamp color={color} tilt={tilt} className={className} style={style}>
      {children}
    </Stamp>
  );
}

/** A small five-point star (rewards, motion). */
export function Star({ size = 22, color = 'yellow', className, style }: { size?: number; color?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden>
      <path d="m12 1.5 3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6l-6.4 3.5L7 14l-5.3-5 7.2-.9z" fill={`var(--${color}, var(--yellow))`} stroke="var(--ink)" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
