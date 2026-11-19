import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { colorVars, cx, type BlockColor } from './colors';
import { Icon, type IconName } from './icons';
import s from './Button.module.css';
import { Spinner } from './Spinner';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  color?: BlockColor;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

/** The chunky 3D button. Presses down on tap. At least 44 px tall in every size. */
export function Button({ color = 'blue', size = 'md', icon, iconRight, block, loading, className, style, children, disabled, type = 'button', ...rest }: ButtonProps) {
  const iconSize = size === 'sm' ? 20 : size === 'xl' ? 34 : size === 'lg' ? 28 : 24;
  return (
    <button
      type={type}
      className={cx(s.button, size !== 'md' && s[size], block && s.block, loading && s.loading, className)}
      style={{ ...colorVars(color), ...style }}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={iconSize} className={s.icon} />}
      {children != null && <span className={s.label}>{children}</span>}
      {iconRight && <Icon name={iconRight} size={iconSize} className={s.icon} />}
      {loading && (
        <span className={s.spin}>
          <Spinner size="sm" />
        </span>
      )}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'children'> {
  icon: IconName;
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  color?: BlockColor;
  size?: ButtonSize;
  /** What it starts is on its way (a sound still loading): the hopping dots instead of the icon. */
  busy?: boolean;
}

/** A round chunky button with one icon. */
export function IconButton({ icon, label, color = 'white', size = 'md', busy, className, style, type = 'button', ...rest }: IconButtonProps) {
  const iconSize = size === 'sm' ? 22 : size === 'xl' ? 40 : size === 'lg' ? 32 : 26;
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(s.button, s.iconButton, size !== 'md' && s[size], busy && s.busy, className)}
      style={{ ...colorVars(color), ...style }}
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner size="sm" /> : <Icon name={icon} size={iconSize} />}
    </button>
  );
}
