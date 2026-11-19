import type { CSSProperties } from 'react';
import { colorVars, cx, type BlockColor } from './colors';
import s from './ProgressBar.module.css';

export interface ProgressBarProps {
  value: number; // 0..max
  max?: number;
  color?: BlockColor;
  height?: number;
  label?: string; // shown inside the bar
  ariaLabel?: string;
  className?: string;
}

/** A chunky striped progress bar that bounces when it grows. */
export function ProgressBar({ value, max = 1, color = 'lime', height = 22, label, ariaLabel, className }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      className={cx(s.track, pct === 0 && s.empty, className)}
      style={{ ...colorVars(color), '--h': `${height}px` } as CSSProperties}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={ariaLabel ?? label}
    >
      <div className={s.fill} style={{ width: `${pct * 100}%` }} />
      {label && <span className={s.label}>{label}</span>}
    </div>
  );
}
