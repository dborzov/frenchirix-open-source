// Comic furniture used as interface (docs/app-style.md): Caption, Balloon, Stamp, SpeedLines, Halftone.
// Burst lives in Burst.tsx, Panel in Panel.tsx.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { colorVars, cx, type BlockColor } from './colors';
import s from './Comic.module.css';

// --- Caption ----------------------------------------------------------------------------------

export interface CaptionProps extends HTMLAttributes<HTMLSpanElement> {
  /** The section's accent by default, so it always stands out on the page; pass 'yellow' for the classic narration box on a panel. */
  color?: BlockColor;
  tilt?: number; // degrees
  size?: 'md' | 'lg'; // lg: display lettering, for section titles
}

/** The narration box, for labels and section titles. Filled with the section's accent unless told otherwise. */
export function Caption({ color = 'accent', tilt = 0, size = 'md', className, style, ...rest }: CaptionProps) {
  return <span className={cx(s.caption, size === 'lg' && s.captionLg, className)} style={{ ...colorVars(color), '--tilt': `${tilt}deg`, ...style } as CSSProperties} {...rest} />;
}

// --- Balloon ----------------------------------------------------------------------------------

export type TailSide = 'bottom' | 'top' | 'left' | 'right';

export interface BalloonProps extends HTMLAttributes<HTMLDivElement> {
  /** The edge the tail comes out of. */
  tail?: TailSide | 'none';
  /** Where along that edge, as a CSS length or percentage (default 24% on top/bottom, 50% on the sides). */
  tailAt?: string;
  /** Point the tail the other way (towards the left on top/bottom). */
  flip?: boolean;
  /** Less oval, for longer text. */
  boxy?: boolean;
  color?: BlockColor; // white by default
  children?: ReactNode;
}

/** A speech balloon with a tail: translations, hints, tips. Position it with normal layout or absolutely. */
export function Balloon({ tail = 'bottom', tailAt, flip, boxy, color = 'white', className, style, children, ...rest }: BalloonProps) {
  return (
    <div className={cx(s.balloon, boxy && s.boxy, className)} style={{ ...colorVars(color), ...(tailAt ? { '--at': tailAt } : null), ...style } as CSSProperties} {...rest}>
      {children}
      {tail !== 'none' && (
        <svg className={cx(s.tail, s[`tail-${tail}`], flip && s.flip)} viewBox="0 0 30 30" aria-hidden>
          <path d="M3 0 L4 28 L22 0" fill={`var(--${color})`} stroke="var(--ink)" strokeWidth={3} strokeLinejoin="miter" />
          <rect x="0" y="-3" width="30" height="4.5" fill={`var(--${color})`} />
        </svg>
      )}
    </div>
  );
}

// --- Stamp ------------------------------------------------------------------------------------

export interface StampProps extends HTMLAttributes<HTMLSpanElement> {
  /** issue: a square box ("N° 3"); price: a round tag ("10¢"); plain: just the lettering, like "Vol. I". */
  variant?: 'issue' | 'price' | 'plain';
  color?: BlockColor;
  tilt?: number;
}

/** A cover detail used playfully for counters, streaks and levels. */
export function Stamp({ variant = 'issue', color = 'paper', tilt = -5, className, style, ...rest }: StampProps) {
  return <span className={cx(s.stamp, variant !== 'issue' && s[`stamp-${variant}`], className)} style={{ ...colorVars(color), '--tilt': `${tilt}deg`, ...style } as CSSProperties} {...rest} />;
}

// --- Textures ---------------------------------------------------------------------------------

export interface SpeedLinesProps {
  /** Origin of the rays, CSS percentages. */
  x?: string;
  y?: string;
  color?: string; // CSS colour of the lines (default translucent white)
  /** Clear radius around the origin, percentage. */
  hole?: string;
  density?: 'normal' | 'dense' | 'sparse';
  className?: string;
  style?: CSSProperties;
}

/** Radiating speed lines; fills its positioned parent, under the content. */
export function SpeedLines({ x = '50%', y = '50%', color, hole = '18%', density = 'normal', className, style }: SpeedLinesProps) {
  const gap = density === 'dense' ? '7deg' : density === 'sparse' ? '17deg' : '11deg';
  return <span aria-hidden className={cx(s.texture, s.speedlines, className)} style={{ '--ox': x, '--oy': y, '--hole': hole, '--gap': gap, ...(color ? { '--line': color } : null), ...style } as CSSProperties} />;
}

export interface HalftoneProps {
  color?: string; // dot colour (default translucent ink)
  dot?: number; // dot radius px
  step?: number; // grid px
  fade?: 'none' | 'top' | 'bottom' | 'corner';
  className?: string;
  style?: CSSProperties;
}

/** Ben-Day halftone dots; fills its positioned parent, under the content. */
export function Halftone({ color, dot = 1.6, step = 9, fade = 'none', className, style }: HalftoneProps) {
  return <span aria-hidden className={cx(s.texture, s.halftone, fade !== 'none' && s[`fade-${fade}`], className)} style={{ '--r': `${dot}px`, '--step': `${step}px`, ...(color ? { '--dot': color } : null), ...style } as CSSProperties} />;
}
