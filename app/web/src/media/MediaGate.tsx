// The loading gate (docs/app-games.md, "Loading media"; the user's decision in docs/intent.md, "When
// something goes wrong"): the practice screen, the scene page and the karaoke screen show their content
// only once what its first moment needs is in (the scene's or song's audio and its first frames). Until
// then, after GATE_DELAY_MS (a cached load passes without a flash), a comic panel with an honest
// progress bar; after MEDIA_SLOW_MS a "slow connection" line; when a file fails (a stall of
// MEDIA_TIMEOUT_MS is a failure, media/fetchMedia.ts) the error panel with its detail line, « Réessayer »
// (the kid's tap, the only retry) and Home.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../../shared/i18n';
import { MEDIA_SLOW_MS, MediaLoadError } from './fetchMedia';
import { isLoaded, loadMedia, progressFraction, type FirstMoment } from './loadMedia';
import { log } from '../log';
import { Button, ErrorPanel, ProgressBar, cx } from '../ui';
import s from './MediaGate.module.css';

/** Nothing shows for this long, so a load from the cache passes without a flash of the bar. */
export const GATE_DELAY_MS = 300;

export interface MediaGateProps {
  /** What the first moment needs; null while the screen still waits for its data (the bar stays empty). */
  media: FirstMoment | null;
  /** The error panel's second way out. */
  onHome: () => void;
  /** Shown once everything is in. */
  children?: ReactNode;
  /** Called once everything is in (a screen whose own effects start sound waits for it). */
  onReady?: () => void;
  className?: string;
}

export function MediaGate({ media, onHome, children, onReady, className }: MediaGateProps) {
  const key = media ? JSON.stringify(media) : '';
  const [readyKey, setReadyKey] = useState<string | null>(() => (media && isLoaded(media) ? key : null));
  const [tries, setTries] = useState(0);
  const [share, setShare] = useState(0);
  const [byBytes, setByBytes] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  const ready = !!media && readyKey === key;

  const told = useRef(onReady);
  told.current = onReady;
  useEffect(() => {
    if (ready) told.current?.();
  }, [ready]);

  // From the gate's mount (the screen's data may still be loading) or the kid's « Réessayer ».
  useEffect(() => {
    if (ready) return;
    setSlow(false);
    const show = window.setTimeout(() => setShown(true), GATE_DELAY_MS);
    const late = window.setTimeout(() => setSlow(true), MEDIA_SLOW_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(late);
    };
  }, [ready, tries]);

  useEffect(() => {
    if (!media) return;
    if (isLoaded(media)) {
      setReadyKey(key);
      return;
    }
    let live = true;
    setShare(0);
    setError(null);
    loadMedia(media, (p) => {
      if (!live) return;
      // Bytes once every file said its size, else files; the bar never runs back between the two.
      setByBytes(p.total !== null);
      setShare((was) => Math.max(was, progressFraction(p)));
    }).then(
      () => live && setReadyKey(key),
      (e: unknown) => {
        if (!live) return;
        if (e instanceof MediaLoadError) log('media-fail', { reason: e.reason, status: e.status, src: e.src, where: 'gate' });
        setError(e);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tries]);

  if (ready) return <>{children}</>;
  if (error) {
    return (
      <div className={cx(s.gate, className)} data-media-gate="error">
        <ErrorPanel
          error={error}
          onRetry={() => {
            setError(null);
            setTries((n) => n + 1);
          }}
          secondary={
            <Button color="white" icon="home" onClick={onHome} data-error-home>
              {t('nav.home')}
            </Button>
          }
        />
      </div>
    );
  }
  const pct = Math.round(share * 100);
  return (
    <div className={cx(s.gate, className)} data-media-gate={shown ? (slow ? 'slow' : 'loading') : 'wait'} data-progress-by={byBytes ? 'bytes' : 'files'}>
      {shown && (
        <div className={s.panel}>
          <p className={s.title}>{t('common.loading')}</p>
          <ProgressBar value={pct} max={100} height={30} ariaLabel={t('common.loading')} className={s.bar} />
          {slow && (
            <div className={s.slowRow}>
              <p className={s.slow} data-media-slow>
                {t('common.media.slow')}
              </p>
              {/* A way out while it keeps loading (the practice screen has no other). */}
              <Button size="sm" color="white" icon="home" onClick={onHome} data-media-home>
                {t('nav.home')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
