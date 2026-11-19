// OWNER: the achievements screen (meta agent). Route /achievements: every achievement as a badge with progress or reward.
import { useEffect, type CSSProperties } from 'react';
import { ACHIEVEMENTS, ITEMS_BY_ID, type Achievement, type Reward } from '../../../shared/catalog';
import { getLanguage, t } from '../../../shared/i18n';
import { api } from '../api';
import { CoverTag, Star } from '../home/comic';
import { ScreenTitle } from '../home/parts';
import { usePlayer, usePlayerState } from '../state/player';
import { cx, Icon, ProgressBar, useLayout } from '../ui';
import s from './Achievements.module.css';

const EARNED_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'teal'];

export function rewardText(r: Reward, named?: { fr: string; en: string }): string {
  const lang = getLanguage();
  if (named) return named[lang];
  const parts: string[] = [];
  if (r.items?.length) parts.push(...r.items.map((id) => ITEMS_BY_ID.get(id)?.name[lang] ?? id));
  if (r.chest) parts.push(t(`chest.kind.${r.chest}` as const));
  if (r.sesterces) parts.push(`${r.sesterces} ${t('common.sesterces')}`);
  if (r.potions) parts.push(t('chest.potion', { n: r.potions }));
  if (r.xp) parts.push(`${r.xp} XP`);
  return parts.join(' + ');
}

export default function AchievementsScreen() {
  const st = usePlayerState();
  const layout = useLayout();
  const earnedCount = ACHIEVEMENTS.filter((a) => st.achievements[a.id]).length;

  // Mark newly earned achievements as seen.
  useEffect(() => {
    const unseen = Object.entries(st.achievements).filter(([, a]) => !a.seen).map(([id]) => id);
    if (!unseen.length) return;
    api.patchMe({ seenAchievements: unseen }).then((res) => usePlayer.getState().apply(res.patch), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = [...ACHIEVEMENTS].sort((a, b) => {
    const ea = st.achievements[a.id] ? 1 : 0;
    const eb = st.achievements[b.id] ? 1 : 0;
    if (ea !== eb) return eb - ea;
    return progressOf(b, st.stats) - progressOf(a, st.stats);
  });

  return (
    <div className={cx(s.page, layout === 'tablet' && s.tablet)}>
      <ScreenTitle icon="trophy" color="yellow" right={<CoverTag color="white">{t('achievements.count', { n: earnedCount, total: ACHIEVEMENTS.length })}</CoverTag>}>
        {t('achievements.title')}
      </ScreenTitle>
      <div className={s.grid}>
        {sorted.map((a, i) => {
          const earned = st.achievements[a.id];
          const have = st.stats[a.condition.stat] ?? 0;
          const hidden = a.secret && !earned;
          const isNew = earned && !earned.seen;
          return (
            <div key={a.id} className={cx(s.card, earned ? s.earned : s.locked)} style={{ '--i': i, '--earned': `var(--${EARNED_COLORS[i % EARNED_COLORS.length]})` } as CSSProperties}>
              {isNew && <span className={s.newTag}>{t('achievements.new')}</span>}
              <span className={s.badge}>
                {earned ? <Star size={56} color="yellow" /> : <Icon name={hidden ? 'help' : 'lock'} size={34} />}
              </span>
              <span className={s.name}>{hidden ? t('achievements.secret') : a.name[getLanguage()]}</span>
              <span className={s.desc}>{hidden ? t('achievements.secretText') : a.description[getLanguage()]}</span>
              {earned ? (
                <span className={s.reward}>
                  <Icon name="gift" size={18} /> {rewardText(a.reward, a.rewardName)}
                </span>
              ) : hidden ? null : (
                <>
                  <ProgressBar value={Math.min(have, a.condition.gte)} max={a.condition.gte} color="yellow" height={16} label={`${Math.min(have, a.condition.gte)} / ${a.condition.gte}`} />
                  <span className={s.rewardLocked}>
                    <Icon name="gift" size={16} /> {rewardText(a.reward, a.rewardName)}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function progressOf(a: Achievement, stats: Partial<Record<string, number>>): number {
  return Math.min(1, (stats[a.condition.stat] ?? 0) / a.condition.gte);
}
