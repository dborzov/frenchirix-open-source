// Route /unlock: the candidates screen of the current choose quest ("scenes to choose from", docs/
// app-rules.md, "Daily quests"). The kid chooses up to its target, now or over several visits the same
// day; a chosen candidate flies off to its new quest and leaves the selection. The choice that reaches
// the target sends the others back into the cauldron by themselves, then the screen goes Home, where
// the new scenes now sit in their quests (the kid sees the day's whole plan and its next quest, rather
// than being dropped into one practice). A locked choose quest says which quests come first; its
// candidates can still be watched. Every state has a way back to the quests.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import type { SceneSummary } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { DAILY_CANDIDATES } from '../../../shared/rules';
import { api } from '../api';
import { fx } from '../fx';
import { useDoMore, useIndex, useRefreshState } from '../home/hooks';
import { currentChoose, formatClock, questCards } from '../home/logic';
import { Burst } from '../home/comic';
import { Loading, LoadError, Rating, ScreenTitle } from '../home/parts';
import { waitingText } from '../home/quests';
import { Cauldron, Tip } from '../onboarding';
import { usePlayer, usePlayerState } from '../state/player';
import { actionFailed } from '../state/recover';
import { Button, cx, EmptyState, Icon, Panel, useLayout } from '../ui';
import s from './Unlock.module.css';

/** A chosen card's flight to its quest. */
const FLY_MS = 750;
/** The others' fall into the cauldron, before the screen goes Home. */
const CAULDRON_MS = 1400;
const HOME_AFTER_MS = 1100;

type CardState = 'choosable' | 'pending' | 'watch' | 'flying' | 'cauldron';
/** pick: choosing; cauldron: the others fall in; chosen: the choose quest is done (or was on arrival). */
type Phase = 'pick' | 'cauldron' | 'chosen';

/** Navigation state: the scene page chose `chose` and came back, so its card flies off here. */
interface ArrivalState {
  chose?: string;
}

export default function UnlockScreen() {
  const st = usePlayerState();
  const layout = useLayout();
  const [, navigate] = useLocation();
  const idx = useIndex();
  useRefreshState();
  const daily = st.daily;
  const choose = currentChoose(daily);
  const left = daily.unlocksLeft;
  const arrived = useRef<string | null>((typeof history !== 'undefined' ? (history.state as ArrivalState | null)?.chose : undefined) ?? null);
  const [flying, setFlying] = useState<string[]>(() => (arrived.current ? [arrived.current] : []));
  const [pending, setPending] = useState<string | null>(null);
  // The cauldron plays when the target is reached on this screen (or just before, on the scene page).
  const [phase, setPhase] = useState<Phase>(() => (left === 0 && !arrived.current ? 'chosen' : 'pick'));
  const [fell, setFell] = useState(false); // the others went into the cauldron on this visit
  const doMore = useDoMore(() => setPhase('pick'));

  // A reload must not replay the arrival's flight.
  useEffect(() => {
    if (arrived.current) history.replaceState({ ...(history.state as object), chose: undefined }, '');
  }, []);

  // Each flight ends with the card gone from the selection.
  useEffect(() => {
    if (!flying.length) return;
    const id = setTimeout(() => setFlying([]), FLY_MS);
    return () => clearTimeout(id);
  }, [flying]);

  // The target reached: the others go back into the cauldron by themselves, then Home.
  useEffect(() => {
    if (left > 0 || phase !== 'pick' || pending) return;
    const id = setTimeout(() => {
      setPhase('cauldron');
      setFell(true);
      fx.sfx('whoosh');
    }, FLY_MS);
    return () => clearTimeout(id);
  }, [left, phase, pending]);
  useEffect(() => {
    if (phase !== 'cauldron') return;
    const id = setTimeout(() => setPhase('chosen'), CAULDRON_MS);
    return () => clearTimeout(id);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'chosen' || !fell) return;
    const id = setTimeout(() => navigate('/'), HOME_AFTER_MS);
    return () => clearTimeout(id);
  }, [phase, fell, navigate]);

  const pick = async (sceneId: string, el: HTMLElement | null) => {
    if (pending || left <= 0) return;
    setPending(sceneId);
    fx.sfx('tap');
    try {
      const res = await api.unlock(sceneId);
      usePlayer.getState().apply(res.patch);
      setFlying((f) => [...f, sceneId]);
      fx.sfx('pop');
      if (el) fx.burst(el, { color: 'var(--yellow)', count: 24 });
    } catch (e) {
      // The card stays as it was; a stale view (already chosen, a new day, locked) refreshes the choice.
      actionFailed(e);
    } finally {
      setPending(null);
    }
  };

  if (idx.error) return <LoadError error={idx.error} onRetry={idx.reload} />;
  if (!idx.data) return <Loading />;
  const byId = idx.data.byId;
  const tablet = layout === 'tablet';
  const toQuests = (
    <Button size="lg" color="yellow" icon="home" onClick={() => navigate('/')} data-unlock-home>
      {t('unlock.toQuests')}
    </Button>
  );

  if (!choose) {
    return (
      <div className={cx(s.unlock, tablet && s.tablet)} data-testid="unlock-all-done">
        <ScreenTitle icon="unlock" color="tomato">
          {t('unlock.title')}
        </ScreenTitle>
        <EmptyState icon="trophy" color="yellow" title={t('home.all.title')} text={t('home.all.text')} action={toQuests} />
      </div>
    );
  }

  const locked = choose.locked && !choose.done;
  const waitingNumbers = locked ? (questCards(st).find((c) => c.quest.index === choose.index)?.waitingNumbers ?? []) : [];
  const candidates = daily.candidates.map((o) => ({ candidate: o, scene: byId.get(o.sceneId) })).filter((x): x is { candidate: (typeof daily.candidates)[number]; scene: SceneSummary } => !!x.scene);
  const shown = candidates.filter(({ candidate, scene }) => (!candidate.unlocked && phase !== 'chosen') || flying.includes(scene.id));
  const unchosen = candidates.filter((o) => !o.candidate.unlocked).length;

  const cardState = (id: string): CardState => {
    if (flying.includes(id)) return 'flying';
    if (phase === 'cauldron') return 'cauldron';
    if (locked || left <= 0) return 'watch';
    return pending === id ? 'pending' : 'choosable';
  };

  let lead: string;
  if (locked) lead = waitingText(waitingNumbers);
  else if (left > 0) lead = choose.chosen > 0 ? t('unlock.leadMore', { n: left }) : t('unlock.lead', { n: left });
  else lead = t('unlock.chosenAll');

  return (
    <div className={cx(s.unlock, tablet && s.tablet, shown.length === 0 && s.empty)} data-testid="unlock" data-phase={phase} data-locked={locked || undefined} data-left={left}>
      <ScreenTitle icon="unlock" color="tomato" right={<Keys left={left} target={choose.target} />}>
        {t('unlock.title')}
      </ScreenTitle>

      {locked ? (
        <Panel className={s.lockedPanel} color="white" tilt={-1} data-unlock-locked={waitingNumbers.join(',')}>
          <span className={s.lockBig} aria-hidden>
            <Icon name="lock" size={40} />
          </span>
          <span className={s.lockedText}>
            <strong>{lead}</strong>
            <span>{t('unlock.lockedText')}</span>
          </span>
        </Panel>
      ) : (
        <div className={s.leadRow}>
          <p className={s.lead}>{lead}</p>
          {left > 0 && choose.chosen === 0 && (
            <Tip id="unlock-pick" placement="inline" className={s.leadTip}>
              {t('unlock.tip')}
            </Tip>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <div className={s.grid}>
          {shown.map(({ scene }) => {
            const i = candidates.findIndex((c) => c.scene.id === scene.id);
            return (
              <CandidateCard
                key={scene.id}
                scene={scene}
                state={cardState(scene.id)}
                index={i}
                busy={!!pending}
                onPick={(el) => void pick(scene.id, el)}
                onOpen={() => navigate(`/scene/${encodeURIComponent(scene.id)}`)}
              />
            );
          })}
        </div>
      )}

      <div className={s.footer}>
        <div className={cx(s.pot, phase === 'cauldron' && s.potGulp)}>
          <Cauldron size={tablet ? (shown.length === 0 ? 200 : 120) : 96} />
          {fell && unchosen > 0 && <span className={s.cauldronNote} data-cauldron-note={unchosen}>{t('unlock.backInCauldron', { n: unchosen })}</span>}
        </div>
        <div className={s.footerActions}>
          {phase === 'chosen' && daily.doMore ? (
            <>
              <p className={s.hint}>{t('unlock.moreReady', { n: DAILY_CANDIDATES })}</p>
              <Button size="xl" color="accent" icon="plus" onClick={() => void doMore.more()} loading={doMore.busy} className={s.go} data-do-more-button>
                {t('home.quests.doMore')}
              </Button>
            </>
          ) : phase === 'chosen' ? (
            <p className={s.hint}>{t('unlock.afterQuests', { n: DAILY_CANDIDATES })}</p>
          ) : null}
          {toQuests}
        </div>
      </div>
    </div>
  );
}

function Keys({ left, target }: { left: number; target: number }) {
  return (
    <span className={s.keys} aria-label={t('unlock.left', { n: left })}>
      {Array.from({ length: target }, (_, i) => (
        <span key={i} className={cx(s.key, i >= left && s.keyUsed)}>
          <Icon name="unlock" size={22} />
        </span>
      ))}
      <span className={s.keysCount}>{left}</span>
    </span>
  );
}

const COVER_COLORS = ['blue', 'tomato', 'green', 'purple', 'cyan'];

function CandidateCard({ scene, state, index, busy, onPick, onOpen }: { scene: SceneSummary; state: CardState; index: number; busy: boolean; onPick: (el: HTMLElement | null) => void; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const song = scene.kind === 'song' || !!scene.songId;
  const cover = COVER_COLORS[index % COVER_COLORS.length]!;
  const flying = state === 'flying';
  return (
    <div className={cx(s.cardWrap, s[state])} style={{ '--i': index, '--cover': `var(--${cover}, var(--blue))` } as CSSProperties} data-testid="unlock-cover" data-scene={scene.id} data-state={state}>
      <div ref={ref} className={s.card} aria-label={`${scene.titleFr}${flying ? ` · ${t('unlock.unlocked')}` : ''}`} role="group">
        <span className={s.masthead}>
          <span className={s.issueNo}>{t('unlock.issue', { n: index + 1 })}</span>
          <span className={s.title}>{scene.titleFr}</span>
        </span>
        <button type="button" className={s.thumb} onClick={onOpen} aria-label={t('unlock.watchFirst', { title: scene.titleFr })} disabled={flying}>
          <img src={scene.thumb} alt="" loading="lazy" draggable={false} />
          <span className={s.playOver} aria-hidden>
            <Icon name="play" size={34} />
          </span>
          {state === 'watch' && (
            <span className={s.lockCorner} aria-hidden>
              <Icon name="lock" size={20} />
            </span>
          )}
          {song && <span className={s.songStamp}>{t('unlock.song')}</span>}
          {flying && (
            <span className={s.burstOver}>
              <Burst word={t('unlock.burst')} size={130} color="yellow" seed={index + 2} />
            </span>
          )}
          {flying && (
            <span className={s.ribbon}>
              <Icon name="check" size={18} /> {t('unlock.toQuest')}
            </span>
          )}
          <span className={s.length}>{formatClock(scene.durationMs)}</span>
        </button>
        <span className={s.info}>
          <span className={s.row}>
            <span className={s.rowLabel}>{t('unlock.funny')}</span>
            <Rating value={scene.score} kind="funny" size={16} label={t('unlock.funnyN', { n: scene.score })} />
          </span>
          <span className={s.row}>
            <span className={s.rowLabel}>{t('unlock.hard')}</span>
            <Rating value={scene.difficulty} kind="hard" size={16} label={t('unlock.hardN', { n: scene.difficulty })} />
          </span>
          <span className={s.actions}>
            <button type="button" className={s.watchIt} onClick={onOpen} data-testid="unlock-watch" disabled={flying}>
              <Icon name="play" size={18} /> {t('unlock.watch')}
            </button>
            {(state === 'choosable' || state === 'pending') && (
              <button type="button" className={s.pickMe} onClick={() => onPick(ref.current)} disabled={busy} data-testid="unlock-pick">
                {t('unlock.pick')}
              </button>
            )}
          </span>
        </span>
      </div>
    </div>
  );
}
