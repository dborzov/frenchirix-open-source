// Pieces shared by the screens around the practices: scene thumbnails in level rings, ratings,
// the streak flame, screen titles, friendly load errors.
import type { CSSProperties, ReactNode } from 'react';
import type { SceneProgress } from '../../../shared/api';
import type { SceneSummary } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import type { Level } from '../../../shared/rules';
import { Badge, colorVars, cx, ErrorPanel, Icon, Spinner, type BlockColor, type IconName } from '../ui';
import type { NextLevel } from './logic';
import s from './parts.module.css';

/** When a scene's next level comes: now, tomorrow, in n days, or every level won (short: for small labels). */
export function nextLevelText(next: NextLevel, short = false): string {
  if (next.state === 'now') return t(short ? 'home.level.nowShort' : 'home.level.now');
  if (next.state === 'max') return t('home.level.max');
  if (next.days === 1) return t(short ? 'home.level.tomorrowShort' : 'home.level.tomorrow');
  return t(short ? 'home.level.inDaysShort' : 'home.level.inDays', { n: next.days });
}

export interface SceneThumbProps {
  scene: Pick<SceneSummary, 'id' | 'thumb' | 'titleFr'>;
  progress?: SceneProgress; // undefined: locked
  due?: boolean; // glows: its next level can be earned today
  size?: number;
  onClick?: () => void;
  wiggle?: number; // change to replay the "locked" wiggle
  className?: string;
  style?: CSSProperties;
  label?: string;
}

/** A scene as a round thumbnail in a ring of its level's colour, or a mystery when locked. */
export function SceneThumb({ scene, progress, due, size = 72, onClick, wiggle = 0, className, style, label }: SceneThumbProps) {
  const locked = !progress;
  const level = (progress?.level ?? 0) as Level;
  const ring = locked ? 'var(--locked)' : level === 0 ? 'var(--white)' : `var(--level-${level})`;
  const ringDark = locked ? 'var(--locked-dark)' : level === 0 ? 'var(--white-dark)' : `var(--level-${level}-dark)`;
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(s.thumb, locked && s.locked, due && !locked && s.due, level === 6 && s.plutonium, className)}
      style={{ '--size': `${size}px`, '--ring': ring, '--ring-dark': ringDark, ...style } as CSSProperties}
      aria-label={label ?? (locked ? t('common.locked') : `${scene.titleFr} · ${t(`common.level.${level}` as const)}`)}
    >
      <span key={wiggle} className={cx(s.disc, wiggle > 0 && s.wiggle)}>
        {locked ? (
          <span className={s.mystery}>
            <span className={s.qmark}>?</span>
            <span className={s.lockOver}>
              <Icon name="lock" size={Math.max(14, Math.round(size * 0.22))} />
            </span>
          </span>
        ) : (
          <img className={s.img} src={scene.thumb} alt="" loading="lazy" draggable={false} />
        )}
      </span>
      {!locked && level > 0 && (
        <span className={s.level}>
          <Badge level={level} size={Math.max(18, Math.round(size * 0.34))} />
        </span>
      )}
      {!locked && level === 0 && <span className={s.newDot}>{t('home.new')}</span>}
    </Tag>
  );
}

/** A 1-5 rating drawn as little pictures: laughing faces (funny) or chillies (hard). */
export function Rating({ value, kind, size = 20, label }: { value: number; kind: 'funny' | 'hard'; size?: number; label?: string }) {
  const n = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className={s.rating} role="img" aria-label={label ?? `${n}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cx(s.ratingItem, i >= n && s.off)} style={{ '--i': i } as CSSProperties}>
          {kind === 'funny' ? <LaughFace size={size} /> : <Chilli size={size} />}
        </span>
      ))}
    </span>
  );
}

function LaughFace({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12.5" r="10.5" fill="var(--yellow-dark)" />
      <circle cx="12" cy="11.5" r="10.5" fill="var(--yellow)" />
      <path d="M6.5 9.5q1.5-2 3 0M14.5 9.5q1.5-2 3 0" stroke="var(--ink)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M6 13h12q-1 6-6 6t-6-6z" fill="var(--ink)" />
      <path d="M8.5 16.6q3.5 2 7 0q-1 2.4-3.5 2.4t-3.5-2.4z" fill="var(--tomato)" />
    </svg>
  );
}

function Chilli({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d="M15 5c1.5-2 3-2.5 4.5-2" stroke="var(--green-dark)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M13 5.5c3-1 6 1 5.5 4.5C18 16 11 21.5 4 21c-1-.1-1.2-1-.4-1.5C9 16 9 12 10 8.5c.5-2 1.4-2.6 3-3z" fill="var(--tomato-dark)" />
      <path d="M13 4.5c3-1 6 1 5.5 4.5C18 15 11 20.5 4 20c-1-.1-1.2-1-.4-1.5C9 15 9 11 10 7.5c.5-2 1.4-2.6 3-3z" fill="var(--tomato)" />
      <path d="M12.5 7.5c-.7 1.5-1 3-1.3 4.5" stroke="var(--white)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" fill="none" />
      <path d="M12.5 5c1-1.4 3.4-1.8 4.6-.3" stroke="var(--green)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** The streak flame: alive and flickering when today is done, grey when not. */
export function StreakFlame({ count, alive, size = 64 }: { count: number; alive: boolean; size?: number }) {
  return (
    <span className={cx(s.flame, alive ? s.alive : s.cold)} style={{ '--size': `${size}px` } as CSSProperties} role="img" aria-label={`${t('common.streak')}: ${count}`}>
      <svg viewBox="0 0 64 72" width={size} height={(size * 72) / 64} aria-hidden className={s.flameSvg}>
        <path d="M32 3C36 17 52 24 52 44a20 20 0 0 1-40 0c0-9 4-15 9-20 0 7 3 11 7 12-3-11 0-23 4-33z" fill="var(--flame-outer)" />
        <path d="M32 30c3 7 10 10 10 19a10 10 0 0 1-20 0c0-5 3-8 5-10 0 3 2 5 4 5-1-5 0-10 1-14z" fill="var(--flame-inner)" />
      </svg>
      <span className={s.flameCount}>{count}</span>
    </span>
  );
}

/** A screen title with a coloured icon blob. */
export function ScreenTitle({ icon, color, children, right }: { icon: IconName; color: BlockColor; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={s.title}>
      <span className={s.titleBlob} style={colorVars(color)}>
        <Icon name={icon} size={30} />
      </span>
      <h1 className={s.titleText}>{children}</h1>
      {right}
    </div>
  );
}

/** A section heading inside a screen. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className={s.section}>
      <h2 className={s.sectionText}>{children}</h2>
      <span className={s.sectionSpacer} />
      {right}
    </div>
  );
}

/** A friendly "that did not load" with a retry button. Never a raw error. */
/** A load that failed: the error panel in place of the screen, « Réessayer » loads again. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <ErrorPanel error={error} onRetry={onRetry} />;
}

/** A designed loading state: a bouncing logo-coloured spinner with a word. */
export function Loading() {
  return (
    <div className={s.loading}>
      <Spinner size="lg" label={t('common.loading')} />
    </div>
  );
}
