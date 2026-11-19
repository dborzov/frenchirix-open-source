// The kid's collection of unlocked scenes (the Episodes tab and one episode's page): scene panels,
// collapsed runs of locked scenes, and an episode's section.
import type { CSSProperties } from 'react';
import { useLocation } from 'wouter';
import type { SceneProgress } from '../../../shared/api';
import type { ContentIndex, SceneSummary } from '../../../shared/content';
import { getLanguage, t } from '../../../shared/i18n';
import { daysBetween, type Day, type Level } from '../../../shared/rules';
import { Badge, cx, Icon, ProgressBar, Stamp, type BlockColor } from '../ui';
import { collapseLocked, episodeProgress, nextLevel } from './logic';
import { nextLevelText } from './parts';
import { PracticeBar } from './practice';
import { usePlayer } from '../state/player';
import s from './collection.module.css';

export const EPISODE_COLORS: BlockColor[] = ['blue', 'red', 'green', 'purple', 'teal'];

export function isSong(scene: Pick<SceneSummary, 'kind' | 'songId'>): boolean {
  return scene.kind === 'song' || !!scene.songId;
}

/** "Aujourd'hui", "Hier", or a written date. */
export function dayLabel(day: Day, today: Day): string {
  const d = daysBetween(day, today);
  if (d === 0) return t('episodes.day.today');
  if (d === 1) return t('episodes.day.yesterday');
  try {
    return new Intl.DateTimeFormat(getLanguage() === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  } catch {
    return day;
  }
}

/** One unlocked scene as a comic panel: its frame, French title, level, and when the next level comes. */
export function ScenePanel({ scene, progress, today, small = false, index = 0 }: { scene: SceneSummary; progress: SceneProgress; today: Day; small?: boolean; index?: number }) {
  const [, navigate] = useLocation();
  const next = nextLevel(progress, today);
  const level = progress.level as Level;
  const practice = usePlayer((st) => st.state?.practices?.[scene.id]);
  return (
    <button
      type="button"
      className={cx(s.panel, small && s.small, (next.state === 'now' || !!practice) && s.due)}
      style={{ '--i': index } as CSSProperties}
      onClick={() => navigate(`/scene/${encodeURIComponent(scene.id)}`)}
      aria-label={`${scene.titleFr} · ${t(`common.level.${level}` as const)} · ${practice ? `${t('episodes.practiceBar')} ${practice.done} / ${practice.total ?? '…'}` : nextLevelText(next)}`}
      data-practice-progress={practice ? `${practice.done}/${practice.total ?? ''}` : undefined}
      data-testid="collection-scene"
      data-scene={scene.id}
      data-level={level}
    >
      <span className={s.frame}>
        <img src={scene.thumb} alt="" loading="lazy" draggable={false} />
        {isSong(scene) && <span className={s.song}>{t('unlock.song')}</span>}
        <span className={s.level}>{level > 0 ? <Badge level={level} size={small ? 26 : 34} /> : <span className={s.newTag}>{t('home.new')}</span>}</span>
      </span>
      <span className={s.title}>{scene.titleFr}</span>
      {practice ? (
        <PracticeBar practice={practice} small />
      ) : (
        <span className={cx(s.next, next.state === 'now' && s.nextNow)}>{nextLevelText(next, true)}</span>
      )}
    </button>
  );
}

/** A run of consecutive locked scenes, collapsed to a blacked-out mini panel with its count. */
export function LockedRun({ count }: { count: number }) {
  return (
    <span className={s.lockedRun} data-testid="locked-run" aria-label={t('episodes.lockedRun', { n: count })}>
      <span className={s.lockedQ} aria-hidden>
        ?
      </span>
      <span className={s.lockedCount}>
        <Icon name="lock" size={16} /> {t('episodes.lockedRun', { n: count })}
      </span>
    </span>
  );
}

/** One episode: its progress, then its scenes in story order with locked runs collapsed. */
export function EpisodeSection({ index, epIndex, progress, today, byId, onOpen }: { index: ContentIndex; epIndex: number; progress: Record<string, SceneProgress>; today: Day; byId: Map<string, SceneSummary>; onOpen?: () => void }) {
  const ep = index.episodes[epIndex]!;
  const p = episodeProgress(ep.sceneIds, progress, today);
  const color = EPISODE_COLORS[epIndex % EPISODE_COLORS.length]!;
  const style = { '--ep': `var(--${color})` } as CSSProperties;
  const head = (
    <span className={s.epHead}>
      <span className={s.epNo}>{t('episodes.no', { n: ep.number })}</span>
      <span className={s.epTitle}>{t('episodes.episode', { n: ep.number })}</span>
      <span className={s.epCount}>{t('episodes.unlockedOf', { n: p.unlocked, total: p.total })}</span>
    </span>
  );
  if (p.unlocked === 0) {
    return (
      <section className={cx(s.episode, s.episodeEmpty)} style={style} data-testid="episode-section" data-episode={ep.id}>
        {head}
        <LockedRun count={p.total} />
      </section>
    );
  }
  let n = 0;
  return (
    <section className={s.episode} style={style} data-testid="episode-section" data-episode={ep.id}>
      {onOpen ? (
        <button type="button" className={s.epHeadButton} onClick={onOpen}>
          {head}
          <Icon name="forward" size={22} />
        </button>
      ) : (
        head
      )}
      <div className={s.epStats}>
        <ProgressBar value={p.unlocked} max={p.total} color="yellow" height={14} ariaLabel={t('episodes.unlockedOf', { n: p.unlocked, total: p.total })} />
        <span className={s.levels}>
          {([1, 2, 3, 4, 5, 6] as Level[])
            .filter((m) => p.byLevel[m]! > 0)
            .map((m) => (
              <span key={m} className={s.levelCount}>
                <Badge level={m} size={20} />
                {p.byLevel[m]}
              </span>
            ))}
          {p.due > 0 && <Stamp color="yellow" tilt={3}>{t('episodes.dueN', { n: p.due })}</Stamp>}
        </span>
      </div>
      <div className={s.strip}>
        {collapseLocked(ep.sceneIds, progress).map((item) =>
          item.kind === 'locked' ? (
            <LockedRun key={`l-${item.firstId}`} count={item.count} />
          ) : byId.get(item.id) ? (
            <ScenePanel key={item.id} scene={byId.get(item.id)!} progress={progress[item.id]!} today={today} small index={n++} />
          ) : null,
        )}
      </div>
    </section>
  );
}
