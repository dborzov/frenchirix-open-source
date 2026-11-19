// OWNER: the rewards step (meta agent). Route /chest/:id: opening a loot box, the most satisfying ten seconds in the app.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import type { Chest } from '../../../shared/api';
import { t } from '../../../shared/i18n';
import { api, kindOf } from '../api';
import { fx } from '../fx';
import { Burst, Caption, Star } from '../home/comic';
import { ChestArt } from '../loot/ChestArt';
import { LootCard } from '../loot/LootCard';
import { bestRarity, lootPieces, rarityRank, type LootPiece } from '../loot/pieces';
import { usePlayer, usePlayerState } from '../state/player';
import { actionFailed, recover } from '../state/recover';
import { Button, cx, EmptyState, ErrorPanel, useLayout } from '../ui';
import s from './Chest.module.css';

type Phase = 'ready' | 'shaking' | 'burst' | 'reveal' | 'done' | 'error';

const SHAKE_MS = 1100;
const BURST_MS = 650;
const PIECE_MS = 1500;
const WORDS = ['chest.word.boum', 'chest.word.paf', 'chest.word.waouh'] as const;

export default function ChestScreen({ params }: { params: { id: string } }) {
  const st = usePlayerState();
  const layout = useLayout();
  const [, navigate] = useLocation();
  // Keep the chest we started with: opening removes it from the state.
  const [chest] = useState<Chest | undefined>(() => st.chests.find((c) => c.id === params.id));
  const [phase, setPhase] = useState<Phase>('ready');
  const [pieces, setPieces] = useState<LootPiece[]>([]);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const chestRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Reveal pieces one at a time.
  useEffect(() => {
    if (phase !== 'reveal') return;
    const p = pieces[shown - 1];
    if (p) {
      const big = p.kind === 'item' && rarityRank(p.rarity) >= 2;
      fx.sfx(p.kind === 'sesterces' ? 'coin' : p.kind === 'item' ? (big ? 'rankUp' : 'win') : 'pop');
      if (big) fx.confetti({ count: 120 });
    }
    if (shown >= pieces.length) {
      const id = window.setTimeout(() => setPhase('done'), 900);
      return () => clearTimeout(id);
    }
    const id = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 150 : PIECE_MS);
    return () => clearTimeout(id);
  }, [phase, shown, pieces]);

  if (!chest) {
    return (
      <div className={s.stage}>
        <EmptyState icon="chest" color="yellow" title={t('chest.gone')} text={t('chest.goneText')} action={<Button icon="home" onClick={() => navigate('/')}>{t('nav.home')}</Button>} />
      </div>
    );
  }

  const open = async () => {
    if (phase !== 'ready' && phase !== 'error') return;
    setPhase('shaking');
    fx.sfx('chest');
    const started = Date.now();
    try {
      const res = await api.openChest(chest.id);
      const wait = Math.max(0, SHAKE_MS - (Date.now() - started));
      later(() => {
        usePlayer.getState().apply(res.patch);
        setPieces(lootPieces(res.loot));
        setPhase('burst');
        fx.sfx('win');
        fx.confetti({ count: 80 });
        if (chestRef.current) fx.burst(chestRef.current, { color: 'var(--yellow)', count: 30 });
        later(() => {
          setShown(0);
          setPhase('reveal');
        }, BURST_MS);
      }, wait);
    } catch (e) {
      if (kindOf(e) === 'stale') {
        // Opened already, here in another tab or on another device: the fresh state, then Home.
        actionFailed(e);
        navigate('/');
        return;
      }
      recover(e);
      setError(e);
      setPhase('error');
    }
  };

  const skip = () => {
    if (phase === 'reveal') {
      if (shown < pieces.length) setShown((n) => n + 1);
      else setPhase('done');
    }
  };

  const best = bestRarity(pieces);
  const item = pieces.find((p) => p.kind === 'item');
  const current = phase === 'reveal' ? pieces[shown - 1] : undefined;
  const word = WORDS[chest.id.length % WORDS.length]!;
  const opened = phase === 'burst' || phase === 'reveal' || phase === 'done';

  return (
    <div className={cx(s.stage, layout === 'tablet' && s.tablet, best === 'legendary' && opened && s.legendary)} onClick={skip}>
      <div className={cx(s.lines, opened && s.linesFast)} aria-hidden />
      <div className={s.stars} aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <Star key={i} size={18 + (i % 3) * 8} className={s.star} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>

      <div className={s.top}>
        <Caption tilt={-2}>{t(`chest.kind.${chest.kind}` as const)}</Caption>
      </div>

      <div className={s.center}>
        {phase !== 'done' && (
          <div ref={chestRef} className={cx(s.chestBox, s[phase])}>
            {phase === 'burst' && (
              <span className={s.word}>
                <Burst word={t(word)} size={layout === 'tablet' ? 260 : 210} color="yellow" seed={9} />
              </span>
            )}
            <button type="button" className={s.chestButton} onClick={() => void open()} disabled={phase !== 'ready' && phase !== 'error'} aria-label={t('chest.tap')} data-chest-open>
              <ChestArt kind={chest.kind} size={layout === 'tablet' ? 260 : 200} open={opened} />
            </button>
          </div>
        )}

        {current && (
          <div key={shown} className={s.flyOut}>
            <LootCard piece={current} avatar={st.profile.avatar} big />
          </div>
        )}

        {phase === 'done' && (
          <div className={s.done}>
            <Burst word={t('chest.word.bravo')} size={150} color="tomato" textColor="white" seed={4} />
            <div className={s.haul}>
              {pieces.length === 0 ? (
                <p className={s.empty}>{t('chest.nothing')}</p>
              ) : (
                pieces.map((p, i) => (
                  <div key={i} className={s.haulItem} style={{ '--i': i } as CSSProperties}>
                    <LootCard piece={p} avatar={st.profile.avatar} />
                  </div>
                ))
              )}
            </div>
            <div className={s.actions}>
              {item && (
                <Button color="purple" size="lg" icon="profile" onClick={() => navigate('/avatar')}>
                  {t('chest.wear')}
                </Button>
              )}
              <Button color="green" size="lg" iconRight="forward" onClick={() => navigate('/')} data-chest-continue>
                {t('common.continue')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className={s.bottom}>
        {phase === 'ready' && <p className={s.prompt}>{t('chest.tap')}</p>}
        {phase === 'shaking' && <p className={s.prompt}>{t('chest.opening')}</p>}
        {phase === 'reveal' && (
          <div className={s.collected}>
            {pieces.slice(0, Math.max(0, shown - 1)).map((p, i) => (
              <span key={i} className={s.collectedDot} data-kind={p.kind} />
            ))}
            <span className={s.tapNext}>{t('chest.tapNext')}</span>
          </div>
        )}
        {phase === 'error' && (
          <ErrorPanel
            error={error}
            onRetry={() => void open()}
            secondary={
              <Button color="white" icon="home" onClick={() => navigate('/')} data-error-home>
                {t('nav.home')}
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
