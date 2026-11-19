// What a practice is for, as a tag in the level's colour: its medal and name (bronze to plutonium), or
// « Rejouer » / "Replay" for a replay (XP only, no level). In the practice header and on the results.
import type { CSSProperties } from 'react';
import { t, type TKey } from '../../../shared/i18n';
import type { Level } from '../../../shared/rules';
import { Badge, Icon, cx } from '../ui';
import s from './Practice.module.css';

export function LevelTag({ level, replay, className }: { level: number; replay: boolean; className?: string }) {
  const lv = Math.max(1, Math.min(6, Math.round(level || 1))) as Level;
  const name = t(`common.level.${lv}` as TKey);
  if (replay) {
    return (
      <span className={cx(s.levelTag, s.levelReplay, className)} title={t('practice.where.replayHint')} data-level-tag="replay">
        <Icon name="loop" size={18} />
        {t('practice.where.replay')}
      </span>
    );
  }
  return (
    <span className={cx(s.levelTag, className)} style={{ '--lv': `var(--level-${lv})` } as CSSProperties} title={t('practice.where.level', { level: name })} data-level-tag={lv}>
      <Badge level={lv} size={20} />
      {name}
    </span>
  );
}
