// OWNER: the meta agent. Route /episodes: the kid's collection of unlocked scenes, to browse and
// re-watch. Three modes (remembered on the device): by unlock day (newest first), by episode (story
// order, runs of locked scenes collapsed to a count), and to review (next level earnable first).
import { useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { t } from '../../../shared/i18n';
import { CoverTag } from '../home/comic';
import { dayLabel, EpisodeSection, ScenePanel } from '../home/collection';
import { useIndex, useStartPractice } from '../home/hooks';
import { reviewOrder, unlockDays } from '../home/logic';
import { Loading, LoadError, ScreenTitle } from '../home/parts';
import { usePlayerState } from '../state/player';
import { Button, Caption, cx, EmptyState, Icon, useLayout, type IconName } from '../ui';
import s from './Episodes.module.css';

export { EPISODE_COLORS } from '../home/collection';

export type CollectionMode = 'timeline' | 'episodes' | 'review';
const MODES: { id: CollectionMode; icon: IconName }[] = [
  { id: 'timeline', icon: 'star' },
  { id: 'episodes', icon: 'episodes' },
  { id: 'review', icon: 'loop' },
];
const MODE_KEY = 'frenchirix.episodes.mode';

function readMode(): CollectionMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'timeline' || v === 'episodes' || v === 'review') return v;
  } catch {
    // storage blocked: the default
  }
  return 'timeline';
}

export default function EpisodesScreen() {
  const st = usePlayerState();
  const layout = useLayout();
  const [, navigate] = useLocation();
  const idx = useIndex();
  const [mode, setModeState] = useState<CollectionMode>(readMode);
  const { start, busy } = useStartPractice();
  const setMode = (m: CollectionMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // not remembered
    }
  };

  if (idx.error) return <LoadError error={idx.error} onRetry={idx.reload} />;
  if (!idx.data) return <Loading />;
  const { index, byId } = idx.data;
  const unlockedCount = Object.keys(st.progress).length;
  const tablet = layout === 'tablet';

  const tabs = (
    <div className={s.tabs} role="tablist" aria-label={t('episodes.title')}>
      {MODES.map((m, i) => (
        <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={cx(s.tab, mode === m.id && s.tabOn)} style={{ '--i': i } as CSSProperties} onClick={() => setMode(m.id)} data-mode={m.id}>
          <Icon name={m.icon} size={20} />
          {t(`episodes.mode.${m.id}` as const)}
        </button>
      ))}
    </div>
  );

  let body;
  if (unlockedCount === 0 && mode !== 'episodes') {
    body = <EmptyState icon="unlock" color="yellow" title={t('episodes.empty.title')} text={t('episodes.empty.text')} action={<Button color="yellow" size="lg" icon="unlock" onClick={() => navigate('/unlock')} data-empty-go>{t('episodes.empty.go')}</Button>} />;
  } else if (mode === 'timeline') {
    const order = st.daily.candidates.map((o) => o.sceneId);
    body = (
      <div className={s.days}>
        {unlockDays(st.progress, order).map((g0) => ({ ...g0, ids: g0.ids.filter((id) => byId.has(id)) })).filter((g) => g.ids.length > 0).map((g, gi) => (
          <section key={g.day} className={s.day} data-testid="unlock-day" data-today={g.day === st.today || undefined}>
            <div className={s.dayHead}>
              <Caption size="lg" tilt={gi % 2 ? 1 : -1.5} color={gi === 0 ? 'yellow' : 'paper'}>
                {dayLabel(g.day, st.today)}
              </Caption>
              <CoverTag color="white">{t('episodes.dayCount', { n: g.ids.length })}</CoverTag>
            </div>
            <div className={s.grid}>
              {g.ids.map((id, i) => (byId.get(id) ? <ScenePanel key={id} scene={byId.get(id)!} progress={st.progress[id]!} today={st.today} index={i} /> : null))}
            </div>
          </section>
        ))}
      </div>
    );
  } else if (mode === 'episodes') {
    body = (
      <div className={s.episodes}>
        {index.episodes.map((ep, i) => (
          <EpisodeSection key={ep.id} index={index} epIndex={i} progress={st.progress} today={st.today} byId={byId} />
        ))}
      </div>
    );
  } else {
    const list = reviewOrder(st.progress, st.today);
    const now = list.filter((c) => c.next.state === 'now');
    const later = list.filter((c) => c.next.state !== 'now');
    body = (
      <div className={s.days}>
        <div className={s.reviewTop}>
          <Button color="accent" icon="loop" onClick={() => list[0] && void start({ kind: 'scene', sceneId: list[0].sceneId })} loading={busy}>
            {t('home.comeBack.practice')}
          </Button>
        </div>
        {now.length > 0 && (
          <section className={s.day}>
            <div className={s.dayHead}>
              <Caption size="lg" color="yellow" tilt={-1.5}>
                {t('episodes.review.now')}
              </Caption>
              <CoverTag color="white">{t('episodes.dayCount', { n: now.length })}</CoverTag>
            </div>
            <div className={s.grid}>
              {now.map((c, i) => (byId.get(c.sceneId) ? <ScenePanel key={c.sceneId} scene={byId.get(c.sceneId)!} progress={c.progress} today={st.today} index={i} /> : null))}
            </div>
          </section>
        )}
        {later.length > 0 && (
          <section className={s.day}>
            <div className={s.dayHead}>
              <Caption size="lg" color="paper" tilt={1}>
                {t('episodes.review.later')}
              </Caption>
            </div>
            <div className={s.grid}>
              {later.map((c, i) => (byId.get(c.sceneId) ? <ScenePanel key={c.sceneId} scene={byId.get(c.sceneId)!} progress={c.progress} today={st.today} index={i} /> : null))}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className={cx(s.page, tablet && s.tablet)}>
      <ScreenTitle icon="episodes" color="cyan" right={<CoverTag color="yellow">{t('episodes.total', { n: unlockedCount, total: index.scenes.length })}</CoverTag>}>
        {t('episodes.title')}
      </ScreenTitle>
      {tabs}
      {body}
    </div>
  );
}
