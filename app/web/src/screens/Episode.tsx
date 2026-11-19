// OWNER: the meta agent. Route /episodes/:ep: one episode of the collection, its unlocked scenes in
// story order with runs of locked scenes collapsed to a count.
import { useLocation } from 'wouter';
import { t } from '../../../shared/i18n';
import { EpisodeSection } from '../home/collection';
import { useIndex } from '../home/hooks';
import { Loading, LoadError } from '../home/parts';
import { usePlayerState } from '../state/player';
import { Button, EmptyState, IconButton } from '../ui';
import s from './Episodes.module.css';

export default function EpisodeScreen({ params }: { params: { ep: string } }) {
  const st = usePlayerState();
  const [, navigate] = useLocation();
  const idx = useIndex();
  if (idx.error) return <LoadError error={idx.error} onRetry={idx.reload} />;
  if (!idx.data) return <Loading />;
  const { index, byId } = idx.data;
  const epIndex = index.episodes.findIndex((e) => e.id === params.ep);
  if (epIndex < 0) {
    return <EmptyState icon="episodes" color="tomato" title={t('common.error.not-found')} action={<Button icon="back" onClick={() => navigate('/episodes')}>{t('episodes.title')}</Button>} />;
  }
  return (
    <div className={s.page}>
      <div className={s.epHeader}>
        <IconButton icon="back" label={t('common.back')} onClick={() => navigate('/episodes')} />
      </div>
      <EpisodeSection index={index} epIndex={epIndex} progress={st.progress} today={st.today} byId={byId} />
    </div>
  );
}
