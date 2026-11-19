import { cx } from './colors';
import s from './Spinner.module.css';

/** Four hopping coloured dots. */
export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return (
    <span className={cx(s.spinner, size !== 'md' && s[size])} role="status" aria-label={label}>
      <span className={s.dot} />
      <span className={s.dot} />
      <span className={s.dot} />
      <span className={s.dot} />
    </span>
  );
}
