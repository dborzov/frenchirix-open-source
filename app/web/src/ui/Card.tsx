import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import type { BlockColor } from './colors';
import { panelClass, panelStyle } from './Panel';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  color?: BlockColor;
  padding?: 'normal' | 'tight' | 'none';
  tilt?: number | boolean;
  children?: ReactNode;
}

/** A panel (kept as Card for existing code): cream paper or a flat colour, ink frame, hard shadow. */
export function Card({ color, padding = 'normal', tilt, className, style, ...rest }: CardProps) {
  return <div className={panelClass({ padding, thin: padding === 'tight' }, className)} style={panelStyle(color, tilt, style)} {...rest} />;
}

export interface PressableCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  color?: BlockColor;
  padding?: 'normal' | 'tight' | 'none';
  tilt?: number | boolean;
}

/** A panel that is a button: slams into its shadow on tap. */
export function PressableCard({ color, padding = 'normal', tilt, className, style, type = 'button', ...rest }: PressableCardProps) {
  return <button type={type} className={panelClass({ padding, thin: padding === 'tight', interactive: true }, className)} style={panelStyle(color, tilt, style)} {...rest} />;
}
