// Runs a composed Practice: each puzzle through the puzzle type registry (init, View, dispatch -> reduce,
// isDone), with the chrome around it, the help strip, a reward beat between puzzles and the results at
// the end. One run from puzzle `startAt` to the last, no breaks; the kid can leave after any puzzle
// (everything finished is saved) and continues later at the next unfinished one.
// PracticePlayer (the route) and /dev/practice both render it.
//
// Where am I (docs/app-games.md, "The practice screen"): the header names the scene and the level the
// practice is for (or that it is a replay); the track under it is the progress bar, "Puzzle n of N"
// and how many are left.
//
// Save, then continue (docs/app-games.md, "The practice screen"): when a puzzle is done its save is
// sent once (the completion, for the last one); the kid moves on only once it is saved. A failed save
// shows the error panel over the continue bar, and « Réessayer » sends it again and moves on. An answer
// practice-closed (finished elsewhere, or the answer to an earlier try got lost) refreshes the state
// and shows the results as already saved. A crash inside a puzzle view is caught around the puzzle.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import type { PracticeCompleteResponse } from '../../../shared/api';
import type { Scene } from '../../../shared/content';
import { t, type TKey } from '../../../shared/i18n';
import { createRng, type Rng } from '../../../shared/practice/rng';
import type { Practice, PuzzleBase, PuzzleOutcome } from '../../../shared/practice/types';
import { audio } from '../audio';
import { MuteButton } from '../audio/MuteButton';
import { flushEvents } from '../audio/events';
import { fx } from '../fx';
import { getPuzzleEntry, type PuzzleEntry, type PracticeCtx } from '../puzzles/registry';
import { Slideshow } from '../scene/Slideshow';
import { ApiRequestError } from '../api';
import { clearPuzzleWhere, log, setPuzzleWhere, type PuzzleWhere } from '../log';
import { ReportButton, ReportTip } from '../report';
import { recover, refreshState } from '../state/recover';
import { Button, ErrorBoundary, ErrorPanel, IconButton, Modal, Spinner, cx, toast, useLayout } from '../ui';
import { HelpStrip } from './HelpStrip';
import { LevelTag } from './LevelTag';
import s from './Practice.module.css';
import { Results } from './Results';
import type { PracticeProgress } from './storage';

/** What the runner reports after every finished puzzle (the caller saves it: server or local). */
export interface PuzzleProgress {
  done: number; // puzzles finished so far
  total: number;
  outcomes: PuzzleOutcome[]; // all so far
  outcome: PuzzleOutcome; // the one just finished
}

export interface PracticeRunnerProps {
  practice: Practice;
  scenes: ReadonlyMap<string, Scene>;
  speak: boolean;
  /** The kid flipped the "can't talk right now" switch (the caller saves the setting). */
  onSpeakChange?: (speak: boolean) => void;
  startAt?: PracticeProgress | null;
  onProgress?: (p: PracticeProgress) => void;
  /**
   * After every finished puzzle but the last: save the progress. The kid moves on only once the
   * promise resolves; a rejection shows the error panel with « Réessayer », which calls it again.
   * Omitted, or returning nothing: nothing to wait for (the /dev pages).
   */
  onPuzzleDone?: (p: PuzzleProgress) => Promise<unknown> | void;
  /** The level the practice is for (1 bronze ... 6 plutonium); default: its entry's level. */
  level?: number;
  /** A replay (the scene's next level is not due): XP only. Default: its entry is not due. */
  replay?: boolean;
  /** The last puzzle is done: send the outcomes, once per try. The results show once it resolves. */
  complete: (outcomes: PuzzleOutcome[], ms: number) => Promise<PracticeCompleteResponse>;
  /** The kid chose « Je continue plus tard »; the finished puzzles are saved, the practice continues later. */
  onExit: (done: number) => void;
  /** The kid tapped "continue" on the results (null: the practice had already been saved elsewhere). */
  onFinish: (res: PracticeCompleteResponse | null) => void;
  dev?: boolean;
}

interface Done {
  mistakes: number;
  missed: string[];
}

/** A finished puzzle waiting for its save (or the practice for its completion). */
interface Pending {
  puzzleId: string;
  index: number; // the puzzle's index (puzzles.length: completing a practice opened with every puzzle done)
  outcome: PuzzleOutcome | null;
  outcomes: PuzzleOutcome[];
  last: boolean;
}

type SaveState = { status: 'saving' } | { status: 'saved' } | { status: 'failed'; error: unknown };

const isClosed = (e: unknown) => e instanceof ApiRequestError && e.code === 'practice-closed';

export function PracticeRunner({ practice, scenes, speak, onSpeakChange, startAt, onProgress, onPuzzleDone, level, replay, complete, onExit, onFinish, dev }: PracticeRunnerProps) {
  const layout = useLayout();
  // The app is about listening: a gentle, non-blocking reminder when a practice opens muted.
  useEffect(() => {
    if (audio.isMuted()) toast(t('practice.mutedReminder'), { color: 'yellow', icon: 'mute' });
  }, []);
  const puzzles = practice.puzzles;
  const [index, setIndex] = useState(() => Math.min(startAt?.puzzleIndex ?? 0, puzzles.length));
  const [outcomes, setOutcomes] = useState<PuzzleOutcome[]>(() => startAt?.outcomes ?? []);
  const [done, setDone] = useState<Done | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(false);
  const [confirmExit, setConfirmExit] = useState(false);
  // The server's answer to the completion; 'closed' when the practice had been saved already.
  const [result, setResult] = useState<PracticeCompleteResponse | 'closed' | null>(null);
  const [save, setSave] = useState<SaveState | null>(null);
  const pending = useRef<Pending | null>(null);
  const wantNext = useRef(false); // the kid asked to move on while the save was under way
  const [waiting, setWaiting] = useState(false);
  const sendId = useRef(0);
  const completed = useRef(false);
  const [attempt, setAttempt] = useState(0); // remounts a puzzle view after a crash
  const hints = useRef(0);
  const puzzleStart = useRef(performance.now());
  const msBefore = useRef(startAt?.ms ?? 0);
  const practiceStart = useRef(performance.now());
  const perfectRun = useRef(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const levelOf = level ?? practice.entries[0]?.level ?? 1;
  const isReplay = replay ?? practice.entries[0]?.due === false;
  const indexRef = useRef(index);
  indexRef.current = index;
  const outcomesRef = useRef(outcomes);
  outcomesRef.current = outcomes;

  // When the kid cannot speak, a microphone round is replaced by its tapping equivalent on the same
  // French (puzzle.alt, from the composer: shared/practice/replace.ts). Its outcome is the one reported.
  const planned: PuzzleBase | undefined = puzzles[index];
  const puzzle: PuzzleBase | undefined = planned && !speak && planned.alt && getPuzzleEntry(planned.type)?.logic.meta.needsMic ? planned.alt : planned;
  const entry: PuzzleEntry | undefined = puzzle ? getPuzzleEntry(puzzle.type) : undefined;
  const scene = puzzle ? scenes.get(puzzle.sceneId) : undefined;
  const finished = index >= puzzles.length;
  const elapsed = () => msBefore.current + (performance.now() - practiceStart.current);

  // Reset per puzzle: help open by default when the puzzle type shows the French, hints, the clock.
  useEffect(() => {
    setDone(null);
    hints.current = 0;
    puzzleStart.current = performance.now();
    setHelpOpen(entry?.help === 'open');
    helpOpenRef.current = entry?.help === 'open';
  }, [index, puzzle?.id, entry?.help]);

  useEffect(() => {
    onProgress?.({ puzzleIndex: index, outcomes, ms: elapsed() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // The activity log: each puzzle shown, and the results.
  useEffect(() => {
    if (puzzle) log('puzzle-show', { practiceId: practice.id, index, puzzleId: puzzle.id, type: puzzle.type });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice.id, index, puzzle?.id]);
  useEffect(() => {
    if (finished && result !== null) log('practice-results', { practiceId: practice.id, puzzles: puzzles.length, ms: Math.round(elapsed()), alreadySaved: result === 'closed' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, result !== null]);

  const outcomeOf = useCallback(
    (t0: PuzzleBase, d: Done | null, skipped: boolean): PuzzleOutcome => ({
      puzzleId: t0.id,
      type: t0.type,
      sceneId: t0.sceneId,
      unitIds: t0.unitIds,
      missedUnitIds: d?.missed ?? [],
      mistakes: d?.mistakes ?? 0,
      hints: hints.current,
      skipped,
      ms: Math.round(performance.now() - puzzleStart.current),
      ...(t0.questionId ? { questionId: t0.questionId } : {}),
    }),
    [],
  );

  /** Move on from the saved puzzle: the next one, or the results. */
  const move = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    wantNext.current = false;
    setWaiting(false);
    setSave(null);
    const next = p.index + 1;
    indexRef.current = next;
    setIndex(next);
    if (p.last) return;
    // The progress bar fills: sparkle at its end.
    requestAnimationFrame(() => {
      const cell = progressRef.current?.querySelector('[data-fill-end]');
      if (cell) fx.burst(cell, { kind: 'star', count: 6, colors: ['#FFD21F', '#FFFFFF'] });
    });
  }, [puzzles.length]);

  /** Send the pending save once; resolved, it moves on if the kid asked to. */
  const sendPending = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    const id = ++sendId.current;
    setSave({ status: 'saving' });
    const work = p.last
      ? complete(p.outcomes, Math.round(elapsed()))
      : onPuzzleDone?.({ done: p.index + 1, total: puzzles.length, outcomes: p.outcomes, outcome: p.outcome! });
    Promise.resolve(work).then(
      (r) => {
        if (id !== sendId.current) return;
        if (p.last) {
          completed.current = true;
          setResult((r as PracticeCompleteResponse | undefined) ?? 'closed');
        }
        setSave({ status: 'saved' });
        if (wantNext.current) move();
      },
      (e: unknown) => {
        if (id !== sendId.current) return;
        if (isClosed(e)) {
          // Finished elsewhere, or the answer to an earlier try got lost: it is saved; show it so.
          void refreshState();
          completed.current = true;
          pending.current = { ...p, last: true, index: puzzles.length - 1 };
          setResult('closed');
          move();
          return;
        }
        recover(e);
        setSave({ status: 'failed', error: e });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, onPuzzleDone, puzzles.length, move]);

  /** A puzzle is done: record its outcome and send its save (the completion after the last one). */
  const finishPuzzle = useCallback(
    (o: PuzzleOutcome, goOn: boolean) => {
      const i = indexRef.current;
      if (pending.current?.puzzleId === o.puzzleId) return;
      const all = [...outcomesRef.current.filter((p) => p.puzzleId !== o.puzzleId), o];
      outcomesRef.current = all;
      setOutcomes(all);
      log('puzzle-done', { practiceId: practice.id, index: i, puzzleId: o.puzzleId, type: o.type, mistakes: o.mistakes, hints: o.hints, ms: o.ms, skipped: o.skipped });
      void flushEvents();
      const last = i === puzzles.length - 1;
      pending.current = { puzzleId: o.puzzleId, index: i, outcome: o, outcomes: all, last };
      wantNext.current = goOn;
      setWaiting(goOn);
      sendPending();
    },
    [puzzles.length, sendPending, practice.id],
  );

  /** « Continuer »: on at once when saved, else as soon as the save is through. */
  const goOn = useCallback(() => {
    if (!pending.current) return;
    if (save?.status === 'saved') return move();
    wantNext.current = true;
    setWaiting(true);
    if (save?.status === 'failed') sendPending();
  }, [save, move, sendPending]);

  // A puzzle type needing the mic while the kid cannot talk and no replacement (an old practice): skip it (no penalty).
  const missingView = !!puzzle && !entry;
  const skipMic = !!puzzle && !!entry && entry.logic.meta.needsMic && !speak;
  useEffect(() => {
    if (puzzle && (skipMic || missingView)) {
      if (missingView) console.warn(`[practice] no view registered for puzzle type "${puzzle.type}"; skipping`);
      finishPuzzle(outcomeOf(puzzle, null, true), true);
    }
  }, [puzzle, skipMic, missingView, finishPuzzle, outcomeOf]);

  // Timers of the done moment (scroll into view, the combo effect): cleared when the screen goes away,
  // so none fires after unmount (in a test, after the page is torn down).
  const doneTimers = useRef<number[]>([]);
  useEffect(() => () => doneTimers.current.forEach((h) => window.clearTimeout(h)), []);

  const onViewDone = useCallback((d: Done, shown: PuzzleBase) => {
    setDone(d);
    // The save goes now, while the continue bar slams in; « Continuer » waits for it if needed.
    finishPuzzle(outcomeOf(shown, d, false), false);
    // The continue bar takes room at the bottom: keep what the kid just tapped in view.
    doneTimers.current.push(window.setTimeout(() => {
      const pane = document.querySelector('[data-puzzle-pane]');
      const active = document.activeElement;
      const el = pane?.querySelector('[aria-pressed="true"]') ?? (active instanceof HTMLElement && pane?.contains(active) ? active : null);
      if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' });
    }, 80));
    if (d.mistakes === 0 && hints.current === 0) perfectRun.current++;
    else perfectRun.current = 0;
    audio.sfx('whoosh');
    if (perfectRun.current >= 2) doneTimers.current.push(window.setTimeout(() => fx.combo(perfectRun.current), 250));
  }, [finishPuzzle, outcomeOf]);

  // practiceCtx.next: a puzzle that moves on by itself, like « Continuer ».
  const next = useCallback(() => {
    if (!puzzle) return;
    if (!pending.current) finishPuzzle(outcomeOf(puzzle, done, false), true);
    else goOn();
  }, [puzzle, done, finishPuzzle, goOn, outcomeOf]);

  // Opened with every puzzle done (the completion's answer was lost on an earlier visit): complete now.
  useEffect(() => {
    if (finished && !completed.current && !pending.current) {
      audio.stop();
      pending.current = { puzzleId: '', index: puzzles.length - 1, outcome: null, outcomes: outcomesRef.current, last: true };
      wantNext.current = true;
      setWaiting(true);
      sendPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // practiceCtx.hint: a puzzle type counts a hint explicitly.
  const hint = useCallback(() => {
    hints.current++;
  }, []);
  // Taps inside the help strip count only when the strip starts closed (the puzzle type hides the French).
  const stripHint = useCallback(() => {
    if (entry?.help === 'closed') hints.current++;
  }, [entry?.help]);
  const openHelp = useCallback(() => {
    // Not inside a state updater: StrictMode runs updaters twice.
    if (!helpOpenRef.current && entry?.help === 'closed') hints.current++;
    helpOpenRef.current = true;
    setHelpOpen(true);
  }, [entry?.help]);

  const ctx: PracticeCtx = useMemo(
    () => ({ practiceId: practice.id, puzzleIndex: index, puzzleCount: puzzles.length, layout, speak, openHelp, hint, next, dev, setSpeak: onSpeakChange }),
    [practice.id, index, puzzles.length, layout, speak, openHelp, hint, next, dev, onSpeakChange],
  );

  const micAhead = useMemo(() => puzzles.slice(index).some((x) => getPuzzleEntry(x.type)?.logic.meta.needsMic), [puzzles, index]);

  if (finished && result !== null) {
    const res = result === 'closed' ? null : result;
    return (
      <div className={cx(s.practice, s.resultsPage)}>
        <Results scenes={scenes} outcomes={outcomes} result={res} level={res?.level ?? levelOf} replay={res?.replay ?? isReplay} alreadySaved={result === 'closed'} onContinue={() => onFinish(res)} dev={dev} />
      </div>
    );
  }
  if (finished) {
    // Completing a practice that was opened with every puzzle done.
    return (
      <div className={cx(s.practice, s.resultsPage)} data-practice-finishing>
        {save?.status === 'failed' ? (
          <ErrorPanel error={save.error} onRetry={goOn} secondary={<Button color="white" icon="home" onClick={() => onExit(index)}>{t('nav.home')}</Button>} />
        ) : (
          <div className={s.sending}>
            <Spinner size="sm" /> {t('practice.result.sending')}
          </div>
        )}
      </div>
    );
  }
  const saveFailed = save?.status === 'failed' ? save : null;
  const failBar = saveFailed && (
    <div className={cx(s.continue, s.saveFailed)} data-save-failed>
      <ErrorPanel variant="bar" error={saveFailed.error} onRetry={goOn} />
    </div>
  );
  if (!puzzle || !entry || !scene || skipMic) return <div className={s.practice}>{failBar}</div>;

  const help = entry.help;
  const View = entry.View;
  const tablet = layout === 'tablet';
  const titleKey = `puzzles.${puzzle.type}.title` as TKey;

  return (
    <div className={cx(s.practice, tablet ? s.tabletLayout : s.phoneLayout)} data-practice={practice.id} data-puzzle={puzzle.id} data-puzzle-type={puzzle.type}>
      <header className={s.top}>
        <IconButton icon="close" label={t('practice.close')} size="sm" onClick={() => setConfirmExit(true)} data-practice-close />
        <div className={s.where} data-where>
          {tablet && <img src={scene.thumb} alt="" className={s.thumb} />}
          <div className={s.whereText}>
            <LevelTag level={levelOf} replay={isReplay} />
            <span className={s.sceneTitle}>{scene.titleFr}</span>
          </div>
        </div>
        {/* The microphone switch: while speaking rounds lie ahead, and whenever speaking is off (to turn it back on). */}
        {(micAhead || !speak) && onSpeakChange && (
          <IconButton
            icon="mic"
            label={speak ? t('puzzles.speak.cantTalk') : t('profile.speakYes')}
            color={speak ? 'white' : 'tomato'}
            size="sm"
            onClick={() => {
              if (speak) log('cant-speak', { from: 'header', type: puzzle.type });
              onSpeakChange?.(!speak);
            }}
            data-speak-toggle
          />
        )}
        <MuteButton />
        <ReportButton variant="icon" />
      </header>
      {!dev && <ReportTip where="header" />}
      <ProgressTrack ref={progressRef} total={puzzles.length} index={index} done={!!done} />

      <main className={cx(s.body, tablet && help !== 'none' && s.twoPanes)}>
        {tablet && help !== 'none' && (
          <aside className={s.scenePane}>
            <Slideshow frames={scene.frames} audioSrc={scene.audio.src} restMs={firstLineStart(scene, puzzle)} alt={scene.titleFr} />
            <HelpStrip variant="pane" scene={scene} lineIds={puzzle.helpLineIds} open={helpOpen} onOpen={openHelp} onClose={() => { helpOpenRef.current = false; setHelpOpen(false); }} onHint={stripHint} />
          </aside>
        )}
        {/* Keyed by the puzzle: the next puzzle starts scrolled to the top. */}
        <div key={puzzle.id} className={s.puzzleCol}>
          <section className={s.puzzlePane} data-puzzle-pane>
            <span className={s.puzzleTitle} data-puzzle-title>{t(titleKey)}</span>
            <div className={s.paneBody}>
              <ErrorBoundary
                resetKey={`${puzzle.id}:${attempt}`}
                where={`/practice/${practice.id} ${puzzle.id}`}
                fallback={(e) => (
                  <ErrorPanel
                    error={e}
                    where={`/practice/${practice.id} ${puzzle.id}`}
                    message={t('common.fail.puzzle')}
                    onRetry={() => setAttempt((n) => n + 1)}
                    secondary={
                      <Button color="white" icon="home" onClick={() => { audio.stop(); onExit(index); }} data-error-home>
                        {t('nav.home')}
                      </Button>
                    }
                  />
                )}
              >
                <PuzzleHost key={`${puzzle.id}:${attempt}`} entry={entry} puzzle={puzzle} scene={scene} ctx={ctx} onDone={onViewDone} />
              </ErrorBoundary>
            </div>
          </section>
        </div>
      </main>

      {!tablet && help !== 'none' && (
        <HelpStrip variant="drawer" scene={scene} lineIds={puzzle.helpLineIds} open={helpOpen} onOpen={openHelp} onClose={() => { helpOpenRef.current = false; setHelpOpen(false); }} onHint={stripHint} />
      )}

      {failBar ?? (done && <ContinueBar mistakes={done.mistakes} onContinue={goOn} busy={waiting && save?.status === 'saving'} last={index === puzzles.length - 1} />)}

      <Modal open={confirmExit} onClose={() => setConfirmExit(false)} title={t('practice.exit.title')}>
        <div className={s.exit}>
          <p>{t('practice.exit.textSaved')}</p>
          <Button color="lime" size="lg" block onClick={() => setConfirmExit(false)} data-exit-stay>
            {t('practice.exit.stay')}
          </Button>
          <Button color="white" block onClick={() => { audio.stop(); onExit(index); }} data-exit-leave>
            {t('practice.exit.leave')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function firstLineStart(scene: Scene, puzzle: PuzzleBase): number {
  const l = scene.lines.find((x) => x.id === puzzle.helpLineIds[0]);
  return l ? l.startMs + 200 : 0;
}

/** One puzzle: holds the puzzle's state, feeds dispatch through the logic's reduce, reports when done. */
function PuzzleHost({ entry, puzzle, scene, ctx, onDone }: { entry: PuzzleEntry; puzzle: PuzzleBase; scene: Scene; ctx: PracticeCtx; onDone: (d: Done, puzzle: PuzzleBase) => void }) {
  const { logic, View } = entry;
  const [state, setState] = useState(() => logic.init(puzzle));
  const dispatch = useCallback((action: unknown) => setState((st: unknown) => logic.reduce(puzzle, st, action)), [logic, puzzle]);
  const reported = useRef(false);
  const isDone = logic.isDone(puzzle, state);
  // Stop the French when the puzzle goes away (before the next puzzle's view starts its own loop).
  useEffect(() => () => audio.stop(), []);
  // Which puzzle is on screen, with its state, for a "Quelque chose ne va pas ?" report and the speech log.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const w: PuzzleWhere = { practiceId: ctx.practiceId, index: ctx.puzzleIndex, count: ctx.puzzleCount, puzzleId: puzzle.id, type: puzzle.type, speak: ctx.speak, state: () => stateRef.current };
    setPuzzleWhere(w);
    return () => clearPuzzleWhere(w);
  }, [ctx.practiceId, ctx.puzzleIndex, ctx.puzzleCount, ctx.speak, puzzle.id, puzzle.type]);
  // Dev builds only: the running puzzle for end-to-end tests, which read the next right move from the
  // puzzle type's own solve (and a wrong one from its wrongAction) and then tap what a kid would tap.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hooks = logic as PuzzleEntry['logic'] & { wrongAction?: (t: PuzzleBase, s: unknown, r: Rng) => unknown };
    let n = 0;
    (window as unknown as { __frxPractice?: unknown }).__frxPractice = {
      puzzleId: puzzle.id,
      type: puzzle.type,
      puzzle,
      state,
      done: isDone,
      mistakes: logic.mistakes(puzzle, state),
      solve: () => (isDone ? null : logic.solve(puzzle, state)),
      wrong: () => (isDone || !hooks.wrongAction ? null : hooks.wrongAction(puzzle, state, createRng(++n).fork('e2e'))),
    };
  }, [logic, puzzle, state, isDone]);
  useEffect(() => {
    if (isDone && !reported.current) {
      reported.current = true;
      onDone({ mistakes: logic.mistakes(puzzle, state), missed: logic.missedUnitIds(puzzle, state) }, puzzle);
    }
  }, [isDone, logic, puzzle, state, onDone]);
  return <View puzzle={puzzle} state={state} dispatch={dispatch} scene={scene} practiceCtx={ctx} />;
}

/**
 * Where the kid is in the practice: a progress bar that fills as puzzles are done (a tick every five
 * puzzles, the current puzzle's slot blinking), "Puzzle n of N" on it, and how many are left beside it.
 * aria-valuenow is the number of finished puzzles (the e2e specs read it as the saved position).
 */
const ProgressTrack = ({ total, index, done, ref }: { total: number; index: number; done: boolean; ref: Ref<HTMLDivElement> }) => {
  const filled = Math.min(total, index + (done ? 1 : 0));
  const left = total - filled;
  const pct = (n: number) => `${(100 * n) / Math.max(1, total)}%`;
  const n = Math.min(index + 1, total);
  return (
    <div className={s.track} data-track>
      <div
        ref={ref}
        className={s.bar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={filled}
        aria-valuetext={t('practice.progress', { n, total })}
        style={{ '--total': Math.max(1, total) } as CSSProperties}
        data-progress={`${filled}/${total}`}
      >
        <span className={cx(s.barFill, filled > 0 && filled < total && s.barFillEdge)} style={{ width: pct(filled) }}>
          <span className={s.fillEnd} data-fill-end />
        </span>
        {!done && filled < total && <span className={s.barNow} style={{ left: pct(filled), width: pct(1) }} />}
        <span className={s.barLabel}>{t('practice.progress', { n, total })}</span>
      </div>
      <span className={cx(s.left, left <= 1 && s.leftLast)} data-left={left}>
        {left === 0 ? t('practice.where.done') : left === 1 ? t('practice.where.last') : t('practice.where.left', { n: left })}
      </span>
    </div>
  );
};

/** The reward beat after a puzzle: a bar slams up with a cheer; continue goes on. */
function ContinueBar({ mistakes, onContinue, last, busy }: { mistakes: number; onContinue: () => void; last: boolean; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const word = useMemo(() => fx.cheer(mistakes), [mistakes]);
  useEffect(() => {
    const el = ref.current?.querySelector('[data-cheer]');
    if (el && mistakes === 0) fx.burst(el, { kind: 'star', count: 8, colors: ['#FFD21F', '#FFFFFF'] });
  }, [mistakes]);
  return (
    <div ref={ref} className={cx(s.continue, mistakes === 0 ? s.continuePerfect : s.continueOk)} data-continue>
      <span className={s.cheer} data-cheer>
        {word}
      </span>
      <Button color={mistakes === 0 ? 'yellow' : 'white'} size="lg" iconRight="forward" onClick={onContinue} loading={busy} data-next autoFocus>
        {last ? t('practice.finish') : t('common.continue')}
      </Button>
    </div>
  );
}
