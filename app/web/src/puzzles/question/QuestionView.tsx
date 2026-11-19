// The view of `question`: "le quiz du druide". The druid hosts a quiz show on a spotlit stage (the
// scene's frame faint behind him) and asks the question in a big speech balloon; its audio loops in
// the question's funny voice (question.audio with its voice preset), or, without audio, the related
// scene line loops. The answers are cards on a game-show board that flip in; every piece of their
// French is a GlossText box (tap: its English).
// Choose, then confirm (the user's design): tapping a card, or a box in it, chooses that answer (the
// card lifts with a halo) and plays its own clip once, then the question loops again; another tap on
// another card moves the choice and plays that one. The « C'EST ÇA ! » button under the board submits
// the chosen answer (a choice scrolls it into view on a phone); until one is chosen it asks to choose.
// Wrong: the druid looks baffled and says a friendly reaction in his balloon; the card deflates and
// stays flat, and the choice is cleared. After two wrong answers the right card glows. Right: the
// druid is delighted, BRAVO ! bursts at him (never over the answer), the other cards drop away, and
// his balloon shows the answer big with its English: at the top of the pane, so the continue bar
// never hides it. The choice lives in the view; the logic sees only the confirmed `pick`.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { QUESTION_REVEAL_AFTER, type QuestionAction, type QuestionState, type QuestionPuzzle } from '../../../../shared/puzzles/question';
import { t, type TKey } from '../../../../shared/i18n';
import { audio, useAudioState, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { closeGlosses, GlossText, wholeSentenceUnits } from '../../scene/GlossText';
import { frameAt } from '../../scene/Slideshow';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { SpeedLines, cx } from '../../ui';
import { LoopButton } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import s from './Question.module.css';
import { QuizDruid, type DruidMood } from './QuizDruid';

const REACTIONS: TKey[] = ['puzzles.question.react1', 'puzzles.question.react2', 'puzzles.question.react3', 'puzzles.question.react4', 'puzzles.question.react5'];
const CARD_COLORS = ['var(--orange)', 'var(--cyan)', 'var(--lime)', 'var(--purple)'];
const BAFFLED_MS = 1700;

export function QuestionView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<QuestionPuzzle, QuestionState, QuestionAction>) {
  const q = scene.questions.find((x) => x.id === puzzle.questionId)!;
  const line = puzzle.lineId ? findLine(scene, puzzle.lineId) : undefined;
  const qTag = `q:${q.id}`;
  const [silent, setSilent] = useState(!q.audio);
  const [mood, setMood] = useState<DruidMood>('neutral');
  const [reaction, setReaction] = useState<TKey | null>(null);
  const [popping, setPopping] = useState<number | null>(null);
  /** The answer chosen and not confirmed yet (index in q.answers as stored). */
  const [chosen, setChosen] = useState<number | null>(null);
  const cardRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const dockRef = useRef<HTMLDivElement>(null);
  const druidRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLOListElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const st = useAudioState();
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.picked !== null;
  const reveal = !done && state.wrong.length >= QUESTION_REVEAL_AFTER;
  useStopAudioOnUnmount();
  useEffect(() => () => timers.current.forEach((h) => window.clearTimeout(h)), []);
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));

  const loopLine = () => {
    if (!line) return;
    const w = lineWindow(line);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag: tags.line(line.id) });
  };
  const loopQuestion = () => {
    if (!q.audio || silent) {
      loopLine();
      return;
    }
    audio.play(q.audio, {
      voice: q.voice,
      loop: true,
      tag: qTag,
      quiet: true, // a clip that fails falls back to the line's audio, silently (the user's choice)
      onError: () => {
        setSilent(true);
        loopLine();
      },
    });
  };

  useEffect(() => {
    setChosen(null);
    loopQuestion();
    return () => closeGlosses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const playing = st.playing && (st.tag === qTag || (!!line && st.tag === tags.line(line.id)) || !!st.tag?.startsWith(`${qTag}:a`));

  /** An answer's own clip once (when it has one), then the question again. */
  const hear = (k: number) => {
    const a = q.answers[k]!;
    if (a.audio && !silent) audio.play(a.audio, { voice: q.voice, tag: `${qTag}:a${k}`, quiet: true, onEnd: loopQuestion, onError: loopQuestion });
  };

  /** Tapping a card or a box in it: choose that answer and hear it (again, when it was chosen already). */
  const choose = (k: number) => {
    if (done || state.wrong.includes(k)) return;
    if (chosen !== k) {
      fx.sfx('tap');
      const el = cardRefs.current[k];
      if (el) fx.pop(el);
    }
    setChosen(k);
    hear(k);
    // The confirm button may sit below the fold on a phone: bring it up, no further than needed.
    later(80, () => dockRef.current?.scrollIntoView({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' }));
  };

  /** « C'est ça ! »: submit the chosen answer. */
  const confirm = () => {
    if (chosen === null || done || state.wrong.includes(chosen)) return;
    const k = chosen;
    setChosen(null);
    pick(k, cardRefs.current[k] ?? null);
  };

  const pick = (k: number, card: HTMLElement | null) => {
    if (done || state.wrong.includes(k)) return;
    closeGlosses();
    const druid = druidRef.current;
    if (k === puzzle.correct) {
      hear(k);
      setMood('delighted');
      setReaction(null);
      // The answer now shows big in the druid's balloon: bring the stage into view, not the button.
      (document.activeElement as HTMLElement | null)?.blur?.();
      later(140, () => stageRef.current?.scrollIntoView({ block: 'start', behavior: fx.reducedMotion() ? 'auto' : 'smooth' }));
      if (card) fx.right(card);
      // BRAVO over the board (the other cards are dropping away), never over the answer in the balloon.
      later(160, () => {
        fx.impact(t('practice.fx.bravo'), boardRef.current ?? undefined, { size: 'md' });
        fx.sfx('win');
      });
      if (druid) later(240, () => fx.burst(druid, 'star'));
    } else {
      const r = REACTIONS[(state.wrong.length * 2 + k) % REACTIONS.length]!;
      setMood('baffled');
      setReaction(r);
      setPopping(k);
      if (card) fx.wrong(card);
      fx.sfx('pop');
      later(BAFFLED_MS, () => {
        setMood((m) => (m === 'baffled' ? 'neutral' : m));
        setReaction((x) => (x === r ? null : x));
      });
      later(600, () => setPopping((p) => (p === k ? null : p)));
    }
    dispatch({ kind: 'pick', answer: k });
  };

  const qUnits = q.units?.length ? q.units : wholeSentenceUnits(q.fr, q.en);
  const picked = state.picked !== null ? q.answers[state.picked]! : null;
  const backdrop = line ? frameAt(scene.frames, lineWindow(line).startMs + 200)?.src : scene.thumb;

  return (
    <div className={cx(s.puzzle, tablet && s.tablet, done && s.over)} data-question data-step={done ? 'done' : chosen === null ? 'choose' : 'chosen'}>
      <div ref={stageRef} className={s.stage} data-stage>
        {backdrop && <img className={s.backdrop} src={backdrop} alt="" draggable={false} />}
        <SpeedLines className={s.rays} density="sparse" x="18%" y="100%" color="rgb(255 255 255 / 0.28)" />
        <span className={s.showName}>{t('puzzles.question.show')}</span>
        <div ref={druidRef} className={s.host}>
          <QuizDruid mood={mood} talking={playing && !done} />
        </div>
        <div className={cx(s.balloon, reaction && s.balloonReact, picked && s.balloonWin)} data-q aria-live="polite">
          {picked ? (
            <div className={s.winner} data-winner>
              <GlossText fr={picked.fr} units={picked.units?.length ? picked.units : wholeSentenceUnits(picked.fr, picked.en)} size={tablet ? 'lg' : 'md'} />
              <p className={s.winnerEn} lang="en">
                {picked.en}
              </p>
            </div>
          ) : reaction ? (
            <p className={s.reaction} key={reaction + state.wrong.length}>
              {t(reaction)}
            </p>
          ) : (
            <>
              <GlossText fr={q.fr} units={qUnits} size={tablet ? 'md' : 'sm'} />
              {silent && <p className={s.silent} data-silent>{t('puzzles.question.silent')}</p>}
            </>
          )}
        </div>
        {!picked && (
          <LoopButton className={s.loop} looping={playing} onToggle={() => (playing ? audio.stop() : loopQuestion())} label={playing ? t('puzzles.question.stop') : t('puzzles.question.listen')} />
        )}
      </div>

      <ol ref={boardRef} className={cx(s.board, puzzle.order.length === 3 && s.board3)} role="radiogroup" aria-label={t('puzzles.question.choose')}>
        {puzzle.order.map((k, row) => {
          const a = q.answers[k]!;
          const wrong = state.wrong.includes(k);
          const right = done && state.picked === k;
          const isChosen = !done && chosen === k;
          return (
            <li
              key={k}
              ref={(el) => {
                cardRefs.current[k] = el;
              }}
              data-answer={k}
              className={cx(s.card, wrong && s.flat, popping === k && s.deflate, right && s.won, done && !right && s.gone, reveal && k === puzzle.correct && s.glow, isChosen && s.chosen)}
              style={{ '--i': row, '--card': CARD_COLORS[row % CARD_COLORS.length] } as CSSProperties}
              role="radio"
              aria-checked={isChosen}
              aria-disabled={wrong || done || undefined}
              tabIndex={wrong || done ? -1 : 0}
              onClick={() => choose(k)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  choose(k);
                }
              }}
              data-card={k}
              data-chosen={isChosen || undefined}
              data-correct={import.meta.env.DEV ? String(k === puzzle.correct) : undefined}
            >
              <span className={s.bulbs} aria-hidden />
              <span className={s.letter}>{String.fromCharCode(65 + row)}</span>
              <div className={s.cardText}>
                <GlossText fr={a.fr} units={a.units?.length ? a.units : wholeSentenceUnits(a.fr, a.en)} size="sm" tone="paper" disabled={wrong} onUnitTap={() => choose(k)} />
              </div>
              {wrong && (
                <span className={s.nope} aria-hidden>
                  {t('puzzles.question.nope')}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {!done && (
        <div ref={dockRef} className={s.dock}>
          <button type="button" className={cx(s.confirm, chosen !== null && s.confirmReady)} disabled={chosen === null} onClick={confirm} data-confirm>
            {chosen === null ? t('puzzles.question.choose') : t('puzzles.question.pick')}
          </button>
        </div>
      )}
    </div>
  );
}
