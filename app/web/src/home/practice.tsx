// A practice's progress: "12 / 40" with an inked bar cut into segments of about ten puzzles.
import type { CSSProperties } from 'react';
import type { ScenePractice } from '../../../shared/api';
import { t } from '../../../shared/i18n';
/** Puzzles per segment of the bar (only drawing: a practice is played in one go). */
const SEGMENT = 10;
import { cx } from '../ui';
import s from './practice.module.css';

/** "12 / 40" (or "12 / …" before the total is known). */
export function practiceCount(p: Pick<ScenePractice, 'done' | 'total'>): string {
  return t('home.practice.count', { n: p.done, total: p.total ?? '…' });
}

/** The bar, one segment per SEGMENT puzzles, filled to the puzzles done. */
export function PracticeBar({ practice, label = true, small = false, className }: { practice: Pick<ScenePractice, 'done' | 'total'>; label?: boolean; small?: boolean; className?: string }) {
  const total = practice.total ?? Math.max(practice.done + SEGMENT, SEGMENT * 3);
  const segments = Math.max(1, Math.ceil(total / SEGMENT));
  const per = total / segments;
  return (
    <span className={cx(s.wrap, small && s.small, className)} data-practice-progress={`${practice.done}/${practice.total ?? ''}`} aria-label={t('home.practice.aria', { n: practice.done, total: practice.total ?? '…' })} role="img">
      <span className={s.bar}>
        {Array.from({ length: segments }, (_, i) => {
          const fill = Math.max(0, Math.min(1, (practice.done - i * per) / per));
          return (
            <span key={i} className={s.seg}>
              <span className={s.fill} style={{ '--f': fill } as CSSProperties} />
            </span>
          );
        })}
      </span>
      {label && <span className={s.count}>{practiceCount(practice)}</span>}
    </span>
  );
}
