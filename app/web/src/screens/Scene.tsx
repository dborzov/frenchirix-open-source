// Route /scene/:id: the watch page. Watching is the main thing: the scene loops with its slideshow
// and the strip of tappable boxes. Under it, one button plays the scene's practice and says what it is
// worth: the started practice to continue (with its progress), the next level when it is due, or a
// replay for XP only when it is not (with the days until it is). A full watch is reported once
// (POST /api/scenes/:id/view).
// A scene that is one of the current candidates (daily.candidates, not chosen) can be previewed the
// same way, with "choose this scene" and "back to the choice" instead; nothing is reported for it.
// Any other locked scene shows nothing of its content.
import { PracticeBar } from '../home/practice';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import type { Scene } from '../../../shared/content';
import { t, type TKey } from '../../../shared/i18n';
import { DAILY_CANDIDATES, DAILY_UNLOCKS, MAX_LEVEL, XP, type Level } from '../../../shared/rules';
import { api, loadIndex, loadScene } from '../api';
import { fx } from '../fx';
import { useStartPractice } from '../home/hooks';
import { currentChoose, nextLevel, questCards } from '../home/logic';
import { nextLevelText } from '../home/parts';
import { waitingText } from '../home/quests';
import { MediaGate } from '../media/MediaGate';
import { firstMoment, isLoaded } from '../media/loadMedia';
import { ScenePlayer } from '../scene/ScenePlayer';
import { usePlayer } from '../state/player';
import { actionFailed, recover } from '../state/recover';
import { Badge, Button, Caption, ErrorPanel, Icon, IconButton, Panel, Stamp, cx, useLayout } from '../ui';
import s from './Scene.module.css';

interface Neighbours {
  episodeId: string;
  episodeNumber: number;
  order: number; // 1-based position in the episode
  total: number;
  prev: { id: string; thumb: string; titleFr: string } | null;
  next: { id: string; thumb: string; titleFr: string } | null;
  song: boolean;
}

export default function SceneScreen({ params }: { params: { id: string } }) {
  const id = params.id;
  const [, navigate] = useLocation();
  const layout = useLayout();
  const progress = usePlayer((st) => st.state?.progress[id]);
  const allProgress = usePlayer((st) => st.state?.progress);
  const today = usePlayer((st) => st.state?.today);
  const daily = usePlayer((st) => st.state?.daily);
  const st = usePlayer((x) => x.state);
  const [scene, setScene] = useState<Scene | null>(null);
  const [nb, setNb] = useState<Neighbours | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tries, setTries] = useState(0);
  const [english, setEnglish] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [mediaInFor, setMediaInFor] = useState<string | null>(null);
  const { start, busy } = useStartPractice();
  const statePractice = usePlayer((st) => st.state?.practices?.[params.id]);
  const reported = useRef(false);
  const candidate = !progress && !!daily?.candidates.some((o) => o.sceneId === id && !o.unlocked);
  const locked = !progress && !candidate;

  useEffect(() => {
    reported.current = false;
    setScene(null);
    setError(null);
    if (locked) return;
    loadScene(id).then(setScene, (e: unknown) => {
      recover(e);
      setError(e);
    });
  }, [id, locked, tries]);

  useEffect(() => {
    let live = true;
    void loadIndex().then((index) => {
      const sum = index.scenes.find((x) => x.id === id);
      const ep = index.episodes.find((e) => e.id === sum?.episode);
      if (!live || !sum || !ep) return;
      const pos = ep.sceneIds.indexOf(id);
      const unlocked = (sid: string) => !!allProgress?.[sid];
      const pick = (sid: string | undefined) => {
        const x = sid ? index.scenes.find((y) => y.id === sid) : undefined;
        return x ? { id: x.id, thumb: x.thumb, titleFr: x.titleFr } : null;
      };
      setNb({
        episodeId: ep.id,
        episodeNumber: ep.number,
        order: pos + 1,
        total: ep.sceneIds.length,
        prev: pick([...ep.sceneIds.slice(0, pos)].reverse().find(unlocked)),
        next: pick(ep.sceneIds.slice(pos + 1).find(unlocked)),
        song: sum.kind === 'song' || !!sum.songId,
      });
    });
    return () => {
      live = false;
    };
  }, [id, allProgress]);

  const onFullWatch = () => {
    if (reported.current || !progress) return; // a candidate's preview is not a view
    reported.current = true;
    api
      .viewScene(id)
      .then((r) => usePlayer.getState().apply(r.patch))
      .catch(() => {
        reported.current = false;
      });
  };

  const choose = async () => {
    setChoosing(true);
    try {
      const res = await api.unlock(id);
      usePlayer.getState().apply(res.patch);
      fx.sfx('pop');
      // Back to the choice, where this scene's card flies off to its quest (and the others go back
      // into the cauldron when this was the last choice).
      navigate('/unlock', { state: { chose: id } });
    } catch (e) {
      actionFailed(e);
    } finally {
      setChoosing(false);
    }
  };

  const next = useMemo(() => (progress && today ? nextLevel(progress, today) : null), [progress, today]);
  const back = () => {
    if (candidate) navigate('/unlock');
    else if (window.history.length > 1) window.history.back();
    else navigate('/episodes');
  };

  const header = (
    <header className={s.header}>
      <IconButton icon="back" label={candidate ? t('scene.watch.backToChoice') : t('common.back')} size="sm" onClick={back} />
      <span className={s.headerTags}>
        {nb?.song && (
          <Stamp color="purple" tilt={4}>
            {t('unlock.song')}
          </Stamp>
        )}
        {nb && (
          <Stamp color="yellow" tilt={-4}>
            {t('scene.page.where', { ep: nb.episodeNumber, n: nb.order, total: nb.total })}
          </Stamp>
        )}
      </span>
    </header>
  );

  if (locked) {
    return (
      <div className={s.page} data-scene-page="locked">
        {header}
        <Panel className={s.locked} tilt={-1}>
          <span className={s.lockIcon}>
            <Icon name="lock" size={64} />
          </span>
          <Caption size="lg" tilt={-2}>
            {t('scene.page.lockedTitle')}
          </Caption>
          <p className={s.lockedText}>{t('scene.page.lockedText', { n: DAILY_CANDIDATES, k: DAILY_UNLOCKS })}</p>
          <Button color="yellow" size="lg" icon="unlock" onClick={() => navigate('/unlock')}>
            {t('scene.page.goUnlock')}
          </Button>
        </Panel>
      </div>
    );
  }

  if (error) {
    return (
      <div className={s.page}>
        {header}
        <ErrorPanel error={error} onRetry={() => setTries((n) => n + 1)} />
      </div>
    );
  }
  if (!scene) {
    // The same gate as below (by its key), so its bar and its slow line run on from the scene's data to its media.
    return (
      <div className={s.page}>
        {header}
        <MediaGate key={`gate:${id}`} media={null} onHome={() => navigate('/')} className={s.player} />
      </div>
    );
  }

  const level = (progress?.level ?? 0) as Level;
  const freeNotes = scene.notes.filter((n) => !n.lineId && !(n.unitIds && n.unitIds.length));
  const tablet = layout === 'tablet';
  // While the gate is up (loading or its error panel), the action is not a sticky bar: it would cover
  // the error panel's detail line and copy button. It sits in the page under the gate until the media are in.
  const mediaIn = mediaInFor === scene.id || isLoaded(firstMoment(scene));
  const picksLeft = daily?.unlocksLeft ?? 0;
  const chooseQuest = daily ? currentChoose(daily) : null;
  const chooseLocked = !!chooseQuest?.locked && !chooseQuest.done;
  const waitingNumbers = chooseLocked && st ? (questCards(st).find((c) => c.quest.index === chooseQuest!.index)?.waitingNumbers ?? []) : [];

  // The scene's started practice (a level practice or a replay), from PlayerState.practices; else a
  // new practice when its next level is due today, else a replay (XP only).
  const practice = statePractice ?? null;
  const levelNow = next?.state === 'now' && level < MAX_LEVEL;
  const replay = practice ? practice.replay : !levelNow;
  const mode = practice ? 'continue' : levelNow ? 'start' : 'replay';
  const toWin = Math.min(MAX_LEVEL, practice && !practice.replay ? practice.level : level + 1) as Level;
  const startButton = (
    <Button
      color={replay ? 'blue' : 'green'}
      size={tablet ? 'lg' : 'sm'}
      icon={practice ? 'play' : levelNow ? 'star' : 'loop'}
      loading={busy}
      onClick={() => void start({ kind: 'scene', sceneId: scene.id })}
      data-practice-start
      data-action={mode}
      data-replay={replay || undefined}
    >
      {practice ? t(practice.replay ? 'scene.watch.continueReplay' : 'scene.watch.continue', { n: practice.done, total: practice.total ?? '…' }) : levelNow ? t('scene.watch.start') : t('scene.watch.again')}
    </Button>
  );
  const worth = (
    <span className={cx(s.worth, !replay && s.worthLevel)} data-worth={replay ? 'replay' : 'level'} data-to-win={replay ? undefined : toWin}>
      {!replay ? (
        <>
          <Badge level={toWin} size={30} />
          {t('scene.watch.toWin', { level: t(`common.level.${toWin}` as TKey).toLowerCase() })}
        </>
      ) : (
        <>
          <Icon name="xp" size={22} />
          {t('scene.watch.replayOnly')}
        </>
      )}
    </span>
  );
  const levels = (
    <div className={s.levels}>
      <div className={s.ladder} aria-label={t('scene.watch.ladder', { level: t(`common.level.${level}` as TKey) })} data-testid="level-ladder">
        {([1, 2, 3, 4, 5, 6] as Level[]).map((m) => {
          const current = m === level + 1;
          const working = current && !!practice && !practice.replay;
          const fill = working && practice.total ? practice.done / practice.total : 0;
          return (
            <span key={m} className={cx(s.rung, m <= level && s.rungOn, current && !replay && s.rungNext, working && s.rungWorking)} data-rung={m}>
              <Badge level={m <= level || current ? m : 0} size={tablet ? (m === level ? 40 : 28) : m === level ? 30 : 22} />
              {working && (
                <span className={s.rungBar} aria-hidden>
                  <span style={{ width: `${Math.round(fill * 100)}%` }} />
                </span>
              )}
            </span>
          );
        })}
      </div>
      {next && replay && <span className={s.nextText} data-next-level={next.state === 'wait' ? next.days : next.state}>{nextLevelText(next)}</span>}
    </div>
  );
  const action = candidate ? (
    <Panel className={s.action} color="orange" tilt={-1} data-preview>
      <span className={s.previewTag}>{t('scene.watch.preview')}</span>
      <div className={s.actionButtons}>
        {chooseLocked ? (
          <span className={s.worth} data-choose-locked>
            <Icon name="lock" size={22} />
            {waitingText(waitingNumbers)}
          </span>
        ) : picksLeft > 0 ? (
          <Button color="green" size={tablet ? 'lg' : 'sm'} icon="unlock" loading={choosing} onClick={() => void choose()} data-choose>
            {t('scene.watch.choose')}
          </Button>
        ) : (
          <span className={s.worth}>{t('scene.watch.noPicks')}</span>
        )}
        <Button color="white" size={tablet ? 'lg' : 'sm'} icon="back" onClick={() => navigate('/unlock')} data-back-to-choice>
          {t('scene.watch.backToChoice')}
        </Button>
      </div>
    </Panel>
  ) : tablet ? (
    <Panel className={s.action} color="paper" tilt={-0.5}>
      <div className={s.actionMain}>
        {startButton}
        <span className={s.actionInfo}>
          {practice && <PracticeBar practice={practice} className={s.actionBar} />}
          {worth}
        </span>
      </div>
      {levels}
    </Panel>
  ) : (
    <PhoneAction button={startButton} worth={worth} progress={practice && <PracticeBar practice={practice} className={s.actionBar} />} levels={levels} />
  );

  return (
    <div className={cx(s.page, tablet && s.tablet, !mediaIn && s.gated)} data-scene-page={scene.id} data-candidate={candidate || undefined}>
      {header}
      <h1 className={s.title}>{scene.titleFr}</h1>

      {/* The player waits for the scene's audio and first frames (a progress bar while they come). */}
      <MediaGate key={`gate:${id}`} media={firstMoment(scene)} onHome={() => navigate('/')} onReady={() => setMediaInFor(scene.id)} className={s.player}>
        <ScenePlayer scene={scene} autoPlay loop onFullWatch={onFullWatch} showEnglish={english} className={s.player} />
      </MediaGate>

      <div className={s.tools}>
        <Button size="sm" color={english ? 'yellow' : 'white'} icon="help" onClick={() => setEnglish((v) => !v)} aria-pressed={english} data-english>
          {english ? t('scene.page.hideEnglish') : t('scene.page.showEnglish')}
        </Button>
      </div>

      {action}

      {freeNotes.length > 0 && (
        <div className={s.notes}>
          {freeNotes.map((n, i) => (
            <Panel key={i} color="yellow" padding="tight" tilt={i % 2 ? 1 : -1}>
              <b className={s.noteKind}>{t(n.kind === 'wordplay' ? 'scene.strip.wordplay' : 'scene.strip.reference')}</b> {n.text}
            </Panel>
          ))}
        </div>
      )}

      {!candidate && nb && (nb.prev || nb.next) && (
        <nav className={s.nav}>
          {nb.prev ? (
            <button type="button" className={s.navBtn} onClick={() => navigate(`/scene/${nb.prev!.id}`)} data-prev>
              <Icon name="back" size={26} />
              <img src={nb.prev.thumb} alt="" />
              <span>{nb.prev.titleFr}</span>
            </button>
          ) : (
            <span />
          )}
          {nb.next && (
            <button type="button" className={cx(s.navBtn, s.navNext)} onClick={() => navigate(`/scene/${nb.next!.id}`)} data-next-scene>
              <span>{nb.next.titleFr}</span>
              <img src={nb.next.thumb} alt="" />
              <Icon name="forward" size={26} />
            </button>
          )}
        </nav>
      )}
    </div>
  );
}

/**
 * The scene page's action on a phone: only the button stays in reach, as a one-row bar above the tab
 * bar, with "to win" beside it when both fit on that row; the progress, the ladder (and "to win" when it
 * does not fit) sit in the page under the bar, so the bar hides as little of the strip as it can.
 */
function PhoneAction({ button, worth, progress, levels }: { button: ReactNode; worth: ReactNode; progress: ReactNode; levels: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLSpanElement>(null);
  const [beside, setBeside] = useState(true);
  // Natural widths, the same wherever "to win" sits, so moving it never changes the answer.
  useLayoutEffect(() => {
    const check = () => {
      const r = row.current;
      const b = r?.querySelector<HTMLElement>('[data-practice-start]');
      if (r && b && tag.current) setBeside(b.offsetWidth + 12 + tag.current.offsetWidth <= r.clientWidth);
    };
    check();
    void document.fonts?.ready.then(check);
    if (typeof ResizeObserver === 'undefined' || !row.current) return;
    const ro = new ResizeObserver(check);
    ro.observe(row.current);
    return () => ro.disconnect();
  });
  const slot = (
    <span ref={tag} className={s.worthSlot}>
      {worth}
    </span>
  );
  return (
    <>
      <Panel className={s.action} color="paper" tilt={-0.5}>
        <div className={s.actionMain} ref={row}>
          {button}
          {beside && slot}
        </div>
      </Panel>
      <Panel className={s.details} color="paper" tilt={0.5} data-scene-details>
        {progress}
        {!beside && slot}
        {levels}
      </Panel>
    </>
  );
}
