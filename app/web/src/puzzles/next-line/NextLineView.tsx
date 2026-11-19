// The view of `next-line` ("What comes next?"): a line of the scene loops in a comic panel with its
// picture; three lines wait as cards below, each with a speaker that plays it; the kid taps the card
// that follows. A right pick slams the two panels together and plays them back to back (the
// conversation, or the verse, going on), then the next round slides in. A wrong card wobbles and
// greys out; after two wrong cards the right one glows. The logic moves on at once; the view lags a
// round behind while the pair plays (presentation only).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Line } from '../../../../shared/content';
import { displayEn } from '../../../../shared/puzzles/listen-pick';
import { NEXT_LINE_REVEAL_AFTER, type NextLineAction, type NextLineState, type NextLinePuzzle } from '../../../../shared/puzzles/next-line';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { frameAt } from '../../scene/Slideshow';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { Icon, Stamp, cx } from '../../ui';
import { LoopButton } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import s from './NextLine.module.css';

const JOIN_MS = 1700;

function Speaker({ line, onPlay }: { line: Line; onPlay: () => void }) {
  const on = useIsPlaying(tags.line(line.id));
  return (
    <button type="button" className={cx(s.spk, on && s.spkOn)} onClick={() => (on ? audio.stop() : onPlay())} aria-label={t('puzzles.next-line.hear')} data-hear={line.id}>
      <Icon name={on ? 'speaker' : 'play'} size={24} />
    </button>
  );
}

export function NextLineView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<NextLinePuzzle, NextLineState, NextLineAction>) {
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.round >= puzzle.rounds.length;
  const [shown, setShown] = useState(0);
  const [joined, setJoined] = useState(false);
  const timer = useRef(0);
  useStopAudioOnUnmount();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const ri = Math.min(shown, puzzle.rounds.length - 1);
  const round = puzzle.rounds[ri]!;
  const prompt = findLine(scene, round.promptId)!;
  const answer = findLine(scene, round.answerId)!;
  const promptTag = tags.line(prompt.id);
  const promptOn = useIsPlaying(promptTag);
  const wrongHere = state.wrong[ri] ?? [];
  const reveal = !joined && !done && shown === state.round && wrongHere.length >= NEXT_LINE_REVEAL_AFTER;

  const playLine = (l: Line) => {
    const w = lineWindow(l);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag: tags.line(l.id) });
  };
  useEffect(() => {
    playLine(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id, ri]);

  // Catch up if the logic ran ahead without the animation.
  useEffect(() => {
    if (!joined && shown < state.round && shown < puzzle.rounds.length - 1) setShown(state.round);
  }, [joined, shown, state.round, puzzle.rounds.length]);

  const pick = (id: string, el: HTMLElement) => {
    if (done || joined || shown !== state.round || wrongHere.includes(id)) return;
    if (id === round.answerId) {
      setJoined(true);
      fx.right(el);
      const a = lineWindow(prompt);
      const b = lineWindow(answer);
      audio.playRange(scene.audio.src, a.startMs, b.endMs, { loop: state.round + 1 >= puzzle.rounds.length, tag: `next:${puzzle.id}` });
      const last = state.round + 1 >= puzzle.rounds.length;
      if (last) window.setTimeout(() => fx.impact(undefined, undefined, { size: 'lg' }), 450);
      timer.current = window.setTimeout(() => {
        if (last) return; // the pair keeps looping under the shell's continue bar
        setJoined(false);
        setShown((x) => x + 1);
      }, Math.max(JOIN_MS, b.endMs - a.startMs + 400));
    } else {
      fx.wrong(el);
    }
    dispatch({ kind: 'pick', lineId: id });
  };

  const frame = (l: Line) => frameAt(scene.frames, lineWindow(l).startMs + 250)?.src;

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)}>
      <div className={s.top}>
        <Stamp variant="issue" color="yellow" tilt={-5}>
          {t('puzzles.next-line.round', { n: ri + 1, total: puzzle.rounds.length })}
        </Stamp>
        <p className={s.prompt}>{t(joined ? 'puzzles.next-line.together' : 'puzzles.next-line.prompt')}</p>
      </div>

      <div className={cx(s.pair, joined && s.joined)} key={ri}>
        <div className={s.panel} data-prompt={prompt.id}>
          {frame(prompt) && <img className={s.img} src={frame(prompt)} alt="" draggable={false} />}
          <div className={s.caption}>
            <span className={s.fr}>{displayEn(prompt.fr)}</span>
            <span className={s.en}>{displayEn(prompt.en)}</span>
          </div>
          {!joined && (
            <div className={s.loop}>
              <LoopButton looping={promptOn} onToggle={() => (promptOn ? audio.stop() : playLine(prompt))} label={promptOn ? t('puzzles.next-line.stop') : t('puzzles.next-line.listen')} />
            </div>
          )}
        </div>
        <div className={s.arrow} aria-hidden>
          {joined ? '!' : '?'}
        </div>
        {joined ? (
          <div className={cx(s.panel, s.answerPanel)} data-answer-panel>
            {frame(answer) && <img className={s.img} src={frame(answer)} alt="" draggable={false} />}
            <div className={s.caption}>
              <span className={s.fr}>{displayEn(answer.fr)}</span>
              <span className={s.en}>{displayEn(answer.en)}</span>
            </div>
          </div>
        ) : (
          <div className={cx(s.panel, s.blank)} aria-hidden>
            <span className={s.q}>?</span>
          </div>
        )}
      </div>

      {!joined && !done && (
        <ul className={s.choices} key={`c${ri}`}>
          {round.choices.map((id, i) => {
            const l = findLine(scene, id)!;
            const wrong = wrongHere.includes(id);
            return (
              <li key={id} className={cx(s.card, wrong && s.missed, reveal && id === round.answerId && s.glow)} style={{ '--i': i } as CSSProperties}>
                <button type="button" className={s.cardMain} onClick={(e) => pick(id, e.currentTarget.parentElement ?? e.currentTarget)} disabled={wrong} data-choice={id} data-correct={import.meta.env.DEV ? String(id === round.answerId) : undefined}>
                  <span className={s.letter}>{String.fromCharCode(65 + i)}</span>
                  <span className={s.texts}>
                    <span className={s.fr}>{displayEn(l.fr)}</span>
                    <span className={s.en}>{displayEn(l.en)}</span>
                  </span>
                </button>
                <Speaker line={l} onPlay={() => playLine(l)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
