// Route /karaoke: the songs as comic covers; the first one plays right here (the full player),
// the others are one tap away.
import { useEffect, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import type { SongSummary } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { loadIndex } from '../api';
import { Caption, Spinner, Stamp, cx } from '../ui';
import s from './Karaoke.module.css';
import KaraokePlayerScreen from './KaraokePlayer';

export default function KaraokeScreen() {
  const [, navigate] = useLocation();
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  useEffect(() => {
    void loadIndex().then((i) => setSongs(i.songs));
  }, []);
  if (!songs) return <Spinner />;
  const first = songs[0];
  return (
    <div className={s.listPage}>
      <h1 className={s.pageTitle}>{t('karaoke.title')}</h1>
      {first && <KaraokePlayerScreen params={{ id: first.id }} compact={false} />}
      <Caption size="lg" tilt={-2}>
        {t('karaoke.allSongs')}
      </Caption>
      <div className={s.covers}>
        {songs.map((song, i) => (
          <button key={song.id} type="button" className={cx(s.cover)} style={{ '--tilt': `${[-2, 1.5, -1][i % 3]}deg` } as CSSProperties} onClick={() => navigate(`/karaoke/${song.id}`)} data-song={song.id}>
            <img src={song.thumb} alt="" />
            <Stamp color="yellow" tilt={6} className={s.coverNo}>
              {t('karaoke.no', { n: i + 1 })}
            </Stamp>
            <span className={s.coverTitle}>{song.titleFr}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
