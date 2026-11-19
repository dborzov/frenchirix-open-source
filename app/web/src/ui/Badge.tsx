import { t } from '../../../shared/i18n';
import { levelName, type Level } from '../../../shared/rules';
import { cx } from './colors';
import s from './Badge.module.css';

export interface BadgeProps {
  level: Level; // 0 = none yet (an empty slot)
  locked?: boolean; // the scene itself is locked
  size?: number;
  showLabel?: boolean;
  className?: string;
}

const RIBBON = ['#e9dcc0', '#1e88e5', '#e8303a', '#22b14c', '#7a3ff2', '#ff7a1a', '#111111'];

/** A level of the spaced-repetition ladder, inked like a comic prop: bronze ... plutonium, or locked. */
export function Badge({ level, locked = false, size = 48, showLabel = false, className }: BadgeProps) {
  const key = locked ? 'locked' : levelName(level);
  const fill = locked ? 'var(--locked)' : `var(--level-${level})`;
  const tone = locked ? 'var(--locked-dark)' : level === 0 ? 'var(--level-0)' : `var(--level-${level}-dark)`;
  const label = locked ? t('common.locked') : t(`common.level.${level}` as const);
  const empty = level === 0 && !locked;
  return (
    <span className={cx(s.badge, s[key], className)}>
      <svg className={s.level} viewBox="0 0 52 60" width={size} height={(size * 60) / 52} role="img" aria-label={label}>
        {!locked && level > 0 && (
          <g stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="miter">
            <path d="M13 2h9l5 19h-9z" fill={RIBBON[level]} />
            <path d="M37 2h-9l-5 19h9z" fill={RIBBON[level]} />
          </g>
        )}
        <circle cx="28.5" cy="39.5" r="17.5" fill="var(--ink)" />
        <circle cx="25" cy="36" r="17.5" fill={empty ? 'transparent' : fill} stroke="var(--ink)" strokeWidth={3} strokeDasharray={empty ? '5 4' : undefined} />
        {locked ? (
          <g stroke="var(--ink)" strokeWidth={2.8} strokeLinejoin="miter">
            <path d="M19.5 34v-4a5.5 5.5 0 0 1 11 0v4" fill="none" />
            <rect x="16.5" y="33.5" width="17" height="12" fill="var(--paper)" />
          </g>
        ) : level > 0 ? (
          <g>
            <circle cx="25" cy="36" r="12" fill={tone} opacity={0.35} />
            <path d="m25 26.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4-4.7-4.6 6.5-.9z" fill="var(--white)" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="miter" />
            <path d="M13.5 30a12.5 12.5 0 0 1 6-6" stroke="var(--white)" strokeWidth={3} strokeLinecap="square" fill="none" />
            {level === 5 && <path className={s.shine} d="M40 17l1.6 3.8L45.5 22l-3.9 1.4L40 27l-1.6-3.6L34.5 22l3.9-1.2z" fill="var(--white)" stroke="var(--ink)" strokeWidth={1.5} />}
          </g>
        ) : null}
      </svg>
      {showLabel && <span className={s.label}>{label}</span>}
    </span>
  );
}
