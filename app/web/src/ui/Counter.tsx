import { useEffect, useRef, useState } from 'react';
import { cx } from './colors';
import { Icon, type IconName } from './icons';
import s from './Counter.module.css';

export interface CounterProps {
  icon: IconName; // e.g. flame, coin, potion, xp
  value: number;
  label: string; // accessible name, e.g. t('common.sesterces')
  dim?: boolean; // greyed (a streak not yet extended today)
  compact?: boolean; // smaller, for the phone top bar
  onClick?: () => void;
  className?: string;
}

/** A currency or streak count with its icon. The number bounces when it changes. */
export function Counter({ icon, value, label, dim, compact, onClick, className }: CounterProps) {
  const prev = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (prev.current !== value) setBump((b) => b + 1);
    prev.current = value;
  }, [value]);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag className={cx(s.counter, compact && s.compact, className)} onClick={onClick} aria-label={`${label}: ${value}`} title={label} {...(onClick ? { type: 'button' as const } : {})}>
      <Icon name={icon} size={compact ? 22 : 28} className={cx(dim && s.dim)} />
      <span key={bump} className={cx(s.value, bump > 0 && s.bump)}>
        {value}
      </span>
    </Tag>
  );
}
