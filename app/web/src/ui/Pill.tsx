import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';
import { colorVars, cx, type BlockColor } from './colors';
import { Icon, type IconName } from './icons';
import s from './Pill.module.css';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  color?: BlockColor;
  icon?: IconName;
}

/** A small rounded label (not interactive). */
export function Pill({ color = 'white', icon, className, style, children, ...rest }: PillProps) {
  return (
    <span className={cx(s.pill, className)} style={{ ...colorVars(color), ...style }} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </span>
  );
}

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  color?: BlockColor;
  icon?: IconName;
  selected?: boolean;
}

/** A toggle chip (filters, tabs of options). Takes its colour when selected. */
export function Chip({ color = 'yellow', icon, selected = false, className, style, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button type={type} aria-pressed={selected} className={cx(s.chip, className)} style={{ ...colorVars(color), ...style }} {...rest}>
      {icon && <Icon name={icon} size={20} />}
      <span>{children}</span>
    </button>
  );
}
